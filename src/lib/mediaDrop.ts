import type { ChatAttachment, SaveAttachmentResult } from '@shared/types';
import { him } from './bridge';
import { isImageFile, persistImageFile } from './agent/attachments';
import { extractImagePath } from './imagePath';
import { useAgentUiStore } from '../store/agentUi';
import { useCoreStore } from '../store/core';
import { useEditorStore } from '../store/editor';
import { useSessionStore } from '../store/sessions';
import { toast } from '../store/toast';

export function filesFromDataTransfer(
  transfer: DataTransfer | null | undefined,
): File[] {
  if (!transfer) return [];
  const files: File[] = [];
  if (transfer.files && transfer.files.length > 0) {
    files.push(...Array.from(transfer.files));
  }
  if (files.length === 0 && transfer.items) {
    for (const item of Array.from(transfer.items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

export function imageFilesFrom(files: File[]): File[] {
  return files.filter(isImageFile);
}

export function attachmentFromSaved(saved: SaveAttachmentResult): ChatAttachment {
  return {
    id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'image',
    name: saved.name,
    mime: saved.mime,
    size: saved.size,
    path: saved.path,
  };
}

function activeSession() {
  const state = useSessionStore.getState();
  return state.sessions.find((session) => session.id === state.activeId) || null;
}

/** In IDE mode make sure the agent chat panel is visible before attaching. */
function ensureChatSurface(): void {
  if (useCoreStore.getState().mode === 'ide') {
    useEditorStore.getState().setAiPanelOpen(true);
  }
}

function attachToSession(items: ChatAttachment[], sessionTitle: string): void {
  useAgentUiStore.getState().queueMedia(items, useSessionStore.getState().activeId);
  toast(
    'success',
    `${items.length} image${items.length === 1 ? '' : 's'} attached to “${sessionTitle}”.`,
    'Image attached',
  );
}

/** Persists image files dropped anywhere in the app onto the active agent chat. */
export async function attachImageFilesToActiveSession(files: File[]): Promise<boolean> {
  const images = imageFilesFrom(files);
  if (images.length === 0) return false;
  const session = activeSession();
  if (!session) {
    toast('info', 'Select an agent session before attaching images.', 'No agent selected');
    return false;
  }
  ensureChatSurface();
  const attachments: ChatAttachment[] = [];
  for (const file of images) {
    try {
      attachments.push(await persistImageFile(file));
    } catch (error) {
      toast(
        'error',
        (error as Error).message || 'Could not attach that image.',
        'Attach failed',
      );
    }
  }
  if (attachments.length === 0) return false;
  attachToSession(attachments, session.title);
  return true;
}

/** Imports image files copied in Explorer/Finder (clipboard text is a path). */
export async function importImagePathsToActiveSession(paths: string[]): Promise<boolean> {
  const clean: string[] = [];
  for (const raw of paths) {
    const extracted = extractImagePath(raw);
    if (extracted) clean.push(extracted);
  }
  if (clean.length === 0) return false;
  const session = activeSession();
  if (!session) {
    toast('info', 'Select an agent session before attaching images.', 'No agent selected');
    return false;
  }
  ensureChatSurface();
  try {
    const saved = await him.attachments.importPaths(clean);
    if (saved.length === 0) {
      toast('error', 'That file could not be read as an image.', 'Attach failed');
      return false;
    }
    attachToSession(saved.map(attachmentFromSaved), session.title);
    return true;
  } catch (error) {
    toast('error', (error as Error).message || 'Could not import image.', 'Attach failed');
    return false;
  }
}
