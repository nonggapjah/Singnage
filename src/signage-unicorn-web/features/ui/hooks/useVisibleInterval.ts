'use client';

import { useEffect, useRef } from 'react';

export interface VisibleIntervalOptions {
    /** Run the callback once immediately when the tab becomes visible again (default true). */
    runOnVisible?: boolean;
    /** Run the callback once when the hook mounts (default false). */
    runOnMount?: boolean;
}

/**
 * `setInterval` that only ticks while the document is visible.
 *
 * Polling pages used to keep hitting the API from background tabs. This pauses
 * the interval on `visibilitychange` (hidden) and, on return, runs the callback
 * once immediately so the view is fresh, then resumes the regular cadence.
 *
 * Pass `null` as the delay to disable the interval entirely (the mount run is
 * skipped as well).
 */
export function useVisibleInterval(callback: () => void, delayMs: number | null, options: VisibleIntervalOptions = {}) {
    const { runOnVisible = true, runOnMount = false } = options;
    const saved = useRef(callback);

    useEffect(() => {
        saved.current = callback;
    }, [callback]);

    useEffect(() => {
        if (delayMs === null) return;

        let id: ReturnType<typeof setInterval> | null = null;

        const start = () => {
            if (id === null) id = setInterval(() => saved.current(), delayMs);
        };
        const stop = () => {
            if (id !== null) {
                clearInterval(id);
                id = null;
            }
        };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                if (runOnVisible) saved.current();
                start();
            } else {
                stop();
            }
        };

        if (runOnMount) saved.current();
        if (document.visibilityState === 'visible') start();
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [delayMs, runOnVisible, runOnMount]);
}

export default useVisibleInterval;
