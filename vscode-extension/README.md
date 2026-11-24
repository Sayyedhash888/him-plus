# HIM+ for HIM+ Code

HIM+ puts its chat panel in the **secondary side bar** (the right-hand panel, where
GitHub Copilot Chat lives) and adds inline completions from your own HIM+ models.

## What it does

- **HIM+ chat, on the right.** The panel is contributed through
  `contributes.viewsContainers.secondarySidebar`, so it opens in the right-hand
  side bar. `HIM+ Code: Open HIM+ Chat` reveals it at any time, and the `HIM+`
  status-bar item does the same.
- **Workspace-aware answers.** The chat model can call read-only tools
  (`read_file`, `list_files`, `active_file`) to inspect the open workspace before
  it answers. It never edits files.
- **Your own providers.** Chat and completions use the provider, API key and base
  URL already configured in the HIM+ desktop app (`config.json`). Use the model
  picker in the panel header to pick any enabled model.
- **Inline completions.** `him.autocomplete.enabled` turns the FIM provider on or
  off; it is exposed in the status bar as `HIM+ FIM`.
- **Seven colour themes.** HIM+ Black, Dark Grey, Light, Marimo, Midnight,
  Terminal and Sandstone.
- **Desktop bridge.** `HIM+ Code: Open HIM+ Desktop` launches the HIM+ desktop
  workbench on the current folder.

## Requirements

- HIM+ Code / VS Code **1.106 or newer** (the secondary-side-bar contribution
  point was added in 1.106).
- A HIM+ desktop install that has written `config.json` at least once, so at least
  one provider model is enabled. If the panel reports that no model is configured,
  launch the HIM+ desktop app once or point `him.configPath` at your config file.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `him.chat.openOnStartup` | `true` | Let HIM+ reveal the chat panel when a window starts. Set to `false` to keep the right side bar hidden until you ask for it. |
| `him.autocomplete.enabled` | `true` | Enable HIM+ inline completions. Turn off when using another vendor's completions. |
| `him.configPath` | `""` | Path to HIM+ `config.json`. Empty uses the HIM+ app-data directory. |
| `him.desktopPath` | `""` | Path to the HIM+ desktop executable. Empty auto-detects the installed app. |

## Commands

All commands live under the **HIM+** category in the Command Palette:

- `Open HIM+ Chat` â€” reveal the chat panel in the right side bar
- `Focus HIM+ Chat` â€” same, when you only need to move focus
- `New Chat` â€” clear the transcript
- `Toggle HIM+ Autocomplete` â€” flip inline completions
- `Open HIM+ Configuration` â€” open the shared HIM+ `config.json`
- `Open HIM+ Desktop` â€” launch the desktop workbench on this folder

## Moving the panel

VS Code lets you drag any view between the side bars. If you prefer HIM+ on the
left, drag the HIM+ view into the primary side bar; the workspace remembers it.

## Multi-agent sessions (new in 0.5)

- **Session switcher** — the strip above the transcript keeps multiple independent
  agent sessions in one panel. `+` starts a new session, `×` removes the active
  one, and the dropdown switches between them. Each session keeps its own
  transcript and is restored from workspace state.
- **Background subagents** — the agent can call `spawn_subagent` to delegate an
  independent read-only task (scan, research, review). The helper runs in the
  background while you keep chatting; up to three can run at once and their
  reports are posted back into the session that spawned them.
  `list_subagents` shows their status. Subagents cannot spawn further subagents.
- **Handoff** — `Handoff` copies the current transcript into a new review agent
  and starts it with review instructions, so a second agent can check the first
  one's conclusions. The extension remains read-only.

The agent is still read-only: it can inspect files, delegate subagents and
explain changes, but it never edits your workspace. Use the HIM+ desktop app for
gated edits, diffs and checkpoints.
