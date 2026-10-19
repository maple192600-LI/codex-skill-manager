export function countStates(items,kind) {
  const selected=items.filter(item=>item.kind===kind);
  return {total:selected.length,enabled:selected.filter(i=>i.enabled===true).length,disabled:selected.filter(i=>i.enabled===false).length,unknown:selected.filter(i=>typeof i.enabled!=='boolean').length};
}

export function applySkillStates(inventory,states,observedAt=new Date().toISOString()) {
  return applyItemStates(inventory,states.map(state=>({...state,kind:'skill'})),observedAt);
}

export function applyItemStates(inventory,states,observedAt=new Date().toISOString()) {
  const direct=new Map(states.map(state=>[`${state.kind}:${state.id}`,state]));
  const parents=new Map(states.filter(state=>state.kind==='plugin').map(state=>[state.id,state.enabled]));
  return {...inventory,items:inventory.items.map(item=>{
    const state=direct.get(`${item.kind}:${item.id}`);
    if(state){
      const parentEnabled=parents.has(item.parentPlugin)?parents.get(item.parentPlugin):state.parentEnabled??item.parentEnabled;
      const enabled=item.parentPlugin&&parentEnabled===false?false:state.enabled;
      return {...item,...state,enabled,...(item.parentPlugin?{parentEnabled}:{}),stale:false,status:item.parentPlugin&&parentEnabled===false?'随插件关闭':state.status||(enabled?'已启用 · 运行未确认':'已关闭'),actions:{...item.actions,...(item.kind==='skill'?{toggle:typeof enabled==='boolean'&&(!item.parentPlugin||parentEnabled===true)}:{})},observedAt,lastConfirmedAt:observedAt};
    }
    if(item.parentPlugin&&parents.has(item.parentPlugin)) {
      const enabled=parents.get(item.parentPlugin)===false?false:null;
      return {...item,parentEnabled:parents.get(item.parentPlugin),enabled,callable:enabled===false?false:null,actions:{...item.actions,toggle:false},status:enabled===false?'随插件关闭':'所属插件已启用 · 具体状态待刷新确认',observedAt,lastConfirmedAt:observedAt};
    }
    return item;
  })};
}

export function applyInventoryResult(inventory,result) {
  let current=inventory;
  if(result.itemStates)current=applyItemStates(current,result.itemStates);
  if(result.skillStates)current=applySkillStates(current,result.skillStates);
  const removed=new Set((result.removedKeys||[]).map(item=>`${item.kind}:${item.id}`));
  const pluginId=result.removedPluginId;
  if(pluginId||removed.size||result.remainingSkill){
    const items=current.items.filter(item=>!removed.has(`${item.kind}:${item.id}`)&&!(pluginId&&(item.kind==='plugin'&&item.id===pluginId||item.parentPlugin===pluginId&&item.kind!=='app'))).map(item=>{
      if(pluginId&&item.parentPlugin===pluginId&&item.kind==='app')return {...item,parentPlugin:null,source:'Codex 应用目录',enabled:null,stale:true,actions:{toggle:false,remove:false,entries:[]},status:'插件已移除 · 独立应用连接保留，状态待确认'};
      return result.remainingSkill?.id===item.id&&item.kind==='skill'?{...item,...result.remainingSkill}:item;
    });
    current={...current,items,counts:Object.fromEntries(['plugin','app','mcp','skill','command'].map(kind=>[kind,items.filter(item=>item.kind===kind).length]))};
  }
  return current;
}
