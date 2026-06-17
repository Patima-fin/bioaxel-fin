// BIOAXEL — งบกำไรขาดทุน (P&L) · separate add-on page.
// Reads the "ฐาน DATA" sheet tab (via WTPData.fetchSheetRows) and computes the
// income statement entirely in-browser. Upload flow posts a NEW additive Apps
// Script action ('plImportMonth') — it never touches existing endpoints.
//
// Globals reused from the app shell: React, Icon, Modal, KpiTile, fmtNum,
// useToasts, WTPData, WTP_CONFIG, XLSX.
//
// ── Canonical "ฐาน DATA" schema this page expects (1 row per GL account) ──
//   group : one of PL_GROUP_ORDER keys (saleGoods, service, otherIncome,
//           cogs, costService, commission, selling, admin, finance)
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

// 9 TYPE labels — ตรงกับบรรทัดในงบ (index = ลำดับใน PL_GROUP_ORDER)
const PL_TYPES = [
  'รายได้จากการขายสินค้า (Reveneue from sale of goods)',
  'รายได้จากการบริการ (Reveneue from service)',
  'รายได้อื่น (Other income)',
  'ต้นทุนขายสินค้า (Cost of goods sold)',
  'ต้นทุนบริการ (Cost of service)',
  'ค่าคอมมิชชั่น (Commission)',
  'ค่าใช้จ่ายในการขาย (Selling expenses)',
  'ค่าใช้จ่ายในการบริหาร (Administrative expenses)',
  'ต้นทุนทางการเงิน (Finance costs)',
];

const PL_GROUP_ORDER = ['saleGoods','service','otherIncome','cogs','costService','commission','selling','admin','finance'];

const PL_GROUP_META = {
  saleGoods:   { line: 'Reveneue from sale of goods',  th: 'รายได้จากการขายสินค้า',      type: 0 },
  service:     { line: 'Reveneue from service',        th: 'รายได้จากการบริการ',          type: 1 },
  otherIncome: { line: 'Other income',                 th: 'รายได้อื่น',                   type: 2 },
  cogs:        { line: 'Cost of goods sold',           th: 'ต้นทุนขายสินค้า',             type: 3 },
  costService: { line: 'Cost of service',              th: 'ต้นทุนบริการ',                 type: 4 },
  commission:  { line: 'Commission',                   th: 'ค่าคอมมิชชั่น',                type: 5 },
  selling:     { line: 'Selling expenses',             th: 'ค่าใช้จ่ายในการขาย',          type: 6 },
  admin:       { line: 'Administrative expenses',      th: 'ค่าใช้จ่ายในการบริหาร',        type: 7 },
  finance:     { line: 'Finance costs',                th: 'ต้นทุนทางการเงิน',             type: 8 },
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

// ── งบประมาณประจำปี 2569 (จาก DATA Budget.xlsx — Sheet "ประมาณการกำไร ขาดทุน") ──
// ใช้เปรียบเทียบ "รวมทั้งปี" YTD กับเป้าหมาย (ไม่เทียบรายเดือน)
const PL_BUDGET_2569 = {
  year: 2569,
  // — Revenue —
  salesRevenue:   1474020000.00,   // รายได้จากการขาย (รวม saleGoods + service ใน actual)
  otherIncome:       1285251.00,   // รายได้อื่นๆ
  revenue:        1475305251.00,   // รวมรายได้
  // — Cost of Construction —
  constructCost:  1091566895.37,   // ต้นทุนงานก่อสร้าง (cogs + costService)
  commission:       94632084.00,   // ค่าคอมมิชชั่น
  totalCost:      1186198979.37,   // รวมต้นทุนงานก่อสร้าง
  grossProfit:     287821020.63,   // กำไรขั้นต้น
  // — SG&A —
  selling:          12751002.62,   // ค่าใช้จ่ายในการขาย
  admin:           151791445.58,   // ค่าใช้จ่ายในการบริหาร
  finance:          63857611.83,   // ต้นทุนทางการเงิน
  totalSGA:        228400060.03,   // รวมค่าใช้จ่ายขายและบริหาร (เป้า แนน)
  netProfit:        59420960.61,   // กำไร(ขาดทุน)สุทธิ
};

// ── Ground-truth account → group lookup (เรียนรู้จาก TYP.xlsx — 168 บัญชี) ──
// เพื่อให้การ classify หลัง upload เป็น deterministic + auto-fill new-account UI
// 2 type พิเศษจาก TYP ('Income tax payable' + 'Income tax') ถูก route ไป admin
// ก่อน (ยังไม่มี group เฉพาะสำหรับภาษี — รออัปเดต report layout)
const PL_KNOWN_ACCOUNTS = {
  '4100001':'saleGoods','4100002':'service','4100003':'saleGoods','4100004':'service',
  '4200001':'saleGoods',
  '4300002':'otherIncome','4300003':'otherIncome','4300004':'otherIncome','4300005':'otherIncome','4300006':'otherIncome','4300007':'otherIncome',
  '4400001':'otherIncome','4400002':'otherIncome','4400003':'otherIncome',
  '5110001':'cogs','5110002':'cogs','5110003':'cogs',
  '5120000':'costService','5121001':'cogs','5130001':'cogs','5140001':'cogs',
  '5200000':'cogs','5200001':'cogs','5200002':'commission','5200003':'cogs','5200004':'cogs','5200005':'costService','5200006':'cogs','5200007':'cogs','5200008':'cogs',
  '5211001':'admin','5212001':'admin','5213001':'admin','5221000':'costService','5223000':'admin',
  '5311001':'selling','5311002':'selling','5311003':'selling','5311004':'admin','5311005':'selling',
  '5312002':'selling','5312003':'selling','5312004':'selling','5312005':'selling','5312006':'selling','5312008':'selling','5312009':'selling','5312010':'selling','5312011':'selling','5312012':'selling','5312013':'selling',
  '5320001':'selling','5320002':'selling','5330002':'selling',
  '5340002':'selling','5340004':'selling','5340005':'selling','5340007':'selling','5340008':'selling','5340009':'selling','5340010':'selling','5340012':'selling','5340013':'selling','5340014':'selling','5340015':'selling',
  '5350001':'selling','5350002':'selling','5350003':'selling',
  '5361002':'admin','5361003':'admin','5362001':'admin','5362002':'admin','5362003':'admin','5363005':'admin','5363006':'admin',
  '5380001':'admin','5380002':'admin','5380003':'admin',
  '6100001':'selling',
  '6201003':'admin','6201004':'admin',
  '6211001':'admin','6211002':'admin','6211003':'admin','6211004':'admin',
  '6212001':'admin','6212002':'admin','6212003':'admin','6212004':'admin','6212005':'admin','6212006':'admin','6212007':'admin','6212008':'admin','6212009':'admin','6212010':'admin','6212011':'admin','6212012':'admin',
  '6220001':'admin','6220002':'admin','6220003':'admin','6220004':'admin',
  '6230001':'admin','6230002':'admin','6230003':'admin',
  '6241001':'admin','6241002':'admin','6241003':'admin',
  '6242001':'admin','6242002':'admin',
  '6243001':'admin','6243002':'admin','6243003':'admin','6243004':'admin',
  '6244001':'admin','6244002':'admin','6244003':'admin',
  '6245001':'admin','6245002':'admin','6245003':'admin','6245004':'admin',
  '6246001':'admin','6246003':'admin','6246004':'admin','6246007':'admin','6246008':'admin','6246009':'admin',
  '6251001':'admin','6251002':'admin','6251003':'admin','6251004':'admin','6251005':'finance','6251006':'admin','6251007':'admin',
  '6252001':'admin','6252002':'admin','6252003':'admin',
  '6253002':'admin','6253003':'admin','6253006':'admin',
  '6261002':'admin','6261003':'admin','6261004':'admin','6261005':'admin','6261006':'admin','6261007':'admin','6261008':'admin',
  '6262002':'admin','6262003':'admin',
  '6270001':'admin','6270002':'admin','6270003':'admin','6270004':'admin','6270005':'admin','6270006':'admin',
  '7100001':'finance','7200001':'finance','7200002':'finance','7200003':'finance','7200004':'finance',
  '7300001':'admin',
  '7400001':'admin','7400002':'admin','7400003':'otherIncome','7401001':'admin','7401002':'otherIncome',
  '7500001':'admin','7500002':'admin','7500003':'admin',
};

const PL_REVENUE_KEYS = { saleGoods: 1, service: 1, otherIncome: 1 };
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

// ── infer group from chart-of-accounts code prefix (fallback only) ──
// ปรับให้แม่นกับผังบัญชี BIOAXEL / WaterPOG (ตรวจกับ TB01.xlsx ม.ค. 2569)
//   4100001  รายได้ค่าบริการก่อสร้าง         → saleGoods
//   4100002  PM CM                            → service
//   4100003  POC adjustment                   → saleGoods (contra)
//   4100004  หลังการขาย                       → service
//   4200001  ขายสินค้า                        → otherIncome (per legacy report bucket)
//   4300xxx / 4400xxx                          → otherIncome
//   5110xxx / 5121xxx / 5130xxx / 5140xxx     → cogs
//   5200000 / 5200008                          → cogs
//   5200002                                    → commission
//   5120000 / 5200005 / 5221xxx               → costService
//   5200001/3/4/6/7 / 5211xxx / 5213xxx / 5223xxx → costService
//   53xxxxx                                    → selling
//   54xxxxx / 55xxxxx / 6xxxxxx               → admin
//   56xxxxx (& รายการมีคำว่า "ดอกเบี้ย")     → finance
function PL_inferGroup(code, name) {
  const c = String(code || '').replace(/[^0-9]/g, '');
  const n = String(name || '');
  if (!c) return null;
  // 0) บัญชีพัก / งบดุล — ไม่อยู่ในงบกำไรขาดทุน (เช่น 7900002 ลูกหนี้-เจ้าหนี้ ตั้งพัก)
  //    กันออกถาวร ไม่ว่าจะหลุดมาในไฟล์หรือค้างจาก import เก่า
  if (/ตั้งพัก|พักรอ|suspense|clearing/i.test(n)) return null;
  if (c.slice(0, 2) === '79') return null;
  // 1) ground-truth จาก TYP.xlsx ก่อน — แม่นยำ 100% สำหรับ 168 บัญชีที่บัญชีระบุไว้
  if (PL_KNOWN_ACCOUNTS[c]) return PL_KNOWN_ACCOUNTS[c];
  // prefix rules
  const p2 = c.slice(0, 2), p3 = c.slice(0, 3), p4 = c.slice(0, 4);
  const first = c[0];
  // revenue
  if (p2 === '41') return 'saleGoods';
  if (p2 === '42' || p2 === '43' || p2 === '44' || p2 === '49') return 'otherIncome';
  // expense: finance-keyword (ดอกเบี้ย/ค่าธรรมเนียมธนาคาร) — applies only to 5xxx/6xxx/7xxx, not 4xxx (interest income)
  if (first !== '4' && /ดอกเบี้ย|ค่าธรรมเนียมธนาคาร|interest|bank\s*fee/i.test(n)) return 'finance';
  // cogs (construction materials / direct labor / POC cost / extra work)
  if (p3 === '511' || (p3 === '512' && p4 !== '5120') || p3 === '513' || p3 === '514') return 'cogs';
  if (c === '5200000' || c === '5200008') return 'cogs';
  // costService (rest of 52xxxxx + 521xxx-523xxx)
  if (p2 === '52') return 'costService';
  // selling (marketing dept)
  if (p2 === '53') return 'selling';
  // admin (back-office + 6xxxxx general overhead)
  if (p2 === '54' || p2 === '55' || first === '6') return 'admin';
  // finance prefix
  if (p2 === '56') return 'finance';
  // 7xxx: tax / dividend / financing-service / suspense
  if (first === '7') {
    if (p2 === '74') return 'admin';            // ภาษีเงินได้
    if (p2 === '75') return 'finance';          // ค่าบริการทางการเงิน (STS/factoring)
    if (p2 === '73') return 'admin';            // เงินปันผลจ่าย (treated as admin appropriation)
    return 'admin';                              // 79xx suspense etc.
  }
  // last-resort
  if (first === '4') return 'otherIncome';
  if (first === '5' || first === '6') return 'admin';
  return null;
}

// Sample data (design mock) — used ONLY when ฐาน DATA can't be read yet.
const PL_SAMPLE = {
  lastMonth: 4,
  groups: {
    saleGoods:   [17428766.05, 38129318.29, 39416963.70, 33566347.43, 0,0,0,0,0,0,0,0],
    service:     [ 1914212.90,  1884933.35,  1546591.84,  1718591.79, 0,0,0,0,0,0,0,0],
    otherIncome: [  245257.76,   269864.52,  -388345.17,   109361.66, 0,0,0,0,0,0,0,0],
    cogs:        [13328720.46, 29080923.21, 36681133.79, 21037218.98, 0,0,0,0,0,0,0,0],
    costService: [ 1930712.73,  1790991.10,  1067633.80,  1635288.68, 0,0,0,0,0,0,0,0],
    commission:  [ 2280067.83,  1563171.83,  3007320.42,  1824827.56, 0,0,0,0,0,0,0,0],
    selling:     [  983985.43,   948741.28,   802137.10,   959612.65, 0,0,0,0,0,0,0,0],
    admin:       [ 8574563.13, 11571532.94, 11540779.64,  8429023.06, 0,0,0,0,0,0,0,0],
    finance:     [ 4174039.65,  4026281.01,  3786441.08,  4039440.82, 0,0,0,0,0,0,0,0],
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
    accounts[g].push({ code: String(code || ''), name: String((nKey ? r[nKey] : '') || ''), arr });
    used++;
  });
  if (!used) return null;

  let lastMonth = 0;
  for (let m = 0; m < 12; m++) {
    if (PL_GROUP_ORDER.some(k => Math.abs(groups[k][m]) > 0.005)) lastMonth = m + 1;
  }
  return { groups, accounts, lastMonth: lastMonth || 1 };
}

// ── compute subtotals (ported verbatim from design PL_compute) ──
function PL_compute(d, lastMonth) {
  const salesRevenue  = PL_addArr(d.saleGoods, d.service);
  const totalRevenue  = PL_addArr(salesRevenue, d.otherIncome);
  // ต้นทุนงานก่อสร้าง = Cost of goods sold + Cost of service + Commission (รวม 3 รายการ)
  const constructCost = PL_addArr(PL_addArr(d.cogs, d.costService), d.commission);
  const totalCost     = constructCost;
  const grossProfit   = totalRevenue.map((v, i) => v - totalCost[i]);
  const gpMargin      = grossProfit.map((v, i) => totalRevenue[i] ? (v / totalRevenue[i] * 100) : NaN);
  const totalSGA      = PL_addArr(PL_addArr(d.selling, d.admin), d.finance);
  const netProfit     = grossProfit.map((v, i) => v - totalSGA[i]);
  const trend = netProfit.map((v, i) => {
    if (i === 0 || netProfit[i - 1] === 0 || i >= lastMonth) return NaN;
    return (v - netProfit[i - 1]) / Math.abs(netProfit[i - 1]) * 100;
  });
  return { salesRevenue, totalRevenue, constructCost, totalCost, grossProfit, gpMargin, totalSGA, netProfit, trend };
}

// ───────────────────────────────────────────────────────────────────────────
function PnLPage({ data, setData, toast }) {
  const [loading, setLoading]   = plState(true);
  const [model, setModel]       = plState(null);  // { groups, accounts, lastMonth }
  const [isSample, setIsSample] = plState(false);
  const [detailKey, setDetailKey] = plState(null); // open group-detail modal
  const [mapOpen, setMapOpen]   = plState(false);   // group-map modal
  const [openGrp, setOpenGrp]   = plState(PL_GROUP_ORDER[0]); // accordion expanded key
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

  const loadData = () => {
    setLoading(true);
    if (!window.WTPData || !WTPData.fetchSheetRows) {
      setModel(PL_SAMPLE.groups ? { groups: PL_SAMPLE.groups, accounts: {}, lastMonth: PL_SAMPLE.lastMonth } : null);
      setIsSample(true); setLoading(false); return;
    }
    WTPData.fetchSheetRows(PL_SHEET)
      .then(rows => {
        const parsed = PL_parseRows(rows);
        if (parsed) { setModel(parsed); setIsSample(false); }
        else { setModel({ groups: PL_SAMPLE.groups, accounts: {}, lastMonth: PL_SAMPLE.lastMonth }); setIsSample(true); }
      })
      .catch(() => { setModel({ groups: PL_SAMPLE.groups, accounts: {}, lastMonth: PL_SAMPLE.lastMonth }); setIsSample(true); })
      .finally(() => setLoading(false));
  };
  plEffect(() => { loadData(); }, []);

  const lastMonth = model ? model.lastMonth : 0;
  const groups = model ? model.groups : null;
  const comp = plMemo(() => groups ? PL_compute(groups, lastMonth) : null, [groups, lastMonth]);

  // default month to import = next month after last data
  const [impMonth, setImpMonth] = plState(1);
  const [impAudit, setImpAudit] = plState('PRE-CLOSING');
  plEffect(() => { setImpMonth(Math.min((lastMonth || 0) + 1, 12) || 1); }, [lastMonth]);

  // known account codes (for new-account detection)
  const knownCodes = plMemo(() => {
    const set = new Set();
    if (model && model.accounts) Object.values(model.accounts).forEach(list => list.forEach(a => a.code && set.add(String(a.code).trim())));
    return set;
  }, [model]);

  // ── detail rows for a group (real accounts; sorted desc by YTD) ──
  const detailFor = (key) => {
    const accts = (model && model.accounts && model.accounts[key]) || [];
    const rows = accts.map(a => ({ code: a.code, name: a.name, arr: a.arr, total: PL_sum(a.arr, lastMonth) }))
      .sort((x, y) => Math.abs(y.total) - Math.abs(x.total));
    return { key, ...PL_GROUP_META[key], accounts: rows, total: PL_sum(groups[key], lastMonth) };
  };

  // ── upload handlers ──
  const pickFile = (f) => { if (f) setFile(f); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); };

  // parse the uploaded workbook → [{code,name,amount}] for the chosen month
  const parseWorkbook = (f) => new Promise((resolve, reject) => {
    if (!window.XLSX) { reject(new Error('ไม่พบไลบรารี SheetJS — รีเฟรชหน้า')); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: false, cellNF: true });
        // prefer a sheet named like DATA INPUT, else first sheet
        const sn = wb.SheetNames.find(n => /data\s*input|input|ฐาน/i.test(n)) || wb.SheetNames[0];
        const ws = wb.Sheets[sn];
        const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        if (!aoa.length) { resolve([]); return; }
        // find header row (the one containing a code-ish + amount-ish column)
        let hdrIdx = 0;
        for (let i = 0; i < Math.min(aoa.length, 8); i++) {
          const joined = aoa[i].map(c => String(c || '').toLowerCase()).join('|');
          if (/code|รหัส|ชื่อบัญชี|name|amount|ยอด|จำนวน/.test(joined)) { hdrIdx = i; break; }
        }
        // normalize header row: บังคับให้ทุกช่องเป็น string (ป้องกัน sparse slot จาก XLSX
        // เช่น col L ใน TB01 ที่ไม่มี header — findCol second-pass เคยพังตรงนี้)
        const hdrRaw = aoa[hdrIdx] || [];
        const hdr = [];
        for (let i = 0; i < hdrRaw.length; i++) hdr[i] = String(hdrRaw[i] == null ? '' : hdrRaw[i]).trim().toLowerCase();
        // findCol: 2-pass — ตรงตัวก่อน (exact match) แล้วจึง substring
        // เพื่อให้ 'ac_code' ชนะ 'maincode' (ทั้งคู่มี 'code' เป็น substring)
        const findCol = (names) => {
          for (const n of names) { for (let i = 0; i < hdr.length; i++) { if (hdr[i] === n) return i; } }
          for (const n of names) { for (let i = 0; i < hdr.length; i++) { if (hdr[i] && hdr[i].indexOf(n) >= 0) return i; } }
          return -1;
        };
        const cCol = findCol(['ac_code', 'code', 'รหัสบัญชี', 'รหัส', 'maincode']);
        const nCol = findCol(['ac_des', 'ชื่อบัญชี', 'name', 'description', 'desc', 'รายการ']);
        const aCol = findCol(['amount', 'ยอด', 'จำนวน', 'net', 'total']);
        // หลัก: คำนวณจาก cur_dr / cur_cr (ของเดือนนั้น) ตามประเภทบัญชี
        //   Revenue (4xxx) : amount = cur_cr − cur_dr   (บวก = revenue ปกติ)
        //   Expense (5xxx+): amount = cur_dr − cur_cr   (บวก = expense ปกติ)
        // วิธีนี้รองรับทั้ง:
        //   - TB01 (col L = signed-by-type, positive)
        //   - TB02+ (col L = uniform =I-H, expense negative)
        //   - Cost reversal (เช่น TB04 5140001 cur_cr=2M, cur_dr=0 → −2M = "ลดต้นทุน" ✓)
        // ใช้ col L เฉพาะเป็น fallback ถ้าไม่มี cur_dr/cur_cr
        const cdrCol = findCol(['cur_dr', 'cur dr', 'curdr']);
        const ccrCol = findCol(['cur_cr', 'cur cr', 'curcr']);
        const lCol = 11;
        const num = (v) => {
          const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
          return isNaN(n) ? 0 : n;
        };
        const out = [];
        for (let i = hdrIdx + 1; i < aoa.length; i++) {
          const row = aoa[i];
          const code = cCol >= 0 ? String(row[cCol] || '').trim() : '';
          if (!code) continue;
          const first = String(code).trim().charAt(0);
          let amount = 0;
          if (aCol >= 0) {
            amount = num(row[aCol]);
          } else if (cdrCol >= 0 && ccrCol >= 0) {
            const cdr = num(row[cdrCol]), ccr = num(row[ccrCol]);
            amount = first === '4' ? (ccr - cdr) : (cdr - ccr);
          } else {
            // fallback: col L + sign normalize สำหรับ expense
            amount = num(row[lCol]);
            if (first !== '4' && amount < 0) amount = -amount;
          }
          out.push({ code, name: nCol >= 0 ? String(row[nCol] || '').trim() : '', amount });
        }
        // ── Clean-missing feature ──────────────────────────────────────────────
        // เพิ่มบัญชีที่อยู่ใน TYP ground-truth แต่ "ไม่อยู่ในไฟล์เดือนนั้น" ด้วย amount=0
        // เพื่อให้ Apps Script ทับ m{month} เป็น 0 → ลบยอดค้างจาก upload เก่าที่ผิด
        // (เช่น upload TB02 ตอนเลือกเดือน 1 → m1 ของ 6220002 ค้างอยู่ 14,360 → reset เป็น 0)
        const seenCodes = new Set(out.map(a => String(a.code).replace(/[^0-9]/g, '')));
        for (const knownCode of Object.keys(PL_KNOWN_ACCOUNTS)) {
          if (!seenCodes.has(knownCode)) {
            out.push({ code: knownCode, name: '', amount: 0 });
          }
        }
        resolve(out);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsArrayBuffer(f);
  });

  const handleVerify = async () => {
    if (!file) { toast('โปรดเลือกไฟล์ก่อนนำเข้า'); return; }
    setBusy(true);
    try {
      const accts = await parseWorkbook(file);
      if (!accts.length) { toast('ไม่พบรายการบัญชีในไฟล์ — ตรวจหัวคอลัมน์ (code/name/amount)'); setBusy(false); return; }
      // "ใหม่" = ไม่อยู่ใน ฐาน DATA cloud + ไม่อยู่ใน TYP ground-truth (PL_KNOWN_ACCOUNTS)
      // → บัญชีที่ TYP รู้จักอยู่แล้วจะถูก pre-classify เงียบๆ ไม่ต้อง popup ให้พี่จัดกลุ่มเอง
      const unknown = accts.filter(a => {
        const code = String(a.code).trim();
        return !knownCodes.has(code) && !PL_KNOWN_ACCOUNTS[code.replace(/[^0-9]/g, '')];
      });
      if (unknown.length) {
        setNewAccts(unknown.map(a => ({ ...a, group: PL_inferGroup(a.code, a.name) || '' })));
        toast('พบผังบัญชีใหม่ ' + unknown.length + ' รายการ — โปรดจัดประเภท (อีก ' + (accts.length - unknown.length) + ' รายการ ระบบจัดให้แล้ว)');
        setUploadOpen(false);
        setBusy(false);
      } else {
        toast('จัดกลุ่มจาก TYP ครบ ' + accts.length + ' รายการ · กำลังบันทึก…');
        await postImport(accts, []);
      }
    } catch (err) { toast('ผิดพลาด: ' + err.message); setBusy(false); }
  };

  // นำเข้า P&L ลง Supabase (ตาราง pnlBase) — aggregate รายเดือนฝั่ง client
  //   (ย้าย logic plUpsertBase_ จาก Apps Script มาทำที่นี่: set m{month} ต่อ code,
  //    เพิ่ม code ใหม่, เคลียร์ m{month}=0 ของ code ที่ไม่อยู่ในไฟล์ใหม่) แล้วเขียนทั้งตารางกลับ
  const postImport = async (accounts, newClassified) => {
    if (!window.WTPData || !window.WTPData.writeTable) { toast('ระบบยังไม่พร้อม'); setBusy(false); return; }
    const month = Number(impMonth);
    if (!(month >= 1 && month <= 12)) { toast('เดือนไม่ถูกต้อง (1–12)'); setBusy(false); return; }
    const mKey = 'm' + month;
    const newGroupByCode = {};
    (newClassified || []).forEach(a => { const c = String(a.code).trim(); if (c) newGroupByCode[c] = a.group || ''; });
    setBusy(true);
    try {
      // 1) โหลด base ปัจจุบัน
      const baseRows = await window.WTPData.fetchSheetRows('pnlBase');
      const byCode = {};
      (baseRows || []).forEach(r => { const c = String(r.code || '').trim(); if (c) byCode[c] = Object.assign({}, r); });
      // 2) upsert ยอดเดือน month ต่อ code
      const now = new Date().toISOString().slice(0, 10);
      const fileCodes = {};
      let created = 0, updated = 0;
      accounts.forEach(a => {
        const code = String(a.code).trim(); if (!code) return;
        fileCodes[code] = 1;
        const grp = newGroupByCode[code] || a.group || PL_inferGroup(a.code, a.name) || '';
        const amount = Number(a.amount) || 0;
        let row = byCode[code];
        if (row) {
          row[mKey] = amount;
          if (!String(row.name || '').trim() && a.name) row.name = a.name;
          if (!String(row.group || '').trim() && grp) row.group = grp;
          row.updatedAt = now; updated++;
        } else {
          row = { code: code, name: a.name || '', group: grp };
          for (let m = 1; m <= 12; m++) row['m' + m] = (m === month ? amount : 0);
          row.updatedAt = now;
          byCode[code] = row; created++;
        }
      });
      // 3) เคลียร์ m{month}=0 ของ code ที่ไม่อยู่ในไฟล์ใหม่ (ยึดไฟล์ใหม่)
      const cleared = [];
      Object.keys(byCode).forEach(code => {
        if (fileCodes[code]) return;
        const prev = Number(byCode[code][mKey]) || 0;
        if (Math.abs(prev) > 0.005) { byCode[code][mKey] = 0; byCode[code].updatedAt = now; cleared.push({ code: code, name: byCode[code].name || '', amount: prev }); }
      });
      // 4) เขียนทั้งตารางกลับ Supabase (id = code)
      const out = Object.keys(byCode).map(c => byCode[c]);
      await window.WTPData.writeTable('pnlBase', out, r => String(r.code));
      if (cleared.length) {
        const names = cleared.slice(0, 4).map(a => (a.code || '') + ' ' + (a.name || '')).join(', ');
        toast('นำเข้าเดือน ' + PL_MONTHS_TH[month - 1] + ' สำเร็จ · ตัด ' + cleared.length + ' บัญชีที่ไม่อยู่ในไฟล์ (' + names + (cleared.length > 4 ? ' …' : '') + ') — กำลังรีเฟรช');
      } else {
        toast('นำเข้าเดือน ' + PL_MONTHS_TH[month - 1] + ' สำเร็จ (เพิ่ม ' + created + ' · อัปเดต ' + updated + ') — กำลังรีเฟรช');
      }
      setNewAccts(null); setFile(null); setUploadOpen(false);
      setTimeout(loadData, 600);
    } catch (err) { toast('นำเข้าไม่สำเร็จ: ' + (err && err.message || err)); }
    finally { setBusy(false); }
  };

  const confirmNewAccounts = () => {
    if (!newAccts) return;
    if (newAccts.some(a => !a.group)) { toast('โปรดจัดประเภทให้ครบทุกรายการ'); return; }
    postImport(newAccts, newAccts);
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
    { label: 'Reveneue from sale of goods', arr: d.saleGoods,   indent: true, key: 'saleGoods' },
    { label: 'Reveneue from service',       arr: d.service,     indent: true, key: 'service' },
    { label: 'รายได้จากการขาย',             arr: c.salesRevenue, cls: 'pnl-sub' },
    { label: 'Other income',                arr: d.otherIncome, indent: true, key: 'otherIncome' },
    { label: 'รวมรายได้',                   arr: c.totalRevenue, cls: 'pnl-strong' },
    { label: 'Cost of goods sold',          arr: d.cogs,        indent: true, key: 'cogs' },
    { label: 'Cost of service',             arr: d.costService, indent: true, key: 'costService' },
    { label: 'Commission',                  arr: d.commission,  indent: true, key: 'commission' },
    { label: 'ต้นทุนงานก่อสร้าง',           arr: c.constructCost, cls: 'pnl-strong' },
    { label: 'Gross Profit',                arr: c.grossProfit, cls: 'pnl-gp' },
    { label: '% margin',                    arr: c.gpMargin,    cls: 'pnl-pct', pct: true, totalVal: (PL_sum(c.totalRevenue, lastMonth) ? PL_sum(c.grossProfit, lastMonth) / PL_sum(c.totalRevenue, lastMonth) * 100 : NaN) },
    { label: 'Selling expenses',            arr: d.selling,     indent: true, key: 'selling' },
    { label: 'Administrative expenses',     arr: d.admin,       indent: true, key: 'admin' },
    { label: 'Finance costs',               arr: d.finance,     indent: true, key: 'finance' },
    { label: 'รวมค่าใช้จ่ายขายและบริหาร',    arr: c.totalSGA,    cls: 'pnl-strong' },
    { label: 'Net Profit',                  arr: c.netProfit,   cls: 'pnl-net' },
    { label: 'Trend %',                     arr: c.trend,       cls: 'pnl-pct', pct: true, totalVal: NaN },
  ];

  const renderCell = (v, pct) => {
    const has = true;
    const txt = pct ? PL_fmtPct(v) : PL_fmt(v, { blankZero: true });
    return <td key={Math.random()} className={'pnl-num' + PL_negCls(v)}>{has ? txt : '—'}</td>;
  };

  // budget 2569 — จากไฟล์ DATA Budget.xlsx (sheet "ประมาณการกำไร ขาดทุน")
  // เปรียบเทียบ "รวมทั้งปี" (YTD actual) กับงบประมาณประจำปี
  const budgetRows = [
    { name: 'รายได้รวม',                actual: k.revenue,                       target: PL_BUDGET_2569.revenue,     dir: 'higher' },
    { name: 'ต้นทุนรวม',                actual: k.cost,                          target: PL_BUDGET_2569.totalCost,   dir: 'lower'  },
    { name: 'กำไรขั้นต้น',              actual: k.gp,                            target: PL_BUDGET_2569.grossProfit, dir: 'higher' },
    { name: 'ค่าใช้จ่ายขายและบริหาร',   actual: PL_sum(c.totalSGA, lastMonth),   target: PL_BUDGET_2569.totalSGA,    dir: 'lower'  },
    { name: 'กำไร(ขาดทุน)สุทธิ',        actual: k.net,                           target: PL_BUDGET_2569.netProfit,   dir: 'higher' },
  ].map(r => {
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
    if (row.label === 'Trend %') {
      if (p === 0) return NaN;
      const prev = periods.sum(c.netProfit, p - 1);
      const curr = periods.sum(c.netProfit, p);
      return prev ? (curr - prev) / Math.abs(prev) * 100 : NaN;
    }
    return periods.sum(row.arr, p);
  };

  return (
    <div className="page pnl-page present-page" ref={pageRef}>
      {/* ── HERO BANNER ────────────────────────────────────────────────── */}
      <div className="anim-in pnl-hero" style={{
        background: 'linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)',
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
            Profit &amp; Loss Statement · ปีบัญชี {PL_BUDGET_2569.year} (สะสมตั้งแต่ต้นปี)
          </div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 10.5, opacity: 0.8, letterSpacing: 0.4 }}>ข้อมูลล่าสุดถึงเดือน</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.3 }}>
              {PL_MONTHS_TH_FULL[Math.max(0, lastMonth - 1)]} {PL_BUDGET_2569.year}
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
                background: 'rgba(255,255,255,0.95)', color: '#1e3a8a',
                border: '1px solid rgba(255,255,255,0.5)',
                fontWeight: 600,
              }} title="นำเข้า DATA INPUT ของเดือน">
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
            iconBg: '#eff6ff', iconColor: '#2563eb',
            badge: 'ยอดสะสม ' + lastMonth + ' เดือน', badgeBg: '#f1f5f9', badgeColor: '#64748b' },
          { label: 'ต้นทุนรวม', value: k.cost,
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
                    <td><span className="pnl-acc-code">{a.code}</span></td>
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
                color: viewMode === k ? '#1e3a8a' : '#64748b',
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
                } else if (row.label === 'Trend %') {
                  totVal = NaN;
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

      {/* BUDGET vs ACTUAL */}
      <div className="pnl-section-head" style={{ marginTop: 22 }}>
        <h2>เทียบงบประมาณประจำปี {PL_BUDGET_2569.year} (Budget vs Actual)</h2>
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

      {/* ── AI INSIGHTS ─────────────────────────────────────────────────── */}
      {(() => {
        const insights = [];
        const elapsed = lastMonth;
        const elapsedPct = elapsed / 12;
        const remaining = 12 - elapsed;
        const B = PL_BUDGET_2569;
        // 1) Critical: ภาวะขาดทุน vs เป้ากำไร
        if (k.net < 0 && B.netProfit > 0) {
          const catchup = B.netProfit - k.net;
          const perMonth = remaining > 0 ? catchup / remaining : catchup;
          insights.push({
            kind: 'critical', icon: '🚨', title: 'อยู่ในภาวะขาดทุน — ต้องเพิ่มกำไรเพื่อชดเชย',
            body: 'YTD ขาดทุน ' + PL_fmt(-k.net) + ' บาท · เป้าทั้งปีกำไร ' + PL_fmt(B.netProfit) + ' บาท · ' +
                  (remaining > 0
                    ? remaining + ' เดือนที่เหลือต้องทำกำไรรวม ' + PL_fmt(catchup) + ' บาท (เฉลี่ย ' + PL_fmt(perMonth) + ' บาท/เดือน)'
                    : 'หมดปีแล้ว — ห่างเป้า ' + PL_fmt(catchup) + ' บาท'),
          });
        }
        // 2) Revenue gap
        const revRatio = k.revenue / B.revenue;
        if (revRatio < elapsedPct * 0.85) {
          const gap = B.revenue * elapsedPct - k.revenue;
          insights.push({
            kind: 'risk', icon: '📉', title: 'รายได้ต่ำกว่าจังหวะที่ควรจะเป็น',
            body: 'YTD ' + PL_fmtPct(revRatio * 100) + ' ของงบทั้งปี · ควรอยู่ที่ ' + PL_fmtPct(elapsedPct * 100) + ' (' + elapsed + '/12) · ' +
                  'ขาดจากจังหวะประมาณ ' + PL_fmt(gap) + ' บาท · ต้องเร่งหา deal ก่อสร้างให้ทันเป้า',
          });
        } else if (revRatio >= elapsedPct) {
          insights.push({
            kind: 'good', icon: '✅', title: 'รายได้เป็นไปตามเป้า / นำเป้า',
            body: 'YTD ' + PL_fmtPct(revRatio * 100) + ' ของงบทั้งปี · จังหวะที่ควรอยู่ ' + PL_fmtPct(elapsedPct * 100),
          });
        }
        // 3) Cost ratio (margin)
        const actualCostPct = k.revenue ? k.cost / k.revenue * 100 : 0;
        const budgetCostPct = B.totalCost / B.revenue * 100;
        if (actualCostPct > budgetCostPct + 2) {
          insights.push({
            kind: 'risk', icon: '⚠️', title: 'ต้นทุนงานก่อสร้างสูงกว่าเป้า — gross margin หาย',
            body: 'ต้นทุน YTD = ' + PL_fmtPct(actualCostPct) + ' ของรายได้ · เป้า ' + PL_fmtPct(budgetCostPct) + ' · ' +
                  'เกินมา ' + PL_fmtPct(actualCostPct - budgetCostPct) + ' · ' +
                  'ตรวจสอบ Cost of goods sold + Commission รายโครงการ',
          });
        }
        // 4) GP margin
        const actualGpM = k.gpM;
        const budgetGpM = B.grossProfit / B.revenue * 100;
        if (actualGpM < budgetGpM - 2) {
          insights.push({
            kind: 'risk', icon: '📊', title: 'อัตรากำไรขั้นต้นต่ำกว่าเป้า',
            body: 'GP margin YTD = ' + PL_fmtPct(actualGpM) + ' · เป้า ' + PL_fmtPct(budgetGpM) + ' · ห่างเป้า ' + PL_fmtPct(budgetGpM - actualGpM) +
                  ' · ทบทวนการตั้งราคา / negotiate วัสดุ',
          });
        }
        // 5) SGA pace (annualized)
        const sgaYtd = PL_sum(c.totalSGA, lastMonth);
        const sgaAnnualized = elapsed > 0 ? sgaYtd / elapsed * 12 : 0;
        if (sgaAnnualized > B.totalSGA * 1.05) {
          insights.push({
            kind: 'risk', icon: '🔴', title: 'ค่าใช้จ่ายขายและบริหารเกินงบ (อัตราปัจจุบัน)',
            body: 'YTD ใช้ไป ' + PL_fmt(sgaYtd) + ' บาท (' + elapsed + ' เดือน) · อัตรา annualized = ' + PL_fmt(sgaAnnualized) + ' บาท · ' +
                  'งบทั้งปี ' + PL_fmt(B.totalSGA) + ' บาท · เกินงบ ' + PL_fmt(sgaAnnualized - B.totalSGA) +
                  ' · ตัด admin/selling ที่ไม่จำเป็น',
          });
        } else if (sgaAnnualized < B.totalSGA * 0.9) {
          insights.push({
            kind: 'good', icon: '💚', title: 'ค่าใช้จ่ายขายและบริหารต่ำกว่างบ',
            body: 'อัตรา annualized = ' + PL_fmt(sgaAnnualized) + ' บาท · งบ ' + PL_fmt(B.totalSGA) + ' บาท · ประหยัด ' + PL_fmt(B.totalSGA - sgaAnnualized),
          });
        }
        // 6) Trend — quarter-over-quarter Net
        if (lastMonth >= 6) {
          const q1Net = PL_sum(c.netProfit.slice(0, 3), 3);
          const q2Net = PL_sum(c.netProfit.slice(3, 6), 3);
          if (q2Net < q1Net && q1Net !== 0) {
            insights.push({
              kind: 'info', icon: '📉', title: 'แนวโน้มกำไรลดลง Q1 → Q2',
              body: 'Q1: ' + PL_fmt(q1Net) + ' บาท · Q2: ' + PL_fmt(q2Net) + ' บาท · ลดลง ' + PL_fmt(q1Net - q2Net) +
                    ' · ตรวจสอบสาเหตุ (รายได้ลด / cost เพิ่ม)',
            });
          }
        }
        // 7) Other income tiny vs budget
        if (PL_sum(c.totalRevenue, lastMonth) > 0) {
          const otherRatio = PL_sum(groups.otherIncome, lastMonth) / PL_sum(c.totalRevenue, lastMonth);
          if (otherRatio < 0) {
            insights.push({
              kind: 'info', icon: 'ℹ️', title: 'รายได้อื่นติดลบ YTD',
              body: 'รวม Other income = ' + PL_fmt(PL_sum(groups.otherIncome, lastMonth)) +
                    ' (มี contra entry บางเดือน เช่น POC adj) · ตรวจสอบรายการ adjustment',
            });
          }
        }
        // ถ้าไม่มีอะไรน่ากังวล
        if (insights.length === 0) {
          insights.push({
            kind: 'good', icon: '🎉', title: 'ทุกตัวอยู่ในเป้า — รักษาทิศทาง',
            body: 'ไม่พบประเด็นเสี่ยงสำคัญ',
          });
        }

        return (
          <>
            <div className="pnl-section-head" style={{ marginTop: 22 }}>
              <h2>🤖 AI วิเคราะห์จุดเสี่ยง / โฟกัส</h2>
              <span className="pnl-tag">วิเคราะห์ YTD เทียบงบประมาณ + อัตรากำไร + แนวโน้ม</span>
            </div>
            <div className="card pnl-card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {insights.map((ins, i) => {
                  const palette = {
                    critical: { bg: '#fef2f2', border: '#fca5a5', accent: '#dc2626' },
                    risk:     { bg: '#fffbeb', border: '#fcd34d', accent: '#d97706' },
                    good:     { bg: '#f0fdf4', border: '#86efac', accent: '#16a34a' },
                    info:     { bg: '#eff6ff', border: '#93c5fd', accent: '#2563eb' },
                  }[ins.kind] || { bg: '#f8fafc', border: '#cbd5e1', accent: '#475569' };
                  return (
                    <div key={i} style={{
                      background: palette.bg, border: '1px solid ' + palette.border,
                      borderLeft: '4px solid ' + palette.accent,
                      borderRadius: 8, padding: '12px 14px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 16 }}>{ins.icon}</span>
                        <strong style={{ fontSize: 13, color: palette.accent }}>{ins.title}</strong>
                      </div>
                      <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6, paddingLeft: 24 }}>{ins.body}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12, fontSize: 10.5, color: '#94a3b8', textAlign: 'center' }}>
                * วิเคราะห์อัตโนมัติจากข้อมูล YTD เทียบงบประมาณ — เป็น guideline ไม่ใช่คำแนะนำการลงทุน
              </div>
            </div>
          </>
        );
      })()}

      {/* UPLOAD MODAL — เปิดจากปุ่ม "อัปโหลดข้อมูล" บน hero banner */}
      <Modal open={uploadOpen} onClose={() => { setUploadOpen(false); setFile(null); }} wide
        title="อัปโหลดข้อมูลรายเดือน (DATA INPUT)">
        <div style={{ padding: '8px 20px 18px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginBottom: 12 }}>
            นำเข้าไฟล์ TB ของบัญชี (.xlsx) เพื่ออัปเดตงบประจำเดือนเข้าฐานข้อมูล
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
              <div className="pnl-dz-sub">{file ? (file.size / 1024 / 1024).toFixed(2) + ' MB · พร้อมนำเข้า' : 'รองรับ .xlsx, .csv (ชีต DATA INPUT) ขนาดไม่เกิน 10 MB'}</div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={(e) => pickFile(e.target.files[0])} />
            </div>
            <div className="pnl-upload-side">
              <label className="pnl-field"><span>เลือกเดือนที่นำเข้า</span>
                <select value={impMonth} onChange={(e) => setImpMonth(Number(e.target.value))}>
                  {PL_MONTHS_TH.map((m, i) => <option key={i} value={i + 1}>{(i + 1)} · {m} {PL_BUDGET_2569.year}</option>)}
                </select>
              </label>
              <label className="pnl-field"><span>สถานะข้อมูล</span>
                <select value={impAudit} onChange={(e) => setImpAudit(e.target.value)}>
                  <option value="PRE-CLOSING">PRE-CLOSING · ยังไม่ผ่านการตรวจสอบ</option>
                  <option value="AUDITED">AUDITED · ตรวจสอบแล้ว</option>
                </select>
              </label>
              <button className="btn btn-primary" disabled={busy || !file} onClick={handleVerify}>
                <Icon name="check" size={14} /> {busy ? 'กำลังประมวลผล…' : 'ตรวจสอบและนำเข้า'}
              </button>
              <div className="pnl-hint"><Icon name="search" size={13} /> ระบบจะเทียบผังบัญชีกับฐานข้อมูล หากพบบัญชีใหม่จะให้จัดประเภทก่อนบันทึก · บัญชีที่ไม่อยู่ในไฟล์จะถูก reset เป็น 0</div>
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
                            <td><span className="pnl-acc-code">{a.code}</span></td>
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
          <div className="pnl-modal-note" style={{ marginTop: 0, marginBottom: 12 }}>ระบบจัดบัญชีแยกประเภท (GL) เข้า 9 กลุ่มตามนี้ — คลิกแต่ละกลุ่มเพื่อดูบัญชีย่อย</div>
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
                              <tr key={i}><td><span className="pnl-acc-code">{a.code}</span></td><td>{a.name || '—'}</td><td className={'r pnl-num' + PL_negCls(a.total)}>{PL_fmt(a.total)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="pnl-modal-note">รวม 9 กลุ่ม · หน่วย: บาท · ยอดสะสม {lastMonth} เดือน</div>
        </div>
      </Modal>
    </div>
  );
}

window.PnLPage = PnLPage;
