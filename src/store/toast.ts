import { create } from 'zustand';
import { uid } from '../lib/utils';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  title?: string;
}

interface ToastStore {
  toasts: ToastItem[];
  push(kind: ToastKind, message: string, title?: string): string;
  dismiss(id: string): void;
}

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],
  push: (kind, message, title) => {
    const id = uid('toast');
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, kind, message, title }] }));
    setTimeout(
      () => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
      kind === 'error' ? 6000 : 3600,
    );
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export function toast(kind: ToastKind, message: string, title?: string): void {
  useToastStore.getState().push(kind, message, title);
}
