-- =====================================================================
-- BIOAXEL · ตาราง guarantees — หน้า "หลักค้ำประกันสัญญา" (#guarantees)
-- ---------------------------------------------------------------------
-- 1 แถว = หลักค้ำประกันของ 1 สัญญา (คีย์เชื่อมกับหน้าโครงการ = data->>'contractNo')
-- เป็น CRUD entity ปกติ (อยู่ใน CRUD_ENTITIES ของ app/data_supabase.js) → โหลดตอนเปิดเว็บ + realtime
-- ★ ต้องรันไฟล์นี้ "ก่อน" deploy โค้ดหน้า guarantees — ไม่งั้นเว็บโหลดตารางนี้ไม่ได้
--   แถบ sync จะขึ้นสถานะผิดพลาด (ตารางอื่นยังใช้งานได้ปกติ)
-- รันครั้งเดียวใน Supabase SQL editor (idempotent — รันซ้ำได้)
-- =====================================================================

create table if not exists "guarantees" ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());

-- updated_at trigger (ใช้ฟังก์ชันเดิมจาก schema.sql)
do $$ begin
  drop trigger if exists set_updated_at on "guarantees";
  create trigger set_updated_at before update on "guarantees" for each row execute function public.set_updated_at();
end $$;

create index if not exists "guarantees_data_gin" on "guarantees" using gin (data);

-- realtime (ถ้าเคย add แล้วจะ error → กลืนไว้)
do $$ begin alter publication supabase_realtime add table "guarantees"; exception when others then null; end $$;

grant all on "guarantees" to anon, authenticated, service_role;

-- RLS: อ่านได้ทุกคนที่ล็อกอิน · เขียนได้เฉพาะ manager/staff (แนวเดียวกับตารางอื่น)
alter table "guarantees" enable row level security;
do $$ begin
  drop policy if exists "guarantees_read"  on "guarantees";
  create policy "guarantees_read"  on "guarantees" for select to authenticated using (true);
  drop policy if exists "guarantees_write" on "guarantees";
  create policy "guarantees_write" on "guarantees" for all to authenticated
    using (public.auth_role() in ('staff','manager')) with check (public.auth_role() in ('staff','manager'));
end $$;
