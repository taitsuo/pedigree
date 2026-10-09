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
    // Stored experiment records are evidence of IDs already captured, never guesses from labels.
    function parentIds(p){
      const record=records[p.bt_id],conflict=Boolean(record&&((p.mother_bt_id&&p.mother_bt_id!==record.femaleId)||(p.father_bt_id&&p.father_bt_id!==record.maleId)));
      const recorded=record&&!conflict&&validId(record.femaleId)&&validId(record.maleId)&&record.femaleId!==record.maleId;
      return {motherId:validId(p.mother_bt_id)||(recorded?record.femaleId:null),fatherId:validId(p.father_bt_id)||(recorded?record.maleId:null),recorded,conflict};
    }
    const memo=new Map(),visiting=new Set();
    function generation(id){
      if(memo.has(id))return memo.get(id);
      const p=byId.get(id);if(!p||visiting.has(id))return null;
      visiting.add(id);
      const ids=parentIds(p),f=ids.fatherId,m=ids.motherId;
      const bred=Boolean(f||m||p.father||p.mother||p.twin_source||p.origin==='BRED');
      const fg=f?generation(f):null,mg=m?generation(m):null;
      const g=!bred?0:fg!==null&&mg!==null?Math.max(fg,mg)+1:null;
      visiting.delete(id);memo.set(id,g);return g;
    }
    function root(p){
      const visited=new Set(),expectedRoots=new Set();let current=p,evidence='individual_bt_id';
      while(true){
        const ids=parentIds(current),record=ids.recorded?records[current.bt_id]:null;
        const saved=record?.drawId&&record.drawId!==current.bt_id?validId(record.drawId):null;
        if(saved)expectedRoots.add(saved);
        const link=current.twin_source||saved;
        if(!link)return {id:current.bt_id,issue:ids.conflict||[...expectedRoots].some(id=>id!==current.bt_id),evidence};
        if(visited.has(current.bt_id))return {id:p.bt_id,issue:true,evidence:'unresolved_link'};
        visited.add(current.bt_id);
        const source=byId.get(validId(link)),sourceIds=source?parentIds(source):null;
        if(!source||ids.conflict||sourceIds.conflict||!ids.motherId||!ids.fatherId||sourceIds.motherId!==ids.motherId||sourceIds.fatherId!==ids.fatherId)return {id:p.bt_id,issue:true,evidence:'unresolved_link'};
        evidence=current.twin_source?'twin_source':'controlled_record';current=source;
      }
    }
    wolves.forEach(p=>generation(p.bt_id));
    const rows=wolves.filter(p=>p.mother_bt_id||p.father_bt_id||p.mother||p.father||p.twin_source||p.origin==='BRED'||records[p.bt_id]).map(p=>{
      const r=root(p),record=records[p.bt_id],ids=parentIds(p);
      const recorded=ids.recorded;
      const child=genetics(p),cg=recorded?record.child:child;
      const mother=byId.get(ids.motherId)||null,father=byId.get(ids.fatherId)||null;
      return {pet:p,mother,father,motherId:ids.motherId,fatherId:ids.fatherId,parentConflict:ids.conflict,drawEvidence:r.evidence,
        parentEvidence:recorded&&(!p.mother_bt_id||!p.father_bt_id)?'controlled_record':'original_bt_id',
        key:pairKey(ids.motherId,ids.fatherId),drawId:r.id,twinIssue:r.issue,generation:generation(p.bt_id),
        child:cg,maternal:genetics(mother),paternal:genetics(father),
        sessionId:record?.sessionId||null,recordMotherId:record?.femaleId||null,recordFatherId:record?.maleId||null,
        childChanged:recorded&&child.some((v,i)=>numeric(v)&&numeric(cg[i])&&v!==cg[i])};
    });
    const groups=new Map();
    for(const r of rows){if(!groups.has(r.drawId))groups.set(r.drawId,[]);groups.get(r.drawId).push(r)}
    const events=[];
    for(const [id,members] of groups){
      const first=members.find(r=>r.mother&&r.father)||members[0],merge=field=>keys.map((_,i)=>{
        const values=[...new Set(members.map(r=>r[field][i]).filter(numeric))];return values.length===1?values[0]:null;
      });
      const conflict=keys.map((_,i)=>['child','maternal','paternal'].some(field=>
        new Set(members.map(r=>r[field][i]).filter(numeric)).size>1));
      events.push({...first,drawId:id,members,child:merge('child'),maternal:merge('maternal'),paternal:merge('paternal'),conflict,
        twinIssue:members.some(r=>r.twinIssue),sessionConflict:new Set(members.map(r=>r.sessionId).filter(Boolean)).size>1,sessionIds:[...new Set(members.map(r=>r.sessionId).filter(Boolean))]});
    }
    const breeders=wolves.filter(p=>p.lifecycle_state==='ACTIVE'&&!p.historical&&p.stage==='adult'
      &&['Female','Male'].includes(p.sex)&&genetics(p).some(numeric));
    return {pets:wolves,byId,rows,events,breeders,generations:memo};
  }
  function observations(events,index,bound){
    return events.map(e=>{
      const c=e.child[index],f=e.paternal[index],m=e.maternal[index];
      const usable=!e.twinIssue&&!e.sessionConflict&&!e.members.some(r=>r.parentConflict)&&!e.conflict[index]&&e.motherId&&e.fatherId&&e.motherId!==e.fatherId;
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
  function seriesEvents(data,series){return data.events.filter(e=>e.sessionIds.includes(series.id)&&e.members.some(r=>r.key===pairKey(series.femaleId,series.maleId)||(r.recordMotherId===series.femaleId&&r.recordFatherId===series.maleId)))}
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
    if(next.count)next.reason+=' '+next.count+' tirages déjà documentés dans ce périmètre ; compléter l’échantillon.';
    if(next.female&&next.male){const gs=[data.generations.get(next.female.bt_id),data.generations.get(next.male.bt_id)];if(gs.some(g=>g>0))next.reason+=' Reproducteurs descendants : comparer aussi avec les générations précédentes.'}
    return next;
  }

  // Capture diagnostics never infer a missing parent or a twin from matching genetics.
  function captureFlags(row){
    const flags=[];
    if(!row.motherId||!row.fatherId)flags.push('Parenté incomplète : vérifier la capture (jumeau possible, non confirmé).');
    else if(!row.mother||!row.father)flags.push('Parent introuvable par BT_ID.');
    if(row.motherId&&row.motherId===row.fatherId)flags.push('Même BT_ID pour les deux parents.');
    if(row.parentConflict)flags.push('Parenté actuelle incompatible avec les BT_ID déjà enregistrés.');
    if(row.twinIssue)flags.push('Lien twin_source non résolu ou incohérent.');
    return flags;
  }
  function reliableEvent(e){return !e.twinIssue&&!e.sessionConflict&&e.members.every(r=>!captureFlags(r).length)}
  function captureSummary(events,bound=3){
    const rows=events.flatMap(e=>e.members),reliable=events.filter(reliableEvent);
    return {individuals:rows.length,draws:reliable.length,
      analysable:reliable.filter(e=>keys.some((_,i)=>observations([e],i,bound)[0].kind!=='unknown')).length,
      twinGroups:reliable.filter(e=>e.members.length>1).length,
      linkedTwins:reliable.reduce((n,e)=>n+Math.max(0,e.members.length-1),0),
      uncertain:rows.filter(r=>captureFlags(r).length).length,
      conflicting:events.filter(e=>e.conflict.some(Boolean)||e.sessionConflict).length,
      events:events.length,uncertainEvents:events.filter(e=>!reliableEvent(e)).length};
  }
  function bloodlines(events){
    const counts={father:0,mother:0,other:0,same:0,sameOther:0};let excluded=0;
    const value=p=>typeof p?.lineage==='string'&&p.lineage.trim()&&!/^(unknown|inconnu|inconnue)$/i.test(p.lineage.trim())?p.lineage.trim():null;
    for(const e of events){
      const f=value(e.father),m=value(e.mother),children=e.members.map(r=>value(r.pet));
      if(!reliableEvent(e)||!f||!m||children.some(c=>!c)||new Set(children).size!==1){excluded++;continue}
      const c=children[0];counts[f===m?(c===f?'same':'sameOther'):c===f?'father':c===m?'mother':'other']++;
    }
    const n=Object.values(counts).reduce((a,b)=>a+b,0);
    return {n,excluded,counts,frequencies:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,n?v/n:null]))};
  }
  function lessons(events,bound=3,analysis=analyze(events,bound)){
    const capture=captureSummary(events,bound),lines=[];
    if(!analysis.births)return [{kind:'Données insuffisantes',text:'Aucun tirage avec enfant et deux valeurs parentales exploitables. Les captures incomplètes restent visibles dans les observations.'}];
    let df=0,dm=0,da=0,distanceN=0,furthest=0,exact=[],contradictionsA=new Set(),contradictionsB=new Set();
    for(const e of events){
      const known=keys.map((_,i)=>observations([e],i,bound)[0]).filter(o=>o.kind!=='unknown');
      if(!known.length)continue;
      const mean=fn=>known.reduce((n,o)=>n+fn(o),0)/known.length;
      df+=mean(o=>Math.abs(o.c-o.f));dm+=mean(o=>Math.abs(o.c-o.m));da+=mean(o=>Math.abs(o.c-(o.f+o.m)/2));distanceN++;
      for(const o of known){
        furthest=Math.max(furthest,Math.min(Math.abs(o.df),Math.abs(o.dm)));
        if(o.f===o.m&&o.c>0&&o.c<10)exact.push(o.c-o.f);
        if(o.kind==='neither')contradictionsA.add(e.drawId);
        if(!o.alternative)contradictionsB.add(e.drawId);
      }
    }
    const distances=[df,dm,da].map(n=>n/distanceN),labels=['du père','de la mère','de la moyenne parentale'];
    const minimum=Math.min(...distances),closest=labels.filter((_,i)=>Math.abs(distances[i]-minimum)<1e-8);
    lines.push({kind:'Observation',text:'Sur '+distanceN+' tirages, les descendants sont en moyenne les plus proches '+closest.join(' et ')+'. Écart absolu moyen : père '+distances[0].toFixed(2)+', mère '+distances[1].toFixed(2)+', moyenne '+distances[2].toFixed(2)+' points par stat disponible. Chaque naissance a le même poids ; cette proximité ne révèle pas le parent choisi.'});
    lines.push({kind:'Variation observée',text:'Le plus grand écart au parent le plus proche est de '+furthest+' points. Il constitue une amplitude minimale nécessaire au modèle parental, pas une mutation attribuée.'+(exact.length?' Avec des parents de même valeur et un enfant hors des bornes 0/10, les écarts observés vont de '+Math.min(...exact)+' à '+Math.max(...exact)+' ('+exact.length+' valeurs de stats).':' L’origine parentale ambiguë et le plafonnement à 0/10 empêchent de mesurer toutes les variations réelles.')});
    const b=analysis.stats.reduce((n,s)=>n+s.alternativeContradictions,0);
    lines.push({kind:analysis.counts.neither||b?'Hypothèses contredites':'Hypothèses compatibles à ce stade',text:'Avec la borne supposée ±'+bound+', sélection parentale + variation : '+analysis.counts.neither+' valeurs impossibles sur '+analysis.n+' ('+contradictionsA.size+' tirages). Moyenne arrondie + variation : '+b+' valeurs impossibles ('+contradictionsB.size+' tirages).'+(!analysis.counts.neither&&!b?' Les deux modèles expliquent encore toutes ces observations ; aucun n’est confirmé.':analysis.counts.neither&&b?' Les deux modèles rencontrent des contre-exemples : revoir leurs règles, sans forcer les données.':' Le modèle sans contre-exemple reste seulement compatible avec les données.')});
    lines.push({kind:'Questions ouvertes',text:analysis.births<20?'Seulement '+analysis.births+' tirages analysables : compléter l’échantillon. Vingt tirages ne garantissent pas de distinguer les modèles.': 'Les '+analysis.births+' tirages fournissent '+analysis.n+' valeurs de stats, pas '+analysis.n+' naissances indépendantes. '+(analysis.stats.some(s=>s.estimate.p!==null)?'Certaines préférences parentales sont estimables, mais restent exploratoires ; consulter les estimations avancées.':'La préférence père/mère reste indéterminée avec ces données.')+' Inverser les valeurs parentales et tester des parents identiques aide à séparer préférence et variation.'});
    if(capture.uncertain||capture.conflicting)lines.push({kind:'Captures à vérifier',text:capture.uncertain+' individus à parenté ou lien gémellaire incertain ; '+capture.conflicting+' événements contradictoires (stats gémellaires ou attribution de série). Les valeurs concernées sont exclues des estimations ; aucun lien manquant n’est inventé.'});
    return lines;
  }


  // Descriptive additions reuse context histograms, events and generation means; no model is refitted.
  function descriptiveResults(data,series,results,graphEvents){
    const eligible=keys.map((_,i)=>new Set(graphEvents.filter(e=>!e.conflict[i]&&Number.isInteger(e.child[i])&&e.child[i]>=0&&e.child[i]<=10).map(e=>e.drawId)));
    const comparison=values=>{
      const n=values.length,lower=values.filter(v=>v<0).length,equal=values.filter(v=>v===0).length,higher=values.filter(v=>v>0).length,delta_sum=values.reduce((a,b)=>a+b,0);
      return {n,lower,equal,higher,frequencies:{lower:n?lower/n:null,equal:n?equal/n:null,higher:n?higher/n:null},delta_sum,mean_delta:n?delta_sum/n:null};
    };
    const parentComparisons=keys.map((stat,i)=>{
      const usable=results.analysis.perStat[i].filter(o=>eligible[i].has(o.eventId));
      return {stat,father:comparison(usable.filter(o=>numeric(o.f)).map(o=>o.c-o.f)),mother:comparison(usable.filter(o=>numeric(o.m)).map(o=>o.c-o.m))};
    });
    const pooled=side=>{
      const rows=parentComparisons.map(c=>c[side]),n=rows.reduce((a,r)=>a+r.n,0),delta_sum=rows.reduce((a,r)=>a+r.delta_sum,0);
      const counts=Object.fromEntries(['lower','equal','higher'].map(k=>[k,rows.reduce((a,r)=>a+r[k],0)]));
      return {n,...counts,frequencies:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,n?v/n:null])),delta_sum,mean_delta:n?delta_sum/n:null};
    };
    const counts=Array.from({length:11},(_,v)=>results.histograms.reduce((n,h)=>n+h.counts[v],0)),n=counts.reduce((a,b)=>a+b,0);
    const draws=new Set(eligible.flatMap(ids=>[...ids])).size;
    const mother=series?data.byId.get(series.femaleId):null,father=series?data.byId.get(series.maleId):null;
    const mg=genetics(mother),fg=genetics(father),known=mg.every(numeric)&&fg.every(numeric);
    const conditions=!series?'multiple_crosses':!known?'unknown':mg.every(v=>v===mg[0])&&fg.every(v=>v===fg[0])?'same_across_stats':'mixed_across_stats';
    const founderParents=series&&data.generations.get(series.femaleId)===0&&data.generations.get(series.maleId)===0;
    const parentalTotals=[sum(mg),sum(fg)],g0=founderParents&&parentalTotals.every(numeric)?(parentalTotals[0]+parentalTotals[1])/2:null;
    const first=series?results.generations.find(g=>g.generation===1):null,g1=first?.mean??null;
    const bloodValue=p=>typeof p?.lineage==='string'&&p.lineage.trim()&&!/^(unknown|inconnu|inconnue)$/i.test(p.lineage.trim())?p.lineage.trim():null;
    const f=bloodValue(father),m=bloodValue(mother),blood=results.bloodlines;
    const row=(key,label,count)=>({key,label,count,n:blood.n,frequency:blood.n?count/blood.n:null});
    const bloodDisplay=series&&f&&m?(f===m?{mode:'same',note:'La Bloodline parentale est commune : l’origine paternelle ou maternelle est indiscernable.',rows:[row('parental','Bloodline parentale commune — '+f,blood.counts.same),row('other','Autre Bloodline',blood.counts.other+blood.counts.sameOther)]}
      :{mode:'different',note:null,rows:[row('father','Bloodline du père — '+f,blood.counts.father),row('mother','Bloodline de la mère — '+m,blood.counts.mother),row('other','Autre Bloodline',blood.counts.other+blood.counts.sameOther)]})
      :series?{mode:'unknown',note:'Bloodline d’un parent inconnue : comparaison parentale non disponible.',rows:[]}
      :{mode:'history',note:'Plusieurs couples historiques ; aucune Bloodline commune n’est attribuée à un parent.',rows:[row('father','Bloodline du père (parents différents)',blood.counts.father),row('mother','Bloodline de la mère (parents différents)',blood.counts.mother),row('parental','Bloodline parentale commune',blood.counts.same),row('other','Autre Bloodline',blood.counts.other+blood.counts.sameOther)]};
    return {aggregate_distribution:{counts,n,draws,maximum_values_per_draw:7,complete:n===draws*7,parental_conditions:conditions,
        interpretation:'Exploratory pooling of stat values; seven stats are not seven independent births; no common distribution is assumed'},
      parent_comparisons:parentComparisons,aggregate_parent_comparisons:{father:pooled('father'),mother:pooled('mother')},
      generation_comparison:series?{g0,g1,delta:g0!==null&&g1!==null?g1-g0:null,g0_parents:g0===null?0:2,g1_draws:first?.totalCount||0,
        note:founderParents?'G0: mean total of the two founders; G1: mean complete total per reliable G1 event':'G0 unavailable: the two parents are not both identified G0 founders'}:null,
      bloodline_display:bloodDisplay,scope:results.scope};
  }

  // A context computes one result object consumed by both the view and serialization.
  function context(data,{series=null,controlled=Boolean(series),scope='all',generation='all',bound=3,target=20}={}){
    const type=controlled?'controlled_experiment':'global_history';
    let base=controlled?(series?seriesEvents(data,series):[]):data.events;
    if(!controlled&&scope.startsWith('pair:'))base=base.filter(e=>e.key===scope.slice(5));
    if(!series&&scope.startsWith('genes:'))base=base.filter(e=>JSON.stringify([e.maternal,e.paternal])===scope.slice(6));
    // Controlled experiments are never silently narrowed by a historical generation filter.
    const events=!controlled&&generation!=='all'?base.filter(e=>String(e.generation)===generation):base;
    const graphEvents=events.filter(reliableEvent),analysis=analyze(events,bound),capture=captureSummary(events,bound),blood=bloodlines(events);
    const selectedIds=new Set(events.flatMap(e=>e.members.map(r=>r.pet.bt_id)));
    const related=series?data.rows.filter(r=>!selectedIds.has(r.pet.bt_id)&&!series.baselinePetIds?.includes(r.pet.bt_id)&&
      ((!r.fatherId&&r.motherId===series.femaleId)||(!r.motherId&&r.fatherId===series.maleId))):[];
    const inclusion={type,experiment_id:series?.id||null,scope:controlled?(series?'session:'+series.id:'none'):scope,generation:controlled?'all':generation,
      membership:series?'Explicit experiment record ID and matching recorded parental BT_IDs; contradictory captures retained but excluded; reliable linked members share an event':'All historical offspring, including archived animals; optional explicit pair/genetics/generation filters',
      draw_rule:'Deduplicate reliable twin_source or retained controlled event IDs; never deduplicate by genetics or names',
      model_rule:'Two identified parents with numeric child/parent values for the stat; conflicting or unresolved events excluded',
      histogram_rule:'Reliable event identity and parent IDs; valid child value 0-10; conflicting stat excluded',event_ids:events.map(e=>e.drawId)};
    const models=(items,alternative=false)=>{
      const known=items.filter(o=>o.kind!=='unknown'),bad=known.filter(o=>alternative?!o.alternative:o.kind==='neither'),births=new Set(known.map(o=>o.eventId)).size;
      return {observations:known.length,draws:births,contradictions:bad.length,contradicted_event_ids:[...new Set(bad.map(o=>o.eventId))],
        observed_compatibility:known.length?100*(known.length-bad.length)/known.length:null,
        status:bad.length?'contradicted':!known.length?'not_evaluable':'compatible_at_this_stage',sample_status:births<20?'insufficient':'exploratory'};
    };
    const perStat=keys.map((stat,i)=>{
      const obs=analysis.perStat[i],valid=obs.filter(o=>o.kind!=='unknown');
      const range=field=>valid.length?{min:Math.min(...valid.map(o=>o[field])),max:Math.max(...valid.map(o=>o[field])),n:valid.length}:null;
      const bins=histogram(graphEvents,i);
      return {stat,histogram:bins,histogram_draws:bins.reduce((a,b)=>a+b,0),deltas:{father:range('df'),mother:range('dm')},
        model_A:models(obs),model_B:models(obs,true)};
    });
    const quality={uncertain_events:events.filter(e=>!reliableEvent(e)).map(e=>({event_id:e.drawId,individual_bt_ids:e.members.map(r=>r.pet.bt_id),
        reasons:[...new Set([...e.members.flatMap(captureFlags),...(e.sessionConflict?['Plusieurs expériences revendiquent le même événement.']:[])])]})),
      per_stat_exclusions:keys.map((stat,i)=>({stat,excluded:observations(events,i,bound).filter(o=>o.kind==='unknown').map(o=>({event_id:o.eventId,
        reasons:events.find(e=>e.drawId===o.eventId).conflict[i]?['Stats contradictoires dans un groupe gémellaire']:['Parenté, événement ou valeur génétique non exploitable']}))})),
      possible_unassigned:related.map(r=>({bt_id:r.pet.bt_id,known_mother_bt_id:r.pet.mother_bt_id||null,known_father_bt_id:r.pet.father_bt_id||null,
        reason:'Un parent connu correspond au couple ; autre parent absent. Association possible seulement, hors résultats contrôlés.'})),
      recorded_parent_evidence:events.flatMap(e=>e.members.filter(r=>r.parentEvidence==='controlled_record').map(r=>r.pet.bt_id)),
      limits:['Absence de twin_source ne prouve pas une naissance unique. Sans identifiant fiable partagé, des jumeaux peuvent rester non reconnus.',
        'Aucune parenté ni date de naissance n’est déduite des noms, des genetics identiques ou de first_seen.',
        'Les talents Genetics sont supposés constants ; ces résultats ne déterminent pas les probabilités vanilla.']};
    const findings=lessons(events,bound,analysis);
    if(analysis.births&&analysis.births<20)findings.unshift({kind:'Données insuffisantes',text:analysis.births+' tirages analysables : les constats suivants sont descriptifs, sans estimation établie du mécanisme.'});
    const bloodOther=blood.counts.other+blood.counts.sameOther;
    findings.push({kind:'Bloodlines',text:blood.n?bloodOther+' / '+blood.n+' tirages ont une Bloodline différente des deux parents. '+(bloodOther?'L’héritage nécessaire d’une Bloodline parentale est contredit par ces observations.':'Aucun contre-exemple ici ; cela ne prouve pas une transmission limitée aux parents.'):'Bloodlines : données insuffisantes pour comparer les descendants et les deux parents.'});
    const noteworthy=['A','B'].map(model=>{
      const bad=perStat.filter(s=>s['model_'+model].contradictions);
      return bad.length?'Modèle '+model+' contredit pour '+bad.map(s=>names[keys.indexOf(s.stat)]+' ('+s['model_'+model].contradictions+'/'+s['model_'+model].observations+')').join(', ')+'.':null;
    }).filter(Boolean);
    if(noteworthy.length)findings.push({kind:'Stats marquantes',text:noteworthy.join(' ')+' Les fractions indiquent les valeurs impossibles / les valeurs analysables pour chaque stat.'});
    const all=analysis.perStat.flat(),modelTests={A:models(all),B:models(all,true)};
    const summary={type,experiment_id:series?.id||null,species:'Snow_Wolf',status:series?.status|| (series?'running':'historical'),target:series?target:null,
      progression:series?{analysable_draws:capture.analysable,target,objective_reached:capture.analysable>=target}:null,
      sample:capture,inclusion,models:modelTests,findings,notable_stats:perStat,limitations:quality.limits,
      possible_unassigned_count:related.length,open_questions:findings.filter(f=>f.kind==='Questions ouvertes').map(f=>f.text)};
    const results={scope:inclusion,capture,analysis,per_stat:perStat,bloodlines:{...blood,parent_only_hypothesis:{status:bloodOther?'contradicted':blood.n?'compatible_at_this_stage':'not_evaluable',contradictions:bloodOther,n:blood.n}},
      histograms:perStat.map(s=>({stat:s.stat,counts:s.histogram,n:s.histogram_draws})),
      totals:events.map(e=>({event_id:e.drawId,generation:e.generation,...totals(e),reliable:reliableEvent(e),complete:!e.conflict.some(Boolean)&&sum(e.child)!==null})),
      generations:generationSummary(graphEvents,bound),quality,lessons:findings,model_tests:modelTests};
    results.descriptive=descriptiveResults(data,series,results,graphEvents);
    return {type,experiment_id:series?.id||null,inclusion,events,graphEvents,results,summary};
  }
  return Object.freeze({context,captureFlags,reliableEvent,captureSummary,bloodlines,lessons,keys,names,numeric,genetics,sum,pairKey,clamp,variations,same,possible,classify,collect,fit,analyze,observations,histogram,totals,generationSummary,seriesEvents,recommend});
})();
