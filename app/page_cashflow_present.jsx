/* =====================================================================
 * งบกระแสเงินสด (#cashflow_present) — BIOAXEL
 * ---------------------------------------------------------------------
 *  หน้าตา = หน้า "งบกระแสเงินสด" ของ Water POG (2026-11-25) — ผู้ใช้ขอ "ปรับแก้รูปแบบหน้างบกระแสเงินสด
 *  ให้เหมือนของป๊อก ยกเว้นเรื่องสี ขอโทนสีเหมือนเดิม" (= โทนเขียว BIO เดิม):
 *    5 แท็บ Executive Summary · Category Analysis · Bank Accounts · Transaction Explorer · งบกระแสเงินสด
 *    + ตัวเลือกช่วงเวลา (ทั้งปี / ไตรมาส / เดือน) ใช้กับทุกแท็บ + KPI ทางการเงิน 8 ใบ
 *    + กดตัวเลข/แท่งกราฟ/แถว → ป๊อปอัพรายการ · ส่งออก Excel/CSV · พิมพ์ PDF (หัวข้อเดียว / ทั้งรายงาน)
 *  ส่วนที่ 1 = ตัวอ่านไฟล์ของ BIO ชุดเดิม (ไม่แตะ): STM รายการเดินบัญชี (รายบัญชี / ชีต "รวมทุกบัญชี")
 *    + งบกระแสเงินสดสรุป · หน้า #cf_coding ส่งข้อมูลเข้ามาผ่านตัวอ่านตัวเดียวกัน (window.cfpParseStm …)
 *  ส่วนที่ 2 = โค้ดวาดหน้าชุดเดียวกับ POG (ed* — ต้นทางคือหน้า execdash ของเว็บ Benya) แก้เฉพาะจุด ★ BIO
 *    (สีเขียว BIO · ชื่อบริษัท/โลโก้ · ข้อความอัปไฟล์ · ไม่มีคอลัมน์รหัส) — ถ้าแก้หน้าตาให้แก้คู่กับ POG
 *    (frontend/app/page_cashflow_present.jsx ของ waterpog-fin) · ส่วนที่ 3 = หน้า React ที่ถือข้อมูล/อัปโหลด
 *  ★ ข้อมูล "ส่วนกลาง" sync ผ่าน Supabase (ตาราง cashflowPresent, 1 แถว id='current') → ทุกคน/ผู้บริหาร
 *    เห็นชุดเดียวกัน · localStorage `bio-cfpresent-v1` = cache ต่อเครื่อง · `bio-cfp-ed-ui` = แท็บ/ช่วงที่เลือก
 *  ★ summary (งบสรุป) / catMap / acctTypes ที่หน้าเดิมเคยใช้ยังเก็บอยู่ในแถวข้อมูล (หน้าใหม่ไม่ได้ใช้แสดง — ไม่ลบทิ้ง)
 * ===================================================================== */
(function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const CFP_LS = 'bio-cfpresent-v1';
  // ── team-share ผ่าน Supabase: เก็บ 1 แถว (id='current') ในตาราง cashflowPresent
  //    อ่าน/เขียนผ่าน WTPData.fetchSheetRows/writeTable (cashflowPresent ∈ SHEET_TABLES).
  //    ต้องรัน supabase/cashflow-present.sql ครั้งเดียวก่อน (ไม่งั้น write จะ error → degrade เป็น local).
  const CFP_TABLE = 'cashflowPresent';
  const CFP_ROW_ID = 'current';
  function cfpCanSync() { return !!(window.WTPData && window.WTPData.fetchSheetRows && window.WTPData.writeTable && window.WTP_CONFIG && window.WTP_CONFIG.BACKEND === 'supabase'); }
  function cfpCurrentUser() { try { var s = JSON.parse(localStorage.getItem('bio-session') || 'null'); return s ? (s.displayName || s.username || '') : ''; } catch (e) { return ''; } }
  const CFP_MONTHS = { 1: 'ม.ค.', 2: 'ก.พ.', 3: 'มี.ค.', 4: 'เม.ย.', 5: 'พ.ค.', 6: 'มิ.ย.', 7: 'ก.ค.', 8: 'ส.ค.', 9: 'ก.ย.', 10: 'ต.ค.', 11: 'พ.ย.', 12: 'ธ.ค.' };

  /* ═════════════════════════════════════════════════════════════════════
   * ส่วนที่ 1 — ตัวอ่านไฟล์ของ BIO (ยกมาจากหน้าเดิมทั้งชุด ไม่แก้)
   * ═════════════════════════════════════════════════════════════════════ */
  /* ---------- helpers ---------- */
  function cfpNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v == null) return 0;
    let s = String(v).trim();
    if (s === '' || s === '-') return 0;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[,\s฿]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(s)) { const n = parseFloat(s); return neg ? -n : n; }
    return 0;
  }
  // ★ ทุก path คืน "ค.ศ. (CE)" เสมอ — กฎรวม: ปีที่ได้ > 2400 = พ.ศ. → ลบ 543
  //   (กัน bug "ปี 612" = เอาปี พ.ศ. 2569 ไปคิดต่อ). era hint คุมเฉพาะปี 2 หลัก.
  let cfpEraHint = 'auto'; function cfpToISO(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && isFinite(v) && v > 1000) {
      const dt = new Date(Math.round((v - 25569) * 86400 * 1000));
      /* ⚠️ ชีต "รวมทุกบัญชี" ที่ทำมือเก็บวันที่เป็น Excel serial ของปี พ.ศ. (244354 = 5 ม.ค. 2569)
         → serial นั้นแปลงตรง ๆ ได้ปี ค.ศ. 2569 ⇒ ต้องผ่านกฎรวม "ปี > 2400 = พ.ศ. → ลบ 543"
         เหมือน path อื่น ไม่ใช่ return ทางลัดตั้งแต่ตรงนี้ (เดิม iso ที่เก็บไว้เป็น 2569-xx
         ทั้งชุด → เดือนไม่ตรงกับข้อมูลที่ดันมาใหม่ ป้ายเดือนออกมาเป็น "612") */
      if (!isNaN(dt.getTime())) {
        const yy = dt.getUTCFullYear();
        if (yy <= 2400) return dt.toISOString().slice(0, 10);
        return String(yy - 543).padStart(4, '0') + dt.toISOString().slice(4, 10);
      }
    }
    let s = String(v).trim();
    const era = cfpEraHint || 'auto';
    let d = null, mo = null, y = null;
    if (era === 'auto' && typeof window.parseDateFlexible === 'function') {
      try { const iso = window.parseDateFlexible(s); if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) { y = +iso.slice(0, 4); mo = +iso.slice(5, 7); d = +iso.slice(8, 10); } } catch (e) {}
    }
    if (d == null) {
      const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if (m) {
        d = +m[1]; mo = +m[2]; y = +m[3];
        if (era === 'be') { if (y < 100) y += 2500; } else { if (y < 100) y += 2000; }
        if (d > 31 && y <= 31) { const t = d; d = y; y = t; }
        if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
      }
    }
    if (d == null || mo == null || y == null) return '';
    if (y > 2400) y -= 543;   // พ.ศ. → ค.ศ. (กฎรวมทุก era/ทุก path)
    return String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  const cfpMonth = iso => (iso && iso.length >= 7) ? +iso.slice(5, 7) : 0;
  function cfpFmtB(v) { const n = Math.round(Math.abs(v || 0)); return (v < 0 ? '-' : '') + n.toLocaleString('en-US'); }
  function cfpFmtM(v) { return (v < 0 ? '-' : '') + (Math.abs(v || 0) / 1e6).toFixed(2) + 'M'; }
  function cfpFmtSigned(v) { return (v < 0 ? '-' : '+') + (Math.abs(v || 0) / 1e6).toFixed(2) + 'M'; }
  function cfpFmtPlain(v) { return Math.round(Math.abs(v || 0)).toLocaleString('en-US'); }
  // ยอดเต็มทศนิยม 2 ตำแหน่ง (ใช้ในการ์ดสรุปผู้บริหาร) · cfpFmtAcct = ติดลบใส่วงเล็บแบบงบการเงิน
  function cfpFmtFull(v) { return Math.abs(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cfpFmtAcct(v) { const s = cfpFmtFull(v); return (v || 0) < 0 ? '(' + s + ')' : s; }
  function cfpThaiDate(iso) {
    if (!iso || iso.length < 10) return iso || '';
    let y = +iso.slice(0, 4); const m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    if (y > 2400) y -= 543;   // กัน iso เก่าที่เก็บเป็น พ.ศ. (อัปก่อนแก้ bug) → แสดงเป็น ค.ศ.
    return d + ' ' + (CFP_MONTHS[m] || m) + ' ' + y;   // ปี ค.ศ. เต็ม (มาตรฐานทั้งแอป)
  }
  // แปลงเลขปี พ.ศ. (2401–2600) ในข้อความอิสระ (เช่น period label จากไฟล์) → ค.ศ. ให้ทั้งหน้าเป็น ค.ศ.
  function cfpCeText(s) { return String(s || '').replace(/\b(2[4-9]\d\d)\b/g, function (m) { var n = +m; return n > 2400 ? String(n - 543) : m; }); }

  function cfpActKey(activity, category) {
    const a = String(activity || ''); const c = String(category || '');
    if (/โอนเงินระหว่างบัญชี/.test(c)) return 'transfer';
    if (/ดำเนินงาน/.test(a)) return 'op';
    if (/ลงทุน/.test(a)) return 'inv';
    if (/จัดหาเงิน|จัดหาทุน/.test(a)) return 'fin';
    return 'other';
  }
  const CFP_ACT_NAME = { op: 'กิจกรรมดำเนินงาน', inv: 'กิจกรรมลงทุน', fin: 'กิจกรรมจัดหาเงิน', transfer: 'โอนระหว่างบัญชี', other: 'อื่นๆ' };
  const CFP_ACT_SHORT = { op: 'ดำเนินงาน', inv: 'ลงทุน', fin: 'จัดหาเงิน', transfer: 'โอน', other: 'อื่นๆ' };

  function cfpAccountLabel(raw) {
    const s = String(raw || '');
    const m = s.match(/([A-Za-z])\/A#\s*([A-Za-z]*)\s*([\d-]+)\s*(.*)/);
    if (m) {
      const bank = (m[2] || '').toUpperCase();
      const name = (m[4] || '').trim();
      const tail = (m[3] || '').replace(/\D/g, '').slice(-4);
      return (bank || 'บัญชี') + (tail ? ' ···' + tail : '') + (name ? ' · ' + name : '');
    }
    return s.trim();
  }

  /* ---------- parse STM ----------
   * รองรับ 2 รูปแบบด้วยการ map คอลัมน์ตาม "ชื่อหัวตาราง" (header-driven):
   *  (A) STM รายบัญชี (STM BA.xlsx): แต่ละบัญชีเป็นบล็อกคั่นด้วย "C/A#…" + มีแถว "ยอดยกมา"
   *      วันที่=คอลัมน์แรก. บัญชีมาจาก header block.
   *  (B) ชีต "รวมทุกบัญชี" (ในไฟล์งบกระแสเงินสด): ทุกบัญชีรวมตารางเดียว มีคอลัมน์
   *      "บัญชีธนาคาร" ในทุกแถว, ไม่มี "ยอดยกมา" → คำนวณยอดต้นงวด = ยอดคงเหลือ − กระแส
   *      ของแถวที่เก่าสุดต่อบัญชี. รูปแบบนี้มักครบเดือนกว่า (เช่น ลากถึง มิ.ย.).
   */
  function cfpParseStm(aoa) {
    // 1) หา header row + map ชื่อคอลัมน์ → index (แถวที่มีทั้ง "วันที่" และ "ยอดถอน/ยอดฝาก")
    let COL = null;
    for (let i = 0; i < Math.min(aoa.length, 20); i++) {
      const hr = (aoa[i] || []).map(x => String(x == null ? '' : x).trim());
      const find = re => hr.findIndex(c => re.test(c));
      const dC = find(/^วันที่$/), wC = find(/ยอดถอน/), pC = find(/ยอดฝาก/);
      if (dC >= 0 && (wC >= 0 || pC >= 0)) {
        COL = {
          date: dC, withdraw: wC, deposit: pC,
          balance: find(/ยอดคงเหลือ/),
          doc: (find(/เลขที่เอกสาร/) >= 0 ? find(/เลขที่เอกสาร/) : hr.findIndex(c => /เลขที่/.test(c) && !/บัญชี/.test(c))),
          note: find(/หมายเหตุ/),
          category: find(/หมวด/),
          activity: find(/ประเภทกิจกรรม/),
          acct: find(/บัญชีธนาคาร/),   // -1 ถ้าเป็นรูปแบบ (A) ที่ไม่มีคอลัมน์บัญชี
        };
        break;
      }
    }
    // fallback = index เดิมของ STM รายบัญชี (เผื่อหัวตารางอ่านไม่เจอ) — backward-compatible
    if (!COL) COL = { date: 0, withdraw: 3, deposit: 4, balance: 5, doc: 2, note: 7, category: 8, activity: 9, acct: -1 };
    const at = (cells, k) => (k >= 0 ? cells[k] : '');
    const hasAcctCol = COL.acct >= 0;

    const txns = []; const openingByAcct = {}; let curAcct = '';
    const openTrack = {};   // (รูปแบบ B) acct → {iso, bal, flow} ของแถวเก่าสุด → opening = bal − flow
    for (let i = 0; i < aoa.length; i++) {
      const row = aoa[i] || []; const cells = row.map(x => (x == null ? '' : x));
      // รูปแบบ (A): จับชื่อบัญชีจาก header block + ยอดยกมา (ข้ามถ้ามีคอลัมน์บัญชีแล้ว)
      if (!hasAcctCol) {
        const joined = cells.map(String).join(' ');
        const acctHit = joined.match(/[A-Za-z]\/A#\s*[A-Za-z]*\s*[\d-]+[^\d]*/);
        if (acctHit) curAcct = cfpAccountLabel(acctHit[0]);
        if (cells.some(x => String(x).trim() === 'ยอดยกมา')) {
          let bal = 0; for (let k = cells.length - 1; k >= 0; k--) { const n = cfpNum(cells[k]); if (n !== 0) { bal = n; break; } }
          if (curAcct) openingByAcct[curAcct] = (openingByAcct[curAcct] || 0) + bal;
          continue;
        }
      }
      const iso = cfpToISO(at(cells, COL.date)); if (!iso) continue;
      const withdraw = cfpNum(at(cells, COL.withdraw)), deposit = cfpNum(at(cells, COL.deposit));
      if (withdraw === 0 && deposit === 0) continue;
      const acct = hasAcctCol ? (cfpAccountLabel(at(cells, COL.acct)) || '(ไม่ระบุบัญชี)') : (curAcct || '(ไม่ระบุบัญชี)');
      const balance = cfpNum(at(cells, COL.balance)), flow = deposit - withdraw;
      const category = String(at(cells, COL.category) || '').trim(), activity = String(at(cells, COL.activity) || '').trim();
      // รูปแบบ (B): จำแถวเก่าสุดต่อบัญชี เพื่อคำนวณยอดต้นงวด (ไม่มี "ยอดยกมา")
      //  ⚠️ ต้องเป็นแถวที่ "มี" ยอดคงเหลือจริงเท่านั้น — ช่องว่างไม่ใช่ยอด 0 (ชีตที่ดันมาจาก
      //     หน้างบกระทบยอดมีแถวบิลรายใบที่ไม่มีคอลัมน์นี้ ⇒ ต้นงวดจะกลายเป็นยอดจ่ายของบิลใบแรก)
      const balBlank = (at(cells, COL.balance) === '' || at(cells, COL.balance) == null);
      if (hasAcctCol && COL.balance >= 0 && !balBlank) { const p = openTrack[acct]; if (!p || iso < p.iso) openTrack[acct] = { iso, bal: balance, flow }; }
      txns.push({
        account: acct, iso, month: cfpMonth(iso),
        docNo: String(at(cells, COL.doc) || '').trim(), note: String(at(cells, COL.note) || '').trim(),
        category: category || '(ไม่ระบุหมวด)', actKey: cfpActKey(activity, category),
        withdraw, deposit, balance, flow,
      });
    }
    // รูปแบบ (B): opening ต่อบัญชี = ยอดคงเหลือแถวเก่าสุด − กระแสของแถวนั้น (= ยอดก่อนรายการแรก)
    if (hasAcctCol) Object.keys(openTrack).forEach(a => { const o = openTrack[a]; openingByAcct[a] = o.bal - o.flow; });
    let opening = 0; Object.keys(openingByAcct).forEach(k => { opening += openingByAcct[k]; });
    return { txns, opening, openingByAcct };
  }

  /* ---------- parse summary statement ---------- */
  function cfpParseSummary(aoa) {
    const out = { net: null, opening: null, ending: null, periodLabel: '', monthLabels: [], rows: [], actNet: {} };
    let headerIdx = -1, nCols = 0;
    for (let i = 0; i < aoa.length; i++) {
      const row = aoa[i] || []; const c0 = String(row[0] || '').trim();
      if (/สำหรับงวด/.test(c0)) out.periodLabel = c0;
      if (c0 === 'รายการ') { headerIdx = i; nCols = row.length; out.monthLabels = row.slice(1, nCols - 1).map(x => String(x || '').trim()); break; }
    }
    if (headerIdx < 0) {
      const lastNum = row => { for (let k = row.length - 1; k >= 0; k--) { const n = cfpNum(row[k]); if (n !== 0) return n; } return null; };
      for (let i = 0; i < aoa.length; i++) { const row = aoa[i] || []; const l = String(row[0] || '');
        if (/เพิ่มขึ้น.*ลดลง.*สุทธิ/.test(l)) out.net = lastNum(row);
        if (/เงินสด.*ต้นงวด/.test(l)) out.opening = lastNum(row);
        if (/เงินสด.*ปลายงวด/.test(l)) out.ending = lastNum(row); }
      return out;
    }
    const nMonths = out.monthLabels.length; let curAct = null;
    /* ★ AOA ที่หน้า #cf_coding สร้างเอง แนบ `kinds` มาให้ (ชนิดของแต่ละแถวตอน push แถว)
         → ใช้ของจริง ไม่ต้องเดา. ไฟล์ที่คนอัปเองไม่มี kinds → ตกไปใช้ "ย่อหน้า" */
    const KIND2TYPE = { sec: 'section', grp: 'group', item: 'leaf', gsum: 'subtotal',
      anet: 'net', net: 'grand', cash: 'grand', nsec: 'group', nitem: 'leaf', nbad: 'leaf', nplug: 'leaf' };
    const kinds = (aoa && aoa.kinds) || null;
    const actOf = l => /ดำเนินงาน/.test(l) ? 'op' : /ลงทุน/.test(l) ? 'inv' : /จัดหา/.test(l) ? 'fin' : null;
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const row = aoa[i] || []; const raw = row[0] == null ? '' : String(row[0]);
      const label = raw.trim(); if (!label) continue;
      const vals = []; let hasVal = false;
      for (let k = 1; k <= nMonths; k++) { const n = cfpNum(row[k]); vals.push(n); if (n !== 0) hasVal = true; }
      const total = cfpNum(row[nMonths + 1]); if (total !== 0) hasVal = true;
      // ── ค่าสรุป: อ่านจาก "ชื่อแถว" อย่างเดียว ไม่เกี่ยวกับว่าแถวนั้นถูกจัดเป็นชนิดไหน ──
      const isSec = /^กระแสเงินสดจากกิจกรรม/.test(label), isActNet = /^กระแสเงินสดสุทธิจากกิจกรรม/.test(label);
      if (isSec) curAct = actOf(label);
      if (isActNet) { const k = actOf(label); if (k) out.actNet[k] = total; }
      if (/เพิ่มขึ้น.*ลดลง.*สุทธิ|สุทธิ.*เพิ่มขึ้น/.test(label)) out.net = total;
      else if (/เงินสด.*ต้นงวด/.test(label)) out.opening = total;
      else if (/เงินสด.*ปลายงวด/.test(label)) out.ending = total;
      // ── ชนิดแถว ──
      let type;
      const kind = kinds ? kinds[i] : null;
      if (kind && KIND2TYPE[kind]) type = KIND2TYPE[kind];
      else if (isSec) type = 'section';
      else if (isActNet) type = 'net';
      else if (/เพิ่มขึ้น.*ลดลง.*สุทธิ|สุทธิ.*เพิ่มขึ้น|เงินสด.*(ต้นงวด|ปลายงวด)/.test(label)) type = 'grand';
      else if (/^รวม/.test(label)) type = 'subtotal';
      else {
        /* ⚠️ ห้ามเดาว่า "ยอดเป็น 0 ทุกเดือน = หัวข้อกลุ่ม" — รายการย่อยที่ยังไม่มียอด
           (เช่น "ชำระคืนเงินกู้ - ZICO", "เจาะจงไม่ได้") จะกลายเป็นหัวข้อสีเขียวกางได้
           และ **ตัวเลขทั้งแถวถูกซ่อน** (`emptyVals`). ใช้ "ย่อหน้า" แทน — ทั้งไฟล์ CASH FLOW
           จริงและ AOA ที่เราสร้าง ย่อหน้ารายการย่อย 6 ช่อง / หัวข้อกลุ่ม 1-5 ช่อง */
        const ind = raw.length - raw.replace(/^\s+/, '').length;
        type = ind >= 6 ? 'leaf' : (ind > 0 ? 'group' : (hasVal ? 'leaf' : 'group'));
      }
      out.rows.push({ label, vals, total, type, actKey: curAct });
    }
    return out;
  }

  /* ⚠️ ข้อมูลเก่าที่อัปไว้ก่อนแก้บั๊ก BE serial มี `iso` เป็นปี พ.ศ. ("2569-05-05")
     ⇒ เดือนไม่ตรงกับข้อมูลใหม่ (2026-05), เรียงลำดับผิด, ป้ายเดือนเพี้ยน.
     ยุบเป็น ค.ศ. ทุกทางที่อ่านเข้ามา — ทั้งตอนสร้าง model และตอน merge ที่หน้า #cf_coding */
  function cfpFixEraIso(iso) {
    const s = String(iso || '');
    const y = +s.slice(0, 4);
    return (y > 2400) ? String(y - 543) + s.slice(4) : s;
  }
  function cfpFixEraTxns(txns) {
    let n = 0;
    const out = (txns || []).map(t => {
      const iso = cfpFixEraIso(t.iso);
      if (iso === t.iso) return t;
      n++;
      return Object.assign({}, t, { iso, month: cfpMonth(iso) });
    });
    if (n) console.warn('[cfp] แปลงวันที่ พ.ศ. → ค.ศ. ' + n + ' รายการ (ข้อมูลเก่าก่อนแก้บั๊ก)');
    return out;
  }

  /* ═════════════════════════════════════════════════════════════════════
   * ส่วนที่ 2 — หน้าจอชุดเดียวกับหน้า "งบกระแสเงินสด" ของ Water POG (ต้นทาง = execdash ของเว็บ Benya)
   * ─────────────────────────────────────────────────────────────────────
   *  ผู้ใช้ขอ (2026-11-25) "ปรับแก้รูปแบบหน้างบกระแสเงินสดให้เหมือนของป๊อก ยกเว้นเรื่องสี ขอโทนสีเหมือนเดิม"
   *  โค้ดวาดหน้า (ed*) ยกมาจากไฟล์ของ POG (สร้าง HTML เป็นข้อความ + onclick) — ★ POG = จุดที่ POG แก้จาก Benya,
   *  ★ BIO = จุดที่ BIO ต่างจาก POG (สีเขียว BIO · ชื่อบริษัท · ข้อความอัปไฟล์ · ซ่อนคอลัมน์รหัส · cfpToEd)
   *  ข้อมูลมาจากตัวอ่าน BIO (ส่วนที่ 1) → แปลงเป็นรูปข้อมูลของหน้าด้วย cfpToEd
   *  ★ ปุ่ม/ลิงก์ในหน้าเรียกผ่าน window.CfpEd.<ชื่อฟังก์ชัน> (ชื่อเดียวที่ออกไป global)
   *  ★ BIO: โทนสี = เขียว BIO ของหน้าเดิม (รับ #15c486 · จ่าย #fb5e6d · หลัก #2e8b4a · กิจกรรม เขียว/ส้ม/ม่วง)
   * ═════════════════════════════════════════════════════════════════════ */
  const CED_CHART_SRC = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js';
  const CED_CHART_SRI = 'sha384-dug+JxfBvklEQdJ4AYuBBAIScUz0bVN73xpy273gcAwHjb3qI0fXmuYNaNfdyYJG';
  const CED_UI_LS = 'bio-cfp-ed-ui';
  // ค่าที่โค้ดวาดหน้าอ่าน (state.company / COMPANIES / TOOLS) — id 'mbark' เหลือไว้ให้โค้ดเดิมทำงานเหมือน POG (สีจริงกำหนดใน ED_COLORS/CSS)
  const state = { company: 'mbark' };
  const COMPANIES = [{ id: 'mbark', name: 'BIOAXEL', fullName: 'บริษัท ไบโอแอ็กซ์เซล จำกัด', brand: 'BIOAXEL Co., Ltd.',
    logo: 'bioaxel_logo.png', logoIcon: 'bioaxel_logo.png', gradient: ['#1f7d46', '#34a86e'] }];
  const TOOLS = [{ id: 'execdash', name: 'งบกระแสเงินสด' }];
  // ★ BIO: โทนสีเดิมของหน้า BIO (ผู้ใช้ขอ 2026-11-25 "ยกเว้นเรื่องสี ขอโทนสีเหมือนเดิม") — รับ = เขียว · จ่าย = แดงชมพู · กิจกรรม เขียว/ส้ม/ม่วง
  const ED_COLORS = { brand: '#2e8b4a', brand2: '#a3d4b3', bg: '#eef6f1', in: '#15c486', out: '#fb5e6d', neutral: '#94A3B8', op: '#2e8b4a', inv: '#e08a3c', fin: '#9b7bff' };
  const ED_TABS = [
    { id: 'summary', l: 'Executive Summary' },
    { id: 'category', l: 'Category Analysis' },
    { id: 'banks', l: 'Bank Accounts' },
    { id: 'explorer', l: 'Transaction Explorer' },
    { id: 'stmt', l: 'งบกระแสเงินสด' },
  ];
  const CED = { host: null, target: null, canEdit: false, canSync: false, uploading: false, shareBusy: false, era: 'auto', printAll: false, hooks: {}, ui: null };
  CED.ui = (function () {
    const u = { data: null, tab: 'summary', monthFilter: 'all', explorer: { q: '', acct: 'all', act: 'all', dir: 'all', sort: 'date', desc: true }, stmtAcct: 'all', stmtTall: false, pdfOrient: 'landscape' };
    try {
      const s = JSON.parse(localStorage.getItem(CED_UI_LS) || 'null');
      if (s) {
        ['tab', 'monthFilter', 'stmtAcct', 'pdfOrient'].forEach(k => { if (typeof s[k] === 'string') u[k] = s[k]; });
        u.stmtTall = !!s.stmtTall;
        if (s.explorer && typeof s.explorer === 'object') Object.assign(u.explorer, s.explorer);
      }
    } catch (e) { }
    return u;
  })();
  function edState() { return CED.ui; }
  function edSave() {
    try { const u = CED.ui; localStorage.setItem(CED_UI_LS, JSON.stringify({ tab: u.tab, monthFilter: u.monthFilter, explorer: u.explorer, stmtAcct: u.stmtAcct, stmtTall: u.stmtTall, pdfOrient: u.pdfOrient })); } catch (e) { }
  }
  function edContentEl() { return CED.target || document.getElementById('edContent'); }
  function esc(v) { return (v == null ? '' : String(v)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()); }
  function download(content, filename, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime || 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  // ไอคอนปุ่ม (Benya ใช้ lucide — POG ไม่มี lucide จึงฝังเส้น SVG ชุดเดียวกันเอง)
  const ED_ICONS = {
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
    'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  };
  function edIco(n) { return '<svg class="ed-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ED_ICONS[n] || '') + '</svg>'; }
  // ค่าใช้จ่ายพนักงาน (KPI) — ★ POG: "ค่าจ้างเหมา…" = ค่าผู้รับเหมาติดตั้ง ไม่ใช่เงินเดือน → ไม่นับ
  function edIsPayrollCat(k) { return /เงินเดือน|ค่าจ้าง|พนักงาน|salary|wage/i.test(k) && !/จ้างเหมา/.test(k); }
  // เลขบัญชีแบบสั้นในตาราง — ★ POG: "···1234" (Benya ตัดเหลือ 5 ตัวท้าย)
  function edNoShort(no) { const dg = String(no || '').replace(/\D/g, ''); return dg ? '···' + dg.slice(-4) : String(no || ''); }
  function edHook(name, v) { const h = CED.hooks && CED.hooks[name]; if (typeof h === 'function') h(v); }
  /* ข้อมูล BIO (stm จากไฟล์ STM / ชีต "รวมทุกบัญชี" / หน้า #cf_coding) → รูปข้อมูลของหน้าแบบ POG (ed*)
   *   transactions: { date, dateISO, month:'YYYY.MM', in, out, category, activityKey, isTransfer, accountKey, bank, accountNo, accountNick, ref, mne, note, balance }
   *   accounts[k].months['YYYY.MM'] = { opening, closing } · months = [{ key, accounts:[{accountKey, opening, closing, computed}] }]
   *   ★ BIO: ป้ายบัญชี "KBANK ···1234 · ชื่อบัญชี" (cfpAccountLabel) → bank / no (เลขเต็มจากทะเบียนบัญชีถ้ามี) / nick = ชื่อบัญชี
   *   ★ BIO: ต้นงวดรายบัญชี = stm.openingByAcct (ยอดยกมา / ยอดคงเหลือแถวแรก − รายการแรก) แล้วเดินยอดทีละเดือนด้วย
   *     รายการทุกชนิด (รวมโอนระหว่างบัญชี เพราะกระทบเงินในบัญชีจริง) = วิธีเดียวกับยอดรายบัญชีของหน้าเดิม
   *     (cfpBuildModel.accountInfo) · ไฟล์ STM ไม่มีชีตยอดรายเดือนแบบ POG
   *   ★ BIO: เดือน = ปี-เดือนจากวันที่จริงของรายการ (ข้อมูลข้ามปีได้) · ไม่มีรหัสค่าใช้จ่าย → hasMne=false (ซ่อนคอลัมน์ "รหัส") */
  function cfpToEd(stm, fullNoByTail) {
    const txns = cfpFixEraTxns(Array.isArray(stm && stm.txns) ? stm.txns : []);
    const ACT = { op: 'operating', inv: 'investing', fin: 'financing' };
    const ACT_TH = { op: 'กิจกรรมดำเนินงาน', inv: 'กิจกรรมลงทุน', fin: 'กิจกรรมจัดหาเงิน', transfer: 'โอนระหว่างบัญชี', other: 'อื่น ๆ' };
    const mkOf = iso => /^\d{4}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 4) + '.' + String(iso).slice(5, 7) : '';
    const splitMemo = {};
    const split = nm => {
      if (splitMemo[nm]) return splitMemo[nm];
      const s = String(nm || '');
      const m = s.match(/^(.*?)\s*···\s*(\d+)\s*(?:·\s*(.*))?$/);
      const out = m
        ? { bank: (m[1] || '').trim() || 'บัญชี', no: (fullNoByTail && fullNoByTail[m[2]]) || ('···' + m[2]), nick: (m[3] || '').trim() }
        : { bank: s || 'บัญชี', no: '', nick: '' };
      return (splitMemo[nm] = out);
    };
    const openBy = (stm && stm.openingByAcct && typeof stm.openingByAcct === 'object') ? stm.openingByAcct : {};
    const mset = {};
    txns.forEach(t => { const k = mkOf(t.iso); if (k) mset[k] = true; });
    const monthKeys = Object.keys(mset).sort();
    const flowAM = {};   // บัญชี → เดือน → ยอดสุทธิทุกรายการ (รวมโอน)
    txns.forEach(t => {
      const mk = mkOf(t.iso); if (!mk) return;
      const row = flowAM[t.account] || (flowAM[t.account] = {});
      row[mk] = (row[mk] || 0) + (Number(t.flow) || 0);
    });
    const r2 = v => Math.round(v * 100) / 100;
    const accounts = {};
    const names = Object.keys(openBy).concat(Object.keys(flowAM).filter(k => !Object.prototype.hasOwnProperty.call(openBy, k)));
    names.forEach(name => {
      const sp = split(name);
      const acc = { bank: sp.bank, no: sp.no, nick: sp.nick, months: {}, lastClose: 0 };
      let started = Object.prototype.hasOwnProperty.call(openBy, name);
      let run = cfpNum(openBy[name]);
      monthKeys.forEach(mk => {
        const fl = (flowAM[name] || {})[mk] || 0;
        if (!started && !fl) return;   // บัญชีที่ยังไม่มีทั้งยอดยกมาและรายการ = ยังไม่เริ่ม
        started = true;
        const open = run, close = run + fl;
        acc.months[mk] = { opening: r2(open), closing: r2(close), computed: r2(close) };
        run = close;
      });
      const ks = Object.keys(acc.months).sort();
      if (!ks.length) return;
      acc.lastClose = acc.months[ks[ks.length - 1]].closing;
      accounts[name] = acc;
    });
    const run = {};
    const order = txns.map((t, i) => ({ t, i })).sort((x, y) => (x.t.iso < y.t.iso ? -1 : x.t.iso > y.t.iso ? 1 : x.i - y.i));
    const transactions = [];
    order.forEach(({ t }) => {
      const mk = mkOf(t.iso); if (!mk) return;
      const k = t.account, sp = split(k), flow = Number(t.flow) || 0;
      if (!(k in run)) run[k] = cfpNum(openBy[k]);
      run[k] += flow;
      transactions.push({
        date: new Date(t.iso), dateISO: t.iso || '', month: mk,
        in: flow > 0 ? flow : 0, out: flow < 0 ? -flow : 0,
        category: t.category || '(ไม่ระบุหมวด)', activityKey: ACT[t.actKey] || 'other', activity: ACT_TH[t.actKey] || ACT_TH.other,
        isTransfer: t.actKey === 'transfer',
        accountKey: k, bank: sp.bank, accountNo: sp.no, accountNick: sp.nick,
        ref: t.docNo || '', mne: '', code: '', note: t.note || '', payee: '', status: '',
        balance: r2(run[k]),
      });
    });
    const months = monthKeys.map(key => ({
      key, accounts: Object.keys(accounts).filter(k => accounts[k].months[key]).map(k => Object.assign({ accountKey: k }, accounts[k].months[key])),
    }));
    return { company: 'BIOAXEL', transactions, accounts, months, hasMne: transactions.some(t => t.mne) };
  }

  /* โหลด Chart.js ตอนเปิดหน้านี้ครั้งแรก (หน้าอื่นไม่ต้องโหลด) — เวอร์ชันเดียวกับเว็บ Benya */
  let _edChartP = null;
  function edLoadChart() {
    if (window.Chart) return Promise.resolve();
    if (_edChartP) return _edChartP;
    _edChartP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = CED_CHART_SRC; s.integrity = CED_CHART_SRI; s.crossOrigin = 'anonymous';
      s.onload = () => res(); s.onerror = () => { _edChartP = null; rej(new Error('โหลด Chart.js ไม่สำเร็จ')); };
      document.head.appendChild(s);
    });
    return _edChartP;
  }

  /* ปุ่ม "นำเสนอ" = เปิด/ปิดโหมดนำเสนอของแอป (ปุ่มบนแถบบน: เต็มจอ + ไฮไลต์ตามเมาส์ · Esc ออก) */
  function edTogglePresent() {
    const btn = document.querySelector('.present-toggle');
    if (btn) { btn.click(); return; }
    try { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); } catch (e) { }
  }
  /* พิมพ์ PDF — ★ POG ใช้กล่องพิมพ์ของเบราว์เซอร์ (Benya ใช้ html2canvas + jsPDF) · งบกระแสเงินสด = แนวนอนเสมอ */
  function edPrint(all) {
    const d = edState();
    const land = d.pdfOrient !== 'portrait' || (!all && d.tab === 'stmt');
    let st = document.getElementById('ced-print-orient');
    if (!st) { st = document.createElement('style'); st.id = 'ced-print-orient'; document.head.appendChild(st); }
    st.textContent = '@media print{@page{size:A4 ' + (land ? 'landscape' : 'portrait') + ';margin:10mm;}}';
    const prevTitle = document.title;
    const tabName = all ? 'ทั้งรายงาน' : ((ED_TABS.find(t => t.id === d.tab) || {}).l || '');
    try { document.title = 'BIOAXEL_CashFlow_' + edPeriodTag(edScopeMonthKeys(d.data, d.monthFilter)) + (tabName ? '_' + tabName : ''); } catch (e) { }
    const done = () => {
      window.removeEventListener('afterprint', done);
      try { document.title = prevTitle; } catch (e) { }
      if (CED.printAll) { CED.printAll = false; if (CED.host) edRenderDashboard(); }
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), all ? 1200 : 60);
  }
  function edExportFullPDF() { CED.printAll = true; edRenderDashboard(); edPrint(true); }
  const ED_RENDER = {
    summary: () => edRenderSummary(), category: () => edRenderCategory(), banks: () => edRenderBanks(),
    explorer: () => edRenderExplorer(), stmt: () => edRenderStmt(),
  };

  /* ═══════════ โค้ดหน้า Benya (ยกมาจาก fin.benyamedical.com/index.html) ═══════════ */
/* ── Benya index.html 2589–2601 ── */
function edFmt(n){
  if(n==null || isNaN(n)) return "—";
  const v = Number(n);
  const s = Math.abs(v).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});
  return v < 0 ? "(" + s + ")" : s;
}
function edFmtCompact(n){
  if(!n) return "0";
  const v = Math.abs(n);
  if(v >= 1e6) return (n/1e6).toFixed(2) + "M";
  if(v >= 1e3) return (n/1e3).toFixed(1) + "K";
  return n.toFixed(0);
}
/* ── Benya index.html 2647–2714 ── */
function edActivityLabel(k){
  return ({operating:"ดำเนินงาน",investing:"ลงทุน",financing:"จัดหาเงิน",other:"อื่น ๆ"})[k] || k;
}
/* ตรวจว่า transaction เป็น "เงินโอนระหว่างบัญชี" (โอนภายในบริษัทเอง — ไม่ใช่รับ/จ่ายจริง) */
function edIsTransfer(t){
  // ★ POG: ธง isTransfer มาจากตัวอ่านชีต DATA (cfpActKey → "transfer") — ไม่เดาจากชื่อหมวดแบบ Benya
  return !!(t && t.isTransfer);
}
/* helper: รายการเดือน (key "YYYY.MM") ที่อยู่ใน scope ที่เลือก — เรียงจากน้อย→มาก
   monthFilter: "all" (ทุกปี) | "year:2025" (ทั้งปี) | "q:2025:2" (ไตรมาส) | "2025.01" (เดือนเดียว) */
function edScopeMonthKeys(data, monthFilter){
  const keys = (data.months || []).map(m => m.key).sort();
  if(!monthFilter || monthFilter === "all") return keys;
  if(monthFilter.startsWith("year:")){
    const y = monthFilter.slice(5);
    return keys.filter(k => k.slice(0,4) === y);
  }
  if(monthFilter.startsWith("q:")){
    const [,y,q] = monthFilter.split(":"); const qn = Number(q);
    return keys.filter(k => k.slice(0,4) === y && Math.ceil(Number(k.slice(5,7))/3) === qn);
  }
  return keys.filter(k => k === monthFilter);
}
/* helper: ป้ายชื่อ scope ที่อ่านง่าย (ใช้ใน drill/หัวข้อ) */
function edScopeLabel(monthFilter){
  if(!monthFilter || monthFilter === "all") return "รวมทุกเดือน";
  if(monthFilter.startsWith("year:")) return "ปี " + (Number(monthFilter.slice(5)) + 543);
  if(monthFilter.startsWith("q:")){ const [,y,q] = monthFilter.split(":"); return "ไตรมาส " + q + "/" + (Number(y) + 543); }
  return edThaiMonth(monthFilter);
}
/* helper: ยอดเปิดต้น/ปิดปลายของ scope (รองรับ all/ปี/เดือน) — ต่อบัญชี: เปิด=เดือนแรกที่มีใน scope, ปิด=เดือนสุดท้าย */
function edOpenClose(data, monthFilter){
  const scope = edScopeMonthKeys(data, monthFilter);
  let opening = 0, closing = 0;
  if(!scope.length) return { opening, closing };
  for(const k in data.accounts){
    const acc = data.accounts[k];
    for(const mk of scope){ if(acc.months[mk]){ opening += acc.months[mk].opening || 0; break; } }
    for(let i = scope.length - 1; i >= 0; i--){ const mk = scope[i]; if(acc.months[mk]){ closing += acc.months[mk].closing || 0; break; } }
  }
  return { opening, closing };
}
/* helper: ดึง txs ตาม scope (month/year + optional exclude transfers) */
function edTxsInScope(data, monthFilter, excludeTransfers){
  let txs = data.transactions;
  if(monthFilter && monthFilter.startsWith("year:")){
    const y = monthFilter.slice(5);
    txs = txs.filter(t => String(t.month).slice(0,4) === y);
  } else if(monthFilter && monthFilter.startsWith("q:")){
    const [,y,q] = monthFilter.split(":"); const qn = Number(q);
    txs = txs.filter(t => String(t.month).slice(0,4) === y && Math.ceil(Number(String(t.month).slice(5,7))/3) === qn);
  } else if(monthFilter !== "all"){
    txs = txs.filter(t => t.month === monthFilter);
  }
  if(excludeTransfers) txs = txs.filter(t => !edIsTransfer(t));
  return txs;
}

/* ---------- Parser ---------- */
/* ── Benya index.html 2959–3027 ── */
/* ---------- Aggregations ---------- */
function edAgg(data, monthFilter, excludeTransfers){
  // monthFilter: "all" หรือ "2026.01" — excludeTransfers=true จะตัด "เงินโอนระหว่างบัญชี" ออก
  const txs = edTxsInScope(data, monthFilter, !!excludeTransfers);

  const totalIn  = txs.reduce((s,t)=>s+t.in, 0);
  const totalOut = txs.reduce((s,t)=>s+t.out, 0);
  const net = totalIn - totalOut;

  // opening/closing for the period (รองรับ ทุกปี / ทั้งปี / เดือนเดียว)
  const oc = edOpenClose(data, monthFilter);
  let opening = oc.opening, closing = oc.closing;

  // by activity
  const byAct = { operating:{in:0,out:0}, investing:{in:0,out:0}, financing:{in:0,out:0}, other:{in:0,out:0} };
  for(const t of txs){
    byAct[t.activityKey].in  += t.in;
    byAct[t.activityKey].out += t.out;
  }

  // by category
  const byCat = {};
  for(const t of txs){
    const k = t.category;
    if(!byCat[k]) byCat[k] = { in:0, out:0, count:0, net:0 };
    byCat[k].in  += t.in;
    byCat[k].out += t.out;
    byCat[k].count++;
    byCat[k].net = byCat[k].in - byCat[k].out;
  }

  // by bank account
  const byAcct = {};
  for(const t of txs){
    const k = t.accountKey;
    if(!byAcct[k]) byAcct[k] = { bank:t.bank, no:t.accountNo, nick:t.accountNick, in:0, out:0, count:0, net:0 };
    byAcct[k].in  += t.in;
    byAcct[k].out += t.out;
    byAcct[k].count++;
    byAcct[k].net = byAcct[k].in - byAcct[k].out;
  }

  // by month timeline
  const byMonth = {};
  for(const t of txs){
    if(!byMonth[t.month]) byMonth[t.month] = { in:0, out:0, op:{in:0,out:0}, inv:{in:0,out:0}, fin:{in:0,out:0} };
    byMonth[t.month].in += t.in;
    byMonth[t.month].out += t.out;
    const ak = t.activityKey==="other" ? "op" : ({operating:"op",investing:"inv",financing:"fin"})[t.activityKey];
    if(byMonth[t.month][ak]){
      byMonth[t.month][ak].in  += t.in;
      byMonth[t.month][ak].out += t.out;
    }
  }

  return { txs, totalIn, totalOut, net, opening, closing, byAct, byCat, byAcct, byMonth };
}

/* ---------- Chart helpers ---------- */
const _edCharts = {};
function edDestroyChart(id){
  if(_edCharts[id]){ try{ _edCharts[id].destroy(); }catch(e){} delete _edCharts[id]; }
}
function edMakeChart(id, cfg){
  edDestroyChart(id);
  const el = document.getElementById(id);
  if(!el || !window.Chart) return;
  _edCharts[id] = new Chart(el.getContext("2d"), cfg);
}
/* ── Benya index.html 3051–3101 ── */
/* plugin: % กลางชิ้นโดนัท */
const edDonutPctPlugin = {
  id:"edDonutPct",
  afterDatasetsDraw(chart){
    const ctx = chart.ctx;
    const ds = chart.data.datasets[0]; if(!ds) return;
    const meta = chart.getDatasetMeta(0);
    const total = ds.data.reduce((s,v)=>s+(Number(v)||0),0);
    if(!total) return;
    const ca = chart.chartArea;
    ctx.save();
    ctx.font = "700 12px 'IBM Plex Sans','IBM Plex Sans Thai',sans-serif";   // ★ ฟอนต์เท่ากันทุกป้าย
    ctx.textBaseline = "middle";
    const small = [];   // ชิ้นเล็กใส่ในวงไม่ได้ → เก็บไว้ทำเส้นโยงออกข้างวง
    meta.data.forEach((arc, i) => {
      const pct = (Number(ds.data[i])||0)/total*100;
      if(pct < 0.05) return;               // 0.0% จริงๆ ข้าม
      const p = arc.getProps(['x','y','startAngle','endAngle','outerRadius','innerRadius'], true);
      const mid = (p.startAngle + p.endAngle)/2;
      if(pct >= 12){                        // ชิ้นใหญ่ → % กลางชิ้น (ขาว)
        ctx.fillStyle = "#fff"; ctx.textAlign = "center";
        const r = (p.innerRadius + p.outerRadius)/2;
        ctx.fillText(Math.round(pct)+"%", p.x + Math.cos(mid)*r, p.y + Math.sin(mid)*r);
      } else {                              // ชิ้นเล็ก → เส้นโยงออกข้าง
        small.push({ pct, mid, p, col:(Array.isArray(ds.backgroundColor)?ds.backgroundColor[i]:ds.backgroundColor)||"#64748b",
          side: Math.cos(mid) >= 0 ? 1 : -1, ay: p.y + Math.sin(mid)*p.outerRadius });
      }
    });
    // แยกซ้าย/ขวา · เรียงบน→ล่าง · กันป้ายซ้อน (≥15px) · clamp อยู่ในกรอบ (ไม่ชนขอบ)
    [1,-1].forEach(side => {
      const arr = small.filter(o=>o.side===side).sort((a,b)=>a.ay-b.ay);
      let prevY = -Infinity; const gap = 15;
      arr.forEach(o => {
        let ly = o.ay;
        if(ly < ca.top + 8) ly = ca.top + 8;
        if(ly < prevY + gap) ly = prevY + gap;
        if(ly > ca.bottom - 8) ly = ca.bottom - 8;
        prevY = ly;
        const ex = o.p.x + Math.cos(o.mid)*o.p.outerRadius;   // ขอบนอกชิ้น
        const ey = o.p.y + Math.sin(o.mid)*o.p.outerRadius;
        const kneeX = o.p.x + side*(o.p.outerRadius + 8);
        const labelX = o.p.x + side*(o.p.outerRadius + 26);
        ctx.strokeStyle = o.col; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(kneeX,ly); ctx.lineTo(labelX,ly); ctx.stroke();
        ctx.fillStyle = o.col; ctx.textAlign = side>0 ? "left" : "right";
        ctx.fillText((o.pct<1?o.pct.toFixed(1):Math.round(o.pct))+"%", labelX + side*3, ly);
      });
    });
    ctx.restore();
  }
};
/* ── Benya index.html 3431–3493 ── */
function edSetTab(tab){ edState().tab = tab; edSave(); edRenderDashboard(); }
function edSetMonth(m){ edState().monthFilter = m; edSave(); edRenderDashboard(); }

/* ปุ่มเลือกช่วงเวลา — กดเลือกปี (หรือรวมทุกปี) แล้วกดเลือกไตรมาส (แทน dropdown เดิม) */
function edPeriodPicker(data, mf){
  const years = [...new Set((data.months||[]).map(m => m.key.slice(0,4)))].sort();
  if(!years.length) return "";
  const multi = years.length > 1;

  // ปีที่กำลังโฟกัส
  let actYear = null;
  if(mf && mf.startsWith("year:")) actYear = mf.slice(5);
  else if(mf && mf.startsWith("q:")) actYear = mf.split(":")[1];
  else if(mf && /^\d{4}\./.test(mf)) actYear = mf.slice(0,4);
  if(!multi) actYear = years[0];   // ปีเดียว → โฟกัสปีนั้นเสมอ (โชว์ไตรมาสได้เลย)

  const btn = (active, val, label, sub) => `<button onclick="CfpEd.edSetMonth('${val}')" style="padding:6px 13px;border-radius:8px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;border:1px solid ${active?'var(--brand)':'#bfe6cb'};background:${active?'var(--brand)':'#fff'};color:${active?'#fff':'#0f172a'};transition:.12s;line-height:1.2;text-align:center">${label}${sub?`<span style="display:block;font-size:9.5px;font-weight:500;opacity:.82">${sub}</span>`:''}</button>`;

  // แถวปี
  let yearBtns = "";
  if(multi){
    yearBtns += btn(mf==='all', 'all', `รวม ${years.length} ปี`);
    yearBtns += years.map(y => btn(actYear===y, 'year:'+y, 'ปี '+(Number(y)+543))).join("");
  } else {
    yearBtns += btn(mf==='all', 'all', 'ทั้งปี '+(Number(years[0])+543));
  }

  // ไตรมาส (chips เท่านั้น — label อยู่ใน section)
  let qChips = "", qLabel = "";
  if(actYear){
    const moy = (data.months||[]).filter(m => m.key.slice(0,4)===actYear).map(m => Number(m.key.slice(5,7)));
    const wholeVal = multi ? 'year:'+actYear : 'all';
    const QS = [[1,'Q1','ม.ค.–มี.ค.'],[2,'Q2','เม.ย.–มิ.ย.'],[3,'Q3','ก.ค.–ก.ย.'],[4,'Q4','ต.ค.–ธ.ค.']];
    const has = q => moy.some(m => Math.ceil(m/3)===q);
    qLabel = `ไตรมาส · ปี ${Number(actYear)+543}`;
    qChips = btn(mf===wholeVal, wholeVal, 'ทั้งปี') + QS.filter(q => has(q[0])).map(q => btn(mf==='q:'+actYear+':'+q[0], 'q:'+actYear+':'+q[0], q[1], q[2])).join("");
  }

  // เดือน (chips เท่านั้น) — เลือกเดือนเดียวได้ (mf = "YYYY.MM")
  let mChips = "", mLabel = "";
  if(actYear){
    const TH_MON_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const mList = [...new Set((data.months||[]).filter(m => m.key.slice(0,4)===actYear).map(m => Number(m.key.slice(5,7))))].sort((a,b)=>a-b);
    if(mList.length){
      mLabel = `เดือน · ปี ${Number(actYear)+543}`;
      mChips = mList.map(m => { const key = actYear+'.'+String(m).padStart(2,'0'); return btn(mf===key, key, TH_MON_SHORT[m-1]); }).join("");
    }
  }

  // ★ การ์ดเดียว สะอาดตา — 3 ส่วนเรียงข้างกัน (ช่วงเวลา | ไตรมาส | เดือน) คั่นด้วยเส้น
  const section = (label, chips) => `<div style="display:flex;flex-direction:column;gap:7px;min-width:0">
    <span style="font-size:10.5px;color:var(--ink-3);font-weight:700;letter-spacing:.3px">${label}</span>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${chips}</div>
  </div>`;
  const divider = `<div style="width:1px;align-self:stretch;background:var(--glass-border,#e1efe7);flex-shrink:0"></div>`;
  const parts = [section('ช่วงเวลา', yearBtns)];
  if(qChips) parts.push(divider, section(qLabel, qChips));
  if(mChips) parts.push(divider, section(mLabel, mChips));

  return `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;background:#fff;border:1px solid var(--glass-border,#e1efe7);border-radius:12px;padding:12px 16px;box-shadow:0 1px 3px rgba(15,23,42,.05)">${parts.join("")}</div>`;
}

/* ===== โหมดนำเสนอ (present mode) — เต็มจอ + ไฮไลต์ตามเมาส์ ===== */
/* ── Benya index.html 3625–3657 ── */
/* ---------- Print / PDF helpers ---------- */
const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const TH_MON_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
function edThaiMonth(key){
  // key = "2026.05" → "พฤษภาคม 2569"
  const [y,m] = key.split(".").map(Number);
  return TH_MONTHS[m-1] + " " + (y+543);
}
function edPeriodLabel(data, monthFilter){
  if(!data || !data.months.length) return "—";
  if(monthFilter && monthFilter.startsWith("year:")){
    return "ข้อมูลปี " + (Number(monthFilter.slice(5)) + 543);
  }
  if(monthFilter && monthFilter.startsWith("q:")){
    const [,y,q] = monthFilter.split(":"); return "ข้อมูลไตรมาส " + q + " ปี " + (Number(y) + 543);
  }
  if(monthFilter !== "all"){
    return "ข้อมูลของเดือน " + edThaiMonth(monthFilter);
  }
  const first = data.months[0].key;
  const last  = data.months[data.months.length-1].key;
  if(first === last) return "ข้อมูลของเดือน " + edThaiMonth(first);
  return "ข้อมูลของเดือน " + edThaiMonth(first).split(" ")[0] + "–" + edThaiMonth(last);
}
function edNowStr(){
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = TH_MONTHS[d.getMonth()];
  const yy = d.getFullYear() + 543;
  const hh = String(d.getHours()).padStart(2,"0");
  const mi = String(d.getMinutes()).padStart(2,"0");
  return `${dd} ${mm} ${yy} เวลา ${hh}:${mi} น.`;
}
/* ── Benya index.html 4166–4853 ── */
/* ---------- Render dashboard with 6 tabs ---------- */
function edRenderDashboard(){
  const t = TOOLS.find(x=>x.id==="execdash");
  const co = COMPANIES.find(c=>c.id===state.company);
  const d = edState();
  const data = d.data;
  const main = CED.host;   // ★ POG: วาดลงกล่องที่ React เตรียมไว้ (แทน #main ของ Benya)
  if(!main) return;
  const canEditExec = CED.canEdit;   // ★ POG: คนที่แก้ข้อมูลได้ (ผู้บริหาร/ผู้นำเสนอ = ดูอย่างเดียว ไม่เห็นปุ่มอัปโหลด/ล้าง)

  // กัน scope ค้าง: ถ้าปี/เดือนที่เลือกไม่มีในข้อมูลแล้ว → กลับไป "ทุกปี"
  if(d.monthFilter && d.monthFilter !== "all" && !edScopeMonthKeys(data, d.monthFilter).length){
    d.monthFilter = "all";
  }

  // ทำลาย charts เก่าก่อน re-render
  Object.keys(_edCharts).forEach(edDestroyChart);

  const tabs = ED_TABS;

  const curTab = CED.printAll ? { l:"รายงานงบกระแสเงินสด (ทุกหัวข้อ)" } : (tabs.find(x=>x.id===d.tab) || tabs[0]);

  main.innerHTML = `
    <div class="ed-page">
      <div id="printHeader">
        <div class="ph-row">
          <div class="ph-co">
            <img class="ph-logo" src="${esc(co.logoIcon||co.logo)}" onerror="this.style.display='none'">
            <div>
              <div class="ph-co-name">${esc(co.fullName||co.name)}</div>
              <div class="ph-co-sub">${esc(co.brand||'')}</div>
            </div>
          </div>
          <div class="ph-meta">
            <div class="ph-title">${esc(curTab.l)}</div>
            <div class="ph-period">${esc(edPeriodLabel(data, d.monthFilter))}</div>
            <div class="ph-ts">พิมพ์เมื่อ ${edNowStr()} · ${esc(cfpCurrentUser()||'')} · หน่วย: บาท</div>
          </div>
        </div>
      </div>

      <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:14px">
          <img src="${esc(co.logo)}" onerror="this.style.display='none'" style="width:40px;height:40px;object-fit:contain;border-radius:8px">
          <div>
            <h1>${t.name} <span class="badge">${esc(co.name)}</span></h1>
            <div class="sub"><span style="color:var(--ink-3)">หน่วย: บาท</span></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select class="ed-hide-present" onchange="CfpEd.edState().pdfOrient=this.value;CfpEd.edSave()" title="แนวกระดาษตอนพิมพ์ PDF" style="padding:7px 10px;border:1px solid #bfe6cb;border-radius:8px;font-size:13px;background:#fff;font-family:inherit;color:#0f172a">
            <option value="landscape" ${d.pdfOrient!=='portrait'?'selected':''}>📄 แนวนอน (หลายหน้า)</option>
            <option value="portrait" ${d.pdfOrient==='portrait'?'selected':''}>📐 แนวตั้ง</option>
          </select>
          <button class="btn ghost btn sm ed-hide-present" onclick="CfpEd.edTogglePresent()" title="โหมดนำเสนอเต็มจอ + ไฮไลต์ตามเมาส์ (กด Esc เพื่อออก)">${edIco("monitor")}นำเสนอ</button>
          <button class="btn ghost btn sm ed-hide-present" onclick="CfpEd.edPrint()" title="พิมพ์เฉพาะหัวข้อที่เปิดอยู่">${edIco("printer")}พิมพ์ PDF</button>
          <button class="btn ghost btn sm ed-hide-present" onclick="CfpEd.edExportFullPDF()" title="รวมทั้ง 5 หัวข้อเป็น PDF ไฟล์เดียว">${edIco("file-text")}ทั้งรายงาน</button>
          ${canEditExec ? `
          ${CED.canSync ? `<button class="btn ghost btn sm ed-hide-present" onclick="CfpEd.edHook('refresh')" ${CED.shareBusy?'disabled':''} title="ดึงข้อมูลส่วนกลางล่าสุด (ที่คนอื่นอัปไว้)">${edIco("refresh-cw")}${CED.shareBusy?'กำลังโหลด…':'โหลดล่าสุด'}</button>` : ""}
          <select class="ed-hide-present" onchange="CfpEd.edHook('era', this.value)" title="ปีในไฟล์ข้อมูล (พ.ศ./ค.ศ.)" style="padding:7px 10px;border:1px solid #bfe6cb;border-radius:8px;font-size:13px;background:#fff;font-family:inherit;color:#0f172a">
            <option value="auto" ${CED.era==='auto'?'selected':''}>ปีในไฟล์: อัตโนมัติ</option>
            <option value="be" ${CED.era==='be'?'selected':''}>ไฟล์เป็น พ.ศ.</option>
            <option value="ce" ${CED.era==='ce'?'selected':''}>ไฟล์เป็น ค.ศ.</option>
          </select>
          <button class="btn ed-hide-present" onclick="CfpEd.edHook('upload')" ${CED.uploading?'disabled':''} style="background:linear-gradient(135deg,#10b981,#059669);border:none" title="อัปไฟล์ STM รายการเดินบัญชี (+ งบกระแสเงินสดสรุป) — เลือกได้หลายไฟล์ · แทนชุดเดิมทั้งหมด">${edIco("plus")}${CED.uploading?'กำลังอ่าน…':'อัปเดตไฟล์'}</button>
          <button class="btn ghost btn sm ed-hide-present" onclick="CfpEd.edHook('clear')" title="ล้างข้อมูลทั้งหมดแล้วเริ่มอัปใหม่">${edIco("rotate-ccw")}ล้าง &amp; เริ่มใหม่</button>` : ""}
        </div>
      </div>
      <!-- ★ ตัวเลือกช่วงเวลา = แถวของตัวเอง (กันดันปุ่มนำเสนอ/พิมพ์ เวลาแถวเดือนโผล่) -->
      <div class="ed-period" style="margin:2px 0 14px">${edPeriodPicker(data, d.monthFilter)}</div>

      <div class="ed-tabs">
        ${tabs.map(tb => `<button class="${d.tab===tb.id?'active':''}" onclick="CfpEd.edSetTab('${tb.id}')">${tb.l}</button>`).join("")}
      </div>

      <div id="edContent"></div>
    </div>
  `;

  if(d.tab!=="summary" && d.tab!=="category" && d.tab!=="banks" && d.tab!=="explorer" && d.tab!=="stmt") d.tab="summary";  // กันแท็บเก่า (activity) ค้าง
  if(CED.printAll){
    // ★ POG: "ทั้งรายงาน" = วาดครบ 5 หัวข้อต่อกัน (ขึ้นหน้าใหม่ทุกหัวข้อ) แล้วสั่งพิมพ์ (แทน html2canvas + jsPDF ของ Benya)
    const box = document.getElementById("edContent");
    box.innerHTML = tabs.map(tb => `<section class="ed-print-sec" data-tab="${tb.id}"><h2 class="ed-print-h">${esc(tb.l)}</h2><div class="ed-print-body"></div></section>`).join("");
    tabs.forEach(tb => {
      CED.target = box.querySelector(`[data-tab="${tb.id}"] .ed-print-body`);
      try { ED_RENDER[tb.id](); } finally { CED.target = null; }
    });
  }
  else if(d.tab==="summary")  edRenderSummary();
  else if(d.tab==="category") edRenderCategory();
  else if(d.tab==="banks")    edRenderBanks();
  else if(d.tab==="explorer") edRenderExplorer();
  else if(d.tab==="stmt")     edRenderStmt();

  // ★ ตัวเลขเงินวิ่ง count-up ทุกแท็บ (ข้ามที่ tag data-anim ใน Summary + ข้ามตารางใหญ่)
  if(!CED.printAll) edAnimMoney(edContentEl());
  // ★ โน้ตผู้นำเสนอ (exec_notes.js · แบบ Benya exnMount) — โผล่เฉพาะบัญชีผู้นำเสนอ · บัญชีอื่นไม่มีอะไรเกิดขึ้น
  if(!CED.printAll && typeof window.exnMount === "function"){
    try{ window.exnMount({ root: main, mf: d.monthFilter, year: ((data.months && data.months[0] && data.months[0].key) || "").slice(0,4) }); }catch(e){ console.warn("[cfp] notes", e); }
  }
}

/* ตัวเลขวิ่ง (count-up) — หา element ที่มี data-anim แล้ว animate จาก 0 → ค่าจริง */
function edAnimNums(root){
  root = root || document;
  const els = [...root.querySelectorAll('[data-anim]')];
  if(!els.length) return;
  const fmtOne = (kind, v, to) => {
    if(kind === 'pct') return (to<0?'▼ ':'▲ ') + Math.abs(v).toFixed(1) + '%';
    return edFmt(v);   // money (มี () สำหรับติดลบอยู่แล้ว)
  };
  const dur = 650, start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    for(const el of els){
      const to = parseFloat(el.dataset.to) || 0;
      el.textContent = fmtOne(el.dataset.anim, to * e, to);
    }
    if(t < 1) requestAnimationFrame(step);
    else for(const el of els){ const to = parseFloat(el.dataset.to) || 0; el.textContent = fmtOne(el.dataset.anim, to, to); }
  };
  requestAnimationFrame(step);
}

/* auto count-up เลขเงินทุก cell ในหน้า (แท็บอื่นที่ไม่ได้ tag data-anim)
   จับเฉพาะ pattern เงิน x,xxx.xx (ปี/วันที่/เลขบัญชี/จำนวนรายการ จะไม่โดน) + ข้ามตารางใหญ่กัน jank */
function edAnimMoney(root){
  root = root || document;
  const MONEY = /^\(?-?\d{1,3}(,\d{3})*\.\d{2}\)?$/;
  const items = [];
  for(const el of root.querySelectorAll('td, span, div, b, strong')){
    if(el.children.length) continue;            // leaf เท่านั้น
    if(el.hasAttribute('data-anim')) continue;  // ข้ามที่ทำ count-up อยู่แล้ว
    const t = el.textContent.trim();
    if(!MONEY.test(t)) continue;
    let s = t, neg = false;
    if(s[0] === '('){ neg = true; s = s.slice(1, -1); }
    if(s[0] === '-'){ neg = true; s = s.slice(1); }
    const target = (neg?-1:1) * parseFloat(s.replace(/,/g, ''));
    if(!isFinite(target)) continue;
    items.push({ el, target });
    if(items.length > 300) return;   // ตารางใหญ่เกิน (เช่น Transaction Explorer) → ไม่ animate
  }
  if(!items.length) return;
  const dur = 600, start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    for(const it of items) it.el.textContent = edFmt(it.target * e);
    if(p < 1) requestAnimationFrame(step);
    else for(const it of items) it.el.textContent = edFmt(it.target);
  };
  requestAnimationFrame(step);
}

/* ---------- Tab 1: Executive Summary ---------- */
/* ป้ายช่วงข้อมูลบนหัวการ์ด "ภาพรวมรับ–จ่าย" — ตามช่วงที่เลือก (เดิมนับทุกเดือนในข้อมูล → เลือก ก.ย. ก็ขึ้น "22 เดือน")
   เดือนเดียว = "ก.ย. 2569" · ไตรมาส/ปี/ทั้งหมด = ป้ายช่วง + จำนวนเดือนที่มีข้อมูลในช่วงนั้น */
function edSummaryScopeText(data, monthFilter){
  const mf = monthFilter || "all";
  if(mf !== "all" && !mf.startsWith("year:") && !mf.startsWith("q:")) return edThaiMonthShort(mf);
  return edScopeLabel(mf) + " · " + edScopeMonthKeys(data, mf).length + " เดือน";
}
function edRenderSummary(){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter, true);  // ★ ตัด "เงินโอนระหว่างบัญชี" ออก

  // ===== Hero band (redesign) — ปรับสีตามธีมบริษัท + ติดลบ=แดง =====
  const _co = COMPANIES.find(c=>c.id===state.company) || {gradient:["#1e3a8a","#3b82f6"]};
  const inGrad  = "linear-gradient(140deg,#22c98d,#0f9c67)";   // ★ POG: สีเดิม
  const outGrad = "linear-gradient(140deg,#fb6b78,#e0414f)";
  const heroBg  = "linear-gradient(140deg,#34a86e 0%,#1f7d46 52%,#134d2c 100%)";   // ★ POG: การ์ดเงินสดปลายงวดแบบเดิม
  const _mx = Math.max(A.totalIn, A.totalOut, 1);
  const inW = Math.round(A.totalIn/_mx*100), outW = Math.round(A.totalOut/_mx*100);
  const netNeg = A.net < 0;
  const netAccent = netNeg ? "#fb5e6d" : "#15c486";
  const netChipBg = netNeg ? "#ffe9ec" : "#e2faf0";
  const netChipBd = netNeg ? "#ffd3d9" : "#bfe6cb";
  const netDesc   = netNeg ? "จ่ายมากกว่ารับ — เงินสดลดลงในงวดนี้" : "รับมากกว่าจ่าย — เงินสดเพิ่มขึ้นในงวดนี้";
  const chgPct = A.opening ? ((A.closing - A.opening)/Math.abs(A.opening)*100) : 0;
  const chgNeg = chgPct < 0;
  const acts = [
    { key:"operating", th:"ดำเนินงาน", en:"Operating", net:A.byAct.operating.in-A.byAct.operating.out, desc:"เงินสดจาก/ใช้ในการดำเนินงาน",
      icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="CLR" stroke-width="1.8"/><path d="M19.4 13a7.5 7.5 0 0 0 .1-2l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 0 0-1.7-1l-.3-2.1H9.6l-.3 2.1c-.6.2-1.2.6-1.7 1l-2-.8L3.8 9.7 5.5 11a7.5 7.5 0 0 0 0 2l-1.7 1.3 1.8 3.1 2-.8c.5.4 1.1.8 1.7 1l.3 2.1h4.8l.3-2.1c.6-.2 1.2-.6 1.7-1l2 .8 1.8-3.1L19.4 13Z" stroke="CLR" stroke-width="1.4" stroke-linejoin="round"/></svg>` },
    { key:"investing", th:"ลงทุน", en:"Investing", net:A.byAct.investing.in-A.byAct.investing.out, desc:"ซื้อ/ขายสินทรัพย์ · เงินลงทุน",
      icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 20V9M10 20V5M16 20v-8M22 20V3" stroke="CLR" stroke-width="2" stroke-linecap="round"/></svg>` },
    { key:"financing", th:"จัดหาเงิน", en:"Financing", net:A.byAct.financing.in-A.byAct.financing.out, desc:"เงินกู้ / เพิ่มทุน / จ่ายคืน",
      icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M12 3 3.5 8h17L12 3Z" stroke="CLR" stroke-width="1.7" stroke-linejoin="round"/></svg>` }
  ];
  const actSumAbs = acts.reduce((s,a)=>s+Math.abs(a.net),0) || 1;
  const actCard = a => {
    const neg = a.net < 0;
    const accent = neg ? "#fb5e6d" : "#15c486";
    const softBg = neg ? "#ffe9ec" : "#e2faf0";
    const barGrad = neg ? "linear-gradient(180deg,#fb6b78,#fb5e6d)" : "linear-gradient(180deg,#22c98d,#15c486)";
    const prop = Math.round(Math.abs(a.net)/actSumAbs*100);
    return `<div onclick="CfpEd.edDrillActivityIO('${a.key}',null)" style="background:#fff;border:1px solid #e1efe7;border-radius:18px;padding:20px 22px;box-shadow:0 8px 22px rgba(31,42,68,.05);position:relative;overflow:hidden;cursor:pointer;transition:.15s" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 12px 26px rgba(31,42,68,.1)'" onmouseout="this.style.transform='none';this.style.boxShadow='0 8px 22px rgba(31,42,68,.05)'">
      <div style="position:absolute;left:0;top:0;bottom:0;width:5px;background:${accent}"></div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:11px">
          <div style="width:42px;height:42px;border-radius:12px;background:${softBg};display:flex;align-items:center;justify-content:center">${a.icon.replace(/CLR/g,accent)}</div>
          <div><div style="font-size:18px;font-weight:700;color:#1F2A44;white-space:nowrap">${a.th}</div><div style="font-size:13.5px;color:#9AA8BF">${a.en}</div></div>
        </div>
        <span style="background:${softBg};color:${accent};font-size:13px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap">${neg?"จ่ายสุทธิ":"รับสุทธิ"}</span>
      </div>
      <div data-anim="money" data-to="${a.net}" style="font-size:35px;font-weight:700;letter-spacing:-.6px;color:${accent};margin-top:14px">${edFmt(a.net)}</div>
      <div style="margin-top:14px;height:11px;background:#eef6f1;border-radius:7px;box-shadow:inset 0 1px 2px rgba(31,42,68,.1);overflow:hidden">
        <div class="ed-grow" style="position:relative;overflow:hidden;width:${prop}%;height:100%;border-radius:7px;background:${barGrad}"><div class="ed-shim"></div></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px;color:#9AA8BF"><span>${a.desc}</span><span>สัดส่วน ${prop}%</span></div>
    </div>`;
  };

  edContentEl().innerHTML = `
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:18px;margin-bottom:16px">
      <!-- LEFT: ภาพรวมรับ–จ่าย + สุทธิ -->
      <div data-exn="summary.overview" style="background:#fff;border:1px solid #e1efe7;border-radius:20px;padding:22px 24px;box-shadow:0 8px 24px rgba(31,42,68,.05);min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div style="font-size:18px;font-weight:700;color:#3A4A66">ภาพรวมรับ–จ่าย <span style="font-weight:400;color:#9AA8BF;font-size:13px">Cash In–Out Overview</span></div>
          <div style="font-size:13.5px;color:#9AA8BF">${edSummaryScopeText(d.data, d.monthFilter)} · เงินหมุน ${edFmtCompact(A.totalIn+A.totalOut)}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px">
          <div onclick="CfpEd.edDrillSummary('in')" style="cursor:pointer;position:relative;overflow:hidden;border-radius:14px;padding:16px 18px;background:${inGrad};box-shadow:0 8px 18px rgba(15,160,140,.22)">
            <div style="position:absolute;right:-32px;top:-36px;width:128px;height:128px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.28),rgba(255,255,255,0) 70%);pointer-events:none"></div>
            <div style="position:relative;display:flex;align-items:center;gap:8px"><span style="width:9px;height:9px;border-radius:3px;background:#fff"></span><span style="font-size:15px;font-weight:500;color:rgba(255,255,255,.95);white-space:nowrap">เงินรับรวม</span><span style="margin-left:auto;background:rgba(255,255,255,.22);color:#fff;font-size:12.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap">▲ เข้า</span></div>
            <div data-anim="money" data-to="${A.totalIn}" style="position:relative;font-size:34px;font-weight:700;color:#fff;margin-top:8px;letter-spacing:-.6px">${edFmt(A.totalIn)}</div>
            <div style="position:relative;margin-top:12px;height:8px;background:rgba(255,255,255,.28);border-radius:5px;overflow:hidden"><div class="ed-grow" style="width:${inW}%;height:100%;background:rgba(255,255,255,.95);border-radius:5px"></div></div>
          </div>
          <div onclick="CfpEd.edDrillSummary('out')" style="cursor:pointer;position:relative;overflow:hidden;border-radius:14px;padding:16px 18px;background:${outGrad};box-shadow:0 8px 18px rgba(216,80,130,.2)">
            <div style="position:absolute;right:-32px;top:-36px;width:128px;height:128px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.26),rgba(255,255,255,0) 70%);pointer-events:none"></div>
            <div style="position:relative;display:flex;align-items:center;gap:8px"><span style="width:9px;height:9px;border-radius:3px;background:#fff"></span><span style="font-size:15px;font-weight:500;color:rgba(255,255,255,.95);white-space:nowrap">เงินจ่ายรวม</span><span style="margin-left:auto;background:rgba(255,255,255,.22);color:#fff;font-size:12.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap">▼ ออก</span></div>
            <div data-anim="money" data-to="${A.totalOut}" style="position:relative;font-size:34px;font-weight:700;color:#fff;margin-top:8px;letter-spacing:-.6px">${edFmt(A.totalOut)}</div>
            <div style="position:relative;margin-top:12px;height:8px;background:rgba(255,255,255,.28);border-radius:5px;overflow:hidden"><div class="ed-grow" style="width:${outW}%;height:100%;background:rgba(255,255,255,.95);border-radius:5px"></div></div>
          </div>
        </div>
        <div onclick="CfpEd.edDrillSummary('net')" style="cursor:pointer;margin-top:18px;display:flex;align-items:center;gap:16px;background:${netChipBg};border:1px solid ${netChipBd};border-radius:14px;padding:14px 18px">
          <div style="width:40px;height:40px;border-radius:11px;background:${netAccent};display:flex;align-items:center;justify-content:center;flex:none">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M12 19l-6-6M12 19l6-6" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" transform="${netNeg?'':'rotate(180 12 12)'}"/></svg>
          </div>
          <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;color:${netAccent};letter-spacing:.3px">กระแสเงินสดสุทธิ</div><div style="font-size:13.5px;color:#7C8597;margin-top:1px">${netDesc}</div></div>
          <div data-anim="money" data-to="${A.net}" style="font-size:36px;font-weight:700;letter-spacing:-.6px;color:${netNeg?'#fb5e6d':netAccent}">${edFmt(A.net)}</div>
        </div>
      </div>

      <!-- RIGHT: เงินสดปลายงวด hero -->
      <div data-exn="summary.ending" onclick="CfpEd.edDrillOpenClose('closing')" class="ed-glow" style="cursor:pointer;border-radius:20px;padding:24px 26px;color:#fff;position:relative;overflow:hidden;box-shadow:0 14px 36px rgba(31,120,60,.32);background:${heroBg};min-width:0">
        <div class="ed-shine"></div>
        <div style="position:absolute;right:-40px;top:-40px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.07)"></div>
        <div style="position:absolute;right:30px;bottom:-60px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,.05)"></div>
        <div style="position:relative">
          <div style="display:flex;align-items:center;gap:9px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 7h18v12H3z" stroke="rgba(255,255,255,.85)" stroke-width="1.8"/><path d="M3 10h18M16 14h2" stroke="rgba(255,255,255,.85)" stroke-width="1.8" stroke-linecap="round"/></svg><span style="font-size:19px;font-weight:700;color:rgba(255,255,255,.95)">เงินสดปลายงวด <span style="font-weight:400;color:rgba(255,255,255,.6);font-size:13px">Ending Cash</span></span></div>
          <div data-anim="money" data-to="${A.closing}" style="font-size:56px;font-weight:700;letter-spacing:-1.5px;margin-top:12px;line-height:1">${edFmt(A.closing)}</div>
          <div style="font-size:13.5px;color:rgba(255,255,255,.7);margin-top:7px">คงเหลือสุทธิ ณ สิ้นงวด · หน่วย บาท</div>
          <div style="height:1px;background:rgba(255,255,255,.18);margin:18px 0 14px"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div><div style="font-size:14px;color:rgba(255,255,255,.65)">เงินสดต้นงวด</div><div data-anim="money" data-to="${A.opening}" style="font-size:22px;font-weight:600;margin-top:3px">${edFmt(A.opening)}</div></div>
            <svg width="28" height="22" viewBox="0 0 26 20" fill="none"><path d="M2 10h20M22 10l-6-5M22 10l-6 5" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <div style="text-align:right"><div style="font-size:14px;color:rgba(255,255,255,.65)">เปลี่ยนแปลง</div><div data-anim="pct" data-to="${chgPct}" style="font-size:22px;font-weight:700;margin-top:3px;color:${chgNeg?'#ffd3d9':'#c3f0de'}">${chgNeg?'▼':'▲'} ${Math.abs(chgPct).toFixed(1)}%</div></div>
          </div>
        </div>
      </div>
    </div>

    <div data-exn="summary.acts" style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-bottom:16px">
      ${acts.map(actCard).join("")}
    </div>

    <div style="display:grid;grid-template-columns:1.05fr 1fr;gap:18px;margin-bottom:16px">
      ${edCashWaterfall(A, acts)}
      <div data-exn="summary.monthly" class="card" style="margin-bottom:0">
        <h3 style="font-size:18px">📈 กระแสเงินสดรายเดือน <span style="font-weight:400;color:#94a3b8;font-size:13px">Monthly Cash Flow · แยกตามกิจกรรม</span></h3>
        <div style="font-size:12px;color:#94a3b8;margin:-2px 0 8px">บนเส้นศูนย์ = รับสุทธิ · ใต้เส้นศูนย์ = จ่ายสุทธิ · กดแท่งดูรายการ</div>
        <div style="position:relative;height:320px"><canvas id="edActMonthly"></canvas></div>
      </div>
    </div>

    ${edRenderFinKpis(A, d.data, d.monthFilter)}
  `;

  edAnimNums(edContentEl());   // ★ ตัวเลขวิ่ง count-up

  // เดือนใน scope (ใช้กับกราฟแยกกิจกรรม) · ถ้าเลือกปี → เฉพาะเดือนของปีนั้น
  let months = edState().data.months.map(m=>m.key);
  const _mf = edState().monthFilter;
  if(_mf && _mf.startsWith("year:")){ const _y=_mf.slice(5); months = months.filter(k=>k.slice(0,4)===_y); }

  // ── กระแสเงินสดรายเดือน แยกตามกิจกรรม (ย้ายมาจากแท็บ Activity เดิม) ──
  const _actCol = { operating:ED_COLORS.op, investing:ED_COLORS.inv, financing:ED_COLORS.fin };   // ★ POG: สีกิจกรรมแบบเดิม (น้ำเงิน/ส้ม/ม่วง)
  const _actSeries = [
    { label:"ดำเนินงาน", aKey:"operating" },
    { label:"ลงทุน",     aKey:"investing" },
    { label:"จัดหาเงิน", aKey:"financing" },
  ].map(s => ({
    label:s.label, backgroundColor:_actCol[s.aKey], borderRadius:4,
    data: months.map(m => edTxsInScope(edState().data, m, true).reduce((a,t)=> a + (t.activityKey===s.aKey ? (t.in - t.out) : 0), 0))
  }));
  const _actNet = months.map((m,i) => _actSeries.reduce((a,s)=>a+s.data[i], 0));
  edMakeChart("edActMonthly", {
    type:"bar",
    data:{ labels:months, datasets:_actSeries },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:"bottom"}, tooltip:{ callbacks:{ label:c=>c.dataset.label+": "+edFmt(c.parsed.y) } } },
      scales:{
        y:{ ticks:{ callback:v=>edFmtCompact(v) } },
        x:{ ticks:{ callback:(val,idx)=>{ const k=months[idx]; return [ (TH_MON_SHORT[Number(k.slice(5,7))-1]||k)+" "+String(Number(k.slice(0,4))+543).slice(2), "สุทธิ "+edFmtCompact(_actNet[idx]) ]; }, font:{size:12.5} } }
      },
      onClick:(e,els)=>{ if(els && els.length){ edSetMonth(months[els[0].index]); edSetTab("explorer"); } }
    }
  });
}
/* กราฟ Waterfall "เงินสดเดินทางอย่างไร" — ต้นงวด → ดำเนินงาน → ลงทุน → จัดหาเงิน → ปลายงวด
   แท่งกิจกรรมลอย (บวก=เขียว/ลบ=แดง) · แท่งยอดรวมเต็ม (น้ำเงิน) · คลิกแท่งกิจกรรมดูรายการ */
function edCashWaterfall(A, acts){
  const opening = A.opening, closing = A.closing;
  const op = acts[0].net, inv = acts[1].net, fin = acts[2].net;
  let run = opening;
  const steps = [{ label:"ต้นงวด", kind:"total", val:opening, bottom:Math.min(0,opening), top:Math.max(0,opening) }];
  const flow = (label, key, delta) => { const b=Math.min(run,run+delta), t=Math.max(run,run+delta); steps.push({label,key,kind:"flow",delta,bottom:b,top:t}); run+=delta; };
  flow("ดำเนินงาน","operating",op); flow("ลงทุน","investing",inv); flow("จัดหาเงิน","financing",fin);
  steps.push({ label:"ปลายงวด", kind:"total", val:closing, bottom:Math.min(0,closing), top:Math.max(0,closing) });

  const H = 230;
  const hi = Math.max(...steps.map(s=>s.top), 0);
  const lo = Math.min(...steps.map(s=>s.bottom), 0);
  const span = (hi - lo) || 1;
  const y = v => (v - lo) / span * H;                 // ค่า → พิกัดจากล่าง

  const bars = steps.map(s => {
    const barH = Math.max(3, y(s.top) - y(s.bottom));
    const off  = y(s.bottom);
    let grad, valColor, valTxt;
    if(s.kind==="total"){
      grad = "linear-gradient(180deg,#3fa864,#2e8b4a)"; valColor = "#1f6e3a";
      valTxt = "฿" + edFmtCompact(s.val);
    } else {
      const pos = s.delta >= 0;
      grad = pos ? "linear-gradient(180deg,#22c98d,#15c486)" : "linear-gradient(180deg,#fb6b78,#fb5e6d)";
      valColor = pos ? "#15c486" : "#fb5e6d";
      valTxt = (pos?"+":"−") + "฿" + edFmtCompact(Math.abs(s.delta));
    }
    const clickable = s.kind==="flow";
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center">
      <div style="position:relative;width:100%;height:${H}px">
        <div ${clickable?`onclick="CfpEd.edDrillActivity('${s.key}')"`:""} style="position:absolute;left:16%;right:16%;bottom:${off}px;height:${barH}px;background:${grad};border-radius:6px;${clickable?"cursor:pointer":""};box-shadow:0 4px 10px rgba(31,42,68,.12)" ${clickable?`onmouseover="this.style.filter='brightness(1.06)'" onmouseout="this.style.filter='none'"`:""}>
          <span style="position:absolute;top:-22px;left:50%;transform:translateX(-50%);font-size:14px;font-weight:700;white-space:nowrap;color:${valColor}">${valTxt}</span>
        </div>
      </div>
      <div style="margin-top:9px;font-size:13.5px;color:#64748b;font-weight:600;text-align:center">${s.label}${clickable?'<span style="display:block;font-size:11px;color:#a3b3bb;font-weight:500">กดดู ›</span>':''}</div>
    </div>`;
  }).join("");

  return `<div data-exn="summary.acts" class="card" style="margin-bottom:0">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
      <h3 style="font-size:18px">💧 เงินสดเดินทางอย่างไร <span style="font-weight:400;color:#94a3b8;font-size:13px">Cash Flow Waterfall</span></h3>
      <span style="font-size:11.5px;color:#94a3b8;white-space:nowrap;margin-top:5px">กดแท่งกิจกรรมเพื่อดูรายการ</span>
    </div>
    <div style="display:flex;align-items:flex-end;gap:8px;margin-top:28px;padding:0 4px">${bars}</div>
  </div>`;
}
function edTopList(byCat, dir){
  // หักลบรับ-จ่ายในหมวดเดียวกันก่อน (net) → หมวด net บวก = รายรับ · net ลบ = รายจ่าย
  // กันยอดรับเล็กๆ ในหมวดจ่าย (เช่น refund) ไปโผล่ฝั่งรายรับ
  const arr = Object.entries(byCat).map(([k,v])=>{
    const net = (v.in||0) - (v.out||0);
    return {k, net, v:Math.abs(net)};
  }).filter(x => dir==="in" ? x.net > 0.005 : x.net < -0.005)
    .sort((a,b)=>b.v-a.v).slice(0,10);
  const total = arr.reduce((s,x)=>s+x.v,0);
  const color = dir==="in" ? ED_COLORS.in : ED_COLORS.out;
  const title = dir==="in" ? "หมวดรายรับ" : "หมวดรายจ่าย";
  const titleEn = dir==="in" ? "Receipts" : "Payments";
  const titleHtml = `<div style="font-weight:700;font-size:15px;color:${color};margin-bottom:9px">${title} <span style="font-weight:400;color:#94a3b8;font-size:12px">${titleEn}</span></div>`;
  if(!arr.length) return `<div>${titleHtml}<div class="empty" style="padding:14px">ไม่มีข้อมูล</div></div>`;
  return `<div>
    ${titleHtml}
    ${arr.map(x => {
      const pct = total ? (x.v/total*100).toFixed(1) : 0;
      return `<div style="margin-bottom:9px;cursor:pointer" onclick="CfpEd.edDrillCat(${JSON.stringify(x.k).replace(/"/g,'&quot;')},'${dir}')">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:13.5px;margin-bottom:3px"><span style="color:var(--ink-2)">${esc(x.k)}</span><span style="color:${color};font-weight:700;white-space:nowrap">${edFmt(x.v)}</span></div>
        <div style="height:7px;background:#e2e8f0;border-radius:999px;overflow:hidden"><div style="height:100%;background:${color};width:${pct}%"></div></div>
      </div>`;
    }).join("")}
  </div>`;
}

/* ---------- KPI ทางการเงิน (Summary tab — ต่อจาก Top 5) ---------- */
function edRenderFinKpis(A, data, monthFilter){
  const months = data.months || [];
  const nMonths = Math.max(1, edScopeMonthKeys(data, monthFilter).length);
  const op = A.byAct.operating || { in:0, out:0 };
  const opNet = op.in - op.out;

  // หา cost ของหมวด เงินเดือน/ค่าจ้าง (regex บนชื่อหมวด) · ★ POG: ไม่มีการ์ดค่าโฆษณา (ผู้ใช้เลือกตัดออก 2026-11-25)
  let empCost = 0;
  for(const [k, v] of Object.entries(A.byCat || {})){
    if(edIsPayrollCat(k)) empCost += v.out;
  }

  // ratios
  const cashMargin = A.totalIn > 0 ? (A.net / A.totalIn * 100) : null;
  const opRatio    = op.in > 0 ? (opNet / op.in * 100) : null;
  const burn       = A.totalOut / nMonths;
  const avgIn      = A.totalIn / nMonths;
  const opExRatio  = op.in > 0 ? (op.out / op.in * 100) : null;
  const empRatio   = op.in > 0 ? (empCost / op.in * 100) : null;

  // period label — แบบในภาพ "ตลอดปี 2568"
  let periodLabel = "ตลอดทั้งช่วง";
  if(monthFilter && monthFilter.startsWith("year:")){
    periodLabel = "ตลอดปี " + (Number(monthFilter.slice(5)) + 543);
  } else if(monthFilter !== "all"){
    periodLabel = "เดือน " + monthFilter;
  } else if(months.length){
    const yrs = [...new Set(months.map(m => m.key.slice(0,4)))];
    if(yrs.length === 1) periodLabel = "ตลอดปี " + (parseInt(yrs[0]) + 543);
    else periodLabel = "ตลอด " + months.length + " เดือน · " + (parseInt(yrs[0])+543) + "–" + (parseInt(yrs[yrs.length-1])+543);
  }

  // helpers
  const fmtPct = (v) => v == null ? "—" : (v >= 0 ? "" : "") + v.toFixed(1) + "%";
  const fmtCompactM = (n) => {
    const a = Math.abs(n);
    if(a >= 1e6) return ((n/1e6).toFixed(2)) + " ล้าน";
    if(a >= 1e3) return ((n/1e3).toFixed(1)) + " K";
    return n.toFixed(0);
  };
  const goodColor = ED_COLORS.in;     // ★ POG: เขียว — ดี
  const badColor  = "#fb5e6d";        // แดง — แย่/ติดลบ/จ่าย (ตรงกับ negative=red ทั้งระบบ)
  const neuColor  = "#0f172a";

  // benchmark eval: pass {value, good, ok, dir} dir='hi' = ยิ่งสูงยิ่งดี, 'lo' = ยิ่งต่ำยิ่งดี
  const evalBench = (v, good, ok, dir) => {
    if(v == null) return neuColor;
    if(dir === "hi"){
      if(v >= good) return goodColor;
      if(v >= ok)   return "#f59e0b";
      return badColor;
    } else {
      if(v <= ok)   return goodColor;
      if(v <= good) return "#f59e0b";
      return badColor;
    }
  };

  // ป้ายชื่อ ไทย + อังกฤษ
  const lbl = (th, en) => `${th} <span style="font-weight:400;color:#94a3b8;font-size:11.5px">${en}</span>`;

  // single KPI card — คลิกได้ → drill modal
  const card = (kpiKey, label, value, color, sub, bench, ref) => `
    <div onclick="CfpEd.edDrillFinKpi('${kpiKey}')" style="background:rgba(255,255,255,.85);backdrop-filter:blur(6px);border:1px solid #bfe6cb;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:4px;cursor:pointer;transition:.15s" onmouseover="this.style.borderColor='${ED_COLORS.brand}';this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 12px rgba(0,0,0,.06)'" onmouseout="this.style.borderColor='#bfe6cb';this.style.transform='none';this.style.boxShadow='none'">
      <div style="font-size:13px;font-weight:700;color:#475569">${label}</div>
      <div style="font-size:30px;font-weight:800;color:${color};letter-spacing:-.4px;margin-top:3px">${value}</div>
      ${sub?`<div style="font-size:12.5px;color:#64748b">${sub}</div>`:""}
      ${bench?`<div style="margin-top:7px;padding:5px 9px;background:rgba(99,102,241,.07);border:1px solid #e0e7ff;border-radius:6px;font-size:12px;color:#475569;align-self:flex-start;display:flex;align-items:center;gap:9px;flex-wrap:wrap"><span>เกณฑ์มาตรฐาน: ${bench}</span>${ref?`<a href="${ref}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="เปิดหน้าอ้างอิงภาษาไทย (ตลาดหลักทรัพย์ฯ SET) ในแท็บใหม่" style="display:inline-flex;align-items:center;gap:4px;padding:4px 11px;background:#4f46e5;color:#fff;font-weight:700;font-size:11.5px;border-radius:999px;text-decoration:none;white-space:nowrap;cursor:pointer">↗ ดูที่มา</a>`:''}</div>`:""}
    </div>`;

  return `
    <div class="card" data-exn="summary.kpi" style="margin-top:14px">
      <h3 style="font-size:18px">📊 KPI ทางการเงิน <span style="font-weight:400;color:#94a3b8;font-size:13.5px">Financial KPIs</span></h3>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">
        ${card("totalIn",  lbl("รายรับรวม","Total Receipts"), fmtCompactM(A.totalIn), goodColor, periodLabel, "")}
        ${card("totalOut", lbl("รายจ่ายรวม","Total Payments"), fmtCompactM(A.totalOut), badColor, periodLabel, "")}
        ${card("net",      lbl("กระแสเงินสดสุทธิ","Net Cash Flow"), fmtCompactM(A.net), A.net>=0?goodColor:badColor, "รับ - จ่าย", "")}

        ${card("cashMargin", lbl("อัตรากำไรเงินสด","Cash Margin"),
          fmtPct(cashMargin),
          evalBench(cashMargin, 10, 5, "hi"),
          "Net / Total Income",
          "ไม่ต่ำกว่า 5% (ดี) / ไม่ต่ำกว่า 10% (ยอดเยี่ยม)",
          "https://www.setinvestnow.com/th/knowledge/article/169-the-usefulness-of-financial-ratio")}

        ${card("opRatio", lbl("อัตราส่วนเงินสดดำเนินงาน","Operating Cash Flow Ratio"),
          fmtPct(opRatio),
          evalBench(opRatio, 100, 50, "hi"),
          "Op Net / Op Income",
          "ไม่ต่ำกว่า 50% (ดี) / ไม่ต่ำกว่า 100% (แข็งแกร่ง)",
          "https://www.setinvestnow.com/th/knowledge/article/566-tsi-survival-business-scan-techniques")}

        ${card("burn", lbl("อัตราใช้เงินสด/เดือน","Cash Burn Rate"),
          fmtCompactM(burn) + "/เดือน",
          burn <= avgIn ? goodColor : badColor,
          "ค่าใช้จ่ายดำเนินงานเฉลี่ย",
          "ควรต่ำกว่ายอดรายรับ/เดือน",
          "https://www.setinvestnow.com/th/knowledge/article/281-cash-cycle-for-business-liquidity")}

        ${card("opExRatio", lbl("ค่าใช้จ่ายต่อยอดขาย","Op Expense Ratio"),
          fmtPct(opExRatio),
          evalBench(opExRatio, 100, 80, "lo"),
          "Op Expense / Op Income",
          "ไม่เกิน 80%",
          "https://www.setinvestnow.com/th/knowledge/article/169-the-usefulness-of-financial-ratio")}

        ${card("empRatio", lbl("สัดส่วนค่าใช้จ่ายพนักงาน","Payroll Ratio"),
          fmtPct(empRatio),
          evalBench(empRatio, 50, 30, "lo"),
          "เงินเดือน / รายรับดำเนินงาน",
          "ไม่เกิน 30%")}
      </div>
      <div style="margin-top:13px;padding-top:11px;border-top:1px dashed #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.65">
        <b style="color:#64748b">ที่มาของเกณฑ์มาตรฐาน:</b> ค่าอ้างอิงเป็น “rule of thumb” ทั่วไปจากการวิเคราะห์อัตราส่วนทางการเงิน (financial ratio analysis) ซึ่งแตกต่างกันตามอุตสาหกรรม — ใช้เป็นแนวเทียบเบื้องต้น ไม่ใช่เกณฑ์ตายตัว:
        <br>• <b>อัตรากำไรเงินสด / Net Margin</b> ≥ 5–10% — เกณฑ์อัตรากำไรสุทธิทั่วไป
        &nbsp;•&nbsp; <b>Operating Cash Flow Ratio</b> ≥ 1.0 (100%) = กระแสเงินสดจากการดำเนินงานครอบคลุมภาระระยะสั้น
        &nbsp;•&nbsp; <b>Cash Burn</b> ควรต่ำกว่ารายรับเฉลี่ยต่อเดือน
        <br>• <b>Op Expense Ratio</b> ≤ 80% &nbsp;•&nbsp; <b>สัดส่วนค่าใช้จ่ายพนักงาน</b> ≤ 30% ของรายได้ <span style="color:#b0bcc9">(ตัวหลังเป็นแนวทางบริหารต้นทุน SME — ไม่มีมาตรฐานสากลตายตัว ปรับตามอุตสาหกรรม)</span>
        <br><span style="color:#b0bcc9">แหล่งอ้างอิงภาษาไทย — ตลาดหลักทรัพย์ฯ (SET Investnow) · คลิก ↗ ที่การ์ดแต่ละใบ:
          <a href="https://www.setinvestnow.com/th/knowledge/article/169-the-usefulness-of-financial-ratio" target="_blank" rel="noopener" style="color:#6366f1">อัตราส่วนทางการเงิน (กำไรสุทธิ)</a> ·
          <a href="https://www.setinvestnow.com/th/knowledge/article/566-tsi-survival-business-scan-techniques" target="_blank" rel="noopener" style="color:#6366f1">ความสามารถชำระหนี้จากกระแสเงินสด</a> ·
          <a href="https://www.setinvestnow.com/th/knowledge/article/281-cash-cycle-for-business-liquidity" target="_blank" rel="noopener" style="color:#6366f1">วงจรเงินสด / สภาพคล่อง</a>
          · ปรับเกณฑ์ได้ตามนโยบายของบริษัท</span>
      </div>
    </div>`;
}

/* ---------- Drill: KPI ทางการเงิน — แสดงสูตร + ตัวตั้ง/ตัวหาร + รายการที่มา ---------- */
function edDrillFinKpi(kpiKey){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter, true);  // ★ exclude transfers
  const months = d.data.months || [];
  const nMonths = Math.max(1, edScopeMonthKeys(d.data, d.monthFilter).length);
  const op = A.byAct.operating || { in:0, out:0 };
  const opNet = op.in - op.out;

  // categorize emp
  const empCats = [];
  let empCost = 0;
  for(const [k, v] of Object.entries(A.byCat || {})){
    if(edIsPayrollCat(k)) { empCost += v.out; empCats.push({ k, v }); }
  }
  empCats.sort((a,b) => b.v.out - a.v.out);

  // monthly breakdown (for burn rate) — ตาม scope ที่เลือก
  const monthlyOut = edScopeMonthKeys(d.data, d.monthFilter).map(mk => ({
    month: mk,
    out: edTxsInScope(d.data, mk, true).reduce((s,t) => s + t.out, 0)  // ★ exclude transfers
  }));

  // 3 อันแรก = single value → route ไปที่ existing drill
  if(kpiKey === "totalIn")  return edDrillSummary("in");
  if(kpiKey === "totalOut") return edDrillSummary("out");
  if(kpiKey === "net")      return edDrillSummary("net");

  // SPECS ของ 6 ratio
  const SPECS = {
    cashMargin: {
      title: "อัตรากำไรเงินสด · Cash Margin",
      formula: "กระแสเงินสดสุทธิ ÷ รายรับรวม × 100",
      numLabel: "ตัวตั้ง: กระแสเงินสดสุทธิ (Net)",
      numValue: A.net,
      denLabel: "ตัวหาร: รายรับรวม (Total Income)",
      denValue: A.totalIn,
      result: A.totalIn > 0 ? (A.net / A.totalIn * 100) : null,
      bench: "≥5% (ดี) / ≥10% (ยอดเยี่ยม)",
      desc: "ทุก 100 บาทของรายรับ เหลือเป็นเงินสดสุทธิกี่บาท — ยิ่งสูงยิ่งดี",
      extra: ""
    },
    opRatio: {
      title: "Operating Cash Flow Ratio · OCF",
      formula: "(Op Income − Op Expense) ÷ Op Income × 100",
      numLabel: "ตัวตั้ง: ดำเนินงานสุทธิ (Op Net)",
      numValue: opNet,
      denLabel: "ตัวหาร: รายรับดำเนินงาน (Op Income)",
      denValue: op.in,
      result: op.in > 0 ? (opNet / op.in * 100) : null,
      bench: "≥50% (ดี) / ≥100% (แข็งแกร่ง)",
      desc: "เฉพาะกิจกรรมดำเนินงาน (Operating) — ไม่รวม ลงทุน / จัดหาเงิน",
      extra: `<div style="margin-top:8px;font-size:11.5px;color:#475569">รายละเอียด: Op Income ${edFmt(op.in)} − Op Expense ${edFmt(op.out)} = <b>${edFmt(opNet)}</b></div>`
    },
    burn: {
      title: "Cash Burn Rate · อัตราเผาเงิน",
      formula: "รายจ่ายรวม ÷ จำนวนเดือน",
      numLabel: "ตัวตั้ง: รายจ่ายรวม (Total Expense)",
      numValue: A.totalOut,
      denLabel: "ตัวหาร: จำนวนเดือนในช่วง",
      denValue: nMonths,
      result: A.totalOut / nMonths,
      bench: "ควรต่ำกว่ายอดรายรับ/เดือน (" + edFmt(A.totalIn / nMonths) + ")",
      desc: "ค่าใช้จ่ายเฉลี่ยต่อเดือน — ใช้วัดว่าเงินสดจะอยู่ได้กี่เดือน",
      isAvg: true,
      extra: `<div style="margin-top:10px"><div style="font-size:11.5px;font-weight:700;color:#475569;margin-bottom:4px">รายจ่ายแยกตามเดือน:</div><table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead><tr style="background:#f8fafc"><th style="text-align:left;padding:5px 8px;color:#475569;font-weight:600">เดือน</th><th style="text-align:right;padding:5px 8px;color:#475569;font-weight:600">รายจ่าย</th></tr></thead>
        <tbody>${monthlyOut.map(m => `<tr><td style="padding:5px 8px;border-top:1px solid #e2e8f0">${esc(m.month)}</td><td style="padding:5px 8px;text-align:right;border-top:1px solid #e2e8f0;color:${ED_COLORS.out};font-weight:600">${edFmt(m.out)}</td></tr>`).join("")}
        <tr style="background:#f1f5f9;font-weight:700"><td style="padding:6px 8px">รวม / เฉลี่ย</td><td style="padding:6px 8px;text-align:right">${edFmt(A.totalOut)} / <b>${edFmt(A.totalOut/nMonths)}</b></td></tr></tbody>
      </table></div>`
    },
    opExRatio: {
      title: "ค่าใช้จ่ายต่อยอดขาย · OpEx Ratio",
      formula: "Op Expense ÷ Op Income × 100",
      numLabel: "ตัวตั้ง: รายจ่ายดำเนินงาน (Op Expense)",
      numValue: op.out,
      denLabel: "ตัวหาร: รายรับดำเนินงาน (Op Income)",
      denValue: op.in,
      result: op.in > 0 ? (op.out / op.in * 100) : null,
      bench: "≤80% (จัดการต้นทุนได้ดี)",
      desc: "ทุก 100 บาทของรายรับ มีต้นทุนดำเนินงานกี่บาท — ยิ่งต่ำยิ่งดี",
      extra: ""
    },
    empRatio: {
      title: "สัดส่วนค่าใช้จ่ายพนักงาน · Staff Cost",
      formula: "ค่าใช้จ่ายพนักงาน ÷ Op Income × 100",
      numLabel: "ตัวตั้ง: ค่าใช้จ่ายพนักงาน (จากหมวด)",
      numValue: empCost,
      denLabel: "ตัวหาร: รายรับดำเนินงาน (Op Income)",
      denValue: op.in,
      result: op.in > 0 ? (empCost / op.in * 100) : null,
      bench: "≤30%",
      desc: "หมวดที่ชื่อมีคำว่า เงินเดือน / ค่าจ้าง / พนักงาน (ไม่นับค่าจ้างเหมา — เป็นค่าผู้รับเหมา ไม่ใช่พนักงาน)",
      extra: empCats.length ? `<div style="margin-top:10px"><div style="font-size:11.5px;font-weight:700;color:#475569;margin-bottom:4px">หมวดที่นับเป็น 'ค่าใช้จ่ายพนักงาน' (${empCats.length} หมวด):</div><table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead><tr style="background:#f8fafc"><th style="text-align:left;padding:5px 8px;color:#475569;font-weight:600">หมวด</th><th style="text-align:right;padding:5px 8px;color:#475569;font-weight:600">จำนวน</th><th style="text-align:right;padding:5px 8px;color:#475569;font-weight:600">ยอดจ่าย</th></tr></thead>
        <tbody>${empCats.map(c => `<tr style="cursor:pointer" onclick="CfpEd.edDrillCat(${JSON.stringify(c.k).replace(/"/g,'&quot;')},'out');event.stopPropagation()"><td style="padding:5px 8px;border-top:1px solid #e2e8f0">${esc(c.k)}</td><td style="padding:5px 8px;text-align:right;border-top:1px solid #e2e8f0;color:#64748b">${c.v.count}</td><td style="padding:5px 8px;text-align:right;border-top:1px solid #e2e8f0;color:${ED_COLORS.out};font-weight:600">${edFmt(c.v.out)}</td></tr>`).join("")}
        <tr style="background:#f1f5f9;font-weight:700"><td style="padding:6px 8px" colspan="2">รวม</td><td style="padding:6px 8px;text-align:right">${edFmt(empCost)}</td></tr></tbody>
      </table></div>` : '<div style="margin-top:10px;padding:12px;background:#f8fafc;border-radius:6px;font-size:12px;color:#64748b;text-align:center">ไม่พบหมวด \'เงินเดือน/ค่าจ้าง/พนักงาน\' ในช่วงนี้</div>'
    },
  };

  const s = SPECS[kpiKey];
  if(!s) return;

  const fmtVal = (v, isAvg) => {
    if(typeof v === "number" && !isAvg && Math.abs(v) >= 100) return edFmt(v);
    if(typeof v === "number") return v.toLocaleString("th-TH",{maximumFractionDigits:2});
    return v;
  };
  const passColor = s.result == null ? "#0f172a" : (s.result >= 0 ? ED_COLORS.in : ED_COLORS.out);

  // Modal
  const m = document.createElement("div");
  m.id = "edDrillModal";
  m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:1100;display:flex;align-items:flex-start;justify-content:center;padding:30px 20px;overflow:auto";
  m.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:22px;max-width:720px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.4);margin:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #e2e8f0">
        <div style="flex:1">
          <div style="font-size:11px;font-weight:700;color:${ED_COLORS.brand};text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">KPI · ที่มาของตัวเลข</div>
          <div style="font-size:17px;font-weight:800;color:#0f172a">${esc(s.title)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:3px">${esc(s.desc)}</div>
        </div>
        <button onclick="document.getElementById('edDrillModal').remove()" style="background:transparent;border:1px solid #cbd5e1;border-radius:6px;padding:5px 10px;cursor:pointer;color:#475569;font-size:12px">✕ ปิด</button>
      </div>

      <!-- สูตร -->
      <div style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:10.5px;font-weight:700;color:#4338ca;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">📐 สูตร</div>
        <div style="font-size:14px;font-weight:600;color:#1e1b4b">${esc(s.formula)}</div>
      </div>

      <!-- ตัวเลข -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:10px;margin-bottom:14px">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
          <div style="font-size:10.5px;color:#64748b;font-weight:600">${esc(s.numLabel)}</div>
          <div style="font-size:18px;font-weight:800;color:${s.numValue<0?ED_COLORS.out:'#0f172a'};margin-top:3px">${fmtVal(s.numValue)}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
          <div style="font-size:10.5px;color:#64748b;font-weight:600">${esc(s.denLabel)}</div>
          <div style="font-size:18px;font-weight:800;color:#0f172a;margin-top:3px">${fmtVal(s.denValue)}</div>
        </div>
        <div style="background:${passColor};color:#fff;border-radius:10px;padding:12px">
          <div style="font-size:10.5px;font-weight:700;opacity:.9">= ผลลัพธ์</div>
          <div style="font-size:22px;font-weight:800;margin-top:3px;letter-spacing:-.3px">${s.result==null?"—":(s.isAvg?edFmt(s.result):s.result.toFixed(2)+"%")}</div>
          <div style="font-size:10.5px;opacity:.85;margin-top:2px">เกณฑ์: ${esc(s.bench)}</div>
        </div>
      </div>

      ${s.extra || ""}
    </div>`;
  document.body.appendChild(m);
  m.onclick = e => { if(e.target === m) m.remove(); };
}

/* ── Benya index.html 4949–5200 ── */
function edThaiMonthShort(key){
  const [y,m] = String(key||"").split(".").map(Number);
  if(!y || !m) return String(key||"");
  return TH_MON_SHORT[m-1] + " " + (y+543);
}
/* รวมยอดต่อหมวดจากชุด txs ที่ให้มา (โครงเดียวกับ A.byCat) */
function edCatOfTxs(txs){
  const byCat = {};
  for(const t of txs){
    const k = t.category;
    if(!byCat[k]) byCat[k] = { in:0, out:0, count:0, net:0 };
    byCat[k].in  += t.in;
    byCat[k].out += t.out;
    byCat[k].count++;
    byCat[k].net = byCat[k].in - byCat[k].out;
  }
  return byCat;
}
/* สีโปร่ง (hex → rgba) — ใช้ rgba แทน color-mix เพราะ html2canvas (พิมพ์ PDF) ไม่รองรับ color-mix */
function edTint(c, a){
  const m = String(c||"").trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if(!m) return `rgba(148,163,184,${a})`;
  let h = m[1]; if(h.length===3) h = h.split("").map(x=>x+x).join("");
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
}
/* สีเข้มขึ้น (hex → rgb คูณ f) — ใช้ไล่เฉดแถบหัวให้ตัวหนังสือขาวอ่านชัด ทั้งบนจอและใน PDF */
function edDark(c, f){
  const m = String(c||"").trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if(!m) return "#1e293b";
  let h = m[1]; if(h.length===3) h = h.split("").map(x=>x+x).join("");
  const v = [0,2,4].map(i=>Math.round(parseInt(h.slice(i,i+2),16)*f));
  return `rgb(${v.join(",")})`;
}
/* ลิสต์ Top N ของหมวด — แถบยาวเทียบหมวดที่มากสุด · % = สัดส่วนของยอดรวมฝั่งนั้นในกิจกรรมนั้น */
function edTopListAct(byCat, dir, actKey, limit){
  limit = limit || 5;
  const arr = Object.entries(byCat).map(([k,v])=>({ k, v: v[dir]||0 }))
    .filter(x => x.v > 0.005).sort((a,b)=>b.v-a.v);
  const total = arr.reduce((s,x)=>s+x.v, 0);
  const color = dir==="in" ? ED_COLORS.in : ED_COLORS.out;
  const head  = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px">
      <span style="display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:14px;color:var(--ink)">
        <span style="width:9px;height:9px;border-radius:50%;background:${color};box-shadow:0 0 0 4px ${edTint(color,.18)}"></span>
        Top 5 ${dir==="in"?"รายรับ":"รายจ่าย"}</span>
      <span style="font-size:12.5px;color:var(--ink-3)">รวม <b style="font-size:15px;color:${color}">${edFmt(total)}</b></span>
    </div>`;
  const wrap = body => `<div style="background:${edTint(color,.06)};border:1px solid ${edTint(color,.22)};border-radius:14px;padding:14px 16px;min-width:0">${head}${body}</div>`;
  if(!arr.length) return wrap(`<div style="padding:14px;text-align:center;font-size:12.5px;color:#94a3b8">ไม่มีรายการ</div>`);
  const top = arr.slice(0, limit), rest = arr.slice(limit), max = top[0].v || 1;
  return wrap(top.map((x,i)=>{
    const pct = total ? x.v/total*100 : 0;
    const first = i===0;
    return `<div style="display:grid;grid-template-columns:26px minmax(0,1fr);gap:10px;align-items:center;margin-bottom:11px;cursor:pointer" onclick="CfpEd.edDrillCatAct(${JSON.stringify(x.k).replace(/"/g,'&quot;')},'${dir}','${actKey}')" title="กดดูรายการ">
      <span style="width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:12px;font-weight:800;${first?`background:${color};color:#fff`:`background:#fff;color:${color};border:1px solid ${edTint(color,.35)}`}">${i+1}</span>
      <div style="min-width:0">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:4px">
          <span style="color:var(--ink);font-weight:${first?700:500};overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.k)}">${esc(x.k)}</span>
          <span style="white-space:nowrap;font-weight:800;color:${color}">${edFmt(x.v)} <span style="display:inline-block;min-width:34px;text-align:right;font-weight:600;font-size:11.5px;color:#64748b">${pct<1?pct.toFixed(1):pct.toFixed(0)}%</span></span>
        </div>
        <div style="height:9px;background:${edTint(color,.14)};border-radius:999px;overflow:hidden"><div style="height:100%;border-radius:999px;background:linear-gradient(90deg,${edTint(color,.6)},${color});width:${Math.max(2,x.v/max*100).toFixed(1)}%"></div></div>
      </div>
    </div>`;
  }).join("") + (rest.length?`<div style="font-size:12px;color:#64748b;margin-top:4px;padding-top:8px;border-top:1px dashed ${edTint(color,.3)}">+ อีก ${rest.length} หมวด · ${edFmt(rest.reduce((s,x)=>s+x.v,0))}</div>`:""));
}
/* การ์ด "Top 5 แยกตามกิจกรรม" — อยู่บนสุดของแท็บ Category
   · แถบหัวสีแบรนด์ สรุปรับ/จ่าย/สุทธิรวม + สัดส่วนตามกิจกรรม
   · กิจกรรมที่มีรายการ = บล็อกเต็ม (Top 5 รับ | Top 5 จ่าย) · ไม่มีรายการ = ยุบเป็นแถบบรรทัดเดียว (ไม่กินที่)
   ★ กิจกรรม "อื่น ๆ" โผล่เฉพาะเมื่อมียอดจริง */
function edActBreakdownCard(A){
  const acts = [
    { k:"operating", th:"กิจกรรมดำเนินงาน", en:"Operating", ic:"⚙️", c:ED_COLORS.op  },
    { k:"investing", th:"กิจกรรมลงทุน",     en:"Investing", ic:"🏗️", c:ED_COLORS.inv },
    { k:"financing", th:"กิจกรรมจัดหาเงิน", en:"Financing", ic:"🏦", c:ED_COLORS.fin }
  ];
  const o = A.byAct.other || { in:0, out:0 };
  if(o.in > 0.005 || o.out > 0.005) acts.push({ k:"other", th:"อื่น ๆ", en:"Other", ic:"▫️", c:"#94a3b8" });
  acts.forEach(a=>{
    a.txs = A.txs.filter(t => t.activityKey === a.k);
    a.v   = A.byAct[a.k] || { in:0, out:0 };
    a.net = a.v.in - a.v.out;
  });
  const tIn = acts.reduce((s,a)=>s+a.v.in, 0), tOut = acts.reduce((s,a)=>s+a.v.out, 0), tNet = tIn - tOut;
  const brand = ED_COLORS.brand || ED_COLORS.in;
  const netClr = n => n>=0 ? ED_COLORS.in : "#fb5e6d";
  const shade = { operating:"#ffffff", investing:"rgba(255,255,255,.62)", financing:"rgba(255,255,255,.38)", other:"rgba(255,255,255,.25)" };

  /* แถบสัดส่วนตามกิจกรรม */
  const shareBar = (dir, total) => total > 0.005
    ? `<div style="display:flex;height:8px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.2)">${acts.filter(a=>a.v[dir]>0.005).map(a=>
        `<div title="${a.th} ${edFmt(a.v[dir])}" style="width:${(a.v[dir]/total*100).toFixed(2)}%;background:${shade[a.k]}"></div>`).join("")}</div>`
    : `<div style="height:8px;border-radius:999px;background:rgba(255,255,255,.2)"></div>`;
  const legend = `<div style="display:flex;flex-wrap:wrap;gap:12px;font-size:11.5px;opacity:.9;margin-top:10px">${acts.map(a=>
      `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:3px;background:${shade[a.k]};border:1px solid rgba(255,255,255,.5)"></span>${a.th}</span>`).join("")}</div>`;
  const kpi = (lbl, val, bar, sub) => `<div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);border-radius:14px;padding:12px 16px;min-width:0">
      <div style="font-size:12.5px;opacity:.9">${lbl}</div>
      <div style="font-size:24px;font-weight:800;letter-spacing:-.3px;line-height:1.3;margin:2px 0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${val}</div>
      ${bar||""}${sub?`<div style="font-size:11.5px;opacity:.88">${sub}</div>`:""}
    </div>`;
  const hero = `<div style="background:linear-gradient(135deg,${edDark(brand,.72)},${edDark(brand,.5)});color:#fff;border-radius:16px;padding:20px 22px;margin-bottom:16px;position:relative;overflow:hidden">
      <div style="position:absolute;right:-50px;top:-70px;width:230px;height:230px;border-radius:50%;background:rgba(255,255,255,.08)"></div>
      <div style="position:relative">
        <div style="font-size:19px;font-weight:800">Top 5 รายรับ / รายจ่าย · แยกตามกิจกรรม</div>
        <div style="font-size:12.5px;opacity:.88;margin:2px 0 14px">Top 5 by Activity · กดชื่อกิจกรรมหรือแถบหมวดเพื่อดูรายการ</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
          ${kpi("รับรวม", edFmt(tIn), shareBar("in", tIn))}
          ${kpi("จ่ายรวม", edFmt(tOut), shareBar("out", tOut))}
          ${kpi("สุทธิ", edFmt(tNet), "", `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-weight:700;background:${tNet<0?"#fb5e6d":"#15c486"};color:#fff">${tNet<0?"⚠ จ่ายมากกว่ารับ":"✓ รับมากกว่าจ่าย"}</span>`)}
        </div>
        ${legend}
      </div>
    </div>`;

  const pill = (lbl, val, c) => `<span style="display:inline-flex;align-items:baseline;gap:6px;background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:12px;color:var(--ink-3);white-space:nowrap">${lbl} <b style="font-size:14px;color:${c}">${edFmt(val)}</b></span>`;
  const full  = acts.filter(a => a.txs.length);
  const empty = acts.filter(a => !a.txs.length);

  const blocks = full.map(a=>{
    const byCat = edCatOfTxs(a.txs);
    return `<div style="border:1px solid ${edTint(a.c,.35)};border-radius:16px;padding:16px 18px;margin-bottom:14px;background:linear-gradient(180deg,${edTint(a.c,.08)},#fff 80px);box-shadow:0 2px 12px ${edTint(a.c,.1)}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;cursor:pointer" onclick="CfpEd.edDrillActivity('${a.k}')" title="กดดูรายการทั้งหมดของกิจกรรมนี้">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:21px;background:${edTint(a.c,.16)};border:1px solid ${edTint(a.c,.35)}">${a.ic}</span>
          <div>
            <div style="font-weight:800;font-size:16.5px;color:var(--ink)">${a.th}</div>
            <div style="font-size:12px;color:#94a3b8">${a.en} · <b style="color:${a.c}">${a.txs.length.toLocaleString("th-TH")}</b> รายการ</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${pill("รับ", a.v.in, ED_COLORS.in)}${pill("จ่าย", a.v.out, ED_COLORS.out)}${pill("สุทธิ", a.net, netClr(a.net))}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">
        ${edTopListAct(byCat,"in", a.k)}
        ${edTopListAct(byCat,"out", a.k)}
      </div>
    </div>`;
  }).join("");

  const emptyRow = empty.length ? `<div style="display:flex;flex-wrap:wrap;gap:10px">${empty.map(a=>
      `<div style="flex:1 1 260px;display:flex;align-items:center;gap:10px;border:1px dashed ${edTint(a.c,.5)};border-radius:12px;padding:9px 14px;background:${edTint(a.c,.04)};font-size:13px">
        <span style="font-size:17px">${a.ic}</span><b style="color:var(--ink)">${a.th}</b>
        <span style="color:#94a3b8;font-size:12px">${a.en}</span>
        <span style="margin-left:auto;font-size:12px;color:#94a3b8">ไม่มีรายการในช่วงนี้</span>
      </div>`).join("")}</div>` : "";

  return `<div class="card" style="padding:16px">
    ${hero}
    ${blocks || `<div class="empty" style="padding:24px">ไม่มีรายการในช่วงนี้</div>`}
    ${emptyRow}
  </div>`;
}
function edDrillCatAct(cat, dir, actKey){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter, true);   // ★ exclude transfers
  let txs = A.txs.filter(t => t.category===cat && t.activityKey===actKey);
  if(dir==="in")  txs = txs.filter(t=>t.in>0);
  if(dir==="out") txs = txs.filter(t=>t.out>0);
  edShowDrillModal(edActivityLabel(actKey) + " · หมวด: " + cat, txs);
}

/* ★ ค่าใช้จ่ายที่สูงกว่าปกติ — เทียบ "เดือนล่าสุดใน scope" กับค่าเฉลี่ยเดือนก่อนหน้า (ไม่เกิน lookback เดือน)
   · ค่าเฉลี่ยหารด้วยจำนวนเดือนทั้งหมด (เดือนที่ไม่มีรายการ = 0) → หมวดที่จ่ายไม่ทุกเดือนติดธง "จ่าย N/M เดือน"
   · baseline ดึงจากทุกเดือนที่มีในข้อมูล (ไม่ผูก scope) — เลือกดูเดือนเดียวก็ยังเทียบย้อนหลังได้
   · เกณฑ์: สูงกว่าค่าเฉลี่ย > 25% และส่วนต่าง ≥ max(500, 1% ของยอดจ่ายเดือนนั้น) กันรายการจิ๊บจ๊อยรก */
function edAnomalyData(data, monthFilter, lookback){
  lookback = lookback || 6;
  const allKeys = (data.months||[]).map(m=>m.key).sort();
  const scope   = edScopeMonthKeys(data, monthFilter);
  if(!scope.length) return null;
  const target = scope[scope.length-1];
  const prior  = allKeys.filter(k => k < target).slice(-lookback);
  if(!prior.length) return null;

  const txs = (data.transactions||[]).filter(t => t.out > 0 && !edIsTransfer(t));
  const outOf = (mk)=>{
    const m = {};
    for(const t of txs){ if(t.month === mk) m[t.category] = (m[t.category]||0) + t.out; }
    return m;
  };
  const cur  = outOf(target);
  const hist = prior.map(outOf);
  const nB   = prior.length;
  const sum  = (o)=>Object.keys(o).reduce((s,k)=>s+o[k], 0);
  const curTotal     = sum(cur);
  const baseAvgTotal = hist.reduce((s,h)=>s+sum(h), 0) / nB;

  const floor = Math.max(500, curTotal * 0.01);
  const rows = [];
  for(const cat in cur){
    const v    = cur[cat];
    const seen = hist.filter(h => (h[cat]||0) > 0).length;
    const avg  = hist.reduce((s,h)=>s+(h[cat]||0), 0) / nB;
    const diff = v - avg;
    if(diff < floor) continue;
    if(avg > 0 && v/avg < 1.25) continue;
    rows.push({ cat, cur:v, avg, diff, seen, months:nB,
      pct: avg > 0 ? (v/avg - 1) * 100 : null,
      kind: seen === 0 ? "new" : (seen < nB ? "irregular" : "up") });
  }
  rows.sort((a,b)=>b.diff-a.diff);
  return { target, prior, rows, curTotal, baseAvgTotal, nB, floor };
}
function edAnomalyCard(data, monthFilter){
  const titleHtml = `<h3 style="font-size:18px">⚠️ ค่าใช้จ่ายที่สูงกว่าปกติ <span style="font-weight:400;color:#94a3b8;font-size:13.5px">Unusual Spending · เทียบเดือนล่าสุดกับค่าเฉลี่ยย้อนหลัง</span></h3>`;
  const R = edAnomalyData(data, monthFilter);
  if(!R) return `<div class="card">${titleHtml}<div class="empty" style="padding:18px">ต้องมีข้อมูลอย่างน้อย 2 เดือนถึงจะเทียบได้</div></div>`;

  const dTot = R.curTotal - R.baseAvgTotal;
  const pTot = R.baseAvgTotal ? (dTot / R.baseAvgTotal * 100) : null;
  const rangeLbl = R.nB === 1 ? edThaiMonthShort(R.prior[0])
                              : edThaiMonthShort(R.prior[0]) + " – " + edThaiMonthShort(R.prior[R.nB-1]);
  const summary = `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px;font-size:13px;color:var(--ink-2)">
      <span style="background:rgba(148,163,184,.14);padding:6px 12px;border-radius:999px">เดือนที่ตรวจ <b style="color:var(--ink)">${edThaiMonthShort(R.target)}</b></span>
      <span>จ่ายรวม <b style="color:${ED_COLORS.out}">${edFmt(R.curTotal)}</b></span>
      <span style="color:#cbd5e1">|</span>
      <span>ค่าเฉลี่ย ${R.nB} เดือนก่อน (${rangeLbl}) <b>${edFmt(R.baseAvgTotal)}</b></span>
      <span style="font-weight:700;color:${dTot>=0?"#fb5e6d":ED_COLORS.in}">${dTot>=0?"▲ สูงกว่า":"▼ ต่ำกว่า"} ${edFmt(Math.abs(dTot))}${pTot!==null?` (${dTot>=0?"+":""}${pTot.toFixed(0)}%)`:""}</span>
    </div>`;
  const note = `<div style="font-size:11.5px;color:#94a3b8;margin-top:10px;line-height:1.7">
      เกณฑ์: สูงกว่าค่าเฉลี่ยเกิน 25% <b>และ</b> ส่วนต่างตั้งแต่ ${edFmt(R.floor)} ขึ้นไป · ค่าเฉลี่ยหารด้วย ${R.nB} เดือน (เดือนที่ไม่มีรายการนับเป็น 0) · ไม่รวมเงินโอนระหว่างบัญชี
    </div>`;

  if(!R.rows.length) return `<div class="card">${titleHtml}${summary}
    <div style="padding:14px;border-radius:10px;background:rgba(22,163,74,.08);color:#15803d;font-size:13.5px;font-weight:600">✓ ไม่พบหมวดค่าใช้จ่ายที่สูงผิดปกติในเดือนนี้</div>${note}</div>`;

  const CAP = 8;
  const show = R.rows.slice(0, CAP), rest = R.rows.slice(CAP);
  const badge = (r)=>{
    if(r.kind === "new")       return `<span style="background:rgba(220,38,38,.12);color:#b91c1c;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap">รายการใหม่ · ไม่มีใน ${r.months} เดือนก่อน</span>`;
    if(r.kind === "irregular") return `<span style="background:rgba(217,119,6,.14);color:#b45309;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap">จ่าย ${r.seen}/${r.months} เดือน · +${r.pct.toFixed(0)}%</span>`;
    return `<span style="background:rgba(220,38,38,.10);color:#fb5e6d;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap">+${r.pct.toFixed(0)}% จากค่าเฉลี่ย</span>`;
  };
  return `<div class="card">${titleHtml}${summary}
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>หมวดค่าใช้จ่าย</th><th style="text-align:right">${edThaiMonthShort(R.target)}</th><th style="text-align:right">เฉลี่ย ${R.nB} เดือนก่อน</th><th style="text-align:right">ส่วนต่าง</th><th>สาเหตุ</th></tr></thead>
      <tbody>${show.map((r,i)=>`<tr style="cursor:pointer" onclick="CfpEd.edDrillCatMonth(${JSON.stringify(r.cat).replace(/"/g,'&quot;')},${JSON.stringify(R.target).replace(/"/g,'&quot;')})">
        <td>${i+1}</td>
        <td>${esc(r.cat)}</td>
        <td style="text-align:right;font-weight:700;color:${ED_COLORS.out}">${edFmt(r.cur)}</td>
        <td style="text-align:right;color:var(--ink-3)">${r.avg>0?edFmt(r.avg):"—"}</td>
        <td style="text-align:right;font-weight:800;color:#fb5e6d">+${edFmt(r.diff)}</td>
        <td>${badge(r)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${rest.length?`<div style="font-size:12px;color:#94a3b8;margin-top:8px">+ อีก ${rest.length} หมวดที่เข้าเกณฑ์ รวม ${edFmt(rest.reduce((s,x)=>s+x.diff,0))}</div>`:""}
    ${note}
  </div>`;
}
function edDrillCatMonth(cat, monthKey){
  const d = edState();
  const txs = (d.data.transactions||[]).filter(t => t.category===cat && t.month===monthKey && t.out>0 && !edIsTransfer(t));
  edShowDrillModal("หมวด: " + cat + " · " + edThaiMonth(monthKey), txs);
}

/* ── Benya index.html 5201–5708 ── */
function edRenderCategory(){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter, true);  // ★ exclude transfers
  const cats = Object.entries(A.byCat).map(([k,v])=>({ k, ...v, abs:Math.abs(v.net) })).sort((a,b)=>b.abs-a.abs);

  // Top 5 รับ / จ่าย (+ รวมที่เหลือเป็น "อื่นๆ") สำหรับโดนัทชาร์ต
  const buildTop = (dir) => {
    const arr = Object.entries(A.byCat).map(([k,v])=>({k, v:v[dir]})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
    const top = arr.slice(0,5);
    const restArr = arr.slice(5);
    const rest = restArr.reduce((s,x)=>s+x.v,0);
    const labels = top.map(x=>x.k.length>34?x.k.slice(0,32)+"…":x.k);
    const data   = top.map(x=>x.v);
    const keys   = top.map(x=>x.k);
    if(rest>0){ labels.push(`อื่นๆ (${restArr.length} หมวด)`); data.push(rest); keys.push(null); }
    return { labels, data, keys, total: arr.reduce((s,x)=>s+x.v,0) };
  };
  const inT = buildTop("in"), outT = buildTop("out");

  edContentEl().innerHTML = `
    <div data-exn="category.top">${edActBreakdownCard(A)}</div>
    <div data-exn="category.top" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div class="card" style="margin-bottom:0">
        <h3 style="font-size:18px">🟢 Top 5 รายรับ <span style="font-weight:400;color:#94a3b8;font-size:13.5px">Top 5 Receipts</span></h3>
        ${inT.data.length?`<div style="position:relative;height:330px"><canvas id="edPieIn"></canvas></div>`:`<div class="empty" style="padding:30px">ไม่มีรายรับ</div>`}
      </div>
      <div class="card" style="margin-bottom:0">
        <h3 style="font-size:18px">🔴 Top 5 รายจ่าย <span style="font-weight:400;color:#94a3b8;font-size:13.5px">Top 5 Payments</span></h3>
        ${outT.data.length?`<div style="position:relative;height:330px"><canvas id="edPieOut"></canvas></div>`:`<div class="empty" style="padding:30px">ไม่มีรายจ่าย</div>`}
      </div>
    </div>
    <div data-exn="category.anomaly">${edAnomalyCard(d.data, d.monthFilter)}</div>
    <div class="card">
      <h3 style="font-size:18px">Top 10 หมวด รายรับ / รายจ่าย <span style="font-weight:400;color:#94a3b8;font-size:13.5px">Top 10 Categories · หักลบรับ-จ่ายในหมวดเดียวกันแล้ว</span></h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        ${edTopList(A.byCat,"in")}
        ${edTopList(A.byCat,"out")}
      </div>
    </div>
    <div class="card">
      <h3>ตารางจัดอันดับ</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>หมวด</th><th style="text-align:right">รายการ</th><th style="text-align:right;color:var(--ok)">รับ</th><th style="text-align:right;color:var(--bad)">จ่าย</th><th style="text-align:right">สุทธิ</th></tr></thead>
        <tbody>${cats.map((c,i)=>`<tr style="cursor:pointer" onclick="CfpEd.edDrillCat(${JSON.stringify(c.k).replace(/"/g,'&quot;')},'all')">
          <td>${i+1}</td><td>${esc(c.k)}</td>
          <td style="text-align:right">${c.count}</td>
          <td style="text-align:right;color:var(--ok)">${c.in>0?edFmt(c.in):"—"}</td>
          <td style="text-align:right;color:var(--bad)">${c.out>0?edFmt(c.out):"—"}</td>
          <td style="text-align:right;font-weight:700;color:${c.net>=0?ED_COLORS.in:"#fb5e6d"}">${edFmt(c.net)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>
  `;

  const inPalette  = ["#15c486","#3fd39d","#8fe3c2","#2e8b4a","#6fb886","#9AA8BF"];   // ★ POG: เขียว/น้ำเงิน = รับ
  const outPalette = ["#fb5e6d","#fb6b78","#e08a3c","#f0b070","#9b7bff","#9AA8BF"];   // ★ POG: แดง/ส้ม/ม่วง = จ่าย
  const mkPie = (id, T, palette, dir) => {
    if(!T.data.length) return;
    edMakeChart(id, {
      type:"doughnut",
      data:{ labels:T.labels, datasets:[{ data:T.data, backgroundColor:T.labels.map((_,i)=>palette[i%palette.length]), borderColor:"#fff", borderWidth:2, hoverOffset:6 }] },
      options:{ responsive:true, maintainAspectRatio:false, cutout:"55%",
        layout:{ padding:{ top:16, right:38, bottom:6, left:38 } },   // เผื่อที่ป้าย % + เส้นโยงข้างวง
        plugins:{
          legend:{ position:"bottom", labels:{ font:{size:11.5}, boxWidth:12, padding:9,
            generateLabels:(c)=>{ const dd=c.data, dset=dd.datasets[0], tot=dset.data.reduce((s,v)=>s+(Number(v)||0),0)||1;
              return dd.labels.map((lab,i)=>{ const v=Number(dset.data[i])||0, pc=v/tot*100, bg=Array.isArray(dset.backgroundColor)?dset.backgroundColor[i]:dset.backgroundColor;
                return { text: lab+"  "+(pc<1?pc.toFixed(1):pc.toFixed(0))+"%", fillStyle:bg, strokeStyle:bg, lineWidth:0, index:i }; }); }
          } },
          tooltip:{ callbacks:{ label:c=>{ const pct=T.total?(c.parsed/T.total*100).toFixed(1):0; return " "+c.label+": "+edFmt(c.parsed)+" ("+pct+"%)"; } } }
        },
        onClick:(e,els)=>{ if(els&&els.length){ const k=T.keys[els[0].index]; if(k) edDrillCat(k, dir); } }
      },
      plugins:[edDonutPctPlugin]
    });
  };
  mkPie("edPieIn", inT, inPalette, "in");
  mkPie("edPieOut", outT, outPalette, "out");
}

/* ---------- Tab 4: Banks ---------- */
function edRenderBanks(){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter);
  const acctEntries = Object.entries(A.byAcct).sort((a,b)=>b[1].in - a[1].in);
  const hasNick = acctEntries.some(([k,v]) => v.nick);   // ★ POG

  edContentEl().innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div class="card" style="margin-bottom:0">
        <h3>สัดส่วนเงินสด (ปลายงวด) ตามบัญชี</h3>
        <div style="position:relative;height:300px"><canvas id="edAcctDonut"></canvas></div>
      </div>
      <div class="card" style="margin-bottom:0">
        <h3>เปรียบเทียบ รับ vs จ่าย ต่อบัญชี</h3>
        <div style="position:relative;height:300px"><canvas id="edAcctBars"></canvas></div>
      </div>
    </div>
    <div class="card">
      <h3>สรุปยอดต่อบัญชี (${acctEntries.length} บัญชี)</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>ธนาคาร</th><th>เลขบัญชี</th>${hasNick?"<th>ชื่อบัญชี</th>":""}<th style="text-align:right">รายการ</th><th style="text-align:right;color:var(--ok)">รับ</th><th style="text-align:right;color:var(--bad)">จ่าย</th><th style="text-align:right">สุทธิ</th><th style="text-align:right">ยอดล่าสุด</th></tr></thead>
        <tbody>${acctEntries.map(([k,v])=>{
          const last = d.data.accounts[k] ? d.data.accounts[k].lastClose : null;
          return `<tr style="cursor:pointer" onclick="CfpEd.edDrillAcct(${JSON.stringify(k).replace(/"/g,'&quot;')})">
            <td><b>${esc(v.bank)}</b></td><td><code>${esc(v.no)}</code></td>${hasNick?`<td style="font-size:12px;color:var(--ink-3)">${esc(v.nick||"")}</td>`:""}
            <td style="text-align:right">${v.count}</td>
            <td style="text-align:right;color:var(--ok)">${edFmt(v.in)}</td>
            <td style="text-align:right;color:var(--bad)">${edFmt(v.out)}</td>
            <td style="text-align:right;font-weight:700;color:${v.net>=0?ED_COLORS.in:"#fb5e6d"}">${edFmt(v.net)}</td>
            <td style="text-align:right;font-weight:700">${edFmt(last)}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </div>
  `;

  const palette = ["#2e8b4a","#a3d4b3","#15c486","#e08a3c","#9b7bff","#fb5e6d","#0ea5e9","#84cc16"];
  edMakeChart("edAcctDonut", {
    type:"doughnut",
    data:{
      labels: acctEntries.map(([k,v])=>v.bank+" "+v.no),
      datasets:[{
        data: acctEntries.map(([k,v])=> Math.max(0, d.data.accounts[k] ? d.data.accounts[k].lastClose : 0)),
        backgroundColor: acctEntries.map((_,i)=>palette[i%palette.length])
      }]
    },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:"bottom", labels:{ font:{ size:11 } } }, tooltip:{ callbacks:{ label:c=>c.label+": "+edFmt(c.parsed) } } } }
  });
  edMakeChart("edAcctBars", {
    type:"bar",
    data:{
      labels: acctEntries.map(([k,v])=>v.bank+" "+edNoShort(v.no)),
      datasets:[
        { label:"รับ",  data: acctEntries.map(([k,v])=>v.in),  backgroundColor: ED_COLORS.in, borderRadius:6 },
        { label:"จ่าย", data: acctEntries.map(([k,v])=>v.out), backgroundColor: ED_COLORS.out, borderRadius:6 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false, indexAxis:"y",
      scales:{ x:{ ticks:{ callback:v=>edFmtCompact(v) } } },
      plugins:{ legend:{position:"bottom"}, tooltip:{ callbacks:{ label:c=>c.dataset.label+": "+edFmt(c.parsed.x) } } }
    }
  });
}

/* ---------- Tab 5: Transaction Explorer ---------- */
// explorer state now in edState()
/* เพดานแถวที่ render ในตาราง (Export ได้ทั้งหมดเสมอ) — 2,000 แถวยัง render ไหวสบาย */
const ED_EXP_CAP = 2000;
function edExpSet(k,v){ edState().explorer[k]=v; edRenderExplorer(); }
function edExpSort(c){ const e=edState().explorer; if(e.sort===c) e.desc=!e.desc; else { e.sort=c; e.desc=true; } edRenderExplorer(); }

/* ตัวกรองของ Transaction Explorer — ใช้ร่วมกันทั้งตารางบนจอและปุ่ม Export (สิ่งที่เห็น = สิ่งที่ส่งออก) */
function edExplorerFilter(d){
  const A = edAgg(d.data, d.monthFilter);
  const e = d.explorer;

  let txs = A.txs.slice();
  if(e.q){
    const q = e.q.toLowerCase();
    txs = txs.filter(t => (t.note||"").toLowerCase().includes(q) || (t.ref||"").toLowerCase().includes(q) || (t.category||"").toLowerCase().includes(q));
  }
  if(e.acct!=="all") txs = txs.filter(t=>t.accountKey===e.acct);
  if(e.act!=="all")  txs = txs.filter(t=>t.activityKey===e.act);
  if(e.dir==="in")   txs = txs.filter(t=>t.in>0);
  if(e.dir==="out")  txs = txs.filter(t=>t.out>0);
  return txs;
}
function edRenderExplorer(){
  const d = edState();
  const e = d.explorer;

  let txs = edExplorerFilter(d);   // ★ ตัวกรองชุดเดียวกับปุ่ม Export

  txs.sort((a,b)=>{
    let av=a[e.sort], bv=b[e.sort];
    if(e.sort==="date"){ av=a.date.getTime(); bv=b.date.getTime(); }
    if(av < bv) return e.desc?1:-1;
    if(av > bv) return e.desc?-1:1;
    return 0;
  });

  const acctOpts = Object.entries(d.data.accounts).map(([k,v])=>`<option value="${esc(k)}" ${e.acct===k?'selected':''}>${esc(v.bank)} ${esc(v.no)}</option>`).join("");
  const sortIcon = c => e.sort===c ? (e.desc?" ↓":" ↑") : "";

  edContentEl().innerHTML = `
    <div class="card">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <input type="text" placeholder="ค้นหา หมายเหตุ / เลขที่ / หมวด" value="${esc(e.q)}" oninput="CfpEd.edExpSet('q',this.value)"
          style="flex:1;min-width:200px;padding:7px 11px;border:1px solid var(--line);border-radius:7px;font-size:13px">
        <select onchange="CfpEd.edExpSet('acct',this.value)" style="padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:13px"><option value="all">ทุกบัญชี</option>${acctOpts}</select>
        <select onchange="CfpEd.edExpSet('act',this.value)" style="padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:13px">
          <option value="all" ${e.act==="all"?"selected":""}>ทุกกิจกรรม</option>
          <option value="operating" ${e.act==="operating"?"selected":""}>ดำเนินงาน</option>
          <option value="investing" ${e.act==="investing"?"selected":""}>ลงทุน</option>
          <option value="financing" ${e.act==="financing"?"selected":""}>จัดหาเงิน</option>
          <option value="other" ${e.act==="other"?"selected":""}>อื่น ๆ</option>
        </select>
        <select onchange="CfpEd.edExpSet('dir',this.value)" style="padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:13px">
          <option value="all" ${e.dir==="all"?"selected":""}>รับ + จ่าย</option>
          <option value="in"  ${e.dir==="in"?"selected":""}>รับเท่านั้น</option>
          <option value="out" ${e.dir==="out"?"selected":""}>จ่ายเท่านั้น</option>
        </select>
        ${edTallBtn(d)}
        <button class="btn ghost btn sm" onclick="CfpEd.edExportTxs('xlsx')">Export Excel</button>
        <button class="btn ghost btn sm" onclick="CfpEd.edExportTxs('csv')">Export CSV</button>
      </div>
      <div style="font-size:12px;color:var(--ink-3);margin-bottom:8px">${txs.length.toLocaleString()} รายการ · รับรวม <span style="color:var(--ok);font-weight:700">${edFmt(txs.reduce((s,t)=>s+t.in,0))}</span> · จ่ายรวม <span style="color:var(--bad);font-weight:700">${edFmt(txs.reduce((s,t)=>s+t.out,0))}</span></div>
      <div class="table-wrap" style="${edTallStyle(d)}"><table>
        <thead><tr>
          <th onclick="CfpEd.edExpSort('date')" style="cursor:pointer">วันที่${sortIcon("date")}</th>
          ${d.data.hasMne===false?"":"<th>รหัส</th>"}<th>เลขที่</th>
          <th onclick="CfpEd.edExpSort('bank')" style="cursor:pointer">บัญชี${sortIcon("bank")}</th>
          <th>หมวด</th>
          <th onclick="CfpEd.edExpSort('in')" style="text-align:right;cursor:pointer;color:var(--ok)">รับ${sortIcon("in")}</th>
          <th onclick="CfpEd.edExpSort('out')" style="text-align:right;cursor:pointer;color:var(--bad)">จ่าย${sortIcon("out")}</th>
          <th style="text-align:right">คงเหลือ</th>
          <th>หมายเหตุ</th>
        </tr></thead>
        <tbody>${txs.slice(0,ED_EXP_CAP).map(t=>`<tr>
          <td>${t.dateISO}</td>
          ${d.data.hasMne===false?"":`<td style="font-size:11px">${esc(t.mne)}</td>`}
          <td><code style="font-size:11px">${esc(t.ref)}</code></td>
          <td style="font-size:12px"><b>${esc(t.bank)}</b> ${esc(edNoShort(t.accountNo))}</td>
          <td style="font-size:12px">${esc(t.category)}</td>
          <td style="text-align:right;color:var(--ok)">${t.in>0?edFmt(t.in):"—"}</td>
          <td style="text-align:right;color:var(--bad)">${t.out>0?edFmt(t.out):"—"}</td>
          <td style="text-align:right;font-size:12px;color:var(--ink-3)">${edFmt(t.balance)}</td>
          <td style="font-size:12px;color:var(--ink-2);max-width:300px;white-space:normal">${esc(t.note)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      ${txs.length>ED_EXP_CAP?`<div style="font-size:12px;color:var(--ink-3);margin-top:8px">แสดง ${ED_EXP_CAP.toLocaleString()} แถวแรก จาก ${txs.length.toLocaleString()} — Export เพื่อดูทั้งหมด</div>`:""}
    </div>
  `;
}
/* ===================== ส่งออก Excel แบบจัดรูปแบบ (Executive Dashboard) =====================
   ใช้ xlsx-js-style (โหลดเป็น XLSX อยู่แล้ว) — เขียนสี/กรอบ/ฟอนต์/รูปแบบตัวเลข/ผสานเซลล์/ตัวกรอง/ลิงก์ชีตได้
   ★ ไลบรารีไม่เขียน "ตรึงแนว" (freeze panes) ให้ — edXlsSave แทรก <pane> ในไฟล์เองด้วย JSZip */
/* ชื่อบริษัทในชื่อไฟล์: mbark → Mbark · benya → Benya */
function edCoTag(){
  return "BIOAXEL";   // ★ BIO: ชื่อบริษัทในชื่อไฟล์
}
/* ช่วงข้อมูลในชื่อไฟล์ จาก month key "YYYY.MM": เดือนเดียว 01.2026 · ปีเดียวกัน 01-03.2026 · ข้ามปี 12.2025-02.2026 */
function edPeriodTag(monthKeys){
  const ks = Array.from(new Set((monthKeys || []).filter(Boolean).map(String))).sort();
  if(!ks.length) return stamp();
  const [y1, m1] = ks[0].split("."), [y2, m2] = ks[ks.length-1].split(".");
  if(ks.length === 1) return `${m1}.${y1}`;
  if(y1 === y2) return `${m1}-${m2}.${y1}`;
  return `${m1}.${y1}-${m2}.${y2}`;
}
/* ป้ายบัญชี: ในชื่อไฟล์ = SCB4889 · ในหัวรายงาน = SCB 136-2-684889 (4889) */
function edAcctTag(acc){
  const digits = String((acc && acc.no) || "").replace(/\D/g, "");
  return String((acc && acc.bank) || "").replace(/[^A-Za-z0-9]/g, "") + digits.slice(-4);
}
function edAcctLabel(acc){
  if(!acc) return "";
  return `${acc.bank || ""} ${acc.no || ""}`.trim() + (acc.nick ? ` (${acc.nick})` : "");
}
/* "2026-01-05" → "5 มกราคม 2569" */
function edThaiDateLong(iso){
  const [y, m, d] = String(iso || "").slice(0,10).split("-").map(Number);
  if(!y || !m || !d) return String(iso || "");
  return `${d} ${TH_MONTHS[m-1]} ${y + 543}`;
}
function edXlsNow(){
  const n = new Date(), p = v => String(v).padStart(2, "0");
  return `${p(n.getDate())}/${p(n.getMonth()+1)}/${n.getFullYear()+543} ${p(n.getHours())}:${p(n.getMinutes())} น.`;
}
/* ISO → เลขวันที่ของ Excel (คิดแบบ UTC กันวันเพี้ยนจาก timezone ไทย) */
function edXlsSerial(iso){
  const [y, m, d] = String(iso || "").slice(0,10).split("-").map(Number);
  if(!y || !m || !d) return null;
  return (Date.UTC(y, m-1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}
/* ชื่อชีต: ห้ามอักขระ [ ] : * ? / และ backslash · ยาวไม่เกิน 31 · ห้ามซ้ำ */
function edXlsSheetName(name, used){
  const BAD = "[]:*?/" + String.fromCharCode(92);
  const clean = Array.from(String(name || "Sheet")).map(ch => BAD.includes(ch) ? " " : ch).join("").replace(/\s+/g, " ").trim();
  const base = clean.slice(0, 31) || "Sheet";
  let n = base, i = 2;
  while(used.has(n)){ const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n);
  return n;
}
/* ชุดสไตล์ — สีหลักตามบริษัท (co.gradient[0]) · ฟอนต์เดียวกับใบกระทบยอดขาย */
function edXlsKit(){
  const co = COMPANIES.find(c => c.id === state.company) || {};
  const hex = v => String(v || "").replace("#", "").toUpperCase();
  const brand = hex((co.gradient && co.gradient[0]) || "#0d9488");
  const FONT = "IBM Plex Sans Thai";
  const line = { style:"thin", color:{ rgb:"CBD5E1" } };
  const border = { top:line, bottom:line, left:line, right:line };
  const fill = rgb => rgb ? { patternType:"solid", fgColor:{ rgb:hex(rgb) } } : undefined;
  const font = (o = {}) => ({ name:FONT, sz:o.sz || 10.5, bold:!!o.bold, color:{ rgb:hex(o.color || "1E293B") } });
  const align = (h, o = {}) => { const a = { horizontal:h, vertical:"center" }; if(o.wrap) a.wrapText = true; if(o.indent) a.indent = o.indent; return a; };
  const NUM = '#,##0.00;[Red](#,##0.00);"-"';   // ติดลบ = วงเล็บสีแดง · ศูนย์ = "-"
  return {
    co, brand, NUM,
    title:    v => ({ v, t:"s", s:{ font:font({ sz:15, bold:true, color:"FFFFFF" }), fill:fill(brand), alignment:align("left") } }),
    subtitle: v => ({ v, t:"s", s:{ font:font({ sz:12, bold:true, color:brand }), alignment:align("left") } }),
    meta:     v => ({ v, t:"s", s:{ font:font({ sz:10, color:"475569" }), alignment:align("left") } }),
    head: (v, o = {}) => ({ v, t:"s", s:{ font:font({ bold:true, color:o.color || "FFFFFF" }), fill:fill(o.bg || brand), border, alignment:align(o.h || "center", { wrap:true }) } }),
    txt:  (v, o = {}) => ({ v:v == null ? "" : String(v), t:"s", s:{ font:font({ bold:o.bold, color:o.color }), fill:fill(o.bg), border, alignment:align(o.h || "left", o) } }),
    num:  (v, o = {}) => {
      const c = { v:Math.round((Number(v) || 0) * 100) / 100, t:"n", z:o.fmt || NUM,
        s:{ numFmt:o.fmt || NUM, font:font({ bold:o.bold, color:o.color }), fill:fill(o.bg), border, alignment:align("right") } };
      if(o.f) c.f = o.f;
      return c;
    },
    int:  (v, o = {}) => ({ v:Number(v) || 0, t:"n", z:"#,##0", s:{ numFmt:"#,##0", font:font({ bold:o.bold }), fill:fill(o.bg), border, alignment:align("center") } }),
    date: (iso, o = {}) => {
      const n = edXlsSerial(iso);
      if(n == null) return { v:String(iso || ""), t:"s", s:{ font:font(), fill:fill(o.bg), border, alignment:align("center") } };
      return { v:n, t:"n", z:"dd/mm/yyyy", s:{ numFmt:"dd/mm/yyyy", font:font(), fill:fill(o.bg), border, alignment:align("center") } };
    },
    link: (v, sheet, o = {}) => ({ v, t:"s", l:{ Target:`#'${String(sheet).replace(/'/g, "''")}'!A1`, Tooltip:"ไปที่ชีต " + sheet },
      s:{ font:{ name:FONT, sz:10.5, underline:true, color:{ rgb:"2563EB" } }, fill:fill(o.bg), border, alignment:align("left") } }),
  };
}
/* สร้างชีตจากตาราง cell spec ({v,t,s,z,f,l} หรือ null)
   opts: cols (ความกว้าง wch ต่อคอลัมน์) · merges · rows ({แถว: ความสูง pt}) · autofilter ("A6:K40") */
function edXlsBuild(cells, opts = {}){
  const ws = {};
  let maxC = 0;
  cells.forEach((row, r) => (row || []).forEach((c, ci) => {
    if(!c) return;
    const cell = { v:c.v, t:c.t || "s" };
    if(c.s) cell.s = c.s;
    if(c.z) cell.z = c.z;
    if(c.f) cell.f = c.f;
    if(c.l) cell.l = c.l;
    ws[XLSX.utils.encode_cell({ r, c:ci })] = cell;
    if(ci > maxC) maxC = ci;
  }));
  ws["!ref"] = XLSX.utils.encode_range({ s:{ r:0, c:0 }, e:{ r:Math.max(0, cells.length - 1), c:maxC } });
  if(opts.cols) ws["!cols"] = opts.cols.map(w => ({ wch:w }));
  if(opts.merges && opts.merges.length) ws["!merges"] = opts.merges;
  if(opts.rows){ const arr = []; for(const k in opts.rows) arr[Number(k)] = { hpt:opts.rows[k] }; ws["!rows"] = arr; }
  if(opts.autofilter) ws["!autofilter"] = { ref:opts.autofilter };
  return ws;
}
/* บันทึกไฟล์ + ตรึงแนว — freeze: { ชื่อชีต: { row: แถวบนที่ตรึง, col: คอลัมน์ซ้ายที่ตรึง } }
   ขั้นตรึงแนวพังตรงไหน = บันทึกแบบไม่ตรึงแทน (ข้อมูล/รูปแบบยังครบ) */
async function edXlsSave(wb, filename, freeze){
  // ★ POG: ไม่มี JSZip → แก้ไฟล์ในซิปด้วย XLSX.CFB (มากับ xlsx-js-style) แบบเดียวกับ Fleet Card
  try{
    const CFB = XLSX.CFB;
    if(!freeze || !CFB || !CFB.utils || !CFB.utils.cfb_add) throw new Error("no-freeze");
    const cfb = CFB.read(XLSX.write(wb, { type:"base64", bookType:"xlsx" }), { type:"base64" });
    for(let i = 0; i < wb.SheetNames.length; i++){
      const fz = freeze[wb.SheetNames[i]];
      if(!fz || (!fz.row && !fz.col)) continue;
      const path = "/xl/worksheets/sheet" + (i+1) + ".xml";
      const ent = CFB.find(cfb, path);
      if(!ent) continue;
      const xml = new TextDecoder("utf-8").decode(new Uint8Array(ent.content));
      const ref = XLSX.utils.encode_cell({ r:fz.row || 0, c:fz.col || 0 });
      const pane = fz.row && fz.col ? "bottomRight" : (fz.row ? "bottomLeft" : "topRight");
      const paneXml = `<pane${fz.col ? ` xSplit="${fz.col}"` : ""}${fz.row ? ` ySplit="${fz.row}"` : ""} topLeftCell="${ref}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${ref}" sqref="${ref}"/>`;
      CFB.utils.cfb_add(cfb, path, new TextEncoder().encode(xml.replace(/<sheetView([^>]*?)\/>/, `<sheetView$1>${paneXml}</sheetView>`)));
    }
    const bin = atob(CFB.write(cfb, { fileType:"zip", type:"base64", compression:true }));
    const bytes = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob); el.download = filename; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(el.href), 1500);
  }catch(e){
    XLSX.writeFile(wb, filename);
  }
}

/* ส่งออกรายการ — ตามตัวกรองที่เห็นบนจอ (ช่วงเวลา/ค้นหา/บัญชี/กิจกรรม/รับ-จ่าย)
   Excel: หลายบัญชี = ชีต "สรุป" + ชีตแยกต่อบัญชี · บัญชีเดียว = ชีตเดียว · มีหัวรายงาน/หัวตาราง/กรอบ/สี/ยอดรวม
   CSV: ตารางเดียวทุกบัญชี (เอาไปทำ pivot ต่อ)
   ชื่อไฟล์ = บริษัท_Transaction_ช่วงข้อมูลจริง เช่น Mbark_Transaction_01.2026 */
function edExportTxs(fmt){
  const d = edState();
  const e = d.explorer;
  const txs = edExplorerFilter(d).sort((a,b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));   // sort เสถียร → ในวันเดียวกันคงลำดับเดิมของไฟล์ธนาคาร
  if(!txs.length){ alert("ไม่มีรายการให้ส่งออกตามตัวกรองที่เลือก"); return; }
  const accs = d.data.accounts || {};
  const single = e.acct && e.acct !== "all" ? accs[e.acct] : null;
  const base = `${edCoTag()}_Transaction${single ? "_" + edAcctTag(single) : ""}_${edPeriodTag(txs.map(t => t.month))}`;

  if(fmt === "csv"){
    const rows = [["วันที่","รหัส","เลขที่","ธนาคาร","เลขบัญชี","ชื่อบัญชี","หมวด","กิจกรรม","รับ","จ่าย","คงเหลือ","สถานะ","หมายเหตุ"]];
    for(const t of txs) rows.push([t.dateISO, t.mne, t.ref, t.bank, t.accountNo, t.accountNick, t.category, t.activity, t.in, t.out, t.balance, t.status, t.note]);
    if(d.data.hasMne===false) rows.forEach(r => r.splice(1, 1));   // ★ BIO: ไม่มีรหัส
    download("\uFEFF" + XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(rows)), base + ".csv", "text/csv;charset=utf-8");
    return;
  }

  const K = edXlsKit();
  const coName = K.co.fullName || K.co.name || d.data.company || "";
  const filt = [];
  if(e.q) filt.push(`ค้นหา “${e.q}”`);
  if(e.act !== "all") filt.push(ED_STMT_ACT_SHORT[e.act] || e.act);
  if(e.dir === "in")  filt.push("รับเท่านั้น");
  if(e.dir === "out") filt.push("จ่ายเท่านั้น");
  const filtTxt = filt.length ? filt.join(" · ") : "ไม่มี (ทุกรายการ)";
  const scopeTxt = edScopeLabel(d.monthFilter);
  const range = list => `${edThaiDateLong(list[0].dateISO)} – ${edThaiDateLong(list[list.length-1].dateISO)}`;
  const TOT = "E2E8F0", ZEBRA = "F8FAFC", GREEN = "15803D", RED = "B91C1C";

  // จัดกลุ่มตามบัญชี — ลำดับชีตตามทะเบียนบัญชี
  const byAcct = new Map();
  for(const t of txs){ if(!byAcct.has(t.accountKey)) byAcct.set(t.accountKey, []); byAcct.get(t.accountKey).push(t); }
  const order = Object.keys(accs).filter(k => byAcct.has(k)).concat([...byAcct.keys()].filter(k => !(k in accs)));
  const acctOf = k => accs[k] || { bank:byAcct.get(k)[0].bank, no:byAcct.get(k)[0].accountNo, nick:byAcct.get(k)[0].accountNick };
  const multi = order.length > 1;
  const used = new Set(multi ? ["สรุป"] : []);
  const sheetOf = {};
  for(const k of order){ const a = acctOf(k); sheetOf[k] = edXlsSheetName(`${a.bank || ""} ${a.no || ""}`, used); }
  const wb = XLSX.utils.book_new();
  const freeze = {};
  const titleMerges = lastCol => [0,1,2,3].map(r => ({ s:{ r, c:0 }, e:{ r, c:lastCol } }));

  // ===== ชีตสรุป (เฉพาะเมื่อมีหลายบัญชี) =====
  if(multi){
    const H = ["ลำดับ","ธนาคาร","เลขที่บัญชี","ชื่อบัญชี","ช่วงข้อมูล","จำนวนรายการ","รับ","จ่าย","สุทธิ (รับ − จ่าย)","ดูรายการ"];
    const cells = [
      [K.title(coName)],
      [K.subtitle("สรุปรายการเดินบัญชีธนาคาร (Transaction Summary)")],
      [K.meta(`ช่วงข้อมูล: ${range(txs)} · ขอบเขตที่เลือก: ${scopeTxt} · หน่วย: บาท`)],
      [K.meta(`ตัวกรอง: ${filtTxt} · ส่งออกเมื่อ ${edXlsNow()}`)],
      [],
      H.map(h => K.head(h)),
    ];
    const r0 = cells.length;                       // แถวหัวตาราง (เลขแถว Excel) = r0 · ข้อมูลเริ่ม r0+1
    order.forEach((k, i) => {
      const list = byAcct.get(k), a = acctOf(k), bg = i % 2 ? ZEBRA : null, R = r0 + i + 1;
      const tin = list.reduce((s,t) => s + t.in, 0), tout = list.reduce((s,t) => s + t.out, 0);
      cells.push([
        K.int(i + 1, { bg }), K.txt(a.bank, { bg, h:"center", bold:true }), K.txt(a.no, { bg, h:"center" }), K.txt(a.nick || "", { bg }),
        K.txt(range(list), { bg }), K.int(list.length, { bg }),
        K.num(tin, { bg, color:GREEN }), K.num(tout, { bg, color:RED }), K.num(tin - tout, { bg, bold:true, f:`G${R}-H${R}` }),
        K.link(sheetOf[k], sheetOf[k], { bg }),
      ]);
    });
    const first = r0 + 1, last = r0 + order.length;
    const allIn = txs.reduce((s,t) => s + t.in, 0), allOut = txs.reduce((s,t) => s + t.out, 0);
    cells.push([
      K.txt("รวมทุกบัญชี", { bold:true, bg:TOT, h:"center" }), K.txt("", { bg:TOT }), K.txt("", { bg:TOT }), K.txt("", { bg:TOT }), K.txt("", { bg:TOT }),
      Object.assign(K.int(txs.length, { bold:true, bg:TOT }), { f:`SUM(F${first}:F${last})` }),
      K.num(allIn, { bold:true, bg:TOT, color:GREEN, f:`SUM(G${first}:G${last})` }),
      K.num(allOut, { bold:true, bg:TOT, color:RED, f:`SUM(H${first}:H${last})` }),
      K.num(allIn - allOut, { bold:true, bg:TOT, f:`SUM(I${first}:I${last})` }),
      K.txt("", { bg:TOT }),
    ]);
    const lastCol = H.length - 1;
    XLSX.utils.book_append_sheet(wb, edXlsBuild(cells, {
      cols:[7, 9, 18, 14, 36, 12, 16, 16, 18, 22],
      merges:titleMerges(lastCol).concat([{ s:{ r:cells.length-1, c:0 }, e:{ r:cells.length-1, c:4 } }]),
      rows:{ 0:30, 5:24 },
      autofilter:`A${r0}:${XLSX.utils.encode_col(lastCol)}${last}`,
    }), "สรุป");
    freeze["สรุป"] = { row:r0 };
  }

  // ===== ชีตต่อบัญชี =====
  const H = ["ลำดับ","วันที่","รหัส","เลขที่","หมวด","กิจกรรม","รับ","จ่าย","คงเหลือ","สถานะ","หมายเหตุ"];
  for(const k of order){
    const list = byAcct.get(k), a = acctOf(k), name = sheetOf[k];
    const cells = [
      [K.title(coName)],
      [K.subtitle(`รายการเดินบัญชี (Transaction) · ${edAcctLabel(a)}`)],
      [K.meta(`ช่วงข้อมูล: ${range(list)} · ${list.length.toLocaleString()} รายการ · หน่วย: บาท`)],
      [K.meta(`ตัวกรอง: ${filtTxt} · ขอบเขตที่เลือก: ${scopeTxt} · ส่งออกเมื่อ ${edXlsNow()}`)],
      [],
      H.map(h => K.head(h)),
    ];
    const r0 = cells.length;
    list.forEach((t, i) => {
      const bg = i % 2 ? ZEBRA : null;
      cells.push([
        K.int(i + 1, { bg }), K.date(t.dateISO, { bg }), K.txt(t.mne, { bg, h:"center" }), K.txt(t.ref, { bg }),
        K.txt(t.category, { bg, wrap:true }), K.txt(t.activity, { bg }),
        K.num(t.in, { bg, color:GREEN }), K.num(t.out, { bg, color:RED }), K.num(t.balance, { bg }),
        K.txt(t.status, { bg, h:"center" }), K.txt(t.note, { bg, wrap:true }),
      ]);
    });
    const first = r0 + 1, last = r0 + list.length;
    const tin = list.reduce((s,t) => s + t.in, 0), tout = list.reduce((s,t) => s + t.out, 0);
    // คงเหลือปลายงวด = ยอดคงเหลือของรายการสุดท้าย — โชว์เฉพาะตอนไม่ได้กรอง (กรองแล้วยอดนี้ไม่ใช่ยอดปลายงวดจริง)
    const closeCell = filt.length ? K.txt("", { bg:TOT }) : K.num(list[list.length-1].balance, { bold:true, bg:TOT });
    cells.push([
      K.txt("รวม", { bold:true, bg:TOT, h:"center" }), K.txt("", { bg:TOT }), K.txt("", { bg:TOT }), K.txt("", { bg:TOT }), K.txt("", { bg:TOT }),
      K.txt(`${list.length.toLocaleString()} รายการ`, { bold:true, bg:TOT, h:"right" }),
      K.num(tin, { bold:true, bg:TOT, color:GREEN, f:`SUM(G${first}:G${last})` }),
      K.num(tout, { bold:true, bg:TOT, color:RED, f:`SUM(H${first}:H${last})` }),
      closeCell,
      K.txt("", { bg:TOT }),
      K.txt(filt.length ? "" : "คงเหลือ = ยอดคงเหลือหลังรายการสุดท้ายของช่วง", { bg:TOT, color:"64748B" }),
    ]);
    const lastCol = H.length - 1;
    XLSX.utils.book_append_sheet(wb, edXlsBuild(cells, {
      cols:[7, 12, 8, 17, 40, 18, 15, 15, 17, 11, 50],
      merges:titleMerges(lastCol).concat([{ s:{ r:cells.length-1, c:0 }, e:{ r:cells.length-1, c:4 } }]),
      rows:{ 0:30, 5:24 },
      autofilter:`A${r0}:${XLSX.utils.encode_col(lastCol)}${last}`,
    }), name);
    freeze[name] = { row:r0 };
  }
  edXlsSave(wb, base + ".xlsx", freeze);
}

/* ---------- Tab 6: Statement (งบกระแสเงินสด) ---------- */
// stmtAcct state now in edState()
/* ── Benya index.html 5709–6174 ── */
function edStmtAcct(v){ edState().stmtAcct = v; edRenderStmt(); }
/* ขยาย/ย่อ ความสูงตาราง (ใช้ร่วมกันทั้งแท็บงบกระแสเงินสดและ Transaction Explorer)
   ค่าปกติอิงความสูงจอ — จอใหญ่ได้พื้นที่มากขึ้นเอง */
function edToggleStmtTall(){
  const d=edState(); d.stmtTall=!d.stmtTall;
  if(d.tab==="explorer") edRenderExplorer(); else edRenderStmt();
}
function edTallBtn(d){
  return `<button class="btn ghost btn sm" onclick="CfpEd.edToggleStmtTall()" title="ขยายตารางให้เต็มความสูงจอ / ย่อกลับ">${d.stmtTall?"↕ ย่อตาราง":"↕ ขยายตาราง"}</button>`;
}
function edTallStyle(d){ return `max-height:${d.stmtTall?"calc(100vh - 130px)":"calc(100vh - 300px)"};min-height:380px`; }

/* MBark vs Benya — palette สำหรับงบกระแสเงินสด */
function edStmtPalette(){
  // ★ POG: โทนสีงบเดิมของหน้า POG — หัวกิจกรรม/สุทธิ = น้ำเงิน · เงินสดรับ = เขียว · เงินสดจ่าย = แดง
  return {
    actBg:"#cde6d4", actText:"#1f6e3a",
    inBg:"#e2faf0",  inText:"#15875a",  inSubBg:"#f1fcf7", inTotalBg:"#c3f0de", inRowTotalBg:"#eef6f1",
    outBg:"#ffe9ec", outText:"#c0392b", outSubBg:"#fff5f6", outTotalBg:"#ffd3d9", outRowTotalBg:"#eef6f1",
    netBg:"#d8eede", netTotalBg:"#b3dcc0", netAccent:"#1f6e3a",
    openBg:"#f4faf6", openTotalBg:"#e8f4ec", openCloseBg:"#cfe7d6",
    netPosText:"#15875a", netNegText:"#c0392b"
  };
}

/* ★ โมเดลตัวเลขงบกระแสเงินสด — ใช้ร่วมกันทั้งหน้าจอ (edRenderStmt) และไฟล์ Excel (edExportStmtXlsx)
   ห้ามคัดลอกสูตรไปไว้อีกที่ ไม่งั้นวันหนึ่งตัวเลขในไฟล์กับบนจอจะไม่ตรงกัน
   filterAcct: "all" = รวมทุกบัญชี · accountKey = เฉพาะบัญชีนั้น */
const ED_STMT_ACT_LABEL = { operating:"กระแสเงินสดจากกิจกรรมดำเนินงาน", investing:"กระแสเงินสดจากกิจกรรมลงทุน", financing:"กระแสเงินสดจากกิจกรรมจัดหาเงิน", other:"อื่น ๆ" };
const ED_STMT_ACT_SHORT = { operating:"กิจกรรมดำเนินงาน", investing:"กิจกรรมลงทุน", financing:"กิจกรรมจัดหาเงิน", other:"อื่น ๆ" };
function edStmtModel(data, monthFilter, filterAcct){
  const months = edScopeMonthKeys(data, monthFilter);
  const acct = filterAcct || "all";
  const cats = {};   // catKey → { in:[m], out:[m] }
  for(const t of data.transactions){
    if(acct!=="all" && t.accountKey!==acct) continue;
    if(edIsTransfer(t)) continue;  // ★ ตัด "เงินโอนระหว่างบัญชี" ออก (ทำให้ยอดรับ/จ่ายเกินจริง)
    const k = t.category + "|" + t.activityKey;
    if(!cats[k]) cats[k] = { cat:t.category, act:t.activityKey, code:t.code || "", in:Array(months.length).fill(0), out:Array(months.length).fill(0) };
    if(t.code && (!cats[k].code || t.code < cats[k].code)) cats[k].code = t.code;
    const mi = months.indexOf(t.month);
    if(mi>=0){ cats[k].in[mi] += t.in; cats[k].out[mi] += t.out; }
  }
  const groups = { operating:[], investing:[], financing:[], other:[] };
  for(const k in cats) groups[cats[k].act].push(cats[k]);
  // ยอดต้นงวด/ปลายงวดของเดือน = ผลรวมบัญชีในเดือนนั้น (เฉพาะบัญชีที่เลือก)
  const monthSum = (m, pick) => {
    const mObj = data.months.find(x=>x.key===m);
    if(!mObj) return 0;
    let s = 0;
    for(const a of mObj.accounts){ if(acct==="all" || a.accountKey===acct) s += pick(a); }
    return s;
  };
  const openings = months.map(m => monthSum(m, a => a.opening));
  const closings = months.map(m => monthSum(m, a => (a.closing || a.computed)));
  const sumArr  = a => a.reduce((s,v)=>s+v,0);
  const catNet  = c => c.in.map((v,i)=> v - c.out[i]);          // ★ net รับ-จ่าย ต่อเดือน (หัก refund กลบกันในหมวด)
  const nonZero = arr => arr.some(v => Math.abs(v) > 0.005);
  // ★ จัดประเภทหมวด → 'in'/'out' ตาม "ชื่อหมวด" (กันหมวดรายจ่ายที่มี refund บวก ไปโผล่ฝั่งรายรับ) · ชื่อไม่ชัด → ดู net รวม
  const stmtSide = c => {
    const dg = String(c.code || "").replace(/\D/g, "")[0];   // ★ POG: เลขหน้ารหัส 1/3/5 = รับ · 2/4/6 = จ่าย
    if(dg && dg !== "0") return "135".indexOf(dg) >= 0 ? "in" : "out";
    const n = c.cat || "";
    if(/^\s*(รายรับ|รายได้|เงินสดรับ|เงินรับ)/.test(n)) return "in";
    if(/^\s*(รายจ่าย|ค่าใช้จ่าย|เงินสดจ่าย|เงินจ่าย)/.test(n)) return "out";
    return sumArr(catNet(c)) >= 0 ? "in" : "out";
  };
  const toRows = (list, sub) => list.map(c => { const net = catNet(c); net.forEach((v,i) => sub[i] += v); return { cat:c.cat, net, total:sumArr(net) }; });
  const sections = [];
  for(const act of ["operating","investing","financing","other"]){
    if(!groups[act].length) continue;
    const inCats = groups[act].filter(c => stmtSide(c)==="in" && nonZero(catNet(c)))
      .sort((a,b) => sumArr(catNet(b)) - sumArr(catNet(a)));
    const outCats = groups[act].filter(c => stmtSide(c)==="out" && nonZero(catNet(c)))
      .sort((a,b) => sumArr(catNet(a)) - sumArr(catNet(b)));   // ติดลบมากสุดก่อน
    const inSub = Array(months.length).fill(0), outSub = Array(months.length).fill(0);
    const inRows = toRows(inCats, inSub), outRows = toRows(outCats, outSub);
    const netByMonth = inSub.map((v,i) => v + outSub[i]);
    sections.push({ act, inRows, inSub, outRows, outSub, netByMonth, netTotal:sumArr(netByMonth) });
  }
  const netChange = months.map((m,i)=> closings[i]-openings[i]);
  return { months, openings, closings, sections, netChange, totalNet:netChange.reduce((s,v)=>s+v,0) };
}

function edRenderStmt(){
  const d = edState();
  // โชว์คอลัมน์ตาม scope ที่เลือก (ทุกปี=ทุกเดือน · เลือกปี=เฉพาะปีนั้น · เลือกเดือน=เดือนเดียว)
  const M = edStmtModel(d.data, d.monthFilter, d.stmtAcct);  // ★ ตัวเลขชุดเดียวกับไฟล์ Excel (edExportStmtXlsx)
  const months = M.months, openings = M.openings, closings = M.closings;
  const filterAcct = d.stmtAcct;
  const C = edStmtPalette();  // ★ สีตามบริษัท

  const acctOpts = Object.entries(d.data.accounts).map(([k,v])=>`<option value="${esc(k)}" ${filterAcct===k?'selected':''}>${esc(v.bank)} ${esc(v.no)}</option>`).join("");

  let html = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px" data-pdf-hide="1">
        <h3 style="margin:0">งบกระแสเงินสด — รายเดือน <span style="font-size:11px;font-weight:500;color:var(--ink-3)">· คลิกชื่อหมวด = คลี่รายการ · คลิกตัวเลข = ดูป๊อปอัพ</span></h3>
        <div style="display:flex;gap:8px;align-items:center">
          ${edTallBtn(d)}
          <button class="btn ghost btn sm" onclick="CfpEd.edExportStmtXlsx()" title="ส่งออกงบกระแสเงินสดเป็น Excel ตามช่วงเวลาและบัญชีที่เลือก">Export Excel</button>
          <select onchange="CfpEd.edStmtAcct(this.value)" style="padding:6px 10px;border:1px solid var(--line);border-radius:7px;font-size:13px">
            <option value="all" ${filterAcct==="all"?"selected":""}>รวมทุกบัญชี</option>${acctOpts}
          </select>
        </div>
      </div>
      <div data-pdf-only="1" style="display:none;margin-bottom:10px">
        <h3 style="margin:0;color:${C.actText}">งบกระแสเงินสด — รายเดือน${filterAcct!=="all"?` · ${esc((d.data.accounts[filterAcct]&&d.data.accounts[filterAcct].bank)||'')} ${esc((d.data.accounts[filterAcct]&&d.data.accounts[filterAcct].no)||'')}`:" · รวมทุกบัญชี"}</h3>
      </div>
      <div class="table-wrap" style="${edTallStyle(d)}"><table>
        <thead><tr><th>หมวด</th>${months.map(m=>`<th style="text-align:right">${esc(m)}</th>`).join("")}<th style="text-align:right;background:${C.openTotalBg}">รวม</th></tr></thead>
        <tbody>
          <tr style="background:${C.openBg};font-weight:700;cursor:pointer" title="คลิกดูยอดเปิดต้นงวดต่อบัญชี" onclick="CfpEd.edDrillOpenClose('opening')"><td>เงินสดต้นงวด</td>
            ${openings.map((v,i)=>`<td style="text-align:right" onclick="event.stopPropagation();CfpEd.edDrillOpenCloseMonth('opening','${months[i]}')">${edFmt(v)}</td>`).join("")}
            <td style="text-align:right;background:${C.openTotalBg}">${edFmt(openings[0])}</td></tr>
  `;
  const actLabels = ED_STMT_ACT_LABEL, actShort = ED_STMT_ACT_SHORT;
  const sumArr = a => a.reduce((s,v)=>s+v,0);
  const ncols = months.length + 2;
  // helper: build clickable cell with onclick filter
  const dq = s => JSON.stringify(s == null ? null : s).replace(/"/g,'&quot;');

  const STMT_RED = "#fb5e6d";                                   // ★ สีแดงสำหรับยอดติดลบ
  const stmtClr = v => (Number(v) < -0.005 ? STMT_RED : ED_COLORS.in);  // ★ ติดลบ=แดง · ไม่ติดลบ=สี in (ฟ้าพาสเทล/teal)

  for(const S of M.sections){
    const act = S.act;
    // หัวกิจกรรม
    html += `<tr style="background:${C.actBg}"><td colspan="${ncols}" style="font-weight:800;color:${C.actText};padding:9px 12px;font-size:13.5px">${actLabels[act]}</td></tr>`;

    // ==== เงินสดรับ (หมวดประเภทรับ — แสดง net รับ-จ่าย) ====
    const inSub = S.inSub;
    if(S.inRows.length){
      html += `<tr style="background:${C.inBg}"><td colspan="${ncols}" style="font-weight:700;color:${C.inText};padding:6px 12px;font-size:12.5px">เงินสดรับจาก${actShort[act]}</td></tr>`;
      for(const c of S.inRows){
        const net = c.net;
        const total = c.total;
        html += `<tr><td class="stmt-cat" style="padding-left:16px;color:#0f172a;cursor:pointer" onclick="CfpEd.edStmtToggle(this,${dq(c.cat)},'${act}',null)" title="คลิกเพื่อคลี่รายการ"><span class="stmt-caret" style="display:inline-block;width:12px;color:var(--ink-3);font-size:10px">▶</span> ${esc(c.cat)}</td>` +
          net.map((v,i)=>`<td onclick="CfpEd.edDrillStmt(${dq(c.cat)},'${act}','${months[i]}',null)" style="text-align:right;cursor:pointer;color:${Math.abs(v)>0.005?stmtClr(v):"var(--ink-3)"}" title="คลิกดูรายการ">${Math.abs(v)>0.005?edFmt(v):"—"}</td>`).join("") +
          `<td onclick="CfpEd.edDrillStmt(${dq(c.cat)},'${act}','all',null)" style="text-align:right;background:${C.inRowTotalBg};font-weight:700;cursor:pointer;color:${stmtClr(total)}" title="คลิกดูรายการรวมทั้งปี">${edFmt(total)}</td></tr>`;
      }
      html += `<tr style="background:${C.inSubBg};font-weight:700"><td style="padding-left:18px;color:${C.inText}">รวมเงินสดรับ</td>` +
        inSub.map((v,i)=>`<td onclick="CfpEd.edDrillStmt(null,'${act}','${months[i]}','in')" style="text-align:right;cursor:pointer;color:${stmtClr(v)}" title="คลิกดูที่มา">${edFmt(v)}</td>`).join("") +
        `<td onclick="CfpEd.edDrillStmt(null,'${act}','all','in')" style="text-align:right;background:${C.inTotalBg};cursor:pointer;color:${stmtClr(sumArr(inSub))}" title="คลิกดูที่มา">${edFmt(sumArr(inSub))}</td></tr>`;
    }

    // ==== เงินสดจ่าย (หมวดประเภทจ่าย — net รับ-จ่าย, ปกติติดลบ; refund หักกลบในฝั่งนี้ ไม่ขึ้นรายรับ) ====
    const outSub = S.outSub;
    if(S.outRows.length){
      html += `<tr style="background:${C.outBg}"><td colspan="${ncols}" style="font-weight:700;color:${C.outText};padding:6px 12px;font-size:12.5px">เงินสดจ่ายจาก${actShort[act]}</td></tr>`;
      for(const c of S.outRows){
        const net = c.net;
        const total = c.total;
        html += `<tr><td class="stmt-cat" style="padding-left:16px;color:#0f172a;cursor:pointer" onclick="CfpEd.edStmtToggle(this,${dq(c.cat)},'${act}',null)" title="คลิกเพื่อคลี่รายการ"><span class="stmt-caret" style="display:inline-block;width:12px;color:var(--ink-3);font-size:10px">▶</span> ${esc(c.cat)}</td>` +
          net.map((v,i)=>`<td onclick="CfpEd.edDrillStmt(${dq(c.cat)},'${act}','${months[i]}',null)" style="text-align:right;cursor:pointer;color:${Math.abs(v)>0.005?stmtClr(v):"var(--ink-3)"}" title="คลิกดูรายการ">${Math.abs(v)>0.005?edFmt(v):"—"}</td>`).join("") +
          `<td onclick="CfpEd.edDrillStmt(${dq(c.cat)},'${act}','all',null)" style="text-align:right;background:${C.outRowTotalBg};font-weight:700;cursor:pointer;color:${stmtClr(total)}" title="คลิกดูรายการรวมทั้งปี">${edFmt(total)}</td></tr>`;
      }
      html += `<tr style="background:${C.outSubBg};font-weight:700"><td style="padding-left:18px;color:${C.outText}">รวมเงินสดจ่าย</td>` +
        outSub.map((v,i)=>`<td onclick="CfpEd.edDrillStmt(null,'${act}','${months[i]}','out')" style="text-align:right;cursor:pointer;color:${stmtClr(v)}" title="คลิกดูที่มา">${edFmt(v)}</td>`).join("") +
        `<td onclick="CfpEd.edDrillStmt(null,'${act}','all','out')" style="text-align:right;background:${C.outTotalBg};cursor:pointer;color:${stmtClr(sumArr(outSub))}" title="คลิกดูที่มา">${edFmt(sumArr(outSub))}</td></tr>`;
    }

    // ==== สุทธิของกิจกรรม ====
    const netByMonth = S.netByMonth;
    const netTotal = S.netTotal;
    html += `<tr style="background:${C.netBg};font-weight:800;border-top:2px solid ${C.netTotalBg}"><td style="color:${C.netAccent}">กระแสเงินสดสุทธิจาก${actShort[act]}</td>` +
      netByMonth.map((v,i)=>`<td onclick="CfpEd.edDrillStmt(null,'${act}','${months[i]}',null)" style="text-align:right;cursor:pointer;color:${stmtClr(v)}" title="คลิกดูที่มา">${edFmt(v)}</td>`).join("") +
      `<td onclick="CfpEd.edDrillStmt(null,'${act}','all',null)" style="text-align:right;background:${C.netTotalBg};cursor:pointer;color:${stmtClr(netTotal)}" title="คลิกดูที่มา">${edFmt(netTotal)}</td></tr>`;
  }
  // net change row
  const netChange = M.netChange;
  const totalNet = M.totalNet;
  html += `
    <tr style="background:${C.netBg};font-weight:800;border-top:2px solid ${C.netTotalBg}"><td style="color:${C.netAccent}">เปลี่ยนแปลงเงินสดสุทธิ</td>` +
      netChange.map((v,i)=>`<td onclick="CfpEd.edDrillStmt(null,null,'${months[i]}',null)" style="text-align:right;cursor:pointer;color:${stmtClr(v)}" title="คลิกดูที่มา">${edFmt(v)}</td>`).join("") +
      `<td onclick="CfpEd.edDrillStmt(null,null,'all',null)" style="text-align:right;background:${C.netTotalBg};cursor:pointer;color:${stmtClr(totalNet)}" title="คลิกดูที่มา">${edFmt(totalNet)}</td></tr>
    <tr style="background:${C.openBg};font-weight:700;cursor:pointer" title="คลิกดูยอดปิดงวดต่อบัญชี" onclick="CfpEd.edDrillOpenClose('closing')"><td>เงินสดปลายงวด</td>` +
      closings.map((v,i)=>`<td style="text-align:right" onclick="event.stopPropagation();CfpEd.edDrillOpenCloseMonth('closing','${months[i]}')">${edFmt(v)}</td>`).join("") +
      `<td style="text-align:right;background:${C.openCloseBg}">${edFmt(closings[closings.length-1])}</td></tr>
  </tbody></table></div>
  </div>`;

  edContentEl().innerHTML = html;
}

/* ส่งออกงบกระแสเงินสดเป็น Excel — ตัวเลขจาก edStmtModel ชุดเดียวกับหน้าจอ (ห้ามคำนวณแยก)
   "รวมทุกบัญชี" + ในช่วงมีหลายบัญชี = ชีตรวม + ชีตแยกต่อบัญชี · เลือกบัญชีเดียว = ชีตเดียว
   สีแถวตามหน้าจอ (edStmtPalette) · ชื่อไฟล์ = บริษัท_CashFlowStatement_ช่วงข้อมูล เช่น Mbark_CashFlowStatement_01.2026 */
function edExportStmtXlsx(){
  const d = edState();
  const months = d.data && d.data.months ? edScopeMonthKeys(d.data, d.monthFilter) : [];
  if(!months.length){ alert("ไม่มีข้อมูลงบกระแสเงินสดในช่วงเวลาที่เลือก"); return; }
  const K = edXlsKit(), C = edStmtPalette();
  const accs = d.data.accounts || {};
  const sel = d.stmtAcct && d.stmtAcct !== "all" && accs[d.stmtAcct] ? d.stmtAcct : "all";
  const coName = K.co.fullName || K.co.name || d.data.company || "";
  const periodTxt = months.length === 1 ? edThaiMonth(months[0]) : `${edThaiMonth(months[0])} – ${edThaiMonth(months[months.length-1])}`;
  const inScope = Object.keys(accs).filter(k => months.some(m => accs[k].months && accs[k].months[m]));
  const targets = sel !== "all" ? [sel] : (inScope.length > 1 ? ["all"].concat(inScope) : ["all"]);
  const hex = v => String(v || "").replace("#", "").toUpperCase();
  const sum = a => a.reduce((s,v) => s + v, 0);
  const lastCol = months.length + 1;
  const wb = XLSX.utils.book_new(), used = new Set(), freeze = {};
  for(const acct of targets){
    const M = edStmtModel(d.data, d.monthFilter, acct);
    const a = accs[acct] || {};
    const acctTxt = acct === "all" ? (inScope.length > 1 ? `รวมทุกบัญชี (${inScope.length} บัญชี)` : "รวมทุกบัญชี") : edAcctLabel(a);
    const cells = [
      [K.title(coName)],
      [K.subtitle(`งบกระแสเงินสด — รายเดือน · ${acctTxt}`)],
      [K.meta(`ช่วงข้อมูล: ${periodTxt} · หน่วย: บาท`)],
      [K.meta(`ไม่รวมเงินโอนระหว่างบัญชี · ตัวเลขติดลบแสดงในวงเล็บ · ส่งออกเมื่อ ${edXlsNow()}`)],
      [],
      [K.head("หมวด", { h:"left" })].concat(M.months.map(m => K.head(edThaiMonthShort(m)))).concat([K.head("รวม")]),
    ];
    const r0 = cells.length;
    const merges = [0,1,2,3].map(r => ({ s:{ r, c:0 }, e:{ r, c:lastCol } }));
    // แถวหัวข้อ — ระบายสีทั้งแถวแล้วผสานเซลล์
    const bandRow = (label, o) => {
      const row = [K.txt(label, { bold:true, bg:o.bg, color:o.color, indent:o.indent })];
      for(let i = 1; i <= lastCol; i++) row.push(K.txt("", { bg:o.bg }));
      merges.push({ s:{ r:cells.length, c:0 }, e:{ r:cells.length, c:lastCol } });
      cells.push(row);
    };
    // แถวตัวเลข — คอลัมน์ "รวม" ใช้สีเข้มขึ้นเหมือนบนจอ · topLine = เส้นคั่นหนาด้านบน (แถวสุทธิ)
    const numRow = (label, vals, total, o) => {
      const row = [K.txt(label, { bold:o.bold, bg:o.bg, color:o.color, indent:o.indent })]
        .concat(vals.map(v => K.num(v, { bold:o.bold, bg:o.bg })))
        .concat([K.num(total, { bold:true, bg:o.totalBg || o.bg })]);
      if(o.topLine) row.forEach(c => { c.s.border = Object.assign({}, c.s.border, { top:{ style:"medium", color:{ rgb:hex(o.topLine) } } }); });
      cells.push(row);
    };
    numRow("เงินสดต้นงวด", M.openings, M.openings[0], { bold:true, bg:C.openBg, totalBg:C.openTotalBg });
    for(const S of M.sections){
      bandRow(ED_STMT_ACT_LABEL[S.act], { bg:C.actBg, color:C.actText });
      if(S.inRows.length){
        bandRow("เงินสดรับจาก" + ED_STMT_ACT_SHORT[S.act], { bg:C.inBg, color:C.inText, indent:1 });
        for(const r of S.inRows) numRow(r.cat, r.net, r.total, { totalBg:C.inRowTotalBg, indent:2 });
        numRow("รวมเงินสดรับ", S.inSub, sum(S.inSub), { bold:true, bg:C.inSubBg, color:C.inText, totalBg:C.inTotalBg, indent:1 });
      }
      if(S.outRows.length){
        bandRow("เงินสดจ่ายจาก" + ED_STMT_ACT_SHORT[S.act], { bg:C.outBg, color:C.outText, indent:1 });
        for(const r of S.outRows) numRow(r.cat, r.net, r.total, { totalBg:C.outRowTotalBg, indent:2 });
        numRow("รวมเงินสดจ่าย", S.outSub, sum(S.outSub), { bold:true, bg:C.outSubBg, color:C.outText, totalBg:C.outTotalBg, indent:1 });
      }
      numRow("กระแสเงินสดสุทธิจาก" + ED_STMT_ACT_SHORT[S.act], S.netByMonth, S.netTotal, { bold:true, bg:C.netBg, color:C.netAccent, totalBg:C.netTotalBg, topLine:C.netTotalBg });
    }
    numRow("เปลี่ยนแปลงเงินสดสุทธิ", M.netChange, M.totalNet, { bold:true, bg:C.netBg, color:C.netAccent, totalBg:C.netTotalBg, topLine:C.netTotalBg });
    numRow("เงินสดปลายงวด", M.closings, M.closings[M.closings.length-1], { bold:true, bg:C.openBg, totalBg:C.openCloseBg });
    const name = edXlsSheetName(acct === "all" ? "รวมทุกบัญชี" : `${a.bank || ""} ${a.no || ""}`, used);
    XLSX.utils.book_append_sheet(wb, edXlsBuild(cells, {
      cols:[52].concat(M.months.map(() => 16)).concat([18]),
      merges, rows:{ 0:30, [r0 - 1]:24 },
    }), name);
    freeze[name] = { row:r0, col:1 };
  }
  const tag = sel !== "all" ? "_" + edAcctTag(accs[sel]) : "";
  edXlsSave(wb, `${edCoTag()}_CashFlowStatement${tag}_${edPeriodTag(months)}.xlsx`, freeze);
}

/* คลี่/พับรายการของหมวด inline (แบบ Excel) — เรียกจากการคลิก "ชื่อหมวด" ในงบกระแสเงินสด
   (คลิกที่ตัวเลขเดือนยังเปิด popup เหมือนเดิมผ่าน edDrillStmt) */
function edStmtToggle(tdEl, catName, actKey, dir){
  const tr = tdEl.closest("tr");
  const caret = tdEl.querySelector(".stmt-caret");
  const next = tr.nextElementSibling;
  if(next && next.classList.contains("stmt-detail")){   // เปิดอยู่ → พับ
    next.remove();
    if(caret) caret.textContent = "▶";
    return;
  }
  const d = edState();
  let txs = d.data.transactions.filter(t => !edIsTransfer(t));   // ★ ตัดโอนระหว่างบัญชี
  if(catName) txs = txs.filter(t => t.category === catName);
  if(actKey)  txs = txs.filter(t => t.activityKey === actKey);
  if(d.stmtAcct && d.stmtAcct !== "all") txs = txs.filter(t => t.accountKey === d.stmtAcct);
  if(dir === "in")  txs = txs.filter(t => t.in  > 0);
  if(dir === "out") txs = txs.filter(t => t.out > 0);
  txs.sort((a,b) => a.date - b.date);

  const colspan = tr.children.length;
  const head = dir === "in" ? ED_COLORS.in : ED_COLORS.out;
  const body = txs.length ? txs.map(t=>`<tr style="border-top:1px solid #eef6f1">
      <td style="padding:5px 10px;white-space:nowrap">${t.dateISO}</td>
      <td style="padding:5px 10px"><code style="font-size:11px">${esc(t.ref)}</code></td>
      <td style="padding:5px 10px"><b>${esc(t.bank)}</b> ${esc(edNoShort(t.accountNo))}</td>
      <td style="padding:5px 10px;text-align:right;color:${ED_COLORS.in}">${t.in>0?edFmt(t.in):"—"}</td>
      <td style="padding:5px 10px;text-align:right;color:${ED_COLORS.out}">${t.out>0?edFmt(t.out):"—"}</td>
      <td style="padding:5px 10px;color:var(--ink-2);white-space:normal">${esc(t.note)}</td>
    </tr>`).join("") : `<tr><td colspan="6" style="padding:10px;color:var(--ink-3)">ไม่มีรายการ</td></tr>`;

  const detail = document.createElement("tr");
  detail.className = "stmt-detail";
  detail.innerHTML = `<td colspan="${colspan}" style="padding:0;background:#fbfefc;border-left:3px solid ${head}">
    <div style="padding:4px 10px 10px 30px;overflow:auto">
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead><tr style="color:var(--ink-3)">
          <th style="padding:4px 10px;font-weight:600;text-align:left">วันที่</th>
          <th style="padding:4px 10px;font-weight:600;text-align:left">เลขที่</th>
          <th style="padding:4px 10px;font-weight:600;text-align:left">บัญชี</th>
          <th style="padding:4px 10px;font-weight:600;text-align:right">รับ</th>
          <th style="padding:4px 10px;font-weight:600;text-align:right">จ่าย</th>
          <th style="padding:4px 10px;font-weight:600;text-align:left">หมายเหตุ</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div></td>`;
  tr.after(detail);
  if(caret) caret.textContent = "▼";
}

/* ---------- Drill modals ---------- */
/* generic drill: filter ตาม cat/act/month/dir แล้วแสดง modal รายการต้นทาง */
function edDrillStmt(catName, actKey, monthKey, dir){
  const d = edState();
  let txs = d.data.transactions.filter(t => !edIsTransfer(t));  // ★ exclude transfers (drill จาก Statement)
  if(catName) txs = txs.filter(t => t.category === catName);
  if(actKey)  txs = txs.filter(t => t.activityKey === actKey);
  if(monthKey && monthKey !== "all") txs = txs.filter(t => t.month === monthKey);
  if(d.stmtAcct && d.stmtAcct !== "all") txs = txs.filter(t => t.accountKey === d.stmtAcct);
  if(dir === "in")  txs = txs.filter(t => t.in > 0);
  if(dir === "out") txs = txs.filter(t => t.out > 0);
  const parts = [];
  if(catName) parts.push(catName);
  else if(actKey) parts.push(edActivityLabel(actKey));
  if(dir === "in")  parts.push("เงินสดรับ");
  else if(dir === "out") parts.push("เงินสดจ่าย");
  else if(actKey || catName) parts.push("สุทธิ");
  parts.push(monthKey && monthKey !== "all" ? edThaiMonth(monthKey) : "รวมทุกเดือน");
  edShowDrillModal(parts.join(" · "), txs);
}

/* Summary KPI drill — รับรวม / จ่ายรวม / สุทธิ */
function edDrillSummary(kind){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter, true);  // ★ exclude transfers (drill จาก Summary)
  let txs = A.txs;
  let title = "รายการทั้งหมด";
  if(kind === "in"){  txs = txs.filter(t => t.in  > 0); title = "เงินสดรับรวม"; }
  if(kind === "out"){ txs = txs.filter(t => t.out > 0); title = "เงินสดจ่ายรวม"; }
  if(kind === "net") title = "กระแสเงินสดสุทธิ";
  const period = edScopeLabel(d.monthFilter);
  edShowDrillModal(title + " · " + period, txs);
}

/* Activity sub-KPI drill — รับ/จ่ายของกิจกรรมหนึ่งๆ */
function edDrillActivityIO(actKey, dir){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter, true);  // ★ exclude transfers
  let txs = A.txs.filter(t => t.activityKey === actKey);
  if(dir === "in")  txs = txs.filter(t => t.in  > 0);
  if(dir === "out") txs = txs.filter(t => t.out > 0);
  const label = edActivityLabel(actKey);
  const dirL  = dir === "in" ? "รับ" : dir === "out" ? "จ่าย" : "สุทธิ";
  const period = edScopeLabel(d.monthFilter);
  edShowDrillModal(`${label} · ${dirL} · ${period}`, txs);
}

/* drill ยอดเปิด/ปิด ของเดือนเฉพาะ (เรียกจาก Statement cell) */
function edDrillOpenCloseMonth(kind, monthKey){
  const d = edState();
  const saved = d.monthFilter;
  d.monthFilter = monthKey;
  edDrillOpenClose(kind);
  d.monthFilter = saved;
}

/* opening/closing breakdown by account */
function edDrillOpenClose(kind){
  const d = edState();
  const data = d.data;
  const filterAcct = d.stmtAcct || "all";
  const monthFilter = d.monthFilter;
  const rows = [];
  let total = 0;

  // เปิด = เดือนแรกที่บัญชีปรากฏใน scope · ปิด = เดือนสุดท้าย (รองรับ ทุกปี/ทั้งปี/เดือนเดียว)
  const scope = edScopeMonthKeys(data, monthFilter);
  for(const k in data.accounts){
    if(filterAcct !== "all" && k !== filterAcct) continue;
    const a = data.accounts[k];
    let v = null;
    if(kind === "opening"){
      for(const mk of scope){ if(a.months[mk]){ v = a.months[mk].opening; break; } }
    } else {
      for(let i = scope.length - 1; i >= 0; i--){ const mk = scope[i]; if(a.months[mk]){ v = a.months[mk].closing; break; } }
    }
    if(v == null) continue;
    rows.push({ bank:a.bank, no:a.no, nick:a.nick, value:v });
    total += v;
  }

  const title = (kind === "opening" ? "เงินสดต้นงวด" : "เงินสดปลายงวด")
    + " · " + edScopeLabel(monthFilter);

  const wrap = document.createElement("div");
  wrap.id = "edDrillModal";
  wrap.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px";
  wrap.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:24px;max-width:700px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:16px">${esc(title)} <span style="color:var(--ink-3);font-size:13px;font-weight:500">— ${rows.length} บัญชี · รวม ${edFmt(total)}</span></h3>
        <button onclick="document.getElementById('edDrillModal').remove()" style="padding:6px 12px;border:1px solid var(--line);background:#fff;border-radius:7px;font-size:13px;cursor:pointer">ปิด</button>
      </div>
      <table style="font-size:13px;width:100%">
        <thead><tr><th style="text-align:left;padding:8px 12px;background:#f8fafc;border-bottom:1px solid var(--line)">ธนาคาร</th><th style="text-align:left;padding:8px 12px;background:#f8fafc;border-bottom:1px solid var(--line)">เลขบัญชี</th><th style="text-align:left;padding:8px 12px;background:#f8fafc;border-bottom:1px solid var(--line)">ชื่อบัญชี</th><th style="text-align:right;padding:8px 12px;background:#f8fafc;border-bottom:1px solid var(--line)">ยอด</th></tr></thead>
        <tbody>${rows.map(r=>`<tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9"><b>${esc(r.bank)}</b></td><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9"><code style="font-size:12px">${esc(r.no)}</code></td><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:var(--ink-3);font-size:12px">${esc(r.nick||"—")}</td><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700">${edFmt(r.value)}</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
  document.body.appendChild(wrap);
  wrap.onclick = (e) => { if(e.target === wrap) wrap.remove(); };
}

function edDrillCat(cat, dir){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter, true);  // ★ exclude transfers
  let txs = A.txs.filter(t=>t.category===cat);
  if(dir==="in")  txs = txs.filter(t=>t.in>0);
  if(dir==="out") txs = txs.filter(t=>t.out>0);
  edShowDrillModal("หมวด: "+cat, txs);
}
function edDrillActivity(actKey){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter, true);  // ★ exclude transfers
  const txs = A.txs.filter(t=>t.activityKey===actKey);
  edShowDrillModal("กิจกรรม: "+edActivityLabel(actKey), txs);
}
function edDrillAcct(key){
  const d = edState();
  const A = edAgg(d.data, d.monthFilter);
  const txs = A.txs.filter(t=>t.accountKey===key);
  edShowDrillModal("บัญชี: "+key, txs);
}
function edShowDrillModal(title, txs){
  const wrap = document.createElement("div");
  wrap.id = "edDrillModal";
  wrap.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px";
  const totalIn = txs.reduce((s,t)=>s+t.in,0);
  const totalOut = txs.reduce((s,t)=>s+t.out,0);
  wrap.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:24px;max-width:1000px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:16px">${esc(title)} <span style="color:var(--ink-3);font-size:13px;font-weight:500">— ${txs.length} รายการ · รับ ${edFmt(totalIn)} · จ่าย ${edFmt(totalOut)}</span></h3>
        <button onclick="document.getElementById('edDrillModal').remove()" style="padding:6px 12px;border:1px solid var(--line);background:#fff;border-radius:7px;font-size:13px;cursor:pointer">ปิด</button>
      </div>
      <div style="overflow:auto;flex:1"><table style="font-size:12px;width:100%">
        <thead><tr><th>วันที่</th><th>เลขที่</th><th>บัญชี</th><th style="text-align:right">รับ</th><th style="text-align:right">จ่าย</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${txs.map(t=>`<tr>
          <td>${t.dateISO}</td><td><code style="font-size:11px">${esc(t.ref)}</code></td>
          <td><b>${esc(t.bank)}</b> ${esc(edNoShort(t.accountNo))}</td>
          <td style="text-align:right;color:var(--ok)">${t.in>0?edFmt(t.in):"—"}</td>
          <td style="text-align:right;color:var(--bad)">${t.out>0?edFmt(t.out):"—"}</td>
          <td style="color:var(--ink-2)">${esc(t.note)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.onclick = (e)=>{ if(e.target===wrap) wrap.remove(); };
}

  /* ── สไตล์ของหน้า Benya (ยกจาก <style> ของ fin.benyamedical.com) — ครอบด้วย .ced ไม่ให้ชนสไตล์ทั้งแอป
   *    (POG มี .card/.btn/.badge/.page-head ของตัวเอง) · ป๊อปอัพรายการ (#edDrillModal) ต่อท้าย <body> จึงครอบแยก */
  const CED_CSS = `
.ced, #edDrillModal{
  --brand:#2e8b4a; --brand-dark:#1f6e3a; --brand-soft:#e3f2e8; --brand-rgb:46,139,74;
  --in:#15c486; --in-soft:#e2faf0; --in-ink:#15875a; --out:#fb5e6d; --out-soft:#ffe9ec; --out-ink:#c0392b;
  --warn:#f59e0b; --warn-soft:#fef3c7; --warn-ink:#92400e; --ok:#15c486; --bad:#fb5e6d;
  --ink:#20342a; --ink-2:#688275; --ink-3:#a4b8ac; --line:#e1efe7; --card:#ffffff;
  --glass:rgba(255,255,255,.85); --glass-strong:rgba(255,255,255,.92); --glass-border:rgba(46,139,74,.14);
  --radius:14px; --shadow:0 10px 30px rgba(31,120,60,.12); --shadow-md:0 14px 36px rgba(31,120,60,.18);
  color:var(--ink); font-size:14.5px; line-height:1.6;
}
.ced .ed-page{background:transparent;min-height:calc(100vh - 54px);padding:24px 28px}
@media (max-width:760px){ .ced .ed-page{padding:16px 14px} }
body.present-mode .ced .ed-page{padding:26px 40px}
@keyframes edGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes edShimmer{0%{transform:translateX(-130%)}55%{transform:translateX(230%)}100%{transform:translateX(230%)}}
@keyframes edShine{0%{transform:translateX(-130%) skewX(-16deg)}60%{transform:translateX(330%) skewX(-16deg)}100%{transform:translateX(330%) skewX(-16deg)}}
@keyframes edGlow{0%,100%{box-shadow:0 14px 36px rgba(31,120,60,.32)}50%{box-shadow:0 16px 44px rgba(31,120,60,.52)}}
.ced .ed-grow{transform-origin:left;animation:edGrow .85s cubic-bezier(.22,1,.36,1)}
.ced .ed-shim{position:absolute;inset:0;background:linear-gradient(110deg,transparent 25%,rgba(255,255,255,.55) 50%,transparent 75%);animation:edShimmer 2.8s ease-in-out infinite}
.ced .ed-shine{position:absolute;top:0;left:0;width:38%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.22),transparent);animation:edShine 3.4s ease-in-out infinite;pointer-events:none}
.ced .ed-glow{animation:edGlow 2.6s ease-in-out infinite}
.ced .ed-tabs{display:flex;gap:4px;background:rgba(46,139,74,.08);padding:4px;border-radius:11px;margin-bottom:16px;flex-wrap:wrap}
.ced .ed-tabs button{flex:1;min-width:120px;border:none;background:transparent;padding:9px 14px;font-size:12.5px;font-weight:600;color:#688275;border-radius:8px;cursor:pointer;transition:.15s;font-family:inherit}
.ced .ed-tabs button:hover{background:rgba(255,255,255,.5)}
.ced .ed-tabs button.active{background:linear-gradient(135deg,#2e8b4a,#1f6e3a);color:#fff;box-shadow:0 6px 16px rgba(31,120,60,.3);font-weight:700}
.ced .page-head{display:block;margin-bottom:22px}
.ced .page-head h1{margin:0 0 5px;font-size:25px;font-weight:800;letter-spacing:-.6px;color:var(--ink);font-family:"IBM Plex Sans","IBM Plex Sans Thai",ui-sans-serif,sans-serif}
.ced .page-head .sub{color:var(--ink-2);font-size:13.5px}
.ced .badge{display:inline-block;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--brand-soft);color:var(--brand-dark);vertical-align:middle;margin-left:8px;line-height:1.6;gap:0}
.ced .card{background:var(--glass);backdrop-filter:blur(10px);border:1px solid var(--glass-border);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px;margin-bottom:16px;transition:transform .18s ease,box-shadow .18s ease;position:static}
.ced .card:hover{box-shadow:var(--shadow-md)}
.ced .card h3{margin:0 0 4px;font-size:14.5px;font-weight:700;color:var(--ink);font-family:"IBM Plex Sans","IBM Plex Sans Thai",ui-sans-serif,sans-serif;letter-spacing:-.3px}
.ced .card .note{color:var(--ink-3);font-size:12.5px;margin-bottom:14px}
.ced .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;background:linear-gradient(135deg,var(--brand),var(--brand-dark));color:#fff;padding:9px 17px;border-radius:9px;font-weight:600;font-size:13px;line-height:1.3;transition:transform .14s ease,box-shadow .14s ease,filter .14s;box-shadow:0 3px 10px rgba(var(--brand-rgb),.22);cursor:pointer;font-family:inherit}
.ced .btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(var(--brand-rgb),.30)}
.ced .btn.ghost{background:rgba(255,255,255,.7);color:var(--brand);border-color:var(--brand);box-shadow:none}
.ced .btn.ghost:hover{background:var(--brand-soft)}
.ced .btn.sm{padding:6px 13px;font-size:12px;border-radius:8px}
.ced .btn[disabled]{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
.ced .ed-ico{width:15px;height:15px;flex:none}
.ced .table-wrap{overflow:auto;border:1px solid var(--glass-border);border-radius:12px;margin-top:12px;max-height:440px;background:rgba(255,255,255,.5)}
.ced table, #edDrillModal table{border-collapse:collapse;width:100%;font-size:12.5px;white-space:nowrap}
.ced th, .ced td, #edDrillModal th, #edDrillModal td{border-bottom:1px solid var(--line);padding:9px 12px;text-align:left}
.ced th, #edDrillModal th{background:rgba(var(--brand-rgb),.07);position:sticky;top:0;font-weight:700;color:var(--brand-dark);font-size:11px;letter-spacing:.4px;text-transform:uppercase}
.ced tbody tr, #edDrillModal tbody tr{transition:background .12s}
.ced tbody tr:hover, #edDrillModal tbody tr:hover{background:rgba(var(--brand-rgb),.05)}
.ced code, #edDrillModal code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ced .empty{padding:40px;text-align:center;color:var(--ink-3);font-size:13px}
.ced .drop{border:1.5px dashed var(--glass-border);border-radius:12px;padding:28px;text-align:center;color:var(--ink-3);transition:.18s;background:rgba(255,255,255,.45);cursor:pointer}
.ced .drop:hover{border-color:var(--brand);background:var(--brand-soft);color:var(--brand-dark)}
.ced .drop .big{font-size:28px;margin-bottom:6px;opacity:.6}
.ced .drop b{color:var(--brand)}
.ced .drop .sm{font-size:11.5px;margin-top:6px}
.ced select{font-family:inherit}
.ced .ed-print-h{font-size:18px;font-weight:800;color:#1f6e3a;margin:22px 0 12px;font-family:"IBM Plex Sans","IBM Plex Sans Thai",ui-sans-serif,sans-serif}
.ced .ed-print-sec:first-child .ed-print-h{margin-top:0}
.ced #printHeader{display:none}
body.present-mode .ced .ed-hide-present{display:none!important}
@media print{
  .ced, .ced *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .ced .page-head, .ced .ed-period, .ced .ed-tabs, .ced .ed-hide-present, .ced .btn, .ced button, .ced select, .ced input{display:none!important}
  .ced .ed-page{background:#fff!important;margin:0!important;padding:0!important;min-height:auto!important}
  .ced .card{box-shadow:none!important;border:1px solid #cbd5e1!important;backdrop-filter:none!important;background:#fff!important;break-inside:avoid;page-break-inside:avoid;margin-bottom:10px!important;padding:14px!important}
  .ced .card:has(table){break-inside:auto!important;page-break-inside:auto!important}
  .ced #printHeader{display:block;border-bottom:3px solid #2e8b4a;padding:0 0 14px;margin-bottom:18px}
  .ced #printHeader .ph-row{display:flex;align-items:center;justify-content:space-between;gap:14px}
  .ced #printHeader .ph-co{display:flex;align-items:center;gap:14px}
  .ced #printHeader .ph-logo{width:62px;height:62px;object-fit:contain}
  .ced #printHeader .ph-co-name{font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-.4px}
  .ced #printHeader .ph-co-sub{font-size:11px;color:#64748b;margin-top:2px;text-transform:uppercase;letter-spacing:.7px;font-weight:600}
  .ced #printHeader .ph-meta{text-align:right;font-size:11.5px;color:#475569;line-height:1.7}
  .ced #printHeader .ph-title{font-size:13px;font-weight:700;color:#1f6e3a;letter-spacing:.3px;text-transform:uppercase}
  .ced #printHeader .ph-period{font-size:14.5px;font-weight:700;color:#0f172a;margin-top:1px}
  .ced #printHeader .ph-ts{color:#94a3b8;font-size:10.5px;margin-top:2px;font-style:italic}
  .ced .table-wrap{max-height:none!important;overflow:visible!important;border:none!important}
  .ced table{font-size:10px!important}
  .ced th, .ced td{padding:5px 7px!important}
  .ced th{background:#eef6f1!important;color:#1f6e3a!important;border-bottom:1.5px solid #2e8b4a!important;position:static!important}
  .ced thead{display:table-header-group}
  .ced tr{break-inside:avoid;page-break-inside:avoid}
  .ced canvas{max-width:100%!important}
  .ced .ed-print-sec{break-before:page;page-break-before:always}
  .ced .ed-print-sec:first-child{break-before:auto;page-break-before:auto}
  #edDrillModal{display:none!important}
}`;
  function edInjectCSS() {
    if (document.getElementById('ced-css')) return;
    const st = document.createElement('style'); st.id = 'ced-css'; st.textContent = CED_CSS; document.head.appendChild(st);
  }
  /* ยังไม่มีข้อมูล — หน้าอัปโหลด (★ BIO: อ่านไฟล์ STM รายการเดินบัญชี + งบสรุป ด้วยตัวอ่านเดิมของ BIO) */
  function edRenderEmpty() {
    const t = TOOLS[0], co = COMPANIES[0];
    Object.keys(_edCharts).forEach(edDestroyChart);
    CED.host.innerHTML = `
    <div class="ed-page">
      <div class="page-head">
        <h1>${t.name} <span class="badge">${esc(co.name)}</span></h1>
        <div class="sub">อัปไฟล์ STM รายการเดินบัญชี → 5 แดชบอร์ด: Executive Summary · Category Analysis · Bank Accounts · Transaction Explorer · งบกระแสเงินสด</div>
      </div>
      <div class="card">
        <h3>อัปโหลดไฟล์</h3>
        <div class="note">ไฟล์ Excel STM รายการเดินบัญชี (รายบัญชี หรือชีต "รวมทุกบัญชี" ที่มีคอลัมน์ วันที่ / ยอดถอน / ยอดฝาก / หมวด / ประเภทกิจกรรม) · เลือกพร้อมไฟล์งบกระแสเงินสดสรุปได้ (เลือกหลายไฟล์ได้) · หรือกด "ส่งขึ้นหน้า Cash Flow" ที่หน้างบกระทบยอดกระแสเงินสด</div>
        ${CED.canEdit
          ? `<div class="drop" onclick="CfpEd.edHook('upload')"><div class="big">↑</div><div>${CED.uploading ? 'กำลังอ่านไฟล์…' : '<b>คลิกเพื่อเลือกไฟล์</b>'}</div><div class="sm">อัปแล้วทุกคนที่เปิดหน้านี้เห็นชุดเดียวกัน</div></div>`
          : `<div class="empty">ยังไม่มีข้อมูล — ให้ผู้ดูแลอัปโหลดไฟล์</div>`}
      </div>
    </div>`;
  }
  function edMount(data) {
    edInjectCSS();
    CED.ui.data = data;
    if (!CED.host) return;
    if (!data || !data.transactions || !data.transactions.length) { if (window.exnUnmount) window.exnUnmount(CED.host); edRenderEmpty(); return; }
    edRenderDashboard();
  }
  function edUnmount() {
    if (window.exnUnmount) window.exnUnmount(CED.host);
    Object.keys(_edCharts).forEach(edDestroyChart);
    document.querySelectorAll('#edDrillModal').forEach(m => m.remove());
    CED.host = null; CED.target = null; CED.printAll = false;
  }

  /* ══════════ หน้า (React) — ถือข้อมูล/อัปโหลด/แชร์ส่วนกลาง แล้วให้ส่วนที่ 2 วาดหน้าจอ ══════════
   *  การอ่านไฟล์ = ของ BIO เดิมทุกอย่าง: เลือกไฟล์ได้หลายไฟล์ · ทุกชีตในทุกไฟล์ → ชีต STM ที่มีรายการมากสุด
   *  (ชีต "รวมทุกบัญชี" ชนะชีตรายบัญชีเก่า) + งบสรุปชีตแรกที่เจอ */
  function CashFlowPresentPage({ data, toast }) {
    const [stored, setStored] = useState(() => { try { return JSON.parse(localStorage.getItem(CFP_LS) || 'null'); } catch (e) { return null; } });
    const [uploading, setUploading] = useState(false);
    const [era, setEra] = useState(() => { try { return localStorage.getItem('bio-cfp-era') || 'auto'; } catch (e) { return 'auto'; } });
    const [synced, setSynced] = useState(false);      // โหลด/แชร์ผ่านส่วนกลางสำเร็จล่าสุด
    const [shareBusy, setShareBusy] = useState(false);
    const [chartReady, setChartReady] = useState(() => !!window.Chart);
    const fileRef = useRef(null);
    const fetchedRef = useRef(false);
    const hostRef = useRef(null);
    const canEdit = !(window._wtpRoleIsReadOnly && window._wtpRoleIsReadOnly());
    useEffect(() => { try { localStorage.setItem('bio-cfp-era', era); } catch (e) { } }, [era]);

    // เลขบัญชีเต็มจากทะเบียนบัญชีธนาคาร (เลขท้าย 4 ตัว → เลขเต็ม) ให้ตารางโชว์ "KBANK 123-4-56789-0" แบบ POG
    const bankRows = data && data.bankAccounts;
    const fullNoByTail = useMemo(() => {
      const out = {}, dup = {};
      (Array.isArray(bankRows) ? bankRows : []).forEach(b => {
        const raw = String((b && b.Bank_AC) || '').trim(), dg = raw.replace(/\D/g, '');
        if (dg.length < 6) return;
        const t4 = dg.slice(-4);
        if (out[t4] && out[t4] !== raw) dup[t4] = true; else out[t4] = raw;
      });
      Object.keys(dup).forEach(k => { delete out[k]; });
      return out;
    }, [bankRows]);
    const edData = useMemo(() => {
      if (!stored || !stored.stm) return null;
      try { return cfpToEd(stored.stm, fullNoByTail); } catch (e) { console.error('[cfp] แปลงข้อมูลไม่สำเร็จ', e); return null; }
    }, [stored, fullNoByTail]);
    useEffect(() => {
      if (window.Chart) return;
      let alive = true;
      edLoadChart().then(() => { if (alive) setChartReady(true); }).catch(e => console.warn('[cfp]', e && e.message));
      return () => { alive = false; };
    }, []);

    // โหลดข้อมูล "ส่วนกลาง" จาก Supabase ตอนเข้าหน้า → server = แหล่งจริง (ทับ local cache); ว่าง → คง local เดิม
    useEffect(() => {
      if (fetchedRef.current || !cfpCanSync()) return;
      fetchedRef.current = true; let alive = true;
      window.WTPData.fetchSheetRows(CFP_TABLE).then(rows => {
        if (!alive) return;
        const row = (rows || []).find(r => r && r.stm);
        if (row && row.stm) { setStored(row); setSynced(true); try { localStorage.setItem(CFP_LS, JSON.stringify(row)); } catch (e) {} }
      }).catch(e => { console.warn('[cfp] โหลดส่วนกลางไม่สำเร็จ:', e && e.message); });
      return () => { alive = false; };
    }, []);

    function refreshShared() {
      if (!cfpCanSync()) return; setShareBusy(true);
      window.WTPData.fetchSheetRows(CFP_TABLE).then(rows => {
        const row = (rows || []).find(r => r && r.stm);
        if (row && row.stm) { setStored(row); setSynced(true); try { localStorage.setItem(CFP_LS, JSON.stringify(row)); } catch (e) {} toast && toast('โหลดข้อมูลส่วนกลางล่าสุดแล้ว'); }
        else { toast && toast('ยังไม่มีข้อมูลส่วนกลาง — ให้ผู้ดูแลอัปโหลด', 'error'); }
        setShareBusy(false);
      }).catch(e => { setShareBusy(false); toast && toast('โหลดไม่สำเร็จ: ' + (e && e.message || ''), 'error'); });
    }

    // อ่าน "ทุกชีต" ในไฟล์ (ไม่ใช่แค่ชีตแรก) — คืน [{name, aoa}] เพื่อให้ไฟล์เดียวที่มี
    //   ทั้งชีตงบสรุป + ชีต "รวมทุกบัญชี" (รายการดีเทล) ใช้จบในไฟล์เดียวได้.
    async function readSheets(file) {
      return new Promise((resolve, reject) => {
        if (!window.XLSX) { reject(new Error('ไม่พบ SheetJS — รีเฟรชหน้า')); return; }
        const r = new FileReader();
        r.onload = e => { try {
          const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: false });
          resolve(wb.SheetNames.map(nm => ({ name: nm, aoa: window.XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, blankrows: false, defval: '' }) })));
        } catch (err) { reject(err); } };
        r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ')); r.readAsArrayBuffer(file);
      });
    }
    function detectKind(aoa) { const flat = aoa.slice(0, 12).map(r => (r || []).join(' ')).join(' '); if (/ประเภทกิจกรรมทางการเงิน|ยอดถอน|ยอดฝาก/.test(flat)) return 'stm'; if (/งบกระแสเงินสด|กระแสเงินสดจากกิจกรรม/.test(flat)) return 'summary'; return 'unknown'; }
    // เก็บของเดิมที่หน้าเก่าเคยใช้ (งบสรุป / จับคู่หมวด / ประเภทบัญชี) ไว้ในแถวข้อมูลทุกครั้งที่บันทึก
    const keepOld = (over) => Object.assign({ summary: (stored && stored.summary) || null, catMap: (stored && stored.catMap) || null, acctTypes: (stored && stored.acctTypes) || null }, over);
    async function onUpload(files) { cfpEraHint = era;
      setUploading(true);
      try {
        let stm = null, summary = null;
        // เลือก STM ที่ "มีรายการมากสุด" จากทุกชีตทุกไฟล์ → ชีต "รวมทุกบัญชี" (ครบเดือนกว่า)
        //   ชนะชีต STM รายบัญชีเก่า/subset ที่อาจอยู่ในไฟล์เดียวกัน (เช่น Sheet1).
        const takeStm = g => { if (g && g.txns.length && (!stm || g.txns.length > stm.txns.length)) stm = g; };
        for (const f of files) {
          const sheets = await readSheets(f);
          for (const sh of sheets) {
            const kind = detectKind(sh.aoa);
            if (kind === 'stm') takeStm(cfpParseStm(sh.aoa));
            else if (kind === 'summary' && !summary) summary = cfpParseSummary(sh.aoa);
          }
          // เผื่อไม่มีชีตไหน detect เป็น STM แต่มีรายการเดินบัญชีซ่อนอยู่ → เดาจากทุกชีต
          if (!stm) sheets.forEach(sh => takeStm(cfpParseStm(sh.aoa)));
        }
        if (!stm || !stm.txns.length) {
          if (summary && stored && stored.stm) { const r = await persist(keepOld({ stm: stored.stm, summary })); toast && toast('อัปเดตตารางงบสรุปแล้ว' + cfpShareSuffix(r), r.reason === 'error' ? 'error' : undefined); }
          else { toast && toast('ต้องมีไฟล์ STM (รายการเดินบัญชี)', 'error'); }
          setUploading(false); return;
        }
        const r = await persist(keepOld({ stm, summary: summary || (stored && stored.summary) || null }));
        toast && toast('อ่านข้อมูลสำเร็จ · ' + stm.txns.length + ' รายการ' + (summary ? ' + งบสรุป' : '') + cfpShareSuffix(r), r.reason === 'error' ? 'error' : undefined);
      } catch (e) { console.error(e); toast && toast('อ่านไฟล์ไม่สำเร็จ: ' + (e.message || e), 'error'); }
      setUploading(false);
    }
    function cfpShareSuffix(r) { if (!r) return ''; if (r.shared) return ' · 🌐 แชร์ให้ทีมแล้ว'; if (r.reason === 'error') return ' · ⚠️ แชร์ส่วนกลางไม่สำเร็จ (บันทึกในเครื่อง · รัน SQL?)'; return ''; }
    // บันทึก local (cache/offline) + push ขึ้นส่วนกลาง (ทุกคนเห็น). คืน {shared, reason}.
    async function persist(obj) {
      const payload = Object.assign({ id: CFP_ROW_ID, uploadedAt: Date.now(), uploadedBy: cfpCurrentUser() }, obj);
      try { localStorage.setItem(CFP_LS, JSON.stringify(payload)); } catch (e) { console.error('[cfp] save', e); }
      setStored(payload);
      if (!cfpCanSync()) return { shared: false, reason: 'local' };
      setShareBusy(true);
      try { await window.WTPData.writeTable(CFP_TABLE, [payload], r => r.id); setSynced(true); setShareBusy(false); return { shared: true }; }
      catch (e) { setShareBusy(false); setSynced(false); console.warn('[cfp] แชร์ส่วนกลางไม่สำเร็จ:', e && e.message); return { shared: false, reason: 'error', message: e && e.message }; }
    }
    function clearData() {
      if (!confirm('ล้างข้อมูล Cash Flow ส่วนกลาง? (ทุกคนจะไม่เห็นจนกว่าจะอัปใหม่)')) return;
      localStorage.removeItem(CFP_LS); setStored(null); setSynced(false);
      if (cfpCanSync()) { setShareBusy(true); window.WTPData.writeTable(CFP_TABLE, [], r => r.id).then(() => { setShareBusy(false); toast && toast('ล้างข้อมูลส่วนกลางแล้ว'); }).catch(e => { setShareBusy(false); toast && toast('ล้างในเครื่องแล้ว แต่ส่วนกลางไม่สำเร็จ: ' + (e && e.message || ''), 'error'); }); }
    }

    // ส่วนที่ 2 (โค้ดวาดหน้า) เรียกกลับมาที่นี่ผ่าน CfpEd.edHook(...)
    useEffect(() => { CED.hooks = { upload: () => { if (fileRef.current) fileRef.current.click(); }, refresh: refreshShared, clear: clearData, era: v => setEra(v) }; });
    useEffect(() => {
      Object.assign(CED, { host: hostRef.current, canEdit, canSync: cfpCanSync(), uploading, shareBusy, era, synced, stored });
      edMount(edData);
    }, [edData, canEdit, uploading, shareBusy, era, chartReady, synced]);
    useEffect(() => () => edUnmount(), []);

    return (
      <div className="cfp-page present-page ced">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files.length) onUpload(Array.from(e.target.files)); e.target.value = ''; }} />
        <div ref={hostRef} />
      </div>
    );
  }

  window.CashFlowPresentPage = CashFlowPresentPage;
  window.CfpEd = { edDrillAcct, edDrillActivity, edDrillActivityIO, edDrillCat, edDrillCatAct, edDrillCatMonth, edDrillFinKpi, edDrillOpenClose, edDrillOpenCloseMonth, edDrillStmt, edDrillSummary, edExpSet, edExpSort, edExportFullPDF, edExportStmtXlsx, edExportTxs, edHook, edPrint, edSave, edSetMonth, edSetTab, edState, edStmtAcct, edStmtToggle, edTogglePresent, edToggleStmtTall,
    // ↓ ให้ exec_notes.js (โน้ตผู้นำเสนอ) คำนวณจากข้อมูลชุดเดียวกับหน้าจอ
    edAgg, edScopeMonthKeys, edAnomalyData, edScopeLabel };
  /* ★ เปิดตัวอ่าน + ค่าคงที่ให้หน้า #cf_coding เรียกข้ามไฟล์ได้ — หน้านั้นสร้าง AOA
     รูปเดียวกับไฟล์ที่คนอัปมือ แล้วส่งผ่านตัวอ่านชุดนี้ ⇒ ข้อมูลที่ลงเอยเหมือนกัน
     เป๊ะกับการ "ส่งออกแล้วอัปกลับ" โดยไม่ต้องเขียนตัวแปลงซ้ำ (กันสูตรสองชุดเพี้ยนกัน) */
  Object.assign(window, { cfpParseStm, cfpParseSummary, cfpAccountLabel, cfpFixEraTxns, CFP_TABLE, CFP_ROW_ID, cfpCurrentUser });
})();
