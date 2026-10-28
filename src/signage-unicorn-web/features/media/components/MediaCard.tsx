'use client';

import React from 'react';
import { MediaFile } from '../types/media';
import { formatDuration } from '../utils/media-helpers';

interface MediaCardProps {
    media: MediaFile;
    onDelete: (id: string) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({ media, onDelete }) => {
    const isVideo = !!media.blobUrl.toLowerCase().match(/\.(mp4|webm|ogg)$/) || media.durationSec > 0;

    return (
        <div className="glass-card group rounded-xl overflow-hidden flex flex-col hover:border-accent-cyan/40">
            <div className="relative aspect-video bg-muted/20 flex items-center justify-center overflow-hidden">
                <div className="text-4xl" aria-hidden="true">{isVideo ? '🎬' : '🖼️'}</div>
                <span className="sr-only">{isVideo ? 'Video' : 'Image'}</span>

                {/* Overlay Metadata */}
                <div className="absolute top-2 left-2 flex gap-1">
                    {media.ratio && (
                        <span className="px-1.5 py-0.5 rounded bg-background/80 text-xs font-bold text-foreground">
                            {media.ratio}
                        </span>
                    )}
                    {media.durationSec > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-background/80 text-xs font-bold text-accent-cyan">
                            {formatDuration(media.durationSec)}
                        </span>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => onDelete(media.mediaId)}
                    aria-label={`Delete ${media.displayName || media.fileName}`}
                    title="Delete"
                    className="absolute bottom-2 right-2 p-2 rounded-full bg-red-500/20 text-red-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>

            <div className="p-3">
                <p className="text-sm font-medium truncate mb-1 text-foreground" title={media.fileName}>
                    {media.fileName}
                </p>
                <div className="flex justify-between items-center text-xs text-muted-foreground uppercase tracking-wider">
                    <span>{media.fileSizeKb} KB</span>
                    <span>{media.uploadedAt ? new Date(media.uploadedAt).toLocaleDateString() : 'N/A'}</span>
                </div>
            </div>
        </div>
    );
};
