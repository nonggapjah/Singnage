'use client';

import React, { useState, useEffect } from 'react';
import { Playlist, PlaylistItem, MediaFile } from '../types/playlist';
import { MediaSelector } from './MediaSelector';
import { useRouter } from 'next/navigation';

import { generateId } from '@/lib/utils';

interface PlaylistEditorProps {
    initialData?: Playlist;
    onSave: (data: Partial<Playlist>) => void;
}

export const PlaylistEditor: React.FC<PlaylistEditorProps> = ({ initialData, onSave }) => {
    const router = useRouter();
    const [name, setName] = useState(initialData?.playlistName || '');
    const [description, setDescription] = useState(initialData?.description || '');
    const [active, setActive] = useState<'Y' | 'N'>(initialData?.active || 'Y');
    const [items, setItems] = useState<PlaylistItem[]>(initialData?.items || []);
    const [isMediaSelectorOpen, setIsMediaSelectorOpen] = useState(false);

    // Sync state if initialData changes (e.g., after initial fetch)
    useEffect(() => {
        if (initialData) {
            setName(initialData.playlistName || '');
            setDescription(initialData.description || '');
            setActive(initialData.active || 'Y');
            setItems(initialData.items || []);
        }
    }, [initialData]);

    const handleAddMedia = (media: MediaFile) => {
        // Standard P02: If media has no inherent duration (e.g. Image = 0), default to 10s override
        const defaultDuration = (media.durationSec && media.durationSec > 0) ? null : 10;

        const newItem: PlaylistItem = {
            playlistItemId: generateId(),
            playlistId: initialData?.playlistId || '',
            mediaId: media.mediaId,
            positionOrder: items.length + 1,
            durationOverride: defaultDuration,
            active: 'Y',
            media: media
        };
        setItems([...items, newItem]);
        setIsMediaSelectorOpen(false);
    };

    const handleRemoveItem = (tempId: string) => {
        setItems(items.filter(item => item.playlistItemId !== tempId));
    };

    const moveItem = (index: number, direction: 'up' | 'down') => {
        const newItems = [...items];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= newItems.length) return;

        [newItems[index], newItems[targetIndex]] = [newItems[targetIndex], newItems[index]];
        setItems(newItems);
    };

    const handleDurationChange = (index: number, val: string) => {
        const newItems = [...items];
        const numVal = parseInt(val);
        newItems[index] = {
            ...newItems[index],
            durationOverride: isNaN(numVal) ? null : numVal
        };
        setItems(newItems);
    };

    const handleSave = () => {
        onSave({
            playlistName: name,
            description: description,
            active: active,
            items: items.map((item, index) => ({
                ...item,
                positionOrder: index + 1,
                // Sanitize media object to prevent validation errors (e.g. empty uploadedAt)
                media: item.media ? {
                    ...item.media,
                    uploadedAt: item.media.uploadedAt || undefined
                } : undefined
            }))
        });
    };

    const totalDurationSec = items.reduce((acc, item) => {
        return acc + (item.durationOverride || item.media?.durationSec || 0);
    }, 0);

    const formatDuration = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <div className="space-y-6">
            <div className="glass-panel p-6 rounded-xl space-y-4 relative">
                {/* Header Row: Title - Metadata - Duration */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/5 pb-4 mb-4 gap-4">
                    {/* Left: Title */}
                    <div>
                        <h2 className="text-2xl font-black neon-text uppercase tracking-tight">
                            {initialData ? `EDIT: ${name || 'Untitled'}` : 'New Playlist'}
                        </h2>
                        <p className="text-xs text-gray-500 font-light tracking-wider">CONFIGURE CONTENT TIMING</p>
                    </div>

                    {/* Center: Metadata */}
                    <div className="flex-1 flex justify-center">
                        <div className="flex items-center gap-6 px-6 py-2 bg-white/5 rounded-full border border-white/5">
                            <div className="flex flex-col items-center">
                                <span className="text-xs uppercase text-gray-500 font-bold tracking-widest">Created By</span>
                                <span className="text-xs text-accent-cyan font-mono">{initialData?.createdBy || 'System'}</span>
                            </div>
                            <div className="w-px h-6 bg-white/10"></div>
                            <div className="flex flex-col items-center">
                                <span className="text-xs uppercase text-gray-500 font-bold tracking-widest">Created At</span>
                                <span className="text-xs text-accent-cyan font-mono" suppressHydrationWarning={true}>{initialData?.createdAt ? new Date(initialData.createdAt).toLocaleDateString('th-TH') : 'Now'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Right: Duration */}
                    <div className="text-right">
                        <div className="text-xs text-gray-400 uppercase tracking-widest mb-1">Total Duration</div>
                        <div className="text-2xl font-mono text-accent-cyan bg-black/30 px-3 py-1 rounded border border-accent-cyan/20 shadow-[0_0_10px_rgba(0,255,255,0.1)]">
                            {formatDuration(totalDurationSec)}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                    <div className="lg:col-span-3 space-y-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-[var(--foreground)]/5 border border-[var(--foreground)]/10 text-[var(--foreground)] rounded-lg px-3 py-2 text-sm focus:border-accent-cyan outline-none transition-colors"
                            placeholder="Playlist Name"
                        />
                    </div>
                    <div className="lg:col-span-2 space-y-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase">Status</label>
                        <select
                            value={active}
                            onChange={(e) => setActive(e.target.value as 'Y' | 'N')}
                            className="w-full bg-[var(--foreground)]/5 border border-[var(--foreground)]/10 text-[var(--foreground)] rounded-lg px-3 py-2 text-sm focus:border-accent-cyan outline-none transition-colors appearance-none"
                        >
                            <option value="Y" className="bg-black text-white">Active</option>
                            <option value="N" className="bg-black text-white">Inactive</option>
                        </select>
                    </div>
                    <div className="lg:col-span-7 space-y-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase">Description</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full bg-[var(--foreground)]/5 border border-[var(--foreground)]/10 text-[var(--foreground)] rounded-lg px-3 py-2 text-sm focus:border-accent-cyan outline-none transition-colors"
                            placeholder="Short description..."
                        />
                    </div>
                </div>
            </div>

            <div className="glass-panel p-6 rounded-xl space-y-4">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold neon-text">Media Items</h2>
                    <button
                        onClick={() => setIsMediaSelectorOpen(true)}
                        className="btn-primary"
                    >
                        + Add Media
                    </button>
                </div>

                <div className="space-y-2">
                    {items.map((item, index) => (
                        <div key={`item-${item.playlistItemId || 'new'}-${index}-${item.mediaId}`} className="grid grid-cols-12 gap-4 items-center bg-white/5 p-4 rounded-lg border border-white/10 group hover:border-accent-cyan/30 transition-colors">
                            {/* Sort & Index (Cols 1-2) */}
                            <div className="col-span-1 flex flex-col gap-1 items-center">
                                <button
                                    onClick={() => moveItem(index, 'up')}
                                    disabled={index === 0}
                                    className="p-1 hover:bg-white/10 rounded disabled:opacity-20 text-xs"
                                >
                                    ▲
                                </button>
                                <button
                                    onClick={() => moveItem(index, 'down')}
                                    disabled={index === items.length - 1}
                                    className="p-1 hover:bg-white/10 rounded disabled:opacity-20 text-xs"
                                >
                                    ▼
                                </button>
                            </div>
                            <div className="col-span-1 text-center text-gray-500 font-mono text-lg">{index + 1}</div>

                            {/* Name & File (Cols 3-6) */}
                            <div className="col-span-4 overflow-hidden">
                                <div className="font-semibold text-accent-cyan text-base truncate" title={item.media?.displayName || item.media?.fileName}>
                                    {item.media?.displayName || item.media?.fileName}
                                </div>
                                {item.media?.displayName && item.media?.displayName !== item.media?.fileName && (
                                    <div className="text-xs text-gray-500 font-mono truncate" title={item.media?.fileName}>{item.media?.fileName}</div>
                                )}
                            </div>

                            {/* Middle Info: Duration/Ratio (Cols 7-9) */}
                            <div className="col-span-3 text-center border-l border-r border-white/5 h-full flex flex-col justify-center">
                                <div className="text-xs text-gray-300">
                                    <span className="text-gray-500 uppercase text-xs">Default:</span> {item.media?.durationSec}s
                                </div>
                                <div className="text-xs text-gray-500 font-mono mt-1">
                                    {item.media?.ratio || 'N/A'}
                                </div>
                            </div>

                            {/* Override Input (Cols 10-11) */}
                            <div className="col-span-2 flex flex-col items-center" title="Set a custom duration. Leave blank to use media default.">
                                <label className="text-xs uppercase text-gray-400 font-bold mb-1">Duration</label>
                                <input
                                    type="number"
                                    value={item.durationOverride || ''}
                                    onChange={(e) => handleDurationChange(index, e.target.value)}
                                    placeholder={item.media?.durationSec.toString()}
                                    className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-accent-cyan text-center placeholder-gray-600 font-mono"
                                />
                            </div>

                            {/* Delete (Col 12) */}
                            <div className="col-span-1 text-right">
                                <button
                                    onClick={() => handleRemoveItem(item.playlistItemId)}
                                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 p-2 transition-all"
                                    title="Remove item"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                    ))}
                    {items.length === 0 && (
                        <div className="py-12 text-center text-gray-500 border-2 border-dashed border-white/5 rounded-lg">
                            <div className="text-4xl mb-2">🎞️</div>
                            No media items added yet.<br />
                            Click "+ Add Media" to start building your sequence.
                        </div>
                    )}
                </div>
            </div>

            <div className="flex justify-end gap-4">
                <button
                    onClick={() => router.push('/admin/playlists')}
                    className="px-6 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                >
                    Cancel
                </button>
                <button onClick={handleSave} className="btn-primary shadow-[0_0_15px_rgba(157,0,255,0.4)]">
                    Save Dataset
                </button>
            </div>

            {isMediaSelectorOpen && (
                <MediaSelector
                    onSelect={handleAddMedia}
                    onClose={() => setIsMediaSelectorOpen(false)}
                />
            )}
        </div>
    );
};
