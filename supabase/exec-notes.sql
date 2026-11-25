-- =====================================================================
-- BIOAXEL · ตาราง execNotes — "โน้ตของฉัน" ในกล่อง ✦ บทวิเคราะห์ (โหมดผู้นำเสนอ · app/exec_notes.js)
-- ---------------------------------------------------------------------
-- 1 แถว = โน้ต 1 กรอบ ของ 1 ช่วงเวลา:
--   id   = '<period>|<frameKey>'   เช่น 'cf:2026.10|summary.ending' · 'pnl:2569-10|pnl.kpi' · 'bal:31 ธันวาคม 2568|bal.hero'
--   data = { period, frameKey, note, updatedBy }
-- อ่าน/เขียนผ่าน WTPData.fetchSheetRows('execNotes') / WTPData.upsertSheetRows('execNotes', …)
--   (execNotes ∈ SHEET_TABLES ใน app/data_supabase.js)
-- RLS: อ่านได้ทุกคนที่ล็อกอิน · เขียนได้ presenter (บัญชีผู้นำเสนอ) + staff/manager
--   ★ บัญชีผู้นำเสนอเขียนตารางอื่นไม่ได้ (p_write ของทุกตารางให้แค่ staff/manager — rls-phase4.sql)
--     ตารางนี้ตารางเดียวที่ presenter เขียนได้ (แบบเดียวกับ server ของ Water POG)
-- รันครั้งเดียวใน Supabase SQL editor (idempotent — รันซ้ำได้)
-- =====================================================================

create table if not exists "execNotes" ("id" text primary key, "data" jsonb not null default '{}', "updated_at" timestamptz not null default now());

-- updated_at trigger (ใช้ฟังก์ชันเดิมจาก schema.sql)
do $$ begin
  drop trigger if exists set_updated_at on "execNotes";
  create trigger set_updated_at before update on "execNotes" for each row execute function public.set_updated_at();
end $$;

grant all on "execNotes" to anon, authenticated, service_role;

alter table "execNotes" enable row level security;
do $$ begin
  drop policy if exists "execNotes_read"  on "execNotes";
  create policy "execNotes_read"  on "execNotes" for select to authenticated using (true);
  drop policy if exists "execNotes_write" on "execNotes";
  create policy "execNotes_write" on "execNotes" for all to authenticated
    using (public.auth_role() in ('presenter','staff','manager')) with check (public.auth_role() in ('presenter','staff','manager'));
end $$;

-- ตรวจหลังรัน (ควรได้ 2 policy):
--   select policyname, cmd from pg_policies where tablename = 'execNotes';
