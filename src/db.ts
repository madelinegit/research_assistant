/**
 * The message store — the conversation's durable memory (brief §5, §6).
 *
 * This is the NATIVE implementation (iOS/Android — the ship target): expo-sqlite,
 * an on-device SQLite file. Metro automatically substitutes `db.web.ts` for the
 * browser dev preview, which keeps the same interface but avoids expo-sqlite's
 * WASM/OPFS web requirements. See db.web.ts for why.
 *
 * The full conversation is every row in `messages` ordered by id. On launch we
 * reload the whole table so the thread continues exactly where it left off, and
 * every message is persisted immediately so nothing is lost on crash/restart.
 *
 * The interface (append / getAll / clear over a flat, id-ordered table) is
 * deliberately storage-shaped, not window-shaped: a future upgrade to a hybrid
 * memory model (brief §6b) layers on top without a rewrite.
 */
import * as SQLite from 'expo-sqlite';

export type Role = 'user' | 'assistant';

export interface Message {
  id: number;
  role: Role;
  content: string;
  created_at: number; // epoch ms
}

const DB_NAME = 'mlab-chat.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

/** Ensure the store is ready. Safe to call repeatedly. */
export async function initDb(): Promise<void> {
  await getDb();
}

/** Append one message and return the persisted row (with its assigned id). */
export async function addMessage(role: Role, content: string): Promise<Message> {
  const created_at = Date.now();
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)',
    role,
    content,
    created_at
  );
  return { id: result.lastInsertRowId, role, content, created_at };
}

/** The full conversation, oldest first (brief §6: no window, no truncation). */
export async function getAllMessages(): Promise<Message[]> {
  const db = await getDb();
  return db.getAllAsync<Message>('SELECT * FROM messages ORDER BY id ASC');
}

/** Wipe the conversation. Does NOT touch settings/API key (brief §6). */
export async function clearMessages(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM messages');
}
