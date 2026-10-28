// Browser bundle entry for the sandboxed renderer: index.html loads the individual UMD files
// (cache-name, backoff, job-queue, health, update-url, playback-batch) which attach themselves to
// window.SignageLib. This file exists for node consumers that want everything at once.
'use strict';
module.exports = {
    cacheName: require('./cache-name'),
    paths: require('./paths'),
    backoff: require('./backoff'),
    jobQueue: require('./job-queue'),
    health: require('./health'),
    updateUrl: require('./update-url'),
    playbackBatch: require('./playback-batch'),
    logger: require('./logger'),
    claim: require('./claim'),
};
