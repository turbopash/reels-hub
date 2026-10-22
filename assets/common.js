// Общие функции сайта и админки.

export const SOURCES = {
  tiktok: { label: 'TikTok', long: 'TikTok', canDownload: true },
  youtube: { label: 'Shorts', long: 'YouTube Shorts', canDownload: false }
};

export async function loadJson(path) {
  const res = await fetch(`${path}?t=${Math.floor(Date.now() / 300000)}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function fmtCount(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.0', '').replace('.', ',') + ' млрд';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' млн';
  if (n >= 1e3) return Math.round(n / 1e3) + ' тыс';
  return String(n);
}

export function fmtDuration(sec) {
  sec = Math.round(Number(sec) || 0);
  if (!sec) return '';
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!t) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  const d = Math.round(h / 24);
  return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Список роликов с учётом скрытых, закреплённых и фильтров.
export function filterVideos(items, { source = 'all', days = 0, query = '', hidden = [], pinned = [], now = Date.now() } = {}) {
  const hid = new Set(hidden);
  const pin = new Set(pinned);
  const q = query.trim().toLowerCase();
  const out = items.filter((v) => {
    if (hid.has(v.id)) return false;
    if (source !== 'all' && v.source !== source) return false;
    if (days && !pin.has(v.id) && now - Date.parse(v.addedAt) > days * 86400000) return false;
    if (q && !`${v.title} ${v.author}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return out.sort((a, b) => (pin.has(b.id) - pin.has(a.id)) || (b.views || 0) - (a.views || 0));
}

// Ссылка для скачивания. Через посредник — настоящий файл с именем;
// без посредника — прямая ссылка (на телефоне откроется видео, сохранить через «Поделиться»).
export function downloadUrl(item, kind, cfg) {
  const proxy = (cfg.downloadProxy || '').replace(/\/+$/, '');
  if (item.source === 'tiktok') {
    const id = kind === 'music' ? item.videoId : item.sourceId;
    if (proxy && id) return `${proxy}/tiktok?id=${encodeURIComponent(id)}&type=${kind === 'music' ? 'music' : 'video'}`;
    return item.play || item.url;
  }
  return item.url;
}

export function playUrl(item, kind, cfg) {
  const proxy = (cfg.downloadProxy || '').replace(/\/+$/, '');
  const id = kind === 'music' ? item.videoId : item.sourceId;
  if (item.source === 'tiktok' && proxy && id) return `${proxy}/tiktok?id=${encodeURIComponent(id)}&type=${kind === 'music' ? 'music' : 'video'}&inline=1`;
  return item.play || '';
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

export const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};

export function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { return null; }
  return null;
}
