// Shared mutable UI/data state + cross-module function registry (avoids circular imports).
import { lsGet, lsSet } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export const CATS = {
  marina: 'มารีน่า',
  harbor: 'ท่าเรือ',
  fishing: 'จุดตกปลา',
  favorite: 'รายการโปรด',
  other: 'อื่นๆ',
};

export const app = {
  tab: 'map',
  places: [],
  routes: [],
  trips: [],
  draft: lsGet('bn.draft', { useCurrent: true, points: [] }),
  selected: null, // {lat,lng,name,placeId}
  bar: null, // {text, label, done}  top action bar on the map (pick / trip view)
  viewTrip: null,
  searchMode: 'goto', // goto | draft
  placesFilter: 'all',
  hudOpen: false,
  fn: {}, // filled by main.js: showTab, refresh, openSearch, selectPoint, startPick ...
};

export const saveDraft = () => lsSet('bn.draft', app.draft);
