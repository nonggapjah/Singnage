'use client';

import React from 'react';
import { Playlist } from '../types/playlist';
import Link from 'next/link';

interface PlaylistTableProps {
    playlists: Playlist[];
    onDelete?: (id: string) => void;
    onDeploy?: (playlist: Playlist) => void;
}

const formatDuration = (seconds?: number) => {
    if (!seconds) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [hrs, mins, secs].map(v => v.toString().padStart(2, '0')).join(':');
};

export const PlaylistTable: React.FC<PlaylistTableProps> = ({ playlists, onDelete, onDeploy }) => {
    return (
        <div className="glass-panel rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-white/5 border-b border-white/10">
                        <th className="px-6 py-4 font-semibold">Name</th>
                        <th className="px-6 py-4 font-semibold">Description</th>
                        <th className="px-6 py-4 font-semibold text-center">Items</th>
                        <th className="px-6 py-4 font-semibold text-center">Duration</th>
                        <th className="px-6 py-4 font-semibold text-center">Status</th>
                        <th className="px-6 py-4 font-semibold text-right whitespace-nowrap">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {playlists.map((playlist) => (
                        <tr key={playlist.playlistId} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                            <td className="px-6 py-4">
                                <span className="font-bold text-accent-cyan group-hover:neon-text transition-all tracking-tight">{playlist.playlistName}</span>
                                <div className="text-[0.625rem] text-gray-600 font-mono mt-0.5 uppercase tracking-wider">{playlist.playlistId.split('-')[0]}...</div>
                            </td>
                            <td className="px-6 py-4 text-gray-400 text-sm leading-relaxed">{playlist.description || '-'}</td>
                            <td className="px-6 py-4 text-center">
                                <span className="font-mono text-xs text-white bg-white/5 px-2 py-1 rounded">{playlist.itemCount || 0}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                                <span className="font-mono text-xs text-accent-cyan">{formatDuration(playlist.totalDuration)}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                                <span className={`px-2 py-1 rounded text-[0.625rem] font-black uppercase tracking-widest ${playlist.active === 'Y' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                    {playlist.active === 'Y' ? 'Active' : 'Inactive'}
                                </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                                <button
                                    onClick={() => onDeploy?.(playlist)}
                                    disabled={playlist.active !== 'Y'}
                                    className={`py-1.5 px-3 rounded-lg text-[0.625rem] font-black uppercase tracking-widest transition-all mr-3 shadow-[0_0_10px_rgba(34,211,238,0.1)] border ${playlist.active === 'Y'
                                        ? 'bg-accent-cyan/10 hover:bg-accent-cyan border-accent-cyan/20 hover:text-black text-accent-cyan'
                                        : 'bg-gray-500/5 text-gray-600 border-white/5 cursor-not-allowed opacity-30 shadow-none'
                                        }`}
                                    title={playlist.active === 'Y' ? 'Deploy to devices' : 'Playlist must be Active to deploy'}
                                >
                                    🚀 Deploy
                                </button>
                                <Link
                                    href={`/admin/playlists/${playlist.playlistId}`}
                                    className="text-gray-400 hover:text-white text-xs font-bold mr-3 transition-colors"
                                >
                                    Edit
                                </Link>
                                <button
                                    onClick={() => onDelete?.(playlist.playlistId)}
                                    className="text-red-900/60 hover:text-red-500 text-xs font-bold transition-colors"
                                >
                                    Delete
                                </button>
                            </td>
                        </tr>
                    ))}
                    {playlists.length === 0 && (
                        <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-gray-500 uppercase tracking-widest">
                                No Playlists Found
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div >
    );
};
