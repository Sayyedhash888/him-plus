import { ipcMain } from 'electron';
import type { WebFetchResult } from '../shared/types';

const MAX_DOWNLOAD_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const FETCH_TIMEOUT_MS = 20_000;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const value = Number(code);
      return Number.isFinite(value) && value > 0 && value < 0x10ffff
        ? String.fromCodePoint(value)
        : '';
    });
}

function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim() : '';
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  body = decodeEntities(body)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text: body };
}

function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('The URL is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs can be fetched.');
  }
  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed.');
  }
  return url;
}

export async function fetchWebPage(rawUrl: string): Promise<WebFetchResult> {
  const url = validateUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HIM+/0.1 (+local AI IDE)',
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5',
      },
    });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    let raw = '';
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let downloaded = 0;
      while (downloaded < MAX_DOWNLOAD_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        downloaded += value.byteLength;
        raw += decoder.decode(value, { stream: true });
        if (downloaded >= MAX_DOWNLOAD_BYTES) {
          raw += '\n[... response truncated at 3 MB ...]';
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
      raw += decoder.decode();
    }

    let title = '';
    let text = raw;
    if (contentType.includes('html') || /<html[\s>]/i.test(raw.slice(0, 500))) {
      const parsed = htmlToText(raw);
      title = parsed.title;
      text = parsed.text;
    }
    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS);
    return {
      url: response.url || url.toString(),
      status: response.status,
      ok: response.ok,
      contentType,
      title,
      text,
      truncated,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Fetching ${url.toString()} timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`);
    }
    const message = (error as Error)?.message || 'unknown error';
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ECONNRESET|EAI_AGAIN/i.test(message)) {
      throw new Error(`Could not reach ${url.toString()}: ${message}`);
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function registerWebIpc(): void {
  ipcMain.handle('web:fetch', (_event, url: string) => fetchWebPage(url));
}
