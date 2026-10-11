'use strict';
// Exact finite support optimization for NativeGenetics.birth, conditional on
// independent uniform CRT draws. A witness proves support, not likely occurrence.
const AdvisorBest=(()=>{
 const cache=new Map();
 function solve(mother,father,goals,options={}){
  const o=NativeGenetics.options(options),p=NativeGenetics.parents(mother,father),policy=AdvisorQuality.prepare(goals);
  const key=JSON.stringify([NativeGenetics.version,p,policy.mask,o.chanceMother,o.chanceFather,o.cap]);if(cache.has(key))return cache.get(key);
  const selector=NativeGenetics.selectionLaw(p.weights),law=NativeGenetics.budgetLaw(p.B0,o),max=Math.max(...law.requested.map(r=>r.budget));
  // State: allocated sum and whether a stat is saturated (can waste attempts).
  let states=new Map([['0:0',{genetics:[],score:0,sum:0,saturated:false}]]);
  for(let i=0;i<7;i++){
   const next=new Map();for(const state of states.values())for(let v=0;v<=(selector.counts[i]?10:0)&&state.sum+v<=max;v++){
    const sum=state.sum+v,saturated=state.saturated||v===10,score=state.score+(policy.mask[i]==='MAX'?v:policy.mask[i]==='MIN'?10-v:0),id=sum+':'+Number(saturated);
    if(!next.has(id)||score>next.get(id).score)next.set(id,{genetics:[...state.genetics,v],score,sum,saturated});
   }states=next;
  }
  let best=null;
  for(const {budget,probability}of law.requested)for(const s of states.values()){
   // Complete allocations need sum=budget. Incomplete outputs need at least
   // one saturated stat: all remaining draws can hit it until attempt 300.
   if(s.sum>budget||(s.sum<budget&&!s.saturated))continue;
   const remaining=budget-s.sum;
   if(!best||s.score>best.score||(s.score===best.score&&remaining<best.remaining))best={...s,requested:budget,remaining,budgetProbability:probability};
  }
  if(!best)throw Error('No reachable native genotype');
  const draws=[];for(let i=0;i<7;i++)for(let v=0;v<best.genetics[i];v++)draws.push(selector.table.indexOf(i));
  if(best.remaining){const saturated=best.genetics.indexOf(10),k=selector.table.indexOf(saturated);while(draws.length<300)draws.push(k)}
  let at=0;const witness=NativeGenetics.birth(selector.table,best.requested,()=>{if(at>=draws.length)throw Error('Witness exhausted');return (draws[at++]+.5)/32768});
  if(JSON.stringify(witness.genetics)!==JSON.stringify(best.genetics)||witness.remaining!==best.remaining)throw Error('Unreachable optimum witness');
  const result=Object.freeze({genetics:Object.freeze(best.genetics),score:best.score,quality:policy.display(best.score),requested:best.requested,obtained:best.sum,remaining:best.remaining,attempts:witness.attempts,budgetProbability:best.budgetProbability,witness:Object.freeze(draws)});
  if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
 }
 return Object.freeze({solve});
})();
