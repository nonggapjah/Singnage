# UNI-102: กฎหมายและมาตรฐานการพัฒนา Unicorn.BOS (2026)

**System Law & Standards**  
**เวอร์ชัน: 1 มกราคม 2026**  
**สถานะ: Active**  
**ความสำคัญ: บังคับ 100% – กฎหมายสูงสุดของการพัฒนา**

โค้ดใดที่ไม่สอดคล้องกับเอกสารนี้ ให้ถือว่า “ผิด” แม้จะรันได้  
ไม่มีข้อยกเว้น ไม่มี shortcut และไม่มี “เดี๋ยวค่อยแก้”

---

## 1. วัตถุประสงค์ของเอกสาร

- กำหนดมาตรฐานเดียวที่ทุกคนและ AI ต้องปฏิบัติตาม
- ป้องกัน technical debt และ architecture drift ตั้งแต่ต้น
- ทำให้ระบบเติบโตได้โดยไม่กลายพันธุ์
- ทำให้การทำงานร่วมกันของ “คน + AI” เป็นไปในทิศทางเดียวกัน

---

## 2. หลักการสูงสุด (Supreme Principles – ห้ามละเมิด)

1. **ความชัดเจนมาก่อนความฉลาด**  
   โค้ดต้องอ่านรู้เรื่องก่อนจะฉลาด  
   **ตัวอย่างที่ผิด**: ใช้ชื่อฟังก์ชันสั้น ๆ เช่น `Proc()` หรือใช้ magic number โดยไม่มี comment  
   **ตัวอย่างที่ถูก**: `sp_user_create_std` พร้อม comment อธิบาย intent

2. **ระยะยาวมาก่อนระยะสั้น**  
   **ตัวอย่าง**: เลือก Stored Procedure แม้เขียนช้าตอนแรก เพื่อให้ query plan คงที่และ secure ในระยะยาว

3. **มาตรฐานเดียวเท่านั้น**  
   ไม่มี “ฉันถนัดแบบนี้” – ทุกคนใช้ pattern เดียวกัน

4. **กฎหมายสำคัญกว่าความสะดวก**  
   ถ้าต้องเขียนโค้ดเพิ่มเพื่อให้สอดคล้อง → ต้องทำ

---

## 3. ภาษาและการสื่อสาร

- โค้ดและเอกสารใช้ **ภาษาอังกฤษเป็นหลัก**
- ชื่อต้องสื่อความหมายชัดเจน  
  **ตัวอย่างที่ดี**: `CreateUserCommand`, `UserCreatedEvent`, `IsActive`  
  **ตัวอย่างที่ห้าม**: `x`, `temp`, `data1`

---

## 4. Backend Standards (.NET 8+)

- **Clean Architecture บังคับ** – แยก Domain / Application / Infrastructure ชัดเจน
- MediatR สำหรับ Command/Query  
  **ตัวอย่าง**: `CreateItemCommand` → `CreateItemHandler` → Publish `ItemCreatedEvent`
- FluentValidation สำหรับ Validation
- ทุก database operation ผ่าน **Stored Procedure _std wrapper เท่านั้น**
- Soft Delete บังคับ → ใช้ `IsDeleted` BIT DEFAULT 0
- Audit fields บังคับ: `CreatedAt`, `CreatedBy`, `UpdatedAt`, `UpdatedBy`

---

## 5. Database Standards (SQL Server) – พร้อมตัวอย่างเต็ม

### 5.1 Table Convention
- PascalCase, พหูพจน์  
  **ตัวอย่าง**: `Users`, `Items`, `UserRoles`
- Primary Key: `Id` BIGINT IDENTITY(1,1)

### 5.2 Stored Procedure Naming & Structure
- ชื่อ: **sp_[domain]_std**  
  **ตัวอย่าง**: `sp_user_std`, `sp_item_std`
- **หลักการ**: 1 Domain มี 1 Procedure เท่านั้น ห้ามแยกไฟล์ ให้ใช้ `@p_action` ในการแยก Logic ภายใน (Create, Update, Get, Delete)

### 5.3 Parameters บังคับ
- `@p_action` NVARCHAR(50) – เช่น 'Create', 'Update', 'Delete', 'Get'
- `@p_userid` BIGINT – ผู้กระทำการ (สำหรับ audit)

### 5.4 Contract Result Set แรก (บังคับทุกตัว)
| Column    | Type             | Description                          |
|-----------|------------------|--------------------------------------|
| err_code  | INT              | 0 = success, >0 = error code         |
| err_flag  | BIT              | 0 = success, 1 = error               |
| msg       | NVARCHAR(MAX)    | ข้อความอธิบาย (ภาษาอังกฤษเป็นหลัก) |

### 5.5 Single Exit Point + Return แม้ใน CATCH

### 5.6 ตัวอย่าง Stored Procedure เต็ม (sp_message_std)

```sql
CREATE PROCEDURE sp_message_std
    @p_action NVARCHAR(50),
    @p_userid BIGINT,
    @p_conversation_id BIGINT = NULL,
    @p_content NVARCHAR(MAX) = NULL,
    @p_metadata NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @err_code INT = 0;
    DECLARE @err_flag BIT = 0;
    DECLARE @msg NVARCHAR(MAX) = N'';

    BEGIN TRY
        IF @p_action = 'Send'
        BEGIN
            IF @p_conversation_id IS NULL OR @p_content IS NULL
            BEGIN
                SET @err_code = 10;
                SET @err_flag = 1;
                SET @msg = N'Required parameters missing.';
                GOTO ResultSection;
            END

            INSERT INTO Messages (
                ConversationId, SenderId, Content, Metadata, CreatedAt, CreatedBy
            ) VALUES (
                @p_conversation_id, @p_userid, @p_content, @p_metadata, SYSDATETIME(), @p_userid
            );

            DECLARE @new_id BIGINT = SCOPE_IDENTITY();

            SET @msg = N'Message sent successfully.';
            GOTO ResultSection;
        END

        -- เพิ่ม action อื่น ๆ เช่น 'Edit', 'Delete' ที่นี่

        SET @err_code = 99;
        SET @err_flag = 1;
        SET @msg = N'Unknown action.';
        GOTO ResultSection;
    END TRY
    BEGIN CATCH
        SET @err_code = ERROR_NUMBER();
        SET @err_flag = 1;
        SET @msg = ERROR_MESSAGE();
        GOTO ResultSection;
    END CATCH

ResultSection:
    -- Contract Result Set (แรกเสมอ)
    SELECT @err_code AS err_code,
           @err_flag AS err_flag,
           @msg AS msg;

    -- Business Payload (เฉพาะ success)
    IF @err_flag = 0 AND @p_action = 'Send'
    BEGIN
        SELECT Id AS message_id,
               ConversationId,
               SenderId,
               Content,
               Metadata,
               CreatedAt,
               CreatedBy
        FROM Messages
        WHERE Id = SCOPE_IDENTITY();
    END
END
GO
เหตุผลที่ต้อง return อย่างน้อย 2 result sets

Caller (Backend) อ่าน contract ก่อนเสมอ → รู้สถานะทันที ไม่ต้องเดา shape
ทำให้ error handling predictable และ trace ได้ง่าย


6. Frontend Standards (Unicorn.BOS.Client)

6.1 Tech Stack (Official)
- **Framework**: Next.js (App Router) + TypeScript
- **Styling**: Tailwind CSS + Glassmorphism Strategy
- **Sourcing**: Backend-First Architecture (API Fetch via Wrapper)

6.2 Styling Guidelines
ห้าม:
HTML<div class="p-[23px] text-[#123abc]" style="opacity: 0.5">Content</div>

ถูกต้อง (ใช้ Design Token และ Glassmorphism):
HTML<div class="p-6 glass-panel rounded-xl shadow-lg border border-white/10 backdrop-blur-md">
  <h1 className="neon-text text-accent-cyan">Content</h1>
</div>

6.3 สิ่งที่ห้ามทำ
- ห้ามเรียก Database โดยตรงจาก Client Component
- ห้ามเรียก LLM โดยตรงจาก Frontend (ต้องผ่าน Brain Layer)
- ห้าม Hardcode Secret / API Key บน Frontend เด็ดขาด
- ห้ามตรวจ Permission ใน JS เป็นด่านสุดท้าย (ต้อง Backend ตรวจก่อนส่ง Data)


7. AI Integration & Guardrails

ทุก AI call ผ่าน Brain orchestration
ตัวอย่าง context JSON:

JSON{
  "userId": 123,
  "role": "Manager",
  "domain": "BranchSales",
  "constraints": ["No auto-approval", "Explain provenance"]
}

AI ห้าม hide uncertainty → ต้อง return confidence score เสมอ


8. กระบวนการทำงาน

Task-Driven: ทุก PR ต้องอ้าง TASKS.md
Documentation-First: เปลี่ยนใหญ่ → อัปเดต UNI ก่อน
Cleanup: ลบ dead code ทันที


9. การบังคับใช้

Code Review checklist ต้องมี UNI-102 reference
AI ที่ช่วยเขียนโค้ดต้องถูก prompt ด้วย UNI-100–102


11. Logging Standards (AI Fuel)

**Goal**: ทุก Log คืออาหารของ AI (AI Fuel)
- **ห้าม** พ่น Log ออก Console/Debug/File ใน Production เด็ดขาด (อนุญาตเฉพาะ Local Dev)
- **บังคับ** ทุก System Log (.NET ILogger) ต้องไหลลง `APP_LOG_EVENT` เท่านั้น
- **บังคับ** ใช้ `DatabaseLoggerProvider` ที่เป็น Standard ของระบบ

ตัวอย่างการ Config (Program.cs):
```csharp
logging.ClearProviders();
logging.AddDatabaseLogger(); // Custom Standard Extension
```

โครงสร้างข้อมูลที่ต้องมี:
- `SourceSystem`, `Environment` (Backend/Dev)
- `Level` (Info, Error, Warning)
- `Message`, `Exception` (Stack Trace)


12. ถ้อยแถลงสุดท้าย
ตัวอย่างที่ชัดเจนในเอกสารนี้มีไว้เพื่อให้ทุกคนและ AI
เข้าใจตรงกันตั้งแต่วันแรก
และปฏิบัติได้ทันทีโดยไม่ต้องตีความเพิ่ม
UNI-102 คือรากฐานที่ทำให้ Unicorn.BOS
มั่นคง น่าเชื่อถือ และ scale ได้จริงในปี 2026 และต่อไป
เอกสารนี้แทนที่ UNI-003, UNI-007, UNI-010 และ AI_GUARDRAILS โดยสมบูรณ์
เอกสารเก่าเก็บไว้เป็นมรดกใน docs/archived/2023-foundation/
```