import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownUp,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  BarChart3,
  Bot,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Expand,
  Minimize2,
  Play,
  Plus,
  Table2,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { NotebookDataFrame } from '@shared/types';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast';
import {
  chooseFocusFrame,
  columnKind,
  formatCompact,
  formatPercent,
  numericBins,
  numericStats,
  topValues,
} from '../../lib/notebook/frameProfile';
import {
  describeStep,
  generateWrangleCode,
  previewSteps,
  type FilterOperator,
  type WranglePreview,
  type WrangleStep,
} from '../../lib/notebook/wrangle';

type OperationKind =
  | 'filter'
  | 'sort'
  | 'keep'
  | 'drop'
  | 'dropna'
  | 'groupby'
  | 'valuecounts';

const OPERATIONS: Array<{ kind: OperationKind; label: string }> = [
  { kind: 'filter', label: 'Filter rows' },
  { kind: 'sort', label: 'Sort' },
  { kind: 'keep', label: 'Keep columns' },
  { kind: 'drop', label: 'Drop columns' },
  { kind: 'dropna', label: 'Drop null rows' },
  { kind: 'groupby', label: 'Group by' },
  { kind: 'valuecounts', label: 'Value counts' },
];

const FILTER_OPERATORS: FilterOperator[] = [
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'contains',
  'starts with',
];

const AGGREGATES: Array<'mean' | 'sum' | 'count' | 'min' | 'max' | 'median'> = [
  'mean',
  'sum',
  'count',
  'min',
  'max',
  'median',
];

function Select({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange(value: string): void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'h-6 rounded border border-line bg-ink-950 px-1 font-mono text-[9px] text-mist-bright outline-none focus:border-accent/40',
        className,
      )}
    >
      {children}
    </select>
  );
}

/**
 * DataFrame grid + wrangle workbench.
 * Steps preview against the captured rows and generate a pandas program that
 * can be inserted as a notebook cell (optionally executed immediately).
 */
export function DataGrid({
  frames,
  onClose,
  onInsertCell,
  onAskAgent,
  initialProfileOpen = false,
  initialWrangleOpen = false,
}: {
  frames: Record<string, NotebookDataFrame>;
  onClose(): void;
  onInsertCell?(code: string, run: boolean): void;
  onAskAgent?(question: string, frameName: string, preview: WranglePreview): void;
  initialProfileOpen?: boolean;
  initialWrangleOpen?: boolean;
}) {
  const names = useMemo(() => Object.keys(frames), [frames]);
  const [active, setActive] = useState(names[0] || '');
  const previousNamesRef = useRef<string[]>(names);
  const [profileOpen, setProfileOpen] = useState(initialProfileOpen);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [wrangleOpen, setWrangleOpen] = useState(initialWrangleOpen);
  const [steps, setSteps] = useState<WrangleStep[]>([]);
  const [operation, setOperation] = useState<OperationKind>('filter');
  const [filterColumn, setFilterColumn] = useState('');
  const [filterOperator, setFilterOperator] = useState<FilterOperator>('==');
  const [filterValue, setFilterValue] = useState('');
  const [sortColumn, setSortColumn] = useState('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnsToToggle, setColumnsToToggle] = useState<string[]>([]);
  const [groupColumn, setGroupColumn] = useState('');
  const [groupValueColumn, setGroupValueColumn] = useState('');
  const [aggregate, setAggregate] = useState<'mean' | 'sum' | 'count' | 'min' | 'max' | 'median'>('mean');
  const [aiOpen, setAiOpen] = useState(false);
  const [question, setQuestion] = useState('');

  const frame = frames[active] || frames[names[0]];
  const columnNames = useMemo(() => frame?.columns.map((column) => column.name) || [], [frame]);
  const effectiveFilterColumn = filterColumn || columnNames[0] || '';
  const effectiveSortColumn = sortColumn || columnNames[0] || '';
  const effectiveGroupColumn = groupColumn || columnNames[0] || '';

  // Automatic wrangler: follow the newest captured DataFrame.
  useEffect(() => {
    const previous = previousNamesRef.current;
    previousNamesRef.current = names;
    if (names.length === 0) return;
    setActive((current) => {
      if (current && names.includes(current)) return current;
      return chooseFocusFrame(names, previous) || names[0];
    });
    if (names.length > previous.length) {
      const fresh = names.find((name) => !previous.includes(name));
      if (fresh) setActive(fresh);
    }
  }, [names]);

  const profile = useMemo(() => {
    if (!frame) return [];
    return frame.columns.map((column, columnIndex) => {
      const values = frame.rows.map((row) => row[columnIndex]);
      const kind = columnKind(column.dtype);
      return {
        name: column.name,
        dtype: column.dtype,
        kind,
        nulls: column.nulls,
        unique: column.unique,
        nullPct: formatPercent(column.nulls, Math.max(1, frame.shape[0])),
        min: column.min,
        max: column.max,
        mean: column.mean,
        stats: kind === 'number' ? numericStats(values) : null,
        bins: kind === 'number' ? numericBins(values, 14) : [],
        top: column.top?.length ? column.top : kind === 'text' ? topValues(values, 5) : [],
      };
    });
  }, [frame]);

  const preview = useMemo(() => {
    if (!frame) return { columns: [], rows: [], removed: 0 };
    return previewSteps(frame, steps);
  }, [frame, steps]);

  const visibleRows = useMemo(() => {
    let rows = preview.rows.map((row, index) => ({
      row,
      index: steps.length > 0 ? String(index) : frame?.index[index] ?? String(index),
    }));
    const needle = query.trim().toLowerCase();
    if (needle) {
      rows = rows.filter(({ row }) =>
        row.some((value) => String(value ?? '').toLowerCase().includes(needle)),
      );
    }
    if (sort) {
      rows = [...rows].sort((a, b) => {
        const left = a.row[sort.column];
        const right = b.row[sort.column];
        const leftNumber = typeof left === 'number' ? left : Number(left);
        const rightNumber = typeof right === 'number' ? right : Number(right);
        const comparison =
          Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
            ? leftNumber - rightNumber
            : String(left ?? '').localeCompare(String(right ?? ''));
        return comparison * sort.direction;
      });
    }
    return rows;
  }, [preview, query, sort, frame, steps.length]);

  if (!frame) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] text-mist-faint">
        No DataFrames captured yet. Run a cell that creates a pandas DataFrame.
      </div>
    );
  }

  const addStep = () => {
    let step: WrangleStep | null = null;
    if (operation === 'filter' && effectiveFilterColumn) {
      step = {
        kind: 'filter',
        column: effectiveFilterColumn,
        operator: filterOperator,
        value: filterValue,
      };
    } else if (operation === 'sort' && effectiveSortColumn) {
      step = { kind: 'sort', column: effectiveSortColumn, direction: sortDirection };
    } else if (operation === 'keep' && columnsToToggle.length > 0) {
      step = { kind: 'keep', columns: columnsToToggle };
    } else if (operation === 'drop' && columnsToToggle.length > 0) {
      step = { kind: 'drop', columns: columnsToToggle };
    } else if (operation === 'dropna') {
      step = { kind: 'dropna', columns: columnsToToggle };
    } else if (operation === 'groupby' && effectiveGroupColumn) {
      step = {
        kind: 'groupby',
        groupColumn: effectiveGroupColumn,
        valueColumn: groupValueColumn || null,
        aggregate,
      };
    } else if (operation === 'valuecounts' && effectiveSortColumn) {
      step = { kind: 'valuecounts', column: effectiveSortColumn };
    }
    if (!step) return;
    setSteps((current) => [...current, step as WrangleStep]);
    setColumnsToToggle([]);
    setSort(null);
  };

  const generatedCode = generateWrangleCode(active || 'df', frame, steps);
  const canRerun = Boolean(generatedCode && onInsertCell);

  const columnStats = (name: string) => {
    const column = frame.columns.find((item) => item.name === name);
    if (!column) return '';
    const parts = [column.dtype, `${column.unique} unique`, `${column.nulls} null`];
    if (column.mean !== undefined) parts.push(`mean ${column.mean}`);
    if (column.min !== undefined) parts.push(`min ${column.min}`);
    if (column.max !== undefined) parts.push(`max ${column.max}`);
    if (column.top?.length) {
      parts.push(`top: ${column.top.map((item) => `${item.value} (${item.count})`).join(', ')}`);
    }
    return parts.join(' Â· ');
  };

  const askAgent = () => {
    if (!question.trim() || !onAskAgent) return;
    onAskAgent(question.trim(), active || 'df', preview);
    setQuestion('');
    setAiOpen(false);
  };

  const body = (
    <div className="relative flex h-full min-h-0 flex-col border-t border-line bg-ink-950">
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-line bg-ink-900/60 px-2">
        <Table2 size={11} className="shrink-0 text-accent-dim" />
        <div className="relative">
          <button
            onClick={() => setPickerOpen((value) => !value)}
            disabled={names.length <= 1}
            className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[9px] text-mist hover:border-line-strong disabled:opacity-60"
          >
            {active || 'dataframe'}
            <ChevronDown size={9} className="text-mist-ghost" />
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-[80] mt-1 w-[230px] overflow-hidden rounded border border-line-strong bg-ink-800 p-1 shadow-panel">
              {names.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setActive(name);
                    setSteps([]);
                    setSort(null);
                    setQuery('');
                    setPickerOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-1.5 py-1 font-mono text-[9px]',
                    name === active
                      ? 'bg-ink-750 text-mist-bright'
                      : 'text-mist-faint hover:bg-ink-750/60',
                  )}
                >
                  <span className="truncate">{name}</span>
                  <span className="text-mist-ghost">
                    {frames[name].shape[0]}Ã—{frames[name].shape[1]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="font-mono text-[8.5px] text-mist-ghost">
          {preview.rows.length} of {frame.shape[0]} rows Â· {preview.columns.length} cols
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter visible rowsâ€¦"
          className="ml-auto h-5 w-[170px] rounded border border-line bg-ink-950 px-1.5 font-mono text-[9px] text-mist-bright outline-none placeholder:text-mist-ghost focus:border-accent/40"
        />
        <button
          onClick={() => setWrangleOpen((value) => !value)}
          className={cn(
            'flex h-6 items-center gap-1 rounded border px-2 text-[8.5px]',
            wrangleOpen || steps.length > 0
              ? 'border-accent/30 bg-accent/[0.07] text-accent-soft'
              : 'border-line text-mist-faint hover:text-mist',
          )}
          title="Build a transformation that generates pandas code"
        >
          <Wand2 size={9} /> Wrangle{steps.length > 0 ? ` (${steps.length})` : ''}
        </button>
        {canRerun && (
          <>
            <button
              onClick={() => generatedCode && onInsertCell?.(generatedCode, false)}
              className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[8.5px] text-mist-faint hover:text-mist"
              title="Insert generated pandas code as a new cell"
            >
              <Code2 size={9} /> Insert code
            </button>
            <button
              onClick={() => generatedCode && onInsertCell?.(generatedCode, true)}
              className="flex h-6 items-center gap-1 rounded border border-mint/25 bg-mint/[0.05] px-2 text-[8.5px] text-mint hover:bg-mint/10"
              title="Insert and run the generated code"
            >
              <Play size={9} /> Insert &amp; run
            </button>
          </>
        )}
        <button
          onClick={() => setProfileOpen((value) => !value)}
          className={cn(
            'flex h-6 items-center gap-1 rounded border px-2 text-[8.5px]',
            profileOpen
              ? 'border-accent/30 bg-accent/[0.07] text-accent-soft'
              : 'border-line text-mist-faint hover:text-mist',
          )}
          title="Column profile: types, nulls, ranges, histograms and top values"
        >
          <BarChart3 size={9} /> Profile
        </button>
        <button
          onClick={() => setAiOpen((value) => !value)}
          disabled={!onAskAgent}
          className={cn(
            'flex h-6 items-center gap-1 rounded border px-2 text-[8.5px]',
            aiOpen
              ? 'border-accent/30 bg-accent/[0.07] text-accent-soft'
              : 'border-line text-mist-faint hover:text-mist',
          )}
          title="Ask the HIM+ agent about this DataFrame"
        >
          <Bot size={9} /> Ask AI
        </button>
        <button
          onClick={() => setExpanded((value) => !value)}
          className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
          title={expanded ? 'Restore panel size' : 'Expand data view'}
          aria-label={expanded ? 'Collapse data view' : 'Expand data view'}
        >
          {expanded ? <Minimize2 size={10} /> : <Expand size={10} />}
        </button>
        <button
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
          aria-label="Close data viewer"
        >
          <X size={10} />
        </button>
      </div>

      {aiOpen && onAskAgent && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-accent/[0.03] px-2 py-1.5">
          <Bot size={10} className="shrink-0 text-accent" />
          <input
            autoFocus
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') askAgent();
              if (event.key === 'Escape') setAiOpen(false);
            }}
            placeholder={`Ask about ${active || 'this DataFrame'} (e.g. "why is score null for 1999?")`}
            className="h-6 min-w-0 flex-1 rounded border border-line bg-ink-950 px-2 font-mono text-[9.5px] text-mist-bright outline-none placeholder:text-mist-ghost focus:border-accent/40"
          />
          <button
            onClick={askAgent}
            disabled={!question.trim()}
            className="flex h-6 items-center gap-1 rounded bg-accent px-2 text-[8.5px] font-medium text-ink-950 disabled:opacity-50"
          >
            Send to agent
          </button>
        </div>
      )}

      {wrangleOpen && (
        <div className="shrink-0 border-b border-line bg-ink-900/50 px-2 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={operation} onChange={(value) => setOperation(value as OperationKind)}>
              {OPERATIONS.map((item) => (
                <option key={item.kind} value={item.kind}>
                  {item.label}
                </option>
              ))}
            </Select>

            {operation === 'filter' && (
              <>
                <Select value={effectiveFilterColumn} onChange={setFilterColumn}>
                  {columnNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
                <Select
                  value={filterOperator}
                  onChange={(value) => setFilterOperator(value as FilterOperator)}
                >
                  {FILTER_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>
                      {operator}
                    </option>
                  ))}
                </Select>
                <input
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                  placeholder="value"
                  className="h-6 w-[130px] rounded border border-line bg-ink-950 px-1.5 font-mono text-[9px] text-mist-bright outline-none focus:border-accent/40"
                />
              </>
            )}

            {operation === 'sort' && (
              <>
                <Select value={effectiveSortColumn} onChange={setSortColumn}>
                  {columnNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
                <Select value={sortDirection} onChange={(value) => setSortDirection(value as 'asc' | 'desc')}>
                  <option value="asc">ascending</option>
                  <option value="desc">descending</option>
                </Select>
              </>
            )}

            {(operation === 'keep' || operation === 'drop' || operation === 'dropna') && (
              <div className="flex max-h-[52px] flex-wrap items-center gap-1 overflow-y-auto">
                {columnNames.map((name) => {
                  const selected = columnsToToggle.includes(name);
                  return (
                    <button
                      key={name}
                      onClick={() =>
                        setColumnsToToggle((current) =>
                          selected ? current.filter((item) => item !== name) : [...current, name],
                        )
                      }
                      className={cn(
                        'rounded border px-1.5 py-0.5 font-mono text-[8.5px]',
                        selected
                          ? 'border-accent/40 bg-accent/[0.1] text-accent-soft'
                          : 'border-line text-mist-faint hover:text-mist',
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
                {operation === 'dropna' && (
                  <span className="text-[8px] text-mist-ghost">(none selected = all columns)</span>
                )}
              </div>
            )}

            {operation === 'groupby' && (
              <>
                <Select value={effectiveGroupColumn} onChange={setGroupColumn}>
                  {columnNames.map((name) => (
                    <option key={name} value={name}>
                      group: {name}
                    </option>
                  ))}
                </Select>
                <Select value={aggregate} onChange={(value) => setAggregate(value as typeof aggregate)}>
                  {AGGREGATES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
                <Select value={groupValueColumn} onChange={setGroupValueColumn}>
                  <option value="">count rows</option>
                  {columnNames.map((name) => (
                    <option key={name} value={name}>
                      of {name}
                    </option>
                  ))}
                </Select>
              </>
            )}

            {operation === 'valuecounts' && (
              <Select value={effectiveSortColumn} onChange={setSortColumn}>
                {columnNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}

            <button
              onClick={addStep}
              className="flex h-6 items-center gap-1 rounded bg-accent px-2 text-[8.5px] font-medium text-ink-950 hover:bg-accent-soft"
            >
              <Plus size={9} /> Add step
            </button>
            <div className="flex-1" />
            {steps.length > 0 && (
              <button
                onClick={() => setSteps([])}
                className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[8.5px] text-mist-faint hover:text-coral-soft"
              >
                <Trash2 size={9} /> Clear
              </button>
            )}
          </div>

          {steps.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {steps.map((step, index) => (
                <span
                  key={`${step.kind}-${index}`}
                  className="flex items-center gap-1 rounded border border-line bg-ink-850 px-1.5 py-0.5 font-mono text-[8.5px] text-mist-dim"
                >
                  <span className="text-mist-ghost">{index + 1}.</span> {describeStep(step)}
                  <button
                    onClick={() => setSteps((current) => current.filter((_, item) => item !== index))}
                    className="text-mist-ghost hover:text-coral-soft"
                    aria-label="Remove step"
                  >
                    <X size={8} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {generatedCode && (
            <div className="relative mt-1.5">
              <pre className="thin-scrollbar max-h-[92px] overflow-auto rounded border border-line/70 bg-ink-950 px-2 py-1 pr-9 font-mono text-[8.5px] leading-relaxed text-mist-dim">
                {generatedCode}
              </pre>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(generatedCode);
                  toast('success', 'Generated pandas code copied.', 'Wrangle');
                }}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
                title="Copy generated code"
                aria-label="Copy generated code"
              >
                <Copy size={9} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[9.5px]">
          <thead className="sticky top-0 z-10 bg-ink-850">
            <tr>
              <th className="sticky left-0 z-20 border-b border-r border-line bg-ink-850 px-2 py-1 text-left text-[8px] font-medium text-mist-ghost">
                #
              </th>
              {preview.columns.map((name, index) => (
                <th
                  key={`${name}-${index}`}
                  title={columnStats(name)}
                  className="border-b border-r border-line bg-ink-850 px-2 py-1 text-left font-medium text-mist-dim last:border-r-0"
                >
                  <button
                    onClick={() =>
                      setSort((current) =>
                        current?.column === index
                          ? { column: index, direction: current.direction === 1 ? -1 : 1 }
                          : { column: index, direction: 1 },
                      )
                    }
                    className="flex items-center gap-1 hover:text-mist-bright"
                  >
                    <span className="max-w-[180px] truncate">{name}</span>
                    {sort?.column === index ? (
                      sort.direction === 1 ? (
                        <ArrowUpWideNarrow size={8} className="text-accent" />
                      ) : (
                        <ArrowDownWideNarrow size={8} className="text-accent" />
                      )
                    ) : (
                      <ArrowDownUp size={7} className="text-mist-ghost/60" />
                    )}
                    <span className="text-[7.5px] uppercase tracking-wide text-mist-ghost">
                      {frame.columns.find((column) => column.name === name)?.dtype || ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, index }) => (
              <tr key={index} className="hover:bg-ink-900/60">
                <td className="sticky left-0 z-10 border-b border-r border-line bg-ink-950 px-2 py-0.5 text-[8px] text-mist-ghost">
                  {index}
                </td>
                {preview.columns.map((_, columnIndex) => {
                  const value = row[columnIndex];
                  return (
                    <td
                      key={columnIndex}
                      className="max-w-[260px] truncate border-b border-r border-line/60 px-2 py-0.5 text-mist-dim last:border-r-0"
                      title={value === null || value === undefined ? 'NaN' : String(value)}
                    >
                      {value === null || value === undefined ? (
                        <span className="text-mist-ghost">NaN</span>
                      ) : typeof value === 'number' ? (
                        <span className="text-mint/80">{value}</span>
                      ) : (
                        String(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={preview.columns.length + 1}
                  className="px-3 py-4 text-center text-[9px] text-mist-ghost"
                >
                  No rows match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-line px-2 font-mono text-[8px] text-mist-ghost">
        <span>
          Preview over captured rows ({Math.min(frame.shape[0], 200)} of {frame.shape[0]}). Generated
          code runs in the kernel on the full DataFrame.
        </span>
        <button
          onClick={() => {
            const payload = visibleRows.map(({ row }) => {
              const record: Record<string, unknown> = {};
              preview.columns.forEach((name, index) => {
                record[name] = row[index];
              });
              return record;
            });
            void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            toast('success', `${payload.length} preview rows copied as JSON.`, 'Data');
          }}
          className="flex h-5 items-center gap-1 rounded border border-line px-1.5 text-[8px] text-mist-faint hover:text-mist"
          title="Copy the currently visible rows as JSON"
        >
          <Download size={8} /> JSON
        </button>
        <button
          onClick={() => {
            const escape = (value: unknown) => {
              const text = value === null || value === undefined ? '' : String(value);
              return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
            };
            const csv = [
              preview.columns.map(escape).join(','),
              ...visibleRows.map(({ row }) => row.map(escape).join(',')),
            ].join('\n');
            void navigator.clipboard.writeText(csv);
            toast('success', `${visibleRows.length} preview rows copied as CSV.`, 'Data');
          }}
          className="flex h-5 items-center gap-1 rounded border border-line px-1.5 text-[8px] text-mist-faint hover:text-mist"
          title="Copy the currently visible rows as CSV"
        >
          <Copy size={8} /> CSV
        </button>
        <span>Click a column header to sort Â· hover for column stats</span>
      </div>

      {profileOpen && (
        <aside className="absolute inset-y-0 right-0 z-20 flex w-[330px] flex-col border-l border-line bg-ink-900/95 shadow-panel">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-line px-2">
            <span className="flex items-center gap-1.5 text-[9.5px] font-medium text-mist-bright">
              <BarChart3 size={10} className="text-accent" /> Column profile
            </span>
            <button
              onClick={() => setProfileOpen(false)}
              className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
              aria-label="Close column profile"
            >
              <X size={9} />
            </button>
          </div>
          <div className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {profile.map((column) => {
              const maxCount = Math.max(1, ...column.bins);
              return (
                <div
                  key={column.name}
                  className="rounded border border-line bg-ink-950/60 px-2 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate font-mono text-[9.5px] text-mist-bright">
                      {column.name}
                    </span>
                    <span className="rounded border border-line px-1 font-mono text-[7px] uppercase text-mist-ghost">
                      {column.kind}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[8px] text-mist-ghost">
                    <span>nulls {column.nulls} ({column.nullPct})</span>
                    <span>unique {column.unique}</span>
                    {column.kind === 'number' && (
                      <>
                        <span>min {formatCompact(column.min ?? column.stats?.min)}</span>
                        <span>max {formatCompact(column.max ?? column.stats?.max)}</span>
                        <span>mean {formatCompact(column.mean ?? column.stats?.mean)}</span>
                        <span>std {formatCompact(column.stats?.std)}</span>
                      </>
                    )}
                  </div>
                  {column.bins.length > 0 && (
                    <div className="mt-1.5 flex h-9 items-end gap-[1px]" aria-hidden>
                      {column.bins.map((count, index) => (
                        <span
                          key={index}
                          className="flex-1 rounded-sm bg-accent/45"
                          style={{ height: `${Math.max(4, (count / maxCount) * 100)}%` }}
                          title={`${count} captured row(s)`}
                        />
                      ))}
                    </div>
                  )}
                  {column.top.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {column.top.slice(0, 5).map((item) => (
                        <span
                          key={item.value}
                          className="rounded bg-ink-850 px-1 py-px font-mono text-[7.5px] text-mist-faint"
                          title={`${item.count} rows`}
                        >
                          {item.value}: {item.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}
    </div>
  );

  if (expanded) {
    return (
      <div className="fixed inset-3 z-[160] overflow-hidden rounded-lg border border-line-strong bg-ink-950 shadow-panel">
        {body}
      </div>
    );
  }
  return body;
}

