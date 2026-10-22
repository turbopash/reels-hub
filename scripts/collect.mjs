#!/usr/bin/env node
// Сборщик: запускается GitHub Actions по расписанию.
// Читает config/config.json, собирает ролики, обновляет data/*.json.
// Запуск вручную: node scripts/collect.mjs --force

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTikTok } from './lib/tiktok.mjs';
import { collectYouTube } from './lib/youtube.mjs';
import { mergeVideos, prune, sortVideos, buildMusic, shouldRun } from './lib/merge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 1) + '\n');
}

export async function run({ root = ROOT, force = false, fetchImpl = fetch, now = new Date().toISOString(), env = process.env, pause } = {}) {
  const cfg = await readJson(join(root, 'config/config.json'), {});
  const status = await readJson(join(root, 'data/status.json'), {});
  const intervalHours = Number(cfg.intervalHours) || 6;
  if (!shouldRun(status, intervalHours, now, force)) {
    console.log(`Пропуск: последний сбор ${status.lastRun}, интервал ${intervalHours} ч.`);
    return { skipped: true };
  }

  const src = cfg.sources || {};
  const region = cfg.region || 'RU';
  const results = {};
  let incoming = [];

  if (src.tiktok && src.tiktok.enabled) {
    try {
      const r = await collectTikTok({ region, perRun: src.tiktok.perRun || 30, keywords: src.tiktok.keywords || [] }, { fetchImpl, now, pause });
      incoming = incoming.concat(r.items);
      results.tiktok = { ok: true, count: r.items.length, warnings: r.errors };
    } catch (e) {
      results.tiktok = { ok: false, count: 0, error: e.message };
    }
  }

  if (src.youtube && src.youtube.enabled) {
    try {
      const r = await collectYouTube({ region, perRun: src.youtube.perRun || 20, keywords: src.youtube.keywords || [] }, { apiKey: env.YT_API_KEY, fetchImpl, now });
      incoming = incoming.concat(r.items);
      results.youtube = { ok: true, count: r.items.length };
    } catch (e) {
      results.youtube = { ok: false, count: 0, error: e.message };
    }
  }

  const retention = Number(cfg.retentionDays) || 30;
  const keep = cfg.pinned || [];
  const existing = await readJson(join(root, 'data/videos.json'), []);
  const videos = sortVideos(prune(mergeVideos(existing, incoming), retention, now, keep));

  let music = await readJson(join(root, 'data/music.json'), []);
  if (src.tiktokMusic && src.tiktokMusic.enabled) {
    music = buildMusic(videos, music, now);
    results.tiktokMusic = { ok: true, count: music.length };
  }

  await writeJson(join(root, 'data/videos.json'), videos);
  await writeJson(join(root, 'data/music.json'), music);
  await writeJson(join(root, 'data/status.json'), { lastRun: now, sources: results, total: { videos: videos.length, music: music.length } });

  for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v.ok ? 'ок, ' + v.count : 'ошибка — ' + v.error}`);
  console.log(`Всего: ${videos.length} видео, ${music.length} треков.`);
  return { skipped: false, results, videos, music };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run({ force: process.argv.includes('--force') || process.env.FORCE === 'true' }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
