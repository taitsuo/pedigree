'use strict';
// Budget-first conditional score percentile. Reported probability is a tail,
// never the probability of the displayed exact seven-stat genotype.
const AdvisorBest=(()=>{
 const cache=new Map(),threshold=.01,initialN=2000,maximumN=8000;
 const encode=g=>g.reduce((id,v)=>id*11+v,0);
 const decode=id=>{const g=Array(7);for(let i=6;i>=0;i--){g[i]=id%11;id=Math.floor(id/11)}return g};
 function options(input){const o=NativeGenetics.options(input);o.cap=Math.min(60,o.cap);return o}
 function interval(k,n){const z=1.645,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return {low:Math.max(0,c-h),high:Math.min(1,c+h)}}
 function choose(data,goals,start=0,end=data.n){
  if(!data.budget||end<=start)return null;
  const policy=AdvisorQuality.prepare(goals),n=end-start,target=threshold/data.budget.probability;
  // Small one-sided normal margin + continuity allowance. This is an empirical
  // percentile with sampling uncertainty, not a proof of a true >=1% game tail.
  const required=Math.min(n,Math.ceil(n*target+1.645*Math.sqrt(n*target*(1-target))+2));
  const counts=new Uint32Array(policy.maxRaw+1),representatives=Array(policy.maxRaw+1).fill(Infinity);
  for(let at=start;at<end;at++){
   const g=decode(data.genotypes[at]);let score=0,sum=0;
   for(let i=0;i<7;i++){sum+=g[i];score+=policy.mask[i]==='MAX'?g[i]:policy.mask[i]==='MIN'?10-g[i]:0}
   counts[score]++;
   if(sum===data.budget.budget)representatives[score]=Math.min(representatives[score],data.genotypes[at]);
  }
  let k=0;for(let score=policy.maxRaw;score>=0;score--){
   k+=counts[score];if(k<required||!Number.isFinite(representatives[score]))continue;
   const conditional=k/n,ci=interval(k,n),probability=data.budget.probability;
   return {genetics:decode(representatives[score]),score,quality:policy.display(score),budget:data.budget.budget,budgetProbability:probability,targetFraction:target,conditional,p:probability*conditional,low:probability*ci.low,high:probability*ci.high,k,n,required};
  }
  return null;
 }
 function key(mother,father,input={}){const o=options(input),p=NativeGenetics.parents(mother,father);return JSON.stringify([NativeGenetics.version,p,o.chanceMother,o.chanceFather,o.cap,o.seed])}
 function distribution(mother,father,input={},goals=Array(7).fill('MAX')){
  const id=key(mother,father,input);if(cache.has(id))return cache.get(id);
  AdvisorQuality.prepare(goals);
  const job=(async()=>{
   const started=performance.now(),o=options(input),p=NativeGenetics.parents(mother,father),selector=NativeGenetics.selectionLaw(p.weights),law=NativeGenetics.budgetLaw(p.B0,o);
   const capacity=10*selector.counts.filter(v=>v>0).length;
   const budget=[...law.requested].sort((a,b)=>b.budget-a.budget).find(r=>r.probability>=threshold&&r.budget<=capacity)||null;
   const data={budget,B0:p.B0,n:0,genotypes:new Uint32Array(maximumN),simulated:0,complete:0,stable:false};
   if(budget){
    // Constructively verify support of a complete allocation with native birth.
    const draws=[];let remaining=budget.budget;for(let i=0;i<7&&remaining;i++){if(!selector.counts[i])continue;for(let j=0;j<10&&remaining;j++,remaining--)draws.push(selector.table.indexOf(i))}
    let at=0;const witness=NativeGenetics.birth(selector.table,budget.budget,()=>((draws[at++])+.5)/32768);
    if(witness.remaining||witness.obtained!==budget.budget)throw Error('Chosen budget is not reachable');
    const rng=NativeGenetics.random(o.seed^0x463c0d17),pause=()=>new Promise(resolve=>typeof setImmediate==='function'?setImmediate(resolve):setTimeout(resolve,0));
    let target=initialN;
    while(data.n<target){
     for(let j=0;j<500;j++){const b=NativeGenetics.birth(selector.table,budget.budget,rng);data.genotypes[data.n++]=encode(b.genetics);if(!b.remaining)data.complete++}
     await pause();
     if(data.n===target){
      const a=choose(data,goals,0,data.n/2),b=choose(data,goals,data.n/2,data.n),all=choose(data,goals);
      data.stable=Boolean(a&&b&&all&&a.score===b.score&&a.score===all.score);
      if(!data.stable&&target<maximumN)target*=2;
     }
    }
   }
   data.genotypes=data.genotypes.slice(0,data.n);data.simulated=data.n;data.milliseconds=performance.now()-started;return data;
  })();
  if(cache.size>=3)cache.delete(cache.keys().next().value);cache.set(id,job);job.catch(()=>cache.delete(id));return job;
 }
 async function solve(mother,father,goals,input={}){return choose(await distribution(mother,father,input,goals),goals)}
 return Object.freeze({solve,distribution,choose,key,interval,encode,decode});
})();
