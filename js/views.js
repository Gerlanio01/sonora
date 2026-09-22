// Telas do aplicativo (rota -> render)
import * as api from './api.js';
import { likes, downloads, recents, playlists, prefs, storageInfo } from './db.js';
import { player } from './player.js';
import { GENRES } from './config.js';
import {
  esc, icon, fmtTime, fmtNum, fmtBytes, fmtDate, greeting,
  setCollection, getCollection, toast, confirmDialog, promptDialog,
  skeletonCards, skeletonRows, emptyState, errorState,
  trackList, horizontalCards, artistCard, playlistCard, recentChip,
  sectionHead, hydrateTrackStates, syncPlayingRows, closeModal,
} from './ui.js';

/* ==================================================================
   INÍCIO
================================================================== */
export async function home(container) {
  container._context = null;
  container.innerHTML = `
    <div class="view-skeleton">
      <div class="sk sk-hero"></div>
      ${skeletonCards(4)}
      ${skeletonRows(5)}
    </div>`;

  const [trend, under, pls, recent] = await Promise.allSettled([
    api.trending({ limit: 16 }),
    api.underground({ limit: 12 }),
    api.playlistsTrending({ limit: 10 }),
    recents.list(6),
  ]);

  const trending = trend.status === 'fulfilled' ? trend.value : [];
  const underground = under.status === 'fulfilled' ? under.value : [];
  const playlistList = pls.status === 'fulfilled' ? pls.value : [];
  const recentList = recent.status === 'fulfilled' ? recent.value : [];

  const offline = navigator.onLine === false;
  if (!trending.length && !underground.length && (offline || trend.status === 'rejected')) {
    container.innerHTML = offline
      ? emptyState({
          glyph: 'wifi-off',
          title: 'Você está offline',
          text: 'Suas músicas baixadas continuam disponíveis. Conecte-se para descobrir novidades.',
          btn: `<a class="btn btn-primary btn-sm" href="#/downloads">${icon('download', 'ic ic-sm')} Ver downloads</a>`,
        })
      : errorState('A rede da Audius não respondeu. Tente novamente em alguns segundos.');
    return;
  }

  setCollection('trending', trending);
  setCollection('underground', underground);
  playlistList.forEach((p) => setCollection('pl:' + p.id, p.tracks));

  const resume = player.restoreSession();
  const resumeHtml = resume ? `
    <section class="section" data-ctx="resume-none">
      ${sectionHead('Continuar ouvindo')}
      <div class="recent-grid">
        <div class="recent-chip" data-action="resume-session" data-time="${Number(resume.time) || 0}" role="button" tabindex="0">
          ${resume.track.art
            ? `<img src="${esc(resume.track.art)}" alt="" loading="lazy">`
            : `<div style="width:54px;height:54px;display:grid;place-items:center;background:var(--surface-3);color:var(--dim)">${icon('disc')}</div>`}
          <div class="rc-meta">
            <div class="rc-t">${esc(resume.track.title)}</div>
            <div class="rc-s">${esc(resume.track.artist)} · para em ${fmtTime(resume.time)}</div>
          </div>
          <span class="icon-btn rc-play" style="opacity:1">${icon('play', 'ic ic-sm')}</span>
        </div>
      </div>
    </section>` : '';

  const sections = [
    resumeHtml,
    offline ? `
      <div class="notice" style="margin-bottom:26px">
        ${icon('wifi-off')}
        <div><b>Você está offline.</b> Mostrando o último conteúdo salvo — as músicas baixadas continuam tocando normalmente.</div>
      </div>` : '',
    trending.length ? `
      <section class="section" data-ctx="trending">
        ${sectionHead('Em alta', {
          sub: 'As mais tocadas agora',
          action: `<button class="btn btn-ghost btn-sm" data-action="play-collection" data-key="trending">${icon('play', 'ic ic-sm')} Ouvir tudo</button>`,
        })}
        ${horizontalCards(trending)}
      </section>` : '',
    underground.length ? `
      <section class="section" data-ctx="underground">
        ${sectionHead('Underground', {
          sub: 'Achados que ainda estão por vir',
          action: `<button class="btn btn-ghost btn-sm" data-action="play-collection" data-key="underground">${icon('play', 'ic ic-sm')} Ouvir tudo</button>`,
        })}
        ${horizontalCards(underground)}
      </section>` : '',
    playlistList.length ? `
      <section class="section" data-ctx-none>
        ${sectionHead('Playlists em alta', { sub: 'Curadoria da comunidade' })}
        <div class="hscroll">${playlistList.map(playlistCard).join('')}</div>
      </section>` : '',
    recentList.length ? `
      <section class="section" data-ctx="recent-home">
        ${sectionHead('Tocadas recentemente', {
          action: `<a class="link-more" href="#/recent">Ver todas</a>`,
        })}
        <div class="recent-grid">${recentList.map(recentChip).join('')}</div>
      </section>` : '',
  ].filter(Boolean);

  setCollection('recent-home', recentList);

  container.innerHTML = `
    <section class="hero">
      <h1>${greeting()}</h1>
      <p>Milhares de músicas gratuitas para ouvir agora — e baixar para funcionar sem internet.</p>
      <div class="hero-actions">
        ${trending.length ? `<button class="btn btn-primary" data-action="play-collection" data-key="trending">${icon('play', 'ic ic-sm')} Ouvir em alta</button>` : ''}
        <a class="btn btn-ghost" href="#/search">${icon('search', 'ic ic-sm')} Buscar algo</a>
        <a class="btn btn-soft" href="#/downloads">${icon('download', 'ic ic-sm')} Meus downloads</a>
      </div>
    </section>

    <div class="chips">
      ${GENRES.map((g) => `<a class="chip" href="#/search?q=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
    </div>

    ${sections.join('')}
  `;

  hydrateTrackStates(container);
  syncPlayingRows(player.current?.id, player.playing);
}

/* ==================================================================
   BUSCA
================================================================== */
const searchState = { term: '', tab: 'tracks', results: { tracks: [], users: [], playlists: [] }, container: null };

export async function search(container, params) {
  const term = (params.get('q') || '').trim();
  searchState.container = container;
  container._context = null;
  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Buscar</h1>
        <p class="sub">Músicas, artistas e playlists — catálogo aberto da Audius</p>
      </div>
    </div>
    <div id="search-body"></div>`;

  if (!term) {
    renderBrowse(container);
    return;
  }
  const input = document.getElementById('search-input');
  if (input && input.value !== term) input.value = term;
  await runSearch(container, term, searchState.tab);
}

function renderBrowse(container) {
  const body = document.getElementById('search-body');
  if (!body) return;
  searchState.term = '';
  const recentTerms = prefs.get('searches', []);
  const trending = getCollection('trending');

  body.innerHTML = `
    ${recentTerms.length ? `
      <section class="section">
        ${sectionHead('Buscas recentes', {
          action: `<button class="link-more" data-action="clear-searches">Limpar</button>`,
        })}
        <div class="chips">
          ${recentTerms.map((t) => `<button class="chip" data-action="search-term" data-term="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
      </section>` : ''}

    <section class="section">
      ${sectionHead('Navegar por gênero')}
      <div class="chips">
        ${GENRES.map((g) => `<a class="chip" href="#/search?q=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
      </div>
    </section>

    ${trending.length ? `
      <section class="section" data-ctx="trending">
        ${sectionHead('Comece por aqui', {
          action: `<button class="btn btn-ghost btn-sm" data-action="play-collection" data-key="trending">${icon('play', 'ic ic-sm')} Ouvir tudo</button>`,
        })}
        ${horizontalCards(trending)}
      </section>` : skeletonCards(6)}
  `;
  hydrateTrackStates(body);
  syncPlayingRows(player.current?.id, player.playing);
}

export async function searchUpdate(term) {
  const container = searchState.container;
  if (!container || !container.isConnected) return;
  const q = String(term || '').trim();
  if (!q) {
    renderBrowse(container);
    return;
  }
  saveSearchTerm(q);
  await runSearch(container, q, searchState.tab);
}

function saveSearchTerm(term) {
  const list = prefs.get('searches', []).filter((t) => t.toLowerCase() !== term.toLowerCase());
  list.unshift(term);
  prefs.set('searches', list.slice(0, 8));
}

export function searchStateTab(tab) {
  if (!tab || searchState.tab === tab) return;
  searchState.tab = tab;
  renderSearchResults();
}

export function searchRedrawBrowse() {
  const container = searchState.container;
  if (container?.isConnected) renderBrowse(container);
}

async function runSearch(container, term, tab = 'tracks') {
  searchState.term = term;
  searchState.tab = tab;
  const body = document.getElementById('search-body');
  if (!body) return;
  body.innerHTML = `
    <div class="segmented">${tabsHtml(tab)}</div>
    ${skeletonRows(6)}`;

  const [tracks, users, playlistsRes] = await Promise.allSettled([
    api.searchTracks(term, { limit: 30 }),
    api.searchUsers(term, { limit: 12 }),
    api.searchPlaylists(term, { limit: 12 }),
  ]);

  if (searchState.term !== term || !body.isConnected) return;   // resposta antiga

  searchState.results = {
    tracks: tracks.status === 'fulfilled' ? tracks.value : [],
    users: users.status === 'fulfilled' ? users.value : [],
    playlists: playlistsRes.status === 'fulfilled' ? playlistsRes.value : [],
  };
  searchState.results.playlists.forEach((p) => setCollection('pl:' + p.id, p.tracks));
  renderSearchResults();
}

function tabsHtml(tab) {
  const counts = {
    tracks: searchState.results.tracks.length,
    users: searchState.results.users.length,
    playlists: searchState.results.playlists.length,
  };
  const items = [
    ['tracks', 'Músicas'],
    ['users', 'Artistas'],
    ['playlists', 'Playlists'],
  ];
  return items.map(([key, label]) => `
    <button class="${tab === key ? 'active' : ''}" data-action="search-tab" data-tab="${key}">
      ${label}${counts[key] ? ` (${counts[key]})` : ''}
    </button>`).join('');
}

function renderSearchResults() {
  const container = searchState.container;
  if (!container?.isConnected) return;
  const body = document.getElementById('search-body');
  if (!body) return;
  const { tracks, users, playlists: pls } = searchState.results;
  const total = tracks.length + users.length + pls.length;
  const offline = navigator.onLine === false;

  let content = '';
  if (!total) {
    content = offline
      ? emptyState({ glyph: 'wifi-off', title: 'Sem conexão', text: 'A busca precisa de internet. Suas músicas baixadas estão em Downloads.' })
      : emptyState({
          glyph: 'search',
          title: `Nada encontrado para “${searchState.term}”`,
          text: 'Tente outro artista, gênero ou letra.',
        });
  } else if (searchState.tab === 'users') {
    content = users.length
      ? `<div class="grid-cards">${users.map(artistCard).join('')}</div>`
      : emptyState({ glyph: 'user', title: 'Nenhum artista encontrado' });
  } else if (searchState.tab === 'playlists') {
    content = pls.length
      ? `<div class="grid-cards">${pls.map(playlistCard).join('')}</div>`
      : emptyState({ glyph: 'music', title: 'Nenhuma playlist encontrada' });
  } else {
    content = tracks.length
      ? `
        <div class="page-actions" style="margin-bottom:14px;justify-content:flex-start;margin-left:0">
          <button class="btn btn-primary btn-sm" data-action="play-collection" data-key="search:${esc(searchState.term)}">${icon('play', 'ic ic-sm')} Ouvir resultado</button>
          <button class="btn btn-ghost btn-sm" data-action="shuffle-collection" data-key="search:${esc(searchState.term)}">${icon('shuffle', 'ic ic-sm')} Aleatório</button>
          <button class="btn btn-soft btn-sm" data-action="enqueue-collection" data-key="search:${esc(searchState.term)}">${icon('plus', 'ic ic-sm')} Fila</button>
        </div>
        <div data-ctx="search:${esc(searchState.term)}">${trackList(tracks)}</div>`
      : emptyState({ glyph: 'music', title: 'Nenhuma música encontrada' });
  }

  setCollection('search:' + searchState.term, tracks);
  body.innerHTML = `<div class="segmented">${tabsHtml(searchState.tab)}</div>${content}`;
  container._context = tracks;
  hydrateTrackStates(body);
  syncPlayingRows(player.current?.id, player.playing);
}

/* ==================================================================
   BIBLIOTECA
================================================================== */
export async function library(container) {
  container._context = null;
  container.innerHTML = skeletonCards(4);

  const [liked, dl, recentList, plList] = await Promise.allSettled([
    likes.list(), downloads.list(), recents.list(8), playlists.list(),
  ]);
  const likedTracks = liked.status === 'fulfilled' ? liked.value : [];
  const dlRecords = dl.status === 'fulfilled' ? dl.value : [];
  const recentTracks = recentList.status === 'fulfilled' ? recentList.value : [];
  const myPlaylists = plList.status === 'fulfilled' ? plList.value : [];

  const quickCard = ({ href, glyph, title, sub }) => `
    <a class="card" href="${href}">
      <div class="card-art" style="background:var(--grad);display:grid;place-items:center;color:#fff">
        <span style="display:grid;place-items:center">${icon(glyph, 'ic')}</span>
      </div>
      <div class="card-title">${esc(title)}</div>
      <div class="card-sub">${esc(sub)}</div>
    </a>`;

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Sua biblioteca</h1>
        <p class="sub">${likedTracks.length} curtidas · ${dlRecords.length} downloads · ${myPlaylists.length} playlists</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary btn-sm" data-action="new-playlist">${icon('plus', 'ic ic-sm')} Nova playlist</button>
      </div>
    </div>

    <section class="section">
      <div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">
        ${quickCard({ href: '#/liked', glyph: 'heart-fill', title: 'Curtidas', sub: `${likedTracks.length} músicas` })}
        ${quickCard({ href: '#/downloads', glyph: 'download', title: 'Downloads', sub: `${dlRecords.length} disponíveis offline` })}
        ${quickCard({ href: '#/recent', glyph: 'clock', title: 'Recentes', sub: `${recentTracks.length} tocadas por aqui` })}
      </div>
    </section>

    <section class="section">
      ${sectionHead('Playlists', {
        action: `<button class="link-more" data-action="new-playlist">+ Nova playlist</button>`,
      })}
      ${myPlaylists.length
        ? `<div class="grid-cards">${myPlaylists.map((p) => playlistCard({
            id: p.id, name: p.name, owner: 'Você', art: p.tracks[0]?.art || null,
            trackCount: p.tracks.length, tracks: p.tracks,
          })).join('')}</div>`
        : emptyState({
            glyph: 'music',
            title: 'Crie sua primeira playlist',
            text: 'Agrupe as músicas que você gosta e ouça na ordem que quiser.',
            btn: `<button class="btn btn-primary btn-sm" data-action="new-playlist">${icon('plus', 'ic ic-sm')} Criar playlist</button>`,
          })}
    </section>

    ${recentTracks.length ? `
      <section class="section" data-ctx="recent-home">
        ${sectionHead('Recentes', { action: `<a class="link-more" href="#/recent">Ver tudo</a>` })}
        <div class="recent-grid">${recentTracks.slice(0, 6).map(recentChip).join('')}</div>
      </section>` : ''}
  `;
  setCollection('recent-home', recentTracks);
  syncPlayingRows(player.current?.id, player.playing);
}

/* ==================================================================
   CURTIDAS
================================================================== */
export async function liked(container) {
  container.innerHTML = skeletonRows(6);
  const tracks = await likes.list();
  container._context = tracks;

  const totalSec = tracks.reduce((s, t) => s + (t.duration || 0), 0);

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Curtidas</h1>
        <p class="sub">${tracks.length} música${tracks.length === 1 ? '' : 's'}${tracks.length ? ` · ${fmtTime(totalSec)} no total` : ''}</p>
      </div>
      <div class="page-actions">
        ${tracks.length ? `
          <button class="btn btn-primary btn-sm" data-action="play-view">${icon('play', 'ic ic-sm')} Ouvir</button>
          <button class="btn btn-ghost btn-sm" data-action="shuffle-view">${icon('shuffle', 'ic ic-sm')} Aleatório</button>
          <button class="btn btn-soft btn-sm" data-action="clear-likes">${icon('trash', 'ic ic-sm')} Limpar</button>` : ''}
      </div>
    </div>
    ${tracks.length
      ? `<div data-ctx-view>${trackList(tracks)}</div>`
      : emptyState({
          glyph: 'heart',
          title: 'Nenhuma música curtida',
          text: 'Toque no coração de qualquer faixa para guardá-las aqui.',
          btn: `<a class="btn btn-primary btn-sm" href="#/">Descobrir músicas</a>`,
        })}
  `;
  hydrateTrackStates(container);
  syncPlayingRows(player.current?.id, player.playing);
}

/* ==================================================================
   DOWNLOADS (OFFLINE)
================================================================== */
export async function downloadsView(container) {
  container.innerHTML = skeletonRows(5);

  const [records, info] = await Promise.all([downloads.list(), storageInfo()]);
  const tracks = records.map((r) => r.track).filter(Boolean);
  container._context = tracks;
  setCollection('downloads', tracks);

  const totalBytes = records.reduce((s, r) => s + (r.size || 0), 0);
  const totalSec = tracks.reduce((s, t) => s + (t.duration || 0), 0);

  const rows = records.map((rec, i) => {
    const t = rec.track;
    return `
      <div class="trow" data-track="${esc(t.id)}" data-action="play" data-id="${esc(t.id)}" role="button" tabindex="0">
        <div class="tr-idx"><span class="num">${i + 1}</span><span class="go">${icon('play', 'ic ic-sm')}</span></div>
        ${t.art
          ? `<img class="tr-art" src="${esc(t.art)}" alt="" loading="lazy">`
          : `<div class="tr-art" style="display:grid;place-items:center;color:var(--dim)">${icon('disc', 'ic ic-sm')}</div>`}
        <div class="tr-main">
          <span class="tr-title">${esc(t.title)}</span>
          <span class="tr-sub">${esc(t.artist)}<i class="dot"></i>${fmtBytes(rec.size || 0)}</span>
        </div>
        <div class="tr-plays">${icon('download-done', 'ic ic-sm')}<span>offline</span></div>
        <div class="tr-actions">
          <button class="icon-btn" data-action="like" data-like="${esc(t.id)}" data-id="${esc(t.id)}" title="Curtir" aria-label="Curtir">${icon('heart', 'ic ic-sm')}</button>
          <button class="icon-btn" data-action="save-file" data-id="${esc(t.id)}" title="Salvar arquivo .mp3 no dispositivo" aria-label="Salvar arquivo">${icon('share', 'ic ic-sm')}</button>
          <button class="icon-btn ok keep" data-action="download" data-dl="${esc(t.id)}" data-id="${esc(t.id)}" title="Remover download" aria-label="Remover download">${icon('download-done', 'ic ic-sm')}</button>
          <span class="tr-dur">${fmtTime(t.duration)}</span>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Downloads</h1>
        <p class="sub">Músicas salvas neste dispositivo — funcionam sem internet</p>
      </div>
      <div class="page-actions">
        ${tracks.length ? `
          <button class="btn btn-primary btn-sm" data-action="play-collection" data-key="downloads">${icon('play', 'ic ic-sm')} Ouvir tudo offline</button>
          <button class="btn btn-ghost btn-sm" data-action="shuffle-collection" data-key="downloads">${icon('shuffle', 'ic ic-sm')} Aleatório</button>
          <button class="btn btn-soft btn-sm" data-action="clear-downloads">${icon('trash', 'ic ic-sm')} Remover todos</button>` : ''}
      </div>
    </div>

    <div class="dl-summary">
      <div class="ds-item"><span class="ds-num">${tracks.length}</span><span class="ds-lbl">músicas offline</span></div>
      <div class="ds-sep"></div>
      <div class="ds-item"><span class="ds-num">${fmtBytes(totalBytes)}</span><span class="ds-lbl">${fmtTime(totalSec)} de áudio</span></div>
      <div class="ds-sep"></div>
      <div class="grow">
        <div class="ds-lbl">
          Navegador: ${fmtBytes(info.usage)} usados
          ${info.quota ? ` de ~${fmtBytes(info.quota)} disponíveis (${info.pct.toFixed(1)}%)` : ''}
        </div>
        <div class="bar"><i style="width:${Math.max(2, info.pct).toFixed(1)}%"></i></div>
      </div>
    </div>

    ${tracks.length
      ? `<div data-ctx="downloads">
          <div class="tracklist" role="table">
            <div class="tl-head" role="row">
              <div>#</div><div></div><div>Faixa</div><div class="col-plays">Status</div><div class="right">Ações</div>
            </div>
            ${rows}
          </div>
        </div>`
      : emptyState({
          glyph: 'download',
          title: 'Nada baixado ainda',
          text: 'Toque no ícone de download de qualquer música para guardá-la offline. Elas tocam mesmo sem internet.',
          btn: `<a class="btn btn-primary btn-sm" href="#/">Explorar músicas</a>`,
        })}
  `;
  hydrateTrackStates(container);
  syncPlayingRows(player.current?.id, player.playing);
}

/* ==================================================================
   RECENTES
================================================================== */
export async function recentView(container) {
  container.innerHTML = skeletonRows(5);
  const tracks = await recents.list(50);
  container._context = tracks;
  setCollection('recent', tracks);

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Tocadas recentemente</h1>
        <p class="sub">${tracks.length} faixa${tracks.length === 1 ? '' : 's'} neste dispositivo</p>
      </div>
      <div class="page-actions">
        ${tracks.length ? `
          <button class="btn btn-primary btn-sm" data-action="play-collection" data-key="recent">${icon('play', 'ic ic-sm')} Ouvir</button>
          <button class="btn btn-soft btn-sm" data-action="clear-recents">${icon('trash', 'ic ic-sm')} Limpar histórico</button>` : ''}
      </div>
    </div>
    ${tracks.length
      ? `<div class="recent-grid" data-ctx="recent">${tracks.map(recentChip).join('')}</div>`
      : emptyState({ glyph: 'clock', title: 'Nada tocado ainda', text: 'As músicas que você ouvir aparecem aqui.' })}
  `;
  hydrateTrackStates(container);
  syncPlayingRows(player.current?.id, player.playing);
}

/* ==================================================================
   ARTISTA
================================================================== */
export async function artist(container, id) {
  container.innerHTML = `
    <div class="list-hero">
      <div class="lh-art sk"></div>
      <div style="flex:1;min-width:240px">
        <div class="sk" style="height:44px;width:60%;margin-bottom:10px"></div>
        <div class="sk" style="height:18px;width:40%"></div>
      </div>
    </div>
    ${skeletonRows(6)}`;

  const [userRes, tracksRes] = await Promise.allSettled([
    api.userById(id),
    api.userTracks(id, { limit: 50 }),
  ]);

  if (userRes.status === 'rejected') {
    container.innerHTML = errorState('Não encontramos este artista. Ele pode ter saído da plataforma.');
    return;
  }

  const user = userRes.value;
  const tracks = tracksRes.status === 'fulfilled' ? tracksRes.value : [];
  container._context = tracks;
  setCollection('artist:' + id, tracks);

  container.innerHTML = `
    <div class="list-hero">
      <div class="lh-art">
        ${user.avatar
          ? `<img src="${esc(user.avatar)}" alt="">`
          : icon('user', 'ic')}
      </div>
      <div style="flex:1;min-width:240px">
        <span class="sub" style="color:var(--brand);font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:11.5px">Artista${user.verified ? ' verificado' : ''}</span>
        <h1 style="margin-top:6px">${esc(user.name)}</h1>
        <div class="lh-sub">
          ${user.location ? `<span>${esc(user.location)}</span><i class="dot"></i>` : ''}
          <span>${fmtNum(user.followers)} seguidores</span><i class="dot"></i>
          <span>${tracks.length} faixas</span>
        </div>
        ${user.bio ? `<p class="sub" style="margin-top:10px;max-width:70ch">${esc(user.bio)}</p>` : ''}
        <div class="lh-actions">
          ${tracks.length ? `
            <button class="btn btn-primary btn-sm" data-action="play-collection" data-key="artist:${esc(id)}">${icon('play', 'ic ic-sm')} Ouvir tudo</button>
            <button class="btn btn-ghost btn-sm" data-action="shuffle-collection" data-key="artist:${esc(id)}">${icon('shuffle', 'ic ic-sm')} Aleatório</button>` : ''}
          <a class="btn btn-soft btn-sm" href="${esc(api.audiusUrlFor({ artistHandle: user.handle }))}" target="_blank" rel="noopener">${icon('share', 'ic ic-sm')} Perfil</a>
        </div>
      </div>
    </div>

    ${tracks.length
      ? `<section class="section" data-ctx="artist:${esc(id)}">
          ${sectionHead('Destaques', { sub: 'Mais tocadas deste artista' })}
          ${trackList(tracks)}
        </section>`
      : emptyState({ glyph: 'music', title: 'Este artista ainda não tem faixas publicadas' })}
  `;
  hydrateTrackStates(container);
  syncPlayingRows(player.current?.id, player.playing);
}

/* ==================================================================
   PLAYLIST LOCAL
================================================================== */
export async function localPlaylist(container, id) {
  container.innerHTML = skeletonRows(5);
  const playlist = await playlists.get(id);

  if (!playlist) {
    container.innerHTML = emptyState({
      glyph: 'music',
      title: 'Playlist não encontrada',
      text: 'Ela pode ter sido excluída.',
      btn: `<a class="btn btn-primary btn-sm" href="#/library">Voltar à biblioteca</a>`,
    });
    return;
  }

  const tracks = playlist.tracks || [];
  container._context = tracks;
  setCollection('pl:' + id, tracks);

  const totalSec = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const cover = tracks.find((t) => t.art)?.art || null;

  const rows = tracks.map((t, i) => `
    <div class="trow" data-track="${esc(t.id)}" data-action="play" data-id="${esc(t.id)}" role="button" tabindex="0">
      <div class="tr-idx"><span class="num">${i + 1}</span><span class="go">${icon('play', 'ic ic-sm')}</span></div>
      ${t.art
        ? `<img class="tr-art" src="${esc(t.art)}" alt="" loading="lazy">`
        : `<div class="tr-art" style="display:grid;place-items:center;color:var(--dim)">${icon('disc', 'ic ic-sm')}</div>`}
      <div class="tr-main">
        <span class="tr-title">${esc(t.title)}</span>
        <span class="tr-sub">${esc(t.artist)}</span>
      </div>
      <div class="tr-plays">${t.plays ? `${fmtNum(t.plays)} plays` : ''}</div>
      <div class="tr-actions">
        <button class="icon-btn" data-action="like" data-like="${esc(t.id)}" data-id="${esc(t.id)}" title="Curtir">${icon('heart', 'ic ic-sm')}</button>
        <button class="icon-btn" data-action="download" data-dl="${esc(t.id)}" data-id="${esc(t.id)}" title="Baixar">${icon('download', 'ic ic-sm')}</button>
        <button class="icon-btn keep" data-action="playlist-remove-track" data-pl="${esc(id)}" data-id="${esc(t.id)}" title="Remover da playlist">${icon('x', 'ic ic-sm')}</button>
        <span class="tr-dur">${fmtTime(t.duration)}</span>
      </div>
    </div>`).join('');

  container.innerHTML = `
    <div class="list-hero">
      <div class="lh-art">
        ${cover ? `<img src="${esc(cover)}" alt="">` : icon('music', 'ic ic-lg')}
      </div>
      <div style="flex:1;min-width:240px">
        <span class="sub" style="color:var(--brand);font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:11.5px">Playlist</span>
        <h1 style="margin-top:6px">${esc(playlist.name)}</h1>
        <div class="lh-sub">
          <span>Por você</span><i class="dot"></i>
          <span>${tracks.length} faixa${tracks.length === 1 ? '' : 's'}</span>
          ${tracks.length ? `<i class="dot"></i><span>${fmtTime(totalSec)}</span>` : ''}
        </div>
        <div class="lh-actions">
          ${tracks.length ? `
            <button class="btn btn-primary btn-sm" data-action="play-collection" data-key="pl:${esc(id)}">${icon('play', 'ic ic-sm')} Ouvir</button>
            <button class="btn btn-ghost btn-sm" data-action="shuffle-collection" data-key="pl:${esc(id)}">${icon('shuffle', 'ic ic-sm')} Aleatório</button>` : ''}
          <button class="btn btn-soft btn-sm" data-action="playlist-rename" data-pl="${esc(id)}">${icon('music', 'ic ic-sm')} Renomear</button>
          <button class="btn btn-soft btn-sm" data-action="playlist-delete" data-pl="${esc(id)}">${icon('trash', 'ic ic-sm')} Excluir</button>
        </div>
      </div>
    </div>

    ${tracks.length
      ? `<div data-ctx="pl:${esc(id)}">
          <div class="tracklist" role="table">
            <div class="tl-head" role="row">
              <div>#</div><div></div><div>Faixa</div><div class="col-plays">Tocadas</div><div class="right">Ações</div>
            </div>
            ${rows}
          </div>
        </div>`
      : emptyState({
          glyph: 'music',
          title: 'Playlist vazia',
          text: 'Busque músicas e use o botão “+” para adicioná-las aqui.',
          btn: `<a class="btn btn-primary btn-sm" href="#/search">Buscar músicas</a>`,
        })}
  `;
  hydrateTrackStates(container);
  syncPlayingRows(player.current?.id, player.playing);
}

/* ==================================================================
   PLAYLIST ONLINE (Audius)
================================================================== */
export async function onlinePlaylist(container, id) {
  container.innerHTML = skeletonRows(5);
  try {
    const playlist = await api.playlistById(id);
    const tracks = playlist.tracks || [];
    container._context = tracks;
    setCollection('pl:' + id, tracks);

    const totalSec = tracks.reduce((s, t) => s + (t.duration || 0), 0);

    container.innerHTML = `
      <div class="list-hero">
        <div class="lh-art">
          ${playlist.art ? `<img src="${esc(playlist.art)}" alt="">` : icon('music', 'ic ic-lg')}
        </div>
        <div style="flex:1;min-width:240px">
          <span class="sub" style="color:var(--brand);font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:11.5px">Playlist Audius</span>
          <h1 style="margin-top:6px">${esc(playlist.name)}</h1>
          <div class="lh-sub">
            <span>${esc(playlist.owner)}</span><i class="dot"></i>
            <span>${tracks.length} faixas</span>
            ${tracks.length ? `<i class="dot"></i><span>${fmtTime(totalSec)}</span>` : ''}
          </div>
          ${playlist.description ? `<p class="sub" style="margin-top:10px;max-width:70ch">${esc(playlist.description)}</p>` : ''}
          <div class="lh-actions">
            ${tracks.length ? `
              <button class="btn btn-primary btn-sm" data-action="play-collection" data-key="pl:${esc(id)}">${icon('play', 'ic ic-sm')} Ouvir tudo</button>
              <button class="btn btn-ghost btn-sm" data-action="shuffle-collection" data-key="pl:${esc(id)}">${icon('shuffle', 'ic ic-sm')} Aleatório</button>` : ''}
            ${playlist.permalink ? `<a class="btn btn-soft btn-sm" href="https://audius.co${esc(playlist.permalink)}" target="_blank" rel="noopener">${icon('share', 'ic ic-sm')} Abrir na Audius</a>` : ''}
          </div>
        </div>
      </div>

      ${tracks.length
        ? `<div data-ctx="pl:${esc(id)}">${trackList(tracks)}</div>`
        : emptyState({ glyph: 'music', title: 'Esta playlist está vazia' })}
    `;
    hydrateTrackStates(container);
    syncPlayingRows(player.current?.id, player.playing);
  } catch (err) {
    container.innerHTML = errorState(err?.message || 'Não foi possível carregar esta playlist.');
  }
}

/* ==================================================================
   ROTA NÃO ENCONTRADA
================================================================== */
export function notFound(container) {
  container.innerHTML = emptyState({
    glyph: 'search',
    title: 'Página não encontrada',
    text: 'O endereço acessado não existe no Sonora.',
    btn: `<a class="btn btn-primary btn-sm" href="#/">Ir para o início</a>`,
  });
}
