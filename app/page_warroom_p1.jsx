// War Room — Page 1: Revenue Collection & Receivables Overview
// Sections 01–03 use live data: data.receipts + data.invoices
// Section 04 uses pre-computed sheet data (WIP construction)
// Globals: React, KpiTile, AnimatedNumber, Badge, Icon, fmtNum, fmtMoney, fmtDate

const { useMemo: wr1Memo, useState: wr1State } = React;

function WarRoomPage1({ data, setData, toast }) {
  const { warroomP1, meta } = data;
  const [ivTypeFilter, setIvTypeFilter] = wr1State('P'); // 'all' | 'P' | 'O' — default 'P' (โครงการ)
  const [drillModal, setDrillModal]     = wr1State(null);  // { kind: 'month'|'week', title, items }
  const wrInvType = iv => ((iv.invType || iv.invtype || 'P').toString().trim().toUpperCase() === 'O' ? 'O' : 'P');
  const matchType = iv => ivTypeFilter === 'all' || wrInvType(iv) === ivTypeFilter;

  // ── Finance lookup for debt enrichment ──────────────────────────────────────
  const { financeByCode } = wr1Memo(() => WTPData.buildLookups(data), [data.projects, data.debtLedger]);

  const liveToday     = new Date().toISOString().slice(0, 10);
  const liveYear      = liveToday.slice(0, 4);
  const liveThisMonth = liveToday.slice(0, 7);

  const liveMonthName = wr1Memo(() =>
    new Date(liveThisMonth + '-01T12:00:00').toLocaleDateString('th-TH-u-ca-gregory', { month: 'long', year: 'numeric' }),
    [liveThisMonth]
  );

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 01 — YTD จาก data.receipts (ประวัติรับเงิน)
  // ════════════════════════════════════════════════════════════════════════════
  // build map invoiceNo → invType (for filtering receipts by their source invoice)
  const ivTypeByInvNo = wr1Memo(() => {
    const m = {};
    (data.invoices || []).forEach(iv => { if (iv.ivNo) m[iv.ivNo] = wrInvType(iv); });
    return m;
  }, [data.invoices]);

  // helper: resolve invType for a receipt — own field overrides invoice lookup
  const receiptInvType = r => {
    const own = (r.invType || '').toString().trim().toUpperCase();
    if (own === 'O' || own === 'P') return own;
    return ivTypeByInvNo[r.invoiceNo] || 'P';
  };

  const liveYtd = wr1Memo(() => {
    const map = {};
    (data.receipts || []).forEach(r => {
      const m = r.receiptDate ? r.receiptDate.slice(0, 7) : null;
      if (!m || !m.startsWith(liveYear)) return;
      if (ivTypeFilter !== 'all') {
        if (receiptInvType(r) !== ivTypeFilter) return;
      }
      (map[m] = map[m] || []).push(r);
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, recs]) => {
        const d = new Date(m + '-01T12:00:00');
        return {
          monthKey: m,                                                   // YYYY-MM
          month:    d.toLocaleDateString('th-TH-u-ca-gregory', { month: 'long' }),
          en:       d.toLocaleString('en-US', { month: 'short' }),
          count:    recs.length,
          gross:    recs.reduce((s, r) => s + (Number(r.grossAmount)         || 0), 0),
          debt:     recs.reduce((s, r) => s + (Number(r.transferDeduction)   || 0), 0),
          net:      recs.reduce((s, r) => s + (Number(r.netReceived)         || 0), 0),
          recs,                                                          // keep list for drill-down
        };
      });
  }, [data.receipts, liveYear, ivTypeFilter, ivTypeByInvNo]);

  const liveYtdTotal = wr1Memo(() => liveYtd.reduce((acc, m) => ({
    count: acc.count + m.count,
    gross: acc.gross + m.gross,
    debt:  acc.debt  + m.debt,
    net:   acc.net   + m.net,
  }), { count: 0, gross: 0, debt: 0, net: 0 }), [liveYtd]);

  // ════════════════════════════════════════════════════════════════════════════
  // OUTSTANDING ROWS — base for Section 02 & 03
  // ════════════════════════════════════════════════════════════════════════════
  const WR_ALIAS = { pending: 'tracking', '': 'pending_inspection' };
  const WR_VALID = new Set(['pending_inspection', 'tracking', 'issue', 'paid']);

  const liveOuts = wr1Memo(() => (data.invoices || []).flatMap(iv => {
    if (!matchType(iv)) return [];
    const rawStatus = (iv.status || '').toString().trim();
    const aliased   = WR_ALIAS[rawStatus] != null ? WR_ALIAS[rawStatus] : rawStatus;
    const status    = WR_VALID.has(aliased) ? aliased : 'pending_inspection';
    if (status === 'paid') return [];
    const s  = (iv.jobNo || '').trim();
    const mx = s.match(/^(.+)-([A-Z]{2,6})$/);
    const cj = mx ? mx[1] : s;
    const f        = financeByCode[cj] || financeByCode[iv.contractRef] || {};
    const balance  = Number(iv.balance) || 0;
    // ใช้ resolveDebt/resolveAssignee → respect admin override บน IV
    const debt     = (window.resolveDebt     ? window.resolveDebt(iv, f)     : Number(f.debt ?? f['ภาระหนี้'] ?? 0));
    const assignee = (window.resolveAssignee ? window.resolveAssignee(iv, f) : (f.assignee || f['ผู้รับโอนสิทธิ์'] || ''));
    return [{ ...iv, jobNo: cj, status, invType: wrInvType(iv), debt, balance, netExpected: balance - debt, assignee }];
  }), [data.invoices, financeByCode, ivTypeFilter]);

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 02 — คาดการณ์รับเดือนปัจจุบัน (expectedReceive เดือนนี้)
  // ════════════════════════════════════════════════════════════════════════════
  const thisMthIvs = wr1Memo(() =>
    liveOuts.filter(iv => iv.expectedReceive && iv.expectedReceive.startsWith(liveThisMonth)),
    [liveOuts, liveThisMonth]
  );

  // จัดกลุ่มตามสัปดาห์ภายในเดือน: สัปดาห์ 1=วันที่ 1-7, 2=8-14, 3=15-21, 4=22-28, 5=29+
  const thisMthByWeek = wr1Memo(() => {
    const weeks = [1,2,3,4,5].map(w => ({ week: w, count: 0, gross: 0, debt: 0, net: 0, ivs: [] }));
    thisMthIvs.forEach(iv => {
      const day  = parseInt((iv.expectedReceive || '').slice(8, 10), 10) || 1;
      const wIdx = Math.min(Math.ceil(day / 7), 5) - 1;
      weeks[wIdx].count++;
      weeks[wIdx].gross += iv.balance;
      weeks[wIdx].debt  += iv.debt;
      weeks[wIdx].net   += iv.netExpected;
      weeks[wIdx].ivs.push(iv);
    });
    return weeks;
  }, [thisMthIvs]);

  const thisMthTotal = wr1Memo(() => thisMthByWeek.reduce((acc, w) => ({
    count: acc.count + w.count,
    gross: acc.gross + w.gross,
    debt:  acc.debt  + w.debt,
    net:   acc.net   + w.net,
  }), { count: 0, gross: 0, debt: 0, net: 0 }), [thisMthByWeek]);

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 03 — ใบแจ้งหนี้คงค้างนอกเดือนปัจจุบัน (คาดรับเดือนถัดไป)
  // ════════════════════════════════════════════════════════════════════════════
  const nextMthIvs = wr1Memo(() =>
    liveOuts.filter(iv => !iv.expectedReceive || !iv.expectedReceive.startsWith(liveThisMonth)),
    [liveOuts, liveThisMonth]
  );

  // แยกตามโอนสิทธิ์ (infer จาก assignee)
  const nextMthByTransfer = wr1Memo(() => {
    const m = {
      'ไม่โอนสิทธิรับเงิน': { count: 0, gross: 0, debt: 0, net: 0 },
      'โอนสิทธิรับเงิน':    { count: 0, gross: 0, debt: 0, net: 0 },
    };
    nextMthIvs.forEach(iv => {
      const k = (iv.assignee && iv.assignee !== '—') ? 'โอนสิทธิรับเงิน' : 'ไม่โอนสิทธิรับเงิน';
      m[k].count++;
      m[k].gross += iv.balance;
      m[k].debt  += iv.debt;
      m[k].net   += iv.netExpected;
    });
    return Object.entries(m).map(([type, v]) => ({ type, ...v }));
  }, [nextMthIvs]);

  const outstandingAll = wr1Memo(() => ({
    count: liveOuts.length,
    gross: liveOuts.reduce((s, iv) => s + iv.balance, 0),
    debt:  liveOuts.reduce((s, iv) => s + iv.debt,    0),
    net:   liveOuts.reduce((s, iv) => s + iv.netExpected, 0),
  }), [liveOuts]);

  const nextMthTotal = wr1Memo(() => ({
    count: nextMthIvs.length,
    gross: nextMthIvs.reduce((s, iv) => s + iv.balance, 0),
    debt:  nextMthIvs.reduce((s, iv) => s + iv.debt,    0),
    net:   nextMthIvs.reduce((s, iv) => s + iv.netExpected, 0),
  }), [nextMthIvs]);

  return (
    <div className="page bg-pattern present-page wr-page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">Revenue Collection & Receivables Overview</h1>
          <div className="page-sub">การเงินด้านรับ · {meta.companyName} · ข้อมูล ณ {fmtDate(liveToday)}</div>
        </div>
        <div className="page-head-r">
          <a className="btn btn-ghost" href="#warroom2"><Icon name="arrow" size={14} /> หน้าถัดไป · ประมาณการรายปี</a>
          <button className="btn btn-ghost no-present"><Icon name="download" size={14} /> ส่งออก PDF</button>
        </div>
      </div>

      {/* invType filter toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }} className="anim-in">
        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>กรองประเภทใบแจ้งหนี้:</span>
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

      {/* SECTION 01 — Annual YTD (from data.receipts) */}
      <SectionCard num="01" title="รายรับสะสมประจำปี" subtitle={`Annual YTD · เงินรับสะสมจากชีทประวัติรับเงิน · ปี ${liveYear}`} totalLabel="Total YTD" total={liveYtdTotal.net}>
        <table className="tbl">
          <thead>
            <tr>
              <th>เดือน (Month)</th>
              <th style={{ width: 90, textAlign: 'center' }}>จำนวน</th>
              <th style={{ textAlign: 'right' }}>รายรับรวม (GROSS)</th>
              <th style={{ textAlign: 'right' }}>หักโอนสิทธิ์ (Deduct)</th>
              <th style={{ textAlign: 'right' }}>เงินเข้าจริง (NET)</th>
            </tr>
          </thead>
          <tbody>
            {liveYtd.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--ink-400)' }}>ไม่มีข้อมูลใบรับเงินในปีนี้</td></tr>
            )}
            {liveYtd.map((m, i) => {
              const isThis = m.monthKey === liveThisMonth;
              return (
                <tr key={i} onClick={() => setDrillModal({ kind: 'month', monthKey: m.monthKey, title: `รายรับเดือน${m.month} (${m.en})` })}
                  style={{ cursor: 'pointer', background: isThis ? 'color-mix(in oklch,var(--brand-500) 5%,transparent)' : '' }}
                  title="คลิกดูรายละเอียดทุกใบรับเงิน">
                  <td>
                    <span style={{ fontWeight: isThis ? 700 : 600 }}>{m.month}</span>
                    <span className="muted" style={{ fontSize: 11.5, marginLeft: 6, fontWeight: 400 }}>({m.en})</span>
                    {isThis && <Badge kind="b-blue" dot={false} style={{ marginLeft: 8 }}>เดือนนี้</Badge>}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ marginLeft: 8, opacity: .35 }}>
                      <polyline points="9 6 15 12 9 18"/>
                    </svg>
                  </td>
                  <td style={{ textAlign: 'center' }}>{m.count}</td>
                  <td className="num">{fmtNum(m.gross, 2)}</td>
                  <td className="num" style={{ color: m.debt ? 'var(--bad)' : 'var(--ink-400)' }}>
                    {m.debt ? '(' + fmtNum(m.debt, 2) + ')' : '-'}
                  </td>
                  <td className="num strong">{fmtNum(m.net, 2)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total YTD</td>
              <td style={{ textAlign: 'center' }}>{liveYtdTotal.count}</td>
              <td className="num">{fmtNum(liveYtdTotal.gross, 2)}</td>
              <td className="num" style={{ color: 'var(--bad)' }}>({fmtNum(liveYtdTotal.debt, 2)})</td>
              <td className="num">{fmtNum(liveYtdTotal.net, 2)}</td>
            </tr>
          </tfoot>
        </table>
      </SectionCard>

      {/* ── Combined this-month callout: รับแล้ว + คาดรับเพิ่ม = รวมเดือนนี้ (GROSS ใหญ่ + NET เล็กข้างล่าง) ── */}
      {(() => {
        const paidThisMonth = liveYtd.find(m => m.monthKey === liveThisMonth);
        const paidGross = paidThisMonth ? paidThisMonth.gross : 0;
        const paidNet   = paidThisMonth ? paidThisMonth.net   : 0;
        const paidCnt   = paidThisMonth ? paidThisMonth.count : 0;
        const fcGross   = thisMthTotal.gross;
        const fcNet     = thisMthTotal.net;
        const fcCnt     = thisMthTotal.count;
        const sumGross  = paidGross + fcGross;
        const sumNet    = paidNet   + fcNet;
        return (
          <div className="card anim-in" style={{
            marginBottom: 18, padding: 0, overflow: 'hidden',
            background: 'linear-gradient(135deg, oklch(96% 0.04 200), oklch(98% 0.02 240))',
            border: '1.5px solid color-mix(in oklch, var(--brand-500) 30%, transparent)',
          }}>
            <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: '1fr 24px 1fr 24px 1.2fr', alignItems: 'center', gap: 8 }}>
              {/* รับแล้ว */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)', fontWeight: 600, marginBottom: 4 }}>
                  ✓ รับแล้ว · {liveMonthName}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#276749', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                  <AnimatedNumber value={paidGross} digits={2} /> <span style={{ fontSize: 12, color: 'var(--ink-500)', fontWeight: 500 }}>บาท</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                  สุทธิ <strong style={{ color: '#276749' }}>{fmtNum(paidNet, 2)}</strong>
                  <span style={{ marginLeft: 6, color: 'var(--ink-400)' }}>· {paidCnt} ใบ</span>
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: 22, color: 'var(--ink-400)', fontWeight: 300 }}>+</div>
              {/* คาดรับเพิ่ม */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-500)', fontWeight: 600, marginBottom: 4 }}>
                  ⏳ คาดรับเพิ่ม · ที่เหลือในเดือนนี้
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'oklch(60% 0.16 75)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                  <AnimatedNumber value={fcGross} digits={2} /> <span style={{ fontSize: 12, color: 'var(--ink-500)', fontWeight: 500 }}>บาท</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                  สุทธิ <strong style={{ color: 'oklch(55% 0.16 75)' }}>{fmtNum(fcNet, 2)}</strong>
                  <span style={{ marginLeft: 6, color: 'var(--ink-400)' }}>· {fcCnt} ใบ</span>
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: 22, color: 'var(--ink-400)', fontWeight: 300 }}>=</div>
              {/* รวมเดือนนี้ */}
              <div style={{
                background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))',
                borderRadius: 12, padding: '10px 16px', color: 'white',
              }}>
                <div style={{ fontSize: 11, opacity: 0.9, fontWeight: 600, marginBottom: 4 }}>
                  💰 ประมาณการรับรวม · {liveMonthName}
                </div>
                <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em', lineHeight: 1.1 }}>
                  <AnimatedNumber value={sumGross} digits={2} /> <span style={{ fontSize: 13, opacity: 0.85, fontWeight: 500 }}>บาท</span>
                </div>
                <div style={{ fontSize: 11.5, opacity: 0.92, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  สุทธิ <strong>{fmtNum(sumNet, 2)}</strong>
                  <span style={{ marginLeft: 6, opacity: 0.8 }}>· {paidCnt + fcCnt} ใบรวม</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SECTION 02 — This-month forecast (from data.invoices, expectedReceive = this month) */}
      <SectionCard num="02" title="คาดการณ์ได้รับเพิ่มในเดือนปัจจุบัน" subtitle={`รายสัปดาห์ · ${liveMonthName} · จากการติดตาม IV ที่ระบุวันคาดรับไว้ในเดือนนี้`} totalLabel="คาดการณ์ยอดรับสุทธิในเดือนนี้" total={thisMthTotal.net}>
        <table className="tbl">
          <thead>
            <tr>
              <th>ช่วงเวลา (PERIOD)</th>
              <th style={{ width: 90, textAlign: 'center' }}>จำนวน</th>
              <th style={{ textAlign: 'right' }}>รายรับรวม (GROSS)</th>
              <th style={{ textAlign: 'right' }}>หักภาระหนี้ (Debt)</th>
              <th style={{ textAlign: 'right' }}>คงเหลือสุทธิ (NET)</th>
            </tr>
          </thead>
          <tbody>
            {thisMthTotal.count === 0 && (
              <tr><td colSpan={5} style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--ink-400)' }}>ไม่มีใบแจ้งหนี้ที่ระบุวันคาดรับในเดือนนี้</td></tr>
            )}
            {thisMthTotal.count > 0 && thisMthByWeek.map((w, i) => {
              const clickable = w.count > 0;
              const range = ['1–7','8–14','15–21','22–28','29+'][i];
              return (
                <tr key={i}
                  onClick={() => clickable && setDrillModal({ kind: 'week', weekIdx: i, title: `สัปดาห์ที่ ${w.week} (${range}) · ${liveMonthName}` })}
                  style={{ cursor: clickable ? 'pointer' : 'default' }}
                  title={clickable ? 'คลิกดู IV ทั้งหมดในสัปดาห์นี้' : ''}>
                  <td>
                    สัปดาห์ที่ {w.week} <span className="muted" style={{ fontSize: 11 }}>({range})</span>
                    {clickable && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ marginLeft: 8, opacity: .35 }}>
                        <polyline points="9 6 15 12 9 18"/>
                      </svg>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{w.count}</td>
                  <td className="num">{w.gross ? fmtNum(w.gross, 2) : <span className="muted">-</span>}</td>
                  <td className="num" style={{ color: w.debt ? 'var(--bad)' : 'var(--ink-400)' }}>
                    {w.debt ? '(' + fmtNum(w.debt, 2) + ')' : '-'}
                  </td>
                  <td className="num strong">{w.net ? fmtNum(w.net, 2) : <span className="muted">-</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td style={{ textAlign: 'center' }}>{thisMthTotal.count}</td>
              <td className="num">{fmtNum(thisMthTotal.gross, 2)}</td>
              <td className="num" style={{ color: 'var(--bad)' }}>({fmtNum(thisMthTotal.debt, 2)})</td>
              <td className="num">{fmtNum(thisMthTotal.net, 2)}</td>
            </tr>
          </tfoot>
        </table>
      </SectionCard>

      {/* SECTION 03 — Outstanding (NOT this month → roll to next month) */}
      <SectionCard num="03" title="ประมาณการรับเงินจากใบแจ้งหนี้คงค้าง" subtitle="IV ที่ยังไม่ได้รับเงิน และวันคาดรับอยู่นอกเดือนปัจจุบัน → คาดรับเดือนถัดไปขึ้นไป" totalLabel="คาดการณ์รับในเดือนถัดไป" total={nextMthTotal.net}>
        {/* Summary breakdown */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0, padding: '12px 18px', borderBottom: '1px dashed var(--line)', background: 'linear-gradient(180deg, var(--ink-50), white)' }}>
          <OutstandingMiniStat
            label="ใบแจ้งหนี้คงค้างทั้งหมด"
            count={outstandingAll.count}
            net={outstandingAll.net}
            accent="var(--ink-700)"
            anchor="left"
            hint="รวมทุกใบที่ยังไม่ได้รับเงิน"
          />
          <OutstandingMiniStat
            label="คาดรับเดือนถัดไป"
            count={nextMthTotal.count}
            net={nextMthTotal.net}
            accent="oklch(60% 0.16 75)"
            anchor="right"
            hint="ตารางด้านล่าง · แยกตามโอนสิทธิ์"
            highlight
          />
        </div>

        {/* By transfer type */}
        <table className="tbl">
          <thead>
            <tr>
              <th>ประเภทการโอนสิทธิ์</th>
              <th style={{ width: 90, textAlign: 'center' }}>จำนวน</th>
              <th style={{ textAlign: 'right' }}>รายรับรวม (GROSS)</th>
              <th style={{ textAlign: 'right' }}>หักภาระหนี้ (Debt)</th>
              <th style={{ textAlign: 'right' }}>คงเหลือสุทธิ (NET)</th>
            </tr>
          </thead>
          <tbody>
            {nextMthByTransfer.map((t, i) => (
              <tr key={i}>
                <td><Badge kind={t.type.startsWith('โอน') ? 'b-amber' : 'b-blue'} dot={false}>{t.type}</Badge></td>
                <td style={{ textAlign: 'center' }}>{t.count}</td>
                <td className="num">{t.gross ? fmtNum(t.gross, 2) : <span className="muted">-</span>}</td>
                <td className="num" style={{ color: t.debt ? 'var(--bad)' : 'var(--ink-400)' }}>
                  {t.debt ? '(' + fmtNum(t.debt, 2) + ')' : '-'}
                </td>
                <td className="num strong">{fmtNum(t.net, 2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total · คาดรับเดือนถัดไป</td>
              <td style={{ textAlign: 'center' }}>{nextMthTotal.count}</td>
              <td className="num">{fmtNum(nextMthTotal.gross, 2)}</td>
              <td className="num" style={{ color: 'var(--bad)' }}>({fmtNum(nextMthTotal.debt, 2)})</td>
              <td className="num">{fmtNum(nextMthTotal.net, 2)}</td>
            </tr>
          </tfoot>
        </table>
      </SectionCard>

      {/* SECTION 04 — WIP construction (pre-computed from sheet — ยังไม่ส่งมอบ ไม่มีใน data.invoices) */}
      <SectionCard num="04" title="งานที่อยู่ระหว่างดำเนินการก่อสร้าง" subtitle="ยังไม่ส่งมอบงาน และยังไม่เปิดใบแจ้งหนี้" totalLabel="คาดการณ์รับสุทธิงานก่อสร้างทั้งหมด" total={warroomP1.wipTotal.net}>
        <table className="tbl">
          <thead>
            <tr>
              <th>ประเภทการโอนสิทธิ์</th>
              <th style={{ width: 90, textAlign: 'center' }}>จำนวน</th>
              <th style={{ textAlign: 'right' }}>รายรับรวม (GROSS)</th>
              <th style={{ textAlign: 'right' }}>หักภาระหนี้ (Debt)</th>
              <th style={{ textAlign: 'right' }}>คงเหลือสุทธิ (NET)</th>
            </tr>
          </thead>
          <tbody>
            {warroomP1.wipByTransfer.map((t, i) => (
              <tr key={i}>
                <td>
                  <Badge kind={t.type.startsWith('โอน') ? 'b-amber' : 'b-blue'} dot={false}>{t.type}</Badge>
                </td>
                <td style={{ textAlign: 'center' }}>{t.count}</td>
                <td className="num">{fmtNum(t.gross, 2)}</td>
                <td className="num" style={{ color: t.debt ? 'var(--bad)' : 'var(--ink-400)' }}>{t.debt ? '(' + fmtNum(Math.abs(t.debt), 2) + ')' : '-'}</td>
                <td className="num strong">{fmtNum(t.net, 2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td style={{ textAlign: 'center' }}>{warroomP1.wipTotal.count}</td>
              <td className="num">{fmtNum(warroomP1.wipTotal.gross, 2)}</td>
              <td className="num" style={{ color: 'var(--bad)' }}>({fmtNum(Math.abs(warroomP1.wipTotal.debt), 2)})</td>
              <td className="num">{fmtNum(warroomP1.wipTotal.net, 2)}</td>
            </tr>
          </tfoot>
        </table>
      </SectionCard>

      {/* Drill-down modal */}
      {drillModal && (
        <WarroomDrillModal
          drill={drillModal}
          data={data}
          setData={setData}
          toast={toast}
          thisMthByWeek={thisMthByWeek}
          liveMonthName={liveMonthName}
          ivTypeFilter={ivTypeFilter}
          receiptInvType={receiptInvType}
          onClose={() => setDrillModal(null)}
        />
      )}

    </div>
  );
}

/* ── Warroom drill-down modal — month receipts (editable) OR week forecast ── */
function WarroomDrillModal({ drill, data, setData, toast, thisMthByWeek, liveMonthName, ivTypeFilter, receiptInvType, onClose }) {
  const { kind, title, monthKey, weekIdx } = drill;
  const isMonth = kind === 'month';
  const [savedFlash, setSavedFlash] = React.useState(null); // receiptKey ที่เพิ่งบันทึก

  // ── derive live items based on drill kind ──
  const items = wr1Memo(() => {
    if (isMonth) {
      return (data.receipts || []).filter(r => {
        if (!r.receiptDate || !r.receiptDate.startsWith(monthKey)) return false;
        if (ivTypeFilter !== 'all' && receiptInvType(r) !== ivTypeFilter) return false;
        return true;
      });
    }
    // week kind
    return (thisMthByWeek[weekIdx] && thisMthByWeek[weekIdx].ivs) || [];
  }, [data.receipts, monthKey, ivTypeFilter, thisMthByWeek, weekIdx, isMonth]);

  // totals computed from live items
  const totals = wr1Memo(() => {
    if (isMonth) {
      return items.reduce((acc, r) => ({
        count: acc.count + 1,
        gross: acc.gross + (Number(r.grossAmount)       || 0),
        debt:  acc.debt  + (Number(r.transferDeduction) || 0),
        net:   acc.net   + (Number(r.netReceived)       || 0),
      }), { count: 0, gross: 0, debt: 0, net: 0 });
    }
    return items.reduce((acc, iv) => ({
      count: acc.count + 1,
      gross: acc.gross + (Number(iv.balance)     || 0),
      debt:  acc.debt  + (Number(iv.debt)        || 0),
      net:   acc.net   + (Number(iv.netExpected) || 0),
    }), { count: 0, gross: 0, debt: 0, net: 0 });
  }, [items, isMonth]);

  // ── update receipt field + auto-recalc netReceived ──
  // match by id ก่อน, fallback ด้วย receiptNo (กรณี id ว่าง — โหลดจากชีตที่ไม่มี id column)
  const rcKey = (r) => r.id || r.receiptNo;
  const updateReceipt = (key, patch) => {
    let updatedData;
    setData(d => {
      updatedData = {
        ...d,
        receipts: (d.receipts || []).map(r => {
          if (rcKey(r) !== key) return r;
          const merged = { ...r, ...patch };
          if (patch.grossAmount != null || patch.transferDeduction != null) {
            merged.netReceived = (Number(merged.grossAmount) || 0) - (Number(merged.transferDeduction) || 0);
          }
          return merged;
        }),
      };
      return updatedData;
    });
    // visual feedback: flash row with green check for 1.4s
    setSavedFlash(key);
    setTimeout(() => setSavedFlash(curr => curr === key ? null : curr), 1400);
    if (toast) {
      const what = patch.invType != null ? `ประเภท IV → ${patch.invType}` : 'หักโอนสิทธิ์';
      toast('✓ บันทึก ' + what);
    }
    // Persist + push immediately with the fresh data (don't trust localStorage race)
    if (updatedData) {
      try { WTPData.save(updatedData); } catch (_) {}
      if (WTPData.forceSyncNow) {
        setTimeout(() => WTPData.forceSyncNow(updatedData), 0);
      }
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ maxWidth: isMonth ? 1080 : 980, width: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div>
            <div className="modal-title" style={{ fontSize: 16 }}>{title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 2 }}>
              {totals.count} {isMonth ? 'ใบรับ' : 'ใบแจ้งหนี้'} · Gross {fmtNum(totals.gross, 2)} ฿ · NET <strong>{fmtNum(totals.net, 2)}</strong> ฿
              {isMonth && <span style={{ marginLeft: 8, color: 'var(--brand-600)', fontStyle: 'italic' }}>· คลิกที่หักสิทธิ์/ประเภท เพื่อแก้ไข</span>}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: 0 }}>
          <table className="tbl tbl-compact">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              {isMonth ? (
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th style={{ width: 88 }}>วันที่รับ</th>
                  <th style={{ width: 96 }}>เลขรับเงิน</th>
                  <th style={{ width: 96 }}>เลข IV</th>
                  <th>โครงการ</th>
                  <th style={{ width: 46, textAlign: 'center' }}>งวด</th>
                  <th style={{ textAlign: 'right', width: 108 }}>GROSS</th>
                  <th style={{ textAlign: 'right', width: 118 }}>หักสิทธิ์ ✏️</th>
                  <th style={{ textAlign: 'right', width: 108 }}>NET</th>
                  <th style={{ width: 72, textAlign: 'center' }}>ประเภท ✏️</th>
                </tr>
              ) : (
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th style={{ width: 75 }}>Job</th>
                  <th style={{ width: 95 }}>เลข IV</th>
                  <th>โครงการ</th>
                  <th style={{ width: 92, textAlign: 'center' }}>วันคาดรับ</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Balance</th>
                  <th style={{ textAlign: 'right', width: 100 }}>ภาระหนี้</th>
                  <th style={{ textAlign: 'right', width: 110 }}>คาดรับสุทธิ</th>
                  <th style={{ width: 90, textAlign: 'center' }}>สถานะ</th>
                </tr>
              )}
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={isMonth ? 10 : 9} style={{ padding: 36, textAlign: 'center', color: 'var(--ink-400)' }}>ไม่มีข้อมูล</td></tr>
              )}
              {isMonth && items.map((r, i) => {
                const t       = receiptInvType(r);
                const justSaved = savedFlash === rcKey(r);
                return (
                  <tr key={rcKey(r) || i}
                    style={justSaved ? { background: 'color-mix(in oklch, var(--good) 14%, transparent)', transition: 'background .3s' } : { transition: 'background .3s' }}>
                    <td>
                      {i + 1}
                      {justSaved && <span style={{ marginLeft: 4, color: 'var(--good)', fontWeight: 800, fontSize: 13 }}>✓</span>}
                    </td>
                    <td>{fmtDate(r.receiptDate)}</td>
                    <td><span style={{ fontFamily: 'ui-monospace', fontWeight: 600, fontSize: 11.5 }}>{r.receiptNo}</span></td>
                    <td><span style={{ fontFamily: 'ui-monospace', color: 'var(--ink-500)', fontSize: 11.5 }}>{r.invoiceNo}</span></td>
                    <td style={{ overflow: 'hidden', maxWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.projectName}>
                        <span style={{ fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)', marginRight: 6, fontSize: 11.5 }}>{r.projectCode}</span>
                        {r.projectName}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{r.period}</td>
                    <td className="num">{fmtNum(r.grossAmount, 2)}</td>
                    {/* Editable transferDeduction */}
                    <td style={{ padding: '4px 6px' }}>
                      <RcDeductInput
                        value={Number(r.transferDeduction) || 0}
                        max={Number(r.grossAmount) || 0}
                        onSave={(v) => updateReceipt(rcKey(r), { transferDeduction: v })}
                      />
                    </td>
                    <td className="num strong" style={{ color: '#276749' }}>{fmtNum(r.netReceived, 2)}</td>
                    {/* Editable invType */}
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      <select value={t}
                        onChange={(e) => updateReceipt(rcKey(r), { invType: e.target.value })}
                        title={t === 'O' ? 'ลูกหนี้อื่นๆ' : 'ลูกหนี้จากโครงการ'}
                        style={{
                          fontSize: 11.5, fontWeight: 700,
                          padding: '3px 5px', borderRadius: 5,
                          border: `1.5px solid ${t === 'O' ? '#b794f4' : '#63b3ed'}`,
                          background: t === 'O' ? '#faf5ff' : '#ebf8ff',
                          color:      t === 'O' ? '#6b46c1' : '#1e4fbd',
                          cursor: 'pointer', width: '100%',
                        }}>
                        <option value="P">📋 P</option>
                        <option value="O">🛒 O</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
              {!isMonth && items.map((iv, i) => {
                const sMeta = WTPData.IV_STATUS_META[iv.status] || { label: iv.status, badge: 'b-gray' };
                return (
                  <tr key={iv.id || i}>
                    <td>{i + 1}</td>
                    <td><span style={{ fontFamily: 'ui-monospace', fontWeight: 700, color: 'var(--brand-700)', fontSize: 11.5 }}>{iv.jobNo}</span></td>
                    <td><span style={{ fontFamily: 'ui-monospace', fontSize: 11.5 }}>{iv.ivNo}</span></td>
                    <td style={{ overflow: 'hidden', maxWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={iv.projectName}>{iv.projectName}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{iv.expectedReceive ? fmtDate(iv.expectedReceive) : <span className="muted">—</span>}</td>
                    <td className="num strong">{fmtNum(iv.balance, 2)}</td>
                    <td className="num" style={{ color: iv.debt ? 'var(--bad)' : 'var(--ink-400)' }}>
                      {iv.debt ? '(' + fmtNum(iv.debt, 2) + ')' : '-'}
                    </td>
                    <td className="num strong" style={{ color: '#276749' }}>{fmtNum(iv.netExpected, 2)}</td>
                    <td style={{ textAlign: 'center' }}><Badge kind={sMeta.badge}>{sMeta.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={isMonth ? 6 : 5}>รวม {items.length} {isMonth ? 'ใบรับ' : 'ใบ'}</td>
                  <td className="num">{fmtNum(totals.gross, 2)}</td>
                  <td className="num" style={{ color: 'var(--bad)' }}>{totals.debt > 0 ? '(' + fmtNum(totals.debt, 2) + ')' : '-'}</td>
                  <td className="num" style={{ color: '#276749' }}>{fmtNum(totals.net, 2)}</td>
                  {isMonth && <td></td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

/* ── Inline-editable deduction input (click → edit → save on blur/Enter) ── */
function RcDeductInput({ value, max, onSave }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft]     = React.useState(String(value || ''));
  React.useEffect(() => { setDraft(String(value || '')); }, [value]);

  // ★ role guard — owner/viewer ดูอย่างเดียว ไม่ให้เปิดโหมดแก้ไข
  const readOnly = (() => {
    try {
      const s = JSON.parse(localStorage.getItem('wtp-session') || 'null');
      const role = (s && s.role) || 'viewer';
      return role === 'owner' || role === 'viewer';
    } catch (_) { return false; }
  })();

  const commit = () => {
    if (readOnly) { setEditing(false); return; }
    const n = Math.max(0, parseFloat(String(draft).replace(/,/g, '')) || 0);
    if (n !== value) onSave(n);
    setEditing(false);
  };

  if (readOnly) {
    return (
      <div data-owner-readonly
        style={{
          padding: '4px 6px', textAlign: 'right',
          fontFamily: 'ui-monospace', fontWeight: 600, fontSize: 11.5,
          color: value > 0 ? 'var(--bad)' : 'var(--ink-300)',
        }}>
        {value > 0 ? '(' + fmtNum(value, 2) + ')' : <span className="muted">—</span>}
      </div>
    );
  }

  if (editing) {
    return (
      <input type="text" autoFocus value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter')  e.target.blur();
          if (e.key === 'Escape') { setDraft(String(value || '')); setEditing(false); }
        }}
        placeholder="0.00"
        style={{
          width: '100%', boxSizing: 'border-box',
          textAlign: 'right', fontFamily: 'ui-monospace', fontWeight: 600,
          fontSize: 11.5, padding: '4px 6px',
          border: '1.5px solid var(--brand-500)', borderRadius: 5, background: '#fff',
        }} />
    );
  }
  return (
    <div onClick={() => setEditing(true)}
      title="คลิกเพื่อแก้ไขหักโอนสิทธิ์"
      style={{
        cursor: 'pointer', padding: '4px 6px', borderRadius: 5,
        textAlign: 'right', fontFamily: 'ui-monospace', fontWeight: 600,
        fontSize: 11.5, border: '1px dashed transparent',
        color: value > 0 ? 'var(--bad)' : 'var(--ink-300)',
        transition: 'background .12s, border-color .12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklch,var(--brand-500) 8%,transparent)'; e.currentTarget.style.borderColor = 'var(--brand-300, #90cdf4)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = 'transparent'; }}>
      {value > 0 ? '(' + fmtNum(value, 2) + ')' : <span style={{ fontStyle: 'italic', fontWeight: 400 }}>+ กรอก</span>}
    </div>
  );
}

function KpiCallout({ label, value, unit = 'บาท', digits = 2, accent, icon, sub }) {
  return (
    <div className="kpi" style={{ paddingTop: 16 }}>
      <div className="kpi-accent" style={{ background: accent }} />
      <div className="kpi-label">
        {icon && <Icon name={icon} size={14} />}
        {label}
      </div>
      <div className="kpi-value">
        <AnimatedNumber value={value} digits={digits} />
        {unit && <span className="u">{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionCard({ num, title, subtitle, totalLabel, total, children }) {
  return (
    <div className="card anim-in" style={{ marginBottom: 18, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, background: 'linear-gradient(180deg, var(--brand-50), white)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))', color: 'white', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700, letterSpacing: '.02em' }}>{num}</div>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink-900)', fontSize: 15 }}>{title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>{subtitle}</div>
          </div>
        </div>
        {total != null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{totalLabel}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand-700)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
              <AnimatedNumber value={total} digits={2} /> <span style={{ fontSize: 13, color: 'var(--ink-500)', fontWeight: 500 }}>บาท</span>
            </div>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function BigCallout({ tone, label, value, hint }) {
  const toneMap = {
    info: { bg: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))', text: 'white' },
    warn: { bg: 'linear-gradient(135deg, oklch(75% 0.16 75), oklch(60% 0.16 75))', text: 'white' },
  };
  const t = toneMap[tone] || toneMap.info;
  return (
    <div className="card" style={{ background: t.bg, color: t.text, borderColor: 'transparent', padding: 22, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -30, top: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
      <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 500, position: 'relative' }}>{label}</div>
      <div style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 6, position: 'relative', letterSpacing: '-.02em' }}>
        <AnimatedNumber value={value} digits={2} />
      </div>
      {hint && <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6, position: 'relative' }}>{hint}</div>}
    </div>
  );
}

function OutstandingMiniStat({ label, count, net, accent, anchor, hint, dimmed, highlight }) {
  const align     = anchor === 'right' ? 'flex-end' : anchor === 'left' ? 'flex-start' : 'center';
  const textAlign = anchor === 'right' ? 'right'    : anchor === 'left' ? 'left'       : 'center';
  return (
    <div style={{
      padding: '8px 14px', display: 'flex', flexDirection: 'column', alignItems: align, gap: 3,
      borderLeft: anchor === 'left' ? 'none' : '1px dashed var(--line)',
      opacity: dimmed ? 0.55 : 1,
      background: highlight ? 'linear-gradient(135deg, var(--warn-bg), transparent)' : 'transparent',
      borderRadius: highlight ? 8 : 0,
    }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 500, textAlign }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: accent, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>
          <AnimatedNumber value={count} digits={0} />
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>ใบ</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-700)', fontVariantNumeric: 'tabular-nums', textAlign }}>
        NET <strong>{fmtNum(net, 2)}</strong> บาท
      </div>
      {hint && <div style={{ fontSize: 10.5, color: 'var(--ink-400)', textAlign, fontStyle: 'italic', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

Object.assign(window, { WarRoomPage1, KpiCallout, SectionCard, BigCallout });
