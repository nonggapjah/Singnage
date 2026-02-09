# Client Build & Installation Guide

เอกสารนี้อธิบายวิธีการ Build `signage-unicorn-client` (Electron App) ให้เป็นไฟล์ `.exe` สำหรับนำไปติดตั้งที่เครื่องปลายทาง (Device)

## 1. Prerequisites (สิ่งที่ต้องมี)

*   **Node.js**: ติดตั้งเวอร์ชัน LTS (แนะนำ v18 หรือ v20)
*   **Git**: สำหรับดึงโค้ด (ถ้าจำเป็น)
*   **Source Code**: โฟลเดอร์ `src/signage-unicorn-client`

## 2. ขั้นตอนการ Build (Build Executable)

เปิด Terminal แล้วทำตามขั้นตอนดังนี้:

### 2.1 เข้าไปยังโฟลเดอร์ Client
```powershell
cd "src\signage-unicorn-client"
```

### 2.2 ติดตั้ง Dependencies
หากยังไม่เคยติดตั้ง หรือมีการอัปเดตไลบรารี
```powershell
npm install
```

### 2.3 แก้ไข Config (ถ้าจำเป็น)
ก่อน Build ควรตรวจสอบไฟล์ `main.js` หรือ Config ที่เกี่ยวข้อง เพื่อให้มั่นใจว่าชี้ไปยัง Server ที่ถูกต้อง
*   ปกติจะตั้งค่าให้โหลด URL จากไฟล์ JSON หรือ Environment Variable
*   หากเป็นการ Hardcode โปรดแก้ `API_BASE_URL` หรือ `Socket_URL` ให้เป็น Production

### 2.4 คำสั่ง Build
รันคำสั่งเพื่อสร้างไฟล์ .exe (ใช้ `electron-builder`)
```powershell
npm run build
```

---

## 3. Output (ผลลัพธ์)

เมื่อ Build เสร็จสิ้น ไฟล์ติดตั้งจะอยู่ที่โฟลเดอร์ `dist` ภายใน `src/signage-unicorn-client`

*   **Path**: `src\signage-unicorn-client\dist\`
*   **Files**:
    *   `Signage Unicorn Setup 1.2.0.exe` (ตัวติดตั้ง)
    *   `win-unpacked\` (โฟลเดอร์โปรแกรมแบบไม่ต้องติดตั้ง ไว้เทสได้)

## 4. การนำไปติดตั้ง (Deployment)

1.  Copy ไฟล์ `.exe` ไปยังเครื่อง Device
2.  Double click เพื่อติดตั้ง
3.  โปรแกรมจะรันอัตโนมัติ และจะสอบถามการตั้งค่า 3 อย่าง:
    *   **Server IP**: เช่น `http://192.168.1.50:5018`
    *   **Device Name**: ตั้งชื่ออุปกรณ์ เช่น `Front_Counter_01`
    *   **Branch Code**: รหัสสาขา เช่น `1001`
4.  กดปุ่ม **CONNECT & START** เพื่อเริ่มการทำงาน
5.  **Device Dashboard**: ขณะโปรแกรมทำงาน สามารถกด **F7** เพื่อเรียกดูสถานะหรือแก้ไขการตั้งค่าได้ทันที
6.  **แนะนำ**: ตั้งค่า Windows ให้ Auto-login และนำ Shortcut ของโปรแกรมไปใส่ใน `shell:startup` เพื่อให้เปิดอัตโนมัติเมื่อเปิดเครื่อง

## 5. Troubleshooting

*   **Cannot create symbolic link**: หากเจอ Error เกี่ยวกับ `A required privilege is not held by the client` ขณะแตกไฟล์ `winCodeSign`:
    1.  ให้เปิด Terminal (PowerShell/CMD) ด้วยสิทธิ์ **Run as Administrator** แล้วค่อยรัน `npm run build`
    2.  หรือ **แนะนำ**: เปิด **Developer Mode** ใน Windows (Settings > System > For developers > Developer Mode = On) วิธีนี้จะช่วยให้เครื่องสร้าง Symbolic link ได้โดยไม่ต้องใช้สิทธิ์ Admin ทุกครั้ง
*   **White Screen**: หากติดตั้งแล้วเปิดมาเจอหน้าขาว ให้เช็คว่าเครื่อง Device มองเห็น Server (Backend/Frontend) หรือไม่ (Ping IP Server ดู)
