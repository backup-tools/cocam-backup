// Runs the dashboard's client script against status payloads with a DOM stub.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'dashboard.ts'), 'utf8');
const html = src.slice(src.indexOf('<!doctype html>'));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ids = new Set([...html.slice(0, html.indexOf('<script>')).matchAll(/id="([\w-]+)"/g)].map(m => m[1]));

// textContent and innerHTML must stay in sync, as they do in a real DOM.
const mkEl = (id) => {
  let text = '', html = '';
  return {
    id, hidden: false, value: '', disabled: false, href: '',
    className: '', style: {}, firstChild: { textContent: '' }, lastChild: { textContent: '' },
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, focus(){}, getBoundingClientRect: () => ({left:0, top:0}),
    clientWidth: 900,
    getContext: () => new Proxy({}, { get: () => () => {} }),
    get textContent() { return text; },
    set textContent(v) { text = String(v); html = String(v); },
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); text = String(v).replace(/<[^>]*>/g, ''); },
  };
};
const els = new Map([...ids].map(i => [i, mkEl(i)]));

let lastStatus = null, failures = [];
global.document = {
  getElementById: (id) => {
    if (!els.has(id)) { failures.push(`getElementById('${id}') -> null`); return null; }
    return els.get(id);
  },
  documentElement: {},
  addEventListener(){},
};
global.window = { devicePixelRatio: 2, matchMedia: () => ({ matches: false }), addEventListener(){} };
global.getComputedStyle = () => ({ getPropertyValue: () => '#000000' });
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = () => {};
global.setTimeout = () => 1;
global.clearTimeout = () => {};
global.confirm = () => false;
global.fetch = () => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(lastStatus)
});

const payloads = {
  'fresh / not connected': {state:'idle',tokenSource:'none',company:'',archive:'cocam-archive/cocam',grid:'',phase:'export',wave:{index:0,total:1,projectsSent:0,projectsTotal:0,newest:'',oldest:''},tasks:{pending:0,running:0,done:0,failed:0},counters:{},skipped:{},recentFailures:[],shards:[],startedAt:null,finishedAt:null,message:'',error:null,hasToken:false},
  'running mid-wave':      {state:'running',tokenSource:'stored',company:'Acme Roofing',archive:'cocam-archive/cocam',grid:'DDD1234..',phase:'export',wave:{index:2,total:5,projectsSent:400,projectsTotal:900,newest:'2026-09-01T00:00:00Z',oldest:'2026-03-01T00:00:00Z'},tasks:{pending:120,running:8,done:400,failed:0},counters:{projects:40,photosDownloaded:1200,bytes:99999999,projectsVerified:0,checklistDetails:12},skipped:{},recentFailures:[],shards:[{id:0,pending:3,state:'running'}],startedAt:Date.now()-60000,finishedAt:null,message:'Wave 2 of 5',error:null,hasToken:true},
  'done, all verified':    {state:'done',tokenSource:'stored',company:'Acme Roofing',archive:'cocam-archive/cocam',grid:'VVVVV',phase:'done',wave:{index:1,total:1,projectsSent:5,projectsTotal:5,newest:'',oldest:''},tasks:{pending:0,running:0,done:60,failed:0},counters:{projects:5,photosDownloaded:200,bytes:12345,projectsVerified:5},skipped:{},recentFailures:[],shards:[],startedAt:1,finishedAt:5000,message:'Backup complete and verified',error:null,hasToken:true},
  'done with problems':    {state:'done',tokenSource:'stored',company:'Acme',archive:'cocam-archive/cocam',grid:'VVXV',phase:'done',wave:{index:1,total:1,projectsSent:4,projectsTotal:4,newest:'',oldest:''},tasks:{pending:0,running:0,done:20,failed:2},counters:{projects:4,photosDownloaded:10,bytes:500,projectsVerified:3,projectsUnverified:1},skipped:{custom_fields:'not permitted by this token'},recentFailures:[{kind:'asset',what:'Photo 1 in job',error:'HTTP 500'}],shards:[],startedAt:1,finishedAt:9000,message:'1 project did not match',error:null,hasToken:true},
  'disconnected after a run': {state:'done',tokenSource:'none',company:'',archive:'cocam-archive/cocam',grid:'VVVV',phase:'done',wave:{index:1,total:1,projectsSent:4,projectsTotal:4,newest:'',oldest:''},tasks:{pending:0,running:0,done:40,failed:0},counters:{projects:4,photosDownloaded:12,bytes:4096,projectsVerified:4},skipped:{},recentFailures:[],shards:[],startedAt:1,finishedAt:5000,message:'All 4 jobs copied and checked against your storage.',error:null,hasToken:false},
  'bad token / error':     {state:'error',tokenSource:'stored',company:'',archive:'cocam-archive/cocam',grid:'',phase:'export',wave:{index:0,total:1,projectsSent:0,projectsTotal:0,newest:'',oldest:''},tasks:{pending:5,running:0,done:1,failed:3},counters:{},skipped:{},recentFailures:[],shards:[],startedAt:1,finishedAt:null,message:'',error:'CompanyCam rejected the API token.',hasToken:true},
};

let fn;
try { fn = new Function(script); } catch (e) { console.log('  SCRIPT DID NOT PARSE:', e.message); process.exit(1); }

(async () => {
  let bad = 0;
  for (const [name, payload] of Object.entries(payloads)) {
    lastStatus = payload; failures = [];
    const errs = [];
    process.on('unhandledRejection', e => errs.push(e));
    try { fn(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); }
    catch (e) { errs.push(e); }
    // Check the page renders sensible text, not just that it did not throw.
    const chip = els.get('connChip').textContent;
    const expectChip = payload.state === 'error' ? 'not working'
      : payload.tokenSource === 'none' ? 'not connected' : 'connected';
    if (chip !== expectChip) failures.push(`connChip is "${chip}", expected "${expectChip}"`);
    if (!els.get('stateText').textContent) failures.push('stateText is empty');
    const btn = els.get('startBtn');
    if (payload.state === 'running') {
      if (!/spin/.test(btn.innerHTML)) failures.push('running: start button has no spinner');
      if (!/Backing up|Checking/.test(btn.innerHTML)) failures.push(`running: button reads "${btn.innerHTML}"`);
      if (btn.disabled !== true) failures.push('running: start button is not disabled');
    } else if (!btn.textContent) failures.push('idle: start button has no label');

    if (payload.tokenSource === 'none' && btn.disabled !== true) {
      failures.push('no key saved, but Start is still clickable');
    }
    if (payload.tokenSource !== 'none' && payload.state !== 'running' && btn.disabled === true) {
      failures.push('connected and idle, but Start is disabled');
    }
    const problems = [...new Set(failures)].concat(errs.map(e => e && e.message));
    if (problems.length) { bad++; console.log(`  ${name.padEnd(22)} FAILED`); problems.forEach(p => console.log('      ' + p)); }
    else console.log(`  ${name.padEnd(22)} renders cleanly`);
  }
  console.log(bad ? `\n  ${bad} payload(s) broke the page` : '\n  every state renders without error');
  process.exit(bad ? 1 : 0);
})();
