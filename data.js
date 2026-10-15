/* Lua alone writes account datasets. Browser saves replace one passive mailbox snapshot. */
globalThis.BTData=(()=>{
  const copy=value=>JSON.parse(JSON.stringify(value));
  const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const same=(a,b)=>{
    if(a===b)return true;
    if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));
    if(isObject(a)&&isObject(b))return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
    return false;
  };
  function validate(d){
    if(d?.schema!=='BTPetCensus'||d.schema_version!==4||!isObject(d.worlds)||!isObject(d.user_data?.worlds)
      ||JSON.stringify(d.genetics_order)!=='["V","F","P","R","T","A","I"]')throw new Error('Breeding Tool V4 account dataset required');
    if(d.document_kind!=='active'||typeof d.account?.steam_id!=='string'||!/^\d{17}$/.test(d.account.steam_id)||typeof d.account?.steam_user!=='string'||!d.account.steam_user)throw new Error('Invalid account dataset');
    if(d.active_world!==null&&!d.worlds[d.active_world])throw new Error('Invalid active world');
    const character=d.extensions?.active_character;
    if(character!==undefined&&(!isObject(character)
      ||!(character.name===null||typeof character.name==='string'&&character.name.trim()&&character.name.trim()!=='None')
      ||!(character.slot===null||Number.isInteger(character.slot)&&character.slot>=0)
      ||!(character.mutation_bonus_pct===null||typeof character.mutation_bonus_pct==='number'&&Number.isFinite(character.mutation_bonus_pct))))throw new Error('Invalid active character context');
    for(const w of Object.values(d.worlds)){
      if(!isObject(w.pets)||!isObject(w.runtime?.pending_gestations)||w.runtime.identity_redirects!==undefined)throw new Error('Invalid V4 world');
      for(const p of Object.values(w.pets)){
        if(p.fierce_mutation_bonus_pct!==undefined&&p.fierce_mutation_bonus_pct!==null&&!(typeof p.fierce_mutation_bonus_pct==='number'&&Number.isFinite(p.fierce_mutation_bonus_pct)))throw new Error('Invalid Fierce mutation bonus');
        if(!['TRACKED','ACTIVE','ARCHIVED'].includes(p.lifecycle_state))throw new Error('Invalid lifecycle');
        if(['presence','previous_name','last_seen','field_sources','lifecycle_evidence'].some(k=>k in p))throw new Error('Retired pet fields: amend dataset manually');
      }
    }
    return d;
  }
  function resolve(w,id){
    return id??null;
  }
  function project(d,key){
    validate(d);
    const w=d.worlds[key],u=copy(d.user_data.worlds[key]||{});
    const graph=u.graph||{preferences:{},annotations:{}};
    graph.preferences=w?.storage_state==='archive'?{...graph.preferences}:{...copy(d.user_data.preferences||{}),...graph.preferences};
    graph.annotations=graph.annotations||{};
    const pets=Object.entries(w?.pets||{}).filter(([,p])=>p.lifecycle_state!=='TRACKED').map(([id,p])=>({
      ...p,bt_id:id,runtime_uid:p.current_uid,uid_history:p.uid_history||[],
      historical:p.historical===true||p.lifecycle_state==='ARCHIVED',
      lifecycle_state:p.lifecycle_state,
      mother_bt_id:resolve(w,p.parents?.mother?.bt_id),father_bt_id:resolve(w,p.parents?.father?.bt_id),
      mother:p.parents?.mother?.label||'',father:p.parents?.father?.label||'',
      species_key:p.species_key||p.actor_class||'Unknown',
      genetics:Array.isArray(p.genetics)&&p.genetics.length===7?p.genetics:Array(7).fill(null)
    }));
    return {schema:d.schema,schema_version:2,genetics_order:d.genetics_order,pets,user_data:{graph},
      breeding_panel:{...(u.current_pair?.prediction?{prediction:copy(u.current_pair.prediction)}:{}),female_bt_id:resolve(w,u.current_pair?.female_bt_id),male_bt_id:resolve(w,u.current_pair?.male_bt_id)}};
  }
  function diff(before,after,path=[]){
    const ops=[];
    for(const key of new Set([...Object.keys(before||{}),...Object.keys(after||{})])){
      if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsupported field');
      const had=Object.hasOwn(before||{},key),has=Object.hasOwn(after||{},key),a=before?.[key],b=after?.[key],p=[...path,key];
      if(had&&has&&same(a,b))continue;
      if(has&&isObject(b)&&(!had||isObject(a))){ops.push(...diff(had?a:{},b,p));continue}
      ops.push({path:p,had,before:had?a:null,remove:!has,value:has?b:null});
    }
    return ops;
  }
  const forbidden=new Set(['__proto__','constructor','prototype']);
  const safePath=path=>Array.isArray(path)&&path.length>0&&path.every(key=>typeof key==='string'&&!forbidden.has(key));
  function setPath(root,path,value){
    if(!safePath(path))throw new Error('Unsupported field');
    let node=root;
    for(let i=0;i<path.length-1;i++){
      const key=path[i];
      if(!isObject(node[key]))node[key]={};
      node=node[key];
    }
    node[path.at(-1)]=copy(value);
  }
  function applyPendingOps(root,ops){
    if(!Array.isArray(ops))throw new Error('Invalid pending command');
    for(const op of ops){
      const path=op?.path;
      if(!safePath(path))throw new Error('Invalid pending command');
      let node=root;
      for(let i=0;i<path.length-1;i++){
        const key=path[i];
        if(!isObject(node[key]))node[key]={};
        node=node[key];
      }
      const key=path.at(-1);
      if(op.remove)delete node[key]; else node[key]=copy(op.value);
    }
    return root;
  }
  function overlayPending(document,command){
    const out=copy(validate(document));
    if(command?.account_id!==out.account.steam_id||command?.action!=='user_patch'||!isObject(command.payload)||!Array.isArray(command.payload.ops))return out;
    if(!out.worlds?.[command.payload.world])return out;
    try{applyPendingOps(out.user_data,command.payload.ops)}catch{return out}
    return out;
  }
  async function submit(directory,dataset,world,value,path,onQueued=()=>{},additional=[],character=null){
    if(!directory)throw new Error('Connect the mod folder first');
    if(!safePath(path)||path[0]!=='worlds'||path[1]!==world)throw new Error('Unsupported save target');
    const permission=await directory.requestPermission({mode:'readwrite'});
    if(permission!=='granted')throw new Error('Folder permission required');
    if(!navigator.locks)throw new Error('This browser cannot coordinate saves. Use Chrome or Edge.');
    return navigator.locks.request('breedingtool-mailbox',async()=>{
      const latestDocument=async()=>validate((await BTStores.read(directory,dataset)).active);
      const latest=await latestDocument();
      if(latest.account.steam_id!==dataset.account_id)throw new Error('Dataset account changed');
      if(!latest.worlds[world])throw new Error('Archived World choices cannot be saved by the current Lua mailbox. Draft retained.');
      if(latest.transport?.protocol!==3)throw new Error('Breeding Tool transport protocol 3 required for saving.');
      const mailbox='BreedingTool.command.json';
      const readMailbox=async()=>{
        try{return JSON.parse(await(await(await directory.getFileHandle(mailbox)).getFile()).text())}
        catch(e){if(e.name==='NotFoundError')return null;throw new Error('Mailbox unreadable or being written; try again')}
      };
      const removeMailbox=async()=>{
        try{await directory.removeEntry(mailbox);return true}
        catch(e){if(e.name==='NotFoundError')return true;throw e}
      };
      const existing=await readMailbox();
      if(existing && existing.account_id!==dataset.account_id)throw new Error('Mailbox contains a command for another account. Open that account to apply or cancel it.');
      if(existing && (existing.action!=='user_patch'||existing.payload?.world!==world||!Array.isArray(existing.payload?.ops)))throw new Error('Mailbox contains another pending command');
      const pending=copy(latest.user_data);
      let mergedExisting=false;
      if(existing?.action==='user_patch'&&existing?.payload?.world===world&&Array.isArray(existing?.payload?.ops)&&latest.transport.last_command?.command_id!==existing.command_id){
        for(const op of existing.payload.ops){
          if(!safePath(op.path))throw new Error('Invalid pending command');
          let node=latest.user_data;for(const key of op.path.slice(0,-1))node=node?.[key];
          const had=isObject(node)&&Object.hasOwn(node,op.path.at(-1));
          if(had!==(op.had===true)||had&&!same(node[op.path.at(-1)],op.before))throw new Error('Pending command conflicts with updated choices. Apply or cancel it first.');
        }
        try{applyPendingOps(pending,existing.payload.ops);mergedExisting=true}catch{}
      }
      setPath(pending,path,value);
      for(const extra of additional){if(extra.path[0]!=='worlds'||extra.path[1]!==world)throw Error('Unsupported save target');setPath(pending,extra.path,extra.value)}
      const isPairPath=p=>p?.[0]==='worlds'&&p[1]===world&&p[2]==='current_pair';
      const writesPair=isPairPath(path)||additional.some(e=>isPairPath(e.path));
      const ops=diff(latest.user_data,pending,[]);
      const hasPairOps=ops.some(op=>isPairPath(op.path));
      const expectedCharacter=writesPair?character:existing?.payload?.character;
      if(hasPairOps&&!(isObject(expectedCharacter)&&Number.isInteger(expectedCharacter.slot)&&expectedCharacter.slot>=0&&typeof expectedCharacter.name==='string'&&expectedCharacter.name.trim()&&expectedCharacter.name.trim()!=='None'))throw new Error('Selected Character identity required for Current Pair');
      // A settings-only merge retains the original pair's expected Character.
      // An explicit new selection replaces it with the caller's selected identity.

      if(!ops.length){
        if(mergedExisting||existing&&latest.transport.last_command?.command_id===existing.command_id)await removeMailbox();
        return {queued:false};
      }
      const id=crypto.randomUUID();
      const command={account_id:dataset.account_id,command_id:id,action:'user_patch',payload:{world,ops,...(hasPairOps?{character:copy(expectedCharacter)}:{})}};
      const entry=await directory.getFileHandle(mailbox,{create:true});
      const stream=await entry.createWritable();
      try{await stream.write(JSON.stringify(command));await stream.close()}catch(e){await stream.abort().catch(()=>{});throw e}
      onQueued('Queued ✓ — use Refresh in game to apply');
      return {queued:true,command_id:id};
    });
  }
  async function discover(directory){return BTStores.discover(directory)}
  function consult({active,archive}){
    const out=copy(active);
    for(const [key,w]of Object.entries(out.worlds))w.storage_state='active';
    for(const [key,w]of Object.entries(archive.worlds)){
      out.worlds[key]={...copy(w),storage_state:'archive'};
      out.user_data.worlds[key]=copy(archive.user_data.worlds[key]);
      const graph=out.user_data.worlds[key].graph;
      graph.preferences={...copy(archive.user_data.preferences),...graph.preferences};
    }
    return validate(out);
  }
  async function load(directory,dataset){return consult(await BTStores.read(directory,dataset))}
  function snapshot(text){return consult(BTStores.fromSnapshot(BTStores.parse(text)))}

  async function cancelPending(directory,dataset){
    if(!navigator.locks)throw new Error('This browser cannot coordinate saves');
    return navigator.locks.request('breedingtool-mailbox',async()=>{
      const name='BreedingTool.command.json';
      let c;
      try{c=JSON.parse(await(await(await directory.getFileHandle(name)).getFile()).text())}
      catch(e){if(e.name==='NotFoundError')return;throw e}
      if(c.account_id!==dataset.account_id)throw new Error('Select the account owning this command first');
      await directory.removeEntry(name);
    });
  }
  return {discover,load,snapshot,cancelPending,copy,same,validate,project,resolve,diff,overlayPending,submit};
})();
