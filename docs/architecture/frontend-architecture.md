# บทที่ 1 — บทนำ (Introduction)

## 1.1 ภาพรวม (Overview)

เอกสาร **Unicorn Frontend Architecture v1.0** ฉบับนี้กำหนดทิศทางและมาตรฐานการออกแบบระบบ Frontend สำหรับทุกระบบภายใต้บริษัท Unicorn Tech โดยมีเป้าหมายให้ทุกโปรเจกต์ที่ใช้ Web Frontend (Next.js/React/TypeScript) อยู่บนสถาปัตยกรรมเดียวกัน มีคุณภาพสอดคล้องกัน และสามารถดูแลขยายต่อได้ในระยะยาว

Frontend ในมุมมองของ Unicorn Tech ไม่ได้เป็นเพียง “หน้าเว็บ” แต่เป็น **Frontend Platform** ที่เชื่อมต่อระหว่างผู้ใช้งานกับ Backend Platform (Business Logic, Data, Integration) ที่ถูกกำหนดไว้ในเอกสาร **Unicorn Backend Architecture v1.0** ดังนั้นสถาปัตยกรรมฝั่ง Frontend ต้องออกแบบ โดยถือ Backend เป็น “แหล่งความจริง (Source of Truth)” และต้องไม่สร้าง Business Logic ซ้ำซ้อนในฝั่ง UI

เอกสารนี้จึงทำหน้าที่เป็น “คู่ขนาน” ของ Backend Architecture สำหรับฝั่ง FE โดยกำหนดหลักการ โครงสร้าง และมาตรฐานที่ทีมพัฒนาทุกคนต้องยึดถือร่วมกัน

---

## 1.2 วัตถุประสงค์ (Purpose)

วัตถุประสงค์หลักของเอกสารนี้คือ:

1. กำหนด **สถาปัตยกรรมกลางของ Frontend** สำหรับทุกโปรเจกต์ของ Unicorn Tech
2. ทำให้ Frontend ทำงานสอดคล้องกับ Backend Architecture v1.0 ทั้งในด้าน  
   - API Contract  
   - Security Model (JWT, MFA, Token Lifecycle)  
   - Logging & Observability (conversation-id, correlation-id)  
   - Non-Functional Requirements (NFR)
3. ลดความแตกต่างของโครงสร้างโค้ดและการออกแบบระหว่างโปรเจกต์ เพื่อให้สามารถ  
   - Reuse Component / Module ได้สูง  
   - ลดเวลา Onboard ทีมใหม่  
   - ลดความเสี่ยงจาก Developer เข้า–ออกทีม
4. กำหนด Guardrails ที่ชัดเจน ว่า Frontend “ควรทำอะไร” และ “ห้ามทำอะไร” เพื่อไม่ให้กระทบ Business Logic และความปลอดภัยของระบบโดยรวม
5. ใช้เป็นเอกสารอ้างอิงหลักในการ Review / Design / Refactor ระบบ Frontend ในอนาคต

---

## 1.3 ขอบเขต (Scope)

เอกสาร Unicorn Frontend Architecture v1.0 ครอบคลุมหัวข้อหลักดังนี้:

- ภาพรวมสถาปัตยกรรม Frontend และความสัมพันธ์กับ Backend
- โครงสร้างเลเยอร์ของ Frontend (UI, State, API Integration, Providers, Core Lib)
- มาตรฐานการติดต่อ API และ Error Handling
- สถาปัตยกรรมด้านความปลอดภัยฝั่ง FE (Security, Token, MFA)
- Observability และ Logging บน Frontend
- การจัดการ State ด้วย Provider Model
- โครงร่าง UI/UX และ AppShell Layout
- Non-Functional Requirements (Performance, Availability, Security, DX)
- มาตรฐานการพัฒนา (Development Standards & Best Practices)

สิ่งที่ **ไม่รวม** ในเอกสารฉบับนี้:

- รายละเอียดการออกแบบ UX/UI (Design System เต็มรูปแบบ)
- รายละเอียด Business Logic (ตัดสินใจโดย Backend เท่านั้น)
- คู่มือการใช้เครื่องมือ CI/CD, DevOps ระดับระบบทั้งหมด (อ้างอิงเอกสาร DevOps แยกต่างหาก)

---

## 1.4 ความสัมพันธ์กับ Unicorn Backend Architecture v1.0

Backend Architecture v1.0 เป็นเอกสารหลักของบริษัทในมุม Business Logic และ System Integration ส่วน Frontend Architecture v1.0 เป็น “เอกสารคู่” ที่ต้อง Align กับ Backend ในประเด็นสำคัญต่อไปนี้:

- **Security & Auth**  
  Frontend ต้องปฏิบัติตาม Security Model ที่ Backend กำหนด (JWT, Refresh Token, MFA, PII Masking) และไม่เพิ่ม logic ขัดแย้งเอง
- **API & Error Contract**  
  Frontend ต้องใช้ API ตามสัญญา (Contract) ที่ Backend ระบุ และใช้ message / code จาก Backend เป็นหลัก
- **Observability & Logging**  
  Frontend ต้องสร้างและส่งค่า conversation-id / correlation-id ให้ Backend เสมอ เพื่อให้สามารถ Trace Request End-to-End ได้
- **NFR**  
  เป้าหมายด้าน Performance, Reliability, Security ของ FE ต้องสนับสนุน NFR ของระบบรวมที่ Backend กำหนด

แนวทางออกแบบในเอกสารนี้จึงถือ Backend Architecture เป็น “ข้อเท็จจริงพื้นฐาน” และ Frontend ต้อง **ไม่ขัดแย้ง** กับแนวทางดังกล่าว เว้นแต่มีการพิจารณาร่วมกันและอนุมัติในระดับสถาปนิกระบบ

---

## 1.5 บทบาทของ Frontend ภายในระบบ Unicorn

เพื่อให้เข้าใจตำแหน่งของ Frontend ในสถาปัตยกรรมภาพใหญ่ สามารถสรุปบทบาทได้ดังนี้:

**สิ่งที่ Frontend “ต้องทำ”**

- แสดงผลข้อมูลและสถานะจาก Backend ให้ผู้ใช้เข้าใจง่าย
- ควบคุม UI Flow เช่น Login → MFA → Dashboard → Account
- จัดการ State ฝั่ง UI เช่น loading, error, selection, form input
- เรียก API ผ่าน Layer กลาง (apiFetch) ตามมาตรฐานองค์กร
- จัดการ Authentication State ตาม Token/Session ที่ Backend ออกให้
- ส่งค่า header ที่จำเป็นต่อ Observability (conversation-id, correlation-id, device-id)

**สิ่งที่ Frontend “ห้ามทำ”**

- ห้ามตัดสินใจ Business Logic เอง (เช่น สิทธิ์, ข้อจำกัด, กฎทางธุรกิจ)
- ห้าม validate Business Rule ที่ซ้ำกับ Backend (เช่น password policy, MFA policy)
- ห้ามประกอบ/ดัดแปลงข้อมูลในเชิง Business ให้ไม่ตรงกับที่ Backend ส่งมา
- ห้ามเก็บข้อมูลสำคัญ (token, PII) อย่างถาวรในที่ไม่ปลอดภัย (เช่น localStorage ใน Production)
- ห้ามสร้าง API หรือ Endpoint เพิ่มเองโดยไม่ผ่าน Backend Team

---

## 1.6 ผู้อ่านเป้าหมาย (Intended Audience)

เอกสารนี้ถูกออกแบบเพื่อใช้โดย:

- Frontend Developer (ทุกระดับ)
- Backend Developer ที่ต้องการเข้าใจพฤติกรรมฝั่ง FE
- Solution / System Architect
- Tech Lead / Team Lead
- QA Engineer (เพื่อเข้าใจ Flow และ Error Handling)
- DevOps / Infra Engineer (เพื่อดูภาพรวม Observability และ Deployment Impact)
- ผู้เกี่ยวข้องด้าน Security / Compliance

---

## 1.7 หลักการออกแบบหลัก (Design Principles)

สถาปัตยกรรม Frontend ของ Unicorn ใช้หลักการต่อไปนี้เป็นกรอบในการตัดสินใจ:

1. **Backend-First** — Backend คือ Source of Truth, FE ไม่ซ้ำ Business Logic  
2. **Platform over Project** — ออกแบบ Frontend เป็น Platform ใช้ซ้ำได้ในหลายโปรเจกต์  
3. **Security by Design** — ทุกการออกแบบ FE ต้องคิดถึง Security ตั้งแต่แรก ไม่ใช่ตามภายหลัง  
4. **Observability First** — ทุก Request/Flow ต้องตรวจสอบย้อนหลังได้  
5. **Simplicity & Consistency** — โค้ดอ่านง่าย โครงสร้างเหมือนกันทุกโปรเจกต์ ลดความซับซ้อนโดยไม่จำเป็น  
6. **Guardrails over Freedom** — มีกรอบชัดเจน (เช่น ห้ามเรียก fetch ตรง ห้ามเก็บ token ผิดตำแหน่ง) เพื่อป้องกันปัญหาระยะยาว  
7. **Reusability & Extensibility** — โครงสร้างรองรับการเพิ่มฟีเจอร์และโปรเจกต์ใหม่ โดยยังสามารถใช้โค้ดเดิมซ้ำได้ในระดับสูง

---

## 1.8 โครงสร้างเอกสาร Frontend Architecture v1.0

เพื่อให้สอดคล้องกับรูปแบบของ Backend Architecture เอกสารฉบับนี้แบ่งออกเป็นหลายบท โดยแต่ละบทมีประเด็นหลักดังนี้:

- **บทที่ 1 — บทนำ (Introduction)**  
  ภาพรวม วัตถุประสงค์ ขอบเขต และความสัมพันธ์กับ Backend Architecture

- **บทที่ 2 — ภาพรวมสถาปัตยกรรม (Architecture Overview)**  
  โครงสร้างเลเยอร์ของ Frontend, ความสัมพันธ์ระหว่าง UI, State, API, Providers, Core Lib

- **บทที่ 3 — Service Blueprint & System Flow**  
  Flow ระหว่าง User → FE → BE ในกรณีสำคัญ เช่น Login, MFA, Protected Route

- **บทที่ 4 — API Standards & Integration Model**  
  มาตรฐานการเรียก API, Request/Response Pattern, Header, Error Handling

- **บทที่ 5 — Security Architecture for Frontend**  
  Token Model, MFA, Storage Policy, Frontend Security Guardrails

- **บทที่ 6 — Observability Architecture & Logging Standard**  
  การใช้ conversation-id / correlation-id, FE Logging, การเชื่อมโยงกับ BE Log

- **บทที่ 7 — State Management & Providers Model**  
  แนวทางจัดการ State ด้วย Provider, แยก UI vs App vs Server State

- **บทที่ 8 — UI/UX Architecture & AppShell Layout**  
  โครงหน้าจอหลัก (AppShell), Navigation, Component Layer, Form และ Error UI

- **บทที่ 9 — Non-Functional Requirements (Frontend NFR)**  
  เป้าหมายด้าน Performance, Reliability, Security, Maintainability ของ FE

- **บทที่ 10 — Development Standards & Best Practices**  
  มาตรฐานการเขียนโค้ด, Folder Structure, Code Review, Git Workflow, Guardrails

---

## 1.9 สรุปบทที่ 1

บทนำฉบับนี้วางรากฐานแนวคิดของ Unicorn Frontend Architecture v1.0 โดยระบุ:

- เหตุผลที่ต้องมีสถาปัตยกรรม FE ระดับองค์กร  
- ความสัมพันธ์และการยึดโยงกับ Backend Architecture v1.0  
- บทบาทและขอบเขตหน้าที่ของ Frontend  
- หลักคิดสำคัญในการออกแบบ  
- โครงสร้างหัวข้อที่จะใช้ในบทถัดไป

บทต่อไปจะลงรายละเอียด **ภาพรวมสถาปัตยกรรม (Architecture Overview)** เพื่ออธิบายเลเยอร์และองค์ประกอบหลักของ Unicorn Frontend Platform อย่างเป็นระบบ

# บทที่ 2 — ภาพรวมสถาปัตยกรรม (Architecture Overview)

## 2.1 บทนำ (Introduction)
บทนี้อธิบายภาพรวมสถาปัตยกรรมระดับสูงของ Unicorn Frontend Platform เพื่อให้ทีม FE, BE, QA และ DevOps เข้าใจตรงกันถึงภาพรวมการทำงานเชิงสถาปัตยกรรม โดยสอดคล้องกับ Unicorn Backend Architecture v1.0 ซึ่งกำหนดให้ Backend เป็น Source of Truth และ Frontend เป็น UI Layer ที่ไม่มี Business Logic

วัตถุประสงค์ของบทนี้:
- กำหนดกรอบภาพรวมของสถาปัตยกรรม FE
- อธิบายขอบเขตและหน้าที่ของแต่ละเลเยอร์
- สร้างชุดมาตรฐานเดียวกันสำหรับทุกโปรเจคในบริษัท Unicorn
- เชื่อมโยง FE กับ BE ตามหลักการ Separation of Concerns

---

## 2.2 ภาพรวมระบบ (System Context)

สถาปัตยกรรมของ Unicorn ถูกออกแบบเพื่อแยกบทบาทของ User, FE, BE และ Database อย่างชัดเจน ดังนี้:

```
[ User ]
    │
    ▼
[ Frontend Platform (Next.js + TypeScript) ]
    │   - UI Rendering & Interaction
    │   - AppShell Layout
    │   - Providers & Global State
    │   - API Client (apiFetch)
    │   - JWT / Refresh Token / MFA Handling
    │
    ▼  HTTPS + JWT + Conversation-ID
[ Backend API (ASP.NET + Domain Services) ]
    │   - Authentication
    │   - Business Logic
    │   - Validation
    │   - Logging & Observability
    │
    ▼
[ Database (SQL Server) ]
```

หลักการสำคัญจาก BE Architecture:
- **Frontend ห้ามมี Business Logic**
- **ทุก Business Rule ต้องอยู่ที่ Backend**
- FE ต้องส่งข้อมูลแบบตรงไปตรงมา และแสดงผลตามที่ BE ตัดสินใจ

---

## 2.3 ส่วนประกอบหลักของ Frontend Platform

สถาปัตยกรรม FE แบ่งออกเป็น 5 เลเยอร์เพื่อความชัดเจนและง่ายต่อการดูแลรักษา:

```
┌────────────────────────────────────────────┐
│ 5. Page Layer & Feature Modules            │
├────────────────────────────────────────────┤
│ 4. UI Layer (Components & AppShell Layout) │
├────────────────────────────────────────────┤
│ 3. Provider Layer (Auth, Layout, Theme)    │
├────────────────────────────────────────────┤
│ 2. API Integration Layer (apiFetch + API)  │
├────────────────────────────────────────────┤
│ 1. Core Foundation (config, log, id, util) │
└────────────────────────────────────────────┘
```

### 1) Core Foundation Layer
เป็นรากฐานทั้งหมดของ FE ได้แก่:
- `config.ts` — จัดการ environment ต่าง ๆ
- Logging infrastructure
- Conversation-ID / Correlation-ID generator
- Token helper (get/set/clear tokens)
- Error taxonomy และ error wrapper

ข้อกำหนด:
- ห้าม import จากเลเยอร์บน (one-way dependency)

---

### 2) API Integration Layer
เป็นจุดศูนย์กลางของการติดต่อกับ BE ผ่านฟังก์ชัน `apiFetch` เท่านั้น

หน้าที่:
- แนบ Authorization header (JWT)
- แนบ conversation-id สำหรับ BE Logging
- แปลง error ให้เป็นโครงสร้างเดียวกัน
- รองรับ Observability
- ป้องกันการเรียก fetch ตรงใน UI Layer

---

### 3) Provider Layer
จัดการ Global State และ Logic ที่ใช้ร่วมกันในระบบ เช่น:
- `AuthProvider` — Login, Logout, MFA, Session
- `LayoutProvider` — เปิด/ปิด Sidebar
- `ThemeProvider` — ใช้งาน Theme (อนาคต)

Provider ทำงานก่อนที่ Page จะถูก Render เพื่อ:
- ตรวจสอบ Token
- ตรวจสอบ Session
- Redirect อัตโนมัติเมื่อ Unauthorized

---

### 4) UI Layer (Components + AppShell)
ประกอบด้วย:
- Components พื้นฐาน: Button, Input, Card
- AppShell Layout: Header, Sidebar, Content Container

ข้อกำหนด:
- ไม่เก็บ Business Logic
- ไม่เรียก API โดยตรง
- ไม่จัดการ token โดยตรง

หน้าที่คือ: “แสดง UI และรับ Interaction เท่านั้น”

---

### 5) Page Layer & Feature Modules
ประกอบด้วยหน้าต่าง ๆ ของระบบ เช่น:

```
app/
 ├ (public)/login
 ├ (public)/mfa
 ├ (protected)/dashboard
 └ (protected)/account-security
```

แต่ละ Page ทำหน้าที่:
- รับ Input จากผู้ใช้
- ใช้ Provider และ API Layer ทำงาน
- Render UI ตาม State

ห้าม:
- มี Logic เช่น ตรวจ OTP, validate password strength
- ทำงานที่ควรเป็นหน้าที่ของ Backend

---

## 2.4 Separation of Concerns (SoC)

เพื่อให้สถาปัตยกรรมมีเสถียรภาพ Unicorn กำหนด SoC ดังนี้:

| Layer | หน้าที่ | ห้ามทำ |
|-------|----------|---------|
| UI    | แสดงผล, รับ input | ห้ามเรียก fetch ตรง |
| Provider | จัดการ state | ห้ามตัดสิน business logic |
| API   | ติดต่อ BE | ห้าม render UI |
| Backend | Business Rules | — |

ตัวอย่างสิ่งที่ FE ห้ามทำ:
- ❌ ตรวจสอบว่ารหัสผ่านแข็งแรงหรือไม่  
- ❌ ตัดสินว่าผู้ใช้มีสิทธิ์เข้าหน้าหน่วยงานใด  
- ❌ Validate MFA expiry  

ทั้งหมดต้องให้ BE เป็นผู้ตัดสินตามเอกสาร BE Architecture

---

## 2.5 End-to-End Flow Architecture

### Login + MFA Flow
```
User → /login
   ↓
POST /Auth/login
   ↓ requiresMfa? (Backend decision)
User → /mfa
   ↓
POST /Auth/mfa/verify
   ↓
FE เก็บ accessToken + refreshToken
   ↓
โหลดข้อมูล /Auth/me
   ↓
เข้าสู่ Dashboard
```

### Protected Page Validation
```
User → /dashboard
AuthProvider → ตรวจ token
    ↳ ไม่มี token → redirect /login
    ↳ มี token → โหลด /Auth/me
UI Render → Dashboard
```

---

## 2.6 ความสอดคล้องกับ Backend Architecture

Frontend จะต้อง align กับ BE Architecture ดังนี้:

| หัวข้อ | FE Alignment |
|--------|--------------|
| Security | JWT, Refresh Token, MFA |
| API Contract | ต้องตรง 100% |
| Logging | ส่ง conversation-id ทุก request |
| Observability | FE logs → Browser + DevTools, BE logs → Centralized |
| NFR | p95 < 800ms, UI responsive, Minimal blocking JS |

หาก FE ทำงานไม่สอดคล้องกับ BE อาจเกิด:
- Data inconsistency  
- MFA error flow  
- Audit log trace ไม่ต่อเนื่อง  
- Debugging ยากใน incident  

---

## 2.7 ข้อกำหนดด้าน Maintainability

สถาปัตยกรรมนี้ถูกออกแบบเพื่อ:
- ทีม FE ขยายได้โดยไม่ชนกัน  
- สามารถย้าย Feature ออกเป็น Micro-Frontend ในอนาคต  
- Onboarding developer ใหม่ใน 1–2 วัน  
- ลด Technical Debt ระยะยาว

คุณสมบัติหลัก:
- High Cohesion ในแต่ละโฟลเดอร์
- Low Coupling ระหว่าง Layers
- Clear Responsibility
- Predictable folder structure

---

## 2.8 สรุปบทที่ 2

บทนี้กำหนดภาพรวมสถาปัตยกรรมของ Unicorn Frontend Platform อย่างชัดเจน โดยอธิบายถึง:
- โครงสร้างเลเยอร์ของระบบ  
- หน้าที่และขอบเขตของแต่ละเลเยอร์  
- ความสัมพันธ์กับ Backend Architecture  
- กระบวนการ Flow สำคัญ เช่น Login/MFA  
- หลักการ Separation of Concerns  
- แนวคิด Maintainability และ Scalability  

# บทที่ 3 — Service Blueprint & System Flow

## 3.1 บทนำ
บทนี้สรุป “การทำงานแบบ End-to-End” ของ Unicorn Frontend Platform โดยอธิบาย Flow ที่เชื่อมโยง User → Frontend → Backend → Database พร้อมระบุบทบาทของแต่ละเลเยอร์อย่างชัดเจน จุดมุ่งหมายคือสร้างความเข้าใจร่วมกันระหว่าง FE, BE, QA, DevOps และทีม Security ให้สามารถตรวจสอบ, debug, และออกแบบฟีเจอร์ใหม่ได้อย่างมีมาตรฐานเดียวกัน

Service Blueprint ในบทนี้จะช่วยให้:
- เห็นภาพรวม UX / API / Logic flow
- วิเคราะห์ dependency ระหว่าง FE–BE ได้ถูกต้อง
- ป้องกัน logic mismatch ระหว่างระบบ
- ใช้เป็นเอกสารอ้างอิงในการสร้างฟีเจอร์ใหม่ของ Unicorn

---

## 3.2 หลักการสำคัญของบริษัท
- **Backend คือ Source of Truth**
- **Frontend ไม่มี Business Logic**
- **Communication ต้องปลอดภัย ตรวจสอบได้ และเป็นมาตรฐานเดียวกันทุกโปรเจค**
- **ทุก Request ต้องมี conversation-id เพื่อเชื่อม Event → Log → Trace**
- **Flow ของผู้ใช้ต้องคาดเดาได้ (Predictable UX)**

---

## 3.3 High-Level Service Blueprint
Blueprint ระดับสูงของ Unicorn FE มี 4 เส้นทางหลักที่ต้องรองรับ:

```
User Flow
   ↓
Frontend (UI/Provider/API)
   ↓
Backend API (.NET)
   ↓
Domain Logic & Rules
   ↓
Database (SQL Server)
```

Front-end ทำหน้าที่ “จัดการ UX และ State ชั่วคราว”  
Backend ทำหน้าที่ “ตรวจสอบ กำหนด และตัดสินทุก Business Logic”

---

## 3.4 End-to-End Flow: Authentication (Login → MFA → Session)
Authentication เป็น Flow หลักที่ใช้ทุกโปรเจคของ Unicorn

### 3.4.1 Login Flow Overview
```
User → FE Login Page
  ↓ FE ส่ง loginId/password
POST /api/Auth/login
  ↓ BE ตรวจ user/password
  ↓ BE ตัดสินว่าต้องใช้ MFA หรือไม่
FE redirect → /mfa ถ้าต้องใช้ MFA
```

### 3.4.2 Flow Diagram

```
┌──────────────┐
│  Login Page  │
└──────┬───────┘
       │ loginId/password
       ▼
┌─────────────────────────┐
│  FE → POST /Auth/login  │
└──────────┬──────────────┘
           │
           ▼
┌──────────────────────────────┐
│ Backend AuthService.Login()  │
│  - Validate Credential        │
│  - Check Lockout              │
│  - Check MFA requirement      │
└──────────┬───────────────────┘
           │
   requiresMfa?─────────Yes────────────→ FE redirect /mfa
           │
           No
           │
           ▼
      FE Error
```

### 3.4.3 Output ที่ BE ส่งให้ FE
- กรณี Login ไม่สำเร็จ:
```
{
  "success": false,
  "code": 401,
  "message": "Invalid username or password."
}
```

- กรณี Login สำเร็จแต่ต้อง MFA:
```
{
  "success": true,
  "data": {
    "requiresMfa": true,
    "challengeId": 19,
    "methodType": "email",
    "destinationMasked": "u**************@gmail.com"
  }
}
```

FE ต้องไม่สร้าง field เพิ่มเอง ไม่ตีความเอง ใช้ตาม BE 100%

---

## 3.5 End-to-End Flow: Multi-Factor Authentication (MFA)
### 3.5.1 MFA Flow Overview
```
User → FE MFA Page
  ↓ กรอกรหัส OTP
POST /api/Auth/mfa/verify
  ↓ BE verify OTP
  ↓ BE ออก accessToken + refreshToken
FE เก็บ token และโหลดข้อมูล /Auth/me
```

### 3.5.2 MFA Flow Diagram
```
┌──────────────┐
│   MFA Page   │
└──────┬───────┘
       │ challengeId + OTP
       ▼
┌───────────────────────────────┐
│ FE → POST /Auth/mfa/verify    │
└──────────┬────────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ BE.AuthService.VerifyMfa()   │
│ - verify OTP                 │
│ - check expiry               │
│ - check challenge state       │
└──────────┬───────────────────┘
           │
     Success?─────────No────────→ FE แสดง Error จาก BE
           │
           Yes
           │
           ▼
 FE receives tokens → FE calls /Auth/me → FE redirect /dashboard
```

### 3.5.3 BE Response Example (Success)
```
{
  "success": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresIn": 1800
  }
}
```

FE ต้อง:
- เก็บ token
- reload session
- redirect user → dashboard

---

## 3.6 End-to-End Flow: Protected Route (Session Validation)
Frontend ต้องตรวจสอบ Session ทุกครั้งที่เปิดหน้า protected

### 3.6.1 Flow Summary
```
User → /dashboard
AuthProvider → ตรวจ refreshToken
  ↓
ถ้าไม่พบ → redirect /login
ถ้าพบ → call /Auth/me
  ↓
FE render dashboard
```

### 3.6.2 Flow Diagram
```
┌──────────────────────────────┐
│  FE Protected Page Request   │
└──────────┬────────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ AuthProvider.OnLoad()        │
│ - check refreshToken         │
└──────────┬──────────────────┘
  no token │      yes token
          ▼                     ▼
   redirect /login      call /Auth/me
                              │
                          Success?
                              │
                   Yes────────┴─────→ FE Render Page
                   No
                   │
                   ▼
         clear token → redirect /login
```

---

## 3.7 End-to-End Flow: Logout
### 3.7.1 Flow Summary
```
User → Logout
FE ล้าง token
FE redirect → /login
```

BE ไม่ต้องรู้เรื่อง logout เพราะ FE ใช้ JWT แบบ stateless  
(สอดคล้องกับ Backend Architecture v1.0)

---

## 3.8 Conversational Logging Flow (FE ↔ BE)

### 3.8.1 ความสำคัญของ Conversation-ID
Unicorn ใช้มาตรฐาน Logging เดียวกันทั้ง FE–BE:

```
FE → สร้าง conversationId (UUID)
FE ส่งไปใน Header → x-conversation-id
BE เขียนลง log → ผูกกับ trace/correlation-id
DevOps → ติดตามการทำงานแบบ End-to-End ได้ครบวงจร
```

### 3.8.2 Flow Diagram
```
FE Request → generate conversationId → apiFetch → attach header
BE Middleware → attach traceId → log system → save to observability
```

ผลลัพธ์:  
**ทุก Incident สามารถสืบย้อนกลับได้ 100% ตลอดเส้นทาง FE → BE → DB**

---

## 3.9 Standard Error Flow
FE ต้องใช้ข้อความ error จาก BE เท่านั้น

### FE ห้าม:
- สร้างข้อความ error เอง  
- ตัด logic ว่า error code ไหนหมายถึงอะไร  
- แปลความหมายของ backend message ใหม่  

ตัวอย่าง error:
```
{
  "success": false,
  "code": 21,
  "message": "Challenge already used."
}
```

FE ต้องแสดงตามที่ได้รับ → ห้าม hardcode

---

## 3.10 NFR Flow Requirements (จาก Backend Architecture)
Frontend ต้องรองรับ NFR ที่ BE กำหนด:

| NFR | FE Responsibilities |
|-----|----------------------|
| Performance p95 < 800ms | ลด blocking JS, optimize layout |
| Reliability | ไม่ error แบบ silent, handle NETWORK_ERROR |
| Security | Token storage, no sensitive logs |
| Observability | conversation-id ทุก request |
| Scalability | UI modular, provider based |

---

## 3.11 สรุปบทที่ 3
บทนี้ได้อธิบายการทำงาน End-to-End ของ Unicorn Frontend Platform ครอบคลุมครบทั้ง:

- Login Flow  
- MFA Flow  
- Session Validation  
- Logout  
- Error Flow  
- Logging Flow (conversation-id → trace-id)  
- Alignment กับ Backend Architecture  

Service Blueprint นี้เป็นพื้นฐานของสถาปัตยกรรม Unicorn FE และเป็น Reference หลักของทุกโปรเจคที่บริษัทสร้างในอนาคต

---

# บทที่ 4 — API Standards & Integration Layer

## 4.1 บทนำ (Introduction)

บทนี้กำหนดมาตรฐานการเชื่อมต่อ API ระหว่าง Frontend (Next.js) และ Backend (.NET) ของบริษัท Unicorn เพื่อให้ทุกโปรเจคใช้รูปแบบเดียวกัน 100% ทั้งด้านความปลอดภัย ความสม่ำเสมอ ความง่ายในการตรวจสอบ และการทำงานร่วมกับ Observability ของระบบ

มาตรฐานนี้ครอบคลุมทั้งหมด:

- รูปแบบ Request/Response
- Header พื้นฐานที่ต้องมี
- Error Taxonomy
- มาตรฐาน Logging (conversation-id)
- มาตรฐานการเขียนโค้ด API ทางฝั่ง FE
- ห้ามใช้ fetch ตรง ต้องผ่าน apiFetch เท่านั้น
- การรองรับ MFA, JWT, Refresh Token

---

## 4.2 หลักการออกแบบ (Design Principles)

หลักการหลักของ API Standards:

1) **Predictable**  
โครงสร้าง Response ต้องเป็นรูปแบบเดียวกันทุก Endpoint

2) **Consistent**  
Frontend ทุกโปรเจคต้องใช้ API Layer เดียวกัน ไม่แตกไลน์ ไม่แตกโครงสร้าง

3) **Secure-by-default**  
ทุก Request ต้องปลอดภัย ทั้ง token, headers, logging

4) **Observable**  
ทุกคำขอต้องสามารถติดตามย้อนกลับได้ผ่าน conversation-id

5) **No Business Logic on FE**  
Frontend ไม่มีสิทธิเว้นแต่แสดงผลตาม Backend

---

## 4.3 API Response Standard (Backend → Frontend)

การตอบกลับของ Backend **ต้องเป็นมาตรฐานเดียวกัน**  
Frontend ต้องรองรับแบบนี้เท่านั้น

### 4.3.1 โครงสร้าง Response สำเร็จ

```
{
  "success": true,
  "code": 0,
  "message": "OK",
  "data": { ... },
  "errors": null
}
```

### 4.3.2 โครงสร้าง Response ผิดพลาด

```
{
  "success": false,
  "code": 401,
  "message": "Invalid username or password.",
  "data": null,
  "errors": null
}
```

### 4.3.3 สิ่งที่ FE ห้ามทำ

- ห้ามแก้ไขข้อความ message  
- ห้ามแปลความหมาย code เอง  
- ห้าม override logic จาก Backend  
- ห้ามเดา error เอง – ต้องใช้ error ที่ BE ให้เท่านั้น

---

## 4.4 API Request Standard (Frontend → Backend)

ทุกการเรียก API ต้องผ่าน `apiFetch()`  
และมีโครงสร้างดังนี้:

### 4.4.1 Request Format

```
POST /api/Auth/login
Content-Type: application/json
Authorization: Bearer <token>   (optional, depends on endpoint)
x-conversation-id: <uuid>
x-device-id: <uuid>

{
  "loginId": "string",
  "password": "string"
}
```

### 4.4.2 Required Headers

| Header | รายละเอียด | FE Responsibility |
|--------|-------------|-------------------|
| Authorization | JWT Access Token | FE attach เมื่อ auth = true |
| x-conversation-id | ตัวระบุ request-chain | FE generate ทุก request |
| x-device-id | ระบุอุปกรณ์ | FE generate ครั้งแรกและเก็บถาวร |
| Content-Type | application/json | FE ใส่เสมอ |

ห้ามขาดแม้แต่ค่าเดียวใน Production

---

## 4.5 API Integration Layer (apiFetch)

### 4.5.1 บทบาทของ apiFetch

- ศูนย์กลางการเรียก API ทั้งหมดของ FE  
- ปรับแต่ง header  
- ตรวจสอบ response  
- รวม error taxonomy  
- รวม logging  
- จัดการ token  
- ป้องกันการทำงานที่ไม่สม่ำเสมอในแต่ละ feature  

### 4.5.2 ข้อบังคับ

- **ห้ามใช้ fetch() ตรงในหน้า Page หรือ Component**
- **ทุก API ต้องประกาศใน /src/features/... เท่านั้น**
- **ห้ามประกาศ API ใน UI layer**
- การเขียน API ต้องแยกจาก Provider เสมอ

---

## 4.6 การจัดการ Error (Error Taxonomy)

### 4.6.1 ประเภท Error

| ประเภท | คำอธิบาย | FE Response |
|--------|-----------|--------------|
| NETWORK_ERROR | fetch ล้มเหลว / CORS | แสดงคำเตือน “ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้” |
| API_ERROR | response จาก BE แต่ success=false | แสดง message จาก BE |
| UNAUTHORIZED | Token หมดอายุ / ผิด | redirect /login |
| FORBIDDEN | สิทธิ์ไม่พอ | แสดงหน้าปฏิเสธการเข้าถึง |
| UNKNOWN | error ไม่คาดคิด | แจ้งเตือนและ log |

---

## 4.7 Logging & Observability Integration

### 4.7.1 FE → BE Logging Flow

```
FE → apiFetch
  ↓ generate conversation-id (UUIDv4)
  ↓ attach to headers
BE → log middleware
  ↓ attach trace-id
  ↓ combine log meta
ส่งต่อไป Observability platform 
```

ผลลัพธ์:

- DevOps trace ได้ว่า error รายการนี้เกิดจากผู้ใช้คนใด  
- QA reproduce bug ได้ง่าย  
- BE correlate logs ได้ทันที  
- Support team debug เร็วขึ้น 5–10 เท่า  

### 4.7.2 สิ่งที่ FE ต้อง log

- endpoint  
- method  
- status  
- duration  
- conversation-id  
- response.error (เฉพาะ dev mode)

### 4.7.3 สิ่งที่ FE ห้าม log

- PII  
- password, otp  
- accessToken, refreshToken  
- ข้อมูลของผู้ใช้งานที่ใช้ระบุตัวได้โดยตรง  

---

## 4.8 MFA API Standard

### 4.8.1 Login API

```
POST /api/Auth/login
{
  "loginId": "",
  "password": ""
}
```

Response ที่ต้องรองรับ:

- Invalid Password  
- User Locked  
- MFA required  

### 4.8.2 Verify MFA

```
POST /api/Auth/mfa/verify
{
  "challengeId": 123,
  "code": "123456"
}
```

Response สำเร็จต้องมี:
- accessToken  
- refreshToken  
- tokenType  
- expiresIn  

---

## 4.9 Session Management API Standard

### 4.9.1 /Auth/me (โหลดข้อมูลโปรไฟล์)

```
GET /api/Auth/me
Authorization: Bearer <token>
x-conversation-id: <uuid>
```

Response ต้องมี:

```
{
  "success": true,
  "data": {
    "userId": 1,
    "displayName": "TestUser",
    "status": "active",
    "emailVerified": false,
    "phoneVerified": true
  }
}
```

### FE Responsibility:

- เก็บลง AuthProvider  
- อัปเดต UI  
- รีเฟรช state ที่เกี่ยวข้อง  

---

## 4.10 Best Practices สำหรับการเขียน API ที่ FE

- 1 API = 1 ไฟล์ (ต่อ feature)  
- ทุก API function ต้อง type-safe (TypeScript)  
- ห้ามใช้ any  
- ต้องมี Retry logic เฉพาะกรณี NETWORK_ERROR  
- ต้องรองรับ token expiration  
- ต้องรองรับ MFA flow  

---

## 4.11 ตัวอย่างโครงสร้าง API Layer ที่ถูกต้อง

```
src/
 └ features/
     └ auth/
         ├ api/
         │   ├ login.ts
         │   ├ mfa-verify.ts
         │   └ me.ts
         └ types/
             ├ login.types.ts
             ├ mfa.types.ts
             └ me.types.ts
```

---

## 4.12 สรุปบทที่ 4

บทนี้กำหนดมาตรฐานสำหรับการเชื่อมต่อ API ของ FE โดยรวมถึง:

- โครงสร้าง Request/Response  
- ข้อบังคับการใช้ apiFetch  
- Header ที่ต้องมีทุกครั้ง  
- การจัดการ error แบบ taxonomy  
- Logging ผ่าน conversation-id  
- รูปแบบ API สำหรับ Login / MFA / Session  
- Best Practices สำหรับทีม FE  

มาตรฐานนี้จะทำให้ทุกโปรเจค Unicorn เชื่อมต่อกับ Backend ได้อย่างปลอดภัย มีระเบียบ และตรวจสอบย้อนกลับได้อย่างสมบูรณ์

# บทที่ 5 — Security Architecture (Frontend Security Model)

## 5.1 บทนำ (Introduction)

ความปลอดภัยของระบบ Unicorn ถือเป็นหัวใจสำคัญที่สุดของสถาปัตยกรรมทั้งหมด บทนี้จัดทำขึ้นเพื่อกำหนดรูปแบบการป้องกันด้านความปลอดภัยในระดับ Frontend (Next.js) ให้สอดคล้องกับ Unicorn Backend Architecture v1.0 โดยเน้นแนวคิด:

- Zero Trust Frontend  
- No Business Logic on FE  
- Token-Driven Security  
- MFA Everywhere  
- Security-by-Default + Defense-in-Depth  

Frontend ต้อง **ไม่มี Business Logic ใดๆ** และต้องยึดผลลัพธ์จาก Backend เป็นจริง 100%  
FE ทำหน้าที่ *presentation layer* + *secure client* เท่านั้น

---

## 5.2 บทบาทของ Frontend ในระบบความปลอดภัย

### บทบาทที่ "ต้องทำ"

1) ป้องกัน token (access + refresh) ไม่ให้รั่ว  
2) ตรวจสอบ session ให้ถูกต้องตาม Backend  
3) บังคับ MFA flow ตาม API จาก Backend  
4) แนบ header ความปลอดภัยทุกครั้งที่เรียก API  
5) สร้าง conversation-id สำหรับ Observability  
6) ป้องกันการโจมตีระหว่างฝั่ง Client เช่น input sanitization  
7) ใช้ Next.js App Router + Server Components อย่างถูกต้อง  

### บทบาทที่ "ห้ามทำ"

❌ ห้าม validate business rule (เช่นห้ามตรวจสอบสิทธิ์เอง)  
❌ ห้าม decode JWT เพื่อตัดสินสิทธิ์  
❌ ห้ามเก็บ token ใน localStorage ระยะยาวใน Production  
❌ ห้ามสร้าง logic ตัดสิน MFA เอง  
❌ ห้ามซ่อนข้อมูลธุรกิจไว้ใน FE  
❌ ห้าม bypass BE error หรือเขียน message เอง  

---

## 5.3 Token Security Model

Unicorn ใช้ **JWT Access Token + Refresh Token** ที่ออกโดย Backend เท่านั้น  
Frontend ไม่มีสิทธิ์สร้าง/ดัดแปลง token ใดๆ

### 5.3.1 การเก็บ Token (Storage Strategy)

**DEV Mode:**  
- เก็บใน `localStorage` ได้  
- เหมาะสำหรับ debugging  
- ไม่ใช่ production standard  

**PRODUCTION:**  
ต้องเปลี่ยนเป็น  
- `Secure HttpOnly Cookies` สำหรับ refresh token  
- `in-memory storage` สำหรับ access token  

สาเหตุ:

- ลดความเสี่ยง XSS  
- ป้องกัน token leak  
- ป้องกัน script ภายนอกเข้าถึง  

### 5.3.2 Token Rotation (ตาม Backend Architecture)

FE ต้องรองรับ:

- Automatic token refresh  
- การตรวจจับ token หมดอายุ  
- Redirection → /login เมื่อ refresh token เข้าเงื่อนไข invalid  

---

## 5.4 MFA (Multi-Factor Authentication) Security

### 5.4.1 MFA Flow (ตาม BE Spec)

1) ผู้ใช้ login  
2) Backend ตอบกลับ: `requiresMfa = true`  
3) FE ต้อง redirect → `/mfa`  
4) ผู้ใช้กรอก OTP  
5) FE เรียก `/mfa/verify`  
6) ถ้าถูกต้อง: Backend ส่ง token  
7) FE ตั้งค่า session  

Frontend ห้าม:

❌ สุ่ม/ตรวจสอบ OTP เอง  
❌ ออกแบบ MFA Flow เอง  
❌ ตัดสินใจแทน Backend ว่าควรส่ง OTP หรือไม่  

### 5.4.2 MFA UX Requirement

- ต้องแจ้งผู้ใช้ปลายทาง (email/phone mask)  
- ต้องมีการจำกัดความยาวของรหัส OTP  
- ต้องมีระบบ error message แบบชัดเจนจาก Backend  
- ต้องป้องกัน brute-force UX เช่น delay 1–2 วินาทีเมื่อกรอกผิด  

---

## 5.5 Session Security & Authentication Gateway

### 5.5.1 หน้าที่ของ AuthProvider (Next.js)

AuthProvider ต้องทำ:

- โหลดข้อมูลผู้ใช้ด้วย `/Auth/me`  
- ตรวจสอบสถานะ token  
- ตัดสินใจ redirect เฉพาะ 3 กรณีเท่านั้น:
  - `unauthenticated` → /login  
  - `pending-mfa` → /mfa  
  - `authenticated` → เข้าหน้า protected  

FE ห้ามเดาสถานะเอง

### 5.5.2 Protected Routing Model

เส้นทางทั้งหมดภายใน `/protected/**` ต้อง:

- ตรวจสอบ auth ก่อน render  
- Redirect เมื่อไม่มีสิทธิ์  
- ป้องกันการเข้าถึงผ่าน URL โดยตรง  
- ถือเป็น Internal zone  

---

## 5.6 Security Headers

ทุก API Call ต้องมี:

| Header | ค่า | ความสำคัญ |
|--------|------|-------------|
| Authorization | Bearer <accessToken> | ใช้ระบุตัวตน |
| x-conversation-id | UUID | ใช้ trace logs |
| x-device-id | UUID  | ผูก session กับ device |
| x-req-ts | timestamp | ป้องกัน replay attack (BE optional) |
| Content-Type | application/json | บังคับ |

---

## 5.7 UI-Level Security

แม้ FE ไม่ใช่ security boundary หลัก แต่ยังต้องป้องกัน basic threats

### 5.7.1 ป้องกัน XSS

- ใช้ React escape (default)  
- ห้ามใช้ dangerouslySetInnerHTML  
- Validate input ก่อนใช้งาน  
- Encoding HTML entities เมื่อจำเป็น  

### 5.7.2 ป้องกัน CSRF

- ใช้ `SameSite=Strict` cookie (token refresh strategy)  
- ใช้ JWT + Authorization header ทำให้โจมตียากขึ้น  

### 5.7.3 ป้องกัน Clickjacking

ใน production:

```
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
```

Frontend ต้องตั้งค่า default header ผ่าน Next.js Middleware  

---

## 5.8 Role-Based UI Security

UI ไม่ใช่ source of truth ดังนั้น:

- BE ตัดสินสิทธิ์ (Authorization)  
- FE แค่แสดง/ซ่อน UI ตามข้อมูลจาก `/Auth/me`  
- FE ห้าม hardcode role logic  
- ถ้า BE กล่าวว่า role = admin → FE แสดง UI admin  
- ถ้า BE บอกว่าไม่ใช่ → FE ซ่อนทันที  

---

## 5.9 Error Handling & Security Messages

### 5.9.1 ความจริงที่ต้องเข้าใจ

- ข้อความผิดพลาดคือ **ทรัพย์สินความปลอดภัย**
- ไม่ควรเปิดเผยข้อมูลที่ละเอียดเกินไป
- แต่ต้อง user-friendly

### 5.9.2 Standard Message

| ประเภท | FE ต้องแสดง |
|--------|-------------|
| NETWORK_ERROR | “ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้” |
| UNAUTHORIZED | “กรุณาเข้าสู่ระบบใหม่อีกครั้ง” |
| FORBIDDEN | “คุณไม่มีสิทธิ์เข้าถึงส่วนนี้” |
| API_ERROR | message จาก Backend |

ห้ามแก้ message จาก Backend  

---

## 5.10 Security Observability (FE → BE)

ทุก request ต้อง:

- มีค่าสำหรับการ trace กลับ User  
- ส่งต่อ conversation-id  
- ผูก device-id ตลอดอายุ session  
- ส่ง timestamp  

ผลลัพธ์:

- DevOps วิเคราะห์ปัญหาได้เร็ว  
- Security Team ตรวจสอบ incident ได้แม่นยำ  
- ลดเวลา triage จากหลายชั่วโมง → ไม่ถึง 10 นาที  

---

## 5.11 Dependency Security

มาตรฐาน:

- ห้ามใช้ library แปลกหรือไม่มีการดูแล  
- ห้ามติดตั้ง package ที่ไม่ได้ถูก approve  
- ทุก PR ต้องผ่าน GitHub Dependabot  
- ต้อง run `npm audit --prod` ก่อน deploy  

รายการกลุ่ม package ที่ “ห้ามใช้เด็ดขาด”:

- crypto library ที่ไม่ใช่ Web Crypto API  
- library encode/decode JWT  
- library ที่ยุ่งกับ DOM โดยตรงเช่น jQuery  
- library MFA/OTP ฝั่ง FE  

---

## 5.12 การทดสอบด้านความปลอดภัย (Security Testing)

### 5.12.1 FE Security Checklist

- Token ไม่รั่วใน console  
- ไม่มี sensitive log  
- Refresh Token อยู่ใน cookie เท่านั้น  
- ตรวจสอบ redirect flow ของ MFA  
- ตรวจสอบว่า page protected ปลอดภัยเสมอ  

### 5.12.2 Automated Security Test

- ESLint Security Rules  
- Dependency scan  
- Next.js build analyzer  
- Unit test สำหรับ AuthProvider  

---

## 5.13 สรุปบทที่ 5

บทนี้คือมาตรฐาน “Frontend Security Model” ที่สอดคล้องกับ Unicorn Backend Architecture v1.0 โดยกำหนดหลักการที่ต้องยึดถือเหมือนกันทั้งองค์กร:

- Zero Trust Frontend  
- Strict Token Security  
- MFA-first design  
- API security headers  
- No Business Logic on FE  
- Strong Observability & Tracing  
- Defense-in-Depth ตั้งแต่ UI จนถึง token  

Frontend ทุกโปรเจคต้องนำ Security Model นี้ไปใช้ทันที  
เพื่อให้ระบบ Unicorn มีระดับความปลอดภัยเทียบเท่าองค์กรระดับโลก

# บทที่ 6 — Logging & Observability Architecture (Frontend)

## 6.1 บทนำ (Introduction)

Observability คือความสามารถของระบบในการ “ตรวจสอบย้อนหลังได้อย่างครบวงจร” ตั้งแต่จุดที่ผู้ใช้มี Interaction → Frontend → Backend → Database → Log/Monitoring Platform

Frontend เป็นจุดเริ่มต้นของทุกเหตุการณ์ (Event Origin Point) ดังนั้น FE จึงต้องมีสถาปัตยกรรม Logging แบบเฉพาะตัวเพื่อให้:

- ตรวจสอบปัญหาได้ภายในไม่กี่นาที  
- สามารถเชื่อม Log ระหว่าง FE–BE ได้ 100%  
- ป้องกันข้อมูลรั่วไหล (PII Safe Logging)  
- ทำให้การพัฒนา การ QA และการ Support เร็วขึ้นหลายเท่า  

เอกสารนี้กำหนด Observability Model ของ Unicorn FE ให้เป็นมาตรฐานระดับองค์กร โดยอ้างอิงมาตรฐาน BE Architecture v1.0 ที่ระบุว่า:

> “ทุกคำขอจาก FE → BE ต้องสามารถ trace ได้แบบ End-to-End ผ่าน conversation-id และ correlation-id”

---

## 6.2 เป้าหมายของ Observability (FE Perspective)

1. **Debug incident ได้ภายใน 5–10 นาที**  
2. **Trace Request** ตั้งแต่ UI → FE → BE → DB → Log Platform  
3. **ลด blind spot** ที่ทำให้หาสาเหตุปัญหาไม่ได้  
4. **เชื่อมต่อกับ Back-end Observability model** อย่างไร้รอยต่อ  
5. **ไม่มี PII รั่วไหล** ใน FE log  
6. ให้ Dev, QA, Support สามารถตรวจสอบเหตุการณ์ย้อนหลังอย่างมีระบบ  

---

## 6.3 องค์ประกอบหลักของ Observability (FE Layer)

Unicorn FE ใช้ Observability Model 4 ชั้น:

```
┌──────────────────────────────────────┐
│ 4. User-Level UI Events              │  ← Interaction (click/view/form)
├──────────────────────────────────────┤
│ 3. API-Level Logging (apiFetch)      │  ← Request/Response metadata
├──────────────────────────────────────┤
│ 2. Provider-Level Logging            │  ← AuthProvider / State transitions
├──────────────────────────────────────┤
│ 1. Global Error Boundary             │  ← Uncaught errors
└──────────────────────────────────────┘
```

ทั้ง 4 ชั้นร่วมกันทำให้เกิด Observability ของ FE ที่สมบูรณ์

---

## 6.4 Conversational Logging Architecture (สำคัญที่สุด)

### 6.4.1 concept หลัก
สำหรับ Unicorn:

- FE เป็นผู้ “สร้าง” **conversation-id**
- BE เป็นผู้ “ต่อยอด” ด้วย **trace-id / correlation-id**
- ระบบ Monitoring จะรวม id ทั้งหมดเพื่อสร้าง request timeline

### 6.4.2 รูปแบบ ID

| ID | สร้างโดย | หน้าที่ |
|----|----------|----------|
| conversation-id | FE | เชื่อมทุก request ของ session |
| device-id | FE | ผูก user กับอุปกรณ์ |
| trace-id | BE | ผูก log ของ BE |
| correlation-id | BE | ผูก event chain แบบ distributed |

### 6.4.3 Flow Diagram

```
FE(apiFetch) → generate conversationId (UUID)
  ↓
Headers ส่งไปยัง BE
  ↓
BE middleware → ผูกกับ trace-id
  ↓
Observability Platform → ผสาน log FE + BE
```

ผลลัพธ์:
- QA/Support สามารถหาเหตุการณ์ย้อนหลังได้
- Dev สามารถ trace ปัญหาในระดับ API
- Security สามารถตรวจสอบการใช้งานผิดปกติได้ง่าย

---

## 6.5 FE Logging Model

### FE Logging มี 3 ประเภท:

### 1) **System Log**  
ใช้เฉพาะ info/critical debug ใน dev mode  
ตัวอย่าง:
```
logger.info("API Call", { ... })
```

### 2) **Error Log**  
เกิดเมื่อ API ผิดพลาด / Provider พัง / UI Error  
เช่น:
```
logger.error("API_ERROR", { endpoint, code, message })
```

### 3) **User Action Log** *(Optional for v1)*  
สำหรับระบบที่ต้อง audit UX เช่นระบบธนาคาร  
เช่น:
```
logger.event("click_button", { buttonId: "login_submit" })
```

---

## 6.6 Global Error Boundary (UI-Level Observability)

Next.js ต้องมี **Global Error Boundary** เพื่อจับ:

- Uncaught exceptions  
- Rendering errors  
- UI crash  

โครงสร้าง:

```
app/global-error.tsx
```

หน้าที่:
- แสดง UI error ที่ปลอดภัย
- log error metadata
- ห้ามโชว์ stacktrace ให้ผู้ใช้

---

## 6.7 API Observability (Layer: apiFetch)

### 6.7.1 ต้อง Log อะไร?

| ฟิลด์ | เหตุผล |
|-------|--------|
| endpoint | ใช้ trace ระหว่าง FE/BE |
| method | จำแนก request |
| status | ใช้วิเคราะห์ incident |
| duration | ใช้วัด Performance / NFR |
| conversation-id | เชื่อม FE–BE |
| device-id | ระบุตัวตนอุปกรณ์ |
| requestId | ระบุคำขอระดับ FE |

### 6.7.2 ห้าม Log อะไร?

❌ password  
❌ otp  
❌ email/phone แบบไม่ mask  
❌ access token  
❌ refresh token  
❌ user profile ทั้งก้อน

### 6.7.3 ตัวอย่าง Log (Dev Mode)

```
API Request
{
  "endpoint": "/api/Auth/login",
  "method": "POST",
  "conversationId": "d1b2-...",
  "requestId": "req-34f...",
  "start": 1682112
}

API Response
{
  "status": 200,
  "durationMs": 203,
  "conversationId": "d1b2-..."
}
```

Production mode จะ log เฉพาะ metadata

---

## 6.8 AuthProvider Observability

AuthProvider เป็นจุด critical ที่ต้องมี log ชัดเจน เพราะเกี่ยวข้องกับ:

- Login  
- MFA  
- Session Restore  
- Logout  
- Token Expiry  

### ต้อง log กรณี:

- restore session เริ่มทำงาน  
- restore session สำเร็จ  
- restore session ล้มเหลว  
- mfa pending  
- mfa success / fail  
- logout  

ห้าม log:

- token  
- otp  
- sensitive data  

---

## 6.9 Error Taxonomy Integration

ทุก error ที่เกิดใน FE จะถูกจัดกลุ่มดังนี้:

| ประเภท | ตัวอย่าง | การจัดการ |
|--------|----------|-----------|
| NETWORK_ERROR | fetch failed | UI แจ้ง: “ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้” |
| API_ERROR | BE return success=false | แสดง message จาก BE |
| UNAUTHORIZED | Token invalid | redirect /login |
| FORBIDDEN | ไม่มีสิทธิ์ | แสดง "Access Denied" |
| TIMEOUT | API ช้าเกินกำหนด | แสดงข้อความที่เหมาะสม |
| UNKNOWN_ERROR | error ที่ไม่จัดกลุ่ม | log + แสดง UI ปลอดภัย |

---

## 6.10 Observability สำหรับ Performance

FE ต้องวัด performance หลัก ๆ ดังนี้:

### 1) API Duration  
วัดเวลาตั้งแต่ call → BE → response  
ใช้วิเคราะห์ NFR: “p95 < 800ms”

### 2) Page Load  
หมายถึงเวลาโหลดหน้าแรก  
เป้าหมาย: < 2s

### 3) Interaction Latency  
เช่นกดปุ่มแล้ว UI ตอบสนองภายใน 100ms

---

## 6.11 Session Observability

### การเชื่อมโยง log ระหว่าง session ต้องใช้:

- device-id  
- conversation-id  
- /Auth/me metadata  

ตัวอย่างเหตุการณ์ (Incident Timeline):

```
ConversationID: 91f7...
DeviceID: 8ccb...
▼
Login → MFA → Token
▼
API Error (code=21)
▼
User redirect → /login
```

Support สามารถตรวจสอบได้รวดเร็วมาก

---

## 6.12 Integration กับ Backend Observability Model

### Backend จะ:

- รับ conversation-id  
- สร้าง trace-id  
- สร้าง correlation-id  
- ผูก log ไปยัง Service / Repository / Database  
- ส่งต่อไป Grafana / Elastic / Application Insights (แล้วแต่โปรเจค)

### Frontend ต้อง:

- ส่ง id เสมอ  
- ไม่ส่งข้อมูลส่วนบุคคล  
- ปกปิดข้อมูลใน log UI  

ผลลัพธ์:
**FE log + BE log = Full Request Timeline**

---

## 6.13 Logging Storage & Retention

### FE:
- log อยู่ใน DevTools (เฉพาะ dev mode)
- ไม่เก็บ log ถาวร
- ไม่ส่ง log ไป server โดยตรง (ยกเว้นกรณีมี FE Logging Service ในอนาคต)

### BE:
- เก็บถาวรตามมาตรฐานองค์กร (7–365 วัน)

---

## 6.14 ตัวอย่างโครงสร้าง Logging Library
```
src/lib/logger.ts
src/lib/id-generator.ts
src/lib/error-mapper.ts
src/lib/api-fetch.ts
```

ทุกอย่างถูกออกแบบเพื่อ:
- ปลอดภัย  
- เบา (lightweight)  
- ใช้ง่าย  
- สามารถ extend ได้ในอนาคต  

---

## 6.15 สรุปบทที่ 6

บทนี้ได้กำหนด **มาตรฐาน Observability ของ Unicorn Frontend** ซึ่งรวมถึง:

- Conversational Logging Model  
- การส่ง conversation-id ทุก request  
- UI Error Boundary  
- Provider Logging สำหรับ Auth  
- API Logging ที่ปลอดภัย  
- Error Taxonomy Integration  
- การเชื่อม FE Log → BE Log → ระบบ Observability  
- ข้อบังคับด้าน Security Logging  

ผลลัพธ์ที่ได้:

- ระบบตรวจสอบง่าย  
- Debug incident เร็วขึ้น  
- ลด blind spot ของระบบ  
- Align กับ Backend Architecture v1.0 แบบ 100%  
- พร้อมสำหรับมาตรฐานระดับองค์กร  

# บทที่ 7 — State Management & Provider Architecture

## 7.1 บทนำ (Introduction)
State Management คือหนึ่งในส่วนที่สำคัญที่สุดของ Unicorn Frontend Architecture เพราะเป็นระบบที่ควบคุม “สถานะการทำงานของผู้ใช้และ UI” โดยตรง และเป็นตัวกำหนดความถูกต้อง (Correctness), ความเสถียร (Stability), ความง่ายในการดูแล (Maintainability) และความปลอดภัย (Security) ของ Frontend ทั้งหมด  

สถาปัตยกรรมนี้ถูกออกแบบภายใต้ข้อกำหนดของ **Unicorn Backend Architecture v1.0** ซึ่งกำหนดให้ Backend เป็นผู้ตัดสิน Business Logic ทั้งหมด ในขณะที่ Frontend ทำหน้าที่จัดการ UX + State ของ UI เท่านั้น ไม่ทำ Business Logic ใดๆ

---

## 7.2 หลักการ (Core Principles)

### 1) Single Source of State
State ของแต่ละโดเมนต้องมี “ที่อยู่เดียว” เช่น:
- Auth State → AuthProvider  
- Layout State → LayoutProvider  
- Feature State → Feature Store  
ห้ามมี state ซ้ำหลายที่เพราะจะนำไปสู่ inconsistency

### 2) Zero Business Logic
Frontend ห้ามตัดสินใจแทน Backend เช่น:
- ตรวจสอบ password complexity  
- ตรวจสอบสิทธิ์ของผู้ใช้  
- ตรวจสอบ OTP  
- ตรวจสอบสถานะผู้ใช้  

Backend เป็นผู้ตัดสินทั้งหมด  
FE แค่แสดงผลตามข้อมูลที่ BE ส่งมา

### 3) Provider-First Architecture
Provider คือแหล่ง State กลางระดับระบบ เช่น:
- AuthProvider  
- LayoutProvider  
Provider ต้องมี:
- state  
- method สำหรับอัปเดต state  
- interaction กับ API  

### 4) Predictable State Flow
State ต้องมีลำดับและความหมายชัดเจน เช่น Auth:

```
loading → unauthenticated → pending-mfa → authenticated
```

### 5) No Side Effects in UI Layer
UI ทำหน้าที่แสดงผลเท่านั้น
ห้าม:
- เรียก API ใน UI  
- เปลี่ยน global state ใน UI  
- เก็บ token ใน UI component  

---

## 7.3 สถาปัตยกรรม State ของ Unicorn

Frontend ถูกแบ่งเป็น 3 ระดับของ State:

```
┌──────────────────────────────────┐
│ 3. Application State (Providers) │ ← Auth / Layout / Theme
├──────────────────────────────────┤
│ 2. Feature State (Feature Store) │ ← Order, Notification, Profile
├──────────────────────────────────┤
│ 1. UI Component State            │ ← Modal, Input, Filter
└──────────────────────────────────┘
```

### ระดับที่ 1: UI State  
State ที่อยู่เฉพาะใน component เช่น:
- Modal เปิด/ปิด  
- Input value  
- Active tab  

### ระดับที่ 2: Feature State  
State ของฟีเจอร์ เช่น:
- รายการคำสั่งซื้อ  
- รายการ address  
- รายการ notification  

โครงสร้างไฟล์:
```
src/features/<feature>/store/
```

### ระดับที่ 3: Application State (Global)
State ที่กระทบทั้งระบบ เช่น:
- Auth  
- Layout  
- Theme  

เก็บใน Provider เท่านั้น

---

## 7.4 AuthProvider — หัวใจของ State Management

AuthProvider จัดการทุกอย่างที่เกี่ยวข้องกับผู้ใช้ ได้แก่:

- login  
- MFA  
- token  
- session restore  
- logout  
- user profile  

### โครงสร้าง State

```
{
  status: "loading" | "unauthenticated" | "pending-mfa" | "authenticated",
  user: UserProfile | null,
  challengeId?: number,
  destination?: string
}
```

### State Transition

```
loading → unauthenticated  
loading → authenticated  
unauthenticated → pending-mfa  
pending-mfa → authenticated  
authenticated → unauthenticated (logout)
```

ผู้พัฒนา FE ต้องเข้าใจ Transition นี้อย่างชัดเจน เพราะคือแกนกลาง UX ของระบบ Unicorn

---

## 7.5 LayoutProvider — UI Structure State

ใช้เก็บสถานะ UI เช่น:
- sidebar เปิด/ปิด  
- theme (dark/light)  
- active navigation  

ตัวอย่าง State:

```
{
  sidebarOpen: true,
  theme: "light"
}
```

ข้อห้าม LayoutProvider:
- ห้ามเรียก API  
- ห้ามเก็บข้อมูลผู้ใช้  
- ห้ามเก็บ business logic  

---

## 7.6 Feature State — แยกตามฟีเจอร์อย่างถูกต้อง

ตัวอย่าง Feature:
- Order  
- Profile  
- Notification  
- Settings  

แต่ละฟีเจอร์ต้องแยกโครงสร้างแบบนี้:

```
src/features/<name>/
   api/
   components/
   store/
   hooks/
```

Feature State ต้อง:
- เก็บใน store ของ feature นั้น  
- ห้ามเขียน state ข้ามฟีเจอร์  
- ห้ามแก้ไข Auth/Global State  

---

## 7.7 ตัวอย่างโครงสร้าง Providers

```
src/providers/
   ├── auth-provider.tsx
   ├── layout-provider.tsx
   └── app-provider.tsx
```

`app-provider.tsx` ต้องรวม provider ทั้งหมด เช่น:

```
<AuthProvider>
  <LayoutProvider>
    {children}
  </LayoutProvider>
</AuthProvider>
```

Provider ที่สำคัญที่สุด (AuthProvider) ควรอยู่ระดับบนสุด

---

## 7.8 Interaction Model ระหว่าง UI ↔ Provider ↔ API

### 1) Login Flow  
1. UI ส่ง loginId/password  
2. Provider เรียก API: /Auth/login  
3. Provider เปลี่ยน state ตาม response  
4. UI แสดงผลทันที  

### 2) MFA Flow  
1. UI ป้อน OTP  
2. Provider เรียก API: /Auth/mfa/verify  
3. Provider ตั้ง token  
4. Provider โหลด /Auth/me  
5. UI redirect → dashboard  

### 3) Protected Page  
1. User เปิดหน้า  
2. Provider ตรวจ refresh token  
3. หากไม่มี → redirect /login  
4. หากมี → call /Auth/me  
5. UI render  

---

## 7.9 Anti-Patterns (ห้ามทำเด็ดขาด)

| Anti-pattern | เหตุผล |
|--------------|--------|
| เรียก API ใน UI Component | ทำให้โค้ดซ้ำซ้อน/ดูแลยาก |
| เก็บ token ใน UI หรือ local state | ไม่ปลอดภัย |
| เขียน Business Logic ใน Provider | ขัดกับ BE Architecture |
| ใช้ Provider สำหรับทุกอย่าง | ทำให้ re-render มาก |
| ฟีเจอร์หนึ่งแก้ state ของฟีเจอร์อื่น | เกิด coupling สูง |

---

## 7.10 Observability ใน Provider Layer

Provider ต้อง log เฉพาะ metadata ที่ไม่ใช่ PII เช่น:

ต้อง log:
- session restore start  
- session restore success/fail  
- login success/fail  
- mfa success/fail  
- logout  

ห้าม log:
- token  
- otp  
- password  
- email/phone เต็ม  

---

## 7.11 สรุปการออกแบบ State

- Provider = global application state  
- Feature Store = state ของฟีเจอร์  
- UI State = state ของ component  
- Provider ไม่มี business logic  
- State transition ต้อง predictable  
- ฟีเจอร์แยก domain อย่างชัดเจน  
- ทุกอย่าง align กับ Backend Architecture v1.0  

---

## 7.12 สรุปบทที่ 7

บทนี้กำหนดสถาปัตยกรรม State Management ของ Unicorn อย่างครบถ้วน:

- โครงสร้าง 3 ระดับของ state  
- Provider-first Architecture  
- AuthProvider, LayoutProvider, Feature Store  
- หลักการ Zero Business Logic  
- แนวทาง interaction FE ↔ API ↔ State  
- Anti-patterns ที่ต้องหลีกเลี่ยง  
- ความสอดคล้องกับ Backend Architecture v1.0  
- Logging & Observability ใน State Layer  

นี่คือมาตรฐานหลักที่ทำให้ระบบ Unicorn สามารถเติบโต สเกลขึ้น และบำรุงรักษาได้เป็นปีๆ โดยไม่เกิดปัญหาเชิงสถาปัตยกรรม

# บทที่ 8 — UI/UX Architecture & AppShell Layout

## 8.1 บทนำ (Introduction)
UI/UX Architecture คือ “โครงร่างประสบการณ์ผู้ใช้” ของ Unicorn Frontend Platform ทั้งหมด เป็นส่วนที่ผู้ใช้มองเห็นและสัมผัสโดยตรง และเป็นส่วนที่มีผลต่อคุณภาพการใช้งานมากที่สุด ทั้งในด้านความเร็ว ความง่าย ความสวยงาม ความถูกต้อง และความสม่ำเสมอ

บทนี้กำหนดมาตรฐาน UI/UX ระดับองค์กร (Enterprise UX Standard) ที่ทุกโปรเจคต้องปฏิบัติตาม โดยมีเป้าหมาย:

- ให้ทุกระบบของ Unicorn มีหน้าตาและการใช้งานที่สอดคล้องกัน  
- ลดเวลาออกแบบ UI ในโปรเจคใหม่ลง 50–70%  
- ทำให้ทีม FE/BE/QA/Support เข้าใจ Flow และ Behavior ตรงกัน  
- รองรับการขยาย (Scalable UX) ในระยะ 5–10 ปี  
- สอดคล้องกับ Backend Architecture v1.0 ในประเด็น Security, Error Handling, MFA  

AppShell Layout คือ “โครง UI หลัก” ของระบบ และถือเป็นหัวใจของบทนี้

---

## 8.2 หลักการ UI/UX Architecture ของ Unicorn (Core Principles)

### 1) Consistency First  
ทุกโปรเจคต้องใช้รูปแบบ UI เดียวกัน:  
- หน้าตาของ Header, Sidebar  
- ระยะห่าง (Spacing)  
- ขนาดตัวอักษร  
- สไตล์ปุ่ม  
- สไตล์ฟอร์ม  
ความสม่ำเสมอทำให้ระบบใช้ง่ายขึ้น เรียนรู้น้อยลง และช่วยลด bug จาก UI logic ที่ไม่ตรงกัน

### 2) AppShell as the Foundation  
AppShell Layout คือ “รากฐาน UI” ของทุกหน้า  
ห้ามแต่ละหน้าสร้าง layout เอง เพราะจะทำให้ระบบแตกออกเป็นหลายสไตล์

### 3) UX Predictability  
การใช้งานต้อง “เดาได้” เช่น:
- ปุ่มยืนยัน = อยู่ขวาล่างเสมอ  
- ปุ่มยกเลิก = อยู่ซ้าย  
- Error message = ใต้ input  
- Loading = มี skeleton หรือ spinner ที่ตำแหน่งเหมาะสม  

### 4) Zero Business Logic in UI  
Frontend แสดงผลเฉพาะตามข้อมูลจาก Backend เท่านั้น  
UI ไม่ควรคิดเองว่าผู้ใช้มีสิทธิ์ หรือข้อมูลนี้ถูกหรือผิด

### 5) Accessibility Friendly (A11y)  
- input-focus ชัด  
- ปุ่มกดด้วยคีย์บอร์ดได้  
- สี contrast พอเหมาะ  

### 6) Security-by-Design  
- Mask PII บน UI  
- ไม่ render HTML ที่ไม่ได้ sanitize  
- หลีกเลี่ยง inline script/style  

---

## 8.3 การแบ่งชั้น UI/UX Architecture (UI Layering)

สถาปัตยกรรม FE แบ่งเลเยอร์ UI ออกเป็น 3 ขั้น:

```
┌──────────────────────────────────┐
│ 3. Page UI & User Flow           │  ← login, dashboard, profile
├──────────────────────────────────┤
│ 2. AppShell Layout Layer         │  ← header, sidebar, container
├──────────────────────────────────┤
│ 1. Component Layer (UI Library)  │  ← button, input, modal
└──────────────────────────────────┘
```

### ความสัมพันธ์ของแต่ละชั้น
- **Component Layer** = ส่วนประกอบ UI พื้นฐาน  
- **AppShell Layout** = รากฐานโครง UI ของทุกหน้า  
- **Page UI** = ใช้ component และอยู่ภายใน AppShell

แยกเลเยอร์แบบนี้ทำให้ UI ดูแลง่าย และเพิ่มฟีเจอร์ใหม่ได้โดยไม่กระทบ layout ทั้งระบบ

---

## 8.4 AppShell Layout Architecture (หัวใจของบทนี้)

AppShell คือ layout หลักที่ล้อมทุกหน้า (protected pages)

โครงสร้าง:

```
<AppShellLayout>
  <AppHeader />
  <AppSidebar />
  <AppContent>{children}</AppContent>
</AppShellLayout>
```

### AppHeader ประกอบด้วย:
- Logo  
- ชื่อระบบ  
- User menu (profile, logout)  
- Notification icon  
- Global navigation (optional)  

### AppSidebar ประกอบด้วย:
- Menu (สร้างจาก Navigation Model)  
- Grouping ของเมนูตามฟีเจอร์  
- Role-based UI (ซ่อนเมนูที่ BE บอกว่าไม่ให้เห็น)

### AppContent
พื้นที่แสดงผลของแต่ละหน้า เช่น dashboard, account, reports

---

## 8.5 Navigation Model & Menu Structure

Unicorn ใช้ Navigation แบบ “Config-driven”

```
src/config/navigation.ts
```

เช่น:

```
[
  {
    label: "Dashboard",
    icon: "home",
    path: "/dashboard"
  },
  {
    label: "Account",
    children: [
      { label: "Security", path: "/account/security" },
      { label: "Password", path: "/account/password" }
    ]
  }
]
```

### ข้อดีของการใช้ Navigation Model
- เปลี่ยนเมนูได้โดยไม่ต้องแก้ layout  
- ปรับเมนูตาม role ของผู้ใช้ได้ง่าย (ตาม backend)  
- สามารถนำไป reuse ได้ทุกโปรเจค  

---

## 8.6 Component Architecture (UI Library Model)

Component ของ Unicorn ต้องถูกแยกตามหมวด:

```
src/components/
   ui/
     - Button.tsx
     - Input.tsx
     - Select.tsx
     - Alert.tsx
     - Card.tsx
   layout/
     - AppShellLayout.tsx
     - Sidebar.tsx
     - Header.tsx
   navigation/
     - NavItem.tsx
```

### คุณสมบัติของ component ที่ดี:
- Stateless  
- Reusable  
- Props ชัดเจน  
- ไม่มี business logic  
- ไม่มี API call  
- ไม่มี token processing  

Component มีหน้าที่ “แสดงผลและ interaction เท่านั้น”

---

## 8.7 Form Architecture & Validation Pattern

หลักการออกแบบ Form ของ Unicorn:

### 1) Label ต้องอยู่บน input  
### 2) Error message ต้องอยู่ใต้ input  
### 3) Submit ด้วยปุ่มขวาล่างเสมอ  
### 4) Validation มี 2 ระดับ:
- UI-level (required, length, format)  
- Backend-level (business validation)

### 5) Error จาก Backend ต้องแสดงตาม message ที่ Backend ส่ง  
Frontend **ห้ามตีความ error เอง**

---

## 8.8 Loading State / Error State / Empty State

เพื่อให้ UX ชัดเจน ทุกฟีเจอร์ต้องรองรับ 3 สถานะนี้:

### 1) Loading State
ใช้ skeleton หรือ spinner  
ห้ามให้หน้า “ว่างเปล่าแบบไม่มีอะไรเลย”

### 2) Error State
แสดงเป็น Alert เช่น:

```
<Alert type="error" message="ไม่สามารถโหลดข้อมูลได้" />
```

### 3) Empty State
เช่น:

```
<EmptyState 
  title="ยังไม่มีข้อมูล"
  description="เริ่มต้นสร้างข้อมูลได้เลย"
/>
```

UX ต้องชัดเจนทุกสถานะ

---

## 8.9 Responsive Architecture

Unicorn เน้น Desktop-first  
แต่รองรับ Tablet และ Mobile แบบ minimal

หลักการ:
- Sidebar ซ่อนอัตโนมัติใน mobile  
- Header ยุบลง  
- Table ต้อง scoll ได้ในแนวนอน  

---

## 8.10 Security in UI (UX-Level Security)

Frontend ต้องปฏิบัติตาม Security จากบทที่ 5:

- Mask PII บน UI เช่น email → a******@gmail.com  
- ห้าม render HTML โดยตรง  
- ห้ามแสดงข้อมูลที่ backend ไม่อนุญาต  
- Role-based UI ต้องอ้างอิงจากข้อมูล `/Auth/me`  
- ปุ่ม logout อยู่ที่ user menu เสมอ  

---

## 8.11 UX Guardrails (ข้อบังคับ UX)

เพื่อความสม่ำเสมอระดับองค์กร:

### ห้าม
❌ ปุ่มเกิดซ้ำหลายตำแหน่ง  
❌ ใช้สีนอกมาตรฐาน theme  
❌ ใส่ข้อความ error เอง  
❌ ตั้งชื่อปุ่มแบบไม่สื่อความหมาย  
❌ Modal ซ้อน Modal  

### ต้องทำ
✔ ปุ่มหลักต้องชัดเจน  
✔ ใช้ spacing เดียวกันตลอดโครงการ  
✔ ใช้ component จาก UI library เดียวกัน  
✔ แสดง loading state ทุกจุดที่ใช้เวลา  
✔ ใช้คำไทยที่เข้าใจง่าย  

---

## 8.12 UX Checklist (สำหรับทีม FE/QA)

### Layout
- [ ] AppShell ถูกใช้ทุกหน้าใน protected  
- [ ] Sidebar/menu แสดงถูกต้องตาม role  
- [ ] Header แสดงข้อมูลผู้ใช้ถูกต้อง  

### UX
- [ ] Form ใช้งานง่าย  
- [ ] Error ชัดเจน  
- [ ] Loading state ถูกที่  
- [ ] ไม่เกิด jump layout  

### Security
- [ ] PII mask  
- [ ] ไม่แสดงข้อมูลที่ไม่ควรเห็น  
- [ ] ไม่มี role logic ใน FE  

---

## 8.13 สรุปบทที่ 8

บทนี้กำหนด UI/UX Architecture ของ Unicorn ที่ประกอบด้วย:

- AppShell Layout (แกนกลาง UI ของระบบ)  
- Navigation Model แบบ config-driven  
- Component Architecture ที่ชัดเจน  
- Form UX Pattern ที่สม่ำเสมอ  
- Loading/Error/Empty State มาตรฐานเดียว  
- UX Guardrails เพื่อให้ UI ใช้งานง่ายและสม่ำเสมอ  
- การ align กับ Security / Backend Architecture  

UI/UX Architecture นี้ทำให้ระบบ Unicorn สามารถพัฒนา รักษา และขยายในระดับองค์กรได้ โดยไม่สูญเสียคุณภาพหรือสไตล์ของแบรนด์

# บทที่ 9 — Non-Functional Requirements (Frontend NFR)

## 9.1 บทนำ (Introduction)
Non-Functional Requirements (NFR) คือ “กฎเหล็ก” ที่กำหนดคุณภาพของระบบ Unicorn Frontend ในระดับองค์กร ไม่ใช่เพียงว่า “ระบบทำงานได้” แต่ต้อง “ทำงานได้ดี เสถียร ปลอดภัย และรองรับการเติบโต” ทั้งในวันนี้และอนาคตอีกหลายปี  

NFR คือสิ่งที่แยก “ระบบธรรมดา” ออกจาก “สถาปัตยกรรมระดับ 0.1%”  
Frontend Platform ของ Unicorn ต้องผ่านมาตรฐานนี้ทุกข้อ เพื่อให้คุณภาพของทั้งบริษัทเป็นระดับเดียวกันกับ Backend Architecture v1.0 ที่กำหนดมาตรฐานแบบ Enterprise-grade เอาไว้แล้ว

---

## 9.2 หมวดหมู่ NFR ของ Unicorn Frontend
NFR ถูกแบ่งออกเป็น 7 หมวดหลัก:

1) **Performance (ความเร็ว)**  
2) **Reliability & Stability (ความเสถียร)**  
3) **Security (ความปลอดภัย)**  
4) **Scalability (การรองรับการขยายตัว)**  
5) **Maintainability (ความง่ายในการดูแลรักษา)**  
6) **Usability & UX (ความง่ายในการใช้งาน)**  
7) **Observability (ความสามารถในการตรวจสอบ)**

แต่ละข้อมีผลต่อคุณภาพของระบบอย่างรุนแรง ไม่สามารถละเว้นได้ในโปรเจคจริง

---

## 9.3 Performance Requirements — ระบบต้อง “เร็วอย่างมีเหตุผล”

### 9.3.1 Metrics หลัก
| ตัวชี้วัด | ค่าเป้าหมาย |
|----------|--------------|
| **API Response (p95)** | **< 800ms** (สอดคล้องกับ BE NFR) |
| **Page Load (LCP)** | **≤ 2.5 วินาที** |
| **First Interaction Delay** | ≤ 100ms |
| **UI Re-render time** | < 16ms (60fps UX) |

### 9.3.2 ข้อบังคับทางสถาปัตยกรรม
- ห้ามทำงานหนักใน UI thread  
- ห้ามทำ loop ใหญ่ใน component  
- ต้องใช้ Suspense/Loading Skeleton  
- API ต้องประมวลผลนอก UI layer  
- ใช้ caching ที่ provider/feature store (ถ้าเหมาะสม)  

---

## 9.4 Reliability & Stability Requirements

### 9.4.1 ความเสถียรของระบบ
- Session ต้องกู้คืนได้เสมอ (restore session)  
- UI ไม่ crash โดยไม่มี Error Boundary  
- ต้องมี Graceful Failure เช่น network ล่ม → error message ชัดเจน  
- Interaction ต้องไม่หาย เช่นปุ่ม double-click ต้องป้องกัน  

### 9.4.2 กรณีที่ระบบต้องรองรับ
- Network delay  
- Token หมดอายุ  
- Refresh token invalid  
- API ภายในพัง  
- ไม่สามารถติดต่อ backend ได้  

ทุกกรณีระบบต้อง “ทำงานแบบปลอดภัย” (Safe Mode)

---

## 9.5 Security Requirements (FE Perspective)
Frontend ต้องสอดคล้องกับบทที่ 5 และ Backend Architecture v1.0

### 9.5.1 ข้อบังคับหลัก
- เก็บ token อย่างปลอดภัย (DEV = localStorage / PROD = HttpOnly cookie + memory)  
- ห้ามทำ Business Logic  
- ห้าม decode JWT เพื่อใช้ตัดสินสิทธิ์  
- ต้อง mask ข้อมูล PII  
- ต้องตรวจสอบ role จาก backend เท่านั้น  
- ต้องป้องกัน XSS, CSRF, Clickjacking  

### 9.5.2 Requirement เฉพาะ Unicorn
- ห้ามมี console.log ที่เกี่ยวกับข้อมูลผู้ใช้  
- ห้ามแสดงข้อมูล BE โดยไม่ sanitize  
- ต้องติด conversation-id ทุก request  
- ห้าม log otp/password/token  

---

## 9.6 Scalability Requirements
Frontend ต้องรองรับการขยายอย่างรวดเร็ว ทั้งจำนวนผู้ใช้และจำนวนฟีเจอร์

### 9.6.1 สถาปัตยกรรมต้องรองรับ:
- หน้าหลักหลายสิบหน้า  
- ฟีเจอร์หลายโมดูล  
- ทีมพัฒนา 3–10 คนต่อโปรเจค  
- การ reuse ข้ามโปรเจค 50%–70%  
- การแยกเป็น micro-frontend ในอนาคต (optional)

### 9.6.2 ข้อบังคับเพื่อให้รองรับการขยาย
- Provider-first architecture  
- Feature-based directory structure  
- API Layer เดียวทั้งองค์กร  
- UI Component Library เดียวกันทุกโปรเจค  
- Navigation แบบ config-driven  

---

## 9.7 Maintainability Requirements (ดูแลง่าย)
### 9.7.1 โครงสร้างโค้ดต้อง:
- predictable  
- module-based  
- low coupling  
- high cohesion  
- อ่านง่าย  
- ห้ามไฟล์ยาวเกิน 500 บรรทัด  
- แยก concerns ชัดเจน (UI / Provider / API / Store)

### 9.7.2 Code Style
- ใช้ TypeScript 100%  
- ห้ามใช้ any  
- ต้องมี type ของ request/response ทุก API  
- ใช้ ESLint + Prettier  
- ห้ามใช้ function ที่ไม่มี type  

---

## 9.8 Usability & UX Requirements

### 9.8.1 ต้องผ่าน UX Standards บทที่ 8
- Layout เสถียร ไม่ขยับกระตุก  
- Loading state ต้องมีทุกจุด  
- Error ต้องชัดเจนและไม่กระทบ experience  
- Form ต้องกรอกง่าย  
- ปุ่มหลักต้องเด่น  
- เนื้อหาต้องอ่านง่ายบนทุกขนาดหน้าจอ  

### 9.8.2 ภาษาและข้อความ
- ใช้ภาษาไทยเป็นหลัก  
- ใช้ศัพท์ที่เป็นมิตร  
- Error message ใช้ข้อความจาก backend  
- ห้ามใช้ข้อความกำกวม เช่น “มีบางอย่างผิดพลาด” โดยไม่บอกวิธีแก้

---

## 9.9 Observability Requirements
Observability คือ NFR ที่สำคัญที่สุดสำหรับระบบองค์กร

### 9.9.1 FE ต้อง log:
- api request/response (metadata)  
- session restore  
- login/mfa/logout  
- provider state transition  
- global errors  
- navigation error  
- conversation-id  

### 9.9.2 FE ห้าม log:
- token  
- password  
- otp  
- PII  
- email/phone แบบไม่ mask  

### 9.9.3 การเชื่อมต่อ Observability FE ↔ BE
- FE สร้าง conversation-id  
- BE สร้าง trace-id  
- ระบบรวม log ทั้งหมดบนแพลตฟอร์มเดียว  
- รองรับการสืบเหตุการณ์ (Incident Trace) แบบ End-to-End  

---

## 9.10 Progressive Enhancement Requirements
แม้ระบบ Unicorn จะเน้น SPA/SSR แต่ต้องทำงานได้อย่างปลอดภัยเมื่อ:

- network ช้า  
- backend ช้า  
- API ล้มชั่วคราว  
- UI บางส่วนโหลดไม่ทัน  

FE ต้อง degrade gracefully:  
- แสดง error ที่เหมาะสม  
- ไม่ crash  
- ไม่ปล่อย UI กลายเป็นหน้าขาว  

---

## 9.11 Accessibility (A11y) Requirements
Frontend ต้องเป็นมิตรกับผู้ใช้ทุกกลุ่ม

- ปุ่มต้องเข้าถึงด้วยคีย์บอร์ด  
- input-focus ชัดเจน  
- contrast ผ่านเกณฑ์ WCAG AA  
- aria-label สำหรับ icon button  
- modal ปิดด้วย ESC ได้  

---

## 9.12 Compatibility Requirements
ระบบต้องทำงานบน:

- Chrome (ล่าสุด + 3 เวอร์ชัน)  
- Edge (ล่าสุด + 3 เวอร์ชัน)  
- Safari เวอร์ชันหลัก  
- Mobile Safari / Chrome (รองรับขั้นต่ำ)  
- Resolution ≥ 1280px (Desktop-first)  

---

## 9.13 Operational Requirements
- FE build ต้องใช้เวลาน้อยกว่า 60 วินาที  
- deploy pipeline ต้องไม่พังง่าย  
- error ต้องถูกส่งเข้า monitoring  
- release ต้อง reversible (rollback ได้ทันที)  

---

## 9.14 สรุปบทที่ 9
บทที่ 9 คือมาตรฐาน Non-Functional Requirements ของ Unicorn Frontend Platform ซึ่งเป็นตัวกำหนดคุณภาพในระดับองค์กร ครอบคลุม:

- Performance (<800ms p95)  
- Reliability (UI ไม่ crash)  
- Security (สอดคล้องกับ BE 100%)  
- Scalability (รองรับฟีเจอร์จำนวนมาก)  
- Maintainability (โค้ดอ่านง่าย ดูแลง่าย)  
- Usability (UX ดีในทุกสถานการณ์)  
- Observability (trace ได้ครบวงจรด้วย conversation-id)  

NFR เหล่านี้คือกฎที่ทุกโปรเจคของ Unicorn ต้องทำตามอย่างเคร่งครัด เป็นฐานสำคัญที่ทำให้ระบบมีความเสถียร ปลอดภัย สามารถตรวจสอบได้ และส่งมอบประสบการณ์ที่ยอดเยี่ยมแก่ผู้ใช้


### 10.4.3 API ห้ามมี business logic
- ตัวมันเองมีหน้าที่ส่ง request → รับ response  
- ไม่ตัดสินใจ ไม่ตีความ message  

---

## 10.5 UI Development Standards

### 10.5.1 Component Design
- Stateless, Pure  
- ไม่มี API call  
- ไม่มี provider injection  
- Props ชัดเจน  
- ไม่เก็บ token  
- ไม่เก็บ business data  

### 10.5.2 Form Standard
- label อยู่บน input  
- error อยู่ใต้ input  
- button “ยืนยัน” อยู่ด้านขวา  
- button “ยกเลิก” อยู่ด้านซ้าย  
- validation UI: required/format  
- validation business ต้องมาจาก backend  

### 10.5.3 Layout Standard
- ต้องใช้ AppShellLayout ในหน้า protected  
- ห้ามสร้าง layout ใหม่เอง  
- Navigation ต้องใช้ config เดียวกัน  

---

## 10.6 Security Best Practices

### 10.6.1 ห้าม log ข้อมูลอ่อนไหว
- password  
- otp  
- access token  
- refresh token  
- email/phone แบบไม่ mask  

### 10.6.2 Token Safety
- Dev → localStorage ได้  
- Prod → HttpOnly Cookies + In-memory only  
- ห้ามเก็บ token ใน Redux, Zustand, หรือ provider  

### 10.6.3 Role & Permission
- FE ห้าม decode role จาก JWT  
- backend ต้องส่งข้อมูลสิทธิ์ที่ถูกต้อง  
- UI แสดงเฉพาะสิ่งที่ BE อนุญาต  

---

## 10.7 Testing Standards

### 10.7.1 Unit Test
- ต้องมีสำหรับ provider สำคัญ  
- ต้องทดสอบ state transition  
- ห้ามทดสอบ UI logic ส่วนธุรกิจ  

### 10.7.2 Integration Test
- ทดสอบ API → Provider → UI  
- MFA flow ต้องทดสอบครอบคลุมทั้งหมด  

### 10.7.3 E2E Test
- Cypress / Playwright สำหรับ flow สูงสุด
  - login  
  - MFA  
  - protected page  
  - logout  

---

## 10.8 Performance Best Practices

- ห้าม re-render component โดยไม่จำเป็น  
- ใช้ `React.memo` เฉพาะจุด  
- หลีกเลี่ยง useEffect ที่ทำงานบ่อย  
- preload / prefetch route ที่ใช้งานบ่อย  
- ใช้ Suspense/Loading Components  
- ใช้ skeleton loading และไม่กระตุก (UX Smooth)  

---

## 10.9 Error Handling Best Practices

### FE ต้องรองรับ Error Taxonomy:
- NETWORK_ERROR  
- API_ERROR  
- UNAUTHORIZED  
- FORBIDDEN  
- TIMEOUT  
- UNKNOWN_ERROR  

### กฎที่ต้องยึดถือ:
- ใช้ message จาก backend  
- ห้ามเดา error เอง  
- ต้องมี Error Boundary ระดับ UI  
- Provider ต้องแยก error ให้ถูกประเภท  

---

## 10.10 Code Review Standards (CR Rules)

### ห้าม Approve PR ถ้าเจอ:
- โค้ดไม่มี type  
- ใช้ any  
- เรียก API จาก component  
- duplicate code  
- ไม่มี error handling  
- ไม่ใช้ apiFetch  
- log token หรือ PII  
- PR ใหญ่เกิน 500 บรรทัด  
- ไม่มี unit test ของ provider ที่เปลี่ยน logic  

### ต้องตรวจสอบ:
- state transition ถูกทุกข้อ  
- UX ตามมาตรฐานบทที่ 8  
- security ตามบทที่ 5  
- logging pattern ตามบทที่ 6  

---

## 10.11 Deployment Best Practices

### 10.11.1 Build Rules
- build ต้อง <= 60 วินาที  
- tree shaking ต้องเปิด  
- image optimization ต้องเปิด  

### 10.11.2 Environment Rules
- ห้าม commit `.env.local`  
- ห้ามใช้ config แบบ hardcode  
- ต้องใช้ config จาก `src/config/env.ts`  

### 10.11.3 Monitoring
- FE errors ต้อง link กับ BE logs ผ่าน conversation-id  
- SPA error / router error ต้องถูกจับทั้งหมด  

---

## 10.12 Developer Workflow Standard

มาตรฐานการพัฒนาของนักพัฒนา Unicorn:

1) Pull code ล่าสุด  
2) ตั้ง environment  
3) สร้าง branch ใหม่  
4) เขียน feature พร้อม provider/api/component  
5) เขียน unit test  
6) Run test + lint  
7) สร้าง PR  
8) รอ Code Review  
9) แก้ตาม feedback  
10) Merge → Deploy pipeline  

Workflow นี้ช่วยให้ทีมหลายคนทำงานร่วมกันอย่างราบรื่นโดยไม่ทับกัน

---

## 10.13 Summary — สิ่งที่เป็น “กฎเหล็ก” ของ Unicorn FE

- FE ห้ามมี business logic  
- ต้องใช้ provider-first architecture  
- ต้องใช้ app-shell layout  
- ต้องใช้ apiFetch ทุกครั้ง  
- ต้องใช้ TypeScript 100%  
- ห้าม log ข้อมูลอ่อนไหว  
- ต้องรองรับ error taxonomy  
- ต้อง mask PII  
- ทุก request ต้องมี conversation-id  
- ต้อง align 100% กับ Backend Architecture v1.0  

---

## 10.14 สรุปบทที่ 10
บทนี้กำหนด Development Standards & Best Practices ของ Unicorn Frontend Platform อย่างครบถ้วน ซึ่งเป็น “กฎระดับองค์กร” เพื่อให้ระบบ FE ทุกโปรเจคมีคุณภาพระดับเดียวกัน:

- Coding Standards  
- Project Structure  
- API Development Model  
- UI/UX Best Practices  
- Security Best Practices  
- Testing Standards  
- Performance Rules  
- Deployment Standards  
- Code Review Workflow  
- Developer Workflow  

# บทส่งท้าย — คำกล่าวปิดเอกสาร Unicorn Frontend Architecture v1.0

เอกสาร **Unicorn Frontend Architecture v1.0** ฉบับนี้ไม่ใช่เพียงคู่มือเทคนิคของทีม FE แต่เป็น “สัญญาร่วมกันของทั้งองค์กร” ว่าระบบที่เราออกแบบ สร้าง และส่งมอบให้ลูกค้า จะยืนอยู่บนมาตรฐานเดียวกัน—มั่นคง เสถียร ปลอดภัย และรองรับอนาคต ไม่ว่าระบบจะเติบโตแค่ไหนหรือทีมจะเปลี่ยนมือกี่ครั้งก็ตาม

สถาปัตยกรรมนี้สะท้อนหลักการสำคัญของบริษัท Unicorn:

- **ความถูกต้องเหนือความเร็ว**  
- **ความปลอดภัยเหนือความสะดวก**  
- **ความสม่ำเสมอเหนือความแตกต่าง**  
- **สถาปัตยกรรมเหนือโค้ดชั่วคราว**  
- **คุณภาพเหนือทางลัด**

ทุกบทในเอกสารนี้—ตั้งแต่สถาปัตยกรรมเดิม, API Blueprint, Security Model, Observability, State Management, UX Standards, NFRs, ไปจนถึง Development Guidelines—คือผลลัพธ์จากมุมมองระดับองค์กรที่ต้องการให้ Unicorn มีฐานรากระบบที่ “แข็งแรงกว่าที่เห็น และฉลาดกว่าที่คิด”

เส้นทางข้างหน้าของ Unicorn จะเต็มไปด้วยโปรเจคใหม่ ความต้องการใหม่ และทีมที่เติบโตขึ้นเรื่อย ๆ  
แต่ตราบใดที่เรายึดหลักการในเอกสารนี้:

- ระบบจะไม่แตก  
- ทีมจะทำงานได้เร็วขึ้น  
- ความผิดพลาดจะลดลง  
- การเปลี่ยนทีมจะไม่ใช่อุปสรรค  
- คุณภาพจะสม่ำเสมอและตรวจสอบได้

และเหนือสิ่งอื่นใด—เราจะมีสถาปัตยกรรมที่มั่นใจได้ว่า  
**ไม่ว่าโปรเจคจะเปลี่ยนไปเท่าไร “แกนกลางของระบบ Unicorn จะยังคงมั่นคงและเป็นหนึ่งเดียวกันเหมือนเดิม”**

นี่คือก้าวแรกของการสร้างมาตรฐานระดับองค์กร  
นี่คือพิมพ์เขียวเวอร์ชันแรกที่จะนำทางเราสู่อนาคต 3–5 ปีข้างหน้า  
และนี่คือรากฐานของ “Unicorn FE Platform” ที่จะเติบโตไปพร้อมกับบริษัท

**— Unicorn Frontend Architecture v1.0**  
**เอกสารสถาปัตยกรรมหลักขององค์กร Unicorn**

หัวข้อ “React XSS & HttpOnly Auth – Implementation Rules”
ลิสต์ข้อห้าม:
No innerHTML / dangerouslySetInnerHTML
No eval / new Function
No inline event (onClick="...")
No token in localStorage
All API calls must go through apiFetch
ลิสต์ “ถ้าจำเป็นต้อง render HTML ให้ใช้ SafeHtml”