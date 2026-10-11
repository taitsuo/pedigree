'use strict';
const AdvisorStatistics=(()=>{
  function wilson(k,n,z=1.959963984540054){
    if(!n)return {p:null,low:0,high:1,k,n};
    const p=k/n,z2=z*z,d=1+z2/n,c=(p+z2/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/d;
    return {p,low:Math.max(0,c-h),high:Math.min(1,c+h),k,n};
  }
  // Simultaneous CDF band; unlike pointwise Wilson this supports selecting a tail.
  function dkw(n,alpha=.05){return n?Math.min(1,Math.sqrt(Math.log(2/alpha)/(2*n))):1}
  function create(policy){return {policy,n:0,scores:new Uint32Array(policy.maxRaw+1),byScore:new Uint32Array((policy.maxRaw+1)*77),incomplete:0,attempts:0}}
  function add(a,b){
    const g=b.genetics,q=a.policy.score(g);a.n++;a.scores[q]++;a.incomplete+=Number(b.remaining>0);a.attempts+=b.attempts;
    for(let i=0;i<7;i++)a.byScore[q*77+i*11+g[i]]++;
  }
  function tail(a,q){let k=0;for(let s=Math.max(0,Math.ceil(q));s<a.scores.length;s++)k+=a.scores[s];return k}
  function mean(a){let sum=0;for(let q=0;q<a.scores.length;q++)sum+=q*a.scores[q];return sum/a.n}
  function quantile(h,p){const n=h.reduce((s,v)=>s+v,0),rank=Math.ceil(p*n);let c=0;for(let i=0;i<h.length;i++){c+=h[i];if(c>=rank)return i}return h.length-1}
  function preview(a,threshold=0){
    const n=tail(a,threshold),counts=Array.from({length:7},()=>Array(11).fill(0));let sumQ=0;
    for(let q=threshold;q<a.scores.length;q++){sumQ+=q*a.scores[q];for(let i=0;i<7;i++)for(let v=0;v<11;v++)counts[i][v]+=a.byScore[q*77+i*11+v]}
    return {n,meanQuality:n?a.policy.display(sumQ/n):null,stats:counts.map(h=>{
      const low=quantile(h,.1),high=quantile(h,.9);
      return {mean:n?h.reduce((s,c,v)=>s+c*v,0)/n:null,low,high,coverage:n?h.slice(low,high+1).reduce((s,c)=>s+c,0)/n:0,counts:h};
    })};
  }
  function summarize(a,parentBest,{minimum=.05,alpha=.05}={}){
    const averageRaw=mean(a),epsilon=dkw(a.n,alpha);let target=0,optimistic=0;
    for(let q=0;q<a.scores.length;q++){
      const p=tail(a,q)/a.n;
      if(p-epsilon>=minimum)target=q;
      if(p+epsilon>=minimum)optimistic=q;
    }
    return {n:a.n,averageRaw,average:a.policy.display(averageRaw),targetRaw:target,target:a.policy.display(target),optimisticRaw:optimistic,
      uncertain:optimistic>target,epsilon,meanLow:Math.max(0,averageRaw-a.policy.maxRaw*epsilon),meanHigh:Math.min(a.policy.maxRaw,averageRaw+a.policy.maxRaw*epsilon),
      reachAverage:wilson(tail(a,averageRaw),a.n),reachTarget:wilson(tail(a,target),a.n),beatParent:wilson(tail(a,parentBest+1),a.n),
      safe:preview(a),gamble:preview(a,target),incomplete:a.incomplete};
  }
  function compare(a,b,mode){return mode==='gamble'?b.targetRaw-a.targetRaw||b.reachTarget.p-a.reachTarget.p||b.averageRaw-a.averageRaw:b.averageRaw-a.averageRaw}
  return Object.freeze({wilson,dkw,create,add,tail,mean,quantile,preview,summarize,compare});
})();
