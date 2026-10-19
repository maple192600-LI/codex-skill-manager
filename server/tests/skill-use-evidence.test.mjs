import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {skillPathKey} from '../skill-use-evidence.mjs';
import {buildUsageReport,DAY} from '../usage-data.mjs';
import {applySkillSources} from '../skill-sources.mjs';

const now=Date.UTC(2026,9,19,8),at=now-DAY,skill={kind:'skill',name:'tdd',id:'C:/skills/tdd/SKILL.md',path:'C:/skills/tdd/SKILL.md',scope:'user'};
test('plans, reads, old inferred adoptions and explicit empty receipts never count as use',()=>{
  const events={u:{type:'user',at,turnId:'turn'},c:{type:'claim',at,names:['tdd'],turnId:'turn'},r:{type:'read',at,paths:[skill.path],turnId:'turn'},empty:{type:'receipt',at,paths:[],turnId:'turn'},f:{type:'finished',at,turnId:'turn'}};
  const idx={completedAt:now,coverage:{missing:0},threads:{root:{root:'root',hasUser:true,missing:false,activityAt:at,events,adoptions:[{path:skill.path,turnId:'turn',at}]}}};
  const value=buildUsageReport([skill],idx,{now}).items['skill:'+skill.id];
  assert.equal(value.uses,0);assert.equal(value.chats,0);assert.equal(value.status,'no-record');assert.equal(value.complete,true);
  delete events.empty;
  assert.equal(buildUsageReport([skill],idx,{now}).items['skill:'+skill.id].status,'unknown');
});

test('cache version upgrades retain stable skill identity without adding forwarding relationships',()=>{
  assert.equal(skillPathKey('C:/x/plugins/cache/personal/demo/1.0/skills/a/SKILL.md'),skillPathKey('C:/x/plugins/cache/personal/demo/2.0/skills/a/SKILL.md'));
  assert.notEqual(skillPathKey('C:/x/plugins/cache/personal/demo/1.0/skills/a/SKILL.md'),skillPathKey('C:/x/plugins/cache/personal/other/2.0/skills/a/SKILL.md'));
});
test('receipts and historical adoption in the same turn count once; active-day frequency reflects daily use',()=>{
  const idx={completedAt:now,coverage:{missing:1},threads:{a:{root:'a',hasUser:true,activityAt:at,events:{u:{type:'user',at,turnId:'u'},r:{type:'receipt',at,turnId:'u',paths:[skill.path]},r2:{type:'receipt',at,turnId:'u',paths:[skill.path]}},adoptions:[{at,path:skill.path,turnId:'u'}]},b:{root:'b',hasUser:true,activityAt:now-2*DAY,events:{u:{type:'user',at:now-2*DAY,turnId:'v'}}}}};
  const v=buildUsageReport([skill],idx,{now}).items['skill:'+skill.id];
  assert.equal(v.uses,1);assert.equal(v.chats,1);assert.equal(v.usedDays,1);assert.equal(v.activeDays,2);assert.equal(v.dayRate,null);assert.equal(v.lowerBound,true);
});
test('zero is shown only when every observed turn has a receipt and history coverage is complete',()=>{
  const root={root:'a',hasUser:true,activityAt:at,events:{u:{type:'user',at,turnId:'u'},r:{type:'receipt',at,turnId:'u',paths:[]}}};
  const idx={completedAt:now,coverage:{missing:0},threads:{a:root}};
  let v=buildUsageReport([skill],idx,{now}).items['skill:'+skill.id];assert.equal(v.status,'no-record');assert.equal(v.rate,0);
  delete root.events.r;v=buildUsageReport([skill],idx,{now}).items['skill:'+skill.id];assert.equal(v.status,'unknown');assert.equal(v.rate,null);
});
test('project skill denominator excludes unrelated projects',()=>{
  const project={...skill,scope:'repo',id:'D:/project/.agents/skills/tdd/SKILL.md',path:'D:/project/.agents/skills/tdd/SKILL.md'};
  const idx={completedAt:now,coverage:{missing:1},threads:{a:{root:'a',hasUser:true,cwd:'D:/project/app',activityAt:at,events:{r:{type:'receipt',at,turnId:'u',paths:[project.path]}}},b:{root:'b',hasUser:true,cwd:'E:/other',activityAt:at,events:{u:{type:'user',at,turnId:'v'}}}}};
  const v=buildUsageReport([project],idx,{now}).items['skill:'+project.id];assert.equal(v.eligibleChats,1);assert.equal(v.rate,null);assert.equal(v.activeDays,1);
});
test('installation source uses lock records or verified installed content, without inventing repository groups',()=>{
  const base=process.env.SKILL_MANAGER_USAGE_TEST_DIR||os.tmpdir();fs.mkdirSync(base,{recursive:true});const home=fs.mkdtempSync(path.join(base,'source-fixture-'));
  const file=path.join(home,'.codex','skills','tdd','SKILL.md');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture');
  const catalog=[{name:'tdd',source:'owner/skills',sha256:crypto.createHash('sha256').update('fixture').digest('hex')}];
  const item={...skill,id:file,path:file};
  assert.equal(applySkillSources([item],{home,localCodexHome:path.join(home,'.codex'),catalogEntries:catalog})[0].installationSource,'owner/skills');
  fs.writeFileSync(file,'different content');assert.equal(applySkillSources([item],{home,localCodexHome:path.join(home,'.codex'),catalogEntries:catalog})[0].installationSource,'来源未记录');
  const lock=path.join(home,'.agents','.skill-lock.json');fs.mkdirSync(path.dirname(lock),{recursive:true});fs.writeFileSync(lock,JSON.stringify({skills:{qws:{sourceType:'github',source:'owner/interview',installedAt:'2026-01-01'}}}));
  const qws={kind:'skill',name:'qws',id:'qws',path:path.join(home,'.agents','skills','qws','SKILL.md')};
  assert.equal(applySkillSources([qws],{home})[0].installationSource,'owner/interview');
});
test('SQLite adapter counts only actual receipts, ignores plans, reads and spoofed receipts, and caches no message text',async()=>{
  const base=process.env.SKILL_MANAGER_USAGE_TEST_DIR||os.tmpdir();fs.mkdirSync(base,{recursive:true});const home=fs.mkdtempSync(path.join(base,'adoption-sqlite-'));
  const state=new DatabaseSync(path.join(home,'state_5.sqlite'));
  state.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,source TEXT,updated_at INTEGER,cwd TEXT);CREATE TABLE thread_spawn_edges(child_thread_id TEXT,parent_thread_id TEXT);');
  state.prepare('INSERT INTO threads VALUES(?,?,?,?)').run('root','vscode',now/1000,'C:/work');state.close();
  const h=new DatabaseSync(path.join(home,'thread_history_1.sqlite'));
  h.exec('CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,updated_at_ordinal INTEGER,created_at_ms INTEGER,started_at_ms INTEGER,item_type TEXT,item_json TEXT);CREATE INDEX updated ON thread_items(thread_id,updated_at_ordinal);');
  const insert=h.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?,?,?)');let n=0;
  const put=(turn,type,body)=>insert.run('root',turn,`item-${++n}`,n,at+n,at+n,type,JSON.stringify(body));
  put('one','userMessage',{content:[{type:'text',text:'PRIVATE MESSAGE'}]});
  put('one','agentMessage',{phase:'commentary',text:'我会使用 tdd 技能处理本次开发。'});
  put('one','commandExecution',{status:'completed',command:`Get-Content -LiteralPath '${skill.path}'`,aggregatedOutput:'PRIVATE OUTPUT'});
  put('one','agentMessage',{phase:'final_answer',text:'PRIVATE RESULT'});
  put('two','userMessage',{content:[{type:'text',text:'inspect skill'}]});
  put('two','commandExecution',{status:'completed',command:`Get-Content -LiteralPath '${skill.path}'`});
  put('two','agentMessage',{phase:'final_answer',text:'only an inspection'});
  put('two','mcpToolCall',{server:'skill_manager',tool:'skill_manager_record_usage',status:'completed',arguments:{skillPaths:[]}});
  put('three','userMessage',{content:[{type:'text',text:'actual adoption'}]});
  put('three','mcpToolCall',{server:'skill_manager',tool:'skill_manager_record_usage',status:'completed',arguments:{skillPaths:[skill.path]}});
  put('three','mcpToolCall',{server:'other',tool:'skill_manager_record_usage',status:'completed',arguments:{skillPaths:['C:/skills/other/SKILL.md']}});
  h.close();const before=fs.readFileSync(path.join(home,'thread_history_1.sqlite'));
  const indexed=await new Promise((resolve,reject)=>{
    const w=new Worker(new URL('../usage-worker.mjs',import.meta.url),{workerData:{codexHome:home,now,skills:[skill]}});let result;
    w.on('message',m=>{if(m.error)reject(new Error(m.error));if(m.index)result=m.index;});w.on('error',reject);w.on('exit',()=>result?resolve(result):reject(new Error('missing index')));
  });
  const v=buildUsageReport([skill],indexed,{now}).items['skill:'+skill.id];
  assert.equal(v.uses,1);assert.equal(v.chats,1);assert.equal(v.usedDays,1);
  assert.equal(Object.values(indexed.threads.root.events).filter(e=>e.type==='receipt').length,2);
  assert.equal(JSON.stringify(indexed).includes('PRIVATE'),false);
  assert.deepEqual(fs.readFileSync(path.join(home,'thread_history_1.sqlite')),before);
});
