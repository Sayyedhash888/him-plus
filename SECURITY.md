# Security policy — HIM+

HIM+ is an early-preview, local-first desktop IDE. This document describes the
security model, the known limits, and how to report issues. For what data leaves
your machine, see [PRIVACY.md](PRIVACY.md).

## Supported versions

Only the latest preview build is supported with security fixes. HIM+ is currently
version `0.1.0` (see `package.json`); releases are unsigned until a code-signing
certificate is configured.

## Reporting a vulnerability

Please do **not** open a public issue with a working exploit, API keys, personal
data, or private repository contents. Instead, contact the maintainer privately
(the repository contact/issue tracker), including:

- HIM+ version and Windows version,
- a minimal reproduction (no secrets),
- impact assessment (what an attacker could read/execute).

You will get an acknowledgement when the report is triaged. There is no bug bounty.

## Security model

### API keys

- Provider API keys are encrypted at rest with Electron `safeStorage`
  (Windows DPAPI). On disk they appear in `%APPDATA%\HIM+\config.json` as
  `enc:<base64>` — never as plaintext unless the OS provides no encryption
  provider, which is a documented fallback.
- Legacy plaintext keys are transparently re-encrypted on the next config save.
- A key that cannot be decrypted is emptied (with a warning) rather than crashing
  the app; key material is never logged.
- Keys are sent only to the provider endpoint you configured (plus Copilot if you
  enable it). HIM+ has no cloud backend of its own.

### File access

- Agent file tools (`read_file`, `write_file`, `apply_patch`, `delete_path`,
  `move_path`, …) resolve paths through a workspace resolver: traversal,
  absolute paths outside the workspace, and `.git` internals are rejected.
- The renderer's file IPC has an additional workspace guard, **on by default**
  (Settings → Appearance → *Restrict file access to the workspace*). Disabling it
  relaxes the renderer guard only; agent file tools remain contained.
- Only the opened workspace root is exposed in the file explorer and search.

### Commands

- Shell commands run with your normal OS user permissions **and are not
  OS-sandboxed**. Approval gates decide *when* a command runs, not what it can do.
- Review mode (default) pauses every file write, patch, delete, move, commit, and
  shell command. Approval cards show the exact command and working directory.
- Destructive commands pause even in Auto mode.
- For untrusted repositories: stay in Review mode, inspect every command, and
  prefer a spend-limited API key.

### Inline edits and AI-written code

- Inline-edit model output is sanitised and validated before it is shown and
  again immediately before it is written: reasoning blocks (`think`,
  `rewrite_this`), markdown fences, control markers, git conflict markers, empty
  output, and prose preambles are stripped or rejected. Invalid output is never
  applied.
- Agent edits are shown in a per-session diff and can be reviewed, accepted, or
  reverted; worktree isolation is available for git workspaces.

### Network

- No HIM+ telemetry, analytics, crash reporting, or automatic update installation.
- Requests go only to services you configure: LLM provider(s), optional GitHub
  Copilot, optional external ACP agents, MCP/LSP servers (local processes you
  install), URLs the agent is asked to fetch, and the optional update manifest.
- Inline completion requests include only editor context needed for the
  completion; FIM can be disabled entirely (Settings → Integrations).
- MCP/ACP/LSP servers are third-party programs. Their own network access and
  logging are outside HIM+'s control — review what you install.

### Update checks

The manual "Check for updates" action performs one HTTP GET to a JSON manifest
URL you configured (`HIM_UPDATE_MANIFEST_URL` or
`%APPDATA%\HIM+\update-feed.json`). It sends no prompts or code and never
downloads or installs anything by itself.

## Known limitations

- **Unsigned builds.** Windows SmartScreen may warn; verify the SHA-256 checksum
  before running a downloaded build.
- **Shell is not sandboxed.** Approval gates and destructive-command detection
  reduce risk but cannot contain an approved command.
- **No extension sandbox/marketplace.** HIM+ does not run VS Code extensions.
- **Third-party agents and servers** (ACP, MCP, LSP, Copilot) are trusted as
  configured; a compromised one can act within its own permissions.
- **Windows x64 only** at this preview stage.

## Verifying a build

1. Compare the SHA-256 of `HIM+.exe` with `SHA256SUMS.txt` in the release folder
   (`Get-FileHash .\HIM+.exe -Algorithm SHA256`).
2. Prefer builds produced by the repository's
   [CI workflow](.github/workflows/build.yml) from the tagged commit.
3. Confirm the claims in the README's **Trust and verification** section by
   running the test suite (`npm test`) and inspecting the referenced source files.
