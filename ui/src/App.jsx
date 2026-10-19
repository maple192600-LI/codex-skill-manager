import {useEffect,useMemo,useRef,useState} from 'react';
import {IconApps,IconPlugConnected,IconServer,IconSparkles,IconCommand,IconSearch,IconRefresh,IconX,IconFolder,IconCopy,IconChevronRight} from '@tabler/icons-react';
import {callBridgeTool,openHostLink} from './bridge.js';
import {countStates,applyInventoryResult} from '../../shared/inventory-state.mjs';
import {filterItems,displaySource} from '../../shared/list-view.mjs';
import {managementInfo,uninstallTarget,uninstallLabel,originLabel} from '../../shared/management.mjs';
import {useUsage,UsageControls,UsageLine,UsageDetail} from './Usage.jsx';

const tabs=[['plugin','插件',IconPlugConnected],['app','应用',IconApps],['mcp','MCP',IconServer],['skill','技能',IconSparkles],['command','斜杠命令',IconCommand]];
const empty={items:[],counts:{},warnings:[]};
const key=item=>`${item.kind}:${item.id}`;
const unknown=['原始资料未说明'];
function Toggle({item,busy,onToggle}) {
  const label=item.enabled===true?'关闭':item.enabled===false?'启用':'状态未确认';
  if(!item.actions?.toggle)return ['plugin','skill'].includes(item.kind)?<button className="switch-action" disabled title={managementInfo(item).reason}>{label}</button>:null;
  return <button className="switch-action" role="switch" aria-checked={item.enabled} aria-label={`${label}${item.chineseName||item.name}`} disabled={busy} onClick={()=>onToggle(item)}><span className={`toggle ${item.enabled?'is-on':''}`} aria-hidden="true"><span/></span><span>{label}</span></button>;
}
function Info({title,values}) {return <section className="info-section"><h3>{title}</h3><ul>{(values?.length?values:unknown).map((text,i)=><li key={i}>{text}</li>)}</ul></section>;}
async function copyText(text) {
  if(navigator.clipboard?.writeText) {try{await navigator.clipboard.writeText(text);return;}catch{/* Host may deny clipboard API. */}}
  const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();const copied=document.execCommand('copy');area.remove();if(!copied) throw new Error('复制未获允许，请选中完整路径复制');
}
function Detail({item,usage,busy,onClose,onToggle,onAction,onCopy,onParent,removeRequest,onRemoveRequestHandled,onRequestRemove,removalTarget,dependents=[]}) {
  const [confirm,setConfirm]=useState(null);
  useEffect(()=>setConfirm(null),[item.id]);
  useEffect(()=>{if(removeRequest?.key===key(item)){setConfirm({...removeRequest.entry,requestedSkill:removeRequest.requestedSkill});onRemoveRequestHandled();}},[removeRequest,item.id]);
  const management=managementInfo(item);
  const entries=item.locations?.filter(location=>item.actions?.entries?.some(entry=>entry.path===location.path))||[];
  const chosen=confirm?.path?entries.find(entry=>entry.path===confirm.path):entries.length===1?entries[0]:null;
  const impact=item.kind==='plugin'?'移除后，这个插件附带的技能和 MCP 不再随插件加载；已单独连接的应用、来源项目和已生成文件保留。':item.kind==='mcp'?'移除的是 Codex 连接配置，服务程序和共享包保留。':item.parentPlugin?'由所属插件维护，不能独立卸载。':'移除链接只影响选定入口，共享原文保留；普通目录移出后保存可恢复副本。';
  const remove=(entry)=>setConfirm(entry||{});
  return <aside className="detail" aria-label="扩展详情">
    <div className="detail-top"><span>{tabs.find(t=>t[0]===item.kind)?.[1]}</span><button className="icon-button" onClick={onClose} aria-label="关闭详情"><IconX/></button></div>
    <h2>{item.chineseName||item.name}</h2><p className="original-name">{item.name}</p>
    {confirm?<div className="confirm" role="alertdialog" aria-label="确认卸载"><h3>{management.removalLabel||'移除选定入口'}：{item.chineseName||item.name}</h3><p>{impact}</p>{confirm.requestedSkill?<p>你选择的“{confirm.requestedSkill}”随这个插件安装；继续将卸载整个插件，而不只是该技能。若只想停用此技能，请取消后点击“关闭”。</p>:null}{item.kind==='skill'&&entries.length>1?<label>选择要卸载的安装入口<select aria-label="卸载安装入口" value={confirm.path||''} onChange={event=>setConfirm(entries.find(entry=>entry.path===event.target.value)||{})}><option value="">请选择一个入口</option>{entries.map(entry=><option key={entry.path} value={entry.path}>{entry.path}</option>)}</select></label>:null}{chosen?<code>{chosen.path}</code>:null}{item.kind==='plugin'&&dependents.length?<div className="uninstall-dependents"><b>插件附带内容（独立应用连接保留）：</b><ul>{dependents.map(child=><li key={key(child)}>{child.chineseName||child.name}</li>)}</ul></div>:null}<div><button className="secondary" onClick={()=>setConfirm(null)}>取消</button><button className="remove-button" disabled={busy||item.kind==='skill'&&!chosen} onClick={()=>{onAction('uninstall',item,{entry:chosen?.path,fingerprint:chosen?.fingerprint});setConfirm(null);}}>确认{confirm.requestedSkill?'卸载整个插件':management.removalLabel||'移除'}</button></div></div>:null}
    <section className="purpose"><h3>它能做什么</h3><p>{item.chineseSummary||item.description||'原始资料未说明'}</p>{item.chineseDescription&&item.chineseDescription!==item.chineseSummary?<details><summary>查看完整说明</summary><p>{item.chineseDescription}</p></details>:null}</section>
    <section className="locations"><h3><IconFolder/>安装位置 <span>{item.locationType}</span></h3>
      {item.locations?.map((location,i)=><div className="location" key={`${location.path}:${i}`}>
        <div className="location-label">{location.label}{location.scope==='repo'?' · 项目入口':''}<span className={location.status==='正常'?'':'caution'}>{location.status}</span></div>
        <code>{location.path}</code>
        {location.links?.map(link=><div className="link-target" key={link.path}><span>{link.type} →</span><code>{link.target}</code></div>)}
        {location.realPath&&location.realPath!==location.path?<><div className="location-label">实际文件位置</div><code>{location.realPath}</code></>:null}
        <div className="location-buttons"><button onClick={()=>onCopy(location.path)}><IconCopy/>复制{location.realPath?'入口':'位置'}</button>{location.realPath&&location.realPath!==location.path?<button onClick={()=>onCopy(location.realPath)}><IconCopy/>复制实际路径</button>:null}
          {location.status==='正常'?<><button disabled={busy} onClick={()=>onAction('open_location',item,{entry:location.path,fingerprint:location.fingerprint,target:'entry'})}><IconFolder/>打开入口目录</button>{location.realPath!==location.path?<button disabled={busy} onClick={()=>onAction('open_location',item,{entry:location.path,fingerprint:location.fingerprint,target:'real'})}><IconFolder/>打开实际目录</button>:null}</>:null}
        </div>
        {item.actions?.entries?.some(e=>e.path===location.path)?<button className="text-danger" disabled={busy} onClick={()=>remove(location)}>{location.links?.length?'移除这个入口':'移除这个安装目录'}</button>:null}
      </div>)}
    </section>
    <div className="detail-status"><div><b>{item.status}</b><small>{item.stale?(item.lastConfirmedAt?`上次确认：${new Date(item.lastConfirmedAt).toLocaleString('zh-CN')}。本次未确认，暂不提供开关或卸载。`:'本次尚未确认安装状态，暂不提供开关或卸载。'):item.connectionNote||'配置启用不等于当前任务已加载成功。'}</small></div><Toggle item={item} busy={busy} onToggle={onToggle}/></div>
    {management.reason?<p className="management-note">{management.reason}</p>:null}
    {item.kind==='mcp'?<button className="secondary" disabled={busy||item.stale} onClick={()=>onAction('check_connection',item)}>检查本机连接</button>:null}
    {item.parentPlugin?<button className="parent-link" onClick={()=>onParent(item.parentPlugin)}>由 {item.parentPlugin} 提供 <IconChevronRight/></button>:null}
    {item.command?<section className="info-section"><h3>原始命令</h3><code>{item.command}</code><p>参数：{item.parameters?.join('、')||'未声明'}</p><button className="secondary" onClick={()=>onCopy(item.command)}>复制原命令</button></section>:null}
    <UsageDetail item={item} usage={usage}/>
    <Info title="什么时候会用到" values={item.scenariosZh}/><Info title="需要提供什么" values={item.inputsZh}/><Info title="会得到什么" values={item.outputsZh}/><Info title="权限与依赖" values={item.permissionsZh}/><Info title="使用时要注意" values={item.risksZh}/>
    <section className="impact"><h3>关闭或移除的影响</h3><p>{impact}</p></section>
    <details className="technical"><summary>其他技术信息</summary><dl>{[['原始标识',item.id],['来源',item.source],['版本',item.version||'未声明'],['作用范围',item.scope||'本机查询环境'],['位置确认时间',item.observedAt]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
    {['plugin','skill'].includes(item.kind)||management.removalLabel?<button className="remove-button" disabled={busy||!removalTarget} title={!removalTarget?management.reason:undefined} onClick={()=>removalTarget.id===item.id?remove():onRequestRemove(removalTarget,item)}>{uninstallLabel(item,removalTarget)}</button>:null}
  </aside>;
}
export function App() {
  const [inventory,setInventory]=useState(empty),[active,setActive]=useState('plugin'),[query,setQuery]=useState(''),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[stateFilter,setStateFilter]=useState(''),[sourceFilter,setSourceFilter]=useState(''),[locationFilter,setLocationFilter]=useState(''),[cwd,setCwd]=useState(''),[projectInput,setProjectInput]=useState(''),[showScope,setShowScope]=useState(false),[translation,setTranslation]=useState({}),[adding,setAdding]=useState(false);
  const generation=useRef(0),refreshGeneration=useRef(0),refreshChanges=useRef(null),timer=useRef(null),busyRef=useRef(false),childrenTimer=useRef(null),scopeGeneration=useRef(0);
  const [originFilter,setOriginFilter]=useState(''),[pendingChildren,setPendingChildren]=useState(null);
  const [removeRequest,setRemoveRequest]=useState(null);
  const [usageDays,setUsageDays]=useState(90),[usageFilter,setUsageFilter]=useState(''),[usageSort,setUsageSort]=useState(''),[independent,setIndependent]=useState(false);
  const {usage,problem:usageProblem,retry:retryUsage}=useUsage(usageDays,inventory.generatedAt,cwd);
  function accept(value){if(value?.items) setInventory(value);}
  async function poll(scope,gen) {
    try {
      const result=await callBridgeTool('skill_manager_translation_status',{cwd:scope||undefined});
      if(gen!==generation.current) return;
      setTranslation(result.translation);accept(result.inventory);
      if(result.translation.running) timer.current=setTimeout(()=>poll(scope,gen),4000);
      else if(result.translation.pending&&!result.translation.paused) await startTranslation(scope,gen);
    } catch {if(gen===generation.current)setTranslation(t=>({...t,running:false,failed:Math.max(1,t.failed||0)}));}
  }
  async function startTranslation(scope,gen,retry=false) {
    try {
      const result=await callBridgeTool('skill_manager_translate',{cwd:scope||undefined,retry});
      if(gen!==generation.current) return;
      setTranslation(result.translation);
      if(result.translation.running||(result.translation.pending&&!result.translation.paused)) timer.current=setTimeout(()=>poll(scope,gen),2500);
      else await poll(scope,gen);
    } catch {if(gen===generation.current)setTranslation({running:false,failed:1});}
  }
  async function refresh(scope=cwd,useSnapshot=false) {
    const gen=++refreshGeneration.current;generation.current++;clearTimeout(timer.current);setLoading(true);setError('');
    const changes=[];refreshChanges.current=changes;
    try {
      if(useSnapshot) {try{const saved=await callBridgeTool('skill_manager_snapshot',{cwd:scope||undefined});if(gen!==refreshGeneration.current)return;if(saved.snapshot)accept(saved.snapshot);}catch{/* A missing or damaged snapshot does not block a fresh native read. */}}
      const next=await callBridgeTool('skill_manager_inventory',{cwd:scope||undefined});
      if(gen!==refreshGeneration.current)return;
      if(!Array.isArray(next?.items))throw new Error('Codex 未返回有效的扩展清单');
      accept(changes.reduce(applyInventoryResult,next));startTranslation(scope,generation.current);
    } catch(reason) {if(gen===refreshGeneration.current){setError(reason.message||'读取失败');setInventory(current=>({...current,stale:true}));}}
    finally {if(gen===refreshGeneration.current){setLoading(false);refreshChanges.current=null;}}
  }
  useEffect(()=>{refresh(cwd,true);return()=>{generation.current++;refreshGeneration.current++;clearTimeout(timer.current);clearTimeout(childrenTimer.current);setPendingChildren(null);};},[cwd]);
  async function confirmChildren(id,scope=cwd) {
    const gen=generation.current;
    try{
      const result=await callBridgeTool('skill_manager_refresh_children',{id,cwd:scope||undefined});
      if(gen!==generation.current)return;
      refreshChanges.current?.push(result);accept(result.inventory);setInventory(current=>applyInventoryResult(current,result));setPendingChildren(null);
    }catch{if(gen===generation.current)setPendingChildren(id);}
  }
  function resetFilters(){setQuery('');setSourceFilter('');setOriginFilter('');setLocationFilter('');setStateFilter('');setUsageFilter('');setIndependent(false);}
  function changeScope() {
    if(busyRef.current||loading)return;
    const next=projectInput.trim();
    setShowScope(false);setNotice('');setError('');
    if(next===cwd)return;
    scopeGeneration.current++;generation.current++;refreshGeneration.current++;
    clearTimeout(timer.current);clearTimeout(childrenTimer.current);refreshChanges.current=null;
    setInventory(empty);setSelected(null);setRemoveRequest(null);setPendingChildren(null);setTranslation({});resetFilters();setCwd(next);
  }
  function changeKind(kind){setActive(kind);setSelected(null);resetFilters();}
  async function action(name,item,args={}) {
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');setNotice(name==='set_enabled'?`正在${args.enabled?'启用':'关闭'}“${item.chineseName||item.name}”…`:'正在处理…');clearTimeout(timer.current);clearTimeout(childrenTimer.current);generation.current++;
    try {
      const result=await callBridgeTool(`skill_manager_${name}`,{kind:item.kind,id:item.id,cwd:cwd||undefined,...args},{timeoutMs:name==='uninstall'?80000:25000});
      accept(result.inventory);
      refreshChanges.current?.push(result);setInventory(current=>applyInventoryResult(current,result));
      setPendingChildren(result.childrenPending||null);
      if(result.childrenPending)childrenTimer.current=setTimeout(()=>confirmChildren(result.childrenPending),2000);
      if(result.ok===false){setNotice('');setError(result.message||'操作未确认成功');}else setNotice(result.message||'操作已返回');
      if(name==='uninstall'&&result.ok===true){setSelected(null);resetFilters();if(!refreshChanges.current)refresh();}
      else if(!refreshChanges.current)startTranslation(cwd,generation.current);
    } catch(reason) {setNotice('');setError(reason.message||'操作失败');}
    finally {busyRef.current=false;setBusy(false);}
  }
  const toggle=item=>action('set_enabled',item,{enabled:!item.enabled,expectedEnabled:item.enabled});
  const requestRemove=(item,requestedItem)=>{setSelected(key(item));setRemoveRequest({key:key(item),requestedSkill:requestedItem?.kind==='skill'&&requestedItem.parentPlugin?(requestedItem.chineseName||requestedItem.name):undefined});};
  const showParent=id=>{changeKind('plugin');setSelected(`plugin:${id}`);};
  const copy=async text=>{const gen=scopeGeneration.current;try{await copyText(text);if(gen===scopeGeneration.current)setNotice('已复制完整内容');}catch(e){if(gen===scopeGeneration.current)setError(e.message);}};
  const visible=useMemo(()=>filterItems(inventory.items,{kind:active,query,source:sourceFilter,origin:originFilter,location:locationFilter,state:stateFilter,usageFilter,sort:usageSort,independent},usage),[inventory,active,query,stateFilter,sourceFilter,originFilter,locationFilter,usage,usageFilter,usageSort,independent]);
  const conditions=[query.trim()?`搜索：${query.trim()}`:'',stateFilter?`状态：${{enabled:'已启用',disabled:'已关闭',unknown:'未确认'}[stateFilter]}`:'',sourceFilter?`安装来源：${sourceFilter}`:'',originFilter?`来源类型：${originFilter}`:'',locationFilter?`位置：${locationFilter}`:'',usageFilter?'已筛选使用情况':'',independent?'可独立管理':''].filter(Boolean);
  const current=inventory.items.find(i=>key(i)===selected);
  const states=countStates(inventory.items,active);
  return <main className="app-shell">
    <header className="page-heading"><div><h1>技能管理器</h1><button className="scope-button" onClick={()=>setShowScope(!showScope)} disabled={busy||loading}>{inventory.scopeLabel||'本机个人环境'} ▾</button></div><div className="header-actions"><button className="secondary" onClick={()=>setAdding(!adding)}>添加</button><button className="secondary" onClick={()=>refresh()} disabled={loading||busy}><IconRefresh className={loading?'spin':''}/>{loading?'刷新中':'刷新'}</button></div></header>
    {showScope?<form className="scope-form" onSubmit={event=>{event.preventDefault();changeScope();}}><label>指定项目路径<input value={projectInput} onChange={e=>setProjectInput(e.target.value)} placeholder="留空查看个人环境"/></label><button className="secondary" disabled={busy||loading}>查看</button></form>:null}
    {adding?<section className="add-panel"><b>通过 Codex 原生页面添加</b><p>安装插件、连接应用或添加 MCP 后，回到这里刷新即可。新增说明会自动补齐。</p><button className="secondary" onClick={async()=>{try{await openHostLink('codex://skills');setAdding(false);}catch(e){setError(`无法直接打开，请使用 Codex 的插件入口。${e.message}`);}}}>打开插件目录</button></section>:null}
    <nav className="tabs" aria-label="扩展类型">{tabs.map(([kind,label,Icon])=><button key={kind} className={active===kind?'active':''} onClick={()=>changeKind(kind)}><Icon/>{label}<span>{inventory.counts?.[kind]||0}</span></button>)}</nav>
    <div className="state-summary" aria-label="启用状态统计"><span>共 {states.total} 项</span>{[['enabled','已启用',states.enabled],['disabled','已关闭',states.disabled],['unknown','状态未确认',states.unknown]].map(([value,label,count])=><button key={value} className={stateFilter===value?'active':''} aria-pressed={stateFilter===value} onClick={()=>setStateFilter(stateFilter===value?'':value)}>{label} <b>{count}</b></button>)}</div>
    <div className="toolbar"><label className="search"><IconSearch/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索名称、用途或完整路径" aria-label="搜索扩展"/></label><select aria-label="状态筛选" value={stateFilter} onChange={e=>setStateFilter(e.target.value)}><option value="">全部状态</option><option value="enabled">已启用</option><option value="disabled">已关闭</option><option value="unknown">未确认</option></select><select aria-label="来源筛选" value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}><option value="">全部安装来源</option>{[...new Set(inventory.items.filter(i=>i.kind===active).map(displaySource))].map(v=><option key={v}>{v}</option>)}</select><select aria-label="来源类型筛选" value={originFilter} onChange={e=>setOriginFilter(e.target.value)}><option value="">全部来源类型</option>{[...new Set(inventory.items.filter(i=>i.kind===active).map(originLabel))].map(value=><option key={value}>{value}</option>)}</select><select aria-label="位置筛选" value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">全部位置</option>{[...new Set([...inventory.items.filter(i=>i.kind===active).map(i=>i.locationType).filter(Boolean),'位置异常'])].map(v=><option key={v}>{v}</option>)}</select></div>
    {conditions.length?<div className="filter-summary" role="status"><span>已应用：{conditions.join("；")}</span><button className="secondary" onClick={resetFilters}>清除筛选</button></div>:null}
    <UsageControls usage={usage} problem={usageProblem} retry={retryUsage} days={usageDays} setDays={setUsageDays} filter={usageFilter} setFilter={setUsageFilter} sort={usageSort} setSort={setUsageSort} independent={independent} setIndependent={setIndependent}/>
    {error?<div className="error-banner" role="alert">{error}<button onClick={()=>refresh()} disabled={loading||busy}>重试读取</button></div>:null}
    {pendingChildren?<div className="notice" role="status">插件已启用，附带技能仍在等待确认。<button className="secondary" onClick={()=>confirmChildren(pendingChildren)}>重试确认技能</button></div>:null}
    {notice?<div className="notice" role="status">{notice}</div>:null}
    {inventory.stale?<div className="notice" role="status">正在显示上次读取的结果，等待本次确认。</div>:null}
    {!inventory.stale&&inventory.sourceStatus?.[active]?.state==='partial'?<div className="notice" role="status">本分类有未能确认的结果；已保留上次记录并标为“待确认”，其他分类已成功读取的内容正常更新。</div>:null}
    {inventory.warnings?.map((w,i)=><div className="notice" role="status" key={i}>{w}</div>)}
    {translation.running?<div className="quiet-status">正在补齐新增项目的说明，已有内容可以正常查看。</div>:translation.failed?<div className="quiet-status">部分说明暂未完成。<button onClick={()=>startTranslation(cwd,generation.current,true)}>重试未完成项</button></div>:null}
    <section className={`content ${current?'with-detail':''}`}><div className="list" aria-busy={loading}><div className="list-caption">当前显示 {visible.length} / {states.total} 项<span>安装来源 / 文件位置 / 当前状态</span></div>{!visible.length?<div className="empty">{states.total&&conditions.length?<><p>本分类共 {states.total} 项，当前筛选没有匹配内容。</p><button className="secondary" onClick={resetFilters}>显示全部内容</button></>:loading?'正在读取 Codex 的真实清单…':error?'清单尚未读取成功。':active==='command'?'当前范围内没有发现命令声明。内置命令请在 Codex 输入 / 查看。':'当前范围没有此类内容。'}</div>:null}{visible.map(item=>{const Icon=tabs.find(t=>t[0]===item.kind)[2],management=managementInfo(item),removalTarget=uninstallTarget(item,inventory.items);return <div className={`row ${selected===key(item)?'selected':''}`} key={key(item)}><button className="row-main" onClick={()=>setSelected(key(item))}><span className={`item-icon ${item.kind}`}><Icon/></span><span className="row-copy"><strong>{item.chineseName||item.name}</strong><span className="row-id">{item.name}</span><small>{item.chineseSummary||item.description||'原始资料未说明'}</small><span className="row-meta"><em>{item.kind==='skill'?'安装来源：':''}{displaySource(item)}</em><span className={item.positionError?'caution':''}>{item.locationType}{item.positionError?' · 异常':''}</span><span>{originLabel(item)}</span><span>{item.status}</span></span><UsageLine item={item} usage={usage}/>{management.reason?<span className="management-note">{management.reason}</span>:null}</span></button><div className="row-actions"><Toggle item={item} busy={busy} onToggle={toggle}/>{['plugin','skill'].includes(item.kind)||management.removalLabel?<button className="row-remove" aria-label={`${uninstallLabel(item,removalTarget)}${item.chineseName||item.name}`} title={!removalTarget?management.reason:removalTarget.id!==item.id?'将确认卸载所属插件及其附带内容':undefined} disabled={busy||!removalTarget} onClick={()=>requestRemove(removalTarget,item)}>{uninstallLabel(item,removalTarget)}</button>:management.parentId?<button className="row-manage" disabled={busy} onClick={()=>showParent(management.parentId)}>管理所属插件</button>:null}</div></div>;})}</div>{current?<Detail item={current} usage={usage} busy={busy} onClose={()=>setSelected(null)} onToggle={toggle} onAction={action} onCopy={copy} onParent={showParent} onRequestRemove={requestRemove} removalTarget={uninstallTarget(current,inventory.items)} removeRequest={removeRequest} onRemoveRequestHandled={()=>setRemoveRequest(null)} dependents={inventory.items.filter(item=>item.parentPlugin===current.id)}/>:null}</section>
    <footer><span>{inventory.statusNote||'从 Codex 读取安装事实和有效配置。'}</span>{inventory.generatedAt?<time>本次读取 {new Date(inventory.generatedAt).toLocaleString('zh-CN')}</time>:null}<details><summary>管理器版本</summary><code>{inventory.manager?.version||'尚未连接'}<br/>{inventory.manager?.build||''}<br/>{inventory.manager?.loadedFrom||''}</code></details></footer>
  </main>;
}
