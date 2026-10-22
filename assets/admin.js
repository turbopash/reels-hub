// Админка. Все изменения сохраняются прямо в репозиторий через GitHub API.
// Для входа нужен личный токен GitHub (fine-grained) с доступом только к этому репозиторию:
// Contents — Read and write, Actions — Read and write.

import { SOURCES, fmtCount, timeAgo, sha256, el, ICONS, storage } from './common.js';

const app = document.getElementById('app');
const API = 'https://api.github.com';

const S = {
  token: storage('rh_token') || '',
  repo: storage('rh_repo') || guessRepo(),
  page: 'src',
  cfg: null, cfgSha: null, saved: '',
  videos: [], music: [], status: {},
  contentQuery: '', showHidden: false,
  msg: ''
};

function guessRepo() {
  const host = location.hostname;
  const m = /^([^.]+)\.github\.io$/i.exec(host);
  if (!m) return '';
  const first = location.pathname.split('/').filter(Boolean)[0];
  return first && !first.endsWith('.html') ? `${m[1]}/${first}` : `${m[1]}/${m[1]}.github.io`;
}

// ---------- GitHub ----------

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${S.token}`,
      Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  if (!res.ok) {
    let msg = res.status + '';
    try { msg = (await res.json()).message || msg; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return opts.raw ? res.text() : res.json();
}

const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const b64encode = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

async function readRaw(path, fallback) {
  try { return JSON.parse(await gh(`/repos/${S.repo}/contents/${path}`, { raw: true })); } catch (e) {
    if (e.status === 404) return fallback;
    throw e;
  }
}

async function loadAll() {
  const file = await gh(`/repos/${S.repo}/contents/config/config.json`);
  S.cfg = JSON.parse(b64decode(file.content));
  S.cfgSha = file.sha;
  S.saved = JSON.stringify(S.cfg);
  const [videos, music, status] = await Promise.all([
    readRaw('data/videos.json', []), readRaw('data/music.json', []), readRaw('data/status.json', {})
  ]);
  Object.assign(S, { videos, music, status });
}

async function saveConfig() {
  const body = JSON.stringify({
    message: 'Админка: изменение настроек',
    content: b64encode(JSON.stringify(S.cfg, null, 2) + '\n'),
    sha: S.cfgSha
  });
  try {
    const r = await gh(`/repos/${S.repo}/contents/config/config.json`, { method: 'PUT', body });
    S.cfgSha = r.content.sha;
    S.saved = JSON.stringify(S.cfg);
    flash('Сохранено. Сайт обновится через 1–2 минуты.');
  } catch (e) {
    if (e.status === 409) flash('Настройки изменились в другом месте. Обновите страницу и повторите.');
    else flash('Не удалось сохранить: ' + e.message);
  }
}

async function collectNow() {
  try {
    await gh(`/repos/${S.repo}/actions/workflows/collect.yml/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { force: true } }) });
    flash('Сбор запущен. Обычно он занимает 1–3 минуты, потом обновите страницу.');
  } catch (e) {
    flash('Не удалось запустить сбор: ' + e.message + '. Проверьте у токена право Actions — Read and write.');
  }
}

// ---------- Вход ----------

function renderLogin(error = '') {
  const token = el('input', { type: 'password', id: 'tok', value: S.token, autocomplete: 'off', required: true });
  const repo = el('input', { type: 'text', id: 'repo', value: S.repo, placeholder: 'логин/reels-hub', required: true });
  const err = el('div', { class: 'err', role: 'alert', text: error });
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      S.token = token.value.trim();
      S.repo = repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
      err.textContent = 'Проверяю…';
      try {
        await loadAll();
        storage('rh_token', S.token);
        storage('rh_repo', S.repo);
        render();
      } catch (ex) {
        err.textContent = ex.status === 401 ? 'Токен не подошёл.' : ex.status === 404 ? 'Репозиторий не найден или у токена нет к нему доступа.' : 'Ошибка: ' + ex.message;
      }
    }
  },
    el('div', { class: 'brand' }, el('span', { class: 'logo', html: ICONS.play }), 'Reels Hub'),
    el('h1', { text: 'Вход в админку' }),
    el('label', { class: 'field', for: 'repo' }, 'Репозиторий', repo),
    el('label', { class: 'field', for: 'tok' }, 'Токен GitHub', token,
      el('span', { class: 'hint', text: 'Токен хранится только в этом браузере. Как его получить — в README проекта.' })),
    err,
    el('button', { class: 'btn primary', type: 'submit', style: { justifyContent: 'center' } }, 'Войти'),
    el('a', { href: './', text: '← На сайт', style: { fontSize: '14px' } })
  );
  app.replaceChildren(el('main', { class: 'gate' }, form));
}

// ---------- Общие элементы ----------

const PAGES = [
  { id: 'src', label: 'Источники видео' },
  { id: 'music', label: 'Источники музыки' },
  { id: 'sections', label: 'Разделы и меню' },
  { id: 'content', label: 'Контент' },
  { id: 'look', label: 'Оформление' },
  { id: 'access', label: 'Доступ и скачивание' }
];

function dirty() { return S.cfg && JSON.stringify(S.cfg) !== S.saved; }

function flash(text) {
  S.msg = text;
  const m = document.getElementById('msg');
  if (m) m.textContent = text;
  renderSavebar();
}

function change(fn) {
  fn(S.cfg);
  S.msg = '';
  render();
}

function sw(on, label, onToggle) {
  return el('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: onToggle });
}

function field(label, input, hint) {
  return el('label', { class: 'field' }, label, input, hint ? el('span', { class: 'hint', text: hint }) : null);
}

function select(value, options, onChange) {
  return el('select', { onchange: (e) => onChange(e.target.value) },
    options.map(([v, t]) => el('option', { value: String(v), selected: String(v) === String(value), text: t })));
}

function keywordsInput(list, onChange) {
  return el('input', {
    type: 'text', value: (list || []).join(', '), placeholder: 'например: танцы, юмор, рецепты',
    onchange: (e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
  });
}

function statusBadge(key, enabled) {
  if (!enabled) return el('span', { class: 'status', text: 'Выключен' });
  const st = S.status.sources && S.status.sources[key];
  if (!st) return el('span', { class: 'status', text: 'Ещё не собирали' });
  if (st.ok) return el('span', { class: 'status ok', text: `Работает · ${st.count}` });
  return el('span', { class: 'status warn', title: st.error, text: 'Ошибка' });
}

function errorLine(key) {
  const st = S.status.sources && S.status.sources[key];
  return st && !st.ok ? el('div', { class: 's', style: { color: 'var(--warn)' }, text: st.error }) : null;
}

// ---------- Страницы ----------

function pageSources() {
  const c = S.cfg;
  const tt = c.sources.tiktok, yt = c.sources.youtube;
  const perRun = (src) => select(src.perRun, [[10, '10'], [20, '20'], [30, '30'], [50, '50']], (v) => change(() => { src.perRun = Number(v); }));
  return [
    head('Источники видео', 'Откуда сайт сам забирает популярные ролики',
      el('button', { class: 'btn primary', onclick: collectNow }, el('span', { html: ICONS.refresh, style: { display: 'contents' } }), 'Собрать сейчас')),
    el('section', { class: 'panel list' },
      el('div', { class: 'row' },
        el('div', { class: 'info' }, el('span', { class: 't', text: 'TikTok' }), el('span', { class: 's', text: 'Тренды региона и поиск по темам. Можно скачивать.' }), errorLine('tiktok')),
        statusBadge('tiktok', tt.enabled),
        sw(tt.enabled, 'TikTok', () => change(() => { tt.enabled = !tt.enabled; }))
      ),
      el('div', { class: 'row' },
        el('div', { class: 'info' }, el('span', { class: 't', text: 'YouTube Shorts' }), el('span', { class: 's', text: 'Официальный API, нужен бесплатный ключ YT_API_KEY. Только просмотр, скачивание недоступно.' }), errorLine('youtube')),
        statusBadge('youtube', yt.enabled),
        sw(yt.enabled, 'YouTube Shorts', () => change(() => { yt.enabled = !yt.enabled; }))
      ),
      el('div', { class: 'row' },
        el('div', { class: 'info' }, el('span', { class: 't', text: 'Instagram Reels, VK Клипы' }), el('span', { class: 's', text: 'Бесплатного стабильного способа пока нет. Можно подключить позже.' })),
        el('span', { class: 'status', text: 'Недоступно' })
      )
    ),
    el('div', { class: 'cols' },
      el('section', { class: 'panel' },
        el('h2', { text: 'Что считать топом' }),
        field('Регион трендов', select(c.region, [['RU', 'Россия'], ['US', 'США'], ['GB', 'Великобритания'], ['DE', 'Германия'], ['KZ', 'Казахстан'], ['UA', 'Украина']], (v) => change(() => { c.region = v; }))),
        field('Темы TikTok', keywordsInput(tt.keywords, (v) => change(() => { tt.keywords = v; })), 'Через запятую. Пусто — только общие тренды.'),
        field('Темы YouTube Shorts', keywordsInput(yt.keywords, (v) => change(() => { yt.keywords = v; })), 'Пусто — популярные #shorts.')
      ),
      el('section', { class: 'panel' },
        el('h2', { text: 'Расписание и хранение' }),
        field('Собирать', select(c.intervalHours, [[1, 'Каждый час'], [3, 'Каждые 3 часа'], [6, 'Каждые 6 часов'], [12, 'Каждые 12 часов'], [24, 'Раз в день']], (v) => change(() => { c.intervalHours = Number(v); }))),
        field('Хранить ролики', select(c.retentionDays, [[7, '7 дней'], [14, '14 дней'], [30, '30 дней'], [60, '60 дней']], (v) => change(() => { c.retentionDays = Number(v); }))),
        field('Роликов TikTok за один сбор', perRun(tt)),
        field('Роликов YouTube за один сбор', perRun(yt)),
        el('div', { class: 's meta', text: S.status.lastRun ? `Последний сбор: ${timeAgo(S.status.lastRun)}. Сейчас на сайте ${S.videos.length} видео и ${S.music.length} треков.` : 'Сбор ещё ни разу не запускался.' })
      )
    )
  ];
}

function pageMusic() {
  const m = S.cfg.sources.tiktokMusic;
  return [
    head('Источники музыки', 'Музыка собирается из звуков трендовых роликов'),
    el('section', { class: 'panel list' },
      el('div', { class: 'row' },
        el('div', { class: 'info' }, el('span', { class: 't', text: 'Звуки TikTok' }), el('span', { class: 's', text: 'Звуки из собранных роликов, наверху — те, что используются чаще. Можно слушать и скачивать mp3.' })),
        el('span', { class: m.enabled ? 'status ok' : 'status', text: m.enabled ? `Треков: ${S.music.length}` : 'Выключен' }),
        sw(m.enabled, 'Звуки TikTok', () => change(() => { m.enabled = !m.enabled; }))
      )
    )
  ];
}

function pageSections() {
  const secs = S.cfg.sections;
  const move = (i, d) => change(() => { const [x] = secs.splice(i, 1); secs.splice(i + d, 0, x); });
  return [
    head('Разделы и меню', 'Названия, порядок и видимость разделов на сайте'),
    el('section', { class: 'panel list' },
      secs.map((s, i) => el('div', { class: 'row' },
        el('div', { class: 'info' },
          el('label', { class: 'field' }, s.id === 'music' ? 'Раздел музыки' : 'Раздел видео',
            el('input', { type: 'text', value: s.title, onchange: (e) => change(() => { s.title = e.target.value.trim() || s.title; }) })
          )
        ),
        el('div', { class: 'toolbar' },
          el('button', { class: 'btn', disabled: i === 0, onclick: () => move(i, -1), 'aria-label': 'Выше' }, '↑'),
          el('button', { class: 'btn', disabled: i === secs.length - 1, onclick: () => move(i, 1), 'aria-label': 'Ниже' }, '↓')
        ),
        sw(s.visible !== false, 'Показывать раздел ' + s.title, () => change(() => { s.visible = s.visible === false; }))
      ))
    )
  ];
}

function pageContent() {
  const c = S.cfg;
  const pin = new Set(c.pinned), hid = new Set(c.hidden);
  const q = S.contentQuery.toLowerCase();
  const list = S.videos
    .filter((v) => (S.showHidden ? hid.has(v.id) : true) && (!q || `${v.title} ${v.author}`.toLowerCase().includes(q)))
    .slice(0, 150);
  const toggle = (arr, id) => { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); };
  const search = el('input', { type: 'search', value: S.contentQuery, placeholder: 'Поиск по названию', oninput: (e) => { S.contentQuery = e.target.value; clearTimeout(S.t); S.t = setTimeout(render, 250); } });
  return [
    head('Контент', `Всего ${S.videos.length} видео · закреплено ${pin.size} · скрыто ${hid.size}`),
    el('div', { class: 'toolbar' },
      el('label', { class: 'search', style: { maxWidth: '420px' } }, el('span', { class: 'sr-only', text: 'Поиск' }), el('span', { html: ICONS.search, style: { display: 'contents' } }), search),
      el('button', { class: 'btn', 'aria-pressed': String(S.showHidden), onclick: () => { S.showHidden = !S.showHidden; render(); } }, S.showHidden ? 'Показать все' : 'Только скрытые')
    ),
    list.length ? el('section', { class: 'panel list' },
      list.map((v) => el('div', { class: 'row' },
        v.cover ? el('img', { class: 'mini', src: v.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.removeAttribute('src'); } }) : el('span', { class: 'mini' }),
        el('div', { class: 'info' },
          el('a', { class: 't', href: v.url, target: '_blank', rel: 'noopener noreferrer', text: v.title, style: { color: 'var(--ink)', textDecoration: 'none' } }),
          el('span', { class: 's', text: [(SOURCES[v.source] || {}).long, v.author, fmtCount(v.views) + ' просм.', 'добавлено ' + timeAgo(v.addedAt)].filter(Boolean).join(' · ') })
        ),
        el('button', { class: 'btn', 'aria-pressed': String(pin.has(v.id)), onclick: () => change(() => toggle(c.pinned, v.id)) }, pin.has(v.id) ? 'Открепить' : 'Закрепить'),
        el('button', { class: 'btn danger', onclick: () => change(() => toggle(c.hidden, v.id)) }, hid.has(v.id) ? 'Вернуть' : 'Скрыть')
      ))
    ) : el('div', { class: 'empty' }, el('strong', { text: 'Ничего нет' }), S.showHidden ? 'Скрытых роликов нет.' : 'Ролики появятся после первого сбора.')
  ];
}

function pageLook() {
  const c = S.cfg;
  const presets = ['#2563EB', '#0F766E', '#7C3AED', '#DB2777', '#17181C'];
  return [
    head('Оформление', 'Название и основной цвет сайта'),
    el('section', { class: 'panel', style: { maxWidth: '560px' } },
      field('Название сайта', el('input', { type: 'text', value: c.siteTitle, onchange: (e) => change(() => { c.siteTitle = e.target.value.trim() || 'Reels Hub'; }) })),
      el('div', { class: 'field' }, 'Основной цвет',
        el('div', { class: 'toolbar' },
          presets.map((p) => el('button', {
            class: 'btn', 'aria-label': 'Цвет ' + p, 'aria-pressed': String(c.accent === p),
            style: { width: '44px', padding: '0', background: p, borderColor: c.accent === p ? 'var(--ink)' : p, outline: c.accent === p ? '2px solid var(--ink)' : 'none' },
            onclick: () => change(() => { c.accent = p; })
          })),
          el('input', { type: 'color', value: c.accent, 'aria-label': 'Свой цвет', style: { width: '56px', padding: '4px', minHeight: '44px' }, onchange: (e) => change(() => { c.accent = e.target.value; }) })
        )
      )
    )
  ];
}

function pageAccess() {
  const c = S.cfg;
  const pass = el('input', { type: 'password', autocomplete: 'new-password', placeholder: c.passwordHash ? 'Новый пароль' : 'Придумайте пароль' });
  const proxy = el('input', { type: 'url', value: c.downloadProxy || '', placeholder: 'https://reels-hub-download.<имя>.workers.dev' });
  return [
    head('Доступ и скачивание', 'Пароль на сайт и посредник для кнопки «Скачать»'),
    el('div', { class: 'cols' },
      el('section', { class: 'panel' },
        el('h2', { text: 'Пароль на сайт' }),
        el('div', { class: 's meta', text: c.passwordHash ? 'Пароль установлен.' : 'Сейчас сайт открывается без пароля.' }),
        field('Пароль', pass, 'Это простой замок от случайных посетителей. Админка защищена отдельно — токеном GitHub.'),
        el('div', { class: 'toolbar' },
          el('button', { class: 'btn primary', onclick: async () => { if (!pass.value) return; const h = await sha256(pass.value); storage('rh_pass', h); change(() => { c.passwordHash = h; }); } }, 'Установить'),
          c.passwordHash ? el('button', { class: 'btn danger', onclick: () => change(() => { c.passwordHash = ''; }) }, 'Убрать пароль') : null
        )
      ),
      el('section', { class: 'panel' },
        el('h2', { text: 'Посредник для скачивания' }),
        field('Адрес Cloudflare Worker', proxy, 'Без него кнопка «Скачать» открывает видео в новой вкладке. Как создать — в README.'),
        el('div', { class: 'toolbar' },
          el('button', { class: 'btn primary', onclick: () => change(() => { c.downloadProxy = proxy.value.trim().replace(/\/+$/, ''); }) }, 'Применить'),
          el('button', {
            class: 'btn', onclick: async () => {
              const u = proxy.value.trim().replace(/\/+$/, '');
              if (!u) return flash('Сначала укажите адрес.');
              try { const r = await fetch(u + '/health'); flash(r.ok ? 'Посредник работает.' : 'Посредник ответил ошибкой ' + r.status); } catch { flash('Посредник недоступен. Проверьте адрес.'); }
            }
          }, 'Проверить')
        )
      )
    ),
    el('section', { class: 'panel', style: { maxWidth: '560px' } },
      el('h2', { text: 'Выход' }),
      el('div', { class: 's meta', text: `Репозиторий: ${S.repo}` }),
      el('div', { class: 'toolbar' }, el('button', { class: 'btn', onclick: () => { storage('rh_token', null); S.token = ''; renderLogin(); } }, 'Выйти из админки'))
    )
  ];
}

function head(title, sub, action) {
  return el('div', { class: 'main-head' },
    el('div', {}, el('h1', { text: title }), sub ? el('p', { text: sub }) : null),
    action || null
  );
}

function renderSavebar() {
  const bar = document.getElementById('savebar');
  if (!bar) return;
  const d = dirty();
  bar.hidden = !d && !S.msg;
  bar.replaceChildren(
    el('span', { class: 'msg', id: 'msg', role: 'status', text: S.msg || (d ? 'Есть несохранённые изменения' : '') }),
    d ? el('button', { class: 'btn', onclick: () => { S.cfg = JSON.parse(S.saved); S.msg = ''; render(); } }, 'Отменить') : null,
    d ? el('button', { class: 'btn primary', onclick: saveConfig }, 'Сохранить') : null
  );
}

function render() {
  if (!S.cfg) return renderLogin();
  if (S.cfg.accent) document.documentElement.style.setProperty('--accent', S.cfg.accent);
  const pages = { src: pageSources, music: pageMusic, sections: pageSections, content: pageContent, look: pageLook, access: pageAccess };
  const focusId = document.activeElement && document.activeElement.type === 'search' ? 'search' : null;
  app.replaceChildren(el('div', { class: 'admin' },
    el('aside', { class: 'side' },
      el('a', { class: 'brand', href: './' }, el('span', { class: 'logo', html: ICONS.play }), el('span', {}, S.cfg.siteTitle || 'Reels Hub', el('small', { text: 'Админка' }))),
      el('nav', { class: 'side-nav', 'aria-label': 'Разделы админки' },
        PAGES.map((p) => el('button', { class: 'fbtn', 'aria-pressed': String(S.page === p.id), text: p.label, onclick: () => { S.page = p.id; S.msg = ''; render(); } }))
      ),
      el('a', { href: './', class: 'fbtn', style: { display: 'flex', alignItems: 'center', marginTop: '14px', textDecoration: 'none', fontWeight: '600' } }, '← На сайт')
    ),
    el('main', { class: 'main' }, pages[S.page](), el('div', { class: 'savebar', id: 'savebar', hidden: true }))
  ));
  renderSavebar();
  if (focusId) { const s = app.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
}

window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  if (!S.token || !S.repo) return renderLogin();
  try { await loadAll(); render(); } catch (e) { renderLogin(e.status === 401 ? 'Токен устарел, войдите заново.' : 'Не удалось загрузить: ' + e.message); }
})();
