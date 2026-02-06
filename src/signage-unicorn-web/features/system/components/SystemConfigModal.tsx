'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-fetch';

interface SystemConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SystemConfigModal({ isOpen, onClose }: SystemConfigModalProps) {
    const [config, setConfig] = useState<{ currentBaseUrl: string, detectedIp: string, suggestedBaseUrl: string } | null>(null);
    const [newIp, setNewIp] = useState('');
    const [newPort, setNewPort] = useState(5018);
    const [newFrontendPort, setNewFrontendPort] = useState(3000);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const loadConfig = async () => {
        setRefreshing(true);
        try {
            const res = await apiFetch('/server/config');
            if (res.success && res.data) {
                setConfig(res.data);
                if (res.data.detectedIp) setNewIp(res.data.detectedIp);
                if (res.data.currentBaseUrl) {
                    try {
                        const url = new URL(res.data.currentBaseUrl);
                        setNewPort(parseInt(url.port) || 80);
                    } catch (e) { }
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setRefreshing(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadConfig();
        }
    }, [isOpen]);

    const handleExecute = async () => {
        const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        if (!ipRegex.test(newIp)) {
            alert("Invalid IP Address format");
            return;
        }

        if (!confirm(`WARNING: This will update the Backend Config, SQL Database, and attempts to update Frontend .env to use IP: ${newIp}.\n\nThe system might restart.\n\nProceed?`)) return;

        setLoading(true);
        try {
            const res = await apiFetch('/server/config', {
                method: 'POST',
                body: JSON.stringify({
                    ipAddress: newIp,
                    port: newPort,
                    frontendPort: newFrontendPort
                })
            });

            if (res.success) {
                alert("Success: " + res.message);
                window.location.reload();
            } else {
                alert("Error: " + res.message);
            }
        } catch (e: any) {
            alert("Execution Failed: " + (e.message || "Unknown error"));
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-card-solid p-10 rounded-[2.5rem] border border-border shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-accent-cyan via-accent-purple to-accent-cyan" />

                <div className="flex justify-between items-start mb-8">
                    <div>
                        <h3 className="text-3xl font-black text-foreground uppercase tracking-tighter">System Config</h3>
                        <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold mt-1">Network Transmission Settings</p>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">✕</button>
                </div>

                {!config && refreshing ? (
                    <div className="py-20 text-center animate-pulse text-accent-cyan font-black uppercase tracking-widest">Initialising Config...</div>
                ) : !config ? (
                    <div className="py-20 text-center">
                        <button onClick={loadConfig} className="text-accent-cyan underline uppercase font-bold text-xs">Retry Loading Protocol</button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center bg-muted/30 p-4 rounded-2xl border border-border">
                            <div>
                                <span className="text-[10px] uppercase text-muted-foreground font-black block">Detected Local IP</span>
                                <span className="text-green-400 font-mono font-bold text-xl">{config.detectedIp}</span>
                            </div>
                            <div className="text-right">
                                <span className="text-[10px] uppercase text-muted-foreground font-black block">Active Host</span>
                                <code className="text-accent-cyan font-mono text-xs">{config.currentBaseUrl}</code>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">New IP Override</label>
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    value={newIp}
                                    onChange={(e) => setNewIp(e.target.value)}
                                    className="flex-[3] bg-muted/20 border border-border rounded-2xl px-5 py-4 outline-none focus:border-accent-cyan transition-all font-mono text-lg text-foreground dark:[color-scheme:dark]"
                                    placeholder="192.168.1.XX"
                                />
                                <input
                                    type="number"
                                    value={newPort}
                                    onChange={(e) => setNewPort(parseInt(e.target.value))}
                                    className="flex-1 bg-muted/20 border border-border rounded-2xl px-5 py-4 outline-none focus:border-accent-cyan transition-all font-mono text-lg text-center text-foreground dark:[color-scheme:dark]"
                                    placeholder="Port"
                                />
                                <button
                                    onClick={() => setNewIp(config.detectedIp)}
                                    className="px-6 rounded-2xl bg-muted/30 hover:bg-muted/50 border border-border text-[10px] font-black uppercase tracking-widest transition-all text-foreground"
                                >
                                    Auto
                                </button>
                            </div>
                            <div className="bg-accent-purple/5 p-3 rounded-xl border border-accent-purple/10">
                                <p className="text-[9px] text-accent-purple font-medium leading-relaxed">
                                    CHANGING IP WILL RE-MAP ALL MEDIA TRANSACTIONS AND AUTHENTICATION ENDPOINTS.
                                    ENSURE THE DEVICE HAS A STATIC IP BEFORE COMMITTING.
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">Frontend Port (Dashboard)</label>
                            <input
                                type="number"
                                value={newFrontendPort}
                                onChange={(e) => setNewFrontendPort(parseInt(e.target.value))}
                                className="w-full bg-muted/20 border border-border rounded-2xl px-5 py-4 outline-none focus:border-accent-cyan transition-all font-mono text-lg text-center text-foreground dark:[color-scheme:dark]"
                                placeholder="Port 3000"
                            />
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button onClick={onClose} className="flex-1 py-4 rounded-2xl bg-muted/30 text-muted-foreground font-bold hover:bg-muted/50 hover:text-foreground transition-all uppercase tracking-widest text-xs">Cancel</button>
                            <button
                                onClick={handleExecute}
                                disabled={loading}
                                className="flex-[2] py-4 rounded-2xl bg-accent-cyan text-black font-black uppercase tracking-[0.2em] hover:shadow-[0_0_30px_rgba(0,242,255,0.4)] disabled:opacity-50 transition-all text-xs"
                            >
                                {loading ? 'EXECUTING...' : 'INITIATE UPDATE'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
