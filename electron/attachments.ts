import { app, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SaveAttachmentResult } from '../shared/types';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const EXT_FOR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

const MIME_FOR_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

export function attachmentsDir(): string {
  return path.join(app.getPath('userData'), 'attachments');
}

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  if (typeof dataUrl !== 'string') throw new Error('Attachment payload is not a string.');
  const match = /^data:([a-zA-Z0-9.+/-]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Attachment must be a base64 data URL.');
  const mime = match[1].toLowerCase();
  if (!EXT_FOR_MIME[mime]) throw new Error(`Unsupported attachment type: ${mime}`);
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) throw new Error('Attachment is empty.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachment is too large (${(bytes.length / 1024 / 1024).toFixed(1)} MB). The limit is 20 MB.`,
    );
  }
  return { mime, bytes };
}

function safeName(raw: string | undefined, mime: string): string {
  const ext = EXT_FOR_MIME[mime] || 'png';
  const base = (raw || 'attachment')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80);
  const stem = base.replace(/\.[a-zA-Z0-9]+$/, '') || 'attachment';
  return `${stem}.${ext}`;
}

/** True only for paths that live inside the app's attachment directory. */
function isInsideAttachments(filePath: string): boolean {
  const root = path.resolve(attachmentsDir());
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function saveAttachment(
  dataUrl: string,
  name?: string,
): Promise<SaveAttachmentResult> {
  const { mime, bytes } = decodeDataUrl(dataUrl);
  const dir = attachmentsDir();
  await fs.mkdir(dir, { recursive: true });
  const fileName = safeName(name, mime);
  // Keep the original name readable while guaranteeing uniqueness.
  const id = randomUUID().slice(0, 8);
  const target = path.join(dir, `${Date.now().toString(36)}-${id}-${fileName}`);
  await fs.writeFile(target, bytes);
  return { path: target, name: fileName, mime, size: bytes.length };
}

export async function readAttachment(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Attachment path is required.');
  }
  if (!isInsideAttachments(filePath)) {
    throw new Error('Refusing to read a file outside the attachment store.');
  }
  const bytes = await fs.readFile(filePath);
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachment exceeds the 20 MB read limit.');
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = MIME_FOR_EXT[ext] || 'application/octet-stream';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** Reads a persisted image for an outgoing provider/ACP prompt (raw base64). */
export async function readAttachmentImage(
  filePath: string,
): Promise<{ mime: string; data: string }> {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Attachment path is required.');
  }
  if (!isInsideAttachments(filePath)) {
    throw new Error('Refusing to read a file outside the attachment store.');
  }
  const bytes = await fs.readFile(filePath);
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachment exceeds the 20 MB read limit.');
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = MIME_FOR_EXT[ext];
  if (!mime) throw new Error(`Unsupported attachment type ".${ext}".`);
  return { mime, data: bytes.toString('base64') };
}

/** Copies image files from arbitrary local paths into the attachment store. */
export async function importAttachmentFiles(paths: unknown): Promise<SaveAttachmentResult[]> {
  if (!Array.isArray(paths)) throw new Error('Provide an array of file paths.');
  const results: SaveAttachmentResult[] = [];
  for (const raw of paths.slice(0, 12)) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const resolved = path.resolve(raw.trim());
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_ATTACHMENT_BYTES) continue;
      const ext = path.extname(resolved).slice(1).toLowerCase();
      const mime = MIME_FOR_EXT[ext];
      if (!mime) continue;
      const bytes = await fs.readFile(resolved);
      const dir = attachmentsDir();
      await fs.mkdir(dir, { recursive: true });
      const fileName = safeName(path.basename(resolved), mime);
      const target = path.join(
        dir,
        `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}-${fileName}`,
      );
      await fs.writeFile(target, bytes);
      results.push({
        path: target,
        name: path.basename(resolved),
        mime,
        size: bytes.length,
      });
    } catch {
      // Skip unreadable or invalid files; the caller attaches what it can.
    }
  }
  return results;
}

export function registerAttachmentIpc(): void {
  ipcMain.handle('attachments:save', (_event, dataUrl: string, name?: string) =>
    saveAttachment(dataUrl, name),
  );
  ipcMain.handle('attachments:read', (_event, filePath: string) => readAttachment(filePath));
  ipcMain.handle('attachments:import', (_event, paths: string[]) =>
    importAttachmentFiles(paths),
  );
}

/** Exposed for tests. */
export const attachmentLimits = { MAX_ATTACHMENT_BYTES };
