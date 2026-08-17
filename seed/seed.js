'use strict';
/* Builds the first document. Run once, the first time the database is empty.
   Everything here is editable in the app afterwards — this is a starting point,
   not a fixture. */
const WBS = require('./wbs.json');
const { applyCodes } = require('../lib/renumber');

const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
const todayISO = () => new Date().toISOString().slice(0, 10);

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
  const adminName = process.env.ADMIN_NAME || 'Administrator';

  /* signin: 'code'     — a one-time code by email, no password
     signin: 'password' — an invite code once, then their own password
     Both can hold admin rights; the two are independent. */
  const org = [
    { id: 'admin', empNo: '', name: adminName, designation: 'Administrator', icom: '', mobile: '', dept: 'Executive', email: adminEmail, admin: true, signin: 'code' },
    { id: 'ceo', empNo: '', name: 'Atul Parmar', designation: 'Chief Executive Officer', icom: '', mobile: '', dept: 'Executive', email: 'atul.parmar@indianoil.in', admin: true, signin: 'password' },
    { id: 'p1', name: 'A. Sharma', designation: '', dept: 'Land & revenue', email: '', signin: 'password' },
    { id: 'p2', name: 'B. Nair', designation: '', dept: 'Regulatory & connectivity', email: '', signin: 'password' },
    { id: 'p3', name: 'C. Patel', designation: '', dept: 'Procurement', email: '', signin: 'password' },
    { id: 'p4', name: 'D. Rao', designation: '', dept: 'Electrical & EHV', email: '', signin: 'password' },
    { id: 'p5', name: 'E. Verma', designation: '', dept: 'Civil & BoS', email: '', signin: 'password' },
    { id: 'p6', name: 'F. Khan', designation: '', dept: 'Legal', email: '', signin: 'password' },
    { id: 'p7', name: 'G. Iyer', designation: '', dept: 'Finance, PPA & offtake', email: '', signin: 'password' },
    { id: 'p8', name: 'H. Singh', designation: '', dept: 'Project management — Morena', email: '', signin: 'password' },
    { id: 'p9', name: 'J. Desai', designation: '', dept: 'Project management — Gujarat', email: '', signin: 'password' },
    { id: 'p10', name: 'K. Menon', designation: '', dept: 'Quality & commissioning', email: '', signin: 'password' }
  ];

  /* The live portfolio, from the substation and PPA tables.
     Morena keeps the detailed breakdown and S-curve from the original plan;
     the rest start on the same standard breakdown, ready to be shaped. */
  /* The portfolio exactly as it stands in the capacity sheet: state code,
     substation, solar MWp, wind MW, and how it connects. */
  const PORTFOLIO = [
    { state: 'MP',  name: 'Morena',                        solar: 465,   wind: 0,     conn: 'ISTS' },
    { state: 'GJ',  name: 'Sisrana',                       solar: 155,   wind: 0,     conn: 'InSTS' },
    { state: 'KA',  name: 'Davanagere',                    solar: 0,     wind: 300,   conn: 'ISTS' },
    { state: 'GJ',  name: 'Saurashtra',                    solar: 0,     wind: 100,   conn: 'InSTS' },
    { state: 'AP',  name: 'Ananthapuram III',              solar: 465,   wind: 0,     conn: 'ISTS' },
    { state: 'AP',  name: 'Krishnagiri PS (Kurnool V)',    solar: 542.5, wind: 0,     conn: 'ISTS' },
    { state: 'GJ',  name: 'Bhachau / Lakhadia II',         solar: 0,     wind: 249.1, conn: 'ISTS' },
    { state: 'RJ',  name: 'Pali',                          solar: 240.3, wind: 0,     conn: 'ISTS' },
    { state: 'GJ',  name: 'Khavda VII',                    solar: 387.5, wind: 100,   conn: 'ISTS' },
    { state: 'MH',  name: 'Solapur',                       solar: 465,   wind: 0,     conn: 'ISTS' },
    { state: 'AP',  name: 'Ananthapuram III (Ph-2)',       solar: 930,   wind: 0,     conn: 'ISTS' },
    { state: 'GJ',  name: 'Bhalgamda, Morbi',              solar: 465,   wind: 0,     conn: 'InSTS' },
    { state: 'UP',  name: 'Sahjahanpur, Jalaun',           solar: 125.6, wind: 0,     conn: 'InSTS' },
    { state: 'UP',  name: 'Purakalan, Lalitpur',           solar: 37.2,  wind: 0,     conn: 'InSTS' },
    { state: 'MH',  name: 'Jamgaon',                       solar: 77.5,  wind: 50,    conn: 'InSTS' },
    { state: 'TN',  name: 'Karur',                         solar: 77.5,  wind: 50,    conn: 'InSTS' }
  ];

  const projects = PORTFOLIO.map(row => newProject({
    name: row.name,
    site: row.name.split(',')[0].trim(),
    state: row.state,
    solar: row.solar,
    wind: row.wind,
    bess: 0,
    conn: row.conn,
    setup: false
  }));

  /* Morena is the one with real progress recorded against it */
  const morena = projects[0];
  morena.packages = clonePackages(WBS.packages, true);
  morena.baseline = WBS.curve;
  morena.cod = '2028-06';
  morena.site = 'Morena';

  projects.forEach(p => applyCodes(p.packages));

  return {
    v: 5,
    numbered: true,
    notifyOnAssign: true,
    mailSend: 'self',   /* drafts open in the sender's own mailbox by default */
    watch: ['A', 'B'],
    statuses: ['Not started', 'In progress', 'Applied', 'Submitted', 'Under review', 'Approved', 'Granted', 'Executed', 'On hold', 'Delayed'],
    standardTemplate: templateFrom(applyCodes(clonePackages(WBS.packages, false))),
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
