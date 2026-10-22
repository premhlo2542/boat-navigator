// GPS watcher + optional device compass. Emits 'gps' (status/fix changes) and 'fix' (new position).
import { emit, log } from './store.js';

export const gps = {
  status: 'idle', // idle | asking | searching | ok | stale | lost | denied | unavailable
  fix: null, // {lat,lng,acc,speed,cog,alt,ts}
  recvAt: 0, // Date.now() of last fix
  compass: null, // degrees from device sensor, or null
  compassOn: false,
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

// ---- compass (phone heading; only meaningful if the phone is mounted aligned with the boat) ----
let lastCompassEmit = 0;
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
  if (h == null) return;
  const ang = screen.orientation?.angle || 0;
  gps.compass = (h + ang + 360) % 360;
  const now = Date.now();
  if (now - lastCompassEmit > 200) { lastCompassEmit = now; emit('compass', gps.compass); }
}

export async function enableCompass() {
  if (gps.compassOn) return true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
    }
    window.addEventListener('deviceorientationabsolute', onOrient);
    window.addEventListener('deviceorientation', onOrient);
    gps.compassOn = true;
    return true;
  } catch (e) {
    log('warn', 'compass', e);
    return false;
  }
}

export function disableCompass() {
  window.removeEventListener('deviceorientationabsolute', onOrient);
  window.removeEventListener('deviceorientation', onOrient);
  gps.compassOn = false;
  gps.compass = null;
  emit('compass', null);
}
