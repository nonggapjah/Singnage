'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { userApi, User } from '@/features/auth/api/user-api';
import { EditUserModal } from '@/features/auth/components/EditUserModal';
import { Plus, Trash2, Edit2, Crown, Shield, User as UserIcon, LogOut } from 'lucide-react';

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
            }
        } catch (error) {
            console.error("Failed to load users", error);
        } finally {
            setLoading(false);
        }
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
        if (r === 'admin') return <Crown size={20} className="text-yellow-400 fill-yellow-400/20" />;
        if (r === 'editor') return <Shield size={20} className="text-accent-cyan" />;
        return <UserIcon size={20} className="text-gray-400" />;
    };

    return (
        <div className="p-8 lg:p-10 space-y-12 max-w-[1600px] mx-auto page-transition">

            {/* MY PROFILE SECTION */}
            <section className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
                <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest border-b border-white/10 pb-2">My Profile</h2>

                <div className="glass-panel p-8 rounded-3xl border border-white/10 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-accent-purple/10 blur-[80px] rounded-full pointer-events-none group-hover:bg-accent-purple/20 transition-colors"></div>

                    <div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10">
                        <div className="flex items-center gap-6">
                            <div className="relative">
                                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent-purple to-blue-600 p-[2px] shadow-[0_0_30px_rgba(168,85,247,0.4)]">
                                    <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                                        <div className="text-4xl">😎</div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => currentUser && handleEditUser(currentUser as User)}
                                    className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-110 transition-transform shadow-lg cursor-pointer"
                                    title="Edit My Profile"
                                >
                                    <Edit2 size={14} />
                                </button>
                            </div>

                            <div className="space-y-1 text-center md:text-left">
                                <h1 className="text-3xl font-black text-white uppercase tracking-tight">{currentUser?.fullName || 'System Admin'}</h1>
                                <p className="text-accent-cyan font-bold tracking-wide">{currentUser?.username || '@admin'}</p>
                                <div className="flex items-center gap-2 mt-2 justify-center md:justify-start">
                                    <span className="px-3 py-1 rounded-full bg-accent-purple/20 border border-accent-purple/30 text-accent-purple text-[10px] font-black uppercase tracking-widest">
                                        {currentUser?.role || 'Admin'}
                                    </span>
                                    <span className="px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-black uppercase tracking-widest">
                                        Active Status
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Last Login: Just Now</p>
                            <button
                                onClick={logout}
                                className="px-8 py-3 rounded-xl border border-white/10 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 text-gray-400 font-bold text-xs uppercase tracking-widest transition-all w-full md:w-auto"
                            >
                                Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* TEAM MANAGEMENT SECTION */}
            <section className="space-y-6 animate-in stagger-1">
                <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-white/10 pb-4">
                    <div>
                        <h2 className="text-3xl font-black neon-text uppercase tracking-tighter mb-2">Team Management</h2>
                        <p className="text-gray-400 text-sm">Manage access control and user roles</p>
                    </div>
                    <button
                        onClick={handleAddUser}
                        className="btn-primary flex items-center gap-2 shadow-[0_0_20px_rgba(124,58,237,0.3)] bg-gradient-to-r from-accent-purple to-indigo-600 hover:to-indigo-500 border-none"
                    >
                        <Plus size={18} strokeWidth={3} /> Add Member
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {loading ? (
                        [...Array(3)].map((_, i) => (
                            <div key={i} className="h-48 rounded-3xl bg-white/5 animate-pulse"></div>
                        ))
                    ) : (
                        users.map((u) => (
                            <div key={u.userId} className="glass-card p-6 rounded-3xl border border-white/5 hover:border-white/10 group relative transition-all hover:-translate-y-1 hover:shadow-2xl">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10 group-hover:border-accent-cyan/50 group-hover:bg-accent-cyan/10 transition-colors">
                                        {getRoleIcon(u.role)}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${u.active === 'Y' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                            {u.active === 'Y' ? 'Active' : 'Inactive'}
                                        </span>
                                        <button
                                            onClick={() => handleEditUser(u)}
                                            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-gray-500 hover:text-white transition-colors"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-1 mb-8">
                                    <h3 className="text-lg font-bold text-white group-hover:text-accent-cyan transition-colors truncate">{u.fullName}</h3>
                                    <p className="text-sm text-gray-500 truncate font-mono">{u.username}</p>
                                </div>

                                <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                                    <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest">{u.role}</span>

                                    {u.username !== 'admin' && u.userId !== currentUser?.username && ( // Prevent deleting main admin or self
                                        <button
                                            onClick={() => handleDeleteUser(u.userId)}
                                            className="flex items-center gap-1.5 text-[10px] font-bold text-red-900/40 hover:text-red-500 transition-colors uppercase tracking-wider"
                                        >
                                            <Trash2 size={12} /> Remove
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
                onSave={loadUsers}
                user={editingUser}
            />
        </div>
    );
}
