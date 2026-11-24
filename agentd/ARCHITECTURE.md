# HIM+ Code — agent core extraction

Status: **planned, not started.** This note records what was measured, what was
wrong in the first plan, and the order of work. It exists so the finding below is
not rediscovered from scratch.

## The thesis

- **HIM+** is an AI-first IDE. AI is the primary interface; the editor is secondary.
- **HIM+ Code** is a code-first IDE where AI is a first-class citizen — the familiar
  VS Code surface, with HIM+'s *full* agent system inside it, including simultaneous
  agents.

HIM+ Code is the only surface where the desktop workbench's agent runtime can be
exposed through a real VS Code extension host. The desktop app deliberately does
not host extensions (`README.md`, "Known limitations"). So the fork is not trying
to out-VS-Code VS Code; it is the edition where HIM+'s own runtime reaches
developers who live in VS Code.

## Correction to the original plan

The first plan was to extract `electron/llm.ts`, `acpClient.ts`, `mcpClient.ts`,
`gitSnapshots.ts`, `chatStore.ts` and `fsops.ts` into a daemon called
`him-agentd`. **That would have moved the plumbing and left the agent in place.**

The agent loop does not live in the Electron main process. It lives in the
renderer:

| Concern | Where it actually is |
| --- | --- |
| Prompt queue, approval grants, 24-round tool loop, auto-compaction, model fallback | `src/lib/agent/runtime.ts` (895 lines) |
| Tool execution | `src/lib/agent/tools.ts` (1,094 lines) |
| `llm:*` IPC handlers | `electron/llm.ts` — a thin SSE proxy, **not** the agent |
| Tool approval | `src/lib/agent/approvals.ts` — a renderer-local `Map<sessionId, resolver>` |

Moving `llm:*` alone would produce a daemon that streams tokens and nothing else,
and the VS Code extension would still be unable to run an agent. The payload to
move is `src/lib/agent/**`.

## Why a daemon at all

The VS Code extension host is single-threaded and is torn down on every window
reload. Two consequences:

1. An agent hosted in the extension host **dies when the window reloads**.
2. N concurrent agents share one event loop, so "simultaneous" agents contend
   rather than run in parallel.

A single long-lived daemon owning the runtime fixes both, and is also the same
shape the desktop app already assumes.

## Concurrency: already designed in, never hosted

The desktop runtime is session-keyed throughout, with **no global lock**:

```ts
// src/lib/agent/runtime.ts:38-40
const activeRuns = new Map<string, ActiveRun>();
const pendingPrompts = new Map<string, QueuedPrompt[]>();
const sessionGrants = new Map<string, Set<string>>();
```

Each run gets its own `AbortController`, `isAgentRunning(sessionId)` is per
session, approvals are keyed by session, and checkpoints are namespaced
`refs/him/checkpoints/<sessionId>/<id>`. So per-agent rollback already exists, by
construction. Simultaneous agents are a hosting problem, not a design problem.

## Measured extraction cost

Measured across `src/lib/agent/**` — 2,833 lines total.

| File | Lines | store refs | react | dom | electron |
| --- | --- | --- | --- | --- | --- |
| `runtime.ts` | 895 | 56 | 0 | 1 | 0 |
| `tools.ts` | 1094 | 11 | 0 | 0 | 0 |
| `context.ts` | 219 | 4 | 0 | 0 | 0 |
| `prompts.ts` | 230 | 0 | 0 | 0 | 0 |
| `llmClient.ts` | 158 | 0 | 0 | 0 | 0 |
| `fallback.ts` | 126 | 0 | 0 | 0 | 0 |
| `thinking.ts` | 75 | 0 | 0 | 0 | 0 |
| `approvals.ts` | 36 | 0 | 0 | 0 | 0 |

Zero React and zero Electron anywhere in the agent layer. Six of the eight files
move verbatim; only the two largest need work. Store usage overall:

| Store | Refs | What it really is |
| --- | --- | --- |
| `useSessionStore` | 43 | Session/transcript state — **the daemon's job** |
| `useCoreStore` | 14 | Workspace root, editor tabs, app state |
| `useEditorStore` | 10 | Open documents |
| `useConfigStore` | 4 | Provider config |

The dominant dependency is session state, which the daemon should own rather than
merely tolerate. The real seam to design is the remaining ~28 refs, and the system
prompt building in `runtime.ts` that currently reads editor tabs.

Only four agent files touch the Electron bridge (`runtime.ts`, `tools.ts`,
`llmClient.ts`, `context.ts`), so the `him.*` call surface a daemon must absorb is
small and enumerable.

## Target shape

```
HIM+ Code (VSCodium fork)              HIM+ desktop app (Electron)
  └── him-plus extension                 └── main process
        │  stdio JSON-RPC                      │  IPC (or stdio)
        ▼                                      ▼
        └──────────────► him-agentd ◄──────────┘
                         one long-lived Node process
                         ├── agent loop (runtime, tools, prompts, thinking, fallback)
                         ├── llm (SSE), fim, acp, mcp clients
                         ├── session/transcript state (owns it)
                         ├── checkpoints (git refs per session)
                         └── per-file write leases
```

The agent loop is **not** in the extension host and **not** in Electron main.

## Wire contract

Derived from the existing IPC inventory. Reuse the current payload types — they
already carry their own correlation key — and add only an envelope.

- Transport: line-delimited JSON-RPC 2.0 over stdio.
- Methods: `domain.method` (`llm.start`, `acp.prompt`, `mcp.call`, `agent.approve`, …).
- Streaming: server→client notifications, one generic method per domain carrying the
  existing discriminated payload (`stream.llm`, `stream.acp`, `stream.cliAgent`).
- Correlation keys stay as they are: `requestId` (llm/fim), `sessionId` (acp/agent),
  `id`/`runId` (pty/exec), `path`+`token` (notebook).
- **Every stream ends with exactly one `done` or `error` notification.** `llm.ts`
  already guarantees this; the daemon must preserve it for every domain.
- Prefer resolving `llm.start` at stream *start* (`{ accepted: true }`) rather than
  at stream end. Today it resolves only when the stream terminates, which forces
  the renderer to race a terminal event (`acpRuntime.ts:324-331`).
- Named-object params, not positional. The existing positional style
  (`checkpoint:create(sessionId, root, id)`) is the least portable part of the
  current contract.

### New methods with no existing equivalent

Tool approval currently never crosses any boundary — it is a local store mutation
plus an in-memory map. It must become a real round trip:

- `agent.approvalRequest` (notification): `{ sessionId, messageId, toolCallId, toolName, args, preview }`
- `agent.approve` (request): `{ sessionId, allow, always }` → `{ resolved: boolean }`

ACP has a second, different problem: `decidePermission` blocks on a native
`dialog.showMessageBox` anchored to a `BrowserWindow`, so a daemon would silently
reject every prompt. It must become either a client round trip
(`stream.acp` `{ type:'permission' }` + `acp.permissionResponse`) or a policy
config.

## Migration order

Ordered so that each step is verifiable and nothing regresses. The physical file
move is **last**, because a module with a top-level `electron` import fails at
*load* time, not at first call.

1. **Boundary guards (done).** `tests/agentCoreBoundary.test.ts` asserts which
   modules must stay Electron-free and that `checkpointRef` has one definition.
2. **Deduplicate `checkpointRef` (done).** Exported from `gitSnapshots.ts`; the
   copy in `checkpoints.ts` is deleted, so diff/revert cannot desync from create.
3. **Split registrars from engines (done).** `checkpoints.ts` exports pure
   `createCheckpoint`/`listCheckpoints`/`diffCheckpoint`/`revertCheckpoint` beside
   `registerCheckpointIpc`.
4. **Stand up the daemon with its first service (done).** `agentd/` runs under
   plain Node, speaks line-delimited JSON-RPC 2.0 on stdio, and serves `llm.*`
   with one independent abortable stream per request. 25 tests, headless.
5. **Introduce the state seam (done).** `src/lib/agent/host.ts` defines `AgentHost`
   + `AgentHostEffects`; `memoryHost.ts` is a headless implementation and
   `rendererHost.ts` adapts the live stores. `configureAgentHost()` is called at
   renderer boot.
6. **Switch `runtime.ts` onto the host (done).** All ~90 call sites now go through
   `getAgentHost()`. `runtime.ts` has **zero store imports**, so it no longer pulls
   in zustand or React — the precondition for running it in the daemon.
   `tests/agentHost.test.ts` holds a per-file allowlist; `runtime.ts`'s is empty.
7. **Switch `tools.ts` and `context.ts` onto the host (done).** The whole agent
   loop is store-free:

   | File | store imports | store handles |
   | --- | --- | --- |
   | `runtime.ts` | 0 | 0 |
   | `tools.ts` | 0 | 0 |
   | `context.ts` | 0 | 0 |
   | `host.ts` | 0 | 0 |
   | `memoryHost.ts` | 0 | 0 |
   | `rendererHost.ts` | 5 | 35 |

   Every store handle in the agent layer now sits in one adapter file. That is the
   precondition for step 8: these modules pull in no zustand and therefore no
   React.
8. **Move the agent layer into `agentd/`.** The store-free modules move verbatim,
   plus `acp`/`mcp`/`fim` services.
9. **Make the renderer a client.** Keep a thin adapter so the desktop UI is
   unchanged while the loop runs out of process.
10. **Add per-file write leases.** Checkpoints make concurrent edits recoverable,
    not prevented. Two agents writing one file is last-writer-wins today.
11. **Point the VS Code extension at the same daemon.**

## Round 4: finishing the seam

Two interface decisions were forced by moving `tools.ts`:

- **`AgentHost` now extends `AgentHostEffects`.** They were separate interfaces
  when only the renderer used them. `tools.ts` reaches for `refreshGit`,
  `setLastTerminal` and `diagnostics` through `getAgentHost()`, so keeping them
  apart forced casts at every call site. They remain **optional** — a headless
  daemon genuinely cannot reload an editor buffer or read a language server.

- **Path handling collapsed into one host call.** `refreshAfterWrite` and
  `delete_path` each had their own bump-fs / refresh-git / reload-tab sequence
  with subtly different tab matching. Both are now
  `refreshAfterFileChange(absPath, deleted)`, and the renderer keeps the policy
  that matters: leave a dirty buffer alone, close a deleted file's tab. The caller
  states which happened instead of the host inferring it, avoiding a
  stat-after-write race.

`diagnostics` is the one capability where "cannot" and "nothing to report" differ.
The tool reports *unavailable* rather than *clean* when the host has no language
server, and the memory host exposes `hasDiagnostics()` so the distinction is
testable without conflating an empty array with an absent source.

## Round 3: what the switch-over changed

`runtime.ts` went from 56 store call sites to zero, in four kinds of change:

| Was | Now |
| --- | --- |
| `useSessionStore.getState().patchMessage(...)` ×37 | `getAgentHost().patchMessage(...)` |
| `toast('info', msg, title)` ×20 | `getAgentHost().notify('info', msg, title)` |
| four store reads to build the prompt | one `getAgentHost().getWorkspaceContext(root)` |
| `useConfigStore.getState().config` + `findModelOption`/`resolveDefaultModel` | `host.resolveModel(session)` / `host.resolveModelByKind(kind)` |

Three decisions worth recording:

- **The host returns raw paths; the loop relativises.** Returning
  workspace-relative paths would have put the transformation inside each host and
  risked two implementations drifting. One helper (`relativeTo`) now serves both.
- **`ModelOption` moved to `shared/types.ts`.** It was an aggregate of shared
  types sitting in a renderer store, so the host interface could not name it
  without importing the renderer. `store/config.ts` re-exports it.
- **`him.fs.listFiles` is no longer called by the loop.** Workspace files now
  arrive through the host context. `read_file` still resolves through `him.fs`, so
  the tool teaches the host about files it has not scanned, and the prompt picks
  them up on the next round.

### The guard is the proof

The store-bypass guard was initially one shared allowlist — which would have
passed unchanged even if round 3 had done nothing. It is now **per file**, with
`runtime.ts`'s list empty, plus a test that it imports nothing from `src/store/`.
That converts "the seam exists" into "the seam is load-bearing".

## The host seam

`runtime.ts` reached into four Zustand stores (56 call sites); `tools.ts` and
`context.ts` reach into the same four. The seam replaces that with one interface.
Two rules make it portable:

1. **Narrow, purpose-shaped reads.** The loop never asks for "editor state". It
   asks for the context it needs to build a system prompt. The daemon answers from
   disk; the renderer answers from its stores.
2. **Writes are fire-and-forget.** Every mutation returns `void` — verified, with
   **one exception**: `startTerminalRun` returns the new run id, which `tools.ts`
   immediately feeds to `him.exec.run`. A host must therefore be synchronous, and
   that one method cannot be `void`.

Read-your-writes is also load-bearing: the loop re-reads a session immediately
after mutating it (`runtime.ts:777` then `:782`, `:878` then `:880`). Writes may be
queued, but reads must never be stale.

### What the seam deliberately does *not* own

The `him` bridge surface (fs, git, exec, notebooks, web, chats, search, acp) is the
daemon's RPC boundary, not host state. `tools.ts` is where that lives, so the seam
covers state only; tool I/O moves in step 7.

### Capability, not just state: `diagnostics`

`get_diagnostics` (`tools.ts:920`) reads **live Monaco/LSP problems**. A headless
daemon cannot derive those from files on disk. It is modelled as optional, and the
distinction matters: returning an empty list would tell the model a broken file is
clean, so an absent capability must surface as "unavailable in this host".

## Constraints discovered while building the daemon

Node's *strip-only* TypeScript loading (`node agentd/src/main.ts`) is what lets the
daemon run with no build step, and it imposes three rules that are easy to violate:

1. **No parameter properties.** `constructor(private readonly x: T) {}` throws
   `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Declare fields and assign in the body.
2. **Relative imports need explicit extensions.** Under ESM resolution, `./server`
   is `ERR_MODULE_NOT_FOUND`; write `./server.ts`. `tsconfig.json` therefore sets
   `allowImportingTsExtensions: true`.
3. **`agentd/` must be in the typecheck `include` list**, or these files are never
   type-checked — they would be compiled only by the interpreter.

## Defects found and fixed during extraction

Each of these was live and would have shipped:

- **Notifications dropped by the wrong gate (daemon, blocking).** The stream gate
  tested `entry.answered`, which is `true` from the moment the ack is written — so
  every delta was discarded. `answered` exists to stop a second *response*;
  `settle()` is the sole writer of responses. `stream()` must not consult it.
- **URL path spliced into the query string.** `base + '/chat/completions'` on a base
  carrying a query (`…/v1?api-version=…`) produced
  `…/v1?api-version=…/chat/completions`. Fixed with the URL API in both `agentd`
  and `electron/llm.ts`; covered by a regression test.
- **Duplicate auth headers.** `buildHeaders` deleted the canonical `Authorization`
  and then wrote the caller's spelling, so `Authorization` *and* `authorization`
  were both sent. Fixed in `agentd`, `electron/llm.ts` and
  `vscode-extension/src/himConfig.ts`.
- **Duplicate `tsconfig` key.** An inserted `allowImportingTsExtensions: true` sat
  above an existing `false`, so the effective value was `false`.
- **Two hosts diverging on mutation semantics.** `addChange` de-duplicates by
  lowercased path and `upsertArtifact` by lowercased title; `maybeTitle` only
  retitles a session still matching `/^Agent \d+$/` and caps at 52 characters.
  Re-implementing those in a second host would have drifted, which is why
  `RendererAgentHost` extends `InMemoryAgentHost` and overrides only the
  renderer-specific reads.

## Guarding the seam

`tests/agentHost.test.ts` includes a static guard over `runtime.ts`, `tools.ts` and
`context.ts`: every store member they reach for must appear on an allowlist, so the
seam cannot be quietly bypassed while the switch-over is in progress. The list is
meant to shrink, never grow.

It detects **both** access forms, because only checking the first would be
trivially defeated:

```ts
useSessionStore.getState().setStatus(...)                    // direct
const store = useSessionStore.getState(); store.setStatus(...) // captured
```

The captured form needs care: `const profile = useConfigStore\n  .getState()\n  .config?.acpAgents…`
is a *chained read*, not a store capture, and treating it as one produced two
false positives before the check was tightened to inspect the character following
the match.

## Open questions

- **Distribution.** Does the daemon ship inside the `.vsix`, or is it discovered
  from an installed HIM+? Bundle size versus coupling, unresolved.
- **Client identity.** Many handlers assume exactly one renderer
  (`lsp.ts` sender, `copilot.ts` statusSender, `watcher.ts`, module-global
  `workspaceRoot`). A second client (the extension) would make these correctness
  bugs rather than limitations. Per-client subscription model needed.
- **Key storage.** A daemon cannot use Electron `safeStorage`. The extension
  already decrypts `enc:` keys itself; the daemon needs the same treatment or a
  keyring library.
- **`fs:trash`** has no Node equivalent (`shell.trashItem`); needs a shim or a
  client round trip.
