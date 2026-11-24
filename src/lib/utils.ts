import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';

export function cn(...values: ClassValue[]): string {
  return clsx(values);
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function basename(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

export function dirname(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

export function joinPath(root: string, relative: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanRel = relative.replace(/^[\\/]+/, '');
  return `${cleanRoot}/${cleanRel}`.replace(/\\/g, '/');
}

export function relativeTo(root: string, target: string): string {
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const normTarget = target.replace(/\\/g, '/');
  if (normTarget.toLowerCase().startsWith(`${normRoot}/`)) {
    return normTarget.slice(normRoot.length + 1);
  }
  return normTarget;
}

export function languageForPath(filePath: string): string {
  const name = basename(filePath).toLowerCase();
  const extension = name.includes('.') ? name.split('.').pop() || '' : '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    md: 'markdown',
    mdx: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    ini: 'ini',
    xml: 'xml',
    svg: 'xml',
    sql: 'sql',
    graphql: 'graphql',
    vue: 'html',
    svelte: 'html',
  };
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  if (name.startsWith('.env')) return 'ini';
  return map[extension] || 'plaintext';
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

export function formatCost(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  if (value === 0) return '$0.00';
  if (value < 0.0001) return '<$0.0001';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function shortModelName(modelId: string): string {
  if (!modelId) return '';
  const parts = modelId.split('/');
  const last = parts[parts.length - 1] || modelId;
  return last.replace(/^[a-z0-9-]+@/, '').slice(0, 42);
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function stripCodeFences(input: string): string {
  let text = input.trim();
  const fenceMatch = text.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/);
  if (fenceMatch) text = fenceMatch[1].trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
    text = text.replace(/\n?```\s*$/, '');
  }
  return text.trimEnd();
}

export function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

export function fileExtension(filePath: string): string {
  const name = basename(filePath);
  return name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
}

export function smoothScrollIntoView(element: HTMLElement | null, behavior: ScrollBehavior = 'smooth') {
  element?.scrollIntoView({ behavior, block: 'end' });
}
