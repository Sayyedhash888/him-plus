import { useEffect } from 'react';
import { playTypingSound, primeTypingSounds, type TypingSound } from './keyboardSound';

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'file',
  'hidden',
  'image',
  'month',
  'radio',
  'range',
  'reset',
  'submit',
  'time',
  'week',
]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled;
  }

  if (target instanceof HTMLInputElement) {
    return !target.readOnly && !target.disabled && !NON_TEXT_INPUT_TYPES.has(target.type);
  }

  if (target.isContentEditable) return true;

  const editableParent = target.closest('[contenteditable="true"]');
  if (editableParent) return true;

  // Monaco and xterm keep focus inside their editor surfaces.
  return Boolean(target.closest('.monaco-editor, .xterm'));
}

export function useKeyboardSound(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    primeTypingSounds();

    const handler = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!isTypingTarget(event.target)) return;

      let sound: TypingSound | null = null;
      if (event.code === 'Space' || event.key === ' ') sound = 'space';
      else if (event.key === 'Enter') sound = 'enter';
      else if (event.key === 'Backspace') sound = 'backspace';
      else if (event.key.length === 1) sound = 'key';

      if (sound) playTypingSound(sound);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled]);
}