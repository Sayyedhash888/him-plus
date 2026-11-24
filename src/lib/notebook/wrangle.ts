import type { NotebookDataFrame } from '@shared/types';

/**
 * Pure data-wrangling model shared by the grid (live preview over captured
 * rows) and the code generator (pandas program inserted into the notebook).
 */

export type FilterOperator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'starts with';

export type WrangleStep =
  | { kind: 'filter'; column: string; operator: FilterOperator; value: string }
  | { kind: 'sort'; column: string; direction: 'asc' | 'desc' }
  | { kind: 'keep'; columns: string[] }
  | { kind: 'drop'; columns: string[] }
  | { kind: 'dropna'; columns: string[] }
  | {
      kind: 'groupby';
      groupColumn: string;
      valueColumn: string | null;
      aggregate: 'mean' | 'sum' | 'count' | 'min' | 'max' | 'median';
    }
  | { kind: 'valuecounts'; column: string };

export interface WranglePreview {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  removed: number;
}

function literalValue(raw: string, numericColumn: boolean): string | number {
  const trimmed = raw.trim();
  if (numericColumn && trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  return trimmed;
}

function cellNumber(value: string | number | boolean | null): number {
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function matchesFilter(
  value: string | number | boolean | null,
  operator: FilterOperator,
  raw: string,
): boolean {
  if (value === null || value === undefined) return false;
  if (operator === 'contains') {
    return String(value).toLowerCase().includes(raw.trim().toLowerCase());
  }
  if (operator === 'starts with') {
    return String(value).toLowerCase().startsWith(raw.trim().toLowerCase());
  }
  if (typeof value === 'number' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    const target = Number(raw);
    switch (operator) {
      case '==':
        return value === target;
      case '!=':
        return value !== target;
      case '>':
        return value > target;
      case '>=':
        return value >= target;
      case '<':
        return value < target;
      case '<=':
        return value <= target;
      default:
        return false;
    }
  }
  const left = String(value ?? '');
  const right = raw;
  switch (operator) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    default:
      return false;
  }
}

/** Runs the wrangle steps against the captured rows so the grid can preview them. */
export function previewSteps(
  frame: NotebookDataFrame,
  steps: WrangleStep[],
): WranglePreview {
  let columns = frame.columns.map((column) => column.name);
  let rows = frame.rows.map((row) => [...row]);
  let removed = 0;

  for (const step of steps) {
    const indexOf = (name: string) => columns.indexOf(name);
    if (step.kind === 'filter') {
      const index = indexOf(step.column);
      if (index === -1) continue;
      const before = rows.length;
      rows = rows.filter((row) => matchesFilter(row[index], step.operator, step.value));
      removed += before - rows.length;
    } else if (step.kind === 'sort') {
      const index = indexOf(step.column);
      if (index === -1) continue;
      const direction = step.direction === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const left = a[index];
        const right = b[index];
        if (typeof left === 'number' && typeof right === 'number') {
          return (left - right) * direction;
        }
        return String(left ?? '').localeCompare(String(right ?? '')) * direction;
      });
    } else if (step.kind === 'keep') {
      const indices = step.columns
        .map((name) => columns.indexOf(name))
        .filter((index) => index >= 0);
      if (indices.length === 0) continue;
      columns = indices.map((index) => columns[index]);
      rows = rows.map((row) => indices.map((index) => row[index]));
    } else if (step.kind === 'drop') {
      const dropIndices = new Set(
        step.columns.map((name) => columns.indexOf(name)).filter((index) => index >= 0),
      );
      const indices = columns.map((_, index) => index).filter((index) => !dropIndices.has(index));
      columns = indices.map((index) => columns[index]);
      rows = rows.map((row) => indices.map((index) => row[index]));
    } else if (step.kind === 'dropna') {
      const indices =
        step.columns.length > 0
          ? step.columns.map((name) => columns.indexOf(name)).filter((index) => index >= 0)
          : columns.map((_, index) => index);
      const before = rows.length;
      rows = rows.filter((row) => indices.every((index) => row[index] !== null && row[index] !== undefined));
      removed += before - rows.length;
    } else if (step.kind === 'groupby') {
      const groupIndex = indexOf(step.groupColumn);
      if (groupIndex === -1) continue;
      const valueIndex = step.valueColumn ? indexOf(step.valueColumn) : -1;
      const groups = new Map<string, Array<Array<string | number | boolean | null>>>();
      for (const row of rows) {
        const key = String(row[groupIndex] ?? '');
        const bucket = groups.get(key) || [];
        bucket.push(row);
        groups.set(key, bucket);
      }
      const header = [step.groupColumn, valueIndex >= 0 ? `${step.aggregate}(${step.valueColumn})` : 'count'];
      const nextRows: Array<Array<string | number | boolean | null>> = [];
      for (const [key, bucket] of groups) {
        if (valueIndex >= 0) {
          const values = bucket
            .map((row) => cellNumber(row[valueIndex]))
            .filter((value) => Number.isFinite(value));
          const aggregate =
            values.length === 0
              ? null
              : step.aggregate === 'mean'
                ? values.reduce((total, value) => total + value, 0) / values.length
                : step.aggregate === 'sum'
                  ? values.reduce((total, value) => total + value, 0)
                  : step.aggregate === 'count'
                    ? values.length
                    : step.aggregate === 'min'
                      ? Math.min(...values)
                      : step.aggregate === 'max'
                        ? Math.max(...values)
                        : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
          nextRows.push([key, aggregate]);
        } else {
          nextRows.push([key, bucket.length]);
        }
      }
      columns = header;
      rows = nextRows;
    } else if (step.kind === 'valuecounts') {
      const index = indexOf(step.column);
      if (index === -1) continue;
      const counts = new Map<string, number>();
      for (const row of rows) {
        const key = String(row[index] ?? '');
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      columns = [step.column, 'count'];
      rows = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => [value, count]);
    }
  }

  return { columns, rows, removed };
}

function columnLiteral(column: string): string {
  return JSON.stringify(column);
}

function isNumericColumn(frame: NotebookDataFrame, column: string): boolean {
  const info = frame.columns.find((item) => item.name === column);
  return Boolean(info && /int|float|decimal|number/i.test(info.dtype));
}

/** Generates a runnable pandas program for the steps, operating on `frameVar`. */
export function generateWrangleCode(
  frameVar: string,
  frame: NotebookDataFrame,
  steps: WrangleStep[],
): string | null {
  if (steps.length === 0) return null;
  const lines: string[] = [`_wrangled = ${frameVar}.copy()`];
  for (const step of steps) {
    if (step.kind === 'filter') {
      const column = columnLiteral(step.column);
      if (step.operator === 'contains' || step.operator === 'starts with') {
        const method = step.operator === 'contains' ? 'contains' : 'startswith';
        lines.push(
          `_wrangled = _wrangled[_wrangled[${column}].astype(str).str.${method}(${JSON.stringify(step.value)}, case=False, na=False)]`,
        );
      } else {
        const value = literalValue(step.value, isNumericColumn(frame, step.column));
        const literal = typeof value === 'number' ? String(value) : JSON.stringify(String(value));
        lines.push(`_wrangled = _wrangled[_wrangled[${column}] ${step.operator} ${literal}]`);
      }
    } else if (step.kind === 'sort') {
      lines.push(
        `_wrangled = _wrangled.sort_values(${columnLiteral(step.column)}, ascending=${step.direction === 'asc' ? 'True' : 'False'})`,
      );
    } else if (step.kind === 'keep') {
      lines.push(
        `_wrangled = _wrangled[[${step.columns.map(columnLiteral).join(', ')}]]`,
      );
    } else if (step.kind === 'drop') {
      lines.push(
        `_wrangled = _wrangled.drop(columns=[${step.columns.map(columnLiteral).join(', ')}])`,
      );
    } else if (step.kind === 'dropna') {
      lines.push(
        `_wrangled = _wrangled.dropna(subset=[${step.columns.map(columnLiteral).join(', ')}])`,
      );
    } else if (step.kind === 'groupby') {
      const group = columnLiteral(step.groupColumn);
      if (step.valueColumn) {
        lines.push(
          `_wrangled = _wrangled.groupby(${group}, as_index=False)[${columnLiteral(step.valueColumn)}].${step.aggregate}()`,
        );
      } else {
        lines.push(
          `_wrangled = _wrangled.groupby(${group}).size().reset_index(name='count')`,
        );
      }
    } else if (step.kind === 'valuecounts') {
      const column = columnLiteral(step.column);
      lines.push(
        `_wrangled = _wrangled[${column}].value_counts().rename_axis(${column}).reset_index(name='count')`,
      );
    }
  }
  lines.push('_wrangled');
  return lines.join('\n');
}

/** One-line human description of a step, used in the wrangle list UI. */
export function describeStep(step: WrangleStep): string {
  switch (step.kind) {
    case 'filter':
      return `keep rows where ${step.column} ${step.operator} ${step.value || '…'}`;
    case 'sort':
      return `sort by ${step.column} ${step.direction === 'asc' ? '↑' : '↓'}`;
    case 'keep':
      return `keep columns ${step.columns.join(', ')}`;
    case 'drop':
      return `drop columns ${step.columns.join(', ')}`;
    case 'dropna':
      return `drop null rows${step.columns.length ? ` in ${step.columns.join(', ')}` : ''}`;
    case 'groupby':
      return `group by ${step.groupColumn} → ${step.aggregate}${step.valueColumn ? `(${step.valueColumn})` : ''}`;
    case 'valuecounts':
      return `value counts of ${step.column}`;
    default:
      return 'step';
  }
}
