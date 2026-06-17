# คู่มือ Phase 4 — Supabase Auth + RLS (ล็อกความปลอดภัยจริง)

> เป้าหมาย: anon key ที่อยู่ใน repo (public) จะ **อ่าน/เขียน DB ไม่ได้อีก** ถ้าไม่ login จริง
> — โดยย้าย login ไป Supabase Auth (รหัส hash ฝั่ง server) + เปิด RLS คุมสิทธิ์ตาม role.
>
> **ลำดับสำคัญมาก** — ทำผิดลำดับ = ทีมเข้าระบบไม่ได้ชั่วคราว. ทำตามนี้เป๊ะ ๆ.

ไฟล์เกี่ยวข้อง: [tools/supabase-auth-setup.html](../tools/supabase-auth-setup.html) ·
[supabase/rls-phase4.sql](../supabase/rls-phase4.sql) · [app/config.js](../app/config.js)

---

## ขั้น A — สร้างผู้ใช้ Supabase Auth + รหัสใหม่ (ยังไม่กระทบ live)
1. เปิด `tools/supabase-auth-setup.html` ผ่าน http (`python -m http.server 8000` → `http://localhost:8000/tools/supabase-auth-setup.html`)
2. เอา **service_role key** จาก Supabase → Project Settings → API → `service_role · secret` (กด Reveal) → วางในช่อง
   > 🔐 key นี้อยู่แค่ในเบราว์เซอร์คุณ ไม่ถูกบันทึก/ไม่ขึ้น repo
3. กด **สร้าง / อัปเดตผู้ใช้ทั้งหมด** → ตารางจะโชว์ **รหัสผ่านใหม่** ของแต่ละคน (โชว์ครั้งเดียว)
4. **ก็อปรหัสทั้งหมด (กล่องล่าง) เก็บไว้ → แจกทีมทีหลัง** (อย่าเพิ่งแจกจนกว่าจะ deploy ขั้น C)
5. (ความปลอดภัย) ทำเสร็จ **หมุน service_role key** ใน Supabase ได้ (แอปใช้แค่ anon key)

## ขั้น B — ปิดช่องสมัครเอง (กันคนนอกสร้างบัญชี)
- Supabase → **Authentication → Sign In / Providers → Email** → ปิด **"Allow new users to sign up"**
  (เราสร้าง user ผ่าน admin แล้ว ไม่ต้องเปิดให้สมัครเอง)

## ขั้น C — deploy โค้ด login แบบ Supabase Auth (ยังไม่เปิด RLS)
> โค้ดส่วนนี้ (login → `supabase.auth.signInWithPassword`, adapter โหลดหลัง auth, ลบรหัสจาก config.js)
> จะถูกทำ + ทดสอบใน preview ก่อน push. หลัง push:
- ทุกคนต้อง **re-login ด้วยรหัสใหม่** (จากขั้น A) — แจกรหัสตอนนี้
- ตอนนี้ RLS **ยังปิด** → ถ้าใครยังไม่อัปเดตหน้า แอปยังพออ่านได้ (anon) — ช่วงเปลี่ยนผ่านนุ่มนวล
- ยืนยันว่าทุกคน login ด้วยรหัสใหม่ผ่าน + ใช้งานได้

## ขั้น D — เปิด RLS (ล็อกจริง) — ทำเป็นขั้นสุดท้าย
1. ให้แน่ใจว่า **ทุกเครื่อง reload เข้าโค้ด login ใหม่แล้ว** (ขั้น C)
2. Supabase → SQL Editor → วาง [supabase/rls-phase4.sql](../supabase/rls-phase4.sql) → Run
3. ทดสอบทันที: คนที่ login อยู่ → ใช้งานได้ปกติ · เปิดลิงค์แบบไม่ login (incognito) → ต้องไม่เห็นข้อมูล
4. **ถ้าพัง:** รัน ROLLBACK block (คอมเมนต์อยู่หัวไฟล์ rls-phase4.sql) ปิด RLS กลับทันที

---

## หลังเปิด RLS แล้ว สิทธิ์เป็นยังไง
| role | อ่าน DB | เขียน DB (เพิ่ม/แก้/ลบ) |
|---|---|---|
| manager | ✓ | ✓ |
| staff | ✓ | ✓ |
| viewer | ✓ (เฉพาะหน้าที่ UI อนุญาต) | ✗ |
| owner | ✓ | ✗ |
| ไม่ login (anon) | ✗ | ✗ |

- role มาจาก JWT (`app_metadata.role` ที่ฝังตอนสร้าง user) — user เปลี่ยน role ตัวเองไม่ได้
- presence (ใครออนไลน์): ทุกคนที่ login เขียน heartbeat ได้
- audit_log: ทุกคนเขียนได้ · อ่านได้เฉพาะ manager

## เพิ่ม/แก้ user ภายหลัง
- เพิ่มคนใหม่/เปลี่ยนรหัส/เปลี่ยน role → แก้ `USERS` ใน config.js (username/role/displayName) แล้วรัน
  `tools/supabase-auth-setup.html` อีกครั้ง (สร้างใหม่ / ตั้งรหัสใหม่ทับของเดิม)
- หรือทำตรงใน Supabase → Authentication → Users (ตั้ง app_metadata.role เองด้วย)

## ถอยกลับทั้งหมด (กรณีฉุกเฉิน)
- ปิด RLS: ROLLBACK block หัวไฟล์ rls-phase4.sql
- ถอย login เป็นแบบเดิม: `git revert` commit ของ Phase 4 (หรือสลับ `BACKEND:'sheets'`)
