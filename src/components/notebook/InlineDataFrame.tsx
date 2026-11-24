import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, BarChart3, Copy, Expand, Table2, Wand2 } from 'lucide-react';
import type { NotebookDataFrame } from '@shared/types';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast';
import {
  chooseFocusFrame,
  columnKind,
  formatCompact,
  formatPercent,
  numericBins,
  topValues,
} from '../../lib/notebook/frameProfile';

/**
 * Inline DataFrame output shown inside the cell that produced it — compact
 * preview with PyCharm-style column headers (stats + mini histogram), quick
 * sort/search and a button to open the full wrangle workbench.
 *
 * `saved` frames are reconstructed from notebook outputs; their generated pandas
 * code would be unreliable, so wrangle/insert actions are hidden for them.
 */
export function InlineDataFrame({
  cellId,
  frames,
  saved = false,
  onExpand,
}: {
  cellId: string;
  frames: Record<string, NotebookDataFrame>;
  saved?: boolean;
  onExpand(mode: 'grid' | 'profile' | 'wrangle'): void;
}) {
  const names = useMemo(() => Object.keys(frames), [frames]);
  const [active, setActive] = useState(names[0] || '');
  const previousNamesRef = useRef<string[]>(names);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: number; direction: 1 | -1 } | null>(null);
  const [rowLimit, setRowLimit] = useState(7);
  const frame = frames[active] || frames[names[0]];
  const selectedName = active && frames[active] ? active : names[0];

  useEffect(() => {
    const previous = previousNamesRef.current;
    previousNamesRef.current = names;
    if (names.length === 0) return;
    setActive((current) =>
      current && names.includes(current) ? current : chooseFocusFrame(names, previous) || names[0],
    );
    if (names.length > previous.length) {
      const fresh = names.find((name) => !previous.includes(name));
      if (fresh) setActive(fresh);
    }
  }, [names]);

  const headers = useMemo(() => {
    if (!frame) return [];
    return frame.columns.map((column, columnIndex) => {
      const values = frame.rows.map((row) => row[columnIndex]);
      const kind = columnKind(column.dtype);
      return {
        column,
        kind,
        bins: kind === 'number' ? numericBins(values, 16) : [],
        top: kind === 'text' ? (column.top?.length ? column.top : topValues(values, 3)) : [],
      };
    });
  }, [frame]);

  const rows = useMemo(() => {
    if (!frame) return [] as Array<{ row: NotebookDataFrame['rows'][number]; index: string }>;
    let list = frame.rows.map((row, rowIndex) => ({
      row,
      index: String(frame.index[rowIndex] ?? rowIndex),
    }));
    const needle = query.trim().toLowerCase();
    if (needle) {
      list = list.filter(({ row }) =>
        row.some((value) => String(value ?? '').toLowerCase().includes(needle)),
      );
    }
    if (sort) {
      list = [...list].sort((left, right) => {
        const a = left.row[sort.column];
        const b = right.row[sort.column];
        const an = Number(a);
        const bn = Number(b);
        const comparison =
          Number.isFinite(an) && Number.isFinite(bn)
            ? an - bn
            : String(a ?? '').localeCompare(String(b ?? ''));
        return comparison * sort.direction;
      });
    }
    return list;
  }, [frame, query, sort]);

  if (!frame) return null;

  const visibleRows = rows.slice(0, rowLimit);

  const copyCsv = () => {
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const csv = [
      frame.columns.map((column) => escape(column.name)).join(','),
      ...visibleRows.map(({ row }) => row.map(escape).join(',')),
    ].join('\n');
    void navigator.clipboard.writeText(csv);
    toast('success', `${visibleRows.length} rows copied as CSV.`, 'DataFrame');
  };

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-line bg-ink-950/70">
      <div className="flex min-h-8 flex-wrap items-center gap-2 border-b border-line bg-ink-900/60 px-2 py-1">
        <Table2 size={11} className="shrink-0 text-accent-dim" />
        {names.length > 1 ? (
          <select
            value={selectedName}
            onChange={(event) => setActive(event.target.value)}
            className="h-5 max-w-[170px] rounded border border-line bg-ink-950 px-1 font-mono text-[9px] text-mist-bright outline-none focus:border-accent/40"
            title="Switch DataFrame"
          >
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-[9.5px] text-mist-bright">{selectedName}</span>
        )}
        {saved && (
          <span className="rounded border border-sand/25 bg-sand/[0.05] px-1 font-mono text-[7px] uppercase tracking-wide text-sand-soft">
            saved output
          </span>
        )}
        <span className="font-mono text-[8px] text-mist-ghost">
          {frame.shape[0].toLocaleString()} rows × {frame.shape[1]} cols
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter rows…"
          className="h-5 w-28 rounded border border-line bg-ink-950 px-1.5 font-mono text-[8.5px] text-mist-bright outline-none placeholder:text-mist-ghost focus:border-accent/40"
        />
        <select
          value={rowLimit}
          onChange={(event) => setRowLimit(Number(event.target.value))}
          className="h-5 rounded border border-line bg-ink-950 px-1 font-mono text-[8.5px] text-mist-faint outline-none focus:border-accent/40"
          title="Preview rows"
        >
          {[7, 25, 100].map((count) => (
            <option key={count} value={count}>
              {count} rows
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={copyCsv}
            className="flex h-5 items-center gap-1 rounded px-1 text-[8px] text-mist-ghost hover:bg-ink-750 hover:text-mist"
            title="Copy visible rows as CSV"
          >
            <Copy size={8} /> CSV
          </button>
          {!saved && (
            <button
              onClick={() => onExpand('wrangle')}
              className="flex h-5 items-center gap-1 rounded border border-line px-1.5 text-[8px] text-mist-faint hover:text-mist"
              title="Open the wrangle workbench for this DataFrame"
            >
              <Wand2 size={8} /> Wrangle
            </button>
          )}
          <button
            onClick={() => onExpand('profile')}
            className="flex h-5 items-center gap-1 rounded border border-line px-1.5 text-[8px] text-mist-faint hover:text-mist"
            title="Open the full column profile and table"
          >
            <BarChart3 size={8} /> Profile
          </button>
          <button
            onClick={() => onExpand('grid')}
            className="flex h-5 items-center gap-1 rounded border border-line px-1.5 text-[8px] text-mist-faint hover:text-mist"
            title="Open the full data grid"
          >
            <Expand size={8} /> Open
          </button>
        </div>
      </div>

      <div className="thin-scrollbar max-h-[300px] overflow-auto">
        <table className="w-full border-collapse font-mono text-[9.5px]">
          <thead className="sticky top-0 z-10 bg-ink-850">
            <tr>
              <th className="w-8 border-b border-r border-line px-1.5 py-1 text-left text-[8px] font-medium text-mist-ghost">
                #
              </th>
              {headers.map(({ column, kind, bins, top }, columnIndex) => {
                const maxCount = Math.max(1, ...bins);
                return (
                  <th
                    key={column.name}
                    className="min-w-[130px] border-b border-r border-line bg-ink-850 px-2 py-1 text-left align-top font-medium text-mist-dim last:border-r-0"
                    title={`${column.dtype} · ${column.nulls} nulls · ${column.unique} unique`}
                  >
                    <button
                      onClick={() =>
                        setSort((current) =>
                          current?.column === columnIndex
                            ? { column: columnIndex, direction: current.direction === 1 ? -1 : 1 }
                            : { column: columnIndex, direction: 1 },
                        )
                      }
                      className="flex w-full items-center gap-1 font-medium hover:text-mist-bright"
                      title="Sort by this column"
                    >
                      <span className="max-w-[150px] truncate text-[9.5px] text-mist-bright">
                        {column.name}
                      </span>
                      <span className="rounded border border-line px-1 text-[6.5px] uppercase tracking-wide text-mist-ghost">
                        {kind === 'number' ? 'num' : kind === 'text' ? 'str' : column.dtype}
                      </span>
                      <span className="ml-auto text-[8px] text-accent">
                        {sort?.column === columnIndex
                          ? sort.direction === 1
                            ? '↑'
                            : '↓'
                          : <ArrowDownUp size={7} className="text-mist-ghost/50" />}
                      </span>
                    </button>
                    <div className="mt-0.5 flex items-center gap-1 text-[7.5px] font-normal text-mist-ghost">
                      <span>null {column.nulls}</span>
                      <span>· {column.unique} uniq</span>
                    </div>
                    {bins.length > 0 && (
                      <div className="mt-1 flex h-7 items-end gap-[1px]" aria-hidden>
                        {bins.map((count, index) => (
                          <span
                            key={index}
                            className={cn('flex-1 rounded-sm', count > 0 ? 'bg-accent/55' : 'bg-ink-750')}
                            style={{ height: `${Math.max(6, (count / maxCount) * 100)}%` }}
                          />
                        ))}
                      </div>
                    )}
                    {top.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {top.slice(0, 3).map((item) => (
                          <div
                            key={item.value}
                            className="flex items-center gap-1 text-[7px] font-normal text-mist-faint"
                          >
                            <span className="min-w-0 flex-1 truncate">{item.value}</span>
                            <span className="text-mist-ghost">
                              {formatPercent(item.count, Math.max(1, frame.rows.length))}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, index }, rowIndex) => (
              <tr key={`${index}-${rowIndex}`} className="hover:bg-ink-900/60">
                <td className="border-b border-r border-line/60 px-1.5 py-0.5 text-[8px] text-mist-ghost">
                  {index}
                </td>
                {row.map((value, columnIndex) => {
                  const column = frame.columns[columnIndex];
                  return (
                    <td
                      key={columnIndex}
                      className="max-w-[220px] truncate border-b border-r border-line/60 px-2 py-0.5 text-mist-dim last:border-r-0"
                      title={value === null || value === undefined ? 'NaN' : String(value)}
                    >
                      {value === null || value === undefined ? (
                        <span className="text-mist-ghost">NaN</span>
                      ) : column && columnKind(column.dtype) === 'number' ? (
                        <span className="text-mint/80">{formatCompact(value as number)}</span>
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
                  colSpan={frame.columns.length + 1}
                  className="px-3 py-3 text-center text-[9px] text-mist-ghost"
                >
                  No rows match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-2 py-1 font-mono text-[7.5px] text-mist-ghost">
        <span>
          Inline preview: {visibleRows.length} of {rows.length}
          {query ? ` filtered from ${frame.rows.length}` : ''} captured rows · full DataFrame stays
          in the kernel
        </span>
        <span className="ml-auto">
          {saved ? 'from saved notebook output · re-run for live analysis' : 'graphs show captured rows'}
        </span>
      </div>
    </div>
  );
}
