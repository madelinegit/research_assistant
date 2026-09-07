/**
 * Optional per-message web lookup (feature added after the MVP: "make it able
 * to look things up online"). Runs BEFORE the ModelsLab call when the globe
 * toggle is on, and returns a formatted context block to inject into the
 * payload — or `null` if nothing useful turned up or the lookup failed.
 *
 * Best-effort by design: searchWeb NEVER throws. If search is slow, offline, or
 * empty, it resolves to null and the chat proceeds exactly as before. Search
 * must never block the owner from getting an answer.
 *
 * Two modes, chosen at runtime from Settings:
 *  - Keyed (a search API key is set): full open-web search via Tavily (default)
 *    or Brave — reaches news, prices, arbitrary sites.
 *  - Keyless (no key): Wikipedia search + REST summaries, plus DuckDuckGo
 *    Instant Answer as a bonus. Encyclopedic only, but zero signup.
 *
 * Every endpoint used here returns permissive CORS headers, so this works in the
 * browser dev preview (localhost) and on native alike. The search key, like the
 * ModelsLab key, is read at call time and never logged.
 */
import { SEARCH_MAX_RESULTS, SEARCH_TIMEOUT_MS } from './constants';

export interface SearchOptions {
  /** Optional search-provider API key. Empty/omitted => keyless mode. */
  apiKey?: string;
  /** 'tavily' | 'brave' — only used in keyed mode. */
  provider?: string;
  /** Max results to fold into the context block. */
  maxResults?: number;
  /** Abort signal; if omitted, an internal timeout is applied. */
  signal?: AbortSignal;
}

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Look the query up on the web and return an LLM-ready context block, or null.
 * Never throws.
 */
export async function searchWeb(
  query: string,
  opts: SearchOptions = {}
): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;

  const max = opts.maxResults ?? SEARCH_MAX_RESULTS;
  const key = opts.apiKey?.trim();

  try {
    let hits: SearchHit[] = [];
    let source: string;

    if (key) {
      const provider = (opts.provider || 'tavily').toLowerCase();
      if (provider === 'brave') {
        hits = await braveSearch(q, key, max, opts.signal);
        source = 'Brave Search';
      } else {
        hits = await tavilySearch(q, key, max, opts.signal);
        source = 'Tavily';
      }
    } else {
      // Keyless: Wikipedia (primary) + DuckDuckGo Instant Answer (bonus),
      // gathered together so a thin Wikipedia result is still useful.
      const [wiki, ddg] = await Promise.all([
        wikipediaSearch(q, max, opts.signal).catch(() => [] as SearchHit[]),
        duckDuckGoInstant(q, opts.signal).catch(() => [] as SearchHit[]),
      ]);
      hits = [...ddg, ...wiki];
      source = 'Wikipedia + DuckDuckGo';
    }

    return formatContext(q, source, hits.slice(0, max));
  } catch {
    // Best-effort: any failure => no context, chat proceeds normally.
    return null;
  }
}

/** Format hits into a compact context block, or null if there are none. */
function formatContext(
  query: string,
  source: string,
  hits: SearchHit[]
): string | null {
  const clean = hits.filter((h) => h.snippet.trim().length > 0);
  if (clean.length === 0) return null;

  const lines = clean.map((h, i) => {
    const head = h.url ? `${h.title} — ${h.url}` : h.title;
    return `[${i + 1}] ${head}\n${h.snippet.trim()}`;
  });

  return (
    `Web search results for "${query}" (via ${source}), fetched just now. ` +
    `Use them to answer accurately and cite the source URLs when relevant. ` +
    `If they don't cover the question, say so rather than guessing.\n\n` +
    lines.join('\n\n')
  );
}

// ---------------------------------------------------------------------------
// Keyed providers (full open-web)
// ---------------------------------------------------------------------------

async function tavilySearch(
  query: string,
  apiKey: string,
  max: number,
  signal?: AbortSignal
): Promise<SearchHit[]> {
  const data = await fetchJson(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      // api_key in the body too: Tavily has accepted both across versions.
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: max,
        search_depth: 'basic',
        include_answer: true,
      }),
    },
    signal
  );

  const hits: SearchHit[] = [];
  if (typeof data?.answer === 'string' && data.answer.trim()) {
    hits.push({ title: 'Answer', url: '', snippet: data.answer });
  }
  for (const r of Array.isArray(data?.results) ? data.results : []) {
    hits.push({
      title: String(r?.title ?? 'Result'),
      url: String(r?.url ?? ''),
      snippet: String(r?.content ?? ''),
    });
  }
  return hits;
}

async function braveSearch(
  query: string,
  apiKey: string,
  max: number,
  signal?: AbortSignal
): Promise<SearchHit[]> {
  const url =
    'https://api.search.brave.com/res/v1/web/search?q=' +
    encodeURIComponent(query) +
    `&count=${max}`;
  const data = await fetchJson(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    },
    signal
  );

  const results = Array.isArray(data?.web?.results) ? data.web.results : [];
  return results.map((r: any) => ({
    title: String(r?.title ?? 'Result'),
    url: String(r?.url ?? ''),
    snippet: String(r?.description ?? ''),
  }));
}

// ---------------------------------------------------------------------------
// Keyless sources (encyclopedic)
// ---------------------------------------------------------------------------

async function wikipediaSearch(
  query: string,
  max: number,
  signal?: AbortSignal
): Promise<SearchHit[]> {
  // 1) Find the most relevant page titles.
  const searchUrl =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json' +
    '&origin=*&srlimit=' +
    max +
    '&srsearch=' +
    encodeURIComponent(query);
  const searchData = await fetchJson(searchUrl, { method: 'GET' }, signal);
  const results = Array.isArray(searchData?.query?.search)
    ? searchData.query.search
    : [];
  const titles: string[] = results
    .map((r: any) => String(r?.title ?? ''))
    .filter(Boolean)
    .slice(0, max);
  if (titles.length === 0) return [];

  // 2) Pull a clean extract for each (in parallel; skip any that fail).
  const summaries = await Promise.all(
    titles.map((t) => wikipediaSummary(t, signal).catch(() => null))
  );

  const hits: SearchHit[] = [];
  summaries.forEach((sum, i) => {
    if (sum && sum.snippet.trim()) {
      hits.push(sum);
    } else {
      // Fall back to the search snippet (HTML) if the summary was empty.
      const snip = stripHtml(String(results[i]?.snippet ?? ''));
      if (snip.trim()) {
        hits.push({
          title: titles[i],
          url: wikiPageUrl(titles[i]),
          snippet: snip,
        });
      }
    }
  });
  return hits;
}

async function wikipediaSummary(
  title: string,
  signal?: AbortSignal
): Promise<SearchHit | null> {
  const url =
    'https://en.wikipedia.org/api/rest_v1/page/summary/' +
    encodeURIComponent(title.replace(/ /g, '_'));
  const data = await fetchJson(url, { method: 'GET' }, signal);
  const extract = typeof data?.extract === 'string' ? data.extract : '';
  if (!extract.trim()) return null;
  const pageUrl =
    data?.content_urls?.desktop?.page ?? wikiPageUrl(title);
  return { title: String(data?.title ?? title), url: pageUrl, snippet: extract };
}

function wikiPageUrl(title: string): string {
  return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
}

async function duckDuckGoInstant(
  query: string,
  signal?: AbortSignal
): Promise<SearchHit[]> {
  const url =
    'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' +
    encodeURIComponent(query);
  const data = await fetchJson(url, { method: 'GET' }, signal);

  const text: string =
    (typeof data?.AbstractText === 'string' && data.AbstractText) ||
    (typeof data?.Answer === 'string' && data.Answer) ||
    (typeof data?.Definition === 'string' && data.Definition) ||
    '';
  if (!text.trim()) return [];

  return [
    {
      title: String(data?.Heading || 'DuckDuckGo'),
      url: String(data?.AbstractURL || data?.DefinitionURL || ''),
      snippet: text,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** fetch + JSON parse with a timeout (no AbortController exists elsewhere yet). */
async function fetchJson(
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<any> {
  // If the caller didn't pass a signal, apply our own timeout so a hung search
  // can't stall the send indefinitely.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let usedSignal = signal;
  if (!usedSignal && typeof AbortController !== 'undefined') {
    const ctrl = new AbortController();
    usedSignal = ctrl.signal;
    timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  }
  try {
    const res = await fetch(url, { ...init, signal: usedSignal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Strip HTML tags + collapse whitespace (Wikipedia search snippets are HTML). */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
