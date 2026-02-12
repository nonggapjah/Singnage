# 🦄 Signage Unicorn (v2.2.1)

**Cloud-First Digital Signage Solution**

Signage Unicorn is a modern, responsive digital signage platform designed for reliability and ease of use. Version 2.2.1 introduces a significant architectural shift to a **Cloud-First** approach, managed centrally via `signage.aith123.com`.

## 🌟 Key Features

*   **Cloud Management**: centralized control of all devices, media, and playlists via a web dashboard.
*   **Offline Resilience**: Smart caching ensures playback continues even if the internet goes down.
*   **Native Performance**: Electron-based client with native SQLite support for robust local data handling.
*   **Real-time Monitoring**: Instant status updates and remote command capabilities.

## 📂 System Components

The project consists of three main parts:

1.  **Frontend (Web Dashboard)**:
    *   **Tech**: Next.js (React), TailwindCSS
    *   **Location**: `src/signage-unicorn-web`
    *   **Role**: Admin interface for managing content and devices.

2.  **Backend (API)**:
    *   **Tech**: ASP.NET Core 8 Web API
    *   **Location**: `src/SignageUnicorn.Api`
    *   **Role**: Central logic, database connectivity, and device orchestration.

3.  **Client (Player App)**:
    *   **Tech**: Electron, SQLite (Native)
    *   **Location**: `src/signage-unicorn-client`
    *   **Role**: The software running on the TV/Display screens.

## 🚀 Quick Start / Documentation

We have detailed guides for every aspect of the system:

### For Admins & Users
*   **[Installation & Run Guide](docs/guides/installation-and-run.md)**: How to install the client and access the dashboard.
*   **[User Roles & Permissions](docs/specs/ROLE_PERMISSIONS.md)**: Specifics on what Admins, Editors, and Viewers can do.

### For Developers & IT
*   **[Client Build Manual](docs/guides/client-build-manual.md)**: **CRITICAL**. Instructions on how to build the `.exe` installer (includes important SQLite rebuild steps).
*   **[Deployment Guide](docs/guides/DEPLOYMENT_GUIDE.md)**: How to deploy the full system (Server & Client) to production.

## ⚠️ Important Notes for v2.2.1

*   **SQLite Dependency**: The client requires `Visual C++ Redistributable` and must be built with `npm run rebuild` to function correctly.
*   **Default Server**: The client is pre-configured to connect to `https://signage.aith123.com`.
*   **Offline Mode**: Devices will automatically switch to offline mode if the server is unreachable, using locally cached content.

---
*Maintained by the Signage Unicorn TECH Integration*