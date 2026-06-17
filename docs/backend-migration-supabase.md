# Roadmap: ย้าย Backend ไป Supabase (Realtime)

> เป้าหมาย: เลิกอาการ "หน่วง" และ "แก้แล้วเด้งกลับ" อย่างถาวร โดยเปลี่ยนจาก
> Google Sheets (อ่าน gviz CSV / เขียน Apps Script — คนละ cache layer)
> ไปเป็น Postgres realtime ที่อ่านหลังเขียนเห็นทันที + push ผ่าน websocket

---

## 1. ทำไมต้องย้าย (สรุปต้นเหตุปัจจุบัน)

| อาการ | ต้นเหตุใน Google Sheets |
|---|---|
| แก้แล้วเด้งกลับ ต้องทำหลายรอบ | อ่าน (gviz CSV) กับเขียน (Apps Script) เป็นคนละ cache → read-after-write lag หลายสิบวินาที |
| ยิ่งคน/ข้อมูลเยอะ ยิ่งหน่วง | ทุก user poll ~33 แท็บทุก 45s, `replaceAll` เขียนทั้งตารางต่อ 1 การแก้, atomic load (แท็บเดียว 429 ทิ้งทั้งรอบ) |
| ไม่เรียลไทม์ | polling 45s — ไม่ใช่ push; ต้องรอรอบถัดไปถึงเห็นของคนอื่น |

โค้ด merge ทั้งหมดใน `app/data_sync.js` (3-way merge, preserveAppOnlyFields,
CLEARABLE_FIELDS, grace window) คือการ **สู้กับ backend ที่ไม่ consistent** —
ย้ายไป Postgres แล้วลบทิ้งได้เกือบหมด

---

## 2. ทำไม Supabase

- **Postgres** — schema ใกล้ตาราง/แท็บที่ใช้อยู่ ย้าย mental model ง่าย (SQL ตรง ๆ)
- **อ่านหลังเขียนเห็นทันที** — ไม่มี lag สองช่องทาง → เลิกเด้งกลับถาวร
- **Realtime ผ่าน websocket** — `supabase.channel(...).on('postgres_changes', ...)`
  ใครแก้ → push หาทุก client ทันที → เลิก poll 33 แท็บ
- **เขียนทีละแถว** — `update().eq('id', ...)` ไม่ใช่ rewrite ทั้งตาราง → โตเท่าไหร่ก็เร็วเท่าเดิม
- **Host เดิมได้** — หน้าเว็บยังอยู่บน GitHub Pages, Supabase เป็น REST/WS ภายนอก
- **Row Level Security (RLS)** — คุม viewer/staff/manager/owner ที่ระดับ DB จริง
  (ตอนนี้ role อยู่ใน `config.js` ฝั่ง client — ใครเปิด devtools ก็ข้ามได้)
- **Free tier**: 500MB DB + 2GB bandwidth + realtime — เหลือเฟือทีม ~5 คน

---

## 3. แผนย้ายแบบ incremental (ไม่ big-bang)

### Phase 0 — เตรียม (ครึ่งวัน)
- สร้าง project บน supabase.com, เก็บ `SUPABASE_URL` + `anon key` ใน `config.js`
- โหลด `@supabase/supabase-js` ผ่าน CDN (เหมือนที่โหลด React/Babel ตอนนี้)

### Phase 1 — สร้าง schema (1–2 วัน)
- แปลงแต่ละ entity ใน `CRUD_ENTITIES` เป็น 1 ตาราง Postgres
  (20 entity: projects, invoices, forecastEntries, bankAccounts, pvVouchers,
  payables, debtLedger, receipts, bankEntries, checks, debtMaster, bankTransfers,
  stsServiceFee, stsPendingCalc, stsCalcResult, debtEvents, users,
  cashflowSnapshots, followUpsLog, manualOverrides)
- field ที่เป็น JSON (followUps, actualReceive, debtIds) → คอลัมน์ `jsonb`
- ทุกตารางมี `id` (มีอยู่แล้วในข้อมูล) เป็น primary key
- ทำ migration script ดึงข้อมูลปัจจุบันจาก Sheet (ผ่าน `WTPData.fetchSheetRows`)
  → insert เข้า Supabase ครั้งเดียว

### Phase 2 — เปลี่ยน read layer (2–3 วัน)
- เขียน `data_supabase.js` แทน `data_sync.js`:
  - แทน `loadFromServer` ด้วย `supabase.from(table).select('*')` ต่อ entity
  - แทน auto-refresh 45s ด้วย realtime subscription (push)
- คง interface เดิม: `WTPData.subscribe`, `WTPData.getSyncStatus`,
  `WTPData.save` — React (`app.jsx`) จะ **ไม่ต้องแก้** ถ้า interface เหมือนเดิม
- เปิด feature flag ใน `config.js`: `BACKEND: 'supabase' | 'sheets'` สลับกลับได้

### Phase 3 — เปลี่ยน write layer (2–3 วัน)
- แทน `replaceAll` ด้วย upsert/update ทีละแถว: `supabase.from(t).upsert(row)`
- ลบ machinery กัน-เด้งกลับทิ้งได้: 3-way merge, grace window, CLEARABLE_FIELDS,
  preserveAppOnlyFields — Postgres consistent อยู่แล้ว ไม่ต้อง merge
- optimistic UI: setState ทันที → upsert → ถ้า error ค่อย rollback

### Phase 4 — RLS + audit (1–2 วัน)
- ย้าย role logic ไป RLS policy (viewer อ่านได้บางตาราง, staff แก้ได้ห้ามลบ ฯลฯ)
- audit log: ใช้ Postgres trigger เขียน `audit_log` table อัตโนมัติ
  (แทน `_currentMeta` ที่ฝั่ง client ส่งไป Apps Script ตอนนี้)

### Phase 5 — ตัด Sheets (ครึ่งวัน)
- ปิด `BACKEND: 'sheets'`, ลบ `data_sync.js` + Apps Script
- Sheet เหลือไว้เป็น read-only backup (export รายวันจาก Supabase ถ้าต้องการ)

**รวมประมาณ 8–13 วันทำงาน** — แต่ละ phase แยกเทสได้ สลับ flag กลับ Sheets ได้ตลอด

---

## 4. จุดที่ต้องระวัง

- **Date format**: payables.due2 เป็น DD/MM/YYYY แบบไทย — ตอน migrate ต้อง
  normalize เป็น ISO `date` ก่อน insert (ดู memory `date-format-ddmm-gotcha`)
- **id ซ้ำ/ว่าง**: เช็คทุก entity ว่ามี `id` unique ก่อนตั้งเป็น primary key
  (บางแถวจับคู่ด้วย receiptNo/ivNo — ดู `rowKey` ใน data_sync.js)
- **manualOverrides / cashflowSnapshots**: ตรวจ schema ให้ครบก่อนย้าย
- **users table**: ตอนนี้ password เป็น plaintext ใน config.js — ย้ายไป Supabase
  Auth (hash จริง) ถือโอกาสนี้เลย

---

## 5. ระหว่างยังไม่ย้าย — มาตรการชั่วคราว (ทำแล้ว)

ใน `app/data_sync.js` (commit ล่าสุด):
- **Anti-bounce guard**: entity ที่มี edit ค้าง หรือเพิ่ง push ภายใน 60s
  จะไม่ถูก CSV เก่าทับ → จอไม่เด้งกลับสำหรับคนที่กำลังพิมพ์
- **Hot/Cold polling**: poll เฉพาะ CRUD entity ทุกรอบ, แท็บสรุป (cold) ดึงทุก 4 รอบ
  (~3 นาที) → ลดจำนวน request → ลด HTTP 429 → ข้อมูลสดขึ้น

มาตรการเหล่านี้ "ลด" อาการ แต่ไม่หายขาด — รากปัญหายังอยู่ที่ Sheets
การย้ายไป Supabase เท่านั้นที่แก้ถาวร
