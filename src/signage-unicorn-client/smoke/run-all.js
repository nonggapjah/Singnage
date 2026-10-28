// Runs every smoke scenario in sequence: playback (incl. RECLAIM_TOKEN), empty-schedule,
// update-redirect (https -> http hop refused). Exit 0 only when all pass (a skipped scenario passes).
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const scenarios = ['playback', 'empty-schedule', 'update-redirect'];
let failed = 0;
for (const scenario of scenarios) {
    console.log(`\n================= smoke scenario: ${scenario} =================`);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run-smoke.js')], {
        stdio: 'inherit',
        env: Object.assign({}, process.env, { SIGNAGE_SMOKE_SCENARIO: scenario }),
    });
    if (r.status !== 0) failed++;
}
console.log(`\n[smoke:all] ${scenarios.length - failed}/${scenarios.length} scenarios passed`);
process.exit(failed === 0 ? 0 : 1);
