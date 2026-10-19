import {applyInventoryResult} from '../shared/inventory-state.mjs';

// Retain confirmed target changes while accepting the rest of an in-flight scan.
export function createInventoryStore({build,read,save}) {
  const latest=new Map(),inflight=new Map();
  return {
    current(scope){return latest.get(scope)||read(scope);},
    scan(scope){
      if(inflight.has(scope))return inflight.get(scope).promise;
      const entry={changes:[]};
      entry.promise=Promise.resolve().then(()=>build({cwd:scope,previous:latest.get(scope)||read(scope)})).then(value=>{
        for(const change of entry.changes)value=applyInventoryResult(value,change);
        latest.set(scope,value);save(value);return value;
      }).finally(()=>{if(inflight.get(scope)===entry)inflight.delete(scope);});
      inflight.set(scope,entry);return entry.promise;
    },
    accept(result){
      const scope=result.cwd,current=latest.get(scope)||read(scope);
      if(!current)return null;
      inflight.get(scope)?.changes.push(result);
      const updated=applyInventoryResult(current,result);
      latest.set(scope,updated);save(updated);return updated;
    },
  };
}
