import { useEffect, useRef, useState } from 'react';
import { FileCog, Plug, PlugZap, RefreshCw, X } from 'lucide-react';
import type { McpStatus } from '@shared/types';
import { him } from '../lib/bridge';
import { invalidateMcpTools } from '../lib/mcp';
import { useCoreStore } from '../store/core';
import { toast } from '../store/toast';
import { cn } from '../lib/utils';
import { useClickOutside } from '../lib/hooks';

const EMPTY_CONFIG = `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;

export function McpPanel() {
  const workspace = useCoreStore((state) => state.workspace);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useClickOutside(wrapperRef, () => setOpen(false), open);

  const load = async (reload = false) => {
    setBusy(true);
    try {
      const next = reload
        ? await him.mcp.reload(workspace || '')
        : await him.mcp.status(workspace || '');
      setStatus(next);
      if (reload) {
        invalidateMcpTools();
        const toolCount = next.servers.reduce((total, server) => total + server.tools.length, 0);
        toast(
          'success',
          `${next.servers.length} server${next.servers.length === 1 ? '' : 's'}, ${toolCount} tool${toolCount === 1 ? '' : 's'}.`,
          'MCP reloaded',
        );
      }
    } catch (error) {
      toast('error', (error as Error).message || 'Could not load MCP servers.', 'MCP failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) void load(false);
  }, [open]);

  const connected = status?.servers.filter((server) => server.connected).length || 0;
  const configured = status?.servers.length || 0;
  const toolCount =
    status?.servers.reduce((total, server) => total + server.tools.length, 0) || 0;

  const writeSample = async () => {
    const target = status?.userConfigPath;
    if (!target) return;
    try {
      await him.fs.writeFile(target, EMPTY_CONFIG);
      toast('success', 'Created mcp.json. Add servers, then press Reload.', 'MCP config created');
      await load(true);
    } catch (error) {
      toast('error', (error as Error).message || 'Could not write mcp.json.', 'MCP config failed');
    }
  };

  return (
    <div ref={wrapperRef} className="relative flex h-full items-center border-l border-line">
      <button
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-full items-center gap-1 px-2 font-mono text-[9.5px] transition-colors hover:bg-ink-800',
          connected > 0 ? 'text-mint/80' : 'text-mist-ghost',
        )}
        title="MCP tool servers (Model Context Protocol)"
      >
        {connected > 0 ? <PlugZap size={9} /> : <Plug size={9} />}
        <span>{configured > 0 ? `${connected}/${configured}` : 'mcp'}</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-[90] mb-1 w-[360px] animate-slide-up overflow-hidden rounded-lg border border-line-strong bg-ink-800 shadow-panel">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Plug size={11} className="text-accent-dim" />
            <span className="text-[10px] font-semibold text-mist-bright">MCP servers</span>
            <span className="ml-auto font-mono text-[8px] text-mist-ghost">
              {configured} configured · {toolCount} tools
            </span>
            <button
              onClick={() => setOpen(false)}
              className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
              aria-label="Close MCP panel"
            >
              <X size={10} />
            </button>
          </div>

          <div className="thin-scrollbar max-h-[240px] overflow-y-auto p-2">
            {!status && <div className="px-2 py-3 text-[9px] text-mist-ghost">Loading…</div>}
            {status && status.servers.length === 0 && (
              <div className="px-2 py-2 text-[9px] leading-relaxed text-mist-faint">
                No MCP servers configured. Add them to the JSON files below using the familiar
                <span className="mx-1 font-mono text-mist">mcpServers</span> format, then reload.
              </div>
            )}
            {status?.servers.map((server) => (
              <div
                key={server.name}
                className="mb-1 rounded border border-line/70 bg-ink-900/40 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      server.connected ? 'bg-mint' : 'bg-coral',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-mist">
                    {server.name}
                  </span>
                  <span className="font-mono text-[8px] text-mist-ghost">
                    {server.tools.length} tools
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[8px] text-mist-ghost">
                  {server.command}
                  {!server.connected && server.error ? ` — ${server.error}` : ''}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-line/70 px-2 py-1.5">
            <div className="mb-1 truncate font-mono text-[8px] text-mist-ghost" title={status?.userConfigPath}>
              user: {status?.userConfigPath || '…'}
            </div>
            <div className="mb-2 truncate font-mono text-[8px] text-mist-ghost" title={status?.projectConfigPath}>
              project: {status?.projectConfigPath || '(open a workspace)'}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void load(true)}
                disabled={busy}
                className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[8.5px] text-mist-faint hover:border-accent/25 hover:text-accent-soft disabled:opacity-50"
              >
                <RefreshCw size={9} className={busy ? 'animate-spin' : ''} /> Reload
              </button>
              <button
                onClick={() => {
                  const target = status?.userConfigPath;
                  if (target) him.app.showItemInFolder(target);
                }}
                className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[8.5px] text-mist-faint hover:border-line-strong hover:text-mist"
              >
                <FileCog size={9} /> Show config
              </button>
              {status && status.servers.length === 0 && (
                <button
                  onClick={() => void writeSample()}
                  className="ml-auto flex h-6 items-center gap-1 rounded border border-accent/25 bg-accent/[0.06] px-2 text-[8.5px] text-accent-soft hover:bg-accent/10"
                >
                  Create mcp.json
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
