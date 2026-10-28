// Generation bookkeeping for the playlist sync worker (F25, Codex 8).
//
// Two independent sequences:
//   - loads: every loadPlaylist() call takes a load number BEFORE its first await; a response
//     that comes back after a newer load started is stale and must be discarded (Codex 8).
//   - jobs: every download job takes a generation; the worker converges on the newest job and a
//     running job aborts as soon as it is superseded.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.SignageLib = root.SignageLib || {}; root.SignageLib.jobQueue = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function createLoadSequencer() {
        let latest = 0;
        return {
            begin() { return ++latest; },
            isCurrent(n) { return n === latest; },
            latest() { return latest; }
        };
    }

    function createJobQueue() {
        let generation = 0;
        let requested = null;
        return {
            newJob(fields) {
                return Object.assign({ gen: ++generation, synced: 0, completed: false }, fields || {});
            },
            request(job) { requested = job; return job; },
            requested() { return requested; },
            // true while a job is waiting for or receiving its downloads
            pending() { return !!(requested && !requested.completed); },
            isCurrent(job) { return !!job && requested === job; },
            // Same content version already requested and not finished: nothing to do.
            isDuplicate(hash) { return !!(requested && requested.hash === hash && !requested.completed); },
            // The server just confirmed `activeHash` as the authoritative, already-playing content:
            // a pending job for any OTHER version is obsolete and must never swap in (round 4, #8).
            // Returns true when a job was dropped.
            reconcileWithActive(activeHash) {
                if (requested && !requested.completed && requested.hash !== activeHash) { requested = null; return true; }
                return false;
            },
            clear() { requested = null; },
            generation() { return generation; }
        };
    }

    // Round 5 (#8): what to do once the server confirmed `contentHash` as the authoritative,
    // already-playing content and the (awaited) file check finished. The caller must have
    // cancelled any pending job for another version BEFORE that await; this decides from the
    // hash that is active AFTER it, because a swap already in flight may have completed meanwhile.
    //   'ready'   - still the active version and every file exists: nothing to do
    //   'resync'  - still the active version but files are missing: silent repair
    //   'requeue' - another version swapped in during the await: queue this one as the next playlist
    function decideAfterVerify(state) {
        var s = state || {};
        if (s.activeHashAfterAwait !== s.contentHash) return 'requeue';
        return s.complete ? 'ready' : 'resync';
    }

    return { createLoadSequencer, createJobQueue, decideAfterVerify };
}));
