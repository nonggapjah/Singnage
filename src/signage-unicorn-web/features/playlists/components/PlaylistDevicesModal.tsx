'use client';

import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { playlistApi, type PlaylistDevice } from '../api/playlist-api';

interface PlaylistDevicesModalProps {
    playlistId: string;
    playlistName: string;
    onClose: () => void;
}

// A heartbeat within this window counts as online (last_check_in is UTC; the API returns the age).
const ONLINE_WINDOW_SEC = 120;

const isOnline = (d: PlaylistDevice) =>
    d.secondsSinceCheckIn != null && d.secondsSinceCheckIn <= ONLINE_WINDOW_SEC;

/** Relative "last seen" label from the heartbeat age in seconds. */
const lastSeen = (sec?: number | null) => {
    if (sec == null) return 'never';
    if (sec <= ONLINE_WINDOW_SEC) return 'online';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
};

export const PlaylistDevicesModal: React.FC<PlaylistDevicesModalProps> = ({ playlistId, playlistName, onClose }) => {
    const [devices, setDevices] = useState<PlaylistDevice[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const res = await playlistApi.getDevices(playlistId);
                if (!active) return;
                if (res.success && res.data) setDevices(res.data);
                else { setError(res.message || 'Could not load the screens for this playlist.'); setDevices([]); }
            } catch {
                if (active) { setError('Could not load the screens for this playlist.'); setDevices([]); }
            }
        })();
        return () => { active = false; };
    }, [playlistId]);

    const online = devices?.filter(isOnline).length ?? 0;
    const total = devices?.length ?? 0;

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            size="none"
            labelledBy="playlist-devices-title"
            describedBy="playlist-devices-desc"
            zIndexClass="z-[1000]"
            className="max-w-[95vw] xl:max-w-3xl p-6 sm:p-8 flex flex-col bg-card-solid"
        >
            <div className="mb-5 shrink-0">
                <div className="text-3xl mb-2" aria-hidden="true">📺</div>
                <h3 id="playlist-devices-title" className="text-2xl font-black text-foreground uppercase tracking-tighter">Screens for this playlist</h3>
                <p id="playlist-devices-desc" className="text-sm text-muted-foreground mt-1">
                    Screens that have <span className="font-bold text-foreground">{playlistName}</span> assigned, and whether they are online.
                </p>
                {devices && devices.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400">
                            <span className="w-2 h-2 rounded-full bg-green-500" aria-hidden="true" /> Online {online}
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-muted/20 text-muted-foreground">
                            Total {total}
                        </span>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar min-h-[200px] max-h-[55vh]">
                {devices === null ? (
                    <div className="flex items-center justify-center h-40 text-muted-foreground tracking-widest font-mono text-sm uppercase" role="status">Loading screens…</div>
                ) : error && devices.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-red-500 text-sm font-medium px-4 text-center">{error}</div>
                ) : devices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-1">
                        <span className="text-2xl" aria-hidden="true">🫥</span>
                        <span className="uppercase tracking-widest font-bold">No screen has this playlist assigned</span>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {devices.map((d) => {
                            const up = isOnline(d);
                            return (
                                <li key={d.deviceId} className="card-elevated rounded-xl px-4 py-3 flex items-center gap-3">
                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${up ? 'bg-green-500' : 'bg-muted-foreground/50'}`} aria-hidden="true" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline gap-2 flex-wrap">
                                            <span className="font-bold text-foreground truncate">{d.deviceName || 'Unknown screen'}</span>
                                            {d.branchCode && <span className="text-xs font-mono text-muted-foreground">branch {d.branchCode}</span>}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className={`text-xs font-bold ${up ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>{up ? 'Online' : 'Offline'}</div>
                                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{lastSeen(d.secondsSinceCheckIn)}</div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <p className="text-[11px] text-muted-foreground mt-3 leading-snug shrink-0">
                Shows screens with this playlist <span className="font-semibold text-foreground">directly assigned</span>. Screens that inherit it from a sibling, and live per-clip playback, are not shown here — the player reports a schedule placeholder rather than the exact playlist.
            </p>

            <div className="mt-4 shrink-0 flex justify-end">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-xs hover:brightness-110 transition-colors"
                >
                    Close
                </button>
            </div>
        </Modal>
    );
};
