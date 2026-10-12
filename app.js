const THEME_STORAGE_KEY='breeding-tool-theme';
const THEME_NAMES=new Set(['default','rustic','concrete','glass','aluminium']);
const UI_SCALE=1.1;

function normalizeTheme(theme){
  return theme==='composite'?'aluminium':theme;
}

function applyTheme(theme,{persist=true}={}){
  const normalized=normalizeTheme(theme);
  const selected=THEME_NAMES.has(normalized)?normalized:'default';
  document.documentElement.dataset.theme=selected;
  document.querySelectorAll('[data-theme-choice]').forEach(button=>{
    const active=button.dataset.themeChoice===selected;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  if(persist){
    try{localStorage.setItem(THEME_STORAGE_KEY,selected)}catch{}
  }
}

function initializeThemeSelector(){
  let saved='default';
  try{
    const stored=localStorage.getItem(THEME_STORAGE_KEY)||'default';
    saved=normalizeTheme(stored);
    if(stored==='composite')localStorage.setItem(THEME_STORAGE_KEY,saved);
  }catch{}
  applyTheme(saved,{persist:false});
  document.querySelectorAll('[data-theme-choice]').forEach(button=>{
    button.addEventListener('click',()=>applyTheme(button.dataset.themeChoice));
  });
}

initializeThemeSelector();

function buildRelationshipIndexes(nodes){
  const children=new Map(),siblings=new Map(),groups=new Map();
  for(const n of nodes){
    for(const parentId of [n.mother,n.father]){
      if(!parentId)continue;
      if(!children.has(parentId))children.set(parentId,[]);
      children.get(parentId).push(n.id);
    }
    if(!n.mother||!n.father)continue;
    const pairKey=JSON.stringify([n.mother,n.father]);
    if(!groups.has(pairKey))groups.set(pairKey,[]);
    groups.get(pairKey).push(n.id);
  }
  for(const ids of groups.values()){
    if(ids.length<2)continue;
    for(const id of ids)siblings.set(id,ids.filter(peerId=>peerId!==id));
  }
  return {childrenByParentId:children,siblingsById:siblings};
}

function descendantIdsFrom(founderId,childrenByParentId,accept=()=>true){
  const ids=new Set([founderId]),queue=[founderId];
  while(queue.length){
    const parentId=queue.shift();
    for(const childId of childrenByParentId.get(parentId)||[]){
      if(!ids.has(childId)&&accept(childId)){
        ids.add(childId);
        queue.push(childId);
      }
    }
  }
  return ids;
}

function classifyPetOrigin(pet){
  const hasParentUid=[pet?.mother_bt_id,pet?.father_bt_id]
    .some(value=>stablePetId(value)!==null);
  const hasParentName=[pet?.mother,pet?.father]
    .some(value=>String(value||'').trim()!=='');
  return hasParentUid||hasParentName?'bred':'foundation';
}

function buildNavigationCatalog(nodes,childrenByParentId){
  const species=new Map(),bloodlinesBySpecies=new Map(),foundationsBySpecies=new Map();
  const nodeById=new Map(nodes.map(node=>[node.id,node]));
  for(const node of nodes){
    const speciesKey=node.species_key||'Unknown';
    if(!species.has(speciesKey))species.set(speciesKey,{kind:'species',key:speciesKey,speciesKey,memberIds:new Set()});
    species.get(speciesKey).memberIds.add(node.id);

    if(!bloodlinesBySpecies.has(speciesKey))bloodlinesBySpecies.set(speciesKey,new Map());
    const bloodline=node.bloodline||'Unknown';
    const bloodlines=bloodlinesBySpecies.get(speciesKey);
    if(!bloodlines.has(bloodline))bloodlines.set(bloodline,{kind:'bloodline',key:bloodline,speciesKey,memberIds:new Set()});
    bloodlines.get(bloodline).memberIds.add(node.id);
  }

  for(const node of nodes){
    const hasStableUid=node.bt_id!==null&&node.bt_id!==undefined&&node.bt_id!==''&&stablePetId(node.bt_id)!==null;
    if(node.originKind!=='foundation'||!hasStableUid)continue;
    const speciesKey=node.species_key||'Unknown';
    const branch=descendantIdsFrom(node.id,childrenByParentId,childId=>{
      const child=nodeById.get(childId);
      return child&&(child.species_key||'Unknown')===speciesKey;
    });
    branch.delete(node.id);
    if(!branch.size)continue;
    if(!foundationsBySpecies.has(speciesKey))foundationsBySpecies.set(speciesKey,new Map());
    foundationsBySpecies.get(speciesKey).set(String(node.bt_id),{
      kind:'foundation',key:String(node.bt_id),speciesKey,founderId:node.id,
      descendantIds:branch,memberIds:new Set([node.id,...branch])
    });
  }
  return {species,bloodlinesBySpecies,foundationsBySpecies};
}

function mergeManualOrder(descriptors,savedOrder,compare){
  const byKey=new Map(descriptors.map(item=>[item.key,item]));
  const ordered=[];
  for(const key of Array.isArray(savedOrder)?savedOrder:[]){
    if(byKey.has(key)){ordered.push(byKey.get(key));byKey.delete(key)}
  }
  return [...ordered,...[...byKey.values()].sort(compare)];
}

function firstLayoutNodeId(layout,allowedIds=null){
  if(!layout?.pos?.size)return null;
  return [...layout.pos.entries()]
    .filter(([id])=>!allowedIds||allowedIds.has(id))
    .sort(([,a],[,b])=>a.y-b.y||a.x-b.x)[0]?.[0]||null;
}

function foundationVisibility(founder,hideInactive,manualHidden){
  const autoHidden=!founder||(hideInactive&&!founder.breedingActive);
  return {
    autoHidden,
    manualHidden:Boolean(manualHidden),
    visible:!autoHidden&&!manualHidden,
    restorable:!autoHidden&&Boolean(manualHidden)
  };
}

function generationMap(list,nodeById){
  const ids=new Set(list.map(n=>n.id)),generations=new Map(),visiting=new Set();
  function generationOf(id){
    if(generations.has(id))return generations.get(id);
    if(visiting.has(id))return 0;
    visiting.add(id);
    const n=nodeById.get(id);
    const parents=n?[n.mother,n.father].filter(parentId=>parentId&&ids.has(parentId)):[];
    const value=parents.length?Math.max(...parents.map(generationOf))+1:0;
    visiting.delete(id);
    generations.set(id,value);
    return value;
  }
  for(const n of list)generationOf(n.id);
  return generations;
}

// The board contains no embedded census. Every node is rebuilt from the account dataset.
const DATA = {nodes:[]};
let byId = new Map(DATA.nodes.map(n=>[n.id,n]));
let childrenByParentId=new Map(),siblingsById=new Map();
let navigationCatalog={species:new Map(),bloodlinesBySpecies:new Map(),foundationsBySpecies:new Map()};
const tree = document.getElementById('tree');
const wrap = document.getElementById('canvasWrap');
const connectEmpty = document.getElementById('connectEmpty');
const speciesTabsEl = document.getElementById('speciesTabs');
const hiddenSpeciesEl = document.getElementById('hiddenSpecies');
const bloodlineTabsEl = document.getElementById('bloodlineTabs');
const hiddenBloodlinesEl = document.getElementById('hiddenBloodlines');
const foundationTabsEl = document.getElementById('foundationTabs');
const hiddenFoundationsEl = document.getElementById('hiddenFoundations');
const customizableBlocks=document.getElementById('customizableBlocks');
const pedigreeBtn = document.getElementById('pedigreeBtn');
const breedingBtn = document.getElementById('breedingBtn');
const advisorBtn = document.getElementById('advisorBtn');
const experimentBtn=document.getElementById('experimentBtn');
const experimentWrap=document.getElementById('experimentWrap');
const advisorWrap = document.getElementById('advisorWrap');
const advisorStatPicker = document.getElementById('advisorStatPicker');
const advisorStatToggles = document.getElementById('advisorStatToggles');
const advisorModelNote = document.getElementById('advisorModelNote');
const advisorStatReferenceButtons = document.getElementById('advisorStatReferenceButtons');
const advisorStatReferenceDetail = document.getElementById('advisorStatReferenceDetail');
const advisorContent = document.getElementById('advisorContent');
const detailShell = document.getElementById('detailShell');
const detail = document.getElementById('detail');
const tooltip = document.getElementById('tooltip');
const search = document.getElementById('search');
const viewTitle = document.getElementById('viewTitle');
const countText = document.getElementById('countText');
const speciesBadge = document.getElementById('speciesBadge');
const populationBadge = document.getElementById('populationBadge');
const zoomLabel = document.getElementById('zoomLabel');
const breedingTableWrap = document.getElementById('breedingTableWrap');
const breedingTable = document.getElementById('breedingTable');
const inactiveToggleBtn = document.getElementById('inactiveToggleBtn');
const breedingCountHint = document.getElementById('breedingCountHint');
const nextFemaleName=document.getElementById('nextFemaleName');
const nextMaleName=document.getElementById('nextMaleName');
const breedingPairState=document.getElementById('breedingPairState');
const sendBreedingPairBtn=document.getElementById('sendBreedingPairBtn');
const searchClearBtn=document.getElementById('searchClearBtn');
const selectedPetSummary=document.getElementById('selectedPetSummary');
const visualControls=document.querySelector('.visual-controls');
const siblingLegend=document.getElementById('siblingLegend');
const stickyTools=document.querySelector('.sticky-tools');
const motherClustersBtn=document.getElementById('motherClustersBtn');
const fatherClustersBtn=document.getElementById('fatherClustersBtn');
let currentSpecies='',activeView={kind:'species',key:null},selected=null,lastLayout=null,zoomScale=1,hideInactive=true,clusterParent='mother';
const collapsedBlocks=new Map();

function makeCollapsible(element,key,{keep=null,label='block',onChange=null}={}){
  if(!element)return;
  element.classList.add('collapsible-block');
  const keepElement=keep?element.querySelector(`:scope > ${keep}`):null;
  if(keepElement)keepElement.classList.add('collapse-keep');
  [...element.children].forEach(child=>{
    if(child!==keepElement&&!child.classList.contains('collapse-toggle')&&!child.classList.contains('block-drag-handle'))child.classList.add('collapse-content');
  });
  let button=element.querySelector(':scope > .collapse-toggle');
  if(!button){
    button=document.createElement('button');
    button.type='button';button.className='collapse-toggle';
    element.appendChild(button);
  }
  const sync=()=>{
    const collapsed=collapsedBlocks.get(key)===true;
    element.classList.toggle('is-collapsed',collapsed);
    const glyph=collapsed?'▸':'▾';if(button.textContent!==glyph)button.textContent=glyph;
    button.title=`${collapsed?'Expand':'Collapse'} ${label}`;
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-expanded',String(!collapsed));
  };
  button.onclick=event=>{event.stopPropagation();collapsedBlocks.set(key,collapsedBlocks.get(key)!==true);sync();onChange?.(collapsedBlocks.get(key))};
  sync();
}

function initializeStaticCollapsibles(){
  for(const [element,id,keep,title] of [
    [detailShell,'selected-pet','.detail-toolbar','Selected Pet'],
    [document.getElementById('breedingPairPanel'),'current-pair','.pair-heading','Current Pair'],
    [document.getElementById('contextBlock'),'context','.context-heading','Categories'],
    [document.querySelector('.mainpanel'),'main-view','.lineage-head','Workspace']
  ])setupCommonPanel(element,id,keep,title);
}
function setupCommonPanel(element,id,keep,title){
  if(!element)return;
  element.classList.add('common-panel');
  const advisor=id.startsWith('advisor-');
  const bucket=advisor?preferences.advisorCollapsed:preferences.panelCollapsed;
  collapsedBlocks.set(id,bucket[id]===true);
  makeCollapsible(element,id,{keep,label:title,onChange:value=>{bucket[id]=value;savePreferences()}});
  const half=preferences.panelWidths[id]?preferences.panelWidths[id]==='half':advisor&&id!=='advisor-bloodlines';
  element.classList.toggle('panel-half',half);element.classList.toggle('panel-wide',!half);
  if(!element.querySelector(':scope > .panel-width')){
    const width=document.createElement('button');width.className='panel-width';width.type='button';
    width.textContent='↔';width.title='Toggle full / half width';width.setAttribute('aria-label',title+' width');
    width.onclick=()=>{const half=element.classList.toggle('panel-half');element.classList.toggle('panel-wide',!half);preferences.panelWidths[id]=half?'half':'full';savePreferences()};
    element.append(width);
  }
}
function restoreCommonPanels(){initializeStaticCollapsibles();const manual=document.getElementById('manuallyInactivePanel');if(manual)setupCommonPanel(manual,'manual-inactive','.manual-inactive-heading','Manually inactive')}

function initializeAdvisorCollapsibles(){}

function restoredAdvisorState(value={}){return {preview:value.preview==='best'?'best':'average',referenceStat:Number.isInteger(value.referenceStat)&&value.referenceStat>=0&&value.referenceStat<7?value.referenceStat:0,chosenPairKey:typeof value.chosenPairKey==='string'?value.chosenPairKey:null}}
const advisorState={preview:'average',chosenPairKey:null,referenceStat:0};
const GENOTYPE_REFERENCE=[
  {abbr:'V',name:'Vigor',effect:'Max HP'},
  {abbr:'F',name:'Fitness',effect:'Max Stamina'},
  {abbr:'P',name:'Physique',effect:'Melee Damage + Weight Capacity'},
  {abbr:'R',name:'Reflex',effect:'Movement Speed'},
  {abbr:'T',name:'Toughness',effect:'Physical Resistance'},
  {abbr:'A',name:'Adaptation',effect:'Cold Resistance + Heat Resistance'},
  {abbr:'I',name:'Instinct',effect:'Species utility / Mount Cargo Inventory slots'}
];


function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function hasPetName(pet){
  const name=Object.hasOwn(pet||{},'icarusName')?pet.icarusName:pet?.name;
  return typeof name==='string'&&name.trim()!==''&&name.trim()!=='None';
}
function individualMutationBonus(pet){
  if(!hasPetName(pet))return null;
  const lineage=pet?.bloodline??pet?.lineage;
  if(typeof lineage!=='string'||!lineage.trim()||['None','Unknown'].includes(lineage))return null;
  if(lineage!=='Fierce')return 0;
  const value=pet?.fierce_mutation_bonus_pct;
  return typeof value==='number'&&Number.isFinite(value)?value:null;
}
function mutationBonusText(pet){
  const value=individualMutationBonus(pet);
  return value===null?'—':'+'+value+'%';
}
function activityClass(n){return n.breedingActive?'active':'culled'}
function activityLabel(n){return n.breedingActive?'Active':'Inactive'}
function roleClass(n){
  const role=String(n.role||'').trim().toLocaleLowerCase();
  return ['reserve','experimental','retired'].includes(role)?` role-${role}`:'';
}
function presenceLabel(n){return n.lifecycleState==='ARCHIVED'?'Archived':n.historical?'Historical':'Active'}
function presenceClass(n){return n.historical?'historical':n.isPresent?'active':'inactive'}
function confirmedAdult(n){return typeof n?.stage==='string'&&n.stage.trim().toLowerCase()==='adult'}
function activeAdultCount(ids){return [...ids].filter(id=>{const n=byId.get(id);return hasPetName(n)&&confirmedAdult(n)&&n.breedingActive}).length}
function automaticInactiveReason(n){
  if(n.deathStatus==='dead')return 'Dead animal: inactive for breeding';
  if(n.lifecycleState==='ARCHIVED')return 'Archived animal: retained for history and pedigree';
  if(n.historical)return 'Historical animal: inactive for breeding';
  if(n.lifecycleState!=='ACTIVE')return 'Not an active animal';
  if(!confirmedAdult(n))return 'Adult stage not confirmed: not yet a breeder';
  return '';
}
function sexRank(n){return n.sex==='F'?0:n.sex==='M'?2:1}
function statsText(n){return n.stats ? n.stats.map(value=>value??'—').join(' / ') : '—'}
function offspringOf(id){return (childrenByParentId.get(id)||[]).map(childId=>byId.get(childId)).filter(hasPetName)}
function siblingsOf(n){return (siblingsById.get(n.id)||[]).map(id=>byId.get(id)).filter(hasPetName)}

const SPECIES_ALIAS_GROUPS={
  Moa:['Mount_Moa','Juvenile_Moa','BP_Mount_Moa_C'],
  Arctic_Moa:['Mount_Arctic_Moa','Juvenile_Arctic_Moa','BP_Mount_Arctic_Moa_C'],
  Buffalo:['Mount_Buffalo','Juvenile_Buffalo','BP_Mount_Buffalo_C'],
  Horse:['Mount_Horse','Juvenile_Horse','BP_Mount_Horse_C'],
  Tusker:['Mount_Tusker','Juvenile_Tusker','BP_Mount_Tusker_C'],
  Forest_Wolf:['Tamed_Forest_Wolf','Juvenile_Forest_Wolf','BP_Tamed_Wolf_C'],
  Snow_Wolf:['Tamed_Snow_Wolf','Juvenile_Snow_Wolf','BP_Tamed_Wolf_Snow_C'],
  Desert_Wolf:['Tamed_Desert_Wolf','BP_Tamed_Wolf_Desert_C'],
  Blueback:['Mount_BlueBack','Juvenile_Blueback','BP_Mount_BlueBack_C'],
  Lava_Blueback:['BlueBack_Lava','Juvenile_Blueback_Lava','BP_NPC_BlueBack_Lava_Character_C'],
  Wild_Boar:['Tamed_Wild_Boar','Juvenile_Boar','BP_Tame_Boar_C'],
  Dog:['Tame_Dog_A1','BP_Tame_Dog_A1_C'],
  Cat:['Tame_Cat_A1','BP_Tame_Cat_C'],
  Cattle:['Cow','Calf','Mount_Bull','BP_Tame_Cow_C','BP_Mount_Bull_C'],
  Chicken:['Chicken_A2','Chicken_A3','Chick','Rooster','BP_Tame_Chicken_C'],
  Sheep:['Lamb','Ram','BP_Tame_Sheep_C'],
  Wooly_Zebra:['Mount_WoolyZebra','Juvenile_Wooly_Zebra','BP_Mount_Wooly_Zebra_C'],
  Swamp_Bird:['Mount_SwampBird','Juvenile_SwampBird','BP_Mount_SwampBird_C'],
  Raptor_Desert:['Mount_Raptor_Desert','Juvenile_Raptor_Desert','BP_Mount_Raptor_Desert_C'],
  Raptor:['Mount_Raptor','Juvenile_Raptor','BP_Mount_Raptor_C'],
  Chew:['Mount_Chew','Juvenile_Chew','BP_Mount_Chew_C'],
  Slinker:['Mount_Slinker','Juvenile_Slinker','BP_Mount_Slinker_C'],
  Orka:['Tamed_Orka','BP_Tamed_Orka_C'],
  Storca:['Tamed_Storca','BP_Tamed_Storca_C'],
  Tundra_Monkey:['Tamed_Tundra_Monkey','Juvenile_Tundra_Monkey','BP_Tamed_Tundra_Monkey_C'],
  Mammoth:['Mount_WoollyMammoth','Juvenile_WoollyMammoth','BP_Mount_WoollyMammoth_C'],
  Pig:['Piglet','BP_Tame_Pig_C']
};
const SPECIES_ALIASES=new Map(Object.entries(SPECIES_ALIAS_GROUPS)
  .flatMap(([canonical,aliases])=>[canonical,...aliases].map(alias=>[alias.toLowerCase(),canonical])));

function normalizeSpeciesKey(key){
  key=String(key||'');
  return SPECIES_ALIASES.get(key.toLowerCase()) || key || 'Unknown';
}

function nodeSpeciesKey(n){
  return normalizeSpeciesKey(n.species_key || n.actor_class);
}

function speciesLabel(key){
  const known={
    Chicken:'Chicken / Rooster',
    Sheep:'Sheep / Ram',
    Cattle:'Cow / Bull',
    Snow_Wolf:'Snow Wolf',
    BP_Mount_Arctic_Moa_C:'Arctic Moa',
    BP_Mount_Moa_C:'Moa',
    BP_Mount_Buffalo_C:'Buffalo',
    BP_Tamed_Chicken_C:'Chicken',
    BP_Mount_Horse_C:'Horse'
  };
  if(known[key])return known[key];
  return String(key||'Pet')
    .replace(/^BP_(?:Tamed_|Mount_)?/,'')
    .replace(/_C$/,'')
    .replace(/_/g,' ')
    .replace(/\b\w/g,c=>c.toUpperCase());
}

const STAT_LABELS=['V','F','P','R','T','A','I'];
const DEFAULT_USEFUL_MASK=[true,true,true,true,true,true,false];
const DEFAULT_BLOCK_ORDER=['context','current-pair','selected-pet','main-view','manual-inactive'];
function normalizeBlockOrder(value){
  const requested=Array.isArray(value)?value.map(String):[];
  return [...requested.filter((id,index)=>DEFAULT_BLOCK_ORDER.includes(id)&&requested.indexOf(id)===index),...DEFAULT_BLOCK_ORDER.filter(id=>!requested.includes(id))];
}
function normalizeCategoryBucket(value){
  value=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  return {
    order:Array.isArray(value.order)?value.order.map(String):[],
    manualHidden:Array.isArray(value.manualHidden)?value.manualHidden.map(String):[]
  };
}

function normalizePreferences(value){
  value=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const navigation=value.navigation&&typeof value.navigation==='object'?value.navigation:{};
  const perSpecies=source=>Object.fromEntries(Object.entries(source&&typeof source==='object'?source:{})
    .map(([speciesKey,bucket])=>[speciesKey,normalizeCategoryBucket(bucket)]));
  return {

    customRoles:Array.isArray(value.customRoles)?value.customRoles:[],
    advisorStrategy:value.advisorStrategy==='progressive'?'progressive':'all-pairs',
    advisorGoals:Object.fromEntries(Object.entries({...Object.fromEntries(Object.entries(value.usefulStats||{}).filter(([,m])=>Array.isArray(m)&&m.length===7&&m.every(v=>typeof v==='boolean')&&m.some(Boolean)).map(([k,m])=>[k,m.map(v=>v?'MAX':'IGNORE')])),...value.advisorGoals}).filter(([,g])=>Array.isArray(g)&&g.length===7&&g.every(v=>['MAX','IGNORE','MIN'].includes(v)))),
    advisorPanelOrder:Array.isArray(value.advisorPanelOrder)?[...new Set(value.advisorPanelOrder.filter(id=>['advisor-main','advisor-offspring','advisor-candidates','advisor-bloodlines'].includes(id)))]:[],
    advisorCollapsed:value.advisorCollapsed&&typeof value.advisorCollapsed==='object'?{...value.advisorCollapsed}:{},
    panelCollapsed:{...(value.panelCollapsed||{})},
    panelWidths:{...(value.panelWidths||{})},
    hideInactive:typeof value.hideInactive==='boolean'?value.hideInactive:true,
    blockOrder:normalizeBlockOrder(value.blockOrder),
    navigation:{
      species:normalizeCategoryBucket(navigation.species),
      bloodlines:perSpecies(navigation.bloodlines),
      foundations:perSpecies(navigation.foundations)
    }
  };
}

const preferences=normalizePreferences({});

function savePreferences(){
  markUserDataDirty();
}

function applyBlockOrder(){
  for(const id of normalizeBlockOrder(preferences.blockOrder)){
    const block=customizableBlocks.querySelector(`[data-block-id="${id}"]`);
    if(block)customizableBlocks.appendChild(block);
  }
}

function saveCurrentBlockOrder(){
  const next=[...customizableBlocks.querySelectorAll(':scope > [data-block-id]')].map(block=>block.dataset.blockId);
  if(next.join('|')===normalizeBlockOrder(preferences.blockOrder).join('|'))return;
  preferences.blockOrder=next;
  savePreferences();
}

function initializeBlockOrdering(container=customizableBlocks,{apply=applyBlockOrder,save=saveCurrentBlockOrder}={}){
  container.blockOrderingController?.abort();
  const controller=new AbortController();container.blockOrderingController=controller;
  let dragged=null;
  container.querySelectorAll('.block-drag-handle').forEach(handle=>{
    handle.addEventListener('dragstart',event=>{
      dragged=handle.closest('[data-block-id]');
      dragged?.classList.add('block-dragging');
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',dragged?.dataset.blockId||'');
    },{signal:controller.signal});
    handle.addEventListener('dragend',()=>{
      container.querySelectorAll('.movable-block').forEach(block=>block.classList.remove('block-dragging','block-drop-target'));
      if(dragged)save();
      dragged=null;
    },{signal:controller.signal});
  });
  container.addEventListener('dragover',event=>{
    if(!dragged)return;
    event.preventDefault();event.dataTransfer.dropEffect='move';
    const candidate=event.target.closest('[data-block-id]');
    const target=candidate?.parentElement===container?candidate:null;
    container.querySelectorAll('.block-drop-target').forEach(block=>block.classList.remove('block-drop-target'));
    if(!target||target===dragged)return;
    target.classList.add('block-drop-target');
    const before=event.clientY<target.getBoundingClientRect().top+target.getBoundingClientRect().height/2;
    container.insertBefore(dragged,before?target:target.nextSibling);
  },{signal:controller.signal});
  container.addEventListener('drop',event=>{if(dragged)event.preventDefault()},{signal:controller.signal});
  apply();
}

function allSpeciesKeys(){
  const descriptors=[...navigationCatalog.species.values()];
  return mergeManualOrder(descriptors,preferences.navigation.species.order,(a,b)=>
    b.memberIds.size-a.memberIds.size||speciesLabel(a.key).localeCompare(speciesLabel(b.key),'en'))
    .map(item=>item.key);
}

function defaultSpeciesKey(){return speciesKeys()[0]||''}
function speciesKeys(){
  const hidden=new Set(preferences.navigation.species.manualHidden);
  return allSpeciesKeys().filter(key=>!hidden.has(key));
}

function statGoals(speciesKey=currentSpecies){return preferences.advisorGoals[speciesKey]||(preferences.advisorGoals[speciesKey]=GeneticQuality.goals(DEFAULT_USEFUL_MASK))}
function qualityLabel(){return 'Useful genetic quality'}
function qualityText(raw,speciesKey=currentSpecies){const p=GeneticQuality.prepare(statGoals(speciesKey));return p.maxRaw?raw.toFixed(Number.isInteger(raw)?0:2)+' / '+p.maxRaw:'No MAX stats'}
function scoreSummary(n){return n.total7==null?'Incomplete stats':`Total: ${n.total7} / Quality: ${qualityText(n.qualityScore,nodeSpeciesKey(n))}`}
function individualQuality(n){const p=GeneticQuality.prepare(statGoals(nodeSpeciesKey(n)));return p.score(n.stats)}
function recomputeQualityScores(speciesKey=currentSpecies){for(const n of DATA.nodes)if(nodeSpeciesKey(n)===speciesKey)n.qualityScore=n.total7===null?null:individualQuality(n)}

function currentSpeciesNodes(){
  return DATA.nodes.filter(n=>hasPetName(n)&&nodeSpeciesKey(n)===currentSpecies);
}

function familyIdsForPet(pet){
  if(!pet)return new Set();
  return new Set([
    pet.id,pet.mother,pet.father,
    ...(childrenByParentId.get(pet.id)||[]),
    ...(siblingsById.get(pet.id)||[])
  ].filter(Boolean));
}

function foundationForPet(pet){
  if(!pet)return null;
  return [...(navigationCatalog.foundationsBySpecies.get(nodeSpeciesKey(pet))?.values()||[])]
    .find(descriptor=>descriptor.founderId===pet.id)||null;
}

function viewNodes(view=activeView,speciesKey=currentSpecies,{includeInactive=false}={}){
  const full=DATA.nodes.filter(n=>nodeSpeciesKey(n)===speciesKey);
  let ids=new Set(full.map(n=>n.id));
  if(view.kind==='bloodline'){
    const descriptor=navigationCatalog.bloodlinesBySpecies.get(speciesKey)?.get(view.key);
    ids=new Set(descriptor?.memberIds||[]);
    let changed=true;
    while(changed){
      changed=false;
      for(const n of full){
        if(!ids.has(n.id))continue;
        for(const pid of [n.mother,n.father]){
          if(pid && !ids.has(pid) && byId.has(pid) && nodeSpeciesKey(byId.get(pid))===speciesKey){ids.add(pid);changed=true;}
        }
      }
    }
  }else if(view.kind==='foundation'){
    const descriptor=navigationCatalog.foundationsBySpecies.get(speciesKey)?.get(String(view.key));
    ids=new Set(descriptor?.memberIds||[]);
  }else if(view.kind==='family'){
    ids=familyIdsForPet(byId.get(view.key));
  }
  return full.filter(n=>hasPetName(n)&&ids.has(n.id)&&(includeInactive||(confirmedAdult(n)&&(!hideInactive||n.breedingActive))));
}

function getVisibleNodes(){
  return viewNodes(activeView,currentSpecies);
}

function nodeMatchesSearch(n,query=search.value.trim().toLowerCase()){
  if(!query)return true;
  return [
    n.name,n.nickname,n.bloodline,n.role,n.notes,n.sex,statsText(n),String(n.total7),String(n.qualityScore),String(n.runtime_uid??''),String(n.level??''),String(n.experience??'')
  ].join(' ').toLowerCase().includes(query);
}

function computeGenerations(list){
  return generationMap(list,byId);
}

function layoutUid(n){
  const first=n?.uid_history?.[0]?.uid;
  return first!==undefined&&Number.isFinite(Number(first))?Number(first):Number.POSITIVE_INFINITY;
}

function layoutBtOrder(n){
  const match=/^W-(\d+):P-(\d+)$/.exec(String(n?.bt_id||n?.id||''));
  return match?[Number(match[1]),Number(match[2])]:[Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY];
}

function stableLayoutCompare(a,b){
  const fa=firstSeenSortValue(a),fb=firstSeenSortValue(b);
  if(fa!==fb)return fa<fb?-1:1;

  const [wa,pa]=layoutBtOrder(a),[wb,pb]=layoutBtOrder(b);
  if(wa!==wb)return wa<wb?-1:1;
  if(pa!==pb)return pa<pb?-1:1;

  const ua=layoutUid(a),ub=layoutUid(b);
  if(ua!==ub)return ua<ub?-1:1;
  return String(a?.id||'').localeCompare(String(b?.id||''),'en',{numeric:true});
}

function firstSeenSortValue(n){
  const value=n?.firstSeen;
  if(value===null||value===undefined||value==='')return Number.NEGATIVE_INFINITY;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string'){
    const numeric=Number(value);
    if(Number.isFinite(numeric))return numeric;
    const parsed=Date.parse(value);
    if(Number.isFinite(parsed))return parsed;
  }
  return Number.POSITIVE_INFINITY;
}

function layoutPairKey(a,b){
  return [a||'x',b||'x'].join('|');
}

function layoutTwinSignature(n){
  return [
    n.mother||'x',n.father||'x',n.sex,String(n.bloodline||'Unknown').toLocaleLowerCase(),
    (n.stats||[]).map(value=>value===null||value===undefined?'?':String(value)).join(',')
  ].join('|');
}

function directFamilyData(list){
  const childCount=new Map(),partners=new Map(),pairChildren=new Map();
  const addPartner=(a,b)=>{
    if(!a||!b)return;
    if(!partners.has(a))partners.set(a,new Set());
    partners.get(a).add(b);
  };
  for(const child of list){
    for(const parentId of [child.mother,child.father]){
      if(parentId)childCount.set(parentId,(childCount.get(parentId)||0)+1);
    }
    if(child.mother&&child.father){
      addPartner(child.mother,child.father);addPartner(child.father,child.mother);
      const key=layoutPairKey(...[child.mother,child.father].sort());
      pairChildren.set(key,(pairChildren.get(key)||0)+1);
    }
  }
  return {childCount,partners,pairChildren};
}

function reproductivePairWeight(a,b,pairChildren){
  if(!a||!b)return 0;
  return pairChildren.get(layoutPairKey(...[a,b].sort()))||0;
}

function orderFounderGeneration(g0,list,parentField){
  const governingSex=parentField==='mother'?'F':'M';
  const {childCount,partners,pairChildren}=directFamilyData(list);
  const g0Ids=new Set(g0.map(n=>n.id)),localById=new Map(g0.map(n=>[n.id,n]));
  const governingWithoutChildren=[],breeders=[],rest=[];
  for(const n of g0){
    if((childCount.get(n.id)||0)>0)breeders.push(n);
    else if(n.sex===governingSex)governingWithoutChildren.push(n);
    else rest.push(n);
  }
  governingWithoutChildren.sort(stableLayoutCompare);rest.sort(stableLayoutCompare);

  const breederIds=new Set(breeders.map(n=>n.id));
  const adjacency=new Map(breeders.map(n=>[n.id,new Set()]));
  for(const n of breeders){
    for(const partnerId of partners.get(n.id)||[]){
      if(breederIds.has(partnerId)&&g0Ids.has(partnerId))adjacency.get(n.id).add(partnerId);
    }
  }

  const seen=new Set(),components=[];
  for(const n of breeders.slice().sort(stableLayoutCompare)){
    if(seen.has(n.id))continue;
    const stack=[n.id],component=[];seen.add(n.id);
    while(stack.length){
      const id=stack.pop();component.push(localById.get(id));
      for(const peerId of adjacency.get(id)||[]){
        if(!seen.has(peerId)){seen.add(peerId);stack.push(peerId)}
      }
    }
    components.push(component);
  }

  const childScore=n=>childCount.get(n.id)||0;
  const orient=path=>{
    if(path.length<2)return path;
    const first=path[0],last=path[path.length-1];
    const firstGoverning=first.sex===governingSex?1:0,lastGoverning=last.sex===governingSex?1:0;
    if(lastGoverning>firstGoverning)return [...path].reverse();
    if(firstGoverning===lastGoverning&&stableLayoutCompare(last,first)<0)return [...path].reverse();
    return path;
  };

  const seriate=component=>{
    if(component.length<=1)return component.slice();
    let bestEdge=null;
    for(let i=0;i<component.length;i++)for(let j=i+1;j<component.length;j++){
      const a=component[i],b=component[j],weight=reproductivePairWeight(a.id,b.id,pairChildren);
      if(weight<=0)continue;
      const tie=[weight,childScore(a)+childScore(b),(a.sex===governingSex?1:0)+(b.sex===governingSex?1:0),-Math.min(layoutUid(a),layoutUid(b))];
      if(!bestEdge||tie[0]>bestEdge.tie[0]||tie[0]===bestEdge.tie[0]&&tie[1]>bestEdge.tie[1]||tie[0]===bestEdge.tie[0]&&tie[1]===bestEdge.tie[1]&&tie[2]>bestEdge.tie[2]||tie[0]===bestEdge.tie[0]&&tie[1]===bestEdge.tie[1]&&tie[2]===bestEdge.tie[2]&&tie[3]>bestEdge.tie[3])bestEdge={a,b,tie};
    }
    const remaining=new Map(component.map(n=>[n.id,n]));
    let path;
    if(bestEdge){path=[bestEdge.a,bestEdge.b];remaining.delete(bestEdge.a.id);remaining.delete(bestEdge.b.id)}
    else{
      const seed=component.slice().sort((a,b)=>childScore(b)-childScore(a)||(a.sex===governingSex?0:1)-(b.sex===governingSex?0:1)||stableLayoutCompare(a,b))[0];
      path=[seed];remaining.delete(seed.id);
    }
    while(remaining.size){
      let best=null;
      for(const n of remaining.values())for(let position=0;position<=path.length;position++){
        const left=position?path[position-1]:null,right=position<path.length?path[position]:null;
        const gain=reproductivePairWeight(left?.id,n.id,pairChildren)+reproductivePairWeight(n.id,right?.id,pairChildren)-reproductivePairWeight(left?.id,right?.id,pairChildren);
        const connected=path.reduce((sum,peer)=>sum+reproductivePairWeight(peer.id,n.id,pairChildren),0);
        const candidate={n,position,gain,connected,children:childScore(n),governing:n.sex===governingSex?1:0};
        if(!best||candidate.gain>best.gain||candidate.gain===best.gain&&candidate.connected>best.connected||candidate.gain===best.gain&&candidate.connected===best.connected&&candidate.children>best.children||candidate.gain===best.gain&&candidate.connected===best.connected&&candidate.children===best.children&&candidate.governing>best.governing||candidate.gain===best.gain&&candidate.connected===best.connected&&candidate.children===best.children&&candidate.governing===best.governing&&stableLayoutCompare(candidate.n,best.n)<0)best=candidate;
      }
      path.splice(best.position,0,best.n);remaining.delete(best.n.id);
    }
    return orient(path);
  };

  const orderedComponents=components.map(component=>{
    const path=seriate(component);
    return {path,first:path.slice().sort(stableLayoutCompare)[0]};
  }).sort((a,b)=>stableLayoutCompare(a.first,b.first));
  return [...governingWithoutChildren,...orderedComponents.flatMap(component=>component.path),...rest];
}

function computeStructuralOrder(list,parentField=clusterParent){
  const structuralIds=new Set(list.map(n=>n.id));
  const generations=computeGenerations(list),nodesByGeneration=new Map(),orderedByGeneration=new Map(),anchorById=new Map();
  for(const n of list){
    const generation=generations.get(n.id)||0;
    if(!nodesByGeneration.has(generation))nodesByGeneration.set(generation,[]);
    nodesByGeneration.get(generation).push(n);
  }
  const maxGeneration=nodesByGeneration.size?Math.max(...nodesByGeneration.keys()):0;
  orderedByGeneration.set(0,orderFounderGeneration(nodesByGeneration.get(0)||[],list,parentField));

  for(let generation=1;generation<=maxGeneration;generation++){
    const previous=orderedByGeneration.get(generation-1)||[];
    const previousIndex=new Map(previous.map((n,index)=>[n.id,index]));
    const clusters=new Map();
    for(const n of nodesByGeneration.get(generation)||[]){
      const preferredId=parentField==='mother'?n.mother:n.father;
      const otherId=parentField==='mother'?n.father:n.mother;
      const preferredIsPrevious=preferredId&&structuralIds.has(preferredId)&&generations.get(preferredId)===generation-1;
      const otherIsPrevious=otherId&&structuralIds.has(otherId)&&generations.get(otherId)===generation-1;
      const anchorId=preferredIsPrevious?preferredId:otherIsPrevious?otherId:null;
      anchorById.set(n.id,anchorId);
      const key=anchorId?`anchor:${anchorId}`:`orphan:${n.id}`;
      if(!clusters.has(key))clusters.set(key,{key,anchorId,anchorIndex:anchorId?previousIndex.get(anchorId):Number.POSITIVE_INFINITY,nodes:[]});
      clusters.get(key).nodes.push(n);
    }
    const orderedClusters=[...clusters.values()].sort((a,b)=>a.anchorIndex-b.anchorIndex||(a.anchorId&&b.anchorId?stableLayoutCompare(byId.get(a.anchorId),byId.get(b.anchorId)):a.anchorId?-1:b.anchorId?1:a.key.localeCompare(b.key,'en',{numeric:true})));
    const row=[];
    for(const cluster of orderedClusters){
      const siblingsByParents=new Map();
      for(const n of cluster.nodes){
        const key=layoutPairKey(n.mother,n.father);
        if(!siblingsByParents.has(key))siblingsByParents.set(key,[]);
        siblingsByParents.get(key).push(n);
      }
      const siblingGroups=[...siblingsByParents.values()].map(group=>{
        const sample=group[0],anchorId=anchorById.get(sample.id);
        const otherId=sample.mother===anchorId?sample.father:sample.mother;
        const equivalents=new Map();
        for(const n of group){
          const signature=layoutTwinSignature(n);
          if(!equivalents.has(signature))equivalents.set(signature,[]);
          equivalents.get(signature).push(n);
        }
        const equivalentGroups=[...equivalents.values()];
        equivalentGroups.forEach(bucket=>bucket.sort(stableLayoutCompare));
        equivalentGroups.sort((a,b)=>{
          const firstA=Math.min(...a.map(firstSeenSortValue)),firstB=Math.min(...b.map(firstSeenSortValue));
          return firstA-firstB||stableLayoutCompare(a.slice().sort(stableLayoutCompare)[0],b.slice().sort(stableLayoutCompare)[0]);
        });
        const nodes=equivalentGroups.flat();
        return {otherId,otherPreviousIndex:otherId&&previousIndex.has(otherId)?previousIndex.get(otherId):Number.POSITIVE_INFINITY,firstSeen:firstSeenSortValue(nodes[0]),first:nodes.slice().sort(stableLayoutCompare)[0],nodes};
      });
      siblingGroups.sort((a,b)=>a.otherPreviousIndex-b.otherPreviousIndex||(a.otherId&&b.otherId?stableLayoutCompare(byId.get(a.otherId),byId.get(b.otherId)):a.otherId?-1:b.otherId?1:0)||a.firstSeen-b.firstSeen||stableLayoutCompare(a.first,b.first));
      row.push(...siblingGroups.flatMap(group=>group.nodes));
    }
    orderedByGeneration.set(generation,row);
  }
  return {orderedByGeneration,maxGeneration,anchorById};
}

function layoutNodes(structuralList,visibleList=structuralList){
  const structure=computeStructuralOrder(structuralList);
  const visibleIds=new Set(visibleList.map(n=>n.id)),groups=new Map();
  for(let generation=0;generation<=structure.maxGeneration;generation++){
    groups.set(generation,(structure.orderedByGeneration.get(generation)||[]).filter(n=>visibleIds.has(n.id)));
  }
  const gens=[...groups.keys()].sort((a,b)=>a-b);
  const nodeW=176,nodeH=66,gapX=24,gapY=68,margin=34;
  const maxCount=Math.max(1,...[...groups.values()].map(a=>a.length));
  const width=Math.max(wrap.clientWidth/UI_SCALE-2, margin*2 + maxCount*(nodeW+gapX));
  const height=margin*2 + (structure.maxGeneration+1)*(nodeH+gapY);
  const pos=new Map();
  for(const g of gens){
    const arr=groups.get(g);
    const rowW=arr.length*nodeW + Math.max(0,arr.length-1)*gapX;
    let x=(width-rowW)/2;
    const y=margin+g*(nodeH+gapY);
    for(const n of arr){pos.set(n.id,{x,y,w:nodeW,h:nodeH,g});x+=nodeW+gapX}
  }
  return {pos,width,height,ids:visibleIds,structure};
}

function svgEl(name,attrs={}){
  const el=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);
  return el;
}

const categoryPanelsOpen={species:false,bloodline:false,foundation:false};
let draggedCategory=null;

function speciesHue(key){
  let hash=0;
  for(const char of String(key))hash=(hash*31+char.charCodeAt(0))>>>0;
  return (190+(hash%210))%360;
}

function categoryBucket(kind,speciesKey=currentSpecies){
  if(kind==='species')return preferences.navigation.species;
  const collection=kind==='bloodline'?preferences.navigation.bloodlines:preferences.navigation.foundations;
  if(!collection[speciesKey])collection[speciesKey]=normalizeCategoryBucket({});
  return collection[speciesKey];
}

function categoryDescriptors(kind,speciesKey=currentSpecies){
  let descriptors=[];
  if(kind==='species')descriptors=[...navigationCatalog.species.values()];
  else if(kind==='bloodline')descriptors=[...(navigationCatalog.bloodlinesBySpecies.get(speciesKey)?.values()||[])];
  else descriptors=[...(navigationCatalog.foundationsBySpecies.get(speciesKey)?.values()||[])];
  const bucket=categoryBucket(kind,speciesKey);
  const compare=kind==='species'
    ? (a,b)=>b.memberIds.size-a.memberIds.size||speciesLabel(a.key).localeCompare(speciesLabel(b.key),'en')
    : kind==='bloodline'
      ? (a,b)=>b.memberIds.size-a.memberIds.size||a.key.localeCompare(b.key,'en')
      : (a,b)=>b.descendantIds.size-a.descendantIds.size||displayName(byId.get(a.founderId)).localeCompare(displayName(byId.get(b.founderId)),'en')||Number(a.key)-Number(b.key);
  return mergeManualOrder(descriptors,bucket.order,compare);
}

function categoryAutoHidden(descriptor){
  if(descriptor.kind==='bloodline'){
    return hideInactive&&![...descriptor.memberIds].some(id=>byId.get(id)?.breedingActive);
  }
  if(descriptor.kind==='foundation'){
    const founder=byId.get(descriptor.founderId);
    return foundationVisibility(founder,hideInactive,false).autoHidden;
  }
  return false;
}

function isSpecialBreedingView(){return activeView.kind==='breeding'||activeView.kind==='advisor'||activeView.kind==='experiment'}
function specialViewScope(){
  if(isSpecialBreedingView()&&activeView.scopeKind==='bloodline'&&activeView.scopeKey!=null){
    return {kind:'bloodline',key:String(activeView.scopeKey)};
  }
  return {kind:'species',key:null};
}
function specialViewScopeNodes(){
  const full=currentSpeciesNodes();
  const scope=specialViewScope();
  if(scope.kind!=='bloodline')return full;
  const descriptor=navigationCatalog.bloodlinesBySpecies.get(currentSpecies)?.get(scope.key);
  if(!descriptor)return full;
  return full.filter(n=>descriptor.memberIds.has(n.id));
}
function specialViewScopeLabel(){
  const scope=specialViewScope();
  return scope.kind==='bloodline'?`${speciesLabel(currentSpecies)} · Bloodline ${scope.key}`:speciesLabel(currentSpecies);
}
function categoryIsActive(descriptor){
  if(descriptor.kind==='species')return currentSpecies===descriptor.key;
  if(currentSpecies!==descriptor.speciesKey)return false;
  if(descriptor.kind==='bloodline'&&isSpecialBreedingView()){
    const scope=specialViewScope();
    return scope.kind==='bloodline'&&scope.key===descriptor.key;
  }
  return activeView.kind===descriptor.kind&&String(activeView.key)===descriptor.key;
}

function categoryLabel(descriptor){
  if(descriptor.kind==='species')return `${speciesLabel(descriptor.key)} (${activeAdultCount(descriptor.memberIds)})`;
  if(descriptor.kind==='bloodline')return `${descriptor.key} (${activeAdultCount(descriptor.memberIds)})`;
  return `${displayName(byId.get(descriptor.founderId))} (${activeAdultCount(descriptor.descendantIds)})`;
}

function categoryColor(descriptor){
  if(descriptor.kind==='species')return `hsl(${speciesHue(descriptor.key)} 55% 62%)`;
  if(descriptor.kind==='bloodline')return '#9a86aa';
  return '#c48c52';
}

function activateCategory(descriptor){
  const specialKind=isSpecialBreedingView()?activeView.kind:null;
  if(descriptor.kind==='species'){
    currentSpecies=descriptor.key;
    activeView=specialKind
      ? {kind:specialKind,key:null,scopeKind:'species',scopeKey:null}
      : {kind:'species',key:null};
  }else if(descriptor.kind==='bloodline'&&specialKind){
    currentSpecies=descriptor.speciesKey;
    activeView={kind:specialKind,key:null,scopeKind:'bloodline',scopeKey:descriptor.key};
  }else{
    // Foundations intentionally remain pedigree views; bloodlines outside Board/Advisor do too.
    currentSpecies=descriptor.speciesKey;
    activeView={kind:descriptor.kind,key:descriptor.key};
  }
  updateCategoryNavigation();
  render();refreshSelectedDetail();
}

function moveCategoryBefore(kind,source,target,speciesKey=currentSpecies){
  if(!source||!target||source===target)return;
  const order=categoryDescriptors(kind,speciesKey).map(item=>item.key);
  const from=order.indexOf(source),to=order.indexOf(target);
  if(from<0||to<0)return;
  order.splice(from,1);
  order.splice(order.indexOf(target),0,source);
  categoryBucket(kind,speciesKey).order=order;
  savePreferences();
  updateCategoryNavigation();
}

function hideCategory(descriptor){
  const wasActive=categoryIsActive(descriptor);
  const bucket=categoryBucket(descriptor.kind,descriptor.speciesKey);
  if(!bucket.manualHidden.includes(descriptor.key))bucket.manualHidden.push(descriptor.key);
  categoryPanelsOpen[descriptor.kind]=true;
  savePreferences();
  if(wasActive){
    const specialKind=isSpecialBreedingView()?activeView.kind:null;
    if(descriptor.kind==='species')currentSpecies=defaultSpeciesKey();
    activeView=specialKind
      ? {kind:specialKind,key:null,scopeKind:'species',scopeKey:null}
      : {kind:'species',key:null};
  }
  updateCategoryNavigation();
  render();refreshSelectedDetail();
}

function restoreCategory(descriptor){
  const bucket=categoryBucket(descriptor.kind,descriptor.speciesKey);
  bucket.manualHidden=bucket.manualHidden.filter(key=>key!==descriptor.key);
  savePreferences();
  activateCategory(descriptor);
}

function renderCategoryZone(kind,tabsEl,hiddenEl){
  tabsEl.innerHTML='';
  hiddenEl.innerHTML='';
  const descriptors=categoryDescriptors(kind);
  const bucket=categoryBucket(kind);
  const manualHidden=new Set(bucket.manualHidden);
  const visible=descriptors.filter(item=>!categoryAutoHidden(item)&&!manualHidden.has(item.key));
  const restorable=descriptors.filter(item=>!categoryAutoHidden(item)&&manualHidden.has(item.key));

  for(const descriptor of visible){
    const item=document.createElement('span');
    item.className='category-item';
    item.draggable=true;
    item.dataset.categoryKey=descriptor.key;
    item.style.setProperty('--category-color',categoryColor(descriptor));
    item.title=`Drag to reorder ${kind} categories`;
    item.addEventListener('dragstart',event=>{
      draggedCategory={kind,key:descriptor.key,speciesKey:descriptor.speciesKey};
      item.classList.add('dragging');
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',descriptor.key);
    });
    item.addEventListener('dragover',event=>{
      if(draggedCategory?.kind===kind&&draggedCategory.key!==descriptor.key){event.preventDefault();item.classList.add('drag-over')}
    });
    item.addEventListener('dragleave',()=>item.classList.remove('drag-over'));
    item.addEventListener('drop',event=>{
      event.preventDefault();item.classList.remove('drag-over');
      moveCategoryBefore(kind,draggedCategory?.key,descriptor.key,descriptor.speciesKey);
    });
    item.addEventListener('dragend',()=>{
      draggedCategory=null;
      document.querySelectorAll('.category-item').forEach(element=>element.classList.remove('dragging','drag-over'));
    });

    const button=document.createElement('button');
    button.className='tab category-tab'+(categoryIsActive(descriptor)?' active':'');
    button.textContent=categoryLabel(descriptor);
    button.addEventListener('click',()=>activateCategory(descriptor));
    const hide=document.createElement('button');
    hide.className='category-hide';
    hide.textContent='×';
    hide.title=`Hide ${categoryLabel(descriptor)}`;
    hide.setAttribute('aria-label',hide.title);
    hide.addEventListener('click',()=>hideCategory(descriptor));
    item.append(button,hide);
    tabsEl.appendChild(item);
  }

  if(restorable.length){
    const title=kind==='species'?'Hidden Species':kind==='bloodline'?'Hidden Bloodlines':'Hidden Foundations';
    const toggle=document.createElement('button');
    toggle.className='tab hidden-toggle';
    toggle.textContent=`${title} (${restorable.length})`;
    toggle.addEventListener('click',()=>{
      categoryPanelsOpen[kind]=!categoryPanelsOpen[kind];
      renderCategoryZone(kind,tabsEl,hiddenEl);
    });
    tabsEl.appendChild(toggle);
  }

  hiddenEl.classList.toggle('visible',categoryPanelsOpen[kind]&&restorable.length>0);
  if(categoryPanelsOpen[kind]&&restorable.length){
    const label=document.createElement('span');label.className='small';label.textContent='Restore:';hiddenEl.appendChild(label);
    for(const descriptor of restorable){
      const button=document.createElement('button');
      button.className='restore-category';button.textContent=categoryLabel(descriptor);
      button.addEventListener('click',()=>restoreCategory(descriptor));
      hiddenEl.appendChild(button);
    }
  }
}

function updateCategoryNavigation(){
  const previousSpecies=currentSpecies,previousKind=activeView.kind,previousKey=activeView.key;
  const previousScopeKind=activeView.scopeKind,previousScopeKey=activeView.scopeKey;
  if(currentSpecies&&!navigationCatalog.species.has(currentSpecies))currentSpecies='';
  if(!currentSpecies||!speciesKeys().includes(currentSpecies))currentSpecies=defaultSpeciesKey();
  if(activeView.kind==='bloodline'||activeView.kind==='foundation'){
    const descriptors=activeView.kind==='bloodline'
      ? navigationCatalog.bloodlinesBySpecies.get(currentSpecies)
      : navigationCatalog.foundationsBySpecies.get(currentSpecies);
    const descriptor=descriptors?.get(String(activeView.key));
    const bucket=categoryBucket(activeView.kind,currentSpecies);
    if(!descriptor||categoryAutoHidden(descriptor)||bucket.manualHidden.includes(descriptor.key))activeView={kind:'species',key:null};
  }else if(activeView.kind==='family'){
    const focus=byId.get(activeView.key);
    if(!focus||nodeSpeciesKey(focus)!==currentSpecies)activeView={kind:'species',key:null};
  }else if(isSpecialBreedingView()&&activeView.scopeKind==='bloodline'){
    const descriptor=navigationCatalog.bloodlinesBySpecies.get(currentSpecies)?.get(String(activeView.scopeKey));
    const bucket=categoryBucket('bloodline',currentSpecies);
    if(!descriptor||categoryAutoHidden(descriptor)||bucket.manualHidden.includes(descriptor.key)){
      activeView={kind:activeView.kind,key:null,scopeKind:'species',scopeKey:null};
    }
  }
  renderCategoryZone('species',speciesTabsEl,hiddenSpeciesEl);
  renderCategoryZone('bloodline',bloodlineTabsEl,hiddenBloodlinesEl);
  renderCategoryZone('foundation',foundationTabsEl,hiddenFoundationsEl);
  pedigreeBtn.classList.toggle('active',!isSpecialBreedingView());
  breedingBtn.classList.toggle('active',activeView.kind==='breeding');
  advisorBtn.classList.toggle('active',activeView.kind==='advisor');
  experimentBtn?.classList.toggle('active',activeView.kind==='experiment');
  speciesBadge.textContent=currentSpecies?`Species: ${speciesLabel(currentSpecies)}`:'Species: none selected';
  const pop=currentSpeciesNodes();
  const females=pop.filter(n=>n.sex==='F').length,males=pop.filter(n=>n.sex==='M').length;
  const present=pop.filter(n=>n.isPresent===true).length;
  populationBadge.textContent=`Population: ${females} F / ${males} M / ${present} active / ${pop.length} total`;
  updateInactiveToggle();

  return previousSpecies!==currentSpecies||previousKind!==activeView.kind||previousKey!==activeView.key||previousScopeKind!==activeView.scopeKind||previousScopeKey!==activeView.scopeKey;
}

function activeViewDescription(){
  if(activeView.kind==='advisor'){
    const scope=specialViewScope();
    return scope.kind==='bloodline'
      ? `Decision support for bloodline ${scope.key} within ${speciesLabel(currentSpecies)} using active, present breeders only.`
      : `Decision support for ${speciesLabel(currentSpecies)} using active, present breeders from this species only.`;
  }
  if(activeView.kind==='bloodline')return `${activeView.key} bloodline individuals with their known ancestors for pedigree context.`;
  if(activeView.kind==='family'){
    const focus=byId.get(activeView.key);
    return `Immediate family of ${displayName(focus)}: known parents, children and full siblings.`;
  }
  if(activeView.kind==='foundation'){
    const descriptor=navigationCatalog.foundationsBySpecies.get(currentSpecies)?.get(String(activeView.key));
    return `Known descendants of ${displayName(byId.get(descriptor?.founderId))}, identified by Icarus UID ${byId.get(descriptor?.founderId)?.runtime_uid??'—'}.`;
  }
  return `All known parentage for ${speciesLabel(currentSpecies)}.`;
}

function activeViewLabel(){
  if(activeView.kind==='advisor')return `Advisor — ${speciesLabel(currentSpecies)}`;
  if(activeView.kind==='bloodline')return `Bloodline ${activeView.key}`;
  if(activeView.kind==='family')return `Family — ${displayName(byId.get(activeView.key))}`;
  if(activeView.kind==='foundation'){
    const descriptor=navigationCatalog.foundationsBySpecies.get(currentSpecies)?.get(String(activeView.key));
    return `Foundation ${displayName(byId.get(descriptor?.founderId))}`;
  }
  return speciesLabel(currentSpecies);
}

function setViewHeading(title,description){
  viewTitle.textContent=title;
  viewTitle.dataset.tooltip=description||'';
}

function openPetLineage(pet,foundation=null){
  if(!pet)return;
  currentSpecies=nodeSpeciesKey(pet);
  selected=pet.id;
  if(foundation){
    if(!pet.breedingActive)hideInactive=false;
    const bucket=categoryBucket('foundation',currentSpecies);
    const wasHidden=bucket.manualHidden.includes(String(foundation.key));
    bucket.manualHidden=bucket.manualHidden.filter(key=>key!==String(foundation.key));
    activeView={kind:'foundation',key:String(foundation.key)};
    if(wasHidden)savePreferences();
  }else{
    activeView={kind:'family',key:pet.id};
  }
  updateCategoryNavigation();render();refreshSelectedDetail();
}

function updateInactiveToggle(){
  const inactiveCount=currentSpeciesNodes().filter(n=>confirmedAdult(n)&&!n.breedingActive).length;
  inactiveToggleBtn.textContent=hideInactive?`Show inactive (${inactiveCount})`:`Hide inactive (${inactiveCount})`;
  inactiveToggleBtn.classList.toggle('primary-control',hideInactive);
  inactiveToggleBtn.classList.remove('active');
  inactiveToggleBtn.setAttribute('aria-pressed',String(!hideInactive));
  inactiveToggleBtn.disabled=inactiveCount===0;
}

function currentNavigationScope(){
  if(activeView.kind==='bloodline')return {scopeKind:'bloodline',scopeKey:String(activeView.key)};
  if(isSpecialBreedingView()&&activeView.scopeKind==='bloodline')return {scopeKind:'bloodline',scopeKey:String(activeView.scopeKey)};
  return {scopeKind:'species',scopeKey:null};
}
function switchToolView(kind){
  const scope=currentNavigationScope();
  activeView=kind==='pedigree'
    ? (scope.scopeKind==='bloodline'?{kind:'bloodline',key:scope.scopeKey}:{kind:'species',key:null})
    : {kind,key:null,...scope};
  updateCategoryNavigation();render();refreshSelectedDetail();
}
pedigreeBtn.addEventListener('click',()=>switchToolView('pedigree'));
breedingBtn.addEventListener('click',()=>switchToolView('breeding'));
advisorBtn.addEventListener('click',()=>switchToolView('advisor'));
experimentBtn?.addEventListener('click',()=>switchToolView('experiment'));

inactiveToggleBtn.addEventListener('click',()=>{
  hideInactive=!hideInactive;
  preferences.hideInactive=hideInactive;savePreferences();
  updateCategoryNavigation();render();refreshSelectedDetail();
});

function syncClusterParentToggle(){
  const female=clusterParent==='mother';
  motherClustersBtn.classList.toggle('active',female);
  fatherClustersBtn.classList.toggle('active',!female);
  motherClustersBtn.setAttribute('aria-pressed',String(female));
  fatherClustersBtn.setAttribute('aria-pressed',String(!female));
}

motherClustersBtn.addEventListener('click',()=>{
  clusterParent='mother';syncClusterParentToggle();render();refreshSelectedDetail();
});
fatherClustersBtn.addEventListener('click',()=>{
  clusterParent='father';syncClusterParentToggle();render();refreshSelectedDetail();
});


function updateViewChrome(){
  const manual=document.getElementById('manuallyInactivePanel');if(manual)manual.hidden=activeView.kind!=='breeding';
  detailShell.style.display='';
  visualControls.style.display=isSpecialBreedingView()?'none':'';
  siblingLegend.style.display=(activeView.kind==='foundation'||activeView.kind==='family')?'inline':'none';
}

function advisorEligibleBreeders(){
  applyBoardEdits();
  return specialViewScopeNodes().filter(n=>
    n.breedingActive && n.lifecycleState==='ACTIVE' && !n.historical && nodeMatchesSearch(n) &&
    stablePetId(n.bt_id)!==null && n.stage==='adult' && n.stats.length===7 && n.stats.every(v=>Number.isInteger(v)&&v>=0&&v<=10) && (n.sex==='F'||n.sex==='M')
  );
}

function advisorStatMask(){return [...statGoals()]}

function advisorTwinSignature(n){
  const mother=String(n.mother||'');
  const father=String(n.father||'');
  const twinRoot=n.twinSource||n.bt_id;
  if(!father&&mother&&twinRoot)return [nodeSpeciesKey(n),n.sex,mother,twinRoot,...n.stats].join('|');
  // Without both stable parent links we cannot safely infer a sibling/twin-equivalent group.
  if(!mother||!father)return null;
  const stats=(n.stats||[]).map(value=>value===null||value===undefined?'?':String(value)).join(',');
  return [nodeSpeciesKey(n),n.sex,mother,father,String(n.bloodline||'Unknown').toLocaleLowerCase(),stats].join('|');
}

function advisorCandidateGroups(breeders,sex){
  const groups=[];
  const bySignature=new Map();
  const sorted=breeders.filter(n=>n.sex===sex).slice().sort((a,b)=>
    String(a.bt_id).localeCompare(String(b.bt_id)));
  for(const pet of sorted){
    const signature=advisorTwinSignature(pet);
    if(!signature){
      groups.push({key:`uid:${stablePetId(pet.bt_id)}`,pets:[pet],representative:pet,equivalent:false});
      continue;
    }
    if(!bySignature.has(signature)){
      const group={key:`eq:${signature}`,pets:[],representative:pet,equivalent:true};
      bySignature.set(signature,group);groups.push(group);
    }
    bySignature.get(signature).pets.push(pet);
  }
  for(const group of groups){
    group.pets.sort((a,b)=>String(a.bt_id).localeCompare(String(b.bt_id)));
    group.representative=group.pets[0];
    // A single member is not visually presented as a twin/equivalent set.
    if(group.pets.length<2)group.equivalent=false;
  }
  return groups;
}






const advisorPredictionEngine=AdvisorRanking.create();
let advisorPredictionJob=null;
const advisorPredictionCache=new Map(),currentPairResults=new Map(),secondaryPartners=new Map();
let currentPairJob=null;
function preparedPair(pair){return {...pair,female:{...pair.female,bonus:individualMutationBonus(pair.female)},male:{...pair.male,bonus:individualMutationBonus(pair.male)}}}
function currentPairKey(f,m){return JSON.stringify([selectedDataset?.account_id,BTView.world,PairScoring.version,f.bt_id,m.bt_id,f.stats,m.stats,individualMutationBonus(f),individualMutationBonus(m),advisorCharacterBonus(),statGoals(nodeSpeciesKey(f)),PairScoring.config])}
function currentPairResult(f,m){
 const canPredict=[f,m].every(n=>n.lifecycleState==='ACTIVE'&&!n.historical&&n.stage==='adult'&&n.stats.length===7&&n.stats.every(v=>Number.isInteger(v)&&v>=0&&v<=10)&&individualMutationBonus(n)!==null)&&f.sex==='F'&&m.sex==='M'&&nodeSpeciesKey(f)===nodeSpeciesKey(m)&&advisorCharacterBonus()!==null;
 if(!canPredict)return null;
 const key=currentPairKey(f,m);if(currentPairResults.has(key))return currentPairResults.get(key);
 const pair={key:f.bt_id+'::'+m.bt_id,female:f,male:m};
 try{const prediction=PairScoring.evaluate(PairScoring.input(preparedPair(pair),advisorCharacterBonus()),statGoals(nodeSpeciesKey(f))),result={...pair,prediction,score:prediction.average,provisional:false};
  if(currentPairResults.size>=128)currentPairResults.delete(currentPairResults.keys().next().value);currentPairResults.set(key,result);currentPairJob=null;return result;
 }catch(error){currentPairJob={key,error:error.message};return null}
}
function advisorCharacterBonus(){
 const d=BTView.document,c=d?.extensions?.active_character;
 return c&&BTView.world===d.active_world&&selectedDataset?.account_id===d.account.steam_id&&typeof c.name==='string'&&c.name.trim()&&c.name!=='None'&&Number.isFinite(c.mutation_bonus_pct)?c.mutation_bonus_pct:null;
}
function advisorPairs(){
 const all=advisorEligibleBreeders(),breeders=all.filter(n=>individualMutationBonus(n)!==null),femaleGroups=advisorCandidateGroups(breeders,'F'),maleGroups=advisorCandidateGroups(breeders,'M'),rawPairs=[];
 for(const femaleGroup of femaleGroups)for(const maleGroup of maleGroups)for(const female of femaleGroup.pets)for(const male of maleGroup.pets){if(nodeSpeciesKey(female)===nodeSpeciesKey(male))rawPairs.push({female,male,femaleGroup,maleGroup,key:stablePetId(female.bt_id)+'::'+stablePetId(male.bt_id)})}
 const character=advisorCharacterBonus(),warning=all.length>breeders.length?(all.length-breeders.length)+' breeder(s) excluded: individual mutation bonus unknown. Use Refresh in game.':'';
 const base={breeders:all,femaleGroups,maleGroups,pairs:[],rawPairs,warning,catalogs:{female:[],male:[]}};
 const key=JSON.stringify([selectedDataset?.account_id,BTView.world,currentSpecies,PairScoring.version,GeneticQuality.id,advisorStatMask(),character,preferences.advisorStrategy,rawPairs.map(p=>[p.key,p.femaleGroup.key,p.maleGroup.key,p.female.stats,p.male.stats,individualMutationBonus(p.female),individualMutationBonus(p.male)])]);
 if(advisorPredictionJob?.key!==key){advisorPredictionEngine.cancel();advisorPredictionJob=null}
 if(character===null)return {...base,warning:'Character mutation bonus unknown or outside the active world. Use Refresh in game.'};
 if(!GeneticQuality.prepare(advisorStatMask()).maxRaw)return {...base,warning:'No MAX stats: quality is 0; choose at least one MAX to rank breeders.'};
 if(!rawPairs.length)return {...base,warning:warning||'No eligible pair.'};
 if(!advisorPredictionCache.has(key)&&!advisorPredictionJob){
  const job=advisorPredictionJob={key,final:false,error:null};
  job.promise=advisorPredictionEngine.run(rawPairs.map(preparedPair),advisorStatMask(),character,{strategy:preferences.advisorStrategy,onProgress:progress=>{if(advisorPredictionJob!==job||progress.final)return;const status=advisorContent.querySelector('[role="status"]');if(status)status.textContent='Calculating deterministic recommendations… '+progress.evaluated+' evaluated · '+progress.pruned+' eliminated · '+progress.total+' distinct models';}}).then(result=>{
   if(advisorPredictionJob!==job)return;job.final=true;
   // Retain current live nodes; copied math inputs must not become UI state.
   const byKey=new Map(rawPairs.map(p=>[p.key,p]));for(const row of result.rows)row.pair=byKey.get(row.pair.key);
   for(const side of ['female','male'])for(const e of result.catalogs[side])e.pair=byKey.get(e.pair.key);
   if(advisorPredictionCache.size>=4)advisorPredictionCache.delete(advisorPredictionCache.keys().next().value);advisorPredictionCache.set(key,result);
   if(activeView.kind==='advisor')renderAdvisor();else renderBreedingPairPanel();
  }).catch(error=>{if(error.name==='AbortError'||advisorPredictionJob!==job)return;job.error=error.message;if(activeView.kind==='advisor')renderAdvisor()});
 }
 const result=advisorPredictionCache.get(key);if(!result)return {...base,pending:!advisorPredictionJob?.error,error:advisorPredictionJob?.error,cacheKey:key};
 return {...base,pairs:result.rows.map(r=>({...r.pair,rating:r,score:r.average,provisional:false})),catalogs:result.catalogs,pending:false,cacheKey:key,metrics:result.metrics};
}
async function loadSecondaryPartner(scope,entry,side){
 const key=scope.cacheKey+'|'+side+'|'+entry.key;if(secondaryPartners.has(key))return;
 const state={pending:true,best:new Map()};if(secondaryPartners.size>=64)secondaryPartners.delete(secondaryPartners.keys().next().value);secondaryPartners.set(key,state);
 const goals=advisorStatMask(),character=advisorCharacterBonus();renderAdvisor();
 for(const pair of scope.rawPairs.filter(p=>p[side+'Group'].key===entry.key)){
  const rating=PairScoring.scoreForGoals(PairScoring.input(preparedPair(pair),character),goals),row={...pair,rating,score:rating.average};
  const uid=pair[side].bt_id,old=state.best.get(uid);if(!old||row.score>old.score||(row.score===old.score&&row.key<old.key))state.best.set(uid,row);
  await new Promise(r=>setTimeout(r,0));
  if(advisorPairs().cacheKey!==scope.cacheKey){secondaryPartners.delete(key);return}
 }
 state.pending=false;if(activeView.kind==='advisor')renderAdvisor();
}
const selectedStatisticsJobs=new Map();
function selectedPairStatistics(pair){
 const params=PairScoring.input(preparedPair(pair),advisorCharacterBonus()),key=OffspringPreview.key(params);
 if(!selectedStatisticsJobs.has(key)){
  const job={key,data:null,error:null};if(selectedStatisticsJobs.size>=8)selectedStatisticsJobs.delete(selectedStatisticsJobs.keys().next().value);selectedStatisticsJobs.set(key,job);
  OffspringPreview.distribution(params).then(data=>{job.data=data;renderBreedingPairPanel();if(activeView.kind==='advisor')renderAdvisor()}).catch(error=>{job.error=error.message});
 }
 const job=selectedStatisticsJobs.get(key);if(!job.data)return job;
 const goals=statGoals(nodeSpeciesKey(pair.female)),best=Math.max(GeneticQuality.score(pair.female.stats,goals),GeneticQuality.score(pair.male.stats,goals));
 return {...job,summary:OffspringPreview.summarize(job.data,goals,pair.score,best)};
}
function advisorStatHtml(n){
  return (n.stats||Array(7).fill(null)).map((value,index)=>`<div class="stat ${statClass(index,value,nodeSpeciesKey(n))}"><label>${STAT_LABELS[index]}</label><b>${value??'—'}</b></div>`).join('');
}


function advisorParentHtml(n,sex,group=null){
  const equivalents=Math.max(0,(group?.pets?.length||1)-1);
  return `<div class="advisor-parent ${sex}" data-select-pet="${esc(n.id)}" role="button" tabindex="0">
    <div class="advisor-parent-head">
      <div><h3>${esc(displayName(n))} (${esc(n.runtime_uid??'—')})</h3><div class="small">${esc(n.bloodline||'Unknown')}${equivalents?` · ${equivalents} same-genetics sibling${equivalents===1?'':'s'} available`:''} · Individual quality: ${qualityText(individualQuality(n),nodeSpeciesKey(n))} · Individual mutation bonus: ${mutationBonusText(n)}</div></div>
      <span class="sex" style="color:var(--${sex==='female'?'female':'male'})">${sex==='female'?'♀':'♂'}</span>
    </div>
    <div class="stats">${advisorStatHtml(n)}</div>
  </div>`;
}

function renderAdvisorStatReference(){
  advisorStatReferenceButtons.innerHTML=GENOTYPE_REFERENCE.map((stat,index)=>`<button type="button" class="advisor-stat-ref-btn ${advisorState.referenceStat===index?'active':''}" data-advisor-reference-stat="${index}" title="${esc(stat.name)}">${stat.abbr}</button>`).join('');
  advisorStatReferenceButtons.querySelectorAll('[data-advisor-reference-stat]').forEach(button=>button.addEventListener('click',()=>{
    advisorState.referenceStat=Number(button.dataset.advisorReferenceStat);
    renderAdvisorStatReference();
  }));
  const index=Math.max(0,Math.min(GENOTYPE_REFERENCE.length-1,Number(advisorState.referenceStat)||0));
  const stat=GENOTYPE_REFERENCE[index];
  const verified=stat.effect;
  advisorStatReferenceDetail.innerHTML=`<div class="advisor-stat-ref-name"><span>${esc(stat.abbr)}</span><b>${esc(stat.name)}</b></div><div class="advisor-stat-ref-effect">${esc(verified)}</div><div class="advisor-stat-ref-source">Genotype reference</div>`;
}

function advisorChanceHtml(label,p){
  const pct=v=>(100*v).toFixed(1)+'%';
  return `<div class="advisor-probability"><strong>${esc(label)}: ${p.k===0?'No successes observed':pct(p.p)}</strong><small title="Pointwise Wilson interval; simulation uncertainty, not model accuracy.">IC95: ${pct(p.low)}–${pct(p.high)} · ${p.n.toLocaleString()} births</small></div>`;
}
function advisorProbabilityHtml(pair){
 if(pair.prediction.empty)return '<div class="small">No MAX stats</div>';
 const job=selectedPairStatistics(pair),r=job.summary;
 return '<details class="pair-probabilities"><summary>Probabilities · sampled IID estimate</summary>'+(r?advisorChanceHtml('Chance to reach average quality',r.reachAverage)+advisorChanceHtml('Chance to beat best parent',r.beatParent)+'<p class="small">2,000 births for this pair only. Pointwise Wilson intervals measure sampling uncertainty, not game-model accuracy.</p>':esc(job.error||'Sampling this pair…'))+'</details>';
}

// Keep panel bodies, details and scroll containers alive. Unchanged subtrees
// (notably Bloodline Prediction on a goals change) are skipped entirely.
function updateHtml(target,html){
  if(target.dataset.renderedHtml===html)return;
  const source=document.createElement('template');source.innerHTML=html;
  function sync(parent,next){
    const desired=[...next.childNodes];
    for(let i=0;i<desired.length;i++){
      const b=desired[i];let a=parent.childNodes[i];
      if(!a){parent.append(b.cloneNode(true));continue}
      if(a.nodeType!==b.nodeType||a.nodeName!==b.nodeName){a.replaceWith(b.cloneNode(true));continue}
      if(a.nodeType===3){if(a.nodeValue!==b.nodeValue)a.nodeValue=b.nodeValue;continue}
      if(a.nodeType!==1)continue;
      // The open state is user state, not generated markup.
      for(const attr of [...a.attributes])if(!b.hasAttribute(attr.name)&&attr.name!=='open'&&attr.name!=='data-state-key')a.removeAttribute(attr.name);
      for(const attr of [...b.attributes])if(a.getAttribute(attr.name)!==attr.value)a.setAttribute(attr.name,attr.value);
      if(a.innerHTML!==b.innerHTML)sync(a,b);
    }
    while(parent.childNodes.length>desired.length)parent.lastChild.remove();
  }
  sync(target,source.content);target.dataset.renderedHtml=html;
}
let realisticPreviewJob=null;
function realisticPreview(pair){
  const options={chanceMother:advisorCharacterBonus()+individualMutationBonus(pair.female),chanceFather:advisorCharacterBonus()+individualMutationBonus(pair.male),cap:PairScoring.config.cap};
  const key=AdvisorBest.key(pair.female.stats,pair.male.stats,options);
  if(realisticPreviewJob?.key!==key){
    const job=realisticPreviewJob={key,data:null,error:null};
    AdvisorBest.distribution(pair.female.stats,pair.male.stats,options,advisorStatMask()).then(data=>{job.data=data;if(realisticPreviewJob===job&&activeView.kind==='advisor'&&advisorState.preview==='best')renderAdvisor()}).catch(error=>{job.error=error.message;if(realisticPreviewJob===job&&activeView.kind==='advisor')renderAdvisor()});
  }
  return realisticPreviewJob;
}
function refreshStatGoals(){
  // Selected Pet editors and relationships have no goal-dependent data.
  const pet=byId.get(selected);
  if(pet){
    detail.querySelectorAll('.stats .stat').forEach((cell,i)=>cell.className='stat '+statClass(i,pet.stats[i],nodeSpeciesKey(pet)));
    for(const item of detail.querySelectorAll('.detail-meta .item'))if(item.querySelector('.label')?.textContent===qualityLabel())item.querySelector('.value').textContent=pet.qualityScore==null?'—':qualityText(pet.qualityScore,nodeSpeciesKey(pet));
  }
  if(activeView.kind==='advisor'){renderAdvisor();return}
  renderAdvisorControls();renderBreedingPairPanel();
  if(activeView.kind==='breeding'){
    // Update cells and order without replacing inline editors or rows.
    const rows=new Map([...breedingTable.querySelectorAll('tr[data-pet-id]')].map(row=>[row.dataset.petId,row]));
    const list=boardNodes();
    if(list.length!==rows.size||list.some(n=>!rows.has(String(n.id)))){renderBreedingTable();return}
    const focused=breedingTable.contains(document.activeElement)?document.activeElement:null,selection=focused&&typeof focused.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd]:null;
    for(const n of list){
      const row=rows.get(String(n.id));if(!row)continue;
      row.querySelectorAll('.statcell').forEach((cell,i)=>cell.className='statcell '+statClass(i,n.stats[i],nodeSpeciesKey(n)));
      row.children[12].textContent=n.qualityScore==null?'—':qualityText(n.qualityScore,nodeSpeciesKey(n));
      row.parentNode.append(row);
    }
    if(focused){focused.focus({preventScroll:true});if(selection)focused.setSelectionRange(...selection)}
  }else if(activeView.kind!=='experiment'){
    // The SVG geometry and links do not depend on goals; repaint stat classes.
    for(const node of tree.querySelectorAll('.node')){const n=byId.get(node.dataset.nodeId);if(n)node.querySelector('.score').textContent=scoreSummary(n)}
  }
}
function manuallyInactivePets(){
  const edits=loadBoardEdits();
  return currentSpeciesNodes().filter(n=>confirmedAdult(n)&&!automaticInactiveReason(n)&&edits[boardKey(n)]?.breedingActive===false).sort((a,b)=>displayName(a).localeCompare(displayName(b))||String(a.bt_id).localeCompare(String(b.bt_id)));
}
function renderManuallyInactive(){
  let panel=document.getElementById('manuallyInactivePanel');
  if(!panel){
    panel=document.createElement('section');panel.id='manuallyInactivePanel';panel.dataset.blockId='manual-inactive';panel.className='movable-block';
    panel.innerHTML='<div class="manual-inactive-heading"><span class="block-drag-handle" draggable="true" title="Drag to reorder">⠿</span><strong></strong></div><div class="manual-inactive-body"></div>';
    customizableBlocks.append(panel);setupCommonPanel(panel,'manual-inactive','.manual-inactive-heading','Manually inactive');initializeBlockOrdering();
  }
  setupCommonPanel(panel,'manual-inactive','.manual-inactive-heading','Manually inactive');
  panel.hidden=activeView.kind!=='breeding';
  const pets=manuallyInactivePets();panel.querySelector('strong').textContent='Manually inactive ('+pets.length+')';
  updateHtml(panel.querySelector('.manual-inactive-body'),pets.length?pets.map(n=>'<div class="manual-inactive-row"><button type="button" class="linkbtn" data-manual-inspect="'+esc(n.bt_id)+'">'+esc(displayName(n))+' ('+esc(n.runtime_uid??'—')+') · '+(n.sex==='F'?'♀':n.sex==='M'?'♂':'?')+' · '+esc(n.bloodline||'Unknown')+'</button><button type="button" class="control" data-reactivate="'+esc(n.bt_id)+'">Reactivate</button></div>').join(''):'<p class="small">No manually inactive adults.</p>');
  panel.querySelectorAll('[data-manual-inspect]').forEach(button=>button.onclick=()=>{const n=petByPersistentUid(button.dataset.manualInspect);if(n)selectPet(n.id)});
  panel.querySelectorAll('[data-reactivate]').forEach(button=>button.onclick=()=>{
    const n=petByPersistentUid(button.dataset.reactivate);if(!n||automaticInactiveReason(n))return;
    const edits=loadBoardEdits(),key=boardKey(n);edits[key]={...edits[key],breedingActive:true};saveBoardEdits(edits);applyBoardEdits();updateCategoryNavigation();renderBreedingTable();if(selected===n.id)refreshSelectedDetail();renderBreedingPairPanel();
  });
}

function advisorOffspringPreviewHtml(pair){
  const best=advisorState.preview==='best',r=pair.prediction;
  const sample=selectedPairStatistics(pair).summary;
  const means=r.means.map((mean,i)=>({mean,...sample?.stats[i]}));
  const realistic=best?realisticPreview(pair):null,optimum=realistic?.data?AdvisorBest.choose(realistic.data,advisorStatMask()):null;
  const obtainedBudget=optimum?.genetics.reduce((sum,v)=>sum+v,0);
  if(optimum&&obtainedBudget!==optimum.budget)throw Error('Best Realistic budget mismatch');
  const budgetHtml=best?(optimum?`Best Realistic Budget: ${obtainedBudget} / 60 · Budget chance: ${(100*optimum.budgetProbability).toFixed(2)} %`:realistic?.data?'Best Realistic Budget: unavailable':'Best Realistic Budget: calculating…'):`Average Budget: ${means.reduce((sum,s)=>sum+s.mean,0).toFixed(1)} / 60`;
  const goals=advisorStatMask(),colors={MAX:'#90b995',IGNORE:'#9da398',MIN:'#d28d80'};
  const bars=best&&!optimum?'':means.map((stat,i)=>{
    const value=best?optimum.genetics[i]:stat.mean,x=67+i*65,y=v=>340-v*30;
    return `<g><title>${STAT_LABELS[i]}: ${best?'sampled genotype at the conditional quality threshold' :(sample?'deterministic mean; sampled Q25–Q75 '+stat.low+'–'+stat.high+'; sampled Q10–Q90 '+stat.low80+'–'+stat.high80:'deterministic B2+C mean; intervals pending')}</title><rect x="${x-17}" y="${y(value)}" width="34" height="${value*30}" fill="${colors[goals[i]]}"/>${best||!sample?'':`<path class="preview-whisker" d="M${x},${y(stat.high)}V${y(stat.low)}M${x-9},${y(stat.high)}h18M${x-9},${y(stat.low)}h18" stroke="#e8e6d8" stroke-width="2"/>`}<text class="advisor-chart-mean" x="${x+11}" y="${y(value)-8}">${value.toFixed(2)}</text><text x="${x}" y="363">${STAT_LABELS[i]}</text></g>`;
  }).join('');
  return `<div class="advisor-offspring-preview">${pair.key!==breedingPanel.female_bt_id+'::'+breedingPanel.male_bt_id?`<p class="preview-context">Recommended pair preview: <button type="button" data-inspect-uid="${esc(pair.female.bt_id)}">♀ ${esc(displayName(pair.female))} (${esc(pair.female.runtime_uid??'—')})</button> × <button type="button" data-inspect-uid="${esc(pair.male.bt_id)}">♂ ${esc(displayName(pair.male))} (${esc(pair.male.runtime_uid??'—')})</button></p>`:''}<div class="preview-modes"><button type="button" data-preview="average" aria-pressed="${!best}">Average</button><button type="button" data-preview="best" aria-pressed="${best}">Best Realistic (1%)</button></div><div class="preview-budget" aria-live="polite" style="text-align:center;margin:10px 0;font-weight:700">${budgetHtml}</div><svg class="advisor-prediction-chart" viewBox="0 0 540 380" role="img" aria-label="Genetic stats from 0 to 10">${Array.from({length:11},(_,v)=>`<g class="advisor-y-tick"><path d="M35 ${340-v*30}H525" stroke="#ffffff24"/><text x="18" y="${344-v*30}">${v}</text></g>`).join('')}${Array.from({length:8},(_,i)=>`<path d="M${35+i*70} 40V340" stroke="#ffffff18"/>`).join('')}${bars}</svg><p class="small preview-note">${best?(optimum?'Best Realistic quality: '+qualityText(optimum.quality)+' · Budget '+optimum.budget+' (probability '+(100*optimum.budgetProbability).toFixed(3)+'%) · Target conditional fraction: '+(100*optimum.targetFraction).toFixed(2)+'% · Estimated cumulative probability: '+(100*optimum.p).toFixed(3)+'% = P(budget) × P(score ≥ '+optimum.score+' | budget) · Conditional tail: '+(100*optimum.conditional).toFixed(2)+'% · Indicative interval: '+(100*optimum.low).toFixed(3)+'–'+(100*optimum.high).toFixed(3)+'% · '+optimum.n.toLocaleString()+' conditional births.':realistic.error?'Best Realistic unavailable: '+esc(realistic.error):realistic.data?'No complete sampled birth available for an eligible reachable budget.':'Estimating Best Realistic…')+' This is a score-tail estimate, not the probability of this exact genotype. A small conservative margin and all score ties are included. Sampling uncertainty remains; the true cumulative probability may differ, especially when the target fraction is near 100%. Independent CRT draws assumed; not exact game probabilities.':'Average Quality: '+qualityText(r.average)+' · Deterministic B2+C means (IID, 300 attempts). Whiskers and hover intervals are separately sampled on 2,000 births for this pair only. Means are not guaranteed birth outcomes.'}</p><details class="small"><summary>Prediction uncertainty</summary><p>B2+C expectations with internal tolerance 0.0001; quadrature convergence is not a certified error bound. Sampled intervals describe births, not confidence in the model. Native reconstruction retains its documented assumptions; these are not measured game probabilities.</p></details></div>`;
}

function renderAdvisorControls(){
  advisorStatPicker.classList.add('visible');
  const goals=advisorStatMask();
  updateHtml(advisorStatToggles,STAT_LABELS.map((label,i)=>`<button type="button" class="advisor-stat-toggle goal-${goals[i].toLowerCase()}" data-advisor-stat="${i}" aria-label="${label}: ${goals[i]}">${label} <span>${goals[i]}</span></button>`).join(''));
  advisorStatToggles.querySelectorAll('[data-advisor-stat]').forEach(button=>button.onclick=()=>{
    if(!currentSpecies)return;
    const next=advisorStatMask(),i=Number(button.dataset.advisorStat),cycle=['MAX','IGNORE','MIN'];
    next[i]=cycle[(cycle.indexOf(next[i])+1)%3];

    preferences.advisorGoals[currentSpecies]=next;recomputeQualityScores();savePreferences();
    refreshStatGoals();
  });
  advisorModelNote.textContent=GeneticQuality.prepare(advisorStatMask()).maxRaw?'':'No MAX stats: individual quality is 0; recommendations and quality previews are unavailable.';
  renderAdvisorStatReference();
  const warning=document.getElementById('advisorMutationWarning');
  warning.hidden=advisorCharacterBonus()!==0;
  warning.textContent='Character genetics bonus: 0%';
}
function lineageCharacterBonus(){
  if(advisorCharacterBonus()===null)return null;
  const q=BTView.document?.extensions?.active_character?.lineage_mutation_chance_pct;
  return typeof q==='number'&&Number.isFinite(q)&&q>=0&&q<=100?q:null;
}
function bloodlinePredictionHtml(pair){
  const q=lineageCharacterBonus();
  if(q===null)return '<div class="bloodline-body"><p>Lineage bonus unavailable for this character / world. Refresh in game.</p></div>';
  const b=BloodlinePrediction.branches(q,q),known=[pair.female.bloodline,pair.male.bloodline].every(n=>typeof n==='string'&&n.trim()&&!['unknown','none','—','?'].includes(n.trim().toLowerCase())),rows=known?BloodlinePrediction.outcomes(pair.female.bloodline,pair.male.bloodline,q,q):[];
  const pct=v=>(v*100).toFixed(2)+'%';
  return `<div class="bloodline-body"><p>Character lineage bonus <strong>+${q}%</strong> · effective combined B = ${b.bonus}</p><div class="bloodline-branch-bar" aria-label="Direct mother / direct father / catalogue branches"><span style="width:${b.maternalDirect*100}%">${pct(b.maternalDirect)}</span><span style="width:${b.paternalDirect*100}%">${pct(b.paternalDirect)}</span><span style="width:${b.randomBranch*100}%">${pct(b.randomBranch)}</span></div><div class="blood-branches"><span>Mother <b>${pct(b.maternalDirect)}</b></span><span>Father <b>${pct(b.paternalDirect)}</b></span><span>Catalogue <b>${pct(b.randomBranch)}</b></span></div><details><summary>Final Bloodlines · conditional catalogue prediction</summary>${known?'':'<p>Final Bloodline probabilities unavailable: parental Bloodline unknown.</p>'}<table class="bloodline-table">${rows.sort((a,b)=>b.p-a.p||a.name.localeCompare(b.name)).map(r=>`<tr><td>${esc(r.name)}</td><td>${pct(r.p)}</td></tr>`).join('')}</table></details><p class="small">Assumes the character bonus applies equally to both parents. Catalogue weights and order follow the local JSON studied in Ghidra; runtime order is unverified. Uniform independent CRT draws and usual SSE rounding assumed. A catalogue draw may return a parental Bloodline.</p></div>`;
}

const ADVISOR_PANEL_IDS=['advisor-candidates','advisor-offspring','advisor-bloodlines'];
const advisorDetails=new Map();
function advisorDetailScope(){return JSON.stringify([selectedDataset?.account_id,BTView.world,currentSpecies])}
function rememberAdvisorDetails(){const key=advisorContent.dataset.detailScope;if(!key)return;const states=advisorDetails.get(key)||new Map();for(const d of advisorContent.querySelectorAll('details'))states.set(d.dataset.stateKey||d.querySelector('summary')?.textContent,d.open);if(advisorDetails.size>=16&&!advisorDetails.has(key))advisorDetails.delete(advisorDetails.keys().next().value);advisorDetails.set(key,states)}
function restoreAdvisorDetails(){const key=advisorDetailScope(),states=advisorDetails.get(key),sameScope=advisorContent.dataset.detailScope===key;advisorContent.dataset.detailScope=key;for(const d of advisorContent.querySelectorAll('details')){d.dataset.stateKey=d.classList.contains('pair-probabilities')?'Probabilities:'+advisorState.chosenPairKey:d.querySelector('summary')?.textContent;const open=states?.get(d.dataset.stateKey);if(open!==undefined)d.open=open;else if(!sameScope)d.open=false}}
function organizeAdvisorPanels(markup){
  const source=document.createElement('div');source.innerHTML=markup;
  const preview=source.querySelector('.advisor-offspring-preview');
  const recommendation=source.querySelector('.advisor-result');if(recommendation&&preview&&advisorState.chosenPairKey!==breedingPanel.female_bt_id+'::'+breedingPanel.male_bt_id)preview.prepend(recommendation);
  const candidates=source.querySelector('.advisor-alternatives')||document.createElement('div');candidates.classList.add('advisor-alternatives');
  const blood=source.querySelector('.bloodline-result');
  const status=source.querySelector('[role="status"]');if(status&&candidates)candidates.prepend(status);

  for(const [id,title,nodes] of [
    ['advisor-candidates','Top candidates',candidates?[candidates]:[]],
    ['advisor-offspring','Offspring Preview',preview?[preview]:[Object.assign(document.createElement('p'),{className:'small empty-preview',textContent:'Prediction unavailable. Select eligible parents with complete data.'})]],
    ['advisor-bloodlines','Bloodline Prediction',blood?[blood]:[Object.assign(document.createElement('p'),{className:'small empty-preview',textContent:'Bloodline prediction unavailable for this scope.'})]]
  ]){
    let panel=advisorContent.querySelector(`[data-block-id="${id}"]`);
    if(!panel){panel=document.createElement('section');panel.className='advisor-panel';panel.dataset.blockId=id;
    panel.innerHTML=`<div class="advisor-panel-heading"><span class="block-drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder ${title}">⠿</span><strong>${title}</strong></div>`;
    const body=document.createElement('div');body.className='advisor-panel-body';panel.append(body);advisorContent.append(panel);
    }
    const incoming=document.createElement('div');incoming.append(...nodes);updateHtml(panel.querySelector('.advisor-panel-body'),incoming.innerHTML);
    setupCommonPanel(panel,id,'.advisor-panel-heading',title);
  }
  const order=[...new Set([...preferences.advisorPanelOrder,...ADVISOR_PANEL_IDS])];
  const applyOrder=()=>{order.forEach((id,i)=>{const p=advisorContent.querySelector(`[data-block-id="${id}"]`);if(p&&advisorContent.children[i]!==p)advisorContent.insertBefore(p,advisorContent.children[i]||null)})};
  if(!advisorContent.blockOrderingController)initializeBlockOrdering(advisorContent,{
    apply:applyOrder,
    save:()=>{preferences.advisorPanelOrder=[...advisorContent.children].map(p=>p.dataset.blockId);savePreferences()}
  });
  if(!advisorContent.querySelector('.block-dragging'))applyOrder();
  initializeAdvisorCollapsibles();
  restoreAdvisorDetails();
}
function advisorPairPrediction(pair){
 const complete=currentPairResult(pair.female,pair.male);if(!complete)return null;pair=complete;
  const w=BTView.document.worlds[BTView.world],f=w.pets[pair.female.bt_id],m=w.pets[pair.male.bt_id];
  return {schema:2,model:PairScoring.version,quality_policy:GeneticQuality.id,
    units:'useful-genetic-points',maximum_quality:pair.prediction.maxQuality,expected_budget:pair.prediction.averageBudget,expected_quality:pair.prediction.average,expected_genetics:[...pair.prediction.means],
    provenance:{account_id:BTView.document.account.steam_id,world:BTView.world,
      female_bt_id:pair.female.bt_id,male_bt_id:pair.male.bt_id,
      female_genetics:[...f.genetics],male_genetics:[...m.genetics],female_species:f.species_key||f.actor_class,male_species:m.species_key||m.actor_class,
      female_bonus_pct:individualMutationBonus(pair.female),male_bonus_pct:individualMutationBonus(pair.male),
      character_name:BTView.document.extensions.active_character.name,character_bonus_pct:advisorCharacterBonus(),
      stat_goals:[...statGoals(nodeSpeciesKey(pair.female))],goals_key:nodeSpeciesKey(pair.female),method:'B2+C',max_attempts:300,max_stat:10,tolerance:.0001,cap:PairScoring.config.cap}};
}

function renderAdvisor(){
 rememberAdvisorDetails();updateViewChrome();wrap.style.display='none';breedingTableWrap.style.display='none';advisorWrap.style.display='block';
 setViewHeading('Advisor — '+specialViewScopeLabel(),activeViewDescription());renderAdvisorControls();
 const scope=advisorPairs(),{femaleGroups,maleGroups,pairs,pending,warning,error}=scope;renderBreedingPairPanel();
 countText.textContent=femaleGroups.reduce((s,g)=>s+g.pets.length,0)+' eligible females · '+maleGroups.reduce((s,g)=>s+g.pets.length,0)+' eligible males · '+scope.rawPairs.length+' pairs';
 const strategyHtml='<div class="advisor-strategy" role="group" aria-label="Ranking strategy">Strategy: '+[['all-pairs','All Pairs'],['progressive','Progressive']].map(([id,label])=>'<button type="button" data-ranking-strategy="'+id+'" aria-pressed="'+(preferences.advisorStrategy===id)+'">'+label+'</button>').join('')+'</div>';
 if(!pairs.length){organizeAdvisorPanels('<div class="advisor-alternatives">'+strategyHtml+'<p role="status">'+esc(error||(pending?'Calculating deterministic recommendations…':warning||'No eligible pair.'))+'</p></div>');bindStrategy();return}
 const selectedRaw=scope.rawPairs.find(p=>p.female.bt_id===breedingPanel.female_bt_id&&p.male.bt_id===breedingPanel.male_bt_id);
 const chosen=selectedRaw?{...selectedRaw,...currentPairResult(selectedRaw.female,selectedRaw.male)}:{...pairs[0],...currentPairResult(pairs[0].female,pairs[0].male)};
 advisorState.chosenPairKey=chosen.key;
 function candidateRows(entry,index,side){
  const group=entry.group,members=group?.pets||[entry.pair[side]],secondary=secondaryPartners.get(scope.cacheKey+'|'+side+'|'+entry.key);
  return '<div class="advisor-alt-row '+side+(members.length>1?' twins':'')+'"><span class="advisor-alt-rank">'+(index<3?'#'+(index+1):'')+'</span><div class="candidate-members">'+members.map(member=>{
   const best=secondary?.best.get(member.bt_id)||(entry.rating?pairs.filter(p=>p[side].bt_id===member.bt_id).sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key))[0]:null),partner=best?.[side==='female'?'male':'female'];
   const info=partner?'Best: <span role="button" tabindex="0" data-inspect-uid="'+esc(partner.bt_id)+'">'+esc(displayName(partner))+' ('+esc(partner.runtime_uid??'—')+')</span> · '+qualityText(best.score):secondary?.pending?'Calculating best partner…':'<button type="button" data-load-partner="'+esc(entry.key)+'" data-partner-side="'+side+'">Calculate best partner</button>';
   return '<div role="button" tabindex="0" class="advisor-alt '+side+(member.bt_id===breedingPanel[side+'_bt_id']?' selected':'')+'" data-advisor-candidate-side="'+side+'" data-advisor-group="'+esc(entry.key)+'" data-advisor-uid="'+esc(member.bt_id)+'"><span class="advisor-alt-pair"><strong>'+esc(displayName(member))+' ('+esc(member.runtime_uid??'—')+')</strong><span>'+esc(member.bloodline||'Unknown')+' · Mut '+mutationBonusText(member)+'</span><span class="best-partner">'+info+'</span></span><span class="advisor-alt-score" title="Individual useful genetic points">'+qualityText(individualQuality(member))+'</span></div>';
  }).join('')+'</div></div>';
 }
 const columns=['female','male'].map(side=>{const list=scope.catalogs[side];return '<div class="advisor-candidate-group"><div class="advisor-candidate-group-head '+side+'">'+(side==='female'?'♀ Best females':'♂ Best males')+'</div><div class="advisor-alt-list">'+list.slice(0,3).map((e,i)=>candidateRows(e,i,side)).join('')+'</div><details class="candidate-catalog"><summary>Other eligible '+side+'s</summary>'+list.slice(3).map((e,i)=>candidateRows(e,i+3,side)).join('')+'</details></div>'}).join('');
 const markup='<div role="status" class="small">'+esc(warning||'Ranked by expected useful genetic points · differences below 0.01 are displayed in stable ID groups.')+'</div><div class="advisor-primary"><div class="advisor-result"><div class="advisor-rank">'+(selectedRaw?'Selected pair':'Recommended pair')+'</div><div class="small">Average Quality</div><div class="advisor-score">'+qualityText(chosen.score)+'</div>'+advisorProbabilityHtml(chosen)+'</div></div>'+advisorOffspringPreviewHtml(chosen)+'<div class="bloodline-result">'+bloodlinePredictionHtml(chosen)+'</div><div class="advisor-alternatives">'+strategyHtml+'<div class="advisor-alternatives-head"><strong>Top candidates</strong><span>Select a breeder to replace only that side of Current Pair.</span></div><div class="advisor-candidate-columns">'+columns+'</div></div>';
 organizeAdvisorPanels(markup);bindStrategy();
 advisorContent.querySelectorAll('[data-advisor-candidate-side]').forEach(button=>{
  button.onkeydown=e=>{if(e.target===button&&['Enter',' '].includes(e.key)){e.preventDefault();button.click()}};
  button.onclick=()=>{const side=button.dataset.advisorCandidateSide,pet=petByPersistentUid(button.dataset.advisorUid);if(!pet||breederAssignmentBlockReason(pet))return;
   breedingPanel[side+'_bt_id']=pet.bt_id;delete breedingPanel.prediction;breedingPanelDirty=true;selected=pet.id;renderAdvisor();refreshSelectedDetail();
  };
 });
 advisorContent.querySelectorAll('[data-load-partner]').forEach(button=>button.onclick=event=>{event.stopPropagation();const side=button.dataset.partnerSide,entry=scope.catalogs[side].find(e=>e.key===button.dataset.loadPartner);loadSecondaryPartner(scope,entry,side).catch(error=>{setPairStatus(error.message)})});
 advisorContent.querySelectorAll('[data-select-pet]').forEach(button=>button.onclick=()=>selectPet(button.dataset.selectPet));
 advisorContent.querySelectorAll('[data-preview]').forEach(button=>button.onclick=()=>{advisorState.preview=button.dataset.preview;renderAdvisor()});
 function bindStrategy(){advisorContent.querySelectorAll('[data-ranking-strategy]').forEach(button=>button.onclick=()=>{preferences.advisorStrategy=button.dataset.rankingStrategy;savePreferences();renderAdvisor()})}
}

function render({selectFirst=false}={}){
  if(activeView.kind!=='advisor'&&advisorPredictionJob&&!advisorPredictionJob.final){advisorPredictionEngine.cancel();advisorPredictionJob=null}
  hideTooltip();
  renderAdvisorControls();
  updateViewChrome();
  if(experimentWrap)experimentWrap.hidden=activeView.kind!=='experiment';
  if(activeView.kind==='experiment'){
    globalThis.Experimenter?.render();
    return;
  }
  if(activeView.kind==='advisor'){
    renderAdvisor();
    return;
  }
  advisorWrap.style.display='none';
  if(activeView.kind==='breeding'){
    renderBreedingTable();
    return;
  }
  breedingTableWrap.style.display='none';
  wrap.style.display='block';
  const structuralList=viewNodes(activeView,currentSpecies,{includeInactive:true});
  const list=structuralList.filter(n=>confirmedAdult(n)&&(!hideInactive||n.breedingActive));
  const query=search.value.trim().toLowerCase();
  const matchingIds=new Set(list.filter(node=>nodeMatchesSearch(node,query)).map(node=>node.id));
  setViewHeading(activeViewLabel(),activeViewDescription());
  countText.textContent=query?`${matchingIds.size} matches / ${list.length} individuals`:`${list.length} individuals / data points`;
  tree.innerHTML='';
  if(!list.length){
    if(selectFirst){
      selected=null;
      detail.innerHTML='<div class="detail-placeholder">No pet matches the current category and search filters.</div>';
    }
    tree.setAttribute('viewBox',`0 0 ${800*UI_SCALE} ${280*UI_SCALE}`);
    const emptyLayer=svgEl('g',{transform:`scale(${UI_SCALE})`});
    const t=svgEl('text',{x:400,y:140,'text-anchor':'middle',fill:'#9aa5ad','font-size':'14'});
    t.textContent='No results for this search.';
    emptyLayer.appendChild(t);tree.appendChild(emptyLayer); lastLayout=null; zoomLabel.textContent=`${Math.round(zoomScale*100)}%`; return;
  }
  const L=layoutNodes(structuralList,list); lastLayout=L;
  if(selectFirst)selected=firstLayoutNodeId(L,query?matchingIds:null);
  if(selectFirst&&query&&!selected){
    detail.innerHTML='<div class="detail-placeholder">No pet matches the current search. The complete pedigree remains visible for context.</div>';
  }
  const siblingIds=new Set(selected?(siblingsById.get(selected)||[]):[]);
  tree.setAttribute('viewBox',`0 0 ${L.width*UI_SCALE} ${L.height*UI_SCALE}`);
  const graphLayer=svgEl('g',{transform:`scale(${UI_SCALE})`});
  tree.appendChild(graphLayer);
  applyZoom();

  // edges
  for(const n of list){
    const child=L.pos.get(n.id);
    for(const [parentId,type] of [[n.mother,'mother'],[n.father,'father']]){
      if(!parentId||!L.ids.has(parentId))continue;
      const p=L.pos.get(parentId);
      const x1=p.x+p.w/2,y1=p.y+p.h,x2=child.x+child.w/2,y2=child.y;
      const mid=(y1+y2)/2;
      const path=svgEl('path',{d:`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,class:`edge ${type}`});
      graphLayer.appendChild(path);
    }
  }

  if(activeView.kind==='foundation'||activeView.kind==='family'){
    // In focused lineage views, link adjacent full siblings without creating a complete mesh.
    const siblingGroups=new Map();
    for(const n of list){
      if(!n.mother||!n.father)continue;
      const key=JSON.stringify([n.mother,n.father]);
      if(!siblingGroups.has(key))siblingGroups.set(key,[]);
      siblingGroups.get(key).push(n);
    }
    for(const siblings of siblingGroups.values()){
      if(siblings.length<2)continue;
      siblings.sort((a,b)=>L.pos.get(a.id).x-L.pos.get(b.id).x);
      for(let index=1;index<siblings.length;index++){
        const left=L.pos.get(siblings[index-1].id),right=L.pos.get(siblings[index].id);
        const x1=left.x+left.w,y1=left.y+left.h/2,x2=right.x,y2=right.y+right.h/2;
        const bend=Math.max(18,Math.abs(x2-x1)*.22);
        graphLayer.appendChild(svgEl('path',{d:`M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`,class:'edge sibling'}));
      }
    }
  }

  for(const n of list){
    const p=L.pos.get(n.id);
    const searchClass=query?(matchingIds.has(n.id)?' search-match':' search-muted'):'';
    const g=svgEl('g',{class:`node ${activityClass(n)}${roleClass(n)}${selected===n.id?' selected':siblingIds.has(n.id)?' sibling-peer':''}${searchClass}`,transform:`translate(${p.x},${p.y})`,'data-node-id':n.id,tabindex:'0',role:'button','aria-label':displayName(n)});
    const rect=svgEl('rect',{class:'body',x:0,y:0,width:p.w,height:p.h});
    g.appendChild(rect);
    const sex=svgEl('text',{x:12,y:20,class:'sexmark',fill:n.sex==='F'?'#d8a3c2':n.sex==='M'?'#7eb5df':'#a7afb4'});
    sex.textContent=n.sex==='F'?'♀':n.sex==='M'?'♂':'?'; g.appendChild(sex);
    const name=svgEl('text',{x:29,y:20,class:'name'}); {const label=displayName(n);name.textContent=label.length>23?label.slice(0,22)+'…':label;} g.appendChild(name);
    const meta=svgEl('text',{x:12,y:39,class:'meta'}); meta.textContent=[n.bloodline,'Mut '+mutationBonusText(n),!n.historical&&!n.isPresent?'Missing':'',n.role].filter(Boolean).join(' · '); g.appendChild(meta);
    const score=svgEl('text',{x:12,y:56,class:'score'}); score.textContent=scoreSummary(n); g.appendChild(score);

    g.addEventListener('click',()=>selectNode(n.id));
    g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNode(n.id)}});
    g.addEventListener('mousemove',e=>showTooltip(n,e.clientX,e.clientY));
    g.addEventListener('mouseleave',hideTooltip);
    graphLayer.appendChild(g);
  }
  if(selected&&L.pos.has(selected)){
    const p=L.pos.get(selected);
    graphLayer.appendChild(svgEl('rect',{class:'selection-outline',x:p.x-2,y:p.y-2,width:p.w+4,height:p.h+4,rx:6}));
  }
  if(selectFirst&&selected)renderSelectedDetail(selected);
}

function statClass(index,val,speciesKey=currentSpecies){
  if(val==null)return '';
  const goal=statGoals(speciesKey)[index];
  if(goal==='IGNORE')return 'goal-ignore';
  const oriented=goal==='MIN'?10-val:val;
  return oriented===10?'great':oriented>=8?'good':oriented<=2?'bad':'';
}

function renderSelectedDetail(id){
  const focused=detail.contains(document.activeElement)&&detail.dataset.petId===id?document.activeElement:null;
  const focusState=focused?.dataset.detailField?{field:focused.dataset.detailField,start:focused.selectionStart,end:focused.selectionEnd}:null;
  detail.dataset.petId=id;
  const n=byId.get(id); if(!hasPetName(n)){detail.innerHTML='<div class="detail-placeholder">No pet selected.</div>';selectedPetSummary.textContent='';return;}
  const ownedFoundation=foundationForPet(n);
  selectedPetSummary.textContent=`${displayName(n)} (${n.runtime_uid??'—'}) · ${n.sex==='F'?'Female':n.sex==='M'?'Male':'Unknown sex'}`;
  const inactiveLock=n.breedingInactiveReason||automaticInactiveReason(n);
  const statHtml=(n.stats||[]).map((v,i)=>`<div class="stat ${statClass(i,v,nodeSpeciesKey(n))}"><label>${STAT_LABELS[i]}</label><b>${v??'—'}</b></div>`).join('');
  const kids=offspringOf(id);
  const siblings=siblingsOf(n);
  const parentButtons=['mother','father'].map(side=>{
    const parent=n[side]&&byId.get(n[side]);
    if(hasPetName(parent))return `<button class="linkbtn" data-id="${esc(parent.id)}">${esc(displayName(parent))}</button>`;
    const label=n[side+'Label'];return label?`<span class="small">${side==='mother'?'Mother':'Father'}: ${esc(label)} (recorded name)</span>`:'';
  }).join('')||'<span class="small">None</span>';
  const siblingButtons=siblings.map(peer=>`<button class="linkbtn" data-id="${esc(peer.id)}">${esc(displayName(peer))}</button>`).join('')||'<span class="small">None</span>';
  const childButtons=kids.map(k=>`<button class="linkbtn" data-id="${esc(k.id)}">${esc(displayName(k))}</button>`).join('')||'<span class="small">None</span>';
  detail.innerHTML=`
    <div class="detail-card">
      <div class="detail-identity">
        <h2><span>${esc(n.name)}${n.nickname?` <span class="small">(${esc(n.nickname)})</span>`:''}</span><span class="detail-uid">(${esc(n.runtime_uid??'—')})</span></h2>
        <div class="small">${esc(speciesLabel(nodeSpeciesKey(n)))} · ${n.sex==='F'?'Female':n.sex==='M'?'Male':'Unknown sex'} · ${esc(n.bloodline)} · ${presenceLabel(n)} · Breeding: ${activityLabel(n)}${n.role?` · Role: ${esc(n.role)}`:''}</div>
      </div>
      <div class="stats">${statHtml}</div>
      <div class="detail-meta">
        <div class="item"><span class="label">Total</span><span class="value">${n.total7??'—'}</span></div>
        <div class="item"><span class="label">${qualityLabel(nodeSpeciesKey(n))}</span><span class="value">${n.qualityScore==null?'—':qualityText(n.qualityScore,nodeSpeciesKey(n))}</span></div>
        <div class="item"><span class="label">Level</span><span class="value">${n.level??'—'}</span></div>
        <div class="item"><span class="label">Experience</span><span class="value">${n.experience??'—'}</span></div>
        <div class="item"><span class="label">Individual mutation bonus</span><span class="value">${mutationBonusText(n)}</span></div>
      </div>
      <div class="detail-fields">
        <label>Nickname<input data-detail-field="nickname" value="${esc(n.nickname||'')}" placeholder="Optional nickname"></label>
        <label>Breeding status<select data-detail-field="breedingActive" ${inactiveLock?`disabled title="${esc(inactiveLock)}"`:''}><option value="true" ${n.breedingActive?'selected':''}>Active</option><option value="false" ${!n.breedingActive?'selected':''}>Inactive</option></select>${inactiveLock?`<span class="small">${esc(inactiveLock)}</span>`:''}</label>
        <label class="detail-role">Role<select data-detail-field="role">${roleOptionsHtml(n.role)}</select></label>
        <label class="detail-notes">Notes<textarea data-detail-field="notes" placeholder="Personal notes">${esc(n.notes||'')}</textarea></label>
        <div class="detail-actions">
          <button class="tab" id="detailAddRoleBtn" title="Create a custom pet role">+ Add role</button>
          ${breedingSelectionButtonHtml(n)}
          <button class="tab family-view-action" id="viewPetLineageBtn">${ownedFoundation?'See foundation':'See family'}</button>
        </div>
      </div>
      <div class="detail-lower">
        <div class="detail-relations">
          <div class="relation-group"><span class="relation-label">Parents</span>${parentButtons}</div>
          <div class="relation-group"><span class="relation-label">Siblings (${siblings.length})</span>${siblingButtons}</div>
          <div class="relation-group"><span class="relation-label">Offspring (${kids.length})</span>${childButtons}</div>
        </div>
        <div class="detail-save"><span class="save-state" id="detailSaveState"></span><button class="control" id="saveDetailBtn">Save annotations</button></div>
      </div>
    </div>`;
  detail.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>jumpToNode(b.dataset.id)));
  const saveDetail=()=>{
    const edits=loadBoardEdits(), key=boardKey(n);
    edits[key]=edits[key]||{};
    detail.querySelectorAll('[data-detail-field]').forEach(el=>{
      edits[key][el.dataset.detailField]=el.dataset.detailField==='breedingActive'?el.value==='true':el.value;
    });
    detailDrafts.delete(draftKey(id)); saveBoardEdits(edits); applyBoardEdits(); updateCategoryNavigation(); render(); renderSelectedDetail(id);
    const state=document.getElementById('detailSaveState'); if(state)state.textContent='Saved ✓';
  };
  const detailDraftChanged=()=>[...detail.querySelectorAll('[data-detail-field]')].some(el=>{
    const field=el.dataset.detailField;
    const draft=field==='breedingActive'?el.value==='true':el.value;
    const saved=field==='breedingActive'?n.breedingActive:String(n[field]??'');
    return draft!==saved;
  });
  const syncDetailSaveButton=()=>{
    const button=document.getElementById('saveDetailBtn');
    const changed=detailDraftChanged();
    if(changed)detailDrafts.set(draftKey(id),Object.fromEntries([...detail.querySelectorAll('[data-detail-field]')].map(el=>[el.dataset.detailField,el.value])));
    else detailDrafts.delete(draftKey(id));
    button.classList.toggle('primary-control',changed);
    button.textContent=changed?'Save annotations *':'Save annotations';
    if(changed){const state=document.getElementById('detailSaveState');if(state)state.textContent=''}
  };
  document.getElementById('saveDetailBtn').addEventListener('click',saveDetail);
  detail.querySelectorAll('[data-detail-field]').forEach(el=>el.addEventListener(el.matches('select')?'change':'input',syncDetailSaveButton));
  const retainedDraft=detailDrafts.get(draftKey(id));
  if(retainedDraft)detail.querySelectorAll('[data-detail-field]').forEach(el=>{if(Object.hasOwn(retainedDraft,el.dataset.detailField))el.value=retainedDraft[el.dataset.detailField]});
  syncDetailSaveButton();
  if(focusState){
    const input=detail.querySelector('[data-detail-field="'+focusState.field+'"]');
    if(input){input.focus({preventScroll:true});if(typeof input.setSelectionRange==='function'&&focusState.start!==null)input.setSelectionRange(focusState.start,focusState.end)}
  }
  document.getElementById('viewPetLineageBtn').addEventListener('click',()=>openPetLineage(n,ownedFoundation));
  document.getElementById('detailAddRoleBtn').addEventListener('click',promptAddRole);
  document.getElementById('setBreedingSelectionBtn')?.addEventListener('click',()=>setBreedingSelection(n));
  detail.querySelector('[data-detail-field="notes"]').addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();saveDetail()}
  });
  setTimeout(()=>scrollNodeIntoView(id),0);
}
function selectPet(id,{rerender=true}={}){
  if(!hasPetName(byId.get(id)))return;
  selected=id;
  if(rerender)render();
  renderSelectedDetail(id);
}
function selectNode(id){selectPet(id)}
function refreshSelectedDetail(){if(selected&&byId.has(selected))renderSelectedDetail(selected)}
function jumpToNode(id){
  const n=byId.get(id); if(!n)return;
  if(hideInactive&&!n.breedingActive)hideInactive=false;
  currentSpecies=nodeSpeciesKey(n);
  activeView={kind:'species',key:null};
  updateCategoryNavigation();selectNode(id);
}

function scrollNodeIntoView(id){
  if(!lastLayout?.pos.has(id))return;
  const target=[...tree.querySelectorAll('.node')].find(node=>node.dataset.nodeId===id);
  if(!target)return;
  const targetRect=target.getBoundingClientRect(),wrapRect=wrap.getBoundingClientRect(),treeRect=tree.getBoundingClientRect();
  const scaleX=tree.scrollWidth?treeRect.width/tree.scrollWidth:1;
  const scaleY=tree.scrollHeight?treeRect.height/tree.scrollHeight:1;
  const deltaX=(targetRect.left+targetRect.width/2)-(wrapRect.left+wrapRect.width/2);
  const deltaY=(targetRect.top+targetRect.height/2)-(wrapRect.top+wrapRect.height/2);
  const left=Math.max(0,Math.min(wrap.scrollWidth-wrap.clientWidth,wrap.scrollLeft+deltaX/scaleX));
  const top=Math.max(0,Math.min(wrap.scrollHeight-wrap.clientHeight,wrap.scrollTop+deltaY/scaleY));
  wrap.scrollTo({left,top,behavior:'smooth'});
}
function showTooltip(n,x,y){
  tooltip.innerHTML=`<strong>${esc(displayName(n))}</strong><div>${esc(n.bloodline)} · ${presenceLabel(n)} · Breeding: ${activityLabel(n)}${n.role?' · '+esc(n.role):''}</div><div class="ttstats">${statsText(n)}${n.total7!=null?` · ${scoreSummary(n)}`:''}</div>`;
  positionTooltip(x,y);
}
function showTextTooltip(title,text,x,y){
  tooltip.innerHTML=`<strong>${esc(title)}</strong><div>${esc(text)}</div>`;
  positionTooltip(x,y);
}
function positionTooltip(x,y){
  tooltip.style.display='block';
  const pad=12;
  const tw=tooltip.offsetWidth,th=tooltip.offsetHeight;
  tooltip.style.left=Math.min(window.innerWidth-tw-pad,x+14)+'px';
  tooltip.style.top=Math.min(window.innerHeight-th-pad,y+14)+'px';
}
function hideTooltip(){tooltip.style.display='none'}

viewTitle.addEventListener('mousemove',event=>{
  if(viewTitle.dataset.tooltip)showTextTooltip(viewTitle.textContent,viewTitle.dataset.tooltip,event.clientX,event.clientY);
});
viewTitle.addEventListener('mouseleave',hideTooltip);

const DEFAULT_ROLES=['Retired','Reserve','Experimental'];
let boardSort={key:'qualityScore',dir:-1};
let boardEdits=null;

function boardKey(n){return String(n.bt_id??n.id)}
function normalizeBoardEdits(edits){
  edits=edits&&typeof edits==='object'&&!Array.isArray(edits)?edits:{};
  for(const e of Object.values(edits)){
    if(!e||typeof e!=='object')continue;
    if(typeof e.breedingActive!=='boolean' && typeof e.breeding_status==='string'){
      e.breedingActive=e.breeding_status.toLowerCase()==='active';
    }
    if(typeof e.role!=='string' && typeof e.breeding_role==='string')e.role=e.breeding_role;
  }
  return edits;
}
function loadBoardEdits(){
  if(boardEdits)return boardEdits;
  boardEdits={};
  return boardEdits;
}
function saveBoardEdits(edits){
  boardEdits=normalizeBoardEdits(edits);
  markUserDataDirty();
}
function applyBoardEdits(){
  const edits=loadBoardEdits();
  for(const n of DATA.nodes){
    const key=boardKey(n);
    const e=edits[key];
    const requestedActive=typeof e?.breedingActive==='boolean'?e.breedingActive:true;
    n.breedingInactiveReason=automaticInactiveReason(n);
    n.breedingActive=n.breedingInactiveReason?false:requestedActive;
    if(!e)continue;
    if(typeof e.nickname==='string')n.nickname=e.nickname;
    if(typeof e.role==='string')n.role=e.role;
    if(typeof e.notes==='string')n.notes=e.notes;
  }
}

function allRoles(){
  const custom=Array.isArray(preferences.customRoles)?preferences.customRoles:[];
  const used=DATA.nodes.map(n=>n.role).filter(Boolean);
  return [...new Set([...DEFAULT_ROLES,...custom,...used])];
}
function roleOptionsHtml(selected=''){
  return `<option value="">No role</option>`+allRoles().map(role=>`<option value="${esc(role)}" ${role===selected?'selected':''}>${esc(role)}</option>`).join('');
}
function petNameWithUid(n){
  return hasPetName(n)?`${displayName(n)} (${n.runtime_uid??'—'})`:'—';
}
function parentDisplay(n){
  const m=n.mother?(byId.has(n.mother)?petNameWithUid(byId.get(n.mother)):n.mother):(n.motherLabel||'—');
  const f=n.father?(byId.has(n.father)?petNameWithUid(byId.get(n.father)):n.father):(n.fatherLabel||'—');
  return `${m} × ${f}`;
}
function boardNodes(){
  applyBoardEdits();
  let list=specialViewScopeNodes().filter(n=>confirmedAdult(n)&&(!hideInactive||n.breedingActive));
  const q=search.value.trim().toLowerCase();
  if(q)list=list.filter(n=>[n.name,n.nickname,n.bloodline,n.role,n.notes,n.sex,presenceLabel(n),activityLabel(n),statsText(n),parentDisplay(n),n.level,n.qualityScore,n.total7].join(' ').toLowerCase().includes(q));
  const key=boardSort.key,dir=boardSort.dir;
  const value=n=>/^s[0-6]$/.test(key)?n.stats?.[Number(key[1])]:key==='mutationBonus'?individualMutationBonus(n):n[key];
  const missing=v=>v===null||v===undefined||v===''||(typeof v==='number'&&!Number.isFinite(v))||(key==='sex'&&!['F','M'].includes(v));
  const text=(a,b)=>String(a).localeCompare(String(b),'en',{numeric:true,sensitivity:'base'});
  list.sort((a,b)=>{
    const av=value(a),bv=value(b),am=missing(av),bm=missing(bv);
    if(am!==bm)return am?1:-1; // Unknowns last in both directions.
    const order=am?0:typeof av==='string'||typeof bv==='string'?text(av,bv):Number(av)-Number(bv);
    return order*dir||text(a.name||'',b.name||'')||text(a.bt_id||a.id,b.bt_id||b.id);
  });
  return list;
}
function renderBreedingTable(){
  updateViewChrome();
  advisorWrap.style.display='none';
  wrap.style.display='none';
  breedingTableWrap.style.display='block';
  setViewHeading(`Board — ${specialViewScopeLabel()}`,specialViewScope().kind==='bloodline'
    ? `Bloodline ${specialViewScope().key} within ${speciesLabel(currentSpecies)}. Archived animals remain in history and pedigree; only active adults can breed.`
    : 'Active adults are eligible for breeding, subject to your choices. Archived animals remain available for history and pedigree.');
  const list=boardNodes();
  const scopeNodes=specialViewScopeNodes().filter(confirmedAdult);
  const scopeTotal=scopeNodes.length;
  countText.textContent=`${list.length} shown / ${scopeTotal} in scope`;
  breedingCountHint.textContent=`${scopeNodes.filter(n=>!n.breedingActive).length} inactive`;
  const headers=[['name','Name / ID'],['nickname','Nickname'],['sex','Sex'],['bloodline','Lineage'],['mutationBonus','Mutation %'],['s0','V'],['s1','F'],['s2','P'],['s3','R'],['s4','T'],['s5','A'],['s6','I'],['qualityScore',qualityLabel()],['total7','Total'],['level','Lvl'],['lifecycleState','Lifecycle'],['breedingActive','Breeding status'],['role','Role']];
  breedingTable.innerHTML=`<thead><tr>${headers.map(([k,l])=>`<th data-sort="${k}">${l}</th>`).join('')}</tr></thead><tbody></tbody>`;
  const tbody=breedingTable.querySelector('tbody');
  for(const n of list){
    const tr=document.createElement('tr');
    const statCells=(n.stats||Array(7).fill(null)).map((v,i)=>`<td class="statcell ${statClass(i,v)}">${v??'—'}</td>`).join('');
    tr.classList.toggle('selected-row',selected===n.id);
    tr.innerHTML=`
      <td><button class="linkbtn open-node" data-id="${esc(n.id)}"><span class="board-pet-name">${esc(n.name)}</span><span class="board-pet-uid">(${esc(n.runtime_uid??'—')})</span></button></td>
      <td><input data-field="nickname" data-key="${esc(boardKey(n))}" value="${esc(n.nickname||'')}" placeholder="—"></td>
      <td>${n.sex==='F'?'♀ F':n.sex==='M'?'♂ M':'?'}</td>
      <td>${esc(n.bloodline||'—')}</td><td class="mutation-bonus">${mutationBonusText(n)}</td>
      ${statCells}
      <td>${n.qualityScore==null?'—':qualityText(n.qualityScore,nodeSpeciesKey(n))}</td><td>${n.total7??'—'}</td><td>${n.level??'—'}</td>
      <td><span class="status-chip ${presenceClass(n)}">${presenceLabel(n)}</span></td>
      <td><select data-field="breedingActive" data-key="${esc(boardKey(n))}" data-id="${esc(n.id)}" ${n.breedingInactiveReason?`disabled title="${esc(n.breedingInactiveReason)}"`:''}><option value="true" ${n.breedingActive?'selected':''}>Active</option><option value="false" ${!n.breedingActive?'selected':''}>Inactive</option></select></td>
      <td><select data-field="role" data-key="${esc(boardKey(n))}">${roleOptionsHtml(n.role)}</select></td>`;
    tr.tabIndex=0;tr.dataset.petId=n.id;
    const inspect=e=>{if(e.target.closest('input,select,textarea,button,a'))return;selectPet(n.id)};
    tr.addEventListener('click',inspect);
    tr.addEventListener('keydown',e=>{if(e.target===tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectPet(n.id)}});
    tbody.appendChild(tr);
  }
  breedingTable.querySelectorAll('[data-sort]').forEach(th=>th.addEventListener('click',()=>{
    const k=th.dataset.sort;
    if(boardSort.key===k)boardSort.dir*=-1; else boardSort={key:k,dir:(['name','nickname','sex','bloodline','role'].includes(k)?1:-1)};
    renderBreedingTable();
  }));
  const saveField=el=>{
    const all=loadBoardEdits(), key=el.dataset.key, field=el.dataset.field;
    const value=field==='breedingActive'?el.value==='true':el.value;
    all[key]=all[key]||{}; all[key][field]=value; saveBoardEdits(all); applyBoardEdits();
    if(field==='breedingActive'){updateCategoryNavigation();renderBreedingTable()}
  };
  breedingTable.querySelectorAll('input[data-field]').forEach(el=>el.addEventListener('input',()=>saveField(el)));
  breedingTable.querySelectorAll('select[data-field]').forEach(el=>el.addEventListener('change',()=>saveField(el)));
  renderManuallyInactive();
  breedingTable.querySelectorAll('.open-node').forEach(b=>b.addEventListener('click',()=>{
    selectPet(b.dataset.id);
  }));
}

function promptAddRole(){
  const value=prompt('New role name — 30 characters maximum (for example: Carrier, Breeder, Resource):','');
  const role=String(value||'').trim();
  if(!role)return;
  if([...role].length>30){
    alert('Role names are limited to 30 characters, including spaces.');
    return;
  }
  const existing=allRoles().find(item=>item.toLocaleLowerCase()===role.toLocaleLowerCase());
  if(!existing){
    preferences.customRoles=[...(Array.isArray(preferences.customRoles)?preferences.customRoles:[]),role];
    savePreferences();
  }
  render(); refreshSelectedDetail();
}

const LOCAL_POLL_MS=5000;
const EXPECTED_GENETICS=['V','F','P','R','T','A','I'];
let lastLocalStateSignature=null;
let refreshInFlight=false;
let currentPayload=null;
let userDataDirty=false;
let breedingPanel={female_bt_id:null,male_bt_id:null};
let breedingPanelDirty=false;
const importBadge=document.getElementById('importBadge');
const saveChoicesBtn=document.getElementById('saveChoicesBtn');
const refreshBtn=document.getElementById('refreshBtn');
const disconnectBtn=document.getElementById('disconnectBtn');

function encodedAnnotations(){
  const encoded={};
  const previous=currentPayload?.user_data?.graph?.annotations;
  for(const [key,e] of Object.entries(loadBoardEdits())){
    if(!e||typeof e!=='object')continue;
    const prior=previous?.[key]&&typeof previous[key]==='object'&&!Array.isArray(previous[key])?previous[key]:{};
    encoded[key]={...prior,
      breeding_status:e.breedingActive===false?'Inactive':'Active',
      breeding_role:typeof e.role==='string'?e.role:'',
      nickname:typeof e.nickname==='string'?e.nickname:'',
      notes:typeof e.notes==='string'?e.notes:''
    };
  }
  return encoded;
}

function syncGraphUserData(){
  if(!currentPayload)return;
  const root=currentPayload.user_data&&typeof currentPayload.user_data==='object'&&!Array.isArray(currentPayload.user_data)
    ? currentPayload.user_data:{};
  const existing=root.graph&&typeof root.graph==='object'&&!Array.isArray(root.graph)?root.graph:{};
  root.graph={...existing,schema_version:2,preferences:{...existing.preferences,...JSON.parse(JSON.stringify(preferences)),navigation:{...existing.preferences?.navigation,...JSON.parse(JSON.stringify(preferences.navigation))}},annotations:encodedAnnotations()};
  currentPayload.user_data=root;
}

function markUserDataDirty(){
  userDataDirty=true;
  syncGraphUserData();
  if(saveChoicesBtn){saveChoicesBtn.textContent='Save choices *';saveChoicesBtn.classList.add('active')}
}

function hydrateGraphUserData(payload){
  const graph=payload?.user_data?.graph;
  if(!graph||typeof graph!=='object')return;
  if(graph.preferences&&typeof graph.preferences==='object'&&!Array.isArray(graph.preferences)){
    const normalized=normalizePreferences(graph.preferences);
    for(const key of Object.keys(preferences))delete preferences[key];
    Object.assign(preferences,normalized);
  }
  if(graph.annotations&&typeof graph.annotations==='object'&&!Array.isArray(graph.annotations)){
    boardEdits=normalizeBoardEdits(JSON.parse(JSON.stringify(graph.annotations)));
  }
  hideInactive=preferences.hideInactive;
  applyBlockOrder();
  restoreCommonPanels();
}

function stablePetId(value){return typeof value==='string'&&/^W-\d+:P-\d+$/.test(value)?value:null}

function hydrateBreedingPanel(payload){
  const panel=payload?.breeding_panel;
  breedingPanel={
    female_bt_id:stablePetId(panel?.female_bt_id),
    male_bt_id:stablePetId(panel?.male_bt_id),
    ...(panel?.prediction?{prediction:BTData.copy(panel.prediction)}:{})
  };
}

function selectedPetName(uid){
  if(uid===null)return 'Not selected';
  const pet=currentPayload?.pets?.find(item=>hasPetName(item)&&item.stage==='adult'&&stablePetId(item.bt_id)===uid);
  return pet&&canonicalName(pet.name)?canonicalName(pet.name):'[MISSING]';
}

function petByPersistentUid(uid){
  if(uid===null)return null;
  return DATA.nodes.find(pet=>hasPetName(pet)&&stablePetId(pet.bt_id)===uid)||null;
}

function breedingPairStatus(panel=breedingPanel){
  const female=petByPersistentUid(panel.female_bt_id),male=petByPersistentUid(panel.male_bt_id);
  const complete=panel.female_bt_id!==null&&panel.male_bt_id!==null;
  const resolved=!complete||Boolean(female&&male);
  const sameSpecies=!complete||!female||!male||nodeSpeciesKey(female)===nodeSpeciesKey(male);
  const reason=complete&&!resolved?'One selected pet is no longer available.':complete&&!sameSpecies?'Female and male must belong to the same species.':'';
  return {female,male,complete,resolved,sameSpecies,valid:complete&&resolved&&sameSpecies,reason};
}

function breederAssignmentBlockReason(n){
  if(n.stage!=='adult')return 'Only confirmed adults can be assigned';
  const uid=stablePetId(n.bt_id);
  if(uid===null)return 'A persistent non-negative Icarus UID is required';
  if(n.lifecycleState!=='ACTIVE'||n.historical||n.stage!=='adult')return 'Only active adult animals can be selected';
  if(n.sex!=='F'&&n.sex!=='M')return 'A known female or male sex is required';
  const otherUid=breedingPanel[n.sex==='F'?'male_bt_id':'female_bt_id'];
  const other=petByPersistentUid(otherUid);
  if(other&&nodeSpeciesKey(other)!==nodeSpeciesKey(n))return `Current ${n.sex==='F'?'male':'female'} belongs to ${speciesLabel(nodeSpeciesKey(other))}`;
  return '';
}

function pairDisplayContext(){const f=petByPersistentUid(breedingPanel.female_bt_id),m=petByPersistentUid(breedingPanel.male_bt_id);return f&&m?currentPairKey(f,m):JSON.stringify([selectedDataset?.account_id,BTView.world,breedingPanel.female_bt_id,breedingPanel.male_bt_id])}
function pairStatusContext(){return JSON.stringify([selectedDataset?.account_id,BTView.world,breedingPanel.female_bt_id,breedingPanel.male_bt_id,breedingPanelDirty])}
function setPairStatus(message){breedingPairState.textContent=message;breedingPairState.dataset.context=pairStatusContext()}
function renderBreedingPairPanel(){
  const femaleUid=breedingPanel.female_bt_id,maleUid=breedingPanel.male_bt_id;
  const quality=document.getElementById('pair-quality');
  const context=JSON.stringify([selectedDataset?.account_id,BTView.world,...[femaleUid,maleUid].map(uid=>{const n=petByPersistentUid(uid);return [uid,n?.stats,n?.lifecycleState,n?.stage,n?.sex,n?.historical,n&&nodeSpeciesKey(n),n&&individualMutationBonus(n)]}),advisorCharacterBonus()]),same=quality.dataset.context===context;
  if(!same)quality.replaceChildren();
  const f=petByPersistentUid(femaleUid),m=petByPersistentUid(maleUid);
  const pair=f&&m?currentPairResult(f,m):null;
  const p=breedingPanel.prediction;
  const qualityHtml=pair?'<div class="advisor-result"><div class="advisor-rank">Selected pair</div><div class="small">Average Quality</div><div class="advisor-score">'+qualityText(pair.score,nodeSpeciesKey(f))+'</div>'+advisorProbabilityHtml(pair)+'</div>':p&&BTView.document&&BTStores.predictionValid(BTView.document,BTView.world,breedingPanel,preferences)?'<div class="advisor-result"><div class="advisor-rank">Selected pair</div><div class="small">Average Quality</div><div class="advisor-score">'+qualityText(p.expected_quality,nodeSpeciesKey(f))+'</div><div class="small">Probabilities unavailable until recalculation</div></div>':'<div class="pair-empty">Average Quality<br>'+((f&&m)?(currentPairJob?.error||'Calculating predictions…'):'Select both parents')+'</div>';
  updateHtml(quality,qualityHtml);
  quality.dataset.context=context;
  nextFemaleName.textContent=femaleUid===null?'Not selected':selectedPetName(femaleUid);
  nextMaleName.textContent=maleUid===null?'Not selected':selectedPetName(maleUid);
  for(const [side,uid] of [['female',femaleUid],['male',maleUid]]){
    const pet=petByPersistentUid(uid),body=document.getElementById('pair-'+side+'-body');
    if(body)updateHtml(body,pet?advisorParentHtml(pet,side):'<div class="pair-empty">'+(uid?'Selected pet unavailable':'No '+side+' selected')+'</div>');
    body?.querySelectorAll('[data-select-pet]').forEach(card=>{
      card.onclick=()=>selectPet(card.dataset.selectPet);
      card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectPet(card.dataset.selectPet)}};
    });
  }
  if(breedingPairState.dataset.context!==pairStatusContext())setPairStatus(breedingPanelDirty?'Pending — not queued':'');
  const status=breedingPairStatus();
  sendBreedingPairBtn.disabled=!status.valid;
  sendBreedingPairBtn.title=status.reason||(!status.complete?'Select one female and one male.':'Queue the current pair for BreedingTool');
  sendBreedingPairBtn.classList.toggle('active',status.valid&&breedingPanelDirty);
}

function breedingSelectionButtonHtml(n){
  if(n.sex!=='F'&&n.sex!=='M')return '';
  const uid=stablePetId(n.bt_id);
  const side=n.sex==='F'?'female':'male';
  const selected=uid!==null&&breedingPanel[`${side}_bt_id`]===uid;
  const disabledReason=breederAssignmentBlockReason(n);
  const inactiveTitle=!disabledReason&&!n.breedingActive?'/!\\ warning this animal is inactive; confirmation required':'';
  const blockedIcon=disabledReason?'<span class="breeder-blocked-icon" aria-hidden="true">⊘</span>':'';
  const title=disabledReason||inactiveTitle;
  return `<button class="control breeder-action${disabledReason?'':' primary-control'}" id="setBreedingSelectionBtn"${disabledReason?' disabled':''}${title?` title="${esc(title)}"`:''}>${blockedIcon}${selected?`Selected as next ${side}`:`Set as next ${side}`}</button>`;
}

function setBreedingSelection(n){
  const uid=stablePetId(n.bt_id);
  if(breederAssignmentBlockReason(n))return;
  let activated=false;
  if(!n.breedingActive){
    const confirmed=confirm(`/!\\ Warning: this animal is inactive.\n\nAdd ${displayName(n)} as next breeder anyway?`);
    if(!confirmed)return;
    const edits=loadBoardEdits(),key=boardKey(n);
    edits[key]=edits[key]||{};
    edits[key].breedingActive=true;
    saveBoardEdits(edits);
    applyBoardEdits();
    markUserDataDirty();
    activated=true;
  }
  breedingPanel[n.sex==='F'?'female_bt_id':'male_bt_id']=uid;
  delete breedingPanel.prediction;
  breedingPanelDirty=true;
  renderBreedingPairPanel();
  if(activated){updateCategoryNavigation();render()}
  else if(activeView.kind==='advisor')renderAdvisor();else renderBreedingPairPanel();
  renderSelectedDetail(n.id);
}
let selectedDataset=null;
let availableDatasets=[];
const accountSelect=document.getElementById('accountSelect');
const draftKey=(world,account=BTView.document?.account?.steam_id)=>`${account}:${world}`;
const DIRECTORY_DB='breeding-tool-local-source';
const DIRECTORY_STORE='handles';
const DIRECTORY_PICKER_ID='breeding-tool-json-folder';
let localDirectoryHandle=null;

function rebuildIndex(){byId=new Map(DATA.nodes.map(n=>[n.id,n]));}

function rebuildRelationshipIndexes(){
  ({childrenByParentId,siblingsById}=buildRelationshipIndexes(DATA.nodes));
}

function rebuildNavigationCatalog(){
  navigationCatalog=buildNavigationCatalog(DATA.nodes.filter(hasPetName),childrenByParentId);
}

function displayName(n){
  if(!n)return '—';
  return n.nickname?`${n.name} (${n.nickname})`:n.name;
}

function canonicalName(value){
  return String(value||'').replace(/W-?\d+:P-?\d+/g,'').replace(/^Pet\s*$/,'Unnamed').trim();
}

function numericUid(value){return stablePetId(value)}

function petId(uid){return uid}

function applyCensus(document){
  validateCensus(document);
  const accountChanged=BTView.document?.account?.steam_id!==document.account.steam_id;
  if(accountChanged){
    stashWorldDraft(); BTView.world=null; BTView.pinnedWorld=null;
    userDataDirty=false; breedingPanelDirty=false;
  }
  const nextWorld=BTView.pinnedWorld&&document.worlds[BTView.pinnedWorld]?BTView.pinnedWorld:document.active_world;
  const entering=accountChanged||BTView.world!==nextWorld;
  if(entering){
    if(!accountChanged)stashWorldDraft();
    userDataDirty=false; breedingPanelDirty=false;
    selected=null; currentSpecies=''; activeView={kind:'species',key:null};
    Object.assign(advisorState,{chosenPairKey:null});
    BTView.world=nextWorld;
  }
  BTView.document=document;
  let payload=BTData.project(document,nextWorld);
  if(entering){
    const navigation=payload.user_data.graph.navigation;
    if(navigation){currentSpecies=navigation.species||'';activeView=navigation.view||{kind:'species',key:null};selected=navigation.selected||null}
    Object.assign(advisorState,restoredAdvisorState(payload.user_data.graph.advisor));
  }
  selected=BTData.resolve(document.worlds[nextWorld],selected);
  const draft=BTView.drafts.get(draftKey(nextWorld));
  if(draft&&!userDataDirty&&!breedingPanelDirty){
    hydrateGraphUserData(draft.payload); hydrateBreedingPanel(draft.payload);
    userDataDirty=draft.dirty; breedingPanelDirty=draft.pairDirty;
    selected=draft.selected; currentSpecies=draft.species; activeView=draft.view;
    Object.assign(advisorState,restoredAdvisorState(draft.advisor));
    BTView.base=draft.base; BTView.pairBase=draft.pairBase;
    BTView.drafts.delete(draftKey(nextWorld));
  }
  if(!userDataDirty)BTView.base=BTData.copy(document.user_data.worlds[nextWorld]?.graph||{});
  if(!breedingPanelDirty)BTView.pairBase=BTData.copy(document.user_data.worlds[nextWorld]?.current_pair||{});
  updateWorldControls();
  connectEmpty.hidden=true;

  if(!userDataDirty)hydrateGraphUserData(payload);
  if(!breedingPanelDirty)hydrateBreedingPanel(payload);
  currentPayload=payload;
  globalThis.Experimenter?.refresh();
  if(userDataDirty)syncGraphUserData();

  const validPets=payload.pets.filter(p=>p.lifecycle_state!=='TRACKED'&&stablePetId(p.bt_id));
  const nodes=[];
  const importedByUid=new Map();
  const importedByPet=new Map();
  
  // PASS 1: rebuild one stable node per UID. No save-specific data is embedded.
  for(const [sourceIndex,p] of validPets.entries()){
    const uid=numericUid(p.bt_id);
    const species=normalizeSpeciesKey(p.species_key||p.actor_class);
    const stats=p.genetics.map(value=>value===null?null:Number(value));
    const historical=p.historical===true;
    const isPresent=p.lifecycle_state==='ACTIVE';
    const n={
      id:petId(uid),
      bt_id:uid,runtime_uid:p.runtime_uid,uid_history:p.uid_history,stage:p.stage,lifecycleState:p.lifecycle_state,deathStatus:p.death?.status,
      twinSource:p.twin_source??null,motherLabel:p.mother||'',fatherLabel:p.father||'',
      icarusName:p.name,
      name:canonicalName(p.name)||'Unnamed',
      fierce_mutation_bonus_pct:p.fierce_mutation_bonus_pct,
      actor_class:p.actor_class||'',
      species_key:species,
      sex:p.sex==='Female'?'F':p.sex==='Male'?'M':'?',
      bloodline:p.lineage||'Unknown',
      mountable:typeof p.mountable==='boolean'?p.mountable:null,
      stats,
      level:p.level!==null&&p.level!==undefined&&Number.isFinite(Number(p.level))?Number(p.level):null,
      experience:p.experience!==null&&p.experience!==undefined&&Number.isFinite(Number(p.experience))?Number(p.experience):null,
      firstSeen:p.first_seen??null,
      isPresent:historical?null:isPresent,
      historical,
      role:'',notes:'',mother:null,father:null
    };
    n.originKind=classifyPetOrigin(p);
    n.total7=n.stats.every(Number.isFinite)?n.stats.reduce((a,b)=>a+b,0):null;
    n.qualityScore=n.total7===null?null:individualQuality(n);
    nodes.push(n);
    importedByPet.set(p,n);
    if(uid!==null)importedByUid.set(uid,n);


  }

  DATA.nodes=nodes;
  rebuildIndex();

  // Deterministic BT_ID links only; parent labels remain historical metadata.
  for(const p of validPets){
    const species=normalizeSpeciesKey(p.species_key||p.actor_class);
    const n=importedByPet.get(p);
    if(!n)continue;
    const motherUid=numericUid(p.mother_bt_id);
    const fatherUid=numericUid(p.father_bt_id);
    const mom=motherUid!==null?importedByUid.get(motherUid):null;
    const dad=fatherUid!==null?importedByUid.get(fatherUid):null;
    n.mother=mom?.id||null;
    n.father=dad?.id||null;
  }

  const speciesCount=new Set(validPets.map(p=>normalizeSpeciesKey(p.species_key||p.actor_class))).size;
  importBadge.textContent=`JSON: ${validPets.length} pets · ${speciesCount} species · ${new Date().toLocaleDateString('en-GB')}`;
  rebuildIndex();rebuildRelationshipIndexes();applyBoardEdits();rebuildNavigationCatalog();
  if(!speciesKeys().includes(currentSpecies))currentSpecies=defaultSpeciesKey();
  updateCategoryNavigation();render();renderBreedingPairPanel();
  saveChoicesBtn.textContent=userDataDirty?'Save choices *':'Save choices';saveChoicesBtn.classList.toggle('active',userDataDirty);
}

function openDirectoryDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window))return resolve(null);
    const request=indexedDB.open(DIRECTORY_DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(DIRECTORY_STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

async function loadSavedDirectory(){
  if(localDirectoryHandle)return localDirectoryHandle;
  const db=await openDirectoryDb();
  if(!db)return null;
  localDirectoryHandle=await new Promise((resolve,reject)=>{
    const request=db.transaction(DIRECTORY_STORE).objectStore(DIRECTORY_STORE).get('json-folder');
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error);
  });
  db.close();
  return localDirectoryHandle;
}

async function saveDirectory(handle){
  const db=await openDirectoryDb();
  if(!db)return;
  await new Promise((resolve,reject)=>{
    const request=db.transaction(DIRECTORY_STORE,'readwrite').objectStore(DIRECTORY_STORE).put(handle,'json-folder');
    request.onsuccess=()=>resolve();
    request.onerror=()=>reject(request.error);
  });
  db.close();
}

async function forgetDirectory(){
  localDirectoryHandle=null;
  const db=await openDirectoryDb();
  if(!db)return;
  await new Promise((resolve,reject)=>{
    const request=db.transaction(DIRECTORY_STORE,'readwrite').objectStore(DIRECTORY_STORE).delete('json-folder');
    request.onsuccess=()=>resolve();
    request.onerror=()=>reject(request.error);
  });
  db.close();
}

function bounded(promise,timeoutMs,message){
  return Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),timeoutMs))
  ]);
}

function updateConnectionControls(){
  refreshBtn.textContent=localDirectoryHandle?'Refresh':'Connect folder';
  disconnectBtn.hidden=!localDirectoryHandle;
}

async function rememberDirectory(handle){
  try{
    await saveDirectory(handle);
  }catch(err){
    console.warn('Could not persist local folder handle:',err);
  }
}

async function readDirectoryJson(handle,requestPermission=false,mode='read'){
  if(!handle)return null;
  let permission=await handle.queryPermission({mode});
  if(permission!=='granted' && requestPermission)permission=await handle.requestPermission({mode});
  if(permission!=='granted')return null;
  if(!selectedDataset)return null;
  return JSON.stringify(await BTData.load(handle,selectedDataset));
}
async function readDirectoryCommand(handle){
  if(!handle)return null;
  try{
    const entry=await handle.getFileHandle('BreedingTool.command.json');
    return (await entry.getFile()).text();
  }catch(err){
    if(err?.name==='NotFoundError')return null;
    throw err;
  }
}

const BTView={document:null,world:null,pinnedWorld:null,base:null,pairBase:null,drafts:new Map(),saving:false};
const detailDrafts=new Map();
function validateCensus(payload){BTData.validate(payload)}
function stashWorldDraft(){
  if(!currentPayload||!BTView.world)return;
  if(userDataDirty)syncGraphUserData();
  const payload=BTData.copy(currentPayload);payload.breeding_panel=BTData.copy(breedingPanel);
  BTView.drafts.set(draftKey(BTView.world),{payload,base:BTData.copy(BTView.base),pairBase:BTData.copy(BTView.pairBase),
    dirty:userDataDirty,pairDirty:breedingPanelDirty,selected,species:currentSpecies,view:BTData.copy(activeView),advisor:BTData.copy(advisorState)});
}
function updateCharacterControl(){
  const d=BTView.document,character=d?.extensions?.active_character;
  const reliable=character&&BTView.world===d.active_world
    &&selectedDataset?.account_id===d.account.steam_id;
  const name=reliable&&typeof character.name==='string'&&character.name.trim()&&character.name.trim()!=='None'?character.name:'—';
  const bonus=reliable&&name!=='—'&&typeof character.mutation_bonus_pct==='number'&&Number.isFinite(character.mutation_bonus_pct)
    ?'+'+character.mutation_bonus_pct+'%':'—';
  const lineage=reliable&&Number.isFinite(character.lineage_mutation_chance_pct)?'+'+character.lineage_mutation_chance_pct+'%':'—';
  document.getElementById('characterState').textContent=name+' · '+bonus+' Genetics · '+lineage+' Lineage';
}
function updateWorldControls(){
  updateCharacterControl();
  const d=BTView.document,select=document.getElementById('worldSelect');
  const chosen=BTView.pinnedWorld||'';
  select.replaceChildren(new Option('Active world',''));
  for(const [key,w] of Object.entries(d.worlds))select.add(new Option(w.metadata.prospect_id||key,key));
  select.value=chosen;
  const w=d.worlds[BTView.world];
  document.getElementById('worldState').textContent=w?`${w.metadata.prospect_id}`:'Waiting for a world';
}
document.getElementById('worldSelect').addEventListener('change',event=>{
  BTView.pinnedWorld=event.target.value||null;
  if(BTView.document)applyCensus(BTView.document);
});
document.getElementById('reloadChoicesBtn').addEventListener('click',()=>{
  if(BTView.saving)return;
  if((userDataDirty||breedingPanelDirty)&&!confirm('Discard unsaved choices for this world and reload the saved version?'))return;
  BTView.drafts.delete(draftKey(BTView.world));userDataDirty=false;breedingPanelDirty=false;
  for(const id of detailDrafts.keys())if(id.startsWith(draftKey(BTView.world)+':'))detailDrafts.delete(id);
  if(BTView.document)applyCensus(BTView.document);
  refreshJson(true);
});
async function sendBreedingPanel(){
  if(BTView.saving)throw new Error('A save is already in progress');
  if(!breedingPairStatus().valid)throw new Error(breedingPairStatus().reason);
  const dataset=selectedDataset;
  if(!dataset||dataset.account_id!==BTView.document?.account?.steam_id)throw new Error('Select an account dataset first');
  const world=BTView.world,submitted=BTData.copy(breedingPanel);
  if(submitted.prediction&&!BTStores.predictionValid(BTView.document,world,submitted,preferences)){delete submitted.prediction;delete breedingPanel.prediction}
  const additional=submitted.prediction?[{path:['worlds',world,'graph','preferences','advisorGoals'],value:BTData.copy(preferences.advisorGoals)}]:[];
  BTView.saving=true;
  try{
    const result=await BTData.submit(localDirectoryHandle,dataset,world,submitted,['worlds',world,'current_pair'],message=>setPairStatus(message),additional);
    if(dataset.account_id===BTView.document?.account?.steam_id&&world===BTView.world){
      breedingPanelDirty=!BTData.same(breedingPanel,submitted);
      BTView.pairBase=submitted;
    }else{
      const draft=BTView.drafts.get(draftKey(world,dataset.account_id));
      if(draft){draft.pairDirty=!BTData.same(draft.payload.breeding_panel,submitted);draft.pairBase=submitted}
    }
    setPairStatus(result?.queued?'Pair queued ✓ — use Refresh in game to apply':'Pair already current ✓');
    return result;
  }finally{BTView.saving=false}
}
async function saveChoices(){
  if(BTView.saving)throw new Error('A save is already in progress');
  if(!currentPayload||!BTView.world)throw new Error('Wait for a world first');
  syncGraphUserData();
  const dataset=selectedDataset;
  if(!dataset||dataset.account_id!==BTView.document?.account?.steam_id)throw new Error('Select an account dataset first');
  const world=BTView.world,submitted=BTData.copy(currentPayload.user_data.graph);
  submitted.navigation={species:currentSpecies,view:BTData.copy(activeView),selected};
  submitted.advisor=BTData.copy(advisorState);
  BTView.saving=true;saveChoicesBtn.disabled=true;
  try{
    const result=await BTData.submit(localDirectoryHandle,dataset,world,submitted,['worlds',world,'graph'],message=>importBadge.textContent=message);
    if(dataset.account_id===BTView.document?.account?.steam_id&&world===BTView.world){
      syncGraphUserData();
      const now=BTData.copy(currentPayload.user_data.graph);
      now.navigation=submitted.navigation;now.advisor=submitted.advisor;
      userDataDirty=!BTData.same(now,submitted);
      BTView.base=submitted;
    }else{
      const draft=BTView.drafts.get(draftKey(world,dataset.account_id));
      if(draft){
        const now=BTData.copy(draft.payload.user_data.graph);now.navigation=submitted.navigation;now.advisor=submitted.advisor;
        draft.dirty=!BTData.same(now,submitted);draft.base=submitted;
      }
    }
    saveChoicesBtn.textContent=userDataDirty?'Save choices *':'Save choices';
    saveChoicesBtn.classList.toggle('active',userDataDirty);
    importBadge.textContent=result?.queued?'Changes queued ✓ — use Refresh in game to apply':'Choices already current ✓';
    return result;
  }finally{BTView.saving=false;saveChoicesBtn.disabled=false}
}

async function pickJsonFile(){
  const input=document.getElementById('jsonFileFallback');
  return new Promise(resolve=>{
    input.value='';
    input.onchange=async()=>resolve(input.files?.[0]?await input.files[0].text():null);
    input.click();
  });
}

async function applyJsonText(text,source,force,commandText=null){
  const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const signature=`${text}\u0000${commandText||''}`;
  if(signature!==lastLocalStateSignature || force){
    const persisted=JSON.parse(text);
    if(selectedDataset&&persisted.account?.steam_id!==selectedDataset.account_id)throw new Error('Dataset account changed');
    let command=null,payload=persisted;
    if(commandText){
      try{command=JSON.parse(commandText);if(command.account_id!==persisted.account.steam_id)command=null;payload=BTData.overlayPending(persisted,command)}catch{}
    }
    applyCensus(payload);
    lastLocalStateSignature=signature;
    const count=Object.values(payload.worlds?.[BTView.world]?.pets||{}).filter(p=>p.stage==='adult').length;
    const ops=command?.payload?.world===BTView.world&&Array.isArray(command?.payload?.ops)?command.payload.ops:[];
    const pairQueued=ops.some(op=>op?.path?.[0]==='worlds'&&op.path[1]===BTView.world&&op.path[2]==='current_pair');
    if(ops.length){
      importBadge.textContent='Changes queued ✓ — use Refresh in game to apply';
      if(pairQueued){
        setPairStatus('Pair queued ✓ — use Refresh in game to apply');
        const advisorStateNode=document.getElementById('advisorSendState');
        if(advisorStateNode)advisorStateNode.textContent='Queued ✓ — use Refresh in game to apply';
      }
    }else{
      importBadge.textContent=`JSON ${source}: ${count} pets · ${force?'refreshed':'synced'} ${now}`;
    }
  }else if(commandText && JSON.parse(commandText)?.account_id===BTView.document?.account?.steam_id){
    importBadge.textContent='Changes queued ✓ — use Refresh in game to apply';
  }else{
    importBadge.textContent=`JSON ${source}: up to date · ${now}`;
  }
}

async function connectDirectory(){
  if(refreshInFlight||BTView.saving)return;
  refreshInFlight=true;
  importBadge.textContent='JSON: selecting folder…';
  try{
    if('showDirectoryPicker' in window){
      const chosen=await window.showDirectoryPicker({id:DIRECTORY_PICKER_ID,mode:'readwrite'});
      if(await chosen.requestPermission({mode:'readwrite'})!=='granted')throw new Error('Folder permission required');
      const datasets=await BTData.discover(chosen);
      if(!datasets.length)throw new Error('No valid account datasets found');
      stashWorldDraft();
      localDirectoryHandle=chosen; availableDatasets=datasets;
      selectedDataset=datasets.length===1?datasets[0]:null;
      updateAccountControls();
      updateConnectionControls(); void rememberDirectory(chosen);
      if(!selectedDataset){importBadge.textContent='Select an account';return}
      const text=await readDirectoryJson(chosen,true,'readwrite');
      if(!text)throw new Error('Folder access was not granted');
      const commandText=await readDirectoryCommand(chosen);
      await applyJsonText(text,'local',true,commandText);
      localDirectoryHandle=chosen;
      updateConnectionControls();
      void rememberDirectory(chosen);
    }else{
      const text=await pickJsonFile();
      if(!text)throw new DOMException('Selection cancelled','AbortError');
      const logical=BTData.snapshot(text);
      selectedDataset=null;localDirectoryHandle=null;availableDatasets=[];updateAccountControls();
      await applyJsonText(JSON.stringify(logical),'coherent snapshot',true);
    }
  }catch(err){
    if(err?.name==='AbortError'){
      importBadge.textContent=localDirectoryHandle?'JSON: current folder unchanged':'JSON: not connected';
    }else{
      importBadge.textContent=`JSON: invalid folder (${err.message})`;
      console.warn('BreedingTool folder rejected:',err);
    }
  }finally{
    refreshInFlight=false;
  }
}

async function refreshJson(force=false){
  if(refreshInFlight||BTView.saving)return;
  refreshInFlight=true;
  if(force)importBadge.textContent='JSON: refreshing…';
  try{
    let handle=localDirectoryHandle;
    if(!handle)handle=await bounded(loadSavedDirectory(),2000,'Saved folder lookup timed out');
    if(!handle){
      importBadge.textContent='JSON: not connected';
      return;
    }
    if(await handle.queryPermission({mode:'read'})!=='granted'){
      if(!force||await handle.requestPermission({mode:'readwrite'})!=='granted'){importBadge.textContent='JSON: folder permission required';return}
    }
    if(!localDirectoryHandle||force){
      availableDatasets=await BTData.discover(handle);
      selectedDataset=availableDatasets.find(d=>d.account_id===selectedDataset?.account_id&&d.filename===selectedDataset?.filename)||(availableDatasets.length===1?availableDatasets[0]:null);
      localDirectoryHandle=handle;updateAccountControls();updateConnectionControls();
    }
    if(!selectedDataset){importBadge.textContent=availableDatasets.length?'Select an account':'No valid account datasets found';return}
    if(BTView.saving)return;
    const text=await readDirectoryJson(handle,force,force?'readwrite':'read');
    if(!text){
      importBadge.textContent='JSON: folder permission required';
      return;
    }
    const commandText=await readDirectoryCommand(handle);
    await applyJsonText(text,'local',force,commandText);
    localDirectoryHandle=handle;
    updateConnectionControls();
  }catch(err){
    updateConnectionControls();
    importBadge.textContent=`JSON: unavailable (${err.message})`;
    console.warn('the account dataset unavailable:',err);
  }finally{
    refreshInFlight=false;
  }
}

async function disconnectDirectory(){
  try{
    await bounded(forgetDirectory(),2000,'Folder removal timed out');
  }catch(err){
    localDirectoryHandle=null;
    console.warn('Could not remove the saved folder handle:',err);
  }
  localDirectoryHandle=null;selectedDataset=null;availableDatasets=[];updateAccountControls();
  updateConnectionControls();
  importBadge.textContent=currentPayload?'JSON: disconnected · snapshot retained':'JSON: not connected';
}

function updateAccountControls(){
  accountSelect.replaceChildren(new Option('Select account',''));
  for(const d of availableDatasets)accountSelect.add(new Option(d.label,d.filename));
  accountSelect.value=selectedDataset?.filename||'';
  updateCharacterControl();
}
accountSelect.addEventListener('change',async()=>{
  if(refreshInFlight||BTView.saving){updateAccountControls();return}
  selectedDataset=availableDatasets.find(d=>d.filename===accountSelect.value)||null;
  updateCharacterControl();
  lastLocalStateSignature=null;
  await refreshJson();
});
document.getElementById('cancelCommandBtn').addEventListener('click',async()=>{
  if(refreshInFlight||BTView.saving||!localDirectoryHandle||!selectedDataset)return;
  if(!confirm('Cancel the pending command for this account? Unsaved drafts are retained.'))return;
  try{await BTData.cancelPending(localDirectoryHandle,selectedDataset);await refreshJson(true)}
  catch(e){importBadge.textContent=e.message}
});
refreshBtn.addEventListener('click',()=>localDirectoryHandle?refreshJson(true):connectDirectory());
disconnectBtn.addEventListener('click',disconnectDirectory);
saveChoicesBtn.addEventListener('click',()=>saveChoices().catch(err=>{
  if(err?.name!=='AbortError'){
    importBadge.textContent=`Choices not queued (${err.message})`;
    console.warn('BreedingTool choices not queued:',err);
  }
}));
refreshJson();
updateConnectionControls();
setInterval(()=>refreshJson(false),LOCAL_POLL_MS);

function applyZoom(){
  if(!lastLayout)return;
  tree.style.width=`${Math.max(lastLayout.width*UI_SCALE,wrap.clientWidth)*zoomScale}px`;
  tree.style.height=`${lastLayout.height*UI_SCALE*zoomScale}px`;
  zoomLabel.textContent=`${Math.round(zoomScale*100)}%`;
}

function setZoom(value){
  zoomScale=Math.max(0.35,Math.min(1.8,value));
  applyZoom();
}

function fitTree(dimension='both'){
  if(!lastLayout)return;
  const sx=(wrap.clientWidth-20)/Math.max(1,lastLayout.width*UI_SCALE);
  const sy=(wrap.clientHeight-20)/Math.max(1,lastLayout.height*UI_SCALE);
  const scale=dimension==='width'?sx:dimension==='height'?sy:Math.min(sx,sy);
  setZoom(Math.min(1,scale));
  const left=dimension==='height'?Math.max(0,(tree.scrollWidth-wrap.clientWidth)/2):0;
  const top=dimension==='width'?Math.max(0,(tree.scrollHeight-wrap.clientHeight)/2):0;
  wrap.scrollTo({left,top,behavior:'smooth'});
}

document.getElementById('zoomOutBtn').addEventListener('click',()=>setZoom(zoomScale-0.1));
document.getElementById('zoomInBtn').addEventListener('click',()=>setZoom(zoomScale+0.1));
zoomLabel.addEventListener('click',()=>setZoom(1));
document.getElementById('fitBtn').addEventListener('click',()=>fitTree());
document.getElementById('fitWidthBtn').addEventListener('click',()=>fitTree('width'));
document.getElementById('fitHeightBtn').addEventListener('click',()=>fitTree('height'));

let panState=null;
let suppressPanClick=false;
wrap.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  panState={id:e.pointerId,x:e.clientX,y:e.clientY,left:wrap.scrollLeft,top:wrap.scrollTop,moved:false};
});
wrap.addEventListener('pointermove',e=>{
  if(!panState||panState.id!==e.pointerId)return;
  const dx=e.clientX-panState.x,dy=e.clientY-panState.y;
  if(!panState.moved&&Math.hypot(dx,dy)<5)return;
  if(!panState.moved){
    panState.moved=true;
    wrap.setPointerCapture(e.pointerId);
  }
  wrap.classList.add('is-panning');
  wrap.scrollLeft=panState.left-dx;
  wrap.scrollTop=panState.top-dy;
  hideTooltip();
  e.preventDefault();
});
function stopCanvasPan(e){
  if(!panState||panState.id!==e.pointerId)return;
  const moved=panState.moved;
  panState=null;
  wrap.classList.remove('is-panning');
  if(wrap.hasPointerCapture(e.pointerId))wrap.releasePointerCapture(e.pointerId);
  if(moved){suppressPanClick=true;setTimeout(()=>{suppressPanClick=false},0)}
}
wrap.addEventListener('pointerup',stopCanvasPan);
wrap.addEventListener('pointercancel',stopCanvasPan);
wrap.addEventListener('lostpointercapture',stopCanvasPan);
wrap.addEventListener('click',e=>{
  if(!suppressPanClick)return;
  e.preventDefault();
  e.stopPropagation();
},{capture:true});
wrap.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();setZoom(zoomScale+(e.deltaY<0?0.1:-0.1));},{passive:false});
wrap.addEventListener('mouseleave',hideTooltip);
wrap.addEventListener('scroll',hideTooltip,{passive:true});
window.addEventListener('blur',hideTooltip);
document.addEventListener('visibilitychange',()=>{if(document.hidden)hideTooltip()});
document.getElementById('clearBtn').addEventListener('click',()=>{selected=null;selectedPetSummary.textContent='No pet selected';detail.innerHTML='<div class="detail-placeholder">Select a pet to inspect and annotate it. Hover a card for a quick summary.</div>';render()});
document.getElementById('clearBreedingPairBtn').addEventListener('click',()=>{
  breedingPanel={female_bt_id:null,male_bt_id:null};
  breedingPanelDirty=true;
  renderBreedingPairPanel();
  refreshSelectedDetail();
});
sendBreedingPairBtn.addEventListener('click',async()=>{
  try{
    sendBreedingPairBtn.disabled=true;
    setPairStatus('Queuing pair…');
    const f=petByPersistentUid(breedingPanel.female_bt_id),m=petByPersistentUid(breedingPanel.male_bt_id),available=f&&m?currentPairResult(f,m):null;
    if(available)breedingPanel.prediction=advisorPairPrediction(available);
    await sendBreedingPanel();
  }catch(err){
    setPairStatus(`Not queued: ${err.message||String(err)}`);
  }finally{
    sendBreedingPairBtn.disabled=!breedingPairStatus().valid;
  }
});
function clearGlobalSearch(){
  if(!search.value)return;
  search.value='';render();refreshSelectedDetail();search.focus();
}
search.addEventListener('input',()=>{render();refreshSelectedDetail()});
search.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();clearGlobalSearch()}});
searchClearBtn.addEventListener('click',clearGlobalSearch);
window.addEventListener('resize',()=>render());
initializeBlockOrdering();initializeStaticCollapsibles();applyBoardEdits();updateCategoryNavigation();render();renderBreedingPairPanel();

function inspectUidElement(event){
 const target=event.target.closest('[data-inspect-uid]');if(!target)return;
 if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
 const pet=petByPersistentUid(target.dataset.inspectUid);if(!pet)return;
 if(!target.matches('summary'))event.preventDefault();event.stopPropagation();selectPet(pet.id,{rerender:false});
}
document.addEventListener('click',inspectUidElement,true);
document.addEventListener('keydown',inspectUidElement,true);
document.addEventListener('change',event=>{
 if(!['experimentFemale','experimentMale','experimentExcludePet'].includes(event.target.id))return;
 const pet=petByPersistentUid(event.target.value);if(pet)selectPet(pet.id,{rerender:false});
});

document.getElementById('recommendPairBtn').addEventListener('click',async()=>{
 const before=JSON.stringify([breedingPanel,breedingPanelDirty]);let scope=advisorPairs();
 if(scope.pending){const job=advisorPredictionJob;if(!job?.promise)return;switchToolView('advisor');await job.promise;if(advisorPredictionJob!==job||JSON.stringify([breedingPanel,breedingPanelDirty])!==before)return;scope=advisorPairs()}
 if(scope.pending||!scope.pairs.length)return;
 const best=scope.pairs[0];breedingPanel={female_bt_id:best.female.bt_id,male_bt_id:best.male.bt_id,prediction:advisorPairPrediction(best)};breedingPanelDirty=true;advisorState.chosenPairKey=best.key;
 if(activeView.kind==='advisor')renderAdvisor();renderBreedingPairPanel();refreshSelectedDetail();
});
