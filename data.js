/* V2: the browser never writes BreedingTool.json. Only immutable commands. */
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
  async function submit(directory,world,ops,onWaiting=()=>{}){
    if(!directory)throw new Error('Connect the mod folder first');
    if(!ops.length)return null;
    const permission=await directory.requestPermission({mode:'readwrite'});
    if(permission!=='granted')throw new Error('Folder permission required');
    const id=crypto.randomUUID(),base=`BT-${id}`;
    const command={id,kind:'user_patch',world,ops};
    const write=async(name,text)=>{
      const entry=await directory.getFileHandle(name,{create:true});
      const stream=await entry.createWritable();
      try{await stream.write(text);await stream.close()}catch(e){await stream.abort().catch(()=>{});throw e}
    };
    await write(`${base}.btcmd`,`BT2\n${JSON.stringify(command)}\nEND\n`);
    // A request becomes visible to Lua only after the complete payload is closed.
    await write(`${base}.ready`,'BT2\n');
    onWaiting('Waiting for Lua confirmation…');
    for(let attempt=0;attempt<30;attempt++){
      await new Promise(resolve=>setTimeout(resolve,500));
      let latest;
      try{latest=validate(JSON.parse(await(await(await directory.getFileHandle('BreedingTool.json')).getFile()).text()))}catch{continue}
      const receipt=latest.transport?.receipts?.[id];
      if(!receipt)continue;
      if(receipt.status!=='applied')throw new Error('Concurrent edit: choices retained. Reload the saved choices before retrying.');
      return latest;
    }
    throw new Error('Request queued; no Lua confirmation yet. Refresh to check the saved choices.');
  }
  return {copy,same,validate,project,resolve,diff,submit};
})();
