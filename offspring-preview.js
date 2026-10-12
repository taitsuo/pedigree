'use strict';
// Small, selected-pair-only sample. It never supplies a ranking or mean score.
const OffspringPreview=(()=>{
 const cache=new Map(),samples=2000;let simulated=0;
 const encode=g=>g.reduce((s,v)=>s*11+v,0),decode=AdvisorBest.decode;
 function key(params){return PairScoring.context(params).key}
 function distribution(params){
  const p=PairScoring.context(params),id=p.key;
  if(cache.has(id))return cache.get(id);
  const job=(async()=>{
   await new Promise(r=>setTimeout(r,0));
   const rng=NativeGenetics.random(20261012),table=NativeGenetics.selectionLaw(params.weights).table,genotypes=new Uint32Array(samples),counts=Array.from({length:7},()=>Array(11).fill(0));
   let mass=0;const cdf=p.law.requested.map(r=>(mass+=r.probability));
   for(let n=0;n<samples;){for(const end=Math.min(samples,n+250);n<end;n++){
    const u=rng(),at=cdf.findIndex(v=>u<v),b=NativeGenetics.birth(table,p.law.requested[at<0?cdf.length-1:at].budget,rng);genotypes[n]=encode(b.genetics);b.genetics.forEach((v,i)=>counts[i][v]++);simulated++;
   }await new Promise(r=>setTimeout(r,0))}
   return {genotypes,counts,n:samples};
  })();
  if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(id,job);job.catch(()=>cache.delete(id));return job;
 }
 function wilson(k,n){const z=1.959963984540054,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return {k,n,p,low:Math.max(0,c-h),high:Math.min(1,c+h)}}
 function summarize(data,goals,average,parentBest){
  const policy=GeneticQuality.prepare(goals);let reach=0,beat=0;
  for(const code of data.genotypes){const q=policy.score(decode(code));reach+=Number(q>=average);beat+=Number(q>parentBest)}
  const quantile=(h,p)=>{let c=0;for(let i=0;i<11;i++){c+=h[i];if(c>=Math.ceil(p*data.n))return i}return 10};
  return {n:data.n,reachAverage:wilson(reach,data.n),beatParent:wilson(beat,data.n),stats:data.counts.map(h=>({low:quantile(h,.25),high:quantile(h,.75),low80:quantile(h,.1),high80:quantile(h,.9)}))};
 }
 return Object.freeze({key,distribution,summarize,metrics:()=>({simulated,entries:cache.size})});
})();
