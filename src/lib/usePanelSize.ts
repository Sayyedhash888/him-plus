import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'him.panel.';

export interface PanelSizeOptions {
  /** Stable storage key, e.g. "ide.sidebar". */
  key: string;
  initial: number;
  min: number;
  max: number;
  /** "left": dragging right grows the panel; "right": dragging left grows it. */
  side: 'left' | 'right';
}

export interface PanelSizeResult {
  size: number;
  startResize(event: React.MouseEvent): void;
  reset(): void;
}

/**
 * Drag-to-resize state for a docked panel, persisted in localStorage so the
 * layout survives restarts. Width is clamped between min and max.
 */
export function usePanelSize({ key, initial, min, max, side }: PanelSizeOptions): PanelSizeResult {
  const clamp = useCallback(
    (value: number) => Math.max(min, Math.min(max, Math.round(value))),
    [min, max],
  );

  const [size, setSize] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
      const parsed = raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(parsed) ? clamp(parsed) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, String(size));
    } catch {
      // Storage can be unavailable; the layout still works for this session.
    }
  }, [key, size]);

  const drag = useRef<{ startX: number; startSize: number } | null>(null);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!drag.current) return;
      const delta = event.clientX - drag.current.startX;
      setSize(clamp(side === 'left' ? drag.current.startSize + delta : drag.current.startSize - delta));
    };
    const handleUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [clamp, side]);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    drag.current = { startX: event.clientX, startSize: size };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  return { size, startResize, reset: () => setSize(initial) };
}
