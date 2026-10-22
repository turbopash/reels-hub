// YouTube Shorts через официальный YouTube Data API v3 (бесплатный ключ в секрете YT_API_KEY).

const API = 'https://www.googleapis.com/youtube/v3';

export function parseIsoDuration(s) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s || '');
  if (!m) return 0;
  const [, d, h, mi, se] = m.map((x) => Number(x) || 0);
  return d * 86400 + h * 3600 + mi * 60 + se;
}

export function normalizeYouTube(v, now) {
  if (!v || !v.id) return null;
  const sn = v.snippet || {};
  const th = sn.thumbnails || {};
  const st = v.statistics || {};
  const cover = (th.maxres || th.standard || th.high || th.medium || th.default || {}).url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
  return {
    id: 'yt_' + v.id,
    source: 'youtube',
    sourceId: v.id,
    title: String(sn.title || '').trim() || 'Без названия',
    author: sn.channelTitle || '',
    cover,
    play: '',
    duration: parseIsoDuration(v.contentDetails && v.contentDetails.duration),
    views: Number(st.viewCount) || 0,
    likes: Number(st.likeCount) || 0,
    url: `https://www.youtube.com/shorts/${v.id}`,
    publishedAt: sn.publishedAt || null,
    addedAt: now,
    music: null
  };
}

export async function collectYouTube({ region = 'RU', perRun = 20, keywords = [] }, { apiKey, fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  if (!apiKey) throw new Error('не задан ключ YT_API_KEY в секретах репозитория');
  const since = new Date(Date.parse(now) - 3 * 86400000).toISOString();
  const queries = keywords.filter(Boolean).length ? keywords.filter(Boolean) : ['#shorts'];
  const ids = new Set();
  for (const q of queries) {
    const p = new URLSearchParams({
      part: 'id', type: 'video', videoDuration: 'short', order: 'viewCount',
      maxResults: String(Math.min(50, perRun)), publishedAfter: since, regionCode: region, q, key: apiKey
    });
    const res = await fetchImpl(`${API}/search?${p}`);
    const json = await res.json();
    if (!res.ok) throw new Error(`YouTube: ${json.error && json.error.message || res.status}`);
    for (const it of json.items || []) if (it.id && it.id.videoId) ids.add(it.id.videoId);
  }
  if (!ids.size) return { items: [], errors: [] };
  const items = [];
  const all = [...ids];
  for (let i = 0; i < all.length; i += 50) {
    const p = new URLSearchParams({ part: 'snippet,statistics,contentDetails', id: all.slice(i, i + 50).join(','), key: apiKey });
    const res = await fetchImpl(`${API}/videos?${p}`);
    const json = await res.json();
    if (!res.ok) throw new Error(`YouTube: ${json.error && json.error.message || res.status}`);
    for (const v of json.items || []) {
      const it = normalizeYouTube(v, now);
      if (it && it.duration > 0 && it.duration <= 180) items.push(it);
    }
  }
  return { items, errors: [] };
}
