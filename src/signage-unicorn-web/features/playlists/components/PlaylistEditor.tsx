'use client';

import React, { useState } from 'react';
import { Playlist, PlaylistItem, MediaFile } from '../types/playlist';
import { MediaSelector } from './MediaSelector';
import { useRouter } from 'next/navigation';

import { generateId } from '@/lib/utils';

interface PlaylistEditorProps {
    initialData?: Playlist;
    onSave: (data: Partial<Playlist>) => void;
}

const fieldClass = 'w-full bg-muted/20 border border-border text-foreground rounded-lg px-3 py-2 text-sm focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 outline-none transition-colors placeholder:text-muted-foreground/70';
const labelClass = 'block text-xs font-semibold text-muted-foreground uppercase';

export const PlaylistEditor: React.FC<PlaylistEditorProps> = ({ initialData, onSave }) => {
    const router = useRouter();
    const [name, setName] = useState(initialData?.playlistName || '');
    const [description, setDescription] = useState(initialData?.description || '');
    const [active, setActive] = useState<'Y' | 'N'>(initialData?.active || 'Y');
    const [items, setItems] = useState<PlaylistItem[]>(initialData?.items || []);
    const [isMediaSelectorOpen, setIsMediaSelectorOpen] = useState(false);

    // Sync state if initialData changes (e.g., after initial fetch). Done during render
    // (the React "adjust state on prop change" pattern) rather than in an effect, so the
    // form never paints a stale frame first.
    const [syncedFrom, setSyncedFrom] = useState(initialData);
    if (initialData !== syncedFrom) {
        setSyncedFrom(initialData);
        if (initialData) {
            setName(initialData.playlistName || '');
            setDescription(initialData.description || '');
            setActive(initialData.active || 'Y');
            setItems(initialData.items || []);
        }
    }

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
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-border/50 pb-4 mb-4 gap-4">
                    {/* Left: Title */}
                    <div>
                        <h2 className="text-2xl font-black neon-text uppercase tracking-tight">
                            {initialData ? `Edit: ${name || 'Untitled'}` : 'New playlist'}
                        </h2>
                        <p className="text-xs text-muted-foreground font-light tracking-wider uppercase">Set the content and timing</p>
                    </div>

                    {/* Center: Metadata */}
                    <div className="flex-1 flex justify-center">
                        <div className="flex items-center gap-6 px-6 py-2 bg-muted/20 rounded-full border border-border/50">
                            <div className="flex flex-col items-center">
                                <span className="text-xs uppercase text-muted-foreground font-bold tracking-widest">Created by</span>
                                <span className="text-xs text-accent-cyan font-mono">{initialData?.createdBy || 'System'}</span>
                            </div>
                            <div className="w-px h-6 bg-border" aria-hidden="true"></div>
                            <div className="flex flex-col items-center">
                                <span className="text-xs uppercase text-muted-foreground font-bold tracking-widest">Created at</span>
                                <span className="text-xs text-accent-cyan font-mono" suppressHydrationWarning={true}>{initialData?.createdAt ? new Date(initialData.createdAt).toLocaleDateString('th-TH') : 'Now'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Right: Duration */}
                    <div className="text-right">
                        <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Total duration</div>
                        <div className="text-2xl font-mono text-accent-cyan bg-muted/20 px-3 py-1 rounded border border-accent-cyan/20">
                            {formatDuration(totalDurationSec)}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                    <div className="lg:col-span-3 space-y-1">
                        <label htmlFor="playlist-name" className={labelClass}>Name</label>
                        <input
                            id="playlist-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={fieldClass}
                            placeholder="Playlist name"
                            required
                        />
                    </div>
                    <div className="lg:col-span-2 space-y-1">
                        <label htmlFor="playlist-status" className={labelClass}>Status</label>
                        <select
                            id="playlist-status"
                            value={active}
                            onChange={(e) => setActive(e.target.value as 'Y' | 'N')}
                            className={fieldClass}
                        >
                            <option value="Y">Active</option>
                            <option value="N">Inactive</option>
                        </select>
                    </div>
                    <div className="lg:col-span-7 space-y-1">
                        <label htmlFor="playlist-description" className={labelClass}>Description</label>
                        <input
                            id="playlist-description"
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className={fieldClass}
                            placeholder="Short description…"
                        />
                    </div>
                </div>
            </div>

            <div className="glass-panel p-6 rounded-xl space-y-4">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold neon-text">Media items</h2>
                    <button
                        type="button"
                        onClick={() => setIsMediaSelectorOpen(true)}
                        className="btn-primary"
                    >
                        + Add media
                    </button>
                </div>

                <ol className="space-y-2" aria-label="Playlist items">
                    {items.map((item, index) => (
                        <li key={`item-${item.playlistItemId || 'new'}-${index}-${item.mediaId}`} className="grid grid-cols-[auto_auto_1fr] md:grid-cols-12 gap-3 md:gap-4 items-center bg-muted/10 p-4 rounded-lg border border-border/50 group hover:border-accent-cyan/30 transition-colors">
                            {/* Sort & Index */}
                            <div className="md:col-span-1 flex flex-col gap-1 items-center">
                                <button
                                    type="button"
                                    onClick={() => moveItem(index, 'up')}
                                    disabled={index === 0}
                                    aria-label={`Move item ${index + 1} up`}
                                    className="p-1 hover:bg-muted/40 rounded disabled:opacity-20 text-xs text-foreground"
                                >
                                    ▲
                                </button>
                                <button
                                    type="button"
                                    onClick={() => moveItem(index, 'down')}
                                    disabled={index === items.length - 1}
                                    aria-label={`Move item ${index + 1} down`}
                                    className="p-1 hover:bg-muted/40 rounded disabled:opacity-20 text-xs text-foreground"
                                >
                                    ▼
                                </button>
                            </div>
                            <div className="md:col-span-1 text-center text-muted-foreground font-mono text-lg">{index + 1}</div>

                            {/* Name & File */}
                            <div className="md:col-span-4 overflow-hidden">
                                <div className="font-semibold text-accent-cyan text-base truncate" title={item.media?.displayName || item.media?.fileName}>
                                    {item.media?.displayName || item.media?.fileName}
                                </div>
                                {item.media?.displayName && item.media?.displayName !== item.media?.fileName && (
                                    <div className="text-xs text-muted-foreground font-mono truncate" title={item.media?.fileName}>{item.media?.fileName}</div>
                                )}
                            </div>

                            {/* Middle Info: Duration/Ratio */}
                            <div className="col-span-3 md:col-span-3 text-center md:border-l md:border-r border-border/50 h-full flex flex-col justify-center">
                                <div className="text-xs text-foreground/90">
                                    <span className="text-muted-foreground uppercase text-xs">Default:</span> {item.media?.durationSec}s
                                </div>
                                <div className="text-xs text-muted-foreground font-mono mt-1">
                                    {item.media?.ratio || 'N/A'}
                                </div>
                            </div>

                            {/* Override Input */}
                            <div className="col-span-2 md:col-span-2 flex flex-col items-center" title="Set a custom duration. Leave blank to use the media default.">
                                <label htmlFor={`item-duration-${index}`} className="text-xs uppercase text-muted-foreground font-bold mb-1">Duration (s)</label>
                                <input
                                    id={`item-duration-${index}`}
                                    type="number"
                                    min={1}
                                    value={item.durationOverride || ''}
                                    onChange={(e) => handleDurationChange(index, e.target.value)}
                                    placeholder={item.media?.durationSec.toString()}
                                    className="w-full bg-muted/20 border border-border rounded px-2 py-1 text-sm outline-none focus:border-accent-cyan text-center placeholder:text-muted-foreground/70 font-mono text-foreground"
                                />
                            </div>

                            {/* Delete */}
                            <div className="col-span-1 md:col-span-1 text-right">
                                <button
                                    type="button"
                                    onClick={() => handleRemoveItem(item.playlistItemId)}
                                    aria-label={`Remove ${item.media?.displayName || item.media?.fileName || 'item'}`}
                                    className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 text-red-500 hover:text-red-400 p-2 transition-opacity"
                                    title="Remove item"
                                >
                                    <span aria-hidden="true">🗑️</span>
                                </button>
                            </div>
                        </li>
                    ))}
                    {items.length === 0 && (
                        <li className="py-12 text-center text-muted-foreground border-2 border-dashed border-border/50 rounded-lg list-none">
                            <div className="text-4xl mb-2" aria-hidden="true">🎞️</div>
                            No media items added yet.<br />
                            Click &quot;+ Add media&quot; to start building your sequence.
                        </li>
                    )}
                </ol>
            </div>

            <div className="flex justify-end gap-4">
                <button
                    type="button"
                    onClick={() => router.push('/admin/playlists')}
                    className="px-6 py-2 rounded-lg border border-border hover:bg-muted/30 transition-colors text-foreground"
                >
                    Cancel
                </button>
                <button type="button" onClick={handleSave} className="btn-primary">
                    Save playlist
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
