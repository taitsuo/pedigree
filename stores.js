/* Read-only adapter for the physical V1 stores. Business code receives V4 logical views. */
globalThis.BTStores=(()=>{
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const copy=x=>JSON.parse(JSON.stringify(x));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const insist=(ok,message)=>{if(!ok)throw new Error(message)};
  const keys=(x,allowed,label)=>{
    insist(object(x),`${label}: object required`);
    insist(Object.keys(x).every(k=>allowed.includes(k)),`${label}: unsupported field`);
  };
  const accountKeys=['steam_id','steam_user'];
  function identity(a){keys(a,accountKeys,'Account');insist(/^\d{17}$/.test(a.steam_id)&&typeof a.steam_user==='string'&&a.steam_user.length>0,'Invalid account identity')}
  const sameAccount=(a,b)=>a?.steam_id===b?.steam_id&&a?.steam_user===b?.steam_user;
  const integer=n=>Number.isSafeInteger(n)&&n>=1;
  const tagFor=a=>a.steam_user.replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[ .]+$/g,'');
  const envelope=['storage_schema','store','account','bundle_id','revision','worlds'];
  const dataKeys=[...envelope,'schema','schema_version','genetics_order','active_world','next_world_id','user_data','transport','extensions','archived_preferences','archived_transport','archived_extensions','archived_active_world'];
  const worldNumber=id=>/^W-\d+$/.test(id)?Number(id.slice(2)):NaN;
  const uid=x=>typeof x==='string'&&/^\d+$/.test(x);
  function logical(d){
    insist(d.schema==='BTPetCensus'&&d.schema_version===4&&equal(d.genetics_order,['V','F','P','R','T','A','I']),'V4 schema/genetics required');
    identity(d.account);insist(['active','archive'].includes(d.document_kind)&&integer(d.next_world_id),'Invalid logical document');
    insist(object(d.user_data.preferences)&&object(d.user_data.worlds)&&object(d.extensions),'Invalid user data/extensions');
    keys(d.transport,['protocol','last_command'],'Transport');insist(d.transport.protocol===3&&Object.hasOwn(d.transport,'last_command'),'Transport protocol 3 required');
    insist(d.active_world===null||Object.hasOwn(d.worlds,d.active_world),'Invalid active world');
    for(const id of Object.keys(d.user_data.worlds))insist(Object.hasOwn(d.worlds,id),'Orphan world user_data');
    const prospects=new Set();
    for(const [id,w]of Object.entries(d.worlds)){
      insist(Number.isSafeInteger(worldNumber(id))&&worldNumber(id)<d.next_world_id,'Invalid W-ID/world high-water');
      insist(integer(w.next_pet_id)&&object(w.pets)&&object(w.runtime.pending_gestations),'Invalid world structure/counter');
      const m=w.metadata;insist(object(m)&&typeof m.bootstrap_completed==='boolean'&&typeof m.prospect_id==='string'&&m.prospect_id.length>0&&['icarus','historical'].includes(m.identity_kind),'Invalid world metadata');
      insist(m.identity_kind!=='historical'||d.document_kind==='archive','Historical world cannot be active');
      const prospect=`${m.identity_kind}:${m.prospect_id}`;insist(!prospects.has(prospect),'Duplicate ProspectID');prospects.add(prospect);
      insist(object(d.user_data.worlds[id]),'Missing world user_data');
      const seen=new Set();
      for(const [petId,p]of Object.entries(w.pets)){
        const n=petId.startsWith(id+':P-')?Number(petId.slice(id.length+3)):NaN;
        insist(new RegExp('^'+id+':P-\\d+$').test(petId)&&Number.isSafeInteger(n)&&n<w.next_pet_id,'Invalid BT_ID/pet high-water');
        insist(['TRACKED','ACTIVE','ARCHIVED'].includes(p.lifecycle_state)&&['neutral','GESTATING','GROWING','RESTING'].includes(p.status_state),'Invalid pet lifecycle/status');
        insist(!['presence','previous_name','last_seen','field_sources','lifecycle_evidence'].some(k=>Object.hasOwn(p,k)),'Retired pet fields');
        insist(!p.growing||(p.growing.phase===undefined&&['TAMING_COMPONENT','PACIFICITY'].includes(p.growing.driver)),'Invalid growing driver');
        insist(p.trap_uid===undefined||uid(p.trap_uid),'Invalid trap UID');
        insist(Array.isArray(p.uid_history),'UID history required');
        const own=new Set();for(const h of p.uid_history){insist(uid(h.uid)&&!seen.has(h.uid),'UID collision');seen.add(h.uid);own.add(h.uid)}
        insist(p.current_uid===null||own.has(p.current_uid),'Invalid current UID mapping');
        for(const side of ['mother','father']){const r=p.parents?.[side];insist(object(r)&&(r.bt_id===null||Object.hasOwn(w.pets,r.bt_id)),'Missing/foreign parent');insist(r.observed_uid===undefined&&r.evidence===undefined,'Retired parent fields')}
      }
      const user=d.user_data.worlds[id];insist(object(user.graph)&&object(user.current_pair),'Invalid world graph/current_pair');
      for(const side of ['female_bt_id','male_bt_id']){const petId=user.current_pair[side];insist(petId===null||typeof petId==='string'&&Object.hasOwn(w.pets,petId),'Invalid current_pair reference')}
      for(const [mother,father]of Object.entries(w.runtime.pending_gestations))insist(Object.hasOwn(w.pets,mother)&&Object.hasOwn(w.pets,father),'Invalid pending gestation reference');
    }
    return d;
  }
  function rebuild(s){
    keys(s,['data','tracked','cheptel'],'Store set');insist(['data','tracked','cheptel'].every(k=>Object.hasOwn(s,k)),'All three stores required');
    const d=s.data;
    for(const kind of ['data','tracked','cheptel']){
      const x=s[kind];keys(x,kind==='data'?dataKeys:envelope,kind);identity(x.account);
      insist(x.storage_schema===1&&x.store===kind&&integer(x.revision)&&object(x.worlds),'Invalid store schema/revision/worlds');
      insist(typeof x.bundle_id==='string'&&/^[A-Za-z0-9_-]+$/.test(x.bundle_id)&&x.bundle_id===d.bundle_id,'Divergent migration bundles');
      insist(sameAccount(x.account,d.account),'Divergent store accounts');
    }
    keys(d.user_data,['preferences','worlds'],'Data user_data');insist(object(d.user_data.worlds),'World user_data required');
    const blank=kind=>({schema:d.schema,schema_version:d.schema_version,account:copy(d.account),document_kind:kind,genetics_order:copy(d.genetics_order),active_world:null,next_world_id:d.next_world_id,worlds:{},user_data:{preferences:{},worlds:{}},transport:{protocol:3,last_command:null},extensions:{lifecycle_revision:1}});
    const active=blank('active'),archive=blank('archive');
    active.active_world=d.active_world;active.user_data.preferences=copy(d.user_data.preferences);active.transport=copy(d.transport);active.extensions=copy(d.extensions);
    if(d.archived_preferences!==undefined)archive.user_data.preferences=copy(d.archived_preferences);
    if(d.archived_transport!==undefined)archive.transport=copy(d.archived_transport);
    if(d.archived_extensions!==undefined)archive.extensions=copy(d.archived_extensions);
    if(d.archived_active_world!==undefined)archive.active_world=d.archived_active_world;
    for(const id of Object.keys(d.user_data.worlds))insist(Object.hasOwn(d.worlds,id),'Orphan world user_data');
    const prospects=new Set();
    for(const [id,x]of Object.entries(d.worlds)){
      insist(/^W-\d+$/.test(id),'Invalid W-ID');
      keys(x,['metadata','next_pet_id','storage_state'],'Data world');insist(['active','archive'].includes(x.storage_state),'Invalid world storage state');
      if(x.metadata?.identity_kind!=='historical'){insist(!prospects.has(x.metadata?.prospect_id),'Duplicate live ProspectID');prospects.add(x.metadata?.prospect_id)}
      const view=x.storage_state==='active'?active:archive;
      const w={metadata:copy(x.metadata),next_pet_id:x.next_pet_id,pets:{},runtime:{pending_gestations:{}}};view.worlds[id]=w;
      insist(Object.hasOwn(d.user_data.worlds,id),'Missing world user_data');view.user_data.worlds[id]=copy(d.user_data.worlds[id]);
      for(const kind of ['tracked','cheptel']){
        const entry=s[kind].worlds[id];if(entry===undefined)continue;
        keys(entry,kind==='tracked'?['pets']:['pets','pending_gestations'],`${kind} world`);insist(object(entry.pets),'Pets object required');
        for(const [petId,p]of Object.entries(entry.pets)){
          insist(new RegExp('^'+id+':P-\\d+$').test(petId),'Invalid BT_ID');
          insist(object(p)&&!Object.hasOwn(w.pets,petId),'Duplicate/invalid pet');
          insist(kind==='tracked'?p.lifecycle_state==='TRACKED':['ACTIVE','ARCHIVED'].includes(p.lifecycle_state),'Wrong pet partition');w.pets[petId]=copy(p);
        }
        if(kind==='cheptel'){insist(object(entry.pending_gestations),'Pending gestations object required');w.runtime.pending_gestations=copy(entry.pending_gestations)}
      }
    }
    for(const kind of ['tracked','cheptel'])for(const id of Object.keys(s[kind].worlds))insist(Object.hasOwn(d.worlds,id),'Orphan pet store world');
    logical(active);logical(archive);return {active,archive};
  }
  const fromSnapshot=x=>{keys(x,['snapshot_schema','account','stores'],'Advisor snapshot');identity(x.account);insist(x.snapshot_schema===1&&sameAccount(x.account,x.stores?.data?.account),'Coherent Advisor snapshot required');return rebuild(x.stores)};
  const storeName=/^BT_(data|TRACKED|Cheptel)_(.+)\.json$/i;
  async function names(directory){const out=new Map();for await(const [name,entry]of directory.entries()){if(entry.kind==='file'){insist(!out.has(name.toLowerCase()),'Ambiguous filenames');out.set(name.toLowerCase(),name)}}return out}
  function pathsFor(tag,files={}){return {data:files.data||`BT_data_${tag}.json`,tracked:files.tracked||`BT_TRACKED_${tag}.json`,cheptel:files.cheptel||`BT_Cheptel_${tag}.json`}}
  async function barrier(directory,tag,files){
    const all=await names(directory),bases=[...Object.values(files),`BT_Cheptel_${tag}_BACKUP.json`,`BreedingTool_${tag}.json`,`BreedingTool_${tag}_Archive.json`];
    for(const path of bases)for(const suffix of ['.btwrite','.btprevious','.bttransfer','.bttransfer.btwrite','.bttransfer.btprevious'])insist(!all.has((path+suffix).toLowerCase()),`Account ${tag}: transaction/recovery pending (${path+suffix})`);
  }
  function parse(text){
    const value=JSON.parse(text),tokens=text.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g);let i=0;
    function walk(depth=0){
      insist(depth<256,'JSON nesting too deep');const token=tokens[i++];
      if(token==='{'){const seen=new Set();while(tokens[i]!=='}'){
        const key=JSON.parse(tokens[i++]);insist(!seen.has(key),'Duplicate JSON field');seen.add(key);i++;walk(depth+1);if(tokens[i]===',')i++;
      }i++}else if(token==='['){while(tokens[i]!==']'){walk(depth+1);if(tokens[i]===',')i++}i++}
    }
    walk();return value;
  }
  async function collect(directory,files){
    const raw={},stores={};
    for(const kind of ['data','tracked','cheptel']){
      try{const entry=await directory.getFileHandle(files[kind]);const file=await entry.getFile();raw[kind]=new Uint8Array(await file.arrayBuffer());const text=new TextDecoder('utf-8',{fatal:true}).decode(raw[kind]);stores[kind]=parse(text)}
      catch(e){throw new Error(`${files[kind]}: store missing, unreadable or invalid (${e.message})`)}
    }
    return {raw,stores};
  }
  const bytesEqual=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const observed=new WeakMap();
  async function read(directory,dataset){
    const tag=dataset.tag||dataset.filename?.match(/^BT_data_(.+)\.json$/i)?.[1];insist(tag,'Select a BT_data account');
    const files=pathsFor(tag,dataset.files);await barrier(directory,tag,files);const first=await collect(directory,files);await barrier(directory,tag,files);const second=await collect(directory,files);await barrier(directory,tag,files);
    for(const kind of ['data','tracked','cheptel'])insist(bytesEqual(first.raw[kind],second.raw[kind]),`Account ${tag}: stores changed during read`);
    const views=rebuild(second.stores),a=views.active.account;
    insist(tagFor(a).toLowerCase()===tag.toLowerCase(),'Filename/account SteamUser divergence');
    if(dataset.account_id)insist(a.steam_id===dataset.account_id,'Dataset account changed');
    let cache=observed.get(directory);if(!cache){cache=new Map();observed.set(directory,cache)}
    const prior=cache.get(a.steam_id);
    if(prior&&prior.stores.data.bundle_id===second.stores.data.bundle_id)for(const kind of ['data','tracked','cheptel']){
      const before=prior.stores[kind],after=second.stores[kind];insist(after.revision>=before.revision,`Account ${tag}: ${kind} revision regressed`);
      insist(after.revision!==before.revision||bytesEqual(prior.raw[kind],second.raw[kind]),`Account ${tag}: ${kind} diverged without revision change`);
    }
    cache.set(a.steam_id,second);return views;
  }
  async function discover(directory){
    const all=await names(directory),groups=new Map();
    for(const filename of all.values()){
      const m=filename.match(storeName);if(!m||m[2].toLowerCase().endsWith('_backup'))continue;
      const kind=m[1].toLowerCase(),tag=m[2],key=tag.toLowerCase();if(!groups.has(key))groups.set(key,{tag,files:{}});groups.get(key).files[kind]=filename;
    }
    const found=[],accounts=new Set();
    for(const {tag,files}of groups.values()){
      insist(['data','tracked','cheptel'].every(k=>files[k]),`Account ${tag}: all three stores required; incomplete set`);
      const item={tag,files,filename:files.data},views=await read(directory,item),a=views.active.account;
      insist(!accounts.has(a.steam_id),'Several datasets belong to the same account');accounts.add(a.steam_id);found.push({...item,account_id:a.steam_id,label:a.steam_user});
    }
    return found.sort((a,b)=>a.label.localeCompare(b.label));
  }
  return {rebuild,logical,read,discover,fromSnapshot,parse};
})();
