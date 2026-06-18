// ═══════════════════════════════════════════════════════════════════════════
// Project Control Dashboard — ENGINE
// Utilities (PCU) + derivation from data.projects + column registry + grid engine
// อ้างอิงดีไซน์ Claude Design handoff (Project Control Dashboard.html) ปรับเป็น
// โทนสีสดใส brand-blue ของระบบ + อ่านจาก data.projects (117 คอลัมน์ที่ migrate แล้ว)
// ทุก identifier ขึ้นต้น PC* / pc* เพื่อกัน collision ใน global scope (in-browser Babel)
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  // ── number / date formatting ─────────────────────────────────────────────
  const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const EN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const TODAY = new Date().toISOString().slice(0, 10);

  const toNum = (v) => {
    if (v == null || v === '' || v === '-') return null;
    const n = parseFloat(String(v).replace(/[,%\s฿]/g, ''));
    return isFinite(n) ? n : null;
  };
  function fmtBaht(n, dec = 0) {
    if (n == null || isNaN(n)) return '—';
    return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function fmtCompact(n) {
    if (n == null || isNaN(n)) return '—';
    const a = Math.abs(n); let v, suf;
    if (a >= 1e9) { v = n / 1e9; suf = 'B'; }
    else if (a >= 1e6) { v = n / 1e6; suf = 'M'; }
    else if (a >= 1e3) { v = n / 1e3; suf = 'K'; }
    else return Math.round(n).toLocaleString('en-US');
    return v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 }) + suf;
  }
  // แปลงวันที่ทุกฟอร์แมตที่เจอในไฟล์วิศวกร → ISO (YYYY-MM-DD)
  // รองรับ: Date object · 22/May/26 · ISO · n/n/n (ปี 2 หรือ 4 หลัก, สลับ D/M ↔ M/D)
  // ฮิวริสติกแยก D/M กับ M/D: ถ้าเลขตัวใด > 12 ใช้ตัวนั้นเป็น "วัน" · ถ้ากำกวม →
  // ปี 4 หลัก = D/M/Y (พิมพ์มือแบบไทย) · ปี 2 หลัก = M/D/Y (Excel auto-format แบบ US)
  function isoOf(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (!s || s === '-') return null;
    let m = s.match(/^(\d{1,2})[\/\-]([A-Za-z]{3})[\/\-](\d{2,4})$/); // 22/May/26
    if (m) {
      const mi = EN_MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
      if (mi >= 0) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(mi+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
    }
    if (/^\d{4}-\d{1,2}(-\d{1,2})?/.test(s)) { // ISO (อาจมีเลขหลักเดียว)
      const p = s.split(/[-T ]/); const y = +p[0], mo = +p[1], d = +(p[2] || 1);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      return null;
    }
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/); // n/n/n (ปี 2 หรือ 4 หลัก)
    if (m) {
      const a = +m[1], b = +m[2]; let y = +m[3]; const fourDigit = m[3].length === 4;
      if (y < 100) y += 2000;
      let day, mon;
      if (a > 12 && b <= 12) { day = a; mon = b; }        // ชัดเจน D/M
      else if (b > 12 && a <= 12) { mon = a; day = b; }   // ชัดเจน M/D
      else { if (fourDigit) { day = a; mon = b; } else { mon = a; day = b; } } // กำกวม → ฮิวริสติก
      if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
      return `${y}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    return null;
  }
  function fmtDate(iso, mode = 'short') {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const yyCE = d.getFullYear();   // ค.ศ. เท่านั้น (ทั้งระบบใช้ DD/MM/YYYY ค.ศ.)
    if (mode === 'long') return `${dd} ${TH_MONTHS[d.getMonth()]} ${yyCE}`;
    return `${dd}/${String(d.getMonth() + 1).padStart(2, '0')}/${yyCE}`;
  }
  function daysFromToday(iso) {
    if (!iso) return null;
    return Math.round((new Date(iso) - new Date(TODAY)) / 86400000);
  }
  function addDays(iso, d) {
    if (!iso) return null;
    const dt = new Date(iso + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + d);
    return dt.toISOString().slice(0, 10);
  }

  // ── status meta (4 main) ──────────────────────────────────────────────────
  const STATUS_META = {
    'Work in progress': { en: 'Work in Progress', th: 'กำลังดำเนินการ', color: '#21703a', bg: '#dceaff', dot: '#2e8b4a' },
    'Finish':           { en: 'Finished',         th: 'เสร็จสิ้น',      color: '#15803d', bg: '#dcfce7', dot: '#16a34a' },
    'ยังไม่ลงนาม':       { en: 'Awaiting Signature', th: 'รอลงนาม',     color: '#b45309', bg: '#ffedd5', dot: '#f97316' },
    'ยกเลิก':           { en: 'Cancelled',        th: 'ยกเลิก',        color: '#7f1d1d', bg: '#fee2e2', dot: '#ef4444' },
  };
  // pipeline (sub-status funnel — 15 ตาม spec)
  const SUB_PIPELINE = [
    { th: 'ได้รับจัดสรรงบ', en: 'Budget Allocated' },
    { th: 'ประกาศผู้ชนะ',   en: 'Winner Announced' },
    { th: 'รอลงนาม',        en: 'Awaiting Signature' },
    { th: 'ลงนามแล้ว',      en: 'Contract Signed' },
    { th: 'เริ่มงาน',        en: 'Work Started' },
    { th: 'ดำเนินงาน',       en: 'In Progress' },
    { th: 'ส่งมอบบางส่วน',   en: 'Partial Delivery' },
    { th: 'ส่งมอบครบ',       en: 'Fully Delivered' },
    { th: 'รอตรวจรับ',       en: 'Awaiting Acceptance' },
    { th: 'ตรวจรับบางส่วน',  en: 'Partial Acceptance' },
    { th: 'ตรวจรับครบ',      en: 'Fully Accepted' },
    { th: 'รอรับเงิน',       en: 'Awaiting Payment' },
    { th: 'รับเงินบางส่วน',  en: 'Partial Payment' },
    { th: 'รับเงินครบ',      en: 'Fully Paid' },
    { th: 'ปิดโครงการ',      en: 'Project Closed' },
  ];
  const SUB_ORDER = {}; SUB_PIPELINE.forEach((p, i) => SUB_ORDER[p.th] = i);

  const REGION_EN = { 'เหนือ': 'North', 'ตะวันออกเฉียงเหนือ': 'Northeast', 'ตะวันตก': 'West', 'กลาง': 'Central', 'ตะวันออก': 'East', 'ใต้': 'South' };
  const REGION = {
    'เหนือ': ['เชียงราย','เชียงใหม่','น่าน','พะเยา','แพร่','แม่ฮ่องสอน','ลำปาง','ลำพูน','อุตรดิตถ์'],
    'ตะวันออกเฉียงเหนือ': ['กาฬสินธุ์','ขอนแก่น','ชัยภูมิ','นครพนม','นครราชสีมา','บึงกาฬ','บุรีรัมย์','มหาสารคาม','มุกดาหาร','ยโสธร','ร้อยเอ็ด','เลย','ศรีสะเกษ','สกลนคร','สุรินทร์','หนองคาย','หนองบัวลำภู','อำนาจเจริญ','อุดรธานี','อุบลราชธานี'],
    'ตะวันตก': ['กาญจนบุรี','ตาก','ประจวบคีรีขันธ์','เพชรบุรี','ราชบุรี'],
    'กลาง': ['กรุงเทพมหานคร','กรุงเทพ','กำแพงเพชร','ชัยนาท','นครนายก','นครปฐม','นครสวรรค์','นนทบุรี','ปทุมธานี','พระนครศรีอยุธยา','อยุธยา','พิจิตร','พิษณุโลก','เพชรบูรณ์','ลพบุรี','สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี','อ่างทอง','อุทัยธานี'],
    'ตะวันออก': ['จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ตราด','ปราจีนบุรี','ระยอง','สระแก้ว'],
    'ใต้': ['กระบี่','ชุมพร','ตรัง','นครศรีธรรมราช','นราธิวาส','ปัตตานี','พังงา','พัทลุง','ภูเก็ต','ยะลา','ระนอง','สงขลา','สตูล','สุราษฎร์ธานี'],
  };
  const prov2region = {}; for (const [r, ps] of Object.entries(REGION)) for (const p of ps) prov2region[p] = r;
  const regionOf = (prov) => { if (!prov) return ''; return prov2region[String(prov).replace('จ.', '').trim()] || ''; };

  const BANK_COLORS = { KTB:'#00A4E4', KBANK:'#0F9D58', SCB:'#4E2A84', BBL:'#1B2D6B', BAY:'#FFC400', GSB:'#EC008C', TTB:'#1F4E9D' };
  const CREDITORS = { 'KTB':1, 'WCI+STS':1, 'WCI':1, 'LIT':1, 'Funding':1, 'P2P':1 };
  const CREDITOR_NAMES = { KTB:'ธนาคารกรุงไทย', 'WCI+STS':'WCI + STS', WCI:'WCI', LIT:'LIT', Funding:'Funding', P2P:'P2P' };

  // ── Finance Master persistence (PROJECT_FINANCE_MASTER) ──────────────────
  // เก็บ LG / debt / creditTerm / remark / ผู้รับโอนสิทธิ ที่ฝ่ายการเงินกรอกเอง
  // keyed by contractNo · เก็บใน data.manualOverrides (synced ทุกเครื่อง) เป็น
  // JSON string ต่อโครงการ key = "pcfin.<ContractNo>" + cache localStorage
  // → ไม่ถูกเขียนทับเมื่อ upload Excel (แยกจาก data.projects) · ทีมเห็นเหมือนกัน
  const PC_FIN_KEY = 'wtp-pc-finance-v1';
  const PC_FIN_PREFIX = 'pcfin.';
  function loadFinanceMaster() {
    const out = {};
    // 1) cloud/synced overrides (team-shared) — มาก่อน
    try {
      const ov = (window.WTPOverride && window.WTPOverride._load) ? window.WTPOverride._load() : {};
      for (const k in ov) {
        if (k.indexOf(PC_FIN_PREFIX) === 0) {
          const code = k.slice(PC_FIN_PREFIX.length);
          try { const o = JSON.parse(ov[k]); if (o && typeof o === 'object') out[code] = o; } catch (_) {}
        }
      }
    } catch (_) {}
    // 2) localStorage cache (เครื่องตัวเอง — fallback ช่วง sync ยังไม่มา)
    try {
      const ls = JSON.parse(localStorage.getItem(PC_FIN_KEY) || '{}') || {};
      for (const code in ls) { if (!out[code]) out[code] = ls[code]; }
    } catch (_) {}
    return out;
  }
  function setFinanceField(contractNo, patch) {
    const m = loadFinanceMaster();
    // strip empty string fields เพื่อให้ JSON สะอาด
    const merged = { ...(m[contractNo] || {}), ...patch, updatedAt: TODAY };
    Object.keys(merged).forEach(k => { if (merged[k] === '' || merged[k] == null) delete merged[k]; });
    m[contractNo] = merged;
    // write cloud (synced) — JSON string ต่อโครงการ
    if (window.WTPOverride && window.WTPOverride.setRaw) {
      window.WTPOverride.setRaw(PC_FIN_PREFIX + contractNo, JSON.stringify(merged));
    }
    // write localStorage cache ด้วย (instant + offline)
    try { const ls = JSON.parse(localStorage.getItem(PC_FIN_KEY) || '{}') || {}; ls[contractNo] = merged; localStorage.setItem(PC_FIN_KEY, JSON.stringify(ls)); } catch (_) {}
    return m;
  }

  // ── derive fiscal year ────────────────────────────────────────────────────
  function deriveFy(p) {
    const code = String(p['Contract No.'] || p.code || '');
    let m = code.match(/^(?:XL|WS)-(\d{2})/i); if (m) return +m[1];
    const ref = String(p['Ref.code'] || '');
    m = ref.match(/^(\d{2})\d{2}/); if (m) return +m[1];
    const bud = String(p['งบประมาณ'] || '');
    m = bud.match(/(67|68|69)/); if (m) return +m[1];
    const s = isoOf(p['Start']); if (s) { const y = +s.slice(0, 4) + 543 - 2500; if (y >= 60 && y <= 75) return y; }
    return 0;
  }

  // ── cancellation / sign / etc flags (อิง logic page_projects เดิม) ─────────
  const isCancelledFlag = (v) => {
    if (v == null || v === '') return false;
    if (toNum(v) === 1) return true;
    return /^(❌|❎|✗|✘|x|true|yes)$/i.test(String(v).trim());
  };
  function isCancelled(p) {
    const code = String(p['Contract No.'] || p.code || '').trim();
    if (/^XL-/i.test(code)) return true;
    if (/^[A-Z]{2,5}(-\d{2,4})?$/i.test(code)) return true; // placeholder (AW, AW-68)
    for (const k in p) { if (/ยกเลิก/.test(k) && isCancelledFlag(p[k])) return true; }
    return false;
  }
  const hasSum = (p, n) => toNum(p['Summary Payment ' + n]) > 0;
  const isDelivered = (p, n) =>
    hasSum(p, n) || !!p['วันที่ส่งมอบงาน งวด ' + n] || !!p['Receive Date' + (n === 1 ? '' : n)];
  const isAccepted = (p, n) =>
    !!p['วันที่เซ็น/รับ ใบตรวจรับ งวดที่ ' + n] || !!p['วันที่เซ็น/รับ ใบตรวจรับ งวด ' + n];

  // contract amount (VAT incl, fallback × 1.07)
  function contractAmtOf(p) {
    const vat = toNum(p['มูลค่าสัญญาที่เซ็น (รวมVAT)']) || toNum(p['มูลค่าสัญญาที่เซ็น (รวม VAT)']);
    if (vat > 0) return vat;
    const pre = toNum(p['มูลค่าสัญญาที่เซ็น']) || toNum(p.signedValue);
    return pre > 0 ? Math.round(pre * 1.07 * 100) / 100 : 0;
  }

  // ── installments (รองรับไม่จำกัดงวด) ────────────────────────────────────────
  function buildInstallments(p, contract, fin) {
    const insts = [];
    const creditTerm = (fin && fin.creditTerm != null) ? fin.creditTerm : 30;
    for (let n = 1; n <= 6; n++) {
      let pct = toNum(p['% งวด ' + n]);
      const sumPay = toNum(p['Summary Payment ' + n]);
      const mv = toNum(p['มูลค่า งวด ' + n]);
      const deliveryDate = isoOf(p['วันที่ส่งมอบงาน งวด ' + n]) || isoOf(p['Receive Date' + (n === 1 ? '' : n)]);
      const acceptDate = isoOf(p['วันที่เซ็น/รับ ใบตรวจรับ งวดที่ ' + n]) || isoOf(p['วันที่เซ็น/รับ ใบตรวจรับ งวด ' + n]);
      const hasDateEvidence = !!(deliveryDate || acceptDate);
      // break/skip: need at least one data source (financial columns OR date evidence)
      if (pct == null && mv == null && sumPay == null && !hasDateEvidence && n > 2) break;
      if (pct == null && mv == null && sumPay == null && !hasDateEvidence) continue;
      let amount = mv != null ? mv : (pct != null ? Math.round(contract * pct) / 100 : (sumPay || 0));
      if (!amount && !pct) {
        // date evidence only (no financial columns) — treat as single installment = full contract
        if (hasDateEvidence && n === 1) { amount = contract || 0; pct = 100; }
        else continue;
      }
      const delivered = isDelivered(p, n) || !!deliveryDate;
      // Summary Payment N filled → paid (engineer confirms receipt); also accept Payment Status field
      const paid = hasSum(p, n) || (delivered && /done|paid|รับ/i.test(String(p['Payment ' + n + ' Status'] || '')));
      // forecast: acceptDate||deliveryDate + creditTerm
      let forecastDate = null;
      if (!paid && amount > 0) {
        const base = acceptDate || deliveryDate;
        if (base) forecastDate = addDays(base, creditTerm);
        else if (delivered) forecastDate = addDays(TODAY, creditTerm);
      }
      insts.push({
        no: n, percent: pct, amount,
        dueDate: isoOf(p['กำหนดส่งมอบงานงวด ' + n]) || null,
        deliveryDate, acceptDate, delivered, paid,
        paymentAmount: paid ? amount : 0,
        summaryPayment: sumPay || 0,   // ยอดจ่ายจริงของงวดนี้ (Summary Payment N)
        forecastDate,
      });
    }
    // ── ส่งงวดเดียว 100% (จ่ายรวม): บางโครงสัญญาแบ่งหลายงวด แต่ส่งจริงงวดเดียว ──
    // สัญญาณ = งวดใดงวดหนึ่งมี Summary Payment ≈ มูลค่าสัญญาเต็ม (จ่ายรวมทั้งสัญญา)
    // → งวดนั้นใช้ "ยอดจ่ายจริง" เป็นมูลค่า (mergedFull) · งวดก่อนที่ไม่ได้ส่ง/จ่าย = absorbed
    if (contract > 0) {
      const full = insts.find(i => i.summaryPayment > 0 && i.summaryPayment >= contract * 0.99);
      if (full) {
        full.amount = full.summaryPayment;     // ยึดยอดจ่ายจริง (เช่น 5,400,000)
        full.paymentAmount = full.summaryPayment;
        full.mergedFull = true;                 // งวดนี้ = ส่งงวดเดียว 100% รวมงวดก่อน
        insts.forEach(i => {
          if (i !== full && !i.paid && !i.delivered && i.summaryPayment === 0) {
            i.absorbed = true;                   // ถูกยกไปรวมในงวดที่จ่ายจริง — ไม่ใช่ค้างส่ง
            i.absorbedInto = full.no;
          }
        });
      }
    }
    return insts;
  }

  // ── status engine (main + sub) ─────────────────────────────────────────────
  function deriveStatus(p, contract, received, insts) {
    if (isCancelled(p)) return { main: 'ยกเลิก', sub: 'ยกเลิก' };
    const start = p['Start'] || p.startDate || '';
    const code = String(p['Contract No.'] || p.code || '');
    const signed = !!start || toNum(p['เซ็นสัญญา']) === 1 || /^WS-/i.test(code) === false && insts.some(i => i.delivered);
    const announce = toNum(p['ประกาศผู้ชนะ']) === 1;
    if (/^WS-/i.test(code) || (!start && !insts.some(i => i.delivered) && received === 0)) {
      return { main: 'ยังไม่ลงนาม', sub: announce ? 'ประกาศผู้ชนะ' : 'ได้รับจัดสรรงบ' };
    }
    if (contract > 0 && received >= contract * 0.99) return { main: 'Finish', sub: 'ปิดโครงการ' };

    const reqd = insts.filter(i => i.amount > 0 || i.percent > 0);
    const lastReq = reqd[reqd.length - 1];
    const deliveredCount = reqd.filter(i => i.delivered).length;
    const acceptedCount = reqd.filter(i => i.acceptDate).length;
    const paidCount = reqd.filter(i => i.paid).length;

    // received-based
    if (received > 0 && received < contract) return { main: 'Work in progress', sub: 'รับเงินบางส่วน' };
    // accepted but not paid → รอรับเงิน
    if (reqd.length && acceptedCount >= reqd.length) return { main: 'Work in progress', sub: 'รอรับเงิน' };
    if (acceptedCount > 0 && acceptedCount < reqd.length) return { main: 'Work in progress', sub: 'ตรวจรับบางส่วน' };
    // delivered last installment → รอตรวจรับ / ตรวจรับ
    if (lastReq && lastReq.delivered) {
      if (acceptedCount > 0) return { main: 'Work in progress', sub: 'ตรวจรับบางส่วน' };
      return { main: 'Work in progress', sub: 'รอตรวจรับ' };
    }
    if (deliveredCount > 0) return { main: 'Work in progress', sub: 'ส่งมอบบางส่วน' };
    // signed, no delivery yet
    if (start) return { main: 'Work in progress', sub: 'ดำเนินงาน' };
    return { main: 'Work in progress', sub: 'ลงนามแล้ว' };
  }

  // ── physical construction progress (ความคืบหน้างานก่อสร้างจริง) ───────────────
  // วิศวกรกรอกใน 2 คอลัมน์ที่ exclusive กัน (โครงนึงขึ้นแค่ช่องเดียว):
  //   "% (POG+STANK)" = งานหอถัง+ระบบ · "% (POG DRINK)" = งานน้ำดื่ม
  // → ความคืบหน้า = ผลรวม (ช่องที่ไม่ขึ้นจะเป็น 0/ว่าง) · นี่คือ source ที่ฝ่ายงานยึด
  function pogProgress(p) {
    if (!p) return null;
    const a = toNum(p['% (POG+STANK)']);
    const b = toNum(p['% (POG DRINK)']);
    if (a == null && b == null) return null;
    return (a || 0) + (b || 0);
  }

  // ── progress % ─────────────────────────────────────────────────────────────
  function deriveProgress(p, status, insts, received, contract) {
    if (status.main === 'ยกเลิก') return 0;
    if (status.main === 'ยังไม่ลงนาม') return 0;
    // รับเงินครบ / ปิดโครงการ → 100% เสมอ (มาก่อน POG — โครงจบแล้วถึง POG จะ < 100 ก็ตาม)
    if (status.main === 'Finish') return 100;
    // PRIMARY (ระหว่างทาง): ความคืบหน้างานก่อสร้างจริงจากคอลัมน์ POG (ตามที่ฝ่ายงานยึด)
    const pog = pogProgress(p);
    if (pog != null && pog > 0) return Math.min(100, Math.round(pog));
    // FALLBACK 1: ถ่วงน้ำหนักตามงวดงาน (เมื่อไม่มีค่า POG)
    const reqd = insts.filter(i => i.amount > 0 || i.percent > 0);
    if (reqd.length) {
      let done = 0, total = 0;
      reqd.forEach(i => {
        const w = i.percent != null ? i.percent : (i.amount / (contract || 1) * 100);
        total += w;
        if (i.paid) done += w;
        else if (i.acceptDate) done += w * 0.9;
        else if (i.delivered) done += w * 0.75;
      });
      if (total > 0) return Math.max(5, Math.min(99, Math.round(done / total * 100)));
    }
    // FALLBACK 2: ตามเงินที่รับ
    if (contract > 0 && received > 0) return Math.max(5, Math.min(99, Math.round(received / contract * 100)));
    return 20;
  }
  // progress breakdown (สำหรับแสดงที่มาของ % ใน drawer)
  function progressDetail(p, insts) {
    const reqd = insts.filter(i => i.amount > 0 || (i.percent != null && i.percent > 0));
    const pogStank = toNum(p['% (POG+STANK)']);
    const pogDrink = toNum(p['% (POG DRINK)']);
    const pog = pogProgress(p);
    return {
      // source ของ % ที่แสดง: 'pog' = งานก่อสร้างจริง · 'installment' = ถ่วงน้ำหนักงวด · 'received' = ตามเงินรับ
      source: (pog != null && pog > 0) ? 'pog' : (reqd.length ? 'installment' : 'received'),
      pog, pogStank: pogStank != null ? pogStank : null, pogDrink: pogDrink != null ? pogDrink : null,
      total: reqd.length,
      delivered: reqd.filter(i => i.delivered).length,
      accepted: reqd.filter(i => i.acceptDate).length,
      paid: reqd.filter(i => i.paid).length,
    };
  }

  // ── forecast แยก 2 งวด (baseline) ────────────────────────────────────────────
  // งวดเดียว → งวด 1 = 0, งวด 2 = 100% · หลายงวด → งวด 1 = งวดแรก, งวด 2 = ยุบงวด 2+
  // คืน fc1/fc2 (amount+date), lines (สำหรับ cashflow drill), forecastReceive รวม
  function splitForecast(insts, outstandingAR, statusMain, finishIso) {
    // งวดที่ถูกยกไปรวมในงวดสุดท้าย (absorbed) ไม่ใช่งวดที่ต้องรับเงินต่างหาก → ตัดออก
    const reqd = insts.filter(i => !i.absorbed && (i.amount > 0 || (i.percent != null && i.percent > 0)));
    const fcOf = (i) => (i && !i.paid && !i.absorbed && i.amount > 0)
      ? { amount: i.amount, date: i.forecastDate || null }
      : { amount: 0, date: null };
    let fc1 = { amount: 0, date: null }, fc2 = { amount: 0, date: null };
    if (reqd.length === 0) {
      if (outstandingAR > 0 && statusMain === 'Work in progress') {
        const d = (finishIso && finishIso > TODAY) ? finishIso : addDays(TODAY, 30);
        fc2 = { amount: outstandingAR, date: d };
      }
    } else if (reqd.length === 1) {
      fc2 = fcOf(reqd[0]);
    } else {
      fc1 = fcOf(reqd[0]);
      const rest = reqd.slice(1).filter(i => !i.paid && i.amount > 0);
      const amt = rest.reduce((s, i) => s + i.amount, 0);
      const dates = rest.map(i => i.forecastDate).filter(Boolean).sort();
      fc2 = { amount: amt, date: dates[0] || null };
    }
    const lines = [];
    if (fc1.amount > 0 && fc1.date) lines.push({ no: 1, amount: fc1.amount, date: fc1.date });
    if (fc2.amount > 0 && fc2.date) lines.push({ no: 2, amount: fc2.amount, date: fc2.date });
    const forecastReceive = (fc1.amount || 0) + (fc2.amount || 0);
    const allDates = [fc1.date, fc2.date].filter(Boolean).sort();
    return { lines, fc1, fc2, forecastReceive, forecastDate: allDates[0] || null };
  }

  // ── MAIN derive ─────────────────────────────────────────────────────────────
  // คืน array ของ project rows (dashboard shape) จาก data.projects + finance master
  function deriveProjects(rawProjects, invoices, receipts) {
    const fin = loadFinanceMaster();
    // index receipts by invoice & by project code
    const rcByIv = {};
    (receipts || []).forEach(rc => { const k = rc.invoiceNo || rc.ivNo; if (k) (rcByIv[k] = rcByIv[k] || []).push(rc); });
    const normCode = (c) => { const s = String(c || '').trim(); const m = s.match(/^(.+?)-[A-Z]{2,6}$/); return m ? m[1] : s; };
    const ivByCode = {};
    (invoices || []).forEach(iv => { const c = normCode(iv.jobNo || iv.contractRef || iv.projectCode || ''); if (c) (ivByCode[c] = ivByCode[c] || []).push(iv); });

    const out = [];
    let gid = 0;
    for (const p of (rawProjects || [])) {
      const contractNo = String(p['Contract No.'] || p.code || '').trim();
      const site = String(p['พื้นที่'] || p.name || '').trim();
      if (!contractNo && !site) continue;
      // ghost row guard (พิมพ์เล่น)
      const ghost = !contractNo.match(/\d/) && !contractAmtOf(p) && !toNum(p['งบประมาณ']) && !p['Start'] && !site;
      if (ghost) continue;

      const contract = contractAmtOf(p);
      const f = fin[contractNo] || {};
      const insts = buildInstallments(p, contract, f);

      // received: receipts via IV chain (gross), fallback to paid installments
      let received = 0;
      const ivs = ivByCode[normCode(contractNo)] || [];
      ivs.forEach(iv => { (rcByIv[iv.ivNo || iv.invoiceNo] || []).forEach(rc => { received += toNum(rc.grossAmount || rc.netReceived) || 0; }); });
      if (!received) received = insts.filter(i => i.paid).reduce((s, i) => s + i.amount, 0);
      received = Math.min(received, contract || received);

      // ── ลิงก์ใบแจ้งหนี้ (IV) + ใบเสร็จ เข้าแต่ละงวด ──────────────────────────────
      // 3 ชั้น (consume กันผูกซ้ำ): (1) period == เลขงวด · (2) ยอด IV ≈ มูลค่างวด
      // (เผื่อ period ว่าง/ไม่ตรง เช่นวิศวกรบันทึกสลับงวด) · (3) งวดเดียว → IV แรกที่เหลือ
      const ivPool = ivs.slice();
      const attachIv = (it, iv) => {
        const rcs = rcByIv[iv.ivNo || iv.invoiceNo] || [];
        const net = rcs.reduce((s, rc) => s + (toNum(rc.netReceived || rc.grossAmount) || 0), 0);
        const rcDate = rcs.map(rc => isoOf(rc.receiptDate)).filter(Boolean).sort()[0] || null;
        it.invoice = {
          ivNo: iv.ivNo || iv.invoiceNo || '',
          status: iv.status || '',
          invoiceDate: isoOf(iv.invoiceDate) || null,
          dueDate: isoOf(iv.dueDate) || null,
          balance: toNum(iv.balance),
          receivedNet: net || 0,
          receivedDate: rcDate,
        };
      };
      // pass 1: period == เลขงวด
      insts.forEach(it => {
        const idx = ivPool.findIndex(iv => String(iv.period == null ? '' : iv.period).replace(/[^0-9]/g, '') === String(it.no));
        if (idx >= 0) attachIv(it, ivPool.splice(idx, 1)[0]);
      });
      // pass 2: ยอด IV ≈ มูลค่างวด (±1%)
      insts.forEach(it => {
        if (it.invoice || !(it.amount > 0)) return;
        const idx = ivPool.findIndex(iv => { const b = toNum(iv.balance); return b != null && Math.abs(b - it.amount) <= Math.max(1, it.amount * 0.01); });
        if (idx >= 0) attachIv(it, ivPool.splice(idx, 1)[0]);
      });
      // pass 3: งวดเดียว → IV แรกที่เหลือ
      if (insts.length === 1 && !insts[0].invoice && ivPool.length) attachIv(insts[0], ivPool.shift());

      const status = deriveStatus(p, contract, received, insts);
      const progress = deriveProgress(p, status, insts, received, contract);
      const progDetail = progressDetail(p, insts);
      const outstandingAR = status.main === 'ยกเลิก' ? 0 : Math.max(0, contract - received);

      // forecast แยก 2 งวด (+ lines สำหรับ cashflow drill-down)
      const { lines: forecastLines, fc1, fc2, forecastReceive, forecastDate } =
        splitForecast(insts, outstandingAR, status.main, isoOf(p['Finish']));
      // per-งวด flags (สำหรับ advanced filter)
      const reqdInsts = insts.filter(i => i.amount > 0 || (i.percent != null && i.percent > 0));
      // Align with splitForecast: single-installment → งวด 1 = none (d1/a1/p1 all false), งวด 2 = 100%
      const _fSingle = reqdInsts.length === 1;
      const _fi1 = _fSingle ? null : reqdInsts[0];
      const _fi2plus = _fSingle ? reqdInsts : reqdInsts.slice(1);

      // finance master (manual): assignee, LG, debt, debtDeduction, remark
      const assignee = (f.assignee != null ? f.assignee : (p['ผู้รับโอนสิทธิ์'] || '')) || '';
      let lg = null;
      if (f.lgBank || f.lgAmount) lg = { bank: f.lgBank || '', amount: toNum(f.lgAmount) || 0, status: f.lgStatus || 'active', issue: f.lgIssue || null, expiry: f.lgExpiry || null };
      let debt = null;
      const debtDeduction = toNum(f.debtDeduction) || 0;
      if (CREDITORS[assignee] && contract > 0) {
        const total = toNum(f.outstandingDebt) || contract;
        debt = { creditor: assignee, total, deducted: Math.min(received, total), remaining: Math.max(0, total - received) };
      }
      const forecastDebt = (debt && forecastReceive > 0) ? Math.min(forecastReceive, debtDeduction || Math.round(forecastReceive * 0.85)) : 0;

      out.push({
        id: p.id || ('pc_' + (++gid)),
        _raw: p,
        contractNo, site,
        name: (contractNo && !/^(XL|WS)-/i.test(contractNo) ? contractNo + ' · ' : '') + (site || '—'),
        projectNo: p['Project No.'] || '', tenderNo: p['Tender No.'] || '',
        fy: deriveFy(p),
        type: p['Type'] || '', province: String(p['Province'] || '').replace('จ.', '').trim(),
        region: regionOf(p['Province']), regionEn: REGION_EN[regionOf(p['Province'])] || '',
        customer: p['Customer'] || '', budgetLabel: p['งบประมาณ'] || '', refCode: p['Ref.code'] || '',
        start: isoOf(p['Start']), finish: isoOf(p['Finish']),
        contractAmt: contract, allocation: toNum(p['เงินตามใบจัดสรร']),
        progress, progressDetail: progDetail, status: status.main, projectStatus: status.sub,
        received, outstandingAR, forecastReceive, forecastDate, forecastDebt,
        forecastNet: forecastReceive - forecastDebt,
        // forecast แยกงวด
        fc1Amount: fc1.amount || 0, fc1Date: fc1.date || null,
        fc2Amount: fc2.amount || 0, fc2Date: fc2.date || null,
        forecastLines,
        // per-งวด flags (advanced filter)
        d1: !!(_fi1 && _fi1.delivered), a1: !!(_fi1 && _fi1.acceptDate), p1: !!(_fi1 && _fi1.paid),
        d2: _fi2plus.some(i => i.delivered), a2: _fi2plus.some(i => !!i.acceptDate), p2: _fi2plus.some(i => i.paid),
        assignee, lg, debt, creditTerm: (f.creditTerm != null ? f.creditTerm : 30), remark: f.remark || (p['Remark'] || ''),
        installments: insts,
        _manualStatus: p.manualStatus || p._manualStatus || '',
      });
    }
    return dedupeProjectRows(out);
  }

  // ── dedupe safety net ────────────────────────────────────────────────────────
  // กันโครงซ้ำที่หลุดมาจาก sync (เช่น โครงไม่มีเลขสัญญา code=null โผล่ 2 แถว) โดย:
  //  • โครงที่มี "เลขสัญญาจริง" (ไม่ใช่ XL-/WS-) → เก็บไว้เสมอ (เลขต่างกัน = คนละสัญญา
  //    ที่ประมูลใหม่/คนละปีงบ — ไม่ยุบ); เลขจริงซ้ำกันเป๊ะ → เก็บตัวข้อมูลครบสุด
  //  • โครงไม่มีเลข/เลขสังเคราะห์ (XL-/WS-) → ถ้ามีพี่น้องชื่อ+ปีงบเดียวกันที่มีเลขจริง
  //    อยู่แล้ว → ตัดทิ้ง (เป็น placeholder รอลงนามที่ถูกแทนแล้ว); ถ้าไม่มี → เก็บแค่ตัวเดียว
  function dedupeProjectRows(rows) {
    const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const isReal = (c) => !!c && !/^(XL|WS)-/i.test(String(c));
    const completeness = (r) => Object.keys(r._raw || {}).filter(k => { const v = r._raw[k]; return v != null && v !== ''; }).length;
    // name+fy ที่มีเลขสัญญาจริงอยู่แล้ว
    const realNF = new Set();
    rows.forEach(r => { if (isReal(r.contractNo)) realNF.add(norm(r.site) + '|' + r.fy); });
    const byRealCode = new Map();   // เลขจริง → row ครบสุด
    const bySynthNF = new Map();    // name+fy (ไม่มีเลขจริง) → row ครบสุด
    const result = [];
    for (const r of rows) {
      if (isReal(r.contractNo)) {
        const k = String(r.contractNo).trim();
        const prev = byRealCode.get(k);
        if (!prev) { byRealCode.set(k, r); result.push(r); }
        else if (completeness(r) > completeness(prev)) {
          const i = result.indexOf(prev); if (i >= 0) result[i] = r; byRealCode.set(k, r);
        }
        continue;
      }
      // synthetic/empty code
      const nf = norm(r.site) + '|' + r.fy;
      if (realNF.has(nf)) continue;          // ถูกแทนด้วยโครงที่มีเลขจริงแล้ว
      const prev = bySynthNF.get(nf);
      if (!prev) { bySynthNF.set(nf, r); result.push(r); }
      else if (completeness(r) > completeness(prev)) {
        const i = result.indexOf(prev); if (i >= 0) result[i] = r; bySynthNF.set(nf, r);
      }
    }
    return result;
  }

  // ── aggregations ────────────────────────────────────────────────────────────
  function summarize(rows) {
    const s = { count: rows.length, wip: 0, finish: 0, awaiting: 0, cancelled: 0,
      contractTotal: 0, wipAmt: 0, finishAmt: 0, awaitAmt: 0, cancelAmt: 0,
      outstandingAR: 0, received: 0, forecast30: 0, forecast60: 0, forecast90: 0,
      lgTotal: 0, debtTotal: 0, debtRemaining: 0, debtDeducted: 0 };
    for (const r of rows) {
      const amt = r.contractAmt || 0;
      if (r.status === 'Work in progress') { s.wip++; s.wipAmt += amt; }
      else if (r.status === 'Finish') { s.finish++; s.finishAmt += amt; }
      else if (r.status === 'ยังไม่ลงนาม') { s.awaiting++; s.awaitAmt += amt; }
      else if (r.status === 'ยกเลิก') { s.cancelled++; s.cancelAmt += amt; }
      s.contractTotal += amt;
      s.outstandingAR += r.outstandingAR || 0;
      s.received += r.received || 0;
      const dd = daysFromToday(r.forecastDate);
      if (dd != null && dd >= 0) {
        if (dd <= 30) s.forecast30 += r.forecastReceive || 0;
        if (dd <= 60) s.forecast60 += r.forecastReceive || 0;
        if (dd <= 90) s.forecast90 += r.forecastReceive || 0;
      }
      if (r.lg) s.lgTotal += r.lg.amount || 0;
      if (r.debt) { s.debtTotal += r.debt.total; s.debtRemaining += r.debt.remaining; s.debtDeducted += r.debt.deducted; }
    }
    return s;
  }
  function pipelineCounts(rows) {
    const m = {}; SUB_PIPELINE.forEach(p => m[p.th] = 0);
    rows.forEach(r => { if (m[r.projectStatus] != null) m[r.projectStatus]++; });
    return SUB_PIPELINE.map(p => ({ ...p, count: m[p.th] }));
  }
  // cashflow รายเดือน — bucket ราย "งวด" (forecastLines) ไม่ใช่ราย project
  // เพราะโครงเดียวกัน งวด 1 / งวด 2 รับคนละเดือน · months[i].lines = drill-down
  function cashflowByMonth(rows, year) {
    const months = EN_MONTHS.map((m, i) => ({ month: m, idx: i, gross: 0, debt: 0, net: 0, count: 0, lines: [] }));
    for (const r of rows) {
      const debtRatio = r.forecastReceive > 0 ? (r.forecastDebt || 0) / r.forecastReceive : 0;
      (r.forecastLines || []).forEach(ln => {
        if (!ln.date || !ln.amount) return;
        const d = new Date(ln.date); if (d.getFullYear() !== year) return;
        const mo = months[d.getMonth()];
        const dbt = ln.amount * debtRatio;
        mo.gross += ln.amount; mo.debt += dbt; mo.net += ln.amount - dbt; mo.count++;
        mo.lines.push({ row: r, no: ln.no, amount: ln.amount, date: ln.date });
      });
    }
    months.forEach(mo => mo.lines.sort((a, b) => String(a.date).localeCompare(String(b.date))));
    return months;
  }
  function forecastYears(rows) {
    const ys = new Set();
    rows.forEach(r => (r.forecastLines || []).forEach(ln => { if (ln.date) ys.add(new Date(ln.date).getFullYear()); }));
    return [...ys].sort();
  }
  function lgByBank(rows) {
    const m = {};
    rows.forEach(r => { if (!r.lg || !r.lg.bank) return; const b = r.lg.bank;
      if (!m[b]) m[b] = { bank: b, color: BANK_COLORS[b] || '#21703a', amount: 0, count: 0, active: 0, expired: 0, released: 0 };
      m[b].amount += r.lg.amount || 0; m[b].count++; m[b][r.lg.status] = (m[b][r.lg.status] || 0) + 1; });
    return Object.values(m).sort((a, b) => b.amount - a.amount);
  }
  function debtByCreditor(rows) {
    const m = {};
    rows.forEach(r => { if (!r.debt) return; const c = r.debt.creditor;
      if (!m[c]) m[c] = { creditor: c, name: CREDITOR_NAMES[c] || c, total: 0, remaining: 0, deducted: 0, count: 0 };
      m[c].total += r.debt.total; m[c].remaining += r.debt.remaining; m[c].deducted += r.debt.deducted; m[c].count++; });
    return Object.values(m).sort((a, b) => b.total - a.total);
  }

  // ── column spec (จากไฟล์ "โครงสร้างไฟล์.xlsx" ที่ฝ่ายการเงินจัดประเภท) ─────────
  // cat = ประเภท · web = แสดงในเว็บ (1 ต้องมี, 2 ถ้ามี, 0 ไม่โชว์) · exp = ให้เลือกตอน export
  // เป็น single source of truth สำหรับ: grid columns + advanced filter + export picker
  const PC_COL_SPEC = [
    {key:"No.",cat:"พื้นฐาน",web:0,exp:0},
    {key:"Tender No.",cat:"พื้นฐาน",web:0,exp:0},
    {key:"Project No.",cat:"พื้นฐาน",web:0,exp:0},
    {key:"เลขที่สัญญา WTP-SUB",cat:"พื้นฐาน",web:0,exp:0},
    {key:"Contract No.",cat:"พื้นฐาน",web:1,exp:1},
    {key:"พื้นที่",cat:"พื้นฐาน",web:1,exp:1},
    {key:"Type",cat:"พื้นฐาน",web:1,exp:1},
    {key:"งานก่อสร้าง",cat:"พื้นฐาน",web:0,exp:0},
    {key:"ก่อสร้างจริง",cat:"พื้นฐาน",web:0,exp:0},
    {key:"งานขาย",cat:"พื้นฐาน",web:0,exp:0},
    {key:"Region",cat:"พื้นฐาน",web:0,exp:1},
    {key:"Province",cat:"พื้นฐาน",web:0,exp:1},
    {key:"Start",cat:"พื้นฐาน",web:1,exp:1},
    {key:"Finish",cat:"พื้นฐาน",web:1,exp:1},
    {key:"Timeline",cat:"พื้นฐาน",web:1,exp:1},
    {key:"Duration",cat:"พื้นฐาน",web:0,exp:0},
    {key:"จำนวนวันที่โดนปรับจริง",cat:"พื้นฐาน",web:0,exp:0},
    {key:"กำหนดส่งมอบงานงวด 1",cat:"พื้นฐาน",web:1,exp:1},
    {key:"ระยะเวลาก่อสรางจริง (วัน)",cat:"พื้นฐาน",web:0,exp:1},
    {key:"งบประมาณ",cat:"พื้นฐาน",web:1,exp:1},
    {key:"Ref.code",cat:"พื้นฐาน",web:0,exp:0},
    {key:"เงินตามใบจัดสรร",cat:"พื้นฐาน",web:2,exp:1},
    {key:"ประกาศผู้ชนะ",cat:"พื้นฐาน",web:0,exp:0},
    {key:"เซ็นสัญญา",cat:"พื้นฐาน",web:0,exp:0},
    {key:"เลขที่สัญญา",cat:"พื้นฐาน",web:0,exp:0},
    {key:"ยกเลิกโครงการ",cat:"พื้นฐาน",web:0,exp:0},
    {key:"สัญญา-Subcontract",cat:"พื้นฐาน",web:0,exp:0},
    {key:"PR-Subcontract",cat:"พื้นฐาน",web:0,exp:0},
    {key:"PR Consult",cat:"พื้นฐาน",web:0,exp:0},
    {key:"มูลค่าสัญญาที่เซ็น",cat:"พื้นฐาน",web:0,exp:0},
    {key:"มูลค่าสัญญาที่เซ็น (รวมVAT)",cat:"พื้นฐาน",web:2,exp:1},
    {key:"% งวด 1",cat:"พื้นฐาน",web:0,exp:1},
    {key:"% งวด 2",cat:"พื้นฐาน",web:0,exp:1},
    {key:"มูลค่า งวด 1",cat:"พื้นฐาน",web:1,exp:1},
    {key:"มูลค่า งวด 2",cat:"พื้นฐาน",web:1,exp:1},
    {key:"% ค่าปรับต่อวัน",cat:"พื้นฐาน",web:0,exp:0},
    {key:"บาท/วัน",cat:"พื้นฐาน",web:0,exp:0},
    {key:"ระยะเวลาการรับประกัน",cat:"พื้นฐาน",web:0,exp:0},
    {key:"แบบแปลน ver.",cat:"พื้นฐาน",web:0,exp:0},
    {key:"ฝั่งเดียว",cat:"พื้นฐาน",web:0,exp:0},
    {key:"สองฝั่ง",cat:"พื้นฐาน",web:0,exp:0},
    {key:"Customer",cat:"พื้นฐาน",web:0,exp:0},
    {key:"งานเสาเข็ม",cat:"เสาเข็ม",web:0,exp:0},
    {key:"ความยาวเสาเข็ม (m)",cat:"เสาเข็ม",web:0,exp:0},
    {key:"จำนวนเสาเข็ม ACFS TANK",cat:"เสาเข็ม",web:0,exp:0},
    {key:"จำนวนเสาเข็ม ACC TANK",cat:"เสาเข็ม",web:0,exp:0},
    {key:"จำนวนเสาเข็ม UFS TANK",cat:"เสาเข็ม",web:0,exp:0},
    {key:"จำนวนเสาเข็ม PF TANK",cat:"เสาเข็ม",web:0,exp:0},
    {key:"มูลค่างานเพิ่มเสาเข็ม",cat:"เสาเข็ม",web:0,exp:0},
    {key:"1.งานทดสอบการรับน้ำหนักบรรทุกดิน และงานเสาเข็ม (10%)",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"ขั้น 1 วันที่แล้วเสร็จ",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"2.งานฐานราก (10%)",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"ขั้น 2 วันที่แล้วเสร็จ",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"3.งาน PnP  (20%)",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"ขั้น 3 วันที่แล้วเสร็จ",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"4.งาน ACFS, SFX และงานระบบ (50%)",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"ขั้น 4 วันที่แล้วเสร็จ",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"5.งาน Commissioning Test & Jar Test (10%)",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"ขั้น 5 วันที่แล้วเสร็จ",cat:"ความคืบหน้า",web:0,exp:1},
    {key:"% (POG+STANK)",cat:"ความคืบหน้า",web:2,exp:2},
    {key:"1. งานฐานพื้นคอนกรีต (10%)",cat:"ความคืบหน้า",web:0,exp:0},
    {key:"ขั้น 1 วันที่แล้วเสร็จ2",cat:"ความคืบหน้า",web:0,exp:0},
    {key:"2.1 งานติดตั้ง RO (50%)",cat:"ความคืบหน้า",web:0,exp:0},
    {key:"2.2 งานติดตั้งโรงเรือน RO (20%)",cat:"ความคืบหน้า",web:0,exp:0},
    {key:"2.3 งานประสานระบบไฟฟ้าและระบบประปา (10%)",cat:"ความคืบหน้า",web:0,exp:0},
    {key:"ขั้น 2 วันที่แล้วเสร็จ2",cat:"ความคืบหน้า",web:0,exp:0},
    {key:"3 งาน Commissioning Test (10%)",cat:"ความคืบหน้า",web:0,exp:0},
    {key:"ขั้น 3 วันที่แล้วเสร็จ2",cat:"ความคืบหน้า",web:0,exp:0},
    {key:"% (POG DRINK)",cat:"ความคืบหน้า",web:2,exp:2},
    {key:"นส.ส่งมอบงาน งวด 1",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"วันที่ส่ง นส.มอบงาน งวด 1",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"วันที่ส่งมอบงาน งวด 1",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"นส.ส่งมอบงาน งวด 2",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"วันที่ส่ง นส.มอบงาน งวด 2",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"วันที่ส่งมอบงาน งวด 2",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"ใบตรวจรับการจัดซื้อ/จัดจ้าง งวด 1",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"วันที่เซ็น/รับ ใบตรวจรับ งวดที่ 1",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"ใบตรวจรับการจัดซื้อ/จัดจ้าง งวด 2",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"วันที่เซ็น/รับ ใบตรวจรับ งวด 2",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"Payment 1",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"Summary Payment 1",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"Payment 1 Status",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"Receive Date",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"Payment 2",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"Summary Payment 2",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"Payment 2 Status",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"Receive Date2",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"Payment 3",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"Summary Payment 3",cat:"ส่งมอบ/รับเงิน",web:2,exp:2},
    {key:"Payment 3 Status",cat:"ส่งมอบ/รับเงิน",web:2,exp:2},
    {key:"Receive Date3",cat:"ส่งมอบ/รับเงิน",web:0,exp:0},
    {key:"TOTAL",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"Receive",cat:"ส่งมอบ/รับเงิน",web:1,exp:1},
    {key:"BOQ",cat:"อื่นๆ",web:0,exp:0},
    {key:"Forecast Income งวด 1",cat:"อื่นๆ",web:0,exp:0},
    {key:"Forecast Income งวด 2",cat:"อื่นๆ",web:0,exp:0},
    {key:"หยุดเวลา",cat:"อื่นๆ",web:2,exp:1},
    {key:"แจ้งเข้าดำเนินการ",cat:"อื่นๆ",web:0,exp:1},
    {key:"ขยายเวลา",cat:"อื่นๆ",web:0,exp:1},
    {key:"แนบท้ายสัญญา",cat:"อื่นๆ",web:0,exp:0},
    {key:"แนบท้ายสัญญา-Subcontract",cat:"อื่นๆ",web:0,exp:0},
    {key:"วันที่แนบท้ายสัญญา-Subcontract",cat:"อื่นๆ",web:0,exp:0},
    {key:"ไฟล์สำรวจโครงการ",cat:"อื่นๆ",web:0,exp:0},
    {key:"Close Project",cat:"อื่นๆ",web:0,exp:0},
    {key:"Google Map URL",cat:"อื่นๆ",web:0,exp:0},
    {key:"ผู้รับโอนสิทธิ์",cat:"อื่นๆ",web:0,exp:0},
    {key:"ขั้น 1",cat:"อื่นๆ",web:0,exp:0},
    {key:"ขั้น 2",cat:"อื่นๆ",web:0,exp:0},
    {key:"ขั้น 3",cat:"อื่นๆ",web:0,exp:0},
    {key:"ขั้น 4",cat:"อื่นๆ",web:0,exp:0},
    {key:"ขั้น 5",cat:"อื่นๆ",web:0,exp:0},
    {key:"รับรู้รายได้",cat:"อื่นๆ",web:0,exp:0},
    {key:"% Progress",cat:"อื่นๆ",web:0,exp:0},
    {key:"Remark",cat:"อื่นๆ",web:0,exp:0},
    {key:"จำนวนเสาเข็ม ACFS",cat:"เสาเข็ม",web:0,exp:0},
  ];
  const PC_CAT_ORDER = ['พื้นฐาน','เสาเข็ม','ความคืบหน้า','ส่งมอบ/รับเงิน','อื่นๆ'];
  const PC_SPEC_BY_KEY = {}; PC_COL_SPEC.forEach(s => { PC_SPEC_BY_KEY[s.key] = s; });
  const PC_ENG_COL_ORDER = PC_COL_SPEC.map(s => s.key);
  function pcColCat(key) { const s = PC_SPEC_BY_KEY[key]; return s ? s.cat : 'อื่นๆ'; }
  const PC_EXPORT_EXCLUDE = new Set(['id','status','expectedPay1','expectedPay2','_sheet','_raw']);
  function pcColType(key) {
    const k = String(key);
    if (/วันที่|^Start$|^Finish$|เซ็นสัญญา|กำหนดส่งมอบ|แจ้งเข้า|ประกาศผู้ชนะ|Receive Date|Forecast Income|Close Project|แล้วเสร็จ/.test(k)) return 'date';
    if (/^%|\(\d+%\)|% Progress/.test(k)) return 'pct';
    if (/มูลค่า|Payment|^Summary|งบประมาณ|เงินตามใบจัดสรร|บาท\/วัน|^TOTAL$|^Receive$|^BOQ$/.test(k)) return 'money';
    return 'text';
  }
  // คอลัมน์คำนวณ (ไม่ได้มาจากไฟล์ Excel ตรงๆ)
  function pcDerivedCols() {
    return [
      { key: '__name', label: 'โครงการ (พื้นที่)', type: 'text', group: 'คำนวณ', get: r => r.site || r.name },
      { key: '__fy', label: 'ปีงบ', type: 'text', group: 'คำนวณ', get: r => r.fy ? 'FY' + r.fy : '' },
      { key: '__region', label: 'ภาค', type: 'text', group: 'คำนวณ', get: r => r.regionEn || r.region || '' },
      { key: '__status', label: 'สถานะ', type: 'text', group: 'คำนวณ', get: r => (STATUS_META[r.status] && STATUS_META[r.status].th) || r.status || '' },
      { key: '__substatus', label: 'สถานะย่อย', type: 'text', group: 'คำนวณ', get: r => r.projectStatus || '' },
      { key: '__progress', label: 'ความคืบหน้า %', type: 'pct', group: 'คำนวณ', get: r => r.progress },
      { key: '__contract', label: 'มูลค่าสัญญา (รวม VAT)', type: 'money', group: 'คำนวณ', get: r => r.contractAmt },
      { key: '__received', label: 'รับแล้ว', type: 'money', group: 'คำนวณ', get: r => r.received },
      { key: '__ar', label: 'ค้างรับ (Outstanding AR)', type: 'money', group: 'คำนวณ', get: r => r.outstandingAR },
      { key: '__fc1', label: 'คาดรับ งวด 1', type: 'money', group: 'คำนวณ', get: r => r.fc1Amount },
      { key: '__fc1d', label: 'วันที่คาดรับ งวด 1', type: 'date', group: 'คำนวณ', get: r => r.fc1Date },
      { key: '__fc2', label: 'คาดรับ งวด 2', type: 'money', group: 'คำนวณ', get: r => r.fc2Amount },
      { key: '__fc2d', label: 'วันที่คาดรับ งวด 2', type: 'date', group: 'คำนวณ', get: r => r.fc2Date },
      { key: '__assignee', label: 'ผู้รับโอนสิทธิ', type: 'text', group: 'คำนวณ', get: r => r.assignee },
    ];
  }
  // คืน def ทุกคอลัมน์ที่เลือก export ได้ (คำนวณ + วิศวกร แยกตามประเภทของฝ่ายการเงิน)
  function buildExportColumns(rows) {
    const present = new Set();
    (rows || []).forEach(r => { const raw = r._raw || {}; Object.keys(raw).forEach(k => present.add(k)); });
    const ordered = PC_ENG_COL_ORDER.filter(k => present.has(k) && !PC_EXPORT_EXCLUDE.has(k));
    present.forEach(k => { if (!PC_EXPORT_EXCLUDE.has(k) && PC_ENG_COL_ORDER.indexOf(k) < 0) ordered.push(k); });
    const eng = ordered.map(k => ({ key: 'raw:' + k, label: k, type: pcColType(k), group: pcColCat(k), get: ((kk) => (r) => (r._raw || {})[kk])(k) }));
    return pcDerivedCols().concat(eng);
  }
  // default selection = คอลัมน์วิเคราะห์หลัก (คำนวณ) + คอลัมน์วิศวกรที่ฝ่ายการเงินมาร์ก exp 1/2
  const PC_EXPORT_DEFAULT = ['__status','__substatus','__progress','__ar','__fc1','__fc1d','__fc2','__fc2d']
    .concat(PC_COL_SPEC.filter(s => s.exp > 0).map(s => 'raw:' + s.key));

  // ── per-cell formatting ──────────────────────────────────────────────────
  function pcCellText(col, row) {
    const v = col.get ? col.get(row) : '';
    if (v == null || v === '') return '';
    if (col.type === 'money') { const n = toNum(v); return n != null ? fmtBaht(n) : String(v); }
    if (col.type === 'pct') { const n = toNum(v); return n != null ? (Math.round(n) + '%') : String(v); }
    if (col.type === 'date') { const iso = isoOf(v); return iso ? fmtDate(iso) : String(v); }
    return String(v);
  }
  // คืน {v,t,z} สำหรับ xlsx cell (money/pct = number จริง + format)
  function pcCellXl(col, row) {
    const v = col.get ? col.get(row) : '';
    if (col.type === 'money') { const n = toNum(v); return n != null ? { v: n, t: 'n', z: FMT_BAHT } : { v: '', t: 's' }; }
    if (col.type === 'pct') { const n = toNum(v); return n != null ? { v: Math.round(n), t: 'n', z: FMT_PCT } : { v: '', t: 's' }; }
    if (col.type === 'date') { const iso = isoOf(v); return { v: iso ? fmtDate(iso) : (v == null ? '' : String(v)), t: 's' }; }
    return { v: (v == null ? '' : String(v)), t: 's' };
  }

  // ── export ────────────────────────────────────────────────────────────────
  function exportCSV(rows, cols, filename) {
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const head = cols.map(c => q(c.label)).join(',');
    const body = rows.map(r => cols.map(c => {
      // money/pct → raw number (ไม่มี comma) เพื่อให้ Excel/Sheet คำนวณต่อได้
      if (c.type === 'money' || c.type === 'pct') { const n = toNum(c.get ? c.get(r) : ''); return n != null ? n : ''; }
      return q(pcCellText(c, r));
    }).join(',')).join('\n');
    const csv = '﻿' + head + '\n' + body;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  // ── Excel export (styled .xlsx) — summary / detail / both ───────────────────
  // ใช้ xlsx-js-style (global XLSX) · โทน brand-blue · เลข format #,##0 ชิดขวา
  const XL_BLUE = '1F56B8', XL_BLUE2 = '2A6FDB', XL_ZEBRA = 'F7FAFF', XL_HEADBG = 'EAF2FF';
  const XL_BD = { style: 'thin', color: { rgb: 'E6ECF4' } };
  const XL_BORDER = { top: XL_BD, bottom: XL_BD, left: XL_BD, right: XL_BD };
  const FMT_BAHT = '#,##0;[Red]-#,##0', FMT_PCT = '0"%"';
  const PCXL = {
    title:   { font: { bold: true, sz: 15, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: XL_BLUE } }, alignment: { horizontal: 'left', vertical: 'center' } },
    sub:     { font: { sz: 10, color: { rgb: '64748B' } } },
    section: { font: { bold: true, sz: 11.5, color: { rgb: XL_BLUE } }, fill: { fgColor: { rgb: XL_HEADBG } }, alignment: { vertical: 'center' } },
    th:      { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: XL_BLUE } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: XL_BORDER },
    cell:    { font: { sz: 10 }, alignment: { vertical: 'center' }, border: XL_BORDER },
    cellAlt: { font: { sz: 10 }, fill: { fgColor: { rgb: XL_ZEBRA } }, alignment: { vertical: 'center' }, border: XL_BORDER },
    totalRow:{ font: { bold: true, sz: 10.5, color: { rgb: '0D1F3A' } }, fill: { fgColor: { rgb: XL_HEADBG } }, border: XL_BORDER },
  };
  function pcXlSet(ws, r, c, style) {
    const a = XLSX.utils.encode_cell({ r, c });
    if (!ws[a]) ws[a] = { t: 's', v: '' };
    ws[a].s = Object.assign({}, ws[a].s, style);
    return ws[a];
  }
  function pcXlRow(ws, r, c0, c1, style) { for (let c = c0; c <= c1; c++) pcXlSet(ws, r, c, style); }
  function pcXlFmt(ws, r, c, fmt, align) {
    const a = XLSX.utils.encode_cell({ r, c });
    if (!ws[a]) return;
    ws[a].z = fmt;
    if (align) ws[a].s = Object.assign({}, ws[a].s, { alignment: Object.assign({}, (ws[a].s && ws[a].s.alignment) || {}, { horizontal: align }) });
  }

  function buildSummarySheet_(wb, rows, scopeLabel, genStr) {
    const sum = summarize(rows);
    const pcs = pipelineCounts(rows).filter(p => p.count > 0);
    const years = forecastYears(rows);
    const lg = lgByBank(rows);
    const aoa = [];
    const sections = [], ths = [], totals = [], moneyCells = []; // moneyCells: [r,c]
    aoa.push(['รายงานสรุปโครงการ · Project Control Executive Summary']);
    aoa.push([`ขอบเขต: ${scopeLabel || 'ทั้งหมด'}`, '', `จำนวน ${rows.length} โครงการ`, '', `ออกรายงาน ${genStr}`]);
    aoa.push([]);
    // KPI
    sections.push(aoa.length); aoa.push(['ภาพรวม (Executive KPI)']);
    ths.push(aoa.length); aoa.push(['รายการ', 'มูลค่า / จำนวน', 'หมายเหตุ']);
    const kpi = [
      ['โครงการทั้งหมด', sum.count, 'มูลค่าสัญญารวม ฿' + fmtBaht(sum.contractTotal)],
      ['กำลังดำเนินการ', sum.wip, '฿' + fmtBaht(sum.wipAmt)],
      ['เสร็จสิ้น', sum.finish, '฿' + fmtBaht(sum.finishAmt)],
      ['ยังไม่ลงนาม', sum.awaiting, '฿' + fmtBaht(sum.awaitAmt)],
      ['ยกเลิก', sum.cancelled, '฿' + fmtBaht(sum.cancelAmt)],
      ['รับแล้ว (Received) — บาท', sum.received, ''],
      ['ยอดค้างรับ (AR) — บาท', sum.outstandingAR, ''],
      ['คาดรับใน 30 วัน — บาท', sum.forecast30, '60 วัน ฿' + fmtBaht(sum.forecast60) + ' · 90 วัน ฿' + fmtBaht(sum.forecast90)],
      ['วงเงิน LG รวม — บาท', sum.lgTotal, ''],
    ];
    kpi.forEach(row => { moneyCells.push([aoa.length, 1]); aoa.push(row); });
    aoa.push([]);
    // Pipeline
    sections.push(aoa.length); aoa.push(['สถานะโครงการ (Pipeline)']);
    ths.push(aoa.length); aoa.push(['สถานะย่อย', 'EN', 'จำนวน']);
    pcs.forEach(p => aoa.push([p.th, p.en, p.count]));
    aoa.push([]);
    // Cashflow per year
    years.forEach(y => {
      const ms = cashflowByMonth(rows, y).filter(m => m.gross > 0);
      if (!ms.length) return;
      const tot = ms.reduce((s, m) => s + m.gross, 0);
      sections.push(aoa.length); aoa.push([`กระแสเงินสดคาดการณ์ ปี ${y}`]);
      ths.push(aoa.length); aoa.push(['เดือน', 'คาดรับ (Gross) บาท', 'จำนวนงวด']);
      ms.forEach(m => { moneyCells.push([aoa.length, 1]); aoa.push([`${m.month} ${y}`, m.gross, m.count]); });
      moneyCells.push([aoa.length, 1]); totals.push(aoa.length); aoa.push(['รวม', tot, ms.reduce((s, m) => s + m.count, 0)]);
      aoa.push([]);
    });
    // LG
    if (lg.length) {
      sections.push(aoa.length); aoa.push(['หลักประกัน (LG Monitoring)']);
      ths.push(aoa.length); aoa.push(['ธนาคาร', 'จำนวน', 'วงเงิน (บาท)']);
      lg.forEach(b => { moneyCells.push([aoa.length, 2]); aoa.push([b.bank, b.count, b.amount]); });
      moneyCells.push([aoa.length, 2]); totals.push(aoa.length); aoa.push(['รวม', lg.reduce((s, b) => s + b.count, 0), lg.reduce((s, b) => s + b.amount, 0)]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 34 }, { wch: 22 }, { wch: 40 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
    ws['!rows'] = [{ hpt: 26 }];
    // styling
    pcXlRow(ws, 0, 0, 2, PCXL.title);
    pcXlRow(ws, 1, 0, 4, PCXL.sub);
    sections.forEach(r => pcXlRow(ws, r, 0, 2, PCXL.section));
    ths.forEach(r => pcXlRow(ws, r, 0, 2, PCXL.th));
    // body cells (non-section/th/total/blank rows)
    const special = new Set([0, 1, ...sections, ...ths, ...totals]);
    let zeb = 0;
    for (let r = 2; r < aoa.length; r++) {
      if (special.has(r)) { zeb = 0; continue; }
      const isBlank = !aoa[r] || aoa[r].length === 0;
      if (isBlank) { zeb = 0; continue; }
      pcXlRow(ws, r, 0, 2, (zeb++ % 2) ? PCXL.cellAlt : PCXL.cell);
    }
    totals.forEach(r => pcXlRow(ws, r, 0, 2, PCXL.totalRow));
    moneyCells.forEach(([r, c]) => pcXlFmt(ws, r, c, FMT_BAHT, 'right'));
    XLSX.utils.book_append_sheet(wb, ws, 'สรุป');
  }

  function buildDetailSheet_(wb, rows, scopeLabel, genStr, cols) {
    const sorted = rows.slice().sort((a, b) => (b.contractAmt || 0) - (a.contractAmt || 0));
    if (!cols || !cols.length) cols = buildExportColumns(rows).filter(c => PC_EXPORT_DEFAULT.indexOf(c.key) >= 0);
    const lastCol = cols.length - 1;
    const headRow = 3;
    const aoa = [
      [`ทะเบียนโครงการ · Project Detail — ${rows.length} โครงการ`],
      [`ขอบเขต: ${scopeLabel || 'ทั้งหมด'}`, '', '', '', `ออกรายงาน ${genStr}`],
      [],
      cols.map(c => c.label),
    ];
    sorted.forEach(r => aoa.push(cols.map(c => {
      const cell = pcCellXl(c, r);
      return cell.v;  // value only; format applied below
    })));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // column widths by type
    ws['!cols'] = cols.map(c => ({ wch: c.key === '__name' || c.key === 'raw:พื้นที่' ? 42 : c.type === 'money' ? 15 : c.type === 'date' ? 13 : c.label.length > 18 ? 22 : 13 }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(6, lastCol) } }];
    ws['!rows'] = [{ hpt: 26 }, {}, {}, { hpt: 30 }];
    ws['!freeze'] = { xSplit: 1, ySplit: headRow + 1 };
    pcXlRow(ws, 0, 0, lastCol, PCXL.title);
    pcXlRow(ws, 1, 0, lastCol, PCXL.sub);
    pcXlRow(ws, headRow, 0, lastCol, PCXL.th);
    for (let i = 0; i < sorted.length; i++) {
      const r = headRow + 1 + i;
      pcXlRow(ws, r, 0, lastCol, (i % 2) ? PCXL.cellAlt : PCXL.cell);
      cols.forEach((c, ci) => {
        if (c.type === 'money') pcXlFmt(ws, r, ci, FMT_BAHT, 'right');
        else if (c.type === 'pct') pcXlFmt(ws, r, ci, FMT_PCT, 'center');
        else if (c.type === 'date') pcXlFmt(ws, r, ci, null, 'center');
        // ค้างรับ แดงถ้า > 0
        if (c.key === '__ar' && (sorted[i].outstandingAR || 0) > 0) pcXlSet(ws, r, ci, { font: { sz: 10, bold: true, color: { rgb: 'B45309' } } });
      });
    }
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headRow, c: 0 }, e: { r: headRow + sorted.length, c: lastCol } }) };
    XLSX.utils.book_append_sheet(wb, ws, 'รายละเอียด');
  }

  function exportXLSX(kind, rows, scopeLabel, cols) {
    if (!window.XLSX) { alert('SheetJS ยังไม่โหลด — รีเฟรชหน้า'); return; }
    const wb = XLSX.utils.book_new();
    const genStr = fmtDate(TODAY, 'long');
    if (kind === 'summary' || kind === 'both') buildSummarySheet_(wb, rows, scopeLabel, genStr);
    if (kind === 'detail' || kind === 'both') buildDetailSheet_(wb, rows, scopeLabel, genStr, cols);
    const suffix = kind === 'summary' ? 'summary' : kind === 'detail' ? 'detail' : 'full';
    XLSX.writeFile(wb, `project-control-${suffix}-${TODAY}.xlsx`);
  }

  // ── local project snapshot (รอด cloud sync — รักษาคอลัมน์เต็มจาก Excel upload)
  const PC_LOCAL_KEY = 'wtp-proj-control-v2';
  function loadLocalProjects() {
    try { const a = JSON.parse(localStorage.getItem(PC_LOCAL_KEY) || 'null'); return Array.isArray(a) && a.length ? a : null; } catch (_) { return null; }
  }
  function saveLocalProjects(arr) {
    try { localStorage.setItem(PC_LOCAL_KEY, JSON.stringify(arr || [])); } catch (_) {}
  }

  // ── Upload Logic: parse Project Control xlsx → merged projects + stats ──────
  // อ่านทุก sheet "Main all*", map column อัตโนมัติ, merge ตาม Contract No →
  // ชื่อ+ปีงบ → Project No, รักษา id เดิม, ไม่ลบโครงการที่ไม่อยู่ในไฟล์
  // Finance Master (localStorage แยก) ไม่ถูกแตะ
  function parseProjectControl(arrayBuffer, existingProjects) {
    if (!window.XLSX) throw new Error('ไม่พบ SheetJS — รีเฟรชหน้า');
    const wb = window.XLSX.read(arrayBuffer, { type: 'array', cellDates: true, cellStyles: true });
    const mainSheets = wb.SheetNames.filter(n => /^Main\s*all/i.test(n));
    if (!mainSheets.length) throw new Error('ไม่พบ sheet "Main all67/68/69" — ต้องเป็นไฟล์ Project Control ดิบ');

    // 1) เก็บคอลัมน์ทั้งหมด (เรียงตามลำดับที่เจอ)
    const colSet = new Set(); const colOrder = [];
    mainSheets.forEach(sn => {
      const headerRow = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null })[0] || [];
      headerRow.forEach(h => { const k = String(h || '').trim(); if (k && !colSet.has(k)) { colSet.add(k); colOrder.push(k); } });
    });
    ['ยกเลิกโครงการ', 'มูลค่าสัญญาที่เซ็น (รวมVAT)', '% Progress', 'Tender No.', 'Project No.', 'Customer',
     '% งวด 1', '% งวด 2', 'มูลค่า งวด 1', 'มูลค่า งวด 2', 'Summary Payment 1', 'Summary Payment 2',
    ].forEach(c => { if (!colSet.has(c)) { colSet.add(c); colOrder.push(c); } });

    // 2) อ่านทุก row + normalize keys (trim)
    const allRows = [];
    mainSheets.forEach(sn => {
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null, raw: false });
      rows.forEach(r => { const norm = { _sheet: sn }; for (const k of Object.keys(r)) norm[String(k).trim()] = r[k]; allRows.push(norm); });
    });

    // 3) merge logic helpers
    const cancelFlag = (r) => { for (const k in r) { if (/ยกเลิก/.test(k) && isCancelledFlag(r[k])) return true; } return false; };
    const ghost = (r) => {
      if (cancelFlag(r)) return false;
      const hasS = (k) => !!String(r[k] != null ? r[k] : '').trim();
      const hasN = (k) => toNum(r[k]) > 0;
      return !(hasN('มูลค่าสัญญาที่เซ็น') || hasN('มูลค่าสัญญาที่เซ็น (รวมVAT)') || hasN('งบประมาณ') ||
        hasS('Start') || hasS('Tender No.') || hasS('Project No.') || hasS('Ref.code') ||
        hasS('เซ็นสัญญา') || hasS('Payment 1 Status') || hasS('Receive Date'));
    };
    const _yr = (s) => { const m = String(s || '').match(/Main\s*all(\d+)/i); return m ? m[1] : 'XX'; };
    const _clean = (name) => String(name || '').trim().replace(/\s+/g, '_').slice(0, 36);
    const CANON = /^[A-Z]{2,5}\d{2,5}(-[A-Z]{2,6})?$/;
    const finalizeCode = (raw, sheet) => { const c = String(raw || '').trim(); if (!c) return ''; if (/^(XL|WS)-/.test(c)) return c; if (CANON.test(c)) return c; return c + '-' + _yr(sheet); };
    // normalize ทุกวันที่ → ISO ด้วย isoOf (รองรับ M/D, ปี 2 หลัก ฯลฯ) เก็บรูปแบบเดียวกันหมด
    const isoDate = (v) => isoOf(v) || (v == null ? '' : String(v).trim());
    // คอลัมน์วันที่ทั้งหมด = ทุก key ใน PC_COL_SPEC ที่ pcColType = 'date' (+ เผื่อชื่อแปรผัน)
    const DATE_COLS = new Set(PC_COL_SPEC.filter(s => pcColType(s.key) === 'date').map(s => s.key)
      .concat(['Receive Date3','วันที่ส่งมอบงานงวด 3','วันที่เซ็น/รับ ใบตรวจรับ งวดที่ 1','วันที่ส่งมอบงาน งวด 1','วันที่ส่งมอบงาน งวด 2']));

    // preserve ids + snapshot สถานะเดิม (สำหรับ diff หลัง upload)
    const idByCode = {}; let maxId = 0;
    const wasCancelled = {}, wsNameToCode = {};
    (existingProjects || []).forEach(p => { const c = String(p['Contract No.'] || p.code || '').trim(); if (c && p.id) idByCode[c] = p.id;
      const m = String(p.id || '').match(/proj[_-]?0*(\d+)/i); if (m) maxId = Math.max(maxId, +m[1]);
      if (c) { if (isCancelled(p)) wasCancelled[c] = true; if (/^WS-/i.test(c)) { const nm = _clean(p['พื้นที่'] || ''); if (nm) wsNameToCode[nm] = c; } } });
    const existingCodes = new Set(Object.keys(idByCode));
    const diff = { added: [], cancelled: [], missing: [], signed: [] };

    // Phase 1: assign code + skip ghost
    let ghostCount = 0; const pairs = [];
    allRows.forEach(r => {
      let code = String(r['Contract No.'] || '').trim();
      const cancel = cancelFlag(r); const name = String(r['พื้นที่'] || '').trim();
      if (!code) { if (cancel && name) code = 'XL-' + _yr(r._sheet) + '-' + _clean(name); else if (name) code = 'WS-' + _yr(r._sheet) + '-' + _clean(name); else return; }
      else code = finalizeCode(code, r._sheet);
      if (ghost(r)) { ghostCount++; return; }
      pairs.push({ code, row: r, cancel });
    });
    // Phase 2: group by code (merge across sheets, OR cancellation)
    const byCode = {};
    pairs.forEach(({ code, row, cancel }) => {
      if (!byCode[code]) byCode[code] = { row: { ...row }, cancel };
      else { for (const k of Object.keys(row)) if (row[k] != null && row[k] !== '') byCode[code].row[k] = row[k]; if (cancel) byCode[code].cancel = true; }
    });
    // Phase 3: build output
    const outRows = []; let cancelledCount = 0, newCount = 0, preservedCount = 0;
    Object.keys(byCode).forEach(code => {
      const { row: r, cancel } = byCode[code];
      if (cancel) cancelledCount++;
      const nm = String(r['พื้นที่'] || '').trim();
      const display = (code && !/^(XL|WS)-/i.test(code) ? code + ' · ' : '') + (nm || '(ไม่มีชื่อ)');
      let id = idByCode[code];
      if (id) preservedCount++;
      else { id = 'proj_' + String(++maxId).padStart(4, '0'); newCount++; diff.added.push({ code, name: display }); }
      // ยกเลิกใหม่ (ก่อนหน้ายังไม่ยกเลิก)
      if (cancel && !wasCancelled[code]) diff.cancelled.push({ code, name: display });
      // ลงนามใหม่: มีเลขสัญญาจริงแล้ว + เคยเป็น WS- (รอลงนาม) ชื่อเดียวกัน
      if (!/^(XL|WS)-/i.test(code)) { const cn = _clean(nm); if (cn && wsNameToCode[cn]) diff.signed.push({ code, name: display, prev: wsNameToCode[cn] }); }
      const out = { id };
      colOrder.forEach(col => { let v = r[col]; if (v == null) v = ''; else if (DATE_COLS.has(col)) v = isoDate(v); else if (v instanceof Date) v = v.toISOString().slice(0, 10); out[col] = v; });
      out['Contract No.'] = code; if (cancel) out['ยกเลิกโครงการ'] = 1;
      outRows.push(out);
    });
    outRows.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    // merge: existing projects ที่ไม่อยู่ในไฟล์ → คงไว้ (ไม่ลบ)
    const inFile = new Set(outRows.map(r => r['Contract No.']));
    const kept = (existingProjects || []).filter(p => { const c = String(p['Contract No.'] || p.code || '').trim(); return c && !inFile.has(c); });
    const merged = [...outRows, ...kept];

    // โครงการหายไป: เลขสัญญาจริงที่เคยมี แต่ไม่อยู่ในไฟล์ใหม่ (synthetic ไม่นับ)
    (existingProjects || []).forEach(p => {
      const c = String(p['Contract No.'] || p.code || '').trim();
      if (!c || inFile.has(c) || /^(XL|WS)-/i.test(c)) return;
      const nm = String(p['พื้นที่'] || p.name || '').trim();
      diff.missing.push({ code: c, name: c + (nm ? ' · ' + nm : '') });
    });

    return { merged, diff, stats: { totalCols: colOrder.length + 1, totalRows: outRows.length, cancelledCount, ghostCount, newCount, preservedCount, keptCount: kept.length,
      addedN: diff.added.length, cancelledNewN: diff.cancelled.length, missingN: diff.missing.length, signedN: diff.signed.length } };
  }

  // ── Investor-grade report (HTML → print/PDF) · มีโลโก้ + โทน brand-blue ──────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function openReport(kind, rows, scopeLabel, cols) {
    const logoUrl = new URL('bioaxel_logo.png', location.href).href;
    const sum = summarize(rows);
    const today = new Date(); const genStr = fmtDate(TODAY, 'long');
    const STY = `
      *{box-sizing:border-box;margin:0;padding:0;font-family:'IBM Plex Sans Thai','Sarabun',system-ui,sans-serif}
      body{color:#0d1f3a;background:#fff;padding:0}
      .num{font-variant-numeric:tabular-nums;font-feature-settings:'tnum'}
      .wrap{max-width:1040px;margin:0 auto;padding:30px 34px 50px}
      .hd{display:flex;align-items:center;gap:16px;border-bottom:3px solid #2e8b4a;padding-bottom:16px;margin-bottom:22px}
      .hd img{height:54px;width:auto}
      .hd .t1{font-size:21px;font-weight:800;color:#21703a;letter-spacing:-.3px}
      .hd .t2{font-size:12px;color:#64748b;margin-top:2px}
      .hd .meta{margin-left:auto;text-align:right;font-size:11px;color:#64748b;line-height:1.6}
      .hd .meta b{color:#0d1f3a}
      h2{font-size:13px;font-weight:800;color:#21703a;margin:24px 0 10px;display:flex;align-items:center;gap:8px}
      h2::before{content:'';width:4px;height:15px;background:#2e8b4a;border-radius:3px;display:inline-block}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      .kpi{border:1px solid #e6ecf4;border-radius:11px;padding:13px 15px;background:linear-gradient(135deg,#f8fbff,#fff)}
      .kpi .lbl{font-size:10.5px;color:#64748b;font-weight:600}
      .kpi .v{font-size:22px;font-weight:800;letter-spacing:-.5px;margin-top:5px}
      .kpi .s{font-size:10.5px;color:#94a3b8;margin-top:2px}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px}
      th,td{padding:7px 9px;text-align:left;border-bottom:1px solid #eef2f7}
      thead th{background:#21703a;color:#fff;font-weight:600;font-size:10.5px;border:none}
      thead th.r,td.r{text-align:right}thead th.c,td.c{text-align:center}
      tbody tr:nth-child(even){background:#f7faff}
      .pill{display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:100px}
      .foot{margin-top:30px;padding-top:12px;border-top:1px solid #e6ecf4;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between}
      @media print{.noprint{display:none}body{padding:0}.wrap{padding:14px 18px}thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}.kpi,tbody tr:nth-child(even){-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      .btnbar{position:fixed;top:12px;right:16px;display:flex;gap:8px;z-index:9}
      .btnbar button{font:600 12px/1 'IBM Plex Sans Thai',sans-serif;padding:9px 15px;border-radius:8px;border:none;cursor:pointer;background:#2e8b4a;color:#fff;box-shadow:0 4px 14px rgba(35,72,150,.3)}
      .btnbar button.sec{background:#fff;color:#475569;border:1px solid #cbd5e1;box-shadow:none}`;
    const kindLabel = kind === 'summary' ? 'Executive Summary' : kind === 'both' ? 'สรุป + รายละเอียดโครงการ' : 'รายละเอียดโครงการ';
    const head = `
      <div class="hd">
        <img src="${logoUrl}" alt="BIOAXEL" onerror="this.style.display='none'"/>
        <div><div class="t1">Project Control — ${kindLabel}</div>
        <div class="t2">BIOAXEL · ระบบติดตามโครงการ (Engineering & Finance)</div></div>
        <div class="meta">ขอบเขต: <b>${esc(scopeLabel || 'ทั้งหมด')}</b><br/>จำนวน <b class="num">${rows.length.toLocaleString()}</b> โครงการ<br/>ออกรายงาน <b>${genStr}</b></div>
      </div>`;
    const stPill = (st) => { const m = STATUS_META[st] || { th: st, bg: '#f1f5f9', color: '#475569' }; return `<span class="pill" style="background:${m.bg};color:${m.color}">${esc(m.th)}</span>`; };

    // ── body builders (แยกเพื่อให้ kind='both' ประกอบทั้งสองส่วนได้) ──
    const buildSummaryBody = () => {
      let body = '';
      const pcs = pipelineCounts(rows).filter(p => p.count > 0);
      const years = forecastYears(rows);
      const lg = lgByBank(rows);
      body += `<h2>ภาพรวม (Executive KPI)</h2><div class="kpis">
        <div class="kpi"><div class="lbl">โครงการทั้งหมด</div><div class="v num">${sum.count.toLocaleString()}</div><div class="s">มูลค่าสัญญารวม ฿${fmtCompact(sum.contractTotal)}</div></div>
        <div class="kpi"><div class="lbl">กำลังดำเนินการ</div><div class="v num" style="color:#21703a">${sum.wip.toLocaleString()}</div><div class="s">฿${fmtCompact(sum.wipAmt)}</div></div>
        <div class="kpi"><div class="lbl">เสร็จสิ้น</div><div class="v num" style="color:#16a34a">${sum.finish.toLocaleString()}</div><div class="s">฿${fmtCompact(sum.finishAmt)}</div></div>
        <div class="kpi"><div class="lbl">ยกเลิก</div><div class="v num" style="color:#ef4444">${sum.cancelled.toLocaleString()}</div><div class="s">฿${fmtCompact(sum.cancelAmt)}</div></div>
        <div class="kpi"><div class="lbl">รับแล้ว (Received)</div><div class="v num" style="color:#15803d">฿${fmtCompact(sum.received)}</div></div>
        <div class="kpi"><div class="lbl">ยอดค้างรับ (AR)</div><div class="v num" style="color:#b45309">฿${fmtCompact(sum.outstandingAR)}</div></div>
        <div class="kpi"><div class="lbl">คาดรับใน 30 วัน</div><div class="v num" style="color:#2e8b4a">฿${fmtCompact(sum.forecast30)}</div><div class="s">60 วัน ฿${fmtCompact(sum.forecast60)}</div></div>
        <div class="kpi"><div class="lbl">วงเงิน LG รวม</div><div class="v num">฿${fmtCompact(sum.lgTotal)}</div></div>
      </div>`;
      body += `<h2>สถานะโครงการ (Pipeline)</h2><table><thead><tr><th>สถานะย่อย</th><th class="r">จำนวน</th></tr></thead><tbody>
        ${pcs.map(p => `<tr><td>${esc(p.th)} <span style="color:#94a3b8">· ${esc(p.en)}</span></td><td class="r num">${p.count}</td></tr>`).join('')}</tbody></table>`;
      years.forEach(y => {
        const ms = cashflowByMonth(rows, y).filter(m => m.gross > 0);
        if (!ms.length) return;
        const tot = ms.reduce((s, m) => s + m.gross, 0);
        body += `<h2>กระแสเงินสดคาดการณ์ ปี ${y}</h2><table><thead><tr><th>เดือน</th><th class="r">คาดรับ (Gross)</th><th class="c">จำนวนงวด</th></tr></thead><tbody>
          ${ms.map(m => `<tr><td>${m.month} ${y}</td><td class="r num">฿${fmtBaht(m.gross)}</td><td class="c num">${m.count}</td></tr>`).join('')}
          <tr style="font-weight:800;background:#eaf2ff"><td>รวม</td><td class="r num">฿${fmtBaht(tot)}</td><td></td></tr></tbody></table>`;
      });
      if (lg.length) {
        body += `<h2>หลักประกัน (LG Monitoring)</h2><table><thead><tr><th>ธนาคาร</th><th class="c">จำนวน</th><th class="r">วงเงิน</th></tr></thead><tbody>
          ${lg.map(b => `<tr><td><b style="color:${b.color}">${esc(b.bank)}</b></td><td class="c num">${b.count}</td><td class="r num">฿${fmtBaht(b.amount)}</td></tr>`).join('')}</tbody></table>`;
      }
      return body;
    };
    const buildDetailBody = () => {
      const sorted = rows.slice().sort((a, b) => (b.contractAmt || 0) - (a.contractAmt || 0));
      const useCols = (cols && cols.length) ? cols
        : buildExportColumns(rows).filter(c => PC_EXPORT_DEFAULT.indexOf(c.key) >= 0);
      const align = (t) => t === 'money' ? ' class="r"' : (t === 'pct' || t === 'date') ? ' class="c"' : '';
      const cellHtml = (c, r) => {
        const txt = pcCellText(c, r);
        if (c.key === '__ar') return `<td class="r num" style="color:#b45309">${txt ? '฿' + txt : '—'}</td>`;
        if (c.type === 'money') return `<td class="r num">${txt ? '฿' + txt : '—'}</td>`;
        if (c.type === 'pct') return `<td class="c num">${txt || '—'}</td>`;
        if (c.type === 'date') return `<td class="c num">${txt || '—'}</td>`;
        return `<td>${esc(txt || '—')}</td>`;
      };
      return `<h2>ทะเบียนโครงการ (${rows.length.toLocaleString()} โครงการ · ${useCols.length} คอลัมน์)</h2>
        <table><thead><tr>${useCols.map(c => `<th${align(c.type)}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
        ${sorted.map(r => `<tr>${useCols.map(c => cellHtml(c, r)).join('')}</tr>`).join('')}</tbody></table>`;
    };
    let body = '';
    if (kind === 'summary') body = buildSummaryBody();
    else if (kind === 'detail') body = buildDetailBody();
    else body = buildSummaryBody() + '<div style="page-break-before:always;height:0"></div>' + buildDetailBody();
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
      <title>Project Control — ${kind === 'summary' ? 'Summary' : kind === 'both' ? 'Summary+Detail' : 'Detail'} · ${TODAY}</title>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700;800&family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet"/>
      <style>${STY}</style></head><body>
      <div class="btnbar noprint"><button class="sec" onclick="window.close()">ปิด</button><button onclick="window.print()">🖨️ พิมพ์ / บันทึก PDF</button></div>
      <div class="wrap">${head}${body}
        <div class="foot"><span>BIOAXEL · Project Control Console</span><span>เอกสารสร้างอัตโนมัติ · ${genStr}</span></div>
      </div></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('เบราว์เซอร์บล็อก popup — โปรดอนุญาตเพื่อเปิดรายงาน'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  window.PCU = {
    TH_MONTHS, EN_MONTHS, TODAY, toNum, isoOf, addDays,
    fmtBaht, fmtCompact, fmtDate, daysFromToday,
    STATUS_META, SUB_PIPELINE, SUB_ORDER, REGION_EN, BANK_COLORS, CREDITOR_NAMES,
    deriveProjects, summarize, pipelineCounts, cashflowByMonth, forecastYears, lgByBank, debtByCreditor,
    exportCSV, exportXLSX, openReport, buildExportColumns, PC_EXPORT_DEFAULT, pcColType,
    PC_COL_SPEC, PC_CAT_ORDER, pcColCat,
    loadFinanceMaster, setFinanceField, contractAmtOf,
    loadLocalProjects, saveLocalProjects, parseProjectControl,
  };
})();

// ═══════════════════════════════════════════════════════════════════════════
// COLUMN REGISTRY + GRID ENGINE (filter / sort) — namespaced PCGrid
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  const U = window.PCU;
  const STATUS_SORT = { 'ยังไม่ลงนาม': 0, 'Work in progress': 1, 'Finish': 2, 'ยกเลิก': 3 };

  function makeColumns() {
    const base = [
      { id: 'name', label: 'Project Name', th: 'ชื่อโครงการ', type: 'text', width: 290, freezable: true, value: r => r.site || r.name },
      { id: 'contractNo', label: 'Contract No.', th: 'เลขที่สัญญา', type: 'text', width: 110, freezable: true, value: r => r.contractNo },
      { id: 'fy', label: 'Fiscal Year', th: 'ปีงบ', type: 'enum', width: 72, align: 'center', value: r => r.fy ? 'FY' + r.fy : '' },
      { id: 'start', label: 'Start', th: 'วันที่เริ่มต้น', type: 'date', width: 108, align: 'center', value: r => r.start, sortVal: r => r.start || '' },
      { id: 'finish', label: 'Finish', th: 'วันที่สิ้นสุด', type: 'date', width: 108, align: 'center', value: r => r.finish, sortVal: r => r.finish || '' },
      { id: 'region', label: 'Region', th: 'ภูมิภาค', type: 'enum', width: 100, value: r => r.regionEn || r.region },
      { id: 'province', label: 'Province', th: 'จังหวัด', type: 'enum', width: 110, value: r => r.province },
      { id: 'type', label: 'Type', th: 'ประเภท', type: 'enum', width: 70, align: 'center', value: r => r.type },
      { id: 'contractAmt', label: 'Contract Amount', th: 'มูลค่าสัญญา', type: 'num', width: 132, align: 'right', value: r => r.contractAmt },
      { id: 'progress', label: 'Progress', th: 'ความคืบหน้า', type: 'num', width: 118, value: r => r.progress },
      { id: 'status', label: 'Status', th: 'สถานะ', type: 'enum', width: 130, value: r => r.status, sortVal: r => STATUS_SORT[r.status] },
      { id: 'projectStatus', label: 'Sub Status', th: 'สถานะย่อย', type: 'enum', width: 150, value: r => r.projectStatus, sortVal: r => U.SUB_ORDER[r.projectStatus] },
      { id: 'outstandingAR', label: 'Outstanding AR', th: 'ยอดค้างรับ', type: 'num', width: 128, align: 'right', value: r => r.outstandingAR },
      { id: 'received', label: 'Received', th: 'รับแล้ว', type: 'num', width: 120, align: 'right', value: r => r.received },
      { id: 'forecastReceive', label: 'Forecast Receive', th: 'คาดรับรวม', type: 'num', width: 122, align: 'right', value: r => r.forecastReceive },
      { id: 'fc1Date', label: 'Forecast Date 1', th: 'กำหนดรับ งวด 1', type: 'date', width: 124, align: 'center', value: r => r.fc1Date, sortVal: r => r.fc1Date || '' },
      { id: 'fc1Amount', label: 'Forecast Receive 1', th: 'คาดรับ งวด 1', type: 'num', width: 124, align: 'right', value: r => r.fc1Amount },
      { id: 'fc2Date', label: 'Forecast Date 2', th: 'กำหนดรับ งวด 2', type: 'date', width: 124, align: 'center', value: r => r.fc2Date, sortVal: r => r.fc2Date || '' },
      { id: 'fc2Amount', label: 'Forecast Receive 2', th: 'คาดรับ งวด 2', type: 'num', width: 124, align: 'right', value: r => r.fc2Amount },
      { id: 'forecastNet', label: 'Net Forecast', th: 'รับสุทธิ', type: 'num', width: 120, align: 'right', value: r => r.forecastNet },
      { id: 'assignee', label: 'Assignee', th: 'ผู้รับโอนสิทธิ', type: 'enum', width: 110, value: r => r.assignee },
      { id: 'lgBank', label: 'LG Bank', th: 'ธนาคาร LG', type: 'enum', width: 90, align: 'center', value: r => r.lg ? r.lg.bank : '' },
      { id: 'lgAmount', label: 'LG Amount', th: 'วงเงิน LG', type: 'num', width: 104, align: 'right', value: r => r.lg ? r.lg.amount : null },
    ];
    // ── raw engineer columns (จาก PC_COL_SPEC) — ทุกคอลัมน์ที่วิศวกรมี ให้โชว์/ฟิลเตอร์ได้
    // ข้ามคอลัมน์ที่มี derived column แทนอยู่แล้ว (กันซ้ำ)
    const RAW_SKIP = { 'Contract No.':1, 'พื้นที่':1, 'Type':1, 'Start':1, 'Finish':1, 'Region':1, 'Province':1, 'มูลค่าสัญญาที่เซ็น (รวมVAT)':1 };
    const raws = (U.PC_COL_SPEC || []).filter(s => !RAW_SKIP[s.key]).map(s => {
      const kind = U.pcColType(s.key);           // money | date | pct | text
      const gType = (kind === 'money' || kind === 'pct') ? 'num' : (kind === 'date' ? 'date' : 'text');
      const w = kind === 'money' ? 124 : kind === 'date' ? 118 : kind === 'pct' ? 92 : Math.min(230, Math.max(110, s.key.length * 8.5));
      const get = (kk, knd) => (r) => {
        const v = (r._raw || {})[kk];
        if (knd === 'money' || knd === 'pct') return U.toNum(v);
        if (knd === 'date') return U.isoOf(v) || '';
        return (v == null ? '' : v);
      };
      return { id: 'raw:' + s.key, label: s.key, th: s.key, type: gType, kind, cat: s.cat,
        width: Math.round(w), align: gType === 'num' ? 'right' : (gType === 'date' ? 'center' : undefined),
        value: get(s.key, kind), raw: true };
    });
    return base.concat(raws);
  }
  // default-visible = core identity/analytics + คอลัมน์ที่ฝ่ายการเงินมาร์ก web 1/2
  const DERIVED_FOR_RAW = { 'Contract No.':'contractNo', 'พื้นที่':'name', 'Type':'type', 'Start':'start', 'Finish':'finish', 'Region':'region', 'Province':'province', 'มูลค่าสัญญาที่เซ็น (รวมVAT)':'contractAmt' };
  const _CORE_VIS = ['name', 'contractNo', 'fy', 'type', 'start', 'finish', 'progress', 'status', 'projectStatus', 'outstandingAR'];
  const _WEB_VIS = (U.PC_COL_SPEC || []).filter(s => s.web > 0).map(s => DERIVED_FOR_RAW[s.key] || ('raw:' + s.key));
  const DEFAULT_VISIBLE = [..._CORE_VIS, ..._WEB_VIS].filter((v, i, a) => a.indexOf(v) === i);
  const DEFAULT_FROZEN = ['name', 'contractNo'];

  function rowCondStyle(r, cf) {
    if (!cf) return {};
    if (r.status === 'ยกเลิก') return { background: 'rgba(148,163,184,.10)', color: '#94a3b8' };
    const dd = U.daysFromToday(r.forecastDate);
    if (dd != null && dd < 0 && r.outstandingAR > 0) return { background: 'rgba(239,68,68,.06)' };
    if (r.status === 'Finish' && r.outstandingAR === 0) return { background: 'rgba(22,163,74,.045)' };
    if (r.outstandingAR > 0) return { background: 'rgba(249,115,22,.045)' };
    return {};
  }
  function applyColFilters(rows, cols, colFilters) {
    const cm = Object.fromEntries(cols.map(c => [c.id, c]));
    return rows.filter(r => {
      for (const [cid, f] of Object.entries(colFilters)) {
        if (!f) continue; const c = cm[cid]; if (!c) continue;
        const v = c.value(r);
        if (f.kind === 'set') { if (f.values.length && !f.values.includes(String(v == null ? '' : v))) return false; }
        else if (f.kind === 'text') { if (f.q && !String(v == null ? '' : v).toLowerCase().includes(f.q.toLowerCase())) return false; }
        else if (f.kind === 'num') { const n = v == null ? null : +v;
          if (f.min != null && (n == null || n < f.min)) return false;
          if (f.max != null && (n == null || n > f.max)) return false; }
        else if (f.kind === 'date') { if (f.from && (!v || v < f.from)) return false; if (f.to && (!v || v > f.to)) return false; }
      }
      return true;
    });
  }
  function applySort(rows, cols, sort) {
    if (!sort || !sort.length) return rows;
    const cm = Object.fromEntries(cols.map(c => [c.id, c]));
    const arr = rows.slice();
    arr.sort((a, b) => {
      for (const s of sort) {
        const c = cm[s.id]; if (!c) continue;
        const va = c.sortVal ? c.sortVal(a) : c.value(a);
        const vb = c.sortVal ? c.sortVal(b) : c.value(b);
        let cmp;
        if (c.type === 'num') cmp = (va == null ? -Infinity : +va) - (vb == null ? -Infinity : +vb);
        else if (c.type === 'date') cmp = String(va || '').localeCompare(String(vb || ''));
        else cmp = String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'th');
        if (cmp !== 0) return s.dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
    return arr;
  }
  function distinctValues(rows, col) {
    const set = new Set();
    rows.forEach(r => { const v = col.value(r); set.add(v == null || v === '' ? '' : String(v)); });
    return [...set].sort((a, b) => String(a).localeCompare(String(b), 'th'));
  }

  window.PCGrid = { makeColumns, DEFAULT_VISIBLE, DEFAULT_FROZEN, rowCondStyle, applyColFilters, applySort, distinctValues };
})();
