import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createActions} from '../actions.mjs';
import {inspectPath,discoverSkills} from '../locations.mjs';

const readers=new WeakMap();
function fixture(t) {
  const releases=[];readers.set(t,releases);
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'skill-uninstall-test-'));
  const target=path.join(project,'.agents','skills','隔离技能');
  fs.mkdirSync(path.join(project,'.git'));
  fs.mkdirSync(path.join(target,'references'),{recursive:true});
  const entry=path.join(target,'SKILL.md');
  fs.writeFileSync(entry,'---\nname: uninstall-fixture\ndescription: Synthetic uninstall acceptance only.\n---\n');
  fs.writeFileSync(path.join(target,'references','guide.txt'),'preserve every original byte');
  const location=inspectPath(entry),item={kind:'skill',id:entry,scope:'repo',locations:[location]};
  const actions=createActions({lookup:async()=>({cwd:project,items:[item]}),request:async()=>({}),storage:path.join(project,'state')});
  t.after(async()=>{for(const release of releases)await release();if(process.env.SKILL_MANAGER_KEEP_TEST_FIXTURES==='1')return;assert.ok(path.basename(project).startsWith('skill-uninstall-test-'));await fs.promises.rm(project,{recursive:true,maxRetries:5,retryDelay:100});});
  return {project,target,entry,remove:()=>actions.uninstall({cwd:project,kind:'skill',id:entry,entry,fingerprint:location.fingerprint})};
}

async function holdFile(t,file,share) {
  const script="$stream=[System.IO.File]::Open($env:SKILL_UNINSTALL_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare][int]$env:SKILL_UNINSTALL_LOCK_SHARE); [Console]::WriteLine('ready'); [Console]::ReadLine() | Out-Null; $stream.Dispose()";
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,SKILL_UNINSTALL_LOCK_FILE:file,SKILL_UNINSTALL_LOCK_SHARE:String(share)},windowsHide:true,stdio:['pipe','pipe','pipe']});
  const exited=once(child,'exit');
  let released=false;
  const release=async()=>{if(!released){released=true;child.stdin.end('\n');}await exited;};
  readers.get(t).push(release);
  const [ready]=await once(child.stdout,'data');assert.match(String(ready),/ready/);
  return release;
}

test('ordinary standalone uninstall moves all files into recovery',async t=>{
  const f=fixture(t),original=fs.readFileSync(f.entry);
  const result=await f.remove();assert.equal(result.ok,true);
  assert.equal(fs.existsSync(f.target),false);
  assert.deepEqual(fs.readFileSync(path.join(result.backup,'SKILL.md')),original);
  assert.equal(fs.readFileSync(path.join(result.backup,'references','guide.txt'),'utf8'),'preserve every original byte');
});

test('Windows shared reader cannot break standalone uninstall', {skip:process.platform!=='win32'},async t=>{
  const f=fixture(t),original=fs.readFileSync(f.entry);
  await holdFile(t,f.entry,7);
  const result=await f.remove();assert.equal(result.ok,true);
  assert.equal(fs.existsSync(f.entry),false);
  assert.deepEqual(fs.readFileSync(path.join(result.backup,'SKILL.md')),original);
  assert.equal(discoverSkills([{path:path.dirname(f.target),scope:'repo'}]).length,0);
});

test('Windows nested reader is moved without losing its containing directory', {skip:process.platform!=='win32'},async t=>{
  const f=fixture(t);await holdFile(t,path.join(f.target,'references','guide.txt'),7);
  const result=await f.remove();assert.equal(result.ok,true);assert.equal(fs.existsSync(f.entry),false);
  assert.equal(fs.readFileSync(path.join(result.backup,'references','guide.txt'),'utf8'),'preserve every original byte');
});

test('Windows exclusive reader rolls moved payload back and never reports uninstall success', {skip:process.platform!=='win32'},async t=>{
  const f=fixture(t),original=fs.readFileSync(f.entry);
  const release=await holdFile(t,f.entry,3);
  await assert.rejects(f.remove(),/未完成卸载.*文件已保留/s);
  assert.deepEqual(fs.readFileSync(f.entry),original);
  assert.equal(fs.readFileSync(path.join(f.target,'references','guide.txt'),'utf8'),'preserve every original byte');
  assert.equal(discoverSkills([{path:path.dirname(f.target),scope:'repo'}]).length,1);
  await release();const result=await f.remove();assert.equal(result.ok,true);assert.equal(fs.existsSync(f.entry),false);
});

test('Windows short-lived reader recovers within the same uninstall request', {skip:process.platform!=='win32'},async t=>{
  const f=fixture(t),release=await holdFile(t,f.entry,3);
  const timer=setTimeout(release,90);
  try{const result=await f.remove();assert.equal(result.ok,true);assert.equal(fs.existsSync(f.entry),false);}finally{clearTimeout(timer);await release();}
});

test('Windows fallback moves nested links without traversing their shared target', {skip:process.platform!=='win32'},async t=>{
  const f=fixture(t),external=path.join(f.project,'shared');
  fs.mkdirSync(external);fs.writeFileSync(path.join(external,'keep.txt'),'outside selected skill');
  fs.symlinkSync(external,path.join(f.target,'shared-link'),'junction');
  await holdFile(t,f.entry,7);
  const result=await f.remove();assert.equal(result.ok,true);
  assert.equal(fs.readFileSync(path.join(external,'keep.txt'),'utf8'),'outside selected skill');
  assert.equal(fs.lstatSync(path.join(result.backup,'shared-link')).isSymbolicLink(),true);
});
