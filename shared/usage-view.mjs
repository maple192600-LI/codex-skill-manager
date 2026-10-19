export function matchesUsage(value,filter) {
  if(!filter)return true;
  if(filter==='used')return value?.status==='observed';
  if(filter==='idle')return value?.status==='no-record'&&value.complete===true;
  return !value||value.status==='unknown';
}
export function compareUsage(a,b,sort) {
  // Missing observations stay at the end in every order.
  const known=v=>Boolean(v&&!['unknown','unsupported'].includes(v.status));
  if(known(a)!==known(b))return known(a)?-1:1;
  if(sort==='least')return (a?.uses||a?.calls||0)-(b?.uses||b?.calls||0);
  if(sort==='most')return (b?.uses||b?.calls||0)-(a?.uses||a?.calls||0);
  if(sort==='recent')return (b?.lastUsedAt||0)-(a?.lastUsedAt||0);
  if(sort==='oldest')return (a?.lastUsedAt||0)-(b?.lastUsedAt||0);
  return 0;
}
