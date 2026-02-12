# ⚙️ Configuration Reference Guide

เอกสารนี้รวบรวมคำอธิบายการทำงานของไฟล์ Config สำคัญในระบบ **Signage Unicorn v2.2.1** เพื่อช่วยให้ Developer และ System Admin เข้าใจโครงสร้างและการปรับแต่งระบบ

---

## 1. `ecosystem.config.js` (Root)
**Role**: Process Management (PM2) Configuration
ใช้สำหรับจัดการ Process ของ Backend (.NET API) และ Frontend (Next.js) ให้ทำงานพร้อมกันบน Production Server

*   **Location**: Root Directory (`/`)
*   **Key Settings**:
    *   **Apps Array**: กำหนดรายชื่อแอปที่จะรัน (API, Web)
    *   **Environment**:
        *   `ASPNETCORE_URLS`: กำหนด Port ของ Backend (Default: `8862`)
        *   `PORT`: กำหนด Port ของ Frontend (Default: `3000`)
*   **Usage**: ใช้กับคำสั่ง `pm2 start ecosystem.config.js`

---

## 2. `.env` (Frontend)
**Role**: Environment Variables (Next.js)
เก็บค่าตัวแปรสภาพแวดล้อมที่ใช้ใน **Web Dashboard** และ **Web Player**

*   **Location**: `src/signage-unicorn-web/.env`
*   **Key Variables**:
    *   `NEXT_PUBLIC_API_URL`: URL ของ Backend API ที่ Frontend ต้องเชื่อมต่อ (เช่น `https://signage.aith123.com/api/v1`)
    *   `NEXT_PUBLIC_SITE_URL`: URL ของหน้าเว็บเอง (ใช้สำหรับ SEO/Meta Tags)

---

## 3. `next.config.ts` (Frontend)
**Role**: Next.js Build & Runtime Configuration
ใช้กำหนดพฤติกรรมของ Next.js Framework

*   **Location**: `src/signage-unicorn-web/next.config.ts`
*   **Key Settings**:
    *   **Images**: อนุญาตให้โหลดรูปภาพจาก Domain ภายนอก (เช่น Google Storage, AWS S3) เพื่อความปลอดภัย
    *   **Headers**: เพิ่ม Security Headers (CORS, X-Frame-Options)
    *   **Rewrites**: (ถ้ามี) ใช้ทำ Proxy API เพื่อแก้ปัญหา CORS ในบางกรณี

---

## 4. `package.json` (Web Player)
**Role**: Project Manifest & Dependencies (Web)
กำหนด Dependencies และคำสั่ง Script ของ Frontend

*   **Location**: `src/signage-unicorn-web/package.json`
*   **Key Scripts**:
    *   `dev`: รันโหมด Developer (localhost:3000)
    *   `dev:lan`: รันโหมด Developer แบบเปิดรับทุก IP (0.0.0.0) สำหรับเทสผ่านมือถือ
    *   `build`: สร้าง Production Build (Static Files)
    *   `start`: รัน Production Build

---

## 5. `package.json` (Client App)
**Role**: Electron App Manifest & Dependencies
กำหนด Dependencies สำหรับ **Desktop Player** (.exe)

*   **Location**: `src/signage-unicorn-client/package.json`
*   **Key Scripts**:
    *   `start`: รัน Electron แบบ Dev Mode
    *   **`rebuild`** (Critical): คำสั่งสำคัญ! ใช้ **Rebuild Native Modules (SQLite)** ให้ตรงกับเวอร์ชันของ Electron ปัจจุบัน
    *   `build`: สร้างไฟล์ติดตั้ง `.exe` (Installer)
*   **Key Dependencies**:
    *   `electron`: Core framework
    *   `better-sqlite3`: ฐานข้อมูล Local ที่ต้องใช้ Native Compilation
    *   `electron-builder`: เครื่องมือสร้าง Installer

---

*Maintained by Signage Unicorn TECH Integration*
