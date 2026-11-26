-- =====================================================================
-- BIOAXEL · ตาราง presentSync — "กระดานกลาง" ของโหมดแคสหน้าจอ (app/present_sync.js)
-- ---------------------------------------------------------------------
-- ไอแพด (บัญชีผู้นำเสนอ) เขียนว่าอยู่หน้าไหน / แท็บ-ช่วงเวลาไหน / เลื่อนถึงกรอบไหน
-- → คอมที่ต่อทีวี (บัญชีปกติ กด "📡 โหมดแคสหน้าจอ") อ่านทุก 0.35 วิ แล้วแสดงตาม
-- แถว 'd:<รหัสเครื่อง>' = หน้าจอของผู้นำเสนอแต่ละเครื่อง · data = { route, tab, period, view, key, idx, ratio, top, page, focus, ptr, who, seq, t }
-- แถว 'main' = { owner: รหัสเครื่องที่กำลังแคส, name } (หลายคนนำเสนอ · 2026-11-26 — ใช้ตาราง/RLS เดิม ไม่ต้องรันไฟล์นี้ซ้ำ)
--   (แบบตาราง present_sync ของเว็บ Benya · Water POG เก็บในหน่วยความจำ server แทน)
-- อ่าน/เขียนผ่าน WTPData.presentSyncList / presentSyncPut (app/data_supabase.js) — ไม่ลง audit_log
-- RLS: อ่านได้ทุกคนที่ล็อกอิน · เขียนได้เฉพาะ presenter (บัญชีผู้นำเสนอ)
-- รันครั้งเดียวใน Supabase SQL editor (idempotent — รันซ้ำได้)
-- =====================================================================

create table if not exists "presentSync" ("id" text primary key, "data" jsonb not null default '{}', "updated_at" timestamptz not null default now());

-- updated_at trigger (ใช้ฟังก์ชันเดิมจาก schema.sql) — ทีวีใช้ updated_at เป็นตัวบอกว่าไอแพดขยับแล้ว
do $$ begin
  drop trigger if exists set_updated_at on "presentSync";
  create trigger set_updated_at before update on "presentSync" for each row execute function public.set_updated_at();
end $$;

grant all on "presentSync" to anon, authenticated, service_role;

alter table "presentSync" enable row level security;
do $$ begin
  drop policy if exists "presentSync_read"  on "presentSync";
  create policy "presentSync_read"  on "presentSync" for select to authenticated using (true);
  drop policy if exists "presentSync_write" on "presentSync";
  create policy "presentSync_write" on "presentSync" for all to authenticated
    using (public.auth_role() = 'presenter') with check (public.auth_role() = 'presenter');
end $$;

-- ให้ PostgREST เห็นตารางใหม่ทันที (ไม่งั้นอาจได้ PGRST205 สักพัก)
notify pgrst, 'reload schema';

-- ตรวจหลังรัน (ควรได้ 2 policy):
--   select policyname, cmd from pg_policies where tablename = 'presentSync';
