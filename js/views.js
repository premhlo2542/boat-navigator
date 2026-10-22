// Full-page views: Routes, Places, Trips, Settings. Pure HTML builders + delegated action handlers.
import { app, CATS, saveDraft, $ } from './app.js';
import { db } from './db.js';
import { gps, enableCompass, disableCompass } from './gps.js';
import { getSettings, setSetting, emit } from './store.js';
import { nav, startNav, stopNav, anchor, setAnchor } from './nav.js';
import * as trip from './trip.js';
import { downloadGpx } from './gpx.js';
import { toast } from './alerts.js';
import { modal, confirmDlg } from './ui.js';
import { esc, uid, distM, bearing, KN, fmtDist, fmtSpeed, fmtDur, fmtBearing, fmtDateTime, joinVU, joinCoord, parseCoords, validLatLng, NA } from './util.js';

const ic = (n, cls = '') => `<svg class="ic ${cls}"><use href="#i-${n}"/></svg>`;
const here = () => (gps.fix ? { lat: gps.fix.lat, lng: gps.fix.lng } : null);
const dTxt = (m) => joinVU(fmtDist(m, getSettings().distUnit));

function empty(icon, title, text) {
  return `<div class="empty">${ic(icon)}<div><b>${esc(title)}</b></div><p>${esc(text)}</p></div>`;
}

// ============================ ROUTES ============================
export function renderRoutes() {
  const s = getSettings();
  const d = app.draft;
  const pts = d.points;
  const fix = here();
  const startPt = d.useCurrent ? fix : null;
  let total = 0;
  let prev = startPt;
  const rows = pts.map((p, i) => {
    let leg = '';
    if (prev) {
      const dist = distM(prev, p);
      total += dist;
      leg = `<div class="legline num">${dTxt(dist)} · ${fmtBearing(bearing(prev, p))}</div>`;
    }
    prev = p;
    const kind = !d.useCurrent && i === 0 ? 'start' : i === pts.length - 1 ? 'end' : '';
    return `${leg}<div class="card leg"><span class="idx ${kind}">${kind === 'start' ? 'S' : kind === 'end' ? ic('flag', 'sm') : i + 1}</span>
      <div class="grow"><div class="title">${esc(p.name || 'จุด ' + (i + 1))}</div><div class="sub num">${esc(joinCoord(p, s.coordFmt))}</div></div>
      <button class="btn icon ghost" data-a="r-up" data-i="${i}" aria-label="เลื่อนขึ้น" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button>
      <button class="btn icon ghost" data-a="r-down" data-i="${i}" aria-label="เลื่อนลง" ${i === pts.length - 1 ? 'disabled' : ''}>${ic('down')}</button>
      <button class="btn icon ghost" data-a="r-del" data-i="${i}" aria-label="ลบจุด">${ic('trash')}</button></div>`;
  });
  const etaMs = total > 0 ? (total / (s.plannedSpeedKn * KN)) * 1000 : null;
  const navCard = nav.active
    ? `<div class="card row"><div class="grow"><div class="title">กำลังนำทาง${nav.routeName ? ': ' + esc(nav.routeName) : ''}</div><div class="sub">จุดที่ ${nav.idx + 1} จาก ${nav.points.length}</div></div><button class="btn danger" data-a="n-stop">${ic('x', 'sm')} ยกเลิกนำทาง</button></div>`
    : '';
  const saved = app.routes
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => {
      const len = r.points.reduce((acc, p, i) => (i ? acc + distM(r.points[i - 1], p) : acc), 0);
      return `<div class="card row"><div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${r.points.length} จุด · ${dTxt(len)} (ไม่รวมช่วงจากตำแหน่งปัจจุบัน) · ${fmtDateTime(r.createdAt)}</div></div>
        <button class="btn sm" data-a="r-load" data-id="${r.id}">${ic('edit', 'sm')} แก้ไข</button>
        <button class="btn sm primary" data-a="r-gosaved" data-id="${r.id}">${ic('nav', 'sm')} นำทาง</button>
        <button class="btn icon ghost" data-a="r-delsaved" data-id="${r.id}" aria-label="ลบเส้นทาง">${ic('trash')}</button></div>`;
    })
    .join('');
  return `<h1>เส้นทาง</h1>${navCard}
  <h2>แผนเส้นทาง</h2>
  <div class="setting"><div class="grow">เริ่มจากตำแหน่งปัจจุบัน<small>${fix ? 'ใช้ตำแหน่ง GPS ของเรา' : 'ยังไม่มีสัญญาณ GPS'}</small></div><input type="checkbox" class="switch" data-c="useCurrent" ${d.useCurrent ? 'checked' : ''} aria-label="เริ่มจากตำแหน่งปัจจุบัน"></div>
  ${rows.length ? rows.join('') : empty('route', 'ยังไม่มีจุดในเส้นทาง', 'เพิ่มจุดจากแผนที่ สถานที่ที่บันทึก การค้นหา หรือพิกัด')}
  <div class="grid2">
    <button class="btn grow" data-a="r-pick">${ic('pin', 'sm')} แตะบนแผนที่</button>
    <button class="btn grow" data-a="r-search">${ic('search', 'sm')} ค้นหา</button>
    <button class="btn grow" data-a="r-place">${ic('star', 'sm')} จากสถานที่</button>
    <button class="btn grow" data-a="r-coord">${ic('compass', 'sm')} พิกัด</button>
  </div>
  ${pts.length ? `<div class="card"><div class="row"><div class="grow"><div class="sub">ระยะทางรวม</div><div class="title num" style="font-size:22px">${total > 0 ? dTxt(total) : NA}</div></div>
    <div class="grow"><div class="sub">เวลาโดยประมาณ @ ${s.plannedSpeedKn} kn</div><div class="title num" style="font-size:22px">${etaMs ? fmtDur(etaMs) : NA}</div></div></div>
    <div style="margin-top:8px"><span class="badge-s warn">คำนวณเส้นตรงแล้ว · ยังไม่ผ่านการตรวจสอบความปลอดภัยทางทะเล</span></div></div>
    <div class="note">เส้นทางนี้เป็นเส้นตรงระหว่างจุด ระบบ<b>ไม่มี</b>ข้อมูลความลึก สิ่งกีดขวาง เขตหวงห้าม หรือข้อจำกัดทางน้ำ ต้องตรวจสอบกับแผนที่เดินเรือทางการและสังเกตสภาพจริงก่อนใช้งานทุกครั้ง</div>
    ${d.useCurrent && !fix ? '<div class="note info">ยังไม่มีตำแหน่ง GPS จึงยังไม่รวมระยะจากตำแหน่งปัจจุบัน</div>' : ''}
    <div class="row wrap"><button class="btn primary grow" data-a="r-go">${ic('nav', 'sm')} เริ่มนำทาง</button><button class="btn grow" data-a="r-save">บันทึกเส้นทาง</button><button class="btn ghost" data-a="r-clear">ล้างทั้งหมด</button></div>` : ''}
  <h2>เส้นทางที่บันทึกไว้</h2>
  ${saved || empty('route', 'ยังไม่มีเส้นทางที่บันทึก', 'สร้างแผนเส้นทางด้านบนแล้วกด “บันทึกเส้นทาง”')}`;
}

function draftAdd(p, name) {
  app.draft.points.push({ lat: p.lat, lng: p.lng, name: name || p.name || '' });
  saveDraft();
  app.fn.refresh();
}
export { draftAdd };

async function routeAction(a, el) {
  const d = app.draft;
  const i = +el.dataset.i;
  if (a === 'r-pick') app.fn.startPick();
  else if (a === 'r-search') app.fn.openSearch('draft');
  else if (a === 'r-place') {
    if (!app.places.length) return toast('ยังไม่มีสถานที่ที่บันทึกไว้', 'warn');
    const opts = app.places.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(CATS[p.cat] || '')})</option>`).join('');
    const id = await modal({ title: 'เลือกสถานที่', body: `<div class="field"><select id="pl">${opts}</select></div>`, ok: 'เพิ่ม', onOk: (dlg) => dlg.querySelector('#pl').value });
    const p = app.places.find((x) => x.id === id);
    if (p) draftAdd(p, p.name);
  } else if (a === 'r-coord') {
    const v = await modal({
      title: 'เพิ่มจุดด้วยพิกัด',
      body: `<div class="field"><label>ชื่อ (ไม่บังคับ)</label><input type="text" id="n"></div><div class="field"><label>ละติจูด, ลองจิจูด (ทศนิยม เช่น 13.7563, 100.5018)</label><input type="text" id="c" inputmode="decimal" autocomplete="off"></div>`,
      ok: 'เพิ่ม',
      onOk: (dlg) => {
        const c = parseCoords(dlg.querySelector('#c').value);
        if (!c) { toast('พิกัดไม่ถูกต้อง', 'err'); return false; }
        return { ...c, name: dlg.querySelector('#n').value.trim() };
      },
    });
    if (v) draftAdd(v, v.name);
  } else if (a === 'r-up' || a === 'r-down') {
    const j = a === 'r-up' ? i - 1 : i + 1;
    if (j >= 0 && j < d.points.length) { [d.points[i], d.points[j]] = [d.points[j], d.points[i]]; saveDraft(); app.fn.refresh(); }
  } else if (a === 'r-del') { d.points.splice(i, 1); saveDraft(); app.fn.refresh(); }
  else if (a === 'r-clear') {
    if (await confirmDlg('ล้างแผนเส้นทาง?', 'จุดทั้งหมดในแผนปัจจุบันจะถูกลบ (เส้นทางที่บันทึกไว้ไม่ถูกลบ)', 'ล้าง')) { d.points = []; saveDraft(); app.fn.refresh(); }
  } else if (a === 'r-go') {
    const targets = d.useCurrent ? d.points : d.points.slice(1);
    if (!targets.length) return toast('ต้องมีจุดหมายอย่างน้อย 1 จุด (นอกเหนือจากต้นทาง)', 'warn');
    if (d.useCurrent && !gps.fix) return toast('ยังไม่มีตำแหน่ง GPS — รอสัญญาณก่อนเริ่มนำทาง', 'warn');
    startNav(targets, '', d.useCurrent ? null : d.points[0]);
    app.fn.showTab('map');
    toast('เริ่มนำทางแล้ว — ตรวจสอบเส้นทางกับแผนที่เดินเรือจริง', 'warn', 4500);
  } else if (a === 'r-save') {
    const name = await modal({ title: 'บันทึกเส้นทาง', body: `<div class="field"><label>ชื่อเส้นทาง</label><input type="text" id="n" value="เส้นทาง ${app.routes.length + 1}"></div>`, ok: 'บันทึก', onOk: (dlg) => dlg.querySelector('#n').value.trim() || 'เส้นทาง' });
    if (!name) return;
    const r = { id: uid(), name, useCurrent: d.useCurrent, points: d.points.map((p) => ({ ...p })), createdAt: Date.now(), safetyChecked: false };
    try { await db.put('routes', r); app.routes.push(r); toast('บันทึกเส้นทางแล้ว'); app.fn.refresh(); } catch { toast('บันทึกเส้นทางไม่สำเร็จ — พื้นที่เก็บข้อมูลอาจเต็ม', 'err'); }
  } else if (a === 'r-load') {
    const r = app.routes.find((x) => x.id === el.dataset.id);
    if (r) { app.draft = { useCurrent: r.useCurrent, points: r.points.map((p) => ({ ...p })) }; saveDraft(); app.fn.refresh(); toast('โหลดเส้นทางเข้าสู่แผนแล้ว'); }
  } else if (a === 'r-gosaved') {
    const r = app.routes.find((x) => x.id === el.dataset.id);
    if (!r) return;
    const targets = r.useCurrent ? r.points : r.points.slice(1);
    if (r.useCurrent && !gps.fix) return toast('ยังไม่มีตำแหน่ง GPS', 'warn');
    if (!targets.length) return;
    startNav(targets, r.name, r.useCurrent ? null : r.points[0]);
    app.fn.showTab('map');
  } else if (a === 'r-delsaved') {
    if (await confirmDlg('ลบเส้นทางนี้?', 'การลบไม่สามารถย้อนกลับได้')) {
      try { await db.del('routes', el.dataset.id); app.routes = app.routes.filter((x) => x.id !== el.dataset.id); app.fn.refresh(); toast('ลบเส้นทางแล้ว'); } catch { toast('ลบไม่สำเร็จ', 'err'); }
    }
  } else if (a === 'n-stop') {
    if (await confirmDlg('ยกเลิกการนำทาง?', 'การนำทางปัจจุบันจะสิ้นสุดลง', 'ยกเลิกนำทาง')) { stopNav(); app.fn.refresh(); }
  }
}

// ============================ PLACES ============================
export async function placeForm(p) {
  const isNew = !p.id;
  const catOpts = Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${p.cat === k ? 'selected' : ''}>${v}</option>`).join('');
  const v = await modal({
    title: isNew ? 'บันทึกสถานที่' : 'แก้ไขสถานที่',
    body: `<div class="field"><label>ชื่อ</label><input type="text" id="n" value="${esc(p.name || '')}" maxlength="80"></div>
      <div class="field"><label>หมวดหมู่</label><select id="c">${catOpts}</select></div>
      <div class="field"><label>หมายเหตุ</label><textarea id="t" maxlength="500">${esc(p.note || '')}</textarea></div>
      <div class="row"><div class="field grow"><label>ละติจูด</label><input type="text" id="la" inputmode="decimal" value="${p.lat ?? ''}"></div><div class="field grow"><label>ลองจิจูด</label><input type="text" id="lo" inputmode="decimal" value="${p.lng ?? ''}"></div></div>`,
    ok: 'บันทึก',
    onOk: (dlg) => {
      const lat = parseFloat(dlg.querySelector('#la').value);
      const lng = parseFloat(dlg.querySelector('#lo').value);
      const name = dlg.querySelector('#n').value.trim();
      if (!name) { toast('กรุณาตั้งชื่อ', 'err'); return false; }
      if (!validLatLng(lat, lng)) { toast('พิกัดไม่ถูกต้อง', 'err'); return false; }
      return { name, cat: dlg.querySelector('#c').value, note: dlg.querySelector('#t').value.trim(), lat, lng };
    },
  });
  if (!v) return null;
  const rec = { ...p, ...v, id: p.id || uid(), createdAt: p.createdAt || Date.now() };
  try {
    await db.put('places', rec);
    const k = app.places.findIndex((x) => x.id === rec.id);
    if (k >= 0) app.places[k] = rec; else app.places.push(rec);
    toast('บันทึกสถานที่แล้ว');
    app.fn.refresh();
    return rec;
  } catch {
    toast('บันทึกไม่สำเร็จ — พื้นที่เก็บข้อมูลอาจเต็มหรือถูกบล็อก', 'err');
    return null;
  }
}

export function savePlaceHere() {
  if (!gps.fix) return toast('ยังไม่มีตำแหน่ง GPS จึงบันทึกตำแหน่งปัจจุบันไม่ได้', 'warn');
  const n = new Date();
  return placeForm({ name: 'WP ' + n.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), cat: 'other', lat: +gps.fix.lat.toFixed(6), lng: +gps.fix.lng.toFixed(6) });
}

export function renderPlaces() {
  const s = getSettings();
  const f = app.placesFilter;
  const fix = here();
  const list = app.places.filter((p) => f === 'all' || p.cat === f).sort((a, b) => (fix ? distM(fix, a) - distM(fix, b) : b.createdAt - a.createdAt));
  const chips = ['all', ...Object.keys(CATS)].map((k) => `<button data-a="p-filter" data-k="${k}" class="${f === k ? 'on' : ''}">${k === 'all' ? 'ทั้งหมด' : CATS[k]}</button>`).join('');
  const cards = list
    .map((p) => `<div class="card"><div class="row"><div class="grow"><div class="title">${esc(p.name)} <span class="badge-s">${esc(CATS[p.cat] || '')}</span></div>
      <div class="sub num">${esc(joinCoord(p, s.coordFmt))}</div>
      ${fix ? `<div class="sub num">${dTxt(distM(fix, p))} · ${fmtBearing(bearing(fix, p))}</div>` : ''}${p.note ? `<div class="sub">${esc(p.note)}</div>` : ''}</div></div>
      <div class="row wrap" style="margin-top:8px"><button class="btn sm grow" data-a="p-show" data-id="${p.id}">${ic('map', 'sm')} ดูบนแผนที่</button><button class="btn sm primary grow" data-a="p-go" data-id="${p.id}">${ic('nav', 'sm')} นำทาง</button>
      <button class="btn icon ghost" data-a="p-edit" data-id="${p.id}" aria-label="แก้ไข">${ic('edit')}</button><button class="btn icon ghost" data-a="p-del" data-id="${p.id}" aria-label="ลบ">${ic('trash')}</button></div></div>`)
    .join('');
  return `<h1>สถานที่</h1>
  <div class="row wrap"><button class="btn primary grow" data-a="p-here" ${fix ? '' : 'disabled'}>${ic('pinplus', 'sm')} บันทึกตำแหน่งปัจจุบัน</button><button class="btn grow" data-a="p-new">เพิ่มด้วยพิกัด</button></div>
  ${fix ? '' : '<div class="note info">ยังไม่มีสัญญาณ GPS — บันทึกตำแหน่งปัจจุบันไม่ได้ แต่เพิ่มด้วยพิกัดหรือแตะบนแผนที่ได้</div>'}
  <h2>รายการที่บันทึกไว้ (${app.places.length})</h2><div class="chips">${chips}</div>
  ${cards || empty('pin', app.places.length ? 'ไม่มีสถานที่ในหมวดนี้' : 'ยังไม่มีสถานที่ที่บันทึก', 'แตะบนแผนที่ หรือกดปุ่มด้านบนเพื่อเพิ่ม')}`;
}

async function placeAction(a, el) {
  const p = app.places.find((x) => x.id === el.dataset.id);
  if (a === 'p-filter') { app.placesFilter = el.dataset.k; app.fn.refresh(); }
  else if (a === 'p-here') savePlaceHere();
  else if (a === 'p-new') placeForm({ cat: 'other' });
  else if (!p) return;
  else if (a === 'p-show') { app.fn.showTab('map'); app.fn.flyTo(p); app.fn.selectPoint({ lat: p.lat, lng: p.lng, name: p.name, placeId: p.id }); }
  else if (a === 'p-go') { startNav([p], p.name); app.fn.showTab('map'); }
  else if (a === 'p-edit') placeForm(p);
  else if (a === 'p-del') {
    if (await confirmDlg('ลบสถานที่นี้?', `“${p.name}” จะถูกลบถาวร`)) {
      try { await db.del('places', p.id); app.places = app.places.filter((x) => x.id !== p.id); app.fn.refresh(); toast('ลบแล้ว'); } catch { toast('ลบไม่สำเร็จ', 'err'); }
    }
  }
}

// ============================ TRIPS ============================
export function recCardHtml() {
  const s = getSettings();
  if (trip.rec.status === 'idle') {
    return `<div class="card"><div class="row"><div class="grow"><div class="title">ไม่ได้บันทึกการเดินทาง</div><div class="sub">บันทึกตำแหน่งทุกครั้งที่เรือเคลื่อนที่เกิน 8 ม. เก็บไว้ในเครื่อง</div></div>
      <button class="btn primary" data-a="t-start" ${gps.fix ? '' : 'disabled'}>${ic('rec', 'sm')} เริ่มบันทึก</button></div>${gps.fix ? '' : '<div class="sub" style="margin-top:6px">ต้องมีสัญญาณ GPS ก่อนจึงเริ่มบันทึกได้</div>'}</div>`;
  }
  const t = trip.rec.trip;
  const sm = trip.summary(t);
  const paused = trip.rec.status === 'paused';
  return `<div class="card"><div class="row"><span class="led ${paused ? 'warn' : 'bad pulse'}"></span><div class="grow"><div class="title">${paused ? 'หยุดชั่วคราว' : 'กำลังบันทึก'}: ${esc(t.name)}</div>
    <div class="sub num">${dTxt(sm.distanceM)} · ${fmtDur(sm.ms) || '0 นาที'} · ${t.points.length} จุด</div></div></div>
    <div class="row" style="margin-top:10px">${paused ? `<button class="btn primary grow" data-a="t-resume">${ic('play', 'sm')} เล่นต่อ</button>` : `<button class="btn grow" data-a="t-pause">${ic('pause', 'sm')} หยุดชั่วคราว</button>`}<button class="btn danger grow" data-a="t-stop">${ic('stop', 'sm')} สิ้นสุด</button></div></div>`;
}

export function renderTrips() {
  const s = getSettings();
  const cards = app.trips
    .filter((t) => t.status === 'done')
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((t) => {
      const sm = trip.summary(t);
      return `<div class="card"><div class="title">${esc(t.name)}</div><div class="sub">${fmtDateTime(t.startedAt)}</div>
      <div class="row wrap num" style="margin:8px 0;gap:18px"><div><div class="sub">ระยะทาง</div><b>${dTxt(sm.distanceM)}</b></div><div><div class="sub">เวลา</div><b>${fmtDur(sm.ms) || NA}</b></div>
      <div><div class="sub">เฉลี่ย</div><b>${joinVU(fmtSpeed(sm.avg, s.speedUnit))}</b></div><div><div class="sub">สูงสุด</div><b>${joinVU(fmtSpeed(sm.max, s.speedUnit))}</b></div></div>
      ${t.points.length < 2 ? '<div class="sub">ข้อมูลไม่พอสำหรับแสดงเส้นทาง</div>' : ''}
      <div class="row wrap"><button class="btn sm grow" data-a="t-view" data-id="${t.id}" ${t.points.length < 2 ? 'disabled' : ''}>${ic('map', 'sm')} ดูบนแผนที่</button><button class="btn sm grow" data-a="t-gpx" data-id="${t.id}" ${t.points.length < 1 ? 'disabled' : ''}>${ic('download', 'sm')} GPX</button>
      <button class="btn icon ghost" data-a="t-rename" data-id="${t.id}" aria-label="เปลี่ยนชื่อ">${ic('edit')}</button><button class="btn icon ghost" data-a="t-del" data-id="${t.id}" aria-label="ลบ">${ic('trash')}</button></div></div>`;
    })
    .join('');
  return `<h1>ทริป</h1><div id="recCard">${recCardHtml()}</div><h2>ประวัติการเดินทาง</h2>${cards || empty('trips', 'ยังไม่มีประวัติการเดินทาง', 'เมื่อสิ้นสุดการบันทึก ทริปจะแสดงที่นี่')}`;
}

async function tripAction(a, el) {
  const t = app.trips.find((x) => x.id === el.dataset.id);
  if (a === 't-start') { await trip.start(); toast('เริ่มบันทึกการเดินทาง'); }
  else if (a === 't-pause') await trip.pause();
  else if (a === 't-resume') await trip.resume();
  else if (a === 't-stop') {
    if (!(await confirmDlg('สิ้นสุดการบันทึก?', 'ทริปจะถูกบันทึกลงในเครื่อง', 'สิ้นสุด'))) return;
    const done = await trip.stop();
    if (done) { const i = app.trips.findIndex((x) => x.id === done.id); if (i >= 0) app.trips[i] = done; else app.trips.push(done); toast('บันทึกทริปแล้ว'); }
  } else if (!t) return;
  else if (a === 't-view') { app.viewTrip = t.id; app.fn.showTab('map'); }
  else if (a === 't-gpx') { try { downloadGpx(t); } catch { toast('ส่งออก GPX ไม่สำเร็จ', 'err'); } }
  else if (a === 't-rename') {
    const n = await modal({ title: 'เปลี่ยนชื่อทริป', body: `<div class="field"><input type="text" id="n" value="${esc(t.name)}" maxlength="80"></div>`, ok: 'บันทึก', onOk: (d) => d.querySelector('#n').value.trim() || false });
    if (n) { t.name = n; try { await db.put('trips', t); } catch { toast('บันทึกชื่อไม่สำเร็จ', 'err'); } app.fn.refresh(); }
  } else if (a === 't-del') {
    if (await confirmDlg('ลบทริปนี้?', `“${t.name}” และข้อมูลเส้นทางจะถูกลบถาวร`)) {
      try { await db.del('trips', t.id); app.trips = app.trips.filter((x) => x.id !== t.id); if (app.viewTrip === t.id) app.viewTrip = null; app.fn.refresh(); toast('ลบแล้ว'); } catch { toast('ลบไม่สำเร็จ', 'err'); }
    }
  }
  app.fn.refresh();
}

// ============================ SETTINGS ============================
const seg = (key, opts, cur) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-s="${key}" data-v="${v}" class="${cur === v ? 'on' : ''}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;

export function renderSettings() {
  const s = getSettings();
  const num = (key, label, hint, min, max, step = 1) => `<div class="setting"><div class="grow">${label}<small>${hint}</small></div><input type="number" style="width:96px" data-s="${key}" data-num="1" min="${min}" max="${max}" step="${step}" value="${s[key]}"></div>`;
  const sw = (key, label, hint) => `<div class="setting"><div class="grow">${label}<small>${hint}</small></div><input type="checkbox" class="switch" data-c="${key}" ${s[key] ? 'checked' : ''} aria-label="${esc(label)}"></div>`;
  return `<h1>ตั้งค่า</h1>
  <h2>การแสดงผล</h2><div class="card">
    <div class="field"><label>ธีม</label>${seg('theme', [['dark', 'มืด'], ['light', 'สว่าง'], ['contrast', 'คอนทราสต์สูง']], s.theme)}</div>
    <div class="sub">คอนทราสต์สูง: พื้นขาว ตัวอักษรดำ เหมาะกับแสงแดดจ้า</div></div>
  <h2>แผนที่</h2><div class="card">
    <div class="field"><label>แผนที่พื้นฐาน</label>${seg('base', [['osm', 'OpenStreetMap'], ['dark', 'มืด (CARTO)'], ['custom', 'กำหนดเอง']], s.base)}</div>
    ${s.base === 'custom' ? `<div class="field"><label>Tile URL (ต้องมี {z} {x} {y})</label><input type="text" data-s="customTileUrl" value="${esc(s.customTileUrl)}" placeholder="https://…/{z}/{x}/{y}.png"></div><div class="sub">โปรดตรวจเงื่อนไขการใช้งานและการแสดง attribution ของผู้ให้บริการที่ใช้</div>` : ''}
    ${sw('seamarks', 'ชั้นข้อมูลทางทะเล (OpenSeaMap)', 'ทุ่น ไฟ เครื่องหมายเดินเรือ — ข้อมูลจากอาสาสมัคร ไม่ใช่แผนที่เดินเรือทางการ')}</div>
  <h2>หน่วยและพิกัด</h2><div class="card">
    <div class="field"><label>ความเร็ว</label>${seg('speedUnit', [['kn', 'นอต'], ['kmh', 'กม./ชม.'], ['mph', 'ไมล์/ชม.']], s.speedUnit)}</div>
    <div class="field"><label>ระยะทาง</label>${seg('distUnit', [['nm', 'ไมล์ทะเล'], ['km', 'กม.'], ['mi', 'ไมล์']], s.distUnit)}</div>
    <div class="field"><label>รูปแบบพิกัด</label>${seg('coordFmt', [['dd', 'DD.DDDDD'], ['ddm', 'DD°MM.MMM′'], ['dms', 'DD°MM′SS″']], s.coordFmt)}</div></div>
  <h2>การนำทางและความปลอดภัย</h2><div class="card">
    ${num('plannedSpeedKn', 'ความเร็ววางแผน (นอต)', 'ใช้ประมาณเวลาในหน้าเส้นทางเท่านั้น', 1, 60)}
    ${num('offCourseM', 'เตือนเมื่อออกนอกเส้นทาง (เมตร)', 'วัดจากเส้นตรงของช่วงปัจจุบัน', 20, 5000, 10)}
    ${num('arriveM', 'รัศมีถึงจุดหมาย (เมตร)', 'ถึงจุดนี้แล้วจะเลื่อนไปจุดถัดไป', 20, 2000, 10)}
    ${num('lowAccM', 'เตือนความแม่นยำต่ำ (เมตร)', 'เตือนเมื่อ GPS accuracy แย่กว่าค่านี้', 10, 500, 5)}
    ${sw('wakeLock', 'เปิดหน้าจอค้างไว้', 'ป้องกันหน้าจอดับขณะใช้งาน (ใช้แบตเตอรี่มากขึ้น)')}
    ${sw('sound', 'เสียง/สั่นเมื่อมีการเตือนสำคัญ', 'ใช้กับ Anchor Watch และ GPS ขาดหาย')}</div>
  <h2>เซนเซอร์ทิศทาง</h2><div class="card"><div class="setting"><div class="grow">เข็มทิศของอุปกรณ์ (Heading)<small>${gps.compassOn ? 'เปิดอยู่ — ค่านี้คือทิศของ<b>โทรศัพท์</b> ถูกต้องเมื่อยึดโทรศัพท์ขนานกับหัวเรือ' : 'ปิดอยู่ — Heading จะแสดง “ไม่มีข้อมูล”'}</small></div>
    <button class="btn sm ${gps.compassOn ? '' : 'primary'}" data-a="s-compass">${gps.compassOn ? 'ปิด' : 'เปิดใช้'}</button></div></div>
  <h2>ข้อมูลในเครื่อง</h2><div class="card"><button class="btn block" data-a="s-cache">ล้างแคชแผนที่ออฟไลน์</button><div class="sub" style="margin-top:8px">Waypoints เส้นทาง และทริปไม่ถูกลบ</div></div>
  <h2>เกี่ยวกับ</h2><div class="note">Boat Navigator เป็นเครื่องมือช่วยประกอบการเดินเรือ <b>ไม่ใช่</b>เครื่องมือนำทางหลัก และไม่ทดแทนแผนที่เดินเรือทางการ การสังเกตการณ์ และวิจารณญาณของผู้ควบคุมเรือ แอปไม่ตรวจจับสิ่งกีดขวาง ความลึก หรือป้องกันการชน</div>`;
}

async function settingsAction(a) {
  if (a === 's-compass') {
    if (gps.compassOn) disableCompass();
    else if (!(await enableCompass())) toast('เปิดเข็มทิศไม่ได้ — อุปกรณ์ไม่รองรับหรือไม่ได้รับอนุญาต', 'err');
    app.fn.refresh();
  } else if (a === 's-cache') {
    if (!(await confirmDlg('ล้างแคชแผนที่?', 'แผนที่ที่ดูไว้แล้วจะต้องโหลดใหม่เมื่อมีอินเทอร์เน็ต', 'ล้างแคช'))) return;
    try { for (const k of await caches.keys()) if (k.startsWith('bn-tiles')) await caches.delete(k); toast('ล้างแคชแผนที่แล้ว'); } catch { toast('ล้างแคชไม่สำเร็จ', 'err'); }
  }
}

// ============================ dispatch ============================
export async function onPageClick(e) {
  const seg = e.target.closest('[data-s][data-v]');
  if (seg) { setSetting(seg.dataset.s, seg.dataset.v); app.fn.refresh(); return; }
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  try {
    if (a.startsWith('r-') || a === 'n-stop') await routeAction(a, b);
    else if (a.startsWith('p-')) await placeAction(a, b);
    else if (a.startsWith('t-')) await tripAction(a, b);
    else if (a.startsWith('s-')) await settingsAction(a);
  } catch (err) {
    console.error(err);
    toast('เกิดข้อผิดพลาด: ' + err.message, 'err');
  }
}

export function onPageChange(e) {
  const t = e.target;
  if (t.dataset.c === 'useCurrent') { app.draft.useCurrent = t.checked; saveDraft(); app.fn.refresh(); }
  else if (t.dataset.c) { setSetting(t.dataset.c, t.checked); }
  else if (t.dataset.s && t.dataset.num) {
    const v = parseFloat(t.value);
    const min = parseFloat(t.min), max = parseFloat(t.max);
    if (Number.isFinite(v) && v >= min && v <= max) setSetting(t.dataset.s, v);
    else { toast(`ค่าต้องอยู่ระหว่าง ${min}–${max}`, 'warn'); t.value = getSettings()[t.dataset.s]; }
  } else if (t.dataset.s) setSetting(t.dataset.s, t.value.trim());
}
