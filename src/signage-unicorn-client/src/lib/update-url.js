// HTTPS rule for the update channel (Codex 12 / contract T13, hop-by-hop since round 3 / Codex #5).
// Installer bytes and the settings/metadata that name them must travel over TLS; an on-path
// attacker who can rewrite plain HTTP could otherwise supply both the installer and its
// "expected" hash. The rule is applied to the FIRST url AND to every redirect hop: a
// https -> http redirect used to slip through because only the initial URL was checked.
//
// Loopback (127.0.0.0/8, ::1, localhost) over plain http is accepted: it cannot be intercepted
// on the wire (W3C "secure contexts" treats it as potentially trustworthy) and it is what the
// smoke test and a developer's local API use.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.SignageLib = root.SignageLib || {}; root.SignageLib.updateUrl = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const CODE = 'INSECURE_UPDATE_URL';
    const MAX_REDIRECTS = 5;

    // Codex round-4 #1: only a PARSED loopback address or the exact name "localhost" counts.
    // A hostname that merely starts with "127." (127.attacker.example) is a DNS name an attacker
    // can own, so it must fall under the https rule like any other host.
    function isLoopbackHost(hostname) {
        const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
        if (h === 'localhost') return true;
        const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
        if (v4) {
            const octets = v4.slice(1).map(Number);
            return octets.every(o => o >= 0 && o <= 255) && octets[0] === 127;
        }
        // IPv6 loopback in its common spellings, including the IPv4-mapped form.
        if (h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
        const mapped = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
        if (mapped) {
            const octets = mapped.slice(1).map(Number);
            return octets.every(o => o >= 0 && o <= 255) && octets[0] === 127;
        }
        return false;
    }

    // Returns { ok, reason, code, insecure?, loopback? } for a single URL (installer or metadata server).
    function checkUpdateUrl(url, allowInsecure) {
        let parsed;
        try {
            parsed = new URL(String(url || ''));
        } catch (e) {
            return { ok: false, code: 'INVALID_UPDATE_URL', reason: `not a valid URL: ${String(url || '').slice(0, 120)}` };
        }
        if (parsed.protocol === 'https:') return { ok: true };
        if (parsed.protocol === 'http:') {
            if (isLoopbackHost(parsed.hostname)) return { ok: true, loopback: true };
            if (allowInsecure === true) return { ok: true, insecure: true, reason: 'allowInsecureUpdates is set (UNSAFE)' };
            return { ok: false, code: CODE, reason: `plain http is not allowed for updates (${parsed.origin}); set allowInsecureUpdates: true only on an isolated test network` };
        }
        return { ok: false, code: 'INVALID_UPDATE_URL', reason: `unsupported protocol ${parsed.protocol}` };
    }

    // One redirect hop: resolves `location` against `fromUrl` and applies the same rule to the
    // target. `depth` is the number of redirects already followed.
    function checkRedirectHop(fromUrl, location, allowInsecure, depth) {
        if ((depth || 0) >= MAX_REDIRECTS) return { ok: false, code: 'TOO_MANY_REDIRECTS', reason: `more than ${MAX_REDIRECTS} redirects` };
        let next;
        try {
            next = new URL(String(location || ''), String(fromUrl || '')).href;
        } catch (e) {
            return { ok: false, code: 'INVALID_UPDATE_URL', reason: 'invalid redirect location' };
        }
        const rule = checkUpdateUrl(next, allowInsecure);
        if (!rule.ok) return { ok: false, code: rule.code, reason: `redirect to ${next.slice(0, 120)}: ${rule.reason}`, url: next };
        return { ok: true, url: next, insecure: rule.insecure === true, loopback: rule.loopback === true };
    }

    return { checkUpdateUrl, checkRedirectHop, isLoopbackHost, CODE, MAX_REDIRECTS };
}));
