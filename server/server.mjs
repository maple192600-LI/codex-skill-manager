import uiHtml from '../ui/dist/client/index.html';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {buildInventory,validateScope,readSnapshot,saveSnapshot,publicInventory} from './inventory.mjs';
import {translationQueue} from './translations.mjs';
import {createActions} from './actions.mjs';
import {createInventoryStore} from './inventory-store.mjs';
import {appServerRequest} from './codex.mjs';
import {readJson} from './state.mjs';
import {createUsageService} from './usage.mjs';
import {acceptUsageReceipt} from './usage-receipt.mjs';

const pluginRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=readJson(path.join(pluginRoot,'.codex-plugin','plugin.json'))?.version||'0.1.0';
const manager={version,build:'public-0.1.0',loadedFrom:pluginRoot,pid:process.pid};
const UI_URI='ui://skill-manager/index.html';
const server=new McpServer({name:'skill-manager',title:'技能管理器',version});
const inventoryStore=createInventoryStore({build:buildInventory,read:readSnapshot,save:saveSnapshot});
const usageService=createUsageService();
process.once('exit',()=>usageService.close());
const actions=createActions({lookup:async({cwd})=>{
  const current=inventoryStore.current(validateScope(cwd));
  if(!current)throw new Error('请先刷新清单，确认目录位置');
  return current;
}});
const scopeSchema={cwd:z.string().optional()};
const targetSchema={...scopeSchema,kind:z.enum(['plugin','app','mcp','skill','command']),id:z.string().min(1)};
const locationSchema={...targetSchema,entry:z.string().min(1),fingerprint:z.string().min(1)};
const response=data=>({content:[{type:'text',text:data.message||'技能管理器数据已返回。'}],structuredContent:{...data,...(data.inventory?{inventory:{...data.inventory,manager}}:{}),...(data.snapshot?{snapshot:{...data.snapshot,manager}}:{}),manager}});
function register(name,title,inputSchema,fn,{write=false,destructive=false}={}) {
  server.registerTool(name,{title,description:title,inputSchema,annotations:{readOnlyHint:!write,destructiveHint:destructive,openWorldHint:false},_meta:{ui:{visibility:['app']}}},async args=>{
    try {return response(await fn(args));}
    catch(error) {return {isError:true,content:[{type:'text',text:error.message||'操作失败，请刷新确认结果'}]};}
  });
}
async function inventory(cwd) {
  return inventoryStore.scan(validateScope(cwd));
}
function acceptInventory(result) {
  const current=inventoryStore.accept(result);
  return current?{...result,inventory:publicInventory(current)}:result;
}
server.registerResource('skill-manager-ui',UI_URI,{title:'技能管理器',description:'查看中文说明、真实状态与安装位置',mimeType:'text/html;profile=mcp-app'},async()=>({contents:[{uri:UI_URI,mimeType:'text/html;profile=mcp-app',text:uiHtml,_meta:{ui:{prefersBorder:false}}}]}));
server.registerTool('open_skill_manager',{title:'技能管理器',description:'打开 Codex 技能管理器，查看已安装插件、MCP、技能的中文用途、安装位置和真实配置状态。',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},_meta:{ui:{resourceUri:UI_URI,visibility:['app','model']},'openai/ui':{entrypoints:[{type:'global'}],preferredModelDisplayMode:'fullscreen'},'openai/toolInvocation/invoking':'正在打开技能管理器…','openai/toolInvocation/invoked':'技能管理器已打开'}},async()=>response({ok:true,snapshot:readSnapshot()}));
server.registerTool('skill_manager_record_usage',{title:'记录本轮实际采用的技能',description:'在本轮实际采用技能指令开展工作后提交一次。skillPaths 只填已采用技能的完整 SKILL.md 路径；安装、扫描、审查时仅查看的目标技能不填。没有采用任何技能时可提交空数组以记录本轮覆盖。记录由本机聊天历史保存，不改变安装或配置，不上传消息正文。',inputSchema:{skillPaths:z.array(z.string().min(1)).max(40),cwd:z.string().optional()},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},_meta:{ui:{visibility:['model']}}},async args=>{
  try{return response({ok:true,usageReceipt:acceptUsageReceipt(args),message:'本轮技能使用记录已接收，将随本机历史统计更新。'});}
  catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
});
register('skill_manager_snapshot','读取上次扩展清单',scopeSchema,async({cwd})=>({snapshot:readSnapshot(cwd)}));
register('skill_manager_inventory','刷新真实扩展清单',scopeSchema,async({cwd})=>publicInventory(await inventory(cwd)));
register('skill_manager_usage','读取本机历史使用统计',{...scopeSchema,days:z.union([z.literal(30),z.literal(90)]).optional(),refresh:z.boolean().optional()},async({cwd,days,refresh})=>{
  const current=inventoryStore.current(validateScope(cwd));
  return {usage:usageService.get(current?.items||[],{days,refresh})};
});
register('skill_manager_translate','补齐新增内容的中文说明',{...scopeSchema,retry:z.boolean().optional()},async({cwd,retry})=>{
  const current=inventoryStore.current(validateScope(cwd))||await inventory(cwd);
  return {translation:translationQueue.enqueue(current.items,{retry})};
},{write:true});
register('skill_manager_translation_status','读取中文说明更新结果',scopeSchema,async({cwd})=>{
  const current=inventoryStore.current(validateScope(cwd));
  if(!current) return {translation:{running:false,pending:0,failed:0},inventory:null};
  return {translation:translationQueue.status(current.items),inventory:publicInventory(current)};
});
register('skill_manager_set_enabled','修改启用配置后重新读取状态',{...targetSchema,enabled:z.boolean(),expectedEnabled:z.boolean().optional()},async args=>acceptInventory(await actions.setEnabled(args)),{write:true});
register('skill_manager_refresh_children','确认插件附带技能的状态',{...scopeSchema,id:z.string().min(1)},async args=>acceptInventory(await actions.refreshChildren(args)));
register('skill_manager_uninstall','移除选定安装或技能入口后重新读取状态',{...targetSchema,entry:z.string().optional(),fingerprint:z.string().optional()},async args=>acceptInventory(await actions.uninstall(args)),{write:true,destructive:true});
register('skill_manager_open_location','打开清单中已确认的目录',{...locationSchema,target:z.enum(['entry','real'])},args=>actions.openLocation(args),{write:true});
register('skill_manager_check_connection','检查 MCP 在本机查询环境中的连接',targetSchema,async args=>{
  const current=await inventory(args.cwd),item=current.items.find(i=>i.kind===args.kind&&i.id===args.id);
  if(item?.kind!=='mcp') throw new Error('请选择 MCP 服务');
  if(item.stale) throw new Error('该服务状态尚未确认，请先刷新后再检查连接');
  const result=await appServerRequest('mcpServerStatus/list',{detail:'toolsAndAuthOnly',limit:200},{cwd:current.cwd,timeoutMs:12000});
  const found=result.data?.find(s=>s.name===(item.runtimeName||item.name)&&(!item.parentPlugin||s.pluginId===item.parentPlugin));
  const count=Object.keys(found?.tools||{}).length;
  item.status=found?(count?'查询环境已连接':found.authStatus==='notLoggedIn'?'需要登录':'已发现服务 · 可调用性未确认'):'查询环境未发现服务';
  item.callable=count?true:null;
  item.connectionNote=`本机独立查询，${new Date().toLocaleString('zh-CN')}；已发现 ${count} 个工具。现有任务状态可能不同。`;
  return {inventory:publicInventory(current),message:item.connectionNote};
},{write:true});
process.stderr.write(`[skill-manager] ready ${version}\n`);
await server.connect(new StdioServerTransport());
