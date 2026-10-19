import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {codexHome,stateDir,readJson,writeJson} from './state.mjs';
import {buildUsageReport} from './usage-data.mjs';
import {applySkillSources} from './skill-sources.mjs';

export function createUsageService({home=codexHome,cacheFile=path.join(stateDir,'usage-index-v2.json'),workerFactory=data=>new Worker(new URL('./usage-worker.mjs',import.meta.url),{workerData:data}),now=()=>Date.now()}={}) {
  const saved=readJson(cacheFile);let index=saved?.version===2&&saved.analysisRevision==='receipts-3'?saved:null,worker=null,progress=null,error='',startedAt=0;
  function start(force=false,items=[]) {
    if(worker||(!force&&now()-(index?.completedAt||0)<60_000))return;
    startedAt=now();error='';progress={indexed:0,total:null};
    try {
      worker=workerFactory({codexHome:home,previous:index,now:now(),skills:items.filter(i=>i.kind==='skill').map(({name,id,path,locations})=>({name,id,path,locations}))});
      worker.unref?.();
      const timeout=setTimeout(()=>{error='历史统计耗时较长，已停止本次补算；可重试，扩展清单正常可用。';worker?.terminate();},180_000);timeout.unref?.();
      worker.on('message',message=>{
        if(message.progress)progress=message.progress;
        if(message.error)error=message.error;
        if(message.index){index=message.index;progress=index.coverage;try{writeJson(cacheFile,index);}catch{error='统计已完成，但本地统计缓存暂未保存。';}}
      });
      worker.on('error',()=>{error='统计进程暂时不可用，扩展清单正常可用。';});
      worker.on('exit',code=>{clearTimeout(timeout);worker=null;if(code&&!error)error='统计补算未完成，已保留已有结果。';});
    } catch {worker=null;error='当前环境暂不支持历史统计，扩展清单正常可用。';}
  }
  return {
    get(items,{days=90,refresh=false}={}) {
      if(!worker&&(refresh||!startedAt||(!error&&now()-Math.max(index?.completedAt||0,startedAt)>=60_000)))start(refresh,items);
      return {...buildUsageReport(applySkillSources(items),index,{days,now:now()}),state:worker?'running':error?'error':index?'ready':'unknown',progress,error};
    },
    close(){return worker?.terminate();},
  };
}
