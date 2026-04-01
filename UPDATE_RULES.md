# Signage Unicorn Update Policy

**Created:** 2026-03-24
**Effective:** Immediately
**Directive:** Mandatory for all future deployments

These rules were established after the v2.4.0 incident to prevent mass network congestion and workflow disruption at branch locations.

## Rule 1: Backend First
- **DO NOT** arbitrarily force a client update to fix a problem.
- **ALWAYS** attempt to resolve issues via:
  1. Backend API / Server-side logic changes.
  2. Database configuration adjustments.
  3. Remote Commands (e.g., REFRESH_APP, CLEAR_CACHE, SYNC_MEDIA) without requiring a full binary installation.

## Rule 2: Canary Rollout (Max 5 Devices)
- A mass update to all screens simultaneously is **STRICTLY PROHIBITED**.
- Any new client binary deployment must be rolled out to a maximum of **5 pilot devices** initially.
- **Condition for progression:** You must wait and verify that those 5 pilot screens have successfully completed the update, returned online, and are displaying media flawlessly on the new version.
- Only after explicit confirmation of success on the canary group can the update be expanded to further devices.

---
*Note: The script `src/Publish-ClientUpdate.ps1` has been modified to enforce the 5-device canary limit by default.*
