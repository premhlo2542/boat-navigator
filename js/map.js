// Leaflet (+ leaflet-rotate) map wrapper. Pure rendering: callers pass data, nothing here owns app state.
import { lsGet, lsSet, emit } from './store.js';

const L = window.L;
let map, base, seamarks, boat, acc, anchorCirc, anchorMk;
let follow = true;
const lines = {};
const groups = {};
const sig = {};

// ---- rotation state (map bearing = clockwise turn of the map, so heading-up needs bearing = -heading): "course" = boat points up and the map turns; "north" = map fixed, boat turns ----
let mode = lsGet('bn.mapmode', 'course');
let heading = null; // degrees of travel/boat heading, or null if unknown
let target = 0; // desired map bearing
let raf = 0;

const BASES = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', max: 19 },
};
const SEAMARK = { url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', attr: 'Seamarks &copy; <a href="https://www.openseamap.org">OpenSeaMap</a> contributors' };

export function initMap(el) {
  const view = lsGet('bn.view', { lat: 13.0, lng: 100.3, z: 7 });
  map = L.map(el, { zoomControl: false, attributionControl: true, maxZoom: 19, zoomSnap: 0.5, rotate: true, bearing: 0, touchRotate: false, rotateControl: false, shiftKeyRotate: false }).setView([view.lat, view.lng], view.z);
  map.attributionControl.setPrefix(false);
  map.createPane('ovl').style.zIndex = 450;
  map.on('moveend', () => { const c = map.getCenter(); lsSet('bn.view', { lat: c.lat, lng: c.lng, z: map.getZoom() }); });
  map.on('dragstart', () => { if (follow) { follow = false; emit('follow', false); } });
  map.on('click', (e) => emit('mapclick', { lat: e.latlng.lat, lng: e.latlng.lng }));
  return map;
}

export function applyTiles(s) {
  if (base) map.removeLayer(base);
  if (seamarks) { map.removeLayer(seamarks); seamarks = null; }
  let b = BASES.osm;
  if (s.base === 'custom' && /^https?:\/\/.*\{z\}.*\{x\}.*\{y\}/.test(s.customTileUrl)) b = { url: s.customTileUrl, attr: 'Custom tile provider', max: 19 };
  base = L.tileLayer(b.url, { attribution: b.attr, maxZoom: b.max, keepBuffer: 4, updateWhenIdle: false });
  base.on('tileload', () => emit('tile', true));
  base.on('tileerror', () => emit('tile', false));
  base.addTo(map);
  if (s.seamarks) {
    seamarks = L.tileLayer(SEAMARK.url, { attribution: SEAMARK.attr, maxZoom: 18, opacity: 0.95 });
    seamarks.addTo(map);
  }
}

// ------------------------------------------------------------------ boat
const boatHtml = (hasDir) =>
  hasDir
    ? '<div class="boat-rot"><svg viewBox="0 0 40 40"><path d="M20 3 33 35 20 28 7 35z" class="boat-hull"/></svg></div>'
    : '<div class="boat-rot"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="9" class="boat-hull"/></svg></div>';
let boatDir = null;
const boatIcon = (d) => L.divIcon({ className: 'boat', html: boatHtml(d), iconSize: [48, 48], iconAnchor: [24, 24] });

function boatRotation() {
  if (heading == null) return null;
  // leaflet-rotate's bearing turns the map clockwise, so on screen the boat points at heading + bearing.
  return (((heading + (map.getBearing ? map.getBearing() : 0)) % 360) + 360) % 360;
}

function applyBoat() {
  if (!boat) return;
  const deg = boatRotation();
  const hasDir = deg != null;
  if (boatDir !== hasDir) { boat.setIcon(boatIcon(hasDir)); boatDir = hasDir; }
  const rot = boat.getElement()?.firstChild;
  if (rot && hasDir) rot.style.transform = `rotate(${deg}deg)`;
}

export function updateBoat(fix) {
  if (!fix) return;
  const ll = [fix.lat, fix.lng];
  if (!boat) {
    boatDir = heading != null;
    boat = L.marker(ll, { icon: boatIcon(boatDir), interactive: true, zIndexOffset: 1000, keyboard: false });
    boat.on('click', (e) => { L.DomEvent.stopPropagation(e); emit('boatclick'); });
    acc = L.circle(ll, { radius: fix.acc || 0, className: 'acc-ring', interactive: false, weight: 1 });
    acc.addTo(map);
    boat.addTo(map);
  } else {
    boat.setLatLng(ll);
    acc.setLatLng(ll).setRadius(fix.acc || 0);
  }
  applyBoat();
  if (follow) map.setView(ll, Math.max(map.getZoom(), 14), { animate: true, duration: 0.5 });
}

export function setBoatStale(stale) { boat?.getElement()?.classList.toggle('stale', stale); }

// ------------------------------------------------------------------ rotation
function stepBearing() {
  raf = 0;
  const cur = map.getBearing();
  const diff = ((target - cur + 540) % 360) - 180;
  if (Math.abs(diff) < 0.4) { map.setBearing(target); applyBoat(); emit('bearing', target); return; }
  map.setBearing((cur + diff * 0.25 + 360) % 360);
  applyBoat();
  emit('bearing', map.getBearing());
  raf = requestAnimationFrame(stepBearing);
}

function turnTo(b) {
  target = ((b % 360) + 360) % 360;
  if (!raf) raf = requestAnimationFrame(stepBearing);
}

/** Boat/travel heading in degrees (null = unknown). In course-up mode while following, the map turns to match. */
export function setHeading(h) {
  const changed = heading == null || h == null || Math.abs(((h - heading + 540) % 360) - 180) >= 1.5;
  if (!changed) return;
  heading = h;
  if (mode === 'course' && follow && h != null) turnTo(-h);
  else applyBoat();
}

export function setMode(m) {
  mode = m;
  lsSet('bn.mapmode', m);
  if (m === 'north') turnTo(0);
  else if (follow && heading != null) turnTo(-heading);
  applyBoat();
  emit('mode', m);
}
export const getMode = () => mode;
export const getBearing = () => (map ? map.getBearing() : 0);
export const resetNorth = () => turnTo(0);

// ------------------------------------------------------------------ camera
export function setFollow(on) {
  follow = on;
  emit('follow', on);
  if (on && mode === 'course' && heading != null) turnTo(-heading);
}
export const isFollowing = () => follow;

/** Zoom in and lock onto the boat (like the "my location" button in a car-navigation app). */
export function lockOn(fix, zoom = 17) {
  if (!fix) return;
  setFollow(true);
  map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), zoom), { animate: true });
}

export const flyTo = (p, z = 15) => { setFollow(false); map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), z), { duration: 0.8 }); };
export const zoomBy = (d) => map.setZoom(map.getZoom() + d);
export const fitPoints = (pts, pad = 60) => {
  if (!pts.length) return;
  setFollow(false);
  map.fitBounds(L.latLngBounds(pts.map((p) => [p[0] ?? p.lat, p[1] ?? p.lng])), { padding: [pad, pad], maxZoom: 16 });
};
export const invalidate = () => map && map.invalidateSize();
export const onResize = invalidate;
export const getZoom = () => map.getZoom();
export const latLngToPoint = (lat, lng) => map.latLngToContainerPoint([lat, lng]);

// ------------------------------------------------------------------ overlays
export function setLine(key, pts, opts = {}) {
  if (!pts || pts.length < 2) {
    if (lines[key]) { map.removeLayer(lines[key]); delete lines[key]; }
    return;
  }
  if (lines[key] && lines[key].options.className === opts.className) { lines[key].setLatLngs(pts); return; }
  if (lines[key]) map.removeLayer(lines[key]);
  lines[key] = L.polyline(pts, { pane: 'ovl', weight: 4, opacity: 0.95, lineJoin: 'round', ...opts }).addTo(map);
}

/** items: [{lat,lng,html,cls,z,onClick}]. Markers are rebuilt only when their content changed, so taps are never lost. */
export function setMarkers(key, items) {
  const s = JSON.stringify(items.map((i) => [i.lat, i.lng, i.html, i.cls, i.id]));
  if (sig[key] === s) return;
  sig[key] = s;
  groups[key] ||= L.layerGroup().addTo(map);
  groups[key].clearLayers();
  for (const it of items) {
    const m = L.marker([it.lat, it.lng], { icon: L.divIcon({ className: 'pin ' + (it.cls || ''), html: it.html, iconSize: [44, 44], iconAnchor: [22, 22] }), keyboard: false, zIndexOffset: it.z || 0 });
    if (it.onClick) m.on('click', (e) => { L.DomEvent.stopPropagation(e); it.onClick(); });
    groups[key].addLayer(m);
  }
}

export function setAnchorMark(a) {
  const s = a?.active ? [a.lat, a.lng, a.radius].join() : '';
  if (sig.anchor === s) return;
  sig.anchor = s;
  if (anchorCirc) { map.removeLayer(anchorCirc); anchorCirc = null; }
  if (anchorMk) { map.removeLayer(anchorMk); anchorMk = null; }
  if (!a?.active) return;
  anchorCirc = L.circle([a.lat, a.lng], { radius: a.radius, className: 'anchor-ring', interactive: false, weight: 2, dashArray: '6 6' }).addTo(map);
  anchorMk = L.marker([a.lat, a.lng], { icon: L.divIcon({ className: 'pin anchor', html: '<svg class="ic"><use href="#i-anchor"/></svg>', iconSize: [44, 44], iconAnchor: [22, 22] }), interactive: false }).addTo(map);
}
