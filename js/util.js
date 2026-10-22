// Geodesy, formatting and small helpers. No DOM access here.
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const NM = 1852;
export const KN = 1852 / 3600; // m/s per knot

export function distM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Distance (m) of point p from leg a->b; measured to the nearer end if p is outside the leg. */
export function offTrackM(p, a, b) {
  const legLen = distM(a, b);
  if (legLen < 1) return distM(p, b);
  const d13 = distM(a, p) / R;
  const t13 = rad(bearing(a, p));
  const t12 = rad(bearing(a, b));
  const xt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12));
  const along = Math.acos(Math.min(1, Math.max(-1, Math.cos(d13) / Math.cos(xt)))) * R * Math.sign(Math.cos(t13 - t12));
  if (along < 0) return distM(p, a);
  if (along > legLen) return distM(p, b);
  return Math.abs(xt) * R;
}

export function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Parses "13.75, 100.5" style decimal coordinates. Returns null when not a coordinate pair. */
export function parseCoords(str) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(str || '');
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  return validLatLng(lat, lng) ? { lat, lng } : null;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const NA = 'ไม่มีข้อมูล';
export { NA };

export function fmtSpeed(mps, unit = 'kn') {
  if (mps == null || !Number.isFinite(mps)) return null;
  const v = unit === 'kmh' ? mps * 3.6 : unit === 'mph' ? mps * 2.23694 : mps / KN;
  return { value: v.toFixed(v < 10 ? 1 : 0), unit: unit === 'kmh' ? 'กม./ชม.' : unit === 'mph' ? 'ไมล์/ชม.' : 'นอต' };
}

export function fmtDist(m, unit = 'nm') {
  if (m == null || !Number.isFinite(m)) return null;
  if (unit === 'km') return m < 1000 ? { value: Math.round(m), unit: 'ม.' } : { value: (m / 1000).toFixed(m < 10000 ? 2 : 1), unit: 'กม.' };
  if (unit === 'mi') return m < 160 ? { value: Math.round(m), unit: 'ม.' } : { value: (m / 1609.344).toFixed(2), unit: 'ไมล์' };
  return m < NM * 0.1 ? { value: Math.round(m), unit: 'ม.' } : { value: (m / NM).toFixed(m < NM * 10 ? 2 : 1), unit: 'ไมล์ทะเล' };
}

export const joinVU = (o) => (o ? `${o.value} ${o.unit}` : NA);

export function fmtBearing(d) {
  return d == null || !Number.isFinite(d) ? null : String(Math.round(d) % 360).padStart(3, '0') + '°';
}

/** Compact {value,unit} for big HUD cells: '25' นาที, or '1:34' ชม. */
export function fmtDurCell(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 60) return { value: String(m), unit: 'นาที' };
  const h = Math.floor(m / 60);
  if (h >= 100) return { value: String(Math.floor(h / 24)), unit: 'วัน' };
  return { value: h + ':' + String(m % 60).padStart(2, '0'), unit: 'ชม.:นาที' };
}

const DIRS = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
export const dirWord = (d) => (d == null || !Number.isFinite(d) ? null : DIRS[Math.round((((d % 360) + 360) % 360) / 45) % 8]);

export function fmtDur(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 100) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

export const fmtClock = (ts) => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

function dm(v, pos, neg, fmt) {
  const h = v >= 0 ? pos : neg;
  v = Math.abs(v);
  if (fmt === 'dd') return `${v.toFixed(5)}° ${h}`;
  let d = Math.floor(v);
  const mf = (v - d) * 60;
  if (fmt === 'ddm') {
    let mm = mf.toFixed(3);
    if (parseFloat(mm) >= 60) { d += 1; mm = '0.000'; }
    return `${d}° ${mm}′ ${h}`;
  }
  let m = Math.floor(mf);
  let s = ((mf - m) * 60).toFixed(1);
  if (parseFloat(s) >= 60) { s = '0.0'; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  return `${d}° ${m}′ ${s}″ ${h}`;
}

export function fmtCoord(p, fmt = 'ddm') {
  if (!p) return null;
  return { lat: dm(p.lat, 'N', 'S', fmt), lng: dm(p.lng, 'E', 'W', fmt) };
}

export const joinCoord = (p, fmt) => {
  const c = fmtCoord(p, fmt);
  return c ? `${c.lat}  ${c.lng}` : NA;
};

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
