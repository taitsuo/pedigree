'use strict';
// Candidate hypotheses are data. This parser never executes JavaScript source.
const GeneticHypotheses=(()=>{
  const keys=['V','F','P','R','T','A','I'];
  const funcs={abs:[1,Math.abs],round:[1,Math.round],floor:[1,Math.floor],ceil:[1,Math.ceil],sqrt:[1,Math.sqrt],exp:[1,Math.exp],log:[1,Math.log],min:[2,Math.min],max:[2,Math.max],pow:[2,Math.pow]};
  const variables=['S','delta','B','m_i','mother_i','father_i','gap_i','mother_total','father_total','mu_i','x_i'];
  const copy=x=>JSON.parse(JSON.stringify(x));
  const initial=()=>({format:'BreedingHypothesis',schema_version:1,id:'D',name:'Hypothèse D',version:'1',formulas:{budget:'round(S) + delta',target:'B/7 + beta*(m_i - S/7)',weight:'exp(-((x_i-mu_i)^2)/(2*sigma^2))'},parameters:{beta:0.9,sigma:2.47},budgetLaw:[{delta:0,probability:1}]});
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
    const law=input.budgetLaw;if(!Array.isArray(law)||!law.length||law.length>71||law.some(p=>typeof p.delta!=='number'||!Number.isFinite(p.delta)||typeof p.probability!=='number'||!Number.isFinite(p.probability)||p.probability<0)||Math.abs(law.reduce((n,p)=>n+p.probability,0)-1)>1e-9)throw new Error('Loi de delta : 1 à 71 valeurs, poids positifs ou nuls totalisant 1.');
    // Whitelist the portable definition: neither credentials nor account state belong here.
    return {format:input.format,schema_version:1,id:input.id,name:input.name.trim(),version:input.version,formulas:{budget:f.budget,target:f.target,weight:f.weight},parameters:{...input.parameters},budgetLaw:law.map(p=>({delta:p.delta,probability:p.probability}))};
  }
  function compile(input){const d=definition(input),params=Object.keys(d.parameters),base=['S','mother_total','father_total'];return {definition:d,
    budget:expression(d.formulas.budget,new Set([...base,'delta',...params]),'B'),
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
    const env=environment(compiled,mother,father),parts=compiled.definition.budgetLaw.filter(p=>p.probability>0).map(p=>({probability:p.probability,result:conditional(compiled,mother,father,compiled.budget({...env,delta:p.delta}))}));
    const mix=fn=>parts.reduce((n,p)=>n+p.probability*fn(p.result),0);
    return {budget:mix(p=>p.budget),mu:keys.map((_,i)=>mix(p=>p.mu[i])),means:keys.map((_,i)=>mix(p=>p.means[i])),marginals:keys.map((_,i)=>Array.from({length:11},(_,v)=>mix(p=>p.marginals[i][v])))};
  }
  function compare(ctx,compiled,mode='observed'){
    if(!['observed','predicted'].includes(mode))throw new Error('Mode de budget inconnu.');
    const rows=keys.map(stat=>({stat,n:0,observedSum:0,predictedN:0,predictedSum:0,muSum:0})),cache=new Map(),issues=[];let predictedEvents=0;
    for(const e of ctx.graphEvents){
      let result;
      const full=e.child.every(v=>Number.isInteger(v)&&v>=0&&v<=10)&&!e.conflict.some(Boolean);
      if(mode==='observed'&&!full)issues.push({event_id:e.drawId,kind:'data',reason:'Budget observé incomplet ou contradictoire.'});
      else try{const B=mode==='observed'?e.child.reduce((a,b)=>a+b,0):null,key=JSON.stringify([e.maternal,e.paternal,B]);if(!cache.has(key))cache.set(key,mode==='observed'?conditional(compiled,e.maternal,e.paternal,B):predicted(compiled,e.maternal,e.paternal));result=cache.get(key);predictedEvents++}
      catch(error){issues.push({event_id:e.drawId,kind:error.kind||'formula',reason:error.message})}
      rows.forEach((r,i)=>{if(e.conflict[i]||!Number.isInteger(e.child[i])||e.child[i]<0||e.child[i]>10)return;r.n++;r.observedSum+=e.child[i];if(result){r.predictedN++;r.predictedSum+=result.means[i];r.muSum+=result.mu[i]}});
    }
    rows.forEach(r=>{r.observed=r.n?r.observedSum/r.n:null;r.predicted=r.predictedN?r.predictedSum/r.predictedN:null;r.mu=r.predictedN?r.muSum/r.predictedN:null;r.difference=r.n===r.predictedN&&r.n?r.observed-r.predicted:null});
    const comparable=rows.filter(r=>r.difference!==null),sameSample=comparable.length===7;
    return {mode,rows,events:ctx.graphEvents.length,predictedEvents,issues,mae:sameSample?comparable.reduce((n,r)=>n+Math.abs(r.difference),0)/7:null,rmse:sameSample?Math.sqrt(comparable.reduce((n,r)=>n+r.difference**2,0)/7):null};
  }
  return Object.freeze({initial,definition,compile,expression,conditional,predicted,compare,copy,keys});
})();


// Hypothesis configuration and presentation remain separate from captured data and publication.
const HypothesisLab=(()=>{
  const H=GeneticHypotheses,storageKey='breeding-advisor-hypothesis-lab-v1',escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const defaultAssumption=()=>({bonus:0.4,cap:60,source:'mean'});
  let library={version:1,selectedId:'D',mode:'observed',profiles:[{definition:H.initial(),history:[]}]},storageMessage='',storageBlocked=false;
  try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved){if(saved.version!==1||!Array.isArray(saved.profiles)||!saved.profiles.length)throw new Error('Format de bibliothèque non pris en charge.');saved.profiles.forEach(p=>{H.compile(p.definition);if(!Array.isArray(p.history))throw new Error('Historique invalide.');p.history.forEach(H.compile)});if(new Set(saved.profiles.map(p=>p.definition.id)).size!==saved.profiles.length)throw new Error('Identifiants dupliqués.');library=saved;if(!library.profiles.some(p=>p.definition.id===library.selectedId))library.selectedId=library.profiles[0].definition.id;if(!['observed','predicted'].includes(library.mode))library.mode='observed'}}
  catch(error){storageMessage='Bibliothèque non chargée : '+error.message+' Le stockage existant est conservé ; exporter les nouvelles configurations.';storageBlocked=true}
  const drafts=new Map(),active=new Map();let currentContext=null,average=null,panel=null,timer=null,errorMessage='',notice='',advancedOpen=false;
  const selected=()=>library.profiles.find(p=>p.definition.id===library.selectedId);
  const fromDefinition=(d,assumption=defaultAssumption())=>({name:d.name,version:d.version,budget:d.formulas.budget,target:d.formulas.target,weight:d.formulas.weight,parameters:JSON.stringify(d.parameters,null,2),budgetLaw:JSON.stringify(d.budgetLaw,null,2),assumption:H.copy(assumption)});
  function draft(){if(!drafts.has(library.selectedId))drafts.set(library.selectedId,fromDefinition(selected().definition,selected().budgetAssumption));return drafts.get(library.selectedId)}
  function saveLibrary(){if(storageBlocked)return false;try{localStorage.setItem(storageKey,JSON.stringify(library));storageMessage='';return true}catch{storageMessage='Stockage local indisponible : exporter la définition JSON avant de fermer la page.';return false}}
  function working(){const d=draft(),s=selected().definition;if(typeof d.assumption.bonus!=='number'||typeof d.assumption.cap!=='number'||!Number.isFinite(d.assumption.bonus)||!Number.isFinite(d.assumption.cap)||Number(d.assumption.cap)<0||Number(d.assumption.cap)>70||!['mean','law'].includes(d.assumption.source))throw new Error('Bonus moyen ou plafond invalide (plafond entre 0 et 70).');return H.compile({...s,name:d.name,version:d.version,formulas:{budget:d.budget,target:d.target,weight:d.weight},parameters:JSON.parse(d.parameters),budgetLaw:JSON.parse(d.budgetLaw)})}
  function effectiveMode(){return library.mode==='predicted'&&draft().assumption.source!=='law'?'observed':library.mode}
  function syncState(){
    const status=panel?.querySelector('[data-hyp-save-state]');if(!status)return;
    let dirty=true;try{dirty=JSON.stringify(working().definition)!==JSON.stringify(selected().definition)||JSON.stringify(draft().assumption)!==JSON.stringify(selected().budgetAssumption||defaultAssumption())}catch{}
    status.textContent=dirty?'Modifications non enregistrées':'Enregistré';
    if(storageMessage)status.textContent+=' — '+storageMessage;
    panel.querySelector('[data-hyp-save]').disabled=!dirty;
  }
  function renderChart(){
    if(!average?.isConnected||!currentContext)return;
    let compiled,result;
    try{compiled=working();result=H.compare(currentContext,compiled,effectiveMode());const invalid=result.issues.find(i=>i.kind==='formula');if(invalid)throw new Error(invalid.reason);active.set(library.selectedId,compiled);errorMessage=''}catch(error){errorMessage='Configuration invalide : '+error.message;compiled=active.get(library.selectedId)||H.compile(selected().definition);result=H.compare(currentContext,compiled,library.mode)}
    const assumption=draft().assumption;const meanOnly=library.mode==='predicted'&&assumption.source!=='law';if(meanOnly){result={...result,predictedEvents:0,mae:null,rmse:null,issues:[],rows:result.rows.map(r=>({...r,predicted:null,predictedN:0,mu:null,difference:null}))}}
    const d=compiled.definition,num=v=>v===null?'—':v.toFixed(2),compact=window.matchMedia('(max-width:640px)').matches;
    const groups=result.rows.map((r,i)=>{
      const x=compact?42+i*42:70+i*88,width=compact?16:25,offset=compact?18:29,tip=H.keys[i]+' — Observed Mean : '+num(r.observed)+' (n='+r.n+'); Predicted Mean : '+num(r.predicted)+' (n='+r.predictedN+'); observé − prédit : '+num(r.difference)+'; μ_i cible intermédiaire : '+num(r.mu)+' (distincte de E[X_i]).';
      return '<g><title>'+escape(tip)+'</title><rect class="hyp-observed" x="'+x+'" y="'+(245-20*(r.observed??0))+'" width="'+width+'" height="'+20*(r.observed??0)+'"/><rect class="hyp-predicted" x="'+(x+offset)+'" y="'+(245-20*(r.predicted??0))+'" width="'+width+'" height="'+20*(r.predicted??0)+'"/><text class="hyp-observed-label" x="'+(x+width/2)+'" y="'+(compact?288:237-20*(r.observed??0))+'" text-anchor="middle">'+num(r.observed)+'</text><text class="hyp-predicted-label" x="'+(x+offset+width/2)+'" y="'+(compact?305:237-20*(r.predicted??0))+'" text-anchor="middle">'+num(r.predicted)+'</text><text x="'+(x+(offset+width)/2)+'" y="270" text-anchor="middle">'+r.stat+'</text></g>';
    }).join('');
    average.innerHTML='<h3>Average Offspring — Individu moyen</h3><p class="hyp-legend"><span>■ Observed Mean</span><span>■ Predicted Mean</span></p><p>'+escape(d.name)+' · v'+escape(d.version)+' · '+escape(Object.entries(d.parameters).map(([k,v])=>k+'='+v).join(', '))+'<br><strong>'+(library.mode==='observed'?'Observed Budget — redistribution conditionnée au total réel':meanOnly?'Predicted Budget — loi de budget inconnue':'Predicted Budget — loi de delta déclarée, sans budget réel')+'</strong> · '+result.predictedEvents+' / '+result.events+' tirages fiables prédictibles.</p>'+(library.mode==='predicted'&&!meanOnly?'<p>Loi de delta : '+escape(d.budgetLaw.map(p=>p.delta+' ('+(100*p.probability).toFixed(2)+' %)').join(', '))+'</p>':'')+(meanOnly?'<p class="experiment-warning">Prédiction indisponible : E[Δ_raw] = '+escape(assumption.bonus/100)+' × S et plafond supposé '+escape(assumption.cap)+' ne définissent pas une loi de budget. Ni probabilités ni espérances finales ne sont déduites de ce seul bonus moyen. Déclarer explicitement une loi dans les options avancées pour tester Predicted Budget.</p>':'')+(errorMessage?'<p class="experiment-warning">'+escape(errorMessage)+' Les barres prédites utilisent la dernière configuration valide affichée ci-dessus.</p>':'')+'<svg viewBox="0 0 '+(compact?'350 320':'720 285')+'" role="img" aria-label="Moyennes observées et espérances prédites par stat, axe de 0 à 10">'+[0,2,4,6,8,10].map(v=>'<line x1="'+(compact?32:48)+'" x2="'+(compact?340:705)+'" y1="'+(245-v*20)+'" y2="'+(245-v*20)+'"/><text x="'+(compact?25:35)+'" y="'+(249-v*20)+'" text-anchor="end">'+v+'</text>').join('')+groups+'</svg><p>Erreurs descriptives sur les sept moyennes : MAE <strong>'+num(result.mae)+'</strong> · RMSE <strong>'+num(result.rmse)+'</strong>. Elles ne valident pas la distribution ni le mécanisme. Aucun ajustement automatique.</p>'+(result.issues.length?'<p class="experiment-warning">'+result.issues.length+' événements sans prédiction. Les effectifs observés et prédits peuvent différer ; différence et erreurs non affichées si les échantillons ne coïncident pas.</p><details><summary>Limites de prédiction</summary>'+result.issues.map(i=>'<p>'+escape(i.event_id)+' : '+escape(i.reason)+'</p>').join('')+'</details>':'')+'<details><summary>Configuration exacte calculée</summary><pre>'+escape(JSON.stringify(d,null,2))+'</pre></details><details><summary>Valeurs et effectifs par stat</summary><div class="experiment-table-scroll"><table class="experiment-table"><thead><tr><th>Stat</th><th>Observed Mean / n</th><th>Predicted Mean / n</th><th>Observé − prédit</th><th>μ_i (cible)</th></tr></thead><tbody>'+result.rows.map(r=>'<tr><td>'+r.stat+'</td><td>'+num(r.observed)+' / '+r.n+'</td><td>'+num(r.predicted)+' / '+r.predictedN+'</td><td>'+num(r.difference)+'</td><td>'+num(r.mu)+'</td></tr>').join('')+'</tbody></table></div></details>';
    const status=panel?.querySelector('[data-hyp-status]');if(status)status.textContent=[errorMessage,notice,storageMessage].filter(Boolean).join(' ');
    syncState();
    const label=panel?.querySelector('[data-hyp-select] option:checked');if(label&&!errorMessage)label.textContent=d.name+' · v'+d.version;
  }

  function download(){try{working();renderChart();if(errorMessage)throw new Error(errorMessage);const d={...working().definition,budgetAssumption:H.copy(draft().assumption)},url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='hypothesis-'+d.id.replace(/[^a-z0-9_-]/gi,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(error){notice='Export refusé : '+error.message;renderChart()}}
  function addProfile(d,assumption=defaultAssumption()){d={...d,id:'H-'+Date.now()+'-'+library.profiles.length};H.compile(d);library.profiles.push({definition:H.definition(d),budgetAssumption:H.copy(assumption),history:[],assumptionHistory:[]});library.selectedId=d.id;notice='Nouvelle variante enregistrée séparément des observations.';saveLibrary();mount(average,panel,currentContext)}
  function mount(chart,lab,ctx){
    clearTimeout(timer);average=chart;panel=lab;currentContext=ctx;if(!chart||!lab)return;
    const d=draft(),p=selected(),field=(key,label,rows=2)=>'<label>'+label+'<textarea data-hyp-field="'+key+'" rows="'+rows+'" spellcheck="false">'+escape(d[key])+'</textarea></label>';
    let params={};try{params=JSON.parse(d.parameters)}catch{}
    const number=(key,label,value)=>'<label>'+label+'<input type="number" step="any" data-hyp-primary="'+key+'" value="'+escape(value??'')+'"></label>';
    panel.innerHTML='<p>Réglages candidats. Les modifications valides actualisent le graphique avant enregistrement, sans ajustement automatique aux observations.</p><div class="hyp-toolbar"><label>Hypothèse active <select data-hyp-select>'+library.profiles.map(p=>'<option value="'+escape(p.definition.id)+'"'+(p.definition.id===library.selectedId?' selected':'')+'>'+escape(p.definition.name+' · v'+p.definition.version)+'</option>').join('')+'</select></label><button type="button" data-hyp-duplicate>Nouvelle variante</button></div><h3>Budget de l’enfant</h3><div class="hyp-primary">'+number('bonus','Bonus moyen (%)',d.assumption.bonus)+number('cap','Plafond de budget supposé',d.assumption.cap)+'</div><p>Candidate : E[Δ_raw] = (bonus / 100) × S. Le bonus moyen ne détermine pas sa répartition aléatoire, ni sa moyenne après plafonnement. Ces réglages décrivent une hypothèse ; ils ne remplacent pas la formule ou la loi de budget déclarées.</p><h3>Distribution des stats</h3><div class="hyp-primary">'+number('beta','Influence parentale (β)',params.beta)+number('sigma','Dispersion (σ)',params.sigma)+'</div><p class="small">β et σ interviennent lorsque les formules actives les utilisent. Ce sont des paramètres de travail, pas des valeurs validées.</p><label>Comparer avec les résultats réels <select data-hyp-mode><option value="observed"'+(library.mode==='observed'?' selected':'')+'>Observed Budget — budget observé</option><option value="predicted"'+(library.mode==='predicted'?' selected':'')+'>Predicted Budget — budget prédit</option></select></label><p data-hyp-mode-help></p><div class="hyp-toolbar"><span class="hyp-save-state" data-hyp-save-state role="status"></span><button type="button" data-hyp-save>Enregistrer les modifications</button></div><p data-hyp-status role="status"></p><details data-hyp-advanced'+(advancedOpen?' open':'')+'><summary>Options avancées</summary><div class="hyp-primary"><label>Nom de la variante <input data-hyp-field="name" maxlength="120" value="'+escape(d.name)+'"></label><label>Version <input data-hyp-field="version" maxlength="40" value="'+escape(d.version)+'"></label></div>'+field('budget','A — Budget : B =')+field('target','B — Target : μ_i =')+field('weight','C — Distribution / Weight : weight_i =')+'<div class="hyp-primary">'+field('parameters','Paramètres déclarés et supplémentaires — objet JSON',5)+field('budgetLaw','Loi probabiliste explicite de delta — JSON {delta, probability}, somme = 1',5)+'</div><label>Connaissance du budget <select data-hyp-source><option value="mean"'+(d.assumption.source==='mean'?' selected':'')+'>Bonus moyen seulement — loi inconnue</option><option value="law"'+(d.assumption.source==='law'?' selected':'')+'>Utiliser la loi de delta explicitement déclarée</option></select></label><p>La loi existante reste conservée. Elle est utilisée en Predicted Budget uniquement sur choix explicite. Le bonus moyen et le plafond ci-dessus ne la modifient jamais automatiquement. Pour un plafond dans une loi explicite, déclarer un paramètre numérique et utiliser min(plafond, …) dans Budget.</p><div class="experiment-actions"><button type="button" data-hyp-export>Exporter une hypothèse JSON</button><label>Importer une hypothèse JSON <input data-hyp-import type="file" accept="application/json,.json"></label></div><details><summary>Historique et restauration</summary><p>Une restauration remet les réglages en édition ; enregistrer ensuite pour les conserver.</p><select data-hyp-history><option value="saved">Dernière configuration enregistrée</option>'+p.history.map((h,i)=>'<option value="'+i+'">'+escape(h.name+' · v'+h.version+' · sauvegarde '+(i+1))+'</option>').join('')+'</select><button type="button" data-hyp-restore>Restaurer la configuration choisie</button></details><details><summary>Syntaxe, variables et contraintes</summary><p>Opérateurs : + − * / ^, parenthèses, nombres décimaux avec point et notation scientifique. ^ signifie puissance, associativité à droite ; −2^2 = −4. Fonctions : abs, round (0,5 vers +∞), floor, ceil, sqrt, exp, log (naturel), min(a,b), max(a,b), pow(a,b). Pas de conditions, comparaisons, tableaux, chaînes ni JavaScript ; 1000 caractères / 256 éléments par formule.</p><p>Budget : S, delta, mother_total, father_total. Target : mêmes variables, B, m_i, mother_i, father_i, gap_i. Weight : mêmes variables, mu_i et x_i. m_i : moyenne parentale ; gap_i : écart absolu ; S : somme des sept moyennes parentales. Les paramètres numériques déclarés sont accessibles dans les trois formules.</p><p>x_i entier de 0 à 10, somme = B entier de 0 à 70. Les poids sont normalisés conjointement par convolution. μ_i est une cible ; E[X_i] vient de la distribution contrainte. Aucune valeur manquante n’est inventée.</p></details></details>';
    panel.querySelector('[data-hyp-advanced]').ontoggle=e=>{advancedOpen=e.target.open};
    const preview=()=>{notice='';syncState();clearTimeout(timer);timer=setTimeout(renderChart,180)};
    panel.querySelectorAll('[data-hyp-field]').forEach(input=>input.addEventListener('input',()=>{draft()[input.dataset.hypField]=input.value;if(input.dataset.hypField==='parameters'){try{const params=JSON.parse(input.value);for(const key of ['beta','sigma'])panel.querySelector('[data-hyp-primary="'+key+'"]').value=params[key]??''}catch{}}preview()}));
    panel.querySelectorAll('[data-hyp-primary]').forEach(input=>input.addEventListener('input',()=>{const key=input.dataset.hypPrimary;if(['bonus','cap'].includes(key))draft().assumption[key]=input.value===''?'':Number(input.value);else{try{const params=JSON.parse(draft().parameters);params[key]=input.value===''?null:Number(input.value);draft().parameters=JSON.stringify(params,null,2);panel.querySelector('[data-hyp-field="parameters"]').value=draft().parameters}catch{notice='Corriger le JSON des paramètres dans les options avancées.';renderChart();return}}preview()}));
    const modeHelp=()=>{panel.querySelector('[data-hyp-mode-help]').textContent=library.mode==='observed'?'Utilise le budget réel de chaque naissance pour tester uniquement la redistribution des stats.':'Teste une loi de budget explicitement définie, sans utiliser le total réel. Un bonus moyen seul ne suffit pas pour prédire.'};
    modeHelp();
    panel.querySelector('[data-hyp-source]').onchange=e=>{draft().assumption.source=e.target.value;preview()};
    panel.querySelector('[data-hyp-select]').onchange=e=>{library.selectedId=e.target.value;notice='';saveLibrary();mount(average,panel,currentContext)};
    panel.querySelector('[data-hyp-mode]').onchange=e=>{library.mode=e.target.value;saveLibrary();modeHelp();renderChart()};
    panel.querySelector('[data-hyp-duplicate]').onclick=()=>{try{const c=working().definition;addProfile({...c,name:c.name+' — variante'},draft().assumption)}catch(error){notice=error.message;renderChart()}};
    panel.querySelector('[data-hyp-save]').onclick=()=>{try{const candidate=working(),invalid=H.compare(currentContext,candidate,effectiveMode()).issues.find(i=>i.kind==='formula');if(invalid)throw new Error(invalid.reason);const c=candidate.definition;if(JSON.stringify(c)!==JSON.stringify(p.definition)||JSON.stringify(d.assumption)!==JSON.stringify(p.budgetAssumption||defaultAssumption())){p.assumptionHistory??=p.history.map(()=>defaultAssumption());p.history.push(H.copy(p.definition));p.assumptionHistory.push(H.copy(p.budgetAssumption||defaultAssumption()));p.history=p.history.slice(-10);p.assumptionHistory=p.assumptionHistory.slice(-10);p.definition=H.copy(c);p.budgetAssumption=H.copy(d.assumption)}notice=saveLibrary()?'Configuration enregistrée ; dix versions antérieures conservées.':'Configuration en mémoire seulement.';mount(average,panel,currentContext)}catch(error){notice='Non enregistré : '+error.message;renderChart()}};
    panel.querySelector('[data-hyp-export]').onclick=download;
    panel.querySelector('[data-hyp-import]').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>262144)throw new Error('Définition trop volumineuse (256 Ko maximum).');const raw=JSON.parse(await file.text());const assumption=raw.budgetAssumption||defaultAssumption();if(!Number.isFinite(assumption.bonus)||!Number.isFinite(assumption.cap)||assumption.cap<0||assumption.cap>70||!['mean','law'].includes(assumption.source))throw new Error('Réglages de budget invalides.');addProfile(H.definition(raw),{bonus:assumption.bonus,cap:assumption.cap,source:assumption.source})}catch(error){notice='Import refusé : '+error.message;renderChart()}};
    panel.querySelector('[data-hyp-restore]').onclick=()=>{const index=panel.querySelector('[data-hyp-history]').value;if(index==='saved'){drafts.delete(library.selectedId);active.delete(library.selectedId)}else drafts.set(library.selectedId,fromDefinition(p.history[Number(index)],p.assumptionHistory?.[Number(index)]));notice='Configuration restaurée en édition.';mount(average,panel,currentContext)};
    renderChart();
  }
  return Object.freeze({mount,slot:'<div class="experiment-distribution hypothesis-average" id="hypothesisAverage"></div>'});
})();
