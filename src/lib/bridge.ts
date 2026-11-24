import type { HimApi } from '@shared/types';

declare global {
  interface Window {
    him: HimApi;
  }
}

export const him: HimApi = window.him;

export function cleanErrorMessage(error: unknown): string {
  let message = '';
  if (typeof error === 'string') message = error;
  else if (error instanceof Error) message = error.message;
  else if (error && typeof error === 'object' && 'message' in error) {
    message = String((error as { message: unknown }).message);
  } else message = String(error ?? 'Unknown error');

  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
}

export async function guarded<T>(promise: Promise<T>, onError: (message: string) => void): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    onError(cleanErrorMessage(error));
    return undefined;
  }
}
