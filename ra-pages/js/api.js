// Cliente da API Audius — normalização, cache e resolução de stream
import {
  APP_NAME, FALLBACK_HOSTS, DISCOVERY_URL, REQUEST_TIMEOUT,
  MEMORY_TTL, AUDIUS_WEB,
} from './config.js';

/* ------------------------------------------------------------------
   Estado interno
------------------------------------------------------------------ */
let currentHost = null;          // host que está funcionando
const memCache = new Map();      // key -> { t, data }
const inflight = new Map();      // key -> Promise
const registry = new Map();      // id -> faixa normalizada (para ações globais)

export class OfflineError extends Error {
  constructor(msg = 'Sem conexão com a internet') {
    super(msg);
    this.name = 'OfflineError';
    this.offline = true;
  }
}

function qs(params) {
  const sp = new URLSearchParams();
  sp.set('app_name', APP_NAME);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  return '?' + sp.toString();
}

async function fetchTimeout(url, ms = REQUEST_TIMEOUT, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, cache: opts.cache || 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

// Descobre um host vivo da rede Audius
async function discoverHosts() {
  const list = [];
  try {
    const res = await fetchTimeout(DISCOVERY_URL, 6000);
    const json = await res.json();
    if (Array.isArray(json.data)) list.push(...json.data.filter((h) => typeof h === 'string'));
  } catch { /* segue para as reservas */ }
  list.push(...FALLBACK_HOSTS);
  return [...new Set(list)];
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hostOrder() {
  const known = currentHost ? [currentHost] : [];
  return known.length ? known : [];
}

/* ------------------------------------------------------------------
   Requisição com cache em memória + fallback de hosts
------------------------------------------------------------------ */
export async function request(path, params = {}, opts = {}) {
  const { ttl = MEMORY_TTL, allowOffline = false } = opts;
  const key = path + '?' + JSON.stringify(params);

  const cached = memCache.get(key);
  if (cached && Date.now() - cached.t < ttl) return cached.data;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (cached) return cached.data;             // offline: usa o último resultado
    if (allowOffline) return null;
    throw new OfflineError();
  }

  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const hosts = hostOrder().length ? hostOrder() : await discoverHosts();
    const ordered = hostOrder().length ? hosts : [hosts[0], ...shuffled(hosts.slice(1))];
    let lastErr = null;

    for (const host of ordered) {
      try {
        const res = await fetchTimeout(host + path + qs(params));
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status} em ${path}`);
          if (res.status === 429) { await sleep(700); continue; }
          if (res.status >= 500) continue;
          throw lastErr;                        // 4xx: não adianta trocar de host
        }
        const json = await res.json();
        currentHost = host;
        memCache.set(key, { t: Date.now(), data: json });
        return json;
      } catch (err) {
        if (err instanceof OfflineError) throw err;
        if (err && err.message && err.message.startsWith('HTTP 4')) throw err;
        lastErr = err;
      }
    }
    throw lastErr || new Error('Não foi possível falar com o servidor da Audius');
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function primeCache(path, params, data) {
  memCache.set(path + '?' + JSON.stringify(params), { t: Date.now(), data });
}

export function clearMemoryCache() { memCache.clear(); }

/* ------------------------------------------------------------------
   Normalização
------------------------------------------------------------------ */
export function pickArt(artwork, size = '480x480') {
  if (!artwork) return null;
  return artwork[size] || artwork['480x480'] || artwork['150x150'] || artwork['1000x1100'] || artwork['1000x1000'] || null;
}

export function normalizeTrack(t) {
  if (!t || !t.id) return null;
  const user = t.user || {};
  const tags = typeof t.tags === 'string' ? t.tags.split(',').map((s) => s.trim()).filter(Boolean) : (Array.isArray(t.tags) ? t.tags : []);
  const track = {
    id: t.id,
    trackId: t.track_id ?? null,
    title: t.title || 'Sem título',
    artist: user.name || 'Artista desconhecido',
    artistId: user.id || t.user_id || null,
    artistHandle: user.handle || null,
    avatar: user.profile_picture ? (user.profile_picture['150x150'] || user.profile_picture['480x480']) : null,
    art: pickArt(t.artwork, '480x480'),
    artBig: pickArt(t.artwork, '1000x1000') || pickArt(t.artwork, '480x480'),
    duration: Number(t.duration) || 0,
    genre: t.genre || '',
    mood: t.mood || '',
    bpm: t.bpm || null,
    musicalKey: t.musical_key || null,
    tags,
    plays: Number(t.play_count) || 0,
    likes: Number(t.favorite_count) || 0,
    reposts: Number(t.repost_count) || 0,
    release: t.release_date || t.created_at || null,
    streamUrl: (t.stream && t.stream.url) || null,
    hasDownload: !!t.download?.url,
    isStreamable: t.is_streamable !== false,
    permalink: t.permalink || null,
  };
  registry.set(String(track.id), track);
  return track;
}

export function normalizeTracks(arr) {
  return (Array.isArray(arr) ? arr : []).map(normalizeTrack).filter(Boolean);
}

export function normalizeUser(u) {
  if (!u || !u.id) return null;
  return {
    id: u.id,
    name: u.name || 'Artista',
    handle: u.handle || '',
    avatar: u.profile_picture ? (u.profile_picture['480x480'] || u.profile_picture['150x150']) : null,
    cover: u.cover_photo ? (u.cover_photo['2000x'] || u.cover_photo['640x']) : null,
    followers: Number(u.follower_count) || 0,
    following: Number(u.followee_count) || 0,
    tracks: Number(u.track_count) || 0,
    verified: !!u.is_verified,
    location: u.location || '',
    bio: u.bio || '',
    website: u.website || null,
    artworkOf: null,
  };
}

export function normalizePlaylist(p) {
  if (!p) return null;
  const contents = Array.isArray(p.tracks) && p.tracks.length
    ? p.tracks
    : (Array.isArray(p.playlist_contents) ? p.playlist_contents : []);
  const tracks = normalizeTracks(contents.map((c) => (c && c.track) ? c.track : c));
  let art = null;
  if (p.artwork && typeof p.artwork === 'object') art = pickArt(p.artwork, '480x480');
  if (!art && p.cover_art && typeof p.cover_art === 'object') art = pickArt(p.cover_art, '480x480');
  if (!art) art = tracks.find((t) => t.art)?.art || null;
  return {
    id: String(p.playlist_id ?? p.id ?? ''),
    name: p.playlist_name || p.name || 'Playlist',
    description: p.description || '',
    owner: p.user?.name || 'Sonora',
    art,
    trackCount: Number(p.track_count) || tracks.length,
    permalink: p.permalink || null,
    tracks,
    isAlbum: !!p.is_album,
  };
}

export function getRegistered(id) {
  return registry.get(String(id)) || null;
}

export function register(tracks) {
  for (const t of tracks) if (t && t.id) registry.set(String(t.id), t);
}

export function audiusUrlFor(track) {
  if (track?.permalink) return AUDIUS_WEB + track.permalink;
  if (track?.artistHandle) return `${AUDIUS_WEB}/${track.artistHandle}`;
  return AUDIUS_WEB;
}

/* ------------------------------------------------------------------
   Endpoints
------------------------------------------------------------------ */
export async function trending({ genre = '', time = '', limit = 20 } = {}) {
  const json = await request('/v1/tracks/trending', { genre, time, limit });
  return normalizeTracks(json?.data);
}

export async function underground({ limit = 20 } = {}) {
  const json = await request('/v1/tracks/trending/underground', { limit });
  return normalizeTracks(json?.data);
}

export async function searchTracks(q, { limit = 30, offset = 0 } = {}) {
  const json = await request('/v1/tracks/search', { query: q, limit, offset });
  return normalizeTracks(json?.data);
}

export async function searchUsers(q, { limit = 12 } = {}) {
  const json = await request('/v1/users/search', { query: q, limit });
  return (json?.data || []).map(normalizeUser).filter(Boolean);
}

export async function searchPlaylists(q, { limit = 12 } = {}) {
  try {
    const json = await request('/v1/playlists/search', { query: q, limit });
    return (json?.data || []).map(normalizePlaylist).filter(Boolean);
  } catch {
    return [];
  }
}

export async function playlistsTrending({ limit = 12 } = {}) {
  try {
    const json = await request('/v1/playlists/trending', { limit });
    return (json?.data || []).map(normalizePlaylist).filter(Boolean);
  } catch {
    return [];
  }
}

export async function userById(id) {
  const json = await request(`/v1/users/${id}`, {}, { ttl: 10 * MEMORY_TTL });
  return normalizeUser(json?.data);
}

export async function userTracks(id, { limit = 50 } = {}) {
  const json = await request(`/v1/users/${id}/tracks`, { limit }, { ttl: 10 * MEMORY_TTL });
  return normalizeTracks(json?.data);
}

export async function trackById(id) {
  const json = await request(`/v1/tracks/${id}`, {}, { ttl: 2 * MEMORY_TTL });
  return normalizeTrack(json?.data);
}

export async function playlistTracks(id, { limit = 100 } = {}) {
  try {
    const json = await request(`/v1/playlists/${id}/tracks`, { limit }, { ttl: 10 * MEMORY_TTL });
    return normalizeTracks(json?.data);
  } catch {
    return [];
  }
}

export async function playlistById(id) {
  try {
    const json = await request(`/v1/playlists/${id}`, {}, { ttl: 10 * MEMORY_TTL });
    const playlist = normalizePlaylist(json?.data);
    if (playlist) {
      if (!playlist.tracks.length) playlist.tracks = await playlistTracks(id);
      playlist.trackCount = playlist.trackCount || playlist.tracks.length;
      return playlist;
    }
  } catch { /* tenta apenas as faixas */ }
  const tracks = await playlistTracks(id);
  return {
    id: String(id),
    name: 'Playlist da Audius',
    description: '',
    owner: 'Audius',
    art: tracks[0]?.art || null,
    trackCount: tracks.length,
    permalink: null,
    tracks,
  };
}

/* ------------------------------------------------------------------
   Resolução de áudio
------------------------------------------------------------------ */
/**
 * Sempre resolve uma URL de stream assinada e fresca.
 * A API redireciona (302) para o nó de conteúdo — pegamos a URL final
 * e cancelamos o corpo, transferindo apenas os primeiros bytes.
 */
export async function resolveStreamUrl(track) {
  if (!track?.id) throw new Error('Faixa inválida');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();

  const hosts = hostOrder().length ? hostOrder() : await discoverHosts();
  const tries = hostOrder().length ? hosts : shuffled(hosts).slice(0, 3);

  for (const host of tries) {
    try {
      const res = await fetchTimeout(`${host}/v1/tracks/${track.id}/stream`, 9000, { cache: 'no-store' });
      const finalUrl = res.url || '';
      if (res.body) { try { await res.body.cancel(); } catch { /* já encerrado */ } }
      if ((res.ok || res.status === 206) && finalUrl.includes('/tracks/cidstream/')) {
        currentHost = host;
        return finalUrl;
      }
    } catch { /* tenta o próximo host */ }
  }

  // Último recurso: URL que veio junto com os metadados
  if (track.streamUrl && navigator.onLine !== false) return track.streamUrl;
  throw new Error('Não foi possível obter o áudio desta faixa');
}

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
