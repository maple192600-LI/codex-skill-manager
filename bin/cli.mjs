#!/usr/bin/env node
import {install,selector} from './install.mjs';
import {codexPath,runCodexCli} from '../server/codex.mjs';
import os from 'node:os';

const args=process.argv.slice(2);
const help=()=>console.log(`Codex 技能管理器 / Codex Skill Manager\n\n安装：npx --yes --allow-git=root github:maple192600-LI/codex-skill-manager install\n检查：npx --yes --allow-git=root github:maple192600-LI/codex-skill-manager doctor\n\ninstall [--ref main] [--json]  注册本插件市场并通过 Codex 原生接口安装\ndoctor                       只读检查 Node、Codex 和安装状态\n\n需要 Node.js 24+、npm 12+、Git 和支持 plugin 子命令的 Codex。不会改写 AGENTS.md。`);
try {
  if(args.includes('--help')||args.includes('-h')){help();}
  else {
    if(Number(process.versions.node.split('.')[0])<24)throw Error('需要 Node.js 24 或更高版本。');
    const command=args.shift()||'install';
    let ref='main',json=false;
    while(args.length){const flag=args.shift();if(flag==='--json')json=true;else if(flag==='--ref'&&args[0]&&!args[0].startsWith('-'))ref=args.shift();else throw Error(`不支持的参数：${flag}。请使用 --help。`);}
    let result;
    if(command==='install')result=await install({ref});
    else if(command==='doctor'){
      const options={cwd:os.homedir(),timeoutMs:60000};
      const version=(await runCodexCli(['--version'],options)).stdout.trim();
      const list=JSON.parse((await runCodexCli(['plugin','list','--json'],options)).stdout);
      result={node:process.version,codex:version,codexPath:codexPath(),plugin:list.installed?.find(item=>item.pluginId===selector)||null};
    }else throw Error(`不支持的命令：${command}。请使用 --help。`);
    console.log(json||command==='doctor'?JSON.stringify(result,null,2):result.message);
  }
}catch(error){console.error(`技能管理器：${error.message}`);process.exitCode=1;}
