import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AcpAgentProfile,
  AppConfig,
  CliAgentProfile,
  FimConfig,
  ModelRef,
  ProviderConfig,
} from '../shared/types';

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    providers: [],
    defaults: { primary: null, fast: null, planning: null },
    prefs: {
      mode: 'agent',
      minimap: true,
      theme: 'onyx',
      keyboardSound: true,
      restrictFileAccess: true,
      matchJupyterNotebook: true,
      notebookAutoWrangle: true,
    },
    fim: { enabled: false, mode: 'chat', model: null },
    copilot: { enabled: false },
    acpAgents: [],
    cliAgents: defaultCliAgents(),
    lastWorkspace: null,
  };
}

/** CLI agents are driven through a PTY in the chat pane (no ACP support needed). */
export function defaultCliAgents(): CliAgentProfile[] {
  return [
    {
      id: 'cli-freebuff',
      name: 'Freebuff',
      command: 'freebuff',
      args: [],
      env: {},
      enabled: true,
      preset: 'Freebuff',
    },
    {
      id: 'cli-aider',
      name: 'Aider',
      command: 'aider',
      args: [],
      env: {},
      enabled: false,
      preset: 'Aider',
    },
    {
      id: 'cli-claude',
      name: 'Claude Code',
      command: 'claude',
      args: [],
      env: {},
      enabled: false,
      preset: 'Claude Code',
    },
    {
      id: 'cli-codex',
      name: 'Codex CLI',
      command: 'codex',
      args: [],
      env: {},
      enabled: false,
      preset: 'Codex CLI',
    },
    {
      id: 'cli-gemini',
      name: 'Gemini CLI',
      command: 'gemini',
      args: [],
      env: {},
      enabled: false,
      preset: 'Gemini CLI',
    },
  ];
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeModelRef(value: unknown): ModelRef | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as Record<string, unknown>;
  if (typeof ref.providerId !== 'string' || typeof ref.modelId !== 'string') return null;
  return { providerId: ref.providerId, modelId: ref.modelId };
}

function acpRawArgs(profile: Record<string, unknown>): string[] {
  return Array.isArray(profile.args)
    ? profile.args.filter((arg): arg is string => typeof arg === 'string')
    : [];
}

/** The original Kilo preset assumed a globally installed `kilo` CLI. */
function isLegacyKiloProfile(profile: Record<string, unknown>): boolean {
  const command = typeof profile.command === 'string' ? profile.command.trim().toLowerCase() : '';
  const args = acpRawArgs(profile).map((arg) => arg.toLowerCase());
  return command === 'kilo' && args.join(' ') === 'acp';
}

function migrateAcpCommand(profile: Record<string, unknown>): string {
  if (isLegacyKiloProfile(profile)) return 'npx';
  return typeof profile.command === 'string' ? profile.command : '';
}

function migrateAcpArgs(profile: Record<string, unknown>): string[] {
  if (isLegacyKiloProfile(profile)) return ['-y', '@kilocode/cli@latest', 'acp'];
  return acpRawArgs(profile);
}

export function normalizeConfig(raw: unknown): AppConfig {
  const fallback = defaultConfig();
  if (!raw || typeof raw !== 'object') return fallback;
  const input = raw as Record<string, unknown>;
  const providersRaw = Array.isArray(input.providers) ? input.providers : [];
  const seenProviderIds = new Set<string>();
  const providers: ProviderConfig[] = [];

  for (const item of providersRaw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const id = stringOr(p.id) || crypto.randomUUID();
    if (seenProviderIds.has(id)) continue;
    seenProviderIds.add(id);
    const seenModels = new Set<string>();
    const models = (Array.isArray(p.models) ? p.models : [])
      .map((m) => {
        if (!m || typeof m !== 'object') return null;
        const model = m as Record<string, unknown>;
        const modelId = stringOr(model.id).trim();
        if (!modelId || seenModels.has(modelId)) return null;
        seenModels.add(modelId);
        const capsRaw =
          model.capabilities && typeof model.capabilities === 'object'
            ? (model.capabilities as Record<string, unknown>)
            : null;
        const capabilities = capsRaw
          ? (() => {
              const caps: { vision?: boolean; tools?: boolean; contextWindow?: number } = {};
              if (typeof capsRaw.vision === 'boolean') caps.vision = capsRaw.vision;
              if (typeof capsRaw.tools === 'boolean') caps.tools = capsRaw.tools;
              if (typeof capsRaw.contextWindow === 'number' && capsRaw.contextWindow > 0) {
                caps.contextWindow = Math.floor(capsRaw.contextWindow);
              }
              return Object.keys(caps).length > 0 ? caps : undefined;
            })()
          : undefined;
        return {
          id: modelId,
          enabled: model.enabled === true,
          source: model.source === 'manual' ? ('manual' as const) : ('fetched' as const),
          ...(capabilities ? { capabilities } : {}),
        };
      })
      .filter((m): m is NonNullable<typeof m> => Boolean(m));

    const headers: Record<string, string> = {};
    if (p.headers && typeof p.headers === 'object' && !Array.isArray(p.headers)) {
      for (const [key, value] of Object.entries(p.headers as Record<string, unknown>)) {
        if (typeof value === 'string' && key.trim()) headers[key.trim()] = value;
      }
    }

    providers.push({
      id,
      name: stringOr(p.name, 'Untitled provider'),
      baseUrl: stringOr(p.baseUrl),
      apiKey: stringOr(p.apiKey),
      headers,
      models,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now(),
    });
  }

  const defaultsRaw =
    input.defaults && typeof input.defaults === 'object'
      ? (input.defaults as Record<string, unknown>)
      : {};
  const prefsRaw =
    input.prefs && typeof input.prefs === 'object' ? (input.prefs as Record<string, unknown>) : {};
  const fimRaw =
    input.fim && typeof input.fim === 'object' ? (input.fim as Record<string, unknown>) : {};
  const copilotRaw =
    input.copilot && typeof input.copilot === 'object'
      ? (input.copilot as Record<string, unknown>)
      : {};
  const acpRaw = Array.isArray(input.acpAgents) ? input.acpAgents : [];
  const cliRaw = Array.isArray(input.cliAgents) ? input.cliAgents : null;
  const fim: FimConfig = {
    enabled: fimRaw.enabled === true,
    mode: fimRaw.mode === 'fim' ? 'fim' : 'chat',
    model: normalizeModelRef(fimRaw.model),
  };
  const copilot = { enabled: copilotRaw.enabled === true };
  const seenAcpIds = new Set<string>();
  const acpAgents: AcpAgentProfile[] = [];
  for (const item of acpRaw) {
    if (!item || typeof item !== 'object') continue;
    const profile = item as Record<string, unknown>;
    const id = typeof profile.id === 'string' && profile.id ? profile.id : crypto.randomUUID();
    if (seenAcpIds.has(id)) continue;
    seenAcpIds.add(id);
    const env: Record<string, string> = {};
    if (profile.env && typeof profile.env === 'object' && !Array.isArray(profile.env)) {
      for (const [key, value] of Object.entries(profile.env as Record<string, unknown>)) {
        if (typeof value === 'string' && key.trim()) env[key] = value;
      }
    }
    acpAgents.push({
      id,
      name: typeof profile.name === 'string' ? profile.name : 'ACP agent',
      command: migrateAcpCommand(profile),
      args: migrateAcpArgs(profile),
      env,
      enabled:
        profile.enabled !== false &&
        !(typeof profile.preset === 'string' && /freebuff/i.test(profile.preset)),
      preset: typeof profile.preset === 'string' ? profile.preset : undefined,
    });
  }

  const seenCliIds = new Set<string>();
  const cliAgents: CliAgentProfile[] = [];
  for (const item of cliRaw || []) {
    if (!item || typeof item !== 'object') continue;
    const profile = item as Record<string, unknown>;
    const id = typeof profile.id === 'string' && profile.id ? profile.id : crypto.randomUUID();
    if (seenCliIds.has(id)) continue;
    seenCliIds.add(id);
    const env: Record<string, string> = {};
    if (profile.env && typeof profile.env === 'object' && !Array.isArray(profile.env)) {
      for (const [key, value] of Object.entries(profile.env as Record<string, unknown>)) {
        if (typeof value === 'string' && key.trim()) env[key] = value;
      }
    }
    cliAgents.push({
      id,
      name: typeof profile.name === 'string' ? profile.name : 'CLI agent',
      command: typeof profile.command === 'string' ? profile.command : '',
      args: Array.isArray(profile.args)
        ? profile.args.filter((arg): arg is string => typeof arg === 'string')
        : [],
      env,
      enabled: profile.enabled !== false,
      preset: typeof profile.preset === 'string' ? profile.preset : undefined,
    });
  }

  return {
    version: 1,
    providers,
    defaults: {
      primary: normalizeModelRef(defaultsRaw.primary),
      fast: normalizeModelRef(defaultsRaw.fast),
      planning: normalizeModelRef(defaultsRaw.planning),
    },
    prefs: {
      mode: prefsRaw.mode === 'ide' ? 'ide' : 'agent',
      minimap: prefsRaw.minimap !== false,
      theme:
        typeof prefsRaw.theme === 'string' && prefsRaw.theme.trim()
          ? prefsRaw.theme
          : 'onyx',
      keyboardSound: prefsRaw.keyboardSound !== false,
      restrictFileAccess: prefsRaw.restrictFileAccess !== false,
      matchJupyterNotebook: prefsRaw.matchJupyterNotebook !== false,
      notebookAutoWrangle: prefsRaw.notebookAutoWrangle !== false,
    },
    fim,
    copilot,
    acpAgents,
    cliAgents: cliRaw ? cliAgents : defaultCliAgents(),
    lastWorkspace:
      typeof input.lastWorkspace === 'string' && input.lastWorkspace.trim()
        ? input.lastWorkspace
        : null,
  };
}

/**
 * Provider API keys are encrypted at rest with Electron `safeStorage`.
 *
 * On-disk format: each `providers[].apiKey` is stored as `enc:<base64>`, where
 * the base64 payload is `safeStorage.encryptString(plaintext)`. Encryption is
 * applied only when persisting; the in-memory cache always keeps the plaintext
 * key so `load()`, the `config:get` IPC handler and the renderer keep working
 * unchanged. `normalizeConfig` stays pure and never decrypts.
 *
 * Migration/fallback: legacy configs contain plaintext keys, which are read
 * as-is and transparently re-persisted encrypted on the next save. When
 * `safeStorage.isEncryptionAvailable()` is false (or encryption throws) the key
 * is stored as plaintext. If a stored `enc:` value cannot be decrypted it is
 * emptied with a warning, so a bad key never crashes config loading and the
 * key material itself is never logged.
 */
const ENC_PREFIX = 'enc:';

function canEncryptAtRest(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptApiKeyForDisk(apiKey: string): string {
  if (!apiKey || apiKey.startsWith(ENC_PREFIX)) return apiKey;
  if (!canEncryptAtRest()) return apiKey;
  try {
    return `${ENC_PREFIX}${safeStorage.encryptString(apiKey).toString('base64')}`;
  } catch (error) {
    console.warn(
      '[config] API key encryption unavailable, storing plaintext',
      (error as Error)?.message || 'unknown error',
    );
    return apiKey;
  }
}

function decryptApiKeyFromDisk(apiKey: string): string {
  if (!apiKey.startsWith(ENC_PREFIX)) return apiKey;
  try {
    return safeStorage.decryptString(Buffer.from(apiKey.slice(ENC_PREFIX.length), 'base64'));
  } catch (error) {
    console.warn(
      '[config] failed to decrypt stored API key; leaving it empty',
      (error as Error)?.message || 'unknown error',
    );
    return '';
  }
}

/** Returns a shallow clone whose provider keys are plaintext for app use. */
function decryptConfigApiKeys(config: AppConfig): AppConfig {
  if (!config.providers.some((provider) => provider.apiKey.startsWith(ENC_PREFIX))) return config;
  return {
    ...config,
    providers: config.providers.map((provider) => ({
      ...provider,
      apiKey: decryptApiKeyFromDisk(provider.apiKey),
    })),
  };
}

/** Returns a shallow clone whose provider keys are encrypted for the file. */
function encryptConfigApiKeys(config: AppConfig): AppConfig {
  if (!canEncryptAtRest()) return config;
  return {
    ...config,
    providers: config.providers.map((provider) => ({
      ...provider,
      apiKey: encryptApiKeyForDisk(provider.apiKey),
    })),
  };
}

export class ConfigStore {
  readonly filePath: string;
  private cache: AppConfig | null = null;

  constructor() {
    const dir = process.env.HIM_CONFIG_DIR || app.getPath('userData');
    this.filePath = path.join(dir, 'config.json');
  }

  getPath(): string {
    return this.filePath;
  }

  load(): AppConfig {
    if (this.cache) return this.cache;
    try {
      if (!fs.existsSync(this.filePath)) {
        this.cache = defaultConfig();
        this.persist(this.cache);
        return this.cache;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.cache = decryptConfigApiKeys(normalizeConfig(JSON.parse(raw)));
    } catch (error) {
      console.error('[config] failed to read config, using defaults', error);
      try {
        if (fs.existsSync(this.filePath)) {
          fs.renameSync(this.filePath, `${this.filePath}.invalid-${Date.now()}`);
        }
      } catch {
        // ignore
      }
      this.cache = defaultConfig();
      this.persist(this.cache);
    }
    return this.cache;
  }

  save(config: AppConfig): AppConfig {
    this.cache = normalizeConfig(config);
    this.persist(this.cache);
    return this.cache;
  }

  private persist(config: AppConfig): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const payload = JSON.stringify(encryptConfigApiKeys(config), null, 2);
    const temp = `${this.filePath}.tmp`;
    try {
      fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, this.filePath);
    } catch (error) {
      console.error('[config] atomic write failed, falling back', error);
      fs.writeFileSync(this.filePath, payload, { encoding: 'utf8', mode: 0o600 });
    }
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Windows may ignore POSIX modes.
    }
  }
}

