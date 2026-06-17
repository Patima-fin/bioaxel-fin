-- =====================================================================
-- Water POG — Phase 5: ตาราง P&L + Budget ใน Supabase (ย้ายจาก Google Sheet)
-- =====================================================================
-- รันใน Supabase SQL Editor (หลัง Phase 4 RLS เปิดแล้ว).
-- 2 ตารางนี้เก็บข้อมูลที่หน้า P&L / Budget เคยอ่านจาก Google Sheet:
--   pnlBase  = "ฐาน DATA" (P&L) — 1 แถว/รหัสบัญชี: {group,code,name,m1..m12,updatedAt}
--   budgetHo = "BUDGET HO" (Budget) — 1 แถว/dept|acct: {dept,deptName,acct,desc,cat,b1..b12,a1..a12}
-- โครงเดียวกับตารางอื่น (id text PK / data jsonb / updated_at) + RLS เปิดเหมือนกัน.
-- =====================================================================

create table if not exists "pnlBase"  ("id" text primary key, "data" jsonb not null default '{}', "updated_at" timestamptz not null default now());
create table if not exists "budgetHo" ("id" text primary key, "data" jsonb not null default '{}', "updated_at" timestamptz not null default now());

-- trigger updated_at (ใช้ฟังก์ชัน public.set_updated_at() ที่สร้างไว้ใน schema.sql แล้ว)
drop trigger if exists set_updated_at on "pnlBase";
drop trigger if exists set_updated_at on "budgetHo";
create trigger set_updated_at before update on "pnlBase"  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on "budgetHo" for each row execute function public.set_updated_at();

-- realtime
alter publication supabase_realtime add table "pnlBase";
alter publication supabase_realtime add table "budgetHo";

-- grant (RLS จะคุมจริงอีกชั้น)
grant all on "pnlBase", "budgetHo" to anon, authenticated, service_role;

-- ── RLS ของ pnlBase/budgetHo ถูกย้ายไปเปิดพร้อมตารางอื่นใน rls-phase4.sql (STEP 5) ──
--    เหตุผล: ตอน bootstrap (ลำดับ schema.sql → pnl-budget.sql → [ทีหลัง] rls-phase4.sql)
--    public.auth_role() ยังไม่ถูกสร้าง — ไฟล์นี้จึงสร้างแค่ ตาราง/trigger/realtime/grant
--    แล้วปล่อยให้ rls-phase4.sql เป็นที่เดียวที่เปิด RLS ทุกตาราง (รวม 2 ตารางนี้).
