/* =====================================================================
   Teleprompter Pro Studio — v4
   Lista compartida por banda, borrador + historial, carga por partes,
   idioma por tema y seguimiento por voz con Vosk (sin internet) o Google.
   ===================================================================== */
(() => {
'use strict';

// ---------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------
const PART_TYPES = ['Intro', 'Estrofa', 'Pre-estribillo', 'Estribillo', 'Puente', 'Solo', 'Instrumental', 'Interludio', 'Final'];
const INSTRUMENTAL_TYPES = ['Intro', 'Solo', 'Instrumental', 'Interludio'];
const OTHER_TYPE = 'Otro';
const HISTORY_MAX = 5;
const AUTOCUE_SECONDS = 20;

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_MAP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };
const CHORD_RE = /^[A-G](#|b)?(maj|min|m|M|dim|aug|sus|add|°|ø|\+)?[0-9]*(((maj|sus|add|dim|aug|b|#|\+|-)[0-9]*)|\([^)\s]*\))*(\/[A-G](#|b)?)?$/;

const VOICE_LANG = { es: 'es-AR', en: 'en-US' };
// Cada modelo está partido en pedazos de 18 MB (límite de subida de GitHub); la app los une al descargar.
const VOSK_MODELS = {
  es: { name: 'models/vosk-model-small-es-0.3.tar.gz', parts: 2 },
  en: { name: 'models/vosk-model-small-en-us-0.15.tar.gz', parts: 3 }
};
const COMMON_WORDS = {
  es: new Set(['a', 'al', 'de', 'del', 'el', 'la', 'las', 'lo', 'los', 'un', 'una', 'y', 'e', 'o', 'u', 'que', 'en', 'se', 'me', 'te', 'mi', 'tu', 'su', 'no', 'si', 'es', 'por', 'con', 'para', 'ya', 'yo', 'le', 'les', 'nos', 'mas', 'pero', 'como']),
  en: new Set(['a', 'an', 'the', 'and', 'or', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'my', 'your', 'to', 'in', 'on', 'of', 'at', 'is', 'be', 'so', 'do', 'oh', 'for', 'but', 'that', 'this', 'with'])
};

const K = {
  list: id => `tp4_list_${id}`,
  hist: id => `tp4_hist_${id}`,
  draft: id => `tp4_draft_${id}`,
  pending: id => `tp4_pending_${id}`,
  pos: id => `tp4_pos_${id}`,
  learned: (id, songId) => `tp4_learned_${id}_${songId}`,
  recent: 'tp4_recent',
  active: 'tp4_active',
  prefs: 'tp4_prefs'
};

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn('No se pudo guardar', key, e); return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch (e) {} }
};

function listIdFromName(name) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

function isChord(s) { return CHORD_RE.test(s); }

function transposeNote(n, semi) {
  const note = FLAT_MAP[n] || n;
  const i = CHROMATIC.indexOf(note);
  if (i === -1) return n;
  return CHROMATIC[((i + semi) % 12 + 12) % 12];
}

function transposeChord(chord, semi) {
  if (!chord || !semi) return chord;
  return chord
    .replace(/^([A-G][b#]?)/, m => transposeNote(m, semi))
    .replace(/\/([A-G][b#]?)$/, (m, n) => '/' + transposeNote(n, semi));
}

// Normalización para comparar lo escuchado con la letra (aproximada y por sonido)
function baseWord(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function soundKey(word, lang) {
  let w = baseWord(word);
  if (lang === 'es') {
    w = w.replace(/ch/g, '1').replace(/h/g, '').replace(/1/g, 'ch')
      .replace(/v/g, 'b').replace(/z/g, 's').replace(/c(?=[ei])/g, 's')
      .replace(/qu/g, 'k').replace(/c/g, 'k').replace(/ll/g, 'y').replace(/rr/g, 'r')
      .replace(/gu(?=[ei])/g, 'g').replace(/x/g, 'ks');
  } else {
    w = w.replace(/ph/g, 'f').replace(/ck/g, 'k');
  }
  return w.replace(/(.)\1+/g, '$1');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

// Devuelve un puntaje 0..1 (0 = no coincide). Tolerante a pronunciaciones cantadas.
function similarity(lyricKey, spokenKey) {
  if (!lyricKey || !spokenKey) return 0;
  if (lyricKey === spokenKey) return 1;
  const maxLen = Math.max(lyricKey.length, spokenKey.length);
  if (maxLen <= 2) return 0;
  if (spokenKey.length >= 4 && lyricKey.startsWith(spokenKey)) return 0.85; // palabra a medio reconocer
  const s = 1 - levenshtein(lyricKey, spokenKey) / maxLen;
  if (maxLen <= 3) return s >= 0.66 ? s : 0;
  if (maxLen <= 5) return s >= 0.74 ? s : 0;
  return s >= 0.62 ? s : 0;
}

// ---------------------------------------------------------------------
// Nube: Firestore por su interfaz REST (sin librerías)
// ---------------------------------------------------------------------
const cloud = {
  get enabled() {
    const c = window.TP_CLOUD || {};
    return !!(c.projectId && c.apiKey);
  },
  base() {
    const c = window.TP_CLOUD;
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(c.projectId)}/databases/(default)/documents`;
  },
  key() { return `key=${encodeURIComponent(window.TP_CLOUD.apiKey)}`; },
  async req(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'Content-Type': 'application/json' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Nube: error ${res.status}`);
      const txt = await res.text();
      return txt ? JSON.parse(txt) : {};
    } finally { clearTimeout(t); }
  },
  async getList(id) {
    const doc = await this.req(`${this.base()}/listas/${encodeURIComponent(id)}?${this.key()}`);
    if (!doc || !doc.fields) return null;
    try {
      const data = JSON.parse(doc.fields.data.stringValue);
      return { id, name: data.name || id, songs: data.songs || [], updatedAt: doc.fields.updatedAt?.stringValue || '' };
    } catch (e) { return null; }
  },
  async putList(list) {
    const body = { fields: {
      data: { stringValue: JSON.stringify({ name: list.name, songs: list.songs }) },
      updatedAt: { stringValue: list.updatedAt }
    } };
    return this.req(`${this.base()}/listas/${encodeURIComponent(list.id)}?${this.key()}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  async addHistory(id, entry) {
    const body = { fields: { data: { stringValue: entry.data }, savedAt: { stringValue: entry.savedAt } } };
    return this.req(`${this.base()}/listas/${encodeURIComponent(id)}/historial?${this.key()}`, { method: 'POST', body: JSON.stringify(body) });
  },
  async listHistory(id) {
    const res = await this.req(`${this.base()}/listas/${encodeURIComponent(id)}/historial?${this.key()}&pageSize=100`);
    const docs = (res && res.documents) || [];
    return docs.map(d => ({ name: d.name, savedAt: d.fields?.savedAt?.stringValue || '', data: d.fields?.data?.stringValue || '' }))
      .sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
  },
  async deleteDoc(name) {
    return this.req(`https://firestore.googleapis.com/v1/${name}?${this.key()}`, { method: 'DELETE' });
  },
  async trimHistory(id) {
    const all = await this.listHistory(id);
    for (const h of all.slice(HISTORY_MAX)) { try { await this.deleteDoc(h.name); } catch (e) {} }
  }
};

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------
const state = {
  list: null,             // { id, name, songs, updatedAt } — versión guardada
  currentSongIndex: 0,
  isPlaying: false,
  isVoiceMode: true,
  engine: 'vosk',
  showChords: true,
  audioClickEnabled: false,
  transposeSemi: 0,
  fontSize: 32,
  speed: 2.2,
  guidePosition: 32,
  mirrorH: false,
  isGuideVisible: true,
  currentWordIndex: 0,
  isSongFinished: false,
  scrollPos: 0,
  animId: null,
  metroInterval: null,
  autoCueRemaining: AUTOCUE_SECONDS,
  autoCuePaused: false,
  autoCueTimer: null,
  pendingRemote: null,
  // Editor
  draft: null,
  editingIdx: 0,
  dirty: false,
  afterUnsaved: null,
  // Seguimiento
  runVoicedParts: new Set(),
  lastFinishedSongId: null
};

let song = null;           // tema en pantalla
let wordObjects = [];      // { index, key, common, el, lineIdx, partIndex }
let lineElements = [];     // { el, words:[], partIndex }
let partsInfo = [];        // { name, type, firstWord, lastWord }
let songIsStructured = false;

// ---------------------------------------------------------------------
// Referencias DOM
// ---------------------------------------------------------------------
const el = {};
[
  'app-body', 'stage-flash-overlay', 'stage-hud', 'hud-icon', 'hud-text', 'teleprompter-content', 'scroll-wrapper',
  'teleprompter-stage', 'btn-toggle-play', 'play-icon', 'pause-icon', 'play-label', 'btn-rewind', 'metro-light',
  'bpm-display', 'btn-audio-click', 'transpose-indicator', 'btn-transpose-up', 'btn-transpose-down', 'btn-toggle-chords',
  'btn-header-toggle-guide', 'btn-toggle-voice', 'voice-mode-label', 'mic-ping', 'mic-dot', 'font-slider', 'font-val',
  'speed-slider', 'btn-mirror-h', 'btn-fullscreen', 'btn-exit-focus', 'progress-bar', 'band-notes-banner',
  'band-notes-text', 'btn-toggle-notes-view', 'guide-overlay', 'guide-pos-slider', 'select-active-song',
  'song-lang-badge', 'btn-prev-song', 'btn-next-song', 'btn-open-setlist', 'header-list-name', 'btn-settings',
  'detected-transcript', 'btn-learn-chip', 'toast',
  'autocue-modal', 'autocue-next-card', 'autocue-next-title', 'autocue-next-notes', 'autocue-badge-bpm',
  'autocue-badge-lang', 'autocue-countdown', 'autocue-bar', 'autocue-status-pill', 'btn-autocue-toggle-pause',
  'autocue-btn-icon', 'autocue-btn-label', 'btn-autocue-back', 'btn-autocue-learn',
  'setlist-modal', 'editor-list-name', 'editor-status', 'btn-save-list', 'btn-history', 'btn-export-setlist',
  'input-import-setlist', 'btn-change-list', 'btn-close-setlist', 'song-count', 'btn-new-song', 'songs-list-container',
  'edit-song-title', 'edit-song-bpm', 'edit-song-lang', 'edit-song-notes', 'learned-row', 'btn-forget-learned',
  'legacy-editor', 'btn-convert-parts', 'edit-song-content', 'parts-editor', 'parts-container', 'new-part-type',
  'btn-add-part', 'btn-delete-song', 'btn-load-and-exit',
  'open-list-modal', 'input-list-code', 'recent-lists', 'cloud-state-open', 'btn-cancel-open-list', 'btn-confirm-open-list',
  'history-modal', 'btn-close-history', 'history-list',
  'unsaved-modal', 'btn-unsaved-save', 'btn-unsaved-discard', 'btn-unsaved-continue',
  'draft-modal', 'draft-date', 'btn-draft-continue', 'btn-draft-discard',
  'confirm-modal', 'confirm-title', 'confirm-text', 'btn-confirm-cancel', 'btn-confirm-ok',
  'settings-modal', 'btn-close-settings', 'select-engine', 'model-state-es', 'model-state-en', 'cloud-state-settings'
].forEach(id => { el[id.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = $(id); });

const show = node => node.classList.remove('hidden');
const hide = node => node.classList.add('hidden');
const isShown = node => !node.classList.contains('hidden');

// ---------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('opacity-0', '-translate-y-2');
  el.toast.classList.add('opacity-100', 'translate-y-0');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('opacity-100', 'translate-y-0');
    el.toast.classList.add('opacity-0', '-translate-y-2');
  }, 2400);
}

let hudTimer = null;
function stageFeedback(type, label) {
  const map = {
    play: ['▶', 'border-emerald-500'], pause: ['⏸', 'border-amber-500'], rewind: ['⏮', 'border-indigo-500'],
    next: ['⏭', 'border-sky-500'], prev: ['⏮', 'border-purple-500'],
    forward_hold: ['⏩', 'border-sky-400'], rewind_hold: ['⏪', 'border-indigo-400']
  };
  const [icon, border] = map[type] || map.play;
  el.stageFlashOverlay.className = `absolute inset-0 z-50 border-[8px] pointer-events-none transition-all duration-200 opacity-100 ${border}`;
  el.hudIcon.textContent = icon;
  el.hudText.textContent = label || '';
  el.stageHud.classList.remove('opacity-0', 'scale-90');
  el.stageHud.classList.add('opacity-100', 'scale-100');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    el.stageFlashOverlay.classList.replace('opacity-100', 'opacity-0');
    el.stageHud.classList.remove('opacity-100', 'scale-100');
    el.stageHud.classList.add('opacity-0', 'scale-90');
  }, 450);
}

let confirmCb = null;
function askConfirm(title, text, okLabel, cb) {
  el.confirmTitle.textContent = title;
  el.confirmText.textContent = text;
  el.btnConfirmOk.textContent = okLabel || 'Aceptar';
  confirmCb = cb;
  show(el.confirmModal);
}
el.btnConfirmCancel.addEventListener('click', () => { hide(el.confirmModal); confirmCb = null; });
el.btnConfirmOk.addEventListener('click', () => { hide(el.confirmModal); const cb = confirmCb; confirmCb = null; if (cb) cb(); });

// ---------------------------------------------------------------------
// Temas de ejemplo (letras originales de muestra)
// ---------------------------------------------------------------------
function demoSongs() {
  return [
    {
      id: uid('song'), title: '1. Tema de ejemplo (español)', bpm: 84, lang: 'es',
      notes: 'Tono: Sol (G) • Intro 4 compases de guitarra • Voz entra en el compás 5',
      parts: [
        { id: uid('p'), type: 'Intro', name: '', content: 'Guitarra sola, 4 compases' },
        { id: uid('p'), type: 'Estrofa', name: '', content: '[G]Salgo temprano por la [D]calle del puerto\n[Em]llevo en el bolso una can[C]ción sin terminar' },
        { id: uid('p'), type: 'Estribillo', name: '', content: '[C]Y si la noche se a[G]larga\n[D]yo te espero en el [Em]mar' },
        { id: uid('p'), type: 'Solo', name: '', content: 'Solo de guitarra, 8 compases' },
        { id: uid('p'), type: 'Estrofa', name: '', content: '[G]Vuelvo de tarde con el [D]viento en la cara\n[Em]y una guitarra que no [C]sabe descansar' },
        { id: uid('p'), type: 'Estribillo', name: '', content: '[C]Y si la noche se a[G]larga\n[D]yo te espero en el [Em]mar' },
        { id: uid('p'), type: 'Final', name: '', content: '[C]Yo te espero en el [G]mar' }
      ]
    },
    {
      id: uid('song'), title: '2. Sample song (English)', bpm: 76, lang: 'en',
      notes: 'Key: C • Intro 2 bars piano • Drums in on the chorus',
      parts: [
        { id: uid('p'), type: 'Estrofa', name: '', content: '[C]Morning comes in [G]slow tonight\n[Am]city lights are [F]fading out' },
        { id: uid('p'), type: 'Estribillo', name: '', content: '[F]Hold on to the [C]road ahead\n[G]we will find our [C]way back home' }
      ]
    }
  ];
}

// ---------------------------------------------------------------------
// Preferencias del dispositivo
// ---------------------------------------------------------------------
function savePrefs() {
  store.set(K.prefs, {
    fontSize: state.fontSize, speed: state.speed, guidePosition: state.guidePosition,
    showChords: state.showChords, isGuideVisible: state.isGuideVisible, engine: state.engine,
    isVoiceMode: state.isVoiceMode
  });
}

function loadPrefs() {
  const p = store.get(K.prefs, {}) || {};
  if (p.fontSize) state.fontSize = p.fontSize;
  if (p.speed) state.speed = p.speed;
  if (p.guidePosition) state.guidePosition = p.guidePosition;
  if (typeof p.showChords === 'boolean') state.showChords = p.showChords;
  if (typeof p.isGuideVisible === 'boolean') state.isGuideVisible = p.isGuideVisible;
  if (typeof p.isVoiceMode === 'boolean') state.isVoiceMode = p.isVoiceMode;
  if (p.engine === 'google' || p.engine === 'vosk') state.engine = p.engine;
}

// ---------------------------------------------------------------------
// Listas: abrir, guardar, historial, sincronizar
// ---------------------------------------------------------------------
function normalizeSong(s) {
  const out = {
    id: s.id || uid('song'),
    title: String(s.title || 'Sin título'),
    bpm: parseInt(s.bpm, 10) || 80,
    notes: String(s.notes || ''),
    lang: s.lang === 'en' ? 'en' : 'es'
  };
  if (Array.isArray(s.parts)) {
    out.parts = s.parts.map(p => ({
      id: p.id || uid('p'),
      type: PART_TYPES.includes(p.type) || p.type === OTHER_TYPE ? p.type : OTHER_TYPE,
      name: String(p.name || (PART_TYPES.includes(p.type) ? '' : p.type || '')),
      content: String(p.content || '')
    }));
  } else {
    out.content = String(s.content || '');
  }
  return out;
}

function legacyDeviceSongs() {
  for (const key of ['teleprompter_band_playlists_v3', 'teleprompter_band_playlists_v2']) {
    const pls = store.get(key);
    if (Array.isArray(pls) && pls.length && Array.isArray(pls[0].songs) && pls[0].songs.length) {
      const activeId = store.get(key.replace('playlists', 'active_playlist_id'));
      const pl = pls.find(p => p.id === activeId) || pls[0];
      return pl.songs.map(normalizeSong);
    }
  }
  return null;
}

function rememberRecent(list) {
  const recent = (store.get(K.recent, []) || []).filter(r => r.id !== list.id);
  recent.unshift({ id: list.id, name: list.name });
  store.set(K.recent, recent.slice(0, 8));
  store.set(K.active, list.id);
}

function saveListLocal(list) { store.set(K.list(list.id), list); }

async function openList(name) {
  const clean = name.trim();
  const id = listIdFromName(clean);
  if (!id) { showToast('Escribí un nombre válido para la lista'); return false; }

  let local = store.get(K.list(id));
  let remote = null;
  let remoteChecked = false;
  if (cloud.enabled && navigator.onLine) {
    try { remote = await cloud.getList(id); remoteChecked = true; } catch (e) { console.warn(e); }
  }

  let list;
  if (remote && (!local || !store.get(K.pending(id)) || (remote.updatedAt > (local.updatedAt || '')))) {
    list = remote;
  } else if (local) {
    list = local;
    // Lista creada antes de conectar la nube: se sube para compartirla
    if (remoteChecked && !remote) store.set(K.pending(id), true);
  } else {
    const seed = legacyDeviceSongs();
    list = { id, name: clean, songs: seed || demoSongs(), updatedAt: new Date().toISOString() };
    if (seed) showToast('Se cargaron los temas que había en este dispositivo');
    saveListLocal(list);
    pushListToCloud(list, null);
  }
  list.songs = list.songs.map(normalizeSong);
  if (!list.name) list.name = clean;

  stopPrompter();
  state.list = list;
  saveListLocal(list);
  rememberRecent(list);
  if (store.get(K.pending(id))) pushPending();
  state.currentSongIndex = Math.min(store.get(K.pos(id), 0) || 0, list.songs.length - 1);
  state.transposeSemi = 0;
  el.headerListName.textContent = list.name;
  renderCurrentSong();
  showToast(`Lista abierta: ${list.name}`);
  return true;
}

async function pushListToCloud(list, historyEntry) {
  if (!cloud.enabled) return;
  const queue = store.get(`${K.pending(list.id)}_hist`, []) || [];
  if (historyEntry) queue.push(historyEntry);
  store.set(`${K.pending(list.id)}_hist`, queue);
  store.set(K.pending(list.id), true);
  await pushPending();
}

let pushing = false;
async function pushPending() {
  if (!cloud.enabled || !state.list || pushing || !navigator.onLine) return;
  const id = state.list.id;
  if (!store.get(K.pending(id))) return;
  pushing = true;
  try {
    const queue = store.get(`${K.pending(id)}_hist`, []) || [];
    while (queue.length) {
      await cloud.addHistory(id, queue[0]);
      queue.shift();
      store.set(`${K.pending(id)}_hist`, queue);
    }
    await cloud.putList(store.get(K.list(id)) || state.list);
    store.del(K.pending(id));
    cloud.trimHistory(id).catch(() => {});
  } catch (e) {
    console.warn('Subida pendiente:', e);
  } finally { pushing = false; }
}

async function commitSongs(newSongs, message) {
  const prev = state.list;
  const now = new Date().toISOString();
  const entry = { savedAt: prev.updatedAt || now, data: JSON.stringify({ name: prev.name, songs: prev.songs }) };

  const hist = store.get(K.hist(prev.id), []) || [];
  hist.unshift(entry);
  store.set(K.hist(prev.id), hist.slice(0, HISTORY_MAX));

  const currentId = song ? song.id : null;
  state.list = { ...prev, songs: clone(newSongs).map(normalizeSong), updatedAt: now };
  saveListLocal(state.list);
  store.del(K.draft(prev.id));

  const idx = state.list.songs.findIndex(s => s.id === currentId);
  state.currentSongIndex = idx >= 0 ? idx : Math.min(state.currentSongIndex, state.list.songs.length - 1);
  if (!state.isPlaying) renderCurrentSong(); else syncSongSelector();
  showToast(message || 'Cambios guardados');
  pushListToCloud(state.list, entry); // se sube en segundo plano; si no hay señal, queda pendiente
}

async function refreshFromCloud() {
  if (!cloud.enabled || !state.list || !navigator.onLine) return;
  const id = state.list.id;
  if (store.get(K.pending(id))) { pushPending(); return; }
  try {
    const remote = await cloud.getList(id);
    if (remote && remote.updatedAt && remote.updatedAt > (state.list.updatedAt || '')) {
      remote.songs = remote.songs.map(normalizeSong);
      if (state.isPlaying || isShown(el.setlistModal)) { state.pendingRemote = remote; return; }
      applyRemote(remote);
    }
  } catch (e) { /* sin conexión: se sigue con la copia local */ }
}

function applyRemote(remote) {
  const currentId = song ? song.id : null;
  state.list = remote;
  state.pendingRemote = null;
  saveListLocal(remote);
  const idx = remote.songs.findIndex(s => s.id === currentId);
  state.currentSongIndex = idx >= 0 ? idx : Math.min(state.currentSongIndex, remote.songs.length - 1);
  el.headerListName.textContent = remote.name;
  renderCurrentSong();
  showToast('La lista se actualizó con los últimos cambios');
}

function applyPendingRemoteIfIdle() {
  if (state.pendingRemote && !state.isPlaying && !isShown(el.setlistModal)) applyRemote(state.pendingRemote);
}

setInterval(refreshFromCloud, 60000);
window.addEventListener('online', () => { pushPending(); refreshFromCloud(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { refreshFromCloud(); requestWakeLock(); }
});

function cloudStateText() {
  if (!cloud.enabled) return 'Nube sin configurar: las listas se guardan solo en este dispositivo.';
  return navigator.onLine ? 'Nube conectada: la lista se comparte entre dispositivos.' : 'Sin conexión: se usa la copia guardada en este dispositivo.';
}

// ---------------------------------------------------------------------
// Parser de letra y acordes
// ---------------------------------------------------------------------
function normalizeParens(text) {
  return text.replace(/\(([^()\s]+)\)/g, (m, inner) => (isChord(inner) ? `[${inner}]` : m));
}

function parseWordSegments(token) {
  const segments = [];
  const re = /\[([^\]]+)\]|([^[\]]+)/g;
  let m;
  let pending = null;
  while ((m = re.exec(normalizeParens(token))) !== null) {
    if (m[1] !== undefined) {
      if (pending) segments.push({ ...pending, text: '' });
      pending = isChord(m[1].trim()) ? { chord: m[1].trim() } : { tag: m[1].trim() };
    } else {
      segments.push({ ...(pending || {}), text: m[2] });
      pending = null;
    }
  }
  if (pending) segments.push({ ...pending, text: '' });
  return segments;
}

function isCueLine(trimmed) {
  const t = normalizeParens(trimmed);
  const full = t.match(/^\[([^\]]+)\]$/) || trimmed.match(/^\(([^)]+)\)$/);
  if (!full) return false;
  return !isChord(full[1].trim());
}

function partDisplayNames(parts) {
  const total = {}, seen = {};
  parts.forEach(p => { const n = p.type === OTHER_TYPE ? (p.name || 'Parte') : p.type; total[n] = (total[n] || 0) + 1; });
  return parts.map(p => {
    const n = p.type === OTHER_TYPE ? (p.name || 'Parte') : p.type;
    seen[n] = (seen[n] || 0) + 1;
    return total[n] > 1 ? `${n} ${seen[n]}` : n;
  });
}

function renderLines(text, partIndex, container, counter) {
  text.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      const gap = document.createElement('div');
      gap.className = 'h-5 sm:h-7';
      container.appendChild(gap);
      return;
    }
    if (isCueLine(trimmed)) {
      const cue = document.createElement('div');
      cue.className = 'section-cue';
      const strong = document.createElement('strong');
      strong.textContent = '🎸 SECCIÓN: ';
      cue.appendChild(strong);
      cue.appendChild(document.createTextNode(trimmed.replace(/^[[(]|[\])]$/g, '')));
      container.appendChild(cue);
      return;
    }

    const lineEl = document.createElement('div');
    lineEl.className = 'prompter-line flex flex-wrap items-end my-1.5 sm:my-2 leading-snug';
    const lineObj = { el: lineEl, words: [], partIndex };
    const lineIdx = lineElements.length;

    line.split(/(\s+)/).forEach(tok => {
      if (!tok) return;
      if (!tok.trim()) {
        const sp = document.createElement('span');
        sp.className = 'inline-block w-2 sm:w-3 select-none';
        sp.innerHTML = '&nbsp;';
        lineEl.appendChild(sp);
        return;
      }
      const segments = parseWordSegments(tok);
      const text = segments.map(s => s.text).join('');
      const key = soundKey(text, song.lang);
      const wordEl = document.createElement('span');
      wordEl.className = 'prompter-word word-upcoming';

      segments.forEach(seg => {
        const col = document.createElement('span');
        col.className = 'inline-flex flex-col items-start leading-none';
        if (state.showChords || seg.tag) {
          const badge = document.createElement('span');
          badge.className = 'chord-badge';
          if (seg.chord && state.showChords) badge.textContent = transposeChord(seg.chord, state.transposeSemi);
          else if (seg.tag) { badge.textContent = seg.tag; badge.classList.add('tag-badge'); }
          else { badge.classList.add('invisible'); badge.innerHTML = '&nbsp;'; }
          col.appendChild(badge);
        }
        if (seg.text) {
          const t = document.createElement('span');
          t.textContent = seg.text;
          col.appendChild(t);
        }
        wordEl.appendChild(col);
      });

      if (key) {
        const w = {
          index: counter.n++, key, common: COMMON_WORDS[song.lang].has(baseWord(text)),
          raw: text, el: wordEl, lineIdx, partIndex
        };
        wordEl.dataset.index = w.index;
        wordObjects.push(w);
        lineObj.words.push(w);
      }
      lineEl.appendChild(wordEl);
    });

    lineElements.push(lineObj);
    container.appendChild(lineEl);
  });
}

// ---------------------------------------------------------------------
// Render del tema en pantalla
// ---------------------------------------------------------------------
function renderCurrentSong() {
  if (!state.list) return;
  const songs = state.list.songs;
  if (!songs.length) return;
  state.currentSongIndex = Math.max(0, Math.min(state.currentSongIndex, songs.length - 1));
  song = songs[state.currentSongIndex];
  store.set(K.pos(state.list.id), state.currentSongIndex);

  el.bpmDisplay.textContent = song.bpm || 80;
  el.songLangBadge.textContent = song.lang === 'en' ? 'EN' : 'ES';
  el.bandNotesText.textContent = song.notes || 'Sin notas para la banda';
  applyGuideBanner();
  el.transposeIndicator.textContent = state.transposeSemi > 0 ? `+${state.transposeSemi}` : `${state.transposeSemi}`;

  const content = el.teleprompterContent;
  content.innerHTML = '';
  wordObjects = [];
  lineElements = [];
  partsInfo = [];
  state.currentWordIndex = 0;
  prevHighlight = -1;
  state.isSongFinished = false;
  state.runVoicedParts = new Set();
  hide(el.btnLearnChip);

  const top = document.createElement('div');
  top.id = 'top-spacer';
  content.appendChild(top);

  const counter = { n: 0 };
  songIsStructured = Array.isArray(song.parts);
  if (songIsStructured) {
    const names = partDisplayNames(song.parts);
    song.parts.forEach((p, i) => {
      const before = counter.n;
      if (INSTRUMENTAL_TYPES.includes(p.type)) {
        // Partes instrumentales: solo se muestran como aviso, no se siguen por voz
        const cue = document.createElement('div');
        cue.className = 'section-cue';
        const strong = document.createElement('strong');
        strong.textContent = `🎸 ${names[i].toUpperCase()}`;
        cue.appendChild(strong);
        const txt = (p.content || '').trim();
        if (txt) {
          const body = document.createElement('div');
          body.className = 'mt-1 whitespace-pre-wrap';
          body.textContent = state.showChords
            ? txt.replace(/\[([^\]]+)\]/g, (m, c) => (isChord(c.trim()) ? transposeChord(c.trim(), state.transposeSemi) : c))
            : txt.replace(/\[[^\]]+\]/g, m => (isChord(m.slice(1, -1).trim()) ? '' : m.slice(1, -1))).replace(/[ \t]+/g, ' ');
          cue.appendChild(body);
        }
        content.appendChild(cue);
        partsInfo.push({ name: names[i], type: p.type, firstWord: -1, lastWord: -1 });
        return;
      }
      const labelWrap = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'part-label';
      label.textContent = names[i];
      labelWrap.appendChild(label);
      content.appendChild(labelWrap);
      renderLines(p.content || '', i, content, counter);
      const hasWords = counter.n > before;
      partsInfo.push({ name: names[i], type: p.type, firstWord: hasWords ? before : -1, lastWord: hasWords ? counter.n - 1 : -1 });
    });
  } else {
    renderLines(song.content || '', 0, content, counter);
    partsInfo.push({ name: 'Tema', type: 'Estrofa', firstWord: counter.n ? 0 : -1, lastWord: counter.n - 1 });
  }

  const bottom = document.createElement('div');
  bottom.id = 'bottom-spacer';
  content.appendChild(bottom);

  applyFontSize();
  applySpacers();
  applyMirror();
  el.scrollWrapper.scrollTop = 0;
  highlightWords(0, { scroll: false });
  syncSongSelector();
  voice.onSongChanged();
}

function applySpacers() {
  const h = el.scrollWrapper.clientHeight || window.innerHeight;
  const top = $('top-spacer');
  const bottom = $('bottom-spacer');
  if (top) top.style.height = `${Math.round(h * state.guidePosition / 100)}px`;
  if (bottom) bottom.style.height = `${h}px`;
  el.guideOverlay.style.top = `${state.guidePosition}%`;
  el.guidePosSlider.value = state.guidePosition;
}
window.addEventListener('resize', () => { applySpacers(); positionFocalView(state.currentWordIndex, false); });

function syncSongSelector() {
  el.selectActiveSong.innerHTML = '';
  state.list.songs.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = s.title;
    if (i === state.currentSongIndex) o.selected = true;
    el.selectActiveSong.appendChild(o);
  });
}

function applyGuideBanner() {
  const hasNotes = song && song.notes && song.notes.trim();
  if (state.isGuideVisible && hasNotes) {
    el.bandNotesBanner.classList.remove('banner-collapsed');
    el.btnToggleNotesView.textContent = 'Ocultar';
  } else {
    el.bandNotesBanner.classList.add('banner-collapsed');
    el.btnToggleNotesView.textContent = 'Ver notas';
  }
  el.btnHeaderToggleGuide.classList.toggle('bg-amber-900', state.isGuideVisible);
  requestAnimationFrame(applySpacers);
}

// ---------------------------------------------------------------------
// Resaltado y posición de lectura
// ---------------------------------------------------------------------
let prevHighlight = -1;
function highlightWords(target, opts = {}) {
  const { scroll = true, fromUser = false } = opts;
  if (!wordObjects.length) { el.progressBar.style.width = '0%'; return; }
  const idx = Math.max(0, Math.min(target, wordObjects.length - 1));
  state.currentWordIndex = idx;
  if (idx < wordObjects.length - 1) state.isSongFinished = false;

  if (prevHighlight < 0) {
    wordObjects.forEach((w, i) => { w.el.className = 'prompter-word ' + (i < idx ? 'word-passed' : i === idx ? 'word-active' : 'word-upcoming'); });
  } else {
    const lo = Math.min(prevHighlight, idx), hi = Math.max(prevHighlight, idx);
    for (let i = lo; i <= hi; i++) {
      wordObjects[i].el.className = 'prompter-word ' + (i < idx ? 'word-passed' : i === idx ? 'word-active' : 'word-upcoming');
    }
  }
  prevHighlight = idx;

  if (scroll) positionFocalView(idx, true);
  const progress = wordObjects.length > 1 ? (idx / (wordObjects.length - 1)) * 100 : 100;
  el.progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;

  if (idx >= wordObjects.length - 1 && !state.isSongFinished && (state.isPlaying || fromUser)) {
    state.isSongFinished = true;
    setTimeout(() => { if (state.isSongFinished) handleSongFinished(); }, 600);
  }
}

function positionFocalView(wordIdx, smooth) {
  const w = wordObjects[wordIdx];
  if (!w) return;
  const guideY = el.scrollWrapper.clientHeight * (state.guidePosition / 100);
  const line = lineElements[w.lineIdx];
  let targetEl = w.el;
  let alignTop = false;
  if (line) {
    const pos = line.words.indexOf(w);
    if (pos >= Math.max(0, line.words.length - 2)) {
      for (let n = w.lineIdx + 1; n < lineElements.length; n++) {
        if (lineElements[n].words.length) { targetEl = lineElements[n].el; alignTop = true; break; }
      }
    }
  }
  const target = alignTop ? targetEl.offsetTop - guideY + 8 : targetEl.offsetTop - guideY + targetEl.offsetHeight / 2;
  el.scrollWrapper.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
}

// ---------------------------------------------------------------------
// Fin de tema y ventana de 20 segundos
// ---------------------------------------------------------------------
function canLearnCurrentRun() {
  return songIsStructured && state.isVoiceMode && state.runVoicedParts.size > 0;
}

function handleSongFinished() {
  const learnable = canLearnCurrentRun();
  stopPrompter();
  state.lastFinishedSongId = learnable ? song.id : null;
  el.btnLearnChip.classList.toggle('hidden', !learnable);
  el.btnAutocueLearn.classList.toggle('hidden', !learnable);

  const songs = state.list.songs;
  if (state.currentSongIndex < songs.length - 1) {
    const next = songs[state.currentSongIndex + 1];
    el.autocueNextTitle.textContent = next.title;
    el.autocueNextNotes.textContent = next.notes || 'Entrada según estructura';
    el.autocueBadgeBpm.textContent = `${next.bpm || 80} BPM`;
    el.autocueBadgeLang.textContent = next.lang === 'en' ? 'Inglés' : 'Español';
    state.autoCueRemaining = AUTOCUE_SECONDS;
    state.autoCuePaused = false;
    updateAutoCueUI();
    show(el.autocueModal);
    stageFeedback('next', `Próximo tema: ${AUTOCUE_SECONDS}s`);
    clearInterval(state.autoCueTimer);
    state.autoCueTimer = setInterval(() => {
      if (state.autoCuePaused) return;
      state.autoCueRemaining--;
      updateAutoCueUI();
      if (state.autoCueRemaining <= 0) advanceToNextSong();
    }, 1000);
  } else {
    showToast('🎉 Llegaste al final del repertorio');
    stageFeedback('pause', 'Fin del setlist');
  }
}

function updateAutoCueUI() {
  el.autocueCountdown.textContent = `${state.autoCueRemaining}s`;
  el.autocueBar.style.width = `${(state.autoCueRemaining / AUTOCUE_SECONDS) * 100}%`;
  if (state.autoCuePaused) {
    el.autocueStatusPill.textContent = 'Cuenta pausada';
    el.autocueStatusPill.className = 'font-mono text-xs text-amber-400 bg-amber-950 px-3 py-1 rounded-full border border-amber-500/40';
    el.autocueBtnIcon.textContent = '▶';
    el.autocueBtnLabel.textContent = `Reanudar cuenta (${state.autoCueRemaining}s)`;
    el.btnAutocueTogglePause.className = 'py-3.5 px-5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs sm:text-sm shadow-lg active:scale-95 transition flex items-center justify-center gap-2';
  } else {
    el.autocueStatusPill.textContent = 'Cuenta activa';
    el.autocueStatusPill.className = 'font-mono text-xs text-sky-400 bg-sky-950 px-3 py-1 rounded-full border border-sky-500/40';
    el.autocueBtnIcon.textContent = '⏸';
    el.autocueBtnLabel.textContent = `Pausar cuenta (${state.autoCueRemaining}s)`;
    el.btnAutocueTogglePause.className = 'py-3.5 px-5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs sm:text-sm shadow-lg active:scale-95 transition flex items-center justify-center gap-2';
  }
}

function closeAutoCue() {
  clearInterval(state.autoCueTimer);
  hide(el.autocueModal);
}

function toggleAutoCuePause() {
  state.autoCuePaused = !state.autoCuePaused;
  updateAutoCueUI();
  stageFeedback(state.autoCuePaused ? 'pause' : 'play', state.autoCuePaused ? 'Cuenta pausada' : 'Cuenta reanudada');
}

function returnToPreviousSong() {
  closeAutoCue();
  rewind();
  stageFeedback('prev', 'Volver al tema');
}

function loadSong(index, feedback) {
  const songs = state.list.songs;
  if (index < 0 || index >= songs.length) return;
  closeAutoCue();
  stopPrompter();
  state.currentSongIndex = index;
  state.transposeSemi = 0;
  applyPendingRemoteIfIdle();
  renderCurrentSong();
  if (feedback) stageFeedback(feedback[0], feedback[1]);
}

function advanceToNextSong() {
  if (state.currentSongIndex < state.list.songs.length - 1) {
    loadSong(state.currentSongIndex + 1, ['next', 'Siguiente tema']);
    showToast(`Cargado: ${song.title}`);
  } else {
    closeAutoCue();
  }
}

function goPrevSong() {
  if (state.currentSongIndex > 0) {
    loadSong(state.currentSongIndex - 1, ['prev', 'Tema anterior']);
    showToast(song.title);
  }
}

el.btnAutocueTogglePause.addEventListener('click', toggleAutoCuePause);
el.btnAutocueBack.addEventListener('click', returnToPreviousSong);
el.autocueNextCard.addEventListener('click', advanceToNextSong);

// ---------------------------------------------------------------------
// "Así se canta este tema" (aprendizaje confirmado, por dispositivo)
// ---------------------------------------------------------------------
function saveLearned() {
  const s = state.list.songs.find(x => x.id === state.lastFinishedSongId);
  if (!s || !Array.isArray(s.parts)) return;
  const skipped = [];
  partsInfo.forEach((p, i) => { if (p.firstWord >= 0 && !state.runVoicedParts.has(i)) skipped.push(i); });
  store.set(K.learned(state.list.id, s.id), { skipped, partsCount: s.parts.length, savedAt: new Date().toISOString() });
  hide(el.btnLearnChip);
  hide(el.btnAutocueLearn);
  state.lastFinishedSongId = null;
  showToast(skipped.length ? 'Referencia guardada: la app sabrá qué partes no llegan a la voz' : 'Referencia guardada para este tema');
}

function getLearned(s) {
  const l = store.get(K.learned(state.list.id, s.id));
  if (!l || !Array.isArray(s.parts) || l.partsCount !== s.parts.length) return null;
  return l;
}

el.btnLearnChip.addEventListener('click', saveLearned);
el.btnAutocueLearn.addEventListener('click', saveLearned);

// ---------------------------------------------------------------------
// Guía de banda
// ---------------------------------------------------------------------
function toggleBandGuide() {
  state.isGuideVisible = !state.isGuideVisible;
  applyGuideBanner();
  savePrefs();
  showToast(state.isGuideVisible ? 'Guía visible' : 'Guía oculta');
}
el.btnToggleNotesView.addEventListener('click', toggleBandGuide);
el.btnHeaderToggleGuide.addEventListener('click', toggleBandGuide);

// ---------------------------------------------------------------------
// Metrónomo
// ---------------------------------------------------------------------
let clickCtx = null;
function playClick() {
  if (!state.audioClickEnabled) return;
  try {
    if (!clickCtx) clickCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (clickCtx.state === 'suspended') clickCtx.resume();
    const osc = clickCtx.createOscillator();
    const gain = clickCtx.createGain();
    osc.connect(gain); gain.connect(clickCtx.destination);
    osc.frequency.setValueAtTime(1050, clickCtx.currentTime);
    gain.gain.setValueAtTime(0.25, clickCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, clickCtx.currentTime + 0.04);
    osc.start(); osc.stop(clickCtx.currentTime + 0.04);
  } catch (e) {}
}
function startMetronome() {
  stopMetronome();
  const ms = (60 / (song?.bpm || 80)) * 1000;
  state.metroInterval = setInterval(() => {
    el.metroLight.classList.replace('bg-slate-600', 'bg-sky-400');
    playClick();
    setTimeout(() => el.metroLight.classList.replace('bg-sky-400', 'bg-slate-600'), 85);
  }, ms);
}
function stopMetronome() {
  clearInterval(state.metroInterval);
  state.metroInterval = null;
  el.metroLight.classList.replace('bg-sky-400', 'bg-slate-600');
}
el.btnAudioClick.addEventListener('click', () => {
  state.audioClickEnabled = !state.audioClickEnabled;
  el.btnAudioClick.textContent = state.audioClickEnabled ? '🔊' : '🔈';
  showToast(state.audioClickEnabled ? 'Claqueta activada' : 'Claqueta silenciada');
});

// ---------------------------------------------------------------------
// Seguimiento por voz
// ---------------------------------------------------------------------
const tracker = {
  // Hasta dónde se busca: parte actual + la siguiente (con la referencia aprendida, salta partes sin voz)
  searchEnd() {
    const n = wordObjects.length;
    if (!n) return -1;
    const cur = state.currentWordIndex;
    if (!songIsStructured) {
      const li = wordObjects[cur].lineIdx;
      let end = Math.min(cur + 14, n - 1);
      for (let l = li + 1; l < lineElements.length; l++) {
        if (lineElements[l].words.length) { end = Math.max(end, lineElements[l].words[lineElements[l].words.length - 1].index); break; }
      }
      return Math.min(end, n - 1);
    }
    const p = wordObjects[cur].partIndex;
    const learned = getLearned(song);
    const nextWithWords = from => { for (let q = from; q < partsInfo.length; q++) if (partsInfo[q].firstWord >= 0) return q; return -1; };
    let end = partsInfo[p].lastWord;
    let q = nextWithWords(p + 1);
    if (q >= 0) {
      end = partsInfo[q].lastWord;
      if (learned && learned.skipped.includes(q)) {
        const r = nextWithWords(q + 1);
        if (r >= 0) end = partsInfo[r].lastWord;
      }
    }
    return Math.min(Math.max(end, cur), n - 1);
  },

  // tokens: palabras escuchadas (las últimas al final)
  process(rawTokens) {
    if (!wordObjects.length || state.isSongFinished) return;
    const lang = song.lang;
    const toks = rawTokens.filter(t => t && t !== '[unk]').map(t => soundKey(t, lang)).filter(Boolean).slice(-6);
    if (!toks.length) return;
    const cur = state.currentWordIndex;
    const end = this.searchEnd();

    for (let t = toks.length - 1; t >= 0; t--) {
      let best = null;
      for (let i = cur; i <= end; i++) {
        const w = wordObjects[i];
        if (w.common && i > cur + 1) continue;            // palabras comunes: solo en la posición esperada
        const s = similarity(w.key, toks[t]);
        if (!s) continue;
        let ctx = 0;                                       // el orden de lo cantado refuerza la coincidencia
        if (t > 0 && i > 0 && similarity(wordObjects[i - 1].key, toks[t - 1])) {
          ctx = 1;
          if (t > 1 && i > 1 && similarity(wordObjects[i - 2].key, toks[t - 2])) ctx = 1.5;
        }
        const dist = i - cur;
        if (dist > 6 && ctx === 0) continue;               // salto lejano: necesita que coincida también la palabra anterior
        const score = s + 0.35 * ctx - 0.02 * dist;         // prioridad a lo más cercano
        if (!best || score > best.score) best = { i, score };
      }
      if (best) {
        if (best.i > cur || (best.i === cur && !state.runVoicedParts.has(wordObjects[cur].partIndex))) {
          state.runVoicedParts.add(wordObjects[best.i].partIndex);
          if (best.i > cur) highlightWords(best.i);
        }
        return;
      }
    }
  }
};

// --- Motor Vosk (sin internet) ---
const vosk = {
  models: {},        // lang -> Promise<model>
  audioCtx: null,
  stream: null,
  source: null,
  node: null,
  recognizer: null,
  grammarKey: '',
  lang: null,
  running: false,

  loadLibrary() {
    if (window.Vosk) return Promise.resolve();
    if (this._lib) return this._lib;
    this._lib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/vosk.js';
      s.onload = () => resolve();
      s.onerror = () => { this._lib = null; reject(new Error('No se pudo cargar el motor Vosk')); };
      document.head.appendChild(s);
    });
    return this._lib;
  },

  async modelUrl(lang) {
    const m = VOSK_MODELS[lang];
    const download = async () => {
      const blobs = [];
      for (let i = 0; i < m.parts; i++) {
        setModelState(lang, `descargando ${i + 1}/${m.parts}…`);
        const res = await fetch(`${m.name}.part${i}`);
        if (!res.ok) throw new Error('Modelo no encontrado');
        blobs.push(await res.blob());
      }
      return new Blob(blobs, { type: 'application/gzip' });
    };
    let blob = null;
    try {
      if ('caches' in window) {
        const cache = await caches.open('tp-models-v1');
        const hit = await cache.match(m.name);
        if (hit) blob = await hit.blob();
        else {
          blob = await download();
          await cache.put(m.name, new Response(blob));
        }
      }
    } catch (e) { console.warn('Cache de modelos:', e); }
    if (!blob) blob = await download();
    setModelState(lang, 'cargando…');
    return URL.createObjectURL(blob);
  },

  loadModel(lang) {
    if (this.models[lang]) return this.models[lang];
    setModelState(lang, 'cargando…');
    this.models[lang] = (async () => {
      await this.loadLibrary();
      const url = await this.modelUrl(lang);
      const model = await window.Vosk.createModel(url);
      setModelState(lang, 'listo ✓');
      return model;
    })().catch(e => { this.models[lang] = null; setModelState(lang, 'error'); throw e; });
    return this.models[lang];
  },

  grammarFor(lang) {
    const end = tracker.searchEnd();
    const cur = state.currentWordIndex;
    if (end < 0) return { key: 'empty', list: ['[unk]'] };
    const firstLine = wordObjects[cur].lineIdx;
    const lastLine = wordObjects[end].lineIdx;
    const key = `${lang}:${firstLine}-${lastLine}`;
    const clean = s => s.toLowerCase().replace(lang === 'en' ? /[^a-z0-9áéíóúüñ' ]/g : /[^a-z0-9áéíóúüñ ]/g, ' ').replace(/\s+/g, ' ').trim();
    const phrases = new Set(['[unk]']);
    for (let l = firstLine; l <= lastLine; l++) {
      const line = lineElements[l];
      if (!line.words.length) continue;
      const phrase = clean(line.words.map(w => w.raw).join(' '));
      if (phrase) phrases.add(phrase);
      line.words.forEach(w => { const c = clean(w.raw); if (c) phrases.add(c); });
    }
    return { key, list: [...phrases] };
  },

  async start() {
    const lang = song.lang;
    const model = await this.loadModel(lang);
    if (!state.isPlaying || !state.isVoiceMode) return;
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
    }
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    if (!this.source) this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.lang = lang;
    this.running = true;
    this.refreshGrammar(model, true);
    if (!this.node) {
      this.node = this.audioCtx.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = ev => {
        if (!this.running || !this.recognizer) return;
        try { this.recognizer.acceptWaveform(ev.inputBuffer); } catch (e) {}
      };
      this.source.connect(this.node);
      this.node.connect(this.audioCtx.destination);
    }
    micState(true, 'Escuchando (Vosk)…');
  },

  refreshGrammar(model, force) {
    if (!this.running) return;
    const g = this.grammarFor(this.lang);
    if (!force && g.key === this.grammarKey) return;
    this.grammarKey = g.key;
    const mdl = model || this._modelCache;
    if (!mdl) return;
    this._modelCache = mdl;
    const old = this.recognizer;
    const rec = new mdl.KaldiRecognizer(this.audioCtx.sampleRate, JSON.stringify(g.list));
    rec.on('partialresult', msg => {
      const text = msg.result && msg.result.partial;
      if (text) { el.detectedTranscript.textContent = `"${text.split(' ').slice(-3).join(' ')}"`; tracker.process(text.split(/\s+/)); this.refreshGrammar(); }
    });
    rec.on('result', msg => {
      const r = msg.result || {};
      const words = Array.isArray(r.result) ? r.result.filter(w => (w.conf ?? 1) >= 0.5).map(w => w.word) : (r.text || '').split(/\s+/);
      if (words.length && words.join('')) { tracker.process(words); this.refreshGrammar(); }
    });
    this.recognizer = rec;
    if (old) { try { old.remove(); } catch (e) {} }
  },

  stop() {
    this.running = false;
    if (this.recognizer) { try { this.recognizer.remove(); } catch (e) {} this.recognizer = null; }
    this.grammarKey = '';
    if (this.node) { try { this.node.disconnect(); this.source.disconnect(); } catch (e) {} this.node = null; this.source = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  }
};

function setModelState(lang, txt) {
  const node = lang === 'es' ? el.modelStateEs : el.modelStateEn;
  if (node) node.textContent = txt ? `— ${txt}` : '';
}

// --- Motor Google (alternativo, necesita internet) ---
const google = {
  rec: null,
  running: false,
  available() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
  start() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) throw new Error('Este navegador no tiene reconocimiento de voz de Google');
    if (!this.rec) {
      this.rec = new Speech();
      this.rec.continuous = true;
      this.rec.interimResults = true;
      this.rec.onresult = e => {
        let text = '';
        for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript + ' ';
        const toks = text.trim().split(/\s+/).filter(Boolean);
        if (!toks.length) return;
        el.detectedTranscript.textContent = `"${toks.slice(-3).join(' ')}"`;
        tracker.process(toks);
      };
      this.rec.onend = () => {
        // Reinicio inmediato para no perder palabras
        if (this.running) { try { this.rec.start(); } catch (err) { setTimeout(() => { if (this.running) try { this.rec.start(); } catch (e2) {} }, 50); } }
      };
      this.rec.onerror = ev => { if (ev.error === 'not-allowed') { this.running = false; showToast('Permiso de micrófono denegado'); } };
    }
    this.rec.lang = VOICE_LANG[song.lang] || 'es-AR';
    this.running = true;
    try { this.rec.start(); } catch (e) {}
    micState(true, 'Escuchando (Google)…');
  },
  stop() {
    this.running = false;
    if (this.rec) { try { this.rec.abort(); } catch (e) {} }
  }
};

function micState(on, text) {
  el.micPing.classList.toggle('hidden', !on);
  el.micDot.classList.toggle('bg-emerald-400', on);
  el.micDot.classList.toggle('bg-slate-400', !on);
  if (text) el.detectedTranscript.textContent = text;
}

const voice = {
  active: null,
  async start() {
    if (state.engine === 'vosk') {
      try {
        el.detectedTranscript.textContent = 'Preparando voz…';
        await vosk.start();
        this.active = vosk;
        return;
      } catch (e) {
        console.warn(e);
        showToast('Vosk no está disponible aquí; se usa Google');
      }
    }
    try { google.start(); this.active = google; }
    catch (e) { showToast(e.message); micState(false, 'Voz no disponible'); }
  },
  stop() {
    vosk.stop();
    google.stop();
    this.active = null;
    micState(false);
  },
  onSongChanged() {
    if (this.active === vosk && vosk.running) {
      if (vosk.lang !== song.lang) { vosk.stop(); if (state.isPlaying) this.start(); }
      else vosk.refreshGrammar(null, true);
    }
    if (this.active === google && google.running) google.rec.lang = VOICE_LANG[song.lang];
  }
};

function setVoiceMode(enabled) {
  state.isVoiceMode = enabled;
  savePrefs();
  el.btnToggleVoice.classList.toggle('bg-sky-600', enabled);
  el.btnToggleVoice.classList.toggle('bg-slate-800', !enabled);
  el.voiceModeLabel.textContent = enabled ? 'Voz: ON' : 'Voz: OFF';
  if (state.isPlaying) {
    cancelAnimationFrame(state.animId);
    voice.stop();
    if (enabled) voice.start();
    else { state.scrollPos = el.scrollWrapper.scrollTop; state.animId = requestAnimationFrame(continuousStep); }
  }
  if (!enabled) el.detectedTranscript.textContent = 'Modo continuo';
}
el.btnToggleVoice.addEventListener('click', () => {
  setVoiceMode(!state.isVoiceMode);
  showToast(state.isVoiceMode ? 'Seguimiento por voz activado' : 'Modo de velocidad continua');
});

// ---------------------------------------------------------------------
// Modo continuo (Voz OFF)
// ---------------------------------------------------------------------
function continuousStep() {
  if (!state.isPlaying || state.isVoiceMode) return;
  state.scrollPos += state.speed * 0.5;
  el.scrollWrapper.scrollTop = state.scrollPos;
  const focalY = el.scrollWrapper.scrollTop + el.scrollWrapper.clientHeight * (state.guidePosition / 100);
  let found = state.currentWordIndex;
  for (let i = found; i < wordObjects.length; i++) {
    if (wordObjects[i].el.offsetTop <= focalY) found = i; else break;
  }
  if (found !== state.currentWordIndex) highlightWords(found, { scroll: false });
  const atEnd = el.scrollWrapper.scrollTop + el.scrollWrapper.clientHeight >= el.scrollWrapper.scrollHeight - 6;
  if (atEnd && !state.isSongFinished) { state.isSongFinished = true; handleSongFinished(); return; }
  state.animId = requestAnimationFrame(continuousStep);
}

// ---------------------------------------------------------------------
// Play / Pausa / Rebobinar
// ---------------------------------------------------------------------
function startPrompter() {
  if (!wordObjects.length) { showToast('Este tema no tiene letra'); return; }
  state.isPlaying = true;
  hide(el.btnLearnChip);
  el.playIcon.classList.add('hidden');
  el.pauseIcon.classList.remove('hidden');
  el.playLabel.textContent = 'Pausar';
  el.btnTogglePlay.classList.replace('bg-sky-600', 'bg-emerald-600');
  stageFeedback('play', 'Play');
  startMetronome();
  requestWakeLock();
  if (state.isVoiceMode) voice.start();
  else { state.scrollPos = el.scrollWrapper.scrollTop; state.animId = requestAnimationFrame(continuousStep); }
}

function stopPrompter() {
  state.isPlaying = false;
  cancelAnimationFrame(state.animId);
  stopMetronome();
  voice.stop();
  el.playIcon.classList.remove('hidden');
  el.pauseIcon.classList.add('hidden');
  el.playLabel.textContent = 'Iniciar';
  el.btnTogglePlay.classList.replace('bg-emerald-600', 'bg-sky-600');
}

function togglePlay() {
  if (state.isPlaying) { stopPrompter(); stageFeedback('pause', 'Pausa'); applyPendingRemoteIfIdle(); }
  else startPrompter();
}
el.btnTogglePlay.addEventListener('click', togglePlay);

function rewind() {
  stopPrompter();
  closeAutoCue();
  state.isSongFinished = false;
  state.runVoicedParts = new Set();
  highlightWords(0, { scroll: false });
  el.scrollWrapper.scrollTo({ top: 0, behavior: 'smooth' });
  stageFeedback('rewind', 'Inicio');
}
el.btnRewind.addEventListener('click', () => { rewind(); showToast('Rebobinado al inicio'); });

// Mantener la pantalla encendida
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) {}
}
document.addEventListener('pointerdown', requestWakeLock, { once: true });

// ---------------------------------------------------------------------
// Tono, acordes, letra, espejo, pantalla completa
// ---------------------------------------------------------------------
function changeTranspose(delta) {
  state.transposeSemi += delta;
  const keepIdx = state.currentWordIndex;
  const wasPlaying = state.isPlaying;
  const voicedBefore = state.runVoicedParts;
  rerenderKeepingPosition(keepIdx, wasPlaying, voicedBefore);
  showToast(`Tono: ${el.transposeIndicator.textContent} semitonos`);
}
function rerenderKeepingPosition(keepIdx, wasPlaying, voiced) {
  if (wasPlaying) stopPrompter();
  renderCurrentSong();
  state.runVoicedParts = voiced || new Set();
  highlightWords(keepIdx, { scroll: true });
  if (wasPlaying) startPrompter();
}
el.btnTransposeUp.addEventListener('click', () => changeTranspose(1));
el.btnTransposeDown.addEventListener('click', () => changeTranspose(-1));

function applyChordsButton() {
  el.btnToggleChords.textContent = `Acordes: ${state.showChords ? 'ON' : 'OFF'}`;
  el.btnToggleChords.classList.toggle('bg-sky-950', state.showChords);
  el.btnToggleChords.classList.toggle('bg-slate-800', !state.showChords);
}
el.btnToggleChords.addEventListener('click', () => {
  state.showChords = !state.showChords;
  applyChordsButton();
  savePrefs();
  rerenderKeepingPosition(state.currentWordIndex, state.isPlaying, state.runVoicedParts);
});

function applyFontSize() {
  el.teleprompterContent.style.fontSize = `${state.fontSize}px`;
  el.fontVal.textContent = state.fontSize;
  el.fontSlider.value = state.fontSize;
}
el.fontSlider.addEventListener('input', e => {
  state.fontSize = parseInt(e.target.value, 10);
  applyFontSize();
  positionFocalView(state.currentWordIndex, false);
  savePrefs();
});
el.speedSlider.addEventListener('input', e => { state.speed = parseFloat(e.target.value); savePrefs(); });

function applyMirror() {
  el.teleprompterContent.classList.toggle('flip-x', state.mirrorH);
  el.btnMirrorH.classList.toggle('bg-sky-600', state.mirrorH);
  el.btnMirrorH.classList.toggle('text-white', state.mirrorH);
}
el.btnMirrorH.addEventListener('click', () => { state.mirrorH = !state.mirrorH; applyMirror(); });

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    const req = document.documentElement.requestFullscreen;
    if (req) document.documentElement.requestFullscreen().catch(() => document.body.classList.toggle('focus-mode'));
    else document.body.classList.toggle('focus-mode');
  } else document.exitFullscreen();
}
el.btnFullscreen.addEventListener('click', toggleFullScreen);
el.btnExitFocus.addEventListener('click', () => document.body.classList.remove('focus-mode'));

el.teleprompterContent.addEventListener('click', e => {
  const w = e.target.closest('.prompter-word');
  if (w && w.dataset.index !== undefined) highlightWords(parseInt(w.dataset.index, 10), { fromUser: true });
});

// Franja de lectura
let draggingGuide = false;
function updateGuidePosition(percent) {
  state.guidePosition = Math.max(15, Math.min(70, Math.round(percent)));
  applySpacers();
  positionFocalView(state.currentWordIndex, false);
  savePrefs();
}
[$('handle-left'), $('handle-right')].forEach(h => {
  h.addEventListener('pointerdown', e => { draggingGuide = true; h.setPointerCapture(e.pointerId); });
  h.addEventListener('pointermove', e => {
    if (!draggingGuide) return;
    const r = el.teleprompterStage.getBoundingClientRect();
    updateGuidePosition(((e.clientY - r.top) / r.height) * 100);
  });
  h.addEventListener('pointerup', e => { draggingGuide = false; try { h.releasePointerCapture(e.pointerId); } catch (err) {} });
});
el.guidePosSlider.addEventListener('input', e => updateGuidePosition(parseInt(e.target.value, 10)));

// Navegación de temas
el.selectActiveSong.addEventListener('change', e => loadSong(parseInt(e.target.value, 10)));
el.btnPrevSong.addEventListener('click', goPrevSong);
el.btnNextSong.addEventListener('click', () => { if (state.currentSongIndex < state.list.songs.length - 1) loadSong(state.currentSongIndex + 1); });

// ---------------------------------------------------------------------
// Abrir / cambiar lista
// ---------------------------------------------------------------------
function openListDialog(canCancel) {
  el.inputListCode.value = state.list ? state.list.name : '';
  el.recentLists.innerHTML = '';
  (store.get(K.recent, []) || []).forEach(r => {
    const b = document.createElement('button');
    b.className = 'px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-200 text-xs hover:border-sky-500';
    b.textContent = r.name;
    b.addEventListener('click', () => { el.inputListCode.value = r.name; });
    el.recentLists.appendChild(b);
  });
  el.cloudStateOpen.textContent = cloudStateText();
  el.btnCancelOpenList.classList.toggle('hidden', !canCancel);
  show(el.openListModal);
  setTimeout(() => el.inputListCode.focus(), 50);
}

async function confirmOpenList() {
  const name = el.inputListCode.value.trim();
  if (!name) { showToast('Escribí el nombre de la lista'); return; }
  el.btnConfirmOpenList.disabled = true;
  el.btnConfirmOpenList.textContent = 'Abriendo…';
  const ok = await openList(name);
  el.btnConfirmOpenList.disabled = false;
  el.btnConfirmOpenList.textContent = 'Abrir lista';
  if (ok) { hide(el.openListModal); hide(el.setlistModal); }
}
el.btnConfirmOpenList.addEventListener('click', confirmOpenList);
el.inputListCode.addEventListener('keydown', e => { if (e.key === 'Enter') confirmOpenList(); });
el.btnCancelOpenList.addEventListener('click', () => hide(el.openListModal));

// ---------------------------------------------------------------------
// Editor de la lista (borrador)
// ---------------------------------------------------------------------
function draftSong() { return state.draft[state.editingIdx]; }

function updateDirty() {
  const committed = JSON.stringify(state.list.songs);
  state.dirty = JSON.stringify(state.draft) !== committed;
  if (state.dirty) store.set(K.draft(state.list.id), { savedAt: new Date().toISOString(), base: state.list.updatedAt, songs: state.draft });
  else store.del(K.draft(state.list.id));
  el.editorStatus.textContent = state.dirty ? '● Cambios sin guardar' : 'Sin cambios';
  el.editorStatus.className = `text-[10px] sm:text-xs ${state.dirty ? 'text-amber-300' : 'text-slate-400'}`;
}

function openEditor() {
  if (state.isPlaying) stopPrompter();
  const saved = store.get(K.draft(state.list.id));
  const start = () => {
    state.editingIdx = Math.min(state.currentSongIndex, state.draft.length - 1);
    el.editorListName.textContent = state.list.name;
    renderEditorList();
    renderSongEditor();
    updateDirty();
    show(el.setlistModal);
  };
  if (saved && Array.isArray(saved.songs) && JSON.stringify(saved.songs) !== JSON.stringify(state.list.songs)) {
    el.draftDate.textContent = fmtDate(saved.savedAt);
    show(el.draftModal);
    el.btnDraftContinue.onclick = () => { hide(el.draftModal); state.draft = saved.songs.map(normalizeSong); start(); };
    el.btnDraftDiscard.onclick = () => { hide(el.draftModal); store.del(K.draft(state.list.id)); state.draft = clone(state.list.songs); start(); };
    return;
  }
  state.draft = clone(state.list.songs);
  start();
}
el.btnOpenSetlist.addEventListener('click', openEditor);

function closeEditor(after) {
  if (state.dirty) {
    state.afterUnsaved = after || null;
    show(el.unsavedModal);
    return;
  }
  hide(el.setlistModal);
  state.draft = null;
  applyPendingRemoteIfIdle();
  if (after) after();
}
el.btnCloseSetlist.addEventListener('click', () => closeEditor());

el.btnUnsavedSave.addEventListener('click', async () => {
  hide(el.unsavedModal);
  await saveDraft();
  const after = state.afterUnsaved; state.afterUnsaved = null;
  closeEditor(after);
});
el.btnUnsavedDiscard.addEventListener('click', () => {
  hide(el.unsavedModal);
  store.del(K.draft(state.list.id));
  state.draft = clone(state.list.songs);
  state.dirty = false;
  const after = state.afterUnsaved; state.afterUnsaved = null;
  closeEditor(after);
});
el.btnUnsavedContinue.addEventListener('click', () => { hide(el.unsavedModal); state.afterUnsaved = null; });

async function saveDraft() {
  if (!state.dirty) { showToast('No hay cambios para guardar'); return; }
  await commitSongs(state.draft, 'Cambios guardados en la lista');
  state.draft = clone(state.list.songs);
  updateDirty();
  renderEditorList();
}
el.btnSaveList.addEventListener('click', saveDraft);

function renderEditorList() {
  const c = el.songsListContainer;
  c.innerHTML = '';
  state.draft.forEach((s, idx) => {
    const item = document.createElement('div');
    const active = idx === state.editingIdx;
    item.className = `p-2 rounded-lg border flex items-center justify-between text-xs cursor-pointer transition ${active ? 'bg-sky-950/70 border-sky-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'}`;
    const left = document.createElement('div');
    left.className = 'flex items-center gap-2 truncate flex-1 min-w-0';
    const num = document.createElement('span'); num.className = 'font-mono text-slate-500 font-bold'; num.textContent = `${idx + 1}.`;
    const title = document.createElement('span'); title.className = 'truncate font-semibold'; title.textContent = s.title;
    left.append(num, title);
    const right = document.createElement('div');
    right.className = 'flex items-center gap-1 shrink-0 ml-2';
    const lang = document.createElement('span'); lang.className = 'font-mono text-[10px] text-sky-300 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700'; lang.textContent = s.lang === 'en' ? 'EN' : 'ES';
    const up = document.createElement('button'); up.className = 'p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white'; up.textContent = '▲'; up.title = 'Mover arriba';
    const down = document.createElement('button'); down.className = 'p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white'; down.textContent = '▼'; down.title = 'Mover abajo';
    right.append(lang, up, down);
    item.append(left, right);

    item.addEventListener('click', e => { if (!e.target.closest('button')) { state.editingIdx = idx; renderEditorList(); renderSongEditor(); } });
    up.addEventListener('click', e => { e.stopPropagation(); moveSong(idx, -1); });
    down.addEventListener('click', e => { e.stopPropagation(); moveSong(idx, 1); });
    c.appendChild(item);
  });
  el.songCount.textContent = state.draft.length;
}

function moveSong(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= state.draft.length) return;
  [state.draft[idx], state.draft[j]] = [state.draft[j], state.draft[idx]];
  if (state.editingIdx === idx) state.editingIdx = j; else if (state.editingIdx === j) state.editingIdx = idx;
  renderEditorList();
  updateDirty();
}

function renderSongEditor() {
  const s = draftSong();
  if (!s) return;
  el.editSongTitle.value = s.title;
  el.editSongBpm.value = s.bpm || 80;
  el.editSongLang.value = s.lang;
  el.editSongNotes.value = s.notes || '';
  const learned = store.get(K.learned(state.list.id, s.id));
  el.learnedRow.classList.toggle('hidden', !learned);
  el.learnedRow.classList.toggle('flex', !!learned);

  const structured = Array.isArray(s.parts);
  el.legacyEditor.classList.toggle('hidden', structured);
  el.legacyEditor.classList.toggle('flex', !structured);
  el.partsEditor.classList.toggle('hidden', !structured);
  if (structured) renderPartsEditor(); else el.editSongContent.value = s.content || '';
}

function partTypeOptions(select, value) {
  select.innerHTML = '';
  [...PART_TYPES, OTHER_TYPE].forEach(t => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t === OTHER_TYPE ? 'Otro (nombre propio)…' : t;
    if (t === value) o.selected = true;
    select.appendChild(o);
  });
}

function renderPartsEditor() {
  const s = draftSong();
  const c = el.partsContainer;
  c.innerHTML = '';
  const names = partDisplayNames(s.parts);
  s.parts.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'rounded-xl border border-slate-800 bg-slate-900/70 p-2.5 flex flex-col gap-2';
    const head = document.createElement('div');
    head.className = 'flex flex-wrap items-center gap-2';
    const badge = document.createElement('span');
    badge.className = 'text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded-full px-2 py-0.5';
    badge.textContent = names[i];
    const sel = document.createElement('select');
    sel.className = 'px-2 py-1 max-w-[140px] sm:max-w-none bg-slate-950 border border-slate-700 rounded text-slate-100 text-xs';
    partTypeOptions(sel, p.type);
    const custom = document.createElement('input');
    custom.type = 'text';
    custom.placeholder = 'Nombre de la parte';
    custom.value = p.name || '';
    custom.className = `px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 text-xs ${p.type === OTHER_TYPE ? '' : 'hidden'}`;
    const spacer = document.createElement('div'); spacer.className = 'flex-1';
    const mk = (txt, title) => { const b = document.createElement('button'); b.className = 'px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs'; b.textContent = txt; b.title = title; return b; };
    const up = mk('▲', 'Subir parte'), down = mk('▼', 'Bajar parte'), del = mk('✕', 'Quitar parte');
    del.classList.add('text-rose-300');
    head.append(badge, sel, custom, spacer, up, down, del);

    const ta = document.createElement('textarea');
    ta.className = 'w-full p-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 music-font text-xs leading-relaxed focus:outline-none focus:border-sky-500 resize-y';
    ta.rows = Math.max(3, Math.min(12, (p.content || '').split('\n').length + 1));
    ta.placeholder = INSTRUMENTAL_TYPES.includes(p.type) ? 'Nota para la banda (opcional). Ejemplo: Solo de guitarra, 8 compases' : 'Letra con acordes entre corchetes. Ejemplo: De [G]vez en cuando';
    ta.value = p.content || '';

    sel.addEventListener('change', () => { p.type = sel.value; if (p.type !== OTHER_TYPE) p.name = ''; renderPartsEditor(); updateDirty(); });
    custom.addEventListener('input', () => { p.name = custom.value; badge.textContent = custom.value || 'Parte'; updateDirty(); });
    ta.addEventListener('input', () => { p.content = ta.value; updateDirty(); });
    up.addEventListener('click', () => movePart(i, -1));
    down.addEventListener('click', () => movePart(i, 1));
    del.addEventListener('click', () => {
      const doDel = () => { s.parts.splice(i, 1); renderPartsEditor(); updateDirty(); };
      if ((p.content || '').trim()) askConfirm('¿Quitar esta parte?', `Se quita "${names[i]}" con su letra.`, 'Quitar', doDel); else doDel();
    });

    card.append(head, ta);
    c.appendChild(card);
  });
}

function movePart(i, dir) {
  const parts = draftSong().parts;
  const j = i + dir;
  if (j < 0 || j >= parts.length) return;
  [parts[i], parts[j]] = [parts[j], parts[i]];
  renderPartsEditor();
  updateDirty();
}

partTypeOptions(el.newPartType, 'Estrofa');
el.btnAddPart.addEventListener('click', () => {
  const s = draftSong();
  const type = el.newPartType.value;
  s.parts.push({ id: uid('p'), type, name: '', content: '' });
  renderPartsEditor();
  updateDirty();
  const tas = el.partsContainer.querySelectorAll('textarea');
  if (tas.length) { tas[tas.length - 1].focus(); tas[tas.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' }); }
});

el.editSongTitle.addEventListener('input', () => { draftSong().title = el.editSongTitle.value; renderEditorList(); updateDirty(); });
el.editSongBpm.addEventListener('input', () => { draftSong().bpm = parseInt(el.editSongBpm.value, 10) || 80; updateDirty(); });
el.editSongLang.addEventListener('change', () => { draftSong().lang = el.editSongLang.value; renderEditorList(); updateDirty(); });
el.editSongNotes.addEventListener('input', () => { draftSong().notes = el.editSongNotes.value; updateDirty(); });
el.editSongContent.addEventListener('input', () => { draftSong().content = el.editSongContent.value; updateDirty(); });

el.btnConvertParts.addEventListener('click', () => {
  askConfirm('¿Cargar este tema por partes?', 'Toda la letra actual pasa a una primera parte (Estrofa). Después la dividís en las partes que correspondan.', 'Cargar por partes', () => {
    const s = draftSong();
    s.parts = [{ id: uid('p'), type: 'Estrofa', name: '', content: s.content || '' }];
    delete s.content;
    renderSongEditor();
    updateDirty();
  });
});

el.btnForgetLearned.addEventListener('click', () => {
  store.del(K.learned(state.list.id, draftSong().id));
  renderSongEditor();
  showToast('Referencia borrada en este dispositivo');
});

el.btnNewSong.addEventListener('click', () => {
  state.draft.push({
    id: uid('song'), title: `Nuevo tema (${state.draft.length + 1})`, bpm: 80, notes: '', lang: 'es',
    parts: [{ id: uid('p'), type: 'Estrofa', name: '', content: '' }]
  });
  state.editingIdx = state.draft.length - 1;
  renderEditorList();
  renderSongEditor();
  updateDirty();
  el.editSongTitle.focus();
  el.editSongTitle.select();
});

el.btnDeleteSong.addEventListener('click', () => {
  if (state.draft.length <= 1) { showToast('La lista tiene que tener al menos un tema'); return; }
  const s = draftSong();
  askConfirm('¿Eliminar este tema de la lista?', `Se elimina "${s.title}". Recordá guardar los cambios.`, 'Sí, eliminar', () => {
    state.draft.splice(state.editingIdx, 1);
    state.editingIdx = Math.min(state.editingIdx, state.draft.length - 1);
    renderEditorList();
    renderSongEditor();
    updateDirty();
  });
});

el.btnLoadAndExit.addEventListener('click', () => {
  const targetId = draftSong().id;
  closeEditor(() => {
    const idx = state.list.songs.findIndex(s => s.id === targetId);
    if (idx >= 0) loadSong(idx, ['play', 'Tema cargado']);
  });
});

el.btnChangeList.addEventListener('click', () => closeEditor(() => openListDialog(true)));

// Historial
async function openHistory() {
  el.historyList.innerHTML = '<p class="text-xs text-slate-400">Cargando…</p>';
  show(el.historyModal);
  let entries = null;
  if (cloud.enabled && navigator.onLine) {
    try { entries = (await cloud.listHistory(state.list.id)).slice(0, HISTORY_MAX); } catch (e) { entries = null; }
  }
  if (!entries) entries = (store.get(K.hist(state.list.id), []) || []).slice(0, HISTORY_MAX);
  el.historyList.innerHTML = '';
  if (!entries.length) { el.historyList.innerHTML = '<p class="text-xs text-slate-400">Todavía no hay versiones anteriores.</p>'; return; }
  entries.forEach(h => {
    let data; try { data = JSON.parse(h.data); } catch (e) { return; }
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2';
    const info = document.createElement('div');
    info.className = 'text-xs';
    const t1 = document.createElement('div'); t1.className = 'font-semibold text-slate-200'; t1.textContent = `${data.name || state.list.name} — ${fmtDate(h.savedAt)}`;
    const t2 = document.createElement('div'); t2.className = 'text-slate-500'; t2.textContent = `${(data.songs || []).length} temas: ${(data.songs || []).slice(0, 3).map(s => s.title).join(', ')}${(data.songs || []).length > 3 ? '…' : ''}`;
    info.append(t1, t2);
    const btn = document.createElement('button');
    btn.className = 'px-2.5 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white text-xs font-bold shrink-0';
    btn.textContent = 'Restaurar';
    btn.addEventListener('click', () => {
      askConfirm('¿Restaurar esta versión?', `La lista vuelve a como estaba el ${fmtDate(h.savedAt)}. La versión actual queda en el historial.`, 'Restaurar', async () => {
        hide(el.historyModal);
        await commitSongs(data.songs || [], 'Versión restaurada');
        state.draft = clone(state.list.songs);
        state.editingIdx = 0;
        updateDirty();
        renderEditorList();
        renderSongEditor();
      });
    });
    row.append(info, btn);
    el.historyList.appendChild(row);
  });
}
el.btnHistory.addEventListener('click', () => {
  if (state.dirty) { showToast('Guardá o descartá los cambios antes de ver el historial'); return; }
  openHistory();
});
el.btnCloseHistory.addEventListener('click', () => hide(el.historyModal));

// Exportar / Importar
el.btnExportSetlist.addEventListener('click', () => {
  const pkg = { app: 'TeleprompterProStudio', version: 4, exportedAt: new Date().toISOString(), name: state.list.name, songs: state.list.songs };
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lista_${state.list.id}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showToast('Lista exportada');
});

el.inputImportSetlist.addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let songs = null;
    try {
      const data = JSON.parse(ev.target.result);
      if (Array.isArray(data)) songs = data;
      else if (Array.isArray(data.songs)) songs = data.songs;
      else if (Array.isArray(data.playlists) && data.playlists.length) {
        const pl = data.playlists.find(p => p.id === data.activePlaylistId) || data.playlists[0];
        songs = pl.songs;
      }
    } catch (err) { songs = null; }
    if (!songs || !songs.length) { showToast('El archivo no tiene un formato válido'); return; }
    askConfirm('¿Importar este archivo?', `Trae ${songs.length} temas y reemplaza los temas del editor. Después tenés que tocar "Guardar cambios".`, 'Importar', () => {
      state.draft = songs.map(normalizeSong);
      state.editingIdx = 0;
      renderEditorList();
      renderSongEditor();
      updateDirty();
      showToast('Importado. Revisá y tocá "Guardar cambios".');
    });
  };
  reader.readAsText(file);
});

// ---------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------
el.btnSettings.addEventListener('click', () => {
  el.selectEngine.value = state.engine;
  el.cloudStateSettings.textContent = cloudStateText();
  show(el.settingsModal);
});
el.btnCloseSettings.addEventListener('click', () => hide(el.settingsModal));
el.selectEngine.addEventListener('change', () => {
  state.engine = el.selectEngine.value;
  savePrefs();
  if (state.isPlaying && state.isVoiceMode) { voice.stop(); voice.start(); }
  showToast(state.engine === 'vosk' ? 'Motor: Vosk (sin internet)' : 'Motor: Google (con internet)');
});
document.querySelectorAll('.btn-preload-model').forEach(b => {
  b.addEventListener('click', async () => {
    const lang = b.dataset.model;
    b.disabled = true;
    try { await vosk.loadModel(lang); showToast('Modelo listo en este dispositivo'); }
    catch (e) { showToast('No se pudo descargar el modelo'); }
    finally { b.disabled = false; }
  });
});

// ---------------------------------------------------------------------
// Pedal Bluetooth y teclado
// ---------------------------------------------------------------------
const FW_KEYS = ['PageDown', 'ArrowDown', 'ArrowRight', 'Space', 'Enter', ' '];
const REV_KEYS = ['PageUp', 'ArrowUp', 'ArrowLeft', 'Backspace'];
const pedal = {
  fw: { timer: null, taps: 0, holdTimer: null, holdInt: null, holding: false },
  rev: { timer: null, taps: 0, holdTimer: null, holdInt: null, holding: false }
};

function blockingModalOpen() {
  return [el.setlistModal, el.openListModal, el.historyModal, el.unsavedModal, el.draftModal, el.confirmModal, el.settingsModal].some(isShown);
}
function typingTarget(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function onFwSingle() { if (isShown(el.autocueModal)) toggleAutoCuePause(); else togglePlay(); }
function onFwDouble() {
  if (isShown(el.autocueModal) || state.currentSongIndex < state.list.songs.length - 1) advanceToNextSong();
  else { stageFeedback('pause', 'Fin del setlist'); showToast('Fin del setlist'); }
}
function onRevSingle() { if (isShown(el.autocueModal)) returnToPreviousSong(); else rewind(); }
function onRevDouble() { goPrevSong(); }

function pedalDown(p, forward) {
  if (p.holdTimer || p.holding) return;
  p.holdTimer = setTimeout(() => {
    p.holding = true;
    stageFeedback(forward ? 'forward_hold' : 'rewind_hold', forward ? 'Avance rápido' : 'Retroceso rápido');
    p.holdInt = setInterval(() => {
      const i = state.currentWordIndex + (forward ? 1 : -1);
      if (i >= 0 && i < wordObjects.length) highlightWords(i, { fromUser: true });
    }, 120);
  }, 450);
}
function pedalUp(p, single, dbl) {
  clearTimeout(p.holdTimer);
  p.holdTimer = null;
  if (p.holding) {
    clearInterval(p.holdInt);
    p.holding = false;
    p.taps = 0;
    return;
  }
  p.taps++;
  if (p.taps === 1) p.timer = setTimeout(() => { p.taps = 0; single(); }, 520);
  else { clearTimeout(p.timer); p.taps = 0; dbl(); }
}

window.addEventListener('keydown', e => {
  if (blockingModalOpen() || typingTarget(e) || !state.list) return;
  const isFw = FW_KEYS.includes(e.code) || FW_KEYS.includes(e.key);
  const isRev = REV_KEYS.includes(e.code) || REV_KEYS.includes(e.key);
  if (isFw || isRev) {
    e.preventDefault();
    if (!e.repeat) pedalDown(isFw ? pedal.fw : pedal.rev, isFw);
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'r') { rewind(); showToast('Rebobinado al inicio'); }
  else if (k === 'v') el.btnToggleVoice.click();
  else if (k === 'm') el.btnMirrorH.click();
  else if (k === 'f') toggleFullScreen();
  else if (k === 'g') toggleBandGuide();
  else if (k === 'p' || k === '[') goPrevSong();
  else if (k === 'n' || k === ']') el.btnNextSong.click();
  else if (k === '+' || k === '=') changeTranspose(1);
  else if (k === '-') changeTranspose(-1);
});
window.addEventListener('keyup', e => {
  if (blockingModalOpen() || typingTarget(e) || !state.list) return;
  const isFw = FW_KEYS.includes(e.code) || FW_KEYS.includes(e.key);
  const isRev = REV_KEYS.includes(e.code) || REV_KEYS.includes(e.key);
  if (isFw) pedalUp(pedal.fw, onFwSingle, onFwDouble);
  else if (isRev) pedalUp(pedal.rev, onRevSingle, onRevDouble);
});

// Evita que un botón o selector enfocado reciba las teclas del pedal
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) b.blur();
});
el.selectActiveSong.addEventListener('change', () => el.selectActiveSong.blur());

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------
async function init() {
  loadPrefs();
  applyFontSize();
  applyChordsButton();
  el.speedSlider.value = state.speed;
  el.guidePosSlider.value = state.guidePosition;
  setVoiceMode(state.isVoiceMode);
  el.detectedTranscript.textContent = state.isVoiceMode ? 'En espera...' : 'Modo continuo';

  const activeId = store.get(K.active);
  const recent = (store.get(K.recent, []) || []).find(r => r.id === activeId);
  if (recent) await openList(recent.name);
  else openListDialog(false);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
  }
}

// Exponer para pruebas
window.__tp = { state, tracker, soundKey, similarity, isChord, transposeChord, parseWordSegments, get words() { return wordObjects; }, get parts() { return partsInfo; } };

init();
})();
