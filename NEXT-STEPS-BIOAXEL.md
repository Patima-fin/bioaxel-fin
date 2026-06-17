# BIOAXEL Financial Console — ขั้นตอนที่เหลือ (สำหรับคุณ)

> ## ✅ STEP 1–4 เสร็จแล้ว (2026-06-18) — เว็บ LIVE: https://patima-fin.github.io/bioaxel-fin/
> - Supabase project `tfcxbcekxwnncdqiqzav` · รัน `schema.sql` + `pnl-budget.sql` ครบ · `config.js` กรอก URL + publishable key แล้ว
> - โลโก้ BIOAXEL ใหม่ (แนวตั้ง ครอบตัด พื้นโปร่งใส) · push ขึ้น repo `Patima-fin/bioaxel-fin` (`master`) + เปิด GitHub Pages แล้ว
> - login (bootstrap): **admin / bioaxel-setup-2026**
> ### ⬜ เหลือ STEP 5 (ทำก่อนเปิดใช้จริง/ก่อนใส่ข้อมูลจริง) — ตอนนี้ RLS ปิด + ยังไม่ใช้ Supabase Auth = ใครมีลิงก์ก็เข้า/แก้ DB ได้
> (รายละเอียดอยู่ STEP 5 ด้านล่าง · และ `#investor` ยังเป็นเนื้อหา Water POG)

เว็บนี้ถูก **scaffold เสร็จแล้ว** จากโค้ด Water POG (rebrand เป็น BIOAXEL, แยกโฟลเดอร์/ฐานข้อมูล/โดเมน
ออกจากกันหมด) เหลือ 5 ขั้นตอนที่ต้องใช้ "บัญชีของคุณ" (Supabase + GitHub) ที่ผมทำแทนไม่ได้

> โฟลเดอร์เว็บใหม่: `G:\Shared drives\Account&Finance Bioxcel\WebAPP - BIOAXEL`
> **ไม่แตะ Water POG เลย** — คนละโฟลเดอร์ คนละ repo คนละ Supabase

---

## ✅ สิ่งที่ผมทำให้แล้ว
- คัดลอกโค้ดทั้งหมด (ตัด `.git` / `backups` / ไฟล์ข้อมูล `.xlsx`/`.gsheet` ของ Water POG ออก)
- เปลี่ยนแบรนด์ทุกจุดที่เห็น: title, splash, โลโก้ใน sidebar/หัวรายงาน/ใบพิมพ์, ชื่อบริษัท
  (TH `บริษัท ไบโอแอ็กซ์เซลล์ จำกัด` · EN `BIOAXEL`) — รวม 19 ไฟล์
- เปลี่ยน regex ตรวจ "โอนเข้าบัญชีบริษัทตัวเอง" ในหน้ากระทบยอดให้จับชื่อ BIOAXEL
- เขียน `app/config.js` ใหม่ (โหมด bootstrap — รอกรอก Supabase URL/key)
- เปลี่ยนชื่อไฟล์โลโก้เป็น `bioaxel_logo.png` (ตอนนี้ยังเป็นรูป Water POG ชั่วคราว — รอแทน ดู STEP 3)

---

## STEP 1 — สร้าง Supabase project ใหม่ (ฐานข้อมูลของ BIOAXEL)
1. ไป https://supabase.com → New project (ตั้งชื่อเช่น `bioaxel-fin`) → จด **Database password** ไว้
   > Supabase ให้ฟรี 2 projects/บัญชี — Water POG ใช้ไป 1 แล้ว เหลืออีก 1 พอดี
   > (ถ้าเต็ม สมัครอีก org/อีกบัญชีได้ หรืออัปเกรด)
2. รอ ~2 นาทีให้ project พร้อม → เปิด **SQL Editor**
3. รันไฟล์ SQL 2 ไฟล์นี้ (เปิดไฟล์ → copy ทั้งหมด → วางใน SQL Editor → Run) **ตามลำดับ**:
   - `supabase/schema.sql`      (สร้าง 23 ตารางหลัก + audit_log)
   - `supabase/pnl-budget.sql`  (สร้างตาราง P&L + Budget)
   - **อย่าเพิ่งรัน** `supabase/rls-phase4.sql` — เก็บไว้ตอนเปิดระบบ login จริง (STEP 5)
4. ไป **Project Settings → API** → copy 2 ค่า: **Project URL** และ **anon public key**

## STEP 2 — กรอกค่า Supabase ลง config
เปิด `app/config.js` แก้ 2 บรรทัด:
```js
SUPABASE_URL: 'https://xxxxxxxx.supabase.co',   // Project URL จาก STEP 1.4
SUPABASE_ANON_KEY: 'eyJhbGci....',               // anon public key
```
บันทึก → เปิด `index.html` ผ่าน local server (`python -m http.server 8000` หรือ Live Server) →
login: **admin / `bioaxel-setup-2026`** → ควรเห็นแอปว่าง ๆ (ฐานข้อมูลใหม่ยังไม่มีข้อมูล) = ต่อ Supabase สำเร็จ ✅

## STEP 3 — เปลี่ยนโลโก้เป็นของ BIOAXEL
แทนไฟล์ `bioaxel_logo.png` (ที่ root) ด้วยโลโก้จริงของ BIOAXEL — **ใช้ชื่อไฟล์เดิม** `bioaxel_logo.png`
(PNG พื้นโปร่ง ~300×300px กำลังดี) แล้วทุกหน้าจะใช้โลโก้ใหม่อัตโนมัติ

## STEP 4 — สร้าง GitHub repo + เปิด GitHub Pages
1. สร้าง repo ใหม่บน GitHub (เช่น `bioaxel-fin`) — public (GitHub Pages ฟรีต้อง public)
2. ในโฟลเดอร์นี้ (ผม `git init` ให้แล้ว) เชื่อม remote + push:
   ```bash
   git remote add origin https://github.com/<ชื่อคุณ>/bioaxel-fin.git
   git add -A && git commit -m "BIOAXEL scaffold"
   git push -u origin master
   ```
3. GitHub → repo → **Settings → Pages** → Source = Deploy from branch → Branch = `master` → Save
4. รอ ~1 นาที → เว็บจะอยู่ที่ `https://<ชื่อคุณ>.github.io/bioaxel-fin/`
   > ⚠️ anon key ขึ้น repo public ได้ (เหมือน Water POG) **แต่** จะปลอดภัยจริงต่อเมื่อเปิด RLS ใน STEP 5

## STEP 5 — (ทำภายหลัง) เปิด login จริง + ล็อกความปลอดภัย (RLS)
ตอน bootstrap ใครมี anon key ก็แตะ DB ได้ (RLS ปิด) — พอพร้อมใช้จริงให้ทำตาม
`docs/supabase-phase4-auth-guide.md`:
1. แก้รายชื่อทีมจริงใน `config.js → USERS`
2. เปิด `tools/supabase-auth-setup.html` → สร้าง Supabase Auth users + รหัส (ใช้ service_role key, วาง runtime)
3. ปิด "Allow new users to sign up" ใน Supabase → Authentication
4. ตั้ง `config.js → USE_SUPABASE_AUTH: true` + **ลบ `password` ออกจาก USERS** → push
5. รัน `supabase/rls-phase4.sql` ใน SQL Editor (ล็อก: ต้อง login จริงถึงอ่าน/เขียนได้)

---

## ข้อมูลเริ่มต้น (BIOAXEL เริ่มจากฐานว่าง)
ฐานข้อมูลใหม่ "ว่างเปล่า" — ไม่มีข้อมูล Water POG ปนแน่นอน. ใส่ข้อมูล BIOAXEL ผ่านปุ่มนำเข้าในแอปแต่ละหน้า
(โครงการ = อัป Excel, เจ้าหนี้/AP = นำเข้า, Budget = อัป Budget.xlsx, P&L = นำเข้า ฯลฯ) หรือกรอกมือ

## ⚠️ หน้า "Investor" (#investor) ยังเป็นเนื้อหา Water POG
`app/page_investor.jsx` เป็น pitch deck ของ Water POG ทั้งหน้า (สินค้า POG TANKS, งบการเงิน, ผู้ถือหุ้น,
ตลาดหมู่บ้าน) — **ตัวเลข/เนื้อหายังเป็นของ Water POG** ผมจงใจไม่แก้ครึ่ง ๆ กลาง ๆ เพื่อไม่ให้ดูเหมือนเสร็จแต่ข้อมูลผิด
ทางเลือก: (ก) แก้ค่าคงที่ `INV_*` ที่หัวไฟล์ให้เป็นข้อมูล BIOAXEL · หรือ (ข) ซ่อนเมนูนี้ไปก่อน
(ลบ/คอมเมนต์ `<script ... page_investor.jsx>` ใน `index.html` + เอาเมนูออกจาก `app/app.jsx`) — บอกผมได้ถ้าจะให้ทำ

## ⚠️ การดูแลต่อไป: 2 codebase แยกกัน
แก้บั๊ก/เพิ่มฟีเจอร์ที่อยากได้ทั้ง 2 บริษัท ต้องทำทั้ง Water POG และ BIOAXEL (หรือ copy ไฟล์ข้ามกัน
แล้วระวัง config). แลกกับการที่ข้อมูลการเงิน 2 บริษัทไม่ปนกันเด็ดขาด — คุ้มสำหรับงานการเงิน

---
**สรุป:** ทำ STEP 1-2 ก่อน (ครึ่งชั่วโมง) ก็เห็นเว็บ BIOAXEL ทำงานได้แล้ว · STEP 3-4 ให้ขึ้นออนไลน์ · STEP 5 ตอนพร้อมใช้จริง
