/* page_bank_recon.jsx — กระทบยอดธนาคาร (Bank Reconciliation)
 *
 * เป้าหมาย: กระทบ "รายการที่บันทึกในระบบ (PV)" กับ "รายการเดินบัญชีจริงจากธนาคาร (statement)"
 *   ราย "บัญชี" ราย "เดือน" เพื่อตอบ:
 *     • ทั้งเดือน ยกมา/เคลื่อนไหว/คงเหลือ เท่าไหร่ (จากตัว statement เอง)
 *     • PV เกิดจากบัญชีไหน · ครบตาม statement ไหม
 *     • รายการไหน "เกิดจริงแต่ยังไม่ลงระบบ" (ขาดบันทึก) → กดบันทึกเป็นจ่ายจริงได้
 *       แล้วเด้งเข้า Actual หน้า Cashflow (เขียน forecastEntries STATUS=ACTUAL)
 *
 * เก็บ statement + mapping + สถานะกระทบ ใน localStorage (v1, ไม่แตะ Sheets sync)
 *   — statement เป็น working data (re-import ได้) · ความจริงทางการเงินไหลเข้า forecastEntries (synced)
 *
 * Reuse helper จาก page_bank_diary.jsx (global): bdNum, bdDigits, bdISO, bdAcct,
 *   bdAcctMatchesCheck, bdLast4, bdBrand, bdNormPV  · parse ไฟล์ด้วย global XLSX (โหลดใน index.html)
 */
'use strict';

const { useState: brState, useMemo: brMemo, useEffect: brEffect, useRef: brRef } = React;

// ─── localStorage store (v1 — จุดเดียวที่จะสลับเป็น synced v2 ภายหลัง) ──────────
const BR_LS_STMT  = 'wtp-bankrecon-stmt-v1';   // { [accountNo]: { 'YYYY-MM': StatementLine[] } }
const BR_LS_MAP   = 'wtp-bankrecon-map-v1';    // { [brandKey]: ColumnMapping }
const BR_LS_STATE = 'wtp-bankrecon-state-v1';  // { [lineId]: { decision, forecastId } }
const BankReconStore = {
  _get(k, def) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (_) { return def; } },
  _set(k, v)   { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  getLines()   { return this._get(BR_LS_STMT, {}); },
  setLines(v)  { this._set(BR_LS_STMT, v); },
  getMapping() { return this._get(BR_LS_MAP, {}); },
  setMapping(v){ this._set(BR_LS_MAP, v); },
  getState()   { return this._get(BR_LS_STATE, {}); },
  setState(v)  { this._set(BR_LS_STATE, v); },
};

// ── แปลง nested {acct:{ym:[line]}} ↔ flat rows (sync เป็น entity table bankReconLines) ──
//    cloud = แหล่งข้อมูลจริง (ทีมเห็นร่วม) · localStorage = cache/ออฟไลน์
function brLinesToRows(linesAll) {
  const rows = [];
  Object.keys(linesAll || {}).forEach(acct => {
    const byYm = linesAll[acct] || {};
    Object.keys(byYm).forEach(ym => {
      (byYm[ym] || []).forEach(l => rows.push({
        id: l.id, accountNo: acct, ym: ym, date: l.date || '', amount: l.amount,
        desc: l.desc || '', ref: l.ref || '', balance: (l.balance == null ? '' : l.balance), idx: (l._idx == null ? 0 : l._idx),
      }));
    });
  });
  return rows;
}
function brRowsToLines(rows) {
  const out = {};
  (rows || []).forEach(r => {
    const acct = r.accountNo, ym = r.ym;
    if (!acct || !ym) return;
    (out[acct] = out[acct] || {});
    (out[acct][ym] = out[acct][ym] || []).push({
      id: r.id, date: r.date || '', amount: Number(r.amount) || 0, desc: r.desc || '',
      ref: r.ref || '', balance: (r.balance === '' || r.balance == null) ? null : Number(r.balance),
      bankAcct: acct, _idx: Number(r.idx) || 0,
    });
  });
  Object.keys(out).forEach(a => Object.keys(out[a]).forEach(y => out[a][y].sort((x, z) => (x._idx || 0) - (z._idx || 0))));
  return out;
}
function brStateToRows(stateMap) {
  return Object.keys(stateMap || {}).map(id => ({
    id: id, decision: (stateMap[id] && stateMap[id].decision) || '', forecastId: (stateMap[id] && stateMap[id].forecastId) || '',
    pvRef: (stateMap[id] && stateMap[id].pvRef) || '',   // decision='matched' → อ้างอิง PV ที่จับคู่มือ (id หรือเลขที่ PV)
  }));
}
function brRowsToState(rows) {
  const m = {};
  (rows || []).forEach(r => { if (r && r.id != null && r.id !== '') m[r.id] = { decision: r.decision || '', forecastId: r.forecastId || '', pvRef: r.pvRef || '' }; });
  return m;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
// brand key (ไทย/อังกฤษ) — ใช้เป็น key ของ mapping (บัญชีแบรนด์เดียวกัน map ครั้งเดียว)
function brBrandKey(acct) {
  const s = (String((acct && acct.bankName) || '') + ' ' + String((acct && acct.accountName) || '')).toUpperCase();
  if (/SCB|ไทยพาณิชย์|SIAM COMMERCIAL/i.test(s)) return 'SCB';
  if (/KTB|กรุงไทย|KRUNG ?THAI/i.test(s))         return 'KTB';
  if (/BBL|กรุงเทพ|BANGKOK BANK/i.test(s))        return 'BBL';
  if (/KBANK|KBNK|กสิกร|KASIKORN/i.test(s))       return 'KBANK';
  if (/BAY|กรุงศรี|AYUDHYA/i.test(s))             return 'BAY';
  if (/TTB|ทหารไทย|ธนชาต/i.test(s))               return 'TTB';
  if (/GSB|ออมสิน/i.test(s))                      return 'GSB';
  const up = String((acct && acct.bankName) || '').trim().toUpperCase();
  return up || 'BANK';
}

// number parse (เผื่อ Date object จาก XLSX → 0, comma → ตัด)
function brNum(v) {
  if (v == null || v === '') return 0;
  if (v instanceof Date) return 0;
  const n = parseFloat(String(v).replace(/,/g, '').replace(/[฿\s]/g, ''));
  return isNaN(n) ? 0 : n;
}
// เดือนไทย (ย่อ/เต็ม) → เลขเดือน — รองรับ statement เช่น "01-มิ.ย.-2569" (KBANK) / "04 มิ.ย. 2569" (BBL)
const BR_THAI_MONTH = {
  'มค': '01', 'กพ': '02', 'มีค': '03', 'เมย': '04', 'พค': '05', 'มิย': '06',
  'กค': '07', 'สค': '08', 'กย': '09', 'ตค': '10', 'พย': '11', 'ธค': '12',
  'มกราคม': '01', 'กุมภาพันธ์': '02', 'มีนาคม': '03', 'เมษายน': '04', 'พฤษภาคม': '05', 'มิถุนายน': '06',
  'กรกฎาคม': '07', 'สิงหาคม': '08', 'กันยายน': '09', 'ตุลาคม': '10', 'พฤศจิกายน': '11', 'ธันวาคม': '12',
};
// แปลงค่าวันที่ใดๆ → ISO 'YYYY-MM-DD' (รองรับ Date จาก XLSX, DD/MM/YYYY, เดือนไทย, พ.ศ., ISO)
function brToISO(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return bdISO(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // เดือนไทย: "01-มิ.ย.-2569" | "04 มิ.ย. 2569 05:01"
  const tm = s.match(/(\d{1,2})[-\s]+([ก-๙.]{2,})[-\s]+(\d{4})/);
  if (tm) {
    const mm = BR_THAI_MONTH[tm[2].replace(/\./g, '')];
    if (mm) { let y = Number(tm[3]); if (y > 2400) y -= 543; return `${y}-${mm}-${String(Number(tm[1])).padStart(2, '0')}`; }
  }
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);   // DD/MM/YYYY
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    let y = Number(yy); if (y > 2400) y -= 543;                       // พ.ศ. → ค.ศ.
    return `${y}-${String(Number(mm)).padStart(2, '0')}-${String(Number(dd)).padStart(2, '0')}`;
  }
  const t = Date.parse(s);
  return isNaN(t) ? '' : bdISO(new Date(t));
}
function brMonthOf(iso) { return String(iso || '').slice(0, 7); }
function brDateDiff(a, b) {
  const ta = Date.parse(a + 'T00:00:00'), tb = Date.parse(b + 'T00:00:00');
  if (isNaN(ta) || isNaN(tb)) return 999;
  return Math.abs(Math.round((tb - ta) / 86400000));
}
const BR_MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function brFmtMonth(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!y || !m) return ym || '—';
  return `${BR_MONTHS_TH[m - 1]} ${y}`;
}

// decode text/CSV → string · ลอง UTF-8 ก่อน (SCB) ถ้าไม่ใช่ fallback windows-874/TIS-620 (KBANK/BBL ภาษาไทยเก่า)
function brDecodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (_) {
    try { return new TextDecoder('windows-874').decode(buf); }
    catch (_2) { return new TextDecoder('utf-8').decode(buf); }
  }
}
// ─── ไฟล์ → AOA (CSV decode เอง · Excel ผ่าน global XLSX) ─────────────────────
function brParseFile(file, password) {
  return file.arrayBuffer().then(buf => {
    const name = (file.name || '').toLowerCase();
    let wb;
    if (/\.(csv|txt)$/.test(name)) {
      wb = XLSX.read(brDecodeText(buf), { type: 'string', raw: true });        // decode เอง กัน mojibake ไทย
    } else {
      // .xls/.xlsx binary — ถ้ามีรหัส (เช่น KTB) ส่ง password ให้ SheetJS ถอด (RC4/Standard)
      const opts = { type: 'array', cellDates: true };
      if (password) opts.password = password;
      wb = XLSX.read(buf, opts);
    }
    const sheets = {};
    wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: '' }); });
    return { sheetNames: wb.SheetNames, sheets };
  });
}
// เดาแถว header — เลือกแถวที่มี "หัวคอลัมน์" มากสุด (กัน false-positive กับแถวสรุปที่มี "วันที่" คำเดียว)
//   จำเป็นเพราะ blankrows:false ตัดแถวว่างทิ้ง → index header ขยับ (เช่น KBANK/BBL มีบล็อกสรุปด้านบน)
function brGuessHeaderRow(aoa) {
  const KEY = /(date|วันที่|debit|credit|เดบิต|เครดิต|amount|จำนวน|ยอด|balance|คงเหลือ|description|รายการ|รายละเอียด|คำอธิบาย|cheque|เช็ค|withdraw|deposit|ถอน|ฝาก|หักบัญชี)/i;
  let best = -1, bestScore = 1;
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const row = aoa[i] || [];
    if (row.filter(c => c !== '' && c != null).length < 3) continue;
    const score = row.filter(c => KEY.test(String(c))).length;       // นับคอลัมน์ที่ดูเป็นหัวตาราง
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best >= 0) return best;
  for (let i = 0; i < Math.min(aoa.length, 30); i++) if ((aoa[i] || []).filter(c => c !== '' && c != null).length >= 3) return i;
  return 0;
}
// auto-map คอลัมน์จากชื่อ header (เดาให้ก่อน ผู้ใช้แก้ได้)
function brAutoMapping(headers) {
  const find = (re) => { for (let i = 0; i < headers.length; i++) if (re.test(String(headers[i]))) return i; return -1; };
  const dateCol  = find(/date|วันที่|วันที|posting/i);
  const debitCol = find(/debit|เดบิต|withdraw|ถอน|จ่าย|ออก/i);
  const creditCol= find(/credit|เครดิต|deposit|ฝาก|รับ|เข้า/i);
  const amountCol= find(/amount|จำนวนเงิน|^ยอด|มูลค่า/i);
  const balCol   = find(/balance|คงเหลือ|ยอดคงเหลือ/i);
  const descCol  = find(/description|รายการ|รายละเอียด|detail|narrative|memo|channel/i);
  const refCol   = find(/cheque|เช็ค|ref|เลขที่|อ้างอิง|transaction|no\.?$/i);
  const mode = (debitCol >= 0 && creditCol >= 0) ? 'split' : 'single';
  return {
    headerRow: 0,  // ตั้งจริงตอนใช้
    mode,
    dateCol:   dateCol >= 0 ? dateCol : 0,
    amountCol: amountCol >= 0 ? amountCol : (debitCol >= 0 ? debitCol : 1),
    outflowPositive: mode === 'single' && debitCol >= 0,  // ถ้าเดารวมจากเดบิต = ยอดบวก=จ่ายออก
    debitCol:  debitCol >= 0 ? debitCol : null,
    creditCol: creditCol >= 0 ? creditCol : null,
    descCol:   descCol >= 0 ? descCol : null,
    refCol:    refCol >= 0 ? refCol : null,
    balanceCol:balCol >= 0 ? balCol : null,
  };
}

// ── Preset ราย "แบรนด์" จากไฟล์ตัวอย่างจริง — map คอลัมน์อัตโนมัติครั้งแรก (ปรับเองได้ใน modal) ──
//   index อิงรูปแบบไฟล์จริง (header อาจไม่อยู่บรรทัดแรก) · KTB เป็น .xls "มีรหัสผ่าน" →
//   เปิดด้วย Excel แล้ว Save As .xlsx/.csv (ไม่ใส่รหัส) ก่อนนำเข้า
const BR_PRESETS = {
  // SCB (UTF-8) · header แถวแรก · acctCol(0)=ไฟล์รวมหลายบัญชี · Note(15)=เลขที่ PV → กระทบยอดแม่นด้วย ref
  SCB:   { headerRow: 0, mode: 'split', acctCol: 0, dateCol: 5, debitCol: 11, creditCol: 12, balanceCol: 13, descCol: 14, refCol: 15 },
  // KBANK (TIS-620) · header แถวที่ 10 (index 9) · มีบล็อกสรุปด้านบน
  KBANK: { headerRow: 9, mode: 'split', dateCol: 0, debitCol: 4, creditCol: 5, balanceCol: 6, descCol: 2, refCol: 7 },
  // BBL (TIS-620) · header แถวที่ 4 (index 3) · สรุปด้านบน + footer ด้านล่าง
  BBL:   { headerRow: 3, mode: 'split', dateCol: 0, debitCol: 3, creditCol: 4, balanceCol: 5, descCol: 2, refCol: null },
};
// AOA + mapping → StatementLine[] (amount: signed, − = จ่ายออก)
function brNormalizeLines(aoa, mapping, accountNo) {
  const rows = aoa.slice((mapping.headerRow || 0) + 1);
  const out = [];
  const baseCount = {};
  const filterAcct = mapping.acctCol != null && bdDigits(accountNo).length >= 4;  // ไฟล์รวมหลายบัญชี (เช่น SCB) → เอาเฉพาะบัญชีที่เลือก
  rows.forEach(r => {
    if (filterAcct && !bdAcctMatchesCheck(accountNo, r[mapping.acctCol])) return;
    const date = brToISO(r[mapping.dateCol]);
    if (!date) return;                          // ไม่มีวันที่ที่อ่านได้ = แถว header/total/footer → ข้าม
    let amount;
    if (mapping.mode === 'split') {
      const dr = brNum(r[mapping.debitCol]);    // เดบิต = จ่ายออก
      const cr = brNum(r[mapping.creditCol]);   // เครดิต = รับเข้า
      amount = cr - dr;
    } else {
      let a = brNum(r[mapping.amountCol]);
      if (mapping.outflowPositive) a = -a;      // บางแบงก์โชว์ยอดถอน/จ่ายเป็นเลขบวก
      amount = a;
    }
    if (!amount) return;                        // ข้ามแถวยอด 0
    const desc    = mapping.descCol  != null ? String(r[mapping.descCol]  || '').trim() : '';
    const ref     = mapping.refCol   != null ? String(r[mapping.refCol]   || '').trim() : '';
    const balance = mapping.balanceCol != null ? (r[mapping.balanceCol] === '' ? null : brNum(r[mapping.balanceCol])) : null;
    const base = `${accountNo}|${date}|${amount.toFixed(2)}|${(ref || desc).slice(0, 18)}`;
    baseCount[base] = (baseCount[base] || 0) + 1;
    out.push({ id: base + '#' + baseCount[base], date, amount, desc, ref, balance, bankAcct: accountNo, _idx: out.length, raw: r });
  });
  return out;
}

// ─── มุมมองรายเดือน (ยกมา → เคลื่อนไหว → คงเหลือ) จากตัว statement เอง ──────────
function brMonthlyView(lines) {
  // sort วันที่ + ลำดับในไฟล์ — รองรับไฟล์เรียงใหม่→เก่า (newest-first เช่น BBL): รายการวันเดียวกัน
  //   เรียงกลับลำดับไฟล์ให้เป็นเวลาจริง เพื่อให้ running balance/ยอดยกมา-คงเหลือ ตรงกับ statement
  const fileDesc = lines.length > 1 && lines[0].date > lines[lines.length - 1].date;
  const sorted = lines.slice().sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (fileDesc ? (b._idx || 0) - (a._idx || 0) : (a._idx || 0) - (b._idx || 0)));
  const inTotal  = sorted.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0);
  const outTotal = sorted.filter(l => l.amount < 0).reduce((s, l) => s - l.amount, 0);
  const hasBal = sorted.some(l => l.balance != null);
  let opening = null, closing = null;
  if (hasBal && sorted.length) {
    const first = sorted.find(l => l.balance != null);
    const last  = sorted.slice().reverse().find(l => l.balance != null);
    if (first) opening = first.balance - first.amount;   // ยอดก่อนรายการแรก = ยกมา
    if (last)  closing = last.balance;
  }
  let run = opening != null ? opening : 0;
  const rows = sorted.map(l => { run += l.amount; return { ...l, running: l.balance != null ? l.balance : run }; });
  if (opening == null && sorted.length) closing = run;
  const expectedClosing = opening != null ? opening + (inTotal - outTotal) : null;
  const balOK = (closing != null && expectedClosing != null) ? Math.abs(closing - expectedClosing) < 0.01 : null;
  return { sorted: rows, inTotal, outTotal, opening, closing, expectedClosing, balOK, hasBal, count: sorted.length };
}

// ─── Reconcile engine — statement (จ่ายออก) ↔ PV ──────────────────────────────
//   3 ถัง: matched · missing (เกิดจริงแต่ยังไม่ลงระบบ) · unmatchedPv (ลงระบบแต่ยังไม่ออกจริง)
function brReconcile(opts) {
  const lines = opts.lines || [], pvs = opts.pvs || [], reconState = opts.reconState || {};
  // refPool = PV ทั้งระบบที่มีเลขที่ PV — ใช้เฉพาะ pass 0 (จับด้วยเลข PV ที่ statement อ้างถึงตรงๆ)
  // เพื่อให้รายการที่ statement พิมพ์เลข PV ไว้แล้ว ไม่หลุดเป็น "ขาดบันทึก" เพียงเพราะ PV ลงคนละเดือน/คนละช่องบัญชี
  const refPool = opts.refPool || pvs;
  const tol = opts.amtTol != null ? opts.amtTol : 0.01;
  const win = opts.dateWindow != null ? opts.dateWindow : 3;
  const outLines = lines.filter(l => l.amount < 0);
  const inLines  = lines.filter(l => l.amount > 0);
  const pvAvail  = pvs.map((p, i) => ({ p, i, used: false }));
  // PV ใน refPool ที่ไม่อยู่ใน scope (คนละเดือน/บัญชี) → ใช้ได้เฉพาะ pass 0 และไม่โผล่ในถัง unmatchedPv
  const pvKey = p => (p.id != null ? 'i' + p.id : 'k' + p.pvNo + '@' + p.date + '@' + p.amount);
  const scopedKeys = new Set(pvs.map(pvKey));
  const refExtra = refPool.filter(p => p.pvNo && !scopedKeys.has(pvKey(p))).map((p, i) => ({ p, i: 'x' + i, used: false, extra: true }));
  const matched = [], recorded = [], transfers = [];
  const toMatch = [], manualMatched = [];
  outLines.forEach(l => {
    const st = reconState[l.id];
    if (st && st.decision === 'recorded') recorded.push({ line: l, forecastId: st.forecastId });
    else if (st && st.decision === 'transfer') transfers.push(l);   // โอนระหว่างบัญชี — ไม่นับเป็นรายจ่าย
    else if (st && st.decision === 'matched') manualMatched.push({ line: l, pvRef: st.pvRef });  // ผูก PV เอง
    else toMatch.push(l);
  });
  toMatch.sort((a, b) => (a.date + a.id) < (b.date + b.id) ? -1 : 1);

  // ── จับคู่เอง (manual match) — ผู้ใช้ผูก statement line ↔ PV เอง (เคสเลขเอกสารเปลี่ยน auto-match พลาด) ──
  //   จองก่อน pass อัตโนมัติ เพื่อกัน PV ที่ผูกมือไปโดนจับให้บรรทัดอื่น · ไม่สร้าง Actual ใหม่
  //   (PV เป็น Actual ในระบบอยู่แล้ว) — แค่ทำให้ทั้งสองฝั่งออกจากถังค้าง
  manualMatched.forEach(mm => {
    const ref = brNormRef(mm.pvRef);
    const c = pvAvail.find(x => !x.used && (String(x.p.id) === String(mm.pvRef) || (ref && brNormRef(x.p.pvNo) === ref)));
    if (c) c.used = true;
    matched.push({ line: mm.line, pv: c ? c.p : { pvNo: mm.pvRef, amount: -Math.abs(mm.line.amount), date: mm.line.date },
      via: 'manual', manual: true, score: 300 });
  });

  // ── pass 0: ref = เลขที่ PV ใน statement (เช่น SCB คอลัมน์ Note = PVxxxx) — แม่นสุด ──
  //   รองรับ 1 PV หลายขา (เลข PV เดียวกันหลายบรรทัด → จับเป็นกลุ่มเดียว)
  const pvByNo = {};
  pvAvail.concat(refExtra).forEach(c => { const k = brNormRef(c.p.pvNo); if (k) (pvByNo[k] = pvByNo[k] || []).push(c); });
  const linesByPv = {}, rest = [];
  toMatch.forEach(l => {
    const k = brFindPvInRef(l.ref, pvByNo);
    if (k) (linesByPv[k] = linesByPv[k] || []).push(l);
    else rest.push(l);
  });
  Object.keys(linesByPv).forEach(k => {
    const ls = linesByPv[k], cs = pvByNo[k].filter(c => !c.used);
    if (!cs.length) { rest.push(...ls); return; }
    cs.forEach(c => c.used = true);
    const lineSum = ls.reduce((s, x) => s + Math.abs(x.amount), 0);
    const pvSum   = cs.reduce((s, c) => s + Math.abs(c.p.amount), 0);
    matched.push({
      line: ls.length === 1 ? ls[0] : { _group: true, lines: ls, date: ls[0].date, amount: -lineSum, desc: `รวม ${ls.length} รายการ`, ref: k },
      lines: ls, pvs: cs.map(c => c.p), via: 'ref', score: 200,
      amtMismatch: Math.abs(lineSum - pvSum) > tol ? (lineSum - pvSum) : 0,
    });
  });

  // ── pass 1: 1:1 amount+date ──
  rest.sort((a, b) => (a.date + a.id) < (b.date + b.id) ? -1 : 1);
  const after1 = [];
  rest.forEach(l => {
    const target = Math.abs(l.amount);
    let best = null, bestScore = -1;
    pvAvail.forEach(c => {
      if (c.used) return;
      if (Math.abs(c.p.amount - target) > tol) return;
      const dd = c.p.date ? brDateDiff(l.date, c.p.date) : 999;
      if (dd > win) return;
      let score = 50 - dd * 10;
      if (l.ref && c.p.chqNo && bdDigits(l.ref) && bdDigits(l.ref) === bdDigits(c.p.chqNo)) score += 100;
      if (Math.abs(c.p.amount - target) < 0.005) score += 10;
      if (score > bestScore) { bestScore = score; best = c; }
    });
    if (best) { best.used = true; matched.push({ line: l, pv: best.p, score: bestScore, via: '1:1' }); }
    else after1.push(l);
  });

  // ── pass 2: split (1 statement line = ผลรวมของ 2-3 PV ในกรอบวัน) ──
  const missing = [];
  after1.forEach(l => {
    const target = Math.abs(l.amount);
    const cand = pvAvail.filter(c => !c.used && c.p.date && brDateDiff(l.date, c.p.date) <= win).sort((a, b) => b.p.amount - a.p.amount);
    const combo = brFindSubset(cand, target, tol, 3);
    if (combo) { combo.forEach(c => c.used = true); matched.push({ line: l, pvs: combo.map(c => c.p), score: 5, via: 'split' }); }
    else missing.push(l);
  });

  const unmatchedPv = pvAvail.filter(c => !c.used).map(c => c.p);
  const stats = {
    matched: matched.length, missing: missing.length, unmatchedPv: unmatchedPv.length, recorded: recorded.length, transfers: transfers.length,
    missingAmt: missing.reduce((s, l) => s + Math.abs(l.amount), 0),
    unmatchedPvAmt: unmatchedPv.reduce((s, p) => s + Math.abs(p.amount), 0),
  };
  return { matched, missing, unmatchedPv, recorded, transfers, inLines, stats };
}
function brNormRef(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }
// หา pvNo ใน ref ของ statement (ref อาจมีข้อความปน) — คืน key ที่ match ใน pvByNo
function brFindPvInRef(ref, pvByNo) {
  const r = brNormRef(ref);
  if (!r) return null;
  if (pvByNo[r]) return r;
  const keys = Object.keys(pvByNo);
  for (let i = 0; i < keys.length; i++) { if (keys[i].length >= 6 && r.indexOf(keys[i]) >= 0) return keys[i]; }
  return null;
}
// หา subset (≤maxN) ของ cand ที่ผลรวม ≈ target (greedy + backtrack เล็กน้อย)
function brFindSubset(cand, target, tol, maxN) {
  const n = Math.min(cand.length, 12);   // bound
  const arr = cand.slice(0, n);
  let found = null;
  const dfs = (start, remain, picked) => {
    if (found) return;
    if (Math.abs(remain) <= tol && picked.length >= 2) { found = picked.slice(); return; }
    if (picked.length >= maxN) return;
    for (let i = start; i < arr.length; i++) {
      if (arr[i].p.amount - tol > remain) continue;   // เกิน target แล้ว ข้าม (เรียงมาก→น้อย)
      picked.push(arr[i]);
      dfs(i + 1, remain - arr[i].p.amount, picked);
      picked.pop();
      if (found) return;
    }
  };
  dfs(0, target, []);
  return found;
}

// ─── สี/ป้ายแบงก์บนหัวบัญชี ────────────────────────────────────────────────────
function brBrandChip(acct) {
  const b = bdBrand(brBrandKey(acct));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#fff',
      background: b.color, padding: '3px 9px', borderRadius: 6 }}>
      {b.label} <span style={{ opacity: .85, fontWeight: 500 }}>···{bdLast4(acct.accountNo)}</span>
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function BankReconPage({ data, setData, toast }) {
  const readOnly = typeof _wtpRoleIsReadOnly === 'function' && _wtpRoleIsReadOnly();
  const accounts = brMemo(() => (data.bankAccounts || []).map(bdAcct)
    .filter(a => a.accountNo && (a.type || '').toLowerCase() !== 'closed' && (a.type || '').toLowerCase() !== 'dormant'), [data.bankAccounts]);

  const [accountNo, setAccountNo] = brState('');
  const today = new Date();
  const [month, setMonth] = brState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  const [linesAll, setLinesAll]   = brState(() => BankReconStore.getLines());
  const [mapAll, setMapAll]       = brState(() => BankReconStore.getMapping());
  const [reconState, setReconState] = brState(() => BankReconStore.getState());
  const [preview, setPreview]     = brState(null);   // { fileName, sheetNames, sheetIdx, aoa, mapping, brand }
  const [recordLine, setRecordLine] = brState(null); // line ในถัง missing → modal บันทึกจ่ายจริง
  const [matchLine, setMatchLine]   = brState(null); // line → modal จับคู่ PV เอง
  const [pwdPrompt, setPwdPrompt]   = brState(null); // { file, error, unsupported } → modal ใส่รหัสไฟล์ (KTB)
  const fileRef = brRef(null);

  // default account = อันแรก
  brEffect(() => { if (!accountNo && accounts.length) setAccountNo(accounts[0].accountNo); }, [accounts]);
  const acct = accounts.find(a => a.accountNo === accountNo) || accounts[0] || null;

  // ── Hydrate จาก cloud (synced entity bankReconLines/State) → cloud ชนะ, อัป localStorage cache ──
  //    push ตอนเขียน (import/ลบ/บันทึก) ไปที่ data ผ่าน setData → sync ขึ้นชีตเอง
  const brCloudSig = brRef(null);
  brEffect(() => {
    // กรองเฉพาะแถวที่เป็น recon จริง — กัน gviz อ่านแท็บผิด (เช่นแท็บ bankReconLines ยังไม่ถูกสร้าง
    //   → คืนชีตแรกมาเป็นขยะ) มาทับ/ล้าง cache ในเครื่อง
    const rows   = (data.bankReconLines || []).filter(r => r && r.accountNo && r.ym);
    const stRows = (data.bankReconState || []).filter(r => r && r.id != null && r.id !== '' && r.decision);
    if (!rows.length && !stRows.length) return;          // ยังไม่มีข้อมูล recon จริงจาก cloud → คง local cache
    const sig = JSON.stringify(rows) + '~' + JSON.stringify(stRows);
    if (sig === brCloudSig.current) return;              // ไม่เปลี่ยน → ข้าม (กัน setState ซ้ำ)
    brCloudSig.current = sig;
    const nested = brRowsToLines(rows);
    const stMap  = brRowsToState(stRows);
    setLinesAll(nested);   BankReconStore.setLines(nested);
    setReconState(stMap);  BankReconStore.setState(stMap);
  }, [data.bankReconLines, data.bankReconState]);

  // push ขึ้น cloud (entity table) — เก็บ localStorage เป็น cache ควบคู่
  const pushReconLines = (nested) => { if (setData) setData(d => ({ ...d, bankReconLines: brLinesToRows(nested) })); };
  const pushReconState = (stMap)  => { if (setData) setData(d => ({ ...d, bankReconState: brStateToRows(stMap) })); };

  // ── Self-heal: กู้แถว "บันทึกจ่ายจริง" (BANK_RECON) ที่หายจาก forecastEntries กลับมา ──────────
  //   ปัญหาเดิม: รายการที่กดบันทึกจ่ายจริงหน้านี้ (เขียนเป็น forecastEntries STATUS=ACTUAL → เด้งเข้า
  //   Actual หน้า Weekly Forecast) เกิดบนเครื่องเดียว พอตาราง forecastEntries โดน clobber/wedge
  //   ข้ามไคลเอนต์ (state คนอื่นเก่ากว่า ดันทับ) แถวพวกนี้โดนลบทีละไม่กี่แถว (ต่ำกว่าเกณฑ์ guard)
  //   แล้วไม่มีใครมีให้กู้กลับ → ยอดหายจาก Weekly Forecast.
  //   reconState (ตารางแยก โดน clobber น้อยกว่า) ยังเก็บ decision='recorded' + forecastId ไว้ →
  //   ถ้า forecastId นั้นหายจาก forecastEntries ให้สร้างแถวขึ้นใหม่ด้วย "forecastId เดิม" (idempotent)
  //   จาก bankReconLines (หรือถอด accountNo|date|amount จากตัว line.id) → เด้งเข้า Actual อีกครั้ง.
  //   ทำเฉพาะคนที่แก้ได้ (readOnly ไม่ push); คู่กับเกราะ protect-ACTUAL ฝั่งเซิร์ฟเวอร์ พอกู้แล้วอยู่ถาวร.
  const brHealRef   = brRef('');
  const brUndoneRef = brRef(null); if (!brUndoneRef.current) brUndoneRef.current = {};   // forecastId ที่เพิ่งกด undo → กัน self-heal สร้างกลับ
  brEffect(() => {
    if (readOnly || !setData) return;
    const fes = data.forecastEntries;
    if (!Array.isArray(fes) || !fes.length) return;                    // ยังไม่โหลด forecastEntries จริง → รอ
    const recorded = (data.bankReconState || [])
      .filter(r => r && r.decision === 'recorded' && r.forecastId);
    if (!recorded.length) return;
    const feIds = new Set(fes.map(f => String(f.id)));
    const missing = recorded.filter(s => !feIds.has(String(s.forecastId)) && !brUndoneRef.current[String(s.forecastId)]);
    if (!missing.length) { brHealRef.current = ''; return; }            // ครบแล้ว → รีเซ็ต (ให้กู้ใหม่ได้ถ้าโดนลบรอบหน้า)
    const lineById = {};
    (data.bankReconLines || []).forEach(l => { if (l && l.id != null) lineById[String(l.id)] = l; });
    const todayISO = new Date().toISOString().slice(0, 10);
    const add = [];
    missing.forEach(s => {
      const lineId = String(s.id);
      let line = lineById[lineId];
      if (!line) {                                                      // ไม่มี line ในเครื่อง → ถอดจาก id: accountNo|date|amount|ref#n
        const parts = lineId.split('|');
        if (parts.length < 3) return;
        const amt = Number(parts[2]);
        if (!isFinite(amt) || !amt) return;
        line = { accountNo: parts[0], date: parts[1], amount: amt, desc: '', ref: String(parts[3] || '').replace(/#\d+$/, '') };
      }
      const amount = -Math.abs(Number(line.amount) || 0);
      if (!amount) return;
      add.push({
        id: s.forecastId, DATE: todayISO, PAYMENT_DATE: line.date, EXPENSE_TYPE: 'BANK_RECON',
        DESCRIPTION: line.desc || ('รายการธนาคาร' + (line.ref ? ' ' + line.ref : '')),
        AMOUNT: String(amount), Bank_AC: line.accountNo || line.bankAcct || null,
        STATUS: 'ACTUAL', CATEGORY: null,
        ACTUAL_AMOUNT: String(amount), ACTUAL_DATE: line.date,
        REF_DOC: line.ref || null, BOOKED_AT: null, CFS_ACTIVITY: null,
        NOTE: 'กู้คืนอัตโนมัติจากกระทบยอด (self-heal)',
      });
    });
    if (!add.length) return;
    const sig = add.map(r => r.id).sort().join(',');
    if (sig === brHealRef.current) return;                             // กันยิงซ้ำชุดเดิมระหว่างรอ push/poll
    brHealRef.current = sig;
    setData(d => {
      const have = new Set((d.forecastEntries || []).map(f => String(f.id)));
      const fresh = add.filter(r => !have.has(String(r.id)));
      if (!fresh.length) return d;
      return { ...d, forecastEntries: [...(d.forecastEntries || []), ...fresh] };
    });
    if (toast) toast('กู้คืน ' + add.length + ' รายการจ่ายจริง (กระทบยอด) ที่หายจากการ sync → เด้งเข้า Actual');
  }, [data.forecastEntries, data.bankReconState, data.bankReconLines]);

  // PV ของบัญชี+เดือนนี้ (outflow) — ผูกบัญชีด้วย bdAcctMatchesCheck (เลขท้าย 4)
  const pvForAcct = brMemo(() => {
    if (!acct) return [];
    return (data.pvVouchers || []).map(bdNormPV)
      .filter(p => p.amount > 0 && p.date && brMonthOf(p.date) === month && bdAcctMatchesCheck(acct.accountNo, p.bankAc));
  }, [data.pvVouchers, acct && acct.accountNo, month]);

  // PV ทั้งระบบที่มีเลขที่ PV (ทุกบัญชี/ทุกเดือน) — ให้ pass 0 จับด้วยเลข PV ที่ statement อ้างถึงตรงๆ
  const pvRefPool = brMemo(() => (data.pvVouchers || []).map(bdNormPV).filter(p => p.amount > 0 && p.pvNo), [data.pvVouchers]);

  const lines = brMemo(() => ((linesAll[accountNo] || {})[month]) || [], [linesAll, accountNo, month]);
  const monthly = brMemo(() => brMonthlyView(lines), [lines]);
  const recon = brMemo(() => brReconcile({ lines, pvs: pvForAcct, refPool: pvRefPool, reconState }), [lines, pvForAcct, pvRefPool, reconState]);

  // เดือนที่มีข้อมูล statement ของบัญชีนี้ (ไว้สลับเร็ว)
  const monthsWithData = brMemo(() => Object.keys(linesAll[accountNo] || {}).sort().reverse(), [linesAll, accountNo]);

  // ── Import flow ── (รองรับไฟล์มีรหัส เช่น KTB: เด้ง modal ใส่รหัส → ถอด → นำเข้า)
  const parseAndPreview = (file, password) => {
    brParseFile(file, password).then(({ sheetNames, sheets }) => {
      const sheetIdx = 0;
      const aoa = sheets[sheetNames[0]] || [];
      const brand = brBrandKey(acct);
      const saved = mapAll[brand];
      const guessed = brGuessHeaderRow(aoa);   // หา header เองเสมอ (กัน index เพี้ยนจาก blank-row)
      let mapping;
      if (saved) mapping = { ...saved };                                            // ที่เคยตั้งไว้ (จำ header row ด้วย)
      else if (BR_PRESETS[brand]) mapping = { ...BR_PRESETS[brand], headerRow: guessed };  // preset (คอลัมน์) + header ที่ตรวจเจอจริง
      else mapping = { ...brAutoMapping(aoa[guessed] || []), headerRow: guessed };
      if (mapping.headerRow == null) mapping.headerRow = guessed;
      setPwdPrompt(null);   // ถอด/อ่านสำเร็จ → ปิด modal รหัส (ถ้าเปิดอยู่)
      setPreview({ fileName: file.name, sheetNames, sheets, sheetIdx, aoa, headerRow: mapping.headerRow, mapping, brand, accountNo: acct.accountNo });
    }).catch(err => {
      const msg = String((err && err.message) || err).toLowerCase();
      const needsPwd = /password|encrypt|protect/.test(msg);
      const wrongPwd = password && /incorrect|wrong|invalid|password/.test(msg);
      if (needsPwd && !password) {
        setPwdPrompt({ file, error: '', unsupported: false });           // ครั้งแรก → ขอรหัส
      } else if (password && wrongPwd) {
        setPwdPrompt({ file, error: 'รหัสไม่ถูกต้อง — ลองใหม่อีกครั้ง', unsupported: false });
      } else if (password) {
        // ใส่รหัสแล้วแต่ถอดไม่ได้ (เช่น .xls เข้ารหัสแบบที่ SheetJS ไม่รองรับ) → แนะ Save As
        setPwdPrompt({ file, error: 'ถอดรหัสไฟล์นี้ไม่สำเร็จ (รูปแบบเข้ารหัสที่เบราว์เซอร์อ่านไม่ได้)', unsupported: true });
      } else if (toast) { toast('อ่านไฟล์ไม่สำเร็จ: ' + msg); }
    });
  };
  const onPickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !acct) return;
    parseAndPreview(file, null);
  };
  const applyImport = (mapping) => {
    if (!preview || !acct) return;
    const newLines = brNormalizeLines(preview.aoa, mapping, acct.accountNo);
    if (!newLines.length) { if (toast) toast('ไม่พบรายการที่อ่านได้ — ลองปรับ map คอลัมน์/แถว header'); return; }
    // เก็บ mapping ต่อแบรนด์ + bucket รายเดือนตามวันที่จริงในไฟล์
    const nm = { ...mapAll, [preview.brand]: mapping }; setMapAll(nm); BankReconStore.setMapping(nm);
    const acctBucket = { ...(linesAll[acct.accountNo] || {}) };
    const byMonth = {};
    newLines.forEach(l => { (byMonth[brMonthOf(l.date)] = byMonth[brMonthOf(l.date)] || []).push(l); });
    Object.keys(byMonth).forEach(m => { acctBucket[m] = byMonth[m]; });   // ทับเฉพาะเดือนที่อยู่ในไฟล์
    const nl = { ...linesAll, [acct.accountNo]: acctBucket }; setLinesAll(nl); BankReconStore.setLines(nl); pushReconLines(nl);
    const months = Object.keys(byMonth).sort();
    if (months.length) setMonth(months[months.length - 1]);
    setPreview(null);
    if (toast) toast(`นำเข้า ${newLines.length} รายการ (${months.map(brFmtMonth).join(', ')})`);
  };
  const clearMonth = () => {
    if (!acct || !window.confirm(`ลบ statement ของ ${brFmtMonth(month)} บัญชีนี้?`)) return;
    const acctBucket = { ...(linesAll[acct.accountNo] || {}) }; delete acctBucket[month];
    const nl = { ...linesAll, [acct.accountNo]: acctBucket }; setLinesAll(nl); BankReconStore.setLines(nl); pushReconLines(nl);
  };

  // ── บันทึก "เกิดจริงแต่ยังไม่ลงระบบ" → forecastEntries STATUS=ACTUAL (เด้งเข้า Cashflow) ──
  const recordActual = (line, cat) => {
    if (readOnly) { if (toast) toast('สิทธิ์นี้ดูได้อย่างเดียว'); return; }
    const id = (window.WTPData && WTPData.newId) ? WTPData.newId() : ('fe-' + Date.now());
    const todayISO = new Date().toISOString().slice(0, 10);
    const row = {
      id, DATE: todayISO, PAYMENT_DATE: line.date, EXPENSE_TYPE: 'BANK_RECON',
      DESCRIPTION: line.desc || ('รายการธนาคาร' + (line.ref ? ' ' + line.ref : '')),
      AMOUNT: String(-Math.abs(line.amount)), Bank_AC: line.bankAcct || (acct && acct.accountNo) || null,
      STATUS: 'ACTUAL', CATEGORY: cat ? String(cat) : null,
      ACTUAL_AMOUNT: String(-Math.abs(line.amount)), ACTUAL_DATE: line.date,
      REF_DOC: line.ref || null, BOOKED_AT: null, CFS_ACTIVITY: null, NOTE: 'นำเข้าจาก statement (กระทบยอด)',
    };
    setData(d => ({ ...d, forecastEntries: [...(d.forecastEntries || []), row] }));
    const ns = { ...reconState, [line.id]: { decision: 'recorded', forecastId: id } };
    setReconState(ns); BankReconStore.setState(ns); pushReconState(ns);
    setRecordLine(null);
    if (toast) toast('บันทึกจ่ายจริงแล้ว → เด้งเข้า Actual หน้า Cashflow');
  };
  const undoRecord = (line, forecastId) => {
    if (readOnly) return;
    if (forecastId) {
      brUndoneRef.current[String(forecastId)] = true;                 // ★ กัน self-heal สร้างแถวนี้กลับ (เจตนาลบ)
      setData(d => ({ ...d, forecastEntries: (d.forecastEntries || []).filter(e => e.id !== forecastId) }));
      // แถวนี้ STATUS=ACTUAL → diff ลบปกติจะโดนเกราะ protect-ACTUAL ฝั่งเซิร์ฟเวอร์บล็อก (เด้งกลับ)
      //   ดังนั้นสั่งลบจริงด้วย forceDeleteRows (allowShrink) — เป็นการลบที่ผู้ใช้ตั้งใจ
      if (window.WTPData && typeof WTPData.forceDeleteRows === 'function') {
        WTPData.forceDeleteRows('forecastEntries', forecastId);
      }
    }
    const ns = { ...reconState }; delete ns[line.id];
    setReconState(ns); BankReconStore.setState(ns); pushReconState(ns);
    if (toast) toast('ยกเลิกบันทึก — ลบออกจาก Actual แล้ว');
  };

  // ── จับคู่ PV เอง (manual match) — เคสเลขเอกสารเปลี่ยน auto-match พลาด ──────────
  //   ผูก statement line ↔ PV ที่เลือก: ทั้งคู่ออกจากถังค้าง ไปอยู่ "แมตช์แล้ว (จับคู่เอง)"
  //   ★ ทนทานกว่ากด "ยกเลิก": ถ้าบรรทัดนี้เคยกด "บันทึกจ่ายจริง" มาก่อน (decision='recorded')
  //     จะ "เปลี่ยน decision เป็น matched" (ไม่ใช่ลบทิ้ง) → self-heal เลิกสร้างแถว BANK_RECON
  //     กลับมา (มันกู้เฉพาะ decision='recorded') + ไม่นับ Actual ซ้ำกับ PV
  const manualMatchPv = (line, pv) => {
    if (readOnly) { if (toast) toast('สิทธิ์นี้ดูได้อย่างเดียว'); return; }
    if (!pv) return;
    const prev = reconState[line.id];
    if (prev && prev.decision === 'recorded' && prev.forecastId) {
      brUndoneRef.current[String(prev.forecastId)] = true;             // กัน self-heal สร้างแถวจ่ายจริงกลับ
      setData(d => ({ ...d, forecastEntries: (d.forecastEntries || []).filter(e => e.id !== prev.forecastId) }));
      if (window.WTPData && typeof WTPData.forceDeleteRows === 'function') WTPData.forceDeleteRows('forecastEntries', prev.forecastId);
    }
    const pvRef = (pv.id != null && pv.id !== '') ? String(pv.id) : (pv.pvNo || '');
    const ns = { ...reconState, [line.id]: { decision: 'matched', forecastId: '', pvRef } };
    setReconState(ns); BankReconStore.setState(ns); pushReconState(ns);
    setMatchLine(null);
    if (toast) toast('จับคู่ PV เองแล้ว — ไม่สร้างรายการ Actual ซ้ำ (PV เป็น Actual อยู่แล้ว)');
  };

  // ── ทำเครื่องหมาย "โอนระหว่างบัญชี" — ออกจากถังขาดบันทึก โดยไม่สร้าง Actual (ไม่ใช่รายจ่าย) ──
  const markTransfer = (line) => {
    if (readOnly) { if (toast) toast('สิทธิ์นี้ดูได้อย่างเดียว'); return; }
    const ns = { ...reconState, [line.id]: { decision: 'transfer', forecastId: '' } };
    setReconState(ns); BankReconStore.setState(ns); pushReconState(ns);
    if (toast) toast('ทำเครื่องหมาย "โอนระหว่างบัญชี" — ไม่นับเป็นรายจ่าย');
  };

  // เดาว่าเป็นโอนระหว่างบัญชีตัวเอง: desc มีคำว่าโอน + (ชื่อบริษัทตัวเอง หรือเลขท้ายบัญชีตัวเองในระบบ)
  const ownLast4 = brMemo(() => new Set((data.bankAccounts || []).map(a => bdLast4(bdAcct(a).accountNo)).filter(Boolean)), [data.bankAccounts]);
  const companyKey = (data.meta && (data.meta.shortName || data.meta.companyName)) || '';
  const isLikelyTransfer = (line) => {
    const d = String((line && line.desc) || '');
    if (!/โอน|transfer/i.test(d)) return false;
    if (companyKey && d.indexOf(companyKey) >= 0) return true;
    if (/ไบโอแอ็กซ์เซลล์|bioaxel|bioxcel|bioaxcell/i.test(d)) return true;
    return (d.match(/\d{4}/g) || []).some(x => ownLast4.has(x));
  };

  const goMonth = (delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // ── สำรอง/กู้คืนข้อมูลกระทบยอด (statement + สถานะ + column map) เป็นไฟล์ JSON ──
  //    หน้านี้เก็บใน localStorage เครื่องเดียว → ไฟล์สำรองกันข้อมูลหาย/ย้ายเครื่องได้
  const backupRef = React.useRef(null);
  const exportBackup = () => {
    const payload = { _type: 'wtp-bankrecon-backup', _at: new Date().toISOString(),
      lines: BankReconStore.getLines(), state: BankReconStore.getState(), mapping: BankReconStore.getMapping() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'bankrecon-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    if (toast) toast('ดาวน์โหลดไฟล์สำรองข้อมูลกระทบยอดแล้ว');
  };
  const importBackup = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(r.result);
        if (!o || o._type !== 'wtp-bankrecon-backup') { if (toast) toast('ไฟล์สำรองไม่ถูกต้อง'); return; }
        if (!confirm('กู้คืนข้อมูลกระทบยอดจากไฟล์สำรอง?\n(ทับข้อมูลปัจจุบันในเครื่องนี้)')) return;
        if (o.lines)   { setLinesAll(o.lines);     BankReconStore.setLines(o.lines);   pushReconLines(o.lines); }
        if (o.state)   { setReconState(o.state);   BankReconStore.setState(o.state);   pushReconState(o.state); }
        if (o.mapping) { setMapAll(o.mapping);     BankReconStore.setMapping(o.mapping); }
        if (toast) toast('กู้คืนข้อมูลสำรองแล้ว — sync ขึ้นชีตให้ทีมด้วย');
      } catch (e) { if (toast) toast('อ่านไฟล์สำรองไม่ได้: ' + (e.message || e)); }
    };
    r.readAsText(file);
  };

  if (!accounts.length) {
    return <div className="page bg-pattern"><div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-500)' }}>ยังไม่มีบัญชีธนาคารในระบบ</div></div>;
  }

  return (
    <div className="page bg-pattern">
      <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx,.txt" style={{ display: 'none' }} onChange={onPickFile} />

      {/* Header */}
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">กระทบยอดธนาคาร</h1>
          <div className="page-sub">Bank Reconciliation · เทียบ PV ในระบบ กับรายการเดินบัญชีจริง · {brFmtMonth(month)}</div>
        </div>
        <div className="page-head-r" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => goMonth(-1)} title="เดือนก่อน">‹</button>
          <div style={{ padding: '6px 12px', background: 'var(--ink-50)', borderRadius: 8, fontSize: 13, fontWeight: 600, minWidth: 96, textAlign: 'center' }}>{brFmtMonth(month)}</div>
          <button className="btn btn-ghost" onClick={() => goMonth(1)} title="เดือนถัดไป">›</button>
          <button className="btn btn-ghost" onClick={exportBackup} title="ดาวน์โหลดไฟล์สำรองข้อมูลกระทบยอด (กันข้อมูลหาย / ย้ายเครื่อง)">💾 สำรอง</button>
          {!readOnly && <button className="btn btn-ghost" onClick={() => backupRef.current && backupRef.current.click()} title="กู้คืนจากไฟล์สำรอง">↩️ กู้คืน</button>}
          {!readOnly && <button className="btn btn-primary" onClick={() => fileRef.current && fileRef.current.click()} title="นำเข้าไฟล์รายการเดินบัญชี (CSV/Excel)">📥 นำเข้า statement</button>}
        </div>
      </div>
      <input ref={backupRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files && e.target.files[0]; if (f) importBackup(f); e.target.value = ''; }} />

      {/* Account selector — ปุ่มแบงค์ กดคลิกเดียวเข้าเลย (เลิกใช้ dropdown) */}
      <div className="card anim-in" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-600)' }}>บัญชี:</span>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {accounts.map(a => {
              const active = a.accountNo === accountNo;
              const b = bdBrand(brBrandKey(a));
              return (
                <button key={a.accountNo} type="button" onClick={() => setAccountNo(a.accountNo)}
                  title={a.accountName || a.bankName || a.accountNo}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'inherit',
                    border: `2px solid ${active ? b.color : 'var(--line)'}`,
                    background: active ? `color-mix(in oklch, ${b.color} 10%, #fff)` : '#fff',
                    borderRadius: 11, padding: '5px 13px 5px 6px',
                    fontSize: 12.5, fontWeight: active ? 700 : 600,
                    color: active ? b.color : 'var(--ink-600)',
                    boxShadow: active ? `0 2px 10px color-mix(in oklch, ${b.color} 28%, transparent)` : 'none',
                    transition: 'all .14s',
                  }}>
                  <HpBankLogo name={a.bankName} />
                  <span>{b.label} <span style={{ opacity: .7, fontWeight: 500 }}>···{bdLast4(a.accountNo)}</span></span>
                </button>
              );
            })}
          </div>
        </div>
        {monthsWithData.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 10, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span>มี statement:</span>
            {monthsWithData.map(m => (
              <button key={m} onClick={() => setMonth(m)} style={{ border: 'none', background: m === month ? 'var(--brand-500)' : 'var(--ink-100)', color: m === month ? '#fff' : 'var(--ink-700)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>{brFmtMonth(m)}</button>
            ))}
          </div>
        )}
      </div>

      {/* KPI — ยกมา / เข้า / ออก / คงเหลือ + cross-check */}
      <div className="grid anim-in" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 8 }}>
        <KpiTile label="ยอดยกมา (ต้นเดือน)" value={monthly.opening != null ? monthly.opening : 0} digits={0} accent="var(--brand-500)" icon="coin" />
        <KpiTile label="เงินเข้า" value={monthly.inTotal} digits={0} accent="var(--good)" icon="arrow_down" />
        <KpiTile label="เงินออก" value={monthly.outTotal} digits={0} accent="var(--bad)" icon="arrow_up" />
        <KpiTile label="คงเหลือ (ปลายเดือน)" value={monthly.closing != null ? monthly.closing : 0} digits={0} accent="var(--brand-700)" icon="bank" />
      </div>
      {monthly.count > 0 && monthly.balOK != null && (
        <div style={{ marginBottom: 16, fontSize: 12, fontWeight: 600,
          color: monthly.balOK ? 'var(--good)' : 'var(--bad)' }}>
          {monthly.balOK
            ? '✓ ยอดคงเหลือใน statement ตรงกับผลรวมรายการ'
            : `⚠️ ยอดคงเหลือไม่ตรง (ต่าง ${fmtNum(Math.abs(monthly.closing - monthly.expectedClosing), 2)}) — อาจมีรายการขาด/ซ้ำใน statement`}
        </div>
      )}

      {/* ไม่มี statement → ชวนนำเข้า */}
      {monthly.count === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-500)', marginBottom: 16 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🏦</div>
          <div style={{ fontWeight: 600, color: 'var(--ink-700)', marginBottom: 4 }}>ยังไม่มีรายการเดินบัญชีของ {brFmtMonth(month)}</div>
          <div style={{ fontSize: 12.5, marginBottom: 14 }}>นำเข้าไฟล์ statement (CSV/Excel) จากธนาคาร แล้วระบบจะกระทบกับ PV ในระบบให้</div>
          {!readOnly && <button className="btn btn-primary" onClick={() => fileRef.current && fileRef.current.click()}>📥 นำเข้า statement</button>}
          {pvForAcct.length > 0 && <div style={{ fontSize: 12, marginTop: 14, color: 'var(--ink-600)' }}>เดือนนี้มี PV ในระบบ <b>{pvForAcct.length}</b> รายการ (รวม {fmtNum(recon.stats.unmatchedPvAmt, 0)} ฿) รอกระทบ</div>}
        </div>
      ) : (
        <BRReconcileSection recon={recon} acct={acct} readOnly={readOnly}
          onRecord={setRecordLine} onUndo={undoRecord} onMatch={setMatchLine}
          onMarkTransfer={markTransfer} isLikelyTransfer={isLikelyTransfer} />
      )}

      {/* รายการเดินบัญชี (statement) — ยกมา → เคลื่อนไหว → คงเหลือ */}
      {monthly.count > 0 && <BRStatementTable monthly={monthly} />}

      {/* Mapping modal */}
      {preview && (
        <BRMappingModal preview={preview} onApply={applyImport} onClose={() => setPreview(null)}
          onChangeSheet={(idx) => {
            const name = preview.sheetNames[idx]; const aoa = preview.sheets[name] || [];
            const headerRow = brGuessHeaderRow(aoa);
            setPreview({ ...preview, sheetIdx: idx, aoa, headerRow, mapping: { ...preview.mapping, headerRow } });
          }} />
      )}

      {/* Record-actual modal */}
      {recordLine && (
        <BRRecordModal line={recordLine} onSave={recordActual} onClose={() => setRecordLine(null)} />
      )}

      {/* Manual-match modal — เลือก PV ในระบบมาผูกกับบรรทัด statement เอง */}
      {matchLine && (
        <BRMatchModal line={matchLine} candidates={recon.unmatchedPv || []} allPvs={pvRefPool}
          onMatch={manualMatchPv} onClose={() => setMatchLine(null)} />
      )}

      {/* Password modal — ไฟล์มีรหัส (เช่น KTB .xls) ใส่รหัสเปิดแล้วดึงข้อมูลในแอปได้เลย */}
      {pwdPrompt && (
        <BRPasswordModal prompt={pwdPrompt} onSubmit={(pwd) => parseAndPreview(pwdPrompt.file, pwd)} onClose={() => setPwdPrompt(null)} />
      )}

      {/* footer note */}
      <div className="card no-print" style={{ marginTop: 16, padding: '10px 14px', background: '#fffbeb', borderLeft: '4px solid #f6ad55', fontSize: 11.5, color: 'var(--ink-700)', lineHeight: 1.7 }}>
        💡 จับคู่ด้วย <b>ยอด</b> (±0.01) + <b>วันที่</b> (±3 วัน) + เลขเช็ค · รองรับ 1 รายการธนาคาร = หลาย PV ·
        รายการ "เกิดจริงแต่ยังไม่ลงระบบ" กด <b>บันทึกจ่ายจริง</b> → เพิ่มเป็น Actual หน้า <a href="#cashflow" style={{ color: 'var(--brand-600)' }}>Cashflow</a> ·
        statement เก็บในเครื่อง (localStorage) ไม่ขึ้น cloud
      </div>
    </div>
  );
}

// ─── ส่วนกระทบยอด 3 ถัง ───────────────────────────────────────────────────────
function BRReconcileSection({ recon, acct, readOnly, onRecord, onUndo, onMatch, onMarkTransfer, isLikelyTransfer }) {
  const [tab, setTab] = brState('missing');
  const { matched, missing, unmatchedPv, recorded, transfers, stats } = recon;
  const tabs = [
    { key: 'missing',  label: 'ขาดบันทึก',         n: missing.length,    color: 'var(--bad)' },
    { key: 'unmatch',  label: 'ยังไม่ออกจริง',      n: unmatchedPv.length, color: 'var(--warn)' },
    { key: 'matched',  label: 'แมตช์แล้ว',          n: matched.length,    color: 'var(--good)' },
    { key: 'transfer', label: 'โอนระหว่างบัญชี',     n: (transfers || []).length, color: 'oklch(60% 0.13 250)' },
    { key: 'recorded', label: 'บันทึกจาก statement', n: recorded.length,   color: 'var(--brand-600)' },
  ];
  return (
    <div className="card anim-in" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
      {/* summary chips / tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex: '1 1 0', minWidth: 130, border: 'none', background: tab === t.key ? 'var(--surface)' : 'var(--ink-50)',
              borderBottom: tab === t.key ? '2px solid ' + t.color : '2px solid transparent', cursor: 'pointer', padding: '12px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: t.color, fontVariantNumeric: 'tabular-nums' }}>{t.n}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-600)', fontWeight: 600 }}>{t.label}</div>
          </button>
        ))}
      </div>
      <div style={{ padding: 14 }}>
        {tab === 'missing'  && <BRMissingTable rows={missing} readOnly={readOnly} onRecord={onRecord} onMatch={onMatch} onMarkTransfer={onMarkTransfer} isLikelyTransfer={isLikelyTransfer} />}
        {tab === 'unmatch'  && <BRPvTable rows={unmatchedPv} />}
        {tab === 'matched'  && <BRMatchedTable rows={matched} readOnly={readOnly} onUndo={onUndo} />}
        {tab === 'transfer' && <BRTransfersTable rows={transfers || []} readOnly={readOnly} onUndo={onUndo} />}
        {tab === 'recorded' && <BRRecordedTable rows={recorded} readOnly={readOnly} onUndo={onUndo} onMatch={onMatch} />}
      </div>
    </div>
  );
}

function BREmpty({ text }) { return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-400)', fontSize: 12.5 }}>{text}</div>; }

// ถัง (b) — statement ออก แต่ไม่มี PV → กดบันทึกจ่ายจริง
function BRMissingTable({ rows, readOnly, onRecord, onMatch, onMarkTransfer, isLikelyTransfer }) {
  if (!rows.length) return <BREmpty text="✓ ไม่มีรายการที่ขาดการบันทึก — statement ทุกรายการมี PV รองรับ" />;
  return (
    <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
      <div style={{ fontSize: 12, color: 'var(--ink-600)', marginBottom: 8 }}>เงินออกจากบัญชีจริง แต่ยังไม่มี PV รองรับใน statement — กด <b>🔗 จับคู่ PV</b> (ถ้ามี PV ในระบบแต่เลขไม่ตรง เช่นแก้เอกสาร) · <b>บันทึกจ่ายจริง</b> (ยังไม่มี PV เลย) · <b>🔁 โอนระหว่างบัญชี</b> (โอนเข้าบัญชีตัวเอง)</div>
      <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <tr><th style={{ width: 100 }}>วันที่</th><th>รายละเอียด</th><th style={{ width: 110 }}>อ้างอิง/เช็ค</th><th style={{ width: 120, textAlign: 'right' }}>จำนวน (฿)</th><th style={{ width: 280, textAlign: 'center' }}>จัดการ</th></tr>
        </thead>
        <tbody>
          {rows.map(l => {
            const hint = isLikelyTransfer && isLikelyTransfer(l);
            return (
            <tr key={l.id} style={hint ? { background: 'color-mix(in oklch, oklch(60% 0.13 250) 6%, transparent)' } : undefined}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(l.date) || l.date}</td>
              <td>{l.desc || '—'}{hint && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: 'oklch(50% 0.13 250)', background: 'color-mix(in oklch, oklch(60% 0.13 250) 16%, #fff)', borderRadius: 10, padding: '1px 7px', whiteSpace: 'nowrap' }}>🔁 น่าจะเป็นโอนระหว่างบัญชี</span>}</td>
              <td style={{ fontFamily: 'ui-monospace', fontSize: 11.5, color: 'var(--brand-700)' }}>{l.ref || '—'}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--bad)' }}>{fmtNum(Math.abs(l.amount), 2)}</td>
              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                {!readOnly ? (<span style={{ display: 'inline-flex', gap: 5, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {onMatch && <button title="ผูกกับ PV ในระบบเอง (เคสเลขเอกสารเปลี่ยน) — ไม่สร้าง Actual ซ้ำ"
                    style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                      border: '1px solid var(--good)', background: '#fff', color: 'var(--good)', fontWeight: 700 }}
                    onClick={() => onMatch(l)}>🔗 จับคู่ PV</button>}
                  <button className="btn btn-primary" style={{ fontSize: 11.5, padding: '4px 9px' }} onClick={() => onRecord(l)}>บันทึกจ่ายจริง</button>
                  {onMarkTransfer && <button title="เป็นการโอนเงินไปบัญชีตัวเอง — ไม่นับเป็นรายจ่าย"
                    style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                      border: '1px solid oklch(60% 0.13 250)', background: hint ? 'oklch(60% 0.13 250)' : '#fff', color: hint ? '#fff' : 'oklch(50% 0.13 250)', fontWeight: 600 }}
                    onClick={() => onMarkTransfer(l)}>🔁 โอนระหว่างบัญชี</button>}
                </span>) : <span style={{ color: 'var(--ink-300)' }}>—</span>}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ถัง — โอนระหว่างบัญชี (ทำเครื่องหมายแล้ว ไม่นับเป็นรายจ่าย) · กดยกเลิกกลับเป็นขาดบันทึกได้
function BRTransfersTable({ rows, readOnly, onUndo }) {
  if (!rows.length) return <BREmpty text="ยังไม่มีรายการที่ทำเครื่องหมายเป็นโอนระหว่างบัญชี" />;
  return (
    <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
      <div style={{ fontSize: 12, color: 'var(--ink-600)', marginBottom: 8 }}>รายการโอนเงินระหว่างบัญชีตัวเอง — ไม่นับเป็นรายจ่าย ไม่เข้า Actual</div>
      <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <tr><th style={{ width: 100 }}>วันที่</th><th>รายละเอียด</th><th style={{ width: 110 }}>อ้างอิง/เช็ค</th><th style={{ width: 130, textAlign: 'right' }}>จำนวน (฿)</th><th style={{ width: 110, textAlign: 'center' }}>จัดการ</th></tr>
        </thead>
        <tbody>
          {rows.map(l => (
            <tr key={l.id}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(l.date) || l.date}</td>
              <td>{l.desc || '—'}</td>
              <td style={{ fontFamily: 'ui-monospace', fontSize: 11.5, color: 'var(--brand-700)' }}>{l.ref || '—'}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--ink-500)' }}>{fmtNum(Math.abs(l.amount), 2)}</td>
              <td style={{ textAlign: 'center' }}>
                {!readOnly
                  ? <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }} onClick={() => onUndo(l, '')}>↩ ยกเลิก</button>
                  : <span style={{ color: 'var(--ink-300)' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ถัง (c) — PV ในระบบ แต่ยังไม่เจอใน statement
function BRPvTable({ rows }) {
  if (!rows.length) return <BREmpty text="✓ PV ทุกใบเจอใน statement แล้ว" />;
  return (
    <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
      <div style={{ fontSize: 12, color: 'var(--ink-600)', marginBottom: 8 }}>มี PV ในระบบ แต่ยังไม่เจอรายการตรงกันใน statement (เช็คยังไม่ขึ้นเงิน / ยังไม่ถึงรอบ / เลขไม่ตรง)</div>
      <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <tr><th style={{ width: 100 }}>วันที่จ่าย</th><th style={{ width: 120 }}>เลขที่ PV</th><th>ผู้รับเงิน</th><th style={{ width: 100 }}>เช็ค</th><th style={{ width: 130, textAlign: 'right' }}>จำนวน (฿)</th></tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id || (p.pvNo + p.date)}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(p.date) || p.date}</td>
              <td style={{ fontFamily: 'ui-monospace', fontSize: 11.5 }}>{p.pvNo || '—'}</td>
              <td>{p.payee || '—'}</td>
              <td style={{ fontFamily: 'ui-monospace', fontSize: 11 }}>{p.chqNo || '—'}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--warn)' }}>{fmtNum(Math.abs(p.amount), 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ถัง (a) — แมตช์แล้ว
function BRMatchedTable({ rows, readOnly, onUndo }) {
  if (!rows.length) return <BREmpty text="ยังไม่มีรายการที่แมตช์" />;
  const hasManual = rows.some(m => m.manual);
  return (
    <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
      <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <tr><th style={{ width: 100 }}>วันที่</th><th>รายการ statement</th><th style={{ width: 150 }}>PV</th><th style={{ width: 64, textAlign: 'center' }}>วิธี</th><th style={{ width: 130, textAlign: 'right' }}>จำนวน (฿)</th>{hasManual && <th style={{ width: 90, textAlign: 'center' }}>จัดการ</th>}</tr>
        </thead>
        <tbody>
          {rows.map((m, i) => {
            const pvList = m.pvs || [m.pv];
            const pvNos = [...new Set(pvList.map(p => p.pvNo || p.apNo || '—'))];
            const viaLabel = m.via === 'manual' ? 'จับคู่เอง' : m.via === 'ref' ? 'PV' : m.via === 'split' ? 'รวม' : '1:1';
            const viaWarn = m.via === 'split';
            const viaManual = m.via === 'manual';
            return (
              <tr key={m.line.id || ('g' + i)} style={viaManual ? { background: 'color-mix(in oklch, var(--good) 5%, transparent)' } : undefined}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(m.line.date) || m.line.date}</td>
                <td>{m.line.desc || '—'} {m.line.ref && <span style={{ fontFamily: 'ui-monospace', fontSize: 11, color: 'var(--ink-400)' }}>· {m.line.ref}</span>}
                  {m.amtMismatch ? <span style={{ color: 'var(--warn)', fontSize: 11 }}> · ⚠️ ยอดต่าง {fmtNum(Math.abs(m.amtMismatch), 2)}</span> : null}</td>
                <td style={{ fontFamily: 'ui-monospace', fontSize: 11 }}>{pvNos.join(', ')}</td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: viaManual ? 'oklch(50% 0.13 250)' : viaWarn ? 'var(--warn)' : 'var(--good)', background: viaManual ? 'color-mix(in oklch, oklch(60% 0.13 250) 14%, #fff)' : viaWarn ? 'var(--warn-bg)' : 'var(--good-bg)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{viaLabel}</span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--good)' }}>{fmtNum(Math.abs(m.line.amount), 2)}</td>
                {hasManual && <td style={{ textAlign: 'center' }}>
                  {viaManual && !readOnly ? <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--bad)' }} onClick={() => onUndo(m.line, '')}>↩ ยกเลิก</button> : <span style={{ color: 'var(--ink-300)' }}>—</span>}
                </td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ถังที่บันทึกจาก statement แล้ว (เด้งเข้า cashflow แล้ว)
function BRRecordedTable({ rows, readOnly, onUndo, onMatch }) {
  if (!rows.length) return <BREmpty text="ยังไม่มีรายการที่บันทึกจ่ายจริงจาก statement" />;
  return (
    <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
      <div style={{ fontSize: 12, color: 'var(--ink-600)', marginBottom: 8 }}>บันทึกเป็น "จ่ายจริง" จาก statement แล้ว (เป็น Actual หน้า Cashflow) — ถ้าจริงๆ มี <b>PV ในระบบ</b> รองรับอยู่แล้ว (เลขเอกสารเปลี่ยนเลย auto-match ไม่เจอ) ให้กด <b>🔗 จับคู่ PV แทน</b> เพื่อกันยอดนับซ้ำ</div>
      <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <tr><th style={{ width: 100 }}>วันที่</th><th>รายละเอียด</th><th style={{ width: 130, textAlign: 'right' }}>จำนวน (฿)</th><th style={{ width: 210, textAlign: 'center' }}>จัดการ</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.line.id}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(r.line.date) || r.line.date}</td>
              <td>{r.line.desc || '—'} <span style={{ fontSize: 11, color: 'var(--good)' }}>✓ เป็น Actual แล้ว</span></td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--ink-700)' }}>{fmtNum(Math.abs(r.line.amount), 2)}</td>
              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                {!readOnly ? (<span style={{ display: 'inline-flex', gap: 5, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {onMatch && <button title="จริงๆ มี PV รองรับ — ผูกกับ PV แทน (เลิกนับเป็น Actual ซ้ำ)"
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--good)', background: '#fff', color: 'var(--good)', fontWeight: 700 }}
                    onClick={() => onMatch(r.line)}>🔗 จับคู่ PV แทน</button>}
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--bad)' }} onClick={() => onUndo(r.line, r.forecastId)}>↩ ยกเลิก</button>
                </span>) : <span style={{ color: 'var(--ink-300)' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ตารางรายการเดินบัญชี (statement) ──────────────────────────────────────────
function BRStatementTable({ monthly }) {
  return (
    <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 13, color: 'var(--ink-800)', display: 'flex', justifyContent: 'space-between' }}>
        <span>รายการเดินบัญชี (statement) · {monthly.count} รายการ</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-500)' }}>ยกมา {fmtNum(monthly.opening || 0, 0)} → คงเหลือ {fmtNum(monthly.closing || 0, 0)}</span>
      </div>
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <table className="tbl" style={{ width: '100%', fontSize: 12.5 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
            <tr><th style={{ width: 100 }}>วันที่</th><th>รายละเอียด</th><th style={{ width: 110 }}>อ้างอิง</th><th style={{ width: 120, textAlign: 'right' }}>จ่ายออก</th><th style={{ width: 120, textAlign: 'right' }}>รับเข้า</th><th style={{ width: 130, textAlign: 'right' }}>คงเหลือ</th></tr>
          </thead>
          <tbody>
            {monthly.sorted.map(l => (
              <tr key={l.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-600)' }}>{fmtDate(l.date) || l.date}</td>
                <td>{l.desc || '—'}</td>
                <td style={{ fontFamily: 'ui-monospace', fontSize: 11, color: 'var(--ink-500)' }}>{l.ref || ''}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--bad)' }}>{l.amount < 0 ? fmtNum(-l.amount, 2) : ''}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--good)' }}>{l.amount > 0 ? fmtNum(l.amount, 2) : ''}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-700)', fontWeight: 600 }}>{fmtNum(l.running, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Mapping modal — preview + เลือกคอลัมน์ ────────────────────────────────────
function BRMappingModal({ preview, onApply, onClose, onChangeSheet }) {
  const [m, setM] = brState(preview.mapping);
  brEffect(() => { setM(preview.mapping); }, [preview.headerRow, preview.sheetIdx]);
  const headers = (preview.aoa[m.headerRow] || []);
  const colOpts = headers.map((h, i) => ({ i, label: `${i + 1}. ${String(h || '').slice(0, 28) || '(ว่าง)'}` }));
  const sample = preview.aoa.slice(m.headerRow + 1, m.headerRow + 9);
  const up = (patch) => setM({ ...m, ...patch });
  const sel = (val, onCh, allowNone) => (
    <select className="select input" value={val == null ? '' : val} onChange={e => onCh(e.target.value === '' ? null : Number(e.target.value))}
      style={{ fontSize: 12, padding: '4px 8px', minWidth: 150 }}>
      {allowNone && <option value="">— ไม่มี —</option>}
      {colOpts.map(c => <option key={c.i} value={c.i}>{c.label}</option>)}
    </select>
  );
  const previewLines = brNormalizeLines(preview.aoa, m, preview.accountNo || '_preview');
  return (
    <Modal open title={'ตั้งค่าคอลัมน์ statement · ' + preview.fileName} maxWidth={920} onClose={onClose}
      footer={<>
        <span style={{ marginRight: 'auto', fontSize: 12, color: previewLines.length ? 'var(--good)' : 'var(--bad)' }}>
          {previewLines.length ? `อ่านได้ ${previewLines.length} รายการ` : 'ยังอ่านไม่ได้ — ปรับคอลัมน์/แถว header'}
        </span>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={!previewLines.length} onClick={() => onApply(m)}>นำเข้า {previewLines.length || ''}</button>
      </>}>
      {preview.sheetNames.length > 1 && (
        <div style={{ marginBottom: 10, fontSize: 12.5 }}>ชีต:{' '}
          <select className="select input" value={preview.sheetIdx} onChange={e => onChangeSheet(Number(e.target.value))} style={{ fontSize: 12, padding: '4px 8px' }}>
            {preview.sheetNames.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 16px', marginBottom: 14, alignItems: 'center', fontSize: 12.5 }}>
        <label>แถว header (1=แรกสุด): <input type="number" min={1} value={m.headerRow + 1} onChange={e => up({ headerRow: Math.max(0, Number(e.target.value) - 1) })} style={{ width: 60, padding: '3px 6px', marginLeft: 6 }} /></label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>คอลัมน์วันที่: {sel(m.dateCol, v => up({ dateCol: v }))}</label>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
          <label><input type="radio" checked={m.mode === 'split'} onChange={() => up({ mode: 'split' })} /> เดบิต/เครดิต แยกคอลัมน์</label>
          <label><input type="radio" checked={m.mode === 'single'} onChange={() => up({ mode: 'single' })} /> ยอดคอลัมน์เดียว</label>
        </div>
        {m.mode === 'split' ? (
          <>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>เดบิต (จ่ายออก): {sel(m.debitCol, v => up({ debitCol: v }), true)}</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>เครดิต (รับเข้า): {sel(m.creditCol, v => up({ creditCol: v }), true)}</label>
          </>
        ) : (
          <>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>คอลัมน์ยอด: {sel(m.amountCol, v => up({ amountCol: v }))}</label>
            <label><input type="checkbox" checked={!!m.outflowPositive} onChange={e => up({ outflowPositive: e.target.checked })} /> ยอดจ่ายออกเป็นเลขบวก</label>
          </>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>รายละเอียด: {sel(m.descCol, v => up({ descCol: v }), true)}</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>เลขที่/เช็ค: {sel(m.refCol, v => up({ refCol: v }), true)}</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>ยอดคงเหลือ: {sel(m.balanceCol, v => up({ balanceCol: v }), true)}</label>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 6 }}>ตัวอย่างข้อมูล (8 แถวแรกหลัง header):</div>
      <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
        <table className="tbl" style={{ width: '100%', fontSize: 11 }}>
          <thead><tr>{headers.map((h, i) => <th key={i} style={{ whiteSpace: 'nowrap' }}>{i + 1}. {String(h || '').slice(0, 18)}</th>)}</tr></thead>
          <tbody>
            {sample.map((r, ri) => <tr key={ri}>{headers.map((_, ci) => <td key={ci} style={{ whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r[ci] instanceof Date ? bdISO(r[ci]) : String(r[ci] == null ? '' : r[ci]).slice(0, 22)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ─── Record-actual modal ──────────────────────────────────────────────────────
function BRRecordModal({ line, onSave, onClose }) {
  const [cat, setCat] = brState('1');
  return (
    <Modal open title="บันทึกเป็นจ่ายจริง" maxWidth={460} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={() => onSave(line, cat)}>บันทึก → ส่งเข้า Cashflow</button>
      </>}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-600)', marginBottom: 12 }}>
        รายการนี้จะถูกบันทึกเป็น "จ่ายจริง" (forecastEntries STATUS=ACTUAL) และไปแสดงในช่อง Actual หน้า Cashflow ตามสัปดาห์/หมวดที่เลือก
      </div>
      <table className="tbl" style={{ width: '100%', fontSize: 13, marginBottom: 12 }}>
        <tbody>
          <tr><td style={{ color: 'var(--ink-500)', width: 110 }}>วันที่</td><td style={{ fontWeight: 600 }}>{fmtDate(line.date) || line.date}</td></tr>
          <tr><td style={{ color: 'var(--ink-500)' }}>รายละเอียด</td><td style={{ fontWeight: 600 }}>{line.desc || '—'}</td></tr>
          <tr><td style={{ color: 'var(--ink-500)' }}>อ้างอิง/เช็ค</td><td>{line.ref || '—'}</td></tr>
          <tr><td style={{ color: 'var(--ink-500)' }}>จำนวน</td><td style={{ fontWeight: 700, color: 'var(--bad)' }}>{fmtNum(Math.abs(line.amount), 2)} ฿</td></tr>
        </tbody>
      </table>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>หมวดค่าใช้จ่าย</label>
      <select className="select input" value={cat} onChange={e => setCat(e.target.value)} style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}>
        {BD_CF_CATEGORIES.map(c => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
      </select>
    </Modal>
  );
}

// ── Modal จับคู่ PV เอง — เลือก PV ในระบบมาผูกกับบรรทัด statement (เคสเลขเอกสารเปลี่ยน) ──
function BRMatchModal({ line, candidates, allPvs, onMatch, onClose }) {
  const target = Math.abs(Number(line.amount) || 0);
  const keyOf = p => (p.id != null && p.id !== '' ? 'i' + p.id : 'p' + (p.pvNo || ''));
  const closeness = (p) => {
    const ad = Math.abs((Math.abs(Number(p.amount) || 0)) - target);
    const dd = p.date ? brDateDiff(line.date, p.date) : 999;
    return ad * 1000 + dd;   // ยอดต่างมาก่อน แล้วค่อยวันที่
  };
  const sortedCand = brMemo(() => (candidates || []).slice().sort((a, b) => closeness(a) - closeness(b)), [candidates, line.id]);
  const [q, setQ] = brState('');
  const qn = q.trim().toLowerCase();
  const searchHits = brMemo(() => {
    if (!qn) return [];
    const qDigits = qn.replace(/[,\s]/g, '');
    return (allPvs || []).filter(p =>
      String(p.pvNo || '').toLowerCase().indexOf(qn) >= 0 ||
      String(p.payee || '').toLowerCase().indexOf(qn) >= 0 ||
      (qDigits && String(Math.abs(Number(p.amount) || 0)).indexOf(qDigits) >= 0)
    ).sort((a, b) => closeness(a) - closeness(b)).slice(0, 60);
  }, [qn, allPvs, line.id]);
  const list = qn ? searchHits : sortedCand;
  const best = sortedCand[0] && Math.abs(Math.abs(Number(sortedCand[0].amount) || 0) - target) < 0.01 ? sortedCand[0] : null;
  const [sel, setSel] = brState(best || null);
  return (
    <Modal open title="🔗 จับคู่ PV เอง" maxWidth={620} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={!sel} onClick={() => sel && onMatch(line, sel)}>จับคู่กับ PV นี้</button>
      </>}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-600)', marginBottom: 10 }}>
        ผูกบรรทัดนี้กับ PV ในระบบที่เป็นการจ่ายก้อนเดียวกัน (เคสแก้เอกสาร เลขที่ PV เปลี่ยน เลย auto-match ไม่เจอ) — <b>ไม่สร้างรายการ Actual ใหม่</b> เพราะ PV เป็น Actual อยู่แล้ว ป้องกันยอดนับซ้ำ
      </div>
      {/* บรรทัด statement ที่จะจับคู่ */}
      <div style={{ background: 'var(--ink-50)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ color: 'var(--ink-600)' }}>{fmtDate(line.date) || line.date} · {line.desc || '—'}{line.ref ? ' · ' + line.ref : ''}</span>
          <b style={{ color: 'var(--bad)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(target, 2)} ฿</b>
        </div>
      </div>
      <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นทุก PV ในระบบ (เลขที่ PV / ผู้รับเงิน / ยอด)…"
        style={{ width: '100%', fontSize: 13, padding: '7px 10px', marginBottom: 8 }} />
      <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 6 }}>
        {qn ? `ผลค้นหา ${list.length} รายการ` : `PV ที่ยังไม่จับคู่ในบัญชี/เดือนนี้ ${list.length} รายการ (เรียงตามความใกล้เคียงยอด+วันที่)`}
      </div>
      <div style={{ maxHeight: '40vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
        {list.length === 0 ? (
          <div style={{ padding: 18, textAlign: 'center', color: 'var(--ink-400)', fontSize: 12.5 }}>
            {qn ? 'ไม่พบ PV ที่ตรงกับคำค้น' : 'ไม่มี PV ค้างในบัญชี/เดือนนี้ — พิมพ์ค้นหาด้านบนเพื่อหา PV จากทุกบัญชี/เดือน'}
          </div>
        ) : list.map(p => {
          const k = keyOf(p);
          const active = sel && keyOf(sel) === k;
          const amt = Math.abs(Number(p.amount) || 0);
          const exact = Math.abs(amt - target) < 0.01;
          const dd = p.date ? brDateDiff(line.date, p.date) : null;
          return (
            <button key={k} type="button" onClick={() => setSel(p)}
              style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                border: 'none', borderBottom: '1px solid var(--line)', padding: '8px 12px',
                background: active ? 'color-mix(in oklch, var(--good) 12%, #fff)' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5 }}>
                  <b style={{ fontFamily: 'ui-monospace' }}>{p.pvNo || '—'}</b>
                  <span style={{ color: 'var(--ink-600)' }}> · {p.payee || '—'}</span>
                  {p.chqNo ? <span style={{ color: 'var(--ink-400)', fontFamily: 'ui-monospace', fontSize: 11 }}> · เช็ค {p.chqNo}</span> : null}
                </span>
                <b style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: exact ? 'var(--good)' : 'var(--ink-700)' }}>{fmtNum(amt, 2)} ฿</b>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>
                {fmtDate(p.date) || p.date || '—'}
                {exact ? <span style={{ color: 'var(--good)', fontWeight: 700 }}> · ✓ ยอดตรง</span> : <span style={{ color: 'var(--warn)' }}> · ⚠️ ยอดต่าง {fmtNum(Math.abs(amt - target), 2)}</span>}
                {dd != null && dd <= 3 ? <span style={{ color: 'var(--good)' }}> · วันใกล้กัน</span> : (dd != null ? <span style={{ color: 'var(--ink-400)' }}> · ต่าง {dd} วัน</span> : null)}
                {active ? <span style={{ color: 'var(--good)', fontWeight: 700 }}> · เลือกแล้ว</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

// ── Modal ใส่รหัสไฟล์ statement ที่เข้ารหัส (เช่น KTB .xls) ──
function BRPasswordModal({ prompt, onSubmit, onClose }) {
  const [pwd, setPwd] = brState('');
  const [show, setShow] = brState(false);
  const submit = () => { if (pwd) onSubmit(pwd); };
  return (
    <Modal open title="🔒 ไฟล์มีรหัสผ่าน" maxWidth={440} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={!pwd} onClick={submit}>เปิดไฟล์ + ดึงข้อมูล</button>
      </>}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-600)', marginBottom: 12 }}>
        ไฟล์ <b style={{ color: 'var(--ink-800)' }}>{prompt.file && prompt.file.name}</b> ถูกตั้งรหัสผ่าน — ใส่รหัสเพื่อเปิดและนำเข้าข้อมูลได้เลย
      </div>
      <div style={{ position: 'relative' }}>
        <input className="input" type={show ? 'text' : 'password'} autoFocus value={pwd}
          onChange={e => setPwd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="รหัสผ่านไฟล์" style={{ width: '100%', paddingRight: 64, fontSize: 13 }} />
        <button type="button" onClick={() => setShow(s => !s)}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 0, color: 'var(--ink-500)', cursor: 'pointer', fontSize: 11 }}>
          {show ? 'ซ่อน' : 'แสดง'}
        </button>
      </div>
      {prompt.error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--bad)', fontWeight: 600 }}>⚠️ {prompt.error}</div>}
      {prompt.unsupported && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-600)', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', lineHeight: 1.6 }}>
          ทางเลือกที่ชัวร์: เปิดไฟล์ใน Excel ด้วยรหัส → <b>Save As</b> เป็น <b>.xlsx</b> หรือ <b>.csv</b> (ไม่ใส่รหัส) → นำเข้าไฟล์นั้นแทน
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-400)' }}>🔐 รหัสใช้ถอดไฟล์ในเครื่องนี้เท่านั้น — ไม่ถูกบันทึก/ส่งขึ้น cloud</div>
    </Modal>
  );
}

Object.assign(window, { BankReconPage });
