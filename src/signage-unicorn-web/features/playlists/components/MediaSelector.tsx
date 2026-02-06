'use client';

import React, { useState, useEffect } from 'react';
import { MediaFile } from '../types/playlist';
import { apiFetch } from '@/lib/api-fetch';

interface MediaSelectorProps {
    onSelect: (media: MediaFile) => void;
    onClose: () => void;
}


export const MediaSelector: React.FC<MediaSelectorProps> = ({ onSelect, onClose }) => {
    const [mediaList, setMediaList] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

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
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl animate-in fade-in duration-200">
            {/* Main Modal Container - Solid Background */}
            <div className="w-full max-w-5xl max-h-[85vh] rounded-3xl flex flex-col overflow-hidden shadow-2xl border border-white/10 bg-[#0f0f0f] animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#141414]">
                    <div>
                        <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-2">
                            <span className="text-accent-cyan">Select Media</span>
                            <span className="text-white/30 text-sm font-normal">({filteredMedia.length} items)</span>
                        </h2>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-1">Add content to playlist</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-all transform hover:rotate-90 hover:scale-110"
                    >
                        ✕
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-4 border-b border-white/5 bg-[#141414]">
                    <div className="relative">
                        <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search by Name, Supplier, Remark..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl pl-12 pr-4 py-3 outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan transition-all text-white placeholder:text-gray-600 font-medium"
                            autoFocus
                        />
                    </div>
                </div>

                {/* Content Grid */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#0f0f0f]">
                    {loading ? (
                        <div className="h-full flex flex-col items-center justify-center space-y-4">
                            <div className="w-10 h-10 border-4 border-accent-cyan border-t-transparent rounded-full animate-spin"></div>
                            <div className="text-accent-cyan font-bold tracking-widest animate-pulse">LOADING LIBRARY...</div>
                        </div>
                    ) : filteredMedia.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-sm font-medium uppercase tracking-widest">No matching media found</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {filteredMedia.map(media => {
                                const isVid = isVideo(media.fileName);
                                return (
                                    <div
                                        key={media.mediaId}
                                        onClick={() => onSelect(media)}
                                        className="group relative bg-[#1a1a1a] border border-white/5 rounded-2xl cursor-pointer hover:border-accent-cyan/50 hover:bg-[#202020] transition-all duration-200 overflow-hidden flex flex-col hover:-translate-y-1 hover:shadow-xl"
                                    >
                                        {/* Thumbnail Area */}
                                        <div className="aspect-video w-full bg-black relative overflow-hidden border-b border-white/5">
                                            {media.blobUrl && (
                                                isVid ? (
                                                    <video src={media.blobUrl} className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
                                                ) : (
                                                    <img src={media.blobUrl} alt={media.fileName} className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
                                                )
                                            )}

                                            {/* Type Badge */}
                                            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-bold text-white uppercase border border-white/10">
                                                {isVid ? 'Video' : 'Image'}
                                            </div>

                                            {/* Duration Badge */}
                                            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-mono font-bold text-accent-cyan border border-white/10">
                                                {media.durationSec}s
                                            </div>

                                            {/* Overlay Play Icon */}
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/20">
                                                <div className="w-10 h-10 rounded-full bg-accent-cyan text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-0.5" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Content Area */}
                                        <div className="p-3 flex flex-col text-left flex-1">
                                            <div className="flex justify-between items-start gap-2 mb-1">
                                                <h3 className="text-sm font-bold text-gray-200 truncate leading-tight group-hover:text-accent-cyan transition-colors" title={media.displayName}>
                                                    {media.displayName || media.fileName}
                                                </h3>
                                            </div>

                                            {/* Metadata Chips */}
                                            <div className="flex flex-wrap gap-1 mt-1 mb-2">
                                                {media.supplier_Code && (
                                                    <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 text-[10px] rounded border border-purple-500/20 truncate max-w-[100px]">
                                                        {media.supplier_Code}
                                                    </span>
                                                )}
                                                <span className="px-1.5 py-0.5 bg-white/5 text-gray-500 text-[10px] rounded border border-white/5">
                                                    {media.ratio}
                                                </span>
                                            </div>

                                            {/* Footer */}
                                            <div className="mt-auto flex justify-between items-center text-[10px] text-gray-600 font-mono pt-2 border-t border-white/5">
                                                <span>{(media.fileSizeKb / 1024).toFixed(1)} MB</span>
                                            </div>
                                        </div>

                                        {/* Selection Ring */}
                                        <div className="absolute inset-0 border-2 border-accent-cyan rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-[0_0_15px_rgba(34,211,238,0.15)]"></div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 bg-[#141414] text-center text-xs text-gray-600">
                    Showing {filteredMedia.length} of {mediaList.length} media files
                </div>
            </div>
        </div>
    );
};
