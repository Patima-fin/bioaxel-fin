/* page_cashflow.jsx — แผนประมาณการจ่ายรายสัปดาห์ (redesigned 2026-05-26)
 *
 * Layout (3 sections):
 *  A. Strategic Management headline + 4 KPI tiles (B/F, LOAN, INFLOW, OUTFLOW)
 *     with Forecast/Actual/% for each
 *  B. Plan section — 3 columns: CURRENT WEEK | REST OF MONTH | TOTAL
 *     Inflow rows: B/F, project receipts, loan forecast
 *     Outflow rows: 4 categories (Operating / Project / Finance / Salary)
 *  C. Weekly Actual Tracking — 5 small tables side-by-side, plus Grand Total
 *
 * Data sources:
 *  - cashflowSnapshots — daily bank balance snapshots
 *  - bankAccounts — live balance (sum of main accounts)
 *  - invoices — INFLOW forecast (expectedReceive in month) + actual (actualReceive)
 *  - payables — OUTFLOW forecast (group by due2 week × category)
 *  - pvVouchers — OUTFLOW actual (group by Pmt_Date week × category)
 *  - forecastEntries — manual entries with new STATUS lifecycle
 *    (PLANNED / ACTUAL / BOOKED / CANCELED) + CFS_ACTIVITY field
 *
 * Category mapping (4 categories for outflow):
 *  1 = ดำเนินงาน (operating, default)
 *  2 = โครงการ (project — has jobcode in payables)
 *  3 = ฝ่ายการเงิน (FIN — dpt_code='FIN' OR forecastEntry.CATEGORY=3)
 *  4 = เงินเดือน (salary — forecastEntry.CATEGORY=4)
 *
 * AP-PV match:
 *  - Exclude payables where vchno equals any pvVouchers.AP_No (already paid)
 *
 * Week convention:
 *  - Monday-based bucketing within the month
 *  - W1 may be partial (days before first Monday)
 *  - Max 5 weeks per month, fewer if month is short
 */
'use strict';

const { useState: cfState, useMemo: cfMemo, useEffect: cfEffect } = React;

// ─── Week helpers ──────────────────────────────────────────────────────────
function getMonthWeeksMonday(year, month) {
  // month is 1-indexed (Jan = 1)
  const lastDay = new Date(year, month, 0).getDate();
  const buckets = [];
  // Find first Monday day-of-month (1..7)
  let firstMonday = -1;
  for (let d = 1; d <= 7; d++) {
    if (new Date(year, month - 1, d).getDay() === 1) { firstMonday = d; break; }
  }
  // Pre-week (days 1..firstMonday-1), if any — labeled W1
  if (firstMonday > 1) {
    buckets.push({ from: 1, to: firstMonday - 1, partial: true });
  }
  // Each Monday → 7-day bucket (capped at lastDay)
  let day = firstMonday;
  while (day <= lastDay) {
    const end = Math.min(day + 6, lastDay);
    buckets.push({ from: day, to: end, partial: end - day < 6 });
    day += 7;
  }
  buckets.forEach((b, i) => {
    b.idx = i;
    b.label = 'W' + (i + 1);
    b.fromISO = `${year}-${String(month).padStart(2, '0')}-${String(b.from).padStart(2, '0')}`;
    b.toISO   = `${year}-${String(month).padStart(2, '0')}-${String(b.to).padStart(2, '0')}`;
  });
  return buckets;
}
// แปลงค่าวันที่ให้เป็น ISO 'YYYY-MM-DD' — รองรับทั้ง ISO และ DD/MM/YYYY (แบบไทย)
//   ⚠️ สำคัญ: บาง field (เช่น payables.due2) เก็บเป็น "DD/MM/YYYY" ซึ่ง new Date()
//   จะอ่านเป็น MM/DD/YYYY (US) ทำให้เดือนเพี้ยน — ต้อง normalize ก่อนทุกครั้ง
function toISODate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);   // already ISO
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);  // DD/MM/YYYY (Thai)
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (Number(yyyy) > 2400) yyyy = String(Number(yyyy) - 543);  // พ.ศ. → ค.ศ.
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return s;
}
function findWeekIdx(dateISO, weeks) {
  const iso = toISODate(dateISO);
  if (!iso) return -1;
  const day = Number(iso.split('-')[2]);
  if (!day) return -1;
  return weeks.findIndex(w => day >= w.from && day <= w.to);
}
function inMonth(dateISO, year, month) {
  const iso = toISODate(dateISO);
  if (!iso) return false;
  const [y, m] = iso.split('-').map(Number);
  return y === year && m === month;
}

// ─── Category mapping for outflow (4 categories) ──────────────────────────
// Labels match the M_Forecast Excel exactly:
//   1 = ค่าใช้จ่ายดำเนินงานรายสัปดาห์    (everyday operations — default)
//   2 = ค่าใช้จ่ายเกี่ยวกับโครงการและงานติดตั้ง  (project-tied costs)
//   3 = ต้นทุนทางการเงินและดอกเบี้ย      (interest / bank fees / WHT)
//   4 = ค่าใช้จ่ายเบ็ดเตล็ดและเงินเดือน    (misc + salary)
//
// Auto-classify logic (smart heuristic):
//   1. Manual override wins — cf_category field
//   2. Keyword match for finance cost (cat 3): ดอกเบี้ย, ค่าธรรมเนียม, interest, bank fee
//   3. jobcode/jobname present → cat 2 (project)
//   4. dpt_code = FIN by itself is NOT enough for cat 3 (FIN dept also has operating costs)
//   5. Default → cat 1 (operating)
// ── Per-PV manual category override (cf.pvCat.<PL_PV_No> = 1-4) ──────────────
const cfPvCatKey = (pvNo) => 'cf.pvCat.' + String(pvNo || '').trim();
// ── Section 01 โหมด "แผนจ่ายจริง": ติ๊กเลือกรวมรายการตั้งมือเองต่อ forecast entry (cf.sec1Inc.<id> = 1) ──
//   default ไม่รวม (ตั้งมือ = ประมาณการรวมที่นับใน Section 02 อยู่แล้ว) — sync ทีมผ่าน WTPOverride
const cfSec1IncKey = (id) => 'cf.sec1Inc.' + String(id || '').trim();
// ── PV ตัดล่วงหน้า: ยืนยัน "จ่ายจริงแล้ว" รายใบ (cf.pvPaid.<PL_PV_No> = 1) ──────────
//   PV ที่ Pmt_Date ยังไม่ถึง = เงินยังไม่ออกจากบัญชี → ยังไม่นับเป็นจ่ายจริง
//   user กดยืนยัน (เคสเงินออกวันนั้นพอดี ต้องรีบส่งรายงาน) → flag นี้ → นับเข้ายอด actual ทันที
const cfPvPaidKey = (pvNo) => 'cf.pvPaid.' + String(pvNo || '').trim();
// ── Vendor → หมวด mapping (เจ้าหนี้กลุ่มการเงิน/ลีสซิ่ง → หมวด 3) · แก้รายชื่อใน localStorage ได้
const CF_VENDOR_CAT_LS_KEY = 'bio-cf-vendor-cat';
const CF_VENDOR_CAT_DEFAULTS = [
  { frag: 'ลีซ อิท', cat: 3 }, { frag: 'ลีสซิ่ง', cat: 3 }, { frag: 'ลิสซิ่ง', cat: 3 },
  { frag: 'แคปปิตอล', cat: 3 }, { frag: 'capital', cat: 3 }, { frag: 'leasing', cat: 3 },
];
let _cfVendorCatCache = null;
function cfLoadVendorCat() {
  if (_cfVendorCatCache) return _cfVendorCatCache;
  try { const v = JSON.parse(localStorage.getItem(CF_VENDOR_CAT_LS_KEY) || 'null'); _cfVendorCatCache = Array.isArray(v) ? v : CF_VENDOR_CAT_DEFAULTS.slice(); }
  catch (_) { _cfVendorCatCache = CF_VENDOR_CAT_DEFAULTS.slice(); }
  return _cfVendorCatCache;
}
function cfSaveVendorCat(list) { _cfVendorCatCache = Array.isArray(list) ? list : []; try { localStorage.setItem(CF_VENDOR_CAT_LS_KEY, JSON.stringify(_cfVendorCatCache)); } catch (_) {} }
function cfVendorCat(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return 0;
  const list = cfLoadVendorCat();
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e && e.frag && n.includes(String(e.frag).toLowerCase())) { const c = parseInt(e.cat, 10); if (c >= 1 && c <= 4) return c; }
  }
  return 0;
}
// จัดหมวดรายการจ่ายจริง (PV): override ราย PV > AP ที่ผูก > vendor mapping/keyword บนชื่อผู้รับเงิน
function resolvePvCategory(pv, ap) {
  const pvNo = pv.PL_PV_No || '';
  if (pvNo && typeof WTPOverride !== 'undefined' && WTPOverride.has && WTPOverride.has(cfPvCatKey(pvNo))) {
    const ov = parseInt(WTPOverride.resolve(cfPvCatKey(pvNo), 0), 10);
    if (ov >= 1 && ov <= 4) return ov;
  }
  if (ap) return categorizePayable(ap);
  const vc = cfVendorCat(pv.Payee);
  if (vc) return vc;
  const text = (String(pv.Payee || '') + ' ' + String(pv.cc_remark || pv.Remark || '')).toLowerCase();
  if (/ดอกเบี้ย|interest|ค่าธรรมเนียม|bank fee|wht|leasing|ลีสซิ่ง/i.test(text)) return 3;
  return 1;
}
function categorizePayable(ap) {
  // Layer 1: manual override
  const override = parseInt(ap.cf_category || '0', 10);
  if (override >= 1 && override <= 4) return override;
  // Layer 1.5: vendor → หมวด mapping (เจ้าหนี้กลุ่มการเงิน/ลีสซิ่ง เช่น ลีซ อิท → หมวด 3)
  const vc = cfVendorCat(ap.cust_name || ap.vendor);
  if (vc) return vc;
  // Layer 2: finance-cost keyword match (cat 3)
  const text = (
    String(ap.cust_name || '') + ' ' +
    String(ap.remark || '') + ' ' +
    String(ap.docno || '') + ' ' +
    String(ap.refno || '') + ' ' +
    String(ap.vendor_group || '')
  ).toLowerCase();
  if (/ดอกเบี้ย|interest|ค่าธรรมเนียม|bank fee|wht|withhold|หัก ?ณ ?ที่จ่าย|ค่าบริการ ?ธนาคาร/i.test(text)) {
    return 3;
  }
  // Layer 3: project (cat 2)
  if (ap.jobcode || ap.jobname) return 2;
  // Layer 4: default — operating
  return 1;
}
function categorizeForecastEntry(fe) {
  // Explicit CATEGORY field wins (1-4)
  const cat = parseInt(fe.CATEGORY || fe.category || '0', 10);
  if (cat >= 1 && cat <= 4) return cat;
  // Fallback heuristics on description
  const desc = String(fe.DESCRIPTION || fe.description || '').toLowerCase();
  if (/เงินเดือน|salary|payroll|เบ็ดเตล็ด|misc|petty|รับรอง/i.test(desc)) return 4;
  if (/ดอกเบี้ย|interest|ค่าธรรมเนียม|bank fee/i.test(desc))                return 3;
  return 1;
}
const CATEGORY_LABELS = {
  1: 'ค่าใช้จ่ายดำเนินงานรายสัปดาห์',
  2: 'ค่าใช้จ่ายเกี่ยวกับโครงการและงานติดตั้ง',
  3: 'ต้นทุนทางการเงินและดอกเบี้ย',
  4: 'ค่าใช้จ่ายเบ็ดเตล็ดและเงินเดือน',
};
// Short labels for the weekly tracking section (compact tables)
const CATEGORY_LABELS_SHORT = {
  1: 'ดำเนินงาน',
  2: 'โครงการ',
  3: 'การเงิน',
  4: 'เบ็ดเตล็ด',
};
// Scale helper — ทุกขนาด (ฟอนต์/แถบ/ระยะ) ในการ์ดติดตามรายสัปดาห์เขียนผ่าน cfScale()
//   ปกติ = ×1 (ค่าตามตัวเลข) · โหมดนำเสนอ = ×var(--cf-k) (CSS set --cf-k บน .cf-week-grid)
//   → ขยายทั้งหมดพร้อมกันตอนพรีเซนต์โดยไม่ต้องใช้ !important / JS
const cfScale = (px) => `calc(${px}px * var(--cf-k, 1))`;

// ── AP / flex-pool ("จ่ายตามสภาพคล่อง") + manual-paid machinery ย้ายไปหน้า Bank Diary แล้ว ──
//   หน้า cashflow โชว์แค่ Forecast (forecastEntries ตั้งมือ) vs Actual (PV) — ไม่ยุ่งกับ AP
//   เรื่อง AP ครบดิว / เลือกจ่าย / เลื่อนจ่าย ทำที่หน้า Bank Diary (BDApPanel)

// ─── Inflow helpers ────────────────────────────────────────────────────────
// "คาดรับสุทธิ" = ยอดที่คาดว่าจะรับเข้ามาจริง หลังหัก WHT และภาระหนี้
//
// สูตรเดียวกับหน้าใบแจ้งหนี้ (page_invoices.jsx):
//   netExpected = balance × 106/107 (หัก WHT 1% จากยอดก่อน VAT) − debt
//   debt = resolveDebt(iv, financeByCode[jobNo])   ← ภาระหนี้จาก projectFinance
//
// Note: ต้องส่ง financeByCode เข้ามาเพื่อให้ debt ตรงกับที่ IV report ใช้
//   (resolveDebt() exposed globally จาก page_invoices.jsx)
function ivNetExpected(iv, financeByCode) {
  const bal = Number(iv.balance) || 0;
  // ถ้ามี financeByCode ให้ lookup debt แบบเดียวกับ IV report
  let debt;
  if (financeByCode && typeof window.resolveDebt === 'function') {
    const jobNo = String(iv.jobNo || '').replace(/-(?:GW|TC|HH|PG|GP|GG)$/i, '');
    const f = financeByCode[jobNo] || financeByCode[iv.contractRef] || {};
    debt = window.resolveDebt(iv, f);
  } else {
    debt = Number(iv.debt) || 0;
  }
  return bal * 106 / 107 - debt;
}
// ยอด "ใบแจ้งหนี้คงค้าง" แบบเดียวกับ War Room P1 SEC03 — netExpected = balance − debt (ไม่หัก WHT)
//   ใช้เป็นยอด "รับเงินโครงการ" ของคอลัมน์เดือนถัดไป (สัปดาห์สุดท้ายของเดือน) เพื่อให้ตรงกับ War Room
function ivWarroomNet(iv, financeByCode) {
  const bal = Number(iv.balance) || 0;
  let debt = 0;
  if (financeByCode && typeof window.resolveDebt === 'function') {
    const s  = String(iv.jobNo || '').trim();
    const mx = s.match(/^(.+)-([A-Z]{2,6})$/);   // ตัด suffix รุ่น (เหมือน War Room)
    const cj = mx ? mx[1] : s;
    const f  = financeByCode[cj] || financeByCode[iv.contractRef] || {};
    debt = window.resolveDebt(iv, f);
  } else {
    debt = Number(iv.debt) || 0;
  }
  return bal - debt;
}
function ivIsPaid(iv) {
  const s = String(iv.status || '').toLowerCase();
  return s === 'paid' || s === 'รับชำระแล้ว';
}
// ประมาณการรับเงินจะนับเฉพาะ IV ที่กำลัง "ติดตามรับเงิน" — ไม่นับ pending_inspection (ยังไม่ตรวจรับ)
// หรือ issue (ติดปัญหา ยังไม่แน่ว่าจะรับได้)
function ivIsTracking(iv) {
  const s = String(iv.status || '').toLowerCase();
  return s === 'tracking' || s === 'อยู่ระหว่างติดตามเงิน';
}
function ivActualReceiveDate(iv) {
  // ★ ใช้ helper กลาง — เช็คทั้ง actualReceive.date (JSON) และ actualReceiveDate (คอลัมน์แบน)
  //   เดิมอ่านแค่ JSON → ช่อง "รับจริง" (Actual) นับใบที่วันรับอยู่ในคอลัมน์แบนไม่ได้
  return (typeof ivReceivedDate === 'function' ? ivReceivedDate(iv) : (iv.actualReceive && iv.actualReceive.date)) || null;
}
function ivIsProject(iv) {
  // เฉพาะ invType='P' (โครงการ, default) — ตัด invType='O' (อื่นๆ) ออก
  return String(iv.invType || iv.invtype || 'P').trim().toUpperCase() !== 'O';
}

// ─── IV PLAN lock — freeze "คาดรับ" baseline ตั้งแต่วันที่ 1 ของเดือน ─────────
//   ปัญหาเดิม: forecast คำนวณสด + ตัด IV ที่ paid ออก → ยอด PLAN หดลงเรื่อยๆ
//   แก้: จับ baseline ราย IV ตอนต้นเดือน (net + สัปดาห์คาดรับ) แล้ว freeze ไว้
//        เก็บลง WTPOverride (manualOverrides — numeric KV, sync ข้าม user, ไม่ต้องแตะ backend)
//   คีย์:  {ovPrefix}.ivPlan.<ivNo>.net   = ยอดสุทธิที่ freeze
//          {ovPrefix}.ivPlan.<ivNo>.wk    = สัปดาห์คาดรับ (0..4) ที่ freeze
//          {ovPrefix}.ivPlan.__lockedAt   = วันที่ล็อก (YYYYMMDD เป็นตัวเลข)
const IVPLAN_SEG = 'ivPlan';
const IVPLAN_LOCKED_AT = '__lockedAt';
// ivNo อาจมีอักขระแปลก — sanitize ให้ปลอดภัย (ใช้ '.' เป็นตัวคั่นใน key)
function sanitizeIvKey(ivNo) {
  return String(ivNo || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
}
// อ่าน baseline ที่ล็อกของเดือน → { locked, lockedAt, items: [{ safe, net, wk }] }
function readIvPlanLock(ovPrefix) {
  const prefix = `${ovPrefix}.${IVPLAN_SEG}.`;
  const all = (typeof WTPOverride !== 'undefined') ? WTPOverride._load() : {};
  const byIv = {};
  let lockedAt = null;
  Object.keys(all).forEach(k => {
    if (!k.startsWith(prefix)) return;
    const rest = k.slice(prefix.length);          // 'IV2026-077.net' | '...wk' | '__lockedAt'
    if (rest === IVPLAN_LOCKED_AT) { lockedAt = Number(all[k]) || null; return; }
    const mNet = rest.match(/^(.+)\.net$/);
    const mWk  = rest.match(/^(.+)\.wk$/);
    if (mNet)      { (byIv[mNet[1]] = byIv[mNet[1]] || {}).net = Number(all[k]) || 0; }
    else if (mWk)  { (byIv[mWk[1]]  = byIv[mWk[1]]  || {}).wk  = Number(all[k]) || 0; }
  });
  const items = Object.keys(byIv).map(safe => ({ safe, net: byIv[safe].net || 0, wk: byIv[safe].wk || 0 }));
  return { locked: lockedAt != null, lockedAt, items };
}
// รวม baseline ที่ freeze เป็น bucket รายสัปดาห์ (ป้อนแทน forecast สด)
function ivPlanBucketsFromLock(items, weekCount) {
  const arr = [];
  for (let i = 0; i < weekCount; i++) arr.push(0);
  (items || []).forEach(it => { if (it.wk >= 0 && it.wk < weekCount) arr[it.wk] += (it.net || 0); });
  return arr;
}
// YYYYMMDD (int) → 'DD/MM/YYYY' (ค.ศ.) สำหรับแสดงผล badge
function fmtLockedAtInt(n) {
  const s = String(n || '');
  if (!/^\d{8}$/.test(s)) return '';
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}
// วันนี้ → YYYYMMDD (int)
function todayYmdInt() {
  const t = new Date();
  return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
}
// role ที่เขียน override ไม่ได้ (owner/viewer) — ใช้ gate auto-capture + ปุ่มล็อก
function cfIsReadOnly() {
  try {
    const s = JSON.parse(localStorage.getItem('bio-session') || 'null');
    const role = (s && s.role) || 'viewer';
    return role === 'owner' || role === 'viewer';
  } catch (_) { return false; }
}
// เฉพาะ manager — ใช้ gate การ์ด "ตรวจสอบยอดดิบ" (Section 03) ที่คนอื่นไม่ต้องเห็น
function cfIsManager() {
  try {
    const s = JSON.parse(localStorage.getItem('bio-session') || 'null');
    return ((s && s.role) || '') === 'manager';
  } catch (_) { return false; }
}

// ─── AP-PV match (filter out paid AP) ─────────────────────────────────────
function buildPaidVchnoSet(pvVouchers) {
  const set = new Set();
  (pvVouchers || []).forEach(pv => pvSettledDocs(pv).forEach(d => set.add(d)));   // AP_No + บิลย่อย settles[]
  return set;
}

// ─── Snapshot helpers ──────────────────────────────────────────────────────
function getBalanceAtDate(snapshots, dateISO) {
  // Return sum of latest snapshot per bankAc on or before dateISO
  if (!dateISO) return 0;
  const latestPerAc = {};
  (snapshots || []).forEach(s => {
    if (!s.date || s.date > dateISO) return;
    const prev = latestPerAc[s.bankAc];
    if (!prev || s.date > prev.date) latestPerAc[s.bankAc] = s;
  });
  return Object.values(latestPerAc).reduce((sum, s) => sum + (Number(s.balance) || 0), 0);
}
// ยอดเงินสด "ต้นงวด" ที่ cutoff — ปกติใช้ snapshot ล่าสุด ≤ cutoff
//   แต่ถ้าไม่มี snapshot ในเดือนเดียวกับ cutoff เลย (ข้อมูลขาด → ยอดค้างเก่า)
//   ให้ fallback มาใช้ "ยอดสดปัจจุบัน" แทน เพื่อไม่ให้หยิบยอดเดือนเก่ามาแสดงผิด
function openingBalanceAt(snapshots, cutoffISO, liveBalance) {
  if (!cutoffISO) return liveBalance;
  const ym = String(cutoffISO).slice(0, 7);  // 'YYYY-MM' ของ cutoff
  const hasInMonth = (snapshots || []).some(s =>
    s.date && String(s.date).slice(0, 7) === ym && s.date <= cutoffISO);
  return hasInMonth ? getBalanceAtDate(snapshots, cutoffISO) : liveBalance;
}

// ─── What-if Simulator (จำลองกระแสเงินสด) ────────────────────────────────────
//   พาเนลจำลองแยก: เลื่อนวัน "จ่าย/รับ" แล้วดูยอดคงเหลือ+จุดต่ำสุดเปลี่ยนทันที
//   ★ จำลองล้วน — state อยู่ในเครื่อง (useState) ไม่เขียน Supabase/ไม่ sync/ไม่กระทบใคร
//   items = [{id, dir:'in'|'out', label, amount, week}] (parent สร้างจาก source เดียวกับตาราง)
function CfWhatIfPanel({ bf, weeks, items }) {
  const [collapsed, setCollapsed] = React.useState(true);
  const [shift, setShift] = React.useState({});   // itemId → จำนวนสัปดาห์ที่เลื่อน (+/-)
  const [excl, setExcl]   = React.useState({});    // itemId → พักไว้ (ไม่นับ)
  const nW = weeks.length;
  const clampW = (w) => Math.max(0, Math.min(nW - 1, w));
  const wkOf = (it) => clampW(it.week + (shift[it.id] || 0));

  const calc = (useSim) => {
    const net = weeks.map(() => ({ in: 0, out: 0 }));
    items.forEach(it => {
      if (useSim && excl[it.id]) return;
      const w = useSim ? wkOf(it) : clampW(it.week);
      if (it.dir === 'in') net[w].in += it.amount; else net[w].out += it.amount;
    });
    let run = bf; const rows = [];
    for (let i = 0; i < nW; i++) { run += net[i].in - net[i].out; rows.push({ in: net[i].in, out: net[i].out, close: run }); }
    const minClose = rows.length ? Math.min.apply(null, rows.map(r => r.close)) : bf;
    return { rows, minClose };
  };
  const base = calc(false);
  const sim  = calc(true);
  const changed = items.some(it => (shift[it.id] || 0) !== 0 || excl[it.id]);

  const move = (id, d) => setShift(s => ({ ...s, [id]: (s[id] || 0) + d }));
  const toggle = (id) => setExcl(e => ({ ...e, [id]: !e[id] }));
  const reset = () => { setShift({}); setExcl({}); };

  const outItems = items.filter(i => i.dir === 'out').sort((a, b) => b.amount - a.amount);
  const inItems  = items.filter(i => i.dir === 'in').sort((a, b) => b.amount - a.amount);

  const money = (n) => fmtNum(Math.round(n), 0);
  const closeColor = (v) => v < 0 ? 'var(--bad)' : 'var(--good, #0a7d3c)';

  const ItemRow = (it) => {
    const off = shift[it.id] || 0;
    const w = wkOf(it);
    const isExcl = !!excl[it.id];
    return (
      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderBottom: '1px solid var(--ink-100,#eef2f8)', opacity: isExcl ? 0.45 : 1, fontSize: 12.5 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.label}>{it.label}</div>
        <div style={{ width: 92, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: it.dir === 'in' ? 'var(--good,#0a7d3c)' : 'var(--bad)' }}>
          {it.dir === 'in' ? '+' : '−'}{money(it.amount)}
        </div>
        <div style={{ width: 64, textAlign: 'center', fontWeight: 600 }}>
          {isExcl ? <span style={{ color: 'var(--ink-400)' }}>พักไว้</span>
            : <span>{weeks[w] ? weeks[w].label : ('W' + (w + 1))}{off !== 0 && <span style={{ color: 'var(--brand-600,#1a4490)', fontSize: 10 }}> ({off > 0 ? '+' : ''}{off})</span>}</span>}
        </div>
        <div style={{ display: 'flex', gap: 3 }} data-no-capture="1">
          <button className="btn btn-sm" disabled={isExcl || w <= 0} onClick={() => move(it.id, -1)} title="เลื่อนเร็วขึ้น 1 สัปดาห์" style={{ padding: '2px 7px' }}>◀</button>
          <button className="btn btn-sm" disabled={isExcl || w >= nW - 1} onClick={() => move(it.id, +1)} title="เลื่อนช้าลง 1 สัปดาห์" style={{ padding: '2px 7px' }}>▶</button>
          <button className="btn btn-sm" onClick={() => toggle(it.id)} title={isExcl ? 'นำกลับมา' : 'พักรายการนี้ไว้'} style={{ padding: '2px 7px' }}>{isExcl ? '↺' : '✕'}</button>
        </div>
      </div>
    );
  };

  return (
    <div className="card no-present" style={{ marginTop: 16, overflow: 'hidden' }}>
      <div onClick={() => setCollapsed(c => !c)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 160ms', color: 'var(--ink-400)' }}>▶</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink-900)' }}>🔮 จำลองกระแสเงินสด (What-if)</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>ลองเลื่อนวันจ่าย/รับ → ดูจุดเงินต่ำสุดเปลี่ยนทันที · {collapsed ? 'กดเพื่อดู ▾' : 'ย่อ ▴'}</div>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#7a5b00', background: '#fff7e6', border: '1px solid #ffe1a8', borderRadius: 8, padding: '3px 9px', whiteSpace: 'nowrap' }}>🔒 จำลองเท่านั้น · ไม่กระทบข้อมูลจริง</span>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 14 }}>
          {items.length === 0 ? (
            <div style={{ color: 'var(--ink-500)', fontSize: 13, padding: '12px 0' }}>ไม่มีรายการจ่าย/รับที่วางแผนไว้ในเดือนนี้ให้จำลอง</div>
          ) : (
            <React.Fragment>
              {/* สรุปจุดต่ำสุด ก่อน → หลัง */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1, minWidth: 200, background: 'var(--ink-50,#f4f7fb)', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>จุดเงินสดต่ำสุดของเดือน</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: closeColor(base.minClose) }}>{money(base.minClose)}</span>
                    {changed && <React.Fragment>
                      <span style={{ color: 'var(--ink-400)' }}>→</span>
                      <span style={{ fontSize: 22, fontWeight: 800, color: closeColor(sim.minClose) }}>{money(sim.minClose)}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: (sim.minClose - base.minClose) >= 0 ? 'var(--good,#0a7d3c)' : 'var(--bad)' }}>
                        ({(sim.minClose - base.minClose) >= 0 ? '▲ ดีขึ้น ' : '▼ แย่ลง '}{money(Math.abs(sim.minClose - base.minClose))})
                      </span>
                    </React.Fragment>}
                  </div>
                  <div style={{ fontSize: 11.5, marginTop: 4, color: (changed ? sim.minClose : base.minClose) < 0 ? 'var(--bad)' : 'var(--good,#0a7d3c)' }}>
                    {(changed ? sim.minClose : base.minClose) < 0 ? '⚠ เงินไม่พอ — ต้องเติมเงิน/เลื่อนจ่าย' : '✓ เงินสดเพียงพอตลอดเดือน'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button className="btn" onClick={reset} disabled={!changed} data-no-capture="1">↺ ล้างการจำลอง</button>
                </div>
              </div>

              {/* ตารางยอดคงเหลือรายสัปดาห์ (จำลอง) */}
              <div style={{ overflowX: 'auto', marginBottom: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ color: 'var(--ink-500)', textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>สัปดาห์</th>
                      <th style={{ padding: '4px 8px' }}>รับ</th>
                      <th style={{ padding: '4px 8px' }}>จ่าย</th>
                      <th style={{ padding: '4px 8px' }}>คงเหลือ{changed ? ' (จำลอง)' : ''}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w, i) => {
                      const r = sim.rows[i] || { in: 0, out: 0, close: bf };
                      const neg = r.close < 0;
                      return (
                        <tr key={i} style={{ borderTop: '1px solid var(--ink-100,#eef2f8)', background: neg ? 'rgba(220,38,38,0.06)' : 'transparent' }}>
                          <td style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>{w.label} <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}>({w.from}–{w.to})</span></td>
                          <td style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--good,#0a7d3c)', fontVariantNumeric: 'tabular-nums' }}>{r.in ? money(r.in) : '—'}</td>
                          <td style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--bad)', fontVariantNumeric: 'tabular-nums' }}>{r.out ? money(r.out) : '—'}</td>
                          <td style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 700, color: closeColor(r.close), fontVariantNumeric: 'tabular-nums' }}>{money(r.close)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>เริ่มจากเงินสดใช้ได้ปัจจุบัน {money(bf)} · นับเฉพาะรายการที่ยังไม่เกิดจริง (แผน)</div>
              </div>

              {/* รายการที่เลื่อนได้ */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--bad)', marginBottom: 4 }}>💸 รายการจ่าย ({outItems.length})</div>
                  <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--ink-100,#eef2f8)', borderRadius: 10 }}>
                    {outItems.length ? outItems.map(ItemRow) : <div style={{ padding: 10, color: 'var(--ink-400)', fontSize: 12 }}>ไม่มี</div>}
                  </div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--good,#0a7d3c)', marginBottom: 4 }}>💰 รายการรับ ({inItems.length})</div>
                  <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--ink-100,#eef2f8)', borderRadius: 10 }}>
                    {inItems.length ? inItems.map(ItemRow) : <div style={{ padding: 10, color: 'var(--ink-400)', fontSize: 12 }}>ไม่มี</div>}
                  </div>
                </div>
              </div>
            </React.Fragment>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section 03 — ตรวจสอบยอดดิบ (Cash Reconciliation, manager-only) ──────────
//   หลักการ (วิธีที่เตยทำใน Excel): ยกมา + รับโครงการ + เงินกู้ − ค่าใช้จ่าย
//   = ยอดสุทธิใช้ได้ → ต้องตรงกับ "เงินในธนาคารจริง" ถ้าไม่ตรง = มีรายการตกหล่น
//   ตารางรายสัปดาห์เปิดแต่ละสัปดาห์ด้วย "ยอดจริงสิ้นสัปดาห์ก่อน" → ส่วนต่างจะโผล่
//   เฉพาะสัปดาห์ที่ผิดจริง (ผลรวมส่วนต่างรายสัปดาห์ = ส่วนต่างรวม — telescoping)
//   ★ BIO ไม่มี HOLD รายวัน (getHoldAtDate) — ใช้ liveHold (ปัจจุบัน) หักทุกสัปดาห์
//     ให้สอดคล้องกับ monthBFAvailable/liveAvailable (ที่หัก liveHold เดียวกัน) → telescoping ยังถูก
function CfReconCard({
  bf, bankActual, ivActual, loanActual, outflowActual,
  ivWeekActual, loanWeekActual, outflowGrid,
  weeks, nowWeek, snapshots, liveHold, monthNames, month,
}) {
  const [collapsed, setCollapsed] = cfState(true);  // ย่อไว้ default — ไม่โชว์รายการจนกว่าจะกดเปิด
  const EPS = 1;  // ±1 บาท = ถือว่าตรง (กัน rounding เศษสตางค์)
  const calculated = bf + ivActual + loanActual - outflowActual;
  const grandDiff  = calculated - bankActual;
  const grandPass  = Math.abs(grandDiff) <= EPS;
  const okCol = 'var(--good)', badCol = 'var(--bad)';

  // ── ตารางตรวจรายสัปดาห์ ──────────────────────────────────────────────
  const rows = [];
  let prevClose = bf;
  weeks.forEach((w, i) => {
    const weekEndISO = w.toISO;
    let actualBal;
    if (i < nowWeek) {
      const anySnap = (snapshots || []).some(s => s.date && s.date <= weekEndISO);
      actualBal = anySnap ? (getBalanceAtDate(snapshots, weekEndISO) - liveHold) : null;
    } else if (i === nowWeek) {
      actualBal = bankActual;     // สัปดาห์ปัจจุบัน = ยอดสดวันนี้
    } else {
      actualBal = null;           // อนาคต — ยังไม่มียอดจริงให้เทียบ
    }
    const inflow  = (ivWeekActual[i] || 0) + (loanWeekActual[i] || 0);
    const outflow = [1, 2, 3, 4].reduce((s, c) => s + ((outflowGrid[i] && outflowGrid[i][c]) || 0), 0);
    const opening = (i === 0) ? bf : prevClose;
    const calc    = opening + inflow - outflow;
    const diff    = (actualBal != null) ? (calc - actualBal) : null;
    rows.push({ label: w.label, from: w.from, to: w.to, opening, inflow, outflow, calc, actualBal, diff });
    prevClose = (actualBal != null) ? actualBal : calc;   // สัปดาห์ถัดไปเปิดด้วยยอดจริงสิ้นสัปดาห์นี้
  });
  const firstBreak = rows.findIndex(r => r.diff != null && Math.abs(r.diff) > EPS);

  const num = (v, bold, col) => (
    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 800 : 600, color: col || 'var(--ink-800)' }}>
      {fmtNum(v, 2)}
    </span>
  );

  return (
    <div className="cf-section-03 no-present" style={{ marginTop: 26 }}>
      <div onClick={() => setCollapsed(c => !c)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: cfScale(14), padding: `${cfScale(8)} 0 ${cfScale(14)}` }}>
        <div style={{ width: cfScale(38), height: cfScale(38), borderRadius: cfScale(10), background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))', color: 'white', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: cfScale(14), flex: 'none' }}>03</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: cfScale(17), fontWeight: 700, color: 'var(--ink-900)' }}>ตรวจสอบยอดดิบ</h2>
          <div style={{ fontSize: cfScale(12), color: 'var(--ink-500)', marginTop: 2 }}>Cash Reconciliation · ยกมา + รับโครงการ + เงินกู้ − ค่าใช้จ่าย = เงินในธนาคารจริง · 🔒 เฉพาะผู้จัดการ</div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: cfScale(6), flex: 'none', fontSize: cfScale(12.5), fontWeight: 700, color: 'var(--brand-600)' }}>
          {collapsed ? 'กดเพื่อดู' : 'ย่อ'}
          <span style={{ display: 'inline-block', transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform .15s' }}>▶</span>
        </span>
      </div>

      {!collapsed && (<React.Fragment>
      <div className="card anim-in" style={{ padding: cfScale(18), marginBottom: 16 }}>
        {/* ── แถบสถานะ เขียว/แดง ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: cfScale(13), padding: `${cfScale(13)} ${cfScale(16)}`,
          borderRadius: cfScale(12), marginBottom: cfScale(16),
          background: grandPass ? 'var(--good-bg)' : 'var(--bad-bg)',
          border: `1.5px solid ${grandPass ? okCol : badCol}`,
        }}>
          <div style={{
            width: cfScale(40), height: cfScale(40), borderRadius: '50%', flex: 'none',
            display: 'grid', placeItems: 'center', color: '#fff', fontSize: cfScale(22), fontWeight: 800,
            background: grandPass ? okCol : badCol,
          }}>{grandPass ? '✓' : '⚠'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: cfScale(17), fontWeight: 800, color: grandPass ? okCol : badCol }}>
              {grandPass ? 'ยอดตรงกัน' : 'ยอดไม่ตรง'}
            </div>
            <div style={{ fontSize: cfScale(12), color: 'var(--ink-600)', marginTop: 2 }}>
              {grandPass
                ? 'ยอดคำนวณ = ยอดธนาคารจริง — ข้อมูลสอดคล้องครบถ้วน'
                : 'ยอดคำนวณไม่ตรงกับธนาคารจริง — มีรายการตกหล่น ดูตารางรายสัปดาห์ด้านล่างเพื่อหาจุดที่ขาด'}
            </div>
          </div>
          {!grandPass && (
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div style={{ fontSize: cfScale(11), color: 'var(--ink-500)' }}>ส่วนต่าง</div>
              <div style={{ fontSize: cfScale(22), fontWeight: 800, color: badCol, fontVariantNumeric: 'tabular-nums' }}>
                {grandDiff > 0 ? '+' : ''}{fmtNum(grandDiff, 2)}
              </div>
            </div>
          )}
        </div>

        {/* ── กล่องสูตร ── */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: cfScale(8),
          padding: cfScale(15), background: 'var(--ink-50)', borderRadius: cfScale(12), marginBottom: cfScale(14),
        }}>
          {[
            { label: 'ยอดยกมา (B/F)', value: bf,            sign: '',  col: 'var(--ink-800)' },
            { label: 'รับโครงการ',     value: ivActual,      sign: '+', col: okCol },
            { label: 'เงินกู้',         value: loanActual,    sign: '+', col: okCol },
            { label: 'ค่าใช้จ่าย',      value: outflowActual, sign: '−', col: badCol },
          ].map((it, i) => (
            <React.Fragment key={it.label}>
              {i > 0 && <span style={{ fontSize: cfScale(22), fontWeight: 700, color: it.sign === '−' ? badCol : 'var(--ink-400)' }}>{it.sign}</span>}
              <div style={{ textAlign: 'center', minWidth: cfScale(110) }}>
                <div style={{ fontSize: cfScale(11.5), color: 'var(--ink-500)', marginBottom: 3 }}>{it.label}</div>
                <div style={{ fontSize: cfScale(16), fontWeight: 700, color: it.col, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(it.value, 2)}</div>
              </div>
            </React.Fragment>
          ))}
          <span style={{ fontSize: cfScale(22), fontWeight: 700, color: 'var(--brand-500)' }}>=</span>
          <div style={{ textAlign: 'center', minWidth: cfScale(140) }}>
            <div style={{ fontSize: cfScale(11.5), color: 'var(--ink-500)', marginBottom: 3 }}>ยอดสุทธิใช้ได้ (คำนวณ)</div>
            <div style={{ fontSize: cfScale(18), fontWeight: 800, color: 'var(--brand-700)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(calculated, 2)}</div>
          </div>
        </div>

        {/* ── 3 ช่องเทียบ ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: cfScale(12) }}>
          {[
            { label: 'คำนวณได้', value: calculated, col: 'var(--brand-700)', bg: 'var(--brand-50)', bd: 'var(--brand-200)' },
            { label: 'ธนาคารจริง', value: bankActual, col: 'var(--ink-900)', bg: 'var(--ink-50)', bd: 'var(--line)' },
            { label: 'ส่วนต่าง', value: grandDiff, col: grandPass ? okCol : badCol, bg: grandPass ? 'var(--good-bg)' : 'var(--bad-bg)', bd: grandPass ? okCol : badCol, signed: true },
          ].map(b => (
            <div key={b.label} style={{
              textAlign: 'center', padding: `${cfScale(12)} ${cfScale(10)}`, borderRadius: cfScale(10),
              background: b.bg, border: `1px solid ${b.bd}`,
            }}>
              <div style={{ fontSize: cfScale(12), color: 'var(--ink-500)', marginBottom: cfScale(4) }}>{b.label}</div>
              <div style={{ fontSize: cfScale(20), fontWeight: 800, color: b.col, fontVariantNumeric: 'tabular-nums' }}>
                {b.signed && b.value > 0 ? '+' : ''}{fmtNum(b.value, 2)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── ตารางตรวจรายสัปดาห์ ── */}
      <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: `${cfScale(11)} ${cfScale(16)}`, borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: cfScale(14), color: 'var(--ink-800)' }}>
          ตรวจสอบต่อเนื่องรายสัปดาห์
          <span style={{ fontWeight: 400, fontSize: cfScale(11.5), color: 'var(--ink-500)', marginLeft: cfScale(8) }}>
            แต่ละสัปดาห์เปิดด้วยยอดจริงสิ้นสัปดาห์ก่อน — ส่วนต่างจะชี้สัปดาห์ที่ยอดเริ่มขาด
          </span>
        </div>
        <table className="tbl" style={{ width: '100%', fontSize: cfScale(13) }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>สัปดาห์</th>
              <th style={{ textAlign: 'right' }}>ยอดยกมา</th>
              <th style={{ textAlign: 'right', color: okCol }}>+ เงินเข้า</th>
              <th style={{ textAlign: 'right', color: badCol }}>− เงินออก</th>
              <th style={{ textAlign: 'right' }}>= คงเหลือ (คำนวณ)</th>
              <th style={{ textAlign: 'right' }}>ยอดในตาราง (จริง)</th>
              <th style={{ textAlign: 'right' }}>ส่วนต่าง</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const future = r.actualBal == null;
              const hasDiff = !future && Math.abs(r.diff) > EPS;
              const isBreak = i === firstBreak;
              return (
                <tr key={i} style={{
                  background: isBreak ? 'var(--bad-bg)' : (hasDiff ? 'color-mix(in oklch, var(--bad) 6%, transparent)' : 'transparent'),
                  borderLeft: isBreak ? `3px solid ${badCol}` : '3px solid transparent',
                }}>
                  <td style={{ fontWeight: 700, color: 'var(--ink-800)', whiteSpace: 'nowrap' }}>
                    {r.label}
                    <span style={{ fontWeight: 400, color: 'var(--ink-400)', fontSize: cfScale(11), marginLeft: cfScale(5) }}>
                      {r.from}–{r.to} {monthNames[month - 1]}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{num(r.opening)}</td>
                  <td style={{ textAlign: 'right' }}>{r.inflow > 0 ? num(r.inflow, false, okCol) : <span style={{ color: 'var(--ink-300)' }}>–</span>}</td>
                  <td style={{ textAlign: 'right' }}>{r.outflow > 0 ? num(r.outflow, false, badCol) : <span style={{ color: 'var(--ink-300)' }}>–</span>}</td>
                  <td style={{ textAlign: 'right' }}>{num(r.calc, true)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {future
                      ? <span style={{ color: 'var(--ink-300)' }}>—</span>
                      : num(r.actualBal, true)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {future
                      ? <span style={{ color: 'var(--ink-300)', fontSize: cfScale(11) }}>รออนาคต</span>
                      : (hasDiff
                          ? <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: cfScale(3),
                              fontWeight: 800, color: '#fff', background: badCol,
                              padding: `${cfScale(2)} ${cfScale(9)}`, borderRadius: 999, fontVariantNumeric: 'tabular-nums',
                            }}>
                              ⚠ {r.diff > 0 ? '+' : ''}{fmtNum(r.diff, 2)}
                            </span>
                          : <span style={{ color: okCol, fontWeight: 800 }}>✓ 0.00</span>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {firstBreak >= 0 && (
          <div style={{ padding: `${cfScale(10)} ${cfScale(16)}`, background: 'var(--bad-bg)', borderTop: `1px solid ${badCol}`, fontSize: cfScale(12.5), color: 'var(--ink-700)' }}>
            🔎 ยอดเริ่มขาดที่ <strong style={{ color: badCol }}>{rows[firstBreak].label}</strong> — ไปไล่ดูรายการรับ/จ่ายของสัปดาห์นั้น (PV / IV / เงินกู้ ที่อาจยังไม่ได้บันทึก หรือยอดธนาคารที่ยังไม่อัปเดต)
          </div>
        )}
      </div>
      </React.Fragment>)}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
function CashFlowDashboard({ data, setData, toast }) {
  const today = new Date();
  const cfTodayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  // PV ตัดล่วงหน้าที่ Pmt_Date ยังไม่ถึง = เงินยังไม่ออกจริง → ยังไม่นับเป็นจ่ายจริง
  //   (เว้นแต่ user กดยืนยัน "จ่ายจริงแล้ว" → cf.pvPaid override). ใช้ทั้ง pvActualByWeekCat + openActualDrill
  //   ★ memo ที่เรียก helper นี้ต้องมี ovTick ใน deps เพื่อ recompute เมื่อ override เปลี่ยน
  const pvMoneyOut = (pv) => {
    const dISO = toISODate(pv.Pmt_Date);
    if (!dISO) return true;                  // ไม่มีวันจ่าย → นับ (กันยอดหาย)
    if (dISO < cfTodayISO) return true;      // เลยวันจ่ายแล้ว → เงินออกจากบัญชีจริง
    return !!WTPOverride.resolve(cfPvPaidKey(pv.PL_PV_No), 0);  // ยังไม่ถึง → นับเฉพาะใบที่ยืนยันแล้ว
  };
  const [year, setYear]   = cfState(today.getFullYear());
  const [month, setMonth] = cfState(today.getMonth() + 1);
  const [editMode, setEditMode] = cfState(false);  // Manual override mode
  useOverrideSubAny();  // re-render หน้าทุกครั้งที่ override เปลี่ยน (sum/total/% ใช้ค่าใหม่)

  // Drill-down popup: { title, rows, kind } where kind ∈ {iv, loan, ap, fe, mixed}
  const [drillDown, setDrillDown] = cfState(null);
  // Per-item detail popup (ซ้อนบน drill-down) — เก็บ item ที่กด "ดู"
  const [detailItem, setDetailItem] = cfState(null);
  // IV plan detail modal — แสดงรายละเอียด IV แยกราย tab
  const [ivDrill, setIvDrill] = cfState(false);
  // โหมดช่องรายจ่าย Section 01: 'remaining' = ประมาณการตั้งมือ − จ่ายจริง (เดิม)
  //   'apPlan' = แผนจ่ายจริง = รายการ AP ที่เลือกจ่าย (ขึ้น CARD BANK) + รายการตั้งมือที่ติ๊กรวมเอง
  //   เก็บไว้ต่อเครื่อง (localStorage) — เป็น view preference ส่วนตัว ไม่ sync ทีม
  const [s01OutMode, setS01OutMode] = cfState(() => {
    try { const v = localStorage.getItem('bio-cf-s01outmode'); return (v === 'apPlan' || v === 'pv') ? v : 'remaining'; }
    catch (_) { return 'remaining'; }
  });
  const setS01OutModePersist = (m) => {
    setS01OutMode(m);
    try { localStorage.setItem('bio-cf-s01outmode', m); } catch (_) {}
  };
  // ขอบเขตของโหมด 'apPlan' + 'pv': 'month' = ตั้งแต่สัปดาห์ปัจจุบันถึงสิ้นเดือน (เดิม) | 'week' = เฉพาะสัปดาห์ปัจจุบัน
  const [s01ApScope, setS01ApScope] = cfState(() => {
    try { return localStorage.getItem('bio-cf-s01apscope') === 'week' ? 'week' : 'month'; }
    catch (_) { return 'month'; }
  });
  const setS01ApScopePersist = (s) => {
    setS01ApScope(s);
    try { localStorage.setItem('bio-cf-s01apscope', s); } catch (_) {}
  };

  // Footer notes — พับเก็บไว้ (ผู้บริหารเห็นแค่เนื้อหาหลัก) กดเปิดเองถ้าอยากดู
  const [showNotes, setShowNotes] = cfState(false);

  // Override key prefix per month — ค่าที่กรอกจะแยกตามเดือนที่ดู
  const ovPrefix = `cf.${year}.${String(month).padStart(2, '0')}`;

  // ── Month weeks (Monday-based) ────────────────────────────────────────
  const weeks = cfMemo(() => getMonthWeeksMonday(year, month), [year, month]);

  // ── Current week index (auto, but user can override) ──────────────────
  const [currentWeekOverride, setCurrentWeekOverride] = cfState(null);
  const autoNowWeek = cfMemo(() => {
    if (today.getFullYear() !== year || (today.getMonth() + 1) !== month) return 0;
    return Math.max(0, findWeekIdx(today.toISOString().slice(0, 10), weeks));
  }, [year, month, weeks]);
  const nowWeek = currentWeekOverride != null ? currentWeekOverride : autoNowWeek;

  // ── Data sources ──────────────────────────────────────────────────────
  const invoices       = data.invoices || [];
  const payables       = data.payables || [];
  const pvVouchers     = data.pvVouchers || [];
  // ประมาณการของ cashflow = เฉพาะที่ "คีย์มือ" จากหน้า Forecast — ตัด AP-plan (EXPENSE_TYPE='AP')
  //   ที่ผู้ใช้วางแผนจ่ายจากหน้า Bank Diary ออก (คนละส่วนกับประมาณการต้นเดือน ไม่งั้นนับซ้ำ)
  //   memo ไว้ให้ reference นิ่ง (ไม่ recompute memo ลูกทุก render)
  const forecastEntries= cfMemo(() => (data.forecastEntries || []).filter(fe => String(fe.EXPENSE_TYPE || '').toUpperCase() !== 'AP'), [data.forecastEntries]);
  const snapshots      = data.cashflowSnapshots || [];
  const bankAccounts   = data.bankAccounts || [];

  // ── BANK_RECON (จ่ายจริงจากกระทบยอด) — กัน "แถวผี" นับเบิ้ล โดยไม่ทำ LG จ่ายซ้ำจริงหาย ──────────
  //   bankReconState = 1 entry ต่อ 1 บรรทัด statement ที่กดจ่ายจริง (decision='recorded' → forecastId).
  //   ★ ห้าม dedup ด้วย "เนื้อหา" (LG จ่ายซ้ำจริง ยอด+วัน+desc เหมือนกันเป๊ะ = ของจริง 2 ใบ = 2 statement
  //     line = 2 reconState entry → ต้องนับทั้งคู่). ใช้ reconState เป็นตัวตัดสิน: นับเฉพาะแถวที่ id เป็น
  //     forecastId ปัจจุบันของ reconState; "แถวผี" = forecastEntries BANK_RECON ที่ไม่มี entry ไหนชี้หา
  //     (ตกค้างจากการ record ซ้ำ → reconState ชี้ id ใหม่ แถวเก่าลอย). ตัดเฉพาะแถวผีที่มี "ตัวจริง" (live twin)
  //     content เดียวกันอยู่ → กันยอดหาย (แถวผีโดดเดี่ยวไม่มี twin ยังนับ).
  const reconValidity = cfMemo(() => {
    const validIds = new Set();
    (data.bankReconState || []).forEach(r => {
      if (r && String(r.decision || '') === 'recorded' && r.forecastId) validIds.add(String(r.forecastId));
    });
    const liveKeys = new Set();
    if (validIds.size > 0) {
      (data.forecastEntries || []).forEach(fe => {
        if (String(fe.EXPENSE_TYPE || '').toUpperCase() !== 'BANK_RECON') return;
        if (!validIds.has(String(fe.id))) return;
        const d = fe.ACTUAL_DATE || fe.PAYMENT_DATE || fe.DATE;
        const a = Number(fe.ACTUAL_AMOUNT || fe.AMOUNT || fe.amount || 0);
        liveKeys.add(String(fe.Bank_AC || '').trim() + '|' + d + '|' + a + '|' + String(fe.DESCRIPTION || '').trim());
      });
    }
    return { validIds, liveKeys };
  }, [data.bankReconState, data.forecastEntries]);
  // true = แถว BANK_RECON นี้เป็น "ผีซ้ำ" (orphan + มี live twin) → ไม่ต้องนับ
  const isReconDupOrphan = (fe, date, amt) => {
    const { validIds, liveKeys } = reconValidity;
    if (validIds.size === 0) return false;                 // reconState ยังไม่โหลด/ไม่ใช้ → นับทุกแถว (กันยอดหาย)
    if (validIds.has(String(fe.id))) return false;         // ตัวจริง (ถูกอ้างใน reconState)
    const rk = String(fe.Bank_AC || '').trim() + '|' + date + '|' + amt + '|' + String(fe.DESCRIPTION || '').trim();
    return liveKeys.has(rk);                                // orphan + มี live twin → re-record ซ้ำ
  };

  // ── financeByCode lookup (เหมือนหน้า IV) — ใช้คำนวณ debt + netExpected ──
  const financeByCode = cfMemo(() => {
    if (window.WTPData && typeof window.WTPData.buildLookups === 'function') {
      try { return window.WTPData.buildLookups(data).financeByCode || {}; }
      catch (_) { return {}; }
    }
    return {};
  }, [data.projects, data.debtLedger]);
  const mainAccounts   = bankAccounts.filter(a => (a.accountType || 'main').toLowerCase() !== 'closed' && (a.accountType || 'main').toLowerCase() !== 'dormant');

  // ── Live balance + HOLD (sum across main bank accounts) ──────────────
  //   liveBalance     = ยอดรวมที่อยู่ในบัญชี (gross)
  //   liveHold        = ยอดที่กันไว้ HOLD (เช่น ค้ำประกัน LG, เช็คออกแล้วยังไม่ขึ้น)
  //   liveAvailable   = ใช้ได้จริง = balance - HOLD
  const liveBalance   = mainAccounts.reduce((s, a) => s + (Number(a.BALANCE) || 0), 0);
  const liveHold      = mainAccounts.reduce((s, a) => s + (Number(a.HOLD_AMOUNT) || 0), 0);
  const liveAvailable = liveBalance - liveHold;

  // ── B/F: balance at last day of previous month (auto from snapshots) ──
  //   ถ้าไม่มี snapshot ในเดือนก่อนเลย (ข้อมูลขาด) → fallback ใช้ยอดสดปัจจุบัน
  //   วันที่ 1 (ยังไม่มีรายการ) ยอดยกมาจะ = ใช้ได้ปัจจุบันโดยอัตโนมัติ
  const monthBF = cfMemo(() => {
    const prevYear  = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const lastDayPrev = new Date(prevYear, prevMonth, 0).getDate();
    const cutoff = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDayPrev).padStart(2, '0')}`;
    return openingBalanceAt(snapshots, cutoff, liveBalance);
  }, [snapshots, year, month, liveBalance]);
  // B/F แสดงเป็น Available (ยอดหลังหัก HOLD) — เพื่อสะท้อนเงินที่ใช้วางแผนจริงได้
  const monthBFAvailable = Math.max(0, monthBF - liveHold);

  // ── ovTick — re-render เมื่อ override (จาก cloud/user อื่น) เปลี่ยน ──────────
  //   กระตุ้น recompute ของ memo ที่อ่าน WTPOverride (ivPlanLock + pvActualByWeekCat → cf.pvCat)
  const [ovTick, setOvTick] = cfState(0);
  cfEffect(() => {
    const h = () => setOvTick(x => x + 1);
    window.addEventListener('wtp-override-change', h);
    return () => window.removeEventListener('wtp-override-change', h);
  }, []);

  // ── Forecast outflow by week × category — มาจาก forecastEntries ตั้งมือล้วน ──
  //   ประมาณการ = ยอดที่ "ตั้งล่วงหน้าตอนต้นเดือน" จากหน้า Forecast เท่านั้น
  //   (เลิกดึง AP ตามดิว — เรื่อง AP/เลือกจ่าย ไปจัดการที่หน้า Bank Diary)
  //   นับทุกแถวที่ไม่ถูกยกเลิก (รวม ACTUAL/BOOKED ที่ AMOUNT เดิม) → baseline แผนนิ่ง
  // [week][category] = sum
  const forecastByWeekCat = cfMemo(() => {
    const grid = weeks.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0 }));
    forecastEntries.forEach(fe => {
      const status = String(fe.STATUS || fe.status || '').toUpperCase();
      if (status === 'CANCELED') return;
      const isLoan = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN';
      if (isLoan) return;
      // จ่ายจริงจากหน้ากระทบยอด (BANK_RECON) = actual ล้วน ไม่เคยเป็นแผน → ไม่นับเป็นประมาณการ (กันยอดเบิ้ล)
      if (String(fe.EXPENSE_TYPE || '').toUpperCase() === 'BANK_RECON') return;
      const amt = Number(fe.AMOUNT || fe.amount || 0);
      if (amt >= 0) return;   // outflow only
      const date = fe.PAYMENT_DATE || fe.DATE || fe.paymentDate;
      if (!inMonth(date, year, month)) return;
      const wIdx = findWeekIdx(date, weeks);
      if (wIdx < 0) return;
      const cat = categorizeForecastEntry(fe);
      grid[wIdx][cat] += Math.abs(amt);
    });
    return grid;
  }, [forecastEntries, weeks, year, month]);

  // ── PV actual outflow by week × category ──────────────────────────────
  const pvActualByWeekCat = cfMemo(() => {
    const grid = weeks.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0 }));
    pvVouchers.forEach(pv => {
      const date = pv.Pmt_Date;
      if (!inMonth(date, year, month)) return;
      const wIdx = findWeekIdx(date, weeks);
      if (wIdx < 0) return;
      if (!pvMoneyOut(pv)) return;   // ตัดล่วงหน้า ยังไม่ถึงวันจ่าย → เงินยังไม่ออก → ยังไม่นับเป็นจ่ายจริง
      // จัดหมวด: override ราย PV (cf.pvCat) > AP ที่ผูก > vendor/keyword — ต้องตรงกับ drill-down (openActualDrill)
      const ap = pv.AP_No ? (payables.find(p => p.vchno === pv.AP_No) || null) : null;
      const cat = resolvePvCategory(pv, ap);
      // ★ ห้ามใช้ ||: Net_Amount=0 (ตัดมัดจำ/เคลียร์เงินทดรอง = ไม่มีเงินออก) เป็น falsy ใน JS
      //   → fallback ไป Amount (ก่อนหัก) → นับซ้ำเป็นเงินออกเต็มก้อน. ต้องเช็ค null/'' แทน.
      const amt = Number(pv.Net_Amount != null && pv.Net_Amount !== '' ? pv.Net_Amount : (pv.Amount || 0));
      grid[wIdx][cat] += amt;
    });
    // Also include forecastEntries with STATUS in {ACTUAL, BOOKED} as actuals
    forecastEntries.forEach(fe => {
      const status = String(fe.STATUS || fe.status || '').toUpperCase();
      if (status !== 'ACTUAL' && status !== 'BOOKED') return;
      const isLoan = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN';
      if (isLoan) return;
      const amt = Number(fe.ACTUAL_AMOUNT || fe.AMOUNT || fe.amount || 0);
      if (amt >= 0) return;
      const date = fe.ACTUAL_DATE || fe.PAYMENT_DATE || fe.DATE;
      if (!inMonth(date, year, month)) return;
      const wIdx = findWeekIdx(date, weeks);
      if (wIdx < 0) return;
      if (isReconDupOrphan(fe, date, amt)) return;   // แถวผี BANK_RECON ที่ซ้ำกับตัวจริง → ไม่นับ (LG จ่ายซ้ำจริงไม่โดน)
      const cat = categorizeForecastEntry(fe);
      grid[wIdx][cat] += Math.abs(amt);
    });
    return grid;
  }, [pvVouchers, payables, forecastEntries, ovTick, weeks, year, month, reconValidity]);

  // ── PV ตัดล่วงหน้า "ยังไม่ถึงวันจ่าย" (เงินยังไม่ออก) ราย week × cat ───────────────
  //   = ใบที่ถูกกันออกจาก pvActualByWeekCat → ใช้โชว์ตัวบ่งชี้ 🕐 + ทำให้คลิกเปิด drill ยืนยันได้
  //   (ไม่งั้นช่อง Actual = 0 จะคลิกไม่ได้ → เข้าไปกดยืนยันจ่ายจริงไม่ได้)
  const pendingPvByWeekCat = cfMemo(() => {
    const grid = weeks.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0 }));
    pvVouchers.forEach(pv => {
      const date = pv.Pmt_Date;
      if (!inMonth(date, year, month)) return;
      const wIdx = findWeekIdx(date, weeks);
      if (wIdx < 0) return;
      if (pvMoneyOut(pv)) return;   // เงินออกแล้ว/ยืนยันแล้ว → ไม่ใช่ pending
      const ap = pv.AP_No ? (payables.find(p => p.vchno === pv.AP_No) || null) : null;
      const cat = resolvePvCategory(pv, ap);
      const amt = Number(pv.Net_Amount != null && pv.Net_Amount !== '' ? pv.Net_Amount : (pv.Amount || 0));
      grid[wIdx][cat] += Math.abs(amt);
    });
    return grid;
  }, [pvVouchers, payables, ovTick, weeks, year, month]);

  // ── PV ทั้งหมด (จ่ายแล้ว+รอจ่าย) ราย week × cat — ใช้เช็คว่าหมวดนั้น "มี PV ไหม" ──────────
  //   หมวดที่ไม่มี PV เลย (เช่น 04 เงินเดือน/เบ็ดเตล็ด ที่จ่ายไม่ผ่าน PV) → โหมด 'pv' จะ fallback ประมาณการ
  const pvAnyByWeekCat = cfMemo(() => {
    const grid = weeks.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0 }));
    pvVouchers.forEach(pv => {
      const date = pv.Pmt_Date;
      if (!inMonth(date, year, month)) return;
      const wIdx = findWeekIdx(date, weeks);
      if (wIdx < 0) return;
      const ap = pv.AP_No ? (payables.find(p => p.vchno === pv.AP_No) || null) : null;
      const cat = resolvePvCategory(pv, ap);
      const amt = Number(pv.Net_Amount != null && pv.Net_Amount !== '' ? pv.Net_Amount : (pv.Amount || 0));
      grid[wIdx][cat] += Math.abs(amt);
    });
    return grid;
  }, [pvVouchers, payables, weeks, year, month]);

  // ── ประมาณการรายจ่าย "คงเหลือ" = forecast − จ่ายจริงแล้ว (ราย week × cat, floor 0) ──────
  //   ตารางประมาณการรายสัปดาห์ (Section 01) แสดง "ยอดที่ยังต้องจ่าย" — หักส่วนที่จ่าย Actual (PV) ไปแล้ว
  //   เหตุผล: เงินที่จ่ายจริงไปแล้วออกจากยอดเงินสดคงเหลือ (B/F สัปดาห์ = ยอดสดปัจจุบัน) ไปแล้ว
  //           ถ้าหักประมาณการเต็มอีก = นับซ้ำ → คงเหลือปลายงวดต่ำเกินจริง
  //           (mirror ฝั่งรับเงิน ivInflowByWeek.forecastRemaining ที่ตัด IV ที่รับแล้วออก)
  //   ⚠️ ใช้เฉพาะตารางประมาณการ (Section 01) — KPI การ์ด (outflowForecast) + การ์ดติดตามรายสัปดาห์
  //      (Section 02) ยังใช้ forecast เต็ม เพื่อเทียบ Forecast vs Actual ตามเดิม
  const forecastRemainingByWeekCat = cfMemo(() =>
    forecastByWeekCat.map((g, i) => {
      const a = pvActualByWeekCat[i] || {};
      return {
        1: Math.max(0, (g[1] || 0) - (a[1] || 0)),
        2: Math.max(0, (g[2] || 0) - (a[2] || 0)),
        3: Math.max(0, (g[3] || 0) - (a[3] || 0)),
        4: Math.max(0, (g[4] || 0) - (a[4] || 0)),
      };
    }), [forecastByWeekCat, pvActualByWeekCat]);

  // ── โหมด 'pv' (ยอด PV ที่ตัด) ราย week × cat ─────────────────────────────────
  //   หมวดที่ "มี PV" (จ่ายแล้ว/รอจ่าย) → ใช้ยอด PV ตัดล่วงหน้า (pending; กดจ่ายจริง→หักเป็น 0)
  //   หมวดที่ "ไม่มี PV เลย" (เช่น 04 เงินเดือน/เบ็ดเตล็ด) → fallback ใช้ประมาณการคงเหลือ (ไม่ปล่อยว่าง)
  const pvModeGridByWeekCat = cfMemo(() =>
    pendingPvByWeekCat.map((g, i) => {
      const any = pvAnyByWeekCat[i] || {};
      const f   = forecastRemainingByWeekCat[i] || {};
      const v = (c) => (any[c] || 0) > 0 ? (g[c] || 0) : (f[c] || 0);
      return { 1: v(1), 2: v(2), 3: v(3), 4: v(4) };
    }), [pendingPvByWeekCat, pvAnyByWeekCat, forecastRemainingByWeekCat]);

  // ════ โหมด "แผนจ่ายจริง (AP)" สำหรับ Section 01 ช่องรายจ่าย ════════════════════
  //   หลักๆ = รายการ AP ที่เลือกจ่ายไว้แล้วจากหน้า Bank Diary (ขึ้น CARD BANK)
  //   + รายการตั้งมือที่ผู้ใช้ติ๊กเลือกรวมเอง (cf.sec1Inc.<id>) — กันนับซ้ำกับ Section 02
  // ── paidApSet: เลขที่ AP ที่จ่ายจริงผ่าน PV แล้ว (PV.AP_No) → ตัด AP-plan ที่จ่ายแล้วออก ──
  const paidApSet = cfMemo(() => {
    const s = new Set();
    pvVouchers.forEach(pv => pvSettledDocs(pv).forEach(d => s.add(d)));   // AP_No + บิลย่อย settles[] (1 เช็คจ่ายหลายบิล)
    return s;
  }, [pvVouchers]);

  // ── apPlanByWeekCat: AP ที่ "เลือกจ่ายไว้" (EXPENSE_TYPE='AP', PLANNED, ยังไม่จ่ายผ่าน PV) ──
  //   อ่านจาก data.forecastEntries (ดิบ) เพราะ forecastEntries (ตัวแปร) ถูกกรอง AP ออกไปแล้ว
  const apPlanByWeekCat = cfMemo(() => {
    const grid = weeks.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0 }));
    (data.forecastEntries || []).forEach(fe => {
      if (String(fe.EXPENSE_TYPE || '').toUpperCase() !== 'AP') return;
      const status = String(fe.STATUS || fe.status || '').toUpperCase();
      if (status === 'CANCELED' || status === 'ACTUAL' || status === 'BOOKED') return;  // จ่ายจริงแล้ว = ไม่ใช่แผนค้าง
      const ref = String(fe.REF_DOC || '').trim();
      if (ref && paidApSet.has(ref)) return;   // จ่ายจริงผ่าน PV แล้ว → ตัด (mirror การ์ด Bank Diary)
      const amt = Number(fe.AMOUNT || fe.amount || 0);
      if (amt >= 0) return;
      const date = fe.PAYMENT_DATE || fe.DATE || fe.paymentDate;
      if (!inMonth(date, year, month)) return;
      const wIdx = findWeekIdx(date, weeks);
      if (wIdx < 0) return;
      grid[wIdx][categorizeForecastEntry(fe)] += Math.abs(amt);
    });
    return grid;
  }, [data.forecastEntries, paidApSet, weeks, year, month]);

  // ── manualIncludedByWeekCat: รายการตั้งมือที่ติ๊กเลือกรวมเอง (cf.sec1Inc.<id>) ──
  //   default ไม่รวม · ovTick กระตุ้น recompute เมื่อ override เปลี่ยน
  const manualIncludedByWeekCat = cfMemo(() => {
    const grid = weeks.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0 }));
    forecastEntries.forEach(fe => {   // forecastEntries = non-AP แล้ว
      if (!fe.id || !WTPOverride.resolve(cfSec1IncKey(fe.id), 0)) return;
      const status = String(fe.STATUS || fe.status || '').toUpperCase();
      if (status === 'CANCELED' || status === 'ACTUAL' || status === 'BOOKED') return;
      const isLoan = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN';
      if (isLoan) return;
      if (String(fe.EXPENSE_TYPE || '').toUpperCase() === 'BANK_RECON') return;
      const amt = Number(fe.AMOUNT || fe.amount || 0);
      if (amt >= 0) return;
      const date = fe.PAYMENT_DATE || fe.DATE || fe.paymentDate;
      if (!inMonth(date, year, month)) return;
      const wIdx = findWeekIdx(date, weeks);
      if (wIdx < 0) return;
      grid[wIdx][categorizeForecastEntry(fe)] += Math.abs(amt);
    });
    return grid;
  }, [forecastEntries, ovTick, weeks, year, month]);

  // ── apPlanCombinedByWeekCat = AP ที่เลือกจ่าย + ตั้งมือที่ติ๊กรวม (ยอดในโหมด 'apPlan') ──
  const apPlanCombinedByWeekCat = cfMemo(() =>
    apPlanByWeekCat.map((g, i) => {
      const m = manualIncludedByWeekCat[i] || {};
      return { 1: (g[1] || 0) + (m[1] || 0), 2: (g[2] || 0) + (m[2] || 0),
               3: (g[3] || 0) + (m[3] || 0), 4: (g[4] || 0) + (m[4] || 0) };
    }), [apPlanByWeekCat, manualIncludedByWeekCat]);

  // ── apPlanScopedByWeekCat = จำกัดขอบเขตตาม s01ApScope ──
  //   'week' = สัปดาห์ปัจจุบัน = AP plan ที่เลือก · สัปดาห์ที่เหลือ = forecastRemaining (ประมาณการคีย์มือ)
  //   'month' = AP plan เต็มเดือนเหมือนเดิม
  const apPlanScopedByWeekCat = cfMemo(() =>
    s01ApScope === 'week'
      ? apPlanCombinedByWeekCat.map((g, i) => i === nowWeek ? g : (forecastRemainingByWeekCat[i] || { 1: 0, 2: 0, 3: 0, 4: 0 }))
      : apPlanCombinedByWeekCat,
    [apPlanCombinedByWeekCat, s01ApScope, nowWeek, forecastRemainingByWeekCat]);
  //   pvModeScopedByWeekCat = โหมด 'pv' จำกัดขอบเขตตาม s01ApScope (ใช้ปุ่มเดียวกับ AP)
  //   'week' = สัปดาห์ปัจจุบัน = ยอด PV ที่ตัด · สัปดาห์ที่เหลือ = ประมาณการคงเหลือ (เหมือน AP) · 'month' = เต็มเดือน
  const pvModeScopedByWeekCat = cfMemo(() =>
    s01ApScope === 'week'
      ? pvModeGridByWeekCat.map((g, i) => i === nowWeek ? g : (forecastRemainingByWeekCat[i] || { 1: 0, 2: 0, 3: 0, 4: 0 }))
      : pvModeGridByWeekCat,
    [pvModeGridByWeekCat, s01ApScope, nowWeek, forecastRemainingByWeekCat]);

  // ── IV PLAN lock — baseline "คาดรับ" ที่ freeze ตั้งแต่วันที่ 1 ของเดือน ──
  //   ovTick กระตุ้น recompute เมื่อ override (จาก cloud/user อื่น) เปลี่ยน
  const ivPlanLock = cfMemo(() => readIvPlanLock(ovPrefix), [ovPrefix, ovTick, year, month]);

  // ── Inflow: IV project receipts (forecast + actual) ───────────────────
  const ivInflowByWeek = cfMemo(() => {
    const liveForecast = weeks.map(() => 0);
    const actual       = weeks.map(() => 0);
    const bySafe       = {};   // sanitized ivNo → live IV (ไว้เช็คสถานะรับเงิน)
    invoices.forEach(iv => {
      const s = sanitizeIvKey(iv.ivNo || iv.IV_NO || iv.invoiceNo); if (s) bySafe[s] = iv;
      if (!ivIsProject(iv)) return;  // เฉพาะประเภทงานโครงการ (P) — ตัด O ออก
      const net = ivNetExpected(iv, financeByCode);
      // Live forecast (fallback เมื่อเดือนยังไม่ถูกล็อก) — IV ที่ยังไม่รับเงิน + คาดรับเดือนนี้
      if (!ivIsPaid(iv) && iv.expectedReceive && inMonth(iv.expectedReceive, year, month)) {
        const w = findWeekIdx(iv.expectedReceive, weeks);
        if (w >= 0) liveForecast[w] += net;
      }
      // Actual bucket — เฉพาะ IV ที่มี actualReceive.date ตกในเดือนนี้ (เปลี่ยนตามจริงเสมอ)
      const ad = ivActualReceiveDate(iv);
      if (ad && inMonth(ad, year, month)) {
        const w = findWeekIdx(ad, weeks);
        if (w >= 0) actual[w] += net;
      }
    });
    // PLAN เต็ม = baseline ที่ freeze (สำหรับการ์ด KPI — นิ่ง ไม่หดเมื่อ IV ถูกรับเงิน)
    //   ไม่งั้น fallback = forecast สด (เดือนเก่าที่ไม่เคยล็อก / ก่อนมีฟีเจอร์)
    const forecast = ivPlanLock.locked
      ? ivPlanBucketsFromLock(ivPlanLock.items, weeks.length)
      : liveForecast;
    // PLAN ที่เหลือ = baseline เต็ม − IV ที่รับเงินแล้ว (สำหรับ "ตารางประมาณการรายสัปดาห์" → ยอดที่ยังคาดจะรับ)
    //   เหตุผล: เงินที่รับแล้วอยู่ในยอดยกมา (เงินสดคงเหลือ) แล้ว — ถ้านับซ้ำ Final Net Position บวมเกินจริง
    let forecastRemaining;
    if (ivPlanLock.locked) {
      forecastRemaining = weeks.map(() => 0);
      ivPlanLock.items.forEach(it => {
        const iv = bySafe[it.safe];
        if (iv && ivIsPaid(iv)) return;   // รับแล้ว → ไม่นับในยอดคาดที่เหลือ
        if (it.wk >= 0 && it.wk < weeks.length) forecastRemaining[it.wk] += (it.net || 0);
      });
    } else {
      forecastRemaining = liveForecast.slice();   // ยังไม่ล็อก → liveForecast ตัด paid อยู่แล้ว
    }
    return { forecast, actual, liveForecast, forecastRemaining };
  }, [invoices, weeks, year, month, ivPlanLock, financeByCode]);

  // ── What-if items: รายการ "แผนที่ยังไม่เกิดจริง" รายตัว (จ่าย/รับ) สำหรับพาเนลจำลอง ──
  //   ใช้ filter เดียวกับ forecastByWeekCat (จ่าย) + ivInflowByWeek.liveForecast (รับ) แต่ emit รายตัว
  //   เพื่อให้เลื่อนวันรายรายการได้. นับเฉพาะ PLANNED (ตัด ACTUAL/BOOKED ที่เกิดไปแล้ว = อยู่ในยอดสดแล้ว)
  const whatIfItems = cfMemo(() => {
    const out = [];
    forecastEntries.forEach(fe => {
      const status = String(fe.STATUS || fe.status || '').toUpperCase();
      if (status === 'CANCELED' || status === 'ACTUAL' || status === 'BOOKED') return;
      const etype = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase();
      if (etype === 'LOAN' || etype === 'BANK_RECON') return;
      const amt = Number(fe.AMOUNT || fe.amount || 0);
      if (amt >= 0) return;   // outflow only
      const date = fe.PAYMENT_DATE || fe.DATE || fe.paymentDate;
      if (!inMonth(date, year, month)) return;
      const w = findWeekIdx(date, weeks);
      if (w < 0) return;
      out.push({ id: 'o_' + (fe.id || out.length), dir: 'out',
        label: fe.VENDOR || fe.vendor || fe.DESCRIPTION || fe.description || fe.REF_DOC || 'รายจ่าย',
        amount: Math.abs(amt), week: w });
    });
    invoices.forEach(iv => {
      if (!ivIsProject(iv)) return;
      if (ivIsPaid(iv)) return;
      if (!iv.expectedReceive || !inMonth(iv.expectedReceive, year, month)) return;
      const w = findWeekIdx(iv.expectedReceive, weeks);
      if (w < 0) return;
      const net = ivNetExpected(iv, financeByCode);
      if (!(net > 0)) return;
      out.push({ id: 'i_' + (iv.id || iv.ivNo || out.length), dir: 'in',
        label: iv.customerName || iv.customer || iv.ivNo || iv.IV_NO || 'รับเงินโครงการ',
        amount: net, week: w });
    });
    forecastEntries.forEach(fe => {
      if (String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() !== 'LOAN') return;
      const status = String(fe.STATUS || '').toUpperCase();
      if (status === 'CANCELED' || status === 'ACTUAL' || status === 'BOOKED') return;
      const amt = Number(fe.AMOUNT || fe.amount || 0);
      if (amt <= 0) return;
      const date = fe.PAYMENT_DATE || fe.DATE;
      if (!inMonth(date, year, month)) return;
      const w = findWeekIdx(date, weeks);
      if (w < 0) return;
      out.push({ id: 'l_' + (fe.id || out.length), dir: 'in',
        label: fe.DESCRIPTION || fe.description || 'เงินกู้รับเข้า', amount: amt, week: w });
    });
    return out;
  }, [forecastEntries, invoices, weeks, year, month, financeByCode]);

  // ── Loan inflow (forecast + actual) — from forecastEntries CATEGORY=LOAN
  //   Plan   = baseline ที่คาดไว้ — นับทุกแถวที่ไม่ใช่ CANCELED (รวม ACTUAL/BOOKED ด้วย)
  //            ใช้ AMOUNT (ยอดเดิมที่วางแผน) ที่ PAYMENT_DATE
  //   Actual = ที่เกิดจริงแล้ว — เฉพาะ ACTUAL/BOOKED
  //            ใช้ ACTUAL_AMOUNT ที่ ACTUAL_DATE (fallback PAYMENT_DATE)
  const loanByWeek = cfMemo(() => {
    const forecast = weeks.map(() => 0);
    const actual   = weeks.map(() => 0);
    forecastEntries.forEach(fe => {
      const isLoan = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN';
      if (!isLoan) return;
      const amt = Number(fe.AMOUNT || fe.amount || 0);
      if (amt <= 0) return;
      const status = String(fe.STATUS || '').toUpperCase();
      if (status === 'CANCELED') return;

      // Plan bucket — ใส่ baseline ทุกแถวที่ไม่ถูกยกเลิก
      const planDate = fe.PAYMENT_DATE || fe.DATE;
      if (planDate && inMonth(planDate, year, month)) {
        const wF = findWeekIdx(planDate, weeks);
        if (wF >= 0) forecast[wF] += amt;
      }

      // Actual bucket — เฉพาะ ACTUAL/BOOKED ใช้ ACTUAL_DATE + ACTUAL_AMOUNT
      if (status === 'ACTUAL' || status === 'BOOKED') {
        const actualDate = fe.ACTUAL_DATE || fe.PAYMENT_DATE || fe.DATE;
        if (actualDate && inMonth(actualDate, year, month)) {
          const wA = findWeekIdx(actualDate, weeks);
          if (wA >= 0) actual[wA] += Number(fe.ACTUAL_AMOUNT || amt);
        }
      }
    });
    return { forecast, actual };
  }, [forecastEntries, weeks, year, month]);

  // ── Lock / re-lock IV plan baseline (freeze ยอดคาดรับของเดือนที่ดูอยู่) ────
  //   เก็บ net + week ราย IV ทุกใบที่ expectedReceive ตกในเดือนนี้ (ไม่กรอง paid —
  //   ใบที่เก็บได้ต้นเดือนก็เคยเป็นส่วนของแผน) แบบ batch ลง WTPOverride
  const doLockIvPlan = (opts) => {
    const auto = !!(opts && opts.auto);
    if (cfIsReadOnly()) { if (!auto && typeof toast === 'function') toast('สิทธิ์นี้ดูได้อย่างเดียว — ล็อกแผนไม่ได้'); return; }
    if (typeof WTPOverride === 'undefined' || typeof WTPOverride.setMany !== 'function') return;
    const prefix = `${ovPrefix}.${IVPLAN_SEG}.`;
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const entries = {};
    let count = 0;
    invoices.forEach(iv => {
      if (!iv.expectedReceive || !inMonth(iv.expectedReceive, year, month)) return;
      if (!ivIsProject(iv)) return;  // เฉพาะประเภทงานโครงการ (P) — ตัด O ออกจากการล็อกแผน
      // ตัด IV ที่ "รับเงินจริงไปแล้วก่อนเดือนนี้" — เป็นเงินของเดือนก่อน ไม่ใช่แผนเดือนนี้
      //   (ใบที่รับเงินภายในเดือนนี้ยังคงไว้ — เคยเป็นแผน + เกิดจริงในเดือนเดียวกัน)
      const ad = ivActualReceiveDate(iv);
      if (ad && toISODate(ad) < monthStart) return;
      const net = ivNetExpected(iv, financeByCode);
      if (!(net >= 1)) return;                 // net ≈ 0 (หนี้กลบหมด) — ไม่มีอะไรให้รับ ข้าม
      const safe = sanitizeIvKey(iv.ivNo || iv.IV_NO || iv.invoiceNo);
      if (!safe) return;
      const w = findWeekIdx(iv.expectedReceive, weeks);
      if (w < 0) return;
      entries[`${prefix}${safe}.net`] = net;
      entries[`${prefix}${safe}.wk`]  = w;
      count++;
    });
    // เคลียร์คีย์เก่าของเดือนนี้ที่ไม่อยู่ในชุดใหม่ (IV ที่ถูกลบ/เปลี่ยนเลขที่ไปแล้ว)
    const all = WTPOverride._load();
    Object.keys(all).forEach(k => {
      if (!k.startsWith(prefix)) return;
      if (k === `${prefix}${IVPLAN_LOCKED_AT}`) return;   // marker ตั้งใหม่ด้านล่าง
      if (!(k in entries)) entries[k] = null;             // null = ลบ
    });
    entries[`${prefix}${IVPLAN_LOCKED_AT}`] = todayYmdInt();
    WTPOverride.setMany(entries);
    if (typeof toast === 'function') {
      toast(auto
        ? `📌 ล็อกแผนรับเงิน IV เดือนนี้ไว้แล้ว (อัตโนมัติ) · ${count} ใบ`
        : `🔒 ล็อกแผนรับเงิน IV ใหม่แล้ว · ${count} ใบ`);
    }
  };

  // ปุ่ม "ล็อกแผน/ล็อกใหม่" — ถ้าล็อกอยู่แล้วถามยืนยันก่อนทับ
  const handleLockClick = () => {
    if (ivPlanLock.locked &&
        !window.confirm('ล็อกแผนรับเงิน IV ของเดือนนี้ใหม่?\nยอดแผนเดิมที่จับไว้จะถูกแทนที่ด้วยยอด "คาดรับ" ณ ตอนนี้')) return;
    doLockIvPlan({});
  };

  // ── Auto-capture: ล็อกแผนอัตโนมัติครั้งแรกที่เปิดหน้าในเดือนปัจจุบัน ──────────
  //   ใครเปิดก่อนเป็นคนจับ · idempotent ด้วย __lockedAt · role read-only ข้าม
  //   รอ manualOverrides (cloud) + invoices โหลดก่อน — กัน double-capture/จับยอดว่าง
  const autoLockRef = React.useRef('');
  cfEffect(() => {
    const isCurrentMonth = (today.getFullYear() === year) && ((today.getMonth() + 1) === month);
    if (!isCurrentMonth) return;
    if (autoLockRef.current === ovPrefix) return;            // ลองแล้วใน session นี้
    if (cfIsReadOnly()) return;
    if (!Array.isArray(data.manualOverrides)) return;        // รอ cloud overrides โหลด
    if (!Array.isArray(invoices) || invoices.length === 0) return;  // รอ invoices โหลด
    if (ivPlanLock.locked) { autoLockRef.current = ovPrefix; return; }  // ล็อกอยู่แล้ว
    autoLockRef.current = ovPrefix;
    doLockIvPlan({ auto: true });
  }, [ovPrefix, year, month, ivPlanLock.locked, data.manualOverrides, invoices.length]);

  // ── Month totals ──────────────────────────────────────────────────────
  const sumArr = arr => arr.reduce((s, v) => s + (v || 0), 0);
  const sumCatArr = (grid, cat) => grid.reduce((s, g) => s + (g[cat] || 0), 0);

  const inflowForecast = sumArr(ivInflowByWeek.forecast) + sumArr(loanByWeek.forecast);
  const inflowActual   = sumArr(ivInflowByWeek.actual)   + sumArr(loanByWeek.actual);
  const loanForecast   = sumArr(loanByWeek.forecast);
  const loanActual     = sumArr(loanByWeek.actual);
  const ivForecast     = sumArr(ivInflowByWeek.forecast);
  const ivActual       = sumArr(ivInflowByWeek.actual);

  const outflowForecast = [1,2,3,4].reduce((s, c) => s + sumCatArr(forecastByWeekCat, c), 0);
  const outflowActual   = [1,2,3,4].reduce((s, c) => s + sumCatArr(pvActualByWeekCat, c), 0);

  // Strategic Management = end-of-month projected net
  //   ใช้ Available (B/F หลังหัก HOLD) เพื่อสะท้อนเงินที่ "วางแผนใช้ได้จริง"
  //   หัก: ประมาณการรายจ่าย 4 หมวด (forecastEntries)
  const strategicNet = monthBFAvailable + loanForecast + ivForecast - outflowForecast;

  // ── Plan section: current week vs rest-of-month ───────────────────────
  // Rule from M_Forecast Excel:
  //   "rest" column = sum of remaining weeks IN THIS MONTH
  //   IF current week IS the LAST week of month → "rest" = forecast for next month
  const isLastWeekOfMonth = nowWeek === weeks.length - 1;
  const currentRestSplit = (weekArr, nextMonthFallback) => ({
    current: weekArr[nowWeek] || 0,
    rest:    isLastWeekOfMonth
      ? (nextMonthFallback || 0)
      : weekArr.reduce((s, v, i) => i > nowWeek ? s + (v || 0) : s, 0),
    total:   (weekArr[nowWeek] || 0) +
             (isLastWeekOfMonth
                ? (nextMonthFallback || 0)
                : weekArr.reduce((s, v, i) => i > nowWeek ? s + (v || 0) : s, 0)),
  });

  // ── Pull next-month forecast (used only when current = last week) ─────
  const nextMonthInflow = cfMemo(() => {
    if (!isLastWeekOfMonth) return { iv: 0, loan: 0, out: { 1: 0, 2: 0, 3: 0, 4: 0 } };
    const nextYear  = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    // ฝั่งรับ "สัปดาห์ที่เหลือ" (= เดือนถัดไป) ใช้ยอดเดียวกับ War Room รายรับ SEC03:
    //   "ใบแจ้งหนี้คงค้างที่ยังไม่ได้รับเงิน และวันคาดรับอยู่นอกเดือนปัจจุบัน" (ค้างรับ + ยังไม่ระบุวัน + เดือนถัดไปขึ้นไป)
    //   netExpected = balance − debt (ไม่หัก WHT) — ตรงกับ War Room เพื่อให้ผู้ใช้กระทบยอดได้
    //   เมื่อขึ้นเดือนใหม่ จะไม่ใช่สัปดาห์สุดท้ายอีก → กลับไปใช้เงื่อนไขปกติเอง
    const _p2 = (n) => String(n).padStart(2, '0');
    const curMonthStr = `${year}-${_p2(month)}`;   // เดือนที่กำลังดู (= เดือนปัจจุบันจริง เพราะ rollover เกิดเฉพาะสัปดาห์สุดท้ายของเดือนนี้)
    let iv = 0, loan = 0;
    const out = { 1: 0, 2: 0, 3: 0, 4: 0 };
    invoices.forEach(ivRow => {
      // ลูกหนี้คงค้าง (เฉพาะงานโครงการ) ที่ยังไม่ได้รับเงิน
      if (ivIsPaid(ivRow)) return;
      if (!ivIsProject(ivRow)) return;
      const recvISO = toISODate(ivRow.expectedReceive);
      // คาดรับ "ในเดือนนี้" → เป็นยอดของเดือนปัจจุบัน (War Room SEC02) ไม่ใช่ SEC03
      if (recvISO && recvISO.startsWith(curMonthStr)) return;
      iv += ivWarroomNet(ivRow, financeByCode);
    });
    forecastEntries.forEach(fe => {
      const isLoan = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN';
      const status = String(fe.STATUS || '').toUpperCase();
      if (status === 'CANCELED') return;
      if (String(fe.EXPENSE_TYPE || '').toUpperCase() === 'BANK_RECON') return;  // จ่ายจริงจากกระทบยอด = actual ไม่นับเป็นประมาณการ
      const amt  = Number(fe.AMOUNT || fe.amount || 0);
      const date = fe.PAYMENT_DATE || fe.DATE;
      if (!inMonth(date, nextYear, nextMonth)) return;
      if (isLoan && amt > 0) loan += amt;
      if (!isLoan && amt < 0) out[categorizeForecastEntry(fe)] += Math.abs(amt);
    });
    return { iv, loan, out };
  }, [isLastWeekOfMonth, invoices, forecastEntries, year, month, weeks, nowWeek, financeByCode]);

  // Plan table — use forecast bucket only (it already includes all entries,
  //   ACTUAL items at their planned date). Drill-down popup shows breakdown.
  //   Note: an entry that landed on a different week than planned will only
  //   appear at its planned week in the Plan table — that's intentional.
  const ivCombinedByWeek   = ivInflowByWeek.forecastRemaining;  // ตารางประมาณการ = แผนล็อก − IV ที่รับแล้ว (KPI ยังใช้ .forecast เต็ม)
  const loanCombinedByWeek = loanByWeek.forecast;

  const planIv   = currentRestSplit(ivCombinedByWeek,   nextMonthInflow.iv);
  const planLoan = currentRestSplit(loanCombinedByWeek, nextMonthInflow.loan);
  // ตาราง Plan รายสัปดาห์ (รายจ่าย) — ใช้ "ยอดคงเหลือ" (forecast − จ่ายจริงแล้ว) ไม่ใช่ forecast เต็ม
  //   → ช่องสัปดาห์ปัจจุบันโชว์เฉพาะส่วนที่ "ยังต้องจ่าย" (mirror ฝั่งรับเงิน ivCombinedByWeek)
  //   KPI การ์ด + Section 02 (ติดตามจ่ายจริง) ยังใช้ forecast เต็ม — ตัวเลขจึงต่างกันโดยตั้งใจ
  //   โหมด 'apPlan' = แผนจ่ายจริง (AP ที่เลือกจ่าย + ตั้งมือที่ติ๊กรวม) ไม่มี rollover เดือนถัดไป
  //   'pv' = ใช้ยอด PV ที่ตัดล่วงหน้า (รอจ่าย) ตรงๆ · 'apPlan' = แผน AP · 'remaining' = ประมาณการ − จ่ายแล้ว
  const _outGrid     = s01OutMode === 'apPlan' ? apPlanScopedByWeekCat
                     : s01OutMode === 'pv'     ? pvModeScopedByWeekCat
                     : forecastRemainingByWeekCat;
  const _outRollover = (s01OutMode === 'apPlan' || s01OutMode === 'pv') ? { 1: 0, 2: 0, 3: 0, 4: 0 } : nextMonthInflow.out;
  const planOut  = {
    1: currentRestSplit(_outGrid.map(g => g[1]), _outRollover[1]),
    2: currentRestSplit(_outGrid.map(g => g[2]), _outRollover[2]),
    3: currentRestSplit(_outGrid.map(g => g[3]), _outRollover[3]),
    4: currentRestSplit(_outGrid.map(g => g[4]), _outRollover[4]),
  };
  // ใช้ค่าที่ resolve override แล้ว เพื่อให้ "รวมรายจ่าย" สะท้อนยอดที่ user คีย์มือ
  // และ net end-of-week/month ก็ใช้ยอดนี้คำนวณต่อด้วย
  // หมายเหตุ: outflow ใช้ Math.abs() เพราะ user อาจคีย์เป็นบวก หรือลบก็ได้
  //   (display โชว์ในวงเล็บ → คน entry-level บางคนคีย์ติดลบ, บางคนคีย์บวก)
  //   normalize ให้เป็นบวกเพื่อความเสถียรในการคำนวณ netEndOfWeek
  const _resolvedOut = (cat) => ({
    current: Math.abs(WTPOverride.resolve(`${ovPrefix}.s01.out${cat}.current`, planOut[cat].current)),
    rest:    Math.abs(WTPOverride.resolve(`${ovPrefix}.s01.out${cat}.rest`,    planOut[cat].rest)),
    total:   Math.abs(WTPOverride.resolve(`${ovPrefix}.s01.out${cat}.total`,   planOut[cat].total)),
  });
  //   รวมรายจ่าย = ประมาณการ 4 หมวด (forecastEntries)
  const totalOutCurrent = [1,2,3,4].reduce((s, c) => s + _resolvedOut(c).current, 0);
  const totalOutRest    = [1,2,3,4].reduce((s, c) => s + _resolvedOut(c).rest,    0);
  const totalOutAll     = [1,2,3,4].reduce((s, c) => s + _resolvedOut(c).total,   0);

  // ── Carry-forward base (net of HOLD) for the current-week column
  //   แถว "เงินสดคงเหลือยกมา" ของสัปดาห์ปัจจุบัน = เงินใช้ได้ปัจจุบัน (liveAvailable)
  //   ให้ตรงกับการ์ด "เงินสดใช้ได้ปัจจุบัน" ด้านบน · กรณีดูเดือนอื่น (ไม่มีสัปดาห์ปัจจุบัน) → ใช้ยอดต้นเดือน
  const weekBF = cfMemo(() => {
    const raw = (nowWeek == null || !weeks[nowWeek]) ? monthBF : liveBalance;
    return Math.max(0, raw - liveHold);
  }, [weeks, nowWeek, monthBF, liveBalance, liveHold]);

  // Net at end of current week + end of month — used in PlanRow + Net row
  // ใช้ค่าหลัง override สำหรับ inflow ด้วย เพื่อให้ คงเหลือ/Final Net Position ตามที่ user คีย์
  const _ivCur   = WTPOverride.resolve(`${ovPrefix}.s01.iv.current`,   planIv.current);
  const _ivRest  = WTPOverride.resolve(`${ovPrefix}.s01.iv.rest`,      planIv.rest);
  const _loanCur = WTPOverride.resolve(`${ovPrefix}.s01.loan.current`, planLoan.current);
  const _loanRest= WTPOverride.resolve(`${ovPrefix}.s01.loan.rest`,    planLoan.rest);
  const inflowCurrent      = _ivCur  + _loanCur;
  const inflowRest         = _ivRest + _loanRest;
  const netEndOfCurrentWeek= weekBF + inflowCurrent - totalOutCurrent;
  // For "rest" column, the "carry-forward" balance IS the closing of current week
  // (so the user can see how rest period plays out starting from that base)
  const netEndOfMonth      = netEndOfCurrentWeek + inflowRest - totalOutRest;

  // ── Week selector ─────────────────────────────────────────────────────
  // ─── Drill-down builder ──────────────────────────────────────────────────
  // For a given row+period, collect the underlying source rows so user can verify.
  // row    : 'iv' | 'loan' | 'out1' | 'out2' | 'out3' | 'out4'
  // period : 'current' | 'rest' | 'total'

  // ─── Drill-down โหมด "แผนจ่ายจริง (AP)" — ราย period × cat ───────────────────
  //   apItems = AP ที่เลือกจ่าย (รวมในยอดเสมอ) · manualCands = ตั้งมือในช่องนั้น (ติ๊กรวมได้)
  const openApPlanDrill = (cat, period, label) => {
    const wkInPeriod = (wIdx) =>
      s01ApScope === 'week' ? wIdx === nowWeek    // ขอบเขต "เฉพาะสัปดาห์นี้" → ทุกคอลัมน์เห็นเฉพาะสัปดาห์ปัจจุบัน
      : period === 'current' ? wIdx === nowWeek
      : period === 'rest'  ? wIdx > nowWeek
      : wIdx >= nowWeek;   // total
    const apItems = [], manualCands = [];
    (data.forecastEntries || []).forEach(fe => {
      if (String(fe.EXPENSE_TYPE || '').toUpperCase() !== 'AP') return;
      const status = String(fe.STATUS || fe.status || '').toUpperCase();
      if (status === 'CANCELED' || status === 'ACTUAL' || status === 'BOOKED') return;
      const ref = String(fe.REF_DOC || '').trim();
      if (ref && paidApSet.has(ref)) return;
      const amt = Number(fe.AMOUNT || fe.amount || 0);
      if (amt >= 0) return;
      const date = fe.PAYMENT_DATE || fe.DATE || fe.paymentDate;
      if (!inMonth(date, year, month)) return;
      const wIdx = findWeekIdx(date, weeks);
      if (wIdx < 0 || !wkInPeriod(wIdx) || categorizeForecastEntry(fe) !== cat) return;
      apItems.push({
        source: 'AP', date, name: fe.DESCRIPTION || ('จ่าย ' + (ref || '—')), ref, amount: amt,
        note: 'เลือกจ่ายไว้ · ' + (weeks[wIdx] && weeks[wIdx].label || '') + (fe.Bank_AC ? ' · ' + fe.Bank_AC : ''),
        detail: [
          ['รายการ', fe.DESCRIPTION || '—'],
          ['เลขที่ AP', ref || '—'],
          ['วันที่ตั้งจ่าย', fmtDate(date) || date],
          ['หมวด', cat + ' · ' + (CATEGORY_LABELS_SHORT[cat] || '—')],
          ['ยอด', fmtNum(Math.abs(amt), 2) + ' '],
          ['บัญชี', fe.Bank_AC || '—'],
          ['สถานะ', 'เลือกจ่ายไว้ (ยังไม่จ่ายจริง)'],
        ],
      });
    });
    forecastEntries.forEach(fe => {   // forecastEntries = non-AP แล้ว → รายการตั้งมือ
      if (!fe.id) return;
      const status = String(fe.STATUS || fe.status || '').toUpperCase();
      if (status === 'CANCELED' || status === 'ACTUAL' || status === 'BOOKED') return;
      if (String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN') return;
      if (String(fe.EXPENSE_TYPE || '').toUpperCase() === 'BANK_RECON') return;
      const amt = Number(fe.AMOUNT || fe.amount || 0);
      if (amt >= 0) return;
      const date = fe.PAYMENT_DATE || fe.DATE || fe.paymentDate;
      if (!inMonth(date, year, month)) return;
      const wIdx = findWeekIdx(date, weeks);
      if (wIdx < 0 || !wkInPeriod(wIdx) || categorizeForecastEntry(fe) !== cat) return;
      manualCands.push({ feId: fe.id, date, name: fe.DESCRIPTION || '—', ref: fe.JOB_NO || '', amount: amt });
    });
    apItems.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    manualCands.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    setDrillDown({ title: label, period, row: 'out' + cat, cat, apMode: true, apItems, manualCands });
  };

  const openDrillDown = (row, period, label) => {
    // โหมดแผนจ่ายจริง: ช่องรายจ่ายเปิด drill แบบ AP (รายการที่เลือกจ่าย + ติ๊กรวมตั้งมือ)
    // week scope + rest = สัปดาห์ที่เหลือแสดง forecastRemaining → ใช้ drill ปกติ
    if (row && row.indexOf('out') === 0 && s01OutMode === 'apPlan' && !(s01ApScope === 'week' && period === 'rest')) {
      openApPlanDrill(Number(row.slice(3)), period, label);
      return;
    }
    const isLastWeek = nowWeek === weeks.length - 1;
    const inCurrent  = (date) => {
      if (!inMonth(date, year, month)) return false;
      const w = findWeekIdx(date, weeks);
      return w === nowWeek;
    };
    const inRest = (date) => {
      if (isLastWeek) {
        const nyY = month === 12 ? year + 1 : year;
        const nyM = month === 12 ? 1 : month + 1;
        return inMonth(date, nyY, nyM);
      }
      if (!inMonth(date, year, month)) return false;
      const w = findWeekIdx(date, weeks);
      return w > nowWeek;
    };
    const inPeriod = (date) => {
      if (period === 'current') return inCurrent(date);
      if (period === 'rest')    return inRest(date);
      return inCurrent(date) || inRest(date);
    };

    const items = [];

    if (row === 'iv') {
      if (ivPlanLock.locked) {
        // ── โหมดล็อก: แสดง baseline ราย IV ที่ freeze + เทียบกับสถานะจริงตอนนี้ ──
        const isLastWk = nowWeek === weeks.length - 1;
        const wkInPeriod = (wk) => {
          if (period === 'current') return wk === nowWeek;
          if (period === 'rest')    return !isLastWk && wk > nowWeek;
          return wk >= nowWeek;   // total = สัปดาห์ปัจจุบันเป็นต้นไป (ตรงกับตาราง Plan)
        };
        // index IV สดด้วย sanitized ivNo เพื่อจับคู่กับ baseline
        const liveBySafe = {};
        invoices.forEach(iv => {
          const s = sanitizeIvKey(iv.ivNo || iv.IV_NO || iv.invoiceNo);
          if (s) liveBySafe[s] = iv;
        });
        ivPlanLock.items.forEach(it => {
          if (!wkInPeriod(it.wk)) return;
          const iv = liveBySafe[it.safe] || null;
          const paid = iv ? ivIsPaid(iv) : false;
          const ad   = iv ? ivActualReceiveDate(iv) : null;
          const liveNet = iv ? ivNetExpected(iv, financeByCode) : 0;
          let statusTxt;
          if (!iv)            statusTxt = '⚠️ ไม่พบ IV (ถูกลบ/แก้เลขที่)';
          else if (paid && ad) statusTxt = `✅ รับเงินแล้ว ${fmtDate(ad)}`;
          else                statusTxt = window.WTPData?.IV_STATUS_META?.[iv.status]?.short || iv.status || 'ยังไม่รับ';
          items.push({
            source: 'IV',
            isPaid: paid,                                     // รับแล้ว → ไปกลุ่ม "✅ จ่ายแล้ว" (ตัดจากยอดคาดที่เหลือ ให้ตรงกับตาราง)
            date: weeks[it.wk]?.fromISO || '',
            name: iv ? (iv.projectName || iv.PROJECT_NAME || iv.customer || '—') : it.safe,
            ref: iv ? (iv.ivNo || iv.IV_NO || iv.invoiceNo || it.safe) : it.safe,
            amount: it.net,                                   // ยอดแผนที่ freeze (ไม่ใช่ค่าสด)
            note: `${weeks[it.wk]?.label || 'W?'} · แผน ${fmtNum(it.net, 0)}` + (paid ? ' · ✅ รับแล้ว' : ''),
            detail: [
              ['โครงการ', iv ? (iv.projectName || iv.PROJECT_NAME || '—') : '—'],
              ['เลขที่ IV', iv ? (iv.ivNo || iv.IV_NO || iv.invoiceNo || '—') : it.safe],
              ['สัปดาห์ที่วางแผนรับ', weeks[it.wk]?.label || '—'],
              ['ยอดแผน (freeze ต้นเดือน)', fmtNum(it.net, 0) + ' '],
              ['คาดรับสุทธิ ณ ตอนนี้', iv ? fmtNum(liveNet, 0) + ' ' : '—'],
              ['รับจริงแล้ว', (paid && ad) ? `${fmtNum(liveNet, 0)} (${fmtDate(ad)})` : 'ยังไม่รับ'],
              ['สถานะปัจจุบัน', statusTxt],
            ],
          });
        });
        // สัปดาห์สุดท้าย: คอลัมน์ "ที่เหลือ/TOTAL" = ใบแจ้งหนี้คงค้างนอกเดือนปัจจุบัน
        //   (มิเรอร์ War Room รายรับ SEC03 — netExpected = balance − debt) ตรงกับ nextMonthInflow.iv
        if (isLastWk && (period === 'rest' || period === 'total')) {
          const nyY = month === 12 ? year + 1 : year;
          const nyM = month === 12 ? 1 : month + 1;
          const _p2 = (n) => String(n).padStart(2, '0');
          const curMonthStr = `${year}-${_p2(month)}`;
          invoices.forEach(iv => {
            if (ivIsPaid(iv)) return;
            if (!ivIsProject(iv)) return;
            const recvISO = toISODate(iv.expectedReceive);
            if (recvISO && recvISO.startsWith(curMonthStr)) return;
            const net = ivWarroomNet(iv, financeByCode);
            if (!(net > 0)) return;
            const tag = !recvISO ? 'ค้างรับ · ยังไม่ระบุวันคาดรับ'
              : inMonth(recvISO, nyY, nyM) ? 'คาดรับเดือนถัดไป'
              : 'ค้างรับ · นอกเดือนปัจจุบัน';
            items.push({
              source: 'IV',
              date: recvISO || '',
              name: iv.projectName || iv.PROJECT_NAME || iv.customer || '—',
              ref: iv.ivNo || iv.IV_NO || iv.invoiceNo || '',
              amount: net,
              note: tag,
              detail: [
                ['เลขที่ IV', iv.ivNo || iv.IV_NO || iv.invoiceNo || '—'],
                ['วันคาดรับ', recvISO ? (fmtDate(recvISO) || recvISO) : '— (ยังไม่ระบุ)'],
                ['ยอดคงค้าง', fmtNum(Number(iv.balance) || 0, 0) + ' '],
                ['คาดรับสุทธิ (balance − debt)', fmtNum(net, 0) + ' '],
                ['สถานะ', tag],
              ],
            });
          });
        }
      } else {
        // ── โหมดสด (เดือนที่ยังไม่เคยล็อก / ก่อนมีฟีเจอร์) — ตามเดิม ──
        invoices.forEach(iv => {
          // ลูกหนี้คงค้างทุกใบที่ยังไม่ได้รับเงิน — เดียวกับ logic main
          if (ivIsPaid(iv)) return;
          const d = iv.expectedReceive;
          if (!d || !inPeriod(d)) return;
          const ivStatusShort = window.WTPData?.IV_STATUS_META?.[iv.status]?.short || iv.status || '—';
          items.push({
            source: 'IV',
            date: d,
            name: iv.projectName || iv.PROJECT_NAME || iv.customer || '—',
            ref: iv.ivNo || iv.IV_NO || iv.invoiceNo || '',
            amount: ivNetExpected(iv, financeByCode),
            note: ivStatusShort + (iv.note ? ' · ' + iv.note : ''),
            detail: [
              ['โครงการ', iv.projectName || iv.PROJECT_NAME || '—'],
              ['ลูกค้า', iv.customer || '—'],
              ['เลขที่ IV', iv.ivNo || iv.IV_NO || iv.invoiceNo || '—'],
              ['วันคาดรับ', fmtDate(d) || d],
              ['ยอดคงค้าง', fmtNum(Number(iv.balance) || 0, 0) + ' '],
              ['คาดรับสุทธิ (หัก WHT/หนี้)', fmtNum(ivNetExpected(iv, financeByCode), 0) + ' '],
              ['สถานะ', ivStatusShort],
              ['หมายเหตุ', iv.note || '—'],
            ],
          });
        });
      }
    }

    if (row === 'loan') {
      forecastEntries.forEach(fe => {
        const isLoan = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN';
        if (!isLoan) return;
        const amt = Number(fe.AMOUNT || fe.amount || 0);
        if (amt <= 0) return;
        const status = String(fe.STATUS || '').toUpperCase();
        if (status === 'CANCELED') return;
        const d = fe.PAYMENT_DATE || fe.DATE;
        if (!d || !inPeriod(d)) return;
        const isRealized = status === 'ACTUAL' || status === 'BOOKED';
        items.push({
          source: 'Forecast',
          feId: fe.id,
          editable: !isRealized,   // แก้ได้เฉพาะ PLANNED (ยังไม่เกิดจริง)
          date: d,
          name: fe.DESCRIPTION || '—',
          ref: fe.JOB_NO || '',
          amount: isRealized ? Number(fe.ACTUAL_AMOUNT || amt) : amt,
          note: `STATUS=${status || 'PLANNED'}${fe.NOTE ? ' · ' + fe.NOTE : ''}`,
          detail: [
            ['รายการ', fe.DESCRIPTION || '—'],
            ['ประเภท', 'เงินกู้ / สินเชื่อ (LOAN)'],
            ['Job No.', fe.JOB_NO || '—'],
            ['โครงการ', fe.PROJECT_NAME || '—'],
            ['วันที่คาดรับ', fmtDate(fe.PAYMENT_DATE || fe.DATE) || '—'],
            ['ยอดประมาณการ', fmtNum(Math.abs(amt), 0) + ' '],
            ['สถานะ', status || 'PLANNED'],
            ['บัญชี', fe.Bank_AC || '—'],
            ['หมายเหตุ', fe.NOTE || '—'],
          ],
        });
      });
    }

    if (row && row.startsWith('out')) {
      const targetCat = Number(row.slice(3));
      // ประมาณการ = forecastEntries ตั้งมือล้วน (ไม่ดึง AP — ดู AP ที่หน้า Bank Diary)
      forecastEntries.forEach(fe => {
        const status = String(fe.STATUS || fe.status || '').toUpperCase();
        if (status === 'CANCELED') return;
        const isLoan = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN';
        if (isLoan) return;
        // จ่ายจริงจากกระทบยอด (BANK_RECON) ไม่ใช่ประมาณการ — ตัดออกให้ตรงกับ forecastByWeekCat
        if (String(fe.EXPENSE_TYPE || '').toUpperCase() === 'BANK_RECON') return;
        const amt = Number(fe.AMOUNT || fe.amount || 0);
        if (amt >= 0) return;
        const d = fe.PAYMENT_DATE || fe.DATE;
        if (!d || !inPeriod(d)) return;
        const cat = categorizeForecastEntry(fe);
        if (cat !== targetCat) return;
        const isRealized = status === 'ACTUAL' || status === 'BOOKED';
        items.push({
          source: 'Forecast',
          feId: fe.id,
          cat,
          editable: !isRealized,   // แก้ได้เฉพาะ PLANNED (ยังไม่เกิดจริง)
          date: d,
          name: fe.DESCRIPTION || '—',
          ref: fe.JOB_NO || '',
          amount: isRealized ? -Math.abs(Number(fe.ACTUAL_AMOUNT || amt)) : amt,
          note: `STATUS=${status || 'PLANNED'}${fe.NOTE ? ' · ' + fe.NOTE : ''}`,
          detail: [
            ['รายการ', fe.DESCRIPTION || '—'],
            ['Job No.', fe.JOB_NO || '—'],
            ['โครงการ', fe.PROJECT_NAME || '—'],
            ['วันที่จ่าย', fmtDate(fe.PAYMENT_DATE || fe.DATE) || '—'],
            ['ยอดประมาณการ', fmtNum(Math.abs(amt), 0) + ' '],
            ['หมวด', `${cat} · ${CATEGORY_LABELS_SHORT[cat] || '—'}`],
            ['สถานะ', status || 'PLANNED'],
            ['บัญชี', fe.Bank_AC || '—'],
            ['หมายเหตุ', fe.NOTE || '—'],
          ],
        });
      });
    }

    // สรุปยอดช่องรายจ่าย: โชว์ ประมาณการคงเหลือ + PV ตัดล่วงหน้า · "ยอดในช่อง" = ตามโหมดที่เลือก
    let outRecon = null;
    const outAdvancePv = [];
    if (row && row.startsWith('out')) {
      const cat = Number(row.slice(3));
      const fF   = currentRestSplit(forecastByWeekCat.map(g => g[cat] || 0),         nextMonthInflow.out[cat]);
      const fA   = currentRestSplit(pvActualByWeekCat.map(g => g[cat] || 0),          0);
      const fR   = currentRestSplit(forecastRemainingByWeekCat.map(g => g[cat] || 0), nextMonthInflow.out[cat]);
      const fP   = currentRestSplit(pendingPvByWeekCat.map(g => g[cat] || 0),         0);
      const fPvM = currentRestSplit(pvModeScopedByWeekCat.map(g => g[cat] || 0),      0);
      const fAny = currentRestSplit(pvAnyByWeekCat.map(g => g[cat] || 0),             0);
      const cell = s01OutMode === 'pv' ? fPvM[period] : fR[period];   // ยอดที่แสดงในช่อง ตามโหมด
      // โหมด pv + หมวดนี้ไม่มี PV เลย → ช่องใช้ประมาณการแทน (เช่น เงินเดือน/เบ็ดเตล็ด)
      const usedFallback = s01OutMode === 'pv' && (fAny[period] || 0) <= 0;
      outRecon = { mode: s01OutMode, usedFallback, forecast: fF[period], actual: fA[period], planRemaining: fR[period], pending: fP[period], remaining: cell };
      // เก็บ PV ตัดล่วงหน้า (ยังไม่ถึงวันจ่าย) ของหมวด+ช่วงนี้ → โชว์ + กดยืนยันจ่ายจริงได้จาก SEC01
      pvVouchers.forEach(pv => {
        const d = pv.Pmt_Date;
        if (!inMonth(d, year, month) || !inPeriod(d)) return;
        const ap = pv.AP_No ? (payables.find(p => p.vchno === pv.AP_No) || null) : null;
        if (resolvePvCategory(pv, ap) !== cat) return;
        const dISO = toISODate(d);
        if (!(dISO && dISO >= cfTodayISO)) return;   // เฉพาะที่ยังไม่ถึงวันจ่าย (รวมวันนี้)
        const amt = Number(pv.Net_Amount != null && pv.Net_Amount !== '' ? pv.Net_Amount : (pv.Amount || 0));
        outAdvancePv.push({
          pvNo: pv.PL_PV_No || '', date: d, cat,
          name: pv.Payee || (ap && (ap.cust_name || ap.vendor)) || '—',
          amount: Math.abs(amt),
          confirmed: !!WTPOverride.resolve(cfPvPaidKey(pv.PL_PV_No), 0),
        });
      });
      outAdvancePv.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }

    // Sort by date ascending
    items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    setDrillDown({ title: label, period, row, items, outRecon, advancePv: outAdvancePv });
  };

  // ─── Drill-down ฝั่ง "จ่ายจริง" (Actual) ราย week×cat ──────────────────────
  //   แสดงรายการจริงที่ประกอบเป็นยอด Actual ของช่องนั้น — mirror logic ของ
  //   pvActualByWeekCat เป๊ะ (PV + Forecast ACTUAL/BOOKED + AP ที่ทำเครื่องหมายจ่ายเอง)
  //   เพื่อให้ผลรวมในรายการ = ตัวเลขในช่องเสมอ
  //   cat = null → รวมทุกหมวดในสัปดาห์นั้น (ใช้กับยอด "Total Paid")
  const openActualDrill = (weekIdx, cat, label) => {
    const wantCat = (c) => cat == null || c === cat;
    const items = [];
    const advancePv = [];   // PV ตัดล่วงหน้า (Pmt_Date ยังไม่ถึง) — ไว้แสดง + ปุ่มยืนยันจ่ายจริง
    // 1) PV vouchers — เงินออกจริงตาม Pmt_Date
    pvVouchers.forEach(pv => {
      const date = pv.Pmt_Date;
      if (!inMonth(date, year, month)) return;
      if (findWeekIdx(date, weeks) !== weekIdx) return;
      const ap = pv.AP_No ? (payables.find(p => p.vchno === pv.AP_No) || null) : null;
      const c = resolvePvCategory(pv, ap);
      if (!wantCat(c)) return;
      // ★ ห้ามใช้ ||: Net_Amount=0 (ตัดมัดจำ) เป็น falsy → fallback ไป Amount → drill โชว์ยอดก่อนหัก
      const amt = Number(pv.Net_Amount != null && pv.Net_Amount !== '' ? pv.Net_Amount : (pv.Amount || 0));
      const dISO = toISODate(date);
      const isFuture  = !!dISO && dISO >= cfTodayISO;   // ยังไม่ถึงวันจ่าย (รวมวันนี้พอดี)
      const confirmed = !!WTPOverride.resolve(cfPvPaidKey(pv.PL_PV_No), 0);
      const item = {
        source: 'PV', date, pvNo: pv.PL_PV_No || '', cat: c,
        name: pv.Payee || (ap && (ap.cust_name || ap.vendor)) || '—',
        ref: pv.PL_PV_No || pv.AP_No || '',
        amount: -Math.abs(amt), isPaid: true,
        note: `จ่ายจริง · ${CATEGORY_LABELS_SHORT[c]}` + (pv.Ref_Code ? ' · ' + pv.Ref_Code : ''),
        detail: [
          ['ผู้รับเงิน', pv.Payee || '—'],
          ['เลขที่ PV', pv.PL_PV_No || '—'],
          ['เลขที่ AP (อ้างอิง)', pv.AP_No || '—'],
          ['วันที่จ่าย', fmtDate(date) || date],
          ['หมวด', `${c} · ${CATEGORY_LABELS_SHORT[c] || '—'}`],
          ['ยอดก่อนหัก', fmtNum(Number(pv.Amount) || 0, 2) + ' '],
          ['WHT', fmtNum(Number(pv.WHT) || 0, 2) + ' '],
          ['VAT', fmtNum(Number(pv.Vat) || 0, 2) + ' '],
          ['ยอดจ่ายสุทธิ', fmtNum(Math.abs(amt), 2) + ' '],
          ['บัญชีธนาคาร', pv.Bank_AC || '—'],
          ['ประเภทการจ่าย', pv.Type_of_Pmt || '—'],
          ['หมายเหตุ', pv.cc_remark || '—'],
        ],
      };
      // ตัดล่วงหน้า ยังไม่ถึงวันจ่าย + ยังไม่ยืนยัน → เข้าถัง advancePv (ไม่นับเข้ายอด)
      if (isFuture) advancePv.push({ pvNo: pv.PL_PV_No || '', date, name: item.name, amount: Math.abs(amt), cat: c, confirmed, item });
      if (!isFuture || confirmed) items.push(item);   // เงินออกแล้ว (เลยวัน) หรือยืนยันแล้ว → นับ
    });
    // 2) forecastEntries STATUS=ACTUAL/BOOKED — ประมาณการที่เกิดจริงแล้ว
    forecastEntries.forEach(fe => {
      const status = String(fe.STATUS || fe.status || '').toUpperCase();
      if (status !== 'ACTUAL' && status !== 'BOOKED') return;
      const isLoan = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN';
      if (isLoan) return;
      const amt = Number(fe.ACTUAL_AMOUNT || fe.AMOUNT || fe.amount || 0);
      if (amt >= 0) return;
      const date = fe.ACTUAL_DATE || fe.PAYMENT_DATE || fe.DATE;
      if (!inMonth(date, year, month)) return;
      if (findWeekIdx(date, weeks) !== weekIdx) return;
      const c = categorizeForecastEntry(fe);
      if (!wantCat(c)) return;
      if (isReconDupOrphan(fe, date, amt)) return;   // แถวผี BANK_RECON ที่ซ้ำกับตัวจริง → ไม่แสดง (ตรงกับ sum)
      // รายการที่บันทึกจ่ายจริงผ่านหน้ากระทบยอด (BANK_RECON) → ป้าย "STM" ไม่ใช่ "Forecast" (มันคือจ่ายจริง ไม่ใช่ประมาณการ)
      const isRecon = String(fe.EXPENSE_TYPE || '').toUpperCase() === 'BANK_RECON';
      items.push({
        source: isRecon ? 'STM' : 'Forecast', date,
        feId: fe.id || '', cat: c,
        name: fe.DESCRIPTION || '—',
        ref: fe.JOB_NO || '',
        amount: -Math.abs(amt), isPaid: true,
        note: `จ่ายจริง${isRecon ? ' · กระทบยอด (STM)' : ` (${status})`} · ${CATEGORY_LABELS_SHORT[c]}`,
        detail: [
          ['รายการ', fe.DESCRIPTION || '—'],
          ['Job No.', fe.JOB_NO || '—'],
          ['โครงการ', fe.PROJECT_NAME || '—'],
          ['วันที่จ่ายจริง', fmtDate(date) || date],
          ['หมวด', `${c} · ${CATEGORY_LABELS_SHORT[c] || '—'}`],
          ['ยอดจ่ายจริง', fmtNum(Math.abs(amt), 2) + ' '],
          ['สถานะ', isRecon ? `${status} · กระทบยอด` : status],
          ['บัญชี', fe.Bank_AC || '—'],
          ['หมายเหตุ', fe.NOTE || '—'],
        ],
      });
    });
    items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    advancePv.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    setDrillDown({ title: label, mode: 'actual', row: 'actual', weekIdx, cat, items, advancePv });
  };

  // ─── ยืนยัน/ยกเลิก "จ่ายจริงแล้ว" ของ PV ตัดล่วงหน้า (cf.pvPaid override) ───────
  //   ใช้กับเคสเงินออกแล้ววันนั้นพอดี ต้องรีบส่งรายงาน — กดยืนยัน → นับเข้ายอด actual ทันที
  //   (ใช้ได้ทั้ง drill โหมด actual [SEC02] และ out-cell [SEC01]; เฉพาะ actual ที่ย้ายใบเข้า items ที่นับ)
  const markPvPaid = (pvNo, paid) => {
    if (!pvNo) return;
    WTPOverride.set(cfPvPaidKey(pvNo), paid ? 1 : null);   // เปลี่ยน override → ovTick → recompute pvActual ทุกที่
    setDrillDown(prev => {
      if (!prev || !prev.advancePv) return prev;
      const advancePv = prev.advancePv.map(p => p.pvNo === pvNo ? { ...p, confirmed: paid } : p);
      let items = prev.items;
      if (prev.mode === 'actual') {
        const target = advancePv.find(p => p.pvNo === pvNo);
        items = prev.items.filter(x => !(x.source === 'PV' && x.pvNo === pvNo));   // กันซ้ำ
        if (paid && target && target.item) items.push(target.item);
        items = items.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      }
      return { ...prev, advancePv, items };
    });
    if (typeof toast === 'function') toast(paid ? 'ยืนยันจ่ายจริงแล้ว — นับเข้ายอด' : 'ยกเลิกการยืนยัน — กลับเป็นยังไม่จ่าย');
  };

  // ─── ยืนยัน "จ่ายจริงแล้ว" ทั้งหมดทีเดียว — PV ตัดล่วงหน้าที่ยังไม่ยืนยันใน drill นี้ ───────
  const markAllPvPaid = () => {
    const dd = drillDown;
    if (!dd || !dd.advancePv) return;
    const toConfirm = dd.advancePv.filter(p => !p.confirmed && p.pvNo);
    if (!toConfirm.length) return;
    WTPOverride.setMany(toConfirm.reduce((m, p) => { m[cfPvPaidKey(p.pvNo)] = 1; return m; }, {}));  // batch → 1 sync
    const ids = new Set(toConfirm.map(p => p.pvNo));
    setDrillDown(prev => {
      if (!prev || !prev.advancePv) return prev;
      const advancePv = prev.advancePv.map(p => ids.has(p.pvNo) ? { ...p, confirmed: true } : p);
      let items = prev.items;
      if (prev.mode === 'actual') {
        items = prev.items.filter(x => !(x.source === 'PV' && ids.has(x.pvNo)));
        toConfirm.forEach(p => { if (p.item) items.push(p.item); });
        items = items.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      }
      return { ...prev, advancePv, items };
    });
    if (typeof toast === 'function') toast(`ยืนยันจ่ายจริงแล้ว ${toConfirm.length} รายการ — นับเข้ายอด`);
  };

  // ─── พาเนล "PV ตัดล่วงหน้า · ยังไม่ถึงวันจ่าย" (ใช้ร่วมทั้ง SEC02 actual-drill + SEC01 out-cell) ──
  const renderAdvancePvPanel = (advancePv) => {
    if (!advancePv || !advancePv.length) return null;
    const nUnconfirmed = advancePv.filter(p => !p.confirmed && p.pvNo).length;
    const totPending = advancePv.reduce((s, p) => s + (p.confirmed ? 0 : (p.amount || 0)), 0);
    return (
      <div className="no-present no-print" style={{ marginTop: 14, border: '1px solid color-mix(in oklch, var(--warn) 35%, transparent)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '8px 12px', background: 'var(--warn-bg)' }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--ink-700)' }}>
            🕐 PV ตัดล่วงหน้า · ยังไม่ถึงวันจ่าย ({advancePv.length}) — เงินยังไม่ออกจากบัญชี จึง<strong>ไม่นับ</strong>เป็นจ่ายจริง
          </div>
          {!cfIsReadOnly() && nUnconfirmed > 0 && (
            <button type="button" className="btn btn-primary" style={{ fontSize: 11.5, padding: '4px 12px', whiteSpace: 'nowrap' }}
              onClick={markAllPvPaid} title={`ยืนยันจ่ายจริงทั้งหมด ${nUnconfirmed} รายการ · รวม ${fmtNum(totPending, 0)}`}>
              ✓ จ่ายจริงแล้วทั้งหมด ({nUnconfirmed})
            </button>
          )}
        </div>
        <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 96 }}>วันจ่าย</th>
              <th style={{ width: 130 }}>เลขที่ PV</th>
              <th style={{ textAlign: 'left' }}>ผู้รับเงิน/รายการ</th>
              <th style={{ width: 120, textAlign: 'right' }}>ยอด</th>
              <th style={{ width: 170, textAlign: 'center' }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {advancePv.map((p, i) => (
              <tr key={p.pvNo || (p.date + i)} style={{ background: p.confirmed ? 'var(--good-bg)' : 'transparent' }}>
                <td>{fmtDate(p.date) || p.date}</td>
                <td>{p.pvNo || '—'}</td>
                <td style={{ textAlign: 'left' }}>{p.name}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(p.amount, 0)}</td>
                <td style={{ textAlign: 'center' }}>
                  {cfIsReadOnly() || !p.pvNo
                    ? (p.confirmed ? '✓ จ่ายจริงแล้ว' : 'รอถึงวันจ่าย')
                    : p.confirmed
                      ? <span style={{ color: 'var(--good)', fontWeight: 700 }}>✓ จ่ายจริงแล้ว <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '1px 7px', marginLeft: 4 }} onClick={() => markPvPaid(p.pvNo, false)}>↩ ยกเลิก</button></span>
                      : <button type="button" className="btn btn-primary" style={{ fontSize: 11, padding: '3px 11px' }} onClick={() => markPvPaid(p.pvNo, true)}>✓ จ่ายจริงแล้ว</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '7px 12px', fontSize: 11, color: 'var(--ink-500)', lineHeight: 1.6, borderTop: '1px solid var(--ink-100)' }}>
          💡 PV ที่ตัดไว้แต่ยังไม่ถึงวันจ่าย — กด <strong>✓ จ่ายจริงแล้ว</strong> เฉพาะกรณีเงินออกจากบัญชีจริงแล้ว (เช่น จ่ายวันนี้พอดี ต้องรีบส่งรายงาน) · พอถึงวันจ่ายระบบจะนับให้อัตโนมัติ
        </div>
      </div>
    );
  };

  // ─── Drill-down ฝั่ง "ประมาณการ" (Forecast) ราย week×cat ──────────────────
  //   แสดง forecastEntries (ตั้งมือ) ที่ประกอบเป็นยอด Forecast ของช่องนั้น — mirror
  //   forecastByWeekCat เป๊ะ เพื่อให้ผลรวม = ตัวเลขในช่อง · cat=null → ทุกหมวดในสัปดาห์
  const openForecastDrill = (weekIdx, cat, label) => {
    const wantCat = (c) => cat == null || c === cat;
    const items = [];
    forecastEntries.forEach(fe => {
      const status = String(fe.STATUS || fe.status || '').toUpperCase();
      if (status === 'CANCELED') return;
      const isLoan = String(fe.EXPENSE_TYPE || fe.CATEGORY || '').toUpperCase() === 'LOAN';
      if (isLoan) return;
      // จ่ายจริงจากกระทบยอด (BANK_RECON) ไม่ใช่ประมาณการ → ตัดออก ให้ list ตรงกับยอดในช่อง (mirror forecastByWeekCat)
      if (String(fe.EXPENSE_TYPE || '').toUpperCase() === 'BANK_RECON') return;
      const amt = Number(fe.AMOUNT || fe.amount || 0);
      if (amt >= 0) return;   // outflow only
      const date = fe.PAYMENT_DATE || fe.DATE || fe.paymentDate;
      if (!inMonth(date, year, month)) return;
      if (findWeekIdx(date, weeks) !== weekIdx) return;
      const c = categorizeForecastEntry(fe);
      if (!wantCat(c)) return;
      const isRealized = status === 'ACTUAL' || status === 'BOOKED';
      items.push({
        source: 'Forecast', feId: fe.id, cat: c,
        editable: !isRealized,   // แก้ยอดได้เฉพาะ PLANNED
        date,
        name: fe.DESCRIPTION || '—',
        ref: fe.JOB_NO || '',
        amount: amt,   // negative = outflow
        note: `STATUS=${status || 'PLANNED'}${isRealized ? ' · จ่ายแล้ว' : ''} · ${CATEGORY_LABELS_SHORT[c]}`,
        detail: [
          ['รายการ', fe.DESCRIPTION || '—'],
          ['Job No.', fe.JOB_NO || '—'],
          ['โครงการ', fe.PROJECT_NAME || '—'],
          ['วันที่ตั้งจ่าย', fmtDate(date) || date],
          ['หมวด', `${c} · ${CATEGORY_LABELS_SHORT[c] || '—'}`],
          ['ยอดประมาณการ', fmtNum(Math.abs(amt), 2) + ' '],
          ['สถานะ', status || 'PLANNED'],
          ['บัญชี', fe.Bank_AC || '—'],
          ['หมายเหตุ', fe.NOTE || '—'],
        ],
      });
    });
    items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    setDrillDown({ title: label, mode: 'forecast', row: 'forecast', weekIdx, cat, items });
  };

  // ─── Inline-edit a FORECAST line from the drill-down ──────────────────────
  // เขียนกลับเข้า data.forecastEntries จริง (sync ขึ้น cloud) แล้วอัปเดต popup ทันที
  //   signedAmount = ยอดที่มีเครื่องหมายแล้ว (− = จ่ายออก, + = รับเข้า)
  //   แก้เฉพาะ AMOUNT (ยอดประมาณการ) — รายการที่เกิดจริงแล้ว (ACTUAL/BOOKED) ล็อกไว้
  const commitForecastEdit = (feId, signedAmount) => {
    if (!feId) return;
    setData(d => ({
      ...d,
      forecastEntries: (d.forecastEntries || []).map(fe =>
        fe.id === feId ? { ...fe, AMOUNT: signedAmount } : fe),
    }));
    setDrillDown(prev => prev && {
      ...prev,
      items: prev.items.map(x => x.feId === feId ? { ...x, amount: signedAmount } : x),
    });
    if (typeof toast === 'function') toast('แก้ไขประมาณการแล้ว — กำลังซิงค์');
  };

  // ─── แก้ "หมวด" ของรายการใน drill-down ─────────────────────────────────────
  //   PV → override ราย PV (cf.pvCat) · Forecast → fe.CATEGORY · AP → cf_category — แล้วย้ายออกจากหมวดเดิม
  const setItemCategory = (item, cat) => {
    cat = parseInt(cat, 10);
    if (!item || !(cat >= 1 && cat <= 4)) return;
    if ((item.source === 'Forecast' || item.source === 'STM') && item.feId) {
      setData(d => ({ ...d, forecastEntries: (d.forecastEntries || []).map(fe => fe.id === item.feId ? { ...fe, CATEGORY: cat } : fe) }));
    } else if (item.source === 'PV' && item.pvNo) {
      WTPOverride.set(cfPvCatKey(item.pvNo), cat);
    } else if (item.source === 'AP' && item.vchno) {
      setData(d => ({ ...d, payables: (d.payables || []).map(p => p.vchno === item.vchno ? { ...p, cf_category: String(cat) } : p) }));
    } else { return; }
    // ย้ายไปหมวดอื่นแล้ว → เอาออกจากรายการในป๊อปอัปปัจจุบัน + ปิด detail
    setDrillDown(prev => prev && { ...prev, items: prev.items.filter(x => x !== item) });
    setDetailItem(null);
    if (typeof toast === 'function') toast('ย้าย "' + (item.name || '') + '" → หมวด ' + cat + ' · ' + (CATEGORY_LABELS_SHORT[cat] || ''));
  };

  // เปลี่ยนหมวด "ทั้งกลุ่ม" (ทุกใบในกลุ่มชื่อ+วันเดียวกัน) ทีเดียว — batch เขียนกลับ
  const setGroupCategory = (items, cat) => {
    cat = parseInt(cat, 10);
    if (!Array.isArray(items) || !items.length || !(cat >= 1 && cat <= 4)) return;
    const feIds = new Set(), vchnos = new Set(), pvNos = [];
    items.forEach(it => {
      if ((it.source === 'Forecast' || it.source === 'STM') && it.feId) feIds.add(it.feId);
      else if (it.source === 'PV' && it.pvNo) pvNos.push(it.pvNo);
      else if (it.source === 'AP' && it.vchno) vchnos.add(it.vchno);
    });
    if (feIds.size || vchnos.size) {
      setData(d => ({
        ...d,
        forecastEntries: feIds.size ? (d.forecastEntries || []).map(fe => feIds.has(fe.id) ? { ...fe, CATEGORY: cat } : fe) : (d.forecastEntries || []),
        payables:        vchnos.size ? (d.payables || []).map(p => vchnos.has(p.vchno) ? { ...p, cf_category: String(cat) } : p) : (d.payables || []),
      }));
    }
    pvNos.forEach(pvNo => WTPOverride.set(cfPvCatKey(pvNo), cat));
    const itemSet = new Set(items);
    setDrillDown(prev => prev && { ...prev, items: prev.items.filter(x => !itemSet.has(x)) });
    if (typeof toast === 'function') toast('ย้าย ' + items.length + ' รายการ → หมวด ' + cat + ' · ' + (CATEGORY_LABELS_SHORT[cat] || ''));
  };

  const monthNames = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const goPrevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
    setCurrentWeekOverride(null);
  };
  const goNextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
    setCurrentWeekOverride(null);
  };

  return (
    <div className="page bg-pattern cf-page present-page">
      {/* ── Print-only gradient header — shown in cf-print-mode (like iv-print-header) ── */}
      <div className="cf-print-header" style={{ display: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 9, background: 'white', display: 'grid', placeItems: 'center', padding: 4, boxShadow: '0 2pt 8pt rgba(0,0,0,.18)', flexShrink: 0 }}>
            <img src="bioaxel_logo.png" style={{ width: '100%', height: 'auto', objectFit: 'contain' }} alt="BIOAXEL" />
          </div>
          <div>
            <div style={{ fontSize: '8pt', opacity: .88, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600 }}>BIOAXEL · Finance</div>
            <div style={{ fontSize: '15pt', fontWeight: 800, lineHeight: 1.1, marginTop: 3 }}>ประมาณการกระแสเงินสด</div>
            <div style={{ fontSize: '8.5pt', opacity: .78, marginTop: 2 }}>Weekly Cash Flow Forecast</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '20pt', fontWeight: 800, lineHeight: 1, letterSpacing: '-.02em' }}>{monthNames[month - 1]} {year}</div>
          <div style={{ fontSize: '8.5pt', opacity: .9, marginTop: 4, fontWeight: 500 }}>ข้อมูล ณ {fmtDate(today.toISOString().slice(0, 10))}</div>
        </div>
      </div>
      {/* Header */}
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">Weekly Forecast</h1>
          <div className="page-sub">
            {monthNames[month - 1]} {year} · ข้อมูล ณ {fmtDate(today.toISOString().slice(0, 10))}
          </div>
        </div>
        <div className="page-head-r">
          <button className="btn btn-ghost" onClick={goPrevMonth} title="เดือนก่อน">‹</button>
          <div style={{ padding: '6px 12px', background: 'var(--ink-50)', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            {monthNames[month - 1]} {year}
          </div>
          <button className="btn btn-ghost" onClick={goNextMonth} title="เดือนถัดไป">›</button>
          <span className="no-present" style={{ display: 'contents' }}><CloudSyncStatusButton /></span>
          <span className="no-present" style={{ display: 'contents' }}><EditModeToggle value={editMode} onChange={setEditMode} /></span>
          <button className="btn btn-ghost no-present" onClick={() => {
            // A4 landscape print — 5-week tracking fits beautifully across the wider page
            const styleId = 'cf-print-landscape-style';
            let style = document.getElementById(styleId);
            if (!style) {
              style = document.createElement('style');
              style.id = styleId;
              document.head.appendChild(style);
            }
            style.textContent = `
              @media print {
                @page { size: A4 portrait; margin: 8mm 10mm; }
                html, body { background: #f4f7fb !important; }
                /* บังคับพิมพ์สีพื้นหลัง/gradient ทุกองค์ประกอบ (เบราเซอร์ default ตัดทิ้ง = การ์ดสีหาย) */
                * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
              }
            `;
            // ชื่อไฟล์ PDF = "<BRAND>-FORECAST DD.MM.YYYY" (วันที่กดบันทึก, ค.ศ.) — เบราเซอร์ใช้ document.title เป็นชื่อไฟล์ตอน Save as PDF
            const _d = new Date();
            const _p2 = (n) => String(n).padStart(2, '0');
            const _brand = (window.WTP_CONFIG && window.WTP_CONFIG.BRAND_CODE) || 'BIO';
            const _pdfName = `${_brand}-FORECAST ${_p2(_d.getDate())}.${_p2(_d.getMonth() + 1)}.${_d.getFullYear()}`;
            const _prevTitle = document.title;
            document.title = _pdfName;
            document.body.classList.add('present-mode', 'cf-print-mode');
            const cleanup = () => {
              document.body.classList.remove('present-mode', 'cf-print-mode');
              document.title = _prevTitle;
              if (style.parentNode) style.parentNode.removeChild(style);
              window.removeEventListener('afterprint', cleanup);
            };
            window.addEventListener('afterprint', cleanup);
            setTimeout(cleanup, 60000);
            setTimeout(() => window.print(), 50);
          }} title="พิมพ์ A4 แนวนอน (เฉพาะส่วน Present)">
            <Icon name="print" size={14} /> พิมพ์ / PDF
          </button>
        </div>
      </div>

      {editMode && (
        <div className="no-print no-present" style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 10, background: 'color-mix(in oklch, var(--brand-500) 8%, transparent)', border: '1.5px solid color-mix(in oklch, var(--brand-500) 30%, transparent)', fontSize: 12, color: 'var(--brand-700)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700 }}>📝 โหมดแก้ไข — คลิกในช่องตัวเลขเพื่อกรอกค่า (Tab/Enter บันทึก · ✕ ล้าง)</span>
          <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>ค่าที่กรอกแยกตามเดือน — เปลี่ยนเดือนแล้วเริ่มใหม่</span>
          <button type="button" onClick={() => { if (confirm('ล้างค่าที่กรอกมือทั้งหมดใน app (ทุกหน้า)?')) WTPOverride.clearAll(); }}
            style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 11, borderRadius: 5, border: '1px solid var(--bad)', background: 'transparent', color: 'var(--bad)', cursor: 'pointer' }}>
            ล้างทั้งหมด
          </button>
        </div>
      )}

      {/* ═════ SECTION A — Hero balance cards + PlanVsActual KPIs ═════════ */}
      {/* ซ้าย: การ์ดเล็ก 5 อัน (2 แถว) · ขวา: คาดการณ์สิ้นเดือน (Strategic) อันใหญ่สูงเต็ม */}
      <div className="cf-heroA anim-in" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'stretch', marginBottom: 22 }}>
        {/* ── ซ้าย — การ์ดเล็ก 5 อัน เรียง 2 แถว ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* แถวบน — เงินสด: ยกมา + ใช้ได้วันนี้ */}
          <div className="grid grid-2">
            <BalanceCard
              tone="bf"
              label="เงินสดยกมาใช้ได้ (B/F)"
              value={monthBFAvailable}
              editMode={editMode}
              ovKey={`${ovPrefix}.bf`}
              hint={`ต้นเดือน · ${monthNames[month - 1]} ${year}`}
              icon="coin"
            />
            <BalanceCard
              tone="now"
              label="เงินสดใช้ได้ปัจจุบัน"
              value={liveAvailable}
              hint={`ยอดพร้อมใช้จริง ณ วันนี้`}
              icon="bank"
            />
          </div>
          {/* แถวล่าง — Plan vs Actual: รับเงิน / เงินกู้ / คชจ */}
          <div className="grid grid-3">
            <PlanVsActualCard
              tone="good"
              icon="bank"
              label="รับเงินโครงการ (IV)"
              plan={ivForecast}
              actual={ivActual}
              editMode={editMode}
              ovKey={`${ovPrefix}.iv`}
              hint={ivPlanLock.locked
                ? `แผนล็อก ${fmtNum(ivForecast, 0)} · รับจริง ${fmtNum(ivActual, 0)}`
                : `คาดรับ ${fmtNum(ivForecast, 0)} · รับจริง ${fmtNum(ivActual, 0)}`}
              lockedAt={ivPlanLock.lockedAt}
              lockEditable={editMode && !cfIsReadOnly()}
              onLock={handleLockClick}
              onClick={() => setIvDrill(true)}
            />
            <PlanVsActualCard
              tone="info"
              icon="money"
              label="เงินกู้/สินเชื่อหมุนเวียน"
              plan={loanForecast}
              actual={loanActual}
              editMode={editMode}
              ovKey={`${ovPrefix}.loan`}
              hint={loanForecast === 0 ? 'ยังไม่มีประมาณการเงินกู้เดือนนี้' : `เบิกแล้ว ${loanForecast > 0 ? ((loanActual / loanForecast) * 100).toFixed(1) : 0}%`}
            />
            <PlanVsActualCard
              tone="bad"
              icon="arrow_up"
              label="ค่าใช้จ่ายรวม (4 หมวด)"
              plan={outflowForecast}
              actual={outflowActual}
              editMode={editMode}
              ovKey={`${ovPrefix}.outflow`}
              hint="รวม ดำเนินงาน / โครงการ / การเงิน / เบ็ดเตล็ด+เงินเดือน"
            />
          </div>
        </div>

        {/* ── ขวา — คาดการณ์คงเหลือ ณ ปัจจุบัน (= สุทธิ TOTAL ของ SEC1) ── */}
        {(() => {
          const _netMon = WTPOverride.resolve(`${ovPrefix}.s01.netMonth`, netEndOfMonth);
          return (
            <BalanceCard
              big
              tone={_netMon < 0 ? 'bad' : 'good'}
              label="คาดการณ์คงเหลือ ณ ปัจจุบัน"
              value={_netMon}
              editMode={editMode}
              ovKey={`${ovPrefix}.s01.netMonth`}
              hint={
                (_netMon < 0 ? '⚠️ ติดลบ · ' : '') +
                `B/F ${fmtNum(weekBF, 0)} + รับ ${fmtNum(inflowCurrent + inflowRest, 0)} − จ่าย ${fmtNum(totalOutCurrent + totalOutRest, 0)}`
              }
              icon={_netMon < 0 ? 'arrow_down' : 'arrow_up'}
            />
          );
        })()}
      </div>

      {/* ═════ SECTION B — Plan: current week vs rest of month ═════════ */}
      <div className="cf-section-01">
      <SectionTitle num="01"
        title="ประมาณการรายสัปดาห์"
        subtitle={`สัปดาห์นี้ ${weeks[nowWeek]?.label || 'W?'} (${weeks[nowWeek]?.from || '-'}–${weeks[nowWeek]?.to || '-'} ${monthNames[month - 1]}) และยอดรวมช่วงที่เหลือของเดือน`}
      />

      <div className="card anim-in" style={{ padding: 0, overflow: 'hidden', marginBottom: 22 }}>
        <table className="tbl cf-plan-tbl" style={{ width: '100%', fontSize: cfScale(17) }}>
          <thead>
            <tr>
              <th style={{ width: 280 }}>รายการ</th>
              <th style={{ width: 180, textAlign: 'right', background: 'var(--brand-50)' }}>
                {weeks[nowWeek]?.label || 'W?'} (ปัจจุบัน)
                <div style={{ fontSize: cfScale(10), color: 'var(--ink-500)', fontWeight: 400 }}>
                  {weeks[nowWeek]?.from}-{weeks[nowWeek]?.to} {monthNames[month - 1]}
                </div>
              </th>
              <th style={{ width: 180, textAlign: 'right' }}>
                {isLastWeekOfMonth ? 'เดือนถัดไป' : 'สัปดาห์ที่เหลือ'}
                <div style={{ fontSize: cfScale(10), color: 'var(--ink-500)', fontWeight: 400 }}>
                  {isLastWeekOfMonth
                    ? monthNames[(month === 12 ? 1 : month + 1) - 1] + ' ' + (month === 12 ? year + 1 : year)
                    : `รวม ${weeks.length - nowWeek - 1} สัปดาห์`}
                </div>
              </th>
              <th style={{ width: 180, textAlign: 'right', background: 'var(--ink-50)' }}>
                TOTAL ที่เหลือของเดือน
              </th>
            </tr>
          </thead>
          <tbody>
            {/* ── INFLOW section ───────────────────────────────────────── */}
            <tr style={{ background: 'color-mix(in oklch, var(--good) 8%, transparent)' }}>
              <td colSpan={4} style={{ fontWeight: 700, color: 'var(--good)', fontSize: cfScale(16), padding: `${cfScale(8)} ${cfScale(14)}` }}>
                1: กระแสเงินสดเข้า (Inflow Details)
              </td>
            </tr>
            {/* ยอดยกมา: rest = closing of current week (signed carry-forward, matches M_Forecast) */}
            <PlanRow
              label="เงินสดคงเหลือยกมา"
              current={weekBF}
              rest={netEndOfCurrentWeek}
              total={weekBF}
              subtle
              carrySigned
              editMode={editMode}
              ovKey={`${ovPrefix}.s01.bf`}
            />
            <PlanRow label="รับเงินโครงการ"            current={planIv.current}   rest={planIv.rest}   total={planIv.current + planIv.rest}
              editMode={editMode} ovKey={`${ovPrefix}.s01.iv`}
              onCellClick={(p) => openDrillDown('iv', p, `รับเงินโครงการ · ${p === 'current' ? weeks[nowWeek]?.label : p === 'rest' ? 'สัปดาห์ที่เหลือ' : 'TOTAL'}`)} />
            <PlanRow label="เงินกู้/สินเชื่อหมุนเวียน"  current={planLoan.current} rest={planLoan.rest} total={planLoan.current + planLoan.rest}
              editMode={editMode} ovKey={`${ovPrefix}.s01.loan`}
              onCellClick={(p) => openDrillDown('loan', p, `เงินกู้/สินเชื่อ · ${p === 'current' ? weeks[nowWeek]?.label : p === 'rest' ? 'สัปดาห์ที่เหลือ' : 'TOTAL'}`)} />
            {/* รวมรับ — ยอด 3 รายการรวมกัน (ยกมา + รับเงินโครงการ + เงินกู้) = เงินคาดว่าใช้ได้ทั้งหมดในงวด */}
            {/*   เป็นจริงเสมอว่า รวมรับ − รวมรายจ่าย = คงเหลือ (ต่อคอลัมน์) */}
            <tr style={{ background: 'var(--good-bg)', fontWeight: 700 }}>
              <td style={{ textAlign: 'right', paddingRight: 14, fontSize: cfScale(16) }}>รวมรับ</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{fmtNum(weekBF + inflowCurrent, 0)}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{fmtNum(netEndOfCurrentWeek + inflowRest, 0)}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{fmtNum(weekBF + inflowCurrent + inflowRest, 0)}</td>
            </tr>

            {/* ── OUTFLOW section ─────────────────────────────────────── */}
            <tr style={{ background: 'color-mix(in oklch, var(--bad) 8%, transparent)' }}>
              <td colSpan={4} style={{ padding: `${cfScale(8)} ${cfScale(14)}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: cfScale(8), flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, color: 'var(--bad)', fontSize: cfScale(16) }}>
                    2: กระแสเงินสดออก (Outflow Details) · 4 หมวด
                    <span className="no-present" style={{ fontWeight: 500, fontSize: cfScale(11.5), color: 'var(--ink-500)', marginLeft: cfScale(8) }}>
                      {s01OutMode === 'apPlan'
                        ? <span>· <strong>แผนจ่ายจริง</strong> = รายการ AP ที่เลือกจ่าย (CARD BANK) + ตั้งมือที่ติ๊กรวม{s01ApScope === 'week' ? <span> · <strong>เฉพาะสัปดาห์นี้</strong></span> : ''}</span>
                        : s01OutMode === 'pv'
                        ? <span>· <strong>ยอด PV ที่ตัด</strong> = ใบจ่าย (PV) ที่ตัดล่วงหน้า ยังไม่ถึงวันจ่าย · พอกดจ่ายจริงแล้วจะหักออก · <strong>หมวดที่ไม่มี PV (เช่น เงินเดือน) ใช้ประมาณการแทน</strong>{s01ApScope === 'week' ? <span> · <strong>เฉพาะสัปดาห์นี้</strong></span> : ''}</span>
                        : <span>· ยอด<strong>คงเหลือต้องจ่าย</strong> (หักที่จ่ายจริงแล้ว)</span>}
                    </span>
                  </div>
                  {/* ปุ่มสลับโหมด/ขอบเขต — ซ่อนในโหมดนำเสนอ (no-present) + ไม่ติดใน PNG capture (data-no-capture) */}
                  <div data-no-capture="1" className="no-present" style={{ display: 'inline-flex', alignItems: 'center', gap: cfScale(8), flexShrink: 0, flexWrap: 'wrap' }}>
                    {(s01OutMode === 'apPlan' || s01OutMode === 'pv') && (
                      <div style={{ display: 'inline-flex', borderRadius: cfScale(8), overflow: 'hidden', border: '1px solid var(--ink-400)', fontSize: cfScale(11), fontWeight: 700 }}>
                        {[['month', 'ทั้งเดือน'], ['week', 'เฉพาะสัปดาห์นี้']].map(opt => (
                          <button key={opt[0]} type="button" onClick={() => setS01ApScopePersist(opt[0])}
                            title={opt[0] === 'week' ? 'แสดงแผนจ่ายเฉพาะสัปดาห์ปัจจุบัน' : 'แสดงตั้งแต่สัปดาห์ปัจจุบันถึงสิ้นเดือน'}
                            style={{ padding: `${cfScale(4)} ${cfScale(9)}`, border: 'none', cursor: 'pointer',
                              background: s01ApScope === opt[0] ? 'var(--ink-600)' : 'transparent',
                              color: s01ApScope === opt[0] ? '#fff' : 'var(--ink-600)' }}>{opt[1]}</button>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'inline-flex', borderRadius: cfScale(8), overflow: 'hidden', border: '1px solid var(--bad)', fontSize: cfScale(11.5), fontWeight: 700 }}>
                      {[['remaining', 'ประมาณการคงเหลือ'], ['pv', 'ยอด PV ที่ตัด'], ['apPlan', 'แผนจ่ายจริง (AP)']].map(opt => (
                        <button key={opt[0]} type="button" onClick={() => setS01OutModePersist(opt[0])}
                          title={opt[0] === 'apPlan' ? 'รายการ AP ที่เลือกจ่ายไว้แล้ว (ขึ้น CARD BANK หน้า Bank Diary) + รายการตั้งมือที่ติ๊กรวมเอง'
                                 : opt[0] === 'pv' ? 'ใช้ยอดใบจ่าย (PV) ที่ตัดล่วงหน้า ยังไม่ถึงวันจ่าย — เป็นยอดเต็มของ PV จริง · พอกดจ่ายจริงแล้วจะหักออก'
                                 : 'ประมาณการตั้งมือ − จ่ายจริงแล้ว = ยอดคงเหลือต้องจ่าย'}
                          style={{ padding: `${cfScale(4)} ${cfScale(10)}`, border: 'none', cursor: 'pointer',
                            background: s01OutMode === opt[0] ? 'var(--bad)' : 'transparent',
                            color: s01OutMode === opt[0] ? '#fff' : 'var(--bad)' }}>{opt[1]}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </td>
            </tr>
            {[1, 2, 3, 4].map(cat => {
              const drill = (p) => openDrillDown(`out${cat}`, p, `${CATEGORY_LABELS[cat]} · ${p === 'current' ? weeks[nowWeek]?.label : p === 'rest' ? 'สัปดาห์ที่เหลือ' : 'TOTAL'}`);
              return (
                <PlanRow key={cat}
                  label={`${cat}. ${CATEGORY_LABELS[cat]}`}
                  current={planOut[cat].current}
                  rest={planOut[cat].rest}
                  total={planOut[cat].total}
                  negative
                  editMode={editMode}
                  ovKey={`${ovPrefix}.s01.out${cat}`}
                  onCellClick={drill}
                />
              );
            })}
            <tr style={{ background: 'var(--bad-bg)', fontWeight: 700 }}>
              <td style={{ textAlign: 'right', paddingRight: 14, fontSize: cfScale(16) }}>รวมรายจ่าย</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--bad)' }}>({fmtNum(totalOutCurrent, 0)})</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--bad)' }}>({fmtNum(totalOutRest, 0)})</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--bad)' }}>({fmtNum(totalOutAll, 0)})</td>
            </tr>

            {/* ── คงเหลือรายสัปดาห์ — closing per period (matches M_Forecast R30) */}
            {/*  เปิด edit mode = override ได้ตรงๆ (ไม่ผ่านสูตร) */}
            {(() => {
              const netCurDisp = WTPOverride.resolve(`${ovPrefix}.s01.netCur`,   netEndOfCurrentWeek);
              const netMonDisp = WTPOverride.resolve(`${ovPrefix}.s01.netMonth`, netEndOfMonth);
              return (
                <tr style={{ background: 'var(--warn-bg)', fontWeight: 700 }}>
                  <td style={{ padding: `${cfScale(10)} ${cfScale(14)}`, color: 'var(--warn)' }}>
                    💰 คงเหลือรายสัปดาห์
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: netCurDisp < 0 ? 'var(--bad)' : 'var(--good)' }}>
                    {editMode
                      ? <EditableNumber ovKey={`${ovPrefix}.s01.netCur`}   computed={netEndOfCurrentWeek} editMode={true} digits={0} />
                      : <>{fmtNum(netCurDisp, 0)}{WTPOverride.has(`${ovPrefix}.s01.netCur`) && <span title="แก้มือ" style={{ fontSize: 9, marginLeft: 3 }}>✏️</span>}</>}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: netMonDisp < 0 ? 'var(--bad)' : 'var(--good)' }}>
                    {editMode
                      ? <EditableNumber ovKey={`${ovPrefix}.s01.netMonth`} computed={netEndOfMonth} editMode={true} digits={0} />
                      : <>{fmtNum(netMonDisp, 0)}{WTPOverride.has(`${ovPrefix}.s01.netMonth`) && <span title="แก้มือ" style={{ fontSize: 9, marginLeft: 3 }}>✏️</span>}</>}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-500)', fontSize: cfScale(11) }}>
                    {isLastWeekOfMonth ? '(rest = เดือนถัดไป)' : ''}
                  </td>
                </tr>
              );
            })()}

            {/* ── Final Net Position — same as right column above */}
            {(() => {
              const netMonDisp = WTPOverride.resolve(`${ovPrefix}.s01.netMonth`, netEndOfMonth);
              return (
                <tr style={{ background: 'var(--brand-50)', fontWeight: 800 }}>
                  <td style={{ padding: `${cfScale(12)} ${cfScale(14)}`, color: 'var(--brand-700)' }}>
                    💼 ยอดคงเหลือสุทธิปลายงวด
                  </td>
                  <td colSpan={2}></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: netMonDisp < 0 ? 'var(--bad)' : 'var(--good)', fontSize: cfScale(22) }}>
                    {fmtNum(netMonDisp, 0)}
                  </td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>

      </div>{/* end .cf-section-01 wrapper */}

      {/* ═════ SECTION C — Weekly Actual Tracking (5 weeks side-by-side) */}
      <div data-print-page>
      <SectionTitle num="02"
        title="ติดตามจ่ายจริงรายสัปดาห์"
        subtitle="Weekly Actual Tracking · เปรียบเทียบ Plan vs Actual"
      />

      <div className="grid anim-in cf-week-grid" style={{
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 14, marginBottom: 18,
      }}>
        {weeks.map((w, i) => {
          // ดึงค่าหลัง override สำหรับ Plan/Actual ของแต่ละหมวดในสัปดาห์นี้
          // เพื่อให้ทั้ง cell, total row, และ % bar reflect ค่าที่ user กรอกมือ
          const cellOvWeek = `${ovPrefix}.s02.w${i + 1}`;
          const planByCat   = [1, 2, 3, 4].map(c => WTPOverride.resolve(`${cellOvWeek}.cat${c}.plan`,   forecastByWeekCat[i][c] || 0));
          const actualByCat = [1, 2, 3, 4].map(c => WTPOverride.resolve(`${cellOvWeek}.cat${c}.actual`, pvActualByWeekCat[i][c]   || 0));
          // รวม row — รองรับ override level "total" (ถ้า user override จะใช้ค่านี้แทนการรวม cell)
          const planTotalRaw   = planByCat.reduce((s, v) => s + v, 0);
          const actualTotalRaw = actualByCat.reduce((s, v) => s + v, 0);
          const planTotal      = WTPOverride.resolve(`${cellOvWeek}.total.plan`,   planTotalRaw);
          const actualTotal    = WTPOverride.resolve(`${cellOvWeek}.total.actual`, actualTotalRaw);
          const planTotalOver  = WTPOverride.has(`${cellOvWeek}.total.plan`);
          const actualTotalOver= WTPOverride.has(`${cellOvWeek}.total.actual`);
          const pct = planTotal > 0 ? (actualTotal / planTotal) * 100 : 0;
          const status = i < nowWeek ? 'past' : i === nowWeek ? 'now' : 'future';
          // ป้ายสถานะหัวการ์ด — ผ่านแล้ว / ปัจจุบัน / รอ
          const chip = status === 'past'
            ? { icon: 'check', color: 'var(--good)',     bg: 'var(--good-bg)',  label: 'จ่ายแล้ว' }
            : status === 'now'
            ? { dot: true,     color: 'var(--brand-600)', bg: 'var(--brand-50)', label: 'ปัจจุบัน' }
            : { icon: 'daily', color: 'var(--ink-400)',   bg: 'var(--ink-50)',   label: 'รอ' };
          return (
            <div key={i} className="card cf-week-card" style={{
              padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
              borderColor: status === 'now' ? 'var(--brand-400)' : 'var(--line)',
              borderWidth: status === 'now' ? 2 : 1,
              boxShadow: status === 'now' ? '0 10px 30px -8px color-mix(in oklch, var(--brand-500) 45%, transparent)' : 'var(--shadow-sm)',
            }}>
              {/* แถบ accent สีบนหัว — บ่งบอกสถานะสัปดาห์ */}
              <div style={{ height: cfScale(4), flex: 'none',
                background: status === 'now' ? 'linear-gradient(90deg, var(--brand-500), var(--brand-700))'
                          : status === 'past' ? 'var(--good)' : 'var(--ink-200)' }} />
              {/* หัวการ์ด — WEEK n + ช่วงวันที่ + ป้ายสถานะ */}
              <div style={{
                padding: `${cfScale(11)} ${cfScale(15)}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: '1px solid var(--line)',
                background: status === 'now' ? 'linear-gradient(180deg, var(--brand-50), #fff)' : '#fff',
              }}>
                <div>
                  <div style={{ fontSize: cfScale(15), fontWeight: 800, letterSpacing: '.03em', lineHeight: 1.05,
                    color: status === 'now' ? 'var(--brand-700)' : 'var(--ink-900)' }}>
                    WEEK {i + 1}
                  </div>
                  <div style={{ fontSize: cfScale(11), color: 'var(--ink-400)', marginTop: cfScale(2), fontWeight: 500 }}>
                    {w.from}–{w.to} {monthNames[month - 1]}
                  </div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: cfScale(4), fontSize: cfScale(10.5), fontWeight: 700,
                  color: chip.color, background: chip.bg, padding: `${cfScale(4)} ${cfScale(10)}`, borderRadius: 999, whiteSpace: 'nowrap' }}>
                  {chip.dot
                    ? <span style={{ width: cfScale(7), height: cfScale(7), borderRadius: '50%', background: 'var(--brand-500)' }} />
                    : <Icon name={chip.icon} size={12} />}
                  {chip.label}
                </span>
              </div>
              {/* ตาราง List / Forecast / Actual / % */}
              <table className="tbl cf-week-tbl" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ padding: `${cfScale(6)} ${cfScale(10)}`, textAlign: 'left',  textTransform: 'none', fontSize: cfScale(11) }}>List</th>
                    <th style={{ padding: `${cfScale(6)} ${cfScale(8)}`,  textAlign: 'right', textTransform: 'none', fontSize: cfScale(11) }}>Forecast</th>
                    <th style={{ padding: `${cfScale(6)} ${cfScale(8)}`,  textAlign: 'right', textTransform: 'none', fontSize: cfScale(11) }}>Actual</th>
                    <th style={{ padding: `${cfScale(6)} ${cfScale(8)}`,  textAlign: 'right', textTransform: 'none', fontSize: cfScale(11) }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {[1,2,3,4].map((cat, idx) => {
                    // ใช้ค่าหลัง resolve (override > computed) ทั้งใน edit + view mode
                    const pRaw  = forecastByWeekCat[i][cat] || 0;
                    const aRaw  = pvActualByWeekCat[i][cat]   || 0;
                    const p     = planByCat[idx];
                    const a     = actualByCat[idx];
                    const cellOv = `${cellOvWeek}.cat${cat}`;
                    const pOver = WTPOverride.has(`${cellOv}.plan`);
                    const aOver = WTPOverride.has(`${cellOv}.actual`);
                    // % เบี่ยงเบน Actual เทียบ Forecast — เกินงบ = แดง▲ / ต่ำกว่า = เขียว▼
                    let vpct = null;
                    if (p > 0)      vpct = Math.round((a - p) / p * 100);
                    else if (a > 0) vpct = 100;
                    const vdir = vpct == null ? 'na' : a > p ? 'up' : a < p ? 'down' : 'flat';
                    const vCol = vdir === 'up' ? 'var(--bad)' : vdir === 'down' ? 'var(--good)' : 'var(--ink-500)';
                    const vBg  = vdir === 'up' ? 'var(--bad-bg)' : vdir === 'down' ? 'var(--good-bg)' : 'var(--ink-100)';
                    return (
                      <tr key={cat} title={CATEGORY_LABELS[cat]}>
                        <td style={{ padding: `${cfScale(6)} ${cfScale(10)}`, fontSize: cfScale(12.5), fontWeight: 600, color: 'var(--ink-700)', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--ink-400)' }}>{cat}.</span> {CATEGORY_LABELS_SHORT[cat]}
                        </td>
                        <td style={{ padding: `${cfScale(6)} ${cfScale(8)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: cfScale(13.5), color: 'var(--ink-700)' }}>
                          {editMode
                            ? <EditableNumber ovKey={`${cellOv}.plan`} computed={pRaw} editMode={true} digits={0} />
                            : (p > 0
                                ? (<span
                                     onClick={() => openForecastDrill(i, cat, `ประมาณการ · WEEK ${i + 1} · ${CATEGORY_LABELS_SHORT[cat]}`)}
                                     title="คลิกดูรายการประมาณการของหมวดนี้"
                                     style={{ cursor: 'pointer', borderBottom: '1.5px dashed var(--brand-300)' }}>
                                    {fmtNum(p, 0)}
                                    {pOver && <span title="แก้มือ" style={{ fontSize: cfScale(8), marginLeft: 2, color: 'var(--brand-500)' }}>✏️</span>}
                                  </span>)
                                : <span style={{ color: 'var(--ink-300)' }}>-</span>)}
                        </td>
                        <td style={{ padding: `${cfScale(6)} ${cfScale(8)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: cfScale(13.5), fontWeight: 700,
                          color: a > 0 ? 'var(--ink-900)' : 'var(--ink-300)' }}>
                          {(() => {
                            const pend = pendingPvByWeekCat[i] ? (pendingPvByWeekCat[i][cat] || 0) : 0;
                            if (editMode) return <EditableNumber ovKey={`${cellOv}.actual`} computed={aRaw} editMode={true} digits={0} />;
                            if (a <= 0 && pend <= 0) return <span style={{ color: 'var(--ink-300)' }}>-</span>;
                            // คลิกได้เมื่อมียอดจ่ายจริง หรือมี PV ตัดล่วงหน้ารอยืนยัน (เปิด drill ไปกดยืนยันได้)
                            return (
                              <span
                                onClick={() => openActualDrill(i, cat, `จ่ายจริง · WEEK ${i + 1} · ${CATEGORY_LABELS_SHORT[cat]}`)}
                                title={pend > 0 ? `มี PV ตัดล่วงหน้า รอยืนยันจ่ายจริง ${fmtNum(pend, 0)}` : 'คลิกดูรายการจ่ายจริงของหมวดนี้'}
                                style={{ cursor: 'pointer', borderBottom: '1.5px dashed var(--brand-300)' }}>
                                {a > 0 ? fmtNum(a, 0) : <span style={{ color: 'var(--ink-300)' }}>–</span>}
                                {aOver && <span title="แก้มือ" style={{ fontSize: cfScale(8), marginLeft: 2, color: 'var(--brand-500)' }}>✏️</span>}
                                {pend > 0 && <span className="no-present no-print" title={`PV ตัดล่วงหน้า รอยืนยันจ่ายจริง ${fmtNum(pend, 0)}`} style={{ fontSize: cfScale(9), marginLeft: cfScale(3) }}>🕐</span>}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: `${cfScale(6)} ${cfScale(8)}`, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {vdir === 'na'
                            ? <span style={{ color: 'var(--ink-300)', fontSize: cfScale(10.5) }}>—</span>
                            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: cfScale(1), fontSize: cfScale(10.5), fontWeight: 800,
                                color: vCol, background: vBg, padding: `${cfScale(2)} ${cfScale(7)}`, borderRadius: 999, fontVariantNumeric: 'tabular-nums' }}>
                                {vdir === 'up' ? '▲' : vdir === 'down' ? '▼' : ''}{Math.abs(vpct)}%
                              </span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ padding: `${cfScale(7)} ${cfScale(10)}`, fontSize: cfScale(10.5), color: 'var(--ink-500)', fontWeight: 700, background: 'var(--ink-50)' }}>รวมแผน</td>
                    <td style={{ padding: `${cfScale(7)} ${cfScale(8)}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: cfScale(13.5), color: 'var(--ink-900)', background: 'var(--ink-50)' }}>
                      {editMode
                        ? <EditableNumber ovKey={`${cellOvWeek}.total.plan`}   computed={planTotalRaw}   editMode={true} digits={0} />
                        : (planTotal > 0
                            ? (<span onClick={() => openForecastDrill(i, null, `ประมาณการ · WEEK ${i + 1} · ทุกหมวด`)}
                                 title="คลิกดูรายการประมาณการทั้งสัปดาห์"
                                 style={{ cursor: 'pointer', borderBottom: '1.5px dashed var(--brand-300)' }}>
                                {fmtNum(planTotal, 0)}{planTotalOver && <span title="แก้มือ" style={{ fontSize: cfScale(8), marginLeft: 2, color: 'var(--brand-500)' }}>✏️</span>}
                              </span>)
                            : <>{fmtNum(planTotal, 0)}{planTotalOver && <span title="แก้มือ" style={{ fontSize: cfScale(8), marginLeft: 2, color: 'var(--brand-500)' }}>✏️</span>}</>)}
                    </td>
                    <td colSpan={2} style={{ background: 'var(--ink-50)' }} />
                  </tr>
                </tfoot>
              </table>
              {/* แถบความคืบหน้า (Actual/Plan) + Total Paid */}
              <div style={{ padding: `${cfScale(12)} ${cfScale(15)} ${cfScale(14)}`, marginTop: 'auto' }}>
                <div style={{ position: 'relative', height: cfScale(22), background: 'var(--ink-100)', borderRadius: cfScale(7), overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', inset: 0, width: `${Math.min(100, pct)}%`,
                    background: pct >= 100 ? 'linear-gradient(90deg, var(--brand-700), var(--brand-500))' : 'linear-gradient(90deg, var(--brand-500), var(--brand-400))',
                    transition: 'width 600ms',
                  }} />
                  {/* % วิ่งตามหัวแถบที่เพิ่มขึ้น — เกิน 100% ก็ค้างชิดขวาสุด */}
                  {(() => {
                    const fillPct = Math.min(100, pct);
                    const inside = fillPct >= 40;   // แถบสีกว้างพอ → วาง % ในแถบชิดขวา (ขาว) · แคบไป → วางนอกแถบขวามือ (เข้ม)
                    return (
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${fillPct}%`,
                        transform: inside ? 'translateX(-100%)' : 'none',
                        display: 'flex', alignItems: 'center',
                        padding: inside ? `0 ${cfScale(9)} 0 0` : `0 0 0 ${cfScale(6)}`,
                        fontSize: cfScale(11), fontWeight: 800, letterSpacing: '.02em',
                        color: inside ? '#fff' : 'var(--ink-600)',
                        whiteSpace: 'nowrap', pointerEvents: 'none', transition: 'left 600ms' }}>
                        {pct.toFixed(2)}%
                      </div>
                    );
                  })()}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: cfScale(11), gap: cfScale(6) }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: cfScale(4) }}>
                    <span style={{ fontSize: cfScale(11.5), color: 'var(--ink-500)', fontWeight: 600, whiteSpace: 'nowrap' }}>Total Paid :</span>
                    {/* เกิน/เหลืองบของสัปดาห์ (เทียบแผน) — pill เล็กใต้ label สไตล์เดียวกับชิป ▲/▼ ในตาราง */}
                    {(planTotal > 0 || actualTotal > 0) && (() => {
                      const diff = planTotal - actualTotal;   // + = ใช้น้อยกว่าแผน (เหลือ) · − = เกินแผน
                      const over = diff < 0;
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: cfScale(2), fontSize: cfScale(10),
                          fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: over ? 'var(--bad)' : 'var(--good)',
                          background: over ? 'var(--bad-bg)' : 'var(--good-bg)', padding: `${cfScale(2)} ${cfScale(8)}`,
                          borderRadius: 999, whiteSpace: 'nowrap' }}>
                          {over ? '▲ เกินแผน' : '▼ เหลือ'} {fmtNum(Math.abs(diff), 0)}
                        </span>
                      );
                    })()}
                  </div>
                  <span style={{ fontSize: cfScale(17), fontWeight: 800, color: 'var(--brand-600)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>
                    {(() => {
                      const pendWeek = [1, 2, 3, 4].reduce((s, c) => s + (pendingPvByWeekCat[i] ? (pendingPvByWeekCat[i][c] || 0) : 0), 0);
                      if (editMode) return <EditableNumber ovKey={`${cellOvWeek}.total.actual`} computed={actualTotalRaw} editMode={true} digits={0} />;
                      if (actualTotal <= 0 && pendWeek <= 0) return <span style={{ color: 'var(--ink-300)', fontWeight: 700 }}>–</span>;
                      return (
                        <span
                          onClick={() => openActualDrill(i, null, `จ่ายจริง · WEEK ${i + 1} · ทุกหมวด`)}
                          title={pendWeek > 0 ? `มี PV ตัดล่วงหน้า รอยืนยันจ่ายจริง ${fmtNum(pendWeek, 0)}` : 'คลิกดูรายการจ่ายจริงทั้งสัปดาห์'}
                          style={{ cursor: 'pointer', borderBottom: '2px dashed var(--brand-300)' }}>
                          {actualTotal > 0 ? fmtNum(actualTotal, 0) : <span style={{ color: 'var(--ink-300)' }}>–</span>}
                          {actualTotalOver && <span title="แก้มือ" style={{ fontSize: cfScale(9), marginLeft: 3, color: 'var(--brand-500)' }}>✏️</span>}
                          {pendWeek > 0 && <span className="no-present no-print" title={`PV ตัดล่วงหน้า รอยืนยันจ่ายจริง ${fmtNum(pendWeek, 0)}`} style={{ fontSize: cfScale(11), marginLeft: cfScale(4) }}>🕐</span>}
                        </span>
                      );
                    })()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Grand Total — การ์ดสรุปสีกรมท่า (เซลล์สุดท้ายของกริด) */}
        {(() => {
        // คำนวณ Grand Total โดยรวมยอด "รวม" ของแต่ละ week (เคารพ override total ของ week ด้วย)
        let grandPlanRaw = 0, grandActualRaw = 0;
        weeks.forEach((_, i) => {
          const weekKey = `${ovPrefix}.s02.w${i + 1}`;
          // sum cells in this week (ใช้ override level cell ก่อน)
          let pSum = 0, aSum = 0;
          [1, 2, 3, 4].forEach(cat => {
            pSum += WTPOverride.resolve(`${weekKey}.cat${cat}.plan`,   forecastByWeekCat[i][cat] || 0);
            aSum += WTPOverride.resolve(`${weekKey}.cat${cat}.actual`, pvActualByWeekCat[i][cat]   || 0);
          });
          // แล้วใช้ override level week-total ทับอีกที (ถ้ามี)
          grandPlanRaw   += WTPOverride.resolve(`${weekKey}.total.plan`,   pSum);
          grandActualRaw += WTPOverride.resolve(`${weekKey}.total.actual`, aSum);
        });
        // override level Grand Total — top of stack (final override)
        const gpKey = `${ovPrefix}.s02.grand.plan`;
        const gaKey = `${ovPrefix}.s02.grand.actual`;
        const grandPlan   = WTPOverride.resolve(gpKey, grandPlanRaw);
        const grandActual = WTPOverride.resolve(gaKey, grandActualRaw);
        const grandPlanOver   = WTPOverride.has(gpKey);
        const grandActualOver = WTPOverride.has(gaKey);
        const grandPct = grandPlan > 0 ? (grandActual / grandPlan) * 100 : 0;
        const remaining = Math.max(0, grandPlan - grandActual);
        return (
        <div className="card cf-grand-card" style={{
          padding: 0, overflow: 'hidden', border: 'none', color: '#fff', position: 'relative',
          background: 'linear-gradient(150deg, #23aa5b 0%, #007b2f 100%)',
          WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* แสงเรืองมุมบนขวา — เพิ่มมิติ ไม่ให้ดูแบนจืด */}
          <div style={{ position: 'absolute', right: cfScale(-40), top: cfScale(-50), width: cfScale(190), height: cfScale(190), borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,226,154,.28), transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', padding: `${cfScale(22)} ${cfScale(20)}`, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', gap: cfScale(15) }}>
            {/* โซนบน — หัวข้อ + ไอคอนในกรอบ */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: cfScale(8) }}>
              <div>
                <div style={{ fontSize: cfScale(15.5), fontWeight: 800, letterSpacing: '.01em', lineHeight: 1.15 }}>Grand Totals Actual</div>
                <div style={{ fontSize: cfScale(11), color: 'rgba(255,255,255,.78)', marginTop: cfScale(3) }}>เทียบกับงบประมาณการรวมทั้งเดือน</div>
              </div>
              <span style={{ display: 'grid', placeItems: 'center', width: cfScale(38), height: cfScale(38), borderRadius: cfScale(11), background: 'rgba(255,255,255,.18)', color: '#eafff4', flex: 'none' }}><Icon name="chart" size={20} /></span>
            </div>
            {/* โซนกลาง — ยอดจ่ายจริงสะสม (พระเอก) + แถบ % เทียบงบ */}
            <div>
              <div style={{ fontSize: cfScale(13), color: 'rgba(255,255,255,.82)', letterSpacing: '.04em' }}>รวมจ่ายจริงสะสม (บาท)</div>
              <div style={{ fontSize: cfScale(40), fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.0, letterSpacing: '-.02em', marginTop: cfScale(3), textShadow: '0 2px 22px rgba(0,0,0,.25)' }}>
                {editMode
                  ? <span style={{ color: 'var(--ink-900)' }}><EditableNumber ovKey={gaKey} computed={grandActualRaw} editMode={true} digits={0} /></span>
                  : (<>{fmtNum(grandActual, 0)}{grandActualOver && <span title="แก้มือ" style={{ fontSize: cfScale(15), marginLeft: 6 }}>✏️</span>}</>)}
              </div>
              <div style={{ position: 'relative', height: cfScale(30), background: 'rgba(0,0,0,.22)', borderRadius: cfScale(8), overflow: 'hidden', marginTop: cfScale(13) }}>
                <div style={{
                  position: 'absolute', inset: 0, width: `${Math.max(2, Math.min(100, grandPct))}%`,
                  background: 'linear-gradient(90deg, #34e29a, #9af5c8)', transition: 'width 800ms',
                  boxShadow: '0 0 18px color-mix(in oklch, #34e29a 70%, transparent)', borderRadius: cfScale(8),
                }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${cfScale(12)}`, fontSize: cfScale(12.5), fontWeight: 800 }}>
                  <span style={{ color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.6), 0 0 2px rgba(0,0,0,.55)' }}>{grandPct.toFixed(2)}%</span>
                  <span style={{ color: 'rgba(255,255,255,.85)', fontSize: cfScale(11) }}>ของแผนทั้งเดือน</span>
                </div>
              </div>
            </div>
            {/* โซนล่าง — สถิติย่อ: แผนรวม / คงเหลือ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: cfScale(9) }}>
              <div style={{ background: 'rgba(255,255,255,.12)', borderRadius: cfScale(11), padding: `${cfScale(12)} ${cfScale(13)}` }}>
                <div style={{ fontSize: cfScale(11), color: 'rgba(255,255,255,.72)' }}>แผนรวมทั้งเดือน</div>
                <div style={{ fontSize: cfScale(18), fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: cfScale(3) }}>
                  {editMode
                    ? <span style={{ color: 'var(--ink-900)' }}><EditableNumber ovKey={gpKey} computed={grandPlanRaw} editMode={true} digits={0} /></span>
                    : <>{fmtNum(grandPlan / 1e6, 2)}M{grandPlanOver && <span title="แก้มือ" style={{ fontSize: cfScale(10), marginLeft: 3 }}>✏️</span>}</>}
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,.12)', borderRadius: cfScale(11), padding: `${cfScale(12)} ${cfScale(13)}` }}>
                <div style={{ fontSize: cfScale(11), color: 'rgba(255,255,255,.72)' }}>คงเหลือต้องจ่าย</div>
                <div style={{ fontSize: cfScale(18), fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#bff3d8', marginTop: cfScale(3) }}>{fmtNum(remaining / 1e6, 2)}M</div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
      </div>{/* end weekly grid (week cards + grand total cell) */}
      </div>{/* end data-print-page wrapper for Section 02 */}

      {/* Footer hints — พับเก็บไว้ (default ซ่อน) กดหัวข้อเพื่อกาง */}
      <div className="card no-print" style={{ marginTop: 12, padding: showNotes ? 14 : '10px 14px', background: '#fffbeb', borderLeft: '4px solid #f6ad55', fontSize: 12, color: 'var(--ink-700)' }}>
        <div
          onClick={() => setShowNotes(v => !v)}
          style={{ fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}
          title={showNotes ? 'ซ่อนหมายเหตุ' : 'ดูหมายเหตุ — ที่มาของตัวเลข'}
        >
          <span style={{ fontSize: 10, transform: showNotes ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>▶</span>
          💡 หมายเหตุ — ที่มาของตัวเลข
        </div>
        {showNotes && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
          <li><strong>ยอดยกมา</strong> — ยอดธนาคารสิ้นเดือนก่อน (<a href="#daily_balance" style={{ color: 'var(--brand-600)' }}>บันทึกรายวัน</a>) · ไม่มีก็ใช้ยอดสดปัจจุบัน · <strong>รายรับ</strong> — ลูกหนี้ค้างที่ยังไม่รับเงิน (<a href="#iv_report" style={{ color: 'var(--brand-600)' }}>IV</a>)</li>
          <li><strong>ประมาณการ (Forecast)</strong> — ตั้งมือล่วงหน้าจาก <a href="#data_forecast" style={{ color: 'var(--brand-600)' }}>ประมาณการรายจ่าย</a> · <strong>จ่ายจริง (Actual)</strong> — <a href="#data_pv" style={{ color: 'var(--brand-600)' }}>PV</a> + ประมาณการที่จ่ายจริง · <strong>เงินกู้</strong> — ตั้ง EXPENSE_TYPE=LOAN · เรื่อง AP ครบดิว/เลือกจ่าย ดูที่ <a href="#bank_diary" style={{ color: 'var(--brand-600)' }}>Bank Diary</a></li>
          <li>สัปดาห์สุดท้ายของเดือน → คอลัมน์ "สัปดาห์ที่เหลือ": <strong>รายจ่าย</strong> = ประมาณการ<strong>เดือนถัดไป</strong> · <strong>รับเงินโครงการ</strong> = ยอดเดียวกับ <a href="#warroom1" style={{ color: 'var(--brand-600)' }}>War Room รายรับ SEC03</a> (ใบแจ้งหนี้คงค้างนอกเดือนปัจจุบัน) · พอขึ้นเดือนใหม่กลับไปใช้เงื่อนไขปกติ</li>
        </ul>
        )}
      </div>

      {/* ═════ SECTION 03 — ตรวจสอบยอดดิบ (manager-only) ═══════════════════ */}
      {cfIsManager() && (
        <CfReconCard
          bf={monthBFAvailable}
          bankActual={liveAvailable}
          ivActual={ivActual}
          loanActual={loanActual}
          outflowActual={outflowActual}
          ivWeekActual={ivInflowByWeek.actual}
          loanWeekActual={loanByWeek.actual}
          outflowGrid={pvActualByWeekCat}
          weeks={weeks}
          nowWeek={nowWeek}
          snapshots={snapshots}
          liveHold={liveHold}
          monthNames={monthNames}
          month={month}
        />
      )}

      {/* ═════ What-if Simulator — จำลองเลื่อนจ่าย/รับ (พาเนลแยก, จำลองล้วน) ═══ */}
      <CfWhatIfPanel bf={liveAvailable} weeks={weeks} items={whatIfItems} />

      {/* ═════ Drill-down modal — verify which rows make up each cell ═══════ */}
      {drillDown && (
        <Modal open={!!drillDown} title={'รายละเอียด · ' + drillDown.title} maxWidth={920}
          onClose={() => setDrillDown(null)}
          footer={<button className="btn btn-primary" onClick={() => setDrillDown(null)}>ปิด</button>}>
          {drillDown.apMode ? (() => {
            const apTotal = drillDown.apItems.reduce((s, x) => s + Math.abs(x.amount), 0);
            const incManual = drillDown.manualCands.filter(m => WTPOverride.resolve(cfSec1IncKey(m.feId), 0));
            const manualTotal = incManual.reduce((s, x) => s + Math.abs(x.amount), 0);
            const toggleManual = (m) => {
              const k = cfSec1IncKey(m.feId);
              if (WTPOverride.resolve(k, 0)) WTPOverride.clear(k); else WTPOverride.set(k, 1);
            };
            return (
              <>
                {/* สรุป: AP ที่เลือกจ่าย + ตั้งมือที่ติ๊กรวม = ยอดในช่อง (แผนจ่ายจริง) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                  <div style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--bad-bg)', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>AP ที่เลือกจ่าย ({drillDown.apItems.length})</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--bad)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtNum(apTotal, 0)}</div>
                  </div>
                  <div style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--ink-50)', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>+ ตั้งมือที่ติ๊กรวม ({incManual.length})</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink-700)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtNum(manualTotal, 0)}</div>
                  </div>
                  <div style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--warn-bg)', textAlign: 'center', border: '1.5px solid color-mix(in oklch, var(--warn) 40%, transparent)' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-600)', fontWeight: 600 }}>= ยอดในช่อง (แผนจ่ายจริง)</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--warn)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtNum(apTotal + manualTotal, 0)}</div>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--bad)', margin: '4px 0 6px' }}>📋 รายการ AP ที่เลือกจ่ายไว้ (ขึ้น CARD BANK · Bank Diary)</div>
                {drillDown.apItems.length === 0 ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--ink-500)', fontSize: 12, background: 'var(--ink-50)', borderRadius: 8 }}>
                    ยังไม่มีรายการ AP ที่เลือกจ่ายในช่วงนี้ — เลือกได้ที่หน้า <a href="#bank_diary" style={{ color: 'var(--brand-600)' }}>Bank Diary</a> (เลือก AP → วางแผนจ่าย)
                  </div>
                ) : (
                  <div style={{ maxHeight: '34vh', overflow: 'auto' }}>
                    <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                        <tr>
                          <th style={{ width: 96 }}>วันที่จ่าย</th>
                          <th style={{ width: 130 }}>เลขที่ AP</th>
                          <th>ผู้รับเงิน/รายการ</th>
                          <th style={{ width: 120, textAlign: 'right' }}>จำนวน</th>
                          <th style={{ width: 60, textAlign: 'center' }}>ดู</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drillDown.apItems.map((it, i) => (
                          <tr key={i}>
                            <td>{fmtDate(it.date) || it.date}</td>
                            <td>{it.ref || '—'}</td>
                            <td>{it.name}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--bad)' }}>{fmtNum(Math.abs(it.amount), 0)}</td>
                            <td style={{ textAlign: 'center' }}><button className="btn btn-sm" onClick={() => setDetailItem(it)}>ดู</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-700)', margin: '14px 0 6px' }}>
                  ✍️ รายการตั้งมือในช่วงนี้ — ติ๊กเพื่อรวมในแผนจ่ายจริง
                  <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--ink-500)', marginLeft: 6 }}>(default ไม่รวม · ตั้งมือถูกนับเป็นประมาณการรวมใน Section 02 อยู่แล้ว)</span>
                </div>
                {drillDown.manualCands.length === 0 ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--ink-500)', fontSize: 12, background: 'var(--ink-50)', borderRadius: 8 }}>
                    ไม่มีรายการตั้งมือในช่วงนี้
                  </div>
                ) : (
                  <div style={{ maxHeight: '30vh', overflow: 'auto' }}>
                    <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                        <tr>
                          <th style={{ width: 56, textAlign: 'center' }}>รวม</th>
                          <th style={{ width: 96 }}>วันที่จ่าย</th>
                          <th>รายการ</th>
                          <th style={{ width: 120, textAlign: 'right' }}>จำนวน</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drillDown.manualCands.map((m) => {
                          const checked = !!WTPOverride.resolve(cfSec1IncKey(m.feId), 0);
                          return (
                            <tr key={m.feId} style={{ background: checked ? 'var(--warn-bg)' : 'transparent', cursor: 'pointer' }} onClick={() => toggleManual(m)}>
                              <td style={{ textAlign: 'center' }}><input type="checkbox" checked={checked} readOnly /></td>
                              <td>{fmtDate(m.date) || m.date}</td>
                              <td>{m.name}{m.ref ? ' · ' + m.ref : ''}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: checked ? 'var(--warn)' : 'var(--ink-500)' }}>{fmtNum(Math.abs(m.amount), 0)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-500)', lineHeight: 1.6 }}>
                  💡 <strong>แผนจ่ายจริง</strong> = รายการ AP ที่เลือกจ่ายไว้แล้วจากหน้า <a href="#bank_diary" style={{ color: 'var(--brand-600)' }}>Bank Diary</a> (ขึ้น CARD BANK) ·
                  ติ๊ก "รวม" เพื่อหยิบรายการตั้งมือบางรายการมารวม (ติ๊กแล้ว sync ทั้งทีม) ·
                  AP ที่จ่ายจริงผ่าน PV แล้วถูกตัดออกอัตโนมัติ
                </div>
              </>
            );
          })() : drillDown.items.length === 0
                  && !(drillDown.advancePv && drillDown.advancePv.length > 0)
                  && !drillDown.outRecon ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--ink-500)', fontSize: 12.5 }}>
              ไม่มีรายการในช่วงนี้
            </div>
          ) : (drillDown.mode === 'actual' || drillDown.mode === 'forecast') ? (
            <>
              {/* ── โหมด "จ่ายจริง"/"ประมาณการ" — รายการที่ประกอบเป็นยอด Actual/Forecast ของช่องนั้น ── */}
              <div style={{
                display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12,
                padding: 12, background: 'var(--brand-50)', borderRadius: 8,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{drillDown.mode === 'forecast' ? 'จำนวนรายการประมาณการ' : 'จำนวนรายการจ่ายจริง'}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--brand-700)' }}>{drillDown.items.length}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{drillDown.mode === 'forecast' ? 'ยอดประมาณการรวม' : 'ยอดจ่ายจริงรวม'}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--brand-700)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtNum(Math.abs(drillDown.items.reduce((s, x) => s + x.amount, 0)), 2)}
                  </div>
                </div>
              </div>
              <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
                <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                    <tr>
                      <th style={{ width: 64, textAlign: 'left' }}>ที่มา</th>
                      <th style={{ width: 96 }}>วันที่</th>
                      <th style={{ width: 120 }}>เลขที่</th>
                      <th>ผู้รับเงิน/รายการ</th>
                      <th style={{ width: 130, textAlign: 'right' }}>{drillDown.mode === 'forecast' ? 'ประมาณการ' : 'จ่ายจริง'}</th>
                      <th style={{ width: 90, textAlign: 'center' }}>{drillDown.mode === 'forecast' ? 'แก้/ดู' : 'ดู'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupDrillItems(drillDown.items).map((g) => (
                      g.items.length > 1
                        ? <DrillGroupRow key={g.key} group={g} onCommit={commitForecastEdit} onView={setDetailItem} onSetGroupCat={setGroupCategory} />
                        : <DrillRow key={g.key} item={g.items[0]} onCommit={commitForecastEdit} onView={setDetailItem} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-500)', lineHeight: 1.6 }}>
                {drillDown.mode === 'forecast' ? (
                  <>
                    💡 <strong>Forecast</strong> = ประมาณการที่ตั้งไว้จากหน้า Forecast (forecastEntries) ·
                    👆 <strong>คลิกที่บรรทัด</strong> เพื่อดู/แก้ยอด · ยอดรวมตรงกับช่อง Forecast ในการ์ดสัปดาห์ ·
                    ตั้ง/แก้ได้ที่ <a href="#data_forecast" style={{ color: 'var(--brand-600)' }}>ประมาณการรายจ่าย</a>
                  </>
                ) : (
                  <>
                    💡 <strong>PV</strong> = ใบจ่ายเงินจริง (Payment Voucher) ·
                    <strong> Forecast</strong> = ประมาณการที่บันทึกว่าจ่ายจริงแล้ว<br />
                    👆 <strong>คลิกที่บรรทัด</strong> เพื่อดูรายละเอียด · ยอดรวมตรงกับช่องในการ์ดสัปดาห์ ·
                    ดูข้อมูลต้นทางได้ที่ <a href="#data_pv" style={{ color: 'var(--brand-600)' }}>รายการจ่าย (PV)</a>
                  </>
                )}
              </div>
              {/* ── PV ตัดล่วงหน้า · ยังไม่ถึงวันจ่าย — เงินยังไม่ออก จึงไม่นับเป็นจ่ายจริง (กดยืนยันได้) ── */}
              {drillDown.mode === 'actual' && renderAdvancePvPanel(drillDown.advancePv)}
            </>
          ) : (
            <>
              {drillDown.outRecon ? (
                /* ── ช่องรายจ่าย: ประมาณการเต็ม − จ่ายจริงแล้ว = คงเหลือต้องจ่าย (= ตัวเลขในช่อง) ── */
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: drillDown.outRecon.pending > 0 ? 8 : 12 }}>
                    <div style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--ink-50)', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ประมาณการคงเหลือ</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink-700)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtNum(drillDown.outRecon.planRemaining, 0)}</div>
                      <div style={{ fontSize: 9.5, color: 'var(--ink-400)', marginTop: 1 }}>เต็ม {fmtNum(drillDown.outRecon.forecast, 0)} − จ่ายแล้ว {fmtNum(drillDown.outRecon.actual, 0)}</div>
                    </div>
                    <div className="no-present no-print" style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--warn-bg)', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>🕐 PV ตัดล่วงหน้า (รอจ่าย)</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--warn)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtNum(drillDown.outRecon.pending, 0)}</div>
                    </div>
                    <div style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--brand-50)', textAlign: 'center', border: '1.5px solid color-mix(in oklch, var(--brand-500) 40%, transparent)' }}>
                      <div style={{ fontSize: 11, color: 'var(--ink-600)', fontWeight: 600 }}>= ยอดในช่องนี้ ({drillDown.outRecon.mode === 'pv' ? (drillDown.outRecon.usedFallback ? 'ประมาณการ — ไม่มี PV' : 'ยอด PV') : 'ประมาณการ'})</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--brand-700)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtNum(drillDown.outRecon.remaining, 0)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-500)', margin: '0 0 12px', lineHeight: 1.5 }}>
                    {drillDown.outRecon.mode === 'pv'
                      ? (drillDown.outRecon.usedFallback
                          ? <span>💡 หมวดนี้<strong>ไม่มี PV ตัดล่วงหน้า</strong> (เช่น เงินเดือน/เบ็ดเตล็ด ที่จ่ายไม่ผ่าน PV) → ช่องนี้ใช้<strong>ยอดประมาณการคงเหลือ</strong>แทน</span>
                          : <span>💡 โหมด <strong>ยอด PV ที่ตัด</strong> — ช่องนี้ใช้ยอด PV ตัดล่วงหน้า (รอจ่าย) ตรงๆ · กดยืนยันจ่ายจริงได้ที่ตาราง 🕐 ด้านล่าง พอกดแล้วจะหักออกจากช่องนี้</span>)
                      : <span>💡 โหมด <strong>ประมาณการคงเหลือ</strong> — ช่องนี้ = ประมาณการ − จ่ายจริงแล้ว · <strong>PV ตัดล่วงหน้ายังไม่ถูกรวม</strong> (กดปุ่ม <strong>ยอด PV ที่ตัด</strong> เพื่อใช้ยอด PV) · กดยืนยันจ่ายจริงได้ที่ตาราง 🕐 ด้านล่าง</span>}
                  </div>
                </>
              ) : (
              <div style={{
                display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12,
                padding: 12, background: 'var(--brand-50)', borderRadius: 8,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>จำนวนรายการ</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--brand-700)' }}>{drillDown.items.length}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>ยอดรวม</div>
                  <div style={{ fontSize: 18, fontWeight: 700,
                    color: drillDown.items.reduce((s, x) => s + x.amount, 0) < 0 ? 'var(--bad)' : 'var(--good)' }}>
                    {fmtNum(drillDown.items.reduce((s, x) => s + x.amount, 0), 0)}
                  </div>
                </div>
              </div>
              )}
              {drillDown.outRecon && (
                <div style={{ fontSize: 11, color: 'var(--ink-500)', margin: '-4px 0 12px', lineHeight: 1.6 }}>
                  💡 รายการด้านล่าง = <strong>ประมาณการเต็ม</strong>ของช่วงนี้ · ส่วนที่ <strong>จ่ายจริงแล้ว</strong> ({fmtNum(drillDown.outRecon.actual, 0)}) ดูรายตัวได้ที่หัวข้อ <strong>02 ติดตามจ่ายจริง</strong> (คลิกยอด Actual)
                </div>
              )}
              {(() => {
                const pending = drillDown.items.filter(x => !x.isPaid);
                const paid    = drillDown.items.filter(x =>  x.isPaid);
                const tbl = (rows, grayed) => (
                  <table className="tbl" style={{ width: '100%', fontSize: 12.5, opacity: grayed ? 0.75 : 1 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                      <tr>
                        <th style={{ width: 70, textAlign: 'left' }}>ที่มา</th>
                        <th style={{ width: 100 }}>วันที่</th>
                        <th style={{ width: 130 }}>เลขที่</th>
                        <th>ชื่อ/รายการ</th>
                        <th style={{ width: 140, textAlign: 'right' }}>จำนวน</th>
                        <th style={{ width: 150, textAlign: 'center' }}>จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupDrillItems(rows).map((g) => (
                        g.items.length > 1
                          ? <DrillGroupRow key={g.key} group={g} onCommit={commitForecastEdit} onView={setDetailItem} onSetGroupCat={setGroupCategory} />
                          : <DrillRow key={g.key} item={g.items[0]} onCommit={commitForecastEdit} onView={setDetailItem} />
                      ))}
                    </tbody>
                  </table>
                );
                return (
                  <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
                    {tbl(pending, false)}
                    {paid.length > 0 && (
                      <>
                        <div style={{ margin: '14px 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 1, background: 'var(--ink-100)' }} />
                          <span style={{ fontSize: 11.5, color: 'var(--ink-500)', whiteSpace: 'nowrap', fontWeight: 600 }}>
                            ✅ จ่ายแล้ว ({paid.length} รายการ · ตัดออกจากประมาณการสัปดาห์แล้ว)
                          </span>
                          <div style={{ flex: 1, height: 1, background: 'var(--ink-100)' }} />
                        </div>
                        {tbl(paid, true)}
                      </>
                    )}
                  </div>
                );
              })()}
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-500)', lineHeight: 1.6 }}>
                💡 <strong>AP</strong> = เจ้าหนี้คงค้างจากระบบ ·
                <strong> IV</strong> = ใบแจ้งหนี้รับเงิน ·
                <strong> Forecast</strong> = ประมาณการบันทึกเอง<br />
                👆 <strong>คลิกที่บรรทัด</strong> เพื่อดูรายละเอียดของรายการนั้น ·
                ✅ AP ค้างจ่าย: กด <strong>จ่ายแล้ว</strong> เพื่อตัดออกจากประมาณการสัปดาห์ (รอ PV) ·
                ✏️ Forecast (PLANNED): กด <strong>แก้</strong> เพื่อแก้ยอด ·
                แก้ข้อมูลต้นทางได้ที่
                <a href="#data_payables" style={{ color: 'var(--brand-600)' }}> AP Outstanding</a> หรือ
                <a href="#data_forecast" style={{ color: 'var(--brand-600)' }}> ประมาณการรายจ่าย</a>
              </div>
              {/* PV ตัดล่วงหน้าของช่องนี้ — โชว์ + กดยืนยันจ่ายจริงได้จาก SEC01 ด้วย */}
              {renderAdvancePvPanel(drillDown.advancePv)}
            </>
          )}
        </Modal>
      )}

      {/* ═════ IV plan detail modal ═══════════════════════════════════════ */}
      {ivDrill && (
        <IvPlanDrillModal
          invoices={invoices}
          ivPlanLock={ivPlanLock}
          ivForecast={ivForecast}
          ivActual={ivActual}
          financeByCode={financeByCode}
          weeks={weeks}
          year={year}
          month={month}
          monthNames={monthNames}
          onClose={() => setIvDrill(false)}
        />
      )}

      {/* ═════ Per-item detail popup (ซ้อนบน drill-down) ═══════════════════ */}
      {detailItem && (
        <Modal open={!!detailItem} title={'รายละเอียดรายการ · ' + (detailItem.name || '')} maxWidth={560}
          onClose={() => setDetailItem(null)}
          footer={<button className="btn btn-primary" onClick={() => setDetailItem(null)}>ปิด</button>}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            padding: '10px 14px', marginBottom: 12, borderRadius: 8, background: 'var(--brand-50)',
          }}>
            <span style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 700,
              background: detailItem.source === 'AP' ? 'color-mix(in oklch, var(--bad) 16%, transparent)' :
                          detailItem.source === 'IV' ? 'color-mix(in oklch, var(--good) 16%, transparent)' :
                          'color-mix(in oklch, var(--brand-500) 16%, transparent)',
              color: detailItem.source === 'AP' ? 'var(--bad)' : detailItem.source === 'IV' ? 'var(--good)' : 'var(--brand-700)',
            }}>{detailItem.source}</span>
            <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              color: detailItem.amount < 0 ? 'var(--bad)' : 'var(--good)' }}>
              {fmtNum(detailItem.amount, Number.isInteger(detailItem.amount) ? 0 : 2)}
            </span>
          </div>
          {(detailItem.pvNo || detailItem.feId || (detailItem.source === 'AP' && detailItem.vchno)) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 12, borderRadius: 8, background: 'var(--warn-bg)', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-700)', whiteSpace: 'nowrap' }}>✏️ แก้หมวด:</span>
              <select value={detailItem.cat || ''}
                disabled={typeof _wtpRoleIsReadOnly === 'function' && _wtpRoleIsReadOnly()}
                onChange={(e) => setItemCategory(detailItem, e.target.value)}
                className="select input" style={{ flex: 1, fontSize: 12.5, padding: '6px 10px' }}>
                <option value="" disabled>— เลือกหมวด —</option>
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} · {CATEGORY_LABELS[n]}</option>)}
              </select>
            </div>
          )}
          <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              {(detailItem.detail || []).map(([k, v], j) => (
                <tr key={j}>
                  <td style={{ width: 170, color: 'var(--ink-500)', verticalAlign: 'top', padding: '6px 12px' }}>{k}</td>
                  <td style={{ fontWeight: 600, color: 'var(--ink-800)', padding: '6px 12px' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

    </div>
  );
}

// ─── Helpers (presentational) ─────────────────────────────────────────────
function SectionTitle({ num, title, subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: cfScale(14), padding: `${cfScale(8)} 0 ${cfScale(14)}` }}>
      <div style={{ width: cfScale(38), height: cfScale(38), borderRadius: cfScale(10), background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))', color: 'white', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: cfScale(14), flex: 'none' }}>{num}</div>
      <div>
        <h2 style={{ margin: 0, fontSize: cfScale(17), fontWeight: 700, color: 'var(--ink-900)' }}>{title}</h2>
        <div style={{ fontSize: cfScale(12), color: 'var(--ink-500)', marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );
}

function BalanceCard({ tone, label, value, hint, icon, editMode, ovKey, big, style }) {
  const tones = {
    bf:   { bg: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))', text: 'white' },
    now:  { bg: 'linear-gradient(135deg, oklch(62% 0.13 245), oklch(46% 0.16 255))', text: 'white' },
    good: { bg: 'linear-gradient(135deg, oklch(65% 0.16 152), oklch(50% 0.16 152))', text: 'white' },
    bad:  { bg: 'linear-gradient(135deg, oklch(65% 0.18 22), oklch(50% 0.18 22))',   text: 'white' },
  };
  const t = tones[tone] || tones.bf;
  const displayValue = ovKey ? WTPOverride.resolve(ovKey, value) : value;
  useOverrideSub(ovKey || '_');
  return (
    <div className="card" style={{ background: t.bg, color: t.text, borderColor: 'transparent', padding: big ? cfScale(28) : cfScale(22), position: 'relative', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: big ? 'center' : 'flex-start', ...style }}>
      <div style={{ position: 'absolute', right: -40, top: -40, width: big ? 220 : 160, height: big ? 220 : 160, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: big ? cfScale(15) : cfScale(13), opacity: 0.9, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon && <Icon name={icon} size={big ? 17 : 14} />} {label}
        </div>
        <div style={{ fontSize: big ? cfScale(52) : cfScale(36), fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 6, letterSpacing: '-.02em', lineHeight: 1.05 }}>
          {editMode && ovKey ? (
            <EditableNumber ovKey={ovKey} computed={value} editMode={true} digits={0} />
          ) : (
            <>
              {displayValue < 0 ? '(' : ''}{fmtNum(Math.abs(displayValue), 0)}{displayValue < 0 ? ')' : ''}
              {ovKey && WTPOverride.has(ovKey) && <span title="แก้มือ" style={{ fontSize: 13, marginLeft: 8, opacity: 0.9 }}>✏️</span>}
            </>
          )}
        </div>
        {hint && <div style={{ fontSize: big ? cfScale(13) : cfScale(12), opacity: 0.85, marginTop: big ? 10 : 4 }}>{hint}</div>}
      </div>
    </div>
  );
}

// ── IV Plan Detail Modal ──────────────────────────────────────────────────────
function IvPlanDrillModal({ invoices, ivPlanLock, ivForecast, ivActual, financeByCode, weeks, year, month, monthNames, onClose }) {
  const [tab, setTab] = React.useState('all');

  const bySafe = React.useMemo(() => {
    const m = {};
    (invoices || []).forEach(iv => {
      const s = sanitizeIvKey(iv.ivNo || iv.IV_NO || iv.invoiceNo);
      if (s) m[s] = iv;
    });
    return m;
  }, [invoices]);

  const { planItems, planSafes } = React.useMemo(() => {
    const items = [], safes = new Set();
    if (ivPlanLock && ivPlanLock.locked) {
      (ivPlanLock.items || []).forEach(it => {
        const iv = bySafe[it.safe] || null;
        if (iv && !ivIsProject(iv)) return;  // ข้ามประเภทอื่นๆ ที่อาจค้างอยู่ใน lock เก่า
        safes.add(it.safe);
        items.push({ iv, planNet: it.net, safe: it.safe });
      });
    } else {
      (invoices || []).forEach(iv => {
        if (!ivIsProject(iv)) return;  // เฉพาะประเภทงานโครงการ (P)
        if (!ivIsPaid(iv) && iv.expectedReceive && inMonth(iv.expectedReceive, year, month)) {
          const net = ivNetExpected(iv, financeByCode);
          if (net >= 1) {
            const safe = sanitizeIvKey(iv.ivNo || iv.IV_NO || iv.invoiceNo);
            safes.add(safe);
            items.push({ iv, planNet: net, safe });
          }
        }
      });
    }
    items.sort((a, b) => ((a.iv && a.iv.expectedReceive) || '').localeCompare((b.iv && b.iv.expectedReceive) || ''));
    return { planItems: items, planSafes: safes };
  }, [invoices, ivPlanLock, bySafe, year, month, financeByCode]);

  const actualItems = React.useMemo(() => {
    const items = [];
    (invoices || []).forEach(iv => {
      if (!ivIsProject(iv)) return;  // เฉพาะประเภทงานโครงการ (P)
      const ad = ivActualReceiveDate(iv);
      if (ad && inMonth(ad, year, month)) {
        const net = ivNetExpected(iv, financeByCode);
        const safe = sanitizeIvKey(iv.ivNo || iv.IV_NO || iv.invoiceNo);
        items.push({ iv, actualNet: net, actualDate: ad, safe, inPlan: planSafes.has(safe) });
      }
    });
    items.sort((a, b) => (b.actualDate || '').localeCompare(a.actualDate || ''));
    return items;
  }, [invoices, year, month, financeByCode, planSafes]);

  const pendingItems = React.useMemo(() => planItems.filter(p => !(p.iv && ivIsPaid(p.iv))), [planItems]);
  const extraItems   = React.useMemo(() => actualItems.filter(a => !a.inPlan), [actualItems]);

  const tabs = [
    { key: 'all',      label: 'แผนทั้งหมด', count: planItems.length },
    { key: 'received', label: 'รับแล้ว ✓',  count: actualItems.length },
    { key: 'pending',  label: 'ยังไม่รับ',   count: pendingItems.length },
    { key: 'extra',    label: '⚡ นอกแผน',   count: extraItems.length },
  ];

  const rows = tab === 'all'      ? planItems.map(p => ({ ...p, mode: 'plan' }))
             : tab === 'received' ? actualItems.map(a => ({ ...a, mode: 'received' }))
             : tab === 'pending'  ? pendingItems.map(p => ({ ...p, mode: 'plan' }))
             : extraItems.map(a => ({ ...a, mode: 'received' }));

  const gap = ivActual - ivForecast;
  const mn  = (monthNames || [])[month - 1] || '';

  const ivLabel   = (item) => { const iv = item.iv; if (!iv) return item.safe || '—'; return iv.ivNo || iv.IV_NO || iv.invoiceNo || '—'; };
  const projLabel = (item) => { const iv = item.iv; if (!iv) return '—'; return iv.projectName || iv.jobNo || iv.contractRef || '—'; };
  const custLabel = (item) => { const iv = item.iv; if (!iv) return ''; return (iv.customerName || iv.customer || '').toString().trim(); };
  const statusBadge = (item) => {
    const iv = item.iv;
    if (!iv) return null;
    if (ivIsPaid(iv)) return { label: 'รับแล้ว ✓', color: 'var(--good)', bg: 'var(--good-bg)' };
    return { label: 'ติดตาม', color: 'oklch(55% 0.17 60)', bg: 'oklch(97% 0.02 60)' };
  };
  const fmtD = (d) => d ? fmtDate(d) : '—';
  const fmtM = (n) => (n != null && n !== '') ? fmtNum(n, 0) : '—';
  const isPlanTab = tab === 'all' || tab === 'pending';
  const thStyle = { padding: '7px 8px', fontSize: 11, fontWeight: 700, color: 'var(--ink-500)', whiteSpace: 'nowrap', borderBottom: '2px solid var(--ink-100)' };
  const tdStyle = (align) => ({ padding: '6px 8px', textAlign: align || 'left', fontSize: 12.5, verticalAlign: 'middle' });

  return (
    <Modal open={true} onClose={onClose}
      title={`ใบแจ้งหนี้รอรับเงิน · ${mn} ${year}`}
      maxWidth={940}
      footer={<button className="btn btn-primary" onClick={onClose}>ปิด</button>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'แผน (PLAN)',  value: ivForecast,    color: 'var(--brand-700)', sign: '' },
          { label: 'รับจริงแล้ว', value: ivActual,       color: 'var(--good)',      sign: '' },
          { label: gap >= 0 ? '▲ เกินแผน' : '▽ ขาดแผน', value: Math.abs(gap), color: gap >= 0 ? 'var(--good)' : 'var(--bad)', sign: gap >= 0 ? '+' : '-' },
        ].map(({ label, value, color, sign }) => (
          <div key={label} style={{ textAlign: 'center', padding: '10px 8px', background: 'var(--ink-50)', borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{sign}{fmtM(value)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: tab === t.key ? '1.5px solid var(--brand-500)' : '1.5px solid var(--ink-200)',
            background: tab === t.key ? 'var(--brand-50)' : 'transparent',
            color: tab === t.key ? 'var(--brand-700)' : 'var(--ink-600)',
          }}>
            {t.label}&nbsp;<span style={{ opacity: 0.7, fontSize: 11 }}>({t.count})</span>
          </button>
        ))}
      </div>
      {rows.length === 0
        ? <div style={{ textAlign: 'center', color: 'var(--ink-400)', padding: 36, fontSize: 14 }}>ไม่มีรายการ</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--ink-50)' }}>
                  {isPlanTab ? <>
                    <th style={{ ...thStyle, width: 30, textAlign: 'center' }}>#</th>
                    <th style={{ ...thStyle, width: 120 }}>เลขที่ IV</th>
                    <th style={{ ...thStyle }}>โครงการ</th>
                    <th style={{ ...thStyle, width: 130 }}>ลูกค้า</th>
                    <th style={{ ...thStyle, width: 120, textAlign: 'right' }}>แผน</th>
                    <th style={{ ...thStyle, width: 95, textAlign: 'center' }}>วันคาดรับ</th>
                    <th style={{ ...thStyle, width: 95, textAlign: 'center' }}>สถานะ</th>
                  </> : <>
                    <th style={{ ...thStyle, width: 120 }}>เลขที่ IV</th>
                    <th style={{ ...thStyle }}>โครงการ</th>
                    <th style={{ ...thStyle, width: 130 }}>ลูกค้า</th>
                    <th style={{ ...thStyle, width: 120, textAlign: 'right' }}>รับจริง</th>
                    <th style={{ ...thStyle, width: 95, textAlign: 'center' }}>วันรับจริง</th>
                    {tab === 'extra' && <th style={{ ...thStyle, width: 75, textAlign: 'center' }}>หมายเหตุ</th>}
                  </>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const badge = statusBadge(row);
                  const iv = row.iv;
                  const receivedDate = iv ? ivActualReceiveDate(iv) : null;
                  const receivedThisMonth = receivedDate && inMonth(receivedDate, year, month);
                  return (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'var(--ink-50)', borderBottom: '1px solid var(--ink-100)' }}>
                      {isPlanTab ? <>
                        <td style={{ ...tdStyle('center'), color: 'var(--ink-400)', fontSize: 11 }}>{ri + 1}</td>
                        <td style={{ ...tdStyle(), fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)', whiteSpace: 'nowrap' }}>{ivLabel(row)}</td>
                        <td style={{ ...tdStyle(), maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={projLabel(row)}>{projLabel(row)}</td>
                        <td style={{ ...tdStyle(), color: 'var(--ink-500)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={custLabel(row)}>{custLabel(row)}</td>
                        <td style={{ ...tdStyle('right'), fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtM(row.planNet)}</td>
                        <td style={{ ...tdStyle('center'), color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>{fmtD(iv && iv.expectedReceive)}</td>
                        <td style={{ ...tdStyle('center') }}>
                          {badge ? <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10.5, fontWeight: 700,
                            color: badge.color, background: badge.bg, border: `1px solid ${badge.color}`, whiteSpace: 'nowrap' }}>{badge.label}</span> : '—'}
                          {receivedThisMonth && <div style={{ fontSize: 9.5, color: 'var(--good)', marginTop: 2 }}>{fmtD(receivedDate)}</div>}
                        </td>
                      </> : <>
                        <td style={{ ...tdStyle(), fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)', whiteSpace: 'nowrap' }}>{ivLabel(row)}</td>
                        <td style={{ ...tdStyle(), maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={projLabel(row)}>{projLabel(row)}</td>
                        <td style={{ ...tdStyle(), color: 'var(--ink-500)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={custLabel(row)}>{custLabel(row)}</td>
                        <td style={{ ...tdStyle('right'), fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--good)' }}>{fmtM(row.actualNet)}</td>
                        <td style={{ ...tdStyle('center'), color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>{fmtD(row.actualDate)}</td>
                        {tab === 'extra' && <td style={{ ...tdStyle('center') }}>
                          <span style={{ fontSize: 10, color: 'var(--bad)', background: 'var(--bad-bg)', padding: '2px 6px', borderRadius: 10, fontWeight: 700 }}>นอกแผน</span>
                        </td>}
                      </>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--ink-100)', fontWeight: 700 }}>
                  {isPlanTab ? <>
                    <td colSpan={4} style={{ ...tdStyle(), fontSize: 12, color: 'var(--ink-600)' }}>รวม {rows.length} ใบ</td>
                    <td style={{ ...tdStyle('right'), fontVariantNumeric: 'tabular-nums', color: 'var(--brand-700)' }}>{fmtM(rows.reduce((s, r) => s + (r.planNet || 0), 0))}</td>
                    <td colSpan={2} />
                  </> : <>
                    <td colSpan={3} style={{ ...tdStyle(), fontSize: 12, color: 'var(--ink-600)' }}>รวม {rows.length} ใบ</td>
                    <td style={{ ...tdStyle('right'), fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{fmtM(rows.reduce((s, r) => s + (r.actualNet || 0), 0))}</td>
                    <td colSpan={tab === 'extra' ? 2 : 1} />
                  </>}
                </tr>
              </tfoot>
            </table>
          </div>
        )
      }
    </Modal>
  );
}

function PlanVsActualCard({ tone, icon, label, plan, actual, hint, editMode, ovKey, lockedAt, onLock, lockEditable, onClick }) {
  const planK   = ovKey ? `${ovKey}.plan`   : null;
  const actualK = ovKey ? `${ovKey}.actual` : null;
  useOverrideSub(planK || '_');
  useOverrideSub(actualK || '_');
  const planV   = planK   ? WTPOverride.resolve(planK,   plan)   : plan;
  const actualV = actualK ? WTPOverride.resolve(actualK, actual) : actual;
  const pct = planV > 0 ? Math.max(0, Math.min(150, (actualV / planV) * 100)) : 0;
  const gap = actualV - planV;
  const tones = {
    good: { accent: 'var(--good)', bg: 'var(--good-bg)' },
    bad:  { accent: 'var(--bad)',  bg: 'var(--bad-bg)' },
    info: { accent: 'oklch(60% 0.18 295)', bg: 'var(--brand-50)' },
  };
  const t = tones[tone] || tones.info;
  return (
    <div className="card" style={{ padding: cfScale(18), position: 'relative', overflow: 'hidden' }}>
      <div className="kpi-accent" style={{ background: t.accent }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div
          onClick={onClick || undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: cfScale(13), color: 'var(--ink-700)', fontWeight: 600,
            cursor: onClick ? 'pointer' : 'default',
            textDecoration: onClick ? 'underline dotted var(--ink-300)' : 'none',
          }}
          title={onClick ? 'คลิกเพื่อดูรายละเอียด' : undefined}
        >
          {icon && <Icon name={icon} size={15} />}{label}
          {onClick && <span style={{ fontSize: 11, color: 'var(--brand-500)', marginLeft: 2 }}>›</span>}
        </div>
        <Badge kind={pct >= 100 ? 'b-green' : pct >= 50 ? 'b-blue' : 'b-amber'} dot={false}>{pct.toFixed(1)}%</Badge>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: cfScale(14) }}>
        <div>
          <div style={{ fontSize: cfScale(11), color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Plan</div>
          <div style={{ fontSize: cfScale(18), fontWeight: 700, color: 'var(--ink-700)', fontVariantNumeric: 'tabular-nums' }}>
            {planK ? <EditableNumber ovKey={planK} computed={plan} editMode={editMode} digits={0} /> : fmtNum(planV, 0)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: cfScale(11), color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Actual</div>
          <div style={{ fontSize: cfScale(18), fontWeight: 700, color: t.accent, fontVariantNumeric: 'tabular-nums' }}>
            {actualK ? <EditableNumber ovKey={actualK} computed={actual} editMode={editMode} digits={0} /> : fmtNum(actualV, 0)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: cfScale(14) }}>
        <div style={{ height: cfScale(8), background: 'var(--ink-100)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: t.accent, borderRadius: 6, transition: 'width 800ms cubic-bezier(.2,.7,.2,1)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: cfScale(11.5), color: 'var(--ink-500)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
          <span>{hint}</span>
          <span style={{ color: gap >= 0 ? (tone === 'bad' ? 'var(--bad)' : 'var(--good)') : (tone === 'bad' ? 'var(--good)' : 'var(--bad)'), fontWeight: 600 }}>
            {gap >= 0 ? '+' : ''}{fmtNum(gap, 0)}
          </span>
        </div>
      </div>
      {(lockedAt || lockEditable) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: cfScale(12), paddingTop: cfScale(10), borderTop: '1px solid var(--ink-100)', fontSize: 11, color: 'var(--ink-500)' }}>
          <span title="ยอด Plan ถูกจับไว้ตั้งแต่ต้นเดือน — ไม่เปลี่ยนเมื่อรับเงินจริง">
            {lockedAt ? `🔒 ล็อกแผน ${fmtLockedAtInt(lockedAt)}` : '🔓 ยังไม่ได้ล็อกแผนเดือนนี้'}
          </span>
          {lockEditable && onLock && (
            <button className="btn btn-ghost no-present"
              style={{ padding: '1px 8px', fontSize: 11, lineHeight: 1.6 }}
              onClick={onLock}>
              {lockedAt ? 'ล็อกใหม่' : 'ล็อกแผนเดือนนี้'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KpiCompare({ label, forecast, actual, accent, icon }) {
  const pct = forecast > 0 ? (actual / forecast) * 100 : 0;
  return (
    <div className="card" style={{ padding: 14, position: 'relative' }}>
      <div className="kpi-accent" style={{ background: accent }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-600)', fontWeight: 600 }}>
        {icon && <Icon name={icon} size={14} style={{ color: accent }} />} {label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Forecast</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-700)' }}>
            {fmtNum(forecast, 0)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Actual</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: accent }}>
            {fmtNum(actual, 0)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ height: 5, background: 'var(--ink-100)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: accent, transition: 'width 400ms' }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--ink-500)', marginTop: 3, textAlign: 'right' }}>
          {pct.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

function PlanRow({ label, current, rest, total, subtle, negative, carrySigned, onCellClick, editMode, ovKey }) {
  // negative   → outflow (always positive number wrapped in parens)
  // carrySigned→ row may show negative carry-forward without parens (e.g. -2,612,841)
  // onCellClick: (period) => void  — if provided, makes cells clickable for drill-down
  // ovKey      → if provided + editMode, cells become EditableNumber with keys ovKey.current/.rest/.total
  const fmtVal = v => {
    if (v == null || v === 0) return '—';
    if (carrySigned) return fmtNum(v, 0);
    if (negative && v > 0) return `(${fmtNum(v, 0)})`;
    return fmtNum(v, 0);
  };
  const colorFor = v => {
    if (v == null || v === 0) return 'inherit';
    if (carrySigned && v < 0) return 'var(--bad)';
    if (negative) return 'var(--bad)';
    return subtle ? 'var(--ink-500)' : 'inherit';
  };
  const clickable = !!onCellClick && !editMode;  // disable drill in edit mode
  const cellStyle = (val, extra) => ({
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: colorFor(val),
    cursor: clickable && val ? 'pointer' : 'default',
    textDecorationLine: clickable && val ? 'underline' : 'none',
    textDecorationStyle: 'dotted',
    textDecorationColor: 'var(--ink-300)',
    textUnderlineOffset: 3,
    transition: 'background 120ms',
    ...extra,
  });
  const hover = (e, on) => {
    if (!clickable) return;
    e.currentTarget.style.background = on ? 'color-mix(in oklch, var(--brand-500) 12%, transparent)' : '';
  };
  // helper เพื่อแสดงเลขใน cell — edit mode = EditableNumber, ปกติ = ค่าหลัง resolve override
  const renderCell = (val, subKey) => {
    if (!ovKey) return fmtVal(val);
    const key = `${ovKey}.${subKey}`;
    if (editMode) {
      return <EditableNumber ovKey={key} computed={val} editMode={true} digits={0} />;
    }
    let resolved = WTPOverride.resolve(key, val);
    // สำหรับ outflow rows (negative=true): user อาจคีย์เป็นบวกหรือลบก็ได้
    //   normalize เป็น absolute ก่อนโชว์ เพื่อให้ display สอดคล้องกับการคำนวณ
    //   (math ก็ใช้ Math.abs ใน _resolvedOut)
    if (negative) resolved = Math.abs(resolved);
    return (
      <>
        {fmtVal(resolved)}
        {WTPOverride.has(key) && <span title="แก้มือ" style={{ fontSize: 9, marginLeft: 3, color: 'var(--brand-500)' }}>✏️</span>}
      </>
    );
  };
  return (
    <tr>
      <td style={{ paddingLeft: cfScale(24), fontSize: cfScale(16), color: subtle ? 'var(--ink-500)' : 'inherit' }}>{label}</td>
      <td
        onClick={() => clickable && current && onCellClick('current')}
        onMouseEnter={e => hover(e, true)}
        onMouseLeave={e => hover(e, false)}
        title={clickable && current ? 'คลิกเพื่อดูรายการรายตัว' : ''}
        style={cellStyle(current)}>
        {renderCell(current, 'current')}
      </td>
      <td
        onClick={() => clickable && rest && onCellClick('rest')}
        onMouseEnter={e => hover(e, true)}
        onMouseLeave={e => hover(e, false)}
        title={clickable && rest ? 'คลิกเพื่อดูรายการรายตัว' : ''}
        style={cellStyle(rest)}>
        {renderCell(rest, 'rest')}
      </td>
      <td
        onClick={() => clickable && total && onCellClick('total')}
        onMouseEnter={e => hover(e, true)}
        onMouseLeave={e => hover(e, false)}
        title={clickable && total ? 'คลิกเพื่อดูรายการรายตัว' : ''}
        style={cellStyle(total, { fontWeight: 600 })}>
        {renderCell(total, 'total')}
      </td>
    </tr>
  );
}

// ─── Drill-down row — คลิกทั้งบรรทัด = ดูรายละเอียด · ปุ่ม "แก้" = แก้ยอด ───
//   AP/IV/รายการที่เกิดจริง = ดูอย่างเดียว · Forecast (PLANNED) = กดแก้ยอดได้
//   แก้ = กรอก "ขนาด" (magnitude) คงเครื่องหมายเดิม (จ่าย = ลบ, รับ = บวก)
//   ช่องแก้เป็น text + comma (ไม่มีลูกศรเพิ่ม/ลด) พิมพ์เองได้เร็ว
// จัดกลุ่มรายการ drill-down "ชื่อเดียวกัน + วันเดียวกัน" → ย่อเป็น 1 แถว กดกางดูรายย่อย
function groupDrillItems(items) {
  const order = [], map = {};
  (items || []).forEach((it) => {
    const full = String(it.name || '—').trim();
    // ตัด " (เลขที่ AP)" ท้ายชื่อออกก่อนจับกลุ่ม → forecast ของผู้ขายเดียวกันจะรวมกลุ่มได้เหมือน AP
    const groupName = full.replace(/\s*\([^)]*\)\s*$/, '').trim() || full;
    const key = (it.date || '') + '|' + groupName;
    if (!map[key]) { map[key] = { key, name: groupName, date: it.date, items: [] }; order.push(map[key]); }
    map[key].items.push(it);
  });
  return order;
}

/* แถวกลุ่ม (ชื่อ+วันเดียวกัน) ใน drill-down — ย่อ=ยอดรวม · กดกางดูรายย่อย (DrillRow เดิม) */
function DrillGroupRow({ group, onCommit, onView, onTogglePaid, onSetGroupCat }) {
  const [open, setOpen] = cfState(false);
  const total = group.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const src = group.items[0] && group.items[0].source;
  const srcStyle = {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
    background: src === 'AP' ? 'color-mix(in oklch, var(--bad) 14%, transparent)' :
                src === 'IV' ? 'color-mix(in oklch, var(--good) 14%, transparent)' :
                'color-mix(in oklch, var(--brand-500) 14%, transparent)',
    color: src === 'AP' ? 'var(--bad)' : src === 'IV' ? 'var(--good)' : 'var(--brand-700)',
  };
  return (
    <React.Fragment>
      <tr onClick={() => setOpen(o => !o)} title="กดดูรายการย่อย"
        style={{ cursor: 'pointer', background: 'color-mix(in oklch, var(--brand-500) 5%, transparent)' }}>
        <td><span style={srcStyle}>{src}</span></td>
        <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(group.date) || group.date}</td>
        <td style={{ color: 'var(--ink-400)', fontSize: 11 }}>{group.items.length} ใบ</td>
        <td>
          <span style={{ fontSize: 9, color: 'var(--ink-400)', display: 'inline-block', width: 11, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
          <b>{group.name}</b>
        </td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: total < 0 ? 'var(--bad)' : 'var(--good)' }}>
          {fmtNum(total, Number.isInteger(total) ? 0 : 2)}
        </td>
        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          {onSetGroupCat && group.items.some(it => it.feId || it.pvNo || (it.source === 'AP' && it.vchno)) ? (
            <select value={(group.items[0] && group.items[0].cat) || ''} title="เปลี่ยนหมวดทั้งกลุ่มทีเดียว"
              disabled={typeof _wtpRoleIsReadOnly === 'function' && _wtpRoleIsReadOnly()}
              onChange={(e) => { e.stopPropagation(); onSetGroupCat(group.items, e.target.value); }}
              style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--brand-400)', background: 'color-mix(in oklch, var(--brand-500) 6%, white)', maxWidth: 116, fontFamily: 'inherit', cursor: 'pointer' }}>
              {[1, 2, 3, 4].map(n => <option key={n} value={n}>หมวด {n} · {CATEGORY_LABELS_SHORT[n]}</option>)}
            </select>
          ) : (open ? '▴' : '▾')}
        </td>
      </tr>
      {open && group.items.map((it, i) => (
        <DrillRow key={i} item={it} onCommit={onCommit} onView={onView} onTogglePaid={onTogglePaid} />
      ))}
    </React.Fragment>
  );
}

function DrillRow({ item, onCommit, onView, onTogglePaid }) {
  const readOnly = typeof _wtpRoleIsReadOnly === 'function' && _wtpRoleIsReadOnly();
  const editable = item.editable && !readOnly && item.feId;
  const canTogglePaid = item.source === 'AP' && item.vchno && !readOnly && !item.isPaid; // ยังไม่มี PV
  const canUntoggle   = item.source === 'AP' && item.vchno && !readOnly && item.isManualPaid; // manual เท่านั้นที่ถอนได้
  const fmtMag = (a) => { const m = Math.abs(Number(a) || 0); if (!m) return ''; const d = Number.isInteger(m) ? 0 : 2; return m.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const [editing, setEditing] = cfState(false);
  const [hover, setHover]     = cfState(false);
  const [val, setVal]         = cfState(fmtMag(item.amount));
  cfEffect(() => { setVal(fmtMag(item.amount)); }, [item.amount]);

  const sign = Number(item.amount) < 0 ? -1 : 1;
  const save = () => {
    const mag = parseFloat(String(val).replace(/,/g, ''));
    if (isNaN(mag)) { setVal(fmtMag(item.amount)); setEditing(false); return; }
    const signed = sign * Math.abs(mag);
    if (signed !== Number(item.amount)) onCommit(item.feId, signed);
    setEditing(false);
  };
  const cancel = () => { setVal(fmtMag(item.amount)); setEditing(false); };
  const stop = (e) => e.stopPropagation();   // กันไม่ให้คลิกในปุ่ม/ช่องไปเปิด popup

  const srcStyle = {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
    background: item.source === 'AP' ? 'color-mix(in oklch, var(--bad) 14%, transparent)' :
                item.source === 'IV' ? 'color-mix(in oklch, var(--good) 14%, transparent)' :
                'color-mix(in oklch, var(--brand-500) 14%, transparent)',
    color: item.source === 'AP' ? 'var(--bad)' : item.source === 'IV' ? 'var(--good)' : 'var(--brand-700)',
  };
  const miniBtn = (extra) => ({
    padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 6,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--ink-200)',
    background: 'white', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 4, ...extra,
  });

  return (
    <tr
      onClick={() => { if (!editing && onView) onView(item); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={editing ? '' : 'คลิกเพื่อดูรายละเอียด'}
      style={{ cursor: editing ? 'default' : 'pointer',
        background: (!editing && hover) ? 'color-mix(in oklch, var(--brand-500) 7%, transparent)' : '' }}
    >
      <td><span style={srcStyle}>{item.source}</span></td>
      <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(item.date) || item.date}</td>
      <td style={{ fontFamily: 'ui-monospace', fontSize: 11.5, color: 'var(--brand-700)' }}>{item.ref || '—'}</td>
      <td>{item.name}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          color: item.amount < 0 ? 'var(--bad)' : 'var(--good)', fontWeight: 600 }}>
        {editing ? (
          <input
            type="text" inputMode="numeric" autoFocus value={val}
            onClick={stop}
            onChange={e => {
              const digits = e.target.value.replace(/[^\d]/g, '');
              setVal(digits ? Number(digits).toLocaleString('en-US') : '');
            }}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
            style={{ width: 110, padding: '3px 8px',
              borderWidth: '1.5px', borderStyle: 'solid', borderColor: 'var(--brand-400)', borderRadius: 6,
              background: 'color-mix(in oklch, var(--brand-500) 6%, white)', textAlign: 'right',
              fontFamily: 'ui-monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 'inherit', color: 'inherit' }}
          />
        ) : fmtNum(item.amount, Number.isInteger(item.amount) ? 0 : 2)}
      </td>
      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={editing ? stop : undefined}>
        {editing ? (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button type="button" onClick={(e) => { stop(e); save(); }} title="บันทึก"
              style={miniBtn({ borderColor: 'var(--good)', color: 'var(--good)' })}>✓ บันทึก</button>
            <button type="button" onClick={(e) => { stop(e); cancel(); }} title="ยกเลิก"
              style={miniBtn({ borderColor: 'var(--ink-300)', color: 'var(--ink-500)' })}>✕</button>
          </span>
        ) : editable ? (
          <button type="button" onClick={(e) => { stop(e); setEditing(true); }} title="แก้ยอดประมาณการ"
            style={miniBtn({ borderColor: 'var(--brand-400)', color: 'var(--brand-700)' })}>✏️ แก้</button>
        ) : canTogglePaid ? (
          <button type="button" onClick={(e) => { stop(e); if (onTogglePaid) onTogglePaid(item.vchno); }} title="ทำเครื่องหมายว่าจ่ายแล้ว (ยังไม่มี PV)"
            style={miniBtn({ borderColor: 'var(--good)', color: 'var(--good)', background: 'color-mix(in oklch, var(--good) 8%, white)' })}>✅ จ่ายแล้ว</button>
        ) : canUntoggle ? (
          <button type="button" onClick={(e) => { stop(e); if (onTogglePaid) onTogglePaid(item.vchno); }} title="ยกเลิกเครื่องหมาย — กลับเข้าประมาณการ"
            style={miniBtn({ borderColor: 'var(--ink-400)', color: 'var(--ink-500)' })}>↩ ยกเลิก</button>
        ) : (
          <span style={{ color: 'var(--ink-300)', fontSize: 14 }}>›</span>
        )}
      </td>
    </tr>
  );
}

Object.assign(window, { CashFlowDashboard });
