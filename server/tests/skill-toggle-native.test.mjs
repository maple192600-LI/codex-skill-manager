import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createActions} from '../actions.mjs';
import {appServerRequest} from '../codex.mjs';

function fixture(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'skill-state-preservation-'));
  t.after(async()=>{if(process.env.SKILL_MANAGER_KEEP_TEST_FIXTURES==='1')return;assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert.ok(path.basename(home).startsWith('skill-state-preservation-'));await fs.promises.rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const skills=['kept-one','kept-two','switched'].map(name=>{
    const dir=path.join(home,'skills',name);fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,'SKILL.md');fs.writeFileSync(file,`---\nname: ${name}\ndescription: Isolated state preservation test.\n---\nTest fixture.\n`);
    return {path:file,enabled:false};
  });
  fs.writeFileSync(path.join(home,'config.toml'),skills.slice(0,2).map(e=>`[[skills.config]]\npath=${JSON.stringify(e.path)}\nenabled=false\n`).join('\n'));
  const request=(method,params,options={})=>appServerRequest(method,params,{...options,cwd:home,env:{...process.env,CODEX_HOME:home}});
  const actions=createActions({request});
  const read=async()=>{const r=await request('skills/list',{cwds:[home],forceReload:true});return r.data.flatMap(d=>d.skills||[]);};
  return {home,skills,request,actions,read};
}

test('native switch preserves other disabled records across independent readers and repeated switches',async t=>{
  const f=fixture(t),id=f.skills[2].path;
  for(const enabled of [false,true,false]){
    const result=await f.actions.setEnabled({kind:'skill',id,cwd:f.home,enabled,expectedEnabled:!enabled});
    assert.equal(result.ok,true);
    const reopened=await f.read();
    assert.equal(reopened.find(s=>s.path===id).enabled,enabled);
    for(const other of f.skills.slice(0,2))assert.equal(reopened.find(s=>s.path===other.path).enabled,false);
  }
});

test('a changed batch-write format is rejected before native switching can erase disabled records',async t=>{
  const f=fixture(t);
  const config=await f.request('config/read',{includeLayers:true});
  const layer=config.layers.find(l=>l.name.type==='user');
  // A real change is essential: an identical value is a no-op and retains AOT.
  await f.request('config/batchWrite',{filePath:layer.name.file,expectedVersion:layer.version,edits:[{keyPath:'skills.config',value:f.skills.slice(0,1),mergeStrategy:'replace'}]});
  const before=fs.readFileSync(path.join(f.home,'config.toml'));
  await assert.rejects(f.actions.setEnabled({kind:'skill',id:f.skills[2].path,cwd:f.home,enabled:false,expectedEnabled:true}),/配置格式/);
  assert.deepEqual(fs.readFileSync(path.join(f.home,'config.toml')),before);
  assert.equal((await f.read()).find(s=>s.path===f.skills[0].path).enabled,false);
});
