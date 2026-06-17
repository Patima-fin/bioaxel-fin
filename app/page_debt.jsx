/* page_debt.jsx — ภาระหนี้ทั้งหมด
   v4: Sticky thead + FilterableColHeader (Excel-style filters) + polished Modal popup
       + add/import workflow + cross-link to debt_ledger interest schedule
*/
'use strict';

const CATEGORY_META = {
  'WCI':       { color: '#2a6fdb', bg: '#ebf8ff', label: 'WCI (นักลงทุนรายบุคคล)' },
  'Non-WCI':   { color: '#0d9488', bg: '#f0fdfa', label: 'Non-WCI (รายบุคคลอื่น)' },
  'กรรมการ':    { color: '#7c3aed', bg: '#f5f3ff', label: 'เงินกู้กรรมการ' },
  'LockWood':  { color: '#0369a1', bg: '#f0f9ff', label: 'LockWood (ไทย)' },
  'Zigo':      { color: '#b45309', bg: '#fffbeb', label: 'Zigo (ต่างประเทศ)' },
  'Employyim': { color: '#be185d', bg: '#fdf2f8', label: 'Employyim' },
  'ลีซอิท':     { color: '#c2410c', bg: '#fff7ed', label: 'ลีซอิท (โอนสิทธิ)' },
  'STS':       { color: '#15803d', bg: '#f0fdf4', label: 'STS (โอนสิทธิ)' },
  'FS':        { color: '#9d174d', bg: '#fdf2f8', label: 'FS' },
  'ธนาคาร':     { color: '#475569', bg: '#f1f5f9', label: 'ธนาคาร / OD / LG' },
  'อื่นๆ':       { color: '#525252', bg: '#f5f5f5', label: 'อื่นๆ' },
};
const DEBT_CATEGORIES = Object.keys(CATEGORY_META);
// กลุ่มใหญ่ BANK / NON-BANK (ผู้ใช้เคาะ: BANK = ธนาคารอย่างเดียว · ที่เหลือทั้งหมด = NON-BANK)
const DEBT_BANK_CATS = ['ธนาคาร'];
const isDebtBankCat = (cat) => DEBT_BANK_CATS.includes(cat);
// NON-BANK แยกเป็น 2 กลุ่มย่อย: "สินเชื่อโอนสิทธิ์" (LIT/ลีซอิท, STS, WCI, Project, FS) vs "นักลงทุน" (ที่เหลือ)
function isAssignmentDebtCat(cat) {
  const c = String(cat || '').trim();
  if (/non-?wci/i.test(c)) return false;                 // Non-WCI = นักลงทุน
  return /ลีซอิท/.test(c) || /\blit\b/i.test(c)
      || /\bsts\b/i.test(c) || /\bwci\b/i.test(c)
      || /project/i.test(c) || /\bfs\b/i.test(c) || /โอนสิทธิ/.test(c);
}
function metaFor(cat) {
  return CATEGORY_META[cat] || { color: '#525252', bg: '#f5f5f5', label: cat || '—' };
}

/* การ์ดเล็กรายหมวด (ใช้เป็น "รายละเอียด" ที่กางออกในกลุ่ม BANK/NON-BANK) */
function DebtCategoryMiniCard({ cat, rawRows }) {
  const m = metaFor(cat);
  const catRows = rawRows.filter(r => r.debtCategory === cat);
  const activeCnt = catRows.filter(r => r.status === 'Active').length;
  const activeBal = catRows.filter(r => r.status === 'Active')
    .reduce((s, r) => s + (Number(r.balance || r.principalAmount) || 0), 0);
  const isUSD = catRows.some(r => r.currency === 'USD');
  return (
    <div className="card" style={{ flex: '1 1 200px', padding: '10px 14px', borderLeft: `4px solid ${m.color}` }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: m.color, marginBottom: 6 }}>{m.label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>สัญญา</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{catRows.length}</div>
          <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>Active {activeCnt}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>คงเหลือ</div>
          <div style={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums',
                       color: activeBal > 0 ? 'var(--bad)' : 'var(--ink-300)' }}>
            {fmtNum(activeBal, 0)} {isUSD && <span style={{ fontSize: 9, color: 'var(--ink-400)' }}>USD</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* การ์ดกลุ่มใหญ่ BANK / NON-BANK — ย่อ=ยอดรวม Active (THB + USD แยก) · กดกางดูข้างใน
   subGroups (option) = กลุ่มย่อยซ้อนในการ์ดเดียว (เช่น NON-BANK → สินเชื่อโอนสิทธิ์ / นักลงทุน)
   nested = การ์ดย่อยซ้อนในการ์ดใหญ่ (สไตล์บางลง) */
function DebtGroupCard({ label, color, cats, rawRows, defaultOpen, subGroups, nested }) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  const present = cats.filter(c => rawRows.some(r => r.debtCategory === c));
  const active  = rawRows.filter(r => cats.includes(r.debtCategory) && r.status === 'Active');
  const thbBal  = active.filter(r => r.currency !== 'USD').reduce((s, r) => s + (Number(r.balance || r.principalAmount) || 0), 0);
  const usdBal  = active.filter(r => r.currency === 'USD').reduce((s, r) => s + (Number(r.balance || r.principalAmount) || 0), 0);
  return (
    <div className="card" style={{ flex: nested ? '1 1 auto' : '1 1 360px', width: nested ? '100%' : undefined,
      padding: 0, overflow: 'hidden', borderLeft: `${nested ? 4 : 5}px solid ${color}`,
      boxShadow: nested ? 'none' : undefined, background: nested ? 'var(--ink-25, #fafbfc)' : undefined }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', padding: nested ? '10px 14px' : '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 13, color, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: nested ? 13.5 : 15, color }}>{label}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>
              {present.length} หมวด · {active.length} สัญญา Active · กดเพื่อดูรายละเอียด
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>คงเหลือ Active</div>
          <div style={{ fontWeight: 800, fontSize: nested ? 16 : 20, fontVariantNumeric: 'tabular-nums',
                       color: thbBal > 0 ? 'var(--bad)' : 'var(--ink-300)' }}>{fmtNum(thbBal, 0)}</div>
          {usdBal > 0 && <div style={{ fontSize: 11, color: 'var(--ink-500)', fontVariantNumeric: 'tabular-nums' }}>+ {fmtNum(usdBal, 0)} USD</div>}
        </div>
      </div>
      {open && (
        subGroups
          ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 14px 14px' }}>
              {subGroups.map(sg => <DebtGroupCard key={sg.label} label={sg.label} color={sg.color} cats={sg.cats} rawRows={rawRows} nested />)}
            </div>
          : present.length === 0
            ? <div style={{ padding: '0 16px 14px', fontSize: 12, color: 'var(--ink-400)' }}>— ไม่มีรายการในกลุ่มนี้ —</div>
            : <div style={{ padding: '0 14px 12px' }}>
                {/* รายการหมวดแบบลิสต์กระชับ — อ่านง่ายกว่าการ์ดเรียงเต็ม (ละลานตา) */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <tbody>
                    {present.map((cat, ci) => {
                      const m = metaFor(cat);
                      const catRows = rawRows.filter(r => r.debtCategory === cat);
                      const act = catRows.filter(r => r.status === 'Active');
                      const bal = act.reduce((s, r) => s + (Number(r.balance || r.principalAmount) || 0), 0);
                      const isUSD = act.some(r => r.currency === 'USD');
                      return (
                        <tr key={cat} style={{ borderTop: ci === 0 ? '1px solid var(--ink-100)' : '1px solid var(--ink-50, #f1f5f9)' }}>
                          <td style={{ padding: '8px 6px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                              <span style={{ width: 10, height: 10, borderRadius: 3, background: m.color, flexShrink: 0 }} />
                              <span style={{ fontWeight: 700, color: m.color }}>{m.label}</span>
                            </span>
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>
                            <b style={{ color: 'var(--ink-700)' }}>{act.length}</b><span style={{ color: 'var(--ink-300)' }}>/{catRows.length}</span> สัญญา
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: bal > 0 ? 'var(--bad)' : 'var(--ink-300)' }}>
                            {fmtNum(bal, 0)}{isUSD && <span style={{ fontSize: 9, color: 'var(--ink-400)' }}> USD</span>}
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

// Schedule popup opens inline (no page jump). Implemented via state below.

// ── Excel template for import ────────────────────────────────────────────────
function downloadDebtImportTemplate() {
  if (typeof XLSX === 'undefined') {
    alert('ระบบ Export ยังไม่พร้อม (SheetJS โหลดไม่สำเร็จ) — กรุณารีเฟรชหน้า');
    return;
  }
  const cols = [
    'debtCategory', 'contractNo', 'borrowerName', 'status', 'facilityType',
    'receiveDate', 'startDate', 'maturityDate',
    'principalAmount', 'interestRate', 'balance', 'currency',
    'bankName', 'projectCode', 'projectName', 'note',
  ];
  const headersTh = [
    'หมวด*', 'เลขที่สัญญา*', 'ผู้กู้/เจ้าหนี้*', 'สถานะ (Active/Close)', 'ประเภทวงเงิน',
    'วันที่รับเงิน (DD/MM/YYYY)', 'วันเริ่มสัญญา', 'วันครบกำหนด',
    'วงเงิน*', 'อัตราดอกเบี้ย/ปี (เช่น 0.075 หรือ 7.5)', 'คงเหลือ', 'สกุลเงิน (THB/USD)',
    'ธนาคาร/เจ้าหนี้', 'รหัสโครงการ', 'ชื่อโครงการ', 'หมายเหตุ',
  ];
  const example = [
    'WCI', 'WCI-2026-001', 'นายสมชาย ทรัพย์มาก', 'Active', 'PE',
    '15/03/2026', '15/03/2026', '15/03/2027',
    1000000, 0.075, 1000000, 'THB',
    '—', 'PP073', 'ระบบประปา ต.โคก', 'เงินกู้ระยะสั้น 12 เดือน',
  ];
  const noteRow = [
    `หมวดที่รับ: ${DEBT_CATEGORIES.join(' / ')}`,
    'ห้ามซ้ำกับสัญญาที่มีอยู่แล้ว',
    'ชื่อเต็มผู้ให้กู้/บริษัท',
    'ค่าว่าง = Active',
    `ประเภทวงเงิน: ${FACILITY_TYPES.join(' / ')} (ว่างได้)`,
    'รูปแบบ DD/MM/YYYY',
    '', '',
    'ตัวเลข ไม่ต้องใส่ comma',
    'ทศนิยม 0.075 หรือพิมพ์ 7.5',
    'ว่าง = ใช้ค่าวงเงิน', 'ค่าว่าง = THB',
    '', '', '', '',
  ];
  const aoa = [
    ['Template นำเข้าภาระหนี้ — แถวที่ 4 เป็นต้นไปคือข้อมูลจริง'],
    cols,
    headersTh,
    noteRow,
    example,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map(() => ({ wch: 18 }));
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DebtImport');
  XLSX.writeFile(wb, 'debt_import_template.xlsx');
}

// Parse uploaded xlsx → rows
function parseDebtImportFile(file, onDone, onErr) {
  if (typeof XLSX === 'undefined') { onErr('ยังไม่ได้โหลด SheetJS'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      // Drop helper-header rows (Thai labels / notes) — keep only rows that have a contractNo
      const valid = rows.filter(r => {
        const cn = String(r.contractNo || '').trim();
        if (!cn) return false;
        if (cn.includes('เลขที่สัญญา') || cn.includes('ห้ามซ้ำ')) return false;
        return true;
      });
      // Normalize
      const normalized = valid.map(r => {
        const parseDate = v => {
          if (!v) return '';
          const d = parseDateFlexible(v);
          if (!d) return '';
          return d.toISOString().slice(0, 10);
        };
        const num = v => {
          if (v == null || v === '') return 0;
          const n = Number(String(v).replace(/,/g, ''));
          return isNaN(n) ? 0 : n;
        };
        let rate = num(r.interestRate);
        if (rate > 1) rate = rate / 100; // user typed 7.5 → 0.075
        const principal = num(r.principalAmount);
        const balance = r.balance === '' || r.balance == null ? principal : num(r.balance);
        const ftRaw = String(r.facilityType || '').trim().toUpperCase();
        // match against known types (case-insensitive)
        const ftMatch = FACILITY_TYPES.find(t => t.toUpperCase() === ftRaw) || '';
        return {
          debtCategory: String(r.debtCategory || '').trim() || 'อื่นๆ',
          contractNo:   String(r.contractNo || '').trim(),
          borrowerName: String(r.borrowerName || '').trim(),
          status:       (String(r.status || '').trim() === 'Close') ? 'Close' : 'Active',
          facilityType: ftMatch,
          receiveDate:  parseDate(r.receiveDate),
          startDate:    parseDate(r.startDate),
          maturityDate: parseDate(r.maturityDate),
          principalAmount: principal,
          interestRate: rate,
          balance,
          currency:     String(r.currency || 'THB').trim().toUpperCase() === 'USD' ? 'USD' : 'THB',
          bankName:     String(r.bankName || '').trim(),
          projectCode:  String(r.projectCode || '').trim(),
          projectName:  String(r.projectName || '').trim(),
          note:         String(r.note || '').trim(),
        };
      });
      onDone(normalized);
    } catch (err) {
      onErr('อ่านไฟล์ไม่สำเร็จ: ' + (err && err.message ? err.message : String(err)));
    }
  };
  reader.onerror = () => onErr('อ่านไฟล์ไม่สำเร็จ');
  reader.readAsArrayBuffer(file);
}

// ── New / Edit debt form ─────────────────────────────────────────────────────
function DebtFormModal({ open, initial, onClose, onSave, isNew }) {
  const blank = {
    debtCategory: 'WCI', contractNo: '', borrowerName: '', status: 'Active',
    facilityType: '',
    receiveDate: new Date().toISOString().slice(0, 10),
    startDate:   new Date().toISOString().slice(0, 10),
    maturityDate: '',
    principalAmount: 0, interestRate: 0, balance: 0,
    currency: 'THB', bankName: '', projectCode: '', projectName: '', note: '',
  };
  const [draft, setDraft] = React.useState(blank);
  const [err, setErr]     = React.useState('');
  React.useEffect(() => {
    if (open) {
      setDraft(initial ? { ...blank, ...initial } : blank);
      setErr('');
    }
  }, [open, initial]);
  if (!open) return null;
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const handleSave = () => {
    if (!draft.contractNo.trim()) { setErr('กรุณากรอกเลขที่สัญญา'); return; }
    if (!draft.borrowerName.trim()) { setErr('กรุณากรอกชื่อผู้กู้/เจ้าหนี้'); return; }
    if (!Number(draft.principalAmount)) { setErr('กรุณากรอกวงเงิน'); return; }
    onSave({
      ...draft,
      principalAmount: Number(draft.principalAmount) || 0,
      interestRate:    Number(draft.interestRate) || 0,
      balance:         Number(draft.balance || draft.principalAmount) || 0,
    });
  };
  const m = metaFor(draft.debtCategory);
  return (
    <Modal
      open={open}
      title={isNew ? 'เพิ่มภาระหนี้ใหม่' : `แก้ไขภาระหนี้ · ${draft.contractNo}`}
      maxWidth={780}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={handleSave}>
          <Icon name="check" size={14} /> {isNew ? 'เพิ่ม' : 'บันทึก'}
        </button>
      </>}
    >
      {err && (
        <div style={{
          background: 'color-mix(in oklch, var(--bad) 8%, transparent)',
          border: '1px solid color-mix(in oklch, var(--bad) 28%, transparent)',
          borderRadius: 8, padding: '7px 13px', marginBottom: 12,
          fontSize: 13, color: 'var(--bad)', fontWeight: 500,
        }}>⚠️ {err}</div>
      )}

      <div style={{
        padding: '10px 14px', borderRadius: 10, marginBottom: 14,
        background: `linear-gradient(135deg, ${m.bg}, #fff)`,
        border: `1px solid ${m.color}33`,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.4 }}>หมวด</span>
        <select className="select input" value={draft.debtCategory} onChange={e => set('debtCategory', e.target.value)}
          style={{ minWidth: 200, height: 32, borderColor: m.color, color: m.color, fontWeight: 600 }}>
          {DEBT_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>สถานะ</span>
        <select className="select input" value={draft.status} onChange={e => set('status', e.target.value)} style={{ height: 32 }}>
          <option value="Active">Active</option>
          <option value="Close">ปิดสัญญา</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label>เลขที่สัญญา *</label>
          <input className="input" value={draft.contractNo} onChange={e => set('contractNo', e.target.value)} placeholder="เช่น WCI-2026-001" />
        </div>
        <div className="field">
          <label>สกุลเงิน</label>
          <select className="select input" value={draft.currency} onChange={e => set('currency', e.target.value)}>
            <option value="THB">THB (฿)</option>
            <option value="USD">USD ($)</option>
          </select>
        </div>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label>ผู้กู้ / เจ้าหนี้ *</label>
          <input className="input" value={draft.borrowerName} onChange={e => set('borrowerName', e.target.value)} placeholder="ชื่อ-นามสกุล หรือ ชื่อบริษัท" />
        </div>
        <div className="field">
          <label>ธนาคาร / เจ้าหนี้</label>
          <input className="input" value={draft.bankName} onChange={e => set('bankName', e.target.value)} placeholder="—" />
        </div>
        <div className="field">
          <label>ประเภทวงเงิน (Facility)</label>
          <select className="select input" value={draft.facilityType || ''} onChange={e => set('facilityType', e.target.value)}
            style={{ fontWeight: 600,
                     color: draft.facilityType ? FACILITY_META[draft.facilityType]?.color : undefined,
                     background: draft.facilityType ? FACILITY_META[draft.facilityType]?.bg : undefined,
                     borderColor: draft.facilityType ? FACILITY_META[draft.facilityType]?.color : undefined }}>
            <option value="">— ไม่ระบุ —</option>
            {FACILITY_TYPES.map(t => (
              <option key={t} value={t}>{t}{FACILITY_META[t]?.full ? ` · ${FACILITY_META[t].full}` : ''}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>วันรับเงิน</label>
          <input className="input" type="date" value={draft.receiveDate} onChange={e => set('receiveDate', e.target.value)} />
        </div>
        <div className="field">
          <label>วันเริ่มสัญญา</label>
          <input className="input" type="date" value={draft.startDate} onChange={e => set('startDate', e.target.value)} />
        </div>
        <div className="field">
          <label>วันครบกำหนด</label>
          <input className="input" type="date" value={draft.maturityDate} onChange={e => set('maturityDate', e.target.value)} />
        </div>

        <div className="field">
          <label>วงเงิน (Principal) *</label>
          <NumberInput className="input" value={draft.principalAmount} digits={0}
            onChange={n => set('principalAmount', n)} />
        </div>
        <div className="field">
          <label>อัตราดอกเบี้ย / ปี (พิมพ์ 7 = 7%)</label>
          <PercentInput className="input" value={draft.interestRate}
            onChange={v => set('interestRate', v)} />
        </div>
        <div className="field">
          <label>ยอดคงเหลือ (ว่าง = วงเงิน)</label>
          <NumberInput className="input" value={draft.balance} digits={0}
            onChange={n => set('balance', n)} />
        </div>

        <div className="field">
          <label>รหัสโครงการ</label>
          <input className="input" value={draft.projectCode} onChange={e => set('projectCode', e.target.value)} placeholder="เช่น PP073" />
        </div>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <label>ชื่อโครงการ</label>
          <input className="input" value={draft.projectName} onChange={e => set('projectName', e.target.value)} />
        </div>

        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>หมายเหตุ</label>
          <input className="input" value={draft.note} onChange={e => set('note', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ── Import xlsx modal ────────────────────────────────────────────────────────
function ImportDebtModal({ open, existing, onClose, onImport }) {
  const [parsed, setParsed]     = React.useState({ all: [], new_: [], dup: [] });
  const [fileName, setFileName] = React.useState('');
  const [err, setErr]           = React.useState('');
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) { setParsed({ all: [], new_: [], dup: [] }); setFileName(''); setErr(''); }
  }, [open]);
  if (!open) return null;

  const handleFile = file => {
    if (!file) return;
    setFileName(file.name);
    setErr('');
    parseDebtImportFile(file, normalized => {
      const existingCN = new Set((existing || []).map(r => (r.contractNo || '').trim()));
      const new_ = [], dup = [];
      normalized.forEach(r => existingCN.has(r.contractNo.trim()) ? dup.push(r) : new_.push(r));
      setParsed({ all: normalized, new_, dup });
    }, msg => setErr(msg));
  };

  const importNow = () => {
    onImport(parsed.new_);
  };

  return (
    <Modal
      open={open}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        นำเข้าภาระหนี้จาก Excel
      </span>}
      maxWidth={760}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={parsed.new_.length === 0} onClick={importNow}>
          <Icon name="upload" size={14} /> นำเข้า {parsed.new_.length} รายการ
        </button>
      </>}
    >
      <div style={{
        fontSize: 12, marginBottom: 12, padding: '10px 12px',
        background: '#fefce8', border: '1px solid #fde68a', borderLeft: '3px solid #f6ad55',
        borderRadius: 7, color: 'var(--ink-700)', lineHeight: 1.65,
      }}>
        <div style={{ marginBottom: 6 }}>📋 <strong>ขั้นตอน:</strong></div>
        <div>1. ดาวน์โหลด <strong>Template</strong> ก่อน → กรอกข้อมูล (เริ่มที่แถวที่ 5)</div>
        <div>2. หมวด ใช้คำตรงตามรายการ: {DEBT_CATEGORIES.join(', ')}</div>
        <div>3. อัตราดอกเบี้ย กรอกแบบทศนิยม เช่น 0.075 (7.5%) — หรือกรอก 7.5 ระบบจะแปลงให้</div>
        <div>4. ระบบจะข้ามรายการที่ <strong>เลขที่สัญญาซ้ำ</strong> กับที่มีอยู่</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-ghost" onClick={downloadDebtImportTemplate}
          style={{ background: '#ecfeff', borderColor: '#06b6d4', color: '#0e7490' }}>
          <Icon name="download" size={14} /> ดาวน์โหลด Template
        </button>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) handleFile(f);
        }}
        style={{
          border: dragOver ? '2.5px dashed var(--brand-500)' : '2px dashed var(--brand-300, #90b4f2)',
          borderRadius: 12, padding: '28px 20px',
          minHeight: 120, marginBottom: 12,
          background: dragOver ? 'color-mix(in oklch, var(--brand-500) 14%, transparent)' : 'color-mix(in oklch, var(--brand-500) 5%, transparent)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 10,
        }}>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', borderRadius: 7, cursor: 'pointer',
          background: 'var(--brand-500)', color: '#fff', fontWeight: 600, fontSize: 12.5,
        }}>
          <Icon name="upload" size={13} /> เลือกไฟล์ Excel
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files?.[0])} />
        </label>
        <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>
          {dragOver ? '⬇️ วางไฟล์ที่นี่' : 'หรือลากไฟล์มาวาง — รองรับ .xlsx, .xls, .csv'}
        </span>
        {fileName && <div style={{ fontSize: 12, color: 'var(--brand-700)' }}>📄 {fileName}</div>}
      </div>

      {err && <div style={{ color: 'var(--bad)', fontSize: 12, marginBottom: 8 }}>⚠️ {err}</div>}

      {parsed.all.length > 0 && (
        <div style={{
          padding: 10, borderRadius: 8, background: 'var(--ink-50, #f7fafc)', border: '1px solid var(--ink-100)',
        }}>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            ✅ พบทั้งหมด <strong>{parsed.all.length}</strong> รายการ ·
            <span style={{ color: 'var(--good)', marginLeft: 6 }}>ใหม่ {parsed.new_.length}</span> ·
            <span style={{ color: 'var(--ink-400)', marginLeft: 6 }}>ซ้ำ {parsed.dup.length} (จะข้าม)</span>
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 11.5 }}>
            <table className="tbl" style={{ width: '100%', fontSize: 11.5 }}>
              <thead><tr>
                <th style={{ width: 24 }}></th>
                <th>หมวด</th><th>เลขสัญญา</th><th>ผู้กู้</th>
                <th style={{ textAlign: 'right' }}>วงเงิน</th>
                <th style={{ textAlign: 'right' }}>อัตรา</th>
              </tr></thead>
              <tbody>
                {parsed.all.map((r, i) => {
                  const isDup = parsed.dup.includes(r);
                  return (
                    <tr key={i} style={{ background: isDup ? '#fef2f2' : '#f0fdf4', opacity: isDup ? 0.6 : 1 }}>
                      <td>{isDup ? '⊘' : '✓'}</td>
                      <td>{r.debtCategory}</td>
                      <td style={{ fontFamily: 'ui-monospace' }}>{r.contractNo}</td>
                      <td>{r.borrowerName}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(r.principalAmount, 0)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(r.interestRate * 100).toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function DebtPage({ data, setData, toast }) {
  const rawRows = (data?.debtMaster || []);
  const [tab,           setTab]           = React.useState('all');   // all | Active | Close
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [query,         setQuery]         = React.useState('');
  const [view,          setView]          = React.useState(null);    // row to show in popup
  const [colFilters,    setColFilters]    = React.useState({});
  const [openCol,       setOpenCol]       = React.useState(null);
  const [showAdd,       setShowAdd]       = React.useState(false);
  const [showImport,    setShowImport]    = React.useState(false);
  const [editRow,       setEditRow]       = React.useState(null);
  const [scheduleFor,   setScheduleFor]   = React.useState(null); // contract for schedule popup
  const today = new Date().toISOString().slice(0, 10);
  const canEdit = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;
  const actions = useDebtContractActions(setData, toast);

  // Keep scheduleFor in sync with store (so popup reflects latest state after
  // repayment/rollover mutations)
  React.useEffect(() => {
    if (!scheduleFor) return;
    const fresh = rawRows.find(m => m.id === scheduleFor.id || m.contractNo === scheduleFor.contractNo);
    if (fresh && fresh !== scheduleFor) setScheduleFor(fresh);
    // eslint-disable-next-line
  }, [rawRows]);

  const scheduleLedger = React.useMemo(() => {
    if (!scheduleFor) return [];
    return (data?.debtLedger || []).filter(r => r.contractNo === scheduleFor.contractNo);
  }, [scheduleFor, data?.debtLedger]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const activeRows = rawRows.filter(r => r.status === 'Active');
  const closedRows = rawRows.filter(r => r.status !== 'Active');
  const thbActive  = activeRows.filter(r => r.currency !== 'USD');
  const usdActive  = activeRows.filter(r => r.currency === 'USD');
  const totalBalanceThb = thbActive.reduce((s, r) => s + (Number(r.balance || r.principalAmount) || 0), 0);
  const totalBalanceUsd = usdActive.reduce((s, r) => s + (Number(r.balance || r.principalAmount) || 0), 0);
  const totalPrincipal  = thbActive.reduce((s, r) => s + (Number(r.principalAmount) || 0), 0);
  const categoriesPresent = [...new Set(rawRows.map(r => r.debtCategory).filter(Boolean))];

  // Display value for each column filter
  const colDisplayVal = (r, key) => {
    switch (key) {
      case 'debtCategory': return r.debtCategory || '—';
      case 'status':       return r.status === 'Active' ? 'Active' : (r.status || 'Close');
      case 'currency':     return r.currency || 'THB';
      case 'bankName':     return r.bankName || '—';
      case 'borrowerName': return r.borrowerName || '—';
      case 'receiveDate':  return fmtDate(r.receiveDate || r.startDate) || '—';
      case 'maturityDate': return fmtDate(r.maturityDate || r.endDate) || '—';
      default: {
        const v = r[key];
        return (v == null || v === '' || v === '—') ? '—' : String(v);
      }
    }
  };

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    let rows = rawRows;
    if (tab !== 'all')          rows = rows.filter(r => r.status === tab);
    if (categoryFilter !== 'all') rows = rows.filter(r => r.debtCategory === categoryFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(r =>
        (r.contractNo   || '').toLowerCase().includes(q) ||
        (r.borrowerName || '').toLowerCase().includes(q) ||
        (r.bankName     || '').toLowerCase().includes(q) ||
        (r.projectName  || '').toLowerCase().includes(q) ||
        (r.projectCode  || '').toLowerCase().includes(q) ||
        (r.note         || '').toLowerCase().includes(q)
      );
    }
    for (const [key, vals] of Object.entries(colFilters)) {
      if (vals && vals.size > 0) rows = rows.filter(r => vals.has(colDisplayVal(r, key)));
    }
    return rows;
  }, [rawRows, tab, categoryFilter, query, colFilters]);

  const { sorted, sort, toggle } = useSortable(filtered, 'debtCategory', 'asc');

  // ── Footer totals ─────────────────────────────────────────────────────────
  const filtBalance   = filtered.reduce((s,r) => s + (Number(r.balance || r.principalAmount)||0), 0);
  const filtPrincipal = filtered.reduce((s,r) => s + (Number(r.principalAmount)||0), 0);

  const cntAll    = rawRows.length;
  const cntActive = activeRows.length;
  const cntClosed = closedRows.length;

  // ── CRUD helpers ──────────────────────────────────────────────────────────
  const saveDebt = (row, mode /* 'add' | 'edit' */) => {
    let updated;
    setData(d => {
      const list = d.debtMaster || [];
      let next;
      if (mode === 'edit') {
        next = list.map(x => x.id === row.id ? { ...x, ...row } : x);
      } else {
        next = [{ ...row, id: WTPData.newId() }, ...list];
      }
      updated = { ...d, debtMaster: next };
      return updated;
    });
    if (updated && WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(updated), 0);
    toast(mode === 'edit' ? 'อัปเดตภาระหนี้แล้ว' : 'เพิ่มภาระหนี้แล้ว');
    setShowAdd(false);
    setEditRow(null);
    setView(null);
  };

  const importDebts = (rows) => {
    if (!rows.length) return;
    let updated;
    setData(d => {
      const next = [...rows.map(r => ({ ...r, id: WTPData.newId() })), ...(d.debtMaster || [])];
      updated = { ...d, debtMaster: next };
      return updated;
    });
    if (updated && WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(updated), 0);
    toast(`นำเข้าภาระหนี้ ${rows.length} รายการ`);
    setShowImport(false);
  };

  const deleteDebt = (row) => {
    if (!confirm(`ลบภาระหนี้ ${row.contractNo}?\nจะลบเฉพาะรายการนี้ — ตารางดอกเบี้ยจะค้าง orphan`)) return;
    let updated;
    setData(d => { updated = { ...d, debtMaster: (d.debtMaster || []).filter(x => x.id !== row.id) }; return updated; });
    if (updated && WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(updated), 0);
    toast('ลบภาระหนี้แล้ว');
    setView(null);
  };

  // ── Sticky table header helper ────────────────────────────────────────────
  const headerCellStyle = { position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' };

  return (
    <div className="page">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">ภาระหนี้ทั้งหมด</h1>
          <div className="page-sub">
            ณ {fmtDate(today)} · {rawRows.length} สัญญา · Active {cntActive} · ปิดแล้ว {cntClosed}
          </div>
        </div>
        <div className="page-head-r">
          {canEdit && (
            <>
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                <Icon name="plus" size={14} /> เพิ่มภาระหนี้
              </button>
              <button className="btn btn-ghost" onClick={() => setShowImport(true)}>
                <Icon name="upload" size={14} /> นำเข้า .xlsx
              </button>
            </>
          )}
          <ExportButton
            rows={sorted}
            columns={[
              { key: 'debtCategory',    label: 'หมวด' },
              { key: 'contractNo',      label: 'เลขที่สัญญา' },
              { key: 'facilityType',    label: 'ประเภทวงเงิน' },
              { key: 'borrowerName',    label: 'ผู้กู้ / เจ้าหนี้' },
              { key: 'status',          label: 'สถานะ' },
              { key: 'receiveDate',     label: 'วันรับเงิน',   type: 'date' },
              { key: 'maturityDate',    label: 'วันครบกำหนด', type: 'date' },
              { key: 'principalAmount', label: 'วงเงิน (฿)',   type: 'number' },
              { key: 'interestRate',    label: 'อัตราดอกเบี้ย/ปี', type: 'number' },
              { key: 'balance',         label: 'คงเหลือ (฿)',  type: 'number' },
              { key: 'currency',        label: 'สกุลเงิน' },
              { key: 'bankName',        label: 'ธนาคาร' },
              { key: 'projectCode',     label: 'รหัสโครงการ' },
              { key: 'projectName',     label: 'ชื่อโครงการ' },
              { key: 'note',            label: 'หมายเหตุ' },
            ]}
            filename="debt_register"
            sheetName="ภาระหนี้"
            title="ภาระหนี้ทั้งหมด"
          />
          <PrintButton />
        </div>
      </div>

      {/* ── KPI Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-4 anim-stagger" style={{ marginBottom: 16 }}>
        <KpiTile animate={false}
          label="ยอดคงเหลือ THB (Active)"
          value={totalBalanceThb}
          accent="var(--bad)"
          icon="money"
          delta={`${thbActive.length} สัญญา`}
        />
        <KpiTile animate={false}
          label="ยอดคงเหลือ USD (Active)"
          value={totalBalanceUsd}
          accent="var(--brand-500)"
          icon="bank"
          unit="USD"
          delta={`${usdActive.length} สัญญา · Zigo`}
        />
        <KpiTile animate={false}
          label="วงเงินรวม Active (THB)"
          value={totalPrincipal}
          accent="oklch(52% 0.16 145)"
          icon="arrow_up"
          delta={`${categoriesPresent.length} หมวด`}
        />
        <KpiTile animate={false}
          label="ปิดสัญญาแล้ว"
          value={cntClosed}
          accent="var(--ink-400)"
          icon="coin"
          unit=""
          digits={0}
          delta="สัญญา"
        />
      </div>

      {/* ── Summary by group (BANK / NON-BANK) — ย่อ=ยอดรวม · กดกางดูรายหมวด ── */}
      {/* NON-BANK = "ทุกหมวดที่ไม่ใช่ธนาคาร" ดึงจากหมวดจริงในข้อมูล (รวมหมวดนอก list เช่น WCI-Project) กันยอดหาย */}
      {(() => {
        const allCats    = [...new Set(rawRows.map(r => String(r.debtCategory || '').trim()).filter(Boolean))];
        const bankCats   = allCats.filter(isDebtBankCat);
        const otherCats  = allCats.filter(c => !isDebtBankCat(c));
        const assignCats = otherCats.filter(isAssignmentDebtCat);    // สินเชื่อโอนสิทธิ์
        const investCats = otherCats.filter(c => !isAssignmentDebtCat(c)); // นักลงทุน
        return (
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <DebtGroupCard label="BANK · ธนาคาร" color="#475569"
              cats={bankCats.length ? bankCats : DEBT_BANK_CATS} rawRows={rawRows} />
            <DebtGroupCard label="NON-BANK · นอกธนาคาร" color="#7c3aed"
              cats={otherCats} rawRows={rawRows}
              subGroups={[
                { label: 'สินเชื่อโอนสิทธิ์', color: '#15803d', cats: assignCats },
                { label: 'นักลงทุน',          color: '#7c3aed', cats: investCats },
              ]} />
          </div>
        );
      })()}

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tabnav" style={{ flex: 'none' }}>
          <button className={tab === 'all'    ? 'active' : ''} onClick={() => setTab('all')}>
            ทั้งหมด ({cntAll})
          </button>
          <button className={tab === 'Active' ? 'active' : ''} onClick={() => setTab('Active')}>
            Active ({cntActive})
          </button>
          <button className={tab === 'Close'  ? 'active' : ''} onClick={() => setTab('Close')}>
            ปิดแล้ว ({cntClosed})
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 'none' }}>
          <button
            onClick={() => setCategoryFilter('all')}
            style={{
              padding: '4px 12px', borderRadius: 20, border: '1.5px solid', fontSize: 11.5, fontWeight: 600,
              cursor: 'pointer',
              borderColor: categoryFilter === 'all' ? 'var(--brand-500)' : 'var(--line)',
              background:  categoryFilter === 'all' ? 'var(--brand-50,#f0f6ff)' : '#fff',
              color:       categoryFilter === 'all' ? 'var(--brand-700)' : 'var(--ink-500)',
            }}>
            ทุกหมวด
          </button>
          {categoriesPresent.map(cat => {
            const m = metaFor(cat);
            const isSelected = categoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                style={{
                  padding: '4px 12px', borderRadius: 20, border: '1.5px solid', fontSize: 11.5, fontWeight: 600,
                  cursor: 'pointer',
                  borderColor: isSelected ? m.color : 'var(--line)',
                  background:  isSelected ? m.bg : '#fff',
                  color:       isSelected ? m.color : 'var(--ink-500)',
                }}>
                {cat}
              </button>
            );
          })}
        </div>

        <div className="tb-search" style={{ width: 300, marginLeft: 'auto' }}>
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ค้นหา สัญญา / ผู้กู้ / ธนาคาร / โครงการ…"
          />
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
            const labelMap = { debtCategory:'หมวด', contractNo:'เลขที่สัญญา', borrowerName:'ผู้กู้', status:'สถานะ', receiveDate:'วันที่รับเงิน', maturityDate:'ครบกำหนด', bankName:'ธนาคาร', currency:'สกุลเงิน' };
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
          <span style={{ marginLeft: 'auto', color: 'var(--ink-500)', fontSize: 11 }}>
            แสดง {filtered.length} / {rawRows.length} รายการ
          </span>
        </div>
      )}

      {/* ── No data ──────────────────────────────────────────────────────── */}
      {rawRows.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <div style={{ fontWeight: 600, color: 'var(--ink-600)', marginBottom: 8 }}>ยังไม่มีข้อมูลภาระหนี้</div>
          <div style={{ fontSize: 13, color: 'var(--ink-400)', marginBottom: 12 }}>
            กด "เพิ่มภาระหนี้" หรือ "นำเข้า .xlsx" เพื่อเริ่มต้น
          </div>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      {rawRows.length > 0 && (
        <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'min(560px, calc(100vh - 380px))' }}>
            <table className="tbl tbl-compact" style={{ minWidth: 1380, tableLayout: 'fixed', width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' }}>
                <tr>
                  <FilterableColHeader label="หมวด" sortKey="debtCategory" colKey="debtCategory" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} width={108} align="center" />
                  <FilterableColHeader label="เลขที่สัญญา" sortKey="contractNo" colKey="contractNo" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} width={140} align="center" />
                  <FilterableColHeader label="ผู้กู้ / เจ้าหนี้" sortKey="borrowerName" colKey="borrowerName" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} align="center" />
                  <FilterableColHeader label="สถานะ" sortKey="status" colKey="status" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} width={80} align="center" />
                  <FilterableColHeader label="วันรับเงิน" sortKey="receiveDate" colKey="receiveDate" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} width={100} align="center" />
                  <FilterableColHeader label="ครบกำหนด" sortKey="maturityDate" colKey="maturityDate" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} width={100} align="center" />
                  <FilterableColHeader label="วงเงิน" sortKey="principalAmount" colKey="principalAmount" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} align="right" width={120} />
                  <FilterableColHeader label="ดอกเบี้ย/ปี" sortKey="interestRate" colKey="interestRate" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} align="right" width={88} />
                  <FilterableColHeader label="คงเหลือ" sortKey="balance" colKey="balance" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} align="right" width={120} />
                  <FilterableColHeader label="ธนาคาร" sortKey="bankName" colKey="bankName" sort={sort} sortToggle={toggle} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rawRows} getValue={colDisplayVal} width={110} align="center" />
                  <th style={{ width: 200 }}>โครงการ</th>
                  <th style={{ width: 120, textAlign: 'center' }}>การกระทำ</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{ textAlign: 'center', color: 'var(--ink-400)', padding: 36 }}>
                      ไม่พบข้อมูลที่ตรงกับเงื่อนไข
                    </td>
                  </tr>
                )}
                {sorted.map(r => {
                  const meta     = metaFor(r.debtCategory);
                  const isActive = r.status === 'Active';
                  const balance  = Number(r.balance || r.principalAmount) || 0;
                  const principal= Number(r.principalAmount) || 0;
                  const rate     = Number(r.interestRate) || 0;
                  const isUSD    = r.currency === 'USD';
                  return (
                    <tr key={r.id || r.contractNo}
                      onClick={() => setView(r)}
                      style={{ opacity: isActive ? 1 : 0.6, cursor: 'pointer' }}>
                      <td>
                        <Badge kind="b-blue" dot={false}
                          style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33` }}>
                          {r.debtCategory || '—'}
                        </Badge>
                      </td>
                      <td style={{ fontFamily: 'ui-monospace', fontSize: 11.5, color: 'var(--ink-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.contractNo || ''}>
                        {r.facilityType && <span style={{ marginRight: 4 }}><FacilityChip type={r.facilityType} /></span>}
                        {r.contractNo || '—'}
                      </td>
                      <td style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.borrowerName || ''}>
                        {r.borrowerName || '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <Badge kind={isActive ? 'b-blue' : 'b-gray'} dot={false}>
                          {isActive ? 'Active' : r.status || 'Close'}
                        </Badge>
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--ink-500)', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {fmtDate(r.receiveDate || r.startDate) || '—'}
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--ink-500)', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {fmtDate(r.maturityDate || r.endDate) || '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                        {fmtNum(principal, 0)} {isUSD && <span style={{ color: 'var(--ink-400)', fontSize: 10 }}>USD</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                        {rate > 0 ? (rate * 100).toFixed(2) + '%' : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13,
                                   color: balance > 0 ? 'var(--bad)' : 'var(--ink-300)', whiteSpace: 'nowrap' }}>
                        {fmtNum(balance, 0)}
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--ink-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.bankName || ''}>
                        {r.bankName || '—'}
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.projectName || ''}>
                        {r.projectCode ? <span style={{ fontFamily: 'ui-monospace', color: 'var(--brand-700)', marginRight: 4 }}>{r.projectCode}</span> : null}
                        {r.projectName || (r.projectCode ? '' : '—')}
                      </td>
                      <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center', padding: '4px 6px' }}>
                        <button
                          onClick={() => setScheduleFor(r)}
                          title="ดูตารางดอกเบี้ยรายเดือน + จัดการการจ่าย"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 9px', borderRadius: 14, cursor: 'pointer',
                            border: '1px solid var(--brand-300, #90b4f2)',
                            background: 'var(--brand-50, #f0f6ff)',
                            color: 'var(--brand-700)',
                            fontSize: 11, fontWeight: 600,
                          }}>
                          <Icon name="coin" size={11} /> ดอกเบี้ย
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {sorted.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#edf2ff', fontWeight: 700 }}>
                    <td colSpan={6} style={{ textAlign: 'right', paddingRight: 10, fontSize: 12 }}>
                      รวม ({filtered.length} สัญญา)
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(filtPrincipal, 0)}</td>
                    <td></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--bad)', fontSize: 14 }}>{fmtNum(filtBalance, 0)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── Detail Popup ─────────────────────────────────────────────────── */}
      {view && (() => {
        const m       = metaFor(view.debtCategory);
        const isActive= view.status === 'Active';
        const isUSD   = view.currency === 'USD';
        const bal     = Number(view.balance || view.principalAmount) || 0;
        const princ   = Number(view.principalAmount) || 0;
        const rate    = Number(view.interestRate) || 0;
        const paid    = princ > 0 ? Math.max(0, princ - bal) : 0;
        const paidPct = princ > 0 ? Math.min(100, (paid / princ) * 100) : 0;
        // Look up summary from debtLedger
        const ledgerRows = (data?.debtLedger || []).filter(L => L.contractNo === view.contractNo);
        // ★ ใช้ effectiveInterest (override-aware, global จาก page_debt_ledger) ให้ "ดอกเบี้ยรวม/ค้างจ่าย"
        //   ในป๊อปอัปนี้ตรงกับหน้า Debt Ledger — เดิมอ่าน interestAmount ดิบ → เพิกเฉย override ที่ผู้ใช้แก้ → 2 หน้าไม่ตรงกัน
        const _ieff = (typeof effectiveInterest === 'function') ? effectiveInterest : (L => Number(L.interestAmount) || 0);
        const interestTotal = ledgerRows.reduce((s, L) => s + _ieff(L), 0);
        const interestPaid  = ledgerRows.filter(L => L.paymentDate).reduce((s, L) => s + _ieff(L), 0);
        const interestDue   = interestTotal - interestPaid;

        const fld = (label, value, opts = {}) => (
          <div className="field" style={opts.span ? { gridColumn: `span ${opts.span}` } : (opts.full ? { gridColumn: '1/-1' } : {})}>
            <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 10, opacity: 0.5 }}>🔒</span>{label}
            </label>
            <div style={{
              minHeight: 32, borderRadius: 7, border: '1px solid var(--ink-100)',
              padding: '6px 10px', fontSize: 12.5, lineHeight: 1.5,
              background: opts.highlight ? 'color-mix(in oklch, var(--bad) 9%, transparent)' : 'var(--ink-50, #f7f8fa)',
              color: opts.highlight ? 'var(--bad)' : 'var(--ink-700)',
              fontWeight: opts.highlight ? 700 : (opts.bold ? 600 : 400),
              fontFamily: opts.mono ? 'ui-monospace' : 'inherit',
              textAlign: opts.right ? 'right' : 'left',
              fontVariantNumeric: opts.right ? 'tabular-nums' : 'normal',
              wordBreak: 'break-word', userSelect: 'text',
            }}>{value || '—'}</div>
          </div>
        );
        const Hdr = ({ label, icon }) => (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
            color: 'var(--brand-700)', paddingBottom: 5, marginTop: 4,
            borderBottom: '1px solid color-mix(in oklch, var(--brand-500) 20%, transparent)',
            gridColumn: '1 / -1',
          }}>
            <Icon name={icon} size={11} />{label}
          </div>
        );

        return (
          <Modal
            open={!!view}
            maxWidth={820}
            onClose={() => setView(null)}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Badge kind="b-blue" dot={false}
                  style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}55`, fontSize: 11.5 }}>
                  {view.debtCategory || '—'}
                </Badge>
                <Badge kind={isActive ? 'b-blue' : 'b-gray'} dot={false}>
                  {isActive ? 'Active' : view.status || 'Close'}
                </Badge>
                <span style={{ fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)', fontSize: 13 }}>{view.contractNo || '—'}</span>
                <span style={{ color: 'var(--ink-300)', fontSize: 12 }}>·</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-700)' }}>{view.borrowerName || '—'}</span>
              </div>
            }
            footer={<>
              <button className="btn btn-ghost" onClick={() => setView(null)}>ปิด</button>
              {canEdit && (
                <button className="btn btn-ghost" onClick={() => { setEditRow(view); setView(null); }}
                  style={{ borderColor: '#fbbf24', color: '#92400e', background: '#fffbeb' }}>
                  <Icon name="edit" size={13} /> แก้ไข
                </button>
              )}
              {canEdit && (
                <button className="btn btn-ghost" onClick={() => deleteDebt(view)}
                  style={{ borderColor: '#fca5a5', color: '#991b1b', background: '#fef2f2' }}>
                  <Icon name="trash" size={13} /> ลบ
                </button>
              )}
              <button className="btn btn-primary" onClick={() => { setScheduleFor(view); }}>
                <Icon name="coin" size={14} /> ดูตารางดอกเบี้ย / จ่าย / คืนเงินต้น
              </button>
            </>}
          >
            {/* Hero header — balance + repayment progress */}
            <div style={{
              padding: '14px 16px', borderRadius: 12, marginBottom: 16,
              background: `linear-gradient(135deg, ${m.bg}, color-mix(in oklch, ${m.color} 4%, #ffffff))`,
              border: `1px solid ${m.color}33`,
              display: 'grid', gap: 12,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>ยอดคงเหลือ (เงินต้น)</div>
                  <div style={{ fontWeight: 700, fontSize: 22, color: bal > 0 ? 'var(--bad)' : 'var(--ink-400)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtNum(bal, 0)} <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>{isUSD ? 'USD' : '฿'}</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>ดอกเบี้ยรวม</div>
                  <div style={{ fontWeight: 600, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtNum(interestTotal, 0)} ฿
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--good)' }}>ชำระแล้ว {fmtNum(interestPaid, 0)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>ดอกเบี้ยค้างจ่าย</div>
                  <div style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: 'tabular-nums',
                                color: interestDue > 0 ? 'var(--bad)' : 'var(--ink-300)' }}>
                    {fmtNum(interestDue, 0)} ฿
                  </div>
                </div>
              </div>
              {princ > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-500)', marginBottom: 4 }}>
                    <span>ชำระเงินต้นแล้ว {fmtNum(paid, 0)} / วงเงิน {fmtNum(princ, 0)}</span>
                    <span>{paidPct.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--ink-100)', overflow: 'hidden' }}>
                    <div style={{ width: `${paidPct}%`, height: '100%', background: m.color, transition: 'width 240ms' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Field grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 12px' }}>

              <Hdr label="สัญญา" icon="invoice" />
              {fld('เลขที่สัญญา', view.contractNo, { mono: true, span: 2 })}
              {fld('สกุลเงิน', view.currency || 'THB')}
              {fld('ผู้กู้ / ผู้รับสินเชื่อ', view.borrowerName, { bold: true, span: 2 })}
              {fld('ธนาคาร / เจ้าหนี้', view.bankName)}
              {fld('ประเภทวงเงิน',
                view.facilityType
                  ? <FacilityChip type={view.facilityType} size="md" />
                  : '—',
                { span: 1 }
              )}

              <Hdr label="ระยะเวลา" icon="forecast" />
              {fld('วันที่รับเงิน', fmtDate(view.receiveDate || view.startDate))}
              {fld('วันเริ่มสัญญา', fmtDate(view.startDate))}
              {fld('วันครบกำหนด', fmtDate(view.maturityDate || view.endDate))}

              <Hdr label="ยอดเงิน & อัตรา" icon="coin" />
              {fld('วงเงิน (Principal)', fmtNum(princ, 2), { right: true, bold: true })}
              {fld('อัตราดอกเบี้ย / ปี', rate > 0 ? (rate * 100).toFixed(4) + ' %' : '—', { right: true })}
              {fld('ยอดคงเหลือ (Balance)', fmtNum(bal, 2), { right: true, highlight: bal > 0 })}

              <Hdr label="โครงการที่ผูก" icon="projects" />
              {fld('รหัสโครงการ', view.projectCode, { mono: true })}
              {fld('ชื่อโครงการ', view.projectName, { span: 2 })}

              {view.note && <>
                <Hdr label="หมายเหตุ" icon="edit" />
                {fld('Note', view.note, { full: true })}
              </>}
            </div>
          </Modal>
        );
      })()}

      {/* ── Add / Edit / Import modals ───────────────────────────────────── */}
      <DebtFormModal
        open={showAdd}
        initial={null}
        isNew
        onClose={() => setShowAdd(false)}
        onSave={row => saveDebt(row, 'add')}
      />
      <DebtFormModal
        open={!!editRow}
        initial={editRow}
        isNew={false}
        onClose={() => setEditRow(null)}
        onSave={row => saveDebt(row, 'edit')}
      />
      <ImportDebtModal
        open={showImport}
        existing={rawRows}
        onClose={() => setShowImport(false)}
        onImport={importDebts}
      />

      {/* Interest schedule popup — inline, no page jump.
          Defined in page_debt_ledger.jsx; available as global at runtime. */}
      {scheduleFor && (
        <InterestSchedulePopup
          master={scheduleFor}
          ledgerRows={scheduleLedger}
          events={data?.debtEvents || []}
          onClose={() => setScheduleFor(null)}
          onSavePayments={actions.savePayments}
          onClearPayment={actions.clearPayment}
          onOverrideInterest={actions.overrideInterest}
          onAddPrincipalEvent={actions.addPrincipalEvent}
          onRollover={actions.doRollover}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
