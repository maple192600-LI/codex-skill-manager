import os from 'node:os';
import {runCodexCli} from '../server/codex.mjs';

export const selector='skill-manager@codex-skill-manager';
export const repository='https://github.com/maple192600-LI/codex-skill-manager.git';
export async function install({source=repository,ref='main',cwd=os.homedir(),env=process.env,run=runCodexCli}={}) {
  const options={cwd,env,timeoutMs:120000};
  const json=async args=>{const result=await run(args,options);try{return JSON.parse(result.stdout);}catch{throw Error('Codex 没有返回有效 JSON；请更新支持插件管理的 Codex。');}};
  const list=async()=>{const result=await json(['plugin','list','--json']);if(!Array.isArray(result.installed))throw Error('无法确认当前安装记录；已停止安装。');return result.installed;};
  const before=await list();
  const existing=before.find(item=>item.pluginId===selector&&item.installed===true);
  if(existing)return {ok:true,alreadyInstalled:true,pluginId:selector,enabled:existing.enabled,message:'已安装；现有启用或关闭状态保持不变。'};
  const other=before.find(item=>item.installed===true&&(item.name==='skill-manager'||item.pluginId?.startsWith('skill-manager@')));
  if(other)throw Error(`检测到其他来源的同名插件 ${other.pluginId}。已保留原安装；请先确认迁移方案，避免重复安装。`);
  await json(['plugin','marketplace','add',source,...(ref?['--ref',ref]:[]),'--json']);
  await json(['plugin','add',selector,'--json']);
  const installed=(await list()).find(item=>item.pluginId===selector&&item.installed===true);
  if(!installed)throw Error('安装命令已执行，但原生回读未确认目标；请在 Codex 中检查插件状态后重试。');
  return {ok:true,alreadyInstalled:false,pluginId:selector,enabled:installed.enabled,message:'Codex 已确认安装。重启桌面客户端后，对 agent 说“打开技能管理器”。'};
}
