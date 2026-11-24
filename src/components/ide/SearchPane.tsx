import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileSearch, Search, X } from 'lucide-react';
import type { SearchResult } from '@shared/types';
import { him, cleanErrorMessage } from '../../lib/bridge';
import { cn, relativeTo, truncate } from '../../lib/utils';
import { useCoreStore } from '../../store/core';
import { useEditorStore } from '../../store/editor';
import { FileTypeIcon } from '../FileIcon';
import { Spinner } from '../ui';

function Highlighted({
  text,
  query,
  caseSensitive,
}: {
  text: string;
  query: string;
  caseSensitive: boolean;
}) {
  if (!query) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, caseSensitive ? 'g' : 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            className="rounded-sm bg-accent/15 px-px text-accent-soft"
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export function SearchPane() {
  const workspace = useCoreStore((state) => state.workspace);
  const openFile = useEditorStore((state) => state.openFile);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!workspace || !query.trim()) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }
    const request = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await him.search.run(workspace, {
          query,
          regex,
          caseSensitive,
          maxResults: 150,
        });
        if (requestRef.current !== request) return;
        setResult(response);
      } catch (searchError) {
        if (requestRef.current !== request) return;
        setError(cleanErrorMessage(searchError));
        setResult(null);
      } finally {
        if (requestRef.current === request) setLoading(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, regex, caseSensitive, workspace]);

  const groups = useMemo(() => {
    if (!result) return [];
    const map = new Map<string, SearchResult['matches']>();
    for (const match of result.matches) {
      const list = map.get(match.path) || [];
      list.push(match);
      map.set(match.path, list);
    }
    return [...map.entries()];
  }, [result]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-850/45">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-2.5">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-mist-faint">
          Search
        </span>
      </div>
      <div className="shrink-0 space-y-2 border-b border-line/70 p-2.5">
        <div className="relative">
          <Search
            size={11}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mist-ghost"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspace"
            spellCheck={false}
            className="him-input h-7 pl-7 pr-7 font-mono text-[10.5px]"
          />
          {loading ? (
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              <Spinner size={10} />
            </span>
          ) : (
            query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
                aria-label="Clear search"
              >
                <X size={10} />
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCaseSensitive((value) => !value)}
            className={cn(
              'flex h-5 min-w-6 items-center justify-center rounded border px-1 font-mono text-[9px] transition-colors',
              caseSensitive
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-line bg-ink-850 text-mist-faint hover:text-mist',
            )}
            title="Match case"
          >
            Aa
          </button>
          <button
            onClick={() => setRegex((value) => !value)}
            className={cn(
              'flex h-5 min-w-6 items-center justify-center rounded border px-1 font-mono text-[9px] transition-colors',
              regex
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-line bg-ink-850 text-mist-faint hover:text-mist',
            )}
            title="Use regular expression"
          >
            .*
          </button>
          <span className="ml-auto font-mono text-[8.5px] text-mist-ghost">
            {result ? `${result.matches.length}${result.truncated ? '+' : ''} results` : ''}
          </span>
        </div>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {!workspace ? (
          <div className="px-4 py-6 text-center text-[9.5px] leading-relaxed text-mist-faint">
            Open a workspace to search its text.
          </div>
        ) : !query.trim() ? (
          <div className="px-4 py-6">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-ink-850 text-mist-ghost">
              <FileSearch size={15} />
            </div>
            <div className="text-[10.5px] font-medium text-mist">Full-text search</div>
            <p className="mt-1 text-[9.5px] leading-relaxed text-mist-faint">
              Search every file in the workspace. Binary files, node_modules, build output and
              .git are skipped automatically.
            </p>
            <div className="mt-3 space-y-1 font-mono text-[8.5px] text-mist-ghost">
              <div>Aa — match case</div>
              <div>.* — regular expression</div>
            </div>
          </div>
        ) : error ? (
          <div className="px-3 py-4">
            <p className="break-word text-[10px] leading-relaxed text-coral-soft">{error}</p>
          </div>
        ) : result && groups.length === 0 && !loading ? (
          <div className="px-4 py-6 text-center">
            <div className="text-[10px] text-mist-faint">No matches</div>
            <p className="mt-1 text-[9px] text-mist-ghost">
              Searched {result.filesScanned} files in {result.elapsedMs}ms.
            </p>
          </div>
        ) : (
          <div className="py-1">
            {groups.map(([filePath, matches]) => {
              const relative = workspace ? relativeTo(workspace, filePath) : filePath;
              return (
                <div key={filePath} className="mb-0.5">
                  <button
                    onClick={() => void openFile(filePath, { line: matches[0].line, column: matches[0].column })}
                    className="flex h-6 w-full items-center gap-1.5 px-2 text-left text-[9.5px] text-mist transition-colors hover:bg-ink-800/60"
                    title={relative}
                  >
                    <ChevronRight size={9} className="shrink-0 text-mist-ghost" />
                    <FileTypeIcon name={filePath} size={11} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[9px]">{relative}</span>
                    <span className="shrink-0 font-mono text-[8px] text-mist-ghost">
                      {matches.length}
                    </span>
                  </button>
                  {matches.slice(0, 20).map((match) => (
                    <button
                      key={`${match.line}:${match.column}`}
                      onClick={() =>
                        void openFile(filePath, { line: match.line, column: match.column })
                      }
                      className="flex w-full items-start gap-2 py-0.5 pl-7 pr-2.5 text-left font-mono text-[9px] leading-[1.6] text-mist-faint transition-colors hover:bg-ink-800/45 hover:text-mist"
                      title={`${relative}:${match.line}:${match.column}`}
                    >
                      <span className="w-7 shrink-0 text-right tabular-nums text-mist-ghost">
                        {match.line}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {regex ? (
                          truncate(match.preview.trim(), 140)
                        ) : (
                          <Highlighted
                            text={truncate(match.preview.trim(), 140)}
                            query={query}
                            caseSensitive={caseSensitive}
                          />
                        )}
                      </span>
                    </button>
                  ))}
                  {matches.length > 20 && (
                    <div className="pl-7 pt-0.5 text-[8px] text-mist-ghost">
                      {matches.length - 20} more matches in this file
                    </div>
                  )}
                </div>
              );
            })}
            {result && result.truncated && (
              <div className="px-3 py-2 text-[8px] text-mist-ghost">
                Results were truncated. Refine the query for more precision.
              </div>
            )}
          </div>
        )}
      </div>
      {result && query.trim() && (
        <div className="flex h-6 shrink-0 items-center border-t border-line/70 px-2.5 font-mono text-[8px] text-mist-ghost">
          {result.matches.length} matches · {result.filesScanned} files · {result.elapsedMs}ms
        </div>
      )}
    </div>
  );
}
