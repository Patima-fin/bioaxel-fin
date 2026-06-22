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
function PL_inferGroup(code, name) {
  const raw = String(code || '').trim();
  const c = raw.replace(/[^0-9]/g, '');
  const n = String(name || '');
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
    const rows = accts.map(a => ({ code: a.code, name: a.name, arr: a.arr, total: PL_sum(a.arr, lastMonth) }))
      .sort((x, y) => Math.abs(y.total) - Math.abs(x.total));
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
        const codeRe = /^\d{4}-\d{1,2}$/;       // รูปแบบ BIO (4110-01)
        const codeReLoose = /^\d{4,7}$/;        // เผื่อไฟล์รุ่นไม่มีขีด
        const isCode = (s) => codeRe.test(s) || codeReLoose.test(s);
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
        const byCode = {};
        for (let i = hdrIdx + 1; i < aoa.length; i++) {
          const row = aoa[i] || [];
          const code = String(row[codeCol] == null ? '' : row[codeCol]).trim();
          if (!isCode(code)) continue;           // ข้ามแถว section/subtotal (ไม่มีรหัส)
          const name = String(row[nameCol] == null ? '' : row[nameCol]).trim();
          let rec = byCode[code];
          if (!rec) rec = byCode[code] = { code, name, m: new Array(12).fill(0) };
          if (!rec.name && name) rec.name = name;
          monthCols.forEach(mc => { rec.m[mc.month - 1] += num(row[mc.col]); });
        }
        const accounts = Object.keys(byCode).map(c => byCode[c]);
        const monthsPresent = monthCols.map(mc => mc.month).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
        const year = yearCE ? yearCE + 543 : 0;   // ค.ศ. → พ.ศ.
        const mn = monthsPresent;
        const monthsLabel = mn.length
          ? (mn.length > 1 ? PL_MONTHS_TH[mn[0] - 1] + '–' + PL_MONTHS_TH[mn[mn.length - 1] - 1] : PL_MONTHS_TH[mn[0] - 1]) + (year ? ' ' + year : '')
          : '';
        resolve({ accounts, monthsPresent, year, monthsLabel });
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
      const unknown = parsed.accounts.filter(a => !PL_inferGroup(a.code, a.name));
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
      const rows = parsed.accounts.map(a => {
        const code = String(a.code).trim();
        const grp = (groupOverride && groupOverride[code]) || PL_inferGroup(code, a.name) || '';
        const row = { code, name: a.name || '', group: grp, year: parsed.year || PL_YEAR_DEFAULT, updatedAt: now };
        for (let m = 1; m <= 12; m++) row['m' + m] = Number(a.m[m - 1]) || 0;
        return row;
      }).filter(r => r.group);   // กันบัญชีที่จัดกลุ่มไม่ได้หลุดเข้าฐาน (ปกติไม่มี)
      if (!rows.length) { toast('จัดกลุ่มบัญชีไม่สำเร็จ — โปรดตรวจผังบัญชี'); setBusy(false); return; }
      await window.WTPData.writeTable('pnlBase', rows, r => String(r.code));
      toast('นำเข้างบ ' + (parsed.monthsLabel || '') + ' สำเร็จ (' + rows.length + ' บัญชี) — กำลังรีเฟรช');
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

      {/* ── AI INSIGHTS ─────────────────────────────────────────────────── */}
      {(() => {
        // วิเคราะห์จากข้อมูล BIO เอง (ไม่มีงบประมาณ) — เน้นโครงสร้างต้นทุน/ตัวฉุดผลประกอบการ
        const insights = [];
        const elapsed  = lastMonth || 1;
        const rev      = PL_sum(c.totalRevenue, lastMonth);
        const cogsYtd  = PL_sum(groups.cogs, lastMonth);
        const sgaYtd   = PL_sum(c.totalSGA, lastMonth);
        const adminYtd = PL_sum(groups.admin, lastMonth);
        const finYtd   = PL_sum(groups.finance, lastMonth);
        const gpYtd    = PL_sum(c.grossProfit, lastMonth);
        const sellAdminYtd = PL_sum(groups.selling, lastMonth) + adminYtd;  // ขาย+บริหาร (ไม่รวมการเงิน)
        const pbfYtd   = gpYtd - sellAdminYtd;                              // ขาดทุนจากดำเนินงานก่อนต้นทุนการเงิน
        const pctRev   = (v) => rev ? v / rev * 100 : 0;
        // 1) ผลสุทธิ
        if (k.net < 0) {
          insights.push({
            kind: 'critical', icon: '🚨', title: 'ขาดทุนสุทธิ ' + PL_fmt(-k.net) + ' บาท (' + PL_fmtPct(Math.abs(pctRev(k.net))) + ' ของรายได้)',
            body: 'YTD ' + elapsed + ' เดือน · รายได้ ' + PL_fmt(rev) + ' · ค่าใช้จ่ายรวม ' + PL_fmt(cogsYtd + sgaYtd) +
                  ' = ต้นทุนขาย ' + PL_fmt(cogsYtd) + ' + ขาย/บริหาร ' + PL_fmt(sellAdminYtd) + ' + การเงิน ' + PL_fmt(finYtd),
          });
        } else if (k.net > 0) {
          insights.push({ kind: 'good', icon: '✅', title: 'กำไรสุทธิ ' + PL_fmt(k.net) + ' บาท (' + PL_fmtPct(pctRev(k.net)) + ' ของรายได้)', body: 'YTD สะสม ' + elapsed + ' เดือน' });
        }
        // 2) อัตรากำไรขั้นต้น / ต้นทุนขาย
        if (gpYtd < 0) {
          insights.push({ kind: 'critical', icon: '⚠️', title: 'ขายต่ำกว่าทุน — กำไรขั้นต้นติดลบ',
            body: 'ต้นทุนขาย ' + PL_fmt(cogsYtd) + ' > รายได้ ' + PL_fmt(rev) + ' (ต้นทุน = ' + PL_fmtPct(pctRev(cogsYtd)) + ' ของรายได้) · ทบทวนการตั้งราคา/ต้นทุนต่อหน่วย' });
        } else if (k.gpM < 20) {
          insights.push({ kind: 'risk', icon: '📊', title: 'อัตรากำไรขั้นต้นบาง (' + PL_fmtPct(k.gpM) + ')',
            body: 'ต้นทุนขาย = ' + PL_fmtPct(pctRev(cogsYtd)) + ' ของรายได้ · เหลือกำไรขั้นต้น ' + PL_fmt(gpYtd) + ' รองรับค่าใช้จ่ายขาย/บริหาร/การเงิน ' + PL_fmt(sgaYtd) });
        }
        // 3) ค่าใช้จ่ายบริหารเทียบกำไรขั้นต้น (ตัวฉุดหลัก)
        if (adminYtd > 0 && gpYtd > 0 && adminYtd > gpYtd) {
          insights.push({ kind: 'risk', icon: '🔴', title: 'ค่าใช้จ่ายบริหารสูงกว่ากำไรขั้นต้น',
            body: 'บริหาร ' + PL_fmt(adminYtd) + ' (' + PL_fmtPct(pctRev(adminYtd)) + ' ของรายได้) · กำไรขั้นต้นมีแค่ ' + PL_fmt(gpYtd) + ' → ค่าใช้จ่ายคงที่ (เงินเดือน/ค่าเสื่อม) กดดันผลประกอบการ' });
        }
        // 4) ขาดทุนจากการดำเนินงาน (ก่อนต้นทุนการเงิน)
        if (pbfYtd < 0) {
          insights.push({ kind: 'info', icon: '📉', title: 'ขาดทุนจากการดำเนินงานก่อนต้นทุนการเงิน ' + PL_fmt(-pbfYtd),
            body: 'กำไรขั้นต้น ' + PL_fmt(gpYtd) + ' − ค่าใช้จ่ายขาย/บริหาร ' + PL_fmt(sellAdminYtd) + ' = ' + PL_fmt(pbfYtd) + ' · บวกต้นทุนการเงินอีก ' + PL_fmt(finYtd) });
        }
        // 5) ต้นทุนการเงิน
        if (finYtd > 0 && rev > 0 && pctRev(finYtd) >= 5) {
          insights.push({ kind: 'info', icon: '🏦', title: 'ต้นทุนการเงิน ' + PL_fmt(finYtd) + ' (' + PL_fmtPct(pctRev(finYtd)) + ' ของรายได้)',
            body: 'ดอกเบี้ยจ่าย/เช่าซื้อสะสม ' + elapsed + ' เดือน · ภาระดอกเบี้ยสูงเมื่อเทียบกับรายได้ปัจจุบัน' });
        }
        // 6) แนวโน้มเดือนล่าสุด vs ก่อนหน้า
        if (lastMonth >= 2) {
          const cur = c.netProfit[lastMonth - 1] || 0, prev = c.netProfit[lastMonth - 2] || 0;
          if (prev !== 0) {
            const diff = cur - prev, better = diff > 0;
            insights.push({ kind: better ? 'good' : 'info', icon: better ? '📈' : '📉',
              title: 'ผลเดือน ' + PL_MONTHS_TH[lastMonth - 1] + ' ' + (better ? 'ดีขึ้น' : 'แย่ลง') + ' ' + PL_fmt(Math.abs(diff)) + ' จากเดือนก่อน',
              body: PL_MONTHS_TH[lastMonth - 2] + ' ' + PL_fmt(prev) + ' → ' + PL_MONTHS_TH[lastMonth - 1] + ' ' + PL_fmt(cur) });
          }
        }
        if (insights.length === 0) {
          insights.push({ kind: 'good', icon: '🎉', title: 'ไม่พบประเด็นเสี่ยงสำคัญ', body: 'ผลประกอบการอยู่ในเกณฑ์ปกติ' });
        }

        return (
          <>
            <div className="pnl-section-head" style={{ marginTop: 22 }}>
              <h2>🤖 AI วิเคราะห์จุดเสี่ยง / โฟกัส</h2>
              <span className="pnl-tag">วิเคราะห์ YTD: โครงสร้างต้นทุน · อัตรากำไร · แนวโน้ม</span>
            </div>
            <div className="card pnl-card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {insights.map((ins, i) => {
                  const palette = {
                    critical: { bg: '#fef2f2', border: '#fca5a5', accent: '#dc2626' },
                    risk:     { bg: '#fffbeb', border: '#fcd34d', accent: '#d97706' },
                    good:     { bg: '#f0fdf4', border: '#86efac', accent: '#16a34a' },
                    info:     { bg: '#eff6ff', border: '#9ed3ad', accent: '#2e8b4a' },
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
                * วิเคราะห์อัตโนมัติจากข้อมูลงบ YTD — เป็น guideline ไม่ใช่คำแนะนำการลงทุน
              </div>
            </div>
          </>
        );
      })()}

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
