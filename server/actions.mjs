import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {codexJson,CodexAppServer} from './codex.mjs';
import {buildInventory,skillRoots,saveSnapshot,validateScope} from './inventory.mjs';
import {inspectPath,removableEntry,locationSummary} from './locations.mjs';
import {normalize,within,stateDir} from './state.mjs';

export function createActions({inventory=buildInventory,lookup=inventory,request,json=codexJson,storage=stateDir,open=launchFolder,save=saveSnapshot}={}) {
  const active=new Set();
  async function withSession(cwd,run) {
    if(request)return run(request);
    const client=new CodexAppServer({cwd});
    try{return await run((method,params)=>client.request(method,params));}
    finally{await client.close();}
  }
  async function perform(args,action) {
    const key=`${args.kind}:${args.id}`;
    if(active.has(key)) throw new Error('该项目仍在操作中，请先确认结果');
    active.add(key);
    try {
      const before=await lookup({cwd:args.cwd});
      const item=before.items.find(i=>i.kind===args.kind&&i.id===args.id);
      if(!item) throw new Error('项目已变化或不存在，请刷新清单');
      if(item.stale)throw new Error('目标状态尚未确认，请刷新后再卸载');
      return {...await action(item,before),cwd:before.cwd};
    } finally { active.delete(key); }
  }
  async function setSkillEnabled(args,request) {
    const key=`skill:${args.id}`;
    if(active.has(key))throw new Error('该项目仍在操作中，请先确认结果');
    active.add(key);
    try {
      const cwd=validateScope(args.cwd);
      const read=async()=>{
        const result=await request('skills/list',{cwds:[cwd],forceReload:true},{cwd});
        const scopes=result.data||[];
        if(scopes.some(scope=>scope.errors?.length))throw new Error('技能读取不完整，请刷新确认后再操作');
        return scopes.flatMap(scope=>scope.skills||[]);
      };
      const readConfig=async()=>{
        const result=await request('config/read',{cwd,includeLayers:true},{cwd});
        const layer=result.layers?.find(layer=>layer.name.type==='user');
        if(!layer?.name.file)throw new Error('无法确认技能配置文件，已停止写入');
        return {...layer,effective:result.config||layer.config};
      };
      const before=await read(),configBefore=await readConfig();
      const item=before.find(skill=>skill.path===args.id);
      if(!item)throw new Error('技能已变化或不存在，请刷新清单');
      if(item.pluginId&&configBefore.effective.plugins?.[item.pluginId]?.enabled===false)throw new Error('所属插件已关闭，请先启用插件再管理此技能');
      if(typeof item.enabled!=='boolean'||typeof args.enabled!=='boolean')throw new Error('技能启用状态尚未确认');
      if(args.expectedEnabled!==undefined&&item.enabled!==args.expectedEnabled)throw new Error('启用状态已变化，请刷新后再操作');
      const entries=configBefore.config.skills?.config||[];
      if(item.enabled!==args.enabled){
        // Codex currently reads inline arrays but its skill writer can discard
        // them. Accept only the native array-of-tables storage before writing.
        const document=await fs.readFile(configBefore.name.file);
        const headers=document.toString('utf8').match(/^[\t ]*\[\[[\t ]*skills[\t ]*\.[\t ]*config[\t ]*\]\][\t ]*(?:#.*)?\r?$/gm)||[];
        if(headers.length!==entries.length)throw new Error('技能配置格式不适合单项开关，已停止写入，避免丢失其他技能的关闭记录');
        await request('skills/config/write',{path:item.path,enabled:args.enabled},{cwd});
      }
      const after=await read(),configAfter=await readConfig();
      const current=after.find(skill=>skill.path===args.id);
      if(!current)throw new Error('配置已提交，但技能已不在当前清单中，请刷新确认');
      const identity=async file=>normalize(await fs.realpath(file).catch(()=>file));
      const target=await identity(item.path);
      const remaining=await Promise.all((configAfter.config.skills?.config||[]).map(async entry=>({...entry,identity:await identity(entry.path)})));
      for(const entry of entries){
        const key=await identity(entry.path);
        if(key!==target&&!remaining.some(other=>other.identity===key&&other.enabled===entry.enabled))throw new Error('写入后发现其他技能的配置变化，不能确认成功，请停止操作并核对配置');
      }
      if(before.some(skill=>skill.path!==item.path&&after.find(other=>other.path===skill.path)?.enabled!==skill.enabled))throw new Error('写入后发现其他技能的状态变化，不能确认成功，请刷新核对');
      const ok=current.enabled===args.enabled;
      return {ok,cwd,skillStates:after.filter(skill=>typeof skill.enabled==='boolean').map(skill=>({id:skill.path,enabled:skill.enabled})),message:ok?`已${args.enabled?'启用':'关闭'}该技能，配置已回读确认。`:'配置已提交，但回读未确认目标状态。'};
    } finally {active.delete(key);}
  }
  async function setConfigEnabled(args,request) {
    const key=`${args.kind}:${args.id}`;
    if(active.has(key))throw new Error('该项目仍在操作中，请先确认结果');
    active.add(key);
    try {
      const before=await lookup({cwd:args.cwd});
      const item=before.items.find(item=>item.kind===args.kind&&item.id===args.id);
      if(!item?.actions?.toggle||item.stale||item.parentPlugin||typeof args.enabled!=='boolean')throw new Error('此项目不支持独立开关，请维护所属插件或先确认状态');
      const root={plugin:'plugins',app:'apps',mcp:'mcp_servers'}[args.kind];
      if(!root)throw new Error('此项目不支持启用配置');
      const read=()=>request('config/read',{cwd:before.cwd,includeLayers:true});
      const effective=config=>{
        if(!config?.config)throw new Error('有效配置未完整读取，已停止操作');
        const entry=config.config[root]?.[item.id];
        if(args.kind==='mcp'&&!entry)throw new Error('该 MCP 配置已不存在，请刷新清单');
        return typeof entry?.enabled==='boolean'?entry.enabled:args.kind==='plugin'?item.enabled:true;
      };
      const result=async(enabled,ok,message)=>{
        const value={ok,cwd:before.cwd,itemStates:[{kind:item.kind,id:item.id,enabled,status:enabled?'已启用 · 运行未确认':'已关闭'}],message};
        if(item.kind==='plugin'&&enabled&&ok){
          try{value.skillStates=await readPluginSkills(request,before.cwd,item.id);}
          catch{value.childrenPending=item.id;value.message+=' 附带技能正在等待确认。';}
        }
        return value;
      };
      const initial=await read(),enabled=effective(initial);
      if(enabled===args.enabled)return await result(enabled,true,`已${enabled?'启用':'关闭'}，有效配置已确认。已打开任务可能需要重新加载。`);
      if(args.expectedEnabled!==undefined&&enabled!==args.expectedEnabled)return await result(enabled,false,'配置已被其他操作改变，已同步当前状态；本次未覆盖，请确认后再操作。');
      const filePath=item.configFile||initial.layers?.find(layer=>layer.name.type==='user')?.name.file;
      const layer=initial.layers?.find(layer=>normalize(layer.name.file||'')===normalize(filePath||''));
      await request('config/batchWrite',{edits:[{keyPath:`${root}.${JSON.stringify(item.id)}.enabled`,value:args.enabled,mergeStrategy:'upsert'}],...(filePath?{filePath}:{}),...(layer?.version?{expectedVersion:layer.version}:{})});
      const confirmed=effective(await read());
      return await result(confirmed,confirmed===args.enabled,confirmed===args.enabled?`已${confirmed?'启用':'关闭'}，有效配置已回读确认。已打开任务可能需要重新加载。`:'配置已提交，但有效配置回读未确认目标状态，请核对配置来源。');
    } finally {active.delete(key);}
  }
  return {
    setEnabled(args) {
      return withSession(validateScope(args.cwd),native=>args.kind==='skill'?setSkillEnabled(args,native):setConfigEnabled(args,native));
    },
    refreshChildren(args) {
      return withSession(validateScope(args.cwd),async native=>{
        const cwd=validateScope(args.cwd),config=await native('config/read',{cwd,includeLayers:true});
        if(config.config?.plugins?.[args.id]?.enabled===false)throw new Error('所属插件已关闭');
        return {ok:true,cwd,skillStates:await readPluginSkills(native,cwd,args.id),message:'附带技能状态已确认。'};
      });
    },
    uninstall(args) {
      return withSession(validateScope(args.cwd),native=>perform(args,async(item,before)=>{
        if(item.parentPlugin) throw new Error('这是插件附带内容，请维护所属插件');
        if(item.kind==='plugin'&&item.actions.remove) {
          if(item.id==='skill-manager@personal') throw new Error('请在 Codex 原生插件页卸载管理器自身');
          const removed=await json(['plugin','remove',item.id,'--json'],{timeoutMs:45000,cwd:before.cwd});
          if(removed?.pluginId!==item.id)throw new Error('Codex 未确认移除的是所选插件，不能报告卸载成功，请刷新核对');
          return {ok:true,removedPluginId:item.id,message:'Codex 已确认卸载此插件；其他清单正在后台更新。'};
        }
        if(item.kind==='mcp'&&item.actions.remove) {
          // CLI removal is only valid for the user config. Project config must
          // be changed through the exact origin file, never a lookalike entry.
          await native('config/batchWrite',{filePath:item.configFile,edits:[{keyPath:`mcp_servers.${JSON.stringify(item.id)}`,value:null,mergeStrategy:'replace'}]});
          const confirmed=await native('config/read',{cwd:before.cwd,includeLayers:true});
          const layer=confirmed.layers?.find(layer=>normalize(layer.name.file||fileForLayer(layer))===normalize(item.configFile));
          if(!layer||layer.config?.mcp_servers?.[item.id])throw new Error('移除配置已提交，但所选来源尚未回读确认，请刷新核对');
          if(confirmed.config?.mcp_servers?.[item.id])return {ok:true,removedConfiguration:true,message:'所选配置已移除；另一层配置仍提供此 MCP，清单正在后台更新。'};
          return {ok:true,removedKeys:[{kind:'mcp',id:item.id}],message:'MCP 配置已回读确认移除，服务程序和共享包保留。'};
        }
        if(item.kind!=='skill') throw new Error('该类型没有可用的独立移除方式');
        const entry=item.locations.find(l=>l.path===args.entry);
        if(!removableEntry(item,entry,skillRoots(before.cwd))) throw new Error('只能移除已确认的独立技能入口；归属未知或插件内置技能不可删除');
        const fresh=inspectPath(entry.path);
        if(!args.fingerprint||args.fingerprint!==entry.fingerprint||entry.fingerprint!==fresh.fingerprint) throw new Error('安装位置已经变化，请刷新后再操作');
        const target=path.resolve(path.dirname(entry.path));
        if(entry.links.length) {
          if(process.platform==='win32')await fs.rmdir(target);else await fs.unlink(target);
          return skillRemovalResult(item,args.entry,'已移除选定入口，实际技能文件保留。');
        }
        const backupRoot=path.resolve(storage,'removed-skills');
        const backup=path.resolve(backupRoot,`${crypto.randomUUID()}-${path.basename(target)}`);
        if(!within(backupRoot,backup)||!skillRoots(before.cwd).some(r=>normalize(path.dirname(target))===normalize(r.path))) throw new Error('移除目标超出已确认安装目录');
        await fs.mkdir(backupRoot,{recursive:true});
        await fs.rename(target,backup);
        return {...skillRemovalResult(item,args.entry,`已移出技能目录；可恢复副本保存在 ${backup}`),backup};
      }));
    },
    async openLocation(args) {
      const snapshot=await lookup({cwd:args.cwd});
      const item=snapshot.items.find(i=>i.kind===args.kind&&i.id===args.id);
      const entry=item?.locations.find(l=>l.path===args.entry);
      if(!entry||entry.status!=='正常') throw new Error('目录尚未确认或不可访问');
      const fresh=inspectPath(entry.path);
      if(entry.fingerprint!==fresh.fingerprint||args.fingerprint!==fresh.fingerprint) throw new Error('目录位置已变化，请刷新后重试');
      const target=args.target==='real'?fresh.realDirectory:fresh.directory;
      if(!target||!path.isAbsolute(target)||(await fs.stat(target)).isDirectory()!==true) throw new Error('目标不是可打开的文件夹');
      await open(target);
      return {ok:true,message:'已打开目录'};
    },
  };
}
const fileForLayer=layer=>layer.name.dotCodexFolder?path.join(layer.name.dotCodexFolder,'config.toml'):'';
async function readPluginSkills(request,cwd,pluginId) {
  const result=await request('skills/list',{cwds:[cwd],forceReload:true});
  if(!Array.isArray(result.data)||result.data.some(scope=>scope.errors?.length))throw new Error('附带技能状态暂未完整返回');
  return result.data.flatMap(scope=>scope.skills||[]).filter(skill=>skill.pluginId===pluginId&&typeof skill.enabled==='boolean').map(skill=>({id:skill.path,enabled:skill.enabled,parentEnabled:true}));
}
function skillRemovalResult(item,entry,message) {
  const locations=item.locations.filter(location=>location.path!==entry).map(location=>({...inspectPath(location.path,location.label),scope:location.scope})).filter(location=>location.status==='正常');
  if(!locations.length)return {ok:true,removedKeys:[{kind:'skill',id:item.id}],message};
  return {ok:true,remainingSkill:{id:item.id,locations,locationType:locationSummary(locations),actions:{...item.actions,entries:(item.actions?.entries||[]).filter(value=>locations.some(location=>location.path===value.path))}},message:message+' 其他安装入口仍保留。'};
}
function launchFolder(target) {
  return new Promise((resolve,reject)=>{
    const cmd=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';
    const child=spawn(cmd,[target],{windowsHide:true,stdio:'ignore',shell:false});
    child.once('error',reject); child.once('spawn',()=>{child.unref();resolve();});
  });
}
