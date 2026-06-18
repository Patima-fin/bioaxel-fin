// 4 data-management CRUD pages: forecast entries / bank / PS notes / payables.
// Globals: React, Modal, Icon, Badge, KpiTile, fmtNum, fmtMoney, fmtDate, useToasts, ForecastEntryModal

const { useState: dxState, useMemo: dxMemo, useEffect: dxEffect } = React;

// ─── Generic CRUD page ────────────────────────────────────────────────────────
function DataCrudPage({ data, setData, toast, config }) {
  // Role gating — viewer/owner can only see; staff can edit but not delete;
  // manager can do everything. Page config can downgrade further (allowDelete).
  const userCanEdit   = window.WTPAuth ? window.WTPAuth.can('canEdit')   : true;
  const userCanDelete = window.WTPAuth ? window.WTPAuth.can('canDelete') : true;
  const effectiveReadOnly = config.readOnlyRows || !userCanEdit;
  const effectiveAllowDelete = (config.allowDelete || !config.readOnlyRows) && userCanDelete;

  const [edit, setEdit] = dxState(null);
  const [view, setView] = dxState(null);  // popup for viewing row details (read-only)
  const [query, setQuery] = dxState('');
  const [filter, setFilter] = dxState('all');
  const [sortKey, setSortKey] = dxState(null);
  const [sortDir, setSortDir] = dxState('asc');
  // Bulk-select mode — off by default; user toggles ON when they want to
  // multi-select for delete/export. Hides checkbox column otherwise.
  const [bulkMode, setBulkMode] = dxState(false);
  const [selected, setSelected] = dxState(() => new Set());
  // Import modal state (generic paste/upload for any DataCrudPage)
  const [showImport, setShowImport]   = dxState(false);
  const [importText, setImportText]   = dxState('');
  const [importStats, setImportStats] = dxState(null);   // {added, changed, skipped, deleted, errors}
  const [importPreview, setImportPreview] = dxState(null);   // {added, changed, unchanged, missing} when dedupKey diff is ready
  const [deleteMissingChoice, setDeleteMissingChoice] = dxState(false);
  const [importHelpOpen, setImportHelpOpen]   = dxState(false);
  const [importPasteOpen, setImportPasteOpen] = dxState(false);
  const [importDragOver, setImportDragOver]   = dxState(false);
  const [importFileName, setImportFileName]   = dxState('');
  // Clear selection whenever the filter/search/mode changes
  dxEffect(() => { setSelected(new Set()); }, [filter, query, bulkMode]);
  // Excel-like per-column filters — { [colKey]: Set<displayValue> }
  const [colFilters, setColFilters] = dxState({});
  const [openCol, setOpenCol] = dxState(null);
  // Helper: get display value for a column (uses column config's render if applicable, else raw)
  const colDisplay = (row, colKey) => {
    const col = config.columns.find(c => c.key === colKey);
    if (!col) return String(row[colKey] ?? '—');
    const raw = row[colKey];
    if (raw == null || raw === '') return '—';
    if (col.type === 'date') return fmtDate(raw) || String(raw);
    if (col.type === 'money' || col.numeric) return fmtNum(raw, col.digits ?? 2);
    return String(raw);
  };

  // config.hideRow(row, data) → true = ซ่อนจากการแสดงผล (ไม่แตะข้อมูลในชีต — แค่ไม่โชว์)
  const rows = (data[config.dataKey] || []).filter(r => !(config.hideRow && config.hideRow(r, data)));

  const filtered = dxMemo(() => {
    let xs = rows;
    if (config.filters && filter !== 'all') {
      xs = xs.filter(r => config.filterFn(r, filter));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      xs = xs.filter(r => config.searchKeys.some(k => String(r[k] || '').toLowerCase().includes(q)));
    }
    // Apply per-column filters (Excel-like)
    const activeKeys = Object.keys(colFilters).filter(k => colFilters[k] && colFilters[k].size > 0);
    if (activeKeys.length > 0) {
      xs = xs.filter(r => activeKeys.every(k => colFilters[k].has(colDisplay(r, k))));
    }
    return xs;
  }, [rows, filter, query, colFilters]);

  const sortedFiltered = dxMemo(() => {
    if (!sortKey) return filtered;
    const col = config.columns.find(c => c.key === sortKey);
    const getVal = col?.sortValue ? col.sortValue : (r) => r[sortKey];
    return [...filtered].sort((a, b) => {
      const av = getVal(a), bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      const as = String(av).toLowerCase(), bs = String(bv).toLowerCase();
      return sortDir === 'asc' ? as.localeCompare(bs, 'th') : bs.localeCompare(as, 'th');
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sort = { key: sortKey, dir: sortDir };

  const save = (row) => {
    setData(d => ({
      ...d,
      [config.dataKey]: row.id
        ? d[config.dataKey].map(x => x.id === row.id ? row : x)
        : [{ ...row, id: WTPData.newId() }, ...d[config.dataKey]],
    }));
    setEdit(null);
    toast('บันทึกข้อมูลแล้ว');
  };
  const remove = (id) => {
    if (!confirm('ยืนยันการลบรายการนี้?')) return;
    setData(d => ({ ...d, [config.dataKey]: d[config.dataKey].filter(x => x.id !== id) }));
    toast('ลบรายการแล้ว');
  };

  // Bulk-delete: filter out everything currently in `selected`
  const bulkRemove = () => {
    if (selected.size === 0) return;
    if (!confirm(`ยืนยันการลบ ${selected.size} รายการที่เลือก?`)) return;
    setData(d => ({
      ...d,
      [config.dataKey]: (d[config.dataKey] || []).filter(r => !selected.has(r.id)),
    }));
    toast(`ลบแล้ว ${selected.size} รายการ`);
    setSelected(new Set());
  };

  const toggleSelectOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Import (Template + Paste/Upload) ─────────────────────────────────────
  // Get importable fields (skip section markers; expose key + label + type)
  const importFields = dxMemo(
    () => (config.modalFields || [])
      .filter(f => f.type !== 'section' && f.key)
      .map(f => ({ key: f.key, label: f.label, type: f.type, options: f.options })),
    [config.modalFields]
  );

  // Full canonical schema keys for this entity (from emptyRow) — so import keeps
  // EVERY column the file provides, not just the curated edit-modal subset.
  const schemaKeys = dxMemo(() => Object.keys(config.emptyRow || {}), [config.emptyRow]);
  // Optional per-config synonym map: { 'หัวคอลัมน์ในไฟล์ (lowercase)': 'canonicalKey' }
  const headerAliases = dxMemo(() => {
    const out = {};
    Object.entries(config.headerAliases || {}).forEach(([k, v]) => { out[String(k).trim().toLowerCase()] = v; });
    return out;
  }, [config.headerAliases]);

  // Build a "label → key" lookup (also matches plain key). Returns { map, unmapped }.
  // map: { colIdx → canonicalKey };  unmapped: [headerText…] that matched nothing (shown to user).
  const buildHeaderMap = (headers) => {
    const map = {};
    const unmapped = [];
    headers.forEach((h, idx) => {
      const norm = String(h || '').trim();
      if (!norm) return;
      const lc = norm.toLowerCase();
      // 1) exact key match (curated form field)
      let key = (importFields.find(x => x.key === norm) || {}).key;
      // 2) exact label match
      if (!key) key = (importFields.find(x => x.label === norm) || {}).key;
      // 3) label prefix before separator (e.g. "DATE — วันที่บันทึก" vs "DATE")
      if (!key) key = (importFields.find(x => String(x.label || '').split(/[—\-—:·\(]/)[0].trim() === norm) || {}).key;
      // 4) startsWith case-insensitive (curated form field)
      if (!key) key = (importFields.find(x => x.key.toLowerCase() === lc
                                 || String(x.label||'').toLowerCase().startsWith(lc)) || {}).key;
      // 5) explicit synonym alias for this entity
      if (!key && headerAliases[lc]) key = headerAliases[lc];
      // 6) exact canonical schema key (case-insensitive) — passthrough full RAW columns
      if (!key) key = schemaKeys.find(k => k === norm || k.toLowerCase() === lc);
      if (key) map[idx] = key; else unmapped.push(norm);
    });
    return { map, unmapped };
  };

  // Detect date format from a column's sample values
  //   'MMDD' = MM/DD/YYYY (US/Excel default)  — เจอเมื่อค่าใดมี first part > 12
  //   'DDMM' = DD/MM/YYYY (Thai standard)    — default ถ้าตรวจไม่ได้
  //   'ISO'  = YYYY-MM-DD                    — already canonical
  const detectDateFormat = (samples) => {
    let ddmmHits = 0, mmddHits = 0;
    for (const s of samples) {
      if (!s) continue;
      const m = String(s).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-]\d{2,4}$/);
      if (!m) continue;
      const a = +m[1], b = +m[2];
      // a is "first part" = day in DD/MM, month in MM/DD
      if (a > 12 && b <= 12) ddmmHits++;
      else if (b > 12 && a <= 12) mmddHits++;
      // else: both ≤ 12, ambiguous
    }
    if (mmddHits > ddmmHits) return 'MMDD';
    return 'DDMM';   // default — Thai standard, also matches DDMM auto-detection
  };

  const coerceVal = (raw, type, dateFmt) => {
    if (raw == null) return '';
    const s = String(raw).trim();
    if (s === '') return '';
    if (type === 'number') {
      // accept "1,234.56" or "-1234" or "(1234)" accounting style
      let v = s.replace(/,/g, '').replace(/[฿$\s]/g, '');
      if (/^\(.*\)$/.test(v)) v = '-' + v.slice(1, -1);
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    }
    if (type === 'date') {
      // accept "2026-05-26" / "26/05/2026" / "26/5/26" / Excel serial
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (m1) {
        let [, a, b, yy] = m1;
        // dateFmt = 'MMDD' → a=month b=day; default DDMM → a=day b=month
        let dd, mm;
        if (dateFmt === 'MMDD') { mm = a; dd = b; }
        else { dd = a; mm = b; }
        if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
        // Thai Buddhist year support (e.g., 2569 → 2026)
        if (Number(yy) > 2400) yy = String(Number(yy) - 543);
        return `${yy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
      }
      // Excel serial number
      const sn = Number(s);
      if (!isNaN(sn) && sn > 20000 && sn < 80000) {
        const epoch = new Date(Date.UTC(1899, 11, 30));
        const d = new Date(epoch.getTime() + sn * 86400000);
        return d.toISOString().slice(0, 10);
      }
      return s;
    }
    return s;
  };

  // Parse TSV (Excel paste) or CSV — state machine ที่รองรับ quoted field
  //   เซลล์ที่มี delim หรือ newline ฝัง จะถูกครอบ "..." ตามมาตรฐาน RFC 4180
  //   "" ใน quote = literal "
  const parseDelimited = (text) => {
    const src = text.replace(/\r\n?/g, '\n');
    if (!src.trim()) return { headers: [], rows: [] };
    // Detect delimiter from first non-quoted segment of first line
    const firstNL = src.indexOf('\n');
    const firstLine = firstNL >= 0 ? src.slice(0, firstNL) : src;
    const delim = firstLine.includes('\t') ? '\t' : ',';

    const all = [];           // ผลลัพธ์: array ของ rows
    let row = [];             // row ที่กำลังสร้าง
    let cur = '';             // field ที่กำลังสร้าง
    let inQ = false;          // อยู่ใน quoted field?
    let fieldStarted = false; // เห็นอักขระแล้วใน field นี้?

    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inQ) {
        if (c === '"') {
          if (src[i + 1] === '"') { cur += '"'; i++; }   // escaped quote
          else inQ = false;
        } else {
          cur += c;   // รวม tab/newline ใน quote ลง field
        }
      } else {
        if (c === '"' && !fieldStarted) { inQ = true; fieldStarted = true; }
        else if (c === delim) { row.push(cur); cur = ''; fieldStarted = false; }
        else if (c === '\n') { row.push(cur); all.push(row); row = []; cur = ''; fieldStarted = false; }
        else { cur += c; fieldStarted = true; }
      }
    }
    // flush last field/row
    if (cur !== '' || row.length > 0) { row.push(cur); all.push(row); }
    // กรอง row ว่างทั้งบรรทัด
    const nonEmpty = all.filter(r => r.some(c => String(c).trim() !== ''));
    if (nonEmpty.length === 0) return { headers: [], rows: [] };
    const headers = nonEmpty[0].map(h => String(h).trim());
    const rows = nonEmpty.slice(1);
    return { headers, rows };
  };

  // Normalise value for diff comparison — type-aware
  //   number field: '' / null / '0' / 0 / 0.00 → 0 (ทุกตัวถือว่าเท่ากัน)
  //   string/date field: '' / null → ''
  const normCmp = (x, type) => {
    if (type === 'number') {
      if (x == null || x === '') return 0;
      if (typeof x === 'number') return isNaN(x) ? 0 : x;
      const stripped = String(x).replace(/,/g, '').replace(/[฿$\s]/g, '').trim();
      if (stripped === '') return 0;
      const n = Number(stripped);
      return isNaN(n) ? 0 : n;
    }
    if (x == null) return '';
    if (typeof x === 'number') return isNaN(x) ? '' : x;
    const s = String(x).trim();
    if (s === '') return '';
    // try numeric auto-coerce (กรณี field type ไม่ระบุแต่ค่าเป็นเลข)
    const stripped = s.replace(/,/g, '').replace(/[฿$\s]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(stripped)) return Number(stripped);
    return s;
  };

  const handleImport = () => {
    if (!importText.trim()) { toast('ไม่มีข้อมูล — กรุณาวางข้อมูลจาก Excel ก่อน'); return; }
    const { headers, rows } = parseDelimited(importText);
    if (rows.length === 0) {
      toast('ไม่พบแถวข้อมูล — ต้องมีหัวตาราง + ข้อมูลอย่างน้อย 1 แถว');
      return;
    }
    const { map: headerMap, unmapped: skippedCols } = buildHeaderMap(headers);
    const mappedCount = Object.keys(headerMap).length;
    if (mappedCount === 0) {
      toast('ไม่พบคอลัมน์ที่ตรงกับฟอร์ม — กรุณาดาวน์โหลด Template ก่อน');
      setImportStats({ added: 0, skipped: rows.length, errors: ['header ไม่ตรง — ใช้ Template'], skippedCols });
      return;
    }
    const fieldByKey = Object.fromEntries(importFields.map(f => [f.key, f]));

    // Auto-detect date format per date column — scan all values to find
    // unambiguous days (>12) before parsing
    const dateFmtByKey = {};
    Object.entries(headerMap).forEach(([colIdx, key]) => {
      if (fieldByKey[key]?.type !== 'date') return;
      const samples = rows.map(cols => String(cols[colIdx] || '').trim()).filter(Boolean);
      dateFmtByKey[key] = detectDateFormat(samples);
    });

    // Build parsed objects (no id yet — id only assigned on commit for new rows)
    const parsedRows = [];
    let blankSkipped = 0;
    rows.forEach((cols) => {
      if (cols.every(c => !String(c || '').trim())) { blankSkipped++; return; }
      const obj = {};
      Object.entries(headerMap).forEach(([colIdx, key]) => {
        const f = fieldByKey[key];
        obj[key] = coerceVal(cols[colIdx], f?.type, dateFmtByKey[key]);
      });
      parsedRows.push(obj);
    });

    const dedupKey = config.dedupKey;

    // ── Mode 1: no dedupKey → behaviour เดิม (append ทั้งหมด) ─────────────
    if (!dedupKey) {
      const newRows = parsedRows.map(obj => {
        const filled = { id: WTPData.newId(), ...obj };
        if (config.emptyRow) {
          Object.entries(config.emptyRow).forEach(([k, v]) => {
            if (filled[k] === undefined || filled[k] === '' || filled[k] === null) filled[k] = v;
          });
        }
        return filled;
      });
      if (newRows.length > 0) {
        setData(d => ({ ...d, [config.dataKey]: [...newRows, ...(d[config.dataKey] || [])] }));
      }
      setImportStats({ added: newRows.length, skipped: blankSkipped, errors: [], skippedCols });
      toast(`นำเข้าแล้ว ${newRows.length} รายการ${blankSkipped ? ` · ข้าม ${blankSkipped}` : ''}`);
      return;
    }

    // ── Mode 2: มี dedupKey → diff แล้วโชว์ preview ก่อน commit ──────────
    // dedupKey รับได้ทั้ง string เดี่ยว หรือ array (compound key เช่น ['PL_PV_No','AP_No'])
    const dedupKeys  = Array.isArray(dedupKey) ? dedupKey : [dedupKey];
    const primaryKey = dedupKeys[0];   // ใช้สำหรับ group ใน UI (เช่น PL_PV_No)
    const SEP = '|';
    const makeTuple = (r) => dedupKeys.map(k => String(r[k] ?? '').trim()).join(SEP);

    // Date scope — ถ้ามี config.scopeDateField จะคำนวณช่วงวันที่ของไฟล์ import
    // แล้ว filter DB ที่อยู่นอกช่วงทิ้ง (ไม่นับเป็น missing)
    const scopeField = config.scopeDateField;
    let dateLo = null, dateHi = null;
    if (scopeField) {
      const ds = parsedRows.map(r => String(r[scopeField] ?? '').slice(0, 10)).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
      if (ds.length > 0) { dateLo = ds[0]; dateHi = ds[ds.length - 1]; }
    }
    const inDateScope = (r) => {
      if (!scopeField || !dateLo || !dateHi) return true;
      const d = String(r[scopeField] ?? '').slice(0, 10);
      return d && d >= dateLo && d <= dateHi;
    };

    const existing = data[config.dataKey] || [];
    // Map<tuple, DB row[]> — รองรับ duplicates ใน DB (PV+AP เดียวกัน เกิดมาแล้วใน DB)
    const existingByTuple = new Map();
    existing.forEach(r => {
      const k = makeTuple(r);
      if (!k.replace(new RegExp(SEP, 'g'), '').trim()) return;   // empty tuple
      if (!existingByTuple.has(k)) existingByTuple.set(k, []);
      existingByTuple.get(k).push(r);
    });

    const importedTuples = new Set();
    const cat = { added: [], changed: [], unchanged: [], missing: [] };
    let noKeyCount = 0;

    parsedRows.forEach(obj => {
      const tuple = makeTuple(obj);
      const tupleClean = tuple.replace(new RegExp(SEP, 'g'), '').trim();
      if (!tupleClean) {
        noKeyCount++;
        cat.added.push({ row: obj, key: tuple, primary: '(ไม่มีเลข)' });
        return;
      }
      importedTuples.add(tuple);
      const exList = existingByTuple.get(tuple);
      if (!exList || exList.length === 0) {
        cat.added.push({ row: obj, key: tuple, primary: obj[primaryKey] || '' });
        return;
      }
      // Use first matching row (if DB has multiple, others will still appear; we match 1:1 by position)
      const ex = exList.shift();
      const diff = {};
      Object.entries(obj).forEach(([fk, v]) => {
        if (dedupKeys.includes(fk)) return;
        const t = fieldByKey[fk]?.type;
        if (normCmp(ex[fk], t) !== normCmp(v, t)) {
          diff[fk] = { old: ex[fk], new: v };
        }
      });
      const item = { row: obj, existing: ex, key: tuple, primary: ex[primaryKey] || obj[primaryKey] || '' };
      if (Object.keys(diff).length === 0) {
        cat.unchanged.push(item);
      } else {
        cat.changed.push({ ...item, diff });
      }
    });

    // หา missing: tuple ใน DB (ที่อยู่ใน date scope) ที่ไม่อยู่ใน importedTuples
    // existingByTuple ยังเหลือเฉพาะ row ที่ไม่ได้ถูก match (.shift() เอาออกตอน matching)
    existingByTuple.forEach((rows, tuple) => {
      rows.forEach(r => {
        if (!inDateScope(r)) return;
        if (importedTuples.has(tuple)) {
          // tuple นี้มีใน import แต่ DB มีหลาย row → row ที่เกินถือเป็น duplicate (ไม่ใช่ missing) — ข้าม
          return;
        }
        cat.missing.push({ row: r, key: tuple, primary: r[primaryKey] || '' });
      });
    });

    cat.blankSkipped = blankSkipped;
    cat.noKeyCount   = noKeyCount;
    cat.skippedCols  = skippedCols;
    cat.fieldByKey   = fieldByKey;
    cat.dateRange    = (dateLo && dateHi) ? { lo: dateLo, hi: dateHi } : null;
    cat.dedupKeys    = dedupKeys;
    cat.primaryKey   = primaryKey;
    setImportPreview(cat);
    setDeleteMissingChoice(false);
    setImportStats(null);
  };

  // Apply the preview → upsert + optional delete
  const commitImport = () => {
    if (!importPreview) return;
    const preview = importPreview;
    setData(d => {
      let next = [...(d[config.dataKey] || [])];

      // 1) update changed — merge import fields into existing row (keep id, keep untouched fields)
      const changedById = new Map();
      preview.changed.forEach(({ existing, row }) => {
        if (existing?.id) changedById.set(existing.id, row);
      });
      if (changedById.size > 0) {
        next = next.map(r => changedById.has(r.id) ? { ...r, ...changedById.get(r.id) } : r);
      }

      // 2) add new — fill emptyRow defaults + new id
      const newRows = preview.added.map(({ row }) => {
        const filled = { ...row };
        if (config.emptyRow) {
          Object.entries(config.emptyRow).forEach(([k, v]) => {
            if (filled[k] === undefined || filled[k] === '' || filled[k] === null) filled[k] = v;
          });
        }
        filled.id = WTPData.newId();
        return filled;
      });
      if (newRows.length > 0) next = [...newRows, ...next];

      // 3) delete missing (optional)
      if (deleteMissingChoice && preview.missing.length > 0) {
        const missingIds = new Set(preview.missing.map(m => m.row?.id).filter(Boolean));
        next = next.filter(r => !missingIds.has(r.id));
      }

      return { ...d, [config.dataKey]: next };
    });

    const stats = {
      added: preview.added.length,
      changed: preview.changed.length,
      skipped: preview.unchanged.length + (preview.blankSkipped || 0),
      deleted: deleteMissingChoice ? preview.missing.length : 0,
      errors: [],
      skippedCols: preview.skippedCols || [],
    };
    setImportStats(stats);
    setImportPreview(null);
    setImportText('');
    setImportFileName('');
    const parts = [`เพิ่ม ${stats.added}`, `แก้ ${stats.changed}`, `ข้าม ${stats.skipped}`];
    if (stats.deleted > 0) parts.push(`ลบ ${stats.deleted}`);
    toast(parts.join(' · '));
  };

  // Download xlsx template using SheetJS (window.XLSX loaded in index.html)
  const handleDownloadTemplate = (fmt = 'xlsx') => {
    if (importFields.length === 0) { toast('ไม่มีคอลัมน์สำหรับ Template'); return; }
    const headers = importFields.map(f => f.label);
    const exampleRow = importFields.map(f => {
      if (f.type === 'date') return new Date().toISOString().slice(0, 10);
      if (f.type === 'number') return 0;
      if (f.type === 'select' && f.options?.length) return f.options.find(o => o.value)?.value || '';
      return '';
    });
    const aoa = [headers, exampleRow];
    const filename = `template_${config.dataKey || 'data'}`;
    if (fmt === 'csv' || !window.XLSX) {
      const csv = aoa.map(row => row.map(c => {
        const s = String(c ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')).join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${filename}.csv` });
      a.click(); URL.revokeObjectURL(url);
    } else {
      const ws = window.XLSX.utils.aoa_to_sheet(aoa);
      // Set column widths
      ws['!cols'] = headers.map(h => ({ wch: Math.max(14, String(h).length + 2) }));
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Template');
      window.XLSX.writeFile(wb, `${filename}.xlsx`);
    }
    toast(`ดาวน์โหลด Template (${fmt.toUpperCase()}) แล้ว`);
  };

  // Upload an .xlsx file directly (no need to copy-paste)
  const handleFileUpload = (file) => {
    if (!file) return;
    if (!window.XLSX) { toast('ไม่พบไลบรารี SheetJS — กรุณาใช้วิธี Copy-Paste แทน'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // อ่านแบบ raw (serial numbers) แล้ว convert ทุก cell ที่มี date format
        // เป็น 'YYYY-MM-DD' ผ่าน XLSX.SSF.parse_date_code — กัน timezone bug
        // ของ cellDates: true (เลื่อนวันที่ 1 วันใน UTC+7) และกัน sheet_to_csv
        // คืน '5/5/26' (US locale) ที่ทำให้ format detection หลง
        const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: false, cellNF: true });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        Object.keys(ws).forEach(addr => {
          if (addr[0] === '!') return;
          const c = ws[addr];
          if (!c) return;
          // numeric cell with a date format code → convert to ISO
          if (c.t === 'n' && typeof c.v === 'number' && c.z && /[ymd]/i.test(String(c.z))) {
            try {
              const dc = window.XLSX.SSF.parse_date_code(c.v);
              if (dc && dc.y) {
                const iso = `${dc.y}-${String(dc.m).padStart(2,'0')}-${String(dc.d).padStart(2,'0')}`;
                c.v = iso; c.w = iso; c.t = 's';
              }
            } catch (_) { /* skip */ }
          }
          // กัน TAB/ขึ้นบรรทัดที่ฝังในเซลล์ (เช่น remark) → ไม่งั้นคอลัมน์เลื่อนตอนแปลงเป็น TSV
          if (typeof c.v === 'string') c.v = c.v.replace(/[\t\r\n]+/g, ' ');
          if (typeof c.w === 'string') c.w = c.w.replace(/[\t\r\n]+/g, ' ');
        });
        const tsv = window.XLSX.utils.sheet_to_csv(ws, { FS: '\t' });
        setImportText(tsv);
        setImportFileName(file.name);
        toast(`อ่านไฟล์ ${file.name} แล้ว — กรุณาตรวจสอบและกด "นำเข้า"`);
      } catch (err) {
        toast('อ่านไฟล์ไม่สำเร็จ: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const stats = config.summary ? config.summary(rows) : [];

  return (
    <div className="page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">{config.title}</h1>
          <div className="page-sub">{config.sub}</div>
        </div>
        <div className="page-head-r">
          <ExportButton
            rows={sortedFiltered}
            columns={config.columns.map(c => ({ key: c.key, label: c.label, type: c.type || (c.numeric ? 'number' : undefined) }))}
            filename={config.dataKey || 'data'}
            sheetName={config.singular || 'ข้อมูล'}
            title={config.title}
          />
          <PrintButton />
          {effectiveAllowDelete && (
            <button
              className={`btn ${bulkMode ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setBulkMode(v => !v)}
              title={bulkMode ? 'ปิดโหมดเลือกหลายรายการ' : 'เปิดโหมดเลือกหลายรายการ (เพื่อลบ/Export พร้อมกัน)'}>
              <Icon name="check" size={14} /> {bulkMode ? 'ปิดเลือก' : 'เลือกหลายรายการ'}
            </button>
          )}
          {userCanEdit && (
            <button className="btn btn-ghost" onClick={() => {
              console.log('[Import] click — opening modal for', config.dataKey);
              setShowImport(true);
              setImportStats(null);
            }}>
              <Icon name="upload" size={14} /> นำเข้า Excel
            </button>
          )}
          {!effectiveReadOnly && (
            <button className="btn btn-primary" onClick={() => setEdit({ ...config.emptyRow, id: null })}>
              <Icon name="plus" size={14} /> {config.addLabel || 'เพิ่ม'}
            </button>
          )}
        </div>
      </div>

      {stats.length > 0 && (
        <div className={`grid grid-${Math.min(4, stats.length)} anim-stagger`} style={{ marginBottom: 16 }}>
          {stats.map((s, i) => (
            <KpiTile
              key={i}
              label={s.label}
              value={s.value}
              unit={s.unit || 'บาท'}
              digits={s.digits ?? 2}
              accent={s.accent || 'var(--brand-500)'}
              icon={s.icon}
              delta={s.delta}
              deltaKind={s.deltaKind || 'neu'}
            />
          ))}
        </div>
      )}

      {/* แบนเนอร์เสริมจาก config (เช่น ปุ่มลบรายการ AP ที่จ่ายแล้ว) */}
      {config.banner}

      <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        {config.filters ? (
          <div className="tabnav">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>ทั้งหมด ({rows.length})</button>
            {config.filters.map(f => (
              <button key={f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>{f.label} ({rows.filter(r => config.filterFn(r, f.key)).length})</button>
            ))}
          </div>
        ) : <div />}
        <div className="tb-search" style={{ width: 300 }}>
          <Icon name="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={config.searchPlaceholder || 'ค้นหา…'} />
        </div>
      </div>

      <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: config.tableMaxHeight || 'calc(100vh - 330px)' }}>
          <table className="tbl">
            <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' }}>
              <tr>
                {/* Bulk-select header — only visible when bulkMode is on */}
                {effectiveAllowDelete && bulkMode && (
                  <th style={{ width: 34, textAlign: 'center', padding: '6px 4px' }}>
                    <input
                      type="checkbox"
                      checked={sortedFiltered.length > 0 && sortedFiltered.every(r => selected.has(r.id))}
                      ref={el => {
                        if (el) {
                          const some = sortedFiltered.some(r => selected.has(r.id));
                          const all  = sortedFiltered.length > 0 && sortedFiltered.every(r => selected.has(r.id));
                          el.indeterminate = some && !all;
                        }
                      }}
                      onChange={() => {
                        const allSelected = sortedFiltered.length > 0 && sortedFiltered.every(r => selected.has(r.id));
                        if (allSelected) setSelected(new Set());
                        else setSelected(new Set(sortedFiltered.map(r => r.id)));
                      }}
                      title="เลือกทั้งหมด"
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                )}
                {config.columns.map((c, i) => (
                  <FilterableColHeader
                    key={i}
                    label={c.label}
                    sortKey={c.key}
                    colKey={c.key}
                    sort={sort}
                    sortToggle={toggleSort}
                    align={c.headerAlign || 'center'}
                    width={c.width}
                    colFilters={colFilters}
                    setColFilters={setColFilters}
                    openCol={openCol}
                    setOpenCol={setOpenCol}
                    allRows={rows}
                    getValue={colDisplay}
                  />
                ))}
                {(!effectiveReadOnly || effectiveAllowDelete) && <th style={{ width: 110 }}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={config.columns.length + ((!effectiveReadOnly || effectiveAllowDelete) ? 1 : 0) + ((effectiveAllowDelete && bulkMode) ? 1 : 0)} style={{ padding: 36, textAlign: 'center' }} className="muted">ไม่พบข้อมูล</td></tr>
              )}
              {sortedFiltered.map((row, _ri) => (
                <tr key={(row.id != null ? row.id : 'r') + '_' + _ri}
                  style={{ cursor: 'pointer', background: selected.has(row.id) ? 'var(--brand-50)' : undefined }}
                  onClick={() => bulkMode ? toggleSelectOne(row.id) : setView(row)}>
                  {/* Per-row checkbox — only visible in bulkMode */}
                  {effectiveAllowDelete && bulkMode && (
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center', padding: '6px 4px' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelectOne(row.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                  )}
                  {config.columns.map((c, i) => (
                    <td key={i} style={{ textAlign: c.align || 'left' }} className={c.numeric ? 'num' : ''}>
                      {c.render ? c.render(row) : (
                        c.type === 'money' ? <span style={{ color: row[c.key] < 0 ? 'var(--bad)' : 'inherit', fontWeight: 600 }}>{fmtNum(row[c.key], c.digits ?? 2)}</span>
                        : c.type === 'date' ? fmtDate(row[c.key])
                        : c.mono ? <span style={{ fontFamily: 'ui-monospace', color: 'var(--brand-700)', fontWeight: 600 }}>{row[c.key]}</span>
                        : row[c.key] || <span className="muted">—</span>
                      )}
                    </td>
                  ))}
                  {(!effectiveReadOnly || effectiveAllowDelete) && (
                    <td onClick={e => e.stopPropagation()}>
                      <div className="row-act">
                        {!effectiveReadOnly && (
                          <button className="btn-icon" onClick={() => setEdit(row)} title="แก้ไข"><Icon name="edit" size={14} /></button>
                        )}
                        {!effectiveReadOnly && (
                          <button className="btn-icon" onClick={() => {
                            // Clone row: strip id (so save() creates new), refresh DATE to today
                            const { id, ...rest } = row;
                            const clone = { ...rest, id: null };
                            if ('DATE' in clone) clone.DATE = data.meta?.asOf || new Date().toISOString().slice(0, 10);
                            setEdit(clone);
                          }} title="คัดลอกรายการ"><Icon name="copy" size={14} /></button>
                        )}
                        {effectiveAllowDelete && (
                          <button className="btn-icon danger" onClick={() => remove(row.id)} title="ลบ"><Icon name="trash" size={14} /></button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {config.footer && (
              <tfoot>{config.footer(filtered)}</tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Floating bulk-action bar — only in bulkMode when 1+ rows selected */}
      {bulkMode && selected.size > 0 && effectiveAllowDelete && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--ink-900)',
          color: '#fff',
          borderRadius: 12,
          padding: '10px 14px 10px 20px',
          boxShadow: '0 12px 32px rgba(15,36,77,0.28)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          zIndex: 950,
          minWidth: 320,
          maxWidth: 'min(560px, calc(100vw - 32px))',
        }}>
          <div style={{ flex: 1, fontSize: 13 }}>
            <strong>{selected.size}</strong> รายการถูกเลือก
          </div>
          <button
            onClick={() => setSelected(new Set())}
            className="btn btn-ghost"
            style={{ color: '#fff', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)' }}
          >ยกเลิก</button>
          <ExportButton
            rows={(data[config.dataKey] || []).filter(r => selected.has(r.id))}
            columns={config.columns.map(c => ({ key: c.key, label: c.label, type: c.type || (c.numeric ? 'number' : undefined) }))}
            filename={`${config.dataKey || 'data'}_selected`}
            sheetName={config.singular || 'ข้อมูล'}
            title={`${config.title} — รายการที่เลือก`}
            label={`Excel`}
          />
          <button
            onClick={bulkRemove}
            className="btn btn-danger"
            style={{ background: 'var(--bad)', color: '#fff', borderColor: 'var(--bad)' }}
          >
            <Icon name="trash" size={14} /> ลบที่เลือก
          </button>
        </div>
      )}

      {/* Import modal — generic for any DataCrudPage */}
      {showImport && (() => {
        const previewRows = importText ? parseDelimited(importText).rows.length : 0;
        const placeholderText = 'ตัวอย่าง (วางจาก Excel ได้เลย):\n' +
          importFields.slice(0, 4).map(f => f.label).join('\t') +
          (importFields.length > 4 ? '\t...' : '') + '\n...';
        return (
        <Modal open={showImport} maxWidth={760}
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>นำเข้า · {config.title}</span>
              <button type="button" onClick={() => setImportHelpOpen(o => !o)}
                title={importHelpOpen ? 'ซ่อนคำอธิบาย' : 'ดูคำอธิบาย / คอลัมน์ที่รองรับ'}
                aria-label="help"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: '50%',
                  background: importHelpOpen ? '#f6ad55' : '#fefce8',
                  color: importHelpOpen ? '#fff' : '#b45309',
                  border: '1.5px solid #f6ad55', cursor: 'pointer', padding: 0,
                  fontSize: 13, fontWeight: 700, lineHeight: 1,
                  transition: 'background .12s',
                }}>ⓘ</button>
            </span>
          }
          onClose={() => { setShowImport(false); setImportText(''); setImportStats(null); setImportPreview(null); setImportPasteOpen(false); setImportFileName(''); }}
          footer={importPreview ? <>
            <button className="btn btn-ghost" onClick={() => setImportPreview(null)}>← ย้อนกลับ</button>
            <button className="btn btn-primary" onClick={commitImport}>
              <Icon name="check" size={13} /> ยืนยันนำเข้า
              ({importPreview.added.length}+{importPreview.changed.length}{deleteMissingChoice && importPreview.missing.length ? `-${importPreview.missing.length}` : ''})
            </button>
          </> : <>
            <button className="btn btn-ghost" onClick={() => { setShowImport(false); setImportText(''); setImportStats(null); setImportPreview(null); setImportPasteOpen(false); setImportFileName(''); }}>ปิด</button>
            <button className="btn btn-primary" onClick={handleImport} disabled={!importText.trim()}>
              <Icon name="upload" size={13} /> {config.dedupKey ? 'ตรวจสอบข้อมูล' : 'นำเข้า'} ({previewRows} แถว)
            </button>
          </>}>

          {/* ── Preview / Diff stage (only when dedupKey set + handleImport ran) ── */}
          {importPreview ? (
            <>
            {importPreview.skippedCols?.length > 0 && (
              <div style={{
                fontSize: 12, marginBottom: 12, padding: '9px 12px', borderRadius: 7,
                background: 'color-mix(in oklch, var(--bad) 9%, transparent)',
                border: '1px solid var(--bad)', borderLeft: '3px solid var(--bad)', color: 'var(--ink-800)', lineHeight: 1.6,
              }}>
                ⚠️ มี <strong>{importPreview.skippedCols.length}</strong> คอลัมน์ในไฟล์ที่ไม่ตรงกับฟิลด์ใดเลย จึง <strong>ไม่ถูกนำเข้า</strong>:{' '}
                <span style={{ fontFamily: 'ui-monospace', color: 'var(--bad)' }}>{importPreview.skippedCols.join(', ')}</span>
                <div style={{ marginTop: 4, color: 'var(--ink-500)' }}>ถ้าคอลัมน์เหล่านี้ควรเข้าระบบ ให้แก้หัวคอลัมน์ให้ตรงชื่อฟิลด์ (เช่น <code>Bank_AC</code>) หรือแจ้งผมเพื่อเพิ่ม alias</div>
              </div>
            )}
            <ImportPreview
              preview={importPreview}
              fieldByKey={importPreview.fieldByKey || {}}
              subFields={config.previewSubFields || []}
              deleteMissing={deleteMissingChoice}
              setDeleteMissing={setDeleteMissingChoice}
            />
            </>
          ) : <>

          {/* Help callout */}
          {importHelpOpen && (
            <div style={{
              fontSize: 12, marginBottom: 12, padding: '10px 12px',
              background: '#fefce8', border: '1px solid #fde68a', borderLeft: '3px solid #f6ad55',
              borderRadius: 7, color: 'var(--ink-700)', lineHeight: 1.65,
            }}>
              {config.importSourceNote && (
                <div style={{
                  marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed #fde68a',
                  fontWeight: 700, color: 'var(--ink-800)', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Icon name="info" size={14} /> <span>{config.importSourceNote}</span>
                </div>
              )}
              <div>📥 <strong>อัปโหลดไฟล์ .xlsx/.csv</strong> หรือ <strong>วาง Excel</strong>. แถวแรกต้องเป็นชื่อคอลัมน์ (ตาม Template)</div>
              <div>📋 <strong>คอลัมน์ที่ระบบรองรับ ({importFields.length})</strong>:&nbsp;
                <span style={{ fontFamily: 'ui-monospace', fontSize: 11.5, color: 'var(--ink-600)' }}>
                  {importFields.map(f => f.label).join(', ')}
                </span>
              </div>
              <div>📦 แนะนำให้ <strong>ดาวน์โหลด Template</strong> ก่อนเริ่ม เพื่อให้คอลัมน์ตรงสเปค</div>
            </div>
          )}

          {/* Template download — compact strip */}
          <div style={{
            background: 'color-mix(in oklch, var(--brand-500) 6%, transparent)',
            border: '1px solid color-mix(in oklch, var(--brand-500) 22%, transparent)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 10,
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, color: 'var(--brand-700)', fontWeight: 600 }}>📦 ดาวน์โหลด Template:</span>
            <button className="btn btn-sm" onClick={() => handleDownloadTemplate('xlsx')}
              style={{ fontSize: 11.5, padding: '3px 10px' }}>
              <Icon name="download" size={12} /> .xlsx
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => handleDownloadTemplate('csv')}
              style={{ fontSize: 11.5, padding: '3px 10px' }}>
              <Icon name="download" size={12} /> .csv
            </button>
            <span style={{ fontSize: 11, color: 'var(--ink-500)', marginLeft: 'auto' }}>
              เปิดใน Excel → กรอกข้อมูล → upload หรือ paste กลับ
            </span>
          </div>

          {/* Big drop zone — drag & drop or click to choose */}
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!importDragOver) setImportDragOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setImportDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setImportDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              setImportDragOver(false);
              const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
              if (f) handleFileUpload(f);
            }}
            style={{
              border: importDragOver ? '2.5px dashed var(--brand-500)' : '2px dashed var(--brand-300, #90b4f2)',
              borderRadius: 12, padding: '28px 20px',
              minHeight: 120, marginBottom: 12, transition: 'all .12s ease',
              background: importDragOver
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
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  style={{ display: 'none' }}
                />
              </label>
              <span style={{ fontSize: 11.5, color: importDragOver ? 'var(--brand-700)' : 'var(--ink-500)', fontWeight: importDragOver ? 600 : 400 }}>
                {importDragOver ? '⬇️ วางไฟล์ที่นี่' : 'หรือลากไฟล์มาวาง — รองรับ .xlsx, .xls, .csv'}
              </span>
              {importFileName && (
                <button type="button" onClick={() => { setImportFileName(''); setImportText(''); }}
                  style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--ink-200)', borderRadius: 6, padding: '3px 9px', fontSize: 11, color: 'var(--ink-600)', cursor: 'pointer' }}>
                  ✕ ล้างไฟล์
                </button>
              )}
            </div>
            {importFileName && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>📄</span>
                <strong>{importFileName}</strong>
                <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>· อ่านแล้ว {previewRows} แถว</span>
              </div>
            )}
          </div>

          {/* Paste — collapsed behind button */}
          {!importPasteOpen ? (
            <button type="button" onClick={() => setImportPasteOpen(true)}
              style={{
                width: '100%', padding: '8px 14px', marginBottom: 8,
                background: 'var(--ink-50, #f7f8fa)', border: '1px dashed var(--ink-200, #cbd5e0)',
                borderRadius: 7, color: 'var(--ink-600)', cursor: 'pointer',
                fontSize: 12, fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              <span>📋</span>
              <span>หรือกดที่นี่เพื่อวางข้อมูลโดยตรง (TSV / CSV)</span>
            </button>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>วางข้อมูลจาก Excel (แถวแรก = หัวตาราง)</span>
                <button type="button" onClick={() => { setImportPasteOpen(false); if (!importFileName) setImportText(''); }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-400)', fontSize: 11, padding: '0 4px' }}>
                  ✕ ซ่อน
                </button>
              </div>
              <textarea
                className="input"
                rows={10}
                autoFocus
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={placeholderText}
                style={{ fontFamily: 'ui-monospace', fontSize: 11.5, width: '100%', resize: 'vertical', marginBottom: 10 }}
              />
            </>
          )}

          {/* Stats after import */}
          {importStats && (
            <div style={{
              padding: 10, borderRadius: 8,
              background: (importStats.added > 0 || importStats.changed > 0) ? 'color-mix(in oklch, var(--good) 12%, transparent)' : 'color-mix(in oklch, var(--bad) 12%, transparent)',
              border: `1px solid ${(importStats.added > 0 || importStats.changed > 0) ? 'var(--good)' : 'var(--bad)'}`,
              fontSize: 12.5,
            }}>
              ✅ เพิ่ม <strong>{importStats.added}</strong>
              {importStats.changed > 0 && <> · ✏️ แก้ <strong>{importStats.changed}</strong></>}
              {importStats.skipped > 0 && <> · ⏭️ ข้าม <strong>{importStats.skipped}</strong></>}
              {importStats.deleted > 0 && <> · 🗑️ ลบ <strong>{importStats.deleted}</strong></>}
              {importStats.errors?.length > 0 && (
                <div style={{ marginTop: 6, color: 'var(--bad)' }}>
                  ⚠️ {importStats.errors.join('; ')}
                </div>
              )}
              {importStats.skippedCols?.length > 0 && (
                <div style={{ marginTop: 6, color: 'var(--bad)' }}>
                  ⚠️ คอลัมน์ที่ไม่ถูกนำเข้า (หัวไม่ตรงฟิลด์): <span style={{ fontFamily: 'ui-monospace' }}>{importStats.skippedCols.join(', ')}</span>
                </div>
              )}
            </div>
          )}
          </>}
        </Modal>
        );
      })()}

      {/* View popup — opens on row click (read-only).
          Footer buttons (แก้ไข / ลบ) gated by user role */}
      <GenericViewModal
        row={view}
        onClose={() => setView(null)}
        fields={config.modalFields}
        title={`ข้อมูล ${config.singular || 'รายการ'}`}
        onEdit={effectiveReadOnly ? undefined : (row) => setEdit(row)}
        onCopy={effectiveReadOnly ? undefined : (row) => {
          const { id, ...rest } = row;
          const clone = { ...rest, id: null };
          if ('DATE' in clone) clone.DATE = data.meta?.asOf || new Date().toISOString().slice(0, 10);
          setEdit(clone);
        }}
        onDelete={effectiveAllowDelete ? remove : undefined}
      />

      {/* Edit modal — opens via pencil button OR "เพิ่ม" button (only when user can edit) */}
      {!effectiveReadOnly && (
        <GenericEditModal
          row={edit}
          onClose={() => setEdit(null)}
          onSave={save}
          fields={config.modalFields}
          header={config.modalHeader}
          title={edit?.id ? `แก้ไข ${config.singular || 'รายการ'}` : `เพิ่ม ${config.singular || 'รายการ'}ใหม่`}
        />
      )}
    </div>
  );
}

function GenericEditModal({ row, onClose, onSave, fields, title, header }) {
  const [draft, setDraft] = dxState(null);
  dxEffect(() => { setDraft(row ? { ...row } : null); }, [row]);
  if (!row || !draft) return null;   // wait for draft to be populated
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  // Group fields by `section` markers so we can render visual sub-headers.
  const groups = [];
  let current = { title: null, icon: null, fields: [] };
  fields.forEach((f) => {
    if (f.type === 'section') {
      if (current.fields.length || current.title) groups.push(current);
      current = { title: f.label, icon: f.icon, fields: [] };
    } else {
      current.fields.push(f);
    }
  });
  if (current.fields.length) groups.push(current);

  const renderField = (f, i) => {
    const v = draft[f.key];
    const hasSuffix = !!f.suffix;
    const inputEl =
      f.type === 'select' ? (
        <select className="select input" value={v || ''} onChange={(e) => set(f.key, e.target.value)}>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : f.type === 'textarea' ? (
        <textarea className="input" rows={f.rows || 2} value={v || ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
      ) : (
        <input
          className="input"
          type={f.type || 'text'}
          value={v ?? ''}
          onChange={(e) => set(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
          placeholder={f.placeholder}
          style={hasSuffix ? { paddingRight: 36, textAlign: f.type === 'number' ? 'right' : undefined } : (f.type === 'number' ? { textAlign: 'right' } : undefined)}
        />
      );
    return (
      <div className="field" key={i} style={{ gridColumn: f.full ? '1 / -1' : 'auto' }}>
        <label>{f.label}{f.required && <span style={{ color: 'var(--bad)', marginLeft: 4 }}>*</span>}</label>
        {hasSuffix ? (
          <div style={{ position: 'relative' }}>
            {inputEl}
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-500)', fontSize: 12, pointerEvents: 'none' }}>{f.suffix}</span>
          </div>
        ) : inputEl}
        {f.hint && <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{f.hint}</div>}
      </div>
    );
  };

  return (
    <Modal open={!!row} title={title} maxWidth={720} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
      <button className="btn btn-primary" onClick={() => onSave(draft)}><Icon name="check" size={14} /> บันทึก</button>
    </>}>
      {header && <div style={{ marginBottom: 18 }}>{header(draft)}</div>}
      <div style={{ display: 'grid', gap: 20 }}>
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.title && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
                color: 'var(--brand-700)', marginBottom: 10,
                paddingBottom: 6, borderBottom: '1px solid var(--ink-100)',
              }}>
                {g.icon && <Icon name={g.icon} size={14} />}
                {g.title}
              </div>
            )}
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              {g.fields.map(renderField)}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─── Read-only view modal ─────────────────────────────────────────────────────
function GenericViewModal({ row, onClose, fields, title, onDelete, onEdit, onCopy }) {
  if (!row) return null;
  const roStyle = { minHeight: 34, borderRadius: 7, border: '1px solid var(--ink-100)', background: 'var(--ink-25, #f9fafb)', padding: '6px 10px', fontSize: 13, color: 'var(--ink-700)', cursor: 'default', userSelect: 'text', lineHeight: 1.5, wordBreak: 'break-word' };
  const roHighlight = { ...roStyle, background: 'color-mix(in oklch, var(--bad) 9%, transparent)', border: '1px solid color-mix(in oklch, var(--bad) 26%, transparent)', color: 'var(--bad)', fontWeight: 700, fontFamily: 'ui-monospace', fontSize: 14, textAlign: 'right', padding: '6px 14px' };
  const handleDelete = () => {
    if (!onDelete) return;
    if (!confirm('ยืนยันการลบรายการนี้?')) return;
    onDelete(row.id);
    onClose();
  };
  const handleEdit = () => {
    if (!onEdit) return;
    onEdit(row);
    onClose();
  };
  return (
    <Modal open={!!row} title={title} maxWidth={760} onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}>
          {/* Left: delete (destructive — separated visually) */}
          <div>
            {onDelete && (
              <button className="btn btn-danger" onClick={handleDelete}>
                <Icon name="trash" size={14} /> ลบ
              </button>
            )}
          </div>
          {/* Right: copy + edit + close */}
          <div style={{ display: 'flex', gap: 8 }}>
            {onCopy && (
              <button className="btn btn-ghost" onClick={() => { onCopy(row); onClose(); }}>
                <Icon name="copy" size={14} /> คัดลอก
              </button>
            )}
            {onEdit && (
              <button className="btn btn-ghost" onClick={handleEdit}>
                <Icon name="edit" size={14} /> แก้ไข
              </button>
            )}
            <button className="btn btn-primary" onClick={onClose}>ปิด</button>
          </div>
        </div>
      }>
      <div style={{ display: 'grid', gap: 16 }}>
        {(() => {
          const groups = [];
          let cur = { title: null, icon: null, cols: 2, fields: [] };
          fields.forEach(f => {
            if (f.type === 'section') {
              if (cur.fields.length || cur.title) groups.push(cur);
              cur = { title: f.label, icon: f.icon, cols: f.cols || 2, fields: [] };
            } else { cur.fields.push(f); }
          });
          if (cur.fields.length) groups.push(cur);
          return groups.map((g, gi) => (
            <div key={gi}>
              {g.title && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--brand-700)', paddingBottom: 6, borderBottom: '1px solid var(--ink-100)', marginBottom: 10 }}>
                  {g.icon && <Icon name={g.icon} size={13} />}{g.title}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.cols}, 1fr)`, gap: 10 }}>
                {g.fields.map((f, i) => {
                  const v = row[f.key];
                  const display = (v === null || v === undefined || v === '') ? '—'
                    : f.type === 'number' ? fmtNum(parseNum(v), 2)
                    : f.type === 'date'   ? (fmtDate(v) || String(v))
                    : String(v);
                  const colStyle = f.full ? { gridColumn: '1 / -1' } : f.span ? { gridColumn: `span ${f.span}` } : f.gridColumn ? { gridColumn: f.gridColumn } : {};
                  return (
                    <div key={i} className="field" style={colStyle}>
                      <label style={{ fontSize: 12, color: 'var(--ink-500)' }}>{f.label}</label>
                      <div style={f.highlight ? roHighlight : roStyle}>{display}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ));
        })()}
      </div>
    </Modal>
  );
}

// ─── Import preview (diff) — group per primary key (e.g. PV) ───────────────
function ImportPreview({ preview, fieldByKey, subFields = [], deleteMissing, setDeleteMissing }) {
  const { added = [], changed = [], unchanged = [], missing = [], blankSkipped = 0, noKeyCount = 0,
          dateRange, dedupKeys = [], primaryKey } = preview;
  const total = added.length + changed.length + unchanged.length;
  // secondary key (เช่น AP_No) — แสดงในแต่ละแถวของกร๊ป
  const secondaryKey = dedupKeys.length > 1 ? dedupKeys[1] : null;
  const [showUnchangedGroups, setShowUnchangedGroups] = dxState(false);
  const [openGroups, setOpenGroups] = dxState(() => new Set());

  // ── Group all items by primary key (PV) ──────────────────────────────────
  const groups = dxMemo(() => {
    const m = new Map();
    const upsert = (item, status) => {
      const p = String(item.primary ?? '').trim() || '(ไม่มีเลข)';
      if (!m.has(p)) {
        m.set(p, {
          primary: p,
          payee: '',
          items: [],
          counts: { added: 0, changed: 0, unchanged: 0, missing: 0 },
        });
      }
      const g = m.get(p);
      const src = item.existing || item.row;
      if (src?.Payee && !g.payee) g.payee = src.Payee;
      g.items.push({ ...item, status });
      g.counts[status]++;
    };
    added.forEach(it => upsert(it, 'added'));
    changed.forEach(it => upsert(it, 'changed'));
    unchanged.forEach(it => upsert(it, 'unchanged'));
    missing.forEach(it => upsert(it, 'missing'));
    return [...m.values()].sort((a, b) => String(a.primary).localeCompare(String(b.primary)));
  }, [preview]);

  // counter at group level (กี่ PV ที่ touched)
  const groupCounts = dxMemo(() => {
    let withAny = 0, allUnchanged = 0;
    groups.forEach(g => {
      const hasNonUnchanged = (g.counts.added + g.counts.changed + g.counts.missing) > 0;
      if (hasNonUnchanged) withAny++;
      else allUnchanged++;
    });
    return { withAny, allUnchanged, total: groups.length };
  }, [groups]);

  // Filter: by default hide PVs ที่ทุก AP เหมือนเดิม
  const visibleGroups = dxMemo(() => {
    if (showUnchangedGroups) return groups;
    return groups.filter(g => (g.counts.added + g.counts.changed + g.counts.missing) > 0);
  }, [groups, showUnchangedGroups]);

  const fmtVal = (v, type) => {
    if (v === null || v === undefined || v === '') return <span style={{ color: 'var(--ink-400)' }}>—</span>;
    if (type === 'number') return fmtNum(parseNum(v), 2);
    if (type === 'date') return fmtDate(v) || String(v);
    return String(v);
  };

  const STATUS_META = {
    added:     { color: 'var(--good)',           icon: '🆕', label: 'ใหม่' },
    changed:   { color: 'oklch(60% 0.18 75)',    icon: '✏️', label: 'แก้' },
    unchanged: { color: 'var(--ink-400)',        icon: '=',  label: 'เหมือนเดิม' },
    missing:   { color: 'var(--bad)',            icon: '⚠️', label: 'หาย' },
  };

  const toggleGroup = (primary) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(primary)) next.delete(primary);
      else next.add(primary);
      return next;
    });
  };

  const renderItem = (it, idx) => {
    const meta = STATUS_META[it.status];
    const sub = (() => {
      const src = it.existing || it.row;
      if (!src || !subFields.length) return null;
      const parts = subFields.map(k => src[k]).filter(v => v != null && String(v).trim() !== '');
      return parts.length ? parts.map(p => String(p)).join(' · ') : null;
    })();
    const secLabel = secondaryKey ? String((it.existing || it.row || {})[secondaryKey] ?? '').trim() : '';
    return (
      <div key={idx} style={{
        borderLeft: `3px solid ${meta.color}`,
        paddingLeft: 10, paddingTop: 4, paddingBottom: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
          <span style={{ fontSize: 14 }}>{meta.icon}</span>
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: meta.color,
            background: `color-mix(in oklch, ${meta.color} 14%, transparent)`,
            padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.4,
          }}>{meta.label}</span>
          {secLabel && (
            <span style={{ fontFamily: 'ui-monospace', fontSize: 12, fontWeight: 600, color: 'var(--ink-800)' }}>
              {secLabel}
            </span>
          )}
          {sub && (
            <span style={{ fontSize: 11, color: 'var(--ink-500)', flex: 1, lineHeight: 1.4 }}>
              {sub}
            </span>
          )}
        </div>
        {it.status === 'changed' && it.diff && (
          <div style={{ display: 'grid', gap: 3, marginTop: 4, marginLeft: 26 }}>
            {Object.entries(it.diff).map(([fk, { old, new: nw }]) => {
              const f = fieldByKey[fk];
              const label = f?.label || fk;
              return (
                <div key={fk} style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--ink-500)', minWidth: 100 }}>{label}:</span>
                  <span style={{ background: 'color-mix(in oklch, var(--bad) 12%, transparent)', padding: '1px 6px', borderRadius: 4, textDecoration: 'line-through', color: 'var(--bad)' }}>{fmtVal(old, f?.type)}</span>
                  <span style={{ color: 'var(--ink-400)' }}>→</span>
                  <span style={{ background: 'color-mix(in oklch, var(--good) 14%, transparent)', padding: '1px 6px', borderRadius: 4, color: 'var(--good)', fontWeight: 600 }}>{fmtVal(nw, f?.type)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // เลือกสีกรอบของกร๊ปตาม dominant status (ถ้ามี missing/added/changed ใช้สีนั้น)
  const groupBorderColor = (g) => {
    if (g.counts.missing > 0) return 'var(--bad)';
    if (g.counts.added > 0)   return 'var(--good)';
    if (g.counts.changed > 0) return 'oklch(60% 0.18 75)';
    return 'var(--ink-200)';
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Summary banner */}
      <div style={{
        padding: '10px 14px', borderRadius: 8,
        background: 'color-mix(in oklch, var(--brand-500) 8%, transparent)',
        border: '1px solid color-mix(in oklch, var(--brand-500) 26%, transparent)',
        fontSize: 12.5, lineHeight: 1.65,
      }}>
        <div style={{ fontWeight: 700, color: 'var(--brand-700)', marginBottom: 4 }}>
          📋 ตรวจสอบข้อมูลก่อนนำเข้า — match ด้วย{' '}
          <code style={{ fontFamily: 'ui-monospace', background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 3 }}>
            {dedupKeys.join(' + ')}
          </code>
          {dateRange && <> · ขอบเขตวันที่ <strong>{dateRange.lo}</strong> ถึง <strong>{dateRange.hi}</strong></>}
        </div>
        <div style={{ color: 'var(--ink-700)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span>📦 ไฟล์ <strong>{total}</strong> แถว</span>
          <span>🗂️ กระทบ <strong>{groupCounts.withAny}</strong> {primaryKey}</span>
          <span style={{ color: 'var(--good)' }}>🆕 {added.length}</span>
          <span style={{ color: 'oklch(55% 0.18 75)' }}>✏️ {changed.length}</span>
          <span style={{ color: 'var(--ink-500)' }}>= {unchanged.length}</span>
          <span style={{ color: 'var(--bad)' }}>⚠️ {missing.length}</span>
          {blankSkipped > 0 && <span>⏭️ ข้ามว่าง {blankSkipped}</span>}
        </div>
        {groupCounts.allUnchanged > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginTop: 6, cursor: 'pointer', color: 'var(--ink-600)' }}>
            <input type="checkbox" checked={showUnchangedGroups} onChange={e => setShowUnchangedGroups(e.target.checked)} />
            แสดง {primaryKey} ที่เหมือนเดิมทั้งหมด ({groupCounts.allUnchanged})
          </label>
        )}
      </div>

      {/* PV group list */}
      <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
        {visibleGroups.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-500)', fontSize: 12.5 }}>
            ไม่มีกลุ่มที่กระทบ — ทุกอย่างเหมือนเดิม
          </div>
        )}
        {visibleGroups.map((g) => {
          const border = groupBorderColor(g);
          const totalAP = g.items.length;
          // เปิดอัตโนมัติถ้ามี <= 5 กร๊ป (เพราะอ่านได้หมด); ที่เหลือ click เพื่อขยาย
          const open = openGroups.has(g.primary) || (visibleGroups.length <= 5);
          return (
            <div key={g.primary} style={{
              border: `1px solid ${border}`,
              borderRadius: 8, overflow: 'hidden',
              background: `color-mix(in oklch, ${border} 4%, transparent)`,
              flexShrink: 0,   // กัน flex items ย่อตัวลงเมื่อ total > maxHeight
            }}>
              <button type="button" onClick={() => toggleGroup(g.primary)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                }}>
                <span style={{ fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)', fontSize: 13 }}>{g.primary}</span>
                {g.payee && <span style={{ fontSize: 11.5, color: 'var(--ink-600)', flex: 1, lineHeight: 1.4 }}>{g.payee}</span>}
                <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
                  {totalAP} {secondaryKey || 'AP'}
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                  {g.counts.changed > 0  && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'color-mix(in oklch, oklch(60% 0.18 75) 14%, transparent)', color: 'oklch(50% 0.18 75)' }}>✏️ {g.counts.changed}</span>}
                  {g.counts.added > 0    && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'color-mix(in oklch, var(--good) 14%, transparent)', color: 'var(--good)' }}>🆕 {g.counts.added}</span>}
                  {g.counts.missing > 0  && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'color-mix(in oklch, var(--bad) 14%, transparent)', color: 'var(--bad)' }}>⚠️ {g.counts.missing}</span>}
                  {g.counts.unchanged > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'var(--ink-50, #f4f6f9)', color: 'var(--ink-600)', border: '1px solid var(--ink-100)' }}>✓ {g.counts.unchanged}</span>}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-500)', marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
              </button>
              {open && (
                <div style={{ padding: '6px 12px 10px', display: 'grid', gap: 6 }}>
                  {g.items.map((it, i) => renderItem(it, i))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Missing delete checkbox (footer) */}
      {missing.length > 0 && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--bad)',
          background: 'color-mix(in oklch, var(--bad) 6%, transparent)',
          fontSize: 12.5, cursor: 'pointer',
        }}>
          <input type="checkbox" checked={deleteMissing} onChange={e => setDeleteMissing(e.target.checked)} />
          <span>
            ⚠️ มี <strong>{missing.length}</strong> รายการที่อยู่ใน DB{dateRange ? <> ภายในช่วงวันที่ <strong>{dateRange.lo}</strong> ถึง <strong>{dateRange.hi}</strong></> : null} แต่ไม่มีในไฟล์ใหม่ —
            ติ๊กเพื่อ <strong style={{ color: 'var(--bad)' }}>ลบออกจาก DB ด้วย</strong> (default: เก็บไว้)
          </span>
        </label>
      )}
    </div>
  );
}

// ─── Page configs ─────────────────────────────────────────────────────────────

function ForecastEntriesPage({ data, setData, toast }) {
  // Build Bank_AC options from active bank accounts (skip closed/dormant)
  // Supports both legacy seed schema (accountNo/bankName) and v2 sync schema (Bank_AC/BANK_NAME)
  const bankOptions = dxMemo(() => {
    const accounts = (data.bankAccounts || [])
      .filter(b => {
        const t = String(b.accountType || b.account_type || '').toLowerCase();
        return t !== 'closed' && t !== 'dormant';   // active accounts only
      })
      .map(b => {
        const ac   = b.Bank_AC || b.bankAc || b.bank_ac || b.accountNo || b.account_no || '';
        const name = b.BANK_NAME || b.bankName || b.bank_name || '';
        return {
          value: ac,
          label: ac ? `${name} · ${ac}` : (name || '— ไม่ทราบบัญชี —'),
        };
      })
      .filter(o => o.value);
    return [{ value: '', label: '— เลือกบัญชี —' }, ...accounts];
  }, [data.bankAccounts]);

  // ── รายการ AP ที่ "ตัด PV แล้ว + ไม่อยู่ในเจ้าหนี้คงค้างแล้ว" → ลบออกจริง (ไม่ควรอยู่หน้านี้) ──
  //    เฉพาะแถววางแผนจ่าย AP (EXPENSE_TYPE='AP', ยังไม่ ACTUAL/BOOKED) ที่ REF_DOC:
  //    (1) มี PV ตัดไปแล้ว (∈ pvVouchers.AP_No) และ (2) ไม่อยู่ในเจ้าหนี้ (∉ payables.vchno)
  const staleApIds = dxMemo(() => {
    const norm = (s) => String(s == null ? '' : s).trim();
    const fe = data.forecastEntries || [], pv = data.pvVouchers || [], ap = data.payables || [];
    if (!fe.length || !pv.length) return [];
    const paid = new Set(pv.map(p => norm(p.AP_No)).filter(Boolean));
    const pay  = new Set(ap.map(p => norm(p.vchno)).filter(Boolean));
    const ids = [];
    fe.forEach(e => {
      const et  = norm(e.EXPENSE_TYPE || e.expense_type).toUpperCase();
      const st  = norm(e.STATUS || e.status).toUpperCase();
      const ref = norm(e.REF_DOC || e.ref_doc);
      if (et !== 'AP' || !ref) return;
      if (st === 'ACTUAL' || st === 'BOOKED' || st === 'DONE') return;
      if (paid.has(ref) && !pay.has(ref)) ids.push(e.id);
    });
    return ids;
  }, [data.forecastEntries, data.pvVouchers, data.payables]);

  // ลบจริง — ทำเป็น "แบตช์" ไม่เกิน ~25% ของตารางต่อรอบ เพื่อไม่ชน mass-delete guard ของ sync
  //   (กรณีปกติมีไม่กี่รายการ → ลบครบในคลิกเดียว · ถ้าเยอะให้กดซ้ำจนหมด)
  const purgePaidAp = () => {
    const ids = staleApIds;
    if (!ids.length) return;
    const total = (data.forecastEntries || []).length;
    const safeBatch = Math.max(1, Math.floor(total * 0.25));
    const batch = ids.slice(0, safeBatch);
    const remaining = ids.length - batch.length;
    if (!confirm(`ลบรายการ AP ที่จ่ายผ่าน PV แล้ว (และไม่อยู่ในเจ้าหนี้คงค้าง) ถาวร ${batch.length} รายการ?`
      + (remaining > 0 ? `\n\n(มีทั้งหมด ${ids.length} รายการ — รอบนี้ลบ ${batch.length} กันระบบกันข้อมูลหายบล็อก · กดซ้ำเพื่อลบที่เหลือ ${remaining})` : ''))) return;
    const set = new Set(batch);
    let updated;
    setData(d => { updated = { ...d, forecastEntries: (d.forecastEntries || []).filter(r => !set.has(r.id)) }; return updated; });
    if (updated && window.WTPData && window.WTPData.forceSyncNow) setTimeout(() => window.WTPData.forceSyncNow(updated), 0);
    if (toast) toast(`ลบ ${batch.length} รายการแล้ว` + (remaining > 0 ? ` · เหลืออีก ${remaining}` : ' · ครบแล้ว'));
  };

  const purgeBanner = staleApIds.length > 0 ? (
    <div className="card" style={{ padding: '12px 16px', marginBottom: 14, borderLeft: '4px solid var(--bad)',
      background: 'color-mix(in oklch, var(--bad) 5%, var(--surface))', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink-800)' }}>
          🗑 มีรายการ AP ที่จ่ายผ่าน PV แล้ว {staleApIds.length} รายการ — ไม่ควรอยู่ในประมาณการ
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 2 }}>
          ตัด PV แล้ว + ไม่อยู่ในเจ้าหนี้คงค้างแล้ว · AP ที่ยังมีประมาณการให้จัดการที่หน้า Bank Daily
        </div>
      </div>
      <button className="btn" style={{ background: 'var(--bad)', color: '#fff', border: 'none' }} onClick={purgePaidAp}>
        <Icon name="trash" size={14} /> ลบถาวร ({staleApIds.length})
      </button>
    </div>
  ) : null;

  return (
    <DataCrudPage data={data} setData={setData} toast={toast} config={{
      banner: purgeBanner,
      title: 'Manual Expense · ค่าใช้จ่ายที่บันทึกเอง',
      sub: 'RAW_MANUAL_EXPENSE · รายการที่ยังไม่อยู่ในระบบ AP · วาง RAW ได้เลย',
      dataKey: 'forecastEntries',
      addLabel: 'เพิ่มรายการ',
      singular: 'รายการ',
      searchPlaceholder: 'ค้นหา DESCRIPTION / JOB_NO / CATEGORY…',
      searchKeys: ['DESCRIPTION', 'JOB_NO', 'PROJECT_NAME', 'CATEGORY'],
      filters: [
        { key: 'Manual',     label: 'Manual (กรอกเอง)' },
        { key: 'AP',         label: 'AP (วางแผนจ่าย)' },
        { key: 'BANK_RECON', label: 'STM (จ่ายจริง)' },
        { key: 'LOAN',       label: 'LOAN (เงินกู้)' },
      ],
      filterFn: (r, k) => {
        const et = String(r.EXPENSE_TYPE || r.expense_type || '').trim();
        if (k === 'Manual') return et === 'Manual' || et === 'Salary' || et === '';
        return et === k;
      },
      emptyRow: {
        DATE: data.meta.asOf, PAYMENT_DATE: '', EXPENSE_TYPE: 'Manual',
        DESCRIPTION: '', JOB_NO: '', PROJECT_NAME: '',
        AMOUNT: 0, Bank_AC: '', STATUS: 'PLANNED', CATEGORY: '', IS_ACCRUED: '', NOTE: '',
      },
      tableMaxHeight: 'min(480px, calc(100vh - 400px))',
      columns: [
        { key: 'DATE',          label: 'วันที่บันทึก', type: 'date', width: 100 },
        { key: 'PAYMENT_DATE',  label: 'วันที่จ่าย', type: 'date', width: 100 },
        { key: 'DESCRIPTION',   label: 'รายการ', render: r => <div><div style={{ fontWeight: 500 }}>{r.DESCRIPTION || r.label}</div>{r.NOTE && <div className="muted" style={{ fontSize: 11.5 }}>{r.NOTE}</div>}</div> },
        { key: 'EXPENSE_TYPE',  label: 'ต้นทาง', width: 100, render: r => {
          const et = String(r.EXPENSE_TYPE || r.expense_type || '').trim();
          const cfg = et === 'AP' ? ['#d97706','AP · BD']
            : et === 'BANK_RECON' ? ['#2563eb','STM']
            : et === 'LOAN' ? ['#7c3aed','LOAN']
            : et === 'Salary' ? ['#059669','Salary']
            : ['#64748b','Manual'];
          return <span style={{ display:'inline-block', padding:'1px 7px', borderRadius:4, fontSize:11, fontWeight:700, background: cfg[0]+'22', color: cfg[0], border:'1px solid '+cfg[0]+'55' }}>{cfg[1]}</span>;
        }},
        { key: 'JOB_NO',        label: 'Job No.', width: 95, mono: true },
        { key: 'CATEGORY',      label: 'หมวด', width: 90, render: r => r.CATEGORY ? <Badge kind="b-gray" dot={false}>{r.CATEGORY}</Badge> : <span className="muted">—</span> },
        { key: 'AMOUNT',        label: 'จำนวนเงิน (฿)', align: 'right', width: 135, render: r => {
          const v = Number(r.AMOUNT || r.amount || 0);
          return <span style={{ color: v < 0 ? 'var(--bad)' : 'var(--good)', fontWeight: 700 }}>{v > 0 ? '+' : ''}{fmtNum(v, 0)}</span>;
        }},
        { key: 'STATUS',        label: 'สถานะ', width: 90, render: r => {
          const s = r.STATUS || r.status || '';
          const kind = s === 'DONE' ? 'b-green' : s === 'CANCELED' ? 'b-red' : s === 'ACTUAL' ? 'b-blue' : 'b-amber';
          return <Badge kind={kind} dot={false}>{s || '—'}</Badge>;
        }},
      ],
      modalFields: [
        { type: 'section', label: 'ข้อมูลประมาณการ (Planned)', icon: 'forecast' },
        { key: 'DATE',          label: 'DATE — วันที่บันทึก',     type: 'date' },
        { key: 'PAYMENT_DATE',  label: 'PAYMENT_DATE — วันที่คาดว่าจ่าย', type: 'date' },
        { key: 'DESCRIPTION',   label: 'DESCRIPTION — รายการ',    type: 'text', full: true },
        { key: 'JOB_NO',        label: 'JOB_NO — รหัสโครงการ',    type: 'text' },
        { key: 'PROJECT_NAME',  label: 'PROJECT_NAME — ชื่อโครงการ', type: 'text', full: true },
        { key: 'AMOUNT',        label: 'AMOUNT (บาท) · ติดลบ = ออก', type: 'number' },
        { key: 'Bank_AC',       label: 'Bank_AC — เลขที่บัญชี',   type: 'select',
            options: bankOptions,
            hint: bankOptions.length > 1 ? `เลือกจาก ${bankOptions.length - 1} บัญชีในระบบ` : 'ยังไม่มีบัญชีในระบบ — เพิ่มที่หน้า "บัญชีธนาคาร" ก่อน' },
        { key: 'EXPENSE_TYPE',  label: 'EXPENSE_TYPE',
            type: 'select',
            options: [
              { value: 'Manual', label: 'Manual — ทั่วไป' },
              { value: 'LOAN',   label: 'LOAN — เงินกู้' },
              { value: 'Salary', label: 'Salary — เงินเดือน' },
            ],
            hint: 'LOAN = ใช้ในส่วน inflow ของ cashflow' },
        { key: 'CATEGORY',      label: 'CATEGORY (หมวด CF 1-4)',
            type: 'select',
            options: [
              { value: '',  label: '— Auto-detect —' },
              { value: '1', label: '1 · ค่าใช้จ่ายดำเนินงาน' },
              { value: '2', label: '2 · ค่าใช้จ่ายโครงการ' },
              { value: '3', label: '3 · ต้นทุนทางการเงิน/ดอกเบี้ย' },
              { value: '4', label: '4 · เบ็ดเตล็ด + เงินเดือน' },
            ] },

        { type: 'section', label: 'STATUS lifecycle', icon: 'check' },
        { key: 'STATUS',        label: 'สถานะรายการ',
            type: 'select',
            options: [
              { value: 'PLANNED',  label: '1️⃣ PLANNED — ประมาณการ (ยังไม่เกิด)' },
              { value: 'ACTUAL',   label: '2️⃣ ACTUAL — เห็นใน statement แล้ว' },
              { value: 'BOOKED',   label: '3️⃣ BOOKED — บัญชีลงระบบแล้ว' },
              { value: 'CANCELED', label: '❌ CANCELED — ยกเลิก' },
            ],
            hint: 'PLANNED → ACTUAL (เมื่อเห็นในแบงค์) → BOOKED (เมื่อบัญชีลงระบบ)' },

        { type: 'section', label: 'ยอดที่เกิดขึ้นจริง (ACTUAL)', icon: 'coin' },
        { key: 'ACTUAL_AMOUNT', label: 'ACTUAL_AMOUNT — ยอดจริงที่เห็น', type: 'number',
            hint: 'กรอกเมื่อสถานะ ≥ ACTUAL — ใช้ค่าจริงตามที่ตัด statement' },
        { key: 'ACTUAL_DATE',   label: 'ACTUAL_DATE — วันที่ตัดจริง', type: 'date',
            hint: 'วันที่ statement แสดงรายการนี้' },

        { type: 'section', label: 'การลงบัญชี (BOOKED)', icon: 'invoice' },
        { key: 'REF_DOC',       label: 'REF_DOC — เลข JV/PV/AP', type: 'text',
            placeholder: 'เช่น JV-2026-002', hint: 'กรอกเมื่อบัญชีปิดงวดและลงระบบ' },
        { key: 'BOOKED_AT',     label: 'BOOKED_AT — วันที่บัญชีลง', type: 'date' },

        { type: 'section', label: 'อื่นๆ', icon: 'edit' },
        { key: 'IS_ACCRUED',    label: 'IS_ACCRUED', type: 'text' },
        { key: 'NOTE',          label: 'NOTE', type: 'textarea', full: true },
      ],
      summary: (rows) => {
        const inflow  = rows.filter(r => Number(r.AMOUNT||r.amount||0) > 0).reduce((s, r) => s + Number(r.AMOUNT||r.amount||0), 0);
        const outflow = rows.filter(r => Number(r.AMOUNT||r.amount||0) < 0).reduce((s, r) => s + Number(r.AMOUNT||r.amount||0), 0);
        return [
          { label: 'จำนวนรายการ', value: rows.length, unit: ' รายการ', digits: 0, icon: 'forecast', accent: 'var(--brand-500)' },
          { label: 'เงินเข้ารวม',  value: inflow,  accent: 'var(--good)', icon: 'arrow_down' },
          { label: 'เงินออกรวม',   value: Math.abs(outflow), accent: 'var(--bad)',  icon: 'arrow_up' },
          { label: 'สุทธิ',         value: inflow + outflow, accent: (inflow + outflow) >= 0 ? 'var(--good)' : 'var(--bad)', icon: 'coin' },
        ];
      },
    }} />
  );
}

function DataBankPage({ data, setData, toast }) {
  return (
    <DataCrudPage data={data} setData={setData} toast={toast} config={{
      title: 'DATA BANK · บัญชีธนาคาร',
      sub: 'RAW_BANK_BALANCE · ยอดคงเหลือบัญชีธนาคาร · วาง RAW ได้เลย',
      dataKey: 'bankAccounts',
      addLabel: 'เพิ่มบัญชี',
      singular: 'บัญชี',
      searchPlaceholder: 'ค้นหาธนาคาร/เลขที่บัญชี…',
      searchKeys: ['BANK_NAME', 'Bank_AC', 'NOTE'],
      filters: [
        { key: 'positive', label: 'ยอดเป็นบวก' },
        { key: 'negative', label: 'OD/ติดลบ' },
      ],
      filterFn: (r, k) => {
        const bal = Number(r.BALANCE ?? r.balance ?? 0);
        return k === 'positive' ? bal >= 0 : bal < 0;
      },
      emptyRow: { DATE: data.meta.asOf, BANK_NAME: '', Bank_AC: '', BALANCE: 0, AVAILABLE_BALANCE: 0, HOLD_AMOUNT: 0, NOTE: '' },
      tableMaxHeight: 'min(480px, calc(100vh - 400px))',
      columns: [
        { key: 'BANK_NAME',          label: 'ธนาคาร', width: 175, render: r => <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, color: 'var(--brand-700)' }}><HpBankLogo name={r.BANK_NAME || r.bankName} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.BANK_NAME || r.bankName}</span></div> },
        { key: 'Bank_AC',            label: 'เลขที่บัญชี', width: 160, mono: true },
        { key: 'BALANCE',            label: 'ยอดคงเหลือ (฿)', align: 'right', width: 160, render: r => {
          const v = Number(r.BALANCE ?? r.balance ?? 0);
          return <span style={{ color: v < 0 ? 'var(--bad)' : 'inherit', fontWeight: 600 }}>{fmtNum(v, 2)}</span>;
        }},
        { key: 'AVAILABLE_BALANCE',  label: 'วงเงินใช้ได้ (฿)', align: 'right', width: 160, render: r => <span>{fmtNum(Number(r.AVAILABLE_BALANCE||0), 2)}</span> },
        { key: 'HOLD_AMOUNT',        label: 'ยอด Hold (฿)', align: 'right', width: 120, render: r => <span className="muted">{fmtNum(Number(r.HOLD_AMOUNT||0), 2)}</span> },
        { key: 'DATE',               label: 'วันที่อัปเดต', type: 'date', width: 110 },
        { key: 'NOTE',               label: 'หมายเหตุ' },
      ],
      modalHeader: (draft) => {
        const bal   = Number(draft.BALANCE ?? 0);
        const avail = Number(draft.AVAILABLE_BALANCE ?? 0);
        const hold  = Number(draft.HOLD_AMOUNT ?? 0);
        const bank  = draft.BANK_NAME || '—';
        const ac    = draft.Bank_AC || '—';
        return (
          <div style={{
            padding: '16px 18px',
            borderRadius: 12,
            background: bal >= 0
              ? 'linear-gradient(135deg, color-mix(in oklch, var(--brand-500) 12%, transparent), color-mix(in oklch, var(--good) 8%, transparent))'
              : 'linear-gradient(135deg, color-mix(in oklch, var(--bad) 12%, transparent), color-mix(in oklch, var(--bad) 4%, transparent))',
            border: '1px solid var(--ink-100)',
            display: 'grid', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: 'color-mix(in oklch, var(--brand-500) 18%, transparent)',
                color: 'var(--brand-700)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><Icon name="bank" size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--brand-700)' }}>{bank}</div>
                <div className="muted" style={{ fontFamily: 'ui-monospace', fontSize: 12 }}>{ac}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>BALANCE</div>
                <div style={{ fontWeight: 700, fontSize: 20, color: bal < 0 ? 'var(--bad)' : 'var(--good)' }}>
                  {fmtNum(bal, 2)} <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>฿</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingTop: 6, borderTop: '1px dashed var(--ink-100)' }}>
              <div>
                <div className="muted" style={{ fontSize: 10.5 }}>AVAILABLE</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{fmtNum(avail, 2)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="muted" style={{ fontSize: 10.5 }}>HOLD</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{fmtNum(hold, 2)}</div>
              </div>
            </div>
          </div>
        );
      },
      modalFields: [
        { type: 'section', label: 'ข้อมูลบัญชี', icon: 'bank' },
        { key: 'BANK_NAME',         label: 'ชื่อธนาคาร',           type: 'text',   required: true, placeholder: 'เช่น SCB, KBANK, KTB', hint: 'รหัสย่อของธนาคาร' },
        { key: 'Bank_AC',           label: 'เลขที่บัญชี (Bank_AC)', type: 'text',   required: true, placeholder: '0000000000', hint: 'ไม่ต้องใส่ขีดคั่น' },

        { type: 'section', label: 'ยอดเงิน', icon: 'coin' },
        { key: 'BALANCE',           label: 'BALANCE (ยอดคงเหลือ)', type: 'number', suffix: '฿', required: true, hint: 'ยอดบัญชีรวม — ติดลบหมายถึง OD' },
        { key: 'AVAILABLE_BALANCE', label: 'AVAILABLE (ใช้ได้)',    type: 'number', suffix: '฿', hint: 'ยอดที่เบิกใช้ได้จริง' },
        { key: 'HOLD_AMOUNT',       label: 'HOLD (ติด hold)',       type: 'number', suffix: '฿', hint: 'จำนวนที่ถูก hold ไว้' },

        { type: 'section', label: 'อื่นๆ', icon: 'edit' },
        { key: 'DATE',              label: 'DATE (วันที่อัปเดต)',  type: 'date',   hint: 'วันที่ดึงยอดล่าสุด' },
        { key: 'NOTE',              label: 'NOTE (หมายเหตุ)',       type: 'textarea', full: true, rows: 2, placeholder: 'บันทึกเพิ่มเติม เช่น OD Limit, วงเงิน L/C ...' },
      ],
      summary: (rows) => {
        const bal  = rows.reduce((s, r) => s + Number(r.BALANCE ?? r.balance ?? 0), 0);
        const avail= rows.reduce((s, r) => s + Number(r.AVAILABLE_BALANCE ?? 0), 0);
        const pos  = rows.filter(r => Number(r.BALANCE??r.balance??0) >= 0).reduce((s, r) => s + Number(r.BALANCE??r.balance??0), 0);
        return [
          { label: 'จำนวนบัญชี',       value: rows.length, unit: ' บัญชี', digits: 0, icon: 'bank',  accent: 'var(--brand-500)' },
          { label: 'BALANCE รวม',      value: bal,   accent: bal >= 0 ? 'var(--good)' : 'var(--bad)', icon: 'coin' },
          { label: 'AVAILABLE รวม',    value: avail, accent: 'oklch(60% 0.18 295)', icon: 'arrow_down' },
          { label: 'ยอดบวก',          value: pos,   accent: 'var(--good)', icon: 'check' },
        ];
      },
    }} />
  );
}

function DataPVPage({ data, setData, toast }) {
  return (
    <DataCrudPage data={data} setData={setData} toast={toast} config={{
      title: 'DATA PV · Payment Voucher',
      sub: 'RAW_PV_PAYMENT · รายการจ่ายเงินจริงทั้งหมด · วาง RAW ได้เลย',
      dataKey: 'pvVouchers',
      importSourceNote: 'เอาข้อมูลจาก AP รายงาน 4.3 มาวาง/อัปโหลด',
      // ทะเบียน PV ต้นทางตั้งหัวคอลัมน์บัญชีที่ตัดจ่ายว่า "Account_Code" (ไม่ใช่ Bank_AC) → map เข้าให้ตรง
      headerAliases: { 'Account_Code': 'Bank_AC' },
      dedupKey: ['PL_PV_No', 'AP_No'],   // compound key — PV เดียวมีหลาย AP ได้
      scopeDateField: 'Pmt_Date',         // เทียบ missing เฉพาะ row ที่อยู่ในช่วงวันที่ของไฟล์ import
      previewSubFields: ['Payee', 'cc_remark'],   // subtitle ใน preview
      addLabel: 'เพิ่ม PV',
      singular: 'PV',
      searchPlaceholder: 'ค้นหา PL_PV_No / Payee / AP_No / Ref_Code…',
      searchKeys: ['PL_PV_No', 'Payee', 'AP_No', 'Ref_Code', 'cc_remark'],
      filters: [
        { key: 'HRD', label: 'HRD' }, { key: 'FIN', label: 'FIN' },
        { key: 'ACC', label: 'ACC' }, { key: 'PMD', label: 'PMD' },
      ],
      filterFn: (r, k) => r.Ref_Code === k,
      emptyRow: {
        Project_Dpt: '', Ref_Code: '', PL_PV_No: '', jobcode: '',
        Pmt_Date: data.meta.asOf, Type_of_Pmt: 'Transfer Bank', Option: '',
        Payee: '', Type: '', AP_No: '', vchdate: '', Chq_No: '', Chq_Date: '',
        Bnf_Acct_No: '', Bnf_Bank: '', Bank_AC: '', Bank_Id: '',
        Remark: '', cc_remark: '',
        Amount: 0, Down_payment: 0, Deduct: 0, Vat: 0, Ret: 0,
        Before_WHT: 0, WHT: 0, Less_Other: 0, Total: 0, Minus_Other: 0, Net_Amount: 0,
      },
      readOnlyRows: true,    // PV records come from accounting system — don't edit them
      allowDelete: true,     // …but allow deleting stale entries that never actually paid out
      tableMaxHeight: 'min(480px, calc(100vh - 400px))',
      columns: [
        { key: 'Pmt_Date',   label: 'วันที่จ่าย',   type: 'date',  width: 100, align: 'center' },
        { key: 'PL_PV_No',   label: 'เลขที่ PV',    width: 120, mono: true, align: 'center' },
        { key: 'AP_No',      label: 'เลขที่ AP',    width: 120, mono: true, align: 'center' },
        { key: 'Payee',      label: 'ผู้รับเงิน' },
        { key: 'Net_Amount', label: 'ยอดสุทธิ (฿)', align: 'right', headerAlign: 'right', width: 130, sortValue: r => parseNum(r.Net_Amount),
          render: r => <span style={{ fontWeight: 700, color: parseNum(r.Net_Amount) < 0 ? 'var(--bad)' : 'var(--ink-800)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(parseNum(r.Net_Amount), 2)}</span> },
        { key: 'cc_remark',  label: 'หมายเหตุ' },
      ],
      modalFields: [
        { type: 'section', label: 'ข้อมูลหลัก', icon: 'invoice', cols: 3 },
        // แถว 1: เลขที่ AP | เลขที่ PV | วันที่จ่าย
        { key: 'AP_No',       label: 'เลขที่ AP',      type: 'text' },
        { key: 'PL_PV_No',    label: 'เลขที่ PV',      type: 'text' },
        { key: 'Pmt_Date',    label: 'วันที่จ่าย',     type: 'date' },
        // แถว 2: ผู้รับเงิน (span 2) | Ref Code
        { key: 'Payee',       label: 'ผู้รับเงิน',     type: 'text', span: 2 },
        { key: 'Ref_Code',    label: 'Ref Code',       type: 'text' },
        // แถว 3: บัญชีธนาคาร | ประเภทการจ่าย
        { key: 'Bank_AC',     label: 'บัญชีธนาคาร',   type: 'text' },
        { key: 'Type_of_Pmt', label: 'ประเภทการจ่าย', type: 'text' },
        { type: 'section', label: 'ยอดเงิน', icon: 'coin', cols: 3 },
        // แถว 1: Amount | WHT | VAT
        { key: 'Amount',     label: 'Amount (ก่อนหัก)', type: 'number' },
        { key: 'WHT',        label: 'WHT',              type: 'number' },
        { key: 'Vat',        label: 'VAT',              type: 'number' },
        // แถว 2: ยอดสุทธิ มุมขวาล่าง (col 3) — highlight
        { key: 'Net_Amount', label: 'ยอดสุทธิ', type: 'number', gridColumn: '3', highlight: true },
        { type: 'section', label: 'หมายเหตุ', icon: 'edit' },
        { key: 'cc_remark',  label: 'หมายเหตุ', type: 'text', full: true },
      ],
      summary: (rows) => {
        const total     = rows.reduce((s, r) => s + parseNum(r.Net_Amount), 0);
        const month     = (new Date()).toISOString().slice(0, 7);
        const thisMonth = rows.filter(r => (r.Pmt_Date || '').slice(0, 7) === month)
          .reduce((s, r) => s + parseNum(r.Net_Amount), 0);
        const byRef = {};
        rows.forEach(r => { const k = r.Ref_Code || '?'; byRef[k] = (byRef[k]||0) + parseNum(r.Net_Amount); });
        const topRef = Object.entries(byRef).sort((a,b)=>b[1]-a[1])[0] || ['—', 0];
        return [
          { label: 'จำนวน PV',        value: rows.length, unit: ' รายการ', digits: 0, icon: 'invoice', accent: 'var(--brand-500)' },
          { label: 'ยอดสุทธิรวม',     value: total,     accent: 'var(--bad)', icon: 'arrow_up' },
          { label: 'เดือนนี้',         value: thisMonth, accent: 'oklch(60% 0.18 295)', icon: 'coin' },
          { label: `Ref สูงสุด: ${topRef[0]}`, value: topRef[1], accent: 'oklch(70% 0.16 75)', icon: 'money' },
        ];
      },
    }} />
  );
}

// Parse dd/MM/yyyy or ISO date string → Date object
function parseDue(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// Robust number parser — handles "2,000.00" strings, ฿ signs, etc.
function parseNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Amount input: formatted display (2,000.00) when not focused; raw number when editing
function AmountInput({ value, onChange, label, required }) {
  const [focused, setFocused] = dxState(false);
  const [raw, setRaw] = dxState('');
  const numVal = parseNum(value);
  const display = numVal === 0 && (value == null || value === '') ? '' : fmtNum(numVal, 2);
  return (
    <div className="field">
      <label style={{ fontSize: 12 }}>{label}{required && <span style={{ color: 'var(--bad)', marginLeft: 4 }}>*</span>}</label>
      <div style={{ position: 'relative' }}>
        <input
          className="input"
          type="text"
          value={focused ? raw : display}
          onChange={e => setRaw(e.target.value)}
          onFocus={e => { setFocused(true); setRaw(numVal === 0 ? '' : String(numVal)); setTimeout(() => e.target.select(), 0); }}
          onBlur={() => { onChange(parseNum(raw)); setFocused(false); }}
          style={{ textAlign: 'right', paddingRight: 26, fontWeight: 600, fontFamily: 'ui-monospace', color: numVal < 0 ? 'var(--bad)' : 'inherit' }}
        />
        <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--ink-400)', pointerEvents: 'none' }}>฿</span>
      </div>
    </div>
  );
}

// ─── AP Edit Modal — 3-col grid, highlight due date + netpayment ─────────────
function APEditModal({ row, onClose, onSave, onDelete }) {
  const [draft, setDraft]             = dxState(null);
  const [confirmDelete, setConfirm]   = dxState(false);
  dxEffect(() => {
    if (row) {
      const d = { ...row };
      // Normalise docno: case-insensitive / underscore-insensitive lookup
      if (!d.docno || d.docno === '') {
        const norm = (s) => String(s).toLowerCase().replace(/[_\s-]/g, '');
        const candidates = ['docno', 'documentno', 'docnum', 'document'];
        const k = Object.keys(d).find(key => candidates.includes(norm(key)));
        if (k && d[k]) d.docno = d[k];
      }
      setDraft(d);
    } else {
      setDraft(null);
    }
    setConfirm(false);
  }, [row]);
  if (!row || !draft) return null;

  const Hdr = ({ label, icon }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--brand-700)', paddingBottom: 6, borderBottom: '1px solid var(--ink-100)', gridColumn: '1 / -1', marginTop: 4 }}>
      <Icon name={icon} size={13} />{label}
    </div>
  );

  // highlight styles — applied LAST to override base styles
  const dueStyle   = { background: 'color-mix(in oklch, oklch(65% 0.2 55) 10%, transparent)', border: '1px solid color-mix(in oklch, oklch(65% 0.2 55) 32%, transparent)', color: 'oklch(42% 0.2 55)', fontWeight: 700 };
  const totalStyle = { background: 'color-mix(in oklch, var(--bad) 9%, transparent)',           border: '1px solid color-mix(in oklch, var(--bad) 28%, transparent)',           color: 'var(--bad)',          fontWeight: 700 };

  const F = ({ fkey, label, hint, span, highlight }) => {
    const v = draft[fkey];
    const display = (v === null || v === undefined || v === '') ? '—' : String(v);
    return (
      <div className="field" style={{ gridColumn: span ? `span ${span}` : 'auto' }}>
        <label style={{ fontSize: 12, color: 'var(--ink-500)' }}>{label}</label>
        <div style={{ minHeight: 34, borderRadius: 7, border: '1px solid var(--ink-100)', padding: '6px 10px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: 'default', userSelect: 'text', color: 'var(--ink-700)', background: 'var(--ink-25, #f9fafb)', ...(highlight === 'due' ? dueStyle : {}) }}>{display}</div>
        {hint && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>}
      </div>
    );
  };

  const ROAmount = ({ value, label, highlight }) => {
    const numVal = parseNum(value);
    const display = (value === null || value === undefined || value === '') ? '—' : fmtNum(numVal, 2);
    return (
      <div className="field">
        <label style={{ fontSize: 12, color: 'var(--ink-500)' }}>{label}</label>
        <div style={{ height: 34, borderRadius: 7, border: '1px solid var(--ink-100)', padding: '0 28px 0 10px', fontSize: 13, fontFamily: 'ui-monospace', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', position: 'relative', cursor: 'default', userSelect: 'text', color: 'var(--ink-700)', background: 'var(--ink-25, #f9fafb)', ...(highlight ? totalStyle : {}) }}>
          {display}
          <span style={{ position: 'absolute', right: 8, fontSize: 11, color: highlight ? 'color-mix(in oklch, var(--bad) 55%, transparent)' : 'var(--ink-400)' }}>฿</span>
        </div>
      </div>
    );
  };

  return (
    <>
      <Modal open={!!row} title={`ข้อมูล AP · ${draft.vchno || '—'}`}
        maxWidth={900} onClose={onClose}
        footer={<>
          <button className="btn btn-ghost" onClick={onClose}>ปิด</button>
        </>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 16px' }}>

          <Hdr label="ข้อมูลเอกสาร" icon="invoice" />
          {/* บรรทัด 1: วันที่ | vchno | docno */}
          <F fkey="vchdate" label="วันที่ใบสำคัญ" />
          <F fkey="vchno"   label="vchno · ใบสำคัญ" />
          <F fkey="docno"   label="docno (col B)" />
          {/* บรรทัด 2: refno | refcode | due (highlight) */}
          <F fkey="refno"   label="refno · เลขที่อ้างอิง" />
          <F fkey="refcode" label="refcode" />
          <F fkey="due2"    label="วันครบกำหนด" highlight="due" />

          <Hdr label="เจ้าหนี้ (VENDOR)" icon="money" />
          <F fkey="cust_name" label="ชื่อเจ้าหนี้" span={2} />
          <F fkey="acct_no"   label="รหัสเจ้าหนี้" />

          <Hdr label="แผนก / โครงการ" icon="forecast" />
          <F fkey="dpt_code" label="รหัสแผนก" />
          <F fkey="dpt_name" label="ชื่อแผนก" />
          <F fkey="jobcode"  label="Job Code" />
          <F fkey="jobname"  label="ชื่องาน" span={3} />

          <Hdr label="ยอดเงิน (AMOUNTS)" icon="coin" />
          {/* บรรทัด 1: Amount | VAT | net_new */}
          <ROAmount value={draft.Amount}     label="Amount · ยอดก่อนหัก" />
          <ROAmount value={draft.VAT}        label="VAT · ภาษีมูลค่าเพิ่ม" />
          <ROAmount value={draft.net_new}    label="net_new · รวม VAT" />
          {/* บรรทัด 2: Less_Ret | WHT_EXT | netpayment (highlight) */}
          <ROAmount value={draft.Less_Ret}   label="Less_Ret · หักประกัน" />
          <ROAmount value={draft.WHT_EXT}    label="WHT_EXT · ภาษีหัก ณ จ่าย" />
          <ROAmount value={draft.netpayment} label="netpayment · ยอดสุทธิ" highlight />

          <Hdr label="หมายเหตุ" icon="edit" />
          <F fkey="remark" label="remark · คำอธิบาย" span={3} />
        </div>
      </Modal>
    </>
  );
}

// ─── AP Outstanding page ─────────────────────────────────────────────────────
// Canonical field name for due date is 'due2'.
// Different Excel exports / Google Sheet imports may use different column names;
// normalise them all to 'due2' so the table and popup always have it.
const _DUE_ALT_KEYS = [
  'due', 'due1', 'DUE', 'DUE2', 'Due', 'Due2', 'Due1',
  'due_date', 'due_date2', 'DUE_DATE', 'DUE_DATE2',
  'duedate', 'DUEDATE', 'DueDate',
  'maturity', 'MATURITY',
];
function _normPayableRow(r) {
  if (r.due2) return r;                          // already canonical
  for (const k of _DUE_ALT_KEYS) {
    if (r[k]) return { ...r, due2: r[k] };       // promote first found variant
  }
  return r;
}

// ─── AP import: change-detection + summary-row / paid-via-PV filters ──────────
// Fields ที่เทียบ diff ตอนนำเข้าซ้ำ (vchno เดิม) — แสดงผ่าน <ImportPreview/>
// ⚠️ ใช้เฉพาะคอลัมน์ที่อยู่ใน schema payables จริง (apps_script Code.gs ENTITY_HEADERS.payables)
// ห้ามใส่ field ที่ Sheet ไม่ได้เก็บ (เช่น Net_amount2_new) ไม่งั้นค่าเดิมว่าง → ทุกแถวกลายเป็น "แก้"
const _PAYABLE_DIFF_FIELDS = [
  { key: 'netpayment',      label: 'ยอดจ่ายสุทธิ', type: 'number' },
  { key: 'Amount',          label: 'ยอดเงิน',       type: 'number' },
  { key: 'VAT',             label: 'VAT',           type: 'number' },
  { key: 'Balance_Amount1', label: 'ยอดคงเหลือ',    type: 'number' },
  { key: 'due2',            label: 'วันครบกำหนด',   type: 'date'   },
  { key: 'remark',          label: 'หมายเหตุ',      type: 'text'   },
];
const _PAYABLE_FIELD_BY_KEY = Object.fromEntries(_PAYABLE_DIFF_FIELDS.map(f => [f.key, f]));

// แถวรายการจริง = vchno ขึ้นต้น APO/APS/APV; แถวสรุปยอด "Total By Vendor" มี vchno="0"
// + กัน maincode="Vendor :…" / ty="Total…" หลุดเข้ามา
function _isPayableDetailRow(o) {
  const vch = String(o.vchno || '').trim();
  if (!/^AP[OSV]/i.test(vch)) return false;
  if (/^Vendor\s*:/i.test(String(o.maincode || ''))) return false;
  if (/^Total/i.test(String(o.ty || '').trim()))     return false;
  return true;
}

// Parse ไฟล์ "เจ้าหนี้คงค้างแบบละเอียด" XML จากโปรแกรม EXPRESS (SpreadsheetML)
// โครงสร้างลำดับชั้น: A11=ชื่อเจ้าหนี้ → A12+DateTime=แถวรายการ → A14=แถวสรุป(ข้าม)
// Col index (1-based): 1=วันที่  3=เลขที่เอกสาร  4=เลขที่บิล  5=ยอดในบิล
//   7=ยอดคงค้าง  18=ครบกำหนด  19=หมายเหตุ  20=เลขที่เอกสาร PO
function parseExpressXML(xmlText) {
  var SS = 'urn:schemas-microsoft-com:office:spreadsheet';
  function ssAttr(el, name) {
    return el.getAttributeNS(SS, name) || el.getAttribute('ss:' + name) || '';
  }
  var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML รูปแบบไม่ถูกต้อง — ตรวจสอบไฟล์อีกครั้ง');
  var rowEls = Array.from(doc.getElementsByTagNameNS('*', 'Row'));
  var results = [];
  var vendor = '', vendorCode = '';
  rowEls.forEach(function(rowEl) {
    var cellEls = Array.from(rowEl.getElementsByTagNameNS('*', 'Cell'));
    if (!cellEls.length) return;
    var cm = {}, li = 0;
    cellEls.forEach(function(cell) {
      var is = ssAttr(cell, 'Index');
      li = is ? parseInt(is) : li + 1;
      var d = cell.getElementsByTagNameNS('*', 'Data')[0];
      cm[li] = {
        v: d ? d.textContent.trim() : '',
        t: d ? (d.getAttribute('ss:Type') || ssAttr(d, 'Type') || '') : '',
        s: ssAttr(cell, 'StyleID'),
      };
    });
    var c1 = cm[1];
    if (!c1) return; // ไม่มี col1 = แถวตัดยอดชำระ → ข้าม
    if (c1.s === 'A11') { // แถวชื่อเจ้าหนี้ เช่น "บริษัท ก จำกัด /A002"
      var raw = c1.v, si = raw.lastIndexOf('/');
      if (si >= 0) { vendor = raw.slice(0, si).trim(); vendorCode = raw.slice(si + 1).trim(); }
      else { vendor = raw; vendorCode = ''; }
      return;
    }
    if (c1.s === 'A14' || c1.s === 'A10') return; // สรุปยอด / หัวหมวด → ข้าม
    if (c1.s === 'A12' && c1.t === 'DateTime') { // แถวรายการจริง
      var vchno = (cm[3] && cm[3].v) || '';
      if (!vchno) return;
      var g = function(i) { return (cm[i] && cm[i].v) || ''; };
      var gn = function(i) { var v = g(i); return v ? String(parseFloat(v.replace(/,/g, '')) || 0) : ''; };
      results.push({
        vchdate:    c1.v,      // ISO date เช่น "2026-04-30"
        vchno:      vchno,     // RS… / AP… / AD… / CV…
        docno:      g(4),      // เลขที่บิล (invoice no.)
        cust_name:  vendor,    // ชื่อเจ้าหนี้
        maincode:   vendorCode,
        Amount:     gn(5),     // ยอดในบิล
        netpayment: gn(7),     // ยอดคงค้าง
        due2:       g(18),     // วันครบกำหนด (ISO)
        remark:     g(19),     // หมายเหตุ
        refno:      g(20),     // เลขที่เอกสาร PO
      });
    }
  });
  return results;
}

// เทียบค่าให้ทน format ต่าง — date → epoch (กัน DD/MM vs ISO), number → parseNum (กัน "2,000.00")
function _payableNormCmp(v, type) {
  if (type === 'number') return parseNum(v);
  if (type === 'date')   { const d = parseDue(v); return d ? d.getTime() : (v == null ? '' : String(v).trim()); }
  return v == null ? '' : String(v).trim();
}

// Preview เฉพาะหน้าเจ้าหนี้ — จัดกลุ่มตามสถานะ (ใหม่/แก้/หาย/เหมือนเดิม) แบบย่อ กดกางดูได้
// + รายการ "หาย" เลือกลบทีละอัน (selectedMissing = Set ของ id แถวเดิมที่จะลบ)
function PayableImportPreview({ preview, selectedMissing, setSelectedMissing }) {
  const { added = [], changed = [], unchanged = [], missing = [], fieldByKey = {} } = preview;
  const [open, setOpen] = dxState({ added: false, changed: false, missing: true, unchanged: false });
  const toggleSec = k => setOpen(o => ({ ...o, [k]: !o[k] }));

  const fmtCell = (v, type) => {
    if (v === null || v === undefined || String(v).trim() === '') return '—';
    if (type === 'number') return fmtNum(parseNum(v), 2);
    if (type === 'date')   return fmtDate(v) || String(v);
    return String(v);
  };
  const rowOf = it => it.existing || it.row || {};
  const subOf = r => [r.cust_name, r.remark].filter(x => x && String(x).trim()).join(' · ');

  const missingIds = missing.map(m => m.row?.id).filter(Boolean);
  const toggleMissing = (id) => setSelectedMissing(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allMissingSel = missingIds.length > 0 && missingIds.every(id => selectedMissing.has(id));
  const toggleAllMissing = () => setSelectedMissing(allMissingSel ? new Set() : new Set(missingIds));

  const SECTIONS = [
    { key: 'added',     icon: '🆕', label: 'รายการใหม่',           color: 'var(--good)',        items: added },
    { key: 'changed',   icon: '✏️', label: 'แก้ไข',                color: 'oklch(60% 0.18 75)', items: changed },
    { key: 'missing',   icon: '⚠️', label: 'หาย (ไม่มีในไฟล์ใหม่)', color: 'var(--bad)',        items: missing },
    { key: 'unchanged', icon: '=',  label: 'เหมือนเดิม',            color: 'var(--ink-400)',     items: unchanged },
  ];

  const chip = (c, n, label) => (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: c, padding: '2px 8px', borderRadius: 5,
      background: `color-mix(in oklch, ${c} 12%, transparent)` }}>{label} {n}</span>
  );

  const rowStyle  = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', fontSize: 12, borderTop: '1px solid var(--ink-100, #eef1f5)' };
  const monoStyle = { fontFamily: 'ui-monospace', fontWeight: 600, color: 'var(--ink-800)', whiteSpace: 'nowrap' };
  const subStyle  = { fontSize: 11, color: 'var(--ink-500)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const amtStyle  = { fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--bad)', whiteSpace: 'nowrap' };

  const renderRow = (sec, it, i) => {
    const r = rowOf(it);
    const net = fmtNum(parseNum(r.netpayment), 2);
    if (sec.key === 'missing') {
      const id = it.row?.id;
      const checked = selectedMissing.has(id);
      return (
        <label key={i} style={{ ...rowStyle, cursor: 'pointer', background: checked ? 'color-mix(in oklch, var(--bad) 8%, transparent)' : 'transparent' }}>
          <input type="checkbox" checked={checked} onChange={() => toggleMissing(id)} />
          <span style={monoStyle}>{r.vchno || '—'}</span>
          <span style={subStyle}>{subOf(r)}</span>
          <span style={amtStyle}>{net}</span>
        </label>
      );
    }
    if (sec.key === 'changed') {
      return (
        <div key={i} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={monoStyle}>{r.vchno || '—'}</span>
            <span style={subStyle}>{r.cust_name || ''}</span>
          </div>
          <div style={{ display: 'grid', gap: 2, marginLeft: 4 }}>
            {Object.entries(it.diff || {}).map(([fk, d]) => {
              const f = fieldByKey[fk];
              return (
                <div key={fk} style={{ fontSize: 11.5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: 'var(--ink-500)', minWidth: 92 }}>{f?.label || fk}:</span>
                  <span style={{ textDecoration: 'line-through', color: 'var(--bad)', background: 'color-mix(in oklch, var(--bad) 10%, transparent)', padding: '0 5px', borderRadius: 3 }}>{fmtCell(d.old, f?.type)}</span>
                  <span style={{ color: 'var(--ink-400)' }}>→</span>
                  <span style={{ color: 'var(--good)', fontWeight: 600, background: 'color-mix(in oklch, var(--good) 12%, transparent)', padding: '0 5px', borderRadius: 3 }}>{fmtCell(d.new, f?.type)}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return (
      <div key={i} style={rowStyle}>
        <span style={monoStyle}>{r.vchno || '—'}</span>
        <span style={subStyle}>{subOf(r)}</span>
        <span style={amtStyle}>{net}</span>
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {/* summary chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {chip('var(--good)', added.length, '🆕 ใหม่')}
        {chip('oklch(55% 0.18 75)', changed.length, '✏️ แก้')}
        {chip('var(--bad)', missing.length, '⚠️ หาย')}
        {chip('var(--ink-500)', unchanged.length, '= เหมือนเดิม')}
        {selectedMissing.size > 0 && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--bad)', fontWeight: 700 }}>เลือกลบ {selectedMissing.size} รายการ</span>}
      </div>

      {SECTIONS.filter(s => s.items.length > 0).map(sec => {
        const isOpen = open[sec.key];
        return (
          <div key={sec.key} style={{ border: `1px solid color-mix(in oklch, ${sec.color} 30%, var(--ink-100, #e5e9f0))`, borderRadius: 8, overflow: 'hidden' }}>
            <button type="button" onClick={() => toggleSec(sec.key)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              background: `color-mix(in oklch, ${sec.color} 7%, transparent)`, border: 'none', cursor: 'pointer', textAlign: 'left',
            }}>
              <span style={{ fontSize: 14 }}>{sec.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink-800)' }}>{sec.label}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: sec.color, background: `color-mix(in oklch, ${sec.color} 16%, transparent)`, padding: '1px 8px', borderRadius: 10 }}>{sec.items.length}</span>
              {sec.key === 'missing' && selectedMissing.size > 0 && <span style={{ fontSize: 11, color: 'var(--bad)', fontWeight: 600 }}>· เลือกลบ {selectedMissing.size}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-400)' }}>{isOpen ? '▲ ย่อ' : '▼ ดูรายการ'}</span>
            </button>
            {isOpen && (
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {sec.key === 'missing' && (
                  <label style={{ ...rowStyle, cursor: 'pointer', background: 'var(--ink-50, #f7f8fa)', position: 'sticky', top: 0, zIndex: 1, fontWeight: 600 }}>
                    <input type="checkbox" checked={allMissingSel} onChange={toggleAllMissing} />
                    <span style={{ fontSize: 12 }}>เลือกทั้งหมด</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-500)' }}>{selectedMissing.size}/{missing.length}</span>
                  </label>
                )}
                {sec.items.map((it, i) => renderRow(sec, it, i))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DataPayablePage({ data, setData, toast }) {
  const [edit, setEdit]             = dxState(null);
  const [query, setQuery]           = dxState('');
  const [showSug, setShowSug]       = dxState(false);
  const [docFilter, setDocFilter]   = dxState('all');
  const [dptFilter, setDptFilter]   = dxState('all');
  const [sortKey, setSortKey]       = dxState('vchdate');
  const [sortDir, setSortDir]       = dxState('desc');
  const [showImport, setShowImport]           = dxState(false);
  const [importText, setImportText]           = dxState('');
  const [importHelpOpen, setImportHelpOpen]   = dxState(false);
  const [importPasteOpen, setImportPasteOpen] = dxState(false);
  const [importDragOver, setImportDragOver]   = dxState(false);
  const [importFileName, setImportFileName]   = dxState('');
  const [importPreview, setImportPreview]     = dxState(null);   // {added,changed,unchanged,missing,paidCut,…}
  const [selectedMissing, setSelectedMissing] = dxState(() => new Set());   // id แถวเดิม (หาย) ที่เลือกจะลบ
  const [xmlParsedRows, setXmlParsedRows]     = dxState(null);  // rows จาก parseExpressXML (XML path)

  // อัปโหลดไฟล์ → .xml ใช้ parseExpressXML (EXPRESS), อื่นๆ ใช้ XLSX.js → TSV
  const handleFileUpload = (file) => {
    if (!file) return;
    // ── XML จาก EXPRESS ──────────────────────────────────────────────────────
    if (file.name.toLowerCase().endsWith('.xml')) {
      const rdr = new FileReader();
      rdr.onload = function(e) {
        try {
          const rows = parseExpressXML(e.target.result);
          if (!rows.length) { toast('ไม่พบรายการเจ้าหนี้ในไฟล์ XML — ตรวจสอบรูปแบบไฟล์'); return; }
          setXmlParsedRows(rows);
          setImportFileName(file.name);
          toast('อ่านไฟล์ XML แล้ว ' + rows.length + ' รายการ — กด "ตรวจสอบข้อมูล" เพื่อดู preview');
        } catch (err) {
          toast('อ่านไฟล์ XML ไม่สำเร็จ: ' + err.message);
        }
      };
      rdr.readAsText(file, 'UTF-8');
      return;
    }
    // ── Excel / CSV ──────────────────────────────────────────────────────────
    if (!window.XLSX) { toast('ไม่พบไลบรารี SheetJS — กรุณาใช้วิธี Copy-Paste แทน'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // อ่าน raw แล้ว convert date cells ผ่าน SSF.parse_date_code (กัน timezone bug)
        const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: false, cellNF: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        Object.keys(ws).forEach(addr => {
          if (addr[0] === '!') return;
          const c = ws[addr];
          if (!c) return;
          if (c.t === 'n' && typeof c.v === 'number' && c.z && /[ymd]/i.test(String(c.z))) {
            try {
              const dc = window.XLSX.SSF.parse_date_code(c.v);
              if (dc && dc.y) {
                const iso = `${dc.y}-${String(dc.m).padStart(2,'0')}-${String(dc.d).padStart(2,'0')}`;
                c.v = iso; c.w = iso; c.t = 's';
              }
            } catch (_) { /* skip */ }
          }
          // กัน TAB/ขึ้นบรรทัดที่ฝังในเซลล์ (เช่น remark) → ไม่งั้นคอลัมน์เลื่อนตอนแปลงเป็น TSV
          if (typeof c.v === 'string') c.v = c.v.replace(/[\t\r\n]+/g, ' ');
          if (typeof c.w === 'string') c.w = c.w.replace(/[\t\r\n]+/g, ' ');
        });
        const tsv = window.XLSX.utils.sheet_to_csv(ws, { FS: '\t' });
        setImportText(tsv);
        setImportFileName(file.name);
        toast(`อ่านไฟล์ ${file.name} แล้ว — กรุณาตรวจสอบและกด "นำเข้า"`);
      } catch (err) {
        toast('อ่านไฟล์ไม่สำเร็จ: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Normalise due-date field variants → 'due2' before any filtering / display
  const rows = dxMemo(() => (data.payables || []).map(_normPayableRow), [data.payables]);

  // ── รายการที่ "จ่ายแล้ว" = vchno ตรงกับ AP_No ในหน้า PV
  //    เกณฑ์เดียวกับ import paidCut (handleImport) และ cashflow isApPaid — จ่ายผ่าน PV แล้ว
  //    จึงไม่ใช่เจ้าหนี้คงค้าง ไม่ควรอยู่ในชีตนี้ (ผู้ใช้กดล้างได้จาก banner ด้านบน)
  const paidVchnoSet = dxMemo(() => {
    const s = new Set();
    (data.pvVouchers || []).forEach(pv => { const a = String(pv.AP_No || '').trim(); if (a) s.add(a); });
    return s;
  }, [data.pvVouchers]);
  const paidRows = dxMemo(() =>
    rows.filter(r => { const v = String(r.vchno || '').trim(); return v && paidVchnoSet.has(v); })
  , [rows, paidVchnoSet]);

  // ล้างรายการที่จ่ายแล้วออกจากชีต — ลบจริงผ่าน sync (replaceAll + baseIds ลบเฉพาะ id ที่ตัดออก)
  const cleanPaidNow = () => {
    if (!paidRows.length) return;
    if (!confirm(`พบ ${paidRows.length} รายการที่จ่ายแล้ว (vchno มีใน PV)\nยืนยันลบออกจากรายการคงค้าง (ชีต payables)?`)) return;
    const ids = new Set(paidRows.map(r => r.id).filter(Boolean));
    if (!ids.size) { toast('รายการที่จ่ายแล้วไม่มี id — ลบไม่ได้'); return; }
    setData(d => ({ ...d, payables: (d.payables || []).filter(r => !ids.has(r.id)) }));
    toast(`ล้างรายการที่จ่ายแล้ว ${ids.size} รายการออกจากชีตแล้ว`);
  };

  const getDocType = (vchno) => {
    if (!vchno) return 'other';
    const v = String(vchno).toUpperCase();
    if (v.startsWith('APO')) return 'APO';
    if (v.startsWith('APS')) return 'APS';
    if (v.startsWith('APV')) return 'APV';
    if (v.startsWith('AP'))  return 'AP';   // EXPRESS
    if (v.startsWith('RS'))  return 'RS';   // EXPRESS ใบรับสินค้า
    if (v.startsWith('AD'))  return 'AD';   // EXPRESS ทดรองจ่าย
    if (v.startsWith('CV'))  return 'CV';   // EXPRESS
    return 'other';
  };

  const dptCodes = dxMemo(() =>
    [...new Set(rows.map(r => r.dpt_code).filter(Boolean))].sort()
  , [rows]);

  const filtered = dxMemo(() => {
    let xs = rows;
    if (docFilter !== 'all') xs = xs.filter(r => getDocType(r.vchno) === docFilter);
    if (dptFilter !== 'all') xs = xs.filter(r => r.dpt_code === dptFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      xs = xs.filter(r => ['cust_name','vchno','docno','jobcode','jobname','remark','dpt_code']
        .some(k => String(r[k]||'').toLowerCase().includes(q)));
    }
    return xs.slice().sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'vchdate' || sortKey === 'due2') {
        const da = parseDue(av) || new Date(0), db = parseDue(bv) || new Date(0);
        return sortDir === 'asc' ? da - db : db - da;
      }
      const na = Number(av), nb = Number(bv);
      if (!isNaN(na) && !isNaN(nb)) return sortDir === 'asc' ? na - nb : nb - na;
      av = String(av||''); bv = String(bv||'');
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [rows, docFilter, dptFilter, query, sortKey, sortDir]);

  const suggestions = dxMemo(() => {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const seen = new Set();
    const out = [];
    rows.forEach(r => {
      ['cust_name','vchno'].forEach(k => {
        const v = String(r[k]||'');
        if (v.toLowerCase().includes(q) && !seen.has(v) && v) { seen.add(v); out.push(v); }
      });
    });
    return out.slice(0, 8);
  }, [rows, query]);

  // KPI — netpayment (col Q) tracks filtered rows
  const fNet    = filtered.reduce((s, r) => s + parseNum(r.netpayment), 0);
  const overdueRows = filtered.filter(r => { const d = parseDue(r.due2); return d && d < new Date(); });
  const overdue = overdueRows.length;
  const overdueNet = overdueRows.reduce((s, r) => s + parseNum(r.netpayment), 0);

  // This month total
  const monthKey = new Date().toISOString().slice(0, 7);
  const thisMonth = filtered.filter(r => {
    const d = r.vchdate; return d && String(d).slice(0, 7) === monthKey;
  }).reduce((s, r) => s + parseNum(r.netpayment), 0);

  // Top department by Net Payment (filtered)
  const byDpt = {};
  filtered.forEach(r => { const k = r.dpt_code || '?'; byDpt[k] = (byDpt[k]||0) + parseNum(r.netpayment); });
  const topDpt = Object.entries(byDpt).sort((a,b)=>b[1]-a[1])[0] || ['—', 0];

  // Doc-type counts
  const dtCount = { APO: 0, APS: 0, APV: 0, AP: 0, RS: 0, AD: 0, CV: 0 };
  rows.forEach(r => { const t = getDocType(r.vchno); if (dtCount[t] !== undefined) dtCount[t]++; });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const apSort = { key: sortKey, dir: sortDir };

  const save = (row) => {
    setData(d => ({
      ...d,
      payables: row.id
        ? d.payables.map(x => x.id === row.id ? row : x)
        : [{ ...row, id: WTPData.newId() }, ...d.payables],
    }));
    setEdit(null);
    toast('บันทึกข้อมูลแล้ว');
  };

  const remove = (id) => {
    setData(d => ({ ...d, payables: d.payables.filter(x => x.id !== id) }));
    toast('ลบรายการแล้ว');
  };

  const resetImport = () => {
    setShowImport(false); setImportText(''); setImportPasteOpen(false);
    setImportFileName(''); setImportPreview(null); setSelectedMissing(new Set()); setXmlParsedRows(null);
  };

  // วิเคราะห์ไฟล์ → สร้าง preview (แยกใหม่/แก้/หาย/จ่ายแล้ว) ก่อน commit
  // รองรับ 2 path: XML จาก EXPRESS (xmlParsedRows) และ TSV/Excel (importText)
  const handleImport = () => {
    let detail, blankSkipped = 0, summarySkipped = 0;

    if (xmlParsedRows) {
      // ── XML path: rows ผ่าน parseExpressXML มาแล้ว (filtered + cust_name set) ──
      detail = xmlParsedRows;
    } else {
      // ── TSV/Excel path ──────────────────────────────────────────────────────
      if (!importText.trim()) { toast('ไม่มีข้อมูล'); return; }
      const lines = importText.trim().split('\n');
      if (lines.length < 2) { toast('ต้องมีแถวหัวตารางและข้อมูลอย่างน้อย 1 แถว'); return; }
      const headers = lines[0].split('\t').map(h => h.trim());
      const parsed = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        if (cols.every(c => !String(c || '').trim())) { blankSkipped++; continue; }
        const obj = {};
        headers.forEach((h, j) => { obj[h] = cols[j] != null ? cols[j].trim() : ''; });
        if (!obj.due2) { for (const k of _DUE_ALT_KEYS) { if (obj[k]) { obj.due2 = obj[k]; break; } } }
        parsed.push(obj);
      }
      detail = parsed.filter(o => { const keep = _isPayableDetailRow(o); if (!keep) summarySkipped++; return keep; });
    }

    // (2) เซ็ตของที่จ่ายแล้ว (ดึงไป PV) — vchno ที่ตรงกับ AP_No ใน pvVouchers
    const paidSet = new Set((data.pvVouchers || []).map(pv => String(pv.AP_No || '').trim()).filter(Boolean));

    // index payable เดิมด้วย vchno
    const existing = data.payables || [];
    const existingByVchno = new Map();
    existing.forEach(r => { const v = String(r.vchno || '').trim(); if (v && !existingByVchno.has(v)) existingByVchno.set(v, r); });

    const importedVchno = new Set();
    const added = [], changed = [], unchanged = [];
    let paidImportSkipped = 0;

    detail.forEach(obj => {
      const v = String(obj.vchno || '').trim();
      if (paidSet.has(v)) { paidImportSkipped++; return; }   // จ่ายแล้ว → ไม่นำเข้า
      importedVchno.add(v);
      const ex = existingByVchno.get(v);
      if (!ex) { added.push({ row: obj, key: v, primary: v }); return; }
      const diff = {};
      _PAYABLE_DIFF_FIELDS.forEach(f => {
        const oldRaw = ex[f.key];
        // กัน false-positive: ถ้าของเดิมไม่มีค่า field นี้ (schema ต่าง) ไม่ถือว่า "เปลี่ยน"
        if (oldRaw === undefined || oldRaw === null || String(oldRaw).trim() === '') return;
        if (_payableNormCmp(oldRaw, f.type) !== _payableNormCmp(obj[f.key], f.type)) {
          diff[f.key] = { old: oldRaw, new: obj[f.key] };
        }
      });
      const item = { row: obj, existing: ex, key: v, primary: v };
      if (Object.keys(diff).length === 0) unchanged.push(item);
      else changed.push({ ...item, diff });
    });

    // (3) ของเดิมที่ไม่อยู่ในไฟล์ใหม่ → จ่ายแล้ว (ตัดออกอัตโนมัติ) หรือ หาย (ให้เลือกลบ)
    const paidCut = [], missing = [];
    existing.forEach(r => {
      const v = String(r.vchno || '').trim();
      if (!v || importedVchno.has(v)) return;
      if (paidSet.has(v)) paidCut.push({ row: r, key: v, primary: v });
      else missing.push({ row: r, key: v, primary: v });
    });

    setSelectedMissing(new Set());
    setImportPreview({
      added, changed, unchanged, missing,
      blankSkipped, noKeyCount: 0,
      fieldByKey: _PAYABLE_FIELD_BY_KEY,
      dedupKeys: ['vchno'], primaryKey: 'vchno', dateRange: null,
      summarySkipped, paidImportSkipped, paidCut,
    });
  };

  // ยืนยัน → upsert changed + add new + ตัด paidCut เสมอ + (option) ลบ missing
  const commitImport = () => {
    const p = importPreview;
    if (!p) return;
    setData(d => {
      let next = [...(d.payables || [])];
      // update changed (merge ฟิลด์จากไฟล์เข้า row เดิม คง id)
      const changedById = new Map();
      p.changed.forEach(({ existing, row }) => { if (existing?.id) changedById.set(existing.id, row); });
      if (changedById.size) next = next.map(r => changedById.has(r.id) ? { ...r, ...changedById.get(r.id) } : r);
      // add new
      const newRows = p.added.map(({ row }) => _normPayableRow({ ...row, id: WTPData.newId() }));
      if (newRows.length) next = [...newRows, ...next];
      // delete: paidCut เสมอ + missing เฉพาะที่ผู้ใช้เลือก
      const removeIds = new Set();
      p.paidCut.forEach(m => { if (m.row?.id) removeIds.add(m.row.id); });
      selectedMissing.forEach(id => removeIds.add(id));
      if (removeIds.size) next = next.filter(r => !removeIds.has(r.id));
      return { ...d, payables: next };
    });
    const parts = [`เพิ่ม ${p.added.length}`, `แก้ ${p.changed.length}`];
    if (p.paidCut.length) parts.push(`ตัดจ่ายแล้ว ${p.paidCut.length}`);
    if (selectedMissing.size) parts.push(`ลบที่หาย ${selectedMissing.size}`);
    toast(`นำเข้าสำเร็จ · ${parts.join(' · ')}`);
    resetImport();
  };

  const COLS = [
    { key: 'vchdate',    label: 'วันที่',            w: 90                           },
    { key: 'vchno',      label: 'เลขที่ใบสำคัญ',    w: 140                          },
    { key: 'cust_name',  label: 'เจ้าหนี้ / Vendor', w: 260                         },
    { key: 'dpt_code',   label: 'แผนก',              w: 76,  align: 'center'        },
    { key: 'cf_category',label: 'หมวด CF',           w: 110, noSort: true, align: 'center' },
    { key: 'due2',       label: 'วันครบกำหนด',       w: 105                         },
    { key: '_overdue',   label: 'เกินกำหนด',         w: 88,  noSort: true, align: 'center' },
    { key: 'netpayment', label: 'Net Payment (฿)',   w: 148, align: 'right'         },
    { key: 'remark',     label: 'หมายเหตุ',           w: 280                         },
  ];

  return (
    <div className="page">
      {/* Page header */}
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">DATA AP Outstanding · ใบแจ้งหนี้เจ้าหนี้คงค้าง</h1>
          <div className="page-sub">RAW_AP_OUTSTANDING · 54 คอลัมน์ · วางข้อมูล RAW ได้เลย</div>
        </div>
        <div className="page-head-r">
          <ExportButton
            rows={filtered}
            columns={COLS.filter(c => !c.noSort).map(c => ({
              key: c.key, label: c.label,
              type: c.align === 'right' ? 'number' : (c.key === 'vchdate' || c.key === 'due2' ? 'date' : undefined),
            }))}
            filename="AP_outstanding"
            sheetName="AP Outstanding"
            title="DATA AP Outstanding · ใบแจ้งหนี้เจ้าหนี้คงค้าง"
          />
          <PrintButton />
          <button className="btn btn-ghost"
            onClick={() => {
              if (window.WTPData && typeof window.WTPData.refreshFromServer === 'function') {
                window.WTPData.refreshFromServer();
                toast('กำลังดึงข้อมูลใหม่จาก Sheet…');
              } else {
                toast('Sync ไม่พร้อมใช้งาน (offline mode)');
              }
            }}
            title="ดึงข้อมูลใหม่จาก Google Sheet">
            <Icon name="refresh" size={14} /> รีเฟรชจาก Sheet
          </button>
          <button className="btn btn-ghost" onClick={() => setShowImport(true)}>
            <Icon name="upload" size={14} /> นำเข้า Excel
          </button>
        </div>
      </div>

      {/* ⚠️ Banner — รายการที่จ่ายแล้ว (มี PV) ยังปนอยู่ในรายการคงค้าง → ล้างออกได้ทันที */}
      {paidRows.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          margin: '0 0 14px', padding: '11px 16px', borderRadius: 10,
          background: 'color-mix(in oklch, var(--bad) 9%, var(--surface))',
          border: '1px solid color-mix(in oklch, var(--bad) 36%, transparent)',
          borderLeft: '4px solid var(--bad)',
        }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
          <div style={{ flex: 1, minWidth: 220, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-800)' }}>
            <strong>พบ {paidRows.length} รายการที่จ่ายแล้ว</strong> (vchno ตรงกับ AP_No ในหน้า PV) ปนอยู่ในรายการคงค้าง —
            จ่ายผ่าน PV ไปแล้วจึงไม่ใช่เจ้าหนี้คงค้าง ควรล้างออกจากชีต
          </div>
          <button className="btn btn-primary" onClick={cleanPaidNow}
            style={{ background: 'var(--bad)', borderColor: 'var(--bad)', flex: '0 0 auto' }}>
            <Icon name="trash" size={14} /> ล้างออกจากชีต ({paidRows.length})
          </button>
        </div>
      )}

      {/* KPI — 4 cards (grid-4, same size as all other data pages, no delta to keep height equal) */}
      <div className="grid grid-4 anim-stagger" style={{ marginBottom: 16 }}>
        <KpiTile label="จำนวนรายการ" value={filtered.length} unit=" รายการ" digits={0} accent="var(--brand-500)" icon="invoice" animate={false} />
        <KpiTile label="Net Payment รวม" value={fNet} accent="var(--bad)" icon="coin" animate={false} />
        <KpiTile label="เกินกำหนด (Net Payment)" value={overdueNet} accent="oklch(60% 0.18 30)" icon="arrow_up" animate={false} />
        <KpiTile label={`แผนกสูงสุด: ${topDpt[0]}`} value={topDpt[1]} accent="oklch(70% 0.16 75)" icon="money" animate={false} />
      </div>

      {/* Filter bar — tabs left, dropdown + search right (inline) */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="tabnav" style={{ flex: '0 0 auto' }}>
          <button className={docFilter === 'all' ? 'active' : ''} onClick={() => setDocFilter('all')}>ทั้งหมด ({rows.length})</button>
          {['APO','APS','APV','AP','RS','AD','CV'].filter(t => dtCount[t] > 0).map(t => (
            <button key={t} className={docFilter === t ? 'active' : ''} onClick={() => setDocFilter(t)}>{t} ({dtCount[t]})</button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Dept dropdown */}
          <select value={dptFilter} onChange={e => setDptFilter(e.target.value)}
            style={{ height: 34, fontSize: 13, padding: '0 10px', border: '1px solid var(--ink-150)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink-800)', minWidth: 158, cursor: 'pointer' }}>
            <option value="all">แผนก: ทั้งหมด</option>
            {dptCodes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Search — solid surface bg so text doesn't bleed through */}
          <div style={{ position: 'relative', width: 268 }}>
            <div className="tb-search" style={{ background: 'var(--surface)', border: '1px solid var(--ink-150)', borderRadius: 8, boxShadow: 'none' }}>
              <Icon name="search" size={14} />
              <input value={query}
                onChange={e => { setQuery(e.target.value); setShowSug(true); }}
                onFocus={() => setShowSug(true)}
                onBlur={() => setTimeout(() => setShowSug(false), 180)}
                placeholder="ค้นหา cust_name / vchno…"
                style={{ background: 'transparent' }}
              />
              {query && <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'var(--ink-400)' }} onClick={() => setQuery('')}>✕</button>}
            </div>
            {showSug && suggestions.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#ffffff', border: '1px solid var(--ink-150)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', marginTop: 4, maxHeight: 230, overflowY: 'auto' }}>
                {suggestions.map((s, i) => (
                  <div key={i} style={{ padding: '8px 13px', cursor: 'pointer', fontSize: 13, borderBottom: i < suggestions.length-1 ? '1px solid var(--ink-50)' : 'none' }}
                    onMouseDown={() => { setQuery(s); setShowSug(false); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--brand-50)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>{s}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'min(480px, calc(100vh - 400px))' }}>
          <table className="tbl" style={{ minWidth: 1300 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' }}>
              <tr>
                {COLS.map(c => c.noSort
                  ? <th key={c.key} style={{ width: c.w, minWidth: c.w, whiteSpace: 'nowrap', textAlign: c.align || 'center' }}>{c.label}</th>
                  : <SortHeader key={c.key} label={c.label} sortKey={c.key} sort={apSort} toggle={toggleSort} align={c.align || 'left'} width={c.w} />
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center' }} className="muted">ไม่พบข้อมูล</td></tr>
              )}
              {filtered.map(row => {
                const due = parseDue(row.due2);
                const days = due ? Math.ceil((due - new Date()) / 86400000) : null;
                const dueColor = days === null ? 'var(--ink-400)' : days < 0 ? 'var(--bad)' : days < 7 ? 'oklch(60% 0.16 75)' : days < 30 ? 'oklch(70% 0.16 60)' : 'var(--ink-400)';
                const netPay = parseNum(row.netpayment);
                const vt = { verticalAlign: 'top', paddingTop: 10, paddingBottom: 10 };
                return (
                  <tr key={row.id} onClick={() => setEdit(row)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...vt, whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(row.vchdate) || row.vchdate || '—'}</td>
                    <td style={vt}><span style={{ fontWeight: 600, color: 'var(--brand-700)', fontFamily: 'ui-monospace' }}>{row.vchno || '—'}</span></td>
                    <td style={vt}>{row.cust_name || <span className="muted">—</span>}</td>
                    <td style={vt}>{row.dpt_code ? <Badge kind="b-blue" dot={false}>{row.dpt_code}</Badge> : <span className="muted">—</span>}</td>
                    <td style={{ ...vt, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <select
                        value={row.cf_category || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setData(d => ({
                            ...d,
                            payables: (d.payables || []).map(p => p.id === row.id ? { ...p, cf_category: val } : p),
                          }));
                          toast && toast('อัปเดตหมวด CF แล้ว');
                        }}
                        title="เลือกหมวดสำหรับ Cashflow page (1=ดำเนินงาน 2=โครงการ 3=การเงิน 4=เบ็ดเตล็ด/เงินเดือน)"
                        style={{
                          fontSize: 11, padding: '2px 6px', borderRadius: 5,
                          border: '1px solid var(--line)', background: 'var(--panel)',
                          fontFamily: 'inherit', cursor: 'pointer',
                          color: row.cf_category ? 'var(--ink-800)' : 'var(--ink-400)',
                        }}>
                        <option value="">Auto</option>
                        <option value="1">1 · ดำเนินงาน</option>
                        <option value="2">2 · โครงการ</option>
                        <option value="3">3 · การเงิน</option>
                        <option value="4">4 · เบ็ดเตล็ด+เงินเดือน</option>
                      </select>
                    </td>
                    <td style={{ ...vt, whiteSpace: 'nowrap', color: dueColor }}>
                      {due
                        ? `${String(due.getDate()).padStart(2,'0')}/${String(due.getMonth()+1).padStart(2,'0')}/${due.getFullYear()}`
                        : (row.due2 || <span className="muted">—</span>)}
                    </td>
                    <td style={{ ...vt, textAlign: 'center' }}>
                      {days === null ? <span className="muted">—</span>
                        : days < 0 ? <span style={{ background: 'var(--bad)', color: '#fff', borderRadius: 5, padding: '2px 6px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{Math.abs(days)} วัน</span>
                        : days === 0 ? <span style={{ color: 'var(--bad)', fontWeight: 700, fontSize: 11 }}>วันนี้!</span>
                        : <span style={{ color: dueColor, fontSize: 11 }}>อีก {days}d</span>}
                    </td>
                    <td style={{ ...vt, textAlign: 'right', fontWeight: 700, color: 'var(--bad)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(netPay, 2)}</td>
                    <td style={{ ...vt, color: 'var(--ink-600)' }}><span title={row.remark||''}>{row.remark || <span className="muted">—</span>}</span></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--brand-50)', fontWeight: 700 }}>
                <td colSpan={7} style={{ padding: '8px 14px', fontSize: 12, color: 'var(--brand-700)' }}>รวม {filtered.length} รายการ</td>
                <td className="num" style={{ padding: '8px 14px', textAlign: 'right', color: 'var(--bad)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(fNet, 2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Import modal */}
      {showImport && (
        <Modal open={showImport} maxWidth={680}
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>นำเข้า Excel · AP Outstanding</span>
              <button type="button" onClick={() => setImportHelpOpen(o => !o)}
                title={importHelpOpen ? 'ซ่อนคำอธิบาย' : 'ดูคำอธิบาย / กฎการนำเข้า'}
                aria-label="help"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: '50%',
                  background: importHelpOpen ? '#f6ad55' : '#fefce8',
                  color: importHelpOpen ? '#fff' : '#b45309',
                  border: '1.5px solid #f6ad55', cursor: 'pointer', padding: 0,
                  fontSize: 13, fontWeight: 700, lineHeight: 1,
                  transition: 'background .12s',
                }}>ⓘ</button>
            </span>
          }
          onClose={resetImport}
          footer={importPreview ? <>
            <button className="btn btn-ghost" onClick={() => setImportPreview(null)}>← ย้อนกลับ</button>
            <button className="btn btn-primary" onClick={commitImport}>
              <Icon name="check" size={13} /> ยืนยันนำเข้า
              ({importPreview.added.length}+{importPreview.changed.length}{(importPreview.paidCut.length + selectedMissing.size) ? `-${importPreview.paidCut.length + selectedMissing.size}` : ''})
            </button>
          </> : <>
            <button className="btn btn-ghost" onClick={resetImport}>ยกเลิก</button>
            <button className="btn btn-primary" onClick={handleImport} disabled={!importText.trim() && !xmlParsedRows}><Icon name="check" size={13} /> ตรวจสอบข้อมูล</button>
          </>}>

          {importHelpOpen && (
            <div style={{
              fontSize: 12, marginBottom: 12, padding: '10px 12px',
              background: '#fefce8', border: '1px solid #fde68a', borderLeft: '3px solid #f6ad55',
              borderRadius: 7, color: 'var(--ink-700)', lineHeight: 1.65,
            }}>
              <div>📊 <strong>ไฟล์ .xml จากโปรแกรม EXPRESS</strong> — รายงาน "เจ้าหนี้คงค้างแบบละเอียด" รองรับทุก prefix (RS/AP/AD/CV)</div>
              <div>📥 หรือ <strong>อัปโหลด .xlsx/.csv</strong> / <strong>วาง TSV</strong>. แถวแรกต้องเป็นชื่อคอลัมน์ (header)</div>
              <div>🧹 <strong>แถวสรุปยอด/หัวหมวด</strong> ถูกตัดออกอัตโนมัติ — นำเข้าเฉพาะรายการจริง</div>
              <div>🔁 รายการที่ <strong>vchno ซ้ำ</strong> แต่ค่าเปลี่ยน (ยอด/วันครบกำหนด) จะ <strong>แจ้งเตือนให้ตรวจทาน</strong> ก่อนอัปเดต</div>
              <div>✅ รายการที่ <strong>ดึงไป PV แล้ว</strong> (vchno = AP_No ใน PV) จะไม่นำเข้า และตัดของเดิมในลิสต์ออกให้</div>
            </div>
          )}

          {importPreview ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {(importPreview.paidCut.length > 0 || importPreview.paidImportSkipped > 0) && (
                <div style={{
                  padding: '10px 13px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.6,
                  background: 'color-mix(in oklch, var(--bad) 9%, transparent)',
                  border: '1px solid color-mix(in oklch, var(--bad) 32%, transparent)',
                  borderLeft: '4px solid var(--bad)',
                  display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', color: 'var(--ink-800)',
                }}>
                  <span style={{ fontWeight: 700, color: 'var(--bad)' }}>💸 จ่ายแล้ว (มี PV):</span>
                  {importPreview.paidCut.length > 0    && <span>ตัดออกจากรายการคงค้าง <strong>{importPreview.paidCut.length}</strong> รายการ</span>}
                  {importPreview.paidImportSkipped > 0 && <span>ข้ามในไฟล์นำเข้า <strong>{importPreview.paidImportSkipped}</strong> รายการ</span>}
                </div>
              )}
              {importPreview.summarySkipped > 0 && (
                <div style={{
                  padding: '9px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
                  background: 'color-mix(in oklch, var(--good) 8%, transparent)',
                  border: '1px solid color-mix(in oklch, var(--good) 26%, transparent)',
                  display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--ink-700)',
                }}>
                  <span style={{ fontWeight: 700, color: 'var(--good)' }}>🧹 จัดการอัตโนมัติ:</span>
                  <span>ตัดแถวสรุปยอด <strong>{importPreview.summarySkipped}</strong> แถว</span>
                </div>
              )}
              <PayableImportPreview
                preview={importPreview}
                selectedMissing={selectedMissing}
                setSelectedMissing={setSelectedMissing}
              />
            </div>
          ) : (<>

          {/* Big drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!importDragOver) setImportDragOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setImportDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setImportDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              setImportDragOver(false);
              const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
              if (f) handleFileUpload(f);
            }}
            style={{
              border: importDragOver ? '2.5px dashed var(--brand-500)' : '2px dashed var(--brand-300, #90b4f2)',
              borderRadius: 12, padding: '28px 20px',
              minHeight: 120, marginBottom: 12, transition: 'all .12s ease',
              background: importDragOver
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
                เลือกไฟล์
                <input
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt,.xml"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  style={{ display: 'none' }}
                />
              </label>
              <span style={{ fontSize: 11.5, color: importDragOver ? 'var(--brand-700)' : 'var(--ink-500)', fontWeight: importDragOver ? 600 : 400 }}>
                {importDragOver ? '⬇️ วางไฟล์ที่นี่' : 'หรือลากไฟล์มาวาง — .xml (EXPRESS), .xlsx, .csv'}
              </span>
              {(importFileName) && (
                <button type="button" onClick={() => { setImportFileName(''); setImportText(''); setXmlParsedRows(null); }}
                  style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--ink-200)', borderRadius: 6, padding: '3px 9px', fontSize: 11, color: 'var(--ink-600)', cursor: 'pointer' }}>
                  ✕ ล้างไฟล์
                </button>
              )}
            </div>
            {importFileName && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>{xmlParsedRows ? '📊' : '📄'}</span>
                <strong>{importFileName}</strong>
                {xmlParsedRows && <span style={{ fontSize: 11, color: 'var(--good)' }}>✓ XML EXPRESS · {xmlParsedRows.length} รายการ</span>}
              </div>
            )}
          </div>

          {/* Paste — collapsed behind button */}
          {!importPasteOpen ? (
            <button type="button" onClick={() => setImportPasteOpen(true)}
              style={{
                width: '100%', padding: '8px 14px', marginBottom: 8,
                background: 'var(--ink-50, #f7f8fa)', border: '1px dashed var(--ink-200, #cbd5e0)',
                borderRadius: 7, color: 'var(--ink-600)', cursor: 'pointer',
                fontSize: 12, fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              <span>📋</span>
              <span>หรือกดที่นี่เพื่อวางข้อมูลโดยตรง (TSV จาก Excel)</span>
            </button>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>วางข้อมูล TSV จาก Excel ที่นี่ (แถวแรก = หัวตาราง)</span>
                <button type="button" onClick={() => { setImportPasteOpen(false); if (!importFileName) setImportText(''); }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-400)', fontSize: 11, padding: '0 4px' }}>
                  ✕ ซ่อน
                </button>
              </div>
              <textarea
                className="input"
                rows={14}
                autoFocus
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={"วางข้อมูล TSV จาก Excel ที่นี่…\n(เลือกทั้งหมดใน Excel → Ctrl+C → วางที่นี่)"}
                style={{ fontFamily: 'ui-monospace', fontSize: 11.5, width: '100%', resize: 'vertical' }}
              />
            </>
          )}
          </>)}
        </Modal>
      )}

      {/* Edit / view modal */}
      <APEditModal row={edit} onClose={() => setEdit(null)} onSave={save} onDelete={remove} />
    </div>
  );
}

Object.assign(window, { ForecastEntriesPage, DataBankPage, DataPVPage, DataPayablePage });
