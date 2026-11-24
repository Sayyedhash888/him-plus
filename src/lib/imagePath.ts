/**
 * Detects a single local image file path copied from the OS file manager.
 * Windows Explorer puts a plain path (sometimes quoted) on the clipboard, and
 * users reasonably expect Ctrl+V to attach the image rather than paste text.
 */
const IMAGE_EXTENSIONS = 'png|jpe?g|webp|gif|avif|bmp';

const WINDOWS_ABSOLUTE = new RegExp(
  `^["']?(?:[a-zA-Z]:[\\\\/]|\\\\\\\\[^\\\\/]+[\\\\/])[^"']*\\.(?:${IMAGE_EXTENSIONS})["']?$`,
  'i',
);

const POSIX_ABSOLUTE = new RegExp(`^["']?/[^"']*\\.(?:${IMAGE_EXTENSIONS})["']?$`, 'i');

const IMAGE_FILE_EXTENSION = new RegExp(`\\.(?:${IMAGE_EXTENSIONS})$`, 'i');

/** True when a workspace path looks like a raster image file. */
export function isImageFilePath(filePath: string): boolean {
  if (typeof filePath !== 'string') return false;
  return IMAGE_FILE_EXTENSION.test(filePath.trim());
}

export function extractImagePath(text: string): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  if (/[\r\n]/.test(trimmed)) return null;
  if (!WINDOWS_ABSOLUTE.test(trimmed) && !POSIX_ABSOLUTE.test(trimmed)) return null;
  return trimmed.replace(/^["']|["']$/g, '');
}

export function isImagePathText(text: string): boolean {
  return extractImagePath(text) !== null;
}
