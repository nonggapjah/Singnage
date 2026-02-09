# Theme and Accessibility Guidelines (Theme & Font Size)

เอกสารนี้ใช้เป็นมาตรฐาน (Standard Guidelines) และ Checklist สำหรับการพัฒนาและตรวจสอบหน้าเพจ (Pages) และส่วนประกอบ (Components) ในโปรเจกต์ **Signage Unicorn Web** เพื่อให้มั่นใจว่าระบบรองรับ **Dark/Light Mode** และ **การปรับขนาดตัวอักษร** ได้อย่างสมบูรณ์

---

## 1. หลักการทำงานของ Theme (Dark / Light Mode)

ระบบใช้ CSS Variables และ Tailwind CSS Class ในการจัดการ Color Scheme
เป้าหมายคือ: **ทุก Component ต้องไม่ระบุสีแบบ Hardcode (เช่น `bg-white`, `text-black`) แต่ต้องใช้ Semantic Tokens**

### 1.1 Color Tokens (Semantic Naming)
ห้ามใช้สีดิบ ให้ใช้ Token ที่สื่อความหมายแทน:

| Token Name           | Light Mode Value | Dark Mode Value  | Usage Example (Tailwind)       |
| -------------------- | ---------------- | ---------------- | ------------------------------ |
| `--background`       | `#ffffff`        | `#09090b`        | `bg-background`                |
| `--foreground`       | `#09090b`        | `#ffffff`        | `text-foreground`              |
| `--card`             | `#ffffff`        | `#09090b` (Elev) | `bg-card text-card-foreground` |
| `--primary`          | `Brand Color`    | `Brand Lighter`  | `bg-primary text-primary-foreground` |
| `--muted`            | `#f4f4f5`        | `#27272a`        | `bg-muted` (สำหรับพื้นหลังรอง) |
| `--border`           | `#e4e4e7`        | `#27272a`        | `border-border`                |
| `--card-solid`      | `#ffffff`        | `#18181b` (100%) | `bg-card-solid` (No transparency) |

### 1.2 Development Rules
1.  **ห้าม Hardcode Hex Color:** ห้ามใช้ `style={{ color: '#000' }}` หรือ `bg-[#ffffff]` โดยเด็ดขาด
2.  **ใช้ `bg-background` เสมอ:** สำหรับ Page Container หลัก เพื่อให้สีเปลี่ยนตามธีม
3.  **ทดสอบ Contrast:** สีข้อความบน Background แต่ละแบบต้องมี Contrast Ratio อย่างน้อย 4.5:1
4.  **Icons:** SVG/Icons ต้องใช้ `currentColor` หรือ class `text-foreground` เพื่อให้เปลี่ยนสีตามข้อความ

---

## 2. หลักการทำงานของ Font Size Scaling (Standard Dashboard Scale)

เพื่อให้หน้าจอ Dashboard แสดงข้อมูลได้ครบถ้วนและสวยงาม (Information Density) โดยไม่ดูเทอะทะ เราจะใช้มาตรฐานขนาด Font ใหม่ที่เหมาะสมกับ Web Application:

### 2.1 CSS Scaling Strategy
เราจะควบคุมขนาด Font ผ่าน `data-font-size` attribute ที่ `<html>` tag โดยอ้างอิงฐานที่ **14px** (Standard Dashboard Size):

```css
:root[data-font-size="small"] { font-size: 13px; }  /* Compact View */
:root[data-font-size="medium"] { font-size: 14px; } /* Default Standard */
:root[data-font-size="large"] { font-size: 16px; }  /* Accessible View */
```

### 2.2 Development Rules (Units)
ในการเขียน CSS หรือ Tailwind Class จำเป็นต้องใช้หน่วยที่สัมพันธ์กับ Root Font Size:

1.  **ใช้ `rem` สำหรับ Typography และ Spacing หลัก:**
    *   `text-sm`, `text-base`, `text-lg`, `text-xl` (Tailwind ใช้ `rem` เป็น default อยู่แล้ว)
    *   `p-4`, `m-2`, `gap-4` (ใช้ `rem`) → เมื่อ Root font size เปลี่ยน, Spacing จะขยายตามสัดส่วน
2.  **หลีกเลี่ยง `px` สำหรับ Text:**
    *   ❌ `text-[14px]` (จะไม่ขยายเมื่อ user ปรับ font size)
    *   ✅ `text-base` (เท่ากับ 1rem = 14px ในโหมด Medium)
3.  **Heading Scale:**
    *   ตรวจสอบให้แน่ใจว่า Heading (`h1`, `h2`) ไม่ใหญ่เกินไปจนกินพื้นที่หน้าจอ

---

## 3. Implementation Checklist (สำหรับ Dev & QA)

ใช้ตารางนี้ตรวจสอบ **ทุกหน้า (Page)** และ **Dialog/Modal** ใหม่ที่สร้างขึ้น

| Check Item | Description | Pass/Fail |
| :--- | :--- | :--- |
| **Dark Mode Switching** | เปลี่ยนธีมเป็น Dark Mode แล้วพื้นหลัง (Background) เปลี่ยนเป็นสีเข้มที่ถูกต้อง (ไม่ขาวจ้า) | [ ] |
| **Text Visibility (Dark)**| ข้อความทุกจุดใน Dark Mode อ่านออกชัดเจน (ไม่จมหายไปกับพื้นหลัง, เช่น ตัวหนังสือสีดำบนพื้นดำ) | [ ] |
| **Border & Divider** | เส้นขอบตาราง (Border) และเส้นคั่นต่างๆ มองเห็นชัดเจนในทั้ง 2 โหมด | [ ] |
| **Input/Form Fields** | พื้นหลังของ Input/Select ต้องเปลี่ยนสีถูกต้อง และข้อความที่พิมพ์มองเห็นชัดเจน | [ ] |
| **Native Controls** | Calendar Icon และ Dropdown Menu ของ Browser แสดงผลถูกต้องใน Dark Mode (ไม่ดำจม หรือขาวแสบตา) | [ ] |
| **Modals & Overlays** | พื้นหลังของ Modal ต้องทึบ (`bg-background` หรือ `bg-card`) หรือมี Opacity สูง เพื่อไม่ให้ข้อความข้างหลังทะลุขึ้นมารบกวน | [ ] |
| **Font Scaling (Medium)**| ที่ขนาดปกติ (14px) Layout สวยงาม สัดส่วนเหมาะสม ไม่ดูเล็กหรือใหญ่เกินไป | [ ] |
| **Font Scaling (Large)** | เปลี่ยนขนาด Font เป็น **Large** (16px): ข้อความต้องใหญ่ขึ้น และ **Layout ต้องไม่แตก** | [ ] |
| **Font Scaling (Small)** | เปลี่ยนขนาด Font เป็น **Small** (13px): ข้อความเล็กลง แสดงข้อมูลได้มากขึ้น | [ ] |
| **Icon Clarity** | Icons มีสีที่ถูกต้องตาม Text (ใช้ `currentColor`) ในทุกธีม | [ ] |
| **Hover/Active States** | สีตอนเอาเมาส์ชี้ (Hover) ใน Dark Mode ต้องดูเหมาะสม (ไม่สว่างวาบ หรือมืดจนมองไม่เห็น) | [ ] |

---

## 4. Technical Implementation Guidelines (React/Next.js)

### 4.1 Theme Provider
ใช้ `next-themes` หรือ Context API เพื่อจัดการ Class `dark` ลงใน `<html>` tag

```tsx
// components/theme-provider.tsx
"use client"
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({ children, ...props }: any) {
  return <NextThemesProvider attribute="class" defaultTheme="system" enableSystem {...props}>{children}</NextThemesProvider>
}
```

### 4.2 Font Size Provider
สร้าง Context เพื่อ Inject `data-font-size` ลงใน `<html>`

```tsx
// hooks/use-font-size.ts
// Default value should be 'medium' (14px)
// useEffect doc.documentElement.setAttribute('data-font-size', size)
```

---

## 5. Form Elements (Inputs & Selects) - **CRITICAL UPDATE**

Native Form Elements (โดยเฉพาะ `datetime-local` และ `select`) มักจะมีปัญหากับ Dark Mode หากไม่กำหนดค่าให้ถูกต้อง

### 5.1 The `color-scheme` Property
ต้องกำหนด property `color-scheme` ให้ browser ทราบว่าเรากำลังใช้โหมดมืด เพื่อให้มัน render native controls (calendar popup, scrollbar, dropdown list) ให้เป็นสีเข้ม

**Correct Implementation (Tailwind):**
```tsx
<input 
  type="datetime-local" 
  className="bg-background text-foreground dark:[color-scheme:dark]" 
/>
```

### 5.2 Select Option Styling
`select` dropdown มักจะมีพื้นหลังสีขาวโดย Default ในบาง OS
**IMPORTANT:** ใน Dark Mode, Dropdown List **ต้องเป็นสีดำสนิท** และตัวหนังสือสีขาว

```tsx
<select className="bg-background text-foreground dark:[color-scheme:dark] dark:bg-black dark:text-white">
  <option className="bg-background text-foreground dark:bg-black dark:text-white" value="1">Option 1</option>
  <option className="bg-background text-foreground dark:bg-black dark:text-white" value="2">Option 2</option>
</select>
```

---

## 6. Modals & Dialogs - **CRITICAL UPDATE**

### 6.1 Background Opacity
ห้ามใช้ `bg-transparent` หรือ Glassmorphism ที่มีความโปร่งใสสูง (`opacity < 90%`) กับ Modal ที่มีข้อความเยอะ เนื่องจากจะทำให้ข้อความของ Modal ซ้อนทับกับ Background ข้างหลังจนอ่านยาก

**Correct Implementation:**
```tsx
// ✅ Good: Solid background or very slight transparency
<div className="bg-background border border-border ...">
  ... content ...
</div>
```

**Incorrect Implementation:**
```tsx
// ❌ Bad: Too transparent
<div className="bg-background/20 backdrop-blur-md ..."> 
  ... content ...
</div>
```

---

## 7. Typical Bugs to Avoid (ตัวอย่างปัญหาที่พบบ่อย)

1.  **Shadow ดำบนพื้นดำ:** ใน Dark Mode, `box-shadow` สีดำจะมองไม่เห็น ให้เปลี่ยนมาใช้ `border` บางๆ หรือเปลี่ยนสี Shadow แทน
2.  **Hardcoded White Background:** การกำหนด `bg-white` ใน Card จะทำให้มันสว่างจ้าใน Dark Mode → แก้เป็น `bg-card`.
3.  **Fixed Height Containers:** การกำหนด `h-[50px]` อาจทำให้ text ล้นเมื่อปรับ Font เป็น Large → แก้เป็น `min-h-[50px]` หรือ `h-auto p-4` เพื่อให้ยืดขยายได้.
4.  **Invisible Calendar Icon:** Input แบบ Date/Time มองไม่เห็น icon ปฏิทินเพราะเป็น icon สีดำบนพื้นหลังดำ → แก้ด้วย `dark:[color-scheme:dark]`.
5.  **Transparent Modal:** Modal ตัวหนังสือซ้อนกับพื้นหลังเพราะใช้ Glass Effect เยอะเกินไป → แก้เป็น `bg-background` หรือ `bg-card` ที่ทึบแสง
