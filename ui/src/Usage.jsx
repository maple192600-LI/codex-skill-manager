import {useEffect,useRef,useState} from 'react';
import {callBridgeTool} from './bridge.js';
import {usageKey} from '../../server/usage-data.mjs';

const date=value=>value?new Date(value).toLocaleDateString('zh-CN'):'未发现记录';
export function useUsage(days,revision,cwd) {
  const [usage,setUsage]=useState(null),[problem,setProblem]=useState('');
  const generation=useRef(0),timer=useRef(null);
  async function request(refresh=false,gen=++generation.current) {
    clearTimeout(timer.current);
    try {
      const result=await callBridgeTool('skill_manager_usage',{days,cwd:cwd||undefined,refresh});
      if(gen!==generation.current)return;
      if(!result.usage)throw new Error('使用统计暂未返回');
      setUsage(result.usage);setProblem('');
      if(result.usage.state==='running')timer.current=setTimeout(()=>request(false,gen),2500);
    } catch {if(gen===generation.current)setProblem('使用统计暂时不可用，扩展清单仍可正常使用。');}
  }
  useEffect(()=>{setUsage(null);if(revision)request();return()=>{generation.current++;clearTimeout(timer.current);};},[days,revision,cwd]);
  return {usage,problem,retry:()=>request(true)};
}
export function UsageControls({usage,problem,retry,days,setDays,filter,setFilter,sort,setSort,independent,setIndependent}) {
  const p=usage?.progress;
  return <section className="usage-panel" aria-label="使用统计">
    <div className="usage-controls">
      <b>使用情况</b>
      <select aria-label="统计时间范围" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></select>
      <select aria-label="使用情况筛选" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">全部使用情况</option><option value="used">有实际使用记录</option><option value="idle">统计期内未使用（记录完整）</option><option value="unknown">记录不足，暂不判断</option></select>
      <select aria-label="使用情况排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="">默认排序</option><option value="least">使用次数从少到多</option><option value="most">使用次数从多到少</option><option value="recent">最近使用优先</option><option value="oldest">最久未使用优先</option></select>
      <label className="usage-independent"><input type="checkbox" checked={independent} onChange={e=>setIndependent(e.target.checked)}/>可独立管理</label>
      <button className="usage-retry" disabled={usage?.state==='running'} onClick={retry}>更新统计</button>
    </div>
    <div className="usage-summary" role="status">{problem||usage?.error|| (usage?.state==='running'?`正在后台补算历史记录${p?.total?`：${p.indexed} / ${p.total}`:'…'}，清单可正常使用。`:usage?.available?`本机全部项目 · 期间有活动的聊天 ${usage.activeChats} 个 · ${date(usage.completedAt)} 更新`:'正在读取使用统计…')}</div>
    <details className="usage-explanation"><summary>统计依据与记录范围</summary><p>技能按实际使用记录计数：同一轮同一技能记一次；使用频率＝使用过该技能的天数 ÷ 使用 Codex 的活跃天数。项目技能只看对应项目。MCP 仍按真实工具调用统计，聊天占比单独显示。</p><p>技能只统计实际采用后提交的完整路径记录；准备使用、阅读说明和历史文字推断都不计入。没有使用技能的轮次提交空数组。历史工具调用继续统计。记录不完整时，已确认次数标“至少”，频率暂不计算；不能凭缺失记录认定从未使用。</p><p>{usage?.coverage?`已核查 ${usage.coverage.indexed} / ${usage.coverage.total} 份聊天记录，${usage.coverage.missing} 份没有可读明细。可读记录时间：${date(usage.coverage.from)} 至 ${date(usage.coverage.to)}。`:'记录范围尚未确认。'}仅补算最近 90 天。完整记录的观察期内没有使用时才显示“未使用”。</p><p>安装来源取自本机安装记录、安装锁文件或所属插件；未记录的来源不猜测。统计在本机完成，不上传聊天内容。</p></details>
  </section>;
}
export function UsageLine({item,usage}) {
  const v=usage?.items?.[usageKey(item)];
  if(!v||v.status==='unknown')return <span className="usage-line">{item.kind==='skill'?`${usage?.days||90} 天：使用记录不足，暂不计算频率`:'使用统计待确认'}{v?.lastUsedAt?` · 上次记录 ${date(v.lastUsedAt)}`:''}</span>;
  if(v.status==='unsupported')return null;
  if(item.kind==='skill')return <span className="usage-line"><span>{v.status==='observed'?`${usage.days} 天：${v.lowerBound?'至少 ':''}${v.uses} 次 · ${v.usedDays} 天 · ${v.dayRate===null?'频率待确认':`活跃日占比 ${(v.dayRate*100).toFixed(1)}%`}`:`${usage.days} 天：未使用（观察期记录完整）`}</span><span>{v.lastUsedAt?`最近 ${date(v.lastUsedAt)}`:''}</span></span>;
  return <span className="usage-line"><span>{v.status==='observed'?`${usage.days} 天：${v.lowerBound?'至少 ':''}${v.chats} 个聊天 · 使用率 ${v.rate===null?'待确认':`${(v.rate*100).toFixed(1)}%`}`:v.status==='read-only'?`${usage.days} 天：仅阅读过说明，实际使用未确认`:`${usage.days} 天：未发现使用记录`}</span><span>{v.lastUsedAt?`最近 ${date(v.lastUsedAt)}`:v.sourceLabel}</span></span>;
}
export function UsageDetail({item,usage}) {
  const v=usage?.items?.[usageKey(item)];
  if(item.kind==='skill')return <section className="usage-detail"><h3>使用情况 · 最近 {usage?.days||90} 天</h3><dl><div><dt>安装来源</dt><dd>{item.installationSource||'来源未记录'}</dd></div><div><dt>统计范围</dt><dd>{v?.scopeLabel||'尚未统计'}</dd></div>{v?.status==='observed'||v?.status==='no-record'?<><div><dt>实际使用次数</dt><dd>{v.lowerBound?'至少 ':''}{v.uses} 次 · {v.chats} 个聊天</dd></div><div><dt>使用天数 / 活跃天数</dt><dd>{v.usedDays} / {v.activeDays} 个已记录活跃日 · {v.dayRate===null?'记录不足，暂不计算频率':`${(v.dayRate*100).toFixed(1)}%`}</dd></div></>:null}<div><dt>最近使用</dt><dd>{date(v?.lastUsedAt)}</dd></div></dl>{v?.status==='unknown'?<p>现有历史不足以核实是否使用过，暂不提供零次数或零频率，也不据此归为闲置。</p>:<p>{v?.lowerBound?'实际使用记录尚不完整，以上次数是已确认的下限，暂不计算频率。':'以上来自观察期内的使用记录。'}仅阅读技能文件不计入。</p>}</section>;
  return <section className="usage-detail"><h3>使用情况 · 最近 {usage?.days||90} 天</h3>
    {!v||v.status==='unknown'?<p>统计尚未确认，不能据此判断是否闲置。</p>:v.status==='unsupported'?<p>此类项目暂不统计使用率。</p>:<><dl><div><dt>{item.kind==='skill'?'明确选用的聊天':'有使用记录的聊天'}</dt><dd>{v.chats} / {usage.activeChats} · {v.rate===null?'占比待确认':`${(v.rate*100).toFixed(1)}%`}</dd></div><div><dt>工具或插件脚本调用</dt><dd>{v.calls} 次 · 成功 {v.success} · 失败或取消 {v.failed}</dd></div><div><dt>最近明确使用</dt><dd>{date(v.lastUsedAt)}</dd></div>{item.kind==='skill'?<div><dt>仅阅读说明（不计入使用率）</dt><dd>{v.readChats} 个聊天 · 最近 {date(v.lastReadAt)}</dd></div>:null}<div><dt>记录依据</dt><dd>{v.evidence.join('、')||'期间未发现可明确归属的使用记录'}</dd></div><div><dt>来源说明</dt><dd>{v.sourceLabel}{item.parentPlugin?` · ${item.parentPlugin}`:''}。不能据此确认是谁安装的。</dd></div></dl><p>历史记录可能不完整；零记录不等于从未使用。仅阅读说明不能证明技能被用于完成任务。</p></>}
  </section>;
}
