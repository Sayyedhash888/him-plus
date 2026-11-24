import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateCheckResult, UpdateInfo } from '../shared/types';
import { isUpdateNewer } from '../shared/version';

/**
 * Minimal update feed support. HIM+ is distributed as a portable Windows build,
 * so it does not auto-install updates. Instead it can read a small JSON manifest
 * and point the user at the latest signed/checksummed release:
 *
 *   { "version": "0.2.0", "url": "https://…/HIM+-win32-x64.zip",
 *     "sha256": "…", "notes": "…" }
 *
 * Manifest location: HIM_UPDATE_MANIFEST_URL env var, or
 * <userData>/update-feed.json with { "manifestUrl": "https://…" }.
 */
function manifestUrl(): string | null {
  const fromEnv = process.env.HIM_UPDATE_MANIFEST_URL?.trim();
  if (fromEnv) return fromEnv;
  try {
    const file = path.join(app.getPath('userData'), 'update-feed.json');
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { manifestUrl?: unknown };
      if (typeof parsed.manifestUrl === 'string' && parsed.manifestUrl.trim()) {
        return parsed.manifestUrl.trim();
      }
    }
  } catch {
    // ignore malformed feed config
  }
  return null;
}

export function updateInfo(): UpdateInfo {
  return {
    version: app.getVersion(),
    feedConfigured: manifestUrl() !== null,
    packaged: app.isPackaged,
  };
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const feed = manifestUrl();
  if (!feed) {
    return {
      configured: false,
      currentVersion,
      updateAvailable: false,
      error:
        'No update feed configured. Set HIM_UPDATE_MANIFEST_URL or create userData/update-feed.json (see README).',
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(feed, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        configured: true,
        currentVersion,
        updateAvailable: false,
        error: `Update feed returned HTTP ${response.status}.`,
      };
    }
    const manifest = (await response.json()) as {
      version?: unknown;
      url?: unknown;
      sha256?: unknown;
      notes?: unknown;
    };
    if (typeof manifest.version !== 'string') {
      return {
        configured: true,
        currentVersion,
        updateAvailable: false,
        error: 'Update feed is missing a version string.',
      };
    }
    return {
      configured: true,
      currentVersion,
      latestVersion: manifest.version,
      updateAvailable: isUpdateNewer(currentVersion, manifest.version),
      url: typeof manifest.url === 'string' ? manifest.url : undefined,
      sha256: typeof manifest.sha256 === 'string' ? manifest.sha256 : undefined,
      notes: typeof manifest.notes === 'string' ? manifest.notes : undefined,
    };
  } catch (error) {
    return {
      configured: true,
      currentVersion,
      updateAvailable: false,
      error: (error as Error).message || 'Could not reach the update feed.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function registerUpdateIpc(): void {
  ipcMain.handle('update:info', () => updateInfo());
  ipcMain.handle('update:check', () => checkForUpdates());
}
