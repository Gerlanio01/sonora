// Utilitários de UI: templates, toasts, modais, formatação
import { likes, downloads } from './db.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function icon(name, cls = 'ic') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

/* ------------------------- formatação ------------------------- */
export function fmtTime(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '0:00';
  const s = Math.floor(n % 60);
  const m = Math.floor(n / 60) % 60;
  const h = Math.floor(n / 3600);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.0', '') + ' mi';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace('.0', '') + ' mil';
  return String(v);
}

export function fmtBytes(b) {
  const v = Number(b) || 0;
  if (v >= 1073741824) return (v / 1073741824).toFixed(2) + ' GB';
  if (v >= 1048576) return (v / 1048576).toFixed(1) + ' MB';
  if (v >= 1024) return Math.round(v / 1024) + ' KB';
  return v + ' B';
}

export function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/* ------------------------- coleções ---------------------------
   Guarda listas de faixas já renderizadas para que os botões
   "Ouvir tudo" encontrem as músicas sem refazer a requisição. */
const collections = new Map();
export function setCollection(key, tracks) { collections.set(key, tracks || []); }
export function getCollection(key) { return collections.get(key) || []; }

/* --------------------------- toasts --------------------------- */
export function toast(message, opts = {}) {
  const { type = 'info', action = null, timeout = 4000 } = opts;
  const host = $('#toasts');
  if (!host) return () => {};
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  const glyph = type === 'ok' ? 'check' : type === 'err' ? 'x' : 'eq';
  node.innerHTML = `${icon(glyph)}<span>${esc(message)}</span>`;

  let timer;
  function dismiss() {
    clearTimeout(timer);
    if (!node.isConnected) return;
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }

  if (action) {
    const btn = document.createElement('button');
    btn.className = 't-act';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.onClick?.(); dismiss(); });
    node.appendChild(btn);
  }

  host.appendChild(node);
  timer = setTimeout(dismiss, timeout);
  return dismiss;
}

/* --------------------------- modais --------------------------- */
export function openModal(html) {
  const modal = $('#modal');
  const card = $('#modal-card');
  if (!modal || !card) return null;
  card.innerHTML = html;
  modal.hidden = false;
  setTimeout(() => {
    const target = card.querySelector('input, button');
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
  }, 30);
  return card;
}

export function closeModal() {
  const modal = $('#modal');
  if (!modal) return;
  modal.hidden = true;
  const card = $('#modal-card');
  if (card) card.innerHTML = '';
}

export function confirmDialog({ title, text = '', okLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    openModal(`
      <h3>${esc(title)}</h3>
      ${text ? `<p class="m-sub">${esc(text)}</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-soft btn-sm" data-modal="cancel">${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" data-modal="ok">${esc(okLabel)}</button>
      </div>`);
    const card = $('#modal-card');
    const done = (value) => { closeModal(); resolve(value); };
    card.querySelector('[data-modal="cancel"]').onclick = () => done(false);
    card.querySelector('[data-modal="ok"]').onclick = () => done(true);
    card.querySelector('[data-modal="ok"]').focus();
  });
}

export function promptDialog({ title, label = 'Nome', value = '', placeholder = '', okLabel = 'Salvar' }) {
  return new Promise((resolve) => {
    openModal(`
      <h3>${esc(title)}</h3>
      <p class="m-sub">${esc(label)}</p>
      <input class="field" id="prompt-field" type="text" maxlength="80" placeholder="${esc(placeholder)}" value="${esc(value)}">
      <div class="modal-actions">
        <button class="btn btn-soft btn-sm" data-modal="cancel">Cancelar</button>
        <button class="btn btn-primary btn-sm" data-modal="ok">${esc(okLabel)}</button>
      </div>`);
    const card = $('#modal-card');
    const field = card.querySelector('#prompt-field');
    const done = (out) => { closeModal(); resolve(out); };
    card.querySelector('[data-modal="cancel"]').onclick = () => done(null);
    card.querySelector('[data-modal="ok"]').onclick = () => done(field.value.trim() || null);
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(field.value.trim() || null); }
    });
  });
}

/* ----------------------- esqueletos --------------------------- */
export function skeletonCards(n = 6) {
  return `<div class="sk-row">${Array.from({ length: n }, () => '<div class="sk sk-card"></div>').join('')}</div>`;
}

export function skeletonRows(n = 6) {
  return `<div class="tracklist">${Array.from({ length: n }, () => '<div class="sk sk-line"></div>').join('')}</div>`;
}

export function emptyState({ glyph = 'music', title, text = '', btn = '' }) {
  return `
    <div class="empty">
      <div class="e-ico">${icon(glyph)}</div>
      <h3>${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${btn}
    </div>`;
}

export function errorState(message, retryAction = 'retry-view') {
  return emptyState({
    glyph: 'refresh',
    title: 'Não conseguimos carregar isto',
    text: message,
    btn: `<button class="btn btn-primary btn-sm" data-action="${retryAction}">Tentar de novo</button>`,
  });
}

/* ------------------------ templates --------------------------- */
function artHtml(track, cls = 'tr-art') {
  if (track.art) {
    return `<img class="${cls}" src="${esc(track.art)}" alt="" loading="lazy" onerror="this.style.opacity=.25">`;
  }
  return `<div class="${cls}" style="display:grid;place-items:center;color:var(--dim)">${icon('disc', 'ic ic-sm')}</div>`;
}

export function trackRow(track, index = 0, opts = {}) {
  const { showIndex = true, sub = '' } = opts;
  const subtitle = sub || track.artist;
  return `
    <div class="trow" data-track="${esc(track.id)}" data-action="play" data-id="${esc(track.id)}" role="button" tabindex="0" aria-label="Tocar ${esc(track.title)}">
      ${showIndex ? `
      <div class="tr-idx">
        <span class="num">${index + 1}</span>
        <span class="go">${icon('play', 'ic ic-sm')}</span>
      </div>` : '<div class="tr-idx"></div>'}
      ${artHtml(track)}
      <div class="tr-main">
        <span class="tr-title">${esc(track.title)}</span>
        <span class="tr-sub">${esc(subtitle)}${track.genre ? `<i class="dot"></i>${esc(track.genre)}` : ''}</span>
      </div>
      <div class="tr-plays">${track.plays ? `${icon('user', 'ic ic-sm')}${esc(fmtNum(track.plays))}` : ''}</div>
      <div class="tr-actions">
        <button class="icon-btn" data-action="like" data-like="${esc(track.id)}" data-id="${esc(track.id)}" title="Curtir" aria-label="Curtir">${icon('heart', 'ic ic-sm')}</button>
        <button class="icon-btn" data-action="download" data-dl="${esc(track.id)}" data-id="${esc(track.id)}" title="Baixar para ouvir offline" aria-label="Baixar">${icon('download', 'ic ic-sm')}</button>
        <button class="icon-btn keep" data-action="track-menu" data-id="${esc(track.id)}" title="Mais opções" aria-label="Mais opções">${icon('dots', 'ic ic-sm')}</button>
        <span class="tr-dur">${fmtTime(track.duration)}</span>
      </div>
    </div>`;
}

export function trackList(tracks, opts = {}) {
  if (!tracks.length) return '';
  return `
    <div class="tracklist" role="table">
      <div class="tl-head" role="row">
        <div>#</div><div></div><div>Faixa</div><div class="col-plays">Tocadas</div><div class="right">Duração</div>
      </div>
      ${tracks.map((t, i) => trackRow(t, i, opts)).join('')}
    </div>`;
}

export function trackCard(track) {
  return `
    <article class="card" data-action="play" data-id="${esc(track.id)}" data-track="${esc(track.id)}" tabindex="0" role="button">
      <div class="card-art">
        ${track.art
          ? `<img src="${esc(track.art)}" alt="" loading="lazy" onerror="this.style.opacity=.3">`
          : `<div class="ph">${icon('disc', 'ic ic-lg')}</div>`}
        <span class="card-play">${icon('play')}</span>
      </div>
      <div class="card-title">${esc(track.title)}</div>
      <div class="card-sub">${esc(track.artist)}</div>
    </article>`;
}

export function trackCards(tracks) {
  return `<div class="grid-cards">${tracks.map(trackCard).join('')}</div>`;
}

export function horizontalCards(tracks) {
  if (!tracks.length) return '';
  return `<div class="hscroll">${tracks.map(trackCard).join('')}</div>`;
}

export function artistCard(user) {
  return `
    <a class="card" href="#/artist/${esc(user.id)}">
      <div class="card-art">
        ${user.avatar
          ? `<img src="${esc(user.avatar)}" alt="" loading="lazy" onerror="this.style.opacity=.3">`
          : `<div class="ph">${icon('user', 'ic ic-lg')}</div>`}
      </div>
      <div class="card-title">${esc(user.name)}${user.verified ? ' ✓' : ''}</div>
      <div class="card-sub">Artista · ${esc(fmtNum(user.followers))} seguidores</div>
    </a>`;
}

export function playlistCard(playlist) {
  const local = playlist.id.startsWith('pl_');
  const href = local ? `#/playlist/${esc(playlist.id)}` : `#/playlist-online/${esc(playlist.id)}`;
  return `
    <a class="card" href="${href}">
      <div class="card-art">
        ${playlist.art
          ? `<img src="${esc(playlist.art)}" alt="" loading="lazy" onerror="this.style.opacity=.3">`
          : `<div class="ph">${icon('music', 'ic ic-lg')}</div>`}
        <span class="card-play" data-action="play-collection" data-key="pl:${esc(playlist.id)}">${icon('play')}</span>
      </div>
      <div class="card-title">${esc(playlist.name)}</div>
      <div class="card-sub">${playlist.trackCount || playlist.tracks.length} faixas · ${esc(playlist.owner)}</div>
    </a>`;
}

export function recentChip(track) {
  return `
    <div class="recent-chip" data-action="play" data-id="${esc(track.id)}" data-track="${esc(track.id)}" role="button" tabindex="0">
      ${track.art
        ? `<img src="${esc(track.art)}" alt="" loading="lazy" onerror="this.style.opacity=.3">`
        : `<div style="width:54px;height:54px;display:grid;place-items:center;background:var(--surface-3);color:var(--dim)">${icon('disc')}</div>`}
      <div class="rc-meta">
        <div class="rc-t">${esc(track.title)}</div>
        <div class="rc-s">${esc(track.artist)}</div>
      </div>
      <span class="icon-btn rc-play">${icon('play', 'ic ic-sm')}</span>
    </div>`;
}

export function sectionHead(title, opts = {}) {
  const { sub = '', action = '' } = opts;
  return `
    <div class="section-head">
      <div>
        <h2>${esc(title)}</h2>
        ${sub ? `<span class="sub">${esc(sub)}</span>` : ''}
      </div>
      ${action}
    </div>`;
}

/* ----------------- estados de botão (curtir/baixar) --------------- */
export function setLikeState(id, liked) {
  const key = String(id);
  for (const btn of $$(`[data-like="${key}"]`)) {
    btn.classList.toggle('on', liked);
    btn.classList.toggle('keep', liked);
    btn.innerHTML = icon(liked ? 'heart-fill' : 'heart', 'ic ic-sm');
    btn.title = liked ? 'Remover das curtidas' : 'Curtir';
  }
}

export function setDownloadState(id, state, pct = 0) {
  const key = String(id);
  for (const btn of $$(`[data-dl="${key}"]`)) {
    btn.disabled = state === 'busy';
    btn.classList.toggle('ok', state === 'done');
    if (state === 'busy') {
      btn.innerHTML = `<span class="dl-ring" style="--p:${Math.round(pct)}"></span>`;
      btn.title = `Baixando… ${Math.round(pct)}%`;
    } else if (state === 'done') {
      btn.innerHTML = icon('download-done', 'ic ic-sm');
      btn.title = 'Disponível offline · clique para remover';
      btn.classList.add('keep');
    } else {
      btn.innerHTML = icon('download', 'ic ic-sm');
      btn.title = 'Baixar para ouvir offline';
      btn.classList.remove('keep');
    }
  }
}

export async function hydrateTrackStates(root = document) {
  try {
    const [likedIds, dlIds] = await Promise.all([likes.ids(), downloads.ids()]);
    for (const btn of $$('[data-like]', root)) {
      const id = String(btn.dataset.like);
      const liked = likedIds.has(id);
      btn.classList.toggle('on', liked);
      btn.classList.toggle('keep', liked);
      btn.innerHTML = icon(liked ? 'heart-fill' : 'heart', 'ic ic-sm');
      btn.title = liked ? 'Remover das curtidas' : 'Curtir';
    }
    for (const btn of $$('[data-dl]', root)) {
      const id = String(btn.dataset.dl);
      if (dlIds.has(id)) {
        btn.classList.add('ok', 'keep');
        btn.innerHTML = icon('download-done', 'ic ic-sm');
        btn.title = 'Disponível offline · clique para remover';
      }
    }
  } catch { /* IndexedDB indisponível */ }
}

/** Destaca a faixa tocando nas listas e sincroniza o equalizador. */
export function syncPlayingRows(currentId, playing) {
  const key = currentId == null ? '' : String(currentId);
  for (const row of $$('.trow.playing, .card.playing, .recent-chip.playing')) row.classList.remove('playing');
  if (key) {
    for (const row of $$(`[data-track="${key}"]`)) row.classList.add('playing');
  }
  for (const node of $$('.trow, .recent-chip')) node.classList.toggle('paused', !playing);
}
