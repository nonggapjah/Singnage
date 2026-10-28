'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { userApi, User } from '@/features/auth/api/user-api';
import { EditUserModal } from '@/features/auth/components/EditUserModal';
import { Plus, Trash2, Edit2, Crown, Shield, User as UserIcon, RefreshCw } from 'lucide-react';

export default function UserManagementPage() {
    const { user: currentUser, logout } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);

    const allowLoad = React.useRef(true);

    useEffect(() => {
        if (allowLoad.current) {
            allowLoad.current = false;
            loadUsers();
        }
    }, []);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const res = await userApi.getAll();
            if (res.success && res.data) {
                setUsers(res.data);

                // If we edited current user, we might want to update the local session too
                // (Though real session update should ideally happen via a dedicated check-session call)
            }
        } catch (error) {
            console.error("Failed to load users", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveComplete = async () => {
        await loadUsers();
    };

    const handleAddUser = () => {
        setEditingUser(null);
        setIsModalOpen(true);
    };

    const handleEditUser = (u: User) => {
        setEditingUser(u);
        setIsModalOpen(true);
    };

    const handleDeleteUser = async (id: string) => {
        if (!confirm("Are you sure you want to remove this user? This action cannot be undone.")) return;

        try {
            const res = await userApi.delete(id);
            if (res.success) {
                setUsers(prev => prev.filter(u => u.userId !== id));
            } else {
                alert("Failed to delete user: " + res.message);
            }
        } catch (error) {
            console.error("Delete error", error);
        }
    };

    const getRoleIcon = (role: string) => {
        const r = role.toLowerCase();
        if (r === 'admin') return <Crown size={20} className="text-yellow-500 fill-yellow-400/20" aria-hidden="true" />;
        if (r === 'editor') return <Shield size={20} className="text-accent-cyan" aria-hidden="true" />;
        return <UserIcon size={20} className="text-muted-foreground" aria-hidden="true" />;
    };

    return (
        <div className="p-8 lg:p-10 space-y-12 max-w-[1600px] mx-auto page-transition">

            {/* MY PROFILE SECTION */}
            <section className="space-y-6 animate-in" aria-labelledby="my-profile-title">
                <h2 id="my-profile-title" className="text-sm font-black text-muted-foreground uppercase tracking-widest border-b border-border pb-2">My profile</h2>

                <div className="glass-panel p-8 rounded-3xl relative overflow-hidden">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10">
                        <div className="flex items-center gap-6">
                            <div className="relative">
                                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent-purple to-blue-600 p-[2px]">
                                    <div className="w-full h-full rounded-full bg-card flex items-center justify-center overflow-hidden">
                                        <div className="text-4xl" aria-hidden="true">😎</div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        // The auth-context profile has no userId, so editing it through
                                        // EditUserModal would hit the create path (POST /users) and make a
                                        // duplicate. Resolve the real management record (with userId) first.
                                        const me = users.find(u => u.username === currentUser?.username);
                                        if (me) handleEditUser(me);
                                        else alert('Could not load your account record yet. Refresh and try again.');
                                    }}
                                    className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center hover:scale-110 transition-transform shadow-lg cursor-pointer"
                                    title="Edit my profile"
                                    aria-label="Edit my profile"
                                >
                                    <Edit2 size={14} aria-hidden="true" />
                                </button>
                            </div>

                            <div className="space-y-1 text-center md:text-left">
                                <h1 className="text-3xl font-black text-foreground uppercase tracking-tight">{currentUser?.fullName || 'Administrator'}</h1>
                                <p className="text-accent-cyan font-bold tracking-wide">{currentUser?.username || ''}</p>
                                <div className="flex items-center gap-2 mt-2 justify-center md:justify-start">
                                    <span className="px-3 py-1 rounded-full bg-accent-purple/20 border border-accent-purple/30 text-accent-purple text-xs font-black uppercase tracking-widest">
                                        {currentUser?.role || 'Admin'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                            <button
                                type="button"
                                onClick={logout}
                                className="px-8 py-3 rounded-xl border border-border hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-500 text-muted-foreground font-bold text-xs uppercase tracking-widest transition-colors w-full md:w-auto"
                            >
                                Sign out
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* TEAM MANAGEMENT SECTION */}
            <section className="space-y-6 animate-in stagger-1" aria-labelledby="team-title">
                <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-border pb-4">
                    <div>
                        <h2 id="team-title" className="text-3xl font-black neon-text uppercase tracking-tighter mb-2">Team management</h2>
                        <p className="text-muted-foreground text-sm">Manage access control and user roles</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={loadUsers}
                            className="p-3 rounded-xl border border-border hover:border-accent-cyan/50 text-muted-foreground hover:text-accent-cyan transition-colors"
                            title="Refresh list"
                            aria-label="Refresh user list"
                        >
                            <RefreshCw size={18} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            onClick={handleAddUser}
                            className="btn-primary flex items-center gap-2"
                        >
                            <Plus size={18} strokeWidth={3} aria-hidden="true" /> Add member
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {loading ? (
                        [...Array(3)].map((_, i) => (
                            <div key={i} className="h-48 rounded-3xl bg-muted/20 animate-pulse" aria-hidden="true"></div>
                        ))
                    ) : (
                        users.map((u) => (
                            <div key={u.userId} className="glass-card p-6 rounded-3xl group relative">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="w-12 h-12 rounded-2xl bg-muted/20 flex items-center justify-center border border-border group-hover:border-accent-cyan/50 group-hover:bg-accent-cyan/10 transition-colors">
                                        {getRoleIcon(u.role)}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded text-xs font-black uppercase tracking-widest ${u.active === 'Y' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'}`}>
                                            {u.active === 'Y' ? 'Active' : 'Inactive'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleEditUser(u)}
                                            aria-label={`Edit ${u.fullName}`}
                                            title="Edit"
                                            className="w-8 h-8 rounded-lg hover:bg-muted/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <Edit2 size={14} aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-1 mb-8">
                                    <h3 className="text-lg font-bold text-foreground group-hover:text-accent-cyan transition-colors truncate">{u.fullName}</h3>
                                    <p className="text-sm text-muted-foreground truncate font-mono">{u.username}</p>
                                </div>

                                <div className="pt-4 border-t border-border/50 flex justify-between items-center">
                                    <span className="text-xs font-black text-muted-foreground uppercase tracking-widest">{u.role}</span>

                                    {u.username !== 'admin' && u.userId !== currentUser?.username && ( // Prevent deleting main admin or self
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteUser(u.userId)}
                                            aria-label={`Remove ${u.fullName}`}
                                            className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-red-500 transition-colors uppercase tracking-wider"
                                        >
                                            <Trash2 size={12} aria-hidden="true" /> Remove
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </section>

            <EditUserModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveComplete}
                user={editingUser}
            />
        </div>
    );
}
