'use strict';
const AdvisorQuality=(()=>{
  const labels=['V','F','P','R','T','A','I'],id='max-ignore-min-v2';
  function goals(input){
    let a=input;
    if(Number.isInteger(a)&&a>=0&&a<128)a=labels.map((_,i)=>!!(a&(1<<i)));
    if(a instanceof Set)a=labels.map((s,i)=>a.has(i)||a.has(s));
    if(!Array.isArray(a)||a.length!==7)throw Error('Seven stat goals required');
    a=a.map(v=>v===true||v===1?'MAX':v===false||v===0?'IGNORE':v);
    if(!a.every(v=>['MAX','IGNORE','MIN'].includes(v)))throw Error('Invalid stat goal');
    if(!a.some(v=>v!=='IGNORE'))throw Error('At least one MAX or MIN stat required');
    return a;
  }
  function prepare(input){
    const m=Object.freeze(goals(input)),maxRaw=10*m.filter(v=>v!=='IGNORE').length;
    return Object.freeze({id,minRaw:0,maxRaw,mask:m,weights:Object.freeze(m.map(v=>Number(v!=='IGNORE'))),
      score(g){
        if(!Array.isArray(g)||g.length!==7||!g.every(v=>Number.isInteger(v)&&v>=0&&v<=10))throw Error('Seven integer genetics required');
        return g.reduce((s,v,i)=>s+(m[i]==='MAX'?v:m[i]==='MIN'?10-v:0),0);
      },display(raw){return 100*raw/maxRaw}});
  }
  return Object.freeze({id,goals,mask:goals,prepare,score:(g,m)=>prepare(m).score(g)});
})();
