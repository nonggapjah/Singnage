'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { Modal } from '@/components/ui/Modal';

interface SystemConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SystemConfigModal({ isOpen, onClose }: SystemConfigModalProps) {
    const [config, setConfig] = useState<{ currentBaseUrl: string, detectedIp: string, suggestedBaseUrl: string } | null>(null);
    const [newIp, setNewIp] = useState('');
    const [newPort, setNewPort] = useState(8862); // API port. Was 8865 -- that is the WEB port, and this field sets the API's.
    const [newFrontendPort, setNewFrontendPort] = useState(8865); // Web port. Was 3000, Next.js's dev default, never this deployment's.
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const loadConfig = async () => {
        setRefreshing(true);
        try {
            const res = await apiFetch('/server/config');
            if (res.success && res.data) {
                setConfig(res.data);
                if (res.data.detectedIp) setNewIp(res.data.detectedIp);

                // Prefer the ports the server reports. Parsing them out of the base URL is a
                // fallback; leaving either at its useState default is the dangerous case, because
                // submitting this form writes both into the frontend .env and the API base URL.
                if (typeof res.data.apiPort === 'number' && res.data.apiPort > 0) {
                    setNewPort(res.data.apiPort);
                } else if (res.data.currentBaseUrl) {
                    try {
                        const url = new URL(res.data.currentBaseUrl);
                        setNewPort(parseInt(url.port) || 80);
                    } catch {
                        // Swallowing this left the field showing a default the user could then
                        // save over the real value, for every device in the fleet.
                        console.warn(`[settings] Could not parse currentBaseUrl "${res.data.currentBaseUrl}". `
                            + `The API port shown is a default, not the server's actual value -- do not save without checking it.`);
                    }
                }

                if (typeof res.data.frontendPort === 'number' && res.data.frontendPort > 0) {
                    setNewFrontendPort(res.data.frontendPort);
                } else {
                    console.warn('[settings] The server did not report a frontend port. The value shown is a default; '
                        + 'saving it would rewrite PORT= in the frontend .env.');
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
        } catch (e) {
            alert("Execution Failed: " + (e instanceof Error ? e.message : "Unknown error"));
        } finally {
            setLoading(false);
        }
    };

    const inputClass = 'bg-muted/20 border border-border rounded-2xl px-5 py-4 outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors font-mono text-lg text-foreground placeholder:text-muted-foreground/70';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="lg"
            closeDisabled={loading}
            showClose
            labelledBy="system-config-title"
            zIndexClass="z-[1000]"
            className="bg-card-solid p-8 sm:p-10 rounded-[2.5rem] overflow-hidden"
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-accent-cyan via-accent-purple to-accent-cyan" aria-hidden="true" />

            <div className="mb-8 pr-10">
                <h3 id="system-config-title" className="text-3xl font-black text-foreground uppercase tracking-tighter">Server address</h3>
                <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold mt-1">API and dashboard network settings</p>
            </div>

            {!config && refreshing ? (
                <div className="py-20 text-center text-accent-cyan font-black uppercase tracking-widest" role="status">Loading…</div>
            ) : !config ? (
                <div className="py-20 text-center">
                    <button type="button" onClick={loadConfig} className="text-accent-cyan underline uppercase font-bold text-xs">Retry</button>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="flex justify-between items-center bg-muted/30 p-4 rounded-2xl border border-border gap-4">
                        <div>
                            <span className="text-xs uppercase text-muted-foreground font-black block">Detected local IP</span>
                            <span className="text-green-600 dark:text-green-400 font-mono font-bold text-xl">{config.detectedIp}</span>
                        </div>
                        <div className="text-right min-w-0">
                            <span className="text-xs uppercase text-muted-foreground font-black block">Active host</span>
                            <code className="text-accent-cyan font-mono text-xs break-all">{config.currentBaseUrl}</code>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label htmlFor="cfg-ip" className="block text-xs font-black text-muted-foreground uppercase tracking-widest ml-1">New IP address</label>
                        <div className="flex gap-3">
                            <input
                                id="cfg-ip"
                                type="text"
                                inputMode="decimal"
                                value={newIp}
                                onChange={(e) => setNewIp(e.target.value)}
                                className={`flex-[3] min-w-0 ${inputClass}`}
                                placeholder="192.168.1.XX"
                            />
                            <input
                                id="cfg-api-port"
                                type="number"
                                aria-label="API port"
                                value={newPort}
                                onChange={(e) => setNewPort(parseInt(e.target.value))}
                                className={`flex-1 min-w-0 text-center ${inputClass}`}
                                placeholder="Port"
                            />
                            <button
                                type="button"
                                onClick={() => setNewIp(config.detectedIp)}
                                className="px-6 rounded-2xl bg-muted/30 hover:bg-muted/50 border border-border text-xs font-black uppercase tracking-widest transition-colors text-foreground"
                            >
                                Auto
                            </button>
                        </div>
                        <div className="bg-accent-purple/5 p-3 rounded-xl border border-accent-purple/10">
                            <p className="text-xs text-foreground/80 font-medium leading-relaxed">
                                Changing the IP re-maps every media URL and authentication endpoint.
                                Make sure the server has a static IP before applying.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label htmlFor="cfg-web-port" className="block text-xs font-black text-muted-foreground uppercase tracking-widest ml-1">Dashboard (web) port</label>
                        <input
                            id="cfg-web-port"
                            type="number"
                            value={newFrontendPort}
                            onChange={(e) => setNewFrontendPort(parseInt(e.target.value))}
                            className={`w-full text-center ${inputClass}`}
                            placeholder="8865"
                        />
                    </div>

                    <div className="flex gap-4 pt-4">
                        <button type="button" onClick={onClose} disabled={loading} className="flex-1 py-4 rounded-2xl bg-muted/30 text-muted-foreground font-bold hover:bg-muted/50 hover:text-foreground transition-colors uppercase tracking-widest text-xs disabled:opacity-50">Cancel</button>
                        <button
                            type="button"
                            onClick={handleExecute}
                            disabled={loading}
                            className="flex-[2] py-4 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-[0.2em] hover:brightness-110 disabled:opacity-50 transition-colors text-xs"
                        >
                            {loading ? 'Applying…' : 'Apply'}
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
