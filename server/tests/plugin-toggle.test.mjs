import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {buildInventory} from '../inventory.mjs';
import {createActions} from '../actions.mjs';

const id='toggle-regression@openai-curated-remote';
const record={pluginId:id,name:'toggle-regression',marketplaceName:'openai-curated-remote',version:'1',installed:true,enabled:true};
function reader(config) {
  return {request:async method=>method==='config/read'?{config,origins:{}}:method==='skills/list'?{data:[]}:{apps:[]}};
}
test('plugin display follows an explicit effective setting rather than remote installation enabled',async()=>{
  for(const enabled of [false,true]) {
    const result=await buildInventory({previous:{items:[]},client:reader({plugins:{[id]:{enabled}}}),cli:async()=>({installed:[{...record,enabled:!enabled}]})});
    const item=result.items.find(item=>item.id===id);
    assert.equal(item.enabled,enabled);
    assert.equal(item.installed,true);
    assert.equal(item.status,enabled?'已启用 · 运行未确认':'已关闭');
  }
});
test('without an explicit local setting the confirmed installation default remains usable',async()=>{
  const result=await buildInventory({previous:{items:[]},client:reader({}),cli:async()=>({installed:[record]})});
  assert.equal(result.items.find(item=>item.id===id).enabled,true);
});
test('unavailable effective settings keep installation known and prevent plugin mutations',async()=>{
  const client=reader({});
  const request=client.request;
  client.request=method=>method==='config/read'?Promise.reject(new Error('config unavailable')):request(method);
  const result=await buildInventory({previous:{items:[]},client,cli:async()=>({installed:[record]})});
  const item=result.items.find(item=>item.id===id);
  assert.equal(item.enabled,null);
  assert.equal(item.installed,true);
  assert.equal(item.actions.toggle,false);
  assert.equal(item.actions.remove,false);
});
for(const kind of ['plugin','app','mcp'])test(`${kind} switch confirms the exact native setting without any inventory or remote query`,async()=>{
  let enabled=true,scans=0;
  const calls=[],root={plugin:'plugins',app:'apps',mcp:'mcp_servers'}[kind];
  const target=kind==='plugin'?id:'toggle-regression';
  const item={kind,id:target,enabled:true,installed:true,configFile:'C:/fixture/config.toml',actions:{toggle:true}};
  const actions=createActions({inventory:async()=>{scans++;throw new Error('remote list is unreachable');},lookup:async()=>({cwd:os.homedir(),items:[item]}),save:()=>{},request:async(method,params)=>{
    calls.push(method);
    if(method==='config/read')return {config:{[root]:{[target]:{enabled}}},origins:{}};
    assert.equal(method,'config/batchWrite');
    assert.equal(params.edits[0].keyPath,`${root}.${JSON.stringify(target)}.enabled`);
    enabled=params.edits[0].value;
    return {};
  }});
  const result=await actions.setEnabled({kind,id:target,enabled:false,expectedEnabled:true});
  assert.equal(result.ok,true);
  assert.equal(result.itemStates.find(state=>state.kind===kind&&state.id===target).enabled,false);
  assert.equal(scans,0);
  assert.deepEqual(calls,['config/read','config/batchWrite','config/read']);
});
test('a changed setting is returned instead of overwriting a newer native change',async()=>{
  let writes=0;
  const actions=createActions({lookup:async()=>({cwd:os.homedir(),items:[{kind:'plugin',id,enabled:true,actions:{toggle:true}}]}),request:async method=>{
    if(method==='config/batchWrite')writes++;
    return {config:{plugins:{[id]:{enabled:false}}}};
  }});
  const result=await actions.setEnabled({kind:'plugin',id,enabled:true,expectedEnabled:true});
  assert.equal(result.ok,false);
  assert.equal(result.itemStates[0].enabled,false);
  assert.equal(writes,0);
});
test('a write that fails readback never reports success',async()=>{
  const actions=createActions({lookup:async()=>({cwd:os.homedir(),items:[{kind:'plugin',id,enabled:true,actions:{toggle:true}}]}),request:async()=>({config:{plugins:{[id]:{enabled:true}}}})});
  const result=await actions.setEnabled({kind:'plugin',id,enabled:false,expectedEnabled:true});
  assert.equal(result.ok,false);
  assert.equal(result.itemStates[0].enabled,true);
});
