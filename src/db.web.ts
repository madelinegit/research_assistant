/**
 * Web fallback for the message store (see db.ts for the native version).
 *
 * expo-sqlite's web build requires bundling wa-sqlite.wasm + OPFS with COOP/COEP
 * headers, which breaks the zero-config `npx expo start` → browser preview. Metro
 * resolves this `.web.ts` file automatically on web, so the dev preview runs on a
 * simple localStorage-backed table with the SAME interface as native SQLite
 * (acceptance criteria §9.1, §9.4). The shipped iOS/Android app uses real SQLite.
 *
 * This file must stay interface-compatible with db.ts.
 */
import { StorageFullError, isQuotaError } from './storageError';

export type Role = 'user' | 'assistant';

export interface Message {
  id: number;
  role: Role;
  content: string;
  created_at: number; // epoch ms
}

const WEB_KEY = 'mlab_messages_web';

function readAll(): Message[] {
  try {
    const raw = window.localStorage.getItem(WEB_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: Message[]): void {
  try {
    window.localStorage.setItem(WEB_KEY, JSON.stringify(rows));
  } catch (e) {
    // A full quota must NOT be swallowed. This app's whole promise is that
    // nothing is silently dropped (README: "never a silent trim") — and with
    // full-context replay a long thread really can reach localStorage's ~5MB
    // origin cap. Surface it so the Chat screen can tell the owner to export
    // and wipe, instead of quietly losing the turn they just sent.
    if (isQuotaError(e)) throw new StorageFullError();
    throw e;
  }
}

export async function initDb(): Promise<void> {
  // Ask the browser to exempt this origin from routine eviction. Matters most
  // for the deployed web app: iOS Safari clears script-writable storage for
  // sites you haven't visited in ~7 days, which would take the conversation and
  // the saved API key with it. Granted automatically for an installed
  // ("Add to Home Screen") PWA; a no-op where unsupported.
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Non-fatal — persistence is an optimization, not a requirement.
  }
}

export async function addMessage(role: Role, content: string): Promise<Message> {
  const rows = readAll();
  const id = rows.length ? rows[rows.length - 1].id + 1 : 1;
  const row: Message = { id, role, content, created_at: Date.now() };
  rows.push(row);
  writeAll(rows);
  return row;
}

export async function getAllMessages(): Promise<Message[]> {
  return readAll().sort((a, b) => a.id - b.id);
}

export async function clearMessages(): Promise<void> {
  writeAll([]);
}
