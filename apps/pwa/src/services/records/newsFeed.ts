/** Public headline snapshots. Reading this feed sends no location or search text. */
export type NewsTopic = 'abuse' | 'news';

export interface NewsArticle {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly publisher: string;
  /** Upstream observation time; not a verified publication date. */
  readonly publishedAt: string;
  readonly topic: NewsTopic;
}

export interface NewsFeed {
  readonly schema: 'darkroute-news/v1';
  readonly updatedAt: string;
  readonly lastAttemptAt: string;
  readonly coverage: {
    readonly status: 'complete' | 'partial' | 'unavailable';
    readonly attempted: number;
    readonly succeeded: number;
  };
  readonly articles: readonly NewsArticle[];
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid news feed');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new Error('Invalid news feed text');
  }
  return value.trim();
}

function timestamp(value: unknown): string {
  const stamp = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(stamp) || !Number.isFinite(Date.parse(stamp))) {
    throw new Error('Invalid news feed date');
  }
  return stamp;
}

function sourceUrl(value: unknown): string {
  const url = new URL(text(value, 8192));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid news source URL');
  }
  return url.href;
}

/** Old/offline feed snapshots may contain the same publisher story under several section URLs. */
export function deduplicateNewsArticles(articles: readonly NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  return [...articles].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.url.localeCompare(b.url))
    .filter((article) => {
      const url = new URL(article.url);
      const publisher = url.hostname.toLowerCase().replace(/^www\./u, '');
      const title = article.title.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, ' ').trim();
      const uuid = url.pathname.match(/article_([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})/iu)?.[1]?.toLowerCase();
      const identities = [`url:${url.href}`, `headline:${publisher}:${title}`];
      if (uuid) identities.push(`article:${publisher}:${uuid}`);
      const duplicate = identities.some((identity) => seen.has(identity));
      identities.forEach((identity) => seen.add(identity));
      return !duplicate;
    });
}

/** Reject malformed snapshots rather than quietly turning unreadable rows into an empty feed. */
export function parseNewsFeed(value: unknown): NewsFeed {
  const raw = object(value);
  const coverage = object(raw['coverage']);
  const status = coverage['status'];
  const attempted = coverage['attempted'];
  const succeeded = coverage['succeeded'];
  const articles = raw['articles'];
  if (raw['schema'] !== 'darkroute-news/v1' || !Array.isArray(articles) || articles.length > 1000 ||
      !['complete', 'partial', 'unavailable'].includes(String(status)) ||
      typeof attempted !== 'number' || !Number.isSafeInteger(attempted) || attempted < 0 ||
      typeof succeeded !== 'number' || !Number.isSafeInteger(succeeded) || succeeded < 0 || succeeded > attempted) {
    throw new Error('Invalid news feed');
  }
  const seen = new Set<string>();
  const parsed = articles.map((value): NewsArticle => {
    const article = object(value);
    const topic = article['topic'];
    const id = text(article['id'], 200);
    if ((topic !== 'abuse' && topic !== 'news') || seen.has(id)) {
      throw new Error('Invalid news article');
    }
    seen.add(id);
    return { id, title: text(article['title'], 600), url: sourceUrl(article['url']),
      publisher: text(article['publisher'], 253), publishedAt: timestamp(article['publishedAt']), topic };
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { schema: 'darkroute-news/v1', updatedAt: timestamp(raw['updatedAt']),
    lastAttemptAt: timestamp(raw['lastAttemptAt']), articles: deduplicateNewsArticles(parsed),
    coverage: { status: status as NewsFeed['coverage']['status'], attempted, succeeded } };
}

export async function fetchNewsFeed(signal?: AbortSignal): Promise<NewsFeed> {
  const response = await fetch('/api/v1/news', { credentials: 'omit', referrerPolicy: 'no-referrer',
    cache: 'no-store', ...(signal === undefined ? {} : { signal }) });
  if (!response.ok) throw new Error(`News feed unavailable (HTTP ${String(response.status)})`);
  return parseNewsFeed(await response.json());
}

export interface NewsFeedState {
  readonly data: NewsFeed | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export const NEWS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** One in-memory snapshot for both screens; nothing is stored about the reader. */
export function createNewsFeedStore(read: typeof fetchNewsFeed = fetchNewsFeed) {
  let state: NewsFeedState = { data: null, loading: false, error: null };
  let pending: Promise<void> | null = null;
  let lastAttemptAt: number | null = null;
  const listeners = new Set<() => void>();
  const update = (next: NewsFeedState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  const refresh = (): Promise<void> => {
    if (pending !== null) return pending;
    lastAttemptAt = Date.now();
    update({ ...state, loading: true, error: null });
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => { controller.abort(); }, 15_000);
    pending = Promise.resolve().then(() => read(controller.signal)).then(
      (data) => { update({ data, loading: false, error: null }); },
      () => { update({ ...state, loading: false, error: 'Could not refresh the news feed.' }); },
    ).finally(() => { globalThis.clearTimeout(timer); pending = null; });
    return pending;
  };
  return {
    getSnapshot: (): NewsFeedState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh,
    refreshIfStale(): Promise<void> {
      if (pending !== null) return pending;
      if (lastAttemptAt !== null && Date.now() - lastAttemptAt < NEWS_REFRESH_INTERVAL_MS) {
        return Promise.resolve();
      }
      return refresh();
    },
  };
}

export const newsFeed = createNewsFeedStore();
