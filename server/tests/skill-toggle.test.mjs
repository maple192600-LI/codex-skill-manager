import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createActions} from '../actions.mjs';

function setup(t,{enabled=true,pluginId=null,confirm=true,inline=false,loseOther=false}={}) {
  const calls=[];
  const base=process.env.SKILL_MANAGER_USAGE_TEST_DIR||os.tmpdir();fs.mkdirSync(base,{recursive:true});
  const dir=fs.mkdtempSync(path.join(base,'skill-toggle-test-'));
  const file=path.join(dir,'config.toml');
  const skill={name:'fixture',path:'C:\\fixture\\SKILL.md',enabled,pluginId};
  const other={path:'C:\\other\\SKILL.md',enabled:false};
  let entries=[other];
  const persist=()=>fs.writeFileSync(file,inline?'[skills]\nconfig = [{path="C:\\\\other\\\\SKILL.md",enabled=false}]\n':entries.map(e=>`[[skills.config]]\npath = ${JSON.stringify(e.path)}\nenabled = ${e.enabled}\n`).join('\n'));
  persist();
  const actions=createActions({inventory:async()=>{throw new Error('unrelated plugin scan must not run');},request:async(method,params)=>{
    calls.push(method);
    if(method==='config/read')return {layers:[{name:{type:'user',file},version:'opaque-native-version',config:{skills:{config:entries.map(e=>({...e}))}}}]};
    if(method==='skills/list')return {data:[{skills:[{...skill}]}]};
    assert.equal(method,'skills/config/write');
    if(confirm){skill.enabled=params.enabled;entries=[...(loseOther?[]:entries),{path:skill.path,enabled:params.enabled}];persist();}
    return {};
  }});
  const args={kind:'skill',id:skill.path,enabled:false,expectedEnabled:true};
  return {actions,args,calls};
}
test('skill switch succeeds even when full plugin inventory is unavailable',async t=>{
  const {actions,args,calls}=setup(t);
  const result=await actions.setEnabled(args);
  assert.equal(result.ok,true);
  assert.deepEqual(result.skillStates,[{id:args.id,enabled:false}]);
  assert.deepEqual(calls,['skills/list','config/read','skills/config/write','skills/list','config/read']);
});
test('skill switch checks concurrent changes before writing',async t=>{
  const {actions,args,calls}=setup(t,{enabled:false});
  await assert.rejects(actions.setEnabled({...args,enabled:true}),/状态已变化/);
  assert.ok(!calls.includes('skills/config/write'));
});
test('plugin-owned skill uses its own native setting without changing its siblings',async t=>{
  const {actions,args,calls}=setup(t,{pluginId:'fixture@market'});
  const result=await actions.setEnabled(args);
  assert.equal(result.ok,true);
  assert.equal(result.skillStates[0].enabled,false);
  assert.ok(calls.includes('skills/config/write'));
});
test('switch shows observed state when write does not take effect',async t=>{
  const {actions,args}=setup(t,{confirm:false});
  const result=await actions.setEnabled(args);
  assert.equal(result.ok,false);
  assert.equal(result.skillStates[0].enabled,true);
});

test('refuses inline skill configuration before native write can discard other disabled skills',async t=>{
  const {actions,args,calls}=setup(t,{inline:true});
  await assert.rejects(actions.setEnabled(args),/配置格式/);
  assert.ok(!calls.includes('skills/config/write'));
});

test('never reports success when the target changes but another configuration entry disappears',async t=>{
  const {actions,args}=setup(t,{loseOther:true});
  await assert.rejects(actions.setEnabled(args),/其他技能/);
});
