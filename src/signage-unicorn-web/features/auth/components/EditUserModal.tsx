'use client';

import React, { useState, useEffect } from 'react';
import { Mail, Phone, Lock, User as UserIcon, Camera } from 'lucide-react';
import { User, userApi, UserUpdateData } from '../../auth/api/user-api';
import { Modal } from '@/components/ui/Modal';

interface EditUserModalProps {
    user: User | null; // null for new user
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void | Promise<void>;
}

const inputClass = 'w-full bg-muted/20 border border-border rounded-xl px-4 py-3 text-foreground focus:border-accent-cyan outline-none transition-colors placeholder:text-muted-foreground/70';
const labelClass = 'block text-xs font-bold text-muted-foreground uppercase tracking-wider';

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
            await onSave();
            onClose();
        } catch (error) {
            console.error("Failed to save user", error);
            alert("Failed to save user.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="full"
            scroll={false}
            closeDisabled={loading}
            showClose
            labelledBy="edit-user-title"
            zIndexClass="z-[200]"
            className="flex flex-col overflow-hidden"
        >
            <div className="p-8 pb-4">
                <h2 id="edit-user-title" className="text-3xl font-black text-foreground uppercase tracking-tight">
                    {user ? 'Edit profile' : 'New member'}
                </h2>
                <p className="text-muted-foreground text-sm font-bold tracking-wide uppercase">
                    {user ? 'Update account details' : 'Onboard a new team member'}
                </p>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-8 pt-0 grid grid-cols-1 lg:grid-cols-2 gap-12">

                {/* LEFT COL: IDENTITY */}
                <div className="space-y-6">
                    <h3 className="text-accent-cyan text-xs font-black uppercase tracking-widest mb-4">Identity</h3>

                    <div className="flex gap-4">
                        <div className="flex-1 space-y-2">
                            <label htmlFor="user-first-name" className={labelClass}>First name</label>
                            <input
                                id="user-first-name"
                                type="text"
                                autoComplete="off"
                                value={formData.firstName}
                                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                className={inputClass}
                                placeholder="e.g. Somchai"
                            />
                        </div>
                        <div className="flex-1 space-y-2">
                            <label htmlFor="user-last-name" className={labelClass}>Last name</label>
                            <input
                                id="user-last-name"
                                type="text"
                                autoComplete="off"
                                value={formData.lastName}
                                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                className={inputClass}
                                placeholder="e.g. Jaidee"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="user-avatar-url" className={labelClass}>Avatar URL</label>
                        <div className="relative">
                            <input
                                id="user-avatar-url"
                                type="url"
                                value={formData.avatarUrl}
                                onChange={(e) => setFormData({ ...formData, avatarUrl: e.target.value })}
                                className={`${inputClass} pl-10`}
                                placeholder="https://..."
                            />
                            <Camera className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} aria-hidden="true" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="user-role" className={labelClass}>Role</label>
                        <div className="relative">
                            <select
                                id="user-role"
                                value={formData.role.toLowerCase()}
                                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                className={`${inputClass} appearance-none`}
                            >
                                <option value="admin">Admin</option>
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                            </select>
                            <UserIcon className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={18} aria-hidden="true" />
                        </div>
                    </div>
                </div>

                {/* RIGHT COL: SECURITY */}
                <div className="space-y-6">
                    <h3 className="text-accent-cyan text-xs font-black uppercase tracking-widest mb-4">Security &amp; contact</h3>

                    <div className="space-y-4">
                        {/* Toggle / Static Display */}
                        {user ? (
                            <div className="flex border border-border rounded-lg p-1.5 bg-muted/20 w-fit items-center gap-2">
                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-2">Registered via:</span>
                                {formData.contactType === 'email' ? (
                                    <div className="px-4 py-1 rounded bg-muted/40 text-foreground text-xs font-black uppercase tracking-wider flex items-center gap-2">
                                        <Mail size={14} aria-hidden="true" /> Email
                                    </div>
                                ) : (
                                    <div className="px-4 py-1 rounded bg-accent-cyan text-black text-xs font-black uppercase tracking-wider flex items-center gap-2">
                                        <Phone size={14} aria-hidden="true" /> Phone
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex border border-border rounded-lg p-1 bg-muted/20 w-fit" role="group" aria-label="Contact type">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, contactType: 'email' })}
                                    aria-pressed={formData.contactType === 'email'}
                                    className={`px-6 py-1.5 rounded-md text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-colors ${formData.contactType === 'email' ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    <Mail size={14} aria-hidden="true" /> Email
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, contactType: 'phone' })}
                                    aria-pressed={formData.contactType === 'phone'}
                                    className={`px-6 py-1.5 rounded-md text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-colors ${formData.contactType === 'phone' ? 'bg-accent-cyan text-black' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    <Phone size={14} aria-hidden="true" /> Phone
                                </button>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label htmlFor="user-contact" className={labelClass}>
                                {formData.contactType === 'email' ? 'Email (username)' : 'Phone (username)'}
                            </label>
                            <input
                                id="user-contact"
                                type={formData.contactType === 'email' ? 'email' : 'tel'}
                                autoComplete="off"
                                value={formData.contactValue}
                                onChange={(e) => setFormData({ ...formData, contactValue: e.target.value })}
                                // Disable editing username for existing users if API doesn't support generic ID change easily
                                readOnly={!!user}
                                aria-describedby={user ? 'user-contact-hint' : undefined}
                                className={`w-full bg-transparent border border-border rounded-xl px-4 py-3 text-foreground focus:border-accent-cyan outline-none transition-colors ${!!user ? 'opacity-60 cursor-not-allowed' : ''}`}
                                placeholder={formData.contactType === 'email' ? 'user@example.com' : '0991234567'}
                            />
                            {!!user && <p id="user-contact-hint" className="text-xs text-muted-foreground">* Username/ID cannot be changed once created.</p>}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="user-alt-contact" className={labelClass}>
                            {formData.contactType === 'phone' ? 'Alternate email (required)' : 'Alternate phone (optional)'}
                        </label>
                        <div className="relative">
                            <input
                                id="user-alt-contact"
                                type={formData.contactType === 'phone' ? 'email' : 'tel'}
                                autoComplete="off"
                                value={formData.alternateContactValue}
                                onChange={(e) => setFormData({ ...formData, alternateContactValue: e.target.value })}
                                className={`${inputClass} pl-10`}
                                placeholder={formData.contactType === 'phone' ? 'backup@example.com' : '099-XXX-XXXX'}
                            />
                            {formData.contactType === 'phone' ? (
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} aria-hidden="true" />
                            ) : (
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} aria-hidden="true" />
                            )}
                        </div>
                    </div>

                    <div className="space-y-2 pt-4 border-t border-border">
                        <label htmlFor="user-new-password" className={labelClass}>New password</label>
                        <div className="relative">
                            <input
                                id="user-new-password"
                                type="password"
                                autoComplete="new-password"
                                value={formData.newPassword}
                                onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                                className={`${inputClass} py-4 pr-12`}
                                placeholder={user ? "Leave blank to keep current" : "Set initial password"}
                            />
                            <Lock className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} aria-hidden="true" />
                        </div>
                    </div>
                </div>

            </div>

            <div className="p-8 border-t border-border bg-muted/10 flex justify-end gap-4">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="px-8 py-3 rounded-xl border border-border text-foreground font-bold uppercase tracking-wider hover:bg-muted/30 transition-colors disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={loading}
                    className="px-8 py-3 rounded-xl bg-accent-cyan text-black font-black uppercase tracking-wider hover:bg-cyan-300 transition-colors flex items-center gap-2 disabled:opacity-60"
                >
                    {loading ? 'Saving…' : 'Save changes'}
                </button>
            </div>
        </Modal>
    );
};
