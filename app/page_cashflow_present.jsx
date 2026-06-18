/* =====================================================================
 * Cash Flow Presentation (#cashflow_present) — BIOAXEL
 * ---------------------------------------------------------------------
 *  Executive Cash Flow Dashboard (tabbed) — สไตล์อิงตัวอย่าง "Executive
 *  Cash Flow Dashboard" ที่ผู้ใช้ชอบ. 3 แท็บ:
 *    1) ภาพรวม (Executive Summary)  — KPI + waterfall + รายเดือน + insights
 *    2) งบกระแสเงินสด               — ตารางงบจากไฟล์สรุป (กดแถว → รายการ STM)
 *    3) รายการ (Transaction Explorer) — ตารางรายการ STM + ค้นหา/กรอง/sort
 *  อัปโหลด 2 ไฟล์: STM (รายการเดินบัญชี) + งบกระแสเงินสดรายเดือน (สรุป)
 *  Self-contained: พึ่ง window.React + window.XLSX. prefix `cfp`/`Cfp`.
 *  เก็บ localStorage `wtp-cfpresent-v1` (ต่อเครื่อง) — ยังไม่ sync ทีม.
 * ===================================================================== */
(function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const CFP_LS = 'wtp-cfpresent-v1';
  const CFP_MONTHS = { 1: 'ม.ค.', 2: 'ก.พ.', 3: 'มี.ค.', 4: 'เม.ย.', 5: 'พ.ค.', 6: 'มิ.ย.', 7: 'ก.ค.', 8: 'ส.ค.', 9: 'ก.ย.', 10: 'ต.ค.', 11: 'พ.ย.', 12: 'ธ.ค.' };

  // palette (อิงตัวอย่าง Executive Cash Flow Dashboard)
  const C = {
    primary: '#4F8AF7', primaryD: '#3a6fe0', teal: '#36c5d8', purple: '#9b7bff',
    ink: '#243b63', mut: '#6f8bb3', faint: '#9fb3d4', line: '#e0ecfc',
    pos: '#15c486', posBg: '#e2faf0', neg: '#fb5e6d', negBg: '#ffe9ec',
    card: 'rgba(255,255,255,.82)', cardSolid: '#ffffff', soft: '#eef5ff',
    shadow: '0 10px 30px rgba(79,138,247,.16)',
  };
  const ACT_COLOR = { op: '#4F8AF7', inv: '#e08a3c', fin: '#9b7bff', transfer: '#6f8bb3', other: '#6f8bb3' };
  const ACT_TAGBG = { op: '#e8f0ff', inv: '#fff0e6', fin: '#efe8ff', transfer: '#eef2f8', other: '#eef2f8' };
  const ACT_TAGFG = { op: '#3f6fd0', inv: '#d98032', fin: '#7a5fd0', transfer: '#6f8bb3', other: '#6f8bb3' };

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
  function cfpToISO(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && isFinite(v) && v > 1000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    let s = String(v).trim();
    if (typeof window.parseDateFlexible === 'function') {
      try { const iso = window.parseDateFlexible(s); if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10); } catch (e) {}
    }
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
      let d = +m[1], mo = +m[2], y = +m[3];
      if (y < 100) y += 2000; if (y > 2400) y -= 543;
      if (d > 31 && y <= 31) { const t = d; d = y; y = t; }
      if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
      return String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
    return '';
  }
  const cfpMonth = iso => (iso && iso.length >= 7) ? +iso.slice(5, 7) : 0;
  function cfpFmtB(v) { const n = Math.round(Math.abs(v || 0)); return (v < 0 ? '-' : '') + '฿' + n.toLocaleString('en-US'); }
  function cfpFmtM(v) { return (v < 0 ? '-' : '') + '฿' + (Math.abs(v || 0) / 1e6).toFixed(2) + 'M'; }
  function cfpFmtSigned(v) { return (v < 0 ? '-' : '+') + '฿' + (Math.abs(v || 0) / 1e6).toFixed(2) + 'M'; }
  function cfpFmtPlain(v) { return Math.round(Math.abs(v || 0)).toLocaleString('en-US'); }
  function cfpThaiDate(iso) {
    if (!iso || iso.length < 10) return iso || '';
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    return d + ' ' + (CFP_MONTHS[m] || m) + ' ' + (y + 543 - 2500);
  }

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

  function cfpShort(s) {
    s = String(s || '').replace(/^เงินสดรับจากการขาย\s*-?\s*/, '').replace(/^เงินสดจ่ายเกี่ยวกับ\s*-?\s*/, '').replace(/^เงินสดรับ\s*-?\s*/, '').trim();
    return s.length > 28 ? s.slice(0, 28) + '…' : s;
  }
  // วิเคราะห์ "จุดเฝ้าระวัง" รายกิจกรรม (sev: red ด่วน / amber เฝ้าระวัง / blue ข้อมูล / green ปกติ)
  function cfpWatch(model, k) {
    const a = model.acts[k]; if (!a) return [];
    const cats = a.catList || [];
    const out = cats.filter(c => c.net < 0), inn = cats.filter(c => c.net > 0);
    const outTot = out.reduce((s, c) => s + Math.abs(c.net), 0), inTot = inn.reduce((s, c) => s + c.net, 0);
    const F = [], order = { red: 0, amber: 1, blue: 2, green: 3 };
    if (k === 'op') {
      if (a.net < 0) F.push({ sev: 'red', t: 'กระแสเงินสดดำเนินงานติดลบ ' + cfpFmtM(a.net) + ' — รายจ่ายมากกว่ารายรับจากการดำเนินงาน' });
      if (out.length) { const t = out[0], p = Math.round(Math.abs(t.net) / (outTot || 1) * 100); if (p >= 30) F.push({ sev: p >= 50 ? 'amber' : 'blue', t: 'รายจ่ายกระจุกที่ “' + cfpShort(t.name) + '” ' + p + '% (' + cfpFmtM(t.net) + ')' }); }
      if (inn.length && inTot > 0) { const t = inn[0], p = Math.round(t.net / inTot * 100); if (p >= 70) F.push({ sev: 'amber', t: 'รายได้พึ่ง “' + cfpShort(t.name) + '” ' + p + '% ของรายรับดำเนินงาน — กระจุกตัวสูง' }); }
    } else if (k === 'inv') {
      if (a.net < 0) F.push({ sev: 'blue', t: 'ลงทุนซื้อสินทรัพย์สุทธิ ' + cfpFmtM(a.net) });
      if (a.net > 0) F.push({ sev: 'amber', t: 'มีเงินสดจากการขาย/ลดสินทรัพย์ ' + cfpFmtM(a.net) });
      if (out.length) { const t = out[0]; F.push({ sev: 'blue', t: 'ส่วนใหญ่คือ “' + cfpShort(t.name) + '” (' + cfpFmtM(t.net) + ')' }); }
    } else if (k === 'fin') {
      const interest = cats.filter(c => /ดอกเบี้ย/.test(c.name)).reduce((s, c) => s + Math.abs(c.net), 0);
      const loansIn = inn.filter(c => /กู้/.test(c.name)).reduce((s, c) => s + c.net, 0);
      const director = cats.filter(c => /กรรมการ|ให้กู้ยืม/.test(c.name)).reduce((s, c) => s + Math.abs(c.net), 0);
      const repay = cats.filter(c => /ชำระคืน|คืนเงินกู้/.test(c.name)).reduce((s, c) => s + Math.abs(c.net), 0);
      if (interest > 0) F.push({ sev: (model.payroll && interest >= 0.5 * model.payroll) ? 'red' : 'amber', t: 'ดอกเบี้ยจ่าย ' + cfpFmtM(interest) + (model.payroll ? (' ≈ ' + Math.round(interest / model.payroll * 100) + '% ของเงินเดือนทั้งบริษัท') : '') });
      if (loansIn > 0 && model.acts.op.net < 0) F.push({ sev: 'red', t: 'พึ่งเงินกู้ประคองสภาพคล่อง — รับกู้ ' + cfpFmtM(loansIn) + ' ขณะดำเนินงานติดลบ' });
      else if (loansIn > 0) F.push({ sev: 'blue', t: 'รับเงินกู้เข้า ' + cfpFmtM(loansIn) + ' หนุนสภาพคล่อง' });
      if (director > 0) F.push({ sev: 'amber', t: 'เงินให้กรรมการกู้ยืม ' + cfpFmtM(director) });
      if (repay > 0) F.push({ sev: 'blue', t: 'ชำระคืนเงินกู้ ' + cfpFmtM(repay) });
    }
    if (!F.length) F.push({ sev: 'green', t: 'ไม่พบจุดเฝ้าระวังเด่นชัด' });
    F.sort((x, y) => order[x.sev] - order[y.sev]);
    return F.slice(0, 5);
  }
  const CFP_SEV = { red: { c: '#c0392b', bg: '#fdecea' }, amber: { c: '#8a6400', bg: '#fff7e0' }, blue: { c: '#1f6fb8', bg: '#eaf2ff' }, green: { c: '#15875a', bg: '#e6f7ef' } };

  function cfpAccountLabel(raw) {
    const s = String(raw || '');
    const m = s.match(/([SC])\/A#\s*([A-Za-z]*)\s*([\d-]+)\s*(.*)/);
    if (m) {
      const bank = (m[2] || '').toUpperCase();
      const name = (m[4] || '').trim();
      const tail = (m[3] || '').replace(/\D/g, '').slice(-4);
      return (bank || 'บัญชี') + (tail ? ' ···' + tail : '') + (name ? ' · ' + name : '');
    }
    return s.trim();
  }
  function cfpBankCode(acctLabel) { const m = String(acctLabel || '').match(/^([A-Za-z]{2,4})/); return m ? m[1].toUpperCase() : ''; }
  const BANK_PILL = { BBL: { bg: '#e0f0ff', fg: '#1f6fb8' }, SCB: { bg: '#efe6ff', fg: '#6a3fc0' }, KBANK: { bg: '#e8f7e9', fg: '#2e7d32' }, KTB: { bg: '#e0f2ff', fg: '#1565c0' }, KKP: { bg: '#fbeee0', fg: '#b8730b' }, BAY: { bg: '#fff0e6', fg: '#d98032' } };

  /* ---------- statement-line ↔ STM category matcher ---------- */
  function cfpStripCat(s) {
    return String(s || '')
      .replace(/^เงินสดรับจากการขาย\s*-?\s*/, '').replace(/^เงินสดรับ\s*-?\s*/, '')
      .replace(/^เงินสดจ่ายเกี่ยวกับ\s*-?\s*/, '').replace(/^รวม\s*/, '').replace(/^รายได้\s*/, '').replace(/^ค่า/, '')
      .replace(/[^0-9A-Za-zก-๙]/g, '');
  }
  function cfpLatin(s) { return (String(s || '').match(/[A-Za-z]{3,}/g) || []).map(x => x.toLowerCase()); }
  function cfpLCS(a, b) {
    if (!a || !b) return 0;
    const m = a.length, n = b.length; let best = 0, prev = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) { const cur = new Array(n + 1).fill(0);
      for (let j = 1; j <= n; j++) { if (a[i - 1] === b[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; } } prev = cur; }
    return best;
  }
  function cfpStmtMatch(catName, leafLabel) {
    const a = cfpStripCat(catName), b = cfpStripCat(leafLabel);
    if (!a || !b) return false;
    const mn = Math.min(a.length, b.length);
    if (mn >= 5 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) return true;
    const la = cfpLatin(catName), lb = cfpLatin(leafLabel);
    if (la.length && la.some(t => lb.indexOf(t) >= 0)) return true;
    const lcs = cfpLCS(a, b);
    if (lcs >= 8 && lcs >= 0.7 * mn) return true;
    return false;
  }
  function cfpFindStmtTxns(model, leafLabel, actKey, monthNum, dir) {
    const act = model.acts[actKey]; if (!act) return { txns: [], matched: false, cats: [] };
    const sameDir = c => !dir || ((c.net >= 0 ? 1 : -1) === dir);
    let cats = act.catList.filter(c => cfpStmtMatch(c.name, leafLabel) && sameDir(c));
    const matched = cats.length > 0;
    const src = matched ? cats : act.catList.filter(sameDir);
    let txns = []; src.forEach(c => { txns = txns.concat(c.txns); });
    if (monthNum) txns = txns.filter(t => t.month === monthNum);
    return { txns, matched, cats: cats.map(c => c.name) };
  }

  /* ---------- parse STM ---------- */
  function cfpParseStm(aoa) {
    const txns = []; const openingByAcct = {}; let curAcct = '';
    for (let i = 0; i < aoa.length; i++) {
      const row = aoa[i] || []; const cells = row.map(x => (x == null ? '' : x));
      const joined = cells.map(String).join(' ');
      const acctHit = joined.match(/[SC]\/A#\s*[A-Za-z]*\s*[\d-]+[^\d]*/);
      if (acctHit) curAcct = cfpAccountLabel(acctHit[0]);
      if (cells.some(x => String(x).trim() === 'ยอดยกมา')) {
        let bal = 0; for (let k = cells.length - 1; k >= 0; k--) { const n = cfpNum(cells[k]); if (n !== 0) { bal = n; break; } }
        if (curAcct) openingByAcct[curAcct] = (openingByAcct[curAcct] || 0) + bal;
        continue;
      }
      const iso = cfpToISO(cells[0]); if (!iso) continue;
      const withdraw = cfpNum(cells[3]), deposit = cfpNum(cells[4]);
      if (withdraw === 0 && deposit === 0) continue;
      const category = String(cells[8] || '').trim(), activity = String(cells[9] || '').trim();
      txns.push({
        account: curAcct || '(ไม่ระบุบัญชี)', iso, month: cfpMonth(iso),
        docNo: String(cells[2] || '').trim(), note: String(cells[7] || '').trim(),
        category: category || '(ไม่ระบุหมวด)', actKey: cfpActKey(activity, category),
        withdraw, deposit, balance: cfpNum(cells[5]), flow: deposit - withdraw,
      });
    }
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
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const row = aoa[i] || []; const label = String(row[0] || '').trim(); if (!label) continue;
      const vals = []; let hasVal = false;
      for (let k = 1; k <= nMonths; k++) { const n = cfpNum(row[k]); vals.push(n); if (n !== 0) hasVal = true; }
      const total = cfpNum(row[nMonths + 1]); if (total !== 0) hasVal = true;
      let type = 'leaf', actKey = curAct;
      if (/^กระแสเงินสดจากกิจกรรม/.test(label)) { type = 'section'; actKey = /ดำเนินงาน/.test(label) ? 'op' : /ลงทุน/.test(label) ? 'inv' : /จัดหา/.test(label) ? 'fin' : null; curAct = actKey; }
      else if (/^กระแสเงินสดสุทธิจากกิจกรรม/.test(label)) { type = 'net'; const k = /ดำเนินงาน/.test(label) ? 'op' : /ลงทุน/.test(label) ? 'inv' : /จัดหา/.test(label) ? 'fin' : null; if (k) out.actNet[k] = total; }
      else if (/เพิ่มขึ้น.*ลดลง.*สุทธิ|สุทธิ.*เพิ่มขึ้น/.test(label)) { type = 'grand'; out.net = total; }
      else if (/เงินสด.*ต้นงวด/.test(label)) { type = 'grand'; out.opening = total; }
      else if (/เงินสด.*ปลายงวด/.test(label)) { type = 'grand'; out.ending = total; }
      else if (/^รวม/.test(label)) type = 'subtotal';
      else if (!hasVal) type = 'group';
      else type = 'leaf';
      out.rows.push({ label, vals, total, type, actKey });
    }
    return out;
  }

  /* ---------- build model ---------- */
  function cfpBuildModel(stm, summary) {
    const txns = stm.txns || [];
    const monthsSet = {};
    txns.forEach(t => { if (t.month && t.actKey !== 'transfer' && t.actKey !== 'other') monthsSet[t.month] = true; });
    const months = Object.keys(monthsSet).map(Number).sort((a, b) => a - b);
    const mkAct = key => ({ key, name: CFP_ACT_NAME[key], net: 0, byMonth: {}, cats: {} });
    const acts = { op: mkAct('op'), inv: mkAct('inv'), fin: mkAct('fin') };
    months.forEach(m => { ['op', 'inv', 'fin'].forEach(k => { acts[k].byMonth[m] = 0; }); });
    let transferNet = 0, otherNet = 0;
    txns.forEach(t => {
      if (t.actKey === 'transfer') { transferNet += t.flow; return; }
      if (t.actKey === 'other') { otherNet += t.flow; return; }
      const a = acts[t.actKey]; if (!a) return;
      a.net += t.flow; a.byMonth[t.month] = (a.byMonth[t.month] || 0) + t.flow;
      if (!a.cats[t.category]) a.cats[t.category] = { name: t.category, net: 0, count: 0, txns: [] };
      const cat = a.cats[t.category]; cat.net += t.flow; cat.count++; cat.txns.push(t);
    });
    ['op', 'inv', 'fin'].forEach(k => {
      acts[k].catList = Object.keys(acts[k].cats).map(n => acts[k].cats[n]).sort((x, y) => Math.abs(y.net) - Math.abs(x.net));
      acts[k].catList.forEach(c => c.txns.sort((x, y) => Math.abs(y.flow) - Math.abs(x.flow)));
    });
    const opening = stm.opening || 0;
    const net = acts.op.net + acts.inv.net + acts.fin.net;
    const ending = opening + net;
    let run = opening;
    const monthly = months.map(m => {
      const o = acts.op.byMonth[m] || 0, iv = acts.inv.byMonth[m] || 0, f = acts.fin.byMonth[m] || 0;
      const mnet = o + iv + f; run += mnet;
      return { m, label: CFP_MONTHS[m] || ('เดือน ' + m), op: o, inv: iv, fin: f, net: mnet, end: run };
    });
    let interest = 0, payroll = 0, inflowTotal = 0; const inflowByCat = {};
    txns.forEach(t => {
      if (t.actKey === 'transfer' || t.actKey === 'other') return;
      if (/ดอกเบี้ย/.test(t.category)) interest += Math.abs(t.flow);
      if (/เงินเดือน/.test(t.category)) payroll += Math.abs(t.flow);
      if (t.flow > 0) { inflowTotal += t.flow; inflowByCat[t.category] = (inflowByCat[t.category] || 0) + t.flow; }
    });
    let topInflow = { name: '', amt: 0 };
    Object.keys(inflowByCat).forEach(n => { if (inflowByCat[n] > topInflow.amt) topInflow = { name: n, amt: inflowByCat[n] }; });
    const accounts = {}; txns.forEach(t => { accounts[t.account] = true; });
    return {
      months, monthly, acts, opening, ending, net, transferNet, otherNet,
      allTxns: txns, txnCount: txns.filter(t => t.actKey !== 'transfer' && t.actKey !== 'other').length,
      accounts: Object.keys(accounts), interest, payroll, inflowTotal, topInflow,
      summary: summary || null, stmt: (summary && summary.rows && summary.rows.length) ? summary.rows : null,
      monthLabels: (summary && summary.monthLabels) || [],
      periodLabel: (summary && summary.periodLabel) || (months.length ? (CFP_MONTHS[months[0]] + '–' + CFP_MONTHS[months[months.length - 1]] + ' ' + (new Date().getFullYear() + 543 - 2500)) : ''),
    };
  }

  /* ---------- shared bits ---------- */
  function CfpTag({ k }) { return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ACT_TAGBG[k] || C.soft, color: ACT_TAGFG[k] || C.mut, whiteSpace: 'nowrap' }}>{CFP_ACT_SHORT[k] || k}</span>; }
  function CfpBankPill({ acct }) { const code = cfpBankCode(acct); const p = BANK_PILL[code] || { bg: C.soft, fg: C.primaryD }; return <span title={acct} style={{ fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 6, background: p.bg, color: p.fg, whiteSpace: 'nowrap' }}>{code || 'บัญชี'}</span>; }
  function cfpTxnRows(txns) {
    return txns.map((t, i) => (
      <tr key={i}>
        <td style={{ padding: '6px 8px', color: C.mut, borderBottom: '1px solid ' + C.line, whiteSpace: 'nowrap' }}>{cfpThaiDate(t.iso)}</td>
        <td style={{ padding: '6px 8px', color: C.ink, borderBottom: '1px solid ' + C.line, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.note}>{t.note || t.category}</td>
        <td style={{ padding: '6px 8px', borderBottom: '1px solid ' + C.line }}><CfpBankPill acct={t.account} /></td>
        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: t.flow < 0 ? C.neg : C.pos, borderBottom: '1px solid ' + C.line, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{cfpFmtB(t.flow)}</td>
      </tr>
    ));
  }
  function CfpTxnTable({ txns }) {
    const totIn = txns.filter(t => t.flow > 0).reduce((s, t) => s + t.flow, 0);
    const totOut = txns.filter(t => t.flow < 0).reduce((s, t) => s + Math.abs(t.flow), 0);
    return (
      <div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: C.mut, marginBottom: 6 }}>
          <span>รับ <b style={{ color: C.pos }}>{cfpFmtB(totIn)}</b></span>
          <span>จ่าย <b style={{ color: C.neg }}>{cfpFmtB(totOut)}</b></span>
          <span>สุทธิ <b style={{ color: (totIn - totOut) < 0 ? C.neg : C.pos }}>{cfpFmtB(totIn - totOut)}</b></span>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto', border: '1px solid ' + C.line, borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ color: C.mut, textAlign: 'left', fontSize: 12 }}>
              <th style={{ padding: '7px 8px', fontWeight: 700, position: 'sticky', top: 0, background: '#fbfdff', width: 96 }}>วันที่</th>
              <th style={{ padding: '7px 8px', fontWeight: 700, position: 'sticky', top: 0, background: '#fbfdff' }}>รายการ</th>
              <th style={{ padding: '7px 8px', fontWeight: 700, position: 'sticky', top: 0, background: '#fbfdff', width: 70 }}>บัญชี</th>
              <th style={{ padding: '7px 8px', fontWeight: 700, position: 'sticky', top: 0, background: '#fbfdff', width: 110, textAlign: 'right' }}>จำนวน</th>
            </tr></thead>
            <tbody>{cfpTxnRows(txns)}</tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ---------- drill modal ---------- */
  function CfpModal({ title, subtitle, txns, onClose }) {
    useEffect(() => { const h = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(31,58,95,.42)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 20 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, maxWidth: 900, width: '100%', maxHeight: '86vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 30px 80px rgba(31,58,95,.35)' }}>
          <div style={{ padding: '16px 22px', borderBottom: '1px solid ' + C.line, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>{subtitle}</div>}
            </div>
            <button onClick={onClose} style={{ cursor: 'pointer', border: 0, background: C.soft, width: 34, height: 34, borderRadius: 10, fontSize: 18, color: C.mut, flexShrink: 0 }}>×</button>
          </div>
          <div style={{ padding: '12px 22px 22px', overflow: 'auto' }}>
            {txns.length ? <CfpTxnTable txns={txns} /> : <div style={{ fontSize: 13, color: C.faint, padding: '10px 0' }}>ไม่พบรายการ</div>}
          </div>
        </div>
      </div>
    );
  }

  /* ---------- KPI cards ---------- */
  function CfpKpiHero({ label, value, sub, color }) {
    return (
      <div className="cfp-card" style={{ background: C.card, backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.6)', borderRadius: 18, padding: '16px 20px', boxShadow: C.shadow }}>
        <div style={{ fontSize: 13, color: C.mut, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, margin: '8px 0 4px', color: color || C.ink, letterSpacing: '-.5px' }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: C.mut }}>{sub}</div>}
      </div>
    );
  }
  function CfpKpiAct({ k, value, sub, onClick }) {
    const col = ACT_COLOR[k];
    return (
      <div onClick={onClick} className="cfp-card" style={{ background: C.card, backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.6)', borderRadius: 18, padding: '16px 20px', boxShadow: C.shadow, cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
        <div style={{ height: 5, margin: '-16px -20px 12px', background: col }} />
        <div style={{ fontSize: 13, color: C.mut, fontWeight: 600 }}>{CFP_ACT_NAME[k]} <span style={{ color: C.faint, fontSize: 11 }}>กดดู ›</span></div>
        <div style={{ fontSize: 22, fontWeight: 800, margin: '7px 0 2px', color: value < 0 ? C.neg : C.pos, letterSpacing: '-.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cfpFmtM(value)}</div>
        {sub && <div style={{ fontSize: 11, color: C.mut }}>{sub}</div>}
      </div>
    );
  }

  /* ---------- SVG: waterfall ---------- */
  function CfpWaterfall({ model, onPick }) {
    const W = 720, H = 300, padX = 46, top = 30, baseY = 250;
    const cols = [
      { key: null, name: 'ต้นงวด', delta: model.opening, abs: true }, { key: 'op', name: 'ดำเนินงาน', delta: model.acts.op.net },
      { key: 'inv', name: 'ลงทุน', delta: model.acts.inv.net }, { key: 'fin', name: 'จัดหาเงิน', delta: model.acts.fin.net },
      { key: null, name: 'ปลายงวด', delta: model.ending, abs: true },
    ];
    const segs = [{ from: 0, to: model.opening }]; let cum = model.opening;
    [model.acts.op.net, model.acts.inv.net, model.acts.fin.net].forEach(d => { const from = cum; cum += d; segs.push({ from, to: cum }); });
    segs.push({ from: 0, to: model.ending });
    const peak = Math.max(model.opening, model.ending, ...segs.map(s => Math.max(s.from, s.to))) * 1.1 || 1;
    const y = v => baseY - (v / peak) * (baseY - top);
    const slot = (W - padX * 2) / cols.length, bw = Math.min(74, slot * 0.5);
    return (
      <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" style={{ display: 'block' }} role="img" aria-label="waterfall กระแสเงินสด">
        <line x1={padX - 8} y1={baseY} x2={W - padX + 8} y2={baseY} stroke={C.line} />
        {cols.map((c, i) => {
          const cx = padX + slot * i + slot / 2, s = segs[i];
          const yTop = y(Math.max(s.from, s.to)), h = Math.max(2, y(Math.min(s.from, s.to)) - yTop);
          const fill = c.abs ? C.primary : (c.delta >= 0 ? C.pos : C.neg), clickable = !!c.key;
          return (
            <g key={i} style={{ cursor: clickable ? 'pointer' : 'default' }} onClick={() => clickable && onPick && onPick(c.key)}>
              {i > 0 && <line x1={padX + slot * (i - 1) + slot / 2 + bw / 2} y1={y(segs[i - 1].to)} x2={cx - bw / 2} y2={y(c.abs ? c.delta : s.from)} stroke={C.faint} strokeDasharray="3 3" />}
              <rect x={cx - bw / 2} y={yTop} width={bw} height={h} rx="5" fill={fill} opacity={c.abs ? 0.92 : 0.96} />
              <text x={cx} y={yTop - 7} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={c.abs ? C.primaryD : fill}>{c.abs ? cfpFmtM(c.delta) : cfpFmtSigned(c.delta)}</text>
              <text x={cx} y={baseY + 18} textAnchor="middle" fontSize="12" fill={C.mut}>{c.name}</text>
              {clickable && <text x={cx} y={baseY + 33} textAnchor="middle" fontSize="10" fill={C.faint}>กดดู ›</text>}
            </g>
          );
        })}
      </svg>
    );
  }

  /* ---------- SVG: monthly stacked (net by activity) ---------- */
  function CfpMonthly({ model, onPick }) {
    const W = 720, H = 320, padX = 46, top = 24, botAxis = 250;
    const mo = model.monthly; if (!mo.length) return null;
    const maxAbs = Math.max(...mo.map(d => Math.max(Math.abs(d.op) + Math.abs(d.fin > 0 ? d.fin : 0), Math.abs(d.net), Math.abs(d.end)))) || 1;
    const ends = mo.map(d => d.end); const eMin = Math.min(...ends), eMax = Math.max(...ends);
    const eLo = eMin - (eMax - eMin) * 0.3 - 1, eHi = eMax + (eMax - eMin) * 0.2 + 1;
    const ly = v => top + 8 + (1 - (v - eLo) / (eHi - eLo)) * (130);
    const base = botAxis, span = 60;
    const sc = Math.max(...mo.map(d => Math.abs(d.op) + Math.abs(d.inv) + Math.abs(d.fin)), 1);
    const slot = (W - padX * 2) / mo.length, cx = i => padX + slot * i + slot / 2;
    const pts = mo.map((d, i) => cx(i) + ',' + ly(d.end)).join(' ');
    const bw = Math.min(40, slot * 0.42);
    function seg(val, accPos, accNeg) { const h = Math.abs(val) / sc * span; let yy; if (val >= 0) { yy = base - accPos - h; } else { yy = base + accNeg; } return { h, yy }; }
    return (
      <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" style={{ display: 'block' }} role="img" aria-label="กระแสเงินสดรายเดือนแยกกิจกรรม">
        <text x={padX - 8} y={top} fontSize="11" fill={C.faint}>เงินสดคงเหลือปลายเดือน</text>
        <polyline points={pts} fill="none" stroke={C.primaryD} strokeWidth="2.5" />
        {mo.map((d, i) => (<g key={'e' + i}><circle cx={cx(i)} cy={ly(d.end)} r="4.5" fill={C.primaryD} /><text x={cx(i)} y={ly(d.end) - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill={C.primaryD}>{cfpFmtM(d.end)}</text></g>))}
        <line x1={padX - 8} y1={base} x2={W - padX + 8} y2={base} stroke={C.line} />
        {mo.map((d, i) => {
          let accP = 0, accN = 0; const parts = [];
          [['op', d.op], ['inv', d.inv], ['fin', d.fin]].forEach(([k, v]) => { if (!v) return; const s = seg(v, accP, accN); if (v >= 0) accP += s.h; else accN += s.h; parts.push(<rect key={k} x={cx(i) - bw / 2} y={s.yy} width={bw} height={Math.max(1, s.h)} fill={ACT_COLOR[k]} opacity="0.9" />); });
          return (<g key={'b' + i} style={{ cursor: 'pointer' }} onClick={() => onPick && onPick(d.m)}>{parts}<text x={cx(i)} y={H - 8} textAnchor="middle" fontSize="12" fill={C.mut}>{d.label}</text><text x={cx(i)} y={base + accN + 16} textAnchor="middle" fontSize="10" fontWeight="700" fill={d.net < 0 ? C.neg : C.pos}>{cfpFmtSigned(d.net)}</text></g>);
        })}
      </svg>
    );
  }

  function CfpBar({ amt, max }) { const w = Math.max(2, Math.round(Math.abs(amt) / (max || 1) * 100)); return <span style={{ display: 'inline-block', height: 7, width: w + '%', background: amt < 0 ? C.neg : C.pos, borderRadius: 2, verticalAlign: 'middle' }} />; }

  /* ---------- statement table ---------- */
  function CfpStatementTable({ model, onPick }) {
    const rows = model.stmt;
    if (!rows || !rows.length) return <div style={{ fontSize: 13, color: C.faint, padding: '6px 0' }}>อัปโหลดไฟล์ “งบกระแสเงินสดรายเดือน” เพิ่ม เพื่อแสดงตารางงบ</div>;
    const months = (model.monthLabels && model.monthLabels.length) ? model.monthLabels : model.months.map(m => CFP_MONTHS[m]);
    const monthNumByIdx = i => model.months[i] || (i + 1);
    const acct = v => { if (!v) return <span style={{ color: C.faint }}>-</span>; const neg = v < 0; return <span style={{ color: neg ? C.neg : C.ink }}>{neg ? '(' + cfpFmtPlain(v) + ')' : cfpFmtPlain(v)}</span>; };
    const th = { padding: '8px 8px', fontWeight: 700, color: C.mut, whiteSpace: 'nowrap', borderBottom: '2px solid ' + C.line, fontSize: 12, position: 'sticky', top: 0, background: '#fbfdff' };
    return (
      <div className="cfp-stmt" style={{ overflowX: 'auto', maxHeight: '76vh', overflowY: 'auto', borderRadius: 12, border: '1px solid ' + C.line }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 680 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left', left: 0, zIndex: 3 }}>รายการ</th>
            {months.map((m, i) => <th key={i} style={{ ...th, textAlign: 'right' }}>{m}</th>)}
            <th style={{ ...th, textAlign: 'right' }}>รวม</th>
          </tr></thead>
          <tbody>
            {rows.map((r, ri) => {
              const isLeaf = r.type === 'leaf', isSection = r.type === 'section', isNet = r.type === 'net', isGrand = r.type === 'grand', isSub = r.type === 'subtotal', isGroup = r.type === 'group';
              const rowBg = isSection ? '#dfecff' : isNet ? '#e3f8ee' : isGrand ? '#dceaff' : isSub ? '#f4f9ff' : 'transparent';
              const fw = (isSection || isNet || isSub || isGrand) ? 800 : (isGroup ? 700 : 400);
              const indent = isSection ? 0 : (isGroup ? 14 : (isSub || isNet || isGrand ? 14 : 26));
              const clickable = isLeaf || isNet || isSub; const emptyVals = isSection || isGroup;
              const col = isSection ? C.primaryD : isNet ? '#0f9b6c' : isGrand ? C.primaryD : C.ink;
              return (
                <tr key={ri} style={{ background: rowBg }}>
                  <td onClick={() => clickable && onPick && onPick(r, null)} style={{ padding: '6px 8px', paddingLeft: 8 + indent, fontWeight: fw, color: col, cursor: clickable ? 'pointer' : 'default', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: rowBg === 'transparent' ? '#fff' : rowBg, borderBottom: '1px solid ' + C.line }}>
                    {r.label}{clickable && <span style={{ color: C.faint, fontWeight: 400 }}> ›</span>}
                  </td>
                  {months.map((m, ci) => (
                    <td key={ci} onClick={() => clickable && !emptyVals && onPick && onPick(r, monthNumByIdx(ci))} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: (isNet || isSub || isGrand) ? 800 : 400, cursor: (clickable && !emptyVals) ? 'pointer' : 'default', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid ' + C.line }}>{emptyVals ? '' : acct(r.vals[ci])}</td>
                  ))}
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', background: '#eef5ff', borderBottom: '1px solid ' + C.line }}>{emptyVals ? '' : acct(r.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  /* ---------- Transaction Explorer ---------- */
  function CfpExplorer({ model, toast }) {
    const [q, setQ] = useState('');
    const [fAct, setFAct] = useState(''); const [fBank, setFBank] = useState(''); const [fMonth, setFMonth] = useState(''); const [fType, setFType] = useState('');
    const [sortKey, setSortKey] = useState('iso'); const [sortDir, setSortDir] = useState(-1);
    const banks = useMemo(() => Array.from(new Set(model.allTxns.map(t => t.account))).sort(), [model]);
    const sel = { padding: '8px 11px', border: '1px solid ' + C.line, borderRadius: 11, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: C.ink };
    const rows = useMemo(() => {
      const ql = q.trim().toLowerCase();
      let r = model.allTxns.filter(t => {
        if (fAct && t.actKey !== fAct) return false;
        if (fBank && t.account !== fBank) return false;
        if (fMonth && String(t.month) !== fMonth) return false;
        if (fType === 'in' && t.flow <= 0) return false;
        if (fType === 'out' && t.flow >= 0) return false;
        if (ql) { const s = (t.note + ' ' + t.category + ' ' + t.docNo + ' ' + t.account).toLowerCase(); if (s.indexOf(ql) < 0) return false; }
        return true;
      });
      r = r.slice().sort((a, b) => { let x = a[sortKey], y = b[sortKey]; if (x < y) return -sortDir; if (x > y) return sortDir; return 0; });
      return r;
    }, [model, q, fAct, fBank, fMonth, fType, sortKey, sortDir]);
    const totIn = rows.filter(t => t.flow > 0).reduce((s, t) => s + t.flow, 0);
    const totOut = rows.filter(t => t.flow < 0).reduce((s, t) => s + Math.abs(t.flow), 0);
    const shown = rows.slice(0, 500);
    function sortBy(k) { if (sortKey === k) setSortDir(d => -d); else { setSortKey(k); setSortDir(k === 'iso' ? -1 : 1); } }
    function arrow(k) { return sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''; }
    function exportCSV() {
      const head = ['วันที่', 'เลขที่', 'รายการ', 'บัญชี', 'หมวด', 'กิจกรรม', 'รับ', 'จ่าย', 'คงเหลือ'];
      const lines = [head.join(',')].concat(rows.map(t => [cfpThaiDate(t.iso), t.docNo, '"' + (t.note || '').replace(/"/g, '""') + '"', '"' + t.account + '"', '"' + t.category + '"', CFP_ACT_SHORT[t.actKey] || '', t.flow > 0 ? Math.round(t.flow) : '', t.flow < 0 ? Math.round(-t.flow) : '', t.balance || ''].join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'transactions.csv'; a.click();
      toast && toast('ดาวน์โหลด CSV · ' + rows.length + ' รายการ');
    }
    const th = (label, k, align) => <th onClick={k ? () => sortBy(k) : undefined} style={{ padding: '8px 9px', fontWeight: 700, fontSize: 12, color: C.mut, cursor: k ? 'pointer' : 'default', whiteSpace: 'nowrap', textAlign: align || 'left', position: 'sticky', top: 0, background: '#fbfdff', userSelect: 'none' }}>{label}{k ? arrow(k) : ''}</th>;
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา รายการ / หมวด / เลขที่…" style={{ ...sel, minWidth: 230, flex: '1 1 230px' }} />
          <select value={fAct} onChange={e => setFAct(e.target.value)} style={sel}><option value="">ทุกกิจกรรม</option><option value="op">ดำเนินงาน</option><option value="inv">ลงทุน</option><option value="fin">จัดหาเงิน</option><option value="transfer">โอนระหว่างบัญชี</option></select>
          <select value={fBank} onChange={e => setFBank(e.target.value)} style={sel}><option value="">ทุกบัญชี</option>{banks.map(b => <option key={b} value={b}>{b}</option>)}</select>
          <select value={fMonth} onChange={e => setFMonth(e.target.value)} style={sel}><option value="">ทุกเดือน</option>{model.months.map(m => <option key={m} value={String(m)}>{CFP_MONTHS[m]}</option>)}</select>
          <select value={fType} onChange={e => setFType(e.target.value)} style={sel}><option value="">รับ+จ่าย</option><option value="in">รับเข้า</option><option value="out">จ่ายออก</option></select>
          <button onClick={exportCSV} style={{ ...sel, cursor: 'pointer', fontWeight: 600 }}>⬇ CSV</button>
        </div>
        <div style={{ display: 'flex', gap: 18, fontSize: 12, color: C.mut, marginBottom: 10 }}>
          <span><b style={{ color: C.ink }}>{rows.length.toLocaleString('en-US')}</b> รายการ</span>
          <span>รับ <b style={{ color: C.pos }}>{cfpFmtB(totIn)}</b></span>
          <span>จ่าย <b style={{ color: C.neg }}>{cfpFmtB(totOut)}</b></span>
          <span>สุทธิ <b style={{ color: (totIn - totOut) < 0 ? C.neg : C.pos }}>{cfpFmtB(totIn - totOut)}</b></span>
        </div>
        <div className="cfp-grid" style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto', border: '1px solid ' + C.line, borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
            <thead><tr>{th('วันที่', 'iso')}{th('เลขที่', 'docNo')}{th('รายการ', 'note')}{th('บัญชี', 'account')}{th('หมวด', 'category')}{th('กิจกรรม', 'actKey')}{th('รับ', 'flow', 'right')}{th('จ่าย', null, 'right')}{th('คงเหลือ', 'balance', 'right')}</tr></thead>
            <tbody>
              {shown.map((t, i) => (
                <tr key={i} style={{ borderBottom: '1px solid ' + C.line }}>
                  <td style={{ padding: '6px 9px', color: C.mut, whiteSpace: 'nowrap' }}>{cfpThaiDate(t.iso)}</td>
                  <td style={{ padding: '6px 9px', color: C.mut, whiteSpace: 'nowrap', fontSize: 12 }}>{t.docNo}</td>
                  <td style={{ padding: '6px 9px', color: C.ink, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.note}>{t.note || '-'}</td>
                  <td style={{ padding: '6px 9px' }}><CfpBankPill acct={t.account} /></td>
                  <td style={{ padding: '6px 9px', color: C.mut, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }} title={t.category}>{t.category}</td>
                  <td style={{ padding: '6px 9px' }}><CfpTag k={t.actKey} /></td>
                  <td style={{ padding: '6px 9px', textAlign: 'right', color: C.pos, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{t.flow > 0 ? cfpFmtPlain(t.flow) : ''}</td>
                  <td style={{ padding: '6px 9px', textAlign: 'right', color: C.neg, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{t.flow < 0 ? cfpFmtPlain(t.flow) : ''}</td>
                  <td style={{ padding: '6px 9px', textAlign: 'right', color: C.mut, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{t.balance ? cfpFmtPlain(t.balance) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown.length && <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>แสดง {shown.length} จาก {rows.length.toLocaleString('en-US')} รายการ — ใช้ตัวกรอง/ค้นหาเพื่อแคบลง</div>}
      </div>
    );
  }

  /* ---------- activity detail (องค์ประกอบ + จุดเฝ้าระวัง รายกิจกรรม) ---------- */
  function CfpActivityDetail({ model, k, onCat, onAll }) {
    const a = model.acts[k]; if (!a) return null;
    const flags = cfpWatch(model, k);
    const cats = a.catList || [];
    const maxAbs = Math.max.apply(null, cats.map(c => Math.abs(c.net)).concat([1]));
    const inTot = cats.filter(c => c.net > 0).reduce((s, c) => s + c.net, 0);
    const outTot = cats.filter(c => c.net < 0).reduce((s, c) => s + Math.abs(c.net), 0);
    const top = cats.slice(0, 7);
    return (
      <div className="cfp-card" style={{ background: C.card, backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.6)', borderRadius: 18, boxShadow: C.shadow, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ height: 5, background: ACT_COLOR[k] }} />
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{CFP_ACT_NAME[k]}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: a.net < 0 ? C.neg : C.pos }}>{cfpFmtM(a.net)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, fontSize: 12, flexWrap: 'wrap' }}>
            <span style={{ background: C.posBg, color: C.pos, padding: '3px 10px', borderRadius: 20, fontWeight: 700 }}>รับ {cfpFmtM(inTot)}</span>
            <span style={{ background: C.negBg, color: C.neg, padding: '3px 10px', borderRadius: 20, fontWeight: 700 }}>จ่าย {cfpFmtM(outTot)}</span>
            <span style={{ background: C.soft, color: C.mut, padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>{cats.length} หมวด</span>
          </div>
          <div className="cfp-act-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, marginBottom: 8 }}>องค์ประกอบหลัก (กดดูรายการ)</div>
              {top.map((c, i) => (
                <div key={i} onClick={() => onCat(c)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) 1fr auto', gap: 10, alignItems: 'center', padding: '6px 6px', borderBottom: '1px solid ' + C.line, cursor: 'pointer', borderRadius: 6 }}>
                  <span style={{ fontSize: 13, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cfpShort(c.name)} <span style={{ color: C.faint }}>({c.count})</span></span>
                  <span><CfpBar amt={c.net} max={maxAbs} /></span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: c.net < 0 ? C.neg : C.pos, textAlign: 'right', whiteSpace: 'nowrap' }}>{cfpFmtB(c.net)}</span>
                </div>
              ))}
              {cats.length > 7 && <div onClick={onAll} style={{ fontSize: 12, color: C.primary, cursor: 'pointer', marginTop: 9, fontWeight: 700 }}>ดูทั้งหมด {cats.length} หมวด →</div>}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, marginBottom: 8 }}>🚩 จุดเฝ้าระวัง</div>
              {flags.map((f, i) => {
                const s = CFP_SEV[f.sev] || CFP_SEV.blue;
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 11px', borderRadius: 10, background: s.bg, marginBottom: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.c, marginTop: 5, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: s.c, lineHeight: 1.45, fontWeight: 500 }}>{f.t}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- main page ---------- */
  function CashFlowPresentPage({ data, setData, toast }) {
    const [stored, setStored] = useState(() => { try { return JSON.parse(localStorage.getItem(CFP_LS) || 'null'); } catch (e) { return null; } });
    const [uploading, setUploading] = useState(false);
    const [tab, setTab] = useState('overview');
    const [topN, setTopN] = useState(10);
    const [modal, setModal] = useState(null);
    const fileRef = useRef(null);
    const canEdit = !(window._wtpRoleIsReadOnly && window._wtpRoleIsReadOnly());

    const model = useMemo(() => { if (!stored || !stored.stm) return null; try { return cfpBuildModel(stored.stm, stored.summary); } catch (e) { console.error('[cfp] build', e); return null; } }, [stored]);

    function openAct(k) { const a = model.acts[k]; if (!a) return; let txns = []; a.catList.forEach(c => { txns = txns.concat(c.txns); }); txns.sort((x, y) => x.iso < y.iso ? 1 : -1); setModal({ title: CFP_ACT_NAME[k], subtitle: 'รวม ' + model.periodLabel + ' · ' + txns.length + ' รายการ', txns }); }
    function openMonth(m) { const txns = model.allTxns.filter(t => t.month === m && t.actKey !== 'transfer' && t.actKey !== 'other').sort((x, y) => x.iso < y.iso ? 1 : -1); setModal({ title: 'เดือน ' + (CFP_MONTHS[m] || m), subtitle: txns.length + ' รายการ', txns }); }
    function openCat(c) { const txns = (c.txns || []).slice().sort((x, y) => x.iso < y.iso ? 1 : -1); setModal({ title: c.name, subtitle: c.count + ' รายการ · สุทธิ ' + cfpFmtB(c.net), txns }); }
    function watchSub(k) { const n = cfpWatch(model, k).filter(f => f.sev === 'red' || f.sev === 'amber').length; return n ? ('🚩 ' + n + ' จุดเฝ้าระวัง') : 'กดดูรายการ'; }
    function openStmt(row, monthNum) {
      if (!row.actKey) return;
      if (row.type === 'net') { openAct(row.actKey); return; }
      const dir = row.total > 0 ? 1 : row.total < 0 ? -1 : 0;
      const res = cfpFindStmtTxns(model, row.label, row.actKey, monthNum, dir);
      const txns = res.txns.slice().sort((x, y) => x.iso < y.iso ? 1 : -1);
      setModal({ title: row.label, subtitle: (res.matched ? 'จับคู่หมวด STM: ' + res.cats.join(', ') : 'แสดงรายการทั้ง' + (CFP_ACT_NAME[row.actKey] || 'กิจกรรม')) + (monthNum ? ' · เดือน ' + (CFP_MONTHS[monthNum] || monthNum) : ''), txns });
    }

    async function readAoa(file) {
      return new Promise((resolve, reject) => {
        if (!window.XLSX) { reject(new Error('ไม่พบ SheetJS — รีเฟรชหน้า')); return; }
        const r = new FileReader();
        r.onload = e => { try { const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: false }); resolve(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' })); } catch (err) { reject(err); } };
        r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ')); r.readAsArrayBuffer(file);
      });
    }
    function detectKind(aoa) { const flat = aoa.slice(0, 12).map(r => (r || []).join(' ')).join(' '); if (/ประเภทกิจกรรมทางการเงิน|ยอดถอน|ยอดฝาก/.test(flat)) return 'stm'; if (/งบกระแสเงินสด|กระแสเงินสดจากกิจกรรม/.test(flat)) return 'summary'; return 'unknown'; }
    async function onUpload(files) {
      setUploading(true);
      try {
        let stm = null, summary = null, sawStm = false;
        for (const f of files) { const aoa = await readAoa(f); const kind = detectKind(aoa);
          if (kind === 'stm') { stm = cfpParseStm(aoa); sawStm = true; }
          else if (kind === 'summary') { summary = cfpParseSummary(aoa); }
          else if (!sawStm) { const guess = cfpParseStm(aoa); if (guess.txns.length) { stm = guess; sawStm = true; } } }
        if (!stm || !stm.txns.length) {
          if (summary && stored && stored.stm) { persist({ stm: stored.stm, summary }); toast && toast('อัปเดตตารางงบสรุปแล้ว'); }
          else { toast && toast('ต้องมีไฟล์ STM (รายการเดินบัญชี)', 'error'); }
          setUploading(false); return;
        }
        persist({ stm, summary: summary || (stored && stored.summary) || null });
        toast && toast('อ่านข้อมูลสำเร็จ · ' + stm.txns.length + ' รายการ' + (summary ? ' + งบสรุป' : ''));
      } catch (e) { console.error(e); toast && toast('อ่านไฟล์ไม่สำเร็จ: ' + (e.message || e), 'error'); }
      setUploading(false);
    }
    function persist(obj) { const payload = Object.assign({ uploadedAt: Date.now() }, obj); try { localStorage.setItem(CFP_LS, JSON.stringify(payload)); } catch (e) { console.error('[cfp] save', e); } setStored(payload); }
    function clearData() { if (!confirm('ล้างข้อมูล Cash Flow ในเครื่องนี้?')) return; localStorage.removeItem(CFP_LS); setStored(null); }

    const pageWrap = { background: 'linear-gradient(155deg,#eef5ff 0%,#f0f7ff 55%,#e9f6f8 100%)', borderRadius: 20, padding: '20px 22px 30px', minHeight: 400, color: C.ink };
    const card = { background: C.card, backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.6)', borderRadius: 18, padding: '16px 20px', boxShadow: C.shadow, marginBottom: 16 };
    const secTitle = { fontSize: 15, fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
    const tabs = [['overview', '📊 ภาพรวม'], ['activity', '🔬 ตามกิจกรรม'], ['statement', '📑 งบกระแสเงินสด'], ['explorer', '🔎 รายการ (Transaction Explorer)']];

    return (
      <div className="cfp-page present-page" style={pageWrap}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.4px' }}>Executive Cash Flow Dashboard</div>
            <div style={{ fontSize: 13, color: C.mut, marginTop: 3 }}>BIOAXEL{model ? ' · งวด ' + model.periodLabel + ' · ' + model.txnCount + ' รายการ · ' + model.accounts.length + ' บัญชี' : ' · อัปโหลดไฟล์เพื่อเริ่ม'}</div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading} style={{ background: C.primary, color: '#fff', border: 0, borderRadius: 11, padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: C.shadow }}>{uploading ? '⏳ กำลังอ่าน…' : (model ? '⬆️ อัปเดตไฟล์' : '⬆️ อัปโหลด STM + งบสรุป')}</button>
              {model && <button onClick={clearData} style={{ background: '#fff', color: C.mut, border: '1px solid ' + C.line, borderRadius: 11, padding: '9px 12px', fontSize: 14, cursor: 'pointer' }}>ล้าง</button>}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files.length) onUpload(Array.from(e.target.files)); e.target.value = ''; }} />
            </div>
          )}
        </div>

        {!model && (
          <div style={{ ...card, textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📊</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>ยังไม่มีข้อมูล</div>
            <div style={{ fontSize: 14, color: C.mut, maxWidth: 480, margin: '0 auto 18px', lineHeight: 1.6 }}>อัปโหลด <b>2 ไฟล์</b>: <b>STM</b> (รายการเดินบัญชี) + <b>งบกระแสเงินสดรายเดือน</b> (สรุป). เลือกพร้อมกันได้</div>
            {canEdit ? <button onClick={() => fileRef.current && fileRef.current.click()} style={{ background: C.primary, color: '#fff', border: 0, borderRadius: 11, padding: '11px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>เลือกไฟล์…</button> : <div style={{ fontSize: 13, color: C.faint }}>บัญชีนี้ดูได้อย่างเดียว — ให้ผู้ดูแลอัปโหลดไฟล์</div>}
          </div>
        )}

        {model && <React.Fragment>
          {/* tab nav */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {tabs.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} style={{ border: '1px solid ' + (tab === k ? 'transparent' : C.line), background: tab === k ? 'linear-gradient(135deg,#2e8b4a,#1f6e3a)' : '#fff', color: tab === k ? '#fff' : C.mut, fontWeight: 700, fontSize: 14, padding: '9px 16px', borderRadius: 12, cursor: 'pointer', boxShadow: tab === k ? '0 6px 16px rgba(46,139,74,.3)' : 'none' }}>{label}</button>
            ))}
          </div>

          {tab === 'overview' && <React.Fragment>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 16 }}>
              <CfpKpiHero label="เงินสดต้นงวด" value={cfpFmtM(model.opening)} />
              <CfpKpiHero label="กระแสเงินสดสุทธิ" value={cfpFmtSigned(model.net)} color={model.net < 0 ? C.neg : C.pos} sub={model.net >= 0 ? 'เงินสดเพิ่มขึ้น' : 'เงินสดลดลง'} />
              <CfpKpiHero label="เงินสดปลายงวด" value={cfpFmtM(model.ending)} color={C.primaryD} sub={(model.net >= 0 ? '▲ ' : '▼ ') + cfpFmtSigned(model.net) + ' จากต้นงวด'} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14, marginBottom: 16 }}>
              <CfpKpiAct k="op" value={model.acts.op.net} onClick={() => openAct('op')} sub={watchSub('op')} />
              <CfpKpiAct k="inv" value={model.acts.inv.net} onClick={() => openAct('inv')} sub={watchSub('inv')} />
              <CfpKpiAct k="fin" value={model.acts.fin.net} onClick={() => openAct('fin')} sub={watchSub('fin')} />
            </div>
            {model.summary && model.summary.net != null && (
              <div style={{ fontSize: 12, color: Math.abs(model.summary.net - model.net) < 1 ? C.pos : '#b8860b', marginBottom: 16, padding: '8px 14px', background: Math.abs(model.summary.net - model.net) < 1 ? C.posBg : '#fff7e6', borderRadius: 12, fontWeight: 600, display: 'inline-block' }}>{Math.abs(model.summary.net - model.net) < 1 ? '✓ STM ตรงกับงบสรุป — สุทธิ ' + cfpFmtB(model.net) : '⚠ STM ' + cfpFmtB(model.net) + ' · งบสรุป ' + cfpFmtB(model.summary.net)}</div>
            )}
            <div className="cfp-card" style={card}><div style={secTitle}><span>💧 เงินสดเดินทางอย่างไร</span><span style={{ fontSize: 11, fontWeight: 500, color: C.mut, background: C.soft, padding: '3px 10px', borderRadius: 20 }}>กดแท่งกิจกรรมเพื่อดูรายการ</span></div><CfpWaterfall model={model} onPick={openAct} /></div>
            <div className="cfp-card" style={card}><div style={secTitle}><span>📈 กระแสเงินสดรายเดือน (แยกตามกิจกรรม)</span><span style={{ display: 'flex', gap: 12, fontSize: 11, color: C.mut }}><span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: ACT_COLOR.op, marginRight: 4, verticalAlign: 'middle' }} />ดำเนินงาน</span><span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: ACT_COLOR.inv, marginRight: 4, verticalAlign: 'middle' }} />ลงทุน</span><span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: ACT_COLOR.fin, marginRight: 4, verticalAlign: 'middle' }} />จัดหาเงิน</span></span></div><CfpMonthly model={model} onPick={openMonth} /></div>
            <div style={secTitle}><span>🤖 Executive Insights</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 14, marginBottom: 8 }}>
              {model.acts.fin.net > 0 && model.acts.op.net < 0 && (<div className="cfp-card" style={{ ...card, marginBottom: 0, background: 'linear-gradient(135deg,rgba(46,139,74,.12),rgba(26,164,111,.14))' }}><div style={{ fontSize: 12, fontWeight: 700, color: C.primaryD }}>🔁 อยู่ได้ด้วยการจัดหาเงิน</div><div style={{ fontSize: 15, fontWeight: 800, marginTop: 7 }}>ดำเนินงาน {cfpFmtM(model.acts.op.net)}</div><div style={{ fontSize: 11, color: C.mut, marginTop: 3 }}>จัดหาเงินหนุน {cfpFmtSigned(model.acts.fin.net)}</div></div>)}
              {model.interest > 0 && (<div className="cfp-card" style={{ ...card, marginBottom: 0, background: 'linear-gradient(135deg,rgba(46,139,74,.12),rgba(26,164,111,.14))' }}><div style={{ fontSize: 12, fontWeight: 700, color: C.primaryD }}>％ ดอกเบี้ยจ่าย</div><div style={{ fontSize: 15, fontWeight: 800, marginTop: 7 }}>{cfpFmtM(model.interest)}</div><div style={{ fontSize: 11, color: C.mut, marginTop: 3 }}>{model.payroll > 0 ? '≈ ' + Math.round(model.interest / model.payroll * 100) + '% ของเงินเดือน (' + cfpFmtM(model.payroll) + ')' : 'ภาระดอกเบี้ยรวมทั้งงวด'}</div></div>)}
              {model.topInflow.amt > 0 && model.inflowTotal > 0 && (<div className="cfp-card" style={{ ...card, marginBottom: 0, background: 'linear-gradient(135deg,rgba(46,139,74,.12),rgba(26,164,111,.14))' }}><div style={{ fontSize: 12, fontWeight: 700, color: C.primaryD }}>📦 รายได้กระจุกตัว</div><div style={{ fontSize: 15, fontWeight: 800, marginTop: 7 }}>{Math.round(model.topInflow.amt / model.inflowTotal * 100)}% จากสินค้าหลัก</div><div style={{ fontSize: 11, color: C.mut, marginTop: 3 }}>{model.topInflow.name.replace(/^เงินสดรับจากการขาย-?/, '')} ({cfpFmtM(model.topInflow.amt)})</div></div>)}
            </div>
            {(function () {
              const ranked = model.allTxns.filter(t => t.actKey !== 'transfer' && t.actKey !== 'other').slice().sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow)).slice(0, topN);
              return (
                <div className="cfp-card" style={{ ...card, marginTop: 16 }}>
                  <div style={secTitle}><span>🏆 รายการเงินสดสูงสุด (Top {topN})</span>
                    <select value={topN} onChange={e => setTopN(+e.target.value)} style={{ padding: '7px 11px', border: '1px solid ' + C.line, borderRadius: 11, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: C.ink }}>
                      <option value={10}>10 อันดับ</option><option value={20}>20 อันดับ</option><option value={50}>50 อันดับ</option>
                    </select>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                      <thead><tr style={{ color: C.mut, textAlign: 'left', fontSize: 12 }}>
                        <th style={{ padding: '7px 8px', fontWeight: 700, width: 34 }}>#</th>
                        <th style={{ padding: '7px 8px', fontWeight: 700, width: 92 }}>วันที่</th>
                        <th style={{ padding: '7px 8px', fontWeight: 700 }}>รายการ</th>
                        <th style={{ padding: '7px 8px', fontWeight: 700, width: 64 }}>บัญชี</th>
                        <th style={{ padding: '7px 8px', fontWeight: 700, width: 78 }}>กิจกรรม</th>
                        <th style={{ padding: '7px 8px', fontWeight: 700, width: 120, textAlign: 'right' }}>จำนวน</th>
                      </tr></thead>
                      <tbody>
                        {ranked.map((t, i) => (
                          <tr key={i} style={{ borderTop: '1px solid ' + C.line }}>
                            <td style={{ padding: '6px 8px', color: C.faint, fontWeight: 700 }}>{i + 1}</td>
                            <td style={{ padding: '6px 8px', color: C.mut, whiteSpace: 'nowrap' }}>{cfpThaiDate(t.iso)}</td>
                            <td style={{ padding: '6px 8px', color: C.ink, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.note}>{t.note || t.category}</td>
                            <td style={{ padding: '6px 8px' }}><CfpBankPill acct={t.account} /></td>
                            <td style={{ padding: '6px 8px' }}><CfpTag k={t.actKey} /></td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: t.flow < 0 ? C.neg : C.pos, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{cfpFmtB(t.flow)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </React.Fragment>}

          {tab === 'activity' && <React.Fragment>
            <div style={{ fontSize: 13, color: C.mut, margin: '0 2px 12px' }}>แต่ละกิจกรรมมีอะไรบ้าง + จุดที่ต้องเฝ้าระวัง (กดหมวดเพื่อดูรายการจริง)</div>
            <CfpActivityDetail model={model} k="op" onCat={openCat} onAll={() => openAct('op')} />
            <CfpActivityDetail model={model} k="inv" onCat={openCat} onAll={() => openAct('inv')} />
            <CfpActivityDetail model={model} k="fin" onCat={openCat} onAll={() => openAct('fin')} />
          </React.Fragment>}

          {tab === 'statement' && (
            <div className="cfp-card" style={card}><div style={secTitle}><span>📑 งบกระแสเงินสด (รายเดือน)</span><span style={{ fontSize: 11, fontWeight: 500, color: C.mut, background: C.soft, padding: '3px 10px', borderRadius: 20 }}>กดแถว/ช่อง → รายการจริงจาก STM</span></div><CfpStatementTable model={model} onPick={openStmt} /></div>
          )}

          {tab === 'explorer' && (
            <div className="cfp-card" style={card}><div style={secTitle}><span>🔎 Transaction Explorer — รายการเดินบัญชีจาก STM</span></div><CfpExplorer model={model} toast={toast} /></div>
          )}

          <div style={{ fontSize: 11, color: C.faint, margin: '6px 2px 4px' }}>ตารางงบ = ไฟล์งบกระแสเงินสดรายเดือน · รายการ = ไฟล์ STM · เก็บในเครื่องนี้ (ยังไม่ sync ทีม) · อัปเดต {stored && stored.uploadedAt ? new Date(stored.uploadedAt).toLocaleString('th-TH') : '-'}</div>
        </React.Fragment>}

        {modal && <CfpModal title={modal.title} subtitle={modal.subtitle} txns={modal.txns} onClose={() => setModal(null)} />}
      </div>
    );
  }

  window.CashFlowPresentPage = CashFlowPresentPage;
})();
