// ─── Single Source of Truth: System Version ────────────────────
// Reads from .env (NEXT_PUBLIC_SYSTEM_VERSION).
// All components should import from here instead of hardcoding.
export const SYSTEM_VERSION = process.env.NEXT_PUBLIC_SYSTEM_VERSION || '0.0.0';
