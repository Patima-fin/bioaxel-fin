// BIOAXEL — งบแสดงฐานะการเงิน (Statement of Financial Position / Balance Sheet)
// ─────────────────────────────────────────────────────────────────────────────
// พอร์ตแนวคิดจากตัวอย่าง repo `nantawan-nan/finance-tools` (ตาราง financial_statements
// kind='balance', data=jsonb, อัปโหลด Excel → parse → upsert + seed fallback) แต่ใช้
// โครงสร้างของ BIOAXEL เอง: เก็บงบทั้งชุดเป็น "ก้อน JSON" ใน WTPOverride (manualOverrides,
// key `bs.data`) — sync ทั้งทีมโดยไม่ต้องสร้างตารางใหม่ (แพทเทิร์นเดียวกับ `pnl.costBA`).
// ค่าเริ่มต้น (BS_SEED) = ข้อมูลจากไฟล์เตย "งบการเงิน Bioaxel เดือน 1-6.69.xlsx"
// ชีต “งบฐานะการเงิน(รวม)” ณ 30 มิ.ย. 2569 (ปีบัญชี ก.ค.–มิ.ย. · เทียบงวดก่อน 30 มิ.ย. 2568).
// ⚠️ หัวคอลัมน์งวดเทียบในชีตนั้นพิมพ์เป็น "2567" ซึ่งผิด (P&L ในไฟล์เดียวกันใช้ 2568) —
//    งวดเทียบที่ถูกคือ 2568 (ปีบัญชีก่อนหน้า). BIO ไม่มีปี 2567.
//
// Globals reused from the app shell: React, Icon, Modal, WTPOverride, WTPAuth,
// XLSX (SheetJS), html2canvas.  ทุก identifier prefix `BS`/`bs` กันชน global scope.
// เพิ่มไฟล์นี้ → ต้องเพิ่ม <script type="text/babel"> ใน index.html + route ใน app.jsx.

const { useState: bsState, useMemo: bsMemo, useRef: bsRef } = React;

// ── number helpers (parentheses for negatives — ตรงกับหน้า P&L) ──
function BS_fmt(v, opt) {
  opt = opt || {};
  if (v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) return opt.dash || '—';
  const n = Number(v);
  if (opt.blankZero && Math.abs(n) < 0.005) return '—';
  const dec = (opt.dec === undefined) ? 2 : opt.dec;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return n < 0 ? '(' + s + ')' : s;
}
function BS_fmtPct(v, opt) {
  opt = opt || {};
  if (v === null || v === undefined || isNaN(v) || !isFinite(v)) return '—';
  const s = Math.abs(v).toFixed(opt.dec === undefined ? 1 : opt.dec) + '%';
  return v < 0 ? '(' + s + ')' : s;
}
const BS_neg = (v) => (typeof v === 'number' && v < 0) ? ' bs-neg' : '';
const BS_PALETTE = ['#3b82f6', '#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#94a3b8'];

// ── SEED (จากไฟล์เตย · ชีต “งบฐานะการเงิน(รวม)”) ──────────────────────────────
// kind: section=หัวใหญ่ · group=หัวกลุ่มย่อย · line=รายการ · subtotal=รวมย่อย
//       total=รวมหลัก · grand=รวมหนี้สิน+ทุน · memo=เปิดเผย (ไม่รวมในยอด)
const BS_SEED = {
  company:   'บริษัท ไบโอแอ็กซ์เซล จำกัด',
  companyEn: 'BIOAXEL CO., LTD.',
  title:     'งบแสดงฐานะการเงิน',
  titleEn:   'Statement of Financial Position',
  asOf:      'ณ วันที่ 30 มิถุนายน 2569',
  curLabel:  'ณ 30 มิ.ย. 2569',
  prevLabel: 'ณ 30 มิ.ย. 2568',
  curYear:   '2569',
  prevYear:  '2568',
  unit:      'บาท',
  updatedAt: '',
  source:    'ไฟล์งบการเงิน Bioaxel เดือน 1-6.69 · ชีต “งบฐานะการเงิน(รวม)”',
  rows: [
    { kind: 'section', label: 'สินทรัพย์', en: 'Assets' },
    { kind: 'group', label: 'สินทรัพย์หมุนเวียน', en: 'Current assets' },
    { kind: 'line', label: 'เงินสดและรายการเทียบเท่าเงินสด', cur: 3776252.19, prev: 1047651.79 },
    { kind: 'line', label: 'เงินลงทุนชั่วคราว', cur: 1260931.91, prev: 1107148.05 },
    { kind: 'line', label: 'ลูกหนี้การค้าและลูกหนี้หมุนเวียนอื่น', cur: 14602559.67, prev: 3557043.67 },
    { kind: 'line', label: 'เงินให้กู้ยืมระยะสั้นแก่บุคคล/บริษัทที่เกี่ยวข้องกันและดอกเบี้ยค้างรับ', cur: 4195643.93, prev: 3065643.90 },
    { kind: 'line', label: 'สินค้าคงเหลือ', cur: 2638019.53, prev: 19120124.06 },
    { kind: 'line', label: 'สินทรัพย์หมุนเวียนอื่น', cur: 1606903.22, prev: 407276.92 },
    { kind: 'subtotal', label: 'รวมสินทรัพย์หมุนเวียน', cur: 28080310.45, prev: 28304888.39 },
    { kind: 'group', label: 'สินทรัพย์ไม่หมุนเวียน', en: 'Non-current assets' },
    { kind: 'line', label: 'เงินฝากธนาคารที่มีภาระค้ำประกัน', cur: null, prev: 139500 },
    { kind: 'line', label: 'ส่วนปรับปรุงที่ดินและอาคารบนที่ดินเช่าและอุปกรณ์', cur: 41907168.78, prev: 37563307.01 },
    { kind: 'line', label: 'สินทรัพย์ไม่มีตัวตน', cur: 2788194.79, prev: null },
    { kind: 'line', label: 'สินทรัพย์ไม่หมุนเวียนอื่น', cur: 955750, prev: 593689.30 },
    { kind: 'subtotal', label: 'รวมสินทรัพย์ไม่หมุนเวียน', cur: 45651113.57, prev: 38296496.31 },
    { kind: 'total', label: 'รวมสินทรัพย์', en: 'Total assets', cur: 73731424.02, prev: 66601384.70 },

    { kind: 'section', label: 'หนี้สินและส่วนของผู้ถือหุ้น', en: 'Liabilities and equity' },
    { kind: 'group', label: 'หนี้สินหมุนเวียน', en: 'Current liabilities' },
    { kind: 'line', label: 'เจ้าหนี้การค้าและเจ้าหนี้หมุนเวียนอื่น', cur: 41828175.50, prev: 7965436.12 },
    { kind: 'line', label: 'เงินกู้ยืมระยะสั้นและดอกเบี้ยค้างจ่าย', cur: 109177680.56, prev: 63024039.14 },
    { kind: 'line', label: 'ส่วนของหนี้สินระยะยาวที่ถึงกำหนดชำระภายในหนึ่งปี', cur: 20650.82, prev: 142424 },
    { kind: 'subtotal', label: 'รวมหนี้สินหมุนเวียน', cur: 151026506.88, prev: 71131899.26 },
    { kind: 'group', label: 'หนี้สินไม่หมุนเวียน', en: 'Non-current liabilities' },
    { kind: 'line', label: 'หนี้สินตามสัญญาเช่าเงินทุน', cur: 302500, prev: 342440.18 },
    { kind: 'line', label: 'ประมาณการหนี้สินสำหรับผลประโยชน์พนักงาน', cur: 1378377.36, prev: 660764.16 },
    { kind: 'subtotal', label: 'รวมหนี้สินไม่หมุนเวียน', cur: 1680877.36, prev: 1003204.34 },
    { kind: 'total', label: 'รวมหนี้สิน', en: 'Total liabilities', cur: 152707384.24, prev: 72135103.60 },
    { kind: 'group', label: 'ส่วนของผู้ถือหุ้น', en: 'Equity' },
    { kind: 'line', label: 'ทุนจดทะเบียน', sub: 'หุ้นสามัญ 903,610 หุ้น มูลค่าหุ้นละ 100.00 บาท', memo: true, cur: 90361000, prev: 90361000 },
    { kind: 'line', label: 'ทุนที่ออกและเรียกชำระแล้ว', sub: 'หุ้นสามัญ 903,610 หุ้น มูลค่าหุ้นละ 100.00 บาท', cur: 90361000, prev: 90361000 },
    { kind: 'line', label: 'ขาดทุนสะสม (ขาดทุนเกินทุน)', cur: -169336960.22, prev: -95894718.90 },
    { kind: 'total', label: 'รวมส่วนของผู้ถือหุ้น', en: 'Total equity', cur: -78975960.22, prev: -5533718.90 },
    { kind: 'grand', label: 'รวมหนี้สินและส่วนของผู้ถือหุ้น', en: 'Total liabilities and equity', cur: 73731424.02, prev: 66601384.70 },
  ],
};

// ── หา row จาก label (สำหรับ KPI/อัตราส่วน) ──
function BS_find(rows, re) {
  const r = (rows || []).find(x => re.test(String(x.label || '')));
  return r || { cur: null, prev: null };
}

// ── parse ไฟล์ Excel (ชีต “งบฐานะการเงิน(รวม)”) → โครงสร้าง BS ──────────────
// ทน layout จริง: label กระจายคอลัมน์ B–E (indent), ค่างวดปัจจุบัน/ก่อนอยู่คอลัมน์
// ที่หัวเป็นปี พ.ศ. (2569 / 2567). รวม row ที่ label ห่อบรรทัด (“และดอกเบี้ยค้างรับ”).
function BS_parseWorkbook(f) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) { reject(new Error('ไม่พบไลบรารี SheetJS — รีเฟรชหน้าแล้วลองใหม่')); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const X = window.XLSX;
        const wb = X.read(e.target.result, { type: 'array', cellDates: false });
        const norm = (s) => String(s || '').replace(/\s+/g, '');
        const aoaOf = (n) => X.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false });
        // เลือกชีต: “งบฐานะการเงิน(รวม)” ก่อน → มี “ฐานะการเงิน” → มี “รวมสินทรัพย์”
        let sn = wb.SheetNames.find(n => /ฐานะการเงิน\(รวม\)|ฐานะการเงินรวม/.test(norm(n)));
        if (!sn) sn = wb.SheetNames.find(n => /ฐานะการเงิน|balance|financialposition|statementoffinancial/i.test(norm(n)));
        if (!sn) sn = wb.SheetNames.find(n => aoaOf(n).some(r => (r || []).some(c => /รวมสินทรัพย์/.test(String(c || '')))));
        if (!sn) { reject(new Error('ไม่พบชีตงบแสดงฐานะการเงินในไฟล์ (มองหาชีต “งบฐานะการเงิน(รวม)”)')); return; }
        const aoa = aoaOf(sn);

        // หาแถวหัวคอลัมน์ปี (มีเลข พ.ศ. 4 หลัก ≥ 2 คอลัมน์) → คอลัมน์งวดปัจจุบัน/ก่อน
        const yrOf = (v) => { const d = String(v == null ? '' : v).replace(/[^0-9]/g, ''); return (d.length === 4 && +d >= 2400 && +d <= 2700) ? d : ''; };
        let hdrIdx = -1, curCol = -1, prevCol = -1, curYear = '', prevYear = '';
        for (let i = 0; i < aoa.length; i++) {
          const row = aoa[i] || [], yc = [];
          for (let c = 0; c < row.length; c++) if (yrOf(row[c])) yc.push(c);
          if (yc.length >= 2) { hdrIdx = i; curCol = yc[0]; prevCol = yc[1]; curYear = yrOf(row[curCol]); prevYear = yrOf(row[prevCol]); break; }
        }
        if (curCol < 0) { reject(new Error('อ่านหัวคอลัมน์ปีไม่ได้ — ต้องมีปี พ.ศ. 2 คอลัมน์ (เช่น 2569 / 2567)')); return; }

        const firstText = (re) => { for (const r of aoa) for (const c of (r || [])) { const s = String(c || '').trim(); if (re.test(s)) return s; } return ''; };
        const asOf    = firstText(/^ณ\s*วันที่/);
        const company = firstText(/บริษัท.*จำกัด/) || BS_SEED.company;
        const numAt = (row, c) => { const v = row[c]; if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };

        const rows = [];
        for (let i = hdrIdx + 1; i < aoa.length; i++) {
          const row = aoa[i] || [];
          let label = '', col = -1;
          for (let c = 0; c < curCol; c++) { const s = String(row[c] == null ? '' : row[c]).trim(); if (s) { label = s; col = c; break; } }
          for (let c = col + 1; c < curCol; c++) { const s = String(row[c] == null ? '' : row[c]).trim(); if (s) label += (label ? ' ' : '') + s; }
          const cur = numAt(row, curCol), prev = numAt(row, prevCol);
          if (!label && cur == null && prev == null) continue;
          if (/^บาท$/.test(label) || /^หมายเหตุ$/.test(label) || /งบฐานะการเงิน|งบแสดงฐานะ/.test(label)
            || /^ณ\s*วันที่/.test(label) || /บริษัท.*จำกัด/.test(label)) continue;
          rows.push({ label, cur, prev, col });
        }
        // รวม row ที่ห่อบรรทัด: บรรทัดมีค่า แต่บรรทัดก่อนหน้าเป็น label-only ระดับรายการ (col≥2)
        for (let i = rows.length - 1; i > 0; i--) {
          const c = rows[i], p = rows[i - 1];
          const contByAnd = /^และ/.test(c.label) && p.cur == null && p.prev == null;
          const contByWrap = (c.cur != null || c.prev != null) && p.cur == null && p.prev == null && p.col >= 2 && !/^รวม/.test(c.label);
          if (contByAnd || contByWrap) { p.label = (p.label + ' ' + c.label).trim(); p.cur = c.cur; p.prev = c.prev; rows.splice(i, 1); }
        }
        // จำแนก kind
        const out = rows.map(r => {
          let kind = 'line';
          if (r.cur == null && r.prev == null) kind = /^(สินทรัพย์|หนี้สินและส่วนของผู้ถือหุ้น)$/.test(r.label) ? 'section' : 'group';
          if (/^รวมหนี้สินและส่วนของผู้ถือหุ้น/.test(r.label)) kind = 'grand';
          else if (/^รวมสินทรัพย์$|^รวมหนี้สิน$|^รวมส่วนของผู้ถือหุ้น/.test(r.label)) kind = 'total';
          else if (/^รวม/.test(r.label)) kind = 'subtotal';
          const o = { kind, label: r.label, cur: r.cur, prev: r.prev };
          if (/ทุนจดทะเบียน/.test(r.label)) o.memo = true;   // เปิดเผย — ไม่รวมในยอด
          return o;
        });

        const nVal = out.filter(r => r.cur != null || r.prev != null).length;
        if (nVal < 6) { reject(new Error('อ่านรายการในงบได้น้อยผิดปกติ (' + nVal + ' รายการ) — โปรดตรวจรูปแบบไฟล์')); return; }
        // ตรวจงบดุล: สินทรัพย์ = หนี้สิน+ทุน (คลาดได้ ±1 บาท)
        const A = BS_find(out, /^รวมสินทรัพย์$/).cur, LE = BS_find(out, /^รวมหนี้สินและส่วนของผู้ถือหุ้น/).cur;
        if (A != null && LE != null && Math.abs(A - LE) > 1) {
          reject(new Error('งบไม่ดุล: รวมสินทรัพย์ ' + BS_fmt(A) + ' ≠ รวมหนี้สิน+ทุน ' + BS_fmt(LE) + ' — โปรดตรวจไฟล์')); return;
        }
        // งวดเทียบ = ปีบัญชีก่อนหน้าเสมอ (curYear − 1) — ไม่อิงเลขปีในหัวคอลัมน์
        // เพราะชีต “งบฐานะการเงิน(รวม)” พิมพ์งวดเทียบผิดเป็น 2567 (ที่ถูก = 2568 ตาม P&L).
        const prevYearFix = String(Number(curYear) - 1);   // ไม่ใช้ prevYear ดิบจากไฟล์ (อาจพิมพ์ผิด)
        const curLbl  = asOf ? asOf.replace(/^ณ\s*วันที่\s*/, 'ณ ') : ('ปี ' + curYear);
        const prevLbl = asOf ? ('ณ ' + asOf.replace(/^ณ\s*วันที่\s*/, '').replace(curYear, prevYearFix)) : ('ปี ' + prevYearFix);
        resolve({
          ...BS_SEED, company, asOf: asOf || BS_SEED.asOf, curYear, prevYear: prevYearFix,
          curLabel: curLbl, prevLabel: prevLbl, rows: out,
          source: 'อัปโหลด: ' + f.name + ' · ชีต “' + sn + '”',
        });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsArrayBuffer(f);
  });
}

// ── ให้คะแนน 0–100 จากค่าอัตราส่วน (piecewise-linear ตามจุดเกณฑ์) — self-contained ในไฟล์นี้ ──
function BS_scoreLinear(v, pts) {
  if (v == null || isNaN(v)) return null;
  if (v <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) { const [v0, s0] = pts[i], [v1, s1] = pts[i + 1]; if (v <= v1) return s0 + (s1 - s0) * (v - v0) / (v1 - v0); }
  return pts[pts.length - 1][1];
}

// ── แถวอัตราส่วน (แถบคะแนน 0–100 + คลิกกางดู สูตร/ค่า/ผลลัพธ์/เกณฑ์คะแนน/ที่มา) — เลย์เอาต์เลียนแบบ finance-tools ──
function BSRatioRow({ r, last }) {
  const [open, setOpen] = bsState(false);
  const statusCol = r.status === 'good' ? '#16a34a' : (r.status === 'warn' ? '#d97706' : '#dc2626');
  const scol = r.score == null ? statusCol : (r.score >= 70 ? '#16a34a' : (r.score >= 45 ? '#d97706' : '#dc2626'));
  const dt = r.detail || {};
  const sb = dt.scoreBand;
  const hdRow = { display: 'flex', gap: 10, padding: '2px 0' };
  const hdK = { color: '#94a3b8', minWidth: 88, flexShrink: 0 };
  const fmtBT = (t, unit) => unit === '%' ? (Math.round(t * 100) + '%') : (unit === 'x' ? (t.toFixed(1) + '×') : (t.toFixed(Number.isInteger(t) ? 1 : 2) + ' เท่า'));
  const renderBands = (band) => {
    const pts = band.pts, v = band.value;
    let loIdx = 0, hiIdx = pts.length - 1;
    if (v != null && !isNaN(v)) {
      if (v <= pts[0][0]) { loIdx = hiIdx = 0; }
      else if (v >= pts[pts.length - 1][0]) { loIdx = hiIdx = pts.length - 1; }
      else { for (let i = 0; i < pts.length - 1; i++) { if (v >= pts[i][0] && v <= pts[i + 1][0]) { loIdx = i; hiIdx = i + 1; break; } } }
    }
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {pts.map((p, i) => {
            const on = v != null && !isNaN(v) && i >= loIdx && i <= hiIdx;
            return <span key={i} style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap', border: on ? '1px solid #8b5cf6' : '1px solid #e2e8f0', background: on ? '#f5f3ff' : '#fff', color: on ? '#6d28d9' : '#94a3b8', boxShadow: on ? '0 1px 3px rgba(139,92,246,0.25)' : 'none' }}>{fmtBT(p[0], band.unit)} → {p[1]}</span>;
          })}
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 5 }}>
          คะแนน 0–100 (ยิ่งสูงยิ่งดี){band.lowerBetter ? ' · ค่ายิ่งต่ำยิ่งได้คะแนนมาก' : ''}
          {v != null && !isNaN(v) ? <> · <b style={{ color: '#4338ca' }}>ค่าปัจจุบัน {fmtBT(v, band.unit)} → คะแนน {r.score}</b></> : ''}
        </div>
      </div>
    );
  };
  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid #f1f5f9' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 150px) minmax(44px, 1fr) 30px minmax(0, 116px)', alignItems: 'center', gap: 10, padding: '9px 2px', fontSize: 12.5, cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 12, color: '#94a3b8', fontSize: 10, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: scol, flexShrink: 0 }} />
          <span style={{ color: '#334155', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
        </span>
        <span style={{ textAlign: 'right', color: '#475569', fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.valueText}</span>
        <span style={{ height: 8, borderRadius: 5, background: '#f1f5f9', overflow: 'hidden' }} title={r.score != null ? 'คะแนน ' + r.score + '/100' : ''}>{r.score != null && <span style={{ display: 'block', height: '100%', width: Math.max(0, Math.min(100, r.score)) + '%', background: scol, borderRadius: 5 }} />}</span>
        <span style={{ textAlign: 'right', fontWeight: 800, color: scol, fontVariantNumeric: 'tabular-nums' }}>{r.score != null ? r.score : '—'}</span>
        <span style={{ textAlign: 'right', color: scol, fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.statusText}</span>
      </div>
      {open && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: '10px 12px', margin: '2px 0 8px', fontSize: 12 }}>
          <div style={hdRow}><span style={hdK}>สูตร</span><span style={{ fontFamily: 'ui-monospace, monospace', color: '#334155' }}>{dt.formula}</span></div>
          {(dt.inputs || []).filter(x => x.value != null).map((x, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0 2px 88px', color: '#475569' }}>
              <span>{x.label}</span><b style={{ fontVariantNumeric: 'tabular-nums', color: '#0f172a' }}>{BS_fmt(x.value)}</b>
            </div>
          ))}
          <div style={hdRow}><span style={hdK}>ผลลัพธ์</span><b style={{ color: '#2e8b4a', fontVariantNumeric: 'tabular-nums' }}>{dt.result}</b></div>
          {dt.std && <div style={hdRow}><span style={hdK}>เกณฑ์มาตรฐาน</span><span style={{ color: '#334155' }}>🎯 {dt.std}</span></div>}
          <div style={{ ...hdRow, alignItems: 'flex-start' }}><span style={hdK}>เกณฑ์คะแนน</span>{sb ? renderBands(sb) : <span style={{ color: '#64748b' }}>{dt.bands}</span>}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e2e8f0', color: '#94a3b8', fontSize: 11 }}>
            <span>📄</span><span>ที่มา: {dt.src}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── เกจคะแนนฐานะการเงินรวม (วงกลม conic-gradient) — สไตล์เดียวกับการ์ดสุขภาพหน้า P&L ──
function BSGauge({ score }) {
  const col = score >= 70 ? '#22c55e' : (score >= 45 ? '#f59e0b' : '#ef4444');
  const stat = score >= 70 ? 'ดี' : (score >= 45 ? 'เฝ้าระวัง' : 'ต้องดำเนินการ');
  return (
    <div style={{ textAlign: 'center', padding: '6px 4px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>คะแนนฐานะการเงินรวม</div>
      <div style={{ width: 150, height: 150, borderRadius: '50%', margin: '0 auto', background: 'conic-gradient(' + col + ' ' + (score * 3.6) + 'deg, #e2e8f0 0)', display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 112, height: 112, borderRadius: '50%', background: 'white', display: 'grid', placeItems: 'center' }}>
          <div><span style={{ fontSize: 34, fontWeight: 800, color: '#0f172a' }}>{score}</span><span style={{ fontSize: 13, color: '#94a3b8' }}>/100</span></div>
        </div>
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: col, color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />{stat}</div>
    </div>
  );
}

// ── กล่องวิเคราะห์ฐานะการเงิน (Auto Generated) — พอร์ตจาก finBalInsight (finance-tools) ──
function BSInsight({ m, bs }) {
  const ta = m.totalAssets.cur, tl = m.totalLiab.cur, eq = m.equity.cur, ca = m.curAssets.cur, cl = m.curLiab.cur;
  const f = (v) => BS_fmt(v);
  const asof = (bs.asOf || '').replace(/^ณ\s*/, '');
  const eqNeg = eq != null && eq < 0;
  // จุดสังเกต (bullets)
  const B = [];
  if (ca != null && cl) { const cr = ca / cl; B.push({ t: cr >= 1 ? 'good' : 'bad', x: 'สภาพคล่อง ' + cr.toFixed(2) + ' เท่า — สินทรัพย์หมุนเวียน ' + f(ca) + ' เทียบหนี้สินหมุนเวียน ' + f(cl) }); }
  if (ca != null && cl != null) { const wc = ca - cl; B.push({ t: wc > 0 ? 'good' : 'bad', x: 'เงินทุนหมุนเวียนสุทธิ ' + f(wc) + ' บาท ' + (wc > 0 ? '(เป็นบวก)' : '(ติดลบ)') }); }
  if (tl != null && ta) { const dr = tl / ta; B.push({ t: dr < 1 ? 'warn' : 'bad', x: 'หนี้สินคิดเป็น ' + (dr * 100).toFixed(0) + '% ของสินทรัพย์' + (dr > 1 ? ' (หนี้มากกว่าสินทรัพย์)' : '') }); }
  if (eqNeg) B.push({ t: 'bad', x: 'ส่วนของผู้ถือหุ้นติดลบ ' + f(eq) + ' บาท — ต้องเพิ่มทุนหรือแปลงหนี้เป็นทุน' });
  // ข้อเสนอแนะ (recs)
  const Rc = [];
  if (eqNeg) Rc.push('เพิ่มทุน / แปลงเงินกู้กรรมการเป็นทุน (debt-to-equity) เพื่อแก้ส่วนของผู้ถือหุ้นติดลบ');
  if (ca != null && cl && ca / cl < 1.2) Rc.push('ดูแลสภาพคล่อง — เร่งเก็บลูกหนี้ / ลดสินค้าคงคลัง ให้สินทรัพย์หมุนเวียนคุ้มหนี้ระยะสั้น');
  if (tl != null && ta && tl / ta > 0.7) Rc.push('ลดภาระหนี้ — สัดส่วนหนี้ต่อสินทรัพย์สูง ควรทยอยชำระ / รีไฟแนนซ์ดอกเบี้ยต่ำ');
  if (!Rc.length) Rc.push('รักษาโครงสร้างทุนให้แข็งแรงต่อเนื่อง');
  const bico = (t) => {
    const c = t === 'good' ? '#059669' : (t === 'bad' ? '#dc2626' : '#d97706');
    const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: c, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flexShrink: 0, marginTop: 2 } };
    if (t === 'good') return <svg {...common}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
    if (t === 'warn') return <svg {...common}><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>;
    return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>;
  };
  return (
    <div style={{ background: 'linear-gradient(180deg,#f8fafc,#fff)', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>✨</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>วิเคราะห์ฐานะการเงิน</div>
          <div style={{ fontSize: 11.5, color: '#94a3b8' }}>สภาพคล่อง · โครงสร้างหนี้ · ส่วนของผู้ถือหุ้น</div>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: '#6366f1', background: '#eef2ff', padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>Auto Generated</span>
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: '#1e293b', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
        ณ {asof} บริษัทมีสินทรัพย์รวม <b>{f(ta)}</b> บาท · เงินทุนมาจากหนี้สิน <b>{f(tl)}</b> บาท และส่วนของผู้ถือหุ้น <b style={{ color: eqNeg ? '#dc2626' : '#059669' }}>{f(eq)}</b> บาท
        {eqNeg && <> — <b style={{ color: '#dc2626' }}>ส่วนของผู้ถือหุ้นติดลบ (ขาดทุนสะสมเกินทุน)</b> คือจุดที่ต้องเร่งแก้</>}.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '8px 18px', marginBottom: 14 }}>
        {B.map((x, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#334155', lineHeight: 1.5 }}>
            {bico(x.t)}<span>{x.x}</span>
          </div>
        ))}
      </div>
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 800, color: '#92400e', marginBottom: 8 }}>💡 ข้อเสนอแนะ</div>
        {Rc.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12.5, color: '#334155', lineHeight: 1.6, marginBottom: 6 }}>
            <span style={{ flexShrink: 0, width: 19, height: 19, borderRadius: '50%', background: '#f59e0b', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
            <span>{r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function BalanceSheetPage({ data, setData, toast }) {
  const [uploadOpen, setUploadOpen] = bsState(false);
  const [file, setFile] = bsState(null);
  const [drag, setDrag] = bsState(false);
  const [busy, setBusy] = bsState(false);
  const pageRef = bsRef(null);
  const reportRef = bsRef(null);
  const fileInputRef = bsRef(null);
  const canEdit = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;

  // อ่านงบจาก override `bs.data` (sync ทั้งทีม) → fallback SEED  (แพทเทิร์นเดียวกับ pnl.costBA)
  const bs = bsMemo(() => {
    try {
      const arr = (data && data.manualOverrides) || [];
      const row = arr.find(r => r && r.key === 'bs.data');
      if (!row || row.value == null || row.value === '') return BS_SEED;
      const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return (v && Array.isArray(v.rows) && v.rows.length) ? v : BS_SEED;
    } catch (_) { return BS_SEED; }
  }, [data && data.manualOverrides]);
  const isSeed = bs === BS_SEED;
  const rows = bs.rows || [];

  // ── ตัวเลขหลัก + อัตราส่วน ──
  const m = bsMemo(() => {
    const g = (re) => BS_find(rows, re);
    const totalAssets = g(/^รวมสินทรัพย์$/), curAssets = g(/^รวมสินทรัพย์หมุนเวียน$/);
    const totalLiab = g(/^รวมหนี้สิน$/), curLiab = g(/^รวมหนี้สินหมุนเวียน$/);
    const equity = g(/^รวมส่วนของผู้ถือหุ้น/), grand = g(/^รวมหนี้สินและส่วนของผู้ถือหุ้น/);
    const ratio = (a, b) => (b ? a / b : NaN);
    return {
      totalAssets, curAssets, totalLiab, curLiab, equity, grand,
      curRatio: ratio(curAssets.cur, curLiab.cur),
      curRatioPrev: ratio(curAssets.prev, curLiab.prev),
      debtToAssets: totalAssets.cur ? totalLiab.cur / totalAssets.cur * 100 : NaN,
      de: (equity.cur && equity.cur !== 0) ? totalLiab.cur / equity.cur : NaN,
      balanced: (totalAssets.cur != null && grand.cur != null) ? Math.abs(totalAssets.cur - grand.cur) <= 1 : true,
    };
  }, [rows]);

  // ── โครงสร้างสินทรัพย์ (donut) + แหล่งเงินทุน (bars) + Pareto รายการ — พอร์ตจาก finBalAssetComp/finBalFunding ──
  const bsCharts = bsMemo(() => {
    // รายการสินทรัพย์ / หนี้สิน (เฉพาะ kind 'line')
    const aIcon = (n) => /เงินสด/.test(n) ? '💵' : (/ลูกหนี้/.test(n) ? '🧾' : (/เงินลงทุน/.test(n) ? '📈' : (/ให้กู้|กู้ยืม/.test(n) ? '🤝' : (/สินค้า|คงเหลือ/.test(n) ? '📦' : (/ที่ดิน|อาคาร|อุปกรณ์|ปรับปรุง/.test(n) ? '🏭' : (/ไม่มีตัวตน/.test(n) ? '💠' : (/ธนาคาร|ฝาก/.test(n) ? '🏦' : '🔹')))))));
    const lIcon = (n) => /เจ้าหนี้/.test(n) ? '🧾' : (/กู้ยืม|เงินกู้/.test(n) ? '🏦' : (/พนักงาน|ผลประโยชน์/.test(n) ? '👥' : (/เช่า/.test(n) ? '📄' : (/ดอกเบี้ย/.test(n) ? '💸' : '🔻'))));
    let inAssets = false, inLiab = false; const alines = [], llines = [];
    for (const r of rows) {
      if (r.kind === 'section') { inAssets = (r.label === 'สินทรัพย์'); inLiab = /หนี้สิน/.test(r.label); continue; }
      if (r.kind === 'group' && /ส่วนของผู้ถือหุ้น/.test(r.label)) inLiab = false;   // เข้าโซนทุน → หยุดเก็บหนี้สิน
      if (r.kind === 'line' && r.cur != null && Math.abs(r.cur) > 0.01) {
        if (inAssets) alines.push({ name: r.label, value: r.cur, icon: aIcon(r.label) });
        else if (inLiab) llines.push({ name: r.label, value: r.cur, icon: lIcon(r.label) });
      }
    }
    const assetLines = alines.slice(), liabLines = llines.slice();
    alines.sort((a, b) => b.value - a.value);
    let lines = alines;
    if (lines.length > 7) { const top = lines.slice(0, 6); const rest = lines.slice(6).reduce((s, x) => s + x.value, 0); top.push({ name: 'อื่น ๆ', value: rest }); lines = top; }
    const tot = lines.reduce((s, x) => s + x.value, 0) || 1;
    const assetComp = lines.map((x, i) => ({ label: x.name, value: x.value, valueLabel: (x.value / tot * 100).toFixed(0) + '%', color: BS_PALETTE[i % BS_PALETTE.length] }));
    // แหล่งเงินทุน
    const nclRow = BS_find(rows, /^รวมหนี้สินไม่หมุนเวียน$/);
    const items = [
      { name: 'หนี้สินหมุนเวียน', value: m.curLiab.cur, color: '#f59e0b' },
      { name: 'หนี้สินไม่หมุนเวียน', value: nclRow ? nclRow.cur : null, color: '#ef4444' },
      { name: 'ส่วนของผู้ถือหุ้น', value: m.equity.cur, color: '#22c55e' },
    ].filter(x => x.value != null);
    const base = Math.abs(m.totalAssets.cur) || 1;
    const funding = items.map(x => ({ name: x.name, value: x.value, color: x.value < 0 ? '#dc2626' : x.color, pct: x.value / base }));
    return { assetComp, funding, assetLines, liabLines };
  }, [rows, m]);

  // ── บันทึกรูป / พิมพ์ ──
  const saveImage = () => {
    if (!window.html2canvas) { toast('ระบบบันทึกรูปยังไม่พร้อม'); return; }
    const target = pageRef.current; if (!target) return;
    toast('กำลังเตรียมรูปภาพ…');
    window.html2canvas(target, { scale: 2, backgroundColor: '#f4f7fb', useCORS: true, logging: false,
      width: target.scrollWidth, height: target.scrollHeight, windowWidth: target.scrollWidth, windowHeight: target.scrollHeight })
      .then(canvas => { const a = document.createElement('a'); a.href = canvas.toDataURL('image/png');
        a.download = 'BalanceSheet_' + new Date().toISOString().slice(0, 10) + '.png'; a.click(); toast('บันทึกรูปสำเร็จ'); })
      .catch(err => { console.error('[BS saveImage]', err); toast('บันทึกรูปไม่สำเร็จ'); });
  };

  const pickFile = (f) => { if (f) setFile(f); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); };
  const handleImport = async () => {
    if (!file) return;
    if (!canEdit) { toast('บัญชีนี้เป็นสิทธิ์อ่านอย่างเดียว'); return; }
    setBusy(true);
    try {
      const parsed = await BS_parseWorkbook(file);
      parsed.updatedAt = new Date().toISOString();
      if (window.WTPOverride) WTPOverride.setRaw('bs.data', JSON.stringify(parsed));
      const nVal = parsed.rows.filter(r => r.cur != null || r.prev != null).length;
      toast('นำเข้างบแสดงฐานะการเงินสำเร็จ (' + nVal + ' รายการ · ' + (parsed.curLabel || '') + ')');
      setFile(null); setUploadOpen(false);
    } catch (err) { toast('นำเข้าไม่สำเร็จ: ' + (err && err.message || err)); }
    finally { setBusy(false); }
  };
  const resetToSeed = () => {
    if (!canEdit) { toast('บัญชีนี้เป็นสิทธิ์อ่านอย่างเดียว'); return; }
    if (window.WTPOverride) WTPOverride.setRaw('bs.data', '');
    toast('คืนค่าตั้งต้น (ข้อมูลจากไฟล์เตย) แล้ว'); setUploadOpen(false);
  };

  // ── row renderer ──
  const valTd = (v, memo) => <td className={'bs-num' + BS_neg(v) + (memo ? ' bs-memo' : '')}>{BS_fmt(v, { blankZero: false })}</td>;
  const renderRow = (r, i) => {
    if (r.kind === 'section') return (
      <tr key={i} className="bs-r-section"><td colSpan={2}><span className="bs-sec-th">{r.label}</span>{r.en && <span className="bs-sec-en">{r.en}</span>}</td></tr>
    );
    if (r.kind === 'group') return (
      <tr key={i} className="bs-r-group"><td colSpan={2}>{r.label}{r.en && <span className="bs-grp-en"> · {r.en}</span>}</td></tr>
    );
    const cls = r.kind === 'grand' ? 'bs-r-grand' : (r.kind === 'total' ? 'bs-r-total' : (r.kind === 'subtotal' ? 'bs-r-subtotal' : 'bs-r-line'));
    return (
      <tr key={i} className={cls}>
        <td className="bs-label">
          <span>{r.label}{r.memo && <span className="bs-memo-tag">เปิดเผย</span>}</span>
          {r.sub && <span className="bs-sub">{r.sub}</span>}
        </td>
        {valTd(r.cur, r.memo)}
      </tr>
    );
  };

  // ── KPI tiles ──
  const kpiTiles = [
    { label: 'รวมสินทรัพย์', en: 'Total assets', v: m.totalAssets.cur, prev: m.totalAssets.prev,
      iconBg: '#eff6ff', iconColor: '#2563eb', icon: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" /> },
    { label: 'รวมหนี้สิน', en: 'Total liabilities', v: m.totalLiab.cur, prev: m.totalLiab.prev,
      iconBg: '#fff7ed', iconColor: '#ea580c', icon: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M7 8V6a5 5 0 0110 0v2" /></> },
    { label: 'ส่วนของผู้ถือหุ้น', en: 'Total equity', v: m.equity.cur, prev: m.equity.prev, danger: (m.equity.cur || 0) < 0,
      iconBg: '#f0fdf4', iconColor: '#16a34a', icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0112 0v1" /></> },
  ];

  // ── อัตราส่วน 5 ตัว — พอร์ตจาก finBalRatios (finance-tools) แบบ 1:1 ──
  const ratios = bsMemo(() => {
    const ca = m.curAssets.cur, cl = m.curLiab.cur, ta = m.totalAssets.cur, tl = m.totalLiab.cur, eq = m.equity.cur;
    const R = [];
    const P = (name, valueText, status, statusText, detail, score) => R.push({ name, valueText, status, statusText, detail, score: (score == null || isNaN(score)) ? null : Math.round(score) });
    // 1) สภาพคล่อง
    if (ca != null && cl) { const cr = ca / cl;
      P('อัตราส่วนสภาพคล่อง (Current Ratio)', cr.toFixed(2) + ' เท่า',
        cr >= 1.5 ? 'good' : (cr >= 1 ? 'warn' : 'bad'), cr >= 1.5 ? 'แข็งแรง' : (cr >= 1 ? 'พอใช้' : 'ตึงตัว'),
        { formula: 'สินทรัพย์หมุนเวียน ÷ หนี้สินหมุนเวียน',
          inputs: [{ label: 'รวมสินทรัพย์หมุนเวียน', value: ca }, { label: 'รวมหนี้สินหมุนเวียน', value: cl }],
          result: cr.toFixed(2) + ' เท่า', bands: '≥ 1.5 = แข็งแรง · 1–1.5 = พอใช้ · < 1 = ตึงตัว', src: 'งบแสดงฐานะการเงิน', std: '≥ 1.5 เท่า (ดีมาก ≥ 2)',
          scoreBand: { pts: [[0.5, 12], [1, 45], [1.5, 70], [2, 85], [3, 96]], value: cr, unit: 'เท่า' } },
        BS_scoreLinear(cr, [[0.5, 12], [1, 45], [1.5, 70], [2, 85], [3, 96]])); }
    // 2) เงินทุนหมุนเวียนสุทธิ
    if (ca != null && cl != null) { const wc = ca - cl, wcx = cl ? wc / cl : (wc > 0 ? 2 : -1);
      P('เงินทุนหมุนเวียนสุทธิ (Working Capital)', BS_fmt(wc) + ' บาท',
        wc > 0 ? 'good' : 'bad', wc > 0 ? 'เป็นบวก' : 'ติดลบ',
        { formula: 'สินทรัพย์หมุนเวียน − หนี้สินหมุนเวียน',
          inputs: [{ label: 'รวมสินทรัพย์หมุนเวียน', value: ca }, { label: 'รวมหนี้สินหมุนเวียน', value: cl }],
          result: BS_fmt(wc) + ' บาท', bands: 'เป็นบวก = มีสภาพคล่องหมุนเวียน · ติดลบ = ต้องเสริมเงินทุน', src: 'งบแสดงฐานะการเงิน', std: 'เป็นบวก · ≥ 50% ของหนี้สั้น',
          scoreBand: { pts: [[-0.5, 10], [0, 45], [0.5, 68], [1, 84], [2, 96]], value: wcx, unit: 'x' } },
        BS_scoreLinear(wcx, [[-0.5, 10], [0, 45], [0.5, 68], [1, 84], [2, 96]])); }
    // 3) หนี้สินต่อสินทรัพย์
    if (tl != null && ta) { const dr = tl / ta;
      P('อัตราส่วนหนี้สินต่อสินทรัพย์ (Debt Ratio)', dr.toFixed(2) + ' เท่า (' + (dr * 100).toFixed(0) + '%)',
        dr < 0.6 ? 'good' : (dr < 1 ? 'warn' : 'bad'), dr < 0.6 ? 'ปลอดภัย' : (dr < 1 ? 'เฝ้าระวัง' : 'หนี้เกินสินทรัพย์'),
        { formula: 'หนี้สินรวม ÷ สินทรัพย์รวม',
          inputs: [{ label: 'รวมหนี้สิน', value: tl }, { label: 'รวมสินทรัพย์', value: ta }],
          result: dr.toFixed(2) + ' เท่า', bands: '< 0.6 = ปลอดภัย · 0.6–1 = เฝ้าระวัง · > 1 = หนี้เกินสินทรัพย์', src: 'งบแสดงฐานะการเงิน', std: '≤ 0.6 เท่า (≤ 60%)',
          scoreBand: { pts: [[0.3, 92], [0.6, 68], [1, 42], [2, 20], [4, 8]], value: dr, unit: 'เท่า', lowerBetter: true } },
        BS_scoreLinear(dr, [[0.3, 92], [0.6, 68], [1, 42], [2, 20], [4, 8]])); }
    // 4) หนี้สินต่อทุน (D/E)
    if (tl != null && eq != null) { const neg = eq < 0, de = eq !== 0 ? tl / eq : null;
      P('อัตราส่วนหนี้สินต่อทุน (D/E)', neg ? 'ทุนติดลบ' : (de != null ? de.toFixed(2) + ' เท่า' : '—'),
        neg ? 'bad' : (de < 1.5 ? 'good' : (de < 3 ? 'warn' : 'bad')), neg ? 'ต้องเพิ่มทุน' : (de < 1.5 ? 'เหมาะสม' : 'หนี้สูง'),
        { formula: 'หนี้สินรวม ÷ ส่วนของผู้ถือหุ้น',
          inputs: [{ label: 'รวมหนี้สิน', value: tl }, { label: 'รวมส่วนของผู้ถือหุ้น', value: eq }],
          result: neg ? 'คำนวณไม่ได้ (ส่วนของผู้ถือหุ้นติดลบ)' : de.toFixed(2) + ' เท่า',
          bands: '< 1.5 = เหมาะสม · 1.5–3 = สูง · ทุนติดลบ = ต้องเพิ่มทุน', src: 'งบแสดงฐานะการเงิน', std: '≤ 1 เท่า (ดีมาก ≤ 0.5)',
          scoreBand: neg ? null : { pts: [[0.5, 90], [1, 72], [2, 45], [3, 28], [5, 10]], value: de, unit: 'เท่า', lowerBetter: true } },
        neg ? 5 : (de != null ? BS_scoreLinear(de, [[0.5, 90], [1, 72], [2, 45], [3, 28], [5, 10]]) : 8)); }
    // 5) ส่วนของผู้ถือหุ้น (Equity Ratio)
    if (eq != null && ta) { const er = eq / ta;
      P('อัตราส่วนส่วนของผู้ถือหุ้น (Equity Ratio)', (er * 100).toFixed(0) + '%',
        er >= 0.4 ? 'good' : (er > 0 ? 'warn' : 'bad'), er >= 0.4 ? 'ทุนหนา' : (er > 0 ? 'ทุนบาง' : 'ขาดทุนเกินทุน'),
        { formula: 'ส่วนของผู้ถือหุ้น ÷ สินทรัพย์รวม',
          inputs: [{ label: 'รวมส่วนของผู้ถือหุ้น', value: eq }, { label: 'รวมสินทรัพย์', value: ta }],
          result: (er * 100).toFixed(0) + '%', bands: '≥ 40% = ทุนหนา · 0–40% = ทุนบาง · ติดลบ = ขาดทุนเกินทุน', src: 'งบแสดงฐานะการเงิน', std: '≥ 40%',
          scoreBand: { pts: [[-0.2, 5], [0, 20], [0.2, 50], [0.4, 72], [0.6, 92]], value: er, unit: '%' } },
        BS_scoreLinear(er, [[-0.2, 5], [0, 20], [0.2, 50], [0.4, 72], [0.6, 92]])); }
    return R;
  }, [m]);

  // คะแนนฐานะการเงินรวม = ถ่วงน้ำหนักคะแนนอัตราส่วน 5 ตัว (renormalize ถ้าตัวไหนไม่มีคะแนน)
  const overallScore = bsMemo(() => {
    const W = { 'Current Ratio': 0.25, 'Working Capital': 0.15, 'Debt Ratio': 0.25, 'D/E': 0.15, 'Equity Ratio': 0.20 };
    let wsum = 0, acc = 0;
    ratios.forEach(r => {
      if (r.score == null) return;
      const key = Object.keys(W).find(k => r.name.indexOf(k) >= 0);
      const w = key ? W[key] : 0.1;
      wsum += w; acc += r.score * w;
    });
    return wsum ? Math.round(acc / wsum) : null;
  }, [ratios]);

  const heroBtn = { background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 };

  // การ์ด KPI 1 ใบ (ใช้ทั้งใบเดี่ยว "สินทรัพย์" และ 2 ย่อยใน "แหล่งเงินทุน")
  const bsKpiTile = (t) => (
    <div className="bs-kpi-card" style={{ flex: 1, minWidth: 0, background: t.danger ? 'linear-gradient(180deg,#fef2f2 0%,#fff 100%)' : 'white',
      borderRadius: 12, padding: 16, border: '1px solid ' + (t.danger ? '#fecaca' : '#e2e8f0'), boxShadow: '0 1px 3px rgba(15,23,42,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: t.iconBg, display: 'grid', placeItems: 'center' }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={t.iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{t.label} <span style={{ color: '#94a3b8', fontSize: 10.5 }}>· {t.en}</span></div>
      <div style={{ fontSize: 22, fontWeight: 800, color: t.danger ? '#dc2626' : '#0f172a', letterSpacing: '-0.5px', lineHeight: 1.1 }}>{BS_fmt(t.v)}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{bs.curLabel}</div>
    </div>
  );

  return (
    <div className="page bs-page present-page" ref={pageRef}>
      <style>{BS_CSS}</style>

      {/* HERO */}
      <div className="anim-in bs-hero" style={{ background: 'linear-gradient(135deg, #2e8b4a 0%, #154524 100%)',
        borderRadius: 16, padding: '22px 28px', color: 'white', marginBottom: 18, boxShadow: '0 10px 28px rgba(30,58,138,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            <div style={{ width: 60, height: 60, borderRadius: 14, background: 'white', display: 'grid', placeItems: 'center', flexShrink: 0, padding: 9, boxShadow: '0 3px 12px rgba(0,0,0,0.2)' }}>
              <img src="bioaxel_logo.png" alt="BIOAXEL" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 25, fontWeight: 800, letterSpacing: '-0.4px' }}>
                {bs.title}
                {isSeed && <span style={{ marginLeft: 10, fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(252,211,77,0.3)', verticalAlign: 'middle', fontWeight: 600 }}>ข้อมูลตั้งต้น (จากไฟล์เตย)</span>}
              </h1>
              <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>{bs.company} · {bs.titleEn}</div>
              <div style={{ fontSize: 12.5, opacity: 0.82, marginTop: 2 }}>{bs.asOf} · หน่วย: {bs.unit}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} data-no-capture="1">
            <button onClick={saveImage} style={heroBtn}><Icon name="download" size={13} /> บันทึกรูป</button>
            <button onClick={() => window.print()} style={heroBtn}><Icon name="print" size={13} /> พิมพ์ / PDF</button>
            {canEdit && (
              <button onClick={() => setUploadOpen(true)} style={{ ...heroBtn, background: 'rgba(255,255,255,0.95)', color: '#154524', border: '1px solid rgba(255,255,255,0.5)', fontWeight: 600 }}>
                <Icon name="upload" size={13} /> อัปโหลดข้อมูล
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI TILES — สินทรัพย์ (ซ้าย) + การ์ดใหญ่ "แหล่งเงินทุน" ครอบ หนี้สิน+ทุน (ขวา) */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16, alignItems: 'stretch' }}>
        <div style={{ flex: '1 1 240px', display: 'flex' }}>{bsKpiTile(kpiTiles[0])}</div>
        <div style={{ flex: '2 1 400px', background: 'linear-gradient(180deg,#f8fafc,#fff)', borderRadius: 14, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.05)', padding: 14, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>หนี้สินและส่วนของผู้ถือหุ้น</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>· แหล่งเงินทุน = รวมสินทรัพย์ {BS_fmt(m.totalAssets.cur)}</span>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', flex: 1 }}>
            <div style={{ flex: '1 1 190px', display: 'flex' }}>{bsKpiTile(kpiTiles[1])}</div>
            <div style={{ flex: '1 1 190px', display: 'flex' }}>{bsKpiTile(kpiTiles[2])}</div>
          </div>
        </div>
      </div>

      {/* BALANCE CHECK */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, marginBottom: 16,
        background: m.balanced ? '#f0fdf4' : '#fef2f2', border: '1px solid ' + (m.balanced ? '#86efac' : '#fca5a5') }}>
        <span style={{ fontSize: 18 }}>{m.balanced ? '✅' : '⚠️'}</span>
        <div style={{ fontSize: 12.5, color: m.balanced ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
          {m.balanced ? 'งบดุล — สินทรัพย์ = หนี้สิน + ส่วนของผู้ถือหุ้น' : 'งบไม่ดุล — โปรดตรวจข้อมูล'}
          <span style={{ fontWeight: 500, opacity: 0.85 }}>{'  ('}{BS_fmt(m.totalAssets.cur)} = {BS_fmt(m.grand.cur)}{')'}</span>
        </div>
      </div>

      {/* STATEMENT TABLE */}
      <div className="bs-section-head"><h2>งบแสดงฐานะการเงิน</h2><span className="bs-tag">หน่วย: บาท · {bs.curLabel}</span></div>
      <div className="card bs-report-card" ref={reportRef}>
        <div className="bs-report-wrap">
          <table className="bs-report">
            <thead><tr>
              <th className="bs-h-label">รายการ</th>
              <th className="bs-h-num">{bs.curLabel}</th>
            </tr></thead>
            <tbody>{rows.map(renderRow)}</tbody>
          </table>
        </div>
        <div className="bs-modal-note">ที่มา: {bs.source}{bs.updatedAt ? ' · อัปเดต ' + new Date(bs.updatedAt).toLocaleString('th-TH') : ''}</div>
      </div>

      {/* โครงสร้างงบ — โดนัทสินทรัพย์ + แหล่งเงินทุน (แบบ finance-tools) */}
      <div className="bs-section-head" style={{ marginTop: 22 }}>
        <h2>📊 โครงสร้างงบแสดงฐานะการเงิน</h2>
        <span className="bs-tag">{bs.curLabel}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.05)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>โครงสร้างสินทรัพย์</div>
          <Donut size={170} thickness={22} data={bsCharts.assetComp} animate={false} />
        </div>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.05)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>แหล่งเงินทุน (หนี้สิน &amp; ส่วนของผู้ถือหุ้น)</div>
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 12 }}>สัดส่วนต่อสินทรัพย์รวม {BS_fmt(m.totalAssets.cur)} บาท</div>
          {bsCharts.funding.map((x, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12.5, marginBottom: 4 }}>
                <span style={{ color: '#334155' }}>{x.name}{x.value < 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}> (ติดลบ)</span>}</span>
                <span style={{ fontWeight: 700, color: x.value < 0 ? '#dc2626' : '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{BS_fmt(x.value)} บาท</span>
              </div>
              <div style={{ height: 9, borderRadius: 6, background: '#f1f5f9', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: Math.max(2, Math.abs(x.pct) * 100) + '%', background: x.color, borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PARETO — โครงสร้างสินทรัพย์ + โครงสร้างหนี้สิน (เรียงมาก→น้อย · แสดง 3 อันดับแรก · กดดูที่เหลือ) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginTop: 14 }}>
        <ParetoBreakdown title="โครงสร้างสินทรัพย์" titleEn="Asset Breakdown" sub="สัดส่วนต่อสินทรัพย์รวม · เรียงมาก→น้อย · แสดง 3 อันดับแรก · กดดูที่เหลือ"
          items={bsCharts.assetLines} palette={['#3b82f6', '#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#14b8a6']} />
        <ParetoBreakdown title="โครงสร้างหนี้สิน" titleEn="Liabilities Breakdown" sub="สัดส่วนต่อหนี้สินรวม · เรียงมาก→น้อย · แสดง 3 อันดับแรก · กดดูที่เหลือ"
          items={bsCharts.liabLines} palette={['#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#3b82f6', '#14b8a6']} />
      </div>

      {/* RATIOS — เลย์เอาต์รายการแบบ finance-tools (คลิกกางดูสูตร + ที่มา) */}
      <div className="bs-section-head" style={{ marginTop: 22 }}>
        <h2>📊 อัตราส่วนทางการเงิน</h2>
        <span className="bs-tag">🖱️ คลิกดูสูตร + เกณฑ์คะแนน · {bs.curLabel}</span>
      </div>
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.05)', padding: 16, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        {overallScore != null && <div style={{ flex: '0 0 auto', width: 196 }}><BSGauge score={overallScore} /></div>}
        <div style={{ flex: '1 1 440px', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>อัตราส่วนรายตัว <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>🖱️ คลิกดูสูตร + เกณฑ์คะแนน</span></div>
          <div style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 8px' }}>คำนวณจากงบแสดงฐานะการเงิน {bs.asOf} · ให้คะแนน <b style={{ color: '#475569' }}>0–100</b> (เขียว ≥ 70 · เหลือง ≥ 45 · แดง &lt; 45) · คะแนนรวม = ถ่วงน้ำหนัก (สภาพคล่อง 25% · หนี้/สินทรัพย์ 25% · ทุน 20% · เงินทุนหมุนเวียน 15% · D/E 15%)</div>
          {ratios.map((r, i) => <BSRatioRow key={i} r={r} last={i === ratios.length - 1} />)}
        </div>
      </div>

      {/* วิเคราะห์ฐานะการเงิน (Auto Generated) — พอร์ตจาก finBalInsight */}
      <BSInsight m={m} bs={bs} />

      {/* UPLOAD MODAL */}
      <Modal open={uploadOpen} onClose={() => { setUploadOpen(false); setFile(null); }} wide title="อัปโหลดงบแสดงฐานะการเงิน">
        <div style={{ padding: '8px 20px 18px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginBottom: 12 }}>
            นำเข้าไฟล์ Excel งบการเงิน — ระบบอ่าน <b>ชีต “งบฐานะการเงิน(รวม)”</b> (2 คอลัมน์ปี พ.ศ.) แล้วแทนที่งบทั้งชุด · ข้อมูลนี้ sync ให้ทั้งทีมเห็นตรงกัน
          </div>
          <div className="bs-upload-row" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
            <div className={'bs-dropzone' + (drag ? ' drag' : '') + (file ? ' has-file' : '')}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
              onDrop={onDrop}>
              <div className="bs-dz-ic"><Icon name="upload" size={22} /></div>
              <div className="bs-dz-main">{file ? <>เลือกไฟล์แล้ว: <u>{file.name}</u></> : <>ลากไฟล์มาวางที่นี่ หรือ <u>เลือกไฟล์</u></>}</div>
              <div className="bs-dz-sub">{file ? (file.size / 1024 / 1024).toFixed(2) + ' MB · พร้อมนำเข้า' : 'รองรับ .xlsx (ไฟล์งบการเงิน) ขนาดไม่เกิน 10 MB'}</div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => pickFile(e.target.files[0])} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ background: 'var(--ink-50, #f8fafc)', borderRadius: 8, padding: '10px 12px' }}>
                <span style={{ fontWeight: 600, color: 'var(--ink-600, #475569)', fontSize: 12.5 }}>วิธีนำเข้า</span>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500, #64748b)', lineHeight: 1.7, marginTop: 4 }}>
                  • อ่านชีต <b>“งบฐานะการเงิน(รวม)”</b> อัตโนมัติ<br />
                  • ปี/วันที่ อ่านจากหัวคอลัมน์ในไฟล์<br />
                  • ระบบ<b>ตรวจงบดุล</b>ก่อนบันทึก (สินทรัพย์ = หนี้สิน+ทุน)
                </div>
              </div>
              <button className="btn btn-primary" disabled={busy || !file} onClick={handleImport}>
                <Icon name="check" size={14} /> {busy ? 'กำลังประมวลผล…' : 'ตรวจสอบและนำเข้า'}
              </button>
              {!isSeed && <button className="btn btn-ghost" onClick={resetToSeed} disabled={busy}>คืนค่าตั้งต้น (ไฟล์เตย)</button>}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── CSS (inject ครั้งเดียวผ่าน <style> ในหน้า) ──
const BS_CSS = `
.bs-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px}
.bs-section-head h2{margin:0;font-size:16px;font-weight:800;color:#0f172a;letter-spacing:-0.3px}
.bs-tag{font-size:11.5px;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:3px 9px;white-space:nowrap}
.bs-report-card{padding:0;overflow:hidden}
.bs-report-wrap{overflow-x:auto}
.bs-report{width:100%;border-collapse:collapse;font-size:13px}
.bs-report thead th{position:sticky;top:0;background:#f8fafc;border-bottom:2px solid #e2e8f0;padding:10px 14px;font-weight:700;color:#334155;text-align:right;white-space:nowrap;z-index:1}
.bs-report thead th.bs-h-label{text-align:left}
.bs-h-yr{display:block;font-size:10.5px;font-weight:600;color:#94a3b8;margin-top:1px}
.bs-report td{padding:7px 14px;border-bottom:1px solid #f1f5f9;vertical-align:top}
.bs-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.bs-neg{color:#dc2626}
.bs-memo{color:#94a3b8}
.bs-label{color:#1e293b;padding-left:26px!important}
.bs-sub{display:block;font-size:10.5px;color:#94a3b8;margin-top:1px}
.bs-memo-tag{margin-left:7px;font-size:9.5px;font-weight:600;color:#b45309;background:#fef3c7;border:1px solid #fde68a;border-radius:5px;padding:0 6px;vertical-align:middle}
.bs-chg{color:#64748b;font-size:12px}
.bs-chg-pct{display:block;font-size:10px;color:#94a3b8;margin-top:1px}
.bs-r-section td{background:#eef7f1;border-top:2px solid #cfe8d8;border-bottom:1px solid #cfe8d8;padding-top:9px;padding-bottom:9px}
.bs-sec-th{font-size:14px;font-weight:800;color:#154524}
.bs-sec-en{font-size:11px;font-weight:600;color:#5f8f72;margin-left:8px}
.bs-r-group td{background:#fbfdfc;font-weight:700;color:#334155;padding-left:14px!important}
.bs-grp-en{font-weight:500;color:#94a3b8;font-size:11px}
.bs-r-line:hover{background:#f8fafc}
.bs-r-subtotal td{font-weight:700;color:#0f172a;background:#f8fafc;border-top:1px solid #e2e8f0}
.bs-r-subtotal .bs-label{padding-left:14px!important}
.bs-r-total td{font-weight:800;color:#0f172a;background:#f1f5f9;border-top:1.5px solid #cbd5e1;border-bottom:1.5px solid #cbd5e1}
.bs-r-total .bs-label{padding-left:14px!important}
.bs-r-grand td{font-weight:800;color:#154524;background:#eef7f1;border-top:2px solid #2e8b4a;border-bottom:2.5px double #2e8b4a;padding-top:9px;padding-bottom:9px}
.bs-r-grand .bs-label{padding-left:14px!important}
.bs-modal-note{padding:8px 16px 14px;font-size:11px;color:#94a3b8}
.bs-dropzone{border:2px dashed #cbd5e1;border-radius:12px;padding:22px 16px;text-align:center;cursor:pointer;transition:all .15s;background:#fafcff}
.bs-dropzone.drag{border-color:#2e8b4a;background:#f0fdf4}
.bs-dropzone.has-file{border-color:#2e8b4a;border-style:solid;background:#f0fdf4}
.bs-dz-ic{color:#2e8b4a;margin-bottom:6px}
.bs-dz-main{font-size:13px;color:#334155;font-weight:600}
.bs-dz-sub{font-size:11px;color:#94a3b8;margin-top:3px}
@media (max-width:720px){.bs-upload-row{grid-template-columns:1fr!important}}
@media print{.bs-hero [data-no-capture]{display:none}}
`;

window.BalanceSheetPage = BalanceSheetPage;
