// BIOAXEL — Budget Control Center · separate add-on page.
// Reads the "BUDGET HO" sheet tab (via WTPData.fetchSheetRows) and computes the
// budget-vs-actual dashboard entirely in-browser. The monthly update flow parses
// the "Export HeadOfficeExpense" .xlsx with SheetJS and posts a NEW additive Apps
// Script action ('budgetImportMonth') — it never touches existing endpoints.
//
// Globals reused from the app shell: React, Icon, WTPData, WTP_CONFIG, WTPAuth, XLSX.
//
// Everything below lives inside one IIFE so none of the generic helper/component
// names (KpiCard, Badge, Row, Legend, …) leak into the shared Babel global scope
// and collide with the rest of the app. Only window.BudgetControlPage is exported.
//
// ── Canonical "BUDGET HO" schema this page expects (1 row per GL account) ──
//   dept     : รหัสแผนก (Dept. Code)
//   deptName : ชื่อแผนก/โครงการ
//   acct     : รหัสบัญชี (Acct. Code)
//   desc     : คำอธิบายบัญชี
//   b1..b12  : งบประมาณรายเดือน (Budget)
//   a1..a12  : ใช้จริงรายเดือน (Actual)
//   (optional) updatedAt
// ถ้าอ่านชีตไม่ได้/ว่าง → แสดงข้อมูลตัวอย่าง (badge "ตัวอย่าง") เพื่อให้เห็น UI

(function () {
  const { useState, useEffect, useMemo, useRef } = React;

  const BCC_SHEET = 'budgetHo';   // ตาราง Supabase (ย้ายจาก Google Sheet "BUDGET HO")

  // palette — ตรงกับดีไซน์ Budget Control Center
  const P = {
    primary: '#2F5FD0', secondary: '#4E89FF', success: '#35B37E', warning: '#F5A623',
    danger: '#E74C3C', border: '#E8EDF5', ink: '#1B2A4A', mute: '#7C8BA8', bg: '#F5F7FB', grid: '#EEF2F9',
  };

  const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const QUARTERS = { q1: [0,1,2], q2: [3,4,5], q3: [6,7,8], q4: [9,10,11] };

  // ── number formatters (ported from design BudgetFmt) ──
  const Fmt = {
    baht(n) { return '฿' + Math.round(n).toLocaleString('en-US'); },
    bahtPlain(n) { return Math.round(n).toLocaleString('en-US'); },
    compact(n) {
      const a = Math.abs(n);
      if (a >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
      if (a >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
      if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
      return Math.round(n).toString();
    },
    compactBaht(n) { return (n < 0 ? '−฿' : '฿') + Fmt.compact(Math.abs(n)); },
    pct(n) { return (n * 100).toFixed(1) + '%'; },
  };

  // safe "ชื่อ (English)" → "ชื่อ" — tolerant of undefined/null/number values
  function splitName(s) { return String(s == null ? '' : s).split(' (')[0]; }

  // ── department colors ──
  const DEPT_PALETTE = ['#2F5FD0','#1AA6B7','#35B37E','#F5A623','#7C5CE0','#F2704A','#0E9AA7','#6FB23A','#E0598B','#5A6FB0','#E8842B','#B85AC8','#3DA5E0','#9AA83A','#C0392B','#B07A4A','#9B6BD8','#1F8A5B','#4E89FF','#D9534F'];
  const DEPT_COLOR_OVERRIDE = { FIN: '#E85D9A' };
  let deptColorMap = {};
  function deptColor(code) { return deptColorMap[code] || DEPT_COLOR_OVERRIDE[code] || '#2F5FD0'; }
  function hexToRgba(hex, a) { const h = hex.replace('#', ''); const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16); return `rgba(${r},${g},${b},${a})`; }
  function lighten(hex, amt) { const h = hex.replace('#', ''); let r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16); r = Math.round(r + (255-r)*amt); g = Math.round(g + (255-g)*amt); b = Math.round(b + (255-b)*amt); return `rgb(${r},${g},${b})`; }

  // ── category from chart-of-accounts code prefix (ported from design) ──
  function categoryOf(code) {
    const c = String(code);
    if (c.startsWith('6211')) return 'เงินเดือน (Salary)';
    if (c.startsWith('6212') || c.startsWith('6201')) return 'สวัสดิการพนักงาน (Benefits)';
    if (c.startsWith('622')) return 'ค่าเดินทาง (Travel)';
    if (c.startsWith('624')) return 'สาธารณูปโภค (Utilities)';
    if (c.startsWith('6251') || c.startsWith('6252') || c.startsWith('6253')) return 'ค่าเช่า (Rental)';
    if (c.startsWith('626')) return 'ซ่อมบำรุง (Maintenance)';
    if (c.startsWith('627')) return 'ค่าเสื่อมราคา (Depreciation)';
    if (c.startsWith('53')) return 'การตลาด (Marketing)';
    if (c.startsWith('51')) return 'ต้นทุนงาน (Cost of Work)';
    if (c.startsWith('52')) return 'คอมมิชชั่น (Commission)';
    if (c.startsWith('71') || c.startsWith('79') || c.startsWith('72')) return 'ค่าใช้จ่ายการเงิน (Financial)';
    if (c.startsWith('6')) return 'ค่าใช้จ่ายดำเนินงาน (Operations)';
    return 'อื่นๆ (Other)';
  }

  // ── derive annual totals on accounts + depts + meta, assign colors ──
  function initBudget(raw) {
    let tb = 0, ta = 0;
    for (const d of raw.departments) {
      let db = 0, da = 0;
      for (const a of d.accounts) {
        a.budget = Math.round(a.mb.reduce((s, x) => s + x, 0));
        a.actual = Math.round(a.ma.reduce((s, x) => s + x, 0));
        a.balance = a.budget - a.actual;
        db += a.budget; da += a.actual;
      }
      d.budget = Math.round(db); d.actual = Math.round(da);
      tb += d.budget; ta += d.actual;
    }
    // เก็บแผนกที่มี "งบประมาณ" หรือ "ค่าใช้จ่ายจริง" — กันแผนกที่งบ=0 แต่มีรายจ่ายจริงหายไป
    // (เช่น RSD, SSD, AC ที่ไม่ได้ตั้งงบไว้แต่มีค่าใช้จ่ายเกิดขึ้น)
    raw.departments = raw.departments
      .filter(d => d.budget > 1000 || Math.abs(d.actual) > 0)
      .sort((a, b) => (b.budget || b.actual) - (a.budget || a.actual));
    deptColorMap = {};
    let pi = 0;
    for (const d of raw.departments) {
      let c = DEPT_COLOR_OVERRIDE[d.code];
      if (!c) { c = DEPT_PALETTE[pi % DEPT_PALETTE.length]; pi++; }
      d.color = c; deptColorMap[d.code] = c;
    }
    raw.meta.totalBudget = Math.round(tb);
    raw.meta.totalActual = Math.round(ta);
    raw.meta.deptCount = raw.departments.length;
    return raw;
  }

  function monthsInScope(month) {
    if (!month || month === 'all') return [0,1,2,3,4,5,6,7,8,9,10,11];
    if (QUARTERS[month]) return QUARTERS[month].slice();
    // multi-month: comma-separated indices e.g. '0,2,4'
    if (typeof month === 'string' && month.indexOf(',') >= 0) {
      const arr = month.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n >= 0 && n <= 11);
      return arr.length > 0 ? arr : [0,1,2,3,4,5,6,7,8,9,10,11];
    }
    const i = parseInt(month); return isNaN(i) ? [0,1,2,3,4,5,6,7,8,9,10,11] : [i];
  }

  // computeView(base, filters) -> derived, filter-scoped view used by the whole dashboard.
  function computeView(base, filters) {
    filters = filters || {};
    const scopeM = monthsInScope(filters.month);
    const baseActualMonths = base.meta.actualMonths;
    const sum = (arr, idxs) => idxs.reduce((s, i) => s + arr[i], 0);

    let depts = base.departments;
    if (filters.dept && filters.dept !== 'all') depts = depts.filter(d => d.code === filters.dept);

    const sdepts = depts.map(d => {
      let accts = d.accounts;
      if (filters.cat && filters.cat !== 'all') accts = accts.filter(a => a.cat === filters.cat);
      const mb = Array(12).fill(0), ma = Array(12).fill(0);
      for (const a of accts) { for (let i = 0; i < 12; i++) { mb[i] += a.mb[i]; ma[i] += a.ma[i]; } }
      const pBudget = sum(mb, scopeM), pActual = sum(ma, scopeM);
      const annualBudget = mb.reduce((s, x) => s + x, 0), annualActual = ma.reduce((s, x) => s + x, 0);
      const sAccts = accts.map(a => {
        const ab = sum(a.mb, scopeM), aa = sum(a.ma, scopeM);
        const annB = a.mb.reduce((s, x) => s + x, 0), annA = a.ma.reduce((s, x) => s + x, 0);
        return { code: a.code, desc: a.desc, cat: a.cat, mb: a.mb, ma: a.ma,
          budget: Math.round(ab), actual: Math.round(aa), balance: Math.round(ab - aa),
          annualBudget: Math.round(annB), annualActual: Math.round(annA) };
      });
      return { code: d.code, name: d.name, color: d.color || deptColor(d.code),
        budget: Math.round(pBudget), actual: Math.round(pActual),
        annualBudget: Math.round(annualBudget), annualActual: Math.round(annualActual),
        months: mb.map((b, i) => ({ b: Math.round(b), a: Math.round(ma[i]) })),
        accounts: sAccts };
    });

    const monthly = Array.from({ length: 12 }, () => ({ b: 0, a: 0 }));
    for (const d of sdepts) d.months.forEach((m, i) => { monthly[i].b += m.b; monthly[i].a += m.a; });

    const totalBudget = Math.round(sdepts.reduce((s, d) => s + d.budget, 0));
    const totalActual = Math.round(sdepts.reduce((s, d) => s + d.actual, 0));
    const annualTotalBudget = Math.round(sdepts.reduce((s, d) => s + d.annualBudget, 0));
    const annualTotalActual = Math.round(sdepts.reduce((s, d) => s + d.annualActual, 0));
    const actualMonthsInScope = scopeM.filter(i => i < baseActualMonths).length;

    const cats = {};
    for (const d of sdepts) for (const a of d.accounts) {
      if (!cats[a.cat]) cats[a.cat] = { name: a.cat, budget: 0, actual: 0 };
      cats[a.cat].budget += a.annualBudget; cats[a.cat].actual += a.annualActual;
    }
    const categories = Object.values(cats).filter(c => c.budget > 0)
      .map(c => ({ name: c.name, budget: Math.round(c.budget), actual: Math.round(c.actual) }))
      .sort((a, b) => b.budget - a.budget);

    const over = [];
    for (const d of sdepts) for (const a of d.accounts) {
      if (a.actual > a.budget && a.actual > 0)
        over.push({ dept: d.code, deptName: d.name, acct: a.code, desc: a.desc, budget: a.budget, actual: a.actual, over: a.actual - a.budget });
    }
    over.sort((x, y) => y.over - x.over);

    return {
      meta: { totalBudget, totalActual, annualTotalBudget, annualTotalActual,
        actualMonths: baseActualMonths, actualMonthsInScope, periodMonths: scopeM, deptCount: sdepts.length },
      monthly: monthly.map(m => ({ b: Math.round(m.b), a: Math.round(m.a) })),
      highlightMonths: (filters.month && filters.month !== 'all') ? scopeM : null,
      departments: sdepts, categories, overBudget: over.slice(0, 12),
    };
  }

  // ── parse 'BUDGET HO' sheet rows (objects keyed by header) → base ──
  function parseSheetRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const keys = Object.keys(rows[0] || {});
    if (keys.indexOf('dept') < 0 || keys.indexOf('acct') < 0) return null;
    const num = (v) => { if (v == null || v === '') return 0; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
    const deptMap = {};
    let used = 0;
    rows.forEach(r => {
      const dept = String(r.dept || '').trim();
      const acct = String(r.acct || '').trim();
      if (!dept || !acct) return;
      if (!deptMap[dept]) deptMap[dept] = { code: dept, name: String(r.deptName || dept).trim(), accounts: [] };
      const mb = [], ma = [];
      for (let m = 1; m <= 12; m++) { mb.push(Math.round(num(r['b' + m]))); ma.push(Math.round(num(r['a' + m]))); }
      deptMap[dept].accounts.push({ code: acct, desc: String(r.desc || '').trim(), cat: String(r.cat || '').trim() || categoryOf(acct), mb, ma });
      used++;
    });
    if (!used) return null;
    return initBudget({ meta: { actualMonths: detectActualMonths(deptMap) }, departments: Object.values(deptMap) });
  }

  function detectActualMonths(deptMap) {
    let actualMonths = 0;
    const monthHas = Array(12).fill(false);
    Object.values(deptMap).forEach(d => d.accounts.forEach(a => a.ma.forEach((v, i) => { if (v !== 0) monthHas[i] = true; })));
    for (let i = 0; i < 12; i++) if (monthHas[i]) actualMonths = i + 1;
    return actualMonths;
  }

  // ── parse the uploaded budget .xlsx with SheetJS ──────────────────────
  // returns { base, rows } — base for instant preview, rows for the backend POST.
  // Tries the new categorized "Budget" layout first, then the old Mango export.
  function parseWorkbook(file) {
    return new Promise((resolve, reject) => {
      if (!window.XLSX) { reject(new Error('ไม่พบไลบรารี SheetJS — รีเฟรชหน้า')); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: false });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
          if (!aoa.length) { reject(new Error('ไฟล์ว่าง')); return; }
          const parsed = parseBudgetCategorized(aoa) || parseMangoExport(aoa);
          if (!parsed || !parsed.rows.length) { reject(new Error('no rows parsed')); return; }
          resolve(parsed);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      reader.readAsArrayBuffer(file);
    });
  }

  const _num = (v) => { if (v == null || v === '') return 0; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };

  // ── NEW categorized "Budget" layout (2026-06) ─────────────────────────
  // Single sheet, header row 1:
  //   [ประเภทค่าใช้จ่าย, Dept. Code, Department /Project Name, Acct. Code,
  //    Description, Total Budget, รวมใช้จริง, คงเหลือ, 1, 2, 3, … N]
  // - col A = หมวด (finance hand-assigned) → ใช้ตรง ๆ (fallback categoryOf)
  // - Total Budget = งบ "ทั้งปี" (ไม่มี budget รายเดือน) → กระจายเฉลี่ย /12 ลง mb
  // - คอลัมน์ที่ header เป็นเลข 1..12 = "ค่าใช้จ่ายจริง" รายเดือน (เพิ่มทีละเดือน)
  // - แถวรวม (รวมฝ่าย…/รวมทั้งสิ้น…) ไม่มี Acct. Code → ข้าม
  // header-driven → ทนต่อการสลับ/เพิ่มคอลัมน์เดือน. คืน null ถ้าไม่ใช่ฟอร์แมตนี้.
  function parseBudgetCategorized(aoa) {
    const H = (aoa[0] || []).map(c => String(c == null ? '' : c).trim().toLowerCase());
    const find = (pred) => H.findIndex(pred);
    const acctIdx   = find(h => h.indexOf('acct') >= 0);
    const budgetIdx = find(h => h.indexOf('total budget') >= 0 || (h.indexOf('budget') >= 0 && h.indexOf('ใช้') < 0));
    if (acctIdx < 0 || budgetIdx < 0) return null;                    // ไม่ใช่ฟอร์แมตนี้
    const catIdx  = find(h => h.indexOf('ประเภท') >= 0 || h.indexOf('หมวด') >= 0);
    const deptIdx = find(h => h.indexOf('dept') >= 0);
    const nameIdx = find(h => h.indexOf('project name') >= 0 || h.indexOf('department /') >= 0 || (h.indexOf('department') >= 0 && h.indexOf('name') >= 0));
    const descIdx = find(h => h.indexOf('description') >= 0);
    if (deptIdx < 0) return null;
    // คอลัมน์เดือน = header ที่เป็นเลข 1..12 และอยู่หลังคอลัมน์ summary
    const monthCols = [];
    (aoa[0] || []).forEach((raw, i) => {
      if (i <= budgetIdx) return;
      const n = (typeof raw === 'number') ? raw : parseInt(String(raw).trim(), 10);
      if (!isNaN(n) && n >= 1 && n <= 12) monthCols.push({ idx: i, m: n });
    });
    if (!monthCols.length) return null;

    const deptMap = {};
    const sheetRows = [];
    for (let ri = 1; ri < aoa.length; ri++) {
      const r = aoa[ri] || [];
      const acct = String(r[acctIdx] == null ? '' : r[acctIdx]).trim();
      if (!/^\d{3,}/.test(acct)) continue;                            // ข้ามแถวรวม/แถวว่าง (ไม่มีรหัส GL จริง)
      const dept = String(r[deptIdx] == null ? '' : r[deptIdx]).trim();
      if (!dept) continue;
      const name = String((nameIdx >= 0 ? r[nameIdx] : '') || dept).trim() || dept;
      const desc = String((descIdx >= 0 ? r[descIdx] : '') || '').trim();
      const cat  = String((catIdx >= 0 ? r[catIdx] : '') || '').trim() || categoryOf(acct);
      const annualBudget = _num(r[budgetIdx]);
      // budget รายเดือน: กระจายงบทั้งปีเฉลี่ย /12 · actual รายเดือน: จากคอลัมน์เดือน
      const mb = [], ma = Array(12).fill(0);
      for (let m = 0; m < 12; m++) mb.push(annualBudget / 12);
      monthCols.forEach(mc => { ma[mc.m - 1] += _num(r[mc.idx]); });
      if (!deptMap[dept]) deptMap[dept] = { code: dept, name, accounts: [] };
      deptMap[dept].accounts.push({ code: acct, desc, cat, mb, ma });
      const out = { dept, deptName: name, acct, desc, cat };
      for (let m = 0; m < 12; m++) { out['b' + (m + 1)] = Math.round(mb[m]); out['a' + (m + 1)] = Math.round(ma[m]); }
      sheetRows.push(out);
    }
    if (!sheetRows.length) return null;
    const base = initBudget({ meta: { actualMonths: detectActualMonths(deptMap) }, departments: Object.values(deptMap) });
    return { base, rows: sheetRows };
  }

  // ── OLD "Export HeadOfficeExpense" (Mango) layout — fallback ───────────
  // col1=Dept Code, col4=Name, col5=Acct Code, col6=Desc, then 12 month-blocks
  // of 3 cols each (Budget, Actual, Balance) starting col7. cat = code prefix.
  function parseMangoExport(aoa) {
    const dataRows = aoa.slice(1).filter(r => r[1] != null && r[5] != null);
    const deptMap = {};
    const sheetRows = [];
    for (const r of dataRows) {
      const dept = String(r[1]).trim();
      const name = String(r[4] || r[1]).trim();
      const acct = String(r[5]).trim();
      const desc = String(r[6] || '').trim();
      if (!dept || !acct) continue;
      const mb = [], ma = [];
      for (let m = 0; m < 12; m++) { const base = 7 + m * 3; mb.push(Math.round(_num(r[base]))); ma.push(Math.round(_num(r[base + 1]))); }
      const cat = categoryOf(acct);
      if (!deptMap[dept]) deptMap[dept] = { code: dept, name, accounts: [] };
      deptMap[dept].accounts.push({ code: acct, desc, cat, mb, ma });
      const row = { dept, deptName: name, acct, desc, cat };
      for (let m = 0; m < 12; m++) { row['b' + (m + 1)] = mb[m]; row['a' + (m + 1)] = ma[m]; }
      sheetRows.push(row);
    }
    if (!sheetRows.length) return null;
    const base = initBudget({ meta: { actualMonths: detectActualMonths(deptMap) }, departments: Object.values(deptMap) });
    return { base, rows: sheetRows };
  }

  // ── small sample so the dashboard renders before the first upload ──
  function sampleBase() {
    const z = () => Array(12).fill(0);
    const m = (vals) => { const a = z(); vals.forEach((v, i) => a[i] = v); return a; };
    const depts = [
      { code: 'ACC', name: 'บัญชีและการเงิน (Accounting)', accounts: [
        { code: '6211001', desc: 'เงินเดือนพนักงาน', mb: m([420000,420000,420000,420000]), ma: m([418500,421000,419800,420200]) },
        { code: '6240001', desc: 'ค่าน้ำค่าไฟ', mb: m([35000,35000,35000,35000]), ma: m([33200,38900,41200,36100]) },
      ] },
      { code: 'MKT', name: 'การตลาด (Marketing)', accounts: [
        { code: '5300001', desc: 'ค่าโฆษณาออนไลน์', mb: m([180000,180000,180000,180000]), ma: m([175000,210000,240000,198000]) },
        { code: '6220001', desc: 'ค่าเดินทางออกบูธ', mb: m([60000,60000,60000,60000]), ma: m([58000,72000,55000,61000]) },
      ] },
      { code: 'OPS', name: 'ปฏิบัติการ (Operations)', accounts: [
        { code: '5100001', desc: 'ต้นทุนงานโครงการ', mb: m([1200000,1200000,1200000,1200000]), ma: m([1180000,1250000,1330000,1210000]) },
        { code: '6260001', desc: 'ซ่อมบำรุงเครื่องจักร', mb: m([90000,90000,90000,90000]), ma: m([84000,96000,102000,88000]) },
      ] },
    ];
    depts.forEach(d => d.accounts.forEach(a => { a.cat = categoryOf(a.code); }));
    return initBudget({ meta: { actualMonths: 4 }, departments: depts });
  }

  // ════════════════════════════════════════════════════════════════════════
  // shared layout pieces
  // ════════════════════════════════════════════════════════════════════════
  function SectionCard({ n, title, sub, actions, children, pad = true }) {
    return (
      <section className="bcc-section">
        <header className="bcc-section-hd">
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            {n && <span className="bcc-section-n">{n}</span>}
            <div style={{ lineHeight: 1.3 }}>
              <h2 className="bcc-section-title">{title}</h2>
              {sub && <div className="bcc-section-sub">{sub}</div>}
            </div>
          </div>
          {actions}
        </header>
        <div style={{ padding: pad ? '22px 24px' : 0 }}>{children}</div>
      </section>
    );
  }

  function Legend({ items }) {
    return (
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {items.map((it, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: P.mute, fontWeight: 600, whiteSpace: 'nowrap' }}>
            <span style={{ width: it.line ? 16 : 11, height: it.line ? 0 : 11, borderRadius: it.line ? 0 : 3, background: it.line ? 'none' : it.color, borderTop: it.line ? `2.5px ${it.dash ? 'dashed' : 'solid'} ${it.color}` : 'none' }}></span>
            {it.label}
          </span>
        ))}
      </div>
    );
  }

  // ── MonthMultiSelect — dropdown ที่ติ้กหลายเดือนได้ + quick chips (ทั้งปี/Q1-Q4)
  function MonthMultiSelect({ value, onChange }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
      if (!open) return;
      const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
      document.addEventListener('mousedown', h);
      return () => document.removeEventListener('mousedown', h);
    }, [open]);

    // parse current value → array (null = 'all')
    const selected = useMemo(() => {
      if (!value || value === 'all') return null;
      if (QUARTERS[value]) return QUARTERS[value].slice();
      if (typeof value === 'string' && value.indexOf(',') >= 0) {
        return value.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n >= 0 && n <= 11);
      }
      const i = parseInt(value);
      return isNaN(i) ? null : [i];
    }, [value]);

    const isAll = selected === null || (selected && selected.length === 12);
    const set = new Set(selected || []);

    // Canonicalize and emit
    const emit = (arr) => {
      if (!arr || arr.length === 0) { onChange('all'); return; }
      const sorted = [...new Set(arr)].filter(n => n >= 0 && n <= 11).sort((a, b) => a - b);
      if (sorted.length === 0 || sorted.length === 12) { onChange('all'); return; }
      // Match a quarter?
      for (const q of ['q1', 'q2', 'q3', 'q4']) {
        const ms = QUARTERS[q];
        if (ms.length === sorted.length && ms.every((m, i) => m === sorted[i])) { onChange(q); return; }
      }
      if (sorted.length === 1) { onChange(String(sorted[0])); return; }
      onChange(sorted.join(','));
    };

    const toggleMonth = (i) => {
      if (isAll) { emit([i]); return; } // เริ่ม selection ใหม่จาก "ทั้งปี"
      const next = set.has(i) ? (selected || []).filter(x => x !== i) : [...(selected || []), i];
      emit(next);
    };

    // Display label
    const displayLabel = (() => {
      if (isAll) return 'ทั้งปี (YTD)';
      if (!selected || selected.length === 0) return 'ยังไม่เลือก';
      const sorted = [...selected].sort((a, b) => a - b);
      for (const q of ['q1', 'q2', 'q3', 'q4']) {
        const ms = QUARTERS[q];
        if (ms.length === sorted.length && ms.every((m, i) => m === sorted[i])) {
          return `ไตรมาส ${q.slice(1)} (${MONTHS_TH[ms[0]]}–${MONTHS_TH[ms[ms.length - 1]]})`;
        }
      }
      if (sorted.length === 1) return MONTHS_TH[sorted[0]];
      if (sorted.length <= 3) return sorted.map(i => MONTHS_TH[i]).join(', ');
      return `${sorted.length} เดือน · ${sorted.map(i => MONTHS_TH[i]).slice(0, 2).join(', ')}…`;
    })();

    const chipStyle = (active) => ({
      padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 999,
      border: `1px solid ${active ? P.primary : '#D8DDE6'}`,
      background: active ? P.primary : 'white',
      color: active ? 'white' : P.ink,
      cursor: 'pointer',
    });

    // detect active chip
    const activeChip = isAll ? 'all' : (selected && selected.length > 0 && (() => {
      const sorted = [...selected].sort((a, b) => a - b);
      for (const q of ['q1', 'q2', 'q3', 'q4']) {
        const ms = QUARTERS[q];
        if (ms.length === sorted.length && ms.every((m, i) => m === sorted[i])) return q;
      }
      return null;
    })());

    return (
      <label className="bcc-field" ref={ref} style={{ position: 'relative' }}>
        <span className="bcc-field-lbl">เดือน · Month</span>
        <button type="button" className="bcc-select" onClick={() => setOpen(o => !o)}
          style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
          <span style={{ color: P.mute, fontSize: 11 }}>▾</span>
        </button>
        {open && (
          <div style={{
            position: 'absolute', zIndex: 50, top: '100%', left: 0, marginTop: 4,
            background: 'white', border: `1px solid ${P.border}`, borderRadius: 10,
            boxShadow: '0 8px 24px rgba(15,36,77,.14)', padding: 12, width: 320,
          }}>
            {/* Quick chips */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${P.grid}` }}>
              <button type="button" style={chipStyle(activeChip === 'all')} onClick={() => onChange('all')}>ทั้งปี</button>
              {['q1', 'q2', 'q3', 'q4'].map(q => (
                <button key={q} type="button" style={chipStyle(activeChip === q)} onClick={() => onChange(q)}>
                  Q{q.slice(1)}
                </button>
              ))}
              {!isAll && (
                <button type="button" style={{ ...chipStyle(false), marginLeft: 'auto', color: P.danger, borderColor: '#fecaca' }} onClick={() => onChange('all')}>
                  ล้าง
                </button>
              )}
            </div>
            {/* Month grid — 3 cols × 4 rows */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {MONTHS_TH.map((mm, i) => {
                const checked = !isAll && set.has(i);
                return (
                  <label key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', cursor: 'pointer',
                    borderRadius: 6, background: checked ? 'rgba(47,95,208,.10)' : 'transparent',
                    fontSize: 12.5, fontWeight: checked ? 700 : 500, color: checked ? P.primary : P.ink,
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#F5F7FB'; }}
                  onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleMonth(i)}
                      style={{ accentColor: P.primary, width: 14, height: 14, cursor: 'pointer' }} />
                    <span>{mm}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${P.grid}`, fontSize: 10.5, color: P.mute, lineHeight: 1.4 }}>
              💡 ติ้กหลายเดือนเพื่อเปรียบเทียบ · เลือกครบ Q1-Q4 อัตโนมัติเป็นไตรมาส
            </div>
          </div>
        )}
      </label>
    );
  }

  function FilterBar({ data, filters, setFilters, onUpload, uploading, canEdit }) {
    const fileRef = useRef(null);
    const sel = (label, value, options, key) => (
      <label className="bcc-field">
        <span className="bcc-field-lbl">{label}</span>
        <select value={value} onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))} className="bcc-select">
          {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </label>
    );
    const deptOpts = [{ v: 'all', l: 'ทุกแผนก' }, ...data.departments.map(d => ({ v: d.code, l: d.code + ' · ' + splitName(d.name) }))];
    const allCats = [...new Set(data.departments.flatMap(d => d.accounts.map(a => a.cat)))];
    const catOpts = [{ v: 'all', l: 'ทุกหมวด' }, ...allCats.map(c => ({ v: c, l: splitName(c) }))];
    return (
      <div className="bcc-filterBar">
        {sel('ปี · Year', filters.year, [{ v: '2569', l: '2569 (2026)' }], 'year')}
        <MonthMultiSelect value={filters.month} onChange={(v) => setFilters(f => ({ ...f, month: v }))} />
        {sel('บริษัท · Company', filters.company, [{ v: 'HO', l: 'Head Office' }], 'company')}
        {sel('แผนก · Department', filters.dept, deptOpts, 'dept')}
        {sel('หมวด · Category', filters.cat, catOpts, 'cat')}
        <label className="bcc-field" style={{ flex: 1, minWidth: 150 }}>
          <span className="bcc-field-lbl">ค้นหา · Search</span>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: P.mute, fontSize: 13 }}>🔍</span>
            <input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} placeholder="ชื่อแผนก, รหัส…" className="bcc-search" />
          </div>
        </label>
        {canEdit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 10.5 }}>&nbsp;</span>
            <button onClick={() => fileRef.current.click()} className="bcc-uploadBtn" disabled={uploading}>
              {uploading ? '⏳ กำลังอ่าน…' : '⬆️ อัปเดตข้อมูล'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }}
              onChange={e => { if (e.target.files[0]) onUpload(e.target.files[0]); e.target.value = ''; }} />
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // KPI row
  // ════════════════════════════════════════════════════════════════════════
  function KpiCard({ icon, label, en, value, sub, accent, trend, bar, barMarker }) {
    return (
      <div className="bcc-kpiCard">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: accent.bg, color: accent.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19 }}>{icon}</span>
          {trend && <span style={{ fontSize: 12, fontWeight: 700, color: trend.color, background: trend.bg, padding: '3px 9px', borderRadius: 999 }}>{trend.text}</span>}
        </div>
        <div style={{ fontSize: 12.5, color: P.mute, fontWeight: 600, marginTop: 12 }}>{label}</div>
        <div className="bcc-enCap" style={{ fontSize: 11, color: '#A9B4C8' }}>{en}</div>
        <div style={{ fontSize: 27, fontWeight: 800, color: P.ink, marginTop: 6, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {bar != null && (
          <div style={{ marginTop: 12, height: 7, background: P.grid, borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
            <div style={{ width: `${Math.min(Math.max(bar, 0), 1) * 100}%`, height: '100%', background: accent.fg, borderRadius: 5, transition: 'width .7s cubic-bezier(.22,.61,.36,1)' }}></div>
            {barMarker && <div style={{ position: 'absolute', left: '100%', top: -2, width: 2, height: 11, background: P.danger, transform: 'translateX(-2px)' }}></div>}
          </div>
        )}
        {sub && <div style={{ fontSize: 12, color: P.mute, marginTop: 8 }}>{sub}</div>}
      </div>
    );
  }

  function KpiRow({ data, filtered }) {
    const { totalBudget, totalActual, actualMonths, actualMonthsInScope } = data.meta;
    const remaining = totalBudget - totalActual;
    const pct = totalBudget ? totalActual / totalBudget : 0;
    const over = data.overBudget.reduce((s, o) => s + o.over, 0);
    const overCount = data.departments.filter(d => d.actual > d.budget).length;
    const months = actualMonthsInScope != null ? actualMonthsInScope : actualMonths;
    const budgetLabel = filtered ? 'งบประมาณ (ตามที่กรอง)' : 'งบประมาณรวม';
    return (
      <div className="bcc-kpiGrid">
        <KpiCard icon="💰" label={budgetLabel} en="Budget" value={Fmt.compactBaht(totalBudget)} sub={Fmt.bahtPlain(totalBudget) + ' บาท'}
          accent={{ bg: 'rgba(47,95,208,0.10)', fg: P.primary }} bar={1} />
        <KpiCard icon="📤" label="ใช้จริงสะสม" en="Actual Spending" value={Fmt.compactBaht(totalActual)} sub={`${months} เดือน · ${Fmt.pct(pct)} ของงบ`}
          accent={{ bg: 'rgba(78,137,255,0.12)', fg: P.secondary }} trend={{ text: 'YTD', color: P.secondary, bg: 'rgba(78,137,255,0.10)' }} bar={pct} />
        <KpiCard icon="🏦" label="งบคงเหลือ" en="Remaining Budget" value={Fmt.compactBaht(remaining)} sub={totalBudget ? Fmt.pct(remaining / totalBudget) + ' ของงบ' : '—'}
          accent={{ bg: 'rgba(53,179,126,0.12)', fg: remaining < 0 ? P.danger : P.success }} bar={totalBudget ? remaining / totalBudget : 0} />
        <KpiCard icon="📊" label="% การใช้งบ" en="Utilization" value={Fmt.pct(pct)} sub="ขีดแดง = เต็มงบ 100%"
          accent={{ bg: 'rgba(245,166,35,0.14)', fg: pct >= 1 ? P.danger : '#C8870E' }} bar={pct} barMarker={true} />
        <KpiCard icon="⚠️" label="งบเกิน" en="Over Budget" value={Fmt.compactBaht(over)} sub={`${overCount} แผนกเกินงบ`}
          accent={{ bg: 'rgba(231,76,60,0.12)', fg: P.danger }} trend={overCount ? { text: `${overCount} แผนก`, color: P.danger, bg: 'rgba(231,76,60,0.10)' } : null} bar={totalBudget ? Math.min(over / totalBudget, 1) : 0} />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // status helpers + small widgets
  // ════════════════════════════════════════════════════════════════════════
  function statusOf(util) {
    if (util >= 1) return { label: 'เกินงบ', color: P.danger, bg: 'rgba(231,76,60,0.10)' };
    if (util >= 0.8) return { label: 'ใกล้เต็ม', color: '#C8870E', bg: 'rgba(245,166,35,0.12)' };
    return { label: 'ปกติ', color: P.success, bg: 'rgba(53,179,126,0.10)' };
  }
  function Badge({ util }) {
    const s = statusOf(util);
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999, background: s.bg, color: s.color, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }}></span>{s.label}
      </span>
    );
  }
  function MiniBar({ util }) {
    const pct = Math.min(util, 1.5) / 1.5 * 100;
    const color = util >= 1 ? P.danger : util >= 0.8 ? P.warning : P.success;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 130 }}>
        <div style={{ flex: 1, height: 8, background: P.grid, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6, transition: 'width .5s' }}></div>
          <div style={{ position: 'absolute', left: `${100 / 1.5}%`, top: -2, width: 1, height: 12, background: 'rgba(231,76,60,0.4)' }}></div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color, width: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(util * 100).toFixed(0)}%</span>
      </div>
    );
  }
  function Row({ dot, label, val }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 3 }}>
        <span style={{ width: 8, height: 8, borderRadius: 3, background: dot, flexShrink: 0 }}></span>
        <span style={{ color: P.mute, flex: 1 }}>{label}</span>
        <span style={{ fontWeight: 700, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Trend chart (budget vs actual, actual stacked by dept)
  // ════════════════════════════════════════════════════════════════════════
  function TrendChart({ monthly, departments, actualMonths, highlight }) {
    const [hover, setHover] = useState(null);
    const W = 1040, H = 380, padL = 64, padR = 24, padT = 28, padB = 44;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const max = Math.max(...monthly.map(m => Math.max(m.b, m.a))) * 1.12 || 1;
    const x = (i) => padL + (i + 0.5) * (plotW / 12);
    const y = (v) => padT + plotH - (v / max) * plotH;
    const bw = (plotW / 12) * 0.46;
    const linePts = monthly.map((m, i) => [x(i), y(m.b)]);
    const areaD = `M ${padL},${padT + plotH} ` + linePts.map(p => `L ${p[0]},${p[1]}`).join(' ') + ` L ${padL + plotW},${padT + plotH} Z`;
    const lineD = 'M ' + linePts.map(p => `${p[0]},${p[1]}`).join(' L ');
    const ticks = 4;
    const stacked = departments && departments.length > 0;
    const monthSegs = monthly.map((m, i) => {
      if (!stacked || i >= actualMonths || m.a <= 0) return [];
      return departments
        .map(d => ({ code: d.code, name: splitName(d.name), color: d.color || deptColor(d.code), v: d.months[i] ? d.months[i].a : 0 }))
        .filter(s => s.v > 0).sort((a, b) => b.v - a.v);
    });
    return (
      <div style={{ position: 'relative', width: '100%' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="bccBudgetArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={P.secondary} stopOpacity="0.16" />
              <stop offset="100%" stopColor={P.secondary} stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="bccActualBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={P.primary} />
              <stop offset="100%" stopColor="#3D72E0" />
            </linearGradient>
          </defs>
          {highlight && highlight.length > 0 && (
            <rect x={padL + highlight[0] * (plotW / 12)} y={padT} width={highlight.length * (plotW / 12)} height={plotH} fill={P.primary} opacity="0.06" rx="6" />
          )}
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const gy = padT + (plotH / ticks) * i;
            const val = max * (1 - i / ticks);
            return (
              <g key={i}>
                <line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke={P.grid} strokeWidth="1" />
                <text x={padL - 12} y={gy + 4} textAnchor="end" fontSize="13" fill={P.mute}>{Fmt.compact(val)}</text>
              </g>
            );
          })}
          <path d={areaD} fill="url(#bccBudgetArea)" />
          <path d={lineD} fill="none" stroke={P.secondary} strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" />
          {stacked ? monthly.map((m, i) => {
            const segs = monthSegs[i];
            if (!segs || segs.length === 0) return null;
            let acc = 0;
            return (
              <g key={i} opacity={hover === null || hover === i ? 1 : 0.5}>
                {segs.map((s, j) => {
                  const y0 = y(acc); acc += s.v; const y1 = y(acc);
                  return <rect key={j} x={x(i) - bw / 2} y={y1} width={bw} height={Math.max(y0 - y1, 0)} fill={s.color} stroke="#fff" strokeWidth="0.5" />;
                })}
              </g>
            );
          }) : monthly.map((m, i) => {
            const future = i >= actualMonths;
            if (m.a <= 0 && future) return null;
            const by = y(m.a), bh = padT + plotH - by;
            return <rect key={i} x={x(i) - bw / 2} y={by} width={bw} height={Math.max(bh, 0)} rx="4" fill="url(#bccActualBar)" opacity={hover === null || hover === i ? 1 : 0.55} />;
          })}
          {monthly.map((m, i) => <circle key={i} cx={x(i)} cy={y(m.b)} r="3.5" fill="#fff" stroke={P.secondary} strokeWidth="2" />)}
          {monthly.map((m, i) => (
            <text key={i} x={x(i)} y={H - 16} textAnchor="middle" fontSize="13" fill={i >= actualMonths ? P.mute : P.ink} fontWeight={i >= actualMonths ? 400 : 600}>{MONTHS_TH[i]}</text>
          ))}
          {hover !== null && <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + plotH} stroke={P.primary} strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />}
          {monthly.map((m, i) => (
            <rect key={i} x={padL + i * (plotW / 12)} y={padT} width={plotW / 12} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hover !== null && (() => {
          const m = monthly[hover];
          const v = m.b - m.a;
          const future = hover >= actualMonths;
          const segs = monthSegs[hover] || [];
          const top = segs.slice(0, 5);
          const othersV = segs.slice(5).reduce((s, x2) => s + x2.v, 0);
          const right = (x(hover) / W) > 0.62;
          return (
            <div style={{ position: 'absolute', left: `${(x(hover) / W) * 100}%`, top: 8, transform: right ? 'translateX(-100%)' : 'translateX(0)', marginLeft: right ? -10 : 10,
              background: '#fff', border: `1px solid ${P.border}`, borderRadius: 12, padding: '12px 14px', boxShadow: '0 12px 30px rgba(31,54,99,0.16)', minWidth: 210, pointerEvents: 'none', zIndex: 5 }}>
              <div style={{ fontWeight: 700, color: P.ink, fontSize: 14, marginBottom: 8 }}>{MONTHS_TH[hover]} · {MONTHS_EN[hover]}</div>
              <Row dot={P.secondary} label="งบประมาณ" val={Fmt.baht(m.b)} />
              <Row dot={P.primary} label="ใช้จริงรวม" val={future ? '—' : Fmt.baht(m.a)} />
              {!future && <Row dot={v >= 0 ? P.success : P.danger} label="คงเหลือ" val={Fmt.baht(v)} />}
              {top.length > 0 && (
                <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${P.grid}` }}>
                  <div style={{ fontSize: 11, color: P.mute, fontWeight: 700, marginBottom: 4 }}>แผนกที่ใช้มากสุด</div>
                  {top.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, marginTop: 3 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }}></span>
                      <span style={{ color: P.ink, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{s.name}</span>
                      <span style={{ color: P.mute, fontVariantNumeric: 'tabular-nums' }}>{m.a ? Math.round(s.v / m.a * 100) : 0}%</span>
                      <span style={{ fontWeight: 700, color: P.ink, fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'right' }}>{Fmt.compactBaht(s.v)}</span>
                    </div>
                  ))}
                  {othersV > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, marginTop: 3, color: P.mute }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: '#C7D2E4', flexShrink: 0 }}></span>
                      <span style={{ flex: 1 }}>อื่นๆ ({segs.length - 5} แผนก)</span>
                      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Fmt.compactBaht(othersV)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // CatBars — Budget vs Actual per ประเภทค่าใช้จ่าย (horizontal bars)
  // ════════════════════════════════════════════════════════════════════════
  function CatBars({ categories, onPick }) {
    const data = categories.filter(c => c.budget > 0);
    if (!data.length) return <div style={{ padding: '24px', textAlign: 'center', color: P.mute, fontSize: 13.5 }}>ยังไม่มีหมวดค่าใช้จ่ายในขอบเขตนี้</div>;
    const max = Math.max(...data.map(c => Math.max(c.budget, c.actual)), 1);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 12, color: P.mute, fontWeight: 600, paddingLeft: 4 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 10, background: 'rgba(78,137,255,0.22)', border: `1px solid ${P.secondary}`, borderRadius: 3 }}></span>
            งบประมาณ
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 10, background: P.primary, borderRadius: 3 }}></span>
            ใช้จริง · ปกติ
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 10, background: P.warning, borderRadius: 3 }}></span>
            ใกล้เต็มงบ (≥90%)
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 10, background: P.danger, borderRadius: 3 }}></span>
            เกินงบ
          </span>
        </div>
        {data.map((c, i) => {
          const util = c.budget > 0 ? c.actual / c.budget : 0;
          const over = c.actual > c.budget;
          const utilColor = over ? P.danger : util >= 0.9 ? P.warning : P.primary;
          const bwPct = (c.budget / max) * 100;
          const awPct = (c.actual / max) * 100;
          const diff = c.actual - c.budget;
          return (
            <div key={i} onClick={() => onPick && onPick(c)} className="bcc-deptRow"
              style={{ cursor: 'pointer', display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr 150px', gap: 16, alignItems: 'center', padding: '12px 14px', borderRadius: 12, border: `1px solid ${P.border}`, background: '#fff' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: P.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{splitName(c.name)}</div>
                <div style={{ fontSize: 11.5, color: P.mute, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                  งบ {Fmt.compactBaht(c.budget)} · ใช้ {Fmt.compactBaht(c.actual)}
                </div>
              </div>
              <div style={{ position: 'relative', height: 26 }}>
                <div title={`งบประมาณ ${Fmt.bahtPlain(c.budget)} บาท`}
                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bwPct}%`, background: 'rgba(78,137,255,0.18)', border: `1px solid rgba(78,137,255,0.55)`, borderRadius: 7 }}></div>
                <div title={`ใช้จริง ${Fmt.bahtPlain(c.actual)} บาท · ${Fmt.pct(util)}`}
                  style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: `${awPct}%`, background: utilColor, borderRadius: 5, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}></div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: utilColor, fontVariantNumeric: 'tabular-nums' }}>{Fmt.pct(util)}</div>
                <div style={{ fontSize: 11.5, color: over ? P.danger : P.mute, fontVariantNumeric: 'tabular-nums' }}>
                  {over ? `เกินงบ ${Fmt.compact(diff)}` : `เหลือ ${Fmt.compact(-diff)}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // TopCats — อันดับประเภทค่าใช้จ่ายที่ใช้เยอะ 5 อันดับ
  // ════════════════════════════════════════════════════════════════════════
  function TopCats({ categories, onPick }) {
    const sorted = categories.filter(c => c.actual > 0).slice().sort((a, b) => b.actual - a.actual).slice(0, 5);
    if (!sorted.length) return <div style={{ padding: '24px', textAlign: 'center', color: P.mute, fontSize: 13.5 }}>ยังไม่มีการใช้จ่ายในขอบเขตนี้</div>;
    const totalActual = categories.reduce((s, c) => s + c.actual, 0);
    const topMax = sorted[0].actual || 1;
    const medals = [
      { bg: 'linear-gradient(135deg,#F5A623,#D4881A)', label: '🥇' },
      { bg: 'linear-gradient(135deg,#B7BFCB,#8A95A6)', label: '🥈' },
      { bg: 'linear-gradient(135deg,#C67A3E,#A05A24)', label: '🥉' },
      { bg: 'linear-gradient(135deg,#6BA0FF,#4E89FF)', label: '4' },
      { bg: 'linear-gradient(135deg,#8AAEF0,#6BA0FF)', label: '5' },
    ];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sorted.map((c, i) => {
          const shareOfTotal = totalActual > 0 ? c.actual / totalActual : 0;
          const util = c.budget > 0 ? c.actual / c.budget : 0;
          const over = c.actual > c.budget;
          const m = medals[i];
          return (
            <div key={i} onClick={() => onPick && onPick(c)} className="bcc-deptRow"
              style={{ cursor: 'pointer', display: 'grid', gridTemplateColumns: '54px 1fr 170px', gap: 16, alignItems: 'center', padding: '14px 16px', borderRadius: 14, border: `1px solid ${P.border}`, background: i < 3 ? 'linear-gradient(180deg, rgba(47,95,208,0.04), #fff)' : '#fff' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: m.bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: i < 3 ? 22 : 18, fontWeight: 800, boxShadow: '0 2px 6px rgba(0,0,0,0.10)' }}>{m.label}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: P.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{splitName(c.name)}</div>
                <div style={{ fontSize: 12, color: P.mute, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  ใช้จริง <b style={{ color: P.ink }}>{Fmt.compactBaht(c.actual)}</b> · <b>{Fmt.pct(shareOfTotal)}</b> ของยอดใช้รวม
                </div>
                <div style={{ marginTop: 8, height: 7, background: P.grid, borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${(c.actual / topMax) * 100}%`, height: '100%', background: over ? P.danger : P.primary, borderRadius: 6 }}></div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11.5, color: P.mute, fontWeight: 600 }}>เทียบงบ</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: over ? P.danger : util >= 0.9 ? P.warning : P.success, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>{Fmt.pct(util)}</div>
                <div style={{ fontSize: 11, color: P.mute, fontVariantNumeric: 'tabular-nums' }}>งบ {Fmt.compactBaht(c.budget)}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Overspending alert
  // ════════════════════════════════════════════════════════════════════════
  function Overspend({ items, onPick }) {
    if (!items.length) return <div style={{ padding: '24px', textAlign: 'center', color: P.mute, fontSize: 13.5 }}>ไม่มีรายการที่ใช้จริงเกินงบในขอบเขตนี้ 🎉</div>;
    const maxOver = Math.max(...items.map(i => i.over), 1);
    const priority = (i, idx) => idx < 3 ? { t: 'สูง', c: P.danger, bg: 'rgba(231,76,60,0.12)' } : idx < 7 ? { t: 'กลาง', c: '#C8870E', bg: 'rgba(245,166,35,0.14)' } : { t: 'เฝ้าระวัง', c: P.secondary, bg: 'rgba(78,137,255,0.10)' };
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, fontSize: 13.5 }}>
          <thead><tr style={{ borderBottom: `2px solid ${P.border}`, color: P.mute, fontSize: 12 }}>
            <th style={{ textAlign: 'left', padding: '12px 14px', fontWeight: 700 }}>แผนก · บัญชี</th>
            <th style={{ textAlign: 'right', padding: '12px 14px', fontWeight: 700 }}>งบ</th>
            <th style={{ textAlign: 'right', padding: '12px 14px', fontWeight: 700 }}>ใช้จริง</th>
            <th style={{ textAlign: 'left', padding: '12px 14px', fontWeight: 700, minWidth: 170 }}>เกินงบ</th>
            <th style={{ textAlign: 'center', padding: '12px 14px', fontWeight: 700 }}>ระดับ</th>
          </tr></thead>
          <tbody>
            {items.map((it, i) => {
              const p = priority(it, i);
              return (
                <tr key={i} onClick={() => onPick && onPick(it.dept)} className="bcc-deptRow" style={{ borderBottom: `1px solid ${P.grid}`, cursor: 'pointer' }}>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ fontWeight: 700, color: P.ink, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.desc}</div>
                    <div style={{ fontSize: 11.5, color: P.mute, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: deptColor(it.dept), flexShrink: 0 }}></span>
                      {it.dept} · {it.acct}
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{Fmt.bahtPlain(it.budget)}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{Fmt.bahtPlain(it.actual)}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 7, background: P.grid, borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${(it.over / maxOver) * 100}%`, height: '100%', background: P.danger, borderRadius: 6 }}></div>
                      </div>
                      <span style={{ fontWeight: 800, color: P.danger, fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>+{Fmt.compact(it.over)}</span>
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: p.c, background: p.bg, padding: '4px 11px', borderRadius: 999 }}>{p.t}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Department overview table
  // ════════════════════════════════════════════════════════════════════════
  function DeptTable({ departments, onPick, query }) {
    const [sort, setSort] = useState({ key: 'budget', dir: 'desc' });
    const rows = useMemo(() => {
      let r = departments.map(d => ({ ...d, remaining: d.budget - d.actual, util: d.budget ? d.actual / d.budget : 0 }));
      if (query) { const q = query.toLowerCase(); r = r.filter(d => (d.name + d.code).toLowerCase().includes(q)); }
      r.sort((a, b) => { const m = sort.dir === 'asc' ? 1 : -1; return (a[sort.key] > b[sort.key] ? 1 : -1) * m; });
      return r;
    }, [departments, sort, query]);
    const th = (key, label, align) => (
      <th onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
        style={{ textAlign: align || 'left', padding: '13px 16px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', fontWeight: 700, fontSize: 12.5, color: sort.key === key ? P.primary : P.mute, letterSpacing: '.02em' }}>
        {label}{sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
      </th>
    );
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${P.border}` }}>
              {th('name', 'แผนก · Department')}
              {th('budget', 'งบประมาณ', 'right')}
              {th('actual', 'ใช้จริง', 'right')}
              {th('remaining', 'คงเหลือ', 'right')}
              {th('util', 'การใช้งบ · Utilization', 'left')}
              <th style={{ textAlign: 'center', padding: '13px 16px', fontWeight: 700, fontSize: 12.5, color: P.mute }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const dc = d.color || deptColor(d.code);
              return (
                <tr key={d.code} onClick={() => onPick(d)} className="bcc-deptRow" style={{ borderBottom: `1px solid ${P.grid}`, cursor: 'pointer' }}>
                  <td style={{ padding: '13px 16px', borderLeft: `4px solid ${dc}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 38, height: 38, borderRadius: 9, background: dc, color: '#fff', fontWeight: 800, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 2px 6px ${hexToRgba(dc, 0.35)}` }}>{d.code.slice(0, 3)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: P.ink, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{splitName(d.name)}</div>
                        <div style={{ fontSize: 11.5, color: P.mute }}>{d.code} · {d.accounts.length} บัญชี</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 600, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{Fmt.bahtPlain(d.budget)}</td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 600, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{Fmt.bahtPlain(d.actual)}</td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 700, color: d.remaining < 0 ? P.danger : P.success, fontVariantNumeric: 'tabular-nums' }}>{Fmt.bahtPlain(d.remaining)}</td>
                  <td style={{ padding: '13px 16px' }}><MiniBar util={d.util} /></td>
                  <td style={{ padding: '13px 16px', textAlign: 'center' }}><Badge util={d.util} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Forecast cards + chart
  // ════════════════════════════════════════════════════════════════════════
  function ForecastCards({ budget, actual, actualMonths, mode }) {
    const totalBudget = budget, totalActual = actual;
    const pace = actualMonths > 0 ? totalActual / actualMonths : 0;
    const forecastRun = Math.round(pace * 12);
    const forecast = mode === 'runrate' ? forecastRun : totalBudget;
    const variance = totalBudget - forecast;
    const projRemaining = totalBudget - forecast;
    const cards = [
      { label: 'งบประมาณ', en: 'Budget', val: Fmt.compactBaht(totalBudget), color: P.primary },
      { label: 'คาดการณ์สิ้นปี', en: 'Forecast', val: Fmt.compactBaht(forecast), color: P.secondary },
      { label: 'ส่วนต่างคาดการณ์', en: 'Expected Variance', val: (variance >= 0 ? '' : '−') + Fmt.compactBaht(Math.abs(variance)), color: variance >= 0 ? P.success : P.danger },
      { label: 'คงเหลือคาดการณ์', en: 'Projected Remaining', val: Fmt.compactBaht(projRemaining), color: projRemaining >= 0 ? P.success : P.danger },
    ];
    return (
      <div className="bcc-fcCards">
        {cards.map((c, i) => (
          <div key={i} style={{ background: P.bg, borderRadius: 13, padding: '15px 17px', border: `1px solid ${P.border}` }}>
            <div style={{ fontSize: 12, color: P.mute, fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: 10.5, color: '#A9B4C8' }}>{c.en}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{c.val}</div>
          </div>
        ))}
      </div>
    );
  }
  function ForecastChart({ monthly, actualMonths, mode }) {
    const [hover, setHover] = useState(null);
    const W = 1040, H = 360, padL = 64, padR = 24, padT = 24, padB = 44;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const cumBudget = []; let cb = 0;
    monthly.forEach(m => { cb += m.b; cumBudget.push(cb); });
    const cumActual = []; let ca = 0;
    for (let i = 0; i < actualMonths; i++) { ca += monthly[i].a; cumActual.push(ca); }
    const avgPace = actualMonths > 0 ? ca / actualMonths : 0;
    const fc = [];
    for (let i = 0; i < 12; i++) {
      if (i < actualMonths) fc.push(cumActual[i]);
      else if (mode === 'runrate') fc.push((i + 1) * avgPace);
      else { let v = (actualMonths > 0 ? cumActual[actualMonths - 1] : 0); for (let j = actualMonths; j <= i; j++) v += monthly[j].b; fc.push(v); }
    }
    const max = Math.max(cumBudget[11], fc[11]) * 1.1 || 1;
    const x = (i) => padL + (i) * (plotW / 11);
    const y = (v) => padT + plotH - (v / max) * plotH;
    const path = (arr, n) => 'M ' + arr.slice(0, n).map((v, i) => `${x(i)},${y(v)}`).join(' L ');
    const ticks = 4;
    return (
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="bccFcFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={P.primary} stopOpacity="0.14" />
              <stop offset="100%" stopColor={P.primary} stopOpacity="0" />
            </linearGradient>
          </defs>
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const gy = padT + (plotH / ticks) * i;
            return <g key={i}><line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke={P.grid} /><text x={padL - 12} y={gy + 4} textAnchor="end" fontSize="13" fill={P.mute}>{Fmt.compact(max * (1 - i / ticks))}</text></g>;
          })}
          <path d={path(cumBudget, 12)} fill="none" stroke={P.secondary} strokeWidth="2.5" strokeDasharray="6 5" />
          <path d={`${path(fc, 12)} L ${x(11)},${padT + plotH} L ${padL},${padT + plotH} Z`} fill="url(#bccFcFill)" />
          <path d={path(fc, actualMonths)} fill="none" stroke={P.primary} strokeWidth="3.5" strokeLinecap="round" />
          <path d={'M ' + fc.slice(Math.max(0, actualMonths - 1)).map((v, i) => `${x(i + Math.max(0, actualMonths - 1))},${y(v)}`).join(' L ')} fill="none" stroke={P.primary} strokeWidth="3" strokeDasharray="2 6" strokeLinecap="round" opacity="0.75" />
          {fc[11] > cumBudget[11] && <circle cx={x(11)} cy={y(fc[11])} r="6" fill={P.danger} />}
          <circle cx={x(11)} cy={y(cumBudget[11])} r="5" fill="#fff" stroke={P.secondary} strokeWidth="2.5" />
          {actualMonths > 0 && <circle cx={x(actualMonths - 1)} cy={y(fc[actualMonths - 1])} r="5" fill={P.primary} />}
          {monthly.map((m, i) => <text key={i} x={x(i)} y={H - 14} textAnchor="middle" fontSize="12.5" fill={P.mute}>{MONTHS_TH[i]}</text>)}
          {hover !== null && <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + plotH} stroke={P.primary} strokeDasharray="3 3" opacity="0.4" />}
          {monthly.map((m, i) => <rect key={i} x={x(i) - plotW / 22} y={padT} width={plotW / 11} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        </svg>
        {hover !== null && (
          <div style={{ position: 'absolute', left: `${(x(hover) / W) * 100}%`, top: 4, transform: 'translateX(-50%)', background: '#fff', border: `1px solid ${P.border}`, borderRadius: 12, padding: '10px 13px', boxShadow: '0 12px 30px rgba(31,54,99,0.16)', minWidth: 170, pointerEvents: 'none' }}>
            <div style={{ fontWeight: 700, color: P.ink, fontSize: 13.5, marginBottom: 7 }}>{MONTHS_TH[hover]} (สะสม)</div>
            <Row dot={P.secondary} label="งบสะสม" val={Fmt.compactBaht(cumBudget[hover])} />
            <Row dot={P.primary} label={hover < actualMonths ? 'ใช้จริงสะสม' : 'คาดการณ์'} val={Fmt.compactBaht(fc[hover])} />
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Insight (rule-based; no external LLM in this app)
  // ════════════════════════════════════════════════════════════════════════
  function buildInsights(data) {
    const pctUsed = data.meta.totalBudget ? (data.meta.totalActual / data.meta.totalBudget * 100).toFixed(1) : '0.0';
    const ranked = [...data.departments].map(d => ({ name: splitName(d.name), util: d.budget ? d.actual / d.budget : 0 })).sort((a, b) => b.util - a.util);
    const top = ranked[0];
    const overCount = data.departments.filter(d => d.actual > d.budget).length;
    const biggest = data.overBudget[0];
    return [
      { type: 'info', title: 'ภาพรวมการใช้งบ', text: `ใช้งบไปแล้ว ${pctUsed}% ของงบประมาณ (${data.meta.actualMonths} เดือนแรก)` },
      top ? { type: 'warning', title: `${top.name} ใช้งบสัดส่วนสูงสุด`, text: `แผนก ${top.name} ใช้งบไปแล้ว ${(top.util * 100).toFixed(0)}% ของงบ ควรเฝ้าระวังอัตราการใช้จ่าย` } : null,
      { type: 'forecast', title: 'รายการเกินงบที่ต้องจับตา', text: biggest ? `"${biggest.desc}" ของ ${biggest.dept} เกินงบ ${Fmt.compactBaht(biggest.over)} เป็นรายการที่เกินมากที่สุด` : 'ไม่มีรายการเกินงบที่มีนัยสำคัญ' },
      { type: overCount > 0 ? 'warning' : 'success', title: 'สถานะเกินงบรวม', text: `มี ${overCount} แผนกที่มียอดใช้จริงเกินงบ ควรทบทวนแผนการใช้จ่ายในงวดถัดไป` },
    ].filter(Boolean);
  }
  function Insight({ data }) {
    const [state, setState] = useState('idle'); // idle | loading | done
    const [insights, setInsights] = useState([]);
    function generate() {
      setState('loading');
      setTimeout(() => { setInsights(buildInsights(data)); setState('done'); }, 350);
    }
    const styleMap = {
      warning: { icon: '⚠️', bg: 'rgba(231,76,60,0.07)', bd: 'rgba(231,76,60,0.22)' },
      info: { icon: 'ℹ️', bg: 'rgba(47,95,208,0.06)', bd: 'rgba(47,95,208,0.2)' },
      success: { icon: '✅', bg: 'rgba(53,179,126,0.07)', bd: 'rgba(53,179,126,0.22)' },
      forecast: { icon: '📈', bg: 'rgba(245,166,35,0.08)', bd: 'rgba(245,166,35,0.28)' },
    };
    return (
      <div>
        {state === 'idle' && (
          <div style={{ textAlign: 'center', padding: '34px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
            <div style={{ fontSize: 15, color: P.ink, fontWeight: 700 }}>สรุปข้อมูลเชิงลึกสำหรับผู้บริหาร</div>
            <div style={{ fontSize: 13, color: P.mute, marginTop: 4, marginBottom: 18 }}>วิเคราะห์งบประมาณ การใช้จ่าย และความเสี่ยงเกินงบจากข้อมูลจริง</div>
            <button onClick={generate} className="bcc-aiBtn">✨ สร้างข้อมูลเชิงลึก · Generate Insights</button>
          </div>
        )}
        {state === 'loading' && (
          <div style={{ padding: '30px 20px', textAlign: 'center' }}>
            <div className="bcc-spinner"></div>
            <div style={{ fontSize: 13.5, color: P.mute, marginTop: 14 }}>กำลังวิเคราะห์ข้อมูล…</div>
          </div>
        )}
        {state === 'done' && (
          <div>
            <div className="bcc-insightGrid">
              {insights.map((it, i) => {
                const s = styleMap[it.type] || styleMap.info;
                return (
                  <div key={i} style={{ background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 13, padding: '15px 17px', display: 'flex', gap: 13 }}>
                    <span style={{ fontSize: 20, lineHeight: 1 }}>{s.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, color: P.ink, fontSize: 14 }}>{it.title}</div>
                      <div style={{ fontSize: 13, color: '#52617D', marginTop: 3, lineHeight: 1.5 }}>{it.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={generate} style={{ marginTop: 16, background: 'none', border: `1px solid ${P.border}`, color: P.primary, fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 9, cursor: 'pointer' }}>↻ วิเคราะห์ใหม่</button>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Category drill-down popup
  // ════════════════════════════════════════════════════════════════════════
  function CatPopup({ cat, data, onClose, onPickDept }) {
    const [tab, setTab] = useState('dept');
    if (!cat) return null;
    const util = cat.budget ? cat.actual / cat.budget : 0;
    const contrib = data.departments.map(d => {
      const accts = d.accounts.filter(a => a.cat === cat.name);
      const budget = accts.reduce((s, a) => s + a.budget, 0);
      const actual = accts.reduce((s, a) => s + a.actual, 0);
      return { name: splitName(d.name), code: d.code, budget, actual };
    }).filter(d => d.budget > 0).sort((a, b) => b.budget - a.budget);
    const items = [];
    for (const d of data.departments) for (const a of d.accounts) {
      if (a.cat === cat.name && (a.budget > 0 || a.actual > 0)) items.push({ desc: a.desc, code: a.code, dept: d.code, budget: a.budget, actual: a.actual });
    }
    items.sort((a, b) => b.budget - a.budget);
    const rowUtil = (b, a) => b ? a / b : (a > 0 ? 1.2 : 0);
    const uColor = (u) => u >= 1 ? P.danger : u >= 0.8 ? '#C8870E' : P.success;
    return (
      <div onClick={onClose} className="bcc-overlay" style={{ alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div onClick={e => e.stopPropagation()} className="bcc-modal" style={{ width: 'min(620px,96vw)', maxHeight: '88vh' }}>
          <div style={{ padding: '20px 24px', background: 'linear-gradient(135deg,#2F5FD0,#4E89FF)', color: '#fff', position: 'relative' }}>
            <button onClick={onClose} className="bcc-modal-x">×</button>
            <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 600 }}>หมวดงบประมาณ · CATEGORY</div>
            <div style={{ fontSize: 21, fontWeight: 800, marginTop: 3, paddingRight: 36 }}>{cat.name}</div>
            <div style={{ display: 'flex', gap: 22, marginTop: 14, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, opacity: 0.8 }}>งบประมาณ</div><div style={{ fontSize: 18, fontWeight: 800 }}>{Fmt.compactBaht(cat.budget)}</div></div>
              <div><div style={{ fontSize: 11, opacity: 0.8 }}>ใช้จริง</div><div style={{ fontSize: 18, fontWeight: 800 }}>{Fmt.compactBaht(cat.actual)}</div></div>
              <div><div style={{ fontSize: 11, opacity: 0.8 }}>ใช้ไป</div><div style={{ fontSize: 18, fontWeight: 800 }}>{Fmt.pct(util)}</div></div>
              <div><div style={{ fontSize: 11, opacity: 0.8 }}>จำนวนบัญชี</div><div style={{ fontSize: 18, fontWeight: 800 }}>{items.length}</div></div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '12px 24px 0', borderBottom: `1px solid ${P.border}` }}>
            {[['dept', `แยกตามแผนก (${contrib.length})`], ['acct', `รายการบัญชี (${items.length})`]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={{ padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: tab === k ? P.primary : P.mute, borderBottom: tab === k ? `2.5px solid ${P.primary}` : '2.5px solid transparent', marginBottom: -1 }}>{l}</button>
            ))}
          </div>
          <div style={{ padding: '6px 24px 22px', overflowY: 'auto' }}>
            {tab === 'dept' && (
              <>
                <div style={{ fontSize: 11.5, color: P.mute, padding: '10px 0 4px' }}>คลิกแผนกเพื่อเปิดรายละเอียดทั้งหมด →</div>
                {contrib.map((d, i) => {
                  const u = rowUtil(d.budget, d.actual);
                  return (
                    <div key={i} onClick={() => onPickDept(d.code)} className="bcc-drillRow" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 8px', borderBottom: `1px solid ${P.grid}`, cursor: 'pointer', borderRadius: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, width: 60, flexShrink: 0 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: deptColor(d.code), flexShrink: 0 }}></span>
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: deptColor(d.code) }}>{d.code}</span>
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: P.ink, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                      <div style={{ width: 70, height: 6, background: P.grid, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                        <div style={{ width: `${Math.min(u, 1) * 100}%`, height: '100%', background: uColor(u) }}></div>
                      </div>
                      <span style={{ fontSize: 13, color: P.ink, fontWeight: 700, fontVariantNumeric: 'tabular-nums', width: 64, textAlign: 'right' }}>{Fmt.compactBaht(d.budget)}</span>
                      <span style={{ color: P.mute, fontSize: 13 }}>›</span>
                    </div>
                  );
                })}
              </>
            )}
            {tab === 'acct' && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: P.mute, fontSize: 11 }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 700 }}>บัญชี</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700 }}>งบ</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700 }}>ใช้จริง</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700 }}>Variance</th>
                </tr></thead>
                <tbody>
                  {items.map((it, i) => {
                    const v = it.budget - it.actual;
                    return (
                      <tr key={i} onClick={() => onPickDept(it.dept)} className="bcc-drillRow" style={{ borderBottom: `1px solid ${P.grid}`, cursor: 'pointer' }}>
                        <td style={{ padding: '10px 6px' }}>
                          <div style={{ fontWeight: 600, color: P.ink, maxWidth: 290, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.desc}</div>
                          <div style={{ fontSize: 10.5, color: P.mute }}>{it.dept} · {it.code}</div>
                        </td>
                        <td style={{ padding: '10px 6px', textAlign: 'right', color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{Fmt.bahtPlain(it.budget)}</td>
                        <td style={{ padding: '10px 6px', textAlign: 'right', color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{Fmt.bahtPlain(it.actual)}</td>
                        <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: v < 0 ? P.danger : P.success }}>{Fmt.bahtPlain(v)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Right slide-over: department detail (real data only — no fabricated tx)
  // ════════════════════════════════════════════════════════════════════════
  function Stat({ label, val, hi }) {
    return (
      <div style={{ background: 'rgba(255,255,255,0.16)', borderRadius: 11, padding: '9px 13px', flex: '1 1 auto', minWidth: 110 }}>
        <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2, color: hi ? '#FFD9D2' : '#fff' }}>{val}</div>
      </div>
    );
  }
  function SlideOver({ dept, actualMonths, onClose }) {
    const [openAcct, setOpenAcct] = useState(null);
    const [acctSort, setAcctSort] = useState({ key: 'budget', dir: 'desc' });
    useEffect(() => { setOpenAcct(null); setAcctSort({ key: 'budget', dir: 'desc' }); }, [dept]);
    if (!dept) return null;
    const B = dept.annualBudget != null ? dept.annualBudget : dept.budget;
    const Ac = dept.annualActual != null ? dept.annualActual : dept.actual;
    const remaining = B - Ac;
    const util = B ? Ac / B : 0;
    const pace = actualMonths > 0 ? Ac / actualMonths : 0;
    const forecast = Math.round(pace * 12);
    const dc = dept.color || deptColor(dept.code);
    const accounts = [...dept.accounts].map(a => {
      const bdg = a.annualBudget != null ? a.annualBudget : a.budget;
      const act = a.annualActual != null ? a.annualActual : a.actual;
      return { ...a, budget: bdg, actual: act, variance: bdg - act, util: bdg ? act / bdg : (act > 0 ? 1.5 : 0) };
    }).sort((a, b) => {
      const m = acctSort.dir === 'asc' ? 1 : -1;
      if (acctSort.key === 'name') return (a.desc > b.desc ? 1 : -1) * m;
      return (a[acctSort.key] - b[acctSort.key]) * m;
    });
    return (
      <>
        <div onClick={onClose} className="bcc-overlay" style={{ zIndex: 60 }}></div>
        <aside className="bcc-slideover">
          <div style={{ padding: '22px 26px', background: `linear-gradient(135deg, ${dc}, ${lighten(dc, 0.22)})`, color: '#fff', position: 'relative' }}>
            <button onClick={onClose} className="bcc-modal-x">×</button>
            <div style={{ fontSize: 12.5, opacity: 0.85, fontWeight: 600, letterSpacing: '.04em' }}>{dept.code} · DEPARTMENT DETAIL</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, paddingRight: 40 }}>{splitName(dept.name)}</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{(dept.name.match(/\(([^)]+)\)/) || [, ''])[1]}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              <Stat label="งบประมาณ" val={Fmt.compactBaht(B)} />
              <Stat label="ใช้จริง" val={Fmt.compactBaht(Ac)} />
              <Stat label="คงเหลือ" val={Fmt.compactBaht(remaining)} hi={remaining < 0} />
              <Stat label="คาดการณ์สิ้นปี" val={Fmt.compactBaht(forecast)} hi={forecast > B} />
            </div>
          </div>
          <div style={{ padding: '14px 26px', borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1 }}><MiniBar util={util} /></div>
            <Badge util={util} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 24px' }}>
            <div style={{ fontSize: 12, color: P.mute, fontWeight: 700, padding: '0 0 8px' }}>บัญชี ({accounts.length}) · คลิกเพื่อดูยอดรายเดือน</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ color: P.mute, fontSize: 11.5 }}>
                {[['name', 'บัญชี · Account', 'left'], ['budget', 'งบ', 'right'], ['actual', 'ใช้จริง', 'right'], ['variance', 'Variance', 'right']].map(([key, label, align]) => (
                  <th key={key} onClick={() => setAcctSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
                    style={{ textAlign: align, padding: '12px 8px', fontWeight: 700, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: acctSort.key === key ? P.primary : P.mute }}>
                    {label}{acctSort.key === key ? (acctSort.dir === 'desc' ? ' ↓' : ' ↑') : ' ⇅'}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {accounts.map((a, i) => {
                  const v = a.variance;
                  const open = openAcct === a.code;
                  return (
                    <React.Fragment key={a.code + i}>
                      <tr onClick={() => setOpenAcct(open ? null : a.code)} style={{ borderBottom: `1px solid ${P.grid}`, cursor: 'pointer' }}>
                        <td style={{ padding: '11px 8px' }}>
                          <div style={{ fontWeight: 600, color: P.ink, maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ color: P.mute, marginRight: 5, fontSize: 11 }}>{open ? '▾' : '▸'}</span>{a.desc}
                          </div>
                          <div style={{ fontSize: 11, color: P.mute }}>{a.code} · {splitName(a.cat)}</div>
                        </td>
                        <td style={{ padding: '11px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: P.ink }}>{Fmt.bahtPlain(a.budget)}</td>
                        <td style={{ padding: '11px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: P.ink }}>{Fmt.bahtPlain(a.actual)}</td>
                        <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: v < 0 ? P.danger : P.success }}>{Fmt.bahtPlain(v)}</td>
                      </tr>
                      {open && (
                        <tr style={{ background: P.bg }}>
                          <td colSpan={4} style={{ padding: '6px 8px 12px 26px' }}>
                            <div style={{ fontSize: 11, color: P.mute, fontWeight: 700, margin: '4px 0 6px' }}>ยอดรายเดือน · งบ / ใช้จริง</div>
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: 560 }}>
                                <thead><tr style={{ color: P.mute }}>
                                  <th style={{ textAlign: 'left', padding: '3px 8px 3px 0' }}></th>
                                  {MONTHS_TH.map((mm, j) => <th key={j} style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 600, color: j >= actualMonths ? '#B9C3D6' : P.mute }}>{mm}</th>)}
                                </tr></thead>
                                <tbody>
                                  <tr><td style={{ padding: '3px 8px 3px 0', color: P.secondary, fontWeight: 700 }}>งบ</td>{a.mb.map((vv, j) => <td key={j} style={{ textAlign: 'right', padding: '3px 6px', fontVariantNumeric: 'tabular-nums', color: P.ink }}>{vv ? Fmt.compact(vv) : '—'}</td>)}</tr>
                                  <tr><td style={{ padding: '3px 8px 3px 0', color: P.primary, fontWeight: 700 }}>ใช้จริง</td>{a.ma.map((vv, j) => <td key={j} style={{ textAlign: 'right', padding: '3px 6px', fontVariantNumeric: 'tabular-nums', color: vv > (a.mb[j] || 0) ? P.danger : P.ink }}>{vv ? Fmt.compact(vv) : '—'}</td>)}</tr>
                                </tbody>
                              </table>
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
        </aside>
      </>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Page
  // ════════════════════════════════════════════════════════════════════════
  function BudgetControlPage({ toast }) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [isSample, setIsSample] = useState(false);
    const [filters, setFilters] = useState({ year: '2569', month: 'all', company: 'HO', dept: 'all', cat: 'all', q: '' });
    const [picked, setPicked] = useState(null);
    const [catPick, setCatPick] = useState(null);
    const [fcMode, setFcMode] = useState('runrate');
    const [uploading, setUploading] = useState(false);

    const canEdit = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;
    const notify = toast || ((m) => {});

    const loadData = () => {
      setLoading(true);
      if (!window.WTPData || !window.WTPData.fetchSheetRows) {
        setData(sampleBase()); setIsSample(true); setLoading(false); return;
      }
      window.WTPData.fetchSheetRows(BCC_SHEET)
        .then(rows => {
          const parsed = parseSheetRows(rows);
          if (parsed) { setData(parsed); setIsSample(false); }
          else { setData(sampleBase()); setIsSample(true); }
        })
        .catch(() => { setData(sampleBase()); setIsSample(true); })
        .finally(() => setLoading(false));
    };
    useEffect(() => { loadData(); }, []);

    async function onUpload(file) {
      setUploading(true);
      try {
        const { base, rows } = await parseWorkbook(file);
        if (!base.departments.length) throw new Error('no departments parsed');
        // instant preview
        setData(base); setIsSample(false); setPicked(null); setCatPick(null);
        // persist to Supabase (เขียนทั้งตาราง budgetHo — 1 แถว/dept|acct)
        if (window.WTPData && window.WTPData.writeTable) {
          try {
            const res = await window.WTPData.writeTable('budgetHo', rows, r => String(r.dept) + '|' + String(r.acct));
            notify(`อัปเดตสำเร็จ · ${base.departments.length} แผนก · งบรวม ${Fmt.compactBaht(base.meta.totalBudget)} · บันทึก ${res.count} รายการ`);
            setTimeout(loadData, 600);
          } catch (err) { notify('แสดงผลแล้ว แต่บันทึกไม่สำเร็จ: ' + (err && err.message || err)); }
        } else {
          notify(`อ่านไฟล์สำเร็จ · ${base.departments.length} แผนก (ยังไม่ได้ตั้งค่า backend จึงไม่ได้บันทึกถาวร)`);
        }
      } catch (e) {
        notify('อ่านไฟล์ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ Budget (.xlsx) ที่มีคอลัมน์ Acct. Code + Total Budget + เดือน 1..N');
      }
      setUploading(false);
    }

    const view = useMemo(() => data ? computeView(data, filters) : null, [data, filters]);

    const scopeLabel = useMemo(() => {
      if (!data) return [];
      const parts = [];
      if (filters.dept !== 'all') { const d = data.departments.find(x => x.code === filters.dept); parts.push(d ? splitName(d.name) : filters.dept); }
      if (filters.cat !== 'all') parts.push(splitName(filters.cat));
      if (filters.month !== 'all') {
        if (QUARTERS[filters.month]) parts.push('ไตรมาส ' + filters.month.slice(1));
        else if (typeof filters.month === 'string' && filters.month.indexOf(',') >= 0) {
          const ms = filters.month.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
          parts.push(ms.length <= 3 ? ms.map(i => MONTHS_TH[i]).join(', ') : `${ms.length} เดือน`);
        }
        else parts.push(MONTHS_TH[parseInt(filters.month)]);
      }
      return parts;
    }, [data, filters]);
    const filtered = scopeLabel.length > 0;

    if (loading || !data || !view) {
      return (
        <div className="page bcc-page present-page">
          <div className="page-head"><div><h1 className="page-title">Budget Control Center</h1><div className="page-sub">กำลังโหลดข้อมูลจาก BUDGET HO…</div></div></div>
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-400)' }}>กำลังโหลด…</div>
        </div>
      );
    }

    return (
      <div className="page bcc-page present-page">
        <div className="page-head anim-in">
          <div>
            <h1 className="page-title">📊 Budget Control Center
              {isSample && <span className="bcc-badge-sample" title="อ่าน BUDGET HO ไม่ได้ — แสดงข้อมูลตัวอย่าง">ข้อมูลตัวอย่าง</span>}
            </h1>
            <div className="page-sub">งบประมาณและค่าใช้จ่ายจริง · ปีงบประมาณ {filters.year} · ข้อมูลใช้จริง {data.meta.actualMonths} เดือน (YTD) · ใช้ไป {data.meta.totalBudget ? Fmt.pct(data.meta.totalActual / data.meta.totalBudget) : '—'} ของงบทั้งปี</div>
          </div>
        </div>

        <FilterBar data={data} filters={filters} setFilters={setFilters} onUpload={onUpload} uploading={uploading} canEdit={canEdit} />

        {filtered && (
          <div className="bcc-scopeBanner">
            <span style={{ fontSize: 12.5, color: P.mute, fontWeight: 600 }}>กำลังแสดงเฉพาะ · Filtered view:</span>
            {scopeLabel.map((s, i) => (
              <span key={i} style={{ fontSize: 12.5, fontWeight: 700, color: P.primary, background: 'rgba(47,95,208,0.09)', padding: '4px 11px', borderRadius: 999 }}>{s}</span>
            ))}
            <button onClick={() => setFilters(f => ({ ...f, dept: 'all', cat: 'all', month: 'all', q: '' }))}
              style={{ marginLeft: 'auto', border: 'none', background: 'none', color: P.mute, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>✕ ล้างตัวกรอง</button>
          </div>
        )}

        <KpiRow data={view} filtered={filtered} />

        <SectionCard n="2" title="งบประมาณเทียบใช้จริงรายเดือน" sub="Monthly Budget vs Actual · แท่งใช้จริงแยกสีตามแผนก"
          actions={<Legend items={[{ color: P.primary, label: 'ใช้จริง (สีตามแผนก)' }, { line: true, dash: true, color: P.secondary, label: 'งบประมาณ' }]} />}>
          <TrendChart monthly={view.monthly} departments={view.departments} actualMonths={data.meta.actualMonths} highlight={view.highlightMonths} />
        </SectionCard>

        <SectionCard n="3" title="ภาพรวมรายแผนก" sub={`Department Overview · ${view.departments.length} แผนก · คลิกเพื่อดูรายละเอียด`} pad={false}
          actions={<span style={{ fontSize: 12, color: P.mute, fontWeight: 600 }}>คลิกแถว → เปิดแผงรายละเอียด</span>}>
          <DeptTable departments={view.departments} onPick={setPicked} query={filters.q} />
        </SectionCard>

        <SectionCard n="4" title="งบประมาณ vs ใช้จริง ตามประเภทค่าใช้จ่าย" sub="Budget vs Actual by Category · คลิกแถว → ดูรายแผนก"
          actions={<span style={{ fontSize: 12, color: P.mute, fontWeight: 600 }}>{view.categories.filter(c => c.budget > 0).length} หมวด</span>}>
          <CatBars categories={view.categories} onPick={setCatPick} />
        </SectionCard>

        <SectionCard n="5" title="อันดับประเภทค่าใช้จ่ายที่ใช้เยอะที่สุด" sub="Top 5 Expense Categories · เรียงตามยอดใช้จริง · คลิก → ดูรายแผนก"
          actions={<span style={{ fontSize: 12, fontWeight: 700, color: P.primary, background: 'rgba(47,95,208,0.10)', padding: '5px 12px', borderRadius: 999 }}>🏆 Top 5</span>}>
          <TopCats categories={view.categories} onPick={setCatPick} />
        </SectionCard>

        <SectionCard n="6" title="แจ้งเตือนงบเกิน" sub="Overspending Alert · รายการที่ใช้จริงเกินงบสูงสุด"
          actions={<span style={{ fontSize: 12, fontWeight: 700, color: P.danger, background: 'rgba(231,76,60,0.1)', padding: '5px 12px', borderRadius: 999 }}>⚠️ {view.overBudget.length} รายการ</span>}>
          <Overspend items={view.overBudget} onPick={(code) => setPicked(data.departments.find(d => d.code === code))} />
        </SectionCard>

        <SectionCard n="7" title="คาดการณ์สิ้นปี" sub="Year-End Forecast · เปรียบเทียบ 2 วิธี"
          actions={
            <div style={{ display: 'flex', gap: 4, background: P.bg, padding: 4, borderRadius: 10 }}>
              {[['runrate', 'อัตราใช้จริง'], ['budget', 'ตามงบ']].map(([k, l]) => (
                <button key={k} onClick={() => setFcMode(k)} style={{ padding: '6px 14px', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, background: fcMode === k ? '#fff' : 'transparent', color: fcMode === k ? P.primary : P.mute, boxShadow: fcMode === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{l}</button>
              ))}
            </div>}>
          <ForecastCards budget={view.meta.annualTotalBudget} actual={view.meta.annualTotalActual} actualMonths={data.meta.actualMonths} mode={fcMode} />
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${P.grid}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: P.ink }}>งบสะสม vs คาดการณ์สะสม</span>
              <Legend items={[{ line: true, dash: true, color: P.secondary, label: 'งบสะสม' }, { line: true, color: P.primary, label: 'ใช้จริง → คาดการณ์' }]} />
            </div>
            <ForecastChart monthly={view.monthly} actualMonths={data.meta.actualMonths} mode={fcMode} />
            <div style={{ fontSize: 12, color: P.mute, marginTop: 8 }}>
              {fcMode === 'runrate' ? '* คำนวณจากอัตราการใช้จ่ายเฉลี่ย ' + data.meta.actualMonths + ' เดือนแรก × 12' : '* สมมติว่าเดือนที่เหลือใช้จ่ายตามงบที่ตั้งไว้'}
            </div>
          </div>
        </SectionCard>

        <SectionCard n="8" title="ข้อมูลเชิงลึก" sub="Insight · สรุปอัตโนมัติสำหรับผู้บริหาร">
          <Insight data={view} />
        </SectionCard>

        <div style={{ textAlign: 'center', color: P.mute, fontSize: 12, padding: '10px 0 30px' }}>
          BIOAXEL Financial Console · Budget Control Center · ข้อมูลจาก Mango ERP — อัปเดตได้เองทุกเดือนผ่านปุ่ม “อัปเดตข้อมูล”
        </div>

        {picked && <SlideOver dept={picked} actualMonths={data.meta.actualMonths} onClose={() => setPicked(null)} />}
        {catPick && <CatPopup cat={catPick} data={data} onClose={() => setCatPick(null)}
          onPickDept={(code) => { const d = data.departments.find(x => x.code === code); if (d) { setPicked(d); setCatPick(null); } }} />}
      </div>
    );
  }

  window.BudgetControlPage = BudgetControlPage;
})();
