'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert, RefreshCw, Check } from 'lucide-react';
import { systemApi, MediaIntegrityReport, MediaIntegrityItem } from '@/features/system/api/system-api';
import { getCapabilities } from '@/lib/api-capabilities';
import { useUI } from '@/features/ui/context/UIContext';

const POLL_MS = 60_000;

const statusText: Record<string, string> = {
    mismatch: 'stored hash differs from the file',
    missing: 'file is not on the server',
    'loop-suspect': 'screens keep re-downloading it',
};

const fmtTime = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? hm : `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')} ${hm}`;
};

/** The release action is the same API call for every status; the words differ because the operator's situation differs. */
const releaseLabel = (status: string) => status === 'loop-suspect' ? 'Release to screens' : 'Accept file on disk';

/**
 * Media integrity (API 2.8.15). Shown on every admin page while at least one media file is held back
 * from the screens (hash mismatch, missing file, or a re-download loop). Hidden on older APIs and
 * when everything is fine. Polls once a minute.
 */
export const MediaIntegrityBanner: React.FC = () => {
    const { showNotify, showConfirm } = useUI();
    const [supported, setSupported] = useState(false);
    const [report, setReport] = useState<MediaIntegrityReport | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [staleSince, setStaleSince] = useState<Date | null>(null); // last refresh failed; the list shown may be out of date
    const seq = useRef(0);

    useEffect(() => {
        let cancelled = false;
        getCapabilities().then(c => { if (!cancelled) setSupported(c.mediaIntegrity === true); }).catch(() => { /* stays hidden */ });
        return () => { cancelled = true; };
    }, []);

    const load = useCallback(async () => {
        const mine = ++seq.current;
        try {
            const res = await systemApi.mediaIntegrity();
            if (mine !== seq.current) return;
            if (res.success && res.data) { setReport(res.data); setStaleSince(null); }
            else { setStaleSince(d => d ?? new Date()); console.warn('[MediaIntegrity] refresh failed:', res.message || 'no data'); }
        } catch (e) {
            if (mine !== seq.current) return;
            // Keep the last report on screen (a quarantine must not vanish because one poll failed) but say it is stale.
            setStaleSince(d => d ?? new Date());
            console.warn('[MediaIntegrity] refresh failed:', e);
        }
    }, []);

    useEffect(() => {
        if (!supported) return;
        void load();
        const t = setInterval(() => { void load(); }, POLL_MS);
        return () => { clearInterval(t); seq.current++; };
    }, [supported, load]);

    if (!supported || !report || report.quarantined === 0) return null;
    const items: MediaIntegrityItem[] = report.items.filter(i => i.status !== 'ok' && i.status !== 'unknown');

    const accept = (it: MediaIntegrityItem) => showConfirm(
        it.status === 'loop-suspect' ? 'Release the file to the screens again?' : 'Serve the file as it is on the server?',
        it.status === 'loop-suspect'
            ? `"${it.displayName || it.storedName}" was held back because screens kept re-downloading it. Its hash and size will be re-read from the file on disk and it goes back to the screens on their next schedule refresh. Do this after the cause is understood; if the loop returns, the file is held back again.`
            : `"${it.displayName || it.storedName}" will get the hash and size of the file on disk and go back to the screens on their next schedule refresh. Do this only if that file is the right content. If it is not, replace the file on the Media page instead.`,
        () => { void (async () => {
            setBusy(String(it.mediaId));
            try {
                const res = await systemApi.mediaIntegrityAcceptDisk(String(it.mediaId));
                showNotify(res.success ? 'Released' : 'Not released', res.message || '', res.success ? 'SUCCESS' : 'ERROR');
                await load();
            } catch {
                showNotify('Not released', 'The server could not be reached.', 'ERROR');
            } finally { setBusy(null); }
        })(); },
        'INFO'
    );

    const recheck = async () => {
        setBusy('run');
        try {
            const res = await systemApi.mediaIntegrityRun();
            showNotify('Media check', res.message || (res.success ? 'Done.' : 'Failed.'), res.success ? 'SUCCESS' : 'ERROR');
            await load();
        } catch {
            showNotify('Media check', 'The server could not be reached.', 'ERROR');
        } finally { setBusy(null); }
    };

    const btn = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2';

    // role="region" + a polite live heading: the count is announced when it changes, the whole block is not
    // re-read on every one-minute poll (role="alert" would do that).
    return (
        <section role="region" aria-labelledby="media-integrity-heading" className="mx-4 sm:mx-6 mt-4 rounded-xl border border-red-500/50 bg-red-500/10 text-foreground">
            <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <ShieldAlert className="h-5 w-5 text-red-500 shrink-0" aria-hidden="true" />
                <p id="media-integrity-heading" className="font-bold text-sm" aria-live="polite">
                    {report.quarantined === 1 ? '1 media file is held back from the screens' : `${report.quarantined} media files are held back from the screens`}
                </p>
                <span className="text-xs text-muted-foreground">
                    A file whose stored hash does not match the file on the server is never sent to the screens. Last check {fmtTime(report.lastRunUtc) || 'pending'}.
                    {staleSince && <span className="text-red-600 dark:text-red-400 font-bold"> Could not refresh this list since {fmtTime(staleSince.toISOString())}; it may be out of date.</span>}
                </span>
                <button type="button" onClick={() => { void recheck(); }} disabled={busy !== null} className={`${btn} ml-auto border-border hover:bg-muted/30 focus-visible:ring-red-400/60`}>
                    <RefreshCw className={`h-3.5 w-3.5 ${busy === 'run' ? 'animate-spin' : ''}`} aria-hidden="true" />Re-check now
                </button>
            </div>
            <ul className="border-t border-red-500/30 divide-y divide-red-500/20">
                {items.map(it => (
                    <li key={it.mediaId} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="font-bold truncate max-w-[22rem]" title={it.storedName || ''}>{it.displayName || it.storedName || `media ${it.mediaId}`}</span>
                        <span className="inline-flex items-center rounded-md border border-red-500/50 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">{it.status}</span>
                        <span className="text-xs text-muted-foreground min-w-0 truncate" title={it.note || ''}>{statusText[it.status] || it.status}{it.note ? ` · ${it.note}` : ''}</span>
                        {it.downloadsLastHour > 0 && <span className="text-xs text-muted-foreground tabular-nums">{it.downloadsLastHour} downloads / h</span>}
                        {it.status !== 'missing' && (
                            <button type="button" onClick={() => accept(it)} disabled={busy !== null} className={`${btn} sm:ml-auto border-green-600/50 text-green-700 dark:text-green-400 hover:bg-green-500/10 focus-visible:ring-green-500/60`}>
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />{releaseLabel(it.status)}
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
};
