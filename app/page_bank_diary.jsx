/* page_bank_diary.jsx — Bank Diary + Inter-account Transfers
 *
 * การ์ดบัญชีดึงข้อมูลจริงจาก 2 แหล่ง:
 *   • bankAccounts  — ยอดคงเหลือต่อบัญชี (รองรับชื่อ field จาก Sheet: BANK_NAME / Bank_AC / BALANCE / AVAILABLE_BALANCE / HOLD_AMOUNT / DATE / NOTE)
 *   • checks        — เช็คจ่าย ผูกเข้าบัญชีด้วยเลขบัญชี (รองรับเลข 4 ตัวท้าย) เพื่อดูว่าบัญชีไหนมีรายการครบกำหนดวันไหน เงินพอไหม
 */
'use strict';

/* ── Field normalization helpers (live Sheet fields ↔ seed fields) ─────── */
function bdNum(v) {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function bdHas(v) { return v != null && v !== ''; }

/* Normalize one bank-account record into a canonical shape */
function bdAcct(a) {
  return {
    id:          a.id,
    bankName:    a.BANK_NAME   || a.bankName    || '',
    accountNo:   a.Bank_AC     || a.accountNo   || '',
    accountName: a.accountName || a.ACCOUNT_NAME || '',
    type:        a.type || a.accountType || '',
    balance:     bdNum(bdHas(a.BALANCE) ? a.BALANCE : a.balance),
    available:   bdHas(a.AVAILABLE_BALANCE) ? bdNum(a.AVAILABLE_BALANCE) : null,
    hold:        bdHas(a.HOLD_AMOUNT) ? bdNum(a.HOLD_AMOUNT) : null,
    asOf:        a.DATE || a.asOf || '',
    note:        a.NOTE || a.note || '',
    _raw:        a,
  };
}

/* Match a bank account to a check by account number (tolerates last-N-digit refs) */
function bdDigits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
function bdAcctMatchesCheck(acctNo, checkAcctNo) {
  const a = bdDigits(acctNo), c = bdDigits(checkAcctNo);
  if (!a || !c) return false;
  if (a === c) return true;
  if (c.length >= 4 && c.length < a.length && a.slice(-c.length) === c) return true;
  if (a.length >= 4 && a.length < c.length && c.slice(-a.length) === a) return true;
  return false;
}

/* Normalize Thai check status → outstanding | cleared | cancelled */
function bdCheckStatus(s) {
  s = s || '';
  if (s === 'จ่ายแล้ว' || s === 'ขึ้นเงินแล้ว' || s.indexOf('ได้รับคืน') >= 0 || s.indexOf('ได้รับเช็คคืน') >= 0) return 'cleared';
  if (s.indexOf('ยกเลิก') >= 0 || s.indexOf('เด้ง') >= 0) return 'cancelled';
  if (s.indexOf('รอ') >= 0) return 'clearing';
  return 'outstanding'; // blank / null = ยังไม่เคลียร์ = ค้างจ่าย
}
function bdIsOutstanding(st) { return st === 'outstanding' || st === 'clearing'; }

/* แบรนด์ธนาคาร — สี + ชื่อย่อ สำหรับป้ายบนการ์ด */
const BD_BANK_BRANDS = {
  SCB:   { color: '#4e2a84', label: 'SCB' },
  KTB:   { color: '#01a4e4', label: 'KTB' },
  KBANK: { color: '#138f2c', label: 'KBANK' },
  KBNK:  { color: '#138f2c', label: 'KBANK' },
  BBL:   { color: '#1b388f', label: 'BBL' },
  BAY:   { color: '#c8a44b', label: 'BAY' },
  TTB:   { color: '#114e8b', label: 'TTB' },
  GSB:   { color: '#e6177f', label: 'GSB' },
  KKP:   { color: '#574494', label: 'KKP' },
  UOB:   { color: '#005ba6', label: 'UOB' },
  CIMB:  { color: '#9e1b32', label: 'CIMB' },
};
function bdBrand(name) {
  const key = String(name || '').trim().toUpperCase();
  return BD_BANK_BRANDS[key] || { color: '#475569', label: key || 'BANK' };
}
function bdLast4(no) { const d = bdDigits(no); return d.length > 4 ? d.slice(-4) : d; }

/* Local-date → 'YYYY-MM-DD' (ไม่ใช้ toISOString เพราะจะเพี้ยน timezone) */
function bdISO(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
/* แปลงค่าวันที่ใดๆ → ISO ('' ถ้าแปลงไม่ได้ เช่น "30-พ.ค.") */
function bdToISO(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // ★ parseDateFlexible (global) รองรับ DD/MM/YYYY ไทย + พ.ศ. — เดิมใช้ Date.parse อ่าน
  //   "05/06/2026" เป็น 6 พ.ค. (เดือนสลับ) / "25/05/2569" เป็น NaN → AP due/forecast/PV เพี้ยน
  const d = (typeof parseDateFlexible === 'function') ? parseDateFlexible(s) : null;
  if (d && !isNaN(d)) return bdISO(d);
  const t = Date.parse(s);                       // fallback เดิม (กันรูปแบบที่ parseDateFlexible ไม่รู้จัก)
  return isNaN(t) ? '' : bdISO(new Date(t));
}

/* ปลายช่วงเวลาตาม preset (นับจาก today ไปข้างหน้า) */
function bdPeriodEnd(today, key) {
  const d = new Date(today + 'T00:00:00');
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate(), dow = d.getDay();
  const mk = (yy, mm, dd) => bdISO(new Date(yy, mm, dd));
  switch (key) {
    case 'thisWeek':      return mk(y, m, day + ((7 - dow) % 7));        // ถึงอาทิตย์นี้
    case 'nextWeek':      return mk(y, m, day + ((7 - dow) % 7) + 7);    // ถึงสิ้นสัปดาห์หน้า
    case 'thisMonth':     return mk(y, m + 1, 0);                        // ถึงสิ้นเดือนนี้
    case 'firstWeekNext': return mk(y, m + 1, 7);                        // ถึงสัปดาห์แรกเดือนหน้า
    case 'midNext':       return mk(y, m + 1, 15);                       // ถึงกลางเดือนหน้า
    case 'all':
    default:              return '9999-12-31';
  }
}
const BD_PERIODS = [
  { key: 'thisWeek',      label: 'สัปดาห์นี้' },
  { key: 'nextWeek',      label: 'ถึงสัปดาห์หน้า' },
  { key: 'thisMonth',     label: 'เดือนนี้' },
  { key: 'firstWeekNext', label: 'ถึงสัปดาห์แรกเดือนหน้า' },
  { key: 'midNext',       label: 'ถึงกลางเดือนหน้า' },
  { key: 'all',           label: 'ทั้งหมด' },
];

/* หมวด Cash Flow (cf_category / forecast.CATEGORY) */
const BD_CF_CATEGORIES = [
  { code: '1', label: 'ค่าใช้จ่ายดำเนินงานรายสัปดาห์' },
  { code: '2', label: 'ค่าใช้จ่ายเกี่ยวกับโครงการและงานติดตั้ง' },
  { code: '3', label: 'ต้นทุนทางการเงินและดอกเบี้ย' },
  { code: '4', label: 'ค่าใช้จ่ายเบ็ดเตล็ดและเงินเดือน' },
];
function bdCatLabel(code) {
  const c = BD_CF_CATEGORIES.find(x => x.code === String(code));
  return c ? c.label : '';
}

/* Normalize forecastEntries → ใช้ยอดจริง (ACTUAL_AMOUNT) อัตโนมัติเมื่อมี (ตัด PV แล้ว) */
function bdNormForecast(e) {
  const planAmount = bdNum(e.AMOUNT);
  const hasActual  = e.ACTUAL_AMOUNT != null && e.ACTUAL_AMOUNT !== '';
  const actualAmt  = hasActual ? bdNum(e.ACTUAL_AMOUNT) : null;
  const sign       = planAmount < 0 ? -1 : 1;
  const amount     = hasActual ? sign * Math.abs(actualAmt) : planAmount; // ใช้ยอดจริงแต่คงทิศ รับ/จ่าย
  const date       = bdToISO(e.ACTUAL_DATE) || bdToISO(e.PAYMENT_DATE) || bdToISO(e.DATE);
  const isActual   = hasActual || e.STATUS === 'ACTUAL';
  return {
    id: e.id, date, payDate: bdToISO(e.PAYMENT_DATE), planAmount, actualAmount: actualAmt, amount,
    desc: e.DESCRIPTION || 'ประมาณการ', bankAc: e.Bank_AC || '', status: e.STATUS || 'PLANNED',
    isActual, refDoc: e.REF_DOC || '', expType: e.EXPENSE_TYPE || '', category: e.CATEGORY != null ? String(e.CATEGORY) : '',
    type: amount >= 0 ? 'in' : 'out', raw: e,
  };
}

/* Normalize pvVouchers (DATA PV · Payment Voucher) — รายการจ่ายจริงจากบัญชี
 * เอกสารออกแล้ว (มี PL_PV_No) ผูกบัญชีด้วย Bank_AC; ลงการ์ดเป็น outflow ตาม Pmt_Date
 * (รองรับ field จาก bankTransfers เดิมด้วย: paydate/remark) */
function bdNormPV(t) {
  return {
    id:      t.id,
    date:    bdToISO(t.Pmt_Date || t.paydate),
    amount:  bdNum(t.Net_Amount),     // ยอดจ่าย (บวก) — ลงการ์ดเป็น −outflow
    pvNo:    t.PL_PV_No || '',
    apNo:    t.AP_No || '',           // เลขที่ AP — ใช้กันนับซ้ำกับ forecast ที่วางแผนจ่าย AP เดียวกัน
    payee:   t.Payee || '',
    docNo:   t.Document_No || '',
    chqNo:   t.Chq_No || '',
    chqDate: bdToISO(t.Chq_Date),
    bankAc:  t.Bank_AC || '',
    remark:  t.Remark || t.cc_remark || t.remark || '',
    raw:     t,
  };
}

/* Normalize payables (AP) — ยอดสุทธิ = netpayment (ให้ตรงกับ Cash Flow: Number(ap.netpayment || ap.Amount))
 *   fallback: Amount → net_new → Balance_Amount1 (กรณีข้อมูลเก่าไม่มี netpayment) */
function bdNormAP(p) {
  const amount = bdNum(p.netpayment != null && p.netpayment !== '' ? p.netpayment
               : (p.Amount != null && p.Amount !== '' ? p.Amount
               : (p.net_new != null && p.net_new !== '' ? p.net_new : p.Balance_Amount1)));
  return {
    id: p.id, vendor: p.cust_name || '—', due: bdToISO(p.due2 || p.dueDate || p.due), amount: amount,   // ★ due2 = ฟิลด์ครบกำหนดจริง (p.due มักว่าง) — ตรงกับ Home/page_home; กันโชว์ "—"+ไม่เตือนเลยกำหนด
    vchno: p.vchno || p.docno || '', remark: p.remark || '', cfCategory: p.cf_category != null ? String(p.cf_category) : '', raw: p,
  };
}

/* Build the per-account view (เช็คค้างจ่าย + forecast ที่ผูกบัญชี) — base = ยอดเงินจริง (ไม่หัก HOLD)
 * สัญญาณ "เงินไม่พอ" ใช้กรอบ 7 วัน (near-term) เทียบยอดเงินจริง */
function bdBuildAccountView(acct, matchedChecks, matchedForecasts, matchedTransfers, matchedPVs, today, next7, paidApSet, transferInfoByRef) {
  // ใช้วันที่ของยอดที่บันทึก (acct.asOf = DATE) เป็นจุดเริ่ม — รวมกรณีอนาคต (เช่นบันทึก "ยอดยกไปพรุ่งนี้")
  //   ไม่ cap ที่ today อีกต่อไป → พอบันทึกยอดพรุ่งนี้ รายการของวันนี้ (จ่าย/สะท้อนในยอดแล้ว) จะหลุดออกเอง ไม่หักซ้ำ
  const asOfRef = acct.asOf || today;
  const base    = acct.balance; // ยอดเงินจริง (= ยอดใช้ได้ที่บันทึกล่าสุด)

  const items = [];
  const countedChq = new Set(); // เลขเช็คที่นับในการ์ดแล้ว — กัน PV ที่เป็นเช็คใบเดียวกันนับซ้ำ
  matchedChecks
    .filter(c => bdIsOutstanding(c._st) && (c.checkDate || '') >= asOfRef)
    .forEach(c => {
      const cq = bdDigits(c.checkNo); if (cq) countedChq.add(cq);
      items.push({
        date: c.checkDate, signed: -bdNum(c.amount), kind: 'check',
        title: c.payee || '—', sub: 'เช็ค #' + (c.checkNo || '—'), status: c._st, raw: c,
      });
    });
  // AP ที่จ่ายจริงผ่าน PV แล้ว → ตัด forecast (ประมาณการ) ทิ้ง ให้รายการ PV จริงเป็นตัวแทน
  //   กันแผนเก่าค้าง + กันนับซ้ำกับยอดเงินที่จ่าย PV ไปแล้ว (PV จ่ายไปแล้ว = อยู่ในยอด BALANCE)
  //   กติกาเดียวกับหน้า Cash Flow (buildPaidVchnoSet/isApPaid: payable.vchno == pvVouchers.AP_No = จ่ายแล้ว)
  const countedAP = new Set(); // เลขที่ AP ที่นับผ่าน forecast แล้ว — กัน PV ของ AP เดียวกันนับซ้ำ
  matchedForecasts
    .filter(f => f.date && f.date >= asOfRef
              && !(paidApSet && f.refDoc && paidApSet.has(String(f.refDoc).trim())))
    .forEach(f => {
      if (f.refDoc) countedAP.add(String(f.refDoc).trim());
      // group = ชื่อผู้ขาย (ตัด " (เลขที่ AP)" ท้าย desc) เพื่อจับกลุ่มหลายใบของผู้ขายเดียวกันในวันเดียว
      const vendorName = (f.desc || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || (f.desc || '');
      items.push({
        date: f.date, signed: f.amount, kind: 'forecast',
        title: f.desc, sub: (f.isActual ? '✓ ' + (f.amount >= 0 ? 'รับจริงแล้ว' : 'จ่ายจริงแล้ว') + (f.refDoc ? ' • ' + f.refDoc : '') : (f.refDoc || '')),
        status: f.isActual ? 'actual' : 'planned', raw: f, group: vendorName, refDoc: f.refDoc || '', remark: f.remark || '',
      });
    });
  // โอนระหว่างบัญชี: นับเฉพาะที่ "ยังไม่กลืนยอด" = ยังไม่ยืนยัน และลงวันที่ตั้งแต่วัน BALANCE เป็นต้นไป
  // (ยืนยัน = โอนจริง+เอา PV เข้าแล้ว → ถือว่าอยู่ใน BALANCE ที่ sync มาแล้ว จึงไม่นับซ้ำ)
  (matchedTransfers || [])
    .filter(e => (e.entryDate || '') >= asOfRef && !e.reconciled)
    .forEach(e => {
      const amt = bdNum(e.amount);
      // ป้ายตาม "ทิศจริง" ของขานี้ — ฝั่งรับ = รับโอนจากต้นทาง / ฝั่งจ่าย = โอนเงินไปปลายทาง
      //   (ไม่ใช้ e.description ตรงๆ เพราะบางที note ค้างมาเป็นแบบฝั่งจ่ายทั้งคู่)
      const isInflow = e.entryType === 'inflow_transfer' || (e.entryType !== 'outflow_transfer' && amt > 0);
      const info  = (transferInfoByRef && transferInfoByRef[e.transferRef]) || {};
      const party = isInflow ? [info.fromBank, info.fromNo].filter(Boolean).join(' ')
                             : [info.toBank,   info.toNo].filter(Boolean).join(' ');
      const title = isInflow ? (party ? 'รับโอนจาก ' + party : 'รับโอนระหว่างบัญชี')
                             : (party ? 'โอนเงินไป ' + party : 'โอนระหว่างบัญชี');
      // เก็บ note ที่ผู้ใช้พิมพ์เองไว้เป็นหมายเหตุ (ข้ามตัวที่ระบบสร้าง "โอนเงินไป/รับโอนจาก")
      const desc = (e.description || '').trim();
      const userNote = (!desc || /^(โอนเงินไป|รับโอนจาก)/.test(desc)) ? '' : desc;
      items.push({
        date: e.entryDate, signed: amt, kind: 'transfer', ref: e.transferRef || '',
        title,
        sub: 'โอนระหว่างบัญชี (รอกลืนยอด)' + (e.transferRef ? ' • ' + e.transferRef : ''),
        status: 'pending', raw: e, remark: userNote,
      });
    });
  // PV (Payment Voucher): เอกสารจ่ายออกแล้วแต่ Pmt_Date ยังไม่ถึงวัน asOf → ยังไม่กลืนยอด นับเป็น outflow
  // (Pmt_Date < asOf = จ่ายไปแล้ว อยู่ใน BALANCE ที่ sync มา จึงไม่นับซ้ำ — เหมือนกติกาเช็ค)
  // กันนับซ้ำ: ข้าม PV ที่เป็นเช็คใบเดียวกับที่นับแล้ว (chqNo) หรือ AP เดียวกับ forecast ที่นับแล้ว (apNo)
  // รวมหลายแถว AP ย่อยที่อยู่ใน PV ใบเดียวกัน → แสดงเป็นรายการเดียว ยอดรวม (ไม่แตกราย AP)
  const pvGroups = {};
  (matchedPVs || [])
    .filter(p => p.date && p.date >= asOfRef
              && Math.abs(bdNum(p.amount)) > 0   // ข้าม PV ยอด 0 (มักเป็นการตัดมัดจำ ไม่มีผลต่อยอดการ์ด)
              && !(p.chqNo && countedChq.has(bdDigits(p.chqNo)))
              && !(p.apNo && countedAP.has(String(p.apNo).trim())))
    .forEach(p => {
      const key = (p.pvNo || p.id || '') + '@' + p.date;
      const g = pvGroups[key] || (pvGroups[key] = { pvNo: p.pvNo, date: p.date, payee: '', amount: 0, aps: [], chqs: [], raws: [] });
      g.amount += Math.abs(p.amount);
      if (!g.payee && p.payee) g.payee = p.payee;
      if (p.apNo) g.aps.push(p.apNo);
      if (p.chqNo && g.chqs.indexOf(p.chqNo) < 0) g.chqs.push(p.chqNo);
      g.raws.push(p);
    });
  Object.keys(pvGroups).forEach(key => {
    const g = pvGroups[key];
    // sub: ไม่ใส่คำว่า "PV" นำหน้า — มีป้าย PV + เลขที่ขึ้นต้นด้วย PV อยู่แล้ว (กันคำซ้ำ)
    const sub = (g.pvNo || '—')
              + (g.aps.length > 1 ? ' • รวม ' + g.aps.length + ' รายการ' : (g.aps[0] ? ' • ' + g.aps[0] : ''))
              + (g.chqs.length ? ' • เช็ค ' + g.chqs.join(', ') : '');
    items.push({
      date: g.date, signed: -Math.abs(g.amount), kind: 'pv', ref: g.pvNo,
      title: g.payee || 'จ่ายตาม PV',
      sub,
      status: 'pv', raw: g.raws.length === 1 ? g.raws[0] : { _pvGroup: true, pvNo: g.pvNo, date: g.date, amount: g.amount, items: g.raws },
    });
  });
  items.sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);

  // กลุ่มตามวัน + ยอดคงเหลือสะสม (running = base + Σ signed)
  const groups = {};
  items.forEach(it => { (groups[it.date] = groups[it.date] || []).push(it); });
  let running = base;
  const dayGroups = Object.keys(groups).sort().map(date => {
    const its = groups[date];
    const net = its.reduce((s, i) => s + i.signed, 0);
    running += net;
    return { date, items: its, net, running };
  });

  const outTotal = items.filter(i => i.signed < 0).reduce((s, i) => s - i.signed, 0);
  const inTotal  = items.filter(i => i.signed > 0).reduce((s, i) => s + i.signed, 0);

  // near-term 7 วัน
  const near    = items.filter(i => (i.date || '') <= next7);
  const nearNet = near.reduce((s, i) => s + i.signed, 0);
  const afterNear = base + nearNet;
  const shortNear = afterNear < 0;
  const shortBy   = shortNear ? -afterNear : 0;

  const dueToday    = items.filter(i => i.date === today);
  const dueTodayOut = dueToday.filter(i => i.signed < 0).reduce((s, i) => s - i.signed, 0);
  // เช็คค้างขึ้นเงิน (outstanding, ลงวันที่ก่อน asOf) — *ไม่* หักจากยอดในการ์ด แต่เก็บเป็นลิสต์ให้กดดู/ไปแก้ไข
  const overdue     = matchedChecks
    .filter(c => bdIsOutstanding(c._st) && (c.checkDate || '') !== '' && (c.checkDate || '') < asOfRef)
    .map(c => ({ checkNo: c.checkNo || '', payee: c.payee || '—', amount: bdNum(c.amount), checkDate: c.checkDate || '', status: c._st, raw: c }))
    .sort((a, b) => (a.checkDate < b.checkDate ? -1 : 1));

  return { acct, base, items, dayGroups, outTotal, inTotal,
           near, nearNet, afterNear, shortNear, shortBy, dueToday, dueTodayOut, overdue };
}

/* ── Add/Edit Transfer Modal (พร้อมจำลอง what-if เงินพอไหม + เลือกช่วงในตัว) ── */
function AddTransferModal({ bankAccounts, onSave, onClose, initialTo, initialFrom, initial, onDelete, canDelete, acctData, initialPeriod }) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!(initial && initial.ref);
  const [form, setForm] = React.useState({
    fromAccountNo: (initial && initial.fromAccountNo) || initialFrom || '',
    toAccountNo:   (initial && initial.toAccountNo)   || initialTo   || '',
    amount: (initial && initial.amount != null) ? String(initial.amount) : '',
    date:   (initial && initial.date) || today,
    ref:    (initial && initial.ref) || '',
    note:   (initial && initial.note) || '',
  });
  const [err, setErr] = React.useState('');
  const [simPeriod, setSimPeriod] = React.useState(initialPeriod || 'thisMonth');

  // คำนวณภาระจ่ายของบัญชีตาม "ช่วงเวลาที่เลือกใน modal" — ปรับได้สดโดยไม่ต้องปิด
  const data      = acctData || {};
  const simEnd    = bdPeriodEnd(today, simPeriod);
  const simLabel  = (BD_PERIODS.find(p => p.key === simPeriod) || {}).label || '';
  const editRef = isEdit ? initial.ref : null;
  const periodOutOf = (accountNo) => {
    const a = data[accountNo];
    if (!a) return null;
    // ตอนแก้ไข: ไม่นับ leg ของรายการโอนตัวเอง (กันนับซ้ำ เพราะ amt คือยอดใหม่ที่กำลังจะแทน)
    const out = a.items.filter(i => i.signed < 0 && i.date <= simEnd && !(editRef && i.ref === editRef)).reduce((s, i) => s - i.signed, 0);
    return { base: a.base, periodOut: out };
  };

  const setF = (k, v) => { setErr(''); setForm(prev => ({ ...prev, [k]: v })); };

  const handleSave = () => {
    if (!form.fromAccountNo)                     return setErr('กรุณาเลือกบัญชีต้นทาง');
    if (!form.toAccountNo)                       return setErr('กรุณาเลือกบัญชีปลายทาง');
    if (form.fromAccountNo === form.toAccountNo) return setErr('บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน');
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0)                        return setErr('กรุณาระบุจำนวนเงินที่ถูกต้อง');
    if (!form.date)                              return setErr('กรุณาเลือกวันที่');

    const ref      = form.ref.trim() || ('TRF-' + Date.now());
    const fromAcct = bankAccounts.find(function(a){ return a.accountNo === form.fromAccountNo; });
    const toAcct   = bankAccounts.find(function(a){ return a.accountNo === form.toAccountNo; });
    const noteText = form.note.trim();
    const ts       = Date.now();
    // ★ ตอนแก้ไข: ใช้ id เดิมของขา out/in (ห้ามสร้าง id ใหม่) — ไม่งั้น sync จะมองว่าเป็น
    //   "ลบแถวเก่า + เพิ่มแถวใหม่" ซึ่ง base-reconcile/3-way-merge (กันข้อมูลหาย) อาจ
    //   ปกป้องแถวเก่าไว้ไม่ให้ถูกลบ → กลายเป็นรายการซ้ำในแบงค์ (ดู [[bank-diary-live-fields]]).
    //   การคง id เดิมไว้ = อัปเดตแถวเดิมในที่ จึงกันซ้ำได้ชัวร์ (และยังกวาดแถวซ้ำเก่าทิ้งด้วย
    //   เพราะ handleSaveTransfer ลบทุกขาตาม transferRef ก่อน แล้วเขียนกลับแค่ 2 ขา id เดิม)
    const outId = (isEdit && initial && initial.outId) || ('be-'+ts+'-out');
    const inId  = (isEdit && initial && initial.inId)  || ('be-'+ts+'-in');

    onSave([
      { id:outId, accountNo:form.fromAccountNo, bankName:(fromAcct ? fromAcct.bankName : ''), entryDate:form.date, entryType:'outflow_transfer', amount:-amt, description:noteText || ('โอนเงินไป '+(toAcct ? toAcct.bankName : '')+' '+form.toAccountNo), transferRef:ref, reconciled:false },
      { id:inId,  accountNo:form.toAccountNo,   bankName:(toAcct  ? toAcct.bankName  : ''), entryDate:form.date, entryType:'inflow_transfer',  amount: amt, description:noteText || ('รับโอนจาก '+(fromAcct ? fromAcct.bankName : '')+' '+form.fromAccountNo), transferRef:ref, reconciled:false },
    ], isEdit);
  };

  const inp = { width:'100%', padding:'8px 11px', boxSizing:'border-box', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, fontFamily:'inherit', outline:'none' };
  const sel = { ...inp, background:'#fff' };
  const lbl = { fontSize:12, fontWeight:600, color:'#475569', marginBottom:4, display:'block' };

  const acctLabel = (a) => (a.bankName ? a.bankName + ' — ' : '') + a.accountNo;
  const fromName = form.fromAccountNo ? acctLabel(bankAccounts.find(function(a){ return a.accountNo===form.fromAccountNo; }) || {accountNo:form.fromAccountNo}) : '—';
  const toName   = form.toAccountNo   ? acctLabel(bankAccounts.find(function(a){ return a.accountNo===form.toAccountNo;   }) || {accountNo:form.toAccountNo})   : '—';

  /* ── จำลอง what-if: โอนแล้วแต่ละบัญชีพอจ่ายภาระตัวเองไหม ── */
  const amt   = parseFloat(form.amount) || 0;
  const fromS = periodOutOf(form.fromAccountNo);   // { base, periodOut } ตามช่วงที่เลือก
  const toS   = periodOutOf(form.toAccountNo);
  const fromAfter      = fromS ? fromS.base - amt : null;          // เหลือหลังโอนออก
  const fromAfterCover = fromS ? fromAfter - fromS.periodOut : null; // เหลือหลังหักภาระตัวเอง
  const toAfter        = toS ? toS.base + amt : null;              // เหลือหลังรับเข้า
  const toBeforeCover  = toS ? toS.base - toS.periodOut : null;
  const toAfterCover   = toS ? toAfter - toS.periodOut : null;
  const suggest        = toS ? Math.max(0, toS.periodOut - toS.base) : 0; // ยอดที่ควรโอนให้ปลายทางพอ
  const overdraw       = fromS ? amt > fromS.base : false;        // โอนเกินยอดที่มี

  const money = (v) => (v >= 0 ? '' : '−') + fmtMoney(Math.abs(v));

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
         onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:500, maxHeight:'calc(100vh - 32px)', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,0.18)', overflow:'hidden' }}
           onClick={function(e){ e.stopPropagation(); }}>

        {/* Header */}
        <div style={{ flexShrink:0, padding:'16px 20px', background:'linear-gradient(135deg,#faf5ff,#ede9fe)', borderBottom:'1px solid #d6bcfa', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontWeight:700, fontSize:15, color:'#44337a' }}>{isEdit ? '✏️ แก้ไขการโอนเงินระหว่างบัญชี' : '⇄ บันทึกการโอนเงินระหว่างบัญชี'}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'#805ad5', lineHeight:1, padding:'0 4px' }}>✕</button>
        </div>

        {/* Body (เลื่อนได้ถ้ายาวเกินจอ) */}
        <div style={{ padding:20, overflowY:'auto', flex:1, minHeight:0 }}>
          {/* Preview arrow */}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, padding:'10px 14px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0' }}>
            <div style={{ flex:1, textAlign:'center' }}>
              <div style={{ fontSize:11, color:'#718096', marginBottom:2 }}>โอนออกจาก</div>
              <div style={{ fontWeight:700, fontSize:13, color:'#c53030' }}>{fromName}</div>
            </div>
            <div style={{ fontSize:20, color:'#805ad5' }}>→</div>
            <div style={{ flex:1, textAlign:'center' }}>
              <div style={{ fontSize:11, color:'#718096', marginBottom:2 }}>โอนเข้า</div>
              <div style={{ fontWeight:700, fontSize:13, color:'#276749' }}>{toName}</div>
            </div>
            {form.amount ? <div style={{ fontSize:13, fontWeight:700, color:'#1a202c', whiteSpace:'nowrap', marginLeft:8 }}>{fmtMoney(parseFloat(form.amount)||0)}</div> : null}
          </div>

          {/* What-if simulation — แสดงเมื่อเลือกครบ */}
          {(fromS || toS) && form.fromAccountNo && form.toAccountNo && form.fromAccountNo !== form.toAccountNo && (
            <div style={{ marginBottom:16, border:'1px solid #e2e8f0', borderRadius:10, overflow:'hidden' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 12px', background:'#f1f5f9', fontSize:11, fontWeight:700, color:'#475569' }}>
                <span>จำลองหลังโอน · ภาระจ่ายช่วง “{simLabel}”</span>
                {amt > 0 && <span style={{ color:'#805ad5' }}>{fmtMoney(amt)}</span>}
              </div>
              {/* เลือกช่วงเวลาในตัว modal — ปรับดูพอ/ไม่พอแต่ละช่วงได้สด */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:5, padding:'7px 12px', borderBottom:'1px solid #eef0f6' }}>
                {BD_PERIODS.map(p => (
                  <button key={p.key} type="button" onClick={() => setSimPeriod(p.key)}
                    style={{ padding:'3px 9px', borderRadius:14, fontSize:10, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                             border:'1px solid ' + (simPeriod===p.key ? '#805ad5' : '#e2e8f0'),
                             background: simPeriod===p.key ? '#805ad5' : '#fff',
                             color: simPeriod===p.key ? '#fff' : '#64748b' }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr' }}>
                {/* FROM */}
                <div style={{ padding:'9px 12px', borderRight:'1px solid #eef0f6' }}>
                  <div style={{ fontSize:10, color:'#c53030', fontWeight:700, marginBottom:3 }}>↑ ต้นทาง (โอนออก)</div>
                  {fromS ? (
                    <div style={{ fontSize:11, color:'#475569', display:'grid', gap:2 }}>
                      <div style={{ display:'flex', justifyContent:'space-between' }}><span>ยอดจริง</span><b>{fmtMoney(fromS.base)}</b></div>
                      <div style={{ display:'flex', justifyContent:'space-between', color:'#94a3b8' }}><span>ภาระจ่าย</span><span>−{fmtMoney(fromS.periodOut)}</span></div>
                      <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px dashed #e2e8f0', paddingTop:2, fontWeight:700 }}>
                        <span>เหลือหลังโอน</span><span style={{ color: fromAfterCover < 0 ? '#dc2626' : '#276749' }}>{money(fromAfterCover)}</span>
                      </div>
                      {fromAfterCover < 0
                        ? <div style={{ fontSize:10, color:'#dc2626' }}>⚠ โอนแล้วต้นทางจะไม่พอจ่ายภาระตัวเอง</div>
                        : <div style={{ fontSize:10, color:'#276749' }}>✓ ต้นทางยังพอ</div>}
                    </div>
                  ) : <div style={{ fontSize:11, color:'#a0aec0' }}>—</div>}
                </div>
                {/* TO */}
                <div style={{ padding:'9px 12px' }}>
                  <div style={{ fontSize:10, color:'#276749', fontWeight:700, marginBottom:3 }}>↓ ปลายทาง (รับเข้า)</div>
                  {toS ? (
                    <div style={{ fontSize:11, color:'#475569', display:'grid', gap:2 }}>
                      <div style={{ display:'flex', justifyContent:'space-between' }}><span>ยอดจริง</span><b>{fmtMoney(toS.base)}</b></div>
                      <div style={{ display:'flex', justifyContent:'space-between', color:'#94a3b8' }}><span>ภาระจ่าย</span><span>−{fmtMoney(toS.periodOut)}</span></div>
                      <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px dashed #e2e8f0', paddingTop:2, fontWeight:700 }}>
                        <span>เหลือหลังรับ</span><span style={{ color: toAfterCover < 0 ? '#dc2626' : '#276749' }}>{money(toAfterCover)}</span>
                      </div>
                      {toAfterCover < 0
                        ? <div style={{ fontSize:10, color:'#dc2626' }}>⚠ รับแล้วยังขาดอีก {fmtMoney(-toAfterCover)}</div>
                        : <div style={{ fontSize:10, color:'#276749' }}>✓ ปลายทางพอจ่ายภาระ</div>}
                    </div>
                  ) : <div style={{ fontSize:11, color:'#a0aec0' }}>—</div>}
                </div>
              </div>
              {/* Suggestion */}
              {suggest > 0 && (
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, padding:'7px 12px', background:'#faf5ff', borderTop:'1px solid #eef0f6' }}>
                  <span style={{ fontSize:11, color:'#6b46c1' }}>ปลายทางขาดอยู่ — ควรโอนอย่างน้อย <b>{fmtMoney(suggest)}</b></span>
                  <button type="button" onClick={() => setF('amount', String(Math.ceil(suggest)))}
                    style={{ background:'#6b46c1', color:'#fff', border:'none', borderRadius:6, padding:'3px 10px', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                    ใช้ยอดนี้
                  </button>
                </div>
              )}
              {overdraw && (
                <div style={{ padding:'6px 12px', background:'#fff5f5', borderTop:'1px solid #fecaca', fontSize:10, color:'#dc2626' }}>
                  ⚠ จำนวนที่โอน ({fmtMoney(amt)}) มากกว่ายอดเงินจริงของต้นทาง ({fmtMoney(fromS.base)})
                </div>
              )}
            </div>
          )}

          {/* Form grid */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 14px' }}>

            <div style={{ gridColumn:'1/-1' }}>
              <label style={lbl}>บัญชีต้นทาง (โอนออก) *</label>
              <select style={sel} value={form.fromAccountNo} onChange={function(e){ setF('fromAccountNo', e.target.value); }}>
                <option value="">— เลือกบัญชีต้นทาง —</option>
                {bankAccounts.map(function(a, i){ return <option key={i} value={a.accountNo}>{a.bankName} — {a.accountNo}</option>; })}
              </select>
            </div>

            <div style={{ gridColumn:'1/-1' }}>
              <label style={lbl}>บัญชีปลายทาง (รับโอน) *</label>
              <select style={sel} value={form.toAccountNo} onChange={function(e){ setF('toAccountNo', e.target.value); }}>
                <option value="">— เลือกบัญชีปลายทาง —</option>
                {bankAccounts.map(function(a, i){ return <option key={i} value={a.accountNo}>{a.bankName} — {a.accountNo}</option>; })}
              </select>
            </div>

            <div>
              <label style={lbl}>จำนวนเงิน (บาท) *</label>
              <input type="number" style={inp} value={form.amount} min="0" step="0.01"
                onChange={function(e){ setF('amount', e.target.value); }} placeholder="0.00" />
            </div>

            <div>
              <label style={lbl}>วันที่โอน *</label>
              <input type="date" style={inp} value={form.date}
                onChange={function(e){ setF('date', e.target.value); }} />
            </div>

            <div style={{ gridColumn:'1/-1' }}>
              <label style={lbl}>เลขที่อ้างอิง <span style={{ fontWeight:400, color:'#94a3b8' }}>(ระบบสร้างให้ถ้าไม่กรอก)</span></label>
              <input type="text" style={inp} value={form.ref}
                onChange={function(e){ setF('ref', e.target.value); }} placeholder="เช่น TRF-2026-001" />
            </div>

            <div style={{ gridColumn:'1/-1' }}>
              <label style={lbl}>หมายเหตุ</label>
              <input type="text" style={inp} value={form.note}
                onChange={function(e){ setF('note', e.target.value); }} placeholder="รายละเอียดการโอน" />
            </div>

          </div>

          {err ? <div style={{ marginTop:10, padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:7, fontSize:12, color:'#dc2626' }}>⚠ {err}</div> : null}

          <div style={{ marginTop:18, display:'flex', gap:10, justifyContent: isEdit && onDelete && canDelete ? 'space-between' : 'flex-end', alignItems:'center' }}>
            {isEdit && onDelete && canDelete && (
              <button onClick={() => onDelete(initial.ref)}
                style={{ padding:'8px 14px', borderRadius:8, border:'1.5px solid #fecaca', background:'#fff', color:'#dc2626', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                ลบการโอน
              </button>
            )}
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={onClose}
                style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                ยกเลิก
              </button>
              <button onClick={handleSave}
                style={{ padding:'8px 20px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#2e8b4a,#1a592f)', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', boxShadow:'0 4px 12px rgba(46,139,74,0.3)' }}>
                {isEdit ? 'บันทึกการแก้ไข' : 'บันทึกการโอน'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Reconcile Panel ─────────────────────────────────────────────────── */
function ReconcilePanel({ transferPairs, bankAccounts, onReconcile, onEdit, canEdit }) {
  const acctMap = React.useMemo(() => {
    const m = {};
    bankAccounts.forEach(a => { m[a.accountNo] = a; });
    return m;
  }, [bankAccounts]);

  const pairs = Object.entries(transferPairs);

  const [collapsed, setCollapsed] = React.useState(true);   // ย่อไว้ก่อน — กดหัวการ์ดเพื่อกาง (เหมือนพาเนลประมาณการ)

  // ── Sort (กดหัวคอลัมน์) ──────────────────────────────────────────────
  const [sort, setSort] = React.useState({ key: 'date', dir: 'desc' });
  const toggleSort = (k) => setSort(s => s.key === k
    ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key: k, dir: (k === 'amount' || k === 'date') ? 'desc' : 'asc' });
  const sortArrow = (k) => sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const thStyle = (align, sortable) => ({ padding:'7px 10px', textAlign:align, fontWeight:600, color:'#6b46c1', borderBottom:'1px solid #e9d8fd', whiteSpace:'nowrap', fontSize:11, cursor: sortable ? 'pointer' : 'default', userSelect:'none' });
  const pairInfo = ([ref, entries]) => {
    const o = entries.find(e => e.entryType === 'outflow_transfer');
    const n = entries.find(e => e.entryType === 'inflow_transfer');
    return {
      date:   (o && o.entryDate) || (n && n.entryDate) || '',
      from:   (acctMap[o && o.accountNo] && acctMap[o.accountNo].bankName) || (o && o.bankName) || '',
      to:     (acctMap[n && n.accountNo] && acctMap[n.accountNo].bankName) || (n && n.bankName) || '',
      amount: Math.abs(parseFloat((o && o.amount) || (n && n.amount) || 0)),
      ref:    ref || '',
      status: entries.every(e => e.reconciled) ? 1 : 0,
    };
  };
  const sortedPairs = pairs.slice().sort((A, B) => {
    const a = pairInfo(A)[sort.key], b = pairInfo(B)[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    const av = a == null ? '' : a, bv = b == null ? '' : b;
    return av < bv ? -dir : av > bv ? dir : 0;
  });

  if (pairs.length === 0) return null;

  const pendingCount = pairs.filter(([, entries]) => entries.some(e => !e.reconciled)).length;

  return (
    <div className="card" style={{ marginBottom:20, padding:0, overflow:'hidden' }}>
      {/* Header — กดเพื่อย่อ/กาง (ย่อไว้ก่อน เหมือนพาเนลประมาณการ) */}
      <div onClick={() => setCollapsed(c => !c)}
        style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, padding:'12px 16px', background:'linear-gradient(135deg,#faf5ff,#ede9fe)', borderBottom: collapsed ? 'none' : '1px solid #d6bcfa', cursor:'pointer' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          <span style={{ fontSize:12, color:'#6b46c1', transform: collapsed ? 'none' : 'rotate(90deg)', transition:'transform .15s' }}>▶</span>
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:'#44337a' }}>⇄ ตรวจสอบการโอนเงินระหว่างบัญชี</div>
            <div style={{ fontSize:12, color:'#6b46c1', marginTop:2 }}>
              {pairs.length} คู่โอนทั้งหมด
              {pendingCount > 0 && ` · ${pendingCount} รายการรอกลืนยอด`}
              <span style={{ color:'#9f7aea' }}> · กดยืนยันเมื่อโอนจริง+ลง PV แล้ว (จะเลิกนับในยอดคาดการณ์)</span>
            </div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, whiteSpace:'nowrap' }}>
          {pendingCount > 0 && (
            <span style={{ background:'#fed7d7', color:'#c53030', fontSize:11, fontWeight:700, borderRadius:20, padding:'4px 12px' }}>
              ⚠ {pendingCount} รอ Reconcile
            </span>
          )}
          {pendingCount === 0 && pairs.length > 0 && (
            <span style={{ background:'#c6f6d5', color:'#276749', fontSize:11, fontWeight:700, borderRadius:20, padding:'4px 12px' }}>
              ✓ ยืนยันครบทุกรายการ
            </span>
          )}
          <span style={{ fontSize:11, fontWeight:600, color:'#6b46c1' }}>{collapsed ? 'กดเพื่อดู ▾' : 'ย่อ ▴'}</span>
        </div>
      </div>

      {!collapsed && (
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:'#faf5ff' }}>
              <th onClick={() => toggleSort('date')}   style={thStyle('left', true)}>วันที่{sortArrow('date')}</th>
              <th onClick={() => toggleSort('from')}   style={thStyle('left', true)}>จากบัญชี{sortArrow('from')}</th>
              <th style={thStyle('center', false)}></th>
              <th onClick={() => toggleSort('to')}     style={thStyle('left', true)}>ไปบัญชี{sortArrow('to')}</th>
              <th onClick={() => toggleSort('amount')} style={thStyle('right', true)}>จำนวนเงิน{sortArrow('amount')}</th>
              <th onClick={() => toggleSort('ref')}    style={thStyle('left', true)}>เลขอ้างอิง{sortArrow('ref')}</th>
              <th style={thStyle('left', false)}>หมายเหตุ</th>
              <th onClick={() => toggleSort('status')} style={thStyle('left', true)}>สถานะ{sortArrow('status')}</th>
              <th style={thStyle('left', false)}></th>
            </tr>
          </thead>
          <tbody>
            {sortedPairs.map(([ref, entries]) => {
              const outEntry    = entries.find(e => e.entryType === 'outflow_transfer');
              const inEntry     = entries.find(e => e.entryType === 'inflow_transfer');
              const isReconciled= entries.every(e => e.reconciled);
              const date        = outEntry?.entryDate || inEntry?.entryDate || '';
              const fromAcct    = acctMap[outEntry?.accountNo];
              const toAcct      = acctMap[inEntry?.accountNo];
              const amount      = Math.abs(parseFloat(outEntry?.amount || inEntry?.amount || 0));

              const editObj = { fromAccountNo: outEntry?.accountNo || '', toAccountNo: inEntry?.accountNo || '', amount: amount, date: date, ref: ref, note: (outEntry?.description || inEntry?.description || '') };
              return (
                <tr key={ref}
                    onClick={canEdit ? () => onEdit(editObj) : undefined}
                    title={canEdit ? 'กดเพื่อแก้ไข / แก้จำนวนเงิน' : undefined}
                    style={{ borderBottom:'1px solid #f0f4f8', background: isReconciled ? '#f0fff4' : 'transparent', cursor: canEdit ? 'pointer' : 'default' }}>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap', color:'#4a5568', fontSize:11 }}>{fmtDate(date)}</td>
                  <td style={{ padding:'8px 10px' }}>
                    <div style={{ fontWeight:600, color:'#c53030', fontSize:12 }}>{fromAcct?.bankName || outEntry?.bankName || '—'}</div>
                    <div style={{ fontSize:10, color:'#718096' }}>{outEntry?.accountNo || '—'}</div>
                  </td>
                  <td style={{ padding:'8px 4px', textAlign:'center', fontSize:18, color:'#805ad5' }}>→</td>
                  <td style={{ padding:'8px 10px' }}>
                    <div style={{ fontWeight:600, color:'#276749', fontSize:12 }}>{toAcct?.bankName || inEntry?.bankName || '—'}</div>
                    <div style={{ fontSize:10, color:'#718096' }}>{inEntry?.accountNo || '—'}</div>
                  </td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap', color:'#1a202c' }}>
                    {fmtMoney(amount)}
                  </td>
                  <td style={{ padding:'8px 10px', fontSize:11, color:'#805ad5' }}>{ref}</td>
                  <td style={{ padding:'8px 10px', color:'#4a5568', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {outEntry?.description || inEntry?.description || '—'}
                  </td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>
                    {isReconciled
                      ? <span style={{ background:'#c6f6d5', color:'#276749', fontSize:11, fontWeight:600, borderRadius:12, padding:'2px 9px' }}>✓ กลืนยอดแล้ว</span>
                      : <span style={{ background:'#feebc8', color:'#b45309', fontSize:11, fontWeight:600, borderRadius:12, padding:'2px 9px' }}>รอกลืนยอด</span>
                    }
                  </td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>
                    {!isReconciled && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onReconcile(ref); }}
                        style={{ background:'#6b46c1', color:'#fff', border:'none', borderRadius:6, padding:'4px 12px', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}
                      >
                        ยืนยัน
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(editObj); }}
                        title="แก้ไข"
                        style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, marginLeft:6, padding:'2px 4px' }}
                      >
                        ✏️
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/* ป้ายชนิดรายการ (ประมาณการ / โอน / PV / เช็ค) */
function bdItemTag(kind) {
  return kind === 'forecast' ? { t:'ประมาณการ', bg:'#ede9fe', c:'#6b21a8' }
       : kind === 'transfer' ? { t:'โอน',       bg:'#fae8ff', c:'#86198f' }
       : kind === 'pv'       ? { t:'PV',        bg:'#fef9c3', c:'#854d0e' }
       : { t:'เช็ค', bg:'#e0f2fe', c:'#075985' };
}

/* แถวรายการเดี่ยวในการ์ดบัญชี (ใช้ทั้งแบบเดี่ยวและรายย่อยในกลุ่มผู้ขาย) */
function BDItemRow({ it, top, onItemEdit, label, sub, hideTag }) {
  const inflow   = it.signed >= 0;
  const tag      = bdItemTag(it.kind);
  const editable = onItemEdit && (it.kind === 'forecast' || it.kind === 'transfer');
  return (
    <div onClick={editable ? () => onItemEdit(it) : undefined}
         title={editable ? 'กดเพื่อแก้ไขรายการ' : undefined}
         style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'0 8px', padding:'5px 0', borderTop: top ? '1px dashed #e9e9f3' : 'none', cursor: editable ? 'pointer' : 'default', borderRadius: editable ? 6 : 0 }}>
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:12, color:'#1e293b' }}>
          {!hideTag && <span style={{ display:'inline-block', fontSize:9, fontWeight:700, borderRadius:4, padding:'0 5px', marginRight:5, background:tag.bg, color:tag.c }}>{tag.t}</span>}
          {label != null ? label : it.title}
          {editable && <span style={{ marginLeft:6, fontSize:10, color:'#a5b4fc' }}>✏️</span>}
        </div>
        <div style={{ fontSize:10, color:'#94a3b8' }}>{sub != null ? sub : it.sub}</div>
        {it.remark ? <div style={{ fontSize:10, color:'#64748b', marginTop:1 }}>📝 {it.remark}</div> : null}
      </div>
      <div style={{ textAlign:'right', fontWeight:600, fontSize:12, color: inflow ? '#276749' : '#c53030', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
        {inflow ? '+' : '−'}{fmtMoney(Math.abs(it.signed))}
      </div>
    </div>
  );
}

/* กลุ่มรายการผู้ขายเดียวกันในวันเดียว (ย่อ=ชื่อ+ยอดรวม, กาง=รายย่อยเป็นเลขที่ AP + ยอด) */
function BDDayItemGroup({ group, top, onItemEdit }) {
  const [open, setOpen] = React.useState(false);
  const tag    = bdItemTag(group.kind);
  const inflow = group.total >= 0;
  return (
    <div style={{ borderTop: top ? '1px dashed #e9e9f3' : 'none' }}>
      {/* group header */}
      <div onClick={() => setOpen(o => !o)}
           style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:'0 8px', padding:'5px 0', cursor:'pointer', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
          <span style={{ fontSize:9, color:'#94a3b8', transform: open ? 'rotate(90deg)' : 'none', transition:'transform .15s' }}>▶</span>
          <span style={{ display:'inline-block', fontSize:9, fontWeight:700, borderRadius:4, padding:'0 5px', background:tag.bg, color:tag.c, whiteSpace:'nowrap' }}>{tag.t}</span>
          <span style={{ fontSize:12, fontWeight:600, color:'#1e293b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{group.name}</span>
          <span style={{ fontSize:10, color:'#94a3b8', whiteSpace:'nowrap' }}>· {group.items.length} ใบ</span>
        </div>
        <div style={{ textAlign:'right', fontWeight:700, fontSize:12, color: inflow ? '#276749' : '#c53030', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
          {inflow ? '+' : '−'}{fmtMoney(Math.abs(group.total))}
        </div>
      </div>
      {/* details — เลขที่ AP + ยอด ของแต่ละใบ */}
      {open && (
        <div style={{ paddingLeft:20 }}>
          {group.items.map((it, i) => (
            <BDItemRow key={i} it={it} top={i > 0} onItemEdit={onItemEdit} hideTag
              label={it.refDoc || it.title}
              sub={it.status === 'actual' ? '✓ จ่าย/รับจริงแล้ว' : ''} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Day group row (expandable) — เช็คที่ครบกำหนดในวันเดียวกัน ────────── */
function BDDayGroup({ day, today, onItemEdit }) {
  const [open, setOpen] = React.useState(false);
  const isToday   = day.date === today;
  const isOverdue = day.date < today;
  const dueColor  = isOverdue ? '#c026d3' : isToday ? '#dc2626' : '#1e293b';

  return (
    <div style={{ borderBottom:'1px solid #f0f4f8' }}>
      {/* Day header — clickable */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display:'grid', gridTemplateColumns:'16px 86px 1fr auto auto',
          gap:'0 8px', alignItems:'center', padding:'7px 14px', cursor:'pointer',
          background: isToday ? '#fff1f2' : isOverdue ? '#fdf4ff' : 'transparent',
        }}
      >
        <span style={{ fontSize:10, color:'#94a3b8', transform: open ? 'rotate(90deg)' : 'none', transition:'transform .15s' }}>▶</span>
        <div style={{ fontSize:11, fontWeight:700, color:dueColor, whiteSpace:'nowrap' }}>
          {fmtDate(day.date)}
          {isToday   && <span style={{ display:'block', fontSize:9, fontWeight:700, color:'#dc2626' }}>วันนี้</span>}
          {isOverdue && <span style={{ display:'block', fontSize:9, fontWeight:700, color:'#c026d3' }}>เลยกำหนด</span>}
        </div>
        <div style={{ fontSize:11, color:'#64748b' }}>
          {day.items.length} รายการ
        </div>
        <div style={{ textAlign:'right', fontWeight:700, fontSize:12, color: day.net >= 0 ? '#276749' : '#c53030', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
          {day.net >= 0 ? '+' : '−'}{fmtMoney(Math.abs(day.net))}
        </div>
        <div style={{ textAlign:'right', fontSize:11, fontWeight:600, color: day.running < 0 ? '#dc2626' : '#475569', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap', minWidth:88 }}>
          คงเหลือ {fmtMoney(day.running)}
        </div>
      </div>

      {/* Items — shown when open: จับกลุ่ม forecast ผู้ขายเดียวกันในวันเดียว → ย่อเป็น 1 บรรทัด (ชื่อ+ยอดรวม), ชนิดอื่นแสดงเดี่ยวเหมือนเดิม */}
      {open && (
        <div style={{ background:'#fafbff', padding:'2px 14px 8px 34px' }}>
          {(() => {
            const order = [];
            const map = {};
            day.items.forEach((it, i) => {
              const key = it.group ? ('g:' + it.kind + ':' + it.group) : ('i:' + i);
              if (!map[key]) { map[key] = { key, name: it.group || it.title, kind: it.kind, items: [], total: 0 }; order.push(map[key]); }
              map[key].items.push(it);
              map[key].total += it.signed;
            });
            return order.map((g, gi) => (
              // forecast (รวม 1 ใบ) → ย่อเป็นกลุ่มเหมือนกันให้สวยงาม · เช็ค/PV/โอน เดี่ยว → แถวเดียวตามเดิม
              (g.items.length > 1 || g.kind === 'forecast')
                ? <BDDayItemGroup key={g.key} group={g} top={gi > 0} onItemEdit={onItemEdit} />
                : <BDItemRow key={g.key} it={g.items[0]} top={gi > 0} onItemEdit={onItemEdit} />
            ));
          })()}
        </div>
      )}
    </div>
  );
}

/* ── Account Card — ยอดเงินจริง + เช็ค/ประมาณการแยกตามวัน ───────────── */
/* Modal — เช็คเลยกำหนดที่ยังไม่ขึ้นเงิน (ไม่หักจากยอดในการ์ด) → ดูรายการ + ไปหน้าจัดการเช็คเพื่อแก้ */
// ป้ายชื่อฟิลด์เช็ค (raw) → ไทย สำหรับแผงรายละเอียด
const BD_CHECK_FIELD_LABELS = {
  checkNo:'เลขที่เช็ค', checkDate:'ลงวันที่', payee:'ผู้รับเงิน', amount:'จำนวนเงิน',
  accountNo:'เลขบัญชี', bankName:'ธนาคาร', status:'สถานะ', issueDate:'วันที่ออกเช็ค',
  dueDate:'ครบกำหนด', remark:'หมายเหตุ', note:'หมายเหตุ', refDoc:'เอกสารอ้างอิง',
  docNo:'เลขที่เอกสาร', vchno:'เลขที่', cust_name:'ผู้รับเงิน', description:'รายละเอียด',
};
function bdCheckDetailPairs(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const skip = new Set(['id', '_st']);
  return Object.keys(raw)
    .filter(k => !skip.has(k) && raw[k] != null && raw[k] !== '')
    .map(k => [BD_CHECK_FIELD_LABELS[k] || k, String(raw[k])]);
}

function BDOverdueChecksModal({ acctLabel, checks, canEdit, onSetStatus, onClose }) {
  const total = (checks || []).reduce((s, c) => s + (c.amount || 0), 0);
  const editable = !!(canEdit && onSetStatus);
  const [openRow, setOpenRow] = React.useState(null);
  const apply = (c, status) => {
    if (!onSetStatus) return;
    if (!window.confirm('ยืนยัน: เช็ค #' + (c.checkNo || '—') + ' (' + (c.payee || '') + ') → "' + status + '"?')) return;
    onSetStatus(c.raw, status);
  };
  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:14, maxWidth:660, width:'100%', maxHeight:'80vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'14px 18px', borderBottom:'1px solid #f0f4f8', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:15, color:'#86198f' }}>⏰ เช็คเลยกำหนด · ยังไม่ขึ้นเงิน — {acctLabel}</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{(checks || []).length} ฉบับ · รวม {fmtMoney(total)} · <b>ไม่ได้หักจากยอดในการ์ด</b></div>
          </div>
          <button onClick={onClose} style={{ border:'none', background:'transparent', fontSize:20, cursor:'pointer', color:'#94a3b8', lineHeight:1 }}>✕</button>
        </div>
        <div style={{ overflow:'auto' }}>
          <table className="tbl" style={{ width:'100%', fontSize:12.5 }}>
            <thead style={{ position:'sticky', top:0, background:'#fff' }}>
              <tr>
                <th style={{ width:92 }}>ลงวันที่</th>
                <th>ผู้รับเงิน</th>
                <th style={{ width:96 }}>เลขที่เช็ค</th>
                <th style={{ textAlign:'right', width:108 }}>จำนวน</th>
                {editable && <th style={{ textAlign:'center', width:170 }}>แก้สถานะ</th>}
              </tr>
            </thead>
            <tbody>
              {(checks || []).length === 0 ? (
                <tr><td colSpan={editable ? 5 : 4} style={{ textAlign:'center', color:'#16a34a', padding:'18px 0', fontWeight:600 }}>✓ ไม่มีเช็คค้างขึ้นเงินแล้ว</td></tr>
              ) : (checks || []).map((c, i) => {
                const open  = openRow === i;
                const pairs = bdCheckDetailPairs(c.raw);
                return (
                <React.Fragment key={i}>
                <tr onClick={() => setOpenRow(o => o === i ? null : i)} title="กดดูรายละเอียดเพิ่มเติม"
                    style={{ cursor:'pointer', background: open ? '#faf5ff' : 'transparent' }}>
                  <td style={{ whiteSpace:'nowrap', color:'#c026d3' }}>
                    <span style={{ display:'inline-block', width:12, fontSize:9, transform: open ? 'rotate(90deg)' : 'none', transition:'transform .15s' }}>▶</span>
                    {fmtDate(c.checkDate) || c.checkDate || '—'}
                  </td>
                  <td>{c.payee}</td>
                  <td style={{ fontFamily:'ui-monospace', fontSize:11 }}>{c.checkNo || '—'}</td>
                  <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', color:'#c53030', fontWeight:600 }}>−{fmtMoney(c.amount)}</td>
                  {editable && (
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => apply(c, 'ขึ้นเงินแล้ว')} title="ทำเครื่องหมายว่าเช็คขึ้นเงินแล้ว — ตัดออกจากรายการค้าง"
                        style={{ background:'#16a34a', color:'#fff', border:'none', borderRadius:6, padding:'4px 9px', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', marginRight:5 }}>✓ ขึ้นเงินแล้ว</button>
                      <button onClick={() => apply(c, 'ยกเลิก')} title="ยกเลิกเช็คใบนี้"
                        style={{ background:'#fff', color:'#dc2626', border:'1px solid #fecaca', borderRadius:6, padding:'4px 9px', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>ยกเลิก</button>
                    </td>
                  )}
                </tr>
                {open && (
                  <tr>
                    <td colSpan={editable ? 5 : 4} style={{ background:'#faf5ff', padding:'10px 16px', borderBottom:'2px solid #f0e6fb' }}>
                      {pairs.length === 0 ? (
                        <span style={{ fontSize:12, color:'#94a3b8' }}>ไม่มีข้อมูลเพิ่มเติม</span>
                      ) : (
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'6px 16px' }}>
                          {pairs.map(([k, v], j) => (
                            <div key={j} style={{ fontSize:12, minWidth:0 }}>
                              <span style={{ color:'#94a3b8' }}>{k}: </span>
                              <span style={{ color:'#334155', fontWeight:600, wordBreak:'break-word' }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'12px 18px', borderTop:'1px solid #f0f4f8', display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:11, color:'#94a3b8' }}>{editable ? 'กด "✓ ขึ้นเงินแล้ว" เพื่อตัดออก (บันทึก+ซิงค์ขึ้นชีต)' : 'ลงวันที่ก่อนยอดยกมา · ไม่ได้หักจากยอดในการ์ด'}</span>
          <button onClick={() => { onClose(); location.hash = 'checks'; }}
            style={{ background:'#fff', color:'#4338ca', border:'1px solid #c7d2fe', borderRadius:8, padding:'8px 14px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
            จัดการเช็คทั้งหมด →
          </button>
        </div>
      </div>
    </div>
  );
}

function BankAccountCard({ view, today, periodEnd, periodLabel, onQuickTransfer, onItemEdit, onCheckStatus, canEdit }) {
  const [expanded, setExpanded] = React.useState(true);
  const [showAll, setShowAll]   = React.useState(false);
  const [showOverdue, setShowOverdue] = React.useState(false);
  const { acct, base, dayGroups, near, afterNear, shortNear, shortBy, dueToday, dueTodayOut, overdue } = view;
  const cardRef = React.useRef(null);
  const [saving, setSaving] = React.useState(false);

  // บันทึกการ์ดเป็นรูป PNG (html2canvas-pro) — ตัดปุ่มเอง (data-no-capture) ออกจากภาพ
  const handleSaveImage = async (e) => {
    if (e) e.stopPropagation();
    if (typeof window.html2canvas !== 'function') { alert('ตัวช่วยบันทึกรูปยังโหลดไม่เสร็จ — ลองใหม่อีกครั้ง'); return; }
    const node = cardRef.current; if (!node) return;
    setSaving(true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const SCALE = 2;
      const full = await window.html2canvas(node, {
        backgroundColor: '#ffffff', scale: SCALE, useCORS: true, logging: false,
        ignoreElements: (el) => el.getAttribute && el.getAttribute('data-no-capture') === '1',
      });
      // ตัดให้รูป "จบที่บรรทัดยอดเงินคงเหลือสุทธิ" + ปิดท้ายด้วยช่องว่าง+เส้นสี (กันดูเหมือนรูปขาด)
      let out = full;
      const endEl = node.querySelector('[data-capture-end="1"]');
      if (endEl) {
        const cropH = Math.round((endEl.getBoundingClientRect().bottom - node.getBoundingClientRect().top) * SCALE);
        if (cropH > 0 && cropH < full.height - 2) {
          const accent   = netEnding < 0 ? '#e53e3e' : '#276749';   // แดงเมื่อติดลบ / เขียวเมื่อบวก
          const footerBg = netEnding < 0 ? '#fff5f5' : '#f0fdf4';
          const pad  = Math.round(5 * SCALE);   // ช่องว่างใต้บรรทัดก่อนเส้น
          const line = Math.round(3 * SCALE);   // เส้นปิดท้าย
          out = document.createElement('canvas');
          out.width = full.width;
          out.height = cropH + pad + line;
          const ctx = out.getContext('2d');
          ctx.drawImage(full, 0, 0, full.width, cropH, 0, 0, full.width, cropH);
          ctx.fillStyle = footerBg; ctx.fillRect(0, cropH, full.width, pad + line);
          ctx.fillStyle = accent;   ctx.fillRect(0, cropH + pad, full.width, line);
        }
      }
      const a = document.createElement('a');
      a.download = (bdBrand(acct.bankName).label || 'bank') + '-' + (bdLast4(acct.accountNo) || '') + '-' + String(today).replace(/-/g, '') + '.png';
      a.href = out.toDataURL('image/png');
      a.click();
    } catch (err) {
      console.error('save card image failed', err);
      alert('บันทึกรูปไม่สำเร็จ: ' + (err && err.message ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const visibleGroups = showAll ? dayGroups : dayGroups.filter(g => g.date <= periodEnd);
  const hiddenCount   = dayGroups.length - visibleGroups.length;

  // สรุปยอดตาม "ช่วงที่กำลังดู" (ไม่ใช่ทั้งหมด) — ถ้ากดดูทั้งหมดก็สรุปทั้งหมด
  const visItems = visibleGroups.reduce((a, g) => a.concat(g.items), []);
  const visCount = visItems.length;
  const visIn    = visItems.filter(i => i.signed > 0).reduce((s, i) => s + i.signed, 0);
  const visOut   = visItems.filter(i => i.signed < 0).reduce((s, i) => s - i.signed, 0);
  // ยอดเงินคงเหลือสุทธิ "ตามรายการที่เปิดดู" = ยอดใช้ได้จริง + รับ − จ่าย ในช่วงที่กำลังแสดง
  const netEnding = base + visIn - visOut;

  // เงินขาดในช่วงที่ดู: ยอดคงเหลือสะสม "ต่ำสุด" ภายในช่วง periodEnd ติดลบไหม (ไม่ใช่แค่ 7 วัน)
  const periodGroups = dayGroups.filter(g => g.date <= periodEnd);
  const minRunPeriod = periodGroups.reduce((m, g) => Math.min(m, g.running), base);
  const shortInPeriod = minRunPeriod < 0;
  // แจ้งเตือน "เงินไม่พอ" (กรอบแดง/ป้าย) อิงเฉพาะ "ช่วงที่เลือกดู" — ไม่ใช้กรอบ 7 วันตายตัว
  //   ที่ทะลุข้ามช่วง (เช่น ดู "สัปดาห์นี้" แต่เด้งแดงเพราะรายการสัปดาห์หน้าใน 7 วัน)
  const isShort   = shortInPeriod;
  const coverAmt  = shortInPeriod ? -minRunPeriod : 0;
  // ป้าย "📆 ภายใน 7 วัน" โผล่เฉพาะตอนกรอบ 7 วันยังอยู่ในช่วงที่เลือกดู
  //   (ดูช่วงสั้นกว่า 7 วัน เช่น "สัปดาห์นี้" → ป้ายจะเกินช่วง จึงไม่โชว์)
  const next7Card = bdISO(new Date(new Date(today + 'T00:00:00').getTime() + 7 * 86400000));
  const showNear  = near.length > 0 && next7Card <= periodEnd;

  const brand = bdBrand(acct.bankName);
  const last4 = bdLast4(acct.accountNo);
  // หัวการ์ดสไตล์บัตรธนาคาร — สีแบรนด์เต็ม + sheen/เงา ตัวอักษรขาว
  const headerGrad = 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 38%), linear-gradient(135deg, ' + brand.color + ' 0%, rgba(0,0,0,0.28) 165%)';

  return (
    <div className="card" ref={cardRef} style={{
      padding:0, overflow:'hidden',
      border: isShort ? '2px solid #fc8181' : '1px solid #e6eaf0',
      boxShadow: isShort ? '0 0 0 3px rgba(252,129,129,0.18), 0 8px 20px ' + brand.color + '22' : '0 6px 16px ' + brand.color + '1f, 0 1px 3px rgba(16,24,40,0.08)',
    }}>
      {/* Bank-card style header */}
      <div style={{ cursor:'pointer', position:'relative', background: headerGrad, color:'#fff', overflow:'hidden' }} onClick={() => setExpanded(e => !e)}>
        {/* decorative sheen circles */}
        <div style={{ position:'absolute', top:-46, right:-26, width:150, height:150, borderRadius:'50%', background:'rgba(255,255,255,0.10)' }} />
        <div style={{ position:'absolute', bottom:-60, right:46, width:120, height:120, borderRadius:'50%', background:'rgba(255,255,255,0.06)' }} />
        <div style={{ position:'relative', padding:'14px 16px', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <HpBankLogo name={acct.bankName} />
              <span style={{ fontWeight:800, fontSize:16, letterSpacing:0.5, textShadow:'0 1px 2px rgba(0,0,0,0.18)' }}>{brand.label}</span>
              {isShort && <span style={{ fontSize:10, fontWeight:800, background:'#fff', color:'#dc2626', borderRadius:5, padding:'2px 7px', whiteSpace:'nowrap', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }}>⚠ ไม่พอในช่วง “{periodLabel}”</span>}
            </div>
            <div title={acct.accountNo} style={{ fontFamily:'ui-monospace', fontWeight:800, fontSize:24, letterSpacing:2, marginTop:8, color:'#fff', textShadow:'0 1px 4px rgba(0,0,0,0.30)' }}>
              <span style={{ opacity:0.5, fontSize:16 }}>••••</span> {last4 || '—'}
            </div>
            {(acct.accountName || acct.note || acct.type) && (
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.78)', marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:175 }}>
                {acct.accountName || acct.note || acct.type}
              </div>
            )}
          </div>
          <div style={{ textAlign:'right', whiteSpace:'nowrap' }}>
            <div style={{ fontSize:9.5, color:'rgba(255,255,255,0.8)', textTransform:'uppercase', letterSpacing:0.6 }}>ยอดใช้ได้จริง</div>
            <div style={{ fontWeight:800, fontSize:20, color:'#fff', fontVariantNumeric:'tabular-nums', textShadow:'0 1px 3px rgba(0,0,0,0.18)' }}>{fmtMoney(base)}</div>
          </div>
          <button data-no-capture="1" onClick={handleSaveImage} disabled={saving}
            title="บันทึกการ์ดนี้เป็นรูป (PNG)"
            style={{ position:'absolute', bottom:10, right:12, display:'flex', alignItems:'center', gap:5,
                     background:'rgba(255,255,255,0.20)', color:'#fff', border:'1px solid rgba(255,255,255,0.4)',
                     borderRadius:8, padding:'4px 10px', fontSize:11, fontWeight:700, cursor: saving ? 'wait' : 'pointer',
                     fontFamily:'inherit', whiteSpace:'nowrap' }}>
            {saving ? '⏳ กำลังบันทึก…' : '📷 บันทึกรูป'}
          </button>
        </div>
      </div>

      {/* Alert strip */}
      {(dueToday.length > 0 || overdue.length > 0 || showNear) && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #f0f4f8' }}>
          {dueToday.length > 0 && (
            <span style={{ background:'#fee2e2', color:'#991b1b', fontSize:11, fontWeight:700, borderRadius:6, padding:'3px 9px' }}>
              📅 ครบกำหนดวันนี้ {dueToday.length} รายการ · {fmtMoney(dueTodayOut)}
            </span>
          )}
          {showNear && (
            <span style={{ background:'#fef3c7', color:'#92400e', fontSize:11, fontWeight:700, borderRadius:6, padding:'3px 9px' }}>
              📆 ภายใน 7 วัน {near.length} รายการ
            </span>
          )}
          {overdue.length > 0 && (
            <span onClick={(e) => { e.stopPropagation(); setShowOverdue(true); }}
              title="กดดู / ไปแก้ไขเช็คที่ยังไม่ขึ้นเงิน"
              style={{ background:'#fae8ff', color:'#86198f', fontSize:11, fontWeight:700, borderRadius:6, padding:'3px 9px', cursor:'pointer' }}>
              ⏰ เลยกำหนดยังไม่เคลียร์ {overdue.length} ฉบับ ›
            </span>
          )}
        </div>
      )}

      {showOverdue && (
        <BDOverdueChecksModal acctLabel={brand.label + ' •••• ' + last4} checks={overdue} canEdit={canEdit} onSetStatus={onCheckStatus} onClose={() => setShowOverdue(false)} />
      )}

      {/* Body */}
      {expanded && (
        <div>
          {/* Summary — สรุปตามช่วงที่กำลังดู */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 14px', fontSize:12, color:'#475569', borderBottom:'1px solid #f0f4f8' }}>
            <span>{showAll ? 'ทั้งหมด' : '“' + periodLabel + '”'} <b>{visCount}</b> รายการ</span>
            <span>
              {visIn > 0 && <span style={{ color:'#276749', marginRight:8 }}>รับ +{fmtMoney(visIn)}</span>}
              <span style={{ color:'#c53030' }}>จ่าย −{fmtMoney(visOut)}</span>
            </span>
          </div>

          {/* Day groups (default = ตามช่วงเวลาที่เลือก) */}
          {dayGroups.length === 0 ? (
            <div style={{ textAlign:'center', color:'#a0aec0', fontSize:12, padding:'14px 0' }}>ไม่มีรายการในบัญชีนี้</div>
          ) : visibleGroups.length === 0 ? (
            <div style={{ textAlign:'center', color:'#a0aec0', fontSize:12, padding:'12px 0' }}>ไม่มีรายการในช่วง “{periodLabel}”</div>
          ) : (
            visibleGroups.map(day => <BDDayGroup key={day.date} day={day} today={today} onItemEdit={onItemEdit} />)
          )}
          {(hiddenCount > 0 || (showAll && dayGroups.length > 0)) && (
            <button onClick={() => setShowAll(s => !s)}
              style={{ width:'100%', background:'#f8fafc', border:'none', borderBottom:'1px solid #f0f4f8', padding:'7px 14px', fontSize:11, fontWeight:600, color:'#2e8b4a', cursor:'pointer', fontFamily:'inherit' }}>
              {showAll ? `▴ ย่อ (เฉพาะช่วง “${periodLabel}”)` : `▾ ดูทั้งหมด (อีก ${hiddenCount} วัน)`}
            </button>
          )}

          {/* Footer — ยอดเงินคงเหลือสุทธิ ตามรายการที่เปิดดู (ยอดใช้ได้ + รับ − จ่าย ในช่วง) · จุดสิ้นสุดของรูปที่เซฟ */}
          <div data-capture-end="1" style={{
            display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 14px',
            background: netEnding < 0 ? '#fff5f5' : '#f0fdf4',
            borderTop:'2px solid ' + (netEnding < 0 ? '#fc8181' : '#68d391'),
            fontWeight:700, fontSize:13,
          }}>
            <span>ยอดเงินคงเหลือสุทธิ{showAll ? ' (ทั้งหมด)' : ' (ช่วง “' + periodLabel + '”)'}</span>
            <span style={{ color: netEnding < 0 ? '#e53e3e' : '#276749' }}>{fmtMoney(netEnding)}</span>
          </div>

          {/* Quick transfer when short (7 วัน หรือ ติดลบในช่วง) */}
          {isShort && canEdit && (
            <div style={{ padding:'10px 14px', background:'#fff5f5', borderTop:'1px dashed #fecaca', display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:11, color:'#b91c1c' }}>ต้องเติมเงินอีกประมาณ <b>{fmtMoney(coverAmt)}</b> ก่อนรายการครบกำหนด</span>
              <button onClick={() => onQuickTransfer(acct.accountNo)}
                style={{ background:'linear-gradient(135deg,#2e8b4a,#1a592f)', color:'#fff', border:'none', borderRadius:7, padding:'6px 12px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                ⇄ โอนเข้าบัญชีนี้
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Forecast Modal — เพิ่ม/แก้ไขรายการประมาณการ ────────────────────── */
function ForecastModal({ bankAccounts, today, initial, prefill, onSave, onClose, onDelete, canDelete }) {
  const isEdit = !!(initial && initial.id);
  const raw    = (initial && initial.raw) || {};
  const pf     = prefill || {};
  const [form, setForm] = React.useState({
    payDate:     (initial && (initial.payDate || initial.date)) || pf.payDate || today,
    dir:         (initial && initial.amount != null) ? (initial.amount < 0 ? 'out' : 'in') : (pf.dir || 'out'),
    amount:      (initial && initial.planAmount != null) ? String(Math.abs(initial.planAmount)) : (pf.amount != null ? String(pf.amount) : ''),
    description: (initial && initial.desc) || pf.desc || '',
    bankAc:      (initial && initial.bankAc) || pf.bankAc || '',
    category:    (initial && initial.category) || pf.category || '',
    note:        (raw.NOTE || '') || pf.note || '',
  });
  const [err, setErr] = React.useState('');
  const setF = (k, v) => { setErr(''); setForm(prev => ({ ...prev, [k]: v })); };

  const handleSave = () => {
    const amt = parseFloat(form.amount);
    if (!form.payDate)            return setErr('กรุณาเลือกวันที่');
    if (!amt || amt <= 0)         return setErr('กรุณาระบุจำนวนเงินที่ถูกต้อง');
    if (!form.description.trim()) return setErr('กรุณาระบุรายละเอียด');
    const signed = (form.dir === 'out' ? -1 : 1) * Math.abs(amt);
    if (isEdit) {
      // คงค่าฟิลด์เดิมทั้งหมด (เช่น ACTUAL_*) แล้วทับเฉพาะที่แก้
      onSave(Object.assign({}, raw, {
        id: initial.id, PAYMENT_DATE: form.payDate, AMOUNT: String(signed),
        DESCRIPTION: form.description.trim(), Bank_AC: form.bankAc || null, CATEGORY: form.category || null, NOTE: form.note.trim() || null,
      }), true);
    } else {
      const id = (window.WTPData && WTPData.newId) ? WTPData.newId() : ('fe-' + Date.now());
      onSave({
        id, DATE: today, PAYMENT_DATE: form.payDate, EXPENSE_TYPE: pf.expType || 'Manual',
        DESCRIPTION: form.description.trim(), JOB_NO: null, PROJECT_NAME: null,
        AMOUNT: String(signed), Bank_AC: form.bankAc || null, STATUS: 'PLANNED',
        CATEGORY: form.category || null, IS_ACCRUED: null, NOTE: form.note.trim() || null,
        ACTUAL_AMOUNT: null, ACTUAL_DATE: null, REF_DOC: pf.refDoc || null, BOOKED_AT: null, CFS_ACTIVITY: null,
      }, false);
    }
  };

  const inp = { width:'100%', padding:'8px 11px', boxSizing:'border-box', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, fontFamily:'inherit', outline:'none' };
  const lbl = { fontSize:12, fontWeight:600, color:'#475569', marginBottom:4, display:'block' };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:480, maxHeight:'calc(100vh - 32px)', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,0.18)', overflow:'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink:0, padding:'16px 20px', background:'linear-gradient(135deg,#eef2ff,#e0e7ff)', borderBottom:'1px solid #c7d2fe', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontWeight:700, fontSize:15, color:'#3730a3' }}>{isEdit ? '✏️ แก้ไขรายการประมาณการ' : '➕ เพิ่มรายการประมาณการ'}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'#6366f1', lineHeight:1, padding:'0 4px' }}>✕</button>
        </div>
        <div style={{ padding:20, overflowY:'auto', flex:1, minHeight:0 }}>
          {isEdit && initial.isActual && (
            <div style={{ marginBottom:12, padding:'8px 12px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:7, fontSize:11, color:'#166534' }}>
              ✓ รายการนี้ตัด PV/จ่ายจริงแล้ว (ยอดจริง {fmtMoney(Math.abs(initial.amount))}) — แก้ที่นี่จะแก้เฉพาะ “ค่าประมาณการ”
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 14px' }}>
            <div>
              <label style={lbl}>ประเภท *</label>
              <div style={{ display:'flex', gap:8 }}>
                {[{ k:'out', t:'จ่าย', c:'#c53030' }, { k:'in', t:'รับ', c:'#276749' }].map(o => (
                  <button key={o.k} onClick={() => setF('dir', o.k)}
                    style={{ flex:1, padding:'8px 0', borderRadius:8, border:'1.5px solid ' + (form.dir===o.k ? o.c : '#e2e8f0'),
                             background: form.dir===o.k ? o.c : '#fff', color: form.dir===o.k ? '#fff' : '#475569',
                             fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                    {o.t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={lbl}>วันที่คาดเงินเคลื่อน *</label>
              <input type="date" style={inp} value={form.payDate} onChange={e => setF('payDate', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>จำนวนเงิน (บาท) *</label>
              <input type="number" style={inp} value={form.amount} min="0" step="0.01" placeholder="0.00" onChange={e => setF('amount', e.target.value)} />
            </div>
            <div>
              <label style={{ ...lbl, color:'#4338ca' }}>บัญชี (Bank_AC)</label>
              <select style={{ ...inp, background:'#fff', borderColor:'#c7d2fe' }} value={form.bankAc} onChange={e => setF('bankAc', e.target.value)}>
                <option value="">— ไม่ระบุ (รวมบริษัท) —</option>
                {bankAccounts.map((a, i) => <option key={i} value={a.accountNo}>{a.bankName} — {a.accountNo}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label style={lbl}>ประเภท (หมวด Cash Flow)</label>
              <select style={{ ...inp, background:'#fff' }} value={form.category} onChange={e => setF('category', e.target.value)}>
                <option value="">— ไม่ระบุ —</option>
                {BD_CF_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.code}. {c.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label style={lbl}>รายละเอียด *</label>
              <input type="text" style={inp} value={form.description} placeholder="เช่น คาดรับเงินงวด / จ่ายเงินเดือน" onChange={e => setF('description', e.target.value)} />
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label style={lbl}>หมายเหตุ</label>
              <input type="text" style={inp} value={form.note} onChange={e => setF('note', e.target.value)} />
            </div>
          </div>
          {err ? <div style={{ marginTop:10, padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:7, fontSize:12, color:'#dc2626' }}>⚠ {err}</div> : null}
          <div style={{ marginTop:18, display:'flex', gap:10, justifyContent: isEdit && onDelete && canDelete ? 'space-between' : 'flex-end', alignItems:'center' }}>
            {isEdit && onDelete && canDelete && (
              <button onClick={() => onDelete(initial.id)} style={{ padding:'8px 14px', borderRadius:8, border:'1.5px solid #fecaca', background:'#fff', color:'#dc2626', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>ลบรายการ</button>
            )}
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={onClose} style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>ยกเลิก</button>
              <button onClick={handleSave} style={{ padding:'8px 20px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#6366f1,#4338ca)', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', boxShadow:'0 4px 12px rgba(99,102,241,0.3)' }}>บันทึก</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Forecast Panel — ประมาณการกระแสเงินสด (รวมทุกบัญชี) ───────────── */
/* แถวประมาณการเดี่ยว (ใช้ทั้งแบบเดี่ยว และเป็นรายย่อยใต้กลุ่ม) */
function BDForecastRow({ r, canEdit, onEdit, sub }) {
  return (
    <tr onClick={canEdit ? () => onEdit(r) : undefined}
        style={{ cursor: canEdit ? 'pointer' : 'default', background: sub ? '#fcfdff' : undefined }}
        title={canEdit ? 'กดเพื่อแก้ไข / เปลี่ยนบัญชี' : undefined}>
      <td style={{ whiteSpace:'nowrap', color: sub ? '#cbd5e1' : undefined }}>{sub ? '↳' : fmtDate(r.date)}</td>
      <td style={{ paddingLeft: sub ? 22 : undefined }}>
        {sub && r.refDoc ? <span style={{ fontFamily:'ui-monospace', fontSize:11, color:'#6366f1', marginRight:6 }}>{r.refDoc}</span> : null}
        {r.desc}
        {r.isActual && r.actualAmount != null && r.actualAmount !== Math.abs(r.planAmount) && (
          <span style={{ marginLeft:6, fontSize:10, color:'#94a3b8' }}>(ประมาณการ {fmtMoney(Math.abs(r.planAmount))})</span>
        )}
        {r.remark ? <div style={{ fontSize:10, color:'#64748b', marginTop:1 }}>📝 {r.remark}</div> : null}
      </td>
      <td style={{ fontFamily:'ui-monospace', fontSize:11, color: r.bankAc ? '#64748b' : '#cbd5e1' }}>{r.bankAc || 'ไม่ระบุ'}</td>
      <td>
        {r.isActual
          ? <span style={{ background:'#c6f6d5', color:'#276749', fontSize:11, fontWeight:600, borderRadius:12, padding:'2px 9px' }}>✓ จ่าย/รับจริง</span>
          : <span style={{ background:'#e9d8fd', color:'#6b21a8', fontSize:11, fontWeight:600, borderRadius:12, padding:'2px 9px' }}>ประมาณการ</span>
        }
      </td>
      <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:700, color: r.amount >= 0 ? '#276749' : '#c53030', whiteSpace:'nowrap' }}>
        {r.amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(r.amount))}
      </td>
      {canEdit && (
        <td style={{ textAlign:'center', color:'#6366f1' }}><span style={{ fontSize:14 }}>✏️</span></td>
      )}
    </tr>
  );
}

/* กลุ่มประมาณการ "ชื่อเดียวกัน + วันเดียวกัน" — ย่อ=ยอดรวม · กดกางดูรายย่อย (เลขที่ AP + remark) */
function BDForecastGroupRow({ group, canEdit, onEdit }) {
  const [open, setOpen] = React.useState(false);
  const total = group.items.reduce((s, r) => s + r.amount, 0);
  const allActual = group.items.every(r => r.isActual);
  const anyActual = group.items.some(r => r.isActual);
  return (
    <React.Fragment>
      <tr onClick={() => setOpen(o => !o)} style={{ cursor:'pointer', background:'#f5f7ff' }} title="กดดูรายการย่อย">
        <td style={{ whiteSpace:'nowrap', fontWeight:600 }}>{fmtDate(group.date)}</td>
        <td>
          <span style={{ fontSize:10, color:'#6366f1', display:'inline-block', width:12, transform: open ? 'rotate(90deg)' : 'none', transition:'transform .15s' }}>▶</span>
          <b>{group.name}</b> <span style={{ fontSize:11, color:'#94a3b8' }}>· {group.items.length} ใบ</span>
        </td>
        <td style={{ fontFamily:'ui-monospace', fontSize:11, color: group.bankAc ? '#64748b' : '#cbd5e1' }}>{group.bankAc || 'ไม่ระบุ'}</td>
        <td>
          {allActual
            ? <span style={{ background:'#c6f6d5', color:'#276749', fontSize:11, fontWeight:600, borderRadius:12, padding:'2px 9px' }}>✓ จ่าย/รับจริง</span>
            : anyActual
              ? <span style={{ background:'#fef3c7', color:'#92400e', fontSize:11, fontWeight:600, borderRadius:12, padding:'2px 9px' }}>บางส่วนจ่ายแล้ว</span>
              : <span style={{ background:'#e9d8fd', color:'#6b21a8', fontSize:11, fontWeight:600, borderRadius:12, padding:'2px 9px' }}>ประมาณการ</span>}
        </td>
        <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:700, color: total >= 0 ? '#276749' : '#c53030', whiteSpace:'nowrap' }}>
          {total >= 0 ? '+' : '−'}{fmtMoney(Math.abs(total))}
        </td>
        {canEdit && <td style={{ textAlign:'center', color:'#94a3b8', fontSize:11 }}>{open ? '▴' : '▾'}</td>}
      </tr>
      {open && group.items.map((r, i) => <BDForecastRow key={r.id || i} r={r} canEdit={canEdit} onEdit={onEdit} sub />)}
    </React.Fragment>
  );
}

function BDForecastPanel({ forecasts, periodEnd, periodLabel, today, totalRealBalance, onAdd, onEdit, canEdit, paidApSet }) {
  const [collapsed, setCollapsed] = React.useState(true);   // ย่อไว้ก่อน — กดหัวการ์ดเพื่อกาง
  const rows = React.useMemo(
    // ตัด AP ที่จ่ายจริงผ่าน PV แล้ว (refDoc ∈ paidApSet) — เหมือนการ์ดบัญชี ไม่ให้แผนเก่าค้าง
    () => forecasts.filter(f => f.date && f.date >= today && f.date <= periodEnd
                            && !(paidApSet && f.refDoc && paidApSet.has(String(f.refDoc).trim())))
                   .sort((a, b) => a.date < b.date ? -1 : 1),
    [forecasts, periodEnd, today, paidApSet]
  );
  // จัดกลุ่ม "ชื่อเดียวกัน + วันเดียวกัน" (ตัด " (เลขที่ AP)" ท้าย desc) เพื่อย่อรายการยาวๆ
  const groupedRows = React.useMemo(() => {
    const order = [], map = {};
    rows.forEach(r => {
      const name = (r.desc || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || (r.desc || '');
      const key = r.date + '|' + name;
      if (!map[key]) { map[key] = { key, name, date: r.date, bankAc: r.bankAc, items: [] }; order.push(map[key]); }
      map[key].items.push(r);
    });
    return order;
  }, [rows]);
  const inflow  = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const outflow = rows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const net     = inflow - outflow;
  const projected = totalRealBalance + net;

  return (
    <div className="card" style={{ padding:0, overflow:'hidden', marginBottom:20 }}>
      {/* Header — กดเพื่อย่อ/กาง */}
      <div onClick={() => setCollapsed(c => !c)}
        style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, padding:'12px 16px', background:'linear-gradient(135deg,#eef2ff,#e0e7ff)', borderBottom: collapsed ? 'none' : '1px solid #c7d2fe', cursor:'pointer' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          <span style={{ fontSize:12, color:'#4f46e5', transform: collapsed ? 'none' : 'rotate(90deg)', transition:'transform .15s' }}>▶</span>
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:'#3730a3' }}>📊 ประมาณการกระแสเงินสด</div>
            <div style={{ fontSize:12, color:'#4f46e5', marginTop:2 }}>
              ช่วง “{periodLabel}” · {rows.length} รายการ
              {rows.length > 0 && <> · คาดจ่าย <b style={{ color:'#c53030' }}>{fmtMoney(outflow)}</b> · คาดรับ <b style={{ color:'#276749' }}>{fmtMoney(inflow)}</b></>}
            </div>
          </div>
        </div>
        <span style={{ fontSize:11, fontWeight:600, color:'#4f46e5', whiteSpace:'nowrap' }}>{collapsed ? 'กดเพื่อดู ▾' : 'ย่อ ▴'}</span>
      </div>

      {!collapsed && (<>
      {/* Toolbar */}
      {canEdit && (
        <div style={{ display:'flex', justifyContent:'flex-end', padding:'8px 12px', borderBottom:'1px solid #eef0f6' }}>
          <button onClick={onAdd} style={{ background:'#4338ca', color:'#fff', border:'none', borderRadius:8, padding:'7px 14px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:6 }}>
            ➕ เพิ่มประมาณการ
          </button>
        </div>
      )}

      {/* Summary tiles */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:1, background:'#eef0f6' }}>
        {[
          { l:'เงินจริงตอนนี้', v:totalRealBalance, c:'#1a592f' },
          { l:'คาดรับ (ช่วงนี้)', v:inflow, c:'#276749' },
          { l:'คาดจ่าย (ช่วงนี้)', v:-outflow, c:'#c53030' },
          { l:'เงินสดคาดการณ์สิ้นช่วง', v:projected, c: projected < 0 ? '#dc2626' : '#1a592f', bold:true },
        ].map((t, i) => (
          <div key={i} style={{ background:'#fff', padding:'10px 14px' }}>
            <div style={{ fontSize:11, color:'#718096' }}>{t.l}</div>
            <div style={{ fontSize: t.bold ? 16 : 14, fontWeight:700, color:t.c, fontVariantNumeric:'tabular-nums' }}>{fmtMoney(t.v)}</div>
          </div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ overflowX:'auto' }}>
        <table className="tbl" style={{ minWidth:720, fontSize:12 }}>
          <thead>
            <tr>
              <th style={{ width:90 }}>วันที่</th>
              <th>รายการ</th>
              <th style={{ width:120 }}>บัญชี</th>
              <th style={{ width:110 }}>สถานะ</th>
              <th style={{ textAlign:'right', width:130 }}>จำนวนเงิน</th>
              {canEdit && <th style={{ width:44 }}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={canEdit ? 6 : 5} style={{ textAlign:'center', color:'#a0aec0', padding:'16px 0' }}>ไม่มีรายการประมาณการในช่วงนี้</td></tr>
            ) : groupedRows.map(g => (
              g.items.length > 1
                ? <BDForecastGroupRow key={g.key} group={g} canEdit={canEdit} onEdit={onEdit} />
                : <BDForecastRow key={g.key} r={g.items[0]} canEdit={canEdit} onEdit={onEdit} />
            ))}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  );
}

/* ── AP Panel — เจ้าหนี้คงค้างให้เลือกจ่าย (เดี่ยว/หลายรายการ → สร้างประมาณการ) ── */
function BDApPanel({ apList, plannedRefs, plannedDateByRef, bankAccounts, defaultBank, today, periodEnd, periodLabel, onPlan, onBulkApply, onBulkReschedule, onBulkUnplan, onEditPlanned, onSetCategory, canEdit }) {
  const [collapsed, setCollapsed] = React.useState(true);        // ย่อไว้ก่อน — กดหัวการ์ดเพื่อกาง
  const [query, setQuery]     = React.useState('');
  const [showAll, setShowAll] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState('all'); // all | unplanned | planned
  const [sortKey, setSortKey] = React.useState('due');   // due | vendor | vchno | cfCategory | amount | remark
  const [sortDir, setSortDir] = React.useState('asc');
  const [colFilters, setColFilters] = React.useState({});  // { colKey: Set<displayVal> } — filter รายคอลัมน์
  const [openCol, setOpenCol]       = React.useState(null);
  const AP_COL_LABELS = { due:'ครบกำหนด', vendor:'ผู้ขาย', vchno:'เลขที่ (AP)', cfCategory:'ประเภท (CF)', amount:'ยอดสุทธิ', remark:'REMARK' };
  const [dueFrom, setDueFrom] = React.useState('');      // filter ครบกำหนด ตั้งแต่
  const [dueTo, setDueTo]     = React.useState('');      // ถึง
  const [selected, setSelected] = React.useState(() => new Set());
  // bulk options
  const [bulkDate, setBulkDate] = React.useState(today);
  const [bulkCat, setBulkCat]   = React.useState('');
  const [bulkBank, setBulkBank] = React.useState(defaultBank || '');
  const LIMIT = 25;

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'amount' ? 'desc' : 'asc'); }
  };
  const arrow = (k) => sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  // ค่าที่ใช้แสดง/จับคู่ filter รายคอลัมน์ (ต้องเป็น (row, key) ตาม convention ColFilterDropdown)
  const apGetValue = (a, key) => {
    if (key === 'due')        return fmtDate(a.due) || '—';
    if (key === 'vendor')     return a.vendor || '—';
    if (key === 'vchno')      return a.vchno || '—';
    if (key === 'cfCategory') return a.cfCategory ? (a.cfCategory + '. ' + bdCatLabel(a.cfCategory)) : '—';
    if (key === 'amount')     return fmtMoney(a.amount);
    if (key === 'remark')     return a.remark || '—';
    return '';
  };
  // ค่าที่ใช้ "จัดเรียงใน dropdown กรอง" — วันที่ใช้ ISO (เรียงเดือน→วัน), ยอดใช้ตัวเลข (ไม่เรียงตาม string)
  const apGetSortValue = (a, key) => {
    if (key === 'due')    return a.due || '';   // 'YYYY-MM-DD' เรียงตามเวลาจริง
    if (key === 'amount') return a.amount;       // number เรียงตามค่า
    return apGetValue(a, key);
  };

  // base = หลัง search/สถานะ/ช่วงวันที่ (ก่อน filter รายคอลัมน์) — เป็น allRows ของ dropdown กรอง
  const baseRows = React.useMemo(() => {
    let r = apList.filter(a => a.amount > 0);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      r = r.filter(a => (a.vendor || '').toLowerCase().includes(q) || (a.vchno || '').toLowerCase().includes(q) || (a.remark || '').toLowerCase().includes(q));
    }
    if (dueFrom) r = r.filter(a => a.due && a.due >= dueFrom);
    if (dueTo)   r = r.filter(a => a.due && a.due <= dueTo);
    if (statusFilter === 'planned')   r = r.filter(a => plannedRefs.has(a.vchno));
    if (statusFilter === 'unplanned') r = r.filter(a => !plannedRefs.has(a.vchno));
    return r;
  }, [apList, query, dueFrom, dueTo, statusFilter, plannedRefs]);

  const rows = React.useMemo(() => {
    let r = baseRows;
    for (const key of Object.keys(colFilters)) {
      const vals = colFilters[key];
      if (vals && vals.size > 0) r = r.filter(a => vals.has(apGetValue(a, key)));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return r.slice().sort((a, b) => {
      let av, bv;
      if (sortKey === 'amount')          { av = a.amount; bv = b.amount; }
      else if (sortKey === 'vendor')     { av = a.vendor || ''; bv = b.vendor || ''; }
      else if (sortKey === 'vchno')      { av = a.vchno || ''; bv = b.vchno || ''; }
      else if (sortKey === 'cfCategory') { av = a.cfCategory || ''; bv = b.cfCategory || ''; }
      else if (sortKey === 'remark')     { av = a.remark || ''; bv = b.remark || ''; }
      else                               { av = a.due || ''; bv = b.due || ''; }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [baseRows, colFilters, sortKey, sortDir]);

  // สรุปรวมทั้งหมด (ไม่ขึ้นกับตัวกรอง) — โชว์บนหัวการ์ดตอนย่อ
  const apAll        = React.useMemo(() => apList.filter(a => a.amount > 0), [apList]);
  const apTotalAll   = apAll.reduce((s, a) => s + a.amount, 0);
  const plannedCount = apAll.filter(a => plannedRefs.has(a.vchno)).length;

  const totalAmt   = rows.reduce((s, a) => s + a.amount, 0);
  const overdue    = rows.filter(a => a.due && a.due < today);
  const overdueAmt = overdue.reduce((s, a) => s + a.amount, 0);
  const inPeriodAmt = rows.filter(a => a.due && a.due >= today && a.due <= periodEnd).reduce((s, a) => s + a.amount, 0);
  const visible = showAll ? rows : rows.slice(0, LIMIT);

  const isPlanned  = (a) => plannedRefs.has(a.vchno);
  const toggleOne  = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const visibleIds = visible.map(a => a.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const toggleAll  = () => setSelected(prev => {
    const n = new Set(prev);
    if (allChecked) visibleIds.forEach(id => n.delete(id));
    else            visibleIds.forEach(id => n.add(id));
    return n;
  });

  const selectedAps       = apList.filter(a => selected.has(a.id));
  const selectedPlanned   = selectedAps.filter(isPlanned);
  const selectedUnplanned = selectedAps.filter(a => !isPlanned(a));
  const selectedSum       = selectedAps.reduce((s, a) => s + a.amount, 0);
  const hasPlannedSel     = selectedPlanned.length > 0;

  const doBulk = () => {
    if (!selectedAps.length) return;
    // ยังไม่วางแผน → สร้างประมาณการใหม่ (พร้อมประเภท/บัญชี) ; วางแผนแล้ว → เลื่อนวันจ่าย
    if (selectedUnplanned.length) onBulkApply(selectedUnplanned, { payDate: bulkDate || today, category: bulkCat, bankAc: bulkBank });
    if (selectedPlanned.length)   onBulkReschedule(selectedPlanned, { payDate: bulkDate || today });
    setSelected(new Set());
  };
  const doUnplan = () => {
    if (!selectedPlanned.length) return;
    onBulkUnplan(selectedPlanned);
    setSelected(new Set());
  };

  const colCount = canEdit ? 8 : 7;

  return (
    <div className="card" style={{ padding:0, overflow:'hidden', marginBottom:20 }}>
      {/* Header — กดเพื่อย่อ/กาง */}
      <div onClick={() => setCollapsed(c => !c)}
        style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 16px', background:'linear-gradient(135deg,#fff7ed,#ffedd5)', borderBottom: collapsed ? 'none' : '1px solid #fed7aa', cursor:'pointer', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          <span style={{ fontSize:12, color:'#c2410c', transform: collapsed ? 'none' : 'rotate(90deg)', transition:'transform .15s' }}>▶</span>
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:'#9a3412' }}>📥 เจ้าหนี้ต้องจ่าย (AP)</div>
            <div style={{ fontSize:12, color:'#c2410c', marginTop:2 }}>
              {apAll.length} รายการ · ค้างรวม <b>{fmtMoney(apTotalAll)}</b>
              {plannedCount > 0 && <> · วางแผนแล้ว {plannedCount}</>}
            </div>
          </div>
        </div>
        <span style={{ fontSize:11, fontWeight:600, color:'#9a3412', whiteSpace:'nowrap' }}>{collapsed ? 'กดเพื่อดู ▾' : 'ย่อ ▴'}</span>
      </div>

      {!collapsed && (<>
      {/* Search + status filter */}
      <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:8, padding:'8px 16px', borderBottom:'1px solid #fef0e0', background:'#fffaf3' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหาผู้ขาย / เลขที่"
          style={{ padding:'6px 11px', border:'1.5px solid #fed7aa', borderRadius:8, fontSize:12, fontFamily:'inherit', outline:'none', minWidth:160 }} />
        <span style={{ fontSize:11, fontWeight:600, color:'#9a3412', marginLeft:4 }}>สถานะ:</span>
        {[{ k:'all', l:'ทั้งหมด' }, { k:'unplanned', l:'ยังไม่วางแผน' }, { k:'planned', l:'วางแผนแล้ว' }].map(s => (
          <button key={s.k} onClick={() => { setStatusFilter(s.k); setShowAll(false); }}
            style={{ padding:'4px 12px', borderRadius:14, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                     border:'1px solid ' + (statusFilter===s.k ? '#ea580c' : '#fed7aa'),
                     background: statusFilter===s.k ? '#ea580c' : '#fff',
                     color: statusFilter===s.k ? '#fff' : '#c2410c' }}>
            {s.l}
          </button>
        ))}
        <span style={{ fontSize:11, color:'#a0aec0', marginLeft:'auto' }}>{rows.length} รายการ</span>
      </div>

      {/* Due-date filter */}
      <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:8, padding:'8px 16px', borderBottom:'1px solid #fef0e0', background:'#fffaf3' }}>
        <span style={{ fontSize:11, fontWeight:600, color:'#9a3412' }}>กรองครบกำหนด:</span>
        <YmdPicker value={dueFrom} onChange={setDueFrom} size="sm" />
        <span style={{ fontSize:11, color:'#a0aec0' }}>ถึง</span>
        <YmdPicker value={dueTo} onChange={setDueTo} size="sm" />
        <button onClick={() => { setDueFrom(''); setDueTo(today); }} style={{ padding:'4px 10px', borderRadius:14, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', border:'1px solid #fed7aa', background:'#fff', color:'#c2410c' }}>เลยกำหนด</button>
        <button onClick={() => { setDueFrom(today); setDueTo(periodEnd); }} style={{ padding:'4px 10px', borderRadius:14, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', border:'1px solid #fed7aa', background:'#fff', color:'#c2410c' }}>ในช่วง “{periodLabel}”</button>
        {(dueFrom || dueTo) && <button onClick={() => { setDueFrom(''); setDueTo(''); }} style={{ padding:'4px 10px', borderRadius:14, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', border:'1px solid #e2e8f0', background:'#fff', color:'#64748b' }}>ล้างตัวกรอง</button>}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:1, background:'#f5ead9' }}>
        {[
          { l:'ค้าง (หลังกรอง)', v:totalAmt, c:'#9a3412', sub: rows.length + ' รายการ' },
          { l:'เลยกำหนด', v:overdueAmt, c:'#dc2626', sub: overdue.length + ' รายการ' },
          { l:'ครบกำหนดในช่วง “' + periodLabel + '”', v:inPeriodAmt, c:'#c2410c' },
        ].map((t, i) => (
          <div key={i} style={{ background:'#fff', padding:'10px 14px' }}>
            <div style={{ fontSize:11, color:'#718096' }}>{t.l}</div>
            <div style={{ fontSize:14, fontWeight:700, color:t.c, fontVariantNumeric:'tabular-nums' }}>{fmtMoney(t.v)}</div>
            {t.sub && <div style={{ fontSize:10, color:'#a0aec0' }}>{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* Bulk action bar */}
      {canEdit && selectedAps.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:8, padding:'10px 16px', background:'#fff7ed', borderBottom:'1px solid #fed7aa' }}>
          <span style={{ fontSize:12, fontWeight:700, color:'#9a3412' }}>
            เลือก {selectedAps.length} รายการ · รวม {fmtMoney(selectedSum)}
            {hasPlannedSel && selectedUnplanned.length > 0 && (
              <span style={{ fontWeight:400, color:'#c2410c' }}> (ใหม่ {selectedUnplanned.length} · วางแผนแล้ว {selectedPlanned.length})</span>
            )}
          </span>
          <span style={{ fontSize:11, color:'#9a3412' }}>{hasPlannedSel && !selectedUnplanned.length ? 'เลื่อนเป็นวันที่' : 'วันจ่าย'}</span>
          <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)}
            style={{ padding:'4px 8px', border:'1.5px solid #fdba74', borderRadius:6, fontSize:11, fontFamily:'inherit', outline:'none' }} />
          {/* ประเภท/บัญชี ใช้กับรายการที่ "ยังไม่วางแผน" เท่านั้น — ซ่อนเมื่อเลือกเฉพาะตัวที่วางแผนแล้ว */}
          {selectedUnplanned.length > 0 && (<>
            <select value={bulkCat} onChange={e => setBulkCat(e.target.value)}
              style={{ padding:'4px 8px', border:'1.5px solid #fdba74', borderRadius:6, fontSize:11, fontFamily:'inherit', background:'#fff', outline:'none' }}>
              <option value="">ประเภท: คงเดิมของแต่ละตัว</option>
              {BD_CF_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.code}. {c.label}</option>)}
            </select>
            <select value={bulkBank} onChange={e => setBulkBank(e.target.value)}
              style={{ padding:'4px 8px', border:'1.5px solid #fdba74', borderRadius:6, fontSize:11, fontFamily:'inherit', background:'#fff', outline:'none' }}>
              <option value="">บัญชี: ไม่ระบุ</option>
              {bankAccounts.map((a, i) => <option key={i} value={a.accountNo}>{a.bankName} — {a.accountNo}</option>)}
            </select>
          </>)}
          <button onClick={doBulk} style={{ background:'#ea580c', color:'#fff', border:'none', borderRadius:7, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
            {selectedUnplanned.length && selectedPlanned.length
              ? 'ตั้ง/เลื่อนวันจ่าย ' + selectedAps.length + ' รายการ'
              : selectedPlanned.length
                ? 'เลื่อนวันจ่าย ' + selectedPlanned.length + ' รายการ'
                : 'วางแผนจ่าย ' + selectedUnplanned.length + ' รายการ'}
          </button>
          {hasPlannedSel && (
            <button onClick={doUnplan} style={{ background:'#fff', color:'#b91c1c', border:'1.5px solid #fecaca', borderRadius:7, padding:'6px 12px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
              ยกเลิกแผน {selectedPlanned.length} รายการ
            </button>
          )}
          <button onClick={() => setSelected(new Set())} style={{ background:'none', border:'none', color:'#9a3412', fontSize:11, cursor:'pointer', fontFamily:'inherit', textDecoration:'underline' }}>ล้างที่เลือก</button>
        </div>
      )}

      {/* แถบ filter รายคอลัมน์ที่ใช้งานอยู่ — กดล้างได้ */}
      {Object.keys(colFilters).some(k => colFilters[k] && colFilters[k].size > 0) && (
        <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:8, padding:'7px 16px', borderBottom:'1px solid #fef0e0', background:'#fff7ed' }}>
          <span style={{ fontSize:11, fontWeight:600, color:'#9a3412' }}>กรองคอลัมน์:</span>
          {Object.keys(colFilters).filter(k => colFilters[k] && colFilters[k].size > 0).map(k => (
            <span key={k} style={{ display:'inline-flex', alignItems:'center', gap:5, background:'#fff', border:'1px solid #fed7aa', borderRadius:12, padding:'2px 4px 2px 9px', fontSize:11, color:'#c2410c' }}>
              {AP_COL_LABELS[k] || k} · {colFilters[k].size}
              <button onClick={() => setColFilters(p => { const n = { ...p }; delete n[k]; return n; })}
                style={{ border:'none', background:'none', color:'#9a3412', cursor:'pointer', fontSize:13, lineHeight:1, padding:'0 3px' }}>✕</button>
            </span>
          ))}
          <button onClick={() => setColFilters({})}
            style={{ marginLeft:'auto', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', border:'1px solid #e2e8f0', background:'#fff', color:'#64748b' }}>ล้างกรองคอลัมน์ทั้งหมด</button>
        </div>
      )}

      <div style={{ overflowX:'auto' }}>
        <table className="tbl" style={{ minWidth:880, fontSize:12, tableLayout:'fixed' }}>
          <thead>
            <tr>
              {canEdit && <th style={{ width:34, textAlign:'center' }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="เลือกทั้งหมดที่เห็น" /></th>}
              <FilterableColHeader label="ครบกำหนด"   sortKey="due"        colKey="due"        sort={{ key:sortKey, dir:sortDir }} sortToggle={toggleSort} align="center" width={96}  colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={baseRows} getValue={apGetValue} getSortValue={apGetSortValue} />
              <FilterableColHeader label="ผู้ขาย"      sortKey="vendor"     colKey="vendor"     sort={{ key:sortKey, dir:sortDir }} sortToggle={toggleSort} align="left"                colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={baseRows} getValue={apGetValue} getSortValue={apGetSortValue} />
              <FilterableColHeader label="เลขที่ (AP)" sortKey="vchno"      colKey="vchno"      sort={{ key:sortKey, dir:sortDir }} sortToggle={toggleSort} align="center" width={124} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={baseRows} getValue={apGetValue} getSortValue={apGetSortValue} />
              <FilterableColHeader label="ประเภท (CF)" sortKey="cfCategory" colKey="cfCategory" sort={{ key:sortKey, dir:sortDir }} sortToggle={toggleSort} align="center" width={150} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={baseRows} getValue={apGetValue} getSortValue={apGetSortValue} />
              <FilterableColHeader label="ยอดสุทธิ"    sortKey="amount"     colKey="amount"     sort={{ key:sortKey, dir:sortDir }} sortToggle={toggleSort} align="right"  width={116} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={baseRows} getValue={apGetValue} getSortValue={apGetSortValue} />
              <FilterableColHeader label="REMARK"      sortKey="remark"     colKey="remark"     sort={{ key:sortKey, dir:sortDir }} sortToggle={toggleSort} align="left"   width={150} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={baseRows} getValue={apGetValue} getSortValue={apGetSortValue} />
              <th style={{ width:112 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={colCount} style={{ textAlign:'center', color:'#a0aec0', padding:'16px 0' }}>ไม่มีรายการ</td></tr>
            ) : visible.map(a => {
              const od = a.due && a.due < today;
              const planned = plannedRefs.has(a.vchno);
              const checked = selected.has(a.id);
              return (
                <tr key={a.id} style={{ background: checked ? '#fff7ed' : planned ? '#f0fff4' : 'transparent' }}>
                  {canEdit && (
                    <td style={{ textAlign:'center' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleOne(a.id)} />
                    </td>
                  )}
                  <td style={{ whiteSpace:'nowrap', color: od ? '#dc2626' : '#4a5568' }}>
                    {fmtDate(a.due) || '—'}{od && <span style={{ display:'block', fontSize:9, fontWeight:700, color:'#dc2626' }}>เลยกำหนด</span>}
                  </td>
                  <td style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={a.vendor || ''}>{a.vendor}</td>
                  <td style={{ fontFamily:'ui-monospace', fontSize:11, color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={a.vchno || ''}>{a.vchno || '—'}</td>
                  <td>
                    {canEdit ? (
                      <select value={a.cfCategory} onChange={e => onSetCategory(a, e.target.value)}
                        title={bdCatLabel(a.cfCategory)}
                        style={{ width:'100%', maxWidth:165, padding:'4px 6px', border:'1.5px solid ' + (a.cfCategory ? '#fed7aa' : '#e2e8f0'), borderRadius:6, fontSize:11, fontFamily:'inherit', background:'#fff', outline:'none' }}>
                        <option value="">— เลือกประเภท —</option>
                        {BD_CF_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.code}. {c.label}</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize:11, color:'#64748b' }}>{a.cfCategory ? a.cfCategory + '. ' + bdCatLabel(a.cfCategory) : '—'}</span>
                    )}
                  </td>
                  <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:700, color:'#c53030', whiteSpace:'nowrap' }}>{fmtMoney(a.amount)}</td>
                  <td style={{ fontSize:11, color:'#64748b', maxWidth:170, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={a.remark || ''}>{a.remark || '—'}</td>
                  <td style={{ textAlign:'right', whiteSpace:'nowrap' }}>
                    {planned ? (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:6, justifyContent:'flex-end' }}>
                        <span style={{ display:'inline-flex', flexDirection:'column', alignItems:'flex-end', lineHeight:1.25 }}>
                          <span style={{ background:'#c6f6d5', color:'#276749', fontSize:11, fontWeight:600, borderRadius:12, padding:'2px 9px' }}>✓ วางแผนแล้ว</span>
                          {plannedDateByRef && plannedDateByRef[a.vchno] && (
                            <span style={{ fontSize:10.5, color:'#15803d', fontWeight:600, marginTop:2 }}>📅 จ่าย {fmtDate(plannedDateByRef[a.vchno])}</span>
                          )}
                        </span>
                        {canEdit && onEditPlanned && (
                          <button onClick={() => onEditPlanned(a)} title="แก้ไข / เลื่อนวันจ่าย"
                            style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, padding:'2px 4px', lineHeight:1 }}>✏️</button>
                        )}
                      </span>
                    ) : canEdit ? (
                      <button onClick={() => onPlan(a)} style={{ background:'#ea580c', color:'#fff', border:'none', borderRadius:6, padding:'4px 12px', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>วางแผนจ่าย</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > LIMIT && (
        <button onClick={() => setShowAll(s => !s)} style={{ width:'100%', background:'#fff7ed', border:'none', borderTop:'1px solid #fed7aa', padding:'8px 14px', fontSize:11, fontWeight:600, color:'#c2410c', cursor:'pointer', fontFamily:'inherit' }}>
          {showAll ? '▴ ย่อ' : `▾ ดูทั้งหมด (${rows.length} รายการ)`}
        </button>
      )}
      </>)}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────── */
const BankDiaryPage = ({ data: propData, setData, toast }) => {
  const raw = propData || WTPData.load();
  const { bankAccounts: rawAccounts = [], bankEntries = [], bankTransfers = [], checks: rawChecks = [], forecastEntries: rawForecast = [], payables: rawPayables = [], pvVouchers: rawPvVouchers = [] } = raw;
  const today = new Date().toISOString().slice(0, 10);
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [showAddTransfer, setShowAddTransfer] = React.useState(false);
  const [transferTo, setTransferTo]           = React.useState('');
  const [editTransfer, setEditTransfer]       = React.useState(null);
  const [showAddForecast, setShowAddForecast] = React.useState(false);
  const [editForecast, setEditForecast]       = React.useState(null);
  const [apPrefill, setApPrefill]             = React.useState(null);
  const [period, setPeriod]                   = React.useState('thisMonth');

  const periodEnd   = bdPeriodEnd(today, period);
  const periodLabel = (BD_PERIODS.find(p => p.key === period) || {}).label || '';

  const canEdit   = window.WTPAuth ? window.WTPAuth.can('canEdit')   : true;
  const canDelete = window.WTPAuth ? window.WTPAuth.can('canDelete') : true;

  /* Normalize accounts (รองรับชื่อ field จาก Sheet) */
  const accounts = React.useMemo(() => rawAccounts.map(bdAcct), [rawAccounts]);

  /* Normalize checks + attach status code */
  const checks = React.useMemo(
    () => rawChecks.map(c => ({ ...c, _st: bdCheckStatus(c.status) })),
    [rawChecks]
  );

  /* Match checks → accounts (เลขบัญชี รองรับเลข 4 ตัวท้าย) */
  const { checksByAccount, unmatchedOutstanding } = React.useMemo(() => {
    const byAcct = {};
    accounts.forEach(a => { byAcct[a.accountNo] = []; });
    const unmatched = [];
    checks.forEach(c => {
      const hit = accounts.find(a => bdAcctMatchesCheck(a.accountNo, c.accountNo));
      if (hit) byAcct[hit.accountNo].push(c);
      else if (bdIsOutstanding(c._st)) unmatched.push(c);
    });
    return { checksByAccount: byAcct, unmatchedOutstanding: unmatched };
  }, [accounts, checks]);

  /* Normalize forecast + match → accounts (ที่มี Bank_AC) */
  const forecasts = React.useMemo(() => rawForecast.map(bdNormForecast), [rawForecast]);
  // AP (เจ้าหนี้คงค้าง) + เซ็ตเลขที่ที่วางแผนจ่ายแล้ว (มี forecast อ้างถึง REF_DOC) กันวางซ้ำ
  const apList     = React.useMemo(() => rawPayables.map(bdNormAP), [rawPayables]);
  const plannedRefs = React.useMemo(() => new Set(forecasts.filter(f => f.refDoc).map(f => f.refDoc)), [forecasts]);
  // map เลขที่ AP (REF_DOC) → วันที่วางแผนจ่าย (PAYMENT_DATE ของ forecast ที่ผูกไว้)
  const plannedDateByRef = React.useMemo(() => {
    const m = {};
    forecasts.forEach(f => { if (f.refDoc) { const d = f.payDate || f.date; if (d && !m[f.refDoc]) m[f.refDoc] = d; } });
    return m;
  }, [forecasts]);
  // แนบ remark ให้ forecast (จาก AP ผ่าน refDoc → fallback NOTE ของ forecast เอง) เพื่อโชว์ในรายการ/กลุ่ม
  const apRemarkByRef = React.useMemo(() => {
    const m = {};
    apList.forEach(a => { if (a.vchno) m[String(a.vchno).trim()] = a.remark; });
    return m;
  }, [apList]);
  const forecastsRich = React.useMemo(
    () => forecasts.map(f => ({ ...f, remark: (f.refDoc && apRemarkByRef[String(f.refDoc).trim()]) || (f.raw && f.raw.NOTE) || '' })),
    [forecasts, apRemarkByRef]
  );
  const forecastByAccount = React.useMemo(() => {
    const byAcct = {};
    accounts.forEach(a => { byAcct[a.accountNo] = []; });
    forecastsRich.forEach(f => {
      if (!f.bankAc) return;
      const hit = accounts.find(a => bdAcctMatchesCheck(a.accountNo, f.bankAc));
      if (hit) byAcct[hit.accountNo].push(f);
    });
    return byAcct;
  }, [accounts, forecastsRich]);

  /* Normalize PV (bankTransfers) + match → accounts (ด้วย Bank_AC, รองรับเลข 4 ตัวท้าย) */
  const pvList = React.useMemo(() => rawPvVouchers.map(bdNormPV), [rawPvVouchers]);
  // เลขที่ AP ที่ "จ่ายจริงผ่าน PV แล้ว" (PV.AP_No) — ใช้ตัด forecast ที่กลายเป็นแผนเก่าค้าง
  //   global ทุกบัญชี (จับคู่ด้วยเลข AP ล้วน) ให้เหมือนหน้า Cash Flow แม้ AP วางแผนคนละบัญชีกับที่จ่าย
  const paidApSet = React.useMemo(() => {
    const s = new Set();
    pvList.forEach(p => { if (p.apNo) s.add(String(p.apNo).trim()); });
    return s;
  }, [pvList]);
  const pvByAccount = React.useMemo(() => {
    const byAcct = {};
    accounts.forEach(a => { byAcct[a.accountNo] = []; });
    pvList.forEach(p => {
      if (!p.bankAc) return;
      const hit = accounts.find(a => bdAcctMatchesCheck(a.accountNo, p.bankAc));
      if (hit) byAcct[hit.accountNo].push(p);
    });
    return byAcct;
  }, [accounts, pvList]);

  /* Pair up transfer entries by transferRef (จาก bankEntries ที่บันทึกโอนเอง) */
  const transferPairs = React.useMemo(() => {
    const pairs = {};
    bankEntries.forEach(e => {
      if (!e.transferRef) return;
      if (!pairs[e.transferRef]) pairs[e.transferRef] = [];
      pairs[e.transferRef].push(e);
    });
    return pairs;
  }, [bankEntries]);

  /* transferRef → ข้อมูลคู่โอน (ต้นทาง/ปลายทาง) — ใช้ตั้งป้าย "รับโอนจาก/โอนเงินไป" ตามทิศจริงในการ์ด */
  const transferInfoByRef = React.useMemo(() => {
    const m = {};
    Object.keys(transferPairs).forEach(ref => {
      const entries = transferPairs[ref] || [];
      const out = entries.find(e => e.entryType === 'outflow_transfer') || entries.find(e => bdNum(e.amount) < 0);
      const inn = entries.find(e => e.entryType === 'inflow_transfer')  || entries.find(e => bdNum(e.amount) > 0);
      const fromNo = (out && out.accountNo) || '';
      const toNo   = (inn && inn.accountNo) || '';
      const fromA = accounts.find(a => bdAcctMatchesCheck(a.accountNo, fromNo));
      const toA   = accounts.find(a => bdAcctMatchesCheck(a.accountNo, toNo));
      m[ref] = {
        fromNo, toNo,
        fromBank: (fromA && fromA.bankName) || (out && out.bankName) || '',
        toBank:   (toA && toA.bankName)     || (inn && inn.bankName) || '',
      };
    });
    return m;
  }, [transferPairs, accounts]);

  /* Group manual transfer entries → accounts (โผล่ในการ์ด BANK) */
  const transfersByAccount = React.useMemo(() => {
    const byAcct = {};
    accounts.forEach(a => { byAcct[a.accountNo] = []; });
    bankEntries.forEach(e => {
      if (e.entryType !== 'outflow_transfer' && e.entryType !== 'inflow_transfer') return;
      const hit = accounts.find(a => bdAcctMatchesCheck(a.accountNo, e.accountNo));
      if (hit) byAcct[hit.accountNo].push(e);
    });
    return byAcct;
  }, [accounts, bankEntries]);

  /* Per-account views (เช็ค + forecast + การโอน + สัญญาณเงินไม่พอ 7 วัน) */
  const accountViews = React.useMemo(
    () => accounts.map(a => bdBuildAccountView(a, checksByAccount[a.accountNo] || [], forecastByAccount[a.accountNo] || [], transfersByAccount[a.accountNo] || [], pvByAccount[a.accountNo] || [], today, next7, paidApSet, transferInfoByRef)),
    [accounts, checksByAccount, forecastByAccount, transfersByAccount, pvByAccount, today, next7, paidApSet, transferInfoByRef]
  );

  /* ── Totals across all accounts ── */
  const totalBalance     = accounts.reduce((s, a) => s + a.balance, 0);
  const totalAvailable   = accounts.reduce((s, a) => s + (a.available != null ? a.available : a.balance), 0);
  const shortAccounts    = accountViews.filter(v => {
    // อิงเฉพาะช่วงที่เลือกดู (ไม่ใช้กรอบ 7 วันตายตัว) ให้ตรงกับกรอบเตือนบนการ์ด
    const min = v.dayGroups.filter(g => g.date <= periodEnd).reduce((m, g) => Math.min(m, g.running), v.base);
    return min < 0;  // ยอดคงเหลือสะสมติดลบภายในช่วงที่เลือก
  }).length;
  // ยอดจ่ายรวมเฉพาะช่วงที่เลือก (KPI)
  const periodOut = accountViews.reduce(
    (s, v) => s + v.items.filter(i => i.signed < 0 && i.date <= periodEnd).reduce((a, i) => a - i.signed, 0),
    0
  );
  // ข้อมูลต่อบัญชีสำหรับจำลองการโอน (modal คำนวณภาระจ่ายตามช่วงของตัวเองได้)
  const acctData = React.useMemo(() => {
    const m = {};
    accountViews.forEach(v => {
      m[v.acct.accountNo] = { base: v.base, bankName: v.acct.bankName, items: v.items.map(i => ({ date: i.date, signed: i.signed, ref: i.ref || '' })) };
    });
    return m;
  }, [accountViews]);

  /* Add/Edit Transfer handler — สร้าง/แทนที่ 2 bankEntries (out+in) ของ transferRef เดียวกัน */
  const handleSaveTransfer = (newEntries, isEdit) => {
    if (setData) {
      setData(prev => {
        let list = prev.bankEntries || [];
        if (isEdit) { const ref = newEntries[0] && newEntries[0].transferRef; list = list.filter(e => e.transferRef !== ref); }
        return { ...prev, bankEntries: [...list, ...newEntries] };
      });
      if (toast) toast(isEdit ? 'แก้ไขการโอนแล้ว ✓' : 'บันทึกการโอนเงินเรียบร้อย');
    }
    setShowAddTransfer(false);
    setTransferTo('');
    setEditTransfer(null);
  };

  /* Delete a transfer (both legs) */
  const handleDeleteTransfer = (ref) => {
    if (!window.confirm('ลบรายการโอนนี้?')) return;
    if (setData) {
      setData(prev => ({ ...prev, bankEntries: (prev.bankEntries || []).filter(e => e.transferRef !== ref) }));
      if (toast) toast('ลบรายการโอนแล้ว');
    }
    setEditTransfer(null);
  };

  /* Reconcile handler — marks both legs of a pair as reconciled */
  const handleReconcile = (ref) => {
    if (!setData) return;
    setData(prev => ({
      ...prev,
      bankEntries: (prev.bankEntries || []).map(e =>
        e.transferRef === ref ? { ...e, reconciled: true } : e
      ),
    }));
    if (toast) toast(`Reconcile ${ref} เรียบร้อย ✓`);
  };

  const openQuickTransfer = (toAccountNo) => { setTransferTo(toAccountNo); setShowAddTransfer(true); };

  /* จิ้มรายการในการ์ด BANK → เปิดแก้ไขตามชนิด (ประมาณการ / โอน) */
  const handleItemEdit = (it) => {
    if (!canEdit || !it) return;
    if (it.kind === 'forecast') {
      setEditForecast(it.raw);  // it.raw = forecast ที่ normalize แล้ว
    } else if (it.kind === 'transfer') {
      const entries  = transferPairs[it.ref] || [];
      const outEntry = entries.find(e => e.entryType === 'outflow_transfer');
      const inEntry  = entries.find(e => e.entryType === 'inflow_transfer');
      setEditTransfer({
        fromAccountNo: (outEntry && outEntry.accountNo) || '',
        toAccountNo:   (inEntry && inEntry.accountNo) || '',
        amount: Math.abs(parseFloat((outEntry || inEntry || {}).amount) || 0),
        date: (outEntry || inEntry || {}).entryDate || today,
        ref: it.ref,
        // ★ ส่ง id เดิมของแต่ละขาไปให้ modal reuse ตอน save → อัปเดตในที่ กันรายการซ้ำ
        outId: (outEntry && outEntry.id) || '',
        inId:  (inEntry && inEntry.id) || '',
        note: (outEntry && outEntry.description) || (inEntry && inEntry.description) || '',
      });
    }
  };

  /* Add/Edit Forecast handler — append or replace by id */
  const handleSaveForecast = (row, isEdit) => {
    if (setData) {
      setData(prev => {
        const list = prev.forecastEntries || [];
        const next = isEdit ? list.map(e => (e.id === row.id ? row : e)) : [...list, row];
        return { ...prev, forecastEntries: next };
      });
      if (toast) toast(isEdit ? 'แก้ไขรายการประมาณการแล้ว ✓' : 'เพิ่มรายการประมาณการเรียบร้อย');
    }
    setShowAddForecast(false);
    setEditForecast(null);
    setApPrefill(null);
  };

  /* วางแผนจ่าย AP → เปิดฟอร์มประมาณการ (จ่าย) เติมค่าจาก AP, default บัญชี 4863 */
  const AP_DEFAULT_BANK = '1362684863';
  const openPlanAP = (ap) => {
    const hasDefault = accounts.some(a => a.accountNo === AP_DEFAULT_BANK);
    setEditForecast(null);
    setApPrefill({
      dir: 'out',
      amount: ap.amount,
      desc: 'จ่าย ' + ap.vendor + (ap.vchno ? ' (' + ap.vchno + ')' : ''),
      bankAc: hasDefault ? AP_DEFAULT_BANK : '',
      payDate: (ap.due && ap.due >= today) ? ap.due : today,
      refDoc: ap.vchno,
      expType: 'AP',
      category: ap.cfCategory || '',  // ติดหมวดเดียวกับ AP → ต่อไป forecast/cash flow
    });
    setShowAddForecast(true);
  };

  /* แก้รายการที่วางแผนแล้ว → เปิดฟอร์มประมาณการของ forecast ที่ผูกกับ AP นี้ (REF_DOC = vchno) */
  const openEditPlannedAP = (ap) => {
    const ref = String(ap.vchno || '').trim();
    const f = forecasts.find(x => x.refDoc && String(x.refDoc).trim() === ref);
    if (f) { setApPrefill(null); setEditForecast(f); }
    else if (toast) toast('ไม่พบรายการประมาณการที่ผูกกับ AP นี้');
  };

  /* วางแผนจ่าย AP หลายรายการพร้อมกัน → สร้าง forecast หลายแถว + ตั้งประเภท/บัญชี/วันเดียวกัน */
  const handleBulkPlanAP = (aps, opts) => {
    if (!setData || !aps.length) return;
    const payDate = opts.payDate || today;
    const cat     = opts.category || '';
    const bankAc  = opts.bankAc || '';
    const ts = Date.now();
    const newRows = aps.map((ap, i) => ({
      id: 'ap-' + ts + '-' + i, DATE: today, PAYMENT_DATE: payDate, EXPENSE_TYPE: 'AP',
      DESCRIPTION: 'จ่าย ' + ap.vendor + (ap.vchno ? ' (' + ap.vchno + ')' : ''), JOB_NO: null, PROJECT_NAME: null,
      AMOUNT: String(-Math.abs(ap.amount)), Bank_AC: bankAc || null, STATUS: 'PLANNED',
      CATEGORY: (cat || ap.cfCategory) || null, IS_ACCRUED: null, NOTE: null,
      ACTUAL_AMOUNT: null, ACTUAL_DATE: null, REF_DOC: ap.vchno || null, BOOKED_AT: null, CFS_ACTIVITY: null,
    }));
    setData(prev => {
      let pays = prev.payables || [];
      if (cat) { const ids = new Set(aps.map(a => a.id)); pays = pays.map(p => ids.has(p.id) ? { ...p, cf_category: cat } : p); }
      return { ...prev, forecastEntries: [...(prev.forecastEntries || []), ...newRows], payables: pays };
    });
    if (toast) toast('วางแผนจ่าย ' + aps.length + ' รายการแล้ว');
  };

  /* เลื่อนวันจ่ายหลายรายการที่ "วางแผนแล้ว" พร้อมกัน → อัปเดต PAYMENT_DATE ของ forecast ที่ผูก AP (REF_DOC)
   * อัปเดตในที่ (คง id เดิม) กันรายการซ้ำ + ข้ามรายการที่จ่ายจริงแล้ว (มี ACTUAL) */
  const handleBulkRescheduleAP = (aps, opts) => {
    if (!setData || !aps.length) return;
    const payDate = opts.payDate || today;
    const refs = new Set(aps.map(a => String(a.vchno || '').trim()).filter(Boolean));
    if (!refs.size) return;
    setData(prev => ({
      ...prev,
      forecastEntries: (prev.forecastEntries || []).map(f => {
        const ref = String(f.REF_DOC || '').trim();
        if (!ref || !refs.has(ref)) return f;
        const isActual = (f.ACTUAL_AMOUNT != null && f.ACTUAL_AMOUNT !== '') || f.STATUS === 'ACTUAL';
        if (isActual) return f;                       // จ่ายจริงแล้ว — ไม่เลื่อน
        return { ...f, PAYMENT_DATE: payDate };
      }),
    }));
    if (toast) toast('เลื่อนวันจ่าย ' + aps.length + ' รายการ → ' + fmtDate(payDate));
  };

  /* ยกเลิกแผนจ่ายหลายรายการ → ลบ forecast ที่ผูก AP (เฉพาะที่ยังเป็นแผน ไม่ลบที่จ่ายจริงแล้ว) */
  const handleBulkUnplanAP = (aps) => {
    if (!setData || !aps.length) return;
    const refs = new Set(aps.map(a => String(a.vchno || '').trim()).filter(Boolean));
    if (!refs.size) return;
    if (!window.confirm('ยกเลิกแผนจ่าย ' + aps.length + ' รายการ?\n(ลบรายการประมาณการที่ยังไม่จ่ายจริงซึ่งผูกกับ AP เหล่านี้)')) return;
    setData(prev => ({
      ...prev,
      forecastEntries: (prev.forecastEntries || []).filter(f => {
        const ref = String(f.REF_DOC || '').trim();
        if (!ref || !refs.has(ref)) return true;      // ไม่เกี่ยว — เก็บไว้
        const isActual = (f.ACTUAL_AMOUNT != null && f.ACTUAL_AMOUNT !== '') || f.STATUS === 'ACTUAL';
        return isActual;                              // จ่ายจริงแล้ว = เก็บ ; เป็นแผนล้วน = ลบ
      }),
    }));
    if (toast) toast('ยกเลิกแผนจ่าย ' + aps.length + ' รายการแล้ว');
  };

  /* เลือกประเภท (cf_category) ที่ AP → เขียนกลับ payables (push ขึ้น Sheet) */
  const handleSetApCategory = (ap, code) => {
    if (!setData) return;
    setData(prev => ({
      ...prev,
      payables: (prev.payables || []).map(p => p.id === ap.id ? { ...p, cf_category: code || null } : p),
    }));
    if (toast) toast(code ? ('ตั้งประเภท: ' + code + '. ' + bdCatLabel(code)) : 'ล้างประเภทแล้ว');
  };

  /* แก้สถานะเช็คจาก modal เช็คค้าง (มาร์ค "ขึ้นเงินแล้ว" / ยกเลิก) → เขียนกลับ data.checks (push ขึ้น Sheet) */
  const handleSetCheckStatus = (checkRaw, newStatus) => {
    if (!setData || !checkRaw) return;
    setData(prev => ({
      ...prev,
      checks: (prev.checks || []).map(ch => {
        const hit = checkRaw.id ? ch.id === checkRaw.id
                  : (ch.checkNo === checkRaw.checkNo && ch.checkDate === checkRaw.checkDate);
        return hit ? { ...ch, status: newStatus } : ch;
      }),
    }));
    if (toast) toast('เช็ค ' + (checkRaw.checkNo || '') + ' → ' + newStatus);
  };

  /* Delete a forecast row */
  const handleDeleteForecast = (id) => {
    if (!window.confirm('ลบรายการประมาณการนี้?')) return;
    if (setData) {
      setData(prev => ({ ...prev, forecastEntries: (prev.forecastEntries || []).filter(e => e.id !== id) }));
      if (toast) toast('ลบรายการประมาณการแล้ว');
    }
    setEditForecast(null);
  };

  /* Export rows — เช็คค้างจ่ายทุกบัญชี */
  const exportRows = React.useMemo(() => {
    const rows = [];
    accounts.forEach(a => {
      (checksByAccount[a.accountNo] || []).filter(c => bdIsOutstanding(c._st)).forEach(c => {
        rows.push({ bankName:a.bankName, accountNo:a.accountNo, checkDate:c.checkDate, payee:c.payee, checkNo:c.checkNo, amount:bdNum(c.amount), referenceNo:c.referenceNo, status:c.status });
      });
    });
    return rows.sort((x, y) => (x.checkDate || '') < (y.checkDate || '') ? -1 : 1);
  }, [accounts, checksByAccount]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Bank Daily</div>
          <div className="page-sub">ยอดเงินจริงแยกตามบัญชี + เช็ค/ประมาณการ เพื่อวางแผนกระแสเงินสดและโอนระหว่างบัญชี • ณ {fmtDate(today)}</div>
        </div>
        <div className="page-head-r">
        <ExportButton
          rows={exportRows}
          columns={[
            { key: 'bankName',   label: 'ธนาคาร' },
            { key: 'accountNo',  label: 'เลขที่บัญชี' },
            { key: 'checkDate',  label: 'วันที่ครบกำหนด', type: 'date' },
            { key: 'payee',      label: 'ผู้รับ' },
            { key: 'checkNo',    label: 'เลขที่เช็ค' },
            { key: 'amount',     label: 'จำนวนเงิน (฿)', type: 'number' },
            { key: 'referenceNo',label: 'อ้างอิง' },
            { key: 'status',     label: 'สถานะ' },
          ]}
          filename="bank_diary_outstanding"
          sheetName="Bank Daily"
          title="Bank Daily · เช็คค้างจ่ายแยกตามบัญชี"
        />
        <PrintButton />
        {canEdit && (
        <button
          className="btn-primary"
          onClick={() => { setTransferTo(''); setShowAddTransfer(true); }}
          style={{ display:'flex', alignItems:'center', gap:7 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          บันทึกการโอน
        </button>
        )}
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-4 anim-stagger" style={{ marginBottom:16 }}>
        <KpiTile label="ยอดเงินจริงรวม"      value={totalBalance}     accent="var(--brand-500)"                                  icon="bank"  animate={false} />
        <KpiTile label="ยอดเงินใช้ได้รวม"   value={totalAvailable}   accent="oklch(52% 0.16 185)"                               icon="coin"  animate={false} />
        <KpiTile label={`จ่ายในช่วง “${periodLabel}”`} value={periodOut} accent={periodOut > 0 ? 'oklch(60% 0.18 55)' : 'var(--good)'} icon="money" animate={false} />
        <KpiTile label="บัญชีเงินไม่พอ"      value={shortAccounts}    accent={shortAccounts > 0 ? 'var(--bad)' : 'var(--good)'}  unit=" บัญชี" digits={0} icon="arrow_up" animate={false} />
      </div>

      {/* Period selector — คุมทั้งเช็คในการ์ดและพาเนลประมาณการ */}
      <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:8, marginBottom:16 }}>
        <span style={{ fontSize:12, fontWeight:600, color:'#64748b' }}>ช่วงเวลา:</span>
        {BD_PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            style={{
              padding:'6px 13px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
              border:'1.5px solid ' + (period === p.key ? '#2e8b4a' : '#e2e8f0'),
              background: period === p.key ? '#2e8b4a' : '#fff',
              color: period === p.key ? '#fff' : '#475569',
            }}>
            {p.label}
          </button>
        ))}
        {period !== 'all' && (
          <span style={{ fontSize:11, color:'#94a3b8' }}>(ถึง {fmtDate(periodEnd)})</span>
        )}
      </div>

      {/* No accounts fallback */}
      {accounts.length === 0 && (
        <div className="card" style={{ padding:'28px 16px', textAlign:'center', color:'#94a3b8', marginBottom:20 }}>
          ยังไม่มีข้อมูลบัญชีธนาคาร — ตรวจสอบชีต <b>bankAccounts</b>
        </div>
      )}

      {/* Account Cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(360px, 1fr))', gap:14, marginBottom:20 }}>
        {accountViews.map(view => (
          <BankAccountCard
            key={view.acct.id || view.acct.accountNo}
            view={view}
            today={today}
            periodEnd={periodEnd}
            periodLabel={periodLabel}
            onQuickTransfer={openQuickTransfer}
            onItemEdit={canEdit ? handleItemEdit : null}
            onCheckStatus={canEdit ? handleSetCheckStatus : null}
            canEdit={canEdit}
          />
        ))}
      </div>

      {/* Forecast panel — ประมาณการกระแสเงินสด (รวมทุกบัญชี) */}
      <BDForecastPanel
        forecasts={forecastsRich}
        paidApSet={paidApSet}
        periodEnd={periodEnd}
        periodLabel={periodLabel}
        today={today}
        totalRealBalance={totalBalance}
        onAdd={() => { setEditForecast(null); setApPrefill(null); setShowAddForecast(true); }}
        onEdit={(r) => setEditForecast(r)}
        canEdit={canEdit}
      />

      {/* Reconcile Panel — โอนระหว่างบัญชี (ย่อไว้ใต้ประมาณการ · กดหัวการ์ดเพื่อกาง · sort ได้) */}
      <ReconcilePanel
        transferPairs={transferPairs}
        bankAccounts={accounts}
        onReconcile={handleReconcile}
        onEdit={(obj) => setEditTransfer(obj)}
        canEdit={canEdit}
      />

      {/* AP — เจ้าหนี้คงค้างให้เลือกจ่าย */}
      {apList.length > 0 && (
        <BDApPanel
          apList={apList}
          plannedRefs={plannedRefs}
          plannedDateByRef={plannedDateByRef}
          bankAccounts={accounts}
          defaultBank={AP_DEFAULT_BANK}
          today={today}
          periodEnd={periodEnd}
          periodLabel={periodLabel}
          onPlan={openPlanAP}
          onBulkApply={handleBulkPlanAP}
          onBulkReschedule={handleBulkRescheduleAP}
          onBulkUnplan={handleBulkUnplanAP}
          onEditPlanned={openEditPlannedAP}
          onSetCategory={handleSetApCategory}
          canEdit={canEdit}
        />
      )}

      {/* Unmatched outstanding checks (จับคู่บัญชีไม่ได้) */}
      {unmatchedOutstanding.length > 0 && (
        <div className="card" style={{ padding:0, overflow:'hidden', marginBottom:20 }}>
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--line)', background:'#fffbeb' }}>
            <div style={{ fontWeight:700, fontSize:13, color:'#92400e' }}>
              เช็คค้างจ่ายที่ยังจับคู่บัญชีไม่ได้
              <span style={{ marginLeft:8, fontSize:11, color:'#b45309', fontWeight:400 }}>
                {unmatchedOutstanding.length} ฉบับ · ตรวจสอบเลขบัญชีในชีต checks
              </span>
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl" style={{ minWidth:760, fontSize:12 }}>
              <thead>
                <tr>
                  <th style={{ width:90 }}>วันที่</th>
                  <th style={{ width:110 }}>เลขบัญชี</th>
                  <th>ผู้รับ</th>
                  <th style={{ width:100 }}>เลขที่เช็ค</th>
                  <th style={{ textAlign:'right', width:120 }}>จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {[...unmatchedOutstanding].sort((a, b) => (a.checkDate || '') < (b.checkDate || '') ? -1 : 1).map(c => (
                  <tr key={c.id}>
                    <td style={{ whiteSpace:'nowrap' }}>{fmtDate(c.checkDate) || '—'}</td>
                    <td style={{ fontFamily:'ui-monospace', fontSize:11 }}>{c.accountNo || '—'}</td>
                    <td>{c.payee || '—'}</td>
                    <td style={{ fontFamily:'ui-monospace', fontSize:11 }}>{c.checkNo || '—'}</td>
                    <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:600, color:'#c53030' }}>{fmtMoney(bdNum(c.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Historical bank transfers (from RAW_BANK_TRANSFER import) ── */}
      {bankTransfers.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', background: '#fafbfc' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink-700)' }}>
              ประวัติการโอนระหว่างบัญชี (จากระบบ)
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-400)', fontWeight: 400 }}>
                {bankTransfers.length} รายการ
              </span>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: 1100, fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>วันที่</th>
                  <th style={{ width: 110 }}>PV No.</th>
                  <th>ผู้รับ</th>
                  <th style={{ width: 100 }}>Document No.</th>
                  <th style={{ width: 90 }}>เลขที่เช็ค</th>
                  <th style={{ width: 130 }}>บัญชี (Bank_AC)</th>
                  <th style={{ textAlign: 'right', width: 120 }}>ยอดเงิน</th>
                  <th style={{ minWidth: 220 }}>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {[...bankTransfers]
                  .sort((a, b) => (b.paydate || '').localeCompare(a.paydate || ''))
                  .map(t => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.paydate) || '—'}</td>
                      <td style={{ fontFamily: 'ui-monospace', fontSize: 11 }}>{t.PL_PV_No || '—'}</td>
                      <td>{t.Payee || '—'}</td>
                      <td style={{ fontFamily: 'ui-monospace', fontSize: 11 }}>{t.Document_No || '—'}</td>
                      <td style={{ fontFamily: 'ui-monospace', fontSize: 11 }}>{t.Chq_No || '—'}</td>
                      <td style={{ fontFamily: 'ui-monospace', fontSize: 11 }}>{t.Bank_AC || '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                                   color: 'var(--brand-700)' }}>
                        {fmtMoney(t.Net_Amount)}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--ink-500)' }}>{t.remark || ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Transfer Modal */}
      {(showAddTransfer || editTransfer) && (
        <AddTransferModal
          bankAccounts={accounts}
          initialTo={transferTo}
          initial={editTransfer}
          onDelete={handleDeleteTransfer}
          canDelete={canDelete}
          acctData={acctData}
          initialPeriod={period}
          onSave={handleSaveTransfer}
          onClose={() => { setShowAddTransfer(false); setTransferTo(''); setEditTransfer(null); }}
        />
      )}

      {/* Add / Edit Forecast Modal */}
      {(showAddForecast || editForecast) && (
        <ForecastModal
          bankAccounts={accounts}
          today={today}
          initial={editForecast}
          prefill={apPrefill}
          onSave={handleSaveForecast}
          onDelete={handleDeleteForecast}
          canDelete={canDelete}
          onClose={() => { setShowAddForecast(false); setEditForecast(null); setApPrefill(null); }}
        />
      )}
    </div>
  );
};
