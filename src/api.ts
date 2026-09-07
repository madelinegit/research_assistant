/**
 * ModelsLab chat client (brief §8).
 *
 * Built against the OpenAI-compatible "Uncensored Chat" endpoint:
 *   POST https://modelslab.com/api/uncensored-chat/v1/chat/completions
 *   Authorization: Bearer <key>
 *   body: { model, messages:[{role,content}], max_tokens, temperature }
 *   reply: choices[0].message.content
 *
 * We call it with plain fetch in the OpenAI request/response shape (brief §3:
 * "fetch ... no heavy SDK"; §8 explicitly permits "a fetch call in the same
 * shape"). The community endpoint (.../api/v6/llm/uncensored_chat) uses a
 * key-in-body + `message` reply shape instead; we auto-detect from the URL so
 * the endpoint field in Settings can point at either without code changes.
 *
 * The API key is read at request time and never logged.
 */
import type { Role } from './db';

export interface ChatMessage {
  role: Role | 'system';
  content: string;
}

export interface ChatParams {
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  messages: ChatMessage[];
}

// Discriminated error kinds so the UI can show the right message (brief §8).
export type ChatErrorKind =
  | 'no_key'
  | 'auth'
  | 'context_limit'
  | 'network'
  | 'server'
  | 'bad_response';

export class ChatError extends Error {
  kind: ChatErrorKind;
  status?: number;
  constructor(kind: ChatErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ChatError';
    this.kind = kind;
    this.status = status;
  }
}

/** Heuristic: is this the community key-in-body endpoint vs OpenAI-compatible? */
function isCommunityEndpoint(endpoint: string): boolean {
  return /\/llm\/(uncensored_chat|chat)\b/.test(endpoint);
}

/**
 * A root-relative endpoint (e.g. "/api/chat") means our own server is proxying:
 * it holds the API key and attaches the auth header itself, so the browser
 * neither needs nor receives one.
 */
export function isProxyEndpoint(endpoint: string): boolean {
  return endpoint.trim().startsWith('/');
}

/** Does an error body look like an auth / invalid-key rejection? */
function looksLikeAuthError(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /invalid\s*api\s*key|invalid[_\s-]*key|api[_\s-]*key.*(invalid|missing|required)/.test(
      t
    ) ||
    /unauthor|forbidden|authentication|not\s*authenticated/.test(t)
  );
}

/** Pull a human-readable message out of a ModelsLab/OpenAI-style error body. */
function extractErrorMessage(rawText: string): string | null {
  try {
    const d = JSON.parse(rawText);
    const msg = d?.error?.message ?? d?.message ?? d?.detail;
    return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
  } catch {
    // Not JSON; return a short snippet if it's plain text.
    const t = rawText.trim();
    return t && t.length < 300 ? t : null;
  }
}

/** Does an error body/text look like the model's context window was exceeded? */
function looksLikeContextLimit(status: number, text: string): boolean {
  const t = text.toLowerCase();
  return (
    /context.{0,20}(length|window|limit)/.test(t) ||
    /maximum.{0,20}context/.test(t) ||
    /too many tokens|max_tokens|reduce the length|context_length_exceeded/.test(
      t
    ) ||
    // Some gateways signal an oversized prompt with 413.
    status === 413
  );
}

export async function sendChat(params: ChatParams): Promise<string> {
  const { endpoint, apiKey, model, maxTokens, temperature, messages } = params;

  const proxied = isProxyEndpoint(endpoint);

  // In proxy mode the server supplies the key, so a missing local one is fine.
  if (!proxied && !apiKey.trim()) {
    throw new ChatError('no_key', 'No API key set.');
  }

  const community = isCommunityEndpoint(endpoint);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const body: Record<string, unknown> = {
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (model.trim()) body.model = model.trim();

  if (proxied) {
    // Our server attaches the credential; the session cookie authorises us.
    // Deliberately send nothing key-shaped here.
  } else if (community) {
    // Community endpoint: key travels in the body.
    body.key = apiKey;
  } else {
    // OpenAI-compatible: Bearer header.
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // Explicit rather than relying on the default: the proxy is gated by the
      // session cookie, so it must ride along.
      credentials: proxied ? 'same-origin' : 'omit',
    });
  } catch (e) {
    throw new ChatError(
      'network',
      'Network request failed. Check your connection and try again.'
    );
  }

  const rawText = await res.text();

  if (!res.ok) {
    // Auth failures: some ModelsLab endpoints use 401/403, but the
    // OpenAI-compatible one returns 400 with "Invalid API key" in the body.
    if (res.status === 401 || res.status === 403 || looksLikeAuthError(rawText)) {
      throw new ChatError(
        'auth',
        'API key was rejected — check it in Settings (watch for extra spaces, and make sure the key is enabled for the Uncensored Chat API).',
        res.status
      );
    }
    if (looksLikeContextLimit(res.status, rawText)) {
      throw new ChatError('context_limit', 'Context limit reached.', res.status);
    }
    // Surface the server's own message so errors are actionable, not opaque.
    const serverMsg = extractErrorMessage(rawText);
    throw new ChatError(
      'server',
      serverMsg
        ? `ModelsLab error (HTTP ${res.status}): ${serverMsg}`
        : `ModelsLab returned an error (HTTP ${res.status}).`,
      res.status
    );
  }

  // Parse the (successful) body.
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new ChatError('bad_response', 'Could not parse the API response.');
  }

  // Some ModelsLab endpoints report an error inside a 200 body.
  if (data?.status === 'error') {
    const msg: string = String(data?.message ?? '');
    if (looksLikeContextLimit(200, msg)) {
      throw new ChatError('context_limit', 'Context limit reached.');
    }
    if (/key|unauthor|invalid/i.test(msg)) {
      throw new ChatError('auth', 'API key was rejected. Check it in Settings.');
    }
    throw new ChatError('server', msg || 'ModelsLab reported an error.');
  }

  const reply = extractReply(data);
  if (reply == null) {
    throw new ChatError(
      'bad_response',
      'The API response did not contain a reply.'
    );
  }
  return reply.trim();
}

/**
 * Pull the assistant text out of either response shape:
 *  - OpenAI-compatible: choices[0].message.content
 *  - Community: { status, message } where message is the reply string
 *  - A few defensive fallbacks seen across ModelsLab variants.
 */
function extractReply(data: any): string | null {
  const choice = data?.choices?.[0];
  const fromChoices =
    choice?.message?.content ?? choice?.text ?? choice?.delta?.content;
  if (typeof fromChoices === 'string') return fromChoices;

  // Community endpoint: reply lives in `message` (a string, not an error here).
  if (typeof data?.message === 'string') return data.message;

  if (typeof data?.output === 'string') return data.output;
  if (Array.isArray(data?.output) && typeof data.output[0] === 'string')
    return data.output[0];

  return null;
}
