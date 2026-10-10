'use strict';
// Candidate hypotheses are data. This parser never executes JavaScript source.
const GeneticHypotheses=(()=>{
  const keys=['V','F','P','R','T','A','I'];
  const funcs={abs:[1,Math.abs],round:[1,Math.round],floor:[1,Math.floor],ceil:[1,Math.ceil],sqrt:[1,Math.sqrt],exp:[1,Math.exp],log:[1,Math.log],min:[2,Math.min],max:[2,Math.max],pow:[2,Math.pow]};
  const variables=['S','delta','B','m_i','mother_i','father_i','gap_i','mother_total','father_total','mu_i','x_i'];
  const copy=x=>JSON.parse(JSON.stringify(x));
  const initial=()=>({format:'BreedingHypothesis',schema_version:1,id:'D',name:'Hypothèse D',version:'1',formulas:{budget:'min(Bmax, round(S) + delta)',projectionBudget:'min(Bmax, S * (1 + alpha/100))',target:'B/7 + beta*(m_i - S/7)',weight:'exp(-((x_i-mu_i)^2)/(2*sigma^2))'},parameters:{alpha:0.4,Bmax:60,beta:0.9,sigma:2.47},budgetKnowledge:'mean',meanBudgetRounding:'unknown',budgetLaw:[{delta:0,probability:1}]});
  function expression(source,allowed,assignment){
    if(typeof source!=='string'||!source.trim()||source.length>1000)throw new Error('Formule vide ou trop longue (maximum 1000 caractères).');
    source=source.trim().replace(new RegExp('^'+assignment+'\\s*=\\s*'),'');
    const tokens=[];let pos=0;
    while(pos<source.length){if(/\s/.test(source[pos])){pos++;continue}const match=/^(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[+\-*/^(),])/.exec(source.slice(pos));if(!match)throw new Error('Symbole non pris en charge à la position '+(pos+1)+'.');tokens.push(match[0]);pos+=match[0].length;if(tokens.length>256)throw new Error('Formule trop complexe (256 éléments maximum).')}
    let at=0;const peek=()=>tokens[at],take=()=>tokens[at++];
    function primary(){
      const t=take();if(t===undefined)throw new Error('Expression incomplète.');
      if(t==='('){const node=add();if(take()!==')')throw new Error('Parenthèse fermante attendue.');return node}
      if(/^(?:\d|\.)/.test(t)){const n=Number(t);if(!Number.isFinite(n))throw new Error('Constante non finie.');return ()=>n}
      if(/^[A-Za-z_]/.test(t)){
        if(peek()==='('){if(!Object.hasOwn(funcs,t))throw new Error('Fonction non prise en charge : '+t);take();const args=[];if(peek()!==')'){args.push(add());while(peek()===','){take();args.push(add())}}if(take()!==')'||args.length!==funcs[t][0])throw new Error(t+' attend '+funcs[t][0]+' argument(s).');return env=>funcs[t][1](...args.map(a=>a(env)))}
        if(!allowed.has(t))throw new Error('Variable ou paramètre non déclaré : '+t);return env=>env[t];
      }
      throw new Error('Élément inattendu : '+t);
    }
    function power(){const a=primary();if(peek()==='^'){take();const b=unary();return env=>a(env)**b(env)}return a}
    function unary(){if(peek()==='+'||peek()==='-'){const sign=take()==='-'?-1:1,a=unary();return env=>sign*a(env)}return power()}
    function multiply(){let a=unary();while(peek()==='*'||peek()==='/'){const op=take(),left=a,right=unary();a=env=>op==='*'?left(env)*right(env):left(env)/right(env)}return a}
    function add(){let a=multiply();while(peek()==='+'||peek()==='-'){const op=take(),left=a,right=multiply();a=env=>op==='+'?left(env)+right(env):left(env)-right(env)}return a}
    const tree=add();if(at!==tokens.length)throw new Error('Élément inattendu : '+peek());return env=>{const result=tree(env);if(!Number.isFinite(result))throw new Error('La formule produit une valeur non finie (division par zéro ou domaine invalide).');return result};
  }
  function definition(input){
    if(!input||input.format!=='BreedingHypothesis'||input.schema_version!==1)throw new Error('Définition BreedingHypothesis v1 attendue.');
    if(typeof input.id!=='string'||!input.id||typeof input.name!=='string'||!input.name.trim()||typeof input.version!=='string')throw new Error('Identifiant, nom et version requis.');
    if(!input.parameters||Array.isArray(input.parameters)||typeof input.parameters!=='object')throw new Error('Paramètres : objet JSON de nombres attendu.');
    for(const [key,v] of Object.entries(input.parameters))if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(key)||variables.includes(key)||Object.hasOwn(funcs,key)||['__proto__','constructor','prototype'].includes(key)||typeof v!=='number'||!Number.isFinite(v))throw new Error('Paramètre invalide ou réservé : '+key);
    if(Object.keys(input.parameters).length>30)throw new Error('Maximum 30 paramètres.');
    const f=input.formulas;if(!f||['budget','target','weight'].some(k=>typeof f[k]!=='string'))throw new Error('Trois formules requises.');
    if(f.projectionBudget!==undefined&&typeof f.projectionBudget!=='string')throw new Error('Formule de projection : expression textuelle requise.');
    const law=input.budgetLaw;if(!Array.isArray(law)||!law.length||law.length>71||law.some(p=>typeof p.delta!=='number'||!Number.isFinite(p.delta)||typeof p.probability!=='number'||!Number.isFinite(p.probability)||p.probability<0)||Math.abs(law.reduce((n,p)=>n+p.probability,0)-1)>1e-9)throw new Error('Loi de delta : 1 à 71 valeurs, poids positifs ou nuls totalisant 1.');
    if(input.budgetKnowledge!==undefined&&!['mean','law'].includes(input.budgetKnowledge))throw new Error('Connaissance du budget invalide.');
    if(input.meanBudgetRounding!==undefined&&!['unknown','round','floor','ceil','identity'].includes(input.meanBudgetRounding))throw new Error('Arrondi du budget moyen invalide.');
    if(input.parameters.alpha!==undefined&&input.parameters.alpha<0)throw new Error('alpha doit être positif ou nul pour la candidate à bonus non négatif.');
    if(input.parameters.Bmax!==undefined&&(!Number.isInteger(input.parameters.Bmax)||input.parameters.Bmax<0||input.parameters.Bmax>70))throw new Error('Bmax doit être un entier entre 0 et 70.');
    // Whitelist the portable definition: neither credentials nor account state belong here.
    return {format:input.format,schema_version:1,id:input.id,name:input.name.trim(),version:input.version,formulas:{budget:f.budget,projectionBudget:typeof f.projectionBudget==='string'?f.projectionBudget:(!/\bdelta\b/.test(f.budget)?f.budget:'min(Bmax, S * (1 + alpha/100))'),target:f.target,weight:f.weight},parameters:{...input.parameters},budgetKnowledge:input.budgetKnowledge||'mean',meanBudgetRounding:input.meanBudgetRounding||'unknown',budgetLaw:law.map(p=>({delta:p.delta,probability:p.probability}))};
  }
  function compile(input){const d=definition(input),params=Object.keys(d.parameters),base=['S','mother_total','father_total'];return {definition:d,
    budget:env=>expression(d.formulas.budget,new Set([...base,'delta',...params]),'B')(env),
    projectionBudget:expression(d.formulas.projectionBudget,new Set([...base,...params]),'B'),
    target:expression(d.formulas.target,new Set([...base,'B','m_i','mother_i','father_i','gap_i',...params]),'mu_i'),
    weight:expression(d.formulas.weight,new Set([...base,'B','m_i','mother_i','father_i','gap_i','mu_i','x_i',...params]),'weight_i')};}
  function environment(compiled,mother,father){
    if(![mother,father].every(g=>Array.isArray(g)&&g.length===7&&g.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10)))throw Object.assign(new Error('Sept valeurs parentales connues entre 0 et 10 requises.'),{kind:'data'});
    const mother_total=mother.reduce((a,b)=>a+b,0),father_total=father.reduce((a,b)=>a+b,0);
    return {...compiled.definition.parameters,mother_total,father_total,S:(mother_total+father_total)/2};
  }
  function conditional(compiled,mother,father,B){
    if(!Number.isInteger(B)||B<0||B>70)throw new Error('Budget impossible : entier de 0 à 70 requis.');
    const base={...environment(compiled,mother,father),B},mu=[],weights=[];
    for(let i=0;i<7;i++){
      const env={...base,mother_i:mother[i],father_i:father[i],m_i:(mother[i]+father[i])/2,gap_i:Math.abs(mother[i]-father[i])};
      const target=compiled.target(env);mu.push(target);
      const row=Array.from({length:11},(_,x_i)=>compiled.weight({...env,mu_i:target,x_i}));
      if(row.some(x=>x<0)||Math.max(...row)===0)throw new Error('Poids négatifs ou tous nuls : distribution non définie.');
      const max=Math.max(...row);weights.push(row.map(w=>w/max));
    }
    // Independent weight scales cancel conditionally. Renormalizing each convolution
    // keeps the DP stable without changing the joint law product(w_i), sum(x_i)=B.
    const unit=()=>{const a=Array(B+1).fill(0);a[0]=1;return a};
    function convolve(a,w){const r=Array(B+1).fill(0);for(let s=0;s<=B;s++)for(let v=0;v<=10&&v<=s;v++)r[s]+=a[s-v]*w[v];const max=Math.max(...r);return max?r.map(x=>x/max):r}
    const prefix=[unit()],suffix=Array(8);suffix[7]=unit();
    for(let i=0;i<7;i++)prefix.push(convolve(prefix[i],weights[i]));
    for(let i=6;i>=0;i--)suffix[i]=convolve(suffix[i+1],weights[i]);
    if(!(prefix[7][B]>0))throw new Error('Aucun vecteur admissible de poids numérique non nul pour ce budget.');
    const marginals=weights.map((w,i)=>{
      const row=w.map((weight,v)=>{let mass=0;for(let s=0;s<=B-v;s++)mass+=prefix[i][s]*suffix[i+1][B-v-s];return weight*mass});
      const z=row.reduce((a,b)=>a+b,0);if(!z)throw new Error('Normalisation numérique impossible.');return row.map(x=>x/z);
    });
    return {budget:B,mu,marginals,means:marginals.map(row=>row.reduce((a,p,v)=>a+v*p,0))};
  }
  function predicted(compiled,mother,father){
    const env=environment(compiled,mother,father),parts=compiled.definition.budgetLaw.filter(p=>p.probability>0).map(p=>({probability:p.probability,result:conditional(compiled,mother,father,Math.min(env.Bmax??70,compiled.budget({...env,delta:p.delta})))}));
    const mix=fn=>parts.reduce((n,p)=>n+p.probability*fn(p.result),0);
    return {budget:mix(p=>p.budget),mu:keys.map((_,i)=>mix(p=>p.mu[i])),means:keys.map((_,i)=>mix(p=>p.means[i])),marginals:keys.map((_,i)=>Array.from({length:11},(_,v)=>mix(p=>p.marginals[i][v])))};
  }
  function compare(ctx,compiled,mode='observed'){
    if(!['observed','predicted','partial'].includes(mode))throw new Error('Mode de budget inconnu.');
    const rows=keys.map(stat=>({stat,n:0,observedSum:0,predictedN:0,predictedSum:0,muSum:0})),cache=new Map(),issues=[];let predictedEvents=0;
    for(const e of ctx.graphEvents){
      let result;
      const full=e.child.every(v=>Number.isInteger(v)&&v>=0&&v<=10)&&!e.conflict.some(Boolean);
      if(mode==='partial'){}
      else if(mode==='observed'&&!full)issues.push({event_id:e.drawId,kind:'data',reason:'Budget observé incomplet ou contradictoire.'});
      else try{const B=mode==='observed'?e.child.reduce((a,b)=>a+b,0):null,key=JSON.stringify([e.maternal,e.paternal,B]);if(!cache.has(key))cache.set(key,mode==='observed'?conditional(compiled,e.maternal,e.paternal,B):predicted(compiled,e.maternal,e.paternal));result=cache.get(key);predictedEvents++}
      catch(error){issues.push({event_id:e.drawId,kind:error.kind||'formula',reason:error.message})}
      rows.forEach((r,i)=>{if(e.conflict[i]||!Number.isInteger(e.child[i])||e.child[i]<0||e.child[i]>10)return;r.n++;r.observedSum+=e.child[i];if(result){r.predictedN++;r.predictedSum+=result.means[i];r.muSum+=result.mu[i]}});
    }
    rows.forEach(r=>{r.observed=r.n?r.observedSum/r.n:null;r.predicted=r.predictedN?r.predictedSum/r.predictedN:null;r.mu=r.predictedN?r.muSum/r.predictedN:null;r.difference=r.n===r.predictedN&&r.n?r.observed-r.predicted:null});
    const comparable=rows.filter(r=>r.difference!==null),sameSample=comparable.length===7;
    return {mode,rows,events:ctx.graphEvents.length,predictedEvents,issues,mae:sameSample?comparable.reduce((n,r)=>n+Math.abs(r.difference),0)/7:null,rmse:sameSample?Math.sqrt(comparable.reduce((n,r)=>n+r.difference**2,0)/7):null};
  }

  // The mean-only budget candidate has no implied delta probability law.
  function budgetMean(compiled,mother,father){
    const env=environment(compiled,mother,father),{S,alpha,Bmax}=env;
    if(!Number.isFinite(alpha)||!Number.isFinite(Bmax))throw Object.assign(new Error('alpha et Bmax requis pour évaluer le budget moyen.'),{kind:'data'});
    const rawMean=alpha/100*S,rounding=compiled.definition.meanBudgetRounding;
    const base=rounding==='identity'?S:rounding==='unknown'?null:Math[rounding](S);
    // At an integer cap, ordinary rounding preserves S=Bmax. This conclusion
    // is explicitly conditional on that rounding property and a nonnegative bonus.
    const saturated=base!==null?base>=Bmax:S===Bmax;
    const exactMean=saturated?Bmax:alpha===0&&base!==null?Math.min(Bmax,base):null;
    let lawMean=null,lawRawMean=null;
    if(compiled.definition.budgetKnowledge==='law'){
      lawMean=0;lawRawMean=0;
      for(const p of compiled.definition.budgetLaw){if(!p.probability)continue;const B=Math.min(Bmax,compiled.budget({...env,delta:p.delta}));if(!Number.isInteger(B)||B<0||B>70)throw new Error('La loi plafonnée doit produire des budgets entiers de 0 à 70.');lawMean+=p.probability*B;lawRawMean+=p.probability*p.delta}
    }
    return {S,alpha,Bmax,rawMean,rounding,base,uncappedMean:base===null?null:base+rawMean,finalMean:exactMean,saturated,lawMean,lawRawMean};
  }
  function budgetComparison(ctx,compiled){
    const groups=new Map(),issues=[];let skipped=0;
    for(const e of ctx.graphEvents){
      if(e.conflict.some(Boolean)||!e.child.every(v=>Number.isInteger(v)&&v>=0&&v<=10)){skipped++;continue}
      try{const b=budgetMean(compiled,e.maternal,e.paternal),key=JSON.stringify([b.S,b.Bmax]);if(!groups.has(key))groups.set(key,{...b,n:0,observedSum:0});const g=groups.get(key);g.n++;g.observedSum+=e.child.reduce((a,b)=>a+b,0)}catch(error){skipped++;issues.push({event_id:e.drawId,reason:error.message})}
    }
    return {groups:[...groups.values()].sort((a,b)=>a.S-b.S).map(g=>({...g,observedMean:g.observedSum/g.n})),skipped,issues};
  }


  // Parent-only projection. Fractional budgets use a numerical interpolation,
  // never an inferred delta probability law or an observed offspring budget.
  function projectMean({mother,father},compiled){
    const env=environment(compiled,mother,father),rawBudget=compiled.projectionBudget(env),budget=Math.min(env.Bmax??70,rawBudget);
    if(budget<0||budget>70||!Number.isFinite(budget))throw new Error('Budget théorique impossible : moyenne entre 0 et 70 requise.');
    const low=Math.floor(budget),high=Math.ceil(budget),fraction=budget-low;
    const a=conditional(compiled,mother,father,low),b=high===low?a:conditional(compiled,mother,father,high);
    const mix=(x,y)=>(1-fraction)*x+fraction*y;
    return {S:env.S,rawBudget,budget,low,high,fraction,means:a.means.map((v,i)=>mix(v,b.means[i])),
      marginals:a.marginals.map((row,i)=>row.map((v,j)=>mix(v,b.marginals[i][j]))),
      mu:a.mu.map((v,i)=>mix(v,b.mu[i]))};
  }
  function averageObservedOffspring(events){
    return keys.map((stat,i)=>{const values=events.filter(e=>!e.conflict[i]&&Number.isInteger(e.child[i])&&e.child[i]>=0&&e.child[i]<=10).map(e=>e.child[i]);return {stat,n:values.length,observed:values.length?values.reduce((a,b)=>a+b,0)/values.length:null}});
  }

  return Object.freeze({initial,definition,compile,expression,conditional,predicted,compare,budgetMean,budgetComparison,projectMean,averageObservedOffspring,copy,keys});
})();



// One canonical parameter object; draft JSON is its editable representation.
const HypothesisLab=(()=>{
  const H=GeneticHypotheses,storageKey='breeding-advisor-hypothesis-lab-v3',previousKey='breeding-advisor-hypothesis-lab-v2',legacyKey='breeding-advisor-hypothesis-lab-v1',escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let migrationMessage='',storageMessage='',storageBlocked=false;
  function upgrade(raw,legacy){
    const parameters={...raw.parameters};
    for(const [key,oldKey,fallback] of [['alpha','bonus',0.4],['Bmax','cap',60]]){
      if(parameters[key]===undefined)parameters[key]=legacy?.[oldKey]??fallback;
      else if(legacy?.[oldKey]!==undefined&&parameters[key]!==legacy[oldKey])migrationMessage+=' Conflit '+key+' : valeur du paramètre '+parameters[key]+' conservée ; ancienne valeur annexe '+legacy[oldKey]+' conservée dans l’original v4.2.1.';
    }
    const projectionBudget=raw.formulas.projectionBudget??(!/\bdelta\b/.test(raw.formulas.budget)?raw.formulas.budget:'min(Bmax, S * (1 + alpha/100))');
    const d={...raw,parameters,formulas:{...raw.formulas,projectionBudget},budgetKnowledge:raw.budgetKnowledge||legacy?.source||'mean',meanBudgetRounding:raw.meanBudgetRounding||'unknown'};H.compile(d);return H.definition(d);
  }
  let library={version:3,selectedId:'D',mode:'observed',profiles:[{definition:H.initial(),history:[]}]};
  try{
    const text=localStorage.getItem(storageKey),legacy=text===null?(localStorage.getItem(previousKey)??localStorage.getItem(legacyKey)):null,saved=JSON.parse(text??legacy);
    if(saved){
      if(![1,2,3].includes(saved.version)||!Array.isArray(saved.profiles)||!saved.profiles.length)throw new Error('Format de bibliothèque non pris en charge.');
      const migrated=saved.version<3;
      const profiles=saved.profiles.map(p=>{if(!Array.isArray(p.history))throw new Error('Historique invalide.');const definition=migrated?upgrade(p.definition,p.budgetAssumption):H.definition(p.definition),history=p.history.map((h,i)=>migrated?upgrade(h,p.assumptionHistory?.[i]):H.definition(h));H.compile(definition);history.forEach(H.compile);return {definition,history}});
      if(new Set(profiles.map(p=>p.definition.id)).size!==profiles.length)throw new Error('Identifiants dupliqués.');
      library={version:3,selectedId:profiles.some(p=>p.definition.id===saved.selectedId)?saved.selectedId:profiles[0].definition.id,mode:['observed','predicted'].includes(saved.mode)?saved.mode:'observed',profiles};
      if(migrated)migrationMessage='Configurations précédentes conservées dans leur bibliothèque originale. La formule A active est projectionBudget, sans delta. Les anciennes formules Budget et lois de delta restent archivées dans chaque définition. Une ancienne formule sans delta est reprise telle quelle ; sinon la projection moyenne possède sa propre formule explicite. Target, Weight, paramètres et historiques sont conservés. '+migrationMessage;
    }
  }catch(error){storageMessage='Bibliothèque non chargée : '+error.message+' Stockage existant conservé ; export JSON disponible.';storageBlocked=true}
  const drafts=new Map();let currentContext=null,currentParents=null,average=null,panel=null,timer=null,errorMessage='',notice='',advancedOpen=false;
  const selected=()=>library.profiles.find(p=>p.definition.id===library.selectedId);
  const fromDefinition=d=>({name:d.name,version:d.version,budget:d.formulas.projectionBudget,target:d.formulas.target,weight:d.formulas.weight,parameters:JSON.stringify(d.parameters,null,2),budgetLaw:JSON.stringify(d.budgetLaw,null,2),budgetKnowledge:d.budgetKnowledge,meanBudgetRounding:d.meanBudgetRounding});
  function draft(){if(!drafts.has(library.selectedId))drafts.set(library.selectedId,fromDefinition(selected().definition));return drafts.get(library.selectedId)}
  function saveLibrary(){if(storageBlocked)return false;try{localStorage.setItem(storageKey,JSON.stringify(library));storageMessage='';return true}catch{storageMessage='Stockage local indisponible : exporter avant de fermer la page.';return false}}
  function working(){const d=draft();return H.compile({...selected().definition,name:d.name,version:d.version,formulas:{...selected().definition.formulas,projectionBudget:d.budget,target:d.target,weight:d.weight},parameters:JSON.parse(d.parameters),budgetLaw:JSON.parse(d.budgetLaw),budgetKnowledge:d.budgetKnowledge,meanBudgetRounding:d.meanBudgetRounding})}
  function syncState(){
    const status=panel?.querySelector('[data-hyp-save-state]');if(!status)return;
    let dirty=true,invalid='';try{dirty=JSON.stringify(working().definition)!==JSON.stringify(selected().definition)}catch(error){invalid=error.message}
    status.textContent=invalid||errorMessage?'Configuration invalide':dirty?'Modifications non enregistrées':'Enregistré';
    if(storageMessage)status.textContent+=' — '+storageMessage;
    panel.querySelector('[data-hyp-save]').disabled=!dirty;
  }
  function usage(key){
    const d=draft(),used=['budget','target','weight'].filter(f=>(d[f].match(/[A-Za-z_][A-Za-z_0-9]*/g)||[]).includes(key)),names={budget:'Budget théorique',target:'Target',weight:'Weight'};
    const notes=used.length?['Formules : '+used.map(f=>names[f]).join(', ')]:[];
    if(key==='Bmax')notes.push('contrainte finale du budget théorique ; jamais du budget observé');
    if(!notes.length)notes.push('Non utilisé dans les formules actives : aucun effet sur la projection');
    return notes.join(' · ');
  }
  function syncUsage(){panel?.querySelectorAll('[data-hyp-usage]').forEach(el=>{el.textContent=usage(el.dataset.hypUsage)})}
  function renderParameters(){
    const host=panel.querySelector('[data-hyp-parameters]');let params;
    try{params=JSON.parse(draft().parameters);if(!params||Array.isArray(params)||typeof params!=='object')throw Error('Objet numérique attendu.')}catch{host.innerHTML='<p class="experiment-warning">Paramètres JSON invalides : corriger les options avancées. Aucun contrôle numérique périmé n’est conservé.</p>';return}
    const labels={alpha:'α — Bonus génétique moyen (%)',Bmax:'Bmax — Plafond génétique',beta:'β — Influence parentale',sigma:'σ — Dispersion'};
    const number=key=>'<label>'+escape(labels[key]||key)+'<input type="number" step="any" data-hyp-primary="'+escape(key)+'" value="'+escape(typeof params[key]==='number'?params[key]:'')+'"><small data-hyp-usage="'+escape(key)+'"></small></label>';
    const group=(title,keys)=>keys.length?'<h3>'+title+'</h3><div class="hyp-primary">'+keys.map(number).join('')+'</div>':'';
    const keys=Object.keys(params);host.innerHTML=group('Budget de l’enfant',keys.filter(k=>['alpha','Bmax'].includes(k)))+group('Distribution des stats',keys.filter(k=>['beta','sigma'].includes(k)))+group('Autres variables du modèle',keys.filter(k=>!['alpha','Bmax','beta','sigma'].includes(k)));
    host.querySelectorAll('[data-hyp-primary]').forEach(input=>input.addEventListener('input',()=>{const params=JSON.parse(draft().parameters);params[input.dataset.hypPrimary]=input.value===''?null:Number(input.value);draft().parameters=JSON.stringify(params,null,2);panel.querySelector('[data-hyp-field="parameters"]').value=draft().parameters;preview()}));syncUsage();
  }

  function renderChart(){
    if(!average?.isConnected||!currentContext)return;
    const observed=H.averageObservedOffspring(currentContext.graphEvents);let compiled=null,theoretical=null,unavailable='';errorMessage='';
    try{compiled=working();if(!currentParents)unavailable='Sélectionner deux parents identifiés pour calculer la projection.';else theoretical=H.projectMean(currentParents,compiled)}
    catch(error){if(error.kind==='data')unavailable=error.message;else errorMessage='Configuration invalide : '+error.message}
    const rows=observed.map((o,i)=>({...o,predicted:theoretical?.means[i]??null,difference:theoretical&&o.observed!==null?o.observed-theoretical.means[i]:null}));
    const comparable=rows.every(r=>r.difference!==null),mae=comparable?rows.reduce((s,r)=>s+Math.abs(r.difference),0)/7:null,rmse=comparable?Math.sqrt(rows.reduce((s,r)=>s+r.difference**2,0)/7):null;
    const num=v=>v===null?'—':v.toFixed(2),budget=v=>v.toLocaleString('fr-FR',{maximumFractionDigits:6}),compact=window.matchMedia('(max-width:640px)').matches;
    const groups=rows.map((r,i)=>{
      const x=compact?42+i*42:70+i*88,width=compact?16:25,offset=compact?18:29;
      const tip=H.keys[i]+' — Observed Mean : '+num(r.observed)+' (n='+r.n+'); Predicted Mean : '+num(r.predicted)+' (parents uniquement); observé − prédit : '+num(r.difference);
      return '<g><title>'+escape(tip)+'</title>'+(r.observed===null?'':'<rect class="hyp-observed" x="'+x+'" y="'+(245-20*r.observed)+'" width="'+width+'" height="'+20*r.observed+'"/>')+(r.predicted===null?'':'<rect class="hyp-predicted" x="'+(x+offset)+'" y="'+(245-20*r.predicted)+'" width="'+width+'" height="'+20*r.predicted+'"/>')+'<text class="hyp-observed-label" x="'+(x+width/2)+'" y="'+(compact?288:237-20*(r.observed??0))+'" text-anchor="middle">'+num(r.observed)+'</text><text class="hyp-predicted-label" x="'+(x+offset+width/2)+'" y="'+(compact?305:237-20*(r.predicted??0))+'" text-anchor="middle">'+num(r.predicted)+'</text><text x="'+(x+(offset+width)/2)+'" y="270" text-anchor="middle">'+r.stat+'</text></g>';
    }).join('');
    const d=compiled?.definition,parents=currentParents;
    average.innerHTML='<h3>Average Offspring — Individu moyen</h3><p class="hyp-legend"><span>■ Observed Mean — réel</span><span>■ Predicted Mean — projection des parents</span></p>'+(d?'<p>'+escape(d.name)+' · v'+escape(d.version)+' · '+escape(Object.entries(d.parameters).map(([k,v])=>k+'='+v).join(', '))+'</p>':'')+(parents?'<p>Couple projeté : ♀ '+escape(parents.motherName||'Inconnu')+' — '+escape(parents.motherId||'BT_ID inconnu')+'<br>♂ '+escape(parents.fatherName||'Inconnu')+' — '+escape(parents.fatherId||'BT_ID inconnu')+'</p>':'')+(theoretical?'<p class="hyp-budget-summary"><strong>Budget théorique : '+budget(theoretical.budget)+'</strong> · S = '+budget(theoretical.S)+' · '+(theoretical.low===theoretical.high?'budget entier '+theoretical.low:'interpolation '+theoretical.low+' / '+theoretical.high+' ; fraction '+budget(theoretical.fraction))+'.</p><p class="small">Convention numérique de projection, pas une loi de delta du jeu. Aucun budget ni aucune stat des descendants ne détermine les barres orange.</p>':'')+(observed.every(o=>o.n===0)?'<p>En attente des premières naissances.</p>':'<p>'+currentContext.graphEvents.length+' tirages fiables dans ce périmètre ; effectif exploitable propre à chaque stat.</p>')+(unavailable?'<p class="experiment-warning">Projection indisponible : '+escape(unavailable)+'</p>':'')+(errorMessage?'<p class="experiment-warning">'+escape(errorMessage)+' Les barres orange sont retirées jusqu’à correction ; aucune ancienne prédiction n’est affichée.</p>':'')+'<svg viewBox="0 0 '+(compact?'350 320':'720 285')+'" role="img" aria-label="Moyennes réelles en vert, projection parentale en orange, axe 0 à 10">'+[0,2,4,6,8,10].map(v=>'<line x1="'+(compact?32:48)+'" x2="'+(compact?340:705)+'" y1="'+(245-v*20)+'" y2="'+(245-v*20)+'"/><text x="'+(compact?25:35)+'" y="'+(249-v*20)+'" text-anchor="end">'+v+'</text>').join('')+groups+'</svg><p>Erreurs descriptives sur les sept moyennes : MAE <strong>'+num(mae)+'</strong> · RMSE <strong>'+num(rmse)+'</strong>. Elles ne valident pas la distribution ni le mécanisme. Aucun ajustement automatique.</p><details><summary>Valeurs et effectifs par stat</summary><div class="experiment-table-scroll"><table class="experiment-table"><thead><tr><th>Stat</th><th>Observed Mean / n</th><th>Predicted Mean (parents)</th><th>Observé − prédit</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+r.stat+'</td><td>'+num(r.observed)+' / '+r.n+'</td><td>'+num(r.predicted)+'</td><td>'+num(r.difference)+'</td></tr>').join('')+'</tbody></table></div></details>'+(d?'<details><summary>Configuration active de projection</summary><pre>'+escape(JSON.stringify({name:d.name,version:d.version,parameters:d.parameters,formulas:{projectionBudget:d.formulas.projectionBudget,target:d.formulas.target,weight:d.formulas.weight}},null,2))+'</pre></details>':'');
    const status=panel?.querySelector('[data-hyp-status]');if(status)status.textContent=[errorMessage,notice,storageMessage].filter(Boolean).join(' ');syncUsage();syncState();
    const label=panel?.querySelector('[data-hyp-select] option:checked');if(label&&d&&!errorMessage)label.textContent=d.name+' · v'+d.version;
  }

  function preview(){notice='';errorMessage='';syncState();syncUsage();clearTimeout(timer);timer=setTimeout(renderChart,180)}
  function validate(){const candidate=working();if(currentParents)try{H.projectMean(currentParents,candidate)}catch(error){if(error.kind!=='data')throw error}return candidate.definition}
  function download(){try{const d=validate(),url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='hypothesis-'+d.id.replace(/[^a-z0-9_-]/gi,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(error){notice='Export refusé : '+error.message;renderChart()}}
  function addProfile(d){d={...H.definition(d),id:'H-'+Date.now()+'-'+library.profiles.length};H.compile(d);library.profiles.push({definition:d,history:[]});library.selectedId=d.id;notice='Nouvelle variante indépendante ; renommer dans les options avancées.';saveLibrary();advancedOpen=true;mount(average,panel,currentContext);panel.querySelector('[data-hyp-field="name"]').focus()}
  function mount(chart,lab,ctx,parents=currentParents){
    clearTimeout(timer);average=chart;panel=lab;currentContext=ctx;currentParents=parents;if(!chart||!lab)return;
    const d=draft(),p=selected(),field=(key,label,rows=2)=>'<label>'+label+'<textarea data-hyp-field="'+key+'" rows="'+rows+'" spellcheck="false">'+escape(d[key])+'</textarea></label>';
    panel.innerHTML='<p>Les contrôles numériques et les paramètres JSON éditent les mêmes valeurs. Prévisualisation avant enregistrement ; aucun ajustement automatique.</p><div class="hyp-toolbar"><label>Hypothèse active <select data-hyp-select>'+library.profiles.map(p=>'<option value="'+escape(p.definition.id)+'"'+(p.definition.id===library.selectedId?' selected':'')+'>'+escape(p.definition.name+' · v'+p.definition.version)+'</option>').join('')+'</select></label><button type="button" data-hyp-duplicate>Nouvelle variante</button><button type="button" data-hyp-delete'+(library.profiles.length===1?' disabled title="La dernière hypothèse ne peut pas être supprimée"':'')+'>Supprimer</button></div>'+(migrationMessage?'<details'+(migrationMessage.includes('Conflit')?' open':'')+'><summary>Reprise des configurations précédentes</summary><p>'+escape(migrationMessage)+'</p></details>':'')+'<div data-hyp-parameters></div><p>Projection orange : uniquement les parents et les formules actives. Observations vertes : uniquement les naissances fiables du périmètre sélectionné.</p><div class="hyp-toolbar"><span class="hyp-save-state" data-hyp-save-state role="status"></span><button type="button" data-hyp-save>Enregistrer les modifications</button></div><p data-hyp-status role="status"></p><details data-hyp-advanced'+(advancedOpen?' open':'')+'><summary>Options avancées — formules mathématiques</summary><div class="hyp-primary"><label>Nom de la variante <input data-hyp-field="name" maxlength="120" value="'+escape(d.name)+'"></label><label>Version <input data-hyp-field="version" maxlength="40" value="'+escape(d.version)+'"></label></div>'+field('budget','A — Budget théorique : B = (projectionBudget)')+field('target','B — Target : μ_i =')+field('weight','C — Distribution / Weight : weight_i =')+field('parameters','Paramètres canoniques — objet JSON de nombres',5)+'<p>La formule A produit un budget moyen décimal. Bmax est également une contrainte finale. Les résultats aux budgets entiers voisins sont interpolés numériquement : cette convention ne décrit pas une loi aléatoire du jeu. Les budgets réels des enfants ne sont jamais utilisés dans la projection.</p><details><summary>Anciennes formules et lois de budget conservées (inactives pour cette projection)</summary><pre data-hyp-legacy></pre></details><div class="experiment-actions"><button type="button" data-hyp-export>Exporter une hypothèse JSON</button><label>Importer une hypothèse JSON <input data-hyp-import type="file" accept="application/json,.json"></label></div><details><summary>Historique et restauration</summary><select data-hyp-history><option value="saved">Dernière configuration enregistrée</option>'+p.history.map((h,i)=>'<option value="'+i+'">'+escape(h.name+' · v'+h.version+' · sauvegarde '+(i+1))+'</option>').join('')+'</select><button type="button" data-hyp-restore>Restaurer la configuration choisie</button><p>La restauration remet les valeurs en édition ; enregistrer pour les conserver.</p></details><details><summary>Syntaxe, variables et contraintes</summary><p>Opérateurs + − * / ^ et parenthèses ; fonctions abs, round, floor, ceil, sqrt, exp, log, min(a,b), max(a,b), pow(a,b). Nombres décimaux avec point et notation scientifique. Pas de JavaScript, conditions, tableaux ni chaînes. Maximum 1000 caractères / 256 éléments par formule.</p><p>Budget : S, delta, mother_total, father_total. Target : mêmes variables, B, m_i, mother_i, father_i, gap_i. Weight : mêmes variables, mu_i, x_i. Tous les paramètres numériques déclarés, dont alpha, Bmax, beta, sigma et vos paramètres supplémentaires, sont accessibles aux trois formules.</p><p>x_i entier 0–10, somme égale au budget entier 0–70 ; normalisation conjointe par convolution. μ_i est une cible, différente de l’espérance finale E[X_i]. Aucun delta aléatoire n’est fabriqué à partir du bonus moyen.</p></details></details>';
    panel.querySelector('[data-hyp-advanced]').ontoggle=e=>{advancedOpen=e.target.open};renderParameters();
    panel.querySelectorAll('[data-hyp-field]').forEach(input=>input.addEventListener('input',()=>{draft()[input.dataset.hypField]=input.value;if(input.dataset.hypField==='parameters')renderParameters();preview()}));
    panel.querySelector('[data-hyp-legacy]').textContent=JSON.stringify({budget:p.definition.formulas.budget,budgetLaw:p.definition.budgetLaw,budgetKnowledge:p.definition.budgetKnowledge,meanBudgetRounding:p.definition.meanBudgetRounding},null,2);
    panel.querySelector('[data-hyp-select]').onchange=e=>{library.selectedId=e.target.value;notice='';errorMessage='';saveLibrary();mount(average,panel,currentContext)};
    panel.querySelector('[data-hyp-duplicate]').onclick=()=>{try{const c=validate();addProfile({...c,name:c.name+' — variante'})}catch(error){notice=error.message;renderChart()}};
    panel.querySelector('[data-hyp-delete]').onclick=()=>{if(library.profiles.length<2)return;const id=library.selectedId,name=draft().name||p.definition.name;if(!window.confirm('Supprimer l’hypothèse « '+name+' » et son historique local ? Les expériences et naissances seront conservées.'))return;if(storageBlocked){notice='Suppression refusée : bibliothèque non chargée, stockage existant conservé.';renderChart();return}library.profiles=library.profiles.filter(p=>p.definition.id!==id);drafts.delete(id);library.selectedId=library.profiles[0].definition.id;notice=saveLibrary()?'Hypothèse supprimée.':'Suppression en mémoire seulement.';errorMessage='';mount(average,panel,currentContext)};
    panel.querySelector('[data-hyp-save]').onclick=()=>{try{const c=validate();if(JSON.stringify(c)!==JSON.stringify(p.definition)){p.history.push(H.copy(p.definition));p.history=p.history.slice(-10);p.definition=H.copy(c)}notice=saveLibrary()?'Configuration enregistrée ; dix versions antérieures conservées.':'Configuration en mémoire seulement.';mount(average,panel,currentContext)}catch(error){notice='Non enregistré : '+error.message;renderChart()}};
    panel.querySelector('[data-hyp-export]').onclick=download;
    panel.querySelector('[data-hyp-import]').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>262144)throw new Error('Définition trop volumineuse (256 Ko maximum).');const raw=JSON.parse(await file.text());addProfile(upgrade(raw,raw.budgetAssumption))}catch(error){notice='Import refusé : '+error.message;renderChart()}};
    panel.querySelector('[data-hyp-restore]').onclick=()=>{const i=panel.querySelector('[data-hyp-history]').value;if(i==='saved'){drafts.delete(library.selectedId);}else drafts.set(library.selectedId,fromDefinition(p.history[Number(i)]));notice='Configuration restaurée en édition.';errorMessage='';mount(average,panel,currentContext)};
    renderChart();
  }
  return Object.freeze({mount,slot:'<div class="experiment-distribution hypothesis-average" id="hypothesisAverage"></div>'});
})();
