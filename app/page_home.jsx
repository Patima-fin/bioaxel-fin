// Home Page — ศูนย์แจ้งเตือนการเงิน (Financial Alert Center)
// Route: #home (default landing page). Read-only overview that aggregates
// actionable alerts from across the system (bank / receivable / payable /
// liquidity / project), categorized by type + severity (urgent/watch/track),
// plus a "today" panel and 3 summary cards (projects / weekly cash / banks).
//
// IMPORTANT: derives everything from LIVE entity tables (invoices, payables,
// bankAccounts, forecastEntries, projects, receipts, cashflowSnapshots) — the
// seed summary objects (data.pipeline / data.cashFlow / data.daily) are ZERO in
// production (not maintained by sync), so they are NOT used. Reference date =
// real today (meta.asOf is stale). Noisy groups are capped + aggregated so the
// list stays scannable (real data has 400+ payables / 700+ invoices).
// Purely derived — no setData. CSS prefixed hp-*.
const { useMemo: hmMemo, useState: hmState } = React;

const HP_TH_MON = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function hpDateShort(v, withYear) {
  const d = parseDateFlexible(v);
  if (!d) return '—';
  const s = `${d.getDate()} ${HP_TH_MON[d.getMonth()]}`;
  return withYear ? `${s} ${d.getFullYear()}` : s;
}
function hpDays(from, to) {
  const a = parseDateFlexible(from), b = parseDateFlexible(to);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}
function hpNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function hpBaht(n) {
  const v = hpNum(n);
  return '฿' + (v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('th-TH');
}
function hpMlnSigned(n) {
  const v = hpNum(n);
  const sign = v > 0 ? '+' : (v < 0 ? '−' : '');
  return `${sign}${(Math.abs(v) / 1e6).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ลบ.`;
}
function hpMln(n) {
  return `${(hpNum(n) / 1e6).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ลบ.`;
}
function hpK(n) {
  const v = Math.abs(hpNum(n));
  if (v >= 1e6) return hpMln(n);
  return `${Math.round(hpNum(n) / 1000).toLocaleString('th-TH')}K`;
}
// ช่วงวันที่ของสัปดาห์ (DD/MM–DD/MM ค.ศ.) — ใช้เป็นป้ายแทน W1/W2 ให้ตรงสัปดาห์จริง
function hpWeekRange(w) {
  const f = (iso) => { const d = parseDateFlexible(iso); return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '—'; };
  return `${f(w.startISO)}–${f(w.endISO)}`;
}

// tambon (ต.) or province (จ.) extracted from a free-text project name
function hpPlace(name, preferProvince) {
  if (!name) return '';
  if (!preferProvince) {
    const m = String(name).match(/ต(?:ำบล|\.)\s*([^\s]+)/);
    if (m) return m[1];
  }
  const m2 = String(name).match(/จ(?:ังหวัด|\.)\s*([^\s]+)/);
  if (m2) return m2[1];
  return '';
}
// "ENC169 ออนใต้" — code + place (place from project name)
function hpLabel(code, name, preferProvince) {
  const place = hpPlace(name, preferProvince);
  return place ? `${code || ''} ${place}`.trim() : (code || '');
}

// ── defensive field accessors (seed shape ↔ synced UPPER shape) ───────────────
function hpBankName(a)  { return a.BANK_NAME || a.bankName || a.bank || a.Bank || '—'; }
function hpBankAcNo(a)  { return a.Bank_AC || a.accountNo || a.account_no || a.ACCOUNT_NO || ''; }
function hpBankType(a)  { return a.accountType || a.Account_Type || a.type || a.ACCOUNT_TYPE || ''; }
function hpBankNote(a)  { return a.NOTE || a.note || a.Note || ''; }
function hpBankBalance(a, snapByAc) {
  const ac = hpBankAcNo(a);
  if (ac && snapByAc[ac] != null) return snapByAc[ac];
  return hpNum(a.BALANCE ?? a.balance ?? a.Balance ?? 0);
}
function hpLast4(ac) { const s = String(ac || '').replace(/\D/g, ''); return s.slice(-4); }

// ── Thai bank brand map (local logo file + brand color) ───────────────────────
// Logos are full app-icon PNGs in the repo folder "LOGO BANK/" (brand bg + white
// mark baked in). `color` is only used for the initials fallback (unknown bank).
const HP_BANK_LOGO_DIR = 'LOGO BANK/';
const HP_BANKS = {
  scb:   { file: 'ไทยพาณิช.png',     color: '#4e2e7f', match: /scb|ไทยพาณิช/i },
  kbank: { file: 'กสิกร.png',         color: '#138f2d', match: /kbank|kasikorn|กสิกร/i },
  ktb:   { file: 'กรุงไทย.png',        color: '#1ba5e1', match: /ktb|krung\s*thai|กรุงไทย/i },
  bbl:   { file: 'กรุงเทพ.png',        color: '#1e4598', match: /bbl|bangkok|กรุงเทพ/i },
  kkp:   { file: 'เกียรตินาคิน.png',   color: '#199cc5', match: /kkp?|kiatnakin|เกียรตินาคิน/i },
};
function hpBankBrand(name) {
  const s = String(name || '');
  for (const k in HP_BANKS) { if (HP_BANKS[k].match.test(s)) return HP_BANKS[k]; }
  return null;
}

// Bank logo tile — uses the local app-icon PNGs (LOGO BANK/<thai>.png), shown
// filling the rounded tile. Falls back to brand-colored initials when the bank
// has no supplied logo (or the file fails to load).
function HpBankLogo({ name }) {
  const [err, setErr] = hmState(false);
  const brand = hpBankBrand(name);
  if (brand && brand.file && !err) {
    return (
      <div className="hp-bank-logo">
        <img className="hp-bank-logo-img" src={encodeURI(HP_BANK_LOGO_DIR + brand.file)} alt={name} loading="lazy" onError={() => setErr(true)} />
      </div>
    );
  }
  const bg = (brand && brand.color) || 'var(--ink-400)';
  const initials = String(name || '?').replace(/[^A-Za-z0-9ก-๙]/g, '').slice(0, 4).toUpperCase();
  return <div className="hp-bank-logo hp-bank-logo--fb" style={{ background: bg }}>{initials}</div>;
}

const HP_CATS = [
  { key: 'all',        label: 'ทั้งหมด' },
  { key: 'bank',       label: 'เงินสด/ธนาคาร' },
  { key: 'receivable', label: 'รับเงิน/ลูกหนี้' },
  { key: 'payable',    label: 'จ่าย/เจ้าหนี้' },
  { key: 'liquidity',  label: 'สภาพคล่อง' },
  { key: 'project',    label: 'โครงการ/สัญญา' },
];
const HP_SEV_ORDER = { urgent: 0, watch: 1, track: 2 };

// normalize a forecast row (seed ↔ synced UPPER) — outflow/inflow planned only.
// `date` = the CASH-timing date (PAYMENT_DATE when present), not the booking DATE.
function hpNormFe(e) {
  return {
    date: e.PAYMENT_DATE || e.payment_date || e.date || e.DATE || e.Date,
    amt: hpNum(e.amount ?? e.AMOUNT ?? 0),
    label: e.label || e.DESCRIPTION || e.LABEL || e.name || e.note || e.NOTE || '',
    cat: String(e.category || e.CATEGORY || ''),
    status: String(e.status || e.STATUS || '').toUpperCase(),
    expType: String(e.expense_type || e.EXPENSE_TYPE || '').toUpperCase(),
  };
}
const hpFeIsLoan   = e => e.expType === 'LOAN' || /loan|สินเชื่อ|เบิกวงเงิน|เบิกสินเชื่อ/i.test(e.cat + ' ' + e.label);
const hpFeIsSalary = e => /เงินเดือน|โบนัส|payroll|เงินเดิอน/i.test(e.label);
const hpFePlanned  = e => !['ACTUAL', 'BOOKED', 'CANCELED', 'CANCELLED'].includes(e.status);

// ── Alert engine — derive a prioritized, capped set from live entities ────────
function hpBuildAlerts(data, asOf, weekProj) {
  const groups = []; // each: array of alert objs (already ordered)

  const invoices = data.invoices || [];
  const payables = data.payables || [];
  const banks    = data.bankAccounts || [];
  const projects = data.projects || [];
  const fes      = (data.forecastEntries || []).map(hpNormFe).filter(e => e.date);
  const salaryFe = fes.find(e => e.amt < 0 && hpFeIsSalary(e) && (hpDays(asOf, e.date) ?? -99) >= -3);
  const loanFe   = fes.find(e => e.amt > 0 && hpFeIsLoan(e) && hpFePlanned(e) && (hpDays(asOf, e.date) ?? -99) >= -3);

  const snapByAc = weekProj.snapByAc;

  // helper: emit a capped + aggregated group
  const emit = (arr, topN, aggregate) => {
    if (!arr.length) return;
    arr.sort((a, b) => (b._amt || 0) - (a._amt || 0));
    const top = arr.slice(0, topN);
    groups.push(top);
    if (arr.length > topN && aggregate) {
      const rest = arr.slice(topN);
      const sum = rest.reduce((s, x) => s + (x._amt || 0), 0);
      groups.push([aggregate(rest.length, sum)]);
    }
  };

  // ── 1. Bank negative / OD (urgent, bank) ───────────────────────────────────
  const bankNeg = [];
  banks.forEach(a => {
    const bal = hpBankBalance(a, snapByAc);
    if (bal >= 0) return;
    const note = hpBankNote(a);
    const lim = (note.match(/([\d][\d,]{4,})/) || [])[1];
    const limit = lim ? Number(lim.replace(/,/g, '')) : null;
    const pct = limit ? Math.round(Math.abs(bal) / limit * 100) : null;
    let detail = `ยอด ${hpBaht(bal)}`;
    if (pct != null) detail += ` · ใช้วงเงิน OD ไป ${pct}% (วงเงิน ${hpMln(limit)})`;
    detail += ' ควรเติมเงินเข้าบัญชีหลัก';
    bankNeg.push({
      _amt: Math.abs(bal), id: 'bank-neg-' + hpBankAcNo(a), severity: 'urgent', category: 'bank', icon: 'bank',
      title: `บัญชี ${hpBankName(a)} ติดลบ`, badge: 'ด่วน', desc: detail, amount: bal,
      action: { label: 'ดูบัญชีธนาคาร', route: 'bank_diary' },
    });
  });
  emit(bankNeg, 3);

  // ── 2. Liquidity projection negative (urgent, liquidity) ───────────────────
  if (weekProj.minClosing < 0 && weekProj.closing.length) {
    const idx = weekProj.closing.findIndex(v => v < 0);
    let detail = `เงินสดคาดการณ์ติดลบในสัปดาห์ที่ ${idx + 1} (${hpMln(weekProj.minClosing)})`;
    if (loanFe) detail += ` — ควรเบิกสินเชื่อหมุนเวียน ${hpMln(loanFe.amt)} ก่อน ${hpDateShort(loanFe.date)}`;
    else detail += ' — ควรเร่งเก็บหนี้ / จัดหาสินเชื่อหมุนเวียน';
    groups.push([{
      id: 'liq-proj', severity: 'urgent', category: 'liquidity', icon: 'chart',
      title: 'สภาพคล่องคาดการณ์ติดลบ', badge: `สัปดาห์ที่ ${idx + 1}`,
      desc: detail, amount: weekProj.minClosing, action: { label: 'แผน Cashflow', route: 'cashflow' },
    }]);
  }

  // ── invoice-derived (receivable) ───────────────────────────────────────────
  const lastFu = iv => { const f = iv.followUps || []; return f.length ? f[f.length - 1] : null; };
  const ivIssue = [], ivLong = [], ivTreasury = [], ivDue = [];
  invoices.forEach(iv => {
    if (iv.status === 'paid') return;
    const bal = hpNum(iv.balance);
    if (bal <= 0) return;
    const code = iv.jobNo || iv.ivNo;
    const short = hpLabel(code, iv.projectName || iv.customerName);
    const fu = lastFu(iv);
    const aged = hpDays(iv.invoiceDate, asOf);

    if (iv.status === 'issue') {
      ivIssue.push({
        _amt: bal, id: 'iv-issue-' + iv.ivNo, severity: 'watch', category: 'receivable', icon: 'invoice',
        title: 'IV ติดปัญหา — รอแก้เอกสาร',
        badge: aged != null && aged > 0 ? `ค้าง ${aged} วัน` : 'ติดปัญหา',
        desc: `${iv.ivNo} (${short}) ${fu ? fu.note : 'เอกสารถูกตีกลับ'} ${hpBaht(bal)}`,
        amount: null, action: { label: 'เปิดใบแจ้งหนี้', route: 'invoices' },
      });
      return;
    }
    if (iv.status === 'pending_inspection') {
      const dd = hpDays(asOf, iv.expectedReceive);
      if (dd != null && dd >= 0 && dd <= 7) {
        ivDue.push({
          _amt: bal, id: 'iv-due-' + iv.ivNo, severity: 'track', category: 'receivable', icon: 'receivables',
          title: 'รับเงินงวดครบกำหนด', badge: hpDateShort(iv.expectedReceive),
          desc: `${short} — ครบกำหนดรับ ${hpDateShort(iv.expectedReceive)} (รอตรวจรับ) ${hpBaht(bal)}`,
          amount: null, action: { label: 'ดู War Room', route: 'warroom1' },
        });
      }
      return;
    }
    if (iv.status === 'tracking') {
      const note = fu ? fu.note : '';
      if (/คลัง|ตั้งจ่าย/.test(note)) {
        ivTreasury.push({
          _amt: bal, id: 'iv-treasury-' + iv.ivNo, severity: 'track', category: 'receivable', icon: 'invoice',
          title: 'IV รอคลังตั้งจ่าย',
          badge: iv.expectedReceive ? `คาดรับ ${hpDateShort(iv.expectedReceive)}` : 'รอตั้งจ่าย',
          desc: `${iv.ivNo} (${short}) ${note} ${hpBaht(bal)}`,
          amount: null, action: { label: 'ติดตาม', route: 'iv_report' },
        });
        return;
      }
      if (aged != null && aged > 21 && (iv.followUps || []).length > 0) {
        ivLong.push({
          _amt: bal, id: 'iv-long-' + iv.ivNo, severity: 'watch', category: 'receivable', icon: 'invoice',
          title: 'IV ติดตามนาน', badge: `ค้าง ${aged} วัน`,
          desc: `${iv.ivNo} (${short}) ${note || 'อยู่ระหว่างติดตาม'} — ค้างเกิน ${aged} วัน ${hpBaht(bal)}`,
          amount: null, action: { label: 'ติดตาม', route: 'iv_report' },
        });
      }
    }
  });
  emit(ivIssue, 4, (n, s) => ({
    id: 'iv-issue-more', severity: 'watch', category: 'receivable', icon: 'invoice',
    title: `IV ติดปัญหาอีก ${n} ฉบับ`, badge: 'รวม', desc: `มูลค่ารวม ${hpBaht(s)} — ดูทั้งหมดในรายงานติดตาม IV`,
    amount: null, action: { label: 'ดูทั้งหมด', route: 'iv_report' },
  }));
  emit(ivTreasury, 3, (n, s) => ({
    id: 'iv-treasury-more', severity: 'track', category: 'receivable', icon: 'invoice',
    title: `รอคลังตั้งจ่ายอีก ${n} ฉบับ`, badge: 'รวม', desc: `มูลค่ารวม ${hpBaht(s)}`,
    amount: null, action: { label: 'ดูทั้งหมด', route: 'iv_report' },
  }));
  emit(ivLong, 3, (n, s) => ({
    id: 'iv-long-more', severity: 'watch', category: 'receivable', icon: 'invoice',
    title: `IV ติดตามนานอีก ${n} ฉบับ`, badge: 'รวม', desc: `มูลค่ารวม ${hpBaht(s)} — ค้างเกิน 21 วัน`,
    amount: null, action: { label: 'ดูทั้งหมด', route: 'iv_report' },
  }));
  emit(ivDue, 3, (n, s) => ({
    id: 'iv-due-more', severity: 'track', category: 'receivable', icon: 'receivables',
    title: `ครบกำหนดรับอีก ${n} งวด`, badge: 'รวม', desc: `มูลค่ารวม ${hpBaht(s)} ภายใน 7 วัน`,
    amount: null, action: { label: 'ดู War Room', route: 'warroom1' },
  }));

  // ── payables overdue (watch, payable) ──────────────────────────────────────
  const apOver = [];
  payables.forEach(ap => {
    const status = String(ap.status || ap.STATUS || '').toLowerCase();
    if (status === 'paid') return;
    const due = ap.due2 || ap.dueDate || ap.due || ap.DueDate || ap.DUE_DATE;
    const od = hpDays(due, asOf);
    if (status !== 'overdue' && !(od != null && od > 0)) return;
    const amt = hpNum(ap.netpayment ?? ap.amount ?? ap.Amount ?? ap.net_new ?? ap.Balance_Amount1);
    if (amt <= 0) return;
    const name = ap.cust_name || ap.creditorName || ap.Vendor || ap.vendor || 'เจ้าหนี้';
    apOver.push({
      _amt: amt, id: 'ap-od-' + (ap.vchno || ap.docno || ap.id || name), severity: 'watch', category: 'payable', icon: 'arrow_up',
      title: 'เจ้าหนี้เกินกำหนดชำระ', badge: od > 0 ? `เกิน ${od} วัน` : 'เกินกำหนด',
      desc: `${name} — ครบกำหนด ${hpDateShort(due)} ยังไม่จ่าย ${hpBaht(amt)}`,
      amount: null, action: { label: 'ดูเจ้าหนี้', route: 'data_payable' },
    });
  });
  emit(apOver, 4, (n, s) => ({
    id: 'ap-od-more', severity: 'watch', category: 'payable', icon: 'arrow_up',
    title: `เจ้าหนี้เกินกำหนดอีก ${n} ราย`, badge: 'รวม', desc: `ยอดรวม ${hpBaht(s)} — ดูทั้งหมดในหน้าเจ้าหนี้คงค้าง`,
    amount: null, action: { label: 'ดูเจ้าหนี้', route: 'data_payable' },
  }));

  // ── salary due (watch, payable) ────────────────────────────────────────────
  if (salaryFe) {
    groups.push([{
      id: 'fe-salary', severity: 'watch', category: 'payable', icon: 'coin',
      title: 'เงินเดือน / โบนัส ครบกำหนด', badge: hpDateShort(salaryFe.date),
      desc: `รอบจ่ายเงินเดือนพนักงาน — เตรียมเงินก่อน ${hpDateShort(salaryFe.date)} ${hpBaht(Math.abs(salaryFe.amt))}`,
      amount: null, action: { label: 'แผนจ่าย', route: 'bank_diary' },
    }]);
  }

  // ── projects waiting to sign (watch, project) ──────────────────────────────
  const waiting = [];
  projects.forEach(p => {
    const signed = p['เซ็นสัญญา'] || p.signedAt;
    const statusTxt = String(p['สถานะโครงการ'] || p.status || '');
    const value = hpNum(p['มูลค่าสัญญาที่เซ็น'] || p.TOTAL || p.value || p.signedValue);
    const isWaiting = (!signed && value > 0) || /รอลงนาม|ยังไม่เซ็น|waiting_sign|await/i.test(statusTxt);
    if (isWaiting && value > 0) waiting.push({ value, name: p['Contract No.'] || p.code });
  });
  if (waiting.length) {
    const total = waiting.reduce((s, x) => s + x.value, 0);
    groups.push([{
      id: 'proj-waiting', severity: 'watch', category: 'project', icon: 'projects',
      title: 'โครงการรอลงนามสัญญา', badge: `${waiting.length} สัญญา`,
      desc: `มูลค่ารวม ${hpBaht(total)} — เร่งติดตามการเซ็นสัญญา`,
      amount: null, action: { label: 'ดูโครงการ', route: 'projects' },
    }]);
  }

  // ── loan pending approval (track, liquidity) ───────────────────────────────
  if (loanFe) {
    groups.push([{
      id: 'fe-loan', severity: 'track', category: 'liquidity', icon: 'forecast',
      title: 'เบิกสินเชื่อหมุนเวียน', badge: 'แผนเบิก',
      desc: `แผนเบิก ${hpMln(loanFe.amt)} วันที่ ${hpDateShort(loanFe.date)} — เสริมสภาพคล่อง ${hpBaht(loanFe.amt)}`,
      amount: null, action: { label: 'แผน Cashflow', route: 'cashflow' },
    }]);
  } else {
    const loanPending = (data.debtLedger || []).find(d => /pending/i.test(String(d.status || '')));
    if (loanPending) {
      groups.push([{
        id: 'debt-loan', severity: 'track', category: 'liquidity', icon: 'forecast',
        title: 'สินเชื่อรออนุมัติ', badge: 'รออนุมัติ',
        desc: `${loanPending.bankName || ''} ${hpBaht(loanPending.principalAmount)} — ${loanPending.note || 'รออนุมัติสินเชื่อ'}`,
        amount: null, action: { label: 'ดูภาระหนี้', route: 'debt' },
      }]);
    }
  }

  const out = [].concat(...groups);
  out.sort((a, b) => HP_SEV_ORDER[a.severity] - HP_SEV_ORDER[b.severity]);
  return out;
}

function HomePage({ data }) {
  const [cat, setCat] = hmState('all');
  const [weekDrill, setWeekDrill] = hmState(null); // สัปดาห์ที่กดดูรายละเอียด
  const asOf = new Date().toISOString().slice(0, 10); // live reference (meta.asOf is stale)

  const session = (() => {
    try { return JSON.parse(localStorage.getItem('bio-session') || 'null'); } catch { return null; }
  })();
  const roleTh = { viewer: 'ผู้บริหาร', owner: 'เจ้าของ', staff: 'ฝ่ายการเงิน', manager: 'หัวหน้าการเงิน' };
  const dept = session ? (roleTh[session.role] || 'ฝ่ายการเงิน') : 'ฝ่ายการเงิน';

  // latest snapshot balance per account
  const snapByAc = hmMemo(() => {
    const latest = {};
    (data.cashflowSnapshots || []).forEach(s => {
      const ac = s.bankAc || s.Bank_AC;
      if (!ac) return;
      if (!latest[ac] || (s.date || '') > (latest[ac].date || '')) latest[ac] = s;
    });
    const out = {};
    Object.keys(latest).forEach(ac => { out[ac] = hpNum(latest[ac].balance); });
    return out;
  }, [data.cashflowSnapshots]);

  // ── weekly cash projection (current cash + forecast net per week, 5 weeks) ──
  //   cash0 = Σ ยอดคงเหลือธนาคารปัจจุบัน · net/สัปดาห์ = Σ forecastEntries (PLANNED) ตาม PAYMENT_DATE
  //   weeks[] เก็บรายละเอียดราย entry ไว้ให้ drill (กดดูที่มาตัวเลขได้)
  const weekProj = hmMemo(() => {
    const cash0 = (data.bankAccounts || []).reduce((s, a) => s + hpBankBalance(a, snapByAc), 0);
    const fes = (data.forecastEntries || []).map(hpNormFe).filter(e => e.date && hpFePlanned(e));
    const asOfD = parseDateFlexible(asOf);
    const weeks = [];
    let running = cash0;
    for (let i = 0; i < 5; i++) {
      const ws = new Date(asOfD); ws.setDate(asOfD.getDate() + i * 7);
      const we = new Date(ws);  we.setDate(ws.getDate() + 6);
      const entries = fes.filter(e => { const d = parseDateFlexible(e.date); return d && d >= ws && d <= we; })
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const net = entries.reduce((s, e) => s + e.amt, 0);
      const start = running;
      running += net;
      weeks.push({
        i, start, net, closing: running, entries,
        startISO: ws.toISOString().slice(0, 10), endISO: we.toISOString().slice(0, 10),
      });
    }
    const closing = weeks.map(w => w.closing);
    return {
      cash0, closing, weeks, snapByAc,
      minClosing: closing.length ? Math.min(...closing) : 0,
    };
  }, [data.bankAccounts, data.forecastEntries, snapByAc, asOf]);

  const alerts = hmMemo(() => hpBuildAlerts(data, asOf, weekProj), [data, asOf, weekProj]);

  const catCounts = hmMemo(() => {
    const c = { all: alerts.length };
    alerts.forEach(a => { c[a.category] = (c[a.category] || 0) + 1; });
    return c;
  }, [alerts]);
  const sevCounts = hmMemo(() => {
    const c = { urgent: 0, watch: 0, track: 0 };
    alerts.forEach(a => { c[a.severity]++; });
    return c;
  }, [alerts]);
  const shown = cat === 'all' ? alerts : alerts.filter(a => a.category === cat);

  // ── Today panel ─────────────────────────────────────────────────────────────
  const today = hmMemo(() => {
    // received today: receipts on asOf, else paid invoices with actualReceive.date===asOf
    const recvs = (data.receipts || []).filter(r => (r.receiptDate || r.RECEIPT_DATE) === asOf);
    let count, value, first;
    if (recvs.length) {
      count = recvs.length;
      value = recvs.reduce((s, r) => s + hpNum(r.netReceived ?? r.grossAmount ?? r.amount), 0);
      const r0 = recvs[0];
      first = { code: r0.projectCode || r0.invoiceNo, name: r0.projectName, bank: r0.bankAccount };
    } else {
      const paid = (data.invoices || []).filter(i => i.status === 'paid' && ((i.actualReceive && i.actualReceive.date === asOf) || i.actualReceiveDate === asOf));
      count = paid.length;
      value = paid.reduce((s, i) => s + hpNum((i.actualReceive && i.actualReceive.amount) || i.balance), 0);
      if (paid[0]) first = { code: paid[0].jobNo || paid[0].ivNo, name: paid[0].projectName || paid[0].customerName };
    }
    return { count, value, first };
  }, [data.receipts, data.invoices, asOf]);

  // upcoming operating forecast (rest of month from asOf, excl. financing)
  const upcoming = hmMemo(() => {
    const asOfD = parseDateFlexible(asOf);
    if (!asOfD) return { cashIn: 0, cashOut: 0, list: [] };
    const monthEnd = new Date(asOfD.getFullYear(), asOfD.getMonth() + 1, 0);
    const op = (data.forecastEntries || []).map(hpNormFe).filter(e => {
      if (!e.date || e.amt === 0 || !hpFePlanned(e) || hpFeIsLoan(e)) return false;
      const d = parseDateFlexible(e.date);
      return d && d >= asOfD && d <= monthEnd;
    }).sort((a, b) => parseDateFlexible(a.date) - parseDateFlexible(b.date));
    return {
      cashIn: op.filter(e => e.amt > 0).reduce((s, e) => s + e.amt, 0),
      cashOut: op.filter(e => e.amt < 0).reduce((s, e) => s + Math.abs(e.amt), 0),
      list: op.slice(0, 5),
    };
  }, [data.forecastEntries, asOf]);

  // ── Projects summary card ──────────────────────────────────────────────────
  // contract = Σ signed-contract value; received = Σ receipts (Receive col is
  // null in synced data, so use the receipts ledger); AR = contract − received.
  const proj = hmMemo(() => {
    let contractSum = 0, count = 0;
    (data.projects || []).forEach(p => {
      const contract = hpNum(p['มูลค่าสัญญาที่เซ็น'] || p.TOTAL || p.value || p.signedValue);
      if (contract <= 0) return;
      contractSum += contract; count++;
    });
    const received = (data.receipts || []).reduce((s, r) => s + hpNum(r.netReceived ?? r.grossAmount ?? r.amount), 0);
    const ar = Math.max(0, contractSum - received);
    return {
      contractSum, count,
      rows: [
        { label: 'มูลค่าสัญญารวม', val: contractSum, cnt: null, tone: 'blue' },
        { label: 'รับเงินแล้ว (สะสม)', val: received, cnt: null, tone: 'green' },
        { label: 'คงค้างรับ (AR)', val: ar, cnt: null, tone: 'amber' },
      ],
    };
  }, [data.projects, data.receipts]);
  const projMax = Math.max(1, ...proj.rows.map(r => Math.abs(r.val)));

  // ── Weekly closing bars ─────────────────────────────────────────────────────
  const weekMax = Math.max(1, ...weekProj.closing.map(v => Math.abs(v)));
  const weekAllNeg = weekProj.closing.length > 0 && weekProj.closing.every(v => v < 0);

  // ── Bank list ───────────────────────────────────────────────────────────────
  const bankRows = hmMemo(() => (data.bankAccounts || []).map(a => {
    const ac = hpBankAcNo(a);
    return { name: hpBankName(a), last4: hpLast4(ac), bal: hpBankBalance(a, snapByAc) };
  }), [data.bankAccounts, snapByAc]);

  const go = (r) => {
    if (window.WTPAuth && !window.WTPAuth.canViewPage(r)) return;
    window.location.hash = '#' + r;
  };

  return (
    <div className="page hp-page">
      <div className="hp-head">
        <h1 className="hp-title">ภาพรวมการเงิน</h1>
        <div className="hp-sub">ศูนย์แจ้งเตือนการเงิน ณ {hpDateShort(asOf, true)} · {dept}</div>
      </div>

      <div className="hp-grid">
        {/* ── Alert center ──────────────────────────────────────────────── */}
        <div className="hp-ac">
          <div className="hp-ac-head">
            <div className="hp-ac-title">
              <span className="hp-ac-warn"><Icon name="info" size={16} /></span>
              ศูนย์แจ้งเตือน
              <span className="hp-ac-count">{alerts.length}</span>
            </div>
            <div className="hp-ac-summary">
              <b className="hp-sev-u">{sevCounts.urgent} ด่วน</b> · <b className="hp-sev-w">{sevCounts.watch} เฝ้าระวัง</b> · <b className="hp-sev-t">{sevCounts.track} ติดตาม</b>
            </div>
          </div>

          <div className="hp-chips">
            {HP_CATS.map(c => (
              <button key={c.key} className={`hp-chip${cat === c.key ? ' is-active' : ''}`} onClick={() => setCat(c.key)}>
                {c.label}<span className="hp-chip-n">{catCounts[c.key] || 0}</span>
              </button>
            ))}
          </div>

          <div className="hp-alerts">
            {shown.length === 0 && (
              <div className="hp-empty"><Icon name="check" size={20} /> ไม่มีรายการแจ้งเตือนในหมวดนี้</div>
            )}
            {shown.map(a => (
              <div key={a.id} className={`hp-al hp-al--${a.severity}`}>
                <div className="hp-al-ic"><Icon name={a.icon} size={17} /></div>
                <div className="hp-al-body">
                  <div className="hp-al-top">
                    <span className="hp-al-title">{a.title}</span>
                    <span className="hp-al-badge">{a.badge}</span>
                  </div>
                  <div className="hp-al-desc">
                    {a.desc}
                    {a.amount != null && <b className={`hp-al-amt${a.amount < 0 ? ' neg' : ''}`}>{hpBaht(a.amount)}</b>}
                  </div>
                </div>
                <button className="hp-al-act" onClick={() => go(a.action.route)}>
                  {a.action.label} <span className="hp-al-arr">→</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Today panel ───────────────────────────────────────────────── */}
        <div className="hp-today">
          <div className="hp-today-head">
            <span className="hp-today-ttl">วันนี้ · {hpDateShort(asOf)}</span>
            {today.count > 0 && <span className="hp-today-badge">รับแล้ว</span>}
          </div>

          <div className="hp-today-recv">
            <div className="hp-recv-lbl">รับเข้าวันนี้ ({today.count} รายการ)</div>
            <div className="hp-recv-val">{hpBaht(today.value)}</div>
            {today.first
              ? <div className="hp-recv-sub">{today.first.code || ''}{today.first.name ? ' · ' + String(today.first.name).slice(0, 28) : ''}{today.first.bank ? ' · เข้าบัญชีแล้ว' : ''}</div>
              : <div className="hp-recv-sub">ยังไม่มีรายการรับเงินวันนี้</div>}
          </div>

          <div className="hp-today-stats">
            <div className="hp-stat">
              <div className="hp-stat-lbl">คาดเข้า · เดือนนี้</div>
              <div className="hp-stat-val pos">{hpMlnSigned(upcoming.cashIn)}</div>
            </div>
            <div className="hp-stat">
              <div className="hp-stat-lbl">คาดจ่าย · เดือนนี้</div>
              <div className="hp-stat-val neg">{hpMlnSigned(-upcoming.cashOut)}</div>
            </div>
          </div>

          <div className="hp-next-lbl">กำหนดถัดไป</div>
          <div className="hp-next">
            {upcoming.list.length === 0 && <div className="hp-next-empty">— ไม่มีรายการที่จะถึง —</div>}
            {upcoming.list.map((e, i) => (
              <div className="hp-next-row" key={i}>
                <span className="hp-next-date">{hpDateShort(e.date)}</span>
                <span className="hp-next-label">{e.label}</span>
                <span className={`hp-next-amt ${e.amt < 0 ? 'neg' : 'pos'}`}>{hpMlnSigned(e.amt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom 3 cards ────────────────────────────────────────────── */}
      <div className="hp-bottom">
        {/* Projects */}
        <div className="hp-card">
          <div className="hp-card-hd">
            <span>โครงการ</span>
            <button className="hp-card-link" onClick={() => go('projects')}>ดูทั้งหมด →</button>
          </div>
          <div className="hp-pipe">
            {proj.rows.map((r, i) => (
              <div className="hp-pipe-row" key={i}>
                <div className="hp-pipe-top">
                  <span className="hp-pipe-lbl">{r.label}</span>
                  <span className="hp-pipe-val">{hpMln(r.val)}</span>
                </div>
                <div className="hp-pipe-track">
                  <div className={`hp-pipe-fill tone-${r.tone}`} style={{ width: `${Math.round(Math.abs(r.val) / projMax * 100)}%` }} />
                </div>
                {r.cnt != null && <div className="hp-pipe-cnt">{r.cnt} โครงการ</div>}
              </div>
            ))}
          </div>
          <div className="hp-pipe-total">
            <span>โครงการทั้งหมด</span>
            <b>{proj.count.toLocaleString('th-TH')} โครงการ</b>
          </div>
        </div>

        {/* Weekly cash projection — ป้าย = ช่วงวันที่จริง · กดดูที่มาได้ */}
        <div className="hp-card">
          <div className="hp-card-hd">
            <span>เงินสดคาดการณ์รายสัปดาห์</span>
            {weekProj.weeks[0] && <span className="hp-card-tag">สัปดาห์นี้ {hpWeekRange(weekProj.weeks[0])}</span>}
          </div>
          <div className="hp-weeks">
            {weekProj.weeks.map((w) => {
              const v = w.closing;
              const h = Math.round(Math.abs(v) / weekMax * 92) + 8;
              const cur = w.i === 0;
              return (
                <button className="hp-week" key={w.i} type="button"
                  onClick={() => setWeekDrill(w)}
                  title={`${hpWeekRange(w)} · กดดูที่มา (${w.entries.length} รายการ)`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', padding: 0 }}>
                  <div className="hp-week-val">{hpMln(v)}</div>
                  <div className="hp-week-bar-wrap">
                    <div className={`hp-week-bar${v < 0 ? ' neg' : ''}${cur ? ' cur' : ''}`} style={{ height: h }} />
                  </div>
                  <div className={`hp-week-lbl${cur ? ' cur' : ''}`}>{hpWeekRange(w)}</div>
                </button>
              );
            })}
            {weekProj.weeks.length === 0 && <div className="hp-next-empty">— ไม่มีข้อมูล —</div>}
          </div>
          <div className="hp-week-note">{weekAllNeg ? 'ทุกสัปดาห์ติดลบ — ต้องเสริมสภาพคล่อง' : `เงินสดตั้งต้น ${hpMln(weekProj.cash0)} (Σ ยอดธนาคาร) · บวกประมาณการ Forecast · กดแท่งดูที่มา`}</div>
        </div>

        {/* Banks */}
        <div className="hp-card">
          <div className="hp-card-hd">
            <span>บัญชีธนาคาร</span>
            <button className="hp-card-link" onClick={() => go('bank_diary')}>ดูทั้งหมด →</button>
          </div>
          <div className="hp-banks">
            {bankRows.map((b, i) => (
              <div className="hp-bank-row" key={i}>
                <HpBankLogo name={b.name} />
                <div className="hp-bank-info">
                  <div className="hp-bank-name">{b.name}{b.last4 ? <span className="hp-bank-ac"> · {b.last4}</span> : null}</div>
                </div>
                <div className={`hp-bank-bal${b.bal < 0 ? ' neg' : ''}`}>{hpBaht(b.bal)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Week drill — ที่มาของเงินสดคาดการณ์รายสัปดาห์ */}
      {weekDrill && (
        <Modal open={true} maxWidth={560} onClose={() => setWeekDrill(null)}
          title={`เงินสดคาดการณ์ · ${hpWeekRange(weekDrill)}${weekDrill.i === 0 ? ' (สัปดาห์นี้)' : ''}`}
          footer={<button className="btn btn-ghost" onClick={() => setWeekDrill(null)}>ปิด</button>}>
          <div style={{ fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 2px', borderBottom: '1px solid var(--ink-100)' }}>
              <span style={{ color: 'var(--ink-600)' }}>ยอดยกมา (ต้นสัปดาห์)</span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{hpMln(weekDrill.start)}</b>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-500)', margin: '10px 2px 4px', fontWeight: 600 }}>
              ประมาณการในสัปดาห์ ({weekDrill.entries.length} รายการ · จาก Forecast)
            </div>
            {weekDrill.entries.length === 0 && (
              <div className="muted" style={{ padding: '12px 2px' }}>— ไม่มีรายการประมาณการในสัปดาห์นี้ —</div>
            )}
            {weekDrill.entries.map((e, k) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 2px', borderBottom: '1px solid var(--ink-50, #f1f5f9)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label || '(ไม่มีรายละเอียด)'}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>{fmtDate(e.date)}{e.cat ? ` · หมวด ${e.cat}` : ''}</div>
                </div>
                <b style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: e.amt < 0 ? 'var(--bad)' : 'var(--good)' }}>
                  {e.amt > 0 ? '+' : ''}{hpMln(e.amt)}
                </b>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 2px', marginTop: 4, borderTop: '2px solid var(--ink-100)' }}>
              <span style={{ fontWeight: 600 }}>ประมาณการสุทธิสัปดาห์นี้</span>
              <b style={{ fontVariantNumeric: 'tabular-nums', color: weekDrill.net < 0 ? 'var(--bad)' : 'var(--good)' }}>{weekDrill.net > 0 ? '+' : ''}{hpMln(weekDrill.net)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 2px', background: 'var(--brand-50)', borderRadius: 8, marginTop: 6 }}>
              <span style={{ fontWeight: 700, color: 'var(--brand-700)' }}>ยอดเงินสดคาดการณ์ (สิ้นสัปดาห์)</span>
              <b style={{ fontVariantNumeric: 'tabular-nums', fontSize: 15, color: weekDrill.closing < 0 ? 'var(--bad)' : 'var(--brand-700)' }}>{hpMln(weekDrill.closing)}</b>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
