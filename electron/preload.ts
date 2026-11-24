import { contextBridge, ipcRenderer } from 'electron';
import type {
  AcpConnectRequest,
  AcpConnectResult,
  AcpPromptRequest,
  AcpPromptResult,
  AcpSetModelRequest,
  AcpStreamEvent,
} from '../shared/acp';
import type {
  AppConfig,
  ConfirmOptions,
  ExecChunk,
  ExecRequest,
  ExecResult,
  FetchModelsInput,
  FetchModelsResult,
  FileNode,
  HimApi,
  LlmStartRequest,
  LlmStreamEvent,
  ReadFileResult,
  SaveAttachmentResult,
  WebFetchResult,
  WatchChangedEvent,
  McpStatus,
  McpCallInput,
  McpCallResult,
  LspDocumentInput,
  LspDiagnosticsEvent,
  LspHover,
  LspLocation,
  LspStatus,
  PtyCreateResult,
  PtyDataEvent,
  NotebookData,
  NotebookExecution,
  NotebookStreamEvent,
  DebugRequestInput,
  DebugSessionStatus,
  DebugStartRequest,
  DebugStartResult,
  CopilotCompletionInput,
  CopilotCompletionResult,
  CopilotSignInResult,
  CopilotStatus,
  CliAgentDataEvent,
  CliAgentExitEvent,
  CliAgentStartRequest,
  CliAgentStartResult,
  CheckpointDiffFile,
  CheckpointInfo,
  AcpHealthResult,
  AcpRegistryEntry,
  JupyterLabConfig,
  UpdateCheckResult,
  UpdateInfo,
  SearchOptions,
  SearchResult,
  ChatSessionSnapshot,
  ChatConversationRecord,
  ChatSearchHit,
  ChatConversationDetail,
  FimCompletionRequest,
  FimCompletionResult,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalRunRequest,
  TerminalRunResult,
  GitStatus,
  GitDiffOptions,
  GitDiffResult,
  GitCommitInput,
  GitCommitResult,
  WorktreeResult,
} from '../shared/types';

const api: HimApi = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron || '',
    chrome: process.versions.chrome || '',
    node: process.versions.node || '',
  },
  config: {
    get: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
    save: (config) => ipcRenderer.invoke('config:save', config) as Promise<void>,
    path: () => ipcRenderer.invoke('config:path') as Promise<string>,
    reveal: () => ipcRenderer.invoke('config:reveal') as Promise<void>,
  },
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder') as Promise<string | null>,
    confirm: (options: ConfirmOptions) =>
      ipcRenderer.invoke('dialog:confirm', options) as Promise<boolean>,
  },
  fs: {
    readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath) as Promise<FileNode[]>,
    readFile: (filePath) =>
      ipcRenderer.invoke('fs:readFile', filePath) as Promise<ReadFileResult>,
    readImage: (filePath) =>
      ipcRenderer.invoke('fs:readImage', filePath) as Promise<string>,
    writeFile: (filePath, content) =>
      ipcRenderer.invoke('fs:writeFile', filePath, content) as Promise<void>,
    create: (target, kind) => ipcRenderer.invoke('fs:create', target, kind) as Promise<void>,
    rename: (oldPath, newPath) =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath) as Promise<void>,
    trash: (target) => ipcRenderer.invoke('fs:trash', target) as Promise<void>,
    exists: (target) => ipcRenderer.invoke('fs:exists', target) as Promise<boolean>,
    listFiles: (root, limit) =>
      ipcRenderer.invoke('fs:listFiles', root, limit) as Promise<string[]>,
    setWorkspaceAccess: (root: string | null, restrict: boolean) =>
      ipcRenderer.invoke('fs:setWorkspaceAccess', root, restrict) as Promise<void>,
  },
  search: {
    run: (root, options: SearchOptions) =>
      ipcRenderer.invoke('search:run', root, options) as Promise<SearchResult>,
  },
  attachments: {
    save: (dataUrl: string, name?: string) =>
      ipcRenderer.invoke('attachments:save', dataUrl, name) as Promise<SaveAttachmentResult>,
    read: (filePath: string) =>
      ipcRenderer.invoke('attachments:read', filePath) as Promise<string>,
    importPaths: (paths: string[]) =>
      ipcRenderer.invoke('attachments:import', paths) as Promise<SaveAttachmentResult[]>,
  },
  web: {
    fetch: (url: string) => ipcRenderer.invoke('web:fetch', url) as Promise<WebFetchResult>,
  },
  watch: {
    start: (root: string) => ipcRenderer.invoke('watch:start', root) as Promise<void>,
    stop: () => ipcRenderer.invoke('watch:stop') as Promise<void>,
    onChange: (callback: (event: WatchChangedEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: WatchChangedEvent) =>
        callback(payload);
      ipcRenderer.on('watch:changed', listener);
      return () => ipcRenderer.removeListener('watch:changed', listener);
    },
  },
  mcp: {
    status: (root: string) => ipcRenderer.invoke('mcp:status', root) as Promise<McpStatus>,
    reload: (root: string) => ipcRenderer.invoke('mcp:reload', root) as Promise<McpStatus>,
    call: (input: McpCallInput) =>
      ipcRenderer.invoke('mcp:call', input) as Promise<McpCallResult>,
  },
  lsp: {
    setRoot: (root: string) => ipcRenderer.invoke('lsp:setRoot', root) as Promise<LspStatus>,
    status: () => ipcRenderer.invoke('lsp:status') as Promise<LspStatus>,
    openDocument: (input: LspDocumentInput) =>
      ipcRenderer.invoke('lsp:openDocument', input) as Promise<void>,
    changeDocument: (input: LspDocumentInput) =>
      ipcRenderer.invoke('lsp:changeDocument', input) as Promise<void>,
    closeDocument: (path: string) =>
      ipcRenderer.invoke('lsp:closeDocument', path) as Promise<void>,
    hover: (path: string, line: number, character: number) =>
      ipcRenderer.invoke('lsp:hover', path, line, character) as Promise<LspHover | null>,
    definition: (path: string, line: number, character: number) =>
      ipcRenderer.invoke('lsp:definition', path, line, character) as Promise<LspLocation[]>,
    onDiagnostics: (callback: (event: LspDiagnosticsEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: LspDiagnosticsEvent) =>
        callback(payload);
      ipcRenderer.on('lsp:diagnostics', listener);
      return () => ipcRenderer.removeListener('lsp:diagnostics', listener);
    },
  },
  chats: {
    saveSession: (snapshot: ChatSessionSnapshot) =>
      ipcRenderer.invoke('chats:saveSession', snapshot) as Promise<void>,
    deleteSession: (id) => ipcRenderer.invoke('chats:deleteSession', id) as Promise<void>,
    listSessions: () =>
      ipcRenderer.invoke('chats:listSessions') as Promise<ChatConversationRecord[]>,
    search: (query, limit) =>
      ipcRenderer.invoke('chats:search', query, limit) as Promise<ChatSearchHit[]>,
    get: (id) => ipcRenderer.invoke('chats:get', id) as Promise<ChatConversationDetail | null>,
    path: () => ipcRenderer.invoke('chats:path') as Promise<string>,
    reveal: () => ipcRenderer.invoke('chats:reveal') as Promise<void>,
  },
  fim: {
    complete: (input: FimCompletionRequest) =>
      ipcRenderer.invoke('fim:complete', input) as Promise<FimCompletionResult>,
  },
  acp: {
    prompt: (request: AcpPromptRequest) =>
      ipcRenderer.invoke('acp:prompt', request) as Promise<AcpPromptResult>,
    connect: (request: AcpConnectRequest) =>
      ipcRenderer.invoke('acp:connect', request) as Promise<AcpConnectResult>,
    setModel: (request: AcpSetModelRequest) =>
      ipcRenderer.invoke('acp:setModel', request) as Promise<AcpConnectResult>,
    cancel: (sessionId) =>
      ipcRenderer.invoke('acp:cancel', sessionId) as Promise<void>,
    dispose: (sessionId) =>
      ipcRenderer.invoke('acp:dispose', sessionId) as Promise<void>,
    registry: () => ipcRenderer.invoke('acp:registry') as Promise<AcpRegistryEntry[]>,
    health: (command: string, args: string[]) =>
      ipcRenderer.invoke('acp:health', command, args) as Promise<AcpHealthResult>,
    onEvent: (callback: (event: AcpStreamEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AcpStreamEvent) =>
        callback(payload);
      ipcRenderer.on('acp:event', listener);
      return () => ipcRenderer.removeListener('acp:event', listener);
    },
  },
  checkpoint: {
    create: (sessionId: string, root: string, label?: string) =>
      ipcRenderer.invoke('checkpoint:create', sessionId, root, label) as Promise<CheckpointInfo>,
    list: (sessionId: string, root: string) =>
      ipcRenderer.invoke('checkpoint:list', sessionId, root) as Promise<CheckpointInfo[]>,
    diff: (sessionId: string, root: string, id: string) =>
      ipcRenderer.invoke('checkpoint:diff', sessionId, root, id) as Promise<CheckpointDiffFile[]>,
    revert: (sessionId: string, root: string, id: string) =>
      ipcRenderer.invoke('checkpoint:revert', sessionId, root, id) as Promise<{
        restored: number;
        deleted: number;
      }>,
  },
  git: {
    status: (root) => ipcRenderer.invoke('git:status', root) as Promise<GitStatus>,
    worktree: (root, label) =>
      ipcRenderer.invoke('git:worktree', root, label) as Promise<WorktreeResult>,
    diff: (root, options) =>
      ipcRenderer.invoke('git:diff', root, options) as Promise<GitDiffResult>,
    log: (root, count) => ipcRenderer.invoke('git:log', root, count) as Promise<string>,
    commit: (root, input) =>
      ipcRenderer.invoke('git:commit', root, input) as Promise<GitCommitResult>,
    stage: (root: string, paths: string[]) =>
      ipcRenderer.invoke('git:stage', root, paths) as Promise<void>,
    unstage: (root: string, paths: string[]) =>
      ipcRenderer.invoke('git:unstage', root, paths) as Promise<void>,
    discard: (root: string, relPath: string, untracked?: boolean) =>
      ipcRenderer.invoke('git:discard', root, relPath, untracked) as Promise<void>,
    showFile: (root: string, relPath: string, ref?: string) =>
      ipcRenderer.invoke('git:showFile', root, relPath, ref) as Promise<string>,
  },
  debug: {
    start: (request: DebugStartRequest) =>
      ipcRenderer.invoke('debug:start', request) as Promise<DebugStartResult>,
    stop: () => ipcRenderer.invoke('debug:stop') as Promise<void>,
    request: (input: DebugRequestInput) =>
      ipcRenderer.invoke('debug:request', input) as Promise<unknown>,
    status: () => ipcRenderer.invoke('debug:status') as Promise<DebugSessionStatus>,
    onEvent: (callback: (event: { event: string; body: unknown }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { event: string; body: unknown },
      ) => callback(payload);
      ipcRenderer.on('debug:event', listener);
      return () => ipcRenderer.removeListener('debug:event', listener);
    },
    onLog: (callback: (line: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { line: string }) =>
        callback(payload.line);
      ipcRenderer.on('debug:log', listener);
      return () => ipcRenderer.removeListener('debug:log', listener);
    },
  },
  copilot: {
    status: () => ipcRenderer.invoke('copilot:status') as Promise<CopilotStatus>,
    setRoot: (root: string) =>
      ipcRenderer.invoke('copilot:setRoot', root) as Promise<CopilotStatus>,
    signIn: (root: string) =>
      ipcRenderer.invoke('copilot:signIn', root) as Promise<CopilotSignInResult>,
    signOut: () => ipcRenderer.invoke('copilot:signOut') as Promise<void>,
    verifyAuth: () =>
      ipcRenderer.invoke('copilot:verifyAuth') as Promise<{ signedIn: boolean; message: string }>,
    complete: (input: CopilotCompletionInput) =>
      ipcRenderer.invoke('copilot:complete', input) as Promise<CopilotCompletionResult | null>,
    accept: (command: { command: string; arguments?: unknown[] } | undefined) =>
      ipcRenderer.invoke('copilot:accept', command) as Promise<void>,
    onStatus: (callback: (status: CopilotStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: CopilotStatus) =>
        callback(payload);
      ipcRenderer.on('copilot:status', listener);
      return () => ipcRenderer.removeListener('copilot:status', listener);
    },
  },
  cliAgent: {
    start: (request: CliAgentStartRequest) =>
      ipcRenderer.invoke('cliagent:start', request) as Promise<CliAgentStartResult>,
    input: (sessionId: string, data: string) =>
      ipcRenderer.invoke('cliagent:input', sessionId, data) as Promise<void>,
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('cliagent:resize', sessionId, cols, rows) as Promise<void>,
    stop: (sessionId: string) => ipcRenderer.invoke('cliagent:stop', sessionId) as Promise<void>,
    onData: (callback: (event: CliAgentDataEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: CliAgentDataEvent) =>
        callback(payload);
      ipcRenderer.on('cliagent:data', listener);
      return () => ipcRenderer.removeListener('cliagent:data', listener);
    },
    onExit: (callback: (event: CliAgentExitEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: CliAgentExitEvent) =>
        callback(payload);
      ipcRenderer.on('cliagent:exit', listener);
      return () => ipcRenderer.removeListener('cliagent:exit', listener);
    },
  },
  jupyter: {
    detect: () => ipcRenderer.invoke('jupyter:detect') as Promise<JupyterLabConfig>,
  },
  update: {
    info: () => ipcRenderer.invoke('update:info') as Promise<UpdateInfo>,
    check: () => ipcRenderer.invoke('update:check') as Promise<UpdateCheckResult>,
  },
  llm: {
    fetchModels: (input: FetchModelsInput) =>
      ipcRenderer.invoke('llm:fetchModels', input) as Promise<FetchModelsResult>,
    start: (request: LlmStartRequest) =>
      ipcRenderer.invoke('llm:start', request) as Promise<{ ok: boolean; error?: string }>,
    abort: (requestId) => ipcRenderer.invoke('llm:abort', requestId) as Promise<void>,
    onEvent: (callback: (event: LlmStreamEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: LlmStreamEvent) =>
        callback(payload);
      ipcRenderer.on('llm:event', listener);
      return () => ipcRenderer.removeListener('llm:event', listener);
    },
  },
  exec: {
    run: (request: ExecRequest) => ipcRenderer.invoke('exec:run', request) as Promise<ExecResult>,
    kill: (runId: string) => ipcRenderer.invoke('exec:kill', runId) as Promise<void>,
    onChunk: (callback: (event: ExecChunk) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ExecChunk) => callback(payload);
      ipcRenderer.on('exec:chunk', listener);
      return () => ipcRenderer.removeListener('exec:chunk', listener);
    },
  },
  terminal: {
    create: (cwd) =>
      ipcRenderer.invoke('terminal:create', cwd) as Promise<TerminalCreateResult>,
    run: (request: TerminalRunRequest) =>
      ipcRenderer.invoke('terminal:run', request) as Promise<TerminalRunResult>,
    input: (id, data) => ipcRenderer.send('terminal:input', id, data),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id) as Promise<void>,
    dispose: (id) => ipcRenderer.invoke('terminal:dispose', id) as Promise<void>,
    onData: (callback: (event: TerminalDataEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) =>
        callback(payload);
      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.removeListener('terminal:data', listener);
    },
  },
  pty: {
    create: (cwd: string, cols?: number, rows?: number) =>
      ipcRenderer.invoke('pty:create', cwd, cols, rows) as Promise<PtyCreateResult>,
    input: (id: string, data: string) =>
      ipcRenderer.invoke('pty:input', id, data) as Promise<void>,
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('pty:resize', id, cols, rows) as Promise<void>,
    kill: (id: string) => ipcRenderer.invoke('pty:kill', id) as Promise<void>,
    dispose: (id: string) => ipcRenderer.invoke('pty:dispose', id) as Promise<void>,
    onData: (callback: (event: PtyDataEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: PtyDataEvent) =>
        callback(payload);
      ipcRenderer.on('pty:data', listener);
      return () => ipcRenderer.removeListener('pty:data', listener);
    },
  },
  nb: {
    open: (path: string) => ipcRenderer.invoke('nb:open', path) as Promise<NotebookData>,    save: (data: NotebookData) => ipcRenderer.invoke('nb:save', data) as Promise<void>,
    execute: (path: string, code: string, token?: string) =>
      ipcRenderer.invoke('nb:execute', path, code, token) as Promise<NotebookExecution>,
    restart: (path: string) =>
      ipcRenderer.invoke('nb:restart', path) as Promise<{
        kernel: 'jupyter' | 'exec' | 'unknown';
      }>,
    interrupt: (path: string) => ipcRenderer.invoke('nb:interrupt', path) as Promise<void>,
    onStream: (callback: (event: NotebookStreamEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: NotebookStreamEvent) =>
        callback(payload);
      ipcRenderer.on('nb:stream', listener);
      return () => ipcRenderer.removeListener('nb:stream', listener);
    },
    status: (path: string) =>
      ipcRenderer.invoke('nb:status', path) as Promise<{
        running: boolean;
        kernel: 'jupyter' | 'exec' | 'unknown';
      }>,
    dispose: (path: string) => ipcRenderer.invoke('nb:dispose', path) as Promise<void>,
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
      ipcRenderer.on('window:maximized', listener);
      return () => ipcRenderer.removeListener('window:maximized', listener);
    },
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url) as Promise<void>,
    showItemInFolder: (itemPath) => ipcRenderer.send('app:showItemInFolder', itemPath),
    initialWorkspace: () =>
      ipcRenderer.invoke('app:initialWorkspace') as Promise<string | null>,
  },
};

contextBridge.exposeInMainWorld('him', api);
