-- =====================================================================
-- BIOAXEL — ตาราง cashflowPresent (หน้า "พรีเซนต์ Cash Flow" #cashflow_present)
-- =====================================================================
-- รันใน Supabase SQL Editor ครั้งเดียว (BIOAXEL project tfcxbcekxwnncdqiqzav).
-- เก็บข้อมูลที่อัปโหลดในหน้าพรีเซนต์แคชโฟลว์ "ส่วนกลาง" ให้ทั้งทีม/ผู้บริหารเห็นชุดเดียวกัน
-- (เดิมเก็บ localStorage `bio-cfpresent-v1` ต่อเครื่อง → เห็นแค่คนอัป).
--   1 แถว id='current': data = { id, stm:{txns,...}, summary, uploadedAt, uploadedBy }
-- โครงเดียวกับตารางอื่น (id text PK / data jsonb / updated_at). อ่าน/เขียนผ่าน
--   WTPData.fetchSheetRows('cashflowPresent') / WTPData.writeTable('cashflowPresent', …)
--   (cashflowPresent อยู่ใน SHEET_TABLES ของ data_supabase.js).
-- =====================================================================

create table if not exists "cashflowPresent" ("id" text primary key, "data" jsonb not null default '{}', "updated_at" timestamptz not null default now());

-- trigger updated_at (ใช้ฟังก์ชัน public.set_updated_at() ที่สร้างไว้ใน schema.sql แล้ว)
drop trigger if exists set_updated_at on "cashflowPresent";
create trigger set_updated_at before update on "cashflowPresent" for each row execute function public.set_updated_at();

-- realtime (เผื่อแท็บที่เปิดค้างอัปเดตเอง — optional)
alter publication supabase_realtime add table "cashflowPresent";

-- grant (RLS จะคุมจริงอีกชั้นใน rls-phase4.sql)
grant all on "cashflowPresent" to anon, authenticated, service_role;

-- ── RLS เปิดพร้อมตารางอื่นใน rls-phase4.sql (STEP 5) — read=authenticated, write=staff/manager ──
