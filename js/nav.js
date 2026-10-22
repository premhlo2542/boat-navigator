// Active navigation (ordered target points), off-course detection and anchor watch.
import { distM, bearing, offTrackM, KN } from './util.js';
import { emit, getSettings, lsGet, lsSet } from './store.js';
import { setAlert, clearAlert } from './alerts.js';
import { gps } from './gps.js';

export const nav = {
  active: false,
  startedAt: 0,
  sogAvg: null, // smoothed speed (m/s) used for time-left / arrival estimates
  points: [], // [{lat,lng,name}]
  idx: 0, // index of current target
  legStart: null, // {lat,lng}
  routeName: '',
  info: null, // computed each fix
};

const saved = lsGet('bn.nav');
if (saved?.active && saved.points?.length) Object.assign(nav, saved, { info: null });

const persist = () => lsSet('bn.nav', nav.active ? { active: true, points: nav.points, idx: nav.idx, legStart: nav.legStart, routeName: nav.routeName, startedAt: nav.startedAt } : null);
if (nav.active && !nav.startedAt) nav.startedAt = Date.now();

/** startAt: fixed origin of the first leg; defaults to the boat's current position. */
export function startNav(points, routeName = '', startAt = null) {
  if (!points.length) return;
  nav.active = true;
  nav.points = points.map((p) => ({ lat: p.lat, lng: p.lng, name: p.name || '' }));
  nav.idx = 0;
  nav.routeName = routeName;
  nav.startedAt = Date.now();
  nav.sogAvg = null;
  nav.legStart = startAt ? { lat: startAt.lat, lng: startAt.lng } : gps.fix ? { lat: gps.fix.lat, lng: gps.fix.lng } : null;
  offCount = 0;
  persist();
  emit('nav');
  if (gps.fix) update(gps.fix);
}

export function stopNav() {
  nav.active = false;
  nav.points = [];
  nav.info = null;
  clearAlert('offcourse');
  clearAlert('arrived');
  persist();
  emit('nav');
}

let offCount = 0;

export function update(fix) {
  if (!nav.active) return;
  const s = getSettings();
  const target = nav.points[nav.idx];
  const here = { lat: fix.lat, lng: fix.lng };
  if (!nav.legStart) nav.legStart = here;
  const toNext = distM(here, target);

  // Arrival at the current target: advance, or finish on the last one.
  if (toNext <= s.arriveM && (fix.acc == null || fix.acc <= Math.max(s.lowAccM, s.arriveM))) {
    if (nav.idx < nav.points.length - 1) {
      nav.legStart = { lat: target.lat, lng: target.lng };
      nav.idx++;
      persist();
      emit('nav');
      return update(fix);
    }
    nav.info = { toNext, remaining: toNext, brg: bearing(here, target), xte: 0, eta: null, arrived: true };
    setAlert('arrived', { level: 'info', title: 'ถึงจุดหมายแล้ว', text: target.name || 'จุดหมายปลายทาง', action: { label: 'จบการนำทาง', fn: stopNav } });
    clearAlert('offcourse');
    emit('navinfo');
    return;
  }
  clearAlert('arrived');

  let remaining = toNext;
  for (let i = nav.idx; i < nav.points.length - 1; i++) remaining += distM(nav.points[i], nav.points[i + 1]);

  const xte = offTrackM(here, nav.legStart, target);
  // Smoothed speed for the estimate; below ~1 kn we fall back to the planned speed and say so (estimated=true).
  if (fix.speed != null) nav.sogAvg = nav.sogAvg == null ? fix.speed : nav.sogAvg * 0.85 + fix.speed * 0.15;
  const moving = nav.sogAvg != null && nav.sogAvg >= 0.5 * KN;
  const speedForEta = moving ? nav.sogAvg : s.plannedSpeedKn * KN;
  const leftMs = (remaining / speedForEta) * 1000;
  nav.info = { toNext, remaining, brg: bearing(here, target), xte, leftMs, eta: Date.now() + leftMs, estimated: !moving, arrived: false };

  // Off-course: needs 3 consecutive fixes beyond threshold; clears at 80% (hysteresis).
  if (xte > s.offCourseM) offCount++;
  else if (xte < s.offCourseM * 0.8) offCount = 0;
  if (offCount >= 3) {
    setAlert('offcourse', { level: 'warn', title: 'ออกนอกเส้นทาง', text: `เบี่ยงจากเส้นทางประมาณ ${Math.round(xte / 10) * 10} ม.`, action: { label: 'ตั้งเส้นทางใหม่', fn: reroute } });
  } else if (offCount === 0) clearAlert('offcourse');
  emit('navinfo');
}

/** Restart the current leg from the boat's present position. */
export function reroute() {
  if (!gps.fix) return;
  nav.legStart = { lat: gps.fix.lat, lng: gps.fix.lng };
  offCount = 0;
  clearAlert('offcourse');
  persist();
  emit('nav');
}

// ---------------- Anchor watch ----------------
export const anchor = { active: false, lat: 0, lng: 0, radius: 50 };
const savedAnchor = lsGet('bn.anchor');
if (savedAnchor?.active) Object.assign(anchor, savedAnchor);

export function setAnchor(on, radius) {
  if (on) {
    if (!gps.fix) return false;
    Object.assign(anchor, { active: true, lat: gps.fix.lat, lng: gps.fix.lng, radius: radius || anchor.radius });
  } else {
    anchor.active = false;
    clearAlert('anchor');
    clearAlert('anchorblind');
  }
  lsSet('bn.anchor', anchor.active ? anchor : null);
  emit('anchor');
  if (anchor.active) checkAnchor();
  return true;
}

export function checkAnchor() {
  if (!anchor.active) return;
  if (!gps.fix || gps.status === 'lost' || gps.status === 'stale' || gps.status === 'denied') {
    setAlert('anchorblind', { level: 'critical', title: 'Anchor Watch ตรวจสอบไม่ได้', text: 'สัญญาณ GPS ขาดหายหรือข้อมูลเก่าเกินไป' });
    return;
  }
  clearAlert('anchorblind');
  const d = distM({ lat: anchor.lat, lng: anchor.lng }, gps.fix);
  // Allow for GPS error so a noisy fix does not trip the alarm on its own.
  if (d - (gps.fix.acc || 0) > anchor.radius) {
    setAlert('anchor', { level: 'critical', title: 'เรือเคลื่อนออกนอกรัศมีสมอ', text: `ห่างจากจุดทอดสมอ ${Math.round(d)} ม. (รัศมี ${anchor.radius} ม.)` });
  } else if (d < anchor.radius * 0.9) clearAlert('anchor');
}
