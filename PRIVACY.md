# HIM+ Privacy

HIM+ is a local-first desktop IDE. This document explains, in plain language, what
HIM+ sends off your machine, what it stores locally, and how to delete that data.

**Short version:** HIM+ has no telemetry, analytics, crash reporting, or automatic
update checks. HIM+ talks to the model providers and integrations *you* configure;
the optional update check is manual and contacts only a feed you provide. Your
configuration, chats, and attachments are stored on your own machine.

---

## What leaves your machine

HIM+ itself does not send diagnostic or usage data anywhere. The following
features do make network requests, and only when you use or enable them.

| Destination | When | What is sent | Controlled by |
| --- | --- | --- | --- |
| **Your LLM provider** (OpenAI-compatible endpoint, hosted or local) | You send a chat message, run an agent turn, use inline edit, or trigger FIM autocomplete | The prompt, the conversation context selected for that request (including relevant files/snippets and any attached images or files), and tool schemas. Your API key is sent as an auth header to the endpoint you configured. | You add the provider and key in **Settings → Providers**. |
| **GitHub Copilot** (optional) | Copilot inline completions are enabled and you are signed in | Editor context and completion requests are sent to GitHub's Copilot service by the official Copilot language server running locally. HIM+ does not store your Copilot tokens. | Off by default. Enable it in **Settings → Integrations → Copilot**; requires a Copilot subscription and Node.js 22.13+ on `PATH`. |
| **External ACP agents** (optional) | You start an ACP agent session and send a prompt | The prompt, workspace context, and tool calls that HIM+ passes to the agent. The agent decides what to forward to its own provider and may keep its own logs. | You configure the ACP command in **Settings → Integrations → External agents · ACP**; the CLI's own authentication is separate. |
| **MCP servers** (optional) | MCP tools are available in an agent session | Tool-call arguments and results. MCP servers are local processes you configure; they may access the network or files themselves. | Your `mcp.json` (see [local data](#what-is-stored-locally)). |
| **LSP servers** (optional) | You open a file whose language has a configured server | File contents, positions, and language-server requests over a local stdio connection. Some servers may download indexes or contact external services depending on their own configuration. | Servers on `PATH` plus your `lsp.json` (see below). |
| **`web_fetch` target URLs** (agent tool) | The agent fetches a public `http(s)` URL you asked it to research | An ordinary HTTP request to that URL. The remote server sees your IP address and request, as it would from any client. | The agent's requested URL; read-only tool. |
| **Update manifest feed** (optional) | You press **Check for updates** in Settings → About | A single HTTP GET to the update manifest URL you configured. No prompts, code, or chat data are sent. | `HIM_UPDATE_MANIFEST_URL` or `%APPDATA%\HIM+\update-feed.json`. |
| **Your browser** (Copilot sign-in only) | You sign in to Copilot | A GitHub device-flow page opens in your browser. | You start sign-in manually. |

There is no other HIM+ telemetry or "phone home" channel. Package-manager and
Electron/Chromium network behaviour during development is outside the app's own
code paths.

### Copilot caveat

GitHub Copilot support in HIM+ is a third-party client integration around GitHub's
official Copilot language server. It is not a GitHub-supported IDE, and your use
of Copilot is governed by GitHub's terms and your Copilot subscription. HIM+
launches the language server as a local process and relays completion requests;
it does not proxy or persist your Copilot session tokens.

### MCP and ACP caveat

MCP servers and ACP agents are programs you install and configure. HIM+ can tell
you what it sends them, but it cannot control what they do with that data, what
they log, or where they connect. Treat third-party MCP servers and ACP CLIs with
the same care as any other developer tool you run locally.

---

## What is stored locally

HIM+ desktop stores its data in Electron's `userData` directory. On Windows this
is normally `%APPDATA%\HIM+\`. You can override the location with the
`HIM_CONFIG_DIR` environment variable.

| Path | Contents |
| --- | --- |
| `%APPDATA%\HIM+\config.json` | Providers, endpoints, enabled models, model defaults, UI preferences, FIM/Copilot toggles, ACP profiles (including any environment variables you set), and the last workspace. Provider API keys are stored with an `enc:` prefix when Windows encryption is available (see [Security notes](#security-notes)). |
| `%APPDATA%\HIM+\chats.db` | SQLite database of conversations, messages, and stored tool results. The agent's `search_chats` / `read_chat` tools read this local file. |
| `%APPDATA%\HIM+\attachments\` | Images and files you paste or drop into a chat. |
| `%APPDATA%\HIM+\worktrees\` | Git worktrees created for isolated agent sessions. The matching branches live in your git repository. |
| `%APPDATA%\HIM+\lsp.json` | Optional user-wide language-server configuration. |
| `%APPDATA%\HIM+\mcp.json` | Optional user-wide MCP server configuration (may contain environment variables/secrets). |
| `%APPDATA%\HIM+\update-feed.json` | Optional pointer to a JSON update-manifest URL for the manual update check. |
| `%APPDATA%\HIM+\` (other files) | Electron/Chromium caches, GPU cache, and logs managed by the runtime. |
| `<workspace>\.him\lsp.json` | Optional project-level language-server configuration (may be committed by you). |
| `<workspace>\.him\mcp.json` | Optional project-level MCP configuration (may be committed by you). |

HIM+ does not create a cloud account or sync your data. There is no HIM+ server.

### Experimental HIM+ Code / VS Code extension

If you use the experimental HIM+ Code compatibility build (a Code OSS/VSCodium-based
distribution, not built by this repository), that application stores its own data
under its `data\user-data` directory (settings, workspace state, logs, extension
storage). The HIM+ extension reads `%APPDATA%\HIM+\config.json` (or the path set in
`him.configPath`) and stores its chat history in the host editor's workspace state.
The upstream editor and any extensions you install have their own privacy
behaviour and settings.

---

## How to delete your data

1. **Close HIM+.** Make sure no agent, notebook kernel, or debug session is running.
2. **Delete the HIM+ data directory** — normally `%APPDATA%\HIM+\`. This removes
   `config.json`, `chats.db`, saved attachments, cached files, and the local
   worktree folders.
3. **Remove project configuration** — if you created `<workspace>\.him\`, delete it
   (and commit the deletion if it was tracked).
4. **Clean up git worktrees** — if you delete `%APPDATA%\HIM+\worktrees\` manually,
   run `git worktree prune` in the repository to clear stale registrations. Branches
   named `him/...` can be deleted with `git branch -D` when you no longer need them.
5. **Revoke credentials** — remove or rotate the API keys at your providers, and
   sign out of Copilot in HIM+ or revoke the GitHub authorization in your GitHub
   account settings if desired.
6. **Uninstall** — HIM+ desktop is portable. Delete its folder (`release\HIM+-win32-x64\`)
   and any shortcut you installed. There is no uninstall registry entry for the
   portable build.

Deleting the data directory removes the only HIM+-owned copies of your chats and
configuration. Provider-side logs, Copilot-side data, and ACP/MCP server data are
governed by those services, not by HIM+.

---

## Security notes

- **API keys at rest:** Provider keys are encrypted with Electron's `safeStorage`
  (Windows DPAPI, tied to your Windows account) and written as `enc:<base64>` in
  `config.json`. If encryption is unavailable, HIM+ falls back to storing the key as
  plaintext. Anyone who can read your Windows profile can read the file; use OS
  account security and full-disk encryption.
- **File tools:** The agent's file tools resolve paths inside the open workspace and
  reject paths outside it. The main process also guards renderer file IPC to the
  workspace by default; the **Restrict file access to the workspace** setting can
  relax that renderer guard, while agent file tools still enforce containment.
- **Shell commands are not OS-sandboxed.** Approval gates and permission presets
  control *when* a command runs, not what it can do once allowed. Review commands
  before approving them, especially in untrusted repositories. See
  [README → Agent permissions and safety](README.md#agent-permissions-and-safety).
- **Fetched content is untrusted.** `web_fetch` output is internet text. The agent is
  instructed not to follow instructions embedded in fetched pages; the same caution
  applies to text in repositories, MCP results, and ACP messages.
- **Local servers execute with your privileges.** MCP, LSP, ACP, notebook kernels,
  and the debugger run local programs under your account. Only configure commands
  and servers you trust.

---

## Changes to this policy

This document describes HIM+ 0.1.0 (2026-11-23). If HIM+ changes what it sends or
stores, this file and [CHANGELOG.md](CHANGELOG.md) will be updated. HIM+ is an
early-preview project; review the source if you need to confirm a specific data
flow.
