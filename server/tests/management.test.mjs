import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {managementInfo,uninstallTarget} from '../../shared/management.mjs';
import {buildInventory} from '../inventory.mjs';
import {createActions} from '../actions.mjs';

test('ordinary plugins and standalone skills expose uninstall while bundled skills direct to owner',()=>{
  assert.equal(managementInfo({kind:'plugin',id:'p',actions:{remove:true}}).removalLabel,'卸载插件');
  assert.equal(managementInfo({kind:'skill',scope:'user',actions:{entries:[{path:'skill'}]}}).removalLabel,'卸载技能');
  const bundled=managementInfo({kind:'skill',parentPlugin:'p',parentEnabled:true});
  assert.equal(bundled.parentId,'p');assert.equal(bundled.removalLabel,undefined);assert.match(bundled.reason,/可单独开关/);
});
test('restrictions describe ownership or current evidence rather than inventing a permission denial',()=>{
  for(const item of [{kind:'plugin',managed:true},{kind:'skill',scope:'system'},{kind:'skill',scope:'user',actions:{entries:[]}},{kind:'plugin',stale:true},{kind:'plugin',id:'skill-manager@personal',actions:{remove:true}}]) {
    const info=managementInfo(item);assert.ok(info.reason);assert.equal(info.removalLabel,undefined);assert.doesNotMatch(info.reason,/没有权限|权限不足/);
  }
});
test('uninstall is distinct from toggling and bundled skills resolve only to their explicit removable owner',()=>{
  const parent={kind:'plugin',id:'owner',actions:{remove:true}},child={kind:'skill',id:'child',parentPlugin:'owner',parentEnabled:true,actions:{toggle:true}};
  assert.equal(uninstallTarget(child,[parent,child]),parent);
  assert.equal(child.actions.toggle,true);
  assert.equal(uninstallTarget({...child,stale:true},[parent]),null);
  assert.equal(uninstallTarget(child,[{...parent,managed:true,actions:{remove:false}}]),null);
  assert.equal(uninstallTarget({kind:'skill',id:'system',scope:'system'},[]),null);
});
test('bundled skill toggle follows confirmed parent state, while uninstall remains parent-owned',async()=>{
  const id='capability-test@openai-curated-remote',file='C:/fixture/one/SKILL.md';
  for(const enabled of [true,false]) {
    const result=await buildInventory({previous:{items:[]},cli:async()=>({installed:[{pluginId:id,name:'capability-test',marketplaceName:'openai-curated-remote',installed:true,enabled:true}]}),client:{request:async method=>method==='config/read'?{config:{plugins:{[id]:{enabled}}}}:method==='skills/list'?{data:[{skills:[{path:file,name:'one',pluginId:id,enabled:true,scope:'user'}]}]}:{apps:[]}}});
    const skill=result.items.find(item=>item.kind==='skill'&&item.id===file);
    assert.equal(skill.actions.toggle,enabled);assert.equal(skill.actions.remove,false);assert.equal(skill.actions.entries.length,0);
  }
});
function removal({matches=true,retained=false}={}) {
  let reads=0;
  const target={kind:'plugin',id:'selected@personal',name:'selected',installed:true,enabled:true,locations:[],actions:{remove:true,toggle:true}};
  const calls=[];
  const actions=createActions({inventory:async()=>({cwd:os.homedir(),items:++reads===1||retained?[target]:[]}),save:()=>{},json:async args=>{calls.push(args);return {pluginId:matches?target.id:'other@personal'};}});
  return {actions,target,calls};
}
test('plugin uninstall dispatches only the selected native id and requires matching confirmation',async()=>{
  const {actions,target,calls}=removal();const result=await actions.uninstall({kind:'plugin',id:target.id});
  assert.equal(result.ok,true);assert.deepEqual(calls,[['plugin','remove',target.id,'--json']]);
  const wrong=removal({matches:false});await assert.rejects(wrong.actions.uninstall({kind:'plugin',id:wrong.target.id}),/未确认移除/);
});
test('target-specific native removal confirmation is not blocked by an old cached installation',async()=>{
  const {actions,target}=removal({retained:true});const result=await actions.uninstall({kind:'plugin',id:target.id});assert.equal(result.ok,true);assert.equal(result.removedPluginId,target.id);assert.equal(result.inventory,undefined);
});
