// The runtime's subrequest ceiling is learned, not configured.
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-'));
execFileSync(path.join(__dirname, '..', 'node_modules', '.bin', 'tsc'), [
  path.join(__dirname, '..', 'src', 'budget.ts'),
  '--outDir', out, '--module', 'commonjs', '--target', 'es2022',
], { stdio: 'pipe' });
const { isSubrequestLimit, Budget } = require(path.join(out, 'budget.js'));

let bad = 0;
const check = (label, got, want) => {
  if (got !== want) { bad++; console.log(`  ${label}: got ${got}, expected ${want}`); }
  else console.log(`  ${label}: ${got}`);
};
console.log('  recognising the runtime refusal:');
check('    "Too many subrequests."          ', isSubrequestLimit(new Error('Too many subrequests.')), true);
check('    "too many subrequests"           ', isSubrequestLimit('too many subrequests'), true);
check('    "Subrequest limit exceeded"      ', isSubrequestLimit(new Error('Subrequest limit exceeded')), true);
check('    a 500 from the API               ', isSubrequestLimit(new Error('GET /x -> 500')), false);
check('    a timeout                        ', isSubrequestLimit(new Error('The operation was aborted')), false);

console.log('\n  learning the ceiling from where it stopped:');
const learn = (used, current) => Math.max(20, used - 2) < current ? Math.max(20, used - 2) : current;
check('    refused at 50, was 900           ', learn(50, 900), 48);
check('    refused at 22, was 900           ', learn(22, 900), 20);
check('    refused at 5, floor applies      ', learn(5, 900), 20);
check('    refused at 950, already lower    ', learn(950, 900), 900);

console.log('\n  budget stops at the learned ceiling:');
const b = new Budget(48, 60000);
let n = 0; try { for (;;) { b.spend(); n++; } } catch { /* exhausted */ }
check('    spends allowed before refusal    ', n, 48);
fs.rmSync(out, { recursive: true, force: true });
console.log(bad ? '\n  budget behaviour failed' : '\n  ceiling is detected and learned correctly');
process.exit(bad ? 1 : 0);
