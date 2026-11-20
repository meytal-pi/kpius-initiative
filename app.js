/* D&D 5e Initiative Tracker — plain JS, no build step. */
(function () {
  'use strict';

  // ================================================================
  //  Polyfills for older tablet browsers
  // ================================================================
  if (!Array.prototype.flat) {
    Object.defineProperty(Array.prototype, 'flat', {
      configurable: true, writable: true,
      value: function flat(depth) {
        const d = depth === undefined ? 1 : Number(depth);
        return this.reduce((acc, v) => acc.concat(Array.isArray(v) && d > 0 ? v.flat(d - 1) : [v]), []);
      },
    });
  }
  [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach((proto) => {
    if (proto.replaceChildren) return;
    proto.replaceChildren = function () {
      while (this.lastChild) this.removeChild(this.lastChild);
      for (let i = 0; i < arguments.length; i++) {
        const n = arguments[i];
        this.appendChild(typeof n === 'object' ? n : document.createTextNode(String(n)));
      }
    };
  });

  // ================================================================
  //  Constants
  // ================================================================
  const TYPES = {
    pc:    { label: 'Player' },
    ally:  { label: 'Ally' },
    npc:   { label: 'NPC' },
    enemy: { label: 'Enemy' },
    other: { label: 'Lair / Other' },
  };
  const TYPE_KEYS = Object.keys(TYPES);
  const CONDITIONS = [
    'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled',
    'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone',
    'Restrained', 'Stunned', 'Unconscious', 'Concentrating',
  ];
  const FB_VERSION = '10.12.2';

  // ================================================================
  //  Small utilities
  // ================================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') e.style.cssText = v;
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else if (k === 'value') e.value = v;
        else if (k === 'checked') e.checked = !!v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false || c === '') continue;
      e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  // Like replaceChildren, but accepts nested arrays and skips null/false.
  function fill(parent, ...children) {
    parent.replaceChildren();
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false || c === '') continue;
      parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
  }

  function cleanObj(o) {
    const r = {};
    for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== false && v !== '') r[k] = v;
    return r;
  }

  function cleanRoom(s) {
    return String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'my-table';
  }

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('it:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('it:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function bumpName(name) {
    const m = /^(.*?)(\d+)$/.exec(name.trim());
    return m ? m[1] + (parseInt(m[2], 10) + 1) : name.trim() + ' 2';
  }
  function uniqueName(name) {
    const names = new Set(Object.values(state.combatants).map((c) => (c.name || '').toLowerCase()));
    let n = name;
    let guard = 0;
    while (names.has(n.toLowerCase()) && guard++ < 200) n = bumpName(n);
    return n;
  }

  const isTyping = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

  // ================================================================
  //  Device preferences (per device, not synced)
  // ================================================================
  const params = new URLSearchParams(location.search);
  if (params.has('dm')) LS.set('dm', params.get('dm') !== '0');
  if (params.has('room')) LS.set('room', cleanRoom(params.get('room')));
  if (params.has('room') || params.has('dm')) {
    // Don't leave the table code in the address bar / bookmarks / history.
    params.delete('room'); params.delete('dm');
    const qs = params.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) { /* ignore */ }
  }
  const MINI_MODE = params.get('mini') === '1';

  const prefs = {
    dm: LS.get('dm', null), // null = not chosen yet → ask on first visit
    // Room code: asked once per device (not stored in the public files).
    room: LS.get('room', null) || (window.DEFAULT_ROOM ? cleanRoom(window.DEFAULT_ROOM) : null),
    scale: LS.get('scale', 1),
  };

  // ================================================================
  //  Stores: Firebase (synced) or Local (this browser only)
  // ================================================================
  function setPath(obj, parts, val) {
    const stack = [];
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (typeof o[k] !== 'object' || o[k] === null) {
        if (val === null) return;
        o[k] = {};
      }
      stack.push([o, k]);
      o = o[k];
    }
    const last = parts[parts.length - 1];
    if (val === null) delete o[last]; else o[last] = val;
    for (let i = stack.length - 1; i >= 0; i--) {
      const [po, k] = stack[i];
      if (po[k] && typeof po[k] === 'object' && Object.keys(po[k]).length === 0) delete po[k];
      else break;
    }
  }

  class LocalStore {
    constructor(room) {
      this.key = 'it:room:' + room;
      this.data = this.read();
      window.addEventListener('storage', (e) => {
        if (e.key === this.key) { this.data = this.read(); this.emit(); }
      });
    }
    read() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch (e) { return {}; } }
    emit() { if (this.cb) this.cb(clone(this.data)); }
    subscribe(cb) { this.cb = cb; this.emit(); }
    onStatus(cb) { cb('local'); }
    update(paths) {
      for (const [p, v] of Object.entries(paths)) setPath(this.data, p.split('/'), v == null ? null : clone(v));
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
      this.emit();
      return Promise.resolve();
    }
  }

  class FirebaseStore {
    constructor(config, room) {
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
      this.db = firebase.database(app);
      this.ref = this.db.ref('rooms/' + room);
    }
    subscribe(cb, onErr) {
      this.ref.on('value', (snap) => cb(snap.val() || {}), (err) => onErr && onErr(err));
    }
    onStatus(cb) {
      let first = true;
      this.db.ref('.info/connected').on('value', (s) => {
        if (s.val()) cb('online');
        else cb(first ? 'connecting' : 'offline');
        first = false;
      });
    }
    update(paths) {
      return this.ref.update(clone(paths)).catch((err) => {
        toast('Sync error: ' + err.message);
        showBanner('Could not save to Firebase: ' + err.message + ' — check the database rules (SETUP.md).', 'error');
      });
    }
  }

  // ================================================================
  //  State
  // ================================================================
  let store = null;
  let state = normalize({});

  function normalize(raw) {
    raw = raw || {};
    return {
      combatants: raw.combatants || {},
      party: raw.party || {},
      settings: Object.assign({ turnTracking: false }, raw.settings),
      turn: Object.assign({ active: false, round: 1, currentId: null }, raw.turn),
    };
  }

  function allCombatants() {
    return Object.entries(state.combatants).map(([id, c]) =>
      Object.assign({ type: 'enemy' }, c, { id, conditions: c.conditions || {} }));
  }
  function placedList() {
    return allCombatants()
      .filter((c) => typeof c.init === 'number')
      .sort((a, b) => (a.order || 0) - (b.order || 0) || b.init - a.init || (a.created || 0) - (b.created || 0));
  }
  function pendingList() {
    return allCombatants()
      .filter((c) => typeof c.init !== 'number')
      .sort((a, b) => (a.created || 0) - (b.created || 0));
  }
  const isVisible = (c) => prefs.dm || !c.hidden;
  const trackingOn = () => !!state.settings.turnTracking;
  const combatActive = () => trackingOn() && !!state.turn.active;
  const isPartyMember = (c) => c.type === 'pc' || !!c.partyId;

  function turnInfo(list) {
    if (!combatActive()) return { current: null, next: null };
    const idx = list.findIndex((c) => c.id === state.turn.currentId);
    if (idx === -1) return { current: null, next: null };
    const current = isVisible(list[idx]) ? list[idx].id : null;
    let next = null;
    for (let k = 1; k < list.length; k++) {
      const c = list[(idx + k) % list.length];
      if (isVisible(c)) { next = c.id; break; }
    }
    return { current, next };
  }

  function orderPaths(ids, skip) {
    const p = {};
    ids.forEach((id, i) => { if (!skip || !skip.has(id)) p[`combatants/${id}/order`] = i; });
    return p;
  }

  // ================================================================
  //  Actions
  // ================================================================
  function snapshot() { return { combatants: clone(state.combatants), turn: clone(state.turn) }; }
  function restore(snap) {
    const c = snap.combatants && Object.keys(snap.combatants).length ? snap.combatants : null;
    store.update({ combatants: c, turn: snap.turn });
  }
  function undoable(label, fn) {
    const snap = snapshot();
    fn();
    toast(label, { action: 'Undo', onAction: () => restore(snap) });
  }

  // Ask the user where a tied combatant goes. Resolves to an index in `list` or null (cancel).
  function chooseSlot(list, n, name) {
    const lowerIdx = list.findIndex((c) => c.init < n);
    const defaultIdx = lowerIdx === -1 ? list.length : lowerIdx;
    const tied = list.filter((c) => c.init === n && isVisible(c));
    if (!tied.length) return Promise.resolve(defaultIdx);

    return new Promise((resolve) => {
      let done = false;
      const pick = (idx) => { done = true; closeModal(); resolve(idx); };
      const slots = [];
      for (let k = 0; k <= tied.length; k++) {
        let label, idx;
        if (k === 0) { label = `Before ${tied[0].name}`; idx = list.indexOf(tied[0]); }
        else if (k === tied.length) { label = `After ${tied[k - 1].name}`; idx = list.indexOf(tied[k - 1]) + 1; }
        else { label = `Between ${tied[k - 1].name} and ${tied[k].name}`; idx = list.indexOf(tied[k]); }
        slots.push(el('button', { class: 'btn slot-btn', onclick: () => pick(idx) }, label));
      }
      const m = openModal({
        title: `Tie at ${n}!`,
        body: el('div', { class: 'tie' },
          el('p', null, el('b', null, name || 'This one'), ' tied with ',
            tied.map((t) => t.name).join(', '), '. Who goes first?'),
          el('p', { class: 'muted small' }, 'Tip: compare DEX modifiers, or roll off.'),
          el('div', { class: 'slot-list' }, slots)),
        footer: [el('button', { class: 'btn', onclick: closeModal }, 'Cancel')],
      });
      m.onClose = () => { if (!done) resolve(null); };
    });
  }

  async function setInitiative(id, n) {
    const c = state.combatants[id];
    if (!c) return false;
    const list = placedList().filter((x) => x.id !== id);
    const idx = await chooseSlot(list, n, c.name);
    if (idx == null) return false;
    const ids = list.map((x) => x.id);
    ids.splice(idx, 0, id);
    const paths = orderPaths(ids);
    paths[`combatants/${id}/init`] = n;
    store.update(paths);
    return true;
  }

  function clearInitiative(id) {
    store.update({ [`combatants/${id}/init`]: null });
  }

  async function addCombatant(data) {
    const id = uid();
    const obj = cleanObj({
      name: data.name, type: data.type, hidden: !!data.hidden,
      partyId: data.partyId || null, created: Date.now(),
    });
    if (typeof data.init === 'number' && !isNaN(data.init)) {
      const list = placedList();
      const idx = await chooseSlot(list, data.init, data.name);
      if (idx == null) return null;
      const ids = list.map((c) => c.id);
      ids.splice(idx, 0, id);
      const paths = orderPaths(ids, new Set([id]));
      obj.init = data.init;
      obj.order = idx;
      paths[`combatants/${id}`] = obj;
      store.update(paths);
    } else {
      store.update({ [`combatants/${id}`]: obj });
    }
    return id;
  }

  function removeCombatant(id) {
    const c = state.combatants[id];
    if (!c) return;
    undoable(`Removed ${c.name}`, () => {
      const paths = { [`combatants/${id}`]: null };
      if (state.turn.active && state.turn.currentId === id) {
        const list = placedList();
        const i = list.findIndex((x) => x.id === id);
        const nx = list[i + 1] || list[0];
        paths['turn/currentId'] = nx && nx.id !== id ? nx.id : null;
      }
      store.update(paths);
    });
  }

  function duplicateCombatant(id) {
    const c = state.combatants[id];
    if (!c) return;
    const newId = uid();
    const obj = cleanObj({ name: uniqueName(bumpName(c.name || 'Creature')), type: c.type, hidden: !!c.hidden, created: Date.now() });
    if (typeof c.init === 'number') {
      const ids = placedList().map((x) => x.id);
      const idx = ids.indexOf(id) + 1;
      ids.splice(idx, 0, newId);
      const paths = orderPaths(ids, new Set([newId]));
      obj.init = c.init;
      obj.order = idx;
      paths[`combatants/${newId}`] = obj;
      store.update(paths);
    } else {
      store.update({ [`combatants/${newId}`]: obj });
    }
    toast(`Added ${obj.name}`);
  }

  function moveToEnd(id) {
    const ids = placedList().map((x) => x.id).filter((x) => x !== id);
    ids.push(id);
    store.update(orderPaths(ids));
  }

  function sortByInitiative() {
    undoable('Sorted by initiative', () => {
      const list = placedList();
      const sorted = list.map((c, i) => ({ c, i })).sort((a, b) => b.c.init - a.c.init || a.i - b.i).map((x) => x.c.id);
      store.update(orderPaths(sorted));
    });
  }

  function partyMissing() {
    const present = new Set(Object.values(state.combatants).map((c) => c.partyId).filter(Boolean));
    return Object.entries(state.party).filter(([pid]) => !present.has(pid));
  }

  function addParty(only) {
    const missing = partyMissing().filter(([pid]) => !only || pid === only);
    if (!missing.length) { toast('Party is already in the encounter'); return; }
    const paths = {};
    let t = Date.now();
    for (const [pid, p] of missing) {
      paths[`combatants/${uid()}`] = { name: p.name, type: p.type || 'pc', partyId: pid, created: t++ };
    }
    store.update(paths);
  }

  function removeAllExceptPlayers() {
    undoable('Removed all except players', () => {
      const paths = {};
      for (const c of allCombatants()) if (!isPartyMember(c)) paths[`combatants/${c.id}`] = null;
      paths.turn = { active: false, round: 1 };
      store.update(paths);
    });
  }

  function newEncounter() {
    undoable('New encounter started', () => {
      const paths = {};
      for (const c of allCombatants()) {
        if (!isPartyMember(c)) paths[`combatants/${c.id}`] = null;
        else { paths[`combatants/${c.id}/init`] = null; paths[`combatants/${c.id}/order`] = null; }
      }
      paths.turn = { active: false, round: 1 };
      store.update(paths);
    });
  }

  function clearEverything() {
    undoable('Removed everyone', () => store.update({ combatants: null, turn: { active: false, round: 1 } }));
  }

  function clearAllConditions() {
    undoable('Cleared all conditions', () => {
      const paths = {};
      for (const c of allCombatants()) if (Object.keys(c.conditions).length) paths[`combatants/${c.id}/conditions`] = null;
      store.update(paths);
    });
  }

  function revealCombatant(id) {
    const c = state.combatants[id];
    if (!c) return;
    store.update({ [`combatants/${id}/hidden`]: null });
    toast(`${c.name} is now visible to players`, {
      action: 'Undo', onAction: () => store.update({ [`combatants/${id}/hidden`]: true }),
    });
  }

  // ---------- turn tracking ----------
  function startCombat() {
    const list = placedList();
    if (!list.length) { toast('Enter some initiative first'); return; }
    store.update({ turn: { active: true, round: 1, currentId: list[0].id } });
  }
  function endCombat() {
    store.update({ turn: { active: false, round: 1 } });
  }
  function setCurrent(id) {
    store.update({ 'turn/active': true, 'turn/currentId': id, 'turn/round': state.turn.round || 1 });
  }
  function nextTurn() {
    const list = placedList();
    if (!list.length) return;
    const t = state.turn;
    const idx = list.findIndex((c) => c.id === t.currentId);
    if (!t.active || idx === -1) {
      store.update({ turn: { active: true, round: t.active ? t.round || 1 : 1, currentId: list[0].id } });
      return;
    }
    const paths = {};
    const cur = list[idx];
    const ended = [];
    for (const [cid, cd] of Object.entries(cur.conditions)) {
      if (cd.rounds > 0) {
        const r = cd.rounds - 1;
        if (r <= 0) { paths[`combatants/${cur.id}/conditions/${cid}`] = null; ended.push(cd.name); }
        else paths[`combatants/${cur.id}/conditions/${cid}/rounds`] = r;
      }
    }
    let n = idx + 1;
    let round = t.round || 1;
    if (n >= list.length) { n = 0; round++; }
    paths['turn/currentId'] = list[n].id;
    paths['turn/round'] = round;
    store.update(paths);
    if (ended.length) toast(`${ended.join(', ')} ended on ${cur.name}`);
  }
  function prevTurn() {
    const list = placedList();
    if (!list.length || !state.turn.active) return;
    const idx = list.findIndex((c) => c.id === state.turn.currentId);
    let n = idx - 1;
    let round = state.turn.round || 1;
    if (idx === -1) n = 0;
    else if (n < 0) { if (round <= 1) return; n = list.length - 1; round--; }
    store.update({ 'turn/currentId': list[n].id, 'turn/round': round });
  }

  // ================================================================
  //  Rendering: main view
  // ================================================================
  let drag = null;
  let renderQueued = false;

  function condText(cd) {
    return cd.name + (cd.level ? ' ' + cd.level : '');
  }
  function condChips(c, onclick) {
    return Object.entries(c.conditions).map(([cid, cd]) =>
      el('span', {
        class: 'chip' + (cd.name === 'Concentrating' ? ' chip-conc' : ''),
        onclick,
      }, condText(cd), cd.rounds > 0 && el('span', { class: 'chip-dur' }, '⏳' + cd.rounds)));
  }

  function renderRow(c, ti) {
    const isCur = ti.current === c.id;
    const isNext = ti.next === c.id;
    const openCond = (e) => { e.stopPropagation(); openConditions(c.id); };
    return el('div', {
      class: `row t-${c.type}${isCur ? ' current' : ''}${isNext ? ' next' : ''}${c.hidden ? ' is-hidden' : ''}`,
      dataset: { id: c.id },
    },
    el('div', { class: 'handle', title: 'Drag to reorder', onpointerdown: (e) => startDrag(e, c.id) }, '⠿'),
    el('button', { class: 'init', title: 'Change initiative', onclick: () => openKeypad(c.id) }, String(c.init)),
    el('div', { class: 'info', onclick: () => openEdit(c.id) },
      el('div', { class: 'name-line' },
        el('span', { class: 'name' }, c.name || '?'),
        el('span', { class: 'type-label' }, (TYPES[c.type] || {}).label || ''),
        c.hidden && revealButton(c.id),
        isCur && el('span', { class: 'tag now-tag' }, 'NOW'),
        isNext && el('span', { class: 'tag next-tag' }, 'NEXT')),
      Object.keys(c.conditions).length > 0 && el('div', { class: 'conds' }, condChips(c, openCond))),
    el('button', { class: 'cond-btn', title: 'Conditions', onclick: openCond }, '✚'));
  }

  function revealButton(id, small) {
    return el('button', {
      class: 'reveal-btn' + (small ? ' small' : ''), title: 'Hidden from players — click to reveal',
      onclick: (e) => { e.stopPropagation(); revealCombatant(id); },
    }, '🙈 Hidden', el('span', { class: 'reveal-action' }, 'Reveal'));
  }

  function renderPending(c) {
    return el('div', { class: `pending t-${c.type}${c.hidden ? ' is-hidden' : ''}` },
      el('button', { class: 'pending-main', onclick: () => openKeypad(c.id) },
        el('span', { class: 'pname' }, c.name || '?'),
        el('span', { class: 'ptap' }, 'tap to set')),
      c.hidden && el('div', { class: 'pending-reveal' }, revealButton(c.id, true)),
      el('button', { class: 'pending-more', title: 'Edit', onclick: () => openEdit(c.id) }, '⋯'));
  }

  function render() {
    if (drag) { renderQueued = true; return; }
    document.body.classList.toggle('dm', !!prefs.dm);
    const badge = $('#roleBadge');
    badge.textContent = prefs.dm ? '🛡 DM screen' : '🎲 Players';
    badge.className = 'role-badge ' + (prefs.dm ? 'role-dm' : 'role-players');

    const placed = placedList();
    const pending = pendingList();
    const vPlaced = placed.filter(isVisible);
    const vPending = pending.filter(isVisible);
    const ti = turnInfo(placed);

    $('#roundBox').classList.toggle('hidden', !combatActive());
    $('#roundNum').textContent = state.turn.round || 1;

    $('#pendingSection').classList.toggle('hidden', !vPending.length);
    $('#pendingList').replaceChildren(...vPending.map(renderPending));
    $('#orderList').replaceChildren(...vPlaced.map((c) => renderRow(c, ti)));

    const empty = $('#emptyState');
    const isEmpty = !vPlaced.length && !vPending.length;
    empty.classList.toggle('hidden', !isEmpty);
    if (isEmpty) {
      const partyCount = Object.keys(state.party).length;
      empty.replaceChildren(
        el('div', { class: 'empty-icon' }, '🎲'),
        el('p', null, 'No one in the initiative yet.'),
        partyCount
          ? el('button', { class: 'btn primary', onclick: () => addParty() }, `Add the party (${partyCount})`)
          : el('p', { class: 'muted' }, 'Tip: save your players under “Party” so they can be added with one tap.'),
        el('button', { class: 'btn', onclick: () => openAdd() }, '＋ Add combatant'));
    }

    $('#turnControls').classList.toggle('hidden', !combatActive());
    $('#btnStart').classList.toggle('hidden', !(trackingOn() && !state.turn.active && vPlaced.length));

    if (modal && modal.refresh) modal.refresh();
    renderMini();

    // keep current turn in view
    if (ti.current) {
      const row = $(`#orderList .row[data-id="${ti.current}"]`);
      if (row && lastScrolledTo !== ti.current) { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); lastScrolledTo = ti.current; }
    }
  }
  let lastScrolledTo = null;

  // ================================================================
  //  Drag & drop (pointer events: works for mouse and touch)
  // ================================================================
  function startDrag(e, id) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const row = handle.closest('.row');
    const list = $('#orderList');
    const rect = row.getBoundingClientRect();
    const ph = el('div', { class: 'row-placeholder', style: `height:${rect.height}px` });
    list.insertBefore(ph, row);
    Object.assign(row.style, {
      position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', zIndex: 50,
    });
    row.classList.add('dragging');
    drag = { id, row, ph, list, handle, offsetY: e.clientY - rect.top, y: e.clientY, raf: 0 };
    try { handle.setPointerCapture(e.pointerId); } catch (e) { /* ignore */ }
    handle.addEventListener('pointermove', onDragMove);
    handle.addEventListener('pointerup', onDragEnd);
    handle.addEventListener('pointercancel', onDragEnd);
    drag.raf = requestAnimationFrame(autoScroll);
  }
  function onDragMove(e) {
    if (!drag) return;
    drag.y = e.clientY;
    positionDrag();
  }
  function positionDrag() {
    const { row, ph, list, offsetY, y } = drag;
    row.style.top = (y - offsetY) + 'px';
    let before = null;
    for (const o of list.querySelectorAll('.row:not(.dragging)')) {
      const r = o.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = o; break; }
    }
    if (before) { if (ph.nextElementSibling !== before) list.insertBefore(ph, before); }
    else list.appendChild(ph);
  }
  function autoScroll() {
    if (!drag) return;
    const main = $('#main');
    const r = main.getBoundingClientRect();
    const m = 70;
    let dy = 0;
    if (drag.y < r.top + m) dy = -Math.ceil((r.top + m - drag.y) / 5);
    else if (drag.y > r.bottom - m) dy = Math.ceil((drag.y - (r.bottom - m)) / 5);
    if (dy) { main.scrollBy(0, dy); positionDrag(); }
    drag.raf = requestAnimationFrame(autoScroll);
  }
  function onDragEnd() {
    const d = drag;
    if (!d) return;
    drag = null;
    cancelAnimationFrame(d.raf);
    d.handle.removeEventListener('pointermove', onDragMove);
    d.handle.removeEventListener('pointerup', onDragEnd);
    d.handle.removeEventListener('pointercancel', onDragEnd);

    let nextEl = d.ph.nextElementSibling;
    while (nextEl && (nextEl === d.row || !nextEl.classList.contains('row'))) nextEl = nextEl.nextElementSibling;
    const beforeId = nextEl ? nextEl.dataset.id : null;
    d.ph.remove();
    d.row.removeAttribute('style');
    d.row.classList.remove('dragging');

    const old = placedList().map((c) => c.id);
    const ids = old.filter((x) => x !== d.id);
    let idx = beforeId ? ids.indexOf(beforeId) : ids.length;
    if (idx < 0) idx = ids.length;
    ids.splice(idx, 0, d.id);
    if (ids.join() !== old.join()) store.update(orderPaths(ids));
    renderQueued = false;
    render();
  }

  // ================================================================
  //  Modals
  // ================================================================
  let modal = null;

  function openModal({ title, body, footer, cls, refresh, locked }) {
    closeModal(true);
    const box = el('div', { class: 'modal ' + (cls || '') },
      el('div', { class: 'modal-head' },
        el('h3', null, title),
        !locked && el('button', { class: 'icon-btn', title: 'Close', onclick: () => closeModal() }, '✕')),
      el('div', { class: 'modal-body' }, body),
      footer && el('div', { class: 'modal-foot' }, footer));
    const back = el('div', { class: 'backdrop' }, box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) back.dataset.down = '1'; });
    back.addEventListener('click', (e) => { if (!locked && e.target === back && back.dataset.down) closeModal(); delete back.dataset.down; });
    $('#modalRoot').appendChild(back);
    modal = { back, refresh, onClose: null, keydown: null, locked: !!locked };
    return modal;
  }
  function closeModal() {
    if (!modal) return;
    const m = modal;
    modal = null;
    m.back.remove();
    if (m.onClose) m.onClose();
  }

  function typedTitle(c, text) {
    return el('span', { class: `title-typed t-${c.type || 'enemy'}` }, el('span', { class: 'dot' }), `${c.name || '?'} — ${text}`);
  }

  function typePicker(initial, onChange) {
    let cur = initial;
    const wrap = el('div', { class: 'seg' });
    const draw = () => wrap.replaceChildren(...TYPE_KEYS.map((k) =>
      el('button', {
        class: `seg-btn t-${k}${k === cur ? ' on' : ''}`, type: 'button',
        onclick: () => { cur = k; draw(); onChange(k); },
      }, TYPES[k].label)));
    draw();
    return wrap;
  }

  function toggleRow(label, desc, initial, onChange) {
    const input = el('input', { type: 'checkbox', checked: initial, onchange: () => onChange(input.checked) });
    return el('label', { class: 'toggle-row' },
      el('span', { class: 'toggle-text' }, el('span', { class: 'toggle-label' }, label), desc && el('span', { class: 'muted small' }, desc)),
      input, el('span', { class: 'switch' }));
  }

  function field(label, ...content) {
    return el('div', { class: 'field' }, el('div', { class: 'field-label' }, label), content);
  }

  // ---------- number keypad ----------
  function keypad(initial, onChange, onEnter) {
    let val = initial == null ? '' : String(initial);
    let fresh = true;
    const display = el('div', { class: 'kp-display' });
    const upd = () => {
      display.textContent = val === '' ? '–' : val;
      display.classList.toggle('empty', val === '');
      onChange(val);
    };
    const press = (k) => {
      if (k === '⌫') val = val.slice(0, -1);
      else if (k === '±') val = val.startsWith('-') ? val.slice(1) : '-' + val;
      else {
        if (fresh) val = val.startsWith('-') && val.length === 1 ? '-' : '';
        if (val.replace('-', '').length >= 2) return;
        val += k;
      }
      fresh = false;
      upd();
    };
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '±', '0', '⌫'];
    const grid = el('div', { class: 'kp-grid' }, keys.map((k) =>
      el('button', { class: 'kp-key' + (/\d/.test(k) ? '' : ' kp-fn'), type: 'button', onclick: () => press(k) }, k)));
    upd();
    return {
      el: el('div', { class: 'kp' }, display, grid),
      keydown(e) {
        if (/^\d$/.test(e.key)) { press(e.key); e.preventDefault(); }
        else if (e.key === 'Backspace') { press('⌫'); e.preventDefault(); }
        else if (e.key === '-') { press('±'); e.preventDefault(); }
        else if (e.key === 'Enter' && onEnter) { onEnter(); e.preventDefault(); }
      },
    };
  }

  function openKeypad(id) {
    const c = state.combatants[id];
    if (!c) return;
    let val = typeof c.init === 'number' ? String(c.init) : '';
    const nextPending = () => pendingList().filter(isVisible).find((p) => p.id !== id);
    const submit = async (goNext) => {
      const n = parseInt(val, 10);
      const np = goNext ? nextPending() : null;
      closeModal();
      if (isNaN(n)) return;
      const ok = await setInitiative(id, n);
      if (ok && np) openKeypad(np.id);
    };
    const kp = keypad(c.init, (v) => { val = v; }, () => submit(!!nextPending()));
    const np = nextPending();
    const m = openModal({
      title: typedTitle(Object.assign({}, c), 'initiative'),
      body: kp.el,
      cls: 'kp-modal',
      footer: [
        el('button', { class: 'btn', onclick: () => closeModal() }, 'Cancel'),
        typeof c.init === 'number' && el('button', { class: 'btn', onclick: () => { closeModal(); clearInitiative(id); } }, 'Clear'),
        el('button', { class: 'btn primary', onclick: () => submit(false) }, 'Set'),
        np && el('button', { class: 'btn primary', onclick: () => submit(true) }, 'Set & next ▶'),
      ],
    });
    m.keydown = kp.keydown;
  }

  // ---------- add combatant ----------
  function openAdd(prefill = {}) {
    let type = prefill.type || 'enemy';
    let hidden = !!prefill.hidden;
    let saveParty = false;
    let initVal = '';
    const name = el('input', {
      class: 'input', placeholder: 'Name (e.g. Goblin 1)', value: prefill.name || '',
      maxlength: 40, autocomplete: 'off', enterkeyhint: 'done',
    });
    const partyRow = toggleRow('Save to party', 'Remember for future sessions', false, (v) => { saveParty = v; });
    const syncPartyRow = () => { partyRow.style.display = type === 'pc' || type === 'ally' ? '' : 'none'; };
    const typeSel = typePicker(type, (t) => { type = t; syncPartyRow(); });
    syncPartyRow();

    const submit = async (another) => {
      const nm = name.value.trim();
      if (!nm) { name.focus(); name.classList.remove('shake'); void name.offsetWidth; name.classList.add('shake'); return; }
      const n = parseInt(initVal, 10);
      closeModal();
      let partyId = null;
      if (saveParty && (type === 'pc' || type === 'ally')) {
        partyId = uid();
        store.update({ [`party/${partyId}`]: { name: nm, type } });
      }
      await addCombatant({ name: nm, type, init: isNaN(n) ? null : n, hidden, partyId });
      if (another) openAdd({ type, hidden, name: bumpName(nm) });
    };
    const kp = keypad(null, (v) => { initVal = v; }, () => submit(false));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });

    const m = openModal({
      title: 'Add combatant',
      cls: 'wide',
      body: el('div', { class: 'add-grid' },
        el('div', { class: 'add-left' },
          field('Name', name),
          field('Type', typeSel),
          prefs.dm && toggleRow('Hidden from players', 'Only visible on DM screens until revealed', hidden, (v) => { hidden = v; }),
          partyRow),
        el('div', { class: 'add-right' },
          field('Initiative', el('span', { class: 'muted small' }, 'Leave empty to enter later'), kp.el))),
      footer: [
        el('button', { class: 'btn', onclick: () => closeModal() }, 'Cancel'),
        el('button', { class: 'btn', onclick: () => submit(true) }, 'Add & another'),
        el('button', { class: 'btn primary', onclick: () => submit(false) }, 'Add'),
      ],
    });
    m.keydown = kp.keydown;
    if (matchMedia('(pointer: fine)').matches) { name.focus(); name.select(); }
  }

  // ---------- edit combatant ----------
  function openEdit(id) {
    const c = state.combatants[id];
    if (!c) return;
    let type = c.type || 'enemy';
    let hidden = !!c.hidden;
    const name = el('input', { class: 'input', value: c.name || '', maxlength: 40, autocomplete: 'off', enterkeyhint: 'done' });
    const save = () => {
      if (!state.combatants[id]) { closeModal(); return; }
      const nm = name.value.trim();
      const paths = {};
      if (nm && nm !== c.name) paths[`combatants/${id}/name`] = nm;
      if (type !== c.type) paths[`combatants/${id}/type`] = type;
      if (hidden !== !!c.hidden) paths[`combatants/${id}/hidden`] = hidden || null;
      if (Object.keys(paths).length) store.update(paths);
      closeModal();
    };
    const act = (fn) => () => { save(); fn(); };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

    const hasInit = typeof c.init === 'number';
    const canSaveParty = (type === 'pc' || type === 'ally') && !c.partyId;

    openModal({
      title: typedTitle(c, 'edit'),
      body: el('div', null,
        field('Name', name),
        field('Type', typePicker(type, (t) => { type = t; })),
        prefs.dm && toggleRow('Hidden from players', 'Only visible on DM screens', hidden, (v) => { hidden = v; }),
        field('Initiative',
          el('div', { class: 'inline' },
            el('span', { class: 'big-num' }, hasInit ? String(c.init) : 'not set'),
            el('button', { class: 'btn', onclick: act(() => openKeypad(id)) }, hasInit ? 'Change' : 'Set'))),
        el('div', { class: 'action-list' },
          el('button', { class: 'btn', onclick: act(() => openConditions(id)) }, '✚ Conditions'),
          el('button', { class: 'btn', onclick: act(() => duplicateCombatant(id)) }, '⧉ Duplicate'),
          hasInit && el('button', { class: 'btn', onclick: act(() => moveToEnd(id)) }, '⤓ Move to end of round'),
          hasInit && trackingOn() && el('button', { class: 'btn', onclick: act(() => setCurrent(id)) }, '▶ Make it their turn'),
          canSaveParty && el('button', {
            class: 'btn',
            onclick: act(() => {
              const pid = uid();
              store.update({ [`party/${pid}`]: { name: name.value.trim() || c.name, type }, [`combatants/${id}/partyId`]: pid });
              toast('Saved to party');
            }),
          }, '★ Save to party'),
          el('button', { class: 'btn danger', onclick: () => { closeModal(); removeCombatant(id); } }, '🗑 Remove'))),
      footer: [
        el('button', { class: 'btn', onclick: () => closeModal() }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: save }, 'Save'),
      ],
    });
  }

  // ---------- conditions ----------
  function stepper(value, fmt, onChange, min = 0, max = 99) {
    return el('span', { class: 'stepper' },
      el('button', { class: 'step-btn', type: 'button', onclick: () => onChange(Math.max(min, value - 1)) }, '−'),
      el('span', { class: 'step-val' }, fmt(value)),
      el('button', { class: 'step-btn', type: 'button', onclick: () => onChange(Math.min(max, value + 1)) }, '+'));
  }

  function openConditions(id) {
    if (!state.combatants[id]) return;
    let duration = 0;
    const applied = el('div', { class: 'applied' });
    const grid = el('div', { class: 'cond-grid' });
    const durBox = el('div', { class: 'dur-box' });
    const custom = el('input', { class: 'input', placeholder: 'Custom (e.g. Hexed, Blessed)', maxlength: 30, enterkeyhint: 'done' });
    const fmtRounds = (r) => (r > 0 ? `${r} rnd` : '∞');
    const base = `combatants/${id}/conditions`;

    const add = (nm) => {
      nm = nm.trim();
      if (!nm) return;
      store.update({
        [`${base}/${uid()}`]: cleanObj({
          name: nm,
          rounds: trackingOn() && duration > 0 ? duration : null,
          level: nm === 'Exhaustion' ? 1 : null,
        }),
      });
    };
    custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(custom.value); custom.value = ''; } });

    function refresh() {
      const c = state.combatants[id];
      if (!c) { closeModal(); return; }
      const conds = Object.entries(c.conditions || {});
      fill(applied,
        conds.length ? null : el('div', { class: 'muted small' }, 'No conditions.'),
        conds.map(([cid, cd]) => el('div', { class: 'applied-row' },
          el('span', { class: 'chip' + (cd.name === 'Concentrating' ? ' chip-conc' : '') }, cd.name),
          cd.name === 'Exhaustion' && stepper(cd.level || 1, (v) => 'Lvl ' + v,
            (v) => store.update({ [`${base}/${cid}/level`]: v }), 1, 6),
          trackingOn() && stepper(cd.rounds || 0, fmtRounds,
            (v) => store.update({ [`${base}/${cid}/rounds`]: v > 0 ? v : null })),
          el('span', { class: 'spacer' }),
          el('button', { class: 'icon-btn', title: 'Remove', onclick: () => store.update({ [`${base}/${cid}`]: null }) }, '✕'))));
      const have = new Map(conds.map(([cid, cd]) => [cd.name, cid]));
      grid.replaceChildren(...CONDITIONS.map((nm) => el('button', {
        class: 'cond-opt' + (have.has(nm) ? ' on' : ''), type: 'button',
        onclick: () => (have.has(nm) ? store.update({ [`${base}/${have.get(nm)}`]: null }) : add(nm)),
      }, nm)));
      fill(durBox, trackingOn()
        ? el('div', { class: 'inline' }, el('span', { class: 'muted' }, 'Duration for new conditions:'),
          stepper(duration, fmtRounds, (v) => { duration = v; refresh(); }))
        : null);
    }

    const c = state.combatants[id];
    openModal({
      title: typedTitle(c, 'conditions'),
      cls: 'wide',
      refresh,
      body: el('div', null,
        applied, durBox, grid,
        el('div', { class: 'inline' }, custom,
          el('button', { class: 'btn', onclick: () => { add(custom.value); custom.value = ''; } }, 'Add')),
        trackingOn() && el('p', { class: 'muted small' }, 'Durations count down at the end of this creature\'s turn.')),
      footer: [el('button', { class: 'btn primary', onclick: () => closeModal() }, 'Done')],
    });
    refresh();
  }

  // ---------- party ----------
  function openParty() {
    const list = el('div', { class: 'party-list' });
    let type = 'pc';
    const name = el('input', { class: 'input', placeholder: 'Character name', maxlength: 40, autocomplete: 'off', enterkeyhint: 'done' });
    const addBtn = el('button', { class: 'btn primary' }, 'Save');
    const addMember = () => {
      const nm = name.value.trim();
      if (!nm) return;
      store.update({ [`party/${uid()}`]: { name: nm, type } });
      name.value = '';
      name.focus();
    };
    addBtn.addEventListener('click', addMember);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addMember(); } });
    const allBtn = el('button', { class: 'btn primary', onclick: () => { addParty(); closeModal(); } }, 'Add all to encounter');

    function refresh() {
      const present = new Set(Object.values(state.combatants).map((c) => c.partyId).filter(Boolean));
      const entries = Object.entries(state.party).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
      fill(list,
        entries.length ? null : el('p', { class: 'muted' }, 'No saved characters yet. Add your players below.'),
        entries.map(([pid, p]) => el('div', { class: `party-row t-${p.type || 'pc'}` },
          el('span', { class: 'dot' }),
          el('span', { class: 'party-name' }, p.name),
          present.has(pid)
            ? el('span', { class: 'muted small' }, 'in encounter')
            : el('button', { class: 'btn small', onclick: () => addParty(pid) }, 'Add'),
          el('button', {
            class: 'icon-btn', title: 'Delete from party',
            onclick: () => { if (confirm(`Remove ${p.name} from the saved party?`)) store.update({ [`party/${pid}`]: null }); },
          }, '✕'))));
      const missing = partyMissing().length;
      allBtn.disabled = !missing;
      allBtn.textContent = missing ? `Add all to encounter (${missing})` : 'Everyone is in the encounter';
    }

    openModal({
      title: 'Saved party',
      refresh,
      body: el('div', null,
        list,
        el('div', { class: 'field-label' }, 'Add a character'),
        el('div', { class: 'inline' }, name, addBtn),
        el('div', { class: 'seg-mini' }, typePicker('pc', (t) => { type = t; }))),
      footer: [el('button', { class: 'btn', onclick: () => closeModal() }, 'Close'), allBtn],
    });
    refresh();
  }

  // ---------- encounter menu ----------
  function openEncounterMenu() {
    const item = (icon, label, desc, fn, cls) => el('button', {
      class: 'menu-item ' + (cls || ''), onclick: () => { closeModal(); fn(); },
    }, el('span', { class: 'menu-icon' }, icon), el('span', null, el('span', { class: 'menu-label' }, label), desc && el('span', { class: 'muted small' }, desc)));
    const missing = partyMissing().length;
    openModal({
      title: 'Encounter',
      body: el('div', { class: 'menu' },
        missing > 0 && item('★', `Add saved party (${missing})`, 'Adds players who aren\'t in yet', () => addParty()),
        item('⇅', 'Sort by initiative', 'Undo manual drag-and-drop changes', sortByInitiative),
        trackingOn() && !state.turn.active && item('▶', 'Start combat', 'Round 1, first in order', startCombat),
        trackingOn() && state.turn.active && item('■', 'Stop turn tracking', 'Clears round & current turn', endCombat),
        item('✚', 'Clear all conditions', null, clearAllConditions),
        item('⚑', 'Remove all except players', 'Keeps players and saved party members', removeAllExceptPlayers),
        item('↻', 'New encounter', 'Remove non-players and reset players\' initiative', newEncounter),
        item('🗑', 'Remove everyone', null, clearEverything, 'danger-text')),
      footer: [el('button', { class: 'btn', onclick: () => closeModal() }, 'Close')],
    });
  }

  // ---------- role (DM / players) ----------
  function setRole(dm) {
    prefs.dm = dm;
    LS.set('dm', dm);
    if (pipWin && !pipWin.closed) pipWin.document.body.classList.toggle('dm', dm);
    render();
    toast(dm ? 'This device is now the DM screen — hidden enemies are visible' : 'This device is now the players\' screen');
  }

  function roleCard(dm, onPicked) {
    const on = prefs.dm === dm;
    return el('button', {
      class: `role-card ${dm ? 'role-dm' : 'role-players'}${on ? ' on' : ''}`,
      onclick: () => {
        if (prefs.dm !== dm) setRole(dm);
        if (onPicked) onPicked();
      },
    },
    el('span', { class: 'role-icon' }, dm ? '🛡' : '🎲'),
    el('span', { class: 'role-name' }, dm ? 'Dungeon Master' : 'Players'),
    el('span', { class: 'small' }, dm
      ? 'Sees hidden enemies and can hide / reveal them. Don\'t pick this on the players\' tablet.'
      : 'Hidden enemies are never shown on this device.'),
    on && el('span', { class: 'role-current' }, '✓ current'));
  }

  function roleButtons(onPicked) {
    return el('div', { class: 'role-cards' }, roleCard(false, onPicked), roleCard(true, onPicked));
  }

  function openRoleChooser() {
    const m = openModal({
      title: 'Who is using this device?',
      body: el('div', null,
        roleButtons(() => closeModal()),
        el('p', { class: 'muted small' }, 'Saved on this device only. You can change it any time by tapping the badge at the top.')),
    });
    // If closed without choosing on first visit, default to the safe option.
    m.onClose = () => { if (prefs.dm === null) setRole(false); };
  }

  // ---------- table (room) code ----------
  function askRoomCode() {
    return new Promise((resolve) => {
      const input = el('input', {
        class: 'input room-input', placeholder: 'e.g. owlbear-pancakes-77', autocomplete: 'off',
        autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go',
      });
      const err = el('div', { class: 'small danger-text' });
      const go = () => {
        const raw = input.value.trim();
        if (raw.length < 4) { err.textContent = 'Please enter at least 4 characters.'; input.focus(); return; }
        const r = cleanRoom(raw);
        LS.set('room', r);
        closeModal();
        resolve(r);
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      openModal({
        title: '🔑 Enter your table code',
        locked: true,
        body: el('div', null,
          el('p', null, 'Every device that enters the same code shares the same initiative table.'),
          input, err,
          el('p', { class: 'muted small' },
            'First time? Make up a code that\'s hard to guess and enter the same one on the tablet and the PC. ',
            'Not case-sensitive. You\'re only asked once per device — change it later in ⚙ Settings.')),
        footer: [el('button', { class: 'btn primary', onclick: go }, 'Join table')],
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  // ---------- settings ----------
  function openSettings() {
    const roomInput = el('input', { class: 'input', value: prefs.room, autocomplete: 'off' });
    const shareUrl = location.origin + location.pathname + '?room=' + encodeURIComponent(prefs.room);
    const synced = store instanceof FirebaseStore;
    openModal({
      title: 'Settings',
      body: el('div', null,
        el('h4', null, 'Table (shared by all devices)'),
        toggleRow('Turn tracking', 'Highlight current & next, round counter, condition durations', trackingOn(),
          (v) => store.update({ 'settings/turnTracking': v })),
        el('h4', null, 'This device'),
        field('Who uses this device?', roleButtons(() => openSettings())),
        field('Text size',
          el('div', { class: 'inline' },
            ...[0.85, 1, 1.15, 1.3].map((s) => el('button', {
              class: 'btn small' + (Math.abs(prefs.scale - s) < 0.01 ? ' primary' : ''),
              onclick: () => { prefs.scale = s; LS.set('scale', s); applyScale(); openSettings(); },
            }, { 0.85: 'S', 1: 'M', 1.15: 'L', 1.3: 'XL' }[s])))),
        el('h4', null, 'Sync'),
        el('p', { class: 'small' }, synced
          ? '✅ Synced through Firebase. Every device using the same room sees the same table.'
          : '⚠ Local mode: data stays in this browser only. Fill in firebase-config.js to sync devices (see SETUP.md).'),
        field('Table code',
          el('div', { class: 'inline' }, roomInput,
            el('button', {
              class: 'btn', onclick: () => {
                if (roomInput.value.trim().length < 4) { toast('Code must be at least 4 characters'); return; }
                const r = cleanRoom(roomInput.value);
                if (r === prefs.room) return;
                LS.set('room', r);
                location.href = location.pathname;
              },
            }, 'Switch'))),
        el('p', { class: 'muted small' }, 'Shortcut link that joins this table directly (keep it private): ',
          el('code', { class: 'select-all' }, shareUrl)),
        el('h4', null, 'Tips'),
        el('ul', { class: 'small tips' },
          el('li', null, 'Mini view (⧉): in Chrome on a PC it opens a small window that stays on top of other windows.'),
          el('li', null, 'Tablet: Chrome menu ⋮ → “Add to Home screen” to open it like an app.'),
          el('li', null, 'Keyboard (PC): A = add, N / → = next turn, P / ← = previous turn.'))),
      footer: [el('button', { class: 'btn primary', onclick: () => closeModal() }, 'Done')],
    });
  }

  function applyScale() {
    document.documentElement.style.setProperty('--scale', prefs.scale);
    if (pipWin && !pipWin.closed) pipWin.document.documentElement.style.setProperty('--scale', prefs.scale);
  }

  // ================================================================
  //  Mini view (Document Picture-in-Picture = always on top in Chrome)
  // ================================================================
  let pipWin = null;
  const pipSupported = 'documentPictureInPicture' in window;

  function miniContent() {
    const placed = placedList();
    const ti = turnInfo(placed);
    const vis = placed.filter(isVisible);
    const pendingCount = pendingList().filter(isVisible).length;
    const active = combatActive();
    return el('div', { class: 'mini' },
      el('div', { class: 'mini-head' },
        el('span', { class: 'mini-title' }, active ? `Round ${state.turn.round || 1}` : 'Initiative'),
        el('span', { class: 'spacer' }),
        active && el('button', { class: 'mini-btn', title: 'Previous turn', onclick: prevTurn }, '◀'),
        active && el('button', { class: 'mini-btn primary', title: 'Next turn', onclick: nextTurn }, 'Next ▶'),
        trackingOn() && !state.turn.active && vis.length > 0 && el('button', { class: 'mini-btn primary', onclick: startCombat }, 'Start')),
      el('div', { class: 'mini-list' }, vis.map((c) => el('div', {
        class: `mini-row t-${c.type}${ti.current === c.id ? ' current' : ''}${ti.next === c.id ? ' next' : ''}${c.hidden ? ' is-hidden' : ''}`,
        dataset: { id: c.id },
      },
      el('span', { class: 'mini-init' }, String(c.init)),
      el('span', { class: 'mini-name' }, c.name),
      c.hidden && el('button', { class: 'mini-reveal', title: 'Reveal to players', onclick: () => revealCombatant(c.id) }, '🙈 Reveal'),
      el('span', { class: 'mini-conds' }, Object.values(c.conditions).map((cd) =>
        el('span', { class: 'mini-chip' }, condText(cd) + (cd.rounds > 0 ? ` ${cd.rounds}` : ''))))))),
      pendingCount > 0 && el('div', { class: 'mini-note' }, `${pendingCount} waiting for initiative`),
      !vis.length && !pendingCount && el('div', { class: 'mini-note' }, 'No combatants yet'));
  }

  function renderMini() {
    const targets = [];
    if (pipWin && !pipWin.closed) targets.push(pipWin.document.getElementById('mini-root'));
    if (MINI_MODE) targets.push($('#miniRoot'));
    for (const root of targets) {
      if (!root) continue;
      root.replaceChildren(miniContent());
      const cur = root.querySelector('.mini-row.current');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }
  }

  async function openPip() {
    if (!pipSupported) {
      const url = location.pathname + '?mini=1&room=' + encodeURIComponent(prefs.room);
      window.open(url, 'initiative-mini', 'width=320,height=520');
      return;
    }
    if (pipWin && !pipWin.closed) { pipWin.close(); pipWin = null; return; }
    try {
      pipWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 440 });
    } catch (err) {
      toast('Could not open mini view: ' + err.message);
      return;
    }
    const doc = pipWin.document;
    for (const ss of document.styleSheets) {
      try {
        const css = [...ss.cssRules].map((r) => r.cssText).join('\n');
        doc.head.appendChild(Object.assign(doc.createElement('style'), { textContent: css }));
      } catch (e) {
        if (ss.href) doc.head.appendChild(Object.assign(doc.createElement('link'), { rel: 'stylesheet', href: ss.href }));
      }
    }
    doc.title = 'Initiative';
    doc.body.className = 'mini-body' + (prefs.dm ? ' dm' : '');
    doc.documentElement.style.setProperty('--scale', prefs.scale);
    doc.body.appendChild(Object.assign(doc.createElement('div'), { id: 'mini-root' }));
    doc.addEventListener('keydown', globalKeys);
    pipWin.addEventListener('pagehide', () => { pipWin = null; });
    renderMini();
  }

  // ================================================================
  //  Toasts, banner, sync status
  // ================================================================
  function toast(msg, opts = {}) {
    const ms = opts.ms || (opts.action ? 6000 : 3000);
    const t = el('div', { class: 'toast' }, el('span', null, msg),
      opts.action && el('button', { class: 'toast-btn', onclick: () => { opts.onAction(); t.remove(); } }, opts.action));
    $('#toastRoot').appendChild(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  function showBanner(msg, kind, dismissKey) {
    const b = $('#banner');
    b.className = 'banner ' + (kind || '');
    b.replaceChildren(el('span', null, msg),
      el('button', { class: 'icon-btn', title: 'Dismiss', onclick: () => { b.classList.add('hidden'); if (dismissKey) LS.set(dismissKey, true); } }, '✕'));
  }

  function setSync(status) {
    const d = $('#syncDot');
    d.className = 'sync-dot ' + status;
    d.title = {
      online: 'Synced', offline: 'Offline — changes will sync when reconnected',
      connecting: 'Connecting…', local: 'Local mode (not synced)',
    }[status] || status;
  }

  // ================================================================
  //  Keyboard
  // ================================================================
  function globalKeys(e) {
    if (modal) {
      if (e.key === 'Escape') { if (!modal.locked) closeModal(); return; }
      if (modal.keydown && !isTyping(e)) modal.keydown(e);
      return;
    }
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); openAdd(); }
    else if (combatActive() && (k === 'n' || k === 'arrowright')) { e.preventDefault(); nextTurn(); }
    else if (combatActive() && (k === 'p' || k === 'arrowleft')) { e.preventDefault(); prevTurn(); }
  }

  // ================================================================
  //  Boot
  // ================================================================
  async function boot() {
    window.__appStarted = true;
    applyScale();
    if (MINI_MODE) {
      document.body.classList.add('mini-body', 'mini-mode');
      $('#app').classList.add('hidden');
      $('#miniRoot').classList.remove('hidden');
      document.title = 'Initiative (mini)';
    }

    $('#btnAdd').addEventListener('click', () => openAdd());
    $('#btnParty').addEventListener('click', openParty);
    $('#btnEncounter').addEventListener('click', openEncounterMenu);
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnPip').addEventListener('click', openPip);
    $('#btnNext').addEventListener('click', nextTurn);
    $('#btnPrev').addEventListener('click', prevTurn);
    $('#btnStart').addEventListener('click', startCombat);
    $('#roleBadge').addEventListener('click', openRoleChooser);
    document.addEventListener('keydown', globalKeys);
    if (!pipSupported && matchMedia('(pointer: coarse)').matches) $('#btnPip').classList.add('hidden');

    render();
    if (!prefs.room) prefs.room = await askRoomCode();

    const cfg = window.FIREBASE_CONFIG;
    if (cfg && cfg.apiKey && cfg.databaseURL) {
      try {
        await loadScript(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app-compat.js`);
        await loadScript(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-database-compat.js`);
        store = new FirebaseStore(cfg, prefs.room);
      } catch (err) {
        showBanner('Could not reach Firebase (' + err.message + '). Running in local mode on this device only.', 'error');
        store = new LocalStore(prefs.room);
      }
    } else {
      store = new LocalStore(prefs.room);
      if (!LS.get('hideLocalBanner', false)) {
        showBanner('Local mode: not synced between devices yet. Fill in firebase-config.js (see SETUP.md).', 'warn', 'hideLocalBanner');
      }
    }
    store.onStatus(setSync);
    store.subscribe((raw) => { state = normalize(raw); render(); }, (err) => {
      showBanner('Sync error: ' + err.message + ' — check the Firebase database rules (SETUP.md).', 'error');
    });
    if (prefs.dm === null && !MINI_MODE) openRoleChooser();
  }

  boot();
})();
