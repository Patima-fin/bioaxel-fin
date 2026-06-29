-- =====================================================================
-- BIOAXEL — ตารางกระทบยอด Express ↔ Bank Statement (#bank_recon → แท็บ "เทียบ Express")
-- =====================================================================
-- รันใน Supabase SQL Editor "ครั้งเดียว" (โปรเจกต์ BIOAXEL).
--
--   bankReconBook  = สมุดบัญชี (movements/outstanding/meta จากไฟล์ "งบกระทบยอด Express")
--   bankReconMatch = การจับคู่ที่ "ยืนยันแล้ว/จับคู่เอง" (M-to-N = bookIds[]/stmIds[] ในแถวเดียว)
--
-- ★ ทุกบล็อกที่ "อาจพึ่งฟังก์ชัน/publication ที่อาจไม่มี" ถูกห่อด้วย
--   `do $$ ... exception when others then null; end $$;` → ถ้าส่วนนั้นพลาด
--   สคริปต์จะ "ไม่ rollback" และ "ตารางยังถูกสร้าง" เสมอ (กันเคส SQL Editor รันเป็น 1 transaction).
-- =====================================================================

-- 1) ตาราง (สำคัญสุด — ต้องสำเร็จก่อน)
create table if not exists "bankReconBook"  ("id" text primary key, "data" jsonb not null default '{}', "updated_at" timestamptz not null default now());
create table if not exists "bankReconMatch" ("id" text primary key, "data" jsonb not null default '{}', "updated_at" timestamptz not null default now());

-- 2) trigger updated_at (ใช้ public.set_updated_at() จาก schema.sql — guarded เผื่อไม่มี)
do $$ begin
  drop trigger if exists set_updated_at on "bankReconBook";
  create trigger set_updated_at before update on "bankReconBook"  for each row execute function public.set_updated_at();
exception when others then null; end $$;
do $$ begin
  drop trigger if exists set_updated_at on "bankReconMatch";
  create trigger set_updated_at before update on "bankReconMatch" for each row execute function public.set_updated_at();
exception when others then null; end $$;

-- 3) realtime (guarded — ถ้าอยู่ใน publication แล้ว/ไม่มี publication ก็ข้าม)
do $$ begin alter publication supabase_realtime add table "bankReconBook";  exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table "bankReconMatch"; exception when others then null; end $$;

-- 4) grant
grant all on "bankReconBook"  to anon, authenticated, service_role;
grant all on "bankReconMatch" to anon, authenticated, service_role;

-- 5) RLS: read=ทุก authenticated · write=staff/manager (ใช้ public.auth_role() จาก rls-phase4.sql — guarded)
alter table "bankReconBook"  enable row level security;
alter table "bankReconMatch" enable row level security;
do $$ begin
  drop policy if exists "bankReconBook_read"  on "bankReconBook";
  create policy "bankReconBook_read"  on "bankReconBook"  for select to authenticated using (true);
  drop policy if exists "bankReconBook_write" on "bankReconBook";
  create policy "bankReconBook_write" on "bankReconBook"  for all to authenticated
    using (public.auth_role() in ('staff','manager')) with check (public.auth_role() in ('staff','manager'));
  drop policy if exists "bankReconMatch_read"  on "bankReconMatch";
  create policy "bankReconMatch_read"  on "bankReconMatch" for select to authenticated using (true);
  drop policy if exists "bankReconMatch_write" on "bankReconMatch";
  create policy "bankReconMatch_write" on "bankReconMatch" for all to authenticated
    using (public.auth_role() in ('staff','manager')) with check (public.auth_role() in ('staff','manager'));
exception when others then null; end $$;

-- 6) บอก PostgREST ให้ reload schema cache (กัน PGRST205 "table not found in schema cache")
notify pgrst, 'reload schema';

-- =====================================================================
-- ตรวจผล (รันแยกได้): ต้องได้ 2 แถว
--   select tablename from pg_tables where tablename in ('bankReconBook','bankReconMatch');
-- ถ้าได้ 2 แถวแต่แอปยัง 404 → schema cache ยังไม่รีเฟรช: รัน  notify pgrst, 'reload schema';  ซ้ำ แล้วรอ ~30 วิ
-- =====================================================================
