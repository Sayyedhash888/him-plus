import type { ChatAttachment, LlmImagePart } from '@shared/types';
import type { ChatEntry } from '../../types';
import { him } from '../bridge';

/** 20 MB, matching the main-process attachment store limit. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_CACHE_SIZE = 24;

const dataUrlCache = new Map<string, string>();

export function isImageMime(mime: string): boolean {
  return /^image\//i.test(mime || '');
}

export function isImageFile(file: File): boolean {
  if (isImageMime(file.type)) return true;
  return /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name || '');
}

export function dataUrlFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name || 'the image'}.`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && result.startsWith('data:')) resolve(result);
      else reject(new Error('The selected file is not a valid image.'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Copies a pasted or dropped image into the app's attachment store so the
 * conversation can replay it later, even after a restart.
 */
export async function persistImageFile(file: File): Promise<ChatAttachment> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The limit is 20 MB.`,
    );
  }
  const dataUrl = await dataUrlFromFile(file);
  const saved = await him.attachments.save(dataUrl, file.name || 'pasted-image.png');
  return {
    id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'image',
    name: saved.name,
    mime: saved.mime,
    size: saved.size,
    path: saved.path,
  };
}

export async function dataUrlForAttachment(
  attachment: ChatAttachment,
): Promise<string | null> {
  if (attachment.kind !== 'image' || !attachment.path) return null;
  const cached = dataUrlCache.get(attachment.path);
  if (cached) return cached;
  try {
    const dataUrl = await him.attachments.read(attachment.path);
    if (!dataUrl.startsWith('data:image/')) return null;
    if (dataUrlCache.size >= IMAGE_CACHE_SIZE) {
      const oldest = dataUrlCache.keys().next().value;
      if (oldest) dataUrlCache.delete(oldest);
    }
    dataUrlCache.set(attachment.path, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

export async function buildImageParts(
  media: ChatAttachment[] | undefined,
): Promise<LlmImagePart[]> {
  if (!media || media.length === 0) return [];
  const parts: LlmImagePart[] = [];
  for (const attachment of media) {
    if (attachment.kind !== 'image') continue;
    const url = await dataUrlForAttachment(attachment);
    if (url) parts.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
  }
  return parts;
}

/**
 * Pre-resolves image attachments for every user turn in the transcript, keyed
 * by message id. Called once per agent turn so provider payloads can include
 * images without re-reading disk on every tool round.
 */
export async function resolveImageParts(
  entries: ChatEntry[],
): Promise<Map<string, LlmImagePart[]>> {
  const map = new Map<string, LlmImagePart[]>();
  for (const entry of entries) {
    if (entry.role !== 'user' || !entry.media?.length) continue;
    if (!entry.media.some((item) => item.kind === 'image')) continue;
    const parts = await buildImageParts(entry.media);
    if (parts.length > 0) map.set(entry.id, parts);
  }
  return map;
}

export function clearAttachmentCache(): void {
  dataUrlCache.clear();
}
