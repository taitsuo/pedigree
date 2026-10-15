'use strict';
// Search policies only. All displayed scores come from the same PairScoring.
const AdvisorRanking=(()=>{
 let channel=null;const waiting=[];
 function yieldTask(){
  if(typeof MessageChannel==='undefined')return new Promise(r=>setTimeout(r,0));
  if(!channel){channel=new MessageChannel();channel.port1.onmessage=()=>waiting.shift()();}
  return new Promise(r=>{waiting.push(r);channel.port2.postMessage(0)});
 }
 const tolerance=.01,guard=.0002;
 const id=r=>String(r.pair?.key??r.key),sideKey=(p,side)=>p[side+'Group']?.key||p[side].bt_id;
 function stable(rows,score=r=>r.score,key=id){
  const sorted=[...rows].sort((a,b)=>score(b)-score(a)||key(a).localeCompare(key(b))),out=[];
  for(let at=0;at<sorted.length;){let end=at+1;while(end<sorted.length&&score(sorted[at])-score(sorted[end])<tolerance)end++;
   out.push(...sorted.slice(at,end).sort((a,b)=>key(a).localeCompare(key(b))));at=end;
  }return out;
 }
 function create({scoring=PairScoring}={}){
  let token=0;const cancel=()=>{token++};
  async function run(pairs,goals,character,{strategy='all-pairs',onProgress=()=>{}}={}){
   if(!['all-pairs','progressive'].includes(strategy))throw Error('Unknown ranking strategy');
   const mine=++token,started=performance.now(),policy=GeneticQuality.prepare(goals);
   const check=()=>{if(mine!==token)throw new DOMException('Obsolete ranking','AbortError')};
   let lastYield=performance.now(),lastProgress=lastYield,evaluated=0,pruned=0,refinements=0;
   async function pause(){check();if(performance.now()-lastYield>=4){await yieldTask();lastYield=performance.now();check();if(lastYield-lastProgress>=100){onProgress({final:false,evaluated,pruned,total:models.size});lastProgress=lastYield}}}
   // Collapse mathematical equivalents without dropping individual identities.
   const models=new Map(),records=[];
   for(const pair of pairs){const params=scoring.input(pair,character),p=scoring.context(params);let g=models.get(p.key);
    if(!g){g={p,params,pairs:[],...scoring.bounds(p,policy.bits),rating:null};models.set(p.key,g)}g.pairs.push(pair);records.push({pair,g});await pause();
   }
   const lower={female:new Map(),male:new Map()};
   function refresh(g){for(const pair of g.pairs)for(const side of ['female','male']){const key=sideKey(pair,side);lower[side].set(key,Math.max(lower[side].get(key)??-Infinity,g.lo))}}
   for(const g of models.values())refresh(g);
   function cutoff(side){const v=[...lower[side].values()].sort((a,b)=>b-a);return v.length>=3?v[2]:-Infinity}
   function relevant(g){return g.hi+guard>=Math.min(cutoff('female'),cutoff('male'))-tolerance}
   const todo=[...models.values()].sort((a,b)=>b.lo-a.lo||a.p.key.localeCompare(b.p.key));
   for(const g of todo){
    check();
    if(strategy==='progressive'&&policy.bits){
     if(!relevant(g)){pruned++;continue}
     for(const horizon of [60,120]){
      const deficit=scoring.deficit(g.p,policy.bits,horizon);
      if(deficit>=g.hi-g.lo+guard)continue;
      const lo=scoring.refine(g.p,policy.bits,horizon);g.lo=Math.max(g.lo,lo);g.hi=Math.min(g.hi,lo+deficit);refinements++;refresh(g);await pause();
      if(!relevant(g))break;
     }
     if(!relevant(g)){pruned++;continue}
    }
    g.rating=scoring.scoreForGoals(g.params,goals);g.score=g.rating.average;g.lo=g.score-guard;g.hi=g.score+guard;refresh(g);evaluated++;
    await pause();
   }
   // Certify every displayed best partner in the winning female/male groups,
   // including weaker individual twins. Secondary groups stay deferred.
   const winning={female:new Set(),male:new Set()};
   function bestGroups(rows,side){const map=new Map();for(const row of [...rows].sort((a,b)=>b.score-a.score||id(a).localeCompare(id(b)))){const key=sideKey(row.pair,side);if(!map.has(key))map.set(key,{key,row,score:row.score})}return stable([...map.values()],r=>r.score,r=>r.key)}
   const initial=records.filter(r=>r.g.rating).map(r=>({pair:r.pair,score:r.g.score}));
   for(const side of ['female','male'])for(const entry of bestGroups(initial,side).slice(0,3))winning[side].add(entry.key);
   if(strategy==='progressive')for(const g of models.values())if(!g.rating&&g.pairs.some(pair=>winning.female.has(sideKey(pair,'female'))||winning.male.has(sideKey(pair,'male')))){
    g.rating=scoring.scoreForGoals(g.params,goals);g.score=g.rating.average;evaluated++;pruned=Math.max(0,pruned-1);await pause();
   }
   check();
   const rows=stable(records.filter(r=>r.g.rating).map(r=>({pair:r.pair,...r.g.rating,score:r.g.score})));
   const catalogs={};
   for(const side of ['female','male']){
    const map=new Map();
    for(const {key,row} of bestGroups(rows,side))map.set(key,{key,group:row.pair[side+'Group'],pair:row.pair,rating:row,score:row.score});
    const ranked=[...map.values()];
    for(const pair of pairs){const key=sideKey(pair,side);if(!map.has(key)){const entry={key,group:pair[side+'Group'],pair,rating:null,score:null};map.set(key,entry);ranked.push(entry)}}
    if(strategy==='progressive')for(const entry of ranked)if(!winning[side].has(entry.key)){entry.rating=null;entry.score=null}
    catalogs[side]=ranked;
   }
   const result={rows,catalogs,metrics:{strategy,pairs:pairs.length,models:models.size,evaluated,pruned,refinements,milliseconds:performance.now()-started}};
   onProgress({...result,final:true});return result;
  }
  return Object.freeze({run,cancel});
 }
 return Object.freeze({create,stable,tolerance,strategies:Object.freeze(['all-pairs','progressive'])});
})();
