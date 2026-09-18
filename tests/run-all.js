/* Runs every suite sequentially; exits non-zero on any failure. */
const { spawnSync } = require('child_process');
const path = require('path');
const suites = ['mstest.js', 'oc_ro.js', 'pltest.js', 'doccheck.js', 'core.js', 'ottest.js', 'gtttest.js'];
let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit', timeout: 240000 });
  if (r.status !== 0) { failed++; console.log(`*** ${s} FAILED ***`); }
}
console.log(failed ? `\n${failed} suite(s) FAILED` : '\nALL SUITES GREEN');
process.exit(failed ? 1 : 0);
