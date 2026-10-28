'use client';

import React, { useState, useEffect } from 'react';
import { expiryDateForApi, parseApiDate, utcIsoToLocalDateInput } from '@/features/ui/utils/datetime';
import { getCapabilities, peekCapabilities, LEGACY_CAPABILITIES } from '@/lib/api-capabilities';
import Link from 'next/link';
import { mediaApi } from '@/features/media/api/media-api';
import { MediaFile, MediaUsage } from '@/features/media/types/media';
import { MediaUploadZone } from '@/features/media/components/MediaUploadZone';
import { MediaReplaceModal } from '@/features/media/components/MediaReplaceModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { systemApi } from '@/features/system/api/system-api';

type ViewMode = 'thumbnail' | 'list' | 'detail';

const isVideoFile = (fileName: string) => /\.(mp4|webm|mov)$/i.test(fileName);

export default function MediaLibraryPage() {
    const [viewMode, setViewMode] = useState<ViewMode>('thumbnail');
    const [gridCols] = useState(4);
    const [safetyJingleId, setSafetyJingleId] = useState<string | null>(null);
    const [filters, setFilters] = useState({
        searchTerm: '',
        supplierCode: '',
        remark1: '',
        remark2: '',
        mediaType: 'all',
        status: 'Y',
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

    // Confirm Modal State
    const [confirmState, setConfirmState] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => Promise<void> | void;
        variant: 'danger' | 'warning' | 'info' | 'success';
        confirmText?: string;
        cancelText?: string | null;
        isLoading: boolean;
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
        variant: 'info',
        isLoading: false
    });

    const openConfirm = (
        title: string,
        message: string,
        onConfirm: () => Promise<void> | void,
        variant: 'danger' | 'warning' | 'info' | 'success' = 'warning',
        confirmText: string = 'Confirm',
        cancelText: string | null = 'Cancel'
    ) => {
        setConfirmState({
            isOpen: true,
            title,
            message,
            onConfirm,
            variant,
            confirmText,
            cancelText,
            isLoading: false
        });
    };

    const openAlert = (
        title: string,
        message: string,
        variant: 'danger' | 'warning' | 'info' | 'success' = 'info'
    ) => {
        setConfirmState({
            isOpen: true,
            title,
            message,
            onConfirm: () => { },
            variant,
            confirmText: 'OK',
            cancelText: null, // No cancel button
            isLoading: false
        });
    };

    const handleConfirmAction = async () => {
        setConfirmState(prev => ({ ...prev, isLoading: true }));
        try {
            await confirmState.onConfirm();
            setConfirmState(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
            console.error(error);
            // Close to avoid a stuck state; errors are surfaced inside onConfirm.
            setConfirmState(prev => ({ ...prev, isOpen: false }));
        } finally {
            setConfirmState(prev => ({ ...prev, isLoading: false }));
        }
    };

    // Initial Config Load
    // Probe API capabilities early: the expiry-date input converts synchronously (expiryDateForApi).
    useEffect(() => { void getCapabilities(); }, []);

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
            // backend expects: searchTerm, supplierCode, remark1, remark2, status, mediaType
            const res = await mediaApi.getAll({
                searchTerm: filters.searchTerm,
                supplierCode: filters.supplierCode,
                remark1: filters.remark1,
                remark2: filters.remark2,
                status: filters.status, // 'active' | 'inactive' | 'all'
                mediaType: filters.mediaType // 'video' | 'image' | 'all'
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
        // Client-side only: compare the UTC upload time against local day boundaries.
        const uploaded = parseApiDate(m.uploadedAt);
        if (filters.startDate) matchesDate = matchesDate && !!uploaded && uploaded >= new Date(`${filters.startDate}T00:00:00`);
        if (filters.endDate) matchesDate = matchesDate && !!uploaded && uploaded <= new Date(`${filters.endDate}T23:59:59.999`);

        return matchesRatio && matchesDuration && matchesDate;
    }).sort((a, b) => {
        if (!sortConfig) return 0;

        const { key, direction } = sortConfig;

        // Helper to safe get value
        const getValue = (obj: MediaFile, k: string): string | number => {
            if (k === 'size') return obj.fileSizeKb;
            if (k === 'date') return new Date(obj.uploadedAt || 0).getTime();
            const raw = (obj as unknown as Record<string, unknown>)[k];
            return typeof raw === 'number' ? raw : (raw ? String(raw) : '');
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
            openConfirm(
                'Replace media content?',
                `This will replace content for "${replacementTarget.displayName}" in ALL playlists. This action cannot be undone.`,
                async () => {
                    try {
                        const res = await mediaApi.replace(replacementTarget.mediaId, newMediaId, true);
                        if (res.success) {
                            loadMedia();
                            openAlert('Success', 'Media replaced successfully.', 'success');
                        } else {
                            openAlert('Replacement failed', res.message, 'danger');
                        }
                    } catch (e) {
                        console.error(e);
                        openAlert('Error', 'An error occurred during replacement', 'danger');
                    }
                },
                'warning',
                'Yes, replace all'
            );
        }

        setShowUpload(false);
        setReplacementTarget(null);
        loadMedia();
    };

    const handleUpdateMedia = async (updated: MediaFile) => {
        try {
            // Handle Status Change Logic (Active/Inactive mapped to Restore/Delete)
            if (updated.active === 'N') {
                // User wants to deactivate (Soft Delete)
                const res = await mediaApi.delete(updated.mediaId);
                if (!res.success) {
                    openAlert('Update failed', `Could not set to Inactive: ${res.message}. It might be in use.`, 'danger');
                    return;
                }
            } else {
                // User wants to activate (Restore) - Ensure it's not deleted first
                // We call restore just in case it was deleted. If it wasn't, no harm.
                await mediaApi.restore(updated.mediaId);
            }

            // Proceed with updating other fields
            const res = await mediaApi.update(updated.mediaId, updated);

            if (res.success) {
                openAlert('Success', 'Media updated successfully.', 'success');

                // Optimistic UI Update: Reflect changes immediately without waiting for network
                setMediaList(current => current.map(m =>
                    m.mediaId === updated.mediaId ? { ...m, ...updated } : m
                ));

                await loadMedia();
                setEditingMedia(null);
            } else {
                openAlert('Update failed', res.message || 'Unknown error', 'danger');
            }
        } catch (error) {
            console.error("Update error", error);
            openAlert('Error', 'An error occurred while updating', 'danger');
        }
    };

    const handleDeleteMedia = async (id: string, force: boolean = false) => {
        const title = force ? 'Force delete media?' : 'Delete media?';
        const msg = force
            ? 'This media is IN USE. Forcing delete will remove it from all playlists. Proceeding will break existing playlists.'
            : 'Are you sure you want to delete this file? It will be moved to trash.';

        openConfirm(
            title,
            msg,
            async () => {
                try {
                    const res = await mediaApi.delete(id, force);
                    if (res.success) {
                        setMediaList(prev => prev.filter(m => m.mediaId !== id));
                    } else if (res.code === 409 && !force) {
                        // Recursive confirm for force delete; setTimeout lets the state update settle.
                        setTimeout(() => {
                            openConfirm(
                                'Media in use',
                                `${res.message}\n\nDo you want to FORCE DELETE it anyway? (It will be hidden from playlists)`,
                                () => handleDeleteMedia(id, true),
                                'danger',
                                'Force delete'
                            );
                        }, 200);
                    } else {
                        openAlert('Delete failed', res.message || 'Unknown error', 'danger');
                    }
                } catch (error) {
                    console.error("Delete error", error);
                    openAlert('Error', 'An error occurred while deleting', 'danger');
                }
            },
            force ? 'danger' : 'warning',
            force ? 'Force delete' : 'Delete'
        );
    };

    const handleRestoreMedia = (m: MediaFile) => {
        openConfirm(
            'Restore media',
            'This will re-activate the media file.',
            async () => {
                try {
                    const res = await mediaApi.restore(m.mediaId);
                    if (res.success) {
                        loadMedia();
                        openAlert('Restored', 'Media re-activated successfully', 'success');
                    } else {
                        openAlert('Restore failed', res.message, 'danger');
                    }
                } catch {
                    openAlert('Error', 'Restore failed', 'danger');
                }
            },
            'info',
            'Yes, activate'
        );
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

    const handleEditClick = async (media: MediaFile) => {
        // Fetch fresh data first; fall back to the cached copy on failure.
        try {
            const res = await mediaApi.getById(media.mediaId);
            if (res.success && res.data) {
                setEditingMedia(res.data);
            } else {
                openAlert('Error', 'Failed to fetch latest data. Using cached version.', 'warning');
                setEditingMedia(media);
            }
        } catch (error) {
            console.error("Failed to fetch media details", error);
            setEditingMedia(media);
        }
    };

    const getGridClass = () => {
        switch (gridCols) {
            case 2: return 'grid-cols-1 sm:grid-cols-2';
            case 3: return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
            case 4: return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
            case 5: return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-5';
            case 6: return 'grid-cols-2 lg:grid-cols-4 xl:grid-cols-6';
            default: return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
        }
    };

    const sortIndicator = (key: string) => sortConfig?.key === key ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';
    const ariaSort = (key: string): 'ascending' | 'descending' | 'none' =>
        sortConfig?.key === key ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none';

    const fieldClass = 'w-full bg-muted/20 border border-border rounded-xl px-4 py-2 text-xs text-foreground outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors placeholder:text-muted-foreground/70';
    const labelClass = 'block text-xs font-black text-muted-foreground uppercase tracking-widest ml-1';
    const editFieldClass = 'w-full bg-muted/20 border border-border rounded-xl px-4 py-2 text-foreground outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors';

    const ActionButtons = ({ m, compact = false }: { m: MediaFile; compact?: boolean }) => (
        <div className={`flex gap-1 ${compact ? 'justify-end' : ''}`}>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleEditClick(m); }}
                className="p-1.5 bg-background/80 hover:bg-accent-cyan/80 rounded-lg transition-colors"
                title="Edit details"
                aria-label={`Edit details of ${m.displayName || m.fileName}`}
            >
                <span aria-hidden="true">✏️</span>
            </button>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setReplacementTarget(m); setShowUpload(true); }}
                className="p-1.5 bg-background/80 hover:bg-yellow-500/80 rounded-lg transition-colors"
                title="Replace content (keep ID)"
                aria-label={`Replace content of ${m.displayName || m.fileName}`}
            >
                <span aria-hidden="true">⇄</span>
            </button>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    if (m.active === 'N') handleRestoreMedia(m);
                    else handleDeleteMedia(m.mediaId, false);
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${m.active === 'N'
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500 hover:text-white'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white'
                    }`}
                title={m.active === 'N' ? 'Restore / activate' : 'Delete / deactivate'}
                aria-label={m.active === 'N' ? `Restore ${m.displayName || m.fileName}` : `Delete ${m.displayName || m.fileName}`}
            >
                <span aria-hidden="true">{m.active === 'N' ? '↺' : '✕'}</span>
            </button>
        </div>
    );

    const Thumb = ({ m, className = '' }: { m: MediaFile; className?: string }) => (
        m.blobUrl ? (
            isVideoFile(m.fileName) ? (
                // preload="metadata" + the #t=0.1 media fragment make the browser fetch just enough to
                // paint the frame at 0.1 s as a poster, so the card shows a real still instead of a black
                // box. preload="none" (the previous value) fetched nothing, so nothing was ever painted.
                <video src={`${m.blobUrl}#t=0.1`} preload="metadata" muted playsInline className={className} />
            ) : (
                <img src={m.blobUrl} alt="" loading="lazy" decoding="async" className={className} />
            )
        ) : (
            <span className="text-4xl text-muted-foreground" aria-hidden="true">{isVideoFile(m.fileName) ? '🎬' : '🖼️'}</span>
        )
    );

    return (
        <div className="p-8 lg:p-10 space-y-8 max-w-[1800px] mx-auto page-transition">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 animate-in">
                <div className="space-y-2">
                    <h1 className="text-5xl font-black neon-text uppercase tracking-tighter">Media library</h1>
                    <p className="text-muted-foreground font-medium tracking-tight">Upload, organize and replace the files your screens play</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    <button
                        type="button"
                        onClick={() => {
                            openConfirm(
                                'Sync media URLs?',
                                'This will fix local media URLs by updating all paths to match the current server IP configuration.',
                                async () => {
                                    try {
                                        const res = await systemApi.syncMedia();
                                        if (res.success) {
                                            loadMedia();
                                            openAlert('Sync complete', 'Media URLs have been synchronized.', 'success');
                                        } else {
                                            openAlert('Sync failed', res.message, 'danger');
                                        }
                                    } catch (e) {
                                        console.error(e);
                                        openAlert('Error', 'An error occurred during sync', 'danger');
                                    }
                                },
                                'info',
                                'Start sync'
                            );
                        }}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-muted/30 hover:bg-muted/50 text-accent-cyan border border-border hover:border-accent-cyan transition-colors text-lg"
                        title="Fix local IP / sync media URLs"
                        aria-label="Sync media URLs to the current server address"
                    >
                        <span aria-hidden="true">↻</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            openConfirm(
                                'Run expiry check?',
                                'This will immediately check for expired media and remove them from the system. This action cannot be undone for items that are past their end date.',
                                async () => {
                                    try {
                                        const res = await mediaApi.runCleanup();
                                        if (res.success) {
                                            if (res.data === 0) {
                                                openAlert('Check complete', 'No expired media found.', 'info');
                                            } else {
                                                openAlert('Cleanup complete', res.message, 'success');
                                                loadMedia();
                                            }
                                        } else {
                                            openAlert('Cleanup failed', res.message, 'danger');
                                        }
                                    } catch {
                                        openAlert('Error', 'An error occurred during cleanup', 'danger');
                                    }
                                },
                                'warning',
                                'Run check'
                            );
                        }}
                        className="h-10 px-4 flex items-center justify-center rounded-xl bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border border-yellow-500/20 transition-colors font-bold text-xs uppercase tracking-wider gap-2"
                        title="Media expiry check"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Media expiry check
                    </button>
                    <button
                        type="button"
                        onClick={() => { setShowUpload(!showUpload); setReplacementTarget(null); }}
                        aria-expanded={showUpload}
                        className={`btn-primary whitespace-nowrap ${showUpload ? 'bg-red-500 hover:bg-red-600' : ''}`}
                    >
                        {showUpload ? '✕ Cancel' : '↑ Upload file'}
                    </button>
                </div>
            </header>

            {showUpload && (
                <div className="animate-in mb-8">
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
                        openAlert('Success', 'Media replaced successfully.', 'success');
                    }}
                />
            )}

            {/* --- Toolbar & Controls --- */}
            <div className="glass-panel p-6 rounded-3xl animate-in stagger-1 space-y-6">
                <div className="flex flex-wrap justify-between items-end gap-6">
                    {/* Search Bar */}
                    <div className="w-full md:w-96">
                        <label htmlFor="media-search" className={`${labelClass} mb-2`}>Quick search</label>
                        <div className="relative group">
                            <input
                                id="media-search"
                                type="search"
                                placeholder="Search by name, file, or code…"
                                value={filters.searchTerm}
                                onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                                className="w-full bg-muted/20 border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors placeholder:text-muted-foreground/70"
                            />
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-accent-cyan transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                        <button
                            type="button"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            aria-expanded={showAdvanced}
                            aria-controls="media-advanced-filters"
                            className={`px-4 py-2.5 rounded-xl border transition-colors text-xs font-black uppercase tracking-widest flex items-center gap-2 ${showAdvanced ? 'bg-accent-cyan/20 border-accent-cyan text-accent-cyan' : 'bg-muted/20 border-border text-muted-foreground hover:text-foreground hover:border-border'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                            </svg>
                            Advanced filters
                        </button>

                        <div className="h-10 w-px bg-border hidden md:block" aria-hidden="true"></div>

                        <div className="flex flex-col gap-1">
                            <span className={`${labelClass} pl-1`} id="media-view-mode-label">View mode</span>
                            <div className="flex bg-muted/20 rounded-xl p-1 border border-border/50 gap-1" role="group" aria-labelledby="media-view-mode-label">
                                {(['thumbnail', 'list', 'detail'] as ViewMode[]).map((mode) => (
                                    <button
                                        type="button"
                                        key={mode}
                                        onClick={() => setViewMode(mode)}
                                        aria-pressed={viewMode === mode}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-colors ${viewMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}`}
                                    >
                                        {mode === 'thumbnail' ? 'Grid' : mode}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label htmlFor="media-status" className={`${labelClass} pl-1`}>Status</label>
                            <select
                                id="media-status"
                                value={filters.status}
                                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                                className="bg-muted/20 border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-accent-cyan text-foreground"
                            >
                                <option value="">All statuses</option>
                                <option value="Y">Active</option>
                                <option value="N">Inactive</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* --- Advanced Search Panel --- */}
                {showAdvanced && (
                    <div id="media-advanced-filters" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pt-6 border-t border-border/50">
                        <div className="space-y-2">
                            <label htmlFor="media-filter-supplier" className={labelClass}>Supplier code</label>
                            <input
                                id="media-filter-supplier"
                                type="text"
                                placeholder="Enter code…"
                                value={filters.supplierCode}
                                onChange={(e) => setFilters({ ...filters, supplierCode: e.target.value })}
                                className={fieldClass}
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="media-filter-type" className={labelClass}>Media type</label>
                            <select
                                id="media-filter-type"
                                value={filters.mediaType}
                                onChange={(e) => setFilters({ ...filters, mediaType: e.target.value })}
                                className={fieldClass}
                            >
                                <option value="all">All types</option>
                                <option value="video">Videos only</option>
                                <option value="image">Images only</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="media-filter-remark1" className={labelClass}>Remark 1</label>
                            <input
                                id="media-filter-remark1"
                                type="text"
                                placeholder="Search remark 1…"
                                value={filters.remark1}
                                onChange={(e) => setFilters({ ...filters, remark1: e.target.value })}
                                className={fieldClass}
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="media-filter-remark2" className={labelClass}>Remark 2</label>
                            <input
                                id="media-filter-remark2"
                                type="text"
                                placeholder="Search remark 2…"
                                value={filters.remark2}
                                onChange={(e) => setFilters({ ...filters, remark2: e.target.value })}
                                className={fieldClass}
                            />
                        </div>

                        {/* Second Row of Advanced Filters */}
                        <div className="space-y-2">
                            <label htmlFor="media-filter-ratio" className={labelClass}>Aspect ratio</label>
                            <select
                                id="media-filter-ratio"
                                value={filters.ratio}
                                onChange={(e) => setFilters({ ...filters, ratio: e.target.value })}
                                className={fieldClass}
                            >
                                <option value="all">All ratios</option>
                                <option value="16:9">16:9 (landscape)</option>
                                <option value="9:16">9:16 (portrait)</option>
                                <option value="1:1">1:1 (square)</option>
                            </select>
                        </div>

                        <div className="lg:col-span-2 space-y-2">
                            <span className={labelClass} id="media-filter-duration-label">Duration range ({filters.durationMin}s – {filters.durationMax}s)</span>
                            <div className="flex items-center gap-4" role="group" aria-labelledby="media-filter-duration-label">
                                <input
                                    type="range" min="0" max="300" step="5"
                                    aria-label="Minimum duration in seconds"
                                    value={filters.durationMin}
                                    onChange={(e) => setFilters({ ...filters, durationMin: Math.min(parseInt(e.target.value), filters.durationMax) })}
                                    className="flex-1 accent-[var(--accent-cyan)]"
                                />
                                <input
                                    type="range" min="0" max="300" step="5"
                                    aria-label="Maximum duration in seconds"
                                    value={filters.durationMax}
                                    onChange={(e) => setFilters({ ...filters, durationMax: Math.max(parseInt(e.target.value), filters.durationMin) })}
                                    className="flex-1 accent-[var(--accent-cyan)]"
                                />
                            </div>
                        </div>

                        <div className="flex items-end gap-2">
                            <button
                                type="button"
                                onClick={() => setFilters({
                                    searchTerm: '',
                                    supplierCode: '',
                                    remark1: '',
                                    remark2: '',
                                    mediaType: 'all',
                                    status: 'Y',
                                    ratio: 'all',
                                    durationMin: 0,
                                    durationMax: 300,
                                    startDate: '',
                                    endDate: '',
                                })}
                                className="w-full py-2 bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-colors"
                            >
                                Clear all filters
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* --- Media Content --- */}
            <div className="animate-in stagger-2" aria-busy={loading}>
                {loading && mediaList.length === 0 && (
                    <p className="text-sm text-muted-foreground" role="status">Loading media…</p>
                )}

                {viewMode === 'thumbnail' && (
                    <div className={`grid ${getGridClass()} gap-6`}>
                        {filteredMedia.map((m) => (
                            <article
                                key={m.mediaId}
                                className="glass-card rounded-2xl overflow-hidden group relative hover:border-accent-cyan/50"
                            >
                                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-10">
                                    <ActionButtons m={m} />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPreviewMedia(m)}
                                    aria-label={`Preview ${m.displayName || m.fileName}`}
                                    className="block w-full text-left"
                                >
                                    <div className="aspect-video bg-muted/20 flex items-center justify-center relative overflow-hidden">
                                        <Thumb m={m} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />

                                        {/* Play Icon Overlay for videos */}
                                        {isVideoFile(m.fileName) && (
                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">
                                                <div className="w-12 h-12 rounded-full bg-accent-cyan/90 flex items-center justify-center shadow-lg">
                                                    <svg className="w-6 h-6 text-black ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                </div>
                                            </div>
                                        )}

                                        <div className="absolute bottom-2 right-2 bg-background/80 px-2 py-0.5 rounded text-xs font-bold text-foreground">
                                            {m.durationSec > 0 ? `${m.durationSec}s` : m.ratio}
                                        </div>
                                    </div>
                                    <div className="p-3 space-y-1">
                                        <div className="flex justify-between items-start gap-2 min-h-6">
                                            <p className="text-sm font-bold truncate text-foreground group-hover:text-accent-cyan transition-colors flex-1" title={m.displayName}>{m.displayName || m.fileName}</p>
                                            {m.endDate && (
                                                <span className="text-xs text-red-600 dark:text-red-400 font-bold whitespace-nowrap bg-red-500/10 px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0 flex items-center h-5 mt-0.5">
                                                    End: {new Date(m.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex justify-between items-center text-xs text-muted-foreground uppercase font-bold tracking-tight">
                                            <div className="truncate w-3/4 flex items-center" title={`${m.supplier_Code ? m.supplier_Code + ' / ' : ''}${m.fileName}`}>
                                                {m.supplier_Code && (
                                                    <>
                                                        <span className="text-accent-cyan whitespace-nowrap mr-1">{m.supplier_Code}</span>
                                                        <span className="mr-1" aria-hidden="true">/</span>
                                                    </>
                                                )}
                                                <span className="truncate">{m.fileName}</span>
                                            </div>
                                            <span className="whitespace-nowrap ml-2">{(m.fileSizeKb / 1024).toFixed(1)} MB</span>
                                        </div>
                                    </div>
                                </button>
                            </article>
                        ))}
                    </div>
                )}

                {viewMode === 'list' && (
                    <div className="glass-panel rounded-2xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-muted/20 border-b border-border text-xs uppercase tracking-widest font-black text-muted-foreground">
                                    <tr>
                                        <th scope="col" className="px-6 py-4">Preview</th>
                                        <th scope="col" className="px-6 py-4" aria-sort={ariaSort('fileName')}>
                                            <button type="button" className="hover:text-foreground transition-colors uppercase font-black" onClick={() => handleSort('fileName')}>File name{sortIndicator('fileName')}</button>
                                        </th>
                                        <th scope="col" className="px-6 py-4 hidden xl:table-cell">Remarks</th>
                                        <th scope="col" className="px-6 py-4 hidden lg:table-cell" aria-sort={ariaSort('ratio')}>
                                            <button type="button" className="hover:text-foreground transition-colors uppercase font-black" onClick={() => handleSort('ratio')}>Dimensions{sortIndicator('ratio')}</button>
                                        </th>
                                        <th scope="col" className="px-6 py-4 hidden md:table-cell" aria-sort={ariaSort('durationSec')}>
                                            <button type="button" className="hover:text-foreground transition-colors uppercase font-black" onClick={() => handleSort('durationSec')}>Duration{sortIndicator('durationSec')}</button>
                                        </th>
                                        <th scope="col" className="px-6 py-4 hidden lg:table-cell" aria-sort={ariaSort('size')}>
                                            <button type="button" className="hover:text-foreground transition-colors uppercase font-black" onClick={() => handleSort('size')}>Size{sortIndicator('size')}</button>
                                        </th>
                                        <th scope="col" className="px-6 py-4 hidden xl:table-cell" aria-sort={ariaSort('date')}>
                                            <button type="button" className="hover:text-foreground transition-colors uppercase font-black" onClick={() => handleSort('date')}>Date{sortIndicator('date')}</button>
                                        </th>
                                        <th scope="col" className="px-6 py-4 text-right pr-12">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/50">
                                    {filteredMedia.map((m) => (
                                        <tr key={m.mediaId} className="hover:bg-muted/10 transition-colors group">
                                            <td className="px-6 py-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setPreviewMedia(m)}
                                                    aria-label={`Preview ${m.displayName || m.fileName}`}
                                                    className="w-12 h-8 rounded bg-background/60 overflow-hidden relative block"
                                                >
                                                    {m.blobUrl ? (
                                                        <Thumb m={m} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <span className="text-xs flex items-center justify-center h-full" aria-hidden="true">?</span>
                                                    )}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4">
                                                <button type="button" onClick={() => setPreviewMedia(m)} className="text-left">
                                                    <p className="text-sm font-bold text-foreground group-hover:text-accent-cyan transition-colors" title={m.displayName}>{m.displayName || m.fileName}</p>
                                                </button>
                                                <p className="text-xs text-muted-foreground truncate font-mono" title={m.fileName}>{m.fileName}</p>
                                                {m.supplier_Code && (
                                                    <p className="text-xs text-accent-cyan font-mono mt-1 truncate" title="Supplier code">
                                                        <span className="opacity-60 mr-1">Supplier code:</span>{m.supplier_Code}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 hidden xl:table-cell">
                                                <div className="flex flex-col gap-0.5">
                                                    {m.remark1 && <span className="text-xs text-foreground/80 truncate max-w-[200px]">{m.remark1}</span>}
                                                    {m.remark2 && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{m.remark2}</span>}
                                                    {!m.remark1 && !m.remark2 && <span className="text-xs text-muted-foreground">-</span>}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-xs font-mono text-muted-foreground hidden lg:table-cell">{m.ratio}</td>
                                            <td className="px-6 py-4 text-xs font-bold text-muted-foreground hidden md:table-cell">{m.durationSec}s</td>
                                            <td className="px-6 py-4 text-xs text-muted-foreground hidden lg:table-cell">{(m.fileSizeKb / 1024).toFixed(1)} MB</td>
                                            <td className="px-6 py-4 text-xs text-muted-foreground font-mono hidden xl:table-cell">
                                                <div>{m.uploadedAt?.split('T')[0]}</div>
                                                {m.endDate && (
                                                    <div className="text-xs text-red-600 dark:text-red-400 font-bold mt-0.5" title="Expires on">End: {m.endDate.split('T')[0]}</div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right pr-12">
                                                <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                                    <ActionButtons m={m} compact />
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {viewMode === 'detail' && (
                    <div className="space-y-4">
                        {filteredMedia.map((m) => (
                            <article key={m.mediaId} className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row gap-6 hover:border-accent-cyan/30 transition-colors group">
                                <button
                                    type="button"
                                    onClick={() => setPreviewMedia(m)}
                                    aria-label={`Preview ${m.displayName || m.fileName}`}
                                    className="w-full md:w-64 aspect-video bg-background/60 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
                                >
                                    <Thumb m={m} className="w-full h-full object-cover" />
                                </button>
                                <div className="flex-1 space-y-4 min-w-0">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="min-w-0">
                                            <h3 className="text-2xl sm:text-3xl font-black text-foreground group-hover:text-accent-cyan transition-colors tracking-tighter uppercase mb-1 truncate">{m.displayName || m.fileName}</h3>
                                            <p className="text-sm text-muted-foreground font-mono tracking-tight flex items-center gap-2 flex-wrap">
                                                <span className="text-accent-cyan font-bold">Supplier code: {m.supplier_Code || '-'}</span>
                                                <span aria-hidden="true">/</span>
                                                <span>{m.fileName}</span>
                                                {m.endDate && (
                                                    <>
                                                        <span aria-hidden="true">/</span>
                                                        <span className="text-red-600 dark:text-red-400 font-bold">
                                                            End date: {new Date(m.endDate).toLocaleDateString('en-GB')}
                                                        </span>
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                        <ActionButtons m={m} compact />
                                    </div>
                                    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                        {[
                                            ['Aspect ratio', m.ratio],
                                            ['Length', `${m.durationSec} seconds`],
                                            ['File size', `${(m.fileSizeKb / 1024).toFixed(2)} MB`],
                                            ['Supplier code', m.supplier_Code || '-'],
                                            ['Remark 1', m.remark1 || '-'],
                                            ['Remark 2', m.remark2 || '-'],
                                            ['Upload date', m.uploadedAt ? new Date(m.uploadedAt).toLocaleString() : '-'],
                                        ].map(([label, value]) => (
                                            <div key={label} className="bg-muted/10 p-3 rounded-xl border border-border/50 min-w-0">
                                                <dt className="text-xs text-muted-foreground uppercase font-black">{label}</dt>
                                                <dd className="text-sm font-bold text-foreground truncate" title={String(value)}>{value}</dd>
                                            </div>
                                        ))}
                                        <div>
                                            <button
                                                type="button"
                                                onClick={() => handleViewUsage(m)}
                                                className="w-full h-full text-left bg-accent-cyan/10 p-3 rounded-xl border border-accent-cyan/20 hover:bg-accent-cyan/20 transition-colors group/usage"
                                            >
                                                <span className="block text-xs text-accent-cyan font-black uppercase tracking-tighter">In playlists</span>
                                                <span className="flex items-center justify-between">
                                                    <span className="text-sm font-bold text-accent-cyan">View assignments</span>
                                                    <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-black flex items-center justify-center group-hover/usage:scale-110 transition-transform" aria-hidden="true">
                                                        →
                                                    </span>
                                                </span>
                                            </button>
                                        </div>
                                    </dl>
                                </div>
                            </article>
                        ))}
                    </div>
                )}

                {!loading && filteredMedia.length === 0 && (
                    <p className="py-16 text-center text-muted-foreground text-sm uppercase tracking-widest">No media matches the current filters</p>
                )}
            </div>

            {/* --- PREVIEW MODAL --- */}
            <Modal
                isOpen={!!previewMedia}
                onClose={() => setPreviewMedia(null)}
                size="none"
                scroll={false}
                showClose
                title={previewMedia ? `Preview: ${previewMedia.displayName || previewMedia.fileName}` : 'Preview'}
                zIndexClass="z-[1050]"
                className="max-w-6xl aspect-video bg-black border-border flex flex-col overflow-hidden"
            >
                {previewMedia && (
                    <>
                        <div className="flex-1 flex items-center justify-center bg-black relative overflow-hidden">
                            {previewMedia.blobUrl && isVideoFile(previewMedia.fileName) ? (
                                <video
                                    src={previewMedia.blobUrl}
                                    className="w-full h-full object-contain bg-black"
                                    controls
                                    autoPlay
                                    playsInline
                                />
                            ) : (
                                <img
                                    src={previewMedia.blobUrl || ''}
                                    className="w-full h-full object-contain bg-black"
                                    alt={previewMedia.displayName || previewMedia.fileName}
                                />
                            )}
                        </div>

                        <div className="p-6 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 w-full pointer-events-none pr-16">
                            <h2 className="text-2xl font-bold text-white mb-1 drop-shadow-md">{previewMedia.displayName}</h2>
                            <div className="flex gap-4 text-sm text-gray-200 drop-shadow-md flex-wrap">
                                <span>{previewMedia.fileName}</span>
                                <span aria-hidden="true">•</span>
                                <span>{previewMedia.ratio}</span>
                                <span aria-hidden="true">•</span>
                                <span>{previewMedia.durationSec}s</span>
                            </div>
                        </div>
                    </>
                )}
            </Modal>

            {/* Editing Modal */}
            <Modal
                isOpen={!!editingMedia}
                onClose={() => setEditingMedia(null)}
                size="2xl"
                showClose
                labelledBy="media-edit-title"
                zIndexClass="z-[1000]"
                className="p-8 space-y-8 overflow-hidden"
            >
                {editingMedia && (
                    <>
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent-cyan to-transparent opacity-60" aria-hidden="true"></div>

                        <div className="pr-10">
                            <h2 id="media-edit-title" className="text-3xl font-black uppercase tracking-tighter text-foreground">Edit media details</h2>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1 md:col-span-2">
                                <label htmlFor="edit-display-name" className={labelClass}>Display name</label>
                                <input
                                    id="edit-display-name"
                                    type="text"
                                    value={editingMedia.displayName}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, displayName: e.target.value })}
                                    className={`${editFieldClass} py-3 text-lg`}
                                />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="edit-supplier" className={labelClass}>Supplier code</label>
                                <input
                                    id="edit-supplier"
                                    type="text"
                                    value={editingMedia.supplier_Code || ''}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, supplier_Code: e.target.value })}
                                    className={editFieldClass}
                                />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="edit-status" className={labelClass}>Status</label>
                                <select
                                    id="edit-status"
                                    value={editingMedia.active}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, active: e.target.value as 'Y' | 'N' })}
                                    className={editFieldClass}
                                >
                                    <option value="Y">Active</option>
                                    <option value="N">Inactive</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="edit-remark1" className={labelClass}>Remark 1</label>
                                <input
                                    id="edit-remark1"
                                    type="text"
                                    value={editingMedia.remark1 || ''}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, remark1: e.target.value })}
                                    className={editFieldClass}
                                />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="edit-remark2" className={labelClass}>Remark 2</label>
                                <input
                                    id="edit-remark2"
                                    type="text"
                                    value={editingMedia.remark2 || ''}
                                    onChange={(e) => setEditingMedia({ ...editingMedia, remark2: e.target.value })}
                                    className={editFieldClass}
                                />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="edit-end-date" className={labelClass}>End date (expiry)</label>
                                <input
                                    id="edit-end-date"
                                    type="date"
                                    value={utcIsoToLocalDateInput(editingMedia.endDate)}
                                    onChange={(e) => {
                                        // Expiry date = end of that local day, stored as UTC "Z".
                                        const val = expiryDateForApi(e.target.value, (peekCapabilities() ?? LEGACY_CAPABILITIES).utcFilters);
                                        setEditingMedia({ ...editingMedia, endDate: val });
                                    }}
                                    aria-describedby="edit-end-date-hint"
                                    className={`${editFieldClass} dark:[color-scheme:dark]`}
                                />
                                <p id="edit-end-date-hint" className="text-xs text-muted-foreground font-mono mt-1">* Expires at the start of this date</p>
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button
                                type="button"
                                onClick={() => setEditingMedia(null)}
                                className="flex-1 py-3 rounded-xl bg-muted/20 text-muted-foreground font-bold hover:bg-muted/40 hover:text-foreground transition-colors uppercase tracking-widest border border-border"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => handleUpdateMedia(editingMedia)}
                                className="flex-[2] py-3 rounded-xl bg-primary hover:brightness-110 text-primary-foreground font-black transition-colors uppercase tracking-widest"
                            >
                                Save changes
                            </button>
                        </div>

                        {/* Special Actions */}
                        <div className="border-t border-border pt-6">
                            <h4 className="text-xs font-black text-muted-foreground uppercase tracking-widest mb-4">System configuration</h4>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-yellow-500/5 p-4 rounded-xl border border-yellow-500/20">
                                <div>
                                    <div className="text-yellow-700 dark:text-yellow-400 font-bold uppercase text-xs tracking-wider">Safety jingle / fallback</div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        Use this media as the default safety jingle / fallback image for all devices.
                                        {safetyJingleId === editingMedia.mediaId && <span className="ml-2 bg-green-500 text-black px-2 py-0.5 rounded font-black">Currently active</span>}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (confirm('Set this as the global safety jingle? All devices will update on next sync.')) {
                                            const res = await systemApi.setSetting('safety_jingle_id', editingMedia.mediaId);
                                            if (res.success) {
                                                setSafetyJingleId(editingMedia.mediaId);
                                                alert('Safety jingle updated.');
                                            } else {
                                                alert('Failed to update setting.');
                                            }
                                        }
                                    }}
                                    disabled={safetyJingleId === editingMedia.mediaId}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors shrink-0 ${safetyJingleId === editingMedia.mediaId ? 'bg-green-500/20 text-green-700 dark:text-green-400 cursor-default' : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500 hover:text-white'}`}
                                >
                                    {safetyJingleId === editingMedia.mediaId ? 'Active jingle' : 'Set as jingle'}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </Modal>

            {/* --- USAGE MODAL --- */}
            <Modal
                isOpen={showUsageModal}
                onClose={() => setShowUsageModal(false)}
                size="2xl"
                showClose
                labelledBy="media-usage-title"
                zIndexClass="z-[1000]"
                className="p-8 space-y-6"
            >
                <div className="border-b border-border/50 pb-6 pr-10">
                    <h3 id="media-usage-title" className="text-2xl font-black text-foreground uppercase tracking-tighter">Where this media is used</h3>
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mt-1">
                        File: <span className="text-accent-cyan">{selectedMediaForUsage?.displayName || selectedMediaForUsage?.fileName}</span>
                    </p>
                </div>

                <div className="max-h-[400px] overflow-y-auto custom-scrollbar pr-2" aria-busy={usageLoading}>
                    {usageLoading ? (
                        <div className="py-20 text-center" role="status">
                            <div className="animate-spin text-4xl mb-4" aria-hidden="true">⌛</div>
                            <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">Loading…</p>
                        </div>
                    ) : usageList.length > 0 ? (
                        <table className="w-full text-left">
                            <thead className="text-xs text-muted-foreground uppercase font-black tracking-widest">
                                <tr className="border-b border-border/50">
                                    <th scope="col" className="pb-4 px-2">Playlist name</th>
                                    <th scope="col" className="pb-4 px-2">Status</th>
                                    <th scope="col" className="pb-4 px-2 text-center">Uses</th>
                                    <th scope="col" className="pb-4 px-2 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {usageList.map((usage, idx) => (
                                    <tr key={idx} className="group hover:bg-muted/10 transition-colors">
                                        <td className="py-4 px-2">
                                            <Link
                                                href={`/admin/playlists/${usage.playlistId}`}
                                                className="text-sm font-bold text-foreground group-hover:text-accent-cyan transition-colors"
                                            >
                                                {usage.playlistName}
                                            </Link>
                                        </td>
                                        <td className="py-4 px-2">
                                            <span className={`px-2 py-1 rounded text-xs font-black uppercase ${usage.active === 'Y' ? 'bg-green-500/20 text-green-700 dark:text-green-400' : 'bg-red-500/20 text-red-700 dark:text-red-400'}`}>
                                                {usage.active === 'Y' ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="py-4 px-2 text-center text-sm font-mono font-bold text-muted-foreground">
                                            {usage.usageCount}
                                        </td>
                                        <td className="py-4 px-2 text-right">
                                            <Link
                                                href={`/admin/playlists/${usage.playlistId}`}
                                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan hover:text-white transition-colors"
                                                title="Edit playlist"
                                                aria-label={`Edit playlist ${usage.playlistName}`}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                </svg>
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="py-20 text-center bg-muted/10 rounded-2xl border border-border/50">
                            <p className="text-4xl mb-4 opacity-30" aria-hidden="true">🍃</p>
                            <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">This media is not currently assigned to any playlist.</p>
                        </div>
                    )}
                </div>

                <div className="pt-4 flex justify-end">
                    <button
                        type="button"
                        onClick={() => setShowUsageModal(false)}
                        className="px-8 py-3 rounded-xl bg-muted/20 text-foreground font-black uppercase tracking-widest hover:bg-muted/40 transition-colors border border-border"
                    >
                        Close
                    </button>
                </div>
            </Modal>

            <ConfirmModal
                isOpen={confirmState.isOpen}
                title={confirmState.title}
                message={confirmState.message}
                onConfirm={handleConfirmAction}
                onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
                variant={confirmState.variant}
                confirmText={confirmState.confirmText}
                cancelText={confirmState.cancelText}
                isLoading={confirmState.isLoading}
            />
        </div>
    );
}
