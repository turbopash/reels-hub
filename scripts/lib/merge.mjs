// Объединение новых роликов с уже сохранёнными, очистка старых и сборка раздела музыки.

const DAY = 86400000;

export function mergeVideos(existing, incoming) {
  const byId = new Map(existing.map((v) => [v.id, v]));
  for (const v of incoming) {
    const old = byId.get(v.id);
    // Ролик уже есть: обновляем цифры и ссылки, но сохраняем дату первого появления.
    byId.set(v.id, old ? { ...old, ...v, addedAt: old.addedAt } : v);
  }
  return [...byId.values()];
}

export function prune(items, retentionDays, now, keep = []) {
  const limit = Date.parse(now) - retentionDays * DAY;
  const pinned = new Set(keep);
  return items.filter((v) => pinned.has(v.id) || Date.parse(v.addedAt) >= limit);
}

export function sortVideos(items) {
  return [...items].sort((a, b) => (b.views || 0) - (a.views || 0) || String(b.addedAt).localeCompare(String(a.addedAt)));
}

// Музыка = звуки из собранных трендовых роликов TikTok.
// Чем больше трендовых роликов использует звук, тем выше он в списке.
export function buildMusic(videos, existingMusic, now) {
  const prev = new Map(existingMusic.map((m) => [m.id, m]));
  const groups = new Map();
  for (const v of videos) {
    if (v.source !== 'tiktok' || !v.music || !v.music.id) continue;
    const id = 'ttm_' + v.music.id;
    const g = groups.get(id) || { music: v.music, videos: [] };
    g.videos.push(v);
    groups.set(id, g);
  }
  const out = [];
  for (const [id, g] of groups) {
    const top = g.videos.reduce((a, b) => ((b.views || 0) > (a.views || 0) ? b : a));
    const old = prev.get(id);
    out.push({
      id,
      source: 'tiktok',
      sourceId: g.music.id,
      title: g.music.title,
      author: g.music.author,
      cover: g.music.cover || top.cover,
      duration: g.music.duration,
      play: g.music.play,
      original: g.music.original,
      videoId: top.sourceId,
      videoUrl: top.url,
      uses: g.videos.length,
      views: g.videos.reduce((s, v) => s + (v.views || 0), 0),
      addedAt: old ? old.addedAt : now
    });
  }
  return out.sort((a, b) => b.uses - a.uses || b.views - a.views);
}

export function shouldRun(status, intervalHours, now, force) {
  if (force) return true;
  if (!status || !status.lastRun) return true;
  // Небольшой запас в 10 минут, чтобы запуск «каждый час» не пропускал свою очередь.
  return Date.parse(now) - Date.parse(status.lastRun) >= intervalHours * 3600000 - 600000;
}
