'use strict';
/* ---------------------------------------------------------------------------
   scope.js — who may see what, and who may change what.

   This is the file that makes the hosted version different from a single HTML
   file. Every read is pruned before it leaves the server, and every write is
   merged field by field against what the signed-in person is allowed to touch.
   Nothing here trusts the browser.
--------------------------------------------------------------------------- */

const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- tree helpers ---------- */
function walkAll(project, fn) {
  (project.packages || []).forEach(pk => (function rec(n, depth) {
    fn(n, depth);
    (n.children || []).forEach(c => rec(c, depth + 1));
  })(pk, 0));
}
function indexById(project) {
  const map = {};
  (project.packages || []).forEach(pk => (function rec(n, parent) {
    map[n.id] = { node: n, parent };
    (n.children || []).forEach(c => rec(c, n));
  })(pk, null));
  return map;
}
function codePath(project, id) {
  const map = indexById(project);
  let cur = map[id];
  const out = [];
  while (cur) { out.unshift(cur.node.code || ''); cur = cur.parent ? map[cur.parent.id] : null; }
  return out.join('/');
}
function findByPath(project, path) {
  let list = project.packages || [], node = null;
  for (const c of String(path || '').split('/')) {
    node = (list || []).find(n => (n.code || '') === c);
    if (!node) return null;
    list = node.children;
  }
  return node;
}

/* ---------- who is who ---------- */
function personById(state, id) { return (state.org || []).find(p => p.id === id) || null; }
function personByEmail(state, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  return (state.org || []).find(p => String(p.email || '').trim().toLowerCase() === e) || null;
}
function isAdmin(person) { return !!(person && person.admin); }
function leadsProject(project, person) { return !!person && project.head === person.id; }

function hasAssignments(state, id) {
  if ((state.projects || []).some(p => p.head === id)) return true;
  if ((state.tasks || []).some(t => !t.done && t.owner === id)) return true;
  let hit = false;
  (state.projects || []).forEach(p => walkAll(p, n => { if (n.owner === id) hit = true; }));
  if (hit) return true;
  if ((state.enablers || []).some(e => e.owner === id && e.status !== 'Done')) return true;
  return (state.deals || []).some(d => d.owner === id);
}
/* who is allowed through the front door at all */
function maySignIn(state, person) {
  if (!person) return { ok: false, reason: 'not-in-directory' };
  if (isAdmin(person)) return { ok: true };
  if (hasAssignments(state, person.id)) return { ok: true };
  return { ok: false, reason: 'nothing-assigned' };
}

/* ---------- scope inside a project ---------- */
function canSeeAll(project, person) { return isAdmin(person) || leadsProject(project, person); }

/* own = fully visible; ctx = parent lines shown as headings only */
function scopeOf(project, person) {
  if (canSeeAll(project, person)) return null;
  const map = indexById(project);
  const own = new Set(), ctx = new Set();
  walkAll(project, n => {
    if (n.owner !== person.id) return;
    own.add(n.id);
    (function rec(x) { (x.children || []).forEach(c => { own.add(c.id); rec(c); }); })(n);
    let cur = map[n.id];
    while (cur && cur.parent) { ctx.add(cur.parent.id); cur = map[cur.parent.id]; }
  });
  return { own, ctx };
}
/* the top of each owned branch — what a member may replace wholesale */
function ownRoots(project, person) {
  const map = indexById(project), roots = [];
  walkAll(project, n => {
    if (n.owner !== person.id) return;
    let cur = map[n.id].parent, ownedAbove = false;
    while (cur) { if (cur.owner === person.id) { ownedAbove = true; break; } cur = map[cur.id].parent; }
    if (!ownedAbove) roots.push(n.id);
  });
  return roots;
}
function visibleProjects(state, person) {
  if (isAdmin(person)) return (state.projects || []).slice();
  return (state.projects || []).filter(p => {
    if (p.head === person.id) return true;
    if ((state.tasks || []).some(t => !t.done && t.owner === person.id && t.projectId === p.id)) return true;
    let hit = false; walkAll(p, n => { if (n.owner === person.id) hit = true; });
    return hit;
  });
}

/* ---------------------------------------------------------------------------
   READ — build the document this person is allowed to receive.
--------------------------------------------------------------------------- */
function pruneForUser(state, person) {
  const admin = isAdmin(person);
  const out = {
    v: state.v,
    watch: state.watch || [],
    statuses: state.statuses || [],
    /* the standard breakdown is only useful to someone who can create or reshape
       a project, and it names every package — so it travels no further than that */
    standardTemplate: (admin || (state.projects || []).some(p => p.head === person.id)) ? (state.standardTemplate || []) : [],
    numbered: true,
    viewerId: person.id,
    isAdmin: admin,
    org: (state.org || []).map(p => ({
      id: p.id, name: p.name, designation: p.designation || '', dept: p.dept || '',
      /* an address is a login credential — only an administrator receives the list */
      email: admin || p.id === person.id ? (p.email || '') : '',
      admin: !!p.admin
    })),
    projects: [],
    tasks: [],
    asks: [],
    enablers: admin ? (state.enablers || []) : (state.enablers || []).filter(e => e.owner === person.id),
    deals: admin ? (state.deals || []) : [],
    templates: admin ? (state.templates || []) : []
  };

  visibleProjects(state, person).forEach(p => {
    if (canSeeAll(p, person)) { out.projects.push(clone(p)); return; }
    const sc = scopeOf(p, person);
    const copy = clone(p);
    copy.packages = prunePackages(p.packages || [], sc);
    /* whole-project notes stay with the lead; only changes on their own lines travel */
    copy.chg = (p.chg || []).filter(c => {
      if (!c.path) return false;
      const n = findByPath(p, c.path);
      return n && sc.own.has(n.id);
    });
    copy.snaps = [];
    copy.baseline = null;
    out.projects.push(copy);
  });

  const visibleIds = new Set(out.projects.map(p => p.id));
  out.tasks = (state.tasks || []).filter(t => admin || t.owner === person.id || t.by === person.name);
  out.asks = (state.asks || []).filter(a => admin || a.raisedBy === person.name || visibleIds.has(a.projectId));
  return out;
}
function prunePackages(list, sc) {
  const keep = [];
  list.forEach(n => {
    const children = prunePackages(n.children || [], sc);
    const visible = sc.own.has(n.id) || sc.ctx.has(n.id) || children.length;
    if (!visible) return;
    const c = clone(n);
    c.children = children;
    if (!sc.own.has(n.id)) {           /* a heading only — carry no numbers */
      c.prog = 0; c.log = []; delete c.due; delete c.s; delete c.f; delete c.desc; delete c.qty;
    }
    keep.push(c);
  });
  return keep;
}

/* ---------------------------------------------------------------------------
   WRITE — start from what is stored and take only what this person may change.
--------------------------------------------------------------------------- */
function mergeForUser(stored, incoming, person) {
  const out = clone(stored);
  incoming = incoming || {};

  if (isAdmin(person)) {
    ['org', 'statuses', 'watch', 'templates', 'enablers', 'deals', 'tasks', 'asks', 'projects'].forEach(k => {
      if (incoming[k] !== undefined) out[k] = clone(incoming[k]);
    });
    if (incoming.notifyOnAssign !== undefined) out.notifyOnAssign = !!incoming.notifyOnAssign;
    guardAdmins(out, stored);
    return out;
  }

  /* --- projects --- */
  (incoming.projects || []).forEach(ip => {
    const sp = (out.projects || []).find(p => p.id === ip.id);
    if (!sp) return;                                   /* nobody but an admin creates projects */

    if (leadsProject(sp, person)) {                    /* a lead owns their project outright */
      const keepId = sp.id;
      Object.keys(ip).forEach(k => { if (k !== 'id') sp[k] = clone(ip[k]); });
      sp.id = keepId;
      return;
    }

    const sc = scopeOf(sp, person);
    const iIndex = indexById(ip);
    ownRoots(sp, person).forEach(rootId => {
      const inc = iIndex[rootId];
      if (!inc) return;                                /* a member cannot delete their own branch */
      replaceNodeById(sp, rootId, sanitiseNode(inc.node, person));
    });
    /* new change entries, only against lines they own */
    (ip.chg || []).forEach(c => {
      if (!c || !c.id || (sp.chg || []).some(x => x.id === c.id)) return;
      if (!c.path) return;
      const n = findByPath(sp, c.path);
      if (n && sc.own.has(n.id)) { sp.chg = sp.chg || []; sp.chg.push(clone(c)); }
    });
  });

  /* --- standalone tasks: their own, or ones they created --- */
  const mine = t => t.owner === person.id || t.by === person.name;
  const kept = (out.tasks || []).filter(t => !mine(t));
  const theirs = (incoming.tasks || []).filter(mine).map(t => {
    const prev = (stored.tasks || []).find(x => x.id === t.id);
    const c = clone(t);
    if (!prev) { c.by = person.name; c.created = todayISO(); }
    else { c.by = prev.by; c.created = prev.created; }
    return c;
  });
  out.tasks = kept.concat(theirs);

  /* --- items raised with the CEO: theirs only, and they may not clear them --- */
  const raisedByThem = a => a.raisedBy === person.name;
  const otherAsks = (out.asks || []).filter(a => !raisedByThem(a));
  const own = (incoming.asks || []).filter(raisedByThem).map(a => {
    const prev = (stored.asks || []).find(x => x.id === a.id);
    const c = clone(a);
    c.raisedBy = person.name;
    c.status = prev ? prev.status : 'open';            /* only the CEO marks something done */
    return c;
  });
  out.asks = otherAsks.concat(own);

  return out;
}

function sanitiseNode(node, person) {
  const c = clone(node);
  (function rec(n) {
    if (n.owner === undefined) n.owner = person.id;    /* new lines default to their author */
    (n.children || []).forEach(rec);
  })(c);
  return c;
}
function replaceNodeById(project, id, replacement) {
  const walk = list => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) { list[i] = replacement; return true; }
      if (list[i].children && walk(list[i].children)) return true;
    }
    return false;
  };
  walk(project.packages || []);
}
/* never let the last administrator disappear, and never let one demote themselves */
function guardAdmins(next, prev) {
  if (!(next.org || []).some(p => p.admin)) {
    const before = (prev.org || []).filter(p => p.admin).map(p => p.id);
    (next.org || []).forEach(p => { if (before.includes(p.id)) p.admin = true; });
    if (!(next.org || []).some(p => p.admin) && next.org.length) next.org[0].admin = true;
  }
}
const todayISO = () => new Date().toISOString().slice(0, 10);

module.exports = {
  clone, walkAll, indexById, codePath, findByPath,
  personById, personByEmail, isAdmin, leadsProject, hasAssignments, maySignIn,
  canSeeAll, scopeOf, ownRoots, visibleProjects,
  pruneForUser, mergeForUser
};
