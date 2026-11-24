import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, type SystemPromptOptions } from '../src/lib/agent/prompts.ts';

function options(overrides: Partial<SystemPromptOptions> = {}): SystemPromptOptions {
  return {
    workspaceRoot: 'D:/projects/app',
    permission: 'review',
    branch: 'main',
    worktree: null,
    files: ['src/main.ts', 'src/util.ts', 'README.md'],
    openTabs: ['src/main.ts'],
    platform: 'win32',
    activeFile: 'src/main.ts',
    ...overrides,
  };
}

test('system prompt identifies the real application and active file', () => {
  const prompt = buildSystemPrompt(options());
  assert.match(prompt, /HIM\+/);
  assert.match(prompt, /not Zed, VS Code, Cursor, Windsurf/);
  assert.match(prompt, /Active file: src\/main\.ts/);
  assert.match(prompt, /Workspace root: D:\/projects\/app/);
  assert.match(prompt, /- src\/main\.ts/);
});

test('system prompt handles missing active file and empty tabs', () => {
  const prompt = buildSystemPrompt(
    options({ activeFile: null, openTabs: [], files: [] }),
  );
  assert.match(prompt, /Active file: \(none\)/);
  assert.match(prompt, /OPEN EDITOR TABS\n- none/);
  assert.match(prompt, /workspace index not loaded/);
});

test('permission modes are reflected in the prompt', () => {
  const plan = buildSystemPrompt(options({ permission: 'plan' }));
  assert.match(plan, /PERMISSION MODE: PLAN — READ ONLY/);
  assert.match(plan, /Do not claim they ran/);

  const auto = buildSystemPrompt(options({ permission: 'auto' }));
  assert.match(auto, /PERMISSION MODE: AUTO/);
  assert.match(auto, /Destructive commands/);

  const review = buildSystemPrompt(options({ permission: 'review' }));
  assert.match(review, /REVIEW-DRIVEN/);
});

test('system prompt states that shell commands are not OS-sandboxed', () => {
  const prompt = buildSystemPrompt(options());
  assert.match(prompt, /shell commands are not OS-sandboxed/i);
});
