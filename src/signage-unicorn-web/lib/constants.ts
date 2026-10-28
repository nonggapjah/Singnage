import pkg from '../package.json';

// ─── Single Source of Truth: System Version ────────────────────
// NEXT_PUBLIC_SYSTEM_VERSION (set in the server's .env) wins so ops can label a deployment;
// otherwise the web app's own package.json version is used. It used to fall back to '0.0.0',
// which is what the header showed on any machine without that env var.
export const SYSTEM_VERSION = process.env.NEXT_PUBLIC_SYSTEM_VERSION || (pkg as { version: string }).version;
