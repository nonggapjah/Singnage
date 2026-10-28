'use client';

import Link from "next/link";
import { useAuth } from "@/features/auth/context/AuthContext";
import { SYSTEM_VERSION } from "@/lib/constants";

export default function Home() {
  const { user, isAuthenticated, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center bg-background text-foreground">
      <div className="max-w-4xl w-full space-y-12">
        <header className="space-y-4">
          <h1 className="text-6xl font-black neon-text uppercase tracking-tighter sm:text-8xl">
            Signage<br />Unicorn
          </h1>
          <p className="text-lg text-muted-foreground font-light tracking-[0.15em] uppercase">
            Digital signage network
          </p>
        </header>

        {isAuthenticated ? (
          <div className="glass-panel p-6 rounded-2xl inline-flex flex-col sm:flex-row items-center gap-6 animate-in shadow-xl">
            <div className="text-left">
              <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">Signed in as</p>
              <p className="text-lg font-black text-foreground uppercase leading-none mt-0.5">{user?.fullName}</p>
              <div className="mt-2">
                <span className="text-xs px-2 py-0.5 rounded border border-accent-cyan/40 bg-accent-cyan text-black font-black uppercase tracking-tighter">
                  {user?.role}
                </span>
              </div>
            </div>
            <div className="hidden sm:block h-10 w-px bg-border" aria-hidden="true" />
            <div className="flex gap-3">
              <Link href="/admin/dashboard" className="btn-primary py-2 px-8 text-sm">Dashboard</Link>
              <button type="button" onClick={logout} className="px-6 py-2 rounded-xl bg-muted/20 hover:bg-red-500/20 hover:text-red-500 transition-colors text-sm font-bold border border-border text-foreground">Sign out</button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-wrap justify-center gap-6">
              <Link href="/login" className="px-10 py-4 rounded-xl bg-primary text-primary-foreground font-extrabold uppercase tracking-[0.2em] border-2 border-primary hover:bg-cyan-300 transition-colors text-sm">
                Sign in
              </Link>
              <Link href="/player" className="px-10 py-4 rounded-xl bg-accent-purple/15 border-2 border-accent-purple/50 text-foreground font-extrabold uppercase tracking-[0.2em] hover:bg-accent-purple/30 transition-colors text-sm">
                Open web player
              </Link>
            </div>
            <div>
              <Link href="/register" className="text-xs font-bold text-muted-foreground hover:text-accent-cyan transition-colors uppercase tracking-[0.2em] border-b border-border pb-1">
                Need access? Request an account
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 px-4">
          <div className="glass-panel p-8 rounded-2xl hover:border-accent-cyan/30 transition-colors">
            <div className="text-3xl mb-4" aria-hidden="true">🎞️</div>
            <h3 className="text-sm font-bold mb-1 uppercase tracking-widest text-accent-cyan">Playlists</h3>
            <p className="text-xs text-muted-foreground">Sequence media and set how long each item plays.</p>
          </div>

          <div className="glass-panel p-8 rounded-2xl hover:border-accent-cyan/30 transition-colors">
            <div className="text-3xl mb-4" aria-hidden="true">🖥️</div>
            <h3 className="text-sm font-bold mb-1 uppercase tracking-widest text-accent-cyan">Screens</h3>
            <p className="text-xs text-muted-foreground">See which screens are online and what they are playing.</p>
          </div>

          <div className="glass-panel p-8 rounded-2xl hover:border-accent-cyan/30 transition-colors">
            <div className="text-3xl mb-4" aria-hidden="true">📜</div>
            <h3 className="text-sm font-bold mb-1 uppercase tracking-widest text-accent-cyan">Logs</h3>
            <p className="text-xs text-muted-foreground">Audit trail of playback, commands and errors.</p>
          </div>
        </div>

        <footer className="pt-12 flex flex-col items-center gap-4">
          <div className="flex gap-4">
            <a
              href="/setup/SignageUnicornSetup.exe"
              className="px-4 py-2 rounded-full bg-muted/20 border border-border text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-accent-cyan hover:border-accent-cyan/50 transition-colors"
            >
              📥 Download native player (v{SYSTEM_VERSION})
            </a>
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/20 border border-border text-xs font-mono text-muted-foreground">
            v{SYSTEM_VERSION}
          </div>
        </footer>
      </div>
    </div>
  );
}
