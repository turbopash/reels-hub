// Посредник для кнопки «Скачать» (Cloudflare Workers, бесплатный тариф).
// Браузер не может сам скачать файл с TikTok: другой домен и временные ссылки.
// Посредник по номеру ролика получает свежую ссылку и отдаёт файл с именем для сохранения.
//
// GET /tiktok?id=<номер ролика>&type=video|music[&inline=1]
// GET /health

const TIKWM = 'https://www.tikwm.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function abs(u) {
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : TIKWM + (u.startsWith('/') ? u : '/' + u);
}

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
    ...extra
  };
}

function text(status, msg) {
  return new Response(msg, { status, headers: cors({ 'Content-Type': 'text/plain; charset=utf-8' }) });
}

async function resolveTikTok(id) {
  const api = `${TIKWM}/api/?url=${encodeURIComponent('https://www.tiktok.com/@_/video/' + id)}&hd=1`;
  const res = await fetch(api, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cf: { cacheTtl: 600 } });
  if (!res.ok) throw new Error('tikwm HTTP ' + res.status);
  const json = await res.json();
  if (json.code !== 0 || !json.data) throw new Error(json.msg || 'ролик не найден');
  return json.data;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors({ 'Access-Control-Allow-Methods': 'GET' }) });
    if (url.pathname === '/health') return text(200, 'ok');
    if (url.pathname !== '/tiktok') return text(404, 'not found');

    const id = url.searchParams.get('id') || '';
    const type = url.searchParams.get('type') === 'music' ? 'music' : 'video';
    const inline = url.searchParams.get('inline') === '1';
    if (!/^\d{5,25}$/.test(id)) return text(400, 'bad id');

    let data;
    try { data = await resolveTikTok(id); } catch (e) { return text(502, 'Не удалось получить ролик: ' + e.message); }

    const src = type === 'music'
      ? abs(data.music_info && data.music_info.play || data.music)
      : abs(data.hdplay || data.play);
    if (!src) return text(404, 'файл не найден');

    const upstream = await fetch(src, { headers: { 'User-Agent': UA, Referer: 'https://www.tikwm.com/' } });
    if (!upstream.ok || !upstream.body) return text(502, 'Источник не отдал файл: HTTP ' + upstream.status);

    const ext = type === 'music' ? 'mp3' : 'mp4';
    const name = `reels-hub_${type === 'music' ? 'sound' : 'tiktok'}_${id}.${ext}`;
    const headers = cors({
      'Content-Type': type === 'music' ? 'audio/mpeg' : 'video/mp4',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
      'Cache-Control': 'private, max-age=600'
    });
    const len = upstream.headers.get('Content-Length');
    if (len) headers['Content-Length'] = len;
    return new Response(upstream.body, { status: 200, headers });
  }
};
