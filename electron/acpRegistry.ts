import { execFileSync } from 'node:child_process';
import type { AcpHealthResult, AcpRegistryEntry } from '../shared/types';

/**
 * Curated ACP agent registry. Everything here is launchable locally with a known
 * ACP entry point; entries without upstream ACP support (e.g. Freebuff) belong in
 * the CLI-agent terminal bridge instead of this list.
 */
export const ACP_REGISTRY: AcpRegistryEntry[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Open-source coding agent with a rich ACP mode and model catalog.',
    command: 'opencode',
    args: ['acp'],
    installHint: 'npm i -g opencode-ai  ·  then `opencode auth login`',
    authHint: 'Authenticate with `opencode auth login`.',
    capabilities: { images: true, files: true, terminal: true },
    platform: 'all',
  },
  {
    id: 'kilo',
    name: 'Kilo',
    description: 'Kilo Code CLI (kilo acp) — many providers and agent modes.',
    command: 'npx',
    args: ['-y', '@kilocode/cli@latest', 'acp'],
    installHint: 'Runs via npx; install optionally with `npm i -g @kilocode/cli`.',
    authHint: 'Run `kilo auth` (or sign in when prompted).',
    capabilities: { images: true, files: true, terminal: true },
    platform: 'all',
  },
  {
    id: 'cline',
    name: 'Cline',
    description: 'Cline ACP mode. Requires its own sign-in on first session.',
    command: 'npx',
    args: ['-y', 'cline@latest', '--acp'],
    installHint: 'Runs via npx; no global install required.',
    authHint: 'Select “Load models” once and complete the Cline sign-in.',
    capabilities: { images: true, files: true, terminal: true },
    platform: 'all',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    description: 'Copilot CLI in ACP mode (public preview).',
    command: 'npx',
    args: ['-y', '@github/copilot@latest', '--acp'],
    installHint: 'Requires Node.js 22.13+; runs via npx.',
    authHint: 'Run `copilot login` once in a terminal before starting.',
    capabilities: { images: true, files: true, terminal: true },
    platform: 'all',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'Google Gemini CLI with experimental ACP mode.',
    command: 'npx',
    args: ['-y', '@google/gemini-cli@latest', '--experimental-acp'],
    installHint: 'Runs via npx; or `npm i -g @google/gemini-cli`.',
    authHint: 'Sign in or set GEMINI_API_KEY when prompted.',
    capabilities: { images: true, files: true, terminal: true },
    platform: 'all',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    description: 'Qwen Code CLI ACP server.',
    command: 'qwen',
    args: ['--acp'],
    installHint: 'npm i -g @qwen-code/qwen-code',
    authHint: 'Run `qwen` once to configure an account or API key.',
    capabilities: { images: false, files: true, terminal: true },
    platform: 'all',
  },
  {
    id: 'codex',
    name: 'Codex CLI (ACP bridge)',
    description: 'OpenAI Codex CLI via the Zed ACP adapter.',
    command: 'npx',
    args: ['-y', '@zed-industries/codex-acp@latest'],
    installHint: 'Runs via npx; requires the codex CLI credentials.',
    authHint: 'Run `codex login` first.',
    capabilities: { images: false, files: true, terminal: true },
    platform: 'all',
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    description: 'Hermes Agent ACP server.',
    command: 'hermes',
    args: ['acp'],
    installHint: 'pip install "hermes-agent[acp]"',
    authHint: 'Configure Hermes provider credentials.',
    capabilities: { images: false, files: true, terminal: true },
    platform: 'all',
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    description: 'DeepSeek Harness ACP stdio server.',
    command: 'dsh',
    args: ['--profile', 'acp'],
    installHint: 'Install DeepSeek Harness and expose `dsh` on PATH.',
    authHint: 'Configure credentials in the Harness profile.',
    capabilities: { images: false, files: true, terminal: true },
    platform: 'all',
  },
];

function commandExists(command: string): boolean {
  try {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    execFileSync(probe, [command], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export function acpRegistry(): AcpRegistryEntry[] {
  return ACP_REGISTRY.map((entry) => ({
    ...entry,
    capabilities: { ...entry.capabilities },
    args: [...entry.args],
  }));
}

export function checkAcpHealth(command: string, args: string[]): AcpHealthResult {
  if (!command || !command.trim()) {
    return { ok: false, command: '', error: 'No launch command configured.' };
  }
  const baseCommand = command.trim();
  if (!commandExists(baseCommand)) {
    return {
      ok: false,
      command: baseCommand,
      error: `Command "${baseCommand}" was not found on PATH.`,
    };
  }
  if (baseCommand === 'npx' || baseCommand === 'npm' || baseCommand === 'pnpm') {
    return {
      ok: true,
      command: baseCommand,
      version: '(npx — first run downloads the agent package)',
    };
  }
  try {
    const output = execFileSync(baseCommand, [...(args || []), '--version'], {
      encoding: 'utf8',
      timeout: 8_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, command: baseCommand, version: output.trim().split('\n')[0] || undefined };
  } catch (error) {
    // The command exists; version flags vary by agent, so this is not fatal.
    return {
      ok: true,
      command: baseCommand,
      version: undefined,
      error: `Installed, but --version failed (${(error as Error).message.split('\n')[0]}).`,
    };
  }
}
