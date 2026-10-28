'use client';

import React, { useState, useEffect } from 'react';
import { MediaFile, MediaUsage } from '../types/media';
import { mediaApi } from '../api/media-api';
import { MediaUploadZone } from './MediaUploadZone';
import { RefreshCw, Search, FileVideo, Image as ImageIcon, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

interface MediaReplaceModalProps {
    targetMedia: MediaFile;
    onClose: () => void;
    onSuccess: () => void;
}

type Step = 'select' | 'impact' | 'confirm';
type Tab = 'upload' | 'existing';

export const MediaReplaceModal: React.FC<MediaReplaceModalProps> = ({ targetMedia, onClose, onSuccess }) => {
    const [step, setStep] = useState<Step>('select');
    const [activeTab, setActiveTab] = useState<Tab>('existing');

    // Selection State
    const [selectedNewMediaId, setSelectedNewMediaId] = useState<string | null>(null);
    const [selectedNewMedia, setSelectedNewMedia] = useState<MediaFile | null>(null); // For display

    // Existing Media List State
    const [mediaList, setMediaList] = useState<MediaFile[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loadingMedia, setLoadingMedia] = useState(false);

    // Impact Analysis State
    const [usageList, setUsageList] = useState<MediaUsage[]>([]);
    const [loadingUsage, setLoadingUsage] = useState(false);

    // Replacement State
    const [isReplacing, setIsReplacing] = useState(false);

    useEffect(() => {
        if (activeTab === 'existing') {
            loadMedia();
        }
    }, [activeTab]);

    // Debounced search when typing
    useEffect(() => {
        if (activeTab !== 'existing') return;
        const timer = setTimeout(() => {
            loadMedia();
        }, 400);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    useEffect(() => {
        if (step === 'impact') {
            loadUsage();
        }
    }, [step]);

    const isVideo = (fileName: string) =>
        /\.(mp4|webm|mov)$/i.test(fileName);

    const loadMedia = async () => {
        setLoadingMedia(true);
        try {
            const res = await mediaApi.getAll({ searchTerm });
            if (res.success && res.data) {
                // Filter out the target media itself
                setMediaList(res.data.filter(m => m.mediaId !== targetMedia.mediaId));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingMedia(false);
        }
    };

    const loadUsage = async () => {
        setLoadingUsage(true);
        try {
            const res = await mediaApi.getUsage(targetMedia.mediaId);
            if (res.success && res.data) {
                setUsageList(res.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingUsage(false);
        }
    };

    const handleUploadComplete = (mediaId?: string) => {
        if (mediaId) {
            setSelectedNewMediaId(mediaId);
            setStep('impact');
        }
    };

    const handleExistingSelect = (media: MediaFile) => {
        setSelectedNewMediaId(media.mediaId);
        setSelectedNewMedia(media);
    };

    const handleConfirmReplacement = async () => {
        if (!selectedNewMediaId) return;

        setIsReplacing(true);
        try {
            const res = await mediaApi.replace(targetMedia.mediaId, selectedNewMediaId, true);
            if (res.success) {
                onSuccess();
            } else {
                alert('Replacement Failed: ' + res.message);
            }
        } catch (e) {
            console.error(e);
            alert('An error occurred');
        } finally {
            setIsReplacing(false);
        }
    };

    const isStepComplete = (stepName: Step) => {
        const order: Step[] = ['select', 'impact', 'confirm'];
        return order.indexOf(stepName) < order.indexOf(step);
    };

    const StepItem = ({ num, label, active, complete }: { num: number, label: string, active: boolean, complete: boolean }) => (
        <div
            className={`flex items-center gap-2 select-none ${active ? 'text-accent-cyan' : complete ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}
            aria-current={active ? 'step' : undefined}
        >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center border transition-colors ${active ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan font-bold' : complete ? 'border-green-500 bg-green-500/10' : 'border-border text-muted-foreground'}`} aria-hidden="true">
                {complete ? <CheckCircle size={14} /> : num}
            </div>
            <span className="hidden sm:inline font-bold text-xs uppercase tracking-widest">{label}</span>
        </div>
    );

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="none"
            scroll={false}
            closeDisabled={isReplacing}
            showClose
            labelledBy="media-replace-title"
            zIndexClass="z-[1000]"
            className="max-w-4xl max-h-[95vh] flex flex-col overflow-hidden"
        >
            {/* Header */}
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border bg-muted/10 pr-16">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-accent-cyan/10 flex items-center justify-center border border-accent-cyan/20" aria-hidden="true">
                        <RefreshCw className="text-accent-cyan" size={20} />
                    </div>
                    <div>
                        <h2 id="media-replace-title" className="text-lg sm:text-xl font-black text-foreground uppercase tracking-tight">Replace media</h2>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest mt-0.5">Updates every playlist that uses this file</p>
                    </div>
                </div>
            </div>

            {/* Stepper */}
            <nav aria-label="Replacement steps" className="px-4 sm:px-8 py-3 border-b border-border/50 bg-muted/5">
                <div className="flex items-center justify-center gap-2 sm:gap-6">
                    <StepItem num={1} label="Select" active={step === 'select'} complete={isStepComplete('select')} />
                    <div className="w-4 sm:w-12 h-px bg-border" aria-hidden="true" />
                    <StepItem num={2} label="Impact" active={step === 'impact'} complete={isStepComplete('impact')} />
                    <div className="w-4 sm:w-12 h-px bg-border" aria-hidden="true" />
                    <StepItem num={3} label="Confirm" active={step === 'confirm'} complete={isStepComplete('confirm')} />
                </div>
            </nav>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">

                {/* STEP 1: SELECT */}
                {step === 'select' && (
                    <div className="space-y-6">
                        {/* Tabs */}
                        <div className="flex border-b border-border" role="tablist" aria-label="Source">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeTab === 'upload'}
                                onClick={() => setActiveTab('upload')}
                                className={`px-4 sm:px-6 py-3 text-xs font-black uppercase tracking-widest border-b-2 transition-colors ${activeTab === 'upload' ? 'border-accent-cyan text-foreground bg-accent-cyan/5' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                            >
                                Upload new
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeTab === 'existing'}
                                onClick={() => setActiveTab('existing')}
                                className={`px-4 sm:px-6 py-3 text-xs font-black uppercase tracking-widest border-b-2 transition-colors ${activeTab === 'existing' ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/5' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                            >
                                Library
                            </button>
                        </div>

                        {activeTab === 'upload' && (
                            <div className="py-2" role="tabpanel">
                                <MediaUploadZone
                                    onUploadSuccess={handleUploadComplete}
                                    onCancel={() => { }}
                                    isEmbed={true}
                                />
                            </div>
                        )}

                        {activeTab === 'existing' && (
                            <div className="space-y-4" role="tabpanel">
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} aria-hidden="true" />
                                        <input
                                            type="search"
                                            aria-label="Search library"
                                            placeholder="Search library…"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && loadMedia()}
                                            className="w-full bg-muted/20 border border-border rounded-xl pl-10 pr-4 py-2 text-sm text-foreground outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 placeholder:text-muted-foreground/70"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={loadMedia}
                                        aria-label="Refresh library"
                                        className="px-3 bg-accent-cyan/10 text-accent-cyan rounded-xl border border-accent-cyan/20 hover:bg-accent-cyan/20 transition-colors"
                                    >
                                        <RefreshCw size={16} aria-hidden="true" />
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar" role="group" aria-label="Library files">
                                    {mediaList.map(m => {
                                        const selected = selectedNewMediaId === m.mediaId;
                                        return (
                                            <button
                                                type="button"
                                                key={m.mediaId}
                                                onClick={() => handleExistingSelect(m)}
                                                aria-pressed={selected}
                                                aria-label={`Select ${m.displayName}`}
                                                className={`group relative rounded-xl border-2 overflow-hidden text-left transition-colors ${selected
                                                    ? 'border-accent-cyan ring-4 ring-accent-cyan/10'
                                                    : 'border-border/50 hover:border-border'
                                                    }`}
                                            >
                                                <div className="aspect-video bg-background/60 relative">
                                                    {m.blobUrl ? (
                                                        isVideo(m.fileName) ? (
                                                            <video
                                                                src={`${m.blobUrl}#t=0.1`}
                                                                className="w-full h-full object-cover"
                                                                muted
                                                                playsInline
                                                                preload="metadata"
                                                                onMouseOver={e => {
                                                                    const playPromise = (e.target as HTMLVideoElement).play();
                                                                    if (playPromise !== undefined) {
                                                                        playPromise.catch(() => {});
                                                                    }
                                                                }}
                                                                onMouseOut={e => {
                                                                    const video = e.target as HTMLVideoElement;
                                                                    video.pause();
                                                                    try {
                                                                        video.currentTime = 0;
                                                                    } catch {}
                                                                }}
                                                            />
                                                        ) : (
                                                            <img src={m.blobUrl} className="w-full h-full object-cover" alt={m.displayName} loading="lazy" decoding="async" />
                                                        )
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-muted-foreground" aria-hidden="true">
                                                            {isVideo(m.fileName) ? <FileVideo size={24} /> : <ImageIcon size={24} />}
                                                        </div>
                                                    )}
                                                    {selected && (
                                                        <div className="absolute inset-0 bg-accent-cyan/20 flex items-center justify-center" aria-hidden="true">
                                                            <CheckCircle className="text-accent-cyan fill-black" size={24} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="p-2 bg-muted/20">
                                                    <p className="text-xs font-bold text-foreground truncate">{m.displayName}</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                    {mediaList.length === 0 && !loadingMedia && (
                                        <div className="col-span-full py-10 text-center text-muted-foreground text-sm">No other media found</div>
                                    )}
                                </div>

                                <div className="flex justify-end pt-4">
                                    <button
                                        type="button"
                                        disabled={!selectedNewMediaId}
                                        onClick={() => setStep('impact')}
                                        className="w-full sm:w-auto px-8 py-3 bg-primary text-primary-foreground font-black uppercase tracking-wider rounded-xl hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                    >
                                        Next step <ArrowRight size={16} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* STEP 2: IMPACT */}
                {step === 'impact' && (
                    <div className="space-y-6">
                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex gap-4 items-start" role="note">
                            <AlertTriangle className="text-yellow-600 dark:text-yellow-400 shrink-0" size={20} aria-hidden="true" />
                            <div>
                                <h3 className="font-bold text-yellow-700 dark:text-yellow-400 text-sm">Replacement warning</h3>
                                <p className="text-xs text-foreground/80 mt-1">
                                    Replacing <strong>{targetMedia.displayName}</strong> will update {usageList.length} playlist(s).
                                </p>
                            </div>
                        </div>

                        <div>
                            <h4 className="text-xs font-black text-muted-foreground uppercase tracking-[0.2em] mb-3">Affected playlists</h4>
                            <div className="bg-muted/10 rounded-xl border border-border overflow-hidden max-h-[180px] overflow-y-auto custom-scrollbar">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-muted/30 text-muted-foreground sticky top-0">
                                        <tr>
                                            <th scope="col" className="p-3 pl-4">Name</th>
                                            <th scope="col" className="p-3">Duration</th>
                                            <th scope="col" className="p-3">Screens</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {usageList.map((usage, i) => (
                                            <tr key={i} className="text-foreground/90 hover:bg-muted/10">
                                                <td className="p-3 pl-4 font-medium truncate max-w-[150px]">{usage.playlistName}</td>
                                                <td className="p-3 text-muted-foreground">{usage.durationSec != null && usage.durationSec > 0 ? `${usage.durationSec}s` : '-'}</td>
                                                <td className="p-3">{usage.deviceCount != null ? usage.deviceCount : '-'}</td>
                                            </tr>
                                        ))}
                                        {usageList.length === 0 && !loadingUsage && (
                                            <tr><td colSpan={3} className="p-8 text-center text-muted-foreground">Not used in any playlists</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button
                                type="button"
                                onClick={() => setStep('select')}
                                className="px-6 py-3 text-xs font-bold text-muted-foreground hover:text-foreground uppercase tracking-wider"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={() => setStep('confirm')}
                                className="flex-1 py-3 bg-primary text-primary-foreground font-black uppercase tracking-wider rounded-xl hover:brightness-110 transition-colors flex items-center justify-center gap-2"
                            >
                                Review <ArrowRight size={16} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: CONFIRM */}
                {step === 'confirm' && (
                    <div className="flex flex-col items-center justify-center py-4 text-center space-y-6">
                        <div className="w-16 h-16 rounded-full bg-accent-cyan/10 flex items-center justify-center border-2 border-accent-cyan/50" aria-hidden="true">
                            <RefreshCw className="text-accent-cyan" size={32} />
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-xl sm:text-2xl font-black text-foreground uppercase tracking-tight">Ready to switch?</h3>
                            <p className="text-xs text-muted-foreground max-w-xs mx-auto uppercase tracking-widest font-bold">This action is permanent</p>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8 w-full max-w-md bg-muted/10 p-4 sm:p-6 rounded-3xl border border-border">
                            <div className="flex-1 w-full space-y-2 opacity-50 grayscale">
                                <p className="text-xs font-black text-muted-foreground uppercase">Old content</p>
                                <div className="aspect-video bg-background rounded-xl overflow-hidden border border-border/50">
                                    {targetMedia.blobUrl ? (
                                        isVideo(targetMedia.fileName) ? (
                                            <video src={targetMedia.blobUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                                        ) : (
                                            <img src={targetMedia.blobUrl} className="w-full h-full object-cover" alt={targetMedia.displayName} loading="lazy" decoding="async" />
                                        )
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">PREVIOUS</div>
                                    )}
                                </div>
                                <p className="text-xs truncate text-muted-foreground font-bold">{targetMedia.displayName}</p>
                            </div>
                            <ArrowRight className="hidden sm:block text-accent-cyan" size={24} aria-hidden="true" />
                            <div className="flex-1 w-full space-y-2">
                                <p className="text-xs font-black text-accent-cyan uppercase tracking-[0.2em]">New content</p>
                                <div className="aspect-video bg-background rounded-xl overflow-hidden border-2 border-accent-cyan/50">
                                    {selectedNewMedia?.blobUrl ? (
                                        isVideo(selectedNewMedia.fileName) ? (
                                            <video src={selectedNewMedia.blobUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                                        ) : (
                                            <img src={selectedNewMedia.blobUrl} className="w-full h-full object-cover" alt={selectedNewMedia.displayName} loading="lazy" decoding="async" />
                                        )
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-accent-cyan/10 text-accent-cyan font-black text-xs">NEW</div>
                                    )}
                                </div>
                                <p className="text-xs truncate text-foreground font-black uppercase tracking-wider">{selectedNewMedia?.displayName || 'Active selection'}</p>
                            </div>
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-4 w-full max-w-md pt-4">
                            <button
                                type="button"
                                onClick={() => setStep('impact')}
                                disabled={isReplacing}
                                className="flex-1 py-3 text-xs font-bold text-muted-foreground hover:text-foreground uppercase tracking-wider disabled:opacity-50"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmReplacement}
                                disabled={isReplacing}
                                className="flex-[2] py-4 bg-primary text-primary-foreground font-black uppercase tracking-widest rounded-xl hover:brightness-110 disabled:opacity-50 transition-colors"
                            >
                                {isReplacing ? 'Updating…' : 'Confirm & replace'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
};
