'use strict';
const AdvisorEngine=(()=>{
  const defaults=Object.freeze({initial:2000,validation:20000,refined:100000,chunk:500,minimum:.05,alpha:.05,seed:20261011,cap:60,cacheLimit:256});
  // Deterministic seed derivation; model-equivalent parents deliberately share streams.
  function seedOf(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
  let lastYield=0;
  async function pause(){
    const now=globalThis.performance?.now?.()??Date.now();
    if(now-lastYield<8)return;
    lastYield=now;
    await new Promise(resolve=>typeof setImmediate==='function'?setImmediate(resolve):setTimeout(resolve,0));
  }
  function create({model=NativeGenetics,quality=AdvisorQuality,statistics=AdvisorStatistics,config={}}={}){
    const cfg={...defaults,...config},cache=new Map();let token=0,simulated=0;
    function cancel(){token++}
    function input(pair,character){
      if(!Number.isFinite(character)||character<0)throw Error('Character mutation bonus unknown. Use Refresh in game.');
      for(const p of [pair.female,pair.male])if(!Number.isFinite(p.bonus)||p.bonus<0)throw Error('Individual mutation bonus unknown. Use Refresh in game.');
      const p=model.parents(pair.female.stats,pair.male.stats);
      return {...p,chanceMother:character+pair.female.bonus,chanceFather:character+pair.male.bonus};
    }
    function stream(params,policy,kind){
      const key=JSON.stringify([model.version,policy.id,policy.mask,policy.weights,params.weights,params.B0,params.chanceMother,params.chanceFather,cfg.cap,cfg.seed,kind]);
      if(!cache.has(key)){
        if(cache.size>=cfg.cacheLimit)cache.delete(cache.keys().next().value);
        const law=model.budgetLaw(params.B0,model.options({chanceMother:params.chanceMother,chanceFather:params.chanceFather,cap:cfg.cap}));
        let mass=0;const cdf=law.requested.map(r=>(mass+=r.probability));
        cache.set(key,{a:statistics.create(policy),rng:model.random(seedOf(key)),table:model.selectionLaw(params.weights).table,law,cdf});
      }
      return cache.get(key);
    }
    async function extend(s,n,mine){
      while(s.a.n<n){
        if(mine!==token)throw new DOMException('Obsolete predictions','AbortError');
        const end=Math.min(n,s.a.n+cfg.chunk);
        while(s.a.n<end){const u=s.rng(),i=s.cdf.findIndex(p=>u<p),B=s.law.requested[i<0?s.cdf.length-1:i].budget;statistics.add(s.a,model.birth(s.table,B,s.rng));simulated++}
        await pause();
      }
    }
    async function run(pairs,mask,character,{onProgress=()=>{}}={}){
      const mine=++token,policy=quality.prepare(mask),alpha=cfg.alpha/(2*Math.max(1,pairs.length));
      const rows=pairs.map(pair=>({pair,params:input(pair,character),parentBest:Math.max(policy.score(pair.female.stats),policy.score(pair.male.stats))}));
      // Everyone gets both stages: no parental-score prefilter can lose a jackpot.
      for(const r of rows){r.discovery=stream(r.params,policy,'discovery');await extend(r.discovery,cfg.initial,mine)}
      if(mine!==token)throw new DOMException('Obsolete predictions','AbortError');
      onProgress({phase:'initial',rows:rows.map(r=>({pair:r.pair,...statistics.summarize(r.discovery.a,r.parentBest,{...cfg,alpha})})),final:false});
      for(const r of rows){r.validation=stream(r.params,policy,'independent-validation');await extend(r.validation,cfg.validation,mine);r.result=statistics.summarize(r.validation.a,r.parentBest,{...cfg,alpha})}
      const bestTarget=Math.max(...rows.map(r=>r.result.targetRaw),0),bestMeanLow=Math.max(...rows.map(r=>r.result.meanLow),0);
      // Uniform upper bounds retain every plausible contender in either mode.
      const contenders=rows.filter(r=>r.result.optimisticRaw>=bestTarget||r.result.meanHigh>=bestMeanLow);
      for(const r of contenders){await extend(r.validation,cfg.refined,mine);r.result=statistics.summarize(r.validation.a,r.parentBest,{...cfg,alpha})}
      if(mine!==token)throw new DOMException('Obsolete predictions','AbortError');
      const result=rows.map(r=>({pair:r.pair,...r.result}));onProgress({phase:'complete',rows:result,final:true});return result;
    }
    async function predict(pair,mask,character,{pairCount=1}={}){
      const mine=++token,policy=quality.prepare(mask),params=input(pair,character),s=stream(params,policy,'independent-validation');
      await extend(s,cfg.refined,mine);
      if(mine!==token)throw new DOMException('Obsolete predictions','AbortError');
      return {pair,...statistics.summarize(s.a,Math.max(policy.score(pair.female.stats),policy.score(pair.male.stats)),{...cfg,alpha:cfg.alpha/(2*Math.max(1,pairCount))})};
    }
    return Object.freeze({run,predict,cancel,config:cfg,metrics:()=>({simulated,cacheEntries:cache.size,aggregateBytes:[...cache.values()].reduce((n,s)=>n+s.a.scores.byteLength+s.a.byScore.byteLength,0)}),input});
  }
  return Object.freeze({create,defaults,seedOf});
})();
