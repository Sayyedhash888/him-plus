import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  Eye,
  EyeOff,
  Globe,
  Github,
  Info,
  KeyRound,
  Keyboard,
  Monitor,
  Palette,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import type {
  AcpRegistryEntry,
  CopilotStatus,
  ModelRef,
  ProviderConfig,
  UpdateCheckResult,
  UpdateInfo,
} from '@shared/types';
import {
  useConfigStore,
  findModelOption,
  providerModelOptions,
  resolveDefaultModel,
  type DefaultKind,
} from '../store/config';
import { useJupyterStore } from '../store/jupyter';
import { useCoreStore } from '../store/core';
import { useSessionStore } from '../store/sessions';
import { cleanErrorMessage, him } from '../lib/bridge';
import { THEMES, applyThemeCss, getTheme } from '../lib/themes';
import { playSoundPreview } from '../lib/keyboardSound';
import { cn } from '../lib/utils';
import { toast } from '../store/toast';
import {
  Button,
  IconButton,
  Kbd,
  Modal,
  SectionLabel,
  Segmented,
  Spinner,
  Toggle,
} from './ui';
import { BrandBanner, BrandMark } from './Brand';

type SettingsTab = 'providers' | 'defaults' | 'integrations' | 'appearance' | 'about';

interface ProviderDraft {
  name: string;
  baseUrl: string;
  apiKey: string;
  headersText: string;
}

interface ProviderPreset {
  name: string;
  baseUrl: string;
  description: string;
  icon: typeof Globe;
}

const PRESETS: ProviderPreset[] = [
  {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    description: 'Local models, no API key',
    icon: Cpu,
  },
  {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    description: 'Hundreds of hosted models',
    icon: Globe,
  },
  {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    description: 'Low-latency inference',
    icon: Zap,
  },
  {
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    description: 'NVIDIA hosted endpoints',
    icon: Sparkles,
  },
  {
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    description: 'Local OpenAI-compatible server',
    icon: Cpu,
  },
  {
    name: 'Z.ai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    description: 'Z.ai compatible endpoint',
    icon: Globe,
  },
];

const ACP_PRESETS: Array<{
  name: string;
  command: string;
  args: string[];
  description: string;
  enabled?: boolean;
}> = [
  {
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    description: 'OpenCode CLI in ACP mode',
  },
  {
    name: 'Hermes Agent',
    command: 'hermes',
    args: ['acp'],
    description:
      'Hermes Agent ACP server. Requires pip install "hermes-agent[acp]"; logs to stderr.',
  },
  {
    name: 'DeepSeek Harness',
    command: 'dsh',
    args: ['--profile', 'acp'],
    description: 'DeepSeek Harness ACP stdio server (dsh --profile acp).',
  },
  {
    name: 'Cline',
    command: 'npx',
    args: ['-y', 'cline@latest', '--acp'],
    description: 'Cline ACP via npx. First run may open a browser to sign in.',
  },
  {
    name: 'Kilo',
    command: 'npx',
    args: ['-y', '@kilocode/cli@latest', 'acp'],
    description:
      'Kilo CLI ACP via npx (kilo acp). Install globally with "npm i -g @kilocode/cli" to use the kilo command instead.',
  },
  {
    name: 'Google Antigravity',
    command: 'agy_acp_server.exe',
    args: [],
    description: 'Antigravity ACP server binary',
  },
  {
    name: 'GitHub Copilot CLI',
    command: 'npx',
    args: ['-y', '@github/copilot@latest', '--acp'],
    description:
      'GitHub Copilot CLI ACP mode. Run "copilot" once to sign in first; requires Node.js 22.13+ on PATH.',
  },
];

const CLI_PRESETS: Array<{
  name: string;
  command: string;
  args: string[];
  description: string;
}> = [
  {
    name: 'Freebuff',
    command: 'freebuff',
    args: [],
    description: 'Freebuff interactive CLI (no ACP needed).',
  },
  {
    name: 'Aider',
    command: 'aider',
    args: [],
    description: 'Aider AI pair programmer.',
  },
  {
    name: 'Claude Code',
    command: 'claude',
    args: [],
    description: 'Anthropic Claude Code CLI.',
  },
  {
    name: 'Codex CLI',
    command: 'codex',
    args: [],
    description: 'OpenAI Codex CLI.',
  },
  {
    name: 'Gemini CLI',
    command: 'gemini',
    args: [],
    description: 'Google Gemini CLI.',
  },
];

function parseAcpArgs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed;
    }
  } catch {
    // space-separated fallback
  }
  return trimmed.split(/\s+/);
}

function parseHeaders(text: string): { headers?: Record<string, string>; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { headers: {} };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    return { error: `Invalid JSON: ${(error as Error).message}` };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Headers must be a JSON object of string values.' };
  }
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof headerValue !== 'string') {
      return { error: `Header "${key}" must be a string.` };
    }
    headers[key] = headerValue;
  }
  return { headers };
}

function isValidBaseUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || 'No endpoint';
  }
}

function draftFrom(provider: ProviderConfig): ProviderDraft {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headersText: JSON.stringify(provider.headers || {}, null, 2),
  };
}

function TabButton({
  active,
  icon,
  label,
  trailing,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  onClick(): void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] transition-colors',
        active
          ? 'bg-ink-750 text-mist-bright shadow-inset'
          : 'text-mist-dim hover:bg-ink-800/70 hover:text-mist',
      )}
    >
      <span className={cn(active ? 'text-accent' : 'text-mist-faint')}>{icon}</span>
      <span className="flex-1">{label}</span>
      {trailing}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-mist-dim">
          {label}
        </label>
        {hint && <span className="text-[9.5px] text-mist-ghost">{hint}</span>}
      </div>
      {children}
      {error && <p className="mt-1 text-[10px] text-coral-soft">{error}</p>}
    </div>
  );
}

function ModelSelectCard({
  icon,
  color,
  title,
  description,
  kind,
  value,
  onChange,
}: {
  icon: ReactNode;
  color: string;
  title: string;
  description: string;
  kind: DefaultKind;
  value: string;
  onChange(value: string): void;
}) {
  const config = useConfigStore((state) => state.config);
  const options = providerModelOptions(config);
  const effective = resolveDefaultModel(config, kind);
  const groups = useMemo(() => {
    const map = new Map<string, typeof options>();
    for (const option of options) {
      const list = map.get(option.provider.name) || [];
      list.push(option);
      map.set(option.provider.name, list);
    }
    return [...map.entries()];
  }, [options]);

  return (
    <div className="rounded-lg border border-line bg-ink-850/50 p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
            color,
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-mist-bright">{title}</div>
          <div className="mt-0.5 text-[10.5px] leading-relaxed text-mist-faint">
            {description}
          </div>
        </div>
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="him-input mt-3.5 h-8 font-mono text-[10.5px]"
        style={{ colorScheme: 'dark' }}
        disabled={options.length === 0}
      >
        <option value="">Automatic — first enabled model</option>
        {groups.map(([providerName, providerOptions]) => (
          <optgroup key={providerName} label={providerName}>
            {providerOptions.map((option) => (
              <option
                key={`${option.provider.id}::${option.model.id}`}
                value={`${option.provider.id}::${option.model.id}`}
              >
                {option.model.id}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="mt-2 flex items-center gap-1.5 text-[9.5px]">
        <Check size={9} className="text-mint" />
        <span className="text-mist-ghost">Effective:</span>
        <span className="truncate font-mono text-mist-faint">
          {effective ? `${effective.provider.name} · ${effective.model.id}` : 'No model enabled'}
        </span>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const open = useCoreStore((state) => state.settingsOpen);
  const setSettingsOpen = useCoreStore((state) => state.setSettingsOpen);
  const setTabMode = useCoreStore((state) => state.setMode);
  const config = useConfigStore((state) => state.config);
  const configPath = useConfigStore((state) => state.configPath);
  const addProvider = useConfigStore((state) => state.addProvider);
  const updateProvider = useConfigStore((state) => state.updateProvider);
  const deleteProvider = useConfigStore((state) => state.deleteProvider);
  const fetchModels = useConfigStore((state) => state.fetchModels);
  const setModelEnabled = useConfigStore((state) => state.setModelEnabled);
  const setAllModels = useConfigStore((state) => state.setAllModels);
  const addManualModel = useConfigStore((state) => state.addManualModel);
  const setDefault = useConfigStore((state) => state.setDefault);
  const setPrefs = useConfigStore((state) => state.setPrefs);
  const jupyterConfig = useJupyterStore((state) => state.config);
  const loadJupyter = useJupyterStore((state) => state.load);
  const setFim = useConfigStore((state) => state.setFim);
  const addAcpProfile = useConfigStore((state) => state.addAcpProfile);
  const updateAcpProfile = useConfigStore((state) => state.updateAcpProfile);
  const deleteAcpProfile = useConfigStore((state) => state.deleteAcpProfile);
  const addCliProfile = useConfigStore((state) => state.addCliProfile);
  const updateCliProfile = useConfigStore((state) => state.updateCliProfile);
  const deleteCliProfile = useConfigStore((state) => state.deleteCliProfile);
  const [acpRegistry, setAcpRegistry] = useState<AcpRegistryEntry[] | null>(null);
  const [registryOpen, setRegistryOpen] = useState(false);
  const [registryBusy, setRegistryBusy] = useState<string | null>(null);
  const activeSession = useSessionStore((state) =>
    state.sessions.find((session) => session.id === state.activeId) || null,
  );

  const [tab, setTab] = useState<SettingsTab>('providers');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const setCopilotEnabled = useConfigStore((state) => state.setCopilotEnabled);
  const workspace = useCoreStore((state) => state.workspace);
  const [copilotStatus, setCopilotStatus] = useState<CopilotStatus | null>(null);
  const [copilotSignIn, setCopilotSignIn] = useState<{
    userCode?: string;
    verificationUri?: string;
  } | null>(null);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<UpdateInfo | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    void him.update
      .info()
      .then((info) => setAppInfo(info))
      .catch(() => undefined);
  }, []);

  const checkUpdates = async () => {
    setUpdateBusy(true);
    try {
      setUpdateResult(await him.update.check());
    } catch (error) {
      setUpdateResult({
        configured: false,
        currentVersion: appInfo?.version || '0.0.0',
        updateAvailable: false,
        error: cleanErrorMessage(error),
      });
    } finally {
      setUpdateBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    const unsubscribe = him.copilot.onStatus((status) => {
      if (active) setCopilotStatus(status);
    });
    void him.copilot
      .status()
      .then((status) => {
        if (active) setCopilotStatus(status);
      })
      .catch(() => undefined);
    if (config?.copilot?.enabled) {
      // Start the language server so its auth notifications (user, quota)
      // arrive even if no completion has been requested yet.
      void him.copilot
        .setRoot(workspace || '')
        .then((status) => {
          if (active) setCopilotStatus(status);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.copilot?.enabled, workspace]);

  const toggleCopilot = (enabled: boolean) => {
    setCopilotEnabled(enabled);
    if (enabled) {
      void him.copilot
        .setRoot(workspace || '')
        .then((status) => setCopilotStatus(status))
        .catch(() => undefined);
    }
  };

  const signInCopilot = async () => {
    setCopilotBusy(true);
    setCopilotError(null);
    try {
      const result = await him.copilot.signIn(workspace || '');
      if (!result.ok) {
        setCopilotError(result.error || 'GitHub sign-in failed.');
        return;
      }
      if (result.signedIn) {
        setCopilotSignIn(null);
        setCopilotError(null);
        try {
          setCopilotStatus(await him.copilot.status());
        } catch {
          // ignore
        }
        return;
      }
      setCopilotSignIn({
        userCode: result.userCode,
        verificationUri: result.verificationUri,
      });
      if (result.userCode) {
        void navigator.clipboard.writeText(result.userCode).catch(() => undefined);
      }
    } catch (error) {
      setCopilotError(cleanErrorMessage(error));
    } finally {
      setCopilotBusy(false);
    }
  };

  const verifyCopilot = async () => {
    setCopilotBusy(true);
    setCopilotError(null);
    try {
      const result = await him.copilot.verifyAuth();
      if (!result.signedIn) setCopilotError(result.message);
      setCopilotStatus(await him.copilot.status());
    } catch (error) {
      setCopilotError(cleanErrorMessage(error));
    } finally {
      setCopilotBusy(false);
    }
  };

  const signOutCopilot = async () => {
    await him.copilot.signOut().catch(() => undefined);
    setCopilotSignIn(null);
    try {
      setCopilotStatus(await him.copilot.status());
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let active = true;
    void him.acp
      .registry()
      .then((entries) => {
        if (active) setAcpRegistry(entries);
      })
      .catch(() => {
        if (active) setAcpRegistry([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const addFromRegistry = async (entry: AcpRegistryEntry) => {
    setRegistryBusy(entry.id);
    try {
      const health = await him.acp.health(entry.command, entry.args);
      addAcpProfile({
        name: entry.name,
        command: entry.command,
        args: entry.args,
        preset: entry.name,
        enabled: true,
      });
      const detail = health.ok
        ? `${entry.name} added. ${health.version ? `Version: ${health.version}. ` : ''}${entry.authHint || ''}`
        : `${entry.name} added, but ${health.error || 'the command was not found.'} ${entry.authHint || ''}`;
      toast(health.ok ? 'success' : 'info', detail.trim(), 'ACP registry');
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'ACP registry');
    } finally {
      setRegistryBusy(null);
    }
  };

  const providers = config?.providers || [];
  const provider = providers.find((item) => item.id === selectedId) || null;
  const headersParsed = draft ? parseHeaders(draft.headersText) : { headers: {} };
  const baseUrlValid = draft ? isValidBaseUrl(draft.baseUrl) : true;
  const dirty = Boolean(
    draft &&
      provider &&
      (draft.name !== provider.name ||
        draft.baseUrl !== provider.baseUrl ||
        draft.apiKey !== provider.apiKey ||
        draft.headersText !== JSON.stringify(provider.headers || {}, null, 2)),
  );

  useEffect(() => {
    if (!open) return;
    if (providers.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !providers.some((item) => item.id === selectedId)) {
      setSelectedId(providers[0].id);
    }
  }, [open, providers, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDraft(null);
      return;
    }
    const current = useConfigStore
      .getState()
      .config?.providers.find((item) => item.id === selectedId);
    if (!current) return;
    setDraft(draftFrom(current));
    setShowKey(false);
    setFetchError(null);
    setFetchNote(null);
    setDeleteConfirm(false);
    setModelFilter('');
    setManualModel('');
    setManualError(null);
  }, [selectedId]);

  useEffect(() => {
    if (!open) {
      setFetching(false);
      setDeleteConfirm(false);
    }
  }, [open]);

  const updateDraft = (patch: Partial<ProviderDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setFetchError(null);
    setFetchNote(null);
  };

  const validateDraft = (): ProviderDraft | null => {
    if (!draft) return null;
    if (!draft.name.trim()) {
      toast('error', 'Give the provider a name.');
      return null;
    }
    if (!baseUrlValid) {
      toast('error', 'Base URL must be a valid http(s) URL.');
      return null;
    }
    if (headersParsed.error) {
      toast('error', headersParsed.error);
      return null;
    }
    return draft;
  };

  const persistDraft = (showToast = true): string | null => {
    const valid = validateDraft();
    if (!valid || !selectedId) return null;
    const headers = headersParsed.headers || {};
    updateProvider(selectedId, {
      name: valid.name.trim(),
      baseUrl: valid.baseUrl.trim(),
      apiKey: valid.apiKey,
      headers,
    });
    const canonical = JSON.stringify(headers, null, 2);
    setDraft({ ...valid, name: valid.name.trim(), baseUrl: valid.baseUrl.trim(), headersText: canonical });
    setFetchError(null);
    if (showToast) toast('success', `${valid.name.trim()} saved locally.`, 'Provider saved');
    return headers ? JSON.stringify(headers) : null;
  };

  const handleAddProvider = (preset?: ProviderPreset) => {
    const id = addProvider(
      preset
        ? {
            name: preset.name,
            baseUrl: preset.baseUrl,
            headers: {},
          }
        : {
            name: 'Custom provider',
            baseUrl: '',
            headers: {},
          },
    );
    setSelectedId(id);
    setTab('providers');
    setFetchError(null);
    setFetchNote(null);
  };

  const handleFetch = async () => {
    if (!selectedId || !draft) return;
    if (!draft.baseUrl.trim()) {
      setFetchError('Enter a base URL before fetching models.');
      return;
    }
    if (!baseUrlValid) {
      setFetchError('Base URL must be a valid http(s) URL.');
      return;
    }
    persistDraft(false);
    setFetching(true);
    setFetchError(null);
    setFetchNote(null);
    try {
      const result = await fetchModels(selectedId);
      setFetchNote(
        result.total === 0
          ? 'The endpoint returned an empty model list. Add a model ID manually below.'
          : `Provider returned ${result.total} model(s) · added ${result.added} new to the catalog.`,
      );
      toast(
        'success',
        result.total === 0
          ? 'No models were returned by /models.'
          : `${result.total} models discovered. Toggle on the ones you want in selectors.`,
        'Fetch models',
      );
    } catch (error) {
      setFetchError(cleanErrorMessage(error));
    } finally {
      setFetching(false);
    }
  };

  const handleDelete = () => {
    if (!provider) return;
    const id = provider.id;
    deleteProvider(id);
    setDeleteConfirm(false);
    setSelectedId(null);
    toast('success', `${provider.name} removed.`, 'Provider deleted');
  };

  const selectedModels = provider?.models || [];
  const filteredModels = selectedModels.filter((model) =>
    model.id.toLowerCase().includes(modelFilter.trim().toLowerCase()),
  );
  const enabledCount = selectedModels.filter((model) => model.enabled).length;
  const activeTheme = getTheme(config?.prefs.theme);
  const chooseTheme = (id: string) => {
    applyThemeCss(getTheme(id));
    setPrefs({ theme: id });
  };
  const fimOptions = providerModelOptions(config);
  const fimModel =
    findModelOption(config, config?.fim.model) ||
    resolveDefaultModel(config, 'fast') ||
    resolveDefaultModel(config, 'primary');
  const handleFimModel = (value: string) => {
    if (!value) {
      setFim({ model: null });
      return;
    }
    const separator = value.indexOf('::');
    if (separator === -1) return;
    setFim({
      model: {
        providerId: value.slice(0, separator),
        modelId: value.slice(separator + 2),
      },
    });
  };

  const handleManualAdd = () => {
    if (!selectedId) return;
    const value = manualModel.trim();
    if (!value) return;
    const existed = selectedModels.some((model) => model.id === value);
    const added = addManualModel(selectedId, value);
    setManualModel('');
    setManualError(null);
    if (!added && existed) toast('info', 'That model was already in the catalog.', 'Model enabled');
    else if (!added) setManualError('Could not add that model.');
  };

  const handleDefaultChange = (kind: DefaultKind, value: string) => {
    if (!value) {
      setDefault(kind, null);
      return;
    }
    const separator = value.indexOf('::');
    if (separator === -1) return;
    const ref: ModelRef = {
      providerId: value.slice(0, separator),
      modelId: value.slice(separator + 2),
    };
    setDefault(kind, ref);
  };

  const copyConfigPath = async () => {
    if (!configPath) return;
    try {
      await navigator.clipboard.writeText(configPath);
      toast('success', 'Config path copied.');
    } catch {
      toast('error', 'Clipboard unavailable.');
    }
  };

  const tabTitles: Record<SettingsTab, { title: string; subtitle: string }> = {
    providers: {
      title: 'Providers & models',
      subtitle: 'Bring any OpenAI-compatible endpoint. Catalogs and keys stay local.',
    },
    defaults: {
      title: 'Model defaults',
      subtitle: 'Choose which enabled models power each capability.',
    },
    integrations: {
      title: 'FIM & external agents',
      subtitle: 'Inline autocomplete, login-based sources and ACP agent profiles.',
    },
    appearance: {
      title: 'Appearance & editor',
      subtitle: 'Themes apply instantly across the workbench, Monaco and the terminal.',
    },
    about: {
      title: 'About HIM+',
      subtitle: 'A lightweight, AI-first workbench for code and agents.',
    },
  };

  return (
    <>
      <Modal open={open} onClose={() => setSettingsOpen(false)} wide className="max-w-[1000px]">
        <div className="flex h-full min-h-0">
          <aside className="flex w-[228px] shrink-0 flex-col border-r border-line bg-ink-850/60">
            <div className="px-4 pb-3 pt-4">
              <div className="flex items-center gap-2">
                <BrandMark size={25} alt="" />
                <div>
                  <div className="text-[11.5px] font-semibold tracking-[-0.01em] text-mist-bright">
                    Settings
                  </div>
                  <div className="text-[8px] uppercase tracking-[0.16em] text-mist-ghost">
                    Integrated IDE
                  </div>
                </div>
              </div>
            </div>
            <nav className="space-y-0.5 px-2">
              <TabButton
                active={tab === 'providers'}
                icon={<KeyRound size={13} />}
                label="Providers"
                onClick={() => setTab('providers')}
                trailing={
                  <span className="font-mono text-[9px] text-mist-ghost">{providers.length}</span>
                }
              />
              <TabButton
                active={tab === 'defaults'}
                icon={<SlidersHorizontal size={13} />}
                label="Model defaults"
                onClick={() => setTab('defaults')}
              />
              <TabButton
                active={tab === 'integrations'}
                icon={<Plug size={13} />}
                label="Integrations"
                onClick={() => setTab('integrations')}
              />
              <TabButton
                active={tab === 'appearance'}
                icon={<Palette size={13} />}
                label="Appearance"
                onClick={() => setTab('appearance')}
              />
              <TabButton
                active={tab === 'about'}
                icon={<Info size={13} />}
                label="About"
                onClick={() => setTab('about')}
              />
            </nav>
            <div className="mt-4 px-4">
              <div className="rounded-md border border-line bg-ink-900/50 p-2.5">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck size={10} className="text-mint" />
                  <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-mist-faint">
                    Local BYOK
                  </span>
                </div>
                <p className="mt-1.5 text-[9px] leading-relaxed text-mist-ghost">
                  Keys, endpoints and catalogs are stored on this machine. No HIM+ cloud account.
                </p>
              </div>
            </div>
            <div className="flex-1" />
            <div className="border-t border-line p-3">
              <div className="mb-1 text-[8.5px] font-semibold uppercase tracking-[0.14em] text-mist-ghost">
                Config file
              </div>
              <button
                onClick={() => setTab('about')}
                title={configPath}
                className="block w-full truncate text-left font-mono text-[8.5px] text-mist-faint hover:text-mist"
              >
                {configPath || 'resolving…'}
              </button>
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4">
              <div>
                <h2
                  id="settings-title"
                  className="text-[14px] font-semibold tracking-[-0.015em] text-mist-bright"
                >
                  {tabTitles[tab].title}
                </h2>
                <p className="mt-0.5 text-[10.5px] text-mist-faint">{tabTitles[tab].subtitle}</p>
              </div>
              <IconButton label="Close settings" onClick={() => setSettingsOpen(false)}>
                <X size={14} />
              </IconButton>
            </header>

            {tab === 'providers' && (
              <div className="flex min-h-0 flex-1">
                <div className="flex w-[224px] shrink-0 flex-col border-r border-line bg-ink-900/30">
                  <div className="flex items-center justify-between px-3 pb-2 pt-3">
                    <SectionLabel>Providers</SectionLabel>
                    <IconButton
                      label="Add provider"
                      size="xs"
                      onClick={() => handleAddProvider()}
                    >
                      <Plus size={12} />
                    </IconButton>
                  </div>
                  <div className="thin-scrollbar flex-1 overflow-y-auto px-1.5 pb-3">
                    {providers.length === 0 && (
                      <div className="px-2 py-3 text-[10px] leading-relaxed text-mist-ghost">
                        No providers yet. Pick a preset or add a custom endpoint.
                      </div>
                    )}
                    {providers.map((item) => {
                      const enabled = item.models.filter((model) => model.enabled).length;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}
                          className={cn(
                            'group mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors',
                            selectedId === item.id
                              ? 'bg-ink-750 text-mist-bright shadow-inset'
                              : 'text-mist hover:bg-ink-800/70',
                          )}
                        >
                          <div
                            className={cn(
                              'flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[9px] font-semibold uppercase',
                              selectedId === item.id
                                ? 'border-accent/25 bg-accent/\u005b0.08\u005d text-accent'
                                : 'border-line bg-ink-850 text-mist-faint',
                            )}
                          >
                            {item.name.slice(0, 2)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[10.5px] font-medium">{item.name}</div>
                            <div className="truncate font-mono text-[8.5px] text-mist-ghost">
                              {hostOf(item.baseUrl)}
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-[8.5px] text-mist-ghost">
                            {enabled}/{item.models.length}
                          </span>
                          <ChevronRight
                            size={10}
                            className="shrink-0 text-mist-ghost opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-line p-2">
                    <button
                      onClick={() => handleAddProvider()}
                      className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-line border-dashed text-[10px] text-mist-faint transition-colors hover:border-accent/30 hover:text-accent-soft"
                    >
                      <Plus size={11} /> Add provider
                    </button>
                  </div>
                </div>

                <div className="thin-scrollbar min-w-0 flex-1 overflow-y-auto">
                  {!provider || !draft ? (
                    <div className="flex h-full flex-col items-center justify-center px-8 py-8">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-ink-850">
                        <KeyRound size={20} className="text-accent-dim" />
                      </div>
                      <h3 className="text-[13px] font-semibold text-mist-bright">
                        Connect your first provider
                      </h3>
                      <p className="mt-1 max-w-[380px] text-center text-[10.5px] leading-relaxed text-mist-faint">
                        HIM+ talks to any OpenAI-compatible API — hosted or local. Choose a preset,
                        add your key, then fetch models.
                      </p>
                      <div className="mt-5 grid w-full max-w-[440px] grid-cols-2 gap-2">
                        {PRESETS.slice(0, 6).map((preset) => {
                          const Icon = preset.icon;
                          return (
                            <button
                              key={preset.name}
                              onClick={() => handleAddProvider(preset)}
                              className="group rounded-lg border border-line bg-ink-850/60 p-3 text-left transition-colors hover:border-accent/25 hover:bg-ink-800"
                            >
                              <div className="flex items-center gap-2">
                                <Icon size={13} className="text-mist-faint group-hover:text-accent" />
                                <span className="text-[11px] font-medium text-mist-bright">
                                  {preset.name}
                                </span>
                              </div>
                              <div className="mt-1 text-[9px] leading-relaxed text-mist-ghost">
                                {preset.description}
                              </div>
                              <div className="mt-1 truncate font-mono text-[8px] text-mist-ghost">
                                {preset.baseUrl}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => handleAddProvider()}
                        className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[10px] text-mist-faint hover:border-line-strong hover:text-mist"
                      >
                        <Plus size={10} /> Custom provider
                      </button>
                    </div>
                  ) : (
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-ink-850 text-[11px] font-semibold uppercase text-accent">
                            {draft.name.slice(0, 2) || 'P'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <input
                                value={draft.name}
                                onChange={(event) => updateDraft({ name: event.target.value })}
                                className="w-full min-w-0 border-0 bg-transparent p-0 text-[14px] font-semibold tracking-[-0.01em] text-mist-bright outline-none placeholder:text-mist-ghost focus:ring-0"
                                placeholder="Provider name"
                              />
                              {dirty && (
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-sand"
                                  title="Unsaved changes"
                                />
                              )}
                            </div>
                            <div className="mt-0.5 font-mono text-[9px] text-mist-ghost">
                              {selectedModels.length} models · {enabledCount} enabled
                            </div>
                          </div>
                        </div>
                        <IconButton
                          label="Delete provider"
                          tone="danger"
                          onClick={() => setDeleteConfirm(true)}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          <Field label="Base URL" hint="OpenAI-compatible root, usually ends in /v1">
                            <input
                              value={draft.baseUrl}
                              onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                              placeholder="https://openrouter.ai/api/v1"
                              spellCheck={false}
                              className={cn(
                                'him-input h-8 font-mono text-[10.5px]',
                                !baseUrlValid && 'border-coral/50',
                              )}
                            />
                            {!baseUrlValid && (
                              <p className="mt-1 text-[10px] text-coral-soft">
                                Enter a valid http(s) URL.
                              </p>
                            )}
                          </Field>
                        </div>
                        <div className="col-span-2">
                          <Field label="API key" hint="Optional for local endpoints">
                            <div className="relative">
                              <input
                                type={showKey ? 'text' : 'password'}
                                value={draft.apiKey}
                                onChange={(event) => updateDraft({ apiKey: event.target.value })}
                                placeholder="sk-…"
                                spellCheck={false}
                                autoComplete="off"
                                className="him-input h-8 pr-9 font-mono text-[10.5px]"
                              />
                              <button
                                type="button"
                                onClick={() => setShowKey((value) => !value)}
                                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-mist-ghost hover:text-mist"
                                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                              >
                                {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            </div>
                          </Field>
                        </div>
                      </div>

                      <details className="group mt-4">
                        <summary className="inline-flex items-center gap-1.5 text-[10px] text-mist-faint hover:text-mist">
                          <ChevronRight
                            size={10}
                            className="transition-transform group-open:rotate-90"
                          />
                          Custom headers (JSON)
                        </summary>
                        <div className="mt-2">
                          <textarea
                            value={draft.headersText}
                            onChange={(event) => updateDraft({ headersText: event.target.value })}
                            rows={4}
                            spellCheck={false}
                            className={cn(
                              'him-input him-textarea font-mono text-[10px] leading-[1.65]',
                              headersParsed.error && 'border-coral/50',
                            )}
                            placeholder={'{\n  "HTTP-Referer": "https://example.com"\n}'}
                          />
                          {headersParsed.error && (
                            <p className="mt-1 text-[10px] text-coral-soft">{headersParsed.error}</p>
                          )}
                        </div>
                      </details>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant={dirty ? 'primary' : 'secondary'}
                          onClick={() => persistDraft(true)}
                          disabled={!dirty || fetching}
                          icon={<Check size={11} />}
                        >
                          Save changes
                        </Button>
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => void handleFetch()}
                          loading={fetching}
                          disabled={!draft.baseUrl.trim() || !baseUrlValid}
                          icon={<RefreshCw size={11} />}
                        >
                          Fetch models
                        </Button>
                        {dirty && (
                          <span className="text-[9.5px] text-mist-ghost">Unsaved changes</span>
                        )}
                      </div>
                      {(fetchError || fetchNote) && (
                        <div
                          className={cn(
                            'mt-3 rounded-md border px-3 py-2 text-[10px] leading-relaxed',
                            fetchError
                              ? 'border-coral/25 bg-coral-deep/20 text-coral-soft'
                              : 'border-mint/20 bg-mint-deep/20 text-mint-soft',
                          )}
                        >
                          {fetchError || fetchNote}
                        </div>
                      )}

                      <div className="mt-6 border-t border-line pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <SectionLabel>Model catalog</SectionLabel>
                              <span className="rounded border border-line bg-ink-850 px-1.5 py-px font-mono text-[8.5px] text-mist-faint">
                                {enabledCount}/{selectedModels.length} on
                              </span>
                            </div>
                            <p className="mt-0.5 text-[9px] text-mist-ghost">
                              Only enabled models appear in model selectors.
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setAllModels(provider.id, true)}
                              className="rounded px-1.5 py-1 text-[9.5px] text-mist-faint hover:bg-ink-750 hover:text-mint-soft"
                              disabled={selectedModels.length === 0}
                            >
                              Enable all
                            </button>
                            <span className="text-line">·</span>
                            <button
                              onClick={() => setAllModels(provider.id, false)}
                              className="rounded px-1.5 py-1 text-[9.5px] text-mist-faint hover:bg-ink-750 hover:text-coral-soft"
                              disabled={selectedModels.length === 0}
                            >
                              Disable all
                            </button>
                          </div>
                        </div>

                        {selectedModels.length > 5 && (
                          <div className="relative mt-3">
                            <Search
                              size={11}
                              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mist-ghost"
                            />
                            <input
                              value={modelFilter}
                              onChange={(event) => setModelFilter(event.target.value)}
                              placeholder="Filter discovered models…"
                              className="him-input h-7 pl-7 text-[10.5px]"
                            />
                          </div>
                        )}

                        <div className="thin-scrollbar mt-2 max-h-[230px] overflow-y-auto rounded-md border border-line bg-ink-900/40">
                          {selectedModels.length === 0 && (
                            <div className="px-3 py-6 text-center text-[10px] text-mist-ghost">
                              No models yet. Fetch from the provider or add an ID manually.
                            </div>
                          )}
                          {filteredModels.map((model) => (
                            <div
                              key={model.id}
                              className="flex h-8 items-center gap-2 border-b border-line/60 px-2.5 last:border-0 hover:bg-ink-850/60"
                            >
                              <Toggle
                                checked={model.enabled}
                                onChange={(enabled) =>
                                  setModelEnabled(provider.id, model.id, enabled)
                                }
                                label={`Toggle ${model.id}`}
                              />
                              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-mist">
                                {model.id}
                              </span>
                              {model.enabled && (
                                <span className="h-1 w-1 rounded-full bg-mint glow-mint" />
                              )}
                              {model.source === 'manual' && (
                                <span className="rounded border border-line px-1 py-px text-[7.5px] uppercase tracking-[0.1em] text-mist-ghost">
                                  manual
                                </span>
                              )}
                            </div>
                          ))}
                          {selectedModels.length > 0 && filteredModels.length === 0 && (
                            <div className="px-3 py-5 text-center text-[10px] text-mist-ghost">
                              No models match "{modelFilter}".
                            </div>
                          )}
                        </div>

                        <div className="mt-2 flex gap-2">
                          <input
                            value={manualModel}
                            onChange={(event) => {
                              setManualModel(event.target.value);
                              setManualError(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') handleManualAdd();
                            }}
                            placeholder="Add a model ID manually…"
                            spellCheck={false}
                            className="him-input h-7 flex-1 font-mono text-[10px]"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleManualAdd}
                            disabled={!manualModel.trim()}
                          >
                            Add
                          </Button>
                        </div>
                        {manualError && (
                          <p className="mt-1 text-[10px] text-coral-soft">{manualError}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'defaults' && (
              <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mb-4 rounded-lg border border-accent/15 bg-accent/[0.035] px-3.5 py-2.5 text-[10px] leading-relaxed text-mist-dim">
                  Defaults are used by new agents and quick actions. An individual agent can
                  override its model. In Plan mode, sessions without an override use the Planning
                  default. Only enabled models are listed.
                </div>
                <div className="space-y-3">
                  <ModelSelectCard
                    icon={<Bot size={15} />}
                    color="border-accent/25 bg-accent/[0.06] text-accent"
                    title="Primary agent"
                    description="Main Agent Mode sessions and the IDE chat sidebar."
                    kind="primary"
                    value={
                      config?.defaults.primary
                        ? `${config.defaults.primary.providerId}::${config.defaults.primary.modelId}`
                        : ''
                    }
                    onChange={(value) => handleDefaultChange('primary', value)}
                  />
                  <ModelSelectCard
                    icon={<Zap size={15} />}
                    color="border-mint/25 bg-mint/[0.06] text-mint"
                    title="Fast / inline"
                    description="Inline Ctrl+K edits and quick transformations."
                    kind="fast"
                    value={
                      config?.defaults.fast
                        ? `${config.defaults.fast.providerId}::${config.defaults.fast.modelId}`
                        : ''
                    }
                    onChange={(value) => handleDefaultChange('fast', value)}
                  />
                  <ModelSelectCard
                    icon={<Brain size={15} />}
                    color="border-sand/25 bg-sand/[0.06] text-sand"
                    title="Planning"
                    description="Read-only Plan mode analysis and implementation plans."
                    kind="planning"
                    value={
                      config?.defaults.planning
                        ? `${config.defaults.planning.providerId}::${config.defaults.planning.modelId}`
                        : ''
                    }
                    onChange={(value) => handleDefaultChange('planning', value)}
                  />
                </div>
                {providerModelOptions(config).length === 0 && (
                  <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-ink-850 p-3">
                    <p className="text-[10px] text-mist-faint">
                      Enable models before assigning defaults.
                    </p>
                    <Button size="sm" variant="accent" onClick={() => setTab('providers')}>
                      Open providers
                    </Button>
                  </div>
                )}
                <div className="mt-5">
                  <SectionLabel>Active session</SectionLabel>
                  <div className="mt-2 rounded-lg border border-line bg-ink-850/50 px-3.5 py-3 text-[10px] text-mist-faint">
                    {activeSession ? (
                      <>
                        <span className="text-mist">{activeSession.title}</span>
                        {' — '}
                        {activeSession.model
                          ? 'using a pinned session model override'
                          : 'following workspace defaults for its current permission mode'}
                        .
                      </>
                    ) : (
                      'No agent session selected.'
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'integrations' && (
              <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
                <div className="rounded-lg border border-line bg-ink-850/50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Sparkles size={13} className="text-accent" />
                        <span className="text-[12px] font-semibold text-mist-bright">
                          Inline autocomplete · FIM
                        </span>
                        <span className="rounded border border-line px-1.5 py-px font-mono text-[8px] uppercase tracking-wide text-mist-faint">
                          experimental
                        </span>
                      </div>
                      <p className="mt-1 max-w-[500px] text-[9.5px] leading-relaxed text-mist-faint">
                        Ghost-text completions in Monaco. Suggestions appear after a short pause;
                        press Tab to accept and Esc to dismiss. Disabled means zero completion
                        requests.
                      </p>
                    </div>
                    <Toggle
                      checked={config?.fim.enabled === true}
                      onChange={(enabled) => setFim({ enabled })}
                      label="Toggle inline FIM autocomplete"
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Field
                      label="Completion model"
                      hint="Only enabled models are listed"
                    >
                      <select
                        value={
                          config?.fim.model
                            ? `${config.fim.model.providerId}::${config.fim.model.modelId}`
                            : ''
                        }
                        onChange={(event) => handleFimModel(event.target.value)}
                        className="him-input h-8 font-mono text-[10px]"
                        style={{ colorScheme: 'dark' }}
                        disabled={fimOptions.length === 0}
                      >
                        <option value="">Automatic — fast default</option>
                        {providerModelOptions(config).map((option) => (
                          <option
                            key={`${option.provider.id}:${option.model.id}`}
                            value={`${option.provider.id}::${option.model.id}`}
                          >
                            {option.provider.name} · {option.model.id}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Request style">
                      <Segmented
                        value={config?.fim.mode || 'chat'}
                        options={[
                          { value: 'chat', label: 'Chat fallback' },
                          { value: 'fim', label: 'FIM endpoint' },
                        ]}
                        onChange={(value) => setFim({ mode: value as 'fim' | 'chat' })}
                        className="h-8"
                      />
                    </Field>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-mist-ghost">
                    <span>
                      Effective model:{' '}
                      <span className="font-mono text-mist-faint">
                        {fimModel ? `${fimModel.provider.name} · ${fimModel.model.id}` : 'none enabled'}
                      </span>
                    </span>
                    <span>·</span>
                    <span>
                      {config?.fim.mode === 'fim'
                        ? 'POST /completions with prompt + suffix'
                        : 'Uses the selected model’s chat endpoint'}
                    </span>
                  </div>
                  {fimOptions.length === 0 && (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-sand/20 bg-sand/[0.035] px-2.5 py-2 text-[9.5px] text-sand-soft">
                      Add and enable a provider model before FIM can run.
                      <Button size="xs" variant="ghost" onClick={() => setTab('providers')}>
                        Open providers
                      </Button>
                    </div>
                  )}

                  <div className="mt-4 border-t border-line pt-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Github size={12} className="text-mist-faint" />
                          <span className="text-[9px] font-semibold uppercase tracking-[0.13em] text-mist-faint">
                            GitHub Copilot · inline completions
                          </span>
                          <span className="rounded border border-line px-1 text-[7.5px] uppercase tracking-[0.08em] text-mist-ghost">
                            language server
                          </span>
                        </div>
                        <p className="mt-1 max-w-[520px] text-[9.5px] leading-relaxed text-mist-faint">
                          Ghost text powered by GitHub&apos;s Copilot language server — the same
                          server JupyterLab/Neovim Copilot plugins use — with device-flow sign-in.
                          Requires an active Copilot subscription. When enabled it takes precedence
                          over the provider FIM model above, including inside notebook cells.
                        </p>
                        <p className="mt-1 max-w-[520px] text-[8.5px] leading-relaxed text-mist-ghost">
                          Third-party client integration (not a GitHub-supported IDE). Copilot terms
                          and your account policies apply.
                        </p>
                      </div>
                      <Toggle
                        checked={config?.copilot?.enabled === true}
                        onChange={toggleCopilot}
                        label="Toggle GitHub Copilot inline completions"
                      />
                    </div>

                    {config?.copilot?.enabled && (
                      <div className="mt-3 rounded-md border border-line bg-ink-900/40 px-2.5 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-[9px]">
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              copilotStatus?.signedIn
                                ? 'bg-mint'
                                : copilotStatus?.serverAvailable
                                  ? 'bg-sand'
                                  : 'bg-coral',
                            )}
                          />
                          <span className="text-mist-faint">
                            {copilotStatus?.signedIn
                              ? 'Signed in'
                              : copilotStatus?.serverAvailable
                                ? 'Not signed in'
                                : 'Copilot server unavailable'}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-mist-ghost">
                            {copilotStatus?.message || ''}
                          </span>
                          {copilotStatus?.signedIn ? (
                            <Button size="xs" variant="ghost" onClick={() => void signOutCopilot()}>
                              Sign out
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="xs"
                                variant="outline"
                                loading={copilotBusy}
                                onClick={() => void signInCopilot()}
                              >
                                Sign in with GitHub
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                disabled={copilotBusy}
                                onClick={() => void verifyCopilot()}
                                title="Ask Copilot for a sample completion to confirm sign-in worked"
                              >
                                Verify sign-in
                              </Button>
                            </>
                          )}
                        </div>
                        {copilotSignIn?.userCode && !copilotStatus?.signedIn && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-accent/20 bg-accent/[0.04] px-2 py-1.5">
                            <span className="text-[8.5px] text-mist-faint">Enter code</span>
                            <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-accent-soft">
                              {copilotSignIn.userCode}
                            </code>
                            <span className="text-[8.5px] text-mist-ghost">
                              at github.com/login/device
                            </span>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                void him.app.openExternal(
                                  copilotSignIn.verificationUri || 'https://github.com/login/device',
                                )
                              }
                            >
                              Open browser
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(copilotSignIn.userCode || '')
                                  .catch(() => undefined)
                              }
                            >
                              Copy code
                            </Button>
                          </div>
                        )}
                        {copilotError && (
                          <div className="mt-2 text-[8.5px] leading-relaxed text-coral-soft">
                            {copilotError}
                          </div>
                        )}
                        <p className="mt-1.5 text-[8px] leading-relaxed text-mist-ghost">
                          Tip: in file editors and notebook cells, pause and press Tab to accept a
                          suggestion; Alt+\ triggers one manually.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <SectionLabel>External agents · ACP</SectionLabel>
                      <p className="mt-1 max-w-[520px] text-[9.5px] leading-relaxed text-mist-faint">
                        Configured profiles appear under New agent → ACP in Mission Control. Each
                        turn runs the CLI over stdio; streamed messages, tool calls, plans and file
                        edits appear in the session.
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      icon={<Plus size={9} />}
                      onClick={() =>
                        addAcpProfile({
                          name: 'Custom ACP agent',
                          command: '',
                          args: [],
                          enabled: true,
                        })
                      }
                    >
                      Custom profile
                    </Button>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {ACP_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() =>
                          addAcpProfile({
                            name: preset.name,
                            command: preset.command,
                            args: preset.args,
                            preset: preset.name,
                            enabled: preset.enabled !== false,
                          })
                        }
                        className="flex items-center gap-1.5 rounded-md border border-line bg-ink-850/60 px-2 py-1 text-[9px] text-mist-faint transition-colors hover:border-accent/25 hover:text-accent-soft"
                        title={preset.description}
                      >
                        <Plus size={8} /> {preset.name}
                      </button>
                    ))}
                  </div>

                  <div className="mt-2">
                    <button
                      onClick={() => setRegistryOpen((value) => !value)}
                      className="flex items-center gap-1.5 rounded-md border border-line bg-ink-850/40 px-2 py-1 text-[9px] text-mist-faint transition-colors hover:border-accent/25 hover:text-accent-soft"
                    >
                      <Globe size={9} />
                      ACP registry
                      {acpRegistry ? ` (${acpRegistry.length})` : ''}
                      <ChevronDown
                        size={9}
                        className={cn('transition-transform', registryOpen && 'rotate-180')}
                      />
                    </button>
                    {registryOpen && (
                      <div className="mt-1.5 space-y-1 rounded-lg border border-line bg-ink-900/40 p-2">
                        {acpRegistry === null && (
                          <div className="px-2 py-1 text-[9px] text-mist-ghost">Loading registry…</div>
                        )}
                        {(acpRegistry || []).map((entry) => (
                          <div
                            key={entry.id}
                            className="flex items-start gap-2 rounded border border-line/60 bg-ink-850/30 p-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-medium text-mist-bright">
                                  {entry.name}
                                </span>
                                {entry.capabilities.images && (
                                  <span className="rounded border border-line px-1 text-[7px] uppercase text-mist-ghost">
                                    images
                                  </span>
                                )}
                                {entry.capabilities.terminal && (
                                  <span className="rounded border border-line px-1 text-[7px] uppercase text-mist-ghost">
                                    terminal
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[8.5px] leading-relaxed text-mist-faint">
                                {entry.description}
                              </div>
                              <div className="mt-0.5 font-mono text-[8px] text-mist-ghost">
                                {entry.installHint}
                              </div>
                              {entry.authHint && (
                                <div className="mt-0.5 text-[8px] text-sand/80">{entry.authHint}</div>
                              )}
                            </div>
                            <Button
                              size="xs"
                              variant="outline"
                              icon={<Plus size={8} />}
                              loading={registryBusy === entry.id}
                              onClick={() => void addFromRegistry(entry)}
                            >
                              Add
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 space-y-2">
                    {(config?.acpAgents || []).map((profile) => (
                      <div
                        key={profile.id}
                        className="rounded-lg border border-line bg-ink-900/40 p-3"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            value={profile.name}
                            onChange={(event) =>
                              updateAcpProfile(profile.id, { name: event.target.value })
                            }
                            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[10.5px] font-medium text-mist-bright outline-none"
                            placeholder="ACP agent name"
                          />
                          <Toggle
                            checked={profile.enabled}
                            onChange={(enabled) => updateAcpProfile(profile.id, { enabled })}
                            label={`Toggle ${profile.name}`}
                          />
                          <button
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                `${profile.command} ${profile.args.join(' ')}`.trim(),
                              );
                              toast('success', 'ACP launch command copied.');
                            }}
                            className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
                            title="Copy launch command"
                            aria-label="Copy launch command"
                          >
                            <Copy size={10} />
                          </button>
                          <IconButton
                            label="Delete ACP profile"
                            tone="danger"
                            size="xs"
                            onClick={() => deleteAcpProfile(profile.id)}
                          >
                            <Trash2 size={10} />
                          </IconButton>
                        </div>
                        <div className="mt-2 grid grid-cols-[160px_1fr] gap-2">
                          <input
                            value={profile.command}
                            onChange={(event) =>
                              updateAcpProfile(profile.id, { command: event.target.value })
                            }
                            className="him-input h-7 font-mono text-[9.5px]"
                            placeholder="command"
                            spellCheck={false}
                          />
                          <input
                            value={profile.args.join(' ')}
                            onChange={(event) =>
                              updateAcpProfile(profile.id, {
                                args: parseAcpArgs(event.target.value),
                              })
                            }
                            className="him-input h-7 font-mono text-[9.5px]"
                            placeholder="args, e.g. acp"
                            spellCheck={false}
                          />
                        </div>
                        <div className="mt-1.5 font-mono text-[8px] text-mist-ghost">
                          {profile.enabled
                            ? 'Mission Control ready · CLI must be installed and authenticated separately'
                            : 'disabled · enable the toggle to use this profile'}
                        </div>
                      </div>
                    ))}
                    {(config?.acpAgents || []).length === 0 && (
                      <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[9.5px] text-mist-ghost">
                        No ACP profiles yet. Add OpenCode, Cline, Kilo, Antigravity
                        or a custom command above (CLI-only agents belong under CLI agents below).
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <SectionLabel>CLI agents · terminal bridge</SectionLabel>
                      <p className="mt-1 max-w-[540px] text-[9.5px] leading-relaxed text-mist-faint">
                        For agent CLIs that don’t support ACP (Freebuff, Aider, Claude Code, Codex,
                        Gemini…). HIM+ runs the CLI in a real PTY inside the chat pane; use the raw
                        terminal for sign-in and menus. The CLI keeps its own tools, permissions and
                        approvals — HIM+ Review mode does not gate it.
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      icon={<Plus size={9} />}
                      onClick={() =>
                        addCliProfile({
                          name: 'Custom CLI agent',
                          command: '',
                          args: [],
                          enabled: true,
                        })
                      }
                    >
                      Custom CLI
                    </Button>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {CLI_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() =>
                          addCliProfile({
                            name: preset.name,
                            command: preset.command,
                            args: preset.args,
                            enabled: true,
                            preset: preset.name,
                          })
                        }
                        className="flex items-center gap-1.5 rounded-md border border-line bg-ink-850/60 px-2 py-1 text-[9px] text-mist-faint transition-colors hover:border-sand/30 hover:text-sand-soft"
                        title={preset.description}
                      >
                        <Plus size={8} /> {preset.name}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 space-y-2">
                    {(config?.cliAgents || []).map((profile) => (
                      <div
                        key={profile.id}
                        className="rounded-lg border border-line bg-ink-900/40 p-3"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            value={profile.name}
                            onChange={(event) =>
                              updateCliProfile(profile.id, { name: event.target.value })
                            }
                            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[10.5px] font-medium text-mist-bright outline-none"
                            placeholder="CLI agent name"
                          />
                          <span className="rounded border border-sand/20 bg-sand/[0.05] px-1 py-px font-mono text-[7px] uppercase tracking-wide text-sand-soft">
                            CLI
                          </span>
                          <Toggle
                            checked={profile.enabled}
                            onChange={(enabled) => updateCliProfile(profile.id, { enabled })}
                            label={`Toggle ${profile.name}`}
                          />
                          <IconButton
                            label="Delete CLI profile"
                            tone="danger"
                            size="xs"
                            onClick={() => deleteCliProfile(profile.id)}
                          >
                            <Trash2 size={10} />
                          </IconButton>
                        </div>
                        <div className="mt-2 grid grid-cols-[160px_1fr] gap-2">
                          <input
                            value={profile.command}
                            onChange={(event) =>
                              updateCliProfile(profile.id, { command: event.target.value })
                            }
                            className="him-input h-7 font-mono text-[9.5px]"
                            placeholder="command, e.g. freebuff"
                            spellCheck={false}
                          />
                          <input
                            value={profile.args.join(' ')}
                            onChange={(event) =>
                              updateCliProfile(profile.id, {
                                args: parseAcpArgs(event.target.value),
                              })
                            }
                            className="him-input h-7 font-mono text-[9.5px]"
                            placeholder="args (optional)"
                            spellCheck={false}
                          />
                        </div>
                        <div className="mt-1.5 font-mono text-[8px] text-mist-ghost">
                          {profile.enabled
                            ? 'Appears under New agent → CLI agents. Runs with your OS permissions.'
                            : 'disabled · enable the toggle to use this profile'}
                        </div>
                      </div>
                    ))}
                    {(config?.cliAgents || []).length === 0 && (
                      <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[9.5px] text-mist-ghost">
                        No CLI profiles yet. Add Freebuff, Aider, Claude Code, Codex, Gemini or a
                        custom command above.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'appearance' && (
              <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <SectionLabel>Theme</SectionLabel>
                    <p className="mt-1 text-[10px] text-mist-faint">
                      7 presets. The editor, terminal, diffs and every surface switch together.
                    </p>
                  </div>
                  <span className="rounded border border-line bg-ink-850 px-1.5 py-0.5 font-mono text-[8.5px] text-mist-faint">
                    current: {activeTheme.name}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map((theme) => {
                    const active = activeTheme.id === theme.id;
                    return (
                      <button
                        key={theme.id}
                        data-theme-option={theme.id}
                        onClick={() => chooseTheme(theme.id)}
                        className={cn(
                          'rounded-lg border p-2.5 text-left transition-colors',
                          active
                            ? 'border-accent/45 bg-ink-750'
                            : 'border-line bg-ink-850/50 hover:border-line-strong hover:bg-ink-800/80',
                        )}
                      >
                        <div
                          className="h-[54px] overflow-hidden rounded-md border border-line"
                          style={{ background: theme.colors.ink900 }}
                        >
                          <div
                            className="flex h-4 items-center gap-1 border-b px-1.5"
                            style={{
                              background: theme.colors.ink850,
                              borderColor: theme.colors.line,
                            }}
                          >
                            <span
                              className="h-1 w-1 rounded-full"
                              style={{ background: theme.colors.accent }}
                            />
                            <span
                              className="h-1 w-8 rounded-full"
                              style={{ background: theme.colors.mistBright, opacity: 0.55 }}
                            />
                          </div>
                          <div className="flex gap-1 p-1.5">
                            <div
                              className="h-[27px] w-[30%] rounded-[3px]"
                              style={{ background: theme.colors.ink800 }}
                            />
                            <div className="flex flex-1 flex-col justify-between py-0.5">
                              <div
                                className="h-1 rounded-full"
                                style={{ background: theme.colors.mist, width: '80%' }}
                              />
                              <div
                                className="h-1 rounded-full"
                                style={{ background: theme.colors.line, width: '60%' }}
                              />
                              <div className="flex gap-1">
                                <span
                                  className="h-2 w-5 rounded-[2px]"
                                  style={{ background: theme.colors.accent }}
                                />
                                <span
                                  className="h-2 w-5 rounded-[2px]"
                                  style={{ background: theme.colors.mint }}
                                />
                                <span
                                  className="h-2 w-5 rounded-[2px]"
                                  style={{ background: theme.colors.coral }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className="text-[10.5px] font-medium text-mist-bright">
                            {theme.name}
                          </span>
                          {theme.tag && (
                            <span className="rounded border border-line px-1 text-[7px] uppercase tracking-[0.1em] text-mist-faint">
                              {theme.tag}
                            </span>
                          )}
                          <span className="ml-auto flex items-center gap-1 font-mono text-[8px] uppercase tracking-wide text-mist-ghost">
                            {theme.mode === 'light' ? <Sun size={8} /> : <Monitor size={8} />}
                            {theme.mode}
                          </span>
                          {active && <Check size={11} className="text-accent" />}
                        </div>
                        <div className="mt-0.5 truncate text-[8.5px] text-mist-ghost">
                          {theme.blurb}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-line bg-ink-850/50 px-4 py-3">
                    <div>
                      <div className="text-[11.5px] font-medium text-mist-bright">Minimap</div>
                      <div className="mt-0.5 text-[9.5px] text-mist-faint">
                        Show the code minimap in Monaco editor tabs.
                      </div>
                    </div>
                    <Toggle
                      checked={config?.prefs.minimap !== false}
                      onChange={(checked) => setPrefs({ minimap: checked })}
                      label="Toggle minimap"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-line bg-ink-850/50 px-4 py-3">
                    <div>
                      <div className="text-[11.5px] font-medium text-mist-bright">
                        Restrict file access to the workspace
                      </div>
                      <div className="mt-0.5 max-w-[430px] text-[9.5px] leading-relaxed text-mist-faint">
                        Blocks the editor and agent file operations from reading or writing outside
                        the opened folder. Shell commands run with your normal user permissions and
                        are not OS-sandboxed, so approvals still matter.
                      </div>
                    </div>
                    <Toggle
                      checked={config?.prefs.restrictFileAccess !== false}
                      onChange={(checked) => {
                        setPrefs({ restrictFileAccess: checked });
                        void him.fs
                          .setWorkspaceAccess(workspace || null, checked)
                          .catch(() => undefined);
                      }}
                      label="Toggle workspace file-access restriction"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-line bg-ink-850/50 px-4 py-3">
                    <div>
                      <div className="text-[11.5px] font-medium text-mist-bright">
                        Match JupyterLab notebook behaviour
                      </div>
                      <div className="mt-0.5 max-w-[460px] text-[9.5px] leading-relaxed text-mist-faint">
                        {jupyterConfig?.detected
                          ? `Detected ${jupyterConfig.themeName || 'a custom JupyterLab theme'} — cell line numbers ${jupyterConfig.lineNumbers ? 'on' : 'off'}, soft wrap ${jupyterConfig.lineWrap ? 'on' : 'off'}, auto-closing brackets ${jupyterConfig.autoClosingBrackets ? 'on' : 'off'}. The visual theme stays HIM+.`
                          : 'No ~/.jupyter custom configuration detected. Notebook cells keep HIM+ defaults.'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void loadJupyter()}
                        title="Re-read ~/.jupyter configuration"
                      >
                        Rescan
                      </Button>
                      <Toggle
                        checked={config?.prefs.matchJupyterNotebook !== false}
                        onChange={(checked) => setPrefs({ matchJupyterNotebook: checked })}
                        label="Toggle JupyterLab notebook behaviour"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-line bg-ink-850/50 px-4 py-3">
                    <div>
                      <div className="text-[11.5px] font-medium text-mist-bright">
                        Automatic data wrangler
                      </div>
                      <div className="mt-0.5 max-w-[460px] text-[9.5px] leading-relaxed text-mist-faint">
                        Open the DataFrame grid automatically after a cell run and focus the newest
                        DataFrame. Disable to open it only from the notebook toolbar.
                      </div>
                    </div>
                    <Toggle
                      checked={config?.prefs.notebookAutoWrangle !== false}
                      onChange={(checked) => setPrefs({ notebookAutoWrangle: checked })}
                      label="Toggle automatic data wrangler"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-line bg-ink-850/50 px-4 py-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-mist-bright">
                        <Keyboard size={12} className="text-mist-faint" />
                        Mechanical key sounds
                      </div>
                      <div className="mt-0.5 text-[9.5px] text-mist-faint">
                        Classic key clicks for letters and Backspace. Space and Enter use
                        real Cherry MX Brown recordings.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<Volume2 size={10} />}
                        onClick={playSoundPreview}
                      >
                        Preview
                      </Button>
                      <Toggle
                        checked={config?.prefs.keyboardSound !== false}
                        onChange={(checked) => setPrefs({ keyboardSound: checked })}
                        label="Toggle mechanical key sounds"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-line bg-ink-850/50 px-4 py-3">
                    <div>
                      <div className="text-[11.5px] font-medium text-mist-bright">Last used mode</div>
                      <div className="mt-0.5 text-[9.5px] text-mist-faint">
                        HIM+ restores the last active workspace mode on launch.
                      </div>
                    </div>
                    <button
                      onClick={() => setTabMode(config?.prefs.mode === 'ide' ? 'agent' : 'ide')}
                      className="rounded border border-line bg-ink-800 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-mist-faint hover:text-mist"
                    >
                      now: {config?.prefs.mode || 'agent'}
                    </button>
                  </div>
                </div>

                <div className="mt-5">
                  <SectionLabel>Local runtime</SectionLabel>
                  <div className="mt-2 space-y-2 rounded-lg border border-line bg-ink-900/40 p-3.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-mist-faint">Desktop shell</span>
                      <span className="font-mono text-mist">
                        Electron {him.versions.electron}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-mist-faint">Chromium</span>
                      <span className="font-mono text-mist">{him.versions.chrome}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-mist-faint">Terminal engine</span>
                      <span className="font-mono text-mist">child_process fallback</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-mist-faint">Conversation store</span>
                      <span className="font-mono text-mist">SQLite · chats.db</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-mist-faint">Config file</span>
                      <span className="max-w-[280px] truncate font-mono text-[9px] text-mist-faint">
                        {configPath}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-[9px] leading-relaxed text-mist-ghost">
                    The terminal uses the local system shell line-by-line. It is intentionally not
                    a full PTY; node-pty can be added as an optional backend later.
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Copy size={11} />}
                    onClick={() => void copyConfigPath()}
                  >
                    Copy config path
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<KeyRound size={11} />}
                    onClick={() => void him.config.reveal()}
                  >
                    Reveal config file
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Database size={11} />}
                    onClick={() => void him.chats.reveal()}
                  >
                    Reveal chat database
                  </Button>
                </div>
              </div>
            )}

            {tab === 'about' && (
              <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
                <BrandBanner className="w-full max-w-[380px] rounded-xl border border-line shadow-inset" />
                <div className="mt-3 flex items-center gap-2 text-[9.5px] text-mist-faint">
                  <span className="font-mono text-[9px] text-mist-faint">
                    Version {appInfo?.version || '0.1.0'}
                    {appInfo ? (appInfo.packaged ? ' · packaged' : ' · dev') : ''}
                  </span>
                  <span className="text-line">·</span>
                  <span>Integrated development environment</span>
                </div>
                <p className="mt-4 max-w-[520px] text-[10.5px] leading-relaxed text-mist-faint">
                  HIM+ is a desktop code environment with two synchronized surfaces: Mission
                  Control for autonomous coding agents, and a fast IDE with inline AI edits. Bring
                  your own OpenAI-compatible models; nothing routes through a HIM+ server.
                </p>
                <p className="mt-2 max-w-[520px] text-[10px] leading-relaxed text-mist-ghost">
                  Conversations are persisted locally in SQLite. Every agent can search prior
                  conversations through the search_chats and read_chat tools.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-line bg-ink-850/50 p-3.5">
                    <SectionLabel>Keyboard</SectionLabel>
                    <div className="mt-2 space-y-1.5">
                      {[
                        ['Switch mode', 'Ctrl Shift M'],
                        ['Settings', 'Ctrl ,'],
                        ['Inline edit', 'Ctrl K'],
                        ['Cycle permission', 'Shift Tab'],
                        ['Terminal drawer', 'Ctrl J'],
                        ['Save file', 'Ctrl S'],
                      ].map(([label, shortcut]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between text-[10px] text-mist-faint"
                        >
                          <span>{label}</span>
                          <Kbd>{shortcut}</Kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-line bg-ink-850/50 p-3.5">
                    <SectionLabel>Stack</SectionLabel>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[
                        'Electron',
                        'React',
                        'TypeScript',
                        'Vite',
                        'Tailwind',
                        'Zustand',
                        'Monaco',
                        'xterm.js',
                      ].map((item) => (
                        <span
                          key={item}
                          className="rounded border border-line bg-ink-900/60 px-1.5 py-0.5 text-[9px] text-mist-faint"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-line bg-ink-850/50 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <SectionLabel>Updates</SectionLabel>
                      <p className="mt-1 max-w-[400px] text-[9px] leading-relaxed text-mist-faint">
                        HIM+ is distributed as a portable build. {appInfo?.feedConfigured
                          ? 'An update feed is configured; check for a newer release below.'
                          : 'No update feed is configured (set HIM_UPDATE_MANIFEST_URL or userData/update-feed.json).'}
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      loading={updateBusy}
                      onClick={() => void checkUpdates()}
                    >
                      Check for updates
                    </Button>
                  </div>
                  {updateResult && (
                    <div className="mt-2 rounded border border-line/70 bg-ink-900/50 px-2.5 py-1.5 text-[9px] leading-relaxed">
                      {updateResult.error ? (
                        <span className="text-mist-ghost">{updateResult.error}</span>
                      ) : updateResult.updateAvailable ? (
                        <span className="text-sand-soft">
                          Version {updateResult.latestVersion} is available (you have{' '}
                          {updateResult.currentVersion}).
                          {updateResult.sha256 ? (
                            <span className="mt-1 block break-all font-mono text-[8px] text-mist-ghost">
                              SHA-256: {updateResult.sha256}
                            </span>
                          ) : null}
                          <span className="mt-1 block text-mist-ghost">
                            Releases are unsigned unless you build with your own certificate; verify
                            the checksum before running a downloaded build.
                          </span>
                          {updateResult.url ? (
                            <span className="mt-1 block">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  void him.app.openExternal(updateResult.url as string)
                                }
                              >
                                Open release page
                              </Button>
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-mist-faint">
                          You are on the latest reported version ({updateResult.currentVersion}).
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-sand/20 bg-sand/[0.035] p-3.5">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck size={12} className="text-sand" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sand-soft">
                      Key storage
                    </span>
                  </div>
                  <p className="mt-1.5 text-[9.5px] leading-relaxed text-mist-faint">
                    Provider API keys are encrypted at rest with Electron safeStorage (Windows DPAPI
                    / OS credential protection) and stored with an <code>enc:</code> prefix in the
                    local config. They are sent only to the provider endpoint you configure. Shell
                    commands run with your OS user permissions under the selected approval preset —
                    they are not OS-sandboxed. File tools and (by default) the editor stay inside the
                    workspace. Use Review mode for untrusted repositories.
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-ink-850/40 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-mist-ghost">
                      Config
                    </div>
                    <div className="truncate font-mono text-[9px] text-mist-faint" title={configPath}>
                      {configPath}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={<Copy size={10} />}
                      onClick={() => void copyConfigPath()}
                    >
                      Copy
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={<KeyRound size={10} />}
                      onClick={() => void him.config.reveal()}
                    >
                      Reveal
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </Modal>

      <Modal
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        className="max-w-[430px]"
      >
        <div className="p-5">
          <h3 className="text-[13px] font-semibold text-mist-bright">Delete this provider?</h3>
          <p className="mt-2 text-[11px] leading-relaxed text-mist-dim">
            {provider?.name} and its {selectedModels.length} cached model entries will be removed.
            Defaults pointing at this provider will be cleared. API keys are not recoverable from
            the app after deletion.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={handleDelete}>
              Delete provider
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

