// Health evaluation (Codex 22): main writes health.json ONLY from fresh renderer reports, so a
// frozen renderer makes the file say rendererStale and, after reloadAfterMs, triggers one reload.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.SignageLib = root.SignageLib || {}; root.SignageLib.health = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DEFAULTS = { staleAfterMs: 60 * 1000, reloadAfterMs: 3 * 60 * 1000 };

    // lastReportTs: ms epoch of the last renderer report (0/undefined = never).
    // rendererLoadedAt: ms epoch when the renderer was (re)loaded; the grace period starts there.
    function evaluateHealth(input) {
        const o = Object.assign({}, DEFAULTS, input || {});
        const now = o.now === undefined ? Date.now() : o.now;
        const last = Number(o.lastReportTs) || 0;
        const loadedAt = Number(o.rendererLoadedAt) || 0;
        const reference = Math.max(last, loadedAt);
        const silenceMs = reference > 0 ? Math.max(0, now - reference) : Infinity;
        const rendererStale = last === 0 ? (loadedAt > 0 && now - loadedAt > o.staleAfterMs) : (now - last > o.staleAfterMs);
        const needsReload = rendererStale && silenceMs > o.reloadAfterMs && !o.reloadAlreadyDone;
        return { rendererStale, needsReload, silenceMs: isFinite(silenceMs) ? silenceMs : null };
    }

    return { evaluateHealth, DEFAULTS };
}));
