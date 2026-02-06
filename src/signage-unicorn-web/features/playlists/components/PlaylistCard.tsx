import React from 'react';
import { Playlist } from '../types/playlist';

interface PlaylistCardProps {
    playlist: Playlist;
    onClick: (id: string) => void;
}

export const PlaylistCard: React.FC<PlaylistCardProps> = ({ playlist, onClick }) => {
    return (
        <div
            className="glass-card rounded-xl p-4 cursor-pointer flex flex-col gap-3 group"
            onClick={() => onClick(playlist.playlistId)}
        >
            <div className="relative aspect-video rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
                {playlist.items && playlist.items.length > 0 ? (
                    <img
                        src={playlist.items[0].media?.blobUrl || '/placeholder.png'}
                        alt={playlist.playlistName}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="text-white/20 text-4xl">🎬</div>
                )}
                <div className="absolute top-2 right-2 px-2 py-1 rounded bg-black/60 text-[10px] font-bold text-cyan-400">
                    {playlist.active === 'Y' ? 'ACTIVE' : 'INACTIVE'}
                </div>
            </div>

            <div>
                <h3 className="font-semibold text-lg group-hover:text-cyan-400 transition-colors">
                    {playlist.playlistName}
                </h3>
                <p className="text-white/50 text-sm truncate">
                    {playlist.description || 'No description'}
                </p>
            </div>

            <div className="flex items-center justify-between text-xs text-white/40 border-t border-white/5 pt-3 mt-auto">
                <span>{playlist.items?.length || 0} items</span>
                <span>{new Date(playlist.createdAt).toLocaleDateString()}</span>
            </div>
        </div>
    );
};
