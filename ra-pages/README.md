# 🎵 Sonora

Aplicativo de música completo em **PWA** (funciona no navegador e pode ser instalado no celular ou PC), com streaming gratuito, **downloads offline**, fila de reprodução, playlists, curtidas e histórico.

O catálogo vem da **Audius** — rede de música aberta, gratuita e legal (artistas independentes que liberam suas faixas). Nenhum login é necessário.

---

## ▶️ Como rodar

O app precisa ser servido por HTTP (o navegador exige isso para Service Worker e armazenamento offline). Duas opções:

### Opção 1 — sem instalar nada (recomendado)
Dê **duplo clique** em:

```
sonora\iniciar.bat
```

O servidor local sobe em `http://localhost:8777` e abre no navegador.

### Opção 2 — qualquer servidor estático
```bash
cd sonora
npx serve .          # Node.js
python -m http.server 8777   # Python
```

> Para instalar como app: no Chrome/Edge, clique no botão **“Instalar app”** da barra superior (ou menu ⋮ → *Instalar Sonora*).

---

## ✅ Funcionalidades

**Reprodução**
- Player com tocar/pausar, anterior/próxima, barra de progresso e volume
- Fila de reprodução editável (adicionar, tocar a seguir, remover, limpar)
- Modos **aleatório** e **repetir** (fila / uma música)
- Retoma de onde você parou ao voltar ao app
- Controles do sistema operacional (teclas de mídia, bloqueio de tela) via Media Session
- Atalhos de teclado: `Espaço` tocar/pausar · `←/→` ±5s · `⇧←/⇧→` anterior/próxima · `↑/↓` volume · `M` mudo · `S` aleatório · `R` repetir · `Q` fila · `F` player cheio · `/` buscar

**Offline**
- **Baixar qualquer música** com progresso e salvar no dispositivo (IndexedDB)
- Toca **sem internet** as músicas baixadas
- Biblioteca de downloads com uso de disco, remover individualmente ou tudo
- Botão para **salvar o arquivo `.mp3`** na pasta de downloads do computador
- Service Worker guarda o app e as capas: abre offline mesmo sem nada baixado
- Aviso permanente quando está sem conexão

**Biblioteca**
- Curtidas, toadas recentemente e histórico
- Playlists locais: criar, renomear, adicionar/remover faixas, excluir
- Busca de músicas, artistas e playlists + buscas recentes e gêneros
- Páginas de artista e de playlist (locais e da Audius)
- Menu de contexto (clique direito) em qualquer faixa

---

## 📁 Estrutura

```
sonora/
├── index.html            # shell + ícones SVG + markup das telas
├── styles → css/styles.css
├── manifest.webmanifest  # instalação como app
├── sw.js                 # Service Worker (offline)
├── server.ps1            # servidor local sem dependências
├── iniciar.bat           # sobe o servidor com 1 clique
└── js/
    ├── config.js         # hosts Audius, gêneros, timeouts
    ├── api.js            # cliente da API + normalização + stream assinado
    ├── db.js             # IndexedDB (downloads, curtidas, playlists, recentes)
    ├── player.js         # fila, shuffle/repeat, sessão, Media Session
    ├── ui.js             # templates, toasts, modais, formatação
    ├── views.js          # todas as telas
    └── app.js            # roteador, ações, atalhos, integração
```

---

## ⌨️ Rotas

| Rota | Tela |
|---|---|
| `#/` | Início (em alta, underground, playlists, recentes) |
| `#/search?q=` | Busca |
| `#/library` | Biblioteca |
| `#/liked` | Curtidas |
| `#/downloads` | Downloads offline |
| `#/recent` | Tocadas recentemente |
| `#/artist/:id` | Página do artista |
| `#/playlist/:id` | Playlist local |
| `#/playlist-online/:id` | Playlist da Audius |

---

## 🔧 Detalhes técnicos

- **API**: `GET /v1/tracks/trending`, `/v1/tracks/search`, `/v1/users/:id`, `/v1/playlists/:id` … com `app_name=SonoraApp`; fallback automático entre hosts da rede.
- **Stream**: o endpoint `/v1/tracks/:id/stream` redireciona para o nó de conteúdo com **assinatura fresca** — se a assinatura expirar durante a reprodução, o player resolve uma nova sozinho.
- **Download**: o áudio é lido com `fetch` + `ReadableStream` (barra de progresso real) e gravado como `Blob` no IndexedDB junto com a capa.
- **Privacidade**: tudo fica no seu navegador; não há servidor próprio nem coleta de dados.

## 📄 Conteúdo

As músicas são fornecidas pela Audius sob a licença escolhida por cada artista (a maioria permite ouvir e baixar gratuitamente). Este projeto não se afilia à Audius, Spotify ou Deezer.
