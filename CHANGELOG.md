# Changelog

All notable changes to HIM+ are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows semantic versioning once public releases begin. HIM+ is
currently an early preview; the 0.1.0 entry describes the initial preview
rather than a stable API commitment.

## [Unreleased]

### Added

- **Token accounting for every backend:** ACP agents report usage when available
  (parsed from `session/prompt` results) and otherwise estimate from streamed
  thinking/answer text; PTY CLI agents estimate from mirrored terminal output,
  including prompts typed directly into the terminal. Estimates show as `~N tok`.
  Streaming tokens are rendered incrementally (ACP flushes ~45 ms, PTY transcript
  ~120 ms) instead of appearing all at once.
- **CLI-agent persistence, token estimates and context compaction:** PTY prompts
  and cleaned output are mirrored into `AgentSession.messages`, so terminal CLI
  sessions are stored in SQLite/`chats.db` and restored after an app restart.
  Token counters are estimated from the mirrored text (PTYs report no usage).
  Long CLI transcripts auto-compact locally around 90k chars, plus a manual
  **Compress** action.
- **HIM+ VS Code extension 0.5.0:** multi-session chat with a session switcher,
  background subagents (`spawn_subagent`/`list_subagents`, up to three running),
  and a Handoff action that copies the transcript into a fresh review agent. The
  extension stays read-only. Built as `vscode-extension/him-plus-0.5.0.vsix`.
- **Session checkpoints and handoff:** a Session tools dialog in every agent
  (header merge icon) can snapshot the workspace as a git ref, review the diff
  since a checkpoint in Monaco tabs, and revert to it. CLI agents checkpoint
  automatically before each run. Handoff packages a checkpoint + request, source
  summary (marked untrusted) and changed files to a new or existing review agent.
- **ACP registry:** Settings → Integrations → ACP registry with curated agents,
  install/auth hints, one-click profile creation and launch-command health checks.
- **MCP sharing with ACP agents:** configured MCP servers are injected into
  `session/new.mcpServers`, so external agents see the same tool set as HIM+
  sessions (per-agent server instances; shared config/health source).
- **Notebooks follow the user's JupyterLab behaviour:** HIM+ detects
  `~/.jupyter` (theme selection, notebook `codeCellConfig`, `custom.css`) and
  mirrors cell line numbers, soft wrap and auto-closing brackets. The visual theme
  stays HIM+; Settings → Appearance shows the detection and can rescan.
- **Automatic data wrangler:** DataFrames now render **inline inside the cell that
  produced them** with PyCharm-style headers (type, null/unique counts, histograms,
  top values) and preview rows; inline views support column sort, row filtering and
  7/25/100-row preview sizes, and are **restored from saved notebook outputs** when
  a notebook is reopened (marked "saved output"). Wrangle/Profile/Open expand the
  full grid (toggle in Settings → Appearance). Added a column profile panel (type,
  null %, min/max/mean/std, numeric histograms, top values), JSON export alongside
  CSV, and pure helpers with tests.
- Workspace file-access restriction setting (default on): the renderer file IPC
  refuses paths outside the opened workspace, and the Settings → Appearance card
  can relax it. Agent file tools remain workspace-contained regardless.
- Approval cards now show the full shell command, its working directory, and an
  explicit "runs with your user permissions" note before execution.
- Manual update check in Settings → About: reads an optional JSON update
  manifest (`HIM_UPDATE_MANIFEST_URL` or `%APPDATA%\HIM+\update-feed.json`),
  reports the latest version/URL/checksum and never auto-installs.
- ACP agent sign-in support: HIM+ now reads the agent's advertised `authMethods`
  and runs its `authenticate` flow (e.g. Cline's browser sign-in) before opening
  a session; agents that require an external login (Copilot CLI) get an
  actionable message instead of a bare exit code.
- **CLI agents (terminal bridge):** a new agent backend for CLIs without ACP.
  Settings → Integrations → CLI agents has presets (Freebuff, Aider, Claude Code,
  Codex CLI, Gemini CLI) and custom commands; sessions run the CLI in a real PTY,
  stream output into the chat pane, send chat lines as terminal input, and expose
  a raw terminal for sign-in/permission screens. The chat view clearly states
  that HIM+ approvals and diffs do not apply to CLI agents.
- ACP failures now include the agent's own stderr output and targeted hints
  (missing CLI, outdated ACP flags, provider authentication, no models).
- Editor-focused tests: inline-edit sanitisation/validation, workspace path
  containment, system-prompt identity/context, ACP auth/error diagnostics, and
  version comparison.
- MIT LICENSE, PRIVACY.md, CHANGELOG.md, and a GitHub Actions Windows build
  workflow with SHA-256 checksums and explicit unsigned-build disclosure.
- SECURITY.md with the security model (keys, file access, commands, network),
  known limitations, reporting process, and build-verification steps; README now
  has a "Trust and verification" table linking each claim to its code and test.

### Changed

- Freebuff moved from the ACP presets to the new CLI-agent presets (its CLI has
  no ACP mode); unsupported ACP profiles for it are ignored when importing config.
- ACP presets fixed: Kilo now launches through `npx -y @kilocode/cli@latest acp`
  (legacy `kilo acp` profiles are migrated automatically), and Cline/Copilot
  entries describe their sign-in requirements.
- README rewritten: accurate product description, setup, notebooks/data
  wrangler, permissions and safety, privacy, HIM+ Code/experimental editions,
  release verification, and honest limitations.
- Agent system prompt now states that it runs inside HIM+ (not Zed/VS Code),
  includes the active file, and documents that shell commands are not
  OS-sandboxed.
- Settings → About no longer claims API keys are stored in plaintext; the
  safeStorage encryption and plaintext fallback are described accurately.
- Normalised stray text-encoding artefacts in UI strings.

### Fixed

- Inline edit could apply model reasoning (`think` blocks, `<rewrite_this>`
  markup) to the file. Output is now sanitised (reasoning/fences/markers
  stripped) and validated before the diff is shown and again immediately before
  it is applied; invalid output is rejected and nothing is written.
- No-change inline proposals no longer surface as an error; they report that the
  model proposed no changes.
- Diff previews now use the same sanitised inline-output path.

### Security

- Reasoning/control markup can no longer reach user files through inline edit.
- Renderer file access is workspace-confined by default; provider API keys
  remain encrypted at rest with Electron safeStorage.

## [0.1.0] - 2026-11-23

First preview release of the HIM+ desktop app for Windows x64.

### Added

- Native Electron 33 + React + Monaco desktop IDE with two modes: **Agent Mode**
  (Mission Control) and **IDE Mode**, switchable with `Ctrl+Shift+M`.
- Mission Control multi-agent sessions, including HIM+ native agent sessions and
  external agents connected over the Agent Client Protocol (ACP).
- Permission presets **plan**, **review**, and **auto**, cycleable with
  `Shift+Tab`, with visible execution state in each session.
- Approval gates that pause file writes and shell commands in Review mode, show
  the exact command/path in the approval card, and keep destructive commands
  gated even in Auto mode.
- Per-session plan artifacts (plan/notes/checklist) with inline comments and
  agent feedback, plus a Changes tab for reviewing and accepting/reverting file
  diffs.
- Isolated agent sessions through git worktrees, with per-session worktree
  branches and cleanup paths.
- BYOK provider configuration for any OpenAI-compatible endpoint: model catalog
  fetch or manual model IDs, separate primary/fast/planning defaults, custom
  headers, and optional vision/tool/context-window capability hints.
- Agent tools for reading, writing, patching, deleting, moving, searching files,
  running shell commands, git status/diff/log/commit, diagnostics, chat history
  search, web fetch, and notebook inspection/execution.
- SQLite-backed chat history in Electron `userData`, shared across agent
  backends and searchable by the agent's `search_chats` and `read_chat` tools.
- ACP agent profiles and presets (OpenCode, Hermes Agent, DeepSeek Harness,
  Cline, Kilo, GitHub Copilot CLI, Google Antigravity, plus custom commands; the
  Freebuff preset ships disabled), with streamed messages, tool calls, plans,
  file changes, model selection, and permission requests relayed into session
  state.
- Native `.ipynb` notebook tabs backed by a real Jupyter kernel through the
  `jupyter_client`/`ipykernel` Python bridge, with streaming cell output,
  interrupt, restart, run-all, and a fallback execution mode when a full kernel
  is unavailable.
- DataFrame data-wrangler grid with live preview over filter, sort, keep, drop,
  dropna, groupby, and value-counts steps; generated pandas code can be inserted
  as a new cell or inserted and run immediately.
- "Ask AI" on captured DataFrames, and agent tools `read_notebook` and
  `run_notebook_cell` with persistent kernel state.
- Monaco editor with explorer, tabs, search, quick open (`Ctrl+P`), inline edit
  (`Ctrl+K`), image preview tabs, resizable panels, workspace file watching,
  syntax highlighting, and seven HIM+ themes.
- LSP diagnostics, hover, and go-to-definition through configurable language
  servers (TypeScript, Python, Rust, Go, C/C++, plus custom entries) with
  auto-detection on `PATH`, user config in `userData/lsp.json`, and project
  config in `<workspace>/.him/lsp.json`.
- Real PTY terminal using node-pty/ConPTY on Windows, with interactive input,
  resize, and the user's shell (PowerShell/cmd profiles).
- Git panel with stage, unstage, commit, discard, branch/ahead/behind status,
  Monaco diff tabs, and git tools for the agent.
- Built-in Python debugging over the Debug Adapter Protocol using `debugpy`:
  breakpoints, continue/step, call stack, scopes/variables, evaluate, and log
  output.
- FIM-style inline completions from any OpenAI-compatible provider, with a
  true FIM (`/completions`) mode and a chat fallback, configured independently
  from chat models.
- Optional GitHub Copilot inline completions through GitHub's official Copilot
  language server, with device-flow sign-in, status/verify/sign-out actions, and
  Copilot taking precedence over HIM+ FIM when enabled.
- MCP client support for user (`userData/mcp.json`) and project
  (`<workspace>/.him/mcp.json`) stdio servers, exposing `mcp__<server>__<tool>`
  tools to the agent, with a status/reload panel.
- `web_fetch` agent tool for fetching public HTTP(S) pages as untrusted text.
- Seven themes, keyboard sounds, brand assets, Windows portable packaging, and
  shortcut installation scripts.
- Windows CI workflow that runs the tests, builds the portable package, writes
  SHA-256 checksums, and uploads the unsigned build and checksum as artifacts on
  version tags or manual dispatch.
- The packaging script now emits `release/HIM+-win32-x64/SHA256SUMS.txt` with a
  standard `<sha256>  HIM+.exe` line for release verification.
- Optional manual update check against a JSON manifest configured with
  `HIM_UPDATE_MANIFEST_URL` or `userData/update-feed.json`; HIM+ reports the
  latest version, checksum, and notes but never auto-downloads or auto-installs.
- Automated test suites for ACP client/transport/models/vision, Copilot
  connection and the real language server, DAP/debugpy, git status grouping,
  image path handling, LSP, MCP, notebook kernel bridge and wrangling, PTY and
  terminal input, inline edit, system prompt, workspace paths, version/update
  comparison, and VS Code extension helpers.

### Fixed

- Notebook execution streams partial kernel output while a cell is running
  instead of waiting for the final result, and interrupt/restart paths terminate
  the bridge cleanly.
- ACP sessions normalize agent-advertised model lists and image capabilities so
  the composer and model menu reflect what the external agent actually supports.
- Git status grouping distinguishes index and worktree states, including
  untracked files, so the status letters and diff views match.
- LSP lifecycle handling reopens already-open documents when a server starts or
  restarts, avoiding missing diagnostics on first edit.
- Terminal input handling keeps IME/composition and control keys working in the
  PTY, including terminal focus and command-run paths.
- Data-wrangler previews and generated pandas code stay in sync with the applied
  filter/sort/group steps and column selections.

### Security

- Provider API keys are encrypted at rest with Electron `safeStorage` (`enc:`
  prefix in `config.json`); plaintext is used only when encryption is
  unavailable.
- Agent file tools are workspace-contained: paths are resolved and rejected when
  they escape the open workspace; `.git` internals are blocked.
- Renderer file IPC is guarded to the workspace by default, closing the path for
  a compromised renderer to read or write outside the project.
- Approval cards show the command or file path that will be acted on; destructive
  commands remain approval-gated in Auto mode, and "Allow always" is not offered
  for destructive commands.
- Plan mode removes write, delete, move, commit, and terminal tools entirely;
  review mode gates every mutation.
- Fetched web pages, repository text, MCP results, and recalled chat history are
  treated as untrusted data in the agent system prompt to reduce prompt-injection
  risk.
- Local secret handling: HIM+ includes no telemetry or analytics; network
  requests are limited to the providers and integrations the user configures.
