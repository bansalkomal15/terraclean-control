'use strict';
/* Builds the first document. Run once, the first time the database is empty.
   Everything here is editable in the app afterwards — this is a starting point,
   not a fixture. */
const WBS = require('./wbs.json');

const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
const todayISO = () => new Date().toISOString().slice(0, 10);

function letterCode(i) {
  let s = ''; i = i + 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function applyCodes(project) {
  project.packages.forEach((pk, i) => {
    pk.code = letterCode(i);
    (function rec(list, prefix) {
      (list || []).forEach((n, j) => {
        n.code = prefix ? prefix + '.' + (j + 1) : String(j + 1);
        rec(n.children, n.code);
      });
    })(pk.children, '');
  });
}
function clonePackages(list, keepData) {
  return list.map(function cp(n) {
    const o = { id: uid(), code: n.code, name: n.name, w: n.w, prog: keepData ? (n.prog || 0) : 0, log: [], children: (n.children || []).map(cp) };
    if (n.pw != null) o.pw = n.pw;
    if (n.group) o.group = n.group;
    if (n.qty != null) o.qty = n.qty;
    if (keepData) { if (n.s) o.s = n.s; if (n.f) o.f = n.f; }
    return o;
  });
}
function templateFrom(list) {
  return list.map(function cp(n) {
    const o = { code: n.code, name: n.name, w: n.w, children: (n.children || []).map(cp) };
    if (n.pw != null) o.pw = n.pw;
    if (n.qty != null) o.qty = n.qty;
    return o;
  });
}
function newProject(o) {
  return Object.assign({
    id: uid(), name: 'Untitled project', site: '', state: '', solar: 0, wind: 0, bess: 0,
    cod: '', head: '', setup: true, snaps: [], chg: [], packages: clonePackages(WBS.packages, false)
  }, o);
}

module.exports = function seed() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'bansalkomal15@gmail.com').toLowerCase();
  const adminName = process.env.ADMIN_NAME || 'CEO';

  const org = [
    { id: 'ceo', name: adminName, designation: 'Chief Executive Officer', dept: 'Executive', email: adminEmail, admin: true },
    { id: 'p1', name: 'A. Sharma', designation: '', dept: 'Land & revenue', email: '' },
    { id: 'p2', name: 'B. Nair', designation: '', dept: 'Regulatory & connectivity', email: '' },
    { id: 'p3', name: 'C. Patel', designation: '', dept: 'Procurement', email: '' },
    { id: 'p4', name: 'D. Rao', designation: '', dept: 'Electrical & EHV', email: '' },
    { id: 'p5', name: 'E. Verma', designation: '', dept: 'Civil & BoS', email: '' },
    { id: 'p6', name: 'F. Khan', designation: '', dept: 'Legal', email: '' },
    { id: 'p7', name: 'G. Iyer', designation: '', dept: 'Finance, PPA & offtake', email: '' },
    { id: 'p8', name: 'H. Singh', designation: '', dept: 'Project management — Morena', email: '' },
    { id: 'p9', name: 'J. Desai', designation: '', dept: 'Project management — Gujarat', email: '' },
    { id: 'p10', name: 'K. Menon', designation: '', dept: 'Quality & commissioning', email: '' }
  ];

  const morena = newProject({
    name: 'Morena', site: 'Morena', state: 'Madhya Pradesh', solar: 300, wind: 0, bess: 0,
    cod: '2028-06', head: 'p8', setup: false,
    packages: clonePackages(WBS.packages, true), baseline: WBS.curve
  });
  const gujarat = newProject({
    name: 'Gujarat Bhalgamada', site: 'Bhalgamada', state: 'Gujarat',
    solar: 150, wind: 100, bess: 200, cod: '2028-12', head: 'p9', setup: false
  });
  const rest = [3, 4, 5, 6, 7, 8].map(i => newProject({ name: 'Project ' + i }));
  const projects = [morena, gujarat].concat(rest);
  projects.forEach(applyCodes);

  return {
    v: 5,
    numbered: true,
    notifyOnAssign: true,
    watch: ['A', 'B'],
    statuses: ['Not started', 'In progress', 'Applied', 'Submitted', 'Under review', 'Approved', 'Granted', 'Executed', 'On hold', 'Delayed'],
    standardTemplate: templateFrom(clonePackages(WBS.packages, false)),
    org, projects,
    tasks: [], asks: [], templates: [],
    enablers: [
      { id: uid(), title: 'Consultant appointment', kind: 'Consultant appointment', forWhat: 'Shared functions', purpose: 'Set the purpose — e.g. transaction advisory, resource assessment', party: '', owner: 'p7', end: '', status: 'Not started', note: '' },
      { id: uid(), title: 'DIPAM approval', kind: 'Approval', forWhat: 'Shared functions', purpose: 'Approval from Department of Investment and Public Asset Management', party: 'DIPAM', owner: 'p6', end: '', status: 'Not started', note: '' },
      { id: uid(), title: 'CCEA approval', kind: 'Approval', forWhat: 'Shared functions', purpose: 'Cabinet Committee on Economic Affairs clearance', party: 'CCEA', owner: 'p6', end: '', status: 'Not started', note: '' },
      { id: uid(), title: 'Floating solar — Odisha', kind: 'Opportunity', forWhat: 'New geography', purpose: 'Evaluate floating solar opportunity in Odisha', party: '', owner: 'p7', end: '', status: 'Not started', note: '' }
    ],
    deals: [
      { id: uid(), counterparty: 'Set the utility name', type: 'Utility', state: '', projectId: '', capTalks: 0, capFinal: 0, capTBD: true, participate: 'To decide', tariffDecided: 'No', tariff: '', bidFile: '', bidDecide: '', stage: 'Identified', owner: 'p7', note: '', updated: todayISO() },
      { id: uid(), counterparty: 'Set the customer name', type: 'C&I', state: '', projectId: '', capTalks: 0, capFinal: 0, capTBD: true, stage: 'Initial negotiation', owner: 'p7', note: '', updated: todayISO() }
    ]
  };
};
