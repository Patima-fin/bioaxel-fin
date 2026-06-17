-- =====================================================================
-- Water POG Financial Console — Supabase (Postgres) schema
-- =====================================================================
-- รันไฟล์นี้ครั้งเดียวใน Supabase → SQL Editor → New query → วาง → Run.
--
-- ดีไซน์: แต่ละ entity ของแอป = 1 ตาราง รูปแบบ generic JSONB
--   "id"         text   PRIMARY KEY   — id เดิมของแถว (เช่น 'id_xxx') ที่แอปสร้าง
--   "data"       jsonb                — ทั้งแถว (รวม field id ในตัว) เก็บเป็น JSON
--   "updated_at" timestamptz          — เซ็ตอัตโนมัติทุกครั้งที่ UPDATE (trigger)
--
-- ทำไม JSONB: field ของแอปเปลี่ยนรูปบ่อย (seed vs synced UPPER, projects ~120
--   คอลัมน์, field ถูกเพิ่ม/ลบ ad-hoc) → ถ้าใช้คอลัมน์จริงต้องแก้ DDL ตลอด.
--   JSONB ยืดหยุ่น + ทำ realtime + RLS ระดับตารางได้ + map ตรงกับ {id, ...data}.
--
-- ★ ชื่อตาราง = ชื่อ entity ของแอป "เป๊ะ" (camelCase) → ต้องใส่ double-quote
--   ทุกที่ (Postgres จะ fold เป็น lowercase ถ้าไม่ quote — แล้ว PostgREST/supabase-js
--   ที่ case-sensitive จะหาไม่เจอ). adapter เรียก sb.from('forecastEntries') ตรง ๆ.
--
-- ★ SECURITY (Phase 1): RLS ปิดไว้ก่อน + grant ให้ anon/authenticated เต็ม →
--   anon key อ่าน/เขียนได้ (โพสเจอร์ความปลอดภัยเดียวกับ Apps Script เดิมที่เปิดอยู่).
--   Phase 4: เปิด RLS + policy ต่อ role (ดูบล็อกคอมเมนต์ท้ายไฟล์).
-- =====================================================================

-- ── 1) ตาราง CRUD ทั้ง 23 (เท่ากับ CRUD_KEYS ใน data.js) ───────────────────
-- รูปแบบเดียวกันทุกตาราง: id text PK + data jsonb + updated_at
create table if not exists "projects"          ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "invoices"          ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "forecastEntries"   ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "bankAccounts"      ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "pvVouchers"        ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "payables"          ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "debtLedger"        ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "receipts"          ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "bankEntries"       ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "checks"            ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "debtMaster"        ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "bankTransfers"     ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "stsServiceFee"     ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "stsPendingCalc"    ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "stsCalcResult"     ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "debtEvents"        ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "users"             ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "cashflowSnapshots" ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "followUpsLog"      ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "manualOverrides"   ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "bankReconLines"    ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "bankReconState"    ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());
create table if not exists "presence"          ("id" text primary key, "data" jsonb not null default '{}'::jsonb, "updated_at" timestamptz not null default now());

-- ── 2) audit_log — บันทึก "ใครเขียนอะไร" (adapter เขียน best-effort ทุก push) ──
--   identity PK (ไม่ต้องส่ง id ตอน insert). Phase 4 จะย้ายไปเป็น Postgres trigger
--   เขียนเอง (ตอนนี้ client เขียน → ยังเชื่อ identity ที่ client ส่งมา เหมือนของเดิม).
create table if not exists "audit_log" (
  "id"           bigint generated always as identity primary key,
  "ts"           timestamptz not null default now(),
  "username"     text,
  "display_name" text,
  "role"         text,
  "action"       text,
  "entity"       text,
  "summary"      text,
  "detail"       jsonb
);
create index if not exists "audit_log_ts_idx" on "audit_log" ("ts" desc);

-- ── 3) trigger เซ็ต updated_at อัตโนมัติทุก UPDATE ─────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new."updated_at" = now();
  return new;
end $$;

-- ── 4) ต่อ trigger + GIN index + realtime + grant ให้ครบทุกตาราง (วนลูป) ──────
--   ใช้ลูปเพื่อไม่ต้องเขียนซ้ำ 23 รอบ + กันพิมพ์ตก. %I = quote identifier ให้เอง.
do $$
declare
  t text;
  names text[] := array[
    'projects','invoices','forecastEntries','bankAccounts','pvVouchers','payables',
    'debtLedger','receipts','bankEntries','checks','debtMaster','bankTransfers',
    'stsServiceFee','stsPendingCalc','stsCalcResult','debtEvents','users',
    'cashflowSnapshots','followUpsLog','manualOverrides',
    'bankReconLines','bankReconState','presence'
  ];
begin
  foreach t in array names loop
    -- updated_at trigger
    execute format('drop trigger if exists set_updated_at on %I', t);
    execute format('create trigger set_updated_at before update on %I for each row execute function public.set_updated_at()', t);
    -- GIN index บน data (ช่วย query/รายงานในอนาคต — optional แต่เบาพอ)
    execute format('create index if not exists %I on %I using gin (data)', t || '_data_gin', t);
    -- เปิด realtime (push) — ถ้าเคย add แล้วจะ error → กลืนไว้
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when others then null;
    end;
    -- grant (RLS ปิด → anon/authenticated ต้องมีสิทธิ์ระดับตาราง)
    execute format('grant select, insert, update, delete on table %I to anon, authenticated', t);
  end loop;
end $$;

-- audit_log: grant + realtime (ไม่บังคับ realtime แต่ให้ insert ได้)
grant select, insert on table "audit_log" to anon, authenticated;

-- =====================================================================
-- Phase 4 (ภายหลัง) — เปิด RLS + policy ต่อ role. ตอนนี้ comment ไว้.
-- ตัวอย่างแนวทาง (ต้องผูกกับ Supabase Auth ก่อน — ดู setup guide):
--
--   alter table "invoices" enable row level security;
--   create policy "read all (authenticated)" on "invoices"
--     for select to authenticated using (true);
--   create policy "write staff+manager" on "invoices"
--     for all to authenticated
--     using  ( (auth.jwt() ->> 'role') in ('staff','manager') )
--     with check ( (auth.jwt() ->> 'role') in ('staff','manager') );
--   -- viewer/owner = อ่านอย่างเดียว (ไม่มี policy for all)
--
-- จนกว่าจะถึง Phase 4: RLS ปิด, anon key ทำ CRUD ได้ — เก็บ URL/anon key
-- ไว้ภายในทีม (เหมือน Apps Script URL เดิมที่เปิดอยู่).
-- =====================================================================
