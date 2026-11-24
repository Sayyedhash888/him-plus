import type { LlmToolSchema } from '@shared/types';
import { him } from './bridge';

export interface McpToolBinding {
  server: string;
  tool: string;
}

const CACHE_TTL_MS = 30_000;

let cache: {
  root: string;
  at: number;
  schemas: LlmToolSchema[];
  bindings: Map<string, McpToolBinding>;
} | null = null;

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

export function isMcpToolName(name: string): boolean {
  return typeof name === 'string' && name.startsWith('mcp__');
}

/**
 * Loads MCP tool schemas for a workspace and adapts them to the model's
 * function-calling format. Cached briefly so a multi-round agent turn does not
 * re-handshake with every server before each provider call.
 */
export async function loadMcpTools(root: string, force = false): Promise<LlmToolSchema[]> {
  if (!root) return [];
  if (!force && cache && cache.root === root && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.schemas;
  }
  try {
    const status = await him.mcp.status(root);
    const schemas: LlmToolSchema[] = [];
    const bindings = new Map<string, McpToolBinding>();
    for (const server of status.servers) {
      if (!server.connected) continue;
      for (const tool of server.tools) {
        bindings.set(tool.qualifiedName, { server: server.name, tool: tool.name });
        schemas.push({
          type: 'function',
          function: {
            name: tool.qualifiedName,
            description: `${tool.description || tool.name} (MCP server: ${server.name})`.slice(
              0,
              1_024,
            ),
            parameters: tool.inputSchema,
          },
        });
      }
    }
    cache = { root, at: Date.now(), schemas, bindings };
    return schemas;
  } catch (error) {
    console.warn('[mcp] could not load tools', error);
    return cache?.root === root ? cache.schemas : [];
  }
}

export async function callMcpTool(
  root: string,
  qualifiedName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  if (!cache || cache.root !== root || !cache.bindings.has(qualifiedName)) {
    await loadMcpTools(root, true);
  }
  const binding = cache?.bindings.get(qualifiedName);
  if (!binding) {
    throw new Error(`Unknown MCP tool "${qualifiedName}". Try again after reloading MCP servers.`);
  }
  return him.mcp.call({
    root,
    server: binding.server,
    tool: binding.tool,
    arguments: args || {},
  });
}

export function invalidateMcpTools(): void {
  cache = null;
}
