'use client';

import React from 'react';
import { Playlist } from '../types/playlist';
import Link from 'next/link';

interface PlaylistTableProps {
    playlists: Playlist[];
    onDelete?: (id: string) => void;
    onDeploy?: (playlist: Playlist) => void;
    onDuplicate?: (playlist: Playlist) => void;
    duplicatingId?: string | null;
}

const formatDuration = (seconds?: number) => {
    if (!seconds) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [hrs, mins, secs].map(v => v.toString().padStart(2, '0')).join(':');
};

export const PlaylistTable: React.FC<PlaylistTableProps> = ({ playlists, onDelete, onDeploy, onDuplicate, duplicatingId }) => {
    return (
        <div className="glass-panel rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-muted/20 border-b border-border">
                            <th scope="col" className="px-6 py-4 font-semibold text-foreground">Name</th>
                            <th scope="col" className="px-6 py-4 font-semibold text-foreground">Description</th>
                            <th scope="col" className="px-6 py-4 font-semibold text-center text-foreground">Items</th>
                            <th scope="col" className="px-6 py-4 font-semibold text-center text-foreground">Duration</th>
                            <th scope="col" className="px-6 py-4 font-semibold text-center text-foreground">Status</th>
                            <th scope="col" className="px-6 py-4 font-semibold text-right whitespace-nowrap text-foreground">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {playlists.map((playlist) => (
                            <tr key={playlist.playlistId} className="border-b border-border/50 hover:bg-muted/10 transition-colors group">
                                <td className="px-6 py-4">
                                    <span className="font-bold text-accent-cyan tracking-tight">{playlist.playlistName}</span>
                                    <div className="text-xs text-muted-foreground font-mono mt-0.5 uppercase tracking-wider">{playlist.playlistId.split('-')[0]}…</div>
                                </td>
                                <td className="px-6 py-4 text-muted-foreground text-sm leading-relaxed">{playlist.description || '-'}</td>
                                <td className="px-6 py-4 text-center">
                                    <span className="font-mono text-xs text-foreground bg-muted/30 px-2 py-1 rounded">{playlist.itemCount || 0}</span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span className="font-mono text-xs text-accent-cyan">{formatDuration(playlist.totalDuration)}</span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <span className={`px-2 py-1 rounded text-xs font-black uppercase tracking-widest ${playlist.active === 'Y' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'}`}>
                                        {playlist.active === 'Y' ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right whitespace-nowrap">
                                    <button
                                        type="button"
                                        onClick={() => onDeploy?.(playlist)}
                                        disabled={playlist.active !== 'Y'}
                                        aria-label={`Deploy ${playlist.playlistName} to devices`}
                                        className={`py-1.5 px-3 rounded-lg text-xs font-black uppercase tracking-widest transition-colors mr-3 border ${playlist.active === 'Y'
                                            ? 'bg-accent-cyan/10 hover:bg-accent-cyan border-accent-cyan/20 hover:text-black text-accent-cyan'
                                            : 'bg-muted/10 text-muted-foreground border-border/50 cursor-not-allowed opacity-40'
                                            }`}
                                        title={playlist.active === 'Y' ? 'Deploy to devices' : 'Playlist must be Active to deploy'}
                                    >
                                        🚀 Deploy
                                    </button>
                                    <Link
                                        href={`/admin/playlists/${playlist.playlistId}`}
                                        aria-label={`Edit ${playlist.playlistName}`}
                                        className="text-muted-foreground hover:text-foreground text-xs font-bold mr-3 transition-colors"
                                    >
                                        Edit
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={() => onDuplicate?.(playlist)}
                                        disabled={duplicatingId === playlist.playlistId}
                                        aria-label={`Duplicate ${playlist.playlistName}`}
                                        className="text-muted-foreground hover:text-accent-cyan text-xs font-bold mr-3 transition-colors disabled:opacity-40 disabled:cursor-wait"
                                        title="Create an inactive copy of this playlist (incl. all videos) to edit"
                                    >
                                        {duplicatingId === playlist.playlistId ? 'Copying…' : 'Duplicate'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDelete?.(playlist.playlistId)}
                                        aria-label={`Delete ${playlist.playlistName}`}
                                        className="text-muted-foreground hover:text-red-500 text-xs font-bold transition-colors"
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {playlists.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground uppercase tracking-widest">
                                    No playlists found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
