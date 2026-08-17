/* ===================== Terra Clean — Control tower ===================== */
const $ = (s, r) => (r || document).querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
const pct = v => (v * 100).toFixed(1) + '%';
const pct0 = v => Math.round(v * 100) + '%';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mLabel = m => m ? MON[+m.slice(5, 7) - 1] + " '" + m.slice(2, 4) : '—';
const dLabel = d => d ? (+d.slice(8, 10)) + ' ' + MON[+d.slice(5, 7) - 1] + " '" + d.slice(2, 4) : '—';
const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, k) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + k); return x.toISOString().slice(0, 10); };
const daysTo = d => Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);
const due = n => n.due || (n.f ? n.f + '-28' : '');
const weekStart = d => { const x = new Date((d || today()) + 'T00:00:00'); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); return x.toISOString().slice(0, 10); };
const weekEnd = d => addDays(weekStart(d), 6);
const monthEnd = d => { const [y, m] = (d || today()).slice(0, 7).split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const inThisWeek = d => !!d && d >= weekStart(today()) && d <= weekEnd(today());
const inThisMonth = d => !!d && d.slice(0, 7) === today().slice(0, 7);
const trim = (s, k) => String(s).length > k ? String(s).slice(0, k - 1) + '…' : s;

/* ---------- server-backed state ---------- */
let S = null, REV = 0, VIEW = 'dashboard', PID = null, ME = null;

/* Things that are personal to this browser rather than shared company data —
   which activity you last looked at, whether you collapsed a section, what is
   on your clipboard. These never travel to the server. */
const UI = (() => {
  let o = {};
  try { o = JSON.parse(localStorage.getItem('tc.ui') || '{}'); } catch (e) { }
  return new Proxy(o, {
    set(t, k, v) { t[k] = v; try { localStorage.setItem('tc.ui', JSON.stringify(t)); } catch (e) { } return true; }
  });
})();

/* The server sends back the pruned document; it identifies the viewer with
   viewerId, so re-attach that every time we swap the state in. */
function adoptState(next) { S = next; S.viewer = next.viewerId; }

async function api(method, url, body) {
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await r.json(); } catch (e) { }
  if (!r.ok) { const err = new Error((data && data.error) || r.statusText); err.status = r.status; err.data = data; throw err; }
  return data;
}

/* Writes are batched: keep typing, and one request goes out when you pause.
   If somebody else saved first the server hands back the current picture and
   we redraw rather than overwrite their work. */
let syncTimer = null, syncing = false, dirty = false;
function save() {
  _tpl = null;                      /* names may have changed; rebuild the path labels */
  dirty = true; setSyncState('pending');
  clearTimeout(syncTimer); syncTimer = setTimeout(flush, 600);
}
/* Pull the document again — used after the server changes something on its own
   (setting a password, restoring a backup, cleaning up numbering). */
async function reloadState() {
  const out = await api('GET', '/api/state');
  REV = out.rev; adoptState(out.state); render();
}
async function flush() {
  if (syncing || !dirty) return;
  syncing = true; dirty = false; setSyncState('saving');
  try {
    const out = await api('PUT', '/api/state', { rev: REV, state: S });
    /* Keep our own objects. Replacing S here would orphan every reference an
       open panel is holding, and the next edit in it would vanish. The server
       has just merged exactly what we sent, so the two already agree. */
    REV = out.rev; setSyncState('saved');
  } catch (e) {
    if (e.status === 409 && e.data) {
      REV = e.data.rev; adoptState(e.data.state); setSyncState('reloaded');
      render(); toast('Someone else saved first — the page has been refreshed');
    } else if (e.status === 401) {
      setSyncState('signed-out'); showLogin('Your session ended. Sign in again.');
    } else { setSyncState('error'); toast('Could not save: ' + e.message); dirty = true; }
  } finally {
    syncing = false;
    if (dirty) setTimeout(flush, 400);
  }
}
window.addEventListener('beforeunload', e => { if (dirty || syncing) { e.preventDefault(); e.returnValue = ''; } });

function setSyncState(s) {
  const n = document.getElementById('syncState');
  if (!n) return;
  n.className = 'sync ' + s;
  n.textContent = { pending: 'Saving…', saving: 'Saving…', saved: 'Saved', reloaded: 'Refreshed', error: 'Not saved', 'signed-out': 'Signed out' }[s] || '';
}

/* ---------- creating things ---------- */
function newProject(o) {
  return Object.assign({
    id: uid(), name: 'Untitled project', site: '', state: '', solar: 0, wind: 0, bess: 0,
    cod: '', head: '', setup: true, snaps: [], chg: [],
    packages: packagesFromTemplate(S.standardTemplate || [])
  }, o);
}

/* ---------- model ---------- */
const person = id => S.org.find(p => p.id === id) || null;
const pname = id => { const p = person(id); return p ? p.name : '—'; };
const isCEO = () => !!(S && S.isAdmin);
const me = () => person(S.viewer) || ME || { name: '', designation: '', dept: '' };
const proj = id => S.projects.find(p => p.id === id) || null;

function wOf(n) { return (n.children && n.children.length) ? n.children.reduce((a, c) => a + wOf(c), 0) : (n.w || 0); }
function progOf(n) {
  if (n.children && n.children.length) {
    let w = 0, s = 0; n.children.forEach(c => { const cw = wOf(c); w += cw; s += cw * progOf(c); });
    return w ? s / w : 0;
  }
  return n.prog || 0;
}
function projProg(p) { let w = 0, s = 0; p.packages.forEach(k => { w += k.pw || 0; s += (k.pw || 0) * progOf(k); }); return w ? s / w : 0; }
function walkLeaves(p, fn) {
  p.packages.forEach(pk => (function rec(n, eff) {
    if (!n.children || !n.children.length) return fn(n, eff, pk);
    const tot = wOf(n) || 1;
    n.children.forEach(c => rec(c, eff * (wOf(c) / tot)));
  })(pk, pk.pw || 0));
}
function walkAll(p, fn) { p.packages.forEach(pk => (function rec(n, d) { fn(n, d, pk); (n.children || []).forEach(c => rec(c, d + 1)); })(pk, 0)); }
function indexProject(p) {
  const m = {};
  p.packages.forEach(pk => (function rec(n, parent, depth) { m[n.id] = { n, parent, depth }; (n.children || []).forEach(c => rec(c, n, depth + 1)); })(pk, null, 0));
  return m;
}
function codePath(p, id) { const m = indexProject(p); let c = m[id]; const o = []; while (c) { o.unshift(c.n.code || ''); c = c.parent ? m[c.parent.id] : null; } return o.join('/'); }
function findByPath(p, path) { let list = p.packages, node = null; for (const c of String(path).split('/')) { node = (list || []).find(n => (n.code || '') === c); if (!node) return null; list = node.children; } return node; }
let _tpl = null, _tplKey = '';
function templateNodes() {
  const p = (isCEO() ? S.projects[0] : (visibleProjects()[0] || S.projects[0])); if (!p) return [];
  const key = p.id + ':' + p.packages.length + ':' + S.viewer;
  if (_tpl && _tplKey === key) return _tpl;
  const out = [], sc = scopeOf(p);
  p.packages.forEach(pk => (function rec(n, d, path) {
    const cp = path ? path + '/' + n.code : (n.code || '');
    if (!sc || sc.own.has(n.id)) out.push({ path: cp, name: n.name, depth: d });
    (n.children || []).forEach(c => rec(c, d + 1, cp));
  })(pk, 0, ''));
  _tpl = out; _tplKey = key; return out;
}
function labelForPath(path) { const t = templateNodes().find(x => x.path === path); return t ? t.name : path; }
/* the first two packages the CEO watches, plus the three heaviest */
/* a path is a chain of codes; show it the way a reader would say it: "B 2.2" */
function refLabel(path) {
  const parts = String(path).split('/');
  return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1] : parts[0];
}
function quickPaths() {
  const p = S.projects[0]; if (!p) return [];
  return p.packages.slice(0, 2).map(k => k.code)
    .concat(p.packages.slice(2).sort((a, b) => (b.pw || 0) - (a.pw || 0)).slice(0, 3).map(k => k.code));
}
/* Numbering: packages are letters (A, B, C…); everything under them is decimal
   (1, then 1.1, then 1.1.1). No roman numerals, no lowercase letters. */
function letterCode(i) {
  let s = ''; i = i + 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function pathsOf(p) {
  const m = {};
  p.packages.forEach(pk => (function rec(n, prefix) {
    const cp = prefix ? prefix + '/' + (n.code || '') : (n.code || '');
    m[n.id] = cp; (n.children || []).forEach(c => rec(c, cp));
  })(pk, ''));
  return m;
}
function applyCodes(p) {
  p.packages.forEach((pk, i) => {
    pk.code = letterCode(i);
    (function rec(list, prefix) {
      (list || []).forEach((n, j) => { n.code = prefix ? prefix + '.' + (j + 1) : String(j + 1); rec(n.children, n.code); });
    })(pk.children, '');
  });
}
function renumberProject(p) {
  const before = pathsOf(p);
  applyCodes(p);
  const after = pathsOf(p), map = {};
  Object.keys(before).forEach(id => { if (after[id]) map[before[id]] = after[id]; });
  /* carry stored references across so changes, CEO items and chosen columns keep pointing at the same line */
  (p.chg || []).forEach(c => { if (c.path && map[c.path]) c.path = map[c.path]; });
  (S.asks || []).forEach(a => { if (a.projectId === p.id && a.path && map[a.path]) a.path = map[a.path]; });
  _tpl = null;
  if (S.projects[0] && p.id === S.projects[0].id) {
    S.watch = (S.watch || []).map(x => map[x] || x).filter(x => findByPath(p, x));
    if (!S.watch.length) S.watch = p.packages.slice(0, 2).map(k => k.code);
    UI.across = map[UI.across] || UI.across;
    if (!findByPath(p, UI.across)) UI.across = p.packages[0] ? p.packages[0].code : 'A';
  }
  return map;
}
function renumberAll() { S.projects.forEach(renumberProject); }
/* whoever owns the project may change anything inside it */
function canEdit(p) { return isCEO() || (!!p && p.head === S.viewer); }
function statusOf(n) {
  if (n.closed) return 'Closed';
  if (n.log && n.log.length) return n.log[0].status;
  const pr = progOf(n);
  return pr >= 1 ? 'Executed' : (pr > 0 ? 'In progress' : 'Not started');
}
function tagClass(st, late) {
  if (st === 'Closed') return 'done';
  if (late || st === 'Delayed') return 'risk';
  if (st === 'On hold') return 'watch';
  if (st === 'Not started') return 'idle';
  return 'ok';
}
function isLate(n) { const d = due(n); return !n.closed && !!d && d < today() && progOf(n) < 1; }
function countLate(p) { let c = 0; walkLeaves(p, n => { if (isLate(n)) c++; }); return c; }
function countOpen(p) { let c = 0; walkLeaves(p, n => { if (!n.closed && progOf(n) < 1) c++; }); return c; }
function hasSchedule(p) { let y = false; walkLeaves(p, n => { if (due(n)) y = true; }); return y; }
function chgFor(p, path) { return (p.chg || []).filter(x => x.path === path); }
function asksFor(pid, path) { return S.asks.filter(a => a.status !== 'done' && a.projectId === pid && (path ? a.path === path : true)); }

/* ---------- curves ---------- */
const monthRange = (a, b) => { const o = []; let [y, m] = a.split('-').map(Number); const [ey, em] = b.split('-').map(Number); while (y < ey || (y === ey && m <= em)) { o.push(y + '-' + String(m).padStart(2, '0')); if (++m === 13) { m = 1; y++; } } return o; };
const addMonths = (m, k) => { let [y, mm] = m.split('-').map(Number); mm += k; y += Math.floor((mm - 1) / 12); mm = ((mm - 1) % 12 + 12) % 12 + 1; return y + '-' + String(mm).padStart(2, '0'); };
function curveOf(p) {
  if (p.baseline && p.baseline.months) {
    const months = p.baseline.months.slice(), plan = p.baseline.plan.slice(), actual = p.baseline.actual.slice();
    (p.snaps || []).forEach(s => { const i = months.indexOf(s.m); if (i >= 0) actual[i] = s.v; });
    const ci = months.indexOf(thisMonth()); if (ci >= 0 && actual[ci] == null) actual[ci] = projProg(p);
    return { months, plan, actual };
  }
  let lo = null, hi = null;
  walkLeaves(p, n => { const d = due(n); if (!d) return; const m = d.slice(0, 7); if (!lo || m < lo) lo = m; if (!hi || m > hi) hi = m; });
  const sched = !!lo;
  if (!lo) { lo = thisMonth(); hi = addMonths(lo, 11); }
  if (!hi || hi < lo) hi = addMonths(lo, 11);
  const months = monthRange(lo, hi), inc = months.map(() => 0);
  if (sched) walkLeaves(p, (n, eff) => { const d = due(n); if (!d) return; const i = months.indexOf(d.slice(0, 7)); if (i >= 0) inc[i] += eff; });
  let run = 0; const plan = inc.map(v => (run += v));
  const actual = months.map(m => { const s = (p.snaps || []).find(x => x.m === m); return s ? s.v : null; });
  const ci = months.indexOf(thisMonth()); if (ci >= 0) actual[ci] = projProg(p);
  for (let i = 1; i < months.length; i++) if (months[i] < thisMonth() && actual[i] == null) actual[i] = actual[i - 1] || 0;
  return { months, plan, actual };
}
function plannedNow(p) {
  const c = curveOf(p), i = c.months.indexOf(thisMonth());
  if (i < 0) return c.months[0] > thisMonth() ? 0 : (c.plan[c.plan.length - 1] || 0);
  for (let k = i; k >= 0; k--) if (c.plan[k] != null) return c.plan[k];
  return 0;
}
function health(p) {
  if (!hasSchedule(p)) return { none: true, v: 0, cls: 'idle', label: 'Not scheduled' };
  const v = projProg(p) - plannedNow(p);
  return { v, cls: v >= -0.02 ? 'ok' : v >= -0.10 ? 'watch' : 'risk', label: v >= -0.02 ? 'On track' : v >= -0.10 ? 'Watch' : 'Behind' };
}
function snapshot(p) { const m = thisMonth(), v = projProg(p); p.snaps = p.snaps || []; const e = p.snaps.find(s => s.m === m); if (e) e.v = v; else p.snaps.push({ m, v }); }

/* ---------- chrome ---------- */
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 1900); }
function go(v, id) { VIEW = v; if (id) PID = id; closeDrawer(); render(); window.scrollTo(0, 0); }
$('#nav').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.v); };
$('#signOut').onclick = () => signOut();
function closeDrawer() { $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); }
$('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
function openDrawerEl(html) { const d = $('#drawer'); d.innerHTML = html; d.classList.add('on'); $('#scrim').classList.add('on'); return d; }
function dHead(kicker, title) {
  return `<div class="dhead"><div class="crumb">${esc(kicker)}</div>
    <div style="display:flex;gap:12px;align-items:flex-start"><h2 style="font-size:21px;flex:1">${esc(title)}</h2>
    <button class="btn ghost sm" id="dclose">Close</button></div></div>`;
}
function wireClose(d) { $('#dclose', d).onclick = closeDrawer; }

const ADMIN_ONLY = ['offtake', 'enablers', 'people', 'org'];
function renderRail() {
  const p = person(S.viewer) || {};
  $('#whoName').textContent = p.name || '';
  $('#whoRole').textContent = [p.designation, p.dept].filter(Boolean).join(' · ') || (p.admin ? 'Full access' : '');
  $('#whoMail').textContent = p.email || '';
  $('#viewerNote').textContent = isCEO() ? 'CEO view — every project, deal and enabler.'
    : (S.projects.some(x => x.head === S.viewer) ? 'You lead one or more projects and see those in full. Other projects are not shown.'
      : 'You see the work assigned to you. Nothing else is shown.');
  const openAsks = S.asks.filter(a => a.status !== 'done').length;
  document.querySelectorAll('#nav button').forEach(b => {
    const hidden = !isCEO() && ADMIN_ONLY.indexOf(b.dataset.v) >= 0;
    b.classList.toggle('hide', hidden);
    b.classList.toggle('on', b.dataset.v === (VIEW === 'project' ? 'projects' : VIEW));
    const old = b.querySelector('.pill'); if (old) old.remove();
    if (isCEO() && b.dataset.v === 'dashboard' && openAsks) b.appendChild(el('span', 'pill', String(openAsks)));
  });
  document.querySelectorAll('.navgrp').forEach(g => {
    const any = Array.from(g.querySelectorAll('button')).some(b => !b.classList.contains('hide'));
    g.classList.toggle('hide', !any);
  });
}
function clipChip() {
  if (!UI.clip) return null;
  const c = el('span', 'clip');
  c.innerHTML = `Copied: <b>${esc(trim(UI.clip.node.name, 24))}</b>`;
  const x = el('button', 'btn ghost sm', 'Clear'); x.onclick = () => { UI.clip = null; save(); render(); };
  c.appendChild(x); return c;
}

/* ===================== DASHBOARD ===================== */
/* ===================== TASKS (standalone, inline-edited) ===================== */
function newTask(o) { return Object.assign({ id: uid(), title: '', owner: '', projectId: '', due: today(), urgency: 'Medium', done: false, by: pname(S.viewer), created: today() }, o); }
function dueItems(ownerId) {
  const out = [];
  S.tasks.forEach(t => {
    if (ownerId && t.owner !== ownerId) return;
    if (t.done && !t.doneOn) return;
    out.push({ kind: 'task', t, d: t.due || '', done: !!t.done, doneOn: t.doneOn });
  });
  S.projects.forEach(p => {
    if (ownerId && p.head !== ownerId) return;   /* activities belong to whoever owns the project */
    walkLeaves(p, n => {
      const d = due(n); if (!d) return;
      const shut = n.closed || progOf(n) >= 1;
      if (shut && !n.closedOn) return;
      out.push({ kind: 'wbs', p, n, d, done: shut, doneOn: n.closedOn });
    });
  });
  return out.sort((a, b) => (a.d || '9999').localeCompare(b.d || '9999'));
}
/* A completed item is not removed straight away — it stays struck through for the
   rest of its period: the rest of the day for a daily item, the rest of the week
   for a weekly one. That way the CEO can see what was cleared, not just what is left. */
function bucket(items, which) {
  const t = today(), wk = addDays(t, 7);
  if (which === 'daily') return items.filter(i => i.d && i.d <= t && (!i.done || i.doneOn === t));
  if (which === 'weekly') return items.filter(i => i.d > t && i.d <= wk && (!i.done || inThisWeek(i.doneOn)));
  return items.filter(i => !i.done && (!i.d || i.d > wk));
}
function selOwner(val, onChange, disabled) {
  const s = el('select'); s.className = 'inline';
  if (!isCEO() && val && val !== S.viewer) disabled = true;
  s.innerHTML = '<option value="">Unassigned</option>' + S.org.map(o => `<option value="${o.id}" ${val === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  s.disabled = !!disabled; s.onchange = () => onChange(s.value); return s;
}
function selUrg(val, onChange, disabled) {
  const s = el('select'); s.className = 'inline urg-' + String(val || 'Medium').toLowerCase();
  s.innerHTML = ['High', 'Medium', 'Low'].map(u => `<option ${val === u ? 'selected' : ''}>${u}</option>`).join('');
  s.disabled = !!disabled; s.onchange = () => onChange(s.value); return s;
}
function selProject(val, onChange, disabled) {
  const s = el('select'); s.className = 'inline';
  const list = visibleProjects();
  if (val && !list.some(p => p.id === val)) { const x = proj(val); if (x) list.push(x); }
  s.innerHTML = '<option value="">No project</option>' + list.map(p => `<option value="${p.id}" ${val === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  s.disabled = !!disabled; s.onchange = () => onChange(s.value); return s;
}
function dateIn(val, onChange, disabled) {
  const i = el('input'); i.type = 'date'; i.className = 'inline'; i.value = val || ''; i.disabled = !!disabled;
  i.onchange = () => onChange(i.value); return i;
}
function mailBtn(ownerId, subject, body) {
  const p = person(ownerId);
  const b = el('button', 'btn ghost sm mailbtn', '✉');
  b.title = p && p.email ? 'Email ' + p.name : 'No email address on file — add one in Settings';
  b.onclick = e => { e.stopPropagation(); notify(ownerId, subject, body); };
  return b;
}
/* Three ways a message can reach somebody, set once under Settings:

   'self'   — open a draft in your own mail app. It then genuinely comes from
              your mailbox, which is the only route a corporate filter such as
              @indianoil.in will always accept. Nothing to configure.
   'server' — the server sends it, if a provider is set up.
   'auto'   — try the server, and fall back to a draft if it will not go.        */
function mailMode() { return S.mailSend || 'auto'; }

function notify(ownerId, subject, body) {
  const p = person(ownerId);
  if (!p) { toast('Assign an owner first'); return; }
  if (!p.email) { toast('No email address for ' + p.name + ' — add one under Organisation'); return; }

  if (mailMode() === 'self') {
    api('POST', '/api/notify', { personId: ownerId, subject, body, compose: true })
      .then(openDraft).catch(e => toast('Could not prepare it: ' + e.message));
    return;
  }
  api('POST', '/api/notify', { personId: ownerId, subject, body })
    .then(r => {
      if (r.sent) { toast('Emailed ' + p.name + (r.invite ? ' — with their sign-in code' : '')); return; }
      if (mailMode() === 'auto') {
        /* the server could not send it — prepare a draft instead so it still goes */
        api('POST', '/api/notify', { personId: ownerId, subject, body, compose: true })
          .then(openDraft).catch(() => mailFailed(p, r));
        return;
      }
      mailFailed(p, r);
    })
    .catch(e => toast('Could not send: ' + e.message));
}

/* Opens Outlook, or whatever handles mail on this machine, with everything
   already written. One click to send. */
function openDraft(r) {
  const link = 'mailto:' + encodeURIComponent(r.to) +
    '?subject=' + encodeURIComponent(r.subject) +
    '&body=' + encodeURIComponent(r.text);
  if (link.length > 1900) { showDraft(r, 'That message is long, so your mail app may cut it short. Copy it instead.'); return; }
  window.location.href = link;
  toast('Opening a draft in your mail app');
  setTimeout(() => showDraft(r, null, true), 1200);
}

function showDraft(r, warning, quiet) {
  const d = openDrawerEl(dHead('Email', 'Message for ' + esc(r.to)) + '<div class="dbody" id="db"></div>');
  wireClose(d);
  const b = document.getElementById('db');
  b.innerHTML = `<p class="sub" style="margin-top:0">${quiet
    ? 'A draft should have opened in your mail app. If it did not, copy it from here.'
    : esc(warning || 'Copy this and send it however suits — Outlook, Teams, WhatsApp.')}</p>
    ${r.invite ? `<div class="dsec"><h4>Their sign-in code</h4><div class="invitecode">${esc(r.invite)}</div></div>` : ''}
    <div class="draftbox"><b>${esc(r.subject)}</b><pre>${esc(r.text)}</pre></div>`;
  const row = el('div', 'row');
  const c1 = el('button', 'btn pri', 'Copy the message');
  c1.onclick = () => navigator.clipboard.writeText(r.subject + '\n\n' + r.text)
    .then(() => toast('Copied'), () => toast('Could not copy'));
  const c2 = el('button', 'btn', 'Copy their address');
  c2.onclick = () => navigator.clipboard.writeText(r.to).then(() => toast('Copied'), () => toast('Could not copy'));
  row.append(c1, c2);
  b.appendChild(row);
}

function mailFailed(p, r) {
  const d = openDrawerEl(dHead('Email', 'Could not reach ' + p.name) + '<div class="dbody" id="db"></div>');
  wireClose(d);
  const b = document.getElementById('db');
  b.innerHTML = `<p class="sub" style="margin-top:0">The message was written to the server log rather than sent.
    ${r.hint ? '<br><br><b>' + esc(r.hint) + '</b>' : ''}</p>`;
  if (r.invite) {
    b.insertAdjacentHTML('beforeend',
      `<div class="dsec"><h4>Their sign-in code — pass it on yourself</h4>
       <div class="invitecode">${esc(r.invite)}</div>
       <div class="sub">Login: <b>${esc(p.email)}</b>. They enter this once and choose their own password.</div></div>`);
    const copy = el('button', 'btn pri', 'Copy a message to send');
    copy.onclick = () => {
      const t = 'Hello ' + p.name + ',\n\nYou have access to the Terra Clean control tower.\n\nLink: ' + location.origin +
        '\nYour login: ' + p.email + '\nInvite code: ' + r.invite +
        '\n\nOpen the link, type your email, then enter the code and choose your own password.';
      navigator.clipboard.writeText(t).then(() => toast('Copied'), () => toast('Could not copy'));
    };
    b.appendChild(copy);
  }
  b.insertAdjacentHTML('beforeend',
    '<div class="dsec"><h4>Fixing it</h4><div class="sub">Settings → Email lets you switch to sending from your own mailbox instead, which corporate filters always accept.</div></div>');
}

function assignedMail(ownerId, what, whenBy, context) {
  return { s: 'Terra Clean — assigned to you: ' + what, b: `Hello ${(person(ownerId) || {}).name || ''},\n\nYou have been assigned the following on the Terra Clean control tower:\n\n  Item:     ${what}\n  ${context ? 'Context:  ' + context + '\n  ' : ''}Due:      ${whenBy ? dLabel(whenBy) : 'no date set'}\n\nPlease open the control tower and record your first update.\n\n— sent from the Terra Clean control tower` };
}

/* one table: standalone tasks and project activities, edited in place */
function taskTable(items, opts) {
  opts = opts || {};
  const wrap = el('div');
  const t = el('table', 'tbl tasktbl');
  t.innerHTML = `<thead><tr><th style="width:34px"></th><th>Task</th><th style="width:150px">Owner</th><th style="width:150px">Project</th><th style="width:130px">Due</th><th style="width:104px">Urgency</th><th style="width:78px"></th></tr></thead>`;
  const tb = el('tbody');

  items.forEach(i => {
    const tr = el('tr');
    if (i.kind === 'task') {
      const can = isCEO() || i.t.owner === S.viewer || i.t.by === pname(S.viewer) ||
        (i.t.projectId && (proj(i.t.projectId) || {}).head === S.viewer);
      if (i.done) tr.className = 'done';
      const cb = el('input'); cb.type = 'checkbox'; cb.disabled = !can; cb.checked = !!i.done;
      cb.title = i.done ? 'Reopen' : 'Mark done';
      cb.onchange = () => {
        if (cb.checked) { i.t.done = true; i.t.doneOn = today(); toast('Done — stays here until the period ends'); }
        else { i.t.done = false; i.t.doneOn = null; toast('Reopened'); }
        save(); render();
      };
      tr.appendChild(el('td')).appendChild(cb);
      const ti = el('input'); ti.type = 'text'; ti.className = 'inline title'; ti.value = i.t.title; ti.disabled = !can;
      ti.onchange = () => { i.t.title = ti.value.trim(); save(); };
      tr.appendChild(el('td')).appendChild(ti);
      tr.appendChild(el('td')).appendChild(selOwner(i.t.owner, v => {
        i.t.owner = v; save();
        if (v && S.notifyOnAssign) { const m = assignedMail(v, i.t.title, i.t.due, ''); notify(v, m.s, m.b); }
        render();
      }, !can));
      tr.appendChild(el('td')).appendChild(selProject(i.t.projectId, v => { i.t.projectId = v; save(); }, !can));
      const dc = el('td'); dc.appendChild(dateIn(i.t.due, v => { i.t.due = v; save(); render(); }, !can));
      if (i.d && i.d < today()) dc.appendChild(el('span', 'sub late', ' ' + (-daysTo(i.d)) + 'd late'));
      tr.appendChild(dc);
      tr.appendChild(el('td')).appendChild(selUrg(i.t.urgency, v => { i.t.urgency = v; save(); render(); }, !can));
      const ac = el('td', 'r');
      if (i.t.owner) ac.appendChild(mailBtn(i.t.owner, ...(() => { const m = assignedMail(i.t.owner, i.t.title, i.t.due, ''); return [m.s, m.b]; })()));
      if (can) { const x = el('button', 'btn ghost sm', '×'); x.title = 'Delete'; x.onclick = () => { S.tasks = S.tasks.filter(z => z.id !== i.t.id); save(); render(); }; ac.appendChild(x); }
      tr.appendChild(ac);
    } else {
      const can = canEdit(i.p, i.n);
      if (i.done) tr.className = 'done';
      const cb = el('input'); cb.type = 'checkbox'; cb.disabled = !can; cb.checked = !!i.done;
      cb.title = i.done ? 'Reopen this activity' : 'Close this activity';
      cb.onchange = () => {
        i.n.log = i.n.log || [];
        if (cb.checked) {
          i.n.progBefore = progOf(i.n); i.n.closed = true; i.n.prog = 1; i.n.closedOn = today();
          i.n.log.unshift({ date: today(), status: 'Closed', note: 'Closed from the dashboard', by: pname(S.viewer) });
          toast('Closed — stays here until the period ends');
        } else {
          i.n.closed = false; i.n.prog = i.n.progBefore != null ? i.n.progBefore : 0; i.n.closedOn = null;
          i.n.log.unshift({ date: today(), status: 'Reopened', note: '', by: pname(S.viewer) });
          toast('Reopened');
        }
        snapshot(i.p); save(); render();
      };
      tr.appendChild(el('td')).appendChild(cb);
      const tc = el('td');
      if (can) {
        /* rename the activity straight from the tracker */
        const ti = el('input'); ti.type = 'text'; ti.className = 'inline title'; ti.value = i.n.name;
        ti.onchange = () => { i.n.name = ti.value.trim() || i.n.name; save(); };
        tc.appendChild(ti);
      } else {
        tc.appendChild(el('div', 'inline title', esc(trim(i.n.name, 54))));
      }
      const open = el('button', 'linkish sub', 'Open in ' + esc(i.p.name));
      open.style.fontSize = '11.5px';
      open.onclick = () => { PID = i.p.id; VIEW = 'project'; render(); openTask(i.p, i.n); };
      const meta = el('div', 'sub');
      meta.textContent = 'Project activity · ' + statusOf(i.n) + ' · ' + pct0(progOf(i.n)) + ' · ';
      meta.appendChild(open);
      tc.appendChild(meta);
      tr.appendChild(tc);
      const oc = el('td', 'sub');
      oc.textContent = pname(i.p.head) || '—';
      oc.title = 'Whoever owns the project is answerable for everything in it';
      tr.appendChild(oc);
      const pc = el('td'); pc.appendChild(el('span', 'tag idle', esc(i.p.name))); tr.appendChild(pc);
      const dc = el('td'); dc.appendChild(dateIn(i.n.due || (i.n.f ? i.n.f + '-28' : ''), v => { i.n.due = v; save(); render(); }, !can));
      if (i.d && i.d < today()) dc.appendChild(el('span', 'sub late', ' ' + (-daysTo(i.d)) + 'd late'));
      tr.appendChild(dc);
      tr.appendChild(el('td')).appendChild(selUrg(i.n.urg || 'Medium', v => { i.n.urg = v; save(); render(); }, !can));
      const ac = el('td', 'r');
      if (i.p.head) ac.appendChild(mailBtn(i.p.head, ...(() => { const m = assignedMail(i.p.head, i.n.name, due(i.n), i.p.name); return [m.s, m.b]; })()));
      if (can) {
        const clear = el('button', 'btn ghost sm', '⌫');
        clear.title = 'Take it off the tracker by clearing its target date. The activity stays in the project.';
        clear.onclick = () => { i.n.due = ''; delete i.n.f; save(); render(); toast('Taken off the tracker'); };
        ac.appendChild(clear);
        const x = el('button', 'btn ghost sm', '×');
        x.title = 'Delete this activity from the project altogether';
        x.onclick = () => { deleteNode(i.p, i.n); };
        ac.appendChild(x);
      }
      tr.appendChild(ac);
    }
    tb.appendChild(tr);
  });

  if (!items.length) {
    const tr = el('tr'); const td = el('td'); td.colSpan = 7;
    td.appendChild(el('div', 'sub', opts.emptyText || 'Nothing here.'));
    tr.appendChild(td); tb.appendChild(tr);
  }

  /* inline add row — no popup */
  if (opts.add !== false) {
    const tr = el('tr', 'addrow');
    tr.appendChild(el('td', '', '<span class="plus">+</span>'));
    const ti = el('input'); ti.type = 'text'; ti.className = 'inline title'; ti.placeholder = opts.placeholder || 'Add a task and press Enter';
    tr.appendChild(el('td')).appendChild(ti);
    const draft = newTask({ due: opts.defaultDue || today(), owner: isCEO() ? '' : S.viewer });
    tr.appendChild(el('td')).appendChild(selOwner(draft.owner, v => draft.owner = v));
    tr.appendChild(el('td')).appendChild(selProject(draft.projectId, v => draft.projectId = v));
    tr.appendChild(el('td')).appendChild(dateIn(draft.due, v => draft.due = v));
    tr.appendChild(el('td')).appendChild(selUrg(draft.urgency, v => draft.urgency = v));
    const ac = el('td', 'r');
    const addb = el('button', 'btn sm pri', 'Add');
    const commit = () => {
      const title = ti.value.trim();
      if (!title) { ti.focus(); return; }
      const t2 = newTask(Object.assign({}, draft, { title }));
      S.tasks.unshift(t2); save();
      if (t2.owner && S.notifyOnAssign) { const m = assignedMail(t2.owner, t2.title, t2.due, ''); notify(t2.owner, m.s, m.b); }
      render(); toast('Task added');
    };
    addb.onclick = commit;
    ti.onkeydown = e => { if (e.key === 'Enter') commit(); };
    ac.appendChild(addb); tr.appendChild(ac);
    tb.appendChild(tr);
  }
  t.appendChild(tb); wrap.appendChild(t);
  return wrap;
}

/* ===================== DASHBOARD ===================== */
function viewDashboard() {
  if (!isCEO()) return viewMyDesk();
  $('#crumb').textContent = 'Deliver'; $('#title').textContent = 'Dashboard';
  const ta = $('#topActions'); ta.innerHTML = '';
  const v = $('#view'); v.innerHTML = '';

  const ps = S.projects;
  const solar = ps.reduce((a, p) => a + (+p.solar || 0), 0), wind = ps.reduce((a, p) => a + (+p.wind || 0), 0), bess = ps.reduce((a, p) => a + (+p.bess || 0), 0);
  let w = 0, s = 0, pw = 0, pv = 0;
  ps.forEach(p => { const cap = (+p.solar || 0) + (+p.wind || 0) || 1; w += cap; s += cap * projProg(p); if (hasSchedule(p)) { pw += cap; pv += cap * plannedNow(p); } });
  const port = w ? s / w : 0, portPlan = pw ? pv / pw : 0;
  const lateAll = ps.reduce((a, p) => a + countLate(p), 0) + S.tasks.filter(t => !t.done && t.due && t.due < today()).length;
  const talks = S.deals.reduce((a, d) => a + (+d.capTalks || 0), 0), fin = S.deals.reduce((a, d) => a + (+d.capFinal || 0), 0);

  const m = el('div', 'metrics'); m.style.marginBottom = '30px';
  m.innerHTML = `
    <div class="metric"><div class="eyebrow">Portfolio capacity</div><div class="v">${(solar + wind).toLocaleString()}<small>MW</small></div>
      <div class="splitline"><div><b><i class="sw" style="background:var(--saffron)"></i>${solar}</b><span>Solar MW</span></div>
      <div><b><i class="sw" style="background:var(--moonstone)"></i>${wind}</b><span>Wind MW</span></div>
      <div><b><i class="sw" style="background:var(--violet)"></i>${bess}</b><span>BESS MWh</span></div></div></div>
    <div class="metric"><div class="eyebrow">Weighted progress</div><div class="v">${pct(port)}</div><div class="l">Plan today ${pct(portPlan)}</div>
      <div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, port * 100)}%"></i><span class="plan" style="left:${Math.min(100, portPlan * 100)}%"></span></div></div>
    <div class="metric"><div class="eyebrow">Waiting on you</div><div class="v">${S.asks.filter(a => a.status !== 'done').length}</div><div class="l">Raised by project owners</div></div>
    <div class="metric"><div class="eyebrow">Past due</div><div class="v">${lateAll}</div><div class="l">Activities and tasks</div></div>
    <div class="metric"><div class="eyebrow">Offtake tied up</div><div class="v">${fin}<small>of ${talks} MW</small></div><div class="l">Finalised against capacity in talks</div></div>`;
  v.appendChild(m);

  /* asks */
  const asks = S.asks.filter(a => a.status !== 'done').sort((a, b) => rankAsk(b) - rankAsk(a));
  const askSec = section('Needs a decision from you', 'Raised by project owners against a specific activity.',
    asks.length ? tableOf(['Urgency', 'What you need to do', 'Project / activity', 'Needed by', 'Raised by', ''],
      asks.map(a => {
        const p = proj(a.projectId), overdue = a.by && a.by < today();
        return [`<span class="tag ${a.urgency === 'High' ? 'risk' : a.urgency === 'Medium' ? 'watch' : 'idle'}">${esc(a.urgency)}</span>`,
        `<b>${esc(a.title)}</b>${a.note ? `<div class="sub">${esc(a.note)}</div>` : ''}`,
        `${p ? esc(p.name) : 'Not assigned'}${a.path ? `<div class="sub">${esc(labelForPath(a.path))}</div>` : ''}`,
        `<span class="num ${overdue ? 'late' : ''}">${dLabel(a.by)}</span>`,
        `<span class="sub">${esc(a.raisedBy)}</span>`,
        { html: '', act: [['Open', () => editAsk(a)], ['Done', () => { a.status = 'done'; save(); render(); toast('Cleared'); }]] }];
      })) : el('div', 'empty', 'Nothing is waiting on you.'));
  const addAsk = el('button', 'btn sm pri', '+ Add an item for me');
  addAsk.onclick = () => editAsk(null);
  $('header', askSec).appendChild(addAsk);
  v.appendChild(askSec);

  const items = dueItems(null);
  v.appendChild(section('Daily tracker — today and overdue', 'Type in the bottom row to add a task. Everything on this page is edited in place.',
    taskTable(bucket(items, 'daily'), { defaultDue: today(), placeholder: 'Add a task for today', emptyText: 'Nothing overdue today.' })));
  v.appendChild(section('Weekly tracker — next seven days', 'Falls due before ' + dLabel(addDays(today(), 7)) + '.',
    taskTable(bucket(items, 'weekly'), { defaultDue: addDays(today(), 7), placeholder: 'Add a task for this week', emptyText: 'Nothing falls due in the next seven days.' })));
  const later = bucket(items, 'later').filter(i => i.kind === 'task');
  if (later.length) v.appendChild(section('Later', 'Tasks dated beyond this week.', taskTable(later, { add: false })));

  /* a finished enabler stays on the dashboard, struck through, until the end of that month */
  const ens = S.enablers.filter(e => e.status !== 'Done' || inThisMonth(e.doneOn)).sort((a, b) => String(a.end || '9').localeCompare(String(b.end || '9')));
  v.appendChild(section('Enablers', 'Approvals, appointments and opportunities that sit above the projects. Completed ones stay listed until the end of the month.',
    ens.length ? tableOf(['Task to be done', 'For what', 'Counterparty', 'Owner', 'End date', 'Status'],
      ens.map(e => ({
        cls: e.status === 'Done' ? 'done' : '',
        cells: [{ link: [e.title, () => editEnabler(e)], html: e.purpose ? `<div class="sub">${esc(trim(e.purpose, 70))}</div>` : '' },
          esc(e.forWhat || '—'), esc(e.party || '—'), esc(pname(e.owner)),
        `<span class="num ${e.end && e.end < today() && e.status !== 'Done' ? 'late' : ''}">${dLabel(e.end)}</span>`,
        `<span class="tag ${e.status === 'Done' ? 'done' : e.status === 'In progress' ? 'ok' : 'idle'}">${esc(e.status)}${e.status === 'Done' && e.doneOn ? ' ' + dLabel(e.doneOn) : ''}</span>`]
      }))) : el('div', 'empty', 'No open enablers.')));
}
function rankAsk(a) { const u = a.urgency === 'High' ? 3 : a.urgency === 'Medium' ? 2 : 1; return u + (a.by ? Math.max(0, 30 - daysTo(a.by)) / 30 : 0); }

/* ---------- personal desk (project owners) ---------- */
/* ---------- what a person is allowed to see ----------
   CEO: everything. Project lead: everything inside their own projects.
   Anyone else: only the branches assigned to them, plus the parent lines
   needed to place those branches — nothing else is rendered at all. */
/* One project, one owner. They run all of it; nobody else is sent it at all. */
function canSeeAll(p) { return isCEO() || (!!p && p.head === S.viewer); }
function ownsProject(p) { return isCEO() || (!!p && p.head === S.viewer); }
function visibleProjects() {
  if (isCEO()) return S.projects.slice();
  return S.projects.filter(p => p.head === S.viewer);
}
function canSeeProject(p) { return canSeeAll(p) || visibleProjects().some(x => x.id === p.id); }
/* the server sends a project whole or not at all, so nothing to narrow here */
function scopeOf() { return null; }
function inScope() { return true; }
function isCtx() { return false; }
function myItems(p) { const out = []; walkLeaves(p, n => out.push(n)); return out; }

function myProjects(id) { return S.projects.filter(p => p.head === id); }
function viewMyDesk() {
  const me = S.viewer, who = person(me) || {};
  $('#crumb').textContent = 'My desk'; $('#title').textContent = who.name || 'My work';
  $('#topActions').innerHTML = '';
  const v = $('#view'); v.innerHTML = '';
  const mine = dueItems(me), mps = myProjects(me);
  const lateN = mine.filter(i => i.d && i.d < today()).length;
  const raised = S.asks.filter(a => a.raisedBy === who.name);

  const m = el('div', 'metrics'); m.style.marginBottom = '28px';
  m.innerHTML = `<div class="metric"><div class="eyebrow">Assigned to me</div><div class="v">${mine.length}</div><div class="l">${esc(who.role || '')}</div></div>
    <div class="metric"><div class="eyebrow">Past due</div><div class="v">${lateN}</div><div class="l">Needs a date change or a push</div></div>
    <div class="metric"><div class="eyebrow">My projects</div><div class="v">${mps.length}</div><div class="l">Where I lead or own work</div></div>
    <div class="metric"><div class="eyebrow">With the CEO</div><div class="v">${raised.filter(a => a.status !== 'done').length}</div><div class="l">Items I have raised</div></div>`;
  v.appendChild(m);

  v.appendChild(section('Today and overdue', 'Add your own tasks in the bottom row.',
    taskTable(bucket(mine, 'daily'), { defaultDue: today(), placeholder: 'Add a task for today', emptyText: 'Nothing overdue.' })));
  v.appendChild(section('This week', 'Falls due before ' + dLabel(addDays(today(), 7)) + '.',
    taskTable(bucket(mine, 'weekly'), { defaultDue: addDays(today(), 7), placeholder: 'Add a task for this week', emptyText: 'Nothing due this week.' })));
  const later = bucket(mine, 'later');
  if (later.length) v.appendChild(section('Later', 'Beyond this week.', taskTable(later, { add: false })));

  v.appendChild(section('My projects', 'Only projects where you lead or own something.',
    mps.length ? tableOf(['Project', 'Capacity', 'Progress', 'My open items', 'My past due', 'COD'],
      mps.map(p => {
        const myOpen = []; walkLeaves(p, n => { if (!n.closed && progOf(n) < 1) myOpen.push(n); });
        return [{ link: [p.name, () => go('project', p.id)], html: `<div class="sub">${esc([p.site, p.state].filter(Boolean).join(', '))}</div>` },
        `<span class="num">${((+p.solar || 0) + (+p.wind || 0))} MW</span>`,
        `<div class="bar" style="min-width:100px"><i style="width:${Math.min(100, projProg(p) * 100)}%"></i></div><div class="num" style="font-size:11px">${pct(projProg(p))}</div>`,
        `<span class="num">${myOpen.length}</span>`,
        `<span class="num ${myOpen.filter(isLate).length ? 'late' : ''}">${myOpen.filter(isLate).length}</span>`,
        `<span class="num">${p.cod ? mLabel(p.cod) : '—'}</span>`];
      })) : el('div', 'empty', 'Nothing assigned to you yet. The CEO assigns owners on any activity.')));

  const rs = el('div');
  const rb = el('button', 'btn pri', '+ Raise an item for the CEO'); rb.onclick = () => editAsk(null);
  if (raised.length) rs.appendChild(tableOf(['What I asked for', 'Project', 'Urgency', 'Needed by', 'Status'],
    raised.map(a => [`<b>${esc(a.title)}</b>`, esc((proj(a.projectId) || {}).name || '—'),
    `<span class="tag ${a.urgency === 'High' ? 'risk' : 'idle'}">${esc(a.urgency)}</span>`,
    `<span class="num">${dLabel(a.by)}</span>`,
    `<span class="tag ${a.status === 'done' ? 'done' : 'watch'}">${a.status === 'done' ? 'Cleared' : 'With the CEO'}</span>`])));
  else rs.appendChild(el('div', 'empty', 'You have not raised anything with the CEO.'));
  rs.appendChild(el('div', '', '')).appendChild(rb);
  v.appendChild(section('With the CEO', 'Decisions, signatures or interventions you have asked for.', rs));
}

function section(title, sub, body) {
  const s = el('section', 'sect');
  s.innerHTML = `<header><h2>${esc(title)}</h2><div class="sub">${esc(sub)}</div></header>`;
  s.appendChild(body); return s;
}

function tableOf(heads, rows) {
  const t = el('table', 'tbl');
  t.innerHTML = '<thead><tr>' + heads.map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead>';
  const tb = el('tbody');
  rows.forEach(entry => {
    const cells = Array.isArray(entry) ? entry : entry.cells;
    const tr = el('tr', (Array.isArray(entry) ? '' : entry.cls) || '');
    cells.forEach(c => {
      const td = el('td');
      if (c && typeof c === 'object') {
        if (c.link) { const [label, fn] = c.link; const a = el('button', 'linkish', esc(label)); a.onclick = e => { e.stopPropagation(); fn(); }; td.appendChild(a); }
        if (c.html) td.insertAdjacentHTML('beforeend', c.html);
        (c.act || []).forEach(([label, fn]) => { const b = el('button', 'btn ghost sm', label); b.onclick = e => { e.stopPropagation(); fn(); }; td.appendChild(b); });
      } else td.innerHTML = c;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return t;
}

/* ===================== PROJECTS ===================== */
/* ===================== PROJECTS — portfolio table + heatmap ===================== */
let PSORT = 'gap';
function viewProjects() {
  $('#crumb').textContent = 'Deliver'; $('#title').textContent = 'Projects';
  const ta = $('#topActions'); ta.innerHTML = '';
  ta.appendChild(lens('projects'));
  if (isCEO()) {
    const w = el('button', 'btn', 'Choose status columns'); w.onclick = pickWatch; ta.appendChild(w);
    const many = el('button', 'btn', 'Add several'); many.onclick = addManyProjects; ta.appendChild(many);
    const b = el('button', 'btn pri', '+ Add project');
    b.onclick = () => { const p = newProject({ name: 'New project' }); S.projects.push(p); save(); go('project', p.id); };
    ta.appendChild(b);
  }
  const v = $('#view'); v.innerHTML = '';

  let list = visibleProjects();
  if (!isCEO()) {
    if (!list.length) {
      v.appendChild(el('div', 'empty', 'No projects are assigned to you yet. A project appears here once you lead it, or once an activity or task inside it carries your name.'));
      return;
    }
    v.appendChild(scopedProjectTable(list));
    return;
  }

  const key = {
    gap: p => -(projProg(p) - plannedNow(p)),
    name: p => p.name.toLowerCase(),
    size: p => -((+p.solar || 0) + (+p.wind || 0)),
    cod: p => p.cod || '9999',
    late: p => -countLate(p)
  }[PSORT] || (p => p.name);
  list = list.slice().sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });

  const sortBar = el('div', 'toolbar');
  sortBar.appendChild(el('span', 'eyebrow', 'Sort by'));
  [['gap', 'Furthest behind'], ['size', 'Capacity'], ['cod', 'Earliest COD'], ['late', 'Most past due'], ['name', 'Name']].forEach(([k, l]) => {
    const b = el('button', 'btn sm' + (PSORT === k ? ' pri' : ''), l);
    b.onclick = () => { PSORT = k; render(); }; sortBar.appendChild(b);
  });
  v.appendChild(sortBar);

  /* ---- comparison table ---- */
  const watch = S.watch || [];
  const tbl = el('table', 'tbl ptbl');
  tbl.innerHTML = '<thead><tr>' +
    ['Project', 'Capacity', 'Progress against plan', 'Status']
      .concat(watch.map(p2 => trim(labelForPath(p2), 18)))
      .concat(['COD', 'Open', 'Past due', 'Lead'])
      .map((h, i) => `<th${i >= 5 ? ' class="r"' : ''}>${esc(h)}</th>`).join('') + '</tr></thead>';
  const tb = el('tbody');
  list.forEach(p => {
    const pr = projProg(p), pl = plannedNow(p), h = health(p);
    const tr = el('tr');
    const c1 = el('td');
    const lk = el('button', 'linkish', esc(p.name)); lk.onclick = () => go('project', p.id);
    c1.append(lk, el('div', 'sub', esc([p.site, p.state].filter(Boolean).join(', ') || 'Location not set')));
    tr.appendChild(c1);
    tr.appendChild(el('td', '', `<b class="num">${((+p.solar || 0) + (+p.wind || 0))}</b> <span class="sub">MW</span>
      <div class="capbar" title="Solar ${p.solar || 0} · Wind ${p.wind || 0} MW, BESS ${p.bess || 0} MWh">
        <i style="flex:${+p.solar || 0};background:var(--saffron)"></i><i style="flex:${+p.wind || 0};background:var(--moonstone)"></i><i style="flex:${(+p.bess || 0) / 4};background:var(--violet)"></i></div>`));
    tr.appendChild(el('td', '', `<div style="display:flex;justify-content:space-between;font-size:11.5px"><b class="num">${pct(pr)}</b><span class="sub">${h.none ? 'no dates' : pct(pl) + ' plan'}</span></div>
      <div class="bar" style="min-width:120px;margin-top:3px"><i class="${h.cls === 'risk' ? 'bad' : h.cls === 'watch' ? 'warn' : ''}" style="width:${Math.min(100, pr * 100)}%"></i>${h.none ? '' : `<span class="plan" style="left:${Math.min(100, pl * 100)}%"></span>`}</div>`));
    tr.appendChild(el('td', '', `<span class="tag ${p.setup ? 'idle' : h.cls}">${p.setup ? 'Not set up' : h.label}</span>${h.none || p.setup ? '' : `<div class="sub num">${(h.v >= 0 ? '+' : '') + (h.v * 100).toFixed(1)} pts</div>`}`));
    watch.forEach(path => {
      const n = findByPath(p, path);
      tr.appendChild(el('td', '', n ? `<span class="tag ${tagClass(statusOf(n), isLate(n))}">${esc(statusOf(n))}</span><div class="sub num">${pct0(progOf(n))}</div>` : '<span class="sub">—</span>'));
    });
    tr.appendChild(el('td', 'r num', p.cod ? mLabel(p.cod) : '—'));
    tr.appendChild(el('td', 'r num', String(countOpen(p))));
    tr.appendChild(el('td', 'r num' + (countLate(p) ? ' late' : ''), String(countLate(p))));
    const ld = el('td', 'r');
    if (isCEO()) {
      const sel = el('select'); sel.className = 'inline';
      sel.innerHTML = '<option value="">— nobody —</option>' +
        S.org.map(o => `<option value="${o.id}" ${p.head === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
      sel.onchange = () => { p.head = sel.value; save(); render(); };
      ld.appendChild(sel);
    } else ld.textContent = pname(p.head);
    tr.appendChild(ld);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  v.appendChild(section('Portfolio at a glance', 'Every project on one line. Status columns are the ones you chose; change them from the top right.', tbl));

  /* ---- heatmap ---- */
  const codes = (list[0] || S.projects[0] || { packages: [] }).packages;
  const hm = el('div', 'hmwrap');
  const ht = el('table', 'tbl heat');
  ht.innerHTML = '<thead><tr><th>Project</th>' + codes.map(k => `<th class="c" title="${esc(k.name)}">${esc(k.code)}</th>`).join('') + '</tr></thead>';
  const hb = el('tbody');
  list.forEach(p => {
    const tr = el('tr');
    const c = el('td');
    const lk = el('button', 'linkish', esc(trim(p.name, 22))); lk.onclick = () => go('project', p.id);
    c.appendChild(lk); tr.appendChild(c);
    codes.forEach(k => {
      const n = findByPath(p, k.code);
      const td = el('td', 'c');
      if (!n) { td.innerHTML = '<span class="sub">—</span>'; tr.appendChild(td); return; }
      const pg = progOf(n);
      let lateHere = false; (function rec(x) { if (!x.children || !x.children.length) { if (isLate(x)) lateHere = true; return; } x.children.forEach(rec); })(n);
      const cell = el('button', 'hcell' + (lateHere ? ' late' : ''), pg > 0 ? pct0(pg) : '');
      cell.style.background = pg > 0 ? `color-mix(in srgb, var(--pulse) ${Math.round(18 + pg * 82)}%, var(--neutral))` : 'var(--neutral)';
      cell.title = `${p.name} · ${k.name} — ${pct(pg)} done${lateHere ? ', has past-due activities' : ''}`;
      cell.onclick = () => { COLLAPSED[n.id] = false; go('project', p.id); setTimeout(() => { const r = document.getElementById('row-' + n.id); if (r) r.scrollIntoView({ block: 'center' }); }, 60); };
      td.appendChild(cell); tr.appendChild(td);
    });
    hb.appendChild(tr);
  });
  ht.appendChild(hb); hm.appendChild(ht);
  const legend = el('div', 'row'); legend.style.marginTop = '10px';
  legend.innerHTML = `<span class="sub">Darker is further along.</span>
    <span class="hkey" style="background:var(--neutral)"></span><span class="sub">0%</span>
    <span class="hkey" style="background:color-mix(in srgb,var(--pulse) 50%,var(--neutral))"></span><span class="sub">50%</span>
    <span class="hkey" style="background:var(--pulse)"></span><span class="sub">100%</span>
    <span class="hkey late-key"></span><span class="sub">amber edge means something inside is past due</span>`;
  hm.appendChild(legend);
  v.appendChild(section('Package heatmap', 'Where each project stands on each package — ' + codes.map(k => k.code).join(', ') + '. Click a cell to jump straight to it.', hm));
}

/* Adding a portfolio one project at a time is miserable, so take a whole list
   at once — pasted out of a table, or typed. One project per line:
   Name | State | Solar MWp | Wind MW | BESS MWh */
function addManyProjects() {
  const d = openDrawerEl(dHead('Projects', 'Add several at once') + '<div class="dbody" id="db"></div>');
  wireClose(d);
  const b = document.getElementById('db');
  b.innerHTML = `<p class="sub" style="margin-top:0">One project per line. Separate the columns with a vertical bar, a tab or a comma:</p>
    <div class="fmtline">Name │ State │ Solar MWp │ Wind MW │ BESS MWh</div>
    <p class="sub">The last three are numbers and may be left out. Copy straight from a spreadsheet if that is easier — tabs work.</p>`;

  const ta = el('textarea'); ta.rows = 12; ta.className = 'bulk';
  ta.placeholder = 'Ananthapuram III – ISTS | Andhra Pradesh | 465 | 0\nKhavda VII – ISTS | Gujarat | 387.5 | 100';
  b.appendChild(ta);

  const tplRow = el('label', 'fld'); tplRow.style.marginTop = '14px';
  tplRow.innerHTML = '<span>Breakdown to start each one on</span>';
  const tpl = el('select');
  tpl.innerHTML = '<option value="__std">The standard breakdown</option><option value="">None — build it later</option>' +
    (S.templates || []).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  tplRow.appendChild(tpl);
  b.appendChild(tplRow);

  const preview = el('div', 'sub'); preview.style.margin = '4px 0 12px';
  b.appendChild(preview);

  const parseLines = () => {
    const out = [];
    ta.value.split('\n').forEach(line => {
      const raw = line.trim();
      if (!raw) return;
      const sep = raw.indexOf('|') >= 0 ? '|' : (raw.indexOf('\t') >= 0 ? '\t' : ',');
      const c = raw.split(sep).map(x => x.trim());
      if (!c[0]) return;
      out.push({
        name: c[0], state: c[1] || '',
        solar: +(c[2] || 0) || 0, wind: +(c[3] || 0) || 0, bess: +(c[4] || 0) || 0,
        existing: S.projects.find(p => p.name.trim().toLowerCase() === c[0].toLowerCase()) || null
      });
    });
    return out;
  };
  const upd = el('label', 'pickrow'); upd.style.borderBottom = '0';
  upd.innerHTML = `<input type="checkbox" id="bulkUpd" checked style="width:auto">
    <span><b>Correct the capacity on projects already here</b>
    <div class="sub">A name that matches keeps its breakdown, progress and history — only the solar, wind and BESS figures are set from this list.</div></span>`;
  b.appendChild(upd);

  const refresh = () => {
    const rows = parseLines();
    const dupes = rows.filter(r => r.existing).length;
    const mw = rows.filter(r => !r.existing).reduce((a, r) => a + r.solar + r.wind, 0);
    const doUpd = (document.getElementById('bulkUpd') || {}).checked;
    preview.innerHTML = rows.length
      ? '<b>' + (rows.length - dupes) + '</b> to add' + (mw ? ', ' + mw.toFixed(1) + ' MW' : '') +
        (dupes ? ' · <b>' + dupes + '</b> already here' + (doUpd ? ', capacity will be corrected' : ', left alone') : '')
      : 'Nothing to add yet.';
  };
  ta.oninput = refresh;
  upd.querySelector('input').onchange = refresh;
  refresh();

  const row = el('div', 'row');
  const fill = el('button', 'btn sm', 'Fill in the substation list');
  fill.title = 'The projects from the substation and PPA tables';
  fill.onclick = () => { ta.value = SUBSTATION_LIST; refresh(); };
  const go = el('button', 'btn pri', 'Add them');
  go.onclick = () => {
    const all = parseLines();
    const doUpd = (document.getElementById('bulkUpd') || {}).checked;
    let fixed = 0;
    if (doUpd) all.filter(r => r.existing).forEach(r => {
      const p = r.existing;
      p.solar = r.solar; p.wind = r.wind;
      if (r.bess) p.bess = r.bess;
      if (r.state) p.state = r.state;
      p.setup = false; fixed++;
    });
    const rows = all.filter(r => !r.existing);
    if (!rows.length && !fixed) { toast('Nothing to change'); return; }
    if (!rows.length) { save(); closeDrawer(); render(); toast('Capacity corrected on ' + fixed + ' project(s)'); return; }
    let packages = [];
    if (tpl.value === '__std') packages = S.standardTemplate || [];
    else if (tpl.value) { const t = (S.templates || []).find(x => x.id === tpl.value); packages = t ? t.packages : []; }
    rows.forEach(r => {
      const p = newProject({
        name: r.name, state: r.state, solar: r.solar, wind: r.wind, bess: r.bess,
        site: r.name.split(/[,–-]/)[0].trim(), setup: false
      });
      p.packages = packages.length ? packagesFromTemplate(packages) : [];
      renumberProject(p);
      S.projects.push(p);
    });
    save(); closeDrawer(); render();
    toast(rows.length + ' projects added' + (fixed ? ', ' + fixed + ' corrected' : ''));
  };
  row.append(fill, go);
  b.appendChild(row);
}

const SUBSTATION_LIST = [
  'Morena | Madhya Pradesh | 465 | 0',
  'Sisrana | Gujarat | 155 | 0',
  'Davanagere | Karnataka | 0 | 300',
  'Saurashtra | Gujarat | 0 | 100',
  'Ananthapuram III – ISTS | Andhra Pradesh | 465 | 0',
  'Krishnagiri PS (Kurnool V) – ISTS | Andhra Pradesh | 542.5 | 0',
  'Bhachau/Lakhadia II – ISTS | Gujarat | 0 | 249.1',
  'Pali – ISTS | Rajasthan | 240.3 | 0',
  'Khavda VII – ISTS | Gujarat | 387.5 | 100',
  'Solapur – ISTS | Maharashtra | 465 | 0',
  'Ananthapuram III (Ph-2) – ISTS | Andhra Pradesh | 930 | 0',
  'Bhalgamda, Morbi – InSTS | Gujarat | 465 | 0',
  'Sahjahanpur, Jalaun – InSTS | Uttar Pradesh | 125.6 | 0',
  'Purakalan, Lalitpur – InSTS | Uttar Pradesh | 37.2 | 0',
  'Jamgaon – InSTS | Maharashtra | 77.5 | 50',
  'Karur – InSTS | Tamil Nadu | 77.5 | 50'
].join('\n');

function scopedProjectTable(list) {
  const wrap = el('div');
  const t = el('table', 'tbl ptbl');
  t.innerHTML = '<thead><tr><th>Project</th><th>Capacity</th><th class="r">My open items</th><th class="r">My past due</th><th class="r">My progress</th><th class="r">COD</th><th>Project lead</th><th></th></tr></thead>';
  const tb = el('tbody');
  list.forEach(p => {
    const mine = myItems(p), open = mine.filter(n => !n.closed && progOf(n) < 1), late = mine.filter(isLate);
    const myProg = mine.length ? mine.reduce((a, n) => a + progOf(n), 0) / mine.length : 0;
    const lead = canSeeAll(p);
    const tr = el('tr');
    const c = el('td');
    const lk = el('button', 'linkish', esc(p.name)); lk.onclick = () => go('project', p.id);
    c.append(lk, el('div', 'sub', esc([p.site, p.state].filter(Boolean).join(', ') || 'Location not set')));
    tr.appendChild(c);
    tr.appendChild(el('td', '', `<b class="num">${((+p.solar || 0) + (+p.wind || 0))}</b> <span class="sub">MW</span>`));
    tr.appendChild(el('td', 'r num', String(open.length)));
    tr.appendChild(el('td', 'r num' + (late.length ? ' late' : ''), String(late.length)));
    tr.appendChild(el('td', 'r', `<div class="bar" style="min-width:90px"><i style="width:${Math.min(100, myProg * 100)}%"></i></div><div class="num" style="font-size:11px;margin-top:3px">${pct0(myProg)}</div>`));
    tr.appendChild(el('td', 'r num', p.cod ? mLabel(p.cod) : '—'));
    tr.appendChild(el('td', 'sub', esc(pname(p.head))));
    tr.appendChild(el('td', 'r', lead ? '<span class="tag ok">You lead this</span>' : '<span class="sub">' + mine.length + ' items yours</span>'));
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t);
  return section('Your projects', 'Only the projects you lead or hold work in. Figures are your own items, not the whole project.', wrap);
}
function lens(cur) {
  const g = el('div', 'seg-ctl');
  [['projects', 'By project'], ['activities', 'By activity']].forEach(([k, l]) => {
    const b = el('button', k === cur ? 'on' : '', l); b.onclick = () => go(k); g.appendChild(b);
  });
  return g;
}
function watchRows(p) {
  const w = S.watch || []; if (!w.length) return '';
  return '<div class="watch">' + w.map(path => {
    const n = findByPath(p, path);
    if (!n) return `<div class="wrow"><span class="wname">${esc(trim(labelForPath(path), 26))}</span><span class="sub">not in this project</span></div>`;
    return `<div class="wrow"><span class="wname">${esc(trim(labelForPath(path), 26))}</span>
      <span class="tag ${tagClass(statusOf(n), isLate(n))}">${esc(statusOf(n))}</span><span class="num">${pct0(progOf(n))}</span></div>`;
  }).join('') + '</div>';
}
function pickWatch() {
  const d = openDrawerEl(dHead('Projects', 'What shows on every project card') +
    '<div class="dbody"><p class="sub" style="margin-top:0">Pick up to four items — connectivity, land, or any activity in the breakdown. Every card shows that item’s status and progress, so the cards stay comparable.</p><div id="pw"></div></div>');
  wireClose(d);
  const host = $('#pw', d);
  const q = el('input'); q.type = 'text'; q.placeholder = 'Search the work breakdown'; q.style.margin = '0 0 10px';
  const list = el('div'); host.append(q, list);
  const draw = () => {
    const term = q.value.trim().toLowerCase(), all = templateNodes();
    const rows = (term ? all.filter(t => t.name.toLowerCase().includes(term)) : all.filter(t => t.depth <= 1)).slice(0, 70);
    list.innerHTML = '';
    rows.forEach(t => {
      const on = (S.watch || []).includes(t.path);
      const r = el('label', 'pickrow');
      r.style.paddingLeft = (t.depth * 12) + 'px';
      r.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''} style="width:auto"><span class="tcode">${esc(refLabel(t.path))}</span><span style="flex:1">${esc(t.name)}</span>`;
      r.querySelector('input').onchange = e => {
        S.watch = S.watch || [];
        if (e.target.checked) { if (S.watch.length >= 4) { e.target.checked = false; toast('Four is the maximum — remove one first'); return; } S.watch.push(t.path); }
        else S.watch = S.watch.filter(x => x !== t.path);
        save(); render(); draw();
      };
      list.appendChild(r);
    });
    if (!rows.length) list.appendChild(el('div', 'empty', 'Nothing matches that search.'));
  };
  q.oninput = draw; draw();
}

/* ---------- project detail ---------- */
let FILTER = { q: '', only: '' }, COLLAPSED = {};
function viewProject() {
  const p = proj(PID); if (!p) return go('projects');
  if (!canSeeProject(p)) { toast('That project is not assigned to you'); return go('projects'); }
  const full = canSeeAll(p), sc = scopeOf(p);
  $('#crumb').textContent = 'Deliver / Projects'; $('#title').textContent = p.name;
  const ta = $('#topActions'); ta.innerHTML = '';
  const back = el('button', 'btn', '← All projects'); back.onclick = () => go('projects'); ta.appendChild(back);
  const chip = clipChip(); if (chip) ta.appendChild(chip);
  if (isCEO()) { const e = el('button', 'btn', 'Edit details'); e.onclick = () => editProject(p); ta.appendChild(e); }
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(ownerStrip(p, full));
  const pr = projProg(p), pl = plannedNow(p), h = health(p);

  const m = el('div', 'metrics'); m.style.marginBottom = '26px';
  m.innerHTML = `
    <div class="metric"><div class="eyebrow">Capacity</div><div class="v">${((+p.solar || 0) + (+p.wind || 0)).toLocaleString()}<small>MW</small></div>
      <div class="splitline"><div><b>${p.solar || 0}</b><span>Solar MW</span></div><div><b>${p.wind || 0}</b><span>Wind MW</span></div><div><b>${p.bess || 0}</b><span>BESS MWh</span></div></div></div>
    <div class="metric"><div class="eyebrow">Progress against plan</div><div class="v">${pct(pr)}</div>
      <div class="l"><span class="tag ${h.cls}">${h.label}${h.none ? '' : ' · ' + (h.v >= 0 ? '+' : '') + (h.v * 100).toFixed(1) + ' pts'}</span></div>
      <div class="bar" style="margin-top:8px"><i class="${h.cls === 'risk' ? 'bad' : h.cls === 'watch' ? 'warn' : ''}" style="width:${Math.min(100, pr * 100)}%"></i>${h.none ? '' : `<span class="plan" style="left:${Math.min(100, pl * 100)}%"></span>`}</div></div>
    <div class="metric"><div class="eyebrow">Site</div><div style="margin:6px 0 3px;font-size:15px">${esc([p.site, p.state].filter(Boolean).join(', ') || '—')}</div>
      <div class="l">Target COD <b class="num">${p.cod ? mLabel(p.cod) : '—'}</b></div></div>
    <div class="metric"><div class="eyebrow">Exceptions</div><div class="v">${countLate(p)}</div>
      <div class="l">Past due · ${asksFor(p.id).length} with the CEO · ${(p.chg || []).length} changes</div></div>`;
  v.appendChild(m);

  const strip = el('section', 'sect');
  strip.innerHTML = `<header><h2>Where the value sits</h2><div class="sub">Width is the package’s share of project value; fill is progress.</div></header>`;
  if (!p.packages.length) strip.appendChild(el('div', 'empty', 'Nothing to show until the work breakdown has packages.'));
  const totW = p.packages.reduce((a, k) => a + (k.pw || 0), 0) || 1;
  const sbar = el('div', 'strip'), slab = el('div', 'striplabels');
  if (p.packages.length) p.packages.forEach(k => {
    const sh = (k.pw || 0) / totW, pgr = progOf(k);
    const seg = el('button', 'seg'); seg.style.flex = sh;
    seg.title = `${k.code} · ${k.name} — ${pct0(sh)} of project, ${pct(pgr)} done`;
    seg.innerHTML = `<i style="height:${Math.max(pgr * 100, pgr > 0 ? 3 : 0)}%"></i>${sh > .035 ? `<em>${esc(k.code)}</em>` : ''}`;
    seg.onclick = () => { COLLAPSED[k.id] = false; render(); setTimeout(() => { const r = document.getElementById('row-' + k.id); if (r) r.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 40); };
    sbar.appendChild(seg);
    const l = el('div', '', sh > .035 ? pct0(sh) : esc(k.code)); l.style.flex = sh; slab.appendChild(l);
  });
  if (p.packages.length) strip.append(sbar, slab);
  v.appendChild(strip);

  const ch = el('section', 'sect');
  ch.innerHTML = `<header><h2>S-curve</h2><div class="sub">Cumulative plan against actual</div>
    <div class="lg" style="margin-left:auto"><span><i style="background:var(--midnight)"></i>Plan</span><span><i style="background:var(--pulse)"></i>Actual</span></div></header>`;
  ch.appendChild(hasSchedule(p) ? sCurve(p) : el('div', 'empty', 'No target dates set, so there is no plan line yet. Add target dates on the activities and the curve builds itself.'));
  v.appendChild(ch);

  v.appendChild(changeSection(p));

  /* work breakdown */
  const wb = el('section', 'sect');
  wb.innerHTML = `<header><h2>Work breakdown</h2><div class="sub">Packages, tasks and subtasks. Click any line to open it.</div></header>`;
  const tb = el('div', 'toolbar');
  const q = el('input'); q.type = 'text'; q.placeholder = 'Search activities'; q.value = FILTER.q;
  const only = el('select'); only.innerHTML = '<option value="">All activities</option><option value="late">Past due</option><option value="open">Open</option><option value="chg">Has a change</option><option value="closed">Closed</option>'; only.value = FILTER.only;
  const host = el('div');
  q.oninput = () => { FILTER.q = q.value; renderTree(p, host); };
  only.onchange = () => { FILTER.only = only.value; renderTree(p, host); };
  const ex = el('button', 'btn sm', 'Expand all'); ex.onclick = () => { walkAll(p, n => COLLAPSED[n.id] = false); renderTree(p, host); };
  const co = el('button', 'btn sm', 'Collapse all'); co.onclick = () => { walkAll(p, n => COLLAPSED[n.id] = true); renderTree(p, host); };
  tb.append(q, only, ex, co);
  if (canAddPackage(p)) {
    const ed = el('button', 'btn sm' + (EDITING ? ' pri' : ''), EDITING ? 'Done editing' : 'Edit structure');
    ed.onclick = () => { EDITING = !EDITING; render(); };
    tb.appendChild(ed);
    const ap = el('button', 'btn sm', '+ Add package'); ap.onclick = () => addChild(p, null); tb.appendChild(ap);
    const tp = el('button', 'btn sm', 'Templates'); tp.onclick = () => openTemplates(p); tb.appendChild(tp);
  }
  if (UI.clip && canAddPackage(p)) { const pb = el('button', 'btn sm', 'Paste as new package'); pb.onclick = () => pasteInto(p, null); tb.appendChild(pb); }
  host.className = EDITING ? 'wb editing' : 'wb';
  wb.append(tb, host); renderTree(p, host);
  v.appendChild(wb);
}

/* One project, one person answerable for it. Kept at the very top so it is the
   first thing read, and changeable in a single click by whoever may. */
function ownerStrip(p, full) {
  const box = el('div', 'ownerstrip');
  const canSet = isCEO();
  const lead = person(p.head);

  const left = el('div', 'os-left');
  left.innerHTML = '<div class="eyebrow">Project owner</div>';
  if (canSet) {
    const sel = el('select'); sel.className = 'os-select';
    sel.innerHTML = '<option value="">— nobody yet —</option>' +
      S.org.map(o => `<option value="${o.id}" ${p.head === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
    sel.onchange = () => {
      const prev = p.head;
      p.head = sel.value; save();
      if (p.head && p.head !== prev && S.notifyOnAssign) {
        const who = person(p.head) || {};
        notify(p.head,
          'Terra Clean — you are now the owner of ' + p.name,
          'Hello ' + (who.name || '') + ',\n\nYou have been made the owner of ' + p.name +
          ((+p.solar || 0) + (+p.wind || 0) ? ' (' + ((+p.solar || 0) + (+p.wind || 0)) + ' MW' + (p.site ? ', ' + p.site : '') + ')' : '') +
          '.\n\nThat means the whole project is yours to run: every package, the schedule, and anything logged against it.' +
          (p.cod ? '\n\nTarget COD: ' + mLabel(p.cod) : ''));
      }
      render();
    };
    left.appendChild(sel);
  } else {
    left.appendChild(el('div', 'os-name', esc(lead ? lead.name : 'Nobody yet')));
  }
  if (!lead) left.appendChild(el('div', 'sub', 'Every project should have one person answerable for it.'));
  box.appendChild(left);

  if (lead) {
    const mid = el('div', 'os-mid');
    mid.innerHTML = `<div><b class="num">${countOpen(p)}</b><span>Open</span></div>
      <div><b class="num ${countLate(p) ? 'late' : ''}">${countLate(p)}</b><span>Past due</span></div>
      <div><b class="num">${pct0(projProg(p))}</b><span>Complete</span></div>`;
    box.appendChild(mid);
  }

  const right = el('div', 'os-right');
  if (lead && lead.email) {
    const m = el('button', 'btn sm', '✉ Email them');
    m.onclick = () => notify(lead.id, 'Terra Clean — ' + p.name,
      'Hello ' + lead.name + ',\n\nA note about ' + p.name + '.\n\nProgress stands at ' + pct(projProg(p)) +
      ' with ' + countLate(p) + ' activities past due.');
    right.appendChild(m);
  }
  if (canSet) {
    const b = el('button', 'btn sm', 'Edit project details');
    b.onclick = () => editProject(p);
    right.appendChild(b);
  }
  box.appendChild(right);
  return box;
}

function sCurve(p) {
  const c = curveOf(p), W = 900, H = 220, L = 40, R = 12, T = 12, B = 28, n = c.months.length;
  const x = i => L + (W - L - R) * (n > 1 ? i / (n - 1) : 0), y = v => T + (H - T - B) * (1 - Math.min(1, v));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart'); svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `S-curve for ${p.name}: cumulative planned progress against actual`);
  let g = '';
  [0, .25, .5, .75, 1].forEach(v => { g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#EAE6E1"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" fill="#5C6E60">${v * 100}%</text>`; });
  const step = Math.max(1, Math.round(n / 9));
  for (let i = 0; i < n; i += step) g += `<text x="${x(i)}" y="${H - 9}" text-anchor="middle" font-size="10" fill="#5C6E60">${mLabel(c.months[i])}</text>`;
  const line = a => { let d = '', up = false; a.forEach((v, i) => { if (v == null) { up = false; return; } d += (up ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; up = true; }); return d; };
  const ci = c.months.indexOf(thisMonth());
  if (ci >= 0) g += `<line x1="${x(ci)}" x2="${x(ci)}" y1="${T}" y2="${H - B}" stroke="#DAD5CE" stroke-dasharray="3 3"/><text x="${x(ci) + 4}" y="${T + 10}" font-size="10" fill="#5C6E60">today</text>`;
  g += `<path d="${line(c.plan)}" fill="none" stroke="#0C2B15" stroke-width="1.6"/><path d="${line(c.actual)}" fill="none" stroke="#21BF61" stroke-width="3"/>`;
  const last = c.actual.reduce((a, v, i) => v == null ? a : i, -1);
  if (last >= 0) g += `<circle cx="${x(last)}" cy="${y(c.actual[last])}" r="4" fill="#21BF61"/>`;
  svg.innerHTML = g; return svg;
}

/* ===================== STRUCTURE EDITING ===================== */
let EDITING = false;
if (UI.showChanges === undefined) UI.showChanges = true;

function canStructure(p) { return ownsProject(p); }
function canAddPackage(p) { return ownsProject(p); }

function listFor(p, node) {           /* the array a node lives in */
  if (!node) return p.packages;
  const e = indexProject(p)[node.id];
  return e && e.parent ? (e.parent.children = e.parent.children || []) : p.packages;
}
function parentOf(p, node) { const e = indexProject(p)[node.id]; return e ? e.parent : null; }

function blankNode(name, isPkg) {
  const n = { id: uid(), code: '', name: name || 'New item', w: isPkg ? 0 : 0.01, prog: 0, log: [], children: [] };
  if (isPkg) n.pw = 0;
  return n;
}
function structuralSave(p, msg) { renumberProject(p); save(); render(); if (msg) toast(msg); }

function addChild(p, node) {
  const name = prompt(node ? 'Name of the new item under “' + node.name + '”' : 'Name of the new package');
  if (!name) return;
  const list = node ? (node.children = node.children || []) : p.packages;
  const n = blankNode(name.trim(), !node);
  if (node && !node.children.length) n.w = node.w || 0.01;
  list.push(n);
  structuralSave(p, 'Added');
  if (!EDITING) openTask(p, n);
}
function addSibling(p, node) {
  const name = prompt('Name of the new item, alongside “' + node.name + '”');
  if (!name) return;
  const list = listFor(p, node), i = list.indexOf(node);
  const isPkg = list === p.packages;
  const n = blankNode(name.trim(), isPkg);
  if (!isPkg) n.w = node.children && node.children.length ? 0.01 : (node.w || 0.01);
  list.splice(i + 1, 0, n);
  structuralSave(p, 'Added');
}
function moveNode(p, node, dir) {
  const list = listFor(p, node), i = list.indexOf(node), j = i + dir;
  if (j < 0 || j >= list.length) return;
  list.splice(i, 1); list.splice(j, 0, node);
  structuralSave(p);
}
function indentNode(p, node) {          /* becomes a child of the item above it */
  const list = listFor(p, node), i = list.indexOf(node);
  if (i <= 0) { toast('Nothing above it to sit under'); return; }
  const prev = list[i - 1];
  list.splice(i, 1);
  prev.children = prev.children || [];
  prev.children.push(node);
  if (list === p.packages) { delete node.pw; node.w = node.w || 0.01; }
  structuralSave(p);
}
function outdentNode(p, node) {         /* moves up one level */
  const parent = parentOf(p, node);
  if (!parent) { toast('Already a package — this is the top level'); return; }
  const grandList = listFor(p, parent), gi = grandList.indexOf(parent);
  parent.children = parent.children.filter(c => c.id !== node.id);
  grandList.splice(gi + 1, 0, node);
  if (grandList === p.packages) { node.pw = node.pw || 0; }
  structuralSave(p);
}
function deleteNode(p, node) {
  const count = (function c(n) { return 1 + (n.children || []).reduce((a, k) => a + c(k), 0); })(node) - 1;
  if (!confirm('Delete “' + node.name + '”' + (count ? ' and the ' + count + ' items under it' : '') + '?')) return;
  const list = listFor(p, node);
  const i = list.indexOf(node);
  if (i >= 0) list.splice(i, 1);
  structuralSave(p, 'Deleted');
  closeDrawer();
}
function clearStructure(p) {
  if (!confirm('Delete the entire work breakdown for “' + p.name + '”?\n\nAll ' + countNodes(p) + ' packages, tasks and subtasks go, along with their progress and status history. Changes and CEO items stay. This cannot be undone — export a backup first if you are unsure.')) return;
  p.packages = []; p.snaps = [];
  save(); closeDrawer(); render(); toast('Work breakdown cleared — build your own, or load a template');
}
function countNodes(p) { let n = 0; walkAll(p, () => n++); return n; }

/* ---------- templates ---------- */
function templateFromPackages(list) {
  return list.map(function cp(n) {
    const o = { code: n.code, name: n.name, w: n.w, children: (n.children || []).map(cp) };
    if (n.pw != null) o.pw = n.pw;
    if (n.qty != null) o.qty = n.qty;
    if (n.unit) o.unit = n.unit;
    if (n.desc) o.desc = n.desc;
    return o;
  });
}
function packagesFromTemplate(list) {
  return list.map(function cp(n) {
    const o = { id: uid(), code: n.code, name: n.name, w: n.w, prog: 0, log: [], children: (n.children || []).map(cp) };
    if (n.pw != null) o.pw = n.pw;
    if (n.qty != null) o.qty = n.qty;
    if (n.unit) o.unit = n.unit;
    if (n.desc) o.desc = n.desc;
    return o;
  });
}
/* Bring a template into a project without losing anything already recorded.
   Items are matched by name within their parent, so an existing line keeps its
   progress, its dates and its whole status history; only genuinely new lines
   are added, and nothing is ever removed. */
function mergeTemplate(project, tplPackages) {
  const stats = { added: 0, kept: 0 };
  (function walk(target, source) {
    (source || []).forEach(src => {
      const key = String(src.name || '').trim().toLowerCase();
      const found = (target || []).find(t => String(t.name || '').trim().toLowerCase() === key);
      if (found) {
        stats.kept++;
        if (found.w == null && src.w != null) found.w = src.w;
        if (found.pw == null && src.pw != null) found.pw = src.pw;
        if (!found.desc && src.desc) found.desc = src.desc;
        if (found.qty == null && src.qty != null) found.qty = src.qty;
        found.children = found.children || [];
        walk(found.children, src.children);
      } else {
        const fresh = packagesFromTemplate([src])[0];
        target.push(fresh);
        stats.added += 1 + countIn(fresh.children);
      }
    });
  })(project.packages, tplPackages);
  return stats;
}
function countIn(list) { return (list || []).reduce((a, n) => a + 1 + countIn(n.children), 0); }

function builtinTemplates() {
  return [{
    id: '__standard', builtin: true,
    name: 'Standard utility-scale solar',
    note: 'The eleven weighted packages and full activity list the Morena plan was built on.',
    packages: (S.standardTemplate || [])
  }, {
    id: '__blank', builtin: true, name: 'Start blank',
    note: 'No packages at all. Design the breakdown yourself from the first line.',
    packages: []
  }];
}
function allTemplates() { return builtinTemplates().concat(S.templates || []); }

function openTemplates(p) {
  const d = openDrawerEl(dHead(p.name, 'Templates') + '<div class="dbody" id="db"></div>');
  wireClose(d);
  const b = $('#db', d);
  const draw = () => {
    b.innerHTML = '';
    b.appendChild(el('p', 'sub', 'A template carries the shape of the work — packages, tasks, subtasks and their weightages. It never carries dates, progress, owners or history; those stay with the project they came from.'));

    const cur = el('div', 'dsec');
    cur.innerHTML = '<h4>Save this project’s breakdown</h4>';
    const row = el('div', 'row');
    const ti = el('input'); ti.type = 'text'; ti.placeholder = 'Template name, e.g. Wind + BESS hybrid'; ti.style.flex = '1';
    const sv = el('button', 'btn pri', 'Save as template');
    sv.onclick = () => {
      const nm = ti.value.trim();
      if (!nm) { ti.focus(); return; }
      if (!p.packages.length) { toast('There is nothing to save yet'); return; }
      S.templates = S.templates || [];
      S.templates.unshift({ id: uid(), name: nm, note: 'Saved from ' + p.name + ' on ' + dLabel(today()), packages: templateFromPackages(p.packages) });
      save(); ti.value = ''; draw(); toast('Template saved');
    };
    row.append(ti, sv);
    cur.appendChild(row);
    cur.appendChild(el('div', 'sub', countNodes(p) + ' items in this project right now.'));
    b.appendChild(cur);

    const list = el('div', 'dsec');
    list.innerHTML = '<h4>Apply a template</h4>';
    allTemplates().forEach(t => {
      const card = el('div', 'tplcard');
      const n = (function c(l) { return l.reduce((a, x) => a + 1 + c(x.children || []), 0); })(t.packages || []);
      card.innerHTML = `<div style="flex:1"><b>${esc(t.name)}</b>${t.builtin ? ' <span class="tag idle">built in</span>' : ''}
        <div class="sub">${esc(t.note || '')} · ${n} items</div></div>`;
      const acts = el('div', 'row');
      const rep = el('button', 'btn sm pri', 'Replace');
      rep.title = 'Throw away the current breakdown and use this one';
      rep.onclick = () => {
        if (p.packages.length && !confirm('Replace the current breakdown for “' + p.name + '” with “' + t.name + '”?\n\nThe existing ' + countNodes(p) + ' items and their progress are deleted.')) return;
        p.packages = packagesFromTemplate(t.packages); p.snaps = [];
        renumberProject(p); save(); closeDrawer(); render(); toast('Template applied');
      };
      const app = el('button', 'btn sm', 'Append');
      app.title = 'Add these packages after the ones already here';
      app.onclick = () => {
        p.packages = p.packages.concat(packagesFromTemplate(t.packages));
        renumberProject(p); save(); closeDrawer(); render(); toast('Template appended');
      };
      acts.append(rep, app);
      if (!t.builtin) {
        const del = el('button', 'btn ghost sm', 'Delete');
        del.onclick = () => { if (confirm('Delete the template “' + t.name + '”?')) { S.templates = S.templates.filter(x => x.id !== t.id); save(); draw(); } };
        acts.appendChild(del);
      }
      card.appendChild(acts);
      list.appendChild(card);
    });
    b.appendChild(list);

    const danger = el('div', 'dsec');
    danger.innerHTML = '<h4>Start again</h4>';
    const cl = el('button', 'btn', 'Delete the whole breakdown');
    cl.onclick = () => clearStructure(p);
    danger.appendChild(cl);
    danger.appendChild(el('div', 'sub', 'Leaves the project in place with no packages, ready for you to design your own.'));
    b.appendChild(danger);
  };
  draw();
}

/* ---------- tree ---------- */
function matches(p, n) {
  const q = FILTER.q.trim().toLowerCase();
  if (q && !(n.name || '').toLowerCase().includes(q)) return false;
  if (FILTER.only === 'late' && !isLate(n)) return false;
  if (FILTER.only === 'open' && (n.closed || progOf(n) >= 1)) return false;
  if (FILTER.only === 'closed' && !n.closed) return false;
  if (FILTER.only === 'chg' && !chgFor(p, codePath(p, n.id)).length) return false;
  return true;
}
function subtreeHas(p, n) { return (n.children && n.children.length) ? (n.children.some(c => subtreeHas(p, c)) || matches(p, n)) : matches(p, n); }
function renderTree(p, host) {
  const sc = scopeOf(p);
  const filtering = !!(FILTER.q || FILTER.owner || FILTER.only);
  host.innerHTML = '';
  host.className = (EDITING && canSeeAll(p) ? 'wb editing' : 'wb') + (sc ? ' scoped' : '');
  if (sc && !sc.own.size) {
    host.appendChild(el('div', 'empty', 'Nothing in this project is assigned to you yet.'));
    return;
  }
  if (!p.packages.length) {
    const box = el('div', 'empty');
    box.innerHTML = '<b>No work breakdown yet.</b><br>Design your own from the first line, or start from a template and change it as you like.';
    host.appendChild(box);
    if (canAddPackage(p)) {
      const r = el('div', 'row'); r.style.marginTop = '12px';
      const a = el('button', 'btn pri', '+ Add the first package'); a.onclick = () => addChild(p, null);
      const t = el('button', 'btn', 'Start from a template'); t.onclick = () => openTemplates(p);
      r.append(a, t); host.appendChild(r);
    }
    return;
  }
  const hd = el('div', 'thead');
  hd.innerHTML = `<div>Activity</div><div class="r">Weight</div><div>Status</div><div class="r">Done</div><div>Target</div><div class="r">${EDITING ? 'Edit' : ''}</div>`;
  host.appendChild(hd);
  let shown = 0;
  p.packages.forEach(pk => (function rec(n, depth) {
    if (!inScope(sc, n)) return;
    const ctx = isCtx(sc, n);
    if (!ctx && filtering && !subtreeHas(p, n)) return;
    shown++; host.appendChild(rowFor(p, n, depth, filtering, host, ctx));
    if (ctx || filtering || !COLLAPSED[n.id]) (n.children || []).forEach(c => rec(c, depth + 1));
  })(pk, 0));
  if (!shown) host.appendChild(el('div', 'empty', 'No activities match these filters.'));
}
function rowFor(p, n, depth, filtering, host, ctxOnly) {
  const kids = !!(n.children && n.children.length), pr = progOf(n), st = statusOf(n), late = isLate(n);
  const path = codePath(p, n.id), nChg = chgFor(p, path).length, nAsk = asksFor(p.id, path).length;
  const totW = p.packages.reduce((a, k) => a + (k.pw || 0), 0) || 1;
  const weight = depth === 0 ? (n.pw || 0) / totW : wOf(n);
  const d = due(n);
  const editable = EDITING && canSeeAll(p) && canStructure(p, n);
  const r = el('div', 'trow lvl' + Math.min(depth, 3) + (ctxOnly ? ' ctx' : '')); r.id = 'row-' + n.id;
  if (ctxOnly) {
    const nm = el('div', 'tname'); nm.style.paddingLeft = (depth * 15) + 'px';
    nm.append(el('span', 'tw'), el('span', 'tcode', esc(n.code || '')), el('span', 'tlabel', esc(n.name)));
    r.appendChild(nm);
    for (let i = 0; i < 4; i++) r.appendChild(el('div', ''));
    r.appendChild(el('div', 'r sub', ''));
    return r;
  }

  const name = el('div', 'tname'); name.style.paddingLeft = (depth * 15) + 'px';
  if (kids) {
    const t = el('button', 'tw', (filtering || !COLLAPSED[n.id]) ? '▾' : '▸');
    t.setAttribute('aria-label', 'Toggle'); t.dataset.tog = '1';
    name.appendChild(t);
  } else name.appendChild(el('span', 'tw'));
  name.appendChild(el('span', 'tcode', esc(n.code || '')));
  if (editable) {
    const i = el('input'); i.type = 'text'; i.className = 'inline title'; i.value = n.name;
    i.onclick = e => e.stopPropagation();
    i.onchange = () => { n.name = i.value.trim() || n.name; save(); };
    name.appendChild(i);
  } else {
    const l = el('span', 'tlabel', esc(n.name)); l.title = n.name;
    name.appendChild(l);
  }
  if (nChg) name.appendChild(el('span', 'flag', nChg + ' chg'));
  if (nAsk) name.appendChild(el('span', 'flag ask', 'CEO'));
  if (n.urg === 'High') name.appendChild(el('span', 'flag ask', '!'));
  r.appendChild(name);

  const wc = el('div', 'num r wcell');
  if (editable && !kids) {
    const i = el('input'); i.type = 'number'; i.step = '0.1'; i.min = '0'; i.className = 'inline'; i.style.width = '58px';
    i.value = ((depth === 0 ? (n.pw || 0) : (n.w || 0)) * 100).toFixed(1);
    i.onclick = e => e.stopPropagation();
    i.onchange = () => { const v = (+i.value || 0) / 100; if (depth === 0) n.pw = v; else n.w = v; save(); render(); };
    wc.appendChild(i);
  } else if (editable && depth === 0) {
    const i = el('input'); i.type = 'number'; i.step = '0.5'; i.min = '0'; i.className = 'inline'; i.style.width = '58px';
    i.value = ((n.pw || 0) * 100).toFixed(1);
    i.onclick = e => e.stopPropagation();
    i.onchange = () => { n.pw = (+i.value || 0) / 100; save(); render(); };
    wc.appendChild(i);
  } else wc.textContent = depth === 0 ? pct0(weight) : (weight * 100).toFixed(1) + '%';
  r.appendChild(wc);

  r.appendChild(el('div', '', `<span class="tag ${tagClass(st, late)}">${esc(st)}</span>`));
  r.appendChild(el('div', 'num r', pct0(pr)));
  r.appendChild(el('div', 'num duecell ' + (late ? 'late' : ''), d ? dLabel(d) : '—'));

  const act = el('div', 'r acts');
  if (editable) {
    const mk = (label, title, fn) => { const b = el('button', 'ib', label); b.title = title; b.onclick = e => { e.stopPropagation(); fn(); }; return b; };
    act.append(
      mk('+', 'Add an item underneath', () => addChild(p, n)),
      mk('=', 'Add an item alongside', () => addSibling(p, n)),
      mk('↑', 'Move up', () => moveNode(p, n, -1)),
      mk('↓', 'Move down', () => moveNode(p, n, 1)),
      mk('→', 'Make it a subtask of the item above', () => indentNode(p, n)),
      mk('←', 'Move it up a level', () => outdentNode(p, n)),
      mk('⧉', 'Copy this and everything under it', () => { UI.clip = { from: p.name, node: deepCopy(n) }; save(); render(); toast('Copied'); }),
      mk('×', 'Delete', () => deleteNode(p, n))
    );
    if (UI.clip) act.appendChild(mk('⇤', 'Paste the clipboard inside this item', () => pasteInto(p, n)));
  } else {
    const o = el('button', 'btn ghost sm', 'Open'); o.setAttribute('aria-label', 'Open');
    o.onclick = e => { e.stopPropagation(); openTask(p, n); };
    act.appendChild(o);
  }
  r.appendChild(act);

  const tg = r.querySelector('[data-tog]');
  if (tg) tg.onclick = e => { e.stopPropagation(); COLLAPSED[n.id] = !COLLAPSED[n.id]; renderTree(p, host); };
  if (!editable) r.onclick = () => openTask(p, n);
  return r;
}

/* ---------- task drawer ---------- */
function openTask(p, n) {
  if (!canSeeProject(p)) { toast('That project is not yours'); return; }
  const editable = canEdit(p), kids = !!(n.children && n.children.length);
  const map = indexProject(p), chain = []; let cur = map[n.id];
  while (cur) { chain.unshift(cur.n.name); cur = cur.parent ? map[cur.parent.id] : null; }
  const path = codePath(p, n.id);
  const d = openDrawerEl(dHead(p.name + (chain.length > 1 ? '  ›  ' + chain.slice(0, -1).join('  ›  ') : ''), n.name) + '<div class="dbody" id="db"></div>');
  wireClose(d);
  const hd = $('.dhead', d);
  hd.appendChild(el('div', 'row', `<span class="tag ${tagClass(statusOf(n), isLate(n))}">${esc(statusOf(n))}</span>
    <span class="sub num">${pct(progOf(n))} complete</span>${n.qty != null ? `<span class="sub num">Qty ${esc(n.qty)}</span>` : ''}
    ${editable ? '' : '<span class="tag idle">Read-only for you</span>'}`));
  const b = $('#db', d);

  if (canStructure(p, n)) {
    const det = el('div', 'dsec');
    det.innerHTML = `<h4>Details</h4>
      <label class="fld"><span>Name</span><input type="text" id="dName" value="${esc(n.name)}"></label>
      <div class="grid3">
        <label class="fld"><span>Quantity</span><input type="text" id="dQty" value="${esc(n.qty != null ? n.qty : '')}" placeholder="e.g. 750"></label>
        <label class="fld"><span>Unit</span><input type="text" id="dUnit" value="${esc(n.unit || '')}" placeholder="acres, MW, nos"></label>
        <label class="fld"><span>Weightage %</span><input type="number" id="dW" step="0.1" min="0" value="${((kids ? wOf(n) : (n.pw != null ? n.pw : n.w) || 0) * 100).toFixed(1)}" ${kids ? 'disabled' : ''}></label>
      </div>
      <label class="fld"><span>Description</span><textarea id="dDesc" rows="2" placeholder="What this covers, and what counts as finished">${esc(n.desc || '')}</textarea></label>`;
    b.appendChild(det);
    $('#dName', d).onchange = e => { n.name = e.target.value.trim() || n.name; save(); render(); };
    $('#dQty', d).onchange = e => { const v = e.target.value.trim(); if (v) n.qty = v; else delete n.qty; save(); };
    $('#dUnit', d).onchange = e => { n.unit = e.target.value.trim(); save(); };
    $('#dDesc', d).onchange = e => { n.desc = e.target.value.trim(); save(); };
    if (!kids) $('#dW', d).onchange = e => { const v = (+e.target.value || 0) / 100; if (n.pw != null) n.pw = v; else n.w = v; save(); render(); };
    if (kids) det.appendChild(el('div', 'sub', 'Weightage is the sum of the items underneath — change it on those.'));
  }

  const a = el('div', 'dsec');
  a.innerHTML = `<h4>Schedule</h4>
    <label class="fld"><span>Target date</span><input type="date" id="fDue" value="${esc(n.due || '')}" ${editable ? '' : 'disabled'}></label>
    ${n.s || n.f ? `<div class="sub">Baseline schedule ${mLabel(n.s)} → ${mLabel(n.f)}</div>` : ''}
    <div class="sub" style="margin-top:6px">Answerable for this: <b>${esc(pname(p.head) || 'nobody yet')}</b>, who owns ${esc(p.name)}.</div>`;
  b.appendChild(a);
  $('#fDue', d).onchange = e => { n.due = e.target.value || undefined; save(); render(); openTask(p, n); };

  if (!kids) {
    const pg = el('div', 'dsec');
    pg.innerHTML = `<h4>Progress</h4><div class="row"><input type="number" id="fPr" min="0" max="100" value="${Math.round(progOf(n) * 100)}" ${editable ? '' : 'disabled'} style="width:96px"><span class="sub">% complete — rolls up by weightage into the project number</span></div>`;
    b.appendChild(pg);
    $('#fPr', d).onchange = e => { n.prog = Math.max(0, Math.min(100, +e.target.value)) / 100; snapshot(p); save(); render(); openTask(p, n); };
  } else b.appendChild(el('div', 'dsec', `<h4>Progress</h4><div class="sub">Rolled up from ${n.children.length} items below.</div>`));

  /* ledger */
  const ls = el('div', 'dsec'); ls.innerHTML = `<h4>Status ledger — newest first</h4>`;
  if (n.log && n.log.length) {
    const ul = el('ul', 'ledger');
    n.log.forEach((e, i) => ul.appendChild(el('li', i === 0 ? 'top' : '',
      `<div class="when num">${dLabel(e.date)}</div><div class="what">${esc(e.status)}</div>${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}<div class="by">${esc(e.by)}${e.pct != null ? ' · set to ' + Math.round(e.pct * 100) + '%' : ''}</div>`)));
    ls.appendChild(ul);
  } else ls.appendChild(el('div', 'empty', 'No updates yet. Each new entry stacks on top of the last, so the full history stays visible.'));
  b.appendChild(ls);

  if (editable && !n.closed) {
    const f = el('div', 'dsec card pad');
    f.innerHTML = `<h4 style="border:0;margin-bottom:10px">Add an update</h4>
      <div class="grid2"><label class="fld"><span>Status</span><select id="uSt">${S.statuses.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
      <label class="fld"><span>Date</span><input type="date" id="uDt" value="${today()}"></label></div>
      <label class="fld"><span>Note</span><textarea id="uNo" rows="2" placeholder="e.g. Application filed with MPPTCL, ref 4471"></textarea></label>
      <label class="fld"><span>Set progress to</span><input type="number" id="uPr" min="0" max="100" placeholder="% — optional"></label>
      <div class="row"><button class="btn pri" id="uAdd">Record update</button><button class="btn" id="uClose">Close this task</button></div>`;
    b.appendChild(f);
    $('#uAdd', d).onclick = () => {
      const e = { date: $('#uDt', d).value || today(), status: $('#uSt', d).value, note: $('#uNo', d).value.trim(), by: pname(S.viewer) };
      const pv = $('#uPr', d).value;
      if (pv !== '') { e.pct = Math.max(0, Math.min(100, +pv)) / 100; if (!kids) n.prog = e.pct; }
      n.log = n.log || []; n.log.unshift(e); n.log.sort((x, y) => y.date.localeCompare(x.date));
      snapshot(p); save(); render(); openTask(p, n); toast('Update recorded');
    };
    $('#uClose', d).onclick = () => {
      n.progBefore = progOf(n); n.closed = true; n.closedOn = today(); n.log = n.log || [];
      n.log.unshift({ date: today(), status: 'Closed', note: 'Task closed', by: pname(S.viewer) });
      if (!kids) n.prog = 1; snapshot(p); save(); render(); openTask(p, n); toast('Task closed');
    };
  }
  if (n.closed && editable) {
    const rb = el('button', 'btn', 'Reopen task');
    rb.onclick = () => { n.closed = false; n.closedOn = null; if (n.progBefore != null) n.prog = n.progBefore; n.log.unshift({ date: today(), status: 'Reopened', note: '', by: pname(S.viewer) }); snapshot(p); save(); render(); openTask(p, n); };
    b.appendChild(rb);
  }

  /* changes — both directions */
  const linked = chgFor(p, path), projLevel = (p.chg || []).filter(x => !x.path);
  const cs = el('div', 'dsec'); cs.innerHTML = `<h4>Changes affecting this item</h4>`;
  if (!linked.length && !projLevel.length) cs.appendChild(el('div', 'empty', 'No changes recorded.'));
  linked.concat(projLevel).sort((a2, b2) => b2.date.localeCompare(a2.date)).forEach(x => {
    cs.appendChild(el('div', 'chg' + (x.path ? '' : ' proj'),
      `<div class="when num">${dLabel(x.date)} · ${esc(x.impact)}${x.path ? '' : ' · project-level'}</div>
       <div><b>${esc(x.item)}</b> <span class="num" style="font-size:12px">${esc(x.from || '—')} → ${esc(x.to || '—')}</span></div>
       ${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}<div class="sub">${esc(x.by)}</div>`));
  });
  if (editable) { const lc = el('button', 'btn sm', '+ Log a change here'); lc.onclick = () => editChange(p, path); cs.appendChild(lc); }
  b.appendChild(cs);

  /* CEO asks */
  const my = S.asks.filter(a2 => a2.projectId === p.id && a2.path === path);
  const ak = el('div', 'dsec'); ak.innerHTML = `<h4>With the CEO</h4>`;
  if (!my.length) ak.appendChild(el('div', 'empty', 'Nothing raised. Use the button below when this activity needs a CEO decision, signature or intervention.'));
  my.sort((a2, b2) => String(a2.by).localeCompare(String(b2.by))).forEach(a2 => {
    const r = el('div', 'chg'); r.style.borderLeftColor = a2.status === 'done' ? 'var(--line)' : 'var(--tangerine)';
    r.innerHTML = `<div class="when num">Needed by ${dLabel(a2.by)} · ${esc(a2.urgency)}${a2.status === 'done' ? ' · cleared' : ''}</div>
      <div><b>${esc(a2.title)}</b></div>${a2.note ? `<div class="note">${esc(a2.note)}</div>` : ''}<div class="sub">Raised by ${esc(a2.raisedBy)}</div>`;
    ak.appendChild(r);
  });
  if (editable) { const rb = el('button', 'btn sm', '+ Ask the CEO to act'); rb.onclick = () => editAsk(null, p.id, path); ak.appendChild(rb); }
  b.appendChild(ak);

  /* structure */
  if (canEdit(p, n)) {
    const s2 = el('div', 'dsec'); s2.innerHTML = `<h4>Structure</h4>`;
    const row = el('div', 'row');
    const mk = (label, title, fn, cls) => { const x = el('button', 'btn sm' + (cls ? ' ' + cls : ''), label); x.title = title || ''; x.onclick = fn; return x; };
    row.append(
      mk('+ Add subtask', 'Add an item underneath this one', () => addChild(p, n)),
      mk('+ Add alongside', 'Add a sibling just after this one', () => addSibling(p, n)),
      mk('Move up', '', () => moveNode(p, n, -1)),
      mk('Move down', '', () => moveNode(p, n, 1)),
      mk('Indent', 'Make it a subtask of the item above', () => indentNode(p, n)),
      mk('Outdent', 'Move it up one level', () => outdentNode(p, n)),
      mk('Copy', 'Copy this and everything under it', () => { UI.clip = { from: p.name, node: deepCopy(n) }; save(); render(); toast('Copied — open another project to paste'); })
    );
    const ps = mk('Paste inside', '', () => pasteInto(p, n)); ps.disabled = !UI.clip; row.appendChild(ps);
    row.appendChild(mk('Delete', 'Delete this and everything under it', () => deleteNode(p, n), 'ghost'));
    s2.appendChild(row);
    if (UI.clip) s2.appendChild(el('div', 'sub', `Clipboard holds “${esc(UI.clip.node.name)}” from ${esc(UI.clip.from)}.`));
    b.appendChild(s2);
  }
}
function deepCopy(n) {
  /* structure and weightage travel; dates, progress and history stay with the source project */
  return { id: uid(), code: n.code, name: n.name, w: n.w, pw: n.pw, qty: n.qty, unit: n.unit, desc: n.desc, prog: 0, log: [], children: (n.children || []).map(deepCopy) };
}
function pasteInto(p, parent) {
  if (!UI.clip) return;
  const node = deepCopy(UI.clip.node);
  const sibs = parent ? (parent.children = parent.children || []) : p.packages;
  if (!parent && node.pw == null) node.pw = 0;
  sibs.push(node); renumberProject(p); save(); render();
  toast(`Pasted “${node.name}” into ${p.name}`);
}
const addNode = (p, parent) => addChild(p, parent);

/* ---------- changes ---------- */
function myChangeSection(p, sc) {
  const list = (p.chg || []).filter(x => {
    if (!x.path) return false;                       /* project-wide notes stay with the lead */
    const n = findByPath(p, x.path);
    return n && sc && sc.own.has(n.id);
  }).sort((a, b) => b.date.localeCompare(a.date));
  const s = el('section', 'sect');
  s.innerHTML = `<header><h2>Changes affecting your work</h2><div class="sub">Scope changes logged against the activities assigned to you.</div></header>`;
  if (!list.length) { s.appendChild(el('div', 'empty', 'No changes have been logged against your activities.')); return s; }
  s.appendChild(tableOf(['Date', 'What changed', 'From → To', 'Type', 'Relates to', 'Logged by'],
    list.map(x => [`<span class="num">${dLabel(x.date)}</span>`,
    `<b>${esc(x.item)}</b>${x.note ? `<div class="sub">${esc(x.note)}</div>` : ''}`,
    `<span class="num" style="font-size:12.5px">${esc(x.from || '—')} → <b>${esc(x.to || '—')}</b></span>`,
    `<span class="tag idle">${esc(x.impact)}</span>`,
    `<span class="sub">${esc(labelForPath(x.path))}</span>`,
    `<span class="sub">${esc(x.by)}</span>`])));
  return s;
}
function changeSection(p) {
  const s = el('section', 'sect');
  const list = (p.chg || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  s.innerHTML = `<header><h2>Changes and revisions</h2><div class="sub">${list.length ? list.length + ' logged against this project' : 'Nothing logged against this project yet'} — scope changes are recorded separately from progress and show against the activity too.</div></header>`;
  const hd = $('header', s);
  const tog = el('button', 'btn sm', UI.showChanges ? 'Hide' : 'Show (' + list.length + ')');
  tog.onclick = () => { UI.showChanges = !UI.showChanges; save(); render(); };
  hd.appendChild(tog);
  if (!UI.showChanges) return s;
  const add = el('button', 'btn sm pri', '+ Log a change'); add.onclick = () => editChange(p, '');
  hd.appendChild(add);
  if (!list.length) { s.appendChild(el('div', 'empty', 'No changes logged. When a requirement moves — acreage, capacity, a substation — record it here so the reason and date stay with the project.')); return s; }
  s.appendChild(tableOf(['Date', 'What changed', 'From → To', 'Type', 'Relates to', 'Logged by'],
    list.map(x => [
      `<span class="num">${dLabel(x.date)}</span>`,
      `<b>${esc(x.item)}</b>${x.note ? `<div class="sub">${esc(x.note)}</div>` : ''}`,
      `<span class="num" style="font-size:12.5px">${esc(x.from || '—')} → <b>${esc(x.to || '—')}</b></span>`,
      `<span class="tag idle">${esc(x.impact)}</span>`,
      `<span class="sub">${x.path ? esc(labelForPath(x.path)) : 'Whole project'}</span>`,
      { html: `<span class="sub">${esc(x.by)}</span>`, act: isCEO() ? [['Delete', () => { if (confirm('Delete this change entry?')) { p.chg = p.chg.filter(y => y.id !== x.id); save(); render(); } }]] : [] }
    ])));
  return s;
}
function editChange(p, path) {
  const opts = templateNodes().map(t => `<option value="${esc(t.path)}" ${t.path === path ? 'selected' : ''}>${'— '.repeat(Math.min(t.depth, 3))}${esc(t.name)}</option>`).join('');
  const d = openDrawerEl(dHead(p.name, 'Log a change') + `<div class="dbody">
    <div class="grid2"><label class="fld"><span>Date</span><input type="date" id="cDt" value="${today()}"></label>
    <label class="fld"><span>Type</span><select id="cIm"><option>Scope</option><option>Schedule</option><option>Cost</option><option>Regulatory</option><option>Other</option></select></label></div>
    <label class="fld"><span>What changed</span><input type="text" id="cIt" placeholder="e.g. Land requirement"></label>
    <div class="grid2"><label class="fld"><span>From</span><input type="text" id="cFr" placeholder="1,500 acres"></label>
    <label class="fld"><span>To</span><input type="text" id="cTo" placeholder="1,800 acres"></label></div>
    <label class="fld"><span>Relates to</span><select id="cPa"><option value="">Whole project</option>${opts}</select></label>
    <label class="fld"><span>Reason</span><textarea id="cNo" rows="3" placeholder="Why it moved and what it affects"></textarea></label>
    <button class="btn pri" id="cAdd">Log change</button></div>`);
  wireClose(d);
  $('#cAdd', d).onclick = () => {
    const item = $('#cIt', d).value.trim(); if (!item) { toast('Name what changed'); return; }
    p.chg = p.chg || [];
    p.chg.unshift({ id: uid(), date: $('#cDt', d).value || today(), item, from: $('#cFr', d).value.trim(), to: $('#cTo', d).value.trim(), impact: $('#cIm', d).value, path: $('#cPa', d).value, note: $('#cNo', d).value.trim(), by: pname(S.viewer) });
    save(); closeDrawer(); render(); toast('Change logged');
  };
}
/* ---------- CEO asks ---------- */
function editAsk(a, pid, path) {
  const isNew = !a;
  a = a || { id: uid(), projectId: pid || '', path: path || '', title: '', note: '', urgency: 'Medium', by: addDays(today(), 7), raisedBy: pname(S.viewer), status: 'open', created: today() };
  const projOpts = '<option value="">Not assigned to a project</option>' + visibleProjects().map(p => `<option value="${p.id}" ${a.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const pathOpts = '<option value="">Whole project</option>' + templateNodes().map(t => `<option value="${esc(t.path)}" ${t.path === a.path ? 'selected' : ''}>${'— '.repeat(Math.min(t.depth, 3))}${esc(t.name)}</option>`).join('');
  const d = openDrawerEl(dHead('Dashboard', isNew ? 'Raise an item for the CEO' : 'Item with the CEO') + `<div class="dbody">
    <label class="fld"><span>What the CEO needs to do</span><input type="text" id="aTi" value="${esc(a.title)}" placeholder="e.g. Sign the LOA for the 220 kV bay"></label>
    <label class="fld"><span>Context</span><textarea id="aNo" rows="3" placeholder="Why it is stuck and what happens if it slips">${esc(a.note)}</textarea></label>
    <div class="grid2"><label class="fld"><span>Urgency</span><select id="aUr">${['High', 'Medium', 'Low'].map(u => `<option ${a.urgency === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
    <label class="fld"><span>Needed by</span><input type="date" id="aBy" value="${esc(a.by)}"></label></div>
    <label class="fld"><span>Project</span><select id="aPr">${projOpts}</select></label>
    <label class="fld"><span>Activity</span><select id="aPa">${pathOpts}</select></label>
    <div class="row"><button class="btn pri" id="aSave">${isNew ? 'Raise it' : 'Save'}</button>
    ${isNew ? '' : `<button class="btn" id="aDone">Mark done</button><button class="btn ghost" id="aDel">Delete</button>`}</div></div>`);
  wireClose(d);
  $('#aSave', d).onclick = () => {
    const t = $('#aTi', d).value.trim(); if (!t) { toast('Say what the CEO needs to do'); return; }
    Object.assign(a, { title: t, note: $('#aNo', d).value.trim(), urgency: $('#aUr', d).value, by: $('#aBy', d).value, projectId: $('#aPr', d).value, path: $('#aPa', d).value });
    if (isNew) S.asks.unshift(a);
    save(); closeDrawer(); render(); toast(isNew ? 'Raised with the CEO' : 'Saved');
  };
  if (!isNew) {
    $('#aDone', d).onclick = () => { a.status = 'done'; save(); closeDrawer(); render(); toast('Cleared'); };
    $('#aDel', d).onclick = () => { S.asks = S.asks.filter(x => x.id !== a.id); save(); closeDrawer(); render(); };
  }
}

/* ===================== ACTIVITIES ===================== */
function viewActivities() {
  $('#crumb').textContent = 'Deliver'; $('#title').textContent = 'Activities';
  const ta = $('#topActions'); ta.innerHTML = ''; ta.appendChild(lens('activities'));
  const v = $('#view'); v.innerHTML = '';
  const opts = templateNodes();
  if (!opts.length) {
    v.appendChild(el('div', 'empty', 'No activities are assigned to you yet.'));
    return;
  }
  let path = UI.across;
  if (!opts.some(t => t.path === path)) path = opts[0].path;

  const bar = el('div', 'toolbar'); bar.style.marginBottom = '18px';
  const sel = el('select'); sel.style.maxWidth = '460px';
  sel.innerHTML = opts.map(t => `<option value="${esc(t.path)}" ${t.path === path ? 'selected' : ''}>${'— '.repeat(Math.min(t.depth, 3))}${esc(t.name)}</option>`).join('');
  sel.onchange = () => { UI.across = sel.value; save(); render(); };
  bar.appendChild(sel);
  quickPaths().filter(c => opts.some(t => t.path === c)).forEach(code => {
    const t = templateNodes().find(x => x.path === code); if (!t) return;
    const b = el('button', 'btn sm' + (path === code ? ' pri' : ''), trim(t.name, 22));
    b.onclick = () => { UI.across = code; save(); render(); }; bar.appendChild(b);
  });
  v.appendChild(bar);

  const rows = visibleProjects().map(p => ({ p, n: findByPath(p, path) })).filter(r => r.n);
  if (!isCEO()) v.appendChild(el('div', 'scopenote', 'The projects you own.'));
  if (!rows.length) { v.appendChild(el('div', 'empty', 'No project has this activity.')); return; }
  const avg = rows.reduce((a, r) => a + progOf(r.n), 0) / rows.length;
  const done = rows.filter(r => r.n.closed || progOf(r.n) >= 1).length, late = rows.filter(r => isLate(r.n)).length, ns = rows.filter(r => progOf(r.n) === 0 && !r.n.closed).length;
  const m = el('div', 'metrics'); m.style.marginBottom = '26px';
  m.innerHTML = `<div class="metric"><div class="eyebrow">Average progress</div><div class="v">${pct(avg)}</div><div class="l">Across ${rows.length} projects</div></div>
    <div class="metric"><div class="eyebrow">Complete</div><div class="v">${done}</div><div class="l">Finished or closed</div></div>
    <div class="metric"><div class="eyebrow">Not started</div><div class="v">${ns}</div><div class="l">No progress recorded</div></div>
    <div class="metric"><div class="eyebrow">Past due</div><div class="v">${late}</div><div class="l">Target date already gone</div></div>`;
  v.appendChild(m);

  v.appendChild(section(labelForPath(path), 'Sorted by progress. Open a row to see that project’s ledger and changes.',
    tableOf(['Project', 'Owner', 'Status', 'Progress', 'Target', 'Last update', 'Changes'],
      rows.sort((a, b) => progOf(b.n) - progOf(a.n)).map(r => {
        const last = (r.n.log || [])[0], pr = progOf(r.n);
        return [
          { link: [r.p.name, () => { PID = r.p.id; VIEW = 'project'; render(); openTask(r.p, r.n); }], html: `<div class="sub">${esc([r.p.site, r.p.state].filter(Boolean).join(', '))}</div>` },
          `<span class="sub">${esc(pname(r.p.head))}</span>`,
          `<span class="tag ${tagClass(statusOf(r.n), isLate(r.n))}">${esc(statusOf(r.n))}</span>`,
          `<div class="bar" style="min-width:110px"><i style="width:${Math.min(100, pr * 100)}%"></i></div><div class="num" style="font-size:11px;margin-top:3px">${pct0(pr)}</div>`,
          `<span class="num ${isLate(r.n) ? 'late' : ''}">${due(r.n) ? dLabel(due(r.n)) : '—'}</span>`,
          `<span class="sub">${last ? esc(last.status) + ' · ' + dLabel(last.date) : '—'}</span>`,
          `<span class="num">${chgFor(r.p, path).length || '—'}</span>`
        ];
      }))));
}

/* ===================== OFFTAKE ===================== */
const STAGES = { 'Utility': ['Identified', 'Bid filed', 'Bid won', 'PPA signed', 'Dropped'], 'C&I': ['Initial negotiation', 'MoU', 'Term sheet', 'PPA signed', 'Dropped'], 'Captive': ['Initial negotiation', 'MoU', 'Term sheet', 'PPA signed', 'Dropped'] };
function viewOfftake() {
  $('#crumb').textContent = 'Secure'; $('#title').textContent = 'Offtake & PPA';
  const ta = $('#topActions'); ta.innerHTML = '';
  const b = el('button', 'btn pri', '+ Add a deal'); b.onclick = () => editDeal(null); ta.appendChild(b);
  const v = $('#view'); v.innerHTML = '';
  const talks = S.deals.reduce((a, d) => a + (+d.capTalks || 0), 0);
  const fin = S.deals.reduce((a, d) => a + (+d.capFinal || 0), 0);
  const unass = S.deals.filter(d => !d.projectId).length;
  const m = el('div', 'metrics'); m.style.marginBottom = '28px';
  m.innerHTML = `<div class="metric"><div class="eyebrow">Capacity in talks</div><div class="v">${talks}<small>MW</small></div><div class="l">Across ${S.deals.length} conversations</div></div>
    <div class="metric"><div class="eyebrow">Capacity finalised</div><div class="v">${fin}<small>MW</small></div><div class="l">${S.deals.filter(d => d.capTBD).length} still to be decided</div></div>
    <div class="metric"><div class="eyebrow">Not assigned to a project</div><div class="v">${unass}</div><div class="l">Offtake ahead of a site</div></div>
    <div class="metric"><div class="eyebrow">PPAs signed</div><div class="v">${S.deals.filter(d => d.stage === 'PPA signed').length}</div><div class="l">Of ${S.deals.length} deals</div></div>`;
  v.appendChild(m);

  ['Utility', 'C&I', 'Captive'].forEach(type => {
    const list = S.deals.filter(d => d.type === type);
    const heads = type === 'Utility'
      ? ['Utility / DISCOM', 'State', 'Project', 'In talks', 'Finalised', 'Participate', 'Tariff', 'Bid filing', 'Bid decision', 'Stage']
      : ['Customer', 'State', 'Project', 'In talks', 'Finalised', 'Stage', 'Owner', 'Last updated'];
    const rows = list.map(d => {
      const pj = d.projectId ? (proj(d.projectId) || {}).name : 'Not assigned';
      const capF = d.capTBD ? '<span class="sub">yet to be decided</span>' : `<span class="num">${d.capFinal || 0} MW</span>`;
      const base = [
        { link: [d.counterparty || '(unnamed)', () => editDeal(d)], html: `<div class="sub">${esc(pname(d.owner))}</div>` },
        esc(d.state || '—'),
        `<span class="tag ${d.projectId ? 'info' : 'idle'}">${esc(pj)}</span>`,
        `<span class="num">${d.capTalks || 0} MW</span>`, capF
      ];
      return type === 'Utility'
        ? base.concat([
          `<span class="tag ${d.participate === 'Yes' ? 'ok' : d.participate === 'No' ? 'idle' : 'watch'}">${esc(d.participate || 'To decide')}</span>`,
          d.tariffDecided === 'Yes' ? `<span class="num">${esc(d.tariff || '—')}</span>` : '<span class="sub">not decided</span>',
          `<span class="num ${d.bidFile && d.bidFile < today() ? '' : ''}">${dLabel(d.bidFile)}</span>`,
          `<span class="num">${dLabel(d.bidDecide)}</span>`,
          `<span class="tag ${d.stage === 'PPA signed' ? 'go' : d.stage === 'Dropped' ? 'idle' : 'ok'}">${esc(d.stage)}</span>`])
        : base.concat([
          `<span class="tag ${d.stage === 'PPA signed' ? 'go' : d.stage === 'Dropped' ? 'idle' : 'ok'}">${esc(d.stage)}</span>`,
          `<span class="sub">${esc(pname(d.owner))}</span>`, `<span class="num">${dLabel(d.updated)}</span>`]);
    });
    v.appendChild(section(type === 'C&I' ? 'C&I customers' : type === 'Utility' ? 'Utility bids' : 'Captive',
      type === 'Utility' ? 'Participation call, tariff and the two dates that matter: filing and decision.' : 'Initial negotiation → MoU → term sheet → PPA.',
      list.length ? tableOf(heads, rows) : el('div', 'empty', `No ${type} deals yet. Use “Add a deal”.`)));
  });
}
function editDeal(d) {
  const isNew = !d;
  d = d || { id: uid(), counterparty: '', type: 'Utility', state: '', projectId: '', capTalks: 0, capFinal: 0, capTBD: true, participate: 'To decide', tariffDecided: 'No', tariff: '', bidFile: '', bidDecide: '', stage: 'Identified', owner: '', note: '', updated: today() };
  const dr = openDrawerEl(dHead('Offtake & PPA', isNew ? 'Add a deal' : d.counterparty || 'Deal') + '<div class="dbody" id="db"></div>');
  wireClose(dr);
  const b = $('#db', dr);
  const draw = () => {
    b.innerHTML = `
      <div class="grid2">
        <label class="fld"><span>Type</span><select id="tType">${['Utility', 'C&I', 'Captive'].map(t => `<option ${d.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="fld"><span>State</span><input type="text" id="tState" value="${esc(d.state)}" placeholder="e.g. Gujarat"></label>
      </div>
      <label class="fld"><span>${d.type === 'Utility' ? 'Utility / DISCOM' : 'Customer name'}</span><input type="text" id="tCp" value="${esc(d.counterparty)}"></label>
      <label class="fld"><span>Project assignment</span><select id="tPr"><option value="">Not assigned</option>
        ${S.projects.map(p => `<option value="${p.id}" ${d.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <div class="grid2">
        <label class="fld"><span>Capacity in talks (MW)</span><input type="number" id="tTalks" value="${d.capTalks || 0}"></label>
        <label class="fld"><span>Capacity finalised (MW)</span><input type="number" id="tFin" value="${d.capFinal || 0}" ${d.capTBD ? 'disabled' : ''}></label>
      </div>
      <label class="row" style="margin-bottom:14px"><input type="checkbox" id="tTBD" ${d.capTBD ? 'checked' : ''} style="width:auto"><span class="sub">Final capacity yet to be decided</span></label>
      ${d.type === 'Utility' ? `
      <div class="grid2">
        <label class="fld"><span>Participate</span><select id="tPart">${['Yes', 'No', 'To decide'].map(x => `<option ${d.participate === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="fld"><span>Tariff decided</span><select id="tTd">${['Yes', 'No'].map(x => `<option ${d.tariffDecided === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      </div>
      <label class="fld"><span>Tariff (₹/kWh)</span><input type="text" id="tTar" value="${esc(d.tariff)}" placeholder="e.g. 2.64"></label>
      <div class="grid2">
        <label class="fld"><span>Bid filing date</span><input type="date" id="tBf" value="${esc(d.bidFile)}"></label>
        <label class="fld"><span>Bid decision date</span><input type="date" id="tBd" value="${esc(d.bidDecide)}"></label>
      </div>` : ''}
      <div class="grid2">
        <label class="fld"><span>Stage</span><select id="tStage">${(STAGES[d.type] || []).map(s => `<option ${d.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="fld"><span>Owner</span><select id="tOwn"><option value="">—</option>${S.org.map(o => `<option value="${o.id}" ${d.owner === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      </div>
      <label class="fld"><span>Notes</span><textarea id="tNo" rows="3">${esc(d.note)}</textarea></label>
      <div class="row"><button class="btn pri" id="tSave">${isNew ? 'Add deal' : 'Save'}</button>${isNew ? '' : '<button class="btn ghost" id="tDel">Delete</button>'}</div>`;
    $('#tType', b).onchange = e => { d.type = e.target.value; d.stage = (STAGES[d.type] || [''])[0]; draw(); };
    $('#tTBD', b).onchange = e => { d.capTBD = e.target.checked; draw(); };
    $('#tSave', b).onclick = () => {
      Object.assign(d, {
        counterparty: $('#tCp', b).value.trim(), state: $('#tState', b).value.trim(), projectId: $('#tPr', b).value,
        capTalks: +$('#tTalks', b).value || 0, capFinal: d.capTBD ? 0 : (+$('#tFin', b).value || 0),
        stage: $('#tStage', b).value, owner: $('#tOwn', b).value, note: $('#tNo', b).value.trim(), updated: today()
      });
      if (d.type === 'Utility') Object.assign(d, { participate: $('#tPart', b).value, tariffDecided: $('#tTd', b).value, tariff: $('#tTar', b).value.trim(), bidFile: $('#tBf', b).value, bidDecide: $('#tBd', b).value });
      if (!d.counterparty) { toast('Give the counterparty a name'); return; }
      if (isNew) S.deals.unshift(d);
      save(); closeDrawer(); render(); toast(isNew ? 'Deal added' : 'Saved');
    };
    if (!isNew) $('#tDel', b).onclick = () => { if (confirm('Delete this deal?')) { S.deals = S.deals.filter(x => x.id !== d.id); save(); closeDrawer(); render(); } };
  };
  draw();
}

/* ===================== ENABLERS ===================== */
function viewEnablers() {
  $('#crumb').textContent = 'Secure'; $('#title').textContent = 'Enablers';
  const ta = $('#topActions'); ta.innerHTML = '';
  const b = el('button', 'btn pri', '+ Add an enabler'); b.onclick = () => editEnabler(null); ta.appendChild(b);
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(el('p', 'sub', 'Things the CEO has to clear that sit above any single project — consultant appointments, approvals, and new opportunities. Each one has an end date and an owner.')).style.marginBottom = '18px';
  const groups = {};
  S.enablers.forEach(e => (groups[e.kind || 'Other'] = groups[e.kind || 'Other'] || []).push(e));
  Object.keys(groups).sort().forEach(k => {
    const list = groups[k].sort((a, b2) => String(a.end || '9').localeCompare(String(b2.end || '9')));
    v.appendChild(section(k, k === 'Consultant appointment' ? 'Purpose, firm and the date the appointment must be closed.' : k === 'Approval' ? 'Statutory and shareholder approvals.' : 'Opportunities being evaluated.',
      tableOf(['Task to be done', 'For what', 'Purpose', 'Counterparty', 'Owner', 'End date', 'Status'],
        list.map(e => ({ cls: e.status === 'Done' ? 'done' : '', cells: [
          { link: [e.title, () => editEnabler(e)] },
          `<span class="tag idle">${esc(e.forWhat || '—')}</span>`,
          `<span class="sub">${esc(trim(e.purpose || '—', 64))}</span>`,
          esc(e.party || '—'), esc(pname(e.owner)),
          `<span class="num ${e.end && e.end < today() && e.status !== 'Done' ? 'late' : ''}">${dLabel(e.end)}</span>`,
          `<span class="tag ${e.status === 'Done' ? 'done' : e.status === 'In progress' ? 'ok' : 'idle'}">${esc(e.status)}</span>`
        ] })))));
  });
}
function editEnabler(e) {
  const isNew = !e;
  e = e || { id: uid(), title: '', kind: 'Approval', forWhat: 'Shared functions', purpose: '', party: '', owner: '', end: '', status: 'Not started', note: '' };
  const forOpts = ['Shared functions', 'C&I', 'Utility', 'New geography'].concat(S.projects.map(p => p.name));
  const d = openDrawerEl(dHead('Enablers', isNew ? 'Add an enabler' : e.title) + `<div class="dbody">
    <label class="fld"><span>Task to be done</span><input type="text" id="eTi" value="${esc(e.title)}" placeholder="e.g. Consultant appointment"></label>
    <div class="grid2"><label class="fld"><span>Kind</span><select id="eKi">${['Consultant appointment', 'Approval', 'Opportunity', 'Other'].map(k => `<option ${e.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <label class="fld"><span>For what</span><select id="eFo">${forOpts.map(f => `<option ${e.forWhat === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label></div>
    <label class="fld"><span>Purpose</span><textarea id="ePu" rows="2" placeholder="What it is for">${esc(e.purpose)}</textarea></label>
    <div class="grid2"><label class="fld"><span>Consultant / authority</span><input type="text" id="ePa" value="${esc(e.party)}"></label>
    <label class="fld"><span>Owner</span><select id="eOw"><option value="">—</option>${S.org.map(o => `<option value="${o.id}" ${e.owner === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label></div>
    <div class="grid2"><label class="fld"><span>End date</span><input type="date" id="eEn" value="${esc(e.end)}"></label>
    <label class="fld"><span>Status</span><select id="eSt">${['Not started', 'In progress', 'Done'].map(s => `<option ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
    <label class="fld"><span>Notes</span><textarea id="eNo" rows="3">${esc(e.note)}</textarea></label>
    <div class="row"><button class="btn pri" id="eSave">${isNew ? 'Add' : 'Save'}</button>${isNew ? '' : '<button class="btn ghost" id="eDel">Delete</button>'}</div></div>`);
  wireClose(d);
  $('#eSave', d).onclick = () => {
    const t = $('#eTi', d).value.trim(); if (!t) { toast('Name the task'); return; }
    const wasDone = e.status === 'Done', nowStatus = $('#eSt', d).value;
    Object.assign(e, { title: t, kind: $('#eKi', d).value, forWhat: $('#eFo', d).value, purpose: $('#ePu', d).value.trim(), party: $('#ePa', d).value.trim(), owner: $('#eOw', d).value, end: $('#eEn', d).value, status: nowStatus, note: $('#eNo', d).value.trim() });
    if (nowStatus === 'Done' && !wasDone) e.doneOn = today();
    if (nowStatus !== 'Done') e.doneOn = null;
    if (isNew) S.enablers.push(e);
    save(); closeDrawer(); render(); toast(isNew ? 'Enabler added' : 'Saved');
  };
  if (!isNew) $('#eDel', d).onclick = () => { if (confirm('Delete this enabler?')) { S.enablers = S.enablers.filter(x => x.id !== e.id); save(); closeDrawer(); render(); } };
}

/* ===================== SIGN IN ===================== */
function orgByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !S) return null;
  return (S.org || []).find(p => (p.email || '').trim().toLowerCase() === e) || null;
}
async function signOut() {
  try { await api('POST', '/api/auth/logout'); } catch (e) { }
  S = null; REV = 0; ME = null; VIEW = 'dashboard'; PID = null;
  showLogin('');
}

let LOGIN = { email: '', name: '', mode: 'email', hint: '' };

function showLogin(msg, mode) {
  document.body.classList.add('locked');
  let host = document.getElementById('login');
  if (!host) { host = el('div', '', ''); host.id = 'login'; document.body.appendChild(host); }
  LOGIN.mode = mode || 'email';

  const screens = {
    email: `
      <p class="sub">Sign in with your organisation email address.</p>
      <label class="fld"><span>Email</span><input type="email" id="liEmail" placeholder="you@company.com" autocomplete="username" value="${esc(LOGIN.email)}"></label>
      <button class="btn pri" id="liNext" style="width:100%">Continue</button>`,
    password: `
      <p class="sub">Welcome back, ${esc(LOGIN.name)}. Enter your password.</p>
      <label class="fld"><span>Password</span><input type="password" id="liPw" autocomplete="current-password" placeholder="Your password"></label>
      <button class="btn pri" id="liGo" style="width:100%">Sign in</button>
      <button class="btn ghost" id="liBack" style="width:100%;margin-top:8px">Use a different address</button>
      <div class="loginhint">Forgotten it? Ask the CEO to issue a new invite code from the Organisation page — that resets your password.</div>`,
    code: `
      <p class="sub">A six-digit code is on its way to <b>${esc(LOGIN.email)}</b>. It lasts ten minutes.</p>
      <label class="fld"><span>Code</span><input type="text" id="liCode" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"></label>
      <button class="btn pri" id="liGo" style="width:100%">Sign in</button>
      <button class="btn ghost" id="liBack" style="width:100%;margin-top:8px">Use a different address</button>`,
    invite: `
      <p class="sub">First time in, ${esc(LOGIN.name)}. Enter the invite code the CEO gave you, then choose a password you will remember.</p>
      <label class="fld"><span>Invite code</span><input type="text" id="liInvite" placeholder="ABCD-2345" autocomplete="one-time-code" style="letter-spacing:.12em;text-transform:uppercase"></label>
      <label class="fld"><span>Choose a password</span><input type="password" id="liNew" autocomplete="new-password" placeholder="At least 8 characters"></label>
      <label class="fld"><span>Type it again</span><input type="password" id="liNew2" autocomplete="new-password"></label>
      <button class="btn pri" id="liGo" style="width:100%">Set my password and sign in</button>
      <button class="btn ghost" id="liBack" style="width:100%;margin-top:8px">Use a different address</button>`
  };

  host.innerHTML = `
    <div class="loginbox">
      <div class="loginbrand"><b>Terra Clean</b><span>Control tower</span></div>
      <h2>Sign in</h2>
      ${screens[LOGIN.mode]}
      <div id="liMsg" class="loginmsg">${msg ? esc(msg) : ''}</div>
      ${LOGIN.hint && LOGIN.mode !== 'email' ? `<div class="loginhint">${esc(LOGIN.hint)}</div>` : ''}
    </div>`;
  host.style.display = 'flex';

  const say = t => { const m = document.getElementById('liMsg'); if (m) m.textContent = t; };
  const back = document.getElementById('liBack');
  if (back) back.onclick = () => { LOGIN.hint = ''; showLogin('', 'email'); };
  const onEnter = (id, fn) => { const n = document.getElementById(id); if (n) n.onkeydown = e => { if (e.key === 'Enter') fn(); }; };

  if (LOGIN.mode === 'email') {
    const next = async () => {
      const v = document.getElementById('liEmail').value.trim();
      if (!v) return;
      LOGIN.email = v; say('Checking…');
      try {
        const out = await api('POST', '/api/auth/start', { email: v });
        LOGIN.name = out.name || ''; LOGIN.hint = out.hint || '';
        showLogin('', out.mode);
      } catch (e) { say(e.message); }
    };
    document.getElementById('liNext').onclick = next;
    onEnter('liEmail', next);
    document.getElementById('liEmail').focus();
    return;
  }

  const go = async () => {
    try {
      if (LOGIN.mode === 'password') {
        const pw = document.getElementById('liPw').value;
        if (!pw) return;
        say('Checking…');
        await api('POST', '/api/auth/password', { email: LOGIN.email, password: pw });
      } else if (LOGIN.mode === 'code') {
        const code = document.getElementById('liCode').value.trim();
        if (!code) return;
        say('Checking…');
        await api('POST', '/api/auth/code', { email: LOGIN.email, code });
      } else {
        const invite = document.getElementById('liInvite').value.trim();
        const p1 = document.getElementById('liNew').value, p2 = document.getElementById('liNew2').value;
        if (!invite || !p1) return;
        if (p1 !== p2) { say('The two passwords do not match.'); return; }
        say('Setting up…');
        await api('POST', '/api/auth/invite', { email: LOGIN.email, invite, password: p1 });
      }
      host.style.display = 'none';
      document.body.classList.remove('locked');
      await boot();
    } catch (e) { say(e.message); }
  };
  document.getElementById('liGo').onclick = go;
  ['liPw', 'liCode', 'liNew2', 'liInvite', 'liNew'].forEach(id => onEnter(id, go));
  const first = document.querySelector('#login input');
  if (first) first.focus();
}

/* ===================== ORGANISATION ===================== */
function viewOrg() {
  $('#crumb').textContent = 'Record'; $('#title').textContent = 'Organisation';
  const ta = $('#topActions'); ta.innerHTML = '';
  const add = el('button', 'btn pri', '+ Add a person');
  add.onclick = () => editPerson(null);
  ta.appendChild(add);
  const v = $('#view'); v.innerHTML = '';

  const t = el('table', 'tbl orgtbl');
  t.innerHTML = '<thead><tr><th>E. No.</th><th>Name</th><th>Design.</th><th>I.Com</th><th>Mobile no.</th><th>Mail address</th>' +
    '<th>Sign-in</th><th class="c">Full rights</th><th class="r">Projects</th><th></th></tr></thead>';
  const tb = el('tbody');
  S.org.forEach(o => {
    const tr = el('tr');
    const cell = (val, cls) => { const td = el('td', cls || ''); td.textContent = val || '—'; return td; };
    tr.appendChild(cell(o.empNo, 'num sub'));
    const nm = el('td');
    const lk = el('button', 'linkish', esc(o.name || '(unnamed)'));
    lk.onclick = () => editPerson(o);
    nm.appendChild(lk);
    tr.appendChild(nm);
    tr.appendChild(cell(o.designation, 'sub'));
    tr.appendChild(cell(o.icom, 'num sub'));
    tr.appendChild(cell(o.mobile, 'num sub'));
    tr.appendChild(cell(o.email, 'sub'));
    tr.appendChild(cell((o.signin || (o.admin ? 'code' : 'password')) === 'code' ? 'One-time code' : 'Password', 'sub'));
    tr.appendChild(el('td', 'c', o.admin ? '<span class="tag ok">Yes</span>' : '<span class="sub">—</span>'));
    tr.appendChild(cell(String(countAssigned(o.id)), 'num r'));

    const act = el('td', 'r');
    if (o.email && (o.signin || (o.admin ? 'code' : 'password')) === 'password') {
      const s = el('button', 'btn ghost sm', 'Send login');
      s.title = 'Set a password and hand you the message to send them';
      s.onclick = () => sendLogin(o);
      act.appendChild(s);
    }
    const e = el('button', 'btn ghost sm', 'Edit');
    e.onclick = () => editPerson(o);
    act.appendChild(e);
    tr.appendChild(act);
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  v.appendChild(section('Directory', 'The email address is the login. Add someone, make them a project owner, then send them their login.', t));

  /* --- import --- */
  const imp = el('div');
  imp.innerHTML = `<p class="sub" style="margin-top:0">Load the list straight from your sheet. Use these column headings, in any order:</p>
    <div class="fmtline">E. No. │ Name (S/Shri/ Ms) │ Design. │ I.Com │ Mobile no. │ Mail address</div>
    <p class="sub">An .xlsx file, a .csv, or cells copied out of Excel all work. Matching is by mail address — an address already here is updated, a new one is added, nothing is deleted.</p>`;
  const row = el('div', 'row');
  const fi = el('input'); fi.type = 'file'; fi.accept = '.xlsx,.csv,.txt'; fi.style.display = 'none';
  const pick = el('button', 'btn pri', 'Choose an Excel or CSV file'); pick.onclick = () => fi.click();
  const tpl = el('button', 'btn', 'Download the template');
  tpl.onclick = () => {
    const csv = 'E. No.,Name (S/Shri/ Ms),Design.,I.Com,Mobile no.,Mail address\n' +
      '10234,Shri A K Sharma,DGM (Land),2345,98100 00000,ak.sharma@indianoil.in\n';
    const a2 = document.createElement('a');
    a2.href = window.URL['createObjectURL'](new Blob([csv], { type: 'text/csv' }));
    a2.download = 'terraclean-organisation-template.csv'; a2.click();
  };
  row.append(pick, tpl, fi);
  imp.appendChild(row);
  const paste = el('textarea'); paste.rows = 4; paste.placeholder = '…or select the cells in Excel, copy, and paste them here';
  paste.style.marginTop = '12px';
  const pb = el('button', 'btn', 'Read what I pasted'); pb.style.marginTop = '8px';
  const out = el('div'); out.style.marginTop = '10px';
  imp.append(paste, pb, out);

  const ingest = rows => {
    const res = mergeOrg(rows);
    out.innerHTML = '';
    if (res.err) { out.appendChild(el('div', 'empty', res.err)); return; }
    save(); render();
    toast(res.added + ' added, ' + res.updated + ' updated');
  };
  pb.onclick = () => { const rows = parseDelimited(paste.value, paste.value.indexOf('\t') >= 0 ? '\t' : ','); ingest(rows); };
  fi.onchange = async () => {
    const f = fi.files[0]; if (!f) return;
    out.innerHTML = '<div class="sub">Reading…</div>';
    try {
      let rows;
      if (/\.xlsx$/i.test(f.name)) rows = await readXlsx(await f.arrayBuffer());
      else { const txt = await f.text(); rows = parseDelimited(txt, txt.indexOf('\t') >= 0 && txt.indexOf(',') < 0 ? '\t' : ','); }
      ingest(rows);
    } catch (e) {
      out.innerHTML = '';
      out.appendChild(el('div', 'empty', 'That file could not be read (' + (e.message || e) + '). Save it again as .xlsx or .csv, or copy the cells and paste them below.'));
    }
  };
  v.appendChild(section('Load the list from your sheet', '', imp));
}

/* Adding or editing somebody happens in a panel, not by typing into a blank row. */
function editPerson(o) {
  const isNew = !o;
  o = o || { id: uid(), empNo: '', name: '', designation: '', icom: '', mobile: '', email: '', dept: '', admin: false, signin: 'password' };
  const d = openDrawerEl(dHead('Organisation', isNew ? 'Add a person' : o.name || 'Person') + '<div class="dbody" id="db"></div>');
  wireClose(d);
  const b = document.getElementById('db');
  b.innerHTML = `
    <div class="grid2">
      <label class="fld"><span>E. No.</span><input type="text" id="fNo" value="${esc(o.empNo || '')}"></label>
      <label class="fld"><span>Design.</span><input type="text" id="fDes" value="${esc(o.designation || '')}" placeholder="e.g. DGM (Land)"></label>
    </div>
    <label class="fld"><span>Name (S/Shri/ Ms)</span><input type="text" id="fName" value="${esc(o.name || '')}" placeholder="Shri A K Sharma"></label>
    <div class="grid2">
      <label class="fld"><span>I.Com</span><input type="text" id="fIcom" value="${esc(o.icom || '')}"></label>
      <label class="fld"><span>Mobile no.</span><input type="text" id="fMob" value="${esc(o.mobile || '')}"></label>
    </div>
    <label class="fld"><span>Mail address — this is their login</span><input type="text" id="fMail" value="${esc(o.email || '')}" placeholder="name@indianoil.in"></label>
    <div class="grid2">
      <label class="fld"><span>How they sign in</span><select id="fSign">
        <option value="password" ${(o.signin || 'password') === 'password' ? 'selected' : ''}>Password — you send it to them</option>
        <option value="code" ${o.signin === 'code' ? 'selected' : ''}>One-time code by email</option>
      </select></label>
      <label class="fld"><span>Full rights</span><select id="fAdmin">
        <option value="no" ${o.admin ? '' : 'selected'}>No — only their own projects</option>
        <option value="yes" ${o.admin ? 'selected' : ''}>Yes — the whole portfolio</option>
      </select></label>
    </div>`;
  const row = el('div', 'row');
  const ok = el('button', 'btn pri', isNew ? 'Add' : 'Save');
  ok.onclick = () => {
    const name = document.getElementById('fName').value.trim();
    if (!name) { toast('Give them a name'); return; }
    Object.assign(o, {
      empNo: document.getElementById('fNo').value.trim(),
      name, designation: document.getElementById('fDes').value.trim(),
      icom: document.getElementById('fIcom').value.trim(),
      mobile: document.getElementById('fMob').value.trim(),
      email: document.getElementById('fMail').value.trim(),
      signin: document.getElementById('fSign').value,
      admin: document.getElementById('fAdmin').value === 'yes'
    });
    if (o.admin && !o.email) { o.admin = false; toast('Full rights need an email address — that is the login'); }
    if (isNew) S.org.push(o);
    save(); closeDrawer(); render();
    toast(isNew ? 'Added' : 'Saved');
  };
  row.appendChild(ok);
  if (!isNew) {
    if (o.email && (o.signin || 'password') === 'password') {
      const sl = el('button', 'btn', 'Send them their login');
      sl.onclick = () => sendLogin(o);
      row.appendChild(sl);
    }
    const del = el('button', 'btn ghost', 'Remove');
    del.disabled = o.id === S.viewer;
    del.onclick = () => {
      if (!confirm('Remove ' + o.name + '? Any project they own becomes unowned.')) return;
      S.org = S.org.filter(q => q.id !== o.id);
      S.projects.forEach(p => { if (p.head === o.id) p.head = ''; });
      S.tasks.forEach(z => { if (z.owner === o.id) z.owner = ''; });
      save(); closeDrawer(); render();
    };
    row.appendChild(del);
  }
  b.appendChild(row);
}

/* Sets a password and hands over the message — no invite step, nothing for
   them to choose before they can get in. */
function sendLogin(o) {
  api('POST', '/api/org/login-mail', { personId: o.id })
    .then(r => {
      const d = openDrawerEl(dHead('Organisation', 'Login for ' + esc(o.name)) + '<div class="dbody" id="db"></div>');
      wireClose(d);
      const b = document.getElementById('db');
      b.innerHTML = `<p class="sub" style="margin-top:0">A password has been set. Send them this — it is everything they need.</p>
        <div class="loginpair">
          <div><span>Link</span><b>${esc(location.origin)}</b></div>
          <div><span>Login</span><b>${esc(r.to)}</b></div>
          <div><span>Password</span><b class="pw">${esc(r.password)}</b></div>
        </div>
        <div class="draftbox"><b>${esc(r.subject)}</b><pre>${esc(r.text)}</pre></div>`;
      const row = el('div', 'row');
      const mail = el('button', 'btn pri', 'Open a draft in my mail app');
      mail.onclick = () => openDraft(r);
      const copy = el('button', 'btn', 'Copy the message');
      copy.onclick = () => navigator.clipboard.writeText(r.subject + '\n\n' + r.text)
        .then(() => toast('Copied'), () => toast('Could not copy'));
      row.append(mail, copy);
      b.appendChild(row);
      reloadState().catch(() => render());
    })
    .catch(e => toast(e.message));
}

function countAssigned(id) {
  let n = S.tasks.filter(t => !t.done && t.owner === id).length;
  S.projects.forEach(p => { if (p.head === id) n++; });
  return n;
}
function mergeOrg(rows) {
  if (!rows || rows.length < 2) return { err: 'No rows found. The first row should be the headers: Name, Designation, Department, Email.' };
  const head = rows[0].map(h => String(h || '').trim().toLowerCase());
  const find = keys => head.findIndex(h => keys.some(k => h.includes(k)));
  const iNo = find(['e. no', 'e.no', 'eno', 'emp']);
  const iName = find(['name', 'person', 'employee']);
  const iDesig = find(['design', 'title', 'grade', 'role']);
  const iIcom = find(['i.com', 'icom', 'intercom', 'extension']);
  const iMob = find(['mobile', 'phone', 'cell']);
  const iDept = find(['department', 'dept', 'function', 'vertical']);
  const iMail = find(['mail address', 'email', 'e-mail', 'mail']);
  if (iName < 0 || iMail < 0) return { err: 'Could not find a Name column and a Mail address column in the header row. Headers found: ' + head.join(', ') };
  let added = 0, updated = 0;
  rows.slice(1).forEach(r => {
    const name = String(r[iName] || '').trim(), email = String(r[iMail] || '').trim();
    if (!name && !email) return;
    const rec = {
      name: name || email,
      empNo: iNo >= 0 ? String(r[iNo] || '').trim() : '',
      designation: iDesig >= 0 ? String(r[iDesig] || '').trim() : '',
      icom: iIcom >= 0 ? String(r[iIcom] || '').trim() : '',
      mobile: iMob >= 0 ? String(r[iMob] || '').trim() : '',
      dept: iDept >= 0 ? String(r[iDept] || '').trim() : '',
      email: email
    };
    const ex = email ? orgByEmail(email) : null;
    if (ex) { Object.assign(ex, rec); updated++; }
    else { S.org.push(Object.assign({ id: uid(), admin: false, signin: 'password' }, rec)); added++; }
  });
  if (!added && !updated) return { err: 'No usable rows. Check that Name and Email are filled in.' };
  return { added, updated };
}
function parseDelimited(text, sep) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

/* --- read an .xlsx with nothing but what the browser already has --- */
async function readXlsx(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a valid .xlsx');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nLen = dv.getUint16(p + 28, true), eLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    files[new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nLen))] = { method, csize, lho };
    p += 46 + nLen + eLen + cLen;
  }
  const grab = async name => {
    const f = files[name]; if (!f) return null;
    const nLen = dv.getUint16(f.lho + 26, true), eLen = dv.getUint16(f.lho + 28, true);
    const start = f.lho + 30 + nLen + eLen;
    const raw = u8.subarray(start, start + f.csize);
    if (f.method === 0) return new TextDecoder().decode(raw);
    if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot unzip — save the sheet as .csv');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  };
  const px = new DOMParser();
  const ssXml = await grab('xl/sharedStrings.xml');
  const shared = ssXml ? Array.from(px.parseFromString(ssXml, 'application/xml').getElementsByTagName('si'))
    .map(si => Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join('')) : [];
  const sheetName = Object.keys(files).find(n => /^xl\/worksheets\/sheet1\.xml$/i.test(n)) || Object.keys(files).find(n => /^xl\/worksheets\/.*\.xml$/i.test(n));
  const sheet = await grab(sheetName);
  if (!sheet) throw new Error('no worksheet inside the file');
  const doc = px.parseFromString(sheet, 'application/xml');
  const colOf = ref => { let c = 0; for (const ch of String(ref).replace(/[0-9]/g, '')) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };
  return Array.from(doc.getElementsByTagName('row')).map(r => {
    const cells = [];
    Array.from(r.getElementsByTagName('c')).forEach(c => {
      const t = c.getAttribute('t');
      let val = '';
      if (t === 'inlineStr') { const is = c.getElementsByTagName('t')[0]; val = is ? is.textContent : ''; }
      else { const vEl = c.getElementsByTagName('v')[0]; const raw = vEl ? vEl.textContent : ''; val = t === 's' ? (shared[+raw] || '') : raw; }
      cells[colOf(c.getAttribute('r') || '')] = val;
    });
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    return cells;
  }).filter(r => r.some(c => String(c).trim()));
}

/* ===================== PEOPLE ===================== */
let PEOPLE_OPEN = {};
function viewPeople() {
  $('#crumb').textContent = 'Record'; $('#title').textContent = 'Workload assessment';
  $('#topActions').innerHTML = '';
  const v = $('#view'); v.innerHTML = '';

  const rows = {};
  S.projects.forEach(p => {
    if (!p.head) return;
    (rows[p.head] = rows[p.head] || []).push({
      what: p.name + ' — whole project', project: p.name, d: p.cod ? p.cod + '-28' : '',
      st: p.setup ? 'Not set up' : health(p).label, late: countLate(p) > 0,
      open: () => go('project', p.id)
    });
  });
  S.tasks.forEach(t => { if (t.owner && !t.done) (rows[t.owner] = rows[t.owner] || []).push({ what: t.title, project: (proj(t.projectId) || {}).name || '—', d: t.due, st: 'Task', late: t.due && t.due < today(), open: null }); });

  const t = el('table', 'tbl peopletbl');
  t.innerHTML = '<thead><tr><th>Person</th><th>Designation</th><th>Department</th><th>Projects assigned</th><th class="r">Tasks assigned</th><th class="r">Past due</th><th></th></tr></thead>';
  const tb = el('tbody');
  S.org.forEach(o => {
    const list = (rows[o.id] || []).sort((a, b) => String(a.d || '9').localeCompare(String(b.d || '9')));
    const projects = Array.from(new Set(S.projects.filter(p => p.head === o.id).map(p => p.name).concat(list.map(x => x.project)))).filter(x => x && x !== '—');
    const lateN = list.filter(x => x.late).length;
    const tr = el('tr');
    const c1 = el('td');
    const lk = el('button', 'linkish', esc(o.name));
    lk.onclick = () => { PEOPLE_OPEN[o.id] = !PEOPLE_OPEN[o.id]; render(); };
    c1.append(lk);
    if (o.admin) c1.appendChild(el('div', 'sub', 'CEO access'));
    tr.appendChild(c1);
    tr.appendChild(el('td', 'sub', esc(o.designation || '—')));
    tr.appendChild(el('td', 'sub', esc(o.dept || '—')));
    tr.appendChild(el('td', '', projects.length ? projects.map(n2 => `<span class="tag idle">${esc(n2)}</span>`).join(' ') : '<span class="sub">—</span>'));
    tr.appendChild(el('td', 'r num', String(list.length)));
    tr.appendChild(el('td', 'r num' + (lateN ? ' late' : ''), String(lateN)));
    const ac = el('td', 'r');
    if (list.length) {
      const b = el('button', 'btn ghost sm', PEOPLE_OPEN[o.id] ? 'Hide list' : 'Show list');
      b.onclick = () => { PEOPLE_OPEN[o.id] = !PEOPLE_OPEN[o.id]; render(); };
      ac.appendChild(b);
      const m = el('button', 'btn ghost sm mailbtn', '✉');
      m.title = 'Email this list';
      m.onclick = () => notify(o.id, 'Terra Clean — your open list (' + dLabel(today()) + ')',
        'Hello ' + o.name + ',\n\nYour open items:\n\n' + list.map(x => '  · ' + x.what + '  (' + x.project + ') — due ' + (x.d ? dLabel(x.d) : 'no date')).join('\n') + '\n\n— Terra Clean control tower');
      ac.appendChild(m);
    }
    tr.appendChild(ac);
    tb.appendChild(tr);

    if (PEOPLE_OPEN[o.id] && list.length) {
      list.forEach(x => {
        const sr = el('tr', 'subrow');
        const c = el('td'); c.colSpan = 7;
        const line = el('div', 'personitem');
        const nm = x.open ? el('button', 'linkish', esc(trim(x.what, 60))) : el('span', '', esc(trim(x.what, 60)));
        if (x.open) nm.onclick = x.open;
        line.append(nm,
          el('span', 'tag idle', esc(x.project)),
          el('span', 'tag ' + (x.st === 'Task' ? 'info' : tagClass(x.st, x.late)), esc(x.st)),
          el('span', 'num' + (x.late ? ' late' : ''), x.d ? dLabel(x.d) : 'no date'));
        c.appendChild(line); sr.appendChild(c); tb.appendChild(sr);
      });
    }
  });
  t.appendChild(tb);
  v.appendChild(section('Who is carrying what', 'Every person in the directory, what they own and what is open against their name. Open a row to see the list.', t));
}

/* ===================== PROJECT EDIT ===================== */
function editProject(p) {
  const d = openDrawerEl(dHead('Projects', 'Edit details') + `<div class="dbody">
    <label class="fld"><span>Project name</span><input type="text" id="eName" value="${esc(p.name)}"></label>
    <div class="grid2"><label class="fld"><span>Site / village</span><input type="text" id="eSite" value="${esc(p.site || '')}"></label>
    <label class="fld"><span>State</span><input type="text" id="eState" value="${esc(p.state || '')}"></label></div>
    <div class="grid3"><label class="fld"><span>Solar MW</span><input type="number" id="eSolar" value="${p.solar || 0}"></label>
    <label class="fld"><span>Wind MW</span><input type="number" id="eWind" value="${p.wind || 0}"></label>
    <label class="fld"><span>BESS MWh</span><input type="number" id="eBess" value="${p.bess || 0}"></label></div>
    <div class="grid2"><label class="fld"><span>Target COD</span><input type="month" id="eCod" value="${esc(p.cod || '')}"></label>
    <label class="fld"><span>Project lead</span><select id="eHead"><option value="">—</option>${S.org.map(o => `<option value="${o.id}" ${p.head === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label></div>
    <div class="dsec"><h4>Package weightage</h4><div class="sub" style="margin-bottom:8px">Share of total project value. These should add to 100%.</div><div id="pkgW"></div></div>
    <div class="row"><button class="btn pri" id="eSave">Save details</button><button class="btn ghost" id="eDel">Delete project</button></div></div>`);
  wireClose(d);
  const box = $('#pkgW', d), tot = el('div', 'sub');
  p.packages.forEach(k => {
    const r = el('div', 'row'); r.style.marginBottom = '5px';
    r.innerHTML = `<span class="tcode" style="width:32px">${esc(k.code)}</span><span style="flex:1;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.name)}</span>`;
    const i = el('input'); i.type = 'number'; i.step = '0.5'; i.value = ((k.pw || 0) * 100).toFixed(1); i.style.width = '76px';
    i.onchange = () => { k.pw = (+i.value || 0) / 100; save(); sum(); };
    r.appendChild(i); box.appendChild(r);
  });
  box.appendChild(tot);
  const sum = () => { const t = p.packages.reduce((a, k) => a + (k.pw || 0), 0); tot.innerHTML = `Total <b class="num" style="color:${Math.abs(t - 1) < .005 ? 'var(--midnight)' : 'var(--tangerine)'}">${(t * 100).toFixed(1)}%</b>`; };
  sum();
  $('#eSave', d).onclick = () => {
    Object.assign(p, { name: $('#eName', d).value.trim() || p.name, site: $('#eSite', d).value.trim(), state: $('#eState', d).value.trim(), solar: +$('#eSolar', d).value || 0, wind: +$('#eWind', d).value || 0, bess: +$('#eBess', d).value || 0, cod: $('#eCod', d).value, head: $('#eHead', d).value, setup: false });
    save(); closeDrawer(); render(); toast('Saved');
  };
  $('#eDel', d).onclick = () => { if (confirm('Delete “' + p.name + '” and all its tasks?')) { S.projects = S.projects.filter(x => x.id !== p.id); save(); closeDrawer(); go('projects'); } };
}

/* ===================== SETTINGS ===================== */
function viewSettings() {
  $('#crumb').textContent = 'Record'; $('#title').textContent = 'Settings';
  $('#topActions').innerHTML = '';
  const v = $('#view'); v.innerHTML = '';
  const adminBits = isCEO();

  if (ME && !ME.usesCode) {
    const pw = el('section', 'sect');
    pw.innerHTML = `<header><h2>Your password</h2><div class="sub">Only you can change this.</div></header>
      <div class="grid3">
        <label class="fld"><span>Current password</span><input type="password" id="pwNow" autocomplete="current-password"></label>
        <label class="fld"><span>New password</span><input type="password" id="pwNew" autocomplete="new-password"></label>
        <label class="fld"><span>Type it again</span><input type="password" id="pwNew2" autocomplete="new-password"></label>
      </div>`;
    const b2 = el('button', 'btn pri', 'Change my password');
    b2.onclick = async () => {
      const a = document.getElementById('pwNow').value, n = document.getElementById('pwNew').value, n2 = document.getElementById('pwNew2').value;
      if (n !== n2) { toast('The two new passwords do not match'); return; }
      try {
        await api('POST', '/api/auth/change-password', { current: a, next: n });
        document.getElementById('pwNow').value = document.getElementById('pwNew').value = document.getElementById('pwNew2').value = '';
        toast('Password changed');
      } catch (e) { toast(e.message); }
    };
    pw.appendChild(b2);
    v.appendChild(pw);
  }

  if (adminBits) {
    const em = el('section', 'sect');
    em.innerHTML = `<header><h2>Email</h2><div class="sub">Used for sign-in codes, invite codes and assignment notices.</div></header>
      <div id="mailStatus" class="sub">Checking…</div>`;
    const modeWrap = el('div'); modeWrap.style.margin = '14px 0 4px';
    modeWrap.innerHTML = '<div class="eyebrow" style="margin-bottom:6px">How messages go out</div>';
    [['self', 'From my own mailbox', 'Opens a draft in Outlook with everything written. It arrives from your real address, so a corporate filter such as @indianoil.in accepts it. Nothing to set up.'],
     ['auto', 'Server first, my mailbox if it fails', 'Tries to send automatically and falls back to a draft.'],
     ['server', 'Server only', 'Fully automatic. Needs a mail provider, and messages come from the address you verified.']
    ].forEach(([val, label, why]) => {
      const r = el('label', 'pickrow');
      r.innerHTML = `<input type="radio" name="mailmode" value="${val}" ${mailMode() === val ? 'checked' : ''} style="width:auto">
        <span><b>${esc(label)}</b><div class="sub">${esc(why)}</div></span>`;
      r.querySelector('input').onchange = () => { S.mailSend = val; save(); render(); };
      modeWrap.appendChild(r);
    });
    em.appendChild(modeWrap);

    const row = el('div', 'row'); row.style.marginTop = '12px';
    const to = el('input'); to.type = 'text'; to.placeholder = 'Send a test to…'; to.style.maxWidth = '280px';
    to.value = (ME && ME.email) || '';
    const go = el('button', 'btn pri', 'Send a test');
    const out = el('div', 'sub'); out.style.marginTop = '10px';
    go.onclick = async () => {
      out.textContent = 'Sending…';
      try {
        const r = await api('POST', '/api/mail/test', { to: to.value.trim() });
        out.innerHTML = r.sent
          ? '<b>Sent.</b> Check ' + esc(r.to) + ' — it went via ' + esc(r.provider) + ', from ' + esc(r.from) + '.'
          : '<b>Not sent.</b> ' + esc(r.hint || r.detail || r.reason || '') +
            '<br>The message was written to the Vercel log instead.';
      } catch (e) { out.textContent = e.message; }
    };
    row.append(to, go);
    em.append(row, out);
    v.appendChild(em);
    api('GET', '/api/health').then(h => {
      const n = document.getElementById('mailStatus');
      if (!n) return;
      n.innerHTML = h.mail
        ? 'Server sending is on, through <b>' + esc(h.mailProvider) + '</b>, from <b>' + esc(h.mailFrom) + '</b>.'
        : '<b>No mail provider is set up on the server.</b> With <i>From my own mailbox</i> chosen below, that does not matter — messages open as drafts in Outlook and go from your real address.';
    }).catch(() => { });
  }

  const note = el('section', 'sect');
  note.innerHTML = `<header><h2>Access</h2><div class="sub">People, their emails and who has CEO access are managed under Organisation.</div></header>`;
  const nb = el('button', 'btn', 'Open the organisation directory'); nb.onclick = () => go('org');
  note.appendChild(nb);
  const sw = el('label', 'row'); sw.style.marginTop = '14px';
  const cbn = el('input'); cbn.type = 'checkbox'; cbn.checked = !!S.notifyOnAssign; cbn.style.width = 'auto';
  cbn.onchange = () => { S.notifyOnAssign = cbn.checked; save(); };
  sw.append(cbn, el('span', 'sub', 'Open a pre-filled email whenever I assign someone. The draft opens in the mail app with the person, the item and the due date already written — you press send. A file opened from disk cannot send mail on its own; hosting it would make that automatic.'));
  note.appendChild(sw);
  v.appendChild(note);

  if (!adminBits) return;

  v.appendChild(templatesSection());

  const st = el('section', 'sect');
  st.innerHTML = `<header><h2>Status options</h2><div class="sub">Offered when someone records an update. One per line.</div></header>`;
  const ta = el('textarea'); ta.rows = 8; ta.value = S.statuses.join('\n'); ta.disabled = !isCEO();
  ta.onchange = () => { S.statuses = ta.value.split('\n').map(s => s.trim()).filter(Boolean); save(); toast('Saved'); };
  st.appendChild(ta); v.appendChild(st);

  const dt = el('section', 'sect');
  dt.innerHTML = `<header><h2>Data</h2><div class="sub">Everything lives in the server database. Take a backup before any large change.</div></header>`;
  const row = el('div', 'row');
  const ex = el('button', 'btn pri', 'Download a backup');
  ex.onclick = async () => {
    try {
      const out = await api('GET', '/api/export');
      const a = document.createElement('a');
      a.href = window.URL['createObjectURL'](new Blob([JSON.stringify(out.state, null, 1)], { type: 'application/json' }));
      a.download = 'terraclean-' + today() + '.json'; a.click();
    } catch (e) { toast(e.message); }
  };
  const fi = el('input'); fi.type = 'file'; fi.accept = '.json'; fi.style.display = 'none';
  const im = el('button', 'btn', 'Restore a backup'); im.onclick = () => fi.click();
  fi.onchange = () => {
    const f = fi.files[0]; if (!f) return;
    if (!confirm('Restoring replaces everything currently in the database. Continue?')) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const parsed = JSON.parse(r.result);
        const out = await api('POST', '/api/import', { state: parsed.state || parsed });
        REV = out.rev; adoptState(out.state); go('dashboard'); toast('Backup restored');
      } catch (e) { toast('Could not restore: ' + e.message); }
    };
    r.readAsText(f);
  };
  const rs = el('button', 'btn ghost', 'Reset to the starting data');
  rs.onclick = async () => {
    if (!confirm('Discard everything and start again from the Morena template?\n\nYour own account keeps its access. This cannot be undone.')) return;
    try { const out = await api('POST', '/api/reset'); REV = out.rev; adoptState(out.state); go('dashboard'); toast('Reset'); }
    catch (e) { toast(e.message); }
  };
  row.append(ex, im, fi, rs); dt.appendChild(row); v.appendChild(dt);
}

/* ===================== TEMPLATES (Settings) ===================== */
function templatesSection() {
  const s = el('section', 'sect');
  s.innerHTML = `<header><h2>Templates</h2><div class="sub">A reusable structure. Apply it to any project — existing lines keep their progress and history, only missing ones are added.</div></header>`;

  const mk = el('div', 'row'); mk.style.marginBottom = '14px';
  const name = el('input'); name.type = 'text'; name.placeholder = 'New template name, e.g. Wind + BESS hybrid'; name.style.flex = '1';
  const from = el('select'); from.style.maxWidth = '230px';
  from.innerHTML = '<option value="">Start blank</option><option value="__std">Copy the standard breakdown</option>' +
    S.projects.map(p => `<option value="${p.id}">Copy from ${esc(p.name)}</option>`).join('');
  const make = el('button', 'btn pri', 'Create');
  make.onclick = () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    let packages = [];
    if (from.value === '__std') packages = clone(S.standardTemplate || []);
    else if (from.value) { const p = proj(from.value); if (p) packages = templateFromPackages(p.packages); }
    S.templates = S.templates || [];
    S.templates.unshift({ id: uid(), name: n, note: from.value ? 'Copied on ' + dLabel(today()) : 'Built by hand', packages });
    save(); render(); toast('Template created');
  };
  mk.append(name, from, make);
  s.appendChild(mk);

  const list = S.templates || [];
  if (!list.length) {
    s.appendChild(el('div', 'empty', 'No templates yet. Build a project the way you want it, then copy it here — every later project can start from it.'));
    return s;
  }
  s.appendChild(tableOf(['Template', 'Items', 'Where it came from', ''],
    list.map(t => [
      { link: [t.name, () => renameTemplate(t)] },
      `<span class="num">${countIn(t.packages)}</span>`,
      `<span class="sub">${esc(t.note || '')}</span>`,
      {
        html: '', act: [
          ['Apply to projects', () => applyTemplate(t)],
          ['Duplicate', () => { S.templates.unshift({ id: uid(), name: t.name + ' (copy)', note: t.note, packages: clone(t.packages) }); save(); render(); }],
          ['Delete', () => { if (confirm('Delete the template “' + t.name + '”? Projects built from it are not affected.')) { S.templates = S.templates.filter(x => x.id !== t.id); save(); render(); } }]
        ]
      }
    ])));
  return s;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function renameTemplate(t) {
  const n = prompt('Rename template', t.name);
  if (n && n.trim()) { t.name = n.trim(); save(); render(); }
}

function applyTemplate(t) {
  const d = openDrawerEl(dHead('Templates', 'Apply “' + t.name + '”') + '<div class="dbody" id="db"></div>');
  wireClose(d);
  const b = document.getElementById('db');
  b.innerHTML = `<p class="sub" style="margin-top:0">Choose the projects. ${countIn(t.packages)} items in this template.</p>`;
  const picks = el('div');
  S.projects.forEach(p => {
    const r = el('label', 'pickrow');
    r.innerHTML = `<input type="checkbox" value="${p.id}" style="width:auto">
      <span style="flex:1">${esc(p.name)}</span>
      <span class="sub">${countNodes(p)} items now</span>`;
    picks.appendChild(r);
  });
  b.appendChild(picks);

  const mode = el('div', 'dsec');
  mode.innerHTML = `<h4>How to apply it</h4>
    <label class="pickrow"><input type="radio" name="tmode" value="merge" checked style="width:auto">
      <span><b>Add what is missing</b><div class="sub">Existing lines keep their progress, dates and status history. Nothing is deleted.</div></span></label>
    <label class="pickrow"><input type="radio" name="tmode" value="replace" style="width:auto">
      <span><b>Replace the breakdown</b><div class="sub">Throws away what is there, including progress. Take a backup first.</div></span></label>`;
  b.appendChild(mode);

  const go = el('button', 'btn pri', 'Apply');
  go.onclick = () => {
    const ids = Array.prototype.slice.call(picks.querySelectorAll('input:checked')).map(i => i.value);
    if (!ids.length) { toast('Pick at least one project'); return; }
    const how = (b.querySelector('input[name=tmode]:checked') || {}).value || 'merge';
    if (how === 'replace' && !confirm('Replace the breakdown on ' + ids.length + ' project(s)? All progress on them is deleted.')) return;
    let added = 0, kept = 0;
    ids.forEach(id => {
      const p = proj(id); if (!p) return;
      if (how === 'replace') { p.packages = packagesFromTemplate(t.packages); p.snaps = []; }
      else { const st = mergeTemplate(p, t.packages); added += st.added; kept += st.kept; }
      p.templateId = t.id;
      renumberProject(p);
    });
    save(); closeDrawer(); render();
    toast(how === 'replace' ? 'Replaced on ' + ids.length + ' project(s)'
      : added + ' new items added, ' + kept + ' left untouched');
  };
  b.appendChild(go);
}

/* ===================== boot ===================== */
function render() {
  renderRail();
  if (!isCEO() && ADMIN_ONLY.indexOf(VIEW) >= 0) VIEW = 'dashboard';
  ({
    project: viewProject, projects: viewProjects, activities: viewActivities,
    offtake: viewOfftake, enablers: viewEnablers, people: viewPeople,
    org: viewOrg, settings: viewSettings
  }[VIEW] || viewDashboard)();
}

async function boot() {
  try {
    ME = await api('GET', '/api/me');
  } catch (e) {
    showLogin(''); return;
  }
  const out = await api('GET', '/api/state');
  REV = out.rev; adoptState(out.state);
  const host = document.getElementById('login');
  if (host) host.style.display = 'none';
  document.body.classList.remove('locked');
  setSyncState('saved');
  render();
}
boot();
