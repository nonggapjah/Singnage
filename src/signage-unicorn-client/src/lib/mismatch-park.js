// Media download guard rails shared by the renderer and tests (client 2.8.9, 27-11-2026).
//
// Incident: one media row on the server carried a hash that did not match the file. Every screen
// downloaded the 42 MB file, failed the MD5 check, deleted it and downloaded it again on the next
// heartbeat - for a day and a half, saturating the company uplink. Two client habits made it worse:
//   1. a failed file was retried every 15 s with no memory of earlier failures;
//   2. the periodic schedule refresh was skipped whenever a sync job was running, and in that loop a
//      sync job was always running, so the corrected hash never reached the screens.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.SignageLib = root.SignageLib || {}; root.SignageLib.mismatchPark = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DEFAULT_MAX_FAILS = 3;
    const DEFAULT_PARK_MS = 60 * 60 * 1000;

    // A file whose downloaded bytes failed the hash check `maxFails` times in a row is parked for
    // `parkMs`: it is skipped by the sync worker and by self-heal, so the screen stops hammering the
    // server for bytes it can never accept. The server must fix the file or its hash; a later
    // success (new hash from the schedule) clears the record.
    function createMismatchParking(opts) {
        const o = Object.assign({ maxFails: DEFAULT_MAX_FAILS, parkMs: DEFAULT_PARK_MS }, opts || {});
        const entries = new Map(); // key -> { fails, parkedUntil }

        function entry(key) {
            let e = entries.get(key);
            if (!e) { e = { fails: 0, parkedUntil: 0 }; entries.set(key, e); }
            return e;
        }
        function isParked(key, now) {
            const e = entries.get(key);
            return !!e && e.parkedUntil > (now === undefined ? Date.now() : now);
        }
        function parkedUntil(key) {
            const e = entries.get(key);
            return e ? e.parkedUntil : 0;
        }
        // Returns { parked: true, until } when this failure crossed the limit, else { parked: false, fails }.
        function noteFailure(key, now) {
            const t = now === undefined ? Date.now() : now;
            const e = entry(key);
            if (e.parkedUntil > t) return { parked: true, until: e.parkedUntil, fails: e.fails };
            e.fails += 1;
            if (e.fails >= o.maxFails) {
                e.parkedUntil = t + o.parkMs;
                e.fails = 0;
                return { parked: true, until: e.parkedUntil, fails: o.maxFails };
            }
            return { parked: false, fails: e.fails };
        }
        function noteSuccess(key) { entries.delete(key); }
        function size() { return entries.size; }
        return { isParked, parkedUntil, noteFailure, noteSuccess, size };
    }

    function isHashMismatchError(message) {
        return /hash mismatch/i.test(String(message || ''));
    }

    // The periodic schedule refresh may be skipped while a sync job runs, but never more than
    // `maxSkips` times in a row: a long or looping sync must not keep a screen on a stale schedule.
    // Returns { run, skips } where `skips` is the counter to keep for the next tick.
    function nextRefreshDecision(syncRunning, skipsSoFar, maxSkips) {
        const max = maxSkips === undefined ? 2 : maxSkips;
        const skips = Number(skipsSoFar) || 0;
        if (!syncRunning) return { run: true, skips: 0 };
        if (skips >= max) return { run: true, skips: 0 };
        return { run: false, skips: skips + 1 };
    }

    return { createMismatchParking, isHashMismatchError, nextRefreshDecision, DEFAULT_MAX_FAILS, DEFAULT_PARK_MS };
}));
