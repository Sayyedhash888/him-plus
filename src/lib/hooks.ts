import { useEffect, type RefObject } from 'react';

export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: () => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const listener = (event: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(event.target as Node)) return;
      handler();
    };
    const keyListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handler();
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('keydown', keyListener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('keydown', keyListener);
    };
  }, [active, handler, ref]);
}

export function useInterval(callback: () => void, delay: number | null): void {
  useEffect(() => {
    if (delay === null) return;
    const id = window.setInterval(callback, delay);
    return () => window.clearInterval(id);
  }, [callback, delay]);
}
