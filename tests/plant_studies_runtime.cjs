/* Executes the actual UI functions in a deterministic DOM/network harness.
   The hook is injected into the VM only; production has no test-only API. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

function harness(filename) {
  const nodes = new Map(), requests = [], downloads = [], alerts = [], reports = [];
  let inputs = [], paintCalls = 0;
  class Element {
    constructor(id) { this.id=id; this.value=''; this.listeners={}; this.classList={add(){},remove(){}}; this._html=''; }
    addEventListener(type, fn) { this.listeners[type]=fn; }
    set innerHTML(text) {
      this._html=text;
      if(this.id==='ps-form') {
        inputs.forEach(e=>nodes.delete(e.id)); inputs=[];
        for(const match of text.matchAll(/<input id="([^"]+)"[^>]*value="([^"]*)"/g)) {
          const e=new Element(match[1]); e.value=match[2]; nodes.set(e.id,e); inputs.push(e);
        }
      }
    }
    get innerHTML() { return this._html; }
    click() { if(this.download) downloads.push({name:this.download,blob:this.href.blob}); }
  }
  ['ps-form','ps-results','ps-title','ps-class','ps-engine','ps-earthing-status','ps-cleaning-status','pe-run','pc-run'].forEach(id=>nodes.set(id,new Element(id)));
  const document={readyState:'loading',addEventListener(){},getElementById:id=>nodes.get(id)||null,
    querySelectorAll:sel=>sel==='#ps-form input'?inputs:[],createElement:tag=>new Element(tag)};
  const window={open(){const r={text:'',prints:0};reports.push(r);return {document:{write:t=>r.text=t,close(){}},print:()=>r.prints++};}};
  const S={sc:'plant-A',projName:'Plant A',p:{tlen:40},hull:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],
    motors:[{id:'table-A',x:20,y:20,z:0,len:40,az:0,pb:'block-A'}],ncus:[{id:'NCU-A',x:0,y:0}],rsus:[],reps:[]};
  const ctx=new Proxy({}, {get:()=>()=>{paintCalls++;},set:()=>true});
  const sandbox={window,document,S,console,Blob,ctx,DPR:1,draw(){},w2s:p=>p,
    localStorage:{getItem:()=>null,setItem(){}},prompt:()=>null,alert:m=>alerts.push(m),
    URL:{createObjectURL:blob=>({blob}),revokeObjectURL(){}},setTimeout:fn=>fn(),
    fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,payload:JSON.parse(options.body),resolve,reject}))};
  let source=fs.readFileSync(filename,'utf8');
  assert.match(source,/\}\)\(\);\s*$/);
  source=source.replace(/\}\)\(\);\s*$/,`window.__studyTest={runEarthing,runCleaning,downloadBoq,downloadDxf,downloadJson,printReport,downloadCombinedBoq,paint,fmt};\n})();`);
  vm.runInNewContext(source,sandbox,{filename});
  const api=window.PlantStudies, hook=window.__studyTest;
  api.state.modal=new Element('ps-modal');api.state.body=nodes.get('ps-results');api.state.engineOk=true;
  const open=kind=>kind==='earthing'?api.openEarthing():api.openCleaning();
  const run=kind=>kind==='earthing'?hook.runEarthing():hook.runCleaning();
  const edit=(id,value)=>{const e=nodes.get(id);assert.ok(e,`field ${id}`);e.value=String(value);if(e.listeners.input)e.listeners.input({target:e});};
  const response=(index,marker)=>requests[index].resolve({ok:true,json:async()=>({status:'OK',fingerprint:'sha256:'+'a'.repeat(64),results:{marker,robot_count:1},
    gaps:[{gap_id:'g1',state:'BRIDGE_CANDIDATE',from_id:'a',to_id:'b',gap_m:1}],
    boq:[{code:marker,quantity:1,unit:'ea'}],overlay:{lines:[{start:{x:0,y:0},end:{x:1,y:1}}]},warnings:[]})});
  const complete=async(kind,marker='one')=>{open(kind);const p=run(kind);response(requests.length-1,marker);await p;};
  return {S,api,hook,open,run,edit,response,complete,requests,nodes,downloads,alerts,reports,paintCalls:()=>paintCalls};
}

module.exports=async function runRuntimeSuite(filename=path.join(__dirname,'..','plant_studies.js')) {
  const failures=[];let n=0;
  async function check(name,fn) {
    n++;let timer;
    try {
      await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Unresolved async operation')),2000);})]);
      console.log('OK runtime: '+name);
    } catch(e) {failures.push(name+': '+e.message);console.error('MAL runtime: '+name+' — '+e.message);}
    finally {clearTimeout(timer);}
  }
  for(const kind of ['earthing','cleaning']) {
    await check(kind+' stores the submitted geometry, not geometry at response time',async()=>{
      const h=harness(filename);h.open(kind);const p=h.run(kind);
      if(kind==='earthing')h.S.hull[1].x+=7;else h.S.motors[0].x+=7;
      h.response(0,'old');await p;
      assert.equal(h.api.isStale(kind,true),true);
      assert.equal(h.api.currentBoq().length,0);
    });
    await check(kind+' preserves edits made while awaiting the engine',async()=>{
      const h=harness(filename);h.open(kind);const p=h.run(kind);
      h.edit(kind==='earthing'?'pe-rho':'pc-bridge',12);
      h.response(0,'old');await p;assert.equal(h.api.isStale(kind,true),true);
    });
    await check(kind+' ignores an older response after a newer run completed',async()=>{
      const h=harness(filename);h.open(kind);const p1=h.run(kind),p2=h.run(kind);
      h.response(1,'new');await p2;h.response(0,'old');await p1;
      assert.equal(h.api.state[kind].result.results.marker,'new');
    });
    await check(kind+' ignores errors from superseded requests',async()=>{
      const h=harness(filename);h.open(kind);const p1=h.run(kind),p2=h.run(kind);
      h.response(1,'new');await p2;const html=h.nodes.get('ps-results').innerHTML;
      h.requests[0].reject(new Error('obsolete failure'));await p1;
      assert.equal(h.nodes.get('ps-results').innerHTML,html);
    });
    await check(kind+' invalidates same-geometry results after changing plant',async()=>{
      const h=harness(filename);await h.complete(kind);h.S.sc='plant-B';
      assert.equal(h.api.isStale(kind,true),true);
    });
    await check(kind+' invalidates after changing the engine endpoint',async()=>{
      const h=harness(filename);await h.complete(kind);h.api.state.api='http://other-engine:8765';
      assert.equal(h.api.isStale(kind,true),true);
    });
    await check(kind+' never gives a result without a snapshot current status',async()=>{
      const h=harness(filename);await h.complete(kind);h.api.state[kind].uiSig=null;
      assert.equal(h.api.isStale(kind,true),true);
    });
    await check(kind+' rejects stale DXF, CSV and report and labels historical JSON',async()=>{
      const h=harness(filename);await h.complete(kind);h.api.state[kind].dirty=true;
      h.hook.downloadBoq(kind);h.hook.downloadDxf(kind);h.hook.printReport(kind);
      assert.equal(h.downloads.length,0);assert.equal(h.reports.length,0);assert.equal(h.alerts.length,3);
      h.hook.downloadJson(kind);assert.equal(h.downloads.length,1);
      const j=JSON.parse(await h.downloads[0].blob.text());assert.equal(j.validity,'STALE');
      assert.equal(j.result.status,'OK');assert.equal(h.api.state[kind].result.status,'OK');
      assert.match(h.downloads[0].name,/_STALE\.json$/);
    });
    await check(kind+' a successful recalculation becomes current again',async()=>{
      const h=harness(filename);await h.complete(kind);h.edit(kind==='earthing'?'pe-rho':'pc-bridge',14);
      assert.equal(h.api.isStale(kind,true),true);const p=h.run(kind);h.response(1,'new');await p;
      assert.equal(h.api.isStale(kind,true),false);assert.equal(h.api.currentBoq()[0].code,'new');
    });
  }
  for(const revision of ['layout_revision','terrain_revision','tracker_model_revision','electrical_revision']) {
    await check('explicit '+revision+' is forwarded and invalidates both studies',async()=>{
      const h=harness(filename);h.S.source_revisions={[revision]:'r1'};
      await h.complete('earthing');await h.complete('cleaning');
      assert.equal(h.requests[0].payload.source_revisions[revision],'r1');
      h.S.source_revisions[revision]='r2';
      assert.equal(h.api.isStale('earthing',true),true);assert.equal(h.api.isStale('cleaning',true),true);
    });
  }
  await check('a scene name is not fabricated into a geometry revision',async()=>{
    const h=harness(filename);await h.complete('earthing');assert.equal(h.requests[0].payload.geometry_revision,null);
    h.S.layout_revision='layout-2';await h.complete('earthing');assert.equal(h.requests[1].payload.geometry_revision,'layout-2');
  });
  await check('late earthing response does not repaint an open cleaning form',async()=>{
    const h=harness(filename);h.open('earthing');const p=h.run('earthing');h.open('cleaning');
    const body=h.nodes.get('ps-results').innerHTML;h.response(0,'earth');await p;
    assert.equal(h.nodes.get('ps-results').innerHTML,body);assert.equal(h.api.state.activeOverlay,null);
  });
  await check('different study requests do not cancel one another',async()=>{
    const h=harness(filename);h.open('earthing');const pe=h.run('earthing');h.open('cleaning');const pc=h.run('cleaning');
    h.response(1,'clean');await pc;h.response(0,'earth');await pe;
    assert.equal(h.api.state.earthing.result.results.marker,'earth');assert.equal(h.api.state.cleaning.result.results.marker,'clean');
  });
  await check('empty required numeric input is not silently converted to zero',async()=>{
    const h=harness(filename);h.open('earthing');h.edit('pe-rho','');await h.run('earthing');assert.equal(h.requests.length,0);
  });
  await check('unknown numeric results are not displayed as measured zero',async()=>{
    const h=harness(filename);assert.equal(h.hook.fmt(null),'—');assert.equal(h.hook.fmt(''),'—');assert.equal(h.hook.fmt(0),'0');
  });
  await check('combined BoQ cannot silently export a partial total',async()=>{
    const h=harness(filename);await h.complete('earthing');await h.complete('cleaning');h.api.state.earthing.dirty=true;
    h.hook.downloadCombinedBoq();assert.equal(h.downloads.length,0);assert.equal(h.alerts.length,1);
  });
  await check('an overlay is withheld immediately, without a 750 ms cache window',async()=>{
    const h=harness(filename);await h.complete('cleaning');h.api.isStale('cleaning');h.S.motors[0].x+=1;
    h.hook.paint();assert.equal(h.paintCalls(),0);
  });
  await check('bridge approval survives a rerun of unchanged geometry/model',async()=>{
    const h=harness(filename);await h.complete('cleaning');h.api.state.cleaning.approved.add('g1');
    const p=h.run('cleaning');assert.deepEqual(h.requests[1].payload.inputs.approved_bridge_ids,['g1']);h.response(1,'approved');await p;
    assert.equal(h.api.isStale('cleaning',true),false);
  });
  await check('old bridge approval is removed when the geometry changes',async()=>{
    const h=harness(filename);await h.complete('cleaning');h.api.state.cleaning.approved.add('g1');h.S.motors[0].x+=2;
    const p=h.run('cleaning');assert.deepEqual(h.requests[1].payload.inputs.approved_bridge_ids,[]);h.response(1,'recheck');await p;
  });
  await check('old bridge approval is removed when robot capability changes',async()=>{
    const h=harness(filename);await h.complete('cleaning');h.api.state.cleaning.approved.add('g1');h.edit('pc-bridge',3);
    const p=h.run('cleaning');assert.deepEqual(h.requests[1].payload.inputs.approved_bridge_ids,[]);h.response(1,'recheck');await p;
  });
  await check('current JSON exports include the exact source snapshot',async()=>{
    const h=harness(filename);await h.complete('cleaning');h.hook.downloadJson('cleaning');
    const j=JSON.parse(await h.downloads[0].blob.text());assert.equal(j.validity,'CURRENT_SESSION');
    assert.deepEqual(j.source_snapshot,h.requests[0].payload);assert.equal(j.source_context.scene,'plant-A');
  });
  if(failures.length)throw new Error(`${failures.length}/${n} runtime checks failed:\n`+failures.join('\n'));
  return n;
};
