-- =====================================================================
-- Water POG — Phase 4 RLS (Row Level Security) per-role
-- =====================================================================
-- ★★ อย่ารันไฟล์นี้จนกว่า: (1) สร้าง Supabase Auth users เสร็จ (auth-setup tool)
--    (2) deploy โค้ด login แบบ Supabase Auth ขึ้น live แล้ว (3) ทุกคน re-login ด้วยรหัสใหม่
--    เพราะเมื่อเปิด RLS → anon (ยังไม่ login) แตะ DB ไม่ได้ทันที → แท็บที่ยังไม่ใช้โค้ด auth จะว่าง.
--
-- role อ่านจาก JWT (app_metadata.role ที่ฝังตอนสร้าง user):
--   viewer / owner  = อ่านอย่างเดียว (SELECT)
--   staff / manager = อ่าน + เขียน (INSERT/UPDATE/DELETE)
--   anon (ไม่ login) = แตะไม่ได้เลย
--
-- ROLLBACK ทันที (ถ้าหลังเปิดแล้วมีปัญหา) — รันบล็อกนี้เพื่อปิด RLS กลับ:
--   do $$ declare t text; names text[] := array['projects','invoices','forecastEntries',
--     'bankAccounts','pvVouchers','payables','debtLedger','receipts','bankEntries','checks',
--     'debtMaster','bankTransfers','stsServiceFee','stsPendingCalc','stsCalcResult','debtEvents',
--     'users','cashflowSnapshots','followUpsLog','manualOverrides','bankReconLines',
--     'bankReconState','presence','audit_log'];
--   begin foreach t in array names loop execute format('alter table %I disable row level security', t); end loop; end $$;
-- =====================================================================

-- helper: role ปัจจุบันจาก JWT (default 'viewer' ถ้าไม่มี)
create or replace function public.auth_role()
returns text language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'viewer');
$$;

-- ── 23 entity tables: เปิด RLS + อ่านได้ทุก role ที่ login + เขียนเฉพาะ staff/manager ──
do $$
declare
  t text;
  ents text[] := array[
    'projects','invoices','forecastEntries','bankAccounts','pvVouchers','payables',
    'debtLedger','receipts','bankEntries','checks','debtMaster','bankTransfers',
    'stsServiceFee','stsPendingCalc','stsCalcResult','debtEvents','users',
    'cashflowSnapshots','followUpsLog','manualOverrides','bankReconLines','bankReconState',
    'pnlBase','budgetHo'
  ];
begin
  foreach t in array ents loop
    execute format('alter table %I enable row level security', t);
    -- ล้าง policy เดิม (รันซ้ำได้)
    execute format('drop policy if exists p_read  on %I', t);
    execute format('drop policy if exists p_write on %I', t);
    -- อ่าน: ทุกคนที่ login (viewer/owner/staff/manager)
    execute format('create policy p_read on %I for select to authenticated using (true)', t);
    -- เขียน (insert/update/delete): เฉพาะ staff/manager
    execute format($f$create policy p_write on %I for all to authenticated
        using (public.auth_role() in ('staff','manager'))
        with check (public.auth_role() in ('staff','manager'))$f$, t);
  end loop;
end $$;

-- ── presence: ทุกคนที่ login เขียน heartbeat ของตัวเองได้ (รวม viewer/owner ให้ขึ้น "ออนไลน์") ──
alter table "presence" enable row level security;
drop policy if exists p_read on "presence";
drop policy if exists p_write on "presence";
create policy p_read  on "presence" for select to authenticated using (true);
create policy p_write on "presence" for all    to authenticated using (true) with check (true);

-- ── audit_log: ทุกคน login เขียนได้ (client บันทึก audit) · อ่านเฉพาะ manager ──
alter table "audit_log" enable row level security;
drop policy if exists p_insert on "audit_log";
drop policy if exists p_read   on "audit_log";
create policy p_insert on "audit_log" for insert to authenticated with check (true);
create policy p_read   on "audit_log" for select to authenticated using (public.auth_role() = 'manager');

-- ตรวจหลังรัน: เปิด Authentication → ปิด "Allow new users to sign up" (กันคนสมัครเอง)
-- + (ถ้าเคยปิด) เปิด "Confirm email" กลับได้ — เราใช้ admin createUser (email_confirm:true) อยู่แล้ว
