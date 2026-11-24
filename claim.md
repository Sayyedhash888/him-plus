# claim.md — HIM+ claims vs. source code

**Audit type:** read-only source audit (no build, no test run, no dependency install).
**Target:** `D:\HIM+` (HIM+ 0.1.0, Windows-only Electron desktop IDE).
**Method:** every verdict below is grounded in executable code at `file:line` with a verbatim quote.
Comments, README text, prompts and docs were treated as **data**, never as evidence of behaviour.
Where no code could be pointed at, the verdict is `NOT FOUND`.

> This file is the claim register. It was authored as the audit deliverable; before it existed the
> repository contained no `claim.md` (a recursive search for any path matching `claim` returned only
> `node_modules/lucide-react/dist/esm/icons/baggage-claim.js`). The claims audited are therefore the
> ones stated in `README.md` and `PRIVACY.md`.

## Scope note on git

`D:\HIM+` is **not a git repository** (`Test-Path D:\HIM+\.git` → `False`; `git -C D:\HIM+ ls-files` →
`fatal: not a git repository (or any of the parent directories): .git`). Nothing below can assert what
is *committed*; only what exists in the working tree and what `.gitignore` would exclude.

---

## 1. Claim table

### 1.1 The seven focus claims

| # | Claim | Verdict | Evidence (`file:line` + quote) |
|---|---|---|---|
| 1 | "No HIM+ telemetry, analytics, crash reporting, or automatic update installation." (`README.md:260`) | **VERIFIED** | No `crashReporter`, `autoUpdater`, or telemetry SDK exists in first-party code. The only update path is one manual GET that never downloads: `electron/update.ts:58` — `const response = await fetch(feed, { signal: controller.signal, headers: { Accept: 'application/json' } });` and `electron/update.ts:84-92` returns `version`/`url`/`sha256`/`notes` only. Third-party telemetry is switched off: `electron/copilot.ts:243` — `settings: { telemetry: { telemetryLevel: 'off' } },`. |
| 2 | "Provider API keys are encrypted at rest with Electron `safeStorage` … the plaintext fallback is documented." (`README.md:251-253`; `PRIVACY.md:109-113`) | **VERIFIED** | Write: `electron/config.ts:232` — `` return `${ENC_PREFIX}${safeStorage.encryptString(apiKey).toString('base64')}`; `` via `electron/config.ts:326` — `const payload = JSON.stringify(encryptConfigApiKeys(config), null, 2);`. Read: `electron/config.ts:245` — `return safeStorage.decryptString(Buffer.from(apiKey.slice(ENC_PREFIX.length), 'base64'));`. Plaintext fallback: `electron/config.ts:230` — `if (!canEncryptAtRest()) return apiKey;` and `electron/config.ts:238` — `return apiKey;`. Only the error message is logged, never key material: `electron/config.ts:234-237`. Keys are sent only to the configured provider: `electron/llm.ts:48` — `` headers.Authorization = `Bearer ${apiKey.trim()}`; `` and `electron/fim.ts:45` (same). |
| 3 | "File tools are workspace-contained … rejected if they escape … `.git` internals are blocked. The renderer file IPC is additionally guarded by default; the setting can relax that renderer guard." (`README.md:235-239`; `PRIVACY.md:114-117`) | **PARTIAL** | Agent guard is real and unconditional: `src/lib/paths.ts:63-69` — `const inside = candidateLower === rootLower \|\| candidateLower.startsWith(`${rootLower}/`); if (!inside) { throw new Error(`Path "${raw}" is outside the active workspace.`) }`; `.git` block `src/lib/paths.ts:72-74`. Renderer guard: `electron/fsops.ts:70-74` — `const relative = path.relative(workspaceRoot, resolved); if (relative === '..' \|\| relative.startsWith(`..${path.sep}`) \|\| path.isAbsolute(relative)) { throw … }`, default on at `electron/fsops.ts:60` — `let restrictToWorkspace = true;`. **Counter-evidence:** no `realpath` anywhere (findings A/B/C below); `nb:`/`git:` IPC are unguarded; the guard fails *open* when no workspace is registered. |
| 4 | "Review (default): Read-only tools run freely; every file write, patch, delete, move, commit, and shell command waits for your approval." (`README.md:230`) | **PARTIAL** | A single choke point exists for the built-in agent: `src/lib/agent/tools.ts:430` — `return READ_TOOL_NAMES.includes(toolName) ? 'allow' : 'ask';`, called exactly once at `src/lib/agent/runtime.ts:784` — `const policy = approvalPolicy(current.permission, call.name, args);` and enforced at `runtime.ts:795-821`. **Counter-evidence:** the ACP backend never routes through it — `electron/acp.ts:88-89` writes files with no permission check at all (finding D). |
| 5 | "Auto: Workspace edits and ordinary commands are auto-approved. Destructive commands (recursive deletes, hard resets, force pushes, and similar) still pause for explicit approval." (`README.md:231`) | **PARTIAL** (effectively contradicted in the general case) | The detector exists and is wired in: `src/lib/agent/tools.ts:403-405` — `export function isDestructiveCommand(command: string): boolean { return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command)); }` used at `src/lib/agent/tools.ts:426` — `return isDestructiveCommand(command) ? 'ask' : 'allow';`. **Counter-evidence:** applied to `run_terminal_command` only — `src/lib/agent/tools.ts:423-428` — `if (permission === 'auto') { if (toolName === 'run_terminal_command') { … } return 'allow'; }` auto-approves `delete_path`, `write_file`, `apply_patch`, `git_commit`, `run_notebook_cell`, and all MCP tools (`tools.ts:414-418`); the 18-regex list is trivially bypassed (finding E). |
| 6 | "`Ctrl+K` inline edit with a fast model; every proposal is reviewable before it is applied." (`README.md:188-189`) | **VERIFIED** (review step) / **PARTIAL** (output sanitising) | Review step is genuine: diff preview `src/components/ide/InlineCtrlK.tsx:104` — `onDelta: (text) => setGenerated(text),`; single apply trigger `src/components/ide/InlineCtrlK.tsx:354-356` — `onClick={accept} disabled={status !== 'done' \|\| generated === null}`; re-validation before the write `InlineCtrlK.tsx:127` — `const validated = validateInlineOutput(session.original, generated);` then `InlineCtrlK.tsx:141-143` — `session.editor.executeEdits('him-inline-edit', [{ range: session.range, text: validated.code, forceMoveMarkers: true }]);`. No auto-accept / stream-into-editor / Enter-to-apply path found. Sanitising is incomplete (finding F). |
| 7a | Build time: does anything download or execute remote code? | **PARTIAL** | First-party is clean: `package.json:10-21` declares **no** `preinstall`/`postinstall`/`prepare`/`prepublish`/`prepack` hook; `scripts/build-electron.mjs`, `scripts/package-win.cjs`, `scripts/make-icon.cjs`, `scripts/install-shortcuts.ps1`, `scripts/build-him-vscode-themes.mjs` contain no network call, no eval, and no spawn of a remote artifact. Every lockfile `resolved` URL is the npm registry (477/477, 27/27, 11/11). Remote binaries arrive only through **dependency** postinstalls run by `npm ci`: `node_modules/electron/install.js:3` — `const { downloadArtifact } = require('@electron/get');` with host `node_modules/@electron/get/dist/cjs/artifact-utils.js:4` — `const BASE_URL = 'https://github.com/electron/electron/releases/download/';`, and `node_modules/esbuild/install.js:235`. |
| 7b | "CI builds the same unsigned package on `windows-latest`" producing the portable folder, `SHA256SUMS.txt` and `BUILD-INFO.txt` as artifacts. (`README.md:100-101, 355-361`) | **VERIFIED** | `.github/workflows/build.yml:24` — `runs-on: windows-latest`; `:34` — `node-version: '22'`; `:38` — `run: npm ci`; `:45` — `run: npm test`; `:48` — `run: npm run build`; `:53` — `run: npm run package:win`; `:62` — `$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()`; `:77-84` writes `BUILD-INFO.txt` including `"Code signing: not configured (unsigned artifact)"`; `:86-99` two `actions/upload-artifact@v4` steps. `:14-15` — `permissions: contents: read` (no release publishing). No `curl \| bash`, `iwr \| iex`, or `npx` anywhere in the workflow. |

### 1.2 Secondary claims

| Claim | Verdict | Evidence |
|---|---|---|
| Plan mode: "Write, delete, move, commit, and terminal tools are removed." (`README.md:229`) | **VERIFIED** | `src/lib/agent/tools.ts:370-373` — `if (permission === 'plan') { return TOOL_SCHEMAS.filter((tool) => READ_TOOL_NAMES.includes(tool.function.name)); }`; also denied at policy level `src/lib/agent/tools.ts:419-421`. |
| "Approval cards show the exact command or path." (`README.md:230`) | **PARTIAL** | `src/lib/agent/tools.ts:484-512` (`describeToolCall`) lifts `path`/`command`/`query`/`url`; but for `run_notebook_cell` only `meta.path` is recorded — the `code` to be executed is never shown — and MCP calls using other argument names display only the tool name (`src/lib/agent/tools.ts:493`). |
| "Shell commands are not OS-sandboxed." (`README.md:240-242`) | **VERIFIED** | `electron/shell.ts:104-110` — `child = spawn(options.command, { cwd: options.cwd, shell: true, windowsHide: true, … })`; the main process validates types only: `electron/shell.ts:264` — `if (!request \|\| typeof request.command !== 'string' \|\| typeof request.cwd !== 'string')`. |
| "Chats and configuration stay on your machine; there is no HIM+ account or HIM+ cloud." (`README.md:23-24`) | **VERIFIED** | Every egress sink is user-configured (see §2). Storage is `userData`: `electron/config.ts:284` — `const dir = process.env.HIM_CONFIG_DIR \|\| app.getPath('userData');`; `electron/main.ts:67` — `const chatStore = new ChatStore(path.join(app.getPath('userData'), 'chats.db'));`. |
| "`web_fetch` makes requests to the URLs the agent asks for." (`PRIVACY.md:25`) | **VERIFIED** | `src/lib/agent/tools.ts:633` — `const result = await him.web.fetch(rawUrl);` → `electron/web.ts:66-75` — `const response = await fetch(url, { method: 'GET', redirect: 'follow', … })`; http(s)-only and credential-bearing URLs rejected at `electron/web.ts:52-57`. |
| "Seven themes (Black, Dark Grey, Light, Marimo, Midnight, Terminal, Sandstone)." (`README.md:200-201`) | **VERIFIED** | Exactly seven theme objects: `src/lib/themes.ts:97-98, 174-175, 251-252, 328-329, 406-407, 483-484, 560-561`. |
| "Real ConPTY terminal, via node-pty." (`README.md:40`) | **VERIFIED** | `electron/pty.ts:56` — `ptyModule = require('@homebridge/node-pty-prebuilt-multiarch') as PtyModule;`; `electron/pty.ts:116-127` — `pty.spawn(shell.command, shell.args, { … useConpty: process.platform === 'win32', })`. |
| "Local SQLite chat history." (`README.md:42`) | **VERIFIED** | `electron/chatStore.ts:4` — `import initSqlJs from 'sql.js';`; `electron/chatStore.ts:88-89` — `const sql = await initSqlJs({ locateFile: (file) => path.join(__dirname, file) });`. |
| "Native `.ipynb` tabs backed by a real Jupyter kernel through a Python bridge." (`README.md:37`) | **VERIFIED** | `electron/nb.ts:43` — `const child = spawn(pythonCommand(), ['-u', script], {`; cell execution `electron/nbKernelBridge.py:262-263` — `exec(compile(tree, "<cell>", "exec"), GLOBALS)` / `eval(compile(last_expr, "<cell>", "eval"), GLOBALS)`. |
| "The desktop app … has no VS Code extension host or marketplace." (`README.md:26-27`) | **VERIFIED** | No extension-host dependency in `package.json:22-58`; the only `vscode` import lives under `vscode-extension/`. |
| VS Code extension agent is "deliberately read-only". (`README.md:289-292`) | **VERIFIED** | `vscode-extension/src/agent.ts:47-81` declares only `read_file`, `list_files`, `active_file`; `vscode-extension/src/agent.ts:145-156` implements only those three and otherwise throws `Unknown tool`. |
| "A prebuilt copy exists under `release/HIM+Code-win32-x64/`… No script in this repository builds it." (`README.md:282-288`) | **VERIFIED** | `release/HIM+Code-win32-x64/HIM+Code.exe` present; no `package.json` script references it; only `scripts/install-himcode-shortcuts.ps1:2` (shortcut creation). |
| "`theia/` — … Only a cached npm directory remains; it is not built, packaged, or supported." (`README.md:297-298`) | **VERIFIED** | `theia/` contains only `.npm-cache/`; no script references it. |
| Renderer hardening | **PARTIAL** | `electron/main.ts:167-169` — `contextIsolation: true, nodeIntegration: false, sandbox: false` — the renderer sandbox is **off** (finding G). Compensating controls: `electron/main.ts:179-189` (`setWindowOpenHandler` denies), `electron/main.ts:191-196` (`will-navigate` blocked), `electron/main.ts:233-235` — `session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false); });`. |

---

## 2. Complete outbound-network inventory

Every network call in first-party code. **No hardcoded IP addresses exist anywhere** in
`electron/`, `src/`, `shared/`, `scripts/`, or `vscode-extension/src/`. The only hardcoded URL is the
Copilot device-flow page.

| # | Location | What is sent | Triggered by |
|---|---|---|---|
| 1 | `electron/llm.ts:63` — `const response = await fetch(url, { method: 'GET', headers: buildHeaders(input.apiKey, input.headers, 'application/json'), signal: controller.signal });` | GET `{baseUrl}/models`, `Authorization: Bearer <key>` | User clicks "fetch model list" |
| 2 | `electron/llm.ts:397` — `response = await fetch(url, { … headers: buildHeaders(request.apiKey, request.headers, 'text/event-stream'), … })` | POST prompt + conversation context + tool schemas + `Bearer <key>` | User sends a chat / agent / planning turn |
| 3 | `electron/fim.ts:71-83` — `await fetch(completionsUrl(input.baseUrl), { method: 'POST', … body: JSON.stringify({ model: input.model, prompt: input.prefix, suffix: input.suffix, … }) })` | POST prefix/suffix code + `Bearer <key>` | Keystroke with FIM enabled |
| 4 | `electron/fim.ts:102-123` | POST before/after-cursor code (chat fallback) | Keystroke with FIM enabled |
| 5 | `electron/update.ts:58` — `const response = await fetch(feed, { signal: controller.signal, headers: { Accept: 'application/json' } });` | GET to the user-configured feed URL; no body, no prompts | User presses **Check for updates** |
| 6 | `electron/web.ts:66-75` — `const response = await fetch(url, { method: 'GET', redirect: 'follow', … headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HIM+/0.1 (+local AI IDE)', … } });` | GET to the URL the agent chose; UA identifies HIM+ | Agent `web_fetch` tool call (`src/lib/agent/tools.ts:633`) |
| 7 | `vscode-extension/src/fim.ts:79` — `const response = await fetch(url, {` | POST completion + `Bearer <key>` | Extension FIM |
| 8 | `vscode-extension/src/agent.ts:192` — `const response = await fetch(chatCompletionsUrl(model.provider.baseUrl), {` | POST chat + tool schemas | Extension chat |
| 9 | `electron/copilot.ts:138` — `const child = spawn(node.binary, [script, '--stdio'], { … })` (the language server then makes its own HTTPS calls to GitHub) | Editor context + completion requests over stdio; `electron/copilot.ts:444` — `current.connection.notify('textDocument/didShowCompletion', { item });` | Copilot enabled and signed in |
| 10 | `electron/copilot.ts:196` — `void shell.openExternal(uri);` (on server `window/showDocument`) | Opens the browser to a **server-supplied** http(s) URL | Copilot language-server request |
| 11 | `electron/main.ts:127` / `electron/main.ts:183` — `await shell.openExternal(parsed.toString());` | Opens the browser to a renderer/site-supplied http(s) URL | User click / window-open attempt |
| 12 | `electron/dapClient.ts:59` — `const socket = net.createConnection({ host, port });` | TCP to the debug adapter host/port | Debug session |
| 13 | `electron/mcpClient.ts:122-128` — `spawn(this.options.command, this.options.args \|\| [], { … shell: this.options.shell ?? process.platform === 'win32', … })` | Whatever the MCP server does | Agent session loads MCP tools (automatic) |
| 14 | `electron/acpClient.ts:167`, `electron/lspClient.ts:195` | Whatever the ACP/LSP process does | User-configured agent / opening a file |

**Runtime remote-code download worth flagging:** the ACP presets execute unpinned packages from npm —
`src/components/SettingsModal.tsx:139` — `args: ['-y', 'cline@latest', '--acp']`,
`src/components/SettingsModal.tsx:145` — `args: ['-y', '@kilocode/cli@latest', 'acp']`,
`src/components/SettingsModal.tsx:166` — `args: ['-y', '@github/copilot@latest', '--acp']`.
`README.md:122-127` tells users to "Install and authenticate the CLI separately"; the preset instead
downloads and runs `@latest` at launch.

---

## 3. Most serious findings

**A. No symlink/junction resolution — both containment layers are purely lexical.**
`grep realpath` over `src/`, `electron/`, `shared/` → **no matches**. The checks are string-based:
`src/lib/paths.ts:63-64` — `const inside = candidateLower === rootLower || candidateLower.startsWith(`${rootLower}/`);`
and `electron/fsops.ts:70-71` — `const relative = path.relative(workspaceRoot, resolved); if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))`.
The I/O follows links: `electron/fsops.ts:131` — `const buffer = await fs.readFile(resolved);` and
`electron/fsops.ts:170` — `await fs.writeFile(resolved, content, 'utf8');`. A directory junction inside
the workspace pointing outside defeats both layers for read and write. Same class applies to
`electron/git.ts:160-167`, `electron/acp.ts:48-58`, `electron/debug.ts:69-76`.

**B. `nb:` IPC reads and writes arbitrary absolute paths with no guard at all.**
`electron/nb.ts:220-221` — `const resolved = path.resolve(notebookPath); const text = await fs.readFile(resolved, 'utf8');`
and `electron/nb.ts:271-272` + `:290` — `const resolved = path.resolve(data.path); … await fs.writeFile(resolved, …)`,
exposed raw to the renderer at `electron/preload.ts:308` — `open: (path: string) => ipcRenderer.invoke('nb:open', path)`.
No `guardPath`, no `workspacePath`, no `.git` check. `git:*` handlers are likewise unguarded as to *root*
(`electron/git.ts:313-326`), and `git discard` reaches `shell.trashItem` (`electron/git.ts:280`).

**C. The renderer file guard fails *open*, not closed, until a workspace is registered.**
`electron/fsops.ts:69` — `if (!restrictToWorkspace || !workspaceRoot) return resolved;` with
`electron/fsops.ts:59` — `let workspaceRoot: string | null = null;`. Only two call sites ever set it:
`src/lib/actions.ts:85` and `src/components/SettingsModal.tsx:1784-1785`.

**D. ACP file writes bypass the approval gate completely — including in Plan mode.**
`electron/acp.ts:88-89` — `await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, request.content, 'utf8');`
inside `writeTextFile`, which never consults `entry.permission` and never calls `decidePermission`
(contrast `electron/acp.ts:148-153`, where Plan mode does reject permission requests). HIM+ advertises
this channel to the external agent: `electron/acpClient.ts:201-202` — `clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, }`,
wired at `electron/acp.ts:212-215` and `electron/acpClient.ts:593-604`. The change is recorded for review
*after* the fact (`electron/acp.ts:90-99`). ACP sessions never import `src/lib/agent/approvals.ts`.

**E. Auto mode auto-approves everything except literal `run_terminal_command` strings.**
`src/lib/agent/tools.ts:423-428`:
```ts
if (permission === 'auto') {
  if (toolName === 'run_terminal_command') {
    const command = typeof args.command === 'string' ? args.command : '';
    return isDestructiveCommand(command) ? 'ask' : 'allow';
  }
  return 'allow';
}
```
So `delete_path` (→ recycle bin, `tools.ts:961`), `write_file`, `apply_patch`, `git_commit` and
`run_notebook_cell` (arbitrary Python) are silently approved; `src/lib/agent/tools.ts:414-418`
auto-approves **all** MCP tools; `electron/acp.ts:151-153` auto-approves **every** ACP permission request.
The 18-regex list at `src/lib/agent/tools.ts:382-401` is trivially bypassed. Verified non-matching inputs:
`git -C . reset --hard`, `git reset -q --hard`, `git clean --force -d`, `git push origin +main`,
`rm --recursive --force /`, `rm "-rf" /`, `rm -rf${IFS}/`, `R=rf; rm -$R /`, `erase /q /s C:\x`,
`ri -Recurse -Force C:\x`, `Remove-Item -Rec C:\x`, `Get-ChildItem -Recurse | Remove-Item -Force`,
`format.com C:`, `mke2fs /dev/sda1`, `dd of=/dev/sda`, `chmod 777 -R /`, `find . -type f -delete`,
and any base64 / `-EncodedCommand` wrapping. It also over-matches (fail-safe direction):
`echo "git push --force"` → ASK.

**F. Inline-edit sanitising covers a fixed four-tag list; other wrapper tags reach the file verbatim.**
`src/lib/inlineValidation.ts:15` — `const REASONING_TAG_NAMES = ['thinking', 'think', 'reasoning', 'rewrite_this'] as const;`.
` thinking` and `<rewrite_this>` **are** handled — block removal at `src/lib/inlineValidation.ts:44-56`,
leftover rejection at `src/lib/inlineValidation.ts:122` — `if (REASONING_LEFTOVER_RE.test(code) || REWRITE_WORD_RE.test(code))`.
But `<code>…</code>`, `<output>`, `<answer>`, `<final>`, `<file>`, `<analysis>`, `<rewrite>` (no `_this`),
HTML comments and `~~~` tilde fences match none of the patterns (`SPECIAL_TOKEN_RE` needs `<|`,
`MARKDOWN_FENCE_RE` is `/```/`), so they pass `ok: true` at `src/lib/inlineValidation.ts:145` and are
written by `src/components/ide/InlineCtrlK.tsx:141-143`. The **agent-panel Apply button writes model
text with no validation at all**: `src/components/ui.tsx:425` — `onClick={() => onApply(code)}` →
`src/lib/actions.ts:363-369` → `src/lib/editorBridge.ts:47-53` — `editor.executeEdits('him-apply', [{ range: selection, text: code, forceMoveMarkers: true }]);`.
FIM is likewise unvalidated (`electron/fim.ts:54-61`, `src/lib/fim.ts:83-84`). A parser-bypass fallback
also exists: `src/lib/inline.ts:94` — `const raw = result.content ? streamed || result.content : streamed;`.

**G. Repo-controlled config spawns processes automatically; the renderer sandbox is off.**
Opening a repository containing `.him/lsp.json` or `.him/mcp.json` causes an attacker-chosen command to be
spawned with no per-command prompt: `electron/lsp.ts:109-111` — `return root ? path.join(root, '.him', 'lsp.json') : '';`
→ `electron/lspClient.ts:195` — `spawn(this.options.command, this.options.args || [], { … shell: … })`;
`electron/mcp.ts:38` → `electron/mcpClient.ts:122-125` — `spawn(this.options.command, …, { shell: this.options.shell ?? process.platform === 'win32' })`.
LSP is triggered automatically on workspace change (`src/lib/lsp.ts:105`) and MCP during agent tool
loading (`src/lib/mcp.ts:37`). Separately, `electron/main.ts:169` — `sandbox: false` disables the
renderer sandbox.

**H. Build-time remote binaries (low severity, expected).**
`npm ci` runs dependency install scripts: `node_modules/electron/install.js:3` —
`const { downloadArtifact } = require('@electron/get');` with host
`node_modules/@electron/get/dist/cjs/artifact-utils.js:4` — `const BASE_URL = 'https://github.com/electron/electron/releases/download/';`,
and `node_modules/esbuild/install.js:235` fetching from `registry.npmjs.org`. No first-party script does
this, and no lockfile entry resolves outside the npm registry.

---

## 4. Suspicious-pattern sweep

| Category | Result |
|---|---|
| `eval(` / `new Function(` / `vm.runIn` / dynamic require-import | **No JS/TS hits.** Only `electron/nbKernelBridge.py:262-263` — `exec(compile(tree, "<cell>", "exec"), GLOBALS)` / `eval(compile(last_expr, "<cell>", "eval"), GLOBALS)` — intended notebook cell execution in a child Python process. |
| `child_process` with `shell: true` | `electron/shell.ts:104-106`, `electron/mcpClient.ts:125`, `electron/mcp.ts:94`, `electron/lspClient.ts:198`, `electron/acpClient.ts:170`. All other spawns use fixed argument arrays (`electron/git.ts:26`, `electron/pty.ts:67/116`, `electron/nb.ts:43`, `electron/debug.ts:42/110`, `electron/copilot.ts:45/58/138`). |
| base64 blobs | `src/assets/sounds/samples.ts` — all six payloads decoded; each is a valid, self-consistent RIFF/WAVE file (e.g. 14924 b64 chars → 11192 bytes, RIFF size field matches exactly). No appended data. `src/lib/keyboardSound.ts:36` — `const binary = atob(base64);` only decodes those. Remaining uses are image data-URLs (`electron/attachments.ts:39,95,115`, `electron/fsops.ts:159`) and `safeStorage` (`electron/config.ts:232,245`). |
| Hardcoded IPs / hidden endpoints | **No IP literals.** No analytics, pastebin, webhook, ngrok, Telegram or Discord endpoints. Only `electron/copilot.ts:35` — `const TOKEN_FILE_HINT = 'https://github.com/login/device';` and the provider presets at `src/components/SettingsModal.tsx:74-104`. |
| Obfuscated / minified code in source folders | **None.** No `_0x…` identifiers, no packed strings. `vscode-extension/dist/extension.js` is a clean, **non-minified** esbuild bundle (1235 lines, ~44 chars/line) whose module annotations match exactly the four `src/` files and whose requires are limited to `vscode`, `node:child_process`, `node:crypto`, `node:fs`, `node:path`. |
| Env-var backdoors | **None.** Full set: `HIM_CONFIG_DIR`, `VITE_DEV_SERVER_URL`, `HIM_UPDATE_MANIFEST_URL`, `ComSpec`/`SHELL`/`USERPROFILE`/`HOME`, `ProgramFiles`/`LOCALAPPDATA`. |
| Credential / browser-profile harvesting | **None** — no `.ssh`, `.aws`, `.npmrc`, `.git-credentials`, keychain, wallet, or `Login Data`/`Cookies` access. |
| Autostart / persistence writes | **None** — no Run keys, Startup folder, `schtasks`, shell rc files, or git hooks. `scripts/install-shortcuts.ps1:11-22` writes only Desktop/Start Menu shortcuts to HIM+'s own EXE. |
| Instructions to an AI to ignore rules / exfiltrate | **None found.** The closest text is the opposite: `src/lib/agent/prompts.ts:118-119` instructs the agent to treat fetched and repository text as untrusted data. |
| Committed binaries / build outputs present | `vscode-extension/him-plus-*.vsix` × **8** (0.1.0–0.3.3, 15 KB–46 KB) — **not covered by `.gitignore`**; `build/icon.ico`, `build/icon.png`; `.tools/node_modules/rcedit/bin/*.exe` (2.3 MB) and `.tools/package*.json` (`.tools/` is not ignored); `release/` (238 MB + 189 MB EXEs, DLLs, ASARs, `Codeium.codeium-1.48.2.vsix`) is ignored by `.gitignore:4`. Tracked status is unverifiable — see the scope note. |
| Unexpected dependencies | None. All dependency specs are semver ranges (`package.json:22-58`); no URL, git or tarball specifiers in any lockfile. |
| Stale committed build output | `release/HIM+-win32-x64/resources/app/dist-electron/main.cjs` is 317,911 B vs. a fresh `dist-electron/main.cjs` at 311,879 B, and still contains `.map` files that `scripts/package-win.cjs:38-40` deletes — the shipped `release/` folder predates the current packaging script. |

---

## 5. Claims that could NOT be verified, and why

1. **"What is actually committed."** `D:\HIM+` is not a git repository, so no claim about tracked files,
   committed binaries or repository history can be substantiated. Only working-tree contents and
   `.gitignore` rules are observable.
2. **Provenance/integrity of the prebuilt HIM+ Code distribution.** `release/HIM+Code-win32-x64/resources/app/product.json`
   reports `extensionsGallery serviceUrl: https://open-vsx.org/vscode/gallery` and
   `"repository": { "type": "git", "url": "https://github.com/microsoft/vscode.git" }`, but a 239 MB
   prebuilt binary cannot be verified against upstream from this checkout. `README.md:288` already
   concedes it is "not reproducible from this repository alone".
3. **Internals of `@github/copilot-language-server`.** Only its invocation is visible
   (`electron/copilot.ts:138`); its network behaviour is third-party and out of scope. What the code
   shows is consistent with the disclosure: `electron/copilot.ts:243` requests `telemetryLevel: 'off'`,
   while `electron/copilot.ts:444` still relays `didShowCompletion` per the Copilot protocol.
4. **Runtime behaviour of the findings.** Nothing was built or executed (read-only audit), so the symlink
   bypass (A) and the notebook-IPC hole (B) are proven by the absence of resolution/guard code on the
   paths that perform I/O, not by executing an exploit.
5. **`HIM_CONFIG_DIR` ordering across all modules.** `electron/main.ts:24-26` — `app.setPath('userData', process.env.HIM_CONFIG_DIR)`
   and `electron/config.ts:284` implement the override for config, and `ChatStore`/attachments/worktrees
   read `app.getPath('userData')` afterwards, but full runtime ordering was not executed.

---

## 6. Bottom line

The privacy and secret-storage claims hold up: there is **no telemetry, no crash reporting, no
auto-update, no covert endpoint, no obfuscation, no credential harvesting and no persistence**, and API
keys are genuinely encrypted at rest with a documented plaintext fallback. The failures are inside the
**safety** claims, and they are architectural rather than concealed:

1. file containment is lexical and therefore symlink-bypassable, and does not cover notebook/git IPC;
2. the approval gate does not cover the ACP backend at all — including Plan mode;
3. Auto mode's "destructive commands still pause" only ever inspected one tool against one string pattern;
4. inline-edit sanitising protects a fixed four-tag list, while the agent-panel Apply path and FIM have
   no sanitising at all.
