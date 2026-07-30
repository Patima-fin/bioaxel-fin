/* page_audit_log.jsx — Audit Log viewer (manager-only)
   Reads the `auditLog` sheet via the same gviz CSV fetch as everything else.
   Auto-paginated, filterable by user/entity/action, sortable by timestamp.
*/
'use strict';

const { useState: alState, useEffect: alEffect, useMemo: alMemo } = React;

// ป้าย/สีของแต่ละ action — คีย์ต้องตรงกับค่า `action` จริงในชีต auditLog
//   ค่าจริงที่ backend บันทึก: applyDiff (CRUD รายแถว) · replaceAll (sync เต็มตาราง)
//   · budgetImportMonth / plImportMonth (นำเข้า) — ไม่มี add/update/delete แยก
const AL_ACTION_META = {
  applyDiff:         { label: 'แก้ไขข้อมูล',  color: 'b-amber' },
  replaceAll:        { label: 'Sync',         color: 'b-blue'  },
  writeTable:        { label: 'นำเข้าตาราง',  color: 'b-green' },
  budgetImportMonth: { label: 'นำเข้า Budget', color: 'b-green' },
  plImportMonth:     { label: 'นำเข้า P&L',   color: 'b-green' },
  login:             { label: 'เข้าสู่ระบบ',  color: 'b-blue'  },
  logout:            { label: 'ออกจากระบบ',   color: 'b-gray'  },
  export:            { label: 'Export',       color: 'b-blue'  },
  restore:           { label: 'กู้คืนข้อมูล', color: 'b-amber' },
  // legacy fallbacks (เผื่อชีตเก่า/แหล่งอื่นใช้คำเหล่านี้)
  add:    { label: 'เพิ่ม', color: 'b-green' },
  update: { label: 'แก้ไข', color: 'b-amber' },
  delete: { label: 'ลบ',   color: 'b-red'   },
};

// detail (jsonb) อาจมาเป็น object หรือ string — คืน object หรือ null
function _alDetail(d) {
  if (!d) return null;
  if (typeof d === 'string') { try { return JSON.parse(d); } catch (_) { return null; } }
  return (typeof d === 'object') ? d : null;
}

// แปลชื่อ field (technical) → ไทย · field ที่ไม่รู้จักคืนค่าเดิม (ยังอ่านได้)
const AL_FIELD_LABEL = {
  // ทั่วไป
  amount: 'จำนวนเงิน', balance: 'ยอดคงเหลือ', status: 'สถานะ', note: 'หมายเหตุ', remark: 'หมายเหตุ',
  date: 'วันที่', name: 'ชื่อ', currency: 'สกุลเงิน', category: 'หมวด', type: 'ประเภท',
  // ลูกหนี้ / ใบแจ้งหนี้
  ivNo: 'เลขที่ใบแจ้งหนี้', invoiceNo: 'เลขที่ใบแจ้งหนี้', customerName: 'ลูกค้า', invoiceDate: 'วันที่ใบแจ้งหนี้',
  dueDate: 'วันครบกำหนด', expectedReceiveDate: 'วันคาดรับเงิน', netExpected: 'ยอดคาดรับสุทธิ',
  debtOverride: 'ปรับยอดหนี้ (แก้มือ)', received: 'ยอดรับแล้ว', followUps: 'บันทึกการติดตาม',
  // หนี้ / สินเชื่อ
  contractNo: 'เลขที่สัญญา', borrowerName: 'ผู้กู้/เจ้าหนี้', debtCategory: 'หมวดหนี้', debtGroup: 'กลุ่มหนี้',
  bankName: 'ธนาคาร', principalAmount: 'วงเงิน/เงินต้น', interestRate: 'อัตราดอกเบี้ย',
  receiveDate: 'วันรับเงิน', startDate: 'วันเริ่มสัญญา', maturityDate: 'วันครบกำหนด',
  facilityType: 'ประเภทวงเงิน', projectCode: 'รหัสโครงการ', projectName: 'ชื่อโครงการ',
  closedDate: 'วันปิดสัญญา', closedReason: 'เหตุผลปิดสัญญา',
  // ตารางดอกเบี้ย
  month: 'เดือน', principal: 'เงินต้น', rate: 'อัตรา', days: 'จำนวนวัน', interest: 'ดอกเบี้ย',
  interestOverride: 'ดอกเบี้ย (แก้มือ)', paymentDate: 'วันจ่าย', payments: 'รายการจ่ายดอกเบี้ย',
  // forecast / cashflow (คีย์ตัวใหญ่)
  AMOUNT: 'จำนวนเงิน', DATE: 'วันที่บันทึก', PAYMENT_DATE: 'วันจ่าย/รับ', EXPENSE_TYPE: 'ประเภท',
  STATUS: 'สถานะ', CATEGORY: 'หมวด', Bank_AC: 'บัญชีธนาคาร', NOTE: 'หมายเหตุ', REF_DOC: 'เอกสารอ้างอิง',
  ACTUAL_AMOUNT: 'ยอดจริง', ACTUAL_DATE: 'วันที่จริง',
  // ธนาคาร
  accountNo: 'เลขบัญชี', accountName: 'ชื่อบัญชี', available: 'ยอดใช้ได้', hold: 'ยอดกันไว้ (HOLD)',
};
const alField = (f) => AL_FIELD_LABEL[f] || f;

// ── ชื่อ "ตาราง" ให้ตรงกับชื่อเมนูที่แสดง ──────────────────────────────────
// map: entity (คีย์ตารางข้อมูล) → page key ของเมนู แล้วดึงชื่อจริงจาก WTP_PAGE_LABEL
// (แหล่งความจริงเดียวกับ sidebar/สิทธิ์) → เปลี่ยนชื่อเมนูใน PAGE_GROUPS แล้วที่นี่เปลี่ยนตามเอง
const AL_ENTITY_PAGE = {
  projects: 'projects', invoices: 'invoices', forecastEntries: 'data_forecast',
  bankAccounts: 'data_bank', pvVouchers: 'data_pv', payables: 'data_payable',
  debtLedger: 'debt_ledger', debtEvents: 'debt_ledger', debtMaster: 'debt',
  receipts: 'receipts', checks: 'checks', bankEntries: 'bank_diary', bankTransfers: 'bank_diary',
  cashflowSnapshots: 'daily_balance', followUpsLog: 'iv_report', users: 'users',
  bankReconLines: 'bank_recon', bankReconState: 'bank_recon', bankReconBook: 'bank_recon', bankReconMatch: 'bank_recon',
  stsServiceFee: 'sts_calc', stsPendingCalc: 'sts_workflow', stsCalcResult: 'sts_workflow',
};
// entity ที่ไม่มีหน้าเมนูตรง ๆ → ชื่อไทยอ่านง่าย (สุดท้ายค่อย fallback เป็นคีย์ดิบ)
const AL_ENTITY_FALLBACK = { manualOverrides: 'ค่าปรับแต่ง/แก้มือ (Overrides)', presence: 'สถานะออนไลน์' };
function alEntityLabel(entity) {
  if (!entity) return '—';
  const pageMap = (typeof window !== 'undefined' && window.WTP_PAGE_LABEL) || {};
  const pk = AL_ENTITY_PAGE[entity];
  if (pk && pageMap[pk]) return pageMap[pk];         // ← ชื่อเมนูจริง (auto-follow)
  return AL_ENTITY_FALLBACK[entity] || entity;
}
// ค่าที่โชว์: ตัวเลขล้วน → ใส่ตัวคั่นหลักพัน · ว่าง → "(ว่าง)"
const alVal = (v) => {
  if (v == null || v === '') return '(ว่าง)';
  const s = String(v);
  if (/^-?\d{4,}(\.\d+)?$/.test(s)) { const n = Number(s); if (!isNaN(n)) return n.toLocaleString('en-US'); }
  return s;
};
const AL_ACTION_LABEL = (a) => (AL_ACTION_META[a] && AL_ACTION_META[a].label) || a || '—';

// Normalise a raw row from the auditLog Sheet — Google Sheets may store
// header names with different casing/spelling depending on who created the
// tab. Map common variants to our canonical keys so the UI works either way.
function _norm(r) {
  const get = (...keys) => {
    for (const k of keys) {
      if (r[k] != null && r[k] !== '') return r[k];
    }
    return '';
  };
  return {
    id:           get('id', 'ID', 'Id'),
    timestamp:    get('timestamp', 'Timestamp', 'TIMESTAMP', 'time', 'When', 'datetime', 'Date'),
    user:         get('user', 'User', 'USER', 'username', 'Username'),
    displayName:  get('displayName', 'displayname', 'DisplayName', 'name', 'Name'),
    role:         get('role', 'Role', 'ROLE'),
    entity:       get('entity', 'Entity', 'ENTITY', 'table', 'Table', 'sheet', 'Sheet'),
    action:       get('action', 'Action', 'ACTION', 'op', 'Op'),
    rowsAffected: get('rowsAffected', 'rows', 'Rows', 'count', 'Count', 'RowsAffected'),
    summary:      get('summary', 'Summary', 'SUMMARY', 'description', 'Description', 'note', 'Note'),
    detail:       _alDetail(r.detail != null ? r.detail : r.Detail),
    _raw:         r,
  };
}

function AuditLogPage({ data, toast }) {
  // Fetch directly from sheet (gviz CSV) on mount + manual refresh
  const [rows, setRows] = alState(null);
  const [err, setErr]   = alState(null);
  const [query, setQuery] = alState('');
  const [actionFilter, setActionFilter] = alState('all');
  const [entityFilter, setEntityFilter] = alState('all');
  const [limit, setLimit] = alState(200);   // tail length
  const [sort, setSort]   = alState({ key: 'timestamp', dir: 'desc' });
  const [expanded, setExpanded] = alState(() => new Set());   // id ของแถวที่กางดูการเปลี่ยนแปลง
  const toggleExpand = (id) => setExpanded(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // ค่าใช้สำหรับ sort ต่อคอลัมน์ (date→ms, number→num, อื่นๆ→ตัวพิมพ์เล็ก)
  const sortVal = (r, key) => {
    if (key === 'timestamp')    return new Date(r.timestamp || 0).getTime();
    if (key === 'rowsAffected') return Number(r.rowsAffected) || 0;
    if (key === 'user')         return String(r.displayName || r.user || '').toLowerCase();
    return String(r[key] || '').toLowerCase();
  };
  const toggleSort = (key) => setSort(s =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                  : { key, dir: key === 'timestamp' || key === 'rowsAffected' ? 'desc' : 'asc' });

  const load = () => {
    if (!window.WTPData || !window.WTPData.fetchSheetRows) {
      setErr('Sync ไม่พร้อมใช้งาน — ตรวจสอบ config.js');
      return;
    }
    setErr(null);
    setRows(null);
    window.WTPData.fetchSheetRows('auditLog')
      .then(rs => {
        // Debug: log raw + normalized first row to help diagnose header mismatches
        if (rs && rs.length) {
          console.log('[AuditLog] sheet headers (raw keys of row 0):', Object.keys(rs[0]));
          console.log('[AuditLog] first raw row:', rs[0]);
        }
        // Normalise all rows then sort newest first
        const normed = (rs || []).map(_norm);
        const sorted = normed.slice().sort((a, b) => {
          const ta = new Date(a.timestamp || 0).getTime();
          const tb = new Date(b.timestamp || 0).getTime();
          return tb - ta;
        });
        setRows(sorted);
      })
      .catch(e => setErr(String(e && e.message || e)));
  };

  alEffect(() => { load(); }, []);

  const filtered = alMemo(() => {
    if (!rows) return [];
    let xs = rows;
    if (actionFilter !== 'all') xs = xs.filter(r => r.action === actionFilter);
    if (entityFilter !== 'all') xs = xs.filter(r => r.entity === entityFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      xs = xs.filter(r =>
        (r.user || '').toLowerCase().includes(q) ||
        (r.displayName || '').toLowerCase().includes(q) ||
        (r.entity || '').toLowerCase().includes(q) ||
        alEntityLabel(r.entity).toLowerCase().includes(q) ||
        (r.summary || '').toLowerCase().includes(q));
    }
    xs = xs.slice().sort((a, b) => {
      const va = sortVal(a, sort.key), vb = sortVal(b, sort.key);
      if (va < vb) return sort.dir === 'asc' ? -1 : 1;
      if (va > vb) return sort.dir === 'asc' ?  1 : -1;
      return 0;
    });
    return xs.slice(0, limit);
  }, [rows, query, actionFilter, entityFilter, limit, sort]);

  const entityOptions = alMemo(() => {
    if (!rows) return [];
    return [...new Set(rows.map(r => r.entity).filter(Boolean))].sort();
  }, [rows]);

  // แท็บกรอง action สร้างจากค่าจริงในข้อมูล (เรียงตามจำนวนมาก→น้อย) → ทุกแท็บกดแล้วเจอเสมอ
  const actionOptions = alMemo(() => {
    if (!rows) return [];
    const c = {};
    rows.forEach(r => { if (r.action) c[r.action] = (c[r.action] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a]).map(a => ({ key: a, count: c[a] }));
  }, [rows]);

  const totals = alMemo(() => {
    if (!rows) return { all: 0, byAction: {}, byUser: {} };
    const byAction = {}, byUser = {};
    rows.forEach(r => {
      byAction[r.action] = (byAction[r.action] || 0) + 1;
      const u = r.displayName || r.user || 'unknown';
      byUser[u] = (byUser[u] || 0) + 1;
    });
    return { all: rows.length, byAction, byUser };
  }, [rows]);

  const fmtTimestamp = (t) => {
    if (!t) return '—';
    const d = new Date(t);
    if (isNaN(d)) return String(t);
    return d.toLocaleString('th-TH-u-ca-gregory', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  };

  // Manager-only guard
  const canSee = window.WTPAuth ? window.WTPAuth.can('canManageUsers') : true;
  if (!canSee) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 600, color: 'var(--ink-600)' }}>ต้องเป็น Manager เท่านั้นถึงดูได้</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">Audit Log · บันทึกการแก้ไขข้อมูล</h1>
          <div className="page-sub">
            ดูประวัติว่าใคร-แก้-อะไร-เมื่อไหร่ · ดึงจากตาราง <code>audit_log</code> (Supabase)
            {rows && <> · ทั้งหมด {rows.length} รายการ</>}
          </div>
        </div>
        <div className="page-head-r">
          <button className="btn btn-ghost" onClick={load}>
            <Icon name="refresh" size={14} /> รีเฟรช
          </button>
          {rows && (
            <ExportButton
              rows={filtered}
              columns={[
                { key: 'timestamp',    label: 'เวลา' },
                { key: 'user',         label: 'username' },
                { key: 'displayName',  label: 'ผู้ใช้' },
                { key: 'role',         label: 'role' },
                { key: 'action',       label: 'การกระทำ' },
                { key: 'entity',       label: 'ตาราง', fmt: (v) => alEntityLabel(v) },
                { key: 'rowsAffected', label: 'จำนวนแถว', type: 'number' },
                { key: 'summary',      label: 'รายละเอียด' },
                { key: 'detail',       label: 'ค่าเดิม → ค่าใหม่', fmt: (d) => {
                    if (!d || !Array.isArray(d.changes)) return '';
                    return d.changes.map(c => {
                      if (c.op === 'add') {
                        const av = (c.fields || []).map(f => `${alField(f.f)}: ${alVal(f.to)}`).join('; ');
                        return `[เพิ่ม] ${c.label || c.id}${av ? ' — ' + av : ''}`;
                      }
                      if (c.op === 'delete') return `[ลบ] ${c.label || c.id}`;
                      const fs = (c.fields || []).map(f => `${alField(f.f)}: ${alVal(f.from)} → ${alVal(f.to)}`).join('; ');
                      return `[แก้] ${c.label || c.id} — ${fs}`;
                    }).join('  |  ');
                  } },
              ]}
              filename="audit_log"
              sheetName="Audit Log"
              title="Audit Log · บันทึกการแก้ไขข้อมูล"
            />
          )}
          <PrintButton />
        </div>
      </div>

      {/* KPIs */}
      {rows && (
        <div className="grid grid-4 anim-stagger" style={{ marginBottom: 16 }}>
          <KpiTile animate={false} label="บันทึกทั้งหมด" value={totals.all}              accent="var(--brand-500)"      icon="invoice" unit=" รายการ" digits={0} />
          <KpiTile animate={false} label="แก้ไขข้อมูล"    value={totals.byAction.applyDiff || 0} accent="oklch(60% 0.18 55)"    icon="edit"    unit=" ครั้ง" digits={0} />
          <KpiTile animate={false} label="นำเข้า"         value={(totals.byAction.budgetImportMonth || 0) + (totals.byAction.plImportMonth || 0)} accent="var(--good)" icon="plus" unit=" ครั้ง" digits={0} />
          <KpiTile animate={false} label="Sync rounds"   value={totals.byAction.replaceAll || 0}    accent="oklch(52% 0.16 220)"   icon="refresh" unit=" ครั้ง" digits={0} />
        </div>
      )}

      {/* Filter bar */}
      <div className="card" style={{ padding: 10, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="tabnav" style={{ flex: 'none' }}>
          <button className={actionFilter === 'all' ? 'active' : ''} onClick={() => setActionFilter('all')}>
            ทั้งหมด{rows ? ` (${rows.length})` : ''}
          </button>
          {actionOptions.map(o => (
            <button key={o.key} className={actionFilter === o.key ? 'active' : ''} onClick={() => setActionFilter(o.key)}>
              {AL_ACTION_LABEL(o.key)} ({o.count})
            </button>
          ))}
        </div>
        <select className="input" value={entityFilter} onChange={e => setEntityFilter(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
          <option value="all">ทุกตาราง</option>
          {entityOptions.map(e => <option key={e} value={e}>{alEntityLabel(e)}</option>)}
        </select>
        <input className="input"
          placeholder="ค้นหา user / entity / summary…"
          value={query} onChange={e => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200, maxWidth: 360 }} />
        <select className="input" value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ width: 'auto' }}>
          <option value={100}>100 รายการล่าสุด</option>
          <option value={200}>200 รายการล่าสุด</option>
          <option value={500}>500 รายการล่าสุด</option>
          <option value={2000}>2000 รายการล่าสุด</option>
        </select>
      </div>

      {/* Status & error */}
      {!rows && !err && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }} className="muted">
          กำลังโหลด…
        </div>
      )}
      {err && (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--bad)' }}>
          ดึงข้อมูลล้มเหลว: {err}
          <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 8 }}>
            ต้องเข้าสู่ระบบด้วยสิทธิ์ manager (RLS อ่านตาราง <code>audit_log</code> เฉพาะ manager)
          </div>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 600, color: 'var(--ink-600)' }}>ยังไม่มีบันทึก audit log</div>
          <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 8 }}>
            ระบบจะเริ่มบันทึกเมื่อมีการแก้ไขข้อมูล (หลัง deploy Apps Script ใหม่)
          </div>
        </div>
      )}

      {/* Table */}
      {rows && rows.length > 0 && (
        <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'min(560px, calc(100vh - 400px))' }}>
            <table className="tbl" style={{ minWidth: 1000 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' }}>
                <tr>
                  {[
                    { k: 'timestamp',    label: 'เวลา',       w: 160 },
                    { k: 'user',         label: 'ผู้ใช้',      w: 140 },
                    { k: 'role',         label: 'Role',       w: 80 },
                    { k: 'action',       label: 'การกระทำ',   w: 100 },
                    { k: 'entity',       label: 'ตาราง',      w: 130 },
                    { k: 'rowsAffected', label: 'จำนวนแถว',   w: 78,  align: 'right' },
                    { k: 'summary',      label: 'รายละเอียด (แก้ไขรายการไหน)' },
                  ].map(c => (
                    <th key={c.k}
                        onClick={() => toggleSort(c.k)}
                        style={{ width: c.w, textAlign: c.align || 'left', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                        title="คลิกเพื่อเรียงลำดับ">
                      {c.label}
                      <span style={{ marginLeft: 4, color: sort.key === c.k ? 'var(--brand-600)' : 'var(--ink-300)', fontSize: 10 }}>
                        {sort.key === c.k ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 36, textAlign: 'center' }} className="muted">ไม่พบบันทึกที่ตรงเงื่อนไข</td></tr>
                )}
                {filtered.map((r, i) => {
                  const a = AL_ACTION_META[r.action] || { label: r.action || '—', color: 'b-gray' };
                  let detailText = r.summary
                    || `${a.label} ${r.entity || ''}${r.rowsAffected ? ` · ${r.rowsAffected} แถว` : ''}`.trim()
                    || '—';
                  // ตัด prefix "entity:" ที่ซ้ำกับคอลัมน์ "ตาราง" (คอลัมน์นั้นโชว์ชื่อเมนูแล้ว)
                  if (r.entity && detailText.indexOf(r.entity + ':') === 0) detailText = detailText.slice(r.entity.length + 1).trim();
                  const changes = (r.detail && Array.isArray(r.detail.changes)) ? r.detail.changes : null;
                  const counts = r.detail && r.detail.counts;
                  const nChanged = counts ? (counts.add || 0) + (counts.update || 0) + (counts.delete || 0) : null;
                  const rowKey = r.id != null && r.id !== '' ? String(r.id) : `i${i}`;
                  const isOpen = expanded.has(rowKey);
                  const hasDetail = changes && changes.length > 0;
                  return (
                    <React.Fragment key={rowKey}>
                    <tr style={{ verticalAlign: 'top', cursor: hasDetail ? 'pointer' : 'default' }}
                        onClick={hasDetail ? () => toggleExpand(rowKey) : undefined}
                        title={hasDetail ? 'คลิกเพื่อดู/ซ่อนการเปลี่ยนแปลง' : undefined}>
                      <td style={{ fontSize: 11, fontFamily: 'ui-monospace', color: 'var(--ink-600)', whiteSpace: 'nowrap' }}>
                        {fmtTimestamp(r.timestamp)}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <div style={{ fontWeight: 600 }}>{r.displayName || r.user || '—'}</div>
                        {r.displayName && r.user && (
                          <div style={{ fontSize: 10, color: 'var(--ink-400)', fontFamily: 'ui-monospace' }}>@{r.user}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {r.role ? <Badge kind="b-gray" dot={false}>{r.role}</Badge> : <span className="muted">—</span>}
                      </td>
                      <td>
                        <Badge kind={a.color} dot={false}>{a.label}</Badge>
                      </td>
                      <td style={{ fontSize: 12, fontWeight: 500, color: 'var(--brand-700)' }} title={r.entity || ''}>
                        {alEntityLabel(r.entity)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {nChanged != null ? nChanged : (r.rowsAffected != null && r.rowsAffected !== '' ? r.rowsAffected : '—')}
                      </td>
                      <td style={{ fontSize: 11.5, color: 'var(--ink-600)', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.45 }}
                          title={detailText}>
                        {detailText}
                        {hasDetail && (
                          <button className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); toggleExpand(rowKey); }}
                            style={{ marginLeft: 8, padding: '1px 8px', fontSize: 11, borderRadius: 6, whiteSpace: 'nowrap' }}>
                            {isOpen ? '▲ ซ่อน' : `▼ ดูค่าเดิม→ค่าใหม่ (${changes.length})`}
                          </button>
                        )}
                        {r.detail && r.detail.truncated && (
                          <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--ink-400)' }}>· แสดงบางส่วน</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && hasDetail && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--brand-50, #f4f8f5)', padding: '8px 14px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {changes.map((c, ci) => {
                              const flds = c.fields || [];
                              return (
                              <div key={ci} style={{ fontSize: 11.5, borderLeft: '3px solid var(--ink-200, #d5dbe3)', paddingLeft: 10 }}>
                                {c.op === 'delete' && (
                                  <div style={{ color: 'var(--bad, #c0392b)', fontWeight: 600 }}>－ ลบรายการ{c.label ? `: ${c.label}` : ''}</div>
                                )}
                                {c.op === 'add' && (
                                  <div style={{ lineHeight: 1.6 }}>
                                    <span style={{ color: 'var(--good, #1f8a4c)', fontWeight: 600 }}>＋ เพิ่มรายการ{c.label ? `: ${c.label}` : ''}</span>
                                    {flds.length > 0 && (
                                      <span style={{ fontFamily: 'ui-monospace', fontSize: 11, color: 'var(--ink-600)' }}>
                                        {'  ·  '}
                                        {flds.map((f, fi) => (
                                          <span key={fi} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
                                            <span style={{ color: 'var(--ink-500)' }}>{alField(f.f)}</span>{': '}
                                            <span style={{ fontWeight: 600, color: 'var(--ink-700)' }}>{alVal(f.to)}</span>
                                          </span>
                                        ))}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {c.op === 'update' && flds.length === 1 && (
                                  <div style={{ fontFamily: 'ui-monospace', fontSize: 11.5, lineHeight: 1.5 }}>
                                    <span style={{ fontWeight: 600, color: 'var(--ink-700)' }}>✎ {c.label || c.id}</span>
                                    <span style={{ color: 'var(--ink-300)' }}>{'  ·  '}</span>
                                    <span style={{ color: 'var(--ink-500)' }}>{alField(flds[0].f)}</span>{': '}
                                    <span style={{ color: 'var(--bad, #c0392b)', textDecoration: 'line-through' }}>{alVal(flds[0].from)}</span>
                                    {' → '}
                                    <span style={{ color: 'var(--good, #1f8a4c)', fontWeight: 600 }}>{alVal(flds[0].to)}</span>
                                  </div>
                                )}
                                {c.op === 'update' && flds.length !== 1 && (
                                  <div>
                                    <div style={{ fontWeight: 600, color: 'var(--ink-700)', marginBottom: 2 }}>✎ {c.label || c.id}</div>
                                    {flds.map((f, fi) => (
                                      <div key={fi} style={{ fontFamily: 'ui-monospace', fontSize: 11, lineHeight: 1.6 }}>
                                        <span style={{ color: 'var(--ink-500)' }}>{alField(f.f)}</span>{' : '}
                                        <span style={{ color: 'var(--bad, #c0392b)', textDecoration: 'line-through' }}>{alVal(f.from)}</span>
                                        {' → '}
                                        <span style={{ color: 'var(--good, #1f8a4c)', fontWeight: 600 }}>{alVal(f.to)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );})}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AuditLogPage });
