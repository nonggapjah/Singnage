// Interprets the server's answer to a proof-of-play batch (contract 4 / T6).
//   retry   -> keep every event locally, try again later (503 RETRY_LATER, 5xx, network, odd body)
//   apply   -> delete `accepted`, mark `rejected` as non-pending (new API)
//   legacy  -> old API: HTTP 200 + success means the whole batch was stored
//   reject-all (400 with success:false) -> the batch itself is malformed; keep events but surface it
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.SignageLib = root.SignageLib || {}; root.SignageLib.playbackBatch = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function classifyBatchResponse(input) {
        const o = input || {};
        const status = Number(o.status) || 0;
        const body = o.body;
        const networkError = !!o.networkError;

        if (networkError || status === 0) return { action: 'retry', reason: 'network' };
        if (status === 503 || status === 502 || status === 504 || status === 429) return { action: 'retry', reason: `http ${status}` };
        if (status >= 500) return { action: 'retry', reason: `http ${status}` };
        if (status === 401) return { action: 'unauthorized' };
        if (status >= 400) return { action: 'retry', reason: `http ${status}`, clientError: true };
        if (!body || typeof body !== 'object') return { action: 'retry', reason: 'unparseable body' };
        if (body.success === false) {
            const msg = String(body.message || '').toUpperCase();
            if (msg.includes('RETRY')) return { action: 'retry', reason: msg };
            return { action: 'retry', reason: 'server reported failure' };
        }
        const data = body.data;
        if (data && Array.isArray(data.accepted)) {
            const rejected = Array.isArray(data.rejected) ? data.rejected : [];
            return {
                action: 'apply',
                accepted: data.accepted.filter(x => typeof x === 'string' && x),
                rejected: rejected.map(r => (r && typeof r === 'object') ? { eventId: r.eventId, reason: r.reason } : { eventId: r, reason: 'rejected' }).filter(r => r.eventId),
                retry: Array.isArray(data.retry) ? data.retry.filter(x => typeof x === 'string' && x) : []
            };
        }
        return { action: 'legacy' };
    }

    return { classifyBatchResponse };
}));
