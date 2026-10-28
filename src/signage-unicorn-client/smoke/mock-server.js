// Mock Signage Unicorn API for the smoke test (plain node http, loopback only).
// Implements just enough of the round-1/round-2 protocol for the kiosk to boot, claim a token,
// heart-beat, receive one command, load the device schedule + a playlist, download two small
// media files (hash-verified), play them, ack, and upload proof-of-play + diagnostics.
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// 1x1 PNGs (valid files the <img> player can show). Two different colours so the hashes differ.
const PNG_RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const PNG_BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64');

function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

function startMockServer(options = {}) {
    const port = options.port || 0;
    const state = {
        heartbeats: 0,
        registers: 0,
        claims: 0,
        acks: [],
        mediaDownloads: 0,
        playbackAccepted: 0,
        systemLogsStored: 0,
        protocolHeaders: 0,
        tokenHeaders: 0,
        settings: 0,
        commandDelivered: false,
        scheduleReads: 0,
        token: null,
        // round 3
        reclaimRequested: false,   // RECLAIM_TOKEN pseudo-command injected (after an admin 'reset')
        reclaimedOk: false,        // a later heartbeat carried the token issued by the second claim
        updateDelivered: false,    // UPDATE_CLIENT injected (scenario update-redirect)
        setupHits: 0,              // plain-http installer requests (must stay 0: the redirect is refused)
        tlsSetupHits: 0,
        errors: [],
    };
    const media = [
        { mediaId: '501', fileName: 'Smoke Red.png', displayName: 'Smoke Red', file: '7a1e2c3d-red.png', bytes: PNG_RED, durationSec: 2 },
        { mediaId: '502', fileName: 'Smoke Blue.png', displayName: 'Smoke Blue', file: '9b4f5e6a-blue.png', bytes: PNG_BLUE, durationSec: 2 },
    ];

    let baseUrl = '';
    let tlsBaseUrl = '';
    const playlistPayload = (id, name) => ({
        playlistId: id,
        playlistName: name,
        active: 'Y',
        itemCount: media.length,
        items: media.map((m, idx) => ({
            playlistItemId: `${id}-item-${idx + 1}`,
            playlistId: id,
            mediaId: m.mediaId,
            positionOrder: idx + 1,
            durationOverride: null,
            media: {
                mediaId: m.mediaId,
                fileName: m.fileName,
                displayName: m.displayName,
                blobUrl: `${baseUrl}/media/${m.file}`,
                durationSec: m.durationSec,
                fileHash: md5(m.bytes),
                ratio: '16:9',
            },
        })),
    });

    const ok = (res, data, extra) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Object.assign({ success: true, code: 0, message: 'OK', data, errors: null }, extra || {})));
    };
    const fail = (res, status, message) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, code: status, message, data: null, errors: null }));
    };
    const readBody = (req) => new Promise((resolve) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
        });
    });

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const p = url.pathname;
        if (req.headers['x-client-protocol'] === '2') state.protocolHeaders++;
        if (req.headers['x-device-token']) state.tokenHeaders++;
        try {
            if (p === '/smoke/stats') return ok(res, state);

            if (p === '/api/v1/devices/register' && req.method === 'POST') {
                const body = await readBody(req);
                state.registers++;
                const data = { deviceId: '101', deviceUuid: body.deviceKey || 'SMOKE-UUID', deviceName: body.deviceName, branchCode: body.branchCode, status: 'ONLINE', active: 'Y' };
                if (body.tokenCapable === true) { state.token = 'tok-' + crypto.randomBytes(8).toString('hex'); data.deviceToken = state.token; }
                return ok(res, data);
            }

            let m = /^\/api\/v1\/devices\/([^/]+)\/token\/claim$/.exec(p);
            if (m && req.method === 'POST') {
                const body = await readBody(req);
                state.claims++;
                if (decodeURIComponent(m[1]) !== '101') return fail(res, 404, 'Device not found');
                if (!body.deviceKey) return fail(res, 403, 'CLAIM_EVIDENCE_MISMATCH');
                if (state.token && !options.allowReclaim && req.headers['x-device-token'] !== state.token) return fail(res, 409, 'TOKEN_ALREADY_ISSUED');
                state.token = 'tok-' + crypto.randomBytes(8).toString('hex');
                return ok(res, { deviceId: '101', deviceUuid: body.deviceKey, deviceToken: state.token });
            }

            if (p === '/api/v1/devices/heartbeat' && req.method === 'POST') {
                await readBody(req);
                state.heartbeats++;
                if (state.token && req.headers['x-device-token'] !== state.token) return fail(res, 401, 'DEVICE_TOKEN_INVALID');
                if (state.reclaimRequested && state.token && state.claims >= 2 && req.headers['x-device-token'] === state.token) state.reclaimedOk = true;
                const commands = [];
                if (options.scenario === 'playback' && !state.reclaimRequested && state.heartbeats >= 3) {
                    // R2: simulate 'Reset device token' in the admin console: the hash is cleared and the
                    // server tells the screen to claim again (pseudo-command, status EXECUTED, no ack).
                    state.reclaimRequested = true;
                    state.token = null;
                    commands.push({ commandId: '0', deviceCommandId: null, deviceId: '101', commandType: 'RECLAIM_TOKEN', payload: null, status: 'EXECUTED', createdAt: new Date().toISOString() });
                }
                if (options.scenario === 'update-redirect' && !state.updateDelivered && state.heartbeats >= 2) {
                    state.updateDelivered = true;
                    commands.push({ commandId: '9100', deviceCommandId: 'cmd-9100', deviceId: '101', commandType: 'UPDATE_CLIENT', payload: null, status: 'POLLING', createdAt: new Date().toISOString() });
                }
                if (!state.commandDelivered && state.heartbeats >= 2 && options.scenario === 'playback') {
                    state.commandDelivered = true;
                    commands.push({ commandId: '9001', deviceCommandId: 'cmd-9001', deviceId: '101', commandType: 'PLAY_PLAYLIST:7', payload: null, status: 'POLLING', createdAt: new Date().toISOString() });
                }
                return ok(res, commands);
            }

            m = /^\/api\/v1\/devices\/([^/]+)\/command\/ack$/.exec(p);
            if (m && req.method === 'POST') {
                const body = await readBody(req);
                state.acks.push({ commandId: body.commandId, status: body.status, message: body.message || null });
                return ok(res, null, { message: 'Command acknowledged' });
            }

            m = /^\/api\/v1\/devices\/([^/]+)\/schedule$/.exec(p);
            if (m && req.method === 'GET') {
                state.scheduleReads++;
                if (options.scenario === 'empty-schedule') {
                    // Codex 7: an EMPTY schedule is authoritative -> the player must go idle, not fall back.
                    return ok(res, { playlistId: 'SCHEDULE-101', playlistName: 'Device Schedule', active: 'Y', itemCount: 0, items: [], scheduleVersion: 'v0', nextTransitionAtUtc: null });
                }
                const pl = playlistPayload('SCHEDULE-101', 'Device Schedule');
                pl.scheduleVersion = 'v1';
                pl.nextTransitionAtUtc = null;
                return ok(res, pl);
            }

            m = /^\/api\/v1\/playlists\/([^/]+)$/.exec(p);
            if (m && req.method === 'GET') {
                if (decodeURIComponent(m[1]) === '7') return ok(res, playlistPayload('7', 'Smoke Playlist'));
                return fail(res, 404, 'Playlist not found');
            }
            if (p === '/api/v1/playlists/active') return ok(res, [playlistPayload('7', 'Smoke Playlist')]);

            m = /^\/media\/([^/]+)$/.exec(p);
            if (m) {
                const file = media.find(x => x.file === m[1]);
                if (!file) { res.writeHead(404); return res.end('nf'); }
                state.mediaDownloads++;
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': file.bytes.length, 'Accept-Ranges': 'bytes' });
                return res.end(file.bytes);
            }

            if (p === '/api/v1/logs/playback/batch' && req.method === 'POST') {
                const body = await readBody(req);
                const events = Array.isArray(body) ? body : [];
                if (state.token && req.headers['x-device-token'] !== state.token) return fail(res, 401, 'DEVICE_TOKEN_INVALID');
                const accepted = events.map(e => e.eventId).filter(Boolean);
                state.playbackAccepted += accepted.length;
                return ok(res, { accepted, rejected: [], acceptedCount: accepted.length, rejectedCount: 0 }, { count: accepted.length });
            }

            if (p === '/api/v1/logs/batch' && req.method === 'POST') {
                const body = await readBody(req);
                const entries = Array.isArray(body) ? body : [];
                const stored = entries.filter(e => /WARN|ERROR/i.test(String(e.logType || ''))).length;
                state.systemLogsStored += stored;
                return ok(res, { stored, dropped: entries.length - stored });
            }

            m = /^\/api\/v1\/system\/settings\/([^/]+)$/.exec(p);
            if (m) {
                state.settings++;
                const key = decodeURIComponent(m[1]);
                const values = { LatestClientVersion: options.latestVersion || null, safety_jingle_id: '', ClientDownloadUrl: null, ClientDownloadSha256: null };
                if (options.scenario === 'update-redirect') {
                    // The installer URL is https (TLS mock); its response is a redirect to plain http on a
                    // non-loopback host, which the client must refuse on the hop (Codex #5).
                    values.LatestClientVersion = '9.9.9';
                    values.ClientDownloadUrl = `${tlsBaseUrl}/setup/Signage_Unicorn_Setup_9.9.9.exe`;
                    values.ClientDownloadSha256 = 'deadbeef'.repeat(8);
                }
                return ok(res, values[key] === undefined ? null : values[key]);
            }

            if (p === '/api/v1/changelog') return ok(res, '# smoke changelog');
            if (p === '/api/v1/system/capabilities') return ok(res, { apiVersion: '2.8.0-smoke', protocol: 2, deviceToken: true, claimEndpoint: true });
            if (p.startsWith('/setup/')) { state.setupHits++; res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(Buffer.from('MZ-not-a-real-installer')); }
            fail(res, 404, `mock: no route for ${req.method} ${p}`);
        } catch (e) {
            state.errors.push(String(e && e.message));
            fail(res, 500, e.message);
        }
    });

    // Optional TLS listener (scenario update-redirect): serves the installer URL and answers it
    // with a 302 to plain http on a TEST-NET address, so the client's hop policy is exercised
    // against a real redirect. options.tls = { key, cert } (self-signed, trusted by the app only
    // through SIGNAGE_SMOKE_CA_FILE in smoke mode).
    let tlsServer = null;
    if (options.tls) {
        tlsServer = https.createServer({ key: options.tls.key, cert: options.tls.cert }, (req, res) => {
            if (req.url.startsWith('/setup/')) {
                state.tlsSetupHits++;
                res.writeHead(302, { Location: 'http://192.0.2.1/setup/Signage_Unicorn_Setup_9.9.9.exe' });
                return res.end();
            }
            res.writeHead(404); res.end('nf');
        });
    }

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            const finish = () => resolve({
                server, baseUrl, tlsBaseUrl, state,
                close: () => new Promise(r => server.close(() => (tlsServer ? tlsServer.close(r) : r()))),
            });
            if (!tlsServer) return finish();
            tlsServer.on('error', reject);
            tlsServer.listen(0, '127.0.0.1', () => { tlsBaseUrl = `https://127.0.0.1:${tlsServer.address().port}`; finish(); });
        });
    });
}

module.exports = { startMockServer };

if (require.main === module) {
    startMockServer({ port: Number(process.argv[2]) || 0 }).then(({ baseUrl }) => console.log('mock server on', baseUrl));
}
