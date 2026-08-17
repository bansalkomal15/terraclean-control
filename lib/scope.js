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

/* ---------- one project, one owner ----------
   A project belongs to exactly one person. They run all of it; nobody else
   sees it at all. There is no ownership below project level, so there is
   nothing to filter by and no partial view to assemble. */
function canSeeAll(project, person) { return isAdmin(person) || leadsProject(project, person); }
function visibleProjects(state, person) {
  if (isAdmin(person)) return (state.projects || []).slice();
  return (state.projects || []).filter(p => p.head === person.id);
}

/* ---------------------------------------------------------------------------
   READ — build the document this person is allowed to receive.
--------------------------------------------------------------------------- */
function pruneForUser(state, person) {
  const admin = isAdmin(person);
  const out = {
    v: state.v,
    watch: state.watch || [],
    mailSend: state.mailSend || 'self',
    statuses: state.statuses || [],
    standardTemplate: (admin || (state.projects || []).some(p => p.head === person.id)) ? (state.standardTemplate || []) : [],
    numbered: true,
    viewerId: person.id,
    isAdmin: admin,
    org: (state.org || []).map(p => ({
      id: p.id, name: p.name, designation: p.designation || '', dept: p.dept || '',
      /* an address is a login credential — only an administrator receives the list */
      email: admin || p.id === person.id ? (p.email || '') : '',
      admin: !!p.admin,
      signin: p.signin || (p.admin ? 'code' : 'password')
    })),
    projects: visibleProjects(state, person).map(p => clone(p)),
    tasks: [],
    asks: [],
    enablers: admin ? (state.enablers || []) : (state.enablers || []).filter(e => e.owner === person.id),
    deals: admin ? (state.deals || []) : [],
    templates: admin ? (state.templates || []) : [],
    dealTemplates: admin ? (state.dealTemplates || []) : []
  };
  const visibleIds = new Set(out.projects.map(p => p.id));
  out.tasks = (state.tasks || []).filter(t => admin || t.owner === person.id || t.by === person.name);
  out.asks = (state.asks || []).filter(a => admin || a.raisedBy === person.name || visibleIds.has(a.projectId));
  return out;
}

/* ---------------------------------------------------------------------------
   WRITE — start from what is stored and take only what this person may change.
--------------------------------------------------------------------------- */
function mergeForUser(stored, incoming, person) {
  const out = clone(stored);
  incoming = incoming || {};

  if (isAdmin(person)) {
    ['org', 'statuses', 'watch', 'templates', 'dealTemplates', 'enablers', 'deals', 'tasks', 'asks', 'projects'].forEach(k => {
      if (incoming[k] !== undefined) out[k] = clone(incoming[k]);
    });
    if (incoming.notifyOnAssign !== undefined) out.notifyOnAssign = !!incoming.notifyOnAssign;
    if (incoming.mailSend !== undefined) out.mailSend = String(incoming.mailSend);
    guardAdmins(out, stored);
    return out;
  }

  /* --- projects: yours entirely, or not at all --- */
  (incoming.projects || []).forEach(ip => {
    const sp = (out.projects || []).find(p => p.id === ip.id);
    if (!sp) return;                                   /* nobody but an admin creates projects */
    if (!leadsProject(sp, person)) return;             /* not theirs — ignore it completely */
    const keepId = sp.id, keepHead = sp.head;
    Object.keys(ip).forEach(k => { if (k !== 'id' && k !== 'head') sp[k] = clone(ip[k]); });
    sp.id = keepId;
    sp.head = keepHead;                                /* only an admin hands a project on */
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
  canSeeAll, visibleProjects,
  pruneForUser, mergeForUser
};
