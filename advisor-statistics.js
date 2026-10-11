'use strict';
const AdvisorStatistics=(()=>{
 function wilson(k,n,z=1.959963984540054){if(!n)return {p:null,low:0,high:1,k,n};const p=k/n,z2=z*z,d=1+z2/n,c=(p+z2/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/d;return {p,low:Math.max(0,c-h),high:Math.min(1,c+h),k,n}}
 function create(policy){return {policy,n:0,scores:new Uint32Array(policy.maxRaw+1),counts:new Uint32Array(77),directions:policy.mask.map(g=>g==='MAX'?1:g==='MIN'?-1:0),offset:10*policy.mask.filter(g=>g==='MIN').length,incomplete:0,attempts:0}}
 // Only native birth outputs enter this accumulator. Score and marginals share
 // one pass; parent/input validation remains in the unchanged native model.
 function add(a,b){const g=b.genetics;let q=a.offset;for(let i=0;i<7;i++){q+=a.directions[i]*g[i];a.counts[i*11+g[i]]++}a.n++;a.scores[q]++;a.incomplete+=Number(b.remaining>0);a.attempts+=b.attempts}
 function tail(a,q){let k=0;for(let s=Math.max(0,Math.ceil(q));s<a.scores.length;s++)k+=a.scores[s];return k}
 function mean(a){let sum=0;for(let q=0;q<a.scores.length;q++)sum+=q*a.scores[q];return sum/a.n}
 function quantile(h,p){const n=h.reduce((s,v)=>s+v,0),rank=Math.ceil(p*n);let c=0;for(let i=0;i<h.length;i++){c+=h[i];if(c>=rank)return i}return h.length-1}
 function preview(a){return {n:a.n,meanQuality:a.policy.display(mean(a)),stats:Array.from({length:7},(_,i)=>{const h=Array.from(a.counts.slice(i*11,i*11+11)),n=a.n,low=quantile(h,.25),high=quantile(h,.75),low80=quantile(h,.1),high80=quantile(h,.9);return {mean:n?h.reduce((s,c,v)=>s+c*v,0)/n:null,low,high,low80,high80,coverage80:n?h.slice(low80,high80+1).reduce((s,c)=>s+c,0)/n:0,coverage:n?h.slice(low,high+1).reduce((s,c)=>s+c,0)/n:0,counts:h}})}}
 function summarize(a,parentBest,{alpha=.05}={}){
  const averageRaw=mean(a);let squares=0;for(let q=0;q<a.scores.length;q++)squares+=(q-averageRaw)**2*a.scores[q];
  // Empirical Bernstein, bounded IID samples (Maurer/Pontil form). Fixed-look
  // alpha is allocated across all pairs AND all stages by the engine.
  const variance=a.n>1?squares/(a.n-1):0,log=Math.log(2/alpha),radius=a.n>1?Math.sqrt(2*variance*log/a.n)+7*a.policy.maxRaw*log/(3*(a.n-1)):a.policy.maxRaw;
  return {n:a.n,averageRaw,average:a.policy.display(averageRaw),meanLow:Math.max(0,averageRaw-radius),meanHigh:Math.min(a.policy.maxRaw,averageRaw+radius),reachAverage:wilson(tail(a,averageRaw),a.n),beatParent:wilson(tail(a,parentBest+1),a.n),safe:preview(a),incomplete:a.incomplete};
 }
 function compare(a,b){return b.averageRaw-a.averageRaw}
 return Object.freeze({wilson,create,add,tail,mean,quantile,preview,summarize,compare});
})();
