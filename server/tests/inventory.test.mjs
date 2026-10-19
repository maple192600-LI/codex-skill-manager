import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectPath,discoverSkills,mcpLocations} from '../locations.mjs';
import {applyTranslations,contentHash,TranslationQueue,readTranslationStore} from '../translations.mjs';
import {buildInventory} from '../inventory.mjs';
import {createActions} from '../actions.mjs';
import {CodexAppServer,runCodexCli} from '../codex.mjs';
import {createBridge} from '../../ui/src/bridge.js';
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skill-manager-test-'));
  t.after(async()=>{if(process.env.SKILL_MANAGER_KEEP_TEST_FIXTURES==='1')return;assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(dir).startsWith('skill-manager-test-'));await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  return dir;
}
test('direct bridge never settles: bounded error replaces infinite spinner',async()=>{
  const bridge=createBridge({openai:{callTool:()=>new Promise(()=>{})}},{timeoutMs:20});
  await assert.rejects(bridge.call('inventory'),/超时/);
});
test('business errors reject and mutations are never dispatched twice',async()=>{
  let calls=0;
  const bridge=createBridge({openai:{callTool:async()=>{calls++;return {isError:true,content:[{type:'text',text:'denied'}]};}}});
  await assert.rejects(bridge.call('remove'),/denied/);assert.equal(calls,1);
});
test('standalone production page has an explicit connection error',async()=>{const host={};host.parent=host;await assert.rejects(createBridge(host).call('inventory'),/从 Codex 侧栏/);});
test('parent symlink and relative link chain reveal entry plus actual file',t=>{
  const dir=fixture(t),real=path.join(dir,'shared'),alias=path.join(dir,'entry'),alias2=path.join(dir,'entry2');fs.mkdirSync(real);fs.writeFileSync(path.join(real,'SKILL.md'),'demo');fs.symlinkSync(real,alias,'dir');fs.symlinkSync('entry',alias2,'dir');
  assert.equal(fs.lstatSync(path.join(alias,'SKILL.md')).isSymbolicLink(),false);
  const location=inspectPath(path.join(alias2,'SKILL.md'));assert.equal(location.status,'正常');assert.equal(location.type,'软链接');assert.equal(location.links.length,2);assert.equal(location.realPath,path.join(real,'SKILL.md'));
});
test('junction, broken target and cycle are distinguishable',t=>{
  const dir=fixture(t),real=path.join(dir,'real');fs.mkdirSync(real);fs.symlinkSync(real,path.join(dir,'junction'),process.platform==='win32'?'junction':'dir');assert.equal(inspectPath(path.join(dir,'junction')).type,process.platform==='win32'?'目录联接':'软链接');
  fs.symlinkSync(path.join(dir,'missing'),path.join(dir,'broken'),'dir');const broken=inspectPath(path.join(dir,'broken','SKILL.md'));assert.equal(broken.status,'目标不存在');assert.equal(broken.links.length,1);
  fs.symlinkSync(path.join(dir,'b'),path.join(dir,'a'),'dir');fs.symlinkSync(path.join(dir,'a'),path.join(dir,'b'),'dir');assert.equal(inspectPath(path.join(dir,'a')).status,'链接循环');
});
test('access denied remains distinct from missing',()=>{assert.equal(inspectPath(path.resolve('denied'),'entry',{lstatSync(){throw Object.assign(new Error('denied'),{code:'EACCES'});}}).status,'无权读取');});
test('discovery retains multiple aliases',t=>{const dir=fixture(t),real=path.join(dir,'shared'),root=path.join(dir,'skills');fs.mkdirSync(real);fs.mkdirSync(root);fs.writeFileSync(path.join(real,'SKILL.md'),'demo');fs.symlinkSync(real,path.join(root,'a'),'dir');fs.symlinkSync(real,path.join(root,'b'),'dir');const found=discoverSkills([{path:root,scope:'user'}]);assert.equal(found.length,2);assert.equal(found[0].location.realPath,found[1].location.realPath);});
test('MCP paths separate runtime from service and redact URL credentials',()=>{
  const locations=mcpLocations({command:process.execPath,args:['service.mjs'],cwd:os.tmpdir()},undefined,os.tmpdir());assert.ok(locations.some(l=>l.label==='启动程序'));assert.ok(locations.some(l=>l.label==='服务代码'));const net=mcpLocations({url:'https://user:pass@localhost/service?token=secret#x'});assert.equal(net[0].path,'https://localhost/service');assert.match(net[0].status,/本机地址/);
});
test('translation fingerprint tracks material, not version, identity or location',()=>{
  const item={kind:'skill',name:'demo',description:'one',sourceText:'full'};const hash=contentHash(item);assert.equal(hash,contentHash({...item,path:'moved',id:'new',version:'2'}));assert.notEqual(hash,contentHash({...item,sourceText:'changed'}));
});
test('reading translations has no write or model side effects',t=>{const file=path.join(fixture(t),'state.json');const [item]=applyTranslations([{kind:'plugin',id:'github',name:'github'}],file);assert.equal(item.chineseName,'GitHub');assert.equal(fs.existsSync(file),false);});
const modelResult=prompt=>({items:JSON.parse(prompt.split('\n').at(-1)).map(item=>({identity:item.identity,nameZh:'示例',summaryZh:'用途',descriptionZh:'说明',scenariosZh:['场景'],inputsZh:['输入'],outputsZh:['产出'],permissionsZh:['原始资料未说明'],risksZh:['原始资料未说明']}))});
test('translation once, concurrent windows, reopen, move and one added item',async t=>{
  const file=path.join(fixture(t),'translations.json'),item={kind:'skill',id:'a',name:'demo',description:'demo'};let count=0;
  const generate=async prompt=>{count++;await new Promise(r=>setTimeout(r,20));return modelResult(prompt);};const one=new TranslationQueue({file,generate}),two=new TranslationQueue({file,generate});
  one.enqueue([item]);two.enqueue([item]);await one.running;two.enqueue([item]);if(two.running)await two.running;assert.equal(count,1);
  const moved={...item,id:'new-location',path:'moved',version:'new'};const reopened=new TranslationQueue({file,generate});reopened.enqueue([moved]);assert.equal(count,1);assert.equal(applyTranslations([moved],file)[0].chineseName,'示例');
  reopened.enqueue([moved,{...item,id:'b',name:'another'}]);await reopened.running;assert.equal(count,2);
});
test('legacy Chinese preserved; translation cannot override live state/path',async t=>{
  const file=path.join(fixture(t),'translations.json'),item={kind:'skill',id:'a',name:'demo',path:'real',enabled:false};fs.writeFileSync(file,JSON.stringify({version:1,items:{'skill:a':{translationStatus:'Codex 自动翻译',chineseName:'已有中文',path:'stale',enabled:true}}}));
  const q=new TranslationQueue({file,generate:()=>{throw new Error('must not translate');}});q.enqueue([item]);await q.running;const [got]=applyTranslations([item],file);assert.equal(got.chineseName,'已有中文');assert.equal(got.enabled,false);assert.equal(got.path,'real');assert.equal(got.reviewNeeded,true);
});
test('failed translations retain successful work and only retry explicitly',async t=>{
  const file=path.join(fixture(t),'translations.json'),item={kind:'skill',id:'a',name:'demo'};let count=0;const q=new TranslationQueue({file,generate:async prompt=>{count++;if(count===1)throw new Error('offline');return modelResult(prompt);}});q.enqueue([item]);await q.running;q.enqueue([item]);assert.equal(count,1);assert.equal(q.status([item]).failed,1);q.enqueue([item],{retry:true});await q.running;assert.equal(count,2);assert.equal(q.status([item]).complete,1);
});
test('inventory remains usable when app source fails, without a redundant plugin metadata query',async()=>{
  const methods=[];
  const client={request:async method=>{methods.push(method);if(method==='app/installed')throw new Error('apps offline');if(method==='skills/list')return {data:[]};return {config:{},origins:{}};}};
  const r=await buildInventory({client,cli:async()=>({installed:[]})});assert.ok(r.warnings.some(w=>w.includes('apps offline')));assert.ok(r.items.every(i=>i.callable!==true));assert.equal(methods.includes('plugin/installed'),false);
});

test('failed plugin installation read is not reported as an empty successful inventory',async()=>{
  const result=await buildInventory({previous:{items:[]},client:{request:async()=>({})},cli:async()=>{throw new Error('plugin list timed out');}});
  assert.equal(result.partial,true);assert.equal(result.sourceStatus.plugin.state,'partial');assert.ok(result.warnings.some(w=>w.includes('plugin list timed out')));
});
test('skill entry removal preserves shared target and rejects changed fingerprint',async t=>{
  const dir=fixture(t),root=path.join(dir,'.agents','skills'),real=path.join(dir,'shared'),alias=path.join(root,'demo');fs.mkdirSync(root,{recursive:true});fs.mkdirSync(real);fs.writeFileSync(path.join(real,'SKILL.md'),'original');fs.symlinkSync(real,alias,'dir');
  const entry=path.join(alias,'SKILL.md'),location=inspectPath(entry);const item={kind:'skill',id:'demo',scope:'repo',locations:[location]};const inventory=async()=>({cwd:dir,items:fs.existsSync(entry)?[item]:[],counts:{}});const actions=createActions({inventory,storage:path.join(dir,'state'),save:()=>{}});
  await assert.rejects(actions.uninstall({kind:'skill',id:'demo',entry,fingerprint:'wrong'}),/变化/);assert.ok(fs.existsSync(entry));
  await actions.uninstall({kind:'skill',id:'demo',entry,fingerprint:location.fingerprint});assert.equal(fs.existsSync(alias),false);assert.equal(fs.readFileSync(path.join(real,'SKILL.md'),'utf8'),'original');
});
test('untrusted paths and plugin-owned skills cannot be removed',async()=>{
  const actions=createActions({inventory:async()=>({cwd:os.homedir(),items:[{kind:'skill',id:'owned',parentPlugin:'p@market',locations:[]} ]})});await assert.rejects(actions.uninstall({kind:'skill',id:'owned',entry:'C:\\Windows\\SKILL.md'}),/所属插件/);await assert.rejects(actions.uninstall({kind:'skill',id:'not-found'}),/不存在/);
});
test('native config write/read/remove round trip stays in isolated CODEX_HOME',async t=>{
  let client;
  t.after(async()=>{await client?.close();});
  const dir=fixture(t);fs.writeFileSync(path.join(dir,'config.toml'),'[mcp_servers.example]\ncommand = "node"\nenabled = true\n');client=new CodexAppServer({cwd:dir,env:{...process.env,CODEX_HOME:dir}});
  await client.request('config/batchWrite',{filePath:path.join(dir,'config.toml'),edits:[{keyPath:'mcp_servers."example".enabled',value:false,mergeStrategy:'upsert'}]});const disabled=await client.request('config/read',{includeLayers:true});assert.equal(disabled.config.mcp_servers.example.enabled,false);
  await client.request('config/batchWrite',{filePath:path.join(dir,'config.toml'),edits:[{keyPath:'mcp_servers."example"',value:null,mergeStrategy:'replace'}]});const removed=await client.request('config/read',{includeLayers:true});assert.equal(removed.config.mcp_servers.example,undefined);
  await client.close();
});

test('incomplete abandoned translation lock recovers without retranslating',async t=>{
  const file=path.join(fixture(t),'translations.json');
  fs.writeFileSync(`${file}.lock`,'');fs.utimesSync(`${file}.lock`,new Date(0),new Date(0));
  const q=new TranslationQueue({file,generate:async prompt=>modelResult(prompt)});
  q.enqueue([{kind:'skill',id:'a',name:'demo'}]);await q.running;
  assert.equal(q.status([{kind:'skill',id:'a',name:'demo'}]).complete,1);
});

test('open directory uses confirmed actual target and rejects arbitrary paths',async t=>{
  const dir=fixture(t),real=path.join(dir,'real'),alias=path.join(dir,'alias');
  fs.mkdirSync(real);fs.writeFileSync(path.join(real,'SKILL.md'),'demo');fs.symlinkSync(real,alias,'dir');
  const entry=path.join(alias,'SKILL.md'),location=inspectPath(entry),opened=[];
  const actions=createActions({inventory:async()=>({cwd:dir,items:[{kind:'skill',id:'demo',locations:[location]}]}),open:async target=>opened.push(target)});
  await actions.openLocation({kind:'skill',id:'demo',entry,target:'real',fingerprint:location.fingerprint});
  assert.deepEqual(opened,[real]);
  await assert.rejects(actions.openLocation({kind:'skill',id:'demo',entry:path.join(dir,'unknown'),fingerprint:location.fingerprint}),/未确认/);
});

test('native plugin install, disable, enable, remove and reopen in isolated home',async t=>{
  let client;
  t.after(async()=>{await client?.close();});
  const dir=fixture(t),home=path.join(dir,'home'),marketRoot=path.join(dir,'market'),source=path.join(marketRoot,'plugins','fixture'),market=path.join(marketRoot,'.agents','plugins','marketplace.json');
  fs.mkdirSync(home);fs.mkdirSync(path.dirname(market),{recursive:true});fs.mkdirSync(path.join(source,'.codex-plugin'),{recursive:true});
  fs.mkdirSync(path.join(source,'skills','demo'),{recursive:true});
  fs.writeFileSync(path.join(source,'skills','demo','SKILL.md'),'---\nname: demo\ndescription: Isolated lifecycle verification.\n---\nDescribe the test fixture.');
  fs.writeFileSync(path.join(source,'.codex-plugin','plugin.json'),JSON.stringify({name:'manager-test-fixture',version:'0.1.0',description:'Isolated lifecycle verification',skills:'./skills/'}));
  fs.writeFileSync(market,JSON.stringify({name:'manager-test-market',interface:{displayName:'Isolated test'},plugins:[{name:'manager-test-fixture',source:{source:'local',path:'./plugins/fixture'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]}));
  await runCodexCli(['plugin','marketplace','add',marketRoot,'--json'],{cwd:dir,env:{...process.env,CODEX_HOME:home}});
  client=new CodexAppServer({cwd:dir,env:{...process.env,CODEX_HOME:home}});
  await client.request('plugin/install',{marketplacePath:market,pluginName:'manager-test-fixture'});
  const id='manager-test-fixture@manager-test-market';
  const enabled=await client.request('config/read',{includeLayers:true});assert.equal(enabled.config.plugins[id].enabled,true);
  for(const value of [false,true]) {
    await client.request('config/batchWrite',{filePath:path.join(home,'config.toml'),edits:[{keyPath:`plugins.${JSON.stringify(id)}.enabled`,value,mergeStrategy:'upsert'}]});
    assert.equal((await client.request('config/read',{includeLayers:true})).config.plugins[id].enabled,value);
  }
  await client.request('plugin/uninstall',{pluginId:id});await client.close();
  client=new CodexAppServer({cwd:dir,env:{...process.env,CODEX_HOME:home}});
  assert.equal((await client.request('config/read',{includeLayers:true})).config.plugins?.[id],undefined);
  await client.close();
});
