# Debt page (#debt) — TODO (จดไว้ก่อนแก้)

หน้า: https://patima-fin.github.io/waterpog-fin/#debt
ไฟล์: `app/page_debt.jsx` (component `DebtPage`)
สถานะ: **ยังไม่แก้** — รอ go-ahead (อีกหน้าทำ index.html อยู่) · `page_debt.jsx` คนละไฟล์ ไม่ชน

## เป้าหมาย (จากผู้ใช้)
> การ์ดย่อยๆ (สรุปรายหมวด) อยากรวมเป็น **2 กลุ่มใหญ่: BANK กับ NON-BANK** โชว์ยอดรวมใหญ่ๆ แล้ว**กดเพื่อกางดูรายละเอียด**ว่าแต่ละกลุ่มแบ่งเป็นหมวดอะไรบ้าง

## ของปัจจุบัน
- "Summary by category" (`page_debt.jsx:651-685`) → เรนเดอร์การ์ดเล็ก 1 ใบ/หมวด (flex-wrap) จาก `categoriesPresent` → มีได้ถึง ~11 ใบ (รก)
- หมวด (`CATEGORY_META:7-19`): WCI, Non-WCI, กรรมการ, LockWood, Zigo, Employyim, ลีซอิท, STS, FS, ธนาคาร, อื่นๆ
- แต่ละการ์ดโชว์: จำนวนสัญญา · Active · ยอดคงเหลือ (`activeBal`)
- **ไม่มี field BANK/NON-BANK ในข้อมูล** → ต้อง map จาก `debtCategory`

## mapping (✅ confirm แล้ว: "ธนาคารอย่างเดียว")
```js
// BANK = เฉพาะหมวด 'ธนาคาร' (ธนาคารพาณิชย์ OD/LG)
// NON-BANK = หมวดที่เหลือทั้งหมด
const DEBT_BANK_CATS = ['ธนาคาร'];
const isBankCat = (cat) => DEBT_BANK_CATS.includes(cat);
// BANK:     ธนาคาร
// NON-BANK: WCI, Non-WCI, กรรมการ, LockWood, Zigo, Employyim, ลีซอิท, STS, FS, อื่นๆ
```

## สิ่งที่ต้องทำ
- เรนเดอร์ **2 การ์ดใหญ่**: BANK / NON-BANK → โชว์ยอดรวมคงเหลือ Active ต่อกลุ่ม + จำนวนสัญญารวม
- **กดการ์ด → expand** โชว์การ์ดย่อยรายหมวดข้างในกลุ่มนั้น (reuse ดีไซน์เดิม `:661-682` เป็นรายละเอียด)
- default = **ย่อ** (เห็นแค่ 2 ยอดใหญ่) · กด = กาง (ใช้ React.useState เปิด/ปิดต่อกลุ่ม)

## ต้องระวัง / sub-decisions
- **USD (Zigo):** Zigo = ต่างประเทศ/USD (`:631`, อยู่กลุ่ม NON-BANK) → **ห้ามบวก USD รวมใน THB total**. แยกบรรทัด/แยก badge "+ USD xxx" ในการ์ด NON-BANK (ตามที่ KPI ด้านบนแยก THB/USD อยู่แล้ว `:625-632`)
- **filter chips ด้านล่าง** (`:713-730`) ปัจจุบันเป็นรายหมวด — คงไว้เหมือนเดิม (ถ้าอยากได้ chip กลุ่ม BANK/NON-BANK เพิ่มทีหลัง ค่อยบอก)
- KPI row ด้านบน (`:617-649`) ไม่ต้องแตะ — แก้เฉพาะบล็อก Summary by category

## resolved
- mapping: BANK = ธนาคารเท่านั้น; NON-BANK = ที่เหลือ
- interaction: 2 การ์ดใหญ่ default ย่อ → กดกางดูรายหมวด
