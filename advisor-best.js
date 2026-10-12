'use strict';
// Exact seven-stat frequencies under the existing native simulation model.
// Discovery and validation use independent streams; goals never change draws.
const AdvisorBest=(()=>{
 const cache=new Map(),threshold=.01,discoveryN=20000,initialN=100000,maximumN=200000;
 const encode=g=>g.reduce((id,v)=>id*11+v,0);
 const decode=id=>{const g=Array(7);for(let i=6;i>=0;i--){g[i]=id%11;id=Math.floor(id/11)}return g};
 function interval(k,n){
  // z=4.3: Bonferroni allowance for <=200 discovered candidates and two looks.
  // Approximate simultaneous >99% coverage (Wilson, not exact binomial bounds).
  const z=4.3,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return {p,low:Math.max(0,c-h),high:Math.min(1,c+h)};
 }
 function choose(data,goals){
  const policy=AdvisorQuality.prepare(goals);let best=null;
  for(const row of data.candidates){
   const ci=interval(row.k,data.n);if(ci.low<=threshold)continue;
   const genetics=decode(row.id),score=policy.score(genetics);
   if(!best||score>best.score||score===best.score&&(row.k>best.k||row.k===best.k&&row.id<best.id))best={...row,...ci,genetics,score,quality:policy.display(score),n:data.n};
  }
  return best;
 }
 function key(mother,father,input={}){const o=NativeGenetics.options(input),p=NativeGenetics.parents(mother,father);return JSON.stringify([NativeGenetics.version,p,o.chanceMother,o.chanceFather,o.cap,o.seed])}
 function distribution(mother,father,input={}){
  const id=key(mother,father,input);if(cache.has(id))return cache.get(id);
  const job=(async()=>{
   const started=performance.now(),o=NativeGenetics.options(input),p=NativeGenetics.parents(mother,father);
   const selector=NativeGenetics.selectionLaw(p.weights),law=NativeGenetics.budgetLaw(p.B0,o),cdf=[];let sum=0;for(const row of law.requested)cdf.push(sum+=row.probability);
   const pause=()=>new Promise(resolve=>typeof setImmediate==='function'?setImmediate(resolve):setTimeout(resolve,0));
   const draw=rng=>{const u=rng();let i=cdf.findIndex(v=>u<v);if(i<0)i=cdf.length-1;return encode(NativeGenetics.birth(selector.table,law.requested[i].budget,rng).genetics)};
   const discovery=new Map(),rng=NativeGenetics.random(o.seed^0x462d15c0);
   for(let at=0;at<discoveryN;at+=2000){for(let j=0;j<2000;j++){const g=draw(rng);discovery.set(g,(discovery.get(g)||0)+1)}await pause()}
   // A >=0.5% discovery screen includes p>1% with overwhelming probability,
   // but cannot establish exhaustive mathematical optimality near the cutoff.
   const candidates=[...discovery].filter(([,k])=>k>=discoveryN*.005).map(([id])=>({id,k:0}));
   const counts=new Map(candidates.map(r=>[r.id,r])),validation=NativeGenetics.random(o.seed^0x462a11da);
   let n=0,target=candidates.length?initialN:0;
   while(n<target){for(let j=0;j<2000;j++){const row=counts.get(draw(validation));if(row)row.k++}n+=2000;await pause();
    if(n===initialN&&candidates.some(r=>{const ci=interval(r.k,n);return ci.low<=threshold&&ci.high>threshold}))target=maximumN;
   }
   return {candidates,n,discoveryN,simulated:discoveryN+n,milliseconds:performance.now()-started,ambiguous:candidates.filter(r=>{const ci=interval(r.k,n);return ci.low<=threshold&&ci.high>threshold}).length};
  })();
  if(cache.size>=3)cache.delete(cache.keys().next().value);cache.set(id,job);job.catch(()=>cache.delete(id));return job;
 }
 async function solve(mother,father,goals,input={}){return choose(await distribution(mother,father,input),goals)}
 return Object.freeze({solve,distribution,choose,key,interval,encode,decode});
})();
