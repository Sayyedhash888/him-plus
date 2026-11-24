import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, FileText, Search } from 'lucide-react';
import { FileTypeIcon } from './FileIcon';
import { Kbd } from './ui';
import { cn } from '../lib/utils';
import { useCoreStore } from '../store/core';
import { useEditorStore } from '../store/editor';
import { switchMode } from '../lib/actions';

function fuzzyScore(candidate: string, query: string): number {
  if (!query) return 1;
  const lower = candidate.toLowerCase();
  const needle = query.toLowerCase();
  const direct = lower.indexOf(needle);
  if (direct === 0) return 1000 - candidate.length;
  if (direct > 0) return 600 - direct - candidate.length / 10;
  let index = 0;
  let score = 0;
  for (const char of needle) {
    const found = lower.indexOf(char, index);
    if (found === -1) return 0;
    score += found === index ? 4 : 1;
    index = found + 1;
  }
  return score;
}

export function QuickOpen() {
  const open = useCoreStore((state) => state.quickOpen);
  const setQuickOpen = useCoreStore((state) => state.setQuickOpen);
  const workspace = useCoreStore((state) => state.workspace);
  const files = useCoreStore((state) => state.workspaceFiles);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const trimmed = query.trim();
    const scored = files
      .map((file) => ({ file, score: fuzzyScore(file, trimmed) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.file.length - b.file.length)
      .slice(0, 14);
    return scored.map((item) => item.file);
  }, [files, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>(`[data-index="${index}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [index, open]);

  if (!open) return null;

  const choose = (relative: string) => {
    if (!workspace) return;
    setQuickOpen(false);
    switchMode('ide');
    const absolute = `${workspace.replace(/[\\/]+$/, '')}/${relative}`;
    void useEditorStore.getState().openFile(absolute);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-ink-950/60 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setQuickOpen(false);
      }}
    >
      <div className="w-[min(620px,92vw)] overflow-hidden rounded-lg border border-line-strong bg-ink-800 shadow-panel">
        <div className="flex h-10 items-center gap-2 border-b border-line px-3">
          <Search size={12} className="shrink-0 text-mist-ghost" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((value) => (results.length ? (value + 1) % results.length : 0));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((value) =>
                  results.length ? (value - 1 + results.length) % results.length : 0,
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (results[index]) choose(results[index]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setQuickOpen(false);
              }
            }}
            placeholder={
              workspace ? 'Search files by name…' : 'Open a workspace to search its files'
            }
            spellCheck={false}
            className="h-full min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] text-mist-bright outline-none placeholder:text-mist-ghost"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="thin-scrollbar max-h-[46vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <div className="px-3 py-4 text-center text-[10px] text-mist-ghost">
              {files.length === 0 ? 'No files indexed for this workspace.' : 'No matching files.'}
            </div>
          )}
          {results.map((file, position) => {
            const parts = file.split('/');
            const name = parts.pop() || file;
            const active = position === index;
            return (
              <button
                key={file}
                data-index={position}
                onMouseEnter={() => setIndex(position)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(file)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
                  active ? 'bg-ink-750' : 'hover:bg-ink-750/60',
                )}
              >
                <FileTypeIcon name={file} size={11} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[10.5px] text-mist-bright">
                    {name}
                  </span>
                  <span className="block truncate font-mono text-[8.5px] text-mist-ghost">
                    {parts.join('/') || './'}
                  </span>
                </span>
                {active && <CornerDownLeft size={10} className="shrink-0 text-mist-ghost" />}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 font-mono text-[8px] text-mist-ghost">
          <span>↑↓ navigate</span>
          <span>Enter open</span>
          <span className="ml-auto flex items-center gap-1">
            <FileText size={8} /> {files.length} files
          </span>
        </div>
      </div>
    </div>
  );
}
