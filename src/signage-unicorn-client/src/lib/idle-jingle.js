// Idle "safety jingle" picker shared by the renderer and tests (client 2.8.9, 27-11-2026, BUG-JINGLE-01).
//
// Incident: a store screen showed a black panel with the words "Safety Jingle". The idle picture is an
// <img>; the admin had configured a VIDEO ("VDO Visual Villa.mp4") as the jingle, and a video inside an
// <img> cannot render - Chromium paints the alt text on black. The renderer now routes the configured
// jingle to the element that can show it and falls back to the bundled picture on any load error.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else { root.SignageLib = root.SignageLib || {}; root.SignageLib.idleJingle = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv|avi)(\?.*)?$/i;
    const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
    const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg)(\?.*)?$/i;

    // 'video' | 'image' | 'unsupported'. Decided from the first name that has a recognisable extension
    // (cache name, file name, blob url); an audio file or an unknown extension is unsupported as a
    // picture and the caller shows the bundled image instead.
    function jingleKindFor() {
        for (let i = 0; i < arguments.length; i++) {
            const n = String(arguments[i] || '');
            if (!n) continue;
            if (VIDEO_EXT.test(n)) return 'video';
            if (IMAGE_EXT.test(n)) return 'image';
            if (AUDIO_EXT.test(n)) return 'unsupported';
        }
        return 'unsupported';
    }

    // What the idle layer should do given the configured jingle and the player's state.
    //   kind: result of jingleKindFor; audioMode: the audio-player build (no picture is ever shown there);
    //   idle: the player has nothing to play right now.
    // Returns { show: 'video' | 'image' | 'none', playVideo: boolean }.
    function idleLayerPlan(kind, idle, audioMode) {
        if (!idle || audioMode) return { show: 'none', playVideo: false };
        if (kind === 'video') return { show: 'video', playVideo: true };
        return { show: 'image', playVideo: false }; // 'image' or the bundled fallback for 'unsupported'
    }

    return { jingleKindFor, idleLayerPlan };
}));
