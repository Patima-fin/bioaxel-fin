// BIOAXEL — งบกำไรขาดทุน (P&L) · separate add-on page.
// Reads the "ฐาน DATA" sheet tab (via WTPData.fetchSheetRows) and computes the
// income statement entirely in-browser. Upload flow posts a NEW additive Apps
// Script action ('plImportMonth') — it never touches existing endpoints.
//
// Globals reused from the app shell: React, Icon, Modal, KpiTile, fmtNum,
// useToasts, WTPData, WTP_CONFIG, XLSX.
//
// ── Canonical "ฐาน DATA" schema this page expects (1 row per GL account) ──
//   group : one of PL_GROUP_ORDER keys (saleGoods, otherIncome,
//           cogs, selling, admin, finance)   ← โครงสร้าง BIO (6 กลุ่ม · ขาย+บริการรวม)
//   code  : รหัสบัญชี (GL / ac_code)
//   name  : ชื่อบัญชี
//   m1..m12 : ยอดรายเดือน (number) ของปีบัญชีนั้น
//   (optional) type : ป้าย TYPE เต็ม (ใช้แทน group ได้ — จะ map กลับเป็น group)
//   (optional) year : ปีบัญชี (พ.ศ.)
// ถ้ายังไม่มี column `group`/`type` → ระบบจะเดากลุ่มจาก prefix ของ code
// ถ้าอ่านชีตไม่ได้/ว่าง → แสดงข้อมูลตัวอย่าง (badge "ตัวอย่าง") เพื่อให้เห็น UI

const { useState: plState, useEffect: plEffect, useMemo: plMemo, useRef: plRef } = React;

const PL_SHEET = 'pnlBase';   // ตาราง Supabase (ย้ายจาก Google Sheet "ฐาน DATA")

const PL_MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const PL_MONTHS_TH_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

// 6 TYPE labels — ตรงกับบรรทัดในงบ BIO (index = ลำดับใน PL_GROUP_ORDER)
// โครงสร้าง BIO (label สั้นแบบ POG): รายได้ขาย+บริการรวมบรรทัดเดียว / รายได้อื่น − ต้นทุนขาย
//   = ขั้นต้น − (ขาย + บริหาร + การเงิน รวมเป็น "รวมค่าใช้จ่ายขายและบริหาร" ยอดเดียวแบบ POG) = สุทธิ
const PL_TYPES = [
  'รายได้จากการขายและบริการ (Revenue from sales and services)',
  'รายได้อื่น (Other income)',
  'ต้นทุนขาย (Cost of goods sold)',
  'ค่าใช้จ่ายในการขาย (Selling expenses)',
  'ค่าใช้จ่ายในการบริหาร (Administrative expenses)',
  'ต้นทุนทางการเงิน (Finance costs)',
];

const PL_GROUP_ORDER = ['saleGoods','otherIncome','cogs','selling','admin','finance'];

const PL_GROUP_META = {
  saleGoods:   { line: 'Revenue from sales and services', th: 'รายได้จากการขายและบริการ',  type: 0 },
  otherIncome: { line: 'Other income',                    th: 'รายได้อื่น',                type: 1 },
  cogs:        { line: 'Cost of goods sold',              th: 'ต้นทุนขาย',                 type: 2 },
  selling:     { line: 'Selling expenses',                th: 'ค่าใช้จ่ายในการขาย',        type: 3 },
  admin:       { line: 'Administrative expenses',         th: 'ค่าใช้จ่ายในการบริหาร',      type: 4 },
  finance:     { line: 'Finance costs',                   th: 'ต้นทุนทางการเงิน',          type: 5 },
};
const PL_TYPE_TO_GROUP = {};
PL_GROUP_ORDER.forEach(k => { PL_TYPE_TO_GROUP[PL_TYPES[PL_GROUP_META[k].type]] = k; });

// inline style ของปุ่มใน hero banner (สำหรับ "ผังการจัดกลุ่ม / บันทึกรูป / พิมพ์")
const pnlHeroBtn = {
  background: 'rgba(255,255,255,0.15)', color: 'white',
  border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8,
  padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 5,
};

// ── ปีบัญชี + งบประมาณ ──
// ปีบัญชี (พ.ศ.) อ่านจาก header ของไฟล์ PL ที่อัป (date-serial) — fallback 2569
const PL_YEAR_DEFAULT = 2569;
// BIO ยังไม่มีไฟล์งบประมาณรายปี → PL_BUDGET = null → ซ่อนส่วน "เทียบงบประมาณ"
// (เมื่อมีเป้าจริง ใส่ออบเจ็กต์ { revenue, totalCost, grossProfit, totalSGA, netProfit } ที่นี่)
const PL_BUDGET = null;

// ── Optional per-account override (โดยปกติว่าง — BIO ใช้ prefix ล้วน) ──
// ใส่เฉพาะบัญชีที่ prefix เดาผิด (rare). key = รหัสบัญชี (มี/ไม่มีขีดก็ได้)
const PL_KNOWN_ACCOUNTS = {
  // '4120-99': 'otherIncome',   // ตัวอย่าง: ถ้ามีรหัสที่ต้องบังคับกลุ่มเอง
};

const PL_REVENUE_KEYS = { saleGoods: 1, otherIncome: 1 };
const PL_isRevenue = (key) => !!PL_REVENUE_KEYS[key];

// ── number helpers (ported from design — parentheses for negatives) ──
function PL_sum(arr, n) { let s = 0; const lim = (n == null ? arr.length : n); for (let i = 0; i < lim; i++) s += (arr[i] || 0); return s; }
function PL_addArr(a, b) { return a.map((v, i) => (v || 0) + (b[i] || 0)); }
function PL_fmt(v, opt) {
  opt = opt || {};
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (opt.blankZero && Math.abs(v) < 0.005) return '—';
  const neg = v < 0;
  const dec = (opt.dec === undefined) ? 2 : opt.dec;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return neg ? '(' + s + ')' : s;
}
function PL_fmtPct(v, opt) {
  opt = opt || {};
  if (v === null || v === undefined || isNaN(v) || !isFinite(v)) return '—';
  const neg = v < 0;
  const s = Math.abs(v).toFixed(opt.dec === undefined ? 1 : opt.dec) + '%';
  return neg ? '(' + s + ')' : s;
}
const PL_negCls = (v) => (typeof v === 'number' && v < 0) ? ' pnl-neg' : '';

// ── infer group from BIO chart-of-accounts code prefix ──
// BIO รหัส = NNNN-NN (เช่น 4110-01). จัดกลุ่มจาก 2 หลักแรก — ตรวจกับงบจริง
// ม.ค.–พ.ค. 2569: ทุก subtotal (รายได้/ต้นทุนขาย/ขาย/บริหาร/การเงิน) ตรงถึงหลักสตางค์
//   41xx          → รายได้จากการขายและบริการ (saleGoods)  [ขาย+บริการ รวมกลุ่มเดียว ไม่แยก]
//   42xx / 44xx   → รายได้อื่น (otherIncome)            [รายได้อื่น/ส่วนลดรับ/ดอกเบี้ยรับ]
//   51xx          → ต้นทุนขาย (cogs)
//   52xx          → ค่าใช้จ่ายในการขาย (selling)
//   53xx/54xx/55xx→ ค่าใช้จ่ายในการบริหาร (admin)        [รวมค่าเสื่อม 5410 / ตัดจำหน่าย 5420 / FX 5500]
//   71xx / 72xx   → ต้นทุนทางการเงิน (finance)          [ดอกเบี้ยจ่าย / ดบ.เช่าซื้อ]
// ── สินค้า/วัตถุดิบคงเหลือ ต้นงวด/ปลายงวด (บรรทัด "ไม่มีรหัสบัญชี" ในงบ) ──
// งบ BIO คิดต้นทุนขาย = สต๊อกต้นงวด + ซื้อ/ผลิต − สต๊อกปลายงวด → บรรทัดสต๊อกพวกนี้
// ต้องนับรวมในต้นทุนขายด้วย (ไม่งั้นต้นทุนขายต่ำกว่างบจริง) + กดดูรายละเอียดได้เหมือนบัญชีอื่น
// สังเคราะห์รหัส (id) คงที่จากชื่อ → re-import ไฟล์เดิมได้ id เดิม (upsert ทับ ไม่ซ้ำแถว)
function PL_invCode(name) {
  const n = String(name || '');
  let mat = 'OTH';
  if (/วัตถุดิบ/.test(n)) mat = 'RM';            // วัตถุดิบคงเหลือ
  else if (/วัสด/.test(n)) mat = 'SUP';          // วัสดุสิ้นเปลือง (สะกดได้หลายแบบ)
  else if (/สำเร็จรูป/.test(n)) mat = 'FG';       // สินค้าสำเร็จรูป
  else if (/สินค้า/.test(n)) mat = 'GOODS';
  const phase = /ต้นงวด/.test(n) ? 'OPEN' : (/ปลายงวด/.test(n) ? 'CLOSE' : 'X');
  return 'INV-' + mat + '-' + phase;
}
const PL_isInvCode = (code) => /^INV-/i.test(String(code || '').trim());
const PL_isInvName = (name) => /ต้นงวด|ปลายงวด/.test(String(name || ''));
// ยอด "สะสม" ของบรรทัดสต๊อก = ต้นงวดของงวด (เดือนแรกที่มีค่า) / ปลายงวด (เดือนสุดท้าย)
// — ไม่ใช่ผลรวมรายเดือน (สต๊อกยกมาแต่ละเดือนเป็น roll-forward) ให้ตรงคอลัมน์ "รวม" ในงบจริง
function PL_invTotal(code, arr, lastMonth) {
  const a = arr || [];
  const lim = lastMonth || a.length;
  if (/-CLOSE$/i.test(code)) { for (let i = lim - 1; i >= 0; i--) if (Math.abs(a[i] || 0) > 0.005) return a[i]; return 0; }
  if (/-OPEN$/i.test(code))  { for (let i = 0; i < lim; i++)      if (Math.abs(a[i] || 0) > 0.005) return a[i]; return 0; }
  return PL_sum(a, lim);
}

function PL_inferGroup(code, name) {
  const raw = String(code || '').trim();
  const c = raw.replace(/[^0-9]/g, '');
  const n = String(name || '');
  // สต๊อกต้นงวด/ปลายงวด (ไม่มีรหัส) หรือรหัสสังเคราะห์ INV- → รวมเป็นต้นทุนขาย
  if (PL_isInvName(n) || PL_isInvCode(raw)) return 'cogs';
  if (!c) return null;
  // override รายตัว (ถ้ามี) — รองรับทั้งมี/ไม่มีขีด
  if (PL_KNOWN_ACCOUNTS[raw]) return PL_KNOWN_ACCOUNTS[raw];
  if (PL_KNOWN_ACCOUNTS[c]) return PL_KNOWN_ACCOUNTS[c];
  // บัญชีพัก / งบดุล — ไม่อยู่ในงบกำไรขาดทุน
  if (/ตั้งพัก|พักรอ|suspense|clearing/i.test(n)) return null;
  const p2 = c.slice(0, 2), p3 = c.slice(0, 3);
  // รายได้ — ขาย+บริการ รวมเป็นกลุ่มเดียว (BIO ไม่แยก)
  if (p2 === '41') return 'saleGoods';
  if (p2 === '42' || p2 === '44') return 'otherIncome';
  // ต้นทุน / ค่าใช้จ่าย
  if (p2 === '51') return 'cogs';
  if (p2 === '52') return 'selling';
  if (p2 === '53' || p2 === '54' || p2 === '55') return 'admin';
  if (p2 === '71' || p2 === '72') return 'finance';
  // เผื่อผังบัญชีขยายในอนาคต (fallback แบบอนุรักษ์)
  const first = c[0];
  if (first === '4') return 'otherIncome';
  if (first === '7') return /ดอกเบี้ย|interest|เช่าซื้อ|กู้ยืม|ค่าธรรมเนียมธนาคาร|bank\s*fee/i.test(n) ? 'finance' : 'admin';
  if (first === '5' || first === '6') return 'admin';
  return null;
}

// แปลงวันที่จากชีต "ต้นทุน" → DD/MM/YYYY (ค.ศ.) — รองรับ serial / "27/01/69" (พ.ศ. 2 หลัก) / พ.ศ. เต็ม
function PL_costDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + d.getUTCFullYear();
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2500;     // "69" → 2569 (พ.ศ.)
    if (y > 2400) y -= 543;     // พ.ศ. → ค.ศ.
    return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y;
  }
  return s;
}

// Sample data (design mock) — used ONLY when ฐาน DATA can't be read yet.
const PL_SAMPLE = {
  year: 2569,
  lastMonth: 5,
  groups: {
    saleGoods:   [1384990, 49027, 175387, 9295629, 6761256, 0,0,0,0,0,0,0],
    otherIncome: [    867,  1367,   1501,    4846,     550, 0,0,0,0,0,0,0],
    cogs:        [1733121, 238010, 615942, 8085423, 5237102, 0,0,0,0,0,0,0],
    selling:     [ 554800,1036142, 638341,  788332,  244113, 0,0,0,0,0,0,0],
    admin:       [2868640,3227749,3374152, 2812765, 2158410, 0,0,0,0,0,0,0],
    finance:     [ 971198, 868800,1001539,  733157,  638892, 0,0,0,0,0,0,0],
  },
};

// ── parse ฐาน DATA rows → { groups:{key:[12]}, accounts:{key:[{code,name,arr}]}, lastMonth } ──
function PL_parseRows(rows) {
  const empty = () => PL_GROUP_ORDER.reduce((o, k) => (o[k] = [0,0,0,0,0,0,0,0,0,0,0,0], o), {});
  const groups = empty();
  const accounts = PL_GROUP_ORDER.reduce((o, k) => (o[k] = [], o), {});
  if (!Array.isArray(rows) || !rows.length) return null;

  // discover month columns from the header keys of the first row
  const keys = Object.keys(rows[0] || {});
  const monthCol = new Array(12).fill(null);
  for (let i = 0; i < 12; i++) {
    const cands = ['m' + (i + 1), 'M' + (i + 1), String(i + 1), PL_MONTHS_TH[i]];
    let found = keys.find(k => cands.indexOf(String(k).trim()) >= 0);
    if (!found) found = keys.find(k => String(k).trim().indexOf(PL_MONTHS_TH[i]) === 0); // "ม.ค. 2569"
    monthCol[i] = found || null;
  }
  const hasAnyMonth = monthCol.some(c => c != null);
  if (!hasAnyMonth) return null;

  // locate group/code/name columns (tolerant to header naming)
  // ลำดับใน list สำคัญ — ตัวแรกที่เจอชนะ (เพื่อให้ ac_code ชนะ maincode เป็นต้น)
  const findKey = (names) => {
    for (const n of names) {
      const f = keys.find(k => String(k).trim().toLowerCase() === n);
      if (f) return f;
    }
    return undefined;
  };
  const gKey = findKey(['group', 'กลุ่ม']);
  const tKey = findKey(['type', 'ประเภท', 'ชนิด']);
  const cKey = findKey(['ac_code', 'code', 'รหัสบัญชี', 'รหัส', 'maincode']);
  const nKey = findKey(['ac_des', 'ชื่อบัญชี', 'name', 'description', 'desc', 'รายการ']);
  const sKey = findKey(['seq', 'ord', 'order', 'ลำดับ']);   // ลำดับแถวในไฟล์ Excel (ไว้เรียงรายละเอียด)

  let used = 0;
  rows.forEach(r => {
    const code = cKey ? r[cKey] : '';
    const nameLkp0 = nKey ? r[nKey] : '';
    // บัญชีพัก / งบดุล ไม่อยู่ในงบกำไรขาดทุน — กันออกแม้ group ที่เก็บไว้จะเป็น admin
    // (เช่น 7900002 ลูกหนี้-เจ้าหนี้ ตั้งพัก ที่ค้างจาก import เก่า)
    const codeNum = String(code || '').replace(/[^0-9]/g, '');
    if (codeNum.slice(0, 2) === '79' || /ตั้งพัก|พักรอ|suspense|clearing/i.test(String(nameLkp0))) return;
    let g = gKey ? String(r[gKey] || '').trim() : '';
    if (!PL_GROUP_META[g]) g = '';
    if (!g && tKey) { const lbl = String(r[tKey] || '').trim(); g = PL_TYPE_TO_GROUP[lbl] || ''; }
    const nameLkp = nKey ? r[nKey] : '';
    if (!g) g = PL_inferGroup(code, nameLkp);
    if (!g || !PL_GROUP_META[g]) return; // unclassifiable → skip

    // อ่านค่าจาก ฐาน DATA ตามจริง — ไม่ flip sign เพราะ expense อาจมี cost reversal
    // ที่ legitimate เป็นค่าลบ (เช่น 5140001 POC ตอนกลับรายการ) ที่ต้อง "ลดต้นทุน"
    const arr = monthCol.map(col => {
      if (!col) return 0;
      const raw = r[col];
      if (raw == null || raw === '') return 0;
      const num = Number(String(raw).replace(/[^0-9.\-]/g, ''));
      return isNaN(num) ? 0 : num;
    });
    if (arr.every(v => v === 0) && (code == null || code === '')) return; // blank row
    groups[g] = PL_addArr(groups[g], arr);
    const seqVal = sKey != null ? Number(r[sKey]) : NaN;
    accounts[g].push({ code: String(code || ''), name: String((nKey ? r[nKey] : '') || ''), arr, seq: isNaN(seqVal) ? undefined : seqVal });
    used++;
  });
  if (!used) return null;

  let lastMonth = 0;
  for (let m = 0; m < 12; m++) {
    if (PL_GROUP_ORDER.some(k => Math.abs(groups[k][m]) > 0.005)) lastMonth = m + 1;
  }
  // ปีบัญชี (พ.ศ.) — อ่านจาก field year ของแถวที่อัปไว้ (ถ้ามี)
  let year = 0;
  const yKey = findKey(['year', 'ปี', 'ปีบัญชี']);
  if (yKey) { for (const r of rows) { const y = Number(r[yKey]); if (y) { year = y; break; } } }
  return { groups, accounts, lastMonth: lastMonth || 1, year: year || 0 };
}

// ── compute subtotals (โครงสร้าง BIO · label/รวม แบบ POG) ──
// รายได้(ขาย+บริการ + อื่น) − ต้นทุนขาย = ขั้นต้น − (ขาย+บริหาร+การเงิน) = สุทธิ
function PL_compute(d, lastMonth) {
  const totalRevenue  = PL_addArr(d.saleGoods, d.otherIncome);   // ขาย+บริการ รวมใน saleGoods แล้ว
  // ต้นทุนขาย = COGS อย่างเดียว (BIO ไม่มี cost of service / commission แยกบรรทัด)
  const totalCost     = d.cogs.slice();
  const grossProfit   = totalRevenue.map((v, i) => v - totalCost[i]);
  const gpMargin      = grossProfit.map((v, i) => totalRevenue[i] ? (v / totalRevenue[i] * 100) : NaN);
  // รวมค่าใช้จ่ายขายและบริหาร = ขาย + บริหาร + การเงิน (รวมยอดเดียวแบบ POG)
  const totalSGA      = PL_addArr(PL_addArr(d.selling, d.admin), d.finance);
  const netProfit     = grossProfit.map((v, i) => v - totalSGA[i]);
  // % กำไรสุทธิต่อรายได้ (net margin) รายงวด
  const netMargin     = netProfit.map((v, i) => totalRevenue[i] ? (v / totalRevenue[i] * 100) : NaN);
  return { totalRevenue, totalCost, grossProfit, gpMargin, totalSGA, netProfit, netMargin };
}

// ═══════════ ส่วนวิเคราะห์ P&L (ชาร์ต + คะแนนสุขภาพ + CFO Insight) — พอร์ตจาก finance-tools ═══════════
const PL_ANAL_PALETTE = ['#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#22c55e', '#ec4899', '#14b8a6'];
// interpolate คะแนนจากจุดเกณฑ์ (piecewise-linear) — พอร์ต finScoreLinear
function PL_scoreLinear(v, pts) {
  if (v <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) { const [v0, s0] = pts[i], [v1, s1] = pts[i + 1]; if (v <= v1) return s0 + (s1 - s0) * (v - v0) / (v1 - v0); }
  return pts[pts.length - 1][1];
}

// combo chart: แท่งรายได้ + แท่งค่าใช้จ่าย + เส้นกำไรสุทธิ (SVG ล้วน)
function PLComboChart({ months, rev, exp, net }) {
  // viewBox aspect (~1.9:1) ให้ตรงกับพื้นที่จริงในการ์ด + สูงอัตโนมัติตามความกว้าง → เนื้อหาเต็มกรอบ ไม่ letterbox
  const W = 460, padL = 40, padR = 12, padT = 34, padB = 30, height = 242;
  const n = Math.max(1, months.length);
  const innerW = W - padL - padR, innerH = height - padT - padB;
  const lo = Math.min(0, ...net), hi = Math.max(1, ...rev, ...exp, ...net), span = (hi - lo) || 1;
  const yv = (v) => padT + (1 - (v - lo) / span) * innerH;
  const band = innerW / n, bw = Math.min(26, band * 0.4);
  const cx = (i) => padL + band * i + band / 2;
  const y0 = yv(0);
  const kf = (v) => { const a = Math.abs(v); if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (a >= 1e3) return Math.round(v / 1e3) + 'K'; return String(Math.round(v)); };
  const netPts = net.map((v, i) => cx(i) + ',' + yv(v)).join(' ');
  return (
    <svg viewBox={'0 0 ' + W + ' ' + height} width="100%" style={{ display: 'block', height: 'auto' }}>
      <line x1={padL} y1={y0} x2={W - padR} y2={y0} stroke="#cbd5e1" strokeDasharray="3 3" />
      {months.map((_, i) => (
        <g key={i}>
          <rect x={cx(i) - bw - 1.5} y={Math.min(yv(rev[i]), y0)} width={bw} height={Math.abs(yv(rev[i]) - y0)} rx={3} fill="#3b82f6" />
          <rect x={cx(i) + 1.5} y={Math.min(yv(exp[i]), y0)} width={bw} height={Math.abs(yv(exp[i]) - y0)} rx={3} fill="#cbd5e1" />
        </g>
      ))}
      {/* ตัวเลขบนหัวแท่ง รายได้ (น้ำเงิน) + ค่าใช้จ่าย (เทา) */}
      {months.map((_, i) => (
        <g key={'v' + i}>
          {Math.abs(rev[i]) > 0.5 && <text x={cx(i) - bw / 2 - 1.5} y={yv(rev[i]) - 4} fontSize="10" textAnchor="middle" fill="#2563eb" fontWeight="700" style={{ fontVariantNumeric: 'tabular-nums' }}>{kf(rev[i])}</text>}
          {Math.abs(exp[i]) > 0.5 && <text x={cx(i) + bw / 2 + 1.5} y={yv(exp[i]) - 4} fontSize="10" textAnchor="middle" fill="#64748b" fontWeight="600" style={{ fontVariantNumeric: 'tabular-nums' }}>{kf(exp[i])}</text>}
        </g>
      ))}
      <polyline points={netPts} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinejoin="round" />
      {net.map((v, i) => <circle key={i} cx={cx(i)} cy={yv(v)} r={3.5} fill="#fff" stroke="#ef4444" strokeWidth="2" />)}
      {months.map((mo, i) => <text key={i} x={cx(i)} y={height - 9} fontSize="12" textAnchor="middle" fill="#94a3b8">{mo}</text>)}
      {net.map((v, i) => <text key={i} x={cx(i)} y={yv(v) - 9} fontSize="11" textAnchor="middle" fill="#dc2626" fontWeight="600" style={{ fontVariantNumeric: 'tabular-nums' }}>{kf(v)}</text>)}
    </svg>
  );
}

// แถวคะแนนย่อย (คลิกกางดูสูตร) ในการ์ดคะแนนสุขภาพ
function PLHealthRow({ s }) {
  const [open, setOpen] = plState(false);
  const dt = s.detail || {};
  const hdRow = { display: 'flex', gap: 10, padding: '2px 0' }, hdK = { color: '#94a3b8', minWidth: 96, flexShrink: 0 };
  // เกณฑ์ให้คะแนน = ชิปจุดเกณฑ์ (ค่า → คะแนน) + ไฮไลต์ช่วงที่ค่าปัจจุบันตกอยู่
  const fmtBT = (t, unit) => unit === '%' ? Math.round(t * 100) + '%' : (t.toFixed(t % 1 === 0 ? 1 : 2) + ' เท่า');
  const renderBands = (band) => {
    const { pts, value, unit } = band;
    let loIdx = -1, hiIdx = -1;
    if (value != null && !isNaN(value)) {
      if (value <= pts[0][0]) { loIdx = hiIdx = 0; }
      else if (value >= pts[pts.length - 1][0]) { loIdx = hiIdx = pts.length - 1; }
      else { for (let i = 0; i < pts.length - 1; i++) { if (value >= pts[i][0] && value <= pts[i + 1][0]) { loIdx = i; hiIdx = i + 1; break; } } }
    }
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {pts.map((p, i) => {
            const on = i === loIdx || i === hiIdx;
            return (
              <span key={i} style={{ fontSize: 10.5, padding: '2px 9px', borderRadius: 8, border: '1px solid ' + (on ? '#6366f1' : '#e2e8f0'), background: on ? '#eef2ff' : '#fff', color: on ? '#4338ca' : '#94a3b8', fontWeight: on ? 700 : 500, whiteSpace: 'nowrap', boxShadow: on ? '0 1px 4px rgba(99,102,241,0.18)' : 'none' }}>
                {fmtBT(p[0], unit)} <span style={{ opacity: 0.5 }}>→</span> {p[1]}
              </span>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 5 }}>
          คะแนนเป็นสเกลไล่ระยะ 0–100 (ยิ่งสูงยิ่งได้คะแนนมาก) — ไม่ใช่ผ่าน/ไม่ผ่าน
          {value != null && !isNaN(value)
            ? <> · <b style={{ color: '#4338ca' }}>ค่าปัจจุบัน {fmtBT(value, unit)} → คะแนน {s.score}</b></>
            : ' · ยังไม่มีข้อมูลงบแสดงฐานะการเงิน (ใช้คะแนนกลาง 50)'}
        </div>
      </div>
    );
  };
  return (
    <div style={{ borderBottom: '1px solid #f1f5f9' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 34px 74px', alignItems: 'center', gap: 10, padding: '8px 2px', cursor: 'pointer', fontSize: 12.5 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#334155', fontWeight: 600 }}>
          <span style={{ width: 12, color: '#94a3b8', fontSize: 10 }}>{open ? '▾' : '▸'}</span>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />{s.name}
        </span>
        <span style={{ height: 8, borderRadius: 5, background: '#f1f5f9', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: s.score + '%', background: s.color, borderRadius: 5 }} /></span>
        <span style={{ fontWeight: 800, color: '#0f172a', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
        <span style={{ color: s.color, fontWeight: 700, fontSize: 11, textAlign: 'right' }}>{s.label}</span>
      </div>
      {open && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: '10px 12px', margin: '2px 0 8px', fontSize: 12 }}>
          <div style={hdRow}><span style={hdK}>ตัวชี้วัด</span><span style={{ color: '#334155' }}>{dt.metric}</span></div>
          <div style={hdRow}><span style={hdK}>สูตร</span><span style={{ fontFamily: 'ui-monospace, monospace', color: '#334155' }}>{dt.formula}</span></div>
          {(dt.inputs || []).filter(x => x.value != null).map((x, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0 2px 96px', color: '#475569' }}><span>{x.label}</span><b style={{ fontVariantNumeric: 'tabular-nums', color: '#0f172a' }}>{PL_fmt(x.value)}</b></div>
          ))}
          <div style={hdRow}><span style={hdK}>ผลลัพธ์</span><b style={{ color: '#2e8b4a' }}>{dt.result}</b></div>
          <div style={{ ...hdRow, alignItems: 'flex-start' }}><span style={hdK}>เกณฑ์ให้คะแนน</span>{dt.band ? renderBands(dt.band) : <span style={{ color: '#64748b' }}>{dt.bands}</span>}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e2e8f0', color: '#94a3b8', fontSize: 11 }}><span>📄</span><span>ที่มา: {dt.src} · ถ่วงน้ำหนัก {Math.round((s.weight || 0) * 100)}% ของคะแนนรวม</span></div>
        </div>
      )}
    </div>
  );
}

// คำนวณคะแนนสุขภาพการเงิน 5 มิติ — ใช้ร่วมทั้งหน้า P&L และงบฐานะ (global)
// inp: { rev, net, gross, opex, revA, bal:{ca,cl,tl,ta,eq} } → { overall, subs, gcol, gstat }
function PL_buildHealth(inp) {
  const rev = inp.rev, net = inp.net, gross = inp.gross, opex = inp.opex, revA = inp.revA || [], bal = inp.bal || {};
  const netMargin = net / (rev || 1), opexRatio = opex / (rev || 1);
  const growth = (revA.length >= 2 && revA[0]) ? (revA[revA.length - 1] - revA[0]) / Math.abs(revA[0]) : 0;
  const ca = bal.ca, cl = bal.cl, tl = bal.tl, ta = bal.ta, eq = bal.eq;
  const debtRatio = (tl != null && ta) ? tl / ta : null;
  const ptsProf = [[-0.5, 5], [-0.2, 20], [0, 45], [0.05, 68], [0.15, 92]];
  const ptsGrow = [[-0.5, 10], [0, 50], [0.3, 75], [0.8, 90], [1.5, 97]];
  const ptsEff = [[0.2, 95], [0.4, 75], [0.6, 55], [0.9, 32], [1.5, 12]];
  const ptsRisk = [[0.3, 90], [0.6, 65], [1, 42], [2, 20], [4, 8]];
  const sProf = PL_scoreLinear(netMargin, ptsProf);
  const sGrow = PL_scoreLinear(growth, ptsGrow);
  const sEff = PL_scoreLinear(opexRatio, ptsEff);
  let sRisk = debtRatio != null ? PL_scoreLinear(debtRatio, ptsRisk) : 50;
  if (eq != null && eq < 0) sRisk = Math.min(sRisk, 12);
  const m0 = revA[0], m1 = revA[revA.length - 1];
  const subs = [
    { name: 'ความสามารถทำกำไร', score: Math.round(sProf), weight: 0.35, detail: { metric: 'อัตรากำไรสุทธิ (Net Margin)', formula: 'กำไร(ขาดทุน)สุทธิ ÷ รายได้รวม', inputs: [{ label: 'กำไร(ขาดทุน)สุทธิ', value: net }, { label: 'รายได้รวม', value: rev }], result: (netMargin * 100).toFixed(1) + '%', src: 'งบกำไรขาดทุน', band: { pts: ptsProf, value: netMargin, unit: '%' } } },
    { name: 'การเติบโต', score: Math.round(sGrow), weight: 0.20, detail: { metric: 'การเติบโตของรายได้ (เดือนแรก → เดือนล่าสุด)', formula: '(รายได้เดือนล่าสุด − รายได้เดือนแรก) ÷ รายได้เดือนแรก', inputs: [{ label: 'รายได้เดือนล่าสุด', value: m1 }, { label: 'รายได้เดือนแรก', value: m0 }], result: (growth * 100).toFixed(0) + '%', src: 'งบกำไรขาดทุน (รายเดือน)', band: { pts: ptsGrow, value: growth, unit: '%' } } },
    { name: 'ประสิทธิภาพ', score: Math.round(sEff), weight: 0.20, detail: { metric: 'สัดส่วนค่าใช้จ่ายขายและบริหารต่อรายได้ (OPEX Ratio)', formula: 'รวมค่าใช้จ่ายขายและบริหาร ÷ รายได้รวม', inputs: [{ label: 'รวมค่าใช้จ่ายขายและบริหาร', value: opex }, { label: 'รายได้รวม', value: rev }], result: (opexRatio * 100).toFixed(0) + '%', src: 'งบกำไรขาดทุน', band: { pts: ptsEff, value: opexRatio, unit: '%', lowerBetter: true } } },
    { name: 'ความเสี่ยง', score: Math.round(sRisk), weight: 0.25, detail: { metric: 'อัตราส่วนหนี้สินต่อสินทรัพย์ (Debt Ratio)', formula: 'หนี้สินรวม ÷ สินทรัพย์รวม', inputs: [{ label: 'รวมหนี้สิน', value: tl }, { label: 'รวมสินทรัพย์', value: ta }].concat((eq != null && eq < 0) ? [{ label: 'ส่วนของผู้ถือหุ้น (ติดลบ = เสี่ยงสูง)', value: eq }] : []), result: debtRatio != null ? debtRatio.toFixed(2) + ' เท่า' + ((eq != null && eq < 0) ? ' · ส่วนของผู้ถือหุ้นติดลบ' : '') : '—', src: 'งบแสดงฐานะการเงิน', band: { pts: ptsRisk, value: debtRatio, unit: 'เท่า', lowerBetter: true } } },
  ];
  subs.forEach(s => { s.label = s.score >= 70 ? 'ดี' : s.score >= 45 ? 'เฝ้าระวัง' : 'ต้องดำเนินการ'; s.color = s.score >= 70 ? '#22c55e' : s.score >= 45 ? '#f59e0b' : '#ef4444'; });
  const overall = Math.round(sProf * 0.35 + sRisk * 0.25 + sGrow * 0.20 + sEff * 0.20);
  const gcol = overall >= 70 ? '#22c55e' : overall >= 45 ? '#f59e0b' : '#ef4444';
  const gstat = overall >= 70 ? 'ดี' : overall >= 45 ? 'เฝ้าระวัง' : 'ต้องดำเนินการ';
  return { overall, subs, gcol, gstat };
}

// การ์ดคะแนนสุขภาพการเงิน (เกจ /100 + คะแนนย่อย 5 มิติ) — ใช้ร่วมทั้ง P&L และงบฐานะ (global)
function PLHealthCard({ overall, subs, gcol, gstat }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.05)', padding: 16, display: 'grid', gridTemplateColumns: 'minmax(200px, 240px) 1fr', gap: 18, alignItems: 'start', marginBottom: 14 }}>
      <div style={{ textAlign: 'center', padding: '6px 4px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>คะแนนสุขภาพทางการเงิน</div>
        <div style={{ width: 150, height: 150, borderRadius: '50%', margin: '0 auto', background: 'conic-gradient(' + gcol + ' ' + (overall * 3.6) + 'deg, #e2e8f0 0)', display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 112, height: 112, borderRadius: '50%', background: 'white', display: 'grid', placeItems: 'center' }}>
            <div><span style={{ fontSize: 34, fontWeight: 800, color: '#0f172a' }}>{overall}</span><span style={{ fontSize: 13, color: '#94a3b8' }}>/100</span></div>
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: gcol, color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />{gstat}</div>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>คะแนนย่อยรายมิติ <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>🖱️ คลิกแต่ละมิติเพื่อดูสูตร + ตัวเลขที่ใช้</span></div>
        <div style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 6px' }}>คำนวณจากงบกำไรขาดทุน + งบแสดงฐานะการเงิน · คะแนนรวม = ถ่วงน้ำหนัก (ทำกำไร 35% · ความเสี่ยง 25% · เติบโต 20% · ประสิทธิภาพ 20%)</div>
        {subs.map((s, i) => <PLHealthRow key={i} s={s} />)}
      </div>
    </div>
  );
}

// กล่องวิเคราะห์ P&L ทั้งหมด: 4 ชาร์ต + คะแนนสุขภาพ + CFO Insight
function PLAnalytics({ c, groups, model, lastMonth, bal }) {
  const cardBox = { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.05)', padding: 16 };
  const cardH = { fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 10 };
  const nMon = lastMonth || 1;
  const months = PL_MONTHS_TH.slice(0, nMon);
  const revA = c.totalRevenue.slice(0, nMon), netA = c.netProfit.slice(0, nMon);
  const expA = revA.map((v, i) => v - netA[i]);
  const rev = PL_sum(c.totalRevenue, nMon), net = PL_sum(c.netProfit, nMon), gross = PL_sum(c.grossProfit, nMon);
  const cogs = PL_sum(groups.cogs, nMon), sell = PL_sum(groups.selling, nMon), adm = PL_sum(groups.admin, nMon), fin = PL_sum(groups.finance, nMon);
  const opex = sell + adm;
  // หมวดค่าใช้จ่าย (donut)
  const catDefs = [
    { name: 'ต้นทุนขาย', total: cogs }, { name: 'ค่าใช้จ่ายในการขาย', total: sell },
    { name: 'ค่าใช้จ่ายในการบริหาร', total: adm }, { name: 'ต้นทุนทางการเงิน', total: fin },
  ];
  const grand = catDefs.reduce((s, x) => s + x.total, 0) || 1;
  const cats = catDefs.map((x, i) => ({ name: x.name, total: x.total, color: PL_ANAL_PALETTE[i], pct: x.total / grand }))
    .filter(x => Math.abs(x.total) > 0.01).sort((a, b) => b.total - a.total);
  const donutData = cats.map(x => ({ label: x.name, value: x.total, valueLabel: (x.pct * 100).toFixed(0) + '%', color: x.color }));
  // บัญชีรายตัว (accts) + ตัวกรองสต็อก/สินค้าคงเหลือ — ใช้กับ Pareto แหล่งรายได้/สัดส่วนค่าใช้จ่าย
  const accts = (model && model.accounts) || {};
  // สต็อก/สินค้าคงเหลือ (ต้นงวด/ปลายงวด) ในสูตรต้นทุนขาย = ไม่ใช่ค่าใช้จ่ายจริง → ตัดออกจากมุมมองรายบัญชี
  const PL_isStock = (n) => /ต้นงวด|ปลายงวด|คงเหลือ|สำเร็จรูป|ระหว่างผลิต|ระหว่างทำ|สต็อก|stock|inventory/i.test(String(n || ''));
  // Pareto: แหล่งรายได้ (บัญชีรายได้) + สัดส่วนค่าใช้จ่าย (4 หมวด)
  const revIcon = (n) => /ดอกเบี้ย/.test(n) ? '💰' : (/บริการ|จัดส่ง|ขนส่ง/.test(n) ? '🚚' : (/platform|แพลตฟอร์ม/i.test(n) ? '🖥️' : (/ส่วนลด/.test(n) ? '🏷️' : (/ขาย/.test(n) ? '🛒' : '💵'))));
  const revItems = [];
  ['saleGoods', 'otherIncome'].forEach(g => (accts[g] || []).forEach(a => { const v = PL_sum(a.arr, nMon); if (Math.abs(v) > 0.5) revItems.push({ name: a.name || a.code, value: v, icon: revIcon(String(a.name || '')) }); }));
  // สัดส่วนค่าใช้จ่าย = รายบัญชี (ไม่ใช่ 4 กลุ่มใหญ่ · ตัดสต็อก/สินค้าคงเหลือออก) เรียงมาก→น้อย · ไอคอนตามกลุ่มของบัญชี
  const expGIcon = { cogs: '📦', selling: '🏷️', admin: '🏢', finance: '🏦' };
  const expItems = [];
  ['cogs', 'selling', 'admin', 'finance'].forEach(g => (accts[g] || []).forEach(a => { if (PL_isStock(a.name)) return; const v = PL_sum(a.arr, nMon); if (Math.abs(v) > 0.5) expItems.push({ name: a.name || a.code, value: v, icon: expGIcon[g] }); }));
  // คะแนนสุขภาพ
  const netMargin = net / (rev || 1), grossMargin = gross / (rev || 1), opexRatio = opex / (rev || 1);
  const growth = (revA.length >= 2 && revA[0]) ? (revA[revA.length - 1] - revA[0]) / Math.abs(revA[0]) : 0;
  const { ca, cl, tl, ta, eq } = bal;
  const curRatio = (ca != null && cl) ? ca / cl : null, debtRatio = (tl != null && ta) ? tl / ta : null;
  const H = PL_buildHealth({ rev, net, gross, opex, revA, bal });
  const m0 = revA[0], m1 = revA[revA.length - 1];
  // CFO Insight
  const f = (v) => PL_fmt(v), pc = (v) => (v * 100).toFixed(1) + '%';
  const top = cats[0];
  const eqNeg = eq != null && eq < 0;
  const B = [];
  B.push({ t: 'good', x: 'รายได้รวม ' + f(rev) + ' บาท' + (m0 != null ? ' (' + months[0] + ' ' + f(m0) + ' → ล่าสุด ' + f(m1) + ')' : '') });
  B.push({ t: 'good', x: 'กำไรขั้นต้น ' + f(gross) + ' บาท คิดเป็นอัตรา ' + pc(grossMargin) });
  if (top) B.push({ t: 'bad', x: top.name + ' ' + f(top.total) + ' บาท คิดเป็น ' + pc(top.pct) + ' ของค่าใช้จ่าย' });
  B.push({ t: net < 0 ? 'bad' : 'good', x: (net < 0 ? 'ขาดทุน' : 'กำไร') + 'สุทธิ ' + f(net) + ' บาท อัตรา ' + pc(netMargin) });
  if (eqNeg) B.push({ t: 'bad', x: 'ส่วนของผู้ถือหุ้นติดลบ ' + f(eq) + ' บาท' + (debtRatio ? ' · Debt Ratio ' + debtRatio.toFixed(2) + ' เท่า' : '') });
  if (fin > 0.01) B.push({ t: 'warn', x: 'ต้นทุนทางการเงิน (ดอกเบี้ยจ่าย) ' + f(fin) + ' บาท กดดันกระแสเงินสด' });
  const Rc = [];
  if (opexRatio > 0.5) Rc.push('คุมค่าใช้จ่ายขายและบริหาร — ปัจจุบัน ' + (opexRatio * 100).toFixed(0) + '% ของรายได้ · ตั้งเพดานค่าโฆษณาไม่เกิน ~25% ของยอดขาย');
  if (net < 0) Rc.push('เร่งหาจุดคุ้มทุน — เพิ่มรายได้หรือลดค่าใช้จ่ายให้กำไรก่อนต้นทุนการเงินเป็นบวก');
  if (eqNeg) Rc.push('ปรับโครงสร้างทุน — พิจารณาแปลงเงินกู้กรรมการ/ในเครือเป็นทุน (debt-to-equity) เพื่อแก้ส่วนผู้ถือหุ้นติดลบ');
  if (curRatio != null && curRatio < 1.2) Rc.push('ดูแลสภาพคล่อง — สินทรัพย์หมุนเวียนต่อหนี้สินหมุนเวียน ' + curRatio.toFixed(2) + ' เท่า · เร่งเก็บลูกหนี้');
  if (!Rc.length) Rc.push('รักษาโมเมนตัม — คุมต้นทุนและขยายรายได้ต่อเนื่อง');
  let summary = 'บริษัทมีรายได้รวม ' + f(rev) + ' บาท '
    + (growth > 0.05 ? 'เติบโต ' + (growth * 100).toFixed(0) + '% จากต้นงวด ' : growth < -0.05 ? 'ลดลง ' + (Math.abs(growth) * 100).toFixed(0) + '% จากต้นงวด ' : '')
    + 'และกำไรขั้นต้นที่ ' + (grossMargin * 100).toFixed(0) + '% ';
  const bico = (t) => {
    const cc = t === 'good' ? '#059669' : (t === 'bad' ? '#dc2626' : '#d97706');
    const cm = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: cc, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flexShrink: 0, marginTop: 2 } };
    if (t === 'good') return <svg {...cm}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
    if (t === 'warn') return <svg {...cm}><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>;
    return <svg {...cm}><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>;
  };
  const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 14 };
  return (
    <>
      <div className="pnl-section-head" style={{ marginTop: 22 }}>
        <h2>📈 วิเคราะห์ผลประกอบการ (Charts & Analytics)</h2>
        <span className="pnl-tag">รายเดือน · โครงสร้างค่าใช้จ่าย · สุขภาพการเงิน · สรุปผู้บริหาร</span>
      </div>
      <div style={gridStyle}>
        <ParetoBreakdown title="แหล่งรายได้" titleEn="Revenue Sources" sub="สัดส่วนต่อรายได้รวม · เรียงมาก→น้อย · แสดง 3 อันดับแรก · กดดูที่เหลือ"
          items={revItems} palette={['#10b981', '#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#14b8a6']} />
        <ParetoBreakdown title="สัดส่วนค่าใช้จ่าย" titleEn="Expense Breakdown" sub="รายบัญชี · ต่อค่าใช้จ่ายทั้งหมด · เรียงมาก→น้อย · แสดง 3 อันดับแรก · กดดูที่เหลือ"
          items={expItems} palette={['#ef4444', '#8b5cf6', '#3b82f6', '#06b6d4', '#f59e0b', '#14b8a6']} />
      </div>
      <div style={gridStyle}>
        <div style={cardBox}>
          <div style={cardH}>รายได้ · ค่าใช้จ่าย · กำไรสุทธิ รายเดือน</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6, fontSize: 11, color: '#64748b' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#3b82f6', marginRight: 5 }} />รายได้</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#cbd5e1', marginRight: 5 }} />ค่าใช้จ่าย</span>
            <span><span style={{ display: 'inline-block', width: 14, height: 3, background: '#ef4444', marginRight: 5, verticalAlign: 'middle' }} />กำไร/ขาดทุนสุทธิ</span>
          </div>
          <PLComboChart months={months} rev={revA} exp={expA} net={netA} />
        </div>
        <div style={cardBox}>
          <div style={cardH}>โครงสร้างค่าใช้จ่ายทั้งหมด</div>
          {donutData.length ? <Donut size={170} thickness={22} data={donutData} animate={false} /> : <div style={{ color: '#94a3b8', fontSize: 12 }}>ไม่มีข้อมูลค่าใช้จ่าย</div>}
        </div>
      </div>
      {/* คะแนนสุขภาพการเงิน */}
      <PLHealthCard overall={H.overall} subs={H.subs} gcol={H.gcol} gstat={H.gstat} />
      {/* CFO Insight */}
      <div style={{ background: 'linear-gradient(180deg,#f8fafc,#fff)', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>✨</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>สรุปเชิงผู้บริหาร (CFO Insight)</div>
            <div style={{ fontSize: 11.5, color: '#94a3b8' }}>วิเคราะห์จากงบการเงินจริง · ชี้ความเสี่ยงและข้อเสนอแนะ</div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: '#6366f1', background: '#eef2ff', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>Auto Generated</span>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.7, color: '#1e293b', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
          บริษัทมีรายได้รวม <b>{f(rev)}</b> บาท {growth > 0.05 ? 'เติบโต ' + (growth * 100).toFixed(0) + '% จากต้นงวด ' : growth < -0.05 ? 'ลดลง ' + (Math.abs(growth) * 100).toFixed(0) + '% จากต้นงวด ' : ''}และกำไรขั้นต้นที่ <b>{(grossMargin * 100).toFixed(0)}%</b> {net < 0
            ? <>แต่ยัง<b style={{ color: '#dc2626' }}>ขาดทุนสุทธิ {f(net)}</b> บาท{top ? ' จาก' + top.name + 'และค่าใช้จ่ายที่สูงเกินรายได้' : ''}</>
            : <>และทำ<b style={{ color: '#059669' }}>กำไรสุทธิ {f(net)}</b> บาท</>}
          {eqNeg && <> · จุดที่ต้องเร่งแก้คือ<b>ส่วนของผู้ถือหุ้นติดลบ {f(eq)}</b> บาท</>}.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '8px 18px', marginBottom: 14 }}>
          {B.map((x, i) => <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#334155', lineHeight: 1.5 }}>{bico(x.t)}<span>{x.x}</span></div>)}
        </div>
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 800, color: '#92400e', marginBottom: 8 }}>💡 ข้อเสนอแนะเชิงบริหาร</div>
          {Rc.map((r, i) => <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12.5, color: '#334155', lineHeight: 1.6, marginBottom: 6 }}><span style={{ flexShrink: 0, width: 19, height: 19, borderRadius: '50%', background: '#f59e0b', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span><span>{r}</span></div>)}
        </div>
      </div>
    </>
  );
}

// ── การ์ด KPI แบบย่อ (คลิก "ดูรายละเอียด" เพื่อกางกล่องแหล่งที่มา/สูตร/อ้างอิง) ──
function PLKpiCard({ kpi, s }) {
  const [open, setOpen] = plState(false);
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 13, border: '1px solid #e2e8f0', borderTop: '3px solid ' + s.accent, boxShadow: '0 1px 3px rgba(15,23,42,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: s.bg, display: 'grid', placeItems: 'center', fontSize: 15, flexShrink: 0 }}>{kpi.icon}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>{kpi.label}</div>
            <div style={{ fontSize: 9.5, color: '#94a3b8' }}>{kpi.en}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: s.accent, letterSpacing: '-0.5px', lineHeight: 1 }}>{PL_fmtPct(kpi.value)}</div>
          <span style={{ display: 'inline-flex', alignItems: 'center', background: s.bg, color: s.accent, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12 }}>{s.txt}</span>
        </div>
      </div>
      <button onClick={() => setOpen(o => !o)} style={{ alignSelf: 'flex-start', background: 'none', border: 0, cursor: 'pointer', color: '#64748b', fontSize: 10.5, fontWeight: 600, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {open ? 'ซ่อนรายละเอียด ▴' : 'ดูรายละเอียด · แหล่งที่มา ▾'}
      </button>
      {open && (
        <div style={{ background: '#f8fafc', border: '1px solid #eef2f6', borderRadius: 8, padding: '9px 11px' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.7px', marginBottom: 4 }}>แหล่งที่มา · การคำนวณ</div>
          <div style={{ fontSize: 11.5, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-line', fontVariantNumeric: 'tabular-nums' }}>{kpi.formula}</div>
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e2e8f0', display: 'flex', gap: 5 }}>
            <span style={{ flexShrink: 0 }}>📄</span><span>{kpi.src}</span>
          </div>
          {kpi.bench && (
            <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 5, display: 'flex', gap: 5 }}>
              <span style={{ flexShrink: 0 }}>📏</span><span>เกณฑ์ปกติ: {kpi.bench}</span>
            </div>
          )}
          {kpi.ref && (
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, display: 'flex', gap: 5 }}>
              <span style={{ flexShrink: 0 }}>📚</span>
              {kpi.refUrl
                ? <a href={kpi.refUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>อ้างอิง: {kpi.ref} ↗</a>
                : <span>อ้างอิง: {kpi.ref}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
function PnLPage({ data, setData, toast }) {
  const [loading, setLoading]   = plState(true);
  const [model, setModel]       = plState(null);  // { groups, accounts, lastMonth }
  const [isSample, setIsSample] = plState(false);
  const [detailKey, setDetailKey] = plState(null); // open group-detail modal
  const [mapOpen, setMapOpen]   = plState(false);   // group-map modal
  const [openGrp, setOpenGrp]   = plState(PL_GROUP_ORDER[0]); // accordion expanded key
  const [costOpen, setCostOpen] = plState(false);   // การ์ด "ต้นทุนเครื่อง BA" กางดู
  const reportRef = plRef(null);
  const pageRef   = plRef(null);   // capture ทั้งหน้าตอน "บันทึกเป็นรูป"

  // upload state
  const [file, setFile]       = plState(null);
  const [drag, setDrag]       = plState(false);
  const [busy, setBusy]       = plState(false);
  const [newAccts, setNewAccts] = plState(null);   // [{code,name,amount,group}]
  const [uploadOpen, setUploadOpen] = plState(false);   // upload modal
  const [viewMode, setViewMode]     = plState('month'); // 'month' | 'quarter'
  const fileInputRef = plRef(null);

  const userCanEdit = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;

  const sampleModel = () => ({ groups: PL_SAMPLE.groups, accounts: {}, lastMonth: PL_SAMPLE.lastMonth, year: PL_SAMPLE.year });
  const loadData = () => {
    setLoading(true);
    if (!window.WTPData || !WTPData.fetchSheetRows) {
      setModel(sampleModel());
      setIsSample(true); setLoading(false); return;
    }
    WTPData.fetchSheetRows(PL_SHEET)
      .then(rows => {
        const parsed = PL_parseRows(rows);
        if (parsed) { setModel(parsed); setIsSample(false); }
        else { setModel(sampleModel()); setIsSample(true); }
      })
      .catch(() => { setModel(sampleModel()); setIsSample(true); })
      .finally(() => setLoading(false));
  };
  plEffect(() => { loadData(); }, []);

  const lastMonth = model ? model.lastMonth : 0;
  const groups = model ? model.groups : null;
  const plYear = (model && model.year) || PL_YEAR_DEFAULT;
  const comp = plMemo(() => groups ? PL_compute(groups, lastMonth) : null, [groups, lastMonth]);

  // ผลการ parse ไฟล์ล่าสุด (ใช้ส่ง postImportFull หลังจัดกลุ่มบัญชีใหม่)
  const [lastParsed, setLastParsed] = plState(null);

  // known account codes (for new-account detection)
  const knownCodes = plMemo(() => {
    const set = new Set();
    if (model && model.accounts) Object.values(model.accounts).forEach(list => list.forEach(a => a.code && set.add(String(a.code).trim())));
    return set;
  }, [model]);

  // ── detail rows for a group (real accounts; sorted desc by YTD) ──
  const detailFor = (key) => {
    const accts = (model && model.accounts && model.accounts[key]) || [];
    const rows = accts.map(a => ({ code: a.code, name: a.name, arr: a.arr, seq: a.seq, total: PL_invTotal(a.code, a.arr, lastMonth) }))
      .sort((x, y) => {                       // เรียงตามลำดับในไฟล์ Excel (seq) — fallback = รหัสบัญชี
        const sx = (x.seq == null ? Infinity : x.seq), sy = (y.seq == null ? Infinity : y.seq);
        if (sx !== sy) return sx - sy;
        return String(x.code).localeCompare(String(y.code), 'en', { numeric: true });
      });
    return { key, ...PL_GROUP_META[key], accounts: rows, total: PL_sum(groups[key], lastMonth) };
  };

  // ── upload handlers ──
  const pickFile = (f) => { if (f) setFile(f); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); };

  // ── parse ชีต PL (งบเปรียบเทียบรายเดือนของ BIO) ──
  // โครงสร้าง: หัวคอลัมน์เดือน = date-serial (1 ม.ค. / 1 ก.พ. …) + คอลัมน์ "รวม"
  //            แต่ละแถว = รหัสบัญชี NNNN-NN + ชื่อ + ยอดรายเดือน
  // คืน { accounts:[{code,name,m:[12]}], monthsPresent:[..], year:พ.ศ., monthsLabel }
  const parseWorkbook = (f) => new Promise((resolve, reject) => {
    if (!window.XLSX) { reject(new Error('ไม่พบไลบรารี SheetJS — รีเฟรชหน้า')); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const X = window.XLSX;
        const wb = X.read(e.target.result, { type: 'array', cellDates: false });
        // รหัสบัญชี BIO — รับ "ทุกรูปแบบที่เป็นตัวเลข" (ผังบัญชีเพิ่มรหัสใหม่ได้เรื่อยๆ รูปแบบไม่แน่นอน):
        //   4110-01 · 4110-100 · 5410-01-02  (มีขีด/สแลชคั่น กี่ท่อน/กี่หลักก็ได้ = รหัสย่อย)
        //   4110 · 41100000                    (ตัวเลขล้วน 4–8 หลัก)
        // ⚠️ เดิม /^\d{4}-\d{1,2}$/ รับ suffix แค่ 1–2 หลัก → รหัสย่อย 3 หลัก (4110-100)
        //    หรือหลายท่อน (5410-01-02) จะ "หายเงียบ" ตอนอ่านไฟล์ ทำให้งบไม่ตรง
        const codeSep  = /^\d{3,}(?:[-\/]\d+)+$/;   // มีตัวคั่น = รหัสย่อยชัดเจน (กี่ท่อน กี่หลักก็ได้)
        const codePure = /^\d{4,8}$/;               // ตัวเลขล้วน 4–8 หลัก
        const isCode = (s) => codeSep.test(s) || codePure.test(s);
        // เลือกชีต: ชื่อ "PL" ก่อน, ไม่งั้นชีตที่มีรหัสบัญชีเยอะสุด
        const aoaOf = (n) => X.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false });
        let sn = wb.SheetNames.find(n => /^pl$/i.test(String(n).trim()));
        if (!sn) sn = wb.SheetNames.find(n => /กำไรขาดทุน|งบกำไร|p\s*&\s*l|profit/i.test(String(n)));
        if (!sn) {
          let bestSn = wb.SheetNames[0], bestCnt = -1;
          wb.SheetNames.forEach(n => {
            let cnt = 0; aoaOf(n).forEach(r => (r || []).forEach(c => { if (isCode(String(c == null ? '' : c).trim())) cnt++; }));
            if (cnt > bestCnt) { bestCnt = cnt; bestSn = n; }
          });
          sn = bestSn;
        }
        const aoa = aoaOf(sn);
        if (!aoa.length) { resolve({ accounts: [], monthsPresent: [], year: 0, monthsLabel: '' }); return; }

        // serial (Excel 1900) → { month, year(ค.ศ.) }
        const serialMonth = (serial) => {
          const d = new Date(Math.round((Number(serial) - 25569) * 86400000));
          return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
        };
        const isSerial = (v) => typeof v === 'number' && v >= 40000 && v <= 60000;

        // 1) หาแถวหัวคอลัมน์เดือน (≥3 cell ที่เป็น date-serial) → ได้คอลัมน์เดือน + ปี
        let hdrIdx = -1, monthCols = [], yearCE = 0;
        for (let i = 0; i < Math.min(aoa.length, 14); i++) {
          const row = aoa[i] || [], cols = [];
          for (let c = 0; c < row.length; c++) {
            if (isSerial(row[c])) { const sm = serialMonth(row[c]); cols.push({ col: c, month: sm.month }); if (!yearCE) yearCE = sm.year; }
          }
          if (cols.length >= 3) { hdrIdx = i; monthCols = cols; break; }
        }
        // fallback: หัวคอลัมน์เป็นชื่อเดือนไทย (ม.ค./มกราคม)
        if (hdrIdx < 0) {
          for (let i = 0; i < Math.min(aoa.length, 14); i++) {
            const row = aoa[i] || [], cols = [];
            for (let c = 0; c < row.length; c++) {
              const s = String(row[c] == null ? '' : row[c]).trim();
              let mi = PL_MONTHS_TH.findIndex(m => s.indexOf(m) === 0);
              if (mi < 0) mi = PL_MONTHS_TH_FULL.findIndex(m => s.indexOf(m) === 0);
              if (mi >= 0) cols.push({ col: c, month: mi + 1 });
            }
            if (cols.length >= 3) { hdrIdx = i; monthCols = cols; break; }
          }
        }
        if (hdrIdx < 0) { resolve({ accounts: [], monthsPresent: [], year: 0, monthsLabel: '' }); return; }

        // 2) หาคอลัมน์รหัสบัญชี (คอลัมน์ที่มีค่า match รหัสมากสุด)
        const colHits = {};
        for (let i = hdrIdx + 1; i < aoa.length; i++) {
          const row = aoa[i] || [];
          for (let c = 0; c < row.length; c++) { if (isCode(String(row[c] == null ? '' : row[c]).trim())) colHits[c] = (colHits[c] || 0) + 1; }
        }
        let codeCol = -1, best = 0;
        Object.keys(colHits).forEach(c => { if (colHits[c] > best) { best = colHits[c]; codeCol = Number(c); } });
        if (codeCol < 0) { resolve({ accounts: [], monthsPresent: [], year: 0, monthsLabel: '' }); return; }
        const nameCol = codeCol + 1;

        const num = (v) => {
          if (v == null || v === '') return 0;
          if (typeof v === 'number') return v;
          let s = String(v).trim(), neg = false;
          if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
          s = s.replace(/[^0-9.\-]/g, '');
          const n = Number(s);
          return isNaN(n) ? 0 : (neg ? -Math.abs(n) : n);
        };

        // 3) อ่านรายบัญชี (aggregate ถ้ารหัสซ้ำ — เช่น 7100-01 โผล่ 2 แถว)
        //    seq = ลำดับที่เจอครั้งแรกในชีต → เก็บไว้เรียงรายละเอียดให้ "เหมือนไฟล์ Excel"
        const byCode = {};
        let seq = 0;
        for (let i = hdrIdx + 1; i < aoa.length; i++) {
          const row = aoa[i] || [];
          let code = String(row[codeCol] == null ? '' : row[codeCol]).trim();
          const name = String(row[nameCol] == null ? '' : row[nameCol]).trim();
          let invGroup = '';
          if (!isCode(code)) {
            // บรรทัดสต๊อกต้นงวด/ปลายงวด ในงบ "ไม่มีรหัสบัญชี" → เก็บเป็นต้นทุนขาย
            // (รหัสสังเคราะห์คงที่) ให้ยอดต้นทุนขาย + รายละเอียดตรงกับงบจริง
            if (PL_isInvName(name)) { code = PL_invCode(name); invGroup = 'cogs'; }
            else continue;                       // section header / subtotal (รวม.../กำไร...) — ข้าม
          }
          let rec = byCode[code];
          if (!rec) rec = byCode[code] = { code, name, m: new Array(12).fill(0), group: invGroup, seq: seq++ };
          if (!rec.name && name) rec.name = name;
          if (invGroup && !rec.group) rec.group = invGroup;
          monthCols.forEach(mc => { rec.m[mc.month - 1] += num(row[mc.col]); });
        }
        const accounts = Object.keys(byCode).map(c => byCode[c]);
        const monthsPresent = monthCols.map(mc => mc.month).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
        const year = yearCE ? yearCE + 543 : 0;   // ค.ศ. → พ.ศ.
        const mn = monthsPresent;
        const monthsLabel = mn.length
          ? (mn.length > 1 ? PL_MONTHS_TH[mn[0] - 1] + '–' + PL_MONTHS_TH[mn[mn.length - 1] - 1] : PL_MONTHS_TH[mn[0] - 1]) + (year ? ' ' + year : '')
          : '';

        // ── ข้อมูลเสริม: ชีต "ต้นทุน" (ต้นทุน/กำไรต่อเครื่อง BA รายเครื่อง) ──
        // ตารางแยกต่างหากในไฟล์งบ (รายเครื่อง: ราคาขาย/ต้นทุนเครื่อง/โสหุ้ย/ค่าแรง/กำไร)
        // ผลรวม "ต้นทุนรวม" = บรรทัด "ต้นทุนขาย-เครื่อง BA (5101-01)" ในงบ → โชว์เป็นการ์ดกดดูได้
        let costBA = [];
        try {
          const csn = wb.SheetNames.find(n => String(n).trim() === 'ต้นทุน');
          if (csn) {
            const caoa = aoaOf(csn);
            let chi = -1;
            for (let i = 0; i < Math.min(caoa.length, 12); i++) {
              const r = (caoa[i] || []).map(x => String(x == null ? '' : x));
              if (r.some(c => /ราคาขาย/.test(c)) && r.some(c => /ต้นทุนรวม/.test(c))) { chi = i; break; }
            }
            if (chi >= 0) {
              const hdr = (caoa[chi] || []).map(x => String(x == null ? '' : x).trim());
              const fc = (re) => hdr.findIndex(h => re.test(h));
              const col = {
                date: fc(/ว\.?ด\.?ป|วันที่/), item: fc(/รายการ/), price: fc(/ราคาขาย/),
                machine: fc(/ต้นทุนเครื่อง/), overhead: fc(/โสหุ้ย/), labor: fc(/ค่าแรง/),
                cost: fc(/ต้นทุนรวม/), profit: fc(/กำไร|ขาดทุน/),
              };
              const cv = (row, c) => (c >= 0 && row[c] != null) ? row[c] : '';
              for (let i = chi + 1; i < caoa.length; i++) {
                const row = caoa[i] || [];
                const item = String(cv(row, col.item)).trim();
                if (!item || /^รวม|^total/i.test(item)) continue;   // ข้ามแถวว่าง/แถวรวม
                const price = num(cv(row, col.price)), cost = num(cv(row, col.cost));
                if (!price && !cost) continue;
                costBA.push({
                  date: PL_costDate(cv(row, col.date)), item,
                  price, machine: num(cv(row, col.machine)), overhead: num(cv(row, col.overhead)),
                  labor: num(cv(row, col.labor)), cost, profit: num(cv(row, col.profit)),
                });
              }
            }
          }
        } catch (_) { costBA = []; }

        resolve({ accounts, monthsPresent, year, monthsLabel, costBA });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsArrayBuffer(f);
  });

  const handleVerify = async () => {
    if (!file) { toast('โปรดเลือกไฟล์ก่อนนำเข้า'); return; }
    setBusy(true);
    try {
      const parsed = await parseWorkbook(file);
      if (!parsed || !parsed.accounts.length) {
        toast('ไม่พบรายการบัญชีในไฟล์ — ต้องมีชีต PL ที่มีคอลัมน์รหัสบัญชี + หัวคอลัมน์เป็นเดือน'); setBusy(false); return;
      }
      setLastParsed(parsed);
      // "ใหม่" = บัญชีที่ prefix จัดกลุ่มอัตโนมัติไม่ได้ (ปกติ = 0 สำหรับผังบัญชี BIO)
      // (แถวสต๊อก a.group='cogs' มาแล้ว — ไม่ต้องให้ผู้ใช้จัดกลุ่ม)
      const unknown = parsed.accounts.filter(a => !a.group && !PL_inferGroup(a.code, a.name));
      if (unknown.length) {
        setNewAccts(unknown.map(a => ({ code: a.code, name: a.name, amount: PL_sum(a.m, 12), group: '' })));
        toast('พบผังบัญชีที่จัดกลุ่มอัตโนมัติไม่ได้ ' + unknown.length + ' รายการ — โปรดจัดประเภท (อีก ' + (parsed.accounts.length - unknown.length) + ' รายการ ระบบจัดให้แล้ว)');
        setUploadOpen(false); setBusy(false);
      } else {
        toast('อ่านงบ ' + parsed.monthsLabel + ' · ' + parsed.accounts.length + ' บัญชี · กำลังบันทึก…');
        await postImportFull(parsed, {});
      }
    } catch (err) { toast('ผิดพลาด: ' + (err && err.message || err)); setBusy(false); }
  };

  // นำเข้างบทั้งชีต PL ลง Supabase (ตาราง pnlBase) — เขียนทับทั้งตาราง (id = code)
  //   "อัปทั้งชีต = เห็นทั้งชีต": บัญชีที่ไม่อยู่ในไฟล์ใหม่จะหายจากฐาน, เดือนที่ไม่มีในไฟล์ = 0
  const postImportFull = async (parsed, groupOverride) => {
    if (!window.WTPData || !window.WTPData.writeTable) { toast('ระบบยังไม่พร้อม'); setBusy(false); return; }
    if (!parsed || !parsed.accounts.length) { toast('ไม่มีข้อมูลให้บันทึก'); setBusy(false); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString().slice(0, 10);
      const allRows = parsed.accounts.map(a => {
        const code = String(a.code).trim();
        const grp = (groupOverride && groupOverride[code]) || a.group || PL_inferGroup(code, a.name) || '';
        const row = { code, name: a.name || '', group: grp, year: parsed.year || PL_YEAR_DEFAULT, seq: (typeof a.seq === 'number' ? a.seq : 0), updatedAt: now };
        for (let m = 1; m <= 12; m++) row['m' + m] = Number(a.m[m - 1]) || 0;
        return row;
      });
      const rows    = allRows.filter(r => r.group);   // เข้าฐานได้ (จัดกลุ่มสำเร็จ)
      const dropped = allRows.filter(r => !r.group);  // จัดกลุ่มไม่ได้ → ต้องเตือน ห้ามทิ้งเงียบ
      if (!rows.length) { toast('จัดกลุ่มบัญชีไม่สำเร็จ — โปรดตรวจผังบัญชี'); setBusy(false); return; }
      // "ไม่ทิ้งเงียบ": ถ้ามีรหัสจัดกลุ่มไม่ได้ ให้ค้าง popup จัดประเภทแทนการบันทึกทิ้งรหัสนั้น
      if (dropped.length) {
        setNewAccts(dropped.map(r => {
          let amt = 0; for (let m = 1; m <= 12; m++) amt += Number(r['m' + m]) || 0;
          return { code: r.code, name: r.name, amount: amt, group: '' };
        }));
        toast('มี ' + dropped.length + ' รหัสที่จัดกลุ่มอัตโนมัติไม่ได้ — โปรดเลือกกลุ่มก่อนบันทึก (อีก ' + rows.length + ' บัญชีจัดให้แล้ว)');
        setUploadOpen(false); setBusy(false); return;
      }
      const newCount = rows.filter(r => !knownCodes.has(String(r.code).trim())).length;   // รหัสที่ยังไม่เคยมีในฐาน
      await window.WTPData.writeTable('pnlBase', rows, r => String(r.code));
      // ข้อมูลเสริม: ต้นทุน/กำไรต่อเครื่อง BA (ชีต "ต้นทุน") — เก็บใน manualOverrides (sync ทั้งทีม, ไม่ต้องมีตารางใหม่)
      try {
        if (window.WTPOverride) {
          const cb = Array.isArray(parsed.costBA) ? parsed.costBA : [];
          WTPOverride.setRaw('pnl.costBA', JSON.stringify({ rows: cb, monthsLabel: parsed.monthsLabel || '', updatedAt: now }));
        }
      } catch (_) {}
      toast('นำเข้างบ ' + (parsed.monthsLabel || '') + ' สำเร็จ (' + rows.length + ' บัญชี'
        + (newCount ? ' · รหัสใหม่ ' + newCount + ' ตัว' : '')
        + (parsed.costBA && parsed.costBA.length ? ' + ต้นทุนเครื่อง ' + parsed.costBA.length + ' รายการ' : '') + ') — กำลังรีเฟรช');
      setNewAccts(null); setFile(null); setUploadOpen(false); setLastParsed(null);
      setTimeout(loadData, 600);
    } catch (err) { toast('นำเข้าไม่สำเร็จ: ' + (err && err.message || err)); }
    finally { setBusy(false); }
  };

  const confirmNewAccounts = () => {
    if (!newAccts || !lastParsed) { toast('กรุณาอัปโหลดไฟล์ใหม่อีกครั้ง'); setNewAccts(null); return; }
    if (newAccts.some(a => !a.group)) { toast('โปรดจัดประเภทให้ครบทุกรายการ'); return; }
    const override = {};
    newAccts.forEach(a => { const c = String(a.code).trim(); if (c) override[c] = a.group; });
    postImportFull(lastParsed, override);
  };

  // ── derived KPI numbers ──
  const k = plMemo(() => {
    if (!comp) return null;
    const revenue = PL_sum(comp.totalRevenue, lastMonth);
    const cost    = PL_sum(comp.totalCost, lastMonth);
    const gp      = PL_sum(comp.grossProfit, lastMonth);
    const net     = PL_sum(comp.netProfit, lastMonth);
    return { revenue, cost, gp, net, gpM: revenue ? gp / revenue * 100 : 0, netM: revenue ? net / revenue * 100 : 0, costM: revenue ? cost / revenue * 100 : 0 };
  }, [comp, lastMonth]);

  // ── ยอดจากงบแสดงฐานะการเงิน (bs.data override → BS_SEED) สำหรับคะแนนสุขภาพ/CFO insight ──
  // BS_SEED / BS_find เป็น global จาก page_balance_sheet.jsx (โหลดพร้อมกัน — ใช้ตอน render ได้)
  const bal = plMemo(() => {
    let bsData = (typeof BS_SEED !== 'undefined') ? BS_SEED : { rows: [] };
    try {
      const row = ((data && data.manualOverrides) || []).find(r => r && r.key === 'bs.data');
      if (row && row.value != null && row.value !== '') {
        const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        if (v && Array.isArray(v.rows) && v.rows.length) bsData = v;
      }
    } catch (_) {}
    const rows = (bsData && bsData.rows) || [];
    const cv = (re) => { if (typeof BS_find !== 'function') return null; const r = BS_find(rows, re); return (r && r.cur != null) ? r.cur : null; };
    return { ca: cv(/^รวมสินทรัพย์หมุนเวียน$/), cl: cv(/^รวมหนี้สินหมุนเวียน$/), tl: cv(/^รวมหนี้สิน$/), ta: cv(/^รวมสินทรัพย์$/), eq: cv(/^รวมส่วนของผู้ถือหุ้น/) };
  }, [data && data.manualOverrides]);

  // ── ข้อมูลเสริม: ต้นทุน/กำไรต่อเครื่อง BA (ชีต "ต้นทุน") — อ่านจาก manualOverrides (sync ทั้งทีม) ──
  const costBA = plMemo(() => {
    try {
      const arr = (data && data.manualOverrides) || [];
      const row = arr.find(r => r && r.key === 'pnl.costBA');
      if (!row || row.value == null || row.value === '') return { rows: [] };
      const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      if (Array.isArray(v)) return { rows: v };
      return (v && Array.isArray(v.rows)) ? v : { rows: [] };
    } catch (_) { return { rows: [] }; }
  }, [data && data.manualOverrides]);

  const cb = plMemo(() => {
    const rows = (costBA && costBA.rows) || [];
    const sum = (f) => rows.reduce((s, m) => s + (Number(m[f]) || 0), 0);
    const price = sum('price'), cost = sum('cost'), profit = sum('profit');
    return { rows, count: rows.length, price, cost, machine: sum('machine'), overhead: sum('overhead'), labor: sum('labor'), profit, margin: price ? profit / price * 100 : NaN };
  }, [costBA]);

  const saveImage = () => {
    if (!window.html2canvas) { toast('ระบบบันทึกรูปยังไม่พร้อม — โหลด html2canvas ไม่สำเร็จ'); return; }
    const target = pageRef.current || reportRef.current;
    if (!target) { toast('ไม่พบส่วนรายงานที่จะบันทึก'); return; }
    toast('กำลังเตรียมรูปภาพรายงาน…');
    // ใช้ scrollWidth/scrollHeight เพื่อจับ "ทั้งหน้า" — ไม่จำกัดที่ viewport
    window.html2canvas(target, {
      scale: 2,
      backgroundColor: '#f4f7fb',  // ใช้สีพื้นเดียวกับ body
      useCORS: true,
      logging: false,
      width:  target.scrollWidth,
      height: target.scrollHeight,
      windowWidth:  target.scrollWidth,
      windowHeight: target.scrollHeight,
    }).then(canvas => {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'PnL_' + new Date().toISOString().slice(0, 10) + '.png';
      a.click();
      toast('บันทึกรูปสำเร็จ');
    }).catch(err => {
      console.error('[PnL saveImage] failed:', err);
      toast('บันทึกรูปไม่สำเร็จ: ' + (err && err.message ? err.message : 'unknown'));
    });
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-head"><div><h1 className="page-title">งบกำไรขาดทุน (P&amp;L)</h1><div className="page-sub">กำลังโหลดข้อมูลจาก ฐาน DATA…</div></div></div>
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-400)' }}>กำลังโหลด…</div>
      </div>
    );
  }

  // ── report rows definition (order matches design) ──
  const d = groups;
  const c = comp;
  const reportRows = [
    { label: 'Revenue from sales and services', arr: d.saleGoods,   indent: true, key: 'saleGoods' },
    { label: 'Other income',                arr: d.otherIncome, indent: true, key: 'otherIncome' },
    { label: 'รวมรายได้',                   arr: c.totalRevenue, cls: 'pnl-strong' },
    { label: 'Cost of goods sold',          arr: d.cogs,        indent: true, key: 'cogs' },
    { label: 'Gross Profit',                arr: c.grossProfit, cls: 'pnl-gp' },
    { label: '% margin',                    arr: c.gpMargin,    cls: 'pnl-pct', pct: true, totalVal: (PL_sum(c.totalRevenue, lastMonth) ? PL_sum(c.grossProfit, lastMonth) / PL_sum(c.totalRevenue, lastMonth) * 100 : NaN) },
    { label: 'Selling expenses',            arr: d.selling,     indent: true, key: 'selling' },
    { label: 'Administrative expenses',     arr: d.admin,       indent: true, key: 'admin' },
    { label: 'Finance costs',               arr: d.finance,     indent: true, key: 'finance' },
    { label: 'รวมค่าใช้จ่ายขายและบริหาร',     arr: c.totalSGA,   cls: 'pnl-strong' },
    { label: 'Net Profit',                  arr: c.netProfit,   cls: 'pnl-net' },
    { label: '% net margin',                arr: c.netMargin,   cls: 'pnl-pct', pct: true, totalVal: (PL_sum(c.totalRevenue, lastMonth) ? PL_sum(c.netProfit, lastMonth) / PL_sum(c.totalRevenue, lastMonth) * 100 : NaN) },
  ];

  const renderCell = (v, pct) => {
    const has = true;
    const txt = pct ? PL_fmtPct(v) : PL_fmt(v, { blankZero: true });
    return <td key={Math.random()} className={'pnl-num' + PL_negCls(v)}>{has ? txt : '—'}</td>;
  };

  // เทียบงบประมาณประจำปี — แสดงเฉพาะเมื่อมี PL_BUDGET (BIO ยังไม่มี → null → ซ่อนส่วนนี้)
  const budgetRows = (PL_BUDGET ? [
    { name: 'รายได้รวม',                actual: k.revenue,                       target: PL_BUDGET.revenue,     dir: 'higher' },
    { name: 'ต้นทุนขาย',                actual: k.cost,                          target: PL_BUDGET.totalCost,   dir: 'lower'  },
    { name: 'กำไรขั้นต้น',              actual: k.gp,                            target: PL_BUDGET.grossProfit, dir: 'higher' },
    { name: 'ค่าใช้จ่ายขายและบริหาร',   actual: PL_sum(c.totalSGA, lastMonth),   target: PL_BUDGET.totalSGA,    dir: 'lower'  },
    { name: 'กำไร(ขาดทุน)สุทธิ',        actual: k.net,                           target: PL_BUDGET.netProfit,   dir: 'higher' },
  ] : []).map(r => {
    const pct = r.target ? r.actual / r.target * 100 : 0;
    const variance = r.actual - r.target;
    return { ...r, pct, variance };
  });

  // ── PERIOD ABSTRACTION (month vs quarter view) ─────────────────────────
  const lastQuarter = Math.ceil(lastMonth / 3);
  const periods = viewMode === 'quarter'
    ? { names: ['ไตรมาส 1', 'ไตรมาส 2', 'ไตรมาส 3', 'ไตรมาส 4'], count: 4, lastIdx: lastQuarter,
        sum: (arr, p) => [0,1,2].reduce((s, i) => s + (arr[p*3+i] || 0), 0) }
    : { names: PL_MONTHS_TH, count: 12, lastIdx: lastMonth,
        sum: (arr, p) => arr[p] || 0 };
  // ค่าใน cell — pct rows ต้อง re-compute จาก revenue/gp/net (sum ไม่ได้)
  const cellValue = (row, p) => {
    if (row.label === '% margin') {
      const rev = periods.sum(c.totalRevenue, p);
      const gp  = periods.sum(c.grossProfit, p);
      return rev ? gp / rev * 100 : NaN;
    }
    if (row.label === '% net margin') {
      const rev = periods.sum(c.totalRevenue, p);
      const net = periods.sum(c.netProfit, p);
      return rev ? net / rev * 100 : NaN;
    }
    return periods.sum(row.arr, p);
  };

  return (
    <div className="page pnl-page present-page" ref={pageRef}>
      {/* ── HERO BANNER ────────────────────────────────────────────────── */}
      <div className="anim-in pnl-hero" style={{
        background: 'linear-gradient(135deg, #2e8b4a 0%, #154524 100%)',
        borderRadius: 16, padding: '22px 28px', color: 'white',
        marginBottom: 18, boxShadow: '0 10px 28px rgba(30, 58, 138, 0.18)',
        display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
      }}>
        {/* BIOAXEL logo */}
        <div style={{
          width: 56, height: 56, borderRadius: 14, background: 'white',
          display: 'grid', placeItems: 'center', flexShrink: 0,
          boxShadow: '0 2px 6px rgba(0,0,0,0.08)', padding: 8,
        }}>
          <img src="bioaxel_logo.png" alt="BIOAXEL"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 10.5, letterSpacing: 1.4, opacity: 0.85, textTransform: 'uppercase', fontWeight: 600 }}>
            BIOAXEL · Financial Console
          </div>
          <h1 style={{ fontSize: 26, margin: '3px 0 4px', fontWeight: 700, color: 'white', lineHeight: 1.15 }}>
            งบกำไรขาดทุนทางบัญชี
            {isSample && <span style={{ marginLeft: 10, fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(252,211,77,0.3)', verticalAlign: 'middle', fontWeight: 600 }}>ข้อมูลตัวอย่าง</span>}
          </h1>
          <div style={{ fontSize: 12.5, opacity: 0.9 }}>
            Profit &amp; Loss Statement · ปีบัญชี {plYear} (สะสมตั้งแต่ต้นปี)
          </div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 10.5, opacity: 0.8, letterSpacing: 0.4 }}>ข้อมูลล่าสุดถึงเดือน</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.3 }}>
              {PL_MONTHS_TH_FULL[Math.max(0, lastMonth - 1)]} {plYear}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button onClick={saveImage} style={pnlHeroBtn}>
              <Icon name="download" size={13} /> บันทึกเป็นรูป
            </button>
            <button onClick={() => window.print()} style={pnlHeroBtn}>
              <Icon name="print" size={13} /> พิมพ์ / PDF
            </button>
            {userCanEdit && (
              <button onClick={() => setUploadOpen(true)} style={{
                ...pnlHeroBtn,
                background: 'rgba(255,255,255,0.95)', color: '#154524',
                border: '1px solid rgba(255,255,255,0.5)',
                fontWeight: 600,
              }} title="อัปโหลดชีต PL (งบเปรียบเทียบรายเดือน) — แทนที่ข้อมูลทั้งหมด">
                <Icon name="upload" size={13} /> อัปโหลดข้อมูล
              </button>
            )}
            <button onClick={() => setMapOpen(true)} style={pnlHeroBtn}>
              <Icon name="filter" size={13} /> ผังการจัดกลุ่ม
            </button>
          </div>
        </div>
      </div>

      {/* KPI — 4 horizontal cards (clean style ตาม mockup) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 14, marginBottom: 18,
      }}>
        {[
          { label: 'รายได้รวม', value: k.revenue,
            iconSvg: <path d="M3 17l6-6 4 4 7-7M14 8h7v7" />,
            iconBg: '#eff6ff', iconColor: '#2e8b4a',
            badge: 'ยอดสะสม ' + lastMonth + ' เดือน', badgeBg: '#f1f5f9', badgeColor: '#64748b' },
          { label: 'ต้นทุนขาย', value: k.cost,
            iconSvg: <><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M4 10h16M9 6V4h6v2"/></>,
            iconBg: '#f1f5f9', iconColor: '#64748b',
            badge: PL_fmtPct(k.costM) + ' ของรายได้', badgeBg: '#f1f5f9', badgeColor: '#475569' },
          { label: 'กำไรขั้นต้น (Gross Profit)', value: k.gp,
            iconSvg: <><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9c0-1.1 1.3-2 3-2s3 .9 3 2-1.3 2-3 2-3 .9-3 2 1.3 2 3 2 3-.9 3-2"/></>,
            iconBg: '#dcfce7', iconColor: '#16a34a',
            badge: 'Margin ' + PL_fmtPct(k.gpM),
            badgeBg: k.gpM >= 0 ? '#dcfce7' : '#fef2f2', badgeColor: k.gpM >= 0 ? '#15803d' : '#b91c1c',
            badgeArrow: k.gpM >= 0 ? '↑' : '↓' },
          { label: 'กำไร(ขาดทุน)สุทธิ', value: k.net,
            iconSvg: k.net < 0
              ? <path d="M3 7l6 6 4-4 7 7M14 16h7v-7"/>
              : <path d="M3 17l6-6 4 4 7-7M14 8h7v7"/>,
            iconBg: k.net < 0 ? '#fee2e2' : '#dcfce7',
            iconColor: k.net < 0 ? '#dc2626' : '#16a34a',
            badge: (k.net < 0 ? 'ขาดทุน ' : 'กำไร ') + PL_fmtPct(k.netM),
            badgeBg: k.net < 0 ? '#fee2e2' : '#dcfce7',
            badgeColor: k.net < 0 ? '#b91c1c' : '#15803d',
            badgeArrow: k.net < 0 ? '↓' : '↑',
            valueColor: k.net < 0 ? '#dc2626' : 'inherit',
            cardBg: k.net < 0 ? 'linear-gradient(180deg, #fef2f2 0%, #ffffff 100%)' : 'white',
            cardBorder: k.net < 0 ? '#fecaca' : '#e2e8f0' },
        ].map((tile, i) => (
          <div key={i} className="pnl-kpi-card" style={{
            background: tile.cardBg || 'white',
            borderRadius: 12, padding: 18,
            border: '1px solid ' + (tile.cardBorder || '#e2e8f0'),
            boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: tile.iconBg,
              display: 'grid', placeItems: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke={tile.iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {tile.iconSvg}
              </svg>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{tile.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: tile.valueColor || '#0f172a', letterSpacing: '-0.5px', lineHeight: 1.1 }}>
              {PL_fmt(tile.value)}
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
              background: tile.badgeBg, color: tile.badgeColor,
              fontSize: 11, padding: '3px 9px', borderRadius: 12, fontWeight: 600,
            }}>
              {tile.badgeArrow && <span>{tile.badgeArrow}</span>}
              {tile.badge}
            </div>
          </div>
        ))}
      </div>

      {/* NEW ACCOUNTS ALERT */}
      {newAccts && (
        <div className="card pnl-alert" style={{ marginBottom: 18 }}>
          <div className="pnl-alert-hd">
            <div className="pnl-alert-ic"><Icon name="filter" size={20} /></div>
            <div style={{ flex: 1 }}>
              <h3>พบผังบัญชีใหม่ที่ยังไม่อยู่ในฐานข้อมูล</h3>
              <p>โปรดจัดประเภท (กลุ่ม) ให้ครบทุกรายการก่อน เพื่อให้คำนวณในงบได้ถูกต้อง</p>
            </div>
            <span className="pnl-pill">{newAccts.length} รายการ</span>
          </div>
          <div className="pnl-tbl-wrap">
            <table className="pnl-tbl">
              <thead><tr><th style={{ width: 120 }}>รหัสบัญชี</th><th>ชื่อบัญชี</th><th className="r" style={{ width: 150 }}>ยอดเดือนนี้</th><th style={{ width: 260 }}>จัดกลุ่ม</th></tr></thead>
              <tbody>
                {newAccts.map((a, i) => (
                  <tr key={i}>
                    <td>{PL_isInvCode(a.code)
                              ? <span style={{ fontSize: 10.5, fontWeight: 600, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>สต๊อก</span>
                              : <span className="pnl-acc-code">{a.code}</span>}</td>
                    <td>{a.name || <span className="muted">—</span>}</td>
                    <td className={'r pnl-num' + PL_negCls(a.amount)}>{PL_fmt(a.amount)}</td>
                    <td>
                      <select className={'pnl-type-select' + (a.group ? '' : ' unset')} value={a.group}
                        onChange={(e) => setNewAccts(arr => arr.map((x, j) => j === i ? { ...x, group: e.target.value } : x))}>
                        <option value="">— เลือกกลุ่ม —</option>
                        {PL_GROUP_ORDER.map(g => <option key={g} value={g}>{PL_GROUP_META[g].th}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pnl-alert-foot">
            <span className="pnl-note">{newAccts.filter(a => !a.group).length === 0 ? 'จัดกลุ่มครบแล้ว · พร้อมบันทึก' : 'ยังไม่ได้เลือกกลุ่ม ' + newAccts.filter(a => !a.group).length + ' รายการ'}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => { setNewAccts(null); setBusy(false); }}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={busy || newAccts.some(a => !a.group)} onClick={confirmNewAccounts}>
                <Icon name="check" size={14} /> ยืนยันเพิ่มเข้าฐานข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MONTHLY / QUARTERLY P&L TABLE */}
      <div className="pnl-section-head">
        <h2>งบกำไรขาดทุน{viewMode === 'quarter' ? 'รายไตรมาส' : 'รายเดือน'}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pnl-tag">หน่วย: บาท</span>
          {/* View mode toggle */}
          <div style={{ display: 'inline-flex', background: '#eef2ff', borderRadius: 8, padding: 3, border: '1px solid #c7d2fe' }}>
            {[['month', 'รายเดือน'], ['quarter', 'รายไตรมาส']].map(([k, label]) => (
              <button key={k} onClick={() => setViewMode(k)} style={{
                padding: '5px 14px', fontSize: 12, fontWeight: 600,
                background: viewMode === k ? 'white' : 'transparent',
                color: viewMode === k ? '#154524' : '#64748b',
                border: 0, borderRadius: 6, cursor: 'pointer',
                boxShadow: viewMode === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 120ms ease',
              }}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="card pnl-report-card" ref={reportRef}>
        <div className="pnl-report-wrap">
          <table className="pnl-report">
            <thead>
              <tr>
                <th className="label">{viewMode === 'quarter' ? 'ไตรมาส' : 'เดือน'}</th>
                {periods.names.map((m, i) => <th key={i} className={i >= periods.lastIdx ? 'pnl-dim' : ''}>{m}</th>)}
                <th className="total">รวมทั้งปี</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((row, ri) => {
                const clickable = !!row.key;
                // ยอดรวมทั้งปี (sum ของทุกเดือนที่มีข้อมูล) — pct rows ต้องคำนวณจาก totals
                let totVal;
                if (row.totalVal !== undefined) {
                  totVal = row.totalVal;
                } else if (row.label === '% margin') {
                  const tr = PL_sum(c.totalRevenue, lastMonth);
                  totVal = tr ? PL_sum(c.grossProfit, lastMonth) / tr * 100 : NaN;
                } else if (row.label === '% net margin') {
                  const tr = PL_sum(c.totalRevenue, lastMonth);
                  totVal = tr ? PL_sum(c.netProfit, lastMonth) / tr * 100 : NaN;
                } else {
                  totVal = PL_sum(row.arr, lastMonth);
                }
                const totTxt = row.pct ? PL_fmtPct(totVal) : PL_fmt(totVal);
                return (
                  <tr key={ri} className={(row.cls || '') + (clickable ? ' pnl-clickable' : '')}
                    onClick={clickable ? () => setDetailKey(row.key) : undefined}
                    title={clickable ? 'คลิกดูบัญชีย่อยในกลุ่มนี้' : undefined}>
                    <td className={'label' + (row.indent ? ' pnl-indent' : '')}>
                      {row.label}
                      {clickable && <svg className="pnl-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 6l6 6-6 6" /></svg>}
                    </td>
                    {periods.names.map((_, p) => {
                      const v = cellValue(row, p);
                      const has = p < periods.lastIdx;
                      const txt = !has ? '—' : (row.pct ? PL_fmtPct(v) : PL_fmt(v, { blankZero: true }));
                      return <td key={p} className={'pnl-num' + (has ? PL_negCls(v) : '') + (has ? '' : ' pnl-dim')}>{txt}</td>;
                    })}
                    <td className={'pnl-num total' + PL_negCls(totVal)}>{totTxt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── ข้อมูลเสริม: ต้นทุน/กำไร ต่อเครื่อง BA (ชีต "ต้นทุน") — กดดูได้ ── */}
      {cb.count > 0 && (
        <>
          <div className="pnl-section-head" style={{ marginTop: 22 }}>
            <h2>🏭 ต้นทุน/กำไร ต่อเครื่อง BA (รายเครื่อง)</h2>
            <span className="pnl-tag">{costBA.monthsLabel || ('สะสม ' + lastMonth + ' เดือน')} · ข้อมูลเสริมจากชีต “ต้นทุน”</span>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* แถบหัว — กดเพื่อกาง/ย่อ (สรุปเห็นตลอด) */}
            <div onClick={() => setCostOpen(o => !o)} title="กดเพื่อดูรายละเอียดต่อเครื่อง"
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', flexWrap: 'wrap',
                background: costOpen ? '#f0fdf4' : 'white', borderBottom: costOpen ? '1px solid #dcfce7' : 'none' }}>
              <span style={{ fontSize: 15, color: '#16a34a', transition: 'transform .15s ease', transform: costOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>ดูต้นทุน/กำไรต่อเครื่อง · {cb.count} เครื่อง</div>
                <div style={{ fontSize: 11.5, color: '#64748b' }}>{costOpen ? 'กดเพื่อย่อ' : 'กดเพื่อกางดูรายละเอียด'} · ต้นทุนรวมตรงกับบรรทัด “ต้นทุนขาย-เครื่อง BA”</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {[
                  { label: 'ราคาขายรวม', val: PL_fmt(cb.price), color: '#0f172a' },
                  { label: 'ต้นทุนรวม', val: PL_fmt(cb.cost), color: '#64748b' },
                  { label: 'กำไรรวม', val: PL_fmt(cb.profit), color: cb.profit >= 0 ? '#16a34a' : '#dc2626' },
                  { label: 'กำไรเฉลี่ย', val: PL_fmtPct(cb.margin), color: cb.margin >= 0 ? '#16a34a' : '#dc2626' },
                ].map((c2, i) => (
                  <div key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 10px', textAlign: 'right', minWidth: 92 }}>
                    <div style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 600 }}>{c2.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: c2.color }}>{c2.val}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* ตารางรายเครื่อง */}
            {costOpen && (
              <div style={{ overflowX: 'auto' }}>
                <table className="pnl-det-tbl" style={{ minWidth: 860 }}>
                  <thead><tr>
                    <th style={{ width: 96 }}>ว.ด.ป.</th><th>รายการ</th>
                    <th className="r">ราคาขาย</th><th className="r">ต้นทุนเครื่อง</th>
                    <th className="r">ค่าโสหุ้ย</th><th className="r">ค่าแรง 15%</th>
                    <th className="r">ต้นทุนรวม</th><th className="r">กำไร(ขาดทุน)</th><th className="r">% กำไร</th>
                  </tr></thead>
                  <tbody>
                    {cb.rows.map((m, i) => {
                      const mg = m.price ? m.profit / m.price * 100 : NaN;
                      return (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap' }}>{m.date || '—'}</td>
                          <td>{m.item || '—'}</td>
                          <td className="r pnl-num">{PL_fmt(m.price)}</td>
                          <td className="r pnl-num">{PL_fmt(m.machine)}</td>
                          <td className="r pnl-num">{PL_fmt(m.overhead)}</td>
                          <td className="r pnl-num">{PL_fmt(m.labor)}</td>
                          <td className="r pnl-num">{PL_fmt(m.cost)}</td>
                          <td className={'r pnl-num' + PL_negCls(m.profit)} style={{ fontWeight: 700 }}>{PL_fmt(m.profit)}</td>
                          <td className={'r pnl-num' + PL_negCls(mg)}>{PL_fmtPct(mg)}</td>
                        </tr>
                      );
                    })}
                    <tr className="pnl-det-total">
                      <td></td><td>รวม {cb.count} เครื่อง</td>
                      <td className="r pnl-num">{PL_fmt(cb.price)}</td>
                      <td className="r pnl-num">{PL_fmt(cb.machine)}</td>
                      <td className="r pnl-num">{PL_fmt(cb.overhead)}</td>
                      <td className="r pnl-num">{PL_fmt(cb.labor)}</td>
                      <td className="r pnl-num">{PL_fmt(cb.cost)}</td>
                      <td className={'r pnl-num' + PL_negCls(cb.profit)}>{PL_fmt(cb.profit)}</td>
                      <td className={'r pnl-num' + PL_negCls(cb.margin)}>{PL_fmtPct(cb.margin)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="pnl-modal-note" style={{ padding: '8px 16px 14px', marginTop: 0 }}>
                  ที่มา: ชีต “ต้นทุน” ในไฟล์งบ · หน่วย: บาท · ผลรวม “ต้นทุนรวม” = บรรทัด “ต้นทุนขาย-เครื่อง BA (5101-01)” ในงบ
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* BUDGET vs ACTUAL — แสดงเฉพาะเมื่อตั้ง PL_BUDGET (BIO ยังไม่มีงบประมาณ → ซ่อน) */}
      {PL_BUDGET && (<>
      <div className="pnl-section-head" style={{ marginTop: 22 }}>
        <h2>เทียบงบประมาณประจำปี {plYear} (Budget vs Actual)</h2>
        <span className="pnl-tag">YTD สะสมถึงเดือน {PL_MONTHS_TH[Math.max(0, lastMonth - 1)]} เทียบกับเป้ารวมทั้งปี</span>
      </div>
      <div className="card pnl-card">
        <table className="pnl-budget">
          <thead><tr><th>รายการ</th><th className="r">งบประมาณ (รวมทั้งปี)</th><th className="r">ผลจริง (YTD)</th><th className="r">ส่วนต่าง</th><th className="pnl-bar-cell">% สะสมเทียบเป้า</th></tr></thead>
          <tbody>
            {budgetRows.map((r, i) => {
              // "ดี" = revenue/gp/net → สูงกว่าเป้า, cost/sga → ต่ำกว่าเป้า
              const onTrack = (r.dir === 'higher') ? r.pct >= 60 : r.pct <= 100;
              const color = r.actual < 0 && r.dir === 'higher' ? 'red' : (onTrack ? 'green' : 'amber');
              const w = Math.max(0, Math.min(100, Math.abs(r.pct)));
              // ส่วนต่าง: revenue/gp/net → +good, cost/sga → -good
              const varSign = (r.dir === 'lower' ? -1 : 1) * r.variance;
              return (
                <tr key={i}>
                  <td className="pnl-b-label">{r.name}</td>
                  <td className="r pnl-num">{PL_fmt(r.target)}</td>
                  <td className={'r pnl-num' + PL_negCls(r.actual)}>{PL_fmt(r.actual)}</td>
                  <td className={'r pnl-num' + (varSign < 0 ? ' pnl-neg' : '')} title={r.dir === 'lower' ? '+ = สูงกว่างบ (เกิน), − = ต่ำกว่างบ (ประหยัด)' : '+ = สูงกว่าเป้า, − = ต่ำกว่าเป้า'}>
                    {(r.variance >= 0 ? '+' : '') + PL_fmt(r.variance)}
                  </td>
                  <td className="pnl-bar-cell"><div className="pnl-bar-row"><div className="pnl-bar-track"><div className={'pnl-bar-fill ' + color} style={{ width: w + '%' }} /></div><div className={'pnl-bar-pct' + (r.pct < 0 ? ' pnl-neg' : '')}>{PL_fmtPct(r.pct)}</div></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="pnl-legend">
          <span><i className="pnl-dot" style={{ background: 'var(--good)' }} /> เป็นไปตามเป้า (รายได้/กำไร ≥60%, ต้นทุน/SGA ≤100%)</span>
          <span><i className="pnl-dot" style={{ background: 'var(--warn)' }} /> เบี่ยงเบนจากเป้า</span>
          <span><i className="pnl-dot" style={{ background: 'var(--bad)' }} /> ขาดทุน / ติดลบ</span>
        </div>
      </div>
      </>)}

      {/* ── วิเคราะห์ผลประกอบการ: ชาร์ต + คะแนนสุขภาพ + CFO Insight (แบบ finance-tools) ── */}
      <PLAnalytics c={c} groups={groups} model={model} lastMonth={lastMonth} bal={bal} />

      {/* UPLOAD MODAL — เปิดจากปุ่ม "อัปโหลดข้อมูล" บน hero banner */}
      <Modal open={uploadOpen} onClose={() => { setUploadOpen(false); setFile(null); }} wide
        title="อัปโหลดงบกำไรขาดทุน (ชีต PL)">
        <div style={{ padding: '8px 20px 18px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginBottom: 12 }}>
            นำเข้าไฟล์ Excel งบกำไรขาดทุนเปรียบเทียบรายเดือน — ระบบอ่าน <b>ชีต PL</b> (รหัสบัญชี + หัวคอลัมน์เป็นเดือน) ทุกเดือนพร้อมกัน แล้วเขียนทับข้อมูลทั้งหมด
          </div>
          <div className="pnl-upload-row">
            <div className={'pnl-dropzone' + (drag ? ' drag' : '') + (file ? ' has-file' : '')}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
              onDrop={onDrop}>
              <div className="pnl-dz-ic"><Icon name="upload" size={22} /></div>
              <div className="pnl-dz-main">{file ? <>เลือกไฟล์แล้ว: <u>{file.name}</u></> : <>ลากไฟล์มาวางที่นี่ หรือ <u>เลือกไฟล์</u></>}</div>
              <div className="pnl-dz-sub">{file ? (file.size / 1024 / 1024).toFixed(2) + ' MB · พร้อมนำเข้า' : 'รองรับ .xlsx (ไฟล์งบกำไรขาดทุน) ขนาดไม่เกิน 10 MB'}</div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden
                onChange={(e) => pickFile(e.target.files[0])} />
            </div>
            <div className="pnl-upload-side">
              <div className="pnl-field" style={{ background: 'var(--ink-50)', borderRadius: 8, padding: '10px 12px' }}>
                <span style={{ fontWeight: 600, color: 'var(--ink-600)' }}>วิธีนำเข้า</span>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)', lineHeight: 1.7, marginTop: 4 }}>
                  • อ่าน <b>ทุกเดือน</b> จากชีต PL อัตโนมัติ (ไม่ต้องเลือกเดือน)<br/>
                  • ปี/เดือนอ่านจากหัวคอลัมน์ในไฟล์<br/>
                  • รอบถัดไป: re-export ไฟล์ที่มีเดือนใหม่แล้วอัปทับได้เลย
                </div>
              </div>
              <button className="btn btn-primary" disabled={busy || !file} onClick={handleVerify}>
                <Icon name="check" size={14} /> {busy ? 'กำลังประมวลผล…' : 'ตรวจสอบและนำเข้า'}
              </button>
              <div className="pnl-hint"><Icon name="search" size={13} /> จัดกลุ่มบัญชีอัตโนมัติจากรหัส (prefix) · หากพบรหัสที่จัดกลุ่มไม่ได้จะให้เลือกกลุ่มก่อนบันทึก · <b>การอัปจะแทนที่ข้อมูลเดิมทั้งหมด</b></div>
            </div>
          </div>
        </div>
      </Modal>

      {/* DETAIL MODAL (single group) */}
      <Modal open={!!detailKey} onClose={() => setDetailKey(null)} wide
        title={detailKey ? PL_GROUP_META[detailKey].th + ' — ' + PL_GROUP_META[detailKey].line : ''}>
        {detailKey && (() => {
          const det = detailFor(detailKey);
          return (
            <div style={{ padding: '4px 20px 18px' }}>
              <div className="pnl-type-badge">TYPE: {PL_TYPES[det.type]}</div>
              {det.accounts.length === 0
                ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-400)' }}>ยังไม่มีรายการบัญชีย่อยใน ฐาน DATA สำหรับกลุ่มนี้</div>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="pnl-det-tbl" style={{ minWidth: 280 + lastMonth * 92 }}>
                      <thead><tr><th style={{ width: 96 }}>รหัส</th><th>ชื่อบัญชี</th>{PL_MONTHS_TH.slice(0, lastMonth).map((m, i) => <th key={i} className="r">{m}</th>)}<th className="r">รวม</th></tr></thead>
                      <tbody>
                        {det.accounts.map((a, i) => (
                          <tr key={i}>
                            <td>{PL_isInvCode(a.code)
                              ? <span style={{ fontSize: 10.5, fontWeight: 600, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>สต๊อก</span>
                              : <span className="pnl-acc-code">{a.code}</span>}</td>
                            <td>{a.name || '—'}</td>
                            {a.arr.slice(0, lastMonth).map((v, m) => <td key={m} className={'r pnl-num' + PL_negCls(v)}>{PL_fmt(v, { blankZero: true })}</td>)}
                            <td className={'r pnl-num' + PL_negCls(a.total)}>{PL_fmt(a.total)}</td>
                          </tr>
                        ))}
                        <tr className="pnl-det-total">
                          <td></td><td>รวมกลุ่ม {det.th}</td>
                          {groups[detailKey].slice(0, lastMonth).map((v, m) => <td key={m} className={'r pnl-num' + PL_negCls(v)}>{PL_fmt(v, { blankZero: true })}</td>)}
                          <td className={'r pnl-num' + PL_negCls(det.total)}>{PL_fmt(det.total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              <div className="pnl-modal-note">หน่วย: บาท · ยอดสะสม {lastMonth} เดือน · คลิกบรรทัดอื่นในงบเพื่อดูกลุ่มถัดไป</div>
            </div>
          );
        })()}
      </Modal>

      {/* GROUP-MAP MODAL (all 9 groups accordion) */}
      <Modal open={mapOpen} onClose={() => setMapOpen(false)} wide title="ผังการจัดกลุ่มบัญชี">
        <div style={{ padding: '4px 20px 18px' }}>
          <div className="pnl-modal-note" style={{ marginTop: 0, marginBottom: 12 }}>ระบบจัดบัญชีแยกประเภท (GL) เข้า 6 กลุ่มตามนี้ — คลิกแต่ละกลุ่มเพื่อดูบัญชีย่อย (สต๊อกต้นงวด/ปลายงวด รวมอยู่ในต้นทุนขาย)</div>
          {PL_GROUP_ORDER.map(key => {
            const det = detailFor(key);
            const open = openGrp === key;
            return (
              <div key={key} className={'pnl-grp-acc' + (open ? ' open' : '')}>
                <div className="pnl-grp-hd" onClick={() => setOpenGrp(open ? null : key)}>
                  <span className={'pnl-grp-dot ' + (PL_isRevenue(key) ? 'rev' : 'cost')} />
                  <div style={{ flex: 1, minWidth: 0 }}><div className="pnl-grp-th">{det.th}</div><div className="pnl-grp-line">{det.line}</div></div>
                  <span className="pnl-grp-cnt">{det.accounts.length} บัญชี</span>
                  <span className={'pnl-grp-tot' + PL_negCls(det.total)}>{PL_fmt(det.total)}</span>
                  <svg className="pnl-grp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg>
                </div>
                {open && (
                  <div className="pnl-grp-body">
                    {det.accounts.length === 0
                      ? <div style={{ padding: '8px 0', color: 'var(--ink-400)' }}>ยังไม่มีบัญชีย่อยในกลุ่มนี้</div>
                      : (
                        <table className="pnl-det-tbl">
                          <thead><tr><th style={{ width: 92 }}>รหัส</th><th>ชื่อบัญชี</th><th className="r" style={{ width: 130 }}>ยอดสะสม</th></tr></thead>
                          <tbody>
                            {det.accounts.map((a, i) => (
                              <tr key={i}><td>{PL_isInvCode(a.code)
                              ? <span style={{ fontSize: 10.5, fontWeight: 600, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>สต๊อก</span>
                              : <span className="pnl-acc-code">{a.code}</span>}</td><td>{a.name || '—'}</td><td className={'r pnl-num' + PL_negCls(a.total)}>{PL_fmt(a.total)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="pnl-modal-note">รวม 6 กลุ่ม · หน่วย: บาท · ยอดสะสม {lastMonth} เดือน</div>
        </div>
      </Modal>
    </div>
  );
}

window.PnLPage = PnLPage;
