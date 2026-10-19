import fs from 'node:fs';
import path from 'node:path';
import {skillRoots,validateScope} from './inventory.mjs';
import {codexHome,within} from './state.mjs';

export function acceptUsageReceipt({skillPaths,cwd}) {
  const scope=validateScope(cwd),roots=[...skillRoots(scope).map(r=>r.path),path.join(codexHome,'plugins','cache')];
  const accepted=[];
  for(const file of new Set(skillPaths)) {
    if(!path.isAbsolute(file)||path.basename(file).toLowerCase()!=='skill.md'||!fs.statSync(file).isFile())throw new Error('请选择已采用技能的完整 SKILL.md 路径');
    const real=fs.realpathSync(file);
    const allowed=roots.some(root=>{
      if(within(root,file))return true;
      try{return within(fs.realpathSync(root),real);}catch{return false;}
    });
    if(!allowed)throw new Error('该技能不在本机个人、插件或当前项目的技能目录中');
    accepted.push(file);
  }
  return {skillPaths:accepted,recordedAt:new Date().toISOString()};
}
