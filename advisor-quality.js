'use strict';
// Product scoring policy, NOT an Icarus inheritance rule.
const AdvisorQuality=(()=>{
  const labels=['V','F','P','R','T','A','I'];
  function mask(input){
    let m;
    if(Number.isInteger(input)&&input>=0&&input<128)m=labels.map((_,i)=>!!(input&(1<<i)));
    else if(input instanceof Set)m=labels.map((s,i)=>input.has(i)||input.has(s));
    else if(Array.isArray(input)&&input.length===7&&input.every(v=>typeof v==='boolean'||v===0||v===1))m=input.map(Boolean);
    else throw Error('Seven boolean Priority stats, a bit mask or a Set of stat IDs required.');
    if(!m.some(Boolean))throw Error('Select at least one Priority stat.');
    return m;
  }
  function prepare(input,config={}){
    const m=mask(input),weights=config.weights||Array(7).fill(1);
    if(weights.length!==7||!weights.every(w=>Number.isInteger(w)&&w>0))throw Error('Seven positive integer quality weights required.');
    const maxRaw=10*weights.reduce((s,w)=>s+w,0);
    return Object.freeze({id:'priority-complement-v1',minRaw:0,maxRaw,mask:m,weights:[...weights],
      score(g){if(!Array.isArray(g)||g.length!==7||!g.every(v=>Number.isInteger(v)&&v>=0&&v<=10))throw Error('Invalid genetics.');return g.reduce((s,v,i)=>s+weights[i]*(m[i]?v:10-v),0)},
      display(raw){return 100*raw/maxRaw}});
  }
  return Object.freeze({id:'priority-complement-v1',mask,prepare,score:(g,m,c)=>prepare(m,c).score(g)});
})();
