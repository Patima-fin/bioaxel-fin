/* page_debt_ledger.jsx — Debt Ledger · ดอกเบี้ย
   v4: Sticky thead + FilterableColHeader + polished Modal popup with
       per-month payment recording (single + bulk), interest override,
       audit trail, and flexible export (summary OR per-contract sheets).
*/
'use strict';

const DL_CATEGORY_COLOR = {
  'WCI':       '#2e8b4a',
  'STS':       '#15803d',
  'BHG':       '#4f46e5',
  'กรรมการ':    '#7c3aed',
  'ตปท.':       '#b45309',
  'ธนาคาร':     '#475569',
  'อื่นๆ':       '#525252',
};
const DL_CATEGORY_BG = {
  'WCI':       '#ebf8ff', 'STS':       '#f0fdf4', 'BHG':       '#eef2ff',
  'กรรมการ':    '#f5f3ff', 'ตปท.':       '#fffbeb',
  'ธนาคาร':     '#f1f5f9', 'อื่นๆ':       '#f5f5f5',
};

const TH_MONTH = ['', 'ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

// ── Facility types (ประเภทวงเงินธนาคาร) — ใช้ทั่วทั้ง 2 หน้า ────────────────
// PE   = Pre-shipment / Pre-Receivable    (เบิกก่อนรับชำระ)
// POST = Post-shipment / Post-Receivable  (เบิกหลังออก IV / โอนสิทธิ์รับเงิน)
const FACILITY_TYPES = ['PE', 'POST', 'OD', 'PN', 'L/G', 'T/R', 'L/C', 'TL', 'อื่นๆ'];
const FACILITY_META = {
  'PE':    { color: '#b45309', bg: '#fef3c7', label: 'PE',    full: 'Pre-Export / Pre-Receivable' },
  'POST':  { color: '#0369a1', bg: '#dbeafe', label: 'POST',  full: 'Post-Receivable / โอนสิทธิ์รับเงิน' },
  'OD':    { color: '#7c2d12', bg: '#fed7aa', label: 'OD',    full: 'Overdraft' },
  'PN':    { color: '#6b21a8', bg: '#f3e8ff', label: 'PN',    full: 'Promissory Note' },
  'L/G':   { color: '#166534', bg: '#dcfce7', label: 'L/G',   full: 'Letter of Guarantee' },
  'T/R':   { color: '#0e7490', bg: '#cffafe', label: 'T/R',   full: 'Trust Receipt' },
  'L/C':   { color: '#9d174d', bg: '#fce7f3', label: 'L/C',   full: 'Letter of Credit' },
  'TL':    { color: '#154524', bg: '#e0e7ff', label: 'TL',    full: 'Term Loan' },
  'อื่นๆ': { color: '#525252', bg: '#f5f5f5', label: 'อื่นๆ', full: 'Other' },
};
function FacilityChip({ type, size = 'sm' }) {
  if (!type) return null;
  const m = FACILITY_META[type] || { color: '#525252', bg: '#f5f5f5', label: type, full: type };
  return (
    <span title={m.full} style={{
      display: 'inline-block',
      fontSize: size === 'sm' ? 9.5 : 11, fontWeight: 700,
      letterSpacing: 0.3,
      background: m.bg, color: m.color,
      border: `1px solid ${m.color}33`,
      borderRadius: 4, padding: size === 'sm' ? '0 5px' : '1px 8px',
      lineHeight: 1.55,
    }}>{m.label}</span>
  );
}

// ── Comma-formatted number input ────────────────────────────────────────────
// value = raw number; display = "8,000,000.00" when blurred, "8000000" when focused
function NumberInput({ value, onChange, digits = 0, style, ...rest }) {
  const [focused, setFocused] = React.useState(false);
  const [raw, setRaw] = React.useState('');
  const n = (value == null || value === '') ? null : Number(value);
  const display = focused
    ? raw
    : (n == null || isNaN(n) || n === 0 ? '' : fmtNum(n, digits));
  return (
    <input
      type="text" inputMode="decimal"
      {...rest}
      value={display}
      onChange={e => setRaw(e.target.value)}
      onFocus={e => {
        setFocused(true);
        setRaw(n == null || isNaN(n) || n === 0 ? '' : String(n));
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => {
        const txt = String(raw).replace(/,/g, '').trim();
        if (txt === '') { onChange(0); setFocused(false); return; }
        const parsed = parseFloat(txt);
        onChange(isNaN(parsed) ? 0 : parsed);
        setFocused(false);
      }}
      style={{
        textAlign: 'right', fontFamily: 'ui-monospace', fontWeight: 600,
        ...style,
      }}
    />
  );
}

// ── Percent input — user types 7 → stored 0.07, displayed "7.00%" ───────────
// Allows decimals too: type 7.5 → 0.075, displayed "7.50%"
function PercentInput({ value, onChange, style, ...rest }) {
  const [focused, setFocused] = React.useState(false);
  const [raw, setRaw] = React.useState('');
  const n = (value == null || value === '') ? 0 : Number(value);
  const display = focused
    ? raw
    : (n === 0 || isNaN(n) ? '' : (n * 100).toFixed(2) + '%');
  return (
    <input
      type="text" inputMode="decimal"
      {...rest}
      value={display}
      onChange={e => setRaw(e.target.value)}
      onFocus={e => {
        setFocused(true);
        setRaw(n === 0 || isNaN(n) ? '' : String(+(n * 100).toFixed(4)));
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => {
        const txt = String(raw).replace(/[%,\s]/g, '').trim();
        if (txt === '') { onChange(0); setFocused(false); return; }
        let parsed = parseFloat(txt);
        if (isNaN(parsed)) parsed = 0;
        onChange(parsed / 100);
        setFocused(false);
      }}
      style={{
        textAlign: 'right', fontFamily: 'ui-monospace', fontWeight: 600,
        ...style,
      }}
    />
  );
}

// ── Aggregate ledger by contract (totals + paid/unpaid breakdown) ────────────
function buildInterestByContract(debtLedger) {
  const map = {};
  debtLedger.forEach(r => {
    const k = r.contractNo;
    if (!k) return;
    if (!map[k]) {
      map[k] = {
        contractNo: k, totalInterest: 0, outstandingInterest: 0,
        paidInterest: 0, unpaidMonths: 0, paidMonths: 0,
        firstYear: null, lastYear: null,
      };
    }
    const m = map[k];
    const amt  = effectiveInterest(r);
    const paid = interestPaid(r);
    m.totalInterest += amt;
    m.paidInterest  += paid;
    m.outstandingInterest += Math.max(0, amt - paid);
    if (isInterestFullyPaid(r)) m.paidMonths += 1; else m.unpaidMonths += 1;
    const y = Number(r.year);
    if (y) {
      if (m.firstYear == null || y < m.firstYear) m.firstYear = y;
      if (m.lastYear  == null || y > m.lastYear)  m.lastYear  = y;
    }
  });
  return map;
}

// "effective" interest = override if set, else computed
function effectiveInterest(r) {
  if (r.interestOverride != null && r.interestOverride !== '') {
    const n = Number(r.interestOverride);
    if (!isNaN(n)) return n;
  }
  return Number(r.interestAmount) || 0;
}

// ── ดอกเบี้ย: รองรับ "จ่ายหลายรอบ/บางส่วน" ต่อเดือน ─────────────────────────────
// r.payments = [{date, amount, note, by, at}] เก็บใน jsonb ทั้งแถว (ไม่ต้องแก้ schema).
// legacy: แถวจ่ายครบแบบเดิม (มี paymentDate แต่ไม่มี payments[]) นับเป็น 1 รอบเต็ม.
// paymentDate ยังถูก set = วันจ่ายรอบสุดท้าย "เมื่อจ่ายครบ" (ว่างเมื่อจ่ายบางส่วน)
// → โค้ดเดิมที่เช็ค r.paymentDate (แท็บจ่ายแล้ว/ไฮไลต์เขียว) ยังทำงานถูก.
function interestPayments(r) {
  if (Array.isArray(r.payments) && r.payments.length) {
    return r.payments.filter(p => p && (Number(p.amount) || 0) > 0);
  }
  if (r.paymentDate) return [{ date: r.paymentDate, amount: effectiveInterest(r), note: r.paymentNote || '', by: r.paidBy || '', legacy: true }];
  return [];
}
function interestPaid(r)      { return interestPayments(r).reduce((s, p) => s + (Number(p.amount) || 0), 0); }
function interestRemaining(r) { return Math.max(0, effectiveInterest(r) - interestPaid(r)); }
function isInterestFullyPaid(r) {
  const eff = effectiveInterest(r);
  if (eff <= 0.005) return !!r.paymentDate || (Array.isArray(r.payments) && r.payments.length > 0);
  return interestPaid(r) >= eff - 0.005;
}
function interestPayStatus(r) { return isInterestFullyPaid(r) ? 'full' : (interestPaid(r) > 0 ? 'partial' : 'unpaid'); }

// คงเหลือเงินต้น = เงินต้นตั้งต้น + Σเบิกเพิ่ม − Σคืนเงินต้น (คำนวณสดจาก events เสมอ
// → แก้/ลบ event แล้วยอดคงเหลือ + ตารางดอกเบี้ย + การ์ดสรุป อัปเดตพร้อมกันไม่มีเพี้ยน)
function recalcBalance(master, events) {
  const mine = (events || []).filter(e =>
    e.contractId === master.id || e.contractNo === master.contractNo);
  const inSum  = mine.filter(e => e.eventType === 'drawdown')
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const outSum = mine.filter(e => e.eventType === 'repayment')
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return Math.max(0, (Number(master.principalAmount) || 0) + inSum - outSum);
}

// ยอดคงเหลือเงินต้นที่ใช้แสดง — มอง balance = 0 เป็นค่าที่ใช้ได้ (อย่าเด้งไป principalAmount)
function masterBalance(m) {
  return (m.balance != null && m.balance !== '') ? (Number(m.balance) || 0) : (Number(m.principalAmount) || 0);
}
// ยอดคงเหลือสำหรับ "แสดงในทะเบียน/สรุป" — สัญญาที่ปิดแล้ว (Close) = ชำระครบ/โอนออกแล้ว = 0
// (ปิดด้วยตนเองไม่ได้ล้าง field balance → masterBalance ยังคืนยอดเดิม; helper นี้กันไว้ที่ชั้นแสดงผล
//  ไม่แตะข้อมูลที่เก็บ เพื่อให้ "เปิดกลับ Active" ได้ยอดเดิมคืน). ดู CHANGELOG 2026-07-16 (6).
function debtDisplayBalance(m) {
  if (!m) return 0;
  if (m.status === 'Close') return 0;
  return masterBalance(m);
}
// เงินต้นรวมที่เบิกจริง = วงเงินตั้งต้น (principalAmount) + Σ เบิกเพิ่ม (drawdown events) — ใช้แสดง
// คอลัมน์ "วงเงิน" ในทะเบียนให้ตรงกับคงเหลือ + การ์ด "เงินต้นรวม (เบิก)" ใน drawer. เพราะพอ
// นักลงทุนลงเพิ่ม/เบิกเพิ่ม คงเหลือจะโตเกินวงเงินตั้งต้น ("คงเหลือ > วงเงิน" ดูแปลก) → ให้วงเงินโตตาม.
function debtGrossPrincipal(master, events) {
  if (!master) return 0;
  const base = Number(master.principalAmount) || 0;
  const draw = (events || [])
    .filter(e => (e.contractId === master.id || e.contractNo === master.contractNo) && e.eventType === 'drawdown')
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return base + draw;
}

// ── Auto interest schedule (Phase A — read-only เทียบกับของเดิม) ─────────────
// คำนวณตารางดอกเบี้ยรายเดือนสดจาก สัญญา + events ตาม config การคิดวันต่อสัญญา
const _dayMs = 86400000;
function _daysBetween(a, b) { return Math.max(0, Math.round((new Date(b) - new Date(a)) / _dayMs)); }
function _daysInYear(y) { return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365; }
function _monthStartStr(s) { return s.slice(0, 7) + '-01'; }
function _addMonthStr(s, n) { const d = new Date(s.slice(0, 10)); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }
function _monthEndStr(s) { return _addMonthStr(_monthStartStr(s), 1); } // วันที่ 1 ของเดือนถัดไป
// 30/360 (US/NASD) day count
function _thirty360(d1, d2) {
  let [y1, m1, a1] = d1.split('-').map(Number);
  let [y2, m2, a2] = d2.split('-').map(Number);
  if (a1 === 31) a1 = 30;
  if (a2 === 31 && a1 === 30) a2 = 30;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (a2 - a1);
}

// คืน { rows:[{year,month,days,interest,pStart,pEnd}], total, error, missing:[] }
function buildAutoSchedule(master, events, asOf, cfg) {
  cfg = cfg || {};
  const method   = cfg.method   || 'ACT/365';      // ACT/365 | ACT/360 | ACT/ACT | 30/360
  const dayCount = cfg.dayCount || 'exclude_end';   // exclude_end | include_end
  const rate      = Number(master.interestRate) || 0;   // เก็บเป็นทศนิยม (0.07)
  const start     = master.startDate || master.receiveDate || master.drawdownDate || '';
  const principal0 = Number(master.principalAmount) || 0;
  const missing = [];
  if (!start)      missing.push('วันเริ่ม/วันรับเงิน');
  if (!rate)       missing.push('อัตราดอกเบี้ย');
  if (!principal0) missing.push('เงินต้น');
  // วันจบ: โหมดเทียบใช้ endCap · Active = สิ้นเดือนปัจจุบันเสมอ (เลยกำหนดแล้วก็เดินดอกต่อ และไม่ปั่น
  // แถวล่วงหน้าเกินเดือนนี้แม้ยังไม่ถึงวันครบสัญญา — ไม่งั้น "ดอกเบี้ยค้างจ่าย" จะบวมด้วยดอกในอนาคต)
  // · Close = maturityDate/closedDate
  let end = cfg.endCap
          || (master.status === 'Active' ? _monthEndStr(asOf) : (master.maturityDate || master.closedDate || ''));
  if (!end) missing.push('วันครบสัญญา');
  if (missing.length) return { rows: [], total: 0, error: 'ข้อมูลไม่ครบ', missing };
  if (start >= end) return { rows: [], total: 0, error: 'วันเริ่ม ≥ วันสิ้นสุดงวด', missing: [], start, end };

  // ไทม์ไลน์เงินต้นจาก events (เฉพาะที่อยู่ระหว่างสัญญา — นับวันเดียวกับวันเริ่มสัญญาด้วย:
  // เบิกเพิ่ม/คืนวันแรกต้องมีผลตั้งแต่วันแรก ไม่งั้นเงินต้นในตารางไม่ตรงกับการ์ด "เงินต้นรวม (เบิก)")
  const evs = (events || [])
    .filter(e => (e.contractId === master.id || e.contractNo === master.contractNo) && e.eventDate)
    .map(e => ({ date: e.eventDate, delta: (e.eventType === 'repayment' ? -1 : 1) * (Number(e.amount) || 0) }))
    .filter(e => e.date >= start && e.date < end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const principalAt = (d) => {
    let p = principal0;
    for (const e of evs) if (e.date <= d) p += e.delta;
    return Math.max(0, p);
  };

  // จุดแบ่งงวด: วันเริ่ม, วันครบ, ต้นเดือนทุกเดือน, วันที่มี event
  const bset = new Set([start, end]);
  let cur = _monthStartStr(_addMonthStr(start, 1));
  while (cur < end) { bset.add(cur); cur = _monthStartStr(_addMonthStr(cur, 1)); }
  evs.forEach(e => bset.add(e.date));
  const bounds = [...bset].filter(d => d >= start && d <= end).sort();

  // แยกเป็น 1 แถว/ช่วงเงินต้น (เดือนปกติ = 1 แถว · เดือนที่คืน/เบิกกลางเดือน = หลายแถว)
  // → เงินต้นแต่ละแถวเป็นค่าเดียว ตรวจที่มาของดอกเบี้ยได้ชัด ไม่มีแถวยอด 0
  const rows = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1];
    if (a === b) continue;
    const p = principalAt(a);
    let days = method === '30/360' ? _thirty360(a, b) : _daysBetween(a, b);
    if (days <= 0) continue;
    if (dayCount === 'include_end' && (b === end || evs.some(e => e.date === b))) days += 1;
    const basis = (method === 'ACT/360' || method === '30/360') ? 360
                : method === 'ACT/ACT' ? _daysInYear(Number(a.slice(0, 4)))
                : 365;
    rows.push({
      year: Number(a.slice(0, 4)), month: Number(a.slice(5, 7)),
      periodStart: a, periodEnd: b,
      principal: p, days, interest: p * rate * (days / basis),
      balanceAfter: principalAt(b),
    });
  }
  return { rows, total: rows.reduce((s, r) => s + r.interest, 0), error: null, missing: [] };
}

// ตัวหารฐานวัน/ปี ตามวิธีคิด (ให้ตรงกับ buildAutoSchedule เป๊ะ ๆ)
function _basisFor(method, year) {
  return (method === 'ACT/360' || method === '30/360') ? 360
       : method === 'ACT/ACT' ? _daysInYear(Number(year))
       : 365;
}

// วันสิ้นสุดการคิดดอกของสัญญาที่ "ปิดแล้ว" = วันคืนเงินต้นจริงที่ช้าที่สุด (closedDate หรือวันคืนล่าสุดใน events)
// — ไม่ใช่ maturityDate: สัญญาที่คืน "ช้ากว่า" วันครบกำหนดต้องเดินดอกต่อถึงวันคืนจริง (เดิม cap = maturityDate
//   มาก่อน → คืน 2/12 แต่ครบกำหนด 29/11 ทำให้ ธ.ค. หายทั้งเดือน) · คืน "ก่อน" ครบกำหนดก็หยุดที่วันคืนจริงเช่นกัน
//   · ไม่มีวันคืน/closedDate ค่อย fallback → maturityDate → สิ้นเดือนของแถวสุดท้ายในตาราง
// ★ ใช้ทั้งใน adoptAutoMode และแผงเทียบ 🔬 เพื่อให้ "พรีวิว = ตอนกดใช้จริง" เสมอ
function _closedEndDate(master, events, ledgerRows) {
  const repayDates = (events || [])
    .filter(e => (e.contractId === master.id || e.contractNo === master.contractNo)
              && e.eventType === 'repayment' && e.eventDate)
    .map(e => e.eventDate);
  const real = [master.closedDate, ...repayDates].filter(Boolean).sort();
  if (real.length) return real[real.length - 1];   // วันคืนจริงช้าสุด
  if (master.maturityDate) return master.maturityDate;
  const last = (ledgerRows || []).slice().sort((a, b) =>
    (Number(a.year) || 0) - (Number(b.year) || 0) || (Number(a.month) || 0) - (Number(b.month) || 0)).pop();
  return last ? _monthEndStr(`${last.year}-${String(last.month).padStart(2, '0')}-01`) : null;
}

// จับคู่แถวลูก (ledger/event) กับสัญญาแม่ — ใช้ contractId (id ที่ไม่มีวันเปลี่ยน) เป็นหลัก
// + contractNo เป็น fallback → แก้ contractNo แล้วแถวไม่หลุด (เหมือนที่ events ทำอยู่แล้ว เลยเป็นเหตุผล
// ที่ "เบิก/คืนเงินต้น" ยังโชว์ตอนตารางดอกเบี้ยหาย). ★ ต้องเป็น global (page_debt.jsx ยืมไปใช้)
function debtRowMatchesContract(row, master) {
  if (!row || !master) return false;
  return (row.contractId != null && row.contractId !== '' && row.contractId === master.id)
      || (row.contractNo != null && row.contractNo !== '' && row.contractNo === master.contractNo);
}

// normalize เลขสัญญาเพื่อเดา master ปลายทางของแถวกำพร้า — ตัด prefix เลขนำ (เช่น "01-", "2-")
// + ช่องว่าง/ตัวพิมพ์ ให้ "BIOXEL256710001A" ↔ "02-BIOXEL256710001A" จับคู่กันได้
function debtNormNo(no) {
  return String(no || '').trim().toUpperCase().replace(/\s+/g, '').replace(/^\d{1,3}-/, '');
}

// เดาสัญญาปลายทางของแถวกำพร้าจาก contractNo เดิม — normalize แล้วหา master ที่ตรง (unique เท่านั้น)
function suggestMasterForOrphan(orphanNo, masters) {
  const target = debtNormNo(orphanNo);
  if (!target) return null;
  const exact = (masters || []).filter(m => debtNormNo(m.contractNo) === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // กำกวม → ให้ผู้ใช้เลือกเอง
  const contains = (masters || []).filter(m => {
    const mn = debtNormNo(m.contractNo);
    return mn && (mn.includes(target) || target.includes(mn));
  });
  return contains.length === 1 ? contains[0] : null;
}

// หาแถว debtLedger ที่ "กำพร้า" = ไม่ match สัญญาใดเลย (ทั้ง contractId และ contractNo)
// คืน [{ contractNo, rows, count, paid, suggested }] จัดกลุ่มตาม contractNo เดิม เรียงมาก→น้อย
function computeDebtOrphans(allLedger, masters) {
  const orphans = (allLedger || []).filter(r => !(masters || []).some(m => debtRowMatchesContract(r, m)));
  const byNo = {};
  orphans.forEach(r => { const no = r.contractNo || '(ไม่มีเลขสัญญา)'; (byNo[no] = byNo[no] || []).push(r); });
  return Object.entries(byNo).map(([contractNo, rows]) => ({
    contractNo, rows, count: rows.length,
    paid: rows.filter(r => r.paymentDate).length,
    suggested: suggestMasterForOrphan(contractNo, masters),
  })).sort((a, b) => b.count - a.count);
}

const CALC_METHODS = [
  { k: 'ACT/365', label: 'ACT/365 — วันจริง ÷ 365' },
  { k: 'ACT/360', label: 'ACT/360 — วันจริง ÷ 360' },
  { k: 'ACT/ACT', label: 'ACT/ACT — วันจริง ÷ วันจริงของปีนั้น' },
  { k: '30/360',  label: '30/360 — นับเดือนละ 30 วัน ÷ 360' },
];

// ── Migrate: ดึงรายการคืน/เบิกเงินต้นจาก "แถว marker" ในตารางเดิม ─────────────
// แถว marker = note มี "คืนเงินต้น"/"เบิก" + เงินต้นเปลี่ยนเทียบแถวถัดไป
// คืน [{contractNo, contractId, eventType, eventDate, amount, note}]
function extractEventsFromLedger(rows, master) {
  const sorted = [...rows].sort((a, b) =>
    (Number(a.year) || 0) - (Number(b.year) || 0) ||
    (Number(a.month) || 0) - (Number(b.month) || 0)
  );
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const note = String(r.note || r.paymentNote || '');
    const isRepay = /คืนเงินต้น|คืนเงิน|ชำระต้น/.test(note);
    const isDraw  = /เบิก(เพิ่ม|เงิน)?|รับเงินกู้|drawdown/i.test(note);
    if (!isRepay && !isDraw) continue;
    const before = Number(r.principal) || 0;
    let after = before;
    for (let j = i + 1; j < sorted.length; j++) {
      const p = Number(sorted[j].principal);
      if (!isNaN(p) && sorted[j].principal !== '' && sorted[j].principal != null) { after = p; break; }
    }
    const amt = Math.abs(before - after);
    if (amt <= 0) continue;
    out.push({
      contractNo: master.contractNo, contractId: master.id,
      eventType: (after < before || isRepay) ? 'repayment' : 'drawdown',
      eventDate: r.paymentDate || `${r.year}-${String(r.month).padStart(2, '0')}-01`,
      amount: amt,
      note: 'นำเข้าจากตารางเดิม (migrate)',
    });
  }
  return out;
}

// ── Main table row ──────────────────────────────────────────────────────────
function DebtLedgerRow({ master, summary, onOpen }) {
  const cat = master.debtCategory || 'อื่นๆ';
  const color = DL_CATEGORY_COLOR[cat] || '#525252';
  const bg    = DL_CATEGORY_BG[cat]    || '#f5f5f5';
  const isActive  = master.status === 'Active';
  const principal = Number(master.principalAmount) || 0;
  const rate      = Number(master.interestRate) || 0;
  const isUSD     = master.currency === 'USD';
  const s = summary || { totalInterest: 0, outstandingInterest: 0, paidInterest: 0, unpaidMonths: 0, paidMonths: 0 };
  return (
    <tr style={{ opacity: isActive ? 1 : 0.6, cursor: onOpen ? 'pointer' : 'default' }} onClick={() => onOpen && onOpen(master)}>
      <td>
        <Badge kind="b-blue" dot={false} style={{ background: bg, color, border: `1px solid ${color}33` }}>
          {cat}
        </Badge>
      </td>
      <td style={{ fontFamily: 'ui-monospace', fontSize: 11.5, color: 'var(--ink-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={master.contractNo}>
        {master.contractNo || '—'}
      </td>
      <td style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={master.borrowerName || ''}>
        {master.borrowerName || '—'}
      </td>
      <td style={{ textAlign: 'center' }}>
        <Badge kind={isActive ? 'b-blue' : 'b-gray'} dot={false}>{isActive ? 'Active' : 'Close'}</Badge>
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {fmtNum(principal, 0)} {isUSD && <span style={{ color: 'var(--ink-400)', fontSize: 10 }}>USD</span>}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
        {rate > 0 ? (rate * 100).toFixed(2) + '%' : '—'}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, whiteSpace: 'nowrap' }}>
        {fmtNum(s.totalInterest, 0)}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--good)', whiteSpace: 'nowrap' }}>
        {s.paidInterest > 0 ? fmtNum(s.paidInterest, 0) : '—'}
        {s.paidMonths > 0 && <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>{s.paidMonths} เดือน</div>}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13,
                   color: s.outstandingInterest > 0 ? 'var(--bad)' : 'var(--ink-300)', whiteSpace: 'nowrap' }}>
        {fmtNum(s.outstandingInterest, 0)}
        {s.unpaidMonths > 0 && <div style={{ fontSize: 10, color: 'var(--ink-400)', fontWeight: 400 }}>{s.unpaidMonths} เดือน</div>}
      </td>
      <td style={{ fontSize: 11.5, color: 'var(--ink-500)', whiteSpace: 'nowrap', textAlign: 'center' }}>
        {master.receiveDate ? fmtDate(master.receiveDate) : '—'}
      </td>
    </tr>
  );
}

// ── Payment confirmation popup ──────────────────────────────────────────────
function PaymentConfirmPopup({ open, selectedRows, master, onClose, onConfirm }) {
  const [payDate, setPayDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [note,    setNote]    = React.useState('');
  React.useEffect(() => {
    if (open) {
      setPayDate(new Date().toISOString().slice(0, 10));
      setNote('');
    }
  }, [open]);
  if (!open) return null;
  const total = (selectedRows || []).reduce((s, r) => s + interestRemaining(r), 0);
  return (
    <Modal
      open={open}
      maxWidth={520}
      title={`บันทึกการจ่ายดอกเบี้ย · ${selectedRows.length} เดือน`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={() => onConfirm({ payDate, note })}>
          <Icon name="check" size={14} /> ยืนยันการจ่าย {fmtNum(total, 2)}
        </button>
      </>}
    >
      <div style={{
        padding: 12, marginBottom: 14, borderRadius: 10,
        background: '#f0fdf4', border: '1px solid #86efac',
      }}>
        <div style={{ fontSize: 11.5, color: '#166534', marginBottom: 4 }}>สัญญา</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{master?.borrowerName} · <span style={{ fontFamily: 'ui-monospace' }}>{master?.contractNo}</span></div>
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span>จำนวนเดือนที่จ่าย</span>
          <strong>{selectedRows.length} เดือน</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
          <span>รวมจำนวนเงิน</span>
          <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{fmtNum(total, 2)}</strong>
        </div>
      </div>

      <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 14, border: '1px solid var(--ink-100)', borderRadius: 8 }}>
        <table className="tbl" style={{ width: '100%', fontSize: 11.5 }}>
          <thead><tr>
            <th>เดือน</th>
            <th style={{ textAlign: 'right' }}>ดอกเบี้ย</th>
          </tr></thead>
          <tbody>
            {(selectedRows || []).map(r => (
              <tr key={r.id}>
                <td>{TH_MONTH[Number(r.month)] || r.month} {r.year}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(interestRemaining(r), 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="field" style={{ marginBottom: 10 }}>
        <label>วันที่จ่ายจริง</label>
        <input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
      </div>
      <div className="field">
        <label>หมายเหตุ (ไม่บังคับ)</label>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น เลขอ้างอิงรับเงิน / ช่องทาง" />
      </div>
    </Modal>
  );
}

// ── จ่ายดอกเบี้ยรายเดือน (หลายรอบ / บางส่วน) ───────────────────────────────────
// เดือนเดียวจ่ายได้หลายรอบ (แต่ละรอบ = วันที่ + จำนวน + โน้ต) → เก็บใน row.payments[]
function InterestPaymentModal({ open, row, master, onClose, onSave }) {
  const [rounds, setRounds] = React.useState([]);
  React.useEffect(() => {
    if (open && row) {
      const existing = interestPayments(row).map(p => ({ date: p.date || '', amount: Number(p.amount) || 0, note: p.note || '' }));
      // เปิดครั้งแรก (ยังไม่มีรอบ) → ตั้งรอบเดียว = ยอดเต็ม + วันนี้ (จ่ายเต็มก็แค่กดบันทึก)
      setRounds(existing.length ? existing : [{ date: new Date().toISOString().slice(0, 10), amount: effectiveInterest(row) || '', note: '' }]);
    }
  }, [open, row]);
  if (!open || !row) return null;
  const eff  = effectiveInterest(row);
  const paid = rounds.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remaining = Math.max(0, eff - paid);
  const over = paid - eff;
  const pct  = eff > 0 ? Math.min(100, paid / eff * 100) : (rounds.length ? 100 : 0);
  const today = new Date().toISOString().slice(0, 10);
  const setR  = (i, k, v) => setRounds(rs => rs.map((p, idx) => idx === i ? { ...p, [k]: v } : p));
  const delR  = (i) => setRounds(rs => rs.filter((_, idx) => idx !== i));
  const addR  = (amt) => setRounds(rs => [...rs, { date: today, amount: amt != null ? amt : '', note: '' }]);
  const clean = rounds.filter(p => (Number(p.amount) || 0) > 0 && p.date);
  return (
    <Modal open={open} maxWidth={560}
      title={`จ่ายดอกเบี้ย · ${TH_MONTH[Number(row.month)] || row.month} ${row.year}`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={() => onSave(clean)}>
          <Icon name="check" size={14} /> บันทึก ({clean.length} รอบ)
        </button>
      </>}>
      <div style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 10, background: '#f8fafc', border: '1px solid var(--ink-100)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
          <span style={{ color: 'var(--ink-600)' }}>ดอกเบี้ยเดือนนี้</span>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtNum(eff, 2)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
          <span style={{ color: 'var(--ink-600)' }}>จ่ายแล้ว</span>
          <strong style={{ color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(paid, 2)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: 'var(--ink-600)' }}>{over > 0.005 ? 'จ่ายเกิน' : 'คงเหลือ'}</span>
          <strong style={{ fontVariantNumeric: 'tabular-nums', color: over > 0.005 ? '#b45309' : (remaining > 0.005 ? 'var(--bad)' : 'var(--ink-300)') }}>
            {fmtNum(over > 0.005 ? over : remaining, 2)}
          </strong>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--ink-100)', overflow: 'hidden', marginTop: 8 }}>
          <div style={{ height: '100%', width: pct + '%', background: remaining > 0.005 ? 'var(--good)' : 'var(--brand-500)', transition: 'width .2s' }} />
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>รอบการจ่าย</div>
      {rounds.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 7 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-400)', width: 16 }}>{i + 1}.</span>
          <input className="input" type="date" value={p.date} onChange={e => setR(i, 'date', e.target.value)} style={{ width: 148 }} />
          <DLCommaInput className="input" value={p.amount} onChange={v => setR(i, 'amount', v)} placeholder="จำนวน" style={{ width: 118, textAlign: 'right' }} />
          <input className="input" value={p.note} onChange={e => setR(i, 'note', e.target.value)} placeholder="โน้ต (เงินสด/โอน)" style={{ flex: 1, minWidth: 90 }} />
          <button onClick={() => delR(i)} title="ลบรอบนี้"
            style={{ display: 'inline-flex', padding: 6, borderRadius: 7, cursor: 'pointer', border: '1px solid #fecaca', background: '#fff', color: '#dc2626' }}>
            <Icon name="trash" size={12} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={() => addR(remaining > 0.005 ? remaining : null)} style={{ fontSize: 12.5 }}>
          <Icon name="plus" size={12} /> เพิ่มรอบจ่าย
        </button>
      </div>
      {over > 0.005 && <div style={{ marginTop: 8, fontSize: 11.5, color: '#b45309' }}>⚠️ ยอดรวมเกินดอกเบี้ยเดือนนี้ {fmtNum(over, 2)} — ตรวจอีกครั้งได้</div>}
    </Modal>
  );
}

// ── Interest override popup ─────────────────────────────────────────────────
function InterestOverridePopup({ open, row, onClose, onSave }) {
  const [val,  setVal]  = React.useState('');
  const [note, setNote] = React.useState('');
  React.useEffect(() => {
    if (open && row) {
      const cur = row.interestOverride != null && row.interestOverride !== ''
        ? row.interestOverride
        : (row.interestAmount || '');
      setVal(String(cur));
      setNote(row.overrideNote || '');
    }
  }, [open, row]);
  if (!open || !row) return null;
  const computed = Number(row.interestAmount) || 0;
  const next     = Number(val);
  const diff     = next - computed;
  return (
    <Modal
      open={open}
      maxWidth={460}
      title={`แก้ดอกเบี้ย · ${TH_MONTH[Number(row.month)] || row.month} ${row.year}`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        {row.interestOverride != null && row.interestOverride !== '' && (
          <button className="btn btn-ghost" onClick={() => onSave(null, '')}
            style={{ borderColor: '#fca5a5', color: '#991b1b', background: '#fef2f2' }}>
            ล้างค่า override
          </button>
        )}
        <button className="btn btn-primary" onClick={() => onSave(next, note)}
          disabled={!isFinite(next) || next < 0}>
          <Icon name="check" size={14} /> บันทึก
        </button>
      </>}
    >
      <div style={{ padding: 12, marginBottom: 12, borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12, color: 'var(--ink-700)' }}>
        ⚠️ ใช้เมื่อระบบคำนวณดอกเบี้ยมาให้ไม่ถูก — ระบบจะเก็บค่าที่คุณกรอกแทน และมาร์คว่าเป็น <strong>OVERRIDE</strong> เพื่อให้ตรวจย้อนหลังได้
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--ink-500)' }}>ดอกเบี้ยที่ระบบคำนวณ</label>
          <div style={{
            height: 32, borderRadius: 7, border: '1px solid var(--ink-100)',
            background: 'var(--ink-50)', padding: '0 9px',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            fontFamily: 'ui-monospace', fontSize: 13, fontWeight: 600, color: 'var(--ink-700)',
          }}>{fmtNum(computed, 2)}</div>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--ink-500)' }}>ผลต่าง</label>
          <div style={{
            height: 32, borderRadius: 7, padding: '0 9px',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            fontFamily: 'ui-monospace', fontSize: 13, fontWeight: 700,
            background: diff === 0 ? 'var(--ink-50)' : diff > 0 ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${diff === 0 ? 'var(--ink-100)' : diff > 0 ? '#fecaca' : '#86efac'}`,
            color: diff === 0 ? 'var(--ink-500)' : diff > 0 ? 'var(--bad)' : 'var(--good)',
          }}>{diff === 0 ? '—' : (diff > 0 ? '+' : '') + fmtNum(diff, 2)}</div>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>ดอกเบี้ยที่ถูกต้อง (บาท) *</label>
        <input className="input" type="number" step="0.01" value={val} onChange={e => setVal(e.target.value)}
          style={{ textAlign: 'right', fontFamily: 'ui-monospace', fontWeight: 600 }} />
      </div>
      <div className="field">
        <label>เหตุผล / อ้างอิง</label>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น ปรับตามใบรับเงินจริง / สัญญาฉบับใหม่" />
      </div>
    </Modal>
  );
}

// ใส่คอมม่าคั่นหลักพัน "โดยคงทศนิยมดิบไว้ตามที่พิมพ์" (ไม่ปัดเศษเหมือน fmtNum) — เช่น 10958.90 → 10,958.90
function dlCommaFmt(raw) {
  if (raw === '' || raw == null) return '';
  const s = String(raw);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [intp, decp] = body.split('.');
  const intFmt = (intp || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + (decp != null ? intFmt + '.' + decp : intFmt);
}

// ช่องกรอกเลขที่ "โชว์คอมม่าตอนไม่ได้พิมพ์ · เป็นเลขดิบตอนโฟกัส" — อ่านง่ายแต่แก้ไขง่าย
// value/onChange เป็นสตริงเลขดิบเสมอ (ไม่มีคอมม่าใน state) — parse ด้วย Number() ได้ตรง
function DLCommaInput({ value, onChange, ...rest }) {
  const [focused, setFocused] = React.useState(false);
  const raw = (value == null ? '' : String(value));
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={focused ? raw : dlCommaFmt(raw)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(e.target.value.replace(/[^0-9.\-]/g, ''))}
    />
  );
}

// ── เพิ่มแถวดอกเบี้ยรายเดือนด้วยมือ (safety net เผื่อ auto คิดตกหล่นบางเดือน) ──
function AddLedgerRowModal({ open, master, ledgerRows, onClose, onSave }) {
  const [year,   setYear]   = React.useState('');
  const [month,  setMonth]  = React.useState('');
  const [principal, setPrincipal] = React.useState('');
  const [ratePct, setRatePct] = React.useState('');
  const [days,   setDays]   = React.useState('');
  const [method, setMethod] = React.useState('ACT/365');
  const [interest, setInterest] = React.useState('');
  const [touched, setTouched] = React.useState(false); // ดอกเบี้ยถูกพิมพ์เองแล้วหรือยัง
  const [note,   setNote]   = React.useState('');

  React.useEffect(() => {
    if (!open || !master) return;
    const sorted = [...(ledgerRows || [])].sort((a, b) =>
      (Number(a.year) || 0) - (Number(b.year) || 0) || (Number(a.month) || 0) - (Number(b.month) || 0));
    const last = sorted[sorted.length - 1];
    // เดือน/ปี = เดือนถัดจากแถวสุดท้าย (เผื่อเติมเดือนท้ายที่ตกหล่น) · ไม่มีแถว → ใช้ปัจจุบัน (CE)
    let ny = last ? Number(last.year) : (new Date().getFullYear());
    let nm = last ? Number(last.month) + 1 : (new Date().getMonth() + 1);
    if (nm > 12) { nm = 1; ny += 1; }
    setYear(String(ny)); setMonth(String(nm));
    setPrincipal(String(last ? (Number(last.outstanding) || Number(last.principal) || masterBalance(master)) : masterBalance(master)));
    setRatePct(master.interestRate ? String((Number(master.interestRate) * 100)) : '');
    setDays('');
    setMethod((master.interestCalc && master.interestCalc.method) || 'ACT/365');
    setInterest(''); setTouched(false); setNote('');
  }, [open, master]);

  if (!open || !master) return null;

  const p = Number(principal) || 0;
  const rate = (Number(ratePct) || 0) / 100;
  const dnum = Number(days) || 0;
  const basis = _basisFor(method, year);
  const computed = p * rate * (dnum / basis);
  const effInterest = touched ? (Number(interest) || 0) : computed;
  const canSave = !!year && !!month && dnum > 0 && effInterest >= 0;

  return (
    <Modal
      open={open}
      maxWidth={560}
      title={`เพิ่มแถวดอกเบี้ยเอง · ${master.contractNo}`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={!canSave}
          onClick={() => onSave({
            year: Number(year), month: Number(month), principal: p,
            interestRate: rate, days: dnum, interest: effInterest,
            outstanding: p, note,
          })}>
          <Icon name="check" size={14} /> เพิ่มแถว {TH_MONTH[Number(month)] || month} {year}
        </button>
      </>}
    >
      <div style={{ padding: 12, marginBottom: 14, borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 12, color: 'var(--ink-700)', lineHeight: 1.6 }}>
        ➕ เพิ่มดอกเบี้ยของ <strong>1 เดือน</strong> เข้าตารางเอง — ใช้เมื่อคำนวณอัตโนมัติ<strong>คิดตกหล่น</strong> (เช่น เดือนท้ายที่คืนเงินช้ากว่าวันครบกำหนด)
        <br />กรอกวัน แล้วระบบคำนวณดอกเบี้ยให้ตามสูตร หรือจะพิมพ์ยอดเองก็ได้
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div className="field">
          <label>เดือน *</label>
          <select className="input" value={month} onChange={e => { setMonth(e.target.value); setTouched(false); }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
              <option key={m} value={m}>{TH_MONTH[m]}</option>)}
          </select>
        </div>
        <div className="field">
          <label>ปี (ค.ศ.) *</label>
          <input className="input" type="number" value={year} onChange={e => { setYear(e.target.value); setTouched(false); }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div className="field">
          <label>เงินต้น (บาท)</label>
          <DLCommaInput className="input" value={principal} onChange={v => { setPrincipal(v); setTouched(false); }}
            style={{ textAlign: 'right', fontFamily: 'ui-monospace' }} />
        </div>
        <div className="field">
          <label>อัตรา (%)</label>
          <input className="input" type="number" step="0.01" value={ratePct} onChange={e => { setRatePct(e.target.value); setTouched(false); }}
            style={{ textAlign: 'right', fontFamily: 'ui-monospace' }} />
        </div>
        <div className="field">
          <label>จำนวนวัน *</label>
          <input className="input" type="number" value={days} onChange={e => { setDays(e.target.value); setTouched(false); }}
            style={{ textAlign: 'right', fontFamily: 'ui-monospace' }} autoFocus />
        </div>
      </div>

      <div className="field" style={{ marginBottom: 10 }}>
        <label>วิธีคิด</label>
        <select className="input" value={method} onChange={e => { setMethod(e.target.value); setTouched(false); }}>
          {CALC_METHODS.map(m => <option key={m.k} value={m.k}>{m.label}</option>)}
        </select>
      </div>

      {/* สูตรคำนวณ + ดอกเบี้ยที่จะบันทึก */}
      <div style={{ padding: '10px 12px', borderRadius: 9, background: 'var(--ink-50)', border: '1px solid var(--ink-100)', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 6 }}>
          สูตร: {fmtNum(p, 0)} × {(rate * 100).toFixed(2)}% × {dnum || 0}/{basis} =
          <strong style={{ color: 'var(--brand-700)', marginLeft: 4, fontFamily: 'ui-monospace' }}>{fmtNum(computed, 2)}</strong>
          {touched && (
            <button type="button" onClick={() => { setInterest(''); setTouched(false); }}
              style={{ marginLeft: 8, fontSize: 10, padding: '1px 8px', borderRadius: 10, border: '1px solid var(--brand-300)', background: 'var(--brand-50)', color: 'var(--brand-700)', cursor: 'pointer' }}>
              ↺ ใช้ค่าที่คำนวณ
            </button>
          )}
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label style={{ fontSize: 11 }}>ดอกเบี้ยที่จะบันทึก (บาท) *</label>
          <DLCommaInput className="input"
            value={touched ? interest : computed.toFixed(2)}
            onChange={v => { setInterest(v); setTouched(true); }}
            style={{ textAlign: 'right', fontFamily: 'ui-monospace', fontWeight: 700 }} />
        </div>
      </div>

      <div className="field">
        <label>หมายเหตุ</label>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น ดอกเบี้ยช่วงคืนช้ากว่าครบกำหนด 29/11→2/12" />
      </div>
    </Modal>
  );
}

// ── Principal repayment / drawdown modal ────────────────────────────────────
// kind = 'repayment' (คืนเงินต้น — partial OK) | 'drawdown' (เบิกเพิ่ม)
function PrincipalEventModal({ open, kind, master, editEvent, onClose, onSave }) {
  const isEdit = !!editEvent;
  const [date,   setDate]   = React.useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = React.useState('');
  const [note,   setNote]   = React.useState('');
  const [closeContract, setCloseContract] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setDate(editEvent ? editEvent.eventDate : new Date().toISOString().slice(0, 10));
      setAmount(editEvent ? String(editEvent.amount) : '');
      setNote(editEvent ? (editEvent.note || '') : '');
      setCloseContract(false);
    }
  }, [open, master, kind, editEvent]);
  if (!open || !master) return null;
  const isRepay  = kind === 'repayment';
  // โหมดแก้ไข: ยอดคงเหลือ "ก่อน" ต้องหักผลของรายการนี้ออกก่อน (เพราะมันถูกรวมอยู่แล้ว)
  const curBal   = masterBalance(master);
  const balance  = isEdit
    ? Math.max(0, curBal + (editEvent.eventType === 'repayment' ? 1 : -1) * (Number(editEvent.amount) || 0))
    : curBal;
  const num      = Number(amount) || 0;
  const newBal   = isRepay ? Math.max(0, balance - num) : balance + num;
  const tooMuch  = isRepay && num > balance + 0.01;
  const wouldClose = !isEdit && isRepay && newBal === 0 && num > 0;

  const c = isRepay
    ? { color: '#15803d', bg: '#f0fdf4', border: '#86efac', label: 'คืนเงินต้น', icon: '💵', title: (isEdit ? 'แก้ไขการคืนเงินต้น' : 'บันทึกการคืนเงินต้น') }
    : { color: '#b45309', bg: '#fffbeb', border: '#fde68a', label: 'เบิกเงินกู้เพิ่ม', icon: '↑', title: (isEdit ? 'แก้ไขการเบิกเงินกู้เพิ่ม' : 'บันทึกการเบิกเงินกู้เพิ่ม (drawdown)') };

  return (
    <Modal
      open={open}
      maxWidth={520}
      title={c.title + ' · ' + master.contractNo}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={!num || tooMuch} onClick={() => onSave({ date, amount: num, note, kind, closeContract: closeContract || wouldClose })}>
          <Icon name="check" size={14} /> {isEdit ? 'บันทึกการแก้ไข' : 'บันทึก'} {c.label} {fmtNum(num, 2)}
        </button>
      </>}
    >
      <div style={{
        padding: 12, marginBottom: 14, borderRadius: 10,
        background: c.bg, border: `1px solid ${c.border}`,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>ยอดคงเหลือก่อน</div>
            <div style={{ fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(balance, 2)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: c.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.label}</div>
            <div style={{ fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums', color: c.color }}>
              {isRepay ? '−' : '+'}{fmtNum(num, 2)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>คงเหลือใหม่</div>
            <div style={{ fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums',
                          color: newBal === 0 ? 'var(--good)' : 'var(--ink-700)' }}>
              {fmtNum(newBal, 2)}
            </div>
          </div>
        </div>
      </div>

      {tooMuch && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '6px 12px', borderRadius: 7, fontSize: 12, marginBottom: 10 }}>
          ⚠️ จำนวนเงินที่คืนเกินกว่ายอดคงเหลือ ({fmtNum(balance, 2)}) — กรุณาตรวจสอบ
        </div>
      )}

      <div className="field" style={{ marginBottom: 10 }}>
        <label>วันที่ {isRepay ? 'จ่ายคืน' : 'เบิกเพิ่ม'}</label>
        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>จำนวนเงิน (บาท) *
          {isRepay && <button type="button"
            onClick={() => setAmount(String(balance))}
            style={{ marginLeft: 8, fontSize: 10, padding: '1px 8px', borderRadius: 10, border: '1px solid var(--brand-300)', background: 'var(--brand-50)', color: 'var(--brand-700)', cursor: 'pointer' }}>
            ปิดสัญญา (คืนทั้งหมด {fmtNum(balance, 0)})
          </button>}
        </label>
        <NumberInput className="input" autoFocus value={amount} digits={0}
          onChange={n => setAmount(n)}
          placeholder={isRepay ? `เช่น ${fmtNum(balance, 0)} หรือคืนแค่บางส่วน` : 'จำนวนที่ขอเบิกเพิ่ม'} />
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>หมายเหตุ / เลขอ้างอิง</label>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น เลขที่สลิป / ช่องทาง / เหตุผล" />
      </div>

      {isRepay && wouldClose && (
        <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#065f46', padding: '8px 12px', borderRadius: 7, fontSize: 12.5 }}>
          ℹ️ คืนทั้งหมดแล้ว — ระบบจะ <strong>ปิดสัญญาให้อัตโนมัติ</strong> (status = Close)
        </div>
      )}
      {!isEdit && isRepay && !wouldClose && num > 0 && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--ink-600)' }}>
          <input type="checkbox" checked={closeContract} onChange={e => setCloseContract(e.target.checked)} />
          ปิดสัญญาตอนนี้ด้วย (เช่น ตกลงปิดที่ยอดต่ำกว่าวงเงิน — ส่วนต่างถือเป็นการลดวงเงิน)
        </label>
      )}
      {isEdit && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1a592f', padding: '8px 12px', borderRadius: 7, fontSize: 12 }}>
          ℹ️ แก้ไขรายการที่คีย์ผิด — ระบบจะ <strong>คำนวณยอดคงเหลือเงินต้นใหม่</strong> จากทุกรายการให้อัตโนมัติ
        </div>
      )}
    </Modal>
  );
}

// ── Rollover modal — close current + create new contract(s) ─────────────────
// 3 modes:
//   transfer — เปลี่ยนชื่อผู้กู้  (1 new = old fields, new borrowerName)
//   resize   — ปรับวงเงิน        (1 new = reduced principal)
//   split    — แยกสัญญา          (N new, sum ≤ balance)
function RolloverModal({ open, master, onClose, onSave }) {
  const [mode, setMode] = React.useState('transfer');
  const [closeDate, setCloseDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = React.useState('');
  const [newContracts, setNewContracts] = React.useState([]);

  React.useEffect(() => {
    if (!open || !master) return;
    setMode('transfer');
    setCloseDate(new Date().toISOString().slice(0, 10));
    setReason('');
    // Seed from master
    const bal = masterBalance(master);
    const today = new Date().toISOString().slice(0, 10);
    setNewContracts([{
      contractNo:    (master.contractNo || '') + '-N',
      borrowerName:  master.borrowerName || '',
      principalAmount: bal,
      balance:       bal,
      interestRate:  master.interestRate || 0,
      receiveDate:   today,
      startDate:     today,
      maturityDate:  '',
      currency:      master.currency || 'THB',
      bankName:      master.bankName || '',
      projectCode:   master.projectCode || '',
      projectName:   master.projectName || '',
      debtCategory:  master.debtCategory || 'อื่นๆ',
      facilityType:  master.facilityType || '',
      note:          '',
    }]);
  }, [open, master]);

  // When user changes mode, reset newContracts appropriately
  const changeMode = (newMode) => {
    if (!master) return;
    const bal = masterBalance(master);
    const today = new Date().toISOString().slice(0, 10);
    const oldFacility = master.facilityType || '';
    const base = {
      interestRate:  master.interestRate || 0,
      receiveDate:   today,
      startDate:     today,
      maturityDate:  '',
      currency:      master.currency || 'THB',
      bankName:      master.bankName || '',
      projectCode:   master.projectCode || '',
      projectName:   master.projectName || '',
      debtCategory:  master.debtCategory || 'อื่นๆ',
      facilityType:  oldFacility,
      note:          '',
    };
    if (newMode === 'transfer') {
      setNewContracts([{
        ...base,
        contractNo:   (master.contractNo || '') + '-T',
        borrowerName: '',     // user fills new name
        principalAmount: bal, balance: bal,
      }]);
    } else if (newMode === 'resize') {
      setNewContracts([{
        ...base,
        contractNo:   (master.contractNo || '') + '-R',
        borrowerName: master.borrowerName || '',
        principalAmount: bal, balance: bal,
      }]);
    } else if (newMode === 'convert') {
      // PE → POST (or any facility swap): same borrower, same principal, change facilityType
      const guessNew = oldFacility === 'PE' ? 'POST' : (oldFacility === 'POST' ? 'PE' : '');
      setNewContracts([{
        ...base,
        contractNo:   (master.contractNo || '').replace(/-(PE|POST|OD|PN|LG|TR|LC|TL)$/i, '') + (guessNew ? '-' + guessNew : '-NEW'),
        borrowerName: master.borrowerName || '',
        principalAmount: bal, balance: bal,
        facilityType: guessNew,
      }]);
    } else {
      // split → 2 contracts default
      const half = Math.round(bal / 2);
      setNewContracts([
        { ...base, contractNo: (master.contractNo || '') + '-A', borrowerName: master.borrowerName || '',
          principalAmount: half, balance: half },
        { ...base, contractNo: (master.contractNo || '') + '-B', borrowerName: master.borrowerName || '',
          principalAmount: bal - half, balance: bal - half },
      ]);
    }
    setMode(newMode);
  };

  if (!open || !master) return null;
  const oldBalance = masterBalance(master);
  const sumNew = newContracts.reduce((s, c) => s + (Number(c.principalAmount) || 0), 0);
  const diff = sumNew - oldBalance;
  const tooMuch = diff > 0.01;

  const updateContract = (idx, patch) => {
    setNewContracts(arr => arr.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };
  const removeContract = (idx) => setNewContracts(arr => arr.filter((_, i) => i !== idx));
  const addContract = () => {
    setNewContracts(arr => [...arr, {
      ...arr[arr.length - 1],
      contractNo:   (master.contractNo || '') + '-' + String.fromCharCode(65 + arr.length),
      principalAmount: 0, balance: 0,
    }]);
  };

  const allValid = newContracts.every(c =>
    c.contractNo.trim() && c.borrowerName.trim() && Number(c.principalAmount) > 0
  ) && !tooMuch && newContracts.length >= 1;

  const modeOptions = [
    { k: 'convert',  icon: '🔁', title: 'แปลงประเภทวงเงิน', desc: 'ปิดสัญญาเดิม → ทำสัญญาใหม่ เปลี่ยนประเภทวงเงิน (เช่น PE → POST)' },
    { k: 'transfer', icon: '👥', title: 'เปลี่ยนชื่อ',       desc: 'ปิดสัญญาเดิม → ทำสัญญาใหม่ในชื่อคนอื่น (วงเงินเท่าเดิม)' },
    { k: 'resize',   icon: '📉', title: 'ปรับวงเงิน',       desc: 'ปิดสัญญาเดิม → ทำสัญญาใหม่ด้วยวงเงินที่ลดลง' },
    { k: 'split',    icon: '✂️', title: 'แยกสัญญา',          desc: 'ปิดสัญญาเดิม → แยกเป็น 2 สัญญาขึ้นไป' },
  ];

  return (
    <Modal
      open={open}
      wide
      maxWidth={1000}
      title={`ปิด/ทำสัญญาใหม่ · ${master.contractNo}`}
      onClose={onClose}
      footer={<>
        <span style={{ marginRight: 'auto', fontSize: 11.5, color: tooMuch ? 'var(--bad)' : 'var(--ink-500)' }}>
          วงเงินเดิม <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtNum(oldBalance, 0)}</strong> ·
          วงเงินรวมใหม่ <strong style={{ fontVariantNumeric: 'tabular-nums', color: tooMuch ? 'var(--bad)' : 'var(--ink-700)' }}>{fmtNum(sumNew, 0)}</strong>
          {diff !== 0 && (
            <span style={{ marginLeft: 6, color: diff < 0 ? 'var(--good)' : 'var(--bad)' }}>
              ({diff > 0 ? '+' : ''}{fmtNum(diff, 0)})
            </span>
          )}
        </span>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={!allValid}
          onClick={() => onSave({ mode, closeDate, reason, newContracts })}>
          <Icon name="check" size={14} /> ปิดสัญญาเดิม + สร้าง {newContracts.length} สัญญาใหม่
        </button>
      </>}
    >
      {/* Mode selector */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>1. เลือกประเภทการปรับสัญญา</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {modeOptions.map(o => {
            const active = mode === o.k;
            return (
              <button key={o.k} onClick={() => changeMode(o.k)}
                style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                  border: `2px solid ${active ? 'var(--brand-500)' : 'var(--ink-100)'}`,
                  background: active ? 'color-mix(in oklch, var(--brand-500) 7%, transparent)' : '#fff',
                }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{o.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: active ? 'var(--brand-700)' : 'var(--ink-700)' }}>{o.title}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 3 }}>{o.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Old contract preview */}
      <div style={{
        padding: '10px 14px', borderRadius: 10, marginBottom: 14,
        background: '#fef2f2', border: '1px solid #fecaca',
      }}>
        <div style={{ fontSize: 11, color: '#991b1b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
          ⊘ จะปิดสัญญาเดิม
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><strong style={{ fontFamily: 'ui-monospace' }}>{master.contractNo}</strong></div>
          {master.facilityType && <FacilityChip type={master.facilityType} />}
          <div>{master.borrowerName}</div>
          <div>วงเงิน {fmtNum(Number(master.principalAmount) || 0, 0)}</div>
          <div>คงเหลือ <strong>{fmtNum(oldBalance, 0)}</strong></div>
          <div>อัตรา {((Number(master.interestRate) || 0) * 100).toFixed(2)}%/ปี</div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>วันที่ปิดสัญญา</label>
            <input className="input" type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>เหตุผลการปิด</label>
            <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="เช่น ครบกำหนด ทำสัญญาใหม่" />
          </div>
        </div>
      </div>

      {/* New contracts */}
      <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        2. สัญญาใหม่ ({newContracts.length} สัญญา)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {newContracts.map((c, i) => (
          <div key={i} style={{
            padding: 12, borderRadius: 10, background: '#f0fdf4', border: '1px solid #86efac',
            position: 'relative',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: '#166534' }}>
                ✚ สัญญาใหม่ #{i + 1}
              </span>
              <div style={{ flex: 1 }} />
              {newContracts.length > 1 && (
                <button onClick={() => removeContract(i)}
                  style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12, cursor: 'pointer',
                           border: '1px solid #fca5a5', background: '#fff', color: '#991b1b' }}>
                  ลบ
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>เลขที่สัญญา *</label>
                <input className="input" value={c.contractNo} onChange={e => updateContract(i, { contractNo: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>
                  ประเภทวงเงิน
                  {mode === 'convert' && master.facilityType && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ink-500)' }}>
                      (เดิม <strong style={{ color: FACILITY_META[master.facilityType]?.color }}>{master.facilityType}</strong>)
                    </span>
                  )}
                </label>
                <select className="select input" value={c.facilityType || ''}
                  onChange={e => updateContract(i, { facilityType: e.target.value })}
                  style={mode === 'convert' ? {
                    borderColor: c.facilityType && c.facilityType !== master.facilityType ? FACILITY_META[c.facilityType]?.color : 'var(--ink-200)',
                    background: c.facilityType && c.facilityType !== master.facilityType ? FACILITY_META[c.facilityType]?.bg : '#fff',
                    fontWeight: 700,
                  } : undefined}>
                  <option value="">— เลือกประเภท —</option>
                  {FACILITY_TYPES.map(t => (
                    <option key={t} value={t}>{t}{FACILITY_META[t]?.full ? ` · ${FACILITY_META[t].full}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>ผู้กู้ / เจ้าหนี้ *</label>
                <input className="input" value={c.borrowerName} onChange={e => updateContract(i, { borrowerName: e.target.value })} placeholder={mode === 'transfer' ? 'ชื่อผู้กู้ใหม่' : ''} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>วงเงิน (Principal) *</label>
                <NumberInput className="input" value={c.principalAmount} digits={0}
                  onChange={n => updateContract(i, { principalAmount: n, balance: n })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>ดอกเบี้ย/ปี (พิมพ์ 7 = 7%)</label>
                <PercentInput className="input" value={c.interestRate}
                  onChange={v => updateContract(i, { interestRate: v })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>ครบกำหนด</label>
                <input className="input" type="date" value={c.maturityDate}
                  onChange={e => updateContract(i, { maturityDate: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>วันรับเงิน</label>
                <input className="input" type="date" value={c.receiveDate}
                  onChange={e => updateContract(i, { receiveDate: e.target.value, startDate: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0, gridColumn: 'span 2' }}>
                <label>หมายเหตุ</label>
                <input className="input" value={c.note} onChange={e => updateContract(i, { note: e.target.value })} placeholder="ไม่บังคับ" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {mode === 'split' && (
        <button onClick={addContract}
          style={{ marginTop: 10, padding: '6px 14px', borderRadius: 18, cursor: 'pointer',
                   border: '1.5px dashed var(--brand-400)', background: 'var(--brand-50)', color: 'var(--brand-700)',
                   fontSize: 12, fontWeight: 600 }}>
          <Icon name="plus" size={11} /> เพิ่มสัญญาใหม่
        </button>
      )}

      {tooMuch && (
        <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '8px 12px', borderRadius: 7, fontSize: 12 }}>
          ⚠️ วงเงินรวมใหม่ ({fmtNum(sumNew, 0)}) <strong>เกิน</strong> ยอดคงเหลือเดิม ({fmtNum(oldBalance, 0)}) — ต้องไม่เกิน
        </div>
      )}
    </Modal>
  );
}

// ── Shared mutation hook — used by both pages ───────────────────────────────
function useDebtContractActions(setData, toast) {
  const session = (() => {
    try { return JSON.parse(localStorage.getItem('bio-session') || 'null'); } catch (_) { return null; }
  })();
  const username = (session && session.username) || '';

  const syncAfter = (updated) => {
    if (updated && WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(updated), 0);
  };

  return {
    // จ่ายพร้อมกันหลายเดือน (เร็ว) — เติมรอบ "ส่วนที่เหลือ" ให้แต่ละเดือนจนครบ (รองรับเดือนที่จ่ายบางส่วนไว้แล้ว)
    savePayments(rows, { payDate, note }) {
      if (!rows.length) return;
      const ids = new Set(rows.map(r => r.id));
      const at  = new Date().toISOString();
      let updated;
      setData(d => {
        const next = (d.debtLedger || []).map(r => {
          if (!ids.has(r.id)) return r;
          const existing = (Array.isArray(r.payments) && r.payments.length)
            ? r.payments.slice()
            : (r.paymentDate ? [{ date: r.paymentDate, amount: effectiveInterest(r), note: r.paymentNote || '', by: r.paidBy || '', at: r.paidAt || '' }] : []);
          const rem = Math.max(0, effectiveInterest(r) - existing.reduce((s, p) => s + (Number(p.amount) || 0), 0));
          if (rem > 0.005) existing.push({ date: payDate, amount: rem, note: note || '', by: username, at });
          return { ...r, payments: existing, paymentDate: payDate, paidBy: username, paidAt: at, paymentNote: note || r.paymentNote || '' };
        });
        updated = { ...d, debtLedger: next };
        return updated;
      });
      syncAfter(updated);
      toast(`บันทึกจ่ายดอกเบี้ย ${rows.length} เดือนแล้ว`);
    },
    // จ่ายดอกเบี้ยเดือนเดียวแบบหลายรอบ/บางส่วน — payments = [{date, amount, note}]
    // ถ้ารวมครบยอด → set paymentDate = วันรอบสุดท้าย (เข้าแท็บ "จ่ายแล้ว"); ถ้ายังไม่ครบ → paymentDate ว่าง (ค้างจ่าย)
    saveInterestPayments(row, payments) {
      const at = new Date().toISOString();
      const clean = (payments || [])
        .map(p => ({ date: p.date || '', amount: Number(p.amount) || 0, note: (p.note || '').trim(), by: p.by || username, at: p.at || at }))
        .filter(p => p.amount > 0 && p.date)
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const eff  = effectiveInterest(row);
      const paid = clean.reduce((s, p) => s + p.amount, 0);
      const full = eff > 0.005 ? paid >= eff - 0.005 : clean.length > 0;
      const lastDate = clean.length ? clean[clean.length - 1].date : '';
      let updated;
      setData(d => {
        const next = (d.debtLedger || []).map(r => r.id === row.id ? {
          ...r, payments: clean,
          paymentDate: full ? lastDate : '',
          paidBy:      full ? username : '',
          paidAt:      full ? at : '',
          paymentNote: full ? (clean.length ? clean[clean.length - 1].note : (r.paymentNote || '')) : (r.paymentNote || ''),
        } : r);
        updated = { ...d, debtLedger: next };
        return updated;
      });
      syncAfter(updated);
      toast(full ? 'บันทึกจ่ายดอกเบี้ยครบแล้ว'
                 : (paid > 0 ? `บันทึกจ่ายบางส่วน · คงเหลือ ${fmtNum(Math.max(0, eff - paid), 2)}` : 'ล้างการจ่ายแล้ว'));
    },
    clearPayment(row) {
      let updated;
      setData(d => {
        const next = (d.debtLedger || []).map(r =>
          r.id === row.id ? { ...r, payments: [], paymentDate: '', paidBy: '', paidAt: '', paymentNote: '' } : r
        );
        updated = { ...d, debtLedger: next };
        return updated;
      });
      syncAfter(updated);
      toast('ล้างสถานะการจ่ายแล้ว');
    },
    overrideInterest(row, value, note) {
      const at  = new Date().toISOString();
      let updated;
      setData(d => {
        const next = (d.debtLedger || []).map(r => {
          if (r.id !== row.id) return r;
          if (value == null || value === '') {
            const { interestOverride, overrideBy, overrideAt, overrideNote, ...rest } = r;
            return rest;
          }
          return { ...r, interestOverride: Number(value), overrideBy: username, overrideAt: at, overrideNote: note || '' };
        });
        updated = { ...d, debtLedger: next };
        return updated;
      });
      syncAfter(updated);
      toast(value == null ? 'ล้าง override แล้ว' : 'บันทึก override แล้ว');
    },
    addPrincipalEvent(master, { date, amount, note, kind, closeContract }) {
      const at = new Date().toISOString();
      const evRow = {
        id: WTPData.newId(), contractId: master.id, contractNo: master.contractNo,
        eventType: kind, eventDate: date, amount: Number(amount) || 0, note: note || '',
        recordedBy: username, recordedAt: at,
      };
      let updated, closedFlag = false;
      setData(d => {
        const events = [...(d.debtEvents || []), evRow];
        const masters = (d.debtMaster || []).map(m => {
          if (m.id !== master.id) return m;
          const newBal = recalcBalance(m, events);
          const shouldClose = closeContract || (kind === 'repayment' && newBal === 0 && Number(amount) > 0);
          closedFlag = shouldClose;
          const patch = { ...m, balance: newBal };
          if (shouldClose) {
            patch.status = 'Close';
            patch.closedDate = date;
            patch.closedReason = kind === 'repayment' ? 'คืนเงินต้นครบ' : (m.closedReason || '');
          }
          return patch;
        });
        updated = { ...d, debtEvents: events, debtMaster: masters };
        return updated;
      });
      syncAfter(updated);
      const action = kind === 'repayment' ? 'คืนเงินต้น' : 'เบิกเงินกู้เพิ่ม';
      toast(closedFlag ? `${action} ${fmtNum(amount, 0)} + ปิดสัญญาแล้ว` : `${action} ${fmtNum(amount, 0)} แล้ว`);
    },
    // แก้ไขรายการรับ/คืนเงินกู้ที่คีย์ผิด — คำนวณยอดคงเหลือใหม่จาก events ทั้งหมด
    editPrincipalEvent(eventId, master, { date, amount, note, kind }) {
      const at = new Date().toISOString();
      let updated;
      setData(d => {
        const events = (d.debtEvents || []).map(e =>
          e.id === eventId
            ? { ...e, eventType: kind, eventDate: date, amount: Number(amount) || 0,
                note: note || '', editedBy: username, editedAt: at }
            : e
        );
        const masters = (d.debtMaster || []).map(m => {
          if (m.id !== master.id && m.contractNo !== master.contractNo) return m;
          const newBal = recalcBalance(m, events);
          const patch = { ...m, balance: newBal };
          // เปิดสัญญากลับถ้าเคยปิดเพราะคืนครบ แต่ตอนนี้ยังมียอดคงเหลือ
          if (newBal > 0 && m.status === 'Close' && m.closedReason === 'คืนเงินต้นครบ') {
            patch.status = 'Active'; patch.closedDate = ''; patch.closedReason = '';
          }
          return patch;
        });
        updated = { ...d, debtEvents: events, debtMaster: masters };
        return updated;
      });
      syncAfter(updated);
      toast('แก้ไขรายการแล้ว — คำนวณยอดคงเหลือใหม่ให้อัตโนมัติ');
    },
    // ลบรายการรับ/คืนเงินกู้ — คำนวณยอดคงเหลือใหม่
    deletePrincipalEvent(eventId, master) {
      let updated;
      setData(d => {
        const events = (d.debtEvents || []).filter(e => e.id !== eventId);
        const masters = (d.debtMaster || []).map(m => {
          if (m.id !== master.id && m.contractNo !== master.contractNo) return m;
          const newBal = recalcBalance(m, events);
          const patch = { ...m, balance: newBal };
          if (newBal > 0 && m.status === 'Close' && m.closedReason === 'คืนเงินต้นครบ') {
            patch.status = 'Active'; patch.closedDate = ''; patch.closedReason = '';
          }
          return patch;
        });
        updated = { ...d, debtEvents: events, debtMaster: masters };
        return updated;
      });
      syncAfter(updated);
      toast('ลบรายการแล้ว — คำนวณยอดคงเหลือใหม่ให้อัตโนมัติ');
    },
    // ลบแถวดอกเบี้ยรายเดือน (เช่น แถวยอด 0 / คืนเงินต้น ที่ไม่ควรมี)
    deleteLedgerRow(row) {
      let updated;
      setData(d => {
        const next = (d.debtLedger || []).filter(r => r.id !== row.id);
        updated = { ...d, debtLedger: next };
        return updated;
      });
      syncAfter(updated);
      toast('ลบแถวดอกเบี้ยแล้ว');
    },
    // เพิ่มแถวดอกเบี้ยรายเดือน "ด้วยมือ" (safety net — เผื่อ auto คิดตกหล่นบางเดือน
    // เช่น เดือนท้ายที่คืนช้ากว่าครบกำหนดแล้วยังไม่ได้บันทึกวันคืน) — insert แถวเดียว id ใหม่
    // (ปลอดภัยกับเกราะกัน mass-delete: ไม่ได้แจก id ใหม่ทั้งชุด)
    addLedgerRow(master, row) {
      const at = new Date().toISOString();
      const nr = {
        id: WTPData.newId(),
        contractNo: master.contractNo, contractId: master.id,   // ผูก id ด้วย → แก้ชื่อสัญญาแล้วไม่หลุด
        year: Number(row.year) || 0, month: Number(row.month) || 0,
        principal: Number(row.principal) || 0,
        interestRate: Number(row.interestRate) || 0,
        days: Number(row.days) || 0,
        interestAmount: Number(row.interest) || 0,
        outstanding: Number(row.outstanding) || 0,
        paymentDate: '', paidBy: '', paidAt: '', paymentNote: row.note || '',
        manual: true, addedBy: username, addedAt: at,
      };
      let updated;
      setData(d => {
        updated = { ...d, debtLedger: [...(d.debtLedger || []), nr] };
        return updated;
      });
      syncAfter(updated);
      toast(`เพิ่มแถวดอกเบี้ย ${TH_MONTH[nr.month] || nr.month} ${nr.year} แล้ว`);
    },
    // ซ่อมรายการดอกเบี้ยกำพร้า — ย้ายแถวที่หลุดจากสัญญา (contractNo เดิมไม่ match ใครแล้ว)
    // กลับเข้าสัญญาที่ผู้ใช้เลือก · upsert id เดิม + set contractNo/contractId ใหม่ (ไม่ลบอะไร
    // → ปลอดภัยกับเกราะกัน mass-delete). pairs: [{ oldNo, masterId }]
    relinkOrphans(pairs) {
      const at = new Date().toISOString();
      let updated, n = 0;
      setData(d => {
        const masters = d.debtMaster || [];
        const byId = new Map(masters.map(m => [m.id, m]));
        const map = new Map((pairs || []).map(p => [p.oldNo, p.masterId]));
        const next = (d.debtLedger || []).map(r => {
          // เฉพาะแถวที่ "ยังกำพร้าจริง" ณ ตอนนี้ + อยู่ในกลุ่มที่ผู้ใช้ยืนยัน (กันแก้ผิดแถว)
          const stillOrphan = !masters.some(m => debtRowMatchesContract(r, m));
          const tid = map.get(r.contractNo);
          if (stillOrphan && tid && byId.has(tid)) {
            const tgt = byId.get(tid); n++;
            return { ...r, contractNo: tgt.contractNo, contractId: tgt.id, relinkedBy: username, relinkedAt: at };
          }
          return r;
        });
        updated = { ...d, debtLedger: next };
        return updated;
      });
      if (!n) { toast('ไม่มีแถวที่ต้องย้าย'); return; }
      syncAfter(updated);
      toast(`ย้าย ${n} แถวกลับเข้าสัญญาแล้ว`);
    },
    // เปิด/อัปเดต "คำนวณอัตโนมัติ" ให้สัญญา — migrate คืนเงินต้นจาก marker เข้า events
    // + สร้างตารางดอกเบี้ยใหม่ (materialize) ถึงเดือนปัจจุบัน โดยคงสถานะจ่าย/override เดิมไว้
    adoptAutoMode(master, ledgerRows, cfg) {
      const at = new Date().toISOString();
      const today = new Date().toISOString().slice(0, 10);
      let updated, msg = '';
      setData(d => {
        const existing = (d.debtEvents || []).filter(e => e.contractId === master.id || e.contractNo === master.contractNo);
        let events = d.debtEvents || [];
        let migratedCount = 0;
        if (!existing.length) {
          const ex = extractEventsFromLedger(ledgerRows || [], master).map(e => ({
            ...e, id: WTPData.newId(), recordedBy: username, recordedAt: at, migratedFrom: 'ledger',
          }));
          migratedCount = ex.length;
          events = [...events, ...ex];
        }
        const mNow = (d.debtMaster || []).find(m => m.id === master.id) || master;
        const newBal = recalcBalance(mNow, events);
        // วันจบ: Active → ไม่ cap (เดินถึงเดือนปัจจุบัน) · Close → วันคืนจริง (ช้าสุด) ไม่ใช่แค่ครบกำหนด
        // — คืนช้ากว่าครบกำหนดต้องเดินดอกต่อถึงวันคืนจริง (helper เดียวกับแผงเทียบ → พรีวิว = ผลจริง)
        const cap = mNow.status !== 'Active' ? _closedEndDate(mNow, events, ledgerRows) : null;
        const sched = buildAutoSchedule({ ...mNow, balance: newBal }, events, today, { method: cfg.method, dayCount: cfg.dayCount, endCap: cap });
        // SAFETY: ถ้าคำนวณไม่ได้/ไม่มีแถว → ยกเลิก ไม่แตะข้อมูลเดิม (กันตารางหาย)
        if (sched.error || !sched.rows.length) { msg = 'ERR:' + (sched.error || 'ไม่มีงวดที่คำนวณได้'); updated = null; return d; }
        // เก็บสถานะจ่าย/override เดิมรายเดือน (แถว interest จริง — ไม่เอา marker) + คิว id เดิมรายเดือน
        // ★ ต้องใช้ id เดิมซ้ำ (แถวใหม่ = update ทับที่เดิม) ห้ามแจก newId() รัวทั้งตาราง —
        //   ไม่งั้น diff ของ sync = ลบเก่าทั้งหมด + เพิ่มใหม่ทั้งหมด แล้วโดน "เกราะกัน mass-delete"
        //   ใน data_supabase.pushDiff ปัด deleteIds ทิ้งเงียบ ๆ (เงื่อนไข: ลบ > max(8, 50% ของทั้งตาราง))
        //   ส่วน upsert ยังไหลต่อ → แถวเก่าค้างบน server + แถวใหม่เข้าไป = ตารางดอกเบี้ยเบิ้ล 2 เท่า
        //   (โดนจริงมาแล้ว: สัญญาที่แถวเป็นเกินครึ่งของทั้ง debtLedger → 37 แถว กลายเป็น 74)
        const oldByMonth = {};
        const idPool = {};
        (ledgerRows || []).forEach(r => {
          const isMarker = /คืนเงิน|เบิก|ชำระต้น/.test(String(r.note || r.paymentNote || ''));
          if (isMarker) return;
          const k = `${r.year}-${r.month}`;
          if (!oldByMonth[k] || r.paymentDate) oldByMonth[k] = r;
          if (r.id) (idPool[k] || (idPool[k] = [])).push(r.id);
        });
        const newRows = sched.rows.map(row => {
          const k = `${row.year}-${row.month}`;
          const old = oldByMonth[k] || {};
          const pool = idPool[k];
          const nr = {
            // เดือนเดิมมีอยู่แล้ว → ใช้ id เดิม (เดือนที่แตกหลายแถวก็หยิบจากคิวทีละใบ) · ไม่มีค่อยออกใหม่
            id: (pool && pool.length) ? pool.shift() : WTPData.newId(),
            contractNo: master.contractNo, contractId: master.id,   // ผูก id ด้วย → แก้ชื่อสัญญาแล้วไม่หลุด
            year: row.year, month: row.month,
            principal: row.principal, interestRate: Number(mNow.interestRate) || 0,
            days: row.days, interestAmount: row.interest, outstanding: row.balanceAfter,
            paymentDate: old.paymentDate || '', paidBy: old.paidBy || '', paidAt: old.paidAt || '', paymentNote: old.paymentNote || '',
            auto: true,
          };
          if (old.interestOverride != null && old.interestOverride !== '') {
            nr.interestOverride = old.interestOverride; nr.overrideBy = old.overrideBy || '';
            nr.overrideAt = old.overrideAt || ''; nr.overrideNote = old.overrideNote || '';
          }
          return nr;
        });
        const otherRows = (d.debtLedger || []).filter(r => !debtRowMatchesContract(r, master));
        const masters = (d.debtMaster || []).map(m => m.id === master.id
          ? { ...m, balance: newBal, interestCalc: { method: cfg.method, dayCount: cfg.dayCount, autoMode: true, adoptedBy: username, adoptedAt: at } }
          : m);
        msg = `เปิดคำนวณอัตโนมัติ · ${newRows.length} เดือน` + (migratedCount ? ` · นำเข้าคืนเงินต้น ${migratedCount} รายการ` : '');
        updated = { ...d, debtEvents: events, debtLedger: [...otherRows, ...newRows], debtMaster: masters };
        return updated;
      });
      if (msg.startsWith('ERR:')) { toast('เปิด auto ไม่ได้: ' + msg.slice(4)); return; }
      syncAfter(updated);
      toast(msg);
    },
    // บันทึกฟิลด์ข้อมูลสัญญา (เช่น วันเริ่ม/วันครบ/อัตรา/เงินต้น ที่ขาด)
    saveMasterFields(master, patch) {
      const at = new Date().toISOString();
      let updated;
      setData(d => {
        const masters = (d.debtMaster || []).map(m => m.id === master.id
          ? { ...m, ...patch, editedBy: username, editedAt: at } : m);
        let ledger = d.debtLedger, events = d.debtEvents;
        // cascade: contractNo เปลี่ยน → อัปเดตรายการลูก (ledger + events) ให้ผูกถูกทั้ง contractNo + contractId
        // ไม่งั้นรายการเดิมกลายเป็น orphan (ตารางดอกเบี้ยหาย) — ต้นเหตุที่โดนมา
        if (patch && patch.contractNo && patch.contractNo !== master.contractNo) {
          const oldNo = master.contractNo, newNo = patch.contractNo, cid = master.id;
          const relink = (arr) => (arr || []).map(r =>
            (r.contractId === cid || r.contractNo === oldNo) ? { ...r, contractNo: newNo, contractId: cid } : r);
          ledger = relink(d.debtLedger);
          events = relink(d.debtEvents);
        }
        updated = { ...d, debtMaster: masters, debtLedger: ledger, debtEvents: events };
        return updated;
      });
      syncAfter(updated);
      toast('บันทึกข้อมูลสัญญาแล้ว');
    },
    // ปิดโหมดอัตโนมัติ (กลับเป็นแก้มือ) — คงตารางที่คำนวณไว้ แค่หยุด auto
    setAutoMode(master, on) {
      let updated;
      setData(d => {
        const masters = (d.debtMaster || []).map(m => m.id === master.id
          ? { ...m, interestCalc: { ...(m.interestCalc || {}), autoMode: !!on } }
          : m);
        updated = { ...d, debtMaster: masters };
        return updated;
      });
      syncAfter(updated);
      toast(on ? 'เปิดคำนวณอัตโนมัติ' : 'ปิดคำนวณอัตโนมัติ (กลับเป็นแก้มือ)');
    },
    // ปิด/เปิดสัญญาด้วยตนเอง — สำหรับสัญญาที่คืนครบแต่ status ค้าง Active
    // (เช่น คืนเงินต้นถูกเก็บเป็น ledger marker เก่า ไม่มีใน events → auto-close ไม่ทำงาน)
    setContractStatus(master, newStatus, opts) {
      opts = opts || {};
      const at = new Date().toISOString();
      const today = at.slice(0, 10);
      let updated;
      setData(d => {
        const masters = (d.debtMaster || []).map(m => {
          if (m.id !== master.id) return m;
          if (newStatus === 'Close') {
            return { ...m, status: 'Close',
              closedDate: opts.closedDate || m.closedDate || today,
              closedReason: opts.reason || m.closedReason || 'ปิดด้วยตนเอง',
              closedBy: username, closedAt: at };
          }
          // เปิดกลับเป็น Active — ล้างข้อมูลการปิด
          return { ...m, status: 'Active', closedDate: '', closedReason: '', closedBy: '', closedAt: '' };
        });
        updated = { ...d, debtMaster: masters };
        return updated;
      });
      syncAfter(updated);
      toast(newStatus === 'Close' ? 'ปิดสัญญาแล้ว' : 'เปิดสัญญากลับเป็น Active แล้ว');
    },
    doRollover(master, { mode, closeDate, reason, newContracts }) {
      const at = new Date().toISOString();
      const newRows = newContracts.map(c => ({
        ...c,
        id: WTPData.newId(),
        status: 'Active',
        principalAmount: Number(c.principalAmount) || 0,
        balance: Number(c.balance || c.principalAmount) || 0,
        interestRate: Number(c.interestRate) || 0,
        linkedFromContract: master.contractNo,
        linkedFromContractId: master.id,
        createdAt: at, createdBy: username,
      }));
      const newContractNos = newRows.map(r => r.contractNo).join(', ');
      // Auto-build closedReason
      const autoReason = (() => {
        if (mode === 'convert') {
          const from = master.facilityType || '?';
          const tos = [...new Set(newRows.map(r => r.facilityType || '?'))].join(', ');
          return `แปลงประเภทวงเงิน ${from} → ${tos}`;
        }
        return { transfer: 'เปลี่ยนชื่อ/โอนสิทธิ', resize: 'ปรับวงเงิน', split: 'แยกสัญญา' }[mode] || 'ทำสัญญาใหม่';
      })();
      let updated;
      setData(d => {
        const list = d.debtMaster || [];
        const patchedOld = list.map(m => m.id === master.id ? {
          ...m,
          status: 'Close',
          closedDate: closeDate,
          closedReason: reason || autoReason,
          linkedToContracts: newContractNos,
          closedBy: username, closedAt: at,
        } : m);
        updated = { ...d, debtMaster: [...newRows, ...patchedOld] };
        return updated;
      });
      syncAfter(updated);
      toast(`ปิดสัญญา ${master.contractNo} + สร้างสัญญาใหม่ ${newRows.length} รายการ`);
    },
  };
}

// ── Excel number-format helper — apply a format string to columns in a row range
const FMT_MONEY = '#,##0.00';   // ดอกเบี้ย (ทศนิยม 2)
const FMT_BAHT  = '#,##0';      // เงินต้น (ไม่มีทศนิยม)
const FMT_PCT   = '0.0000';     // อัตรา %/ปี
function applyColFmt(ws, cols /* {idx:fmt} */, r0, r1) {
  for (let r = r0; r <= r1; r++) {
    for (const idx in cols) {
      const addr = XLSX.utils.encode_cell({ r, c: Number(idx) });
      const cell = ws[addr];
      if (cell && cell.t === 'n') cell.z = cols[idx];
    }
  }
}
// ── Excel styling (รองรับโดย xlsx-js-style) ─────────────────────────────────
const XL_BD = { style: 'thin', color: { rgb: 'D7DEE8' } };
const XL_BORDER = { top: XL_BD, bottom: XL_BD, left: XL_BD, right: XL_BD };
const XL = {
  title:      { font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'left',   vertical: 'center' } },
  band:       { font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '3C6E9E' } }, alignment: { horizontal: 'left',   vertical: 'center' } },
  th:         { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '5B8AB8' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: XL_BORDER },
  thSum:      { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '2E7D6B' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: XL_BORDER },
  sumVal:     { font: { bold: true, sz: 12 },                           fill: { fgColor: { rgb: 'E4F2EE' } }, alignment: { horizontal: 'right',  vertical: 'center' }, border: XL_BORDER },
  sumValDue:  { font: { bold: true, sz: 12, color: { rgb: 'C0392B' } }, fill: { fgColor: { rgb: 'FDECEA' } }, alignment: { horizontal: 'right',  vertical: 'center' }, border: XL_BORDER },
  ctr:        { alignment: { horizontal: 'center', vertical: 'center' } },
  cell:       { alignment: { vertical: 'center' }, border: XL_BORDER },
  cellAlt:    { fill: { fgColor: { rgb: 'F5F8FC' } }, alignment: { vertical: 'center' }, border: XL_BORDER },
  totLabel:   { font: { bold: true }, fill: { fgColor: { rgb: 'FFF3D6' } }, alignment: { horizontal: 'right', vertical: 'center' }, border: XL_BORDER },
  totVal:     { font: { bold: true }, fill: { fgColor: { rgb: 'FFF3D6' } }, alignment: { horizontal: 'right', vertical: 'center' }, border: XL_BORDER },
  paid:       { font: { color: { rgb: '1E8E5A' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: XL_BORDER },
  due:        { font: { color: { rgb: 'C0392B' }, bold: true }, alignment: { horizontal: 'center', vertical: 'center' }, border: XL_BORDER },
};
function xlSet(ws, r, c, style) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { t: 's', v: '' };
  ws[addr].s = Object.assign({}, ws[addr].s, style);
  return ws[addr];
}
function xlRow(ws, r, c0, c1, style) { for (let c = c0; c <= c1; c++) xlSet(ws, r, c, style); }
// ลงสไตล์ข้อมูลแบบสลับสีแถว (zebra) ทั้งบล็อก
function xlBody(ws, r0, r1, c0, c1) {
  for (let r = r0; r <= r1; r++) xlRow(ws, r, c0, c1, (r - r0) % 2 ? XL.cellAlt : XL.cell);
}
function principalInOut(events) {
  const evs = events || [];
  const inSum  = evs.filter(e => e.eventType === 'drawdown').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const outSum = evs.filter(e => e.eventType === 'repayment').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return { inSum, outSum };
}

// ── Per-contract Excel export (one sheet per contract) ──────────────────────
function exportPerContractSheets({ masters, ledgerByContract, eventsByContract, mode /* 'detail' | 'summary' */ }) {
  if (typeof XLSX === 'undefined') { alert('SheetJS ยังไม่โหลด'); return; }
  eventsByContract = eventsByContract || {};
  const wb = XLSX.utils.book_new();
  // Sheet 1: สรุป — เพิ่มคอลัมน์ เบิกเพิ่ม / คืนเงินต้นแล้ว / คงเหลือเงินต้น
  const summary = [
    ['สรุปดอกเบี้ยทุกสัญญา', '', '', '', '', '', '', '', '', '', ''],
    ['หมวด', 'เลขที่สัญญา', 'ผู้กู้/เจ้าหนี้', 'วงเงิน', 'เบิกเพิ่มรวม', 'คืนเงินต้นแล้ว', 'คงเหลือเงินต้น', 'อัตรา %/ปี', 'ดอกเบี้ยรวม', 'จ่ายแล้ว', 'ค้างชำระ'],
  ];
  masters.forEach(m => {
    const rows = ledgerByContract[m.contractNo] || [];
    const total = rows.reduce((s, r) => s + effectiveInterest(r), 0);
    const paid  = rows.reduce((s, r) => s + interestPaid(r), 0);
    const { inSum, outSum } = principalInOut(eventsByContract[m.contractNo]);
    const principal = Number(m.principalAmount) || 0;
    summary.push([
      m.debtCategory || '', m.contractNo || '', m.borrowerName || '',
      principal, inSum, outSum, Math.max(0, principal + inSum - outSum),
      (Number(m.interestRate) || 0) * 100,
      total, paid, total - paid,
    ]);
  });
  const wsS = XLSX.utils.aoa_to_sheet(summary);
  wsS['!cols'] = [10,18,28,14,13,14,14,10,14,14,14].map(w => ({ wch: w }));
  wsS['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }];
  wsS['!rows'] = [{ hpt: 24 }, { hpt: 30 }];
  applyColFmt(wsS, { 3: FMT_BAHT, 4: FMT_BAHT, 5: FMT_BAHT, 6: FMT_BAHT, 7: FMT_PCT, 8: FMT_MONEY, 9: FMT_MONEY, 10: FMT_MONEY }, 2, summary.length - 1);
  // ── สไตล์: หัวเรื่อง / หัวคอลัมน์ / ข้อมูล zebra + คอลัมน์เงินชิดขวา + ค้างชำระแดง ──
  xlRow(wsS, 0, 0, 10, XL.title);
  xlRow(wsS, 1, 0, 10, XL.th);
  xlBody(wsS, 2, summary.length - 1, 0, 10);
  for (let r = 2; r < summary.length; r++) {
    for (const c of [3, 4, 5, 6, 7, 8, 9, 10]) xlSet(wsS, r, c, { alignment: { horizontal: 'right', vertical: 'center' } });
    if ((Number(summary[r][10]) || 0) > 0) xlSet(wsS, r, 10, { font: { color: { rgb: 'C0392B' }, bold: true } });
  }
  XLSX.utils.book_append_sheet(wb, wsS, 'สรุปทั้งหมด');

  if (mode === 'detail') {
    masters.forEach(m => {
      const rows = (ledgerByContract[m.contractNo] || []).slice().sort((a, b) =>
        (Number(a.year) || 0) - (Number(b.year) || 0) ||
        (Number(a.month) || 0) - (Number(b.month) || 0)
      );
      const myEvents = (eventsByContract[m.contractNo] || []).slice()
        .sort((a, b) => (a.eventDate || '').localeCompare(b.eventDate || ''));
      const { inSum, outSum } = principalInOut(myEvents);
      const principal = Number(m.principalAmount) || 0;
      const balance   = Math.max(0, principal + inSum - outSum);
      const totEff  = rows.reduce((s, r) => s + effectiveInterest(r), 0);
      const totPaid = rows.reduce((s, r) => s + interestPaid(r), 0);

      const aoa = [];
      // ── หัวเรื่อง ──
      aoa.push([m.borrowerName + ' · ' + m.contractNo + ' · ' + (m.debtCategory || '') +
        ' · อัตรา ' + ((Number(m.interestRate) || 0) * 100).toFixed(2) + '%/ปี']);
      aoa.push([]);
      // ── บล็อกสรุปเงินต้น/ดอกเบี้ย ──
      aoa.push(['วงเงิน', 'เบิกเพิ่มรวม', 'คืนเงินต้นแล้ว', 'คงเหลือเงินต้น', 'ดอกเบี้ยรวม', 'จ่ายแล้ว', 'ค้างชำระ']);
      const sumValRow = aoa.length;
      aoa.push([principal, inSum, outSum, balance, totEff, totPaid, totEff - totPaid]);
      aoa.push([]);
      // ── ตารางดอกเบี้ยรายเดือน ──
      aoa.push(['ตารางดอกเบี้ยรายเดือน']);
      aoa.push(['เดือน', 'ปี', 'เงินต้น', 'อัตรา %/ปี', 'จำนวนวัน', 'ดอกเบี้ย (ระบบคำนวณ)', 'ดอกเบี้ย (Override)', 'ดอกเบี้ยจริง', 'คงเหลือ', 'วันจ่าย', 'หมายเหตุ Override', 'หมายเหตุ']);
      const schedStart = aoa.length;
      rows.forEach(r => {
        const computed = Number(r.interestAmount) || 0;
        const override = r.interestOverride != null && r.interestOverride !== '' ? Number(r.interestOverride) : '';
        aoa.push([
          TH_MONTH[Number(r.month)] || r.month, Number(r.year) || r.year,
          Number(r.principal) || 0,
          (Number(r.interestRate) || 0) * 100,
          Number(r.days) || '',
          computed, override, effectiveInterest(r),
          Number(r.outstanding) || 0,
          r.paymentDate ? fmtDate(r.paymentDate) : (interestPaid(r) > 0 ? 'บางส่วน' : 'ค้าง'),
          r.overrideNote || '',
          r.note || '',
        ]);
      });
      const schedEnd = aoa.length - 1;
      aoa.push(['', '', '', '', '', '', 'รวม', totEff]);
      aoa.push(['', '', '', '', '', '', 'จ่ายแล้ว', totPaid]);
      aoa.push(['', '', '', '', '', '', 'ค้างชำระ', totEff - totPaid]);
      const totRowStart = schedEnd + 1;

      // ── รายการคืน/เบิกเงินต้น ──
      let evStart = -1, evEnd = -1;
      if (myEvents.length) {
        aoa.push([]);
        aoa.push(['รายการรับ/คืนเงินต้น']);
        aoa.push(['วันที่', 'ประเภท', 'จำนวนเงิน', 'คงเหลือเงินต้น (หลังรายการ)', 'หมายเหตุ']);
        evStart = aoa.length;
        let run = principal;
        myEvents.forEach(e => {
          const amt = Number(e.amount) || 0;
          run += (e.eventType === 'repayment' ? -1 : 1) * amt;
          aoa.push([
            fmtDate(e.eventDate),
            e.eventType === 'repayment' ? 'คืนเงินต้น' : 'รับเงินกู้/เบิกเพิ่ม',
            (e.eventType === 'repayment' ? -1 : 1) * amt,
            Math.max(0, run),
            e.note || '',
          ]);
        });
        evEnd = aoa.length - 1;
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // A–I กว้างคงที่ 14.5, J–L (วันจ่าย/หมายเหตุ) ตามเนื้อหา
      ws['!cols'] = [14.5,14.5,14.5,14.5,14.5,14.5,14.5,14.5,14.5,12,18,16].map(w => ({ wch: w }));
      const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];        // หัวเรื่อง
      merges.push({ s: { r: schedStart - 2, c: 0 }, e: { r: schedStart - 2, c: 11 } }); // แถบ "ตารางดอกเบี้ยรายเดือน"
      if (evStart >= 0) merges.push({ s: { r: evStart - 2, c: 0 }, e: { r: evStart - 2, c: 4 } }); // แถบ "รายการรับ/คืนเงินต้น"
      ws['!merges'] = merges;
      // จัด number format ให้ทุกส่วน
      applyColFmt(ws, { 0: FMT_BAHT, 1: FMT_BAHT, 2: FMT_BAHT, 3: FMT_BAHT, 4: FMT_MONEY, 5: FMT_MONEY, 6: FMT_MONEY }, sumValRow, sumValRow);
      applyColFmt(ws, { 2: FMT_BAHT, 3: FMT_PCT, 5: FMT_MONEY, 6: FMT_MONEY, 7: FMT_MONEY, 8: FMT_BAHT }, schedStart, schedEnd);
      applyColFmt(ws, { 7: FMT_MONEY }, totRowStart, totRowStart + 2);
      if (evStart >= 0) applyColFmt(ws, { 2: FMT_BAHT, 3: FMT_BAHT }, evStart, evEnd);

      // ── สไตล์ (สี/เส้น/ฟอนต์) ───────────────────────────────────────────────
      const rowH = {};
      rowH[0] = { hpt: 26 };                       // หัวเรื่อง
      xlRow(ws, 0, 0, 11, XL.title);
      // บล็อกสรุปเงินต้น/ดอกเบี้ย
      xlRow(ws, sumValRow - 1, 0, 6, XL.thSum);
      xlRow(ws, sumValRow, 0, 6, XL.sumVal);
      xlSet(ws, sumValRow, 6, (totEff - totPaid) > 0 ? XL.sumValDue : XL.sumVal); // ค้างชำระ
      // แถบ + หัวตารางดอกเบี้ยรายเดือน
      rowH[schedStart - 2] = { hpt: 22 };
      xlRow(ws, schedStart - 2, 0, 11, XL.band);
      xlRow(ws, schedStart - 1, 0, 11, XL.th);
      // ข้อมูลตารางดอกเบี้ย — zebra + เน้นสถานะวันจ่าย
      xlBody(ws, schedStart, schedEnd, 0, 11);
      for (let r = schedStart; r <= schedEnd; r++) {
        // เดือน / ปี / จำนวนวัน — จัดกึ่งกลาง
        for (const c of [0, 1, 4]) xlSet(ws, r, c, XL.ctr);
        const cell = ws[XLSX.utils.encode_cell({ r, c: 9 })];
        xlSet(ws, r, 9, (cell && cell.v === 'ค้าง') ? XL.due : XL.paid);
      }
      // แถวรวม/จ่ายแล้ว/ค้างชำระ
      for (let r = totRowStart; r <= totRowStart + 2; r++) { xlSet(ws, r, 6, XL.totLabel); xlSet(ws, r, 7, XL.totVal); }
      // บล็อกรายการรับ/คืนเงินต้น
      if (evStart >= 0) {
        rowH[evStart - 2] = { hpt: 22 };
        xlRow(ws, evStart - 2, 0, 4, XL.band);
        xlRow(ws, evStart - 1, 0, 4, XL.th);
        xlBody(ws, evStart, evEnd, 0, 4);
        for (let r = evStart; r <= evEnd; r++) {
          // วันที่ / ประเภท — จัดกึ่งกลาง
          for (const c of [0, 1]) xlSet(ws, r, c, XL.ctr);
          const cell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
          if (cell && (Number(cell.v) || 0) < 0) xlSet(ws, r, 2, { font: { color: { rgb: 'C0392B' } } });
        }
      }
      ws['!rows'] = Object.keys(rowH).reduce((arr, k) => { arr[k] = rowH[k]; return arr; }, []);

      // sanitize sheet name (max 31 chars, no special chars)
      let name = (m.contractNo || m.borrowerName || 'sheet').replace(/[\\\/\?\*\[\]\:]/g, '_').slice(0, 31);
      let n = 1, base = name;
      while (wb.SheetNames.includes(name)) { n++; name = (base.slice(0, 28) + '_' + n).slice(0, 31); }
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
  }

  const filename = (mode === 'detail'
    ? 'debt_interest_detail_'
    : 'debt_interest_summary_') + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSX.writeFile(wb, filename);
}

// ── ฟอร์มเติมข้อมูลสัญญาที่ขาด (โผล่ในแบนเนอร์เตือนของแผงคำนวณอัตโนมัติ) ──────
function MissingFieldsEditor({ master, onSave }) {
  const [start,     setStart]     = React.useState('');
  const [maturity,  setMaturity]  = React.useState('');
  const [rate,      setRate]      = React.useState(0);
  const [principal, setPrincipal] = React.useState(0);
  React.useEffect(() => {
    setStart(master.startDate || master.receiveDate || master.drawdownDate || '');
    setMaturity(master.maturityDate || '');
    setRate(Number(master.interestRate) || 0);
    setPrincipal(Number(master.principalAmount) || 0);
  }, [master]);
  const Lbl = ({ children }) => <label style={{ fontSize: 10, color: 'var(--ink-500)', display: 'block', marginBottom: 2 }}>{children}</label>;
  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div style={{ flex: '1 1 120px' }}>
        <Lbl>วันเริ่ม/รับเงิน</Lbl>
        <input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} style={{ fontSize: 12 }} />
      </div>
      <div style={{ flex: '1 1 120px' }}>
        <Lbl>วันครบสัญญา</Lbl>
        <input className="input" type="date" value={maturity} onChange={e => setMaturity(e.target.value)} style={{ fontSize: 12 }} />
      </div>
      <div style={{ flex: '1 1 90px' }}>
        <Lbl>อัตรา %/ปี</Lbl>
        <PercentInput className="input" value={rate} onChange={setRate} style={{ fontSize: 12 }} />
      </div>
      <div style={{ flex: '1 1 120px' }}>
        <Lbl>เงินต้น (บาท)</Lbl>
        <NumberInput className="input" value={principal} digits={0} onChange={setPrincipal} style={{ fontSize: 12 }} />
      </div>
      <button className="btn btn-primary" style={{ fontSize: 12 }}
        onClick={() => onSave && onSave(master, {
          startDate: start, maturityDate: maturity,
          interestRate: Number(rate) || 0, principalAmount: Number(principal) || 0,
        })}>
        <Icon name="check" size={13} /> บันทึกข้อมูล
      </button>
    </div>
  );
}

// ── Monthly schedule popup ──────────────────────────────────────────────────
function InterestSchedulePopup({ master, ledgerRows, events, onClose,
    onSavePayments, onSaveInterestPayments, onClearPayment, onOverrideInterest,
    onAddPrincipalEvent, onEditEvent, onDeleteEvent, onDeleteLedgerRow, onAddLedgerRow,
    onAdoptAuto, onSetAutoMode, onSaveMasterFields, onRollover, onSetContractStatus, canEdit }) {
  const [selectedIds, setSelectedIds] = React.useState(new Set());
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [overrideRow, setOverrideRow] = React.useState(null);
  const [filter,      setFilter]      = React.useState('all'); // all | unpaid | paid
  const [drawerTab,   setDrawerTab]   = React.useState('interest'); // แท็บใน popup: 'interest' (ดอกเบี้ย) | 'principal' (คืนเงินกู้)
  // evtModal = null | { kind:'repayment'|'drawdown', event?:<existing event to edit> }
  const [evtModal,    setEvtModal]    = React.useState(null);
  const [rolloverOpen, setRolloverOpen] = React.useState(false);
  // Phase A — แผงเทียบ "คำนวณอัตโนมัติ" (อ่านอย่างเดียว)
  const [cmpOpen,     setCmpOpen]     = React.useState(false);
  const [cmpMethod,   setCmpMethod]   = React.useState('ACT/365');
  const [cmpDayCount, setCmpDayCount] = React.useState('exclude_end');
  const [addRowOpen,  setAddRowOpen]  = React.useState(false); // เพิ่มแถวดอกเบี้ยเอง
  const [payModalRow, setPayModalRow] = React.useState(null);  // จ่ายดอกเบี้ยเดือนนี้ (หลายรอบ/บางส่วน)

  React.useEffect(() => { setSelectedIds(new Set()); }, [master]);

  if (!master) return null;
  const autoOn = !!(master.interestCalc && master.interestCalc.autoMode);

  const myEvents = (events || []).filter(e =>
    e.contractId === master.id || e.contractNo === master.contractNo
  ).sort((a, b) => (a.eventDate || '').localeCompare(b.eventDate || ''));
  const drawdownsExtra = myEvents.filter(e => e.eventType === 'drawdown');
  const repaymentsAll  = myEvents.filter(e => e.eventType === 'repayment');
  const principalIn  = (Number(master.principalAmount) || 0) + drawdownsExtra.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const principalOut = repaymentsAll.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  // ยอดคงเหลือเงินต้นไหลตามลำดับวันที่ของแต่ละรายการ (เริ่มจากเงินต้นตั้งต้น)
  let _run = Number(master.principalAmount) || 0;
  const eventsWithBal = myEvents.map(e => {
    _run += (e.eventType === 'repayment' ? -1 : 1) * (Number(e.amount) || 0);
    return { ev: e, balAfter: Math.max(0, _run) };
  });

  const sortedRows = [...ledgerRows].sort((a, b) =>
    (Number(a.year) || 0) - (Number(b.year) || 0) ||
    (Number(a.month) || 0) - (Number(b.month) || 0)
  );
  const visibleRows = filter === 'all'
    ? sortedRows
    : sortedRows.filter(r => filter === 'paid' ? isInterestFullyPaid(r) : !isInterestFullyPaid(r));

  const totalInterest = sortedRows.reduce((s, r) => s + effectiveInterest(r), 0);
  const totalPaid     = sortedRows.reduce((s, r) => s + interestPaid(r), 0);
  const outstanding   = totalInterest - totalPaid;
  const cat = master.debtCategory || 'อื่นๆ';
  const color = DL_CATEGORY_COLOR[cat] || '#525252';
  const bg    = DL_CATEGORY_BG[cat]    || '#f5f5f5';

  // multi-select
  const toggleSelect = (id) => {
    setSelectedIds(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const selectableRows = visibleRows.filter(r => !isInterestFullyPaid(r));
  const allSelected = selectableRows.length > 0 && selectableRows.every(r => selectedIds.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(selectableRows.map(r => r.id)));
  };
  const selectedRows = sortedRows.filter(r => selectedIds.has(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + interestRemaining(r), 0);

  return (
    <>
      <Modal
        open={!!master}
        maxWidth={1080}
        wide
        onClose={onClose}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Badge kind="b-blue" dot={false} style={{ background: bg, color, border: `1px solid ${color}55`, fontSize: 11.5 }}>{cat}</Badge>
            {master.facilityType && <FacilityChip type={master.facilityType} size="md" />}
            <span style={{ fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)', fontSize: 13 }}>{master.contractNo}</span>
            <span style={{ color: 'var(--ink-300)', fontSize: 12 }}>·</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-700)' }}>{master.borrowerName}</span>
          </div>
        }
        footer={
          selectedIds.size > 0 && canEdit ? (
            <>
              <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--ink-500)' }}>
                เลือก <strong style={{ color: 'var(--brand-700)' }}>{selectedIds.size}</strong> เดือน · รวม{' '}
                <strong style={{ color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(selectedTotal, 2)}</strong>
              </span>
              <button className="btn btn-ghost" onClick={() => setSelectedIds(new Set())}>ล้างที่เลือก</button>
              <button className="btn btn-primary" onClick={() => setConfirmOpen(true)}>
                <Icon name="check" size={14} /> บันทึกจ่ายพร้อมกัน {selectedIds.size} เดือน
              </button>
            </>
          ) : (
            <>
              <span style={{ marginRight: 'auto', fontSize: 11.5, color: 'var(--ink-400)' }}>
                💡 ติ๊กเลือกเดือนที่จะจ่าย (หลายเดือนก็ได้) แล้วกด "บันทึกจ่ายพร้อมกัน"
              </span>
              <button className="btn btn-ghost" onClick={onClose}>ปิด</button>
            </>
          )
        }
      >
        {/* Hero stats */}
        <div style={{
          padding: '14px 16px', borderRadius: 12, marginBottom: 14,
          background: `linear-gradient(135deg, ${bg}, color-mix(in oklch, ${color} 4%, #ffffff))`,
          border: `1px solid ${color}33`,
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>เงินต้นรวม (เบิก)</div>
            <div style={{ fontWeight: 700, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(principalIn, 2)}</div>
            {drawdownsExtra.length > 0 && <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>+{drawdownsExtra.length} drawdown</div>}
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>คืนเงินต้นแล้ว</div>
            <div style={{ fontWeight: 700, fontSize: 17, fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{fmtNum(principalOut, 2)}</div>
            {repaymentsAll.length > 0 && <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>{repaymentsAll.length} ครั้ง</div>}
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>คงเหลือเงินต้น</div>
            <div style={{ fontWeight: 700, fontSize: 17, fontVariantNumeric: 'tabular-nums',
                          color: (debtDisplayBalance(master)) > 0 ? 'var(--bad)' : 'var(--ink-300)' }}>
              {fmtNum(debtDisplayBalance(master), 2)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>ดอกเบี้ยรวม</div>
            <div style={{ fontWeight: 700, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(totalInterest, 0)}</div>
            <div style={{ fontSize: 10, color: 'var(--good)' }}>จ่ายแล้ว {fmtNum(totalPaid, 0)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>ดอกเบี้ยค้างจ่าย</div>
            <div style={{ fontWeight: 700, fontSize: 19, fontVariantNumeric: 'tabular-nums',
                          color: outstanding > 0 ? 'var(--bad)' : 'var(--ink-300)' }}>
              {fmtNum(outstanding, 0)}
            </div>
          </div>
        </div>

        {/* แท็บใน popup — segmented control เด่นชัดแต่กระชับ (ไม่ยืดเต็มกว้าง) */}
        <div style={{ display: 'inline-flex', gap: 4, marginBottom: 12, background: 'var(--ink-100, #eef1f6)', borderRadius: 9, padding: 3, border: '1px solid var(--line)' }}>
          {[
            { k: 'principal', label: '💵 คืนเงินต้น' },
            { k: 'interest',  label: '📈 ดอกเบี้ย' },
          ].map(t => {
            const on = drawerTab === t.k;
            return (
              <button key={t.k} type="button" onClick={() => setDrawerTab(t.k)}
                style={{
                  padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                  background: on ? 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' : 'transparent',
                  color: on ? '#fff' : 'var(--ink-500)',
                  boxShadow: on ? '0 2px 7px color-mix(in oklch, var(--brand-500) 38%, transparent)' : 'none',
                  transition: 'all .15s',
                }}>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Quick action bar — repayment / drawdown / rollover */}
        {drawerTab === 'principal' && canEdit && master.status === 'Active' && (
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14,
            padding: '8px 12px', borderRadius: 10,
            background: 'var(--ink-25, #fafbfc)', border: '1px solid var(--ink-100)',
          }}>
            <span style={{ fontSize: 11, color: 'var(--ink-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, alignSelf: 'center' }}>
              จัดการเงินต้น:
            </span>
            <button onClick={() => onAddPrincipalEvent && setEvtModal({ kind: 'repayment' })}
              title="คืนเงินต้น (ทั้งหมด หรือบางส่วน)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
                       border: '1.5px solid #86efac', background: '#f0fdf4', color: '#166534', fontSize: 12, fontWeight: 600 }}>
              💵 คืนเงินต้น
            </button>
            <button onClick={() => onAddPrincipalEvent && setEvtModal({ kind: 'drawdown' })}
              title="เบิกเงินกู้เพิ่ม (drawdown)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
                       border: '1.5px solid #fde68a', background: '#fffbeb', color: '#92400e', fontSize: 12, fontWeight: 600 }}>
              ↑ เบิกเพิ่ม
            </button>
            <button onClick={() => onRollover && setRolloverOpen(true)}
              title="ปิดสัญญานี้ + ทำสัญญาใหม่ (เปลี่ยนชื่อ / ปรับวงเงิน / แยกสัญญา)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
                       border: '1.5px solid var(--brand-400)', background: 'var(--brand-50, #f0f6ff)', color: 'var(--brand-700)', fontSize: 12, fontWeight: 600 }}>
              🔄 ปิด/ทำสัญญาใหม่
            </button>
            <button onClick={() => { if (onSetContractStatus && confirm(`ปิดสัญญา ${master.contractNo} (ทำเครื่องหมายปิด ไม่ทำสัญญาใหม่)?`)) onSetContractStatus(master, 'Close'); }}
              title="ทำเครื่องหมายปิดสัญญา — ใช้กับสัญญาที่คืนครบแล้วแต่สถานะค้าง Active"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
                       border: '1.5px solid #cbd5e1', background: '#f8fafc', color: '#475569', fontSize: 12, fontWeight: 600 }}>
              🔒 ปิดสัญญา
            </button>
          </div>
        )}

        {/* ปิดอยู่ → ปุ่มเปิดกลับเป็น Active */}
        {canEdit && master.status !== 'Active' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14,
                        padding: '8px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid var(--ink-100)' }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 600 }}>🔒 สัญญานี้ปิดแล้ว</span>
            <button onClick={() => { if (onSetContractStatus && confirm(`เปิดสัญญา ${master.contractNo} กลับเป็น Active?`)) onSetContractStatus(master, 'Active'); }}
              title="เปิดสัญญากลับเป็น Active"
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
                       border: '1.5px solid #86efac', background: '#f0fdf4', color: '#166534', fontSize: 12, fontWeight: 600 }}>
              🔓 เปิดสัญญากลับ
            </button>
          </div>
        )}

        {/* Linked-from / linked-to lineage */}
        {(master.linkedFromContract || master.linkedToContracts) && (
          <div style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            marginBottom: 12, padding: '6px 12px', borderRadius: 8,
            background: '#fef3c7', border: '1px solid #fde68a', fontSize: 11.5, color: '#92400e',
          }}>
            <span style={{ fontWeight: 700 }}>🔗 ลำดับสัญญา:</span>
            {master.linkedFromContract && (
              <span>สืบเนื่องจาก <strong style={{ fontFamily: 'ui-monospace' }}>{master.linkedFromContract}</strong></span>
            )}
            {master.linkedToContracts && (
              <span>ทำสัญญาใหม่เป็น <strong style={{ fontFamily: 'ui-monospace' }}>{master.linkedToContracts}</strong></span>
            )}
            {master.closedReason && (
              <span style={{ marginLeft: 'auto' }}>เหตุผล: <em>{master.closedReason}</em></span>
            )}
          </div>
        )}

        {/* Drawdown/repayment events */}
        {drawerTab === 'principal' && myEvents.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon name="invoice" size={14} style={{ color: 'var(--brand-600)' }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink-800, #1e293b)' }}>รายการรับ/คืนเงินกู้</span>
              <span style={{ background: 'var(--brand-50, #eff6ff)', color: 'var(--brand-700)', borderRadius: 20, padding: '1px 9px', fontSize: 11, fontWeight: 700 }}>
                {myEvents.length} รายการ
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-500)' }}>
                คืนแล้ว <strong style={{ color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(principalOut, 2)}</strong>
                <span style={{ color: 'var(--ink-300)', margin: '0 6px' }}>·</span>
                คงเหลือ <strong style={{ fontVariantNumeric: 'tabular-nums', color: debtDisplayBalance(master) > 0 ? 'var(--bad)' : 'var(--good)' }}>{fmtNum(debtDisplayBalance(master), 2)}</strong>
              </span>
            </div>
            <div style={{ borderRadius: 12, border: '1px solid var(--line, #e2e8f0)', overflow: 'hidden', boxShadow: '0 1px 2px rgba(16,24,40,0.04)' }}>
              <div style={{ maxHeight: myEvents.length > 8 ? 300 : 'none', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--ink-50, #f8fafc)' }}>
                      {['วันที่', 'ประเภท', 'จำนวนเงิน', 'คงเหลือเงินต้น', 'หมายเหตุ'].map((h, hi) => (
                        <th key={h} style={{
                          textAlign: hi >= 2 && hi <= 3 ? 'right' : 'left',
                          padding: '6px 14px', fontSize: 10, fontWeight: 700, color: 'var(--ink-400)',
                          textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
                          borderBottom: '1px solid var(--line, #e2e8f0)',
                        }}>{h}</th>
                      ))}
                      {canEdit && <th style={{ width: 78, borderBottom: '1px solid var(--line, #e2e8f0)' }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {eventsWithBal.map(({ ev: e, balAfter }, ei) => {
                      const isRepay = e.eventType === 'repayment';
                      const pct = principalIn ? Math.max(0, Math.min(100, balAfter / principalIn * 100)) : 0;
                      const accent = isRepay ? '#10b981' : '#f59e0b';
                      return (
                        <tr key={(e.id || '') + '|' + ei} style={{ borderTop: ei === 0 ? 'none' : '1px solid var(--ink-50, #f1f5f9)' }}>
                          <td style={{ padding: '6px 14px', whiteSpace: 'nowrap', color: 'var(--ink-600)', fontVariantNumeric: 'tabular-nums' }}>
                            {fmtDate(e.eventDate)}
                          </td>
                          <td style={{ padding: '6px 14px' }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 10px', borderRadius: 20,
                              fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                              background: isRepay ? '#ecfdf5' : '#fffbeb', color: isRepay ? '#047857' : '#92400e',
                              border: `1px solid ${isRepay ? '#a7f3d0' : '#fde68a'}`,
                            }}>
                              <span style={{ fontSize: 9 }}>{isRepay ? '▼' : '▲'}</span>
                              {isRepay ? 'คืนเงินต้น' : 'เบิกเพิ่ม'}
                            </span>
                          </td>
                          <td style={{ padding: '6px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                                       fontSize: 13, color: isRepay ? 'var(--good)' : '#b45309', whiteSpace: 'nowrap' }}>
                            {isRepay ? '−' : '+'}{fmtNum(Number(e.amount), 2)}
                          </td>
                          <td style={{ padding: '6px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                              <div style={{ width: 70, height: 4, borderRadius: 3, background: 'var(--ink-100, #e2e8f0)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: pct + '%', background: accent, borderRadius: 3, transition: 'width .2s' }} />
                              </div>
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--ink-700)', minWidth: 78, textAlign: 'right' }}>{fmtNum(balAfter, 2)}</span>
                            </div>
                          </td>
                          <td style={{ padding: '6px 14px', color: 'var(--ink-400)', fontSize: 11.5, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.note || ''}>
                            {e.note || '—'}
                          </td>
                          {canEdit && (
                            <td style={{ padding: '4px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                              <button onClick={() => setEvtModal({ kind: e.eventType, event: e })}
                                title="แก้ไขรายการนี้"
                                style={{ display: 'inline-flex', padding: 6, borderRadius: 7, cursor: 'pointer', marginRight: 4,
                                         border: '1px solid var(--line, #e2e8f0)', background: '#fff', color: 'var(--ink-500)' }}>
                                <Icon name="edit" size={12} />
                              </button>
                              <button onClick={() => {
                                  if (confirm(`ลบรายการ ${isRepay ? 'คืนเงินต้น' : 'เบิกเพิ่ม'} ${fmtNum(Number(e.amount), 2)} วันที่ ${fmtDate(e.eventDate)}?\nระบบจะคำนวณยอดคงเหลือเงินต้นใหม่ให้`)) {
                                    onDeleteEvent && onDeleteEvent(e.id, master);
                                  }
                                }}
                                title="ลบรายการนี้"
                                style={{ display: 'inline-flex', padding: 6, borderRadius: 7, cursor: 'pointer',
                                         border: '1px solid #fecaca', background: '#fff', color: '#dc2626' }}>
                                <Icon name="trash" size={12} />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── แท็บ "ดอกเบี้ย": ตัวกรอง + ตารางดอกเบี้ยรายเดือน + เทียบคำนวณ ── */}
        {drawerTab === 'interest' && (<>
        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="tabnav">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              ทั้งหมด ({sortedRows.length})
            </button>
            <button className={filter === 'unpaid' ? 'active' : ''} onClick={() => setFilter('unpaid')}
              style={{ color: filter === 'unpaid' ? undefined : 'var(--bad)' }}>
              ค้างจ่าย ({sortedRows.filter(r => !isInterestFullyPaid(r)).length})
            </button>
            <button className={filter === 'paid' ? 'active' : ''} onClick={() => setFilter('paid')}
              style={{ color: filter === 'paid' ? undefined : 'var(--good)' }}>
              ✓ จ่ายแล้ว ({sortedRows.filter(r => isInterestFullyPaid(r)).length})
            </button>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* onAddLedgerRow ต้องมีจริงถึงจะโชว์ปุ่ม — หน้าที่ลืมส่ง prop จะได้ "ไม่มีปุ่ม"
                (เห็นชัด) แทน "ปุ่มกดแล้วเงียบสนิท" (จับไม่ได้) */}
            {canEdit && onAddLedgerRow && (
              <button onClick={() => setAddRowOpen(true)}
                title="เพิ่มแถวดอกเบี้ยรายเดือนเอง (เผื่อ auto คิดตกหล่น)"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 8,
                         border: '1px solid var(--brand-300)', background: 'var(--brand-50, #f0f6ff)',
                         color: 'var(--brand-700)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                ➕ เพิ่มแถวเอง
              </button>
            )}
            <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>แสดง {visibleRows.length} แถว</span>
          </div>
        </div>

        {/* Schedule table — sticky thead */}
        <div style={{ borderRadius: 10, border: '1px solid var(--ink-100)', overflow: 'hidden' }}>
          <div style={{ maxHeight: 'min(420px, calc(100vh - 460px))', overflowY: 'auto' }}>
            <table className="tbl tbl-compact" style={{ width: '100%', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
                <tr>
                  {canEdit && (
                    <th style={{ width: 34, textAlign: 'center' }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        title="เลือกทั้งหมด (เฉพาะที่ค้างจ่าย)" />
                    </th>
                  )}
                  <th style={{ width: 90 }}>เดือน</th>
                  <th style={{ textAlign: 'right', width: 110 }}>เงินต้น</th>
                  <th style={{ textAlign: 'right', width: 70 }}>อัตรา</th>
                  <th style={{ textAlign: 'right', width: 50 }}>วัน</th>
                  <th style={{ textAlign: 'right', width: 120 }}>ดอกเบี้ย</th>
                  <th style={{ textAlign: 'right', width: 110 }}>คงเหลือ</th>
                  <th style={{ width: 110 }}>วันจ่าย</th>
                  <th>หมายเหตุ</th>
                  {canEdit && <th style={{ width: 140, textAlign: 'center' }}>การกระทำ</th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr><td colSpan={canEdit ? 10 : 9} style={{ textAlign: 'center', padding: 36, color: 'var(--ink-400)' }}>ไม่มีข้อมูล</td></tr>
                )}
                {visibleRows.map((r, ri) => {
                  const payStatus = interestPayStatus(r);
                  const isPaid = payStatus === 'full';
                  const isPartial = payStatus === 'partial';
                  const isOverridden = r.interestOverride != null && r.interestOverride !== '';
                  const eff = effectiveInterest(r);
                  const paidAmt = interestPaid(r);
                  const remain = interestRemaining(r);
                  const roundCount = interestPayments(r).length;
                  const canOpenPay = canEdit && onSaveInterestPayments && payStatus !== 'unpaid';
                  const computed = Number(r.interestAmount) || 0;
                  const isSelected = selectedIds.has(r.id);
                  return (
                    <tr key={(r.id || '') + '|' + ri} style={{
                      background: isSelected ? 'color-mix(in oklch, var(--brand-500) 8%, transparent)' :
                                  isPaid ? '#f0fdf4' : isPartial ? '#fffdf3' : undefined,
                    }}>
                      {canEdit && (
                        <td style={{ textAlign: 'center' }}>
                          {!isPaid && (
                            <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(r.id)} />
                          )}
                        </td>
                      )}
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{TH_MONTH[Number(r.month)] || r.month} {r.year}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(Number(r.principal) || 0, 0)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                        {Number(r.interestRate) ? (Number(r.interestRate) * 100).toFixed(2) + '%' : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.days || '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {fmtNum(eff, 2)}
                        {isOverridden && (
                          <div title={`ระบบคำนวณ: ${fmtNum(computed, 2)} · ${r.overrideNote || 'ไม่มีหมายเหตุ'}`}
                            style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: '#f59e0b',
                                     borderRadius: 3, padding: '0 4px', marginTop: 2, display: 'inline-block' }}>
                            OVERRIDE
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(Number(r.outstanding) || 0, 0)}</td>
                      <td onClick={canOpenPay ? () => setPayModalRow(r) : undefined}
                          title={canOpenPay ? 'คลิกเพื่อดู/แก้รอบการจ่าย' : (isPartial ? `จ่ายแล้ว ${fmtNum(paidAmt, 2)} · คงเหลือ ${fmtNum(remain, 2)}` : (r.paidBy ? `บันทึกโดย ${r.paidBy}` : ''))}
                          style={{ fontSize: 11.5, whiteSpace: 'nowrap',
                                   color: isPaid ? 'var(--good)' : isPartial ? '#b45309' : 'var(--bad)',
                                   fontWeight: isPaid ? 500 : 600,
                                   cursor: canOpenPay ? 'pointer' : undefined,
                                   textDecoration: canOpenPay ? 'underline dotted var(--ink-300)' : undefined, textUnderlineOffset: 3 }}>
                        {isPaid ? (
                          <span>✓ {fmtDate(r.paymentDate)}{roundCount > 1 && <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}> · {roundCount} รอบ</span>}</span>
                        ) : isPartial ? (
                          <span>จ่าย {fmtNum(paidAmt, 0)} / ค้าง {fmtNum(remain, 0)}{roundCount > 1 && <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}> · {roundCount} รอบ</span>}</span>
                        ) : 'ค้าง'}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={r.note || r.paymentNote || ''}>
                        {r.note || r.paymentNote || ''}
                      </td>
                      {canEdit && (
                        <td style={{ textAlign: 'center', padding: '4px 6px' }}>
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            {isPaid ? (
                              <button onClick={() => {
                                  if (confirm(`ล้างสถานะจ่ายของเดือน ${TH_MONTH[Number(r.month)]} ${r.year}?`)) onClearPayment(r);
                                }}
                                title="ล้างสถานะจ่าย (กลับเป็นค้าง)"
                                style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, cursor: 'pointer',
                                         border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b' }}>
                                ล้าง
                              </button>
                            ) : (onSaveInterestPayments ? (
                              <button onClick={() => setPayModalRow(r)}
                                title="บันทึกจ่ายเดือนนี้ (จ่ายหลายรอบ/บางส่วนได้)"
                                style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, cursor: 'pointer',
                                         border: isPartial ? '1px solid #fcd34d' : '1px solid #86efac',
                                         background: isPartial ? '#fffbeb' : '#f0fdf4',
                                         color: isPartial ? '#92400e' : '#166534', fontWeight: 600 }}>
                                {isPartial ? 'จ่ายต่อ' : '✓ จ่าย'}
                              </button>
                            ) : null)}
                            <button onClick={() => setOverrideRow(r)}
                              title="แก้ดอกเบี้ย (override) — เมื่อระบบคำนวณไม่ถูก"
                              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 12, cursor: 'pointer',
                                       border: '1px solid #fcd34d', background: '#fffbeb', color: '#92400e' }}>
                              <Icon name="edit" size={9} />
                            </button>
                            <button onClick={() => {
                                if (confirm(`ลบแถวดอกเบี้ย ${TH_MONTH[Number(r.month)] || r.month} ${r.year}?\n(ใช้เมื่อแถวนี้ไม่ควรมี เช่น แถวยอด 0 / คืนเงินต้น)`)) {
                                  onDeleteLedgerRow && onDeleteLedgerRow(r);
                                }
                              }}
                              title="ลบแถวดอกเบี้ยนี้ทิ้ง"
                              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 12, cursor: 'pointer',
                                       border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b' }}>
                              🗑
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* คำนวณอัตโนมัติ — แบนเนอร์เมื่อเปิดใช้แล้ว */}
        {autoOn && canEdit && (
          <div style={{ marginTop: 14, padding: '9px 12px', borderRadius: 10, background: '#ecfdf5', border: '1px solid #6ee7b7',
                        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: '#065f46' }}>
            <span style={{ fontWeight: 700 }}>⚙️ คำนวณอัตโนมัติ: เปิดอยู่</span>
            <span style={{ background: '#d1fae5', borderRadius: 5, padding: '1px 7px', fontWeight: 600 }}>
              {(master.interestCalc.method || 'ACT/365')} · {master.interestCalc.dayCount === 'include_end' ? 'นับวันคืน' : 'ไม่นับวันคืน'}
            </span>
            <button onClick={() => onAdoptAuto && onAdoptAuto(master, sortedRows, { method: master.interestCalc.method, dayCount: master.interestCalc.dayCount })}
              style={{ marginLeft: 'auto', padding: '4px 11px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                       border: '1px solid #34d399', background: '#fff', color: '#047857' }}>
              🔄 อัปเดตถึงเดือนล่าสุด
            </button>
            <button onClick={() => { if (confirm('ปิดคำนวณอัตโนมัติ กลับเป็นแก้มือ? (ตารางที่คำนวณไว้ยังอยู่)')) onSetAutoMode && onSetAutoMode(master, false); }}
              style={{ padding: '4px 11px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                       border: '1px solid #fca5a5', background: '#fff', color: '#991b1b' }}>
              ↩ กลับเป็นแก้มือ
            </button>
          </div>
        )}

        {/* Phase A — แผงเทียบ "คำนวณอัตโนมัติ" (อ่านอย่างเดียว ยังไม่บันทึก) */}
        {!autoOn && (
        <div style={{ marginTop: 14, borderRadius: 10, border: '1px dashed var(--brand-300)', overflow: 'hidden' }}>
          <button onClick={() => setCmpOpen(o => !o)}
            style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                     padding: '9px 12px', cursor: 'pointer', border: 'none',
                     background: 'var(--brand-50, #f0f6ff)', color: 'var(--brand-700)', fontSize: 12.5, fontWeight: 700 }}>
            🔬 เทียบกับแบบคำนวณอัตโนมัติ (ทดลอง · ยังไม่บันทึก)
            <span style={{ marginLeft: 'auto', fontSize: 11 }}>{cmpOpen ? '▲ ซ่อน' : '▼ แสดง'}</span>
          </button>
          {cmpOpen && (() => {
            const todayStr = new Date().toISOString().slice(0, 10);
            // เทียบช่วงเวลาเดียวกับข้อมูลเดิม: หยุดที่ "วันสุดท้ายจริง" ของข้อมูลเดิม
            // ถ้าแถวสุดท้ายเป็น marker คืนเงินต้น → หยุดที่วันจ่ายนั้น มิฉะนั้นสิ้นเดือนของแถวสุดท้าย
            // ถ้าสัญญายังไม่มี events → ดึงคืนเงินต้นจากแถว marker เดิมมาใช้เทียบ (ยังไม่บันทึก)
            const myExisting = (events || []).filter(e => e.contractId === master.id || e.contractNo === master.contractNo);
            const extracted  = myExisting.length ? [] : extractEventsFromLedger(sortedRows, master);
            const effEvents  = myExisting.length ? events : extracted;
            const lastStored = sortedRows.length ? sortedRows[sortedRows.length - 1] : null;
            const lastIsMarker = lastStored && /คืนเงิน|เบิก|ชำระต้น/.test(String(lastStored.note || lastStored.paymentNote || ''));
            // สัญญาปิดแล้ว → หยุดที่ "วันคืนจริง" (helper เดียวกับตอนกดใช้จริง → พรีวิวตรงกับผลจริงเสมอ)
            //   ไม่งั้น → marker คืนเงินต้น (ถ้าแถวสุดท้ายเป็น marker) หรือสิ้นเดือนของแถวสุดท้าย (เทียบช่วงเดิม)
            const endCap = master.status !== 'Active'
              ? _closedEndDate(master, effEvents, sortedRows)
              : !lastStored ? null
              : (lastIsMarker && lastStored.paymentDate) ? lastStored.paymentDate
              : _monthEndStr(`${lastStored.year}-${String(lastStored.month).padStart(2, '0')}-01`);
            const cmp = buildAutoSchedule(master, effEvents, todayStr, { method: cmpMethod, dayCount: cmpDayCount, endCap });
            const diff = cmp.error ? 0 : cmp.total - totalInterest;
            const matched = !cmp.error && Math.abs(diff) < 1;
            return (
              <div style={{ padding: 12 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: 'var(--ink-500)', fontWeight: 600 }}>วิธีคิด:</label>
                  <select value={cmpMethod} onChange={e => setCmpMethod(e.target.value)}
                    style={{ padding: '5px 9px', borderRadius: 7, border: '1.5px solid var(--ink-200)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    {CALC_METHODS.map(m => <option key={m.k} value={m.k}>{m.label}</option>)}
                  </select>
                  <div className="tabnav" style={{ flex: 'none' }}>
                    <button className={cmpDayCount === 'exclude_end' ? 'active' : ''} onClick={() => setCmpDayCount('exclude_end')}>ไม่นับวันคืน</button>
                    <button className={cmpDayCount === 'include_end' ? 'active' : ''} onClick={() => setCmpDayCount('include_end')}>นับวันคืนด้วย</button>
                  </div>
                </div>
                {cmp.error ? (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '10px 12px', borderRadius: 8, fontSize: 12.5 }}>
                    {cmp.missing && cmp.missing.length ? (
                      <>⚠️ <strong>ข้อมูลไม่ครบ</strong> — ขาด: <strong>{cmp.missing.join(', ')}</strong> · เติมข้อมูลด้านล่างแล้วกดบันทึก</>
                    ) : (
                      <>
                        ⚠️ <strong>คำนวณอัตโนมัติไม่ได้: วันที่ขัดกัน</strong><br />
                        วันเริ่ม/รับเงิน (<strong>{fmtDate(cmp.start)}</strong>) อยู่หลังหรือเท่ากับวันสิ้นสุดงวดที่ใช้เทียบ (<strong>{fmtDate(cmp.end)}</strong>)
                        {' '}— วันสิ้นสุดมาจาก<strong>วันคืนเงินต้น/กิจกรรมล่าสุด</strong> แปลว่ามีการคืนเงินกู้ "ก่อน" วันเริ่มสัญญา ซึ่งเป็นไปไม่ได้
                        <br />👉 ตรวจว่าคีย์ <strong>วันเริ่ม/รับเงิน</strong> ผิด (แก้ด้านล่าง) หรือ <strong>วันที่คืนเงินต้น</strong> ผิด (กดดินสอแก้ที่ตาราง "รายการรับ/คืนเงินกู้")
                      </>
                    )}
                    {canEdit && <MissingFieldsEditor master={master} onSave={onSaveMasterFields} />}
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-500)' }}>ของเดิม (คีย์มือ)</div>
                        <div style={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(totalInterest, 2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10.5, color: 'var(--brand-700)' }}>คำนวณอัตโนมัติ</div>
                        <div style={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums', color: 'var(--brand-700)' }}>{fmtNum(cmp.total, 2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-500)' }}>ผลต่าง</div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: matched ? 'var(--good)' : 'var(--bad)' }}>
                          {matched ? '✓ ตรงกัน' : (diff > 0 ? '+' : '') + fmtNum(diff, 2)}
                        </div>
                      </div>
                    </div>
                    {extracted.length > 0 && (
                      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1a592f', padding: '6px 10px', borderRadius: 7, fontSize: 11.5, marginBottom: 10 }}>
                        ℹ️ ดึงคืนเงินต้น <strong>{extracted.length}</strong> รายการจากตารางเดิมมาใช้คำนวณ (สัญญานี้ยังไม่มีใน "รายการรับ/คืนเงินกู้") — จะถูกบันทึกเมื่อกด "ใช้แบบอัตโนมัติ"
                      </div>
                    )}
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--ink-100)', borderRadius: 8 }}>
                      <table className="tbl tbl-compact" style={{ width: '100%', fontSize: 11.5 }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}><tr>
                          <th>เดือน</th>
                          <th style={{ textAlign: 'right' }}>เงินต้น</th>
                          <th style={{ textAlign: 'right' }}>วัน</th>
                          <th style={{ textAlign: 'right' }}>ดอกเบี้ย</th>
                          <th style={{ textAlign: 'right' }}>คงเหลือ</th>
                        </tr></thead>
                        <tbody>
                          {cmp.rows.map((r, i) => {
                            const split = i > 0 && cmp.rows[i - 1].year === r.year && cmp.rows[i - 1].month === r.month;
                            return (
                            <tr key={i} style={split ? { background: 'color-mix(in oklch, var(--brand-500) 4%, transparent)' } : undefined}>
                              <td style={{ whiteSpace: 'nowrap', fontWeight: 600, color: split ? 'var(--ink-400)' : undefined }}>
                                {split ? '↳ ' : ''}{TH_MONTH[r.month]} {r.year}
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtNum(r.principal, 0)}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.days}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtNum(r.interest, 2)}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(r.balanceAfter, 0)}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ink-100)', fontSize: 11.5, color: 'var(--ink-500)', lineHeight: 1.7 }}>
                      {sortedRows.length === 0
                        ? <>สัญญานี้ยังไม่มีตารางดอกเบี้ยเลย — ตรวจตัวเลขข้างบนให้ตรงก่อน แล้วกดปุ่มเขียวเพื่อสร้างตาราง</>
                        : matched
                        ? <><strong style={{ color: 'var(--good)' }}>✓ วิธีคิดนี้ตรงกับข้อมูลเดิม</strong> — ตารางนี้พร้อมสลับเป็น "คำนวณอัตโนมัติ"</>
                        : <>ปรับ "วิธีคิด" จนผลต่าง = <strong style={{ color: 'var(--good)' }}>✓ ตรงกัน</strong> (ส่วนต่างเล็กน้อยใช้ปุ่มแก้ดอกเบี้ยรายเดือนปรับได้)</>}
                      {/* onAdoptAuto ต้องมีจริงถึงจะโชว์ปุ่ม — หน้าที่ลืมส่ง prop จะได้ "ไม่มีปุ่ม"
                          (เห็นชัด) แทน "ปุ่มกดแล้วเงียบสนิท" (จับไม่ได้เลย) */}
                      {canEdit && onAdoptAuto && (
                        <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => {
                              const msg = `ใช้แบบอัตโนมัติกับสัญญา ${master.contractNo}?\n\n`
                                + `• สร้างตารางดอกเบี้ย ${cmp.rows.length} เดือน · รวม ${fmtNum(cmp.total, 2)} บาท\n`
                                + `• วิธีคิด ${cmpMethod} · ${cmpDayCount === 'include_end' ? 'นับวันคืนด้วย' : 'ไม่นับวันคืน'}\n`
                                + (sortedRows.length ? `• เขียนทับตารางเดิม ${sortedRows.length} แถว (วันจ่าย + ยอดที่แก้มือไว้ ยังอยู่)\n` : '')
                                + `\nเดือนถัดไปกด "อัปเดตถึงเดือนล่าสุด" เพื่อเดินดอกต่อ`;
                              if (confirm(msg)) onAdoptAuto && onAdoptAuto(master, sortedRows, { method: cmpMethod, dayCount: cmpDayCount });
                            }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8,
                                     cursor: 'pointer', border: '1px solid #059669', background: '#10b981', color: '#fff',
                                     fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit' }}>
                            ✅ ใช้แบบอัตโนมัติจริง — สร้างตารางดอกเบี้ย {cmp.rows.length} เดือน
                          </button>
                          <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
                            เขียนลงตารางข้างบนจริง · แก้ดอกเบี้ยรายเดือน/ลบแถว ทีหลังได้
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
        )}
        </>)}
      </Modal>

      {/* nested popups */}
      <PaymentConfirmPopup
        open={confirmOpen}
        master={master}
        selectedRows={selectedRows}
        onClose={() => setConfirmOpen(false)}
        onConfirm={({ payDate, note }) => {
          onSavePayments(selectedRows, { payDate, note });
          setConfirmOpen(false);
          setSelectedIds(new Set());
        }}
      />
      <InterestPaymentModal
        open={!!payModalRow}
        row={payModalRow}
        master={master}
        onClose={() => setPayModalRow(null)}
        onSave={(payments) => {
          onSaveInterestPayments && onSaveInterestPayments(payModalRow, payments);
          setPayModalRow(null);
        }}
      />
      <InterestOverridePopup
        open={!!overrideRow}
        row={overrideRow}
        onClose={() => setOverrideRow(null)}
        onSave={(value, note) => {
          onOverrideInterest(overrideRow, value, note);
          setOverrideRow(null);
        }}
      />
      <PrincipalEventModal
        open={!!evtModal}
        kind={evtModal && evtModal.kind}
        editEvent={evtModal && evtModal.event}
        master={master}
        onClose={() => setEvtModal(null)}
        onSave={(payload) => {
          if (evtModal && evtModal.event) {
            onEditEvent && onEditEvent(evtModal.event.id, master, payload);
          } else {
            onAddPrincipalEvent && onAddPrincipalEvent(master, payload);
          }
          setEvtModal(null);
        }}
      />
      <RolloverModal
        open={rolloverOpen}
        master={master}
        onClose={() => setRolloverOpen(false)}
        onSave={(payload) => {
          onRollover && onRollover(master, payload);
          setRolloverOpen(false);
          onClose && onClose();
        }}
      />
      <AddLedgerRowModal
        open={addRowOpen}
        master={master}
        ledgerRows={sortedRows}
        onClose={() => setAddRowOpen(false)}
        onSave={(payload) => {
          onAddLedgerRow && onAddLedgerRow(master, payload);
          setAddRowOpen(false);
        }}
      />
    </>
  );
}

// ── ภาพรวมการจ่ายดอกเบี้ย (ทุกสัญญา) — ยอดรวม + ตามเจ้าหนี้ (กางดูรายย่อย) + ประวัติรายวัน ──
function InterestOverviewModal({ open, masters, ledgerByContract, onClose }) {
  const [view, setView] = React.useState('creditor');      // 'creditor' | 'log'
  const [expanded, setExpanded] = React.useState({});      // creditor name → เปิด/ปิด
  const agg = React.useMemo(() => {
    const rounds = [];            // ทุกรอบจ่ายแบบแบน
    const byCreditor = {};
    let totalInterest = 0, totalPaid = 0;
    (masters || []).forEach(m => {
      const rows = (ledgerByContract && ledgerByContract[m.contractNo]) || [];
      const name = ((m.borrowerName || '').trim()) || '—';
      const c = byCreditor[name] || (byCreditor[name] = { name, contracts: new Set(), total: 0, paid: 0, rounds: [] });
      c.contracts.add(m.contractNo);
      rows.forEach(r => {
        const eff = effectiveInterest(r);
        totalInterest += eff; c.total += eff;
        interestPayments(r).forEach(p => {
          const amt = Number(p.amount) || 0;
          if (amt <= 0) return;
          const rec = { payDate: p.date || '', amount: amt, note: p.note || '', contractNo: m.contractNo,
                        borrowerName: name, debtCategory: m.debtCategory || '',
                        monthLabel: (TH_MONTH[Number(r.month)] || r.month) + ' ' + r.year };
          rounds.push(rec); c.rounds.push(rec);
          totalPaid += amt; c.paid += amt;
        });
      });
    });
    rounds.sort((x, y) => (y.payDate || '').localeCompare(x.payDate || ''));
    const creditors = Object.values(byCreditor)
      .map(c => ({ name: c.name, contractCount: c.contracts.size, total: c.total, paid: c.paid,
                   outstanding: Math.max(0, c.total - c.paid),
                   rounds: c.rounds.slice().sort((x, y) => (y.payDate || '').localeCompare(x.payDate || '')) }))
      .filter(c => c.total > 0.005 || c.paid > 0.005)
      .sort((x, y) => y.paid - x.paid);
    const payDays = new Set(rounds.map(r => r.payDate).filter(Boolean)).size;
    return { rounds, creditors, totalInterest, totalPaid, totalOutstanding: Math.max(0, totalInterest - totalPaid), roundCount: rounds.length, payDays };
  }, [masters, ledgerByContract]);
  if (!open) return null;
  const toggle = (k) => setExpanded(e => ({ ...e, [k]: !e[k] }));
  const kpi = (label, value, color) => (
    <div style={{ flex: '1 1 150px', padding: '10px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--ink-100)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: color || 'var(--ink-800)' }}>{value}</div>
    </div>
  );
  return (
    <Modal open={open} maxWidth={980} wide title="📊 ภาพรวมการจ่ายดอกเบี้ย (ทุกสัญญา)" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>ปิด</button>}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {kpi('ดอกเบี้ยรวมทั้งหมด', fmtNum(agg.totalInterest, 2))}
        {kpi('จ่ายแล้ว', fmtNum(agg.totalPaid, 2), 'var(--good)')}
        {kpi('ค้างจ่าย', fmtNum(agg.totalOutstanding, 2), 'var(--bad)')}
        {kpi('จำนวนรอบจ่าย', `${agg.roundCount} รอบ · ${agg.payDays} วัน`)}
      </div>
      <div style={{ display: 'inline-flex', gap: 4, marginBottom: 12, background: 'var(--ink-100, #eef1f6)', borderRadius: 9, padding: 3, border: '1px solid var(--line)' }}>
        {[{ k: 'creditor', l: '👤 ตามเจ้าหนี้' }, { k: 'log', l: '📅 ตามวันจ่าย' }].map(t => (
          <button key={t.k} type="button" onClick={() => setView(t.k)}
            style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                     background: view === t.k ? 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' : 'transparent',
                     color: view === t.k ? '#fff' : 'var(--ink-500)' }}>{t.l}</button>
        ))}
      </div>

      {view === 'creditor' ? (
        <div style={{ borderRadius: 10, border: '1px solid var(--ink-100)', overflow: 'hidden' }}>
          <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
            <thead><tr>
              <th style={{ width: 24 }}></th><th>เจ้าหนี้</th>
              <th style={{ textAlign: 'center', width: 70 }}>สัญญา</th>
              <th style={{ textAlign: 'right' }}>ดอกเบี้ยรวม</th>
              <th style={{ textAlign: 'right' }}>จ่ายแล้ว</th>
              <th style={{ textAlign: 'right' }}>ค้าง</th>
            </tr></thead>
            <tbody>
              {agg.creditors.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-400)' }}>ยังไม่มีข้อมูล</td></tr>}
              {agg.creditors.map(c => (
                <React.Fragment key={c.name}>
                  <tr onClick={() => toggle(c.name)} style={{ cursor: 'pointer' }}>
                    <td style={{ textAlign: 'center', color: 'var(--ink-400)' }}>{expanded[c.name] ? '▾' : '▸'}</td>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td style={{ textAlign: 'center' }}>{c.contractCount}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(c.total, 2)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{fmtNum(c.paid, 2)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: c.outstanding > 0.005 ? 'var(--bad)' : 'var(--ink-300)' }}>{fmtNum(c.outstanding, 2)}</td>
                  </tr>
                  {expanded[c.name] && (
                    <tr><td colSpan={6} style={{ padding: 0, background: 'var(--ink-25, #fafbfc)' }}>
                      <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
                        <thead><tr style={{ color: 'var(--ink-400)' }}>
                          <th style={{ textAlign: 'left', padding: '4px 10px 4px 40px' }}>วันจ่าย</th>
                          <th style={{ textAlign: 'left' }}>สัญญา</th><th style={{ textAlign: 'left' }}>เดือนดอกเบี้ย</th>
                          <th style={{ textAlign: 'right' }}>จำนวน</th><th style={{ textAlign: 'left', paddingRight: 10 }}>โน้ต</th>
                        </tr></thead>
                        <tbody>
                          {c.rounds.length === 0 && <tr><td colSpan={5} style={{ padding: '6px 40px', color: 'var(--ink-400)' }}>ยังไม่มีการจ่าย</td></tr>}
                          {c.rounds.map((p, i) => (
                            <tr key={i}>
                              <td style={{ padding: '3px 10px 3px 40px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{p.payDate ? fmtDate(p.payDate) : '—'}</td>
                              <td style={{ fontFamily: 'ui-monospace', fontSize: 10.5 }}>{p.contractNo}</td>
                              <td>{p.monthLabel}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtNum(p.amount, 2)}</td>
                              <td style={{ color: 'var(--ink-500)', paddingRight: 10 }}>{p.note || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800, background: 'var(--ink-50)', borderTop: '2px solid var(--ink-200)' }}>
                <td></td><td>รวมทั้งหมด</td><td></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(agg.totalInterest, 2)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{fmtNum(agg.totalPaid, 2)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--bad)' }}>{fmtNum(agg.totalOutstanding, 2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div style={{ borderRadius: 10, border: '1px solid var(--ink-100)', overflow: 'hidden', maxHeight: '55vh', overflowY: 'auto' }}>
          <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}><tr>
              <th style={{ width: 108 }}>วันจ่าย</th><th>เจ้าหนี้</th><th>สัญญา</th><th>เดือนดอกเบี้ย</th>
              <th style={{ textAlign: 'right' }}>จำนวน</th><th>โน้ต</th>
            </tr></thead>
            <tbody>
              {agg.rounds.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--ink-400)' }}>ยังไม่มีการจ่าย</td></tr>}
              {agg.rounds.map((p, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{p.payDate ? fmtDate(p.payDate) : '—'}</td>
                  <td style={{ fontWeight: 600 }}>{p.borrowerName}</td>
                  <td style={{ fontFamily: 'ui-monospace', fontSize: 10.5 }}>{p.contractNo}</td>
                  <td>{p.monthLabel}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--good)' }}>{fmtNum(p.amount, 2)}</td>
                  <td style={{ color: 'var(--ink-500)' }}>{p.note || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ fontWeight: 800, background: 'var(--ink-50)', borderTop: '2px solid var(--ink-200)' }}>
              <td colSpan={4}>รวมจ่ายทั้งหมด ({agg.roundCount} รอบ)</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{fmtNum(agg.totalPaid, 2)}</td><td></td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ── Export options popup ────────────────────────────────────────────────────
function ExportOptionsModal({ open, masters, summaryByContract, ledgerByContract, eventsByContract, onClose }) {
  const [mode,     setMode]     = React.useState('summary'); // summary | detail
  const [scope,    setScope]    = React.useState('active');  // all | active | selected
  const [selected, setSelected] = React.useState(new Set());
  const [search,   setSearch]   = React.useState('');
  const [catSet,   setCatSet]   = React.useState(new Set()); // หมวดหนี้ (เลือกได้หลายหมวด · ว่าง = ทุกหมวด)
  const [statusF,  setStatusF]  = React.useState('all');     // all | Active | Close
  if (!open) return null;
  const scoped = scope === 'all' ? masters
    : scope === 'active' ? masters.filter(m => m.status === 'Active')
    : masters.filter(m => selected.has(m.contractNo));
  // หมวดที่มีอยู่จริง (เรียงตามจำนวนสัญญา)
  const cats = [...new Set(masters.map(m => m.debtCategory).filter(Boolean))]
    .sort((a, b) => masters.filter(m => m.debtCategory === b).length - masters.filter(m => m.debtCategory === a).length);
  const toggleCat = (c) => setCatSet(s => {
    const n = new Set(s);
    if (n.has(c)) n.delete(c); else n.add(c);
    return n;
  });
  // รายการที่ตรงกับหมวด(หลายหมวด) + สถานะ + คำค้น (ใช้ในโหมด "เลือกเอง")
  const q = search.trim().toLowerCase();
  const filteredList = masters.filter(m => {
    if (catSet.size > 0 && !catSet.has(m.debtCategory)) return false;
    if (statusF !== 'all' && (m.status === 'Active' ? 'Active' : 'Close') !== statusF) return false;
    if (!q) return true;
    return (m.contractNo || '').toLowerCase().includes(q) ||
           (m.borrowerName || '').toLowerCase().includes(q);
  });
  const allFilteredSelected = filteredList.length > 0 && filteredList.every(m => selected.has(m.contractNo));
  const toggleAllFiltered = () => {
    setSelected(s => {
      const n = new Set(s);
      if (allFilteredSelected) filteredList.forEach(m => n.delete(m.contractNo));
      else filteredList.forEach(m => n.add(m.contractNo));
      return n;
    });
  };
  const handleExport = () => {
    if (!scoped.length) { alert('ไม่มีสัญญาที่จะ export'); return; }
    exportPerContractSheets({ masters: scoped, ledgerByContract, eventsByContract, mode });
    onClose();
  };
  return (
    <Modal
      open={open}
      maxWidth={720}
      title="ส่งออก Excel — เลือกรูปแบบ"
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={handleExport}>
          <Icon name="download" size={14} /> ส่งออก {scoped.length} สัญญา
        </button>
      </>}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>1. รูปแบบไฟล์</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { k: 'summary', icon: '📊', title: 'สรุปอย่างเดียว', desc: '1 sheet · 1 แถวต่อสัญญา · เร็ว เหมาะกับรายงานภาพรวม' },
            { k: 'detail',  icon: '📑', title: 'แยกแต่ละสัญญา', desc: 'สรุป + 1 sheet ต่อสัญญา · แสดงดอกเบี้ยทุกเดือน + ประวัติจ่าย' },
          ].map(o => {
            const active = mode === o.k;
            return (
              <button key={o.k} onClick={() => setMode(o.k)}
                style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                  border: `2px solid ${active ? 'var(--brand-500)' : 'var(--ink-100)'}`,
                  background: active ? 'color-mix(in oklch, var(--brand-500) 7%, transparent)' : '#fff',
                }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{o.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: active ? 'var(--brand-700)' : 'var(--ink-700)' }}>{o.title}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 3 }}>{o.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>2. เลือกสัญญาที่จะส่งออก</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[
            { k: 'active', label: `เฉพาะ Active (${masters.filter(m => m.status === 'Active').length})` },
            { k: 'all',    label: `ทั้งหมด (${masters.length})` },
            { k: 'selected', label: `เลือกเอง (${selected.size})` },
          ].map(o => {
            const active = scope === o.k;
            return (
              <button key={o.k} onClick={() => setScope(o.k)}
                style={{
                  padding: '5px 12px', borderRadius: 16, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${active ? 'var(--brand-500)' : 'var(--ink-200)'}`,
                  background: active ? 'var(--brand-50, #f0f6ff)' : '#fff',
                  color: active ? 'var(--brand-700)' : 'var(--ink-600)',
                }}>{o.label}</button>
            );
          })}
        </div>
        {scope === 'selected' && (
          <>
          {/* สถานะ */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, color: 'var(--ink-400)', fontWeight: 600, minWidth: 42 }}>สถานะ:</span>
            {[
              { k: 'all',    label: `ทั้งหมด (${masters.length})` },
              { k: 'Active', label: `Active (${masters.filter(m => m.status === 'Active').length})` },
              { k: 'Close',  label: `Close (${masters.filter(m => m.status !== 'Active').length})` },
            ].map(o => {
              const on = statusF === o.k;
              return (
                <button key={o.k} onClick={() => setStatusF(o.k)}
                  style={{ padding: '3px 11px', borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                           border: `1.5px solid ${on ? 'var(--brand-500)' : 'var(--ink-200)'}`,
                           background: on ? 'var(--brand-50, #f0f6ff)' : '#fff',
                           color: on ? 'var(--brand-700)' : 'var(--ink-600)' }}>{o.label}</button>
              );
            })}
          </div>
          {/* หมวด (เลือกได้หลายหมวด) */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: 'var(--ink-400)', fontWeight: 600, minWidth: 42 }}>หมวด:</span>
            <button onClick={() => setCatSet(new Set())}
              style={{ padding: '3px 11px', borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                       border: `1.5px solid ${catSet.size === 0 ? 'var(--brand-500)' : 'var(--ink-200)'}`,
                       background: catSet.size === 0 ? 'var(--brand-50, #f0f6ff)' : '#fff',
                       color: catSet.size === 0 ? 'var(--brand-700)' : 'var(--ink-500)' }}>ทุกหมวด</button>
            {cats.map(c => {
              const on = catSet.has(c);
              const color = DL_CATEGORY_COLOR[c] || '#525252';
              const bg    = DL_CATEGORY_BG[c]    || '#f5f5f5';
              return (
                <button key={c} onClick={() => toggleCat(c)}
                  style={{ padding: '3px 11px', borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                           border: `1.5px solid ${on ? color : 'var(--line)'}`,
                           background: on ? bg : '#fff', color: on ? color : 'var(--ink-500)' }}>
                  {c} ({masters.filter(m => m.debtCategory === c).length})
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <div className="tb-search" style={{ flex: 1 }}>
              <Icon name="search" size={14} />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหา เลขสัญญา / ชื่อผู้กู้…" />
            </div>
            <button onClick={toggleAllFiltered}
              style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                       border: '1.5px solid var(--brand-300)', background: 'var(--brand-50, #f0f6ff)', color: 'var(--brand-700)', whiteSpace: 'nowrap' }}>
              {allFilteredSelected ? 'เอาออกทั้งหมด' : `เลือกทั้งหมด (${filteredList.length})`}
            </button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--ink-100)', borderRadius: 8 }}>
            {filteredList.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-400)', fontSize: 12 }}>ไม่พบสัญญาที่ตรงกับเงื่อนไข</div>
            )}
            {filteredList.map((m, i) => {
              const checked = selected.has(m.contractNo);
              return (
                <label key={(m.contractNo || '') + '|' + (m.id || i)} style={{
                  display: 'flex', gap: 8, padding: '6px 10px', cursor: 'pointer',
                  borderBottom: '1px solid var(--ink-50)',
                  background: checked ? 'color-mix(in oklch, var(--brand-500) 5%, transparent)' : '',
                }}>
                  <input type="checkbox" checked={checked} onChange={() => setSelected(s => {
                    const n = new Set(s);
                    if (n.has(m.contractNo)) n.delete(m.contractNo); else n.add(m.contractNo);
                    return n;
                  })} />
                  <span style={{ fontFamily: 'ui-monospace', fontSize: 11.5, color: 'var(--brand-700)', minWidth: 140 }}>{m.contractNo}</span>
                  <span style={{ fontSize: 12, flex: 1 }}>{m.borrowerName}</span>
                  <Badge kind={m.status === 'Active' ? 'b-blue' : 'b-gray'} dot={false}>
                    {m.status === 'Active' ? 'Active' : 'Close'}
                  </Badge>
                </label>
              );
            })}
          </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── เครื่องมือ "ซ่อมรายการดอกเบี้ยกำพร้า" ────────────────────────────────────
// แสดงกลุ่มแถวดอกเบี้ยที่หลุดจากสัญญา (orphan) + ให้เลือกสัญญาปลายทาง แล้วย้ายกลับ (ไม่ลบอะไร)
function OrphanRepairModal({ open, orphanGroups, masters, onClose, onRelink }) {
  const [pick, setPick] = React.useState({});   // { [oldNo]: masterId | '' } (init จาก suggested)
  React.useEffect(() => {
    if (!open) return;
    const init = {};
    (orphanGroups || []).forEach(g => { init[g.contractNo] = g.suggested ? g.suggested.id : ''; });
    setPick(init);
  }, [open, orphanGroups]);
  if (!open) return null;

  const sortedMasters = [...(masters || [])].sort((a, b) =>
    String(a.contractNo || '').localeCompare(String(b.contractNo || ''), 'th'));
  const chosen = (orphanGroups || []).filter(g => pick[g.contractNo]);
  const totalRows = chosen.reduce((s, g) => s + g.count, 0);

  return (
    <Modal
      open={open}
      maxWidth={760}
      title="🔧 ซ่อมรายการดอกเบี้ยกำพร้า"
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ปิด</button>
        <button className="btn btn-primary" disabled={!chosen.length}
          onClick={() => {
            const pairs = chosen.map(g => ({ oldNo: g.contractNo, masterId: pick[g.contractNo] }));
            const lines = chosen.map(g => {
              const m = sortedMasters.find(x => x.id === pick[g.contractNo]);
              return `• ${g.contractNo} (${g.count} แถว) → ${m ? m.contractNo : '?'}`;
            }).join('\n');
            if (confirm(`ย้าย ${totalRows} แถว กลับเข้าสัญญา:\n\n${lines}\n\n(ใช้ id เดิม upsert ทับ · ไม่มีการลบข้อมูล)`))
              onRelink(pairs);
          }}>
          <Icon name="check" size={14} /> ย้าย {totalRows} แถวกลับเข้าสัญญา
        </button>
      </>}
    >
      <div style={{ padding: 12, marginBottom: 12, borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 12.5, color: 'var(--ink-700)', lineHeight: 1.7 }}>
        พบรายการดอกเบี้ยที่ <strong>หลุดจากสัญญา</strong> (เลขสัญญาเดิมไม่ตรงกับสัญญาไหนแล้ว — มักเกิดจากแก้เลขสัญญาภายหลัง)
        <br />เลือกสัญญาปลายทางให้แต่ละกลุ่ม แล้วกดย้าย — <strong>ใช้ id เดิม upsert ทับ ไม่มีการลบ</strong> และเติม contractId ให้ด้วยเพื่อไม่ให้หลุดอีก
      </div>

      {(!orphanGroups || !orphanGroups.length) ? (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--good)', fontWeight: 600 }}>✓ ไม่มีรายการกำพร้า</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orphanGroups.map(g => {
            const sel = pick[g.contractNo] || '';
            return (
              <div key={g.contractNo} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1.3fr', gap: 10, alignItems: 'center',
                padding: '10px 12px', borderRadius: 9, border: '1px solid var(--ink-100)', background: 'var(--surface)' }}>
                <div>
                  <div style={{ fontFamily: 'ui-monospace', fontWeight: 700, fontSize: 12.5 }}>{g.contractNo}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>{g.count} แถว · จ่ายแล้ว {g.paid}</div>
                </div>
                <div style={{ fontSize: 16, color: 'var(--ink-300)' }}>→</div>
                <div>
                  <select value={sel} onChange={e => setPick(p => ({ ...p, [g.contractNo]: e.target.value }))}
                    style={{ width: '100%', padding: '6px 9px', borderRadius: 7, fontSize: 12,
                      border: `1.5px solid ${sel ? 'var(--brand-400, #7ca8e6)' : 'var(--ink-200)'}`,
                      background: sel ? 'var(--brand-50, #f0f6ff)' : '#fff' }}>
                    <option value="">— ข้าม (ไม่ย้าย) —</option>
                    {sortedMasters.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.contractNo}{m.borrowerName ? ` · ${m.borrowerName}` : ''}
                      </option>
                    ))}
                  </select>
                  {g.suggested && sel === g.suggested.id
                    ? <div style={{ fontSize: 10.5, color: 'var(--good)', marginTop: 3 }}>✓ ระบบเดาให้ (ตรวจก่อนกดได้)</div>
                    : !g.suggested
                    ? <div style={{ fontSize: 10.5, color: '#b45309', marginTop: 3 }}>⚠️ เดาไม่ได้ — เลือกเอง</div>
                    : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
function DebtLedgerPage({ data, setData, toast }) {
  const masters    = data?.debtMaster || [];
  const allLedger  = data?.debtLedger || [];
  const allEvents  = data?.debtEvents || [];
  const today      = new Date().toISOString().slice(0, 10);
  const canEdit    = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;

  const summaryByContract = React.useMemo(() => buildInterestByContract(allLedger), [allLedger]);
  const ledgerByContract  = React.useMemo(() => {
    const m = {};
    allLedger.forEach(r => { (m[r.contractNo] = m[r.contractNo] || []).push(r); });
    return m;
  }, [allLedger]);
  const eventsByContract  = React.useMemo(() => {
    const m = {};
    allEvents.forEach(e => { if (e.contractNo) (m[e.contractNo] = m[e.contractNo] || []).push(e); });
    return m;
  }, [allEvents]);
  // แถวดอกเบี้ยที่ "หลุดจากสัญญา" (contractNo/contractId ไม่ match สัญญาไหนเลย) — สำหรับเครื่องมือซ่อม
  const orphanGroups = React.useMemo(() => computeDebtOrphans(allLedger, masters), [allLedger, masters]);
  const orphanRowCount = orphanGroups.reduce((s, g) => s + g.count, 0);

  const [tab, setTab]                       = React.useState('Active');  // all | Active | Close
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [query, setQuery]                   = React.useState('');
  const [selectedMaster, setSelectedMaster] = React.useState(null);
  const [colFilters, setColFilters]         = React.useState({});
  const [openCol,    setOpenCol]            = React.useState(null);
  const [exportOpen, setExportOpen]         = React.useState(false);
  const [overviewOpen, setOverviewOpen]     = React.useState(false);
  const [repairOpen, setRepairOpen]         = React.useState(false);   // เครื่องมือซ่อมรายการกำพร้า

  // ── Cross-page focus: open contract specified by #debt page button ───────
  React.useEffect(() => {
    const cn = window.__wtpFocusDebtContract;
    if (!cn) return;
    delete window.__wtpFocusDebtContract;
    const m = masters.find(x => x.contractNo === cn);
    if (m) setSelectedMaster(m);
  }, [masters]);

  const categoriesPresent = [...new Set(masters.map(m => m.debtCategory).filter(Boolean))];

  // ── KPIs (only Active contracts) ──────────────────────────────────────────
  const activeMasters = masters.filter(m => m.status === 'Active');
  let totalOutstanding = 0, totalPaid = 0, totalInterest = 0;
  activeMasters.forEach(m => {
    const s = summaryByContract[m.contractNo];
    if (!s) return;
    totalOutstanding += s.outstandingInterest;
    totalPaid        += s.paidInterest;
    totalInterest    += s.totalInterest;
  });

  // ── แจ้งเตือนสัญญาครบกำหนด — เฉพาะสัญญา Active ที่ใกล้/เลย maturityDate (ภายใน 60 วัน)
  //    ช่วยตรวจว่าต่อสัญญา / ขยายเวลา / เปลี่ยนสัญญาแล้วหรือยัง (สัญญาเยอะ ต้องการตัวช่วยกวาดตา)
  const maturityAlerts = (() => {
    const todayD = new Date(today + 'T00:00:00');
    const out = [];
    activeMasters.forEach(m => {
      if (!m.maturityDate) return;
      const d = new Date(String(m.maturityDate).slice(0, 10) + 'T00:00:00');
      if (isNaN(d)) return;
      const days = Math.round((d - todayD) / 86400000);
      if (days <= 60) out.push({ m, days });
    });
    return out.sort((a, b) => a.days - b.days);
  })();
  const matOverdue = maturityAlerts.filter(a => a.days < 0).length;

  const colDisplayVal = (m, key) => {
    const s = summaryByContract[m.contractNo] || {};
    switch (key) {
      case 'debtCategory': return m.debtCategory || '—';
      case 'status':       return m.status === 'Active' ? 'Active' : 'Close';
      case 'borrowerName': return m.borrowerName || '—';
      case 'receiveDate':  return fmtDate(m.receiveDate) || '—';
      case 'totalInterest':    return String(Math.round(s.totalInterest || 0));
      case 'outstandingInterest': return String(Math.round(s.outstandingInterest || 0));
      default: {
        const v = m[key];
        return (v == null || v === '' || v === '—') ? '—' : String(v);
      }
    }
  };

  // ── Sort (คลิกหัวคอลัมน์ได้ทุกคอลัมน์) ──────────────────────────────────────
  const [sort, setSort] = React.useState({ key: 'outstandingInterest', dir: 'desc' });
  const toggleSort = (key) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const sortVal = (m, key) => {
    const s = summaryByContract[m.contractNo] || {};
    switch (key) {
      case 'principalAmount':     return Number(m.principalAmount) || 0;
      case 'interestRate':        return Number(m.interestRate) || 0;
      case 'totalInterest':       return s.totalInterest || 0;
      case 'paidInterest':        return s.paidInterest || 0;
      case 'outstandingInterest': return s.outstandingInterest || 0;
      case 'status':              return m.status === 'Active' ? 'Active' : 'Close';
      case 'receiveDate':         return m.receiveDate || m.startDate || '';
      default:                    return m[key] != null ? m[key] : '';
    }
  };

  const filtered = React.useMemo(() => {
    let rows = masters;
    if (tab !== 'all')             rows = rows.filter(m => m.status === tab);
    if (categoryFilter !== 'all')  rows = rows.filter(m => m.debtCategory === categoryFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(m =>
        (m.contractNo   || '').toLowerCase().includes(q) ||
        (m.borrowerName || '').toLowerCase().includes(q)
      );
    }
    for (const [key, vals] of Object.entries(colFilters)) {
      if (vals && vals.size > 0) rows = rows.filter(r => vals.has(colDisplayVal(r, key)));
    }
    return rows;
  }, [masters, tab, categoryFilter, query, colFilters]);

  // เรียงตามคอลัมน์ที่เลือก (ดีฟอลต์ = ดอกเบี้ยค้างชำระมาก→น้อย)
  const sortedRows = React.useMemo(() => {
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = sortVal(a, key), bv = sortVal(b, key);
      if ((av === '' || av == null) && (bv === '' || bv == null)) return 0;
      if (av === '' || av == null) return 1;
      if (bv === '' || bv == null) return -1;
      const cmp = (typeof av === 'number' && typeof bv === 'number')
        ? av - bv
        : String(av).localeCompare(String(bv), 'th');
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sort, summaryByContract]);

  const selectedLedger = React.useMemo(() => {
    if (!selectedMaster) return [];
    return allLedger.filter(r => debtRowMatchesContract(r, selectedMaster));
  }, [selectedMaster, allLedger]);

  // ── Mutations (shared hook) ─────────────────────────────────────────────
  const actions = useDebtContractActions(setData, toast);
  const { savePayments, saveInterestPayments, clearPayment, overrideInterest, addPrincipalEvent,
          editPrincipalEvent, deletePrincipalEvent, deleteLedgerRow, addLedgerRow, relinkOrphans,
          adoptAutoMode, setAutoMode, saveMasterFields, doRollover, setContractStatus } = actions;

  // Refresh selectedMaster from store (so popup reflects latest state)
  React.useEffect(() => {
    if (!selectedMaster) return;
    const fresh = masters.find(m => m.id === selectedMaster.id || m.contractNo === selectedMaster.contractNo);
    if (fresh && fresh !== selectedMaster) setSelectedMaster(fresh);
    // eslint-disable-next-line
  }, [masters]);

  return (
    <div className="page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">Debt Ledger · ดอกเบี้ย</h1>
          <div className="page-sub">
            ณ {fmtDate(today)} · {masters.length} สัญญา · Active {activeMasters.length} · ตารางดอกเบี้ย {allLedger.length} แถว
          </div>
        </div>
        <div className="page-head-r">
          <button className="btn btn-ghost" onClick={() => setOverviewOpen(true)}
            title="ภาพรวมการจ่ายดอกเบี้ยทุกสัญญา — ยอดรวม + ตามเจ้าหนี้ + ประวัติรายวัน">
            📊 ภาพรวมจ่ายดอกเบี้ย
          </button>
          <button className="btn btn-ghost" onClick={() => setExportOpen(true)}
            title="ส่งออก Excel (เลือกรูปแบบ: สรุป หรือ แยกแต่ละสัญญา)">
            <Icon name="download" size={14} /> Excel
          </button>
          <PrintButton />
        </div>
      </div>

      <div className="grid grid-4 anim-stagger" style={{ marginBottom: 16 }}>
        <KpiTile animate={false} label="ดอกเบี้ยค้างชำระ"       value={totalOutstanding}     accent="var(--bad)"            icon="money" />
        <KpiTile animate={false} label="ดอกเบี้ยชำระแล้ว"       value={totalPaid}            accent="var(--good)"           icon="coin" />
        <KpiTile animate={false} label="ดอกเบี้ยรวม (คำนวณ)"    value={totalInterest}        accent="oklch(52% 0.16 145)"   icon="arrow_up" />
        <KpiTile animate={false} label="สัญญา Active"            value={activeMasters.length} accent="var(--brand-500)"      icon="bank" unit=" สัญญา" digits={0} />
      </div>

      {/* ── ⚠️ รายการดอกเบี้ยกำพร้า (หลุดจากสัญญาเพราะ contractNo ไม่ตรง) — เครื่องมือซ่อม ── */}
      {canEdit && orphanGroups.length > 0 && (
        <div className="card anim-in" style={{ padding: '12px 16px', marginBottom: 12,
          borderLeft: '4px solid var(--bad)', background: 'color-mix(in oklch, var(--bad) 6%, var(--surface))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16 }}>🔧</span>
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--ink-800)' }}>
              พบรายการดอกเบี้ยหลุดจากสัญญา — {orphanRowCount} แถว ({orphanGroups.length} เลขสัญญา)
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>
              ข้อมูลไม่ได้หาย แค่เลขสัญญาไม่ตรง (มักเกิดจากแก้เลขสัญญาภายหลัง) — ย้ายกลับได้ ไม่มีการลบ
            </span>
            <button className="btn btn-primary" onClick={() => setRepairOpen(true)} style={{ marginLeft: 'auto' }}>
              🔧 ซ่อมรายการกำพร้า
            </button>
          </div>
        </div>
      )}

      {/* ── แจ้งเตือนสัญญาครบกำหนด (Active ที่ใกล้/เลยวันครบ ภายใน 60 วัน) ───────────── */}
      {maturityAlerts.length > 0 && (
        <div className="card anim-in" style={{ padding: '12px 16px', marginBottom: 12,
          borderLeft: `4px solid ${matOverdue ? 'var(--bad)' : 'oklch(70% 0.16 70)'}`,
          background: matOverdue ? 'color-mix(in oklch, var(--bad) 5%, var(--surface))' : 'color-mix(in oklch, oklch(70% 0.16 70) 7%, var(--surface))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>⏰</span>
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--ink-800)' }}>
              สัญญาครบกำหนด — ต้องตรวจสอบ {maturityAlerts.length} สัญญา
            </span>
            {matOverdue > 0 && (
              <span style={{ fontSize: 11, fontWeight: 800, background: 'var(--bad)', color: '#fff', borderRadius: 6, padding: '2px 8px' }}>
                เลยกำหนดแล้ว {matOverdue}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: 'var(--ink-500)', marginLeft: 'auto' }}>ต่อสัญญา / ขยายเวลา / เปลี่ยนสัญญาแล้วหรือยัง?</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {maturityAlerts.map(({ m, days }) => {
              const over = days < 0, urgent = days >= 0 && days <= 30;
              const col  = over ? 'var(--bad)' : urgent ? 'oklch(58% 0.16 60)' : 'var(--brand-600)';
              const bg   = over ? 'color-mix(in oklch, var(--bad) 12%, #fff)' : urgent ? 'color-mix(in oklch, oklch(70% 0.16 60) 16%, #fff)' : 'color-mix(in oklch, var(--brand-500) 10%, #fff)';
              return (
                <button key={m.id || m.contractNo} onClick={() => setSelectedMaster(m)}
                  title="เปิดดูสัญญา"
                  style={{ textAlign: 'left', cursor: 'pointer', border: `1px solid ${col}`, background: bg,
                    borderRadius: 9, padding: '6px 10px', fontFamily: 'inherit', minWidth: 180 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink-800)' }}>
                    {m.contractNo || '—'} {m.borrowerName ? `· ${m.borrowerName}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: col, fontWeight: 700, marginTop: 2 }}>
                    ครบ {fmtDate(m.maturityDate)} · {over ? `เลย ${Math.abs(days)} วัน` : days === 0 ? 'ครบวันนี้!' : `อีก ${days} วัน`}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tabnav" style={{ flex: 'none' }}>
          <button className={tab === 'Active' ? 'active' : ''} onClick={() => setTab('Active')}>Active ({masters.filter(m => m.status==='Active').length})</button>
          <button className={tab === 'Close'  ? 'active' : ''} onClick={() => setTab('Close')}>ปิดแล้ว ({masters.filter(m => m.status!=='Active').length})</button>
          <button className={tab === 'all'    ? 'active' : ''} onClick={() => setTab('all')}>ทั้งหมด ({masters.length})</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 'none' }}>
          <button onClick={() => setCategoryFilter('all')}
            style={{
              padding: '4px 12px', borderRadius: 20, border: '1.5px solid', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              borderColor: categoryFilter === 'all' ? 'var(--brand-500)' : 'var(--line)',
              background:  categoryFilter === 'all' ? 'var(--brand-50, #f0f6ff)' : '#fff',
              color:       categoryFilter === 'all' ? 'var(--brand-700)' : 'var(--ink-500)',
            }}>ทุกหมวด</button>
          {categoriesPresent.map(cat => {
            const isSelected = categoryFilter === cat;
            const color = DL_CATEGORY_COLOR[cat] || '#525252';
            const bg    = DL_CATEGORY_BG[cat]    || '#f5f5f5';
            return (
              <button key={cat} onClick={() => setCategoryFilter(cat)}
                style={{
                  padding: '4px 12px', borderRadius: 20, border: '1.5px solid', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                  borderColor: isSelected ? color : 'var(--line)',
                  background:  isSelected ? bg : '#fff',
                  color:       isSelected ? color : 'var(--ink-500)',
                }}>{cat}</button>
            );
          })}
        </div>
        <div className="tb-search" style={{ width: 280, marginLeft: 'auto' }}>
          <Icon name="search" size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหา ผู้กู้ / สัญญา…" />
        </div>
      </div>

      {/* ── Active column filters chip bar ─────────────────────────────── */}
      {Object.keys(colFilters).some(k => colFilters[k] && colFilters[k].size > 0) && (
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
          padding: '6px 12px', marginBottom: 8,
          background: 'color-mix(in oklch,var(--brand-500) 7%,transparent)',
          border: '1px solid color-mix(in oklch,var(--brand-500) 25%,transparent)',
          borderRadius: 8, fontSize: 12,
        }}>
          <span style={{ color: 'var(--brand-700)', fontWeight: 600, fontSize: 11 }}>🔽 กรองอยู่:</span>
          {Object.entries(colFilters).filter(([, v]) => v && v.size > 0).map(([key, vals]) => {
            const labelMap = { debtCategory:'หมวด', contractNo:'เลขสัญญา', borrowerName:'ผู้กู้', status:'สถานะ', receiveDate:'วันเริ่ม' };
            const preview = [...vals].slice(0, 2).join(', ') + (vals.size > 2 ? ` +${vals.size - 2}` : '');
            return (
              <span key={key} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'var(--brand-500)', color: '#fff',
                borderRadius: 20, padding: '2px 8px', fontSize: 11,
              }}>
                <strong>{labelMap[key] || key}</strong>: {preview}
                <button onClick={() => setColFilters(p => { const n = {...p}; delete n[key]; return n; })}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, marginLeft: 2, fontSize: 13, lineHeight: 1 }}>×</button>
              </span>
            );
          })}
          <button onClick={() => setColFilters({})}
            style={{ background: 'none', border: '1px solid var(--brand-400)', color: 'var(--brand-700)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
            ล้างทั้งหมด
          </button>
        </div>
      )}

      {masters.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <div style={{ fontWeight: 600, color: 'var(--ink-600)' }}>ยังไม่มีข้อมูล debtMaster</div>
        </div>
      )}

      {masters.length > 0 && (
        <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'min(540px, calc(100vh - 380px))' }}>
            <table className="tbl tbl-compact" style={{ minWidth: 1200, tableLayout: 'fixed', width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' }}>
                <tr>
                  <FilterableColHeader label="หมวดหนี้" sortKey="debtCategory" colKey="debtCategory" sort={sort} sortToggle={toggleSort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={masters} getValue={colDisplayVal} width={100} align="center" />
                  <FilterableColHeader label="เลขที่สัญญา" sortKey="contractNo" colKey="contractNo" sort={sort} sortToggle={toggleSort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={masters} getValue={colDisplayVal} width={150} align="center" />
                  <FilterableColHeader label="ผู้กู้ / ผู้รับสินเชื่อ" sortKey="borrowerName" colKey="borrowerName" sort={sort} sortToggle={toggleSort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={masters} getValue={colDisplayVal} align="center" />
                  <FilterableColHeader label="สถานะ" sortKey="status" colKey="status" sort={sort} sortToggle={toggleSort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={masters} getValue={colDisplayVal} width={80} align="center" />
                  <SortHeader label="วงเงิน" sortKey="principalAmount"     sort={sort} toggle={toggleSort} align="right" width={120} />
                  <SortHeader label="อัตรา"       sortKey="interestRate"        sort={sort} toggle={toggleSort} align="right" width={80} />
                  <SortHeader label="ดอกเบี้ยรวม" sortKey="totalInterest"       sort={sort} toggle={toggleSort} align="right" width={120} />
                  <SortHeader label="ชำระแล้ว"    sortKey="paidInterest"        sort={sort} toggle={toggleSort} align="right" width={120} />
                  <SortHeader label="ค้างชำระ"    sortKey="outstandingInterest" sort={sort} toggle={toggleSort} align="right" width={120} />
                  <SortHeader label="วันเริ่มสัญญา" sortKey="receiveDate"        sort={sort} toggle={toggleSort} align="center" width={110} />
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && (
                  <tr><td colSpan={10} style={{ textAlign: 'center', padding: 36, color: 'var(--ink-400)' }}>ไม่พบข้อมูลที่ตรงกับเงื่อนไข</td></tr>
                )}
                {sortedRows.map(m => (
                  <DebtLedgerRow
                    key={m.id || m.contractNo}
                    master={m}
                    summary={summaryByContract[m.contractNo]}
                    onOpen={setSelectedMaster}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <InterestSchedulePopup
        master={selectedMaster}
        ledgerRows={selectedLedger}
        events={allEvents}
        onClose={() => setSelectedMaster(null)}
        onSavePayments={savePayments}
        onSaveInterestPayments={saveInterestPayments}
        onClearPayment={clearPayment}
        onOverrideInterest={overrideInterest}
        onAddPrincipalEvent={addPrincipalEvent}
        onEditEvent={editPrincipalEvent}
        onDeleteEvent={deletePrincipalEvent}
        onDeleteLedgerRow={deleteLedgerRow}
        onAddLedgerRow={addLedgerRow}
        onAdoptAuto={adoptAutoMode}
        onSetAutoMode={setAutoMode}
        onSaveMasterFields={saveMasterFields}
        onRollover={doRollover}
        onSetContractStatus={setContractStatus}
        canEdit={canEdit}
      />

      <ExportOptionsModal
        open={exportOpen}
        masters={masters}
        summaryByContract={summaryByContract}
        ledgerByContract={ledgerByContract}
        eventsByContract={eventsByContract}
        onClose={() => setExportOpen(false)}
      />

      <InterestOverviewModal
        open={overviewOpen}
        masters={masters}
        ledgerByContract={ledgerByContract}
        onClose={() => setOverviewOpen(false)}
      />

      <OrphanRepairModal
        open={repairOpen}
        orphanGroups={orphanGroups}
        masters={masters}
        onClose={() => setRepairOpen(false)}
        onRelink={(pairs) => { relinkOrphans(pairs); setRepairOpen(false); }}
      />
    </div>
  );
}
