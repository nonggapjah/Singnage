# Media Library & Playlist Standards (Digital Signage System)

เอกสารนี้กำหนดมาตรฐานการทำงาน (Functional Standards) และเกณฑ์การตรวจสอบ (QA Checklist) สำหรับโมดูล **Media Library** และ **Playlist Management** เพื่อให้มั่นใจว่าระบบจัดการสื่อและลำดับการแสดงผลทำงานได้อย่างถูกต้อง มีประสิทธิภาพ และใช้งานง่าย

---

## 1. Media Library (คลังสื่อ)

Media Library คือศูนย์กลางสำหรับเก็บไฟล์รูปภาพและวิดีโอที่จะนำไปใช้ใน Playlist

### 1.1 Supported Formats & Constraints (มาตรฐานไฟล์)
ระบบต้องรองรับและตรวจสอบเงื่อนไขดังนี้:

| Category | File Types | Max Size (Recomm.) | Validation Guidelines |
| :--- | :--- | :--- | :--- |
| **Images** | `.jpg`, `.png`, `.jpeg`, `.webp` | 20 MB | - ตรวจสอบ Ratio (Landscape/Portrait)<br>- แสดง Thumbnail ได้ทันทีหลังจากอัปโหลด |
| **Videos** | `.mp4`, `.webm` | 2.0 GB | - **ต้อง** ดึงค่า Duration (ความยาววินาที) จากไฟล์โดยอัตโนมัติ<br>- **ต้อง** ดึงค่า Resolution/Ratio<br>- รองรับ Preview Playback ในหน้า Admin |

### 1.2 Features Standards (มาตรฐานฟีเจอร์)
1.  **Search & Filter:**
    *   ต้องค้นหาได้จาก `File Name`,`Display Name` ,`Remark1` และ `Remark2`
    *   ต้องกรอง (Filter) ตามประเภทสื่อได้ (Image vs Video)
    *   ต้องกรองตามสถานะ (Active / Inactive) ได้
2.  **Upload Mechanism:**
    *   Progress Bar: ต้องแสดงสถานะการอัปโหลด (0-100%)
    *   Multiple Upload: ควรสามารถอัปโหลดได้หลายไฟล์พร้อมกัน
    *   Auto-tagging: ควรอ่าน Metadata (Width, Height, Duration) อัตโนมัติทันทีที่ไฟล์เข้าสู่ระบบ
3.  **Delete/Archive Logic:**
    *   **Status Management (Active/Inactive):**
        *   **Active (`is_deleted = 0`):** สื่อพร้อมใช้งาน สามารถนำไปใช้ใน Playlist ได้ปกติ
        *   **Inactive (`is_deleted = 1`):** สื่อถูกระงับการใช้งาน (Soft Delete) จะไม่แสดงในรายการ active และไม่ถูกส่งไปยัง Device แต่ไฟล์ยังคงอยู่
        *   **Restore Capability:** สื่อที่เป็น Inactive สามารถกู้คืน (Restore) สถานะกลับมาเป็น Active ได้
    *   **Force Delete:** การลบถาวร (Hard Delete) สามารถทำได้โดยผู้ดูแลระบบ (หากไฟล์ถูกใช้งานอยู่ ระบบจะแจ้งเตือนก่อนลบ)
4.  **Media Expiry (อายุการใช้งานสื่อ):**
    *   **End Date Configuration:** สามารถกำหนด "วันหมดอายุ" (End Date) ให้กับสื่อแต่ละไฟล์ได้
    *   **Automated Cleanup:** ระบบมี Background Service (`MediaCleanupWorker`) คอยตรวจสอบสื่อที่หมดอายุ (End Date <= ปัจจุบัน) ทุกๆ 6 ชั่วโมง
    *   **Expiration Action:** เมื่อสื่อหมดอายุ ระบบจะทำการ Soft Delete (Set Inactive) หรือ Hard Delete (ตามการตั้งค่า) อัตโนมัติ

### 1.3 Safety Jingle Configuration (ระบบภาพพักหน้าจอฉุกเฉิน)
*   **Centralized Management:** การตั้งค่า Safety Jingle ทำที่หน้า **Media Library** โดย Admin เท่านั้น
*   **Global Sync:** เมื่อตั้งค่าแล้ว จะมีผลกับ Device ทุกเครื่อง (Global Setting)
*   **Local Storage Origin:** ไฟล์ Jingle จะถูกโหลดจาก Local Server ในเครื่องแม่ข่าย
*   **Offline Capability:** Device จะดาวน์โหลดรูปภาพและแปลงเป็น **Base64** เก็บไว้ใน Local Storage เพื่อให้สามารถแสดงผลได้ทันทีแม้ไม่มีอินเทอร์เน็ตหรือ Server ล่ม
*   **Activation Logic:** แสดงผลเมื่อ:
    1.  ไม่มี Playlist ที่ Active
    2.  กำลังโหลด Content ใหม่
    3.  เกิดข้อผิดพลาดในการเล่นไฟล์

---

## 2. Playlist Management (การจัดรายการแสดงผล)

### 2.1 Playlist Logic
*   **Sequential Playback:** Playlist ทำงานแบบเรียงลำดับ (Sequence) 1, 2, 3... และวนลูป (Loop) เมื่อจบรายการสุดท้าย
*   **Media Types Mixing:** ต้องสามารถผสม Image และ Video ใน Playlist เดียวกันได้

### 2.2 Item Configuration (การตั้งค่าแต่ละรายการ)
เมื่อนำ Media เข้าสู่ Playlist ต้องสามารถกำหนดค่าเฉพาะได้:

1.  **Duration (ระยะเวลาแสดงผล):**
    *   **Images:** ต้องระบุเวลาได้ (Default ควรเป็น 10-15 วินาที) และสามารถแก้ไขได้ (DurationOverride)
    *   **Videos:** **บังคับ** ใช้ความยาวจริงของวิดีโอ (Real Duration) เป็นค่าตั้งต้น
        *   *Optional:* อนุญาตให้ตัดจบ (Trim) หรือกำหนดเวลา Override ได้ (เช่น เล่นแค่ 10 วินาทีจาก 30) แต่ต้องไม่เกินความยาวจริง
2.  **Sequence Order:**
    *   **ต้อง** สามารถเปลี่ยนลำดับ (Reorder) ได้ง่าย (เช่น Drag & Drop หรือ ปุ่ม Up/Down)
    *   ลำดับต้องอัปเดตทันที (Real-time updates to sequence numbers)

### 2.3 Status Management
*   **Active:** พร้อมใช้งาน (Device สามารถดึงไปแสดงผลได้) **(มาตรฐานบังคับ: เฉพาะ Playlist ที่ Active เท่านั้นที่สามารถ Assign หรือ Deploy ให้ Device ได้)**
*   **Inactive/Draft:** อยู่ระหว่างแก้ไข หรือปิดใช้งานชั่วคราว (Device ไม่ควรดึงไปแสดง หรือถ้าดึงไปแล้ว หากพบว่า Inactive ต้องข้ามไปรายการถัดไป หรือย้อนกลับไปใช้ Playlist เดิม)

---

## 3. QA Checklist (ตารางตรวจสอบมาตรฐาน)

ใช้ Checklist นี้ในการตรวจรับงาน (UAT) หรือตรวจสอบก่อนขึ้น Production

### 3.1 Media Library Checklist
| No. | Check Item (Validation) | Expected Behavior | Pass/Fail |
| :--- | :--- | :--- | :--- |
| M01 | **Upload Validation** | อัปโหลดไฟล์ผิดประเภท (.exe, .pdf) หรือเกินขนาด → ระบบต้องปฏิเสธและแจ้งเตือน | [ ] |
| M02 | **Metadata Extraction** | อัปโหลดวิดีโอ → ระบบต้องอ่านค่า Duration และ Dimension ได้ถูกต้อง (ไม่เป็น 0) | [ ] |
| M03 | **Preview** | คลิกที่สื่อ → ต้องแสดงภาพขยาย หรือเล่นวิดีโอตัวอย่างได้ | [ ] |
| M04 | **Duplicate Check** | (Optional) หากอัปโหลดชื่อซ้ำ → ระบบควรแจ้งเตือนหรือ Rename อัตโนมัติ (ไม่ Error) | [ ] |
| M05 | **Delete Protection** | ลบสื่อที่กำลังถูกใช้ใน Playlist → ระบบต้อง **ห้ามลบ** หรือ **แจ้งเตือน** ว่าถูกใช้อยู่ที่ไหน | [ ] |
| M06 | **Safety Jingle Set** | ตั้งค่ารูปเป็น Jingle → Device ต้องแสดงรูปนั้นเมื่อไม่มี Playlist หรือ Offline | [ ] |

### 3.2 Playlist Checklist
| No. | Check Item (Validation) | Expected Behavior | Pass/Fail |
| :--- | :--- | :--- | :--- |
| P01 | **Add Items** | เลือกสื่อจาก Library เข้า Playlist → สื่อต้องมาปรากฏในรายการถูกต้อง | [ ] |
| P02 | **Default Duration** | เพิ่มรูปภาพ → Duration เป็น 10s (หรือค่า Default) / เพิ่มวิดีโอ → Duration เท่ากับความยาววิดีโอ | [ ] |
| P03 | **Ordering** | สลับลำดับรายการ (Item 1 ↔ Item 2) → บันทึกแล้วลำดับไม่คืนค่าเดิม | [ ] |
| P04 | **Total Duration** | ระบบคำนวณเวลารวมของ Playlist (Total Loop Time) ได้ถูกต้อง | [x] |
| P05 | **Inactive Toggle** | ปรับสถานะ Playlist เป็น Inactive → Device ต้องไม่เห็น หรือไม่เล่น Playlist นี้ | [ ] |
| P06 | **Empty Playlist** | สร้าง Playlist ว่าง (ไม่มีรายการ) → ระบบควรอนุญาตให้สร้าง Draft ได้ แต่ **ห้าม** Assign ให้ Device (หรือ Assign แล้ว Device ต้องจัดการได้ไม่ Error) | [ ] |

---

## 4. Technical Notes for Developers

*   **Database Schema:**
    *   `MediaFiles`: ต้องมี Column `DurationSec`, `Ratio`, `FileSize` ที่ Not Null (หรือมี Default ที่จัดการได้)
    *   `PlaylistItems`: ต้องมี `PositionOrder` ที่ห้ามซ้ำกันใน `PlaylistId` เดียวกัน
    *   `SystemSettings`: ใช้เก็บค่า `ConfigKey='safety_jingle_id'` และ `ConfigValue=[MediaId]`
*   ### 4.1 Storage Architecture
1.  **Local Server Storage**: ไฟล์สื่อทั้งหมดจะถูกจัดเก็บโดยตรงบน Server (Folder: `wwwroot/media`) ไม่ผ่านระบบ Cloud ภายนอกเพื่อความเร็วในการเข้าถึงภายในเครือข่าย
2.  **Naming Convention**: ระบบจะเปลี่ยนชื่อไฟล์เป็น GUID เมื่อทำการอัปโหลดเพื่อป้องกันไฟล์ชื่อซ้ำ (e.g., `550e8400-e29b.mp4`)
3.  **Integrity Check**: ทุกไฟล์จะมีการสร้าง **MD5 Hash** เพื่อให้เครื่อง Device ตรวจสอบว่าดาวน์โหลดไฟล์ไปครบถ้วนหรือไม่ก่อนเริ่มเล่น

### 4.2 Resource Constraints
*   **Max File Size**: 2.0 GB ต่อไฟล์ (ปรับสมดุลตามความเร็ว Network)
*   **Supported Formats**: MP4 (H.264), JPG, PNG, WebP
*   **Recommended Resolution**: 1920x1080 (16:9) หรือ 1080x1920 (9:16)
*   **Client Caching:** Device ต้องเก็บ Safety Jingle เป็น Base64 ใน `localStorage` เพื่อรองรับ Offline Mode
*   **API Response:**
    *   `GET /playlists/{id}` ควร return items ที่ `ORDER BY PositionOrder ASC` เสมอ
    *   หาก Media ถูกลบ `Status='D'`, Playlist API ต้อง **ไม่ส่ง** Item นั้นไปให้ Device (Filter ออกที่ Backend หรือ Frontend)
