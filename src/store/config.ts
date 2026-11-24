import { create } from 'zustand';
import type {
  AcpAgentProfile,
  AppConfig,
  AppPrefs,
  CliAgentProfile,
  FimConfig,
  ModelEntry,
  ModelOption,
  ModelRef,
  ProviderConfig,
  ProviderDefaults,
} from '@shared/types';
import { him, cleanErrorMessage } from '../lib/bridge';
import { uid } from '../lib/utils';
import { toast } from './toast';

export type DefaultKind = keyof ProviderDefaults;

// `ModelOption` moved to shared/types.ts so the agent host interface can name it
// without importing this renderer store. Re-exported for existing callers.
export type { ModelOption };

function cloneConfig(config: AppConfig): AppConfig {
  return structuredClone(config);
}

export function providerModelOptions(config: AppConfig | null): ModelOption[] {
  if (!config) return [];
  const options: ModelOption[] = [];
  for (const provider of config.providers) {
    for (const model of provider.models) {
      if (!model.enabled) continue;
      options.push({
        ref: { providerId: provider.id, modelId: model.id },
        provider,
        model,
        label: model.id,
      });
    }
  }
  return options;
}

export function findModelOption(
  config: AppConfig | null,
  ref: ModelRef | null | undefined,
): ModelOption | null {
  if (!config || !ref) return null;
  const provider = config.providers.find((item) => item.id === ref.providerId);
  if (!provider) return null;
  const model = provider.models.find((item) => item.id === ref.modelId);
  if (!model || !model.enabled) return null;
  return { ref, provider, model, label: model.id };
}

export function resolveDefaultModel(
  config: AppConfig | null,
  kind: DefaultKind,
): ModelOption | null {
  if (!config) return null;
  const enabled = providerModelOptions(config);
  if (enabled.length === 0) return null;
  const configured = findModelOption(config, config.defaults[kind]);
  if (configured) return configured;
  if (kind !== 'primary') {
    const primary = findModelOption(config, config.defaults.primary) || enabled[0];
    if (kind === 'fast') return primary;
    if (kind === 'planning') return primary;
  }
  return enabled[0];
}

export function modelRefLabel(config: AppConfig | null, ref: ModelRef | null): string {
  const option = findModelOption(config, ref);
  if (!option) return 'No model';
  return `${option.provider.name} · ${option.model.id}`;
}

function firstEnabledRef(config: AppConfig): ModelRef | null {
  return providerModelOptions(config)[0]?.ref || null;
}

function assignMissingDefaults(config: AppConfig): void {
  const first = firstEnabledRef(config);
  if (!first) return;
  if (!findModelOption(config, config.defaults.primary)) config.defaults.primary = first;
  if (!findModelOption(config, config.defaults.fast)) config.defaults.fast = first;
  if (!findModelOption(config, config.defaults.planning)) config.defaults.planning = first;
}

function clearDisabledDefaults(config: AppConfig): void {
  (['primary', 'fast', 'planning'] as DefaultKind[]).forEach((kind) => {
    const ref = config.defaults[kind];
    if (ref && !findModelOption(config, ref)) config.defaults[kind] = null;
  });
}

interface ConfigStore {
  config: AppConfig | null;
  configPath: string;
  loaded: boolean;
  loadError?: string;
  init(): Promise<void>;
  addProvider(partial?: Partial<ProviderConfig>): string;
  updateProvider(id: string, patch: Partial<ProviderConfig>): void;
  deleteProvider(id: string): void;
  fetchModels(id: string): Promise<{ added: number; total: number }>;
  addManualModel(providerId: string, modelId: string): boolean;
  setModelEnabled(providerId: string, modelId: string, enabled: boolean): void;
  setAllModels(providerId: string, enabled: boolean): void;
  setDefault(kind: DefaultKind, ref: ModelRef | null): void;
  setPrefs(patch: Partial<AppPrefs>): void;
  setLastWorkspace(path: string | null): void;
  setFim(patch: Partial<FimConfig>): void;
  setCopilotEnabled(enabled: boolean): void;
  addAcpProfile(partial: Partial<AcpAgentProfile>): string;
  updateAcpProfile(id: string, patch: Partial<AcpAgentProfile>): void;
  deleteAcpProfile(id: string): void;
  addCliProfile(partial: Partial<CliAgentProfile>): string;
  updateCliProfile(id: string, patch: Partial<CliAgentProfile>): void;
  deleteCliProfile(id: string): void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistChain: Promise<void> = Promise.resolve();

function schedulePersist(get: () => ConfigStore): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const config = get().config;
    if (!config) return;
    const snapshot = cloneConfig(config);
    persistChain = persistChain
      .then(() => him.config.save(snapshot))
      .catch((error) => {
        toast('error', cleanErrorMessage(error), 'Could not save configuration');
      });
  }, 220);
}

export const useConfigStore = create<ConfigStore>()((set, get) => {
  const commit = (mutator: (draft: AppConfig) => void) => {
    const current = get().config;
    if (!current) return;
    const draft = cloneConfig(current);
    mutator(draft);
    set({ config: draft });
    schedulePersist(get);
  };

  return {
    config: null,
    configPath: '',
    loaded: false,
    init: async () => {
      if (get().loaded) return;
      try {
        const [config, configPath] = await Promise.all([him.config.get(), him.config.path()]);
        set({ config, configPath, loaded: true, loadError: undefined });
      } catch (error) {
        set({ loaded: true, loadError: cleanErrorMessage(error) });
      }
    },
    addProvider: (partial) => {
      const now = Date.now();
      const provider: ProviderConfig = {
        id: uid('prov'),
        name: partial?.name || 'New provider',
        baseUrl: partial?.baseUrl || '',
        apiKey: partial?.apiKey || '',
        headers: partial?.headers || {},
        models: partial?.models || [],
        createdAt: now,
        updatedAt: now,
      };
      commit((draft) => {
        draft.providers.push(provider);
      });
      return provider.id;
    },
    updateProvider: (id, patch) => {
      commit((draft) => {
        const provider = draft.providers.find((item) => item.id === id);
        if (!provider) return;
        Object.assign(provider, patch, { id: provider.id, updatedAt: Date.now() });
        clearDisabledDefaults(draft);
      });
    },
    deleteProvider: (id) => {
      commit((draft) => {
        draft.providers = draft.providers.filter((provider) => provider.id !== id);
        (['primary', 'fast', 'planning'] as DefaultKind[]).forEach((kind) => {
          if (draft.defaults[kind]?.providerId === id) draft.defaults[kind] = null;
        });
      });
    },
    fetchModels: async (id) => {
      const config = get().config;
      const provider = config?.providers.find((item) => item.id === id);
      if (!provider) throw new Error('Provider not found.');
      if (!provider.baseUrl.trim()) throw new Error('Set a base URL before fetching models.');
      const result = await him.llm.fetchModels({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        headers: provider.headers,
      });
      let added = 0;
      commit((draft) => {
        const target = draft.providers.find((item) => item.id === id);
        if (!target) return;
        const existing = new Set(target.models.map((model) => model.id));
        for (const modelId of result.models) {
          if (existing.has(modelId)) continue;
          existing.add(modelId);
          target.models.push({ id: modelId, enabled: false, source: 'fetched' });
          added += 1;
        }
        target.models.sort((a, b) => a.id.localeCompare(b.id));
        target.updatedAt = Date.now();
      });
      return { added, total: result.models.length };
    },
    addManualModel: (providerId, modelId) => {
      const trimmed = modelId.trim();
      if (!trimmed) return false;
      let added = false;
      commit((draft) => {
        const provider = draft.providers.find((item) => item.id === providerId);
        if (!provider) return;
        const existing = provider.models.find((model) => model.id === trimmed);
        if (existing) {
          if (!existing.enabled) {
            existing.enabled = true;
            assignMissingDefaults(draft);
          }
          return;
        }
        provider.models.push({ id: trimmed, enabled: true, source: 'manual' });
        provider.models.sort((a, b) => a.id.localeCompare(b.id));
        provider.updatedAt = Date.now();
        assignMissingDefaults(draft);
        added = true;
      });
      return added;
    },
    setModelEnabled: (providerId, modelId, enabled) => {
      commit((draft) => {
        const provider = draft.providers.find((item) => item.id === providerId);
        const model = provider?.models.find((item) => item.id === modelId);
        if (!provider || !model) return;
        model.enabled = enabled;
        provider.updatedAt = Date.now();
        if (enabled) {
          assignMissingDefaults(draft);
        } else {
          (['primary', 'fast', 'planning'] as DefaultKind[]).forEach((kind) => {
            const ref = draft.defaults[kind];
            if (ref?.providerId === providerId && ref.modelId === modelId) {
              draft.defaults[kind] = null;
            }
          });
          assignMissingDefaults(draft);
        }
      });
    },
    setAllModels: (providerId, enabled) => {
      commit((draft) => {
        const provider = draft.providers.find((item) => item.id === providerId);
        if (!provider) return;
        provider.models.forEach((model) => {
          model.enabled = enabled;
        });
        provider.updatedAt = Date.now();
        if (enabled) {
          assignMissingDefaults(draft);
        } else {
          (['primary', 'fast', 'planning'] as DefaultKind[]).forEach((kind) => {
            if (draft.defaults[kind]?.providerId === providerId) draft.defaults[kind] = null;
          });
          assignMissingDefaults(draft);
        }
      });
    },
    setDefault: (kind, ref) => {
      commit((draft) => {
        draft.defaults[kind] = ref;
      });
    },
    setPrefs: (patch) => {
      commit((draft) => {
        draft.prefs = { ...draft.prefs, ...patch };
      });
    },
    setLastWorkspace: (path) => {
      commit((draft) => {
        draft.lastWorkspace = path;
      });
    },
    setFim: (patch) => {
      commit((draft) => {
        draft.fim = { ...draft.fim, ...patch };
      });
    },
    setCopilotEnabled: (enabled) => {
      commit((draft) => {
        draft.copilot = { enabled };
      });
    },
    addAcpProfile: (partial) => {
      const id = uid('acp');
      commit((draft) => {
        draft.acpAgents.push({
          id,
          name: partial.name || 'ACP agent',
          command: partial.command || '',
          args: partial.args || [],
          env: partial.env || {},
          enabled: partial.enabled !== false,
          preset: partial.preset,
        });
      });
      return id;
    },
    updateAcpProfile: (id, patch) => {
      commit((draft) => {
        const profile = draft.acpAgents.find((item) => item.id === id);
        if (profile) Object.assign(profile, patch, { id: profile.id });
      });
    },
    deleteAcpProfile: (id) => {
      commit((draft) => {
        draft.acpAgents = draft.acpAgents.filter((profile) => profile.id !== id);
      });
    },
    addCliProfile: (partial) => {
      const id = uid('cli');
      commit((draft) => {
        draft.cliAgents.push({
          id,
          name: partial.name || 'CLI agent',
          command: partial.command || '',
          args: partial.args || [],
          env: partial.env || {},
          enabled: partial.enabled !== false,
          preset: partial.preset,
        });
      });
      return id;
    },
    updateCliProfile: (id, patch) => {
      commit((draft) => {
        const profile = draft.cliAgents.find((item) => item.id === id);
        if (profile) Object.assign(profile, patch, { id: profile.id });
      });
    },
    deleteCliProfile: (id) => {
      commit((draft) => {
        draft.cliAgents = draft.cliAgents.filter((profile) => profile.id !== id);
      });
    },
  };
});
