import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {CodexAppServer,codexJson} from './codex.mjs';
import {readJson,writeJson,stateDir,codexHome,normalize,within} from './state.mjs';
import {inspectPath,discoverSkills,mcpLocations,locationSummary,removableEntry} from './locations.mjs';
import {applyTranslations} from './translations.mjs';
import {commandItems} from './commands.mjs';
import {applySkillSources} from './skill-sources.mjs';

export const kinds=['plugin','app','mcp','skill','command'];
export function validateScope(cwd) {
  if(!cwd) return os.homedir();
  if(!path.isAbsolute(cwd)||!fs.statSync(cwd).isDirectory()) throw new Error('请选择存在的项目绝对路径');
  return path.resolve(cwd);
}
export function skillRoots(cwd) {
  const roots=[{path:path.join(codexHome,'skills'),scope:'user'},{path:path.join(os.homedir(),'.agents','skills'),scope:'user'}];
  if(normalize(cwd)!==normalize(os.homedir())) {
    let dir=cwd;
    for(let i=0;i<20;i++) {
      roots.push({path:path.join(dir,'.agents','skills'),scope:'repo'},{path:path.join(dir,'.codex','skills'),scope:'repo'});
      if(fs.existsSync(path.join(dir,'.git'))||path.dirname(dir)===dir||normalize(dir)===normalize(os.homedir())) break;
      dir=path.dirname(dir);
    }
  }
  return roots;
}
export function frontmatter(text) {
  const meta={};
  const match=text.replace(/^\uFEFF/,'').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if(!match) return meta;
  const lines=match[1].split(/\r?\n/);
  for(let i=0;i<lines.length;i++) {
    const m=lines[i].match(/^([\w-]+):\s*(.*)$/);
    if(!m) continue;
    let value=m[2];
    if(['>','|','>-','|-'].includes(value)) { const parts=[]; while(/^\s+/.test(lines[i+1]||'')) parts.push(lines[++i].trim()); value=parts.join(' '); }
    meta[m[1]]=value.replace(/^['"]|['"]$/g,'');
  }
  return meta;
}
const sourceText=file=>{try{return fs.readFileSync(file,'utf8');}catch{return '';}};
const base=(kind,id,name)=>({kind,id,name,description:'',enabled:null,installed:true,callable:null,status:'状态未确认',capabilities:[],locations:[]});
const sourceName=market=>market==='personal'?'个人插件市场':market?.startsWith('openai-')?'OpenAI 官方市场':`第三方市场 · ${market}`;
function cachePath(plugin) {
  if(!plugin.version||![plugin.marketplace,plugin.name,plugin.version].every(v=>typeof v==='string'&&v!=='.'&&v!=='..'&&!/[\\/]/.test(v))) return null;
  const file=path.join(codexHome,'plugins','cache',plugin.marketplace,plugin.name,plugin.version);
  const manifest=readJson(path.join(file,'.codex-plugin','plugin.json'));
  return manifest?.name===plugin.name&&manifest?.version===plugin.version?file:null;
}
function configOrigin(config,id,root='mcp_servers') {
  const key=`${root}.${id}.`;
  return (config?.origins?.[`${key}enabled`]||config?.origins?.[`${key}command`]||config?.origins?.[`${key}url`]||Object.entries(config?.origins||{}).find(([k])=>k.startsWith(key))?.[1])?.name;
}
function fileForOrigin(origin) { return origin?.file || (origin?.dotCodexFolder?path.join(origin.dotCodexFolder,'config.toml'):null); }
const remoteMarketplace=name=>/remote|shared-with-me|workspace-directory|vertical/.test(name||'');
function unconfirmed(item) {
  return {...item,enabled:null,installed:null,callable:null,stale:true,lastConfirmedAt:item.lastConfirmedAt||item.observedAt||null,status:'状态待确认 · 保留上次记录',actions:{toggle:false,remove:false,entries:[]}};
}
function finish(item) {
  item.locationType=locationSummary(item.locations);
  item.path=item.path||item.locations[0]?.path||'';
  item.positionError=item.locations.some(l=>['目标不存在','无权读取','解析失败','链接循环','链接层数过多'].includes(l.status));
  if(!item.stale) item.lastConfirmedAt=item.observedAt=new Date().toISOString();
  item.actions={toggle:typeof item.enabled==='boolean'&&(!item.parentPlugin||item.kind==='skill'&&item.parentEnabled===true)&&item.kind!=='command',remove:item.kind==='plugin'&&!item.managed&&item.id!=='skill-manager@personal'||item.kind==='mcp'&&!item.parentPlugin&&item.configWritable,entries:item.removableEntries||[]};
  if(item.id==='skill-manager@personal') item.actions.toggle=false;
  if(item.stale) item.actions={toggle:false,remove:false,entries:[]};
  return item;
}
export async function buildInventory({cwd,client,cli=codexJson,previous,confirmedRemovedPluginId}={}) {
  cwd=validateScope(cwd);
  previous ||= readSnapshot(cwd);
  const started=Date.now();
  const ownClient=!client;
  client ||= new CodexAppServer({cwd,timeoutMs:8000});
  const warnings=[];
  async function read(label,fn,fallback) {try{return await fn();}catch(error){warnings.push(`${label}读取失败：${error.message}`);return fallback;}}
  try {
    const [installed,appsResult,skillsResult,config]=await Promise.all([
      read('插件安装记录',()=>cli(['plugin','list','--json'],{cwd,timeoutMs:60000}),null),
      read('应用',()=>client.request('app/installed',{}),null),
      read('技能',()=>client.request('skills/list',{cwds:[cwd],forceReload:true}),null),
      read('有效配置',()=>client.request('config/read',{cwd,includeLayers:true}),null),
    ]);
    const sourceStatus=Object.fromEntries(kinds.map(kind=>[kind,{state:'fresh',checkedAt:new Date().toISOString()}]));
    const pluginRead=Array.isArray(installed?.installed),appRead=Array.isArray(appsResult?.apps),skillRead=Array.isArray(skillsResult?.data)&&!skillsResult.data.some(scope=>scope.errors?.length),configRead=!!config?.config;
    for(const [kind,ok,label] of [['plugin',pluginRead,'插件安装记录'],['app',appRead,'应用'],['skill',skillRead,'技能'],['mcp',configRead,'有效配置']]) if(!ok) {
      sourceStatus[kind].state='partial';
      if(!warnings.some(warning=>warning.startsWith(label))) warnings.push(`${label}未完整读取；已保留上次记录，状态待确认。`);
    }
    const records=pluginRead?installed.installed:[];
    const plugins=records.filter(p=>p.installed).map(p=>{
      const configured=config?.config?.plugins?.[p.pluginId]?.enabled;
      const enabled=configRead?(typeof configured==='boolean'?configured:p.enabled===true):null;
      const plugin={...base('plugin',p.pluginId,p.name),marketplace:p.marketplaceName,source:sourceName(p.marketplaceName),version:p.version,enabled,status:enabled===null?'已安装 · 启用状态待确认':enabled?'已启用 · 运行未确认':'已关闭',stale:!configRead,configFile:fileForOrigin(configOrigin(config,p.pluginId,'plugins')),managed:p.installPolicy==='INSTALLED_BY_DEFAULT'};
      plugin.installPath=cachePath(plugin);
      plugin.sourcePath=p.source?.path;
      plugin.path=plugin.installPath||plugin.sourcePath||'';
      if(plugin.installPath) plugin.locations.push(inspectPath(plugin.installPath,'已安装版本目录'));
      if(plugin.sourcePath) plugin.locations.push(inspectPath(plugin.sourcePath,'插件来源目录'));
      if(!plugin.locations.length) plugin.locations.push({label:'安装位置',path:'宿主未提供可确认的本地目录',type:'尚未确认',status:'尚未确认',links:[]});
      const manifest=readJson(path.join(plugin.installPath||plugin.sourcePath||'','.codex-plugin','plugin.json'),{});
      plugin.description=manifest.interface?.longDescription||manifest.description||manifest.interface?.shortDescription||'';
      plugin.capabilities=manifest.interface?.capabilities||[];
      plugin.manifest=manifest;
      return plugin;
    });
    const explicitAbsences=new Set(records.filter(p=>p.installed===false).map(p=>p.pluginId));
    const missing=(previous?.items||[]).filter(item=>item.kind==='plugin'&&!plugins.some(plugin=>plugin.id===item.id)&&!explicitAbsences.has(item.id)&&item.id!==confirmedRemovedPluginId&&(!pluginRead||remoteMarketplace(item.marketplace||item.id.split('@').at(-1))));
    for(const item of missing) {
      const plugin=unconfirmed(item);
      plugin.manifest=readJson(path.join(plugin.installPath||plugin.sourcePath||'','.codex-plugin','plugin.json'),{});
      plugins.push(plugin);
    }
    // The CLI can silently omit remote installations on a network failure.
    // A saved record or configuration is evidence of an unresolved item, never
    // evidence that a missing remote response means an uninstall succeeded.
    for(const id of Object.keys(config?.config?.plugins||{})) if(remoteMarketplace(id.split('@').at(-1))&&!plugins.some(plugin=>plugin.id===id)&&!explicitAbsences.has(id)&&id!==confirmedRemovedPluginId) {
      const marketplace=id.split('@').at(-1),name=id.slice(0,id.lastIndexOf('@'));
      plugins.push({...base('plugin',id,name),marketplace,source:sourceName(marketplace),enabled:null,installed:null,stale:true,configuredOnly:true,status:'已配置 · 安装待确认',manifest:{}});
    }
    if(plugins.some(plugin=>plugin.stale)) {
      sourceStatus.plugin.state='partial';
      warnings.push(!configRead&&pluginRead?'插件启用配置未完整读取；已保留安装记录，启用状态待确认，暂不提供开关或卸载。':'部分插件记录未取回，已保留上次记录或配置线索；这不表示插件已卸载，待确认项目暂不提供开关或卸载。');
    }
    const byPlugin=new Map(plugins.map(p=>[p.id,p]));
    const roots=skillRoots(cwd);
    const discovered=discoverSkills(roots);
    const skills=(skillsResult?.data||[]).flatMap(d=>d.skills||[]).map(s=>{
      const aliases=discovered.filter(d=>d.location.realPath&&normalize(d.location.realPath)===normalize(s.path));
      const parent=byPlugin.get(s.pluginId);
      const item={...base('skill',s.path||s.name,s.name),description:s.description||'',sourceText:sourceText(s.path),scope:s.scope,parentPlugin:s.pluginId||null,source:s.pluginId?`插件技能 · ${parent?.name||s.pluginId}`:s.scope==='system'?'Codex 官方':s.scope==='repo'?'项目技能':'个人技能',path:s.path,enabled:s.enabled===true,status:s.enabled?'已启用 · 运行未确认':'已关闭',locations:aliases.length?aliases.map(d=>({...d.location,scope:d.scope})): [inspectPath(s.path,'宿主报告路径')]};
      if(s.pluginId)item.parentEnabled=parent?.enabled??null;
      if(parent?.enabled===false){item.enabled=false;item.status='随插件关闭';}
      if(parent?.stale){item.enabled=null;item.stale=true;item.status='所属插件状态待确认';}
      item.removableEntries=item.locations.filter(l=>removableEntry(item,l,roots)).map(l=>({path:l.path,fingerprint:l.fingerprint,type:l.type}));
      return item;
    });
    for(const d of discovered) {
      if(skills.some(s=>d.location.realPath&&normalize(s.path)===normalize(d.location.realPath))) continue;
      const text=sourceText(d.file), fm=frontmatter(text);
      const item={...base('skill',d.file,fm.name||path.basename(path.dirname(d.file))),description:fm.description||'',sourceText:text,scope:d.scope,source:d.scope==='repo'?'项目技能':'个人技能',path:d.file,locations:[d.location],status:d.location.status==='正常'?'已发现 · 加载未确认':'位置异常',discoveredOnly:true};
      // Filesystem fallback cannot establish configuration state or permissions.
      skills.push(item);
    }
    const mcps=[];
    for(const [name,c] of Object.entries(config?.config?.mcp_servers||{})) {
      const origin=configOrigin(config,name), configFile=fileForOrigin(origin);
      mcps.push({...base('mcp',name,name),source:c.url?'网络 MCP':'本地 MCP',description:c.url?'通过 HTTP 连接的 MCP 服务。':`使用 ${path.basename(c.command||'未声明程序')} 启动的本地 MCP 服务。`,enabled:c.enabled!==false,status:c.enabled===false?'已关闭':'已配置 · 连接未检测',configFile,configWritable:origin?.type==='user'||origin?.type==='project',locations:mcpLocations(c,configFile,c.cwd&&path.isAbsolute(c.cwd)?c.cwd:null)});
    }
    const appParents=new Map();
    for(const p of plugins) {
      const root=p.installPath;
      if(!root) continue;
      const m=p.manifest||{};
      const mcpRef=typeof m.mcpServers==='string'?m.mcpServers:'.mcp.json';
      const mcpFile=path.resolve(root,mcpRef);
      if(within(root,mcpFile)) for(const [name,c] of Object.entries(readJson(mcpFile)?.mcpServers||{})) {
        const effective=path.resolve(root,c.cwd||'.');
        const service={...base('mcp',`${p.id}:${name}`,name),runtimeName:name,parentPlugin:p.id,source:`插件服务 · ${p.name}`,description:c.url?'插件提供的网络 MCP 服务。':'插件提供的本地 MCP 服务。',enabled:p.enabled&&c.enabled!==false,status:!p.enabled||c.enabled===false?'随插件关闭':'随插件启用 · 连接未检测',locations:mcpLocations(c,mcpFile,effective)};
        mcps.push(p.stale?unconfirmed({...service,observedAt:p.observedAt,lastConfirmedAt:p.lastConfirmedAt}):service);
      }
      const appFile=path.resolve(root,typeof m.apps==='string'?m.apps:'.app.json');
      if(within(root,appFile)) for(const [name,a] of Object.entries(readJson(appFile)?.apps||{})) if(a.id) appParents.set(a.id,{parentPlugin:p.id,source:`插件应用 · ${p.name}`,locations:[inspectPath(appFile,'应用声明'),inspectPath(root,'所属插件目录')]});
    }
    const apps=(appsResult?.apps||[]).map(a=>{
      const parentInfo=appParents.get(a.id),parent=byPlugin.get(parentInfo?.parentPlugin);
      const configured=config?.config?.apps?.[a.id]?.enabled;
      const enabled=parent?.stale?null:parent?.enabled===false?false:typeof configured==='boolean'?configured:a.enabled;
      return {...base('app',a.id,a.runtimeName||a.id),...parentInfo,description:'',source:parentInfo?.source||'Codex 应用目录',enabled,callable:enabled===false?false:a.callable,status:enabled===null?'状态待确认':!enabled?'已关闭':a.callable?'查询环境可调用':'已启用 · 待连接或不可调用',locations:[...(parentInfo?.locations||[]),{label:'应用位置',path:'由 Codex 连接提供；宿主未报告独立安装目录',type:'尚未确认',status:'本地或远程未确认',links:[]}]};
    });
    const commands=commandItems({cwd,plugins});
    const items=[...plugins,...apps,...mcps,...skills,...commands];
    for(const old of previous?.items||[]) if((old.kind==='app'&&!appRead)||(old.kind==='skill'&&!skillRead)||(old.kind==='mcp'&&!old.parentPlugin&&!configRead)) {
      const index=items.findIndex(item=>item.kind===old.kind&&item.id===old.id);
      if(index<0) items.push(unconfirmed(old));
      else if(old.kind==='skill'&&items[index].discoveredOnly) items[index]=unconfirmed({...old,locations:items[index].locations});
    }
    items.forEach(finish);
    for(const kind of kinds) if(items.some(item=>item.kind===kind&&item.stale)) sourceStatus[kind].state='partial';
    for(const p of plugins) delete p.manifest;
    return {generatedAt:new Date().toISOString(),durationMs:Date.now()-started,cwd,scopeLabel:normalize(cwd)===normalize(os.homedir())?'本机个人环境':`项目：${cwd}`,statusNote:'安装和配置来自本机查询；不代表所有已打开任务的运行状态。',items,counts:Object.fromEntries(kinds.map(k=>[k,items.filter(i=>i.kind===k).length])),warnings,sourceStatus,partial:Object.values(sourceStatus).some(source=>source.state==='partial')};
  } finally { if(ownClient) await client.close(); }
}
const snapshotFile=cwd=>path.join(stateDir,`inventory-${crypto.createHash('sha256').update(validateScope(cwd)).digest('hex').slice(0,16)}.json`);
export function readSnapshot(cwd) { const snapshot=readJson(snapshotFile(cwd)); return snapshot?{...snapshot,stale:true}:null; }
export function saveSnapshot(inventory) { writeJson(snapshotFile(inventory.cwd),publicInventory(inventory)); }
export function publicInventory(inventory) {
  return {...inventory,items:applySkillSources(applyTranslations(inventory.items)).map(({sourceText,manifest,...item})=>item)};
}
