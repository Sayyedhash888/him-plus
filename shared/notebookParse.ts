/** Lenient notebook-file parsing shared by the main process and tests. */

export interface ParsedNotebookFile {
  raw: Record<string, unknown>;
  warning?: string;
}

function normalizeV3Source(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((line) => typeof line === 'string').join('');
  return '';
}

function convertV3Outputs(outputs: unknown): unknown[] {
  if (!Array.isArray(outputs)) return [];
  const converted: unknown[] = [];
  for (const raw of outputs) {
    if (!raw || typeof raw !== 'object') continue;
    const output = raw as Record<string, unknown>;
    if (output.stream) {
      converted.push({ output_type: 'stream', name: 'stdout', text: String(output.text || '') });
    } else if (output.output_type === 'stream') {
      converted.push({
        output_type: 'stream',
        name: typeof output.name === 'string' ? output.name : 'stdout',
        text: Array.isArray(output.text) ? output.text.join('') : String(output.text || ''),
      });
    } else if (output.output_type === 'pyout') {
      converted.push({
        output_type: 'execute_result',
        data: { 'text/plain': String(output.text || '') },
        metadata: {},
        execution_count: typeof output.prompt_number === 'number' ? output.prompt_number : null,
      });
    } else if (output.output_type === 'pyerr') {
      converted.push({
        output_type: 'error',
        ename: String(output.ename || 'Error'),
        evalue: String(output.evalue || ''),
        traceback: Array.isArray(output.traceback) ? output.traceback : [],
      });
    } else if (output.output_type === 'display_data') {
      converted.push({ output_type: 'display_data', data: output.data || {}, metadata: {} });
    }
  }
  return converted;
}

function convertV3Notebook(raw: Record<string, unknown>): Record<string, unknown> {
  const worksheets = Array.isArray(raw.worksheets) ? raw.worksheets : [];
  const cells: unknown[] = [];
  for (const sheet of worksheets) {
    if (!sheet || typeof sheet !== 'object') continue;
    const sheetCells = (sheet as Record<string, unknown>).cells;
    if (!Array.isArray(sheetCells)) continue;
    for (const rawCell of sheetCells) {
      if (!rawCell || typeof rawCell !== 'object') continue;
      const cell = rawCell as Record<string, unknown>;
      const cellType =
        cell.cell_type === 'markdown' || cell.cell_type === 'heading'
          ? 'markdown'
          : cell.cell_type === 'code'
            ? 'code'
            : 'raw';
      cells.push({
        cell_type: cellType,
        source:
          cellType === 'markdown'
            ? normalizeV3Source(cell.source || cell.input || '')
            : normalizeV3Source(cell.input || cell.source || ''),
        metadata: cell.metadata || {},
        outputs: cellType === 'code' ? convertV3Outputs(cell.outputs) : [],
        execution_count: typeof cell.prompt_number === 'number' ? cell.prompt_number : null,
      });
    }
  }
  return {
    ...raw,
    nbformat: 4,
    nbformat_minor: 5,
    cells,
  };
}

/**
 * Parses notebook text. Empty files open as a blank notebook (with a warning)
 * instead of failing with a JSON error; nbformat 3 notebooks are converted.
 */
export function parseNotebookFileText(fileName: string, text: string): ParsedNotebookFile {
  const clean = text.replace(/^\uFEFF/, '');
  if (!clean.trim()) {
    return {
      raw: {},
      warning: `"${fileName}" is empty (0 bytes). HIM+ started a blank notebook — save it to write valid nbformat JSON.`,
    };
  }
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(clean) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('top-level JSON is not an object');
    }
    raw = parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `"${fileName}" is not valid notebook JSON (${clean.length} characters: ${(error as Error).message}).`,
    );
  }
  if (!Array.isArray(raw.cells)) {
    if (Array.isArray(raw.worksheets)) {
      return { raw: convertV3Notebook(raw), warning: 'Converted an nbformat 3 notebook to nbformat 4.' };
    }
    throw new Error(
      `"${fileName}" is valid JSON but is not a notebook (missing the "cells" array).`,
    );
  }
  return { raw };
}
