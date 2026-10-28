// Device-token claim outcomes (contract T2/T3, round 3: Codex #8 + R3). Shared by the sandboxed
// renderer (window.SignageLib.claim) and node:test.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.SignageLib = root.SignageLib || {}; root.SignageLib.claim = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Boot-claim retry schedule: 1 min, 2, 4, 8, 16, then every 30 min, for at most 24 h.
    const CLAIM_RETRY_BASE_MS = 60 * 1000;
    const CLAIM_RETRY_MAX_MS = 30 * 60 * 1000;
    const CLAIM_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
    const CLAIM_RACE_RETRY_MS = { min: 2000, max: 5000 };

    // Maps the HTTP outcome of POST /devices/{id}/token/claim to what the client must do.
    //   ok        -> token issued (body.data.deviceToken)
    //   legacy    -> 404: old API or unknown id; stop (continue without token)
    //   mismatch  -> 403 CLAIM_EVIDENCE_MISMATCH; stop, surface on F7
    //   issued    -> 409 TOKEN_ALREADY_ISSUED; stop, surface on F7 (admin reset needed)
    //   race      -> 409 TOKEN_RACE; retry once after a short jittered delay
    //   retryable -> 429 / 5xx / network (status 0); retry with the bounded backoff schedule
    //   invalid   -> anything else (bad body); stop
    function classifyClaimResponse(status, message, body) {
        const code = Number(status) || 0;
        const msg = String(message || (body && body.message) || '').toUpperCase();
        if (code === 404) return { outcome: 'legacy', retryable: false };
        if (code === 403 || msg.includes('CLAIM_EVIDENCE_MISMATCH')) return { outcome: 'mismatch', retryable: false };
        if (msg.includes('TOKEN_RACE')) return { outcome: 'race', retryable: true };
        if (code === 409 || msg.includes('TOKEN_ALREADY_ISSUED')) return { outcome: 'issued', retryable: false };
        if (code === 0 || code === 408 || code === 425 || code === 429 || code >= 500) return { outcome: 'retryable', retryable: true };
        if (code >= 200 && code < 300 && body && body.success && body.data && body.data.deviceToken) return { outcome: 'ok', retryable: false };
        return { outcome: 'invalid', retryable: false };
    }

    // failures >= 1. Returns null when the 24 h window (measured from firstFailureAt) is over.
    function claimRetryDelay(failures, opts) {
        const o = opts || {};
        const rng = typeof o.rng === 'function' ? o.rng : Math.random;
        const now = o.now === undefined ? Date.now() : o.now;
        if (o.firstFailureAt !== undefined && now - o.firstFailureAt > CLAIM_RETRY_WINDOW_MS) return null;
        const n = Math.max(1, Number(failures) || 1);
        const raw = CLAIM_RETRY_BASE_MS * Math.pow(2, n - 1);
        const capped = Math.min(CLAIM_RETRY_MAX_MS, raw);
        return capped + Math.floor(rng() * 15000);
    }

    function raceRetryDelay(rng) {
        const r = typeof rng === 'function' ? rng : Math.random;
        return CLAIM_RACE_RETRY_MS.min + Math.floor(r() * (CLAIM_RACE_RETRY_MS.max - CLAIM_RACE_RETRY_MS.min));
    }

    return { classifyClaimResponse, claimRetryDelay, raceRetryDelay, CLAIM_RETRY_BASE_MS, CLAIM_RETRY_MAX_MS, CLAIM_RETRY_WINDOW_MS };
}));
