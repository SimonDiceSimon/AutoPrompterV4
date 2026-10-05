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
const APP_VERSION = '4.2';
const HISTORY_MAX = 5;
const AUTOCUE_SECONDS = 20;

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_MAP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };
// Acordes: se aceptan en cifrado americano (C, D, E…) y latino (Do, Re, Mi…)
const LATIN_TO_AM = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
const AM_TO_LATIN = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
const ROOT_RE = /^(Sol|Do|Re|Mi|Fa|La|Si|[A-G])(#|b|♯|♭)?/;
const SUFFIX_RE = /^(maj|min|m|M|dim|aug|sus|add|°|ø|\+|-)?[0-9]*(((maj|sus|add|dim|aug|no|b|#|\+|-)[0-9]*)|\([^)\s]*\))*$/;

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
  prefs: 'tp4_prefs',
  auth: 'tp42_auth',
  bands: 'tp42_bands',                       // bandas abiertas en este dispositivo
  band: id => `tp42_band_${id}`,              // copia local de la banda y sus listas
  last: 'tp42_last',                          // última banda y lista usadas
  deviceName: 'tp42_device_name'
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

function splitRoot(str) {
  const m = ROOT_RE.exec(str);
  if (!m) return null;
  const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : (m[2] || '');
  return { root: LATIN_TO_AM[m[1]] || m[1], acc, rest: str.slice(m[0].length) };
}

function isChord(s) {
  if (!s) return false;
  const slash = s.lastIndexOf('/');
  let main = s, bass = null;
  if (slash > 0) { main = s.slice(0, slash); bass = s.slice(slash + 1); }
  const r = splitRoot(main);
  if (!r || !SUFFIX_RE.test(r.rest)) return false;
  if (bass !== null) { const b = splitRoot(bass); if (!b || b.rest) return false; }
  return true;
}

// Pasa cualquier acorde (latino o americano) a americano, que es como se transpone
function toAmerican(chord) {
  const slash = chord.lastIndexOf('/');
  let main = chord, bass = '';
  if (slash > 0) { main = chord.slice(0, slash); bass = chord.slice(slash + 1); }
  const r = splitRoot(main);
  if (!r) return chord;
  let out = r.root + r.acc + r.rest;
  if (bass) { const b = splitRoot(bass); out += '/' + (b ? b.root + b.acc : bass); }
  return out;
}

// Muestra un acorde americano en el cifrado elegido
function toNotation(chordAm, notation) {
  if (notation !== 'latin') return chordAm;
  return chordAm
    .replace(/^([A-G])/, m => AM_TO_LATIN[m])
    .replace(/\/([A-G])/, (m, n) => '/' + AM_TO_LATIN[n]);
}

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

// Acorde tal como se ve en pantalla: transpuesto y en el cifrado del dispositivo
function displayChord(chord) {
  return toNotation(transposeChord(toAmerican(chord), state.transposeSemi), state.notation);
}

// Sílabas aproximadas de una palabra (para el límite de velocidad al cantar)
function countSyllables(word, lang) {
  const w = (word || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  if (!w) return 0;
  let groups = (w.match(lang === 'en' ? /[aeiouy]+/g : /[aeiou]+/g) || []).length;
  if (lang === 'en' && w.length > 3 && /[^aeiou]e$/.test(w)) groups--;
  return Math.max(1, groups);
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
// Cada dispositivo tiene una identidad anónima de Firebase (sin usuario ni contraseña).
// Estructura:  bandas/{banda}  (nombre, dispositivos, límite, lista oficial)
//              bandas/{banda}/listas/{lista}/historial/{versión}
//              bandas/{banda}/rescate/{código}   (no se puede leer; solo se verifica)
// ---------------------------------------------------------------------
function fsEnc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsEnc) } };
  const fields = {};
  Object.keys(v).forEach(k => { fields[k] = fsEnc(v[k]); });
  return { mapValue: { fields } };
}
function fsDec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsDec);
  if ('mapValue' in v) return fsFields(v.mapValue.fields || {});
  return null;
}
function fsFields(f) { const o = {}; Object.keys(f || {}).forEach(k => { o[k] = fsDec(f[k]); }); return o; }
const fsBody = obj => JSON.stringify({ fields: fsEnc(obj).mapValue.fields });
const fieldPath = (a, b) => (b === undefined ? a : `${a}.\`${b}\``);

class CloudError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

async function fetchT(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch (e) { throw new CloudError('OFFLINE', 'Sin conexión'); }
  finally { clearTimeout(t); }
}

const auth = {
  data: null,
  load() { this.data = store.get(K.auth); return this; },
  get uid() { return this.data && this.data.uid; },
  save(d) { this.data = d; store.set(K.auth, d); },
  async token() {
    const key = encodeURIComponent(window.TP_CLOUD.apiKey);
    if (this.data && this.data.idToken && Date.now() < this.data.exp - 60000) return this.data.idToken;
    if (this.data && this.data.refreshToken) {
      const res = await fetchT(`https://securetoken.googleapis.com/v1/token?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.data.refreshToken)}`
      });
      if (res.ok) {
        const j = await res.json();
        this.save({ uid: j.user_id, idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + parseInt(j.expires_in, 10) * 1000 });
        return this.data.idToken;
      }
      const txt = await res.text();
      if (!/TOKEN_EXPIRED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN|USER_DISABLED/.test(txt)) throw new CloudError('AUTH', txt);
      this.save(null); // la identidad ya no sirve: se crea una nueva (cuenta como dispositivo nuevo)
    }
    const res = await fetchT(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
    });
    if (!res.ok) {
      const txt = await res.text();
      if (/ADMIN_ONLY_OPERATION|OPERATION_NOT_ALLOWED/.test(txt)) throw new CloudError('AUTH_DISABLED', 'El acceso anónimo no está activado en Firebase');
      throw new CloudError('AUTH', txt);
    }
    const j = await res.json();
    this.save({ uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + parseInt(j.expiresIn, 10) * 1000 });
    return this.data.idToken;
  }
};

const realCloud = {
  get enabled() { const c = window.TP_CLOUD || {}; return !!(c.projectId && c.apiKey); },
  get uid() { return auth.uid; },
  async ready() { await auth.token(); return auth.uid; },
  base() { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(window.TP_CLOUD.projectId)}/databases/(default)/documents`; },
  async req(path, { method = 'GET', body, query = '', noAuth = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (!noAuth) headers.Authorization = `Bearer ${await auth.token()}`;
    const sep = query ? `?${query}` : '';
    const res = await fetchT(path.startsWith('http') ? path + sep : `${this.base()}/${path}${sep}`, { method, headers, body });
    if (res.status === 404) return null;
    if (res.status === 409) throw new CloudError('EXISTS');
    if (res.status === 403 || res.status === 401) throw new CloudError('DENIED');
    if (!res.ok) throw new CloudError('ERROR', `Nube: error ${res.status}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : {};
  },
  // --- Bandas ---
  async getBand(id) {
    const d = await this.req(`bandas/${encodeURIComponent(id)}`);
    return d ? { id, ...fsFields(d.fields) } : null;
  },
  async createBand(id, name, maxDevices, deviceInfo) {
    const uid = await this.ready();
    const doc = { name, maxDevices, officialList: '', createdAt: new Date().toISOString(), devices: { [uid]: deviceInfo } };
    await this.req('bandas', { method: 'POST', query: `documentId=${encodeURIComponent(id)}`, body: fsBody(doc) });
    return { id, ...doc };
  },
  async createRescue(id, code) {
    await this.req(`bandas/${encodeURIComponent(id)}/rescate`, { method: 'POST', query: `documentId=${encodeURIComponent(code)}`, body: fsBody({ createdAt: new Date().toISOString() }) });
  },
  async patchBand(id, obj, paths) {
    const q = paths.map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&') + '&currentDocument.exists=true';
    const d = await this.req(`bandas/${encodeURIComponent(id)}`, { method: 'PATCH', query: q, body: fsBody(obj) });
    return d ? { id, ...fsFields(d.fields) } : null;
  },
  async joinBand(id, deviceInfo) {
    const uid = await this.ready();
    return this.patchBand(id, { devices: { [uid]: deviceInfo } }, [fieldPath('devices', uid)]);
  },
  async rescueBand(id, code, deviceInfo) {
    const uid = await this.ready();
    await this.patchBand(id, { devices: { [uid]: deviceInfo }, rescueTry: code }, [fieldPath('devices', uid), 'rescueTry']);
    return this.patchBand(id, {}, ['rescueTry']); // borra el intento enseguida
  },
  async setDevice(id, uid, info) { return this.patchBand(id, info ? { devices: { [uid]: info } } : {}, [fieldPath('devices', uid)]); },
  async setBandField(id, field, value) { return this.patchBand(id, { [field]: value }, [field]); },
  // --- Listas de una banda ---
  listPath(bandId, lid) { return `bandas/${encodeURIComponent(bandId)}/listas/${encodeURIComponent(lid)}`; },
  async listLists(bandId) {
    const r = await this.req(`bandas/${encodeURIComponent(bandId)}/listas`, { query: 'pageSize=200' });
    return ((r && r.documents) || []).map(d => {
      const f = fsFields(d.fields);
      return { lid: d.name.split('/').pop(), name: f.name || '', songCount: f.songCount || 0, updatedAt: f.updatedAt || '' };
    });
  },
  async getList(bandId, lid) {
    const d = await this.req(this.listPath(bandId, lid));
    if (!d || !d.fields) return null;
    const f = fsFields(d.fields);
    try { const data = JSON.parse(f.data); return { name: data.name || f.name || lid, songs: data.songs || [], updatedAt: f.updatedAt || '' }; }
    catch (e) { return null; }
  },
  async putList(list) {
    return this.req(this.listPath(list.bandId, list.lid), { method: 'PATCH', body: fsBody({
      name: list.name, songCount: list.songs.length, updatedAt: list.updatedAt,
      data: JSON.stringify({ name: list.name, songs: list.songs })
    }) });
  },
  async addHistory(list, entry) {
    return this.req(`${this.listPath(list.bandId, list.lid)}/historial`, { method: 'POST', body: fsBody({ data: entry.data, savedAt: entry.savedAt }) });
  },
  async listHistory(list) {
    const r = await this.req(`${this.listPath(list.bandId, list.lid)}/historial`, { query: 'pageSize=100' });
    return ((r && r.documents) || []).map(d => { const f = fsFields(d.fields); return { name: d.name, savedAt: f.savedAt || '', data: f.data || '' }; })
      .sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
  },
  async deleteDoc(name) { return this.req(`https://firestore.googleapis.com/v1/${name}`, { method: 'DELETE' }); },
  async trimHistory(list) {
    const all = await this.listHistory(list);
    for (const h of all.slice(HISTORY_MAX)) { try { await this.deleteDoc(h.name); } catch (e) {} }
  },
  // --- Listas de la versión anterior (v4.0/v4.1), solo lectura ---
  async getOldList(name) {
    const d = await this.req(`listas/${encodeURIComponent(name)}`, { noAuth: true });
    if (!d || !d.fields) return null;
    try { const data = JSON.parse(fsFields(d.fields).data); return { name: data.name || name, songs: data.songs || [] }; }
    catch (e) { return null; }
  }
};

// En las pruebas se puede reemplazar por una nube simulada
const cloud = window.__TP_TEST_CLOUD__ || realCloud;

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------
const state = {
  list: null,             // { id, name, songs, updatedAt } — versión guardada
  currentSongIndex: 0,
  isPlaying: false,
  isVoiceMode: true,
  showChords: true,
  audioClickEnabled: false,
  transposeSemi: 0,
  fontSize: 32,
  chordSize: 26,
  notation: 'american',   // 'american' (C, D, E) o 'latin' (Do, Re, Mi)
  lastMatchTime: 0,        // última palabra confirmada (para el límite de salto)
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
  'bpm-display', 'btn-audio-click', 'transpose-indicator', 'btn-transpose-up', 'btn-transpose-down',
  'btn-toggle-chords', 'btn-header-toggle-guide', 'btn-toggle-voice', 'voice-mode-label', 'font-slider', 'font-val',
  'chord-slider', 'chord-val', 'btn-notation', 'guide-band', 'speed-slider', 'btn-mirror-h', 'btn-fullscreen',
  'btn-exit-focus', 'progress-bar', 'band-notes-banner', 'band-notes-text', 'btn-toggle-notes-view', 'guide-overlay',
  'guide-pos-slider', 'select-active-song', 'song-lang-badge', 'btn-prev-song', 'btn-next-song', 'btn-open-setlist',
  'header-list-name', 'btn-settings', 'detected-transcript', 'btn-learn-chip', 'toast', 'autocue-modal',
  'autocue-next-card', 'autocue-next-title', 'autocue-next-notes', 'autocue-badge-bpm', 'autocue-badge-lang',
  'autocue-countdown', 'autocue-bar', 'autocue-status-pill', 'btn-autocue-toggle-pause', 'autocue-btn-icon',
  'autocue-btn-label', 'btn-autocue-back', 'btn-autocue-learn', 'setlist-modal', 'editor-list-name', 'editor-status',
  'btn-save-list', 'btn-history', 'btn-export-setlist', 'input-import-setlist', 'btn-change-list', 'btn-close-setlist',
  'song-count', 'btn-new-song', 'songs-list-container', 'edit-song-title', 'edit-song-bpm', 'edit-song-lang',
  'edit-song-notes', 'learned-row', 'btn-forget-learned', 'legacy-editor', 'btn-convert-parts', 'edit-song-content',
  'parts-editor', 'parts-container', 'new-part-type', 'btn-add-part', 'btn-delete-song', 'btn-load-and-exit',
  'cloud-state-open', 'history-modal', 'btn-close-history', 'history-list', 'unsaved-modal', 'btn-unsaved-save',
  'btn-unsaved-discard', 'btn-unsaved-continue', 'draft-modal', 'draft-date', 'btn-draft-continue',
  'btn-draft-discard', 'confirm-modal', 'confirm-title', 'confirm-text', 'btn-confirm-cancel', 'btn-confirm-ok',
  'settings-modal', 'btn-close-settings', 'model-state-es', 'model-state-en', 'cloud-state-settings', 'btn-open-start',
  'header-version', 'voice-status', 'voice-dot', 'voice-status-text', 'mic-level', 'start-modal', 'start-version',
  'start-view-bands', 'btn-resume', 'resume-label', 'input-band-code', 'btn-enter-band', 'known-bands-wrap',
  'known-bands', 'start-view-band', 'btn-back-bands', 'band-title', 'band-lists', 'input-new-list', 'btn-new-list',
  'old-lists-box', 'old-local-lists', 'input-old-list', 'btn-import-old', 'devices-box', 'devices-count',
  'devices-list', 'btn-limit-down', 'devices-limit', 'btn-limit-up', 'start-view-create', 'create-band-name',
  'btn-create-limit-down', 'create-limit', 'btn-create-limit-up', 'btn-create-cancel', 'btn-create-band',
  'start-view-full', 'full-band-name', 'full-count', 'btn-full-retry', 'input-rescue', 'btn-rescue', 'btn-full-back',
  'start-busy', 'rescue-modal', 'rescue-code-show', 'btn-rescue-ok', 'btn-download-models', 'input-device-name',
  'btn-save-device-name', 'settings-version'
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
    fontSize: state.fontSize, chordSize: state.chordSize, notation: state.notation,
    speed: state.speed, guidePosition: state.guidePosition,
    showChords: state.showChords, isGuideVisible: state.isGuideVisible,
    isVoiceMode: state.isVoiceMode
  });
}

function loadPrefs() {
  const p = store.get(K.prefs, {}) || {};
  if (p.fontSize) state.fontSize = p.fontSize;
  if (p.chordSize) state.chordSize = p.chordSize;
  if (p.notation === 'latin' || p.notation === 'american') state.notation = p.notation;
  if (p.speed) state.speed = p.speed;
  if (p.guidePosition) state.guidePosition = p.guidePosition;
  if (typeof p.showChords === 'boolean') state.showChords = p.showChords;
  if (typeof p.isGuideVisible === 'boolean') state.isGuideVisible = p.isGuideVisible;
  if (typeof p.isVoiceMode === 'boolean') state.isVoiceMode = p.isVoiceMode;
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

// ---------------------------------------------------------------------
// Bandas y listas
// Cada lista vive dentro de una banda. En este dispositivo se guarda una copia
// (para usarla sin señal) con la clave "banda~lista".
// ---------------------------------------------------------------------
const listKey = (bandId, lid) => `${bandId}~${lid}`;

function knownBands() { return store.get(K.bands, []) || []; }
function rememberBand(band) {
  const list = knownBands().filter(b => b.id !== band.id);
  list.unshift({ id: band.id, name: band.name });
  store.set(K.bands, list.slice(0, 12));
}
function forgetBand(id) { store.set(K.bands, knownBands().filter(b => b.id !== id)); }
function cacheBand(band) { store.set(K.band(band.id), band); }
function cachedBand(id) { return store.get(K.band(id)); }

function deviceName() {
  const saved = store.get(K.deviceName);
  if (saved) return saved;
  const ua = navigator.userAgent || '';
  const kind = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : 'Dispositivo';
  return `${kind} ${new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}`;
}
function deviceInfo() { return { name: deviceName(), addedAt: new Date().toISOString() }; }

function rescueCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = n => Array.from(crypto.getRandomValues(new Uint32Array(n)), x => abc[x % abc.length]).join('');
  return `R-${pick(4)}-${pick(4)}`;
}

function saveListLocal(list) { store.set(K.list(list.id), list); }

function blankSong(n) {
  return { id: uid('song'), title: `Nuevo tema${n ? ` (${n})` : ''}`, bpm: 80, notes: '', lang: 'es',
    parts: [{ id: uid('p'), type: 'Estrofa', name: '', content: '' }] };
}

function updateHeaderName() {
  const b = state.band ? state.band.name : '';
  el.headerListName.textContent = state.list ? (b ? `${b} › ${state.list.name}` : state.list.name) : 'Elegir lista';
}

async function openListInBand(band, lid, nameHint) {
  const key = listKey(band.id, lid);
  const local = store.get(K.list(key));
  let remote = null, remoteChecked = false;
  if (cloud.enabled && navigator.onLine && !band.localOnly) {
    try { remote = await cloud.getList(band.id, lid); remoteChecked = true; }
    catch (e) { console.warn(e); if (e.code === 'DENIED') { showToast('Este dispositivo ya no está habilitado en la banda'); return false; } }
  }
  let list;
  if (remote && (!local || !store.get(K.pending(key)) || remote.updatedAt > (local.updatedAt || ''))) {
    list = { id: key, bandId: band.id, lid, ...remote };
  } else if (local) {
    list = local;
    if (remoteChecked && !remote) store.set(K.pending(key), true);
  } else {
    showToast(navigator.onLine ? 'No se encontró esa lista' : 'Sin conexión: esa lista todavía no está guardada en este dispositivo');
    return false;
  }
  list.songs = (list.songs || []).map(normalizeSong);
  if (!list.songs.length) list.songs = [blankSong()];
  if (!list.name) list.name = nameHint || 'Lista';

  stopPrompter();
  closeAutoCue();
  state.band = band;
  state.list = list;
  saveListLocal(list);
  rememberBand(band);
  store.set(K.last, { bandId: band.id, bandName: band.name, lid, listName: list.name });
  if (store.get(K.pending(key))) pushPending();
  state.currentSongIndex = Math.min(store.get(K.pos(key), 0) || 0, list.songs.length - 1);
  state.transposeSemi = 0;
  updateHeaderName();
  renderCurrentSong();
  voice.prepare();
  showToast(`${band.name} › ${list.name}`);
  return true;
}

async function createListInBand(band, name, songs) {
  const lid = uid('l');
  const list = { id: listKey(band.id, lid), bandId: band.id, lid, name, songs: (songs && songs.length ? songs : [blankSong()]).map(normalizeSong), updatedAt: new Date().toISOString() };
  saveListLocal(list);
  band.lists = [{ lid, name, songCount: list.songs.length, updatedAt: list.updatedAt }, ...(band.lists || [])];
  cacheBand(band);
  if (!band.localOnly) await pushListToCloud(list, null);
  return list;
}

async function pushListToCloud(list, historyEntry) {
  if (!cloud.enabled || (state.band && state.band.localOnly)) return;
  const queue = store.get(`${K.pending(list.id)}_hist`, []) || [];
  if (historyEntry) queue.push(historyEntry);
  store.set(`${K.pending(list.id)}_hist`, queue);
  store.set(K.pending(list.id), true);
  await pushPending(list);
}

let pushing = false;
async function pushPending(target) {
  const list = target || state.list;
  if (!cloud.enabled || !list || pushing || !navigator.onLine) return;
  const id = list.id;
  if (!store.get(K.pending(id))) return;
  pushing = true;
  try {
    const queue = store.get(`${K.pending(id)}_hist`, []) || [];
    while (queue.length) {
      await cloud.addHistory(list, queue[0]);
      queue.shift();
      store.set(`${K.pending(id)}_hist`, queue);
    }
    await cloud.putList(store.get(K.list(id)) || list);
    store.del(K.pending(id));
    cloud.trimHistory(list).catch(() => {});
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
  if (!cloud.enabled || !state.list || !navigator.onLine || (state.band && state.band.localOnly)) return;
  const id = state.list.id;
  if (store.get(K.pending(id))) { pushPending(); return; }
  try {
    const remote = await cloud.getList(state.list.bandId, state.list.lid);
    if (remote && remote.updatedAt && remote.updatedAt > (state.list.updatedAt || '')) {
      const full = { ...state.list, ...remote, songs: remote.songs.map(normalizeSong) };
      if (state.isPlaying || isShown(el.setlistModal)) { state.pendingRemote = full; return; }
      applyRemote(full);
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
  updateHeaderName();
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
  return navigator.onLine ? 'Nube conectada: las listas se comparten entre los dispositivos de la banda.' : 'Sin conexión: se usan las copias guardadas en este dispositivo.';
}

// ---------------------------------------------------------------------
// Parser de letra y acordes
// ---------------------------------------------------------------------
// Acepta acordes entre corchetes o paréntesis, incluso mezclados: [Am] (Am) [Am) (Am]
function normalizeBrackets(text) {
  return text.replace(/[\[(]([^\[\]()\s]+)[\])]/g, (m, inner) => (isChord(inner) ? `[${inner}]` : m));
}

function parseWordSegments(token) {
  const segments = [];
  const src = normalizeBrackets(token);
  const re = /\[([^\]]+)\]|([^[\]]+)/g;
  let m;
  let pending = null;
  while ((m = re.exec(src)) !== null) {
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
  const full = trimmed.match(/^\[([^\]]+)\]$/) || trimmed.match(/^\(([^)]+)\)$/);
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
          if (seg.chord && state.showChords) badge.textContent = displayChord(seg.chord);
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
          syl: countSyllables(text, song.lang),
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
  lastRowTop = null;
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
            ? normalizeBrackets(txt).replace(/\[([^\]]+)\]/g, (m, c) => (isChord(c.trim()) ? displayChord(c.trim()) : c))
            : normalizeBrackets(txt).replace(/\[[^\]]+\]/g, m => (isChord(m.slice(1, -1).trim()) ? '' : m.slice(1, -1))).replace(/[ \t]+/g, ' ');
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
  requestAnimationFrame(() => positionFocalView(0, false, true));   // la primera línea arranca dentro de la franja
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
window.addEventListener('resize', () => { applySpacers(); positionFocalView(state.currentWordIndex, false, true); });

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
  // La guía se abre/cierra con animación: al terminar, se vuelve a centrar el renglón
  clearTimeout(applyGuideBanner._t);
  applyGuideBanner._t = setTimeout(() => { applySpacers(); if (wordObjects.length) positionFocalView(state.currentWordIndex, false, true); }, 450);
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

// Mantiene centrado en la franja el renglón que se está cantando.
// Solo desplaza cuando la palabra pasa a otro renglón (no se adelanta a la línea siguiente).
let lastRowTop = null;
function positionFocalView(wordIdx, smooth, force) {
  const w = wordObjects[wordIdx];
  if (!w) return;
  const rowTop = w.el.offsetTop;
  if (!force && lastRowTop !== null && Math.abs(rowTop - lastRowTop) < 4) return;
  lastRowTop = rowTop;
  const guideY = el.scrollWrapper.clientHeight * (state.guidePosition / 100);
  // Centro del texto de la palabra (sin el acorde de arriba), medido en pantalla
  const textSpan = [...w.el.querySelectorAll(':scope > span > span')].find(x => !x.classList.contains('chord-badge')) || w.el;
  const r = textSpan.getBoundingClientRect();
  const wrap = el.scrollWrapper.getBoundingClientRect();
  const textCenter = (r.top + r.bottom) / 2 - wrap.top + el.scrollWrapper.scrollTop;
  el.scrollWrapper.scrollTo({ top: Math.max(0, textCenter - guideY), behavior: smooth ? 'smooth' : 'auto' });
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
    voice.preloadFor(next.lang);
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

    // Límite de salto: no puede avanzar más sílabas de las que se pudieron cantar
    // desde la última palabra confirmada. Velocidad máxima: 4 sílabas por pulso (BPM), tope 8 por segundo.
    const now = performance.now();
    const dt = state.lastMatchTime ? (now - state.lastMatchTime) / 1000 : 30;
    const bpm = parseInt(song.bpm, 10);
    const rate = bpm > 0 ? Math.min(8, (bpm / 60) * 4) : 8;
    const maxSyl = rate * dt + 3;

    for (let t = toks.length - 1; t >= 0; t--) {
      let best = null;
      let skipped = 0;
      for (let i = cur; i <= end; i++) {
        const w = wordObjects[i];
        if (i > cur) { skipped += wordObjects[i].syl || 1; if (skipped > maxSyl) break; }
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
        if (best.i > cur) state.lastMatchTime = now;   // solo cuenta como confirmación si avanza (no por repetir palabras viejas)
        if (best.i > cur || (best.i === cur && !state.runVoicedParts.has(wordObjects[cur].partIndex))) {
          state.runVoicedParts.add(wordObjects[best.i].partIndex);
          if (best.i > cur) { highlightWords(best.i); voiceHeard(); }
        }
        return;
      }
    }
  }
};

// --- Estado visible de la voz ---
const VOICE_STATUS = {
  off: ['vdot-off', 'Voz apagada'],
  loading: ['vdot-loading', 'Preparando voz…'],
  ready: ['vdot-ready', 'Voz lista'],
  listening: ['vdot-listening', 'En espera'],
  heard: ['vdot-heard', 'Te sigo'],
  error: ['vdot-error', 'Error de voz']
};
let voiceStatusKind = 'off';
let heardTimer = null;
function setVoiceStatus(kind, text) {
  voiceStatusKind = kind;
  const [cls, label] = VOICE_STATUS[kind] || VOICE_STATUS.off;
  el.voiceDot.className = `vdot ${cls}`;
  el.voiceStatusText.textContent = text || label;
  if (kind !== 'listening' && kind !== 'heard') el.micLevel.style.width = '0%';
}
function voiceHeard() {
  if (!vosk.running) return;
  setVoiceStatus('heard');
  clearTimeout(heardTimer);
  heardTimer = setTimeout(() => { if (vosk.running) setVoiceStatus('listening'); }, 350);
}

// --- Motor de voz: Vosk (funciona sin internet, escucha solo la letra cargada) ---
const vosk = {
  models: {},          // idioma -> Promise<modelo> (en memoria, de a uno)
  loadedLang: null,
  audioCtx: null,
  stream: null,
  source: null,
  node: null,
  recognizer: null,
  grammarKey: '',
  lang: null,
  running: false,
  _modelCache: null,
  _downloading: {},
  _levelAt: 0,

  loadLibrary() {
    if (window.Vosk) return Promise.resolve();
    if (this._lib) return this._lib;
    this._lib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/vosk.js';
      s.onload = () => resolve();
      s.onerror = () => { this._lib = null; reject(new Error('No se pudo cargar el motor de voz')); };
      document.head.appendChild(s);
    });
    return this._lib;
  },

  async cache() { return ('caches' in window) ? caches.open('tp-models-v1') : null; },

  async isDownloaded(lang) {
    try { const c = await this.cache(); return !!(c && await c.match(VOSK_MODELS[lang].name)); }
    catch (e) { return false; }
  },

  // Descarga una sola vez y deja guardado en el dispositivo (no se borra al cerrar la app)
  download(lang) {
    if (this._downloading[lang]) return this._downloading[lang];
    this._downloading[lang] = (async () => {
      const m = VOSK_MODELS[lang];
      const c = await this.cache();
      if (c) { const hit = await c.match(m.name); if (hit) { setModelState(lang, 'ok'); return hit.blob(); } }
      const blobs = [];
      for (let i = 0; i < m.parts; i++) {
        setModelState(lang, `descargando ${i + 1}/${m.parts}…`);
        if (lang === (song && song.lang) && !this.running) setVoiceStatus('loading', `Descargando voz ${i + 1}/${m.parts}…`);
        const res = await fetch(`${m.name}.part${i}`);
        if (!res.ok) throw new Error('No se pudo descargar el modelo de voz');
        blobs.push(await res.blob());
      }
      const blob = new Blob(blobs, { type: 'application/gzip' });
      if (c) { try { await c.put(m.name, new Response(blob)); } catch (e) { console.warn('No se pudo guardar el modelo', e); } }
      setModelState(lang, 'ok');
      return blob;
    })().catch(e => { setModelState(lang, 'error'); throw e; })
      .finally(() => { delete this._downloading[lang]; });
    return this._downloading[lang];
  },

  async downloadAll() {
    for (const lang of ['es', 'en']) {
      try { if (!(await this.isDownloaded(lang))) await this.download(lang); else setModelState(lang, 'ok'); }
      catch (e) { console.warn(e); }
    }
  },

  // Pasa el modelo a la memoria. Solo un idioma por vez: si había otro, lo libera.
  loadModel(lang) {
    if (this.models[lang]) return this.models[lang];
    Object.keys(this.models).forEach(other => { if (other !== lang) this.unload(other); });
    this.models[lang] = (async () => {
      await this.loadLibrary();
      const blob = await this.download(lang);
      const url = URL.createObjectURL(blob);
      const model = await window.Vosk.createModel(url);
      URL.revokeObjectURL(url);
      this.loadedLang = lang;
      return model;
    })().catch(e => { delete this.models[lang]; throw e; });
    return this.models[lang];
  },

  unload(lang) {
    const p = this.models[lang];
    if (!p) return;
    delete this.models[lang];
    if (this.loadedLang === lang) this.loadedLang = null;
    if (this.lang === lang) this._modelCache = null;
    p.then(m => { try { m.terminate(); } catch (e) {} }).catch(() => {});
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
    if (!this.models[lang] || this.loadedLang !== lang) setVoiceStatus('loading');
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
        if (!this.running) return;
        const now = performance.now();
        if (now - this._levelAt > 90) {            // barrita de nivel del micrófono
          this._levelAt = now;
          const d = ev.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += d[i] * d[i];
          const rms = Math.sqrt(sum / (d.length / 4));
          el.micLevel.style.width = `${Math.min(100, Math.round(rms * 400))}%`;
        }
        if (!this.recognizer) return;
        try { this.recognizer.acceptWaveform(ev.inputBuffer); } catch (e) {}
      };
      this.source.connect(this.node);
      this.node.connect(this.audioCtx.destination);
    }
    setVoiceStatus('listening');
    el.detectedTranscript.textContent = 'En espera…';
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

const modelStates = { es: '', en: '' };
function setModelState(lang, st) {
  modelStates[lang] = st;
  const node = lang === 'es' ? el.modelStateEs : el.modelStateEn;
  if (!node) return;
  node.textContent = st === 'ok' ? 'Descargado ✓' : st === 'error' ? 'Error al descargar' : st === 'none' ? 'No descargado' : (st || '—');
  node.className = st === 'ok' ? 'text-emerald-400 font-semibold' : st === 'error' ? 'text-rose-400' : 'text-slate-400';
}

const voice = {
  async start() {
    try {
      await vosk.start();
    } catch (e) {
      console.warn(e);
      vosk.stop();
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        setVoiceStatus('error', 'Sin micrófono');
        showToast('Falta el permiso del micrófono');
      } else if (e && e.name === 'NotFoundError') {
        setVoiceStatus('error', 'Sin micrófono');
        showToast('No se encontró un micrófono');
      } else {
        setVoiceStatus('error', navigator.onLine ? 'Error de voz' : 'Falta descargar la voz');
        showToast(navigator.onLine ? 'No se pudo iniciar la voz' : 'La voz todavía no está descargada en este dispositivo. Conectate a internet una vez.');
      }
    }
  },
  stop() {
    vosk.stop();
    if (state.isVoiceMode) {
      setVoiceStatus(vosk.loadedLang && song && vosk.loadedLang === song.lang ? 'ready' : 'off', vosk.loadedLang ? undefined : 'Voz en pausa');
    } else setVoiceStatus('off');
  },
  // Deja la voz lista antes de tocar Iniciar: descarga (una vez) y carga el idioma del tema
  prepare() {
    if (!state.isVoiceMode || !song || vosk.running) return;
    if (vosk.loadedLang === song.lang) { setVoiceStatus('ready'); return; }
    setVoiceStatus('loading');
    vosk.loadModel(song.lang)
      .then(() => { if (!vosk.running && state.isVoiceMode && song && vosk.loadedLang === song.lang) setVoiceStatus('ready'); })
      .catch(() => { if (!vosk.running) setVoiceStatus('error', navigator.onLine ? 'Error de voz' : 'Falta descargar la voz'); });
  },
  preloadFor(lang) {
    if (!state.isVoiceMode || vosk.running || vosk.loadedLang === lang) return;
    vosk.loadModel(lang).catch(() => {});
  },
  onSongChanged() {
    if (vosk.running) {
      if (vosk.lang !== song.lang) { vosk.stop(); if (state.isPlaying) this.start(); }
      else vosk.refreshGrammar(null, true);
    } else this.prepare();
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
  } else if (enabled) voice.prepare();
  if (!enabled) { setVoiceStatus('off'); el.detectedTranscript.textContent = 'Modo continuo'; }
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
  state.lastMatchTime = performance.now();
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
function applyNotationButton() {
  el.btnNotation.textContent = state.notation === 'latin' ? 'Cifrado: Do' : 'Cifrado: C';
}
el.btnNotation.addEventListener('click', () => {
  state.notation = state.notation === 'latin' ? 'american' : 'latin';
  applyNotationButton();
  savePrefs();
  rerenderKeepingPosition(state.currentWordIndex, state.isPlaying, state.runVoicedParts);
  if (isShown(el.setlistModal)) { renderChordPicker(); refreshAllPreviews(); }
  showToast(state.notation === 'latin' ? 'Cifrado latino: Do, Re, Mi' : 'Cifrado americano: C, D, E');
});
el.btnToggleChords.addEventListener('click', () => {
  state.showChords = !state.showChords;
  applyChordsButton();
  savePrefs();
  rerenderKeepingPosition(state.currentWordIndex, state.isPlaying, state.runVoicedParts);
});

function applyFontSize() {
  el.teleprompterContent.style.fontSize = `${state.fontSize}px`;
  el.teleprompterContent.style.setProperty('--chord-size', `${state.chordSize}px`);
  el.fontVal.textContent = state.fontSize;
  el.fontSlider.value = state.fontSize;
  el.chordVal.textContent = state.chordSize;
  el.chordSlider.value = state.chordSize;
  // La franja se adapta a la altura de un renglón de texto
  el.guideBand.style.height = `${Math.round(state.fontSize * 1.6)}px`;
}
el.fontSlider.addEventListener('input', e => {
  state.fontSize = parseInt(e.target.value, 10);
  applyFontSize();
  positionFocalView(state.currentWordIndex, false, true);
  savePrefs();
});
el.chordSlider.addEventListener('input', e => {
  state.chordSize = parseInt(e.target.value, 10);
  applyFontSize();
  positionFocalView(state.currentWordIndex, false, true);
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
  if (w && w.dataset.index !== undefined) { highlightWords(parseInt(w.dataset.index, 10), { fromUser: true }); state.lastMatchTime = performance.now(); }
});

// Franja de lectura
let draggingGuide = false;
function updateGuidePosition(percent) {
  state.guidePosition = Math.max(15, Math.min(70, Math.round(percent)));
  applySpacers();
  positionFocalView(state.currentWordIndex, false, true);
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
// Pantalla de inicio: siempre arranca en el código de la banda.
const startView = { band: null, pendingCode: '', createLimit: 6 };

function showStartView(name) {
  ['bands', 'band', 'create', 'full'].forEach(v => {
    const node = el[`startView${v[0].toUpperCase()}${v.slice(1)}`];
    node.classList.toggle('hidden', v !== name);
    node.classList.toggle('flex', v === name);
  });
}
function startBusy(on, text) {
  el.startBusy.classList.toggle('hidden', !on);
  if (text) el.startBusy.textContent = text;
}

function openStart(view) {
  if (state.isPlaying) stopPrompter();
  $('btn-close-start').classList.toggle('hidden', !state.list);
  closeAutoCue();
  el.startVersion.textContent = `v${APP_VERSION}`;
  el.cloudStateOpen.textContent = cloudStateText();
  const last = store.get(K.last);
  el.btnResume.classList.toggle('hidden', !last);
  if (last) el.resumeLabel.textContent = `${last.bandName} › ${last.listName}`;
  renderKnownBands();
  show(el.startModal);
  if (view === 'band' && state.band) { openBandView(state.band); }
  else { showStartView('bands'); el.inputBandCode.value = ''; }
}
function closeStart() { hide(el.startModal); startBusy(false); }

function renderKnownBands() {
  const bands = knownBands();
  el.knownBandsWrap.classList.toggle('hidden', !bands.length);
  el.knownBandsWrap.classList.toggle('flex', !!bands.length);
  el.knownBands.innerHTML = '';
  bands.forEach(b => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    const btn = document.createElement('button');
    btn.className = 'flex-1 text-left px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-100 text-sm font-semibold truncate';
    btn.textContent = `🎸 ${b.name}`;
    btn.addEventListener('click', () => enterBand(b.name));
    const x = document.createElement('button');
    x.className = 'shrink-0 w-9 h-9 rounded-xl bg-slate-900 hover:bg-rose-900 border border-slate-700 text-slate-400 hover:text-white';
    x.textContent = '✕';
    x.title = 'Quitar de este dispositivo (la banda sigue existiendo)';
    x.addEventListener('click', () => {
      askConfirm('¿Quitar de este dispositivo?', `"${b.name}" deja de aparecer acá. La banda y sus listas siguen existiendo para los demás.`, 'Quitar', () => {
        forgetBand(b.id);
        const last = store.get(K.last);
        if (last && last.bandId === b.id) store.del(K.last);
        openStart();
      });
    });
    row.append(btn, x);
    el.knownBands.appendChild(row);
  });
}

function cloudErrorText(e) {
  if (!e) return 'Error';
  if (e.code === 'AUTH_DISABLED') return 'Falta activar el acceso anónimo en Firebase (ver instrucciones).';
  if (e.code === 'OFFLINE') return 'Sin conexión a internet.';
  if (e.code === 'DENIED') return 'Acceso denegado por la nube.';
  return 'No se pudo conectar con la nube.';
}

async function enterBand(code) {
  const name = (code || '').trim();
  const id = listIdFromName(name);
  if (!id) { showToast('Escribí el código de la banda'); return; }

  if (!cloud.enabled) {            // sin nube: bandas guardadas solo en este dispositivo
    const local = cachedBand(id);
    if (local) return openBandView(local);
    startView.pendingCode = name;
    el.createBandName.textContent = name;
    el.createLimit.textContent = startView.createLimit;
    return showStartView('create');
  }

  startBusy(true, 'Conectando…');
  let band = null;
  try {
    band = await cloud.getBand(id);
  } catch (e) {
    startBusy(false);
    const cached = cachedBand(id);
    if (cached && e.code === 'OFFLINE') { showToast('Sin conexión: se muestran las listas guardadas en este dispositivo'); return openBandView(cached, true); }
    showToast(cloudErrorText(e));
    return;
  }
  startBusy(false);

  if (!band) {
    startView.pendingCode = name;
    el.createBandName.textContent = name;
    el.createLimit.textContent = startView.createLimit;
    return showStartView('create');
  }
  const uid = cloud.uid;
  const devices = band.devices || {};
  if (devices[uid]) return openBandView(band);
  if (Object.keys(devices).length < (band.maxDevices || 0)) {
    startBusy(true, 'Habilitando este dispositivo…');
    try {
      const joined = await cloud.joinBand(id, deviceInfo());
      startBusy(false);
      const b = { ...band, ...(joined || {}) };
      showToast(`Dispositivo habilitado (${Object.keys(b.devices || {}).length} de ${b.maxDevices})`);
      return openBandView(b);
    } catch (e) {
      startBusy(false);
      if (e.code !== 'DENIED') { showToast(cloudErrorText(e)); return; }
      // Se llenó justo en este momento: se cae al aviso de banda llena
    }
  }
  startView.pendingCode = name;
  el.fullBandName.textContent = band.name || name;
  el.fullCount.textContent = `${Object.keys(devices).length} de ${band.maxDevices}`;
  el.inputRescue.value = '';
  showStartView('full');
}

async function openBandView(band, offline) {
  startView.band = band;
  rememberBand(band);
  el.bandTitle.textContent = band.name;
  showStartView('band');
  el.bandLists.innerHTML = '<p class="text-xs text-slate-500">Cargando listas…</p>';
  let lists = band.lists || [];
  if (cloud.enabled && !band.localOnly && !offline) {
    try {
      lists = await cloud.listLists(band.id);
      // Actualiza también los datos de la banda (dispositivos, límite, oficial)
      const fresh = await cloud.getBand(band.id);
      if (fresh) band = { ...band, ...fresh };
    } catch (e) { console.warn(e); if (e.code === 'DENIED') { showToast('Este dispositivo ya no está habilitado en esta banda'); return openStart(); } }
  }
  band.lists = lists;
  startView.band = band;
  if (state.band && state.band.id === band.id) state.band = band;
  cacheBand(band);
  renderBandLists(band);
  renderDevices(band);
  renderOldLocalLists();
}

function renderBandLists(band) {
  const lists = [...(band.lists || [])].sort((a, b) => {
    if (a.lid === band.officialList) return -1;
    if (b.lid === band.officialList) return 1;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  el.bandLists.innerHTML = '';
  if (!lists.length) { el.bandLists.innerHTML = '<p class="text-xs text-slate-500">Todavía no hay listas. Creá la primera abajo.</p>'; return; }
  lists.forEach(l => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    const btn = document.createElement('button');
    const isCurrent = state.list && state.list.bandId === band.id && state.list.lid === l.lid;
    btn.className = `flex-1 min-w-0 text-left px-3 py-2.5 rounded-xl border text-sm ${isCurrent ? 'bg-sky-950 border-sky-500 text-white' : 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-100'}`;
    const t1 = document.createElement('div'); t1.className = 'font-semibold truncate';
    t1.textContent = `${l.lid === band.officialList ? '⭐ ' : ''}${l.name || 'Lista'}`;
    const t2 = document.createElement('div'); t2.className = 'text-[11px] text-slate-500';
    t2.textContent = `${l.songCount || 0} temas${l.updatedAt ? ' · ' + fmtDate(l.updatedAt) : ''}`;
    btn.append(t1, t2);
    btn.addEventListener('click', async () => {
      startBusy(true, 'Abriendo lista…');
      const ok = await openListInBand(band, l.lid, l.name);
      startBusy(false);
      if (ok) closeStart();
    });
    const star = document.createElement('button');
    const isOfficial = l.lid === band.officialList;
    star.className = `shrink-0 w-10 h-10 rounded-xl border ${isOfficial ? 'bg-amber-600/30 border-amber-500 text-amber-300' : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-amber-300'}`;
    star.textContent = '⭐';
    star.title = isOfficial ? 'Lista oficial de la banda' : 'Marcar como lista oficial';
    star.addEventListener('click', () => setOfficial(band, isOfficial ? '' : l.lid));
    row.append(btn, star);
    el.bandLists.appendChild(row);
  });
}

async function setOfficial(band, lid) {
  band.officialList = lid;
  if (cloud.enabled && !band.localOnly) {
    try { const b = await cloud.setBandField(band.id, 'officialList', lid); if (b) Object.assign(band, b); }
    catch (e) { showToast(cloudErrorText(e)); }
  }
  cacheBand(band);
  renderBandLists(band);
}

function renderDevices(band) {
  const devices = band.devices || {};
  const ids = Object.keys(devices);
  const max = band.maxDevices || 0;
  el.devicesCount.textContent = band.localOnly ? 'solo este dispositivo' : `${ids.length} de ${max}`;
  el.devicesLimit.textContent = max;
  el.devicesBox.classList.toggle('hidden', !!band.localOnly);
  el.devicesList.innerHTML = '';
  ids.sort((a, b) => (devices[a].addedAt || '').localeCompare(devices[b].addedAt || '')).forEach(id => {
    const d = devices[id] || {};
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2';
    const info = document.createElement('div'); info.className = 'min-w-0 text-xs';
    const n = document.createElement('div'); n.className = 'font-semibold text-slate-200 truncate';
    n.textContent = `${d.name || 'Dispositivo'}${id === cloud.uid ? ' (este)' : ''}`;
    const dt = document.createElement('div'); dt.className = 'text-slate-500'; dt.textContent = d.addedAt ? `desde ${fmtDate(d.addedAt)}` : '';
    info.append(n, dt);
    row.appendChild(info);
    if (id !== cloud.uid) {
      const rm = document.createElement('button');
      rm.className = 'shrink-0 px-2.5 py-1 rounded bg-slate-800 hover:bg-rose-800 text-slate-300 hover:text-white text-xs';
      rm.textContent = 'Quitar';
      rm.addEventListener('click', () => {
        askConfirm('¿Quitar este dispositivo?', `"${d.name || 'Dispositivo'}" ya no va a poder abrir las listas de la banda. Libera un lugar.`, 'Quitar', async () => {
          try { const b = await cloud.setDevice(band.id, id, null); if (b) { band.devices = b.devices || {}; } else delete band.devices[id]; }
          catch (e) { showToast(cloudErrorText(e)); return; }
          cacheBand(band); renderDevices(band); showToast('Dispositivo quitado');
        });
      });
      row.appendChild(rm);
    }
    el.devicesList.appendChild(row);
  });
}

async function changeLimit(delta) {
  const band = startView.band;
  if (!band) return;
  const count = Object.keys(band.devices || {}).length;
  const next = Math.max(Math.max(1, count), Math.min(50, (band.maxDevices || 1) + delta));
  if (next === band.maxDevices) { if (delta < 0) showToast('Para bajar el límite, primero quitá dispositivos'); return; }
  try { const b = await cloud.setBandField(band.id, 'maxDevices', next); band.maxDevices = b ? b.maxDevices : next; }
  catch (e) { showToast(cloudErrorText(e)); return; }
  cacheBand(band); renderDevices(band);
}
el.btnLimitUp.addEventListener('click', () => changeLimit(1));
el.btnLimitDown.addEventListener('click', () => changeLimit(-1));

// Crear banda
el.btnCreateLimitUp.addEventListener('click', () => { startView.createLimit = Math.min(50, startView.createLimit + 1); el.createLimit.textContent = startView.createLimit; });
el.btnCreateLimitDown.addEventListener('click', () => { startView.createLimit = Math.max(1, startView.createLimit - 1); el.createLimit.textContent = startView.createLimit; });
el.btnCreateCancel.addEventListener('click', () => { showStartView('bands'); el.inputBandCode.focus(); });
el.btnCreateBand.addEventListener('click', async () => {
  const name = startView.pendingCode;
  const id = listIdFromName(name);
  if (!cloud.enabled) {
    const band = { id, name, localOnly: true, lists: [], devices: {}, maxDevices: 1, officialList: '' };
    cacheBand(band);
    return openBandView(band);
  }
  startBusy(true, 'Creando la banda…');
  try {
    const band = await cloud.createBand(id, name, startView.createLimit, deviceInfo());
    const code = rescueCode();
    await cloud.createRescue(id, code);
    startBusy(false);
    el.rescueCodeShow.textContent = code;
    show(el.rescueModal);
    el.btnRescueOk.onclick = () => { hide(el.rescueModal); openBandView({ ...band, lists: [] }); };
  } catch (e) {
    startBusy(false);
    if (e.code === 'EXISTS') { showToast('Esa banda ya existe'); return enterBand(name); }
    showToast(cloudErrorText(e));
  }
});

// Banda llena / rescate
el.btnFullRetry.addEventListener('click', () => enterBand(startView.pendingCode));
el.btnFullBack.addEventListener('click', () => showStartView('bands'));
el.btnRescue.addEventListener('click', async () => {
  const code = el.inputRescue.value.trim().toUpperCase();
  if (!code) return;
  startBusy(true, 'Verificando código…');
  try {
    const b = await cloud.rescueBand(listIdFromName(startView.pendingCode), code, deviceInfo());
    startBusy(false);
    showToast('Código correcto: este dispositivo quedó habilitado');
    openBandView(b);
  } catch (e) {
    startBusy(false);
    showToast(e.code === 'DENIED' ? 'Código de rescate incorrecto' : cloudErrorText(e));
  }
});

// Listas nuevas y viejas
el.btnNewList.addEventListener('click', async () => {
  const name = el.inputNewList.value.trim();
  if (!name) { showToast('Escribí el nombre de la lista nueva'); el.inputNewList.focus(); return; }
  const band = startView.band;
  startBusy(true, 'Creando lista…');
  const list = await createListInBand(band, name);
  startBusy(false);
  el.inputNewList.value = '';
  const ok = await openListInBand(band, list.lid, name);
  if (ok) { closeStart(); openEditor(); }
});

function oldLocalLists() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('tp4_list_')) continue;
      const v = store.get(k);
      if (v && !v.bandId && Array.isArray(v.songs)) out.push(v);
    }
  } catch (e) {}
  return out;
}
function renderOldLocalLists() {
  el.oldLocalLists.innerHTML = '';
  oldLocalLists().forEach(l => {
    const b = document.createElement('button');
    b.className = 'text-left px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 hover:bg-slate-800 text-xs text-slate-200';
    b.textContent = `📥 ${l.name} (${l.songs.length} temas, guardada en este dispositivo)`;
    b.addEventListener('click', () => importOldList(l.name, l.songs));
    el.oldLocalLists.appendChild(b);
  });
}
async function importOldList(name, songs) {
  const band = startView.band;
  startBusy(true, 'Trayendo lista…');
  const list = await createListInBand(band, name, clone(songs));
  startBusy(false);
  showToast(`"${name}" copiada a ${band.name}`);
  openBandView(band);
  return list;
}
el.btnImportOld.addEventListener('click', async () => {
  const name = el.inputOldList.value.trim();
  if (!name) return;
  if (!cloud.enabled) { showToast('Sin nube configurada'); return; }
  startBusy(true, 'Buscando la lista…');
  let old = null;
  try { old = await cloud.getOldList(listIdFromName(name)); } catch (e) { startBusy(false); showToast(cloudErrorText(e)); return; }
  startBusy(false);
  if (!old) { showToast('No se encontró una lista con ese nombre exacto'); return; }
  el.inputOldList.value = '';
  importOldList(old.name || name, old.songs);
});

// Botones de la pantalla de inicio
el.btnEnterBand.addEventListener('click', () => enterBand(el.inputBandCode.value));
el.inputBandCode.addEventListener('keydown', e => { if (e.key === 'Enter') enterBand(el.inputBandCode.value); });
el.inputNewList.addEventListener('keydown', e => { if (e.key === 'Enter') el.btnNewList.click(); });
el.btnBackBands.addEventListener('click', () => openStart());
el.btnResume.addEventListener('click', async () => {
  const last = store.get(K.last);
  if (!last) return;
  startBusy(true, 'Abriendo…');
  let band = cachedBand(last.bandId) || { id: last.bandId, name: last.bandName };
  if (cloud.enabled && !band.localOnly && navigator.onLine) {
    try { const fresh = await cloud.getBand(last.bandId); if (fresh) band = { ...band, ...fresh }; } catch (e) { /* sin señal: se usa la copia */ }
  }
  const ok = await openListInBand(band, last.lid, last.listName);
  startBusy(false);
  if (ok) closeStart();
});
el.btnOpenStart.addEventListener('click', () => openStart(state.band ? 'band' : undefined));
$('btn-close-start').addEventListener('click', () => { if (state.list) closeStart(); });

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
    renderChordPicker();
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
  if (structured) renderPartsEditor(); else { el.editSongContent.value = s.content || ''; buildPreview($('legacy-preview'), el.editSongContent.value); }
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
    ta.className = 'lyrics-input w-full p-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 music-font text-xs leading-relaxed focus:outline-none focus:border-sky-500 resize-y';
    ta.rows = Math.max(3, Math.min(12, (p.content || '').split('\n').length + 1));
    ta.placeholder = INSTRUMENTAL_TYPES.includes(p.type) ? 'Nota para la banda (opcional). Ejemplo: Solo de guitarra, 8 compases' : 'Letra. Para los acordes usá el selector de arriba, o escribilos entre corchetes o paréntesis: De [G]vez en cuando';
    ta.value = p.content || '';

    sel.addEventListener('change', () => { p.type = sel.value; if (p.type !== OTHER_TYPE) p.name = ''; renderPartsEditor(); updateDirty(); });
    custom.addEventListener('input', () => { p.name = custom.value; badge.textContent = custom.value || 'Parte'; updateDirty(); });
    const preview = document.createElement('div');
    preview.className = 'chord-preview';
    buildPreview(preview, ta.value);
    ta.addEventListener('input', () => { p.content = ta.value; updateDirty(); schedulePreview(preview, ta); });
    up.addEventListener('click', () => movePart(i, -1));
    down.addEventListener('click', () => movePart(i, 1));
    del.addEventListener('click', () => {
      const doDel = () => { s.parts.splice(i, 1); renderPartsEditor(); updateDirty(); };
      if ((p.content || '').trim()) askConfirm('¿Quitar esta parte?', `Se quita "${names[i]}" con su letra.`, 'Quitar', doDel); else doDel();
    });

    card.append(head, ta, preview);
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
el.editSongContent.addEventListener('input', () => { draftSong().content = el.editSongContent.value; updateDirty(); schedulePreview($('legacy-preview'), el.editSongContent); });

el.btnConvertParts.addEventListener('click', () => {
  askConfirm('¿Cargar este tema por partes?', 'Toda la letra actual pasa a una primera parte (Estrofa). Después la dividís en las partes que correspondan.', 'Cargar por partes', () => {
    const s = draftSong();
    s.parts = [{ id: uid('p'), type: 'Estrofa', name: '', content: s.content || '' }];
    delete s.content;
    renderSongEditor();
    updateDirty();
  });
});

// ---------------------------------------------------------------------
// Vista previa de cada parte (como se va a ver en pantalla, sin transponer)
// ---------------------------------------------------------------------
function buildPreview(container, text) {
  if (!container) return;
  container.innerHTML = '';
  const src = (text || '').replace(/\s+$/, '');
  if (!src.trim()) return;
  const title = document.createElement('div');
  title.className = 'pv-title';
  title.textContent = 'Vista previa';
  container.appendChild(title);
  src.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) { const gap = document.createElement('div'); gap.style.height = '8px'; container.appendChild(gap); return; }
    if (isCueLine(trimmed)) {
      const cue = document.createElement('div'); cue.className = 'pv-cue'; cue.textContent = trimmed.replace(/^[[(]|[\])]$/g, '');
      container.appendChild(cue); return;
    }
    const lineEl = document.createElement('div');
    lineEl.className = 'pv-line';
    trimmed.split(/\s+/).forEach(tok => {
      const word = document.createElement('span');
      word.className = 'pv-word';
      parseWordSegments(tok).forEach(seg => {
        const col = document.createElement('span'); col.className = 'pv-col';
        const ch = document.createElement('span'); ch.className = 'pv-chord';
        if (seg.chord) ch.textContent = toNotation(toAmerican(seg.chord), state.notation);
        else if (seg.tag) { ch.textContent = seg.tag; ch.classList.add('pv-tag'); }
        else ch.innerHTML = '&nbsp;';
        const tx = document.createElement('span'); tx.textContent = seg.text || '';
        col.append(ch, tx);
        word.appendChild(col);
      });
      lineEl.appendChild(word);
    });
    container.appendChild(lineEl);
  });
}

const previewTimers = new WeakMap();
function schedulePreview(container, ta) {
  clearTimeout(previewTimers.get(container));
  previewTimers.set(container, setTimeout(() => buildPreview(container, ta.value), 150));
}

function refreshAllPreviews() {
  const s = state.draft && draftSong();
  if (!s) return;
  if (Array.isArray(s.parts)) renderPartsEditor();
  else buildPreview($('legacy-preview'), el.editSongContent.value);
}

// ---------------------------------------------------------------------
// Selector de acordes
// ---------------------------------------------------------------------
const PICK_QUALITIES = [['', 'Mayor'], ['m', 'menor'], ['7', '7'], ['m7', 'm7'], ['maj7', 'maj7'], ['sus4', 'sus4'], ['sus2', 'sus2'], ['6', '6'], ['9', '9'], ['add9', 'add9'], ['dim', 'dim'], ['aug', 'aug']];
const picker = { root: null, acc: '', qual: '', target: null, start: 0, end: 0 };

function pickedChord() {
  const free = $('picker-free').value.trim().replace(/^[[(]|[\])]$/g, '').trim();
  if (free) return free;
  if (!picker.root) return '';
  const r = state.notation === 'latin' ? AM_TO_LATIN[picker.root] : picker.root;
  return r + picker.acc + picker.qual;
}

function updatePickerLabel() {
  const c = pickedChord();
  $('btn-picker-insert').textContent = c ? `Insertar ${c}` : 'Insertar';
}

function pickerButton(label, on, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'picker-btn' + (on ? ' on' : '');
  b.textContent = label;
  b.addEventListener('mousedown', e => e.preventDefault());   // no le saca el foco a la letra (computadora)
  b.addEventListener('click', onClick);
  return b;
}

function renderChordPicker() {
  const roots = $('picker-roots'), accs = $('picker-acc'), quals = $('picker-qual');
  roots.innerHTML = ''; accs.innerHTML = ''; quals.innerHTML = '';
  ['C', 'D', 'E', 'F', 'G', 'A', 'B'].forEach(n => {
    const label = state.notation === 'latin' ? AM_TO_LATIN[n] : n;
    roots.appendChild(pickerButton(label, picker.root === n, () => { picker.root = picker.root === n ? null : n; $('picker-free').value = ''; renderChordPicker(); }));
  });
  [['#', '♯'], ['b', '♭']].forEach(([v, label]) => {
    accs.appendChild(pickerButton(label, picker.acc === v, () => { picker.acc = picker.acc === v ? '' : v; renderChordPicker(); }));
  });
  PICK_QUALITIES.forEach(([v, label]) => {
    quals.appendChild(pickerButton(label, picker.qual === v, () => { picker.qual = v; renderChordPicker(); }));
  });
  updatePickerLabel();
}

// Recuerda en qué letra y en qué lugar estaba el cursor
document.addEventListener('selectionchange', () => {
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains('lyrics-input')) {
    picker.target = a; picker.start = a.selectionStart; picker.end = a.selectionEnd;
  }
});
document.addEventListener('focusin', e => {
  if (e.target.classList && e.target.classList.contains('lyrics-input')) picker.target = e.target;
});

function insertPickedChord() {
  const chord = pickedChord();
  if (!chord) { showToast('Elegí una nota (y si hace falta, el tipo de acorde)'); return; }
  if (!isChord(chord)) { showToast(`No reconozco "${chord}" como acorde`); return; }
  const ta = picker.target;
  if (!ta || !document.body.contains(ta)) { showToast('Tocá primero en la letra, justo antes de la sílaba donde va el acorde'); return; }
  const pos = Math.min(picker.start ?? ta.value.length, ta.value.length);
  const ins = `[${chord}]`;
  ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(pos);
  picker.start = picker.end = pos + ins.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
    ta.focus();
    ta.setSelectionRange(picker.start, picker.start);
  }
  $('picker-free').value = '';
  updatePickerLabel();
  showToast(`Acorde ${chord} insertado`);
}

$('btn-picker-insert').addEventListener('mousedown', e => e.preventDefault());
$('btn-picker-insert').addEventListener('click', insertPickedChord);
$('picker-free').addEventListener('input', updatePickerLabel);
$('picker-free').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); insertPickedChord(); } });
$('btn-picker-toggle').addEventListener('click', () => {
  const body = $('picker-body');
  body.classList.toggle('hidden');
  $('btn-picker-toggle').textContent = body.classList.contains('hidden') ? 'Mostrar' : 'Ocultar';
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

el.btnChangeList.addEventListener('click', () => closeEditor(() => openStart('band')));

// Historial
async function openHistory() {
  el.historyList.innerHTML = '<p class="text-xs text-slate-400">Cargando…</p>';
  show(el.historyModal);
  let entries = null;
  if (cloud.enabled && navigator.onLine) {
    try {
      const remote = await cloud.listHistory(state.list);
      const local = store.get(K.hist(state.list.id), []) || [];
      const seen = new Set();
      entries = [...remote, ...local].filter(h => { if (seen.has(h.savedAt)) return false; seen.add(h.savedAt); return true; })
        .sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1)).slice(0, HISTORY_MAX);
    } catch (e) { entries = null; }
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
async function refreshModelStates() {
  for (const lang of ['es', 'en']) {
    if (String(modelStates[lang]).startsWith('descargando')) continue;
    setModelState(lang, (await vosk.isDownloaded(lang)) ? 'ok' : (modelStates[lang] === 'error' ? 'error' : 'none'));
  }
  el.btnDownloadModels.classList.toggle('hidden', modelStates.es === 'ok' && modelStates.en === 'ok');
}
el.btnSettings.addEventListener('click', () => {
  el.cloudStateSettings.textContent = cloudStateText();
  el.inputDeviceName.value = deviceName();
  el.settingsVersion.textContent = `v${APP_VERSION}`;
  refreshModelStates();
  show(el.settingsModal);
});
el.btnCloseSettings.addEventListener('click', () => hide(el.settingsModal));
el.btnDownloadModels.addEventListener('click', async () => {
  el.btnDownloadModels.disabled = true;
  await vosk.downloadAll();
  el.btnDownloadModels.disabled = false;
  refreshModelStates();
});
el.btnSaveDeviceName.addEventListener('click', async () => {
  const name = el.inputDeviceName.value.trim().slice(0, 30);
  if (!name) return;
  store.set(K.deviceName, name);
  showToast('Nombre guardado');
  if (state.band && !state.band.localOnly && cloud.enabled && cloud.uid && state.band.devices && state.band.devices[cloud.uid]) {
    try {
      const b = await cloud.setDevice(state.band.id, cloud.uid, { ...state.band.devices[cloud.uid], name });
      if (b) { state.band = { ...state.band, ...b }; cacheBand(state.band); }
    } catch (e) { console.warn(e); }
  }
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
  return [el.setlistModal, el.startModal, el.rescueModal, el.historyModal, el.unsavedModal, el.draftModal, el.confirmModal, el.settingsModal].some(isShown);
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
      if (i >= 0 && i < wordObjects.length) { highlightWords(i, { fromUser: true }); state.lastMatchTime = performance.now(); }
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
  applyNotationButton();
  el.speedSlider.value = state.speed;
  el.guidePosSlider.value = state.guidePosition;
  setVoiceMode(state.isVoiceMode);
  el.detectedTranscript.textContent = state.isVoiceMode ? 'En espera...' : 'Modo continuo';

  auth.load();
  el.headerVersion.textContent = `v${APP_VERSION}`;
  updateHeaderName();
  setVoiceStatus(state.isVoiceMode ? 'off' : 'off', state.isVoiceMode ? 'Voz: elegí una lista' : 'Voz apagada');
  openStart();   // siempre arranca en la pantalla del código de la banda
  // Descarga la voz (los dos idiomas) apenas se abre, una sola vez por dispositivo
  setTimeout(() => { refreshModelStates(); if (navigator.onLine) vosk.downloadAll().then(refreshModelStates); }, 1500);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
  }
}

// Exponer para pruebas
window.__tp = { state, tracker, soundKey, similarity, isChord, transposeChord, parseWordSegments, get words() { return wordObjects; }, get parts() { return partsInfo; } };

init();
})();
