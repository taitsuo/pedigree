/* Lua alone writes BreedingTool.json. Browser saves replace one passive mailbox snapshot. */
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
    if(d?.schema!=='BTPetCensus'||d.schema_version!==2||!isObject(d.worlds)||!isObject(d.user_data?.worlds)
      ||JSON.stringify(d.genetics_order)!=='["V","F","P","R","T","A","I"]')throw new Error('Breeding Tool V2 census required');
    if(d.active_world!==null&&!d.worlds[d.active_world])throw new Error('Invalid active world');
    return d;
  }
  function resolve(w,id){
    const seen=new Set();
    while(id&&w?.runtime?.identity_redirects?.[id]&&!seen.has(id)){seen.add(id);id=w.runtime.identity_redirects[id]}
    return id??null;
  }
  function project(d,key){
    validate(d);
    const w=d.worlds[key],u=copy(d.user_data.worlds[key]||{});
    const graph=u.graph||{preferences:{},annotations:{}};
    graph.preferences={...copy(d.user_data.preferences||{}),...graph.preferences};
    graph.annotations=graph.annotations||{};
    for(const [old,id] of Object.entries(w?.runtime?.identity_redirects||{})){
      if(graph.annotations[old]&&!graph.annotations[resolve(w,id)])graph.annotations[resolve(w,id)]=copy(graph.annotations[old]);
    }
    const pets=Object.entries(w?.pets||{}).map(([id,p])=>({
      ...p,bt_id:id,runtime_uid:p.current_uid,uid_history:p.uid_history||[],
      historical:p.historical===true,previous_names:p.previous_name?[p.previous_name]:[],
      present:p.presence==='present'?true:p.presence==='not_observed'?false:null,
      mother_bt_id:resolve(w,p.parents?.mother?.bt_id),father_bt_id:resolve(w,p.parents?.father?.bt_id),
      mother:p.parents?.mother?.label||'',father:p.parents?.father?.label||'',
      species_key:p.species_key||p.actor_class||'Unknown',
      genetics:Array.isArray(p.genetics)&&p.genetics.length===7?p.genetics:Array(7).fill(null)
    }));
    return {schema:d.schema,schema_version:2,genetics_order:d.genetics_order,pets,user_data:{graph},
      breeding_panel:{female_bt_id:resolve(w,u.current_pair?.female_bt_id),male_bt_id:resolve(w,u.current_pair?.male_bt_id)}};
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
    if(command?.action!=='user_patch'||!isObject(command.payload)||!Array.isArray(command.payload.ops))return out;
    if(!out.worlds?.[command.payload.world])return out;
    try{applyPendingOps(out.user_data,command.payload.ops)}catch{return out}
    return out;
  }
  async function submit(directory,world,value,path,onQueued=()=>{}){
    if(!directory)throw new Error('Connect the mod folder first');
    if(!safePath(path)||path[0]!=='worlds'||path[1]!==world)throw new Error('Unsupported save target');
    const permission=await directory.requestPermission({mode:'readwrite'});
    if(permission!=='granted')throw new Error('Folder permission required');
    if(!navigator.locks)throw new Error('This browser cannot coordinate saves. Use Chrome or Edge.');
    return navigator.locks.request('breedingtool-mailbox',async()=>{
      const latestDocument=async()=>validate(JSON.parse(await(await(await directory.getFileHandle('BreedingTool.json')).getFile()).text()));
      const latest=await latestDocument();
      if(latest.transport?.protocol!==2)throw new Error('Breeding Tool Lua 2.1 required for saving.');
      const mailbox='BreedingTool.command.json';
      const readMailbox=async()=>{
        try{return JSON.parse(await(await(await directory.getFileHandle(mailbox)).getFile()).text())}
        catch(e){if(e.name==='NotFoundError')return null;return null}
      };
      const removeMailbox=async()=>{
        try{await directory.removeEntry(mailbox);return true}
        catch(e){if(e.name==='NotFoundError')return true;throw e}
      };
      const existing=await readMailbox();
      const pending=copy(latest.user_data);
      let mergedExisting=false;
      if(existing?.action==='user_patch'&&existing?.payload?.world===world&&Array.isArray(existing?.payload?.ops)){
        try{applyPendingOps(pending,existing.payload.ops);mergedExisting=true}catch{}
      }
      setPath(pending,path,value);
      const ops=diff(latest.user_data,pending,[]);
      if(!ops.length){
        if(mergedExisting||existing&&!existing.payload)await removeMailbox();
        return {queued:false};
      }
      const id=crypto.randomUUID();
      const command={command_id:id,action:'user_patch',payload:{world,ops}};
      const entry=await directory.getFileHandle(mailbox,{create:true});
      const stream=await entry.createWritable();
      try{await stream.write(JSON.stringify(command));await stream.close()}catch(e){await stream.abort().catch(()=>{});throw e}
      onQueued('Queued ✓ — use Refresh in game to apply');
      return {queued:true,command_id:id};
    });
  }
  return {copy,same,validate,project,resolve,diff,overlayPending,submit};
})();
