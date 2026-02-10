'use client';

import React, { useState, useEffect } from 'react';
import { MediaFile, MediaUsage } from '../types/media';
import { mediaApi } from '../api/media-api';
import { MediaUploadZone } from './MediaUploadZone';
import { RefreshCw, Search, FileVideo, Image as ImageIcon, CheckCircle, AlertTriangle, ArrowRight, X } from 'lucide-react';

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
        <div className={`flex items-center gap-2 select-none ${active ? 'text-accent-cyan' : complete ? 'text-green-500' : 'text-gray-500'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all ${active ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan font-bold scale-110 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : complete ? 'border-green-500 bg-green-500/10 text-green-500' : 'border-gray-700 text-gray-600'}`}>
                {complete ? <CheckCircle size={14} /> : num}
            </div>
            <span className="hidden sm:inline font-bold text-[10px] uppercase tracking-widest">{label}</span>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-4">
            {/* Dark Backdrop */}
            <div className="absolute inset-0 bg-[#000000e6] backdrop-blur-md" onClick={onClose} />

            {/* Modal Body */}
            <div className="relative bg-[#0a0a0a] border border-white/10 w-full max-w-4xl max-h-[95vh] flex flex-col rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between p-4 sm:p-6 border-b border-white/10 bg-black/40">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-accent-cyan/10 flex items-center justify-center border border-accent-cyan/20">
                            <RefreshCw className="text-accent-cyan" size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg sm:text-xl font-black text-white uppercase tracking-tight italic">Replace Media</h2>
                            <p className="text-[10px] text-gray-500 font-medium uppercase tracking-widest mt-0.5">Automated Usage Replacement</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-all text-gray-500 hover:text-white">
                        <X size={24} />
                    </button>
                </div>

                {/* Stepper */}
                <div className="px-4 sm:px-8 py-3 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center justify-center gap-2 sm:gap-6">
                        <StepItem num={1} label="Select" active={step === 'select'} complete={isStepComplete('select')} />
                        <div className="w-4 sm:w-12 h-px bg-white/10" />
                        <StepItem num={2} label="Impact" active={step === 'impact'} complete={isStepComplete('impact')} />
                        <div className="w-4 sm:w-12 h-px bg-white/10" />
                        <StepItem num={3} label="Confirm" active={step === 'confirm'} complete={isStepComplete('confirm')} />
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">

                    {/* STEP 1: SELECT */}
                    {step === 'select' && (
                        <div className="space-y-6">
                            {/* Tabs */}
                            <div className="flex border-b border-white/10">
                                <button
                                    onClick={() => setActiveTab('upload')}
                                    className={`px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'upload' ? 'border-accent-cyan text-white bg-accent-cyan/5' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                                >
                                    Upload New
                                </button>
                                <button
                                    onClick={() => setActiveTab('existing')}
                                    className={`px-4 sm:px-6 py-3 text-[10px] sm:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'existing' ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/5' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                                >
                                    Library
                                </button>
                            </div>

                            {activeTab === 'upload' && (
                                <div className="py-2">
                                    <MediaUploadZone
                                        onUploadSuccess={handleUploadComplete}
                                        onCancel={() => { }}
                                        isEmbed={true}
                                    />
                                </div>
                            )}

                            {activeTab === 'existing' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                                            <input
                                                type="text"
                                                placeholder="Search library..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && loadMedia()}
                                                className="w-full bg-black/60 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30"
                                            />
                                        </div>
                                        <button
                                            onClick={loadMedia}
                                            className="px-3 bg-accent-cyan/10 text-accent-cyan rounded-xl border border-accent-cyan/20 hover:bg-accent-cyan/20 transition-colors"
                                        >
                                            <RefreshCw size={16} />
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                        {mediaList.map(m => (
                                            <div
                                                key={m.mediaId}
                                                onClick={() => handleExistingSelect(m)}
                                                className={`group relative rounded-xl border-2 overflow-hidden cursor-pointer transition-all ${selectedNewMediaId === m.mediaId
                                                    ? 'border-accent-cyan ring-4 ring-accent-cyan/10'
                                                    : 'border-white/5 hover:border-white/20'
                                                    }`}
                                            >
                                                <div className="aspect-video bg-black/50 relative">
                                                    {m.blobUrl ? (
                                                        isVideo(m.fileName) ? (
                                                            <video
                                                                src={m.blobUrl}
                                                                className="w-full h-full object-cover"
                                                                muted
                                                                preload="metadata"
                                                                onMouseOver={e => (e.target as HTMLVideoElement).play()}
                                                                onMouseOut={e => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                                                            />
                                                        ) : (
                                                            <img src={m.blobUrl} className="w-full h-full object-cover" alt={m.displayName} />
                                                        )
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                                                            {isVideo(m.fileName) ? <FileVideo size={24} /> : <ImageIcon size={24} />}
                                                        </div>
                                                    )}
                                                    {selectedNewMediaId === m.mediaId && (
                                                        <div className="absolute inset-0 bg-accent-cyan/20 flex items-center justify-center">
                                                            <CheckCircle className="text-accent-cyan fill-black" size={24} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="p-2 bg-white/5">
                                                    <p className="text-[10px] font-bold text-white truncate">{m.displayName}</p>
                                                </div>
                                            </div>
                                        ))}
                                        {mediaList.length === 0 && !loadingMedia && (
                                            <div className="col-span-full py-10 text-center text-gray-600 text-sm">No other media found</div>
                                        )}
                                    </div>

                                    <div className="flex justify-end pt-4">
                                        <button
                                            disabled={!selectedNewMediaId}
                                            onClick={() => setStep('impact')}
                                            className="w-full sm:w-auto px-8 py-3 bg-accent-cyan text-black font-black uppercase tracking-wider rounded-xl hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/20"
                                        >
                                            Next Step <ArrowRight size={16} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 2: IMPACT */}
                    {step === 'impact' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex gap-4 items-start">
                                <AlertTriangle className="text-yellow-500 shrink-0" size={20} />
                                <div>
                                    <h3 className="font-bold text-yellow-500 text-sm">Replacement Warning</h3>
                                    <p className="text-xs text-yellow-500/80 mt-1">
                                        Replacing <strong>{targetMedia.displayName}</strong> will update {usageList.length} playlist(s).
                                    </p>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Affected Playlists</h4>
                                <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden max-h-[180px] overflow-y-auto custom-scrollbar">
                                    <table className="w-full text-left text-[11px] sm:text-xs">
                                        <thead className="bg-white/5 text-gray-400 sticky top-0">
                                            <tr>
                                                <th className="p-3 pl-4">Name</th>
                                                <th className="p-3">Duration</th>
                                                <th className="p-3">Screens</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {usageList.map((usage, i) => (
                                                <tr key={i} className="text-gray-300 hover:bg-white/[0.02]">
                                                    <td className="p-3 pl-4 font-medium truncate max-w-[150px]">{usage.playlistName}</td>
                                                    <td className="p-3 text-gray-500">{usage.durationSec != null && usage.durationSec > 0 ? `${usage.durationSec}s` : '-'}</td>
                                                    <td className="p-3">{usage.deviceCount != null ? usage.deviceCount : '-'}</td>
                                                </tr>
                                            ))}
                                            {usageList.length === 0 && !loadingUsage && (
                                                <tr><td colSpan={3} className="p-8 text-center text-gray-500">Not used in any playlists</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex gap-4 pt-4">
                                <button
                                    onClick={() => setStep('select')}
                                    className="px-6 py-3 text-xs font-bold text-gray-500 hover:text-white uppercase tracking-wider"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={() => setStep('confirm')}
                                    className="flex-1 py-3 bg-accent-cyan text-black font-black uppercase tracking-wider rounded-xl hover:bg-cyan-300 transition-all flex items-center justify-center gap-2"
                                >
                                    Review Final <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: CONFIRM */}
                    {step === 'confirm' && (
                        <div className="flex flex-col items-center justify-center py-4 text-center space-y-6 animate-in fade-in zoom-in-95">
                            <div className="w-16 h-16 rounded-full bg-accent-cyan/10 flex items-center justify-center border-2 border-accent-cyan/50 shadow-[0_0_30px_rgba(34,211,238,0.3)]">
                                <RefreshCw className="text-accent-cyan" size={32} />
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tight">Ready to Switch?</h3>
                                <p className="text-xs text-gray-500 max-w-xs mx-auto uppercase tracking-widest font-bold">This action is permanent</p>
                            </div>

                            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8 w-full max-w-md bg-white/5 p-4 sm:p-6 rounded-3xl border border-white/10">
                                <div className="flex-1 w-full space-y-2 opacity-40 grayscale">
                                    <p className="text-[10px] font-black text-gray-600 uppercase">Old Content</p>
                                    <div className="aspect-video bg-black rounded-xl overflow-hidden border border-white/5">
                                        {targetMedia.blobUrl ? (
                                            isVideo(targetMedia.fileName) ? (
                                                <video src={targetMedia.blobUrl} className="w-full h-full object-cover" muted preload="metadata" />
                                            ) : (
                                                <img src={targetMedia.blobUrl} className="w-full h-full object-cover" alt={targetMedia.displayName} />
                                            )
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-700">PREVIOUS</div>
                                        )}
                                    </div>
                                    <p className="text-[10px] truncate text-gray-500 font-bold">{targetMedia.displayName}</p>
                                </div>
                                <ArrowRight className="hidden sm:block text-accent-cyan" size={24} />
                                <div className="flex-1 w-full space-y-2">
                                    <p className="text-[10px] font-black text-accent-cyan uppercase tracking-[0.2em]">New Content</p>
                                    <div className="aspect-video bg-black rounded-xl overflow-hidden border-2 border-accent-cyan/50 shadow-2xl shadow-cyan-500/20">
                                        {selectedNewMedia?.blobUrl ? (
                                            isVideo(selectedNewMedia.fileName) ? (
                                                <video src={selectedNewMedia.blobUrl} className="w-full h-full object-cover" muted preload="metadata" />
                                            ) : (
                                                <img src={selectedNewMedia.blobUrl} className="w-full h-full object-cover" alt={selectedNewMedia.displayName} />
                                            )
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-accent-cyan/10 text-accent-cyan font-black text-xs">NEW</div>
                                        )}
                                    </div>
                                    <p className="text-[10px] truncate text-white font-black uppercase tracking-wider">{selectedNewMedia?.displayName || 'Active Selection'}</p>
                                </div>
                            </div>

                            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-4 w-full max-w-md pt-4">
                                <button
                                    onClick={() => setStep('impact')}
                                    className="flex-1 py-3 text-xs font-bold text-gray-500 hover:text-white uppercase tracking-wider"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmReplacement}
                                    disabled={isReplacing}
                                    className="flex-[2] py-4 bg-accent-cyan text-black font-black uppercase tracking-widest rounded-xl hover:bg-cyan-300 disabled:opacity-50 shadow-[0_0_30px_rgba(34,211,238,0.4)] transition-all"
                                >
                                    {isReplacing ? 'Updating...' : 'Confirm & Replace'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
