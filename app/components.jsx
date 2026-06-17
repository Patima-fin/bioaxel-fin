// BIOAXEL Financial Dashboard – shared UI primitives.
// Globals: React, ReactDOM

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── Formatters ──────────────────────────────────────────────────────────────
const TH_LOCALE = 'th-TH';
function fmtNum(n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString(TH_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtInt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString(TH_LOCALE);
}
function fmtMoney(n, opts = {}) {
  if (n == null || isNaN(n)) return '—';
  const { compact = false, digits = 2, sign = false } = opts;
  const abs = Math.abs(n);
  if (compact && abs >= 1_000_000) return (sign && n > 0 ? '+' : '') + (n / 1_000_000).toLocaleString(TH_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ลบ.';
  if (compact && abs >= 1000)     return (sign && n > 0 ? '+' : '') + (n / 1000).toLocaleString(TH_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' พัน';
  return (sign && n > 0 ? '+' : '') + Number(n).toLocaleString(TH_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
// Robust date parser — รองรับ ISO (YYYY-MM-DD), DD/MM/YYYY (Thai), MM/DD/YYYY (US), Date object
function parseDateFlexible(v) {
  if (v == null || v === '') return null;
  // already Date object
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  // ISO: YYYY-MM-DD or YYYY-MM-DDT...
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  // DD/MM/YYYY or DD/MM/YY — Thai/EU format (priority)
  // กรณีนี้ user paste จาก Google Sheets ที่ตั้ง locale Thai
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (m) {
    let [_, a, b, y] = m;
    let yi = parseInt(y, 10);
    if (yi < 100) yi += 2000;
    // Convert พ.ศ. → ค.ศ. (รองรับปีพศ เช่น 2569 → 2026)
    if (yi > 2400) yi -= 543;
    const a1 = parseInt(a, 10), b1 = parseInt(b, 10);
    // Use DD/MM if first part > 12 (definitely day), else assume DD/MM for Thai
    if (a1 > 12) {
      // a = day, b = month
      const d = new Date(yi, b1 - 1, a1);
      return isNaN(d) ? null : d;
    } else if (b1 > 12) {
      // b = day, a = month (US)
      const d = new Date(yi, a1 - 1, b1);
      return isNaN(d) ? null : d;
    } else {
      // Ambiguous — default DD/MM (Thai)
      const d = new Date(yi, b1 - 1, a1);
      return isNaN(d) ? null : d;
    }
  }
  // Fallback to native Date parser
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// ── ivReceivedDate — "วันรับเงิน" ของใบแจ้งหนี้จาก 2 แหล่ง (helper กลาง) ─────────────
// ใบ IV เก็บวันรับเงินได้ 2 ที่: actualReceive.date (JSON, มัก "ว่าง") และ actualReceiveDate
// (คอลัมน์แบน, มัก "มีค่า"). โค้ดที่กรอง/จัดกลุ่ม "รับตามวัน" โดยอ่านแค่ JSON จะพลาดใบส่วนใหญ่
// → เคส Daily (อ่าน receipts) โชว์รับเงิน แต่ IV report/Cashflow (อ่าน actualReceive.date) ไม่โชว์.
// ใช้ helper นี้ทุกที่ที่ต้องการ "วันรับเงินของใบ". คืน ISO YYYY-MM-DD หรือ '' ถ้าไม่มี.
function ivReceivedDate(iv) {
  if (!iv) return '';
  let raw = '';
  const ar = iv.actualReceive;
  if (ar) {
    if (typeof ar === 'object' && ar.date) raw = ar.date;
    else if (typeof ar === 'string') { try { const o = JSON.parse(ar); if (o && o.date) raw = o.date; } catch (_) {} }
  }
  if (!raw && iv.actualReceiveDate) raw = iv.actualReceiveDate;   // ★ fallback คอลัมน์แบน
  if (!raw) return '';
  raw = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);    // ISO อยู่แล้ว
  const d = parseDateFlexible(raw);                               // normalize DD/MM/พ.ศ.
  if (d && !isNaN(d)) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  return raw;
}

function fmtDate(iso) {
  const d = parseDateFlexible(iso);
  if (!d) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function fmtDateLong(iso) {
  const d = parseDateFlexible(iso);
  if (!d) return '—';
  return d.toLocaleDateString('th-TH-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── Excel / Print export ───────────────────────────────────────────────────
//
// exportRowsToExcel(rows, columns, opts) — write an .xlsx file
//   rows:    array of records
//   columns: [ { key, label, fmt?, type? } ]    // fmt: (value, row) => string|number
//                                                // type: 'number' | 'date' | 'text' (auto if fmt absent)
//   opts:    { filename, sheetName, title }     // title is an optional H1 row at top
//
// Uses the SheetJS library loaded from CDN in index.html.
function exportRowsToExcel(rows, columns, opts = {}) {
  if (typeof XLSX === 'undefined') {
    alert('ระบบ Export ยังไม่พร้อม (SheetJS โหลดไม่สำเร็จ) — กรุณารีเฟรชหน้า');
    return;
  }
  const cols = (columns || []).filter(c => c && c.key);
  if (!cols.length) {
    alert('ไม่มีคอลัมน์ที่ Export ได้');
    return;
  }
  const filename = (opts.filename || 'export') + '_' + new Date().toISOString().slice(0,10) + '.xlsx';
  const sheetName = (opts.sheetName || 'Sheet1').slice(0, 31);

  // Build 2D array: [headers], [...rows]
  const aoa = [];
  if (opts.title) aoa.push([opts.title]);
  aoa.push(cols.map(c => c.label || c.key));
  (rows || []).forEach(r => {
    aoa.push(cols.map(c => {
      const raw = r[c.key];
      if (c.fmt) {
        try { return c.fmt(raw, r); }
        catch (_) { return raw == null ? '' : String(raw); }
      }
      if (raw == null || raw === '') return '';
      if (c.type === 'number') {
        const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? '' : n;
      }
      if (c.type === 'date') {
        if (raw instanceof Date) return raw;
        const d = new Date(raw);
        return isNaN(d) ? String(raw) : d;
      }
      return typeof raw === 'object' ? JSON.stringify(raw) : raw;
    }));
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Auto column width based on header + sample of values
  const colWidths = cols.map((c, i) => {
    let max = (c.label || c.key || '').length;
    for (let r = 0; r < Math.min(aoa.length, 50); r++) {
      const v = aoa[r][i];
      const s = v == null ? '' : String(v);
      if (s.length > max) max = s.length;
    }
    return { wch: Math.min(60, Math.max(8, max + 2)) };
  });
  ws['!cols'] = colWidths;
  // If title row, merge across all columns
  if (opts.title) {
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

// ─── Excel-like column filter (dropdown of unique values) ─────────────────
//
// Apply to any sortable table — pair with FilterableColHeader. Parent owns
// state: `colFilters` = { [colKey]: Set<displayValue> | null }.
// `getValue(row, colKey)` returns the display string used for both rendering
// and matching. Defaults to row[colKey].
function ColFilterDropdown({ btnRef, colKey, allRows, active, getValue, getSortValue, onApply, onClose }) {
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState(null);
  const [hoverVal, setHoverVal] = useState(null);
  const selfRef = useRef(null);
  const _val = getValue || ((r, k) => { const v = r[k]; return v == null || v === '' ? '—' : String(v); });

  const allVals = useMemo(() => {
    const map = new Map();
    const sortMap = new Map();   // displayVal → ค่าที่ใช้จัดเรียง (ถ้ามี getSortValue เช่น วันที่=ISO, ยอด=number)
    allRows.forEach(r => {
      const v = _val(r, colKey);
      map.set(v, (map.get(v) || 0) + 1);
      if (getSortValue && !sortMap.has(v)) sortMap.set(v, getSortValue(r, colKey));
    });
    return [...map.entries()].sort((a, b) => {
      if (a[0] === '—') return 1; if (b[0] === '—') return -1;
      if (getSortValue) {
        const sa = sortMap.get(a[0]), sb = sortMap.get(b[0]);
        if (typeof sa === 'number' && typeof sb === 'number') return sa - sb;
        return String(sa == null ? '' : sa).localeCompare(String(sb == null ? '' : sb), 'th');
      }
      return String(a[0]).localeCompare(String(b[0]), 'th');
    });
  }, [allRows, colKey]);
  const allKeys = useMemo(() => allVals.map(([v]) => v), [allVals]);

  // draft selection: null = ทั้งหมด, Set = เฉพาะที่เลือก (รองรับ Set ว่าง = ยังไม่เลือก)
  const [draft, setDraft] = useState(() => (active && active.size ? new Set(active) : null));
  const draftSet = draft == null ? new Set(allKeys) : draft;
  const isAll = draft == null || draft.size >= allKeys.length;

  // commit draft → parent (null = ไม่กรอง). อ่านค่าล่าสุดผ่าน ref กัน stale closure
  const latest = useRef({});
  latest.current = { draft, allKeys, onApply, onClose };
  const commit = () => {
    const { draft, allKeys, onApply, onClose } = latest.current;
    onApply(!draft || draft.size === 0 || draft.size >= allKeys.length ? null : draft);
    onClose();
  };

  useEffect(() => {
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

  useEffect(() => {
    const h = (e) => {
      if (selfRef.current && !selfRef.current.contains(e.target) &&
          btnRef.current  && !btnRef.current.contains(e.target)) commit();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const q = search.trim().toLowerCase();
  const visibleVals = q ? allVals.filter(([v]) => String(v).toLowerCase().includes(q)) : allVals;
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
      <div style={{ padding: '8px 10px 6px' }}>
        <input autoFocus className="input"
          style={{ fontSize: 12, padding: '4px 8px', width: '100%', boxSizing: 'border-box' }}
          placeholder="ค้นหาใน dropdown..." value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && commit()} />
      </div>
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
      <div style={{ borderTop: '1px solid var(--ink-100)', padding: '6px 10px', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <button className="btn btn-ghost btn-sm"
          style={{ fontSize: 11, color: 'var(--bad)', padding: '2px 8px' }}
          onClick={clear}>ล้างตัวกรอง</button>
        <button className="btn btn-sm"
          style={{ fontSize: 11, padding: '2px 10px', background: 'var(--brand-500)', color: '#fff', border: 'none', borderRadius: 5 }}
          onClick={commit}>✓ ตกลง</button>
      </div>
    </div>
  );
  return ReactDOM.createPortal(dropdown, document.body);
}

// FilterableColHeader — drop-in replacement for SortHeader, adds funnel button
function FilterableColHeader({ label, sortKey, sort, sortToggle, align = 'center', width,
                               colKey, colFilters, setColFilters, openCol, setOpenCol, allRows, getValue, getSortValue }) {
  const btnRef = useRef(null);
  const active = colFilters[colKey || sortKey];
  const isActive = active && active.size > 0;
  const isOpen = openCol === (colKey || sortKey);
  const sortOn = sort.key === sortKey;
  const effectiveKey = colKey || sortKey;

  const applyFilter = (vals) => setColFilters(prev => {
    const next = { ...prev };
    if (!vals) delete next[effectiveKey]; else next[effectiveKey] = vals;
    return next;
  });

  return (
    <th style={{ width, textAlign: align, userSelect: 'none', position: 'relative' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        width: '100%', justifyContent: align === 'right' ? 'flex-end' : 'center',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: sortKey ? 'pointer' : 'default' }}
          onClick={() => sortKey && sortToggle && sortToggle(sortKey)}>
          {label}
          {sortKey && (
            <span style={{ opacity: sortOn ? 1 : 0.25, fontSize: 9, display: 'inline-flex', flexDirection: 'column', lineHeight: 1 }}>
              <span style={{ color: sortOn && sort.dir === 'asc' ? 'var(--brand-600)' : 'inherit' }}>▲</span>
              <span style={{ color: sortOn && sort.dir === 'desc' ? 'var(--brand-600)' : 'inherit', marginTop: -2 }}>▼</span>
            </span>
          )}
        </span>
        <button ref={btnRef}
          onClick={(e) => { e.stopPropagation(); setOpenCol(isOpen ? null : effectiveKey); }}
          title={isActive ? `กรองอยู่ ${active.size} ค่า` : 'กรองคอลัมน์'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            background: isActive ? 'var(--brand-500)' : 'transparent',
            color: isActive ? '#fff' : isOpen ? 'var(--brand-500)' : 'var(--ink-350,#aab)',
            border: isActive ? 'none' : `1px solid ${isOpen ? 'var(--brand-300)' : 'transparent'}`,
            borderRadius: 4, padding: '1px 3px', cursor: 'pointer',
            fontSize: 10, lineHeight: 1, flexShrink: 0,
          }}>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
            <path d="M1 1.5h8L6.2 5v3.5l-2.4-1V5L1 1.5z"/>
          </svg>
          {isActive && <span style={{ fontSize: 9, fontWeight: 700 }}>{active.size}</span>}
        </button>
      </div>
      {isOpen && (
        <ColFilterDropdown btnRef={btnRef} colKey={effectiveKey} allRows={allRows}
          active={active} getValue={getValue} getSortValue={getSortValue}
          onApply={applyFilter} onClose={() => setOpenCol(null)} />
      )}
    </th>
  );
}

// ─── Reusable export + print button ────────────────────────────────────────
// Drop-in button that calls exportRowsToExcel with the current rows. Use:
// <ExportButton rows={filtered} columns={[{key,label},..]} filename="invoices" />
function ExportButton({ rows, columns, filename, sheetName, title, label = 'Excel', icon = 'download' }) {
  return (
    <button
      className="btn btn-ghost"
      onClick={() => exportRowsToExcel(rows, columns, { filename, sheetName, title })}
      title={`ส่งออกเป็น Excel (.xlsx) — ${(rows || []).length} แถว`}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}

// Print current page using browser print dialog.
// Each page should hook .print-area / .no-print classes via styles.css @media print.
function PrintButton({ label = 'พิมพ์', icon = 'print' }) {
  return (
    <button className="btn btn-ghost" onClick={() => window.print()} title="พิมพ์หน้านี้ (Ctrl+P)">
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}

// ─── Animated number counter ─────────────────────────────────────────────────
function useCountUp(target, duration = 900, deps = []) {
  const [val, setVal] = useState(0);
  const startTime = useRef(null);
  const startVal = useRef(0);
  useEffect(() => {
    startVal.current = val;
    startTime.current = null;
    let raf;
    const tick = (t) => {
      if (startTime.current == null) startTime.current = t;
      const dt = Math.min(1, (t - startTime.current) / duration);
      const eased = 1 - Math.pow(1 - dt, 3);
      setVal(startVal.current + (target - startVal.current) * eased);
      if (dt < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [target, ...deps]);
  return val;
}

function AnimatedNumber({ value, digits = 2, prefix = '', suffix = '', duration = 900 }) {
  // ตอน snapshot/print → แสดงค่าสุดท้ายทันที (กันเลขเพี้ยนกลาง ๆ animation)
  const isStatic = typeof document !== 'undefined' && document.body && (
    document.body.classList.contains('dr-snapshot-mode') ||
    document.body.classList.contains('dr-print-mode') ||
    document.body.classList.contains('iv-snapshot-mode') ||
    document.body.classList.contains('iv-print-mode')
  );
  const v = useCountUp(value || 0, duration, [value]);
  const shown = isStatic ? (value || 0) : v;
  return <span>{prefix}{fmtNum(shown, digits)}{suffix}</span>;
}

// ─── Icons (inline SVG – minimal, no third-party) ────────────────────────────
const Icon = ({ name, size = 16, stroke = 1.6, ...rest }) => {
  const paths = {
    home:        <><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></>,
    chart:       <><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-7"/></>,
    receivables: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/></>,
    daily:       <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    projects:    <><path d="M3 7h6l2 2h10v10H3z"/></>,
    invoice:     <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
    forecast:    <><path d="M3 17l5-5 4 4 8-9"/><path d="M14 7h7v7"/></>,
    plus:        <><path d="M12 5v14M5 12h14"/></>,
    edit:        <><path d="M16 3l5 5L8 21H3v-5z"/></>,
    trash:       <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></>,
    x:           <><path d="M6 6l12 12M18 6l-12 12"/></>,
    check:       <><path d="M5 12l5 5L20 7"/></>,
    arrow:       <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    arrow_up:    <><path d="M12 19V5M5 12l7-7 7 7"/></>,
    arrow_down:  <><path d="M12 5v14M5 12l7 7 7-7"/></>,
    download:    <><path d="M12 4v12M6 12l6 6 6-6"/><path d="M4 20h16"/></>,
    print:       <><path d="M6 9V2h12v7"/><rect x="3" y="9" width="18" height="9" rx="1"/><path d="M6 18h12v4H6z"/></>,
    filter:      <><path d="M3 5h18l-7 9v6l-4-2v-4z"/></>,
    upload:      <><path d="M12 20V8M6 12l6-6 6 6"/><path d="M4 4h16"/></>,
    refresh:     <><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></>,
    search:      <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    settings:    <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    money:       <><circle cx="12" cy="12" r="9"/><path d="M9 9.5c0-1 1.3-2 3-2s3 .9 3 1.8c0 1.4-3 1.7-3 3 0 1 1.5 1.7 3 1.7M12 7v10"/></>,
    bank:        <><path d="M3 10 12 4l9 6"/><path d="M5 10v8M19 10v8M9 10v8M15 10v8"/><path d="M3 20h18"/></>,
    coin:        <><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></>,
    copy:        <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>,
    info:        <><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></>,
  };
  const p = paths[name] || <circle cx="12" cy="12" r="9"/>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {p}
    </svg>
  );
};

// ─── Modal ───────────────────────────────────────────────────────────────────
function Modal({ open, title, onClose, children, footer, wide, maxWidth }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const widthStyle = maxWidth ? { width: `min(${maxWidth}px, calc(100vw - 32px))` } : undefined;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} style={widthStyle} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <h3 className="modal-title">{title}</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="ปิด"><Icon name="x" /></button>
        </div>
        <div>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((arr) => [...arr, { id, msg, ...opts }]);
    setTimeout(() => setToasts((arr) => arr.filter((t) => t.id !== id)), opts.duration || 2200);
  }, []);
  const node = (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <Icon name="check" size={14} />
          {t.msg}
        </div>
      ))}
    </div>
  );
  return { push, node };
}

// ─── Badges ──────────────────────────────────────────────────────────────────
function Badge({ kind, dot = true, children }) {
  return <span className={`badge ${dot ? 'dot' : ''} ${kind || 'b-gray'}`}>{children}</span>;
}

// ─── KPI Tile ────────────────────────────────────────────────────────────────
function KpiTile({ label, value, unit = 'บาท', delta, deltaKind = 'neu', accent = 'var(--brand-500)', icon, digits = 2, animate = true }) {
  const v = animate ? useCountUp(value || 0, 900, [value]) : (value || 0);
  return (
    <div className="kpi">
      <div className="kpi-accent" style={{ background: accent }}/>
      <div className="kpi-label">
        {icon && <Icon name={icon} size={14} />}
        {label}
      </div>
      <div className="kpi-value">{fmtNum(v, digits)}{unit && <span className="u">{unit}</span>}</div>
      {delta != null && (
        <div className={`kpi-delta ${deltaKind}`}>
          {deltaKind === 'up' && <Icon name="arrow_up" size={11} />}
          {deltaKind === 'dn' && <Icon name="arrow_down" size={11} />}
          {delta}
        </div>
      )}
    </div>
  );
}

// ─── Editable cell helper ────────────────────────────────────────────────────
function EditableCell({ value, onChange, type = 'text', placeholder, align }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  if (!editing) {
    return (
      <span onClick={() => setEditing(true)} style={{ cursor: 'text', display: 'inline-block', width: '100%', textAlign: align || 'left' }}>
        {value || <span className="muted">{placeholder || '—'}</span>}
      </span>
    );
  }
  return (
    <input
      autoFocus
      className="input"
      type={type}
      value={v ?? ''}
      onChange={(e) => setV(type === 'number' ? Number(e.target.value) : e.target.value)}
      onBlur={() => { setEditing(false); onChange(v); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); onChange(v); }
        if (e.key === 'Escape') { setEditing(false); setV(value); }
      }}
      style={{ padding: '4px 8px', fontSize: 13, textAlign: align || 'left' }}
    />
  );
}

// ─── Sortable table helper ───────────────────────────────────────────────────
function useSortable(rows, defaultKey = null, defaultDir = 'asc') {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });
  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = typeof sort.key === 'function' ? sort.key(a) : a[sort.key];
      const bv = typeof sort.key === 'function' ? sort.key(b) : b[sort.key];
      // null/undefined go last
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // date strings (YYYY-MM-DD) compare lexically OK
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'asc' ? av - bv : bv - av;
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      return sort.dir === 'asc' ? as.localeCompare(bs, 'th') : bs.localeCompare(as, 'th');
    });
    return arr;
  }, [rows, sort]);
  const toggle = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  return { sorted, sort, toggle };
}

function SortHeader({ label, sortKey, sort, toggle, align = 'left', width }) {
  const active = sort.key === sortKey;
  return (
    <th style={{ width, textAlign: align, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggle(sortKey)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start', width: '100%' }}>
        {label}
        <span style={{ opacity: active ? 1 : 0.25, fontSize: 9, lineHeight: 1, display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{ color: active && sort.dir === 'asc' ? 'var(--brand-600)' : 'inherit' }}>▲</span>
          <span style={{ color: active && sort.dir === 'desc' ? 'var(--brand-600)' : 'inherit', marginTop: -2 }}>▼</span>
        </span>
      </span>
    </th>
  );
}

// ─── Status pill (clickable, for IV / period status changes) ─────────────────
function StatusPill({ value, options, onChange, size = 'md' }) {
  const opt = options.find(o => o.value === value) || options[0];
  return (
    <select
      className={`badge ${opt.kind || 'b-gray'}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        // ★ ต้อง inline-block — `.badge` เป็น inline-flex ซึ่งทำให้ <select> ใน Chrome
        //   ซ่อนข้อความ option ที่เลือก เหลือแค่ลูกศร (ดูเป็น "จุด") + ไม่ขึ้นสี
        display: 'inline-block',
        border: 'none',
        padding: size === 'sm' ? '2px 18px 2px 18px' : '4px 22px 4px 22px',
        fontSize: size === 'sm' ? 11 : 12,
        fontWeight: 600,
        cursor: 'pointer',
        appearance: 'none',
        WebkitAppearance: 'none',
        backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)',
        backgroundPosition: 'calc(100% - 10px) center, calc(100% - 6px) center',
        backgroundSize: '4px 4px',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ─── YmdPicker — ตัวเลือกวันที่แบบ ปี → เดือน → วัน (cascade) ─────────────────
// ใช้แทน <input type="date"> ในตัวกรอง เพื่อเลือกง่ายขึ้น (ไม่ต้องเลื่อนปฏิทินหาวัน)
// value = ISO 'YYYY-MM-DD' (ค.ศ.) | '' · onChange(iso) · เลือกปีก่อน → เดือน → วัน
const YMD_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function YmdPicker({ value, onChange, minYear, maxYear, style, size }) {
  const cur = new Date();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || ''));
  const y = m ? +m[1] : '';
  const mo = m ? +m[2] : '';
  const d = m ? +m[3] : '';
  const y0 = minYear || (cur.getFullYear() - 6);
  const y1 = maxYear || (cur.getFullYear() + 2);
  const years = []; for (let yy = y1; yy >= y0; yy--) years.push(yy);
  const daysIn = (yy, mm) => (yy && mm) ? new Date(yy, mm, 0).getDate() : 31;
  // ปี+เดือนพอ → คืน ISO (วัน default 1 ถ้ายังไม่เลือก) · ไม่มีปี/เดือน → '' (ล้างตัวกรอง)
  const emit = (ny, nmo, nd) => {
    if (!ny || !nmo) { onChange(''); return; }
    const dd = Math.min(nd || 1, daysIn(ny, nmo));
    onChange(`${ny}-${String(nmo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
  };
  const sel = {
    padding: size === 'sm' ? '4px 6px' : '6px 8px', border: '1px solid var(--line)', borderRadius: 7,
    fontSize: size === 'sm' ? 12 : 12.5, fontFamily: 'inherit', background: 'var(--panel)', color: 'var(--ink-800)', cursor: 'pointer',
  };
  return (
    <span style={{ display: 'inline-flex', gap: 5, ...style }}>
      <select style={{ ...sel, minWidth: 64 }} value={y} onChange={e => emit(+e.target.value || '', mo, d)} title="ปี (ค.ศ.)">
        <option value="">ปี</option>
        {years.map(yy => <option key={yy} value={yy}>{yy}</option>)}
      </select>
      <select style={{ ...sel, minWidth: 62 }} value={mo} onChange={e => emit(y, +e.target.value || '', d)} disabled={!y} title="เดือน">
        <option value="">เดือน</option>
        {YMD_MONTHS.slice(1).map((mm, i) => <option key={i + 1} value={i + 1}>{mm}</option>)}
      </select>
      <select style={{ ...sel, minWidth: 54 }} value={d} onChange={e => emit(y, mo, +e.target.value || '')} disabled={!mo} title="วัน">
        <option value="">วัน</option>
        {Array.from({ length: daysIn(y, mo) }, (_, i) => i + 1).map(dd => <option key={dd} value={dd}>{dd}</option>)}
      </select>
    </span>
  );
}

// ─── ErrorBoundary — กันหน้า "หายทั้งหน้า" เมื่อข้อมูลมีปัญหา (โชว์ fallback แทนจอขาว) ──
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { try { console.error('[WTP] page render error:', err, info); } catch (_) {} }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="page">
        <div className="card" style={{ padding: 32, textAlign: 'center', maxWidth: 640, margin: '40px auto' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink-800)', marginBottom: 8 }}>หน้านี้เกิดข้อผิดพลาด</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginBottom: 14 }}>
            ข้อมูลบางส่วนอาจมีปัญหา — ระบบส่วนอื่นยังทำงานปกติ · ลอง “ลองอีกครั้ง” หรือไปหน้าอื่นก่อน
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'ui-monospace', background: 'var(--ink-50,#f8fafc)', borderRadius: 8, padding: '8px 10px', marginBottom: 14, wordBreak: 'break-word', textAlign: 'left' }}>
            {String((this.state.err && this.state.err.message) || this.state.err)}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => this.setState({ err: null })}>ลองอีกครั้ง</button>
            <button className="btn btn-primary" onClick={() => location.reload()}>รีโหลดหน้า</button>
          </div>
        </div>
      </div>
    );
  }
}

// ─── Manual Override System (Cloud-shared) ──────────────────────────────────
// คีย์เลขมือทับค่าที่ระบบคำนวณ — sync ผ่าน Google Sheets (มองเห็นทุก user)
// data.manualOverrides = [{ id, key, value, updatedBy, updatedAt }, ...]
// localStorage = cache เร็ว สำหรับ cold-start ก่อน sync เสร็จ + offline fallback
// ใช้ใน Warroom รายปี + Cashflow รายสัปดาห์ + Daily Bank Balance
const OVERRIDE_LS_KEY = 'wtp-manual-overrides';
// ── Role guard — owner = ดูอย่างเดียว, ห้ามเขียน override ที่ data layer
// ป้องกันได้แม้ user จะ bypass UI (เช่น force editMode=true ใน DevTools, หรือเรียก
// WTPOverride.set() ตรงๆ จาก console)
function _wtpRoleIsReadOnly() {
  try {
    const s = JSON.parse(localStorage.getItem('wtp-session') || 'null');
    const role = (s && s.role) || 'viewer';
    return role === 'owner' || role === 'viewer';
  } catch (_) { return false; }
}
const WTPOverride = {
  // ── Local cache (instant read, offline support) ─────────────────────
  _loadLocal() { try { return JSON.parse(localStorage.getItem(OVERRIDE_LS_KEY) || '{}'); } catch (_) { return {}; } },
  _saveLocal(all) { try { localStorage.setItem(OVERRIDE_LS_KEY, JSON.stringify(all)); } catch (_) {} },

  // ── Cloud source (data.manualOverrides — shared สำหรับทุก user) ──────
  _loadCloud() {
    const arr = (window.__wtpData && window.__wtpData.manualOverrides) || [];
    const m = {};
    arr.forEach(r => { if (r && r.key != null && r.key !== '') m[r.key] = r.value; });
    return m;
  },

  // ── Authoritative read = cloud overlay บน local (local เป็น cache เร็ว)
  // ถ้า cloud ยังไม่โหลด → local จะเป็น fallback
  _load() {
    const cloud = this._loadCloud();
    const local = this._loadLocal();
    return { ...local, ...cloud };
  },

  get(key) { return this._load()[key]; },
  has(key) {
    const v = this._load()[key];
    return v !== undefined && v !== null && v !== '';
  },

  set(key, value) {
    // ★ Role guard — owner/viewer ห้ามเขียน override (ป้องกัน bypass UI)
    if (_wtpRoleIsReadOnly()) {
      console.warn('WTPOverride.set blocked — role is read-only');
      return;
    }
    // 1) Update local cache เพื่อตอบสนองทันที (ไม่รอ sync)
    const local = this._loadLocal();
    const clearing = value === null || value === '' || value === undefined;
    if (clearing) delete local[key]; else local[key] = value;
    this._saveLocal(local);

    // 2) Push to cloud via setData → trigger sync to Google Sheets
    if (typeof window.__wtpSetData === 'function') {
      let updatedBy = '';
      try { updatedBy = (JSON.parse(localStorage.getItem('wtp-session') || 'null') || {}).username || ''; } catch (_) {}
      const updatedAt = new Date().toISOString();
      window.__wtpSetData(d => {
        const arr = Array.isArray(d.manualOverrides) ? d.manualOverrides : [];
        const idx = arr.findIndex(r => r && r.key === key);
        let next;
        if (clearing) {
          next = idx >= 0 ? arr.filter((_, i) => i !== idx) : arr;
        } else {
          const id = idx >= 0 ? arr[idx].id : `ov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const row = { id, key, value: Number(value), updatedBy, updatedAt };
          next = arr.slice();
          if (idx >= 0) next[idx] = row; else next.push(row);
        }
        return { ...d, manualOverrides: next };
      });
    }

    window.dispatchEvent(new CustomEvent('wtp-override-change', { detail: { key } }));
  },

  // ── setRaw — เหมือน set แต่ "ไม่ coerce เป็น Number" → เก็บ string ได้
  //   ใช้กับ Finance Master (Project Control) ที่เก็บเป็น JSON string per โครงการ
  //   key เช่น "pcfin.<ContractNo>" · ทีมทุกคนเห็นเหมือนกันผ่าน manualOverrides sync
  setRaw(key, value) {
    if (_wtpRoleIsReadOnly()) { console.warn('WTPOverride.setRaw blocked — read-only'); return; }
    const local = this._loadLocal();
    const clearing = value === null || value === '' || value === undefined;
    if (clearing) delete local[key]; else local[key] = value;
    this._saveLocal(local);
    if (typeof window.__wtpSetData === 'function') {
      let updatedBy = ''; try { updatedBy = (JSON.parse(localStorage.getItem('wtp-session') || 'null') || {}).username || ''; } catch (_) {}
      const updatedAt = new Date().toISOString();
      window.__wtpSetData(d => {
        const arr = Array.isArray(d.manualOverrides) ? d.manualOverrides : [];
        const idx = arr.findIndex(r => r && r.key === key);
        let next;
        if (clearing) { next = idx >= 0 ? arr.filter((_, i) => i !== idx) : arr; }
        else {
          const id = idx >= 0 ? arr[idx].id : `ov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const row = { id, key, value, updatedBy, updatedAt }; // ← เก็บ value ดิบ (ไม่ Number())
          next = arr.slice(); if (idx >= 0) next[idx] = row; else next.push(row);
        }
        return { ...d, manualOverrides: next };
      });
    }
    window.dispatchEvent(new CustomEvent('wtp-override-change', { detail: { key } }));
  },

  // ── Batch write — เขียนหลาย key ในครั้งเดียว (1 setData → push sync รอบเดียว)
  //   entries = { key: value, ... } · value === null/''/undefined = ลบคีย์นั้น
  //   ใช้ตอน freeze baseline ราย IV (หลายสิบคีย์) จะได้ไม่ยิง setData ทีละตัว
  setMany(entries) {
    if (_wtpRoleIsReadOnly()) {
      console.warn('WTPOverride.setMany blocked — role is read-only');
      return;
    }
    if (!entries || typeof entries !== 'object') return;
    const keys = Object.keys(entries);
    if (keys.length === 0) return;
    const isClearing = (v) => v === null || v === '' || v === undefined;

    // 1) Local cache
    const local = this._loadLocal();
    keys.forEach(k => { if (isClearing(entries[k])) delete local[k]; else local[k] = entries[k]; });
    this._saveLocal(local);

    // 2) Push to cloud (one setData update for the whole batch)
    if (typeof window.__wtpSetData === 'function') {
      let updatedBy = '';
      try { updatedBy = (JSON.parse(localStorage.getItem('wtp-session') || 'null') || {}).username || ''; } catch (_) {}
      const updatedAt = new Date().toISOString();
      window.__wtpSetData(d => {
        const arr = Array.isArray(d.manualOverrides) ? d.manualOverrides.slice() : [];
        keys.forEach(key => {
          const idx = arr.findIndex(r => r && r.key === key);   // recompute each iter (arr mutates)
          if (isClearing(entries[key])) {
            if (idx >= 0) arr.splice(idx, 1);
          } else {
            const id = idx >= 0 ? arr[idx].id : `ov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_${String(key).slice(0, 8)}`;
            const row = { id, key, value: Number(entries[key]), updatedBy, updatedAt };
            if (idx >= 0) arr[idx] = row; else arr.push(row);
          }
        });
        return { ...d, manualOverrides: arr };
      });
    }

    window.dispatchEvent(new CustomEvent('wtp-override-change', { detail: { key: '*' } }));
  },

  clear(key) { this.set(key, null); },

  clearAll() {
    if (_wtpRoleIsReadOnly()) {
      console.warn('WTPOverride.clearAll blocked — role is read-only');
      return;
    }
    this._saveLocal({});
    if (typeof window.__wtpSetData === 'function') {
      window.__wtpSetData(d => ({ ...d, manualOverrides: [] }));
    }
    window.dispatchEvent(new CustomEvent('wtp-override-change', { detail: { key: '*' } }));
  },

  resolve(key, computed) {
    const v = this._load()[key];
    if (v === undefined || v === null || v === '') return computed;
    const n = Number(v);
    return isNaN(n) ? computed : n;
  },

  // ── Diagnostic — เช็คว่า cloud sync ทำงานหรือไม่ ──────────────────
  // เรียกใน DevTools console:  WTPOverride.diagnose()
  diagnose() {
    const local = this._loadLocal();
    const cloud = this._loadCloud();
    const localKeys = Object.keys(local);
    const cloudKeys = Object.keys(cloud);
    const onlyLocal = localKeys.filter(k => !(k in cloud));
    const onlyCloud = cloudKeys.filter(k => !(k in local));
    const dataHasField = window.__wtpData && Array.isArray(window.__wtpData.manualOverrides);
    const dataLen = dataHasField ? window.__wtpData.manualOverrides.length : null;
    console.group('🔍 WTPOverride diagnose');
    console.log('Local cache (localStorage)         :', localKeys.length, 'keys'); console.table(local);
    console.log('Cloud (data.manualOverrides)       :', cloudKeys.length, 'keys'); console.table(cloud);
    console.log('data.manualOverrides loaded?       :', dataHasField, '(length =', dataLen, ')');
    console.log('Only local (ยังไม่ขึ้น cloud)       :', onlyLocal);
    console.log('Only cloud (มาจาก user อื่น)       :', onlyCloud);
    if (!dataHasField) {
      console.warn('⚠ data.manualOverrides ยังไม่โหลด — Apps Script อาจยังไม่ได้ deploy หรือชีตยังไม่มี');
    } else if (onlyLocal.length > 0) {
      console.warn('⚠ มี', onlyLocal.length, 'override ที่ยังไม่ได้ push ขึ้น cloud — เรียก WTPOverride.forceSync() เพื่อ push');
    } else {
      console.log('✅ Cloud + local ตรงกัน — user คนอื่นเห็นค่าเดียวกัน');
    }
    console.groupEnd();
    return { localKeys, cloudKeys, onlyLocal, onlyCloud, dataHasField, dataLen };
  },

  // ── Force resync — ดัน local overrides ทั้งหมดขึ้น cloud (manual rescue)
  forceSync() {
    if (_wtpRoleIsReadOnly()) {
      console.warn('WTPOverride.forceSync blocked — role is read-only');
      return 0;
    }
    const local = this._loadLocal();
    const keys = Object.keys(local);
    if (keys.length === 0) { console.log('ไม่มี override ใน localStorage'); return 0; }
    if (typeof window.__wtpSetData !== 'function') { console.error('window.__wtpSetData ยังไม่ ready'); return 0; }
    let updatedBy = '';
    try { updatedBy = (JSON.parse(localStorage.getItem('wtp-session') || 'null') || {}).username || ''; } catch (_) {}
    const updatedAt = new Date().toISOString();
    window.__wtpSetData(d => {
      const arr = Array.isArray(d.manualOverrides) ? d.manualOverrides.slice() : [];
      keys.forEach(key => {
        const idx = arr.findIndex(r => r && r.key === key);
        const id = idx >= 0 ? arr[idx].id : `ov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_${key.slice(0, 8)}`;
        const row = { id, key, value: Number(local[key]), updatedBy, updatedAt };
        if (idx >= 0) arr[idx] = row; else arr.push(row);
      });
      return { ...d, manualOverrides: arr };
    });
    if (typeof WTPData !== 'undefined' && WTPData.forceSyncNow) {
      setTimeout(() => WTPData.forceSyncNow(), 100);
    }
    console.log('✅ Pushed', keys.length, 'overrides → cloud (รอ sync ~2 วินาที)');
    return keys.length;
  },
};

// Subscribe helper — เรียก setState เมื่อมี override เปลี่ยน (ของ key นี้ หรือ '*')
function useOverrideSub(key) {
  const [, force] = useState(0);
  useEffect(() => {
    const h = (e) => {
      const k = e.detail && e.detail.key;
      if (k === '*' || k === key) force(x => x + 1);
    };
    window.addEventListener('wtp-override-change', h);
    return () => window.removeEventListener('wtp-override-change', h);
  }, [key]);
}

// useOverrideSubAny — re-render ทุกครั้งที่มี override เปลี่ยน (ใช้ที่ระดับ page)
// เพื่อให้ค่า resolved ที่อยู่นอก <EditableNumber> (เช่น sum, total) อัปเดตด้วย
function useOverrideSubAny() {
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force(x => x + 1);
    window.addEventListener('wtp-override-change', h);
    return () => window.removeEventListener('wtp-override-change', h);
  }, []);
}

/**
 * EditableNumber — ตัวเลขที่เมื่อ editMode=true จะคลิกแก้ได้
 * - ovKey      : คีย์เฉพาะของ field (เช่น 'wr2.heroTotal')
 * - computed   : ค่าที่ระบบคำนวณ (ใช้เป็น fallback ถ้ายังไม่มี override)
 * - editMode   : true = แสดง <input>, false = แสดงข้อความ
 * - format     : (n) => 'string'  ของแสดงตอน view mode (default fmtNum 2 ตำแหน่ง)
 * - digits     : ทศนิยมตอน format (default 2)
 * - style      : CSS ของกล่อง outer
 * - showBadge  : แสดง ✏️ ตัวเล็กข้างเลขเมื่อมี override (default true)
 */
function EditableNumber({ ovKey, computed, editMode, format, digits = 2, style, showBadge = true, suffix = '' }) {
  useOverrideSub(ovKey);
  const overridden = WTPOverride.has(ovKey);
  const value      = WTPOverride.resolve(ovKey, computed);
  const fmt = format || ((n) => fmtNum(n, digits));

  // ★ owner/viewer = ดูอย่างเดียว — ไม่ให้เปิด input ได้ แม้จะถูกบังคับ editMode=true
  const effectiveEditMode = editMode && !_wtpRoleIsReadOnly();

  if (effectiveEditMode) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number"
          step="0.01"
          defaultValue={overridden ? value : ''}
          placeholder={fmt(computed)}
          onBlur={(e) => {
            const raw = e.target.value;
            if (raw === '') { WTPOverride.clear(ovKey); return; }
            const n = parseFloat(raw);
            if (!isNaN(n)) WTPOverride.set(ovKey, n);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = overridden ? value : ''; e.target.blur(); } }}
          style={{
            ...style,
            minWidth: 80,
            padding: '4px 8px',
            border: `1.5px solid ${overridden ? 'var(--brand-500)' : 'var(--ink-200)'}`,
            borderRadius: 6,
            background: overridden ? 'color-mix(in oklch, var(--brand-500) 6%, white)' : 'white',
            textAlign: 'right',
            fontFamily: 'ui-monospace',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
            fontSize: 'inherit',
            color: 'inherit',
          }}
        />
        {overridden && (
          <button
            type="button"
            onClick={() => WTPOverride.clear(ovKey)}
            title="ล้างค่าที่กรอกเอง — กลับไปใช้ค่าระบบคำนวณ"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--bad)', fontSize: 14, padding: 0 }}
          >✕</button>
        )}
      </span>
    );
  }

  // ★ ซ่อน badge ดินสอสำหรับ owner — ดูอย่างเดียว ไม่ต้องเห็นว่าค่าไหนถูกแก้มือ
  const showPencil = showBadge && overridden && !_isOwnerOnly();

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, ...style }}>
      <span>{fmt(value)}{suffix}</span>
      {showPencil && (
        <span
          title="ค่าที่กรอกมือ (override)"
          style={{
            fontSize: 9,
            background: 'var(--brand-500)',
            color: 'white',
            padding: '1px 4px',
            borderRadius: 3,
            fontWeight: 700,
            letterSpacing: '.05em',
            verticalAlign: 'baseline',
          }}
        >✏️</span>
      )}
    </span>
  );
}

/**
 * EditModeToggle — ปุ่ม toggle ที่ใช้ใส่ในหัวหน้า
 *   <EditModeToggle value={editMode} onChange={setEditMode} />
 */
// ─── Role helper — อ่าน role ของ current user จาก localStorage session
// owner = สิทธิ์ดูอย่างเดียว (ผู้บริหาร) → ซ่อนปุ่มแก้ไขด้วยมือ
function _getCurrentRole() {
  try {
    const s = JSON.parse(localStorage.getItem('wtp-session') || 'null');
    return (s && s.role) || 'viewer';
  } catch (_) { return 'viewer'; }
}
function _isOwnerOnly() { return _getCurrentRole() === 'owner'; }

// ─── CloudSyncStatusButton — ปุ่มเช็คสถานะ cloud sync (เห็นค่าทุก user หรือไม่)
// คลิกครั้งเดียว: เช็คสถานะ + auto force-sync ถ้ามีค่าค้าง + แสดงผลใน alert
// ★ ซ่อนปุ่มนี้สำหรับ role=owner — เพราะ owner ดูอย่างเดียว ไม่ได้กรอกค่า
function CloudSyncStatusButton() {
  // Hooks ต้องเรียกก่อน early return (rules of hooks)
  useOverrideSubAny();
  const [busy, setBusy] = useState(false);
  if (_isOwnerOnly()) return null;
  const local = WTPOverride._loadLocal();
  const cloud = WTPOverride._loadCloud();
  const localKeys = Object.keys(local);
  const cloudKeys = Object.keys(cloud);
  const onlyLocal = localKeys.filter(k => !(k in cloud));
  const dataReady = window.__wtpData && Array.isArray(window.__wtpData.manualOverrides);

  // status: 'ok' (cloud=local), 'pending' (มีค่าที่ยังไม่ขึ้น cloud), 'error' (cloud ไม่ทำงาน)
  const status = !dataReady ? 'error' : onlyLocal.length > 0 ? 'pending' : 'ok';
  const styleByStatus = {
    ok:      { bg: '#ecfdf5', border: '#10b981', color: '#065f46', icon: '☁️ ✓', label: 'ค่าทั้งหมดแชร์แล้ว' },
    pending: { bg: '#fffbeb', border: '#f59e0b', color: '#92400e', icon: '⚠️',     label: `ยังไม่แชร์ ${onlyLocal.length} ค่า` },
    error:   { bg: '#fef2f2', border: '#dc2626', color: '#991b1b', icon: '✕',     label: 'Cloud ไม่ทำงาน' },
  }[status];

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (status === 'error') {
        alert(
          '⚠ ระบบ Cloud Sync ยังไม่ทำงาน\n\n' +
          'สาเหตุที่เป็นไปได้:\n' +
          '1. Apps Script ยังไม่ได้ deploy โค้ดใหม่\n' +
          '2. ชีต "manualOverrides" ใน Google Sheet ยังไม่ถูกสร้าง\n' +
          '3. กำลังโหลดข้อมูล — รอสักครู่แล้วลองใหม่\n\n' +
          'ตอนนี้ค่าที่แนนกรอกอยู่เฉพาะเครื่องนี้ ไม่เห็นจากเครื่องอื่น'
        );
        return;
      }
      if (status === 'ok') {
        alert(
          '✅ Cloud Sync ทำงานปกติ\n\n' +
          `• ค่าที่กรอกในเครื่องนี้: ${localKeys.length} ค่า\n` +
          `• ค่าที่อยู่บน Cloud: ${cloudKeys.length} ค่า\n` +
          '• ✓ ทุกค่าซิงค์แล้ว — เครื่องอื่น/ผู้บริหารจะเห็นทันทีหลัง refresh'
        );
        return;
      }
      // status === 'pending' — auto force-sync
      const n = WTPOverride.forceSync();
      // wait a moment then re-check
      setTimeout(() => {
        alert(
          `⬆️ กำลังอัปโหลด ${n} ค่าขึ้น Cloud\n\n` +
          'รอประมาณ 5 วินาที จากนั้นเครื่องอื่นจะเห็นค่าใหม่หลัง refresh\n\n' +
          'หมายเหตุ: ถ้ายังไม่ขึ้นหลังจากนี้ แสดงว่า Apps Script ยังไม่ deploy หรือชีต manualOverrides ยังไม่มี'
        );
      }, 200);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title="คลิกเพื่อตรวจสอบ/อัปโหลดค่าที่กรอกขึ้น Cloud (เพื่อให้ผู้บริหารและเครื่องอื่นเห็น)"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 18,
        border: `1.5px solid ${styleByStatus.border}`,
        background: styleByStatus.bg,
        color: styleByStatus.color,
        cursor: busy ? 'wait' : 'pointer',
        fontSize: 12.5, fontWeight: 700,
        transition: 'all .15s',
        opacity: busy ? .6 : 1,
      }}
    >
      <span>{styleByStatus.icon}</span>
      <span>{styleByStatus.label}</span>
    </button>
  );
}

function EditModeToggle({ value, onChange, label = 'โหมดแก้ไข' }) {
  // ★ ซ่อนปุ่มสำหรับ role=owner — owner ดูอย่างเดียว ไม่ได้แก้ไขค่า
  if (_isOwnerOnly()) return null;
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      title={value ? 'ปิดโหมดแก้ไข (กลับไปดูปกติ)' : 'เปิดโหมดแก้ไข (คีย์เลขเองทับค่าระบบ)'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 14px',
        borderRadius: 18,
        border: `1.5px solid ${value ? 'var(--brand-500)' : 'var(--ink-200)'}`,
        background: value ? 'var(--brand-500)' : 'white',
        color: value ? 'white' : 'var(--ink-700)',
        cursor: 'pointer',
        fontSize: 12.5,
        fontWeight: 600,
        transition: 'all .15s',
      }}
    >
      <span style={{ fontSize: 13 }}>✏️</span>
      {value ? `${label} ON` : label}
    </button>
  );
}

// ─── Export to globals ───────────────────────────────────────────────────────
Object.assign(window, {
  fmtNum, fmtInt, fmtMoney, fmtDate, fmtDateLong, parseDateFlexible,
  useCountUp, AnimatedNumber, Icon, Modal, useToasts, Badge, KpiTile, EditableCell,
  useSortable, SortHeader, StatusPill,
  exportRowsToExcel, ExportButton, PrintButton,
  ColFilterDropdown, FilterableColHeader,
  WTPOverride, EditableNumber, EditModeToggle, useOverrideSub, useOverrideSubAny,
  CloudSyncStatusButton,
});
