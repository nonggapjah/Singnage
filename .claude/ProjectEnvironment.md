# ProjectEnvironment

> Active project registry. Check this file before constructing any Development folder path or PreExisting TechStack path.
> Maintained by AM (Overseer). Update when a project is added, put on hold, or its source path changes.

---

## Active Projects

### Signage
**PROJECT_MODE:** Centralized
**PROJECT_ROOT:** `C:/Singnage/Singnage`
**SOURCE_ROOT:** `C:/Singnage/Singnage`
**ACTIVE:** true
**Notes:** Signage Unicorn — digital signage fleet. Electron client (`src/signage-unicorn-client`),
.NET 8 API (`src/SignageUnicorn.Api`), Next.js admin web (`src/signage-unicorn-web`).
Production host `192.1.200.185` — API on :8862, web on :8865, fronted by cloudflared at
`signage.aith123.com`; both apps run under PM2 (`ecosystem.config.js`). Planning artefacts
(`Development/`, `RoundTable/`) live at PROJECT_ROOT and are **not** git-tracked.
`.claude/` **is** git-tracked (since commit 291878d, 2026-07-09) — it is the authoritative
framework copy for this project.

**Restructure note (20-08-2026):** the repo previously sat directly at `C:/Singnage`.
It was re-cloned one level down into `C:/Singnage/Singnage`, leaving a stray untracked
framework copy at `C:/Singnage/.claude` with a stripped permission allowlist — that stray
copy is NOT authoritative. A `.env` (development reference values) also remains at
`C:/Singnage/.env`. Sessions must open at `C:/Singnage/Singnage`.

---

## On Hold

### UniOpsQC
**PROJECT_MODE:** Centralized
**PROJECT_ROOT:** `C:/UnicornVibeCode/UniOpsQC`
**SOURCE_ROOT:** `C:/UnicornVibeCode/UniOpsQC`
**ACTIVE:** false
**Notes:** RoundTable Framework itself. Path does not exist on this machine — entry retained
per §4 (never delete, set ACTIVE:false). Deactivated 20-08-2026 by AM: this registry shipped
with the framework template and did not describe this box.

---

### HubVSCode
**PROJECT_MODE:** Decentralized
**PROJECT_ROOT:** `C:/UnicornVibeCode/UniOpsQC/Development/HubVSCode`
**SOURCE_ROOT:** `C:/UnicornVibeCode/roundtable-hub-vscode`
**ACTIVE:** false
**Notes:** UniOpsQC Hub VSCode Extension. Path does not exist on this machine — entry retained
per §4. Deactivated 20-08-2026 by AM.

---

## Rules

- Check this file before constructing any Development folder path or PreExisting TechStack path
- If a project is not listed here, add it before beginning work
- `SOURCE_ROOT` and `PROJECT_ROOT` are the same in Centralized mode with no sub-components; different in Decentralized mode
- Set `ACTIVE: false` for projects that are on hold — do not delete entries
- Update the Notes field when significant project state changes (new deployment, mode change, source path change)

---

*Last updated: 20-08-2026 by AM (AstonMartin) — OPS-01*
