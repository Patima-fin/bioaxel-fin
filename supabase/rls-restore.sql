-- =====================================================================
-- BIOAXEL — กู้คืน RLS  (แก้เหตุ 2026-09-03: เผลอรัน rls-off-bootstrap.sql ของ
--   BIGDREAM ใน project BIOAXEL → RLS ถูกปิดทุกตาราง = anon key เข้าถึงได้หมด)
-- =====================================================================
-- ★ รันใน SQL Editor ของ project BIOAXEL (ref: tfcxbcekxwnncdqiqzav) เท่านั้น
--
-- ไฟล์นี้ = rls-phase4.sql เดิม + bankReconBook/bankReconMatch + "guard กันวางผิด":
--   ถ้าตาราง invoices ว่างเปล่า (แปลว่ากำลังรันใน BIGDREAM ที่ยังไม่มีข้อมูล)
--   จะ raise exception → rollback ทั้งก้อน ไม่มีอะไรถูกแก้
--
-- รันซ้ำได้ ไม่พัง (drop policy if exists ก่อน create ทุกครั้ง)
-- =====================================================================

-- helper: role ปัจจุบันจาก JWT (default 'viewer' ถ้าไม่มี) — สร้างทับได้ ไม่มีผลข้างเคียง
create or replace function public.auth_role()
returns text language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'viewer');
$$;

do $$
declare
  t text;
  ents text[] := array[
    'projects','invoices','forecastEntries','bankAccounts','pvVouchers','payables',
    'debtLedger','receipts','bankEntries','checks','debtMaster','bankTransfers',
    'stsServiceFee','stsPendingCalc','stsCalcResult','debtEvents','users',
    'cashflowSnapshots','followUpsLog','manualOverrides','bankReconLines','bankReconState',
    'bankReconBook','bankReconMatch','pnlBase','budgetHo','cashflowPresent'
  ];
begin
  -- ── GUARD: ยืนยันว่านี่คือ BIOAXEL (มีข้อมูลจริง) ไม่ใช่ BIGDREAM (ว่าง) ──
  if (select count(*) from "invoices") = 0 then
    raise exception E'หยุด! ตาราง invoices ว่างเปล่า → project นี้ไม่ใช่ BIOAXEL\n'
      'ไฟล์นี้ใช้กู้ RLS ของ BIOAXEL เท่านั้น (ref tfcxbcekxwnncdqiqzav)\n'
      'ยกเลิกทั้งหมดแล้ว ไม่มีอะไรถูกแก้ไข';
  end if;

  -- ── entity tables: เปิด RLS + อ่านได้ทุก role ที่ login + เขียนเฉพาะ staff/manager ──
  foreach t in array ents loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists p_read  on %I', t);
    execute format('drop policy if exists p_write on %I', t);
    execute format('create policy p_read on %I for select to authenticated using (true)', t);
    execute format($f$create policy p_write on %I for all to authenticated
        using (public.auth_role() in ('staff','manager'))
        with check (public.auth_role() in ('staff','manager'))$f$, t);
    -- policy ชื่อเก่าจาก bankrecon-express.sql — ลบทิ้ง กันซ้อนกันสองชุด
    execute format('drop policy if exists "%s_read"  on %I', t, t);
    execute format('drop policy if exists "%s_write" on %I', t, t);
  end loop;

  -- ── presence: ทุกคนที่ login เขียน heartbeat ของตัวเองได้ (รวม viewer/owner) ──
  execute 'alter table "presence" enable row level security';
  execute 'drop policy if exists p_read  on "presence"';
  execute 'drop policy if exists p_write on "presence"';
  execute 'create policy p_read  on "presence" for select to authenticated using (true)';
  execute 'create policy p_write on "presence" for all    to authenticated using (true) with check (true)';

  -- ── audit_log: ทุกคน login เขียนได้ (client บันทึก audit) · อ่านเฉพาะ manager ──
  execute 'alter table "audit_log" enable row level security';
  execute 'drop policy if exists p_insert on "audit_log"';
  execute 'drop policy if exists p_read   on "audit_log"';
  execute 'create policy p_insert on "audit_log" for insert to authenticated with check (true)';
  execute 'create policy p_read   on "audit_log" for select to authenticated using (public.auth_role() = ''manager'')';
end $$;

notify pgrst, 'reload schema';

-- =====================================================================
-- ตรวจผล — ต้องได้ 0 แถว (= ไม่มีตารางไหนที่ RLS ยังปิดอยู่)
-- =====================================================================
select c.relname as rls_still_off
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1;
