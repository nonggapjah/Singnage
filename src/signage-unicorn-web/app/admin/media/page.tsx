'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { mediaApi } from '@/features/media/api/media-api';
import { MediaFile, MediaUsage } from '@/features/media/types/media';
import { MediaUploadZone } from '@/features/media/components/MediaUploadZone';
import { MediaReplaceModal } from '@/features/media/components/MediaReplaceModal';
import { systemApi } from '@/features/system/api/system-api';

type ViewMode = 'thumbnail' | 'list' | 'detail';

export default function MediaLibraryPage() {
    const [viewMode, setViewMode] = useState<ViewMode>('thumbnail');
    const [gridCols, setGridCols] = useState(4);
    const [searchQuery, setSearchQuery] = useState('');
    const [safetyJingleId, setSafetyJingleId] = useState<string | null>(null);
    const [filters, setFilters] = useState({
        searchTerm: '',
        supplierCode: '',
        remark1: '',
        remark2: '',
        mediaType: 'all',
        status: 'all',
        ratio: 'all',
        durationMin: 0,
        durationMax: 300,
        startDate: '',
        endDate: '',
    });
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showUpload, setShowUpload] = useState(false);
    const [editingMedia, setEditingMedia] = useState<MediaFile | null>(null);
    const [previewMedia, setPreviewMedia] = useState<MediaFile | null>(null);
    const [replacementTarget, setReplacementTarget] = useState<MediaFile | null>(null);

    // Data State
    const [mediaList, setMediaList] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(true);

    const [usageList, setUsageList] = useState<MediaUsage[]>([]);
    const [usageLoading, setUsageLoading] = useState(false);
    const [showUsageModal, setShowUsageModal] = useState(false);
    const [selectedMediaForUsage, setSelectedMediaForUsage] = useState<MediaFile | null>(null);

    // Initial Config Load
    useEffect(() => {
        loadSystemConfig();
    }, []);

    // Load media whenever filters change (debounce)
    // Runs on mount as well because initial state triggers it
    useEffect(() => {
        const timer = setTimeout(() => {
            loadMedia();
        }, 500); // 500ms debounce
        return () => clearTimeout(timer);
    }, [filters.searchTerm, filters.supplierCode, filters.remark1, filters.remark2, filters.mediaType, filters.status]);

    const loadSystemConfig = async () => {
        try {
            const res = await systemApi.getSetting('safety_jingle_id');
            if (res.success && res.data) {
                setSafetyJingleId(res.data);
            }
        } catch (e) {
            console.error('Failed to load system config', e);
        }
    };

    const loadMedia = async () => {
        setLoading(true);
        try {
            const res = await mediaApi.getAll({
                searchTerm: filters.searchTerm,
                supplierCode: filters.supplierCode,
                remark1: filters.remark1,
                remark2: filters.remark2,
                status: filters.status === 'all' ? undefined : filters.status,
                mediaType: filters.mediaType === 'all' ? undefined : filters.mediaType
            });
            if (res.success && res.data) {
                setMediaList(res.data);
            }
        } catch (error) {
            console.error("Failed to load media", error);
        } finally {
            setLoading(false);
        }
    };

    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

    // Filter Logic Helper
    const checkAspectRatio = (ratioStr: string, target: string) => {
        if (target === 'all') return true;

        const [w, h] = ratioStr.split(':').map(Number);
        if (!w || !h) return false;

        const numeric = w / h;
        // Tolerance for floating point (e.g. 1920/1080 = 1.7777...)
        const tolerance = 0.05;

        let targetNumeric = 0;
        if (target === '16:9') targetNumeric = 16 / 9;
        else if (target === '9:16') targetNumeric = 9 / 16;
        else if (target === '1:1') targetNumeric = 1;

        return Math.abs(numeric - targetNumeric) < tolerance;
    };

    const filteredMedia = mediaList.filter(m => {
        // Local filtering for things not handled by server yet (Ratio, Date, Duration)
        const matchesRatio = checkAspectRatio(m.ratio, filters.ratio);
        const matchesDuration = m.durationSec >= filters.durationMin && m.durationSec <= filters.durationMax;


        let matchesDate = true;
        if (filters.startDate) matchesDate = matchesDate && new Date(m.uploadedAt || '') >= new Date(filters.startDate);
        if (filters.endDate) matchesDate = matchesDate && new Date(m.uploadedAt || '') <= new Date(filters.endDate);

        return matchesRatio && matchesDuration && matchesDate;
    }).sort((a, b) => {
        if (!sortConfig) return 0;

        const { key, direction } = sortConfig;

        // Helper to safe get value
        const getValue = (obj: any, k: string) => {
            if (k === 'size') return obj.fileSizeKb;
            if (k === 'date') return new Date(obj.uploadedAt).getTime();
            return obj[k] || '';
        };

        const valA = getValue(a, key);
        const valB = getValue(b, key);

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    const handleSort = (key: string) => {
        setSortConfig(current => {
            if (current?.key === key) {
                return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
    };

    const handleUploadSuccess = async (newMediaId?: string) => {
        if (replacementTarget && newMediaId) {
            // Perform Replacement
            if (confirm(`Replace media "${replacementTarget.displayName}" content with new upload in ALL playlists?`)) {
                try {
                    const res = await mediaApi.replace(replacementTarget.mediaId, newMediaId, true);
                    if (res.success) {
                        alert("Media Replaced Successfully!");
                    } else {
                        alert("Replacement Failed: " + res.message);
                    }
                } catch (e) {
                    console.error(e);
                    alert("Replacement Error");
                }
            }
        }

        setShowUpload(false);
        setReplacementTarget(null);
        loadMedia();
    };

    const handleUpdateMedia = async (updated: MediaFile) => {
        try {
            const res = await mediaApi.update(updated.mediaId, updated);
            if (res.success) {
                setMediaList(prev => prev.map(m => m.mediaId === updated.mediaId ? updated : m));
                setEditingMedia(null);
            } else {
                alert("Failed to update media: " + (res.message || 'Unknown error'));
            }
        } catch (error) {
            console.error("Update error", error);
            alert("An error occurred while updating.");
        }
    };

    const handleDeleteMedia = async (id: string, force: boolean = false) => {
        const msg = force
            ? 'This media is IN USE. Forcing delete will remove it from all playlists. Proceed?'
            : 'Are you sure you want to delete this asset?';

        if (!confirm(msg)) return;

        try {
            const res = await mediaApi.delete(id, force);
            if (res.success) {
                setMediaList(prev => prev.filter(m => m.mediaId !== id));
            } else if (res.code === 409 && !force) {
                // Handle "In Use" error by offering force delete
                if (confirm(`${res.message}\n\nDo you want to FORCE DELETE it anyway? (It will be hidden from playlists)`)) {
                    await handleDeleteMedia(id, true);
                }
            } else {
                alert("Failed to delete media: " + (res.message || 'Unknown error'));
            }
        } catch (error) {
            console.error("Delete error", error);
            alert("An error occurred while deleting.");
        }
    };

    const handleViewUsage = async (m: MediaFile) => {
        setSelectedMediaForUsage(m);
        setUsageLoading(true);
        setShowUsageModal(true);
        setUsageList([]); // Clear previous
        try {
            const res = await mediaApi.getUsage(m.mediaId);
            if (res.success && res.data) {
                setUsageList(res.data);
            }
        } catch (error) {
            console.error("Failed to load usage", error);
        } finally {
            setUsageLoading(false);
        }
    };

    const getGridClass = () => {
        switch (gridCols) {
            case 2: return 'grid-cols-2';
            case 3: return 'grid-cols-3';
            case 4: return 'grid-cols-4';
            case 5: return 'grid-cols-5';
            case 6: return 'grid-cols-6';
            default: return 'grid-cols-4';
        }
    };

    return (
        <div className="p-8 lg:p-10 space-y-8 max-w-[1800px] mx-auto page-transition">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 animate-in">
                {/* ... existing header content ... */}
                <div className="space-y-2">
                    <h1 className="text-5xl font-black neon-text uppercase tracking-tighter">Media Library</h1>
                    <p className="text-[var(--foreground)] opacity-70 font-medium tracking-tight">Manage and organize your digital assets across the network</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* ... existing sync button ... */}
                    <button
                        onClick={async () => {
                            if (confirm('Fix Local Media URLs? This will update all media paths to match the current server IP.')) {
                                try {
                                    const res = await systemApi.syncMedia();
                                    if (res.success) {
                                        alert('Media URLs Synced!');
                                        loadMedia();
                                    } else {
                                        alert('Sync Failed: ' + res.message);
                                    }
                                } catch (e) {
                                    console.error(e);
                                    alert('Sync Error');
                                }
                            }
                        }}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 text-accent-cyan border border-gray-700 hover:border-accent-cyan transition-all shadow-[0_0_15px_rgba(0,0,0,0.3)] text-lg pb-1"
                        title="Fix Local IP / Sync Media URLs"
                    >
                        ↻
                    </button>
                    <button
                        onClick={() => { setShowUpload(!showUpload); setReplacementTarget(null); }}
                        className={`btn-primary shadow-[0_0_20px_rgba(157,0,255,0.3)] whitespace-nowrap ${showUpload ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : ''}`}
                    >
                        {showUpload ? '✕ Cancel' : '↑ Upload File'}
                    </button>
                </div>
            </header>

            {showUpload && (
                <div className="animate-in slide-in-from-top-4 duration-500 mb-8">
                    <MediaUploadZone
                        onUploadSuccess={handleUploadSuccess}
                        onCancel={() => setShowUpload(false)}
                    />
                </div>
            )}

            {replacementTarget && (
                <MediaReplaceModal
                    targetMedia={replacementTarget}
                    onClose={() => setReplacementTarget(null)}
                    onSuccess={() => {
                        setReplacementTarget(null);
                        loadMedia();
                        alert("Media Replaced Successfully!");
                    }}
                />
            )}

            {/* --- Toolbar & Controls --- */}
            <div className="glass-panel p-6 rounded-3xl border-white/5 animate-in stagger-1 space-y-6">
                <div className="flex flex-wrap justify-between items-end gap-6">
                    {/* Search Bar */}
                    <div className="w-full md:w-96">
                        <span className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1 mb-2 block">Quick Search</span>
                        <div className="relative group">
                            <input
                                type="text"
                                placeholder="Search by name, file, or code..."
                                value={filters.searchTerm}
                                onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:border-accent-cyan focus:shadow-[0_0_15px_rgba(34,211,238,0.2)] transition-all"
                            />
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-accent-cyan transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className={`px-4 py-2.5 rounded-xl border transition-all text-xs font-black uppercase tracking-widest flex items-center gap-2 ${showAdvanced ? 'bg-accent-cyan/20 border-accent-cyan text-accent-cyan' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/20'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                            </svg>
                            Advanced Filters
                        </button>

                        <div className="h-10 w-px bg-white/10 hidden md:block"></div>

                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-black text-gray-500 uppercase tracking-widest pl-1">View Mode</span>
                            <div className="flex bg-black/40 rounded-xl p-1 border border-white/5 gap-1">
                                <button
                                    onClick={() => setViewMode('thumbnail')}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${viewMode === 'thumbnail' ? 'bg-accent-cyan text-black shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                                >
                                    GRID
                                </button>
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${viewMode === 'list' ? 'bg-accent-cyan text-black shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                                >
                                    LIST
                                </button>
                                <button
                                    onClick={() => setViewMode('detail')}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${viewMode === 'detail' ? 'bg-accent-cyan text-black shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                                >
                                    DETAIL
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-black text-gray-500 uppercase tracking-widest pl-1">Status</span>
                            <select
                                value={filters.status}
                                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                                className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:border-accent-cyan text-[var(--foreground)]"
                            >
                                <option value="all" className="bg-gray-900">All Status</option>
                                <option value="Y" className="bg-gray-900 text-green-400">Active</option>
                                <option value="N" className="bg-gray-900 text-red-100/50">Inactive</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* --- Advanced Search Panel --- */}
                {showAdvanced && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pt-6 border-t border-white/5 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Supplier Code</label>
                            <input
                                type="text"
                                placeholder="Enter code..."
                                value={filters.supplierCode}
                                onChange={(e) => setFilters({ ...filters, supplierCode: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs outline-none focus:border-accent-cyan"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Media Type</label>
                            <select
                                value={filters.mediaType}
                                onChange={(e) => setFilters({ ...filters, mediaType: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:border-accent-cyan text-[var(--foreground)]"
                            >
                                <option value="all" className="bg-gray-900">All Types</option>
                                <option value="video" className="bg-gray-900">Videos Only</option>
                                <option value="image" className="bg-gray-900">Images Only</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Remark 1</label>
                            <input
                                type="text"
                                placeholder="Search remark 1..."
                                value={filters.remark1}
                                onChange={(e) => setFilters({ ...filters, remark1: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs outline-none focus:border-accent-cyan"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Remark 2</label>
                            <input
                                type="text"
                                placeholder="Search remark 2..."
                                value={filters.remark2}
                                onChange={(e) => setFilters({ ...filters, remark2: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs outline-none focus:border-accent-cyan"
                            />
                        </div>

                        {/* Second Row of Advanced Filters */}
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Aspect Ratio</label>
                            <select
                                value={filters.ratio}
                                onChange={(e) => setFilters({ ...filters, ratio: e.target.value })}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:border-accent-cyan text-[var(--foreground)]"
                            >
                                <option value="all" className="bg-gray-900">All Ratios</option>
                                <option value="16:9" className="bg-gray-900">16:9 (Landscape)</option>
                                <option value="9:16" className="bg-gray-900">9:16 (Portrait)</option>
                                <option value="1:1" className="bg-gray-900">1:1 (Square)</option>
                            </select>
                        </div>

                        <div className="lg:col-span-2 space-y-2">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Duration Range ({filters.durationMin}s - {filters.durationMax}s)</label>
                            <div className="flex items-center gap-4">
                                <input
                                    type="range" min="0" max="300" step="5"
                                    value={filters.durationMin}
                                    onChange={(e) => setFilters({ ...filters, durationMin: Math.min(parseInt(e.target.value), filters.durationMax) })}
                                    className="flex-1 accent-accent-cyan"
                                />
                                <input
                                    type="range" min="0" max="300" step="5"
                                    value={filters.durationMax}
                                    onChange={(e) => setFilters({ ...filters, durationMax: Math.max(parseInt(e.target.value), filters.durationMin) })}
                                    className="flex-1 accent-accent-cyan"
                                />
                            </div>
                        </div>

                        <div className="flex items-end gap-2">
                            <button
                                onClick={() => setFilters({
                                    searchTerm: '',
                                    supplierCode: '',
                                    remark1: '',
                                    remark2: '',
                                    mediaType: 'all',
                                    status: 'all',
                                    ratio: 'all',
                                    durationMin: 0,
                                    durationMax: 300,
                                    startDate: '',
                                    endDate: '',
                                })}
                                className="w-full py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all"
                            >
                                Clear All Filters
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* --- Media Content --- */}
            <div className="animate-in stagger-2">
                {viewMode === 'thumbnail' && (
                    <div className={`grid ${getGridClass()} gap-6`}>
                        {filteredMedia.map((m) => (
                            <div
                                key={m.mediaId}
                                className="glass-card rounded-2xl overflow-hidden group relative cursor-pointer hover:border-accent-cyan/50 transition-all border border-transparent"
                                onClick={() => setPreviewMedia(m)}
                            >
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setEditingMedia(m); }}
                                        className="p-1.5 bg-black/60 hover:bg-accent-cyan/80 rounded-lg backdrop-blur-md transition-colors"
                                        title="Edit Metadata"
                                    >
                                        ✏️
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setReplacementTarget(m); setShowUpload(true); }}
                                        className="p-1.5 bg-black/60 hover:bg-yellow-500/80 rounded-lg backdrop-blur-md transition-colors"
                                        title="Replace Content (Keep ID)"
                                    >
                                        ⇄
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteMedia(m.mediaId); }}
                                        className="p-1.5 bg-black/60 hover:bg-red-500/80 rounded-lg backdrop-blur-md transition-colors"
                                        title="Delete Asset"
                                    >
                                        🗑️
                                    </button>
                                </div>
                                <div className="aspect-video bg-black/40 flex items-center justify-center relative overflow-hidden">
                                    {m.blobUrl ? (
                                        m.fileName.toLowerCase().match(/\.(mp4|webm|mov)$/) ? (
                                            <video
                                                src={m.blobUrl}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                                muted
                                                onMouseOver={e => (e.target as HTMLVideoElement).play()}
                                                onMouseOut={e => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                                            />
                                        ) : (
                                            <img
                                                src={m.blobUrl}
                                                alt={m.displayName}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                            />
                                        )
                                    ) : (
                                        <span className="text-4xl text-white/20">{m.fileName.endsWith('.mp4') ? '🎬' : '🖼️'}</span>
                                    )}

                                    <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors pointer-events-none"></div>

                                    {/* Play Icon Overlay for videos */}
                                    {m.fileName.toLowerCase().match(/\.(mp4|webm|mov)$/) && (
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                                            <div className="w-12 h-12 rounded-full bg-accent-cyan/90 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                                                <svg className="w-6 h-6 text-black ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                            </div>
                                        </div>
                                    )}

                                    <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-xs font-bold">
                                        {m.durationSec > 0 ? `${m.durationSec}s` : m.ratio}
                                    </div>
                                </div>
                                <div className="p-4 space-y-1">
                                    <p className="text-sm font-bold truncate text-[var(--foreground)] group-hover:text-accent-cyan transition-colors">{m.displayName || m.fileName}</p>
                                    <div className="flex justify-between text-xs text-gray-500 uppercase font-black">
                                        <span className="truncate mr-2 w-2/3">{m.fileName}</span>
                                        <span className="whitespace-nowrap">{(m.fileSizeKb / 1024).toFixed(1)} MB</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {viewMode === 'list' && (
                    <div className="glass-panel rounded-2xl overflow-hidden border-white/5">
                        <table className="w-full text-left">
                            <thead className="bg-white/5 border-b border-white/10 text-xs uppercase tracking-widest font-black text-gray-500">
                                <tr>
                                    <th className="px-6 py-4">Preview</th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('fileName')}>
                                        File Name {sortConfig?.key === 'fileName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th className="px-6 py-4 hidden xl:table-cell">Remarks</th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors hidden lg:table-cell" onClick={() => handleSort('ratio')}>
                                        Dimensions {sortConfig?.key === 'ratio' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors hidden md:table-cell" onClick={() => handleSort('durationSec')}>
                                        Duration {sortConfig?.key === 'durationSec' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors hidden lg:table-cell" onClick={() => handleSort('size')}>
                                        Size {sortConfig?.key === 'size' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors hidden xl:table-cell" onClick={() => handleSort('date')}>
                                        Date {sortConfig?.key === 'date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th className="px-6 py-4 text-right pr-12">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filteredMedia.map((m) => (
                                    <tr key={m.mediaId} className="hover:bg-white/5 transition-colors cursor-pointer group" onClick={() => setPreviewMedia(m)}>
                                        <td className="px-6 py-4">
                                            <div className="w-12 h-8 rounded bg-black/50 overflow-hidden relative">
                                                {m.blobUrl && m.fileName.match(/\.(mp4|webm|mov)$/i) ? (
                                                    <video src={m.blobUrl} className="w-full h-full object-cover" />
                                                ) : m.blobUrl ? (
                                                    <img src={m.blobUrl} className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-xs flex items-center justify-center h-full">?</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-sm font-bold text-[var(--foreground)] group-hover:text-accent-cyan transition-colors">{m.displayName || m.fileName}</p>
                                            <p className="text-xs text-gray-500 truncate max-w-[200px]">{m.fileName}</p>
                                        </td>
                                        <td className="px-6 py-4 hidden xl:table-cell">
                                            <div className="flex flex-col gap-0.5">
                                                {m.remark1 && <span className="text-xs text-[var(--foreground)]/80 truncate max-w-[150px]">{m.remark1}</span>}
                                                {m.remark2 && <span className="text-xs text-gray-500 truncate max-w-[150px]">{m.remark2}</span>}
                                                {!m.remark1 && !m.remark2 && <span className="text-xs text-gray-600">-</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-xs font-mono text-gray-500 hidden lg:table-cell">{m.ratio}</td>
                                        <td className="px-6 py-4 text-xs font-bold text-gray-500 hidden md:table-cell">{m.durationSec}s</td>
                                        <td className="px-6 py-4 text-xs text-gray-500 hidden lg:table-cell">{(m.fileSizeKb / 1024).toFixed(1)} MB</td>
                                        <td className="px-6 py-4 text-xs text-gray-500 font-mono hidden xl:table-cell">{m.uploadedAt}</td>
                                        <td className="px-6 py-4 text-right pr-12">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEditingMedia(m); }}
                                                    className="p-1.5 hover:bg-accent-cyan/20 text-gray-400 hover:text-accent-cyan rounded-lg transition-colors"
                                                    title="Edit Metadata"
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setReplacementTarget(m); setShowUpload(true); }}
                                                    className="p-1.5 hover:bg-yellow-500/10 text-gray-400 hover:text-yellow-500 rounded-lg transition-colors"
                                                    title="Replace Content (Keep ID)"
                                                >
                                                    ⇄
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteMedia(m.mediaId); }}
                                                    className="p-1.5 hover:bg-red-500/10 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
                                                    title="Delete Asset"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Keep Detail View (Assuming user is happy with it, just added onClick preview) */}
                {viewMode === 'detail' && (
                    <div className="space-y-4">
                        {filteredMedia.map((m) => (
                            <div key={m.mediaId} onClick={() => setPreviewMedia(m)} className="glass-panel p-6 rounded-2xl border-white/5 flex flex-col md:flex-row gap-6 hover:border-accent-cyan/30 transition-all group cursor-pointer">
                                {/* (Content similiar to before, just showing thumbnail instead of icon) */}
                                <div className="w-full md:w-64 aspect-video bg-black/60 rounded-xl flex items-center justify-center overflow-hidden">
                                    {m.blobUrl ? (
                                        m.fileName.match(/\.(mp4|webm|mov)$/i) ? (
                                            <video src={m.blobUrl} className="w-full h-full object-cover" />
                                        ) : (
                                            <img src={m.blobUrl} className="w-full h-full object-cover" />
                                        )
                                    ) : (
                                        <span className="text-4xl">{m.fileName.endsWith('.mp4') ? '🎥' : '🖼️'}</span>
                                    )}
                                </div>
                                <div className="flex-1 space-y-4">
                                    {/* ... Existing Details ... */}
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="text-xl font-black text-[var(--foreground)] group-hover:text-accent-cyan transition-colors">{m.displayName || m.fileName}</h3>
                                            <p className="text-xs text-gray-400 font-mono tracking-tight mt-1">{m.fileName}</p>
                                        </div>
                                    </div>
                                    {/* ... properties ... */}
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                        <div className="bg-[var(--foreground)]/5 p-3 rounded-xl border border-[var(--foreground)]/10">
                                            <p className="text-xs text-[var(--foreground)]/60 uppercase font-black">Resolution Ratio</p>
                                            <p className="text-sm font-bold text-[var(--foreground)]">{m.ratio}</p>
                                        </div>
                                        <div className="bg-[var(--foreground)]/5 p-3 rounded-xl border border-[var(--foreground)]/10">
                                            <p className="text-xs text-[var(--foreground)]/60 uppercase font-black">Video Length</p>
                                            <p className="text-sm font-bold text-[var(--foreground)]">{m.durationSec} Seconds</p>
                                        </div>
                                        <div className="bg-[var(--foreground)]/5 p-3 rounded-xl border border-[var(--foreground)]/10">
                                            <p className="text-xs text-[var(--foreground)]/60 uppercase font-black">File Size</p>
                                            <p className="text-sm font-bold text-[var(--foreground)]">{(m.fileSizeKb / 1024).toFixed(2)} MB</p>
                                        </div>
                                        <div className="bg-[var(--foreground)]/5 p-3 rounded-xl border border-[var(--foreground)]/10">
                                            <p className="text-xs text-[var(--foreground)]/60 uppercase font-black">Supplier Code</p>
                                            <p className="text-sm font-bold text-[var(--foreground)]">{m.supplier_Code || '-'}</p>
                                        </div>
                                        <div className="bg-[var(--foreground)]/5 p-3 rounded-xl border border-[var(--foreground)]/10">
                                            <p className="text-xs text-[var(--foreground)]/60 uppercase font-black">Remark 1</p>
                                            <p className="text-sm font-bold text-[var(--foreground)]">{m.remark1 || '-'}</p>
                                        </div>
                                        <div className="bg-[var(--foreground)]/5 p-3 rounded-xl border border-[var(--foreground)]/10">
                                            <p className="text-xs text-[var(--foreground)]/60 uppercase font-black">Remark 2</p>
                                            <p className="text-sm font-bold text-[var(--foreground)]">{m.remark2 || '-'}</p>
                                        </div>
                                        <div className="bg-[var(--foreground)]/5 p-3 rounded-xl border border-[var(--foreground)]/10">
                                            <p className="text-xs text-[var(--foreground)]/60 uppercase font-black">Upload Date</p>
                                            <p className="text-sm font-bold text-[var(--foreground)]">{m.uploadedAt}</p>
                                        </div>
                                        <div
                                            onClick={(e) => { e.stopPropagation(); handleViewUsage(m); }}
                                            className="bg-accent-cyan/10 p-3 rounded-xl border border-accent-cyan/20 hover:bg-accent-cyan/20 transition-colors group/usage"
                                        >
                                            <p className="text-xs text-accent-cyan font-black uppercase tracking-tighter">In Playlists</p>
                                            <div className="flex items-center justify-between">
                                                <p className="text-sm font-bold text-accent-cyan">View Assignments</p>
                                                <span className="w-6 h-6 rounded-full bg-accent-cyan text-black text-xs font-black flex items-center justify-center shadow-[0_0_10px_rgba(34,211,238,0.5)] group-hover/usage:scale-110 transition-transform">
                                                    →
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* --- PREVIEW MODAL --- */}
            {previewMedia && (
                <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[150] flex items-center justify-center p-4 md:p-10 animate-in fade-in duration-300">
                    <div className="relative w-full max-w-6xl aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col">
                        <div className="absolute top-4 right-4 z-20 flex gap-2">
                            <button
                                onClick={() => setPreviewMedia(null)}
                                className="w-10 h-10 rounded-full bg-black/50 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur-md transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="flex-1 flex items-center justify-center bg-black relative overflow-hidden">
                            {previewMedia.blobUrl && previewMedia.fileName.toLowerCase().match(/\.(mp4|webm|mov)$/) ? (
                                <video
                                    src={previewMedia.blobUrl}
                                    className="w-full h-full object-contain bg-black"
                                    controls
                                    autoPlay
                                />
                            ) : (
                                <img
                                    src={previewMedia.blobUrl || ''}
                                    className="w-full h-full object-contain bg-black"
                                    alt="Preview"
                                />
                            )}
                        </div>

                        <div className="p-6 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 w-full pointer-events-none">
                            <h2 className="text-2xl font-bold text-white mb-1 drop-shadow-md">{previewMedia.displayName}</h2>
                            <div className="flex gap-4 text-sm text-gray-300 drop-shadow-md">
                                <span>{previewMedia.fileName}</span>
                                <span>•</span>
                                <span>{previewMedia.ratio}</span>
                                <span>•</span>
                                <span>{previewMedia.durationSec}s</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Editing Overlay/Modal */}
            {editingMedia && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="w-full max-w-2xl p-8 rounded-3xl bg-[var(--background)] border border-[var(--foreground)]/10 shadow-2xl space-y-8 relative overflow-hidden">
                        {/* Decorative gradient for 'Unicorn' feel even in solid mode */}
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent-cyan to-transparent opacity-50"></div>

                        <div className="flex justify-between items-center">
                            <h2 className="text-3xl font-black uppercase italic tracking-tighter text-[var(--foreground)] drop-shadow-sm">Edit Fragment Data</h2>
                            <button
                                onClick={() => setEditingMedia(null)}
                                className="text-[var(--foreground)]/50 hover:text-[var(--foreground)] transition-colors text-2xl"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1 col-span-2">
                                <label className="text-xs font-black text-[var(--foreground)]/60 uppercase tracking-widest ml-1">Display Name</label>
                                <input
                                    type="text"
                                    value={editingMedia.displayName}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, displayName: e.target.value })}
                                    className="w-full bg-[var(--foreground)]/5 border border-[var(--foreground)]/10 rounded-xl px-4 py-3 text-lg text-[var(--foreground)] outline-none focus:border-accent-cyan transition-colors"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-black text-[var(--foreground)]/60 uppercase tracking-widest ml-1">Supplier Code</label>
                                <input
                                    type="text"
                                    value={editingMedia.supplier_Code || ''}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, supplier_Code: e.target.value })}
                                    className="w-full bg-[var(--foreground)]/5 border border-[var(--foreground)]/10 rounded-xl px-4 py-2 text-[var(--foreground)] outline-none focus:border-accent-cyan transition-colors"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-black text-[var(--foreground)]/60 uppercase tracking-widest ml-1">Status</label>
                                <select
                                    value={editingMedia.active}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, active: e.target.value as 'Y' | 'N' })}
                                    className="w-full bg-[var(--foreground)]/5 border border-[var(--foreground)]/10 rounded-xl px-4 py-2 text-[var(--foreground)] outline-none focus:border-accent-cyan transition-colors appearance-none"
                                >
                                    <option value="Y" className="text-black">Active</option>
                                    <option value="N" className="text-black">Inactive</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-black text-[var(--foreground)]/60 uppercase tracking-widest ml-1">Remark 1</label>
                                <input
                                    type="text"
                                    value={editingMedia.remark1 || ''}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, remark1: e.target.value })}
                                    className="w-full bg-[var(--foreground)]/5 border border-[var(--foreground)]/10 rounded-xl px-4 py-2 text-[var(--foreground)] outline-none focus:border-accent-cyan transition-colors"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-black text-[var(--foreground)]/60 uppercase tracking-widest ml-1">Remark 2</label>
                                <input
                                    type="text"
                                    value={editingMedia.remark2 || ''}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, remark2: e.target.value })}
                                    className="w-full bg-[var(--foreground)]/5 border border-[var(--foreground)]/10 rounded-xl px-4 py-2 text-[var(--foreground)] outline-none focus:border-accent-cyan transition-colors"
                                />
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button
                                onClick={() => setEditingMedia(null)}
                                className="flex-1 py-3 rounded-xl bg-[var(--foreground)]/5 text-[var(--foreground)]/70 font-bold hover:bg-[var(--foreground)]/10 transition-all uppercase tracking-widest border border-[var(--foreground)]/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleUpdateMedia(editingMedia)}
                                className="flex-[2] py-3 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-black font-black hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all uppercase tracking-widest"
                            >
                                Commit Changes
                            </button>
                        </div>

                        {/* Special Actions */}
                        <div className="border-t border-[var(--foreground)]/10 pt-6">
                            <h4 className="text-xs font-black text-[var(--foreground)]/40 uppercase tracking-widest mb-4">System Configuration</h4>
                            <div className="flex items-center justify-between bg-yellow-500/5 p-4 rounded-xl border border-yellow-500/10">
                                <div>
                                    <div className="text-yellow-500 font-bold uppercase text-xs tracking-wider">Safety Jingle / Fallback</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        Use this media as the default safety jingle/fallback image for all devices.
                                        {safetyJingleId === editingMedia.mediaId && <span className="ml-2 bg-green-500 text-black px-2 py-0.5 rounded font-black">CURRENTLY ACTIVE</span>}
                                    </div>
                                </div>
                                <button
                                    onClick={async () => {
                                        if (confirm('Set this as the Global Safety Jingle? All devices will update on next sync.')) {
                                            const res = await systemApi.setSetting('safety_jingle_id', editingMedia.mediaId);
                                            if (res.success) {
                                                setSafetyJingleId(editingMedia.mediaId);
                                                alert('Safety Jingle Updated!');
                                            } else {
                                                alert('Failed to update setting.');
                                            }
                                        }
                                    }}
                                    disabled={safetyJingleId === editingMedia.mediaId}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${safetyJingleId === editingMedia.mediaId ? 'bg-green-500/20 text-green-500 cursor-default' : 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500 hover:text-black'}`}
                                >
                                    {safetyJingleId === editingMedia.mediaId ? 'Is Active Jingle' : 'Set as Jingle'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- USAGE MODAL --- */}
            {showUsageModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="w-full max-w-2xl glass-panel rounded-3xl border border-white/10 shadow-2xl p-8 space-y-6 relative">
                        <div className="flex justify-between items-center border-b border-white/5 pb-6">
                            <div>
                                <h3 className="text-2xl font-black text-white uppercase italic tracking-tighter">Media Usage Report</h3>
                                <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-1">
                                    File: <span className="text-accent-cyan">{selectedMediaForUsage?.displayName || selectedMediaForUsage?.fileName}</span>
                                </p>
                            </div>
                            <button
                                onClick={() => setShowUsageModal(false)}
                                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 text-white flex items-center justify-center transition-colors"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                            {usageLoading ? (
                                <div className="py-20 text-center">
                                    <div className="animate-spin text-4xl mb-4">⌛</div>
                                    <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Analyzing network usage...</p>
                                </div>
                            ) : usageList.length > 0 ? (
                                <table className="w-full text-left">
                                    <thead className="text-xs text-gray-500 uppercase font-black tracking-widest">
                                        <tr className="border-b border-white/5">
                                            <th className="pb-4 px-2">Playlist Name</th>
                                            <th className="pb-4 px-2">Status</th>
                                            <th className="pb-4 px-2 text-center">In Set</th>
                                            <th className="pb-4 px-2 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {usageList.map((usage, idx) => (
                                            <tr key={idx} className="group hover:bg-white/5 transition-colors">
                                                <td className="py-4 px-2">
                                                    <Link
                                                        href={`/admin/playlists/${usage.playlistId}`}
                                                        className="text-sm font-bold text-white group-hover:text-accent-cyan transition-colors"
                                                    >
                                                        {usage.playlistName}
                                                    </Link>
                                                </td>
                                                <td className="py-4 px-2">
                                                    <span className={`px-2 py-1 rounded text-xs font-black uppercase ${usage.active === 'Y' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                                        {usage.active === 'Y' ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-2 text-center text-sm font-mono font-bold text-gray-400">
                                                    {usage.usageCount}
                                                </td>
                                                <td className="py-4 px-2 text-right">
                                                    <Link
                                                        href={`/admin/playlists/${usage.playlistId}`}
                                                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan hover:text-black transition-all"
                                                        title="Edit Playlist"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                        </svg>
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="py-20 text-center bg-black/20 rounded-2xl border border-white/5">
                                    <p className="text-4xl mb-4 opacity-20">🍃</p>
                                    <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">This media is not currently assigned to any playlists.</p>
                                </div>
                            )}
                        </div>

                        <div className="pt-4 flex justify-end">
                            <button
                                onClick={() => setShowUsageModal(false)}
                                className="px-8 py-3 rounded-xl bg-white/5 text-white font-black uppercase tracking-widest hover:bg-white/10 transition-all border border-white/10"
                            >
                                Close Report
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
