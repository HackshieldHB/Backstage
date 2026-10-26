import { Injectable, Logger } from '@nestjs/common';
import type { AskSourceDto } from '@backstages/shared';

/**
 * Live information for the Stagehand assistant: web search, news and weather.
 *
 * - Search: a self-hosted SearXNG (WEB_SEARCH_URL, e.g. http://searxng:8080),
 *   the open-source metasearch engine. Without it we fall back to Google News
 *   RSS (news) and Wikipedia (general facts); both are free and keyless.
 * - Weather: Open-Meteo (free, no key).
 *
 * Only the user's question is sent out, and only when it looks like it needs
 * the outside world (see `webIntent`), never workspace content. AI_WEB_SEARCH=off
 * turns all of it off.
 */

export type WebIntent = 'weather' | 'news' | 'general';

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  published?: string | null;
  site?: string | null;
}

export interface WebFindings {
  /** Lines for the model's context, without the [n] prefix. */
  lines: string[];
  sources: AskSourceDto[];
}

const TIMEOUT_MS = 8000;
const MAX_RESULTS = 5;
const CACHE_MS = 5 * 60_000;
const UA = 'Backstages-Stagehand/1.0 (+https://mybackstage.web.id)';

const WEATHER =
  /\b(weather|forecast|temperature|rain(ing)?|cuaca|suhu|hujan|prakiraan|ramalan cuaca)\b/i;
const NEWS =
  /\b(news|headlines?|latest|breaking|berita|kabar|terkini|terbaru|viral|trending|update terbaru)\b/i;
const REALTIME =
  /\b(today|tonight|now|right now|currently|current|this (week|month|year)|yesterday|tomorrow|live|score|price|prices|stock|exchange rate|kurs|harga|saham|skor|hari ini|sekarang|saat ini|kemarin|besok|minggu ini|bulan ini|tahun ini|202\d)\b/i;
/** Questions about the user's own workspace stay inside it. */
const INTERNAL =
  /(@\w|#[\w-]+|\b(our|we|team|teammates?|channels?|dms?|threads?|tasks?|decisions?|decided|meetings?|huddles?|workspace|backstages?|kita|kami|tim|tugas|keputusan|diputuskan|rapat)\b)/i;
const QUESTION =
  /\?|^\s*(who|what|when|where|which|why|how|is|are|does|do|did|can|siapa|apa|apakah|kapan|dimana|di mana|mana|berapa|bagaimana|gimana|kenapa|mengapa)\b/i;

/**
 * Should this question go to the web, and how? Weather, news and anything
 * time-sensitive always do; otherwise a general question does only when the
 * workspace had nothing on it and it isn't about the team.
 */
export function webIntent(question: string, workspaceHits: boolean): WebIntent | null {
  const q = question.trim();
  if (q.length < 3) return null;
  if (WEATHER.test(q)) return 'weather';
  if (INTERNAL.test(q)) return null;
  if (NEWS.test(q)) return 'news';
  if (REALTIME.test(q)) return 'general';
  if (!workspaceHits && QUESTION.test(q)) return 'general';
  return null;
}

const ID_WORDS =
  /\b(apa|apakah|yang|dan|berapa|bagaimana|gimana|siapa|kapan|dimana|hari ini|sekarang|terbaru|berita|cuaca|tolong|dong|nggak|gak|tidak|ini|itu)\b/i;

const FILLER =
  /\b(what|whats|what's|who|when|where|which|why|how|is|are|was|were|do|does|did|can|could|please|tell|me|about|the|a|an|of|on|for|any|some|latest|recent|newest|news|headlines?|breaking|today|todays|today's|now|right|currently|current|this|week|update|updates|apa|apakah|aja|saja|siapa|kapan|dimana|mana|berapa|bagaimana|gimana|kenapa|mengapa|tolong|dong|kasih|tau|tahu|info|informasi|berita|kabar|terkini|terbaru|baru|hari|ini|sekarang|saat|minggu|yang|ada|tentang|soal|di|ke|dari|untuk|ya|nih|sih|deh|kah)\b/gi;

/**
 * The search terms in a question: drops question words and filler ("berita
 * terbaru hari ini apa?" → "teknologi" for a tech question), so the engine
 * matches the topic rather than the phrasing. Falls back to a generic
 * headline query when nothing is left.
 */
export function searchTerms(question: string, intent: WebIntent, lang: 'id' | 'en'): string {
  const terms = question
    .replace(/[?!.,;:"“”'’()]/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (terms.length >= 2) return terms.slice(0, 200);
  if (intent === 'news') return lang === 'id' ? 'berita utama Indonesia' : 'top news';
  return question.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** "id" when the question reads as Indonesian, else "en". */
export function questionLang(question: string): 'id' | 'en' {
  return ID_WORDS.test(question) ? 'id' : 'en';
}

/** The place in a weather question ("weather in Jakarta", "cuaca di Bandung besok"), if any. */
export function weatherPlace(question: string): string | null {
  const after = /\b(?:in|at|for|di|daerah|kota)\s+([\p{L}][\p{L}\s.'-]{1,40})/iu.exec(question);
  const raw = after
    ? after[1]
    : question.replace(WEATHER, ' ').replace(REALTIME, ' ').replace(QUESTION, ' ');
  const place = raw
    .replace(/[?!.,]/g, ' ')
    .replace(
      /\b(the|what|whats|is|like|now|today|tomorrow|right|current|currently|gimana|bagaimana|berapa|sekarang|hari|ini|besok|lagi|dong|ya|kah|saat|seperti|apa|yang)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return place.length >= 2 ? place.slice(0, 60) : null;
}

/** WMO weather codes (Open-Meteo) → short text. */
export function weatherText(code: number, lang: 'id' | 'en'): string {
  const table: Array<[number[], string, string]> = [
    [[0], 'clear sky', 'cerah'],
    [[1, 2], 'partly cloudy', 'cerah berawan'],
    [[3], 'overcast', 'berawan'],
    [[45, 48], 'fog', 'berkabut'],
    [[51, 53, 55, 56, 57], 'drizzle', 'gerimis'],
    [[61, 63, 65, 66, 67, 80, 81, 82], 'rain', 'hujan'],
    [[71, 73, 75, 77, 85, 86], 'snow', 'salju'],
    [[95, 96, 99], 'thunderstorm', 'hujan petir'],
  ];
  const hit = table.find(([codes]) => codes.includes(code));
  return hit ? (lang === 'id' ? hit[2] : hit[1]) : lang === 'id' ? 'tidak diketahui' : 'unknown';
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Parse a SearXNG JSON response. */
export function parseSearxng(body: unknown): WebResult[] {
  const results = (body as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => r as Record<string, unknown>)
    .filter(
      (r) => typeof r.url === 'string' && /^https?:\/\//.test(r.url) && typeof r.title === 'string',
    )
    .map((r) => ({
      title: decode(String(r.title)),
      url: String(r.url),
      snippet: decode(String(r.content ?? '')).slice(0, 400),
      published: typeof r.publishedDate === 'string' ? r.publishedDate : null,
      site: hostOf(String(r.url)),
    }));
}

/** Parse a Google News RSS feed. */
export function parseNewsRss(xml: string): WebResult[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .map((item) => {
      const tag = (name: string) => {
        const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(item);
        return m ? decode(m[1]) : '';
      };
      const source = tag('source');
      const title = tag('title');
      return {
        title:
          source && title.endsWith(` - ${source}`) ? title.slice(0, -(source.length + 3)) : title,
        url: tag('link'),
        snippet: '',
        published: tag('pubDate') || null,
        site: source || null,
      };
    })
    .filter((r) => r.title && /^https?:\/\//.test(r.url));
}

/** Parse a Wikipedia search API response. */
export function parseWikipedia(body: unknown, lang: 'id' | 'en'): WebResult[] {
  const hits = (body as { query?: { search?: Array<{ title?: string; snippet?: string }> } } | null)
    ?.query?.search;
  if (!Array.isArray(hits)) return [];
  return hits
    .filter((h) => typeof h.title === 'string')
    .map((h) => ({
      title: h.title!,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title!.replace(/ /g, '_'))}`,
      snippet: decode(h.snippet ?? ''),
      site: `${lang}.wikipedia.org`,
    }));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Turn results into numbered-context lines and their sources. */
export function toFindings(results: WebResult[]): WebFindings {
  const top = results.slice(0, MAX_RESULTS);
  return {
    lines: top.map((r) => {
      const when = r.published ? ` (${r.published.slice(0, 25)})` : '';
      const site = r.site ? ` — ${r.site}` : '';
      return `WEB${site}${when}: ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`;
    }),
    sources: top.map((r) => ({
      kind: 'web' as const,
      label: r.site ? `${r.title} · ${r.site}` : r.title,
      ref: r.url,
      url: r.url,
      channelId: null,
    })),
  };
}

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private readonly cache = new Map<string, { at: number; value: WebFindings }>();

  constructor() {
    if (this.enabled) {
      this.logger.log(
        `Assistant web access on (${this.searxngUrl ? 'SearXNG' : 'Google News + Wikipedia'}, Open-Meteo weather)`,
      );
    }
  }

  get enabled(): boolean {
    return (process.env.AI_WEB_SEARCH ?? 'on').toLowerCase() !== 'off';
  }

  private get searxngUrl(): string | null {
    const url = process.env.WEB_SEARCH_URL?.trim();
    return url ? url.replace(/\/+$/, '') : null;
  }

  /** Live findings for a question, or null when it doesn't need (or can't get) any. */
  async lookup(question: string, workspaceHits: boolean): Promise<WebFindings | null> {
    if (!this.enabled) return null;
    const intent = webIntent(question, workspaceHits);
    if (!intent) return null;
    const lang = questionLang(question);
    const q = searchTerms(question, intent, lang);
    const key = `${intent}|${lang}|${q.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

    let value: WebFindings | null = null;
    try {
      if (intent === 'weather') value = await this.weather(question, lang);
      if (!value)
        value = toFindings(await this.search(q, intent === 'news' ? 'news' : 'general', lang));
    } catch (err) {
      this.logger.warn(`Web lookup failed: ${(err as Error).message}`);
      return null;
    }
    if (!value || value.lines.length === 0) return null;
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  private async search(
    q: string,
    kind: 'news' | 'general',
    lang: 'id' | 'en',
  ): Promise<WebResult[]> {
    const base = this.searxngUrl;
    if (base) {
      const params = new URLSearchParams({
        q,
        format: 'json',
        language: lang === 'id' ? 'id-ID' : 'en',
        safesearch: '1',
        ...(kind === 'news' ? { categories: 'news', time_range: 'week' } : {}),
      });
      try {
        const results = parseSearxng(await this.getJson(`${base}/search?${params}`));
        if (results.length > 0) return results;
      } catch (err) {
        this.logger.warn(`SearXNG failed, using the fallback: ${(err as Error).message}`);
      }
    }
    if (kind === 'news') {
      const region = lang === 'id' ? 'hl=id&gl=ID&ceid=ID:id' : 'hl=en-US&gl=US&ceid=US:en';
      return parseNewsRss(
        await this.getText(
          `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${region}`,
        ),
      );
    }
    // General fallback: Google News for time-sensitive things plus Wikipedia for facts.
    const [news, wiki] = await Promise.all([
      this.getText(
        `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${lang === 'id' ? 'hl=id&gl=ID&ceid=ID:id' : 'hl=en-US&gl=US&ceid=US:en'}`,
      )
        .then(parseNewsRss)
        .catch(() => [] as WebResult[]),
      this.getJson(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(q)}`,
      )
        .then((b) => parseWikipedia(b, lang))
        .catch(() => [] as WebResult[]),
    ]);
    return [...wiki.slice(0, 2), ...news.slice(0, 3)];
  }

  private async weather(question: string, lang: 'id' | 'en'): Promise<WebFindings | null> {
    const place = weatherPlace(question);
    if (!place) return null;
    const geo = (await this.getJson(
      `https://geocoding-api.open-meteo.com/v1/search?count=1&language=${lang}&name=${encodeURIComponent(place)}`,
    )) as {
      results?: Array<{
        name: string;
        country?: string;
        admin1?: string;
        latitude: number;
        longitude: number;
      }>;
    };
    const hit = geo.results?.[0];
    if (!hit) return null;
    const f = (await this.getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}` +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=3&timezone=auto',
    )) as {
      current?: Record<string, number | string>;
      daily?: Record<string, Array<number | string>>;
    };
    const c = f.current;
    if (!c) return null;
    const where = [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ');
    const lines = [
      `WEATHER now in ${where} (local time ${c.time}): ${weatherText(Number(c.weather_code), lang)}, ` +
        `${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C), humidity ${c.relative_humidity_2m}%, ` +
        `wind ${c.wind_speed_10m} km/h, precipitation ${c.precipitation} mm.`,
    ];
    const d = f.daily;
    if (d?.time) {
      d.time.forEach((day, i) => {
        // Spell out the weekday so the model doesn't have to work it out.
        const label = new Date(`${day}T12:00:00Z`).toLocaleDateString(
          lang === 'id' ? 'id-ID' : 'en-US',
          {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          },
        );
        lines.push(
          `FORECAST ${where} ${i === 0 ? (lang === 'id' ? 'hari ini' : 'today') : i === 1 ? (lang === 'id' ? 'besok' : 'tomorrow') : ''} ${label}: ${weatherText(Number(d.weather_code?.[i]), lang)}, ` +
            `${d.temperature_2m_min?.[i]}–${d.temperature_2m_max?.[i]}°C, chance of rain ${d.precipitation_probability_max?.[i]}%.`,
        );
      });
    }
    const url = `https://open-meteo.com/en/docs#latitude=${hit.latitude}&longitude=${hit.longitude}`;
    return {
      lines: [lines.join('\n   ')],
      sources: [{ kind: 'web', label: `Open-Meteo · ${where}`, ref: url, url, channelId: null }],
    };
  }

  private async getText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${hostOf(url)} answered ${res.status}`);
    return res.text();
  }

  private async getJson(url: string): Promise<unknown> {
    return JSON.parse(await this.getText(url));
  }
}
