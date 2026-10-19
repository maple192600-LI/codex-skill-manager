import test from 'node:test';
import assert from 'node:assert/strict';
import {countStates,applySkillStates,applyItemStates} from '../../shared/inventory-state.mjs';

test('unknown states are not counted as disabled, and confirmed switches update totals',()=>{
  const before={items:[{kind:'skill',id:'one',enabled:true},{kind:'skill',id:'two',enabled:false},{kind:'skill',id:'unknown',enabled:null},{kind:'plugin',id:'plugin',enabled:true}]};
  assert.deepEqual(countStates(before.items,'skill'),{total:3,enabled:1,disabled:1,unknown:1});
  const after=applySkillStates(before,[{id:'one',enabled:false}]);
  assert.deepEqual(countStates(after.items,'skill'),{total:3,enabled:0,disabled:2,unknown:1});
  assert.equal(before.items[0].enabled,true);
  assert.equal(after.items[2].enabled,null);
  assert.equal(after.items[3].enabled,true);
});

test('a confirmed plugin switch updates its children and leaves unrelated entries untouched',()=>{
  const unrelated={kind:'skill',id:'independent',enabled:true};
  const before={items:[{kind:'plugin',id:'parent',enabled:true},{kind:'skill',id:'child',parentPlugin:'parent',enabled:true},unrelated]};
  const closed=applyItemStates(before,[{kind:'plugin',id:'parent',enabled:false}]);
  assert.equal(closed.items[0].enabled,false);
  assert.equal(closed.items[1].enabled,false);
  assert.equal(closed.items[1].status,'随插件关闭');
  assert.equal(closed.items[2],unrelated);
  const reopened=applyItemStates(closed,[{kind:'plugin',id:'parent',enabled:true}]);
  assert.equal(reopened.items[1].enabled,null,'enabling a parent cannot prove each child is enabled');
  assert.equal(before.items[1].enabled,true);
});
