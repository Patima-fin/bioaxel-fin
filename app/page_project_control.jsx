// ═══════════════════════════════════════════════════════════════════════════
// Project Control Dashboard — UI (page component for route "projects")
// ดีไซน์จาก Claude Design handoff · ปรับโทนสีเป็น brand-blue สดใสของระบบ
// ใช้ engine ใน pc_engine.jsx (window.PCU / window.PCGrid)
// ═══════════════════════════════════════════════════════════════════════════
const { useState: pcSt, useMemo: pcMemo, useEffect: pcEff, useRef: pcRef, useCallback: pcCb } = React;
const PCU = window.PCU;
const PCGrid = window.PCGrid;

// ── tiny icon set (stroke) ──────────────────────────────────────────────────
function PcIc({ d, size = 16, sw = 1.7, style, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {d ? <path d={d} /> : children}
    </svg>
  );
}
const PcI = {
  search: (p) => <PcIc {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></PcIc>,
  upload: (p) => <PcIc {...p} d="M12 16V4m0 0 4 4m-4-4-4 4M4 17v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1" />,
  close: (p) => <PcIc {...p} d="M18 6 6 18M6 6l12 12" />,
  filter: (p) => <PcIc {...p} d="M3 5h18M6 12h12M10 19h4" />,
  columns: (p) => <PcIc {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></PcIc>,
  lock: (p) => <PcIc {...p}><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></PcIc>,
  download: (p) => <PcIc {...p} d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />,
  chevron: (p) => <PcIc {...p} d="m6 9 6 6 6-6" />,
  chevronR: (p) => <PcIc {...p} d="m9 6 6 6-6 6" />,
  sortAsc: (p) => <PcIc {...p} d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 4v16" />,
  sortDesc: (p) => <PcIc {...p} d="M11 19h10M11 15h7M11 11h4M3 7l3-3 3 3M6 20V4" />,
  check: (p) => <PcIc {...p} d="M5 12.5 10 17l9-10" sw={2.1} />,
  alert: (p) => <PcIc {...p}><path d="M12 9v4m0 4h.01" /><path d="M10.3 3.3 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z" /></PcIc>,
  refresh: (p) => <PcIc {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></PcIc>,
  edit: (p) => <PcIc {...p} d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  building: (p) => <PcIc {...p}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01" /></PcIc>,
  money: (p) => <PcIc {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></PcIc>,
  clock: (p) => <PcIc {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></PcIc>,
  shield: (p) => <PcIc {...p} d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" />,
};

// ── status badge / progress bar ─────────────────────────────────────────────
function PcStatusBadge({ status }) {
  const m = PCU.STATUS_META[status] || { th: status, color: '#475569', bg: '#f1f5f9', dot: '#94a3b8' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: m.bg, color: m.color, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 100 }}>
      <span style={{ width: 6, height: 6, borderRadius: 10, background: m.dot }} />{m.th}
    </span>
  );
}
function PcProgress({ value, w = 56 }) {
  const v = value == null ? 0 : value;
  let col = '#2e8b4a'; if (v >= 100) col = '#16a34a'; else if (v >= 70) col = '#0e9f9a'; else if (v < 30) col = '#94a3b8';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: w, height: 6, background: '#e7edf4', borderRadius: 10, overflow: 'hidden', flex: '0 0 auto' }}>
        <div style={{ width: v + '%', height: '100%', background: col, borderRadius: 10, transition: 'width .5s' }} />
      </div>
      <span className="num" style={{ fontSize: 11, color: '#475569', minWidth: 26, textAlign: 'right' }}>{value == null ? '—' : Math.round(v) + '%'}</span>
    </div>
  );
}
function PcDonut({ segments, size = 90, thickness = 13, center }) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r, cx = size / 2;
  let off = 0; const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e7edf4" strokeWidth={thickness} />
        {segments.map((s, i) => { const len = (s.value / total) * c;
          const el = <circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} />;
          off += len; return el; })}
      </svg>
      {center && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>{center}</div>}
    </div>
  );
}
function PcBand({ n, en, th }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6, marginBottom: 2 }}>
      <span className="num" style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-600)', background: 'var(--brand-50)', borderRadius: 6, padding: '1px 7px' }}>{n}</span>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)' }}>{en}</span>
      <span style={{ fontSize: 11.5, color: '#94a3b8' }}>{th}</span>
      <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,#d3dcea,transparent)', marginLeft: 6 }} />
    </div>
  );
}
const pcCard = { background: '#fff', border: '1px solid #e6ecf4', borderRadius: 14, boxShadow: '0 1px 3px rgba(13,31,58,.05)' };

// ── KPI section (8 cards) ───────────────────────────────────────────────────
function PcKpiSection({ summary, filterStatus, onFilterStatus }) {
  const card = (key, icon, label, th, value, sub, color, status) => {
    const active = status && filterStatus === status;
    return (
      <button key={key} onClick={status ? () => onFilterStatus(status) : undefined}
        style={{ textAlign: 'left', ...pcCard, padding: '13px 15px', cursor: status ? 'pointer' : 'default',
          border: active ? '1.5px solid ' + color : '1px solid #e6ecf4', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: color + '18', color, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>{icon}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
            <div style={{ fontSize: 9.5, color: '#94a3b8' }}>{th}</div>
          </div>
        </div>
        <div className="num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-900)', letterSpacing: '-.5px' }}>{value}</div>
        {sub && <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 1 }}>{sub}</div>}
      </button>
    );
  };
  return (
    <div className="pc-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(8,minmax(0,1fr))', gap: 10 }}>
      {card('all', <PcI.building size={15} />, 'โครงการทั้งหมด', 'All Projects', summary.count.toLocaleString(), '฿' + PCU.fmtCompact(summary.contractTotal), '#2e8b4a', null)}
      {card('wip', <PcI.refresh size={15} />, 'กำลังดำเนินการ', 'Work in Progress', summary.wip.toLocaleString(), '฿' + PCU.fmtCompact(summary.wipAmt), '#2e8b4a', 'Work in progress')}
      {card('await', <PcI.clock size={15} />, 'รอลงนาม', 'Awaiting Sign', summary.awaiting.toLocaleString(), '฿' + PCU.fmtCompact(summary.awaitAmt), '#f97316', 'ยังไม่ลงนาม')}
      {card('fin', <PcI.check size={15} />, 'เสร็จสิ้น', 'Finished', summary.finish.toLocaleString(), '฿' + PCU.fmtCompact(summary.finishAmt), '#16a34a', 'Finish')}
      {card('cancel', <PcI.close size={15} />, 'ยกเลิก', 'Cancelled', summary.cancelled.toLocaleString(), '฿' + PCU.fmtCompact(summary.cancelAmt), '#ef4444', 'ยกเลิก')}
      {card('contract', <PcI.money size={15} />, 'มูลค่าสัญญารวม', 'Contract Value', '฿' + PCU.fmtCompact(summary.contractTotal), 'รับแล้ว ฿' + PCU.fmtCompact(summary.received), '#0e9f9a', null)}
      {card('ar', <PcI.alert size={15} />, 'ยอดค้างรับ', 'Outstanding AR', '฿' + PCU.fmtCompact(summary.outstandingAR), null, '#b45309', null)}
      {card('f30', <PcI.clock size={15} />, 'คาดรับ 30 วัน', 'Forecast 30d', '฿' + PCU.fmtCompact(summary.forecast30), '60d ฿' + PCU.fmtCompact(summary.forecast60), '#2e8b4a', null)}
    </div>
  );
}

// ── Funnel (sub-status pipeline) ────────────────────────────────────────────
function PcFunnel({ rows, onPick }) {
  const counts = pcMemo(() => PCU.pipelineCounts(rows).filter(p => p.count > 0 || p.th === 'ลงนามแล้ว'), [rows]);
  const max = Math.max(1, ...counts.map(c => c.count));
  return (
    <div style={{ ...pcCard, padding: 14, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {counts.map((c) => {
        const w = Math.max(6, (c.count / max) * 100);
        return (
          <button key={c.th} onClick={() => onPick(c.th)} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 42px', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', padding: '2px 0', textAlign: 'left', cursor: 'pointer' }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-900)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.th}</span>
            <span style={{ height: 18, background: '#eff3f8', borderRadius: 5, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: w + '%', height: '100%', background: 'linear-gradient(90deg,var(--brand-500),var(--brand-400))', borderRadius: 5, transition: 'width .5s' }} />
            </span>
            <span className="num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-700)', textAlign: 'right' }}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Cashflow forecast chart (monthly) ───────────────────────────────────────
function PcCashflow({ rows }) {
  const years = pcMemo(() => PCU.forecastYears(rows), [rows]);
  const [year, setYear] = pcSt(null);
  const [drill, setDrill] = pcSt(null); // month obj
  const yr = year || years[0] || new Date().getFullYear();
  const months = pcMemo(() => PCU.cashflowByMonth(rows, yr), [rows, yr]);
  const max = Math.max(1, ...months.map(m => m.gross));
  const total = months.reduce((s, m) => ({ gross: s.gross + m.gross, debt: s.debt + m.debt, net: s.net + m.net }), { gross: 0, debt: 0, net: 0 });
  return (
    <div style={{ ...pcCard, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
          <span><b className="num" style={{ color: 'var(--brand-700)' }}>฿{PCU.fmtCompact(total.gross)}</b> <span style={{ color: '#94a3b8' }}>Gross</span></span>
          <span><b className="num" style={{ color: '#16a34a' }}>฿{PCU.fmtCompact(total.net)}</b> <span style={{ color: '#94a3b8' }}>Net</span></span>
          <span style={{ color: '#cbd5e1' }}>· คลิกแท่งเพื่อดูรายโครงการ/งวด</span>
        </div>
        {years.length > 1 && (
          <select value={yr} onChange={e => setYear(+e.target.value)} style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid #d3dcea' }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 4, alignItems: 'end', height: 130 }}>
        {months.map((m, i) => {
          const gh = (m.gross / max) * 110, nh = (m.net / max) * 110;
          const has = m.count > 0;
          return (
            <div key={i} onClick={has ? () => setDrill(m) : undefined} title={`${m.month} · คาดรับ ฿${PCU.fmtBaht(m.gross)} · ${m.count} งวด`}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: has ? 'pointer' : 'default' }}>
              <div style={{ width: '100%', height: 112, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                <div style={{ width: '60%', height: Math.max(1, gh), background: has ? 'var(--brand-500)' : '#e7edf4', borderRadius: '3px 3px 0 0', transition: 'background .15s' }} />
              </div>
              <span style={{ fontSize: 9, color: has ? 'var(--brand-700)' : '#cbd5e1', fontWeight: has ? 600 : 400 }}>{m.month}</span>
            </div>
          );
        })}
      </div>
      {drill && (
        <div onClick={() => setDrill(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(8,18,34,.42)', zIndex: 650, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(680px,96vw)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(13,31,58,.28)', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,var(--brand-600),var(--brand-500))', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 10.5, opacity: .8 }}>กระแสเงินสดคาดการณ์ · {yr}</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{drill.month} · คาดรับ ฿{PCU.fmtBaht(drill.gross)} <span style={{ fontSize: 12, fontWeight: 500, opacity: .85 }}>({drill.count} งวด)</span></div>
              </div>
              <button onClick={() => setDrill(null)} style={{ border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', borderRadius: 8, width: 30, height: 30, display: 'grid', placeItems: 'center', cursor: 'pointer' }}><PcI.close size={16} /></button>
            </div>
            <div style={{ overflow: 'auto', padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ position: 'sticky', top: 0 }}>
                  {['โครงการ', 'งวด', 'คาดรับ', 'วันที่'].map((h, i) => <th key={i} style={{ background: '#f6f8fb', borderBottom: '1.5px solid #d3dcea', padding: '8px 12px', textAlign: i >= 2 ? 'right' : 'left', fontSize: 11, color: '#334155', whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {drill.lines.map((ln, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{ln.row.site || ln.row.name}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>{[/^(XL|WS)-/i.test(ln.row.contractNo) ? null : ln.row.contractNo, ln.row.province].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td style={{ padding: '8px 12px' }}><span style={{ background: 'var(--brand-50)', color: 'var(--brand-700)', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 100 }}>งวด {ln.no}</span></td>
                      <td className="num" style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#0e9f9a' }}>฿{PCU.fmtBaht(ln.amount)}</td>
                      <td className="num" style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>{PCU.fmtDate(ln.date)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{ background: '#eaf2ff', fontWeight: 800 }}>
                  <td style={{ padding: '9px 12px' }} colSpan={2}>รวม {drill.month}</td>
                  <td className="num" style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--brand-700)' }}>฿{PCU.fmtBaht(drill.gross)}</td>
                  <td />
                </tr></tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── LG section ──────────────────────────────────────────────────────────────
function PcLgSection({ rows }) {
  const banks = pcMemo(() => PCU.lgByBank(rows), [rows]);
  const total = banks.reduce((s, b) => s + b.amount, 0);
  if (!banks.length) return <div style={{ ...pcCard, padding: 18, color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>ยังไม่มีข้อมูล LG · กรอกใน Finance Master (drawer) เพื่อแสดงผล</div>;
  return (
    <div style={{ ...pcCard, padding: 14, display: 'flex', gap: 16, alignItems: 'center' }}>
      <PcDonut segments={banks.map(b => ({ value: b.amount, color: b.color }))} center={<><div style={{ fontSize: 9, color: '#94a3b8' }}>LG รวม</div><div className="num" style={{ fontSize: 14, fontWeight: 800 }}>฿{PCU.fmtCompact(total)}</div></>} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {banks.map(b => (
          <div key={b.bank} style={{ display: 'grid', gridTemplateColumns: '50px 1fr auto', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
            <span style={{ fontWeight: 700, color: b.color }}>{b.bank}</span>
            <span style={{ height: 6, background: '#eff3f8', borderRadius: 6 }}><span style={{ display: 'block', height: '100%', width: (b.amount / (banks[0].amount || 1) * 100) + '%', background: b.color, borderRadius: 6 }} /></span>
            <span className="num" style={{ fontWeight: 600 }}>฿{PCU.fmtCompact(b.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function PcDebtSection({ rows }) {
  const creds = pcMemo(() => PCU.debtByCreditor(rows), [rows]);
  const total = creds.reduce((s, c) => s + c.total, 0);
  const remaining = creds.reduce((s, c) => s + c.remaining, 0);
  if (!creds.length) return <div style={{ ...pcCard, padding: 18, color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>ยังไม่มีภาระหนี้ (ผู้รับโอนสิทธิเป็นเจ้าหนี้) ในมุมมองนี้</div>;
  return (
    <div style={{ ...pcCard, padding: 14 }}>
      <div style={{ display: 'flex', gap: 18, marginBottom: 10 }}>
        <div><div style={{ fontSize: 10, color: '#94a3b8' }}>หนี้รวม</div><div className="num" style={{ fontSize: 16, fontWeight: 800 }}>฿{PCU.fmtCompact(total)}</div></div>
        <div><div style={{ fontSize: 10, color: '#94a3b8' }}>คงเหลือ</div><div className="num" style={{ fontSize: 16, fontWeight: 800, color: '#b45309' }}>฿{PCU.fmtCompact(remaining)}</div></div>
        <div><div style={{ fontSize: 10, color: '#94a3b8' }}>หักแล้ว</div><div className="num" style={{ fontSize: 16, fontWeight: 800, color: '#16a34a' }}>฿{PCU.fmtCompact(total - remaining)}</div></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {creds.map(c => { const pctDed = c.total > 0 ? (c.deducted / c.total * 100) : 0;
          return (
            <div key={c.creditor} style={{ fontSize: 11.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontWeight: 600 }}>{c.name} <span style={{ color: '#94a3b8' }}>· {c.count}</span></span>
                <span className="num">฿{PCU.fmtCompact(c.remaining)} <span style={{ color: '#94a3b8' }}>/ {PCU.fmtCompact(c.total)}</span></span>
              </div>
              <div style={{ height: 6, background: '#eff3f8', borderRadius: 6 }}><span style={{ display: 'block', height: '100%', width: pctDed + '%', background: '#16a34a', borderRadius: 6 }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXCEL-GRADE DATA GRID
// ═══════════════════════════════════════════════════════════════════════════
function PcCellRender(col, r) {
  const U = PCU;
  switch (col.id) {
    case 'name': return (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.site || '—'}</div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>{[r.province, r.type].filter(Boolean).join(' · ')}</div>
      </div>);
    case 'contractNo': return <span className="num" style={{ fontWeight: 600, color: /^(XL|WS)-/i.test(r.contractNo) ? '#94a3b8' : 'var(--ink-900)' }}>{/^(XL|WS)-/i.test(r.contractNo) ? '(ไม่มีเลข)' : (r.contractNo || '—')}</span>;
    case 'fy': return r.fy ? <span className="num">FY{r.fy}</span> : '—';
    case 'region': return r.regionEn ? <span style={{ fontSize: 11 }}>{r.regionEn}<span style={{ color: '#94a3b8' }}> · {r.region}</span></span> : '—';
    case 'type': return r.type ? <span style={{ background: '#eff3f8', color: '#475569', fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 100 }}>{r.type}</span> : '—';
    case 'contractAmt': return <span className="num" style={{ fontWeight: 600 }}>{r.contractAmt ? '฿' + U.fmtBaht(r.contractAmt) : '—'}</span>;
    case 'progress': return <PcProgress value={r.progress} />;
    case 'status': return <PcStatusBadge status={r.status} />;
    case 'projectStatus': return <span style={{ fontSize: 11, color: '#33425a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{r.projectStatus}</span>;
    case 'outstandingAR': return <span className="num" style={{ fontWeight: 600, color: r.outstandingAR > 0 ? '#b45309' : '#cbd5e1' }}>{r.outstandingAR > 0 ? '฿' + U.fmtBaht(r.outstandingAR) : '—'}</span>;
    case 'received': return <span className="num" style={{ color: r.received > 0 ? '#15803d' : '#cbd5e1' }}>{r.received > 0 ? '฿' + U.fmtBaht(r.received) : '—'}</span>;
    case 'forecastReceive': return <span className="num" style={{ color: r.forecastReceive > 0 ? '#0e9f9a' : '#cbd5e1' }}>{r.forecastReceive > 0 ? '฿' + U.fmtBaht(r.forecastReceive) : '—'}</span>;
    case 'forecastDate': { const dd = U.daysFromToday(r.forecastDate); const over = dd != null && dd < 0;
      return r.forecastDate ? <span className="num" style={{ fontSize: 11, color: over ? '#dc2626' : '#475569' }}>{U.fmtDate(r.forecastDate)}{dd != null && dd >= 0 && dd <= 30 ? <span style={{ color: '#d97706' }}> ·{dd}d</span> : ''}</span> : '—'; }
    case 'fc1Amount': return <span className="num" style={{ color: r.fc1Amount > 0 ? '#0e9f9a' : '#cbd5e1' }}>{r.fc1Amount > 0 ? '฿' + U.fmtBaht(r.fc1Amount) : '—'}</span>;
    case 'fc2Amount': return <span className="num" style={{ color: r.fc2Amount > 0 ? '#0e9f9a' : '#cbd5e1' }}>{r.fc2Amount > 0 ? '฿' + U.fmtBaht(r.fc2Amount) : '—'}</span>;
    case 'fc1Date': case 'fc2Date': { const iso = col.id === 'fc1Date' ? r.fc1Date : r.fc2Date; const dd = U.daysFromToday(iso); const over = dd != null && dd < 0;
      return iso ? <span className="num" style={{ fontSize: 11, color: over ? '#dc2626' : '#475569' }}>{U.fmtDate(iso)}{dd != null && dd >= 0 && dd <= 30 ? <span style={{ color: '#d97706' }}> ·{dd}d</span> : ''}</span> : '—'; }
    case 'forecastNet': return <span className="num" style={{ color: r.forecastNet > 0 ? 'var(--ink-900)' : '#cbd5e1' }}>{r.forecastNet > 0 ? '฿' + U.fmtBaht(r.forecastNet) : '—'}</span>;
    case 'assignee': return r.assignee ? <span style={{ background: 'var(--brand-50)', color: 'var(--brand-700)', fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 100 }}>{r.assignee}</span> : '—';
    case 'lgBank': return r.lg && r.lg.bank ? <span style={{ fontWeight: 700, fontSize: 11, color: U.BANK_COLORS[r.lg.bank] || 'var(--brand-700)' }}>{r.lg.bank}</span> : '—';
    case 'lgAmount': return r.lg ? <span className="num">฿{U.fmtBaht(r.lg.amount)}</span> : '—';
    case 'start': return r.start ? <span className="num" style={{ fontSize: 11 }}>{U.fmtDate(r.start)}</span> : '—';
    case 'finish': return r.finish ? <span className="num" style={{ fontSize: 11 }}>{U.fmtDate(r.finish)}</span> : '—';
    default: {
      const v = col.value(r);
      // raw engineer columns carry col.kind (money/date/pct/text) for nice formatting
      if (col.kind === 'money') return <span className="num">{v == null || v === '' ? '—' : '฿' + U.fmtBaht(v)}</span>;
      if (col.kind === 'pct') return <span className="num">{v == null || v === '' ? '—' : Math.round(+v) + '%'}</span>;
      if (col.kind === 'date') return v ? <span className="num" style={{ fontSize: 11 }}>{U.fmtDate(v)}</span> : '—';
      return v == null || v === '' ? '—' : <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }} title={String(v)}>{String(v)}</span>;
    }
  }
}

function PcColFilterDropdown({ col, rows, value, onChange, onClose }) {
  const [tab] = pcSt(col.type);
  const distinct = pcMemo(() => col.type === 'enum' || col.type === 'text' ? PCGrid.distinctValues(rows, col) : [], [rows, col]);
  const [sel, setSel] = pcSt(() => value && value.kind === 'set' ? new Set(value.values) : new Set());
  const [q, setQ] = pcSt(value && value.kind === 'text' ? value.q : '');
  const [mn, setMn] = pcSt(value && value.kind === 'num' ? (value.min ?? '') : '');
  const [mx, setMx] = pcSt(value && value.kind === 'num' ? (value.max ?? '') : '');
  const [from, setFrom] = pcSt(value && value.kind === 'date' ? (value.from || '') : '');
  const [to, setTo] = pcSt(value && value.kind === 'date' ? (value.to || '') : '');
  const [search, setSearch] = pcSt('');
  const apply = () => {
    if (col.type === 'num') onChange(mn === '' && mx === '' ? null : { kind: 'num', min: mn === '' ? null : +mn, max: mx === '' ? null : +mx });
    else if (col.type === 'date') onChange(!from && !to ? null : { kind: 'date', from: from || null, to: to || null });
    else if (col.type === 'enum') onChange(sel.size ? { kind: 'set', values: [...sel] } : null);
    else onChange(q ? { kind: 'text', q } : null);
    onClose();
  };
  return (
    <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50, background: '#fff', border: '1px solid #d3dcea', borderRadius: 9, boxShadow: '0 16px 44px rgba(13,31,58,.16)', padding: 10, width: 230 }}>
      {col.type === 'num' && (<div style={{ display: 'flex', gap: 6 }}>
        <input type="number" placeholder="min" value={mn} onChange={e => setMn(e.target.value)} style={pcInp} />
        <input type="number" placeholder="max" value={mx} onChange={e => setMx(e.target.value)} style={pcInp} /></div>)}
      {col.type === 'date' && (<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <YmdPicker value={from} onChange={setFrom} size="sm" />
        <YmdPicker value={to} onChange={setTo} size="sm" /></div>)}
      {col.type === 'text' && <input placeholder="contains…" value={q} onChange={e => setQ(e.target.value)} style={pcInp} />}
      {col.type === 'enum' && (<>
        <input placeholder="ค้นหา…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...pcInp, marginBottom: 6 }} />
        <div style={{ maxHeight: 200, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ ...pcChk, fontWeight: 700, borderBottom: '1px solid #eef2f7', paddingBottom: 4, marginBottom: 2 }}><input type="checkbox" checked={sel.size === distinct.length && distinct.length > 0} ref={el => { if (el) el.indeterminate = sel.size > 0 && sel.size < distinct.length; }} onChange={() => setSel(sel.size === distinct.length ? new Set() : new Set(distinct))} />เลือกทั้งหมด <span style={{ color: '#94a3b8', fontWeight: 400 }}>({distinct.length})</span></label>
          {distinct.filter(d => !search || String(d).toLowerCase().includes(search.toLowerCase())).map((d, i) => (
            <label key={i} style={pcChk}><input type="checkbox" checked={sel.has(d)} onChange={() => { const n = new Set(sel); n.has(d) ? n.delete(d) : n.add(d); setSel(n); }} />{d === '' ? <em style={{ color: '#94a3b8' }}>(ว่าง)</em> : d}</label>
          ))}
        </div></>)}
      <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
        <button onClick={apply} style={{ ...pcBtn, background: 'var(--brand-500)', color: '#fff', flex: 1 }}>กรอง</button>
        <button onClick={() => { onChange(null); onClose(); }} style={{ ...pcBtn, color: '#64748b' }}>ล้าง</button>
      </div>
    </div>
  );
}
const pcInp = { width: '100%', height: 28, fontSize: 11.5, padding: '0 8px', border: '1px solid #d3dcea', borderRadius: 6, outline: 'none', boxSizing: 'border-box' };
const pcChk = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '2px 0', cursor: 'pointer' };
const pcBtn = { height: 28, padding: '0 12px', fontSize: 11.5, fontWeight: 600, border: '1px solid #d3dcea', borderRadius: 6, background: '#fff', cursor: 'pointer' };

function PcGrid({ rows, allCols, state, setState, onOpenRow }) {
  const [openFilter, setOpenFilter] = pcSt(null);
  const [resizing, setResizing] = pcSt(null);
  const [dragCol, setDragCol] = pcSt(null);
  const [dragOver, setDragOver] = pcSt(null);
  const moveCol = (srcId, dstId) => {
    if (!srcId || srcId === dstId) return;
    setState(s => { const ord = s.order.filter(x => x !== srcId); const idx = ord.indexOf(dstId); if (idx < 0) return s; ord.splice(idx, 0, srcId); return { ...s, order: ord }; });
  };
  const visibleCols = pcMemo(() => state.order.map(id => allCols.find(c => c.id === id)).filter(c => c && !state.hidden.includes(c.id)), [state.order, state.hidden, allCols]);
  const frozenCols = visibleCols.filter(c => state.frozen.includes(c.id));
  const scrollCols = visibleCols.filter(c => !state.frozen.includes(c.id));
  const colW = (c) => state.widths && state.widths[c.id] ? state.widths[c.id] : c.width;

  // pipeline: colFilters → sort
  const filtered = pcMemo(() => PCGrid.applyColFilters(rows, allCols, state.colFilters), [rows, allCols, state.colFilters]);
  const sorted = pcMemo(() => PCGrid.applySort(filtered, allCols, state.sort), [filtered, allCols, state.sort]);
  const pageRows = pcMemo(() => {
    const start = (state.page - 1) * state.pageSize;
    return sorted.slice(start, start + state.pageSize);
  }, [sorted, state.page, state.pageSize]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / state.pageSize));

  const toggleSort = (cid, additive) => {
    setState(s => {
      const cur = s.sort.find(x => x.id === cid);
      let sort;
      if (!cur) sort = additive ? [...s.sort, { id: cid, dir: 'asc' }] : [{ id: cid, dir: 'asc' }];
      else if (cur.dir === 'asc') sort = s.sort.map(x => x.id === cid ? { ...x, dir: 'desc' } : x);
      else sort = s.sort.filter(x => x.id !== cid);
      if (!additive && cur) sort = cur.dir === 'asc' ? [{ id: cid, dir: 'desc' }] : [];
      return { ...s, sort, page: 1 };
    });
  };
  // resize handlers
  pcEff(() => {
    if (!resizing) return;
    const onMove = (e) => { const dx = e.clientX - resizing.x0; setState(s => ({ ...s, widths: { ...(s.widths || {}), [resizing.id]: Math.max(60, resizing.w0 + dx) } })); };
    const onUp = () => setResizing(null);
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [resizing]);

  const renderHeader = (c, frozen, leftOffset) => {
    const sortIdx = state.sort.findIndex(x => x.id === c.id);
    const sortDir = sortIdx >= 0 ? state.sort[sortIdx].dir : null;
    const hasFilter = !!state.colFilters[c.id];
    return (
      <th key={c.id} style={{ position: frozen ? 'sticky' : 'relative', left: frozen ? leftOffset : undefined, zIndex: frozen ? 6 : 2, minWidth: colW(c), maxWidth: colW(c), width: colW(c),
        background: dragOver === c.id ? '#dceaff' : '#f6f8fb', borderBottom: '1.5px solid #d3dcea', borderRight: frozen ? '1px solid #e6ecf4' : 'none', borderLeft: dragOver === c.id && dragCol !== c.id ? '2px solid var(--brand-500)' : undefined, padding: '0', textAlign: c.align || 'left', whiteSpace: 'nowrap', userSelect: 'none', top: 0 }}>
        <div draggable
          onDragStart={e => { setDragCol(c.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.id); } catch (_) {} }}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOver !== c.id) setDragOver(c.id); }}
          onDragLeave={() => { if (dragOver === c.id) setDragOver(null); }}
          onDrop={e => { e.preventDefault(); moveCol(dragCol, c.id); setDragCol(null); setDragOver(null); }}
          onDragEnd={() => { setDragCol(null); setDragOver(null); }}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 9px', cursor: dragCol ? 'grabbing' : 'grab', justifyContent: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start' }}>
          <span onClick={e => toggleSort(c.id, e.shiftKey)} style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#334155', display: 'inline-flex', alignItems: 'center', gap: 3 }} title={c.th + ' · ลากเพื่อย้ายคอลัมน์'}>
            {c.label}
            {sortDir === 'asc' && <PcI.sortAsc size={12} style={{ color: 'var(--brand-600)' }} />}
            {sortDir === 'desc' && <PcI.sortDesc size={12} style={{ color: 'var(--brand-600)' }} />}
            {sortIdx >= 0 && state.sort.length > 1 && <span className="num" style={{ fontSize: 8, color: 'var(--brand-600)' }}>{sortIdx + 1}</span>}
          </span>
          <button onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === c.id ? null : c.id); }} style={{ border: 'none', background: hasFilter ? 'var(--brand-100)' : 'transparent', color: hasFilter ? 'var(--brand-700)' : '#94a3b8', borderRadius: 4, padding: 2, cursor: 'pointer', display: 'inline-flex' }}>
            <PcI.filter size={12} />
          </button>
        </div>
        {openFilter === c.id && <PcColFilterDropdown col={c} rows={filtered.length || rows.length ? rows : rows} value={state.colFilters[c.id]} onChange={f => setState(s => ({ ...s, colFilters: { ...s.colFilters, [c.id]: f }, page: 1 }))} onClose={() => setOpenFilter(null)} />}
        <span onMouseDown={e => { e.preventDefault(); setResizing({ id: c.id, x0: e.clientX, w0: colW(c) }); }} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize' }} />
      </th>
    );
  };
  let foff = 0; const frozenOffsets = frozenCols.map(c => { const o = foff; foff += colW(c); return o; });

  return (
    <div style={{ ...pcCard, padding: 0, overflow: 'hidden' }} onClick={() => setOpenFilter(null)}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 250px)' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, width: 'max-content', minWidth: '100%' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            <tr>{frozenCols.map((c, i) => renderHeader(c, true, frozenOffsets[i]))}{scrollCols.map(c => renderHeader(c, false))}</tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <tr><td colSpan={visibleCols.length} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
              {/* ★ ตัวกรองคอลัมน์ถูกจำไว้ (wtp-pc-gridstate-v3) ข้ามการ reload → ถ้ากรองแล้ว
                  ซ่อนทุกแถว จะค้าง "ไม่พบโครงการ" ถาวร หาสาเหตุไม่เจอ → ให้ปุ่มทางออกล้างตัวกรอง */}
              {rows.length > 0 && Object.values(state.colFilters || {}).some(Boolean) ? (
                <>
                  <div>ตัวกรองคอลัมน์กำลังซ่อนโครงการทั้งหมด ({rows.length} รายการถูกกรองออก)</div>
                  <button onClick={() => setState(s => ({ ...s, colFilters: {}, page: 1 }))}
                    style={{ ...pcBtn, marginTop: 12, background: 'var(--brand-500)', color: '#fff', borderColor: 'var(--brand-500)' }}>
                    ล้างตัวกรองคอลัมน์ทั้งหมด
                  </button>
                </>
              ) : 'ไม่พบโครงการตามเงื่อนไข'}
            </td></tr>}
            {pageRows.map((r, ri) => {
              const cond = PCGrid.rowCondStyle(r, state.cf);
              return (
                <tr key={r.id} onClick={() => onOpenRow(r)} style={{ cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = 'inset 0 0 0 9999px rgba(46,139,74,.035)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                  {frozenCols.map((c, i) => (
                    <td key={c.id} style={{ position: 'sticky', left: frozenOffsets[i], zIndex: 3, minWidth: colW(c), maxWidth: colW(c), width: colW(c), padding: state.density === 'compact' ? '6px 9px' : '10px 9px', textAlign: c.align || 'left', verticalAlign: 'middle', background: cond.background || '#fff', color: cond.color, borderRight: '1px solid #e6ecf4', overflow: 'hidden' }}>{PcCellRender(c, r)}</td>
                  ))}
                  {scrollCols.map(c => (
                    <td key={c.id} style={{ minWidth: colW(c), maxWidth: colW(c), width: colW(c), padding: state.density === 'compact' ? '6px 9px' : '10px 9px', textAlign: c.align || 'left', verticalAlign: 'middle', ...cond, overflow: 'hidden' }}>{PcCellRender(c, r)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* pagination */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderTop: '1px solid #e6ecf4', fontSize: 11.5, color: '#64748b' }}>
        <span>แสดง {sorted.length ? ((state.page - 1) * state.pageSize + 1) : 0}–{Math.min(state.page * state.pageSize, sorted.length)} จาก {sorted.length.toLocaleString()}</span>
        <select value={state.pageSize} onChange={e => setState(s => ({ ...s, pageSize: +e.target.value, page: 1 }))} style={{ fontSize: 11, padding: '2px 5px', borderRadius: 5, border: '1px solid #d3dcea' }}>
          {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}/หน้า</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <button disabled={state.page <= 1} onClick={() => setState(s => ({ ...s, page: s.page - 1 }))} style={{ ...pcBtn, opacity: state.page <= 1 ? .4 : 1 }}>ก่อนหน้า</button>
          <span className="num" style={{ padding: '0 8px' }}>{state.page} / {totalPages}</span>
          <button disabled={state.page >= totalPages} onClick={() => setState(s => ({ ...s, page: s.page + 1 }))} style={{ ...pcBtn, opacity: state.page >= totalPages ? .4 : 1 }}>ถัดไป</button>
        </div>
      </div>
    </div>
  );
}

// ── grid toolbar (columns / density / export / saved view) ──────────────────
function PcGridToolbar({ allCols, state, setState, rows, visibleColObjs, scopeLabel, onAdvanced, advCount }) {
  const [colMenu, setColMenu] = pcSt(false);
  const [expMenu, setExpMenu] = pcSt(false);
  const [colSearch, setColSearch] = pcSt('');
  const activeFilters = Object.values(state.colFilters).filter(Boolean).length;
  const gridRows = () => PCGrid.applySort(PCGrid.applyColFilters(rows, allCols, state.colFilters), allCols, state.sort);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative' }}>
        <button onClick={() => setColMenu(v => !v)} style={{ ...pcBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><PcI.columns size={14} />คอลัมน์ ({visibleColObjs.length}/{allCols.length})</button>
        {colMenu && (() => {
          const cats = [['', 'หลัก / คำนวณ']].concat((PCU.PC_CAT_ORDER || []).map(c => [c, 'วิศวกร · ' + c]));
          const q = colSearch.trim().toLowerCase();
          const match = c => !q || (c.label + ' ' + (c.th || '')).toLowerCase().includes(q);
          const setHidden = (id, vis) => setState(s => ({ ...s, hidden: vis ? [...s.hidden, id] : s.hidden.filter(x => x !== id) }));
          return (
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 60, background: '#fff', border: '1px solid #d3dcea', borderRadius: 9, boxShadow: '0 16px 44px rgba(13,31,58,.16)', padding: 8, width: 280, maxHeight: 440, overflow: 'auto' }}>
            <input value={colSearch} onChange={e => setColSearch(e.target.value)} placeholder="ค้นหาคอลัมน์…" style={{ width: '100%', height: 30, border: '1px solid #d3dcea', borderRadius: 7, padding: '0 9px', fontSize: 11.5, marginBottom: 6, outline: 'none' }} />
            {cats.map(([cat, title]) => {
              const items = allCols.filter(c => (cat === '' ? !c.cat : c.cat === cat) && match(c));
              if (!items.length) return null;
              const allOn = items.every(c => !state.hidden.includes(c.id));
              return (
                <div key={cat || 'core'} style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px', position: 'sticky', top: 0, background: '#f8fafc', borderRadius: 5 }}>
                    <input type="checkbox" checked={allOn} ref={el => { if (el) el.indeterminate = !allOn && items.some(c => !state.hidden.includes(c.id)); }}
                      onChange={() => setState(s => { const h = new Set(s.hidden); allOn ? items.forEach(c => h.add(c.id)) : items.forEach(c => h.delete(c.id)); return { ...s, hidden: [...h] }; })} />
                    <b style={{ fontSize: 10.5, color: '#475569' }}>{title}</b><span style={{ fontSize: 9.5, color: '#94a3b8' }}>({items.length})</span>
                  </div>
                  {items.map(c => { const vis = !state.hidden.includes(c.id); const fz = state.frozen.includes(c.id);
                    return (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 2px 12px', fontSize: 11.5 }}>
                        <input type="checkbox" checked={vis} onChange={() => setHidden(c.id, vis)} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.label}>{c.label}</span>
                        {c.freezable && <button onClick={() => setState(s => ({ ...s, frozen: fz ? s.frozen.filter(x => x !== c.id) : [...s.frozen, c.id] }))} title="ตรึงคอลัมน์" style={{ border: 'none', background: fz ? 'var(--brand-100)' : 'transparent', color: fz ? 'var(--brand-700)' : '#cbd5e1', borderRadius: 4, padding: 2, cursor: 'pointer' }}><PcI.lock size={12} /></button>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>
      <button onClick={() => setState(s => ({ ...s, density: s.density === 'compact' ? 'regular' : 'compact' }))} style={pcBtn}>{state.density === 'compact' ? '☰ กระชับ' : '≡ ปกติ'}</button>
      <button onClick={() => setState(s => ({ ...s, cf: !s.cf }))} style={{ ...pcBtn, background: state.cf ? 'var(--brand-50)' : '#fff', color: state.cf ? 'var(--brand-700)' : '#64748b' }}>🎨 ไฮไลต์</button>
      <button onClick={onAdvanced} style={{ ...pcBtn, display: 'inline-flex', alignItems: 'center', gap: 6, background: advCount > 0 ? 'var(--brand-50)' : '#fff', color: advCount > 0 ? 'var(--brand-700)' : '#475569', borderColor: advCount > 0 ? 'var(--brand-200)' : '#d3dcea' }}><PcI.filter size={14} />ฟิลเตอร์ขั้นสูง{advCount > 0 ? ` (${advCount})` : ''}</button>
      {activeFilters > 0 && <button onClick={() => setState(s => ({ ...s, colFilters: {}, sort: [], page: 1 }))} style={{ ...pcBtn, color: '#dc2626' }}>ล้างตัวกรองคอลัมน์ ({activeFilters})</button>}
      <div style={{ marginLeft: 'auto' }}>
        <button onClick={() => setExpMenu(true)} style={{ ...pcBtn, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--brand-600)', color: '#fff', border: 'none' }}><PcI.download size={14} />Export<PcI.chevron size={13} /></button>
      </div>
      {expMenu && <PcExportModal rows={gridRows()} visibleColObjs={visibleColObjs} scopeLabel={scopeLabel} onClose={() => setExpMenu(false)} />}
    </div>
  );
}

// ── Export modal — เลือกเนื้อหา (สรุป/ละเอียด/ทั้งคู่) × รูปแบบไฟล์ (PDF/Excel/CSV) ──
function PcExportModal({ rows, scopeLabel, onClose }) {
  const [content, setContent] = pcSt('summary');
  const [format, setFormat] = pcSt('pdf');
  const allCols = pcMemo(() => PCU.buildExportColumns(rows), [rows]);
  const [sel, setSel] = pcSt(() => new Set(PCU.PC_EXPORT_DEFAULT.filter(k => allCols.some(c => c.key === k))));
  const [colSearch, setColSearch] = pcSt('');
  // คอลัมน์มีผลเฉพาะตอน export "รายละเอียด/ทั้งคู่" หรือ CSV (สรุปไม่มีตารางรายโครงการ)
  const needCols = content !== 'summary' || format === 'csv';
  const contents = [
    { k: 'summary', icon: '📊', title: 'สรุป', desc: 'ภาพรวม KPI · pipeline · cashflow · LG — สำหรับนักลงทุน' },
    { k: 'detail',  icon: '📋', title: 'รายละเอียด', desc: 'ตารางรายโครงการ · เลือกคอลัมน์ได้' },
    { k: 'both',    icon: '📑', title: 'สรุป + รายละเอียด', desc: 'รวมทั้งสองส่วนในไฟล์เดียว' },
  ];
  const formats = [
    { k: 'pdf',  icon: '📄', title: 'PDF', desc: 'พร้อมโลโก้ BIOAXEL · โทนฟ้า · เปิดหน้าใหม่แล้วสั่งพิมพ์/บันทึก' },
    { k: 'xlsx', icon: '📗', title: 'Excel (.xlsx)', desc: 'ตกแต่งสี + format ตัวเลข · ดาวน์โหลดทันที' },
    { k: 'csv',  icon: '🗒️', title: 'CSV', desc: 'ข้อมูลดิบ เปิดต่อใน Excel/Sheet ได้' },
  ];
  const selCols = () => allCols.filter(c => sel.has(c.key));
  const doExport = () => {
    if (!rows.length) { alert('ไม่มีโครงการที่จะส่งออก'); return; }
    if (needCols && sel.size === 0) { alert('เลือกอย่างน้อย 1 คอลัมน์'); return; }
    const cols = selCols();
    if (format === 'pdf') PCU.openReport(content, rows, scopeLabel, cols);
    else if (format === 'xlsx') PCU.exportXLSX(content, rows, scopeLabel, cols);
    else PCU.exportCSV(rows, cols, 'project-control-' + PCU.TODAY);
    onClose();
  };
  const toggle = (k) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const filteredCols = colSearch.trim()
    ? allCols.filter(c => (c.label + ' ' + c.group).toLowerCase().includes(colSearch.trim().toLowerCase()))
    : allCols;
  const groups = [['คำนวณ', 'คอลัมน์คำนวณ (จากระบบ)']].concat((PCU.PC_CAT_ORDER || []).map(c => [c, 'วิศวกร · ' + c]));
  const card = (o, active, onClick) => (
    <button key={o.k} onClick={onClick} style={{
      textAlign: 'left', padding: '11px 13px', borderRadius: 11, cursor: 'pointer',
      border: `2px solid ${active ? 'var(--brand-500)' : '#e3e9f2'}`,
      background: active ? 'var(--brand-50)' : '#fff', transition: 'all .12s',
    }}>
      <div style={{ fontSize: 20, marginBottom: 2 }}>{o.icon}</div>
      <div style={{ fontWeight: 800, fontSize: 12.5, color: active ? 'var(--brand-700)' : 'var(--ink-700)' }}>{o.title}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, lineHeight: 1.4 }}>{o.desc}</div>
    </button>
  );
  const lbl = { fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: .5, fontWeight: 700, marginBottom: 8 };
  const chip = (txt, on, fn) => (
    <button onClick={fn} style={{ padding: '3px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${on ? 'var(--brand-400)' : '#d3dcea'}`, background: on ? 'var(--brand-50)' : '#fff', color: on ? 'var(--brand-700)' : '#64748b' }}>{txt}</button>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,18,34,.42)', zIndex: 730, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(680px,97vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(13,31,58,.28)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,var(--brand-600),var(--brand-500))', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 16, fontWeight: 800 }}>ส่งออกรายงาน — เลือกรูปแบบ</div><div style={{ fontSize: 10.5, opacity: .85 }}>{rows.length.toLocaleString()} โครงการ · ขอบเขต: {scopeLabel || 'ทั้งหมด'}</div></div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', borderRadius: 8, width: 30, height: 30, display: 'grid', placeItems: 'center', cursor: 'pointer' }}><PcI.close size={16} /></button>
        </div>
        <div style={{ padding: 18, overflow: 'auto', flex: 1 }}>
          <div style={lbl}>1. เนื้อหา</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
            {contents.map(o => card(o, content === o.k, () => setContent(o.k)))}
          </div>
          <div style={lbl}>2. รูปแบบไฟล์</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {formats.map(o => card(o, format === o.k, () => { setFormat(o.k); if (o.k === 'csv' && content === 'summary') setContent('detail'); }))}
          </div>
          {!needCols && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '11px 13px', background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 10, fontSize: 11.5, color: 'var(--brand-700)', lineHeight: 1.5 }}>
              <span style={{ fontSize: 15 }}>💡</span>
              <span>อยากเลือกคอลัมน์ที่จะส่งออกเอง? กด <b>“รายละเอียด”</b> หรือ <b>“สรุป + รายละเอียด”</b> ด้านบน — จะมีช่องให้เลือกจากคอลัมน์วิศวกรทั้งหมด · (“สรุป” = ภาพรวม KPI ไม่มีตารางรายโครงการ จึงไม่ต้องเลือกคอลัมน์)</span>
            </div>
          )}
          {needCols && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={lbl}>3. เลือกคอลัมน์ที่จะส่งออก <span style={{ textTransform: 'none', fontWeight: 400, color: '#94a3b8' }}>(จากคอลัมน์วิศวกรทั้งหมด)</span></span>
                <span style={{ fontSize: 11, color: 'var(--brand-700)', fontWeight: 700 }}>{sel.size}/{allCols.length}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {chip('เลือกทั้งหมด', false, () => setSel(new Set(allCols.map(c => c.key))))}
                  {chip('ค่าเริ่มต้น', false, () => setSel(new Set(PCU.PC_EXPORT_DEFAULT.filter(k => allCols.some(c => c.key === k)))))}
                  {chip('ล้าง', false, () => setSel(new Set()))}
                </div>
              </div>
              <input value={colSearch} onChange={e => setColSearch(e.target.value)} placeholder="ค้นหาคอลัมน์…"
                style={{ width: '100%', height: 32, border: '1px solid #d3dcea', borderRadius: 8, padding: '0 10px', fontSize: 12, marginBottom: 8, outline: 'none' }} />
              <div style={{ maxHeight: 230, overflow: 'auto', border: '1px solid #eef2f7', borderRadius: 10, padding: '6px 4px' }}>
                {groups.map(([g, title]) => {
                  const items = filteredCols.filter(c => c.group === g);
                  if (!items.length) return null;
                  const allOn = items.every(c => sel.has(c.key));
                  return (
                    <div key={g} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', position: 'sticky', top: 0, background: '#f8fafc', borderRadius: 6 }}>
                        <input type="checkbox" checked={allOn} ref={el => { if (el) el.indeterminate = !allOn && items.some(c => sel.has(c.key)); }}
                          onChange={() => setSel(s => { const n = new Set(s); allOn ? items.forEach(c => n.delete(c.key)) : items.forEach(c => n.add(c.key)); return n; })} />
                        <b style={{ fontSize: 11, color: '#475569' }}>{title}</b>
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>({items.length})</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 8px', padding: '2px 6px' }}>
                        {items.map(c => (
                          <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', fontSize: 11.5, cursor: 'pointer', minWidth: 0 }}>
                            <input type="checkbox" checked={sel.has(c.key)} onChange={() => toggle(c.key)} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.label}>{c.label}</span>
                            {c.type !== 'text' && <span style={{ fontSize: 9, color: '#cbd5e1', flex: '0 0 auto' }}>{c.type === 'money' ? '฿' : c.type === 'date' ? '📅' : '%'}</span>}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 8 }}>
          {needCols && <span style={{ fontSize: 11, color: '#94a3b8' }}>ส่งออก {sel.size} คอลัมน์</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={pcBtn}>ยกเลิก</button>
            <button onClick={doExport} style={{ ...pcBtn, background: 'var(--brand-600)', color: '#fff', border: 'none', padding: '0 20px', display: 'inline-flex', alignItems: 'center', gap: 6 }}><PcI.download size={14} />ส่งออก {rows.length.toLocaleString()} โครงการ</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECT DRAWER (right slide-out) — detail + editable Finance Master
// ═══════════════════════════════════════════════════════════════════════════
function PcDrawer({ row, canEdit, onClose, onSaveFinance }) {
  const [tab, setTab] = pcSt('overview');
  const U = PCU;
  const Field = ({ label, value, mono }) => (
    <div style={{ padding: '8px 0', borderBottom: '1px solid #eff3f8' }}>
      <div style={{ fontSize: 10.5, color: '#94a3b8', marginBottom: 2 }}>{label}</div>
      <div className={mono ? 'num' : ''} style={{ fontSize: 12.5, color: 'var(--ink-900)', fontWeight: 500 }}>{value || <span style={{ color: '#cbd5e1' }}>—</span>}</div>
    </div>
  );
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,18,34,.42)', zIndex: 600 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(680px,94vw)', background: '#f6f8fb', zIndex: 601, boxShadow: '-16px 0 44px rgba(13,31,58,.16)', display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <div style={{ background: 'linear-gradient(135deg,var(--brand-600),var(--brand-500))', color: '#fff', padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, opacity: .8, textTransform: 'uppercase', letterSpacing: '.5px' }}>โครงการ · {row.fy ? 'FY' + row.fy : ''}</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>{row.site || row.contractNo}</div>
              <div style={{ fontSize: 11.5, opacity: .85, marginTop: 2 }}>{[row.contractNo && !/^(XL|WS)-/i.test(row.contractNo) ? row.contractNo : null, row.province, row.type].filter(Boolean).join(' · ')}</div>
            </div>
            <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', borderRadius: 8, width: 30, height: 30, display: 'grid', placeItems: 'center', cursor: 'pointer', flex: '0 0 auto' }}><PcI.close size={16} /></button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <PcStatusBadge status={row.status} />
            <span style={{ background: 'rgba(255,255,255,.18)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 100 }}>{row.projectStatus}</span>
            <span style={{ marginLeft: 'auto' }}><PcProgress value={row.progress} w={70} /></span>
          </div>
        </div>
        {/* tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '0 16px', background: '#fff', borderBottom: '1px solid #e6ecf4' }}>
          {[['overview', 'ภาพรวม'], ['installments', 'งวดงาน'], ['finance', 'การเงิน · Finance Master']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ border: 'none', background: 'transparent', borderBottom: tab === k ? '2px solid var(--brand-500)' : '2px solid transparent', color: tab === k ? 'var(--brand-700)' : '#64748b', fontWeight: 600, fontSize: 12.5, padding: '11px 12px', cursor: 'pointer' }}>{l}</button>
          ))}
        </div>
        {/* body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
          {tab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
              {(() => {
                const pd = row.progressDetail || { total: 0, delivered: 0, accepted: 0, paid: 0 };
                let note;
                if (row.status === 'ยกเลิก') note = 'โครงการยกเลิก → ความคืบหน้า 0%';
                else if (row.status === 'ยังไม่ลงนาม') note = 'ยังไม่ลงนามสัญญา → ความคืบหน้า 0%';
                else if (row.status === 'Finish') note = 'รับเงินครบ / ปิดโครงการ → 100% (โครงการจบแล้ว)';
                else if (pd.source === 'pog') {
                  const which = (pd.pogStank != null && pd.pogStank > 0)
                    ? `งานหอถัง+ระบบ (POG+STANK) = ${pd.pogStank}%`
                    : (pd.pogDrink != null && pd.pogDrink > 0) ? `งานน้ำดื่ม (POG DRINK) = ${pd.pogDrink}%` : `${pd.pog}%`;
                  note = `ความคืบหน้างานก่อสร้างจริงจากฝ่ายงาน — ${which}`;
                }
                else if (pd.total > 0) note = `ไม่มีค่า % งานก่อสร้าง → คำนวณจากงวดงาน ถ่วงน้ำหนักตาม % งวด — ส่งมอบ ${pd.delivered}/${pd.total} งวด · ตรวจรับ ${pd.accepted} งวด · รับเงิน ${pd.paid} งวด (เกณฑ์: ส่งมอบ = 75% · ตรวจรับ = 90% · รับเงิน = 100% ของน้ำหนักงวดนั้น)`;
                else if (row.received > 0 && row.contractAmt > 0) note = `ไม่มีข้อมูลงวดงาน → คำนวณจาก รับแล้ว ฿${U.fmtBaht(row.received)} ÷ มูลค่าสัญญา ฿${U.fmtBaht(row.contractAmt)}`;
                else note = 'ลงนาม/เริ่มงานแล้ว แต่ยังไม่มีค่า % งานก่อสร้าง → ตั้งต้นที่ระดับเริ่มต้น';
                return (
                  <div style={{ gridColumn: '1 / -1', margin: '2px 0 8px', padding: '11px 13px', background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-700)' }}>ความคืบหน้า {row.progress == null ? '—' : row.progress + '%'} <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 10.5 }}>· ที่มาของตัวเลข</span></span>
                      <PcProgress value={row.progress} w={120} />
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6 }}>{note}</div>
                  </div>
                );
              })()}
              <Field label="มูลค่าสัญญา (รวม VAT)" value={row.contractAmt ? '฿' + U.fmtBaht(row.contractAmt) : null} mono />
              <Field label="เงินตามใบจัดสรร" value={row.allocation ? '฿' + U.fmtBaht(row.allocation) : null} mono />
              <Field label="รับแล้ว" value={row.received ? '฿' + U.fmtBaht(row.received) : null} mono />
              <Field label="ยอดค้างรับ (Outstanding AR)" value={row.outstandingAR ? '฿' + U.fmtBaht(row.outstandingAR) : null} mono />
              <Field label="คาดว่าจะรับ (Forecast)" value={row.forecastReceive ? '฿' + U.fmtBaht(row.forecastReceive) : null} mono />
              <Field label="กำหนดรับเงิน" value={row.forecastDate ? U.fmtDate(row.forecastDate, 'long') : null} mono />
              <Field label="เริ่มงาน → สิ้นสุด" value={row.start || row.finish ? `${U.fmtDate(row.start)} → ${U.fmtDate(row.finish)}` : null} mono />
              <Field label="ผู้รับโอนสิทธิ" value={row.assignee} />
              <Field label="Tender No." value={row.tenderNo} mono />
              <Field label="Project No." value={row.projectNo} mono />
              <Field label="Customer" value={row.customer} />
              <Field label="Ref.code / งบประมาณ" value={[row.refCode, row.budgetLabel].filter(Boolean).join(' · ')} />
              <div style={{ gridColumn: '1 / -1' }}><Field label="Remark" value={row.remark} /></div>
            </div>
          )}
          {tab === 'installments' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {row.installments.length === 0 && (() => {
                // ตรวจว่าเป็น "ข้อมูลยังไม่ซิงค์" (ชีท 35 คอลัมน์ ไม่มีคอลัมน์งวด) หรือไม่มีงวดจริง
                const raw = row._raw || {};
                const hasInstCols = ('% งวด 1' in raw) || ('Summary Payment 1' in raw) || ('มูลค่า งวด 1' in raw) || ('วันที่ส่งมอบงาน งวด 1' in raw);
                return hasInstCols
                  ? <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 30 }}>ไม่มีข้อมูลงวดงาน</div>
                  : <div style={{ margin: '16px 4px', padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
                      ⏳ <b>ข้อมูลงวดยังไม่ซิงค์เข้าระบบ</b><br/>
                      ชีทกลางยังมีแค่คอลัมน์พื้นฐาน (ยังไม่มีคอลัมน์งวด/ส่งมอบ/Summary) — ทุกโครงการจะแสดงงวดครบ<b>พร้อมกัน</b>หลัง <b>deploy backend (Code.standalone.gs) + อัปโหลด Excel โครงการอีก 1 รอบ</b> · ไม่ต้องไล่แก้ทีละโครง
                    </div>;
              })()}
              {row.installments.map(i => (
                <div key={i.no} style={{ ...pcCard, padding: 12, opacity: i.absorbed ? 0.7 : 1, background: i.absorbed ? '#f8fafc' : '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>งวด {i.no} {i.percent != null ? <span style={{ color: '#94a3b8', fontWeight: 500 }}>· {i.percent}%</span> : ''}
                      {i.mergedFull ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '1px 7px', borderRadius: 100 }}>ส่งงวดเดียว 100% · รวมงวดก่อน</span> : ''}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 100,
                      background: i.absorbed ? '#f1f5f9' : i.paid ? '#dcfce7' : i.delivered ? '#dceaff' : '#fef3c7',
                      color: i.absorbed ? '#94a3b8' : i.paid ? '#15803d' : i.delivered ? '#21703a' : '#b45309' }}>
                      {i.absorbed ? 'รวมในงวดสุดท้าย' : i.paid ? 'จ่ายแล้ว' : i.acceptDate ? 'ตรวจรับแล้ว' : i.delivered ? 'ส่งมอบแล้ว' : 'ยังไม่ส่ง'}</span>
                  </div>
                  {i.absorbed && <div style={{ fontSize: 10.5, color: '#94a3b8', marginBottom: 6 }}>ไม่ได้ส่งงวดนี้แยก — ยกไปรวมจ่ายในงวด {i.absorbedInto} (ส่งงวดเดียว 100%)</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', fontSize: 11.5 }}>
                    <span style={{ color: '#64748b' }}>มูลค่า{i.mergedFull ? ' (จ่ายจริง)' : i.absorbed ? ' (ตามแผน)' : ''}: <b className="num" style={{ color: 'var(--ink-900)' }}>฿{U.fmtBaht(i.amount)}</b></span>
                    <span style={{ color: '#64748b' }}>ส่งมอบ: <span className="num">{U.fmtDate(i.deliveryDate)}</span></span>
                    <span style={{ color: '#64748b' }}>ตรวจรับ: <span className="num">{U.fmtDate(i.acceptDate)}</span></span>
                    <span style={{ color: '#64748b' }}>คาดรับเงิน: <span className="num" style={{ color: '#0e9f9a' }}>{U.fmtDate(i.forecastDate)}</span></span>
                  </div>
                  {(() => {
                    const iv = i.invoice;
                    const META = (window.WTPData && WTPData.IV_STATUS_META) || {};
                    if (!iv || !iv.ivNo) return (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e6ecf4', fontSize: 11, color: '#cbd5e1' }}>
                        🧾 ใบแจ้งหนี้: ยังไม่มี IV ผูกกับงวดนี้
                      </div>
                    );
                    const sm = META[iv.status] || { label: iv.status || '—', badge: 'b-gray' };
                    const badgeColor = iv.status === 'paid' ? { bg: '#dcfce7', c: '#15803d' }
                      : iv.status === 'issue' ? { bg: '#fee2e2', c: '#b91c1c' }
                      : iv.status === 'tracking' ? { bg: '#dceaff', c: '#21703a' }
                      : { bg: '#fffbeb', c: '#b45309' };
                    return (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e6ecf4', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', fontSize: 11.5 }}>
                        <span style={{ color: '#64748b' }}>🧾 ใบแจ้งหนี้: <b className="num" style={{ color: 'var(--brand-700)' }}>{iv.ivNo}</b></span>
                        <span style={{ color: '#64748b' }}>สถานะ IV: <span style={{ fontWeight: 600, padding: '1px 8px', borderRadius: 100, background: badgeColor.bg, color: badgeColor.c }}>{sm.label}</span></span>
                        {iv.invoiceDate && <span style={{ color: '#64748b' }}>วันที่วางบิล: <span className="num">{U.fmtDate(iv.invoiceDate)}</span></span>}
                        {iv.receivedNet > 0
                          ? <span style={{ color: '#64748b' }}>รับเงินจริง: <b className="num" style={{ color: '#15803d' }}>฿{U.fmtBaht(iv.receivedNet)}</b>{iv.receivedDate ? <span className="num" style={{ color: '#94a3b8' }}> · {U.fmtDate(iv.receivedDate)}</span> : ''}</span>
                          : <span style={{ color: '#64748b' }}>รับเงินจริง: <span style={{ color: '#cbd5e1' }}>ยังไม่รับ</span></span>}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
          {tab === 'finance' && <PcFinanceEditor row={row} canEdit={canEdit} onSave={onSaveFinance} />}
        </div>
      </div>
    </>
  );
}

// Finance Master editor — protected fields, saved to localStorage (survives sync)
function PcFinanceEditor({ row, canEdit, onSave }) {
  const fin = PCU.loadFinanceMaster()[row.contractNo] || {};
  const [f, setF] = pcSt({
    assignee: fin.assignee != null ? fin.assignee : (row.assignee || ''),
    lgBank: fin.lgBank || '', lgAmount: fin.lgAmount || '', lgStatus: fin.lgStatus || 'active',
    lgIssue: fin.lgIssue || '', lgExpiry: fin.lgExpiry || '',
    outstandingDebt: fin.outstandingDebt || '', debtDeduction: fin.debtDeduction || '',
    creditTerm: fin.creditTerm != null ? fin.creditTerm : 30, remark: fin.remark || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const lbl = { fontSize: 10.5, color: '#94a3b8', marginBottom: 3, display: 'block' };
  const banks = ['', 'KTB', 'KBANK', 'SCB', 'BBL', 'BAY', 'GSB', 'TTB'];
  const assignees = ['', 'ไม่โอนสิทธิ', 'KTB', 'WCI+STS', 'LIT', 'Funding', 'P2P', 'คุณประกอบ'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: 'var(--brand-50)', border: '1px solid var(--brand-200)', borderRadius: 10, padding: '10px 12px', fontSize: 11.5, color: 'var(--brand-700)' }}>
        🔒 <b>Finance Master</b> — ข้อมูลนี้กรอกโดยฝ่ายการเงิน · จะ <b>ไม่ถูกเขียนทับ</b> เมื่อ upload Excel ใหม่
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label style={lbl}>ผู้รับโอนสิทธิ (Assignment of Claim)</label>
          <select value={f.assignee} disabled={!canEdit} onChange={e => set('assignee', e.target.value)} style={pcInp}>{assignees.map(a => <option key={a} value={a}>{a || '— ไม่ระบุ —'}</option>)}</select></div>
        <div><label style={lbl}>Credit Term (วัน)</label>
          <input type="number" value={f.creditTerm} disabled={!canEdit} onChange={e => set('creditTerm', e.target.value)} style={pcInp} /></div>
        <div><label style={lbl}>LG Bank</label>
          <select value={f.lgBank} disabled={!canEdit} onChange={e => set('lgBank', e.target.value)} style={pcInp}>{banks.map(b => <option key={b} value={b}>{b || '— ไม่มี —'}</option>)}</select></div>
        <div><label style={lbl}>LG Amount (฿)</label>
          <input type="number" value={f.lgAmount} disabled={!canEdit} onChange={e => set('lgAmount', e.target.value)} style={pcInp} /></div>
        <div><label style={lbl}>LG ออกเมื่อ</label>
          <input type="date" value={f.lgIssue} disabled={!canEdit} onChange={e => set('lgIssue', e.target.value)} style={pcInp} /></div>
        <div><label style={lbl}>LG หมดอายุ</label>
          <input type="date" value={f.lgExpiry} disabled={!canEdit} onChange={e => set('lgExpiry', e.target.value)} style={pcInp} /></div>
        <div><label style={lbl}>ภาระหนี้คงค้าง (Outstanding Debt)</label>
          <input type="number" value={f.outstandingDebt} disabled={!canEdit} onChange={e => set('outstandingDebt', e.target.value)} style={pcInp} /></div>
        <div><label style={lbl}>หักหนี้ (Debt Deduction)</label>
          <input type="number" value={f.debtDeduction} disabled={!canEdit} onChange={e => set('debtDeduction', e.target.value)} style={pcInp} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Remark</label>
          <textarea value={f.remark} disabled={!canEdit} onChange={e => set('remark', e.target.value)} rows={2} style={{ ...pcInp, height: 'auto', padding: 8, resize: 'vertical' }} /></div>
      </div>
      {canEdit && <button onClick={() => onSave(row.contractNo, f)} style={{ ...pcBtn, background: 'var(--brand-600)', color: '#fff', border: 'none', height: 34 }}>💾 บันทึก Finance Master</button>}
      {!canEdit && <div style={{ fontSize: 11, color: '#94a3b8' }}>สิทธิ์อ่านอย่างเดียว — ไม่สามารถแก้ไขได้</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADVANCED FILTER (หลายเงื่อนไข AND/OR)
// ═══════════════════════════════════════════════════════════════════════════
function pcAdvFields() {
  return [
    { key: 'assignee', label: 'ผู้รับโอนสิทธิ', type: 'enum', get: r => r.assignee || '' },
    { key: 'status', label: 'สถานะหลัก', type: 'enum', get: r => r.status, fmt: v => (PCU.STATUS_META[v] && PCU.STATUS_META[v].th) || v },
    { key: 'projectStatus', label: 'สถานะย่อย', type: 'enum', get: r => r.projectStatus || '' },
    { key: 'fy', label: 'ปีงบ', type: 'enum', get: r => r.fy ? 'FY' + r.fy : '' },
    { key: 'region', label: 'ภูมิภาค', type: 'enum', get: r => r.regionEn || r.region || '' },
    { key: 'province', label: 'จังหวัด', type: 'enum', get: r => r.province || '' },
    { key: 'type', label: 'ประเภท', type: 'enum', get: r => r.type || '' },
    { key: 'lgBank', label: 'ธนาคาร LG', type: 'enum', get: r => (r.lg && r.lg.bank) || '' },
    { key: 'contractAmt', label: 'มูลค่าสัญญา (฿)', type: 'num', get: r => r.contractAmt || 0 },
    { key: 'outstandingAR', label: 'ยอดค้างรับ (฿)', type: 'num', get: r => r.outstandingAR || 0 },
    { key: 'received', label: 'รับแล้ว (฿)', type: 'num', get: r => r.received || 0 },
    { key: 'progress', label: 'ความคืบหน้า (%)', type: 'num', get: r => r.progress || 0 },
    { key: 'd1', label: 'ส่งมอบงวด 1 แล้ว', type: 'bool', get: r => !!r.d1 },
    { key: 'a1', label: 'ได้ใบตรวจรับ งวด 1', type: 'bool', get: r => !!r.a1 },
    { key: 'p1', label: 'รับเงินงวด 1 แล้ว', type: 'bool', get: r => !!r.p1 },
    { key: 'd2', label: 'ส่งมอบงวด 2 แล้ว', type: 'bool', get: r => !!r.d2 },
    { key: 'a2', label: 'ได้ใบตรวจรับ งวด 2', type: 'bool', get: r => !!r.a2 },
    { key: 'p2', label: 'รับเงินงวด 2 แล้ว', type: 'bool', get: r => !!r.p2 },
  ].concat(pcAdvRawFields());
}
// raw engineer columns ที่ฝ่ายการเงินมาร์กไว้ (web หรือ exp) → ฟิลเตอร์ได้ในขั้นสูง
function pcAdvRawFields() {
  const DUP = { 'Type': 1, 'Region': 1, 'Province': 1, 'มูลค่าสัญญาที่เซ็น (รวมVAT)': 1 };
  return (PCU.PC_COL_SPEC || []).filter(s => (s.web > 0 || s.exp > 0) && !DUP[s.key]).map(s => {
    const kind = PCU.pcColType(s.key);
    const type = (kind === 'money' || kind === 'pct') ? 'num' : kind === 'date' ? 'date' : 'enum';
    return { key: 'raw:' + s.key, label: s.cat + ' · ' + s.key, type, raw: true,
      get: ((kk, knd) => (r) => { const v = (r._raw || {})[kk]; if (knd === 'money' || knd === 'pct') return PCU.toNum(v) || 0; if (knd === 'date') return PCU.isoOf(v) || ''; return v == null ? '' : v; })(s.key, kind) };
  });
}
function pcApplyAdvanced(rows, conds, mode) {
  const active = (conds || []).filter(c => c.field && c.op);
  if (!active.length) return rows;
  const fields = {}; pcAdvFields().forEach(f => fields[f.key] = f);
  const test = (r, c) => {
    const f = fields[c.field]; if (!f) return true;
    const v = f.get(r);
    if (f.type === 'bool') return c.op === 'false' ? v === false : v === true;
    if (f.type === 'num') { const n = +v, t = +c.value; if (c.value === '' || isNaN(t)) return true; return c.op === 'lte' ? n <= t : c.op === 'eq' ? n === t : n >= t; }
    if (f.type === 'date') { if (!c.value) return true; const iso = String(v || ''); if (!iso) return false; return c.op === 'before' ? iso <= c.value : c.op === 'after' ? iso >= c.value : iso === c.value; }
    if (c.value == null || c.value === '') return true;
    return c.op === 'isNot' ? String(v) !== String(c.value) : String(v) === String(c.value);
  };
  return rows.filter(r => mode === 'OR' ? active.some(c => test(r, c)) : active.every(c => test(r, c)));
}
function PcAdvancedFilter({ rows, conds, mode, onApply, onClose }) {
  const fields = pcMemo(() => pcAdvFields(), []);
  const fmap = pcMemo(() => { const m = {}; fields.forEach(f => m[f.key] = f); return m; }, [fields]);
  const [cs, setCs] = pcSt(() => (conds && conds.length ? conds.map(c => ({ ...c })) : [{ field: 'assignee', op: 'is', value: '' }]));
  const [md, setMd] = pcSt(mode || 'AND');
  const optsFor = (fkey) => { const f = fmap[fkey]; if (!f) return []; const s = new Set(); rows.forEach(r => { const v = f.get(r); if (v !== '' && v != null) s.add(String(v)); }); return [...s].sort((a, b) => a.localeCompare(b, 'th')); };
  const opDefault = (t) => t === 'bool' ? 'true' : t === 'num' ? 'gte' : t === 'date' ? 'after' : 'is';
  const setRow = (i, patch) => setCs(cs => cs.map((c, k) => k === i ? { ...c, ...patch } : c));
  const addRow = () => setCs(cs => [...cs, { field: 'assignee', op: 'is', value: '' }]);
  const delRow = (i) => setCs(cs => cs.filter((_, k) => k !== i));
  const preview = pcMemo(() => pcApplyAdvanced(rows, cs, md).length, [rows, cs, md]);
  const sel = { height: 30, fontSize: 11.5, padding: '0 6px', border: '1px solid #d3dcea', borderRadius: 6, background: '#fff', outline: 'none' };
  const usePreset = () => { setMd('AND'); setCs([
    { field: 'assignee', op: 'is', value: 'LIT' }, { field: 'd1', op: 'true', value: '' }, { field: 'a1', op: 'true', value: '' }, { field: 'p1', op: 'false', value: '' },
  ]); };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,18,34,.42)', zIndex: 700, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 20px 20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(720px,97vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(13,31,58,.28)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,var(--brand-600),var(--brand-500))', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 16, fontWeight: 800 }}>ฟิลเตอร์ขั้นสูง</div><div style={{ fontSize: 10.5, opacity: .85 }}>กรองหลายเงื่อนไขพร้อมกัน · เช่น โอนสิทธิ LIT · ส่งงวด 1 · ได้ใบตรวจรับ · ยังไม่รับเงิน</div></div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', borderRadius: 8, width: 30, height: 30, display: 'grid', placeItems: 'center', cursor: 'pointer' }}><PcI.close size={16} /></button>
        </div>
        <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #eef2f7', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>ต้องตรง</span>
          <div style={{ display: 'inline-flex', border: '1px solid #d3dcea', borderRadius: 7, overflow: 'hidden' }}>
            {[['AND', 'ทุกเงื่อนไข'], ['OR', 'เงื่อนไขใดก็ได้']].map(([v, l]) => (
              <button key={v} onClick={() => setMd(v)} style={{ border: 'none', padding: '5px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: md === v ? 'var(--brand-500)' : '#fff', color: md === v ? '#fff' : '#475569' }}>{l}</button>
            ))}
          </div>
          <button onClick={usePreset} style={{ ...pcBtn, marginLeft: 'auto', fontSize: 11 }}>⚡ ตัวอย่าง: LIT ส่งงวด1·ตรวจรับ·ยังไม่รับเงิน</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cs.map((c, i) => {
            const f = fmap[c.field] || fields[0];
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', width: 26, textAlign: 'right' }}>{i === 0 ? '' : (md === 'OR' ? 'หรือ' : 'และ')}</span>
                <select value={c.field} onChange={e => { const nf = fmap[e.target.value]; setRow(i, { field: e.target.value, op: opDefault(nf.type), value: '' }); }} style={{ ...sel, minWidth: 150 }}>
                  {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                {f.type === 'bool' && (
                  <select value={c.op} onChange={e => setRow(i, { op: e.target.value })} style={{ ...sel, minWidth: 90 }}><option value="true">ใช่</option><option value="false">ไม่ใช่</option></select>
                )}
                {f.type === 'num' && (<>
                  <select value={c.op} onChange={e => setRow(i, { op: e.target.value })} style={{ ...sel, minWidth: 70 }}><option value="gte">≥</option><option value="lte">≤</option><option value="eq">=</option></select>
                  <input type="number" value={c.value} onChange={e => setRow(i, { value: e.target.value })} placeholder="ค่า" style={{ ...sel, width: 120 }} />
                </>)}
                {f.type === 'date' && (<>
                  <select value={c.op} onChange={e => setRow(i, { op: e.target.value })} style={{ ...sel, minWidth: 90 }}><option value="after">ตั้งแต่</option><option value="before">ก่อน</option><option value="on">ตรงวันที่</option></select>
                  <YmdPicker value={c.value} onChange={v => setRow(i, { value: v })} size="sm" />
                </>)}
                {f.type === 'enum' && (<>
                  <select value={c.op} onChange={e => setRow(i, { op: e.target.value })} style={{ ...sel, minWidth: 100 }}><option value="is">เท่ากับ</option><option value="isNot">ไม่เท่ากับ</option></select>
                  <select value={c.value} onChange={e => setRow(i, { value: e.target.value })} style={{ ...sel, minWidth: 150 }}>
                    <option value="">— เลือก —</option>
                    {optsFor(c.field).map(o => <option key={o} value={o}>{f.fmt ? f.fmt(o) : o}</option>)}
                  </select>
                </>)}
                <button onClick={() => delRow(i)} title="ลบเงื่อนไข" style={{ border: 'none', background: '#fef2f2', color: '#dc2626', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', flex: '0 0 auto' }}>✕</button>
              </div>
            );
          })}
          <button onClick={addRow} style={{ ...pcBtn, alignSelf: 'flex-start', marginTop: 4, color: 'var(--brand-700)', borderColor: 'var(--brand-200)' }}>+ เพิ่มเงื่อนไข</button>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #eef2f7', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>ตรงเงื่อนไข <b className="num" style={{ color: 'var(--brand-700)', fontSize: 15 }}>{preview.toLocaleString()}</b> / {rows.length.toLocaleString()} โครงการ</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => { setCs([]); onApply([], 'AND'); }} style={{ ...pcBtn, color: '#dc2626' }}>ล้างทั้งหมด</button>
            <button onClick={() => onApply(cs.filter(c => c.field && c.op), md)} style={{ ...pcBtn, background: 'var(--brand-600)', color: '#fff', border: 'none', padding: '0 18px' }}>ใช้ตัวกรอง</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UPLOAD DIFF (แจ้งเตือนความเปลี่ยนแปลงหลัง upload Excel)
// ═══════════════════════════════════════════════════════════════════════════
function PcUploadDiff({ diff, stats, onClose }) {
  const groups = [
    { key: 'signed', icon: '✍️', label: 'ลงนามใหม่', color: '#2e8b4a', bg: '#dceaff', items: diff.signed || [], hint: 'เปลี่ยนจาก “รอลงนาม” → มีเลขสัญญาจริง' },
    { key: 'added', icon: '➕', label: 'โครงการใหม่', color: '#15803d', bg: '#dcfce7', items: diff.added || [], hint: 'เลขสัญญาที่ไม่เคยมีในระบบ' },
    { key: 'cancelled', icon: '🔴', label: 'ยกเลิกเพิ่ม', color: '#b91c1c', bg: '#fee2e2', items: diff.cancelled || [], hint: 'เพิ่งถูกตั้งสถานะยกเลิกในไฟล์นี้' },
    { key: 'missing', icon: '➖', label: 'โครงการหายไป', color: '#b45309', bg: '#ffedd5', items: diff.missing || [], hint: 'มีในระบบเดิม แต่ไม่อยู่ในไฟล์ใหม่ (ยังคงเก็บไว้ ไม่ลบ)' },
  ];
  const [open, setOpen] = pcSt(groups.find(g => g.items.length) ? groups.find(g => g.items.length).key : null);
  const nothing = groups.every(g => !g.items.length);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,18,34,.42)', zIndex: 720, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(560px,96vw)', maxHeight: '84vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(13,31,58,.28)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,var(--brand-600),var(--brand-500))', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 16, fontWeight: 800 }}>อัปโหลดสำเร็จ · สรุปการเปลี่ยนแปลง</div><div style={{ fontSize: 10.5, opacity: .85 }}>{stats.totalRows} โครงการในไฟล์ · คงไว้ {stats.keptCount} · ข้ามแถวว่าง {stats.ghostCount}</div></div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', borderRadius: 8, width: 30, height: 30, display: 'grid', placeItems: 'center', cursor: 'pointer' }}><PcI.close size={16} /></button>
        </div>
        <div style={{ padding: 14, display: 'flex', gap: 8 }}>
          {groups.map(g => (
            <div key={g.key} style={{ flex: 1, background: g.bg, borderRadius: 10, padding: '9px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 17 }}>{g.icon}</div>
              <div className="num" style={{ fontSize: 19, fontWeight: 800, color: g.color }}>{g.items.length}</div>
              <div style={{ fontSize: 10, color: g.color, fontWeight: 600 }}>{g.label}</div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 14px 14px' }}>
          {nothing && <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12.5, padding: 24 }}>ไม่มีการเปลี่ยนแปลงด้านสถานะ · ข้อมูลถูกอัปเดตเรียบร้อย</div>}
          {groups.filter(g => g.items.length).map(g => (
            <div key={g.key} style={{ border: '1px solid #e6ecf4', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
              <button onClick={() => setOpen(open === g.key ? null : g.key)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: 'none', background: '#f8fafc', cursor: 'pointer', textAlign: 'left' }}>
                <span>{g.icon}</span><b style={{ fontSize: 12.5, color: g.color }}>{g.label} ({g.items.length})</b>
                <span style={{ marginLeft: 'auto', transform: open === g.key ? 'rotate(180deg)' : 'none', color: '#94a3b8' }}><PcI.chevron size={14} /></span>
              </button>
              {open === g.key && (
                <div style={{ padding: '4px 12px 10px' }}>
                  <div style={{ fontSize: 10.5, color: '#94a3b8', margin: '2px 0 8px' }}>{g.hint}</div>
                  {g.items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: 11.5 }}>
                      <span className="num" style={{ color: 'var(--brand-700)', fontWeight: 600, minWidth: 76, flex: '0 0 auto' }}>{/^(XL|WS)-/i.test(it.code) ? '(ไม่มีเลข)' : it.code}</span>
                      <span style={{ color: 'var(--ink-900)' }}>{it.name.replace(/^[A-Z0-9\-]+ · /, '')}{it.prev ? <span style={{ color: '#94a3b8' }}> · เดิม {it.prev}</span> : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #eef2f7', textAlign: 'right' }}>
          <button onClick={onClose} style={{ ...pcBtn, background: 'var(--brand-600)', color: '#fff', border: 'none', padding: '0 20px' }}>รับทราบ</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════
const PC_STATE_KEY = 'wtp-pc-gridstate-v3';
function pcDefaultState() {
  return { order: PCGrid.makeColumns().map(c => c.id), hidden: PCGrid.makeColumns().map(c => c.id).filter(id => !PCGrid.DEFAULT_VISIBLE.includes(id)),
    frozen: PCGrid.DEFAULT_FROZEN.slice(), widths: {}, sort: [], colFilters: {}, page: 1, pageSize: 50, cf: true, density: 'compact' };
}
function pcLoadState() {
  try { const s = JSON.parse(localStorage.getItem(PC_STATE_KEY)); if (s && s.order) return { ...pcDefaultState(), ...s, page: 1 }; } catch (_) {}
  return pcDefaultState();
}

function ProjectControlPage({ data, setData, toast }) {
  const canEdit = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;
  const [fy, setFy] = pcSt([]);
  const [statusFilter, setStatusFilter] = pcSt(null);
  const [searchInput, setSearchInput] = pcSt('');
  const [search, setSearch] = pcSt('');
  const [gridState, setGridState] = pcSt(pcLoadState);
  const [drawerRow, setDrawerRow] = pcSt(null);
  const [finVer, setFinVer] = pcSt(0);
  const [localProjects, setLocalProjects] = pcSt(() => PCU.loadLocalProjects());
  const [uploadInfo, setUploadInfo] = pcSt(null); // { status, msg }
  const [busy, setBusy] = pcSt(false);
  const [advConds, setAdvConds] = pcSt([]);
  const [advMode, setAdvMode] = pcSt('AND');
  const [advOpen, setAdvOpen] = pcSt(false);
  const [diffModal, setDiffModal] = pcSt(null); // { diff, stats }
  const fileRef = pcRef();

  pcEff(() => { const t = setTimeout(() => setSearch(searchInput), 180); return () => clearTimeout(t); }, [searchInput]);
  pcEff(() => { try { localStorage.setItem(PC_STATE_KEY, JSON.stringify(gridState)); } catch (_) {} }, [gridState]);
  // re-derive เมื่อ Finance Master sync เข้ามา (เครื่องอื่นแก้ → cloud → เห็นเหมือนกัน)
  pcEff(() => {
    const h = (e) => { if (!e.detail || !e.detail.key || String(e.detail.key).indexOf('pcfin.') === 0 || e.detail.key === '*') setFinVer(v => v + 1); };
    window.addEventListener('wtp-override-change', h);
    return () => window.removeEventListener('wtp-override-change', h);
  }, []);

  // ใช้ snapshot ที่ upload (มีคอลัมน์เต็ม) เป็นฐานถ้ามี — ไม่งั้น fall back cloud
  // ★ กัน snapshot เก่าค้าง (เคสรายงาน: local 319 < ชีต 648 → หน้ายึด 319 ไปตลอด
  //   ไม่รับของจริงจากชีต → "ข้อมูลโครงการไม่ขึ้น/หาย"): ถ้า data.projects (sync) มีแถว
  //   มากกว่า snapshot ในเครื่อง = snapshot เก่า/ตกค้าง → ใช้ของ sync แทน. หลัง 2026-06-12
  //   ชีต sync มีคอลัมน์เต็มแล้วจึงปลอดภัย (เหมือน freshestRows ใน data_sync.js).
  const _localProj  = (localProjects && localProjects.length) ? localProjects : [];
  const _syncedProj = data.projects || [];
  const baseProjects = _syncedProj.length > _localProj.length
    ? _syncedProj
    : (_localProj.length ? _localProj : _syncedProj);
  const allCols = pcMemo(() => PCGrid.makeColumns(), []);
  const allProjects = pcMemo(() => PCU.deriveProjects(baseProjects, data.invoices || [], data.receipts || []),
    [baseProjects, data.invoices, data.receipts, data.manualOverrides, finVer]);

  const topRows = pcMemo(() => {
    let r = allProjects;
    if (fy.length) r = r.filter(x => fy.includes(x.fy));
    if (statusFilter) r = r.filter(x => x.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase().split(/\s+/).filter(Boolean);
      r = r.filter(x => {
        const hay = [x.site, x.contractNo, x.projectNo, x.tenderNo, x.province, x.regionEn, x.type, x.status, x.projectStatus, x.assignee, x.customer, x.contractAmt, x.fy].join(' ').toLowerCase();
        return q.every(t => hay.includes(t));
      });
    }
    if (advConds.length) r = pcApplyAdvanced(r, advConds, advMode);
    return r;
  }, [allProjects, fy, statusFilter, search, advConds, advMode]);

  const summary = pcMemo(() => PCU.summarize(topRows), [topRows]);
  const visibleColObjs = pcMemo(() => gridState.order.map(id => allCols.find(c => c.id === id)).filter(c => c && !gridState.hidden.includes(c.id)), [gridState.order, gridState.hidden, allCols]);

  const fyCounts = pcMemo(() => { const m = { 67: 0, 68: 0, 69: 0 }; allProjects.forEach(p => { if (m[p.fy] != null) m[p.fy]++; }); return m; }, [allProjects]);

  const saveFinance = (contractNo, f) => {
    PCU.setFinanceField(contractNo, f);
    setFinVer(v => v + 1);
    toast && toast('บันทึก Finance Master แล้ว · ' + contractNo);
  };

  const onUpload = async (file) => {
    if (!file) return;
    setBusy(true); setUploadInfo({ status: 'loading', msg: 'กำลังอ่านไฟล์ ' + file.name + '…' });
    try {
      const buf = await file.arrayBuffer();
      const { merged, stats, diff } = PCU.parseProjectControl(buf, baseProjects);
      if (!merged.length) throw new Error('ไม่พบโครงการในไฟล์');
      // 1) เก็บ snapshot ลง localStorage (รอด cloud sync, มีคอลัมน์เต็ม)
      PCU.saveLocalProjects(merged);
      setLocalProjects(merged);
      // 2) push เข้า cloud sheet (ทีมเห็นเหมือนกัน) — Finance Master ไม่ถูกแตะ (แยก localStorage)
      setData(d => ({ ...d, projects: merged }));
      setFinVer(v => v + 1); // recalc forecast/dashboard
      if (diff) setDiffModal({ diff, stats }); // แสดงสรุปความเปลี่ยนแปลง
      toast && toast('อัปโหลด Project Control สำเร็จ · ' + stats.totalRows + ' โครงการ');
      // 2b) ดันขึ้นชีทตรงๆ ด้วย replaceAll ของข้อมูลที่เพิ่งอ่าน (merged = คอลัมน์เต็ม)
      //     ชัวร์กว่า debounce/row-diff sync ที่เคยไม่ขยายคอลัมน์ + เช็คชีทกลับให้
      await pushProjectsToSheet(merged, stats);
    } catch (e) {
      console.error(e);
      setUploadInfo({ status: 'err', msg: 'อ่านไฟล์ไม่สำเร็จ: ' + (e.message || e) });
      setTimeout(() => setUploadInfo(null), 7000);
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  // ดันข้อมูลเต็ม (คอลัมน์ครบ) ขึ้น Google Sheet โดยตรงด้วย replaceAll แล้วอ่านชีทกลับ
  // มานับคอลัมน์เพื่อยืนยัน — ชัวร์กว่า debounce/row-diff sync · ใช้ทั้งตอน upload + ปุ่ม
  const pushProjectsToSheet = async (rows, stats) => {
    if (!rows || !rows.length) return;
    const url = window.WTP_CONFIG && WTP_CONFIG.APPS_SCRIPT_URL;
    if (!url) { setUploadInfo({ status: 'err', msg: 'ยังไม่ได้ตั้งค่า APPS_SCRIPT_URL' }); return; }
    setUploadInfo({ status: 'loading', msg: 'กำลังดันข้อมูลขึ้น Google Sheet…' });
    try {
      const body = { action: 'replaceAll', entity: 'projects', payload: rows, allowShrink: true, meta: { user: 'push-full-cols' } };
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(x => x.json());
      if (r && r.error) { setUploadInfo({ status: 'err', msg: 'ดันขึ้นชีทไม่สำเร็จ: ' + r.error }); setTimeout(() => setUploadInfo(null), 12000); return; }
      let sheetCols = '?';
      try { const after = await window.WTPData.fetchSheetRows('projects'); if (after && after[0]) sheetCols = Object.keys(after[0]).length; } catch (_) {}
      const pre = stats ? `อัปเดต ${stats.totalRows} โครงการ · ` : '';
      if (sheetCols !== '?' && sheetCols < 80) {
        setUploadInfo({ status: 'err', msg: pre + '⚠ ขึ้นชีทแล้วแต่มีแค่ ' + sheetCols + ' คอลัมน์ — backend (Code.standalone.gs) ที่ deploy ยังเป็นตัวเก่า (คอลัมน์ไม่ครบ) ต้อง re-deploy ตัวล่าสุดก่อน แล้วลองใหม่' });
        setTimeout(() => setUploadInfo(null), 16000);
      } else {
        // ดึงข้อมูลจากชีทกลับมาตั้งเป็น baseline → local ตรงกับ server → กัน sync วน push ซ้ำ
        try { if (window.WTPData && WTPData.refreshFromServer) WTPData.refreshFromServer(); } catch (_) {}
        setUploadInfo({ status: 'ok', msg: '✅ ' + pre + 'ขึ้นชีทสำเร็จ · ชีทมี ' + sheetCols + ' คอลัมน์ · รีเฟรช (Ctrl+Shift+R) เพื่อดูงวดงานครบทุกโครง ทุกเครื่อง' });
        toast && toast('ดันข้อมูลขึ้นชีทสำเร็จ · ' + sheetCols + ' คอลัมน์');
        setTimeout(() => setUploadInfo(null), 14000);
      }
    } catch (e) {
      setUploadInfo({ status: 'err', msg: 'ดันขึ้นชีทไม่สำเร็จ: ' + (e.message || e) });
      setTimeout(() => setUploadInfo(null), 12000);
    }
  };

  // ปุ่ม "ดันคอลัมน์เต็มขึ้นชีท" — ใช้ snapshot ในเครื่อง (กรณี sync ก่อนหน้าไม่ขึ้น)
  const forcePushFull = async () => {
    const snap = PCU.loadLocalProjects();
    if (!snap || !snap.length) { toast && toast('เครื่องนี้ยังไม่มีข้อมูลเต็ม — กรุณากด Upload Excel ก่อน'); return; }
    const cols = Object.keys(snap[0] || {}).length;
    if (!window.confirm('ดันข้อมูลโครงการ ' + snap.length + ' รายการ (' + cols + ' คอลัมน์) ขึ้น Google Sheet?\n\nจะเขียนทับตาราง projects (Finance Master แยกต่างหาก ไม่ถูกแตะ)')) return;
    setBusy(true);
    try { await pushProjectsToSheet(snap, null); } finally { setBusy(false); }
  };

  const scopeLabel = [
    fy.length ? fy.map(x => 'FY' + x).join('/') : 'ทุกปีงบ',
    statusFilter ? (PCU.STATUS_META[statusFilter] && PCU.STATUS_META[statusFilter].th || statusFilter) : null,
    advConds.length ? ('ฟิลเตอร์ขั้นสูง ' + advConds.length + ' เงื่อนไข') : null,
    search ? ('ค้นหา “' + search + '”') : null,
  ].filter(Boolean).join(' · ');

  const fyBtn = (val, label) => {
    const active = val === 'all' ? fy.length === 0 : fy.includes(val);
    return (
      <button key={val} onClick={() => { if (val === 'all') setFy([]); else setFy(f => f.includes(val) ? f.filter(x => x !== val) : [...f, val]); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 11px', borderRadius: 7, border: '1px solid ' + (active ? 'transparent' : 'rgba(255,255,255,.25)'), background: active ? '#fff' : 'rgba(255,255,255,.1)', color: active ? 'var(--brand-700)' : 'rgba(255,255,255,.9)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
        {label}{val !== 'all' && <span className="num" style={{ fontSize: 10, opacity: .65 }}>{fyCounts[val]}</span>}
      </button>
    );
  };

  return (
    <div className="page present-page" style={{ maxWidth: 1680, padding: '0 0 40px' }}>
      {/* ===== blue toolbar (page header) ===== */}
      <div style={{ background: 'linear-gradient(135deg,var(--brand-600),var(--brand-500))', borderRadius: 16, padding: '14px 18px', color: '#fff', boxShadow: '0 10px 26px rgba(35,72,150,.22)', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,.18)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="13" width="4" height="8" rx="1" fill="#fff" opacity=".8" /><rect x="10" y="8" width="4" height="13" rx="1" fill="#fff" /><rect x="17" y="4" width="4" height="17" rx="1" fill="#fff" opacity=".7" /></svg>
            </div>
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Project Control</div>
              <div style={{ fontSize: 10.5, opacity: .75 }}>ระบบติดตามโครงการ · Engineering & Finance</div>
            </div>
          </div>
          <div style={{ flex: 1, maxWidth: 460, position: 'relative', minWidth: 200 }}>
            <PcI.search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,.6)' }} />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="ค้นหา โครงการ · เลขสัญญา · จังหวัด · ธนาคาร…"
              style={{ width: '100%', height: 36, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.22)', borderRadius: 9, color: '#fff', fontSize: 12.5, padding: '0 12px 0 34px', outline: 'none' }} />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right', lineHeight: 1.15 }}>
              <div style={{ fontSize: 9, opacity: .7, textTransform: 'uppercase' }}>ในมุมมอง</div>
              <div className="num" style={{ fontSize: 12, fontWeight: 700 }}>{topRows.length.toLocaleString()} / {allProjects.length.toLocaleString()}</div>
            </div>
            {canEdit && <>
              <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => onUpload(e.target.files[0])} />
              <button disabled={busy} onClick={forcePushFull} title="ดันข้อมูลคอลัมน์เต็มจากเครื่องนี้ขึ้น Google Sheet (ใช้เมื่องวดงานยังไม่ขึ้นให้ทีม) — ต้องเคย Upload Excel บนเครื่องนี้ก่อน"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? .7 : 1 }}>
                ⬆️ ดันคอลัมน์เต็มขึ้นชีท</button>
              <button disabled={busy} onClick={() => fileRef.current.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 14px', borderRadius: 9, border: 'none', background: '#0e9f9a', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? .7 : 1 }}>
                <PcI.upload size={15} style={busy ? { animation: 'pcspin 1s linear infinite' } : {}} />{busy ? 'กำลังอ่าน…' : 'Upload Excel'}</button>
            </>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 11, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, opacity: .65, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 600 }}>ปีงบประมาณ</span>
          <div style={{ display: 'flex', gap: 5 }}>{fyBtn('all', 'ทั้งหมด')}{fyBtn(67, 'FY67')}{fyBtn(68, 'FY68')}{fyBtn(69, 'FY69')}</div>
          {advConds.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: 'rgba(255,255,255,.22)', borderRadius: 7, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }}><PcI.filter size={11} />ฟิลเตอร์ขั้นสูง {advConds.length} เงื่อนไข</span>}
          {(statusFilter || search || advConds.length > 0) && <button onClick={() => { setStatusFilter(null); setSearchInput(''); setSearch(''); setAdvConds([]); }} style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: 'rgba(255,255,255,.16)', border: 'none', borderRadius: 7, padding: '3px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><PcI.close size={11} />ล้างตัวกรอง{statusFilter ? ' · ' + (PCU.STATUS_META[statusFilter]?.th || statusFilter) : ''}</button>}
        </div>
      </div>

      {/* ===== sections ===== */}
      <PcBand n="01" en="Executive KPI" th="ตัวชี้วัดผู้บริหาร" />
      <PcKpiSection summary={summary} filterStatus={statusFilter} onFilterStatus={s => setStatusFilter(p => p === s ? null : s)} />

      <div className="pc-row2" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 14, marginTop: 4 }}>
        <div><PcBand n="02" en="Status Funnel" th="สถานะโครงการ" /><PcFunnel rows={topRows} onPick={(th) => setGridState(s => ({ ...s, colFilters: { ...s.colFilters, projectStatus: { kind: 'set', values: [th] } }, page: 1 }))} /></div>
        <div><PcBand n="03" en="Cashflow Forecast" th="กระแสเงินสด" /><PcCashflow rows={topRows} /></div>
      </div>

      <PcBand n="04" en="LG Monitoring" th="หลักประกัน" />
      <PcLgSection rows={topRows} />

      <PcBand n="05" en="Project Register" th="ทะเบียนโครงการ — Excel-grade Data Grid" />
      <div style={{ marginBottom: 8 }}><PcGridToolbar allCols={allCols} state={gridState} setState={setGridState} rows={topRows} visibleColObjs={visibleColObjs} scopeLabel={scopeLabel} onAdvanced={() => setAdvOpen(true)} advCount={advConds.length} /></div>
      <PcGrid rows={topRows} allCols={allCols} state={gridState} setState={setGridState} onOpenRow={setDrawerRow} />

      {drawerRow && <PcDrawer row={drawerRow} canEdit={canEdit} onClose={() => setDrawerRow(null)} onSaveFinance={saveFinance} />}
      {advOpen && <PcAdvancedFilter rows={allProjects} conds={advConds} mode={advMode} onApply={(c, m) => { setAdvConds(c); setAdvMode(m); setAdvOpen(false); }} onClose={() => setAdvOpen(false)} />}
      {diffModal && <PcUploadDiff diff={diffModal.diff} stats={diffModal.stats} onClose={() => setDiffModal(null)} />}

      {uploadInfo && (() => {
        const c = uploadInfo.status === 'ok' ? '#16a34a' : uploadInfo.status === 'err' ? '#dc2626' : 'var(--brand-600)';
        const I = uploadInfo.status === 'ok' ? PcI.check : uploadInfo.status === 'err' ? PcI.alert : PcI.refresh;
        return (
          <div style={{ position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 800, background: '#fff', border: '1px solid #d3dcea', borderLeft: '4px solid ' + c, borderRadius: 11, boxShadow: '0 16px 44px rgba(13,31,58,.16)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 11, maxWidth: 620 }}>
            <span style={{ color: c, display: 'grid', placeItems: 'center' }}><I size={18} style={uploadInfo.status === 'loading' ? { animation: 'pcspin 1s linear infinite' } : {}} /></span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-900)', fontWeight: 500 }}>{uploadInfo.msg}</span>
          </div>
        );
      })()}
    </div>
  );
}

// responsive
(function () {
  const el = document.createElement('style');
  el.textContent = `@keyframes pcspin{to{transform:rotate(360deg)}}
@media(max-width:1280px){.pc-kpi-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}}
@media(max-width:1080px){.pc-row2{grid-template-columns:1fr!important}}
@media(max-width:720px){.pc-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}`;
  document.head.appendChild(el);
})();

window.ProjectControlPage = ProjectControlPage;


