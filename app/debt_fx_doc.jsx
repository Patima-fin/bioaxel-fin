/* debt_fx_doc.jsx — เอกสารประกอบเงินกู้ต่างประเทศ (ให้ฝ่ายบัญชีใช้ทำเอกสารประกอบงบ)
   รูปแบบเดียวกับไฟล์ "เอกสารประกอบ ดอกเบี้ย ตปท..xlsx" ของทีมการเงิน (ตัวอย่าง ZICO):
     ประเภท (กู้ยืม/คืน) · สัญญาที่ · วันที่ · จำนวนเงินกู้ตามสัญญา (สกุลต่างประเทศ) · ค่าธรรมเนียม (สกุลต่างประเทศ)
     · อัตราแลกเปลี่ยน · จำนวนเงินตามสัญญา (บาท) = D×F · อัตราแลกเปลี่ยนตอนจ่ายคืน
     · จำนวนเงินได้รับจริง (สกุลต่างประเทศ) = D−E (กู้ยืม) · ค่าธรรมเนียมโอน (บาท)
     · เงินเข้า/ออก BANK (บาท) = I×F−J (กู้ยืม) | I×H (คืน)
   แยก 1 แท็บ/1 ชีทต่อ "ประเภท" (หมวดหนี้ที่เป็นสกุลต่างประเทศ เช่น Zigo = USD, Incofin = EUR)

   ⚠️ ข้อมูลอัตราแลกเปลี่ยน/ค่าธรรมเนียม/วันคืนจริง ไม่มีในตารางหนี้ (ตาราง Postgres คอลัมน์ตายตัว) →
      เก็บเป็น JSON array ก้อนเดียวต่อหมวดใน WTPOverride คีย์ `fxdoc.<หมวด>` (sync ทั้งทีม ไม่ต้อง migration)
      ห้ามแตะ debtMaster/debtEvents จากหน้านี้ — "⤵ ดึงจากระบบ" แค่ "อ่าน" สัญญา/เหตุการณ์มาเป็นแถวตั้งต้น
      (กันซ้ำด้วย row.src = 'start:<masterId>' | 'ev:<eventId>')
   identifier prefix: fxd / Fxd */
'use strict';

const FXD_KEY = (cat) => 'fxdoc.' + cat;
const FXD_TYPES = { loan: 'กู้ยืม', repay: 'คืน' };

function fxdNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return isFinite(n) ? n : null;
}
function fxdLoad(cat) {
  try {
    const raw = WTPOverride.get(FXD_KEY(cat));
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
// คำนวณคอลัมน์ตามสูตรในไฟล์ตัวอย่าง — ยอดฝั่ง "คืน" เป็นค่าลบ
function fxdCalc(r) {
  const sign = r.type === 'repay' ? -1 : 1;
  const D = sign * (fxdNum(r.amt) || 0);
  const E = fxdNum(r.fee) || 0;
  const F = fxdNum(r.rate) || 0;
  const H = fxdNum(r.rateBack) || 0;
  const J = fxdNum(r.feeThb) || 0;
  const G = D * F;
  const actualSet = fxdNum(r.actual) != null;
  const I = actualSet ? sign * Math.abs(fxdNum(r.actual)) : (r.type === 'repay' ? D : D - E);
  const K = r.type === 'repay' ? I * H : I * F - J;
  return { D, E, F, G, H, I, J, K, actualSet };
}
const fxdSortRows = (rows) => rows.slice().sort((a, b) =>
  String(a.date || '').localeCompare(String(b.date || '')) || (a.type === b.type ? 0 : a.type === 'loan' ? -1 : 1));
function fxdSeqOf(contractNo) {
  const m = String(contractNo || '').match(/-(\d{1,3})(?:\.|$|\s|-)/);
  return m ? String(Number(m[1])) : String(contractNo || '');
}
function fxdForeignCats(masters) {
  const out = {};
  (masters || []).forEach(m => {
    const c = typeof dlCur === 'function' ? dlCur(m) : String(m.currency || 'THB').toUpperCase();
    if (c !== 'THB' && m.debtCategory) out[m.debtCategory] = out[m.debtCategory] || c;
  });
  return out;   // { Zigo: 'USD', Incofin: 'EUR' }
}
// แถวตั้งต้นจากระบบ: วันเริ่มสัญญา (กู้ยืม) + เบิกเพิ่ม (กู้ยืม) + คืนเงินต้น (คืน)
function fxdFromSystem(cat, masters, eventsByContract) {
  const out = [];
  (masters || []).filter(m => m.debtCategory === cat).forEach(m => {
    const no = fxdSeqOf(m.contractNo);
    const start = (typeof debtStartOf === 'function' ? debtStartOf(m) : m.startDate) || m.startDate || '';
    if (start && Number(m.principalAmount)) {
      out.push({ id: WTPData.newId(), src: 'start:' + m.id, type: 'loan', no, date: start, amt: Number(m.principalAmount), note: m.contractNo });
    }
    (eventsByContract[m.contractNo] || []).forEach(e => {
      if (!e.eventDate || !Number(e.amount)) return;
      out.push({ id: WTPData.newId(), src: 'ev:' + e.id, type: e.eventType === 'repayment' ? 'repay' : 'loan', no, date: e.eventDate, amt: Number(e.amount), note: m.contractNo });
    });
  });
  return out;
}
// Excel serial / Date / "m/d/yy" / ISO → ISO
function fxdISO(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && typeof XLSX !== 'undefined') {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : '';
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; if (y > 2400) y -= 543; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return '';
}
// อ่านไฟล์รูปแบบเดียวกับตัวอย่าง: หาแถวหัวที่มี "ประเภท" + "สัญญา" แล้วอ่านคอลัมน์ A–K ตามตำแหน่งหัว
function fxdParseSheet(aoa) {
  const hr = aoa.findIndex(r => (r || []).some(c => /^ประเภท$/.test(String(c).trim())) && (r || []).some(c => /สัญญา/.test(String(c))));
  if (hr < 0) return null;
  const head = aoa[hr].map(c => String(c || '').replace(/\s+/g, ' ').trim());
  const col = (re, from) => head.findIndex((h, i) => i >= (from || 0) && re.test(h));
  const cT = col(/^ประเภท$/), cN = col(/สัญญา/), cD = col(/^วันที่$/);
  const cAmt = col(/จำนวนเงินกู้ ?ตามสัญญา/), cFee = col(/^ค่าธรรมเนียม \(/);
  const cRate = col(/^อัตรา แลกเปลี่ยน$/), cBack = col(/ตอนจ่ายคืน/);
  const cAct = col(/ได้รับจริง/), cFeeT = col(/ค่าธรรมเนียม โอนเข้า/);
  if ([cT, cN, cD, cAmt].some(i => i < 0)) return null;
  const rows = [];
  for (let r = hr + 1; r < aoa.length; r++) {
    const x = aoa[r] || [];
    const t = String(x[cT] || '').trim();
    const type = /คืน/.test(t) ? 'repay' : /กู้/.test(t) ? 'loan' : null;
    if (!type) continue;
    const amt = Math.abs(fxdNum(x[cAmt]) || 0);
    const rate = cRate >= 0 ? fxdNum(x[cRate]) : null;
    const act = cAct >= 0 ? fxdNum(x[cAct]) : null;
    const fee = cFee >= 0 ? fxdNum(x[cFee]) : null;
    const row = { id: WTPData.newId(), type, no: String(x[cN] == null ? '' : x[cN]).trim(), date: fxdISO(x[cD]), amt,
      fee: fee || null, rate: rate || null, rateBack: cBack >= 0 ? (fxdNum(x[cBack]) || null) : null,
      feeThb: cFeeT >= 0 ? (fxdNum(x[cFeeT]) || null) : null, actual: null };
    // เก็บยอดได้รับจริงเฉพาะเมื่อไม่เท่ากับค่าที่สูตรให้ (กู้ยืม = D−E · คืน = D)
    if (act != null) {
      const def = type === 'repay' ? amt : amt - (fee || 0);
      if (Math.abs(Math.abs(act) - def) > 0.005) row.actual = Math.abs(act);
    }
    rows.push(row);
  }
  return rows;
}

// ISO → Excel serial (ไม่ใช้ Date object — กันเพี้ยนจาก timezone)
function fxdSerial(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000 : '';
}
// ── Excel: 1 ชีท/ประเภท หน้าตาแบบไฟล์ตัวอย่าง (มีสูตร + สรุปตามประเภท/วันที่ทางขวา) ──
function fxdBuildSheet(cat, cur, rows) {
  const sorted = fxdSortRows(rows);
  const aoa = [[`รายละเอียดประกอบ -นักลงทุนต่างประเทศ (${cat} · ${cur})`], [
    'ประเภท', 'สัญญาที่', 'วันที่', `จำนวนเงินกู้\nตามสัญญา (${cur})`, `ค่าธรรมเนียม\n(${cur})`, 'อัตรา\nแลกเปลี่ยน',
    'จำนวนเงิน\nที่ต้องได้รับตามสัญญา (บาท)', 'อัตรา\nแลกเปลี่ยน - ตอนจ่ายคืน', `จำนวนเงินกู้\nได้รับจริง (${cur})`,
    'ค่าธรรมเนียม\nโอนเข้า (บาท)', 'เงินได้รับเข้า\nBANK (บาท)', 'หมายเหตุ']];
  const calcs = sorted.map(fxdCalc);
  sorted.forEach((r, i) => {
    const c = calcs[i];
    aoa.push([FXD_TYPES[r.type], /^\d+$/.test(r.no) ? Number(r.no) : r.no, fxdSerial(r.date),
      c.D, c.E || '', c.F || '', c.G, c.H || '', c.I, c.J || '', c.K, r.note || '']);
  });
  const first = 2, last = 2 + sorted.length - 1;   // 0-based
  aoa.push([]);
  const totR = aoa.length;
  aoa.push(['รวม', '', '', calcs.reduce((s, c) => s + c.D, 0), '', '', calcs.reduce((s, c) => s + c.G, 0), '',
    calcs.reduce((s, c) => s + c.I, 0), calcs.reduce((s, c) => s + c.J, 0), calcs.reduce((s, c) => s + c.K, 0)]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const A = (r, c) => XLSX.utils.encode_cell({ r, c });
  // สูตรแบบไฟล์ตัวอย่าง (แก้อัตราใน Excel แล้วคำนวณต่อได้)
  for (let r = first; r <= last; r++) {
    const x = sorted[r - first], c = calcs[r - first], n = r + 1;
    ws[A(r, 6)].f = `+D${n}*F${n}`;
    if (!c.actualSet && x.type === 'loan') ws[A(r, 8)].f = `+D${n}-E${n}`;
    ws[A(r, 10)].f = x.type === 'repay' ? `+I${n}*H${n}` : `+(I${n}*F${n})-J${n}`;
    if (ws[A(r, 2)] && ws[A(r, 2)].t === 'n') ws[A(r, 2)].z = 'd/m/yyyy';
  }
  if (sorted.length) [3, 6, 8, 9, 10].forEach(c => { const L = XLSX.utils.encode_col(c); ws[A(totR, c)].f = `SUM(${L}${first + 1}:${L}${last + 1})`; });
  // สรุปตามประเภท › วันที่ (แบบ pivot ในไฟล์ตัวอย่าง)
  const pv = [['ประเภท / วันที่', `รวม เงินกู้ (${cur})`, 'รวม จำนวนเงิน (บาท)', 'รวม เงินเข้า BANK (บาท)']];
  const pvKinds = ['head'];
  ['loan', 'repay'].forEach(t => {
    const rs = sorted.map((r, i) => [r, calcs[i]]).filter(([r]) => r.type === t);
    if (!rs.length) return;
    pv.push([FXD_TYPES[t], rs.reduce((s, [, c]) => s + c.D, 0), rs.reduce((s, [, c]) => s + c.G, 0), rs.reduce((s, [, c]) => s + c.K, 0)]); pvKinds.push('grp');
    const byD = {};
    rs.forEach(([r, c]) => { const k = r.date || '—'; const o = byD[k] || (byD[k] = [0, 0, 0]); o[0] += c.D; o[1] += c.G; o[2] += c.K; });
    Object.keys(byD).sort().forEach(k => { pv.push([k === '—' ? '—' : fmtDate(k), ...byD[k]]); pvKinds.push('row'); });
  });
  pv.push(['ผลรวมทั้งหมด', calcs.reduce((s, c) => s + c.D, 0), calcs.reduce((s, c) => s + c.G, 0), calcs.reduce((s, c) => s + c.K, 0)]); pvKinds.push('tot');
  XLSX.utils.sheet_add_aoa(ws, pv, { origin: { r: 1, c: 13 } });

  ws['!cols'] = [8, 8, 11, 15, 12, 11, 17, 13, 15, 13, 17, 26, 2, 16, 16, 18, 18].map(w => ({ wch: w }));
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
  ws['!rows'] = [{ hpt: 24 }, { hpt: 44 }];
  xlRow(ws, 0, 0, 11, XL.title);
  xlRow(ws, 1, 0, 11, XL.th);
  if (last >= first) xlBody(ws, first, last, 0, 11);
  for (let r = first; r <= last; r++) {
    [0, 1, 2].forEach(c => xlSet(ws, r, c, XL.ctr));
    if (sorted[r - first].type === 'repay') xlSet(ws, r, 0, { font: { color: { rgb: 'C0392B' } } });
  }
  applyColFmt(ws, { 3: FMT_NEG, 4: FMT_NEG, 5: '0.0000', 6: FMT_NEG, 7: '0.0000', 8: FMT_NEG, 9: FMT_NEG, 10: FMT_NEG }, first, totR);
  xlRow(ws, totR, 0, 11, XL.totVal); xlSet(ws, totR, 0, XL.totLabel);
  pvKinds.forEach((k, i) => {
    const r = 1 + i;
    if (k === 'head') xlRow(ws, r, 13, 16, XL.th);
    else if (k === 'grp') { xlRow(ws, r, 13, 16, XL.infoLbl); }
    else if (k === 'tot') { xlRow(ws, r, 13, 16, XL.totVal); }
    else xlRow(ws, r, 13, 16, XL.cell);
    if (k !== 'head') applyColFmt(ws, { 14: FMT_NEG, 15: FMT_NEG, 16: FMT_NEG }, r, r);
  });
  return ws;
}
function fxdExportWorkbook(cats /* [{cat,cur,rows}] */) {
  if (typeof XLSX === 'undefined') { alert('SheetJS ยังไม่โหลด'); return; }
  const wb = XLSX.utils.book_new();
  cats.forEach(({ cat, cur, rows }) => {
    XLSX.utils.book_append_sheet(wb, fxdBuildSheet(cat, cur, rows), String(cat).replace(/[\\\/\?\*\[\]\:]/g, '_').slice(0, 31));
  });
  const tag = cats.length === 1 ? cats[0].cat : 'ทุกประเภท';
  XLSX.writeFile(wb, `เอกสารประกอบ เงินกู้ต่างประเทศ ${tag} ${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Enter = ไปช่องกรอกถัดไป (ซ้าย→ขวา แล้วขึ้นแถวใหม่) · Shift+Enter = ย้อนกลับ
//   ไล่เฉพาะ <input data-fxd> ในตารางเดียวกัน (ช่องคำนวณ/ปุ่ม/ดรอปดาวน์ประเภทไม่นับ)
function fxdEnterNav(e) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
  e.preventDefault();
  const table = e.target.closest('table');
  const list = table ? [...table.querySelectorAll('input[data-fxd]')].filter(el => !el.disabled && el.offsetParent !== null) : [];
  const i = list.indexOf(e.target);
  const next = list[i + (e.shiftKey ? -1 : 1)];
  if (next) { next.focus(); try { next.select(); } catch (_) {} } else e.target.blur();
}

function FxdCellInput({ value, onChange, width, type, align }) {
  return (
    <input className="input" data-fxd="1" type={type || 'text'} value={value == null ? '' : value}
      onChange={e => onChange(e.target.value)} onKeyDown={fxdEnterNav}
      style={{ width: width || 90, padding: '3px 6px', fontSize: 12, textAlign: align || 'right', fontVariantNumeric: 'tabular-nums' }} />
  );
}

// ช่องกรอกตัวเลขแบบมีคอมมา (type=text + inputMode=decimal — number input ใส่คอมมาไม่ได้)
//   โฟกัส = เลขดิบให้แก้ง่าย · ออกจากช่อง/Enter = จัดรูป #,##0.00 (อัตราแลกเปลี่ยน 4 ตำแหน่ง)
function fxdFmtInput(v, dec) {
  const n = fxdNum(v);
  return n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: Math.max(dec, 6) });
}
function FxdNumInput({ value, onChange, width, dec }) {
  const d = dec == null ? 2 : dec;
  const [focus, setFocus] = React.useState(false);
  const [text, setText] = React.useState('');
  const shown = focus ? text : fxdFmtInput(value, d);
  return (
    <input className="input" data-fxd="1" type="text" inputMode="decimal" value={shown}
      onFocus={e => { const n = fxdNum(value); setText(n == null ? '' : String(n)); setFocus(true); setTimeout(() => { try { e.target.select(); } catch (_) {} }, 0); }}
      onChange={e => { const t = e.target.value.replace(/[^\d.,\-]/g, ''); setText(t); onChange(t.replace(/,/g, '')); }}
      onBlur={() => setFocus(false)}
      onKeyDown={fxdEnterNav}
      style={{ width: width || 90, padding: '3px 6px', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
  );
}

function ForeignLoanDocModal({ open, masters, eventsByContract, canEdit, onClose, toast }) {
  useOverrideSubAny();
  const catMap = React.useMemo(() => fxdForeignCats(masters), [masters]);
  const cats = Object.keys(catMap).sort();
  const [cat, setCat] = React.useState(null);
  const cur = cat && cats.includes(cat) ? cat : cats[0];
  const saved = cur ? fxdLoad(cur) : [];
  const [draft, setDraft] = React.useState(null);        // null = ยังไม่แก้ (แสดงของที่บันทึกไว้)
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef(null);
  React.useEffect(() => { setDraft(null); }, [cur, open]);
  if (!open) return null;
  const rows = fxdSortRows(draft || saved);
  const dirty = !!draft;
  const ccy = catMap[cur] || '';
  const calcs = rows.map(fxdCalc);
  const sum = (f) => calcs.reduce((s, c) => s + c[f], 0);
  const loanD = calcs.filter((c, i) => rows[i].type === 'loan').reduce((s, c) => s + c.D, 0);
  const repayD = calcs.filter((c, i) => rows[i].type === 'repay').reduce((s, c) => s + c.D, 0);
  const missRate = rows.filter(r => !(fxdNum(r.rate) > 0) && fxdNum(r.amt) > 0).length;

  const edit = (id, patch) => setDraft(ds => (ds || saved).map(r => r.id === id ? { ...r, ...patch } : r));
  const del = (id) => setDraft(ds => (ds || saved).filter(r => r.id !== id));
  const add = () => setDraft(ds => [...(ds || saved), { id: WTPData.newId(), type: 'loan', no: '', date: new Date().toISOString().slice(0, 10), amt: 0 }]);
  const pullSystem = () => {
    const base = draft || saved;
    const have = new Set(base.map(r => r.src).filter(Boolean));
    const fresh = fxdFromSystem(cur, masters, eventsByContract).filter(r => !have.has(r.src));
    if (!fresh.length) { toast && toast('ไม่มีรายการใหม่จากระบบ (ดึงครบแล้ว)'); return; }
    setDraft([...base, ...fresh]);
    toast && toast(`ดึงจากระบบ ${fresh.length} รายการ — ใส่อัตราแลกเปลี่ยนแล้วกดบันทึก`);
  };
  const save = () => {
    if (!draft) return;
    const clean = draft.map(r => {
      const o = { ...r };
      ['amt', 'fee', 'rate', 'rateBack', 'feeThb', 'actual'].forEach(k => { const n = fxdNum(o[k]); o[k] = n == null ? null : Math.abs(n); });
      return o;
    });
    WTPOverride.setRaw(FXD_KEY(cur), JSON.stringify(clean));
    setDraft(null);
    toast && toast(`บันทึกเอกสารประกอบ ${cur} แล้ว (${clean.length} รายการ)`);
  };
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
      let parsed = null, sheet = '';
      for (const n of wb.SheetNames) {
        const p = fxdParseSheet(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
        if (p && p.length) { parsed = p; sheet = n; break; }
      }
      if (!parsed) { alert('ไม่พบตารางรูปแบบ "ประเภท / สัญญาที่ / วันที่ / จำนวนเงินกู้ตามสัญญา" ในไฟล์นี้'); return; }
      const base = draft || saved;
      if (base.length && !window.confirm(`นำเข้า ${parsed.length} รายการจากชีท "${sheet}"\n\nแทนที่รายการเดิมของ ${cur} ทั้งหมด (${base.length} รายการ)?\n(ยังไม่บันทึกจนกว่าจะกด "บันทึก")`)) return;
      setDraft(parsed);
      toast && toast(`อ่านได้ ${parsed.length} รายการจากชีท "${sheet}" — ตรวจแล้วกดบันทึก`);
    } catch (err) { alert('อ่านไฟล์ไม่ได้: ' + (err && err.message || err)); }
    finally { setBusy(false); }
  };
  const kpi = (label, value, color) => (
    <div style={{ flex: '1 1 150px', padding: '10px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--ink-100)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--ink-500)', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: color || 'var(--ink-800)' }}>{value}</div>
    </div>
  );
  const th = { padding: '6px 6px', fontSize: 11, fontWeight: 700, color: 'var(--ink-600)', background: 'var(--ink-50)', borderBottom: '1px solid var(--ink-200)', textAlign: 'center', whiteSpace: 'pre-line', lineHeight: 1.25 };
  const td = { padding: '4px 6px', fontSize: 12, borderBottom: '1px solid var(--ink-100)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' };
  const money = (v) => Math.abs(v) < 0.005 ? '—' : (v < 0 ? `(${fmtNum(-v, 2)})` : fmtNum(v, 2));
  const rate = (v) => v ? Number(v).toFixed(4) : '—';
  return (
    <Modal open={open} maxWidth={1320} wide title="🌏 เอกสารประกอบ เงินกู้ต่างประเทศ (สำหรับฝ่ายบัญชี)" onClose={() => {
      if (dirty && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ปิดโดยไม่บันทึก?')) return; onClose(); }}
      footer={<>
        <button className="btn btn-ghost" onClick={() => fxdExportWorkbook(cats.map(c => ({ cat: c, cur: catMap[c], rows: c === cur && draft ? draft : fxdLoad(c) })))}>
          <Icon name="download" size={14} /> Excel ทุกประเภท
        </button>
        <button className="btn btn-ghost" onClick={() => fxdExportWorkbook([{ cat: cur, cur: ccy, rows }])}>
          <Icon name="download" size={14} /> Excel {cur}
        </button>
        <span style={{ flex: 1 }} />
        {canEdit && dirty && <button className="btn btn-ghost" onClick={() => setDraft(null)}>ยกเลิกที่แก้</button>}
        {canEdit && <button className="btn btn-primary" disabled={!dirty} onClick={save}>💾 บันทึก</button>}
        <button className="btn btn-ghost" onClick={onClose}>ปิด</button>
      </>}>
      {!cats.length ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--ink-500)' }}>ยังไม่มีสัญญาสกุลเงินต่างประเทศ (ตั้งสกุลเงิน USD/EUR ที่หน้าภาระหนี้)</div>
      ) : (<>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'inline-flex', gap: 4, background: 'var(--ink-100, #eef1f6)', borderRadius: 9, padding: 3, border: '1px solid var(--line)' }}>
            {cats.map(c => (
              <button key={c} type="button" onClick={() => {
                if (dirty && c !== cur && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก — สลับประเภทโดยไม่บันทึก?')) return; setCat(c); }}
                style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                         background: cur === c ? 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' : 'transparent',
                         color: cur === c ? '#fff' : 'var(--ink-500)' }}>{c} · {catMap[c]}</button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {canEdit && <>
            <button className="btn btn-ghost btn-sm" onClick={pullSystem} title="เพิ่มแถวกู้ยืม/คืน จากสัญญาและรายการคืนเงินต้นในระบบ (ข้ามที่ดึงมาแล้ว)">⤵ ดึงจากระบบ</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} title='ไฟล์รูปแบบ "เอกสารประกอบ ดอกเบี้ย ตปท." (ประเภท / สัญญาที่ / วันที่ / …)'>📥 นำเข้าจาก Excel</button>
            <button className="btn btn-ghost btn-sm" onClick={add}>➕ เพิ่มแถว</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
          </>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {kpi(`กู้ยืม (${ccy})`, fmtNum(loanD, 2))}
          {kpi(`คืนแล้ว (${ccy})`, fmtNum(-repayD || 0, 2), 'var(--good)')}
          {kpi(`คงเหลือ (${ccy})`, fmtNum(loanD + repayD, 2), 'var(--bad)')}
          {kpi('จำนวนเงินตามสัญญา (บาท)', fmtNum(sum('G'), 2))}
          {kpi('เงินเข้า/ออก BANK สุทธิ (บาท)', fmtNum(sum('K'), 2))}
        </div>
        {(dirty || missRate > 0) && (
          <div style={{ fontSize: 12, marginBottom: 8, color: dirty ? 'var(--warn, #b45309)' : 'var(--ink-500)' }}>
            {dirty && '● มีการแก้ไขที่ยังไม่บันทึก '}{missRate > 0 && `· ${missRate} รายการยังไม่ใส่อัตราแลกเปลี่ยน`}
          </div>
        )}
        <div style={{ overflowX: 'auto', border: '1px solid var(--ink-100)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
            <thead><tr>
              <th style={th}>ประเภท</th><th style={th}>สัญญาที่</th><th style={th}>วันที่</th>
              <th style={th}>{`จำนวนเงินกู้\nตามสัญญา (${ccy})`}</th><th style={th}>{`ค่าธรรมเนียม\n(${ccy})`}</th>
              <th style={th}>{'อัตรา\nแลกเปลี่ยน'}</th><th style={th}>{'จำนวนเงินที่ต้อง\nได้รับตามสัญญา (บาท)'}</th>
              <th style={th}>{'อัตราแลกเปลี่ยน\nตอนจ่ายคืน'}</th><th style={th}>{`จำนวนเงินกู้\nได้รับจริง (${ccy})`}</th>
              <th style={th}>{'ค่าธรรมเนียม\nโอน (บาท)'}</th><th style={th}>{'เงินได้รับเข้า\nBANK (บาท)'}</th>
              <th style={th}>หมายเหตุ</th>{canEdit && <th style={th}></th>}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={13} style={{ ...td, textAlign: 'center', color: 'var(--ink-400)', padding: 24 }}>
                ยังไม่มีรายการ — กด "⤵ ดึงจากระบบ" หรือ "📥 นำเข้าจาก Excel"</td></tr>}
              {rows.map((r, i) => {
                const c = calcs[i];
                const E = canEdit;
                return (
                  <tr key={r.id} style={{ background: r.type === 'repay' ? 'rgba(192,57,43,0.035)' : undefined }}>
                    <td style={{ ...td, textAlign: 'center' }}>{E
                      ? <select className="select input" value={r.type} onChange={e => edit(r.id, { type: e.target.value })} style={{ padding: '2px 4px', fontSize: 12, width: 72 }}>
                          <option value="loan">กู้ยืม</option><option value="repay">คืน</option></select>
                      : <span style={{ color: r.type === 'repay' ? 'var(--bad)' : 'var(--ink-800)', fontWeight: 600 }}>{FXD_TYPES[r.type]}</span>}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{E ? <FxdCellInput value={r.no} width={46} align="center" onChange={v => edit(r.id, { no: v })} /> : r.no}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{E ? <FxdCellInput type="date" value={r.date} width={128} align="center" onChange={v => edit(r.id, { date: v })} /> : (r.date ? fmtDate(r.date) : '—')}</td>
                    <td style={td}>{E ? <FxdNumInput value={r.amt} width={116} onChange={v => edit(r.id, { amt: v })} /> : money(c.D)}</td>
                    <td style={td}>{E ? <FxdNumInput value={r.fee} width={74} onChange={v => edit(r.id, { fee: v })} /> : money(c.E)}</td>
                    <td style={td}>{E ? <FxdNumInput dec={4} value={r.rate} width={76} onChange={v => edit(r.id, { rate: v })} /> : rate(c.F)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{money(c.G)}</td>
                    <td style={td}>{r.type === 'repay' ? (E ? <FxdNumInput dec={4} value={r.rateBack} width={76} onChange={v => edit(r.id, { rateBack: v })} /> : rate(c.H)) : <span style={{ color: 'var(--ink-300)' }}>—</span>}</td>
                    <td style={td} title={c.actualSet ? 'ใส่ยอดเอง' : (r.type === 'repay' ? '= จำนวนเงินตามสัญญา' : '= จำนวนเงินกู้ − ค่าธรรมเนียม')}>
                      {E ? <FxdNumInput value={r.actual} width={116} onChange={v => edit(r.id, { actual: v === '' ? null : v })} />
                         : money(c.I)}
                      {E && !c.actualSet && <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>{money(c.I)}</div>}
                    </td>
                    <td style={td}>{E ? <FxdNumInput value={r.feeThb} width={74} onChange={v => edit(r.id, { feeThb: v })} /> : money(c.J)}</td>
                    <td style={{ ...td, fontWeight: 700, color: c.K < 0 ? 'var(--bad)' : 'var(--ink-800)' }}>{money(c.K)}</td>
                    <td style={{ ...td, textAlign: 'left' }}>{E ? <FxdCellInput value={r.note} width={140} align="left" onChange={v => edit(r.id, { note: v })} /> : (r.note || '')}</td>
                    {E && <td style={{ ...td, textAlign: 'center' }}><button className="btn btn-ghost btn-sm" title="ลบแถว" onClick={() => del(r.id)}>🗑</button></td>}
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && <tfoot><tr style={{ fontWeight: 800, background: 'var(--ink-50)' }}>
              <td style={{ ...td, textAlign: 'right' }} colSpan={3}>รวม</td>
              <td style={td}>{money(sum('D'))}</td><td style={td}></td><td style={td}></td>
              <td style={td}>{money(sum('G'))}</td><td style={td}></td>
              <td style={td}>{money(sum('I'))}</td><td style={td}>{money(sum('J'))}</td>
              <td style={td}>{money(sum('K'))}</td><td style={td} colSpan={canEdit ? 2 : 1}></td>
            </tr></tfoot>}
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 8, lineHeight: 1.6 }}>
          สูตร: จำนวนเงินตามสัญญา (บาท) = จำนวนเงินกู้ × อัตราแลกเปลี่ยน · ได้รับจริง = เงินกู้ − ค่าธรรมเนียม (กู้ยืม) / = เงินกู้ (คืน) ถ้าไม่ใส่เอง ·
          เงินเข้า BANK = ได้รับจริง × อัตรา − ค่าธรรมเนียมโอน (กู้ยืม) / = ได้รับจริง × อัตราตอนจ่ายคืน (คืน) — ยอดฝั่งคืนแสดงในวงเล็บ (ค่าลบ)
        </div>
      </>)}
    </Modal>
  );
}
