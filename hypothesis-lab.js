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

// UI and versioned hypothesis storage are deliberately separate from Experiment state/export.
const HypothesisLab=(()=>{
  const H=GeneticHypotheses,storageKey='breeding-advisor-hypothesis-lab-v1',escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let library={version:1,selectedId:'D',mode:'observed',profiles:[{definition:H.initial(),history:[]}]},storageMessage='',storageBlocked=false;
  try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved){if(saved.version!==1||!Array.isArray(saved.profiles)||!saved.profiles.length)throw new Error('Format de bibliothèque non pris en charge.');saved.profiles.forEach(p=>{H.compile(p.definition);if(!Array.isArray(p.history))throw new Error('Historique invalide.');p.history.forEach(H.compile)});if(new Set(saved.profiles.map(p=>p.definition.id)).size!==saved.profiles.length)throw new Error('Identifiants dupliqués.');library=saved;if(!library.profiles.some(p=>p.definition.id===library.selectedId))library.selectedId=library.profiles[0].definition.id;if(!['observed','predicted'].includes(library.mode))library.mode='observed'}}
  catch(error){storageMessage='Bibliothèque non chargée : '+error.message+' Le stockage existant est conservé ; utiliser l’export JSON pour garder les nouvelles configurations.';storageBlocked=true}
  const drafts=new Map(),active=new Map();let currentContext=null,average=null,panel=null,timer=null,opened=false,errorMessage='',notice='';
  const selected=()=>library.profiles.find(p=>p.definition.id===library.selectedId);
  const fromDefinition=d=>({name:d.name,version:d.version,budget:d.formulas.budget,target:d.formulas.target,weight:d.formulas.weight,parameters:JSON.stringify(d.parameters,null,2),budgetLaw:JSON.stringify(d.budgetLaw,null,2)});
  function draft(){if(!drafts.has(library.selectedId))drafts.set(library.selectedId,fromDefinition(selected().definition));return drafts.get(library.selectedId)}
  function saveLibrary(){if(storageBlocked)return false;try{localStorage.setItem(storageKey,JSON.stringify(library));storageMessage='';return true}catch{storageMessage='Stockage local indisponible : exporter la définition JSON avant de fermer la page.';return false}}
  function working(){const d=draft(),s=selected().definition;return H.compile({...s,name:d.name,version:d.version,formulas:{budget:d.budget,target:d.target,weight:d.weight},parameters:JSON.parse(d.parameters),budgetLaw:JSON.parse(d.budgetLaw)})}
  function renderChart(){
    if(!average?.isConnected||!currentContext)return;
    let compiled,result;
    try{compiled=working();result=H.compare(currentContext,compiled,library.mode);const invalid=result.issues.find(i=>i.kind==='formula');if(invalid)throw new Error(invalid.reason);active.set(library.selectedId,compiled);errorMessage=''}catch(error){errorMessage='Configuration invalide : '+error.message;compiled=active.get(library.selectedId)||H.compile(selected().definition);result=H.compare(currentContext,compiled,library.mode)}
    const d=compiled.definition,num=v=>v===null?'—':v.toFixed(2),compact=window.matchMedia('(max-width:640px)').matches;
    const groups=result.rows.map((r,i)=>{
      const x=compact?42+i*42:70+i*88,width=compact?16:25,offset=compact?18:29,tip=H.keys[i]+' — Observed Mean : '+num(r.observed)+' (n='+r.n+'); Predicted Mean : '+num(r.predicted)+' (n='+r.predictedN+'); observé − prédit : '+num(r.difference)+'; μ_i cible intermédiaire : '+num(r.mu)+' (distincte de E[X_i]).';
      return '<g><title>'+escape(tip)+'</title><rect class="hyp-observed" x="'+x+'" y="'+(245-20*(r.observed??0))+'" width="'+width+'" height="'+20*(r.observed??0)+'"/><rect class="hyp-predicted" x="'+(x+offset)+'" y="'+(245-20*(r.predicted??0))+'" width="'+width+'" height="'+20*(r.predicted??0)+'"/><text class="hyp-observed-label" x="'+(x+width/2)+'" y="'+(compact?288:237-20*(r.observed??0))+'" text-anchor="middle">'+num(r.observed)+'</text><text class="hyp-predicted-label" x="'+(x+offset+width/2)+'" y="'+(compact?305:237-20*(r.predicted??0))+'" text-anchor="middle">'+num(r.predicted)+'</text><text x="'+(x+(offset+width)/2)+'" y="270" text-anchor="middle">'+r.stat+'</text></g>';
    }).join('');
    average.innerHTML='<h3>Average Offspring — Individu moyen</h3><p class="hyp-legend"><span>■ Observed Mean</span><span>■ Predicted Mean</span></p><p>'+escape(d.name)+' · v'+escape(d.version)+' · '+escape(Object.entries(d.parameters).map(([k,v])=>k+'='+v).join(', '))+'<br><strong>'+(library.mode==='observed'?'Observed Budget — redistribution conditionnée au total réel':'Predicted Budget — loi de delta déclarée, sans budget réel')+'</strong> · '+result.predictedEvents+' / '+result.events+' tirages fiables prédictibles.</p>'+(library.mode==='predicted'?'<p>Loi de delta : '+escape(d.budgetLaw.map(p=>p.delta+' ('+(100*p.probability).toFixed(2)+' %)').join(', '))+'</p>':'')+(errorMessage?'<p class="experiment-warning">'+escape(errorMessage)+' Les barres prédites utilisent la dernière configuration valide affichée ci-dessus.</p>':'')+'<svg viewBox="0 0 '+(compact?'350 320':'720 285')+'" role="img" aria-label="Moyennes observées et espérances prédites par stat, axe de 0 à 10">'+[0,2,4,6,8,10].map(v=>'<line x1="'+(compact?32:48)+'" x2="'+(compact?340:705)+'" y1="'+(245-v*20)+'" y2="'+(245-v*20)+'"/><text x="'+(compact?25:35)+'" y="'+(249-v*20)+'" text-anchor="end">'+v+'</text>').join('')+groups+'</svg><p>Erreurs descriptives sur les sept moyennes : MAE <strong>'+num(result.mae)+'</strong> · RMSE <strong>'+num(result.rmse)+'</strong>. Elles ne valident pas la distribution ni le mécanisme. Aucun ajustement automatique.</p>'+(result.issues.length?'<p class="experiment-warning">'+result.issues.length+' événements sans prédiction. Les effectifs observés et prédits peuvent différer ; différence et erreurs non affichées si les échantillons ne coïncident pas.</p><details><summary>Limites de prédiction</summary>'+result.issues.map(i=>'<p>'+escape(i.event_id)+' : '+escape(i.reason)+'</p>').join('')+'</details>':'')+'<details><summary>Configuration exacte calculée</summary><pre>'+escape(JSON.stringify(d,null,2))+'</pre></details><details><summary>Valeurs et effectifs par stat</summary><div class="experiment-table-scroll"><table class="experiment-table"><thead><tr><th>Stat</th><th>Observed Mean / n</th><th>Predicted Mean / n</th><th>Observé − prédit</th><th>μ_i (cible)</th></tr></thead><tbody>'+result.rows.map(r=>'<tr><td>'+r.stat+'</td><td>'+num(r.observed)+' / '+r.n+'</td><td>'+num(r.predicted)+' / '+r.predictedN+'</td><td>'+num(r.difference)+'</td><td>'+num(r.mu)+'</td></tr>').join('')+'</tbody></table></div></details>';
    const status=panel?.querySelector('[data-hyp-status]');if(status)status.textContent=[errorMessage,notice,storageMessage].filter(Boolean).join(' ');
    const label=panel?.querySelector('[data-hyp-select] option:checked');if(label&&!errorMessage)label.textContent=d.name+' · v'+d.version;
  }
  function download(){renderChart();const d=(active.get(library.selectedId)||H.compile(selected().definition)).definition,url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='hypothesis-'+d.id.replace(/[^a-z0-9_-]/gi,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function addProfile(d){d={...d,id:'H-'+Date.now()+'-'+library.profiles.length};H.compile(d);library.profiles.push({definition:H.definition(d),history:[]});library.selectedId=d.id;notice='Nouvelle configuration enregistrée séparément des observations.';saveLibrary();mount(average,panel,currentContext)}
  function mount(chart,lab,ctx){
    clearTimeout(timer);average=chart;panel=lab;currentContext=ctx;if(!chart||!lab)return;
    const d=draft(),p=selected(),field=(key,label,rows=2)=>'<label>'+label+'<textarea data-hyp-field="'+key+'" rows="'+rows+'" spellcheck="false">'+escape(d[key])+'</textarea></label>';
    panel.open=opened;
    panel.innerHTML='<summary>Hypothesis Lab — formules et paramètres</summary><p>Configurations candidates, distinctes des observations et de latest.json. beta=0.9 et sigma=2.47 sont des estimations de travail. Modifier les champs recalcule les prédictions en mémoire ; Enregistrer conserve une version.</p><div class="hyp-controls"><label>Hypothèse <select data-hyp-select>'+library.profiles.map(p=>'<option value="'+escape(p.definition.id)+'"'+(p.definition.id===library.selectedId?' selected':'')+'>'+escape(p.definition.name+' · v'+p.definition.version)+'</option>').join('')+'</select></label><label>Mode de budget <select data-hyp-mode><option value="observed"'+(library.mode==='observed'?' selected':'')+'>A — Observed Budget (total réel)</option><option value="predicted"'+(library.mode==='predicted'?' selected':'')+'>B — Predicted Budget (loi déclarée)</option></select></label></div><div class="experiment-actions"><button type="button" data-hyp-new>Créer</button><button type="button" data-hyp-duplicate>Dupliquer</button></div><div class="hyp-controls"><label>Nom <input data-hyp-field="name" maxlength="120" value="'+escape(d.name)+'"></label><label>Version <input data-hyp-field="version" maxlength="40" value="'+escape(d.version)+'"></label></div>'+field('budget','A — Budget : B =')+field('target','B — Target : mu_i =')+field('weight','C — Distribution / Weight : weight_i =')+'<div class="hyp-controls">'+field('parameters','Paramètres déclarés — objet JSON de nombres',5)+field('budgetLaw','Loi de delta — JSON {delta, probability}, poids total = 1',5)+'</div><p>Mode A : la formule de budget et la loi de delta ne sont pas utilisées. Mode B : delta=0 avec poids 1 est le réglage initial explicite ; ce n’est pas une loi du jeu confirmée. Budget final entier de 0 à 70, sans correction implicite.</p><div class="experiment-actions"><button type="button" data-hyp-save>Enregistrer</button><button type="button" data-hyp-reset>Réinitialiser / Recharger la sauvegarde</button><button type="button" data-hyp-export>Exporter la définition JSON valide</button><label>Importer JSON <input data-hyp-import type="file" accept="application/json,.json"></label></div><div class="hyp-controls"><label>Versions précédemment enregistrées <select data-hyp-history><option value="">Choisir une version antérieure</option>'+p.history.map((h,i)=>'<option value="'+i+'">'+escape(h.name+' · v'+h.version+' · sauvegarde '+(i+1))+'</option>').join('')+'</select></label><button type="button" data-hyp-restore>Reprendre cette version</button></div><p data-hyp-status role="status"></p><details><summary>Syntaxe, variables et contraintes</summary><p>Opérateurs : + − * / ^, parenthèses, nombres décimaux avec point et notation scientifique. ^ signifie puissance, associativité à droite ; −2^2 = −4. Fonctions : abs, round (0,5 vers +∞), floor, ceil, sqrt, exp, log (naturel), min(a,b), max(a,b), pow(a,b). Pas de conditions, comparaisons, tableaux, chaînes ni JavaScript ; 1000 caractères / 256 éléments maximum par formule.</p><p>Budget : S, delta, mother_total, father_total. Target : B, S, m_i, mother_i, father_i, gap_i, mother_total, father_total. Weight : mêmes variables, plus mu_i et x_i. m_i est la moyenne parentale ; gap_i = abs(mother_i − father_i) ; S est la somme des sept moyennes parentales. Tous les paramètres numériques déclarés sont accessibles dans les trois formules.</p><p>x_i entier 0–10, somme x_i = B. Poids non négatifs, normalisés conjointement par convolution, pas de tirages indépendants corrigés. Une prédiction nécessite les sept valeurs des deux parents. Le budget observé exige sept stats enfants non contradictoires ; aucune valeur manquante n’est inventée. μ_i est une cible intermédiaire ; E[X_i] vient des marges de la distribution conjointe contrainte.</p></details>';
    panel.ontoggle=()=>{opened=panel.open};
    panel.querySelectorAll('[data-hyp-field]').forEach(input=>input.addEventListener('input',()=>{draft()[input.dataset.hypField]=input.value;notice='Modifications en mémoire — Enregistrer pour conserver.';clearTimeout(timer);timer=setTimeout(renderChart,180)}));
    panel.querySelector('[data-hyp-select]').onchange=e=>{library.selectedId=e.target.value;notice='';saveLibrary();mount(average,panel,currentContext)};
    panel.querySelector('[data-hyp-mode]').onchange=e=>{library.mode=e.target.value;saveLibrary();renderChart()};
    panel.querySelector('[data-hyp-new]').onclick=()=>addProfile({...H.initial(),name:'Nouvelle hypothèse'});
    panel.querySelector('[data-hyp-duplicate]').onclick=()=>{try{const c=working().definition;addProfile({...c,name:c.name+' — copie'})}catch(error){notice=error.message;renderChart()}};
    panel.querySelector('[data-hyp-save]').onclick=()=>{try{const candidate=working(),invalid=H.compare(currentContext,candidate,library.mode).issues.find(i=>i.kind==='formula');if(invalid)throw new Error(invalid.reason);const c=candidate.definition;if(JSON.stringify(c)!==JSON.stringify(p.definition)){p.history.push(H.copy(p.definition));p.history=p.history.slice(-10);p.definition=H.copy(c)}notice=saveLibrary()?'Configuration enregistrée ; dix versions précédentes au maximum sont conservées.':'Configuration en mémoire uniquement.';renderChart()}catch(error){notice='Non enregistré : '+error.message;renderChart()}};
    panel.querySelector('[data-hyp-reset]').onclick=()=>{drafts.delete(library.selectedId);active.delete(library.selectedId);notice='Dernière sauvegarde rechargée.';mount(average,panel,currentContext)};
    panel.querySelector('[data-hyp-export]').onclick=download;
    panel.querySelector('[data-hyp-import]').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>262144)throw new Error('Définition trop volumineuse (256 Ko maximum).');addProfile(H.definition(JSON.parse(await file.text())))}catch(error){notice='Import refusé : '+error.message;renderChart()}};
    panel.querySelector('[data-hyp-restore]').onclick=()=>{const index=panel.querySelector('[data-hyp-history]').value;if(index===''){notice='Choisir une version antérieure.';renderChart();return}drafts.set(library.selectedId,fromDefinition(p.history[Number(index)]));notice='Version antérieure reprise en mémoire — Enregistrer pour la conserver.';mount(average,panel,currentContext)};
    renderChart();
  }
  return Object.freeze({mount,slot:'<div class="experiment-distribution hypothesis-average" id="hypothesisAverage"></div>'});
})();
