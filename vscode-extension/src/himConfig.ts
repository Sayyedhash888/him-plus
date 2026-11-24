import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface HimModelEntry {
  id: string;
  enabled: boolean;
}

export interface HimProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  models: HimModelEntry[];
}

export interface HimModelRef {
  providerId: string;
  modelId: string;
}

/**
 * An external agent profile, as the HIM+ desktop app stores it.
 *
 * ACP and CLI profiles have the same shape; only how they are driven differs —
 * ACP speaks JSON-RPC over the child's stdio, a CLI agent is just spawned. Both
 * are configured in HIM+ → Settings → Integrations, so the extension reads them
 * rather than keeping a second list.
 */
export interface HimAgentProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  /** Marks a built-in default the app ships (e.g. the `freebuff` CLI entry). */
  preset?: string;
}

export interface HimConfig {
  providers: HimProvider[];
  defaults: {
    primary: HimModelRef | null;
    fast: HimModelRef | null;
    planning: HimModelRef | null;
  };
  fim: {
    enabled: boolean;
    mode: 'fim' | 'chat';
    model: HimModelRef | null;
  };
  /** External agents the desktop app is configured with. Absent in older files. */
  acpAgents?: HimAgentProfile[];
  cliAgents?: HimAgentProfile[];
}

export interface ResolvedHimModel {
  provider: HimProvider;
  model: HimModelEntry;
  label: string;
}

export function defaultHimConfigPath(override = ''): string {
  if (override.trim()) return path.resolve(override.trim());
  if (process.env.HIM_CONFIG_DIR) return path.join(process.env.HIM_CONFIG_DIR, 'config.json');
  const appData =
    process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(appData, 'HIM+', 'config.json');
}

export function readHimConfig(override = ''): HimConfig | null {
  try {
    return JSON.parse(fs.readFileSync(defaultHimConfigPath(override), 'utf8')) as HimConfig;
  } catch {
    return null;
  }
}

/*
 * ---------------------------------------------------------------------------
 * At-rest API keys
 * ---------------------------------------------------------------------------
 * The HIM+ desktop app persists provider keys encrypted:
 *
 *   providers[].apiKey === 'enc:' + base64('v10' | nonce(12) | ciphertext | tag(16))
 *
 * The AES-256-GCM key for that payload is itself wrapped with Windows DPAPI and
 * kept in Electron's `<userData>/Local State` as
 * `os_crypt.encrypted_key` = base64('DPAPI' | dpapiBlob).
 *
 * The extension host is a plain Node process: no DPAPI, no `require('electron')`.
 * Without unwrapping, `requestHeaders()` sends the literal ciphertext as a bearer
 * token and every call fails with HTTP 401 "invalid_api_key" — chat and inline
 * completions alike. So the key is unwrapped in PowerShell (crypt32 lives there
 * and nowhere else in a bare Node host) and the payload is decrypted with
 * node:crypto's aes-256-gcm, which is also why the PowerShell step stops after
 * the DPAPI unwrap: `AesGcm` does not exist on Windows PowerShell 5.1.
 */

const ENC_PREFIX = 'enc:';
const SAFE_STORAGE_VERSION = 3; // 'v10'
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DPAPI_MARKER = 'DPAPI';
const UNWRAP_TIMEOUT_MS = 8000;

/** Reads the DPAPI blob on argv; writes the unwrapped AES key to stdout as base64. */
const DPAPI_SCRIPT = String.raw`param([string]$base64)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DpapiInterop {
  [StructLayout(LayoutKind.Sequential)] public struct DATA_BLOB { public int cbData; public IntPtr pbData; }
  [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CryptUnprotectData(ref DATA_BLOB pDataIn, IntPtr ppszDataDescr, ref DATA_BLOB pOptionalEntropy, IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, out DATA_BLOB pDataOut);
  [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr hMem);
  public static byte[] Unprotect(byte[] data) {
    DATA_BLOB input = new DATA_BLOB(); DATA_BLOB output = new DATA_BLOB(); DATA_BLOB entropy = new DATA_BLOB();
    input.cbData = data.Length; input.pbData = Marshal.AllocHGlobal(data.Length);
    try {
      Marshal.Copy(data, 0, input.pbData, data.Length);
      entropy.cbData = 0; entropy.pbData = IntPtr.Zero;
      if (!CryptUnprotectData(ref input, IntPtr.Zero, ref entropy, IntPtr.Zero, IntPtr.Zero, 0, out output))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      byte[] result = new byte[output.cbData];
      Marshal.Copy(output.pbData, result, 0, output.cbData);
      return result;
    } finally {
      if (input.pbData != IntPtr.Zero) Marshal.FreeHGlobal(input.pbData);
      if (output.pbData != IntPtr.Zero) LocalFree(output.pbData);
    }
  }
}
'@
$wrapped = [Convert]::FromBase64String($base64)
if ($wrapped.Length -gt 5 -and [System.Text.Encoding]::ASCII.GetString($wrapped, 0, 5) -eq 'DPAPI') {
  $blob = New-Object byte[] ($wrapped.Length - 5)
  [Array]::Copy($wrapped, 5, $blob, 0, $blob.Length)
} else { $blob = $wrapped }
Write-Output ([Convert]::ToBase64String([DpapiInterop]::Unprotect($blob)))
`;

let dpapiScriptPath: string | null = null;
let localKeyCache: { source: string; key: Buffer } | null = null;
const apiKeyCache = new Map<string, string>();

/** `<userData>/Local State`, next to the `config.json` the app writes. */
function localStatePath(configDir: string): string {
  return path.join(configDir, 'Local State');
}

function dpapiScript(): string {
  if (dpapiScriptPath && fs.existsSync(dpapiScriptPath)) return dpapiScriptPath;
  const target = path.join(os.tmpdir(), 'him-plus-dpapi-unwrap.ps1');
  fs.writeFileSync(target, DPAPI_SCRIPT, 'utf8');
  dpapiScriptPath = target;
  return target;
}

function runPowerShell(script: string, argument: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, argument],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out unwrapping the HIM+ API key.'));
    }, UNWRAP_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) resolve(stdout.trim());
      else reject(new Error(stderr.trim().slice(0, 300) || `powershell exit ${code}`));
    });
  });
}

/** The AES-256-GCM key safeStorage uses, unwrapped from `Local State`. */
async function localAesKey(configDir: string): Promise<Buffer | null> {
  let raw: string;
  try {
    raw = fs.readFileSync(localStatePath(configDir), 'utf8');
  } catch {
    return null;
  }
  // Keyed on file contents so a re-saved key is picked up. Only successes are
  // cached: caching a miss would poison the window if the file appeared later.
  if (localKeyCache?.source === raw) return localKeyCache.key;
  if (process.platform !== 'win32') return null;

  let wrapped: string;
  try {
    const parsed = JSON.parse(raw) as { os_crypt?: { encrypted_key?: string } };
    wrapped = String(parsed?.os_crypt?.encrypted_key || '');
  } catch {
    return null;
  }
  if (!wrapped) return null;
  if (Buffer.from(wrapped, 'base64').subarray(0, 5).toString('ascii') !== DPAPI_MARKER) return null;

  let key: Buffer;
  try {
    key = Buffer.from(await runPowerShell(dpapiScript(), wrapped), 'base64');
  } catch {
    // A transient DPAPI failure must not disable HIM+ keys for the session.
    return null;
  }
  if (key.length !== 32) return null;

  localKeyCache = { source: raw, key };
  return key;
}

/** Pure AES-256-GCM unwrap of an `enc:` payload. Exported for tests. */
export function decryptEncPayload(stored: string, aesKey: Buffer): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const payload = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  const version = payload.subarray(0, SAFE_STORAGE_VERSION).toString('ascii');
  if (version !== 'v10') {
    throw new Error(`Unsupported HIM+ key format: ${version || '(empty)'}`);
  }
  if (payload.length <= SAFE_STORAGE_VERSION + NONCE_BYTES + TAG_BYTES) {
    throw new Error('HIM+ API key payload is truncated.');
  }
  const nonce = payload.subarray(SAFE_STORAGE_VERSION, SAFE_STORAGE_VERSION + NONCE_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const ciphertext = payload.subarray(
    SAFE_STORAGE_VERSION + NONCE_BYTES,
    payload.length - TAG_BYTES,
  );
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Returns the plaintext key for one provider. `override` (the `him.apiKey`
 * setting) wins, so a non-Windows host — or one whose Local State this process
 * cannot read — can still use HIM+ models.
 *
 * Returns the stored value unchanged when it is not `enc:`-prefixed, and `null`
 * when it is encrypted but cannot be unwrapped, so callers can report a real
 * cause instead of sending ciphertext to the provider.
 */
export async function resolveApiKey(
  stored: string,
  options: { configDir: string; override?: string },
): Promise<string | null> {
  const override = options.override?.trim();
  if (override) return override;
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored;

  const cached = apiKeyCache.get(stored);
  if (cached !== undefined) return cached;

  const key = await localAesKey(options.configDir);
  if (!key) return null;

  const plaintext = decryptEncPayload(stored, key);
  apiKeyCache.set(stored, plaintext);
  return plaintext;
}

/**
 * A HIM+ config with provider API keys resolved to plaintext, ready to send to a
 * provider. `keyError` is set when a key is stored encrypted and could not be
 * unwrapped — callers surface that instead of issuing a request that would fail
 * with HTTP 401.
 */
export interface HimRuntime {
  config: HimConfig;
  keyError: string;
}

const runtimeCache = new Map<string, { stamp: string; runtime: HimRuntime }>();

/**
 * Reads the config and resolves `enc:`-encrypted provider keys. Repeated calls in
 * one window reuse the cached result unless `config.json` changes on disk, so the
 * DPAPI round-trip happens at most once per key.
 */
export async function resolveHimRuntime(
  configPathOverride: string,
  apiKeyOverride = '',
): Promise<HimRuntime | null> {
  const configFile = defaultHimConfigPath(configPathOverride);
  let stamp: string;
  try {
    stamp = String(fs.statSync(configFile).mtimeMs);
  } catch {
    return null;
  }
  const cacheKey = `${configFile}|${apiKeyOverride}`;
  const cached = runtimeCache.get(cacheKey);
  if (cached && cached.stamp === stamp) return cached.runtime;

  const config = readHimConfig(configPathOverride);
  if (!config) return null;

  const configDir = path.dirname(configFile);
  let keyError = '';
  const providers: HimProvider[] = [];
  for (const provider of config.providers || []) {
    const resolved = await resolveApiKey(provider.apiKey, {
      configDir,
      override: apiKeyOverride,
    });
    if (resolved === null) {
      keyError =
        `The API key for "${provider.name}" is stored encrypted by the HIM+ desktop app and ` +
        `could not be decrypted from ${localStatePath(configDir)}. Open HIM+ once so it ` +
        're-saves the key, or set "him.apiKey" to a plaintext key.';
      providers.push({ ...provider, apiKey: '' });
      continue;
    }
    providers.push({ ...provider, apiKey: resolved });
  }

  const runtime: HimRuntime = { config: { ...config, providers }, keyError };
  runtimeCache.set(cacheKey, { stamp, runtime });
  return runtime;
}

/** Drops cached config/key resolutions; used when settings change. */
export function resetHimRuntimeCache(): void {
  runtimeCache.clear();
}

/** Which agent list a profile came from; the picker groups by this. */
export type HimAgentKind = 'him' | 'acp' | 'cli';

export interface HimAgentChoice {
  kind: HimAgentKind;
  /** Profile id for acp/cli; the literal 'him' for the built-in agent. */
  id: string;
  name: string;
  /** Human-readable invocation, shown under the name. Empty for the built-in. */
  detail: string;
}

/**
 * The agents a session can be started with.
 *
 * The built-in HIM+ agent is always first and always available — it needs no
 * external install and runs on the provider already in `config.json`. ACP and CLI
 * entries come from the desktop app's Integrations settings, so a user configures
 * agents once and both surfaces see them.
 *
 * Disabled profiles are omitted rather than shown greyed out: the desktop filters
 * the same way ([AgentSidebar.tsx:92-95]), and a picker that offers something that
 * cannot start is worse than one that stays quiet.
 */
export function listHimAgents(config: HimConfig | null): HimAgentChoice[] {
  const choices: HimAgentChoice[] = [
    { kind: 'him', id: 'him', name: 'HIM+ agent', detail: 'Built-in · your configured model' },
  ];
  if (!config) return choices;

  const describe = (profile: HimAgentProfile): string =>
    [profile.command, ...(profile.args || [])].filter(Boolean).join(' ');

  for (const profile of config.acpAgents || []) {
    if (!profile?.enabled || !profile.command?.trim()) continue;
    choices.push({
      kind: 'acp',
      id: profile.id,
      name: profile.name || profile.id,
      detail: describe(profile),
    });
  }
  for (const profile of config.cliAgents || []) {
    if (!profile?.enabled || !profile.command?.trim()) continue;
    choices.push({
      kind: 'cli',
      id: profile.id,
      name: profile.name || profile.id,
      detail: describe(profile),
    });
  }
  return choices;
}

/** Looks up one profile by kind and id, for starting a session. */
export function findHimAgent(
  config: HimConfig | null,
  kind: HimAgentKind,
  id: string,
): HimAgentProfile | null {
  if (!config || kind === 'him') return null;
  const list = kind === 'acp' ? config.acpAgents : config.cliAgents;
  const profile = (list || []).find((entry) => entry?.id === id);
  if (!profile || !profile.enabled || !profile.command?.trim()) return null;
  return profile;
}

/** Exposed for tests and diagnostics. */
export function resetHimKeyCache(): void {
  localKeyCache = null;
  apiKeyCache.clear();
  runtimeCache.clear();
}

function findModel(
  config: HimConfig,
  ref: HimModelRef | null | undefined,
): ResolvedHimModel | null {
  if (!ref) return null;
  const provider = config.providers.find((item) => item.id === ref.providerId);
  if (!provider) return null;
  const model = provider.models.find((item) => item.id === ref.modelId);
  if (!model?.enabled) return null;
  return {
    provider,
    model,
    label: `${provider.name} · ${model.id}`,
  };
}

export function resolveHimModel(
  config: HimConfig,
  preferred: HimModelRef | null | undefined,
  fallback: 'primary' | 'fast' | 'planning' = 'primary',
): ResolvedHimModel | null {
  const explicit = findModel(config, preferred);
  if (explicit) return explicit;
  const configured = findModel(config, config.defaults?.[fallback]);
  if (configured) return configured;
  for (const provider of config.providers || []) {
    const model = provider.models.find((item) => item.enabled);
    if (model) {
      return {
        provider,
        model,
        label: `${provider.name} · ${model.id}`,
      };
    }
  }
  return null;
}

function trimmedBase(baseUrl: string): string {
  const value = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) throw new Error('Provider base URL must use http or https.');
  return value;
}

export function chatCompletionsUrl(baseUrl: string): string {
  const base = trimmedBase(baseUrl);
  if (base.endsWith('/chat/completions')) return base;
  if (base.endsWith('/completions')) {
    return `${base.slice(0, -'/completions'.length)}/chat/completions`;
  }
  return `${base}/chat/completions`;
}

export function completionsUrl(baseUrl: string): string {
  const base = trimmedBase(baseUrl);
  if (base.endsWith('/chat/completions')) {
    return `${base.slice(0, -'/chat/completions'.length)}/completions`;
  }
  if (base.endsWith('/completions')) return base;
  return `${base}/completions`;
}

export function requestHeaders(provider: HimProvider): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (provider.apiKey?.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
  for (const [key, value] of Object.entries(provider.headers || {})) {
    if (!key.trim() || typeof value !== 'string') continue;
    // Fold case variants onto the canonical name; otherwise `Authorization` and
    // `authorization` would both be sent and the wrong one could win.
    if (key.toLowerCase() === 'authorization') {
      headers.Authorization = value;
      continue;
    }
    headers[key] = value;
  }
  return headers;
}

export function cleanCompletion(text: string): string {
  let value = String(text || '').replace(/\r\n/g, '\n');
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/.exec(value.trim());
  if (fenced) value = fenced[1];
  if (value.startsWith('```')) {
    value = value.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return value.slice(0, 1200);
}

export function trimSuffixOverlap(value: string, suffix: string): string {
  const suffixStart = suffix.slice(0, 600);
  const maxOverlap = Math.min(value.length, suffixStart.length, 200);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (value.endsWith(suffixStart.slice(0, size))) {
      return value.slice(0, value.length - size);
    }
  }
  return value;
}