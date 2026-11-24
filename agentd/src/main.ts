/**
 * him-agentd — the HIM+ agent daemon.
 *
 * One long-lived Node process that outlives any editor window. It speaks
 * line-delimited JSON-RPC 2.0 on stdio and owns the runtime that the desktop
 * workbench currently keeps inside its renderer:
 *
 *   - model streaming (`llm.*`), one independent abortable stream per request
 *   - agent sessions and their tool loop (migration in progress)
 *   - tool approvals as a real round trip rather than an in-process map
 *   - git checkpoints, namespaced per session
 *
 * Running this outside the extension host is the point: a VS Code window reload
 * must not kill running agents, and N agents must not contend for one event loop.
 *
 * Usage:
 *   node agentd/src/main.ts            # stdio JSON-RPC
 *   node agentd/src/main.ts --log      # also log lifecycle to stderr
 */

import { RpcServer } from './server.ts';
import { registerLlmService } from './llmService.ts';

const verbose = process.argv.includes('--log') || process.env.HIM_AGENTD_LOG === '1';

function log(message: string): void {
  if (!verbose) return;
  // stdout carries the protocol, so lifecycle logging must go to stderr.
  process.stderr.write(`[him-agentd] ${message}\n`);
}

export function createDaemon(): {
  server: RpcServer;
  dispose(): void;
} {
  const server = new RpcServer({
    input: process.stdin,
    output: process.stdout,
    onError: (error, method) => {
      log(`${method} failed: ${error.message}`);
    },
  });

  const llm = registerLlmService(server, { onLog: log });
  log(`ready with ${server.registeredMethods.length} methods`);

  return {
    server,
    dispose: () => {
      llm.dispose();
      server.dispose('daemon shutting down');
    },
  };
}

if (process.argv[1] && /main\.(ts|mts|js|mjs|cjs)$/.test(process.argv[1])) {
  const daemon = createDaemon();
  daemon.server.listen();

  const shutdown = (signal: string) => {
    log(`${signal} received, aborting in-flight work`);
    daemon.dispose();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // A disconnected client must cancel its work: there is no window to notice.
  process.stdin.on('end', () => {
    log('stdin closed, exiting');
    daemon.dispose();
    process.exit(0);
  });
}
