// Smoke test: boots the real Electron app against a mock API in an isolated user-data folder and
// checks that the whole loop works end to end (claim token -> heartbeat -> command -> schedule +
// playlist load -> media download with hash -> playback -> proof-of-play upload -> ack -> health).
//
//   npm run smoke            (exit 0 = every expected step happened)
//   SIGNAGE_SMOKE_MS=60000 npm run smoke   (longer run)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startMockServer } = require('./mock-server');

const ROOT = path.resolve(__dirname, '..');
const { spawnSync } = require('child_process');
const DURATION_MS = Number(process.env.SIGNAGE_SMOKE_MS) || 60000;
const SCENARIO = process.env.SIGNAGE_SMOKE_SCENARIO || 'playback'; // 'playback' | 'empty-schedule' | 'update-redirect'
const HARD_TIMEOUT_MS = DURATION_MS + 90000;

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

// Self-signed certificate for the TLS mock (scenario update-redirect). Needs the openssl CLI
// (Git for Windows ships one); when it is missing the scenario is skipped, not failed.
function makeSelfSignedCert(dir) {
    const key = path.join(dir, 'smoke-key.pem');
    const cert = path.join(dir, 'smoke-cert.pem');
    const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2',
        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    if (r.status !== 0 || !fs.existsSync(cert)) return null;
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert), certPath: cert };
}

async function main() {
    const electronPath = require('electron'); // path to the binary when required from node
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'signage-smoke-'));
    let tls = null;
    if (SCENARIO === 'update-redirect') {
        tls = makeSelfSignedCert(userData);
        if (!tls) {
            console.log('[smoke] SKIP update-redirect: openssl is not available to create the TLS mock certificate');
            fs.rmSync(userData, { recursive: true, force: true });
            process.exit(0);
        }
    }
    const mock = await startMockServer({ latestVersion: require(path.join(ROOT, 'package.json')).version, scenario: SCENARIO, tls });
    const config = {
        serverIp: mock.baseUrl,
        deviceId: '101',
        deviceName: 'SMOKE TEST',
        branchCode: '9999',
        location: 'lab',
        diagToken: 'smoke',
        watchdogAutoRegister: false,
    };
    fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify(config, null, 2));
    console.log(`[smoke] scenario ${SCENARIO}; mock API ${mock.baseUrl}; userData ${userData}; duration ${DURATION_MS} ms`);

    // VS Code / Claude Code terminals export ELECTRON_RUN_AS_NODE=1, which would turn the spawned
    // Electron into a plain Node process (require('electron') then yields a path, not the API).
    const env = Object.assign({}, process.env, {
        SIGNAGE_SMOKE: '1',
        SIGNAGE_USER_DATA: userData,
        SIGNAGE_SMOKE_MS: String(DURATION_MS),
        ELECTRON_ENABLE_LOGGING: '1',
    });
    if (tls) env.SIGNAGE_SMOKE_CA_FILE = tls.certPath; // smoke-only trust for the self-signed TLS mock
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath, ['.'], {
        cwd: ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutLines = [];
    child.stdout.on('data', d => { const s = d.toString(); stdoutLines.push(s); process.stdout.write('[app] ' + s); });
    child.stderr.on('data', d => { const s = d.toString(); stdoutLines.push(s); if (!/DevTools|Fontconfig|GPU process|gpu_|dxgi|viz\./i.test(s)) process.stdout.write('[app:err] ' + s); });

    const exitCode = await new Promise((resolve) => {
        const killer = setTimeout(() => { console.error('[smoke] hard timeout, killing app'); child.kill(); resolve(-1); }, HARD_TIMEOUT_MS);
        child.on('exit', (code) => { clearTimeout(killer); resolve(code); });
    });

    const reportPath = path.join(userData, 'smoke-report.json');
    let report = null;
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (e) { /* missing */ }
    const stats = await getJson(`${mock.baseUrl}/smoke/stats`).then(r => r.data).catch(() => null);
    await mock.close();

    const healthPath = path.join(userData, 'health.json');
    let health = null;
    try { health = JSON.parse(fs.readFileSync(healthPath, 'utf8')); } catch (e) { /* missing */ }
    const logDir = path.join(userData, 'logs');
    const logFiles = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];

    const checks = [];
    const check = (name, cond, detail) => checks.push({ name, ok: !!cond, detail });
    check('app exited cleanly', exitCode === 0, `exit code ${exitCode}`);
    check('smoke-report.json written', !!report, reportPath);
    check('device token claimed', report && report.tokenClaimed, report && String(report.tokenClaimed));
    check('server issued a token on claim', stats && stats.claims >= 1 && !!stats.token, stats && `claims=${stats.claims}`);
    check('heartbeats sent', stats && stats.heartbeats >= 2, stats && `heartbeats=${stats.heartbeats}`);
    check('X-Client-Protocol: 2 sent', stats && stats.protocolHeaders >= 2, stats && `protocolHeaders=${stats.protocolHeaders}`);
    check('X-Device-Token sent after claim', stats && stats.tokenHeaders >= 1, stats && `tokenHeaders=${stats.tokenHeaders}`);
    check('API capabilities probed (R1)', report && report.capabilitiesProbed === true, report && String(report.capabilitiesProbed));
    if (SCENARIO === 'empty-schedule') {
        check('empty schedule applied as authoritative (idle, no fallback)', report && report.idleOnEmptySchedule === true, report && String(report.idleOnEmptySchedule));
        check('nothing downloaded for an empty schedule', report && report.mediaDownloaded === 0, report && `downloaded=${report.mediaDownloaded}`);
        check('renderer reports not playing', health && health.playing === false, health && JSON.stringify(health));
        check('schedule read from server', stats && stats.scheduleReads >= 1, stats && `scheduleReads=${stats.scheduleReads}`);
    } else if (SCENARIO === 'update-redirect') {
        check('UPDATE_CLIENT acked FAILED INSECURE_UPDATE_URL', stats && stats.acks.some(a => a.commandId === 'cmd-9100' && a.status === 'FAILED' && /INSECURE_UPDATE_URL/.test(String(a.message))), stats && JSON.stringify(stats.acks));
        check('https -> http redirect refused on the hop', report && report.updateRefusedInsecure === true, report && String(report.updateRefusedInsecure));
        check('installer never launched', report && report.installerLaunched === false, report && String(report.installerLaunched));
        check('TLS installer URL was requested', stats && stats.tlsSetupHits >= 1, stats && `tlsSetupHits=${stats.tlsSetupHits}`);
        check('plain-http installer never downloaded', stats && stats.setupHits === 0, stats && `setupHits=${stats.setupHits}`);
    } else {
        check('PLAY_PLAYLIST command acked EXECUTED', stats && stats.acks.some(a => a.commandId === 'cmd-9001' && a.status === 'EXECUTED'), stats && JSON.stringify(stats.acks));
        check('media downloaded and hash-verified', report && report.mediaDownloaded >= 2 && stats && stats.mediaDownloads >= 2, report && `downloaded=${report.mediaDownloaded}`);
        check('playback logs accepted by server', stats && stats.playbackAccepted >= 1, stats && `accepted=${stats.playbackAccepted}`);
        check('RECLAIM_TOKEN: second claim issued and used (R2)', stats && stats.reclaimRequested && stats.claims >= 2 && stats.reclaimedOk && report && report.tokenReclaimed >= 1,
            stats && `claims=${stats.claims} reclaimedOk=${stats.reclaimedOk} tokenReclaimed=${report && report.tokenReclaimed}`);
    }
    check('health.json written from renderer reports', health && health.rendererReportTs && health.rendererStale === false, health && JSON.stringify(health));
    check('rotating log file written', logFiles.length >= 1, logFiles.join(', '));
    // The update-redirect scenario EXPECTS the refusal errors; everything else must stay clean.
    const expectedErr = /INSECURE_UPDATE_URL|Refusing redirect|Client update failed/;
    const unexpectedErrors = report && Array.isArray(report.errors) ? report.errors.filter(e => !(SCENARIO === 'update-redirect' && expectedErr.test(String(e)))) : null;
    check('no unexpected error-level entries', unexpectedErrors && unexpectedErrors.length === 0, unexpectedErrors && unexpectedErrors.slice(0, 5).join(' | '));

    console.log('\n[smoke] REPORT', JSON.stringify(report, null, 2));
    console.log('[smoke] MOCK STATS', JSON.stringify(stats, null, 2));
    let failed = 0;
    for (const c of checks) {
        if (!c.ok) failed++;
        console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
    }
    if (process.env.SIGNAGE_SMOKE_KEEP !== '1') fs.rmSync(userData, { recursive: true, force: true });
    console.log(`\n[smoke] ${checks.length - failed}/${checks.length} checks passed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[smoke] fatal:', e); process.exit(2); });
