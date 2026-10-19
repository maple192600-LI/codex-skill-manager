import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod/v4';
import {createBridge} from '../../ui/src/bridge.js';

// Codex 26.901.6511.0 app-primary, V3t: name:string.min(1),
// arguments:record(string,json()).optional(). The sandbox validates before
// dispatch, without the JSON round trip used by the previous HTTP test host.
const nativeParams=z.object({name:z.string().min(1),arguments:z.record(z.string(),z.json()).optional()}).loose();
function nativeHost(onCall=async()=>({structuredContent:{ok:true}})) {
  return {openai:{async callTool(name,args){
    const parsed=nativeParams.safeParse({name,arguments:args});
    if(!parsed.success)throw new Error('Invalid MCP tool call params');
    return onCall(name,parsed.data.arguments);
  }}};
}

test('personal environment survives the native host JSON validator',async()=>{
  const calls=[];const bridge=createBridge(nativeHost(async(name,args)=>{calls.push({name,args});return {structuredContent:{items:[]}};}));
  const scope='';
  for(const name of ['skill_manager_snapshot','skill_manager_inventory','skill_manager_translation_status'])await bridge.call(name,{cwd:scope||undefined});
  assert.deepEqual(calls.map(c=>c.args),[{},{},{}]);
});

test('plugin removal omits unset entry fields without replay or losing false',async()=>{
  const calls=[];const bridge=createBridge(nativeHost(async(name,args)=>{calls.push({name,args});return {structuredContent:{ok:true}};}));
  await bridge.call('skill_manager_uninstall',{kind:'plugin',id:'fixture@market',cwd:undefined,entry:undefined,fingerprint:undefined});
  await bridge.call('skill_manager_set_enabled',{kind:'plugin',id:'fixture@market',cwd:'C:\\example',enabled:false,expectedEnabled:true});
  assert.deepEqual(calls,[{name:'skill_manager_uninstall',args:{kind:'plugin',id:'fixture@market'}},{name:'skill_manager_set_enabled',args:{kind:'plugin',id:'fixture@market',cwd:'C:\\example',enabled:false,expectedEnabled:true}}]);
});

test('the previous HTTP host hid the undefined argument defect',()=>{
  const params={name:'skill_manager_inventory',arguments:{cwd:undefined}};
  assert.equal(nativeParams.safeParse(params).success,false);
  assert.equal(nativeParams.safeParse(JSON.parse(JSON.stringify(params))).success,true);
});
