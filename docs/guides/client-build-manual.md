# Client Build & Installation Guide (v2.2.1)

เอกสารนี้อธิบายวิธีการ Build `signage-unicorn-client` (Electron App) ให้เป็นไฟล์ `.exe` สำหรับนำไปติดตั้งที่เครื่องปลายทาง (Device) โดยรองรับ **SQLite Native Module** อย่างสมบูรณ์

## 1. Prerequisites (สิ่งที่ต้องมี)

*   **Node.js**: ติดตั้งเวอร์ชัน LTS (แนะนำ v18 หรือ v20)
*   **Git**: สำหรับดึงโค้ด
*   **Source Code**: โฟลเดอร์ `src/signage-unicorn-client`
*   **Visual C++ Redistributable 2015-2022**: จำเป็นต้องติดตั้งในเครื่องที่ใช้ Build และเครื่องลูกค้า เพื่อให้ **SQLite** ทำงานได้

## 2. ขั้นตอนการ Build (Build Executable)

เปิด Terminal แล้วทำตามขั้นตอนดังนี้:

### 2.1 เข้าไปยังโฟลเดอร์ Client
```powershell
cd "src\signage-unicorn-client"
```

### 2.2 ติดตั้ง Dependencies
```powershell
npm install
```

### 2.3 Rebuild Native Modules (สำคัญมาก!)
เพื่อให้ `better-sqlite3` ทำงานได้บน Electron ต้องทำการ Rebuild Native Module ก่อนเสมอ:
```powershell
npm run rebuild
```
*หากไม่ทำขั้นตอนนี้ โปรแกรมจะฟ้องว่า "Missing SQLite" หรือ "Module not found" ตอนใช้งาน*

### 2.4 ตรวจสอบ Config
ค่า Default จะถูกตั้งเป็น Production แล้ว:
*   **Server URL**: `https://signage.aith123.com`
*   หากต้องการแก้ ให้เช็คไฟล์ `main.js` (บรรทัด `ipcMain.handle('get-config' ...`)

### 2.5 คำสั่ง Build Installer
รันคำสั่งเพื่อสร้างไฟล์ .exe:
```powershell
npm run build
```

---

## 3. Output (ผลลัพธ์)

เมื่อ Build เสร็จสิ้น ไฟล์ติดตั้งจะอยู่ที่:
*   **Path**: `src\signage-unicorn-client\dist\`
*   **Files**: `Signage Unicorn Setup 2.2.1.exe`

## 4. การนำไปติดตั้ง (Deployment)

1.  Copy ไฟล์ `.exe` ไปยังเครื่อง Device
2.  ติดตั้งและเปิดโปรแกรม
3.  **Setup Screen**:
    *   **Server IP**: `https://signage.aith123.com` (Default)
    *   **Device Name**: ตั้งชื่อเครื่อง (เช่น `Lobby_TV_01`)
    *   **Branch Code**: รหัสสาขา
4.  กด **Save & Connect**

## 5. Troubleshooting

*   **Error "Module did not self-register" / "DLL Initialization failed"**:
    *   สาเหตุ: `better-sqlite3` ไม่ได้ถูก compile สำหรับ Electron เวอร์ชั่นนั้นๆ
    *   วิธีแก้: รัน `npm run rebuild` แล้ว build ใหม่
*   **Patch History "Changelog not found"**:
    *   ในเวอร์ชัน 2.2.1 ได้แก้ปัญหานี้แล้ว หากยังเจอให้ลองต่อเน็ตเพื่อให้ดึงข้อมูลจาก Server แทน
*   **White Screen**: เช็คการเชื่อมต่อเน็ต และ Ping `signage.aith123.com` ดูว่าเจอหรือไม่
