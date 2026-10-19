export function managementInfo(item) {
  if(item.stale)return {reason:'本次状态尚未确认，请刷新后再管理。'};
  if(item.id==='skill-manager@personal')return {reason:'管理器自身请在 Codex 原生插件页卸载。'};
  if(item.parentPlugin)return {parentId:item.parentPlugin,reason:item.kind==='skill'?(item.parentEnabled===false?'所属插件已关闭；先启用插件后才能单独开关此技能。':item.parentEnabled!==true?'所属插件状态待确认，刷新后再管理此技能。':'随插件安装，可单独开关；卸载需管理整个插件。'):'随所属插件安装，请通过插件管理。'};
  if(item.kind==='plugin')return item.actions?.remove?{removalLabel:'卸载插件'}:{reason:item.managed?'Codex 默认提供；当前未开放独立卸载，可通过开关管理。':'当前没有可用的卸载方式。'};
  if(item.kind==='skill') {
    if(item.scope==='system')return {reason:'Codex 自带技能，可通过开关管理，不直接删除系统文件。'};
    return item.actions?.entries?.length?{removalLabel:'卸载技能'}:{reason:'安装位置未确认为可独立移除的技能目录，暂不提供直接卸载。'};
  }
  if(item.kind==='mcp')return item.actions?.remove?{removalLabel:'移除配置'}:{reason:'当前没有可独立移除的配置；由配置来源管理。'};
  if(item.kind==='app')return {reason:'应用连接请在 Codex 原生应用设置中移除。'};
  return {};
}

export function uninstallTarget(item,items) {
  if(item.stale)return null;
  if(managementInfo(item).removalLabel)return item;
  if(item.kind==='skill'&&item.parentPlugin) {
    const parent=items.find(candidate=>candidate.kind==='plugin'&&candidate.id===item.parentPlugin);
    if(parent&&managementInfo(parent).removalLabel)return parent;
  }
  return null;
}

export function uninstallLabel(item,target) {
  if(item.kind==='skill'&&item.parentPlugin)return '卸载所属插件';
  return ['plugin','skill'].includes(item.kind)?'卸载':managementInfo(target||item).removalLabel;
}

export function originLabel(item) {
  if(item.parentPlugin)return '随插件提供';
  if(item.kind==='skill')return item.scope==='system'?'Codex 自带':item.scope==='repo'?'项目提供':'个人技能';
  if(item.kind==='plugin')return item.managed?'默认提供插件':'独立插件';
  if(item.kind==='command')return item.id.startsWith('builtin:')?'Codex 内置命令':'命令声明';
  if(item.kind==='app')return '已连接应用';
  return '个人或项目配置';
}
