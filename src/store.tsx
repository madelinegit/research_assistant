/**
 * The single app-wide store (brief §3: "React hooks + a small context provider",
 * no state-management library). Holds settings + the conversation, and owns the
 * send/wipe logic so both screens share one source of truth.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_ENDPOINT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_SEARCH_PROVIDER,
  PROXY_ENDPOINT,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE,
} from './constants';
import {
  addMessage,
  clearMessages,
  getAllMessages,
  initDb,
  type Message,
} from './db';
import { deleteSecure, getSecure, KEYS, setSecure } from './secure';
import { ChatError, sendChat, type ChatMessage } from './api';
import { searchWeb } from './search';
import { estimatePayloadTokens } from './tokens';

export interface Settings {
  apiKey: string;
  systemPrompt: string; // empty => DEFAULT_SYSTEM_PROMPT is used at send time
  model: string;
  maxTokens: number;
  temperature: number;
  endpoint: string;
  contextWindow: number;
  // Optional web lookup. Empty searchApiKey => keyless (Wikipedia + DuckDuckGo).
  searchApiKey: string;
  searchProvider: string; // 'tavily' | 'brave' (only used when a key is set)
}

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  systemPrompt: '',
  model: DEFAULT_MODEL,
  maxTokens: DEFAULT_MAX_TOKENS,
  temperature: DEFAULT_TEMPERATURE,
  endpoint: DEFAULT_ENDPOINT,
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  searchApiKey: '',
  searchProvider: DEFAULT_SEARCH_PROVIDER,
};

interface StoreValue {
  ready: boolean;
  settings: Settings;
  messages: Message[];
  sending: boolean;
  /** True while an optional web lookup is running (before the model call). */
  searching: boolean;
  /** The effective system prompt used at send time (default if unset). */
  effectiveSystemPrompt: string;
  /** Estimated tokens of the NEXT payload including an optional draft. */
  estimatePayload: (draft?: string) => number;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  resetSystemPrompt: () => Promise<void>;
  /**
   * Send a user message; persists both turns. Throws ChatError on failure.
   * When `useWeb` is true, runs an optional web lookup first and injects the
   * results into the payload (best-effort — a failed search never blocks).
   */
  send: (text: string, useWeb?: boolean) => Promise<void>;
  wipe: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [searching, setSearching] = useState(false);

  // Keep the latest settings available to send() without stale closures.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Load persisted settings + conversation on launch (brief §6).
  useEffect(() => {
    (async () => {
      await initDb();
      const [
        apiKey,
        systemPrompt,
        model,
        maxTokens,
        temperature,
        endpoint,
        contextWindow,
        searchApiKey,
        searchProvider,
      ] = await Promise.all([
        getSecure(KEYS.apiKey),
        getSecure(KEYS.systemPrompt),
        getSecure(KEYS.model),
        getSecure(KEYS.maxTokens),
        getSecure(KEYS.temperature),
        getSecure(KEYS.endpoint),
        getSecure(KEYS.contextWindow),
        getSecure(KEYS.searchApiKey),
        getSecure(KEYS.searchProvider),
      ]);
      // Dev convenience ONLY: fall back to EXPO_PUBLIC_MODELSLAB_KEY from
      // .env.local (gitignored) when no key has been saved on-device yet, so the
      // local dev server doesn't need the key re-entered every time.
      //
      // This is deliberately gated on __DEV__. Metro inlines EXPO_PUBLIC_* values
      // into the JS bundle at build time, so leaving this active in a production
      // web build would publish the API key to every visitor — and ModelsLab
      // sends `access-control-allow-origin: *`, so a lifted key works from any
      // origin. In production the key comes from Settings only, where it lives in
      // this browser's storage and never enters the bundle. `npm run build` also
      // blanks the variable and then greps dist/ to prove no key shipped.
      const envKey = __DEV__
        ? (process.env.EXPO_PUBLIC_MODELSLAB_KEY || '').trim()
        : '';
      setSettings({
        apiKey: (apiKey ?? '') || envKey,
        systemPrompt: systemPrompt ?? '',
        model: model ?? DEFAULT_MODEL,
        maxTokens: maxTokens != null ? Number(maxTokens) : DEFAULT_MAX_TOKENS,
        temperature:
          temperature != null ? Number(temperature) : DEFAULT_TEMPERATURE,
        endpoint: endpoint ?? DEFAULT_ENDPOINT,
        contextWindow:
          contextWindow != null
            ? Number(contextWindow)
            : DEFAULT_CONTEXT_WINDOW,
        searchApiKey: searchApiKey ?? '',
        searchProvider: searchProvider ?? DEFAULT_SEARCH_PROVIDER,
      });
      setMessages(await getAllMessages());
      setReady(true);

      // If our own server holds the key (MODELSLAB_API_KEY on Railway), route
      // through it so the key never reaches this browser. Only when the owner
      // hasn't chosen an endpoint themselves — an explicit setting always wins.
      // On the Expo dev server there is no /api/config, so this quietly fails
      // and the app keeps calling ModelsLab directly.
      if (endpoint == null) {
        try {
          const r = await fetch('/api/config', { credentials: 'same-origin' });
          if (r.ok && (await r.json())?.proxy === true) {
            setSettings((prev) => ({ ...prev, endpoint: PROXY_ENDPOINT }));
          }
        } catch {
          // No proxy available; DEFAULT_ENDPOINT stays in effect.
        }
      }
    })();
  }, []);

  const effectiveSystemPrompt =
    settings.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    // Persist each changed field to secure storage, then update state.
    const writes: Promise<void>[] = [];
    if (patch.apiKey !== undefined)
      writes.push(setSecure(KEYS.apiKey, patch.apiKey));
    if (patch.systemPrompt !== undefined)
      writes.push(setSecure(KEYS.systemPrompt, patch.systemPrompt));
    if (patch.model !== undefined)
      writes.push(setSecure(KEYS.model, patch.model));
    if (patch.maxTokens !== undefined)
      writes.push(setSecure(KEYS.maxTokens, String(patch.maxTokens)));
    if (patch.temperature !== undefined)
      writes.push(setSecure(KEYS.temperature, String(patch.temperature)));
    if (patch.endpoint !== undefined)
      writes.push(setSecure(KEYS.endpoint, patch.endpoint));
    if (patch.contextWindow !== undefined)
      writes.push(setSecure(KEYS.contextWindow, String(patch.contextWindow)));
    if (patch.searchApiKey !== undefined)
      writes.push(setSecure(KEYS.searchApiKey, patch.searchApiKey));
    if (patch.searchProvider !== undefined)
      writes.push(setSecure(KEYS.searchProvider, patch.searchProvider));
    await Promise.all(writes);
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetSystemPrompt = useCallback(async () => {
    // Clear the stored prompt so the bundled default takes over again.
    await deleteSecure(KEYS.systemPrompt);
    setSettings((prev) => ({ ...prev, systemPrompt: '' }));
  }, []);

  // Build the full outgoing payload: system + every prior message + draft.
  // `webContext`, when present, is injected as a fresh system message right
  // before the new user turn (web lookup results for THIS message only — it is
  // not persisted to history, so it doesn't bloat future turns).
  const buildPayload = useCallback(
    (draft?: string, webContext?: string): ChatMessage[] => {
      const s = settingsRef.current;
      const sys = s.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;
      const history: ChatMessage[] = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const payload: ChatMessage[] = [
        { role: 'system', content: sys },
        ...history,
      ];
      if (webContext && webContext.trim()) {
        payload.push({ role: 'system', content: webContext });
      }
      if (draft != null && draft.length > 0) {
        payload.push({ role: 'user', content: draft });
      }
      return payload;
    },
    []
  );

  const estimatePayload = useCallback(
    (draft?: string) => estimatePayloadTokens(buildPayload(draft)),
    [buildPayload]
  );

  const send = useCallback(
    async (text: string, useWeb = false) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      setSending(true);
      try {
        // Optional web lookup FIRST (best-effort — searchWeb never throws, and
        // returns null on failure so the chat proceeds normally either way).
        let webContext: string | null = null;
        if (useWeb) {
          setSearching(true);
          try {
            const s = settingsRef.current;
            webContext = await searchWeb(trimmed, {
              apiKey: s.searchApiKey,
              provider: s.searchProvider,
            });
          } finally {
            setSearching(false);
          }
        }

        // Build the full-context payload BEFORE mutating state — system + all
        // prior history (+ web context) + this new user message as the final
        // turn. (Reading the ref after setMessages would miss the new turn
        // until the next render.)
        const payload = buildPayload(trimmed, webContext ?? undefined);

        // Persist + render the user turn immediately (brief §6: nothing lost).
        const userRow = await addMessage('user', trimmed);
        setMessages((prev) => [...prev, userRow]);

        const s = settingsRef.current;
        const reply = await sendChat({
          endpoint: s.endpoint,
          apiKey: s.apiKey,
          model: s.model,
          maxTokens: s.maxTokens,
          temperature: s.temperature,
          messages: payload,
        });
        const botRow = await addMessage('assistant', reply);
        setMessages((prev) => [...prev, botRow]);
      } catch (err) {
        // Any persisted user turn stays (we do NOT roll it back — the owner may
        // want to screenshot it). Re-throw so the screen can show the banner.
        throw err instanceof ChatError
          ? err
          : new ChatError('server', 'Something went wrong sending the message.');
      } finally {
        setSending(false);
      }
    },
    [buildPayload, sending]
  );

  const wipe = useCallback(async () => {
    await clearMessages();
    setMessages([]);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      settings,
      messages,
      sending,
      searching,
      effectiveSystemPrompt,
      estimatePayload,
      saveSettings,
      resetSystemPrompt,
      send,
      wipe,
    }),
    [
      ready,
      settings,
      messages,
      sending,
      searching,
      effectiveSystemPrompt,
      estimatePayload,
      saveSettings,
      resetSystemPrompt,
      send,
      wipe,
    ]
  );

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
