import fs from 'node:fs';
import path from 'node:path';
import {codexHome,within} from './state.mjs';
import {inspectPath} from './locations.mjs';

export function commandItems({plugins=[]}={}) {
  // Published desktop command reference. Availability is contextual; these
  // are reference entries, never claims that a command is enabled in a task.
  const documented=[
    ['approve','批准重试','允许最近被自动审核拒绝的操作重试一次；仅在对应审核状态下可用。'],
    ['cloud','云端执行','切换到可用的云端环境运行任务。'],['cloud-environment','选择云环境','选择当前任务使用的云环境。'],
    ['compact','压缩上下文','压缩当前任务的上下文。'],['fast','快速服务','切换当前模型提供的快速服务档位；取决于账户和模型。'],
    ['feedback','提交反馈','打开反馈窗口，可自行选择是否附带日志。'],['fork','分叉任务','将本地任务复制到新的任务或工作树。'],
    ['goal','设置目标','设置需要持续推进的任务目标。'],['ide-context','编辑器上下文','切换是否共享编辑器上下文。'],
    ['init','项目说明','为当前项目生成 AGENTS.md 初稿。'],['local','本地执行','在选定的本地项目中执行。'],
    ['mcp','MCP 状态','打开 MCP 服务连接状态。'],['memories','记忆设置','设置当前任务如何使用或生成记忆。'],
    ['model','选择模型','选择当前任务的模型。'],['pet','桌面宠物','唤醒或收起桌面宠物。'],
    ['personality','回应风格','为支持该功能的模型选择回应风格。'],['plan','计划模式','切换用于多步骤任务的计划模式。'],
    ['project','选择项目','为新任务选择项目。'],['reasoning','推理强度','选择当前任务的推理强度。'],
    ['review','代码审查','审查未提交的更改，或与基准分支比较。'],['side','临时讨论','在主任务旁开始临时讨论。'],
    ['status','任务状态','查看任务标识、上下文用量与使用限额。'],['task','独立任务','开始不关联项目的新任务。'],
    ['worktree','工作树','在新的 Git 工作树中运行任务。'],
  ];
  const items=documented.map(([name,title,description])=>({kind:'command',id:`builtin:${name}`,name:`/${name}`,command:`/${name}`,description,providedChinese:{chineseName:title,chineseSummary:description,chineseDescription:description,scenariosZh:[description],inputsZh:['在 Codex 输入框中选择该命令'],outputsZh:['由 Codex 原生界面执行相应操作'],permissionsZh:['遵循当前任务权限和账户可用功能'],risksZh:['部分命令受当前任务状态或账户能力限制']},source:'Codex 内置命令参考',locations:[{label:'命令来源',path:'Codex 桌面客户端内置，无独立安装目录',type:'内置',status:'不适用本地路径',links:[]},{label:'官方参考 · 2026-09-05 核对',path:'https://learn.chatgpt.com/docs/reference/slash-commands',type:'官方参考',status:'当前任务可用性未确认',links:[]}],enabled:null,installed:null,callable:null,status:'官方已列出 · 当前任务可用性未确认',capabilities:[],parameters:[]}));
  const roots=[{dir:path.join(codexHome,'prompts'),source:'个人 Prompt',prefix:'/prompts:'}];
  // Only explicitly declared command directories; an arbitrary scripts folder
  // is not proof of a Codex slash command.
  for(const p of plugins) if(p.installPath&&typeof p.manifest?.commands==='string') {
    const dir=path.resolve(p.installPath,p.manifest.commands);
    if(within(p.installPath,dir)) roots.push({dir,source:`插件声明 · ${p.name}`,parentPlugin:p.id,prefix:`/${p.name}:`});
  }
  for(const root of roots) {
    let files; try{files=fs.readdirSync(root.dir);}catch{continue;}
    for(const file of files.filter(f=>f.endsWith('.md'))) {
      const full=path.join(root.dir,file),text=fs.readFileSync(full,'utf8'),name=path.basename(file,'.md');
      const description=text.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g,'')||text.replace(/^---[\s\S]*?---\s*/,'').slice(0,200);
      items.push({kind:'command',id:full,name:root.prefix+name,command:root.prefix+name,description,sourceText:text,source:root.source,parentPlugin:root.parentPlugin,path:full,locations:[inspectPath(full,'命令来源')],installed:true,enabled:null,callable:null,status:'已发现声明 · 当前任务可用性未确认',parameters:[...new Set(text.match(/\$[A-Z_]+|\$\d+/g)||[])],capabilities:[]});
    }
  }
  return items;
}
