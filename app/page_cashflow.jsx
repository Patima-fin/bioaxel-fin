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

// ─── AP-PV match (filter out paid AP) ─────────────────────────────────────
function buildPaidVchnoSet(pvVouchers) {
  const set = new Set();
  (pvVouchers || []).forEach(pv => { if (pv.AP_No) set.add(pv.AP_No); });
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

// ─── Main page ─────────────────────────────────────────────────────────────
function CashFlowDashboard({ data, setData, toast }) {
  const today = new Date();
  const [year, setYear]   = cfState(today.getFullYear());
  const [month, setMonth] = cfState(today.getMonth() + 1);
  const [editMode, setEditMode] = cfState(false);  // Manual override mode
  useOverrideSubAny();  // re-render หน้าทุกครั้งที่ override เปลี่ยน (sum/total/% ใช้ค่าใหม่)

  // Drill-down popup: { title, rows, kind } where kind ∈ {iv, loan, ap, fe, mixed}
  const [drillDown, setDrillDown] = cfState(null);
  // Per-item detail popup (ซ้อนบน drill-down) — เก็บ item ที่กด "ดู"
  const [detailItem, setDetailItem] = cfState(null);
  // โหมดช่องรายจ่าย Section 01: 'remaining' = ประมาณการตั้งมือ − จ่ายจริง (เดิม)
  //   'apPlan' = แผนจ่ายจริง = รายการ AP ที่เลือกจ่าย (ขึ้น CARD BANK) + รายการตั้งมือที่ติ๊กรวมเอง
  //   เก็บไว้ต่อเครื่อง (localStorage) — เป็น view preference ส่วนตัว ไม่ sync ทีม
  const [s01OutMode, setS01OutMode] = cfState(() => {
    try { return localStorage.getItem('bio-cf-s01outmode') === 'apPlan' ? 'apPlan' : 'remaining'; }
    catch (_) { return 'remaining'; }
  });
  const setS01OutModePersist = (m) => {
    setS01OutMode(m);
    try { localStorage.setItem('bio-cf-s01outmode', m); } catch (_) {}
  };
  // ขอบเขตของโหมด 'apPlan': 'month' = ตั้งแต่สัปดาห์ปัจจุบันถึงสิ้นเดือน (เดิม) | 'week' = เฉพาะสัปดาห์ปัจจุบัน
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
      // จัดหมวด: override ราย PV (cf.pvCat) > AP ที่ผูก > vendor/keyword — ต้องตรงกับ drill-down (openActualDrill)
      const ap = pv.AP_No ? (payables.find(p => p.vchno === pv.AP_No) || null) : null;
      const cat = resolvePvCategory(pv, ap);
      const amt = Number(pv.Net_Amount || pv.Amount || 0);
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
      const cat = categorizeForecastEntry(fe);
      grid[wIdx][cat] += Math.abs(amt);
    });
    return grid;
  }, [pvVouchers, payables, forecastEntries, ovTick, weeks, year, month]);

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

  // ════ โหมด "แผนจ่ายจริง (AP)" สำหรับ Section 01 ช่องรายจ่าย ════════════════════
  //   หลักๆ = รายการ AP ที่เลือกจ่ายไว้แล้วจากหน้า Bank Diary (ขึ้น CARD BANK)
  //   + รายการตั้งมือที่ผู้ใช้ติ๊กเลือกรวมเอง (cf.sec1Inc.<id>) — กันนับซ้ำกับ Section 02
  // ── paidApSet: เลขที่ AP ที่จ่ายจริงผ่าน PV แล้ว (PV.AP_No) → ตัด AP-plan ที่จ่ายแล้วออก ──
  const paidApSet = cfMemo(() => {
    const s = new Set();
    pvVouchers.forEach(pv => { if (pv.AP_No) s.add(String(pv.AP_No).trim()); });
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
  //   'week' = เฉพาะสัปดาห์ปัจจุบัน (สัปดาห์อื่น = 0 → คอลัมน์ "สัปดาห์ที่เหลือ"/total ไม่นับ) · 'month' = เต็มเหมือนเดิม
  const apPlanScopedByWeekCat = cfMemo(() =>
    s01ApScope === 'week'
      ? apPlanCombinedByWeekCat.map((g, i) => i === nowWeek ? g : { 1: 0, 2: 0, 3: 0, 4: 0 })
      : apPlanCombinedByWeekCat,
    [apPlanCombinedByWeekCat, s01ApScope, nowWeek]);

  // ── IV PLAN lock — baseline "คาดรับ" ที่ freeze ตั้งแต่วันที่ 1 ของเดือน ──
  //   ovTick กระตุ้น recompute เมื่อ override (จาก cloud/user อื่น) เปลี่ยน
  const ivPlanLock = cfMemo(() => readIvPlanLock(ovPrefix), [ovPrefix, ovTick, year, month]);

  // ── Inflow: IV project receipts (forecast + actual) ───────────────────
  const ivInflowByWeek = cfMemo(() => {
    const liveForecast = weeks.map(() => 0);
    const actual       = weeks.map(() => 0);
    const bySafe       = {};   // sanitized ivNo → live IV (ไว้เช็คสถานะรับเงิน)
    invoices.forEach(iv => {
      const net = ivNetExpected(iv, financeByCode);
      const s = sanitizeIvKey(iv.ivNo || iv.IV_NO || iv.invoiceNo); if (s) bySafe[s] = iv;
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
    let iv = 0, loan = 0;
    const out = { 1: 0, 2: 0, 3: 0, 4: 0 };
    invoices.forEach(ivRow => {
      // ลูกหนี้คงค้างทุกใบที่ยังไม่ได้รับเงิน — เดียวกับ logic main
      if (ivIsPaid(ivRow)) return;
      if (ivRow.expectedReceive && inMonth(ivRow.expectedReceive, nextYear, nextMonth)) {
        iv += ivNetExpected(ivRow, financeByCode);
      }
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
  }, [isLastWeekOfMonth, invoices, forecastEntries, year, month]);

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
  const _outGrid     = s01OutMode === 'apPlan' ? apPlanScopedByWeekCat : forecastRemainingByWeekCat;
  const _outRollover = s01OutMode === 'apPlan' ? { 1: 0, 2: 0, 3: 0, 4: 0 } : nextMonthInflow.out;
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
          ['ยอด', fmtNum(Math.abs(amt), 2) + ' ฿'],
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
    if (row && row.indexOf('out') === 0 && s01OutMode === 'apPlan') {
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
              ['ยอดแผน (freeze ต้นเดือน)', fmtNum(it.net, 0) + ' ฿'],
              ['คาดรับสุทธิ ณ ตอนนี้', iv ? fmtNum(liveNet, 0) + ' ฿' : '—'],
              ['รับจริงแล้ว', (paid && ad) ? `${fmtNum(liveNet, 0)} ฿ (${fmtDate(ad)})` : 'ยังไม่รับ'],
              ['สถานะปัจจุบัน', statusTxt],
            ],
          });
        });
        // สัปดาห์สุดท้าย: คอลัมน์ "ที่เหลือ/TOTAL" โชว์ตัวอย่างเดือนถัดไป (ยังไม่ถูกล็อก)
        if (isLastWk && (period === 'rest' || period === 'total')) {
          const nyY = month === 12 ? year + 1 : year;
          const nyM = month === 12 ? 1 : month + 1;
          invoices.forEach(iv => {
            if (ivIsPaid(iv)) return;
            if (!iv.expectedReceive || !inMonth(iv.expectedReceive, nyY, nyM)) return;
            items.push({
              source: 'IV',
              date: toISODate(iv.expectedReceive),
              name: iv.projectName || iv.PROJECT_NAME || iv.customer || '—',
              ref: iv.ivNo || iv.IV_NO || iv.invoiceNo || '',
              amount: ivNetExpected(iv, financeByCode),
              note: 'เดือนถัดไป (ยังไม่ล็อก)',
              detail: [
                ['เลขที่ IV', iv.ivNo || iv.IV_NO || iv.invoiceNo || '—'],
                ['วันคาดรับ', fmtDate(iv.expectedReceive) || '—'],
                ['คาดรับสุทธิ', fmtNum(ivNetExpected(iv, financeByCode), 0) + ' ฿'],
                ['หมายเหตุ', 'แผนเดือนถัดไป — ยังไม่ถูกล็อก'],
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
              ['ยอดคงค้าง', fmtNum(Number(iv.balance) || 0, 0) + ' ฿'],
              ['คาดรับสุทธิ (หัก WHT/หนี้)', fmtNum(ivNetExpected(iv, financeByCode), 0) + ' ฿'],
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
            ['ยอดประมาณการ', fmtNum(Math.abs(amt), 0) + ' ฿'],
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
            ['ยอดประมาณการ', fmtNum(Math.abs(amt), 0) + ' ฿'],
            ['หมวด', `${cat} · ${CATEGORY_LABELS_SHORT[cat] || '—'}`],
            ['สถานะ', status || 'PLANNED'],
            ['บัญชี', fe.Bank_AC || '—'],
            ['หมายเหตุ', fe.NOTE || '—'],
          ],
        });
      });
    }

    // สรุปยอดช่องรายจ่าย: ประมาณการเต็ม − จ่ายจริงแล้ว = คงเหลือ (ตรงกับตัวเลขในช่องของตาราง)
    let outRecon = null;
    if (row && row.startsWith('out')) {
      const cat = Number(row.slice(3));
      const fF = currentRestSplit(forecastByWeekCat.map(g => g[cat] || 0),         nextMonthInflow.out[cat]);
      const fA = currentRestSplit(pvActualByWeekCat.map(g => g[cat] || 0),          0);
      const fR = currentRestSplit(forecastRemainingByWeekCat.map(g => g[cat] || 0), nextMonthInflow.out[cat]);
      outRecon = { forecast: fF[period], actual: fA[period], remaining: fR[period] };
    }

    // Sort by date ascending
    items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    setDrillDown({ title: label, period, row, items, outRecon });
  };

  // ─── Drill-down ฝั่ง "จ่ายจริง" (Actual) ราย week×cat ──────────────────────
  //   แสดงรายการจริงที่ประกอบเป็นยอด Actual ของช่องนั้น — mirror logic ของ
  //   pvActualByWeekCat เป๊ะ (PV + Forecast ACTUAL/BOOKED + AP ที่ทำเครื่องหมายจ่ายเอง)
  //   เพื่อให้ผลรวมในรายการ = ตัวเลขในช่องเสมอ
  //   cat = null → รวมทุกหมวดในสัปดาห์นั้น (ใช้กับยอด "Total Paid")
  const openActualDrill = (weekIdx, cat, label) => {
    const wantCat = (c) => cat == null || c === cat;
    const items = [];
    // 1) PV vouchers — เงินออกจริงตาม Pmt_Date
    pvVouchers.forEach(pv => {
      const date = pv.Pmt_Date;
      if (!inMonth(date, year, month)) return;
      if (findWeekIdx(date, weeks) !== weekIdx) return;
      const ap = pv.AP_No ? (payables.find(p => p.vchno === pv.AP_No) || null) : null;
      const c = resolvePvCategory(pv, ap);
      if (!wantCat(c)) return;
      const amt = Number(pv.Net_Amount || pv.Amount || 0);
      items.push({
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
          ['ยอดก่อนหัก', fmtNum(Number(pv.Amount) || 0, 2) + ' ฿'],
          ['WHT', fmtNum(Number(pv.WHT) || 0, 2) + ' ฿'],
          ['VAT', fmtNum(Number(pv.Vat) || 0, 2) + ' ฿'],
          ['ยอดจ่ายสุทธิ', fmtNum(Math.abs(amt), 2) + ' ฿'],
          ['บัญชีธนาคาร', pv.Bank_AC || '—'],
          ['ประเภทการจ่าย', pv.Type_of_Pmt || '—'],
          ['หมายเหตุ', pv.cc_remark || '—'],
        ],
      });
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
      // รายการที่บันทึกจ่ายจริงผ่านหน้ากระทบยอด (BANK_RECON) → ป้าย "STM" ไม่ใช่ "Forecast" (มันคือจ่ายจริง ไม่ใช่ประมาณการ)
      const isRecon = String(fe.EXPENSE_TYPE || '').toUpperCase() === 'BANK_RECON';
      items.push({
        source: isRecon ? 'STM' : 'Forecast', date,
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
          ['ยอดจ่ายจริง', fmtNum(Math.abs(amt), 2) + ' ฿'],
          ['สถานะ', isRecon ? `${status} · กระทบยอด` : status],
          ['บัญชี', fe.Bank_AC || '—'],
          ['หมายเหตุ', fe.NOTE || '—'],
        ],
      });
    });
    items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    setDrillDown({ title: label, mode: 'actual', row: 'actual', weekIdx, cat, items });
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
          ['ยอดประมาณการ', fmtNum(Math.abs(amt), 2) + ' ฿'],
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
    if (item.source === 'Forecast' && item.feId) {
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
      if (it.source === 'Forecast' && it.feId) feIds.add(it.feId);
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
                @page { size: A4 landscape; margin: 8mm 10mm; }
                html, body { background: #f4f7fb !important; }
              }
            `;
            document.body.classList.add('cf-print-mode');
            const cleanup = () => {
              document.body.classList.remove('cf-print-mode');
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

        {/* ── ขวา — คาดการณ์สิ้นเดือน อันใหญ่ ── */}
        <BalanceCard
          big
          tone={strategicNet < 0 ? 'bad' : 'good'}
          label="คาดการณ์สิ้นเดือน (Strategic)"
          value={strategicNet}
          editMode={editMode}
          ovKey={`${ovPrefix}.strategic`}
          hint={
            (strategicNet < 0 ? '⚠️ ติดลบ · ' : '') +
            `B/F ${fmtNum(monthBFAvailable, 0)} + IV ${fmtNum(ivForecast, 0)} + เงินกู้ ${fmtNum(loanForecast, 0)} − ค่าใช้จ่าย ${fmtNum(outflowForecast, 0)}`
          }
          icon={strategicNet < 0 ? 'arrow_down' : 'arrow_up'}
        />
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
                สัปดาห์ที่เหลือ
                <div style={{ fontSize: cfScale(10), color: 'var(--ink-500)', fontWeight: 400 }}>
                  รวม {weeks.length - nowWeek - 1} สัปดาห์
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
                    <span style={{ fontWeight: 500, fontSize: cfScale(11.5), color: 'var(--ink-500)', marginLeft: cfScale(8) }}>
                      {s01OutMode === 'apPlan'
                        ? <span>· <strong>แผนจ่ายจริง</strong> = รายการ AP ที่เลือกจ่าย (CARD BANK) + ตั้งมือที่ติ๊กรวม{s01ApScope === 'week' ? <span> · <strong>เฉพาะสัปดาห์นี้</strong></span> : ''}</span>
                        : <span>· ยอด<strong>คงเหลือต้องจ่าย</strong> (หักที่จ่ายจริงแล้ว)</span>}
                    </span>
                  </div>
                  {/* ปุ่มสลับโหมด/ขอบเขต — ซ่อนในโหมดนำเสนอ (no-present) + ไม่ติดใน PNG capture (data-no-capture) */}
                  <div data-no-capture="1" className="no-present" style={{ display: 'inline-flex', alignItems: 'center', gap: cfScale(8), flexShrink: 0, flexWrap: 'wrap' }}>
                    {s01OutMode === 'apPlan' && (
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
                      {[['remaining', 'ประมาณการคงเหลือ'], ['apPlan', 'แผนจ่ายจริง (AP)']].map(opt => (
                        <button key={opt[0]} type="button" onClick={() => setS01OutModePersist(opt[0])}
                          title={opt[0] === 'apPlan' ? 'รายการ AP ที่เลือกจ่ายไว้แล้ว (ขึ้น CARD BANK หน้า Bank Diary) + รายการตั้งมือที่ติ๊กรวมเอง' : 'ประมาณการตั้งมือ − จ่ายจริงแล้ว = ยอดคงเหลือต้องจ่าย'}
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
                          {editMode
                            ? <EditableNumber ovKey={`${cellOv}.actual`} computed={aRaw} editMode={true} digits={0} />
                            : (a > 0
                                ? (<span
                                     onClick={() => openActualDrill(i, cat, `จ่ายจริง · WEEK ${i + 1} · ${CATEGORY_LABELS_SHORT[cat]}`)}
                                     title="คลิกดูรายการจ่ายจริงของหมวดนี้"
                                     style={{ cursor: 'pointer', borderBottom: '1.5px dashed var(--brand-300)' }}>
                                    {fmtNum(a, 0)}
                                    {aOver && <span title="แก้มือ" style={{ fontSize: cfScale(8), marginLeft: 2, color: 'var(--brand-500)' }}>✏️</span>}
                                  </span>)
                                : <span style={{ color: 'var(--ink-300)' }}>-</span>)}
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
                          {over ? '▲ เกินแผน' : '▼ เหลือ'} ฿{fmtNum(Math.abs(diff), 0)}
                        </span>
                      );
                    })()}
                  </div>
                  <span style={{ fontSize: cfScale(17), fontWeight: 800, color: 'var(--brand-600)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>
                    {editMode
                      ? <EditableNumber ovKey={`${cellOvWeek}.total.actual`} computed={actualTotalRaw} editMode={true} digits={0} />
                      : (actualTotal > 0
                          ? (<span
                               onClick={() => openActualDrill(i, null, `จ่ายจริง · WEEK ${i + 1} · ทุกหมวด`)}
                               title="คลิกดูรายการจ่ายจริงทั้งสัปดาห์"
                               style={{ cursor: 'pointer', borderBottom: '2px dashed var(--brand-300)' }}>
                              {fmtNum(actualTotal, 0)}
                              {actualTotalOver && <span title="แก้มือ" style={{ fontSize: cfScale(9), marginLeft: 3, color: 'var(--brand-500)' }}>✏️</span>}
                            </span>)
                          : <span style={{ color: 'var(--ink-300)', fontWeight: 700 }}>–</span>)}
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
          background: 'linear-gradient(150deg, var(--brand-500) 0%, var(--brand-800) 100%)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* แสงเรืองมุมบนขวา — เพิ่มมิติ ไม่ให้ดูแบนจืด */}
          <div style={{ position: 'absolute', right: cfScale(-40), top: cfScale(-50), width: cfScale(190), height: cfScale(190), borderRadius: '50%', background: 'radial-gradient(circle, rgba(41,197,255,.28), transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', padding: `${cfScale(22)} ${cfScale(20)}`, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', gap: cfScale(15) }}>
            {/* โซนบน — หัวข้อ + ไอคอนในกรอบ */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: cfScale(8) }}>
              <div>
                <div style={{ fontSize: cfScale(15.5), fontWeight: 800, letterSpacing: '.01em', lineHeight: 1.15 }}>Grand Totals Actual</div>
                <div style={{ fontSize: cfScale(11), color: 'rgba(255,255,255,.78)', marginTop: cfScale(3) }}>เทียบกับงบประมาณการรวมทั้งเดือน</div>
              </div>
              <span style={{ display: 'grid', placeItems: 'center', width: cfScale(38), height: cfScale(38), borderRadius: cfScale(11), background: 'rgba(255,255,255,.18)', color: '#eaffff', flex: 'none' }}><Icon name="chart" size={20} /></span>
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
                  background: 'linear-gradient(90deg, #5fe0ff, #b8f4ff)', transition: 'width 800ms',
                  boxShadow: '0 0 18px color-mix(in oklch, #5fe0ff 70%, transparent)', borderRadius: cfScale(8),
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
                <div style={{ fontSize: cfScale(18), fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#cdf3ff', marginTop: cfScale(3) }}>{fmtNum(remaining / 1e6, 2)}M</div>
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
          <li>สัปดาห์สุดท้ายของเดือน → คอลัมน์ "สัปดาห์ที่เหลือ" = ประมาณการ<strong>เดือนถัดไป</strong></li>
        </ul>
        )}
      </div>

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
                          <th style={{ width: 120, textAlign: 'right' }}>จำนวน (฿)</th>
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
                          <th style={{ width: 120, textAlign: 'right' }}>จำนวน (฿)</th>
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
          })() : drillDown.items.length === 0 ? (
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
                    {fmtNum(Math.abs(drillDown.items.reduce((s, x) => s + x.amount, 0)), 2)} ฿
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
                      <th style={{ width: 130, textAlign: 'right' }}>{drillDown.mode === 'forecast' ? 'ประมาณการ (฿)' : 'จ่ายจริง (฿)'}</th>
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
            </>
          ) : (
            <>
              {drillDown.outRecon ? (
                /* ── ช่องรายจ่าย: ประมาณการเต็ม − จ่ายจริงแล้ว = คงเหลือต้องจ่าย (= ตัวเลขในช่อง) ── */
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                  <div style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--ink-50)', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ประมาณการเต็ม</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink-700)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtNum(drillDown.outRecon.forecast, 0)}</div>
                  </div>
                  <div style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--good-bg)', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>− จ่ายจริงแล้ว</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--good)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtNum(drillDown.outRecon.actual, 0)}</div>
                  </div>
                  <div style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--warn-bg)', textAlign: 'center', border: '1.5px solid color-mix(in oklch, var(--warn) 40%, transparent)' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-600)', fontWeight: 600 }}>= คงเหลือต้องจ่าย</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--warn)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtNum(drillDown.outRecon.remaining, 0)}</div>
                  </div>
                </div>
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
                    {fmtNum(drillDown.items.reduce((s, x) => s + x.amount, 0), 0)} ฿
                  </div>
                </div>
              </div>
              )}
              {drillDown.outRecon && (
                <div style={{ fontSize: 11, color: 'var(--ink-500)', margin: '-4px 0 12px', lineHeight: 1.6 }}>
                  💡 รายการด้านล่าง = <strong>ประมาณการเต็ม</strong>ของช่วงนี้ · ส่วนที่ <strong>จ่ายจริงแล้ว</strong> ({fmtNum(drillDown.outRecon.actual, 0)} ฿) ดูรายตัวได้ที่หัวข้อ <strong>02 ติดตามจ่ายจริง</strong> (คลิกยอด Actual)
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
                        <th style={{ width: 140, textAlign: 'right' }}>จำนวน (฿)</th>
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
            </>
          )}
        </Modal>
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
              {fmtNum(detailItem.amount, Number.isInteger(detailItem.amount) ? 0 : 2)} ฿
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

function PlanVsActualCard({ tone, icon, label, plan, actual, hint, editMode, ovKey, lockedAt, onLock, lockEditable }) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: cfScale(13), color: 'var(--ink-700)', fontWeight: 600 }}>
          {icon && <Icon name={icon} size={15} />}{label}
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
