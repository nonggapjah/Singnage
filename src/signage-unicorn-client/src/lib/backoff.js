// Retry / backoff math shared by the renderer (heartbeat, uploads, token re-claim) and tests.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.SignageLib = root.SignageLib || {}; root.SignageLib.backoff = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Exponential backoff with full jitter, capped. failures = 1 -> baseMs, 2 -> 2*baseMs, ...
    function backoffDelay(failures, opts) {
        const o = opts || {};
        const baseMs = o.baseMs || 2000;
        const maxMs = o.maxMs || 15000;
        const jitterMs = o.jitterMs === undefined ? 1000 : o.jitterMs;
        const rng = typeof o.rng === 'function' ? o.rng : Math.random;
        const n = Math.max(1, Number(failures) || 1);
        const raw = baseMs * Math.pow(2, n - 1);
        const capped = Math.min(maxMs, raw);
        return capped + Math.floor(rng() * jitterMs);
    }

    // Rate limiter for rare recovery actions (e.g. re-claiming a device token): at most one
    // attempt per `minIntervalMs`, plus jitter so a fleet never retries in lock-step.
    function createRateLimiter(minIntervalMs, opts) {
        const o = opts || {};
        const rng = typeof o.rng === 'function' ? o.rng : Math.random;
        const jitterMs = o.jitterMs === undefined ? 0 : o.jitterMs;
        let nextAllowedAt = 0;
        return {
            // Returns true (and arms the limiter) when an attempt is allowed now.
            tryAcquire(now) {
                const t = now === undefined ? Date.now() : now;
                if (t < nextAllowedAt) return false;
                nextAllowedAt = t + minIntervalMs + Math.floor(rng() * jitterMs);
                return true;
            },
            nextAllowedAt() { return nextAllowedAt; },
            reset() { nextAllowedAt = 0; }
        };
    }

    return { backoffDelay, createRateLimiter };
}));
