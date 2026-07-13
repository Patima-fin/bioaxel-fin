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

// ── การ์ดอัตราส่วนแบบย่อ (คลิก "ดูรายละเอียด" เพื่อกางกล่องแหล่งที่มา/สูตร/อ้างอิง) ──
function BSRatioCard({ r }) {
  const [open, setOpen] = bsState(false);
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 13, border: '1px solid #e2e8f0', borderTop: '3px solid ' + r.st.a, boxShadow: '0 1px 3px rgba(15,23,42,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: r.st.bg, display: 'grid', placeItems: 'center', fontSize: 15, flexShrink: 0 }}>{r.icon}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>{r.label}</div>
            <div style={{ fontSize: 9.5, color: '#94a3b8' }}>{r.en}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 21, fontWeight: 800, color: r.st.a, letterSpacing: '-0.5px', lineHeight: 1 }}>{r.display}</div>
          <span style={{ display: 'inline-flex', alignItems: 'center', background: r.st.bg, color: r.st.a, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12 }}>{r.st.t}</span>
        </div>
      </div>
      <button onClick={() => setOpen(o => !o)} style={{ alignSelf: 'flex-start', background: 'none', border: 0, cursor: 'pointer', color: '#64748b', fontSize: 10.5, fontWeight: 600, padding: 0 }}>
        {open ? 'ซ่อนรายละเอียด ▴' : 'ดูรายละเอียด · แหล่งที่มา ▾'}
      </button>
      {open && (
        <div style={{ background: '#f8fafc', border: '1px solid #eef2f6', borderRadius: 8, padding: '9px 11px' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.7px', marginBottom: 4 }}>แหล่งที่มา · การคำนวณ</div>
          <div style={{ fontSize: 11.5, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-line', fontVariantNumeric: 'tabular-nums' }}>{r.formula}</div>
          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e2e8f0', display: 'flex', gap: 5 }}>
            <span style={{ flexShrink: 0 }}>📄</span><span>{r.src}</span>
          </div>
          {r.bench && (
            <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 5, display: 'flex', gap: 5 }}>
              <span style={{ flexShrink: 0 }}>📏</span><span>เกณฑ์ปกติ: {r.bench}</span>
            </div>
          )}
          {r.ref && (
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, display: 'flex', gap: 5 }}>
              <span style={{ flexShrink: 0 }}>📚</span>
              {r.refUrl
                ? <a href={r.refUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>อ้างอิง: {r.ref} ↗</a>
                : <span>อ้างอิง: {r.ref}</span>}
            </div>
          )}
        </div>
      )}
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

  // ── อัตราส่วน (พร้อมแหล่งที่มา) — สไตล์เดียวกับ KPI หน้า P&L ──
  const ratios = [
    (() => { const v = m.curRatio, ok = v >= 1; return {
      icon: '💧', label: 'อัตราส่วนสภาพคล่อง', en: 'Current Ratio',
      display: isNaN(v) ? '—' : v.toFixed(2) + ' เท่า',
      st: isNaN(v) ? { t: 'ไม่มีข้อมูล', a: '#64748b', bg: '#f1f5f9' } : (ok ? { t: 'แข็งแรง', a: '#16a34a', bg: '#dcfce7' } : (v >= 0.5 ? { t: 'ตึงตัว', a: '#d97706', bg: '#fef3c7' } : { t: 'เสี่ยงสภาพคล่อง', a: '#dc2626', bg: '#fee2e2' })),
      formula: 'สินทรัพย์หมุนเวียน ' + BS_fmt(m.curAssets.cur) + '\n÷ หนี้สินหมุนเวียน ' + BS_fmt(m.curLiab.cur),
      src: 'บรรทัด “รวมสินทรัพย์หมุนเวียน” ÷ “รวมหนี้สินหมุนเวียน”',
      bench: 'ทั่วไป 1.5–2.0 เท่า · < 1.0 = เสี่ยงสภาพคล่อง', ref: 'เกณฑ์สภาพคล่อง (Farseer 2026)',
      refUrl: 'https://www.farseer.com/blog/balance-sheet-ratios/' }; })(),
    (() => { const v = m.debtToAssets, ok = v <= 100; return {
      icon: '⚖️', label: 'หนี้สินต่อสินทรัพย์', en: 'Debt to Assets',
      display: BS_fmtPct(v),
      st: isNaN(v) ? { t: 'ไม่มีข้อมูล', a: '#64748b', bg: '#f1f5f9' } : (v > 100 ? { t: 'หนี้เกินสินทรัพย์', a: '#dc2626', bg: '#fee2e2' } : (v > 70 ? { t: 'สูง', a: '#d97706', bg: '#fef3c7' } : { t: 'คุมได้', a: '#16a34a', bg: '#dcfce7' })),
      formula: 'รวมหนี้สิน ' + BS_fmt(m.totalLiab.cur) + '\n÷ รวมสินทรัพย์ ' + BS_fmt(m.totalAssets.cur),
      src: 'บรรทัด “รวมหนี้สิน” ÷ “รวมสินทรัพย์”',
      bench: 'ยิ่งต่ำยิ่งดี · > 100% = หนี้เกินสินทรัพย์', ref: 'อัตราส่วนหนี้สิน/leverage (Farseer 2026)',
      refUrl: 'https://www.farseer.com/blog/balance-sheet-ratios/' }; })(),
    (() => { const eq = m.equity.cur || 0, neg = eq < 0; return {
      icon: '🏛️', label: 'ส่วนของผู้ถือหุ้น', en: 'Shareholders’ Equity',
      display: BS_fmt(eq),
      st: neg ? { t: 'ขาดทุนเกินทุน', a: '#dc2626', bg: '#fee2e2' } : { t: 'เป็นบวก', a: '#16a34a', bg: '#dcfce7' },
      formula: 'ทุนที่เรียกชำระ ' + BS_fmt(BS_find(rows, /^ทุนที่ออกและเรียกชำระ/).cur) + '\n+ ขาดทุนสะสม ' + BS_fmt(BS_find(rows, /ขาดทุนสะสม/).cur),
      src: 'บรรทัด “รวมส่วนของผู้ถือหุ้น” · ทุนชำระแล้ว + ขาดทุนสะสม',
      bench: 'บวก = ทุนไม่ติดลบ · ติดลบ = ขาดทุนเกินทุน (equity ต่ำกว่าศูนย์)', ref: 'งบแสดงฐานะการเงิน (นิยามมาตรฐาน)' }; })(),
    (() => { const eq = m.equity.cur || 0, na = eq <= 0; const v = m.de; return {
      icon: '🔗', label: 'หนี้สินต่อทุน (D/E)', en: 'Debt to Equity',
      display: na ? 'N/M' : (isNaN(v) ? '—' : v.toFixed(2) + ' เท่า'),
      st: na ? { t: 'ทุนติดลบ — ตีความไม่ได้', a: '#dc2626', bg: '#fee2e2' } : (v <= 2 ? { t: 'คุมได้', a: '#16a34a', bg: '#dcfce7' } : { t: 'สูง', a: '#d97706', bg: '#fef3c7' }),
      formula: 'รวมหนี้สิน ' + BS_fmt(m.totalLiab.cur) + '\n÷ ส่วนของผู้ถือหุ้น ' + BS_fmt(eq),
      src: 'บรรทัด “รวมหนี้สิน” ÷ “รวมส่วนของผู้ถือหุ้น” · ทุนติดลบ ⇒ ตีความไม่ได้ (N/M)',
      bench: 'ทั่วไป 1.0–2.0 เท่า · < 1.0 = ทุน > หนี้ · ทุนเข้มข้น 2.0–3.0', ref: 'เกณฑ์ D/E (Business Supervisor 2026)',
      refUrl: 'https://www.businesssupervisor.com/what-is-a-good-debt-to-equity-ratio/' }; })(),
  ];

  const heroBtn = { background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 };

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

      {/* KPI TILES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 16 }}>
        {kpiTiles.map((t, i) => {
          return (
            <div key={i} className="bs-kpi-card" style={{ background: t.danger ? 'linear-gradient(180deg,#fef2f2 0%,#fff 100%)' : 'white',
              borderRadius: 12, padding: 18, border: '1px solid ' + (t.danger ? '#fecaca' : '#e2e8f0'), boxShadow: '0 1px 3px rgba(15,23,42,0.05)', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: t.iconBg, display: 'grid', placeItems: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{t.label} <span style={{ color: '#94a3b8', fontSize: 10.5 }}>· {t.en}</span></div>
              <div style={{ fontSize: 23, fontWeight: 800, color: t.danger ? '#dc2626' : '#0f172a', letterSpacing: '-0.5px', lineHeight: 1.1 }}>{BS_fmt(t.v)}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{bs.curLabel}</div>
            </div>
          );
        })}
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

      {/* RATIOS WITH SOURCES */}
      <div className="bs-section-head" style={{ marginTop: 22 }}>
        <h2>📊 อัตราส่วนทางการเงิน (จากงบฐานะการเงิน)</h2>
        <span className="bs-tag">ทุกตัวมีแหล่งที่มา · {bs.curLabel}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {ratios.map((r, i) => <BSRatioCard key={i} r={r} />)}
      </div>

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
