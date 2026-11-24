import { useRef, useState } from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { THEMES, applyThemeCss, getTheme } from '../lib/themes';
import { useConfigStore } from '../store/config';
import { useClickOutside } from '../lib/hooks';
import { cn } from '../lib/utils';

function ThemeSwatch({ themeId }: { themeId: string }) {
  const theme = getTheme(themeId);
  return (
    <span
      className="flex h-3.5 w-6 shrink-0 overflow-hidden rounded-[2px] border border-line"
      style={{ background: theme.colors.ink900 }}
    >
      <span className="h-full w-1/3" style={{ background: theme.colors.accent }} />
      <span className="h-full w-1/3" style={{ background: theme.colors.mint }} />
      <span className="h-full w-1/3" style={{ background: theme.colors.coral }} />
    </span>
  );
}

export function ThemeMenu() {
  const config = useConfigStore((state) => state.config);
  const setPrefs = useConfigStore((state) => state.setPrefs);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const current = getTheme(config?.prefs.theme);

  const choose = (id: string) => {
    const theme = getTheme(id);
    applyThemeCss(theme);
    setPrefs({ theme: id });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative app-no-drag">
      <button
        data-testid="theme-menu"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-md border border-line bg-ink-850/70 px-1.5 text-[10px] text-mist-faint transition-colors hover:border-line-strong hover:bg-ink-800 hover:text-mist',
          open && 'border-line-strong bg-ink-800 text-mist',
        )}
        title={`Theme: ${current.name}`}
      >
        <Palette size={11} />
        <ThemeSwatch themeId={current.id} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-[70]"
            onMouseDown={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full z-[80] mt-1.5 w-[292px] animate-slide-down overflow-hidden rounded-lg border border-line-strong bg-ink-800 shadow-panel">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Palette size={11} className="text-accent" />
                <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-mist-faint">
                  Theme
                </span>
              </div>
              <span className="font-mono text-[8px] text-mist-ghost">{THEMES.length} presets</span>
            </div>
            <div className="p-1.5">
              {THEMES.map((theme) => {
                const active = current.id === theme.id;
                return (
                  <button
                    key={theme.id}
                    data-theme-option={theme.id}
                    onClick={() => choose(theme.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                      active ? 'bg-ink-750' : 'hover:bg-ink-750/60',
                    )}
                  >
                    <ThemeSwatch themeId={theme.id} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10.5px] font-medium text-mist-bright">
                          {theme.name}
                        </span>
                        {theme.tag && (
                          <span className="rounded border border-line px-1 text-[7px] uppercase tracking-[0.1em] text-mist-faint">
                            {theme.tag}
                          </span>
                        )}
                        {theme.mode === 'light' ? (
                          <Sun size={8} className="text-sand" />
                        ) : (
                          <Moon size={8} className="text-azure" />
                        )}
                      </div>
                      <div className="truncate text-[8.5px] text-mist-ghost">{theme.blurb}</div>
                    </div>
                    {active && <Check size={11} className="shrink-0 text-accent" />}
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
