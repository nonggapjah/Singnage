# 🦄 Development & Deployment Workflow

This guide contains the essential commands for building, deploying, and managing the Signage Unicorn system.

## 1. Backend (ASP.NET Core API)
Location: `src/SignageUnicorn.Api`

### Build & Clean
Use these commands to refresh the backend logic (especially after updating Repositories or Services).

```powershell
cd c:\git\Signage-Unicorn\src\SignageUnicorn.Api ; dotnet clean ; dotnet build -c Release ; dotnet publish -c Release -o ./publish
```


## 2. Frontend (Next.js Web App)
Location: `src/signage-unicorn-web`

### Production Build
Run this to compile the React/Next.js code into optimized static files.

```powershell
cd c:\git\Signage-Unicorn\src\signage-unicorn-web ; npm run build
```

---

## 3. Process Management (PM2)
Location: Root (`/`)

The system uses PM2 to keep both the API and Web App running. Use the following commands to restart the services after a build.

```powershell
# Restart all services (API and Web)
pm2 restart all

# Check status
pm2 status

# View logs
pm2 logs
```

## Summary for Quick Copy-Paste (Full Rebuild)
If you want to do a fresh clean, build, and restart in one go:

```powershell
# Kill running API, build everything, and restart
taskkill /F /IM SignageUnicorn.Api.exe
cd src/SignageUnicorn.Api ; dotnet clean ; dotnet build ; cd ../signage-unicorn-web ; npm run build ; cd ../.. ; pm2 restart all
```
