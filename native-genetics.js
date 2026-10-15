'use strict';
// Reconstruction §5, native genetics reference v2.2 (2026-10-10).
// Exact selector transformation conditional on uniform k; independent calls are
// a simulation assumption, not a reconstruction of the game's future CRT state.
const NativeGenetics=(()=>{
  const f32=Math.fround, cache=new Map(), simulations=new Map();
  const bytes=new ArrayBuffer(4),bits=new DataView(bytes);bits.setUint32(0,0x38000100,true);
  const C=bits.getFloat32(0,true),size=32768;
  function randRange(a,b,k){
    const n=b-a+1;if(n<=0)return a;
    const y=f32(f32(f32(k)*C)*f32(n));
    const r=y>=2147483648||y< -2147483648?-2147483648:Math.trunc(y);
    return a+Math.min(r,b-a);
  }
  function select(weights,k){
    let seed=randRange(0,2147483646,k)>>>0,S=0,candidate=0;
    for(let i=0;i<7;i++){
      const total=f32(S+weights[i]),N=Math.trunc(total)+1;
      let R=0;
      if(N>0){seed=(Math.imul(seed,0x0BB38435)+0x3619636B)>>>0;const U=f32((seed>>>9)/8388608);R=Math.trunc(f32(U*f32(N)))}
      if(f32(R)>=f32(S))candidate=i;S=Math.trunc(total);
    }
    return candidate;
  }
  // Exact native acceptance masks, reconstructed from all 32768 CRT values.
  // U and masks are lazy/bounded; the simulation table is built only on access.
  let uniform=null;const acceptance=new Map(),maskLimit=2048;
  function initUniform(){
    if(uniform)return;
    uniform=Array.from({length:7},()=>new Float32Array(size));
    for(let k=0;k<size;k++){let seed=randRange(0,2147483646,k)>>>0;
      for(let i=0;i<7;i++){seed=(Math.imul(seed,0x0BB38435)+0x3619636B)>>>0;uniform[i][k]=f32((seed>>>9)/8388608)}
    }
  }
  function pop(x){x-=x>>>1&0x55555555;x=(x&0x33333333)+(x>>>2&0x33333333);return ((x+(x>>>4)&0x0f0f0f0f)*0x01010101)>>>24}
  function maskedCounts(w){
    initUniform();const prefix=[];let S=0;for(let i=0;i<7;i++){prefix[i]=S;S+=w[i]}
    const remaining=new Uint32Array(size/32),counts=Array(7).fill(0);remaining.fill(0xffffffff);
    for(let i=6;i>=0;i--){
      if(!prefix[i]){for(const x of remaining)counts[i]+=pop(x);break;}
      const key=i+','+prefix[i]+','+w[i];let mask=acceptance.get(key);
      if(!mask){mask=new Uint32Array(size/32);const N=prefix[i]+w[i]+1;
        for(let k=0;k<size;k++)if(f32(uniform[i][k]*f32(N))>=f32(prefix[i]))mask[k>>>5]|=1<<(k&31);
        if(acceptance.size>=maskLimit)acceptance.delete(acceptance.keys().next().value);acceptance.set(key,mask);
      }
      for(let k=0;k<remaining.length;k++){counts[i]+=pop(mask[k]&remaining[k]);remaining[k]&=~mask[k]}
    }
    return counts;
  }
  function selectionLaw(weights){
    const key=weights.join(',');if(cache.has(key))return cache.get(key).result;
    const w=Array.from(weights),entry={result:null,table:null};let counts;
    if(w.length===7&&w.every(v=>Number.isInteger(v)&&v>=0)&&w.reduce((a,b)=>a+b,0)<=140)counts=maskedCounts(w);
    else{counts=Array(7).fill(0);entry.table=new Uint8Array(size);for(let k=0;k<size;k++){const id=select(w,k);entry.table[k]=id;counts[id]++}}
    entry.result={counts,probabilities:counts.map(n=>n/size)};
    Object.defineProperty(entry.result,'table',{enumerable:true,get(){
      if(!entry.table){entry.table=new Uint8Array(size);for(let k=0;k<size;k++)entry.table[k]=select(w,k)}return entry.table;
    }});
    if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,entry);return entry.result;
  }
  function cacheInfo(){let tables=0;for(const entry of cache.values())if(entry.table)tables++;
    return {weights:cache.size,tables,tableBytes:tables*size,uniformBytes:uniform?7*size*4:0,acceptanceMasks:acceptance.size,acceptanceBytes:acceptance.size*(size/8),maskLimit};
  }
  function options(input={}){
    const o={chanceMother:0,chanceFather:0,cap:60,seed:20261010,samples:20000,...input};
    for(const k of ['chanceMother','chanceFather'])if(!Number.isFinite(o[k])||o[k]<0)throw Error('Chances effectives : nombres positifs ou nuls requis.');
    if(!Number.isInteger(o.cap)||o.cap<12||o.cap>70)throw Error('Plafond : entier de 12 à 70 requis.');
    if(!Number.isInteger(o.seed)||o.seed<0||o.seed>4294967295)throw Error('Seed : entier non signé sur 32 bits requis.');
    if(!Number.isInteger(o.samples)||o.samples<1000||o.samples>200000)throw Error('Simulation : 1 000 à 200 000 naissances requises.');
    return o;
  }
  function parents(mother,father){
    if(![mother,father].every(g=>Array.isArray(g)&&g.length===7&&g.every(v=>Number.isInteger(v)&&v>=0&&v<=10)))throw Error('Sept genetics parentales entières de 0 à 10 requises.');
    return {B0:Math.ceil((mother.reduce((a,b)=>a+b,0)+father.reduce((a,b)=>a+b,0))/2),weights:mother.map((v,i)=>v+father[i])};
  }
  function budgetLaw(B0,o){
    const chance=o.chanceMother+o.chanceFather;let successes=0;
    if(chance>=100)successes=size;else if(chance>=1)for(let k=0;k<size;k++)if(randRange(1,100,k)<=chance)successes++;
    const p=successes/size,spontaneous={0:0,1:0,3:0},budgets=new Map();
    for(let k=0;k<size;k++){const r=randRange(0,100,k);spontaneous[r<3?3:r<10?1:0]++}
    for(const [A,prob] of [[0,1-p],[3,p]])for(const D of [0,1,3]){
      const raw=B0+A+D,B=raw<12?12:Math.min(raw,o.cap),mass=prob*spontaneous[D]/size;
      if(mass>0)budgets.set(B,(budgets.get(B)||0)+mass);
    }
    return {chanceProbability:p,spontaneousCounts:spontaneous,requested:[...budgets].sort((a,b)=>a[0]-b[0]).map(([budget,probability])=>({budget,probability}))};
  }
  function random(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}
  function birth(table,requested,rng){
    const genetics=Array(7).fill(0);let remaining=requested,attempts=0;
    while(remaining>0&&attempts<300){const id=table[Math.floor(rng()*size)];if(genetics[id]<10){genetics[id]++;remaining--}attempts++}
    return {genetics,requested,obtained:requested-remaining,remaining,attempts};
  }
  async function run(mother,father,input={}){
    const o=options(input),p=parents(mother,father),key=JSON.stringify([mother,father,o]);
    if(simulations.has(key))return simulations.get(key);
    const job=(async()=>{
      // Yield before enumeration as well as between chunks of whole births.
      const pause=()=>new Promise(resolve=>setTimeout(resolve,0));await pause();
      const selector=selectionLaw(p.weights),law=budgetLaw(p.B0,o),rng=random(o.seed);
      const counts=Array.from({length:7},()=>Array(11).fill(0)),sums=Array(7).fill(0),squares=Array(7).fill(0),obtained=new Map();let incomplete=0,missing=0,attempts=0;
      const cdf=law.requested.map((r,i,a)=>a.slice(0,i+1).reduce((s,r)=>s+r.probability,0));
      for(let start=0;start<o.samples;start+=250){
        for(let n=start;n<Math.min(start+250,o.samples);n++){
          const u=rng(),index=cdf.findIndex(v=>u<v),B=law.requested[index<0?law.requested.length-1:index].budget;
          const b=birth(selector.table,B,rng);if(b.remaining)incomplete++;missing+=b.remaining;attempts+=b.attempts;obtained.set(b.obtained,(obtained.get(b.obtained)||0)+1);
          b.genetics.forEach((v,i)=>{counts[i][v]++;sums[i]+=v;squares[i]+=v*v});
        }
        await pause();
      }
      const means=sums.map(s=>s/o.samples),meanSE=squares.map((s,i)=>Math.sqrt(Math.max(0,s/o.samples-means[i]**2)/o.samples));
      return {model:'Native reconstruction v2.2',options:o,B0:p.B0,S:p.weights.reduce((a,b)=>a+b,0)/2,weights:p.weights,selectionCounts:selector.counts,selectionProbabilities:selector.probabilities,...law,
        means,meanSE,counts,marginals:counts.map(r=>r.map(v=>v/o.samples)),obtained:[...obtained].sort((a,b)=>a[0]-b[0]).map(([budget,count])=>({budget,count,probability:count/o.samples})),
        budget:means.reduce((a,b)=>a+b,0),requestedMean:law.requested.reduce((s,r)=>s+r.budget*r.probability,0),incomplete,meanMissing:missing/o.samples,meanAttempts:attempts/o.samples};
    })();
    if(simulations.size>=16)simulations.delete(simulations.keys().next().value);simulations.set(key,job);
    try{return await job}catch(error){simulations.delete(key);throw error}
  }
  return Object.freeze({version:"native-reconstruction-v2.2",randRange,select,selectionLaw,cacheInfo,options,parents,budgetLaw,random,birth,run});
})();
