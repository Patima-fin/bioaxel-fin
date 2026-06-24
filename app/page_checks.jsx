/* page_checks.jsx — เช็คจ่ายล่วงหน้า */
'use strict';

const _CHK_ACCENT = { blue:'var(--brand-500)', orange:'oklch(60% 0.18 55)', yellow:'oklch(65% 0.18 75)', teal:'oklch(52% 0.16 185)', red:'var(--bad,#e53e3e)', green:'oklch(50% 0.18 145)' };
const ChkStatTile = ({ label, value, sub, color = 'blue' }) => (
  <div className="kpi">
    <div className="kpi-accent" style={{ background: _CHK_ACCENT[color] || _CHK_ACCENT.blue }} />
    <div className="kpi-label">{label}</div>
    <div className="kpi-value" style={{ fontSize: 18 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color:'var(--ink-400,#8a94a6)', marginTop: 2 }}>{sub}</div>}
  </div>
);

const CHECKS_STATUS_META = {
  pending:   { label:'รอจ่าย',    color:'b-amber' },
  clearing:  { label:'กำลังเรียกเก็บ', color:'b-blue' },
  cleared:   { label:'ผ่านแล้ว',  color:'b-green' },
  cancelled: { label:'ยกเลิก',    color:'b-gray' },
};

// ประเภทเช็ค — ระบุว่าเช็คนี้ใช้ทำอะไร (ค้ำเงินต้น/ดอกเบี้ย/เงินต้น+ดอกเบี้ย/ชำระค่าใช้จ่าย/อื่นๆ)
const CHECK_TYPES = [
  { v:'principal_guarantee', label:'ค้ำเงินต้น' },
  { v:'interest',            label:'ดอกเบี้ย' },
  { v:'principal_interest',  label:'เงินต้นและดอกเบี้ย' },
  { v:'expense',             label:'ชำระค่าใช้จ่าย' },
  { v:'other',               label:'อื่นๆ' },
];
const CHECK_TYPE_LABEL = (v) => { const m = CHECK_TYPES.find(x => x.v === v); return m ? m.label : (v || ''); };

// ธนาคารไทยที่พบบ่อย — ใช้เติม datalist ของช่อง "ธนาคาร"
const COMMON_TH_BANKS = [
  'กสิกรไทย', 'ไทยพาณิชย์', 'กรุงไทย', 'กรุงเทพ', 'กรุงศรีอยุธยา',
  'ทหารไทยธนชาต', 'ออมสิน', 'อาคารสงเคราะห์', 'เกียรตินาคินภัทร',
  'ซีไอเอ็มบีไทย', 'ยูโอบี', 'แลนด์ แอนด์ เฮ้าส์', 'ทิสโก้',
  'ไทยเครดิต', 'ไอซีบีซี (ไทย)', 'เอชเอสบีซี', 'สแตนดาร์ดชาร์เตอร์ด',
];

// Normalize Thai status values (imported from RAW) → internal status codes
function normStatus(s) {
  if (!s) return 'pending';
  // already an internal code (e.g. set/edited in-app) → keep as-is.
  // ถ้าไม่ผ่านบรรทัดนี้ การแก้สถานะในแอป (cleared/clearing/cancelled) จะถูก
  // map กลับเป็น 'pending' ทุกครั้งที่ render → กดเปลี่ยนสถานะแล้วเด้งกลับ.
  if (CHECKS_STATUS_META[s]) return s;
  if (s === 'จ่ายแล้ว' || s === 'ขึ้นเงินแล้ว' || s.indexOf('ได้รับคืน') >= 0 || s.indexOf('ได้รับเช็คคืน') >= 0) return 'cleared';
  if (s.indexOf('รอ') >= 0) return 'clearing';
  if (s.indexOf('ยกเลิก') >= 0 || s.indexOf('เด้ง') >= 0) return 'cancelled';
  return 'pending';
}

const ChecksPage = ({ data: propData, setData, toast }) => {
  const data = propData || WTPData.load();
  const rawChecks = data.checks || [];
  // Normalize status so existing tabs/filters work with imported Thai-status data
  const checks = React.useMemo(() => rawChecks.map(c => ({ ...c, status: normStatus(c.status) })), [rawChecks]);
  const today  = new Date().toISOString().slice(0, 10);
  const in7    = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const TABS = [
    { key:'all',       label:'ทั้งหมด' },
    { key:'pending',   label:'รอจ่าย' },
    { key:'clearing',  label:'กำลังเรียกเก็บ' },
    { key:'cleared',   label:'ผ่านแล้ว' },
    { key:'cancelled', label:'ยกเลิก' },
  ];

  const emptyForm = { checkNo:'', checkDate:'', payee:'', amount:'', bankName:'', accountNo:'',
                      checkType:'', referenceNo:'', linkedProjectCode:'', status:'pending', note:'' };

  const [tab, setTab]       = React.useState('all');
  const [query, setQuery]   = React.useState('');
  const [edit, setEdit]     = React.useState(null);   // null = closed, {} = new, {...} = editing
  const [view, setView]     = React.useState(null);   // popup for viewing check (read-only)
  const [form, setForm]     = React.useState(emptyForm);
  // Column filters (Excel-like) + bulk selection
  const [colFilters, setColFilters] = React.useState({});
  const [openCol, setOpenCol]       = React.useState(null);
  const [bulkMode, setBulkMode]     = React.useState(false);   // toggle bulk-select UI
  const [selected, setSelected]     = React.useState(() => new Set());
  // Role gating
  const userCanEdit   = window.WTPAuth ? window.WTPAuth.can('canEdit')   : true;
  const userCanDelete = window.WTPAuth ? window.WTPAuth.can('canDelete') : true;

  const { sorted, sort, toggle: requestSort } = useSortable(checks, 'checkDate', 'asc');
  const sortKey = sort.key; const sortDir = sort.dir;

  // Display value helper for column filter (formatted so dropdown shows readable values)
  const colDisplay = (row, key) => {
    const v = row[key];
    if (v == null || v === '') return '—';
    if (key === 'checkDate') return fmtDate(v) || String(v);
    if (key === 'amount')    return fmtNum(parseFloat(v) || 0, 2);
    if (key === 'status') {
      const m = CHECKS_STATUS_META[v];
      return m ? m.label : String(v);
    }
    return String(v);
  };

  const filtered = React.useMemo(() => {
    let rows = sorted;
    if (tab !== 'all') rows = rows.filter(c => c.status === tab);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter(c =>
        (c.checkNo   || '').toLowerCase().includes(q) ||
        (c.payee     || '').toLowerCase().includes(q) ||
        (c.bankName  || '').toLowerCase().includes(q) ||
        (c.referenceNo||'').toLowerCase().includes(q)
      );
    }
    // Apply per-column Excel-like filters
    const activeKeys = Object.keys(colFilters).filter(k => colFilters[k] && colFilters[k].size > 0);
    if (activeKeys.length > 0) {
      rows = rows.filter(r => activeKeys.every(k => colFilters[k].has(colDisplay(r, k))));
    }
    return rows;
  }, [sorted, tab, query, colFilters]);

  // ── Suggestion sources for the Add/Edit modal ────────────────────────
  // payee  → distinct ผู้รับเงิน จากเช็คเดิม, sort by frequency desc (ใช้บ่อย = บนสุด)
  // banks  → บัญชีบริษัท ของ BIOAXEL (จาก data.bankAccounts) เพื่อ quick-pick ธนาคาร+เลขบัญชี
  const payeeOptions = React.useMemo(() => {
    const freq = new Map();
    rawChecks.forEach(c => {
      const p = String(c.payee || '').trim();
      if (!p) return;
      freq.set(p, (freq.get(p) || 0) + 1);
    });
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  }, [rawChecks]);

  const companyBanks = React.useMemo(() => {
    const list = (data.bankAccounts || []).map(a => {
      const bn = a.BANK_NAME || a.bankName || a.bank || a.Bank || '';
      const ac = a.Bank_AC || a.accountNo || a.account_no || a.ACCOUNT_NO || '';
      const nick = a.shortName || a.alias || a.NICKNAME || '';
      return { bankName: String(bn).trim(), accountNo: String(ac).trim(), nick: String(nick).trim() };
    }).filter(x => x.bankName || x.accountNo);
    // dedupe by bank+ac
    const seen = new Set();
    return list.filter(x => { const k = x.bankName + '|' + x.accountNo; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [data.bankAccounts]);

  // Reset selection when filter / mode changes
  React.useEffect(() => { setSelected(new Set()); }, [tab, query, colFilters, bulkMode]);

  const toggleSelectOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // ── persist เช็คผ่าน React state (setData) แทน WTPData.load/save ตรง ๆ ──
  // เดิมหน้านี้ทำ load → แก้ d.checks → save → window.location.reload() ซึ่ง
  //   (1) ไม่ผ่าน React state จริง  (2) reload ตัดจังหวะ debounce push 3 วิ ทิ้ง
  //   → แก้/ลบเช็คแล้วบางทีหายเพราะ push ไม่ทันยิง.
  // ตอนนี้ใช้ setData + forceSyncNow เหมือนหน้าอื่น (push ทันที ไม่ reload)
  const persistChecks = (mutate) => {
    if (setData) {
      let updated;
      setData(d => { updated = { ...d, checks: mutate(d.checks || []) }; return updated; });
      if (updated && WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(updated), 0);
    } else {
      const d = WTPData.load();           // fallback (ไม่ส่ง setData) — อย่างน้อยไม่ reload ตัด push
      d.checks = mutate(d.checks || []);
      WTPData.save(d);
    }
  };

  const bulkRemove = () => {
    if (selected.size === 0) return;
    const n = selected.size;
    if (!window.confirm(`ลบเช็ค ${n} ฉบับที่เลือก?`)) return;
    persistChecks(rows => rows.filter(c => !selected.has(c.id)));
    setSelected(new Set());
    toast && toast(`ลบเช็ค ${n} ฉบับแล้ว`);
  };

  /* KPIs */
  const pendingTotal  = checks.filter(c => c.status === 'pending').reduce((s,c) => s+(parseFloat(c.amount)||0), 0);
  const clearingTotal = checks.filter(c => c.status === 'clearing').reduce((s,c) => s+(parseFloat(c.amount)||0), 0);
  const upcoming7     = checks.filter(c => c.status === 'pending' && c.checkDate >= today && c.checkDate <= in7)
                              .reduce((s,c) => s+(parseFloat(c.amount)||0), 0);
  const overdueCount  = checks.filter(c => c.status === 'pending' && c.checkDate < today).length;

  const openNew  = () => { setForm(emptyForm); setEdit({}); };
  const openEdit = (c)  => { setForm({ ...c }); setEdit(c); };
  const closeEdit= ()   => setEdit(null);

  const handleSave = () => {
    if (!form.checkDate || !form.payee || !form.amount) return;
    const isEdit = !!(edit && edit.id);
    persistChecks(rows => {
      const next = [...rows];
      if (isEdit) {
        const idx = next.findIndex(r => r.id === edit.id);
        if (idx >= 0) next[idx] = { ...form, id: edit.id };
        else next.push({ ...form, id: edit.id });
      } else {
        next.push({ ...form, id: WTPData.newId() });
      }
      return next;
    });
    closeEdit();
    toast && toast(isEdit ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มเช็คแล้ว');
  };

  const handleDelete = (id) => {
    if (!window.confirm('ลบรายการนี้?')) return;
    persistChecks(rows => rows.filter(c => c.id !== id));
    toast && toast('ลบเช็คแล้ว');
  };

  const SortTh = ({ col, children }) => (
    <th className="sortable" onClick={() => requestSort(col)}
        style={{ cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}>
      {children}{sortKey===col ? (sortDir==='asc' ? ' ▲' : ' ▼') : ' ⇅'}
    </th>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">เช็คจ่ายล่วงหน้า</div>
          <div className="page-sub">รายการเช็คทั้งหมด • {checks.length} ฉบับ</div>
        </div>
        <div className="page-head-r">
          <ExportButton
            rows={filtered}
            columns={[
              { key: 'checkNo',           label: 'เลขที่เช็ค' },
              { key: 'checkDate',         label: 'วันที่เช็ค', type: 'date' },
              { key: 'payee',             label: 'ผู้รับเงิน' },
              { key: 'amount',            label: 'จำนวนเงิน', type: 'number' },
              { key: 'bankName',          label: 'ธนาคาร' },
              { key: 'accountNo',         label: 'เลขที่บัญชี' },
              { key: 'referenceNo',       label: 'เลขอ้างอิง' },
              { key: 'linkedProjectCode', label: 'โครงการ' },
              { key: 'status',            label: 'สถานะ' },
              { key: 'note',              label: 'หมายเหตุ' },
            ]}
            filename="checks"
            sheetName="เช็คจ่าย"
            title="เช็คจ่ายล่วงหน้า"
          />
          <PrintButton />
          {userCanDelete && (
            <button
              className={`btn ${bulkMode ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setBulkMode(v => !v)}
              title={bulkMode ? 'ปิดโหมดเลือกหลายรายการ' : 'เปิดโหมดเลือกหลายรายการ'}>
              <Icon name="check" size={14} /> {bulkMode ? 'ปิดเลือก' : 'เลือกหลายรายการ'}
            </button>
          )}
          {userCanEdit && (
            <button className="btn btn-primary" onClick={openNew}>+ เพิ่มเช็ค</button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-4 anim-stagger" style={{ marginBottom: 16 }}>
        <KpiTile label="รอจ่าย"             value={pendingTotal}  accent="oklch(65% 0.18 75)"  icon="money"     animate={false} />
        <KpiTile label="กำลังเรียกเก็บ"     value={clearingTotal} accent="var(--brand-500)"    icon="coin"      animate={false} />
        <KpiTile label="ครบกำหนด 7 วัน"    value={upcoming7}     accent="oklch(60% 0.18 55)"  icon="invoice"   animate={false} />
        <KpiTile label="เกินกำหนด"          value={overdueCount}  accent={overdueCount > 0 ? 'var(--bad)' : 'var(--good)'} unit=" ฉบับ" digits={0} icon="arrow_up" animate={false} />
      </div>

      {/* Filter bar */}
      <div style={{ display:'flex', alignItems:'center', gap: 12, marginBottom: 12, flexWrap:'wrap' }}>
        <div className="tabnav" style={{ flex:'none' }}>
          {TABS.map(t => (
            <button key={t.key} className={tab===t.key ? 'active' : ''}
                    onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <input className="input" placeholder="ค้นหาเลขเช็ค / ผู้รับ / ธนาคาร…"
               value={query} onChange={e => setQuery(e.target.value)}
               style={{ width: '100%', maxWidth: 300 }} />
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow:'hidden' }}>
        <div className="tbl-wrap" style={{ overflowX:'auto', overflowY:'auto', maxHeight:'min(480px, calc(100vh - 400px))' }}>
          <table className="tbl" style={{ minWidth: 850 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' }}>
              <tr>
                {userCanDelete && bulkMode && (
                  <th style={{ width: 34, textAlign: 'center' }}>
                    <input type="checkbox"
                      checked={filtered.length > 0 && filtered.every(r => selected.has(r.id))}
                      ref={el => { if (el) el.indeterminate = filtered.some(r => selected.has(r.id)) && !filtered.every(r => selected.has(r.id)); }}
                      onChange={() => {
                        const all = filtered.length > 0 && filtered.every(r => selected.has(r.id));
                        if (all) setSelected(new Set());
                        else setSelected(new Set(filtered.map(r => r.id)));
                      }}
                      style={{ cursor:'pointer' }} title="เลือกทั้งหมด" />
                  </th>
                )}
                <FilterableColHeader label="เลขที่เช็ค"    sortKey="checkNo"   colKey="checkNo"   sort={sort} sortToggle={requestSort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={sorted} getValue={colDisplay} />
                <FilterableColHeader label="วันที่เช็ค"    sortKey="checkDate" colKey="checkDate" sort={sort} sortToggle={requestSort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={sorted} getValue={colDisplay} />
                <FilterableColHeader label="ผู้รับเงิน"    sortKey="payee"     colKey="payee"     sort={sort} sortToggle={requestSort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={sorted} getValue={colDisplay} />
                <FilterableColHeader label="จำนวนเงิน" sortKey="amount"   colKey="amount"    sort={sort} sortToggle={requestSort} align="right" colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={sorted} getValue={colDisplay} />
                <FilterableColHeader label="ธนาคาร"        sortKey="bankName" colKey="bankName"  sort={sort} sortToggle={requestSort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={sorted} getValue={colDisplay} />
                <FilterableColHeader label="เลขที่บัญชี"   colKey="accountNo"   sort={sort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={sorted} getValue={colDisplay} />
                <FilterableColHeader label="เลขอ้างอิง"   colKey="referenceNo" sort={sort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={sorted} getValue={colDisplay} />
                <FilterableColHeader label="สถานะ"         sortKey="status"   colKey="status"    sort={sort} sortToggle={requestSort} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={sorted} getValue={colDisplay} />
                <th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={(userCanDelete && bulkMode) ? 10 : 9} style={{ textAlign:'center', color:'#8a94a6', padding:32 }}>ไม่พบข้อมูล</td></tr>
              )}
              {filtered.map(c => {
                const isOverdue = c.status === 'pending' && c.checkDate < today;
                const isUrgent  = c.status === 'pending' && c.checkDate >= today && c.checkDate <= in7;
                const meta = CHECKS_STATUS_META[c.status] || { label: c.status, color:'badge-gray' };
                const isSelected = selected.has(c.id);
                return (
                  <tr key={c.id}
                      onClick={() => bulkMode ? toggleSelectOne(c.id) : setView(c)}
                      style={{ background: isSelected ? 'var(--brand-50)' : (isOverdue ? '#fff5f5' : isUrgent ? '#fffbeb' : undefined), cursor:'pointer' }}>
                    {userCanDelete && bulkMode && (
                      <td onClick={e => e.stopPropagation()} style={{ textAlign:'center' }}>
                        <input type="checkbox" checked={isSelected}
                          onChange={() => toggleSelectOne(c.id)} style={{ cursor:'pointer' }} />
                      </td>
                    )}
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{c.checkNo}</td>
                    <td style={{ fontSize: 12, color: isOverdue ? '#e53e3e' : isUrgent ? '#dd6b20' : undefined }}>
                      {fmtDate(c.checkDate)}
                      {isOverdue && <span style={{ fontSize: 10, marginLeft: 4, color:'#e53e3e' }}>⚠</span>}
                    </td>
                    <td>{c.payee}</td>
                    <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight: 600 }}>
                      {fmtMoney(c.amount)}
                    </td>
                    <td style={{ fontSize: 12 }}>{c.bankName}</td>
                    <td style={{ fontSize: 11, color:'#718096' }}>{c.accountNo}</td>
                    <td style={{ fontSize: 11, color:'#718096' }}>{c.referenceNo || '—'}</td>
                    <td><span className={`badge ${meta.color}`}>{meta.label}</span></td>
                    <td style={{ fontSize: 11, color:'#718096' }}>{c.note || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr style={{ background:'#edf2ff', fontWeight: 700 }}>
                  <td colSpan={(userCanDelete && bulkMode) ? 4 : 3} style={{ textAlign:'right', paddingRight: 8 }}>
                    รวม ({filtered.length} ฉบับ)
                  </td>
                  <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums' }}>
                    {fmtMoney(filtered.reduce((s,c)=>s+(parseFloat(c.amount)||0), 0))}
                  </td>
                  <td colSpan={5}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Floating bulk-action bar — only in bulkMode */}
      {bulkMode && selected.size > 0 && userCanDelete && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--ink-900)', color: '#fff', borderRadius: 12,
          padding: '10px 14px 10px 20px', boxShadow: '0 12px 32px rgba(15,36,77,0.28)',
          display: 'flex', alignItems: 'center', gap: 14, zIndex: 950,
          minWidth: 320, maxWidth: 'min(560px, calc(100vw - 32px))',
        }}>
          <div style={{ flex: 1, fontSize: 13 }}>
            <strong>{selected.size}</strong> ฉบับถูกเลือก
          </div>
          <button onClick={() => setSelected(new Set())} className="btn btn-ghost"
            style={{ color: '#fff', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)' }}>ยกเลิก</button>
          <ExportButton
            rows={filtered.filter(c => selected.has(c.id))}
            columns={[
              { key: 'checkNo',     label: 'เลขที่เช็ค' },
              { key: 'checkDate',   label: 'วันที่เช็ค', type: 'date' },
              { key: 'payee',       label: 'ผู้รับเงิน' },
              { key: 'amount',      label: 'จำนวนเงิน', type: 'number' },
              { key: 'bankName',    label: 'ธนาคาร' },
              { key: 'status',      label: 'สถานะ' },
            ]}
            filename="checks_selected"
            sheetName="เช็คที่เลือก"
            title="เช็คจ่ายล่วงหน้า — รายการที่เลือก"
            label="Excel"
          />
          <button onClick={bulkRemove} className="btn btn-danger"
            style={{ background: 'var(--bad)', color: '#fff', borderColor: 'var(--bad)' }}>
            <Icon name="trash" size={14} /> ลบที่เลือก
          </button>
        </div>
      )}

      {/* Add/Edit Modal */}
      {edit !== null && (
        <div className="modal-back" onClick={closeEdit}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-hd">
              <span className="modal-title" style={{ fontSize: 16 }}>{edit.id ? 'แก้ไขเช็ค' : 'เพิ่มเช็คใหม่'}</span>
              <button className="btn btn-ghost btn-sm" onClick={closeEdit}><Icon name="x" size={16} /></button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12 }}>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13 }}>
                เลขที่เช็ค
                <input className="input" value={form.checkNo}
                       onChange={e => setForm(f=>({...f, checkNo:e.target.value}))} />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13 }}>
                วันที่เช็ค *
                <input type="date" className="input" value={form.checkDate}
                       onChange={e => setForm(f=>({...f, checkDate:e.target.value}))} />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13, gridColumn:'1/-1' }}>
                ผู้รับเงิน * {payeeOptions.length > 0 && <span style={{ fontSize: 11, color:'var(--ink-400)', fontWeight: 400 }}>· พิมพ์เพื่อค้น หรือเลือกจากรายการ ({payeeOptions.length} ราย)</span>}
                <input className="input" value={form.payee} list="chk-payee-list" autoComplete="off"
                       onChange={e => setForm(f=>({...f, payee:e.target.value}))} />
                <datalist id="chk-payee-list">
                  {payeeOptions.map((p, i) => <option key={i} value={p} />)}
                </datalist>
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13 }}>
                จำนวนเงิน *
                <input type="number" className="input" value={form.amount}
                       onChange={e => setForm(f=>({...f, amount:e.target.value}))} />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13 }}>
                สถานะ
                <select className="input" value={form.status}
                        onChange={e => setForm(f=>({...f, status:e.target.value}))}>
                  {Object.entries(CHECKS_STATUS_META).map(([k,v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13, gridColumn:'1/-1' }}>
                ประเภทเช็ค
                <select className="input" value={form.checkType || ''}
                        onChange={e => setForm(f=>({...f, checkType:e.target.value}))}>
                  <option value="">— เลือกประเภท —</option>
                  {CHECK_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </label>
              {companyBanks.length > 0 && (
                <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13, gridColumn:'1/-1' }}>
                  เลือกจากบัญชีบริษัท <span style={{ fontSize: 11, color:'var(--ink-400)', fontWeight: 400 }}>· เลือกแล้วเติม "ธนาคาร" + "เลขบัญชี" ให้อัตโนมัติ</span>
                  <select className="input" value={form.bankName && form.accountNo ? form.bankName + '|' + form.accountNo : ''}
                          onChange={e => {
                            const v = e.target.value;
                            if (!v) return;
                            const [bn, ac] = v.split('|');
                            setForm(f => ({ ...f, bankName: bn || '', accountNo: ac || '' }));
                          }}>
                    <option value="">— เลือกบัญชี —</option>
                    {companyBanks.map((b, i) => (
                      <option key={i} value={b.bankName + '|' + b.accountNo}>
                        {b.bankName}{b.accountNo ? ' · ' + b.accountNo : ''}{b.nick ? ' (' + b.nick + ')' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13 }}>
                ธนาคาร
                <input className="input" value={form.bankName} list="chk-bank-list" autoComplete="off"
                       onChange={e => setForm(f=>({...f, bankName:e.target.value}))} />
                <datalist id="chk-bank-list">
                  {Array.from(new Set([...companyBanks.map(b => b.bankName).filter(Boolean), ...COMMON_TH_BANKS]))
                    .map((b, i) => <option key={i} value={b} />)}
                </datalist>
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13 }}>
                เลขบัญชี
                <input className="input" value={form.accountNo} list="chk-ac-list" autoComplete="off"
                       onChange={e => setForm(f=>({...f, accountNo:e.target.value}))} />
                <datalist id="chk-ac-list">
                  {companyBanks.filter(b => b.accountNo).map((b, i) => (
                    <option key={i} value={b.accountNo}>{b.bankName}{b.nick ? ' (' + b.nick + ')' : ''}</option>
                  ))}
                </datalist>
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13 }}>
                เลขที่สัญญาเงินกู้ / PO
                <input className="input" value={form.referenceNo} placeholder="เช่น LN-2569-001 หรือ PO-XXX"
                       onChange={e => setForm(f=>({...f, referenceNo:e.target.value}))} />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13 }}>
                โครงการ
                <input className="input" value={form.linkedProjectCode}
                       onChange={e => setForm(f=>({...f, linkedProjectCode:e.target.value}))} />
              </label>
              <label style={{ display:'flex', flexDirection:'column', gap: 4, fontSize: 13, gridColumn:'1/-1' }}>
                หมายเหตุเพิ่มเติม <span style={{ fontSize: 11, color:'var(--ink-400)', fontWeight: 400 }}>(ถ้ามี)</span>
                <input className="input" value={form.note} placeholder="ระบุรายละเอียดเพิ่มเติม"
                       onChange={e => setForm(f=>({...f, note:e.target.value}))} />
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={closeEdit}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleSave}>บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal — read-only popup for inspecting a check */}
      {view && (() => {
        const meta = CHECKS_STATUS_META[view.status] || { label: view.status || '—', color:'b-gray' };
        const isOverdue = view.status === 'pending' && view.checkDate < today;
        const isUrgent  = view.status === 'pending' && view.checkDate >= today && view.checkDate <= in7;
        const fld = (label, value, highlight) => (
          <div className="field">
            <label style={{ fontSize: 12, color: 'var(--ink-500)' }}>{label}</label>
            <div style={{
              minHeight: 34, borderRadius: 7, border: '1px solid var(--ink-100)',
              padding: '6px 10px', fontSize: 13, lineHeight: 1.5,
              background: highlight ? 'color-mix(in oklch, var(--bad) 9%, transparent)' : 'var(--ink-25, #f9fafb)',
              color: highlight ? 'var(--bad)' : 'var(--ink-700)',
              fontWeight: highlight ? 700 : 400,
              wordBreak: 'break-word', userSelect: 'text',
            }}>{value || '—'}</div>
          </div>
        );
        return (
          <div className="modal-back" onClick={() => setView(null)}>
            <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
              <div className="modal-hd">
                <span className="modal-title" style={{ fontSize: 16 }}>
                  ข้อมูลเช็ค · {view.checkNo || '—'}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setView(null)}>
                  <Icon name="x" size={16} />
                </button>
              </div>

              {/* Status header banner */}
              <div style={{
                padding: '12px 14px', borderRadius: 10, marginBottom: 14,
                background: isOverdue ? '#fff5f5' : isUrgent ? '#fffbeb' : 'var(--ink-50)',
                border: '1px solid ' + (isOverdue ? '#fed7d7' : isUrgent ? '#fde68a' : 'var(--line)'),
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>สถานะ</div>
                  <div style={{ marginTop: 4 }}>
                    <span className={`badge ${meta.color}`}>{meta.label}</span>
                    {isOverdue && <span style={{ marginLeft: 6, fontSize: 11, color:'#e53e3e', fontWeight:600 }}>⚠ เกินกำหนด</span>}
                    {isUrgent  && <span style={{ marginLeft: 6, fontSize: 11, color:'#dd6b20', fontWeight:600 }}>ใกล้ครบกำหนด</span>}
                  </div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>จำนวนเงิน</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--bad)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(view.amount)} <span style={{ fontSize: 12, color:'var(--ink-500)' }}></span>
                  </div>
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12 }}>
                {fld('เลขที่เช็ค', view.checkNo)}
                {fld('วันที่เช็ค', fmtDate(view.checkDate) || view.checkDate, isOverdue || isUrgent)}
                <div style={{ gridColumn: '1/-1' }}>{fld('ผู้รับเงิน', view.payee)}</div>
                {fld('ธนาคาร', view.bankName)}
                {fld('เลขที่บัญชี', view.accountNo)}
                <div style={{ gridColumn: '1/-1' }}>{fld('ประเภทเช็ค', CHECK_TYPE_LABEL(view.checkType))}</div>
                {fld('เลขที่สัญญาเงินกู้ / PO', view.referenceNo)}
                {fld('โครงการ', view.linkedProjectCode)}
                <div style={{ gridColumn: '1/-1' }}>{fld('หมายเหตุเพิ่มเติม', view.note)}</div>
              </div>

              <div className="modal-foot">
                {userCanDelete && (
                  <button className="btn btn-ghost" style={{ color:'#e53e3e', marginRight:'auto' }}
                          onClick={() => { const id = view.id; setView(null); handleDelete(id); }}>
                    <Icon name="trash" size={14} /> ลบ
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => setView(null)}>ปิด</button>
                <button className="btn btn-primary" onClick={() => { setView(null); openEdit(view); }}>
                  <Icon name="edit" size={14} /> แก้ไข
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
