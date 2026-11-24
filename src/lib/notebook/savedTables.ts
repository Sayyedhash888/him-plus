import type { NotebookCell, NotebookDataFrame, NotebookOutput } from '@shared/types';

function numericStats(values: number[]): { min: number; max: number; mean: number } {
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: sum / values.length,
  };
}

interface ParsedTable {
  columns: string[];
  rows: string[][];
  index: string[];
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (entity.startsWith('#')) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITY_MAP[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts pandas-style HTML tables from a saved notebook output. */
export function parseHtmlTables(html: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  for (const tableMatch of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const table = tableMatch[0];
    const headMatch = /<thead[\s\S]*?<\/thead>/i.exec(table);
    const bodyMatch = /<tbody[\s\S]*?<\/tbody>/i.exec(table);
    const head = headMatch ? headMatch[0] : table;
    const body = bodyMatch ? bodyMatch[0] : table;
    const rawColumns = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) =>
      decodeEntities(match[1]),
    );
    // pandas puts an empty leading <th> for the index column.
    const columns = rawColumns.filter((column, index) => column !== '' || index > 0);
    const bodyRows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    const rows: string[][] = [];
    const index: string[] = [];
    for (const rowMatch of bodyRows) {
      const row = rowMatch[1];
      const rowIndex = /<th[^>]*>([\s\S]*?)<\/th>/i.exec(row);
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
        decodeEntities(match[1]),
      );
      if (cells.length === 0) continue;
      rows.push(cells);
      index.push(rowIndex ? decodeEntities(rowIndex[1]) : String(rows.length - 1));
    }
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    if (columns.length === 0 || rows.length === 0) continue;
    const normalizedColumns = Array.from({ length: width }, (_, index) =>
      columns[index] && columns[index].trim() ? columns[index] : `col_${index + 1}`,
    );
    tables.push({
      columns: normalizedColumns,
      rows: rows.map((row) => normalizedColumns.map((_, index) => row[index] ?? '')),
      index,
    });
  }
  return tables;
}

function looksNumeric(values: string[]): boolean {
  const present = values.filter((value) => value !== '' && value !== 'NaN' && value !== 'None');
  return present.length > 0 && present.every((value) => Number.isFinite(Number(value)));
}

function toFrame(table: ParsedTable): NotebookDataFrame {
  const total = table.rows.length;
  const columns = table.columns.map((name, columnIndex) => {
    const values = table.rows.map((row) => row[columnIndex]);
    const nulls = values.filter((value) => value === '' || value === 'NaN' || value === 'None').length;
    const unique = new Set(values.filter((value) => value !== '')).size;
    const numeric = looksNumeric(values);
    const numbers = values
      .filter((value) => value !== '' && value !== 'NaN' && value !== 'None')
      .map((value) => Number(value));
    const stats = numeric && numbers.length > 0 ? numericStats(numbers) : null;
    return {
      name,
      dtype: numeric ? 'float64' : 'object',
      nulls,
      unique,
      min: stats?.min ?? undefined,
      max: stats?.max ?? undefined,
      mean: stats?.mean ?? undefined,
    };
  });
  const rows = table.rows.map((row) =>
    row.map((value, columnIndex) =>
      columns[columnIndex].dtype === 'float64' && value !== '' && value !== 'NaN'
        ? Number(value)
        : value,
    ),
  );
  return {
    columns,
    rows,
    shape: [total, table.columns.length],
    index: table.index,
  };
}

function frameNameFromSource(source: string, fallback: string): string {
  const assignments = [...source.matchAll(/^\s*([A-Za-z_]\w*)\s*=/gm)];
  if (assignments.length > 0) return assignments[assignments.length - 1][1];
  const expressions = [...source.matchAll(/^\s*([A-Za-z_]\w*)\s*$/gm)];
  if (expressions.length > 0) return expressions[0][1];
  return fallback;
}

/**
 * Rebuilds inline DataFrame previews from outputs saved in the .ipynb, so a
 * reopened notebook shows its data views without re-running cells.
 */
export function extractSavedFrames(cell: NotebookCell): Record<string, NotebookDataFrame> {
  const frames: Record<string, NotebookDataFrame> = {};
  let tableIndex = 0;
  for (const output of cell.outputs) {
    const frame = savedFrameFromOutput(cell, output, tableIndex);
    if (!frame) continue;
    const baseName = frameNameFromSource(cell.source, 'saved_df');
    let name = tableIndex === 0 ? baseName : `${baseName}_${tableIndex + 1}`;
    while (frames[name]) name = `${name}_${tableIndex + 1}`;
    frames[name] = frame.frame;
    tableIndex += 1;
  }
  return frames;
}

function savedFrameFromOutput(
  cell: NotebookCell,
  output: NotebookOutput,
  tableIndex: number,
): { frame: NotebookDataFrame } | null {
  const html = output.data?.['text/html'];
  const htmlText = Array.isArray(html) ? html.join('') : html;
  if (typeof htmlText !== 'string' || !/<table/i.test(htmlText)) return null;
  const tables = parseHtmlTables(htmlText);
  const table = tables[0];
  if (!table) return null;
  // Ignore tiny layout tables (e.g. widget wrappers) that aren't dataframes.
  if (table.columns.length < 1 || table.rows.length < 1) return null;
  return { frame: toFrame(table) };
}
