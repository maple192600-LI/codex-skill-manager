import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {buildInventory} from '../inventory.mjs';
import {createActions} from '../actions.mjs';
import {createBridge} from '../../ui/src/bridge.js';

const confirmedAt='2026-10-01T00:00:00.000Z';
const remote={kind:'plugin',id:'refresh-regression@openai-curated-remote',name:'refresh-regression',marketplace:'openai-curated-remote',version:'1',installed:true,enabled:true,observedAt:confirmedAt,locations:[],actions:{toggle:true,remove:true,entries:[]}};
const previous={cwd:os.homedir(),generatedAt:confirmedAt,items:[remote],counts:{plugin:1}};
const nativeClient={request:async method=>method==='app/installed'?{apps:[{id:'refresh-regression-app',enabled:true,callable:true}]}:method==='skills/list'?{data:[]}:{config:{},origins:{}}};
const installedRemote={pluginId:remote.id,name:remote.name,marketplaceName:remote.marketplace,version:'1',installed:true,enabled:true};

test('plugin query gets a 60 second budget without changing native request budgets',async()=>{
  let options;
  await buildInventory({previous:{items:[]},client:nativeClient,cli:async(args,value)=>{options=value;return {installed:[]};}});
  assert.equal(options.timeoutMs,60_000);
});

test('plugin timeout preserves old records as unknown while fresh apps remain available',async()=>{
  const result=await buildInventory({previous,client:nativeClient,cli:async()=>{throw new Error('plugin list timed out');}});
  const retained=result.items.find(item=>item.id===remote.id);
  assert.equal(result.partial,true);
  assert.equal(result.sourceStatus.plugin.state,'partial');
  assert.equal(retained.enabled,null);
  assert.equal(retained.installed,null);
  assert.equal(retained.lastConfirmedAt,confirmedAt);
  assert.equal(retained.stale,true);
  assert.equal(retained.actions.toggle,false);
  assert.equal(retained.actions.remove,false);
  assert.ok(result.items.some(item=>item.id==='refresh-regression-app'&&item.callable===true&&!item.stale));
  assert.equal(previous.items[0].enabled,true);
});

test('successful but incomplete remote result cannot silently remove previous remote plugins',async()=>{
  const result=await buildInventory({previous,client:nativeClient,cli:async()=>({installed:[]})});
  assert.equal(result.items.find(item=>item.id===remote.id)?.stale,true);
  assert.equal(result.sourceStatus.plugin.state,'partial');
  assert.ok(result.warnings.some(warning=>warning.includes('未取回')));
});

test('recovery replaces stale records with current confirmed state',async()=>{
  const partial=await buildInventory({previous,client:nativeClient,cli:async()=>({installed:[]})});
  const recovered=await buildInventory({previous:partial,client:nativeClient,cli:async()=>({installed:[installedRemote]})});
  const item=recovered.items.find(item=>item.id===remote.id);
  assert.equal(item.enabled,true);
  assert.equal(item.installed,true);
  assert.notEqual(item.stale,true);
  assert.equal(item.actions.toggle,true);
  assert.equal(recovered.sourceStatus.plugin.state,'fresh');
  assert.equal(recovered.partial,false);
  assert.equal(recovered.items.filter(item=>item.id===remote.id).length,1);
});

test('an explicit not-installed response can remove a remote record',async()=>{
  const result=await buildInventory({previous,client:nativeClient,cli:async()=>({installed:[{...installedRemote,installed:false}]})});
  assert.equal(result.items.some(item=>item.id===remote.id),false);
});

test('successful explicit uninstall can be confirmed without retaining a stale remote record',async()=>{
  const result=await buildInventory({previous,confirmedRemovedPluginId:remote.id,client:nativeClient,cli:async()=>({installed:[]})});
  assert.equal(result.items.some(item=>item.id===remote.id),false);
});

test('cold read keeps configured remote plugins unknown instead of manufacturing an installation',async()=>{
  const result=await buildInventory({previous:{items:[]},client:{request:async method=>method==='config/read'?{config:{plugins:{[remote.id]:{enabled:true}}}}:nativeClient.request(method)},cli:async()=>({installed:[]})});
  const item=result.items.find(item=>item.id===remote.id);
  assert.equal(item.configuredOnly,true);
  assert.equal(item.installed,null);
  assert.equal(item.enabled,null);
  assert.equal(item.actions.remove,false);
});

test('failed native sources preserve old data and never manufacture disabled states',async()=>{
  const old={...previous,items:[...previous.items,{kind:'app',id:'old-app',enabled:true,callable:true,locations:[],observedAt:confirmedAt},{kind:'skill',id:'old-skill',name:'old-skill',path:'old-skill',enabled:true,locations:[],observedAt:confirmedAt},{kind:'mcp',id:'old-mcp',name:'old-mcp',enabled:true,locations:[],observedAt:confirmedAt}]};
  const result=await buildInventory({previous:old,client:{request:async()=>{throw new Error('native source unavailable');}},cli:async()=>({installed:[installedRemote]})});
  for(const id of ['old-app','old-skill','old-mcp']) {
    const item=result.items.find(item=>item.id===id);
    assert.equal(item.enabled,null,id);
    assert.equal(item.stale,true,id);
    assert.equal(item.actions.toggle,false,id);
  }
});

test('stale plugin cannot dispatch enable or uninstall mutations',async()=>{
  const result=await buildInventory({previous,client:nativeClient,cli:async()=>({installed:[]})});
  let writes=0;
  const actions=createActions({inventory:async()=>result,request:async()=>{writes++;},json:async()=>{writes++;}});
  await assert.rejects(actions.setEnabled({kind:'plugin',id:remote.id,enabled:false}));
  await assert.rejects(actions.uninstall({kind:'plugin',id:remote.id}));
  assert.equal(writes,0);
});

test('refresh bridge can outwait the normal operation timeout',async()=>{
  const bridge=createBridge({openai:{callTool:async()=>{await new Promise(resolve=>setTimeout(resolve,35));return {structuredContent:{items:[]}};}}},{timeoutMs:15,inventoryTimeoutMs:100});
  assert.deepEqual(await bridge.call('skill_manager_inventory'),{items:[]});
  await assert.rejects(bridge.call('ordinary-operation'),/超时/);
});
