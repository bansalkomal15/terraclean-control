'use strict';
/* ---------------------------------------------------------------------------
   renumber.js — packages are letters (A, B, C…), everything under them is
   decimal (1, then 1.1, then 1.1.1). No roman numerals, no lowercase letters.

   The original spreadsheet used i, ii, iii and a, b, c. Those codes travelled
   into the standard template, so anything built from the template could bring
   them back. This puts it right at the source and repairs whatever is already
   stored, carrying logged changes and CEO items across to the new codes.
--------------------------------------------------------------------------- */

const CLEAN = /^[A-Z]+$|^[0-9]+(\.[0-9]+)*$/;

function letterCode(i) {
  let s = ''; i = i + 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/* map of node id -> full path, using whatever codes are currently set */
function pathsOf(packages) {
  const m = {};
  (packages || []).forEach(pk => (function rec(n, prefix) {
    const cp = prefix ? prefix + '/' + (n.code || '') : (n.code || '');
    if (n.id) m[n.id] = cp;
    (n.children || []).forEach(c => rec(c, cp));
  })(pk, ''));
  return m;
}

function applyCodes(packages) {
  (packages || []).forEach((pk, i) => {
    pk.code = letterCode(i);
    (function rec(list, prefix) {
      (list || []).forEach((n, j) => {
        n.code = prefix ? prefix + '.' + (j + 1) : String(j + 1);
        rec(n.children, n.code);
      });
    })(pk.children, '');
  });
  return packages;
}

function needsRenumber(state) {
  let bad = false;
  const check = list => (list || []).forEach(function rec(n) {
    if (!CLEAN.test(n.code || '')) bad = true;
    (n.children || []).forEach(rec);
  });
  (state.projects || []).forEach(p => check(p.packages));
  check(state.standardTemplate);
  (state.templates || []).forEach(t => check(t.packages));
  return bad;
}

function renumberProject(project, state) {
  const before = pathsOf(project.packages);
  applyCodes(project.packages);
  const after = pathsOf(project.packages);
  const map = {};
  Object.keys(before).forEach(id => { if (after[id]) map[before[id]] = after[id]; });

  (project.chg || []).forEach(c => { if (c.path && map[c.path]) c.path = map[c.path]; });
  ((state && state.asks) || []).forEach(a => {
    if (a.projectId === project.id && a.path && map[a.path]) a.path = map[a.path];
  });
  return map;
}

function renumberAll(state) {
  let firstMap = null;
  (state.projects || []).forEach((p, i) => {
    const map = renumberProject(p, state);
    if (i === 0) firstMap = map;
  });
  /* the template is what new projects are built from, so clean it too */
  applyCodes(state.standardTemplate);
  (state.templates || []).forEach(t => applyCodes(t.packages));

  /* the chosen status columns and the Activities selector are stored as paths */
  if (firstMap) {
    state.watch = (state.watch || []).map(x => firstMap[x] || x);
    state.across = firstMap[state.across] || state.across;
  }
  const first = (state.projects || [])[0];
  if (first) {
    const valid = new Set(Object.values(pathsOf(first.packages)));
    state.watch = (state.watch || []).filter(x => valid.has(x));
    if (!state.watch.length) state.watch = (first.packages || []).slice(0, 2).map(k => k.code);
    if (!valid.has(state.across)) state.across = (first.packages[0] || {}).code || 'A';
  }
  return state;
}

module.exports = { letterCode, applyCodes, needsRenumber, renumberAll, renumberProject, CLEAN };
