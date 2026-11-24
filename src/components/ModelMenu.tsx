import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Cpu,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { useConfigStore, providerModelOptions, resolveDefaultModel } from '../store/config';
import { useSessionStore } from '../store/sessions';
import { useCoreStore } from '../store/core';
import { cn, shortModelName } from '../lib/utils';
import { effectiveModelFor } from '../lib/agent/runtime';
import { useClickOutside } from '../lib/hooks';

export function ModelMenu({
  variant = 'bar',
  placement,
  compact = false,
}: {
  variant?: 'bar' | 'status';
  placement?: 'up' | 'down';
  compact?: boolean;
}) {
  const config = useConfigStore((state) => state.config);
  const setSettingsOpen = useCoreStore((state) => state.setSettingsOpen);
  const sessions = useSessionStore((state) => state.sessions);
  const activeId = useSessionStore((state) => state.activeId);
  const setModel = useSessionStore((state) => state.setModel);
  const setDefault = useConfigStore((state) => state.setDefault);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const activeSession = sessions.find((session) => session.id === activeId) || null;
  const effective = activeSession
    ? effectiveModelFor(activeSession)
    : resolveDefaultModel(config, 'primary');
  const options = providerModelOptions(config);
  const filtered = options.filter((option) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      option.model.id.toLowerCase().includes(q) ||
      option.provider.name.toLowerCase().includes(q)
    );
  });
  const groups = new Map<string, typeof filtered>();
  for (const option of filtered) {
    const list = groups.get(option.provider.name) || [];
    list.push(option);
    groups.set(option.provider.name, list);
  }

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const choose = (providerId: string, modelId: string) => {
    const refValue = { providerId, modelId };
    setDefault('primary', refValue);
    if (activeSession) setModel(activeSession.id, refValue);
    setOpen(false);
  };

  const clearOverride = () => {
    if (activeSession) setModel(activeSession.id, null);
    setOpen(false);
  };

  const isPlanDefault =
    activeSession?.permission === 'plan' && !activeSession.model && options.length > 0;

  const button = (
    <button
      onClick={() => setOpen((value) => !value)}
      className={cn(
        'app-no-drag group flex min-w-0 items-center gap-1.5 transition-colors',
        variant === 'bar'
          ? cn(
              'h-7 rounded-md border border-line bg-ink-850/70 px-2 hover:border-line-strong hover:bg-ink-800',
              compact ? 'max-w-[150px]' : 'max-w-[230px]',
            )
          : 'h-full px-2 hover:bg-ink-800',
      )}
      title={effective ? `${effective.provider.name} · ${effective.model.id}` : 'Select a model'}
    >
      <Cpu
        size={12}
        className={cn(
          'shrink-0',
          effective ? 'text-accent-dim group-hover:text-accent' : 'text-mist-faint',
        )}
      />
      <span
        className={cn(
          'min-w-0 truncate font-mono',
          variant === 'bar' ? 'text-[10.5px]' : 'text-[10px]',
          effective ? 'text-mist' : 'text-accent-soft',
        )}
      >
        {effective ? shortModelName(effective.model.id) : 'Connect model'}
      </span>
      {isPlanDefault && (
        <span className="shrink-0 rounded border border-line bg-ink-750 px-1 py-px text-[8.5px] uppercase tracking-wide text-mist-faint">
          plan
        </span>
      )}
      <ChevronDown
        size={10}
        className={cn(
          'shrink-0 text-mist-ghost transition-transform duration-150',
          open && 'rotate-180',
          variant === 'status' && 'hidden sm:block',
        )}
      />
    </button>
  );

  return (
    <div ref={ref} className={cn('relative app-no-drag', variant === 'status' && 'h-full')}>
      {button}
      {open && (
        <>
          <div
            className="fixed inset-0 z-[70]"
            onMouseDown={() => setOpen(false)}
            aria-hidden
          />
          <div
            className={cn(
              'absolute right-0 z-[80] w-[320px] animate-slide-down overflow-hidden rounded-lg border border-line-strong bg-ink-800 shadow-panel',
              variant === 'bar' && placement !== 'up' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
            )}
          >
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Sparkles size={11} className="text-accent" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist-dim">
                  Active model
                </span>
              </div>
              <span className="font-mono text-[9px] text-mist-ghost">
                {options.length} enabled
              </span>
            </div>
            {options.length > 7 && (
              <div className="border-b border-line px-2.5 py-2">
                <div className="relative">
                  <Search
                    size={11}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-mist-faint"
                  />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter enabled models…"
                    className="h-6 w-full rounded border border-line bg-ink-900 pl-6 pr-2 text-[10.5px] text-mist-bright placeholder:text-mist-ghost focus:border-accent/40 focus:outline-none"
                  />
                </div>
              </div>
            )}
            <div className="thin-scrollbar max-h-[290px] overflow-y-auto p-1.5">
              {options.length === 0 && (
                <div className="p-4 text-center">
                  <p className="text-[11px] leading-relaxed text-mist-dim">
                    No enabled models yet. Add a provider, fetch its catalog and toggle on the
                    models you want.
                  </p>
                  <button
                    onClick={() => {
                      setOpen(false);
                      setSettingsOpen(true);
                    }}
                    className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2.5 text-[10.5px] font-medium text-accent-soft hover:bg-accent/15"
                  >
                    <Settings2 size={11} /> Open provider manager
                  </button>
                </div>
              )}
              {[...groups.entries()].map(([providerName, providerOptions]) => (
                <div key={providerName} className="mb-1">
                  <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-mist-ghost">
                    {providerName}
                  </div>
                  {providerOptions.map((option) => {
                    const selected =
                      effective?.ref.providerId === option.provider.id &&
                      effective?.ref.modelId === option.model.id;
                    return (
                      <button
                        key={`${option.provider.id}:${option.model.id}`}
                        onClick={() => choose(option.provider.id, option.model.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                          selected
                            ? 'bg-ink-750 text-mist-bright'
                            : 'text-mist hover:bg-ink-750/60',
                        )}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {selected && <Check size={11} className="text-accent" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]">
                          {option.model.id}
                        </span>
                        {option.model.source === 'manual' && (
                          <span className="shrink-0 rounded border border-line px-1 text-[8px] uppercase tracking-wide text-mist-ghost">
                            manual
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {options.length > 0 && filtered.length === 0 && (
                <div className="p-4 text-center text-[11px] text-mist-faint">
                  No models match "{query}".
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-line bg-ink-850/50 px-2 py-1.5">
              <div>
                {activeSession?.model && (
                  <button
                    onClick={clearOverride}
                    className="rounded px-1.5 py-1 text-[9.5px] text-mist-faint hover:bg-ink-750 hover:text-mist"
                  >
                    Use workspace defaults
                  </button>
                )}
                {isPlanDefault && (
                  <span className="px-1.5 text-[9px] text-mist-ghost">
                    Plan mode uses the Planning default
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  setSettingsOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[9.5px] font-medium text-mist-faint hover:bg-ink-750 hover:text-mist"
              >
                <Settings2 size={10} /> Manage
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
