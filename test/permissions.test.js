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
morena.chg=[{id:'c1',date:'2026-08-01',item:'Land requirement',path:'B/2',from:'a',to:'b',impact:'Scope',by:'CEO'},
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
ok(asCeo.projects.length===state.projects.length, 'admin gets every project');
ok(asCeo.deals.length===2 && asCeo.enablers.length===4, 'admin gets deals and enablers');

const asOwner = S.pruneForUser(state, lead);
ok(asOwner.projects.length===1 && asOwner.projects[0].name==='Morena', 'an owner gets only their project');
let ownerNodes=0; S.walkAll(asOwner.projects[0], ()=>ownerNodes++);
ok(ownerNodes>200, 'an owner gets their project whole ('+ownerNodes+' items)');
ok(asOwner.deals.length===0, 'an owner gets no offtake data');
ok(asOwner.org.every(p=>p.id===lead.id||!p.email), 'an owner receives no other email addresses');

const asOther = S.pruneForUser(state, member);
ok(asOther.projects.length===0, 'somebody who owns no project is sent no project at all');
const json = JSON.stringify(asOther);
ok(!json.includes('SOLAR MODULES'), 'no package names reach them');
ok(!json.includes('h.singh@x.in'), 'no colleague email addresses reach them');

console.log('— what the server accepts (writes) —');
const clone = o=>JSON.parse(JSON.stringify(o));

// the owner runs their own project outright
let evil = clone(state);
evil.projects[0].name='Morena Phase II';
evil.projects[0].packages[0].name='RENAMED BY OWNER';
evil.projects[1].name='SHOULD NOT CHANGE';
let merged = S.mergeForUser(state, evil, lead);
ok(merged.projects[0].name==='Morena Phase II', 'owner can rename their project');
ok(merged.projects[0].packages[0].name==='RENAMED BY OWNER', 'owner can restructure their project');
ok(merged.projects[1].name!=='SHOULD NOT CHANGE', 'owner cannot touch another project');

// but cannot hand it on, or promote themselves
evil = clone(state);
evil.projects[0].head='someone-else';
evil.org.find(p=>p.id===lead.id).admin = true;
merged = S.mergeForUser(state, evil, lead);
ok(merged.projects[0].head===lead.id, 'owner cannot hand their project to somebody else');
ok(!merged.org.find(p=>p.id===lead.id).admin, 'owner cannot grant themselves full access');

// somebody with no project cannot change one
evil = clone(state);
evil.projects[0].name='HACKED';
merged = S.mergeForUser(state, evil, member);
ok(merged.projects[0].name!=='HACKED', 'a non-owner cannot change a project');

// directory, offtake and enablers stay with administrators
evil = clone(state);
evil.org.push({id:'zz',name:'Ghost',email:'ghost@x.in',admin:true});
evil.projects.splice(1,1);
evil.deals[0].capTalks = 9999;
evil.enablers[0].status='Done';
merged = S.mergeForUser(state, evil, lead);
ok(merged.org.length===state.org.length, 'owner cannot add people');
ok(merged.projects.length===state.projects.length, 'owner cannot delete a project');
ok(merged.deals[0].capTalks!==9999, 'owner cannot touch offtake');
ok(merged.enablers[0].status!=='Done', 'owner cannot close an enabler');

// own tasks and own CEO requests
evil = clone(state); evil.asks[0].status='done';
merged = S.mergeForUser(state, evil, member);
ok(merged.asks[0].status==='open', 'nobody but an admin clears an item raised with the CEO');
evil = clone(state); evil.tasks[0].title='STOLEN'; evil.tasks[0].owner=member.id;
merged = S.mergeForUser(state, evil, member);
ok(merged.tasks.find(t=>t.id==='t1').title==='CEO private task', 'cannot rewrite somebody else\'s task');

// the last administrator is protected
evil = clone(state); evil.org.forEach(p=>p.admin=false);
merged = S.mergeForUser(state, evil, ceo);
ok(merged.org.some(p=>p.admin), 'the last administrator is protected');

// an admin can do the lot
evil = clone(state); evil.projects[3].name='Rajasthan Phase I'; evil.deals[0].capTalks=250;
merged = S.mergeForUser(state, evil, ceo);
ok(merged.projects[3].name==='Rajasthan Phase I' && merged.deals[0].capTalks===250, 'an admin can change anything');

// numbering repair
const renum = require('../lib/renumber');
const doc = clone(state);
doc.projects[0].packages[0].code='C1';
doc.projects[0].packages[0].children[0].code='i';
ok(renum.needsRenumber(doc), 'old codes are detected');
renum.renumberAll(doc);
ok(!renum.needsRenumber(doc), 'old codes are repaired');
ok(doc.projects[0].packages[0].code==='A', 'packages become letters');
ok(doc.projects[0].packages[1].children[0].children[0].code==='1.1', 'subtasks become decimals');
ok(!JSON.stringify(doc.standardTemplate).match(/"code":"[a-z]+"/), 'the standard template is clean too');

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
