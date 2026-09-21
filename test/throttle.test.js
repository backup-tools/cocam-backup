// Compiles throttle.ts and checks the spacing holds under concurrency.
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-'));
execFileSync(path.join(__dirname, '..', 'node_modules', '.bin', 'tsc'), [
  path.join(__dirname, '..', 'src', 'throttle.ts'),
  '--outDir', out, '--module', 'commonjs', '--target', 'es2022',
], { stdio: 'pipe' });
const { Throttle } = require(path.join(out, 'throttle.js'));

(async () => {
  let bad = 0;
  for (const gap of [0, 25, 100]) {
    const th = new Throttle(gap);
    const t0 = Date.now(); const stamps = [];
    await Promise.all(Array.from({ length: 10 }, async () => {
      await th.wait(); stamps.push(Date.now() - t0);
    }));
    stamps.sort((a, b) => a - b);
    const gaps = stamps.slice(1).map((v, i) => v - stamps[i]);
    const minGap = gaps.length ? Math.min(...gaps) : 0;
    const total = stamps[stamps.length - 1];
    const expected = gap * 9;
    const ok = gap === 0 ? total < 50 : (minGap >= gap - 8 && total >= expected - 40);
    if (!ok) bad++;
    console.log(`  gap=${String(gap).padStart(3)}ms  10 at once -> spread over ${String(total).padStart(4)}ms `
      + `(expected ~${expected}ms), closest pair ${minGap}ms`
      + (gap ? `  = ${Math.round(1000 / gap)} req/s per shard` : '  = unthrottled') + (ok ? '' : '  NOT HOLDING'));
  }
  fs.rmSync(out, { recursive: true, force: true });
  console.log(bad ? '\n  throttle failed' : '\n  throttle holds its spacing under concurrency');
  process.exit(bad ? 1 : 0);
})();
