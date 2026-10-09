'use strict';

// P1: possible outcomes, empirical counts and an explicit experimental protocol.
const BreedingMath = (()=>{
  const vigor=p=>typeof p?.genetics?.[0]==='number'&&Number.isFinite(p.genetics[0])?p.genetics[0]:null;
  const pairKey=(female,male)=>JSON.stringify([female,male]);
  const clamp=v=>Math.max(0,Math.min(10,v));
  function possible(female,male,model){
    const bases=model==='A'?[female,male]:[Math.round((female+male)/2)];
    return new Set(bases.flatMap(base=>Array.from({length:7},(_,i)=>clamp(base+i-3))));
  }
  function collect(pets,normalizeSpecies,validId){
    const wolves=pets.filter(p=>normalizeSpecies(p.species_key||p.actor_class)==='Snow_Wolf'
      &&['ACTIVE','ARCHIVED'].includes(p.lifecycle_state)&&validId(p.bt_id));
    const byId=new Map(wolves.map(p=>[p.bt_id,p]));
    function drawId(p){
      const path=new Set();let id=p.bt_id;
      while(byId.has(id)&&validId(byId.get(id).twin_source)){
        if(path.has(id))return [...path].sort()[0];
        path.add(id);id=byId.get(id).twin_source;
      }
      return id;
    }
    const rows=wolves.filter(p=>p.mother_bt_id||p.father_bt_id||p.mother||p.father).map(p=>{
      const mother=byId.get(validId(p.mother_bt_id)),father=byId.get(validId(p.father_bt_id));
      const value=vigor(p),female=vigor(mother),male=vigor(father);
      const reliable=Boolean(mother&&father&&mother!==father&&value!==null&&female!==null&&male!==null);
      return {pet:p,drawId:drawId(p),key:pairKey(p.mother_bt_id,p.father_bt_id),value,female,male,reliable};
    });
    const groups=new Map();
    for(const row of rows.filter(r=>r.reliable)){
      if(!groups.has(row.drawId))groups.set(row.drawId,[]);
      groups.get(row.drawId).push(row);
    }
    const draws=[],conflicts=new Set();
    for(const [id,members] of groups){
      const first=members[0];
      if(members.some(r=>r.key!==first.key||r.value!==first.value)){
        conflicts.add(id);continue;
      }
      draws.push({...first,members});
    }
    const breeders=wolves.filter(p=>p.lifecycle_state==='ACTIVE'&&!p.historical&&p.stage==='adult'
      &&['Female','Male'].includes(p.sex)&&vigor(p)!==null);
    return {rows,draws,conflicts,breeders,excluded:rows.filter(r=>!r.reliable||conflicts.has(r.drawId)).length};
  }
  function analyze(draws){
    const histogram=Array(11).fill(0);
    for(const d of draws)if(Number.isInteger(d.value)&&d.value>=0&&d.value<=10)histogram[d.value]++;
    const models=['A','B'].map(model=>{
      const incompatible=draws.filter(d=>!possible(d.female,d.male,model).has(d.value));
      return {model,compatible:draws.length-incompatible.length,incompatible};
    });
    const origins={femaleOnly:0,maleOnly:0,ambiguous:0,neither:0};
    for(const d of draws){
      const f=possible(d.female,d.female,'A').has(d.value),m=possible(d.male,d.male,'A').has(d.value);
      origins[f&&m?'ambiguous':f?'femaleOnly':m?'maleOnly':'neither']++;
    }
    return {count:draws.length,histogram,models,origins};
  }
  function seriesDraws(data,series){
    const baseline=new Set(series.baselineIds),roots=new Set(series.baselineDraws);
    return data.draws.filter(d=>d.key===pairKey(series.femaleId,series.maleId)
      &&!roots.has(d.drawId)&&!d.members.some(r=>baseline.has(r.pet.bt_id)));
  }
  function recommend(data,target){
    const totals=analyze(data.draws);
    const surviving=totals.models.filter(m=>!m.incompatible.length).map(m=>m.model);
    const history=(f,m)=>data.draws.filter(d=>d.female===f&&d.male===m);
    const parent=(sex,v)=>data.breeders.filter(p=>p.sex===sex&&vigor(p)===v)
      .sort((a,b)=>a.bt_id.localeCompare(b.bt_id,'en',{numeric:true}))[0]||null;
    function candidate(f,m,kind){
      const female=parent('Female',f),male=parent('Male',m),count=history(f,m).length;
      const a=possible(f,m,'A'),b=possible(f,m,'B');
      const distinction=surviving.length===2?[...new Set([...a,...b])].filter(v=>a.has(v)!==b.has(v)).length:0;
      return {femaleV:f,maleV:m,female,male,count,kind,distinction,available:Number(Boolean(female))+Number(Boolean(male))};
    }
    const initial=candidate(8,2,'initial');
    if(initial.count<target&&!totals.models.some(m=>m.incompatible.length)){
      initial.reason=initial.count?'Répéter ♀ V8 × ♂ V2 : les observations historiques restent insuffisantes.'
        :'Commencer par ♀ V8 × ♂ V2 : les valeurs extrêmes peuvent distinguer les deux modèles.';
      return initial;
    }
    const candidates=[candidate(5,5,'variation'),candidate(2,8,'reverse'),initial];
    if(totals.models.some(m=>m.incompatible.length)||candidates.every(c=>c.count>=target)){
      for(let f=0;f<=10;f++)for(let m=0;m<=10;m++){
        if(!candidates.some(c=>c.femaleV===f&&c.maleV===m))candidates.push(candidate(f,m,'other'));
      }
    }
    const next=candidates.filter(c=>c.count<target).sort((a,b)=>
      b.distinction-a.distinction||b.available-a.available||
      (surviving.length<2?Number(b.kind==='variation')-Number(a.kind==='variation'):0)||
      a.count-b.count||Math.abs(a.femaleV-5)+Math.abs(a.maleV-5)-Math.abs(b.femaleV-5)-Math.abs(b.maleV-5))[0];
    if(!next)return null;
    next.reason=next.kind==='variation'?'V5 × V5 isole la variation : les deux parents ont la même valeur et les bornes ne masquent pas une variation de ±3.'
      :next.kind==='reverse'?'Inverser les sexes (♀ V2 × ♂ V8) permet de comparer les fréquences avec ♀ V8 × ♂ V2 et de chercher un effet lié au sexe parental.'
      :next.kind==='initial'?'Répéter ♀ V8 × ♂ V2 pour compléter les observations insuffisantes.'
      :'Cette combinaison apporte des observations nouvelles après contradiction ou saturation des couples du protocole.';
    if(next.distinction)next.reason+=' Ses valeurs possibles distinguent les modèles encore compatibles ; aucun tirage discriminant n’est garanti.';
    next.reason+=' Les couples déjà suffisamment documentés sont écartés ; la disponibilité départage les expériences aussi discriminantes.';
    return next;
  }
  return Object.freeze({vigor,pairKey,possible,collect,analyze,seriesDraws,recommend});
})();
