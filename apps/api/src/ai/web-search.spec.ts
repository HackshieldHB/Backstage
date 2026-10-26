import {
  WebSearchService,
  parseNewsRss,
  parseSearxng,
  parseWikipedia,
  questionLang,
  searchTerms,
  toFindings,
  weatherPlace,
  weatherText,
  webIntent,
} from './web-search';

describe('webIntent', () => {
  it('sends weather, news and time-sensitive questions to the web', () => {
    expect(webIntent('what is the weather in Jakarta?', true)).toBe('weather');
    expect(webIntent('cuaca di bandung besok gimana', false)).toBe('weather');
    expect(webIntent('berita terbaru hari ini', true)).toBe('news');
    expect(webIntent('latest headlines about AI', false)).toBe('news');
    expect(webIntent('harga bitcoin sekarang berapa?', true)).toBe('general');
    expect(webIntent('who won the match yesterday', true)).toBe('general');
  });

  it('keeps questions about the workspace inside it', () => {
    expect(webIntent('what did the team decide today?', false)).toBeNull();
    expect(webIntent('any news in #design-room?', false)).toBeNull();
    expect(webIntent('tugas apa yang masih terbuka hari ini?', false)).toBeNull();
    expect(webIntent('what did @maya say in the meeting', false)).toBeNull();
  });

  it('asks the web for a general question only when the workspace had nothing', () => {
    expect(webIntent('who is the CEO of Nvidia?', false)).toBe('general');
    expect(webIntent('who is the CEO of Nvidia?', true)).toBeNull();
    expect(webIntent('write me a haiku about deploys', false)).toBeNull();
    expect(webIntent('hi', false)).toBeNull();
  });
});

describe('helpers', () => {
  it('searches for the topic, not the phrasing', () => {
    expect(searchTerms('berita teknologi terbaru hari ini apa?', 'news', 'id')).toBe('teknologi');
    expect(searchTerms('berita terbaru hari ini', 'news', 'id')).toBe('berita utama Indonesia');
    expect(searchTerms('what is the latest news about Nvidia', 'news', 'en')).toBe('Nvidia');
    expect(searchTerms('harga bitcoin sekarang berapa?', 'general', 'id')).toBe('harga bitcoin');
  });

  it('detects Indonesian', () => {
    expect(questionLang('berita terbaru apa?')).toBe('id');
    expect(questionLang('what is new?')).toBe('en');
  });

  it('finds the place in a weather question', () => {
    expect(weatherPlace('what is the weather in Jakarta?')).toBe('Jakarta');
    expect(weatherPlace('cuaca di Bandung besok gimana')).toBe('Bandung');
    expect(weatherPlace('weather Surabaya today')).toBe('Surabaya');
    expect(weatherPlace('weather?')).toBeNull();
  });

  it('describes WMO codes', () => {
    expect(weatherText(0, 'en')).toBe('clear sky');
    expect(weatherText(63, 'id')).toBe('hujan');
    expect(weatherText(1234, 'en')).toBe('unknown');
  });
});

describe('parsers', () => {
  it('parses SearXNG JSON and drops non-http results', () => {
    const out = parseSearxng({
      results: [
        {
          title: 'A &amp; B',
          url: 'https://www.example.com/a',
          content: '<b>hi</b> there',
          publishedDate: '2026-10-26',
        },
        { title: 'bad', url: 'javascript:alert(1)' },
      ],
    });
    expect(out).toEqual([
      {
        title: 'A & B',
        url: 'https://www.example.com/a',
        snippet: 'hi there',
        published: '2026-10-26',
        site: 'example.com',
      },
    ]);
    expect(parseSearxng(null)).toEqual([]);
  });

  it('parses Google News RSS', () => {
    const xml = `<rss><channel><item><title>Big story - Kompas</title><link>https://news.google.com/x</link>
      <pubDate>Mon, 26 Oct 2026 03:00:00 GMT</pubDate><source url="https://kompas.com">Kompas</source></item></channel></rss>`;
    expect(parseNewsRss(xml)).toEqual([
      {
        title: 'Big story',
        url: 'https://news.google.com/x',
        snippet: '',
        published: 'Mon, 26 Oct 2026 03:00:00 GMT',
        site: 'Kompas',
      },
    ]);
  });

  it('parses Wikipedia search', () => {
    const out = parseWikipedia(
      { query: { search: [{ title: 'Jakarta Smart', snippet: 'the <span>capital</span>' }] } },
      'en',
    );
    expect(out[0]).toMatchObject({
      url: 'https://en.wikipedia.org/wiki/Jakarta_Smart',
      snippet: 'the capital',
    });
  });

  it('turns results into context lines and web sources', () => {
    const f = toFindings([{ title: 'T', url: 'https://x.io/p', snippet: 'S', site: 'x.io' }]);
    expect(f.lines).toEqual(['WEB — x.io: T — S']);
    expect(f.sources).toEqual([
      {
        kind: 'web',
        label: 'T · x.io',
        ref: 'https://x.io/p',
        url: 'https://x.io/p',
        channelId: null,
      },
    ]);
  });
});

describe('WebSearchService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.WEB_SEARCH_URL;
    delete process.env.AI_WEB_SEARCH;
  });

  it('does nothing when switched off or not needed', async () => {
    global.fetch = jest.fn() as never;
    process.env.AI_WEB_SEARCH = 'off';
    expect(await new WebSearchService().lookup('latest news', false)).toBeNull();
    delete process.env.AI_WEB_SEARCH;
    expect(await new WebSearchService().lookup('what did the team decide?', false)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses SearXNG news, caches it, and falls back on failure', async () => {
    process.env.WEB_SEARCH_URL = 'http://searxng:8080/';
    const fetchMock = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          results: [{ title: 'Headline', url: 'https://news.example/1', content: 'Body' }],
        }),
      url,
    }));
    global.fetch = fetchMock as never;
    const svc = new WebSearchService();
    const first = await svc.lookup('latest news about chips', false);
    expect(first?.sources[0]).toMatchObject({ kind: 'web', url: 'https://news.example/1' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('http://searxng:8080/search?');
    expect(String(fetchMock.mock.calls[0][0])).toContain('categories=news');
    await svc.lookup('latest news about chips', false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null instead of throwing when everything is down', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as never;
    expect(await new WebSearchService().lookup('berita terbaru', false)).toBeNull();
  });
});
