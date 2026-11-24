import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import type { LspStatus } from '@shared/types';
import { him } from '../lib/bridge';
import { useCoreStore } from '../store/core';
import { cn } from '../lib/utils';

/** Status-bar chip showing how many language servers are attached to this workspace. */
export function LspStatusChip() {
  const workspace = useCoreStore((state) => state.workspace);
  const [status, setStatus] = useState<LspStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setStatus(await him.lsp.status());
    } catch {
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [workspace]);

  const connected = status?.servers.filter((server) => server.connected).length || 0;
  const total = status?.servers.length || 0;
  const tooltip = status
    ? status.servers.length === 0
      ? 'No language servers detected. Install rust-analyzer, typescript-language-server, pyright-langserver or configure .him/lsp.json.'
      : status.servers
          .map(
            (server) =>
              `${server.command} — ${server.connected ? 'connected' : server.error || 'idle'}`,
          )
          .join('\n')
    : 'Language servers (click to refresh)';

  return (
    <button
      onClick={() => void refresh()}
      className={cn(
        'flex h-full items-center gap-1 border-l border-line px-2 font-mono text-[9.5px] transition-colors hover:bg-ink-800',
        connected > 0 ? 'text-mint/80' : 'text-mist-ghost',
      )}
      title={tooltip}
      aria-label="Language server status"
    >
      <Cpu size={9} className={busy ? 'animate-pulse' : ''} />
      <span>{total > 0 ? `lsp ${connected}/${total}` : 'lsp'}</span>
    </button>
  );
}
