// Сбор популярных роликов TikTok через бесплатный сервис tikwm.com.
// Сервис неофициальный: формат ответа может меняться, поэтому разбор сделан «мягким».

export const TIKWM = 'https://www.tikwm.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json'
};

export function absUrl(u) {
  if (!u || typeof u !== 'string') return '';
  if (/^https?:\/\//i.test(u)) return u;
  return TIKWM + (u.startsWith('/') ? u : '/' + u);
}

function toIso(sec) {
  const n = Number(sec);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

export function normalizeTikTok(raw, now) {
  const id = String(raw.video_id ?? raw.aweme_id ?? raw.id ?? '').trim();
  if (!id) return null;
  const author = raw.author || {};
  const handle = author.unique_id || author.uniqueId || '';
  const mi = raw.music_info || null;
  return {
    id: 'tt_' + id,
    source: 'tiktok',
    sourceId: id,
    title: String(raw.title || '').trim() || 'Без названия',
    author: handle ? '@' + handle : (author.nickname || ''),
    cover: absUrl(raw.cover || raw.origin_cover || raw.ai_dynamic_cover),
    play: absUrl(raw.hdplay || raw.play),
    duration: Number(raw.duration) || 0,
    views: Number(raw.play_count) || 0,
    likes: Number(raw.digg_count) || 0,
    url: handle ? `https://www.tiktok.com/@${handle}/video/${id}` : `https://www.tiktok.com/video/${id}`,
    publishedAt: toIso(raw.create_time),
    addedAt: now,
    music: mi && mi.id ? {
      id: String(mi.id),
      title: String(mi.title || '').trim() || 'Без названия',
      author: String(mi.author || '').trim(),
      cover: absUrl(mi.cover),
      duration: Number(mi.duration) || 0,
      play: absUrl(mi.play),
      original: Boolean(mi.original)
    } : null
  };
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`tikwm HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`tikwm: ${json.msg || 'ошибка ответа'}`);
  return json.data;
}

function listFrom(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.videos)) return data.videos;
  return [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Тренды региона + поиск по ключевым словам. Между запросами пауза:
// бесплатный tikwm пускает примерно один запрос в секунду.
export async function collectTikTok({ region = 'RU', perRun = 30, keywords = [] }, { fetchImpl = fetch, now = new Date().toISOString(), pause = 1200 } = {}) {
  const raw = [];
  const errors = [];
  const pages = Math.max(1, Math.ceil(perRun / 10));
  for (let i = 0; i < pages; i++) {
    try {
      raw.push(...listFrom(await getJson(`${TIKWM}/api/feed/list?region=${encodeURIComponent(region)}&count=10`, fetchImpl)));
    } catch (e) { errors.push(e.message); }
    await sleep(pause);
  }
  for (const kw of keywords.filter(Boolean)) {
    try {
      const url = `${TIKWM}/api/feed/search?keywords=${encodeURIComponent(kw)}&count=${Math.min(30, perRun)}&cursor=0&hd=1`;
      raw.push(...listFrom(await getJson(url, fetchImpl)));
    } catch (e) { errors.push(`${kw}: ${e.message}`); }
    await sleep(pause);
  }
  const seen = new Set();
  const items = [];
  for (const r of raw) {
    const it = normalizeTikTok(r, now);
    if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
  }
  if (!items.length && errors.length) throw new Error(errors.join('; '));
  return { items, errors };
}
