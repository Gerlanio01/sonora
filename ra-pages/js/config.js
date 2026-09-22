// Configuração global do Sonora
export const APP_NAME = 'SonoraApp';

// Hosts oficiais da rede Audius (usados como reserva caso api.audius.co falhe)
export const FALLBACK_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
  'https://discoveryprovider.discoverynode.org',
  'https://audius-discovery-1.altego.net',
];

export const DISCOVERY_URL = 'https://api.audius.co';

// Tempo máximo de cada requisição (ms)
export const REQUEST_TIMEOUT = 12000;

// Cache em memória para respostas da API (ms)
export const MEMORY_TTL = 5 * 60 * 1000;

// Gêneros exibidos como atalhos (valores reconhecidos pela API)
export const GENRES = [
  'Electronic', 'House', 'Techno', 'Hip-Hop/Rap', 'Pop', 'Rock',
  'Lo-Fi', 'R&B/Soul', 'Jazz', 'Ambient', 'Trap', 'Latin',
  'Reggae', 'Metal', 'Classical', 'Drum & Bass', 'Funk', 'Blues',
  'Country', 'Folk',
];

// Site público da Audius (links de compartilhamento)
export const AUDIUS_WEB = 'https://audius.co';

export const STORAGE_KEY = 'sonora.session';
export const PREFS_KEY = 'sonora.prefs';
