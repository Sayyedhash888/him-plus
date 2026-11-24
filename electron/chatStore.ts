import { app, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
import type {
  ChatConversationDetail,
  ChatConversationRecord,
  ChatSearchHit,
  ChatSessionSnapshot,
  StoredChatMessage,
} from '../shared/types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_root TEXT NOT NULL,
  backend TEXT NOT NULL DEFAULT 'him',
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  conversation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  reasoning TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_created
  ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON conversations(updated_at);
`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function normalizeSnippet(content: string, query: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const index = compact.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, (index === -1 ? 0 : index) - 90);
  const end = Math.min(compact.length, start + 260);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

function sanitizeMessage(value: unknown): StoredChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (typeof message.id !== 'string' || typeof message.role !== 'string') return null;
  return {
    id: message.id,
    role: message.role,
    content: typeof message.content === 'string' ? message.content : '',
    reasoning: typeof message.reasoning === 'string' ? message.reasoning : undefined,
    toolName: typeof message.toolName === 'string' ? message.toolName : undefined,
    toolCallId: typeof message.toolCallId === 'string' ? message.toolCallId : undefined,
    createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
  };
}

export class ChatStore {
  readonly filePath: string;
  private db: Database | null = null;
  private sql: SqlJsStatic | null = null;
  private initPromise: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const sql = await initSqlJs({
        locateFile: (file) => path.join(__dirname, file),
        useOldExtensionFunctions: false,
      });
      this.sql = sql;
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      let database: Database;
      try {
        if (fs.existsSync(this.filePath) && fs.statSync(this.filePath).size > 0) {
          database = new sql.Database(new Uint8Array(fs.readFileSync(this.filePath)));
        } else {
          database = new sql.Database();
        }
        database.run('PRAGMA foreign_keys = ON;');
        database.run(SCHEMA);
      } catch (error) {
        console.error('[chats] could not open chat database, starting a new one', error);
        try {
          if (fs.existsSync(this.filePath)) {
            fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
          }
        } catch {
          // ignore backup errors
        }
        database = new sql.Database();
        database.run('PRAGMA foreign_keys = ON;');
        database.run(SCHEMA);
      }
      this.db = database;
      this.dirty = true;
      this.flushNow();
    })();
    return this.initPromise;
  }

  private requireDb(): Database {
    if (!this.db) throw new Error('Chat database is not ready.');
    return this.db;
  }

  private all<T>(sql: string, params: unknown[] = []): T[] {
    const database = this.requireDb();
    const statement = database.prepare(sql);
    try {
      if (params.length > 0) statement.bind(params as never[]);
      const rows: T[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  saveSession(snapshot: ChatSessionSnapshot): void {
    const database = this.requireDb();
    if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id.trim()) {
      throw new Error('Invalid conversation snapshot: missing id.');
    }
    const now = Date.now();
    const createdAt =
      typeof snapshot.createdAt === 'number' ? snapshot.createdAt : now;
    const updatedAt =
      typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : now;
    const messages = Array.isArray(snapshot.messages)
      ? snapshot.messages.map(sanitizeMessage).filter((message): message is StoredChatMessage => Boolean(message))
      : [];

    database.run('BEGIN TRANSACTION;');
    try {
      database.run(
        `INSERT INTO conversations
          (id, title, workspace_root, backend, status, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           workspace_root = excluded.workspace_root,
           backend = excluded.backend,
           status = excluded.status,
           updated_at = excluded.updated_at,
           data = excluded.data;`,
        [
          snapshot.id,
          typeof snapshot.title === 'string' ? snapshot.title : 'Untitled conversation',
          typeof snapshot.workspaceRoot === 'string' ? snapshot.workspaceRoot : '',
          typeof snapshot.backend === 'string' ? snapshot.backend : 'him',
          typeof snapshot.status === 'string' ? snapshot.status : 'stopped',
          createdAt,
          updatedAt,
          typeof snapshot.data === 'string' ? snapshot.data : '{}',
        ],
      );
      database.run('DELETE FROM messages WHERE conversation_id = ?;', [snapshot.id]);
      const insert = database.prepare(
        `INSERT INTO messages
          (conversation_id, id, role, content, reasoning, tool_name, tool_call_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      );
      try {
        for (const message of messages) {
          insert.run([
            snapshot.id,
            message.id,
            message.role,
            message.content,
            message.reasoning ?? null,
            message.toolName ?? null,
            message.toolCallId ?? null,
            message.createdAt,
          ]);
        }
      } finally {
        insert.free();
      }
      database.run('COMMIT;');
    } catch (error) {
      try {
        database.run('ROLLBACK;');
      } catch {
        // ignore
      }
      throw error;
    }
    this.scheduleFlush();
  }

  deleteSession(id: string): void {
    const database = this.requireDb();
    database.run('DELETE FROM messages WHERE conversation_id = ?;', [id]);
    database.run('DELETE FROM conversations WHERE id = ?;', [id]);
    this.scheduleFlush();
  }

  listSessions(): ChatConversationRecord[] {
    return this.all<ChatConversationRecord>(
      `SELECT
         c.id,
         c.title,
         c.workspace_root AS workspaceRoot,
         c.backend,
         c.status,
         c.created_at AS createdAt,
         c.updated_at AS updatedAt,
         c.data,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount
       FROM conversations c
       ORDER BY c.updated_at DESC
       LIMIT 500;`,
    );
  }

  search(query: string, limit = 20): ChatSearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const max = Math.max(1, Math.min(limit, 50));
    const rows = this.all<{
      conversationId: string;
      title: string;
      messageId: string;
      role: string;
      content: string;
      createdAt: number;
    }>(
      `SELECT
         m.conversation_id AS conversationId,
         c.title AS title,
         m.id AS messageId,
         m.role AS role,
         m.content AS content,
         m.created_at AS createdAt
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE LOWER(m.content) LIKE LOWER(?) ESCAPE '\\'
       ORDER BY m.created_at DESC
       LIMIT ?;`,
      [`%${escapeLike(trimmed)}%`, max],
    );
    return rows.map((row) => ({
      conversationId: row.conversationId,
      title: row.title,
      messageId: row.messageId,
      role: row.role,
      snippet: normalizeSnippet(row.content, trimmed),
      createdAt: row.createdAt,
    }));
  }

  get(id: string): ChatConversationDetail | null {
    const rows = this.all<ChatConversationRecord>(
      `SELECT
         c.id,
         c.title,
         c.workspace_root AS workspaceRoot,
         c.backend,
         c.status,
         c.created_at AS createdAt,
         c.updated_at AS updatedAt,
         c.data,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount
       FROM conversations c
       WHERE c.id = ?
       LIMIT 1;`,
      [id],
    );
    const conversation = rows[0];
    if (!conversation) return null;
    const messages = this.all<StoredChatMessage>(
      `SELECT
         id,
         role,
         content,
         reasoning,
         tool_name AS toolName,
         tool_call_id AS toolCallId,
         created_at AS createdAt
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, id ASC;`,
      [id],
    );
    return { ...conversation, messages };
  }

  scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, 250);
    this.flushTimer.unref?.();
  }

  flushNow(): void {
    if (!this.db || !this.dirty) return;
    try {
      const bytes = Buffer.from(this.db.export());
      const temp = `${this.filePath}.tmp`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, this.filePath);
      this.dirty = false;
    } catch (error) {
      console.error('[chats] failed to persist chat database', error);
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushNow();
    this.db?.close();
    this.db = null;
    this.sql = null;
  }
}

export function registerChatIpc(store: ChatStore): void {
  ipcMain.handle('chats:saveSession', async (_event, snapshot: ChatSessionSnapshot) => {
    await store.init();
    store.saveSession(snapshot);
  });
  ipcMain.handle('chats:deleteSession', async (_event, id: string) => {
    await store.init();
    store.deleteSession(id);
  });
  ipcMain.handle('chats:listSessions', async () => {
    await store.init();
    return store.listSessions();
  });
  ipcMain.handle('chats:search', async (_event, query: string, limit?: number) => {
    await store.init();
    return store.search(query, limit);
  });
  ipcMain.handle('chats:get', async (_event, id: string) => {
    await store.init();
    return store.get(id);
  });
  ipcMain.handle('chats:path', async () => {
    await store.init();
    return store.filePath;
  });
  ipcMain.handle('chats:reveal', async () => {
    await store.init();
    shell.showItemInFolder(store.filePath);
  });

  app.on('before-quit', () => {
    store.flushNow();
  });
}