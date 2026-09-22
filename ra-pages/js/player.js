// Motor de reprodução: fila, shuffle, repeat, sessão e Media Session
import { resolveStreamUrl, OfflineError } from './api.js';
import { downloads, recents, prefs } from './db.js';

const audio = document.getElementById('audio');
const REPEAT_MODES = ['off', 'all', 'one'];

const listeners = new Map();

function emit(evt, data) {
  const set = listeners.get(evt);
  if (!set) return;
  for (const cb of set) {
    try { cb(data); } catch (err) { console.error(`[player:${evt}]`, err); }
  }
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

export const player = {
  queue: [],
  index: -1,
  current: null,
  shuffle: false,
  repeat: 'off',
  volume: 0.8,
  muted: false,
  playing: false,
  buffering: false,
  offlineSource: false,
  session: null,

  _objUrl: null,
  _token: 0,
  _retries: 0,
  _savedAt: 0,

  /* ---------------- eventos ---------------- */
  on(evt, cb) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(cb);
    return () => listeners.get(evt)?.delete(cb);
  },
  emit,

  /* ---------------- inicialização ---------------- */
  init() {
    const vol = Number(prefs.get('volume', 0.8));
    this.volume = Number.isFinite(vol) ? clamp(vol, 0, 1) : 0.8;
    this.muted = !!prefs.get('muted', false);
    this.shuffle = !!prefs.get('shuffle', false);
    const repeat = prefs.get('repeat', 'off');
    this.repeat = REPEAT_MODES.includes(repeat) ? repeat : 'off';
    audio.volume = this.muted ? 0 : this.volume;
    audio.preload = 'auto';

    const saved = prefs.get('session', null);
    if (saved && saved.track) this.session = saved;

    audio.addEventListener('play', () => {
      this.playing = true;
      emit('state');
    });
    audio.addEventListener('pause', () => {
      this.playing = false;
      emit('state');
      this.saveSession();
    });
    audio.addEventListener('waiting', () => {
      this.buffering = true;
      emit('state');
    });
    audio.addEventListener('canplay', () => {
      if (this.buffering) { this.buffering = false; emit('state'); }
    });
    audio.addEventListener('loadedmetadata', () => emit('time'));
    audio.addEventListener('durationchange', () => emit('time'));
    audio.addEventListener('timeupdate', () => {
      this.tickPosition();
      emit('time');
    });
    audio.addEventListener('ended', () => { this.next(true); });
    audio.addEventListener('error', () => { this.handleAudioError(); });

    emit('state');
    emit('queue');
  },

  /* ---------------- carregamento ---------------- */
  async load(track, autoplay = true) {
    const token = ++this._token;
    this.current = track;
    this._retries = 0;
    emit('change', { track });

    try {
      let url;
      const record = await downloads.get(track.id).catch(() => null);
      if (record?.audio instanceof Blob) {
        url = URL.createObjectURL(record.audio);
        this.releaseObjectUrl();
        this._objUrl = url;
        this.offlineSource = true;
      } else {
        if (navigator.onLine === false) throw new OfflineError();
        url = await resolveStreamUrl(track);
        this.releaseObjectUrl();
        this.offlineSource = false;
      }
      if (token !== this._token) return;      // outra requisição assumiu o controle

      audio.src = url;
      audio.load();
      if (autoplay) {
        await audio.play();
      }
      if (token !== this._token) return;
      this.onTrackStarted(track);
    } catch (err) {
      if (token !== this._token) return;
      this.buffering = false;
      emit('state');
      emit('error', {
        track,
        error: err,
        offline: err instanceof OfflineError || navigator.onLine === false,
        message: err?.message || 'Falha ao reproduzir',
      });
    }
  },

  async onTrackStarted(track) {
    emit('started', { track });
    recents.push(track).catch(() => {});
    this.saveSession(true);
    updateMediaSession(track, this.offlineSource);
  },

  releaseObjectUrl() {
    if (this._objUrl) {
      try { URL.revokeObjectURL(this._objUrl); } catch { /* ignore */ }
      this._objUrl = null;
    }
  },

  async handleAudioError() {
    if (!audio.src || this._token === 0) return;
    const err = audio.error;
    if (err && (err.code === MediaError.MEDIA_ERR_ABORTED)) return;
    // Assinatura de stream expirou: resolve uma nova e tenta de novo
    if (this.current && this._retries < 1 && navigator.onLine !== false) {
      this._retries += 1;
      const token = this._token;
      try {
        const url = await resolveStreamUrl(this.current);
        if (token !== this._token) return;
        this.releaseObjectUrl();
        audio.src = url;
        audio.load();
        await audio.play();
        return;
      } catch { /* cai no erro abaixo */ }
    }
    this.playing = false;
    emit('state');
    emit('error', {
      track: this.current,
      offline: navigator.onLine === false,
      message: navigator.onLine === false
        ? 'Sem conexão — baixe a música para ouvir offline'
        : 'Não foi possível tocar esta faixa',
    });
  },

  /* ---------------- tocar / pausar ---------------- */
  async toggle() {
    if (!this.current) {
      if (this.queue.length) {
        this.index = Math.max(0, this.index);
        await this.loadCurrent();
      }
      return;
    }
    if (audio.paused) {
      try {
        await audio.play();
      } catch (err) {
        emit('error', { track: this.current, message: 'O navegador bloqueou a reprodução', error: err });
      }
    } else {
      audio.pause();
    }
  },

  async play() {
    try { await audio.play(); } catch (err) {
      emit('error', { track: this.current, message: 'Não foi possível iniciar a música', error: err });
    }
  },

  pause() { audio.pause(); },

  async loadCurrent() {
    const track = this.queue[this.index];
    if (!track) return;
    await this.load(track);
  },

  async playTrack(track, context = null) {
    if (context && context.length) {
      this.queue = context.slice();
      const pos = this.queue.findIndex((t) => String(t.id) === String(track.id));
      this.index = pos >= 0 ? pos : 0;
    } else {
      const pos = this.queue.findIndex((t) => String(t.id) === String(track.id));
      if (pos >= 0) {
        this.index = pos;
      } else {
        this.queue = [track];
        this.index = 0;
      }
    }
    emit('queue');
    await this.loadCurrent();
  },

  async playQueue(tracks, startIndex = 0) {
    const list = (tracks || []).filter(Boolean);
    if (!list.length) return;
    this.queue = list.slice();
    this.index = clamp(startIndex, 0, list.length - 1);
    emit('queue');
    await this.loadCurrent();
  },

  /* ---------------- navegação ---------------- */
  async next(auto = false) {
    if (!this.queue.length) return;
    if (auto && this.repeat === 'one') {
      audio.currentTime = 0;
      try { await audio.play(); } catch { /* ignore */ }
      return;
    }
    let i = this.index;
    if (this.shuffle && this.queue.length > 1) {
      do { i = Math.floor(Math.random() * this.queue.length); } while (i === this.index);
    } else {
      i = this.index + 1;
      if (i >= this.queue.length) {
        if (this.repeat === 'all' || !auto) {
          i = 0;
        } else {
          audio.pause();
          audio.currentTime = 0;
          emit('state');
          return;
        }
      }
    }
    this.index = i;
    await this.loadCurrent();
  },

  async prev() {
    if (!this.queue.length) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      emit('time');
      return;
    }
    let i = this.index - 1;
    if (i < 0) i = this.queue.length - 1;
    this.index = i;
    await this.loadCurrent();
  },

  async jumpTo(queueIndex) {
    if (queueIndex < 0 || queueIndex >= this.queue.length) return;
    this.index = queueIndex;
    await this.loadCurrent();
  },

  /* ---------------- fila ---------------- */
  enqueue(tracks) {
    const list = (Array.isArray(tracks) ? tracks : [tracks]).filter(Boolean);
    const fresh = list.filter((t) => !this.queue.some((q) => String(q.id) === String(t.id)));
    if (!fresh.length) return 0;
    if (!this.queue.length) {
      this.queue = fresh;
      this.index = this.current ? 0 : -1;
    } else {
      this.queue.splice(this.index + 1, 0, ...fresh);
    }
    emit('queue');
    return fresh.length;
  },

  playNextInQueue(track) {
    if (!this.queue.length) {
      this.queue = [track];
      this.index = this.current ? 0 : -1;
    } else {
      this.queue.splice(this.index + 1, 0, track);
    }
    emit('queue');
  },

  removeFromQueue(queueIndex) {
    if (queueIndex < 0 || queueIndex >= this.queue.length) return;
    if (queueIndex === this.index && this.playing) return;   // não remove a que toca
    this.queue.splice(queueIndex, 1);
    if (queueIndex < this.index) this.index -= 1;
    if (!this.queue.length) this.index = -1;
    emit('queue');
  },

  clearQueue() {
    this.queue = this.current ? [this.current] : [];
    this.index = this.current ? 0 : -1;
    emit('queue');
  },

  /* ---------------- controles ---------------- */
  seek(seconds) {
    if (!Number.isFinite(seconds)) return;
    const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
    audio.currentTime = clamp(seconds, 0, Math.max(0, dur || seconds));
    emit('time');
  },

  seekBy(delta) { this.seek(audio.currentTime + delta); },

  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    audio.volume = this.volume;
    if (this.volume > 0 && this.muted) this.muted = false;
    if (!this.muted) audio.muted = false;
    prefs.set('volume', this.volume);
    prefs.set('muted', this.muted);
    emit('volume');
  },

  toggleMute() {
    this.muted = !this.muted;
    audio.muted = this.muted;
    if (!this.muted && this.volume === 0) this.setVolume(0.5);
    prefs.set('muted', this.muted);
    prefs.set('volume', this.volume);
    emit('volume');
  },

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    prefs.set('shuffle', this.shuffle);
    emit('state');
  },

  cycleRepeat() {
    const i = REPEAT_MODES.indexOf(this.repeat);
    this.repeat = REPEAT_MODES[(i + 1) % REPEAT_MODES.length];
    prefs.set('repeat', this.repeat);
    emit('state');
  },

  /* ---------------- sessão / mídia ---------------- */
  saveSession(force = false) {
    if (!this.current) return;
    const now = Date.now();
    if (!force && now - this._savedAt < 4000) return;
    this._savedAt = now;
    const session = {
      id: String(this.current.id),
      time: Number(audio.currentTime) || 0,
      duration: Number(audio.duration) || this.current.duration || 0,
      at: now,
      track: this.current,
    };
    this.session = session;
    prefs.set('session', session);
  },

  tickPosition() {
    this.saveSession();
    if (!('mediaSession' in navigator) || !this.current) return;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
    if (!dur) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: audio.playbackRate || 1,
        position: clamp(audio.currentTime, 0, dur),
      });
    } catch { /* navegador sem suporte */ }
  },

  restoreSession() {
    const s = this.session;
    if (!s?.track) return null;
    return { track: s.track, time: s.time || 0 };
  },
};

/* -------------------- Media Session API -------------------- */
function updateMediaSession(track, offline) {
  if (!('mediaSession' in navigator)) return;
  try {
    const artwork = [];
    if (track.art) artwork.push({ src: track.art, sizes: '480x480', type: 'image/jpeg' });
    if (track.artBig) artwork.push({ src: track.artBig, sizes: '1000x1000', type: 'image/jpeg' });
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: offline ? 'Sonora · Offline' : 'Sonora',
      artwork,
    });
  } catch { /* ignore */ }
}

export function bindMediaSessionActions() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const safe = (name, fn) => {
    try { ms.setActionHandler(name, fn); } catch { /* não suportado */ }
  };
  safe('play', () => player.play());
  safe('pause', () => player.pause());
  safe('previoustrack', () => player.prev());
  safe('nexttrack', () => player.next());
  safe('stop', () => player.pause());
  safe('seekbackward', (d) => player.seekBy(-(d?.seekOffset || 10)));
  safe('seekforward', (d) => player.seekBy(d?.seekOffset || 10));
  safe('seekto', (d) => { if (typeof d?.seekTime === 'number') player.seek(d.seekTime); });
}
