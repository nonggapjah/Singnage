# วิธีการรันโปรเจกต์ (Run Instructions)

เอกสารนี้รวบรวมคำสั่งสำหรับการรันโปรเจกต์ Signage Unicorn ทั้งส่วน Frontend และ Backend

## 1. การรันแบบ Local (ใช้เครื่องเดียว)

วิธีนี้เหมาะสำหรับการพัฒนาบนเครื่องตัวเองคนเดียว

### Terminal 1: Backend (.NET API)
```powershell
cd "src\SignageUnicorn.Api"
dotnet watch run
```

### Terminal 2: Frontend (Next.js)
```powershell
cd "src\signage-unicorn-web"
npm run dev
```

*   **เข้าใช้งานเว็บ**: `http://localhost:3000`
*   **API Swagger**: `http://localhost:5018/swagger` (หรือ port ที่ขึ้นใน terminal)

---

## 2. การรันผ่าน LAN (ให้อุปกรณ์อื่นเข้าได้)

วิธีนี้สำหรับทดสอบผ่านมือถือ หรือเครื่องอื่นในวง WiFi/LAN เดียวกัน

### Terminal 1: Backend (เปิดรับทุก IP)
ต้องรันแบบระบุ URL ให้เป็น `0.0.0.0`
```powershell
cd "src\SignageUnicorn.Api"
dotnet watch run --urls "http://0.0.0.0:8862"
```

### Terminal 2: Frontend (เปิดรับทุก IP)
รันคำสั่งนี้ (ผมเพิ่ม script นี้ให้แล้ว ใช้ง่ายขึ้นครับ)
```powershell
cd "src\signage-unicorn-web"
npm run dev:lan
```

### การเข้าใช้งาน
1. **หา IP Address ของเครื่องคุณ**:
   เปิด Terminal ใหม่แล้วพิมพ์คำสั่ง:
   ```powershell
   ipconfig
   ```
   มองหา **IPv4 Address** (เช่น `192.168.1.105` หรือ `192.168.31.199`)

2. **เข้าผ่าน Browser (บนมือถือหรือคอมเครื่องอื่น)**:
   *   **เว็บ**: `http://<YOUR_IP_ADDRESS>:3000`
   *   (ตัวอย่าง: `http://192.168.1.160:3000`)

### ข้อควรระวัง (Troubleshooting)
*   **Firewall**: หากรันแล้วเข้าไม่ได้ ให้ตรวจสอบ Windows Firewall และกด **Allow** ให้โปรแกรม `dotnet` และ `node`
*   **Network**: อุปกรณ์ต้องเกาะ WiFi ชื่อเดียวกับคอมพิวเตอร์

---

## 3. การรันด้วย PM2 (Production/Server Mode)

วิธีนี้เหมาะสำหรับการนำไปรันบน Server หรือเครื่องที่ต้องการให้ทำงานตลอดเวลา (Background Service) และสามารถจัดการ Process ได้ง่าย โดยมีการแยก Port เพื่อไม่ให้ชนกับ Service อื่นๆ (เช่น 5018 ที่อาจจะชนได้)

### สิ่งที่ต้องเตรียม (Prerequisites)
ต้องติดตั้ง **PM2** ก่อน (ถ้ายังไม่มี):
```powershell
npm install -g pm2
```

### คำสั่งรัน (Start Command)
รันจาก Root Directory ของโปรเจกต์ (`c:\Villa\Signage Unicorn`):

```powershell
pm2 start ecosystem.config.js
```

### การตั้งค่า Port (Configuration)
ในไฟล์ `ecosystem.config.js` ได้กำหนด Port แยกไว้ดังนี้:
*   **Frontend (Next.js)**: Port `3000` (ค่า Default)
*   **Backend (.NET API)**: Port `8862` (Custom Port สำหรับ PM2)

⚠️ **สำคัญ**: หากมีการเปลี่ยน IP Address ของเครื่อง Server ต้องไปแก้ไขค่า IP ในไฟล์เหล่านี้ให้ตรงกัน:
1.  **Backend Config**: `src\SignageUnicorn.Api\appsettings.json` (ที่หัวข้อ `ServerSettings` -> `BaseUrl`)
2.  **Frontend Config**: `src\signage-unicorn-web\.env` (ที่ตัวแปร `NEXT_PUBLIC_API_URL`)

### คำสั่งจัดการ PM2 ที่ควรรู้
*   `pm2 status` : ดูสถานะของทุกแอป
*   `pm2 logs` : ดู Log การทำงาน
*   `pm2 stop all` : หยุดทำงานทุกแอป
*   `pm2 restart all` : รีสตาร์ททุกแอป
*   `pm2 delete all` : ลบแอปออกจากรายการ PM2
