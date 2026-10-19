// Only explicit structured events establish use. Names mentioned in prose do not.
export const DAY=86_400_000;
export const usageKey=item=>`${item.kind}:${item.id}`;
import {skillPathKey} from './skill-use-evidence.mjs';
export const canonicalPath=value=>String(value||'').replaceAll('\\','/').replace(/\/+$/,'').toLowerCase();
const terminal=new Set(['completed','failed','cancelled']);
const maintenance=new Set(['initialize','tools/list','resources/list','prompts/list','skill_manager_check_connection','skill_manager_record_usage']);
const dayOf=at=>{const d=new Date(at);return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;};

export function compactEvent(row) {
  const at=Number(row.at);
  if(!Number.isFinite(at)||at<=0)return null;
  if(row.item_type==='userMessage') {
    const skills=(row.skills||[]).filter(x=>x.type==='skill'&&x.path).map(x=>({path:x.path,name:x.name}));
    return {type:'user',at,skills};
  }
  if(row.item_type==='mcpToolCall'&&terminal.has(row.status)&&!maintenance.has(row.tool))
    return {type:'tool',at,server:row.server,tool:row.tool,pluginId:row.pluginId||null,appId:row.appId||null,status:row.status};
  if(row.item_type==='commandExecution'&&row.status==='completed') {
    // A parsed read or a direct shell read is weak evidence only. Never inspect output.
    const paths=new Set((row.commandActions||[]).filter(a=>a.type==='read'&&a.path&&/[/\\]SKILL\.md$/i.test(a.path)).map(a=>a.path));
    for(const match of String(row.command||'').matchAll(/(?:^|[;\r\n]|&&)\s*(?:Get-Content\s+(?:-LiteralPath\s+|-Path\s+)?|cat\s+|type\s+)["']([^"'\r\n]*[/\\]SKILL\.md)["']/gi))paths.add(match[1]);
    if(paths.size)return {type:'read',at,paths:[...paths]};
    if(row.pluginId&&row.scriptPath)return {type:'script',at,pluginId:row.pluginId,status:'completed'};
  }
  return null;
}

export function sourceLabel(item) {
  if(item.parentPlugin)return '随插件提供';
  if(item.kind==='skill')return item.scope==='system'?'Codex 自带':item.scope==='repo'?'项目技能':'个人技能入口';
  if(item.kind==='plugin')return item.managed?'默认提供的插件':'独立插件';
  if(item.kind==='mcp')return item.configWritable?'个人或项目配置':'其他配置来源';
  return item.source||'来源未确认';
}
export function independentlyManaged(item) {
  return !item.stale&&Boolean(item.actions?.toggle||item.actions?.remove||item.actions?.entries?.length);
}

export function buildUsageReport(items,index,{days=90,now=Date.now()}={}) {
  const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-days+1);
  const since=start.getTime(), records=new Map(), active=new Set(), matched=new Set();
  const byPlugin=new Map(),byApp=new Map(),byMcp=new Map(),bySkill=new Map();
  const add=(map,key,item)=>{if(key)map.set(key,[...(map.get(key)||[]),item]);};
  for(const item of items) {
    records.set(usageKey(item),{chats:new Set(),reads:new Set(),selected:new Set(),uses:new Set(),days:new Set(),calls:0,success:0,failed:0,lastUsedAt:null,lastReadAt:null,evidence:new Set()});
    if(item.kind==='plugin')byPlugin.set(item.id,item);
    if(item.kind==='app')byApp.set(item.id,item);
    if(item.kind==='mcp')add(byMcp,item.runtimeName||item.name,item);
    if(item.kind==='skill')for(const p of new Set([item.path,item.id,...(item.locations||[]).flatMap(l=>[l.path,l.realPath])].filter(Boolean).map(skillPathKey)))add(bySkill,p,item);
  }
  const threads=index?.threads||{};
  const usableRoot=id=>threads[id]?.hasUser===true;
  const datesByRoot=new Map(),coveredRoots=new Set();
  for(const [id,thread] of Object.entries(threads))if(usableRoot(thread.root)) {
    const dates=datesByRoot.get(thread.root)||new Set(),turns=new Set(),reported=new Set();
    for(const event of Object.values(thread.events||{}))if(event.at>=since&&event.at<=now) {
      dates.add(dayOf(event.at));
      if(event.type==='user'&&event.turnId)turns.add(event.turnId);
      if(event.type==='receipt'&&event.turnId)reported.add(event.turnId);
    }
    datesByRoot.set(thread.root,dates);
    if(id===thread.root&&turns.size&&[...turns].every(t=>reported.has(t)))coveredRoots.add(id);
  }
  for(const thread of Object.values(threads))if(usableRoot(thread.root)) {
    if(thread.activityAt>=since&&thread.activityAt<=now)active.add(thread.root);
    // Legacy prose-based adoptions are not actual use, even in an old cache.
    const events=Object.values(thread.events||{});
    for(const event of events)if(event.at>=now-90*DAY&&event.at<=now) {
      const inPeriod=event.at>=since;
      if(inPeriod)active.add(thread.root);
      const targets=new Map();
      const target=(item,evidence)=>{if(item)targets.set(usageKey(item),{item,evidence});};
      if(event.type==='tool') {
        target(byPlugin.get(event.pluginId),'工具调用');
        const app=byApp.get(event.appId);
        target(app,'工具调用');target(byPlugin.get(app?.parentPlugin),'工具调用');
        const candidates=(byMcp.get(event.server)||[]).filter(i=>event.pluginId?i.parentPlugin===event.pluginId:true);
        // Unlabelled calls are attributed only when runtime ownership is unique.
        if(candidates.length===1){target(candidates[0],'工具调用');target(byPlugin.get(candidates[0].parentPlugin),'工具调用');}
      } else if(event.type==='script')target(byPlugin.get(event.pluginId),'插件脚本');
      else if(event.type==='receipt')for(const p of event.paths||[])for(const item of bySkill.get(skillPathKey(p))||[]) {
        target(item,'实时使用记录');target(byPlugin.get(item.parentPlugin),'技能使用');
      }
      else if(event.type==='read')for(const p of event.paths||[])for(const item of bySkill.get(skillPathKey(p))||[])target(item,'仅阅读说明');
      for(const {item,evidence} of targets.values()) {
        const value=records.get(usageKey(item));
        if(evidence==='仅阅读说明'){value.lastReadAt=Math.max(value.lastReadAt||0,event.at);if(inPeriod){value.reads.add(thread.root);value.evidence.add(evidence);}continue;}
        value.lastUsedAt=Math.max(value.lastUsedAt||0,event.at);
        if(!inPeriod)continue;
        value.evidence.add(evidence);matched.add(thread.root);value.chats.add(thread.root);
        if(['实时使用记录','技能使用'].includes(evidence)) {
          value.selected.add(thread.root);value.uses.add(`${thread.root}:${event.turnId||event.at}`);value.days.add(dayOf(event.at));
        }
        else {value.calls++;if(event.status==='completed')value.success++;else value.failed++;}
      }
    }
  }
  const available=Boolean(index?.completedAt);
  const values={};
  for(const item of items) {
    const v=records.get(usageKey(item));
    const supported=['plugin','skill','mcp','app'].includes(item.kind);
    const projectRoot=item.kind==='skill'&&item.scope==='repo'?canonicalPath(item.path||item.id).replace(/\/\.(?:agents|codex)\/skills\/.*$/i,''):null;
    const eligible=projectRoot?new Set(Object.values(threads).filter(t=>usableRoot(t.root)&&(canonicalPath(t.cwd)===projectRoot||canonicalPath(t.cwd).startsWith(projectRoot+'/'))&&t.activityAt>=since&&t.activityAt<=now).map(t=>t.root)):new Set(active);
    for(const root of v.chats)eligible.add(root);
    const activeDays=new Set();
    for(const root of eligible)for(const day of datesByRoot.get(root)||[])activeDays.add(day);
    const hasMissingMetadata=Object.values(threads).some(t=>typeof t.missing==='boolean');
    const missingInScope=(!projectRoot&&Boolean(index?.coverage?.missing))||(hasMissingMetadata?Object.values(threads).some(t=>t.missing&&t.sourceUpdated*1000>=since&&(!projectRoot||canonicalPath(t.cwd)===projectRoot||canonicalPath(t.cwd).startsWith(projectRoot+'/'))):Boolean(index?.coverage?.missing));
    const complete=eligible.size>0&&!missingInScope&&[...eligible].every(root=>item.kind==='skill'?coveredRoots.has(root):threads[root]?.missing===false);
    const zeroUnknown=!v.chats.size&&!complete;
    const status=!supported?'unsupported':!available||zeroUnknown?'unknown':v.chats.size?'observed':'no-record';
    // Missing days/chats can affect both numerator and denominator. Counts are
    // a lower bound; a percentage with an incomplete denominator is unknown.
    values[usageKey(item)]={status,complete,chats:v.chats.size,uses:v.uses.size,usedDays:v.days.size,activeDays:activeDays.size,dayRate:available&&complete&&activeDays.size?v.days.size/activeDays.size:null,eligibleChats:eligible.size,scopeLabel:projectRoot?`项目：${projectRoot}`:'本机全部项目',lowerBound:!complete,calls:v.calls,success:v.success,failed:v.failed,selectedChats:v.selected.size,lastUsedAt:v.lastUsedAt,rate:available&&supported&&complete&&eligible.size?v.chats.size/eligible.size:null,evidence:[...v.evidence].filter(e=>e!=='仅阅读说明'),sourceLabel:sourceLabel(item),installationSource:item.installationSource||null,sourceRepository:item.sourceRepository||null,independent:independentlyManaged(item)};
  }
  return {days,since,generatedAt:now,activeChats:active.size,matchedChats:matched.size,items:values,coverage:index?.coverage||null,completedAt:index?.completedAt||null,available};
}
