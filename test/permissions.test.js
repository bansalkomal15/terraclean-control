const S = require('../lib/scope');
const seed = require('../seed/seed');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;} else {fail++;console.log('  FAIL:',m);} };

const state = seed();
const ceo   = state.org.find(p=>p.admin);
const lead  = state.org.find(p=>p.name==='H. Singh');
const member= state.org.find(p=>p.name==='K. Menon');
const stranger = state.org.find(p=>p.name==='C. Patel');
lead.email='h.singh@x.in'; member.email='k.menon@x.in'; stranger.email='f.khan@x.in';

const morena = state.projects[0], gujarat = state.projects[1];
morena.head = lead.id;
// give the member three leaves inside package B
let c=0; (function rec(n){ if(!n.children.length){ if(c<3){ n.owner=member.id; c++; } return; } n.children.forEach(rec); })(morena.packages[1]);
const ownedIds = []; S.walkAll(morena, n=>{ if(n.owner===member.id) ownedIds.push(n.id); });
morena.chg=[{id:'c1',date:'2026-08-01',item:'Land requirement',path:S.codePath(morena, ownedIds[0]),from:'a',to:'b',impact:'Scope',by:'CEO'},
            {id:'c2',date:'2026-07-01',item:'Board note',path:'',from:'x',to:'y',impact:'Cost',by:'CEO'}];
state.tasks=[{id:'t1',title:'CEO private task',owner:'',projectId:gujarat.id,due:'2026-08-16',urgency:'High',done:false,by:'CEO'},
             {id:'t2',title:'Member task',owner:member.id,projectId:morena.id,due:'2026-08-16',urgency:'Low',done:false,by:'K. Menon'}];
state.asks=[{id:'a1',projectId:morena.id,path:'',title:'Sign the LOA',raisedBy:'K. Menon',status:'open',urgency:'High',by:'2026-08-20'}];

console.log('— sign-in gate —');
ok(S.maySignIn(state, ceo).ok, 'CEO can sign in');
ok(S.maySignIn(state, member).ok, 'assigned member can sign in');
ok(!S.maySignIn(state, stranger).ok, 'unassigned person cannot sign in');
ok(S.maySignIn(state, stranger).reason==='nothing-assigned','right refusal reason');
ok(!S.maySignIn(state, S.personByEmail(state,'nobody@x.in')).ok, 'unknown email refused');

console.log('— what leaves the server (reads) —');
const asCeo = S.pruneForUser(state, ceo);
ok(asCeo.projects.length===8, 'CEO gets all 8 projects');
ok(asCeo.deals.length===2 && asCeo.enablers.length===4, 'CEO gets deals and enablers');

const asLead = S.pruneForUser(state, lead);
ok(asLead.projects.length===1 && asLead.projects[0].name==='Morena', 'lead gets only their project');
let leadNodes=0; S.walkAll(asLead.projects[0], ()=>leadNodes++);
ok(leadNodes>200, 'lead gets the whole tree ('+leadNodes+' nodes)');
ok(asLead.deals.length===0, 'lead gets no offtake data');
ok(asLead.org.every(p=>p.id===lead.id||!p.email), 'lead receives no other email addresses');

const asMember = S.pruneForUser(state, member);
ok(asMember.projects.length===1, 'member gets only Morena');
let names=[]; S.walkAll(asMember.projects[0], n=>names.push(n.name));
ok(names.length===5, 'member gets 5 lines, not 263 (got '+names.length+')');
ok(asMember.projects[0].packages.length===1, 'other packages are absent entirely');
ok(!asMember.projects[0].baseline, 'no baseline curve for a member');
ok(asMember.projects[0].chg.length===1 && asMember.projects[0].chg[0].id==='c1', 'only changes on their own lines');
ok(asMember.tasks.length===1 && asMember.tasks[0].id==='t2', 'other people\'s tasks are absent');
const json = JSON.stringify(asMember);
ok(!json.includes('SOLAR MODULES'), 'no unrelated package names in the payload at all');
ok(!json.includes('h.singh@x.in'), 'no colleague email addresses in the payload');

console.log('— what the server accepts (writes) —');
const clone = o=>JSON.parse(JSON.stringify(o));

// member tries to edit someone else's activity
let evil = clone(state);
let victim=null; S.walkAll(evil.projects[0], n=>{ if(!victim && !n.children.length && n.owner!==member.id) victim=n; });
const victimProgBefore = victim.prog; victim.prog = (victim.prog===1?0.5:1); victim.name='HACKED';
let merged = S.mergeForUser(state, evil, member);
let check=null; S.walkAll(merged.projects[0], n=>{ if(n.id===victim.id) check=n; });
ok(check.name!=='HACKED' && check.prog===victimProgBefore, 'member cannot edit an activity that is not theirs');

// member edits their own activity
evil = clone(state);
let own=null; S.walkAll(evil.projects[0], n=>{ if(!own && n.owner===member.id) own=n; });
own.prog = 0.5; own.desc='mine';
merged = S.mergeForUser(state, evil, member);
S.walkAll(merged.projects[0], n=>{ if(n.id===own.id) check=n; });
ok(check.prog===0.5 && check.desc==='mine', 'member can edit their own activity');

// member tries to become an administrator
evil = clone(state);
evil.org.find(p=>p.id===member.id).admin = true;
merged = S.mergeForUser(state, evil, member);
ok(!merged.org.find(p=>p.id===member.id).admin, 'member cannot grant themselves CEO access');

// member tries to rewrite the directory / delete a project / edit offtake
evil = clone(state);
evil.org.push({id:'zz',name:'Ghost',email:'ghost@x.in',admin:true});
evil.projects.splice(1,1);
evil.deals[0].capTalks = 9999;
evil.enablers[0].status='Done';
merged = S.mergeForUser(state, evil, member);
ok(merged.org.length===state.org.length, 'member cannot add people');
ok(merged.projects.length===8, 'member cannot delete a project');
ok(merged.deals[0].capTalks!==9999, 'member cannot touch offtake');
ok(merged.enablers[0].status!=='Done', 'member cannot close an enabler');

// member tries to clear their own CEO request
evil = clone(state); evil.asks[0].status='done';
merged = S.mergeForUser(state, evil, member);
ok(merged.asks[0].status==='open', 'member cannot clear an item raised with the CEO');

// member tries to steal another person's task
evil = clone(state); evil.tasks[0].title='STOLEN'; evil.tasks[0].owner=member.id;
merged = S.mergeForUser(state, evil, member);
ok(merged.tasks.find(t=>t.id==='t1').title==='CEO private task', 'member cannot rewrite a task that is not theirs');

// lead has full control of their own project but not another
evil = clone(state);
evil.projects[0].name='Morena Phase II';
evil.projects[0].packages[0].name='RENAMED BY LEAD';
evil.projects[1].name='SHOULD NOT CHANGE';
merged = S.mergeForUser(state, evil, lead);
ok(merged.projects[0].name==='Morena Phase II', 'lead can rename their project');
ok(merged.projects[0].packages[0].name==='RENAMED BY LEAD', 'lead can restructure their project');
ok(merged.projects[1].name!=='SHOULD NOT CHANGE', 'lead cannot touch another project');

// last administrator cannot be removed
evil = clone(state); evil.org.forEach(p=>p.admin=false);
merged = S.mergeForUser(state, evil, ceo);
ok(merged.org.some(p=>p.admin), 'the last administrator is protected');

// CEO can do the lot
evil = clone(state); evil.projects[3].name='Rajasthan Phase I'; evil.deals[0].capTalks=250;
merged = S.mergeForUser(state, evil, ceo);
ok(merged.projects[3].name==='Rajasthan Phase I' && merged.deals[0].capTalks===250, 'CEO can change anything');

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
