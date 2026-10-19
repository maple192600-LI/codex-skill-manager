import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter,once} from 'node:events';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {buildUsageReport,compactEvent,DAY,sourceLabel,independentlyManaged} from '../usage-data.mjs';
import {createUsageService} from '../usage.mjs';
import {matchesUsage,compareUsage} from '../../shared/usage-view.mjs';

const now=Date.UTC(2026,9,19,8),at=now-DAY;
const items=[{kind:'plugin',id:'sample@personal'},{kind:'mcp',id:'sample@personal:svc',name:'svc',parentPlugin:'sample@personal'},{kind:'skill',id:'C:/skills/one/SKILL.md',path:'C:/skills/one/SKILL.md',scope:'user',parentPlugin:'sample@personal'},{kind:'skill',id:'unused',path:'C:/skills/two/SKILL.md',scope:'user'}];
const tool={type:'tool',at,server:'svc',tool:'search',pluginId:'sample@personal',status:'completed'};
const index=events=>({completedAt:now,threads:{root:{root:'root',hasUser:true,missing:false,activityAt:at,events},other:{root:'other',hasUser:true,missing:false,activityAt:at,events:{}}}});

test('rates count root chats once while calls and failure outcomes remain separate',()=>{
  const data=index({a:tool,b:{...tool,status:'failed'}});
  data.threads.child={root:'root',hasUser:false,activityAt:at,events:{c:tool}};
  const report=buildUsageReport(items,data,{now});
  const p=report.items['plugin:sample@personal'];
  assert.equal(report.activeChats,2);assert.equal(p.chats,1);assert.equal(p.rate,.5);
  assert.equal(p.calls,3);assert.equal(p.success,2);assert.equal(p.failed,1);
  assert.equal(report.items['mcp:sample@personal:svc'].calls,3);
});
test('skill reads never count as selected use or parent plugin use',()=>{
  const report=buildUsageReport(items,index({a:{type:'read',at,paths:['c:\\SKILLS\\one\\SKILL.md']}}),{now});
  const skill=report.items['skill:C:/skills/one/SKILL.md'];
  assert.equal(skill.status,'unknown');assert.equal(skill.rate,null);assert.equal(skill.chats,0);
  assert.equal(report.items['plugin:sample@personal'].chats,0);
});
test('structured selection alone does not prove that a skill was applied',()=>{
  const aliases=[...items];aliases[2]={...items[2],locations:[{path:items[2].path,realPath:'D:/real/one/SKILL.md'}]};
  const report=buildUsageReport(aliases,index({a:{type:'user',at,skills:[{path:'D:/real/one/SKILL.md'},{path:items[2].path}]}}),{now});
  assert.equal(report.items['skill:C:/skills/one/SKILL.md'].selectedChats,0);
  assert.equal(report.items['plugin:sample@personal'].chats,0);
  assert.equal(compactEvent({at,item_type:'agentMessage',text:'use one/SKILL.md'}),null);
});
test('30 day counts omit older use but preserve the last known use within 90 days',()=>{
  const report=buildUsageReport(items,index({a:{...tool,at:now-60*DAY}}),{days:30,now});
  assert.equal(report.items['plugin:sample@personal'].calls,0);
  assert.equal(report.items['plugin:sample@personal'].lastUsedAt,now-60*DAY);
});
test('no cache and unsupported categories cannot be represented as zero percent use',()=>{
  const report=buildUsageReport([...items,{kind:'command',id:'cmd'}],null,{now});
  assert.equal(report.items['skill:unused'].status,'unknown');assert.equal(report.items['skill:unused'].rate,null);
  assert.equal(report.items['command:cmd'].status,'unsupported');
  assert.equal(matchesUsage(report.items['skill:unused'],'idle'),false);
});
test('ambiguous unlabelled MCP ownership is not guessed',()=>{
  const duplicate=[...items,{kind:'mcp',id:'svc',name:'svc'}];
  const report=buildUsageReport(duplicate,index({a:{...tool,pluginId:null}}),{now});
  assert.equal(report.items['mcp:svc'].calls,0);assert.equal(report.items['mcp:sample@personal:svc'].calls,0);
});
test('plugin aggregates uniquely owned child MCP and app calls even without a historical plugin id',()=>{
  const all=[...items,{kind:'app',id:'connector',parentPlugin:'sample@personal'}];
  const report=buildUsageReport(all,index({a:{...tool,pluginId:null},b:{...tool,server:'apps',appId:'connector',pluginId:null}}),{now});
  assert.equal(report.items['plugin:sample@personal'].calls,2);assert.equal(report.items['plugin:sample@personal'].chats,1);
  assert.equal(report.items['app:connector'].calls,1);
});
test('discovery, connection checks and unfinished calls do not count as tool use',()=>{
  for(const name of ['tools/list','initialize','skill_manager_check_connection'])assert.equal(compactEvent({at,item_type:'mcpToolCall',status:'completed',tool:name}),null);
  assert.equal(compactEvent({at,item_type:'mcpToolCall',status:'inProgress',tool:'search'}),null);
  assert.equal(compactEvent({at,item_type:'mcpToolCall',status:'failed',tool:'search'}).status,'failed');
});
test('only direct read commands or parsed reads create weak skill evidence',()=>{
  assert.deepEqual(compactEvent({at,item_type:'commandExecution',status:'completed',command:"Get-Content -LiteralPath 'C:/one/SKILL.md'"}).paths,['C:/one/SKILL.md']);
  assert.equal(compactEvent({at,item_type:'commandExecution',status:'completed',command:"rg 'C:/one/SKILL.md' log.json"}),null);
  assert.equal(compactEvent({at,item_type:'commandExecution',status:'completed',command:"echo Get-Content 'C:/one/SKILL.md'"}),null);
});
test('idle filters exclude incomplete skill history; ordering keeps unknown at end',()=>{
  assert.equal(matchesUsage({status:'unknown'},'idle'),false);
  assert.equal(matchesUsage({status:'unknown'},'idle'),false);
  assert.equal(compareUsage({status:'unknown'},{status:'observed',chats:9},'least'),1);
  assert.equal(compareUsage({status:'observed',uses:2},{status:'no-record',uses:0},'most'),-2);
});
test('source descriptions do not claim the user installed bundled skills',()=>{
  assert.equal(sourceLabel(items[2]),'随插件提供');assert.equal(independentlyManaged(items[2]),false);
  assert.equal(sourceLabel({kind:'skill',scope:'system'}),'Codex 自带');assert.equal(independentlyManaged({kind:'skill',scope:'system'}),false);
});

function fixture() {
  const base=process.env.SKILL_MANAGER_USAGE_TEST_DIR||os.tmpdir();fs.mkdirSync(base,{recursive:true});
  const home=fs.mkdtempSync(path.join(base,'usage-fixture-'));
  const state=new DatabaseSync(path.join(home,'state_5.sqlite'));
  state.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,source TEXT,updated_at INTEGER);CREATE TABLE thread_spawn_edges(child_thread_id TEXT,parent_thread_id TEXT);');
  const put=state.prepare('INSERT INTO threads VALUES(?,?,?)');
  put.run('root','vscode',Math.floor(now/1000));put.run('child',JSON.stringify({subagent:{thread_spawn:{parent_thread_id:'root'}}}),Math.floor(now/1000));put.run('missing','vscode',Math.floor(now/1000));put.run('review',JSON.stringify({subagent:'review'}),Math.floor(now/1000));
  state.close();
  const history=new DatabaseSync(path.join(home,'thread_history_1.sqlite'));
  history.exec('CREATE TABLE thread_items(thread_id TEXT,item_id TEXT,updated_at_ordinal INTEGER,created_at_ms INTEGER,started_at_ms INTEGER,item_type TEXT,item_json TEXT);CREATE INDEX updated ON thread_items(thread_id,updated_at_ordinal);');
  const insert=history.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?,?)');
  insert.run('root','user',1,at,at,'userMessage',JSON.stringify({type:'userMessage',content:[{type:'text',text:'PRIVATE NOT TO CACHE'},{type:'skill',path:items[2].path,name:'one'}]}));
  insert.run('child','tool',1,at,at,'mcpToolCall',JSON.stringify({server:'svc',tool:'search',pluginId:'sample@personal',status:'failed',arguments:{secret:'PRIVATE NOT TO CACHE'},result:{content:'PRIVATE NOT TO CACHE'}}));
  // More than one page with a tied update ordinal must not skip events.
  for(let n=0;n<270;n++)insert.run('root',`call-${String(n).padStart(3,'0')}`,2,at,at,'mcpToolCall',JSON.stringify({server:'svc',tool:'search',pluginId:'sample@personal',status:'completed'}));
  history.close();return home;
}
function runWorker(home,previous) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../usage-worker.mjs',import.meta.url),{workerData:{codexHome:home,now,previous}});
    let result;
    worker.on('message',message=>{if(message.error)reject(new Error(message.error));if(message.index)result=message.index;});
    worker.on('error',reject);worker.on('exit',()=>result?resolve(result):reject(new Error('worker returned no index')));
  });
}
test('actual SQLite worker preserves tied pagination, parent attribution, gaps and read-only source data',async()=>{
  const home=fixture(),before=fs.readFileSync(path.join(home,'thread_history_1.sqlite'));
  const indexed=await runWorker(home);
  assert.equal(indexed.coverage.missing,1);assert.equal(indexed.threads.review,undefined);
  assert.equal(Object.keys(indexed.threads.root.events).length,271);
  assert.equal(buildUsageReport(items,indexed,{now}).items['plugin:sample@personal'].calls,271);
  assert.equal(JSON.stringify(indexed).includes('PRIVATE NOT TO CACHE'),false);
  assert.deepEqual(fs.readFileSync(path.join(home,'thread_history_1.sqlite')),before);
  const history=new DatabaseSync(path.join(home,'thread_history_1.sqlite'));
  history.prepare("UPDATE thread_items SET updated_at_ordinal=3,item_json=json_set(item_json,'$.status','completed') WHERE item_id='tool'").run();history.close();
  indexed.threads.child.checkedAt=0;
  const updated=await runWorker(home,indexed),report=buildUsageReport(items,updated,{now});
  assert.equal(report.items['plugin:sample@personal'].calls,271);assert.equal(report.items['plugin:sample@personal'].failed,0);
});
test('service returns immediately while indexing and preserves cached report on worker failure',async()=>{
  const home=fixture(),cacheFile=path.join(home,'cache.json');
  fs.writeFileSync(cacheFile,JSON.stringify({...index({a:tool}),version:2,analysisRevision:'receipts-3'}));
  let worker;
  const service=createUsageService({cacheFile,now:()=>now+120_000,workerFactory:()=>{worker=new EventEmitter();worker.unref=()=>{};return worker;}});
  const pending=service.get(items,{refresh:true});assert.equal(pending.state,'running');assert.equal(pending.items['plugin:sample@personal'].calls,1);
  worker.emit('error',new Error('locked'));worker.emit('exit',1);
  const failed=service.get(items);assert.equal(failed.state,'error');assert.equal(failed.items['plugin:sample@personal'].calls,1);
  assert.ok(failed.error);assert.equal(items[0].enabled,undefined);
});
