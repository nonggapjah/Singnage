# วิธีการใช้งานและติดตั้ง (Production / Cloud First)

เอกสารนี้รวบรวมคำสั่งสำหรับการรันโปรเจกต์ Signage Unicorn โดยเน้นการใช้งานจริงผ่าน Cloud Server (`signage.aith123.com`)

## 1. การใช้งานจริง (Production Cloud)

ในเวอร์ชันปัจจุบัน (2.2.1+) ระบบถูกออกแบบให้ทำงานผ่าน Cloud เป็นหลัก เพื่อให้สามารถบริหารจัดการจากส่วนกลางได้ทันที

### 1.1 สำหรับเครื่องเล่น (Client / Device)
เพียงแค่ติดตั้งไฟล์ `.exe` ที่ได้จากการ Build:
1.  ติดตั้งโปรแกรมลงในเครื่อง Mini PC / Windows Stick
2.  เชื่อมต่ออินเทอร์เน็ต
3.  เปิดโปรแกรม -> ตั้งชื่อเครื่อง -> กด **Connect**
4.  (ระบบจะวิ่งไปหา `https://signage.aith123.com` โดยอัตโนมัติ)

### 1.2 สำหรับ Admin (Web Dashboard)
*   เข้าใช้งานได้ทันทีที่: **[https://signage.aith123.com](https://signage.aith123.com)**
*   ไม่ต้องรัน Command Line ใดๆ บนเครื่องตัวเอง

---

## 2. การรันแบบ Developer (Localhost)

วิธีนี้เหมาะสำหรับนักพัฒนาที่ต้องการแก้บั๊กหรือพัฒนาฟีเจอร์ใหม่

### Terminal 1: Backend (.NET API)
```powershell
cd "src\SignageUnicorn.Api"
dotnet watch run
```
*   API จะรันที่: `http://localhost:5018`

### Terminal 2: Frontend (Next.js)
```powershell
cd "src\signage-unicorn-web"
npm run dev
```
*   Web จะรันที่: `http://localhost:3000`

---

## 3. การรันแบบ LAN (ทดสอบในวงแลน)

หากต้องการทดสอบด้วยอุปกรณ์จริงแต่ไม่มีเน็ต หรือต้องการเทสก่อนขึ้น Cloud

### Terminal 1: Backend (เปิดรับทุก IP)
```powershell
cd "src\SignageUnicorn.Api"
dotnet watch run --urls "http://0.0.0.0:8862"
```

### Terminal 2: Frontend (เปิดรับทุก IP)
```powershell
cd "src\signage-unicorn-web"
npm run dev:lan
```

### การเข้าใช้งาน
*   เข้าผ่าน Browser: `http://<IP_เครื่องคุณ>:3000`
*   ต้องแก้ Config ในแอป Client ให้ชี้มาที่ IP เครื่องคุณแทน `signage.aith123.com`

---

## 4. Server Management (PM2)

สำหรับผู้ดูแล Server ที่ `signage.aith123.com`

### คำสั่งจัดการ (Root Directory)
```powershell
pm2 status       # ดูสถานะ
pm2 restart all  # รีสตาร์ทระบบ
pm2 logs         # ดู Log สด
```

### การอัปเดต Server
เมื่อมีการแก้โค้ดและ Pull ลงมาใหม่:
```powershell
# 1. Backend
cd src/SignageUnicorn.Api ; dotnet publish -c Release

# 2. Frontend
cd ../signage-unicorn-web ; npm run build

# 3. Restart
pm2 restart all
```
