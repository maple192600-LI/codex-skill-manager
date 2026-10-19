import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const sharingFailure=error=>process.platform==='win32'&&['EPERM','EACCES','EBUSY'].includes(error.code);
async function rename(source,destination) {
  const waits=[35,85,180];
  for(let attempt=0;;attempt++) {
    try{return await fs.rename(source,destination);}
    catch(error){if(!sharingFailure(error)||attempt===waits.length)throw error;await delay(waits[attempt]);}
  }
}

// A Windows reader can allow moving its file while still preventing a move of
// its containing directory. Preserve the recovery operation without copying and
// recursively deleting a live tree, or traversing shared link targets.
export async function moveSkillToRecovery(source,destination) {
  try {await fs.mkdir(path.dirname(destination),{recursive:true});}
  catch(error){throw new Error('无法写入技能恢复目录，本次未完成卸载，原文件已保留。',{cause:error});}
  try {await rename(source,destination);return {retainedDirectory:null};}
  catch(error){if(!sharingFailure(error))throw error;}

  const directories=[],files=[],moved=[];
  async function collect(directory) {
    const stat=await fs.lstat(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('技能目录已经变化，请刷新后再卸载。');
    directories.push(directory);
    for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory()&&!entry.isSymbolicLink())await collect(file);
      else files.push(file);
    }
  }
  try {
    await collect(source);
    // Leave the loading entry in place until every payload entry can be moved.
    // On failure, rollback restores payload before any success is returned.
    const entry=path.join(source,'SKILL.md');
    files.sort((a,b)=>Number(a===entry)-Number(b===entry));
    for(const directory of directories)await fs.mkdir(path.join(destination,path.relative(source,directory)));
    for(const file of files) {
      const recovery=path.join(destination,path.relative(source,file));
      await rename(file,recovery);
      moved.push({file,recovery});
    }
  }catch(error) {
    let rollbackFailed=false;
    for(const {file,recovery} of moved.reverse()) {
      try {
        // Never replace a file created by another process during this operation.
        try {await fs.lstat(file);throw new Error('原位置已有新文件');}
        catch(probe){if(probe.code!=='ENOENT')throw probe;}
        await rename(recovery,file);
      }catch {rollbackFailed=true;}
    }
    if(rollbackFailed)throw new Error(`未完成卸载，部分文件无法回到原位置，已保留在 ${destination}。请核对后再操作。`,{cause:error});
    throw new Error('未完成卸载，技能文件已保留。Windows 仍阻止移动文件；请关闭占用该技能目录的程序后重试，并检查目录写入权限。',{cause:error});
  }
  // Only remove directories confirmed empty by rmdir. A held empty directory is
  // harmless: it contains no skill entry and is explicitly reported to the user.
  let retainedDirectory=null;
  for(const directory of directories.reverse()) {
    try{await fs.rmdir(directory);}
    catch(error){if(error.code!=='ENOENT')retainedDirectory=source;}
  }
  return {retainedDirectory};
}
