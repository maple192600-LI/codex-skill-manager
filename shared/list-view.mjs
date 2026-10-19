import {matchesUsage,compareUsage} from './usage-view.mjs';
import {independentlyManaged} from '../server/usage-data.mjs';
import {originLabel} from './management.mjs';

export const displaySource=item=>item.kind==='skill'?(item.installationSource||'来源未记录'):item.source;
export function filterItems(items,{kind,query='',source='',origin='',location='',state='',usageFilter='',sort='',independent=false},usage) {
  const search=query.trim().toLowerCase();
  return items.filter(item=>item.kind===kind&&(!search||JSON.stringify([item.name,item.chineseName,item.chineseSummary,item.description,item.source,item.installationSource,item.locations?.map(value=>[value.path,value.realPath])]).toLowerCase().includes(search))&&(!source||displaySource(item)===source)&&(!origin||originLabel(item)===origin)&&(!location||(location==='位置异常'?item.positionError:item.locationType===location))&&(!state||(state==='enabled'?item.enabled===true:state==='disabled'?item.enabled===false:typeof item.enabled!=='boolean'))&&matchesUsage(usage?.items?.[`${item.kind}:${item.id}`],usageFilter)&&(!independent||independentlyManaged(item))).sort((a,b)=>sort?compareUsage(usage?.items?.[`${a.kind}:${a.id}`],usage?.items?.[`${b.kind}:${b.id}`],sort):0);
}
