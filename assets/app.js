import { SOURCES, loadJson, fmtCount, fmtDuration, timeAgo, sha256, filterVideos, downloadUrl, playUrl, el, ICONS, storage } from './common.js';

const app = document.getElementById('app');
const icon = (name) => el('span', { html: ICONS[name], style: { display: 'contents' } });

const state = {
  cfg: {}, videos: [], music: [], status: {},
  source: 'all', days: 0, query: '',
  audio: null, playingId: null
};

const PERIODS = [
  { days: 0, label: 'Всё время' },
  { days: 1, label: 'Сегодня' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' }
];

async function start() {
  try {
    state.cfg = await loadJson('config/config.json');
  } catch {
    state.cfg = {};
  }
  const cfg = state.cfg;
  if (cfg.accent) document.documentElement.style.setProperty('--accent', cfg.accent);
  document.title = cfg.siteTitle || 'Reels Hub';

  if (cfg.passwordHash && storage('rh_pass') !== cfg.passwordHash) return renderGate();

  const [videos, music, status] = await Promise.all([
    loadJson('data/videos.json').catch(() => []),
    loadJson('data/music.json').catch(() => []),
    loadJson('data/status.json').catch(() => ({}))
  ]);
  Object.assign(state, { videos, music, status });
  window.addEventListener('hashchange', render);
  render();
}

function renderGate() {
  const input = el('input', { type: 'password', id: 'pass', autocomplete: 'current-password', required: true });
  const err = el('div', { class: 'err', role: 'alert' });
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const h = await sha256(input.value);
      if (h === state.cfg.passwordHash) { storage('rh_pass', h); start(); }
      else err.textContent = 'Неверный пароль';
    }
  },
    el('div', { class: 'brand' }, el('span', { class: 'logo', html: ICONS.play }), state.cfg.siteTitle || 'Reels Hub'),
    el('h1', { text: 'Вход' }),
    el('label', { class: 'field', for: 'pass' }, 'Пароль', input),
    err,
    el('button', { class: 'btn primary', type: 'submit', style: { justifyContent: 'center' } }, 'Войти')
  );
  app.replaceChildren(el('main', { class: 'gate' }, form));
  input.focus();
}

function sections() {
  const list = (state.cfg.sections || [{ id: 'videos', title: 'Видео', visible: true }, { id: 'music', title: 'Музыка', visible: true }]);
  return list.filter((s) => s.visible !== false);
}

function currentSection() {
  const secs = sections();
  const want = location.hash.replace(/^#\/?/, '') || (secs[0] && secs[0].id) || 'videos';
  return secs.find((s) => s.id === want) ? want : (secs[0] && secs[0].id);
}

function render() {
  const sec = currentSection();
  const header = renderHeader(sec);
  const body = sec === 'music' ? renderMusic() : renderVideos();
  app.replaceChildren(header, body, renderPlayer(), el('div', { class: 'viewer', id: 'viewer', hidden: true }));
}

function renderHeader(sec) {
  const tabs = el('nav', { class: 'tabs', 'aria-label': 'Разделы' },
    sections().map((s) => el('a', { href: '#' + s.id, 'aria-current': s.id === sec ? 'page' : null, text: s.title }))
  );
  const q = el('input', {
    type: 'search', placeholder: 'Поиск по названию или автору', value: state.query,
    oninput: (e) => { state.query = e.target.value; refreshList(); }
  });
  return el('header', { class: 'top' },
    el('div', { class: 'top-in' },
      el('a', { class: 'brand', href: '#' }, el('span', { class: 'logo', html: ICONS.play }), state.cfg.siteTitle || 'Reels Hub'),
      tabs,
      el('label', { class: 'search' }, el('span', { class: 'sr-only', text: 'Поиск' }), icon('search'), q),
      el('a', { class: 'icon-link', href: 'admin.html', 'aria-label': 'Админка', title: 'Админка', html: ICONS.gear })
    )
  );
}

function refreshList() {
  const target = document.getElementById('list');
  if (!target) return;
  const sec = currentSection();
  target.replaceWith(sec === 'music' ? musicList() : videoGrid());
}

function updatedLine() {
  const parts = [];
  if (state.status.lastRun) parts.push('Обновлено ' + timeAgo(state.status.lastRun));
  parts.push(`хранится ${state.cfg.retentionDays || 30} дней`);
  return parts.join(' · ');
}

// ---------- Видео ----------

function renderVideos() {
  const present = [...new Set(state.videos.map((v) => v.source))].filter((s) => SOURCES[s]);
  const srcButtons = [{ id: 'all', label: 'Все источники' }, ...present.map((s) => ({ id: s, label: SOURCES[s].long }))];
  const filters = el('div', { class: 'filters' },
    el('div', { class: 'fgroup', role: 'group', 'aria-label': 'Источник' },
      el('h2', { text: 'Источник' }),
      srcButtons.map((b) => el('button', {
        class: 'fbtn', 'aria-pressed': String(state.source === b.id), text: b.label,
        onclick: () => { state.source = b.id; render(); }
      }))
    ),
    el('div', { class: 'fgroup', role: 'group', 'aria-label': 'Период' },
      el('h2', { text: 'Период' }),
      PERIODS.map((p) => el('button', {
        class: 'fbtn', 'aria-pressed': String(state.days === p.days), text: p.label,
        onclick: () => { state.days = p.days; render(); }
      }))
    )
  );
  return el('div', { class: 'layout' }, filters,
    el('main', { class: 'content' },
      el('div', { class: 'head' }, el('h1', { text: 'Сейчас в топе' }), el('span', { class: 'meta', text: updatedLine() })),
      videoGrid()
    )
  );
}

function videoGrid() {
  const cfg = state.cfg;
  const list = filterVideos(state.videos, { source: state.source, days: state.days, query: state.query, hidden: cfg.hidden, pinned: cfg.pinned });
  if (!list.length) return emptyBlock();
  const pinned = new Set(cfg.pinned || []);
  return el('div', { class: 'grid', id: 'list' }, list.map((v) => videoCard(v, pinned.has(v.id))));
}

function emptyBlock() {
  const first = !state.status.lastRun;
  return el('div', { class: 'empty', id: 'list' },
    el('strong', { text: first ? 'Пока пусто' : 'Ничего не найдено' }),
    first ? 'Первый сбор ещё не прошёл. Запустите его в админке кнопкой «Собрать сейчас».' : 'Попробуйте другой источник, период или запрос.'
  );
}

function coverImg(src) {
  if (!src) return null;
  return el('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() });
}

function dlButton(item, kind) {
  const can = item.source === 'tiktok';
  const href = downloadUrl(item, kind, state.cfg);
  return el('a', {
    class: 'btn-icon', href, target: '_blank', rel: 'noopener noreferrer',
    download: can ? '' : null,
    'aria-label': can ? (kind === 'music' ? 'Скачать mp3' : 'Скачать видео') : 'Открыть в YouTube',
    title: can ? 'Скачать' : 'Скачивание YouTube недоступно — откроется в YouTube',
    html: can ? ICONS.download : ICONS.external,
    onclick: (e) => e.stopPropagation()
  });
}

function videoCard(v, isPinned) {
  const src = SOURCES[v.source] || { label: v.source };
  return el('article', { class: 'card' },
    el('button', { class: 'thumb', 'aria-label': 'Смотреть: ' + v.title, onclick: () => openViewer(v) },
      coverImg(v.cover),
      el('span', { class: 'badge', text: src.label }),
      isPinned ? el('span', { class: 'pin', text: 'Закреплено' }) : null,
      el('span', { class: 'playdot', html: ICONS.play }),
      v.duration ? el('span', { class: 'dur', text: fmtDuration(v.duration) }) : null,
      v.views ? el('span', { class: 'views', text: fmtCount(v.views) }) : null
    ),
    el('div', { class: 'card-row' },
      el('div', { style: { flex: '1', minWidth: '0' } },
        el('div', { class: 'card-title', text: v.title }),
        el('div', { class: 'card-sub', text: v.author || '' })
      ),
      dlButton(v, 'video')
    )
  );
}

function openViewer(v) {
  const box = document.getElementById('viewer');
  let media;
  if (v.source === 'youtube') {
    media = el('iframe', { src: `https://www.youtube-nocookie.com/embed/${v.sourceId}?autoplay=1&playsinline=1`, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, title: v.title });
  } else {
    const src = playUrl(v, 'video', state.cfg);
    media = src
      ? el('video', { src, poster: v.cover || null, controls: true, autoplay: true, playsinline: true, loop: true, referrerpolicy: 'no-referrer' })
      : coverImg(v.cover);
  }
  const close = () => { box.hidden = true; box.replaceChildren(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const can = v.source === 'tiktok';
  box.replaceChildren(
    el('button', { class: 'close', 'aria-label': 'Закрыть', html: ICONS.close, onclick: close }),
    el('div', { class: 'viewer-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': v.title },
      el('div', { class: 'viewer-media' }, media),
      el('div', { class: 'viewer-bar' },
        el('div', { class: 'info' }, el('div', { class: 't', text: v.title }), el('div', { class: 'meta', text: [v.author, v.views ? fmtCount(v.views) + ' просмотров' : ''].filter(Boolean).join(' · ') })),
        el('a', { class: 'btn-icon', href: v.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Открыть в источнике', title: 'Открыть в источнике', html: ICONS.external }),
        can ? el('a', { class: 'btn primary', href: downloadUrl(v, 'video', state.cfg), target: '_blank', rel: 'noopener noreferrer', download: '' }, icon('download'), 'Скачать') : null
      )
    )
  );
  box.onclick = (e) => { if (e.target === box) close(); };
  document.addEventListener('keydown', onKey);
  box.hidden = false;
}

// ---------- Музыка ----------

function renderMusic() {
  return el('div', { class: 'layout' },
    el('main', { class: 'content' },
      el('div', { class: 'head' }, el('h1', { text: 'Звуки из трендов' }), el('span', { class: 'meta', text: updatedLine() })),
      musicList()
    )
  );
}

function musicList() {
  const q = state.query.trim().toLowerCase();
  const hid = new Set(state.cfg.hidden || []);
  const list = state.music.filter((m) => !hid.has(m.id) && (!q || `${m.title} ${m.author}`.toLowerCase().includes(q)));
  if (!list.length) return emptyBlock();
  return el('div', { class: 'tracks', id: 'list' }, list.map((m, i) => {
    const playing = state.playingId === m.id;
    return el('div', { class: 'track' + (playing ? ' is-playing' : '') },
      el('span', { class: 'n', text: String(i + 1) }),
      el('button', { class: 'cover', 'aria-label': (playing ? 'Пауза: ' : 'Слушать: ') + m.title, onclick: () => togglePlay(m) },
        coverImg(m.cover),
        el('span', { class: 'ov', html: playing ? ICONS.pause : ICONS.play })
      ),
      el('div', { class: 'info' },
        el('span', { class: 't', text: m.title }),
        el('span', { class: 'a', text: [m.author, `в ${m.uses} ${m.uses === 1 ? 'тренде' : 'трендах'}`].filter(Boolean).join(' · ') })
      ),
      dlButton(m, 'music')
    );
  }));
}

function renderPlayer() {
  const m = state.music.find((x) => x.id === state.playingId);
  const bar = el('div', { class: 'bar' }, el('div', { id: 'progress' }));
  return el('div', { class: 'player', hidden: !m },
    m ? el('span', { class: 'cover', style: { width: '44px', height: '44px' } }, coverImg(m.cover)) : null,
    el('div', { class: 'info' }, el('span', { class: 't', text: m ? m.title : '' }), bar),
    el('button', { class: 'round', 'aria-label': 'Пауза', html: ICONS.pause, onclick: () => m && togglePlay(m) })
  );
}

function togglePlay(m) {
  if (state.playingId === m.id && state.audio) {
    state.audio.pause();
    state.audio = null;
    state.playingId = null;
    render();
    return;
  }
  if (state.audio) state.audio.pause();
  const src = playUrl(m, 'music', state.cfg);
  if (!src) return;
  const audio = new Audio(src);
  audio.addEventListener('timeupdate', () => {
    const p = document.getElementById('progress');
    if (p && audio.duration) p.style.width = (audio.currentTime / audio.duration * 100) + '%';
  });
  audio.addEventListener('ended', () => { state.audio = null; state.playingId = null; render(); });
  audio.addEventListener('error', () => { state.audio = null; state.playingId = null; render(); alert('Не удалось воспроизвести звук. Попробуйте скачать его.'); });
  audio.play().catch(() => {});
  state.audio = audio;
  state.playingId = m.id;
  render();
}

start();
