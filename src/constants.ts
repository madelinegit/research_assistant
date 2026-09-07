/**
 * App-wide defaults. None of these are secrets — the API key lives only in
 * secure storage, entered by the owner at runtime (see src/secure.ts).
 */

// The default persona. Editable in Settings; this is only the out-of-the-box
// fallback used when the owner has never saved a custom system prompt, or after
// they tap "Reset to default".
export const DEFAULT_SYSTEM_PROMPT =
  "You are a sharp, candid thinking partner for a solo product builder. Be concise and specific. Challenge weak reasoning rather than flattering it. When you're unsure, say so. Keep continuity with everything said earlier in this conversation.";

// ModelsLab "Uncensored Chat", OpenAI-compatible endpoint (per brief §8,
// confirmed against https://docs.modelslab.com/uncensored-chat-api/chat-completions).
// Full chat-completions URL. This value is editable in Settings; the API client
// (src/api.ts) auto-detects the auth style from the URL, so pointing it at the
// community endpoint (.../api/v6/llm/uncensored_chat, key-in-body) also works.
export const DEFAULT_ENDPOINT =
  'https://modelslab.com/api/uncensored-chat/v1/chat/completions';

// Chosen model (brief §8). Required by the OpenAI-compatible endpoint.
export const DEFAULT_MODEL = 'ModelsLab/Llama-3.1-8b-Uncensored-Dare';

// Llama 3.1 8B native context is ~128K tokens (brief §8). The context meter
// treats this as the window size. Editable in Settings so the meter stays
// accurate if the owner confirms a different served limit or switches models.
export const DEFAULT_CONTEXT_WINDOW = 128000;

export const DEFAULT_MAX_TOKENS = 1000;
export const DEFAULT_TEMPERATURE = 0.7;

// Fraction of the context window at which we show the "getting full" banner.
export const CONTEXT_WARN_THRESHOLD = 0.85;

// Rough token estimate: ~4 characters per token. Good enough for a meter.
export const CHARS_PER_TOKEN = 4;

// --- Optional web lookup (globe toggle in Chat) ---------------------------
// Keyless out of the box (Wikipedia + DuckDuckGo). Paste a free search-API key
// in Settings to upgrade to full open-web search via this provider.
export const DEFAULT_SEARCH_PROVIDER = 'tavily'; // 'tavily' | 'brave'
// Max results folded into the injected context block.
export const SEARCH_MAX_RESULTS = 4;
// Give up on a search after this long so it can't stall the send.
export const SEARCH_TIMEOUT_MS = 12000;
