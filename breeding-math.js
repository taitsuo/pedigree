'use strict';

// Marginal inheritance models; one event retains its identity across all seven stats.
const BreedingMath = (()=>{
  const keys=['V','F','P','R','T','A','I'];
  const names=['Vigor','Fitness','Physique','Reflex','Toughness','Adaptation','Instinct'];
  const numeric=x=>typeof x==='number'&&Number.isFinite(x);
  const genetics=p=>keys.map((_,i)=>numeric(p?.genetics?.[i])?p.genetics[i]:null);
  const sum=g=>g.every(numeric)?g.reduce((a,b)=>a+b,0):null;
  const pairKey=(f,m)=>JSON.stringify([f,m]);
  const clamp=x=>Math.max(0,Math.min(10,x));
  const variations=bound=>Array.from({length:2*bound+1},(_,i)=>i-bound);
  const same=(a,b)=>a.every((x,i)=>x===b[i]);
  function possible(f,m,model='A',bound=3){
    return new Set((model==='A'?[f,m]:[Math.round((f+m)/2)])
      .flatMap(base=>variations(bound).map(d=>clamp(base+d))));
  }
  function classify(c,f,m,bound=3){
    if(![c,f,m].every(numeric))return {kind:'unknown',df:numeric(c)&&numeric(f)?c-f:null,dm:numeric(c)&&numeric(m)?c-m:null,alternative:null};
    const father=possible(f,f,'A',bound).has(c),mother=possible(m,m,'A',bound).has(c);
    return {kind:father?(mother?'both':'father'):(mother?'mother':'neither'),df:c-f,dm:c-m,
      alternative:possible(f,m,'B',bound).has(c)};
  }
  function collect(pets,normalizeSpecies,validId,records={}){
    const wolves=pets.filter(p=>normalizeSpecies(p.species_key||p.actor_class)==='Snow_Wolf'
      &&['ACTIVE','ARCHIVED'].includes(p.lifecycle_state)&&validId(p.bt_id));
    const byId=new Map(wolves.map(p=>[p.bt_id,p]));
    const memo=new Map(),visiting=new Set();
    function generation(id){
      if(memo.has(id))return memo.get(id);
      const p=byId.get(id);if(!p||visiting.has(id))return null;
      visiting.add(id);
      const f=validId(p.father_bt_id),m=validId(p.mother_bt_id);
      const bred=Boolean(f||m||p.father||p.mother||p.twin_source||p.origin==='BRED');
      const fg=f?generation(f):null,mg=m?generation(m):null;
      const g=!bred?0:fg!==null&&mg!==null?Math.max(fg,mg)+1:null;
      visiting.delete(id);memo.set(id,g);return g;
    }
    function root(p){
      const visited=new Set();let current=p;
      while(current.twin_source){
        if(visited.has(current.bt_id))return {id:p.bt_id,issue:true};
        visited.add(current.bt_id);
        const source=byId.get(validId(current.twin_source));
        if(!source||!validId(current.mother_bt_id)||!validId(current.father_bt_id)
          ||source.mother_bt_id!==current.mother_bt_id||source.father_bt_id!==current.father_bt_id)return {id:p.bt_id,issue:true};
        current=source;
      }
      return {id:current.bt_id,issue:false};
    }
    wolves.forEach(p=>generation(p.bt_id));
    const rows=wolves.filter(p=>p.mother_bt_id||p.father_bt_id||p.mother||p.father||p.twin_source||p.origin==='BRED').map(p=>{
      const r=root(p),record=records[p.bt_id];
      const recorded=record&&record.femaleId===p.mother_bt_id&&record.maleId===p.father_bt_id;
      const child=genetics(p),cg=recorded?record.child:child;
      const mother=byId.get(validId(p.mother_bt_id))||null,father=byId.get(validId(p.father_bt_id))||null;
      return {pet:p,mother,father,
        key:pairKey(p.mother_bt_id,p.father_bt_id),drawId:r.id,twinIssue:r.issue,generation:generation(p.bt_id),
        child:cg,maternal:genetics(mother),paternal:genetics(father),
        sessionId:recorded?record.sessionId:null,
        childChanged:recorded&&child.some((v,i)=>numeric(v)&&numeric(cg[i])&&v!==cg[i])};
    });
    const groups=new Map();
    for(const r of rows){if(!groups.has(r.drawId))groups.set(r.drawId,[]);groups.get(r.drawId).push(r)}
    const events=[];
    for(const [id,members] of groups){
      const first=members[0],merge=field=>keys.map((_,i)=>{
        const values=[...new Set(members.map(r=>r[field][i]).filter(numeric))];return values.length===1?values[0]:null;
      });
      const conflict=keys.map((_,i)=>['child','maternal','paternal'].some(field=>
        new Set(members.map(r=>r[field][i]).filter(numeric)).size>1));
      events.push({...first,drawId:id,members,child:merge('child'),maternal:merge('maternal'),paternal:merge('paternal'),conflict,
        twinIssue:members.some(r=>r.twinIssue),sessionIds:[...new Set(members.map(r=>r.sessionId).filter(Boolean))]});
    }
    const breeders=wolves.filter(p=>p.lifecycle_state==='ACTIVE'&&!p.historical&&p.stage==='adult'
      &&['Female','Male'].includes(p.sex)&&genetics(p).some(numeric));
    return {pets:wolves,byId,rows,events,breeders,generations:memo};
  }
  function observations(events,index,bound){
    return events.map(e=>{
      const c=e.child[index],f=e.paternal[index],m=e.maternal[index];
      const usable=!e.twinIssue&&!e.conflict[index]&&e.pet.mother_bt_id&&e.pet.father_bt_id&&e.pet.mother_bt_id!==e.pet.father_bt_id;
      return {c,f,m,eventId:e.drawId,generation:e.generation,...classify(c,usable?f:null,usable?m:null,bound)};
    });
  }
  // EM uses all latent explanations, including several deltas collapsed onto 0 or 10.
  function fit(observations,bound=3){
    const ds=variations(bound),nq=ds.length;
    const valid=observations.filter(o=>o.kind!=='unknown');
    if(valid.some(o=>o.kind==='neither'))return {status:'contradicted',p:null,q:ds.map(()=>null),negative:null,zero:null,positive:null,n:valid.length,births:new Set(valid.map(o=>o.eventId)).size};
    const counts=new Map();
    for(const o of valid){const key=JSON.stringify([o.f,o.m,o.c]);const old=counts.get(key);if(old)old.n++;else counts.set(key,{...o,n:1})}
    const groups=[...counts.values()].map(o=>({...o,F:ds.map(d=>Number(clamp(o.f+d)===o.c)),M:ds.map(d=>Number(clamp(o.m+d)===o.c))}));
    const births=new Set(valid.map(o=>o.eventId)).size;
    if(!groups.length)return {status:'insufficient',p:null,q:ds.map(()=>null),negative:null,zero:null,positive:null,n:0,births:0};
    function run(start){
      let p=start,q=ds.map(()=>1/nq),converged=false;
      for(let iteration=0;iteration<800;iteration++){
        let paternal=0;const next=ds.map(()=>0);
        for(const g of groups){
          const weights=ds.map((_,j)=>q[j]*(p*g.F[j]+(1-p)*g.M[j]));
          const denominator=weights.reduce((a,b)=>a+b,0);
          for(let j=0;j<nq;j++){next[j]+=g.n*weights[j]/denominator;paternal+=g.n*q[j]*p*g.F[j]/denominator}
        }
        const np=paternal/valid.length,nqv=next.map(x=>x/valid.length);
        const change=Math.max(Math.abs(np-p),...q.map((x,j)=>Math.abs(x-nqv[j])));
        p=np;q=nqv;if(change<1e-9){converged=true;break}
      }
      const ll=groups.reduce((acc,g)=>acc+g.n*Math.log(Math.max(1e-300,ds.reduce((a,_,j)=>a+q[j]*(p*g.F[j]+(1-p)*g.M[j]),0))),0);
      return {p,q,ll,converged};
    }
    const fits=[0.15,0.5,0.85].map(run).sort((a,b)=>b.ll-a.ll),best=fits[0];
    // Local identifiability from the full outcome probabilities, not just observed bins.
    // Free coordinates are p and q[0..nq-2], with the last q fixed by their sum.
    const designs=[...new Map(valid.map(o=>[JSON.stringify([o.f,o.m]),o])).values()];
    const matrix=[];
    for(const o of designs)for(let c=0;c<=10;c++){
      const F=ds.map(d=>Number(clamp(o.f+d)===c)),M=ds.map(d=>Number(clamp(o.m+d)===c));
      const last=best.p*F[nq-1]+(1-best.p)*M[nq-1];
      matrix.push([ds.reduce((a,_,j)=>a+best.q[j]*(F[j]-M[j]),0),...ds.slice(0,-1).map((_,j)=>best.p*F[j]+(1-best.p)*M[j]-last)]);
    }
    const width=nq,pivots=[];let row=0;
    for(let col=0;col<width&&row<matrix.length;col++){
      let pick=row;for(let r=row+1;r<matrix.length;r++)if(Math.abs(matrix[r][col])>Math.abs(matrix[pick][col]))pick=r;
      if(Math.abs(matrix[pick][col])<1e-7)continue;
      [matrix[row],matrix[pick]]=[matrix[pick],matrix[row]];const v=matrix[row][col];matrix[row]=matrix[row].map(x=>x/v);
      for(let r=0;r<matrix.length;r++)if(r!==row){const x=matrix[r][col];matrix[r]=matrix[r].map((v,j)=>v-x*matrix[row][j])}
      pivots.push(col);row++;
    }
    const nulls=[];
    for(let col=0;col<width;col++)if(!pivots.includes(col)){
      const v=Array(width).fill(0);v[col]=1;pivots.forEach((p,r)=>v[p]=-matrix[r][col]);nulls.push(v);
    }
    const close=fits.filter(f=>best.ll-f.ll<1e-5);
    function identify(weights,value,values){
      if(births<20||!best.converged)return null;
      if(nulls.some(v=>Math.abs(v.reduce((a,x,i)=>a+x*weights[i],0))>1e-6))return null;
      if(values.some(x=>Math.abs(x-value)>0.02))return null;
      return value;
    }
    const pw=Array(width).fill(0);pw[0]=1;
    const p=identify(pw,best.p,close.map(f=>f.p));
    function probability(indices){
      const hasLast=indices.includes(nq-1),weights=[0,...ds.slice(0,-1).map((_,j)=>Number(indices.includes(j))-Number(hasLast))];
      return identify(weights,indices.reduce((a,j)=>a+best.q[j],0),close.map(f=>indices.reduce((a,j)=>a+f.q[j],0)));
    }
    return {status:births<20?'insufficient':'compatible',p,q:ds.map((_,j)=>probability([j])),
      negative:probability(ds.map((d,i)=>d<0?i:-1).filter(i=>i>=0)),zero:probability([bound]),
      positive:probability(ds.map((d,i)=>d>0?i:-1).filter(i=>i>=0)),n:valid.length,births,
      logLikelihood:best.ll,converged:best.converged};
  }
  function summarize(obs,bound){
    const counts={father:0,mother:0,both:0,neither:0,unknown:0};obs.forEach(o=>counts[o.kind]++);
    const n=obs.length-counts.unknown;
    return {counts,n,births:new Set(obs.filter(o=>o.kind!=='unknown').map(o=>o.eventId)).size,
      compatibility:n?100*(n-counts.neither)/n:null,alternativeContradictions:obs.filter(o=>o.alternative===false).length,
      estimate:fit(obs,bound)};
  }
  function correlations(perStat){
    const result=[];
    for(let i=0;i<7;i++)for(let j=i+1;j<7;j++){
      const right=new Map(perStat[j].map(o=>[o.eventId,o]));
      const pairs=perStat[i].map(a=>[a,right.get(a.eventId)]).filter(([a,b])=>b&&['father','mother'].includes(a.kind)&&['father','mother'].includes(b.kind));
      const n=pairs.length,agree=pairs.filter(([a,b])=>a.kind===b.kind).length;
      const xs=pairs.map(([a])=>Number(a.kind==='father')),ys=pairs.map(([,b])=>Number(b.kind==='father'));
      const mean=a=>a.reduce((s,x)=>s+x,0)/(a.length||1),mx=mean(xs),my=mean(ys);
      const vx=xs.reduce((s,x)=>s+(x-mx)**2,0),vy=ys.reduce((s,x)=>s+(x-my)**2,0);
      const phi=n>=20&&vx&&vy?xs.reduce((s,x,k)=>s+(x-mx)*(ys[k]-my),0)/Math.sqrt(vx*vy):null;
      const measured=perStat[i].map(a=>[a,right.get(a.eventId)]).filter(([a,b])=>b&&a.kind!=='unknown'&&b.kind!=='unknown');
      const centered=side=>{
        const strata=new Map();for(const pair of measured){const o=pair[side],key=JSON.stringify([o.f,o.m]);if(!strata.has(key))strata.set(key,[]);strata.get(key).push(o.c)}
        return measured.map(pair=>{const o=pair[side],values=strata.get(JSON.stringify([o.f,o.m]));return o.c-values.reduce((a,b)=>a+b,0)/values.length});
      };
      const rx=centered(0),ry=centered(1),rvx=rx.reduce((s,x)=>s+x*x,0),rvy=ry.reduce((s,x)=>s+x*x,0);
      const residual=measured.length>=20&&rvx&&rvy?rx.reduce((s,x,k)=>s+x*ry[k],0)/Math.sqrt(rvx*rvy):null;
      result.push({i,j,n,agree,phi,residualN:measured.length,residual});
    }
    return result;
  }
  function analyze(events,bound=3){
    const perStat=keys.map((_,i)=>observations(events,i,bound));
    const stats=perStat.map(obs=>summarize(obs,bound));
    const all=perStat.flat(),counts={father:0,mother:0,both:0,neither:0,unknown:0};all.forEach(o=>counts[o.kind]++);
    let commonReason='Comparaison insuffisante : au moins 40 naissances appariées par paire de stats sont requises.',comparable=true,different=false;
    // Paired, within-birth contrasts avoid treating seven stats as independent births.
    // Only compare stats with identical parental designs in the same event.
    for(let i=0;i<7;i++)for(let j=i+1;j<7;j++){
      const right=new Map(perStat[j].map(o=>[o.eventId,o]));
      const pairs=perStat[i].map(a=>[a,right.get(a.eventId)]).filter(([a,b])=>b&&a.kind!=='unknown'&&b.kind!=='unknown'&&a.f===b.f&&a.m===b.m);
      if(pairs.length<40){comparable=false;continue}
      for(let v=0;v<=10;v++){
        const ds=pairs.map(([a,b])=>Number(a.c===v)-Number(b.c===v)),n=ds.length,mean=ds.reduce((a,b)=>a+b,0)/n;
        const se=Math.sqrt(ds.reduce((a,x)=>a+(x-mean)**2,0)/(n-1)/n);
        // Conservative exploratory screen over 21 pairs x 11 bins, not proof of equality.
        if(Math.abs(mean)>4.1*se+1e-9)different=true;
      }
    }
    const contradictions=counts.neither,eligible=comparable&&!different&&!contradictions&&stats.every(s=>s.estimate.converged);
    if(different)commonReason='Différences détectées entre distributions appariées : pas de paramètres communs imposés.';
    else if(contradictions)commonReason='Hypothèse principale contredite : aucune estimation commune.';
    else if(eligible)commonReason='Aucune différence détectée dans les distributions appariées. Estimation commune exploratoire, conditionnelle à des probabilités partagées ; cela ne prouve pas leur égalité.';
    return {stats,perStat,counts,n:all.length-counts.unknown,births:new Set(all.filter(o=>o.kind!=='unknown').map(o=>o.eventId)).size,
      compatibility:all.length-counts.unknown?100*(all.length-counts.unknown-contradictions)/(all.length-counts.unknown):null,
      common:eligible?fit(all,bound):null,commonReason,correlations:correlations(perStat)};
  }
  function histogram(events,index){
    const bins=Array(11).fill(0);for(const e of events)if(!e.twinIssue&&!e.conflict[index]&&Number.isInteger(e.child[index])&&e.child[index]>=0&&e.child[index]<=10)bins[e.child[index]]++;
    return bins;
  }
  function totals(e){
    const father=sum(e.paternal),mother=sum(e.maternal),child=sum(e.child);
    return {father,mother,child,df:child!==null&&father!==null?child-father:null,
      dm:child!==null&&mother!==null?child-mother:null,da:[father,mother,child].every(numeric)?child-(father+mother)/2:null};
  }
  function generationSummary(events,bound){
    const generations=[...new Set(events.map(e=>e.generation))].sort((a,b)=>a===null?1:b===null?-1:a-b);
    return generations.map(g=>{
      const rows=events.filter(e=>e.generation===g&&!e.twinIssue),full=rows.filter(e=>!e.conflict.some(Boolean)&&sum(e.child)!==null);
      return {generation:g,events:rows.length,totalCount:full.length,mean:full.length?full.reduce((a,e)=>a+sum(e.child),0)/full.length:null,
        histograms:keys.map((_,i)=>histogram(rows,i)),analysis:analyze(rows,bound)};
    });
  }
  function seriesEvents(data,series){return data.events.filter(e=>e.sessionIds.includes(series.id))}
  function recommend(data,state,analysis){
    const parent=(sex,genes)=>data.breeders.filter(p=>p.sex===sex&&same(genetics(p),genes)).sort((a,b)=>a.bt_id.localeCompare(b.bt_id,'en',{numeric:true}))[0]||null;
    function candidate(f,m,kind){
      const female=parent('Female',f),male=parent('Male',m);
      const history=data.events.filter(e=>same(e.maternal,f)&&same(e.paternal,m)&&!e.twinIssue);
      const counts=keys.map((_,i)=>observations(history,i,state.bound).filter(o=>o.kind!=='unknown').length),count=Math.min(...counts);
      let distinction=0;
      keys.forEach((_,i)=>{
        if(analysis.stats[i].counts.neither||analysis.stats[i].alternativeContradictions)return;
        const A=possible(f[i],m[i],'A',state.bound),B=possible(f[i],m[i],'B',state.bound);
        distinction+=[...new Set([...A,...B])].filter(v=>A.has(v)!==B.has(v)).length;
      });
      return {female,male,maternal:f,paternal:m,kind,count,distinction,available:Number(Boolean(female))+Number(Boolean(male))};
    }
    const full=v=>keys.map(()=>v),candidates=[candidate(full(8),full(2),'initial'),candidate(full(2),full(8),'reverse'),candidate(full(5),full(5),'variation')];
    const series=state.series;
    const maternal=genetics(data.byId.get(series?.femaleId)),paternal=genetics(data.byId.get(series?.maleId));
    if(series&&maternal.every(numeric)&&paternal.every(numeric))candidates.push(candidate(paternal,maternal,'reverse'));
    const females=data.breeders.filter(p=>p.sex==='Female'&&genetics(p).every(numeric)),males=data.breeders.filter(p=>p.sex==='Male'&&genetics(p).every(numeric));
    for(const f of females)for(const m of males)if(!candidates.some(c=>same(c.maternal,genetics(f))&&same(c.paternal,genetics(m))))candidates.push(candidate(genetics(f),genetics(m),'existing'));
    const contradiction=analysis.counts.neither>0||analysis.stats.some(s=>s.alternativeContradictions>0);
    const remaining=candidates.filter(c=>c.count<state.target);
    let next=remaining.sort((a,b)=>
      (contradiction?Number(b.kind==='variation')-Number(a.kind==='variation'):b.distinction-a.distinction)||
      b.available-a.available||a.count-b.count||Number(a.kind==='existing')-Number(b.kind==='existing'))[0];
    if(!next){next=candidates.find(c=>c.kind==='reverse');next.reason='Les protocoles sont documentés. Répéter le croisement inverse ou tester ses descendants pour vérifier la stabilité dans une génération suivante.';return next}
    next.reason=next.kind==='variation'?'Des parents identiques isolent les variations ; Full 5 limite le masquage par les bornes. Le choix du père reste alors indéterminable.'
      :next.kind==='reverse'?'Inverser les valeurs père/mère aide à distinguer une préférence parentale des variations. Les fréquences restent à estimer.'
      :next.kind==='initial'?'Full 8 × Full 2 apporte sept observations par naissance et peut départager sélection parentale et moyenne parentale.'
      :'Ce couple existant apporte des combinaisons parentales informatives sans sélectionner les descendants pour augmenter leur score.';
    if(next.count)next.reason+=' '+next.count+' naissances contrôlées déjà documentées ; compléter l’échantillon.';
    if(next.female&&next.male){const gs=[data.generations.get(next.female.bt_id),data.generations.get(next.male.bt_id)];if(gs.some(g=>g>0))next.reason+=' Reproducteurs descendants : comparer aussi avec les générations précédentes.'}
    return next;
  }
  return Object.freeze({keys,names,numeric,genetics,sum,pairKey,clamp,variations,same,possible,classify,collect,fit,analyze,observations,histogram,totals,generationSummary,seriesEvents,recommend});
})();
