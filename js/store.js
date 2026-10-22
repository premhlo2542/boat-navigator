// Settings (localStorage) and a tiny event bus.
const KEY = 'bn.settings.v1';

export const defaults = {
  theme: 'dark', // dark | light | contrast
  base: 'osm', // osm | dark | custom
  customTileUrl: '',
  seamarks: true,
  speedUnit: 'kn',
  distUnit: 'nm',
  coordFmt: 'ddm',
  plannedSpeedKn: 8,
  offCourseM: 200,
  arriveM: 100,
  lowAccM: 50,
  wakeLock: true,
  sound: true,
};

let settings = { ...defaults };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* corrupt or blocked: use defaults */ }

const listeners = {};
export const on = (evt, fn) => { (listeners[evt] ||= []).push(fn); };
export const emit = (evt, data) => { for (const fn of listeners[evt] || []) { try { fn(data); } catch (e) { log('error', 'listener ' + evt, e); } } };

export const getSettings = () => settings;
export function setSetting(k, v) {
  settings = { ...settings, [k]: v };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  emit('settings', k);
}

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function lsSet(key, val) {
  try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

const logBuf = [];
export function log(level, ...args) {
  logBuf.push({ t: Date.now(), level, msg: args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ') });
  if (logBuf.length > 100) logBuf.shift();
  (console[level] || console.log)('[BN]', ...args);
}
export const getLog = () => logBuf;
