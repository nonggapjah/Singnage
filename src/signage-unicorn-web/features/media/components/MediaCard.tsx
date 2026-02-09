'use client';

import React from 'react';
import { MediaFile } from '../types/media';
import { formatDuration } from '../utils/media-helpers';

interface MediaCardProps {
    media: MediaFile;
    onDelete: (id: string) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({ media, onDelete }) => {
    return (
        <div className="glass-card group rounded-xl overflow-hidden flex flex-col border border-white/5 hover:border-cyan-400/30 transition-all">
            <div className="relative aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                {media.blobUrl.toLowerCase().match(/\.(mp4|webm|ogg)$/) || media.durationSec > 0 ? (
                    <div className="text-4xl">🎬</div>
                ) : (
                    <div className="text-4xl">🖼️</div>
                )}

                {/* Overlay Metadata */}
                <div className="absolute top-2 left-2 flex gap-1">
                    <span className="px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-bold text-white/80 backdrop-blur-md">
                        {media.ratio}
                    </span>
                    {media.durationSec > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-bold text-cyan-400 backdrop-blur-md">
                            {formatDuration(media.durationSec)}
                        </span>
                    )}
                </div>

                <button
                    onClick={() => onDelete(media.mediaId)}
                    className="absolute bottom-2 right-2 p-2 rounded-full bg-red-500/20 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>

            <div className="p-3">
                <p className="text-sm font-medium truncate mb-1" title={media.fileName}>
                    {media.fileName}
                </p>
                <div className="flex justify-between items-center text-[10px] text-white/40 uppercase tracking-widest">
                    <span>{media.fileSizeKb} KB</span>
                    <span>{media.uploadedAt ? new Date(media.uploadedAt).toLocaleDateString() : 'N/A'}</span>
                </div>
            </div>
        </div>
    );
};
