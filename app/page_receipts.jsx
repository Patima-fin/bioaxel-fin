/* page_receipts.jsx — ประวัติรับเงิน (Receipts History) */
'use strict';

/* ── Helpers ─────────────────────────────────────────────────────────── */
const RC_MONTH_FULL = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม',
  'มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const RC_MONTH_SHORT = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.',
  'มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function rcMonth(dateStr) {
  return dateStr ? parseInt(dateStr.slice(5,7), 10) : 0;
}
function rcYear(dateStr) {
  return dateStr ? parseInt(dateStr.slice(0,4), 10) : 0;
}

/* ── Sub-components ──────────────────────────────────────────────────── */
function RcKpi({ label, value, sub, color, highlight }) {
  return (
    <div className="kpi" style={highlight ? { border:'2px solid '+color, boxShadow:'0 0 0 3px '+color+'22' } : {}}>
      <div className="kpi-accent" style={{ background: color }} />
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize:17, color: highlight ? color : undefined }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--ink-400)', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

/* Monthly reconcile row — compares receipt aggregates vs ytdRevenue entry */
function ReconcileRow({ monthNo, receiptsInMonth, ytdEntry }) {
  const gross    = receiptsInMonth.reduce(function(s,r){ return s+(parseFloat(r.grossAmount)||0); }, 0);
  const deduct   = receiptsInMonth.reduce(function(s,r){ return s+(parseFloat(r.transferDeduction)||0); }, 0);
  const net      = receiptsInMonth.reduce(function(s,r){ return s+(parseFloat(r.netReceived)||0); }, 0);
  const count    = receiptsInMonth.length;

  // compare vs ytdRevenue (debt stored as negative in ytdRevenue)
  const ytdGross = ytdEntry ? (parseFloat(ytdEntry.gross)||0) : null;
  const ytdDebt  = ytdEntry ? Math.abs(parseFloat(ytdEntry.debt)||0) : null;
  const ytdNet   = ytdEntry ? (parseFloat(ytdEntry.net)||0) : null;

  const grossOk  = ytdGross === null || Math.abs(gross - ytdGross) < 1;
  const netOk    = ytdNet   === null || Math.abs(net   - ytdNet)   < 1;
  const allOk    = grossOk && netOk;

  return (
    <tr style={{ borderBottom:'1px solid #f0f4f8' }}>
      <td style={{ padding:'8px 12px', fontWeight:600, fontSize:13, whiteSpace:'nowrap' }}>
        {RC_MONTH_FULL[monthNo]}
      </td>
      <td style={{ padding:'8px 12px', textAlign:'center', color:'#718096', fontSize:12 }}>{count}</td>
      <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontSize:13 }}>
        {fmtMoney(gross)}
        {ytdGross !== null && !grossOk &&
          <div style={{ fontSize:10, color:'#e53e3e' }}>ytd: {fmtMoney(ytdGross)}</div>}
      </td>
      <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontSize:13, color: deduct > 0 ? '#c53030' : '#a0aec0' }}>
        {deduct > 0 ? ('−'+fmtMoney(deduct)) : '—'}
        {ytdDebt !== null && deduct > 0 && Math.abs(deduct - ytdDebt) >= 1 &&
          <div style={{ fontSize:10, color:'#e53e3e' }}>ytd: {fmtMoney(ytdDebt)}</div>}
      </td>
      <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontSize:13, fontWeight:600, color:'#276749' }}>
        {fmtMoney(net)}
        {ytdNet !== null && !netOk &&
          <div style={{ fontSize:10, color:'#e53e3e' }}>ytd: {fmtMoney(ytdNet)}</div>}
      </td>
      <td style={{ padding:'8px 12px', textAlign:'center' }}>
        {ytdEntry
          ? allOk
            ? <span style={{ background:'#c6f6d5', color:'#276749', fontSize:11, fontWeight:700, borderRadius:20, padding:'2px 10px' }}>✓ ตรง</span>
            : <span style={{ background:'#fef3c7', color:'#b45309', fontSize:11, fontWeight:700, borderRadius:20, padding:'2px 10px' }}>⚠ ต่าง</span>
          : <span style={{ color:'#a0aec0', fontSize:11 }}>—</span>
        }
      </td>
    </tr>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────── */
const ReceiptsPage = ({ data }) => {
  const receipts   = React.useMemo(function(){
    return (data.receipts || []).slice().sort(function(a,b){ return a.receiptDate > b.receiptDate ? 1 : -1; });
  }, [data.receipts]);

  const ytdRevenue = data.ytdRevenue || [];

  // ytdRevenue mapped by Thai month name → entry
  const ytdByMonth = React.useMemo(function(){
    var m = {};
    ytdRevenue.forEach(function(y){ m[y.month] = y; });
    return m;
  }, [ytdRevenue]);

  // Group receipts by month number
  const byMonth = React.useMemo(function(){
    var m = {};
    receipts.forEach(function(r){
      var mo = rcMonth(r.receiptDate);
      if (!m[mo]) m[mo] = [];
      m[mo].push(r);
    });
    return m;
  }, [receipts]);

  const monthNos = Object.keys(byMonth).map(Number).sort(function(a,b){ return a-b; });

  // Grand totals
  const totalGross  = receipts.reduce(function(s,r){ return s+(parseFloat(r.grossAmount)||0); }, 0);
  const totalDeduct = receipts.reduce(function(s,r){ return s+(parseFloat(r.transferDeduction)||0); }, 0);
  const totalNet    = receipts.reduce(function(s,r){ return s+(parseFloat(r.netReceived)||0); }, 0);

  // Filters
  const [filterMonth, setFilterMonth] = React.useState('all');
  const [filterYear, setFilterYear]   = React.useState('all');
  const [search, setSearch]           = React.useState('');

  // ปีที่มีข้อมูล (ค.ศ.) เรียงใหม่→เก่า
  const yearNos = React.useMemo(function(){
    var ys = {};
    receipts.forEach(function(r){ var y = rcYear(r.receiptDate); if (y) ys[y] = 1; });
    return Object.keys(ys).map(Number).sort(function(a,b){ return b-a; });
  }, [receipts]);

  const filtered = React.useMemo(function(){
    return receipts.filter(function(r){
      if (filterYear !== 'all' && rcYear(r.receiptDate) !== parseInt(filterYear,10)) return false;
      if (filterMonth !== 'all' && rcMonth(r.receiptDate) !== parseInt(filterMonth,10)) return false;
      if (search){
        var q = search.toLowerCase();
        return (r.receiptNo||'').toLowerCase().includes(q)
          || (r.invoiceNo||'').toLowerCase().includes(q)
          || (r.projectCode||'').toLowerCase().includes(q)
          || (r.projectName||'').toLowerCase().includes(q)
          || (r.note||'').toLowerCase().includes(q);
      }
      return true;
    });
  }, [receipts, filterMonth, filterYear, search]);

  // Deduction rate
  const deductPct = totalGross > 0 ? (totalDeduct / totalGross * 100).toFixed(1) : '0.0';

  const inp = { padding:'7px 11px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, fontFamily:'inherit', outline:'none', background:'#fff' };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">ประวัติรับเงิน</div>
          <div className="page-sub">Receipts — ยอดรับจริงแต่ละใบแจ้งหนี้ หักโอนสิทธิธนาคาร</div>
        </div>
        <div className="page-head-r">
          <ExportButton
            rows={filtered}
            columns={[
              { key: 'receiptNo',          label: 'เลขที่ใบรับ' },
              { key: 'receiptDate',        label: 'วันที่รับเงิน', type: 'date' },
              { key: 'invoiceNo',          label: 'เลขที่ IV' },
              { key: 'projectCode',        label: 'รหัสโครงการ' },
              { key: 'projectName',        label: 'ชื่อโครงการ' },
              { key: 'grossAmount',        label: 'ยอดรับ Gross (฿)', type: 'number' },
              { key: 'transferDeduction',  label: 'หักโอนสิทธิ (฿)',  type: 'number' },
              { key: 'netAmount',          label: 'เงินเข้าจริง Net (฿)', type: 'number' },
              { key: 'bankName',           label: 'ธนาคารที่รับ' },
              { key: 'remark',             label: 'หมายเหตุ' },
            ]}
            filename="receipts"
            sheetName="ประวัติรับเงิน"
            title="ประวัติรับเงิน · Receipts"
          />
          <PrintButton />
        </div>
      </div>

      {/* ── KPI ── */}
      <div className="grid grid-4" style={{ marginBottom:16 }}>
        <RcKpi label="ยอดรับรวม (Gross)"     value={fmtMoney(totalGross)}  sub={receipts.length+' ใบรับ'} color="var(--brand-500)" />
        <RcKpi label="หักโอนสิทธิธนาคาร"    value={fmtMoney(totalDeduct)} sub={deductPct+'% ของยอดรับ'} color="#c53030" highlight={totalDeduct > 0} />
        <RcKpi label="เงินเข้าจริง (Net)"    value={fmtMoney(totalNet)}    sub="WTP ได้รับสุทธิ" color="#276749" />
        <RcKpi label="เดือนที่มีข้อมูล"       value={monthNos.length}       sub={'เทียบ ytdRevenue '+ytdRevenue.length+' เดือน'} color="oklch(60% 0.18 55)" />
      </div>

      {/* ── Monthly Reconcile ── */}
      {ytdRevenue.length > 0 && (
        <div className="card" style={{ marginBottom:20, padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', background:'linear-gradient(135deg,#f0fdf4,#dcfce7)', borderBottom:'1px solid #86efac', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontWeight:700, fontSize:14, color:'#166534' }}>สรุปรายเดือน — เทียบ ytdRevenue</div>
              <div style={{ fontSize:12, color:'#4ade80', marginTop:2 }}>ตรวจว่าตัวเลข match กับข้อมูล War Room</div>
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f0fdf4' }}>
                  {['เดือน','รายการ','ยอดรับ (Gross)','หักโอนสิทธิ','เงินเข้าจริง (Net)','เทียบ ytdRevenue'].map(function(h,i){
                    return <th key={i} style={{ padding:'7px 12px', textAlign: i>=2&&i<=4 ? 'right' : i===1 ? 'center' : 'left', fontWeight:600, color:'#166534', borderBottom:'1px solid #86efac', whiteSpace:'nowrap', fontSize:11 }}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {monthNos.map(function(mo){
                  var ytdEntry = ytdByMonth[RC_MONTH_FULL[mo]] || null;
                  return <ReconcileRow key={mo} monthNo={mo} receiptsInMonth={byMonth[mo]} ytdEntry={ytdEntry} />;
                })}
                {/* Grand total row */}
                <tr style={{ background:'#f0fdf4', borderTop:'2px solid #86efac' }}>
                  <td style={{ padding:'9px 12px', fontWeight:700, fontSize:13 }}>รวมทั้งหมด</td>
                  <td style={{ padding:'9px 12px', textAlign:'center', fontWeight:700 }}>{receipts.length}</td>
                  <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:700, fontVariantNumeric:'tabular-nums', fontSize:13 }}>{fmtMoney(totalGross)}</td>
                  <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:700, fontVariantNumeric:'tabular-nums', fontSize:13, color:'#c53030' }}>{totalDeduct > 0 ? ('−'+fmtMoney(totalDeduct)) : '—'}</td>
                  <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:700, fontVariantNumeric:'tabular-nums', fontSize:13, color:'#276749' }}>{fmtMoney(totalNet)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Filter bar ── */}
      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <select style={inp} value={filterYear} onChange={function(e){ setFilterYear(e.target.value); }}>
          <option value="all">ทุกปี</option>
          {yearNos.map(function(y){ return <option key={y} value={y}>{y}</option>; })}
        </select>
        <select style={inp} value={filterMonth} onChange={function(e){ setFilterMonth(e.target.value); }}>
          <option value="all">ทุกเดือน</option>
          {monthNos.map(function(mo){ return <option key={mo} value={mo}>{RC_MONTH_FULL[mo]}</option>; })}
        </select>
        <input style={{ ...inp, flex:1, minWidth:200 }} placeholder="ค้นหา เลขรับเงิน / IV / โครงการ / หมายเหตุ…"
          value={search} onChange={function(e){ setSearch(e.target.value); }} />
        <span style={{ fontSize:12, color:'#718096' }}>{filtered.length} รายการ</span>
      </div>

      {/* ── Detail Table ── */}
      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['วันที่','เลขรับเงิน','เลขแจ้งหนี้','โครงการ','งวด','ยอดรับ (Gross)','หักโอนสิทธิ','เงินเข้าจริง','บัญชีรับเงิน','หมายเหตุ'].map(function(h,i){
                  var right = i>=5&&i<=7;
                  return <th key={i} style={{ padding:'8px 12px', textAlign:right?'right':'left', fontWeight:600, color:'#475569', borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap', fontSize:11 }}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ padding:'24px', textAlign:'center', color:'#a0aec0' }}>ไม่พบรายการ</td></tr>
              )}
              {filtered.map(function(r, i){
                var hasDeduct = (parseFloat(r.transferDeduction)||0) > 0;
                var isFirst = i === 0 || rcMonth(filtered[i-1].receiptDate) !== rcMonth(r.receiptDate);
                return [
                  isFirst ? (
                    <tr key={'hd-'+r.id} style={{ background:'linear-gradient(90deg,#eff6ff,#f8fafc)' }}>
                      <td colSpan={10} style={{ padding:'7px 12px', fontWeight:700, fontSize:12, color:'#2a6fdb', borderBottom:'1px solid #e2e8f0', borderTop: i>0?'2px solid #bfdbfe':undefined }}>
                        {RC_MONTH_FULL[rcMonth(r.receiptDate)]} {rcYear(r.receiptDate)}
                      </td>
                    </tr>
                  ) : null,
                  <tr key={r.id} style={{ borderBottom:'1px solid #f0f4f8', background: hasDeduct ? '#fff9f9' : 'transparent' }}>
                    <td style={{ padding:'8px 12px', whiteSpace:'nowrap', color:'#718096' }}>{fmtDate(r.receiptDate)}</td>
                    <td style={{ padding:'8px 12px', fontWeight:600, color:'var(--brand-500)', whiteSpace:'nowrap' }}>{r.receiptNo}</td>
                    <td style={{ padding:'8px 12px', color:'#805ad5', whiteSpace:'nowrap' }}>{r.invoiceNo}</td>
                    <td style={{ padding:'8px 12px', maxWidth:220 }}>
                      <div style={{ fontWeight:600, fontSize:12, color:'#1a202c' }}>{r.projectCode}</div>
                      <div style={{ fontSize:11, color:'#718096', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.projectName}</div>
                    </td>
                    <td style={{ padding:'8px 12px', textAlign:'center', color:'#4a5568' }}>งวด {r.period}</td>
                    <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:600, color:'#1a202c' }}>{fmtMoney(r.grossAmount)}</td>
                    <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', color: hasDeduct ? '#c53030' : '#a0aec0', fontWeight: hasDeduct ? 600 : 400 }}>
                      {hasDeduct ? ('−'+fmtMoney(r.transferDeduction)) : '—'}
                    </td>
                    <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:700, color:'#276749' }}>{fmtMoney(r.netReceived)}</td>
                    <td style={{ padding:'8px 12px', fontSize:11, color:'#718096', whiteSpace:'nowrap' }}>{(r.bankAccount||'').split(' ')[0]}</td>
                    <td style={{ padding:'8px 12px', fontSize:11, color:'#4a5568', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.note||'—'}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>

        {/* Table footer totals for filtered set */}
        {filtered.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:24, padding:'10px 16px', background:'#f8fafc', borderTop:'2px solid #e2e8f0', fontSize:12 }}>
            <div style={{ color:'#475569', fontWeight:600 }}>รวม {filtered.length} รายการ</div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#718096', marginBottom:1 }}>ยอดรับ</div>
              <div style={{ fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{fmtMoney(filtered.reduce(function(s,r){ return s+(parseFloat(r.grossAmount)||0);},0))}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#718096', marginBottom:1 }}>หักโอนสิทธิ</div>
              <div style={{ fontWeight:700, fontVariantNumeric:'tabular-nums', color:'#c53030' }}>−{fmtMoney(filtered.reduce(function(s,r){ return s+(parseFloat(r.transferDeduction)||0);},0))}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#718096', marginBottom:1 }}>เงินเข้าจริง</div>
              <div style={{ fontWeight:700, fontVariantNumeric:'tabular-nums', color:'#276749' }}>{fmtMoney(filtered.reduce(function(s,r){ return s+(parseFloat(r.netReceived)||0);},0))}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

Object.assign(window, { ReceiptsPage });
