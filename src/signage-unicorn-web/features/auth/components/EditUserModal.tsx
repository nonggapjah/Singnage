'use client';

import React, { useState, useEffect } from 'react';
import { X, Mail, Phone, Lock, User as UserIcon, Camera } from 'lucide-react';
import { User, userApi, UserUpdateData } from '../../auth/api/user-api';

interface EditUserModalProps {
    user: User | null; // null for new user
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
}

export const EditUserModal: React.FC<EditUserModalProps> = ({ user, isOpen, onClose, onSave }) => {
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        avatarUrl: '', // Not in API yet
        role: 'Viewer',
        contactType: 'email' as 'email' | 'phone',
        contactValue: '', // username
        alternateContactValue: '', // Not in API yet
        newPassword: '',
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (user) {
                // Parse Name
                const names = (user.fullName || '').split(' ');
                const firstName = names[0] || '';
                const lastName = names.slice(1).join(' ') || '';

                setFormData({
                    firstName,
                    lastName,
                    avatarUrl: '',
                    role: user.role,
                    contactType: user.username.includes('@') ? 'email' : 'phone',
                    contactValue: user.username,
                    alternateContactValue: '',
                    newPassword: ''
                });
            } else {
                // New User Default
                setFormData({
                    firstName: '',
                    lastName: '',
                    avatarUrl: '',
                    role: 'Viewer',
                    contactType: 'email',
                    contactValue: '',
                    alternateContactValue: '',
                    newPassword: ''
                });
            }
        }
    }, [isOpen, user]);

    const handleSave = async () => {
        setLoading(true);
        try {
            const fullName = `${formData.firstName} ${formData.lastName}`.trim();
            const username = formData.contactValue;

            if (user && user.userId) {
                // Update
                const updateData: UserUpdateData = {
                    fullName,
                    role: formData.role,
                };

                await userApi.update(user.userId, updateData);

                if (formData.newPassword) {
                    // This is tricky as we need old password for current user change, 
                    // but for admin resetting another user's password, we usually have a different endpoint or logic.
                    // The current API `changePassword` requires oldPassword.
                    // If this is an Admin function, we might need a `resetPassword` endpoint.
                    // For now, I'll alert if they try to change password that it might not work without old pw logic or backend support.
                    // However, if creating NEW user, we use it.
                    alert("Password update for existing users might require 'Reset Password' flow (not implemented in this mock).");
                }
            } else {
                // Create
                await userApi.create({
                    username,
                    password: formData.newPassword || '123456',
                    fullName,
                    role: formData.role
                });
            }
            onSave();
            onClose();
        } catch (error) {
            console.error("Failed to save user", error);
            alert("Failed to save user.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-5xl bg-[#0a0a0a] border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden relative">
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors z-10"
                >
                    <X size={24} />
                </button>

                <div className="p-8 pb-4">
                    <h2 className="text-3xl font-black text-white uppercase tracking-tight">
                        {user ? 'Edit Profile' : 'New Member'}
                    </h2>
                    <p className="text-gray-500 text-sm font-bold tracking-wide uppercase">
                        {user ? 'Update Account Details' : 'Onboard a new team member'}
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto p-8 pt-0 grid grid-cols-1 lg:grid-cols-2 gap-12">

                    {/* LEFT COL: IDENTITY */}
                    <div className="space-y-6">
                        <h3 className="text-accent-cyan text-xs font-black uppercase tracking-widest mb-4">Identity</h3>

                        <div className="flex gap-4">
                            <div className="flex-1 space-y-2">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">First Name</label>
                                <input
                                    type="text"
                                    value={formData.firstName}
                                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-accent-cyan outline-none transition-colors"
                                    placeholder="e.g. Somchai"
                                />
                            </div>
                            <div className="flex-1 space-y-2">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Last Name</label>
                                <input
                                    type="text"
                                    value={formData.lastName}
                                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-accent-cyan outline-none transition-colors"
                                    placeholder="e.g. Jaidee"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Avatar URL</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={formData.avatarUrl}
                                    onChange={(e) => setFormData({ ...formData, avatarUrl: e.target.value })}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-accent-cyan outline-none transition-colors pl-10"
                                    placeholder="https://..."
                                />
                                <Camera className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" size={18} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Role</label>
                            <div className="relative">
                                <select
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-accent-cyan outline-none transition-colors appearance-none"
                                >
                                    <option value="Admin" className="bg-black">Admin</option>
                                    <option value="Editor" className="bg-black">Editor</option>
                                    <option value="Viewer" className="bg-black">Viewer</option>
                                </select>
                                <UserIcon className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" size={18} />
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COL: SECURITY */}
                    <div className="space-y-6">
                        <h3 className="text-accent-cyan text-xs font-black uppercase tracking-widest mb-4">Security & Contact</h3>

                        <div className="space-y-4">
                            {/* Toggle */}
                            {/* Toggle / Static Display */}
                            {user ? (
                                <div className="flex border border-white/10 rounded-lg p-1.5 bg-white/5 w-fit items-center gap-2">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-2">Registered Via:</span>
                                    {formData.contactType === 'email' ? (
                                        <div className="px-4 py-1 rounded bg-white/10 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2">
                                            <Mail size={14} /> Email
                                        </div>
                                    ) : (
                                        <div className="px-4 py-1 rounded bg-accent-cyan text-black text-xs font-black uppercase tracking-wider flex items-center gap-2">
                                            <Phone size={14} /> Phone
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex border border-white/10 rounded-lg p-1 bg-black/40 w-fit">
                                    <button
                                        onClick={() => setFormData({ ...formData, contactType: 'email' })}
                                        className={`px-6 py-1.5 rounded-md text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all ${formData.contactType === 'email' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        <Mail size={14} /> Email
                                    </button>
                                    <button
                                        onClick={() => setFormData({ ...formData, contactType: 'phone' })}
                                        className={`px-6 py-1.5 rounded-md text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all ${formData.contactType === 'phone' ? 'bg-accent-cyan text-black shadow-[0_0_10px_rgba(34,211,238,0.4)]' : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        <Phone size={14} /> Phone
                                    </button>
                                </div>
                            )}

                            <div className="space-y-2">
                                <input
                                    type="text"
                                    value={formData.contactValue}
                                    onChange={(e) => setFormData({ ...formData, contactValue: e.target.value })}
                                    // Disable editing username for existing users if API doesn't support generic ID change easily
                                    readOnly={!!user}
                                    className={`w-full bg-transparent border border-white/20 rounded-xl px-4 py-3 text-white focus:border-accent-cyan outline-none transition-colors ${!!user ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    placeholder={formData.contactType === 'email' ? 'user@example.com' : '0991234567'}
                                />
                                {!!user && <p className="text-[10px] text-gray-500">* Username/ID cannot be changed once created.</p>}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                {formData.contactType === 'phone' ? 'Alternate Email (Required)' : 'Alternate Phone (Optional)'}
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={formData.alternateContactValue}
                                    onChange={(e) => setFormData({ ...formData, alternateContactValue: e.target.value })}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-accent-cyan outline-none transition-colors pl-10"
                                    placeholder={formData.contactType === 'phone' ? 'backup@example.com' : '099-XXX-XXXX'}
                                />
                                {formData.contactType === 'phone' ? (
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" size={18} />
                                ) : (
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" size={18} />
                                )}
                            </div>
                        </div>

                        <div className="space-y-2 pt-4 border-t border-white/5">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">New Password</label>
                            <div className="relative">
                                <input
                                    type="password"
                                    value={formData.newPassword}
                                    onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white focus:border-accent-cyan outline-none transition-colors pl-4"
                                    placeholder={user ? "Leave blank to keep current" : "Set initial password"}
                                />
                                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600" size={18} />
                            </div>
                        </div>
                    </div>

                </div>

                <div className="p-8 border-t border-white/10 bg-black/20 flex justify-end gap-4">
                    <button
                        onClick={onClose}
                        className="px-8 py-3 rounded-xl border border-white/10 text-white font-bold uppercase tracking-wider hover:bg-white/5 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-8 py-3 rounded-xl bg-accent-cyan text-black font-black uppercase tracking-wider hover:bg-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all flex items-center gap-2"
                    >
                        {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};
