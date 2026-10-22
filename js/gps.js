// GPS watcher + optional device compass. Emits 'gps' (status/fix changes) and 'fix' (new position).
import { emit, log } from './store.js';

export const gps = {
  status: 'idle', // idle | asking | searching | ok | stale | lost | denied | unavailable
  fix: null, // {lat,lng,acc,speed,cog,alt,ts}
  recvAt: 0, // Date.now() of last fix
  compass: null, // degrees from device sensor, or null
};

const STALE_MS = 10000;
const LOST_MS = 30000;
let watchId = null;
let timer = null;
let wantRunning = false;

function setStatus(s) {
  if (gps.status !== s) { gps.status = s; emit('gps', s); }
}

function onPos(pos) {
  const c = pos.coords;
  gps.recvAt = Date.now();
  gps.fix = {
    lat: c.latitude,
    lng: c.longitude,
    acc: c.accuracy,
    speed: Number.isFinite(c.speed) ? c.speed : null,
    cog: Number.isFinite(c.heading) ? c.heading : null,
    alt: Number.isFinite(c.altitude) ? c.altitude : null,
    ts: pos.timestamp || gps.recvAt,
  };
  setStatus('ok');
  emit('fix', gps.fix);
}

function onErr(err) {
  log('warn', 'geolocation error', err.code, err.message);
  if (err.code === 1) { setStatus('denied'); stop(); return; }
  if (err.code === 2) { setStatus(gps.fix ? 'lost' : 'unavailable'); return; }
  setStatus(gps.fix ? 'lost' : 'searching'); // timeout
}

function watchdog() {
  if (!gps.fix || gps.status === 'denied') return;
  const age = Date.now() - gps.recvAt;
  if (age > LOST_MS) setStatus('lost');
  else if (age > STALE_MS) setStatus('stale');
  emit('tick');
}

export function start() {
  wantRunning = true;
  if (watchId != null) return;
  if (!('geolocation' in navigator)) { setStatus('unavailable'); return; }
  setStatus(gps.fix ? gps.status : 'asking');
  watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  timer ||= setInterval(watchdog, 2000);
  if (gps.status === 'asking') setTimeout(() => { if (gps.status === 'asking') setStatus('searching'); }, 1500);
}

export function stop() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(timer);
  timer = null;
}

export const isWatching = () => watchId != null;
export const wants = () => wantRunning;

export async function permissionState() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'unknown'; }
}

// ---- compass: always attempted. Phone heading; tilt-compensated so it also works with the phone held upright ----
// gps.compassState: 'off' | 'waiting' (needs a tap on iOS) | 'on' | 'denied' | 'unsupported'
gps.compassState = 'off';
let lastCompassEmit = 0;
let compassTimer = null;
let smooth = null;

const rad = (d) => (d * Math.PI) / 180;

function tiltHeading(alpha, beta, gamma) {
  // W3C DeviceOrientation example: direction the back of the device points, tilt-compensated.
  const a = rad(alpha), b = rad(beta), g = rad(gamma);
  const cA = Math.cos(a), sA = Math.sin(a), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  const vx = -cA * sG - sA * sB * cG;
  const vy = -sA * sG + cA * sB * cG;
  let h = Math.atan2(vx, vy) * (180 / Math.PI);
  if (h < 0) h += 360;
  return h;
}

function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading; // iOS (already tilt-compensated)
  else if ((e.absolute || e.type === 'deviceorientationabsolute') && typeof e.alpha === 'number' && typeof e.beta === 'number' && typeof e.gamma === 'number') {
    h = tiltHeading(e.alpha, e.beta, e.gamma);
    if (Math.abs(e.beta) < 50) h = (h + (screen.orientation?.angle || 0)) % 360; // lying flat: follow the screen's up direction
  }
  if (h == null) return;
  if (gps.compassState !== 'on') { gps.compassState = 'on'; clearTimeout(compassTimer); emit('compassState', 'on'); }
  // circular low-pass filter
  smooth = smooth == null ? h : (smooth + (((h - smooth + 540) % 360) - 180) * 0.25 + 360) % 360;
  gps.compass = smooth;
  const now = Date.now();
  if (now - lastCompassEmit > 150) { lastCompassEmit = now; emit('compass', gps.compass); }
}

let attached = false;
function attach() {
  if (attached) return;
  attached = true;
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
  // If no usable reading arrives (desktop, no sensor), report unsupported rather than guess.
  compassTimer = setTimeout(() => { if (gps.compassState !== 'on') { gps.compassState = 'unsupported'; emit('compassState', 'unsupported'); } }, 4000);
}

/** Call at boot (works on Android) and again from a user gesture (required by iOS). Safe to call repeatedly. */
let compassBusy = false;
export async function startCompass() {
  if (gps.compassState === 'on' || gps.compassState === 'denied' || compassBusy) return gps.compassState;
  compassBusy = true;
  try {
    const D = window.DeviceOrientationEvent;
    if (typeof D === 'undefined') { gps.compassState = 'unsupported'; emit('compassState', gps.compassState); return gps.compassState; }
    if (typeof D.requestPermission === 'function') {
      // iOS: only a user gesture may ask. Outside a gesture this throws; we then wait for the next tap.
      const r = await D.requestPermission();
      if (r !== 'granted') { gps.compassState = 'denied'; emit('compassState', gps.compassState); return gps.compassState; }
    }
    attach();
    if (gps.compassState === 'off') { gps.compassState = 'waiting'; emit('compassState', gps.compassState); }
  } catch (e) {
    log('info', 'compass waiting for gesture', e);
    gps.compassState = 'waiting';
    emit('compassState', gps.compassState);
  } finally { compassBusy = false; }
  return gps.compassState;
}

export const compassOK = () => gps.compassState === 'on' && gps.compass != null;
