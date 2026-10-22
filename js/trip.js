// Trip recorder: state machine idle -> recording <-> paused -> idle, persisted to IndexedDB.
import { db } from './db.js';
import { distM, uid } from './util.js';
import { emit, getSettings, log } from './store.js';
import { toast } from './alerts.js';

export const rec = { trip: null, status: 'idle' }; // status: idle | recording | paused

const MIN_STEP_M = 8; // ignore GPS jitter smaller than this
let lastSaved = 0;
let pausedAt = 0;

function blank(name) {
  const now = Date.now();
  return { id: uid(), name: name || 'Trip ' + new Date(now).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }), startedAt: now, endedAt: null, status: 'recording', points: [], distanceM: 0, pausedMs: 0, maxSpeed: 0 };
}

async function save() {
  if (!rec.trip) return;
  try { await db.put('trips', rec.trip); lastSaved = rec.trip.points.length; } catch (e) { log('error', 'save trip', e); toast('บันทึกการเดินทางลงเครื่องไม่สำเร็จ', 'err'); }
}

export async function restore() {
  try {
    const open = (await db.all('trips')).find((t) => t.status === 'recording' || t.status === 'paused');
    if (open) {
      rec.trip = open;
      rec.status = 'paused'; // the gap while the app was closed is not trip time
      pausedAt = Date.now();
      emit('trip');
      toast('พบการบันทึกที่ค้างอยู่ — กดเล่นต่อหรือสิ้นสุด', 'warn', 5000);
    }
  } catch (e) { log('error', 'restore trip', e); }
}

export async function start(name) {
  if (rec.status !== 'idle') return;
  rec.trip = blank(name);
  rec.status = 'recording';
  await save();
  emit('trip');
}

export async function pause() {
  if (rec.status !== 'recording') return;
  rec.status = 'paused';
  rec.trip.status = 'paused';
  pausedAt = Date.now();
  await save();
  emit('trip');
}

export async function resume() {
  if (rec.status !== 'paused') return;
  rec.trip.pausedMs += Date.now() - pausedAt;
  rec.trip.status = 'recording';
  rec.status = 'recording';
  await save();
  emit('trip');
}

export async function stop() {
  if (rec.status === 'idle') return null;
  if (rec.status === 'paused') rec.trip.pausedMs += Date.now() - pausedAt;
  const t = rec.trip;
  t.status = 'done';
  t.endedAt = Date.now();
  await save();
  rec.trip = null;
  rec.status = 'idle';
  emit('trip');
  return t;
}

/** Called for every GPS fix. */
export function onFix(fix) {
  if (rec.status !== 'recording') return;
  const t = rec.trip;
  if (fix.acc != null && fix.acc > Math.max(getSettings().lowAccM, 50)) return; // too inaccurate to record
  const last = t.points[t.points.length - 1];
  if (last) {
    const step = distM({ lat: last[0], lng: last[1] }, fix);
    if (step < MIN_STEP_M) return;
    t.distanceM += step;
  }
  t.points.push([+fix.lat.toFixed(6), +fix.lng.toFixed(6), fix.ts, fix.acc != null ? Math.round(fix.acc) : null, fix.speed != null ? +fix.speed.toFixed(2) : null]);
  if (fix.speed != null && fix.speed > t.maxSpeed) t.maxSpeed = fix.speed;
  if (t.points.length - lastSaved >= 10) save();
  emit('tripPoint');
}

export function flush() { return rec.status === 'idle' ? Promise.resolve() : save(); }

export function elapsedMs(t, now = Date.now()) {
  const end = t.endedAt || (rec.trip === t && rec.status === 'paused' ? pausedAt : now);
  return Math.max(0, end - t.startedAt - t.pausedMs);
}

export function summary(t) {
  const ms = elapsedMs(t);
  // Average speed only when there is enough data to be meaningful.
  const avg = t.points.length >= 2 && ms > 60000 && t.distanceM > 50 ? t.distanceM / (ms / 1000) : null;
  return { distanceM: t.distanceM, ms, avg, max: t.maxSpeed || null };
}
