'use client';

import React, { useState, useEffect } from 'react';
import { deviceApi } from '@/features/devices/api/device-api';
import { generateId } from '@/lib/utils';
// import { useUI } from '@/features/ui/context/UIContext'; // Removed unused import

interface DeviceRegistrationProps {
    onRegisterSuccess: (deviceId: string) => void;
}

export const DeviceRegistration: React.FC<DeviceRegistrationProps> = ({ onRegisterSuccess }) => {
    const [name, setName] = useState('');
    const [branch, setBranch] = useState('');
    const [uuid, setUuid] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        // Generate or retrieve persistent UUID on mount
        let hwid = localStorage.getItem('signage_device_key');
        if (!hwid || hwid.length > 36 || hwid.startsWith('WEB-')) {
            // Regeneration logic if invalid or legacy format
            hwid = generateId();
            localStorage.setItem('signage_device_key', hwid);
        }
        setUuid(hwid);
    }, []);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // Call Real Backend API
            const response = await deviceApi.register({
                deviceKey: uuid,
                deviceName: name,
                branchCode: branch,
                ipAddress: '127.0.0.1' // Frontend placeholder, backend should resolve real IP if needed
            });

            if (response && response.success && response.data) {
                const { deviceId } = response.data; // This might be the numeric ID or UUID depending on backend return, but we handle both.

                // Save important auth data
                localStorage.setItem('signage_device_id', deviceId);
                localStorage.setItem('signage_device_name', name);
                localStorage.setItem('signage_device_branch', branch);

                onRegisterSuccess(deviceId);
            } else {
                const debugInfo = JSON.stringify(response);
                throw new Error((response?.message || 'Invalid response: ') + debugInfo);
            }
        } catch (err: any) {
            console.error('Registration error:', err);
            setError(`Registration failed: ${err.message || 'Server Unreachable'}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-[#050507] overflow-y-auto flex items-center justify-center p-4">
            {/* Background Gradients */}
            <div className="absolute top-[-20%] left-[50%] -translate-x-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(157,0,255,0.15)_0%,transparent_70%)] pointer-events-none blur-3xl"></div>
            <div className="absolute bottom-[-20%] left-[0%] w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(0,242,255,0.08)_0%,transparent_70%)] pointer-events-none blur-3xl"></div>

            <div className="w-full max-w-md relative animate-[zoomIn_0.7s_ease-out]">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400 drop-shadow-[0_0_15px_rgba(0,242,255,0.5)]">
                        DEVICE SETUP
                    </h1>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">One-Time Registration Protocol</p>
                </div>

                <div className="bg-white/5 backdrop-blur-2xl border border-white/10 p-8 rounded-3xl shadow-2xl relative overflow-hidden group hover:border-[#00f2ff]/30 transition-colors duration-500">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#00f2ff] to-transparent animate-pulse opacity-50"></div>

                    <form onSubmit={handleRegister} className="space-y-5">
                        <div className="space-y-1">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Device Unique ID (UUID)</label>
                            <input
                                type="text"
                                value={uuid}
                                disabled
                                className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-3 text-gray-400 font-mono text-xs select-all text-center tracking-widest cursor-not-allowed"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Device Name</label>
                            <div className="relative group/input">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg>
                                </div>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium"
                                    placeholder="e.g. Lobby Entrance Screen"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Branch Code</label>
                            <div className="relative group/input">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"></path><path d="M5 21V7l8-4 8 4v14"></path><path d="M17 21v-8.5a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5V21"></path></svg>
                                </div>
                                <input
                                    type="text"
                                    value={branch}
                                    onChange={e => setBranch(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium"
                                    placeholder="e.g. HQ-01"
                                    required
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs py-3 px-4 rounded-xl text-center font-bold animate-pulse">
                                ⚠ {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className={`w-full py-4 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-xl text-sm relative overflow-hidden group/btn mt-2 ${loading
                                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                : 'bg-[#00f2ff] text-black border-2 border-cyan-400 hover:bg-cyan-300 hover:shadow-[0_0_30px_rgba(34,211,238,0.6)] hover:-translate-y-0.5 transform'
                                }`}
                        >
                            <span className="relative z-10">{loading ? 'INITIALIZING...' : 'INITIALIZE DEVICE'}</span>
                        </button>
                    </form>

                    <div className="mt-8 pt-6 border-t border-white/5 text-center">
                        <p className="text-[10px] text-gray-500 font-mono flex items-center justify-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#00f2ff] animate-pulse"></span>
                            Secure Connection Ready
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
