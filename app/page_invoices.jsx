// Invoices page — ใหม่ตาม spec
// - Columns: Job no | invno | invdate | ชื่อโครงการ | Balance | ผู้รับโอนสิทธิ | ภาระหนี้ | สุทธิ | สถานะ
// - 4 statuses: pending_inspection / tracking / issue / paid
// - Follow-up log (รอบติดตาม) + ผู้ติดต่อ + เบอร์โทร + คาดรับเงิน + รับจริง (วันที่/จำนวน/บัญชี)
// - Paste RAW_IV_OUTSTANDING (TSV/JSON) → ระบบหาว่าใบไหนใหม่ → import เฉพาะใหม่
// - Sort + Filter + Search

const { useState: ivState, useMemo: ivMemo, useRef: ivRef, useEffect: ivEffect } = React;

// ── normalizeJobNo: ตัด productType suffix ออกจาก jobNo ──────────────────────
// INS049-PL  → { jobNo: 'INS049',  productType: 'PL'    }
// SV-878-PL  → { jobNo: 'SV-878',  productType: 'PL'    }
// TWC007-PDH → { jobNo: 'TWC007',  productType: 'PDH'   }
// AW097-STIIS→ { jobNo: 'AW097',   productType: 'STIIS' }
// PP064      → { jobNo: 'PP064',   productType: ''      }  (ไม่มี suffix → ไม่แตะ)
function normalizeJobNo(raw) {
  if (raw == null || raw === '') return { jobNo: '', productType: '' };
  const s = String(raw).trim();   // jobNo อาจเป็นตัวเลข (เช่น 12345) → coerce ก่อน .trim กัน crash
  // match: <anything>-<2-6 uppercase letters> at end
  const m = s.match(/^(.+)-([A-Z]{2,6})$/);
  if (m) return { jobNo: m[1], productType: m[2] };
  return { jobNo: s, productType: '' };
}

// ── helper: resolve assignee/debt — Override บน IV ทับ lookup จากโครงการ ───
// ผูกข้อมูลภาระหนี้: ปกติดึงจาก projects[].debt + projects[].assignee
// แต่ admin override ราย IV ได้ผ่าน iv.assigneeOverride / iv.debtOverride
function resolveAssignee(iv, f) {
  const ov = iv && iv.assigneeOverride;
  if (ov != null && String(ov).trim() !== '') return String(ov);
  // skip placeholder dashes so debtLedger fallback can win
  const a1 = f && f.assignee;
  if (a1 && a1 !== '—' && a1 !== '-') return a1;
  const a2 = f && f['ผู้รับโอนสิทธิ์'];
  if (a2 && a2 !== '—' && a2 !== '-') return a2;
  return '—';
}
function resolveDebt(iv, f) {
  const ov = iv && iv.debtOverride;
  // ถือว่า override ใช้ได้เฉพาะค่ามากกว่า 0 (0 = ไม่มี override → fall back ใช้ค่าโครงการ)
  if (ov != null && String(ov).trim() !== '' && Number(ov) > 0) return Number(ov);
  return Number((f && (f.debt ?? f['ภาระหนี้'])) || 0);
}
function ivHasAssigneeOverride(iv) {
  const ov = iv && iv.assigneeOverride;
  return ov != null && String(ov).trim() !== '';
}
function ivHasDebtOverride(iv) {
  const ov = iv && iv.debtOverride;
  // ถือว่า 0 = "ไม่มี override" (ไม่ใช่ override เป็นศูนย์)
  // user ที่กรอก 0 = "ไม่ต้องการ override" → fall back ไปใช้ค่าจากโครงการ
  if (ov == null || String(ov).trim() === '') return false;
  return Number(ov) > 0;
}
// expose globally so page_daily/page_warroom_p1 can reuse without duplication
Object.assign(window, { resolveAssignee, resolveDebt, ivHasAssigneeOverride, ivHasDebtOverride });

// ── ivJoinRow / ivBuildRows — ใบแจ้งหนี้ + โครงการ + ภาระหนี้ → แถวที่มี netExpected ──
// ★ นี่คือ "จุดเดียว" ที่คำนวณ netExpected (balance × 106/107 − ภาระหนี้)
//   หน้าลูกหนี้คงค้าง (ตารางนี้) และพาเนล "📥 คาดรับเงินเข้า" ในหน้า Bank Daily
//   (page_bank_diary.jsx → BDArPanel) เรียกตัวเดียวกัน → ยอดตรงกันทุกบาทเสมอ
//   ⚠️ ห้ามคัดลอกสูตรไปคำนวณซ้ำที่อื่น (จะเพี้ยนทันทีที่ normalizeJobNo/resolveDebt เปลี่ยน)
const IV_VALID_STATUS = new Set(['pending_inspection', 'tracking', 'issue', 'paid']);
// map รหัสสถานะแบบเก่า/ทางเลือก → สถานะ canonical 4 ตัว
const IV_STATUS_ALIAS = { pending: 'tracking', '': 'pending_inspection' };
function ivJoinRow(iv, projectByCode, financeByCode) {
  // ── normalize jobNo: ตัด productType suffix ออก ───────────────────────────
  const norm = normalizeJobNo(iv.jobNo);
  const cleanJobNo    = norm.jobNo;
  const inferredPType = norm.productType;

  const p = (projectByCode || {})[cleanJobNo] || (projectByCode || {})[iv.contractRef] || {};
  const f = (financeByCode || {})[cleanJobNo] || (financeByCode || {})[iv.contractRef] || {};
  const balance  = Number(iv.balance) || 0;
  const debt     = resolveDebt(iv, f);
  const assignee = resolveAssignee(iv, f);
  const debtIsOverride     = ivHasDebtOverride(iv);
  const assigneeIsOverride = ivHasAssigneeOverride(iv);
  const rawStatus = (iv.status || '').toString().trim();
  const aliased   = IV_STATUS_ALIAS[rawStatus] != null ? IV_STATUS_ALIAS[rawStatus] : rawStatus;
  const status    = IV_VALID_STATUS.has(aliased) ? aliased : 'pending_inspection';
  // invType: 'P' = ใบแจ้งหนี้โครงการ (default), 'O' = ใบแจ้งหนี้อื่นๆ
  const rawIvType = (iv.invType || iv.invtype || 'P').toString().trim().toUpperCase();
  const invType   = rawIvType === 'O' ? 'O' : 'P';
  // customer: cloud sheet ใช้ customerName + customerCode (รองรับชื่อเก่าด้วย)
  const customerName = (iv.customerName || iv.customer || iv.Customer || iv.cust_name || '').toString().trim();
  const customerCode = (iv.customerCode || iv.cust_code || '').toString().trim();
  return {
    ...iv,
    jobNo:       cleanJobNo,
    productType: iv.productType || inferredPType || '',
    status,
    invType,
    balance,
    customer: customerName,
    customerName,
    customerCode,
    projectName: p['พื้นที่'] || p.name || iv.projectName || '—',
    assignee,
    assigneeIsOverride,
    debt,
    debtIsOverride,
    // คาดรับสุทธิ = balance หลังหัก WHT 1% (balance × 106/107) − ภาระหนี้
    // ใช้สูตรเดียวกับ popup detail (InvoiceDetailModal) เพื่อให้ตรงกันทั้งระบบ
    netExpected: balance * 106 / 107 - debt,
  };
}
function ivBuildRows(data) {
  const d  = data || {};
  const lk = (window.WTPData && typeof WTPData.buildLookups === 'function')
    ? WTPData.buildLookups(d) : { projectByCode: {}, financeByCode: {} };
  return (d.invoices || []).map(iv => ivJoinRow(iv, lk.projectByCode, lk.financeByCode));
}
Object.assign(window, { ivJoinRow, ivBuildRows });

// ── helper: ค่าที่ใช้แสดงใน filter dropdown สำหรับแต่ละ column ──────────────
function ivColDisplayVal(colKey, iv) {
  switch (colKey) {
    case 'status':          return WTPData.IV_STATUS_META[iv.status]?.label || iv.status || '—';
    case 'invoiceDate':     return fmtDate(iv.invoiceDate) || '—';
    case 'expectedReceive': return fmtDate(iv.expectedReceive) || '—';
    default: {
      const v = iv[colKey];
      return (v == null || v === '' || v === '—') ? '—' : String(v);
    }
  }
}

// ── Dropdown portal (fixed-position เพื่อข้าม overflow ของตาราง) ─────────────
function IvColFilterDropdown({ btnRef, colKey, allRows, active, onApply, onClose }) {
  const [search, setSearch] = ivState('');
  const [pos, setPos]       = ivState(null);
  const [hoverVal, setHoverVal] = ivState(null);
  const selfRef             = ivRef(null);

  // unique values + count
  const allVals = ivMemo(() => {
    const map = new Map();
    allRows.forEach(iv => {
      const v = ivColDisplayVal(colKey, iv);
      map.set(v, (map.get(v) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => {
      if (a[0] === '—') return 1; if (b[0] === '—') return -1;
      return a[0].localeCompare(b[0], 'th');
    });
  }, [allRows, colKey]);
  const allKeys = ivMemo(() => allVals.map(([v]) => v), [allVals]);

  // draft selection: null = ทั้งหมด, Set = เฉพาะที่เลือก (รองรับ Set ว่าง)
  const [draft, setDraft] = ivState(() => (active && active.size ? new Set(active) : null));
  const draftSet = draft == null ? new Set(allKeys) : draft;
  const isAll = draft == null || draft.size >= allKeys.length;

  // commit draft → parent (อ่านค่าล่าสุดผ่าน ref กัน stale closure)
  const latest = ivRef({});
  latest.current = { draft, allKeys, onApply, onClose };
  const commit = () => {
    const { draft, allKeys, onApply, onClose } = latest.current;
    onApply(!draft || draft.size === 0 || draft.size >= allKeys.length ? null : draft);
    onClose();
  };

  // คำนวณตำแหน่งจาก button
  ivEffect(() => {
    const calc = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 290) });
    };
    calc();
    window.addEventListener('scroll', calc, true);
    window.addEventListener('resize', calc);
    return () => { window.removeEventListener('scroll', calc, true); window.removeEventListener('resize', calc); };
  }, []);

  // ปิดเมื่อคลิกข้างนอก (commit draft)
  ivEffect(() => {
    const h = (e) => {
      if (selfRef.current && !selfRef.current.contains(e.target) &&
          btnRef.current  && !btnRef.current.contains(e.target)) commit();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const q = search.trim().toLowerCase();
  const visibleVals = q ? allVals.filter(([v]) => v.toLowerCase().includes(q)) : allVals;
  const visKeys = visibleVals.map(([v]) => v);
  const isChecked = (v) => draftSet.has(v);

  const toggleVal = (val) => {
    const next = new Set(draftSet);
    if (next.has(val)) next.delete(val); else next.add(val);
    setDraft(next);
  };
  const onlyVal = (val) => { onApply(allKeys.length <= 1 ? null : new Set([val])); onClose(); };

  const allVisChecked = visKeys.length > 0 && visKeys.every(v => draftSet.has(v));
  const toggleSelectAll = () => {
    if (q) {
      const next = new Set(draftSet);
      if (allVisChecked) visKeys.forEach(v => next.delete(v));
      else visKeys.forEach(v => next.add(v));
      setDraft(next);
    } else {
      setDraft(isAll ? new Set() : null);
    }
  };
  const clear = () => { setDraft(null); onApply(null); onClose(); };

  if (!pos) return null;
  const headChecked = q ? allVisChecked : isAll;
  const headLabel = q ? '(เลือกผลค้นหาทั้งหมด)' : '(เลือกทั้งหมด)';

  const dropdown = (
    <div ref={selfRef} onClick={e => e.stopPropagation()} style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 99999,
      background: 'var(--surface, #fff)', border: '1.5px solid var(--ink-200, #dde3ee)',
      borderRadius: 10, boxShadow: '0 10px 40px rgba(0,0,0,0.18)',
      minWidth: 230, maxWidth: 300, fontSize: 12.5,
    }}>
      {/* ช่องค้นหาใน dropdown */}
      <div style={{ padding: '8px 10px 6px' }}>
        <input autoFocus className="input"
          style={{ fontSize: 12, padding: '4px 8px', width: '100%', boxSizing: 'border-box' }}
          placeholder="ค้นหาใน dropdown..." value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && commit()} />
      </div>

      {/* เลือกทั้งหมด / เลือกผลค้นหา */}
      <div style={{ borderTop: '1px solid var(--ink-100)', borderBottom: '1px solid var(--ink-100)' }}>
        <div onClick={toggleSelectAll} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer',
          background: headChecked ? 'color-mix(in oklch,var(--brand-500) 8%,transparent)' : '',
        }}>
          <input type="checkbox" checked={headChecked} readOnly tabIndex={-1}
            style={{ width: 14, height: 14, pointerEvents: 'none', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--ink-700)', flex: 1 }}>{headLabel}</span>
          <span style={{ color: 'var(--ink-400)', fontSize: 11 }}>{q ? visibleVals.length : allRows.length}</span>
        </div>
      </div>

      {/* รายการค่า */}
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {visibleVals.length === 0 && (
          <div style={{ padding: '10px 12px', color: 'var(--ink-400)' }}>ไม่พบค่าที่ตรงกัน</div>
        )}
        {visibleVals.map(([val, count]) => {
          const checked = isChecked(val);
          const hovered = hoverVal === val;
          return (
            <div key={val}
              onClick={() => toggleVal(val)}
              onMouseEnter={() => setHoverVal(val)}
              onMouseLeave={() => setHoverVal(h => h === val ? null : h)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 12px', cursor: 'pointer',
                borderBottom: '1px solid var(--ink-50)',
                background: hovered ? 'var(--ink-50)' : (checked && !isAll ? 'color-mix(in oklch,var(--brand-500) 5%,transparent)' : ''),
              }}>
              <input type="checkbox" checked={checked} readOnly tabIndex={-1}
                style={{ width: 14, height: 14, pointerEvents: 'none', flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
              {hovered ? (
                <button onClick={(e) => { e.stopPropagation(); onlyVal(val); }}
                  title="กรองเฉพาะค่านี้ค่าเดียว"
                  style={{
                    flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--brand-700)',
                    background: 'color-mix(in oklch,var(--brand-500) 14%,transparent)',
                    border: 'none', borderRadius: 4, padding: '1px 7px', cursor: 'pointer',
                  }}>เฉพาะนี้</button>
              ) : (
                <span style={{ flexShrink: 0, color: 'var(--ink-400)', fontSize: 11 }}>{count}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--ink-100)', padding: '6px 10px', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <button className="btn btn-ghost btn-sm"
          style={{ fontSize: 11, color: 'var(--bad)', padding: '2px 8px' }}
          onClick={clear}>
          ล้างตัวกรอง
        </button>
        <button className="btn btn-sm"
          style={{ fontSize: 11, padding: '2px 10px', background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 5 }}
          onClick={commit}>
          ✓ ตกลง
        </button>
      </div>
    </div>
  );

  return ReactDOM.createPortal(dropdown, document.body);
}

// ── Column header: sort + filter icon ────────────────────────────────────────
function IvColHeader({ label, sortKey, sort, sortToggle, align = 'center', width,
                       colKey, colFilters, setColFilters, openCol, setOpenCol, allRows }) {
  const btnRef    = ivRef(null);
  const active    = colFilters[colKey];
  const isActive  = active && active.size > 0;
  const isOpen    = openCol === colKey;
  const sortOn    = sort.key === sortKey;

  const applyFilter = (vals) => setColFilters(prev => {
    const next = { ...prev };
    if (!vals) delete next[colKey]; else next[colKey] = vals;
    return next;
  });

  return (
    <th style={{ width, textAlign: align, userSelect: 'none', position: 'relative' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        width: '100%', justifyContent: align === 'right' ? 'flex-end' : 'center',
      }}>
        {/* Sort label */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
          onClick={() => sortToggle(sortKey)}>
          {label}
          <span style={{ opacity: sortOn ? 1 : 0.25, fontSize: 9, display: 'inline-flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ color: sortOn && sort.dir === 'asc' ? 'var(--brand-600)' : 'inherit' }}>▲</span>
            <span style={{ color: sortOn && sort.dir === 'desc' ? 'var(--brand-600)' : 'inherit', marginTop: -2 }}>▼</span>
          </span>
        </span>

        {/* Filter button */}
        <button ref={btnRef}
          onClick={(e) => { e.stopPropagation(); setOpenCol(isOpen ? null : colKey); }}
          title={isActive ? `กรองอยู่ ${active.size} ค่า — คลิกแก้ไข` : 'กรองคอลัมน์'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            background: isActive ? 'var(--brand-500)' : 'transparent',
            color: isActive ? '#fff' : isOpen ? 'var(--brand-500)' : 'var(--ink-350,#aab)',
            border: isActive ? 'none' : `1px solid ${isOpen ? 'var(--brand-300)' : 'transparent'}`,
            borderRadius: 4, padding: '1px 3px', cursor: 'pointer',
            fontSize: 10, lineHeight: 1, flexShrink: 0,
            transition: 'background 120ms, color 120ms',
          }}
          onMouseEnter={e => { if (!isActive) { e.currentTarget.style.color = 'var(--brand-500)'; e.currentTarget.style.borderColor = 'var(--brand-200)'; }}}
          onMouseLeave={e => { if (!isActive) { e.currentTarget.style.color = isOpen ? 'var(--brand-500)' : 'var(--ink-350,#aab)'; e.currentTarget.style.borderColor = isOpen ? 'var(--brand-300)' : 'transparent'; }}}>
          {/* funnel icon */}
          <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
            <path d="M1 1.5h8L6.2 5v3.5l-2.4-1V5L1 1.5z"/>
          </svg>
          {isActive && <span style={{ fontSize: 9, fontWeight: 700 }}>{active.size}</span>}
        </button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <IvColFilterDropdown
          btnRef={btnRef} colKey={colKey} allRows={allRows} active={active}
          onApply={applyFilter} onClose={() => setOpenCol(null)}
        />
      )}
    </th>
  );
}

function InvoicesPage({ data, setData, toast }) {
  const [filter, setFilter] = ivState('all');
  const [query, setQuery] = ivState('');
  const [detail, setDetail] = ivState(null);
  const [showImport, setShowImport] = ivState(false);
  const [payModal, setPayModal] = ivState(null);
  const [sugOpen, setSugOpen] = ivState(false);
  const searchBoxRef = ivRef(null);
  const [colFilters, setColFilters] = ivState({});   // { colKey: Set<displayVal> }
  const [openCol, setOpenCol]       = ivState(null); // colKey ของ dropdown ที่เปิดอยู่
  const [fullscreen, setFullscreen] = ivState(false); // ขยายตารางเต็มจอ
  const [showDiag, setShowDiag]     = ivState(false); // diagnostic panel
  const [bulkMode, setBulkMode]     = ivState(false); // โหมดติ๊กเลือกหลายใบ (เพื่อลบ)
  const [selected, setSelected]     = ivState(() => new Set()); // id ใบที่ติ๊กไว้

  const canEditPage   = window.WTPAuth ? window.WTPAuth.can('canEdit')   : true;
  const canDeletePage = window.WTPAuth ? window.WTPAuth.can('canDelete') : true;

  const { projectByCode, financeByCode } = ivMemo(() => WTPData.buildLookups(data), [data.projects, data.debtLedger]);

  // ── Auto-rebuild followUpsLog when invoices change ─────────────────────
  // CRITICAL: คำนวณ expected ใน setData updater (ไม่ใช่ closure) เพื่อใช้
  // d.invoices ปัจจุบัน — กันบั๊ก race condition ทำให้ followUpsLog ถูก override
  // ด้วย snapshot เก่าตอน server data update มาระหว่าง effect run กับ setData fire
  ivEffect(() => {
    if (!data.invoices || !data.invoices.length) return;
    if (!WTPData.rebuildFollowUpsLog) return;
    // Quick check: rebuild จำเป็นไหม — เทียบด้วย JSON เพราะ append-only log
    // อาจมี archived entries ทำให้ .length ต่างกันปกติ (ไม่ใช่สัญญาณต้อง sync)
    const closureMerged = WTPData.rebuildFollowUpsLog(data.invoices, null, data.followUpsLog || []);
    if (JSON.stringify(closureMerged) === JSON.stringify(data.followUpsLog || [])) return;
    let updatedData;
    setData(d => {
      // คำนวณใหม่จาก d (latest state) ไม่ใช่ closure — pass d.followUpsLog เพื่อ append-only
      const merged = WTPData.rebuildFollowUpsLog(d.invoices, null, d.followUpsLog || []);
      if (JSON.stringify(merged) === JSON.stringify(d.followUpsLog || [])) return d;
      updatedData = { ...d, followUpsLog: merged };
      return updatedData;
    });
    if (updatedData && WTPData.forceSyncNow) {
      setTimeout(() => WTPData.forceSyncNow(updatedData), 0);
    }
  }, [data.invoices]);

  // (auto-backfill paid IV → receipt ถูกย้ายไปใน app.jsx เพื่อให้ทำงาน
  //  regardless ของหน้าที่ user เปิดอยู่ — Warroom/Daily ก็เห็น backfill)

  // Joined rows: invoice + project name + finance (assignee, debt)
  //   ★ ผ่าน ivJoinRow (module-level) — สูตร netExpected อยู่ที่เดียว หน้า Bank Daily ยืมไปใช้
  const rows = ivMemo(
    () => data.invoices.map(iv => ivJoinRow(iv, projectByCode, financeByCode)),
    [data.invoices, projectByCode, financeByCode]
  );

  // match function: ค้นหาทุก column ที่อ่านได้
  const matchQuery = (iv, q) => {
    if (!q) return true;
    const fields = [
      iv.ivNo, iv.jobNo, iv.projectName, iv.contactName, iv.contactPhone,
      iv.remark, iv.customer, iv.customerName, iv.customerCode, iv.productType, iv.assignee, iv.contractRef,
      iv.invoiceDate, iv.expectedReceive,
      iv.balance != null ? String(iv.balance) : '',
      iv.debt    != null ? String(iv.debt)    : '',
      iv.netExpected != null ? String(iv.netExpected) : '',
      WTPData.IV_STATUS_META[iv.status]?.label || '',
    ];
    return fields.some(v => (v || '').toString().toLowerCase().includes(q));
  };

  // ── Tab classification helper ─────────────────────────────────────────────
  // กลุ่ม "ลูกหนี้อื่นๆ" = non-paid AND invType==='O'
  // กลุ่ม status (tracking/pending_inspection/issue) จะไม่นับ invType=='O' (ไม่ทับซ้อน)
  const matchTab = (iv, tab) => {
    if (tab === 'all') return true;
    if (tab === 'paid')        return iv.status === 'paid';
    if (tab === 'outstanding') return iv.status !== 'paid';
    if (tab === 'other')       return iv.status !== 'paid' && iv.invType === 'O';
    // status sub-tabs: exclude invType==='O'
    return iv.status === tab && iv.invType !== 'O';
  };

  const filtered = ivMemo(() => {
    let xs = rows.filter(iv => matchTab(iv, filter));
    if (query.trim()) {
      const q = query.toLowerCase();
      xs = xs.filter(iv => matchQuery(iv, q));
    }
    for (const [key, vals] of Object.entries(colFilters)) {
      if (vals && vals.size > 0) {
        xs = xs.filter(iv => vals.has(ivColDisplayVal(key, iv)));
      }
    }
    return xs;
  }, [rows, filter, query, colFilters]);

  // suggestions สำหรับ dropdown (สูงสุด 8 รายการ ค้นข้าม filter)
  const suggestions = ivMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return rows.filter(iv => matchQuery(iv, q)).slice(0, 8);
  }, [rows, query]);

  // ปิด suggestions เมื่อคลิกนอก search box
  ivEffect(() => {
    if (!sugOpen) return;
    const handler = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setSugOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sugOpen]);

  // highlight ส่วนที่ตรงกับคำค้นใน text
  const highlight = (text, q) => {
    if (!q || !text) return text || '';
    const s = String(text);
    const i = s.toLowerCase().indexOf(q);
    if (i < 0) return s;
    return (
      <>{s.slice(0, i)}<mark style={{ background: 'oklch(95% 0.12 95)', color: 'inherit', padding: 0, borderRadius: 2 }}>{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>
    );
  };

  const { sorted, sort, toggle } = useSortable(filtered, 'invoiceDate', 'desc');

  const counts = {
    all:                rows.length,
    paid:               rows.filter(r => matchTab(r, 'paid')).length,
    outstanding:        rows.filter(r => matchTab(r, 'outstanding')).length,
    tracking:           rows.filter(r => matchTab(r, 'tracking')).length,
    pending_inspection: rows.filter(r => matchTab(r, 'pending_inspection')).length,
    issue:              rows.filter(r => matchTab(r, 'issue')).length,
    other:              rows.filter(r => matchTab(r, 'other')).length,
  };
  const sums = {
    balance:    rows.reduce((s, r) => s + (Number(r.balance) || 0), 0),
    debt:       rows.reduce((s, r) => s + (Number(r.debt) || 0), 0),
    net:        rows.reduce((s, r) => s + (Number(r.netExpected) || 0), 0),
    pendingNet: rows.filter(r => r.status !== 'paid').reduce((s, r) => s + (Number(r.netExpected) || 0), 0),
  };

  const save = (iv) => {
    // Capture the freshly-updated data inside the setData updater so we can
    // pass it directly to forceSyncNow without depending on localStorage
    // being synced (race condition: localStorage save happens via useEffect
    // which is async; relying on it caused followUps to vanish on refresh)
    let updatedData;
    setData(d => {
      const newInvoices = iv.id
        ? d.invoices.map(x => x.id === iv.id ? iv : x)
        : [{ ...iv, id: WTPData.newId() }, ...d.invoices];
      // If IV was marked paid → ensure a corresponding receipt row exists
      // (otherwise Warroom Section 01 wouldn't count it since it reads from receipts)
      const newReceipts = WTPData.ensureReceiptForPaidInvoice
        ? WTPData.ensureReceiptForPaidInvoice(d.receipts || [], iv)
        : (d.receipts || []);
      // Mirror the embedded followUps arrays into the flat followUpsLog sheet
      const user = (() => { try { return JSON.parse(localStorage.getItem('bio-session') || 'null'); } catch(_) { return null; } })();
      const newLog = WTPData.rebuildFollowUpsLog
        ? WTPData.rebuildFollowUpsLog(newInvoices, user && user.username, d.followUpsLog || [])
        : (d.followUpsLog || []);
      updatedData = {
        ...d,
        invoices:     newInvoices,
        receipts:     newReceipts,
        followUpsLog: newLog,
      };
      return updatedData;
    });
    setDetail(prev => prev && prev.id === iv.id ? iv : prev);
    toast('บันทึกใบแจ้งหนี้แล้ว');
    // Immediately persist + push with the captured fresh data
    if (updatedData) {
      try { WTPData.save(updatedData); } catch (_) {}
      if (WTPData.forceSyncNow) {
        setTimeout(() => WTPData.forceSyncNow(updatedData), 0);
      }
    }
  };
  // ── ลบใบแจ้งหนี้ (รองรับหลายใบ) ────────────────────────────────────────────
  // ⚠️ data_supabase.pushDiff มีเกราะกัน mass-delete: ถ้า diff สั่งลบ > max(8, 50%)
  //    ของทั้งตาราง มันจะ "ปัด deleteIds ทิ้งเงียบ ๆ" → แถวค้างบน server แล้วเด้งกลับ
  //    มาตอน sync รอบถัดไป. ลบเยอะจริงตามเจตนาผู้ใช้ → ต้องยิง forceDeleteRows ช่วย.
  const removeInvoices = (ids, opts) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(x => x != null && x !== '');
    if (!idList.length) return;
    const idSet = new Set(idList.map(String));
    const victims = (data.invoices || []).filter(iv => idSet.has(String(iv.id)));
    const paidCount = victims.filter(iv => iv.status === 'paid').length;
    if (!(opts && opts.skipConfirm)) {
      const lines = [
        idList.length === 1 ? 'ยืนยันการลบใบแจ้งหนี้นี้?' : `ยืนยันการลบใบแจ้งหนี้ ${idList.length} ใบ?`,
      ];
      if (paidCount) lines.push(`\n⚠️ มีใบที่ "รับเงินแล้ว" ${paidCount} ใบ — ใบเสร็จรับเงิน (receipts) ที่ผูกไว้จะยังอยู่ ยอดรับเงินในรายงานจึงไม่เปลี่ยน`);
      lines.push('\nลบแล้วกู้คืนไม่ได้');
      if (!confirm(lines.join('\n'))) return;
    }
    let updatedData;
    setData(d => {
      updatedData = { ...d, invoices: (d.invoices || []).filter(iv => !idSet.has(String(iv.id))) };
      return updatedData;
    });
    setDetail(prev => (prev && idSet.has(String(prev.id))) ? null : prev);
    setSelected(prev => {
      const next = new Set(prev);
      idSet.forEach(x => next.delete(x));
      idList.forEach(x => next.delete(x));
      return next;
    });
    if (updatedData) {
      try { WTPData.save(updatedData); } catch (_) {}
      if (WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(updatedData), 0);
    }
    // เกราะ mass-delete จะกินคำสั่งลบชุดใหญ่ → ยิงลบตรงซ้ำอีกที (idempotent)
    const total = (data.invoices || []).length;
    if (WTPData.forceDeleteRows && total >= 10 && idList.length > Math.max(8, total * 0.5)) {
      setTimeout(() => { try { WTPData.forceDeleteRows('invoices', idList); } catch (_) {} }, 60);
    }
    toast(idList.length === 1 ? 'ลบใบแจ้งหนี้แล้ว' : `ลบใบแจ้งหนี้แล้ว ${idList.length} ใบ`);
  };
  const remove = (id) => removeInvoices([id]);

  const toggleSelectOne = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const newInvoice = () => setDetail({
    id: null,
    // jobNo ว่างไว้ให้เลือกเอง (เดิม default = โครงการแรกในลิสต์ → ผูกผิดโครงการง่าย)
    // invoiceDate = วันนี้จริง ไม่ใช่ data.meta.asOf (ค่า seed ค้างใน prod)
    ivNo: '', jobNo: '', period: 1,
    invoiceDate: new Date().toISOString().slice(0, 10), balance: 0,
    status: 'pending_inspection', expectedReceive: '',
    contactName: '', contactPhone: '',
    invType: 'P',
    followUps: [], actualReceive: null,
  });

  // Status quick-set on each row (table-level)
  const updateStatus = (iv, newStatus) => {
    if (newStatus === 'paid') {
      // เปิด QuickPayModal แทนบันทึกทันที
      // default amount = balance หลังหัก WHT 1% (งานราชการ)
      // default debtDeduct = ภาระหนี้จาก iv (resolveDebt)
      setPayModal({
        iv,
        draft: {
          date: new Date().toISOString().slice(0, 10),
          amount: (Number(iv.balance) || 0) * 106 / 107,
          bankAccount: '',
          bankFee: 0,
          debtDeduct: Number(iv.debt) || 0,
          otherFee: 0,
        },
      });
      return;
    }
    save({ ...iv, status: newStatus });
  };

  return (
    <div className="page" style={fullscreen ? {
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'var(--bg, #f4f7fb)',
      padding: '10px 14px', overflow: 'auto', maxWidth: 'none', margin: 0,
    } : undefined}>
      {!fullscreen && (
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">ใบแจ้งหนี้คงค้าง</h1>
          <div className="page-sub">RAW_IV_OUTSTANDING · {rows.length} ใบ · ผู้ดูแล: ฝ่ายติดตามรับเงิน</div>
        </div>
        <div className="page-head-r">
          <button className="btn btn-ghost" onClick={() => setFullscreen(true)}
            title="ขยายตารางเต็มจอ — ซ่อนหัวสรุปด้านบน"
            style={{ background: '#ebf8ff', color: '#1e4fbd', border: '1px solid #63b3ed' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
            ขยายเต็มจอ
          </button>
          <ExportButton
            rows={filtered}
            columns={[
              { key: 'jobNo',           label: 'JOB NO.' },
              { key: 'ivNo',            label: 'เลขที่ IV' },
              { key: 'invoiceDate',     label: 'วันที่ออก IV',   type: 'date' },
              { key: 'projectName',     label: 'ชื่อโครงการ' },
              { key: 'balance',         label: 'ยอดค้างชำระ', type: 'number' },
              { key: 'assignee',        label: 'ผู้รับโอนสิทธิ์' },
              { key: 'debt',            label: 'ภาระหนี้',   type: 'number' },
              { key: 'netExpected',     label: 'คาดรับสุทธิ', type: 'number' },
              { key: 'expectedReceive', label: 'วันคาดรับเงิน', type: 'date' },
              { key: 'status',          label: 'สถานะ' },
            ]}
            filename="invoices_outstanding"
            sheetName="ใบแจ้งหนี้"
            title="ใบแจ้งหนี้คงค้าง (IV Outstanding)"
          />
          <PrintButton />
          {canEditPage && (
            <button className="btn btn-primary" onClick={() => setShowImport(true)}
              title="เพิ่มใบแจ้งหนี้ — อัปโหลด/ลากไฟล์ RAW_IV_OUTSTANDING หรือกรอกเองทีละใบ">
              <Icon name="plus" size={14} /> เพิ่มใบแจ้งหนี้
            </button>
          )}
          {canDeletePage && (
            <button className="btn btn-ghost"
              onClick={() => { setBulkMode(m => !m); setSelected(new Set()); }}
              title={bulkMode ? 'ออกจากโหมดเลือก' : 'ติ๊กเลือกหลายใบเพื่อลบ (เช่น ใบที่ยกเลิก/เลิกใช้แล้ว)'}
              style={bulkMode
                ? { background: 'var(--bad)', color: '#fff', border: '1px solid var(--bad)' }
                : { background: '#fff5f5', color: '#c53030', border: '1px solid #fc8181' }}>
              <Icon name="trash" size={14} /> {bulkMode ? 'ออกจากโหมดเลือก' : 'เลือกลบ'}
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => setShowDiag(true)}
            title="ตรวจสอบการเชื่อมโยงข้อมูล project/debt → IV">
            🔍 ตรวจสอบ Lookup
          </button>
        </div>
      </div>
      )}

      {!fullscreen && (
      <div className="grid grid-4 anim-stagger" style={{ marginBottom: 16 }}>
        <KpiTile label="ยอด Balance รวม" value={sums.balance} accent="var(--brand-500)" icon="invoice" />
        <KpiTile label="ภาระหนี้รวม"      value={sums.debt} accent="var(--bad)" icon="arrow_up" />
        <KpiTile label="คาดรับสุทธิ (ค้าง)" value={sums.pendingNet} accent="var(--good)" icon="coin" />
        <KpiTile label="ติดปัญหา"          value={counts.issue} unit=" ใบ" digits={0} accent="oklch(60% 0.22 25)" icon="invoice" />
      </div>
      )}

      {fullscreen && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 12px', marginBottom: 8,
          background: 'linear-gradient(90deg, #ebf8ff, transparent)',
          border: '1px solid #bee3f8', borderRadius: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ color: '#1e4fbd', fontSize: 13 }}>โหมดเต็มจอ · ใบแจ้งหนี้คงค้าง</strong>
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
              ทั้งหมด {rows.length} ใบ · ค้างชำระ {counts.outstanding} · ติดปัญหา {counts.issue}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canDeletePage && (
            <button onClick={() => { setBulkMode(m => !m); setSelected(new Set()); }}
              title={bulkMode ? 'ออกจากโหมดเลือก' : 'ติ๊กเลือกหลายใบเพื่อลบ'}
              style={{
                borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: bulkMode ? 'var(--bad)' : '#fff5f5',
                color: bulkMode ? '#fff' : '#c53030',
                border: `1px solid ${bulkMode ? 'var(--bad)' : '#fc8181'}`,
              }}>
              🗑 {bulkMode ? 'ออกจากโหมดเลือก' : 'เลือกลบ'}
            </button>
          )}
          <button onClick={() => setFullscreen(false)}
            style={{ background: '#1e4fbd', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 4 }}>
              <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
            ออกจากเต็มจอ
          </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {/* Primary groups */}
          <div className="tabnav">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              ทั้งหมด ({counts.all})
            </button>
            <button className={filter === 'paid' ? 'active' : ''}
              onClick={() => setFilter('paid')}
              style={{ color: filter === 'paid' ? undefined : '#276749' }}>
              ✓ ได้รับเงินแล้ว ({counts.paid})
            </button>
            <button className={filter === 'outstanding' ? 'active' : ''}
              onClick={() => setFilter('outstanding')}
              style={{ color: filter === 'outstanding' ? undefined : '#c05621' }}>
              ⏳ ค้างชำระ ({counts.outstanding})
            </button>
          </div>

          {/* Sub-tabs for outstanding (กำลังติดตาม / รอใบตรวจรับ / ติดปัญหา / ลูกหนี้อื่นๆ) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4, paddingLeft: 8, borderLeft: '1px dashed var(--ink-200)' }}>
            <span style={{ fontSize: 11, color: 'var(--ink-400)', marginRight: 2 }}>แยก:</span>
            {[
              { k: 'tracking',           label: 'กำลังติดตาม',   color: '#1e4fbd', bg: '#ebf8ff', bd: '#63b3ed' },
              { k: 'pending_inspection', label: 'รอใบตรวจรับ',   color: '#b45309', bg: '#fffbeb', bd: '#f6ad55' },
              { k: 'issue',              label: 'ติดปัญหา',       color: '#c53030', bg: '#fff5f5', bd: '#fc8181' },
              { k: 'other',              label: 'ลูกหนี้อื่นๆ',   color: '#6b46c1', bg: '#faf5ff', bd: '#b794f4' },
            ].map(s => {
              const active = filter === s.k;
              return (
                <button key={s.k}
                  onClick={() => setFilter(s.k)}
                  style={{
                    fontSize: 11.5, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
                    border: `1.5px solid ${active ? s.bd : 'transparent'}`,
                    background: active ? s.bg : 'transparent',
                    color: active ? s.color : 'var(--ink-500)',
                    fontWeight: active ? 700 : 500,
                    transition: 'background .12s, border-color .12s',
                  }}>
                  {s.label} <span style={{ opacity: .7, fontSize: 10.5 }}>({counts[s.k]})</span>
                </button>
              );
            })}
          </div>
        </div>
        <div ref={searchBoxRef} style={{ position: 'relative', width: 360 }}>
          <div className="tb-search" style={{ width: '100%' }}>
            <Icon name="search" size={14} />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSugOpen(true); }}
              onFocus={() => query.trim() && setSugOpen(true)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSugOpen(false); }}
              placeholder="ค้นหาทุกคอลัมน์ — IV / Job / โครงการ / จังหวัด / ยอดเงิน / สถานะ…"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setSugOpen(false); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-400)', padding: '0 4px', fontSize: 14 }}
                title="ล้างคำค้นหา"
              >×</button>
            )}
          </div>

          {sugOpen && query.trim() && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
              background: 'var(--surface, #fff)', border: '1px solid var(--ink-200, #e2e8f0)',
              borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              maxHeight: 360, overflowY: 'auto',
            }}>
              {suggestions.length === 0 ? (
                <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--ink-400)' }}>
                  ไม่พบรายการที่ตรงกับ "{query}"
                </div>
              ) : (
                <>
                  <div style={{ padding: '6px 12px', fontSize: 10.5, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--ink-100)' }}>
                    ผลที่แนะนำ · {suggestions.length}{rows.filter(iv => matchQuery(iv, query.trim().toLowerCase())).length > suggestions.length ? '+' : ''} จาก {rows.length}
                  </div>
                  {suggestions.map(iv => {
                    const q = query.trim().toLowerCase();
                    const sMeta = WTPData.IV_STATUS_META[iv.status] || { label: iv.status, badge: 'b-gray' };
                    return (
                      <div
                        key={iv.id}
                        onClick={() => { setDetail(iv); setSugOpen(false); }}
                        style={{
                          padding: '8px 12px', cursor: 'pointer',
                          borderBottom: '1px solid var(--ink-50, #f1f5f9)',
                          display: 'flex', alignItems: 'center', gap: 10,
                          transition: 'background 100ms',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--ink-50, #f7fafc)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                      >
                        <div style={{ minWidth: 80 }}>
                          <div style={{ fontFamily: 'ui-monospace', fontWeight: 700, fontSize: 11.5, color: 'var(--brand-700)' }}>
                            {highlight(iv.jobNo, q)}
                          </div>
                          <div style={{ fontFamily: 'ui-monospace', fontSize: 10.5, color: 'var(--ink-500)' }}>
                            {highlight(iv.ivNo, q)}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {highlight(iv.projectName, q)}
                          </div>
                          {(iv.contactName || iv.customer || iv.remark) && (
                            <div style={{ fontSize: 10.5, color: 'var(--ink-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {highlight(iv.contactName || iv.customer || iv.remark, q)}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', minWidth: 90 }}>
                          <div style={{ fontFamily: 'ui-monospace', fontSize: 11.5, fontWeight: 600 }}>
                            {fmtNum(iv.balance, 0)}
                          </div>
                          <Badge kind={sMeta.badge}>{sMeta.label}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── active column filters summary bar ────────────────────────────────── */}
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
            const labelMap = { jobNo:'Job No.', ivNo:'IV No.', invoiceDate:'วันที่ออก IV', projectName:'ชื่อโครงการ', balance:'ยอดค้างชำระ', assignee:'ผู้รับโอนสิทธิ์', debt:'ภาระหนี้', netExpected:'คาดรับสุทธิ', expectedReceive:'วันคาดรับเงิน', status:'สถานะ' };
            const preview = [...vals].slice(0, 2).join(', ') + (vals.size > 2 ? ` +${vals.size - 2}` : '');
            return (
              <span key={key} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'var(--brand-500)', color: '#fff',
                borderRadius: 20, padding: '2px 8px', fontSize: 11,
              }}>
                <strong>{labelMap[key] || key}</strong>: {preview}
                <button onClick={() => setColFilters(p => { const n={...p}; delete n[key]; return n; })}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, marginLeft: 2, fontSize: 13, lineHeight: 1 }}>×</button>
              </span>
            );
          })}
          <button onClick={() => setColFilters({})}
            style={{ background: 'none', border: '1px solid var(--brand-400)', color: 'var(--brand-700)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
            ล้างทั้งหมด
          </button>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-500)', fontSize: 11 }}>
            แสดง {filtered.length} / {rows.length} รายการ
          </span>
        </div>
      )}

      {bulkMode && canDeletePage && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '6px 12px', marginBottom: 8, fontSize: 12,
          background: '#fff5f5', border: '1px solid #fc8181', borderRadius: 8, color: '#c53030',
        }}>
          <strong>🗑 โหมดเลือกลบ</strong>
          <span style={{ color: 'var(--ink-600)' }}>
            คลิกที่แถวเพื่อติ๊ก/ยกเลิก · ติ๊กหัวตารางเพื่อเลือกทั้งหมดที่กรองอยู่ ({sorted.length} ใบ) · แล้วกด "ลบที่เลือก" ด้านล่าง
          </span>
          <button onClick={() => { setBulkMode(false); setSelected(new Set()); }}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #fc8181', color: '#c53030', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontSize: 11.5 }}>
            ออกจากโหมด
          </button>
        </div>
      )}

      <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: fullscreen ? 'calc(100vh - 140px)' : 'min(480px, calc(100vh - 400px))' }}>
        <table className="tbl tbl-compact" style={{ tableLayout: 'fixed', width: '100%', minWidth: fullscreen ? 0 : 940 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' }}>
            <tr>
              {bulkMode && canDeletePage && (
                <th style={{ width: 34, textAlign: 'center', padding: '6px 4px' }}>
                  <input type="checkbox"
                    checked={sorted.length > 0 && sorted.every(r => selected.has(r.id))}
                    ref={el => { if (el) {
                      const some = sorted.some(r => selected.has(r.id));
                      const all  = sorted.length > 0 && sorted.every(r => selected.has(r.id));
                      el.indeterminate = some && !all;
                    } }}
                    onChange={() => {
                      const all = sorted.length > 0 && sorted.every(r => selected.has(r.id));
                      setSelected(all ? new Set() : new Set(sorted.map(r => r.id)));
                    }}
                    title="เลือกทั้งหมดที่แสดงอยู่" style={{ cursor: 'pointer' }} />
                </th>
              )}
              <IvColHeader label="Job No."         sortKey="jobNo"           colKey="jobNo"         sort={sort} sortToggle={toggle} align="center" width={fullscreen ?  82 : 76}  colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
              <IvColHeader label="เลข IV"          sortKey="ivNo"            colKey="ivNo"            sort={sort} sortToggle={toggle} align="center" width={fullscreen ?  98 : 92}  colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
              <IvColHeader label="วันที่ IV"        sortKey="invoiceDate"     colKey="invoiceDate"     sort={sort} sortToggle={toggle} align="center" width={fullscreen ?  92 : 84}  colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
              <IvColHeader label="ชื่อโครงการ"      sortKey="projectName"     colKey="projectName"     sort={sort} sortToggle={toggle} align="center"             colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
              <IvColHeader label="ยอดค้าง"     sortKey="balance"         colKey="balance"         sort={sort} sortToggle={toggle} align="right"  width={fullscreen ? 118 : 108} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
              <IvColHeader label="ผู้รับโอนสิทธิ์"   sortKey="assignee"        colKey="assignee"        sort={sort} sortToggle={toggle} align="center" width={fullscreen ? 110 : 86}  colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
              <IvColHeader label="ภาระหนี้"    sortKey="debt"            colKey="debt"            sort={sort} sortToggle={toggle} align="right"  width={fullscreen ? 108 : 92}  colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
              <IvColHeader label="สุทธิ"         sortKey="netExpected"     colKey="netExpected"     sort={sort} sortToggle={toggle} align="right"  width={fullscreen ? 118 : 104} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
              <IvColHeader label="วันที่"            sortKey="expectedReceive" colKey="expectedReceive" sort={sort} sortToggle={toggle} align="center" width={fullscreen ? 108 : 92}  colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
              <IvColHeader label="สถานะ"            sortKey="status"          colKey="status"          sort={sort} sortToggle={toggle} align="center" width={fullscreen ? 168 : 132} colFilters={colFilters} setColFilters={setColFilters} openCol={openCol} setOpenCol={setOpenCol} allRows={rows} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <tr><td colSpan={11} className="muted" style={{ padding: 36, textAlign: 'center' }}>ไม่พบใบแจ้งหนี้</td></tr>}
            {sorted.map(iv => (
              <tr key={iv.id}
                style={{ cursor: 'pointer', background: (bulkMode && selected.has(iv.id)) ? 'color-mix(in oklch, var(--bad) 9%, transparent)' : undefined }}
                onClick={() => bulkMode ? toggleSelectOne(iv.id) : setDetail(iv)}>
                {bulkMode && canDeletePage && (
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', padding: '6px 4px' }}>
                    <input type="checkbox" checked={selected.has(iv.id)}
                      onChange={() => toggleSelectOne(iv.id)} style={{ cursor: 'pointer' }} />
                  </td>
                )}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span style={{ fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)', fontSize: 12.5 }}>{iv.jobNo}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span style={{ fontFamily: 'ui-monospace', fontWeight: 600, fontSize: 12.5 }}>{iv.ivNo}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(iv.invoiceDate)}</td>
                <td style={{ overflow: 'hidden', maxWidth: 0 }}>
                  {/* Line 1: badges + project name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                    {iv.invType === 'O' && (
                      <span title="ใบแจ้งหนี้อื่นๆ (Other)" style={{ fontSize: 10, fontWeight: 700, background: '#faf5ff', color: '#6b46c1', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.03em', flexShrink: 0, border: '1px solid #d6bcfa' }}>
                        O
                      </span>
                    )}
                    {iv.productType && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--brand-100,#e0f0ff)', color: 'var(--brand-700)', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.03em', flexShrink: 0 }}>
                        {iv.productType}
                      </span>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={iv.projectName}>
                      {iv.projectName}
                    </span>
                  </div>
                  {/* Line 2: customer (เจ้าของโครงการ / ลูกค้า) */}
                  {iv.customer && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, overflow: 'hidden' }}
                      title={`ลูกค้า: ${iv.customer}`}>
                      <span style={{ flexShrink: 0, fontSize: 10, color: '#7c2d12', background: '#fef3c7', borderRadius: 4, padding: '0 5px', fontWeight: 700, border: '1px solid #fde68a' }}>
                        👤
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ink-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 500 }}>
                        {iv.customer}
                      </span>
                    </div>
                  )}
                  {/* Line 3: latest follow-up note (only when present) */}
                  {iv.followUps && iv.followUps.length > 0 && (() => {
                    const last = iv.followUps[iv.followUps.length - 1];
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, overflow: 'hidden' }}
                        title={`ติดตาม ${iv.followUps.length} ครั้ง · ล่าสุด ${fmtDate(last.date)}`}>
                        <span style={{ flexShrink: 0, fontSize: 10, color: '#1e4fbd', background: '#ebf8ff', borderRadius: 4, padding: '0 5px', fontWeight: 700, border: '1px solid #bee3f8' }}>
                          💬 {iv.followUps.length}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontStyle: 'italic' }}>
                          {last.note}
                        </span>
                      </div>
                    );
                  })()}
                </td>
                <td className="num strong" style={{ whiteSpace: 'nowrap' }}>{fmtNum(iv.balance, 0)}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }} title={iv.assigneeIsOverride ? '✏️ Override โดย admin' : '📋 จากข้อมูลโครงการ'}>
                  {iv.assignee && iv.assignee !== '—' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Badge kind="b-violet" dot={false}>{iv.assignee}</Badge>
                      {iv.assigneeIsOverride && <span style={{ fontSize: 10, color: 'var(--brand-600)' }} title="แก้ไขโดย admin">✏️</span>}
                    </span>
                  ) : <span className="muted">ไม่โอน</span>}
                </td>
                <td className="num" style={{ whiteSpace: 'nowrap', color: iv.debt ? 'var(--bad)' : 'inherit' }} title={iv.debtIsOverride ? '✏️ Override โดย admin' : '📋 จากข้อมูลโครงการ'}>
                  {iv.debt ? (
                    <span>
                      {'-' + fmtNum(iv.debt, 0)}
                      {iv.debtIsOverride && <span style={{ fontSize: 10, color: 'var(--brand-600)', marginLeft: 3 }}>✏️</span>}
                    </span>
                  ) : <span className="muted">—</span>}
                </td>
                <td className="num" style={{ whiteSpace: 'nowrap', color: 'var(--good)', fontWeight: 700 }}>{fmtNum(iv.netExpected, 0)}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'center', padding: '4px 6px' }} onClick={(e) => e.stopPropagation()}>
                  {iv.status === 'paid' ? (
                    ivReceivedDate(iv) ? (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--good)', fontWeight: 600 }}>รับจริง</div>
                        <div style={{ color: 'var(--good)', fontWeight: 600 }}>{fmtDate(ivReceivedDate(iv))}</div>
                      </div>
                    ) : <span className="muted">—</span>
                  ) : (
                    <InlineDateCell value={iv.expectedReceive}
                      onChange={(v) => save({ ...iv, expectedReceive: v })} />
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <StatusPill
                    value={iv.status}
                    onChange={(v) => updateStatus(iv, v)}
                    options={Object.entries(WTPData.IV_STATUS_META).map(([k, v]) => ({ value: k, label: v.label, kind: v.badge }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={(bulkMode && canDeletePage) ? 5 : 4}>รวม ({sorted.length} ใบ)</td>
              <td className="num strong">{fmtNum(sorted.reduce((s,r)=>s+(Number(r.balance)||0), 0), 0)}</td>
              <td></td>
              <td className="num" style={{ color: 'var(--bad)' }}>-{fmtNum(sorted.reduce((s,r)=>s+(Number(r.debt)||0), 0), 0)}</td>
              <td className="num" style={{ color: 'var(--good)' }}>{fmtNum(sorted.reduce((s,r)=>s+(Number(r.netExpected)||0), 0), 0)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

      {/* ── แถบลบหลายใบ (ลอยล่างจอ) — โผล่เมื่อติ๊กอย่างน้อย 1 ใบ ─────────────── */}
      {bulkMode && canDeletePage && selected.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--ink-900, #10243f)', color: '#fff', borderRadius: 12,
          padding: '10px 14px 10px 20px', boxShadow: '0 12px 32px rgba(15,36,77,0.28)',
          display: 'flex', alignItems: 'center', gap: 14, zIndex: 950,
          minWidth: 340, maxWidth: 'min(620px, calc(100vw - 32px))',
        }}>
          <div style={{ flex: 1, fontSize: 13 }}>
            เลือกไว้ <strong>{selected.size}</strong> ใบ
            <span style={{ opacity: .7, marginLeft: 8, fontSize: 11.5 }}>
              รวม {fmtNum(rows.filter(r => selected.has(r.id)).reduce((s, r) => s + (Number(r.balance) || 0), 0), 0)} ฿
            </span>
          </div>
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}
            style={{ color: '#fff', background: 'transparent', border: '1px solid rgba(255,255,255,0.25)' }}>ยกเลิก</button>
          <button className="btn" onClick={() => removeInvoices([...selected])}
            style={{ background: 'var(--bad)', color: '#fff', border: '1px solid var(--bad)' }}>
            <Icon name="trash" size={14} /> ลบที่เลือก ({selected.size})
          </button>
        </div>
      )}

      <InvoiceDetailModal
        iv={detail}
        onClose={() => setDetail(null)}
        onSave={save}
        onDelete={canDeletePage ? remove : null}
        bankAccounts={data.bankAccounts}
        projects={data.projects}
        financeByCode={financeByCode}
        projectByCode={projectByCode}
      />

      <QuickPayModal
        open={!!payModal}
        iv={payModal?.iv}
        draft={payModal?.draft}
        bankAccounts={data.bankAccounts}
        onChangeDraft={(patch) => setPayModal(pm => pm ? { ...pm, draft: { ...pm.draft, ...patch } } : pm)}
        onConfirm={(ar) => {
          save({ ...payModal.iv, status: 'paid', actualReceive: ar });
          setPayModal(null);
        }}
        onCancel={() => setPayModal(null)}
      />

      <ImportRawIvModal
        open={showImport}
        onClose={() => setShowImport(false)}
        existing={data.invoices}
        canDelete={canDeletePage}
        onManualAdd={() => { setShowImport(false); newInvoice(); }}
        onImport={({ newRows, patchRows, deleteIds }) => {
          const delIds = (deleteIds || []).filter(x => x != null);
          const delSet = new Set(delIds.map(String));
          if (delIds.length && !confirm(`จะลบใบแจ้งหนี้ ${delIds.length} ใบที่ไม่มีในไฟล์ออกจากระบบ — ลบแล้วกู้คืนไม่ได้ ยืนยันไหม?`)) return;
          let updatedData;
          setData(d => {
            let invoices = d.invoices;
            if (patchRows.length > 0) {
              const patchById = Object.fromEntries(patchRows.map(p => [p.id, p]));
              invoices = invoices.map(iv => patchById[iv.id] ? { ...iv, ...patchById[iv.id] } : iv);
            }
            if (delSet.size > 0) invoices = invoices.filter(iv => !delSet.has(String(iv.id)));
            if (newRows.length > 0) {
              invoices = [...newRows.map(r => ({ ...r, id: WTPData.newId() })), ...invoices];
            }
            updatedData = { ...d, invoices };
            return updatedData;
          });
          if (updatedData) {
            try { WTPData.save(updatedData); } catch (_) {}
            if (WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(updatedData), 0);
          }
          // เกราะ mass-delete (ดู removeInvoices) — ลบชุดใหญ่ต้องยิงตรงช่วย
          const total = (data.invoices || []).length;
          if (WTPData.forceDeleteRows && delIds.length && total >= 10 && delIds.length > Math.max(8, total * 0.5)) {
            setTimeout(() => { try { WTPData.forceDeleteRows('invoices', delIds); } catch (_) {} }, 60);
          }
          setShowImport(false);
          const msgs = [];
          if (newRows.length)   msgs.push(`เพิ่มใบใหม่ ${newRows.length} ใบ`);
          if (patchRows.length) msgs.push(`อัปเดต ${patchRows.length} ใบ`);
          if (delIds.length)    msgs.push(`ลบ ${delIds.length} ใบ`);
          toast(msgs.join(' · ') || 'ไม่มีการเปลี่ยนแปลง');
        }}
      />

      {showDiag && (
        <DiagnosticPanel
          data={data}
          financeByCode={financeByCode}
          projectByCode={projectByCode}
          rows={rows}
          onClose={() => setShowDiag(false)}
        />
      )}
    </div>
  );
}

/* ── IV Report View — รายงานติดตามสถานะใบแจ้งหนี้คงค้าง ──────────────────── */
function IvReportView({ rows, onOpen }) {
  const today        = new Date().toISOString().slice(0, 10);
  const weekEnd      = new Date(Date.now() + (6 - new Date().getDay()) * 86400000).toISOString().slice(0, 10);
  const nextWeekStart= new Date(Date.now() + (7 - new Date().getDay()) * 86400000).toISOString().slice(0, 10);
  const nextWeekEnd  = new Date(Date.now() + (13 - new Date().getDay()) * 86400000).toISOString().slice(0, 10);

  const daysDiff = (d) => d ? Math.round((new Date(d) - new Date(today)) / 86400000) : null;

  // ── Section definitions ──────────────────────────────────────────────────
  // ── พาเลต Daily Revenue Report (brand blue / emerald / amber / purple / red) ──
  // header = พื้น soft + ตัวอักษรเข้ม + ขอบสีกลาง ให้โทนเดียวกับ /#daily
  const sections = [
    {
      key: 'today',
      icon: '✓', label: 'รับเงินแล้ววันนี้',
      grad: 'linear-gradient(135deg, #d1fae5 0%, #6ee7b7 100%)', text: '#065f46', border: '#34d399', // emerald (Daily MTD)
      rows: rows.filter(iv => iv.status === 'paid' && ivReceivedDate(iv) === today),   // ★ ivReceivedDate = actualReceive.date || actualReceiveDate (เดิมอ่านแค่ JSON เลยพลาดใบส่วนใหญ่)
    },
    {
      key: 'this_week',
      icon: '📅', label: 'คาดรับสัปดาห์นี้',
      grad: 'linear-gradient(135deg, #dbeafe 0%, #9ed3ad 100%)', text: '#154524', border: '#63b3ed', // brand blue (Daily YTD)
      rows: rows.filter(iv =>
        iv.status === 'tracking' &&
        iv.expectedReceive >= today && iv.expectedReceive <= weekEnd
      ),
    },
    {
      key: 'next_week',
      icon: '🗓', label: 'คาดรับสัปดาห์หน้า',
      grad: 'linear-gradient(135deg, #ede9fe 0%, #c4b5fd 100%)', text: '#5b21b6', border: '#b794f4', // purple (Daily month forecast)
      rows: rows.filter(iv =>
        iv.status === 'tracking' &&
        iv.expectedReceive >= nextWeekStart && iv.expectedReceive <= nextWeekEnd
      ),
    },
    {
      key: 'tracking',
      icon: '🔍', label: 'กำลังติดตาม (ยังไม่ชัดเจน)',
      grad: 'linear-gradient(135deg, #fef3c7 0%, #fcd34d 100%)', text: '#92400e', border: '#f59e0b', // amber (Daily Today)
      rows: rows.filter(iv =>
        iv.status === 'tracking' &&
        !(iv.expectedReceive && iv.expectedReceive >= today && iv.expectedReceive <= nextWeekEnd) &&
        !(iv.expectedReceive && iv.expectedReceive < today)
      ),
    },
    {
      key: 'pending',
      icon: '📋', label: 'รอใบตรวจรับ',
      grad: 'linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%)', text: '#1e293b', border: '#94a3b8', // neutral slate
      rows: rows.filter(iv => iv.status === 'pending_inspection'),
    },
    // ── 2 รายการล่างสุด: ติดปัญหา → เกินกำหนด ────────────────────
    {
      key: 'issue',
      icon: '⚠', label: 'ติดปัญหา',
      grad: 'linear-gradient(135deg, #fed7aa 0%, #fb923c 100%)', text: '#7c2d12', border: '#f97316', // orange (distinct from overdue)
      rows: rows.filter(iv => iv.status === 'issue'),
    },
    {
      key: 'overdue',
      icon: '🚨', label: 'เกินกำหนดชำระ',
      grad: 'linear-gradient(135deg, #fecaca 0%, #f87171 100%)', text: '#7f1d1d', border: '#fc8181', // red (Daily overdue)
      rows: rows.filter(iv =>
        iv.status === 'tracking' && iv.expectedReceive && iv.expectedReceive < today
      ),
    },
  ];

  // ── Summary KPIs — เน้นเชิงบวก: รับแล้ววันนี้ + คาดรับสัปดาห์นี้/หน้า ────
  const pending     = rows.filter(r => r.status !== 'paid');
  const todayRows   = sections.find(s => s.key === 'today').rows;
  const thisWkRows  = sections.find(s => s.key === 'this_week').rows;
  const nextWkRows  = sections.find(s => s.key === 'next_week').rows;
  const sumBal      = (arr) => arr.reduce((a, r) => a + (Number(r.balance) || 0), 0);
  const sumNet      = (arr) => arr.reduce((a, r) => a + (Number(r.netExpected) || 0), 0);
  const sumActual   = (arr) => arr.reduce((a, r) => a + (Number(r.actualReceive?.amount) || Number(r.netExpected) || 0), 0);

  // ── Row component (detailed) ──────────────────────────────────────────────
  const IvDetailRow = ({ iv, secColor }) => {
    const lastLog  = iv.followUps && iv.followUps.length > 0
      ? iv.followUps[iv.followUps.length - 1] : null;
    const daysSince = lastLog ? -daysDiff(lastLog.date) : null;
    const daysLeft  = daysDiff(iv.expectedReceive);
    const isOverdue = daysLeft !== null && daysLeft < 0 && iv.status === 'tracking';
    const isPaid    = iv.status === 'paid';

    return (
      <div
        onClick={() => onOpen(iv)}
        style={{
          padding: '5px 12px', cursor: 'pointer',
          borderBottom: '1px solid #f0f4f8',
          transition: 'background 120ms',
          display: 'grid',
          gridTemplateColumns: '84px minmax(0, 1fr) 118px 96px',
          gap: '0 8px',
          alignItems: 'center',
          fontSize: 11.5,
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
        onMouseLeave={e => e.currentTarget.style.background = ''}
      >
        {/* Col 1: Job (line 1) + Period chip (line 2) + IV (line 3) — stacked เพื่อความสม่ำเสมอ */}
        <div style={{ lineHeight: 1.2, minWidth: 0 }}>
          <div style={{ fontFamily: 'ui-monospace', fontWeight: 700, fontSize: 12, color: 'var(--brand-700,#2e8b4a)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {iv.jobNo}
          </div>
          {(iv.period === 0 || Number(iv.period) > 0) && (
            <div style={{ marginTop: 2 }}>
              <span style={{
                fontSize: 9.5, fontWeight: 700, background: '#edf2f7', color: '#4a5568',
                borderRadius: 3, padding: '1px 5px', lineHeight: 1.3, whiteSpace: 'nowrap',
                display: 'inline-block',
              }}>
                {iv.period === 0 ? 'งวดเดียว' : `งวดที่ ${iv.period}`}
              </span>
            </div>
          )}
          <div style={{ fontSize: 9.5, color: '#a0aec0', fontFamily: 'ui-monospace', marginTop: 1 }}>{iv.ivNo}</div>
        </div>

        {/* Col 2: Project + contact + last log — all on single (or 2) line(s) */}
        <div style={{ minWidth: 0, lineHeight: 1.25 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            {iv.productType && (
              <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--brand-100,#dceaff)', color: 'var(--brand-700)', borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>
                {iv.productType}
              </span>
            )}
            <span style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }} title={iv.projectName}>
              {iv.projectName}
            </span>
            {iv.contactName && (
              <span style={{ fontSize: 10, color: '#718096', flexShrink: 0 }} title={iv.contactPhone || ''}>
                📞 {iv.contactName}
              </span>
            )}
          </div>
          {lastLog ? (
            <div style={{ fontSize: 11, color: '#2d3748', fontWeight: 500, display: 'flex', gap: 5, alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginTop: 1 }}>
              <span style={{ color: '#718096', fontSize: 10, flexShrink: 0, fontWeight: 600 }}>
                {fmtDate(lastLog.date)}
                {daysSince !== null && daysSince > 0 && (
                  <span style={{ color: daysSince > 7 ? '#c53030' : '#718096', marginLeft: 3, fontWeight: 700 }}>
                    ({daysSince}d)
                  </span>
                )}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#2d3748' }} title={lastLog.note}>
                — {lastLog.note}
              </span>
            </div>
          ) : !isPaid && (
            <div style={{ fontSize: 10.5, color: '#c53030', fontWeight: 600, marginTop: 1 }}>⚠ ยังไม่มีการติดตาม</div>
          )}
        </div>

        {/* Col 3: Amount + assignee */}
        <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
            {fmtNum(iv.balance, 0)}
          </div>
          <div style={{ fontSize: 10, color: '#a0aec0', fontVariantNumeric: 'tabular-nums' }}>
            {iv.netExpected !== iv.balance && <>สุทธิ {fmtNum(iv.netExpected, 0)}</>}
            {iv.assignee && iv.assignee !== '—' && (
              <span style={{ color: '#6b46c1', marginLeft: 5 }}>· {iv.assignee}</span>
            )}
          </div>
        </div>

        {/* Col 4: Date / status */}
        <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
          {isPaid && ivReceivedDate(iv) ? (
            <>
              <div style={{ fontSize: 11, color: '#276749', fontWeight: 600 }}>✓ {fmtDate(ivReceivedDate(iv))}</div>
            </>
          ) : iv.expectedReceive ? (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: isOverdue ? '#e53e3e' : daysLeft !== null && daysLeft <= 7 ? '#dd6b20' : '#2d3748' }}>
                คาดรับ {fmtDate(iv.expectedReceive)}
              </div>
              {daysLeft !== null && (
                <div style={{ fontSize: 10, fontWeight: 600, color: isOverdue ? '#e53e3e' : daysLeft <= 7 ? '#dd6b20' : '#a0aec0' }}>
                  {isOverdue ? `เกิน ${Math.abs(daysLeft)}d` : `อีก ${daysLeft}d`}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#a0aec0' }}>ยังไม่ระบุ</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* ── Summary strip — gradient pills (โทนเดียวกับ Daily Revenue Report) ──── */}
      <div className="iv-summary-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        {[
          {
            label: 'รับแล้ววันนี้', en: "TODAY'S RECEIPTS",
            // check-circle (line icon, โทนเดียวกับ SVG หน้า Daily)
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            ),
            count: todayRows.length,  amt: sumActual(todayRows),
            grad: 'linear-gradient(135deg, #20c997 0%, #16906b 100%)', glow: 'rgba(32,201,151,.28)',
          },
          {
            label: 'คาดรับสัปดาห์นี้', en: 'EXPECTED THIS WEEK',
            // calendar
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            ),
            count: thisWkRows.length, amt: sumBal(thisWkRows),
            grad: 'linear-gradient(135deg, #47a566 0%, #2e8b4a 100%)', glow: 'rgba(46,139,74,.28)',
          },
          {
            label: 'คาดรับสัปดาห์หน้า', en: 'EXPECTED NEXT WEEK',
            // calendar with forward arrow
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
                <polyline points="11 14 14 17 11 20"/>
              </svg>
            ),
            count: nextWkRows.length, amt: sumBal(nextWkRows),
            grad: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)', glow: 'rgba(124,58,237,.28)',
          },
        ].map((k, i) => (
          <div key={i} className="iv-summary-card" style={{
            background: k.grad, borderRadius: 14, padding: '14px 18px', color: 'white',
            position: 'relative', overflow: 'hidden',
            boxShadow: `0 6px 18px ${k.glow}, 0 1px 2px rgba(0,0,0,.04)`,
          }}>
            {/* subtle highlight */}
            <div style={{
              position: 'absolute', top: -40, right: -40, width: 160, height: 160,
              background: 'radial-gradient(circle, rgba(255,255,255,.18) 0%, transparent 65%)',
              pointerEvents: 'none',
            }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, position: 'relative' }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(255,255,255,.18)', display: 'grid', placeItems: 'center',
              }}>{k.icon}</div>
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{k.label}</div>
                <div style={{ fontSize: 9.5, opacity: .78, letterSpacing: '.06em', fontWeight: 600 }}>{k.en}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, position: 'relative' }}>
              <div style={{ fontWeight: 800, fontSize: 23, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {fmtNum(k.amt, 0)} <span style={{ fontSize: 12, fontWeight: 700, opacity: .82 }}></span>
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, background: 'rgba(255,255,255,.22)', padding: '3px 10px', borderRadius: 10 }}>
                {k.count} ใบ
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Sections ───────────────────────────────────────────────────────── */}
      {sections.map(sec => {
        if (sec.rows.length === 0) return null; // ซ่อน section ที่ว่าง
        const secTotal = sec.rows.reduce((s, r) => s + (Number(r.balance) || 0), 0);
        const secNet   = sec.rows.reduce((s, r) => s + (Number(r.netExpected) || 0), 0);
        return (
          <div key={sec.key} className="card iv-section" style={{ padding: 0, overflow: 'hidden', border: `1.5px solid ${sec.border}` }}>
            {/* Section header — พาสเทล bg + ตัวอักษรเข้ม (สดใส อ่านง่าย) */}
            <div className="iv-section-head" style={{
              background: sec.grad, padding: '8px 14px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              color: sec.text, borderBottom: `1px solid ${sec.border}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>{sec.icon}</span>
                <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: '.01em' }}>{sec.label}</span>
                <span style={{ background: 'rgba(255,255,255,.7)', color: sec.text, borderRadius: 11, padding: '1px 9px', fontSize: 11, fontWeight: 800, boxShadow: '0 1px 2px rgba(0,0,0,.06)' }}>
                  {sec.rows.length}
                </span>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ fontWeight: 800 }}>{fmtNum(secTotal, 0)}</span>
                {secNet !== secTotal && (
                  <span style={{ opacity: .8, marginLeft: 6, fontWeight: 600 }}>· สุทธิ {fmtNum(secNet, 0)}</span>
                )}
              </div>
            </div>
            {/* Rows */}
            {sec.rows.map(iv => <IvDetailRow key={iv.id} iv={iv} secColor={sec.color} />)}
          </div>
        );
      })}

      {/* ── All clear ──────────────────────────────────────────────────────── */}
      {pending.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#276749' }}>ไม่มีใบแจ้งหนี้ค้างชำระ</div>
          <div style={{ fontSize: 13, color: '#718096', marginTop: 4 }}>ทุกใบได้รับชำระแล้ว</div>
        </div>
      )}
    </div>
  );
}

/* ── Inline expected-date editor (click to edit, save on blur/change) ─── */
function InlineDateCell({ value, onChange }) {
  const [editing, setEditing] = ivState(false);
  const [draft, setDraft]     = ivState(value || '');
  ivEffect(() => { setDraft(value || ''); }, [value]);
  const todayStr = new Date().toISOString().slice(0, 10);
  const isOverdue = value && value < todayStr;

  if (editing) {
    return (
      <input type="date" autoFocus value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if ((draft || '') !== (value || '')) onChange(draft || ''); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter')  { e.target.blur(); }
          if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); }
        }}
        style={{
          border: '1.5px solid var(--brand-500)', borderRadius: 5,
          padding: '3px 5px', fontSize: 11.5, width: '100%', boxSizing: 'border-box',
          fontFamily: 'inherit', background: '#fff',
        }} />
    );
  }
  return (
    <div onClick={() => setEditing(true)}
      title="คลิกเพื่อแก้ไขวันคาดรับ"
      style={{
        cursor: 'pointer', padding: '3px 4px', borderRadius: 5,
        transition: 'background .12s',
        border: '1px dashed transparent',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklch,var(--brand-500) 8%,transparent)'; e.currentTarget.style.borderColor = 'var(--brand-300, #90cdf4)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = 'transparent'; }}>
      {value ? (
        <>
          <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>คาดรับ</div>
          <div style={{ color: isOverdue ? '#e53e3e' : 'inherit', fontWeight: isOverdue ? 700 : 500 }}>
            {fmtDate(value)}
          </div>
        </>
      ) : (
        <span style={{ color: 'var(--ink-300)', fontSize: 11, fontStyle: 'italic' }}>+ ระบุวัน</span>
      )}
    </div>
  );
}

/* ── Formatted money input — shows xx,xxx.xx when not focused ───────────── */
function IvAmountInput({ value, onChange }) {
  const [focused, setFocused] = ivState(false);
  const [raw, setRaw]         = ivState('');
  const numVal = (value == null || value === '') ? 0 : (typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, '')) || 0);
  const display = numVal === 0 ? '' : fmtNum(numVal, 2);
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        type="text"
        inputMode="decimal"
        value={focused ? raw : display}
        onChange={e => setRaw(e.target.value)}
        onFocus={e => { setFocused(true); setRaw(numVal === 0 ? '' : String(numVal)); setTimeout(() => e.target.select(), 0); }}
        onBlur={() => { const n = parseFloat(String(raw).replace(/,/g, '')) || 0; onChange(n); setFocused(false); }}
        placeholder="0.00"
        style={{ textAlign: 'right', paddingRight: 24, fontFamily: 'ui-monospace', fontWeight: 600 }}
      />
      <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--ink-400)', pointerEvents: 'none' }}></span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Detail modal: landscape split — read-only system data (left) + tracking (right)
// ────────────────────────────────────────────────────────────────────────────
function InvoiceDetailModal({ iv, onClose, onSave, onDelete, bankAccounts, projects, financeByCode, projectByCode }) {
  const [draft, setDraft]                 = ivState(iv);
  const [newLog, setNewLog]               = ivState({ date: new Date().toISOString().slice(0, 10), note: '' });
  const [saveError, setSaveError]         = ivState('');
  const [debtOvFocused, setDebtOvFocused] = ivState(false);
  const [debtOvRaw, setDebtOvRaw]         = ivState('');

  React.useEffect(() => {
    setDraft(iv);
    setNewLog({ date: new Date().toISOString().slice(0, 10), note: '' });
    setSaveError('');
  }, [iv]);

  if (!iv || !draft) return null;

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const setReceive = (patch) => {
    if (patch === null) { setDraft(d => ({ ...d, actualReceive: null })); return; }
    setDraft(d => ({ ...d, actualReceive: { ...(d.actualReceive || {}), ...patch } }));
  };

  const isNew    = !draft.id;
  const isPaid   = draft.status === 'paid';
  const project  = projectByCode[draft.jobNo];
  const finance  = financeByCode[draft.jobNo];
  const debt     = resolveDebt(draft, finance);

  // ── debt override display state — formatted number with commas, blank = use default ─
  const debtOvNum = (draft.debtOverride == null || draft.debtOverride === '')
    ? null : Number(draft.debtOverride);
  const debtOvDisplay = debtOvNum == null ? '' : fmtNum(debtOvNum, 2);
  const debtPlaceholder = Number(finance?.debt ?? finance?.['ภาระหนี้'])
    ? fmtNum(Number(finance?.debt ?? finance?.['ภาระหนี้']), 2)
    : '— จากโครงการ —';
  // ── ภาษีหัก ณ ที่จ่าย 1% (สำหรับงานราชการ) ──────────────────────────────
  // Balance ในระบบรวม VAT 7% แล้ว → หัก WHT 1% ของยอดก่อน VAT
  // สูตร: balance * 106/107 = ยอดหลังหัก WHT
  //       wht = balance - (balance * 106/107) = balance / 107
  const balance       = Number(draft.balance) || 0;
  const wht           = balance / 107;
  const balanceAfterWHT = balance - wht;
  const netExpected   = balanceAfterWHT - debt;
  const canEdit  = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;

  // Computed: เงินเข้าบัญชีสุทธิ — หักทุกรายการ
  const ar       = draft.actualReceive;
  const netCash  = ar ? (ar.amount || 0) - (ar.bankFee || 0) - (ar.debtDeduct || 0) - (ar.otherFee || 0) : 0;

  const addLog = () => {
    if (!newLog.note.trim()) return;
    setDraft(d => ({ ...d, followUps: [...(d.followUps || []), { ...newLog }] }));
    setNewLog(s => ({ ...s, note: '' }));
  };
  const removeLog = (idx) => setDraft(d => ({ ...d, followUps: d.followUps.filter((_, i) => i !== idx) }));

  const handleSave = () => {
    if (isNew && !String(draft.ivNo || '').trim()) {
      setSaveError('กรุณากรอก "เลขที่ IV"');
      return;
    }
    if (isPaid && (!ar || !ar.amount)) {
      setSaveError('กรุณากรอก "จำนวนเงินที่ได้รับจริง" เนื่องจากสถานะเป็น "รับชำระแล้ว"');
      return;
    }
    setSaveError('');
    onSave(draft);
  };

  const s = WTPData.IV_STATUS_META[draft.status] || { label: draft.status || '—', badge: 'b-gray', short: draft.status || '—' };

  // ── Sub-components ──────────────────────────────────────────────────────────
  const ROField = ({ fkey, label, mono, style: fieldStyle }) => {
    const v = draft[fkey];
    return (
      <div className="field" style={fieldStyle}>
        <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>🔒</span>{label}
        </label>
        <div style={{
          height: 32, borderRadius: 7, border: '1px solid var(--ink-100)',
          background: 'var(--ink-50, #f7f8fa)', padding: '0 9px',
          display: 'flex', alignItems: 'center',
          fontFamily: mono ? 'ui-monospace' : undefined,
          fontSize: mono ? 11.5 : 12.5,
          color: !v ? 'var(--ink-300)' : mono ? 'var(--brand-700)' : 'var(--ink-800)',
          fontWeight: mono && v ? 600 : undefined,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          cursor: 'default', userSelect: 'text',
        }} title={v ? String(v) : ''}>{v || '—'}</div>
      </div>
    );
  };

  const RONum = ({ value, label, negative, style: fieldStyle }) => (
    <div className="field" style={fieldStyle}>
      <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: 10, opacity: 0.5 }}>🔒</span>{label}
      </label>
      <div style={{
        height: 32, borderRadius: 7, border: '1px solid var(--ink-100)',
        background: 'var(--ink-50, #f7f8fa)', padding: '0 22px 0 9px', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        fontFamily: 'ui-monospace', fontSize: 12, fontWeight: 600, cursor: 'default',
        color: !value ? 'var(--ink-300)' : negative ? 'var(--bad)' : 'var(--ink-800)',
      }}>
        {!value ? '—' : (negative ? '-' : '') + fmtNum(Math.abs(value), 0)}
        {!!value && <span style={{ position: 'absolute', right: 7, fontSize: 10, color: 'var(--ink-400)', fontWeight: 400 }}></span>}
      </div>
    </div>
  );

  const SectionHdr = ({ label, icon, muted }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
      fontSize: 10.5, fontWeight: 700, letterSpacing: 0.65, textTransform: 'uppercase',
      color: muted ? 'var(--ink-500)' : 'var(--brand-700)',
      paddingBottom: 5, borderBottom: `1px solid ${muted ? 'var(--ink-100)' : 'color-mix(in oklch, var(--brand-500) 20%, transparent)'}`,
    }}>
      <Icon name={icon} size={11} />{label}
    </div>
  );

  return (
    <Modal
      open={!!iv}
      title={isNew ? '＋ เพิ่มใบแจ้งหนี้ทีละใบ' : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Badge kind={s.badge}>{s.label}</Badge>
          <span style={{ fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)', fontSize: 13 }}>{draft.jobNo || '—'}</span>
          {draft.productType && (
            <span title="สินค้า (productType)" style={{
              fontSize: 11, fontWeight: 700, background: 'var(--brand-100,#dceaff)', color: 'var(--brand-700)',
              borderRadius: 4, padding: '2px 7px', letterSpacing: '0.04em', lineHeight: 1.2,
            }}>{draft.productType}</span>
          )}
          <span style={{ color: 'var(--ink-300)', fontSize: 12 }}>·</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-700)' }}>{project?.['พื้นที่'] || project?.name || iv.projectName || '—'}</span>
        </div>
      )}
      maxWidth={920}
      onClose={onClose}
      footer={<>
        {!isNew && onDelete && (
          <button className="btn btn-ghost" onClick={() => onDelete(draft.id)}
            title="ลบใบแจ้งหนี้นี้ออกจากระบบ (เช่น ยกเลิก/ออกใบใหม่แทน)"
            style={{ marginRight: 'auto', color: 'var(--bad)', border: '1px solid color-mix(in oklch, var(--bad) 40%, transparent)' }}>
            <Icon name="trash" size={14} /> ลบใบนี้
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={handleSave}><Icon name="check" size={14} /> บันทึก</button>
      </>}
    >
      {saveError && (
        <div style={{
          background: 'color-mix(in oklch, var(--bad) 8%, transparent)',
          border: '1px solid color-mix(in oklch, var(--bad) 28%, transparent)',
          borderRadius: 8, padding: '7px 13px', marginBottom: 12,
          fontSize: 13, color: 'var(--bad)', fontWeight: 500,
        }}>⚠️ {saveError}</div>
      )}

      {isNew ? (
        /* ── NEW INVOICE: compact single-column editable ─────────────────── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--ink-500)', background: 'var(--ink-50,#f7f8fa)', border: '1px solid var(--ink-100,#e6eaf0)', borderRadius: 7, padding: '6px 10px' }}>
            กรอกอย่างน้อย <strong>เลขที่ IV</strong> + <strong>Balance</strong> · เลือก Job no เพื่อดึงชื่อโครงการ/ภาระหนี้/ผู้รับโอนสิทธิ์ให้อัตโนมัติ
            (ลูกหนี้อื่นๆ ที่ไม่ใช่โครงการ → เลือกประเภท "O" แล้วพิมพ์ชื่อรายการเอง)
          </div>
          <div className="field"><label>Job no</label>
            <select className="select input" value={draft.jobNo || ''} onChange={(e) => set('jobNo', e.target.value)}>
              <option value="">— เลือก —</option>
              {projects.map(p => <option key={p.id} value={p['Contract No.'] || p.code}>{p['Contract No.'] || p.code} · {(p['พื้นที่'] || p.name || '').slice(0,30)}</option>)}
            </select>
          </div>
          <div className="field"><label>เลขที่ IV</label><input className="input" value={draft.ivNo || ''} onChange={(e) => set('ivNo', e.target.value)} placeholder="IV2026-XXX" /></div>
          <div className="field"><label>วันที่ IV</label><input className="input" type="date" value={draft.invoiceDate || ''} onChange={(e) => set('invoiceDate', e.target.value)} /></div>
          <div className="field"><label>งวดที่</label>
            <select className="select input" value={draft.period ?? 1} onChange={(e) => set('period', Number(e.target.value))}>
              <option value={1}>งวดที่ 1</option>
              <option value={2}>งวดที่ 2</option>
              <option value={3}>งวดที่ 3</option>
              <option value={4}>งวดที่ 4</option>
              <option value={5}>งวดที่ 5</option>
              <option value={0}>งวดเดียว</option>
            </select>
          </div>
          <div className="field"><label>Balance (บาท)</label><input className="input" type="number" value={draft.balance || 0} onChange={(e) => set('balance', Number(e.target.value))} /></div>
          <div className="field"><label>สถานะ</label>
            <select className="select input" value={draft.status} onChange={(e) => { set('status', e.target.value); setSaveError(''); }}>
              {Object.entries(WTPData.IV_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="field"><label>ประเภทใบแจ้งหนี้</label>
            <select className="select input" value={draft.invType || 'P'} onChange={(e) => set('invType', e.target.value)}>
              <option value="P">📋 ลูกหนี้จากโครงการ (P)</option>
              <option value="O">🛒 ลูกหนี้อื่นๆ (O)</option>
            </select>
          </div>
          <div className="field"><label>ชื่อผู้ติดต่อ</label><input className="input" value={draft.contactName || ''} onChange={(e) => set('contactName', e.target.value)} placeholder="เช่น คุณสมหญิง" /></div>
          <div className="field"><label>เบอร์โทร</label><input className="input" value={draft.contactPhone || ''} onChange={(e) => set('contactPhone', e.target.value)} placeholder="0XX-XXX-XXXX" /></div>
          <div className="field"><label>วันที่คาดว่าจะได้รับเงิน</label><input className="input" type="date" value={draft.expectedReceive || ''} onChange={(e) => set('expectedReceive', e.target.value)} /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>ชื่อโครงการ / รายการ</label>
            <input className="input" value={draft.projectName || ''} onChange={(e) => set('projectName', e.target.value)}
              placeholder={project ? (project['พื้นที่'] || project.name || '') : 'ว่างไว้ได้ถ้าเลือก Job no แล้ว'} />
          </div>
          <div className="field"><label>ลูกค้า / เจ้าของงาน</label><input className="input" value={draft.customer || ''} onChange={(e) => set('customer', e.target.value)} placeholder="เช่น อบต.บ้านนา" /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>หมายเหตุ</label>
            <input className="input" value={draft.remark || ''} onChange={(e) => set('remark', e.target.value)} placeholder="เช่น ระบบผลิตน้ำประปา-งวดที่ 2 (60%)" />
          </div>
        </div>
      ) : (
        /* ── EXISTING INVOICE: flex layout — each field sized to content ─────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── ข้อมูลจากระบบ — 2 แถว (จัด layout ใหม่ ป้องกัน label wrap) ──── */}
          <div>
            <SectionHdr label={canEdit ? "ข้อมูลจากระบบ — admin override ภาระหนี้ได้" : "ข้อมูลจากระบบ — แก้ไขไม่ได้"} icon="lock" muted />
            {/* แถว 1: วันที่ IV | เลขที่ IV | Balance | WHT | หลังหัก */}
            <div style={{ display: 'grid', gridTemplateColumns: '100px 130px 1fr 140px 168px', gap: '0 10px', marginBottom: 12 }}>
              <ROField fkey="invoiceDate" label="วันที่ IV" />
              <ROField fkey="ivNo"        label="เลขที่ IV"  mono />
              <RONum   value={balance}    label="Balance (รวม VAT)" />
              <div className="field">
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>🔒</span>หัก ณ ที่จ่าย 1%
                </label>
                <div style={{ height: 32, borderRadius: 7, padding: '0 22px 0 9px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', background: 'color-mix(in oklch, var(--bad) 7%, transparent)', border: '1px solid color-mix(in oklch, var(--bad) 22%, transparent)', fontFamily: 'ui-monospace', fontSize: 12.5, fontWeight: 600, color: 'var(--bad)' }}
                  title="WHT 1% บน Balance ก่อน VAT — สูตร: balance ÷ 107">
                  {wht > 0 ? '(' + fmtNum(wht, 2) + ')' : '—'}
                  <span style={{ position: 'absolute', right: 7, fontSize: 10, color: 'var(--ink-400)', fontWeight: 400 }}></span>
                </div>
              </div>
              <div className="field">
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>🔒</span>คงเหลือหลังหัก WHT
                </label>
                <div style={{ height: 32, borderRadius: 7, padding: '0 22px 0 9px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', background: 'color-mix(in oklch, var(--brand-500) 7%, transparent)', border: '1px solid color-mix(in oklch, var(--brand-500) 25%, transparent)', fontFamily: 'ui-monospace', fontSize: 13, fontWeight: 700, color: 'var(--brand-700)' }}
                  title="สูตร: balance × 106 ÷ 107">
                  {fmtNum(balanceAfterWHT, 2)}
                  <span style={{ position: 'absolute', right: 7, fontSize: 10, color: 'var(--ink-400)', fontWeight: 400 }}></span>
                </div>
              </div>
            </div>

            {/* แถว 2: ผู้รับโอนสิทธิ | ภาระหนี้ | คาดรับสุทธิ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 170px 210px', gap: '0 10px' }}>
              {/* ── ผู้รับโอนสิทธิ — Override-able by admin ── */}
              <div className="field">
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  {canEdit ? <span style={{ fontSize: 10, color: 'var(--brand-500)' }}>✏️</span> : <span style={{ fontSize: 10, opacity: 0.5 }}>🔒</span>}
                  ผู้รับโอนสิทธิ
                  {ivHasAssigneeOverride(draft) && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--brand-500)', color: '#fff', borderRadius: 4, padding: '0 4px', marginLeft: 'auto' }}>OVERRIDE</span>}
                </label>
                {canEdit ? (
                  <div style={{ position: 'relative' }}>
                    <input className="input" type="text"
                      placeholder={finance?.assignee || finance?.['ผู้รับโอนสิทธิ์'] || '— จากโครงการ —'}
                      value={draft.assigneeOverride || ''}
                      onChange={(e) => set('assigneeOverride', e.target.value)}
                      title="ว่าง = ใช้ค่าจากโครงการ · กรอก = override"
                      style={{ fontSize: 12.5, height: 32 }} />
                    {(draft.assigneeOverride || '') !== '' && (
                      <button type="button" onClick={() => set('assigneeOverride', '')} title="ล้าง override กลับไปใช้ค่าจากโครงการ"
                        style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-400)', fontSize: 14, padding: '0 4px' }}>×</button>
                    )}
                  </div>
                ) : (
                  <div style={{ height: 32, borderRadius: 7, border: '1px solid var(--ink-100)', background: 'var(--ink-50)', padding: '0 9px', display: 'flex', alignItems: 'center', fontSize: 12.5, color: resolveAssignee(draft, finance) !== '—' ? 'var(--ink-800)' : 'var(--ink-300)', cursor: 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {resolveAssignee(draft, finance) || '—'}
                  </div>
                )}
              </div>
              {/* ── ภาระหนี้ — Override-able by admin ── */}
              <div className="field">
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  {canEdit ? <span style={{ fontSize: 10, color: 'var(--brand-500)' }}>✏️</span> : <span style={{ fontSize: 10, opacity: 0.5 }}>🔒</span>}
                  ภาระหนี้
                  {ivHasDebtOverride(draft) && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--brand-500)', color: '#fff', borderRadius: 4, padding: '0 4px', marginLeft: 'auto' }}>OVERRIDE</span>}
                </label>
                {canEdit ? (
                  <div style={{ position: 'relative' }}>
                    <input className="input" type="text" inputMode="decimal"
                      placeholder={debtPlaceholder}
                      value={debtOvFocused ? debtOvRaw : debtOvDisplay}
                      onChange={(e) => setDebtOvRaw(e.target.value)}
                      onFocus={(e) => {
                        setDebtOvFocused(true);
                        setDebtOvRaw(debtOvNum == null ? '' : String(debtOvNum));
                        setTimeout(() => e.target.select(), 0);
                      }}
                      onBlur={() => {
                        const txt = String(debtOvRaw).trim();
                        if (txt === '') set('debtOverride', null);
                        else set('debtOverride', parseFloat(txt.replace(/,/g, '')) || 0);
                        setDebtOvFocused(false);
                      }}
                      title="ว่าง = ใช้ค่าจากโครงการ · กรอก = override"
                      style={{ fontSize: 12.5, height: 32, textAlign: 'right', paddingRight: 22, fontFamily: 'ui-monospace', fontWeight: 600, color: 'var(--bad)' }} />
                    {draft.debtOverride != null && draft.debtOverride !== '' && (
                      <button type="button" onClick={() => { set('debtOverride', null); setDebtOvRaw(''); }} title="ล้าง override กลับไปใช้ค่าจากโครงการ"
                        style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-400)', fontSize: 14, padding: '0 4px' }}>×</button>
                    )}
                  </div>
                ) : (
                  <RONum value={resolveDebt(draft, finance)} label="" negative />
                )}
              </div>
              <div className="field">
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>🔒</span>คาดรับสุทธิ <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 3 }}>(หลัง WHT − ภาระหนี้)</span>
                </label>
                <div style={{ height: 32, borderRadius: 7, padding: '0 22px 0 9px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', background: 'color-mix(in oklch, var(--good) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--good) 25%, transparent)', fontFamily: 'ui-monospace', fontSize: 13, fontWeight: 700, color: 'var(--good)' }}>
                  {fmtNum(netExpected, 2)}
                  <span style={{ position: 'absolute', right: 7, fontSize: 10, color: 'var(--ink-400)', fontWeight: 400 }}></span>
                </div>
              </div>
            </div>
            {canEdit && (
              <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 6, fontStyle: 'italic' }}>
                💡 ว่าง = ใช้ค่าจากข้อมูลโครงการ · กรอก = override เฉพาะ IV นี้
              </div>
            )}

            {/* แถว 3: หมายเหตุจากระบบ (read-only) */}
            {draft.remark && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>🔒</span>หมายเหตุจากระบบ
                </label>
                <div style={{
                  minHeight: 32, borderRadius: 7, border: '1px solid var(--ink-100)',
                  background: 'var(--ink-50, #f7f8fa)', padding: '7px 9px',
                  fontSize: 12.5, color: 'var(--ink-800)', lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: 'default', userSelect: 'text',
                }} title={draft.remark}>{draft.remark}</div>
              </div>
            )}
          </div>

          {/* ── ข้อมูลติดตาม ───────────────────────────────────────────────── */}
          <div>
            <SectionHdr label="ข้อมูลติดตาม — กรอกได้" icon="edit" />
            <div style={{ display: 'grid', gridTemplateColumns: '95px 195px 170px 125px minmax(110px, 1fr) 125px', gap: '0 10px' }}>
              <div className="field">
                <label style={{ fontSize: 12 }}>งวดที่</label>
                <select className="select input" value={draft.period ?? 1}
                  onChange={(e) => set('period', Number(e.target.value))}
                  style={{ textAlign: 'center', fontWeight: 700, fontSize: 13 }}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                  <option value={0}>งวดเดียว</option>
                </select>
              </div>
              <div className="field">
                <label style={{ fontSize: 12 }}>ประเภทใบแจ้งหนี้</label>
                <select className="select input" value={draft.invType || 'P'}
                  onChange={(e) => set('invType', e.target.value)}>
                  <option value="P">📋 ลูกหนี้จากโครงการ (P)</option>
                  <option value="O">🛒 ลูกหนี้อื่นๆ (O)</option>
                </select>
              </div>
              <div className="field">
                <label style={{ fontSize: 12 }}>สถานะ</label>
                <select className="select input" value={draft.status}
                  onChange={(e) => { set('status', e.target.value); setSaveError(''); }}>
                  {Object.entries(WTPData.IV_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label style={{ fontSize: 12 }}>วันที่คาดรับเงิน</label>
                <input className="input" type="date" value={draft.expectedReceive || ''}
                  onChange={(e) => set('expectedReceive', e.target.value)} />
              </div>
              <div className="field">
                <label style={{ fontSize: 12 }}>ชื่อผู้ติดต่อ</label>
                <input className="input" value={draft.contactName || ''}
                  onChange={(e) => set('contactName', e.target.value)} placeholder="เช่น คุณสมหญิง" />
              </div>
              <div className="field">
                <label style={{ fontSize: 12 }}>เบอร์โทร</label>
                <input className="input" value={draft.contactPhone || ''}
                  onChange={(e) => set('contactPhone', e.target.value)} placeholder="0XX-XXX-XXXX" />
              </div>
            </div>
          </div>

          {/* ── ประวัติติดตาม ──────────────────────────────────────────────── */}
          <div>
            <SectionHdr label={`ประวัติติดตาม · ${draft.followUps?.length || 0} ครั้ง`} icon="phone" />
            <div style={{ border: '1px solid var(--ink-100)', borderRadius: 9, overflow: 'hidden' }}>
              <div style={{ maxHeight: 130, overflowY: 'auto' }}>
                {(!draft.followUps || draft.followUps.length === 0) ? (
                  <div className="muted" style={{ padding: '9px 12px', fontSize: 12 }}>ยังไม่มีการติดตาม</div>
                ) : (
                  <table className="tbl" style={{ fontSize: 11.5 }}>
                    <thead><tr><th style={{ width: 88 }}>วันที่</th><th>หมายเหตุ</th><th style={{ width: 30 }}></th></tr></thead>
                    <tbody>
                      {draft.followUps.map((f, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: 11 }}>{fmtDate(f.date)}</td>
                          <td>{f.note}</td>
                          <td><button className="btn-icon danger" onClick={() => removeLog(i)}><Icon name="trash" size={11} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{ borderTop: '1px solid var(--ink-100)', padding: '7px 8px', background: 'var(--brand-50, #f0f6ff)', display: 'grid', gridTemplateColumns: '135px 1fr 60px', gap: 6, alignItems: 'end' }}>
                <input className="input input-cell" type="date" value={newLog.date} onChange={(e) => setNewLog(s => ({ ...s, date: e.target.value }))} style={{ fontSize: 11.5 }} />
                <input className="input input-cell" placeholder="บันทึกการติดตาม…" value={newLog.note} onChange={(e) => setNewLog(s => ({ ...s, note: e.target.value }))} style={{ fontSize: 11.5 }}
                  onKeyDown={(e) => e.key === 'Enter' && addLog()} />
                <button className="btn btn-primary btn-sm" onClick={addLog} disabled={!newLog.note.trim()} style={{ fontSize: 11 }}>+ บันทึก</button>
              </div>
            </div>
          </div>

          {/* ── การรับเงินจริง ─────────────────────────────────────────────── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <SectionHdr label={`การรับเงินจริง${isPaid ? ' *' : ''}`} icon="coin" />
              {!ar && <button className="btn btn-sm" style={{ fontSize: 11, padding: '2px 10px' }}
                onClick={() => setReceive({ date: new Date().toISOString().slice(0, 10), amount: balanceAfterWHT, bankAccount: '', bankFee: 0, debtDeduct: debt, otherFee: 0 })}>
                + บันทึก
              </button>}
            </div>
            {ar ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* แถว 1: วันที่ + จำนวนที่ได้รับ + ค่าธรรมเนียม + ภาระหนี้ + ค่าอื่นๆ */}
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 1fr', gap: '0 10px' }}>
                  <div className="field"><label style={{ fontSize: 12 }}>วันที่รับจริง</label>
                    <input className="input" type="date" value={ar.date || ''} onChange={(e) => setReceive({ date: e.target.value })} />
                  </div>
                  <div className="field"><label style={{ fontSize: 12 }}>
                    จำนวนที่ได้รับ <span style={{ fontSize: 10, color: 'var(--ink-400)' }}>(หลัง WHT)</span>
                    {isPaid && <span style={{ color: 'var(--bad)', marginLeft: 3 }}>*</span>}
                  </label>
                    <IvAmountInput value={ar.amount} onChange={(n) => { setReceive({ amount: n }); setSaveError(''); }} />
                  </div>
                  <div className="field"><label style={{ fontSize: 12 }}>ค่าธรรมเนียมธนาคาร</label>
                    <IvAmountInput value={ar.bankFee} onChange={(n) => setReceive({ bankFee: n })} />
                  </div>
                  <div className="field"><label style={{ fontSize: 12 }}>ภาระหนี้ <span style={{ fontSize: 10, color: 'var(--ink-400)' }}>(โอนสิทธิ์)</span></label>
                    <IvAmountInput value={ar.debtDeduct ?? 0} onChange={(n) => setReceive({ debtDeduct: n })} />
                  </div>
                  <div className="field"><label style={{ fontSize: 12 }}>ค่าอื่นๆ</label>
                    <IvAmountInput value={ar.otherFee} onChange={(n) => setReceive({ otherFee: n })} />
                  </div>
                </div>
                {/* แถว 2: รายละเอียด + สุทธิ + บัญชี */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 155px 185px', gap: '0 12px' }}>
                  <div className="field"><label style={{ fontSize: 12 }}>รายละเอียดค่าอื่นๆ</label>
                    <input className="input" value={ar.otherFeeNote || ''} onChange={(e) => setReceive({ otherFeeNote: e.target.value })}
                      placeholder="เช่น หักชำระ PS2026-014 / ค่าปรับ / หักเงินกู้…" />
                  </div>
                  <div className="field"><label style={{ fontSize: 12, color: 'var(--ink-600)' }}>เงินเข้าบัญชีสุทธิ <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink-400)' }}>(คำนวณ)</span></label>
                    <div style={{ height: 34, borderRadius: 7, position: 'relative', background: 'color-mix(in oklch, var(--good) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--good) 22%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 24px 0 10px', fontFamily: 'ui-monospace', fontSize: 14, fontWeight: 700, color: netCash < 0 ? 'var(--bad)' : 'var(--good)' }}>
                      {fmtNum(netCash, 0)}
                      <span style={{ position: 'absolute', right: 7, fontSize: 10, color: 'var(--ink-400)', fontWeight: 400 }}></span>
                    </div>
                  </div>
                  <div className="field"><label style={{ fontSize: 12 }}>เข้าบัญชี</label>
                    <select className="select input" value={ar.bankAccount || ''} onChange={(e) => setReceive({ bankAccount: e.target.value })}>
                      <option value="">— เลือกบัญชี —</option>
                      {(bankAccounts || []).map(b => <option key={b.id} value={`${b.BANK_NAME || b.bankName} ${b.Bank_AC || b.accountNo}`}>{b.BANK_NAME || b.bankName} · {b.Bank_AC || b.accountNo}</option>)}
                    </select>
                  </div>
                </div>
                {/* ลบบันทึก */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--bad)' }} onClick={() => setReceive(null)}>
                    <Icon name="trash" size={11} /> ลบบันทึก
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: '9px 12px', fontSize: 12, border: '1px solid var(--ink-100)', borderRadius: 9, color: 'var(--ink-400)' }}>
                {isPaid
                  ? <span style={{ color: 'var(--bad)', fontWeight: 500 }}>⚠️ กรุณาบันทึกการรับเงิน — สถานะ "รับชำระแล้ว"</span>
                  : 'ยังไม่มีบันทึกรับเงิน — กด "+ บันทึก" เมื่อเงินเข้าจริง'}
              </div>
            )}
          </div>

        </div>
      )}
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// QuickPayModal — popup รับข้อมูลชำระเงิน เมื่อเลือก "รับชำระแล้ว" จาก dropdown
// ────────────────────────────────────────────────────────────────────────────
function QuickPayModal({ open, iv, draft, bankAccounts, onChangeDraft, onConfirm, onCancel }) {
  if (!open || !iv || !draft) return null;

  // คำนวณ WHT 1% (งานราชการ): balance × 1/107 = WHT, balance × 106/107 = ยอดหลังหัก
  const bal             = Number(iv.balance) || 0;
  const wht             = bal / 107;
  const balanceAfterWHT = bal - wht;
  const netCash = (draft.amount || 0) - (draft.bankFee || 0) - (draft.debtDeduct || 0) - (draft.otherFee || 0);

  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 540, width: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div>
            <div className="modal-title" style={{ fontSize: 16 }}>บันทึกรับชำระเงิน</div>
            <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 2 }}>
              {iv.ivNo} · {iv.projectName}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 4, fontFamily: 'ui-monospace' }}>
              Balance <strong>{fmtNum(bal, 2)}</strong> − WHT 1% <span style={{ color: 'var(--bad)' }}>({fmtNum(wht, 2)})</span> = หลังหัก <strong style={{ color: 'var(--brand-700)' }}>{fmtNum(balanceAfterWHT, 2)}</strong>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}><Icon name="x" size={16} /></button>
        </div>

        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', padding: '20px 24px' }}>

          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label>วันที่รับจริง</label>
            <input className="input" type="date" value={draft.date || ''} onChange={(e) => onChangeDraft({ date: e.target.value })} />
          </div>

          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label>จำนวนเงินที่ได้รับจริง <span style={{ fontSize: 10, color: 'var(--ink-400)' }}>(หลัง WHT)</span></label>
            <input className="input" type="number" value={draft.amount ?? ''} onChange={(e) => onChangeDraft({ amount: Number(e.target.value) })} style={{ fontFamily: 'ui-monospace', textAlign: 'right' }} />
          </div>

          <div className="field">
            <label>ค่าธรรมเนียมธนาคาร</label>
            <input className="input" type="number" value={draft.bankFee ?? 0} onChange={(e) => onChangeDraft({ bankFee: Number(e.target.value) })} style={{ fontFamily: 'ui-monospace', textAlign: 'right' }} />
          </div>

          <div className="field">
            <label>ภาระหนี้ <span style={{ fontSize: 10, color: 'var(--ink-400)' }}>(โอนสิทธิ์)</span></label>
            <input className="input" type="number" value={draft.debtDeduct ?? 0} onChange={(e) => onChangeDraft({ debtDeduct: Number(e.target.value) })} style={{ fontFamily: 'ui-monospace', textAlign: 'right' }} />
          </div>

          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label>ค่าใช้จ่ายอื่น ๆ</label>
            <input className="input" type="number" value={draft.otherFee ?? 0} onChange={(e) => onChangeDraft({ otherFee: Number(e.target.value) })} style={{ fontFamily: 'ui-monospace', textAlign: 'right' }} />
          </div>

          <div className="field" style={{ gridColumn: '1/-1' }}>
            <label>เข้าบัญชี</label>
            <select className="select input" value={draft.bankAccount || ''} onChange={(e) => onChangeDraft({ bankAccount: e.target.value })}>
              <option value="">— เลือกบัญชี —</option>
              {(bankAccounts || []).map(b => (
                <option key={b.id} value={`${b.BANK_NAME || b.bankName} ${b.Bank_AC || b.accountNo}`}>
                  {b.BANK_NAME || b.bankName} · {b.Bank_AC || b.accountNo}
                </option>
              ))}
            </select>
          </div>

          {/* สรุปยอดสุทธิ */}
          <div style={{ gridColumn: '1/-1', background: 'color-mix(in oklch, var(--good) 9%, transparent)', border: '1px solid color-mix(in oklch, var(--good) 22%, transparent)', borderRadius: 9, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>เงินเข้าบัญชีสุทธิ</span>
            <span style={{ fontFamily: 'ui-monospace', fontWeight: 700, fontSize: 16, color: netCash < 0 ? 'var(--bad)' : 'var(--good)' }}>
              {fmtNum(netCash, 0)}
            </span>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>ยกเลิก</button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm(draft)}
            disabled={!draft.date || !draft.amount}
          >
            <Icon name="check" size={13} /> ยืนยันรับชำระแล้ว
          </button>
        </div>
      </div>
    </div>
  );
}

// Import RAW_IV_OUTSTANDING — paste TSV/CSV → auto-detect new IVs vs existing
// ────────────────────────────────────────────────────────────────────────────
/* ── Diagnostic Panel — show project/debt lookup status for each IV ─────── */
function DiagnosticPanel({ data, financeByCode, projectByCode, rows, onClose }) {
  const [search, setSearch] = ivState('');
  const q = search.trim().toLowerCase();

  // Build per-IV lookup status
  const ivStats = rows.map(iv => {
    const f = financeByCode[iv.jobNo] || financeByCode[iv.contractRef] || {};
    const p = projectByCode[iv.jobNo] || projectByCode[iv.contractRef] || {};
    return {
      jobNo: iv.jobNo,
      ivNo: iv.ivNo,
      projectName: iv.projectName,
      hasProject: !!(p['Contract No.'] || p.code || p['Project No.']),
      hasDebt: (f.debtContracts || []).length > 0,
      debt: iv.debt,
      assignee: iv.assignee,
      debtContracts: f.debtContracts || [],
    };
  });

  const filtered = q ? ivStats.filter(s =>
    s.jobNo.toLowerCase().includes(q) || s.ivNo.toLowerCase().includes(q) ||
    (s.projectName || '').toLowerCase().includes(q)
  ) : ivStats;

  // counts
  const total = ivStats.length;
  const noProject = ivStats.filter(s => !s.hasProject).length;
  const noDebt    = ivStats.filter(s => !s.hasDebt).length;
  const hasBoth   = ivStats.filter(s => s.hasProject && s.hasDebt).length;
  const debtLedgerCount = (data.debtLedger || []).length;

  // Find debtLedger entries that DON'T have matching IV
  const ledgerKeys = new Set();
  Object.keys(financeByCode).forEach(k => {
    if ((financeByCode[k].debtContracts || []).length > 0) ledgerKeys.add(k);
  });
  const ivKeys = new Set(rows.map(r => r.jobNo));
  const orphanLedger = [...ledgerKeys].filter(k => !ivKeys.has(k));

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 1100, width: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div>
            <div className="modal-title" style={{ fontSize: 16 }}>🔍 ตรวจสอบการเชื่อมโยงข้อมูล</div>
            <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 2 }}>
              ดู IV แต่ละใบ ว่าเชื่อมกับ project + debtLedger ได้ครบหรือไม่
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        {/* Summary stats */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          <DiagStat label="IV ทั้งหมด" value={total} color="#2e8b4a" />
          <DiagStat label="🤝 ครบทั้ง 2" value={hasBoth} color="#276749" />
          <DiagStat label="❌ ไม่เจอ project" value={noProject} color="#c53030" />
          <DiagStat label="💰 ไม่เจอ debt" value={noDebt} color="#dd6b20" />
          <DiagStat label="debtLedger" value={debtLedgerCount} color="#6b46c1" />
        </div>

        {/* Orphan debtLedger warning */}
        {orphanLedger.length > 0 && (
          <div style={{ padding: '8px 18px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 12 }}>
            <strong style={{ color: '#b45309' }}>⚠️ พบ {orphanLedger.length} project ใน debtLedger ที่ไม่มี IV ตรงกัน:</strong>
            &nbsp;<span style={{ fontFamily: 'ui-monospace', color: '#b45309' }}>{orphanLedger.slice(0, 12).join(', ')}{orphanLedger.length > 12 ? `, +${orphanLedger.length - 12}` : ''}</span>
            <div style={{ fontSize: 10.5, color: 'var(--ink-500)', marginTop: 2 }}>
              อาจเป็นเพราะ jobNo ของ IV ไม่ตรง projectCode ใน debt — ลองเช็คความสะกด
            </div>
          </div>
        )}

        {/* Search */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
          <input className="input" placeholder="ค้นหา jobNo / IV / โครงการ..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', fontSize: 13 }} />
        </div>

        {/* Table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table className="tbl tbl-compact">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              <tr>
                <th style={{ width: 80 }}>jobNo</th>
                <th style={{ width: 100 }}>เลข IV</th>
                <th>ชื่อโครงการ</th>
                <th style={{ width: 90, textAlign: 'center' }}>project?</th>
                <th style={{ width: 80, textAlign: 'center' }}>debt?</th>
                <th style={{ width: 140 }}>ผู้รับโอนสิทธิ์</th>
                <th style={{ width: 100, textAlign: 'right' }}>ภาระหนี้</th>
                <th>debt contracts</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--ink-400)' }}>ไม่พบรายการ</td></tr>
              )}
              {filtered.slice(0, 200).map((s, i) => (
                <tr key={i}>
                  <td><span style={{ fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)' }}>{s.jobNo}</span></td>
                  <td><span style={{ fontFamily: 'ui-monospace', fontSize: 11.5 }}>{s.ivNo}</span></td>
                  <td style={{ overflow: 'hidden', maxWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.projectName}>{s.projectName}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>{s.hasProject ? '✓' : <span style={{ color: '#c53030' }}>✗</span>}</td>
                  <td style={{ textAlign: 'center' }}>{s.hasDebt ? '✓' : <span style={{ color: '#dd6b20' }}>—</span>}</td>
                  <td style={{ overflow: 'hidden', maxWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.assignee}>
                      {s.assignee && s.assignee !== '—' ? s.assignee : <span className="muted">—</span>}
                    </span>
                  </td>
                  <td className="num" style={{ color: s.debt > 0 ? 'var(--bad)' : 'var(--ink-300)' }}>{s.debt > 0 ? fmtNum(s.debt, 0) : '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--ink-500)' }}>
                    {s.debtContracts.length === 0 ? <span className="muted">—</span> : s.debtContracts.map((c, ci) => (
                      <div key={ci} style={{ borderLeft: '2px solid var(--brand-300)', paddingLeft: 6, marginBottom: 2 }}>
                        <span style={{ fontFamily: 'ui-monospace' }}>{c.debtNo || c['เลขที่สัญญา'] || '?'}</span>
                        {' · '}{c.bankName || c['ธนาคาร'] || '?'}
                        {' · '}<strong>{fmtNum(Number(c.balance) || Number(c.principalAmount) || 0, 0)}</strong>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
              {filtered.length > 200 && (
                <tr><td colSpan={8} style={{ padding: 12, textAlign: 'center', color: 'var(--ink-400)', fontStyle: 'italic' }}>
                  แสดง 200 แถวแรก · ใช้ค้นหาเพื่อกรอง
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

function DiagStat({ label, value, color }) {
  return (
    <div style={{ padding: '8px 10px', background: 'var(--ink-50)', borderRadius: 8, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 10.5, color: 'var(--ink-500)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

/* ─── เครื่องมือเทียบไฟล์นำเข้า ↔ ใบในระบบ ────────────────────────────────────
 * ⚠️ ของเดิมจับ "อัปเดต" ได้แค่ 2 กรณี: ยอด Balance เปลี่ยน หรือฟิลด์เดิม "ว่าง"
 *    แล้วไฟล์มีค่า → แก้ชื่อโครงการ/ลูกค้า/วันที่ IV/หมายเหตุในไฟล์แล้วระบบเงียบ
 *    (ขึ้นว่า "ไม่เปลี่ยน"). ตอนนี้เทียบ "ทุกฟิลด์ที่ไฟล์กรอกมา" ทีละตัว.
 * ⚠️ คีย์จับคู่ = Job No. (normalize) + เลขที่ IV — ห้ามใช้เลขที่ IV เดี่ยว ๆ
 *    เพราะ "เลขที่ IV ไม่ unique" (ของจริงมีคนละงานออกเลขซ้ำกัน) → map แบบเดิม
 *    (ivNo → ใบเดียว) ทำให้ใบที่ 2 ทับใบแรก แล้วอัปเดตผิดใบ/ตกหล่นเงียบ ๆ
 */
const IV_IMPORT_DIFF_FIELDS = [
  { key: 'balance',     label: 'ยอดค้างชำระ', kind: 'money' },
  { key: 'invoiceDate', label: 'วันที่ IV',    kind: 'date'  },
  { key: 'jobNo',       label: 'Job No.',      kind: 'job'   },
  { key: 'productType', label: 'สินค้า' },
  { key: 'projectName', label: 'ชื่อโครงการ' },
  { key: 'contractRef', label: 'เลขที่สัญญา' },
  { key: 'customer',    label: 'ลูกค้า' },
  { key: 'remark',      label: 'หมายเหตุ' },
  { key: 'period',      label: 'งวด',         kind: 'num'   },
  { key: 'invType',     label: 'ประเภทใบ' },
];

const ivNormText = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const ivMatchKey = (row) => {
  const jn = normalizeJobNo(row && row.jobNo).jobNo || '';
  return jn.toUpperCase() + '|' + ivNormText(row && row.ivNo).toUpperCase();
};
// ค่าต่างกันจริงไหม (เทียบตามชนิดข้อมูล — ไม่ใช่ string เปรียบเทียบดิบ)
function ivFieldDiffers(field, from, to) {
  if (field.kind === 'money' || field.kind === 'num') {
    return Math.round((Number(from) || 0) * 100) !== Math.round((Number(to) || 0) * 100);
  }
  if (field.kind === 'date') {
    return String(from || '').slice(0, 10) !== String(to || '').slice(0, 10);
  }
  if (field.kind === 'job') {   // INS049-PL กับ INS049 (+productType PL) = ใบเดียวกัน
    return (normalizeJobNo(from).jobNo || '').toUpperCase() !== (normalizeJobNo(to).jobNo || '').toUpperCase();
  }
  return ivNormText(from) !== ivNormText(to);
}

// fileRows (จาก parseRawIv) + existing (data.invoices) → แผนนำเข้า
//   new_      = ใบที่ไม่มีในระบบ
//   updated   = [{ existing, row, changes:[{key,label,kind,from,to}] }]
//   unchanged = ใบที่ตรงกับไฟล์เป๊ะ
//   ambiguous = ไฟล์มีเลข IV ที่ระบบมีซ้ำหลายใบ + jobNo ไม่ตรงสักใบ → ไม่เดา ให้คนตัดสิน
//   missing   = ใบในระบบที่ไม่มีในไฟล์ (อาจเลิกใช้แล้ว → เลือกลบได้)
function buildIvImportPlan(fileRows, existing) {
  const byPair = new Map();
  const byIv   = new Map();
  (existing || []).forEach(iv => {
    const pk = ivMatchKey(iv);
    if (!byPair.has(pk)) byPair.set(pk, iv);
    const ik = ivNormText(iv.ivNo).toUpperCase();
    if (!ik) return;
    if (!byIv.has(ik)) byIv.set(ik, []);
    byIv.get(ik).push(iv);
  });
  const touched   = new Set();          // id ที่ไฟล์ "เอ่ยถึง" แล้ว (ไม่นับเป็น missing)
  const new_ = [], updated = [], unchanged = [], ambiguous = [];
  (fileRows || []).forEach(r => {
    const ik = ivNormText(r.ivNo).toUpperCase();
    let ex = byPair.get(ivMatchKey(r));
    if (!ex) {
      const cands = byIv.get(ik) || [];
      if (cands.length === 1) ex = cands[0];
      else if (cands.length > 1) {
        cands.forEach(c => touched.add(c.id));
        ambiguous.push({ row: r, candidates: cands });
        return;
      }
    }
    if (!ex) { new_.push(r); return; }
    touched.add(ex.id);
    const present = new Set(r._present || IV_IMPORT_DIFF_FIELDS.map(f => f.key));
    const changes = [];
    IV_IMPORT_DIFF_FIELDS.forEach(f => {
      if (!present.has(f.key)) return;                    // ไฟล์ไม่ได้กรอก → ไม่แตะ
      if (!ivFieldDiffers(f, ex[f.key], r[f.key])) return;
      changes.push({ key: f.key, label: f.label, kind: f.kind, from: ex[f.key], to: r[f.key] });
    });
    if (changes.length) updated.push({ existing: ex, row: r, changes });
    else unchanged.push(ex);
  });
  const missing = (existing || []).filter(iv => !touched.has(iv.id));
  return { new_, updated, unchanged, ambiguous, missing };
}

// แสดงค่าให้อ่านง่ายตามชนิด (ใช้ในตารางเทียบ ก่อน→หลัง)
function ivFmtDiffVal(kind, v) {
  if (v == null || v === '') return '—';
  if (kind === 'money') return fmtNum(Number(v) || 0, 0);
  if (kind === 'date')  return fmtDate(v) || String(v);
  if (kind === 'num')   return String(Number(v) === 0 ? 'งวดเดียว' : v);
  return String(v);
}

function ImportRawIvModal({ open, onClose, existing, onImport, onManualAdd, canDelete }) {
  const [raw, setRaw] = ivState('');
  const [parsed, setParsed] = ivState({ all: [], new_: [], updated: [], unchanged: [], ambiguous: [], missing: [] });
  const [selNew, setSelNew] = ivState(() => new Set());   // index ของใบใหม่ที่จะนำเข้า
  const [selUpd, setSelUpd] = ivState(() => new Set());   // id ใบเก่าที่จะอัปเดต
  const [selDel, setSelDel] = ivState(() => new Set());   // id ใบที่ไม่มีในไฟล์ → เลือกลบ
  const [openSec, setOpenSec] = ivState({ new_: true, updated: true, missing: false });
  const [fileInfo, setFileInfo] = ivState(null); // { name, sheets, picked }
  const [fileErr, setFileErr]   = ivState('');
  const [helpOpen, setHelpOpen] = ivState(false);
  const [pasteOpen, setPasteOpen] = ivState(false);
  const [dragOver, setDragOver]   = ivState(false);
  const fileInputRef = ivRef(null);

  // อ่านไฟล์ Excel/CSV → แปลงเป็น TSV → ใส่ใน textarea (reuse parseRawIv)
  const handleFile = (file) => {
    if (!file) return;
    setFileErr('');
    if (typeof XLSX === 'undefined') {
      setFileErr('ยังไม่ได้โหลด SheetJS — รีโหลดหน้าใหม่แล้วลองอีกครั้ง');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target.result;
        const wb  = XLSX.read(buf, { type: 'array', cellDates: false });
        if (!wb.SheetNames || wb.SheetNames.length === 0) {
          setFileErr('ไฟล์ว่าง — ไม่พบ sheet ในไฟล์');
          return;
        }
        const sheetName = wb.SheetNames[0];
        const ws        = wb.Sheets[sheetName];
        // แปลงเป็น TSV (formatted values, ไม่ใช่ raw numbers — เพื่อให้วันที่ออกเป็น "09/04/2026")
        const tsv = XLSX.utils.sheet_to_csv(ws, { FS: '\t', RS: '\n', rawNumbers: false, blankrows: false });
        setRaw(tsv);
        setFileInfo({ name: file.name, sheets: wb.SheetNames, picked: sheetName });
      } catch (err) {
        console.error('xlsx read error', err);
        setFileErr('อ่านไฟล์ไม่สำเร็จ: ' + (err && err.message ? err.message : String(err)));
      }
    };
    reader.onerror = () => setFileErr('อ่านไฟล์ไม่สำเร็จ');
    reader.readAsArrayBuffer(file);
  };

  // เปลี่ยน sheet ที่จะใช้ (กรณีไฟล์ Excel มีหลาย sheet)
  const switchSheet = (sheetName) => {
    if (!fileInputRef.current || !fileInputRef.current.files || !fileInputRef.current.files[0]) return;
    const file = fileInputRef.current.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
        const ws = wb.Sheets[sheetName];
        if (!ws) { setFileErr('ไม่พบ sheet: ' + sheetName); return; }
        const tsv = XLSX.utils.sheet_to_csv(ws, { FS: '\t', RS: '\n', rawNumbers: false, blankrows: false });
        setRaw(tsv);
        setFileInfo(fi => fi ? { ...fi, picked: sheetName } : fi);
      } catch (err) {
        setFileErr('อ่าน sheet ไม่สำเร็จ: ' + (err && err.message ? err.message : String(err)));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const clearFile = () => {
    setFileInfo(null);
    setFileErr('');
    setRaw('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  React.useEffect(() => {
    const rawStr = String(raw == null ? '' : raw);  // raw อาจเป็น null/number จาก XLSX edge case
    if (!rawStr.trim()) {
      setParsed({ all: [], new_: [], updated: [], unchanged: [], ambiguous: [], missing: [] });
      setSelNew(new Set()); setSelUpd(new Set()); setSelDel(new Set());
      return;
    }
    const all  = parseRawIv(rawStr);
    const plan = buildIvImportPlan(all, existing || []);
    setParsed({ all, ...plan });
    // ค่าตั้งต้น: ใบใหม่ = ติ๊กหมด · อัปเดต = ติ๊กหมด "ยกเว้นใบที่รับเงินแล้ว"
    // (ใบ paid = ปิดจ็อบแล้ว ไฟล์ระบบบัญชีมักยังค้างยอดเดิม → ทับแล้วยอดเพี้ยน)
    setSelNew(new Set(plan.new_.map((_, i) => i)));
    setSelUpd(new Set(plan.updated.filter(u => u.existing.status !== 'paid').map(u => u.existing.id)));
    setSelDel(new Set());   // ลบ = ต้องติ๊กเองเสมอ
    // dep = [raw] เท่านั้น — `existing` (data.invoices) เปลี่ยน reference ทุกครั้งที่ sync
    // ใส่ใน dep แล้ว selection ที่ผู้ใช้ติ๊กไว้จะถูกรีเซ็ตกลางคัน
  }, [raw]);

  if (!open) return null;

  const selUpdList = parsed.updated.filter(u => selUpd.has(u.existing.id));
  const selNewList = parsed.new_.filter((_, i) => selNew.has(i));
  const totalOps   = selNewList.length + selUpdList.length + selDel.size;

  const importNow = () => {
    const newRows = selNewList.map(r => ({
      ivNo: r.ivNo, jobNo: r.jobNo, invoiceDate: r.invoiceDate,
      balance: r.balance, period: r.period === 0 ? 0 : (r.period || 1),
      productType: r.productType || '',
      projectName: r.projectName || '',
      contractRef: r.contractRef || '',
      invType:     r.invType || 'P',
      remark: r.remark || '', customer: r.customer || '',
      status: 'pending_inspection', expectedReceive: '',
      contactName: '', contactPhone: '',
      followUps: [], actualReceive: null,
    }));
    // patch = "เฉพาะฟิลด์ที่ต่างจริง" (ไม่ทับทั้งแถว) → ข้อมูลที่คนกรอกเองในระบบ
    // (ผู้ติดต่อ/วันคาดรับ/สถานะ/ประวัติติดตาม) ไม่ถูกไฟล์ล้าง
    const patchRows = selUpdList.map(u => {
      const p = { id: u.existing.id };
      u.changes.forEach(c => { p[c.key] = u.row[c.key]; });
      return p;
    });
    onImport({ newRows, patchRows, deleteIds: [...selDel] });
    setRaw('');
  };

  const toggleIn = (setFn) => (key) => setFn(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleNew = toggleIn(setSelNew);
  const toggleUpd = toggleIn(setSelUpd);
  const toggleDel = toggleIn(setSelDel);

  // หัวข้อ section แบบพับได้ + ติ๊กเลือกทั้งหมด
  const SecHead = ({ id, title, count, color, bg, bd, hint, allKeys, sel, setSel }) => {
    const isOpen = !!openSec[id];
    const all = allKeys.length > 0 && allKeys.every(k => sel.has(k));
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
        background: bg, border: `1px solid ${bd}`, borderRadius: 7, marginBottom: 6, marginTop: 10,
      }}>
        {allKeys.length > 0 && (
          <input type="checkbox" checked={all}
            ref={el => { if (el) { const some = allKeys.some(k => sel.has(k)); el.indeterminate = some && !all; } }}
            onChange={() => setSel(all ? new Set() : new Set(allKeys))}
            style={{ cursor: 'pointer' }} title="เลือก/ไม่เลือกทั้งหมดในกลุ่มนี้" />
        )}
        <button type="button" onClick={() => setOpenSec(o => ({ ...o, [id]: !o[id] }))}
          style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color, fontWeight: 700, fontSize: 12.5 }}>
          {isOpen ? '▾' : '▸'} {title} <span style={{ opacity: .75 }}>({count})</span>
          {hint && <span style={{ fontWeight: 400, color: 'var(--ink-500)', fontSize: 11, marginLeft: 6 }}>{hint}</span>}
        </button>
        {allKeys.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>เลือก {allKeys.filter(k => sel.has(k)).length}/{allKeys.length}</span>
        )}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      maxWidth={900}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>เพิ่มใบแจ้งหนี้</span>
          <button type="button" onClick={() => setHelpOpen(o => !o)}
            title={helpOpen ? 'ซ่อนคำอธิบาย' : 'ดูคำอธิบาย / คอลัมน์ที่รองรับ'}
            aria-label="help"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: '50%',
              background: helpOpen ? '#f6ad55' : '#fefce8',
              color: helpOpen ? '#fff' : '#b45309',
              border: '1.5px solid #f6ad55', cursor: 'pointer', padding: 0,
              fontSize: 13, fontWeight: 700, lineHeight: 1,
              transition: 'background .12s',
            }}>ⓘ</button>
        </span>
      }
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={totalOps === 0} onClick={importNow}>
          <Icon name="upload" size={14} /> นำเข้า
          {selNewList.length > 0 && ` ${selNewList.length} ใบใหม่`}
          {selNewList.length > 0 && selUpdList.length > 0 && ' ·'}
          {selUpdList.length > 0 && ` อัปเดต ${selUpdList.length} ใบ`}
          {selDel.size > 0 && ` · ลบ ${selDel.size} ใบ`}
        </button>
      </>}
    >
      {helpOpen && (
        <div style={{
          fontSize: 12, marginBottom: 12, padding: '10px 12px',
          background: '#fefce8', border: '1px solid #fde68a', borderLeft: '3px solid #f6ad55',
          borderRadius: 7, color: 'var(--ink-700)', lineHeight: 1.65,
        }}>
          <div>📥 <strong>อัปโหลดไฟล์ .xlsx/.csv</strong> หรือ <strong>วาง TSV/JSON</strong>. คอลัมน์ที่ใช้:&nbsp;
            <strong>proj_dpt</strong> (หรือ refcode), <strong>invno</strong>, <strong>invdate</strong>, <strong>Balance</strong>, <strong>remark</strong>, <strong>Customer</strong>, <strong>invtype</strong>
          </div>
          <div>📆 งวด (period) จะดึงจาก <strong>remark</strong> อัตโนมัติ เช่น "งวดที่ 2" → period = 2</div>
          <div>🔁 ระบบเทียบกับใบในตารางด้วย <strong>Job No. + เลขที่ IV</strong> → แยกเป็น "ใบใหม่ / ต้องอัปเดต / ไม่เปลี่ยน" ให้ติ๊กเลือกก่อนนำเข้า</div>
          <div>✏️ อัปเดต = เขียนทับ <strong>เฉพาะช่องที่ต่างจริง</strong> — ผู้ติดต่อ · วันคาดรับเงิน · สถานะ · ประวัติติดตาม ที่คีย์ในระบบไม่ถูกล้าง</div>
        </div>
      )}

      {/* ── ทางลัด: ไม่มีไฟล์ → กรอกเองใบเดียว ──────────────────────────── */}
      {onManualAdd && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '8px 12px', marginBottom: 10, borderRadius: 8,
          background: 'var(--ink-50, #f7f8fa)', border: '1px solid var(--ink-100, #e6eaf0)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--ink-600)' }}>
            📄 มีใบเดียว / ไม่มีไฟล์?
          </span>
          <button type="button" onClick={onManualAdd}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 11px', borderRadius: 14, cursor: 'pointer',
              background: '#fff', color: 'var(--brand-700)',
              border: '1.5px solid var(--brand-400, #6f9ded)', fontWeight: 600, fontSize: 11.5,
            }}>
            <Icon name="plus" size={12} /> เพิ่มเองทีละใบ
          </button>
        </div>
      )}

      {/* ── อัปโหลดไฟล์ Excel — รองรับ drag & drop ──────────────────── */}
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!dragOver) setDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          setDragOver(false);
          const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        style={{
          border: dragOver ? '2.5px dashed var(--brand-500)' : '2px dashed var(--brand-300, #90b4f2)',
          borderRadius: 12, padding: '28px 20px',
          minHeight: 120, marginBottom: 12, transition: 'all .12s ease',
          background: dragOver
            ? 'color-mix(in oklch, var(--brand-500) 14%, transparent)'
            : 'color-mix(in oklch, var(--brand-500) 5%, transparent)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
            background: 'var(--brand-500)', color: '#fff', fontWeight: 600, fontSize: 12.5,
            border: 'none',
          }}>
            <Icon name="upload" size={13} />
            เลือกไฟล์ Excel
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt"
              onChange={(e) => handleFile(e.target.files && e.target.files[0])}
              style={{ display: 'none' }}
            />
          </label>
          <span style={{ fontSize: 11.5, color: dragOver ? 'var(--brand-700)' : 'var(--ink-500)', fontWeight: dragOver ? 600 : 400 }}>
            {dragOver ? '⬇️ วางไฟล์ที่นี่' : 'หรือลากไฟล์มาวาง — รองรับ .xlsx, .xls, .csv'}
          </span>
          {fileInfo && (
            <button type="button" onClick={clearFile}
              style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--ink-200)', borderRadius: 6, padding: '3px 9px', fontSize: 11, color: 'var(--ink-600)', cursor: 'pointer' }}>
              ✕ ล้างไฟล์
            </button>
          )}
        </div>
        {fileInfo && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>📄</span>
            <strong>{fileInfo.name}</strong>
            {fileInfo.sheets.length > 1 ? (
              <>
                <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>· Sheet:</span>
                <select
                  className="select input"
                  value={fileInfo.picked}
                  onChange={(e) => switchSheet(e.target.value)}
                  style={{ height: 26, fontSize: 12, padding: '0 8px' }}>
                  {fileInfo.sheets.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>· sheet: {fileInfo.picked}</span>
            )}
          </div>
        )}
        {fileErr && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--bad)', background: 'color-mix(in oklch, var(--bad) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--bad) 22%, transparent)', borderRadius: 6, padding: '5px 10px' }}>
            ⚠️ {fileErr}
          </div>
        )}
      </div>

      {/* ── ปุ่ม "วางข้อมูลโดยตรง" → expand textarea ──────────────────── */}
      {!pasteOpen ? (
        <button type="button" onClick={() => setPasteOpen(true)}
          style={{
            width: '100%', padding: '8px 14px', marginBottom: 8,
            background: 'var(--ink-50, #f7f8fa)', border: '1px dashed var(--ink-200, #cbd5e0)',
            borderRadius: 7, color: 'var(--ink-600)', cursor: 'pointer',
            fontSize: 12, fontWeight: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
          <span>📋</span>
          <span>หรือกดที่นี่เพื่อวางข้อมูลโดยตรง (TSV / JSON)</span>
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>วางข้อมูล TSV / JSON ที่นี่</span>
            <button type="button" onClick={() => { setPasteOpen(false); if (!fileInfo) setRaw(''); }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-400)', fontSize: 11, padding: '0 4px' }}>
              ✕ ซ่อน
            </button>
          </div>
          <textarea
            className="input"
            rows={8}
            autoFocus
            placeholder={`ตัวอย่าง (วางจาก Excel RAW_IV_OUTSTANDING ได้เลย):

refcode\tinvno\tinvdate\tBalance\tremark\tCustomer
6802-01\tIV2603-031\t11/03/2026\t5,395,000.00\tระบบผลิตน้ำประปาขนาดใหญ่\tที่ทำการปกครองอำเภอเขาย้อย
6901-01\tIV2604-025\t28/04/2026\t3,240,000.00\tระบบผลิตน้ำประปา-งวดที่ 2 (60%)\tองค์การบริหารส่วนตำบลบ้านนา
…`}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            style={{ fontFamily: 'ui-monospace', fontSize: 12, width: '100%', resize: 'vertical' }}
          />
        </>
      )}

      {/* Preview */}
      {String(raw == null ? '' : raw).trim() && (
        <div style={{ marginTop: 14 }}>
          <div className="grid grid-4" style={{ marginBottom: 4 }}>
            <div style={{ padding: 10, borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ใบใหม่</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--good)' }}>{parsed.new_.length}</div>
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>มีอัปเดต</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'oklch(60% 0.16 75)' }}>{parsed.updated.length}</div>
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: '#f1f5f9', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ไม่เปลี่ยน</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-700)' }}>{parsed.unchanged.length}</div>
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: '#fff5f5', border: '1px solid #fed7d7' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ไม่มีในไฟล์</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--bad)' }}>{parsed.missing.length}</div>
            </div>
          </div>

          {/* ── ใบซ้ำเลข IV — ระบบไม่เดาให้ ────────────────────────────── */}
          {parsed.ambiguous.length > 0 && (
            <div style={{
              marginTop: 10, padding: '8px 12px', fontSize: 12, lineHeight: 1.6,
              background: '#fffaf0', border: '1px solid #f6ad55', borderLeft: '3px solid #dd6b20',
              borderRadius: 7, color: 'var(--ink-700)',
            }}>
              <strong>⚠️ ข้าม {parsed.ambiguous.length} แถว — เลขที่ IV ซ้ำในระบบ</strong>
              <div style={{ fontSize: 11.5, color: 'var(--ink-600)' }}>
                {parsed.ambiguous.slice(0, 4).map(a => a.row.ivNo).join(', ')}
                {parsed.ambiguous.length > 4 && ` …อีก ${parsed.ambiguous.length - 4}`}
                {' '}— ระบบมีใบเลขนี้หลายใบและ Job No. ในไฟล์ไม่ตรงสักใบ จึงไม่เดาว่าจะอัปเดตใบไหน
                (เติมคอลัมน์ jobno/proj_dpt ในไฟล์ให้ตรง หรือแก้ทีละใบในตาราง)
              </div>
            </div>
          )}

          {/* ── ใบใหม่ ───────────────────────────────────────────────── */}
          {parsed.new_.length > 0 && (
            <>
              <SecHead id="new_" title="ใบใหม่ — จะเพิ่มเข้าระบบ" count={parsed.new_.length}
                color="#276749" bg="#f0fdf4" bd="#bbf7d0"
                allKeys={parsed.new_.map((_, i) => i)} sel={selNew} setSel={setSelNew} />
              {openSec.new_ && (
                <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 240 }}>
                  <table className="tbl" style={{ fontSize: 12 }}>
                    <thead><tr>
                      <th style={{ width: 32 }}></th><th>Job no</th><th>IV no</th><th>วันที่</th>
                      <th style={{ textAlign: 'right' }}>Balance</th><th style={{ textAlign: 'center' }}>งวด</th>
                    </tr></thead>
                    <tbody>
                      {parsed.new_.map((r, i) => (
                        <tr key={i} onClick={() => toggleNew(i)} style={{ cursor: 'pointer', opacity: selNew.has(i) ? 1 : 0.45 }}>
                          <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selNew.has(i)} onChange={() => toggleNew(i)} style={{ cursor: 'pointer' }} />
                          </td>
                          <td style={{ fontFamily: 'ui-monospace' }}>{r.jobNo || '—'}</td>
                          <td style={{ fontFamily: 'ui-monospace' }}>{r.ivNo}</td>
                          <td>{fmtDate(r.invoiceDate)}</td>
                          <td className="num">{fmtNum(r.balance, 0)}</td>
                          <td style={{ textAlign: 'center' }}>{r.period === 0 ? 'งวดเดียว' : (r.period || 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── ใบเก่าที่มีอัปเดต — เทียบ ก่อน → หลัง รายช่อง ──────────── */}
          {parsed.updated.length > 0 && (
            <>
              <SecHead id="updated" title="มีอัปเดต — จะเขียนทับเฉพาะช่องที่ต่าง" count={parsed.updated.length}
                color="#b45309" bg="#fffbeb" bd="#fde68a"
                hint={parsed.updated.some(u => u.existing.status === 'paid') ? '· ใบที่รับเงินแล้วไม่ติ๊กให้อัตโนมัติ' : ''}
                allKeys={parsed.updated.map(u => u.existing.id)} sel={selUpd} setSel={setSelUpd} />
              {openSec.updated && (
                <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 300 }}>
                  <table className="tbl" style={{ fontSize: 12 }}>
                    <thead><tr>
                      <th style={{ width: 32 }}></th><th style={{ width: 90 }}>Job no</th><th style={{ width: 110 }}>IV no</th>
                      <th>สิ่งที่เปลี่ยน (เดิม → ใหม่)</th>
                    </tr></thead>
                    <tbody>
                      {parsed.updated.map(u => {
                        const on = selUpd.has(u.existing.id);
                        const isPaid = u.existing.status === 'paid';
                        return (
                          <tr key={u.existing.id} onClick={() => toggleUpd(u.existing.id)}
                            style={{ cursor: 'pointer', opacity: on ? 1 : 0.5 }}>
                            <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={on} onChange={() => toggleUpd(u.existing.id)} style={{ cursor: 'pointer' }} />
                            </td>
                            <td style={{ fontFamily: 'ui-monospace' }}>{u.existing.jobNo || '—'}</td>
                            <td style={{ fontFamily: 'ui-monospace' }}>
                              {u.existing.ivNo}
                              {isPaid && <div style={{ fontSize: 10, color: 'var(--good)', fontWeight: 700 }}>✓ รับเงินแล้ว</div>}
                            </td>
                            <td>
                              {u.changes.map(c => (
                                <div key={c.key} style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', lineHeight: 1.55 }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-500)', minWidth: 74 }}>{c.label}</span>
                                  <span style={{ color: 'var(--ink-400)', textDecoration: 'line-through', fontSize: 11.5 }}>{ivFmtDiffVal(c.kind, c.from)}</span>
                                  <span style={{ color: 'var(--ink-300)' }}>→</span>
                                  <span style={{ fontWeight: 700, color: c.kind === 'money' ? 'var(--brand-700)' : 'var(--ink-800)', fontSize: 11.5 }}>{ivFmtDiffVal(c.kind, c.to)}</span>
                                </div>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── ใบในระบบที่ไม่มีในไฟล์ — เลือกลบได้ (ต้องติ๊กเอง) ─────────── */}
          {parsed.missing.length > 0 && (
            <>
              <SecHead id="missing" title="ไม่มีในไฟล์นี้" count={parsed.missing.length}
                color={canDelete ? '#c53030' : 'var(--ink-600)'} bg="#fff5f5" bd="#fed7d7"
                hint={canDelete ? '· ติ๊กเฉพาะใบที่เลิกใช้แล้วเพื่อลบทิ้ง' : '· (ต้องเป็นผู้จัดการจึงลบได้)'}
                allKeys={canDelete ? parsed.missing.map(iv => iv.id) : []} sel={selDel} setSel={setSelDel} />
              {openSec.missing && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--ink-500)', padding: '0 2px 6px', lineHeight: 1.6 }}>
                    ⚠️ ถ้าไฟล์นี้เป็นข้อมูล<strong>บางส่วน</strong> (เช่น export เฉพาะบางเดือน) ใบพวกนี้ไม่ได้แปลว่าเลิกใช้ — ปล่อยว่างไว้ ไม่ต้องติ๊ก
                  </div>
                  <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 240 }}>
                    <table className="tbl" style={{ fontSize: 12 }}>
                      <thead><tr>
                        <th style={{ width: 32 }}></th><th>Job no</th><th>IV no</th><th>ชื่อโครงการ</th>
                        <th style={{ textAlign: 'right' }}>ยอดค้าง</th><th style={{ textAlign: 'center' }}>สถานะ</th>
                      </tr></thead>
                      <tbody>
                        {parsed.missing.map(iv => {
                          const meta = WTPData.IV_STATUS_META[iv.status] || { label: iv.status || '—', badge: 'b-gray' };
                          const on = selDel.has(iv.id);
                          return (
                            <tr key={iv.id} onClick={() => canDelete && toggleDel(iv.id)}
                              style={{ cursor: canDelete ? 'pointer' : 'default', background: on ? 'color-mix(in oklch, var(--bad) 9%, transparent)' : undefined }}>
                              <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={on} disabled={!canDelete}
                                  onChange={() => toggleDel(iv.id)} style={{ cursor: canDelete ? 'pointer' : 'not-allowed' }} />
                              </td>
                              <td style={{ fontFamily: 'ui-monospace' }}>{iv.jobNo || '—'}</td>
                              <td style={{ fontFamily: 'ui-monospace' }}>{iv.ivNo}</td>
                              <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{iv.projectName || '—'}</td>
                              <td className="num">{fmtNum(iv.balance, 0)}</td>
                              <td style={{ textAlign: 'center' }}><Badge kind={meta.badge}>{meta.label}</Badge></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── parse proj_dpt ──────────────────────────────────────────────────────────
// Format: "Project No. : (INTERNAL_NO) JOBNO-PRODUCTTYPE-ชื่อโครงการ (REFCODE) (Owner : ...)"
// ผลลัพธ์:
//   jobNo       = PP064, TTI040, STR067, MA-926, 979 (code ก่อน product type)
//   productType = STIIS, PDH, PL, PM  (ตัวพิมพ์ใหญ่ระหว่าง JOBNO กับชื่อ)
//   projectName = บ้านพรุกง ม.2 ต.วังใหญ่... (ชื่อจริงหลัง productType)
//   contractRef = 6901-01 (refcode ในวงเล็บสุดท้าย ก่อน Owner)
function parseProjDpt(projDpt) {
  if (!projDpt) return { jobNo: '', productType: '', projectName: '', contractRef: '' };
  // 1) ลบ prefix
  let s = projDpt.replace(/^Project\s+No\.\s*:\s*/i, '').trim();
  // 2) ตัดส่วน (Owner: ...)
  const ownerIdx = s.indexOf('(Owner');
  if (ownerIdx >= 0) s = s.slice(0, ownerIdx).trim();
  // 3) ดึง contractRef จาก () สุดท้าย (เช่น 6901-01)
  const lastParen = s.match(/\(([^()]+)\)\s*$/);
  const contractRef = lastParen ? lastParen[1].trim() : '';
  if (lastParen) s = s.slice(0, s.lastIndexOf('(')).trim();
  // 4) ลบ (INTERNAL_NO) แรก → เหลือ description
  const desc = s.replace(/^\([^)]*\)\s*/, '').trim();
  // 5) parse JOBNO-PRODUCTTYPE-ชื่อโครงการ
  //    PRODUCTTYPE = ตัวพิมพ์ใหญ่ล้วน 2-6 ตัว (STIIS, PDH, PL, PM, PD, PDH)
  //    JOBNO = ทุกอย่างก่อน PRODUCTTYPE (PP064, TTI040, MA-926, 979 ฯลฯ)
  const codeMatch = desc.match(/^(.+?)-([A-Z]{2,6})-(.+)$/);
  if (codeMatch) {
    return {
      jobNo:       codeMatch[1].trim(),
      productType: codeMatch[2].trim(),
      projectName: codeMatch[3].trim(),
      contractRef,
    };
  }
  // ไม่เจอ code pattern → ชื่อโครงการ = desc ทั้งหมด, ใช้ contractRef เป็น jobNo
  return { jobNo: contractRef, productType: '', projectName: desc, contractRef };
}

// Parse TSV/CSV from RAW_IV_OUTSTANDING
// Expected columns (case-insensitive):
//   jobNo / refcode / proj_dpt → jobNo  (proj_dpt จะถูก parse ด้วย parseProjDpt)
//   projectName → ชื่อโครงการ (ถ้าไม่มี จะ parse จาก proj_dpt)
//   invno → ivNo
//   invdate → invoiceDate
//   balance → balance
//   remark → remark (period extracted automatically จาก "งวดที่ N")
//   period → override period (optional)
function parseRawIv(text) {
  // Try JSON first
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      const arr = Array.isArray(j) ? j : [j];
      return arr.map(normalizeIvRow).filter(Boolean);
    } catch (_) { /* fall through */ }
  }
  // TSV/CSV: detect delimiter
  const lines = t.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const delim = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : '\t');
  const headers = lines[0].split(delim).map(h => h.trim().toLowerCase());
  const idx = (name) => headers.indexOf(name);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const remark  = (cols[idx('remark')] || cols[idx('vch_remark')] || '').trim();

    // ลำดับ priority: jobno column → parse จาก proj_dpt
    let jobNo       = (cols[idx('jobno')] || cols[idx('job no')] || '').trim();
    let productType = (cols[idx('producttype')] || cols[idx('product_type')] || '').trim();
    let projectName = (cols[idx('projectname')] || cols[idx('project_name')] || '').trim();
    let contractRef = (cols[idx('contractref')] || cols[idx('contract_ref')] || cols[idx('refcode')] || '').trim();
    const rawProjDpt = (cols[idx('proj_dpt')] || '').trim();
    if (rawProjDpt) {
      const parsed = parseProjDpt(rawProjDpt);
      if (!jobNo)       jobNo       = parsed.jobNo;
      if (!productType) productType = parsed.productType;
      if (!projectName) projectName = parsed.projectName;
      if (!contractRef) contractRef = parsed.contractRef;
    }

    const row = finalizeIvImportRow({
      jobNo, productType, projectName, contractRef,
      ivNoCell:     cols[idx('invno')] || cols[idx('iv no')] || cols[idx('iv_no')] || '',
      invDateCell:  cols[idx('invdate')] || cols[idx('inv date')] || cols[idx('date')] || '',
      balanceCell:  idx('balance') >= 0 ? cols[idx('balance')] : '',
      remark,
      customerCell: cols[idx('customer')] || '',
      overDueCell:  cols[idx('over_due')] || '',
      periodCell:   idx('period') >= 0 ? cols[idx('period')] : '',
      invTypeCell:  cols[idx('invtype')] || cols[idx('inv_type')] || cols[idx('inv type')] || '',
    });
    if (row.ivNo) out.push(row);
  }
  return out;
}

// ── finalizeIvImportRow: ค่าดิบต่อคอลัมน์ → row มาตรฐาน + ธง `_present` ───────
// ⚠️ `_present` = "คอลัมน์ไหนที่ไฟล์กรอกค่ามาจริง" — ตอนเทียบว่าใบเก่า "มีอัปเดตไหม"
//    จะดูเฉพาะฟิลด์ใน _present เท่านั้น. ไฟล์ไม่มีคอลัมน์นั้น / เว้นว่าง = "ไม่แตะของเดิม"
//    ไม่ใช่ "สั่งล้างค่าเป็น 0/ว่าง" (ไม่งั้นไฟล์ที่ไม่มีคอลัมน์ Balance จะล้างยอดทั้งตาราง).
function finalizeIvImportRow(v) {
  const remark      = (v.remark == null ? '' : String(v.remark)).trim();
  const hasCell     = (c) => c != null && String(c).trim() !== '';
  const invoiceDate = normalizeDate((v.invDateCell == null ? '' : String(v.invDateCell)).trim());
  const ivType      = (v.invTypeCell == null ? '' : String(v.invTypeCell)).trim().toUpperCase();
  const hasPeriod   = hasCell(v.periodCell);
  const row = {
    jobNo:       v.jobNo || '',
    productType: v.productType || '',
    projectName: v.projectName || '',
    contractRef: v.contractRef || '',
    ivNo:        (v.ivNoCell == null ? '' : String(v.ivNoCell)).trim(),
    invoiceDate,
    balance:     parseNum(v.balanceCell),
    remark,
    customer:    (v.customerCell == null ? '' : String(v.customerCell)).trim(),
    overDue:     parseNum(v.overDueCell),
    period:      hasPeriod ? parseNum(v.periodCell) : extractPeriodFromRemark(remark),
    invType:     ivType === 'O' ? 'O' : 'P',
  };
  const present = [];
  if (hasCell(v.balanceCell))               present.push('balance');
  if (invoiceDate)                          present.push('invoiceDate');
  if (row.jobNo)                            present.push('jobNo');
  if (row.productType)                      present.push('productType');
  if (row.projectName)                      present.push('projectName');
  if (row.contractRef)                      present.push('contractRef');
  if (row.customer)                         present.push('customer');
  if (remark)                               present.push('remark');
  // งวด: เชื่อเฉพาะเมื่อมีคอลัมน์ period หรือ remark เขียนงวดไว้ชัด
  // (remark ทั่วไปที่ไม่มีคำว่า "งวด" → extractPeriodFromRemark คืน 1 เสมอ = เดา ไม่ใช่ข้อมูล)
  if (hasPeriod || /งวดที่\s*\d+|งวดเดียว/.test(remark)) present.push('period');
  if (ivType === 'O' || ivType === 'P')     present.push('invType');
  row._present = present;
  return row;
}
function normalizeIvRow(r) {
  const get = (...keys) => { for (const k of keys) { const lk = k.toLowerCase(); for (const rk of Object.keys(r)) { if (rk.toLowerCase() === lk) return r[rk]; } } return null; };
  const ivNo = (get('invno', 'iv no', 'iv_no') || '').toString().trim();
  if (!ivNo) return null;
  const remark = (get('remark', 'vch_remark') || '').toString().trim();
  // jobNo: priority = jobNo column → parse จาก proj_dpt
  let jobNo       = (get('jobno', 'job no') || '').toString().trim();
  let productType = (get('producttype', 'product_type') || '').toString().trim();
  let projectName = (get('projectname', 'project_name') || '').toString().trim();
  let contractRef = (get('contractref', 'contract_ref', 'refcode') || '').toString().trim();
  const rawProjDpt = (get('proj_dpt') || '').toString().trim();
  if (rawProjDpt) {
    const parsed = parseProjDpt(rawProjDpt);
    if (!jobNo)       jobNo       = parsed.jobNo;
    if (!productType) productType = parsed.productType;
    if (!projectName) projectName = parsed.projectName;
    if (!contractRef) contractRef = parsed.contractRef;
  }
  return finalizeIvImportRow({
    jobNo, productType, projectName, contractRef,
    ivNoCell:     ivNo,
    invDateCell:  get('invdate', 'inv date', 'date'),
    balanceCell:  get('balance'),
    remark,
    customerCell: get('customer'),
    overDueCell:  get('over_due'),
    periodCell:   get('period'),
    invTypeCell:  get('invtype', 'inv_type', 'inv type'),
  });
}
// ดึงเลขงวดจาก remark เช่น "งวดที่ 2 (60%)" → 2
function extractPeriodFromRemark(remark) {
  if (!remark) return 1;
  if (/งวดเดียว/.test(remark)) return 0;
  const m = remark.match(/งวดที่\s*(\d+)/);
  return m ? (parseInt(m[1]) || 1) : 1;
}
function parseNum(s) {
  if (s == null || s === '') return 0;
  const n = Number(String(s).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}
function normalizeDate(s) {
  if (!s) return '';
  // Accept YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let [_, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    // Assume DD/MM/YYYY (Thai)
    return `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  }
  return s;
}

// ── Standalone IV Report Page (รายงาน/วิเคราะห์ section) ──────────────────
function IvReportStandalonePage({ data, setData, toast }) {
  const { projectByCode, financeByCode } = React.useMemo(
    () => WTPData.buildLookups(data),
    [data.projects]
  );

  const [ivTypeFilter, setIvTypeFilter] = React.useState('P'); // 'all' | 'P' | 'O' — default 'P' (โครงการ)

  const allRows = React.useMemo(() => (data.invoices || []).map(iv => {
    const p = projectByCode[iv.jobNo] || projectByCode[iv.contractRef] || projectByCode[iv.projectCode] || {};
    const f = financeByCode[iv.jobNo] || financeByCode[iv.contractRef] || financeByCode[iv.projectCode] || {};
    const debt     = Number(f.debt ?? f['ภาระหนี้'] ?? 0);
    // Prefer existing fields, fall back to imported v2 fields
    const assignee = iv.assignee || f.assignee || f['ผู้รับโอนสิทธิ์'] || '—';
    const projectName = iv.projectName || p['พื้นที่'] || p.name || '—';
    // Map v2 'pending' → 'tracking' so existing date-bucketed sections include it.
    // Real 'paid' rows keep status='paid'.
    const status = iv.status === 'pending' ? 'tracking' : iv.status;
    // Map dueDate → expectedReceive for date filtering, prefer actualReceiveDate if set
    const expectedReceive = iv.expectedReceive || iv.dueDate || iv.actualReceiveDate || null;
    const balance = Number(iv.balance) || 0;
    // Normalize invType — 'P' (default) หรือ 'O'
    const rawIvType = (iv.invType || iv.invtype || 'P').toString().trim().toUpperCase();
    const invType   = rawIvType === 'O' ? 'O' : 'P';
    // Normalize period — ใบเก่าอาจไม่มี field period → derive จาก remark เพื่อให้ chip ขึ้นสม่ำเสมอ
    const rawPeriod = Number(iv.period);
    const period    = Number.isFinite(rawPeriod) && (rawPeriod === 0 || rawPeriod > 0)
      ? rawPeriod
      : extractPeriodFromRemark(iv.remark || '');
    return {
      ...iv,
      status,
      expectedReceive,
      projectName,
      assignee,
      debt,
      invType,
      period,
      // คาดรับสุทธิ = balance หลังหัก WHT 1% (balance × 106/107) − ภาระหนี้
      netExpected: balance * 106 / 107 - debt,
    };
  }), [data.invoices, projectByCode, financeByCode]);

  const rows = React.useMemo(
    () => ivTypeFilter === 'all' ? allRows : allRows.filter(r => r.invType === ivTypeFilter),
    [allRows, ivTypeFilter]
  );

  const pending = rows.filter(r => r.status !== 'paid');
  const today   = new Date().toISOString().slice(0, 10);

  const [detail, setDetail] = React.useState(null);
  const [payModal, setPayModal] = React.useState(null);

  const save = (iv) => {
    let updatedData;
    setData(d => {
      const newInvoices = iv.id
        ? d.invoices.map(x => x.id === iv.id ? iv : x)
        : [{ ...iv, id: WTPData.newId() }, ...d.invoices];
      const newReceipts = WTPData.ensureReceiptForPaidInvoice
        ? WTPData.ensureReceiptForPaidInvoice(d.receipts || [], iv)
        : (d.receipts || []);
      const user = (() => { try { return JSON.parse(localStorage.getItem('bio-session') || 'null'); } catch(_) { return null; } })();
      const newLog = WTPData.rebuildFollowUpsLog
        ? WTPData.rebuildFollowUpsLog(newInvoices, user && user.username, d.followUpsLog || [])
        : (d.followUpsLog || []);
      updatedData = {
        ...d,
        invoices:     newInvoices,
        receipts:     newReceipts,
        followUpsLog: newLog,
      };
      return updatedData;
    });
    setDetail(prev => prev && prev.id === iv.id ? iv : prev);
    toast && toast('บันทึกแล้ว');
    if (updatedData) {
      try { WTPData.save(updatedData); } catch (_) {}
      if (WTPData.forceSyncNow) {
        setTimeout(() => WTPData.forceSyncNow(updatedData), 0);
      }
    }
  };

  // ── A4 portrait print handler — ทำให้พิมพ์ออกมาเหมือนหน้าเว็บ + scale พอดี ──
  const handlePrint = () => {
    const styleId = 'iv-print-portrait-style';
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = `
      @media print {
        @page { size: A4 portrait; margin: 8mm 9mm; }
        html, body { background: #fff !important; }
      }
    `;
    document.body.classList.add('iv-print-mode');
    const cleanup = () => {
      document.body.classList.remove('iv-print-mode');
      if (style.parentNode) style.parentNode.removeChild(style);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60000);
    setTimeout(() => window.print(), 50);
  };

  // ── Save as PNG — capture print layout via html2canvas, no PDF middle step ──
  const handleSaveImage = async () => {
    if (typeof window.html2canvas !== 'function') {
      alert('ตัวช่วยบันทึกรูปยังโหลดไม่เสร็จ — กรุณาลองใหม่อีกครั้ง');
      return;
    }
    document.body.classList.add('iv-print-mode');
    document.body.classList.add('iv-snapshot-mode'); // marker → CSS เฉพาะตอน save-as-image
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const target = document.querySelector('.iv-report-page') || document.body;
    // บังคับ render width คงที่ → output 1080 จะหน้าตาเหมือนกันทุกจอ
    const SRC_W = 960;
    const prevWidth = target.style.width;
    const prevMaxWidth = target.style.maxWidth;
    const prevMargin = target.style.margin;
    target.style.setProperty('width', SRC_W + 'px', 'important');
    target.style.setProperty('max-width', SRC_W + 'px', 'important');
    target.style.setProperty('margin', '0 auto', 'important');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      const raw = await window.html2canvas(target, {
        backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false, width: SRC_W, windowWidth: SRC_W,
      });
      // Fix กว้าง 1080 (สูงปล่อยตามเนื้อหา) + ขอบขาวรอบทุกด้าน 32px
      const W = 1080;
      const padX = 32, padY = 32;
      const drawW = W - padX * 2;
      const s = drawW / raw.width;
      const drawH = raw.height * s;
      const out = document.createElement('canvas');
      out.width = W;
      out.height = Math.round(drawH + padY * 2);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(raw, padX, padY, drawW, drawH);

      const link = document.createElement('a');
      const stamp = (today instanceof Date ? today : new Date()).toISOString().slice(0, 10).replace(/-/g, '');
      link.download = `iv-tracking-${stamp}.png`;
      link.href = out.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('save image failed', err);
      alert('บันทึกรูปไม่สำเร็จ: ' + (err && err.message ? err.message : err));
    } finally {
      target.style.width = prevWidth;
      target.style.maxWidth = prevMaxWidth;
      target.style.margin = prevMargin;
      document.body.classList.remove('iv-print-mode');
      document.body.classList.remove('iv-snapshot-mode');
    }
  };

  return (
    <div className="page iv-report-page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">รายงานติดตามใบแจ้งหนี้คงค้าง</h1>
          <div className="page-sub">
            ข้อมูล ณ {fmtDate(today)} · ค้างชำระ {pending.length} ใบ · รวม {rows.length} ใบ
          </div>
        </div>
        <div className="page-head-r">
          <ExportButton
            rows={rows}
            columns={[
              { key: 'jobNo',           label: 'JOB NO.' },
              { key: 'ivNo',            label: 'เลขที่ IV' },
              { key: 'invoiceDate',     label: 'วันที่ออก IV',   type: 'date' },
              { key: 'projectName',     label: 'ชื่อโครงการ' },
              { key: 'balance',         label: 'ยอดค้างชำระ', type: 'number' },
              { key: 'assignee',        label: 'ผู้รับโอนสิทธิ์' },
              { key: 'debt',            label: 'ภาระหนี้',   type: 'number' },
              { key: 'netExpected',     label: 'คาดรับสุทธิ', type: 'number' },
              { key: 'expectedReceive', label: 'วันคาดรับเงิน', type: 'date' },
              { key: 'status',          label: 'สถานะ' },
            ]}
            filename="iv_tracking_report"
            sheetName="ติดตาม IV"
            title="รายงานติดตามใบแจ้งหนี้คงค้าง"
          />
          <button className="btn btn-ghost" onClick={handleSaveImage} title="บันทึกหน้านี้เป็นรูป PNG (เลย์เอาท์ A4 แนวตั้ง)">
            <Icon name="download" size={14} /> บันทึกเป็นรูป
          </button>
          <button className="btn btn-ghost" onClick={handlePrint} title="พิมพ์ A4 แนวตั้ง (Ctrl+P)">
            <Icon name="print" size={14} /> พิมพ์ / PDF
          </button>
        </div>
      </div>

      {/* Top toolbar — invType filter (hidden on print/snapshot) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }} className="anim-in no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>กรองประเภท:</span>
          {[
            { k: 'all', label: 'ทั้งหมด',           bg: '#f8fafc', color: '#2d3748', bd: '#cbd5e0' },
            { k: 'P',   label: '📋 โครงการ (P)',    bg: '#ebf8ff', color: '#1e4fbd', bd: '#63b3ed' },
            { k: 'O',   label: '🛒 อื่นๆ (O)',       bg: '#faf5ff', color: '#6b46c1', bd: '#b794f4' },
          ].map(t => {
            const active = ivTypeFilter === t.k;
            return (
              <button key={t.k} onClick={() => setIvTypeFilter(t.k)}
                style={{
                  fontSize: 12, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
                  border: `1.5px solid ${active ? t.bd : 'transparent'}`,
                  background: active ? t.bg : 'transparent',
                  color: active ? t.color : 'var(--ink-500)',
                  fontWeight: active ? 700 : 500,
                }}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Print-only header — แสดงเฉพาะตอนพิมพ์ */}
      <div className="iv-print-header" style={{ display: 'none' }}>
        <div className="iv-print-brand">
          <div className="iv-print-logo">
            <img src="bioaxel_logo.png" alt="BIOAXEL" />
          </div>
          <div>
            <div className="iv-print-co">BIOAXEL</div>
            <div className="iv-print-title">รายงานติดตามใบแจ้งหนี้คงค้าง</div>
            <div className="iv-print-sub">IV Tracking Report</div>
          </div>
        </div>
        <div className="iv-print-date">
          <div className="iv-print-date-big">{fmtDate(today)}</div>
          <div className="iv-print-date-sub">ค้างชำระ {pending.length} ใบ</div>
        </div>
      </div>

      <IvReportView rows={rows} onOpen={setDetail} />

      <InvoiceDetailModal
        iv={detail}
        onClose={() => setDetail(null)}
        onSave={save}
        bankAccounts={data.bankAccounts}
        projects={data.projects}
        financeByCode={financeByCode}
        projectByCode={projectByCode}
      />

      <QuickPayModal
        open={!!payModal}
        iv={payModal?.iv}
        draft={payModal?.draft}
        bankAccounts={data.bankAccounts}
        onChangeDraft={(patch) => setPayModal(pm => pm ? { ...pm, draft: { ...pm.draft, ...patch } } : pm)}
        onConfirm={(ar) => {
          save({ ...payModal.iv, status: 'paid', actualReceive: ar });
          setPayModal(null);
        }}
        onCancel={() => setPayModal(null)}
      />
    </div>
  );
}

Object.assign(window, { InvoicesPage, IvReportStandalonePage });
