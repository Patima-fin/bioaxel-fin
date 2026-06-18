/* =====================================================================
 * Cash Flow Presentation (#cashflow_present) — BIOAXEL
 * ---------------------------------------------------------------------
 *  หน้าพรีเซนต์งบกระแสเงินสด: อัปโหลด 2 ไฟล์ Excel
 *   1) STM (รายการเดินบัญชีดิบ) — เครื่องคำนวณ + drill-down รายการจริง
 *   2) งบกระแสเงินสดรายเดือน (สรุปที่ผู้ใช้ทำ) — แสดงเป็น "ตารางงบ" (รายการ×เดือน×รวม)
 *      + กดแถว/ช่อง → โชว์รายการ STM ที่จับคู่กัน (รายละเอียดเหมือนไฟล์ STM)
 *  Self-contained: พึ่งแค่ window.React + window.XLSX. identifier prefix `cfp`/`Cfp`
 *  เก็บใน localStorage `wtp-cfpresent-v1` (ต่อเครื่อง) — ยังไม่ sync ทีม (Phase ต่อไป)
 * ===================================================================== */
(function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const CFP_LS = 'wtp-cfpresent-v1';

  const CFP_MONTHS = { 1: 'ม.ค.', 2: 'ก.พ.', 3: 'มี.ค.', 4: 'เม.ย.', 5: 'พ.ค.', 6: 'มิ.ย.', 7: 'ก.ค.', 8: 'ส.ค.', 9: 'ก.ย.', 10: 'ต.ค.', 11: 'พ.ย.', 12: 'ธ.ค.' };
  const C = {
    ink: '#1f2a37', mut: '#6b7280', faint: '#9ca3af', line: '#e5e7eb', soft: '#f3f5f8',
    card: '#ffffff', pos: '#2e7d32', posBg: '#e8f3e9', neg: '#c0392b', negBg: '#fbecea',
    gray: '#9aa3af', brand: '#2e7d32', brandBg: '#eaf3de', netBg: '#eef5ee', blue: '#185fa5', amber: '#b8860b',
  };

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
      if (y < 100) y += 2000;
      if (y > 2400) y -= 543;
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

  function cfpActKey(activity, category) {
    const a = String(activity || ''); const c = String(category || '');
    if (/โอนเงินระหว่างบัญชี/.test(c)) return 'transfer';
    if (/ดำเนินงาน/.test(a)) return 'op';
    if (/ลงทุน/.test(a)) return 'inv';
    if (/จัดหาเงิน|จัดหาทุน/.test(a)) return 'fin';
    return 'other';
  }
  const CFP_ACT_NAME = { op: 'กิจกรรมดำเนินงาน', inv: 'กิจกรรมลงทุน', fin: 'กิจกรรมจัดหาเงิน' };

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

  /* ---------- statement-line ↔ STM category matcher ---------- */
  function cfpStripCat(s) {
    return String(s || '')
      .replace(/^เงินสดรับจากการขาย\s*-?\s*/, '')
      .replace(/^เงินสดรับ\s*-?\s*/, '')
      .replace(/^เงินสดจ่ายเกี่ยวกับ\s*-?\s*/, '')
      .replace(/^รวม\s*/, '').replace(/^รายได้\s*/, '').replace(/^ค่า/, '')
      .replace(/[^0-9A-Za-zก-๙]/g, '');
  }
  function cfpLatin(s) { return (String(s || '').match(/[A-Za-z]{3,}/g) || []).map(x => x.toLowerCase()); }
  function cfpLCS(a, b) {
    if (!a || !b) return 0;
    const m = a.length, n = b.length; let best = 0, prev = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      const cur = new Array(n + 1).fill(0);
      for (let j = 1; j <= n; j++) { if (a[i - 1] === b[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; } }
      prev = cur;
    }
    return best;
  }
  function cfpStmtMatch(catName, leafLabel) {
    const a = cfpStripCat(catName), b = cfpStripCat(leafLabel);
    if (!a || !b) return false;
    const mn = Math.min(a.length, b.length);
    if (mn >= 5 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) return true;       // one contains the other
    const la = cfpLatin(catName), lb = cfpLatin(leafLabel);
    if (la.length && la.some(t => lb.indexOf(t) >= 0)) return true;             // shared distinctive latin token (BIO/Axel/ERP…)
    const lcs = cfpLCS(a, b);
    if (lcs >= 8 && lcs >= 0.7 * mn) return true;                              // strong fuzzy overlap (tolerates typos/spelling)
    return false;
  }
  function cfpFindStmtTxns(model, leafLabel, actKey, monthNum, dir) {
    const act = model.acts[actKey];
    if (!act) return { txns: [], matched: false, cats: [] };
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
    const txns = [];
    const openingByAcct = {};
    let curAcct = '';
    for (let i = 0; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const cells = row.map(x => (x == null ? '' : x));
      const joined = cells.map(String).join(' ');
      const acctHit = joined.match(/[SC]\/A#\s*[A-Za-z]*\s*[\d-]+[^\d]*/);
      if (acctHit) curAcct = cfpAccountLabel(acctHit[0]);
      if (cells.some(x => String(x).trim() === 'ยอดยกมา')) {
        let bal = 0;
        for (let k = cells.length - 1; k >= 0; k--) { const n = cfpNum(cells[k]); if (n !== 0) { bal = n; break; } }
        if (curAcct) openingByAcct[curAcct] = (openingByAcct[curAcct] || 0) + bal;
        continue;
      }
      const iso = cfpToISO(cells[0]);
      if (!iso) continue;
      const withdraw = cfpNum(cells[3]);
      const deposit = cfpNum(cells[4]);
      if (withdraw === 0 && deposit === 0) continue;
      const category = String(cells[8] || '').trim();
      const activity = String(cells[9] || '').trim();
      txns.push({
        account: curAcct || '(ไม่ระบุบัญชี)', iso, month: cfpMonth(iso),
        docNo: String(cells[2] || '').trim(), note: String(cells[7] || '').trim(),
        category: category || '(ไม่ระบุหมวด)', actKey: cfpActKey(activity, category),
        flow: deposit - withdraw,
      });
    }
    let opening = 0; Object.keys(openingByAcct).forEach(k => { opening += openingByAcct[k]; });
    return { txns, opening, openingByAcct };
  }

  /* ---------- parse summary statement (full table) ---------- */
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
    const nMonths = out.monthLabels.length;
    let curAct = null;
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const row = aoa[i] || []; const label = String(row[0] || '').trim();
      if (!label) continue;
      const vals = []; let hasVal = false;
      for (let k = 1; k <= nMonths; k++) { const n = cfpNum(row[k]); vals.push(n); if (n !== 0) hasVal = true; }
      const total = cfpNum(row[nMonths + 1]);
      if (total !== 0) hasVal = true;
      let type = 'leaf', actKey = curAct;
      if (/^กระแสเงินสดจากกิจกรรม/.test(label)) {
        type = 'section';
        actKey = /ดำเนินงาน/.test(label) ? 'op' : /ลงทุน/.test(label) ? 'inv' : /จัดหา/.test(label) ? 'fin' : null;
        curAct = actKey;
      } else if (/^กระแสเงินสดสุทธิจากกิจกรรม/.test(label)) {
        type = 'net';
        const k = /ดำเนินงาน/.test(label) ? 'op' : /ลงทุน/.test(label) ? 'inv' : /จัดหา/.test(label) ? 'fin' : null;
        if (k) out.actNet[k] = total;
      } else if (/เพิ่มขึ้น.*ลดลง.*สุทธิ|สุทธิ.*เพิ่มขึ้น/.test(label)) { type = 'grand'; out.net = total; }
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
      a.net += t.flow;
      a.byMonth[t.month] = (a.byMonth[t.month] || 0) + t.flow;
      if (!a.cats[t.category]) a.cats[t.category] = { name: t.category, net: 0, count: 0, txns: [] };
      const cat = a.cats[t.category];
      cat.net += t.flow; cat.count++; cat.txns.push(t);
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
      txnCount: txns.filter(t => t.actKey !== 'transfer' && t.actKey !== 'other').length,
      accounts: Object.keys(accounts), interest, payroll, inflowTotal, topInflow,
      summary: summary || null,
      stmt: (summary && summary.rows && summary.rows.length) ? summary.rows : null,
      monthLabels: (summary && summary.monthLabels) || [],
      periodLabel: (summary && summary.periodLabel) || (months.length ? (CFP_MONTHS[months[0]] + '–' + CFP_MONTHS[months[months.length - 1]]) : ''),
    };
  }

  /* ---------- shared txn table ---------- */
  function cfpTxnRows(txns) {
    return txns.map((t, i) => (
      <tr key={i}>
        <td style={{ padding: '5px 6px', color: C.mut, borderTop: '1px solid ' + C.line, whiteSpace: 'nowrap' }}>{cfpThaiDate(t.iso)}</td>
        <td style={{ padding: '5px 6px', color: C.ink, borderTop: '1px solid ' + C.line, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.note}>{t.note || t.category}</td>
        <td style={{ padding: '5px 6px', color: C.mut, borderTop: '1px solid ' + C.line, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.account}</td>
        <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 600, color: t.flow < 0 ? C.neg : C.pos, borderTop: '1px solid ' + C.line, whiteSpace: 'nowrap' }}>{cfpFmtB(t.flow)}</td>
      </tr>
    ));
  }
  function CfpTxnTable({ txns }) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ color: C.mut, textAlign: 'left' }}>
            <th style={{ padding: '4px 6px', fontWeight: 500, width: 92 }}>วันที่</th>
            <th style={{ padding: '4px 6px', fontWeight: 500 }}>รายการ</th>
            <th style={{ padding: '4px 6px', fontWeight: 500, width: 140 }}>บัญชี</th>
            <th style={{ padding: '4px 6px', fontWeight: 500, width: 100, textAlign: 'right' }}>จำนวน</th>
          </tr></thead>
          <tbody>{cfpTxnRows(txns)}</tbody>
        </table>
      </div>
    );
  }

  /* ---------- SVG: waterfall ---------- */
  function CfpWaterfall({ model, onPick }) {
    const W = 720, H = 300, padX = 46, top = 30, baseY = 250;
    const cols = [
      { key: null, name: 'ต้นงวด', delta: model.opening, abs: true },
      { key: 'op', name: 'ดำเนินงาน', delta: model.acts.op.net },
      { key: 'inv', name: 'ลงทุน', delta: model.acts.inv.net },
      { key: 'fin', name: 'จัดหาเงิน', delta: model.acts.fin.net },
      { key: null, name: 'ปลายงวด', delta: model.ending, abs: true },
    ];
    const segs = [{ from: 0, to: model.opening }];
    let cum = model.opening;
    [model.acts.op.net, model.acts.inv.net, model.acts.fin.net].forEach(d => { const from = cum; cum += d; segs.push({ from, to: cum }); });
    segs.push({ from: 0, to: model.ending });
    const peak = Math.max(model.opening, model.ending, ...segs.map(s => Math.max(s.from, s.to))) * 1.1 || 1;
    const y = v => baseY - (v / peak) * (baseY - top);
    const slot = (W - padX * 2) / cols.length;
    const bw = Math.min(72, slot * 0.5);
    return (
      <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" style={{ display: 'block' }} role="img" aria-label="แผนภูมิ waterfall กระแสเงินสด">
        <line x1={padX - 8} y1={baseY} x2={W - padX + 8} y2={baseY} stroke={C.line} />
        {cols.map((c, i) => {
          const cx = padX + slot * i + slot / 2;
          const s = segs[i];
          const yTop = y(Math.max(s.from, s.to)), yBot = y(Math.min(s.from, s.to));
          const h = Math.max(2, yBot - yTop);
          const fill = c.abs ? C.gray : (c.delta >= 0 ? C.pos : C.neg);
          const clickable = !!c.key;
          return (
            <g key={i} style={{ cursor: clickable ? 'pointer' : 'default' }} onClick={() => clickable && onPick && onPick(c.key)}>
              {i > 0 && <line x1={padX + slot * (i - 1) + slot / 2 + bw / 2} y1={y(segs[i - 1].to)} x2={cx - bw / 2} y2={y(c.abs ? c.delta : s.from)} stroke={C.faint} strokeDasharray="3 3" />}
              <rect x={cx - bw / 2} y={yTop} width={bw} height={h} rx="4" fill={fill} opacity={c.abs ? 0.85 : 0.95} />
              <text x={cx} y={yTop - 7} textAnchor="middle" fontSize="12.5" fontWeight="600" fill={c.abs ? C.ink : fill}>{c.abs ? cfpFmtM(c.delta) : cfpFmtSigned(c.delta)}</text>
              <text x={cx} y={baseY + 18} textAnchor="middle" fontSize="12" fill={C.mut}>{c.name}</text>
              {clickable && <text x={cx} y={baseY + 33} textAnchor="middle" fontSize="10" fill={C.faint}>กดดู ›</text>}
            </g>
          );
        })}
      </svg>
    );
  }

  /* ---------- SVG: monthly ---------- */
  function CfpMonthly({ model, onPick }) {
    const W = 720, H = 320, padX = 46;
    const mo = model.monthly; if (!mo.length) return null;
    const lineTop = 26, lineBot = 150;
    const ends = mo.map(d => d.end); const eMin = Math.min(...ends), eMax = Math.max(...ends);
    const eLo = eMin - (eMax - eMin) * 0.25 - 1, eHi = eMax + (eMax - eMin) * 0.2 + 1;
    const ly = v => lineBot - ((v - eLo) / (eHi - eLo)) * (lineBot - lineTop);
    const base = 250, span = 56;
    const maxAbs = Math.max(...mo.map(d => Math.abs(d.net))) || 1;
    const by = v => base - (v / maxAbs) * span;
    const slot = (W - padX * 2) / mo.length;
    const cx = i => padX + slot * i + slot / 2;
    const pts = mo.map((d, i) => cx(i) + ',' + ly(d.end)).join(' ');
    return (
      <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" style={{ display: 'block' }} role="img" aria-label="กระแสเงินสดรายเดือน">
        <text x={padX - 8} y={lineTop - 8} fontSize="11" fill={C.faint}>เงินสดคงเหลือปลายเดือน</text>
        <polyline points={pts} fill="none" stroke={C.blue} strokeWidth="2.5" />
        {mo.map((d, i) => (
          <g key={'e' + i}>
            <circle cx={cx(i)} cy={ly(d.end)} r="4.5" fill={C.blue} />
            <text x={cx(i)} y={ly(d.end) - 9} textAnchor="middle" fontSize="11" fill={C.blue} fontWeight="600">{cfpFmtM(d.end)}</text>
          </g>
        ))}
        <line x1={padX - 8} y1={base} x2={W - padX + 8} y2={base} stroke={C.line} />
        <text x={padX - 8} y={base - span - 8} fontSize="11" fill={C.faint}>เปลี่ยนแปลงสุทธิ</text>
        {mo.map((d, i) => {
          const bw = Math.min(46, slot * 0.46);
          const yT = d.net >= 0 ? by(d.net) : base; const h = Math.max(2, Math.abs(by(d.net) - base));
          return (
            <g key={'b' + i} style={{ cursor: 'pointer' }} onClick={() => onPick && onPick(d.m)}>
              <rect x={cx(i) - bw / 2} y={yT} width={bw} height={h} rx="3" fill={d.net >= 0 ? C.pos : C.neg} opacity="0.92" />
              <text x={cx(i)} y={d.net >= 0 ? yT - 6 : yT + h + 14} textAnchor="middle" fontSize="11" fontWeight="600" fill={d.net >= 0 ? C.pos : C.neg}>{cfpFmtSigned(d.net)}</text>
              <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize="12" fill={C.mut}>{d.label}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  function CfpBar({ amt, max }) {
    const w = Math.max(2, Math.round(Math.abs(amt) / (max || 1) * 100));
    return <span style={{ display: 'inline-block', height: 7, width: w + '%', background: amt < 0 ? C.neg : C.pos, borderRadius: 2, verticalAlign: 'middle' }} />;
  }

  /* ---------- statement table (like the user's summary file) ---------- */
  function CfpStatementTable({ model, onPick }) {
    const rows = model.stmt;
    if (!rows || !rows.length) return (
      <div style={{ fontSize: 13, color: C.faint, padding: '6px 0' }}>อัปโหลดไฟล์ “งบกระแสเงินสดรายเดือน” เพิ่ม เพื่อแสดงตารางงบ (ตอนนี้มีแต่ STM)</div>
    );
    const months = (model.monthLabels && model.monthLabels.length) ? model.monthLabels : model.months.map(m => CFP_MONTHS[m]);
    const nM = months.length;
    const monthNumByIdx = i => model.months[i] || (i + 1);
    const acct = v => {
      if (!v) return <span style={{ color: C.faint }}>-</span>;
      const neg = v < 0;
      return <span style={{ color: neg ? C.neg : C.ink }}>{neg ? '(' + Math.round(Math.abs(v)).toLocaleString('en-US') + ')' : Math.round(v).toLocaleString('en-US')}</span>;
    };
    const th = { padding: '7px 8px', fontWeight: 600, color: C.mut, whiteSpace: 'nowrap', borderBottom: '2px solid ' + C.line };
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 660 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: C.card }}>รายการ</th>
            {months.map((m, i) => <th key={i} style={{ ...th, textAlign: 'right' }}>{m}</th>)}
            <th style={{ ...th, textAlign: 'right' }}>รวม</th>
          </tr></thead>
          <tbody>
            {rows.map((r, ri) => {
              const isLeaf = r.type === 'leaf', isSection = r.type === 'section';
              const isNet = r.type === 'net' || r.type === 'grand', isSub = r.type === 'subtotal', isGroup = r.type === 'group';
              const rowBg = isSection ? C.brandBg : (isNet ? C.netBg : 'transparent');
              const fw = (isSection || isNet || isSub) ? 700 : (isGroup ? 600 : 400);
              const indent = isSection ? 0 : (isGroup ? 14 : (isSub || isNet ? 14 : 26));
              const clickable = isLeaf || isNet || isSub;
              const stickyBg = rowBg === 'transparent' ? C.card : rowBg;
              const emptyVals = isSection || isGroup;
              return (
                <tr key={ri} style={{ background: rowBg, borderTop: (isNet || isSub) ? '1px solid ' + C.line : 'none' }}>
                  <td onClick={() => clickable && onPick && onPick(r, null)}
                    style={{ padding: '5px 8px', paddingLeft: 8 + indent, fontWeight: fw, color: isSection ? C.brand : C.ink, cursor: clickable ? 'pointer' : 'default', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: stickyBg }}>
                    {r.label}{clickable && <span style={{ color: C.faint, fontWeight: 400 }}> ›</span>}
                  </td>
                  {months.map((m, ci) => (
                    <td key={ci} onClick={() => clickable && !emptyVals && onPick && onPick(r, monthNumByIdx(ci))}
                      style={{ padding: '5px 8px', textAlign: 'right', fontWeight: (isNet || isSub) ? 700 : 400, cursor: (clickable && !emptyVals) ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
                      {emptyVals ? '' : acct(r.vals[ci])}
                    </td>
                  ))}
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{emptyVals ? '' : acct(r.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  /* ---------- drill panel ---------- */
  function CfpDrill({ model, drill, catFilter, setCatFilter }) {
    if (!drill) return <div style={{ fontSize: 13, color: C.faint }}>กดแถวในตารางงบ (หรือการ์ด/กราฟด้านบน) เพื่อดูรายการจริงจาก STM</div>;

    if (drill.type === 'stmt') {
      const res = cfpFindStmtTxns(model, drill.label, drill.actKey, drill.monthNum, drill.dir);
      const txns = res.txns.slice().sort((a, b) => (a.iso < b.iso ? 1 : -1));
      const shown = txns.slice(0, 80);
      const sum = txns.reduce((s, t) => s + t.flow, 0);
      return (
        <div>
          <div style={{ fontSize: 12, color: C.mut, marginBottom: 6 }}>
            {res.matched ? ('จับคู่หมวด STM: ' + res.cats.join(', ')) : 'จับคู่อัตโนมัติไม่ได้ — แสดงรายการทั้ง' + (CFP_ACT_NAME[drill.actKey] || 'กิจกรรม')}
            {drill.monthNum ? (' · เดือน ' + (CFP_MONTHS[drill.monthNum] || drill.monthNum)) : ''} · {txns.length} รายการ · รวม <b style={{ color: sum < 0 ? C.neg : C.pos }}>{cfpFmtB(sum)}</b>
          </div>
          {txns.length ? <CfpTxnTable txns={shown} /> : <div style={{ fontSize: 13, color: C.faint }}>ไม่พบรายการ</div>}
          {txns.length > shown.length && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>แสดง {shown.length} จาก {txns.length} รายการ</div>}
        </div>
      );
    }

    if (drill.type === 'month') {
      const d = model.monthly.find(x => x.m === drill.m); if (!d) return null;
      const rows = [['กิจกรรมดำเนินงาน', d.op], ['กิจกรรมลงทุน', d.inv], ['กิจกรรมจัดหาเงิน', d.fin]];
      const max = Math.max(...rows.map(r => Math.abs(r[1])), 1);
      return (
        <div>
          <div style={{ fontSize: 12, color: C.mut, marginBottom: 6 }}>แยกตามกิจกรรม</div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr auto', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid ' + C.line }}>
              <span style={{ fontSize: 13, color: C.ink }}>{r[0]}</span>
              <span><CfpBar amt={r[1]} max={max} /></span>
              <span style={{ fontSize: 13, fontWeight: 600, color: r[1] < 0 ? C.neg : C.pos, textAlign: 'right' }}>{cfpFmtB(r[1])}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid ' + C.line }}>
            <span style={{ fontSize: 13, color: C.mut }}>เงินสดคงเหลือปลายเดือน</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{cfpFmtB(d.end)}</span>
          </div>
        </div>
      );
    }

    const a = model.acts[drill.key]; if (!a) return null;
    const maxCat = Math.max(...a.catList.map(c => Math.abs(c.net)), 1);
    let txns = [];
    a.catList.forEach(c => { if (!catFilter || c.name === catFilter) txns = txns.concat(c.txns); });
    txns.sort((x, y) => (x.iso < y.iso ? 1 : -1));
    const shown = txns.slice(0, 60);
    return (
      <div>
        <div style={{ fontSize: 12, color: C.mut, marginBottom: 4 }}>หมวด (กดเพื่อกรอง) · รวม {model.periodLabel}</div>
        <div style={{ marginBottom: 12 }}>
          {a.catList.map((c, i) => {
            const on = catFilter === c.name;
            return (
              <div key={i} onClick={() => setCatFilter(on ? null : c.name)}
                style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', alignItems: 'center', gap: 10, padding: '5px 6px', borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: on ? C.brandBg : 'transparent', borderRadius: 6 }}>
                <span style={{ fontSize: 12.5, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{on ? '✓ ' : ''}{c.name} <span style={{ color: C.faint }}>({c.count})</span></span>
                <span><CfpBar amt={c.net} max={maxCat} /></span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: c.net < 0 ? C.neg : C.pos, textAlign: 'right', whiteSpace: 'nowrap' }}>{cfpFmtB(c.net)}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: C.mut, margin: '4px 0 6px' }}>รายการจริงจาก STM {catFilter ? ('· ' + catFilter) : ''} {txns.length > shown.length ? ('· แสดง ' + shown.length + ' จาก ' + txns.length) : ('· ' + txns.length + ' รายการ')}</div>
        <CfpTxnTable txns={shown} />
      </div>
    );
  }
  function cfpThaiDate(iso) {
    if (!iso || iso.length < 10) return iso || '';
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    return d + ' ' + (CFP_MONTHS[m] || m) + ' ' + (y + 543 - 2500);
  }

  function CfpKpi({ label, value, sub, color, onClick }) {
    return (
      <div onClick={onClick} style={{ background: C.soft, borderRadius: 10, padding: '14px 16px', cursor: onClick ? 'pointer' : 'default', border: '1px solid ' + C.line }}>
        <div style={{ fontSize: 13, color: C.mut, marginBottom: 4 }}>{label}{onClick && <span style={{ color: C.faint, fontSize: 11 }}> ›</span>}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: color || C.ink }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: C.mut, marginTop: 3 }}>{sub}</div>}
      </div>
    );
  }

  /* ---------- main page ---------- */
  function CashFlowPresentPage({ data, setData, toast }) {
    const [stored, setStored] = useState(() => { try { return JSON.parse(localStorage.getItem(CFP_LS) || 'null'); } catch (e) { return null; } });
    const [uploading, setUploading] = useState(false);
    const [drill, setDrill] = useState(null);
    const [catFilter, setCatFilter] = useState(null);
    const fileRef = useRef(null);
    const canEdit = !(window._wtpRoleIsReadOnly && window._wtpRoleIsReadOnly());

    const model = useMemo(() => {
      if (!stored || !stored.stm) return null;
      try { return cfpBuildModel(stored.stm, stored.summary); } catch (e) { console.error('[cfp] build', e); return null; }
    }, [stored]);

    function flash() { const el = document.getElementById('cfp-drill'); if (el) { el.style.boxShadow = '0 0 0 2px ' + C.brand; if (el.scrollIntoView) try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {} setTimeout(() => { el.style.boxShadow = 'none'; }, 700); } }
    function pickAct(k) { setDrill({ type: 'act', key: k }); setCatFilter(null); flash(); }
    function pickMonth(m) { setDrill({ type: 'month', m }); setCatFilter(null); flash(); }
    function pickStmt(row, monthNum) {
      if (!row.actKey) return;
      if (row.type === 'net') { setDrill({ type: 'act', key: row.actKey }); setCatFilter(null); flash(); return; }
      const dir = row.total > 0 ? 1 : row.total < 0 ? -1 : 0;
      setDrill({ type: 'stmt', label: row.label, actKey: row.actKey, monthNum: monthNum || null, dir }); flash();
    }

    async function readAoa(file) {
      return new Promise((resolve, reject) => {
        if (!window.XLSX) { reject(new Error('ไม่พบ SheetJS — รีเฟรชหน้า')); return; }
        const r = new FileReader();
        r.onload = e => { try { const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: false }); const ws = wb.Sheets[wb.SheetNames[0]]; resolve(window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })); } catch (err) { reject(err); } };
        r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
        r.readAsArrayBuffer(file);
      });
    }
    function detectKind(aoa) {
      const flat = aoa.slice(0, 12).map(r => (r || []).join(' ')).join(' ');
      if (/ประเภทกิจกรรมทางการเงิน|ยอดถอน|ยอดฝาก/.test(flat)) return 'stm';
      if (/งบกระแสเงินสด|กระแสเงินสดจากกิจกรรม/.test(flat)) return 'summary';
      return 'unknown';
    }
    async function onUpload(files) {
      setUploading(true);
      try {
        let stm = null, summary = null, sawStm = false;
        for (const f of files) {
          const aoa = await readAoa(f);
          const kind = detectKind(aoa);
          if (kind === 'stm') { stm = cfpParseStm(aoa); sawStm = true; }
          else if (kind === 'summary') { summary = cfpParseSummary(aoa); }
          else if (!sawStm) { const guess = cfpParseStm(aoa); if (guess.txns.length) { stm = guess; sawStm = true; } }
        }
        if (!stm || !stm.txns.length) {
          if (summary && stored && stored.stm) { persist({ stm: stored.stm, summary }); toast && toast('อัปเดตตารางงบสรุปแล้ว'); }
          else { toast && toast('ต้องมีไฟล์ STM (รายการเดินบัญชี)', 'error'); }
          setUploading(false); return;
        }
        persist({ stm, summary: summary || (stored && stored.summary) || null });
        toast && toast('อ่านข้อมูลสำเร็จ · ' + stm.txns.length + ' รายการ' + (summary ? ' + งบสรุป' : ''));
        setDrill(null); setCatFilter(null);
      } catch (e) { console.error(e); toast && toast('อ่านไฟล์ไม่สำเร็จ: ' + (e.message || e), 'error'); }
      setUploading(false);
    }
    function persist(obj) { const payload = Object.assign({ uploadedAt: Date.now() }, obj); try { localStorage.setItem(CFP_LS, JSON.stringify(payload)); } catch (e) { console.error('[cfp] save', e); } setStored(payload); }
    function clearData() { if (!confirm('ล้างข้อมูล Cash Flow ในเครื่องนี้?')) return; localStorage.removeItem(CFP_LS); setStored(null); setDrill(null); }

    const cardStyle = { background: C.card, border: '1px solid ' + C.line, borderRadius: 12, padding: '16px 18px', marginBottom: 18 };
    const secHdr = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 };
    const drillTitle = drill && drill.type === 'act' ? ('· ' + model.acts[drill.key].name)
      : drill && drill.type === 'month' ? ('· เดือน ' + (CFP_MONTHS[drill.m] || drill.m))
      : drill && drill.type === 'stmt' ? ('· ' + drill.label) : '';

    return (
      <div className="cfp-page" style={{ maxWidth: 1080, margin: '0 auto', color: C.ink }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '4px 0 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 36, height: 36, borderRadius: 9, background: C.brandBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🌊</span>
            <div>
              <div style={{ fontSize: 19, fontWeight: 700 }}>งบกระแสเงินสด · BIOAXEL</div>
              <div style={{ fontSize: 13, color: C.mut }}>{model ? ('งวด ' + model.periodLabel + ' · ' + model.txnCount + ' รายการ · ' + model.accounts.length + ' บัญชี') : 'อัปโหลดไฟล์เพื่อเริ่ม'}</div>
            </div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}
                style={{ background: C.brand, color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {uploading ? '⏳ กำลังอ่าน…' : (model ? '⬆️ อัปเดตไฟล์' : '⬆️ อัปโหลด STM + งบสรุป')}
              </button>
              {model && <button onClick={clearData} style={{ background: '#fff', color: C.mut, border: '1px solid ' + C.line, borderRadius: 8, padding: '9px 12px', fontSize: 14, cursor: 'pointer' }}>ล้าง</button>}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{ display: 'none' }}
                onChange={e => { if (e.target.files.length) onUpload(Array.from(e.target.files)); e.target.value = ''; }} />
            </div>
          )}
        </div>

        {!model && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: '46px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🌊</div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>ยังไม่มีข้อมูล</div>
            <div style={{ fontSize: 14, color: C.mut, maxWidth: 480, margin: '0 auto 18px', lineHeight: 1.6 }}>
              อัปโหลด <b>2 ไฟล์</b>: <b>STM</b> (รายการเดินบัญชี — ใช้ drill-down) + <b>งบกระแสเงินสดรายเดือน</b> (สรุป — แสดงเป็นตารางงบ). เลือกพร้อมกันได้
            </div>
            {canEdit
              ? <button onClick={() => fileRef.current && fileRef.current.click()} style={{ background: C.brand, color: '#fff', border: 0, borderRadius: 8, padding: '11px 22px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>เลือกไฟล์…</button>
              : <div style={{ fontSize: 13, color: C.faint }}>บัญชีนี้ดูได้อย่างเดียว — ให้ผู้ดูแลอัปโหลดไฟล์</div>}
          </div>
        )}

        {model && <React.Fragment>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 18 }}>
            <CfpKpi label="เงินสดปลายงวด" value={cfpFmtM(model.ending)} color={C.ink} sub={(model.net >= 0 ? '▲ ' : '▼ ') + cfpFmtSigned(model.net) + ' จากต้นงวด'} />
            <CfpKpi label="ดำเนินงาน" value={cfpFmtM(model.acts.op.net)} color={model.acts.op.net < 0 ? C.neg : C.pos} onClick={() => pickAct('op')} sub="กดดูรายการ" />
            <CfpKpi label="ลงทุน" value={cfpFmtM(model.acts.inv.net)} color={model.acts.inv.net < 0 ? C.neg : C.pos} onClick={() => pickAct('inv')} sub="กดดูรายการ" />
            <CfpKpi label="จัดหาเงิน" value={cfpFmtM(model.acts.fin.net)} color={model.acts.fin.net < 0 ? C.neg : C.pos} onClick={() => pickAct('fin')} sub="กดดูรายการ" />
          </div>

          {model.summary && model.summary.net != null && (
            <div style={{ fontSize: 12.5, color: Math.abs(model.summary.net - model.net) < 1 ? C.pos : C.amber, marginBottom: 14, padding: '8px 12px', background: C.soft, borderRadius: 8, border: '1px solid ' + C.line }}>
              {Math.abs(model.summary.net - model.net) < 1 ? '✓ STM ตรงกับงบสรุป: สุทธิ ' + cfpFmtB(model.net) : '⚠ STM สุทธิ ' + cfpFmtB(model.net) + ' · งบสรุป ' + cfpFmtB(model.summary.net)}
            </div>
          )}

          {/* statement table (the user's cashflow) */}
          <div style={cardStyle}>
            <div style={secHdr}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>งบกระแสเงินสด (รายเดือน)</div>
              <div style={{ fontSize: 12, color: C.faint }}>กดแถว/ช่อง → ดูรายการจริงจาก STM</div>
            </div>
            <CfpStatementTable model={model} onPick={pickStmt} />
          </div>

          {/* drill */}
          <div id="cfp-drill" style={{ ...cardStyle, transition: 'box-shadow .25s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🔍 รายละเอียด (STM) {drillTitle}</div>
              {drill && <button onClick={() => { setDrill(null); setCatFilter(null); }} style={{ background: 'transparent', border: '1px solid ' + C.line, borderRadius: 7, padding: '4px 10px', fontSize: 12, color: C.mut, cursor: 'pointer', flexShrink: 0 }}>ปิด</button>}
            </div>
            <CfpDrill model={model} drill={drill} catFilter={catFilter} setCatFilter={setCatFilter} />
          </div>

          {/* waterfall */}
          <div style={cardStyle}>
            <div style={secHdr}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>เงินสดเดินทางอย่างไร</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: C.mut }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.pos, marginRight: 4, verticalAlign: 'middle' }} />เพิ่ม</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.neg, marginRight: 4, verticalAlign: 'middle' }} />ลด</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.gray, marginRight: 4, verticalAlign: 'middle' }} />ยอดรวม</span>
              </div>
            </div>
            <CfpWaterfall model={model} onPick={pickAct} />
          </div>

          {/* monthly */}
          <div style={cardStyle}>
            <div style={secHdr}><div style={{ fontSize: 16, fontWeight: 600 }}>กระแสเงินสดรายเดือน</div><div style={{ fontSize: 12, color: C.faint }}>กดแท่งเพื่อแยกกิจกรรม</div></div>
            <CfpMonthly model={model} onPick={pickMonth} />
          </div>

          {/* insights */}
          <div style={{ fontSize: 13, color: C.mut, margin: '0 2px 10px' }}>จุดที่ควรจับตา</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginBottom: 18 }}>
            {model.acts.fin.net > 0 && model.acts.op.net < 0 && (
              <div style={cardStyle}><div style={{ fontSize: 20, marginBottom: 4 }}>🔁</div><div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>อยู่ได้ด้วยการจัดหาเงิน</div><div style={{ fontSize: 13, color: C.mut, lineHeight: 1.5 }}>ดำเนินงานสุทธิ {cfpFmtM(model.acts.op.net)} แต่จัดหาเงินหนุน {cfpFmtSigned(model.acts.fin.net)}</div></div>
            )}
            {model.interest > 0 && (
              <div style={cardStyle}><div style={{ fontSize: 20, marginBottom: 4 }}>％</div><div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>ดอกเบี้ยจ่าย {cfpFmtM(model.interest)}</div><div style={{ fontSize: 13, color: C.mut, lineHeight: 1.5 }}>{model.payroll > 0 ? ('≈ ' + Math.round(model.interest / model.payroll * 100) + '% ของเงินเดือนทั้งบริษัท (' + cfpFmtM(model.payroll) + ')') : 'ภาระดอกเบี้ยรวมทั้งงวด'}</div></div>
            )}
            {model.topInflow.amt > 0 && model.inflowTotal > 0 && (
              <div style={cardStyle}><div style={{ fontSize: 20, marginBottom: 4 }}>📦</div><div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>รายได้กระจุกตัว</div><div style={{ fontSize: 13, color: C.mut, lineHeight: 1.5 }}>{Math.round(model.topInflow.amt / model.inflowTotal * 100)}% จาก “{model.topInflow.name.replace(/^เงินสดรับจากการขาย-?/, '')}” ({cfpFmtM(model.topInflow.amt)})</div></div>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: C.faint, margin: '4px 2px 24px' }}>ตารางงบ = ไฟล์ “งบกระแสเงินสดรายเดือน” · รายละเอียด = ไฟล์ STM · เก็บในเครื่องนี้ (ยังไม่ sync ทีม) · อัปเดต {stored && stored.uploadedAt ? new Date(stored.uploadedAt).toLocaleString('th-TH') : '-'}</div>
        </React.Fragment>}
      </div>
    );
  }

  window.CashFlowPresentPage = CashFlowPresentPage;
})();
