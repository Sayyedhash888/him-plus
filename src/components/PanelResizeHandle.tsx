import { cn } from '../lib/utils';

/** Vertical drag handle for resizable panels. Double-click resets the width. */
export function PanelResizeHandle({
  onStart,
  onReset,
  className,
}: {
  onStart(event: React.MouseEvent): void;
  onReset(): void;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize panel"
      title="Drag to resize · double-click to reset"
      onMouseDown={onStart}
      onDoubleClick={onReset}
      className={cn(
        'group relative z-20 -mx-px w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/25 active:bg-accent/40',
        className,
      )}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/30" />
    </div>
  );
}
