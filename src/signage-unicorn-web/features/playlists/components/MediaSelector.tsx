'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MediaFile } from '../types/playlist';
import { apiFetch } from '@/lib/api-fetch';
import { Modal } from '@/components/ui/Modal';

interface MediaSelectorProps {
    onSelect: (media: MediaFile) => void;
    onClose: () => void;
}


export const MediaSelector: React.FC<MediaSelectorProps> = ({ onSelect, onClose }) => {
    const [mediaList, setMediaList] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const fetchMedia = async () => {
            setLoading(true);
            const res = await apiFetch<MediaFile[]>('/media');
            if (res.success && res.data) {
                setMediaList(res.data);
            }
            setLoading(false);
        };
        fetchMedia();
    }, []);

    const filteredMedia = mediaList.filter(m => {
        const term = search.toLowerCase();
        return (
            m.fileName.toLowerCase().includes(term) ||
            (m.displayName && m.displayName.toLowerCase().includes(term)) ||
            (m.supplier_Code && m.supplier_Code.toLowerCase().includes(term)) ||
            (m.remark1 && m.remark1.toLowerCase().includes(term)) ||
            (m.remark2 && m.remark2.toLowerCase().includes(term))
        );
    });

    const isVideo = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        return ['mp4', 'webm', 'ogg', 'mov'].includes(ext || '');
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="full"
            scroll={false}
            labelledBy="media-selector-title"
            zIndexClass="z-[2000]"
            initialFocusRef={searchRef}
            className="max-h-[85vh] flex flex-col overflow-hidden bg-card-solid"
        >
            {/* Header */}
            <div className="p-6 border-b border-border flex justify-between items-center bg-muted/10">
                <div>
                    <h2 id="media-selector-title" className="text-xl font-black uppercase tracking-tight text-foreground flex items-center gap-2">
                        <span className="text-accent-cyan">Select media</span>
                        <span className="text-muted-foreground text-sm font-normal">({filteredMedia.length} items)</span>
                    </h2>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest mt-1">Add content to the playlist</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close dialog"
                    className="w-8 h-8 rounded-full bg-muted/20 hover:bg-muted/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                    ✕
                </button>
            </div>

            {/* Search Bar */}
            <div className="p-4 border-b border-border/50 bg-muted/10">
                <div className="relative">
                    <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        ref={searchRef}
                        type="search"
                        aria-label="Search media by name, supplier or remark"
                        placeholder="Search by name, supplier, remark…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-muted/20 border border-border rounded-xl pl-12 pr-4 py-3 outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors text-foreground placeholder:text-muted-foreground/70 font-medium"
                    />
                </div>
            </div>

            {/* Content Grid */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {loading ? (
                    <div className="h-full flex flex-col items-center justify-center space-y-4" role="status">
                        <div className="w-10 h-10 border-4 border-accent-cyan border-t-transparent rounded-full animate-spin" aria-hidden="true"></div>
                        <div className="text-accent-cyan font-bold tracking-widest">Loading library…</div>
                    </div>
                ) : filteredMedia.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-sm font-medium uppercase tracking-widest">No matching media found</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" role="group" aria-label="Media files">
                        {filteredMedia.map(media => {
                            const isVid = isVideo(media.fileName);
                            return (
                                <button
                                    type="button"
                                    key={media.mediaId}
                                    onClick={() => onSelect(media)}
                                    aria-label={`Add ${media.displayName || media.fileName}`}
                                    className="group relative bg-muted/10 border border-border/50 rounded-2xl cursor-pointer hover:border-accent-cyan/50 hover:bg-muted/20 transition-colors overflow-hidden flex flex-col text-left"
                                >
                                    {/* Thumbnail Area */}
                                    <div className="aspect-video w-full bg-background relative overflow-hidden border-b border-border/50">
                                        {media.blobUrl && (
                                            isVid ? (
                                                <video src={`${media.blobUrl}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover opacity-70 group-hover:opacity-90 transition-opacity" />
                                            ) : (
                                                <img src={media.blobUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover opacity-70 group-hover:opacity-90 transition-opacity" />
                                            )
                                        )}

                                        {/* Type Badge */}
                                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-background/80 text-xs font-bold text-foreground uppercase border border-border/50">
                                            {isVid ? 'Video' : 'Image'}
                                        </div>

                                        {/* Duration Badge */}
                                        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-background/80 text-xs font-mono font-bold text-accent-cyan border border-border/50">
                                            {media.durationSec}s
                                        </div>

                                        {/* Overlay Play Icon */}
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200 bg-black/20" aria-hidden="true">
                                            <div className="w-10 h-10 rounded-full bg-accent-cyan text-black flex items-center justify-center shadow-lg">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-0.5" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                                                </svg>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Content Area */}
                                    <div className="p-3 flex flex-col text-left flex-1 w-full">
                                        <div className="flex justify-between items-start gap-2 mb-1">
                                            <h3 className="text-sm font-bold text-foreground truncate leading-tight group-hover:text-accent-cyan transition-colors" title={media.displayName}>
                                                {media.displayName || media.fileName}
                                            </h3>
                                        </div>

                                        {/* Metadata Chips */}
                                        <div className="flex flex-wrap gap-1 mt-1 mb-2">
                                            {media.supplier_Code && (
                                                <span className="px-1.5 py-0.5 bg-accent-purple/10 text-accent-purple text-xs rounded border border-accent-purple/20 truncate max-w-[100px]">
                                                    {media.supplier_Code}
                                                </span>
                                            )}
                                            <span className="px-1.5 py-0.5 bg-muted/20 text-muted-foreground text-xs rounded border border-border/50">
                                                {media.ratio}
                                            </span>
                                        </div>

                                        <div className="mt-auto flex flex-col gap-1 pt-2 border-t border-border/50">
                                            <div className="flex justify-between items-center text-xs text-muted-foreground font-mono">
                                                <span>{(media.fileSizeKb / 1024).toFixed(1)} MB</span>
                                                <span>{media.uploadedAt ? new Date(media.uploadedAt).toLocaleDateString() : 'N/A'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border bg-muted/10 text-center text-xs text-muted-foreground" aria-live="polite">
                Showing {filteredMedia.length} of {mediaList.length} media files
            </div>
        </Modal>
    );
};
