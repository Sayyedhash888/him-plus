import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu, RefreshCw, Search } from 'lucide-react';
import type { AgentSession } from '../../types';
import { ensureAcpModels, loadAcpModels, setAcpModel } from '../../lib/actions';
import { useClickOutside } from '../../lib/hooks';
import { cn } from '../../lib/utils';
import { Spinner } from '../ui';

/**
 * Model selector for ACP sessions. The catalog comes from the external agent
 * itself (OpenCode, Copilot, Kiro, ...), not from HIM+'s provider list.
 */
export function AcpModelMenu({
  session,
  compact = false,
  placement = 'up',
}: {
  session: AgentSession;
  compact?: boolean;
  placement?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapperRef, () => setOpen(false), open);

  const models = session.acpModels;

  // Load the agent's catalog automatically the first time an ACP session opens,
  // so the selector shows the real model instead of waiting for a click.
  useEffect(() => {
    if (session.backend !== 'acp' || models) return;
    if (session.status === 'running' || session.status === 'waiting') return;
    ensureAcpModels(session.id);
  }, [session.backend, session.id, session.status, models]);
  const current = models?.availableModels.find(
    (model) => model.modelId === models.currentModelId,
  );
  const filtered = useMemo(() => {
    const list = models?.availableModels || [];
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? list.filter(
          (model) =>
            model.name.toLowerCase().includes(needle) ||
            model.modelId.toLowerCase().includes(needle),
        )
      : list;
    return matched.slice(0, 250);
  }, [models, query]);

  const label = current?.name || models?.currentModelId || 'Load models';
  const total = models?.availableModels.length || 0;

  const load = async () => {
    setBusy(true);
    try {
      await loadAcpModels(session.id);
    } finally {
      setBusy(false);
    }
  };

  const choose = async (modelId: string) => {
    if (modelId === models?.currentModelId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await setAcpModel(session.id, modelId);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative min-w-0">
      <button
        onClick={() => {
          if (!models) {
            void load();
            return;
          }
          setQuery('');
          setOpen((value) => !value);
        }}
        disabled={busy}
        className={cn(
          'flex min-w-0 items-center gap-1 rounded border border-accent/20 bg-accent/[0.05] px-1.5 py-0.5 font-mono text-[8.5px] text-accent-soft transition-colors hover:bg-accent/10 disabled:opacity-60',
          compact ? 'max-w-[170px]' : 'max-w-[240px]',
        )}
        title={
          models
            ? `ACP agent model${total ? ` (${total} available)` : ''}`
            : 'Connect to the ACP agent to load its model list'
        }
      >
        {busy ? <Spinner size={8} /> : <Cpu size={9} className="shrink-0" />}
        <span className="truncate">{label}</span>
        <ChevronDown
          size={9}
          className={cn('shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && models && (
        <div
          className={cn(
            'absolute left-0 z-[90] w-[320px] animate-slide-up overflow-hidden rounded-lg border border-line-strong bg-ink-800 shadow-panel',
            placement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1',
          )}
        >
          <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
            <Search size={10} className="shrink-0 text-mist-ghost" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpen(false);
                }
                if (event.key === 'Enter' && filtered[0]) {
                  event.preventDefault();
                  void choose(filtered[0].modelId);
                }
              }}
              placeholder={`Search ${total} models…`}
              spellCheck={false}
              className="h-6 min-w-0 flex-1 border-0 bg-transparent font-mono text-[10px] text-mist-bright outline-none placeholder:text-mist-ghost"
            />
            <button
              onClick={() => void load()}
              className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
              title="Reload the agent's model list"
              aria-label="Reload ACP models"
            >
              <RefreshCw size={9} className={busy ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="thin-scrollbar max-h-[300px] overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-center text-[9px] text-mist-ghost">
                No matching models.
              </div>
            )}
            {filtered.map((model) => {
              const active = model.modelId === models.currentModelId;
              return (
                <button
                  key={model.modelId}
                  onClick={() => void choose(model.modelId)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left',
                    active ? 'bg-ink-750' : 'hover:bg-ink-750/60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] text-mist-bright">
                      {model.name}
                    </span>
                    <span className="block truncate font-mono text-[8px] text-mist-ghost">
                      {model.modelId}
                    </span>
                    {model.description && (
                      <span className="mt-0.5 block truncate text-[8px] text-mist-ghost">
                        {model.description}
                      </span>
                    )}
                  </span>
                  {active && <Check size={10} className="mt-0.5 shrink-0 text-mint" />}
                </button>
              );
            })}
          </div>
          <div className="border-t border-line px-2 py-1 font-mono text-[8px] text-mist-ghost">
            Model selection is owned by the ACP agent; HIM+ relays your choice.
          </div>
        </div>
      )}
    </div>
  );
}
