'use strict';
let experimentState={version:2,target:20,bound:3,series:null,sessions:[],records:{}};
let experimentContext=null,experimentData=null,experimentScope='all',experimentGeneration='all';
let experimentMode='controlled',experimentGrouped=false;
let experimentMetadataDraft={name:'',description:''};
let experimentSelection=null,experimentChoosing=false,experimentAdvancedOpen=false,experimentPublishResult=null,experimentPublishing=false;
const experimentSessions=()=>[...experimentState.sessions,...(experimentState.series?[experimentState.series]:[])];
function saveExperiment(){
  if(!experimentContext)return;
  try{localStorage.setItem(experimentContext,JSON.stringify(experimentState));return true}catch{return false}
}
function refreshExperiment(){
  const key='breeding-tool-experiment-p1:'+draftKey(BTView.world);
  if(key!==experimentContext){
    experimentContext=key;experimentMetadataDraft={name:'',description:''};experimentMode='controlled';experimentGrouped=false;experimentScope='all';experimentGeneration='all';experimentSelection=null;experimentChoosing=false;experimentPublishResult=null;
    experimentState={version:2,target:20,bound:3,series:null,sessions:[],records:{}};
    try{
      const saved=JSON.parse(localStorage.getItem(key));
      if(saved&&Number.isInteger(saved.target)&&saved.target>0)experimentState.target=saved.target;
      if(Number.isInteger(saved?.bound)&&saved.bound>=0&&saved.bound<=10)experimentState.bound=saved.bound;
      if(saved?.series&&stablePetId(saved.series.femaleId)&&stablePetId(saved.series.maleId)
        &&Array.isArray(saved.series.baselineIds)&&Array.isArray(saved.series.baselineDraws))experimentState.series=saved.series;
      if(saved?.version===2){experimentState.sessions=saved.sessions||[];experimentState.records=saved.records||{};experimentState.selectedExperimentId=saved.selectedExperimentId||null}
    }catch{}
  }
  const before=JSON.stringify(experimentState),state=experimentState;
  // Remove obsolete parental snapshots; session IDs, baselines and child observations remain.
  for(const session of experimentSessions())for(const field of ['maternal','paternal','p1Maternal','p1Paternal','legacyRoots','femalePet','malePet','tainted'])delete session[field];
  for(const record of Object.values(state.records))for(const field of ['maternal','paternal','reason'])delete record[field];
  const data=BreedingMath.collect(currentPayload.pets,normalizeSpeciesKey,stablePetId,state.records);
  const series=state.series;
  if(series&&series.status!=='ended'){
    if(!series.id){series.id='P1';series.legacy=true;series.started='Reprise P2 d’une série P1'}
    const baseline=new Set(series.baselineIds),roots=new Set(series.baselineDraws);
    const priorByRoot=new Map(Object.values(state.records).map(r=>[r.drawId,r]));
    for(const row of data.rows){
      if(row.key!==BreedingMath.pairKey(series.femaleId,series.maleId)||baseline.has(row.pet.bt_id)||roots.has(row.drawId))continue;
      let record=state.records[row.pet.bt_id];
      if(!record){
        const prior=!row.twinIssue?priorByRoot.get(row.drawId):null;
        record={id:row.pet.bt_id,drawId:row.drawId,femaleId:series.femaleId,maleId:series.maleId,
          sessionId:prior?prior.sessionId:series.id,child:BreedingMath.genetics(row.pet)};
        state.records[row.pet.bt_id]=record;priorByRoot.set(row.drawId,record);
      }else{
        const genes=BreedingMath.genetics(row.pet);
        record.child=record.child.map((v,i)=>v===null?genes[i]:v);
      }
    }
  }
  experimentData=BreedingMath.collect(currentPayload.pets,normalizeSpeciesKey,stablePetId,state.records);
  const sessions=experimentSessions();
  if(!sessions.some(s=>s.id===state.selectedExperimentId))state.selectedExperimentId=state.series?.id||sessions.at(-1)?.id||null;
  if(before!==JSON.stringify(state))saveExperiment();
}
function startExperiment(pair){
  if(!pair?.female||!pair?.male||experimentState.series&&experimentState.series.status!=='ended')return;
  const state=experimentState,key=BreedingMath.pairKey(pair.female.bt_id,pair.male.bt_id);
  if(state.series)state.sessions.push(state.series);
  const known=experimentData.rows.filter(r=>r.key===key);
  state.series={id:'P4-'+Date.now(),name:experimentMetadataDraft.name.trim(),description:experimentMetadataDraft.description,status:'running',target:state.target,bound:state.bound,femaleId:pair.female.bt_id,maleId:pair.male.bt_id,
    reason:pair.reason,started:new Date().toISOString(),baselinePetIds:experimentData.pets.map(p=>p.bt_id),
    baselineIds:known.map(r=>r.pet.bt_id),baselineDraws:[...new Set(known.map(r=>r.drawId))]};
  experimentMetadataDraft={name:'',description:''};experimentChoosing=false;experimentMode='controlled';state.selectedExperimentId=state.series.id;saveExperiment();refreshExperiment();renderExperiment();
}
// first_seen is the first detection, recorded as Unix seconds in the census.
function experimentFirstSeenTime(p){
  if(typeof p.first_seen!=='number'||!Number.isFinite(p.first_seen))return null;
  const time=p.first_seen*1000;
  return Number.isNaN(new Date(time).getTime())?null:time;
}
function experimentFirstSeenLabel(p){
  const time=experimentFirstSeenTime(p);if(time===null)return 'Première détection inconnue';
  const parts=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(time);
  const part=type=>parts.find(p=>p.type===type).value;
  return part('day')+'/'+part('month')+'/'+part('year')+' '+part('hour')+':'+part('minute')+':'+part('second');
}
function openExperimentExclusions(series,ctx){
  const panel=document.getElementById('experimentExclusions');
  const rows=ctx.recordedEvents.flatMap(event=>event.members.filter(row=>hasPetName(row.pet)).map(row=>({event,row}))).sort((a,b)=>{
    const at=experimentFirstSeenTime(a.row.pet),bt=experimentFirstSeenTime(b.row.pet);
    return at===null?(bt===null?a.row.pet.bt_id.localeCompare(b.row.pet.bt_id):1):bt===null?-1:bt-at||a.row.pet.bt_id.localeCompare(b.row.pet.bt_id);
  });
  panel.hidden=false;
  panel.innerHTML='<h3>Exclure un tirage de l’expérience</h3><p>Premières détections en Europe/Paris, de la plus récente à la plus ancienne. Il ne s’agit pas nécessairement de dates de naissance. Les détections inconnues sont placées à la fin. Une exclusion concerne cette série uniquement ; le cheptel et l’historique global restent intacts.</p><label>Descendant <select class="control" id="experimentExcludePet"><option value="">Sélectionner un descendant</option>'+rows.map(({event,row})=>'<option value="'+esc(row.pet.bt_id)+'">'+esc(experimentFirstSeenLabel(row.pet)+(row.pet.name?' — '+canonicalName(row.pet.name):'')+' — '+row.pet.bt_id+(ctx.excludedEvents.includes(event)?' [Exclu]':''))+'</option>').join('')+'</select></label><div id="experimentExcludePreview"></div><button class="control" id="experimentExcludeClose">Fermer</button>';
  document.getElementById('experimentExcludeClose').onclick=()=>{panel.hidden=true};
  document.getElementById('experimentExcludePet').onchange=event=>{
    const selected=rows.find(r=>r.row.pet.bt_id===event.target.value),preview=document.getElementById('experimentExcludePreview');
    if(!selected){preview.innerHTML='';return}
    const draw=selected.event,excluded=ctx.excludedEvents.includes(draw);
    const previous=(series.exclusions||[]).filter(r=>r.event_id===draw.drawId||draw.members.some(m=>r.individual_bt_ids?.includes(m.pet.bt_id)));
    preview.innerHTML='<p>Événement : <strong>'+esc(draw.drawId)+'</strong> — '+draw.members.length+' individu(s). '+(draw.members.length>1?'Ce groupe lié sera traité en entier.':'Aucun jumeau confirmé dans ce groupe.')+'</p>'+draw.members.filter(r=>hasPetName(r.pet)).map(r=>'<p>Première détection : '+esc(experimentFirstSeenLabel(r.pet))+'</p>'+experimentPetHtml(r.pet,r.child)).join('')+(excluded?'<p>Exclusion active. Motif : '+esc(previous.map(r=>r.reason||'Non renseigné').join(' ; '))+'</p>':'<label>Motif facultatif <textarea class="control" id="experimentExcludeReason" rows="2" maxlength="1000"></textarea></label><p>Vérifier les informations ci-dessus puis confirmer l’exclusion de tout ce tirage des calculs de cette expérience.</p>')+'<button class="control" id="experimentExcludeConfirm">'+(excluded?'Annuler l’exclusion':'Confirmer l’exclusion')+'</button>';
    document.getElementById('experimentExcludeConfirm').onclick=()=>{
      if(experimentMode!=='controlled'||experimentState.selectedExperimentId!==series.id)return;
      if(excluded)series.exclusions=series.exclusions.filter(r=>!previous.includes(r));
      else (series.exclusions??=[]).push({event_id:draw.drawId,individual_bt_ids:draw.members.map(r=>r.pet.bt_id),reason:document.getElementById('experimentExcludeReason').value.trim(),excluded_at:new Date().toISOString()});
      const persisted=saveExperiment();renderExperiment();
      if(!persisted)document.getElementById('experimentExclusionState').textContent='Exclusion modifiée en mémoire seulement : stockage local indisponible. Ne pas fermer cette page avant de publier ou de rétablir le stockage.';
    };
  };
  panel.scrollIntoView({block:'nearest'});
}
const experimentDisplayName=s=>s.name?.trim()||'Expérience '+s.id;
function experimentOptionLabel(s){
  const parents=(experimentData.byId.get(s.femaleId)?.name||s.femaleId)+' × '+(experimentData.byId.get(s.maleId)?.name||s.maleId);
  return s.name?.trim()?s.name.trim()+' · '+parents+' · '+s.id:s.id+' · '+parents;
}
function experimentMetadataFields(prefix,metadata){
  return '<div class="experiment-metadata"><label>Nom de l’expérience <input class="control" id="'+prefix+'Name" type="text" maxlength="100" value="'+esc(metadata.name||'')+'" placeholder="Nom court (facultatif)"></label><label>Description <textarea class="control" id="'+prefix+'Description" rows="4" placeholder="Conditions et objectif de l’expérience">'+esc(metadata.description||'')+'</textarea></label></div>';
}
const experimentNumber=(v,digits=1)=>BreedingMath.numeric(v)?Number(v.toFixed(digits)).toString():'Inconnu';
const experimentPercent=v=>v===null||v===undefined?'Indéterminé':(100*v).toFixed(1)+' %';
const experimentGenes=g=>BreedingMath.keys.map((key,i)=>key+experimentNumber(g[i])).join(' / ');
function experimentPetHtml(p,genes=null){
  if(!p)return '<span>Animal inconnu</span>';
  if(!hasPetName(p))return '';
  const data=experimentData,g=genes||BreedingMath.genetics(p);
  const parent=side=>{
    const id=p[side+'_bt_id'],known=data.byId.get(id);
    const name=known?.name||p[side]||'Inconnu';
    return esc(canonicalName(name)||'Inconnu')+' — '+esc(id||'BT_ID inconnu');
  };
  return '<div class="experiment-pet"><strong>'+esc(canonicalName(p.name)||'Inconnu')+' — '+esc(p.sex||'Sexe inconnu')+' — '+esc(p.bt_id||'BT_ID inconnu')+'</strong>'+
    '<span>Mother : '+parent('mother')+'<br>Father : '+parent('father')+'</span><span>Bloodline : '+esc(p.lineage||'Inconnue')+'</span>'+
    '<span>Genetics : '+esc(experimentGenes(g))+'</span><span>Total : '+experimentNumber(BreedingMath.sum(g))+'</span></div>';
}
function experimentParentHtml(p,sex,genes,expectedId=null){
  if(p)return experimentPetHtml(p,genes);
  const full=genes.every(v=>v===genes[0])&&genes[0]!==null;
  if(expectedId)return '<div class="experiment-warning">Reproducteur '+esc(expectedId)+' indisponible. Une création Rada ne remplace pas ce BT_ID.</div>';
  return '<div class="experiment-warning"><strong>Create with Rada: '+sex+' '+(full?'Full '+genes[0]:esc(experimentGenes(genes)))+'</strong><p>Animal à créer, pas encore présent. Nom, BT_ID, parents et bloodline inconnus ; genetics demandées : '+esc(experimentGenes(genes))+' ; total demandé : '+experimentNumber(BreedingMath.sum(genes))+'. Attendre son apparition comme adulte actif dans le JSON.</p></div>';
}
function experimentTable(headers,rows){return '<div class="experiment-table-scroll"><table class="experiment-table"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
function experimentHistogram(bins,i,title=null,unit='tirages'){
  const max=Math.max(1,...bins),n=bins.reduce((a,b)=>a+b,0);
  return '<div class="experiment-chart"><h3>'+(title||BreedingMath.names[i]+' ('+BreedingMath.keys[i]+')')+' — '+n+' '+unit+'</h3><div class="experiment-histogram">'+
    bins.map((count,v)=>'<div class="experiment-bin" title="'+count+' '+unit+' de valeur '+v+'"><span>'+count+'</span><div class="experiment-bar" style="height:'+Math.round(100*count/max)+'px"></div><span>'+v+'</span></div>').join('')+'</div></div>';
}

const experimentDecimal=v=>BreedingMath.numeric(v)?v.toLocaleString('fr-FR',{maximumFractionDigits:2}):'—';
function experimentSigned(v){if(!BreedingMath.numeric(v))return '—';const rounded=Math.round(v*100)/100;return (rounded>0?'+':rounded<0?'−':'')+Math.abs(rounded).toLocaleString('fr-FR',{minimumFractionDigits:rounded===0?0:2,maximumFractionDigits:2})}
function experimentComparisonHtml(comparisons){
  return '<div class="experiment-comparisons">'+[['father','père'],['mother','mère']].map(([key,label])=>{
    const c=comparisons[key];return '<div><h4>Par rapport au '+label+'</h4><dl>'+[['lower','Inférieure'],['equal','Égale'],['higher','Supérieure']].map(([kind,text])=>'<div><dt>'+text+'</dt><dd>'+c[kind]+' / '+c.n+' — '+(c.n?experimentPercent(c.frequencies[kind]):'—')+'</dd></div>').join('')+'</dl><p>Δ moyen '+label+' : <strong>'+experimentSigned(c.mean_delta)+'</strong> points</p></div>';
  }).join('')+'</div>';
}
function experimentDistributionHtml(ctx,grouped){
  const d=ctx.results.descriptive;
  if(!grouped)return BreedingMath.keys.map((_,i)=>experimentHistogram(ctx.results.histograms[i].counts,i)+experimentComparisonHtml(d.parent_comparisons[i])).map(html=>'<div class="experiment-distribution">'+html+'</div>').join('');
  const a=d.aggregate_distribution;
  const warning=a.parental_conditions==='mixed_across_stats'?'Les valeurs parentales diffèrent selon les stats : ce regroupement mélange des conditions différentes et peut masquer leurs comportements.':a.parental_conditions==='unknown'?'Valeurs parentales incomplètes : les conditions des sept stats ne peuvent pas toutes être comparées.':'';
  return '<div class="experiment-distribution">'+experimentHistogram(a.counts,null,'Sept stats regroupées','valeurs')+'<p><strong>'+a.n+' valeurs — '+a.draws+' tirages'+(a.complete?' × 7 stats':', jusqu’à 7 stats par tirage')+'</strong></p><p>Valeurs regroupées : elles ne constituent pas '+a.n+' naissances indépendantes. Une distribution commune aux sept stats reste une hypothèse non démontrée.</p>'+(warning?'<p class="experiment-warning">'+warning+'</p>':'')+experimentComparisonHtml(d.aggregate_parent_comparisons)+'</div>';
}
function experimentGenerationNumbers(ctx){
  const g=ctx.results.descriptive.generation_comparison;if(!g)return '';
  return '<p class="experiment-generation-numbers" id="experimentGenerationNumbers">G0 : <strong>'+experimentDecimal(g.g0)+'</strong> | G1 : <strong>'+experimentDecimal(g.g1)+'</strong> | Δ : <strong>'+experimentSigned(g.delta)+'</strong></p>';
}

function experimentEstimateHtml(fit,bound){
  if(!fit)return '<p>Indéterminé : estimation commune non justifiée.</p>';
  const variation=BreedingMath.variations(bound);
  return '<div class="experiment-estimate"><span>Père : '+experimentPercent(fit.p)+' · Mère : '+experimentPercent(fit.p===null?null:1-fit.p)+'</span>'+
    '<span>Variation négative : '+experimentPercent(fit.negative)+' · nulle : '+experimentPercent(fit.zero)+' · positive : '+experimentPercent(fit.positive)+'</span>'+
    '<span>'+variation.map((v,i)=>(v>0?'+':'')+v+' : '+experimentPercent(fit.q[i])).join(' · ')+'</span>'+
    '<span>'+fit.n+' observations / '+fit.births+' naissances distinctes. '+(fit.converged===false?'EM non convergé : paramètres indéterminés.':'')+'</span></div>';
}
function experimentEvaluationHtml(analysis,bound){
  return experimentTable(['Stat','Analysables / naissances','Père seul / mère seule / les deux','Contradictions A / B','Compatibilité observée A','Statut et estimation EM'],
    analysis.stats.map((s,i)=>[BreedingMath.names[i],s.n+' / '+s.births,
      s.counts.father+' / '+s.counts.mother+' / '+s.counts.both,s.counts.neither+' / '+s.alternativeContradictions,
      s.compatibility===null?'Indéterminé':s.compatibility.toFixed(1)+' %',
      (s.counts.neither?'Hypothèse contredite':s.births<20?'Données insuffisantes':'Compatible à ce stade')+experimentEstimateHtml(s.estimate,bound)]));
}
function experimentSumGraph(totals,generations){
  const known=generations.filter(g=>g.generation!==null),xs=known.map(g=>g.generation);
  if(!xs.length)return '<p>Graphique indisponible : générations inconnues.</p>';
  const minG=Math.min(...xs),maxG=Math.max(...xs),x=g=>xs.length===1?350:45+(g-minG)/(maxG-minG)*610,y=total=>210-total/70*170;
  const points=totals.filter(e=>e.generation!==null&&e.reliable&&e.complete&&e.child!==null);
  const means=known.filter(g=>g.mean!==null);
  return '<svg class="experiment-sum-chart" viewBox="0 0 700 250" role="img" aria-label="Totaux individuels par génération et moyenne"><path d="M45 30 V210 H675" fill="none" stroke="currentColor"/>'+
    [0,35,70].map(v=>'<text x="5" y="'+(y(v)+4)+'">'+v+'</text>').join('')+
    points.map(e=>'<circle cx="'+x(e.generation)+'" cy="'+y(e.child)+'" r="4"><title>'+esc(e.event_id)+' · G'+e.generation+' · Total '+e.child+'</title></circle>').join('')+
    '<polyline points="'+means.map(g=>x(g.generation)+','+y(g.mean)).join(' ')+'" fill="none" stroke="var(--female)" stroke-width="2"/>'+
    known.map(g=>'<text x="'+x(g.generation)+'" y="238" text-anchor="middle">G'+g.generation+'</text>').join('')+'</svg><p>Points : un total par naissance indépendante ; ligne : moyenne descriptive. Une hausse peut provenir de la sélection des reproducteurs, sans prouver une mutation positive ou un effet de génération.</p>';
}

// Experiment presentation preferences are independent of scientific state and other tabs.
const experimentLayoutKey='breeding-advisor-experiment-layout-v1';
let experimentLayout={order:[],collapsed:{}};
try{const saved=JSON.parse(localStorage.getItem(experimentLayoutKey));if(saved&&Array.isArray(saved.order)&&saved.collapsed&&typeof saved.collapsed==='object')experimentLayout=saved}catch{}
function initializeExperimentBlocks(){
  const ids=['context','presentation','sample','totals','distributions','hypotheses','bloodlines','publication','advanced'];
  const names=['Contexte','Présentation','Échantillon','Totaux','Distributions','Hypothesis Lab','Bloodlines','Publication','Analyses avancées'];
  const sections=[...experimentWrap.children];
  // History has no controlled presentation; stable IDs must not depend on visible positions.
  let index=0;
  const save=()=>{try{localStorage.setItem(experimentLayoutKey,JSON.stringify(experimentLayout));const old=document.getElementById('experimentLayoutMessage');old?.remove()}catch{let message=document.getElementById('experimentLayoutMessage');if(!message){message=document.createElement('p');message.id='experimentLayoutMessage';experimentWrap.appendChild(message)}message.textContent='Disposition en mémoire seulement : stockage local indisponible.'}};
  for(const section of sections){
    if(index===1&&!section.querySelector('#experimentChoose'))index++;
    const id=ids[index++];if(!id)continue;
    section.dataset.blockId=id;section.classList.add('movable-block','experiment-movable');
    let heading=section.querySelector(':scope > .experiment-chart-heading')||section.querySelector(':scope > h2');
    if(!heading)continue;
    heading.classList.add('experiment-block-heading');
    const handle=document.createElement('button');handle.type='button';handle.className='block-drag-handle';handle.draggable=true;handle.textContent='⠿';handle.title='Déplacer cette section';handle.setAttribute('aria-label',handle.title);section.appendChild(handle);
    const key='experiment:'+id;collapsedBlocks.set(key,experimentLayout.collapsed[id]??(id==='advanced'));
    makeCollapsible(section,key,{keep:'.experiment-block-heading',label:names[ids.indexOf(id)],onChange:value=>{experimentLayout.collapsed[id]=value;save()}});
    heading.addEventListener('click',e=>{if(!e.target.closest('button,input,select,textarea,a'))section.querySelector(':scope > .collapse-toggle').click()});
  }
  initializeBlockOrdering(experimentWrap,{apply:()=>{
    const order=[...experimentLayout.order,...ids.filter(id=>!experimentLayout.order.includes(id))];
    order.forEach(id=>{const block=[...experimentWrap.children].find(b=>b.dataset.blockId===id);if(block)experimentWrap.appendChild(block)});
  },save:()=>{experimentLayout.order=[...experimentWrap.children].filter(b=>b.dataset.blockId).map(b=>b.dataset.blockId);save()}});
}
let experimentBudgetGeneration=new Map();
function renderExperimentBudgetDistribution(ctx){
  const host=document.getElementById('experimentBudgetDistribution');if(!host)return;
  const totals=ctx.results.totals.filter(t=>t.reliable&&t.complete&&Number.isFinite(t.child)&&t.generation!==0);
  const generations=[...new Set(totals.map(t=>t.generation))].sort((a,b)=>a===null?1:b===null?-1:a-b);
  if(!generations.length){host.innerHTML='<p>Aucun budget descendant complet et fiable disponible. G0 décrit les fondateurs, pas une distribution de descendants.</p>';return}
  const key=ctx.experiment_id||'history';let g=experimentBudgetGeneration.get(key);if(!generations.includes(g))g=generations[0];
  const draw=()=>{
    experimentBudgetGeneration.set(key,g);
    const selected=totals.filter(t=>t.generation===g),bins=new Map();selected.forEach(t=>bins.set(t.child,(bins.get(t.child)||0)+1));
    const mean=selected.reduce((sum,t)=>sum+t.child,0)/selected.length,max=Math.max(...bins.values()),g0=ctx.results.descriptive.generation_comparison?.g0;
    const label=g===null?'Génération inconnue':'G'+g;
    host.innerHTML='<h3>Distribution des budgets individuels — '+label+'</h3><label>Génération des descendants <select class="control" id="experimentBudgetGeneration">'+generations.map(v=>'<option value="'+v+'"'+(v===g?' selected':'')+'>'+(v===null?'Génération inconnue':'G'+v)+'</option>').join('')+'</select></label><p><strong>Moyenne '+label+' : '+experimentDecimal(mean)+' · '+selected.length+' naissances indépendantes</strong>'+(ctx.experiment_id&&g===1&&Number.isFinite(g0)?' · Δ par rapport à G0 : '+experimentSigned(mean-g0):'')+'</p><div class="experiment-budget-bars" role="img" aria-label="Budgets individuels : '+[...bins].sort((a,b)=>a[0]-b[0]).map(([v,n])=>v+' points : '+n+' naissances').join(', ')+'">'+[...bins].sort((a,b)=>a[0]-b[0]).map(([v,n])=>'<div class="experiment-budget-bin" data-budget="'+v+'" data-count="'+n+'"><strong>'+n+'</strong><div style="height:'+Math.max(1,180*n/max)+'px"></div><span>'+v+'</span></div>').join('')+'</div><p class="small">Axe horizontal : budget total de l’enfant. Axe vertical : effectif, indiqué sur chaque barre. Un poids par tirage fiable ; jumeaux liés et exclusions traités comme dans le graphique. G0 reste la moyenne des totaux des fondateurs.</p>';
    host.querySelector('select').onchange=e=>{g=e.target.value==='null'?null:Number(e.target.value);draw()};
  };draw();
}


// Resolve selected parent IDs directly from the census, including archived animals.
// A projection never reconstructs parents from offspring events.
function experimentHypothesisParents(ctx){
  let motherId=null,fatherId=null;
  if(ctx.type==='controlled_experiment'){
    const series=experimentSessions().find(s=>s.id===ctx.experiment_id);
    motherId=series?.femaleId||experimentSelection?.femaleId;fatherId=series?.maleId||experimentSelection?.maleId;
  }else if(experimentScope.startsWith('pair:')){
    try{[motherId,fatherId]=JSON.parse(experimentScope.slice(5))}catch{}
  }
  if(!motherId||!fatherId)return null;
  const mother=experimentData.byId.get(motherId),father=experimentData.byId.get(fatherId);
  return {mother:BreedingMath.genetics(mother),father:BreedingMath.genetics(father),motherId,fatherId,motherName:mother?.name||null,fatherName:father?.name||null};
}

function experimentViewContext(){
  const series=experimentSessions().find(s=>s.id===experimentState.selectedExperimentId)||null;
  const controlled=experimentMode==='controlled';
  return BreedingMath.context(experimentData,{series:controlled?series:null,controlled,
    scope:experimentScope,generation:experimentGeneration,
    bound:controlled?(series?.analysisBound??experimentState.bound):experimentState.bound,
    target:series?.target??experimentState.target});
}
function renderExperiment(){
  advisorWrap.style.display='none';breedingTableWrap.style.display='none';wrap.style.display='none';
  setViewHeading('Experiment — laboratoire génétique','Snow Wolf · V/F/P/R/T/A/I · comprendre la transmission, sans objectif de score.');countText.textContent='';
  if(!experimentData){experimentWrap.innerHTML='<p>Connecter le census et sélectionner un compte et un monde.</p>';return}
  const data=experimentData,state=experimentState,controlled=experimentMode==='controlled';
  const ctx=experimentViewContext(),series=controlled?experimentSessions().find(s=>s.id===ctx.experiment_id):null;
  const {events,graphEvents}=ctx,{analysis,capture:counts,generations,bloodlines:blood}=ctx.results;
  const bound=series?.analysisBound??state.bound,target=series?.target??state.target;
  const active=Boolean(series&&series.id===state.series?.id),running=Boolean(active&&series.status!=='ended'),progress=counts.analysable,complete=Boolean(series&&progress>=target);
  const label=controlled?(series?experimentDisplayName(series):'Expérience contrôlée — aucune série'):'Historique global';
  const titleHtml='<span data-experiment-title>'+esc(label)+'</span>';
  const next=controlled?BreedingMath.recommend({...data,events,rows:events.flatMap(e=>e.members)},{...state,series,target,bound},analysis):null;
  const current=series?{female:data.breeders.find(p=>p.bt_id===series.femaleId),male:data.breeders.find(p=>p.bt_id===series.maleId),maternal:BreedingMath.genetics(data.byId.get(series.femaleId)),paternal:BreedingMath.genetics(data.byId.get(series.maleId))}:null;
  if(!experimentSelection&&next)experimentSelection={femaleId:next.female?.bt_id||'',maleId:next.male?.bt_id||'',reason:next.reason};
  const selection=experimentSelection||{},pair={female:data.breeders.find(p=>p.bt_id===selection.femaleId),male:data.breeders.find(p=>p.bt_id===selection.maleId),reason:selection.reason||'Couple choisi pour étudier ses sept stats réelles.'};
  const startReason=state.series&&state.series.status!=='ended'?'Terminer la série en cours '+state.series.id+' avant de démarrer un autre couple.':!pair.female||!pair.male?'Choisir deux reproducteurs adultes actifs, Female et Male, présents dans le JSON.':'';
  const sendReason=!running?'Seule l’expérience actuellement en cours peut envoyer son couple.':!current.female||!current.male?'Les deux reproducteurs doivent être adultes actifs dans le JSON.':!localDirectoryHandle||!selectedDataset?'Connecter le dossier BreedingTool et sélectionner le compte.':BTView.saving?'Une sauvegarde est déjà en cours.':'';
  const pairOptions=[...new Map(data.rows.map(r=>[r.key,r])).values()];
  const configurations=[...new Map(data.events.filter(e=>e.maternal.some(BreedingMath.numeric)&&e.paternal.some(BreedingMath.numeric)).map(e=>[JSON.stringify([e.maternal,e.paternal]),e])).entries()];
  const scopeOptions=[['all','Tout l’historique'],...pairOptions.map(r=>['pair:'+r.key,'Couple '+(r.motherId||'?')+' × '+(r.fatherId||'?')]),...configurations.map(([key,e])=>['genes:'+key,'Configuration ♀ '+experimentGenes(e.maternal)+' × ♂ '+experimentGenes(e.paternal)])];
  const selectedOptions=scopeOptions.map(([value,text])=>'<option value="'+esc(value)+'"'+(value===experimentScope?' selected':'')+'>'+esc(text)+'</option>').join('');
  const generationOptions=[...new Set(data.events.map(e=>e.generation))].sort((a,b)=>a===null?1:b===null?-1:a-b);
  const rowIdentity=e=>experimentPetHtml(e.pet,e.child)+'<span class="small">'+(e.generation===null?'Génération inconnue':'G'+e.generation)+' · tirage '+esc(e.drawId)+'</span>';
  const action=(id,text,reason)=>'<span class="experiment-action"><button class="control" id="'+id+'"'+(reason?' disabled aria-describedby="'+id+'Reason" title="'+esc(reason)+'"':'')+'>'+text+'</button>'+(reason?'<small id="'+id+'Reason">'+esc(reason)+'</small>':'')+'</span>';
  const breederOptions=sex=>'<option value="">Sélectionner</option>'+data.breeders.filter(p=>hasPetName(p)&&p.sex===sex).map(p=>'<option value="'+esc(p.bt_id)+'"'+(p.bt_id===(sex==='Female'?selection.femaleId:selection.maleId)?' selected':'')+'>'+esc(canonicalName(p.name))+' — '+sex+' — '+esc(p.bt_id)+' — '+esc(experimentGenes(BreedingMath.genetics(p)))+'</option>').join('');
  const bloodLabels={father:'Père uniquement (parents différents)',mother:'Mère uniquement (parents différents)',other:'Différente des deux parents',same:'Parents identiques : même Bloodline héritée (origine ambiguë)',sameOther:'Parents identiques : Bloodline différente'};
  experimentWrap.innerHTML=
    '<section class="experiment-context '+(controlled?'is-controlled':'is-history')+'"><div class="experiment-actions"><button class="control" id="experimentControlled" aria-pressed="'+controlled+'">Expérience contrôlée</button><button class="control" id="experimentHistory" aria-pressed="'+!controlled+'">Historique global</button></div><h2 id="experimentContextTitle">'+titleHtml+'</h2>'+
    (controlled?'<label>Expérience sélectionnée <select class="control" id="experimentSelected"'+(experimentSessions().length?'':' disabled')+'>'+experimentSessions().map(s=>'<option value="'+esc(s.id)+'"'+(s.id===state.selectedExperimentId?' selected':'')+'>'+esc(experimentOptionLabel(s))+'</option>').join('')+'</select></label><p>Seuls les tirages enregistrés pour cet identifiant entrent dans les résultats. Les naissances antérieures restent dans l’historique.</p>':'<p>Analyse historique indépendante. Ces résultats ne sont pas ceux de l’expérience sélectionnée ; celle-ci reste la référence primaire de l’export.</p><div class="experiment-controls"><label>Croisements <select class="control" id="experimentScope">'+selectedOptions+'</select></label><label>Génération <select class="control" id="experimentGeneration"><option value="all">Toutes</option>'+generationOptions.map(g=>'<option value="'+g+'"'+(String(g)===experimentGeneration?' selected':'')+'>'+(g===null?'Génération inconnue':'G'+g)+'</option>').join('')+'</select></label></div>')+'</section>'+
    (controlled?'<section class="experiment-section"><h2>Présentation de l’expérience</h2>'+ (series?'<p>Identifiant technique : <code>'+esc(series.id)+'</code></p>'+experimentMetadataFields('experimentInfo',series)+'<p class="small" id="experimentMetadataState" role="status">Modifications enregistrées automatiquement, même après clôture.</p>':'')+'<p>Snow Wolf · '+(series?(running?'En cours':'Terminée'):'Aucune expérience démarrée')+'</p>'+(series?'<div class="experiment-pair">'+experimentParentHtml(data.byId.get(series.femaleId),'Female',current.maternal,series.femaleId)+experimentParentHtml(data.byId.get(series.maleId),'Male',current.paternal,series.maleId)+'</div><p><strong>Progression : '+progress+' / '+target+' tirages analysables</strong></p><progress aria-label="Progression de l’expérience sélectionnée" max="'+target+'" value="'+Math.min(progress,target)+'"></progress>'+(complete&&running?'<p>Objectif atteint. Terminer la série ou poursuivre explicitement pour augmenter l’échantillon.</p>':'')+(series.legacy?'<p>Série V8/V2 P1 conservée.</p>':''):'<p>Choisir un couple puis démarrer le suivi. Les naissances déjà connues sont exclues de sa progression.</p>')+
    '<div class="experiment-actions">'+action('experimentChoose',series?'Préparer un autre couple':'Choisir le couple','')+action('experimentEnd','Terminer l’expérience',!running?'Cette expérience n’est pas la série actuellement en cours.':'')+action('experimentSend','Envoyer le couple au Breeding Panel',sendReason)+action('experimentExclude','Exclure de l’expérience',!series?'Sélectionner une expérience contrôlée.':'')+'</div><p id="experimentExclusionState" role="status"></p><section class="experiment-card experiment-exclusions" id="experimentExclusions" hidden></section><span id="experimentSendState" role="status"></span><div class="experiment-card" id="experimentChooser"'+(experimentChoosing||!series?'':' hidden')+'><h3>Choisir et démarrer</h3>'+experimentMetadataFields('experimentNewInfo',experimentMetadataDraft)+'<p>La sélection, le démarrage et l’envoi au jeu sont trois actions distinctes.</p><div class="experiment-controls"><label>Femelle <select class="control" id="experimentFemale">'+breederOptions('Female')+'</select></label><label>Mâle <select class="control" id="experimentMale">'+breederOptions('Male')+'</select></label><label>Objectif de la nouvelle série <input class="control" id="experimentNewTarget" type="number" min="1" step="1" value="'+state.target+'"></label></div><div class="experiment-pair">'+(pair.female?experimentPetHtml(pair.female):'<p>Femelle à sélectionner.</p>')+(pair.male?experimentPetHtml(pair.male):'<p>Mâle à sélectionner.</p>')+'</div>'+action('experimentStart','Démarrer l’expérience',startReason)+'</div></section>':'')+
    '<section class="experiment-section"><h2>Échantillon étudié — '+titleHtml+'</h2>'+(controlled?'<p>'+ctx.results.manual_exclusions.events+' tirage(s) / '+ctx.results.manual_exclusions.individuals+' individu(s) exclus manuellement de cette expérience, conservés dans le cheptel et l’historique global. Les compteurs et graphiques ci-dessous portent sur les tirages restants.</p>':'')+'<div class="experiment-metrics"><div><strong>'+counts.individuals+'</strong><span>individus descendants observés</span></div><div><strong>'+counts.events+'</strong><span>événements capturés après regroupement</span></div><div><strong>'+counts.draws+'</strong><span>tirages distincts exploitables selon les liens connus</span></div><div><strong>'+counts.linkedTwins+'</strong><span>individus jumeaux supplémentaires reliés ('+counts.twinGroups+' groupes)</span></div><div><strong>'+counts.uncertainEvents+'</strong><span>événements incertains exclus</span></div></div><p>'+counts.analysable+' tirages fournissent au moins une stat analysable. Un jumeau sans lien explicite peut rester non reconnu : '+counts.linkedTwins+' jumeaux reliés ne prouve pas l’absence d’autres jumeaux.</p>'+(ctx.results.quality.possible_unassigned.length?'<p class="experiment-warning">'+ctx.results.quality.possible_unassigned.length+' individus à association possible mais non démontrée, hors de cet échantillon. Ils sont identifiés dans les analyses avancées.</p>':'')+'</section>'+
    '<section class="experiment-section"><div class="experiment-chart-heading"><h2>Total génétique par génération — '+titleHtml+'</h2>'+experimentGenerationNumbers(ctx)+'</div><p>Somme V/F/P/R/T/A/I de 0 à 70. Points : un total complet par tirage ; ligne : moyenne descriptive. G0 : moyenne des totaux des deux parents fondateurs ; G1 : moyenne des totaux complets de leurs descendants G1, un poids par tirage fiable.</p>'+(controlled&&generations.filter(g=>g.generation!==null).length===1?'<p>Cette expérience ne couvre qu’une génération. L’évolution entre générations ne peut pas encore être étudiée.</p>':'')+experimentSumGraph(ctx.results.totals,generations)+'<div id="experimentBudgetDistribution"></div></section>'+
    '<section class="experiment-section"><h2>Sept distributions — '+titleHtml+'</h2><p>Valeurs de 0 à 10 ; nombres au-dessus des barres : effectifs réels. Un groupe gémellaire fiable compte une fois. Chaque histogramme affiche son propre nombre de valeurs disponibles.</p>'+(controlled?'<label class="experiment-checkbox"><input id="experimentGroupDistributions" type="checkbox"'+(experimentGrouped?' checked':'')+'> Regrouper les 7 distributions</label>':'')+'<div class="experiment-charts'+(controlled&&experimentGrouped?' is-aggregated':'')+'" id="experimentMainHistograms">'+experimentDistributionHtml(ctx,controlled&&experimentGrouped)+HypothesisLab.slot+'</div><p>Inférieure et supérieure sont des comparaisons strictes ; égale reste distincte. Chaque parent a son propre effectif de valeurs exploitables. Les écarts observés ne prouvent pas des mutations ni un mécanisme d’héritage.</p></section>'+
    '<section class="experiment-section"><h2>Hypothesis Lab</h2><div class="hypothesis-lab" id="hypothesisLab"></div></section>'+
    '<section class="experiment-section"><h2>Bloodlines — '+titleHtml+'</h2><p>'+blood.n+' tirages exploitables et '+blood.excluded+' événements exclus. Aucun héritage limité aux parents n’est présupposé.</p>'+experimentTable(['Bloodline','Effectif','Fréquence'],ctx.results.descriptive.bloodline_display.rows.map(r=>[esc(r.label),r.count+' / '+r.n,experimentPercent(r.frequency)]))+(ctx.results.descriptive.bloodline_display.note?'<p class="small">'+esc(ctx.results.descriptive.bloodline_display.note)+'</p>':'')+'</section>'+
    '<section class="experiment-section"><h2>Partager les résultats</h2><p>Publier l’expérience primaire sélectionnée, toutes les expériences conservées, l’historique indépendant et les observations originales. Ouvrir l’historique ne remplace pas l’expérience primaire. Destination privée : research/genetics/latest.json.</p><button class="control" id="experimentPublish"'+(experimentPublishing?' disabled title="Publication en cours"':'')+'>Publier sur GitHub</button><p id="experimentPublishState" role="status"></p></section>'+
    '<section id="experimentAdvanced" class="experiment-advanced"><h2>Analyses avancées et observations individuelles</h2>'+experimentTable(['Bloodlines : détail méthodologique','Effectif','Fréquence'],Object.entries(blood.counts).map(([k,n])=>[bloodLabels[k],n,experimentPercent(blood.frequencies[k])]))+'<p>Les tableaux conservent toutes les données disponibles, y compris les observations exclues. Paramètres exploratoires : « Indéterminé » si les données ne permettent pas de les estimer.</p><label>Amplitude supposée ± <input class="control" id="experimentBound" type="number" min="0" max="10" step="1" value="'+bound+'"></label><section class="experiment-section"><h2>Variations du total</h2>'+experimentTable(['Descendant (fiche complète)','Père / mère / enfant','Enfant − père','Enfant − mère','Enfant − moyenne'],events.filter(e=>hasPetName(e.pet)).map(e=>{const t=BreedingMath.totals(e);return [rowIdentity(e),[t.father,t.mother,t.child].map(v=>experimentNumber(v)).join(' / '),experimentNumber(t.df),experimentNumber(t.dm),experimentNumber(t.da)]}))+'</section>'+
    '<section class="experiment-section"><h2>Inheritance Analysis</h2><p>Deux deltas sont conservés. La compatibilité tient compte du plafonnement 0–10 : un delta affiché nul peut cacher plusieurs variations latentes. Les données parentales manquantes restent inconnues.</p>'+
    events.filter(e=>hasPetName(e.pet)).map(e=>'<details class="experiment-birth"><summary>'+esc(canonicalName(e.pet.name))+' — '+esc(e.pet.sex||'Inconnu')+' — '+esc(e.pet.bt_id)+' · '+(e.generation===null?'Génération inconnue':'G'+e.generation)+'</summary>'+rowIdentity(e)+experimentTable(['Stat','Père','Mère','Enfant','DeltaFather','DeltaMother','Classification ±'+bound],BreedingMath.keys.map((key,i)=>{
      const o=BreedingMath.observations([e],i,bound)[0];return [key,experimentNumber(e.paternal[i]),experimentNumber(e.maternal[i]),experimentNumber(e.child[i]),experimentNumber(o.df),experimentNumber(o.dm),{father:'Compatible père uniquement',mother:'Compatible mère uniquement',both:'Compatible avec les deux (ambigu)',neither:'Incompatible avec les deux',unknown:'Non analysable'}[o.kind]];
    }))+'</details>').join('')+'</section>'+
    '<section class="experiment-section"><h2>Hypothesis Evaluation</h2><p>A : valeur du père ou de la mère, puis variation discrète entre −'+bound+' et +'+bound+', plafonnée à 0–10. B : moyenne parentale arrondie (0,5 vers le haut), puis même variation. Ces règles restent des hypothèses. « Compatibilité observée » n’est pas la probabilité que l’hypothèse soit vraie.</p>'+
    experimentEvaluationHtml(analysis,bound)+'<p>Les probabilités sont des estimations EM exploratoires par maximum de vraisemblance marginale. Au moins 20 naissances distinctes sont requises pour afficher un paramètre ; ce seuil ne garantit pas sa précision. Non-identifiabilité locale, maxima équivalents ou absence de convergence : Indéterminé. Les catégories déterminées totalisent 100 % avant arrondi ; les valeurs indéterminées ne sont pas complétées arbitrairement.</p>'+
    '<h3>Comparaison et estimation globale</h3><p>'+analysis.n+' observations de stats / '+analysis.births+' naissances ; père seul '+analysis.counts.father+', mère seule '+analysis.counts.mother+', ambiguës '+analysis.counts.both+', contradictions '+analysis.counts.neither+', non analysables '+analysis.counts.unknown+'. Compatibilité observée : '+(analysis.compatibility===null?'Indéterminée':analysis.compatibility.toFixed(1)+' %')+'.</p><p>'+esc(analysis.commonReason)+'</p>'+experimentEstimateHtml(analysis.common,bound)+
    '<p>Le contrôle entre stats compare des valeurs appariées d’une même naissance avec mêmes valeurs parentales, au moins 40 naissances par paire ; il reste exploratoire et peut manquer de puissance. Le calcul commun ne transforme jamais sept stats en sept naissances indépendantes ; aucune précision statistique fondée sur cette indépendance n’est annoncée.</p><h3>Choix parental commun à plusieurs stats ?</h3><p>Origines : seuls résultats non ambigus (sélection potentiellement biaisée). Résidus : valeurs enfants centrées par combinaison parentale, sans attribuer leur origine. Ces corrélations descriptives ne démontrent ni un tirage parental commun ni une variation commune.</p>'+
    experimentTable(['Stats','Naissances non ambiguës','Même origine possible','Corrélation des origines φ','Naissances analysables','Corrélation des résidus'],analysis.correlations.map(c=>[BreedingMath.keys[c.i]+' / '+BreedingMath.keys[c.j],c.n,c.agree+' / '+c.n,c.phi===null?'Indéterminée':c.phi.toFixed(2),c.residualN,c.residual===null?'Indéterminée':c.residual.toFixed(2)]))+'</section>'+
    '<section class="experiment-section"><h2>Generations</h2><p>G0 : animaux sans parenté déclarée (fondateurs selon le census). Deux générations parentales connues : 1 + maximum. Lien absent, parent manquant ou cycle : Génération inconnue. Les générations affichées appartiennent exclusivement au périmètre sélectionné. Les différences sont descriptives : la sélection et les configurations parentales peuvent les expliquer.</p>'+
    experimentTable(['Génération','Naissances indépendantes','Total moyen / effectif complet','Écart à la génération précédente connue','Compatibilité observée A'],generations.map((g,i)=>{
      const previous=generations.find(p=>g.generation!==null&&p.generation===g.generation-1);
      return [g.generation===null?'Génération inconnue':'G'+g.generation,g.events,experimentNumber(g.mean)+' / '+g.totalCount,previous&&previous.mean!==null&&g.mean!==null?experimentNumber(g.mean-previous.mean):'Inconnu',g.analysis.compatibility===null?'Indéterminée':g.analysis.compatibility.toFixed(1)+' %'];
    }))+generations.map(g=>'<details><summary>'+(g.generation===null?'Génération inconnue':'G'+g.generation)+' — distributions et estimations</summary><div class="experiment-charts">'+BreedingMath.keys.map((_,i)=>experimentHistogram(g.histograms[i],i)).join('')+'</div>'+experimentEvaluationHtml(g.analysis,bound)+'<p>'+esc(g.analysis.commonReason)+'</p>'+experimentEstimateHtml(g.analysis.common,bound)+'</details>').join('')+'</section>'+
    '<section class="experiment-section"><h2>Observations</h2><p>Archives et morts conservés. Les BT_ID complets relient les animaux ; noms et bloodlines ne servent jamais de clé. '+events.flatMap(e=>e.members).filter(r=>r.childChanged).length+' individus ont des genetics actuelles différentes des valeurs déjà observées : les premières valeurs mémorisées sont conservées.</p>'+
    experimentTable(['Descendant — fiche complète','État / génération','Événement indépendant / série','Valeurs parentales utilisées'],events.flatMap(e=>e.members.filter(r=>hasPetName(r.pet)).map(r=>[
      experimentPetHtml(r.pet,r.child),esc(r.pet.lifecycle_state)+' / '+(r.generation===null?'Génération inconnue':'G'+r.generation),esc(e.drawId)+'<br>'+esc(r.sessionId||'Hors expérience')+'<br>'+(r.twinIssue?'Lien twin_source non fiable, exclu des estimations':e.members.length>1?'Jumeaux : un seul événement':'Événement distinct'),
      BreedingMath.captureFlags(r).map(esc).join('<br>')+(r.parentEvidence==='controlled_record'?'<br>BT_ID parentaux déjà capturés dans l’enregistrement contrôlé : '+esc(r.motherId)+' / '+esc(r.fatherId)+' (parenté originale conservée ci-contre).':'')+'<br>Père : '+esc(experimentGenes(r.paternal))+'<br>Mère : '+esc(experimentGenes(r.maternal))+(e.conflict.some(Boolean)?'<br><span class="experiment-warning">Stats gémellaires contradictoires exclues.</span>':'')
    ])))+'</section>'+ (ctx.results.quality.possible_unassigned.length?'<section class="experiment-section"><h2>Captures possibles hors de l’échantillon contrôlé</h2><p>Ces individus ne participent à aucun résultat de cette expérience. Un parent connu correspond, ce qui ne démontre ni l’autre filiation, ni une naissance dans cette série.</p>'+ctx.results.quality.possible_unassigned.map(r=>experimentPetHtml(data.byId.get(r.bt_id))).join('')+'</section>':'')+'</section>';

  for(const [suffix,key] of [['Name','name'],['Description','description']]){
    document.getElementById('experimentNewInfo'+suffix)?.addEventListener('input',e=>{experimentMetadataDraft[key]=e.target.value});
    document.getElementById('experimentInfo'+suffix)?.addEventListener('input',e=>{
      series[key]=key==='name'?e.target.value.trim():e.target.value;
      const persisted=saveExperiment();
      document.getElementById('experimentMetadataState').textContent=persisted?'Modifications enregistrées.':'Modifications en mémoire seulement : stockage local indisponible.';
      experimentWrap.querySelectorAll('[data-experiment-title]').forEach(el=>{el.textContent=experimentDisplayName(series)});
      const option=Array.from(document.getElementById('experimentSelected').options).find(o=>o.value===series.id);
      if(option)option.textContent=experimentOptionLabel(series);
    });
  }
  document.getElementById('experimentExclude')?.addEventListener('click',()=>{if(series)openExperimentExclusions(series,ctx)});
  document.getElementById('experimentGroupDistributions')?.addEventListener('change',e=>{experimentGrouped=e.target.checked;const el=document.getElementById('experimentMainHistograms');el.classList.toggle('is-aggregated',experimentGrouped);el.innerHTML=experimentDistributionHtml(ctx,experimentGrouped)+HypothesisLab.slot;HypothesisLab.mount(document.getElementById('hypothesisAverage'),document.getElementById('hypothesisLab'),ctx,experimentHypothesisParents(ctx))});
  document.getElementById('experimentControlled').onclick=()=>{experimentMode='controlled';renderExperiment()};
  document.getElementById('experimentHistory').onclick=()=>{experimentMode='global';renderExperiment()};
  document.getElementById('experimentSelected')?.addEventListener('change',e=>{state.selectedExperimentId=e.target.value;saveExperiment();renderExperiment()});
  document.getElementById('experimentScope')?.addEventListener('change',e=>{experimentScope=e.target.value;renderExperiment()});
  document.getElementById('experimentGeneration')?.addEventListener('change',e=>{experimentGeneration=e.target.value;renderExperiment()});
  document.getElementById('experimentBound').addEventListener('change',event=>{
    const value=Number(event.target.value);if(!Number.isInteger(value)||value<0||value>10){event.target.value=bound;return}
    if(controlled&&series)series.analysisBound=value;else state.bound=value;saveExperiment();renderExperiment();
  });
  document.getElementById('experimentNewTarget')?.addEventListener('change',event=>{const value=Number(event.target.value);if(Number.isInteger(value)&&value>0){state.target=value;saveExperiment()}else event.target.value=state.target});
  document.getElementById('experimentChoose')?.addEventListener('click',()=>{experimentChoosing=true;renderExperiment();document.getElementById('experimentChooser').scrollIntoView({block:'nearest'})});
  for(const [id,key] of [['experimentFemale','femaleId'],['experimentMale','maleId']])document.getElementById(id)?.addEventListener('change',event=>{experimentSelection={...selection,[key]:event.target.value};experimentChoosing=true;renderExperiment()});
  document.getElementById('experimentStart')?.addEventListener('click',()=>{if(!startReason)startExperiment(pair)});
  document.getElementById('experimentEnd')?.addEventListener('click',()=>{if(!running)return;series.status='ended';series.ended=new Date().toISOString();saveExperiment();renderExperiment()});
  document.getElementById('experimentSend')?.addEventListener('click',async()=>{
    if(sendReason)return;
    breedingPanel={female_bt_id:current.female.bt_id,male_bt_id:current.male.bt_id};breedingPanelDirty=true;renderBreedingPairPanel();refreshSelectedDetail();
    const context=experimentContext,button=document.getElementById('experimentSend');button.disabled=true;
    const message=text=>{if(context===experimentContext){const el=document.getElementById('experimentSendState');if(el)el.textContent=text}};
    try{message('Envoi…');const result=await sendBreedingPanel();message(result?.queued?'Couple en attente — utiliser Refresh en jeu.':'Couple déjà courant.')}catch(err){message('Non envoyé : '+err.message)}
    finally{if(context===experimentContext&&button.isConnected)button.disabled=false}
  });

  document.getElementById('experimentPublish').addEventListener('click',openExperimentPublication);showExperimentPublication();
  HypothesisLab.mount(document.getElementById('hypothesisAverage'),document.getElementById('hypothesisLab'),ctx,experimentHypothesisParents(ctx));
  renderExperimentBudgetDistribution(ctx);
  initializeExperimentBlocks();
}

// An explicit publication exports a whitelisted, account-free snapshot. Credentials never enter state.
function experimentExport(){
  const data=experimentData,state=experimentState,bound=state.bound;
  const scalar=x=>typeof x==='string'||typeof x==='number'?x:null;
  const animal=p=>p?{bt_id:p.bt_id,name:p.name||null,sex:p.sex||null,species_key:p.species_key||p.actor_class||null,
    genetics:BreedingMath.genetics(p),bloodline:p.lineage||null,lifecycle_state:p.lifecycle_state,stage:p.stage||null,
    historical:p.historical===true,origin:p.origin||null,
    parents:{mother:{bt_id:p.mother_bt_id||null,label:p.mother||null},father:{bt_id:p.father_bt_id||null,label:p.father||null}},
    twin_source:p.twin_source||null,birth:{date:scalar(p.birth_date),time:scalar(p.birth_time),born_at:scalar(p.born_at)},first_seen:scalar(p.first_seen)}:null;
  const experiments=experimentSessions().map(s=>{
    const analysisBound=s.analysisBound??bound,target=s.target??state.target;
    const ctx=BreedingMath.context(data,{series:s,bound:analysisBound,target});
    const mother=animal(data.byId.get(s.femaleId)),father=animal(data.byId.get(s.maleId));
    return {id:s.id,name:s.name||'',description:s.description||'',status:s.status||(s.id===state.series?.id?'running':'ended'),species:'Snow_Wolf',started:s.started||null,ended:s.ended||null,reason:s.reason||null,
      target_at_start:s.target??null,bound_at_start:s.bound??null,baseline_ids:s.baselineIds,baseline_draws:s.baselineDraws,baseline_pet_ids:s.baselinePetIds||null,
      mother,father,female_bt_id:s.femaleId,male_bt_id:s.maleId,exclusions:s.exclusions||[],
      parameters:{analysis_bound:analysisBound,target,target_source:s.target===undefined?'Current user default; initial target was not recorded':'Experiment target'},
      summary:{...ctx.summary,status:s.status||(s.id===state.series?.id?'running':'ended'),parents:{mother,father}},results:ctx.results};
  });
  const primaryIndex=experiments.findIndex(s=>s.id===state.selectedExperimentId),primary=experiments[primaryIndex]||null;
  const history=BreedingMath.context(data,{bound});
  return {format:'BreedingAdvisorGenetics',format_version:4,published_at:new Date().toISOString(),calculator_version:'Experiment P4',species:'Snow_Wolf',
    genetics_order:BreedingMath.keys,scope:'Selected controlled experiment plus all retained experiments and independent complete history; account identifiers omitted',
    selected_experiment:primary?{id:primary.id,summary_ref:'/experiments/'+primaryIndex+'/summary',results_ref:'/experiments/'+primaryIndex+'/results'}:null,
    experiments,global_history:{summary:history.summary,results:history.results},
    raw_data:{animals:data.pets.map(animal),
      recordings:Object.values(state.records).map(r=>({bt_id:r.id,event_id:r.drawId,female_bt_id:r.femaleId,male_bt_id:r.maleId,experiment_id:r.sessionId,child_genetics:r.child})),
      observations:data.rows.map(r=>({animal:animal(r.pet),analysed_genetics:r.child,event_id:r.drawId,generation:r.generation,experiment_id:r.sessionId,
        capture_flags:BreedingMath.captureFlags(r),current_child_values_differ:r.childChanged,
        analysed_parent_ids:{mother:r.motherId,father:r.fatherId,evidence:r.parentEvidence},event_evidence:r.drawEvidence})),
      events:data.events.map(e=>({event_id:e.drawId,individual_bt_ids:e.members.map(r=>r.pet.bt_id),mother_bt_id:e.motherId,father_bt_id:e.fatherId,
        child:e.child,maternal:e.maternal,paternal:e.paternal,generation:e.generation,conflict:e.conflict,twin_issue:e.twinIssue,session_conflict:e.sessionConflict,experiment_ids:e.sessionIds,
        capture_flags:e.members.flatMap(BreedingMath.captureFlags),included_as_reliable_event:BreedingMath.reliableEvent(e),
        evidence:e.members.map(r=>({bt_id:r.pet.bt_id,event_evidence:r.drawEvidence,parent_evidence:r.parentEvidence,original_twin_source:r.pet.twin_source||null}))}))},
    methodology:{calculator_version:'Experiment P4',source:'Local Breeding Advisor v4.1.0; breeding-math.js collect/context/analyze',
      parameters:{variation_bound:bound,target_draws:state.target,range:[0,10],model_A:'Choose paternal value with p, maternal with 1-p, add discrete delta, then clamp',
      model_B:'Round parental mean with Math.round, add discrete delta, then clamp',parent_values:'Recorded genetics resolved by full BT_ID among ACTIVE and ARCHIVED pets',
      genetics_talents:'Assumed constant; not vanilla probabilities',independence_unit:'Reliable twin_source event; seven stats are not seven independent births',
      em:{starts:[0.15,0.5,0.85],max_iterations:800,tolerance:1e-9,minimum_births:20,identifiability_tolerance:1e-7,equivalent_log_likelihood:1e-5,equivalent_parameter_difference:0.02},
      common_distribution:{minimum_matched_births:40,comparison_multiplier:4.1},generation_rule:'Known founders G0; 1+max of two known parental generations; otherwise unknown'},
      per_experiment_parameters:'experiments[].parameters overrides default analysis bound and target; historical start parameters stay null if not recorded',
      schema_changes:'v3 global results/generations are under global_history.results; original animals/observations/events/recordings are under raw_data; experiments[].results retained',
      birth_metadata:'Only recorded birth fields are exported; first_seen is not a birth date',
      reproduction:'Reconstruct pets from raw_data.animals (bloodline maps to lineage, parents to *_bt_id/labels), and records from raw_data.recordings. collect() retains evidence-based event IDs. context() applies each experiment ID/parents and its explicit exclusions (event ID or retained member BT_ID), or the complete historical scope without controlled exclusions, then computes all results with its analysis bound. No generation filter applies to the primary export.'},
    selected_view:{mode:experimentMode,scope:experimentMode==='controlled'?(primary?'session:'+primary.id:'none'):experimentScope,generation:experimentMode==='controlled'?'all':experimentGeneration}};
}
function showExperimentPublication(){
  const el=document.getElementById('experimentPublishState');if(!el||!experimentPublishResult)return;
  el.textContent=experimentPublishResult.text;
  if(experimentPublishResult.success){const a=document.createElement('a');a.href='https://github.com/taitsuo/chatgpt-icarus/blob/main/research/genetics/latest.json';a.target='_blank';a.rel='noopener noreferrer';a.textContent=' Voir latest.json sur GitHub';el.append(a)}
}
function openExperimentPublication(){
  if(!experimentData||experimentPublishing)return;
  const dialog=document.getElementById('experimentPublishDialog'),form=document.getElementById('experimentPublishForm');
  form.reset();
  const snapshot=experimentExport(),context=experimentContext;
  document.getElementById('experimentPublishSummary').textContent=snapshot.raw_data.observations.length+' individus descendants et '+snapshot.experiments.length+' expériences. Référence primaire : '+(snapshot.selected_experiment?.id||'aucune')+'. Le contexte global reste séparé. Les données seront relues lors de la confirmation.';
  document.getElementById('experimentPublishConfirm').disabled=true;dialog.showModal();
  const input=document.getElementById('experimentGithubToken'),remember=document.getElementById('experimentRememberGithubToken'),forget=document.getElementById('experimentForgetGithubToken'),storageState=document.getElementById('experimentGithubStorageState');
  const tokenKey='breeding-advisor-github-token';
  let storageAvailable=location.protocol==='http:'||location.protocol==='https:';
  remember.disabled=!storageAvailable;
  if(!storageAvailable)storageState.textContent='Mémorisation non proposée en file:// : persistance non garantie. Ouvrir sur une adresse locale stable ou utiliser un gestionnaire de mots de passe.';
  else try{const saved=localStorage.getItem(tokenKey);if(saved){input.value=saved;remember.checked=true}storageState.textContent=saved?'Jeton mémorisé sur cette origine du navigateur.':'Le jeton reste temporaire tant que cette option est désactivée.'}
  catch{storageAvailable=false;remember.disabled=true;storageState.textContent='Stockage local indisponible. Utiliser un gestionnaire de mots de passe ; la publication ponctuelle reste disponible.'}
  const forgetStored=()=>{
    try{localStorage.removeItem(tokenKey);if(localStorage.getItem(tokenKey)!==null)throw new Error();storageState.textContent='Jeton oublié sur cette origine.';return true}
    catch{storageState.textContent='Effacement non confirmé. Supprimer les données de cette origine dans les paramètres du navigateur.';return false}
  };
  remember.onchange=()=>{if(!remember.checked)forgetStored();else storageState.textContent='Le jeton sera mémorisé lors de la confirmation de publication.'};
  forget.onclick=()=>{input.value='';remember.checked=false;forgetStored();document.getElementById('experimentPublishConfirm').disabled=true};
  document.getElementById('experimentPublishConfirm').disabled=!input.value.trim();
  input.oninput=()=>{document.getElementById('experimentPublishConfirm').disabled=!input.value.trim()};
  document.getElementById('experimentPublishCancel').onclick=()=>{input.value='';dialog.close()};
  dialog.oncancel=()=>{input.value=''};
  dialog.onclose=()=>{input.value='';form.onsubmit=null};
  form.onsubmit=async event=>{
    event.preventDefault();let token=input.value.trim();if(!token||experimentPublishing)return;
    let storageNotice='';
    if(storageAvailable&&remember.checked){
      try{localStorage.setItem(tokenKey,token);if(localStorage.getItem(tokenKey)!==token)throw new Error()}
      catch{remember.checked=false;storageNotice=' Mémorisation non confirmée : utiliser un gestionnaire de mots de passe.'}
    }
    input.value='';dialog.close();
    if(context!==experimentContext){token='';experimentPublishResult={text:'Publication annulée : le compte ou le monde a changé. Rouvrir la publication.'};showExperimentPublication();return}
    const publication=experimentExport();experimentPublishing=true;
    if(context===experimentContext){experimentPublishResult={text:'Publication en cours…'};showExperimentPublication();document.getElementById('experimentPublish').disabled=true}
    try{
      await publishExperimentGithub(publication,token);
      if(context===experimentContext)experimentPublishResult={success:true,text:'Publication réussie — latest.json a été remplacé dans le dépôt privé.'+storageNotice};
    }catch(error){if(context===experimentContext)experimentPublishResult={text:error.message+storageNotice}}
    finally{token='';experimentPublishing=false;if(context===experimentContext)showExperimentPublication();const button=document.getElementById('experimentPublish');if(button)button.disabled=false}
  };
}
async function publishExperimentGithub(snapshot,token){
  const base='https://api.github.com/repos/taitsuo/chatgpt-icarus';
  const request=async(path,options={})=>{
    let response;
    try{response=await fetch(base+path,{...options,redirect:'error',cache:'no-store',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{})}})}
    catch{throw new Error('Publication impossible : connexion GitHub indisponible ou requête bloquée par le navigateur.')}
    if(!response.ok&&response.status!==404){
      const reasons={401:'Jeton refusé ou expiré.',403:'Accès refusé : vérifier le dépôt sélectionné et la permission Contents: Read and write du jeton.',409:'Le fichier ou la branche a changé : relancer la publication.',422:'GitHub a refusé la mise à jour : vérifier les permissions et les règles de la branche main.'};
      throw new Error('Publication impossible : '+(reasons[response.status]||'GitHub a répondu avec le statut '+response.status+'.'));
    }
    return response;
  };
  const repo=await request('');if(repo.status===404)throw new Error('Dépôt privé introuvable : vérifier l’accès du jeton à taitsuo/chatgpt-icarus.');
  const info=await repo.json();if(info.full_name?.toLowerCase()!=='taitsuo/chatgpt-icarus'||info.private!==true)throw new Error('Publication arrêtée : le dépôt cible doit être taitsuo/chatgpt-icarus et privé.');
  const branch=await request('/branches/main');if(branch.status===404)throw new Error('Branche main introuvable.');
  const path='/contents/research/genetics/latest.json',existing=await request(path+'?ref=main');
  const previous=existing.status===404?null:await existing.json();
  if(previous&&(!previous.sha||previous.type!=='file'))throw new Error('Destination GitHub invalide : latest.json doit être un fichier.');
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot,null,2)+'\n');let binary='';
  for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  const saved=await request(path,{method:'PUT',body:JSON.stringify({message:'Publish genetic experiment results',branch:'main',content:btoa(binary),...(previous?{sha:previous.sha}:{})})});
  if(saved.status===404)throw new Error('Publication refusée : vérifier l’accès en écriture du jeton au dépôt.');
  const confirmation=await saved.json().catch(()=>null);
  if(confirmation?.content?.path!=='research/genetics/latest.json'||!confirmation.content.sha)throw new Error('GitHub n’a pas confirmé le fichier publié. Vérifier latest.json avant de réessayer.');
}


globalThis.Experimenter=Object.freeze({refresh:refreshExperiment,render:renderExperiment});
