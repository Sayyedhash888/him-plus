import type {
  AcpConnectRequest,
  AcpConnectResult,
  AcpPromptRequest,
  AcpPromptResult,
  AcpSetModelRequest,
  AcpStreamEvent,
} from './acp';

export type Mode = 'agent' | 'ide';

export interface ModelCapabilities {
  /** The model accepts image content parts (OpenAI "image_url" style). */
  vision?: boolean;
  /** The model supports native function/tool calling. */
  tools?: boolean;
  /** Approximate context window in tokens, used for auto-compaction. */
  contextWindow?: number;
}

export interface ModelEntry {
  id: string;
  enabled: boolean;
  source: 'fetched' | 'manual';
  capabilities?: ModelCapabilities;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  models: ModelEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface ProviderDefaults {
  primary: ModelRef | null;
  fast: ModelRef | null;
  planning: ModelRef | null;
}

/**
 * A resolved provider model: the reference, its provider, the entry itself and a
 * display label.
 *
 * Lives here rather than in the renderer's config store because the agent host
 * interface is typed in terms of it, and a daemon must be able to name the type
 * without importing the renderer. `src/store/config.ts` re-exports it so existing
 * imports keep working.
 */
export interface ModelOption {
  ref: ModelRef;
  provider: ProviderConfig;
  model: ModelEntry;
  label: string;
}

export interface CliAgentProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  preset?: string;
}

export interface CliAgentStartRequest {
  sessionId: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface CliAgentStartResult {
  ok: boolean;
  error?: string;
}

export interface CliAgentDataEvent {
  sessionId: string;
  data: string;
}

export interface CliAgentExitEvent {
  sessionId: string;
  exitCode: number | null;
}

export interface JupyterLabPalette {
  background: string;
  surface: string;
  cellBackground: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  function: string;
  variable: string;
  type: string;
}

export interface JupyterLabConfig {
  detected: boolean;
  themeName: string | null;
  dark: boolean;
  codeFontFamily: string | null;
  codeFontSize: number | null;
  lineNumbers: boolean;
  lineWrap: boolean;
  autoClosingBrackets: boolean;
  palette: JupyterLabPalette;
  extensions: string[];
  configRoot: string | null;
}

export interface CheckpointInfo {
  id: string;
  sessionId: string;
  label: string;
  createdAt: number;
  ref: string;
  fileCount: number;
}

export interface CheckpointDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  before: string | null;
  after: string | null;
}

export interface AcpRegistryEntry {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  installHint: string;
  authHint?: string;
  capabilities: { images?: boolean; files?: boolean; terminal?: boolean };
  platform?: 'all' | 'win32' | 'darwin' | 'linux';
}

export interface AcpHealthResult {
  ok: boolean;
  command: string;
  version?: string;
  error?: string;
}

export interface AppPrefs {
  mode: Mode;
  minimap: boolean;
  theme: string;
  keyboardSound: boolean;
  /** Keep renderer file access inside the open workspace (default: true). */
  restrictFileAccess: boolean;
  /** Skin notebooks with the detected JupyterLab theme (default: true). */
  matchJupyterNotebook: boolean;
  /** Auto-open the DataFrame wrangler after notebook executions (default: true). */
  notebookAutoWrangle: boolean;
}

export interface FimConfig {
  enabled: boolean;
  mode: 'fim' | 'chat';
  model: ModelRef | null;
}

export interface CopilotConfig {
  enabled: boolean;
}

export interface CopilotStatus {
  running: boolean;
  serverAvailable: boolean;
  signedIn: boolean;
  kind: string;
  message: string;
  busy?: boolean;
  user?: string;
  completionsPercentRemaining?: number;
}

export interface CopilotSignInResult {
  ok: boolean;
  userCode?: string;
  verificationUri?: string;
  error?: string;
  signedIn?: boolean;
  user?: string;
  message?: string;
}

export interface CopilotCompletionInput {
  path: string;
  text: string;
  languageId: string;
  version: number;
  line: number;
  character: number;
  triggerKind?: number;
}

export interface CopilotCompletionResult {
  text: string;
  range?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  command?: { command: string; arguments?: unknown[] };
}

export interface UpdateInfo {
  version: string;
  feedConfigured: boolean;
  packaged: boolean;
}
export interface UpdateCheckResult {
  configured: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  url?: string;
  sha256?: string;
  notes?: string;
  error?: string;
}

export interface AcpAgentProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  preset?: string;
}

export interface AppConfig {
  version: 1;
  providers: ProviderConfig[];
  defaults: ProviderDefaults;
  prefs: AppPrefs;
  fim: FimConfig;
  copilot: CopilotConfig;
  acpAgents: AcpAgentProfile[];
  cliAgents: CliAgentProfile[];
  lastWorkspace: string | null;
}

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

export interface ReadFileResult {
  path: string;
  content: string;
  size: number;
  binary: boolean;
}

export interface SearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
  filesScanned: number;
  elapsedMs: number;
}

export interface GitFileStatus {
  path: string;
  index: string;
  worktree: string;
  letter: string;
}

export interface GitStatus {
  isRepo: boolean;
  root: string;
  branch: string | null;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

export interface WorktreeResult {
  path: string;
  branch: string;
}

export interface GitDiffOptions {
  staged?: boolean;
  path?: string;
}

export interface GitDiffResult {
  diff: string;
  truncated: boolean;
}

export interface GitCommitInput {
  message: string;
  stageAll?: boolean;
  paths?: string[];
}

export interface GitCommitResult {
  committed: boolean;
  summary: string;
}

export interface FetchModelsInput {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
}

export interface FetchModelsResult {
  models: string[];
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  estimated?: boolean;
}

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmTextPart {
  type: 'text';
  text: string;
}

export interface LlmImagePart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export type LlmContentPart = LlmTextPart | LlmImagePart;

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | LlmContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: LlmToolCall[];
  name?: string;
}

/** A user-supplied attachment that can be replayed into a model request. */
export interface ChatAttachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mime: string;
  size: number;
  /** Absolute path of the persisted copy inside userData/attachments. */
  path?: string;
  width?: number;
  height?: number;
}

export interface SaveAttachmentResult {
  path: string;
  name: string;
  mime: string;
  size: number;
}

export interface WebFetchResult {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  title: string;
  text: string;
  truncated: boolean;
}

export interface WatchChangedEvent {
  root: string;
  paths: string[];
}

export interface LspDiagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: 1 | 2 | 3 | 4;
  source?: string;
  code?: string;
}

export interface LspDiagnosticsEvent {
  root: string;
  path: string;
  diagnostics: LspDiagnostic[];
}

export interface LspDocumentInput {
  path: string;
  languageId: string;
  text: string;
  version: number;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  path: string;
  range: LspRange;
}

export interface LspHover {
  contents: string;
  range?: LspRange;
}

export interface LspServerStatus {
  languageIds: string[];
  command: string;
  connected: boolean;
  error?: string;
}

export interface LspStatus {
  root: string;
  servers: LspServerStatus[];
  configPath: string;
}

export interface McpToolInfo {
  server: string;
  name: string;
  qualifiedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  command: string;
  connected: boolean;
  error?: string;
  tools: McpToolInfo[];
}

export interface McpStatus {
  servers: McpServerStatus[];
  userConfigPath: string;
  projectConfigPath: string;
}

export interface McpCallInput {
  root: string;
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

export interface LlmToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmStartRequest {
  requestId: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

export interface LlmStreamEvent {
  requestId: string;
  type: 'delta' | 'done' | 'error';
  content?: string;
  reasoning?: string;
  toolCalls?: LlmToolCallDelta[];
  finishReason?: string | null;
  usage?: LlmUsage;
  message?: string;
  aborted?: boolean;
}

export interface ExecRequest {
  runId: string;
  command: string;
  cwd: string;
  timeoutMs?: number;
}

export interface ExecChunk {
  runId: string;
  chunk: string;
  stream: 'stdout' | 'stderr';
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  cwd: string;
  timedOut?: boolean;
  killed?: boolean;
}

export interface TerminalCreateResult {
  id: string;
  cwd: string;
  shell: string;
}

export interface TerminalRunRequest {
  id: string;
  command: string;
}

export interface TerminalRunResult {
  code: number | null;
  cwd: string;
  output: string;
}

export interface TerminalDataEvent {
  id: string;
  chunk: string;
  stream: 'stdout' | 'stderr' | 'system';
}

export interface PtyCreateResult {
  id: string;
  cwd: string;
  shell: string;
}

export interface PtyDataEvent {
  id: string;
  chunk: string;
}

export interface NotebookOutput {
  type: 'stream' | 'result' | 'display' | 'error';
  name?: string;
  text?: string;
  data?: Record<string, string | string[] | undefined>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  executionCount?: number | null;
}

export interface NotebookCell {
  id: string;
  cellType: 'code' | 'markdown' | 'raw';
  source: string;
  outputs: NotebookOutput[];
  executionCount?: number | null;
}

export interface NotebookDataFrameColumn {
  name: string;
  dtype: string;
  nulls: number;
  unique: number;
  min?: string | number | null;
  max?: string | number | null;
  mean?: string | number | null;
  top?: Array<{ value: string; count: number }>;
}

export interface NotebookDataFrame {
  columns: NotebookDataFrameColumn[];
  rows: Array<Array<string | number | boolean | null>>;
  shape: [number, number];
  index: string[];
}

export interface NotebookData {
  path: string;
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformatMinor: number;
  kernelName?: string;
  /** Non-fatal load information (empty file, nbformat conversion, …). */
  warning?: string;
}

export interface NotebookExecution {
  ok: boolean;
  error?: string;
  kernel: 'jupyter' | 'exec' | 'unknown';
  executionCount: number | null;
  outputs: NotebookOutput[];
  dataframes: Record<string, NotebookDataFrame>;
}

/** Incremental kernel output emitted while a cell is still running. */
export interface NotebookStreamEvent {
  path: string;
  token?: string;
  output: NotebookOutput;
}

export interface DebugBreakpoint {
  path: string;
  lines: number[];
}

export interface DebugStartRequest {
  workspace: string;
  file: string;
  breakpoints: DebugBreakpoint[];
  justMyCode?: boolean;
}

export interface DebugStartResult {
  ok: boolean;
  error?: string;
}

export interface DebugRequestInput {
  command: string;
  args?: Record<string, unknown>;
}

export interface DebugSessionStatus {
  running: boolean;
  adapter: 'debugpy' | null;
  port?: number;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export interface StoredChatMessage {
  id: string;
  role: string;
  content: string;
  reasoning?: string;
  toolName?: string;
  toolCallId?: string;
  createdAt: number;
}

export interface ChatSessionSnapshot {
  id: string;
  title: string;
  workspaceRoot: string;
  backend: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  data: string;
  messages: StoredChatMessage[];
}

export interface ChatConversationRecord {
  id: string;
  title: string;
  workspaceRoot: string;
  backend: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  data: string;
}

export interface ChatSearchHit {
  conversationId: string;
  title: string;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: number;
}

export interface ChatConversationDetail extends ChatConversationRecord {
  messages: StoredChatMessage[];
}

export interface FimCompletionRequest {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  model: string;
  mode: 'fim' | 'chat';
  prefix: string;
  suffix: string;
}

export interface FimCompletionResult {
  text: string;
}

export interface HimApi {
  platform: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  config: {
    get(): Promise<AppConfig>;
    save(config: AppConfig): Promise<void>;
    path(): Promise<string>;
    reveal(): Promise<void>;
  };
  dialog: {
    openFolder(): Promise<string | null>;
    confirm(options: ConfirmOptions): Promise<boolean>;
  };
  fs: {
    readDir(path: string): Promise<FileNode[]>;
    readFile(path: string): Promise<ReadFileResult>;
    /** Read a raster image as a data URL for the built-in image viewer. */
    readImage(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    create(path: string, kind: 'file' | 'directory'): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    trash(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    listFiles(root: string, limit?: number): Promise<string[]>;
    /** Configure optional workspace-contained file access for the renderer. */
    setWorkspaceAccess(root: string | null, restrict: boolean): Promise<void>;
  };
  search: {
    run(root: string, options: SearchOptions): Promise<SearchResult>;
  };
  attachments: {
    /** Persist a pasted/dropped image and return its on-disk location. */
    save(dataUrl: string, name?: string): Promise<SaveAttachmentResult>;
    /** Read a persisted attachment back as a data URL for a model request. */
    read(path: string): Promise<string>;
    /** Copy image files from local paths (e.g. copied in Explorer) into the store. */
    importPaths(paths: string[]): Promise<SaveAttachmentResult[]>;
  };
  web: {
    /** Fetch a public http(s) page and return readable text for the agent. */
    fetch(url: string): Promise<WebFetchResult>;
  };
  watch: {
    start(root: string): Promise<void>;
    stop(): Promise<void>;
    onChange(callback: (event: WatchChangedEvent) => void): () => void;
  };
  mcp: {
    status(root: string): Promise<McpStatus>;
    reload(root: string): Promise<McpStatus>;
    call(input: McpCallInput): Promise<McpCallResult>;
  };
  lsp: {
    setRoot(root: string): Promise<LspStatus>;
    status(): Promise<LspStatus>;
    openDocument(input: LspDocumentInput): Promise<void>;
    changeDocument(input: LspDocumentInput): Promise<void>;
    closeDocument(path: string): Promise<void>;
    hover(path: string, line: number, character: number): Promise<LspHover | null>;
    definition(path: string, line: number, character: number): Promise<LspLocation[]>;
    onDiagnostics(callback: (event: LspDiagnosticsEvent) => void): () => void;
  };
  chats: {
    saveSession(snapshot: ChatSessionSnapshot): Promise<void>;
    deleteSession(id: string): Promise<void>;
    listSessions(): Promise<ChatConversationRecord[]>;
    search(query: string, limit?: number): Promise<ChatSearchHit[]>;
    get(id: string): Promise<ChatConversationDetail | null>;
    path(): Promise<string>;
    reveal(): Promise<void>;
  };
  fim: {
    complete(input: FimCompletionRequest): Promise<FimCompletionResult>;
  };
  copilot: {
    status(): Promise<CopilotStatus>;
    setRoot(root: string): Promise<CopilotStatus>;
    signIn(root: string): Promise<CopilotSignInResult>;
    signOut(): Promise<void>;
    verifyAuth(): Promise<{ signedIn: boolean; message: string }>;
    complete(input: CopilotCompletionInput): Promise<CopilotCompletionResult | null>;
    accept(command: { command: string; arguments?: unknown[] } | undefined): Promise<void>;
    onStatus(callback: (status: CopilotStatus) => void): () => void;
  };
  acp: {
    prompt(request: AcpPromptRequest): Promise<AcpPromptResult>;
    connect(request: AcpConnectRequest): Promise<AcpConnectResult>;
    setModel(request: AcpSetModelRequest): Promise<AcpConnectResult>;
    cancel(sessionId: string): Promise<void>;
    dispose(sessionId: string): Promise<void>;
    registry(): Promise<AcpRegistryEntry[]>;
    health(command: string, args: string[]): Promise<AcpHealthResult>;
    onEvent(callback: (event: AcpStreamEvent) => void): () => void;
  };
  checkpoint: {
    create(sessionId: string, root: string, label?: string): Promise<CheckpointInfo>;
    list(sessionId: string, root: string): Promise<CheckpointInfo[]>;
    diff(sessionId: string, root: string, id: string): Promise<CheckpointDiffFile[]>;
    revert(
      sessionId: string,
      root: string,
      id: string,
    ): Promise<{ restored: number; deleted: number }>;
  };
  git: {
    status(root: string): Promise<GitStatus>;
    worktree(root: string, label: string): Promise<WorktreeResult>;
    diff(root: string, options?: GitDiffOptions): Promise<GitDiffResult>;
    log(root: string, count?: number): Promise<string>;
    commit(root: string, input: GitCommitInput): Promise<GitCommitResult>;
    stage(root: string, paths: string[]): Promise<void>;
    unstage(root: string, paths: string[]): Promise<void>;
    discard(root: string, relPath: string, untracked?: boolean): Promise<void>;
    showFile(root: string, relPath: string, ref?: string): Promise<string>;
  };
  llm: {
    fetchModels(input: FetchModelsInput): Promise<FetchModelsResult>;
    start(request: LlmStartRequest): Promise<{ ok: boolean; error?: string }>;
    abort(requestId: string): Promise<void>;
    onEvent(callback: (event: LlmStreamEvent) => void): () => void;
  };
  exec: {
    run(request: ExecRequest): Promise<ExecResult>;
    kill(runId: string): Promise<void>;
    onChunk(callback: (event: ExecChunk) => void): () => void;
  };
  terminal: {
    create(cwd: string): Promise<TerminalCreateResult>;
    run(request: TerminalRunRequest): Promise<TerminalRunResult>;
    input(id: string, data: string): void;
    kill(id: string): Promise<void>;
    dispose(id: string): Promise<void>;
    onData(callback: (event: TerminalDataEvent) => void): () => void;
  };
  pty: {
    create(cwd: string, cols?: number, rows?: number): Promise<PtyCreateResult>;
    input(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    kill(id: string): Promise<void>;
    dispose(id: string): Promise<void>;
    onData(callback: (event: PtyDataEvent) => void): () => void;
  };
  nb: {
    open(path: string): Promise<NotebookData>;
    save(data: NotebookData): Promise<void>;
    execute(path: string, code: string, token?: string): Promise<NotebookExecution>;
    restart(path: string): Promise<{ kernel: 'jupyter' | 'exec' | 'unknown' }>;
    interrupt(path: string): Promise<void>;
    status(path: string): Promise<{ running: boolean; kernel: 'jupyter' | 'exec' | 'unknown' }>;
    onStream(callback: (event: NotebookStreamEvent) => void): () => void;
    dispose(path: string): Promise<void>;
  };
  debug: {
    start(request: DebugStartRequest): Promise<DebugStartResult>;
    stop(): Promise<void>;
    request(input: DebugRequestInput): Promise<unknown>;
    status(): Promise<DebugSessionStatus>;
    onEvent(callback: (event: { event: string; body: unknown }) => void): () => void;
    onLog(callback: (line: string) => void): () => void;
  };
  update: {
    info(): Promise<UpdateInfo>;
    check(): Promise<UpdateCheckResult>;
  };
  cliAgent: {
    start(request: CliAgentStartRequest): Promise<CliAgentStartResult>;
    input(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    stop(sessionId: string): Promise<void>;
    onData(callback: (event: CliAgentDataEvent) => void): () => void;
    onExit(callback: (event: CliAgentExitEvent) => void): () => void;
  };
  jupyter: {
    detect(): Promise<JupyterLabConfig>;
  };
  window: {
    minimize(): void;
    maximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(callback: (maximized: boolean) => void): () => void;
  };
  app: {
    openExternal(url: string): Promise<void>;
    showItemInFolder(path: string): void;
    initialWorkspace(): Promise<string | null>;
  };
}

