// Cache file naming (contract 3). Shared by the sandboxed renderer (loaded as a plain script,
// exposes window.SignageLib.cacheName) and by node:test (require()).
//
// The cache name is the sanitized basename of the blobUrl path, which the server guarantees is
// unique per stored file version (GUID file names). It is never the user-chosen logical
// fileName: that is what let two uploads overwrite each other locally (F05/F21).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.SignageLib = root.SignageLib || {}; root.SignageLib.cacheName = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAX_LEN = 200;

    function sanitizeCacheName(raw, fallbackId) {
        let clean = String(raw || '')
            .replace(/[^A-Za-z0-9._-]/g, '_')
            .replace(/\.{2,}/g, '.')
            .replace(/^\.+/, '')
            .slice(0, MAX_LEN);
        if (!clean || !/\.[A-Za-z0-9]+$/.test(clean)) {
            clean = `${String(fallbackId || 'media').replace(/[^A-Za-z0-9._-]/g, '_')}.bin`;
        }
        return clean;
    }

    // blobUrl may be absolute, protocol-relative or a bare path ("/media/x.mp4").
    function cacheNameFor(blobUrl, mediaId, baseUrl) {
        let base = '';
        try {
            const u = new URL(String(blobUrl || ''), baseUrl || 'http://localhost');
            base = decodeURIComponent(u.pathname.split('/').pop() || '');
        } catch (e) {
            base = String(blobUrl || '').split('?')[0].split('#')[0].split('/').pop() || '';
        }
        return sanitizeCacheName(base, mediaId);
    }

    // Content hash used for change detection (F21): id + stored name + bytes hash + slot length,
    // plus the item's own playlist/item identity (Codex #16): two campaigns made of the same clips
    // with the same durations used to hash identically, so switching between them kept the old
    // item metadata and proof-of-play named the previous playlist.
    function contentHashFor(playlistId, items) {
        return playlistId + '|' + (items || []).map(i => {
            const m = i && i.media;
            const owner = i ? `${i.playlistId || ''}:${i.playlistItemId || ''}` : ':';
            return `${owner}#${i ? i.mediaId : ''}-${m ? (m.cacheName || '') : ''}-${m && m.fileHash ? m.fileHash : ''}-${(i && i.durationOverride) || 0}`;
        }).join(',');
    }

    return { sanitizeCacheName, cacheNameFor, contentHashFor, MAX_LEN };
}));
