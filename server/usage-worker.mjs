import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {compactEvent,DAY} from './usage-data.mjs';

// Runs off the MCP event loop. Source databases are always opened read-only.
const opened=[];
function open(name){const db=new DatabaseSync(path.join(workerData.codexHome,name),{readOnly:true,timeout:1000});db.exec('PRAGMA query_only=ON');opened.push(db);return db;}
try {
  const now=workerData.now||Date.now(),cutoff=now-90*DAY;
  const state=open('state_5.sqlite'),history=open('thread_history_1.sqlite');
  const hasCwd=state.prepare('PRAGMA table_info(threads)').all().some(c=>c.name==='cwd');
  const rows=state.prepare(`SELECT id,source,updated_at,${hasCwd?'cwd':"'' AS cwd"} FROM threads`).all();
  const meta=new Map(rows.map(r=>[r.id,r]));
  const parents=new Map(state.prepare('SELECT child_thread_id,parent_thread_id FROM thread_spawn_edges').all().map(r=>[r.child_thread_id,r.parent_thread_id]));
  function rootFor(id,seen=new Set()) {
    if(seen.has(id)||seen.size>30)return null;seen.add(id);
    const row=meta.get(id);if(!row)return null;
    let source;try{source=JSON.parse(row.source);}catch{/* plain host source */}
    const spawned=source?.subagent?.thread_spawn?.parent_thread_id;
    if(source?.subagent&&!spawned)return null;
    if(spawned||parents.has(id))return rootFor(spawned||parents.get(id),seen);
    return ['cli','vscode','unknown'].includes(row.source)?id:null;
  }
  const eligible=rows.filter(r=>r.updated_at*1000>=cutoff&&rootFor(r.id));
  const needed=new Set(eligible.flatMap(r=>[r.id,rootFor(r.id)]));
  const targets=[...needed].map(id=>meta.get(id)).filter(Boolean).sort((a,b)=>b.updated_at-a.updated_at);
  const skills=workerData.skills||[];
  const skillsKey=JSON.stringify(skills.map(s=>[s.name,s.path||s.id]).sort());
  const index={version:2,analysisRevision:'receipts-3',skillsKey,threads:{},coverage:{from:null,to:null,total:targets.length,indexed:0,missing:0,excluded:rows.length-eligible.length}};
  const hasTurn=history.prepare('PRAGMA table_info(thread_items)').all().some(c=>c.name==='turn_id');
  const query=history.prepare(`SELECT item_id,${hasTurn?'turn_id':"'' AS turn_id"},updated_at_ordinal,COALESCE(started_at_ms,created_at_ms) AS at,item_type,
    CASE WHEN item_type='mcpToolCall' THEN json_extract(item_json,'$.server') END AS server,
    CASE WHEN item_type='mcpToolCall' THEN json_extract(item_json,'$.tool') END AS tool,
    CASE WHEN item_type IN ('mcpToolCall','commandExecution') THEN json_extract(item_json,'$.pluginId') END AS pluginId,
    CASE WHEN item_type='commandExecution' THEN json_extract(item_json,'$.scriptPath') END AS scriptPath,
    CASE WHEN item_type='mcpToolCall' THEN json_extract(item_json,'$.appContext.connectorId') END AS appId,
    CASE WHEN item_type IN ('mcpToolCall','commandExecution') THEN json_extract(item_json,'$.status') END AS status,
    CASE WHEN item_type='userMessage' THEN json_extract(item_json,'$.content') END AS content,
    CASE WHEN item_type='commandExecution' THEN json_extract(item_json,'$.command') END AS command,
    CASE WHEN item_type='commandExecution' THEN json_extract(item_json,'$.commandActions') END AS commandActions
    ,CASE WHEN item_type='mcpToolCall' AND json_extract(item_json,'$.server')='skill_manager' AND json_extract(item_json,'$.tool')='skill_manager_record_usage' THEN json_extract(item_json,'$.arguments.skillPaths') END AS receiptPaths
    FROM thread_items WHERE thread_id=? AND updated_at_ordinal>=? AND (updated_at_ordinal>? OR item_id>?) ORDER BY updated_at_ordinal,item_id LIMIT 256`);
  const activity=history.prepare('SELECT COUNT(*) AS count,MIN(COALESCE(started_at_ms,created_at_ms)) AS first,MAX(COALESCE(started_at_ms,created_at_ms)) AS last FROM thread_items WHERE thread_id=?');
  const user=history.prepare("SELECT 1 AS yes FROM thread_items WHERE thread_id=? AND item_type='userMessage' LIMIT 1");
  for(const row of targets) {
    const previous=workerData.previous?.skillsKey===skillsKey?workerData.previous?.threads?.[row.id]:null;
    const thread=previous?structuredClone(previous):{events:{},cursor:-1,cursorId:''};
    thread.root=rootFor(row.id);thread.cwd=row.cwd||'';
    if(!previous||previous.sourceUpdated!==row.updated_at||now-(previous.checkedAt||0)>60_000) {
      const bounds=activity.get(row.id);thread.activityAt=bounds.last||0;thread.firstAt=bounds.first||null;thread.hasUser=Boolean(user.get(row.id));thread.missing=bounds.count===0;
      while(true) {
        const page=query.all(row.id,thread.cursor,thread.cursor,thread.cursorId);
        for(const event of page) {
          thread.cursor=event.updated_at_ordinal;thread.cursorId=event.item_id;
          event.skills=event.content?JSON.parse(event.content).filter(x=>x.type==='skill'):[];
          event.commandActions=event.commandActions?JSON.parse(event.commandActions):[];
          let compact=compactEvent(event);
          if(event.receiptPaths&&event.status==='completed')compact={type:'receipt',at:event.at,paths:JSON.parse(event.receiptPaths)};
          if(compact)compact.turnId=event.turn_id;
          if(compact&&compact.at>=cutoff)thread.events[event.item_id]=compact;
          else delete thread.events[event.item_id];
        }
        if(page.length<256)break;
      }
      thread.checkedAt=now;thread.sourceUpdated=row.updated_at;
    }
    for(const [id,event] of Object.entries(thread.events))if(event.at<cutoff)delete thread.events[id];
    delete thread.adoptions;
    index.threads[row.id]=thread;index.coverage.indexed++;
    if(thread.missing)index.coverage.missing++;
    if(thread.firstAt)index.coverage.from=Math.min(index.coverage.from||now,thread.firstAt);
    index.coverage.to=Math.max(index.coverage.to||0,thread.activityAt);
    if(index.coverage.indexed%20===0)parentPort.postMessage({progress:index.coverage});
  }
  index.completedAt=Date.now();
  parentPort.postMessage({index});
} catch(error) {
  // Never send database contents or full paths to the UI on failure.
  parentPort.postMessage({error:error.code==='SQLITE_BUSY'?'历史记录正忙，请稍后重试。':'暂时无法读取本机历史记录；保留已有统计和扩展清单。'});
} finally {for(const db of opened)db.close();}
