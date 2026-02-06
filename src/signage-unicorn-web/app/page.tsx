'use client';

import Link from "next/link";
import { useAuth } from "@/features/auth/context/AuthContext";
import { authApi } from "@/features/auth/api/auth-api";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const { user, isAuthenticated, login, logout } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleAutoLogin = async () => {
    setLoading(true);
    try {
      const res = await authApi.autoAdminLogin();
      if (res.success && res.data) {
        login(res.data.token, {
          username: res.data.username,
          fullName: res.data.fullName,
          role: res.data.role
        });
        router.push('/admin/playlists');
      }
    } catch (error) {
      console.error("Auto login failed", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center bg-[radial-gradient(circle_at_center,_rgba(0,242,255,0.03)_0%,transparent_70%)]">
      <div className="max-w-4xl w-full space-y-12">
        <header className="space-y-4">
          <div className="flex justify-center mb-4">
            <span className="px-4 py-1 rounded-full bg-accent-cyan/10 border border-accent-cyan/20 text-xs font-black tracking-[0.3em] text-accent-cyan uppercase">
              Operational Status: Online
            </span>
          </div>
          <h1 className="text-7xl font-black neon-text uppercase tracking-tighter sm:text-9xl">
            SIGNAGE<br />UNICORN
          </h1>
          <p className="text-xl text-gray-500 font-light tracking-[0.2em] uppercase">
            Next-Gen Digital Signage Network
          </p>
        </header>

        {isAuthenticated ? (
          <div className="glass-panel p-6 rounded-2xl border-white/5 inline-flex items-center gap-6 animate-in fade-in slide-in-from-bottom-4 shadow-xl">
            <div className="text-left">
              <p className="text-xs font-black text-gray-600 uppercase tracking-widest">Authenticated Identity</p>
              <p className="text-lg font-black text-black uppercase leading-none mt-0.5">{user?.fullName}</p>
              <div className="mt-2">
                <span className="text-xs px-2 py-0.5 rounded border border-accent-cyan/40 bg-accent-cyan text-black font-black uppercase tracking-tighter">
                  {user?.role}
                </span>
              </div>
            </div>
            <div className="h-10 w-px bg-white/10" />
            <div className="flex gap-3">
              <Link href="/admin/playlists" className="btn-primary py-2 px-8 text-sm border border-accent-cyan/50 shadow-[0_0_15px_rgba(34,211,238,0.2)]">Dashboard</Link>
              <button onClick={logout} className="px-6 py-2 rounded-xl bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-all text-sm font-bold border border-white/10">Logout</button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-wrap justify-center gap-6">
              <Link href="/login" className="px-10 py-4 rounded-xl bg-accent-cyan text-black font-extrabold uppercase tracking-[0.2em] border-2 border-cyan-400 hover:bg-cyan-300 hover:shadow-[0_0_30px_rgba(34,211,238,0.6)] transition-all transform hover:-translate-y-1 text-sm">
                Initialize Access
              </Link>
              <button
                onClick={handleAutoLogin}
                disabled={loading}
                className="px-10 py-4 rounded-xl bg-black/40 border-2 border-white/20 text-white font-extrabold uppercase tracking-[0.2em] hover:bg-white/10 hover:border-white/40 shadow-lg backdrop-blur-md transition-all transform hover:-translate-y-1 text-sm"
              >
                {loading ? 'Initializing...' : 'Local Dev Admin'}
              </button>
              <Link href="/player" className="px-10 py-4 rounded-xl bg-purple-600/20 border-2 border-purple-500/50 text-purple-300 font-extrabold uppercase tracking-[0.2em] hover:bg-purple-600/40 hover:text-white shadow-lg backdrop-blur-md transition-all transform hover:-translate-y-1 text-sm">
                Launch Player Mode
              </Link>
            </div>
            <div>
              <Link href="/register" className="text-xs font-bold text-gray-500 hover:text-accent-cyan transition-colors uppercase tracking-[0.3em] border-b border-white/10 pb-1">
                Not authorized? Contact network overseer
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 px-4">
          <div className="glass-panel p-8 rounded-2xl border-white/5 group hover:border-accent-cyan/30 transition-all">
            <div className="text-3xl mb-4 grayscale group-hover:grayscale-0 transition-all">🔮</div>
            <h3 className="text-sm font-bold mb-1 uppercase tracking-widest text-accent-cyan">Neural Playlists</h3>
            <p className="text-xs text-gray-500">Autonomous content sequencing and smart timing control.</p>
          </div>

          <div className="glass-panel p-8 rounded-2xl border-white/5 group hover:border-accent-cyan/30 transition-all">
            <div className="text-3xl mb-4 grayscale group-hover:grayscale-0 transition-all">🛰️</div>
            <h3 className="text-sm font-bold mb-1 uppercase tracking-widest text-accent-cyan">Network Grid</h3>
            <p className="text-xs text-gray-500">Real-time monitoring of remote signage terminal nodes.</p>
          </div>

          <div className="glass-panel p-8 rounded-2xl border-white/5 group hover:border-accent-cyan/30 transition-all">
            <div className="text-3xl mb-4 grayscale group-hover:grayscale-0 transition-all">📜</div>
            <h3 className="text-sm font-bold mb-1 uppercase tracking-widest text-accent-cyan">Security Logs</h3>
            <p className="text-xs text-gray-500">Comprehensive audit trails of all network operations.</p>
          </div>
        </div>

        <footer className="pt-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-gray-500">
            <span className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
            CORE v1.7.7-AUTH-ENABLED
          </div>
        </footer>
      </div>
    </div>
  );
}
