export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CoCam Backup</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #fff; --line: #e3e6ea; --text: #16191d;
    --muted: #666f7a; --accent: #1f6feb; --ok: #17803d; --warn: #b45309; --err: #b42318;
    --cell-q: #ffffff; --cell-edge: #b9c0c9; --cell-w: #e8a723;
    --cell-d: #8dc63f; --cell-v: #17803d; --cell-x: #d64545;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1216; --panel: #171b21; --line: #272d36; --text: #e8eaed;
      --muted: #98a2b0; --accent: #4c8dff; --ok: #3fb950; --warn: #d29922; --err: #f85149;
      --cell-q: #1b2029; --cell-edge: #3a434f; --cell-w: #d29922;
      --cell-d: #a3d15b; --cell-v: #3fb950; --cell-x: #f85149;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 20px 14px; background: var(--bg); color: var(--text);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 1060px; margin: 0 auto; }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px;
          gap: 16px; align-items: start; }
  .col-main, .col-side { min-width: 0; }
  .card.side { font-size: 12.5px; }
  .card.side .body { font-size: 12.5px; color: var(--muted); }
  .card.side h2 { font-size: 14px; }
  @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
  h1 { font-size: 19px; margin: 0 0 3px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); margin: 0 0 16px; font-size: 13px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  label { display: block; font-weight: 600; font-size: 12.5px; margin-bottom: 5px; }
  input[type=password], input[type=text] {
    width: 100%; padding: 8px 10px; border-radius: 7px; border: 1px solid var(--line);
    background: var(--bg); color: var(--text); font-size: 14px; font-family: inherit;
  }
  .hint { color: var(--muted); font-size: 12px; margin-top: 5px; }
  .row { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 12px; }
  .row.actions { justify-content: flex-end; }
  .hint.right { text-align: right; }
  button.primary:disabled { opacity: 1; background: var(--accent); border-color: var(--accent); }
  .spin { width: 12px; height: 12px; margin-right: 7px; display: inline-block;
          vertical-align: -1px; border-radius: 50%; border: 2px solid rgba(255,255,255,.45);
          border-top-color: #fff; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
  button {
    padding: 7px 13px; border-radius: 7px; border: 1px solid var(--line);
    background: var(--panel); color: var(--text); font-size: 14px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .state { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; font-size: 14px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .dot.running { background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
  .dot.done { background: var(--ok); }
  .dot.error { background: var(--err); }
  .dot.paused { background: var(--warn); }
  @keyframes pulse { 50% { opacity: .3; } }
  @media (prefers-reduced-motion: reduce) { .dot.running { animation: none; } }
  .bar { height: 8px; border-radius: 5px; background: var(--line); overflow: hidden; margin: 10px 0 8px; }
  .bar > i { display: block; height: 100%; background: var(--accent); width: 0; transition: width .4s ease; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(78px, 1fr)); gap: 7px; margin-top: 12px; }
  .heroRow { display: flex; gap: 30px; flex-wrap: wrap; padding: 4px 0; }
  .hero b { display: block; font-size: 22px; letter-spacing: -0.02em;
            font-variant-numeric: tabular-nums; line-height: 1.15; }
  .hero span { color: var(--muted); font-size: 11.5px; }
  .kvRow { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 14px;
           padding-top: 12px; border-top: 1px solid var(--line);
           font-size: 12px; font-variant-numeric: tabular-nums; }
  .kvRow:empty { display: none; }
  .kv i { font-style: normal; color: var(--muted); margin-right: 5px; }
  .cardhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .cardhead h2 { margin: 0; }
  .cardhead { margin-bottom: 2px; }
  .chip { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
          border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
  .chip.ok { color: var(--ok); border-color: var(--ok); }
  .chip.bad { color: var(--err); border-color: var(--err); }
  .connline { display: flex; align-items: center; justify-content: space-between;
              gap: 10px; margin-top: 10px; font-size: 13px; }
  #connForm label { margin-top: 16px; }
  #connForm .inline { margin-bottom: 4px; }
  #connForm input { padding: 11px 12px; font-size: 15px; }
  .stat { border: 1px solid var(--line); border-radius: 7px; padding: 6px 8px; }
  .stat b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .stat span { color: var(--muted); font-size: 11px; }
  .msg { color: var(--muted); font-size: 12.5px; margin-top: 7px; }
  .err { color: var(--err); font-size: 13.5px; margin-top: 10px; word-break: break-word; }
  details { margin-top: 14px; }
  summary { cursor: pointer; font-size: 13px; color: var(--muted); }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px;
        overflow: auto; font-size: 12px; max-height: 240px; margin-top: 10px; }
  .hidden { display: none; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  .steps { margin: 12px 0 8px; padding-left: 20px; color: var(--text); font-size: 14px; }
  .steps li { margin-bottom: 5px; }
  code { background: var(--bg); border: 1px solid var(--line); border-radius: 4px;
         padding: 1px 5px; font-size: 12.5px; }
  .dot.warn { background: var(--warn); }
  .state.warn { color: var(--warn); }
  .state.bad { color: var(--err); }
  .fail { border-top: 1px solid var(--line); padding: 8px 0; font-size: 13px; }
  .fail:first-child { border-top: 0; }
  .fail b { display: block; font-weight: 600; }
  .fail span { color: var(--muted); }
  details.logs { padding: 10px 16px; }
  details.logs > summary { cursor: pointer; font-size: 13px; color: var(--muted);
                           font-weight: 600; list-style: none; display: flex;
                           align-items: center; gap: 8px; }
  details.logs > summary::-webkit-details-marker { display: none; }
  details.logs > summary::before { content: '\25B8'; font-size: 15px; line-height: 1;
                                   color: var(--muted); transition: transform .15s ease;
                                   transform-origin: 45% 50%; }
  details.logs[open] > summary::before { transform: rotate(90deg); }
  details.logs > summary:hover { color: var(--text); }
  details.logs > summary:hover::before { color: var(--text); }
  @media (prefers-reduced-motion: reduce) {
    details.logs > summary::before { transition: none; }
  }
  .logtext { margin: 10px 0 0; max-height: 200px; overflow: auto; white-space: pre-wrap;
             word-break: break-word; background: var(--bg); border: 1px solid var(--line);
             border-radius: 7px; padding: 10px 12px; color: var(--muted);
             font: 11.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .pagehead { display: flex; align-items: flex-start; justify-content: space-between;
              gap: 14px; flex-wrap: wrap; }
  .statpill { display: inline-flex; align-items: center; gap: 9px; white-space: nowrap;
              border: 1px solid var(--line); background: var(--panel); border-radius: 999px;
              padding: 5px 13px; font-size: 12px; color: var(--muted);
              font-variant-numeric: tabular-nums; margin-top: 3px; }
  .statpill b { color: var(--text); font-weight: 600; }
  .statpill:empty { display: none; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
            font-size: 11.5px; color: var(--muted); margin: 0 0 8px;
            font-variant-numeric: tabular-nums; }
  #gridHost { position: relative; background: var(--bg); border: 1px solid var(--line);
              border-radius: 8px; padding: 16px; margin: 12px 0 14px; min-height: 48px; }
  #grid { cursor: crosshair; }
  .tip { position: absolute; z-index: 5; pointer-events: none; max-width: 260px;
         background: var(--text); color: var(--panel); font-size: 12px; line-height: 1.35;
         padding: 6px 8px; border-radius: 6px; transform: translate(-50%, -100%);
         white-space: normal; overflow-wrap: anywhere; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
  .tip b { display: block; font-weight: 600; }
  .conn { display: flex; align-items: center; gap: 6px; font-size: 13px;
          font-weight: 600; margin: 0 0 10px; }
  .conn .dot { width: 9px; height: 9px; }
  .conn.ok { color: var(--ok); } .conn.ok .dot { background: var(--ok); }
  .conn.no { color: var(--muted); } .conn.no .dot { background: var(--muted); }
  .conn.bad { color: var(--err); } .conn.bad .dot { background: var(--err); }
  .inline { display: flex; gap: 8px; }
  .inline input { flex: 1 1 auto; min-width: 0; }
  .linkish { background: none; border: 0; padding: 0; font: inherit; font-size: 12.5px;
             color: var(--accent); cursor: pointer; text-decoration: underline; }
  h3 { font-size: 13px; margin: 14px 0 5px; }
  .body { font-size: 13px; margin: 0 0 9px; }
  .btnlink { display: inline-block; padding: 7px 13px; border-radius: 8px;
             background: var(--accent); color: #fff; text-decoration: none;
             font-weight: 600; font-size: 14px; }
  .tree { margin: 0; font-size: 12.5px; }
  .tree dt { margin-top: 10px; }
  .tree dd { margin: 2px 0 0 0; color: var(--muted); }
  .tip span { opacity: .75; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend-eta { color: var(--muted); font-weight: 600; font-size: 12px; }
  .sw { width: 9px; height: 9px; border-radius: 50%; display: inline-block;
        border: 1px solid var(--line); }
  .sw-q { background: var(--cell-q); border-color: var(--cell-edge); }
  .sw-w { background: var(--cell-w); border-color: var(--cell-w); }
  .sw-d { background: var(--cell-d); border-color: var(--cell-d); }
  .sw-v { background: var(--cell-v); border-color: var(--cell-v); }
  .sw-x { background: var(--cell-x); border-color: var(--cell-x); }
  #grid { width: 100%; display: block; }
</style>
</head>
<body>
<div class="wrap">
  <div class="pagehead">
    <div>
      <h1>CoCam Backup</h1>
      <p class="sub">Back up your work.</p>
    </div>
    <span class="statpill hidden" id="statPill"></span>
  </div>

  <div id="loginCard" class="card hidden">
    <label for="pw">Dashboard password</label>
    <input id="pw" type="password" autocomplete="current-password" placeholder="The password you set at deploy">
    <div class="row"><button class="primary" id="loginBtn">Unlock</button></div>
    <div class="err" id="loginErr"></div>
  </div>

  <div id="setupCard" class="card hidden">
    <h2>One more step</h2>
    <p class="msg" id="setupMsg"></p>
    <ol class="steps">
      <li>Open this Worker in the Cloudflare dashboard.</li>
      <li>Go to <b>Settings &rsaquo; Variables and Secrets</b>.</li>
      <li>Add a secret named <code>DASHBOARD_PASSWORD</code> with any password you choose.</li>
      <li>Deploy, then reload this page.</li>
    </ol>
    <p class="hint">This password is what stops anyone who finds this URL from reading your CompanyCam data or starting a backup.</p>
  </div>

  <div id="main" class="hidden">
    <div class="cols">
      <div class="col-main">
      <div class="card" id="tokenCard">
        <div class="cardhead">
          <h2>Connect to CompanyCam</h2>
          <span class="chip" id="connChip">checking&hellip;</span>
        </div>

        <div id="connDone" class="hidden">
          <div class="connline"><span id="connWho">Connected</span><button class="linkish" id="forgetToken">Disconnect</button></div>
        </div>

        <div id="connForm">
          <label for="token">Paste your CompanyCam API key</label>
          <div class="inline">
            <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the key here">
            <button class="primary" id="saveToken">Save</button>
          </div>
          <div class="msg" id="tokenMsg"></div>
          <p class="hint">In CompanyCam on a computer: <b>Integrations &rsaquo; Access Tokens &rsaquo; New Personal Access Token</b>. Admin or Manager; read access is enough.</p>
        </div>
      </div>

      <div class="card">
        <h2>Back up your jobs</h2>
        <div class="state" id="state" role="status" aria-live="polite"><i class="dot" id="dot"></i><span id="stateText">Loading…</span></div>
        <div class="bar"><i id="barFill"></i></div>
        <div class="msg" id="msg"></div>
        <div class="msg" id="eta"></div>
        <div class="err" id="err"></div>

        <div class="row actions">
          <button id="resetBtn">Reset</button>
          <button id="retryBtn">Retry failed</button>
          <button id="pauseBtn">Pause</button>
          <button class="primary" id="startBtn">Start backup</button>
        </div>
        <div class="hint right" id="needKey"></div>
        <div class="hint right">Running again only fetches what is new. Nothing is ever deleted.</div>

      </div>

      <div class="card hidden" id="gridWrap">
        <div class="cardhead">
          <h2>Your jobs</h2>
          <span class="legend-eta" id="gridEta"></span>
        </div>
        <div id="gridHost">
          <canvas id="grid" height="200"></canvas>
          <div id="tip" class="tip" hidden></div>
        </div>
        <div class="legend" id="legend">
          <span><i class="sw sw-q"></i>waiting</span>
          <span><i class="sw sw-w"></i>copying</span>
          <span><i class="sw sw-d"></i>copied</span>
          <span><i class="sw sw-v"></i>verified</span>
          <span><i class="sw sw-x"></i>problem</span>
        </div>
        <div class="hint" id="gridNote"></div>
      </div>

      <details class="card logs" id="logs" open>
        <summary id="logsSummary">Details</summary>
        <pre class="logtext" id="logText"></pre>
      </details>
      </div>

      <aside class="col-side">
      <div class="card side">
        <h2>How this works</h2>
        <p class="body"><b>Start backup</b> spins up a fleet of workers on Cloudflare. Nothing runs on your phone or computer.</p>
        <p class="body">They fetch your job list from CompanyCam, newest first, and copy jobs <b>in parallel</b> &mdash; around eighty photos moving at once &mdash; straight into your own storage.</p>
        <p class="body">Stop whenever you like. Starting again picks up where it left off and skips whatever is already saved.</p>
        <p class="body">At the end it re-reads your storage and checks every job really landed.</p>
      </div>

<div class="card side" id="whereCard">
        <h2>Where your photos go</h2>
        <p class="body">Into your own Cloudflare R2 storage. Nobody else can see it, and this tool never deletes anything.</p>
        <p><a id="bucketLink" class="btnlink" href="#" target="_blank" rel="noopener">Open my backup &rarr;</a></p>
        <p class="hint">Sign in, then look for the bucket <code id="bucketName">&nbsp;</code>.</p>
        <dl class="tree">
          <dt><code>projects/</code></dt><dd>One folder per job.</dd>
          <dt><code>&hellip;/photos/</code></dt><dd>Full-size originals. A marked-up photo is also saved as <code>-annotated</code>.</dd>
          <dt><code>&hellip;/*.json</code></dt><dd>Job details, checklists, comments, tasks.</dd>
          <dt><code>_account/</code></dt><dd>Your people, tags, labels and customers.</dd>
          <dt><code>_report.json</code></dt><dd>What the last run did.</dd>
        </dl>
        <p class="hint">Click a file to preview it, then Download. For everything at once, use <a href="https://rclone.org/s3/#cloudflare-r2" target="_blank" rel="noopener">rclone</a>.</p>
      </div>
      </aside>
    </div>
  </div>
</div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var timer = null;

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(readJson);
  }

  function readJson(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { ok: res.ok, status: res.status, data: data };
    });
  }

  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  function num(n) { return (n || 0).toLocaleString(); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  var tokenOpen = false;

  function bytes(n) {
    if (!n) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }

  var rate = null, lastSample = null;

  function updateRate(done, running) {
    var now = Date.now();
    if (lastSample && running) {
      var dt = (now - lastSample.t) / 1000;
      if (dt >= 1 && done >= lastSample.done) {
        var inst = (done - lastSample.done) / dt;
        rate = rate === null ? inst : rate * 0.7 + inst * 0.3;
      }
    }
    if (!running) rate = null;
    lastSample = { t: now, done: done };
  }

  function duration(sec) {
    if (!isFinite(sec) || sec <= 0) return '';
    if (sec < 60) return Math.round(sec) + ' sec';
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    return m + ' min';
  }

  var MAX_CELLS = 1500;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* Collapses more projects than can be drawn into one cell each, keeping the
     worst state so the grid never overstates progress. */
  function bucket(chars, max) {
    if (chars.length <= max) return chars;
    var per = Math.ceil(chars.length / max), out = [];
    for (var i = 0; i < chars.length; i += per) {
      var slice = chars.slice(i, i + per);
      var worst = null, sum = 0, digits = 0, allV = true, allDone = true;
      for (var j = 0; j < slice.length; j++) {
        var ch = slice[j];
        if (ch === 'X') worst = 'X';
        if (ch !== 'V') allV = false;
        if (ch !== 'V' && ch !== 'D') allDone = false;
        if (ch >= '1' && ch <= '9') { sum += +ch; digits++; }
        if (ch === '.') allDone = false;
      }
      out.push(worst ? 'X' : allV ? 'V' : allDone ? 'D'
        : digits ? String(Math.max(1, Math.min(9, Math.round(sum / digits)))) : '.');
    }
    return out;
  }

  var names = null, namesFor = -1, geom = null;
  var paint = null, pulseReq = null;

  var noMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function startPulse() {
    if (pulseReq !== null || noMotion) return;
    var step = function () {
      if (!paint || !paint()) { pulseReq = null; return; }
      pulseReq = requestAnimationFrame(step);
    };
    pulseReq = requestAnimationFrame(step);
  }

  function stopPulse() {
    if (pulseReq !== null) { cancelAnimationFrame(pulseReq); pulseReq = null; }
  }

  function ensureNames(count) {
    if (namesFor === count) return;
    namesFor = count;
    fetch('/api/projects', { cache: 'no-store' }).then(readJson).then(function (r) {
      if (r.ok && r.data && r.data.names) names = r.data.names;
    }).catch(function () { /* labels are a nicety, never block the grid */ });
  }

  function drawGrid(grid, phase, wave) {
    var wrap = $('gridWrap');
    if (!grid) { wrap.classList.add('hidden'); stopPulse(); return; }
    wrap.classList.remove('hidden');

    var raw = grid.split('');
    var cells = bucket(raw, MAX_CELLS);
    var per = Math.ceil(raw.length / cells.length);
    var note = 'Newest first, left to right · ' + raw.length.toLocaleString()
      + (raw.length === 1 ? ' job' : ' jobs')
      + (per > 1 ? ' · each square is ' + per + ' jobs' : '');
    if (wave && wave.total > 1 && phase === 'export') {
      note += ' · wave ' + wave.index + ' of ' + wave.total;
    }
    $('gridNote').textContent = note;

    var cv = $('grid');
    var W = cv.clientWidth || 640;
    // Keep squares readable when there are only a few.
    var minSize = cells.length <= 40 ? 15 : 3;
    var gap = 3, size = 15, cols, rows;
    while (size > minSize) {
      cols = Math.max(1, Math.floor((W + gap) / (size + gap)));
      rows = Math.ceil(cells.length / cols);
      if (rows * (size + gap) <= 220) break;
      size--;
    }
    cols = Math.max(1, Math.floor((W + gap) / (size + gap)));
    rows = Math.ceil(cells.length / cols);

    var dpr = window.devicePixelRatio || 1;
    var H = Math.max(size + gap, rows * (size + gap));
    cv.style.height = H + 'px';
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var C = {
      q: cssVar('--cell-q'), edge: cssVar('--cell-edge'), w: cssVar('--cell-w'),
      d: cssVar('--cell-d'), v: cssVar('--cell-v'), x: cssVar('--cell-x')
    };

    geom = { size: size, gap: gap, cols: cols, count: cells.length, per: per, cells: cells };
    ensureNames(raw.length);

    paint = function () {
      ctx.clearRect(0, 0, W, H);
      var pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(Date.now() / 320));
      var busy = false;
      for (var i = 0; i < cells.length; i++) {
        var ch = cells[i];
        var x = (i % cols) * (size + gap), y = Math.floor(i / cols) * (size + gap);
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.q;
        ctx.fillRect(x, y, size, size);
        var fill = null, frac = 1, blink = false;
        if (ch === 'X') fill = C.x;
        else if (ch === 'V') fill = C.v;
        else if (ch === 'D') fill = C.d;
        else if (ch >= '1' && ch <= '9') { fill = C.w; frac = (+ch) / 9; blink = true; busy = true; }
        if (fill) {
          var h = Math.max(2, Math.round(size * frac));
          ctx.globalAlpha = (blink && !noMotion) ? pulse : 1;
          ctx.fillStyle = fill;
          ctx.fillRect(x, y + (size - h), size, h);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = C.edge;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      }
      return busy;
    };
    if (paint()) startPulse(); else stopPulse();
  }

  var lastStatus = null;

  function render(s) {
    lastStatus = s;
    var c = s.counters || {};
    var t = s.tasks || {};
    // Progress is measured in projects finished, not tasks.
    var g = s.grid || '', pct;
    if (g.length) {
      var doneCells = 0;
      for (var gi = 0; gi < g.length; gi++) {
        var gc = g[gi];
        if (gc === 'D' || gc === 'V' || gc === 'X') doneCells++;
      }
      pct = Math.round((doneCells / g.length) * 100);
    } else {
      var total = (t.done || 0) + (t.pending || 0) + (t.running || 0) + (t.failed || 0);
      pct = total > 0 ? Math.round(((t.done || 0) / total) * 100) : 0;
    }
    if (s.state === 'done') pct = 100;
    var running = s.state === 'running';
    var connected = s.tokenSource !== 'none';
    // Problems are failed tasks plus projects that did not match the bucket.
    var problems = (t.failed || 0) + (c.projectsUnverified || 0);
    var incomplete = s.state === 'done' && problems > 0;

    updateRate(t.done || 0, running);

    var tone = incomplete ? 'warn' : s.state;
    $('dot').className = 'dot ' + (incomplete ? 'warn' : s.state);
    $('stateText').className = '';
    $('stateText').textContent = incomplete
      ? 'Finished with ' + num(problems) + ' problem' + (problems === 1 ? '' : 's')
      : s.state === 'running' && s.phase === 'verify' ? 'Checking the bucket…'
      : ({ idle: 'Ready', running: 'Backing up… ' + pct + '%', paused: 'Paused',
           done: c.projectsVerified ? 'Complete \u2014 all verified' : 'Complete',
           error: 'Stopped' }[s.state] || s.state);
    $('state').className = 'state ' + (incomplete ? 'warn' : s.state === 'error' ? 'bad' : '');
    $('barFill').style.width = pct + '%';
    $('barFill').style.background = incomplete ? 'var(--warn)' : 'var(--accent)';
    $('msg').textContent = s.message || '';
    $('err').textContent = s.error || '';

    var eta = '';
    if (running && rate && rate > 0.05) {
      var left = (t.pending || 0) + (t.running || 0);
      eta = rate.toFixed(rate < 10 ? 1 : 0) + ' items/sec';
      var secs = left / rate;
      if (secs > 5) eta += ' · about ' + duration(secs) + ' remaining';
    } else if (running) {
      eta = 'Measuring speed…';
    } else if (s.startedAt && s.finishedAt) {
      eta = 'Took ' + duration((s.finishedAt - s.startedAt) / 1000) + '.';
    }
    $('eta').textContent = eta;

    var bucket = (s.archive || '').split('/')[0];
    var known = bucket && bucket !== 'your R2 bucket';
    $('bucketName').textContent = known ? bucket : 'your backup bucket';
    // ?to=/:account/ resolves to the signed-in account.
    $('bucketLink').href = known
      ? 'https://dash.cloudflare.com/?to=/:account/r2/default/buckets/' + encodeURIComponent(bucket)
      : 'https://dash.cloudflare.com/?to=/:account/r2/overview';
    drawGrid(s.grid || '', s.phase, s.wave);
    $('gridEta').textContent =
      s.phase === 'verify' ? 'checking the bucket…'
      : (running && rate && rate > 0.05) ? 'about ' + duration(((t.pending || 0) + (t.running || 0)) / rate) + ' left'
      : '';

    var pill = [];
    if (c.projects) pill.push('<b>' + num(c.projects) + '</b> ' + (c.projects === 1 ? 'job' : 'jobs'));
    if (c.photosDownloaded) pill.push('<b>' + num(c.photosDownloaded) + '</b> ' + (c.photosDownloaded === 1 ? 'photo' : 'photos'));
    if (c.bytes) pill.push('<b>' + bytes(c.bytes) + '</b>');
    show('statPill', pill.length > 0);
    $('statPill').innerHTML = pill.join('<span style="opacity:.4">·</span>');

    var log = [];
    if (s.archive) log.push('destination  ' + s.archive);
    var counts = [
      ['jobs copied', c.projects], ['photos copied', c.photosDownloaded],
      ['videos', c.videosDownloaded], ['documents', c.documentsDownloaded],
      ['checklists', c.checklistDetails], ['stored', c.bytes ? bytes(c.bytes) : 0],
      ['checked', c.projectsVerified],
      ['skipped (already saved)', (c.assetsSkipped || 0) + (c.projectsSkipped || 0)],
      ['still queued', (t.pending || 0) + (t.running || 0)],
      ['failed', t.failed], ["didn't match", c.projectsUnverified]
    ].filter(function (x) { return x[1]; });
    if (counts.length) {
      log.push('');
      counts.forEach(function (x) {
        var label = '' + x[0];
        while (label.length < 26) label += ' ';
        log.push(label + x[1].toLocaleString());
      });
    }
    var sk = Object.keys(s.skipped || {});
    if (sk.length) {
      log.push('', 'not included:');
      sk.forEach(function (k) { log.push('  ' + k.replace(/_/g, ' ') + ' — ' + s.skipped[k]); });
    }
    var fails = s.recentFailures || [];
    if (fails.length) {
      log.push('', 'problems' + (t.failed > fails.length ? ' (showing ' + fails.length + ' of ' + num(t.failed) + ')' : '') + ':');
      fails.forEach(function (f) { log.push('  ' + (f.what || f.kind) + ' — ' + f.error); });
    }
    $('logText').textContent = log.join('\n');

    var bits = [];
    if (fails.length) bits.push(fails.length + ' problem' + (fails.length === 1 ? '' : 's'));
    if (sk.length) bits.push(sk.length + ' not included');
    $('logsSummary').textContent = bits.length ? 'Details · ' + bits.join(' · ') : 'Details';

    $('startBtn').disabled = running || !connected;
    $('needKey').textContent = connected ? '' : 'Connect to CompanyCam above to run a backup.';
    if (running) {
      $('startBtn').innerHTML = '<i class="spin"></i>' +
        (s.phase === 'verify' ? 'Checking…' : 'Backing up…');
    } else {
      $('startBtn').textContent =
        s.state === 'error' ? 'Try again'
        : s.state === 'paused' ? 'Resume backup'
        : (s.state === 'done') ? 'Back up again'
        : 'Start backup';
    }
    $('pauseBtn').disabled = !running;
    $('retryBtn').disabled = running || !t.failed || !connected;
    $('resetBtn').disabled = running;

    var bad = s.state === 'error';
    $('connChip').className = 'chip ' + (bad ? 'bad' : connected ? 'ok' : '');
    $('connChip').textContent = bad ? 'not working' : connected ? 'connected' : 'not connected';
    $('connWho').textContent = s.company ? 'Connected to ' + s.company : 'Connected';
    var showForm = !connected || bad || tokenOpen;
    show('connForm', showForm);
    show('connDone', connected && !showForm);
    var fg = document.getElementById('forgetToken');
    if (fg) fg.onclick = function () {
      post('/api/forget-token').then(function () {
        tokenOpen = false; $('tokenMsg').textContent = ''; poll();
      });
    };

    clearTimeout(timer);
    timer = setTimeout(poll, running ? 2000 : 8000);
  }

  function poll() {
    fetch('/api/status', { cache: 'no-store' }).then(readJson).then(function (r) {
      if (r.status === 503 && r.data.setup) {
        show('main', false); show('loginCard', false); show('setupCard', true);
        $('setupMsg').textContent = r.data.error;
        return;
      }
      if (r.status === 401) {
        show('main', false); show('setupCard', false); show('loginCard', true);
        $('pw').focus();
        return;
      }
      show('loginCard', false); show('setupCard', false); show('main', true);
      render(r.data);
    }).catch(function () { clearTimeout(timer); timer = setTimeout(poll, 5000); });
  }

  $('loginBtn').onclick = function () {
    $('loginErr').textContent = '';
    post('/api/login', { password: $('pw').value }).then(function (r) {
      if (!r.ok) { $('loginErr').textContent = r.data.error || 'Login failed.'; return; }
      $('pw').value = '';
      poll();
    });
  };
  $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('loginBtn').click(); });

  $('startBtn').onclick = function () {
    $('startBtn').disabled = true;
    post('/api/start', {}).then(function (r) {
      if (!r.ok) { $('err').textContent = r.data.error || 'Could not start.'; }
      tokenOpen = false;
      rate = null; lastSample = null;
      poll();
    });
  };
  $('saveToken').onclick = function () {
    var v = $('token').value.trim();
    if (!v) { $('tokenMsg').textContent = 'Paste your key first.'; return; }
    $('saveToken').disabled = true;
    $('tokenMsg').textContent = 'Checking the key with CompanyCam…';
    post('/api/token', { token: v }).then(function (r) {
      $('saveToken').disabled = false;
      $('tokenMsg').textContent = (r.data && r.data.message) || 'Could not check that key.';
      if (r.ok && r.data && r.data.ok) { $('token').value = ''; tokenOpen = false; }
      poll();
    });
  };
  $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('saveToken').click(); });
  $('connChip').onclick = function () { tokenOpen = true; poll(); };
  $('pauseBtn').onclick = function () { post('/api/pause').then(poll); };
  $('retryBtn').onclick = function () { post('/api/retry').then(poll); };
  $('resetBtn').onclick = function () {
    if (!confirm('Start over?\n\nThis clears the queue, the incremental ledger and the saved API token.\nFiles already in your R2 bucket are NOT deleted, but the next run will re-copy everything.')) return;
    names = null; namesFor = -1;
    post('/api/reset').then(poll);
  };

  var STATE_WORDS = { '.': 'waiting its turn', 'D': 'copied', 'V': 'copied and checked',
                      'X': 'had a problem' };

  function cellLabel(i) {
    var ch = geom.cells[i];
    var state = STATE_WORDS[ch] || (ch >= '1' && ch <= '9'
      ? 'copying — about ' + Math.round((+ch) / 9 * 100) + '% done' : 'waiting its turn');
    if (geom.per > 1) {
      var first = i * geom.per + 1, last = Math.min((i + 1) * geom.per, namesFor);
      return { title: 'Projects ' + first + '–' + last, sub: state };
    }
    var nm = names && names[i] ? names[i] : 'Project ' + (i + 1);
    return { title: nm, sub: state };
  }

  (function () {
    var cv = $('grid'), tip = $('tip');
    cv.addEventListener('mousemove', function (e) {
      if (!geom) return;
      var r = cv.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      var col = Math.floor(x / (geom.size + geom.gap));
      var row = Math.floor(y / (geom.size + geom.gap));
      var i = row * geom.cols + col;
      var inCell = (x % (geom.size + geom.gap)) <= geom.size &&
                   (y % (geom.size + geom.gap)) <= geom.size;
      if (col < 0 || col >= geom.cols || i < 0 || i >= geom.count || !inCell) { tip.hidden = true; return; }
      var l = cellLabel(i);
      tip.innerHTML = '<b></b><span></span>';
      tip.firstChild.textContent = l.title;
      tip.lastChild.textContent = l.sub;
      tip.style.left = (col * (geom.size + geom.gap) + geom.size / 2) + 'px';
      tip.style.top  = (row * (geom.size + geom.gap) - 6) + 'px';
      tip.hidden = false;
    });
    cv.addEventListener('mouseleave', function () { tip.hidden = true; });
  })();

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (lastStatus) drawGrid(lastStatus.grid || '', lastStatus.phase, lastStatus.wave); }, 150);
  });

  poll();
})();
</script>
</body>
</html>`;
