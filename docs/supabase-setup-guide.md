# คู่มือเปิดใช้ Supabase (Phase 1 — cutover)

> โค้ดฝั่งแอปพร้อมแล้วทั้งหมด (adapter + schema + migrate tool) เหลือแค่ทำ 6 ขั้นนี้.
> ทุกขั้นปลอดภัย + **ถอยกลับ Google Sheets ได้ตลอด** ด้วยการตั้ง `BACKEND: 'sheets'`.

ไฟล์ที่เกี่ยวข้อง: [supabase/schema.sql](../supabase/schema.sql) ·
[app/data_supabase.js](../app/data_supabase.js) ·
[tools/migrate-to-supabase.html](../tools/migrate-to-supabase.html) ·
[app/config.js](../app/config.js)

---

## ขั้น 1 — สร้าง Supabase project (ฟรี, ~5 นาที)
1. ไป https://supabase.com → Sign in (GitHub/Google) → **New project**
2. ตั้งชื่อ (เช่น `waterpog-fin`), ตั้ง **Database Password** (เก็บไว้), เลือก Region **Singapore** (ใกล้ไทยสุด)
3. รอ provision เสร็จ (~2 นาที)

## ขั้น 2 — รัน schema (สร้าง 23 ตาราง)
1. เมนูซ้าย → **SQL Editor** → **New query**
2. เปิดไฟล์ `supabase/schema.sql` → ก็อปทั้งหมด → วาง → กด **Run** (เขียว) ขวาล่าง
3. ควรขึ้น "Success" — ตาราง 23 ตัว + `audit_log` + trigger + realtime ถูกสร้าง
   (ตรวจได้ที่ **Table Editor** จะเห็น projects/invoices/… ครบ)

## ขั้น 3 — เอา URL + anon key
1. เมนูซ้าย → **Project Settings** (เฟือง) → **API**
2. ก็อป **Project URL** (เช่น `https://abcdefgh.supabase.co`)
3. ก็อป **anon public** key (ยาว ~200 ตัว, ขึ้นต้น `eyJ…`)
   > ⚠ อย่าใช้ `service_role` key (ลับสุด) — ใช้ **anon public** เท่านั้น

## ขั้น 4 — กรอก config (ยังคง BACKEND='sheets')
แก้ [app/config.js](../app/config.js):
```js
BACKEND: 'sheets',                         // ★ ยังไม่เปลี่ยน — รอ migrate ก่อน
SUPABASE_URL: 'https://abcdefgh.supabase.co',
SUPABASE_ANON_KEY: 'eyJ...ก็อปมาวางทั้งก้อน...',
```

## ขั้น 5 — ย้ายข้อมูลครั้งเดียว
1. เปิด `tools/migrate-to-supabase.html` ผ่าน http (ไม่ใช่ double-click):
   - รัน `python -m http.server 8000` ที่ root → เปิด `http://localhost:8000/tools/migrate-to-supabase.html`
2. หน้าจะโชว์การตั้งค่า (SHEET_ID / URL / KEY ต้องเขียวหมด) → กด **เริ่มย้ายข้อมูล**
3. รอจนทุกแถวขึ้น "เสร็จ ✓" — คอลัมน์ "ในชีต" ควร = "ใน Supabase" ทุกตาราง
   (debtLedger เยอะสุด ~4000 แถว ใช้เวลาหน่อย — ปกติ)
4. ถ้าตารางไหนขึ้น "ตรวจ!" → ดู log ด้านล่าง + กด **ตรวจนับ Supabase อีกครั้ง**

## ขั้น 6 — เปิดใช้ + ทดสอบ + deploy
1. แก้ [app/config.js](../app/config.js): `BACKEND: 'supabase'`
2. **bump `?v=`** ของ `config.js` ใน [index.html](../index.html) (เช่น `…s1` → `…s2`)
3. เปิดแอป local (`http://localhost:8000`) → ล็อกอิน → ตรวจ:
   - Console เห็น `[WTP Supabase] build … Postgres + Realtime` + `realtime พร้อม`
   - Sidebar นับ entity ครบ (invoices/receipts/projects/payables/…)
   - แก้ 1 รายการ → กดบันทึก → **reload → ค่ายังอยู่** (ไม่เด้งกลับ)
   - เปิด 2 แท็บ → แก้แท็บ A → แท็บ B เห็นทันที (realtime)
4. `git push origin master` → ทีมใช้ Supabase

---

## ถอยกลับ (ถ้ามีปัญหา)
ตั้ง `BACKEND: 'sheets'` + bump `?v=` + push → แอปกลับไปใช้ Google Sheets ทันที.
(ข้อมูลใน Sheet ยังอยู่ครบ — Phase 1 ไม่ลบ Sheet/Apps Script)

## ความปลอดภัย (สำคัญ)
- Phase 1 **RLS ปิด** → ใครมี URL + anon key ก็อ่าน/เขียนได้ — โพสเจอร์เดียวกับ Apps Script
  URL เดิมที่เปิดอยู่ตอนนี้. เก็บ URL/anon key ไว้ภายในทีม.
- การคุม role จริง (viewer อ่านอย่างเดียว ฯลฯ) = **Phase 4** (เปิด RLS + Supabase Auth).
  ตอนนี้ role ยังคุมที่ฝั่ง client (config.js USERS) เหมือนเดิม.

## ยังไม่ย้ายใน Phase 1 (อ่านจาก Google Sheet ต่อ — ต้องคง SHEET_ID ใน config)
- หน้า **P&L** + **Budget** + **Audit Log** ยังอ่านจาก Sheet เดิม (hybrid) — ทำงานได้ปกติ
- Phase 4: ย้าย P&L/Budget เป็นตาราง Supabase + audit เป็น Postgres trigger + เปิด RLS +
  ย้าย login → Supabase Auth (password hash จริง) + ตัด Apps Script/data_sync.js ทิ้ง

## Troubleshooting
| อาการ | แก้ |
|---|---|
| migrate tool ปุ่มเทา กดไม่ได้ | URL/KEY ยังว่างใน config.js — กรอกแล้วรีเฟรช |
| `permission denied for table` ตอน migrate | ยังไม่ได้รัน `schema.sql` (ส่วน grant) — รันใหม่ |
| แอป supabase mode จอว่าง + console `ขาด SUPABASE_URL` | กรอก URL/KEY ไม่ครบ / ลืม bump `?v=` |
| ตารางไหน count น้อยกว่าชีต | ดู log มี "id ซ้ำ" ไหม — แถวที่ไม่มี id จะถูก gen ใหม่; ตรวจชีตว่าคอลัมน์ id ครบ |
| realtime ไม่ push | ตาราง publication ไม่ครบ — รัน `schema.sql` ส่วนลูป `alter publication` ใหม่ |
