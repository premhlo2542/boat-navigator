// App bootstrap: wires GPS, map, HUD, search, alerts, pages.
import { app, $ } from './app.js';
import { db, requestPersistence } from './db.js';
import { on, emit, getSettings as S, log, lsGet, lsSet } from './store.js';
import { gps, start as gpsStart, stop as gpsStop, isWatching, wants, permissionState, startCompass, compassOK } from './gps.js';
import { setAlert, clearAlert, toast } from './alerts.js';
import { nav, update as navUpdate, stopNav, startNav, anchor, setAnchor, checkAnchor } from './nav.js';
import * as trip from './trip.js';
import * as map from './map.js';
import { modal, confirmDlg, overlay } from './ui.js';
import { renderRoutes, renderPlaces, renderTrips, renderSettings, recCardHtml, recLiveText, onPageClick, onPageChange, placeForm, savePlaceHere, draftAdd } from './views.js';
import { esc, KN, distM, bearing, fmtSpeed, fmtDist, fmtBearing, fmtClock, fmtDurCell, dirWord, joinVU, joinCoord, fmtCoord, parseCoords, NA } from './util.js';

const ic = (n, c = '') => `<svg class="ic ${c}"><use href="#i-${n}"/></svg>`;
let lastTileOk = lsGet('bn.lastTile', 0);
let tileErrs = 0;

// ------------------------------------------------------------------ theme
function applyTheme() {
  const t = S().theme;
  document.documentElement.dataset.theme = t;
  const m = $('meta[name=theme-color]');
  if (m) m.content = { dark: '#06121f', light: '#eaf3fa', contrast: '#ffffff' }[t] || '#06121f';
}

// ------------------------------------------------------------------ heading
/** Best available heading: GPS course when really moving (>= ~1.5 kn), else the phone compass, else unknown (null). */
function currentHeading() {
  const f = gps.fix;
  if (f && gps.status === 'ok' && f.speed != null && f.speed >= 0.75 && f.cog != null) return f.cog;
  if (compassOK()) return gps.compass;
  return null;
}
const pushHeading = () => map.setHeading(currentHeading());

// ------------------------------------------------------------------ HUD
// The HUD DOM is built once per layout (navigating? expanded?) and afterwards only text is patched.
// Re-creating it every second used to swallow taps (the button vanished between touch-down and touch-up).
let hudKey = '';

const cellHtml = (k, label, cls = '') => `<div class="cell ${cls}" data-k="${k}"><label>${label}</label><div class="v num"></div><div class="u"></div></div>`;

function setCell(el, val) {
  const v = el.querySelector('.v');
  const u = el.querySelector('.u');
  const na = val == null;
  const t = na ? NA : String(val.value);
  const ut = na ? '' : val.unit || '';
  if (v.textContent !== t) v.textContent = t;
  v.classList.toggle('na', na);
  if (u.textContent !== ut) u.textContent = ut;
}

function buildHud() {
  const navOn = nav.active;
  const open = app.hudOpen;
  hudKey = navOn + '|' + open;
  const main = navOn
    ? [['spd', 'ความเร็ว'], ['left', 'เหลืออีก'], ['eta', 'ถึงเมื่อ'], ['dist', 'ระยะเหลือ']]
    : [['spd', 'ความเร็ว'], ['dir', 'ทิศที่ไป'], ['dur', 'เวลาเดินทาง'], ['trip', 'ไปแล้ว']];
  const navbar = navOn ? `<div class="navbar">${ic('nav', 'sm')}<b data-t="navtxt"></b><button class="btn sm" data-h="stopnav">จบ</button></div>` : '';
  const grid = [['acc', 'ความแม่นยำ GPS'], ['age', 'อัปเดตล่าสุด'], ['head', 'หัวเรือ (เข็มทิศ)'], ['cog', 'ทิศที่เรือกำลังไป'], ['trip', 'ระยะที่ไปแล้ว']];
  if (navOn) grid.push(['since', 'เดินทางมาแล้ว'], ['brg', 'ทิศไปจุดหมาย'], ['xte', 'เบี่ยงจากเส้นทาง']);
  const more = open
    ? `<div class="hud-more"><div class="cell wide" data-k="pos"><label>ตำแหน่งตอนนี้</label><div class="v num pre"></div><div class="u"></div></div><div class="hud-grid">${grid.map(([k, l]) => cellHtml(k, l)).join('')}</div></div>`
    : '';
  $('#hud').innerHTML = `${navbar}<button class="hud-main" data-h="toggle" aria-expanded="${open}" aria-label="ข้อมูลการเดินทาง แตะเพื่อดูเพิ่ม">${main.map(([k, l]) => cellHtml(k, l)).join('')}</button><div class="hud-grab">${ic(open ? 'down' : 'up')}</div>${more}`;
}

function hudValues() {
  const s = S();
  const f = gps.fix;
  const fresh = gps.status === 'ok';
  const h = currentHeading();
  const moving = fresh && f.speed != null && f.speed >= 0.75 && f.cog != null;
  const info = nav.active && fresh ? nav.info : null;
  const t = trip.rec.trip;
  const tripDist = t ? fmtDist(t.distanceM, s.distUnit) : null;
  const left = info && !info.arrived ? fmtDurCell(info.leftMs) : null;
  const c = fmtCoord(f, s.coordFmt);
  const tgt = nav.points[nav.idx];
  const V = {
    spd: fresh ? fmtSpeed(f.speed, s.speedUnit) : null,
    dir: h != null ? { value: fmtBearing(h), unit: dirWord(h) } : null,
    dur: t ? fmtDurCell(trip.elapsedMs(t)) : null,
    trip: tripDist,
    left: left ? { value: left.value, unit: left.unit + (info.estimated ? ' (ประมาณ)' : '') } : null,
    eta: info && !info.arrived ? { value: fmtClock(info.eta), unit: info.estimated ? 'ประมาณ' : 'น.' } : null,
    dist: info ? fmtDist(info.remaining, s.distUnit) : null,
    pos: c ? { value: c.lat + '\n' + c.lng, unit: fresh ? '' : 'ตำแหน่งล่าสุดที่ได้รับ' } : null,
    acc: f ? { value: '±' + Math.round(f.acc), unit: 'ม.' } : null,
    age: f ? { value: Math.round((Date.now() - gps.recvAt) / 1000), unit: 'วินาทีก่อน' } : null,
    head: compassOK() ? { value: fmtBearing(gps.compass), unit: dirWord(gps.compass) } : null,
    cog: moving ? { value: fmtBearing(f.cog), unit: dirWord(f.cog) } : null,
    since: nav.active && nav.startedAt ? fmtDurCell(Date.now() - nav.startedAt) : null,
    brg: info ? { value: fmtBearing(info.brg), unit: dirWord(info.brg) } : null,
    xte: info ? fmtDist(info.xte, s.distUnit) : null,
  };
  V.navtxt = nav.active ? `ไป ${tgt?.name || 'จุดหมาย'} (${nav.idx + 1}/${nav.points.length})${info ? ' · อีก ' + joinVU(fmtDist(info.toNext, s.distUnit)) : ' · ' + NA}` : '';
  return V;
}

function renderHud() {
  if (hudKey !== nav.active + '|' + app.hudOpen) buildHud();
  const V = hudValues();
  document.querySelectorAll('#hud .cell[data-k]').forEach((el) => setCell(el, V[el.dataset.k]));
  const t = $('#hud [data-t=navtxt]');
  if (t && t.textContent !== V.navtxt) t.textContent = V.navtxt;
}

$('#hud').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-h]');
  if (!b) return;
  if (b.dataset.h === 'toggle') { app.hudOpen = !app.hudOpen; document.body.classList.toggle('hud-open', app.hudOpen); renderHud(); }
  else if (b.dataset.h === 'stopnav' && (await confirmDlg('หยุดนำทาง?', 'การนำทางตอนนี้จะสิ้นสุดลง', 'หยุดนำทาง'))) stopNav();
});
// Collapsed-HUD height drives where controls/sheets sit; the expanded HUD simply overlays them.
new ResizeObserver(() => document.documentElement.style.setProperty('--hud-h', Math.min($('#hud').offsetHeight, 190) + 'px')).observe($('#hud'));

// ------------------------------------------------------------------ GPS chip + alerts
function renderChip() {
  const st = gps.status;
  const f = gps.fix;
  const lim = S().lowAccM;
  let led = '', txt = '';
  if (st === 'idle') { led = ''; txt = 'GPS ปิด'; }
  else if (st === 'asking' || st === 'searching') { led = 'pulse'; txt = 'กำลังหา GPS…'; }
  else if (st === 'ok') { led = f.acc > lim ? 'warn' : 'ok'; txt = `GPS ±${Math.round(f.acc)} ม.`; }
  else if (st === 'stale') { led = 'warn'; txt = 'ข้อมูลเก่า'; }
  else if (st === 'lost') { led = 'bad'; txt = 'GPS ขาด'; }
  else if (st === 'denied') { led = 'bad'; txt = 'ไม่ได้รับอนุญาต'; }
  else { led = 'bad'; txt = 'GPS ใช้ไม่ได้'; }
  $('#gpsChip').innerHTML = `${navigator.onLine ? '' : ic('wifioff', 'sm')}<span class="led ${led}"></span><span>${txt}</span>`;
}

function syncGpsAlerts() {
  const st = gps.status;
  const want = { gps: null, lowacc: null };
  if (st === 'lost') want.gps = { level: 'critical', title: 'สัญญาณ GPS ขาดหาย', text: 'ตำแหน่งที่แสดงเป็นตำแหน่งล่าสุด อย่าใช้เป็นตำแหน่งปัจจุบัน' };
  else if (st === 'stale') want.gps = { level: 'warn', title: 'ข้อมูลตำแหน่งเก่า', text: 'ไม่ได้รับตำแหน่งใหม่เกิน 10 วินาที' };
  else if (st === 'unavailable') want.gps = { level: 'warn', title: 'GPS ไม่พร้อมใช้งาน', text: 'ตรวจสอบว่าเปิดบริการตำแหน่งของอุปกรณ์แล้ว', action: { label: 'ลองใหม่', fn: retryGps } };
  else if (st === 'denied') want.gps = { level: 'warn', title: 'ไม่ได้รับอนุญาตใช้ตำแหน่ง', text: 'เปิดสิทธิ์ตำแหน่งในการตั้งค่าเบราว์เซอร์', action: { label: 'วิธีเปิด', fn: showDenied } };
  else if (st === 'ok' && gps.fix.acc > S().lowAccM) want.lowacc = { level: 'warn', title: 'ความแม่นยำ GPS ต่ำ', text: `คลาดเคลื่อนได้ประมาณ ${Math.round(gps.fix.acc / 10) * 10} ม.` };
  for (const id of ['gps', 'lowacc']) (want[id] ? setAlert(id, want[id]) : clearAlert(id));
}

function retryGps() { gpsStop(); gpsStart(); }

function showDenied() {
  overlay({
    title: 'ไม่ได้รับอนุญาตใช้ตำแหน่ง',
    html: 'เปิดสิทธิ์ตำแหน่งให้เว็บไซต์นี้ในเบราว์เซอร์ <br>• iOS: ตั้งค่า → ความเป็นส่วนตัว → บริการตำแหน่ง → Safari/เว็บไซต์ <br>• Android/Chrome: แตะไอคอนล็อกข้างที่อยู่เว็บ → สิทธิ์ → ตำแหน่ง <br>แล้วกด “ลองอีกครั้ง” แผนที่ Waypoints และทริปเดิมยังใช้งานได้ตามปกติ',
    actions: [{ label: 'ลองอีกครั้ง', cls: 'primary', fn: () => { overlay(null); retryGps(); } }, { label: 'ใช้แผนที่โดยไม่มี GPS', fn: () => overlay(null) }],
  });
}

function showAsk() {
  overlay({
    title: 'ขออนุญาตใช้ตำแหน่ง',
    text: 'Boat Navigator ใช้ GPS ของอุปกรณ์เพื่อแสดงตำแหน่งเรือ ความเร็ว และบันทึกเส้นทาง ข้อมูลตำแหน่งเก็บไว้ในเครื่องของคุณ (มีเพียงคำค้นหาที่ส่งไปยังบริการค้นหา Nominatim)',
    actions: [{ label: 'อนุญาตและเริ่มใช้งาน', cls: 'primary', fn: () => { startCompass(); overlay(null); gpsStart(); } }, { label: 'ดูแผนที่โดยไม่ใช้ GPS', fn: () => overlay(null) }],
  });
}

async function gpsFlow() {
  if (!window.isSecureContext || !('geolocation' in navigator)) {
    overlay({ title: 'GPS ใช้ไม่ได้ในหน้านี้', text: 'การเข้าถึงตำแหน่งต้องเปิดผ่าน HTTPS (หรือ localhost) และอุปกรณ์ต้องรองรับ Geolocation แผนที่และข้อมูลที่บันทึกไว้ยังใช้ได้', actions: [{ label: 'ดูแผนที่ต่อ', cls: 'primary', fn: () => overlay(null) }] });
    return;
  }
  const p = await permissionState();
  if (p === 'granted') { overlay(null); gpsStart(); }
  else if (p === 'denied') showDenied();
  else showAsk();
}

function gpsInfoDialog() {
  const f = gps.fix;
  const label = { idle: 'ปิด', asking: 'รอการอนุญาต', searching: 'กำลังค้นหาสัญญาณ', ok: 'ปกติ', stale: 'ข้อมูลเก่า', lost: 'สัญญาณขาดหาย', denied: 'ไม่ได้รับอนุญาต', unavailable: 'ไม่พร้อมใช้งาน' }[gps.status];
  modal({
    title: 'สถานะ GPS',
    body: `<div class="card"><div class="row"><div class="grow">สถานะ</div><b>${label}</b></div>
      <div class="row"><div class="grow">ความแม่นยำ</div><b class="num">${f ? '±' + Math.round(f.acc) + ' ม.' : NA}</b></div>
      <div class="row"><div class="grow">อัปเดตล่าสุด</div><b class="num">${f ? fmtClock(gps.recvAt) : NA}</b></div>
      <div class="row"><div class="grow">เครือข่าย</div><b>${navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์'}</b></div></div>
      <p class="sub">GPS ในมือถือคลาดเคลื่อนได้หลายเมตร และแย่ลงใต้หลังคาหรือใกล้โครงสร้างโลหะ ควรวางเครื่องในที่โล่งเห็นท้องฟ้า</p>`,
    ok: 'ปิด',
    cancel: '',
  });
}
$('#gpsChip').addEventListener('click', gpsInfoDialog);

// ------------------------------------------------------------------ map overlays
const pinHtml = (cls, inner = '<span class="ic-dot"></span>') => `<div class="dot ${cls}"><span>${inner}</span></div>`;
let lastOvl = 0;
function refreshOverlays() {
  lastOvl = Date.now();
  const f = gps.fix;
  const items = app.places.map((p) => ({ lat: p.lat, lng: p.lng, html: pinHtml('c-' + p.cat), id: p.id, onClick: () => selectPoint({ lat: p.lat, lng: p.lng, name: p.name, placeId: p.id }) }));
  map.setMarkers('places', items);

  const mk = [];
  let line = [];
  if (nav.active) {
    const rest = nav.points.slice(nav.idx);
    rest.forEach((p, i) => mk.push({ lat: p.lat, lng: p.lng, html: pinHtml(i === rest.length - 1 ? 'dest' : 'wp', i === rest.length - 1 ? ic('flag', 'sm') : String(nav.idx + i + 1)), z: 400 }));
    line = [...(f ? [[f.lat, f.lng]] : []), ...rest.map((p) => [p.lat, p.lng])];
    map.setLine('route', line, { className: 'ln-route', dashArray: '10 8' });
    map.setLine('draft', null);
  } else {
    map.setLine('route', null);
    const d = app.draft;
    d.points.forEach((p, i) => mk.push({ lat: p.lat, lng: p.lng, html: pinHtml('wp', String(i + 1)), z: 300 }));
    const pts = [...(d.useCurrent && f ? [[f.lat, f.lng]] : []), ...d.points.map((p) => [p.lat, p.lng])];
    map.setLine('draft', pts, { className: 'ln-draft', dashArray: '4 8' });
  }
  map.setMarkers('route', mk);
  map.setMarkers('sel', app.selected ? [{ lat: app.selected.lat, lng: app.selected.lng, html: pinHtml('', ic('pin', 'sm')), cls: 'pickpt', z: 900 }] : []);
  const t = trip.rec.trip;
  map.setLine('rec', t ? t.points.map((p) => [p[0], p[1]]) : null, { className: 'ln-rec', weight: 5 });
  map.setAnchorMark(anchor);
}

function ovlSoon() { if (Date.now() - lastOvl > 1500) refreshOverlays(); }

// ------------------------------------------------------------------ point sheet / bar
function selectPoint(p) {
  app.selected = p;
  renderPointSheet();
  refreshOverlays();
}

function renderPointSheet() {
  const el = $('#pointSheet');
  const p = app.selected;
  if (!p || app.tab !== 'map' || app.bar?.mode === 'pick') { el.hidden = true; return; }
  const f = gps.fix;
  const rel = f ? `${joinVU(fmtDist(distM(f, p), S().distUnit))} · ${fmtBearing(bearing(f, p))}` : 'ไม่มีข้อมูลระยะทาง (ไม่มีสัญญาณ GPS)';
  el.hidden = false;
  el.innerHTML = `<div class="row"><div class="grow"><div class="title">${esc(p.name || 'จุดที่เลือก')}</div><div class="sub num">${esc(joinCoord(p, S().coordFmt))}</div><div class="sub num">${rel}</div></div>
    <button class="btn icon ghost" data-p="close" aria-label="ปิด">${ic('x')}</button></div>
    <div class="acts"><button class="btn primary" data-p="go">${ic('nav', 'sm')} นำทางไปที่นี่</button><button class="btn" data-p="add">${ic('route', 'sm')} เพิ่มเข้าเส้นทาง</button><button class="btn" data-p="save">${ic('pinplus', 'sm')} ${p.placeId ? 'แก้ไขจุด' : 'บันทึกจุด'}</button></div>`;
}

$('#pointSheet').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-p]');
  const p = app.selected;
  if (!b || !p) return;
  const a = b.dataset.p;
  if (a === 'close') selectPoint(null);
  else if (a === 'go') {
    if (nav.active && !(await confirmDlg('เปลี่ยนจุดหมาย?', 'การนำทางปัจจุบันจะถูกแทนที่', 'เปลี่ยน'))) return;
    startNav([p], p.name || '');
    selectPoint(null);
    toast('เริ่มนำทาง — เส้นตรงยังไม่ผ่านการตรวจสอบความปลอดภัยทางทะเล', 'warn', 4500);
  } else if (a === 'add') { draftAdd(p, p.name); toast('เพิ่มเข้าแผนเส้นทางแล้ว'); selectPoint(null); }
  else if (a === 'save') {
    const existing = p.placeId && app.places.find((x) => x.id === p.placeId);
    const r = await placeForm(existing || { name: p.name || '', cat: 'other', lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
    if (r) selectPoint({ lat: r.lat, lng: r.lng, name: r.name, placeId: r.id });
  }
});

function renderBar() {
  const el = $('#pickbar');
  const b = app.bar;
  el.hidden = !b || app.tab !== 'map';
  if (!b) return;
  el.innerHTML = `<span>${esc(b.text)}</span><button class="btn sm" data-b="1">${esc(b.label)}</button>`;
}
$('#pickbar').addEventListener('click', (e) => { if (e.target.closest('[data-b]')) app.bar?.done(); });

function startPick() {
  app.selected = null;
  app.bar = { mode: 'pick', text: 'แตะแผนที่เพื่อเพิ่มจุดในเส้นทาง', label: 'เสร็จ', n: 0, done: () => { app.bar = null; renderBar(); showTab('routes'); } };
  showTab('map');
}

function showViewedTrip() {
  const t = app.trips.find((x) => x.id === app.viewTrip);
  if (!t) { app.viewTrip = null; return; }
  const pts = t.points.map((p) => [p[0], p[1]]);
  map.setLine('view', pts, { className: 'ln-view', weight: 5 });
  map.fitPoints(pts);
  app.bar = { mode: 'view', text: 'ทริป: ' + t.name, label: 'ปิด', done: () => { app.viewTrip = null; app.bar = null; map.setLine('view', null); renderBar(); } };
  renderBar();
}

// ------------------------------------------------------------------ tabs / pages
const PAGES = { routes: renderRoutes, places: renderPlaces, trips: renderTrips, settings: renderSettings };

function renderPage() {
  const fn = PAGES[app.tab];
  if (fn) $('#page').innerHTML = fn();
}

function showTab(t) {
  app.tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  const isMap = t === 'map';
  $('#page').hidden = isMap;
  document.body.classList.toggle('on-page', !isMap);
  if (!isMap) { renderPage(); $('#page').scrollTop = 0; } else { map.onResize(); if (app.viewTrip && app.bar?.mode !== 'view') showViewedTrip(); }
  renderPointSheet();
  renderBar();
}

function refresh() {
  if (app.tab !== 'map') { const y = $('#page').scrollTop; renderPage(); $('#page').scrollTop = y; }
  refreshOverlays();
  renderPointSheet();
  renderHud();
  renderFabs();
  if (app.bar?.mode === 'pick') { app.bar.text = `เส้นทางมี ${app.draft.points.length} จุด — แตะต่อได้`; renderBar(); }
}

$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
$('#page').addEventListener('click', onPageClick);
$('#page').addEventListener('change', onPageChange);

// ------------------------------------------------------------------ FABs
function renderFabs() {
  const fol = map.isFollowing();
  const bf = $('#btnFollow');
  bf.classList.toggle('on', fol);
  bf.setAttribute('aria-pressed', fol);
  const br = $('#btnRec');
  br.className = 'fab' + (trip.rec.status === 'recording' ? ' rec' : trip.rec.status === 'paused' ? ' paused' : '');
  $('#btnAnchor').classList.toggle('warn', anchor.active);
  const bc = $('#btnCompass');
  const course = map.getMode() === 'course';
  bc.classList.toggle('on', course);
  bc.setAttribute('aria-pressed', course);
  bc.setAttribute('aria-label', course ? 'แผนที่หมุนตามหัวเรือ แตะเพื่อให้ทิศเหนืออยู่ด้านบน' : 'ทิศเหนืออยู่ด้านบน แตะเพื่อให้แผนที่หมุนตามหัวเรือ');
}

/** Zoom in and lock on the boat, like the "my location" button in a car-navigation app. */
function lockOnBoat() {
  if (!gps.fix) return toast('ยังไม่พบตำแหน่ง GPS', 'warn');
  map.lockOn(gps.fix, 17);
}
$('#btnFollow').addEventListener('click', () => {
  if (map.isFollowing()) { map.setFollow(false); toast('หยุดตามเรือ — แผนที่ไม่เลื่อนตามแล้ว'); return; }
  lockOnBoat();
});
$('#btnCompass').addEventListener('click', () => {
  const next = map.getMode() === 'course' ? 'north' : 'course';
  map.setMode(next);
  toast(next === 'course' ? 'แผนที่หมุนตามหัวเรือ' : 'ทิศเหนืออยู่ด้านบน');
});
on('boatclick', () => lockOnBoat());
on('bearing', (b) => { const s = $('#btnCompass svg'); if (s) s.style.transform = `rotate(${b}deg)`; });
on('mode', renderFabs);
$('#btnZoomIn').addEventListener('click', () => map.zoomBy(1));
$('#btnZoomOut').addEventListener('click', () => map.zoomBy(-1));
$('#btnSave').addEventListener('click', () => savePlaceHere());
$('#btnRec').addEventListener('click', () => {
  if (trip.rec.status === 'idle' && !gps.fix) return toast('ต้องมีสัญญาณ GPS ก่อนเริ่มบันทึก', 'warn');
  if (trip.rec.status === 'idle') trip.start().then(() => toast('เริ่มบันทึกการเดินทาง'));
  else showTab('trips');
});
$('#btnAnchor').addEventListener('click', async () => {
  const warn = '<div class="note">เตือนเรือลอยทำงานเฉพาะเมื่อแอปเปิดอยู่ หน้าจอไม่ล็อก และมีสัญญาณ GPS เท่านั้น ใช้เป็นตัวช่วยเสริม ไม่ใช่ทดแทนการเฝ้าระวังด้วยตัวเอง</div>';
  if (anchor.active) {
    const ok = await modal({ title: 'เตือนเรือลอย (ทอดสมอ) เปิดอยู่', body: `<p class="sub">รัศมี ${anchor.radius} ม. จากจุดทอดสมอ</p>${warn}`, ok: 'ปิดการเตือนเรือลอย', danger: true, cancel: 'ปิด' });
    if (ok) setAnchor(false);
    return;
  }
  if (!gps.fix) return toast('ต้องมีสัญญาณ GPS ก่อนตั้งเตือนเรือลอย', 'warn');
  const r = await modal({ title: 'ตั้งเตือนเรือลอย (ทอดสมอ)', body: `<p class="sub">ใช้ตำแหน่งปัจจุบันเป็นจุดทอดสมอ</p><div class="field"><label>รัศมีเตือน (เมตร) — ควรมากกว่าความแม่นยำ GPS</label><input type="number" id="r" value="${Math.max(50, Math.ceil((gps.fix.acc || 0) * 3 / 10) * 10)}" min="10" max="1000"></div>${warn}`, ok: 'เริ่มเฝ้าระวัง', onOk: (d) => { const v = parseInt(d.querySelector('#r').value, 10); if (!(v >= 10 && v <= 1000)) { toast('รัศมี 10–1000 ม.', 'err'); return false; } return v; } });
  if (r) { setAnchor(true, r); toast('เริ่มเฝ้าระวังเรือลอยแล้ว'); }
});

// ------------------------------------------------------------------ search
let searchAbort = null;
function openSearch(mode = 'goto') {
  app.searchMode = mode;
  const el = $('#search');
  el.hidden = false;
  el.innerHTML = `<div class="bar"><input type="search" id="q" placeholder="ชื่อสถานที่ หรือพิกัด เช่น 13.75, 100.50" enterkeyhint="search" autocomplete="off" aria-label="ค้นหา"><button class="btn primary icon" data-q="go" aria-label="ค้นหา">${ic('search')}</button><button class="btn" data-q="close">ปิด</button></div>
    <div class="results" id="res"></div><div class="sub" style="padding:8px 0 calc(var(--sab) + 8px)">ผลการค้นหาออนไลน์: Nominatim / © OpenStreetMap contributors</div>`;
  showResults(localMatches(''), app.places.length ? 'สถานที่ที่บันทึกไว้' : '');
  $('#q').focus();
}
const closeSearch = () => { searchAbort?.abort(); $('#search').hidden = true; };
let results = [];

function localMatches(q) {
  const k = q.toLowerCase();
  return app.places.filter((p) => !k || p.name.toLowerCase().includes(k)).slice(0, 20).map((p) => ({ lat: p.lat, lng: p.lng, name: p.name, sub: 'สถานที่ที่บันทึกไว้', placeId: p.id, local: true }));
}

function showResults(list, heading = '', msg = '') {
  results = list;
  $('#res').innerHTML = `${heading ? `<h2>${esc(heading)}</h2>` : ''}${list.map((r, i) => `<button class="res" data-r="${i}">${ic(r.local ? 'star' : 'pin')}<span class="grow"><b>${esc(r.name)}</b><small>${esc(r.sub || '')}</small></span></button>`).join('')}${msg}`;
}

async function runSearch() {
  const q = $('#q').value.trim();
  if (!q) return showResults(localMatches(''), 'สถานที่ที่บันทึกไว้');
  const c = parseCoords(q);
  if (c) return showResults([{ ...c, name: 'พิกัด ' + q, sub: 'จุดบนแผนที่' }]);
  const local = localMatches(q);
  if (!navigator.onLine) {
    return showResults(local, local.length ? 'ในรายการที่บันทึกไว้' : '', `<div class="empty">${ic('wifioff')}<p>ออฟไลน์ — ค้นหาสถานที่ออนไลน์ไม่ได้ ค้นหาได้เฉพาะสถานที่ที่บันทึกไว้ หรือกรอกพิกัด</p></div>`);
  }
  $('#res').innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto 12px"></div><p>กำลังค้นหา “${esc(q)}”…</p></div>`;
  searchAbort?.abort();
  searchAbort = new AbortController();
  const timer = setTimeout(() => searchAbort.abort(), 12000);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=th&q=${encodeURIComponent(q)}`, { signal: searchAbort.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const remote = data.map((d) => ({ lat: +d.lat, lng: +d.lon, name: d.name || d.display_name.split(',')[0], sub: d.display_name }));
    const all = [...local, ...remote];
    if (!all.length) $('#res').innerHTML = `<div class="empty">${ic('search')}<div><b>ไม่พบผลการค้นหา</b></div><p>ลองสะกดอีกแบบ ใช้ชื่อภาษาอังกฤษ หรือกรอกพิกัด หรือแตะเลือกจุดบนแผนที่โดยตรง</p></div>`;
    else showResults(all);
  } catch (e) {
    log('warn', 'search', e);
    showResults(local, '', `<div class="empty">${ic('alert')}<div><b>ค้นหาไม่สำเร็จ</b></div><p>${e.name === 'AbortError' ? 'หมดเวลา' : 'เชื่อมต่อบริการค้นหาไม่ได้'} — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่</p><button class="btn" data-q="go">ลองใหม่</button></div>`);
  } finally { clearTimeout(timer); }
}

$('#search').addEventListener('click', (e) => {
  const q = e.target.closest('[data-q]');
  if (q) return q.dataset.q === 'close' ? closeSearch() : runSearch();
  const r = e.target.closest('[data-r]');
  if (!r) return;
  const it = results[+r.dataset.r];
  closeSearch();
  if (app.searchMode === 'draft') { draftAdd(it, it.name); showTab('routes'); toast('เพิ่มจุดในเส้นทางแล้ว'); }
  else { showTab('map'); map.flyTo(it); selectPoint({ lat: it.lat, lng: it.lng, name: it.name, placeId: it.placeId }); }
});
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'q') runSearch(); if (e.key === 'Escape') closeSearch(); });
$('#searchBtn').addEventListener('click', () => openSearch('goto'));

// ------------------------------------------------------------------ events
on('fix', (f) => {
  pushHeading();
  map.updateBoat(f);
  map.setBoatStale(false);
  navUpdate(f);
  trip.onFix(f);
  checkAnchor();
  syncGpsAlerts();
  renderChip();
  renderHud();
  ovlSoon();
  updateWake();
  if (app.tab === 'places' || (app.tab === 'routes')) { /* distances refresh on next navigation; avoid re-render while editing */ }
});
on('gps', (st) => {
  map.setBoatStale(st === 'lost' || st === 'stale');
  syncGpsAlerts(); renderChip(); renderHud(); checkAnchor();
  if (st === 'denied') showDenied();
  updateWake();
});
on('tick', () => {
  renderHud(); checkAnchor();
  const live = $('#recLive');
  if (app.tab === 'trips' && live) live.textContent = recLiveText();
});
on('compass', () => { pushHeading(); });
on('compassState', (st) => { if (st === 'denied') toast('ไม่ได้รับอนุญาตใช้เข็มทิศ — จะใช้ทิศจาก GPS เมื่อเรือเคลื่อนที่', 'warn', 5000); renderHud(); });
on('nav', () => { refreshOverlays(); renderHud(); if (app.tab === 'routes') renderPage(); updateWake(); });
on('navinfo', () => { renderHud(); ovlSoon(); });
on('anchor', () => { refreshOverlays(); renderFabs(); updateWake(); });
on('trip', () => { refreshOverlays(); renderFabs(); renderHud(); if (app.tab === 'trips') renderPage(); updateWake(); });
on('tripPoint', () => { ovlSoon(); });
on('follow', renderFabs);
on('mapclick', (p) => {
  if (app.bar?.mode === 'pick') { draftAdd(p); return; }
  if (app.tab === 'map') selectPoint({ lat: p.lat, lng: p.lng });
});
on('tile', (ok) => {
  if (ok) {
    tileErrs = 0;
    clearAlert('maperr');
    if (navigator.onLine) { lastTileOk = Date.now(); lsSet('bn.lastTile', lastTileOk); }
  } else if (++tileErrs >= 6) {
    setAlert('maperr', { level: 'warn', title: 'แผนที่ยังไม่พร้อมใช้งานในบริเวณนี้', text: navigator.onLine ? 'โหลดแผนที่ไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือผู้ให้บริการแผนที่' : 'ออฟไลน์และยังไม่เคยโหลดแผนที่บริเวณนี้ไว้ — พิกัดและ HUD ยังใช้ได้' });
  }
});
on('settings', (k) => {
  if (k === 'theme') applyTheme();
  if (['base', 'customTileUrl', 'seamarks'].includes(k)) map.applyTiles(S());
  if (k === 'wakeLock') updateWake();
  renderChip(); renderHud(); syncGpsAlerts();
  if (!['customTileUrl'].includes(k)) refreshOverlays();
});

function syncOnline() {
  if (!navigator.onLine) setAlert('offline', { level: 'info', title: 'ออฟไลน์', text: `ใช้ได้เฉพาะแผนที่ที่เคยโหลดไว้ · ค้นหาออนไลน์ไม่ได้${lastTileOk ? ' · โหลดแผนที่จากเครือข่ายล่าสุด ' + fmtClock(lastTileOk) : ''}` });
  else clearAlert('offline');
  renderChip();
}
window.addEventListener('online', syncOnline);
window.addEventListener('offline', syncOnline);

// ------------------------------------------------------------------ wake lock & lifecycle
let wl = null;
async function updateWake() {
  const want = S().wakeLock && document.visibilityState === 'visible' && (gps.status === 'ok' || nav.active || trip.rec.status !== 'idle' || anchor.active);
  try {
    if (want && !wl && 'wakeLock' in navigator) {
      wl = await navigator.wakeLock.request('screen');
      wl.addEventListener('release', () => { wl = null; });
    } else if (!want && wl) { await wl.release(); wl = null; }
  } catch { wl = null; }
}

const needsGps = () => trip.rec.status === 'recording' || nav.active || anchor.active;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    trip.flush();
    if (!needsGps()) gpsStop();
  } else {
    if (wants() && !isWatching() && gps.status !== 'denied') gpsStart();
    updateWake();
    renderHud();
  }
});
window.addEventListener('pagehide', () => trip.flush());
window.addEventListener('resize', () => map.onResize());
window.addEventListener('error', (e) => log('error', 'window', e.message));
window.addEventListener('unhandledrejection', (e) => log('error', 'promise', e.reason));

Object.assign(app.fn, { showTab, refresh, openSearch, selectPoint, startPick, flyTo: map.flyTo, renderPage });

// ------------------------------------------------------------------ boot
async function boot() {
  applyTheme();
  if (!window.L) {
    overlay({ title: 'แผนที่ยังไม่พร้อมใช้งาน', text: 'โหลดไลบรารีแผนที่ไม่สำเร็จ ลองรีเฟรชหน้านี้', actions: [{ label: 'โหลดใหม่', cls: 'primary', fn: () => location.reload() }] });
    return;
  }
  map.initMap($('#map'));
  map.applyTiles(S());
  renderHud(); renderChip(); renderFabs();
  // Heading is always on: start the compass now (Android), and on the first tap (iOS only allows it from a gesture).
  startCompass();
  const onTap = () => { startCompass().then((st) => { if (st === 'on' || st === 'denied' || st === 'unsupported') document.removeEventListener('click', onTap, true); }); };
  document.addEventListener('click', onTap, true);
  try {
    await db.ready();
    [app.places, app.routes, app.trips] = await Promise.all([db.all('places'), db.all('routes'), db.all('trips')]);
    requestPersistence();
    await trip.restore();
  } catch (e) {
    log('error', 'db', e);
    setAlert('db', { level: 'warn', title: 'เก็บข้อมูลในเครื่องไม่ได้', text: 'ไม่สามารถเปิดฐานข้อมูลได้ (โหมดส่วนตัวหรือพื้นที่เต็ม?) Waypoints และทริปจะไม่ถูกบันทึก' });
  }
  refresh();
  syncOnline();
  if (nav.active) toast('กู้คืนการนำทางที่ค้างไว้', 'warn');
  await gpsFlow();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch((e) => log('warn', 'sw', e));
  }
}
boot().catch((e) => {
  log('error', 'boot', e);
  overlay({ title: 'เริ่มแอปไม่สำเร็จ', text: String(e.message || e), actions: [{ label: 'โหลดใหม่', cls: 'primary', fn: () => location.reload() }] });
});
