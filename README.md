# HIM+

**HIM+ is a local-first, AI-first desktop IDE for Windows: a multi-agent workbench and a Monaco editor in one Electron app.**

[Privacy](PRIVACY.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [License](LICENSE) · [Build workflow](.github/workflows/build.yml)

> **Status: early preview (v0.1.0).** Builds are unsigned and Windows-only for now.
> Features, configuration formats, and ACP/notebook behaviour may change before 1.0.
> See [Known limitations](#known-limitations).

## What HIM+ is

HIM+ is a native Electron desktop application for Windows x64, not a VS Code fork.
It combines two modes in one window:

- **Agent Mode** — Mission Control for multiple concurrent agent sessions, with
  approval gates, plan artifacts, file-diff review, and isolated git worktrees.
- **IDE Mode** — a Windows-native editor with Monaco, LSP, a real PTY terminal,
  git, a Python debugger, and notebooks.

HIM+ is **BYOK** (bring your own key): it ships without a model. You add any
OpenAI-compatible endpoint — hosted or local — and choose which models handle
primary work, fast actions, planning, and inline completions. Chats and
configuration stay on your machine; there is no HIM+ account or HIM+ cloud.

The desktop app is the primary product. It has **no VS Code extension host or
marketplace**. The repository also contains an experimental VS Code extension and
a prebuilt HIM+ Code compatibility distribution; see
[HIM+ Code and experimental editions](#him-code-and-experimental-editions).

## Highlights

| Area | What you get |
| --- | --- |
| **Mission Control** | Parallel HIM+ agent sessions and external ACP agents in a shared session rail, with live tool cards, plans, artifacts, changes, and terminal output. |
| **Permissions & review** | Plan / Review / Auto presets, approval cards that show the exact command, per-session plan artifacts with comments, an accept/revert diff view, and worktree-isolated sessions. |
| **Notebooks** | Native `.ipynb` tabs backed by a real Jupyter kernel through a Python bridge: streaming output, interrupt, restart, run-all, and a DataFrame grid. |
| **Data wrangling** | Live DataFrame preview over filter, sort, keep/drop columns, dropna, groupby, and value-counts; generated pandas code inserts into the notebook as a cell. |
| **Editor & IDE** | Monaco editor, explorer, quick open, inline edit, search, image previews, resizable panels, file watcher, LSP diagnostics/hover/definition, and seven themes. |
| **Terminal, git, debug** | Real ConPTY terminal, stage/unstage/commit/discard with Monaco diff tabs, and Python debugging over DAP with `debugpy`. |
| **Completions** | FIM or chat-fallback inline completions from any compatible provider, plus optional GitHub Copilot ghost text through GitHub's official language server. |
| **Integrations** | MCP stdio servers, ACP agent presets, a `web_fetch` agent tool, git tools, notebook tools, and local SQLite chat history. |
| **Privacy** | No telemetry or analytics. Network traffic goes only to the providers, integrations, and URLs you or the agent request. See [PRIVACY.md](PRIVACY.md). |

## Requirements

| Requirement | Needed for | Notes |
| --- | --- | --- |
| **Windows 10/11 x64** | Running HIM+ | Only Windows x64 is built and tested. macOS/Linux are not built. |
| **Node.js 22.13 or newer + npm** | Development, `npm test`; GitHub Copilot FIM | Node.js 22 LTS is recommended for development. The Copilot language server specifically requires Node.js ≥ 22.13 on `PATH` when Copilot is enabled. |
| **Python 3** | Notebooks, data grid, debugger | `python` must be on `PATH`. Install `jupyter_client`, `ipykernel`, and `pandas` for notebooks; install `debugpy` for the built-in debugger. |
| **Git** | Source-control panel and worktree isolation | Optional for editing, required for the git panel and isolated agent sessions. |
| **An OpenAI-compatible provider** | Chat, agent, inline edit, FIM | Any hosted or local endpoint that speaks OpenAI-style `/chat/completions` (and `/completions` for true FIM). |
| **GitHub Copilot subscription** | Optional Copilot inline completions | Not required for HIM+ FIM. |
| **MCP/LSP/ACP programs** | Optional integrations | You install, configure, and authenticate these separately. |

## Install and run

### Packaged portable build

The Windows package is a portable folder, not an installer:

```text
release\HIM+-win32-x64\HIM+.exe
```

Run the executable directly. The build is **unsigned**, so Windows SmartScreen
may warn on first launch; verify the SHA-256 checksum (see
[Release verification](#release-verification)). Optional Start Menu shortcuts can
be installed with `scripts/install-shortcuts.ps1`. HIM+ accepts
`--workspace <path>` to open a folder at launch.

### From source (development)

```sh
npm ci
npm run dev
```

`npm run dev` starts Vite on `127.0.0.1:5173`, builds the Electron main/preload
bundles, and launches Electron against the dev server. Use `npm run start` to
build once and run Electron without the Vite watcher.

### Build and package

```sh
npm test
npm run build
npm run package:win
```

- `npm run build` — typecheck (`tsc --noEmit`), Vite renderer build, esbuild
  Electron bundles.
- `npm run package:win` — runs the build again, assembles the portable Electron
  app, and writes `release\HIM+-win32-x64\HIM+.exe` plus
  `release\HIM+-win32-x64\SHA256SUMS.txt`.
- Close a running HIM+ instance before packaging so the existing executable and
  resources can be replaced.

CI builds the same unsigned package on `windows-latest`; see
[.github/workflows/build.yml](.github/workflows/build.yml).

## First-run setup

1. **Start HIM+ and open a folder.** Use **Open folder** in the top bar or
   explorer to select the project root. Agent file tools and the renderer file
   guard are scoped to it.
2. **Add a provider.** Open **Settings** (`Ctrl+,`) → **Providers**, choose a
   preset or add a custom OpenAI-compatible endpoint, enter the base URL and API
   key, then fetch the model list or add a model ID manually.
3. **Enable models and defaults.** Toggle at least one model on, then set the
   **Model defaults** for primary, fast, and planning work under
   **Settings → Providers / Model defaults**.
4. **Optional: configure FIM.** **Settings → Integrations → Inline autocomplete ·
   FIM** selects the completion model, endpoint style (`fim` or chat fallback),
   and enabled state. FIM is independent of the chat model.
5. **Optional: enable GitHub Copilot.** **Settings → Integrations → Copilot**
   turns on Copilot inline completions, starts the official Copilot language
   server, and offers **Sign in** (GitHub device flow) and **Verify**. Requires a
   Copilot subscription and Node.js 22.13+ on `PATH`; it is a third-party client
   integration, not a GitHub-supported IDE.
6. **Optional: add ACP agents.** **Settings → Integrations → External agents ·
   ACP** contains presets for OpenCode, Hermes Agent, DeepSeek Harness, Cline,
   Kilo, GitHub Copilot CLI, and Google Antigravity, plus custom profiles. Install
   and authenticate the CLI separately, then launch it from **Agent Mode → New
   agent → ACP agents**.

   **ACP troubleshooting:** profile errors include the agent's own stderr.
   Kilo's preset runs `npx -y @kilocode/cli@latest acp` (no global install
   needed; the first launch downloads it). Cline and GitHub Copilot CLI require
   their own sign-in: click **Load models** once and complete the browser flow;
   Copilot CLI additionally needs `copilot login` in a terminal first.

   **ACP registry:** Settings → Integrations → External agents · ACP →
   **ACP registry** lists curated agents (OpenCode, Kilo, Cline, Copilot CLI,
   Gemini CLI, Qwen Code, Codex bridge, Hermes, DeepSeek Harness) with install and
   auth hints. **Add** creates the profile and health-checks the launch command
   (runs via npx where appropriate). Freebuff is intentionally not in this list —
   it has no ACP mode and belongs under CLI agents.

   **MCP sharing:** MCP servers configured for the workspace are passed to ACP
   agents via `session/new.mcpServers`, so external agents get the same tool set.
   The ACP agent still launches its own server instances (ACP has no shared
   endpoint handshake yet); HIM+ manages one config/health source.

7. **Optional: add CLI agents (no ACP needed).** For agent CLIs without ACP
   support — Freebuff, Aider, Claude Code, Codex CLI, Gemini CLI — use
   **Settings → Integrations → CLI agents** and add a preset or a custom
   command. They appear under **New agent → CLI agents**. HIM+ runs the CLI in a
   real PTY and streams its output into the agent chat pane; **Raw terminal**
   toggles the untouched terminal for sign-in screens and permission menus.
   These agents keep their own tools, permissions and approvals: HIM+ Review
   mode, approval cards and diff review do **not** gate them. Use the ACP rail
   when you want HIM+-gated file edits and approvals.

8. **Optional: add MCP servers.** Create
   `%APPDATA%\HIM+\mcp.json` (user-wide) or `<workspace>\.him\mcp.json`
   (project). HIM+ starts each stdio server and exposes its tools to agent
   sessions as `mcp__<server>__<tool>`. Reload from the MCP panel after edits.
9. **LSP servers are auto-detected on `PATH`.** HIM+ looks for
   `typescript-language-server`, `pyright-langserver`, `rust-analyzer`, `gopls`,
   and `clangd`. Override or add servers in `%APPDATA%\HIM+\lsp.json` or
   `<workspace>\.him\lsp.json` (same `servers` map shape; project entries win over
   user entries with the same name).

### Where configuration and data live

| What | Where |
| --- | --- |
| Provider/model config, preferences, FIM/Copilot toggles, ACP profiles | `%APPDATA%\HIM+\config.json` |
| Chat history (SQLite) | `%APPDATA%\HIM+\chats.db` |
| Pasted/dropped images and files | `%APPDATA%\HIM+\attachments\` |
| Agent worktrees | `%APPDATA%\HIM+\worktrees\` |
| User-wide LSP / MCP config | `%APPDATA%\HIM+\lsp.json`, `%APPDATA%\HIM+\mcp.json` |
| Manual update-feed pointer (optional) | `%APPDATA%\HIM+\update-feed.json` |
| Project LSP / MCP config | `<workspace>\.him\lsp.json`, `<workspace>\.him\mcp.json` |

The `HIM_CONFIG_DIR` environment variable overrides the Electron `userData`
location (useful for isolated test profiles). See [PRIVACY.md](PRIVACY.md) for
the full data inventory and deletion instructions.

## Notebooks and the data wrangler

HIM+ opens `.ipynb` files as native notebook tabs. Cells execute in a local
Python kernel: HIM+ prefers `jupyter_client`/`ipykernel` when installed and falls
back to an in-process executor otherwise.

1. **Open a notebook** from the explorer, quick open (`Ctrl+P`), or by dragging
   it in.
2. **Run cells** with the per-cell run button or `Shift+Enter`. Use **Run all** to
   execute every code cell; **Interrupt** and **Restart** control the kernel.
   Outputs stream while a cell is running, and notebook edits auto-save (with an
   explicit save also available).
3. **Inspect a DataFrame — inline, automatically.** After a cell creates or updates
   pandas DataFrames, a compact inline view appears **inside that cell's output**
   (Settings → Appearance → *Automatic data wrangler* turns this off). It shows
   PyCharm-style column headers (type, null count, unique count, an inline
   histogram for numeric columns, top values for text columns) plus preview rows;
   sort by column, filter rows, and choose 7/25/100 preview rows. **Wrangle /
   Profile / Open** expand the full grid. When a notebook is **reopened**, inline
   views are reconstructed from the saved `text/html` DataFrame outputs (marked
   “saved output”), so you don't have to re-run cells to see the data.
4. **Wrangle with a live preview.** Add filter, sort, keep, drop, dropna, groupby,
   or value-counts steps. The preview runs against the captured frame, including
   a removed-row count, before any kernel work.
5. **Generate pandas code.** **Insert code** adds the equivalent pandas cell after
   the source cell; **Insert & run** also executes it. The generated code runs in
   the kernel on the full DataFrame, not just the preview.
6. **Ask AI.** Use **Ask AI** on a DataFrame to send its context and your question
   to the active agent. The agent can inspect notebooks with `read_notebook` and
   run cells with `run_notebook_cell`; kernel state persists between calls.

**Your JupyterLab setup.** HIM+ reads `~/.jupyter` (selected theme, notebook
`codeCellConfig`, and `custom/custom.css`) and mirrors the *behaviour* in notebook
cells: cell line numbers, soft wrap and auto-closing brackets follow your
JupyterLab settings. The visual theme always stays the HIM+ theme — the detected
JupyterLab look is not applied. Settings → Appearance shows what was detected and
can rescan.

Notebooks need a working Python environment with `jupyter_client`, `ipykernel`,
and `pandas`. The data grid is read-only from the UI's perspective; changes are
made by the generated pandas cells.

## Editor and IDE features

- **Editing:** Monaco editor, tabs, syntax highlighting, inline diff tabs,
  explorer, search, quick open (`Ctrl+P`), and image preview tabs for raster
  images.
- **Inline AI:** `Ctrl+K` inline edit with a fast model. Every proposal is
  **sanitised and validated before it is applied**: reasoning blocks
  (`think`/`rewrite_this`), fences, control markers, conflict markers and prose
  preambles are stripped/rejected, and the final text is re-validated right
  before writing. Covered by `tests/inlineEdit.test.ts`.
- **LSP:** diagnostics in the Problems pane, hover, and go-to-definition for
  TypeScript/JavaScript, Python, Rust, Go, C/C++, and custom servers.
- **Terminal:** real PTY sessions via node-pty/ConPTY with your PowerShell or
  `cmd` shell, interactive input, and resize support.
- **Git:** status, stage/unstage, commit, discard, branch/ahead/behind metadata,
  and Monaco diff tabs.
- **Debugger:** start/stop, breakpoints, continue, step over/into/out, call stack,
  scopes, variables, evaluate, and debug console output for Python files.
- **Workspace:** file watcher, resizable panels with persisted sizes, and a
  persisted last-workspace selection.
- **Appearance:** seven themes (Black, Dark Grey, Light, Marimo, Midnight,
  Terminal, Sandstone) and optional keyboard sounds.

### Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Switch Agent / IDE mode | `Ctrl+Shift+M` |
| Quick open | `Ctrl+P` |
| Inline edit | `Ctrl+K` |
| Toggle terminal/problems drawer | `Ctrl+J` |
| Settings | `Ctrl+,` |
| Save file | `Ctrl+S` |
| Cycle agent permission preset | `Shift+Tab` |
| Start / continue debugging | `F5` |
| Toggle breakpoint | `F9` |
| Step over / into / out | `F10` / `F11` / `Shift+F11` |
| Stop debugging | `Shift+F5` |
| Run notebook cell | `Shift+Enter` |

Shortcuts follow the desktop app; behaviour can differ while a terminal or
notebook cell has focus.

## Agent permissions and safety

Each agent session runs with one of three permission presets:

| Preset | Behaviour |
| --- | --- |
| **Plan** | Read-only investigation. Write, delete, move, commit, and terminal tools are removed. The result is a structured Markdown plan saved as a session artifact. |
| **Review** (default) | Read-only tools run freely; every file write, patch, delete, move, commit, and shell command waits for your approval. Approval cards show the exact command or path. |
| **Auto** | Workspace edits and ordinary commands are auto-approved. Destructive commands (recursive deletes, hard resets, force pushes, and similar) still pause for explicit approval. |

Safety boundaries to keep in mind:

- **File tools are workspace-contained.** Agent file paths are resolved inside
  the open workspace and rejected if they escape it; `.git` internals are
  blocked. The renderer file IPC is additionally guarded by default; the
  **Restrict file access to the workspace** setting in Settings can relax that
  renderer guard (agent file tools still enforce containment).
- **Shell commands are not OS-sandboxed.** Approval gates decide *when* a command
  runs, not what it can do once allowed. Review commands before approving them,
  and avoid Auto mode in untrusted repositories.
- **CLI agents run outside HIM+'s approval layer.** The terminal-bridge backend
  (Freebuff/Aider/etc.) is an interactive CLI in a PTY: its own permission prompts
  and tool execution are not gated by HIM+ Review mode. The chat view labels this
  clearly and the raw terminal is always available for its menus.
- **ACP permissions follow the selected HIM+ mode.** Read-only ACP requests
  (`read_files`, list/search/fetch) are auto-allowed in Plan/Review and never show
  a dialog; Plan denies writes/commands, Review asks for them, Auto passes them
  through the ACP client gate. The approval dialog classifies the request and
  offers **Always allow** (per session, per operation kind). ACP sessions no longer
  show the duplicate native approval card.
- **CLI sessions persist and compact.** Prompts and cleaned terminal output are
  mirrored into the session's messages, so CLI agents are saved in the same
  `chats.db` (SQLite) history as native/ACP sessions and restored after a restart —
  including their estimated token counters (PTYs expose no provider usage data, so
  tokens are estimated from text). The mirrored transcript auto-compacts locally
  around 90k characters (keeping recent turns + a summary) and has a manual
  **Compress** button, so long CLI sessions stay usable; the CLI's own internal
  context is still managed by that CLI.
- **Session tools: checkpoints, diff review and handoff.** Every agent session has
  a **Session tools** button (merge icon in the header). *Checkpoints* creates a
  workspace snapshot as a git ref (`refs/him/checkpoints/...`), shows the diff
  since it (Monaco diff tabs), and can revert the workspace. CLI agents get a
  checkpoint automatically before each run. *Handoff* packages the original
  request, the source agent's summary (marked untrusted), changed files and the
  checkpoint, then sends it to a new review agent or an existing session.
  Checkpoints require a git repository; this is a review/revert gateway, not live
  interception, for third-party agents.
- **Token accounting across backends.** Native agents use provider-reported usage;
  ACP agents use reported usage when their protocol returns it and otherwise
  estimate from streamed prompt/thinking/answer text; terminal CLI agents estimate
  from mirrored terminal text. Estimated counts are prefixed with `~`. Streaming
  output is rendered incrementally for native/ACP agents and approximately every
  120 ms for PTY transcripts.
- **Plans and diffs are reviewable.** Plan-mode work becomes an artifact you can
  comment on; edits are collected per session in the Changes tab, where each
  file can be reviewed as a diff and accepted or reverted.
- **Worktree isolation is available** for agent sessions when the workspace is a
  git repository with at least one commit. Each isolated session gets its own
  worktree (`%APPDATA%\HIM+\worktrees\`) and a `him/...` branch.
- **Fetched content is untrusted.** `web_fetch`, repository text, MCP output, and
  recalled chat history are treated as data, not instructions.
- **Secrets:** provider API keys are encrypted at rest with Electron
  `safeStorage` when available; the plaintext fallback is documented in
  [PRIVACY.md](PRIVACY.md). HIM+ does not include telemetry or analytics.

## Privacy and security

HIM+ is designed to keep prompts, code, and chat history local except for the
services you explicitly configure. The short version:

- **No HIM+ telemetry, analytics, crash reporting, or automatic update
  installation.**
- Prompts and code go to **your LLM provider** when you use chat, agents, inline
  edit, or FIM, and to **GitHub Copilot** only if you enable Copilot.
- An optional, **manual update check** contacts only the JSON update feed you
  configure, and HIM+ never downloads or installs an update automatically.
- **ACP agents, MCP servers, and LSP servers** are local programs you install and
  configure; they may contact their own services or log data.
- `web_fetch` makes requests to the URLs the agent asks for.
- Chats, attachments, config, and worktree data are stored under Electron
  `userData` on your machine.

Read [PRIVACY.md](PRIVACY.md) for the full "what leaves your machine" table,
local data locations, and deletion steps. If you find a security issue, avoid
posting working exploits, API keys, or private data in a public issue.

## Trust and verification

Every claim below is checkable in this repository without trusting the README.
[SECURITY.md](SECURITY.md) expands the security model and reporting process.

| Claim | Implementation | Verify it yourself |
| --- | --- | --- |
| **Inline edit never writes model reasoning into files** | Sanitise reasoning/fences/markers → validate (empty/no-change/conflict markers/prose) → re-validate in the accept handler before `executeEdits` — [inlineValidation.ts](src/lib/inlineValidation.ts), [inline.ts](src/lib/inline.ts), [InlineCtrlK.tsx](src/components/ide/InlineCtrlK.tsx) | `node --test tests/inlineEdit.test.ts` (31 cases incl. `think`, `rewrite_this`, conflict markers, fences, no-change) |
| **API keys are not stored in plaintext** | Encrypted at rest with Electron `safeStorage` (Windows DPAPI / OS credential protection), persisted as `enc:<base64>` in `config.json`; legacy plaintext keys are re-encrypted on save. Plaintext fallback only when the OS has no encryption provider — [config.ts](electron/config.ts) | Open `%APPDATA%\HIM+\config.json` and confirm provider keys begin with `enc:`; see the "Key storage" card in Settings → About |
| **Releases are built from this repo and checksummed** | CI (`.github/workflows/build.yml`) runs tests, builds and packages on `windows-latest` for `v*` tags; `package-win.cjs` writes `SHA256SUMS.txt`. Builds are **unsigned** (no certificate is configured) | `Get-FileHash release\HIM+-win32-x64\HIM+.exe -Algorithm SHA256` and compare with `release\HIM+-win32-x64\SHA256SUMS.txt`; inspect the workflow and package script |
| **Agent file access stays inside the workspace** | Agent file tools resolve through `workspacePath()` (rejects traversal/absolute outside paths and `.git`); the renderer file IPC is guarded by default (`Restrict file access to the workspace`, Settings → Appearance) — [paths.ts](src/lib/paths.ts), [fsops.ts](electron/fsops.ts) | `node --test tests/workspacePaths.test.ts`; try opening a path outside the workspace |
| **Shell commands are gated, not silently run** | Review mode pauses every write/command; approval cards show the full command + cwd; destructive commands stay gated even in Auto mode. Shell commands are **not OS-sandboxed** — stated in the UI, prompt and docs | Read the "Agent permissions and safety" section; run a prompt in Review mode and inspect the approval card |
| **Data leaving the machine is documented** | No HIM+ telemetry/analytics/crash reporting; prompts go only to your configured provider (and Copilot only if enabled); update check is one optional manifest GET — [PRIVACY.md](PRIVACY.md) | Read the destination table in PRIVACY.md; audit network calls in `electron/` |
| **Tests cover the editor paths** | `node:test` suites for inline edit, workspace containment, system prompt, ACP auth/diagnostics, ACP/DAP/MCP/LSP clients, notebooks, git, terminal | `npm test` (see [Tests](#tests)) |

For a first session in an untrusted repository: keep **Review** mode (default),
use a spend-limited API key, and leave "Restrict file access to the workspace"
enabled.

## HIM+ Code and experimental editions

The **HIM+ desktop app is the primary product**. It is self-contained and does
not run arbitrary VS Code extensions. The repository also contains experimental
compatibility efforts; none is required to use HIM+:

- **HIM+ Code** — an experimental compatibility distribution built on
  VSCodium/Code OSS. A prebuilt copy exists under
  `release/HIM+Code-win32-x64/` in this checkout (with a real extension host and
  Open VSX extensions; the Microsoft Marketplace is not included). No script in
  this repository builds it, and `npm run package:win` only produces the desktop
  app. Treat it as experimental, not reproducible from this repository alone, and
  not a supported replacement for the desktop workbench.
- **HIM+ VS Code extension** (`vscode-extension/`, version 0.5.0) — the HIM+
  sidebar chat for a VS Code-compatible host. Its agent is deliberately
  **read-only**, but it now keeps **multiple independent chat sessions** and can
  delegate work to **background subagents** (`spawn_subagent` / `list_subagents`),
  with a **Handoff** action that copies a transcript into a fresh review agent.
  It can `read_file`, `list_files`, and `active_file`, but it cannot edit files,
  run terminals, use approvals, or run ACP agents/artifacts. It also contributes
  HIM+ FIM completions, the HIM+ themes, and commands to open the HIM+ desktop app
  or configuration file. It reads the same `config.json` and sends model requests
  from the extension host, not from the webview. Install build:
  `vscode-extension/him-plus-0.5.0.vsix`.
- **`theia/`** — an earlier Theia experiment. Only a cached npm directory
  remains; it is not built, packaged, or supported.

The VS Code extension and HIM+ Code are compatibility experiments. Features,
APIs, and packaging may change or be removed. Main development happens in the
desktop app.

## Repository layout

| Path | Purpose |
| --- | --- |
| `electron/` | Electron main process: agents, ACP, MCP, LSP, FIM, Copilot, PTY, git, notebooks, debugger, config, SQLite chats. |
| `shared/` | Shared TypeScript types and ACP protocol types used by both processes. |
| `src/` | React renderer: Agent Mode, IDE Mode, Monaco integration, settings, stores, themes. |
| `tests/` | `node:test` suites plus mock ACP/Copilot/FIM/LSP/MCP/extension servers and fixtures. |
| `scripts/` | Build, packaging, icon, theme, and shortcut scripts. |
| `vscode-extension/` | Experimental HIM+ VS Code extension source, themes, and VSIX outputs. |
| `theia/` | Abandoned Theia experiment (cache only; not built). |
| `public/`, `build/` | Brand assets and icon inputs. |
| `release/` | Local packaging output (gitignored): `HIM+-win32-x64/`, optional prebuilt `HIM+Code-win32-x64/`. |
| `.github/workflows/` | Windows CI build, test, package, and checksum artifact workflow. |

## Development, build and test

```sh
npm ci
npm run dev          # Vite + Electron with hot reload
npm run typecheck    # tsc --noEmit
npm test             # node:test suites in tests/
npm run build        # typecheck + renderer + Electron bundles
npm run package:win  # portable Windows package + SHA-256 checksum
```

`npm test` runs the `node:test` suites against TypeScript sources. The tests
cover ACP transport, models and vision, Copilot connection and the real Copilot
language server, DAP/debugpy, git status grouping, image paths, LSP, MCP,
notebook kernel streaming/interrupt and wrangling, PTY/terminal input, inline
edit, system prompt, workspace paths, version/update-manifest comparison, and
VS Code extension helpers. Integration tests skip when an optional binary or
package is absent. On Node 22, set
`NODE_OPTIONS=--experimental-strip-types` if your Node build does not strip
TypeScript types by default (the CI workflow does this).

### Experimental VS Code extension

```sh
cd vscode-extension
npm ci
npm run build
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
```

The extension and HIM+ Code themes are generated from `src/lib/themes.ts` with
`node scripts/build-him-vscode-themes.mjs`. See
[vscode-extension/](vscode-extension/) for the extension source.

## Release verification

- The version is `0.1.0` (`package.json`).
- `npm run package:win` writes `release\HIM+-win32-x64\SHA256SUMS.txt` containing
  `<sha256>  HIM+.exe`.
- CI publishes the portable folder and the checksum as separate workflow
  artifacts, and writes `BUILD-INFO.txt` with the commit/ref/run id plus an
  unsigned-build notice. The tag/manual workflow checks out this repository,
  runs `npm test`, builds, and packages it —
  [.github/workflows/build.yml](.github/workflows/build.yml).

Verify a download on Windows:

```powershell
Get-FileHash .\release\HIM+-win32-x64\HIM+.exe -Algorithm SHA256
Get-Content .\release\HIM+-win32-x64\SHA256SUMS.txt
```

The hash printed by `Get-FileHash` must match the first field of
`SHA256SUMS.txt`.

### Update checks

HIM+ does not auto-update or auto-install. If you configure a JSON update feed,
**Settings → About → Updates → Check for updates** performs one manual HTTP GET
against that feed and reports the latest version, release URL, checksum, and
notes. The feed is configured with the `HIM_UPDATE_MANIFEST_URL` environment
variable or a `{"manifestUrl": "https://…"}` file at
`%APPDATA%\HIM+\update-feed.json`; the manifest itself is JSON with `version`,
`url`, `sha256`, and `notes` fields. No prompts or code are sent by the check.

**Signing status:** code signing is **not configured**. Local packages and CI
artifacts are unsigned; there is no certificate or signing step in the
repository. Windows SmartScreen may warn, and you should verify the checksum and
review the source before running a build. Do not treat an unsigned binary as
trusted just because it carries the HIM+ name.

## Known limitations

- **Windows x64 only.** macOS and Linux are not built or tested.
- **No VS Code extension ecosystem in the desktop app.** The desktop editor is
  Monaco-based; it does not host VS Code extensions or the Microsoft
  Marketplace. HIM+ Code is the experimental compatibility path, not the primary
  product.
- **Shell commands are not OS-sandboxed.** Approval presets and file-tool
  containment are not a substitute for an OS sandbox. Run untrusted code with
  care.
- **Debugger is Python-only** and requires `debugpy`.
- **Copilot FIM is a third-party integration** around GitHub's language server.
  It needs a Copilot subscription and Node.js 22.13+ on `PATH`; HIM+ is not a
  GitHub-supported IDE.
- **Provider quality varies.** FIM fallback is a chat-completion approximation;
  true FIM requires a provider that supports `/completions`.
- **Notebooks and debugging depend on local Python.** Missing `jupyter_client`,
  `ipykernel`, `pandas`, or `debugpy` disables the corresponding features.
- **ACP behaviour depends on each CLI.** Commands, auth, models, and permission
  semantics are owned by the external agent.
- **Unsigned builds.** No code-signing certificate is configured.
- **Early-stage project.** Public release history and a long-term maintenance
  track record are not established yet; APIs and formats may change before 1.0.
- **No automatic updates.** HIM+ can manually check an update feed you configure,
  but it never downloads or installs updates; upgrade by replacing the portable
  folder or rebuilding.

## License

HIM+ is released under the [MIT License](LICENSE), copyright © 2026 HIM+. Third-
party components retain their own licenses; see the dependency metadata and the
notes below.

## Third-party components

| Component | License / terms |
| --- | --- |
| Electron, Chromium, Node.js | MIT / BSD-style / MIT (see their bundled notices) |
| React, React DOM, Monaco Editor, Vite, esbuild, Tailwind CSS, Zustand | MIT |
| node-pty prebuilt multiarch (`@homebridge`), xterm.js | MIT |
| sql.js, diff, react-markdown, remark-gfm, lucide-react | MIT |
| GitHub Copilot Language Server (`@github/copilot-language-server` npm package) | MIT package; use is subject to GitHub Copilot terms and an active subscription |
| Inter, JetBrains Mono web fonts | SIL Open Font License |
| Cherry MX Brown key samples | Mechvibes sample pack, MIT attribution in `src/assets/sounds/SOURCE.txt` |
| Python integration: `debugpy` | MIT |
| Python integration: `jupyter_client`, `ipykernel`, `pandas` | BSD-3-Clause and related BSD licenses |
| HIM+ Code (experimental prebuilt) | Code OSS / VSCodium — MIT and their bundled third-party notices |
| VS Code extension host APIs (`vscode-extension/`) | VS Code extension API terms / MIT for HIM+ source |

HIM+ is not affiliated with or endorsed by GitHub, Microsoft, VSCodium, or the
maintainers of the third-party tools listed above. Dependency license texts are
installed with the corresponding packages.
