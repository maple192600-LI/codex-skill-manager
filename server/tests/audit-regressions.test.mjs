import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {filterItems} from '../../shared/list-view.mjs';
import {originLabel,uninstallLabel} from '../../shared/management.mjs';
import {buildUsageReport,independentlyManaged} from '../usage-data.mjs';
import {matchesUsage} from '../../shared/usage-view.mjs';
import {createInventoryStore} from '../inventory-store.mjs';
import {createActions} from '../actions.mjs';
import {applyInventoryResult} from '../../shared/inventory-state.mjs';

test('clear filters restores existing items and system origin is independent of physical location',()=>{
  const items=[{kind:'plugin',id:'p',name:'p',locationType:'插件缓存'},{kind:'app',id:'a',name:'a',locationType:'尚未确认'},{kind:'skill',id:'s',name:'s',scope:'system',locationType:'本地目录'}];
  assert.equal(filterItems(items,{kind:'app',location:'插件缓存'}).length,0);
  assert.equal(filterItems(items,{kind:'app'}).length,1);
  assert.equal(filterItems(items,{kind:'plugin',query:'removed-skill'}).length,0);
  assert.equal(filterItems(items,{kind:'plugin',query:' '}).length,1);
  assert.equal(filterItems(items,{kind:'skill',origin:'Codex 自带'}).length,1);
  assert.equal(originLabel(items[2]),'Codex 自带');
});
test('actual toggle capability drives independent-management filtering and bundled uninstall names its owner',()=>{
  for(const item of [{kind:'skill',scope:'system',actions:{toggle:true}},{kind:'skill',parentPlugin:'p',actions:{toggle:true}},{kind:'plugin',managed:true,actions:{toggle:true}}])assert.equal(independentlyManaged(item),true);
  assert.equal(independentlyManaged({kind:'skill',parentPlugin:'p',actions:{toggle:false}}),false);
  assert.equal(independentlyManaged({kind:'skill',stale:true,actions:{toggle:true}}),false);
  assert.equal(uninstallLabel({kind:'skill',parentPlugin:'p'}),'卸载所属插件');
});
test('incomplete history cannot become complete unused records for any managed category',()=>{
  const now=Date.now(),items=['plugin','app','mcp','skill'].map(kind=>({kind,id:kind}));
  const report=buildUsageReport(items,{completedAt:now,coverage:{missing:1},threads:{r:{root:'r',hasUser:true,activityAt:now,missing:false,events:{u:{type:'user',at:now,turnId:'t'}}}}},{now});
  for(const item of items){const value=report.items[`${item.kind}:${item.id}`];assert.equal(value.status,'unknown');assert.equal(value.rate,null);assert.equal(matchesUsage(value,'idle'),false);}
  assert.equal(matchesUsage({status:'no-record',complete:false},'idle'),false);
});
test('refresh merges a confirmed switch and newly found items rather than discarding either',async()=>{
  let finish;
  const before={cwd:'scope',items:[{kind:'plugin',id:'p',enabled:true}]};
  const store=createInventoryStore({read:()=>before,save:()=>{},build:()=>new Promise(resolve=>finish=resolve)});
  const scan=store.scan('scope');await Promise.resolve();
  store.accept({cwd:'scope',itemStates:[{kind:'plugin',id:'p',enabled:false}]});
  finish({...before,generatedAt:'fresh',items:[...before.items,{kind:'plugin',id:'new',enabled:true}]});
  const result=await scan;
  assert.equal(result.items.find(item=>item.id==='p').enabled,false);
  assert.equal(result.items.some(item=>item.id==='new'),true);
  assert.equal(result.generatedAt,'fresh');
});
test('confirmed removal wins over an older scan without removing separate application connections',async()=>{
  let finish;
  const before={cwd:'scope',items:[{kind:'plugin',id:'p'},{kind:'skill',id:'s',parentPlugin:'p'},{kind:'app',id:'a',parentPlugin:'p'}]};
  const store=createInventoryStore({read:()=>before,save:()=>{},build:()=>new Promise(resolve=>finish=resolve)});
  const scan=store.scan('scope');await Promise.resolve();store.accept({cwd:'scope',removedPluginId:'p'});finish(before);
  const result=await scan;
  assert.deepEqual(result.items.map(item=>item.id),['a']);assert.equal(result.items[0].parentPlugin,null);assert.equal(result.items[0].enabled,null);
});
test('plugin re-enable reads its child skills, preserves independently disabled siblings, and restores controls',async()=>{
  const parent={kind:'plugin',id:'p',enabled:false,actions:{toggle:true}},children=[{kind:'skill',id:'s1',parentPlugin:'p',parentEnabled:false,enabled:false,actions:{toggle:false}},{kind:'skill',id:'s2',parentPlugin:'p',parentEnabled:false,enabled:false,actions:{toggle:false}}];
  let enabled=false;const methods=[];
  const actions=createActions({lookup:async()=>({cwd:os.homedir(),items:[parent,...children]}),request:async(method,params)=>{
    methods.push(method);
    if(method==='config/read')return {config:{plugins:{p:{enabled}}}};
    if(method==='config/batchWrite'){enabled=params.edits[0].value;return {};}
    if(method==='skills/list')return {data:[{skills:[{path:'s1',pluginId:'p',enabled:true},{path:'s2',pluginId:'p',enabled:false}]}]};
    throw Error(method);
  }});
  const result=await actions.setEnabled({kind:'plugin',id:'p',enabled:true,expectedEnabled:false});
  const updated=applyInventoryResult({items:[parent,...children]},result);
  assert.equal(result.ok,true);assert.ok(methods.includes('skills/list'));
  assert.equal(updated.items[1].enabled,true);assert.equal(updated.items[2].enabled,false);
  assert.equal(updated.items[1].actions.toggle,true);assert.equal(updated.items[2].actions.toggle,true);
});
test('single plugin removal does not wait for even an unreachable whole-inventory query',async()=>{
  let scans=0,calls=0;const item={kind:'plugin',id:'test@fixture',actions:{remove:true}};
  const actions=createActions({inventory:async()=>{scans++;throw Error('remote unavailable');},lookup:async()=>({cwd:os.homedir(),items:[item]}),json:async(args,options)=>{calls++;assert.equal(options.timeoutMs,45000);return {pluginId:item.id};}});
  const result=await actions.uninstall({kind:'plugin',id:item.id});
  assert.equal(result.ok,true);assert.equal(result.removedPluginId,item.id);assert.equal(scans,0);assert.equal(calls,1);
});
