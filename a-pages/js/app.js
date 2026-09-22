// Aplicação principal: roteamento, ações, player bar, downloads e atalhos
import * as api from './api.js';
import { likes, downloads, recents, playlists, prefs, storageInfo, requestPersistentStorage } from './db.js';
import { player, bindMediaSessionActions } from './player.js';
import * as views from './views.js';
import {
  $, $$, esc, icon, fmtTime, fmtBytes, toast, confirmDialog, promptDialog,
  openModal, closeModal, errorState, setLikeState, setDownloadState,
  hydrateTrackStates, syncPlayingRows, getCollection, setCollection,
} from './ui.js';

const viewEl = $('#view');
const audioEl = $('#audio');
const searchInput = $('#search-input');
const searchClear = $('#search-clear');

const ROUTE_ALIAS = { '/artist': '/library', '/playlist': '/library', '/playlist-online': '/library' };

/* ==================================================================
   Roteador
================================================================== */
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

function updateActiveNav(path) {
  let active = path;
  const aliasKey = Object.keys(ROUTE_ALIAS).find((k) => path === k || path.startsWith(k + '/'));
  if (aliasKey) active = ROUTE_ALIAS[aliasKey];
  for (const link of $$('[data-route]')) {
    link.classList.toggle('active', link.dataset.route === active);
  }
}

const simpleRoutes = {
  '/': () => views.home(viewEl),
  '/search': (params) => views.search(viewEl, params),
  '/library': () => views.library(viewEl),
  '/liked': () => views.liked(viewEl),
  '/downloads': () => views.downloadsView(viewEl),
  '/recent': () => views.recentView(viewEl),
};

async function navigate() {
  const { path, params } = parseRoute();
  const segments = path.split('/').filter(Boolean);
  updateActiveNav(path);
  viewEl.scrollTop = 0;

  try {
    if (simpleRoutes[path]) {
      await simpleRoutes[path](params);
    } else if (segments[0] === 'artist' && segments[1]) {
      await views.artist(viewEl, segments[1]);
    } else if (segments[0] === 'playlist' && segments[1]) {
      await views.localPlaylist(viewEl, segments[1]);
    } else if (segments[0] === 'playlist-online' && segments[1]) {
      await views.onlinePlaylist(viewEl, segments[1]);
    } else {
      views.notFound(viewEl);
    }
  } catch (err) {
    console.error('[rota]', err);
    viewEl.innerHTML = errorState(
      navigator.onLine === false
        ? 'Você está offline e esta página não foi salva. Conecte-se e tente de novo.'
        : (err?.message || 'Erro inesperado ao carregar a página.'),
    );
  }
}

window.addEventListener('hashchange', navigate);

/* ==================================================================
   Localização de faixas
================================================================== */
function findTrackSync(id) {
  const key = String(id);
  return api.getRegistered(key)
    || (viewEl._context || []).find((t) => String(t.id) === key)
    || player.queue.find((t) => String(t.id) === key)
    || (player.current && String(player.current.id) === key ? player.current : null);
}

async function findTrack(id) {
  const found = findTrackSync(id);
  if (found) return found;
  try { return await api.trackById(id); } catch { return null; }
}

/* ==================================================================
   Curtir
================================================================== */
async function handleLike(id) {
  const track = await findTrack(id);
  if (!track) { toast('Música não encontrada', { type: 'err' }); return; }
  try {
    const liked = await likes.toggle(track);
    setLikeState(track.id, liked);
    refreshBadges();
    toast(liked ? 'Adicionada às curtidas' : 'Removida das curtidas', { type: liked ? 'ok' : 'info' });
    if (parseRoute().path === '/liked') navigate();
  } catch {
    toast('Não foi possível salvar agora', { type: 'err' });
  }
}

/* ==================================================================
   Download offline
================================================================== */
const activeDownloads = new Set();

function sanitizeName(value) {
  return String(value || 'musica').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 80) || 'musica';
}

async function handleDownload(id) {
  const key = String(id);
  if (activeDownloads.has(key)) return;

  const existing = await downloads.get(key).catch(() => null);
  if (existing) {
    const ok = await confirmDialog({
      title: 'Remover download?',
      text: `“${existing.track?.title || 'Esta música'}” deixará de estar disponível offline.`,
      okLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    await downloads.remove(key);
    setDownloadState(key, 'idle');
    refreshBadges();
    toast('Download removido', { type: 'info' });
    if (parseRoute().path === '/downloads') navigate();
    return;
  }

  if (navigator.onLine === false) {
    toast('Sem conexão — não é possível baixar agora', { type: 'err' });
    return;
  }

  const track = await findTrack(id);
  if (!track) { toast('Música não encontrada', { type: 'err' }); return; }

  const info = await storageInfo().catch(() => null);
  if (info?.quota && info.quota - info.usage < 20 * 1024 * 1024) {
    toast('Espaço insuficiente no navegador para baixar', { type: 'err' });
    return;
  }

  activeDownloads.add(key);
  setDownloadState(key, 'busy', 0);

  try {
    const url = await api.resolveStreamUrl(track);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get('content-length')) || 0;
    let audioBlob;

    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) setDownloadState(key, 'busy', (received / total) * 100);
      }
      audioBlob = new Blob(chunks, { type: 'audio/mpeg' });
    } else {
      audioBlob = await res.blob();
    }

    if (!audioBlob.size) throw new Error('áudio vazio');

    let artBlob = null;
    if (track.art) {
      try {
        const artRes = await fetch(track.art);
        if (artRes.ok) artBlob = await artRes.blob();
      } catch { /* capa é opcional */ }
    }

    await downloads.add({
      id: key,
      track,
      audio: audioBlob,
      art: artBlob,
      size: audioBlob.size,
      addedAt: Date.now(),
    });

    setDownloadState(key, 'done');
    refreshBadges();
    updateStorageFoot();
    toast(`“${track.title}” salva para ouvir offline`, { type: 'ok' });
    if (parseRoute().path === '/downloads') navigate();
  } catch (err) {
    console.error('[download]', err);
    setDownloadState(key, 'idle');
    toast('Falha no download — tente novamente', { type: 'err' });
  } finally {
    activeDownloads.delete(key);
  }
}

async function saveFileToDisk(id) {
  const record = await downloads.get(String(id)).catch(() => null);
  if (!record?.audio) { toast('Baixe a música antes de salvar o arquivo', { type: 'err' }); return; }
  try {
    const url = URL.createObjectURL(record.audio);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeName(record.track.artist)} - ${sanitizeName(record.track.title)}.mp3`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Salvando arquivo no dispositivo…', { type: 'ok' });
  } catch {
    toast('O navegador bloqueou o salvamento do arquivo', { type: 'err' });
  }
}

/* ==================================================================
   Playlists
================================================================== */
async function renderPlaylistNav() {
  try {
    const list = await playlists.list();
    const host = $('#playlist-nav');
    host.innerHTML = list.length
      ? list.map((p) => `
          <a class="nav-item" href="#/playlist/${esc(p.id)}" data-route="/playlist/${esc(p.id)}">
            <svg class="ic"><use href="#i-music"></use></svg>
            <span>${esc(p.name)}</span>
            <b class="badge">${p.tracks.length}</b>
          </a>`).join('')
      : '<p class="empty-mini">Nenhuma playlist ainda — use o + acima.</p>';
    updateActiveNav(parseRoute().path);
  } catch { /* IDB indisponível */ }
}

async function createPlaylist() {
  const name = await promptDialog({
    title: 'Nova playlist',
    label: 'Dê um nome à sua playlist',
    placeholder: 'Ex: Treino de manhã',
    okLabel: 'Criar',
  });
  if (!name) return null;
  try {
    const playlist = await playlists.create(name);
    toast('Playlist criada', { type: 'ok' });
    renderPlaylistNav();
    location.hash = `#/playlist/${playlist.id}`;
    return playlist;
  } catch {
    toast('Não foi possível criar a playlist', { type: 'err' });
    return null;
  }
}

async function openAddToPlaylist(track) {
  let list = [];
  try { list = await playlists.list(); } catch { /* ignore */ }

  openModal(`
    <h3>Adicionar à playlist</h3>
    <p class="m-sub">${esc(track.title)} — ${esc(track.artist)}</p>
    <div class="modal-list">
      ${list.map((p) => `
        <button data-addpl="${esc(p.id)}">
          <span class="ml-ico">${icon('music')}</span>
          <span><span class="ml-name">${esc(p.name)}</span><br><span class="ml-sub">${p.tracks.length} faixas</span></span>
        </button>`).join('')}
      <button data-addpl="__new__">
        <span class="ml-ico">${icon('plus')}</span>
        <span><span class="ml-name">Nova playlist</span><br><span class="ml-sub">Criar uma agora</span></span>
      </button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-soft btn-sm" data-modal="cancel">Fechar</button>
    </div>`);

  const card = $('#modal-card');
  card.querySelector('[data-modal="cancel"]').onclick = closeModal;
  for (const btn of card.querySelectorAll('[data-addpl]')) {
    btn.onclick = async () => {
      let playlistId = btn.dataset.addpl;
      if (playlistId === '__new__') {
        const created = await createPlaylist();
        if (!created) return;
        playlistId = created.id;
      }
      try {
        const added = await playlists.addTrack(playlistId, track);
        closeModal();
        renderPlaylistNav();
        toast(added === false ? 'A música já está nesta playlist' : 'Adicionada à playlist', { type: 'ok' });
        if (parseRoute().path === `/playlist/${playlistId}`) navigate();
      } catch {
        toast('Não foi possível adicionar', { type: 'err' });
      }
    };
  }
}

function openTrackMenu(track) {
  openModal(`
    <h3>${esc(track.title)}</h3>
    <p class="m-sub">${esc(track.artist)}</p>
    <div class="modal-list">
      <button data-menu="play"><span class="ml-ico">${icon('play')}</span><span class="ml-name">Tocar agora</span></button>
      <button data-menu="next"><span class="ml-ico">${icon('next')}</span><span class="ml-name">Tocar a seguir</span></button>
      <button data-menu="queue"><span class="ml-ico">${icon('queue')}</span><span class="ml-name">Adicionar à fila</span></button>
      <button data-menu="playlist"><span class="ml-ico">${icon('plus')}</span><span class="ml-name">Adicionar à playlist</span></button>
      <button data-menu="like"><span class="ml-ico">${icon('heart')}</span><span class="ml-name">Curtir / remover curtida</span></button>
      <button data-menu="download"><span class="ml-ico">${icon('download')}</span><span class="ml-name">Baixar para ouvir offline</span></button>
      ${track.artistId ? `<button data-menu="artist"><span class="ml-ico">${icon('user')}</span><span class="ml-name">Ver artista</span></button>` : ''}
      <button data-menu="share"><span class="ml-ico">${icon('share')}</span><span class="ml-name">Copiar link da música</span></button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-soft btn-sm" data-modal="cancel">Fechar</button>
    </div>`);

  const card = $('#modal-card');
  card.querySelector('[data-modal="cancel"]').onclick = closeModal;
  card.querySelectorAll('[data-menu]').forEach((btn) => {
    btn.onclick = () => {
      const action = btn.dataset.menu;
      closeModal();
      switch (action) {
        case 'play': player.playTrack(track, viewEl._context || null); break;
        case 'next': player.playNextInQueue(track); toast('Tocará a seguir', { type: 'ok' }); break;
        case 'queue': player.enqueue([track]); toast('Adicionada à fila', { type: 'ok' }); break;
        case 'playlist': openAddToPlaylist(track); break;
        case 'like': handleLike(track.id); break;
        case 'download': handleDownload(track.id); break;
        case 'artist': if (track.artistId) location.hash = `#/artist/${track.artistId}`; break;
        case 'share': shareTrack(track); break;
        default: break;
      }
    };
  });
}

async function shareTrack(track) {
  if (!track) return;
  const url = api.audiusUrlFor(track);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copiado', { type: 'ok' });
  } catch {
    window.prompt('Copie o link:', url);
  }
}

/* ==================================================================
   Barra do player + player completo
================================================================== */
function updatePlayerBar() {
  const track = player.current;
  const bar = $('#playerbar');
  bar.dataset.state = track ? 'active' : 'idle';

  const likeBtn = $('#pb-like');
  const dlBtn = $('#pb-dl');
  const fpLike = $('#fp-like');
  const fpDl = $('#fp-dl');

  if (!track) return;

  $('#pb-title').textContent = track.title;
  $('#pb-title').href = track.artistId ? `#/artist/${track.artistId}` : '#/';
  $('#pb-artist').textContent = track.artist;

  const artImg = $('#pb-art-img');
  if (track.art) { artImg.src = track.art; artImg.hidden = false; }
  else { artImg.removeAttribute('src'); artImg.hidden = true; }

  for (const btn of [likeBtn, dlBtn, fpLike, fpDl]) {
    btn.disabled = false;
    btn.dataset.id = track.id;
    btn.dataset.like = track.id;
    btn.dataset.dl = track.id;
  }
  likeBtn.classList.add('keep-big');
  fpLike.classList.add('keep-big');

  $('#fp-title').textContent = track.title;
  const artistLink = $('#fp-artist');
  artistLink.textContent = track.artist;
  artistLink.href = track.artistId ? `#/artist/${track.artistId}` : '#/';

  const fpArt = $('#fp-art-img');
  if (track.artBig || track.art) {
    fpArt.src = track.artBig || track.art;
    fpArt.hidden = false;
    $('#fp-bg').style.backgroundImage = track.art ? `url("${track.art}")` : '';
  } else {
    fpArt.removeAttribute('src');
    fpArt.hidden = true;
    $('#fp-bg').style.backgroundImage = '';
  }

  const chips = [];
  if (track.genre) chips.push(track.genre);
  if (track.bpm) chips.push(`${Math.round(track.bpm)} BPM`);
  if (track.musicalKey) chips.push(track.musicalKey);
  if (track.release) chips.push(String(track.release).slice(0, 4));
  if (track.plays) chips.push(`${Number(track.plays).toLocaleString('pt-BR')} plays`);
  $('#fp-chips').innerHTML = chips.map((c) => `<span>${esc(c)}</span>`).join('');

  hydrateTrackStates(document);
}

function updateControls() {
  const buffering = player.buffering;
  const playing = player.playing;
  const glyph = buffering ? 'refresh' : playing ? 'pause' : 'play';

  for (const btn of [$('#pb-play'), $('#fp-play')]) {
    btn.innerHTML = icon(glyph);
    btn.setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
  }

  for (const btn of [$('#pb-shuffle'), $('#fp-shuffle')]) btn.classList.toggle('on', player.shuffle);

  const repeatGlyph = player.repeat === 'one' ? 'repeat-one' : 'repeat';
  for (const btn of [$('#pb-repeat'), $('#fp-repeat')]) {
    btn.innerHTML = icon(repeatGlyph);
    btn.classList.toggle('on', player.repeat !== 'off');
    btn.title = player.repeat === 'off' ? 'Repetir desligado'
      : player.repeat === 'all' ? 'Repetir fila' : 'Repetir esta música';
  }

  syncPlayingRows(player.current?.id, playing);
}

function updateTime() {
  const current = audioEl.currentTime || 0;
  const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : (player.current?.duration || 0);
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  $('#pb-cur').textContent = fmtTime(current);
  $('#pb-dur').textContent = fmtTime(duration);
  $('#fp-cur').textContent = fmtTime(current);
  $('#fp-dur').textContent = fmtTime(duration);

  for (const slider of [$('#pb-range'), $('#fp-range')]) {
    if (document.activeElement === slider && slider.matches(':active')) continue;
    slider.value = String(Math.round(pct * 10));
    slider.style.setProperty('--fill', pct.toFixed(2));
  }
}

function updateVolume() {
  const volume = player.muted ? 0 : player.volume;
  const pct = Math.round(volume * 100);
  for (const slider of [$('#pb-vol'), $('#fp-vol')]) {
    slider.value = String(pct);
    slider.style.setProperty('--fill', String(pct));
  }
  const glyph = player.muted || volume === 0 ? 'volume-off' : 'volume';
  $('#pb-vol-icon').innerHTML = icon(glyph);
}

function updateFullPlayer() {
  const art = document.querySelector('.fp-art');
  art?.classList.toggle('playing-art', player.playing);
}

/* ==================================================================
   Fila
================================================================== */
function renderQueue() {
  const host = $('#queue-list');
  const count = player.queue.length;
  $('#queue-count').textContent = `${count} música${count === 1 ? '' : 's'}`;

  if (!count) {
    host.innerHTML = `
      <div class="empty" style="padding:34px 14px">
        <div class="e-ico">${icon('queue')}</div>
        <h3>Fila vazia</h3>
        <p>Adicione músicas com o botão “+” ou tocando em qualquer faixa.</p>
      </div>`;
    return;
  }

  host.innerHTML = player.queue.map((t, i) => {
    const isCurrent = i === player.index;
    return `
      <div class="qitem ${isCurrent ? 'current' : ''}" data-action="queue-play" data-qidx="${i}" role="button" tabindex="0">
        ${t.art
          ? `<img src="${esc(t.art)}" alt="" loading="lazy">`
          : `<div style="width:38px;height:38px;border-radius:6px;display:grid;place-items:center;background:var(--surface-3);color:var(--dim)">${icon('disc', 'ic ic-sm')}</div>`}
        <div style="min-width:0">
          <div class="qt">${esc(t.title)}</div>
          <div class="qs">${esc(t.artist)}</div>
        </div>
        <div class="qa">
          ${isCurrent ? `<span class="eq" style="padding-right:6px"><i></i><i></i><i></i></span>` : ''}
          <button class="icon-btn" data-action="queue-remove" data-qidx="${i}" title="Remover da fila" aria-label="Remover">${icon('x', 'ic ic-sm')}</button>
        </div>
      </div>`;
  }).join('');

  const current = host.querySelector('.qitem.current');
  if (player.playing && current) current.scrollIntoView({ block: 'nearest' });
}

function toggleQueue(force) {
  const panel = $('#queuepanel');
  const open = typeof force === 'boolean' ? force : panel.hidden;
  panel.hidden = !open;
  if (open) renderQueue();
}

function openFullPlayer() {
  if (!player.current) { toast('Escolha uma música para começar', { type: 'info' }); return; }
  $('#fullplayer').hidden = false;
  updateFullPlayer();
}

function closeFullPlayer() { $('#fullplayer').hidden = true; }

/* ==================================================================
   Índices / rodapé
================================================================== */
async function refreshBadges() {
  try {
    const [likedCount, dlCount] = await Promise.all([likes.count(), downloads.count()]);
    $('#badge-liked').textContent = likedCount ? String(likedCount) : '';
    $('#badge-downloads').textContent = dlCount ? String(dlCount) : '';
  } catch { /* ignore */ }
}

async function updateStorageFoot() {
  try {
    const info = await storageInfo();
    $('#storage-text').textContent = info.quota
      ? `${fmtBytes(info.usage)} / ${fmtBytes(info.quota)}`
      : fmtBytes(info.usage);
    $('#storage-bar').style.width = `${Math.max(1, info.pct).toFixed(1)}%`;
  } catch { /* ignore */ }
}

/* ==================================================================
   Busca no topbar
================================================================== */
let searchTimer = null;

function runTopbarSearch(term) {
  const { path } = parseRoute();
  const trimmed = term.trim();
  if (path !== '/search') {
    location.hash = trimmed ? `#/search?q=${encodeURIComponent(trimmed)}` : '#/search';
    return;
  }
  history.replaceState(null, '', location.pathname + location.search + `#/search${trimmed ? '?q=' + encodeURIComponent(trimmed) : ''}`);
  views.searchUpdate(trimmed);
}

function wireSearch() {
  searchInput.addEventListener('input', () => {
    const term = searchInput.value;
    searchClear.hidden = !term;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runTopbarSearch(term), 350);
  });

  $('#searchbox').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    runTopbarSearch(searchInput.value);
    searchInput.blur();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    searchInput.focus();
    clearTimeout(searchTimer);
    runTopbarSearch('');
  });
}

/* ==================================================================
   Ações delegadas
================================================================== */
document.addEventListener('click', async (e) => {
  if (e.target.id === 'modal') { closeModal(); return; }

  const trigger = e.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;
  const id = trigger.dataset.id;

  e.preventDefault();
  e.stopPropagation();

  try {
    switch (action) {
      /* ---- reprodução ---- */
      case 'play': {
        const track = await findTrack(id);
        if (!track) { toast('Música indisponível', { type: 'err' }); return; }
        if (player.current && String(player.current.id) === String(track.id)) {
          player.toggle();
          return;
        }
        const ctxEl = trigger.closest('[data-ctx]');
        let context = ctxEl ? getCollection(ctxEl.dataset.ctx) : null;
        if (!context?.length) context = viewEl._context || null;
        if (context && !context.some((t) => String(t.id) === String(track.id))) context = null;
        await player.playTrack(track, context);
        break;
      }
      case 'play-collection': {
        const tracks = getCollection(trigger.dataset.key);
        if (!tracks.length) { toast('Nada para tocar aqui', { type: 'info' }); return; }
        await player.playQueue(tracks, 0);
        break;
      }
      case 'shuffle-collection': {
        const tracks = getCollection(trigger.dataset.key);
        if (!tracks.length) return;
        const start = Math.floor(Math.random() * tracks.length);
        if (!player.shuffle) player.toggleShuffle();
        await player.playQueue(tracks, start);
        break;
      }
      case 'enqueue-collection': {
        const tracks = getCollection(trigger.dataset.key);
        if (!tracks.length) return;
        const added = player.enqueue(tracks);
        toast(added ? `${added} música${added === 1 ? '' : 's'} na fila` : 'Já está na fila', { type: 'ok' });
        break;
      }
      case 'resume-session': resumeSession(Number(trigger.dataset.time) || 0); break;
      case 'toggle': player.toggle(); break;
      case 'next': player.next(); break;
      case 'prev': player.prev(); break;
      case 'shuffle': player.toggleShuffle(); break;
      case 'repeat': player.cycleRepeat(); break;
      case 'mute': player.toggleMute(); break;

      /* ---- fila ---- */
      case 'toggle-queue': toggleQueue(); break;
      case 'queue-clear': player.clearQueue(); toast('Fila limpa', { type: 'info' }); break;
      case 'queue-play': player.jumpTo(Number(trigger.dataset.qidx)); break;
      case 'queue-remove': player.removeFromQueue(Number(trigger.dataset.qidx)); break;

      /* ---- player completo ---- */
      case 'open-full': openFullPlayer(); break;
      case 'close-full': closeFullPlayer(); break;
      case 'enqueue-current':
        if (player.current) { player.playNextInQueue(player.current); toast('Tocará a seguir', { type: 'ok' }); }
        break;
      case 'share-current': shareTrack(player.current); break;

      /* ---- curtir / baixar ---- */
      case 'like': handleLike(id); break;
      case 'like-current': if (player.current) handleLike(player.current.id); break;
      case 'download': handleDownload(id); break;
      case 'download-current': if (player.current) handleDownload(player.current.id); break;
      case 'save-file': saveFileToDisk(id); break;
      case 'track-menu': { const t = await findTrack(id); if (t) openTrackMenu(t); break; }

      /* ---- playlists ---- */
      case 'new-playlist': createPlaylist(); break;
      case 'playlist-rename': {
        const current = await playlists.get(trigger.dataset.pl);
        if (!current) return;
        const name = await promptDialog({ title: 'Renomear playlist', label: 'Novo nome', value: current.name, okLabel: 'Salvar' });
        if (name) { await playlists.rename(current.id, name); toast('Playlist renomeada', { type: 'ok' }); renderPlaylistNav(); navigate(); }
        break;
      }
      case 'playlist-delete': {
        const playlistId = trigger.dataset.pl;
        const ok = await confirmDialog({ title: 'Excluir playlist?', text: 'As músicas continuam salvas no app, apenas a lista é removida.', okLabel: 'Excluir', danger: true });
        if (!ok) return;
        await playlists.remove(playlistId);
        toast('Playlist excluída', { type: 'info' });
        renderPlaylistNav();
        location.hash = '#/library';
        break;
      }
      case 'playlist-remove-track': {
        await playlists.removeTrack(trigger.dataset.pl, id);
        toast('Removida da playlist', { type: 'info' });
        renderPlaylistNav();
        navigate();
        break;
      }

      /* ---- busca ---- */
      case 'search-term': {
        searchInput.value = trigger.dataset.term || '';
        searchClear.hidden = !searchInput.value;
        runTopbarSearch(searchInput.value);
        break;
      }
      case 'search-tab': {
        views.searchStateTab(trigger.dataset.tab);
        break;
      }
      case 'clear-searches':
        prefs.remove('searches');
        views.searchRedrawBrowse();
        toast('Histórico de busca limpo', { type: 'info' });
        break;

      /* ---- limpezas ---- */
      case 'clear-likes': {
        const ok = await confirmDialog({ title: 'Limpar curtidas?', text: 'Todas as músicas marcadas com coração serão removidas desta lista.', okLabel: 'Limpar', danger: true });
        if (!ok) return;
        await likes.clear();
        refreshBadges();
        navigate();
        break;
      }
      case 'clear-downloads': {
        const ok = await confirmDialog({ title: 'Remover todos os downloads?', text: 'Você precisará de internet para ouvir essas músicas de novo.', okLabel: 'Remover todos', danger: true });
        if (!ok) return;
        await downloads.clear();
        refreshBadges();
        updateStorageFoot();
        navigate();
        toast('Downloads removidos', { type: 'info' });
        break;
      }
      case 'clear-recents': {
        const ok = await confirmDialog({ title: 'Limpar histórico?', text: 'Suas músicas recentes serão esquecidas neste dispositivo.', okLabel: 'Limpar', danger: true });
        if (!ok) return;
        await recents.clear();
        navigate();
        break;
      }

      /* ---- navegação ---- */
      case 'back': history.length > 1 ? history.back() : (location.hash = '#/'); break;
      case 'retry-view': navigate(); break;
      case 'reload-app': location.reload(); break;
      default: break;
    }
  } catch (err) {
    console.error('[ação]', action, err);
    toast('Algo deu errado ao executar esta ação', { type: 'err' });
  }
});

/** Replay de uma linha/card por teclado */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.matches('input, textarea, button, a')) return;
  if (el.matches('[data-action][tabindex="0"]')) {
    e.preventDefault();
    el.click();
  }
});

/** Menu de contexto (botão direito) nas faixas */
document.addEventListener('contextmenu', async (e) => {
  const row = e.target.closest('[data-track]');
  if (!row) return;
  e.preventDefault();
  const track = await findTrack(row.dataset.track);
  if (track) openTrackMenu(track);
});

/* ==================================================================
   Retomar sessão
================================================================== */
function resumeSession(time) {
  const session = player.session;
  if (!session?.track) { toast('Nada para retomar', { type: 'info' }); return; }
  player.playTrack(session.track).then(() => {
    if (!time) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const ready = audioEl.readyState >= 1;
      if (ready || tries > 60) {
        clearInterval(timer);
        if (ready) {
          try {
            const target = Math.max(0, Math.min(time, (audioEl.duration || time) - 2));
            audioEl.currentTime = target;
          } catch { /* ignora */ }
        }
      }
    }, 150);
  });
}

/* ==================================================================
   Eventos do player
================================================================== */
function wirePlayerEvents() {
  player.on('change', updatePlayerBar);
  player.on('state', () => { updateControls(); updateVolume(); updateFullPlayer(); if (!$('#queuepanel').hidden) renderQueue(); });
  player.on('time', () => { updateTime(); });
  player.on('volume', updateVolume);
  player.on('queue', () => { if (!$('#queuepanel').hidden) renderQueue(); });
  player.on('error', ({ message, offline }) => {
    toast(message || 'Falha na reprodução', { type: 'err' });
    if (offline) {
      toast('Dica: baixe músicas para ouvir sem internet', {
        type: 'info',
        timeout: 6000,
        action: { label: 'Ver downloads', onClick: () => { location.hash = '#/downloads'; } },
      });
    }
  });
  player.on('started', () => {
    updatePlayerBar();
    updateControls();
    updateFullPlayer();
    refreshBadges();
  });

  /* sliders */
  for (const slider of [$('#pb-range'), $('#fp-range')]) {
    slider.addEventListener('input', () => {
      const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
      const target = (Number(slider.value) / 1000) * duration;
      if (duration) player.seek(target);
      slider.style.setProperty('--fill', String(Number(slider.value) / 10));
    });
  }
  for (const slider of [$('#pb-vol'), $('#fp-vol')]) {
    slider.addEventListener('input', () => player.setVolume(Number(slider.value) / 100));
  }

  updateTime();
  updateVolume();
  updateControls();
}

/* ==================================================================
   Atalhos de teclado
================================================================== */
function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLElement
      && e.target.matches('input, textarea, select, [contenteditable="true"]');

    if (e.key === 'Escape') {
      if (!$('#modal').hidden) { closeModal(); return; }
      if (!$('#fullplayer').hidden) { closeFullPlayer(); return; }
      if (!$('#queuepanel').hidden) { toggleQueue(false); return; }
      return;
    }
    if (typing) return;

    switch (e.key) {
      case ' ': e.preventDefault(); player.toggle(); break;
      case 'ArrowRight': e.preventDefault(); e.shiftKey ? player.next() : player.seekBy(5); break;
      case 'ArrowLeft': e.preventDefault(); e.shiftKey ? player.prev() : player.seekBy(-5); break;
      case 'ArrowUp': e.preventDefault(); player.setVolume((player.muted ? 0 : player.volume) + 0.05); break;
      case 'ArrowDown': e.preventDefault(); player.setVolume((player.muted ? 0 : player.volume) - 0.05); break;
      case 'm': case 'M': player.toggleMute(); break;
      case 's': case 'S': player.toggleShuffle(); break;
      case 'r': case 'R': player.cycleRepeat(); break;
      case 'q': case 'Q': toggleQueue(); break;
      case 'f': case 'F': $('#fullplayer').hidden ? openFullPlayer() : closeFullPlayer(); break;
      case '/': e.preventDefault(); focusSearch(); break;
      default: break;
    }
  });
}

function focusSearch() {
  if (parseRoute().path !== '/search') location.hash = '#/search';
  setTimeout(() => { searchInput.focus(); searchInput.select(); }, 60);
}

/* ==================================================================
   Conexão, instalação e Service Worker
================================================================== */
function updateNetPill() {
  const pill = $('#net-pill');
  const online = navigator.onLine !== false;
  pill.hidden = online;
  pill.classList.toggle('online', online);
  pill.querySelector('span').textContent = 'Sem conexão';
}

function wireConnectivity() {
  window.addEventListener('offline', () => {
    updateNetPill();
    toast('Você ficou offline — downloads continuam disponíveis', { type: 'info' });
  });
  window.addEventListener('online', () => {
    updateNetPill();
    toast('Conexão restabelecida', { type: 'ok' });
  });
}

function wireInstallPrompt() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('#install-btn').hidden = false;
  });
  $('#install-btn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') toast('Instalando o Sonora…', { type: 'ok' });
    } catch { /* ignore */ }
    deferred = null;
    $('#install-btn').hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    $('#install-btn').hidden = true;
    toast('Sonora instalado com sucesso', { type: 'ok' });
  });
}

function wireServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          $('#update-bar').hidden = false;
        }
      });
    });
  }).catch((err) => console.warn('[sw]', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/* ==================================================================
   Inicialização
================================================================== */
async function init() {
  wirePlayerEvents();
  wireSearch();
  wireKeyboard();
  wireConnectivity();
  wireInstallPrompt();
  wireServiceWorker();
  bindMediaSessionActions();

  player.init();
  updatePlayerBar();
  updateControls();
  updateVolume();
  renderQueue();

  renderPlaylistNav();
  refreshBadges();
  updateStorageFoot();
  updateNetPill();

  if (!location.hash) location.replace('#/');
  await navigate();

  requestPersistentStorage().then((granted) => {
    if (granted) console.info('[sonora] armazenamento persistente concedido');
  });
}

init();
