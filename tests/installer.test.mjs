import test from 'node:test';
import assert from 'node:assert/strict';
import {install,selector} from '../bin/install.mjs';

test('repeat installation preserves an already disabled plugin without writes',async()=>{
  const calls=[];
  const result=await install({run:async args=>{calls.push(args);return {stdout:JSON.stringify({installed:[{pluginId:selector,installed:true,enabled:false}]})};}});
  assert.equal(result.alreadyInstalled,true);assert.equal(result.enabled,false);assert.equal(calls.length,1);
});
test('a plugin from another source is retained without registering or installing anything',async()=>{
  const calls=[];
  await assert.rejects(install({run:async args=>{calls.push(args);return {stdout:JSON.stringify({installed:[{pluginId:'skill-manager@personal',name:'skill-manager',installed:true}]})};}}),/同名插件/);
  assert.equal(calls.length,1);
});
test('a nominal install response is not success without matching native readback',async()=>{
  await assert.rejects(install({run:async args=>({stdout:JSON.stringify(args[1]==='list'?{installed:[]}:{})})}),/未确认目标/);
});
