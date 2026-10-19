import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readJson,codexHome} from './state.mjs';

const catalog=readJson(path.join(path.dirname(fileURLToPath(import.meta.url)),'skill-source-catalog.json'),[]);
const norm=p=>String(p||'').replaceAll('\\','/').toLowerCase();
const slug=value=>{const s=String(value||'').replace(/^https?:\/\/github\.com\//i,'').replace(/\.git$/,'').replace(/\/$/,'');return /^[\w.-]+\/[\w.-]+$/.test(s)?s:null;};
export function applySkillSources(items,{home=os.homedir(),localCodexHome=codexHome,catalogEntries=catalog}={}) {
  const locks=[path.join(home,'.agents','.skill-lock.json')];
  for(const item of items)if(item.kind==='skill'&&item.scope==='repo') {
    const root=String(item.path||'').replace(/[/\\]\.(?:agents|codex)[/\\]skills[/\\].*$/i,'');
    if(root!==item.path)locks.push(path.join(root,'skills-lock.json'),path.join(root,'.agents','.skill-lock.json'));
  }
  const entries=locks.flatMap(file=>Object.entries(readJson(file)?.skills||{}).map(([name,entry])=>({name,...entry,root:file===locks[0]?path.join(home,'.agents','skills'):path.join(path.dirname(file),file.endsWith('skills-lock.json')?'.agents/skills':'skills')})));
  return items.map(item=>{
    if(item.kind!=='skill')return item;
    const roots=[item.path,...(item.locations||[]).flatMap(l=>[l.path,l.realPath])].filter(Boolean);
    const paths=new Set(roots.map(norm));
    const locked=entries.find(entry=>paths.has(norm(path.join(entry.root,entry.name,'SKILL.md'))));
    let source=locked?.sourceType==='github'?slug(locked.sourceUrl||locked.source):null;
    if(!source)for(const entry of catalogEntries) {
      const expected=path.join(localCodexHome,'skills',entry.name,'SKILL.md');
      if(!paths.has(norm(expected)))continue;
      try {if(crypto.createHash('sha256').update(fs.readFileSync(expected)).digest('hex')===entry.sha256.toLowerCase())source=entry.source;}catch{/* Missing files do not establish origin. */}
    }
    return {...item,installationSource:source||(item.scope==='system'?'Codex 自带':item.parentPlugin?`插件：${item.parentPlugin.split('@')[0]}`:'来源未记录'),sourceRepository:source?`https://github.com/${source}`:null,installedAt:locked?.installedAt||null};
  });
}
