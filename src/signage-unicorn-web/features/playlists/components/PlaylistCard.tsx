import React from 'react';
import { Playlist } from '../types/playlist';

interface PlaylistCardProps {
    playlist: Playlist;
    onClick: (id: string) => void;
}

export const PlaylistCard: React.FC<PlaylistCardProps> = ({ playlist, onClick }) => {
    const thumbnail = playlist.items && playlist.items.length > 0 ? playlist.items[0].media?.blobUrl : undefined;

    return (
        <button
            type="button"
            className="glass-card rounded-xl p-4 cursor-pointer flex flex-col gap-3 group text-left w-full"
            onClick={() => onClick(playlist.playlistId)}
            aria-label={`Open playlist ${playlist.playlistName}`}
        >
            <div className="relative aspect-video rounded-lg overflow-hidden bg-muted/20 flex items-center justify-center">
                {thumbnail ? (
                    <img
                        src={thumbnail}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="text-muted-foreground text-4xl" aria-hidden="true">🎬</div>
                )}
                <div className="absolute top-2 right-2 px-2 py-1 rounded bg-background/80 text-xs font-bold text-accent-cyan">
                    {playlist.active === 'Y' ? 'ACTIVE' : 'INACTIVE'}
                </div>
            </div>

            <div>
                <h3 className="font-semibold text-lg text-foreground group-hover:text-accent-cyan transition-colors">
                    {playlist.playlistName}
                </h3>
                <p className="text-muted-foreground text-sm truncate">
                    {playlist.description || 'No description'}
                </p>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/50 pt-3 mt-auto">
                <span>{playlist.items?.length || 0} items</span>
                <span>{playlist.createdAt ? new Date(playlist.createdAt).toLocaleDateString() : 'Unknown'}</span>
            </div>
        </button>
    );
};
