-- =====================================================================
-- BIOAXEL · ตาราง cfCoding — หน้า "ลงรหัสงบกระแสเงินสด" (#cf_coding)
-- ---------------------------------------------------------------------
-- เก็บ 3 ชนิดแถว (blob ต่อ id — อ่าน/เขียนผ่าน WTPData.fetchSheetRows/writeTable
-- เพราะ cfCoding ∈ SHEET_TABLES ใน app/data_supabase.js):
--   id = 'master'              → หมวดมาตรฐาน { items:[{name,act,group}] }
--   id = 'rules'               → กฎที่เรียนรู้ { map: { "text:…"|"vendor:…"|"doc:…" : {cat,n,by,at} } }
--   id = 'lines:<acct>:<ym>'   → บรรทัดดิบจากงบกระทบยอด 1 บัญชี 1 เดือน
-- รันครั้งเดียวใน Supabase SQL editor (idempotent — รันซ้ำได้)
-- =====================================================================

create table if not exists "cfCoding" ("id" text primary key, "data" jsonb not null default '{}', "updated_at" timestamptz not null default now());

-- updated_at trigger (ใช้ฟังก์ชันเดิมจาก schema.sql)
do $$ begin
  drop trigger if exists set_updated_at on "cfCoding";
  create trigger set_updated_at before update on "cfCoding" for each row execute function public.set_updated_at();
end $$;

create index if not exists "cfCoding_data_gin" on "cfCoding" using gin (data);

-- realtime (ถ้าเคย add แล้วจะ error → กลืนไว้)
do $$ begin alter publication supabase_realtime add table "cfCoding"; exception when others then null; end $$;

grant all on "cfCoding" to anon, authenticated, service_role;

-- RLS: อ่านได้ทุกคนที่ล็อกอิน · เขียนได้เฉพาะ manager/staff (แนวเดียวกับ bankRecon*)
alter table "cfCoding" enable row level security;
do $$ begin
  drop policy if exists "cfCoding_read"  on "cfCoding";
  create policy "cfCoding_read"  on "cfCoding" for select to authenticated using (true);
  drop policy if exists "cfCoding_write" on "cfCoding";
  create policy "cfCoding_write" on "cfCoding" for all to authenticated
    using (public.auth_role() in ('staff','manager')) with check (public.auth_role() in ('staff','manager'));
end $$;
