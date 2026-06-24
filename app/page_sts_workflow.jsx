/* page_sts_workflow.jsx — STS Workflow
   จับคู่ receipts (รับเงินจากราชการ) ↔ debtMaster (สัญญา STS)
   คำนวณดอกเบี้ย + ค่าบริการเอนคอมพาส (สุทธิหลังหักดอกเบี้ย STS)
   แสดง queue ของรายการที่รอ review + รายการที่ตรวจแล้ว
*/
'use strict';

// Defaults from sample 118.ENC132 contract
const DEFAULT_MGMT_FEE_RATE = 0.065;
const DEFAULT_STS_INT_RATE  = 0.15;
const DEFAULT_WHT_MGMT      = 0.03;
const DEFAULT_WHT_INTEREST  = 0.01;

function dayDiff(d1, d2) {
  if (!d1 || !d2) return 0;
  return Math.max(0, Math.round((new Date(d2) - new Date(d1)) / 86400000));
}
function simpleInterest(p, r, days) {
  return (Number(p) || 0) * (Number(r) || 0) * (Number(days) || 0) / 365;
}
function bMoney(n) { return (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function bMoney2(n) { return (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Expand a debtMaster row into a list of drawdown legs:
// (a) the primary drawdown (receiveDate + principalAmount), plus
// (b) every debtEvents row with type='drawdown' for this contract.
// Each leg carries _sourceType + _source so callers can show full detail.
function expandDrawdowns(row, allEvents) {
  const out = [];
  const rate = Number(row.interestRate) || 0;
  if (row.receiveDate && Number(row.principalAmount)) {
    out.push({
      date: row.receiveDate, amount: Number(row.principalAmount), rate, note: 'ครั้งที่ 1',
      _sourceType: 'contract', _source: row,
    });
  }
  (allEvents || []).filter(e =>
    e.eventType === 'drawdown' && (e.contractId === row.id || e.contractNo === row.contractNo)
  ).forEach(e => {
    out.push({
      date: e.eventDate, amount: Number(e.amount), rate, note: e.note || '',
      _sourceType: 'event', _source: e,
    });
  });
  return out;
}

// Build matching index: jobNo → primary STS row + WCI-Project row
function buildStsIndex(debtMaster) {
  const sts = {};   // jobNo → STS contract
  const wci = {};   // jobNo → WCI-Project contract
  (debtMaster || []).forEach(d => {
    const cat = d.debtCategory;
    const job = d.projectCode;
    if (!job) return;
    if (cat === 'STS' && !sts[job])         sts[job] = d;
    if (cat === 'WCI-Project' && !wci[job]) wci[job] = d;
  });
  return { sts, wci };
}

// Strip trailing sub-phase suffix from a jobNo, e.g. 'TTI037-PL' → 'TTI037'.
// Only strips when suffix is short (1-4 letters) so we don't accidentally
// strip meaningful parts of the code.
function stripJobSuffix(code) {
  return String(code || '').replace(/-[A-Za-z]{1,4}$/, '');
}

// Look up an STS/WCI contract by jobNo, tolerating sub-phase suffix mismatch
// between debtMaster and invoices (e.g. debtMaster uses 'TTI037' while
// invoices/receipts use 'TTI037-PL', or vice versa).
function lookupStsKey(code, idxMap) {
  if (!code || !idxMap) return null;
  // 1) Exact match — fast path
  if (idxMap[code]) return code;
  // 2) Strip suffix from the caller's code, then look up
  const stripped = stripJobSuffix(code);
  if (stripped !== code && idxMap[stripped]) return stripped;
  // 3) Search idxMap for a key whose stripped form matches either form
  for (const k of Object.keys(idxMap)) {
    const ks = stripJobSuffix(k);
    if (ks === code || ks === stripped) return k;
  }
  return null;
}

// Find STS+WCI contracts matching a receipt → { sts, wci, jobNo }
// IMPORTANT: Only matches when projectCode (or invoice.jobNo) is the same
// project (allowing sub-phase suffix differences). NO fuzzy projectName
// matching — that caused unrelated projects with similar names (e.g.
// "ตลาดกลางสินค้าเกษตรสระแก้ว…") to be pulled into the wrong STS contract.
function matchStsContract(receipt, idx, invoices) {
  if (!receipt) return null;
  let jobNo = null;

  // Try the receipt's own projectCode (with suffix-stripping fallback)
  if (receipt.projectCode) {
    jobNo = lookupStsKey(receipt.projectCode, idx.sts);
  }

  // Otherwise, look up the invoice → its jobNo (with suffix-stripping)
  if (!jobNo && receipt.invoiceNo && invoices) {
    const iv = invoices.find(i => i.ivNo === receipt.invoiceNo);
    if (iv && iv.jobNo) {
      jobNo = lookupStsKey(iv.jobNo, idx.sts);
    }
  }

  if (!jobNo) return null;
  return {
    jobNo,
    sts: idx.sts[jobNo],
    wci: idx.wci[jobNo] || idx.wci[stripJobSuffix(jobNo)],
  };
}

// Compute one drawdown's interest (used for both STS and each WCI tranche)
function legInterest(drawdownDate, receiveDate, principal, rate) {
  const days = dayDiff(drawdownDate, receiveDate);
  const interest = simpleInterest(principal, rate, days);
  return { drawdown: drawdownDate, days, principal: Number(principal) || 0, rate: Number(rate) || 0, interest };
}

// Compute full STS calc — STS leg(s) + WCI-Project legs combined
// match = { sts, wci, jobNo }; debtEvents from data
function computeStsRow(receipt, match, params, debtEvents) {
  const mgmtRate    = Number(params.mgmtRate) || DEFAULT_MGMT_FEE_RATE;
  const whtMgmt     = Number(params.whtMgmt) || DEFAULT_WHT_MGMT;
  const whtInt      = Number(params.whtInterest) || DEFAULT_WHT_INTEREST;
  const receiveDate = receipt.receiptDate;
  const baseAmount  = Number(receipt.grossAmount) || 0;

  // STS legs (primary + debtEvents drawdowns)
  const stsDraws = match.sts ? expandDrawdowns(match.sts, debtEvents) : [];
  const stsLegs = stsDraws.map(d =>
    legInterest(d.date, receiveDate, d.amount, d.rate || DEFAULT_STS_INT_RATE)
  );
  // WCI legs
  const wciDraws = match.wci ? expandDrawdowns(match.wci, debtEvents) : [];
  const wciLegs = wciDraws.map(d =>
    legInterest(d.date, receiveDate, d.amount, d.rate || 0.10)
  );

  const stsInterest = stsLegs.reduce((s, l) => s + l.interest, 0);
  const wciInterest = wciLegs.reduce((s, l) => s + l.interest, 0);
  const totalInterest = stsInterest + wciInterest;

  const mgmtGross = baseAmount * mgmtRate;
  const mgmtNet   = mgmtGross - totalInterest;
  const whtOnMgmt = mgmtGross * whtMgmt;
  const whtOnInt  = totalInterest * whtInt;
  const encompassPayable = mgmtNet - whtOnMgmt + whtOnInt;

  // Primary STS info for display
  const primary = match.sts || {};
  return {
    drawdown: primary.receiveDate || primary.startDate,
    receiveDate,
    days: stsLegs[0]?.days || 0,
    principal: Number(primary.principalAmount) || 0,
    intRate: Number(primary.interestRate) || DEFAULT_STS_INT_RATE,
    baseAmount, mgmtRate, mgmtGross,
    interest: totalInterest,           // total (STS + WCI) — for backward-compat display
    stsInterest, wciInterest,
    stsLegs, wciLegs,
    mgmtNet, whtOnMgmt, whtOnInt, encompassPayable,
  };
}

// Compute STS calc for a PROJECT — sums ALL receipts in the same jobNo so the
// management fee is calculated correctly against total project revenue, and
// interest is computed up to the LATEST receipt date (closing date of project).
function computeStsRowMulti(projectReceipts, match, params, debtEvents) {
  const mgmtRate = Number(params.mgmtRate) || DEFAULT_MGMT_FEE_RATE;
  const whtMgmt  = Number(params.whtMgmt) || DEFAULT_WHT_MGMT;
  const whtInt   = Number(params.whtInterest) || DEFAULT_WHT_INTEREST;

  const sortedR  = [...(projectReceipts || [])].sort(
    (a, b) => (a.receiptDate || '').localeCompare(b.receiptDate || '')
  );
  const earliestDate = sortedR.length ? sortedR[0].receiptDate : null;
  const latestDate   = sortedR.length ? sortedR[sortedR.length - 1].receiptDate : null;
  const baseAmount   = sortedR.reduce((s, r) => s + (Number(r.grossAmount) || 0), 0);

  // All drawdowns earn interest up to the LATEST receipt date.
  // Preserve _sourceType + _source on each leg so the UI can let users
  // click a leg to view its source contract/event.
  const stsDraws = match?.sts ? expandDrawdowns(match.sts, debtEvents) : [];
  const stsLegs  = stsDraws.map(d => ({
    ...legInterest(d.date, latestDate, d.amount, d.rate || DEFAULT_STS_INT_RATE),
    _sourceType: d._sourceType, _source: d._source,
  }));
  const wciDraws = match?.wci ? expandDrawdowns(match.wci, debtEvents) : [];
  const wciLegs  = wciDraws.map(d => ({
    ...legInterest(d.date, latestDate, d.amount, d.rate || 0.10),
    _sourceType: d._sourceType, _source: d._source,
  }));

  const stsInterest   = stsLegs.reduce((s, l) => s + l.interest, 0);
  const wciInterest   = wciLegs.reduce((s, l) => s + l.interest, 0);
  const totalInterest = stsInterest + wciInterest;

  const mgmtGross = baseAmount * mgmtRate;
  const mgmtNet   = mgmtGross - totalInterest;
  const whtOnMgmt = mgmtGross * whtMgmt;
  const whtOnInt  = totalInterest * whtInt;
  const encompassPayable = mgmtNet - whtOnMgmt + whtOnInt;

  return {
    receiptCount: sortedR.length,
    earliestDate, latestDate,
    days: stsLegs[0]?.days || 0,
    baseAmount, mgmtRate, mgmtGross,
    interest: totalInterest, stsInterest, wciInterest,
    stsLegs, wciLegs,
    mgmtNet, whtOnMgmt, whtOnInt, encompassPayable,
  };
}

// Thai labels for common fields shown in DetailSubModal
const STS_FIELD_LABELS = {
  // debtMaster
  contractNo: 'เลขที่สัญญา', borrowerName: 'ผู้กู้ / เจ้าหนี้', debtCategory: 'หมวด',
  principalAmount: 'วงเงิน (Principal)', interestRate: 'อัตราดอกเบี้ย/ปี',
  receiveDate: 'วันรับเงิน', startDate: 'วันเริ่มสัญญา', maturityDate: 'วันครบกำหนด',
  endDate: 'วันสิ้นสุด', balance: 'ยอดคงเหลือ', currency: 'สกุลเงิน',
  bankName: 'ธนาคาร', status: 'สถานะ', projectCode: 'รหัสโครงการ',
  projectName: 'ชื่อโครงการ', note: 'หมายเหตุ',
  // debtEvents
  eventDate: 'วันที่เหตุการณ์', eventType: 'ประเภท', amount: 'จำนวนเงิน',
  contractId: 'Contract ID', paymentDate: 'วันที่ชำระ',
  // receipts
  receiptNo: 'เลขที่ใบรับ', receiptDate: 'วันที่รับเงิน',
  invoiceNo: 'เลขที่ใบแจ้งหนี้', grossAmount: 'จำนวนเงิน (Gross)',
  netAmount: 'จำนวนเงินสุทธิ', whtAmount: 'หัก ณ ที่จ่าย', bankAc: 'บัญชีรับเงิน',
};

// Sub-modal that opens above the main drawer — shows all populated fields
function StsDetailSubModal({ open, title, record, onClose }) {
  if (!open || !record) return null;
  // Filter out internal _xxx fields, empty values, and the bare `id`
  const entries = Object.entries(record).filter(([k, v]) =>
    !k.startsWith('_') && v != null && v !== '' && k !== 'id'
  );
  // Sort: known labels first (in label-dictionary order), then others alphabetically
  const knownKeys = Object.keys(STS_FIELD_LABELS);
  entries.sort((a, b) => {
    const ai = knownKeys.indexOf(a[0]); const bi = knownKeys.indexOf(b[0]);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a[0].localeCompare(b[0]);
  });
  // Wrap close handlers with stopPropagation so clicking the sub-modal's
  // backdrop or close button doesn't bubble up to the drawer behind it
  // (which would close the main popup too).
  const handleBackdropClick = (e) => { e.stopPropagation(); onClose(); };
  const handleCloseClick    = (e) => { e.stopPropagation(); onClose(); };
  return (
    <div onClick={handleBackdropClick}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,36,77,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: 'min(560px, 92vw)', maxHeight: '82vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(15,36,77,0.28)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <button onClick={handleCloseClick} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--ink-400)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {entries.length === 0 && (
            <div className="muted" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 20 }}>ไม่มีข้อมูล</div>
          )}
          {entries.map(([k, v]) => {
            const label = STS_FIELD_LABELS[k] || k;
            // Smart formatting per field
            let display;
            if (typeof v === 'object') display = JSON.stringify(v);
            else if (/Date|date$/.test(k))   display = fmtDate(v) || String(v);
            else if (k === 'interestRate')   display = (Number(v) * 100).toFixed(4) + ' %';
            else if (typeof v === 'number')  display = bMoney2(v);
            else if (/Amount|balance|principalAmount|grossAmount|netAmount|whtAmount/.test(k))
              display = bMoney2(Number(v) || 0);
            else display = String(v);
            const isFull = /Name|note$|projectName/.test(k) && String(display).length > 30;
            return (
              <div key={k} className="field" style={{ gridColumn: isFull ? '1/-1' : 'auto' }}>
                <label style={{ fontSize: 11, color: 'var(--ink-500)' }}>{label}</label>
                <div style={{
                  minHeight: 32, padding: '6px 10px',
                  border: '1px solid var(--ink-100)', borderRadius: 6,
                  background: 'var(--ink-25, #f9fafb)', fontSize: 12,
                  color: 'var(--ink-700)', wordBreak: 'break-word',
                  userSelect: 'text', lineHeight: 1.5,
                }}>{display}</div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '10px 18px', background: '#f8fafc', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', position: 'sticky', bottom: 0 }}>
          <button onClick={handleCloseClick} className="btn btn-ghost">ปิด</button>
        </div>
      </div>
    </div>
  );
}

// ── Drawer for a single receipt ───────────────────────────────────────────
// Same layout as page_sts_calc (full calculator-style view) — but pulls real
// data from the matched receipt + debtMaster contract instead of being editable.
function StsCalcDrawer({ projectReceipts, match, calcResult, isOpen, onClose, onConfirm, onPrint, onCancelReview, canEdit, params, setParams, debtEvents }) {
  if (!isOpen) return null;
  const contract = match?.sts;
  // Use the latest receipt as the "primary" for display labels (project name / code)
  const sortedReceipts = [...(projectReceipts || [])].sort(
    (a, b) => (a.receiptDate || '').localeCompare(b.receiptDate || '')
  );
  const primaryReceipt = sortedReceipts[sortedReceipts.length - 1] || projectReceipts?.[0];

  // Error state — no matching STS contract
  if (!contract) {
    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,36,77,0.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 28, maxWidth: 520, boxShadow: '0 24px 60px rgba(15,36,77,0.18)' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>ไม่พบสัญญา STS ที่ตรงกับใบรับนี้</div>
          <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>
            Project: <strong>{primaryReceipt?.projectCode || '—'}</strong> · {primaryReceipt?.projectName || '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 8 }}>
            ตรวจสอบว่ามีสัญญา STS-* ใน debtMaster ที่ projectCode/jobNo ตรงกับใบรับนี้
          </div>
          <button onClick={onClose} style={{ marginTop: 16, background: '#2e8b4a', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer' }}>ปิด</button>
        </div>
      </div>
    );
  }

  const c            = computeStsRowMulti(projectReceipts, match, params, debtEvents);
  const wci          = match?.wci;
  const contractValue= Number(contract.contractValueIncVAT) || c.baseAmount || 0;
  const stsRate      = Number(contract.interestRate) || DEFAULT_STS_INT_RATE;
  const wciRate      = wci ? (Number(wci.interestRate) || 0.10) : 0.10;
  const stsDraws     = expandDrawdowns(contract, debtEvents);
  const wciDraws     = wci ? expandDrawdowns(wci, debtEvents) : [];
  const totalStsDraw = stsDraws.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalWciDraw = wciDraws.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  // Reused styles for read-only input look (parallels sts_calc edit inputs but disabled)
  const roInput = { width: '100%', padding: 8, border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, background: '#f8fafc', color: 'var(--ink-700)', cursor: 'default' };
  const roInputRight = { ...roInput, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const editInput = { width: '100%', padding: 8, border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 12, textAlign: 'right' };

  // Detail sub-modal state — opens above this drawer when a row is clicked
  const [detail, setDetail] = React.useState(null);   // { title, record }
  const closeDetail = () => setDetail(null);
  const clickableTr = { cursor: 'pointer' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,36,77,0.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(960px, 95vw)', maxHeight: '92vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(15,36,77,0.18)' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#fff', zIndex: 5 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>STS Calculator · {match.jobNo || contract.contractNo || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>
              คำนวณดอกเบี้ย STS+WCI และค่าบริการเอนคอมพาส · {c.receiptCount} ใบรับ · ยอดรวม {bMoney(c.baseAmount)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--ink-400)', lineHeight: 1, padding: 4 }}>×</button>
        </div>

        <div style={{ padding: 18 }}>

          {/* ── Formula explainer (orange box) ──────────────────────────── */}
          <div className="card" style={{ padding: '14px 16px', marginBottom: 16, background: '#fffbeb', borderLeft: '4px solid #f6ad55' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>📐 สูตรคำนวณ</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink-700)' }}>
              1. <strong>ดอกเบี้ย STS (#1)</strong> = เงินต้น × {(stsRate*100).toFixed(2)}%/ปี × วันที่กู้ถึงวันรับเงินจากราชการ ÷ 365<br/>
              2. <strong>ดอกเบี้ย WCI (#2)</strong> = เงินต้น × {(wciRate*100).toFixed(2)}%/ปี × วันที่กู้ถึงวันรับเงิน ÷ 365<br/>
              3. <strong>ค่าบริการเอนคอมพาส (เต็ม)</strong> = ยอดรับจากราชการ × {(params.mgmtRate*100).toFixed(2)}%<br/>
              4. <strong>ค่าบริการสุทธิ</strong> = ค่าบริการ (เต็ม) − ดอกเบี้ยรวม (STS + WCI)<br/>
              5. <strong>หัก WHT</strong>: {(params.whtMgmt*100).toFixed(0)}% ค่าบริการ / {(params.whtInterest*100).toFixed(0)}% ดอกเบี้ย (รับคืน)
            </div>
          </div>

          {/* ── Contract parameters ─────────────────────────────────────── */}
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>⚙ ข้อมูลสัญญา</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>ชื่อโครงการ</label>
                <input value={contract.projectName || primaryReceipt?.projectName || ''} readOnly style={roInput} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>เลขที่สัญญา / อ้างอิง</label>
                <input value={contract.contractNo || ''} readOnly style={roInput} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>มูลค่าสัญญา (รวม VAT)</label>
                <input value={bMoney2(contractValue)} readOnly style={roInputRight} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>Mgmt fee (เอนคอมพาส) %</label>
                <input type="number" step="0.001" value={params.mgmtRate}
                  onChange={e => setParams(p => ({ ...p, mgmtRate: Number(e.target.value) }))} style={editInput} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>ดอกเบี้ย STS (#1) /ปี</label>
                <input value={stsRate} readOnly style={roInputRight} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>ดอกเบี้ย WCI (#2) /ปี</label>
                <input value={wciRate} readOnly style={roInputRight} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>WHT mgmt %</label>
                <input type="number" step="0.01" value={params.whtMgmt}
                  onChange={e => setParams(p => ({ ...p, whtMgmt: Number(e.target.value) }))} style={editInput} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>WHT interest %</label>
                <input type="number" step="0.01" value={params.whtInterest}
                  onChange={e => setParams(p => ({ ...p, whtInterest: Number(e.target.value) }))} style={editInput} />
              </div>
            </div>
          </div>

          {/* ── STS drawdowns ────────────────────────────────────────────── */}
          <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: '#f0f9ff', borderBottom: '1px solid #bfdbfe' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>💰 เงินกู้ STS (#1)</div>
            </div>
            <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr><th style={{ width: 70 }}>รายการ</th><th style={{ width: 130 }}>วันที่</th><th style={{ width: 140, textAlign: 'right' }}>จำนวนเงิน</th><th>หมายเหตุ</th></tr>
              </thead>
              <tbody>
                {stsDraws.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-400)' }}>ไม่มีรายการเบิกเงิน STS</td></tr>
                )}
                {stsDraws.map((d, i) => (
                  <tr key={'sts-d-'+i} style={clickableTr}
                      onClick={() => setDetail({
                        title: `ข้อมูลเงินกู้ STS #${i + 1} (${d._sourceType === 'event' ? 'จาก debtEvents' : 'สัญญาหลัก'})`,
                        record: d._source || d,
                      })}>
                    <td style={{ fontSize: 11 }}>STS #{i + 1}</td>
                    <td>{fmtDate(d.date) || d.date}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{bMoney2(d.amount)}</td>
                    <td style={{ fontSize: 11, color: 'var(--ink-500)' }}>{d.note || '—'}</td>
                  </tr>
                ))}
                {stsDraws.length > 0 && (
                  <tr style={{ background: '#fafbfc', fontWeight: 700 }}>
                    <td colSpan={2}>รวม STS</td>
                    <td style={{ textAlign: 'right' }}>{bMoney2(totalStsDraw)}</td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── WCI drawdowns ────────────────────────────────────────────── */}
          <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: '#f5f3ff', borderBottom: '1px solid #ddd6fe' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>💰 เงินกู้ WCI (#2)</div>
            </div>
            <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr><th style={{ width: 70 }}>รายการ</th><th style={{ width: 130 }}>วันที่</th><th style={{ width: 140, textAlign: 'right' }}>จำนวนเงิน</th><th>หมายเหตุ</th></tr>
              </thead>
              <tbody>
                {wciDraws.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-400)' }}>ไม่มีรายการเบิกเงิน WCI</td></tr>
                )}
                {wciDraws.map((d, i) => (
                  <tr key={'wci-d-'+i} style={clickableTr}
                      onClick={() => setDetail({
                        title: `ข้อมูลเงินกู้ WCI #${i + 1} (${d._sourceType === 'event' ? 'จาก debtEvents' : 'สัญญาหลัก'})`,
                        record: d._source || d,
                      })}>
                    <td style={{ fontSize: 11 }}>WCI #{i + 1}</td>
                    <td>{fmtDate(d.date) || d.date}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{bMoney2(d.amount)}</td>
                    <td style={{ fontSize: 11, color: 'var(--ink-500)' }}>{d.note || '—'}</td>
                  </tr>
                ))}
                {wciDraws.length > 0 && (
                  <tr style={{ background: '#fafbfc', fontWeight: 700 }}>
                    <td colSpan={2}>รวม WCI</td>
                    <td style={{ textAlign: 'right' }}>{bMoney2(totalWciDraw)}</td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Government receipts — ALL receipts for this project ───── */}
          <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>🏛 รับเงินจากราชการ ({c.receiptCount} ใบ)</div>
              <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>โครงการ <strong>{match.jobNo}</strong></div>
            </div>
            <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th style={{ width: 110 }}>เลขที่ใบรับ</th>
                  <th style={{ width: 110 }}>วันที่รับ</th>
                  <th style={{ width: 120 }}>ใบแจ้งหนี้</th>
                  <th style={{ textAlign: 'right' }}>จำนวนเงิน (gross)</th>
                </tr>
              </thead>
              <tbody>
                {sortedReceipts.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-400)' }}>ไม่มีใบรับเงิน</td></tr>
                )}
                {sortedReceipts.map((r, i) => (
                  <tr key={r.id || i} style={clickableTr}
                      onClick={() => setDetail({
                        title: `ข้อมูลใบรับเงิน · ${r.receiptNo || '#' + (i + 1)}`,
                        record: r,
                      })}>
                    <td style={{ fontSize: 11, color: 'var(--ink-500)' }}>{i + 1}</td>
                    <td style={{ fontFamily: 'ui-monospace', fontWeight: 600 }}>{r.receiptNo || '—'}</td>
                    <td>{fmtDate(r.receiptDate) || r.receiptDate || '—'}</td>
                    <td style={{ fontFamily: 'ui-monospace', fontSize: 11 }}>{r.invoiceNo || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{bMoney2(r.grossAmount)}</td>
                  </tr>
                ))}
                {sortedReceipts.length > 0 && (
                  <tr style={{ background: '#dcfce7', fontWeight: 700 }}>
                    <td colSpan={4} style={{ textAlign: 'right', paddingRight: 12 }}>รวมยอดรับทั้งโครงการ</td>
                    <td style={{ textAlign: 'right', color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>{bMoney2(c.baseAmount)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Interest calculation details ────────────────────────────── */}
          <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: '#fff7ed', borderBottom: '1px solid #fed7aa' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>📈 รายละเอียดดอกเบี้ย (คำนวณถึงวันรับเงินใบล่าสุด {fmtDate(c.latestDate)})</div>
            </div>
            <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>ฝ่าย</th>
                  <th style={{ width: 130 }}>วันที่กู้</th>
                  <th style={{ width: 80, textAlign: 'right' }}>จำนวนวัน</th>
                  <th style={{ width: 140, textAlign: 'right' }}>เงินต้น</th>
                  <th style={{ width: 90, textAlign: 'right' }}>อัตรา</th>
                  <th style={{ width: 150, textAlign: 'right' }}>ดอกเบี้ย</th>
                </tr>
              </thead>
              <tbody>
                {c.stsLegs.map((l, i) => (
                  <tr key={'sts-l-'+i} style={clickableTr}
                      onClick={() => setDetail({
                        title: `ดอกเบี้ย STS leg #${i + 1} · ${fmtDate(l.drawdown)}`,
                        record: l._source || l,
                      })}>
                    <td><Badge kind="b-blue" dot={false}>STS</Badge></td>
                    <td>{fmtDate(l.drawdown) || l.drawdown}</td>
                    <td style={{ textAlign: 'right' }}>{l.days}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{bMoney2(l.principal)}</td>
                    <td style={{ textAlign: 'right' }}>{(l.rate*100).toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#9b1c1c' }}>{bMoney2(l.interest)}</td>
                  </tr>
                ))}
                {c.wciLegs.map((l, i) => (
                  <tr key={'wci-l-'+i} style={clickableTr}
                      onClick={() => setDetail({
                        title: `ดอกเบี้ย WCI leg #${i + 1} · ${fmtDate(l.drawdown)}`,
                        record: l._source || l,
                      })}>
                    <td><Badge kind="b-violet" dot={false}>WCI</Badge></td>
                    <td>{fmtDate(l.drawdown) || l.drawdown}</td>
                    <td style={{ textAlign: 'right' }}>{l.days}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{bMoney2(l.principal)}</td>
                    <td style={{ textAlign: 'right' }}>{(l.rate*100).toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#6b46c1' }}>{bMoney2(l.interest)}</td>
                  </tr>
                ))}
                {(c.stsLegs.length + c.wciLegs.length) === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-400)' }}>ไม่มีข้อมูลดอกเบี้ย</td></tr>
                )}
                <tr style={{ background: '#fef3c7', fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: 'right', paddingRight: 12 }}>รวมดอกเบี้ย STS</td>
                  <td style={{ textAlign: 'right', color: '#9b1c1c', fontVariantNumeric: 'tabular-nums' }}>{bMoney2(c.stsInterest)}</td>
                </tr>
                <tr style={{ background: '#fef3c7', fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: 'right', paddingRight: 12 }}>รวมดอกเบี้ย WCI</td>
                  <td style={{ textAlign: 'right', color: '#6b46c1', fontVariantNumeric: 'tabular-nums' }}>{bMoney2(c.wciInterest)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Final summary (gradient card) ───────────────────────────── */}
          <div className="card" style={{ padding: 18, background: 'linear-gradient(135deg, #fff7ed, #fefce8)' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: '#9a3412' }}>💰 สรุปสำหรับเอนคอมพาส</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ค่าบริการ (เต็ม) — {(c.mgmtRate*100).toFixed(2)}% × ยอดรับ</div>
                <div style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{bMoney(c.mgmtGross)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>(−) หักดอกเบี้ยรวม (STS + WCI)</div>
                <div style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: 'tabular-nums', color: '#9b1c1c' }}>−{bMoney(c.interest)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>= ค่าบริการสุทธิ</div>
                <div style={{ fontWeight: 700, fontSize: 20, fontVariantNumeric: 'tabular-nums', color: '#276749' }}>{bMoney(c.mgmtNet)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>(−) WHT ค่าบริการ {(params.whtMgmt*100).toFixed(0)}%</div>
                <div style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>−{bMoney(c.whtOnMgmt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>(+) WHT ดอกเบี้ย {(params.whtInterest*100).toFixed(0)}% (รับคืน)</div>
                <div style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>+{bMoney(c.whtOnInt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>= สุทธิจ่ายเอนคอมพาส</div>
                <div style={{ fontWeight: 700, fontSize: 22, fontVariantNumeric: 'tabular-nums', color: '#0369a1' }}>
                  {bMoney(c.encompassPayable)}
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', background: '#f8fafc', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', bottom: 0, zIndex: 5 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>
            {calcResult ? `✓ บันทึกแล้ว ${calcResult.calculatedAt ? (fmtDate(calcResult.calculatedAt.slice(0, 10)) + ' ' + String(calcResult.calculatedAt).slice(11, 16)) : ''}` : 'ยังไม่บันทึก'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {calcResult && onCancelReview && canEdit && (
              <button onClick={() => onCancelReview()} className="btn btn-ghost" style={{ color: '#e53e3e' }}
                title="ย้อนสถานะกลับเป็น 'รอ review' (กรณีกดบันทึกผิด)">
                ⤺ ยกเลิกการตรวจ
              </button>
            )}
            {calcResult && onPrint && (
              <button onClick={() => onPrint()} className="btn btn-ghost"
                title="ปริ้นใบคำนวณนี้เป็น PDF (A4)">
                <Icon name="print" size={14} /> ปริ้น PDF
              </button>
            )}
            <button onClick={onClose} className="btn btn-ghost">ปิด</button>
            {canEdit && (
              <button onClick={() => onConfirm(c)} className="btn btn-primary">
                {calcResult ? 'บันทึกใหม่' : 'ยืนยัน + บันทึก'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sub-popup — opens above the drawer when a row is clicked */}
      <StsDetailSubModal
        open={!!detail}
        title={detail?.title || ''}
        record={detail?.record}
        onClose={closeDetail}
      />
    </div>
  );
}

// ── A4 PDF report (ปริ้นรายการที่ตรวจแล้ว — เดี่ยว/หลายรายการ) ──────────────────
function buildStsReportHTML(groups, params, debtEvents) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let logo = '';
  try { logo = new URL('bioaxel_logo.png', location.href).href; } catch (_) {}
  const today = fmtDate(new Date().toISOString().slice(0, 10));
  const sections = groups.map(g => {
    const c = computeStsRowMulti(g.receipts, g.match, params, debtEvents);
    const contract = g.match.sts || {};
    const wci = g.match.wci;
    const sortedReceipts = [...g.receipts].sort((a, b) => (a.receiptDate || '').localeCompare(b.receiptDate || ''));
    const stsDraws = contract ? expandDrawdowns(contract, debtEvents) : [];
    const wciDraws = wci ? expandDrawdowns(wci, debtEvents) : [];
    const drawRows = (draws, tag) => draws.map((d, i) => `<tr><td>${tag} #${i + 1}</td><td>${esc(fmtDate(d.date) || d.date)}</td><td class="r">${bMoney2(d.amount)}</td><td>${esc(d.note || '')}</td></tr>`).join('');
    const rcptRows = sortedReceipts.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.receiptNo || '')}</td><td>${esc(fmtDate(r.receiptDate) || '')}</td><td>${esc(r.invoiceNo || '')}</td><td class="r">${bMoney2(r.grossAmount)}</td></tr>`).join('');
    const legRows = [
      ...c.stsLegs.map(l => `<tr><td>STS</td><td>${esc(fmtDate(l.drawdown) || '')}</td><td class="r">${l.days}</td><td class="r">${bMoney2(l.principal)}</td><td class="r">${(l.rate * 100).toFixed(2)}%</td><td class="r">${bMoney2(l.interest)}</td></tr>`),
      ...c.wciLegs.map(l => `<tr><td>WCI</td><td>${esc(fmtDate(l.drawdown) || '')}</td><td class="r">${l.days}</td><td class="r">${bMoney2(l.principal)}</td><td class="r">${(l.rate * 100).toFixed(2)}%</td><td class="r">${bMoney2(l.interest)}</td></tr>`),
    ].join('');
    return `
    <section class="sheet">
      <div class="head">
        ${logo ? `<img class="logo" src="${logo}"/>` : ''}
        <div>
          <h1>ใบคำนวณค่าบริการเอนคอมพาส (STS)</h1>
          <div class="sub">โครงการ ${esc(g.jobNo)} · สัญญา ${esc(contract.contractNo || '—')} · พิมพ์เมื่อ ${esc(today)}</div>
        </div>
      </div>
      <table class="info">
        <tr><td class="k">ชื่อโครงการ</td><td>${esc(contract.projectName || sortedReceipts[sortedReceipts.length - 1]?.projectName || '—')}</td>
            <td class="k">มูลค่าสัญญา (รวม VAT)</td><td class="r">${bMoney2(Number(contract.contractValueIncVAT) || c.baseAmount || 0)}</td></tr>
        <tr><td class="k">Mgmt fee</td><td>${(c.mgmtRate * 100).toFixed(2)}%</td>
            <td class="k">วันรับเงินใบล่าสุด</td><td>${esc(fmtDate(c.latestDate) || '—')}</td></tr>
      </table>
      <h2>เงินกู้ STS / WCI</h2>
      <table class="grid"><thead><tr><th>รายการ</th><th>วันที่</th><th class="r">จำนวนเงิน</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${drawRows(stsDraws, 'STS')}${drawRows(wciDraws, 'WCI')}</tbody></table>
      <h2>รับเงินจากราชการ (${sortedReceipts.length} ใบ)</h2>
      <table class="grid"><thead><tr><th>#</th><th>เลขที่ใบรับ</th><th>วันที่รับ</th><th>ใบแจ้งหนี้</th><th class="r">จำนวนเงิน</th></tr></thead>
        <tbody>${rcptRows}<tr class="tot"><td colspan="4" class="r">รวมยอดรับทั้งโครงการ</td><td class="r">${bMoney2(c.baseAmount)}</td></tr></tbody></table>
      <h2>รายละเอียดดอกเบี้ย</h2>
      <table class="grid"><thead><tr><th>ฝ่าย</th><th>วันที่กู้</th><th class="r">วัน</th><th class="r">เงินต้น</th><th class="r">อัตรา</th><th class="r">ดอกเบี้ย</th></tr></thead>
        <tbody>${legRows}
          <tr class="tot"><td colspan="5" class="r">รวมดอกเบี้ย STS</td><td class="r">${bMoney2(c.stsInterest)}</td></tr>
          <tr class="tot"><td colspan="5" class="r">รวมดอกเบี้ย WCI</td><td class="r">${bMoney2(c.wciInterest)}</td></tr>
        </tbody></table>
      <div class="summary">
        <h2>สรุปสำหรับเอนคอมพาส</h2>
        <table class="sum">
          <tr><td>ค่าบริการ (เต็ม) ${(c.mgmtRate * 100).toFixed(2)}% × ยอดรับ</td><td class="r">${bMoney2(c.mgmtGross)}</td></tr>
          <tr><td>(−) หักดอกเบี้ยรวม (STS + WCI)</td><td class="r">−${bMoney2(c.interest)}</td></tr>
          <tr class="b"><td>= ค่าบริการสุทธิ</td><td class="r">${bMoney2(c.mgmtNet)}</td></tr>
          <tr><td>(−) WHT ค่าบริการ ${(params.whtMgmt * 100).toFixed(0)}%</td><td class="r">−${bMoney2(c.whtOnMgmt)}</td></tr>
          <tr><td>(+) WHT ดอกเบี้ย ${(params.whtInterest * 100).toFixed(0)}% (รับคืน)</td><td class="r">+${bMoney2(c.whtOnInt)}</td></tr>
          <tr class="grand"><td>สุทธิจ่ายเอนคอมพาส</td><td class="r">${bMoney2(c.encompassPayable)}</td></tr>
        </table>
      </div>
      <div class="sign"><div>ผู้จัดทำ ___________________</div><div>ผู้ตรวจสอบ ___________________</div><div>ผู้อนุมัติ ___________________</div></div>
    </section>`;
  }).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>STS Report</title>
  <style>
   @page { size: A4 portrait; margin: 14mm 12mm; }
   * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
   body { font-family: "IBM Plex Sans Thai","Sarabun",system-ui,sans-serif; color:#1a2333; margin:0; font-size:12px; }
   .sheet { page-break-after: always; padding-bottom: 6mm; }
   .sheet:last-child { page-break-after: auto; }
   .head { display:flex; align-items:center; gap:14px; border-bottom:2.5px solid #2e8b4a; padding-bottom:8px; margin-bottom:12px; }
   .logo { height:44px; }
   h1 { font-size:17px; margin:0; color:#1a592f; }
   .sub { font-size:11px; color:#5a6478; margin-top:3px; }
   h2 { font-size:12.5px; color:#1a592f; margin:13px 0 5px; border-left:3px solid #2e8b4a; padding-left:7px; }
   table { width:100%; border-collapse:collapse; }
   .info td { padding:4px 7px; border:1px solid #d6deeb; font-size:11.5px; }
   .info .k { background:#eef4fc; font-weight:700; width:130px; color:#33425f; }
   .grid th { background:#2e8b4a; color:#fff; font-weight:600; padding:5px 7px; font-size:11px; text-align:left; }
   .grid td { padding:4px 7px; border-bottom:1px solid #e6ecf5; font-size:11px; }
   .grid tbody tr:nth-child(even) td { background:#f6f9fd; }
   .r { text-align:right; font-variant-numeric:tabular-nums; }
   .tot td { background:#fff3d6 !important; font-weight:700; }
   .summary { margin-top:14px; break-inside:avoid; }
   .sum td { padding:6px 10px; border-bottom:1px solid #e6ecf5; font-size:12px; }
   .sum .b td { background:#eafaf0; font-weight:700; }
   .sum .grand td { background:#1a592f; color:#fff; font-weight:800; font-size:14px; }
   .sign { display:flex; justify-content:space-between; margin-top:28px; font-size:11px; color:#33425f; }
  </style></head><body onload="setTimeout(function(){window.print();},250)">${sections}</body></html>`;
}

function openStsReport(groups, params, debtEvents) {
  if (!groups || !groups.length) { alert('ยังไม่ได้เลือกรายการที่จะปริ้น'); return; }
  const w = window.open('', '_blank');
  if (!w) { alert('เปิดหน้าต่างปริ้นไม่ได้ — โปรดอนุญาต popup สำหรับเว็บนี้'); return; }
  w.document.open();
  w.document.write(buildStsReportHTML(groups, params, debtEvents));
  w.document.close();
}

// ── Main page ────────────────────────────────────────────────────────────
function StsWorkflowPage({ data, setData, toast }) {
  const receipts     = data?.receipts || [];
  const debtMaster   = data?.debtMaster || [];
  const debtEvents   = data?.debtEvents || [];
  const invoices     = data?.invoices || [];
  const calcResults  = data?.stsCalcResult || [];
  const [params, setParams] = React.useState({
    mgmtRate: DEFAULT_MGMT_FEE_RATE,
    whtMgmt: DEFAULT_WHT_MGMT,
    whtInterest: DEFAULT_WHT_INTEREST,
  });
  const [openJobNo, setOpenJobNo] = React.useState(null);
  const [filter, setFilter] = React.useState('all'); // all | pending | done
  const [selected, setSelected] = React.useState(new Set()); // jobNo ที่เลือกไว้ปริ้น
  const canEdit = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;

  // STS contract index
  const stsIdx = React.useMemo(() => buildStsIndex(debtMaster), [debtMaster]);

  // Match each receipt to STS contract; only keep matched
  const matched = React.useMemo(() => {
    return receipts.map(r => {
      const match = matchStsContract(r, stsIdx, invoices);
      const result = calcResults.find(x => x.pendingCalcId === r.id);
      return { receipt: r, match, result };
    }).filter(m => m.match); // STS-relevant only
  }, [receipts, stsIdx, invoices, calcResults]);

  // Group matched receipts by project (jobNo) — 1 row per project, not per receipt
  const groupedProjects = React.useMemo(() => {
    const byJob = new Map();
    matched.forEach(m => {
      const job = m.match.jobNo;
      if (!byJob.has(job)) {
        byJob.set(job, { jobNo: job, match: m.match, receipts: [], results: [] });
      }
      const g = byJob.get(job);
      g.receipts.push(m.receipt);
      if (m.result) g.results.push(m.result);
    });
    byJob.forEach(g => g.receipts.sort((a, b) => (a.receiptDate || '').localeCompare(b.receiptDate || '')));
    return Array.from(byJob.values());
  }, [matched]);

  // A project is "done" when ALL its receipts have a calc result
  const isProjectDone    = (g) => g.results.length > 0 && g.results.length === g.receipts.length;
  const isProjectPartial = (g) => g.results.length > 0 && g.results.length <  g.receipts.length;

  const filtered = React.useMemo(() => {
    if (filter === 'pending') return groupedProjects.filter(g => !isProjectDone(g));
    if (filter === 'done')    return groupedProjects.filter(g =>  isProjectDone(g));
    return groupedProjects;
  }, [groupedProjects, filter]);

  // KPIs — counted per PROJECT (no duplication across receipts)
  const pendingCount = groupedProjects.filter(g => !isProjectDone(g)).length;
  const doneCount    = groupedProjects.filter(g =>  isProjectDone(g)).length;
  let totalSts = 0, totalWci = 0, totalEncompass = 0;
  groupedProjects.forEach(g => {
    const c = computeStsRowMulti(g.receipts, g.match, params, debtEvents);
    totalSts       += c.stsInterest;
    totalWci       += c.wciInterest;
    totalEncompass += c.encompassPayable;
  });
  const totalInterest = totalSts + totalWci;

  // Confirm handler — save 1 calc result per receipt in the project
  // (uses receipt.id as pendingCalcId to fit the existing schema)
  const handleConfirm = (calcVals) => {
    if (!openJobNo) return;
    const g = groupedProjects.find(x => x.jobNo === openJobNo);
    if (!g) return;
    const debtIds = [g.match.sts?.id, g.match.wci?.id].filter(Boolean);
    const stamp   = new Date().toISOString();
    const dateOnly= stamp.slice(0, 10);
    const newResults = g.receipts.map(r => ({
      id: 'cr_' + Math.random().toString(36).slice(2, 10),
      pendingCalcId: r.id,
      debtIds,
      interestTotal: calcVals.interest,
      serviceFeeFull: calcVals.mgmtGross,
      serviceFeeNet:  calcVals.mgmtNet,
      encompassPayableId: '',
      note: 'คำนวณ STS โครงการ ' + g.jobNo + ' วันที่ ' + dateOnly,
      calculatedAt: stamp,
    }));
    const receiptIdsInProject = new Set(g.receipts.map(r => r.id));
    if (setData) {
      setData(d => ({
        ...d,
        stsCalcResult: [
          ...((d.stsCalcResult) || []).filter(x => !receiptIdsInProject.has(x.pendingCalcId)),
          ...newResults,
        ],
      }));
    }
    if (toast) toast(`บันทึกผลการคำนวณ ${g.receipts.length} ใบรับ (โครงการ ${g.jobNo})`);
    setOpenJobNo(null);
  };

  // ── ยกเลิกการตรวจ — ลบผลคำนวณของทุกใบรับในโครงการ → สถานะกลับเป็น "รอ review" ──
  const handleCancelReview = (jobNo) => {
    const g = groupedProjects.find(x => x.jobNo === jobNo);
    if (!g) return;
    if (!confirm(`ยกเลิกการตรวจโครงการ ${g.jobNo}?\nสถานะจะกลับเป็น "รอ review" (ลบผลคำนวณ ${g.results.length} รายการ)`)) return;
    const receiptIds = new Set(g.receipts.map(r => r.id));
    if (setData) {
      setData(d => ({ ...d, stsCalcResult: ((d.stsCalcResult) || []).filter(x => !receiptIds.has(x.pendingCalcId)) }));
    }
    if (toast) toast(`ยกเลิกการตรวจโครงการ ${g.jobNo} แล้ว`);
    setOpenJobNo(null);
  };

  // ── ปริ้น PDF (A4) ── เลือกได้หลายรายการ
  const toggleSelect = (jobNo) => setSelected(prev => {
    const next = new Set(prev);
    next.has(jobNo) ? next.delete(jobNo) : next.add(jobNo);
    return next;
  });
  const selectableJobs = filtered.map(g => g.jobNo);
  const allSelected = selectableJobs.length > 0 && selectableJobs.every(j => selected.has(j));
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(selectableJobs));
  const printSelected = () => {
    const groups = groupedProjects.filter(g => selected.has(g.jobNo));
    openStsReport(groups, params, debtEvents);
  };
  const printOne = (jobNo) => {
    const g = groupedProjects.find(x => x.jobNo === jobNo);
    if (g) openStsReport([g], params, debtEvents);
  };

  const openGroup = groupedProjects.find(g => g.jobNo === openJobNo);

  return (
    <div className="page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">STS Workflow · review &amp; calc</h1>
          <div className="page-sub">
            จับคู่ใบรับเงินกับสัญญา STS · คำนวณดอกเบี้ย + ค่าบริการเอนคอมพาส
          </div>
        </div>
      </div>

      <div className="grid grid-4 anim-stagger" style={{ marginBottom: 16 }}>
        <KpiTile animate={false} label="โครงการรอ Review"      value={pendingCount}   accent="var(--bad)"            icon="invoice" unit=" โครงการ" digits={0} />
        <KpiTile animate={false} label="โครงการตรวจสอบแล้ว"    value={doneCount}      accent="var(--good)"           icon="coin"    unit=" โครงการ" digits={0} />
        <KpiTile animate={false} label="ดอกเบี้ย STS+WCI รวม" value={totalInterest}  accent="var(--brand-500)"      icon="money" />
        <KpiTile animate={false} label="ค่าบริการเอนคอมพาส"   value={totalEncompass} accent="oklch(52% 0.16 220)"   icon="bank" />
      </div>

      <div className="card" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <div className="tabnav" style={{ flex: 'none' }}>
          <button className={filter === 'all'     ? 'active' : ''} onClick={() => setFilter('all')}>ทั้งหมด ({groupedProjects.length})</button>
          <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>รอ review ({pendingCount})</button>
          <button className={filter === 'done'    ? 'active' : ''} onClick={() => setFilter('done')}>ตรวจแล้ว ({doneCount})</button>
        </div>
        <button className="btn btn-ghost btn-sm" disabled={selected.size === 0} onClick={printSelected}
          style={{ marginLeft: 'auto', opacity: selected.size === 0 ? 0.5 : 1 }}
          title="ปริ้นรายการที่เลือกเป็น PDF (A4) — เลือกหลายรายการได้">
          <Icon name="print" size={14} /> ปริ้น PDF{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
        <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>
          Mgmt {(params.mgmtRate*100).toFixed(1)}% · WHT mgmt {(params.whtMgmt*100).toFixed(0)}% / int {(params.whtInterest*100).toFixed(0)}%
        </div>
      </div>

      {groupedProjects.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
          <div style={{ fontWeight: 600, color: 'var(--ink-600)', marginBottom: 8 }}>ไม่พบใบรับที่ match กับสัญญา STS</div>
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
            ตรวจสอบว่า: debtMaster มีสัญญาหมวด STS, receipts มี projectCode ตรงกับ jobNo ของสัญญา
          </div>
        </div>
      )}

      {groupedProjects.length > 0 && (
        <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'min(480px, calc(100vh - 400px))' }}>
            <table className="tbl" style={{ minWidth: 1180, fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' }}>
                <tr>
                  <th style={{ width: 34, textAlign: 'center' }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      style={{ cursor: 'pointer' }} title="เลือก/ยกเลิกทั้งหมด" />
                  </th>
                  <th style={{ width: 100 }}>รหัสโครงการ</th>
                  <th style={{ width: 60, textAlign: 'right' }}>ใบรับ</th>
                  <th style={{ width: 110 }}>รับเงินล่าสุด</th>
                  <th>สัญญา STS</th>
                  <th style={{ textAlign: 'right', width: 130 }}>ยอดรวมที่รับ</th>
                  <th style={{ textAlign: 'right', width: 70 }}>จำนวนวัน</th>
                  <th style={{ textAlign: 'right', width: 120 }}>ดอกเบี้ยรวม</th>
                  <th style={{ textAlign: 'right', width: 120 }}>ค่าบริการ</th>
                  <th style={{ width: 130 }}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(g => {
                  const c = computeStsRowMulti(g.receipts, g.match, params, debtEvents);
                  const sts = g.match.sts;
                  const wciCount = g.match.wci ? expandDrawdowns(g.match.wci, debtEvents).length : 0;
                  const stsCount = sts ? expandDrawdowns(sts, debtEvents).length : 0;
                  const done    = isProjectDone(g);
                  const partial = isProjectPartial(g);
                  return (
                    <tr key={g.jobNo} onClick={() => setOpenJobNo(g.jobNo)}
                        style={{ cursor: 'pointer', background: selected.has(g.jobNo) ? 'var(--brand-50)' : done ? '#f0fdf4' : partial ? '#fffbeb' : undefined }}>
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(g.jobNo)} onChange={() => toggleSelect(g.jobNo)}
                          style={{ cursor: 'pointer' }} />
                      </td>
                      <td style={{ fontFamily: 'ui-monospace', fontSize: 11, fontWeight: 600 }}>{g.jobNo}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {g.receipts.length}
                      </td>
                      <td>{fmtDate(c.latestDate)}</td>
                      <td style={{ fontSize: 11 }}>
                        {/* ★ guard sts undefined — match อาจผ่าน WCI อย่างเดียว → sts ว่าง (เคยทำจอ STS Workflow พัง) */}
                        <div style={{ fontWeight: 600 }}>{sts ? sts.contractNo : ((g.match.wci && g.match.wci.contractNo) || '—')}</div>
                        <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>
                          STS {bMoney(sts ? sts.principalAmount : 0)} {stsCount > 1 ? ' (' + stsCount + ' งวด)' : ''} · WCI {wciCount} งวด
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{bMoney(c.baseAmount)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.days}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#9b1c1c' }}>{bMoney(c.interest)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#0369a1' }}>{bMoney(c.encompassPayable)}</td>
                      <td>
                        {done    ? <Badge kind="b-green" dot={false}>✓ ตรวจแล้ว</Badge>
                        : partial ? <Badge kind="b-amber" dot={false}>บางส่วน ({g.results.length}/{g.receipts.length})</Badge>
                                  : <Badge kind="b-amber" dot={false}>รอ review</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <StsCalcDrawer
        projectReceipts={openGroup?.receipts}
        match={openGroup?.match}
        calcResult={openGroup?.results?.[0]}
        isOpen={!!openGroup}
        onClose={() => setOpenJobNo(null)}
        onConfirm={handleConfirm}
        onPrint={() => openGroup && printOne(openGroup.jobNo)}
        onCancelReview={() => openGroup && handleCancelReview(openGroup.jobNo)}
        canEdit={canEdit}
        params={params}
        setParams={setParams}
        debtEvents={debtEvents}
      />
    </div>
  );
}

Object.assign(window, { StsWorkflowPage });
