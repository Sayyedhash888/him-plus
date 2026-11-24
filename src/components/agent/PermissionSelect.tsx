import { useRef, useState } from 'react';
import { Check, ChevronDown, Eye, ShieldCheck, Zap } from 'lucide-react';
import type { AgentSession, PermissionMode } from '../../types';
import { cn } from '../../lib/utils';
import { permissionMeta } from '../../lib/agent/prompts';
import { useSessionStore } from '../../store/sessions';
import { useClickOutside } from '../../lib/hooks';

const permissionIcons = {
  plan: Eye,
  review: ShieldCheck,
  auto: Zap,
} as const;

const permissionTone: Record<PermissionMode, string> = {
  plan: 'text-azure',
  review: 'text-accent',
  auto: 'text-mint',
};

export function PermissionSelect({
  session,
  compact = false,
}: {
  session: AgentSession;
  compact?: boolean;
}) {
  const setPermission = useSessionStore((state) => state.setPermission);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const Icon = permissionIcons[session.permission];
  const meta = permissionMeta[session.permission];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-line bg-ink-850/80 text-[10.5px] transition-colors hover:border-line-strong hover:bg-ink-800',
          compact ? 'h-6 px-1.5' : 'h-6 px-2',
          open && 'border-line-strong bg-ink-800',
        )}
        title="Execution mode / permission preset (Shift+Tab)"
      >
        <Icon size={11} className={permissionTone[session.permission]} />
        <span className="font-medium text-mist">{meta.short}</span>
        <ChevronDown
          size={9}
          className={cn('text-mist-ghost transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-[85]"
            onMouseDown={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute bottom-full left-0 z-[90] mb-1.5 w-[300px] animate-slide-up overflow-hidden rounded-lg border border-line-strong bg-ink-800 shadow-panel">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-mist-faint">
                Execution mode
              </span>
              <span className="font-mono text-[8.5px] text-mist-ghost">Shift+Tab</span>
            </div>
            <div className="p-1.5">
              {(Object.keys(permissionMeta) as PermissionMode[]).map((mode) => {
                const ModeIcon = permissionIcons[mode];
                const active = session.permission === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => {
                      setPermission(session.id, mode);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                      active ? 'bg-ink-750' : 'hover:bg-ink-750/60',
                    )}
                  >
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-ink-850">
                      <ModeIcon size={11} className={permissionTone[mode]} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-mist-bright">
                          {permissionMeta[mode].label}
                        </span>
                        {mode === 'review' && (
                          <span className="rounded border border-accent/20 bg-accent/[0.06] px-1 py-px text-[7.5px] uppercase tracking-[0.1em] text-accent">
                            default
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[9.5px] leading-relaxed text-mist-faint">
                        {permissionMeta[mode].description}
                      </div>
                    </div>
                    {active && <Check size={11} className="mt-1 shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
