export type MediaKind = 'image' | 'video' | 'audio';

const AUDIO_EXT = /\.(mp3|wav|m4a|aac)(?:[?#].*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|ogg)(?:[?#].*)?$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)(?:[?#].*)?$/i;

/** Kind of a media file from its name or URL; undefined when the extension says nothing. */
export const mediaKind = (nameOrUrl?: string | null): MediaKind | undefined => {
    const s = (nameOrUrl || '').trim();
    if (!s) return undefined;
    if (AUDIO_EXT.test(s)) return 'audio';
    if (VIDEO_EXT.test(s)) return 'video';
    if (IMAGE_EXT.test(s)) return 'image';
    return undefined;
};

/** Audio player: a browser File that is sound only (by MIME type, or by extension when the OS gives none). */
export const isAudioFile = (file: Pick<File, 'name' | 'type'>): boolean =>
    (file.type || '').startsWith('audio/') || mediaKind(file.name) === 'audio';

export const getMediaMetadata = (file: File): Promise<{ duration: number; ratio: string }> => {
    // Always settles. The old version had no error handler, so a corrupt image or a video the browser
    // can't decode fired `error` instead of `load`/`loadedmetadata`, the promise never resolved, and
    // the upload zone stayed busy forever. Now every path (load, error, timeout) settles, with a
    // fallback that lets the upload proceed and the server validate, and every object URL is released.
    return new Promise((resolve) => {
        const FALLBACK = { duration: 0, ratio: 'unknown' };
        let settled = false;
        const finish = (value: { duration: number; ratio: string }, url?: string) => {
            if (settled) return;
            settled = true;
            if (url) { try { URL.revokeObjectURL(url); } catch { /* noop */ } }
            resolve(value);
        };

        if (file.type.startsWith('image/')) {
            const url = URL.createObjectURL(file);
            const img = new Image();
            const timer = setTimeout(() => finish(FALLBACK, url), 15000);
            img.onload = () => { clearTimeout(timer); finish({ duration: 0, ratio: `${img.width}:${img.height}` }, url); };
            img.onerror = () => { clearTimeout(timer); finish(FALLBACK, url); };
            img.src = url;
        } else if (file.type.startsWith('video/')) {
            const url = URL.createObjectURL(file);
            const video = document.createElement('video');
            video.preload = 'metadata';
            const timer = setTimeout(() => finish(FALLBACK, url), 15000);
            video.onloadedmetadata = () => { clearTimeout(timer); finish({ duration: Math.floor(video.duration), ratio: `${video.videoWidth}:${video.videoHeight}` }, url); };
            video.onerror = () => { clearTimeout(timer); finish(FALLBACK, url); };
            video.src = url;
        } else if (isAudioFile(file)) {
            // Audio player: the length is what schedules and the playlist editor need right away (the
            // server measures it again after transcoding); there is no picture, so ratio says 'audio'.
            const url = URL.createObjectURL(file);
            const audio = document.createElement('audio');
            audio.preload = 'metadata';
            const timer = setTimeout(() => finish({ duration: 0, ratio: 'audio' }, url), 15000);
            audio.onloadedmetadata = () => {
                clearTimeout(timer);
                const d = Number.isFinite(audio.duration) ? Math.max(1, Math.floor(audio.duration)) : 0;
                finish({ duration: d, ratio: 'audio' }, url);
            };
            audio.onerror = () => { clearTimeout(timer); finish({ duration: 0, ratio: 'audio' }, url); };
            audio.src = url;
        } else {
            resolve(FALLBACK);
        }
    });
};

export const formatDuration = (seconds: number): string => {
    if (seconds === 0) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};
