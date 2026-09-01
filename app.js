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
  const hasParentUid=[pet?.mother_uid,pet?.father_uid]
    .some(value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value)));
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
    const hasStableUid=node.icarus_uid!==null&&node.icarus_uid!==undefined&&node.icarus_uid!==''&&Number.isFinite(Number(node.icarus_uid));
    if(node.originKind!=='foundation'||!hasStableUid)continue;
    const speciesKey=node.species_key||'Unknown';
    const branch=descendantIdsFrom(node.id,childrenByParentId,childId=>{
      const child=nodeById.get(childId);
      return child&&(child.species_key||'Unknown')===speciesKey;
    });
    branch.delete(node.id);
    if(!branch.size)continue;
    if(!foundationsBySpecies.has(speciesKey))foundationsBySpecies.set(speciesKey,new Map());
    foundationsBySpecies.get(speciesKey).set(String(node.icarus_uid),{
      kind:'foundation',key:String(node.icarus_uid),speciesKey,founderId:node.id,
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

// The board contains no embedded census. Every node is rebuilt from BreedingTool.json.
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
const advisorWrap = document.getElementById('advisorWrap');
const advisorObjectives = document.getElementById('advisorObjectives');
const advisorStatPicker = document.getElementById('advisorStatPicker');
const advisorStatToggles = document.getElementById('advisorStatToggles');
const advisorModelNote = document.getElementById('advisorModelNote');
const advisorRoleRow = document.getElementById('advisorRoleRow');
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
const usefulConfig = document.getElementById('usefulConfig');
const usefulChecks = document.getElementById('usefulChecks');
const usefulConfigTitle = document.getElementById('usefulConfigTitle');
const breedingCountHint = document.getElementById('breedingCountHint');
const nextFemaleName=document.getElementById('nextFemaleName');
const nextMaleName=document.getElementById('nextMaleName');
const breedingPairState=document.getElementById('breedingPairState');
const sendBreedingPairBtn=document.getElementById('sendBreedingPairBtn');
const searchClearBtn=document.getElementById('searchClearBtn');
const selectedPetSummary=document.getElementById('selectedPetSummary');
const visualControls=document.querySelector('.visual-controls');
const siblingLegend=document.getElementById('siblingLegend');
let currentSpecies='',activeView={kind:'species',key:null},selected=null,lastLayout=null,zoomScale=1,hideInactive=true;
const collapsedBlocks=new Map();

function makeCollapsible(element,key,{keep=null,label='block'}={}){
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
    button.textContent=collapsed?'▸':'▾';
    button.title=`${collapsed?'Expand':'Collapse'} ${label}`;
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-expanded',String(!collapsed));
  };
  button.onclick=event=>{event.stopPropagation();collapsedBlocks.set(key,collapsedBlocks.get(key)!==true);sync()};
  sync();
}

function initializeStaticCollapsibles(){
  makeCollapsible(detailShell,'selected-pet',{keep:'.detail-toolbar',label:'Selected pet'});
  makeCollapsible(document.getElementById('advisorStatReference'),'advisor-reference',{keep:'.advisor-stat-reference-head',label:'genotype reference'});
}

function initializeAdvisorCollapsibles(){
  makeCollapsible(advisorStatPicker,'advisor-priority-picker',{keep:'strong',label:'Advisor priority stats'});
  makeCollapsible(advisorContent.querySelector('.advisor-offspring-preview'),'advisor-offspring',{keep:'.advisor-offspring-title',label:'offspring preview'});
  makeCollapsible(advisorContent.querySelector('.advisor-alternatives'),'advisor-candidates',{keep:'.advisor-alternatives-head',label:'Top candidates'});
}

const ADVISOR_OBJECTIVES=[
  {key:'overall',title:'Best overall offspring',help:'Broad parental quality across the species Priority stats.'},
  {key:'selected',title:'Improve selected stats',help:'Focus the provisional ranking on the shared Priority stats.'},
  {key:'bloodline',title:'Preserve / strengthen bloodline',help:'Architecture ready; bloodline weighting comes with the real model.'},
  {key:'inbreeding',title:'Reduce inbreeding',help:'Architecture ready; kinship math is deliberately deferred.'}
];
const advisorState={objective:'overall',chosenPairKey:null,selectedFemaleUid:null,selectedMaleUid:null,referenceStat:0};
const GENOTYPE_REFERENCE=[
  {abbr:'V',name:'Vigor',effect:'Max HP'},
  {abbr:'F',name:'Fitness',effect:'Max Stamina'},
  {abbr:'P',name:'Physique',effect:'Melee Damage + Weight Capacity'},
  {abbr:'R',name:'Reflex',effect:'Movement Speed'},
  {abbr:'T',name:'Toughness',effect:'Physical Resistance'},
  {abbr:'A',name:'Adaptation',effect:'Cold Resistance + Heat Resistance'},
  {abbr:'I',name:'Instinct',effect:'Species utility / Mount Cargo Inventory slots'}
];
const ADVISOR_ROLE_BLOODLINE_PRIORITY={
  mount:['Timid','Stout','Hardy','Alpha','Bold','Resolute','Ambitious','Wild','Careful','Brave','Savage','Unstable'],
  combat:['Alpha','Brave','Hardy','Savage','Wild','Bold','Timid','Stout','Resolute','Ambitious','Careful','Unstable']
};

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function activityClass(n){return n.breedingActive?'active':'culled'}
function activityLabel(n){return n.breedingActive?'Active':'Inactive'}
function roleClass(n){
  const role=String(n.role||'').trim().toLocaleLowerCase();
  return ['reserve','experimental','retired'].includes(role)?` role-${role}`:'';
}
function presenceLabel(n){return n.historical?'Historical':n.isPresent?'Present':'Missing'}
function presenceClass(n){return n.historical?'historical':n.isPresent?'active':'inactive'}
function automaticInactiveReason(n){
  if(n.historical)return 'Historical UID: automatically inactive for breeding';
  if(!n.isPresent)return 'Missing from the latest F7 census: automatically inactive for breeding';
  return '';
}
function sexRank(n){return n.sex==='F'?0:n.sex==='M'?2:1}
function statsText(n){return n.stats ? n.stats.map(value=>value??'—').join(' / ') : '—'}
function offspringOf(id){return (childrenByParentId.get(id)||[]).map(childId=>byId.get(childId)).filter(Boolean)}
function siblingsOf(n){return (siblingsById.get(n.id)||[]).map(id=>byId.get(id)).filter(Boolean)}

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
const DEFAULT_BLOCK_ORDER=['context','current-pair','priority-stats','selected-pet'];
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
    usefulStats:value.usefulStats&&typeof value.usefulStats==='object'?value.usefulStats:{},
    customRoles:Array.isArray(value.customRoles)?value.customRoles:[],
    advisorPurpose:value.advisorPurpose&&typeof value.advisorPurpose==='object'&&!Array.isArray(value.advisorPurpose)
      ? Object.fromEntries(Object.entries(value.advisorPurpose).filter(([,purpose])=>purpose==='combat'))
      : {},
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

function initializeBlockOrdering(){
  let dragged=null;
  customizableBlocks.querySelectorAll('.block-drag-handle').forEach(handle=>{
    handle.addEventListener('dragstart',event=>{
      dragged=handle.closest('[data-block-id]');
      dragged?.classList.add('block-dragging');
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',dragged?.dataset.blockId||'');
    });
    handle.addEventListener('dragend',()=>{
      customizableBlocks.querySelectorAll('.movable-block').forEach(block=>block.classList.remove('block-dragging','block-drop-target'));
      if(dragged)saveCurrentBlockOrder();
      dragged=null;
    });
  });
  customizableBlocks.addEventListener('dragover',event=>{
    if(!dragged)return;
    event.preventDefault();event.dataTransfer.dropEffect='move';
    const candidate=event.target.closest('[data-block-id]');
    const target=candidate?.parentElement===customizableBlocks?candidate:null;
    customizableBlocks.querySelectorAll('.block-drop-target').forEach(block=>block.classList.remove('block-drop-target'));
    if(!target||target===dragged)return;
    target.classList.add('block-drop-target');
    const before=event.clientY<target.getBoundingClientRect().top+target.getBoundingClientRect().height/2;
    customizableBlocks.insertBefore(dragged,before?target:target.nextSibling);
  });
  customizableBlocks.addEventListener('drop',event=>{if(dragged)event.preventDefault()});
  applyBlockOrder();
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

function usefulMask(speciesKey=currentSpecies){
  const mask=preferences.usefulStats?.[speciesKey];
  return Array.isArray(mask)&&mask.length===7&&mask.every(v=>typeof v==='boolean')
    ? mask
    : [...DEFAULT_USEFUL_MASK];
}

function usefulLabel(speciesKey=currentSpecies){return `Priority (${usefulMask(speciesKey).filter(Boolean).length})`}
function scoreSummary(n){return n.total7==null?'Incomplete stats':`Total: ${n.total7} / ${usefulLabel(nodeSpeciesKey(n))}: ${n.usefulScore}`}
function usefulScore(n){
  const mask=usefulMask(nodeSpeciesKey(n));
  return (n.stats||[]).reduce((sum,value,index)=>sum+(mask[index]?Number(value)||0:0),0);
}
function recomputeUsefulScores(speciesKey=currentSpecies){
  for(const n of DATA.nodes)if(nodeSpeciesKey(n)===speciesKey)n.usefulScore=n.total7===null?null:usefulScore(n);
}

function currentSpeciesNodes(){
  return DATA.nodes.filter(n=>nodeSpeciesKey(n)===currentSpecies);
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

function viewNodes(view=activeView,speciesKey=currentSpecies){
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
  return full.filter(n=>ids.has(n.id)&&(!hideInactive||n.breedingActive));
}

function getVisibleNodes(){
  return viewNodes(activeView,currentSpecies);
}

function nodeMatchesSearch(n,query=search.value.trim().toLowerCase()){
  if(!query)return true;
  return [
    n.name,...(n.previousNames||[]),n.nickname,n.bloodline,n.role,n.notes,n.sex,statsText(n),String(n.total7),String(n.usefulScore),String(n.icarus_uid??''),String(n.level??''),String(n.experience??'')
  ].join(' ').toLowerCase().includes(query);
}

function computeGenerations(list){
  return generationMap(list,byId);
}

function layoutNodes(list){
  const gen=computeGenerations(list);
  const groups=new Map();
  for(const n of list){
    const g=gen.get(n.id);
    if(!groups.has(g))groups.set(g,[]);
    groups.get(g).push(n);
  }
  for(const arr of groups.values()){
    arr.sort((a,b)=> {
      const sa=a.breedingActive?0:1, sb=b.breedingActive?0:1;
      return sexRank(a)-sexRank(b) || sa-sb || (b.usefulScore??-1)-(a.usefulScore??-1) || a.name.localeCompare(b.name);
    });
  }
  const gens=[...groups.keys()].sort((a,b)=>a-b);
  const nodeW=176,nodeH=66,gapX=24,gapY=135,margin=34;
  const maxCount=Math.max(1,...[...groups.values()].map(a=>a.length));
  const width=Math.max(wrap.clientWidth-2, margin*2 + maxCount*(nodeW+gapX));
  const height=margin*2 + (Math.max(...gens,0)+1)*(nodeH+gapY);
  const pos=new Map();
  for(const g of gens){
    const arr=groups.get(g);
    const rowW=arr.length*nodeW + Math.max(0,arr.length-1)*gapX;
    let x=(width-rowW)/2;
    const y=margin+g*(nodeH+gapY);
    for(const n of arr){pos.set(n.id,{x,y,w:nodeW,h:nodeH,g});x+=nodeW+gapX}
  }
  return {pos,width,height,ids:new Set(list.map(n=>n.id))};
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

function isSpecialBreedingView(){return activeView.kind==='breeding'||activeView.kind==='advisor'}
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
  if(descriptor.kind==='species')return `${speciesLabel(descriptor.key)} (${descriptor.memberIds.size})`;
  if(descriptor.kind==='bloodline')return `${descriptor.key} (${descriptor.memberIds.size})`;
  return `${displayName(byId.get(descriptor.founderId))} (${descriptor.descendantIds.size})`;
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
  speciesBadge.textContent=currentSpecies?`Species: ${speciesLabel(currentSpecies)}`:'Species: none selected';
  const pop=currentSpeciesNodes();
  const females=pop.filter(n=>n.sex==='F').length,males=pop.filter(n=>n.sex==='M').length;
  const present=pop.filter(n=>n.isPresent===true).length;
  populationBadge.textContent=`Population: ${females} F / ${males} M / ${present} present / ${pop.length} total`;
  updateInactiveToggle();
  updateUsefulConfig();
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
    return `Known descendants of ${displayName(byId.get(descriptor?.founderId))}, identified by founder UID ${activeView.key}.`;
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
  const inactiveCount=currentSpeciesNodes().filter(n=>!n.breedingActive).length;
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

inactiveToggleBtn.addEventListener('click',()=>{
  hideInactive=!hideInactive;
  updateCategoryNavigation();render();refreshSelectedDetail();
});


function updateViewChrome(){
  detailShell.style.display='';
  visualControls.style.display=isSpecialBreedingView()?'none':'';
  siblingLegend.style.display=(activeView.kind==='foundation'||activeView.kind==='family')?'inline':'none';
}

function advisorEligibleBreeders(){
  applyBoardEdits();
  return specialViewScopeNodes().filter(n=>
    (!hideInactive||n.breedingActive) && n.isPresent===true && !n.historical && nodeMatchesSearch(n) &&
    persistentIcarusUid(n.icarus_uid)!==null && (n.sex==='F'||n.sex==='M')
  );
}

function advisorStatMask(){
  return usefulMask(currentSpecies);
}

function advisorParentIndex(n,mask){
  const values=(n.stats||[]).filter((_,index)=>mask[index]).map(Number).filter(Number.isFinite);
  if(!values.length)return 0;
  return values.reduce((sum,value)=>sum+value,0)/(values.length*10)*100;
}

function advisorTwinSignature(n){
  const mother=String(n.mother||'');
  const father=String(n.father||'');
  // Without both stable parent links we cannot safely infer a sibling/twin-equivalent group.
  if(!mother||!father)return null;
  const stats=(n.stats||[]).map(value=>value===null||value===undefined?'?':String(value)).join(',');
  return [nodeSpeciesKey(n),n.sex,mother,father,String(n.bloodline||'Unknown').toLocaleLowerCase(),stats].join('|');
}

function advisorCandidateGroups(breeders,sex){
  const groups=[];
  const bySignature=new Map();
  const sorted=breeders.filter(n=>n.sex===sex).slice().sort((a,b)=>
    (persistentIcarusUid(a.icarus_uid)??Number.MAX_SAFE_INTEGER)-(persistentIcarusUid(b.icarus_uid)??Number.MAX_SAFE_INTEGER));
  for(const pet of sorted){
    const signature=advisorTwinSignature(pet);
    if(!signature){
      groups.push({key:`uid:${persistentIcarusUid(pet.icarus_uid)}`,pets:[pet],representative:pet,equivalent:false});
      continue;
    }
    if(!bySignature.has(signature)){
      const group={key:`eq:${signature}`,pets:[],representative:pet,equivalent:true};
      bySignature.set(signature,group);groups.push(group);
    }
    bySignature.get(signature).pets.push(pet);
  }
  for(const group of groups){
    group.pets.sort((a,b)=>(persistentIcarusUid(a.icarus_uid)??0)-(persistentIcarusUid(b.icarus_uid)??0));
    group.representative=group.pets[0];
    // A single member is not visually presented as a twin/equivalent set.
    if(group.pets.length<2)group.equivalent=false;
  }
  return groups;
}

function advisorPairKey(femaleGroup,maleGroup){
  return `${femaleGroup.key}::${maleGroup.key}`;
}

function advisorSelectedMember(group,sex){
  const key=sex==='female'?'selectedFemaleUid':'selectedMaleUid';
  const selectedUid=persistentIcarusUid(advisorState[key]);
  const member=(group?.pets||[]).find(pet=>persistentIcarusUid(pet.icarus_uid)===selectedUid)
    || group?.representative
    || group?.pets?.[0]
    || null;
  advisorState[key]=member?persistentIcarusUid(member.icarus_uid):null;
  return member;
}

function advisorPairWithSelectedMembers(pair){
  if(!pair)return pair;
  return {
    ...pair,
    female:advisorSelectedMember(pair.femaleGroup,'female'),
    male:advisorSelectedMember(pair.maleGroup,'male')
  };
}

function advisorPairIndex(female,male){
  const mask=advisorStatMask();
  return (advisorParentIndex(female,mask)+advisorParentIndex(male,mask))/2;
}

function advisorPairs(){
  const breeders=advisorEligibleBreeders();
  const femaleGroups=advisorCandidateGroups(breeders,'F');
  const maleGroups=advisorCandidateGroups(breeders,'M');
  const pairs=[];
  for(const femaleGroup of femaleGroups){
    for(const maleGroup of maleGroups){
      const female=femaleGroup.representative,male=maleGroup.representative;
      // Groups inherit the already-filtered species scope, so cross-species pairs cannot enter the engine.
      pairs.push({female,male,femaleGroup,maleGroup,key:advisorPairKey(femaleGroup,maleGroup),score:advisorPairIndex(female,male)});
    }
  }
  pairs.sort((a,b)=>b.score-a.score||displayName(a.female).localeCompare(displayName(b.female))||displayName(a.male).localeCompare(displayName(b.male)));
  return {breeders,femaleGroups,maleGroups,pairs};
}

function advisorObjectiveNote(){
  if(advisorState.objective==='selected')return 'Prototype ranking: mean parental values across the shared Priority stats. This is a comparison index, not an offspring prediction.';
  if(advisorState.objective==='bloodline')return 'Bloodline criterion shell is ready. Until the real inheritance / pedigree model is defined, the list keeps the baseline parental Useful ranking.';
  if(advisorState.objective==='inbreeding')return 'Inbreeding criterion shell is ready. No kinship coefficient is being guessed in this prototype; the list keeps the baseline parental Useful ranking.';
  return 'Prototype overall baseline: mean parental Priority score. It currently shares the same stat priorities as Improve selected stats; the future overall model can add bloodline, kinship and inheritance factors without creating a second stat-selection system.';
}

function advisorStatHtml(n){
  return (n.stats||Array(7).fill(null)).map((value,index)=>`<div class="stat ${statClass(index,value,nodeSpeciesKey(n))}"><label>${STAT_LABELS[index]}</label><b>${value??'—'}</b></div>`).join('');
}

function advisorGroupNamesHtml(group,sex){
  const pets=group?.pets?.length?group.pets:[group?.representative].filter(Boolean);
  if(pets.length<=1)return `<h3>${esc(displayName(pets[0]))}</h3>`;
  return `<div class="advisor-twin-labels">${pets.map(pet=>`<span class="advisor-twin-label ${sex}" title="UID ${esc(pet.icarus_uid)}">${esc(displayName(pet))} (${esc(pet.icarus_uid)})</span>`).join('')}</div><div class="advisor-twin-note">Grouped genetically equivalent siblings · one representative UID is sent to the panel</div>`;
}

function advisorParentHtml(n,sex,group=null){
  const equivalents=Math.max(0,(group?.pets?.length||1)-1);
  return `<div class="advisor-parent ${sex}" data-select-pet="${esc(n.id)}" role="button" tabindex="0">
    <div class="advisor-parent-head">
      <div><h3>${esc(displayName(n))} (${esc(n.icarus_uid)})</h3><div class="small">${esc(n.bloodline||'Unknown')}${equivalents?` · ${equivalents} genetically equivalent sibling${equivalents===1?'':'s'} available`:''} · ${usefulLabel(nodeSpeciesKey(n))}: ${n.usefulScore??'—'}</div></div>
      <span class="sex" style="color:var(--${sex==='female'?'female':'male'})">${sex==='female'?'♀':'♂'}</span>
    </div>
    <div class="stats">${advisorStatHtml(n)}</div>
  </div>`;
}

function advisorMountCapability(speciesKey=currentSpecies){
  const species=normalizeSpeciesKey(speciesKey);
  const values=DATA.nodes
    .filter(n=>nodeSpeciesKey(n)===species && typeof n.mountable==='boolean')
    .map(n=>n.mountable);
  if(values.some(Boolean))return true;
  if(values.length)return false;
  return null;
}

function advisorPurposeState(speciesKey=currentSpecies){
  const species=normalizeSpeciesKey(speciesKey);
  const capability=advisorMountCapability(species);
  const override=preferences.advisorPurpose?.[species]==='combat'?'combat':null;
  if(capability===true)return {capability,override,role:override==='combat'?'combat':'mount'};
  if(capability===false)return {capability,override:null,role:'combat'};
  return {capability:null,override:null,role:'unknown'};
}

function advisorRoleLabel(){
  const role=advisorPurposeState().role;
  return role==='combat'?'Combat Companion':role==='mount'?'Mount':'Purpose unknown';
}

function advisorInstinctEffect(speciesKey=currentSpecies){
  const species=normalizeSpeciesKey(speciesKey);
  if(species==='Cattle')return 'Cows: time between Milk production. Mount cargo behavior will be tied to the runtime mountability signal once exported.';
  if(species==='Chicken')return 'Hens: time between Egg production.';
  if(species==='Sheep')return 'Wool Growth Speed.';
  const capability=advisorMountCapability(species);
  if(capability===true)return 'Mount Cargo Inventory slots.';
  if(capability===false)return `No mount-specific Instinct effect is selected because the runtime census marks ${speciesLabel(species)} as non-mountable.`;
  return `Mount capability is not exported yet for ${speciesLabel(species)}; no species list is guessed.`;
}

function advisorRoleContext(index){
  const role=advisorPurposeState().role;
  const mount=[
    'More health improves travel survivability and tolerance for incidental combat.',
    'More stamina supports sustained travel and sprinting.',
    'Adds carrying capacity as well as melee damage; especially useful for hauling mounts.',
    'Direct movement-speed gene; a core mobility stat for mounts.',
    'Physical resistance improves survivability while travelling or fighting.',
    'Improves resistance to hot and cold environments.',
    'Utility depends on species; for rideable mounts the verified effect is cargo inventory slots.'
  ];
  const combat=[
    'More health improves combat survivability.',
    'More stamina supports sustained movement and combat activity.',
    'Directly improves melee damage and also adds weight capacity.',
    'Movement speed improves pursuit and repositioning.',
    'Physical resistance is a major defensive combat stat.',
    'Improves resistance to hot and cold environments.',
    'No universal combat effect is verified; usefulness is species-dependent.'
  ];
  if(role==='unknown')return 'Purpose-specific guidance is waiting for the runtime mountability flag; no Mount/Combat assumption is made.';
  return (role==='combat'?combat:mount)[index]||'';
}

function renderAdvisorStatReference(){
  advisorStatReferenceButtons.innerHTML=GENOTYPE_REFERENCE.map((stat,index)=>`<button type="button" class="advisor-stat-ref-btn ${advisorState.referenceStat===index?'active':''}" data-advisor-reference-stat="${index}" title="${esc(stat.name)}">${stat.abbr}</button>`).join('');
  advisorStatReferenceButtons.querySelectorAll('[data-advisor-reference-stat]').forEach(button=>button.addEventListener('click',()=>{
    advisorState.referenceStat=Number(button.dataset.advisorReferenceStat);
    renderAdvisorStatReference();
  }));
  const index=Math.max(0,Math.min(GENOTYPE_REFERENCE.length-1,Number(advisorState.referenceStat)||0));
  const stat=GENOTYPE_REFERENCE[index];
  const verified=index===6?advisorInstinctEffect():stat.effect;
  advisorStatReferenceDetail.innerHTML=`<div class="advisor-stat-ref-name"><span>${esc(stat.abbr)}</span><b>${esc(stat.name)}</b></div><div class="advisor-stat-ref-effect">${esc(verified)}</div><div class="advisor-stat-ref-context"><strong>${esc(advisorRoleLabel())}:</strong> ${esc(advisorRoleContext(index))}</div><div class="advisor-stat-ref-source">Verified affected stats: current ICARUS Genotypes reference. Advisor role note is guidance, not game text.</div>`;
}

function advisorBloodlineRank(value){
  const name=String(value||'').trim();
  if(!name||name.toLocaleLowerCase()==='unknown')return Number.POSITIVE_INFINITY;
  const priority=ADVISOR_ROLE_BLOODLINE_PRIORITY[advisorPurposeState().role]||[];
  const index=priority.findIndex(item=>item.toLocaleLowerCase()===name.toLocaleLowerCase());
  return index<0?Number.POSITIVE_INFINITY:index;
}

function advisorBestParentalBloodline(pair){
  const female=String(pair.female.bloodline||'Unknown');
  const male=String(pair.male.bloodline||'Unknown');
  const fRank=advisorBloodlineRank(female),mRank=advisorBloodlineRank(male);
  if(Number.isFinite(fRank)||Number.isFinite(mRank)){
    if(fRank<mRank)return {value:female,note:`inherited from ♀ ${displayName(pair.female)} · provisional ${advisorRoleLabel()} ranking`};
    if(mRank<fRank)return {value:male,note:`inherited from ♂ ${displayName(pair.male)} · provisional ${advisorRoleLabel()} ranking`};
    if(female.toLocaleLowerCase()===male.toLocaleLowerCase())return {value:female,note:'same bloodline on both parents'};
    return {value:female,note:`tied in current provisional ${advisorRoleLabel()} ranking · alternative: ${male}`};
  }
  if(female.toLocaleLowerCase()===male.toLocaleLowerCase())return {value:female,note:'same bloodline on both parents'};
  return {value:`${female} / ${male}`,note:'relative utility not mapped yet — ranking pending'};
}

function advisorOffspringPreviewHtml(pair){
  const bestStats=STAT_LABELS.map((_,index)=>{
    const femaleRaw=pair.female.stats?.[index],maleRaw=pair.male.stats?.[index];
    const female=femaleRaw===null||femaleRaw===undefined?null:Number(femaleRaw);
    const male=maleRaw===null||maleRaw===undefined?null:Number(maleRaw);
    const values=[female,male].filter(Number.isFinite);
    return values.length?Math.max(...values):null;
  });
  const bestTotal=bestStats.reduce((sum,value)=>sum+(Number.isFinite(value)?value:0),0);
  const statCards=bestStats.map((value,index)=>{
    const atCap=Number(value)===10;
    const note=value==null?'unknown':atCap?'cap reached':'+ positive mutation roll';
    return `<div class="advisor-offspring-stat ${atCap?'at-cap':''}"><span>${STAT_LABELS[index]}</span><b>${value??'—'}</b><small>${esc(note)}</small></div>`;
  }).join('');
  const bloodline=advisorBestParentalBloodline(pair);
  return `<div class="advisor-offspring-preview">
    <div class="advisor-offspring-title"><strong>Best possible offspring</strong><span>Compact per-stat ceiling preview for this pair.</span></div>
    <div class="advisor-offspring-stats">${statCards}</div>
    <div class="advisor-offspring-bloodline"><span>Best parental bloodline · ${esc(advisorRoleLabel())}</span><b>${esc(bloodline.value)}</b><small>${esc(bloodline.note)}</small></div>
    <div class="advisor-offspring-warning"><strong>⚠ Very unlikely:</strong> this takes the better parental value independently for every stat. Bloodline is shown only from the two parental bloodlines; it is not treated as a separate random mutation roll. A positive genotype mutation remains a separate/new roll, not an assumed +1. Rolling every displayed best stat result on one juvenile is strongly improbable; the current genotype total cap is 60${bestTotal>60?` and these parental maxima already total ${bestTotal}`:''}.</div>
  </div>`;
}

function renderAdvisorControls(){
  const purpose=advisorPurposeState();
  if(purpose.capability===true){
    advisorRoleRow.innerHTML=`
      <strong>Purpose</strong>
      <span class="advisor-purpose-status mountable">Runtime: mount-capable</span>
      <button type="button" class="advisor-role-option ${purpose.role==='mount'?'active':''}" data-advisor-purpose="mount">Mount · Auto</button>
      <button type="button" class="advisor-role-option ${purpose.role==='combat'?'active':''}" data-advisor-purpose="combat">Combat Companion</button>
      <span class="advisor-role-help">Mount is automatic. Combat Companion is a manual override saved with Save choices.</span>`;
    advisorRoleRow.querySelectorAll('[data-advisor-purpose]').forEach(button=>button.addEventListener('click',()=>{
      preferences.advisorPurpose=preferences.advisorPurpose||{};
      if(button.dataset.advisorPurpose==='combat')preferences.advisorPurpose[currentSpecies]='combat';
      else delete preferences.advisorPurpose[currentSpecies];
      savePreferences();
      advisorState.chosenPairKey=null;
      renderAdvisor();
    }));
  }else if(purpose.capability===false){
    advisorRoleRow.innerHTML=`
      <strong>Purpose</strong>
      <span class="advisor-purpose-status locked">⚔ Combat Companion · Auto 🔒</span>
      <span class="advisor-role-help">Runtime census says this species is not mountable. Mount cannot be selected manually.</span>`;
  }else{
    advisorRoleRow.innerHTML=`
      <strong>Purpose</strong>
      <span class="advisor-purpose-status unknown">Capability unknown</span>
      <span class="advisor-role-help">BreedingTool.json does not expose mountability yet. The Advisor deliberately does not guess from species names or a hard-coded list.</span>`;
  }
  advisorObjectives.innerHTML=ADVISOR_OBJECTIVES.map(item=>`<button type="button" class="advisor-objective ${advisorState.objective===item.key?'active':''}" data-advisor-objective="${item.key}"><strong>${esc(item.title)}</strong><span>${esc(item.help)}</span></button>`).join('');
  advisorObjectives.querySelectorAll('[data-advisor-objective]').forEach(button=>button.addEventListener('click',()=>{
    advisorState.objective=button.dataset.advisorObjective;
    advisorState.chosenPairKey=null;
    advisorState.selectedFemaleUid=null;advisorState.selectedMaleUid=null;
    renderAdvisor();
  }));
  advisorStatPicker.classList.toggle('visible',advisorState.objective==='selected');
  const priorityMask=usefulMask(currentSpecies);
  advisorStatToggles.innerHTML=STAT_LABELS.map((label,index)=>`<button type="button" class="advisor-stat-toggle ${priorityMask[index]?'active':''}" data-advisor-stat="${index}">${label}</button>`).join('');
  advisorStatToggles.querySelectorAll('[data-advisor-stat]').forEach(button=>button.addEventListener('click',()=>{
    const index=Number(button.dataset.advisorStat);
    const next=[...usefulMask(currentSpecies)];
    next[index]=!next[index];
    if(!next.some(Boolean))next[index]=true;
    preferences.usefulStats[currentSpecies]=next;
    savePreferences();
    recomputeUsefulScores(currentSpecies);
    advisorState.chosenPairKey=null;
    updateUsefulConfig();
    renderAdvisor();
  }));
  advisorModelNote.textContent=advisorObjectiveNote()+` Purpose: ${advisorRoleLabel()}. Purpose-specific score weighting is not active yet.`;
  renderAdvisorStatReference();
}

function renderAdvisor(){
  updateViewChrome();
  wrap.style.display='none';
  breedingTableWrap.style.display='none';
  advisorWrap.style.display='block';
  setViewHeading(`Advisor — ${specialViewScopeLabel()}`,activeViewDescription());
  renderAdvisorControls();

  const {breeders,femaleGroups,maleGroups,pairs}=advisorPairs();
  const femaleCount=femaleGroups.reduce((sum,group)=>sum+group.pets.length,0),maleCount=maleGroups.reduce((sum,group)=>sum+group.pets.length,0);
  countText.textContent=`${femaleCount} eligible F (${femaleGroups.length} genetic groups) · ${maleCount} eligible M (${maleGroups.length} genetic groups) · ${pairs.length} non-redundant pairs`;
  if(!pairs.length){
    advisorContent.innerHTML=`<div class="advisor-empty"><strong>No eligible pair for ${esc(speciesLabel(currentSpecies))}</strong><span>${breeders.length} active/present breeder${breeders.length===1?'':'s'} found. The Advisor requires at least one eligible female and one eligible male.</span></div>`;
    return;
  }

  let chosenBase=pairs.find(pair=>pair.key===advisorState.chosenPairKey)||pairs[0];
  advisorState.chosenPairKey=chosenBase.key;
  const chosenRank=pairs.findIndex(pair=>pair.key===chosenBase.key)+1;
  let chosen=advisorPairWithSelectedMembers(chosenBase);
  const topDistinct=(sex,limit=3)=>{
    const seen=new Set(),result=[];
    for(const pair of pairs){
      const group=sex==='female'?pair.femaleGroup:pair.maleGroup;
      if(!group||seen.has(group.key))continue;
      seen.add(group.key);
      result.push(pair);
      if(result.length>=limit)break;
    }
    return result;
  };
  const topFemales=topDistinct('female');
  const topMales=topDistinct('male');
  const candidateRows=(pair,index,sex)=>{
    const group=sex==='female'?pair.femaleGroup:pair.maleGroup;
    const partnerGroup=sex==='female'?pair.maleGroup:pair.femaleGroup;
    const selectedUid=sex==='female'?persistentIcarusUid(chosen.female.icarus_uid):persistentIcarusUid(chosen.male.icarus_uid);
    const partnerNames=(partnerGroup?.pets||[sex==='female'?pair.male:pair.female])
      .map(member=>`${displayName(member)} (${member.icarus_uid})`).join(' / ');
    const members=group?.pets?.length?group.pets:[sex==='female'?pair.female:pair.male];
    const buttons=members.map(member=>{
      const uid=persistentIcarusUid(member.icarus_uid);
      return `<button type="button" class="advisor-alt ${sex} ${uid===selectedUid?'selected':''}" data-advisor-candidate-side="${sex}" data-advisor-group="${esc(group?.key||'')}" data-advisor-uid="${esc(uid)}"><span class="advisor-alt-rank">#${index+1}</span><span class="advisor-alt-pair"><strong>${sex==='female'?'♀':'♂'} ${esc(displayName(member))} <span class="advisor-alt-uid">(${esc(uid)})</span></strong><span>Best pairing: ${sex==='female'?'♂':'♀'} ${esc(partnerNames)} · ${esc(member.bloodline||'Unknown')}</span></span><span class="advisor-alt-score" title="Best pairing score">${pair.score.toFixed(1)}</span></button>`;
    }).join('');
    return `<div class="advisor-alt-row ${members.length>1?'twins':''}">${buttons}</div>`;
  };
  advisorContent.innerHTML=`
    <div class="advisor-primary">
      ${advisorParentHtml(chosen.female,'female',chosen.femaleGroup)}
      <div class="advisor-result">
        <div class="advisor-rank">Recommended pair #${chosenRank}</div>
        <div class="advisor-score">${chosen.score.toFixed(1)}</div>
        <button type="button" class="control primary-control" id="advisorSendBtn">Send to Breeding Panel</button>
        <div class="advisor-send-state" id="advisorSendState"></div>
      </div>
      ${advisorParentHtml(chosen.male,'male',chosen.maleGroup)}
    </div>
    ${advisorOffspringPreviewHtml(chosen)}
    <div class="advisor-alternatives">
      <div class="advisor-alternatives-head"><strong>Top candidates</strong><span>3 distinct female genetic groups + 3 distinct male genetic groups. Genetically equivalent siblings share one rank but remain separate clickable animals on the same line. Clicking one animal replaces only that parent; “Best pairing” never changes the opposite sex.</span></div>
      <div class="advisor-candidate-columns">
        <div class="advisor-candidate-group">
          <div class="advisor-candidate-group-head female">♀ Best females</div>
          <div class="advisor-alt-list">${topFemales.map((pair,index)=>candidateRows(pair,index,'female')).join('')}</div>
        </div>
        <div class="advisor-candidate-group">
          <div class="advisor-candidate-group-head male">♂ Best males</div>
          <div class="advisor-alt-list">${topMales.map((pair,index)=>candidateRows(pair,index,'male')).join('')}</div>
        </div>
      </div>
    </div>`;
  initializeAdvisorCollapsibles();
  advisorContent.querySelectorAll('[data-advisor-candidate-side]').forEach(button=>button.addEventListener('click',()=>{
    const side=button.dataset.advisorCandidateSide;
    const groupKey=button.dataset.advisorGroup;
    const uid=persistentIcarusUid(button.dataset.advisorUid);
    const current=pairs.find(pair=>pair.key===advisorState.chosenPairKey)||chosenBase||pairs[0];
    const next=side==='female'
      ? pairs.find(pair=>pair.femaleGroup?.key===groupKey && pair.maleGroup?.key===current.maleGroup?.key)
      : pairs.find(pair=>pair.maleGroup?.key===groupKey && pair.femaleGroup?.key===current.femaleGroup?.key);
    if(!next||uid===null)return;
    advisorState.chosenPairKey=next.key;
    advisorState[side==='female'?'selectedFemaleUid':'selectedMaleUid']=uid;
    const pet=(side==='female'?next.femaleGroup?.pets:next.maleGroup?.pets)?.find(item=>persistentIcarusUid(item.icarus_uid)===uid);
    if(pet)selected=pet.id;
    renderAdvisor();
    refreshSelectedDetail();
  }));
  advisorContent.querySelectorAll('[data-select-pet]').forEach(card=>{
    const activate=()=>selectPet(card.dataset.selectPet);
    card.addEventListener('click',activate);
    card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate()}});
  });
  document.getElementById('advisorSendBtn').addEventListener('click',async()=>{
    // Twins/equivalent siblings remain independent selectable animals; send the exact selected UIDs.
    breedingPanel={female_uid:persistentIcarusUid(chosen.female.icarus_uid),male_uid:persistentIcarusUid(chosen.male.icarus_uid)};
    breedingPanelDirty=true;
    renderBreedingPairPanel();
    refreshSelectedDetail();
    const setSendUi=(message,disabled)=>{
      const state=document.getElementById('advisorSendState');
      const button=document.getElementById('advisorSendBtn');
      if(state)state.textContent=message;
      if(button)button.disabled=disabled;
    };
    try{
      setSendUi('Writing latest BreedingTool.json…',true);
      await sendBreedingPanel();
      // sendBreedingPanel reloads the census and can re-render the Advisor, so resolve fresh DOM nodes.
      setSendUi('Sent ✓',false);
    }catch(err){
      setSendUi(`Not sent: ${err.message||String(err)}`,false);
    }
  });
}

function render({selectFirst=false}={}){
  hideTooltip();
  updateViewChrome();
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
  const list=getVisibleNodes();
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
    tree.setAttribute('viewBox','0 0 800 280');
    const t=svgEl('text',{x:400,y:140,'text-anchor':'middle',fill:'#9aa5ad','font-size':'14'});
    t.textContent='No results for this search.';
    tree.appendChild(t); lastLayout=null; zoomLabel.textContent=`${Math.round(zoomScale*100)}%`; return;
  }
  const L=layoutNodes(list); lastLayout=L;
  if(selectFirst)selected=firstLayoutNodeId(L,query?matchingIds:null);
  if(selectFirst&&query&&!selected){
    detail.innerHTML='<div class="detail-placeholder">No pet matches the current search. The complete pedigree remains visible for context.</div>';
  }
  const siblingIds=new Set(selected?(siblingsById.get(selected)||[]):[]);
  tree.setAttribute('viewBox',`0 0 ${L.width} ${L.height}`);
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
      tree.appendChild(path);
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
        tree.appendChild(svgEl('path',{d:`M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`,class:'edge sibling'}));
      }
    }
  }

  for(const n of list){
    const p=L.pos.get(n.id);
    const searchClass=query?(matchingIds.has(n.id)?' search-match':' search-muted'):'';
    const g=svgEl('g',{class:`node ${activityClass(n)}${roleClass(n)}${selected===n.id?' selected':siblingIds.has(n.id)?' sibling-peer':''}${searchClass}`,transform:`translate(${p.x},${p.y})`,tabindex:'0',role:'button','aria-label':displayName(n)});
    const rect=svgEl('rect',{class:'body',x:0,y:0,width:p.w,height:p.h});
    g.appendChild(rect);
    const sex=svgEl('text',{x:12,y:20,class:'sexmark',fill:n.sex==='F'?'#d8a3c2':n.sex==='M'?'#7eb5df':'#a7afb4'});
    sex.textContent=n.sex==='F'?'♀':n.sex==='M'?'♂':'?'; g.appendChild(sex);
    const name=svgEl('text',{x:29,y:20,class:'name'}); {const label=displayName(n);name.textContent=label.length>23?label.slice(0,22)+'…':label;} g.appendChild(name);
    const meta=svgEl('text',{x:12,y:39,class:'meta'}); meta.textContent=[n.bloodline,!n.historical&&!n.isPresent?'Missing':'',n.role].filter(Boolean).join(' · '); g.appendChild(meta);
    const score=svgEl('text',{x:12,y:56,class:'score'}); score.textContent=scoreSummary(n); g.appendChild(score);

    g.addEventListener('click',()=>selectNode(n.id));
    g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNode(n.id)}});
    g.addEventListener('mousemove',e=>showTooltip(n,e.clientX,e.clientY));
    g.addEventListener('mouseleave',hideTooltip);
    tree.appendChild(g);
  }
  if(selected&&L.pos.has(selected)){
    const p=L.pos.get(selected);
    tree.appendChild(svgEl('rect',{class:'selection-outline',x:p.x-2,y:p.y-2,width:p.w+4,height:p.h+4,rx:6}));
  }
  if(selectFirst&&selected)renderSelectedDetail(selected);
}

function statClass(index,val,speciesKey=currentSpecies){
  if(val==null)return'';
  if(!usefulMask(speciesKey)[index])return val===0?'great':val<=2?'good':val>=5?'bad':'';
  return val===10?'great':val>=8?'good':val<=2?'bad':'';
}
function renderSelectedDetail(id){
  const n=byId.get(id); if(!n)return;
  const ownedFoundation=foundationForPet(n);
  selectedPetSummary.textContent=`${displayName(n)} (${n.icarus_uid??'—'}) · ${n.sex==='F'?'Female':n.sex==='M'?'Male':'Unknown sex'}`;
  const inactiveLock=n.breedingInactiveReason||automaticInactiveReason(n);
  const statHtml=(n.stats||[]).map((v,i)=>`<div class="stat ${statClass(i,v,nodeSpeciesKey(n))}"><label>${STAT_LABELS[i]}</label><b>${v??'—'}</b></div>`).join('');
  const kids=offspringOf(id);
  const siblings=siblingsOf(n);
  const parentButtons=[n.mother,n.father].filter(Boolean).map(pid=>byId.get(pid)).filter(Boolean).map(p=>`<button class="linkbtn" data-id="${esc(p.id)}">${esc(displayName(p))}</button>`).join('')||'<span class="small">None</span>';
  const siblingButtons=siblings.map(peer=>`<button class="linkbtn" data-id="${esc(peer.id)}">${esc(displayName(peer))}</button>`).join('')||'<span class="small">None</span>';
  const childButtons=kids.map(k=>`<button class="linkbtn" data-id="${esc(k.id)}">${esc(displayName(k))}</button>`).join('')||'<span class="small">None</span>';
  detail.innerHTML=`
    <div class="detail-card">
      <div class="detail-identity">
        <h2><span>${esc(n.name)}${n.nickname?` <span class="small">(${esc(n.nickname)})</span>`:''}</span><span class="detail-uid">(${esc(n.icarus_uid??'—')})</span></h2>
        <div class="small">${n.sex==='F'?'Female':n.sex==='M'?'Male':'Unknown sex'} · ${esc(n.bloodline)} · ${presenceLabel(n)} · Breeding: ${activityLabel(n)}${n.role?` · Role: ${esc(n.role)}`:''}</div>
      </div>
      <div class="stats">${statHtml}</div>
      <div class="detail-meta">
        <div class="item"><span class="label">Total</span><span class="value">${n.total7??'—'}</span></div>
        <div class="item"><span class="label">${usefulLabel(nodeSpeciesKey(n))}</span><span class="value">${n.usefulScore??'—'}</span></div>
        <div class="item"><span class="label">Level</span><span class="value">${n.level??'—'}</span></div>
        <div class="item"><span class="label">Experience</span><span class="value">${n.experience??'—'}</span></div>
      </div>
      <div class="detail-fields">
        <label>Nickname<input data-detail-field="nickname" value="${esc(n.nickname||'')}" placeholder="Optional nickname"></label>
        <label>Breeding status<select data-detail-field="breedingActive" ${inactiveLock?`disabled title="${esc(inactiveLock)}"`:''}><option value="true" ${n.breedingActive?'selected':''}>Active</option><option value="false" ${!n.breedingActive?'selected':''}>Inactive</option></select>${inactiveLock?`<span class="small">${esc(inactiveLock)}</span>`:''}</label>
        <label>Role<select data-detail-field="role">${roleOptionsHtml(n.role)}</select></label>
        <label class="detail-notes">Notes<textarea data-detail-field="notes" placeholder="Personal notes">${esc(n.notes||'')}</textarea></label>
        <div class="detail-actions">
          ${breedingSelectionButtonHtml(n)}
          <button class="tab family-view-action" id="viewPetLineageBtn">${ownedFoundation?'See foundation':'See family'}</button>
          <button class="tab" id="detailAddRoleBtn" title="Create a custom pet role">+ Add role</button>
        </div>
      </div>
      <div class="detail-lower">
        <div class="detail-relations">
          <div class="relation-group"><span class="relation-label">Parents</span>${parentButtons}</div>
          <div class="relation-group"><span class="relation-label">Siblings (${siblings.length})</span>${siblingButtons}</div>
          <div class="relation-group"><span class="relation-label">Offspring</span>${childButtons}</div>
        </div>
        <div class="detail-save"><span class="save-state" id="detailSaveState"></span><button class="control primary-control" id="saveDetailBtn">Save annotations</button></div>
      </div>
    </div>`;
  detail.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>jumpToNode(b.dataset.id)));
  const saveDetail=()=>{
    const edits=loadBoardEdits(), key=boardKey(n);
    edits[key]=edits[key]||{};
    detail.querySelectorAll('[data-detail-field]').forEach(el=>{
      edits[key][el.dataset.detailField]=el.dataset.detailField==='breedingActive'?el.value==='true':el.value;
    });
    saveBoardEdits(edits); applyBoardEdits(); render(); renderSelectedDetail(id);
    const state=document.getElementById('detailSaveState'); if(state)state.textContent='Saved ✓';
  };
  document.getElementById('saveDetailBtn').addEventListener('click',saveDetail);
  document.getElementById('viewPetLineageBtn').addEventListener('click',()=>openPetLineage(n,ownedFoundation));
  document.getElementById('detailAddRoleBtn').addEventListener('click',promptAddRole);
  document.getElementById('setBreedingSelectionBtn')?.addEventListener('click',()=>setBreedingSelection(n));
  detail.querySelector('[data-detail-field="notes"]').addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();saveDetail()}
  });
  setTimeout(()=>scrollNodeIntoView(id),0);
}
function selectPet(id,{rerender=true}={}){
  if(!byId.has(id))return;
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
  const p=lastLayout?.pos.get(id); if(!p)return;
  wrap.scrollTo({left:Math.max(0,p.x-wrap.clientWidth/2+p.w/2),top:Math.max(0,p.y-120),behavior:'smooth'});
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
let boardSort={key:'usefulScore',dir:-1};
let boardEdits=null;

function boardKey(n){return String(n.icarus_uid??n.id)}
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
  return n?`${displayName(n)} (${n.icarus_uid??'—'})`:'—';
}
function parentDisplay(n){
  const m=n.mother?(byId.has(n.mother)?petNameWithUid(byId.get(n.mother)):n.mother):'—';
  const f=n.father?(byId.has(n.father)?petNameWithUid(byId.get(n.father)):n.father):'—';
  return `${m} × ${f}`;
}
function boardNodes(){
  applyBoardEdits();
  let list=specialViewScopeNodes().filter(n=>!hideInactive||n.breedingActive);
  const q=search.value.trim().toLowerCase();
  if(q)list=list.filter(n=>[n.name,n.nickname,n.bloodline,n.role,n.notes,n.sex,presenceLabel(n),activityLabel(n),statsText(n),parentDisplay(n),n.level,n.usefulScore,n.total7].join(' ').toLowerCase().includes(q));
  const key=boardSort.key, dir=boardSort.dir;
  list.sort((a,b)=>{
    let av=key.startsWith('s')?Number(a.stats?.[Number(key.slice(1))]??-999):a[key];
    let bv=key.startsWith('s')?Number(b.stats?.[Number(key.slice(1))]??-999):b[key];
    if(typeof av==='string'||typeof bv==='string')return String(av??'').localeCompare(String(bv??''))*dir;
    return ((Number(av??-999)-Number(bv??-999))*dir)||a.name.localeCompare(b.name);
  });
  return list;
}
function renderBreedingTable(){
  updateViewChrome();
  advisorWrap.style.display='none';
  wrap.style.display='none';
  breedingTableWrap.style.display='block';
  setViewHeading(`Board — ${specialViewScopeLabel()}`,specialViewScope().kind==='bloodline'
    ? `Bloodline ${specialViewScope().key} within ${speciesLabel(currentSpecies)}. Presence comes from F7; missing and historical pets are automatically inactive.`
    : 'Presence comes from F7. Missing and historical pets are automatically inactive; present pets remain a reversible personal choice.');
  const list=boardNodes();
  const scopeNodes=specialViewScopeNodes();
  const scopeTotal=scopeNodes.length;
  countText.textContent=`${list.length} shown / ${scopeTotal} in scope`;
  breedingCountHint.textContent=`${scopeNodes.filter(n=>!n.breedingActive).length} inactive`;
  const headers=[['name','Name / ID'],['nickname','Nickname'],['sex','Sex'],['bloodline','Lineage'],['s0','V'],['s1','F'],['s2','P'],['s3','R'],['s4','T'],['s5','A'],['s6','I'],['usefulScore',usefulLabel()],['total7','Total'],['level','Lvl'],['isPresent','Presence'],['breedingActive','Breeding status'],['role','Role']];
  breedingTable.innerHTML=`<thead><tr>${headers.map(([k,l])=>`<th data-sort="${k}">${l}</th>`).join('')}</tr></thead><tbody></tbody>`;
  const tbody=breedingTable.querySelector('tbody');
  for(const n of list){
    const tr=document.createElement('tr');
    const statCells=(n.stats||Array(7).fill(null)).map((v,i)=>`<td class="statcell ${statClass(i,v)}">${v??'—'}</td>`).join('');
    tr.classList.toggle('selected-row',selected===n.id);
    tr.innerHTML=`
      <td><button class="linkbtn open-node" data-id="${esc(n.id)}"><span class="board-pet-name">${esc(n.name)}</span><span class="board-pet-uid">(${esc(n.icarus_uid??'—')})</span></button></td>
      <td><input data-field="nickname" data-key="${esc(boardKey(n))}" value="${esc(n.nickname||'')}" placeholder="—"></td>
      <td>${n.sex==='F'?'♀ F':n.sex==='M'?'♂ M':'?'}</td>
      <td>${esc(n.bloodline||'—')}</td>
      ${statCells}
      <td>${n.usefulScore??'—'}</td><td>${n.total7??'—'}</td><td>${n.level??'—'}</td>
      <td><span class="status-chip ${presenceClass(n)}">${presenceLabel(n)}</span></td>
      <td><select data-field="breedingActive" data-key="${esc(boardKey(n))}" data-id="${esc(n.id)}" ${n.breedingInactiveReason?`disabled title="${esc(n.breedingInactiveReason)}"`:''}><option value="true" ${n.breedingActive?'selected':''}>Active</option><option value="false" ${!n.breedingActive?'selected':''}>Inactive</option></select></td>
      <td><select data-field="role" data-key="${esc(boardKey(n))}">${roleOptionsHtml(n.role)}</select></td>`;
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
    if(field==='breedingActive')renderBreedingTable();
  };
  breedingTable.querySelectorAll('input[data-field]').forEach(el=>el.addEventListener('input',()=>saveField(el)));
  breedingTable.querySelectorAll('select[data-field]').forEach(el=>el.addEventListener('change',()=>saveField(el)));
  breedingTable.querySelectorAll('.open-node').forEach(b=>b.addEventListener('click',()=>{
    selectPet(b.dataset.id);
  }));
}

function updateUsefulConfig(){
  const mask=usefulMask();
  document.getElementById('usefulConfigBtn').textContent=`Priority stats (${mask.filter(Boolean).length}/7)`;
  usefulConfigTitle.textContent=`Breeding priorities — ${speciesLabel(currentSpecies)}`;
  usefulChecks.innerHTML=STAT_LABELS.map((label,index)=>`<label class="useful-check"><input type="checkbox" data-stat-index="${index}" ${mask[index]?'checked':''}>${label}</label>`).join('');
  usefulChecks.querySelectorAll('[data-stat-index]').forEach(input=>input.addEventListener('change',()=>{
    const next=[...usefulMask()]; next[Number(input.dataset.statIndex)]=input.checked;
    preferences.usefulStats[currentSpecies]=next; savePreferences(); recomputeUsefulScores(); updateUsefulConfig();
    render(); refreshSelectedDetail();
  }));
}

document.getElementById('usefulConfigBtn').addEventListener('click',()=>{
  usefulConfig.classList.toggle('visible');
  document.getElementById('usefulConfigBtn').classList.toggle('active',usefulConfig.classList.contains('visible'));
  updateUsefulConfig();
});
document.getElementById('usefulResetBtn').addEventListener('click',()=>{
  delete preferences.usefulStats[currentSpecies]; savePreferences(); recomputeUsefulScores(); updateUsefulConfig();
  render(); refreshSelectedDetail();
});

function promptAddRole(){
  const value=prompt('New role name (for example: Carrier, Breeder, Resource):','');
  const role=String(value||'').trim();
  if(!role)return;
  const existing=allRoles().find(item=>item.toLocaleLowerCase()===role.toLocaleLowerCase());
  if(!existing){
    preferences.customRoles=[...(Array.isArray(preferences.customRoles)?preferences.customRoles:[]),role];
    savePreferences();
  }
  render(); refreshSelectedDetail();
}

const LOCAL_POLL_MS=60000;
const EXPECTED_GENETICS=['V','F','P','R','T','A','I'];
let lastJsonText=null;
let refreshInFlight=false;
let currentPayload=null;
let userDataDirty=false;
let breedingPanel={female_uid:null,male_uid:null};
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
  root.graph={...existing,schema_version:2,preferences:JSON.parse(JSON.stringify(preferences)),annotations:encodedAnnotations()};
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
  applyBlockOrder();
}

function persistentIcarusUid(value){
  const uid=numericUid(value);
  return uid!==null&&Number.isInteger(uid)&&uid>=0?uid:null;
}

function hydrateBreedingPanel(payload){
  const panel=payload?.breeding_panel;
  breedingPanel={
    female_uid:persistentIcarusUid(panel?.female_uid),
    male_uid:persistentIcarusUid(panel?.male_uid)
  };
}

function selectedPetName(uid){
  if(uid===null)return 'Not selected';
  const pet=currentPayload?.pets?.find(item=>persistentIcarusUid(item.icarus_uid)===uid);
  return pet&&canonicalName(pet.name)?canonicalName(pet.name):'[MISSING]';
}

function petByPersistentUid(uid){
  if(uid===null)return null;
  return DATA.nodes.find(pet=>persistentIcarusUid(pet.icarus_uid)===uid)||null;
}

function breedingPairStatus(panel=breedingPanel){
  const female=petByPersistentUid(panel.female_uid),male=petByPersistentUid(panel.male_uid);
  const complete=panel.female_uid!==null&&panel.male_uid!==null;
  const resolved=!complete||Boolean(female&&male);
  const sameSpecies=!complete||!female||!male||nodeSpeciesKey(female)===nodeSpeciesKey(male);
  const reason=complete&&!resolved?'One selected pet is no longer available.':complete&&!sameSpecies?'Female and male must belong to the same species.':'';
  return {female,male,complete,resolved,sameSpecies,valid:complete&&resolved&&sameSpecies,reason};
}

function breederAssignmentBlockReason(n){
  const uid=persistentIcarusUid(n.icarus_uid);
  if(uid===null)return 'A persistent non-negative Icarus UID is required';
  if(n.historical||n.isPresent===false)return '/!\\ this animal is missing';
  if(n.sex!=='F'&&n.sex!=='M')return 'A known female or male sex is required';
  const otherUid=breedingPanel[n.sex==='F'?'male_uid':'female_uid'];
  const other=petByPersistentUid(otherUid);
  if(other&&nodeSpeciesKey(other)!==nodeSpeciesKey(n))return `Current ${n.sex==='F'?'male':'female'} belongs to ${speciesLabel(nodeSpeciesKey(other))}`;
  return '';
}

function renderBreedingPairPanel(){
  const femaleUid=breedingPanel.female_uid,maleUid=breedingPanel.male_uid;
  nextFemaleName.textContent=femaleUid===null?'Not selected':selectedPetName(femaleUid);
  nextMaleName.textContent=maleUid===null?'Not selected':selectedPetName(maleUid);
  breedingPairState.textContent=breedingPanelDirty?'Pending — not sent':'';
  const status=breedingPairStatus();
  sendBreedingPairBtn.disabled=!status.valid;
  sendBreedingPairBtn.title=status.reason||(!status.complete?'Select one female and one male.':'Write the current pair to BreedingTool.json');
  sendBreedingPairBtn.classList.toggle('active',status.valid&&breedingPanelDirty);
}

function breedingSelectionButtonHtml(n){
  if(n.sex!=='F'&&n.sex!=='M')return '';
  const uid=persistentIcarusUid(n.icarus_uid);
  const side=n.sex==='F'?'female':'male';
  const selected=uid!==null&&breedingPanel[`${side}_uid`]===uid;
  const disabledReason=breederAssignmentBlockReason(n);
  const inactiveTitle=!disabledReason&&!n.breedingActive?'/!\\ warning this animal is inactive; confirmation required':'';
  const blockedIcon=disabledReason?'<span class="breeder-blocked-icon" aria-hidden="true">⊘</span>':'';
  const title=disabledReason||inactiveTitle;
  return `<button class="control breeder-action${disabledReason?'':' primary-control'}" id="setBreedingSelectionBtn"${disabledReason?' disabled':''}${title?` title="${esc(title)}"`:''}>${blockedIcon}${selected?`Selected as next ${side}`:`Set as next ${side}`}</button>`;
}

function setBreedingSelection(n){
  const uid=persistentIcarusUid(n.icarus_uid);
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
  breedingPanel[n.sex==='F'?'female_uid':'male_uid']=uid;
  breedingPanelDirty=true;
  renderBreedingPairPanel();
  if(activated){updateCategoryNavigation();render()}
  renderSelectedDetail(n.id);
}
const LOCAL_JSON_NAME='BreedingTool.json';
const DIRECTORY_DB='breeding-tool-local-source';
const DIRECTORY_STORE='handles';
const DIRECTORY_PICKER_ID='breeding-tool-json-folder';
let localDirectoryHandle=null;

function rebuildIndex(){byId=new Map(DATA.nodes.map(n=>[n.id,n]));}

function rebuildRelationshipIndexes(){
  ({childrenByParentId,siblingsById}=buildRelationshipIndexes(DATA.nodes));
}

function rebuildNavigationCatalog(){
  navigationCatalog=buildNavigationCatalog(DATA.nodes,childrenByParentId);
}

function displayName(n){
  if(!n)return '—';
  return n.nickname?`${n.name} (${n.nickname})`:n.name;
}

function canonicalName(value){
  return String(value||'').trim();
}

function numericUid(value){
  if(value===null || value===undefined || value==='')return null;
  const uid=Number(value);
  return Number.isFinite(uid)?uid:null;
}

function petId(uid){return `uid:${uid}`}

function nameKey(species,name){
  return `${species}\u0000${canonicalName(name).toLocaleLowerCase()}`;
}

function applyCensus(payload){
  validateCensus(payload);
  connectEmpty.hidden=true;

  if(!userDataDirty)hydrateGraphUserData(payload);
  if(!breedingPanelDirty)hydrateBreedingPanel(payload);
  currentPayload=payload;
  if(userDataDirty)syncGraphUserData();

  const validPets=payload.pets.filter(p=>{
    const uid=numericUid(p.icarus_uid);
    const historical=uid===null||uid<0||p.historical===true;
    return Array.isArray(p.genetics) && p.genetics.length===7 &&
      p.genetics.every(value=>historical?(value===null||Number.isFinite(Number(value))):Number.isFinite(Number(value))) &&
      (p.species_key||p.actor_class);
  });
  const nodes=[];
  const importedByUid=new Map();
  const importedByPet=new Map();
  const importedBySpeciesName=new Map();

  // PASS 1: rebuild one stable node per UID. No save-specific data is embedded.
  for(const [sourceIndex,p] of validPets.entries()){
    const uid=numericUid(p.icarus_uid);
    const species=normalizeSpeciesKey(p.species_key||p.actor_class);
    const stats=p.genetics.map(value=>value===null?null:Number(value));
    const historical=uid===null||uid<0;
    const isPresent=typeof p.present==='boolean'?p.present:true;
    const n={
      id:uid===null?`synthetic:${sourceIndex}`:petId(uid),
      icarus_uid:uid,
      name:canonicalName(p.name)||(uid===null?'Historical pet':`Pet ${uid}`),
      previousNames:Array.isArray(p.previous_names)?p.previous_names.map(canonicalName).filter(Boolean):[],
      actor_class:p.actor_class||'',
      species_key:species,
      sex:p.sex==='Female'?'F':p.sex==='Male'?'M':'?',
      bloodline:p.lineage||'Unknown',
      mountable:typeof p.mountable==='boolean'?p.mountable:null,
      stats,
      level:p.level!==null&&p.level!==undefined&&Number.isFinite(Number(p.level))?Number(p.level):null,
      experience:p.experience!==null&&p.experience!==undefined&&Number.isFinite(Number(p.experience))?Number(p.experience):null,
      isPresent:historical?null:isPresent,
      historical,
      role:'',notes:'',mother:null,father:null
    };
    n.originKind=classifyPetOrigin(p);
    n.total7=n.stats.every(Number.isFinite)?n.stats.reduce((a,b)=>a+b,0):null;
    n.usefulScore=n.total7===null?null:usefulScore(n);
    nodes.push(n);
    importedByPet.set(p,n);
    if(uid!==null)importedByUid.set(uid,n);

    for(const name of [n.name,...n.previousNames]){
      const key=nameKey(species,name);
      if(!importedBySpeciesName.has(key))importedBySpeciesName.set(key,[]);
      importedBySpeciesName.get(key).push(n);
    }
  }

  DATA.nodes=nodes;
  rebuildIndex();

  function uniqueNamedParent(species,label,expectedSex){
    if(!canonicalName(label))return null;
    const candidates=(importedBySpeciesName.get(nameKey(species,label))||[])
      .filter(n=>n.sex===expectedSex);
    return candidates.length===1?candidates[0]:null;
  }

  // PASS 2: parent UID is authoritative; names are a unique legacy fallback.
  for(const p of validPets){
    const species=normalizeSpeciesKey(p.species_key||p.actor_class);
    const n=importedByPet.get(p);
    if(!n)continue;
    const motherUid=numericUid(p.mother_uid);
    const fatherUid=numericUid(p.father_uid);
    const mom=motherUid!==null
      ? importedByUid.get(motherUid)
      : uniqueNamedParent(species,p.mother,'F');
    const dad=fatherUid!==null
      ? importedByUid.get(fatherUid)
      : uniqueNamedParent(species,p.father,'M');
    n.mother=mom?.id||null;
    n.father=dad?.id||null;
  }

  const speciesCount=new Set(validPets.map(p=>normalizeSpeciesKey(p.species_key||p.actor_class))).size;
  importBadge.textContent=`JSON: ${validPets.length} pets · ${speciesCount} species · ${new Date().toLocaleDateString('en-GB')}`;
  rebuildIndex();rebuildRelationshipIndexes();applyBoardEdits();rebuildNavigationCatalog();
  if(!speciesKeys().includes(currentSpecies))currentSpecies=defaultSpeciesKey();
  updateCategoryNavigation();render();renderBreedingPairPanel();
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
  const entry=await handle.getFileHandle(LOCAL_JSON_NAME);
  return (await entry.getFile()).text();
}

function serializeCensus(payload){
  const entries=Object.entries(payload).map(([key,value])=>{
    if(key==='pets'&&Array.isArray(value)){
      const rows=value.map(p=>`    ${JSON.stringify(p)}`);
      return `  "pets":[\n${rows.map((row,index)=>row+(index<rows.length-1?',':'')).join('\n')}\n  ]`;
    }
    return `  ${JSON.stringify(key)}:${JSON.stringify(value)}`;
  });
  return `{\n${entries.map((entry,index)=>entry+(index<entries.length-1?',':'')).join('\n')}\n}\n`;
}

async function writableJsonEntry(){
  if(!('showDirectoryPicker' in window))throw new Error('Sending requires folder access in a Chromium browser');
  const handle=localDirectoryHandle;
  if(!handle)throw new Error('Click Connect / Refresh first, then try again');
  let permission=await handle.queryPermission({mode:'readwrite'});
  if(permission!=='granted')permission=await handle.requestPermission({mode:'readwrite'});
  if(permission!=='granted')throw new Error('File modification permission was not granted');
  return handle.getFileHandle(LOCAL_JSON_NAME);
}

function validateCensus(payload){
  if(payload?.schema!=='BTPetCensus'||Number(payload.schema_version)!==1||!Array.isArray(payload.pets)
    ||JSON.stringify(payload.genetics_order)!==JSON.stringify(EXPECTED_GENETICS)){
    throw new Error('BreedingTool.json is not valid BTPetCensus data');
  }
}

async function updateCensusEntry(entry, update){
  const payload=JSON.parse(await (await entry.getFile()).text());
  validateCensus(payload);
  update(payload);
  const text=serializeCensus(payload);
  const writable=await entry.createWritable();
  await writable.write(text);
  await writable.close();
  return {payload,text};
}

async function sendBreedingPanel(){
  const status=breedingPairStatus();
  if(!status.valid)throw new Error(status.reason||'Select one female and one male first.');
  const entry=await writableJsonEntry();
  const {payload,text}=await updateCensusEntry(entry,latest=>{
    latest.breeding_panel={female_uid:breedingPanel.female_uid,male_uid:breedingPanel.male_uid};
  });
  breedingPanelDirty=false;
  currentPayload=payload;
  lastJsonText=text;
  applyCensus(payload);
  breedingPairState.textContent='Sent to BreedingTool.json';
}

function downloadJson(text){
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  link.download=LOCAL_JSON_NAME;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),0);
}

async function saveChoices(){
  if(!currentPayload)throw new Error('No JSON loaded yet');
  syncGraphUserData();
  const graphUserData=currentPayload.user_data;
  let handle=await loadSavedDirectory().catch(()=>null);
  let outputPayload=currentPayload;
  let text='';

  if('showDirectoryPicker' in window){
    let permission=handle?await handle.queryPermission({mode:'readwrite'}):'prompt';
    if(handle&&permission!=='granted')permission=await handle.requestPermission({mode:'readwrite'});
    if(!handle||permission!=='granted'){
      handle=await window.showDirectoryPicker({id:DIRECTORY_PICKER_ID,mode:'readwrite'});
      await rememberDirectory(handle);
    }
    const entry=await handle.getFileHandle(LOCAL_JSON_NAME);
    const updated=await updateCensusEntry(entry,latest=>{latest.user_data=graphUserData});
    outputPayload=updated.payload;
    text=updated.text;
    importBadge.textContent='Choices saved locally to BreedingTool.json';
  }else{
    text=serializeCensus(outputPayload);
    downloadJson(text);
    importBadge.textContent='Choices exported: replace BreedingTool.json with the download';
  }

  currentPayload=outputPayload;
  lastJsonText=text;
  userDataDirty=false;
  saveChoicesBtn.textContent='Save choices';
  saveChoicesBtn.classList.remove('active');
  applyCensus(currentPayload);
}

async function pickJsonFile(){
  const input=document.getElementById('jsonFileFallback');
  return new Promise(resolve=>{
    input.value='';
    input.onchange=async()=>resolve(input.files?.[0]?await input.files[0].text():null);
    input.click();
  });
}

async function applyJsonText(text,source,force){
  const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  if(text!==lastJsonText || force){
    const payload=JSON.parse(text);
    applyCensus(payload);
    lastJsonText=text;
    const count=Array.isArray(payload.pets)?payload.pets.length:0;
    importBadge.textContent=`JSON ${source}: ${count} pets · ${force?'refreshed':'synced'} ${now}`;
  }else{
    importBadge.textContent=`JSON ${source}: up to date · ${now}`;
  }
}

async function connectDirectory(){
  if(refreshInFlight)return;
  refreshInFlight=true;
  importBadge.textContent='JSON: selecting folder…';
  try{
    if('showDirectoryPicker' in window){
      const chosen=await window.showDirectoryPicker({id:DIRECTORY_PICKER_ID,mode:'readwrite'});
      const text=await readDirectoryJson(chosen,true,'readwrite');
      if(!text)throw new Error('Folder access was not granted');
      await applyJsonText(text,'local',true);
      localDirectoryHandle=chosen;
      updateConnectionControls();
      void rememberDirectory(chosen);
    }else{
      const text=await pickJsonFile();
      if(!text)throw new DOMException('Selection cancelled','AbortError');
      await applyJsonText(text,'selected file',true);
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
  if(refreshInFlight)return;
  refreshInFlight=true;
  if(force)importBadge.textContent='JSON: refreshing…';
  try{
    let handle=localDirectoryHandle;
    if(!handle)handle=await bounded(loadSavedDirectory(),2000,'Saved folder lookup timed out');
    if(!handle){
      importBadge.textContent='JSON: not connected';
      return;
    }
    const text=await readDirectoryJson(handle,force,force?'readwrite':'read');
    if(!text){
      importBadge.textContent='JSON: folder permission required';
      return;
    }
    await applyJsonText(text,'local',force);
    localDirectoryHandle=handle;
    updateConnectionControls();
  }catch(err){
    updateConnectionControls();
    importBadge.textContent=`JSON: unavailable (${err.message})`;
    console.warn('BreedingTool.json unavailable:',err);
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
  updateConnectionControls();
  importBadge.textContent=currentPayload?'JSON: disconnected · snapshot retained':'JSON: not connected';
}

refreshBtn.addEventListener('click',()=>localDirectoryHandle?refreshJson(true):connectDirectory());
disconnectBtn.addEventListener('click',disconnectDirectory);
saveChoicesBtn.addEventListener('click',()=>saveChoices().catch(err=>{
  if(err?.name!=='AbortError'){
    importBadge.textContent=`Choices not saved (${err.message})`;
    console.warn('BreedingTool.json choices not saved:',err);
  }
}));
refreshJson();
updateConnectionControls();
setInterval(()=>refreshJson(false),LOCAL_POLL_MS);

function applyZoom(){
  if(!lastLayout)return;
  tree.style.width=`${Math.max(lastLayout.width,wrap.clientWidth)*zoomScale}px`;
  tree.style.height=`${lastLayout.height*zoomScale}px`;
  zoomLabel.textContent=`${Math.round(zoomScale*100)}%`;
}

function setZoom(value){
  zoomScale=Math.max(0.35,Math.min(1.8,value));
  applyZoom();
}

function fitTree(dimension='both'){
  if(!lastLayout)return;
  const sx=(wrap.clientWidth-20)/Math.max(1,lastLayout.width);
  const sy=(wrap.clientHeight-20)/Math.max(1,lastLayout.height);
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
  breedingPanel={female_uid:null,male_uid:null};
  breedingPanelDirty=true;
  renderBreedingPairPanel();
  refreshSelectedDetail();
});
sendBreedingPairBtn.addEventListener('click',async()=>{
  try{
    sendBreedingPairBtn.disabled=true;
    breedingPairState.textContent='Reading latest local JSON…';
    await sendBreedingPanel();
  }catch(err){
    breedingPairState.textContent=`Not sent: ${err.message||String(err)}`;
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
