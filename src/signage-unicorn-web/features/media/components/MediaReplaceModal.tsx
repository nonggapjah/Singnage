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

    useEffect(() => {
        if (step === 'impact') {
            loadUsage();
        }
    }, [step]);

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
            // We don't have the full object, but we have the ID. 
            // We can fetch it or just fake it for UI if needed, but fetching is safer.
            // For now, let's just proceed to impact.
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
                alert('Replacement Failed: ' + res.message); // Simple alert fallback for error
            }
        } catch (e) {
            console.error(e);
            alert('An error occurred');
        } finally {
            setIsReplacing(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-[#121212] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <RefreshCw className="text-accent-cyan animate-spin-slow" size={24} />
                            <h2 className="text-xl font-bold text-white">Replace Media Content</h2>
                        </div>
                        <p className="text-gray-400 text-sm">Swap content across all playlists automatically</p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Stepper */}
                <div className="flex items-center justify-center py-6 border-b border-white/5 bg-white/2">
                    <div className={`flex items-center gap-2 ${step === 'select' ? 'text-accent-cyan' : 'text-gray-500'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${step === 'select' || IsStepComplete('select', step) ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan font-bold' : 'border-gray-600'}`}>1</div>
                        <span className="font-medium text-sm">Select New</span>
                    </div>
                    <div className="w-16 h-px bg-white/10 mx-4"></div>
                    <div className={`flex items-center gap-2 ${step === 'impact' ? 'text-accent-cyan' : 'text-gray-500'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${step === 'impact' || IsStepComplete('impact', step) ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan font-bold' : 'border-gray-600'}`}>2</div>
                        <span className="font-medium text-sm">Review Impact</span>
                    </div>
                    <div className="w-16 h-px bg-white/10 mx-4"></div>
                    <div className={`flex items-center gap-2 ${step === 'confirm' ? 'text-accent-cyan' : 'text-gray-500'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${step === 'confirm' ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan font-bold' : 'border-gray-600'}`}>3</div>
                        <span className="font-medium text-sm">Confirm</span>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-6 min-h-[400px]">

                    {/* STEP 1: SELECT */}
                    {step === 'select' && (
                        <div className="space-y-6">
                            {/* Tabs */}
                            <div className="flex border-b border-white/10">
                                <button
                                    onClick={() => setActiveTab('upload')}
                                    className={`px-6 py-3 text-sm font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'upload' ? 'border-accent-cyan text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                                >
                                    Upload New File
                                </button>
                                <button
                                    onClick={() => setActiveTab('existing')}
                                    className={`px-6 py-3 text-sm font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === 'existing' ? 'border-accent-cyan text-accent-cyan' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                                >
                                    Select Existing
                                </button>
                            </div>

                            {activeTab === 'upload' && (
                                <div className="py-4">
                                    {/* Simplified Wrapper for MediaUploadZone if needed, or stick with default */}
                                    {/* We pass a special prop or just style it via CSS if possible, but for now standard is ok */}
                                    <MediaUploadZone
                                        onUploadSuccess={handleUploadComplete}
                                        onCancel={() => { }} // No cancel button needed inside tab really
                                    />
                                </div>
                            )}

                            {activeTab === 'existing' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                            <input
                                                type="text"
                                                placeholder="Search library..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && loadMedia()}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan"
                                            />
                                        </div>
                                        <button
                                            onClick={loadMedia}
                                            className="px-4 bg-accent-cyan/10 text-accent-cyan rounded-xl border border-accent-cyan/20 hover:bg-accent-cyan/20 transition-colors"
                                        >
                                            <RefreshCw size={18} />
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                                        {mediaList.map(m => (
                                            <div
                                                key={m.mediaId}
                                                onClick={() => handleExistingSelect(m)}
                                                className={`group relative rounded-xl border-2 overflow-hidden cursor-pointer transition-all ${selectedNewMediaId === m.mediaId
                                                        ? 'border-accent-cyan shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                                                        : 'border-white/5 hover:border-white/20'
                                                    }`}
                                            >
                                                <div className="aspect-video bg-black/50 relative">
                                                    {m.blobUrl ? (
                                                        m.fileName.match(/\.(mp4|webm|mov)$/i) ? (
                                                            <video src={m.blobUrl} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <img src={m.blobUrl} className="w-full h-full object-cover" />
                                                        )
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                                                            {m.fileName.endsWith('.mp4') ? <FileVideo /> : <ImageIcon />}
                                                        </div>
                                                    )}

                                                    {selectedNewMediaId === m.mediaId && (
                                                        <div className="absolute inset-0 bg-accent-cyan/20 flex items-center justify-center">
                                                            <CheckCircle className="text-accent-cyan fill-black" size={32} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="p-3 bg-white/5">
                                                    <p className="text-xs font-bold text-white truncate">{m.displayName}</p>
                                                    <p className="text-[10px] text-gray-500 truncate">{m.fileName}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-end pt-4">
                                        <button
                                            disabled={!selectedNewMediaId}
                                            onClick={() => setStep('impact')}
                                            className="px-8 py-3 bg-accent-cyan text-black font-black uppercase tracking-wider rounded-xl hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
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
                                <AlertTriangle className="text-yellow-500 shrink-0" size={24} />
                                <div>
                                    <h3 className="font-bold text-yellow-500">Replacement Warning</h3>
                                    <p className="text-sm text-yellow-500/80 mt-1">
                                        You are about to replace <strong>{targetMedia.displayName}</strong>.
                                        This change will immediately affect {usageList.length} playlist(s) and connected devices.
                                    </p>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Affected Playlists</h4>
                                <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                                    {loadingUsage ? (
                                        <div className="p-8 text-center text-gray-500">Calculating impact...</div>
                                    ) : usageList.length === 0 ? (
                                        <div className="p-8 text-center text-gray-500">No playlists currently use this media. Safe to replace.</div>
                                    ) : (
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-white/5 text-gray-400">
                                                <tr>
                                                    <th className="p-3 pl-4">Playlist Name</th>
                                                    <th className="p-3">Duration</th>
                                                    <th className="p-3">Screens</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {usageList.map((usage, i) => (
                                                    <tr key={i} className="text-gray-300">
                                                        <td className="p-3 pl-4 font-medium">{usage.playlistName}</td>
                                                        <td className="p-3">{usage.durationSec}s</td>
                                                        <td className="p-3">{usage.deviceCount || '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between pt-4">
                                <button
                                    onClick={() => setStep('select')}
                                    className="text-gray-400 hover:text-white font-bold text-sm uppercase tracking-wider"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={() => setStep('confirm')}
                                    className="px-8 py-3 bg-accent-cyan text-black font-black uppercase tracking-wider rounded-xl hover:bg-cyan-300 transition-all flex items-center gap-2"
                                >
                                    Proceed <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: CONFIRM */}
                    {step === 'confirm' && (
                        <div className="flex flex-col items-center justify-center py-8 text-center space-y-6 animate-in fade-in zoom-in-95">
                            <div className="w-20 h-20 rounded-full bg-accent-cyan/10 flex items-center justify-center border-2 border-accent-cyan/50 shadow-[0_0_30px_rgba(34,211,238,0.2)]">
                                <RefreshCw className="text-accent-cyan" size={40} />
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-2xl font-black text-white uppercase italic">Ready to Switch?</h3>
                                <p className="text-gray-400 max-w-md mx-auto">
                                    Confirming this action will permanently update the content reference.
                                    The old file will be archived.
                                </p>
                            </div>

                            <div className="flex items-center gap-8 w-full max-w-md bg-white/5 p-6 rounded-2xl border border-white/10">
                                <div className="flex-1 space-y-2 opacity-50 grayscale">
                                    <p className="text-xs font-bold text-gray-500 uppercase">Current</p>
                                    <div className="aspect-video bg-black rounded-lg overflow-hidden border border-white/10">
                                        {/* Thumbnail would act here, simpler fallback */}
                                        <div className="w-full h-full flex items-center justify-center bg-white/5 text-gray-600">Old</div>
                                    </div>
                                    <p className="text-xs truncate text-gray-400">{targetMedia.displayName}</p>
                                </div>
                                <ArrowRight className="text-accent-cyan" size={24} />
                                <div className="flex-1 space-y-2">
                                    <p className="text-xs font-bold text-accent-cyan uppercase">New Content</p>
                                    <div className="aspect-video bg-black rounded-lg overflow-hidden border border-accent-cyan/50 shadow-lg shadow-cyan-500/20">
                                        {selectedNewMedia?.blobUrl ? (
                                            <img src={selectedNewMedia.blobUrl} className="w-full h-full object-cover" />
                                            // Not handling video here simply
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-accent-cyan/10 text-accent-cyan font-bold">New</div>
                                        )}
                                    </div>
                                    <p className="text-xs truncate text-white font-bold">{selectedNewMedia?.displayName || 'Uploaded File'}</p>
                                </div>
                            </div>

                            <div className="flex gap-4 w-full max-w-md pt-4">
                                <button
                                    onClick={() => setStep('impact')}
                                    className="flex-1 py-3 text-sm font-bold text-gray-500 hover:text-white uppercase tracking-wider"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={handleConfirmReplacement}
                                    disabled={isReplacing}
                                    className="flex-[2] py-4 bg-accent-cyan text-black font-black uppercase tracking-widest rounded-xl hover:bg-cyan-300 disabled:opacity-50 shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all"
                                >
                                    {isReplacing ? 'Processing...' : 'Confirm Switch'}
                                </button>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

function IsStepComplete(stepName: Step, currentStep: Step): boolean {
    const order = ['select', 'impact', 'confirm'];
    return order.indexOf(stepName) < order.indexOf(currentStep);
}
