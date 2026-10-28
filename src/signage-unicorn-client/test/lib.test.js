'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { cacheNameFor, sanitizeCacheName, contentHashFor } = require('../src/lib/cache-name');
const { isSafeName, resolveInside } = require('../src/lib/paths');
const { backoffDelay, createRateLimiter } = require('../src/lib/backoff');
const { createLoadSequencer, createJobQueue, decideAfterVerify } = require('../src/lib/job-queue');
const { evaluateHealth } = require('../src/lib/health');
const { checkUpdateUrl, checkRedirectHop, isLoopbackHost } = require('../src/lib/update-url');
const { classifyClaimResponse, claimRetryDelay, raceRetryDelay, CLAIM_RETRY_MAX_MS } = require('../src/lib/claim');
const { classifyBatchResponse } = require('../src/lib/playback-batch');
const { createRotatingLogger, logFileName, shouldRotate, selectFilesToPrune } = require('../src/lib/logger');

// ---------------------------------------------------------------- cache names (F05 / contract 3)
test('cacheNameFor uses the stored basename and never the logical file name', () => {
    assert.equal(cacheNameFor('https://signage.example.com/media/3f2a9c1e-7b.mp4?x=1', '14'), '3f2a9c1e-7b.mp4');
    assert.equal(cacheNameFor('/media/a%20b.png', '9'), 'a_b.png');
    assert.equal(cacheNameFor('https://cdn/path/../evil', '7'), '7.bin'); // no extension -> id.bin
    assert.equal(cacheNameFor('', 'x y'), 'x_y.bin');
});

test('sanitizeCacheName strips traversal and caps length', () => {
    const trav = sanitizeCacheName('..' + String.fromCharCode(92) + '..' + String.fromCharCode(92) + 'boot.ini', '1');
    assert.match(trav, /^[A-Za-z0-9._-]+$/);
    assert.equal(trav.includes('..'), false);
    assert.equal(sanitizeCacheName('.hidden.mp4', '1'), 'hidden.mp4');
    assert.equal(sanitizeCacheName('a'.repeat(300) + '.mp4', '1').length <= 200, true);
});

test('contentHashFor changes when the stored file or hash changes', () => {
    const items = [{ mediaId: '1', durationOverride: 0, media: { cacheName: 'a.mp4', fileHash: 'h1' } }];
    const a = contentHashFor('P', items);
    const b = contentHashFor('P', [{ ...items[0], media: { cacheName: 'a.mp4', fileHash: 'h2' } }]);
    const c = contentHashFor('P', [{ ...items[0], media: { cacheName: 'b.mp4', fileHash: 'h1' } }]);
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.equal(a, contentHashFor('P', items));
});

// ---------------------------------------------------------------- path containment (F05)
test('isSafeName rejects traversal, separators, drive letters and odd Windows names', () => {
    for (const bad of ['..', '../x', 'a/b', 'a\\b', 'C:x', 'x\0', '', ' lead', 'trail.', 'a'.repeat(201)]) {
        assert.equal(isSafeName(bad, false), false, `expected unsafe: ${JSON.stringify(bad)}`);
    }
    assert.equal(isSafeName('fine-name_1.mp4', true), true);
    assert.equal(isSafeName('ok name.mp4', false), true);
    assert.equal(isSafeName('ok name.mp4', true), false); // strict mode: no spaces
});

test('resolveInside keeps every path under the base directory', () => {
    const base = path.join(os.tmpdir(), 'su-cache');
    assert.equal(resolveInside(base, 'clip.mp4', true), path.join(path.resolve(base), 'clip.mp4'));
    assert.throws(() => resolveInside(base, '..\\config.json', false));
    assert.throws(() => resolveInside(base, 'sub/clip.mp4', false));
});

// ---------------------------------------------------------------- backoff
test('backoffDelay grows exponentially, is capped and jittered', () => {
    const rng = () => 0.5;
    assert.equal(backoffDelay(1, { baseMs: 1000, maxMs: 8000, jitterMs: 100, rng }), 1050);
    assert.equal(backoffDelay(2, { baseMs: 1000, maxMs: 8000, jitterMs: 100, rng }), 2050);
    assert.equal(backoffDelay(10, { baseMs: 1000, maxMs: 8000, jitterMs: 100, rng }), 8050);
    assert.equal(backoffDelay(0, { baseMs: 1000, maxMs: 8000, jitterMs: 0, rng }), 1000);
});

test('createRateLimiter allows one attempt per interval', () => {
    const rl = createRateLimiter(600000, { jitterMs: 0 });
    assert.equal(rl.tryAcquire(1000), true);
    assert.equal(rl.tryAcquire(2000), false);
    assert.equal(rl.tryAcquire(1000 + 600000), true);
});

// ---------------------------------------------------------------- generations (F25 / Codex 8)
test('load sequencer: a response from an older load is stale once a newer load started', () => {
    const seq = createLoadSequencer();
    const a = seq.begin();
    const b = seq.begin();
    assert.equal(seq.isCurrent(a), false, 'A started first but B superseded it');
    assert.equal(seq.isCurrent(b), true);
});

test('job queue converges on the newest job and detects duplicates', () => {
    const q = createJobQueue();
    const j1 = q.request(q.newJob({ id: 'P1', hash: 'h1', items: [1] }));
    assert.equal(q.pending(), true);
    assert.equal(q.isDuplicate('h1'), true);
    const j2 = q.request(q.newJob({ id: 'P2', hash: 'h2', items: [1, 2] }));
    assert.equal(q.isCurrent(j1), false);
    assert.equal(q.isCurrent(j2), true);
    assert.ok(j2.gen > j1.gen);
    j2.completed = true;
    assert.equal(q.pending(), false);
    assert.equal(q.isDuplicate('h2'), false);
});

// ---------------------------------------------------------------- health (Codex 22)
test('evaluateHealth flags a silent renderer and asks for one reload after 3 minutes', () => {
    const t0 = 1_000_000;
    const fresh = evaluateHealth({ lastReportTs: t0 - 10_000, rendererLoadedAt: t0 - 600_000, now: t0 });
    assert.deepEqual([fresh.rendererStale, fresh.needsReload], [false, false]);
    const stale = evaluateHealth({ lastReportTs: t0 - 90_000, rendererLoadedAt: t0 - 600_000, now: t0 });
    assert.deepEqual([stale.rendererStale, stale.needsReload], [true, false]);
    const dead = evaluateHealth({ lastReportTs: t0 - 200_000, rendererLoadedAt: t0 - 600_000, now: t0 });
    assert.deepEqual([dead.rendererStale, dead.needsReload], [true, true]);
    const once = evaluateHealth({ lastReportTs: t0 - 200_000, rendererLoadedAt: t0 - 600_000, now: t0, reloadAlreadyDone: true });
    assert.equal(once.needsReload, false);
    // Never reported but just loaded: grace period, not stale yet.
    const booting = evaluateHealth({ lastReportTs: 0, rendererLoadedAt: t0 - 5_000, now: t0 });
    assert.equal(booting.rendererStale, false);
});

// ---------------------------------------------------------------- update url (Codex 12 / T13)
test('checkUpdateUrl requires https unless explicitly allowed', () => {
    assert.equal(checkUpdateUrl('https://signage.example.com/setup/x.exe').ok, true);
    const http = checkUpdateUrl('http://signage.example.com/setup/x.exe');
    assert.equal(http.ok, false);
    assert.equal(http.code, 'INSECURE_UPDATE_URL');
    assert.equal(checkUpdateUrl('http://127.0.0.1:9000/x.exe', true).ok, true);
    assert.equal(checkUpdateUrl('ftp://x/y.exe', true).ok, false);
    assert.equal(checkUpdateUrl('not a url').ok, false);
});

// ---------------------------------------------------------------- playback batch (T6)
test('classifyBatchResponse keeps events on retryable failures and applies per-event results', () => {
    assert.equal(classifyBatchResponse({ networkError: true }).action, 'retry');
    assert.equal(classifyBatchResponse({ status: 503, body: { success: false, message: 'RETRY_LATER' } }).action, 'retry');
    assert.equal(classifyBatchResponse({ status: 500 }).action, 'retry');
    assert.equal(classifyBatchResponse({ status: 401 }).action, 'unauthorized');
    assert.equal(classifyBatchResponse({ status: 200, body: { success: true, count: 3 } }).action, 'legacy');
    const applied = classifyBatchResponse({ status: 200, body: { success: true, data: { accepted: ['a', 'b'], rejected: [{ eventId: 'c', reason: 'Device not found' }], retry: ['d'] } } });
    assert.equal(applied.action, 'apply');
    assert.deepEqual(applied.accepted, ['a', 'b']);
    assert.deepEqual(applied.rejected, [{ eventId: 'c', reason: 'Device not found' }]);
    assert.deepEqual(applied.retry, ['d']);
});

// ---------------------------------------------------------------- rotating log
test('log file naming, rotation decision and pruning order', () => {
    const d = new Date(2026, 9, 27, 12, 0, 0);
    assert.equal(logFileName(d), 'app-20261027.log');
    assert.equal(logFileName(d, 3), 'app-20261027.3.log');
    assert.equal(shouldRotate(100, 10, 105), true);
    assert.equal(shouldRotate(100, 5, 105), false);
    const names = ['app-20261025.log', 'app-20261027.1.log', 'app-20261027.log', 'app-20261026.log', 'other.txt'];
    assert.deepEqual(selectFilesToPrune(names, 2), ['app-20261025.log', 'app-20261026.log']);
    assert.deepEqual(selectFilesToPrune(names, 10), []);
});

test('createRotatingLogger writes, rotates on size and keeps only N files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'su-log-'));
    const logger = createRotatingLogger({ dir, maxBytes: 200, keepFiles: 3, now: () => new Date(2026, 9, 27, 12, 0, 0) });
    for (let i = 0; i < 40; i++) logger.info(`line number ${i} with some padding text to fill the file quickly`);
    const files = fs.readdirSync(dir).filter(n => n.endsWith('.log')).sort();
    assert.ok(files.length >= 2, 'rotation created more than one file');
    assert.ok(files.length <= 3, `pruning kept at most 3 files, got ${files.length}`);
    const content = fs.readFileSync(logger.currentFile(), 'utf8');
    assert.match(content, /\[INFO \] line number 39/);
    fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- round 3: update channel per hop (Codex #5)
test('checkUpdateUrl accepts plain http only for loopback (secure context) or the explicit escape hatch', () => {
    assert.equal(isLoopbackHost('127.0.0.1'), true);
    assert.equal(isLoopbackHost('localhost'), true);
    assert.equal(isLoopbackHost('[::1]'), true);
    assert.equal(isLoopbackHost('192.0.2.1'), false);
    assert.equal(checkUpdateUrl('http://127.0.0.1:50961/setup/x.exe').ok, true);
    assert.equal(checkUpdateUrl('http://localhost/setup/x.exe').loopback, true);
    assert.equal(checkUpdateUrl('http://192.0.2.1/setup/x.exe').ok, false);
    assert.equal(checkUpdateUrl('http://192.0.2.1/setup/x.exe', true).insecure, true);
});

test('checkRedirectHop refuses a https -> http hop and resolves relative locations', () => {
    const ok = checkRedirectHop('https://a.example/setup/x.exe', '/setup/y.exe', false, 0);
    assert.equal(ok.ok, true);
    assert.equal(ok.url, 'https://a.example/setup/y.exe');
    const bad = checkRedirectHop('https://a.example/setup/x.exe', 'http://192.0.2.1/setup/x.exe', false, 0);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'INSECURE_UPDATE_URL');
    assert.equal(checkRedirectHop('https://a.example/x', 'http://192.0.2.1/x', true, 0).ok, true);
    assert.equal(checkRedirectHop('https://a.example/x', 'http://127.0.0.1/x', false, 0).ok, true);
    const deep = checkRedirectHop('https://a.example/x', 'https://a.example/y', false, 5);
    assert.equal(deep.ok, false);
    assert.equal(deep.code, 'TOO_MANY_REDIRECTS');
    assert.equal(checkRedirectHop('https://a.example/x', 'ftp://a.example/y', false, 0).ok, false);
});

// ---------------------------------------------------------------- round 3: claim outcomes (Codex #8, R3)
test('classifyClaimResponse maps every server answer to one client action', () => {
    assert.equal(classifyClaimResponse(200, 'OK', { success: true, data: { deviceToken: 't' } }).outcome, 'ok');
    assert.equal(classifyClaimResponse(200, 'OK', { success: true, data: {} }).outcome, 'invalid');
    assert.equal(classifyClaimResponse(404, 'Device not found').outcome, 'legacy');
    assert.equal(classifyClaimResponse(403, 'CLAIM_EVIDENCE_MISMATCH').outcome, 'mismatch');
    assert.equal(classifyClaimResponse(409, 'TOKEN_ALREADY_ISSUED').outcome, 'issued');
    assert.equal(classifyClaimResponse(409, 'TOKEN_RACE').outcome, 'race');
    for (const code of [0, 408, 429, 500, 502, 503]) assert.equal(classifyClaimResponse(code, '').outcome, 'retryable', `status ${code}`);
    assert.equal(classifyClaimResponse(400, 'bad request').outcome, 'invalid');
});

test('claimRetryDelay doubles from 1 min, caps at 30 min and stops after 24 h', () => {
    const rng = () => 0;
    assert.equal(claimRetryDelay(1, { rng }), 60 * 1000);
    assert.equal(claimRetryDelay(2, { rng }), 2 * 60 * 1000);
    assert.equal(claimRetryDelay(5, { rng }), 16 * 60 * 1000);
    assert.equal(claimRetryDelay(6, { rng }), CLAIM_RETRY_MAX_MS);
    assert.equal(claimRetryDelay(20, { rng }), CLAIM_RETRY_MAX_MS);
    const t0 = 1_000_000;
    assert.equal(claimRetryDelay(3, { rng, firstFailureAt: t0, now: t0 + 23 * 3600 * 1000 }) !== null, true);
    assert.equal(claimRetryDelay(3, { rng, firstFailureAt: t0, now: t0 + 25 * 3600 * 1000 }), null);
    const d = raceRetryDelay(() => 0.5);
    assert.ok(d >= 2000 && d <= 5000);
});

// ---------------------------------------------------------------- round 3: attribution in the hash (Codex #16)
test('contentHashFor distinguishes campaigns that share the same clips and durations', () => {
    const media = { cacheName: 'a.mp4', fileHash: 'h1' };
    const a = contentHashFor('SCHEDULE', [{ mediaId: '1', durationOverride: 0, playlistId: 'P1', playlistItemId: 'I1', media }]);
    const b = contentHashFor('SCHEDULE', [{ mediaId: '1', durationOverride: 0, playlistId: 'P2', playlistItemId: 'I2', media }]);
    assert.notEqual(a, b);
    assert.equal(a, contentHashFor('SCHEDULE', [{ mediaId: '1', durationOverride: 0, playlistId: 'P1', playlistItemId: 'I1', media }]));
});

// ---------------------------------------------------------------- round 4: loopback rule (Codex #1)
test('isLoopbackHost accepts only parsed loopback addresses or exactly localhost', () => {
    for (const ok of ['127.0.0.1', '127.255.255.254', 'localhost', 'LOCALHOST', '::1', '[::1]', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) {
        assert.equal(isLoopbackHost(ok), true, `expected loopback: ${ok}`);
    }
    for (const bad of ['127.attacker.example', '127.0.0.1.evil.com', 'localhost.evil.com', '127.999.0.1', '128.0.0.1', '10.127.0.1', '::ffff:10.0.0.1', '']) {
        assert.equal(isLoopbackHost(bad), false, `expected NOT loopback: ${bad}`);
    }
    assert.equal(checkUpdateUrl('http://127.attacker.example/setup/x.exe').ok, false);
    assert.equal(checkUpdateUrl('http://127.attacker.example/setup/x.exe').code, 'INSECURE_UPDATE_URL');
    assert.equal(checkRedirectHop('https://a.example/x', 'http://127.attacker.example/x', false, 0).ok, false);
    assert.equal(checkRedirectHop('https://a.example/x', 'http://localhost.evil.com/x', false, 0).ok, false);
});

// ---------------------------------------------------------------- round 4: obsolete pending swap (Codex #8)
test('job queue drops a pending job for another version once the active content is confirmed', () => {
    const q = createJobQueue();
    q.request(q.newJob({ id: 'A', hash: 'hA', items: [1] }));
    q.request(q.newJob({ id: 'B', hash: 'hB', items: [2] }));
    assert.equal(q.pending(), true);
    assert.equal(q.reconcileWithActive('hA'), true);   // A confirmed active -> pending B is obsolete
    assert.equal(q.pending(), false);
    assert.equal(q.requested(), null);
    const same = q.request(q.newJob({ id: 'A', hash: 'hA', items: [1] }));
    assert.equal(q.reconcileWithActive('hA'), false);  // pending job IS the active version: kept
    assert.equal(q.requested(), same);
    same.completed = true;
    assert.equal(q.reconcileWithActive('hZ'), false);  // completed jobs are never touched
});

test('round 5 #8: pending version is cancelled BEFORE yielding, so it cannot swap in during the file check', () => {
    const q = createJobQueue();
    const a = q.request(q.newJob({ hash: 'hA' })); a.completed = true;   // A is playing
    const b = q.request(q.newJob({ hash: 'hB' }));                        // B queued behind it
    // Server confirms A as authoritative: reconcile first, then the (simulated) await.
    assert.equal(q.reconcileWithActive('hA'), true);
    const swapAttemptDuringAwait = q.isCurrent(b) && !b.completed;        // what trySwapIfReady checks
    assert.equal(swapAttemptDuringAwait, false, 'B must not be swappable once A was confirmed');
    assert.equal(q.requested(), null);
});

test('round 5 #8: decideAfterVerify re-reads the active hash after the await', () => {
    assert.equal(decideAfterVerify({ contentHash: 'hA', activeHashAfterAwait: 'hA', complete: true }), 'ready');
    assert.equal(decideAfterVerify({ contentHash: 'hA', activeHashAfterAwait: 'hA', complete: false }), 'resync');
    // A swap already in flight finished during the await: A is still authoritative -> queue it again
    assert.equal(decideAfterVerify({ contentHash: 'hA', activeHashAfterAwait: 'hB', complete: true }), 'requeue');
    assert.equal(decideAfterVerify({ contentHash: 'hA', activeHashAfterAwait: '', complete: true }), 'requeue');
});
