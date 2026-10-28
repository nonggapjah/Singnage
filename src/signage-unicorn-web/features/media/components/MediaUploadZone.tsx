'use client';

import React, { useState, useRef, useId } from 'react';
import { expiryDateForApi } from '@/features/ui/utils/datetime';
import { getCapabilities } from '@/lib/api-capabilities';
import { getMediaMetadata } from '../utils/media-helpers';
import { mediaApi } from '../api/media-api';
import { Modal } from '@/components/ui/Modal';

interface MediaUploadZoneProps {
    onUploadSuccess: (mediaId?: string) => void;
    onCancel: () => void;
    isEmbed?: boolean;
    targetMediaId?: string;
}

export const MediaUploadZone: React.FC<MediaUploadZoneProps> = ({ onUploadSuccess, onCancel, isEmbed = false, targetMediaId }) => {
    const [uploading, setUploading] = useState(false);
    const [uploadFinished, setUploadFinished] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [supplierCode, setSupplierCode] = useState('');
    const [customName, setCustomName] = useState('');
    const [remark1, setRemark1] = useState('');
    const [remark2, setRemark2] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [metadata, setMetadata] = useState<{ duration: number, ratio: string } | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [showAsyncNotice, setShowAsyncNotice] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const uid = useId();
    const fieldId = (name: string) => `upload-${name}-${uid}`;

    const onFileSelect = async (file: File) => {
        setSelectedFile(file);
        setUploading(true);
        setUploadFinished(false);
        setMetadata(null);

        // Create preview (revoke the previous one so object URLs do not pile up)
        setPreviewUrl(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(file);
        });

        // Mode 1: Metadata extraction (Simulating immediate feedback)
        try {
            const meta = await getMediaMetadata(file);
            setMetadata(meta);
        } catch (e) {
            console.error("Metadata extraction failed", e);
        }

        // Simulate upload delay
        setTimeout(() => {
            setUploading(false);
            setUploadFinished(true);
        }, 1500); // Faster simulation
    };

    const handleSave = async (isAsync: boolean = false) => {
        if (!selectedFile) return;
        setUploading(true);

        try {
            const formData = new FormData();
            formData.append('File', selectedFile);
            formData.append('FileName', selectedFile.name);
            formData.append('DisplayName', customName || selectedFile.name);
            formData.append('DurationSec', (metadata?.duration || 0).toString());
            formData.append('Ratio', metadata?.ratio || '16:9');
            formData.append('FileSizeKb', Math.floor(selectedFile.size / 1024).toString());
            formData.append('Supplier_Code', supplierCode);
            formData.append('Remark1', remark1);
            formData.append('Remark2', remark2);
            // An expiry date means "until the end of that day" in local time; the API stores UTC.
            if (endDate) formData.append('EndDate', expiryDateForApi(endDate, (await getCapabilities()).utcFilters) ?? '');

            if (!customName.trim()) {
                alert('Display Name is required / กรุณาระบุชื่อสื่อ');
                setUploading(false);
                return;
            }
            if (!supplierCode.trim()) {
                alert('Supplier Code is required / กรุณาระบุรหัสผู้จัดทำ');
                setUploading(false);
                return;
            }

            let res;
            if (targetMediaId) {
                // Direct Content Replacement
                res = await mediaApi.replaceContent(targetMediaId, formData);
            } else {
                // New Upload
                res = await mediaApi.upload(formData);
            }

            if (!res.success) {
                throw new Error(res.message || 'Upload failed');
            }

            if (isAsync && !uploadFinished) {
                setShowAsyncNotice(true);
            }

            onUploadSuccess(res.data?.mediaId);
            resetForm();
        } catch (error) {
            console.error("Save failed", error);
            alert(`Upload Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setUploading(false);
        }
    };

    const resetForm = () => {
        setSupplierCode('');
        setCustomName('');
        setRemark1('');
        setRemark2('');
        setEndDate('');
        setSelectedFile(null);
        setMetadata(null);
        setPreviewUrl(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        setShowAsyncNotice(false);
        setUploadFinished(false);
        if (inputRef.current) inputRef.current.value = '';
    };

    const handleFiles = (files: FileList) => {
        if (files[0]) onFileSelect(files[0]);
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFiles(e.dataTransfer.files);
        }
    };

    const containerClasses = isEmbed
        ? "w-full bg-transparent overflow-visible"
        : "w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl ring-1 ring-border mx-auto text-foreground";

    const inputClass = 'w-full px-4 py-2 rounded-xl bg-muted/20 border border-border text-foreground text-sm focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 focus:outline-none transition-colors placeholder:text-muted-foreground/60';
    const labelClass = 'block text-xs font-black text-muted-foreground uppercase tracking-wider mb-1.5 ml-1';

    return (
        <div className={containerClasses}>
            {/* Header - Hide if embedded */}
            {!isEmbed && (
                <div className="flex items-center justify-between border-b border-border px-8 py-6 bg-muted/20">
                    <div>
                        <h1 className="text-xl font-black uppercase tracking-tighter text-foreground">Upload media</h1>
                        <p className="mt-1 text-xs font-bold text-muted-foreground uppercase tracking-widest">Digital signage content</p>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        aria-label="Close upload"
                        className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}

            <div className={`grid grid-cols-1 ${isEmbed ? 'lg:grid-cols-5' : 'md:grid-cols-5'} ${isEmbed ? 'p-0 bg-transparent' : 'bg-background'}`}>
                {/* Left Column: Form */}
                <div className={`${isEmbed ? 'p-0 lg:pr-8 lg:col-span-2' : 'p-8 md:col-span-2'} border-b border-border  ${isEmbed ? 'lg:border-r lg:border-b-0' : 'md:border-r md:border-b-0'} space-y-4`}>
                    {isEmbed && <h2 className="text-xs font-black uppercase tracking-[0.2em] text-accent-cyan">Media details</h2>}
                    {!isEmbed && <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Media details</h2>}

                    <div className="space-y-3 sm:space-y-4">
                        <div>
                            <label htmlFor={fieldId('name')} className={labelClass}>
                                Display name <span className="text-red-500" aria-hidden="true">*</span>
                            </label>
                            <input
                                id={fieldId('name')}
                                type="text"
                                required
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                placeholder="ระบุชื่อสื่อ..."
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <label htmlFor={fieldId('supplier')} className={labelClass}>
                                Supplier code <span className="text-red-500" aria-hidden="true">*</span>
                            </label>
                            <input
                                id={fieldId('supplier')}
                                type="text"
                                required
                                value={supplierCode}
                                onChange={(e) => setSupplierCode(e.target.value)}
                                placeholder="ระบุรหัส..."
                                className={inputClass}
                            />
                        </div>

                        {!isEmbed && (
                            <>
                                <div>
                                    <label htmlFor={fieldId('remark1')} className={labelClass}>Remark 1</label>
                                    <textarea
                                        id={fieldId('remark1')}
                                        value={remark1}
                                        onChange={(e) => setRemark1(e.target.value)}
                                        placeholder="รายละเอียดเพิ่มเติม..."
                                        className={`${inputClass} h-24 resize-none py-3`}
                                    />
                                </div>

                                <div>
                                    <label htmlFor={fieldId('remark2')} className={labelClass}>Remark 2</label>
                                    <input
                                        id={fieldId('remark2')}
                                        type="text"
                                        value={remark2}
                                        onChange={(e) => setRemark2(e.target.value)}
                                        placeholder="หมายเหตุ..."
                                        className={`${inputClass} py-3`}
                                    />
                                </div>
                            </>
                        )}

                        {isEmbed && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                <div>
                                    <label htmlFor={fieldId('remark1')} className={labelClass}>Remark 1</label>
                                    <input
                                        id={fieldId('remark1')}
                                        type="text"
                                        value={remark1}
                                        onChange={(e) => setRemark1(e.target.value)}
                                        placeholder="เพิ่ม..."
                                        className={`${inputClass} text-xs`}
                                    />
                                </div>
                                <div>
                                    <label htmlFor={fieldId('remark2')} className={labelClass}>Remark 2</label>
                                    <input
                                        id={fieldId('remark2')}
                                        type="text"
                                        value={remark2}
                                        onChange={(e) => setRemark2(e.target.value)}
                                        placeholder="เหตุ..."
                                        className={`${inputClass} text-xs`}
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label htmlFor={fieldId('enddate')} className={labelClass}>
                                End date (optional)
                            </label>
                            <input
                                id={fieldId('enddate')}
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className={`${inputClass} dark:[color-scheme:dark]`}
                            />
                        </div>
                    </div>
                </div>

                {/* Right Column: Upload */}
                <div className={`${isEmbed ? 'p-0 pt-6 lg:pt-0 lg:col-span-3' : 'p-8 md:col-span-3'} flex flex-col h-full relative`}>
                    {!selectedFile ? (
                        <label
                            htmlFor={fieldId('file')}
                            className={`group relative flex flex-grow w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors duration-300 min-h-[300px] gap-4 focus-within:ring-2 focus-within:ring-ring
                                ${dragActive
                                    ? 'border-accent-cyan bg-accent-cyan/10'
                                    : 'border-border bg-muted/10 hover:border-accent-cyan/50 hover:bg-muted/20'}`}
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                        >
                            <input
                                id={fieldId('file')}
                                ref={inputRef}
                                type="file"
                                className="sr-only"
                                onChange={(e) => e.target.files && handleFiles(e.target.files)}
                                accept="image/*,video/*"
                            />
                            <div className="w-20 h-20 rounded-full bg-accent-cyan/10 text-accent-cyan flex items-center justify-center transition-transform duration-300 group-hover:scale-110 border border-accent-cyan/20 group-hover:bg-accent-cyan group-hover:text-black" aria-hidden="true">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                            </div>
                            <div className="text-center">
                                <p className="text-xl font-black text-foreground uppercase tracking-tight">Drop media here</p>
                                <p className="mt-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">or click to browse (images and videos)</p>
                            </div>
                        </label>
                    ) : (
                        <div className="flex-1 flex flex-col justify-center">
                            <div className="mt-0">
                                <p className="block text-xs font-black text-muted-foreground uppercase tracking-wider mb-3 ml-1">Ready to upload</p>
                                <div className="flex cursor-default items-center justify-between rounded-2xl border border-border bg-muted/20 p-4 shadow-sm transition-colors hover:bg-muted/30 relative overflow-hidden group">
                                    <div className="flex items-center gap-4 z-10 w-full">
                                        <div className="relative h-16 w-16 overflow-hidden rounded-xl bg-black shadow-inner flex-shrink-0 border border-border/50">
                                            {previewUrl && (
                                                selectedFile.type.includes('video') ? (
                                                    <video src={previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover opacity-80" />
                                                ) : (
                                                    <img src={previewUrl} className="h-full w-full object-cover opacity-80 border-0" alt="Preview of the selected file" />
                                                )
                                            )}
                                            <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                                                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/40">
                                                    {selectedFile.type.includes('video') ? (
                                                        <svg className="ml-0.5 h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                    ) : (
                                                        <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold text-foreground truncate">{selectedFile.name}</p>
                                            <p className="mt-1 text-xs font-mono text-muted-foreground" aria-live="polite">
                                                {uploading ? (
                                                    <span className="text-accent-cyan font-bold">Processing…</span>
                                                ) : (
                                                    metadata ? `${metadata.duration}s • ${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • ${metadata.ratio}` : 'Calculating metadata…'
                                                )}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={resetForm}
                                            aria-label="Remove selected file"
                                            title="Remove file"
                                            className="rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>

                                    {/* Upload Progress Bar Overlay */}
                                    {uploading && (
                                        <div className="absolute bottom-0 left-0 h-1 bg-accent-cyan animate-pulse w-full opacity-70" aria-hidden="true"></div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Buttons - Hide if embedded or style differently */}
            <div className={`flex items-center justify-end gap-4 border-t border-border ${isEmbed ? 'bg-transparent border-t-0 pt-6 px-0' : 'bg-muted/20 px-8 py-5'}`}>
                {!isEmbed && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-xl px-6 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                    >
                        Cancel
                    </button>
                )}
                <div className="flex gap-2 flex-grow md:flex-grow-0">
                    {selectedFile && !isEmbed && (
                        <button
                            type="button"
                            onClick={() => handleSave(true)}
                            className="rounded-xl px-6 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground border border-border hover:bg-muted/30 transition-colors"
                        >
                            Save in background
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => handleSave(false)}
                        disabled={!selectedFile || (uploading && !uploadFinished)}
                        className={`rounded-xl px-8 py-3 text-xs font-black uppercase tracking-[0.2em] transition-colors w-full md:w-auto
                            ${(!selectedFile || (uploading && !uploadFinished))
                                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                : 'bg-accent-cyan text-black hover:bg-cyan-300'}
                        `}
                    >
                        {uploadFinished ? (isEmbed ? 'Confirm new file' : 'Save media') : 'Upload & save'}
                    </button>
                </div>
            </div>

            {/* Background processing notice */}
            <Modal
                isOpen={showAsyncNotice}
                onClose={() => { setShowAsyncNotice(false); onUploadSuccess(); resetForm(); }}
                size="md"
                labelledBy="upload-async-title"
                zIndexClass="z-[1200]"
                className="p-8 text-center space-y-6"
            >
                <div className="w-20 h-20 bg-accent-cyan/10 text-accent-cyan rounded-full flex items-center justify-center mx-auto text-3xl border border-accent-cyan/20" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <div className="space-y-2">
                    <h3 id="upload-async-title" className="text-2xl font-black text-foreground uppercase tracking-tight">Background processing</h3>
                    <p className="text-muted-foreground leading-relaxed text-sm font-medium" lang="th">
                        ระบบกำลังประมวลผลวิดีโอในพื้นหลัง...
                        คุณสามารถตรวจสอบสถานะได้ในหน้าคลังสื่อ
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => { setShowAsyncNotice(false); onUploadSuccess(); resetForm(); }}
                    className="w-full py-4 bg-accent-cyan text-black font-black uppercase tracking-widest rounded-xl hover:bg-cyan-300 transition-colors"
                >
                    OK
                </button>
            </Modal>
        </div>
    );
};
