'use strict';
// Quality uses MAX objectives; IGNORE contributes no quality points.
const GeneticQuality=(()=>{
 const id='useful-max-points-v1',labels=['V','F','P','R','T','A','I'];
 function goals(input){
  if(Number.isInteger(input)&&input>=0&&input<128)input=labels.map((_,i)=>Boolean(input>>i&1));
  if(input instanceof Set)input=labels.map((s,i)=>input.has(i)||input.has(s));
  if(!Array.isArray(input)||input.length!==7)throw Error('Seven stat goals required');
  const a=input.map(v=>v===true||v===1?'MAX':v===false||v===0?'IGNORE':v);
  if(!a.every(v=>['MAX','IGNORE'].includes(v)))throw Error('Invalid stat goal');
  return a;
 }
 function prepare(input){
  const mask=Object.freeze(goals(input)),bits=mask.reduce((b,g,i)=>b|(g==='MAX'?1<<i:0),0),maxRaw=10*mask.filter(g=>g==='MAX').length;
  return Object.freeze({id,mask,bits,maxRaw,score(g){
   if(!Array.isArray(g)||g.length!==7||!g.every(v=>Number.isFinite(v)&&v>=-1e-9&&v<=10+1e-9))throw Error('Seven genetic values required');
   return g.reduce((s,v,i)=>s+(mask[i]==='MAX'?v:0),0);
  }});
 }
 return Object.freeze({id,goals,prepare,score:(g,m)=>prepare(m).score(g)});
})();
