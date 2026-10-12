'use strict';
// Validated B2 order16 panels + C finite multinomial recurrence. IID attempts.
// Port source: GeneticsScoring methods/selective and Progressive/refine, 2026-10-12.
const PairScoring=(()=>{
 const version='iid-b2c-v1',config=Object.freeze({cap:60,maxStat:10,maxAttempts:300,tolerance:.0001});
 const quad={"y":[0.000052995325041750585,0.0002771248846338368,0.0006718439880608416,0.0012229779582249851,0.0019106187779867811,0.002709916111713863,0.0035919822461037056,0.004524937450811813,0.005475062549188187,0.006408017753896295,0.007290083888286137,0.00808938122201322,0.008777022041775015,0.009328156011939159,0.009722875115366163,0.00994700467495825,0.010105990650083503,0.010554249769267676,0.011343687976121683,0.012445955916449971,0.013821237555973562,0.015419832223427727,0.017183964492207413,0.019049874901623628,0.020950125098376373,0.022816035507792588,0.024580167776572272,0.02617876244402644,0.027554044083550028,0.02865631202387832,0.029445750230732325,0.029894009349916498,0.030370967275292253,0.03193987419243686,0.034702907916425885,0.0385608457075749,0.043374331445907466,0.04896941278199704,0.055143875722725944,0.06167456215568269,0.06832543784431731,0.07485612427727406,0.08103058721800296,0.08662566855409254,0.0914391542924251,0.09529709208357412,0.09806012580756315,0.09962903272470774,0.10105990650083503,0.10554249769267676,0.11343687976121684,0.12445955916449972,0.13821237555973565,0.15419832223427726,0.17183964492207413,0.19049874901623626,0.20950125098376376,0.2281603550779259,0.24580167776572276,0.2617876244402644,0.27554044083550033,0.28656312023878316,0.29445750230732326,0.298940093499165,0.30370967275292254,0.3193987419243686,0.3470290791642589,0.385608457075749,0.4337433144590747,0.48969412781997046,0.5514387572272594,0.6167456215568269,0.6832543784431732,0.7485612427727406,0.8103058721800296,0.8662566855409253,0.9143915429242511,0.9529709208357411,0.9806012580756314,0.9962903272470776,1.005299532504175,1.0277124884633837,1.067184398806084,1.1222977958224984,1.1910618777986781,1.2709916111713864,1.3591982246103704,1.4524937450811812,1.5475062549188188,1.6408017753896296,1.7290083888286136,1.8089381222013219,1.8777022041775016,1.932815601193916,1.9722875115366163,1.994700467495825,2.01059906500835,2.0554249769267674,2.134368797612168,2.244595591644997,2.3821237555973562,2.5419832223427727,2.718396449220741,2.9049874901623625,3.0950125098376375,3.281603550779259,3.4580167776572273,3.6178762444026438,3.755404408355003,3.865631202387832,3.9445750230732326,3.98940093499165,4.0211981300167,4.110849953853535,4.268737595224336,4.489191183289994,4.7642475111947125,5.0839664446855455,5.436792898441482,5.809974980324725,6.190025019675275,6.563207101558518,6.9160335553144545,7.2357524888052875,7.510808816710006,7.731262404775664,7.889150046146465,7.9788018699833,8.0423962600334,8.22169990770707,8.537475190448673,8.978382366579988,9.528495022389425,10.167932889371091,10.873585796882963,11.61994996064945,12.38005003935055,13.126414203117037,13.832067110628909,14.471504977610575,15.021617633420012,15.462524809551327,15.77830009229293,15.9576037399666,16.0847925200668,16.44339981541414,17.074950380897345,17.956764733159975,19.05699004477885,20.335865778742182,21.747171593765927,23.2398999212989,24.7601000787011,26.252828406234073,27.664134221257818,28.94300995522115,30.043235266840025,30.925049619102655,31.55660018458586,31.9152074799332,32.1695850401336,32.88679963082828,34.14990076179469,35.91352946631995,38.1139800895577,40.671731557484364,43.494343187531854,46.4797998425978,49.5202001574022,52.505656812468146,55.328268442515636,57.8860199104423,60.08647053368005,61.85009923820531,63.11320036917172,63.8304149598664],"weights":[0.00013576229705877088,0.00031126761969323726,0.000475792558412463,0.0006231448562776704,0.0007479799440828836,0.0008457825969750133,0.0009130170752246182,0.0009472530522753432,0.0009472530522753432,0.0009130170752246182,0.0008457825969750133,0.0007479799440828836,0.0006231448562776704,0.000475792558412463,0.00031126761969323726,0.00013576229705877088,0.0002715245941175417,0.0006225352393864744,0.0009515851168249259,0.0012462897125553405,0.0014959598881657669,0.0016915651939500263,0.0018260341504492362,0.001894506104550686,0.001894506104550686,0.0018260341504492362,0.0016915651939500263,0.0014959598881657669,0.0012462897125553405,0.0009515851168249259,0.0006225352393864744,0.0002715245941175417,0.0009503360794113963,0.0021788733378526612,0.0033305479088872416,0.004362013993943693,0.005235859608580185,0.0059204781788250935,0.006391119526572328,0.006630771365927403,0.006630771365927403,0.006391119526572328,0.0059204781788250935,0.005235859608580185,0.004362013993943693,0.0033305479088872416,0.0021788733378526612,0.0009503360794113963,0.0027152459411754174,0.0062253523938647455,0.00951585116824926,0.012462897125553407,0.01495959888165767,0.016915651939500263,0.018260341504492364,0.01894506104550686,0.01894506104550686,0.018260341504492364,0.016915651939500263,0.01495959888165767,0.012462897125553407,0.00951585116824926,0.0062253523938647455,0.0027152459411754174,0.009503360794113961,0.021788733378526607,0.03330547908887241,0.04362013993943692,0.052358596085801845,0.05920478178825092,0.06391119526572327,0.06630771365927401,0.06630771365927401,0.06391119526572327,0.05920478178825092,0.052358596085801845,0.04362013993943692,0.03330547908887241,0.021788733378526607,0.009503360794113961,0.013576229705877088,0.031126761969323728,0.0475792558412463,0.062314485627767036,0.07479799440828835,0.08457825969750132,0.09130170752246182,0.09472530522753432,0.09472530522753432,0.09130170752246182,0.08457825969750132,0.07479799440828835,0.062314485627767036,0.0475792558412463,0.031126761969323728,0.013576229705877088,0.027152459411754176,0.062253523938647456,0.0951585116824926,0.12462897125553407,0.1495959888165767,0.16915651939500265,0.18260341504492364,0.18945061045506864,0.18945061045506864,0.18260341504492364,0.16915651939500265,0.1495959888165767,0.12462897125553407,0.0951585116824926,0.062253523938647456,0.027152459411754176,0.05430491882350835,0.12450704787729491,0.1903170233649852,0.24925794251106814,0.2991919776331534,0.3383130387900053,0.3652068300898473,0.3789012209101373,0.3789012209101373,0.3652068300898473,0.3383130387900053,0.2991919776331534,0.24925794251106814,0.1903170233649852,0.12450704787729491,0.05430491882350835,0.1086098376470167,0.24901409575458983,0.3806340467299704,0.4985158850221363,0.5983839552663068,0.6766260775800106,0.7304136601796946,0.7578024418202746,0.7578024418202746,0.7304136601796946,0.6766260775800106,0.5983839552663068,0.4985158850221363,0.3806340467299704,0.24901409575458983,0.1086098376470167,0.2172196752940334,0.49802819150917965,0.7612680934599408,0.9970317700442726,1.1967679105326137,1.3532521551600212,1.4608273203593891,1.5156048836405491,1.5156048836405491,1.4608273203593891,1.3532521551600212,1.1967679105326137,0.9970317700442726,0.7612680934599408,0.49802819150917965,0.2172196752940334,0.4344393505880668,0.9960563830183593,1.5225361869198817,1.9940635400885451,2.3935358210652273,2.7065043103200424,2.9216546407187782,3.0312097672810983,3.0312097672810983,2.9216546407187782,2.7065043103200424,2.3935358210652273,1.9940635400885451,1.5225361869198817,0.9960563830183593,0.4344393505880668]};
 function binoms(p,N=299){const size=N+1,a=new Float64Array(size*size);a[0]=1;for(let n=1;n<=N;n++)for(let k=0;k<=n;k++)a[n*size+k]=(1-p)*a[(n-1)*size+k]+(k?p*a[(n-1)*size+k-1]:0);return a;}
function occupancy(q,N=299){const L=N+1;q=q.filter(p=>p>0);let d=new Float64Array(L*61);for(let n=0;n<L;n++)d[n*61+Math.min(n,10)]=1;let mass=q[0];
 for(let j=1;j<q.length;j++){const p=q[j]/(mass+q[j]);mass+=q[j];const bt=binoms(p,N),out=new Float64Array(L*61);
  for(let n=0;n<L;n++)for(let k=0;k<=n;k++){let c=bt[n*L+k],shift=Math.min(k,10),src=(n-k)*61,dst=n*61+shift;if(c===0)continue;for(let s=0;s<61-shift;s++)out[dst+s]+=c*d[src+s];}d=out;
 }return d;}
function infinite(q,mask=127){let ans=new Float64Array(61*7),Y=quad.y.length;
 for(let i=0;i<7;i++){if(!((mask>>i)&1)||!q[i])continue;
  for(let v=0;v<Y;v++){const y=quad.y[v];let d=new Float64Array(61);d[0]=1;
   for(let j=0;j<7;j++){if(i===j||!q[j])continue;let lam=y*q[j]/q[i],pm=new Float64Array(11);pm[0]=Math.exp(-lam);let sum=pm[0];for(let k=1;k<10;k++){pm[k]=pm[k-1]*lam/k;sum+=pm[k];}pm[10]=Math.max(0,1-sum);
    let out=new Float64Array(61);for(let k=0;k<=10;k++)for(let s=k;s<=60;s++)out[s]+=pm[k]*d[s-k];d=out;
   }
   for(let s=1;s<=60;s++)d[s]+=d[s-1];let g=Math.exp(-y)*quad.weights[v];for(let k=1;k<=10;k++){if(k>1)g*=y/(k-1);for(let b=k;b<=60;b++)ans[b*7+i]+=g*d[b-k];}
  }
 }return ans;}
function clock(q){let out=new Float64Array(301*7);for(let i=0;i<7;i++){let p=q[i],pm=new Float64Array(10);pm[0]=1;for(let t=0;t<=300;t++){let x=10;for(let k=0;k<10;k++)x-=(10-k)*pm[k];out[t*7+i]=x;for(let k=9;k>=0;k--)pm[k]=(1-p)*pm[k]+(k?p*pm[k-1]:0);}}return out;}
function bounds(q){let dp=new Float64Array(71);dp.fill(Infinity);dp[0]=0;
 for(let p of q){let pm=new Float64Array(10);pm[0]=1;for(let t=0;t<300;t++)for(let k=9;k>=0;k--)pm[k]=(1-p)*pm[k]+(k?p*pm[k-1]:0);
  let tail=new Float64Array(11);for(let k=1;k<=10;k++)tail[k]=tail[k-1]+pm[k-1];let nd=new Float64Array(71);nd.fill(Infinity);for(let n=0;n<=70;n++)for(let k=0;k<=10&&k<=n;k++)nd[n]=Math.min(nd[n],dp[n-k]+tail[k]);dp=nd;
 }return dp;}

 function exactT(q,mask,T){let out=new Float64Array(61*7),L=T;
 for(let i=0;i<7;i++){if(!(mask>>i&1))continue;let p=q[i];if(!p)continue;if(p===1){for(let b=0;b<=60;b++)out[b*7+i]=Math.min(b,10,T);continue;}
  let d=occupancy(Array.from(q).filter((_,j)=>j!==i),T-1);for(let n=0;n<T;n++)for(let s=1;s<=60;s++)d[n*61+s]+=d[n*61+s-1];
  let bt=binoms(p,T-1);for(let k=0;k<Math.min(10,T);k++)for(let t=k;t<T;t++){let a=p*bt[t*T+k];for(let b=k+1;b<=60;b++)out[b*7+i]+=a*d[(t-k)*61+b-k-1];}
 }return out;}

 const models=new Map(),pairs=new Map();let computed=0,exactStats=0,infiniteStats=0;
 const sum=(a,m)=>Array.from(a).reduce((s,v,i)=>s+((m>>i&1)?v:0),0);
 function input(pair,character){
  if(!Number.isFinite(character)||character<0)throw Error('Character mutation bonus unknown. Use Refresh in game.');
  for(const pet of [pair.female,pair.male])if(!Number.isFinite(pet.bonus)||pet.bonus<0)throw Error('Individual mutation bonus unknown. Use Refresh in game.');
  return {...NativeGenetics.parents(pair.female.stats,pair.male.stats),chanceMother:character+pair.female.bonus,chanceFather:character+pair.male.bonus,cap:config.cap};
 }
 function context(params){
  if(!Array.isArray(params.weights)||params.weights.length!==7||!params.weights.every(v=>Number.isInteger(v)&&v>=0&&v<=20))throw Error('Ordered parental weights required');
  if(!['chanceMother','chanceFather'].every(k=>Number.isFinite(params[k])&&params[k]>=0))throw Error('Effective parental mutation chances unknown');
  const o=NativeGenetics.options(params);if(o.cap!==config.cap)throw Error('This validated scoring model requires cap60');
  const B0=Math.ceil(params.weights.reduce((s,v)=>s+v,0)/2);
  const modelKey=JSON.stringify([version,NativeGenetics.version,config,params.weights]);
  const key=JSON.stringify([modelKey,o.chanceMother,o.chanceFather]);if(pairs.has(key))return pairs.get(key);
  let m=models.get(modelKey);
  if(!m){const q=Float64Array.from(NativeGenetics.selectionLaw(params.weights).probabilities),curve=clock(q),def=Float64Array.from(q,(p,i)=>p?Math.max(0,10-curve[300*7+i]):0);
   m={q,curve,def,ub:bounds(q),tables:new Map()};models.set(modelKey,m);
  }
  const law=NativeGenetics.budgetLaw(B0,o),lo=new Float64Array(7),last=m.curve.slice(300*7,301*7);let requestedMean=0,global=0;
  const support=m.q.filter(p=>p>0).length;
  for(const r of law.requested){requestedMean+=r.budget*r.probability;const L=Math.min(r.budget,10*support);global+=r.probability*L*Math.min(1,m.ub[L]);for(let i=0;i<7;i++)lo[i]+=r.probability*m.curve[r.budget*7+i]}
  const p={key,m,law,lo,last,requestedMean,global,params:{weights:[...params.weights],B0,chanceMother:o.chanceMother,chanceFather:o.chanceFather,cap:o.cap},means:null};pairs.set(key,p);return p;
 }
 function conditional(p,mask,kind){
  let t=p.m.tables.get(kind);if(!t){t={bits:0,values:new Float64Array(61*7)};p.m.tables.set(kind,t)}
  const missing=mask&~t.bits;if(missing){const a=kind==='B2'?infinite(p.m.q,missing):exactT(p.m.q,missing,kind);
   for(let b=0;b<=60;b++)for(let i=0;i<7;i++)if(missing>>i&1)t.values[b*7+i]=a[b*7+i];t.bits|=missing;
   if(kind==='B2')infiniteStats++;else exactStats++;
  }return t.values;
 }
 function mix(p,table,mask){let s=0;for(const r of p.law.requested)for(let i=0;i<7;i++)if(mask>>i&1)s+=r.probability*table[r.budget*7+i];return s}
 // One column cache for ranking and complete predictions. Uncomputed columns
 // stay private: only evaluate()/means() expose seven genetic expectations.
 function ensureMeans(p,mask){
  if(!p.values){p.values=Array(7).fill(0);p.bits=0;
   p.exactMask=0;for(let i=0;i<7;i++)if(p.global>config.tolerance&&Math.min(p.global,p.m.def[i])>config.tolerance/7)p.exactMask|=1<<i;
   if(p.m.q.filter(v=>v>0).length===1){p.values=Array.from(p.m.q,v=>v?10:0);p.bits=127;p.exactMask=127;}
  }
  const missing=mask&~p.bits;
  if(missing){const cm=p.exactMask,b=conditional(p,missing&~cm,'B2'),c=(missing&cm)?conditional(p,missing&cm,300):null,out=Array(7).fill(0);
   for(const r of p.law.requested)for(let i=0;i<7;i++)if(missing>>i&1)out[i]+=r.probability*(cm>>i&1?c:b)[r.budget*7+i];
   for(let i=0;i<7;i++)if(missing>>i&1)p.values[i]=Math.max(0,Math.min(10,out[i]));p.bits|=missing;
  }
  if(p.bits===127&&!p.means){p.means=Object.freeze(p.values);computed++;}
  return p.values;
 }
 function means(p){ensureMeans(p,127);return p.means;}
 function scoreForGoals(params,goals){const policy=GeneticQuality.prepare(goals),p=context(params),values=ensureMeans(p,policy.bits);
  return {model:version,key:p.key,average:policy.score([...values]),maxQuality:policy.maxRaw,empty:!policy.bits};
 }
 function evaluate(params,goals){const p=context(params),values=means(p),policy=GeneticQuality.prepare(goals),average=policy.score([...values]);
  return {model:version,key:p.key,means:values,average,averageBudget:values.reduce((s,v)=>s+v,0),requestedMean:p.requestedMean,maxQuality:policy.maxRaw,empty:!policy.bits,
   provenance:{method:'B2+C',exactMask:p.exactMask,tolerance:config.tolerance,quadratureOrder:16,maxAttempts:300,maxStat:10,cap:60,iid:true},law:p.law};
 }
 function cheapBounds(p,mask){if(!mask)return {lo:0,hi:0};return {lo:Math.max(0,sum(p.lo,mask)),hi:Math.min(p.requestedMean-sum(p.lo,127^mask),sum(p.last,mask))}}
 function deficit(p,mask,horizon){let d=0;for(let i=0;i<7;i++)if((mask>>i&1)&&p.m.q[i]>0)d+=Math.max(0,10-p.m.curve[horizon*7+i]);return d}
 return Object.freeze({version,config,input,context,scoreForGoals,evaluate,means,bounds:cheapBounds,deficit,refine:(p,mask,T)=>mix(p,conditional(p,mask,T),mask),
  metrics:()=>({models:models.size,pairs:pairs.size,computed,exactStats,infiniteStats})});
})();
