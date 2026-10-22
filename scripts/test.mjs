// Проверки сборщика на подставных ответах (без интернета): node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './collect.mjs';
import { normalizeTikTok, absUrl } from './lib/tiktok.mjs';
import { parseIsoDuration } from './lib/youtube.mjs';
import { prune, shouldRun } from './lib/merge.mjs';

const ttRaw = (id, views, musicId) => ({
  video_id: String(id), title: 'Ролик ' + id, cover: `/video/cover/${id}.webp`, play: `/video/media/play/${id}.mp4`,
  duration: 15, play_count: views, digg_count: 10, create_time: 1792000000,
  author: { unique_id: 'user' + id, nickname: 'User' },
  music_info: { id: String(musicId), title: 'Звук ' + musicId, author: 'Автор', play: `https://cdn.example/${musicId}.mp3`, duration: 30 }
});

function fakeFetch(routes) {
  return async (url) => {
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => hit[1](url) };
  };
}

async function project(cfg, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rh-'));
  await mkdir(join(root, 'config'));
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'config/config.json'), JSON.stringify(cfg));
  for (const [k, v] of Object.entries(files)) await writeFile(join(root, k), JSON.stringify(v));
  return root;
}

test('разбор ответа tikwm', () => {
  const it = normalizeTikTok(ttRaw(123456, 500, 9), '2026-10-21T00:00:00Z');
  assert.equal(it.id, 'tt_123456');
  assert.equal(it.cover, 'https://www.tikwm.com/video/cover/123456.webp');
  assert.equal(it.url, 'https://www.tiktok.com/@user123456/video/123456');
  assert.equal(it.music.id, '9');
  assert.equal(normalizeTikTok({}, 'x'), null);
  assert.equal(absUrl('https://a.b/c'), 'https://a.b/c');
});

test('длительность YouTube', () => {
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('PT1M5S'), 65);
  assert.equal(parseIsoDuration('bad'), 0);
});

test('интервал и очистка старых', () => {
  const now = '2026-10-21T12:00:00Z';
  assert.equal(shouldRun({ lastRun: '2026-10-21T10:00:00Z' }, 6, now, false), false);
  assert.equal(shouldRun({ lastRun: '2026-10-21T06:05:00Z' }, 6, now, false), true);
  assert.equal(shouldRun({ lastRun: now }, 6, now, true), true);
  const items = [{ id: 'a', addedAt: '2026-09-01T00:00:00Z' }, { id: 'b', addedAt: '2026-10-20T00:00:00Z' }, { id: 'c', addedAt: '2026-09-01T00:00:00Z' }];
  assert.deepEqual(prune(items, 30, now, ['c']).map((x) => x.id), ['b', 'c']);
});

test('полный сбор: TikTok + музыка + YouTube, повторный сбор сохраняет дату', async () => {
  const cfg = {
    region: 'RU', intervalHours: 6, retentionDays: 30,
    sources: { tiktok: { enabled: true, perRun: 10, keywords: ['танцы'] }, youtube: { enabled: true, perRun: 5 }, tiktokMusic: { enabled: true } },
    pinned: []
  };
  const old = { id: 'tt_1', source: 'tiktok', sourceId: '1', views: 1, addedAt: '2026-10-01T00:00:00Z' };
  const ancient = { id: 'tt_old', source: 'tiktok', sourceId: 'old', views: 1, addedAt: '2026-08-01T00:00:00Z' };
  const root = await project(cfg, { 'data/videos.json': [old, ancient] });
  const fetchImpl = fakeFetch([
    [/feed\/list/, () => ({ code: 0, data: [ttRaw(1, 900, 7), ttRaw(2, 300, 7)] })],
    [/feed\/search/, () => ({ code: 0, data: { videos: [ttRaw(3, 100, 8)] } })],
    [/youtube\/v3\/search/, () => ({ items: [{ id: { videoId: 'abc' } }] })],
    [/youtube\/v3\/videos/, () => ({ items: [{ id: 'abc', snippet: { title: 'Shorts', channelTitle: 'Канал', thumbnails: { high: { url: 'https://i.ytimg.com/x.jpg' } } }, statistics: { viewCount: '5000' }, contentDetails: { duration: 'PT30S' } }] })]
  ]);
  const now = '2026-10-21T12:00:00Z';
  const r = await run({ root, force: true, fetchImpl, now, env: { YT_API_KEY: 'k' }, pause: 0 });
  assert.equal(r.skipped, false);
  const videos = JSON.parse(await readFile(join(root, 'data/videos.json'), 'utf8'));
  assert.deepEqual(videos.map((v) => v.id), ['yt_abc', 'tt_1', 'tt_2', 'tt_3']);
  assert.equal(videos.find((v) => v.id === 'tt_1').addedAt, '2026-10-01T00:00:00Z');
  assert.equal(videos.find((v) => v.id === 'tt_1').views, 900);
  const music = JSON.parse(await readFile(join(root, 'data/music.json'), 'utf8'));
  assert.equal(music[0].id, 'ttm_7');
  assert.equal(music[0].uses, 2);
  assert.equal(music[0].videoId, '1');
  const status = JSON.parse(await readFile(join(root, 'data/status.json'), 'utf8'));
  assert.equal(status.sources.tiktok.ok, true);
  assert.equal(status.sources.youtube.count, 1);

  const again = await run({ root, fetchImpl, now: '2026-10-21T13:00:00Z', env: {}, pause: 0 });
  assert.equal(again.skipped, true);
});

test('ошибка источника не ломает сбор', async () => {
  const root = await project({ sources: { tiktok: { enabled: true, perRun: 10 }, youtube: { enabled: true }, tiktokMusic: { enabled: true } } });
  const r = await run({ root, force: true, fetchImpl: fakeFetch([]), now: '2026-10-21T12:00:00Z', env: {}, pause: 0 });
  assert.equal(r.results.tiktok.ok, false);
  assert.match(r.results.youtube.error, /YT_API_KEY/);
  const status = JSON.parse(await readFile(join(root, 'data/status.json'), 'utf8'));
  assert.equal(status.total.videos, 0);
});
