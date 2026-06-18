/* page_interest_calc.jsx — คำนวณดอกเบี้ยรายเดือน / รายไตรมาส
   รองรับ: exact-days, monthly-flat, compound-monthly
   Export: CSV download + Print PDF
*/
'use strict';

/* ── Date helpers ────────────────────────────────────────────────────── */
function daysInRange(from, to) {
  /* inclusive from, exclusive to */
  var a = new Date(from), b = new Date(to);
  return Math.max(0, Math.round((b - a) / 86400000));
}
function addMonths(dateStr, n) {
  var d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}
function monthKey(dateStr) { return dateStr.slice(0, 7); }
function monthLabel(dateStr) {
  var MONTH = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  var d = new Date(dateStr + '-01');
  return MONTH[d.getMonth()+1] + ' ' + d.getFullYear();
}
function monthStart(dateStr) {
  return dateStr.slice(0,7) + '-01';
}
function monthEnd(dateStr) {
  /* first day of NEXT month */
  var d = new Date(dateStr.slice(0,7) + '-01');
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0,10);
}
function quarterOf(dateStr) {
  var m = parseInt(dateStr.slice(5,7), 10);
  return Math.ceil(m / 3);
}
function quarterLabel(year, q) {
  var RANGES = ['','ม.ค.–มี.ค.','เม.ย.–มิ.ย.','ก.ค.–ก.ย.','ต.ค.–ธ.ค.'];
  return 'Q'+q+' ('+RANGES[q]+') '+year;
}

/* ── Interest schedule generator ────────────────────────────────────── */
function buildSchedule(params) {
  var principal   = parseFloat(params.principal) || 0;
  var rate        = parseFloat(params.rate) || 0;        // % p.a.
  var startDate   = params.startDate;
  var endDate     = params.endDate;
  var method      = params.method || 'exact';             // exact | flat | compound
  var basis       = parseInt(params.basis, 10) || 365;   // 360 | 365

  if (!principal || !rate || !startDate || !endDate) return [];
  if (startDate >= endDate) return [];

  var rows = [];
  var cursor = startDate;
  var running = principal;    // for compound: principal changes
  var cumulative = 0;
  var rowNo = 1;

  while (cursor < endDate) {
    var mStart  = cursor === startDate ? cursor : monthStart(cursor);
    var mEnd    = monthEnd(cursor);
    var periodStart = cursor;
    var periodEnd   = mEnd < endDate ? mEnd : endDate;

    var days    = daysInRange(periodStart, periodEnd);
    var interest = 0;

    if (method === 'exact') {
      interest = running * (rate / 100) * (days / basis);
    } else if (method === 'flat') {
      /* flat monthly — proportional to days in month */
      var totalDaysInMonth = daysInRange(monthStart(cursor), monthEnd(cursor));
      interest = running * (rate / 100) / 12 * (days / totalDaysInMonth);
    } else if (method === 'compound') {
      interest = running * (rate / 100) * (days / basis);
      running += interest;   /* interest added to principal each period */
    }

    cumulative += interest;

    rows.push({
      no:          rowNo++,
      periodStart: periodStart,
      periodEnd:   periodEnd,
      monthKey:    monthKey(cursor),
      monthLabel:  monthLabel(cursor),
      year:        new Date(cursor).getFullYear(),
      quarter:     quarterOf(cursor),
      days:        days,
      outstanding: running,
      interest:    interest,
      cumulative:  cumulative,
    });

    cursor = periodEnd;
  }

  return rows;
}

/* ── Export helpers ──────────────────────────────────────────────────── */
function downloadCSV(rows, params) {
  var header = ['ลำดับ','เดือน','วันที่เริ่ม','วันที่สิ้นสุด','จำนวนวัน','ยอดต้น (บาท)','ดอกเบี้ย (บาท)','ดอกเบี้ยสะสม (บาท)'];
  var lines  = [header.join(',')];
  rows.forEach(function(r) {
    lines.push([r.no, r.monthLabel, r.periodStart, r.periodEnd, r.days,
      r.outstanding.toFixed(2), r.interest.toFixed(2), r.cumulative.toFixed(2)].join(','));
  });
  /* summary */
  var total = rows.reduce(function(s,r){ return s+r.interest; }, 0);
  lines.push('');
  lines.push('วงเงิน,'+params.principal);
  lines.push('อัตราดอกเบี้ย,'+params.rate+'% p.a.');
  lines.push('วันที่เริ่ม,'+params.startDate);
  lines.push('คำนวณถึง,'+params.endDate);
  lines.push('ดอกเบี้ยรวม,'+total.toFixed(2));

  var blob = new Blob(['﻿'+lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url; a.download = 'interest_schedule.csv'; a.click();
  URL.revokeObjectURL(url);
}

/* ── Sub-components ──────────────────────────────────────────────────── */
function ParamForm({ params, setParams, debtLedger, debtMaster, onCalc }) {
  var inp = { width:'100%', padding:'8px 11px', boxSizing:'border-box', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, fontFamily:'inherit', outline:'none' };
  var lbl = { fontSize:12, fontWeight:600, color:'#475569', marginBottom:4, display:'block' };

  function setP(k, v) { setParams(function(prev){ return Object.assign({}, prev, { [k]: v }); }); }

  // v2 picker — sources contracts from debtMaster (debtLedger is now monthly rows)
  function handleMasterPick(e) {
    var id = e.target.value;
    if (!id) return;
    var debt = (debtMaster||[]).find(function(d){ return d.id===id||d.contractNo===id; });
    if (!debt) return;
    setParams(function(prev){ return Object.assign({}, prev, {
      loanLabel:   debt.contractNo + ' — ' + (debt.borrowerName || debt.debtCategory || ''),
      principal:   debt.principalAmount || debt.balance || '',
      rate:        debt.interestRate ? (Number(debt.interestRate) * 100) : '',
      startDate:   debt.receiveDate || debt.startDate || '',
    }); });
  }

  return (
    <div className="card" style={{ padding:20, marginBottom:16 }}>
      <div style={{ fontWeight:700, fontSize:14, color:'#1a202c', marginBottom:16 }}>⚙ ตั้งค่าการคำนวณ</div>

      {/* Quick-fill from debtMaster contracts (v2) */}
      {debtMaster && debtMaster.length > 0 && (
        <div style={{ marginBottom:14, padding:'10px 14px', background:'#f0f6ff', borderRadius:10, border:'1px solid #bfdbfe' }}>
          <label style={lbl}>เลือกจากสัญญา debtMaster (optional)</label>
          <select style={{ ...inp, background:'#fff' }} onChange={handleMasterPick}>
            <option value="">— กรอกเอง หรือเลือกจากสัญญา —</option>
            {(debtMaster||[]).filter(function(d){ return d.status==='Active'; }).map(function(d,i){
              var rate = d.interestRate ? (Number(d.interestRate)*100).toFixed(2) + '%' : '';
              return <option key={i} value={d.id||d.contractNo}>{d.debtCategory} · {d.borrowerName} ({d.contractNo}) {rate}</option>;
            })}
          </select>
          {params.loanLabel && <div style={{ fontSize:11, color:'#2e8b4a', marginTop:6 }}>✓ {params.loanLabel}</div>}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'12px 16px' }}>
        <div>
          <label style={lbl}>วงเงินต้น (บาท) *</label>
          <input type="number" style={inp} value={params.principal}
            onChange={function(e){ setP('principal', e.target.value); }}
            placeholder="10000000" />
        </div>
        <div>
          <label style={lbl}>อัตราดอกเบี้ย (% ต่อปี) *</label>
          <input type="number" style={inp} value={params.rate} step="0.01"
            onChange={function(e){ setP('rate', e.target.value); }}
            placeholder="7.5" />
        </div>
        <div>
          <label style={lbl}>วันที่เริ่มกู้ *</label>
          <input type="date" style={inp} value={params.startDate}
            onChange={function(e){ setP('startDate', e.target.value); }} />
        </div>
        <div>
          <label style={lbl}>คำนวณถึงวันที่ *</label>
          <input type="date" style={inp} value={params.endDate}
            onChange={function(e){ setP('endDate', e.target.value); }} />
        </div>
        <div>
          <label style={lbl}>วิธีคำนวณ</label>
          <select style={{ ...inp, background:'#fff' }} value={params.method}
            onChange={function(e){ setP('method', e.target.value); }}>
            <option value="exact">Exact Days (actual/365)</option>
            <option value="flat">Monthly Flat (÷12)</option>
            <option value="compound">Compound Monthly</option>
          </select>
        </div>
        <div>
          <label style={lbl}>ฐานปี</label>
          <select style={{ ...inp, background:'#fff' }} value={params.basis}
            onChange={function(e){ setP('basis', e.target.value); }}>
            <option value="365">365 วัน</option>
            <option value="360">360 วัน</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop:16, display:'flex', gap:10, alignItems:'center' }}>
        <button onClick={onCalc}
          style={{ padding:'9px 24px', borderRadius:9, border:'none', background:'linear-gradient(135deg,#2e8b4a,#1a592f)', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit', boxShadow:'0 4px 12px rgba(46,139,74,0.3)' }}>
          คำนวณ
        </button>
        {params.rate && params.principal && (
          <div style={{ fontSize:12, color:'#718096' }}>
            ดอกเบี้ยรายปีประมาณ {fmtMoney(parseFloat(params.principal||0) * parseFloat(params.rate||0) / 100)} บาท
            ({fmtMoney(parseFloat(params.principal||0) * parseFloat(params.rate||0) / 100 / 12)} / เดือน)
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Schedule Table ──────────────────────────────────────────────────── */
function ScheduleTable({ rows, params, onExportCSV, onPrint }) {
  if (rows.length === 0) return null;

  var totalInterest = rows.reduce(function(s,r){ return s+r.interest; }, 0);
  var principal     = parseFloat(params.principal)||0;
  var rate          = parseFloat(params.rate)||0;

  /* Group by year-quarter */
  var quarters = [];
  var qMap     = {};
  rows.forEach(function(r) {
    var qk = r.year + '-Q' + r.quarter;
    if (!qMap[qk]) {
      qMap[qk] = { key:qk, year:r.year, quarter:r.quarter, rows:[], total:0 };
      quarters.push(qMap[qk]);
    }
    qMap[qk].rows.push(r);
    qMap[qk].total += r.interest;
  });

  var thStyle = { padding:'8px 12px', textAlign:'left', fontWeight:600, color:'#475569', borderBottom:'1px solid #e2e8f0', fontSize:11, whiteSpace:'nowrap' };
  var thR     = Object.assign({}, thStyle, { textAlign:'right' });

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12, marginBottom:16 }}>
        {[
          { label:'วงเงินต้น', value: fmtMoney(principal), color:'#2e8b4a' },
          { label:'อัตราดอกเบี้ย', value: rate+'% p.a.', color:'#c05621' },
          { label:'ระยะเวลา', value: rows.length+' เดือน', color:'#6b46c1' },
          { label:'ดอกเบี้ยรวมทั้งสิ้น', value: fmtMoney(totalInterest), color:'#c53030' },
        ].map(function(item, i) {
          return (
            <div key={i} className="kpi" style={{ borderLeft:'4px solid '+item.color }}>
              <div className="kpi-label">{item.label}</div>
              <div className="kpi-value" style={{ fontSize:16, color:item.color }}>{item.value}</div>
            </div>
          );
        })}
      </div>

      {/* Export buttons */}
      <div style={{ display:'flex', gap:10, marginBottom:14 }} className="no-print">
        <button onClick={onExportCSV}
          style={{ padding:'7px 18px', borderRadius:8, border:'1.5px solid #68d391', background:'#f0fdf4', color:'#276749', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          ⬇ Export CSV
        </button>
        <button onClick={onPrint}
          style={{ padding:'7px 18px', borderRadius:8, border:'1.5px solid #63b3ed', background:'#ebf8ff', color:'#2e8b4a', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
          🖨 Print / PDF
        </button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding:0, overflow:'hidden' }} id="interest-print-area">
        {/* Print header */}
        <div className="print-only" style={{ display:'none', padding:'16px 20px', borderBottom:'2px solid #e2e8f0' }}>
          <div style={{ fontWeight:700, fontSize:16 }}>ตารางดอกเบี้ยรายเดือน</div>
          <div style={{ fontSize:12, color:'#718096', marginTop:4 }}>
            วงเงิน {fmtMoney(principal)} บาท · อัตรา {rate}% p.a. · {params.startDate} ถึง {params.endDate}
            · วิธีคำนวณ {params.method==='exact'?'Exact Days':params.method==='flat'?'Monthly Flat':'Compound'}
          </div>
        </div>

        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>เดือน</th>
                <th style={thStyle}>วันที่เริ่ม</th>
                <th style={thStyle}>วันที่สิ้นสุด</th>
                <th style={Object.assign({},thStyle,{textAlign:'center'})}>วัน</th>
                <th style={thR}>ยอดต้น (บาท)</th>
                <th style={thR}>ดอกเบี้ย (บาท)</th>
                <th style={thR}>ดอกเบี้ยสะสม (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {quarters.map(function(q) {
                return [
                  /* Quarter header */
                  <tr key={'qh-'+q.key} style={{ background:'linear-gradient(90deg,#f0f6ff,#f8fafc)', borderTop:'2px solid #bfdbfe' }}>
                    <td colSpan={8} style={{ padding:'7px 12px', fontWeight:700, fontSize:12, color:'#2e8b4a' }}>
                      {quarterLabel(q.year, q.quarter)}
                      <span style={{ marginLeft:12, fontSize:11, color:'#718096', fontWeight:400 }}>{q.rows.length} เดือน</span>
                    </td>
                  </tr>,
                  /* Monthly rows */
                  q.rows.map(function(r) {
                    return (
                      <tr key={r.no} style={{ borderBottom:'1px solid #f0f4f8' }}>
                        <td style={{ padding:'8px 12px', color:'#a0aec0', fontSize:11 }}>{r.no}</td>
                        <td style={{ padding:'8px 12px', fontWeight:600 }}>{r.monthLabel}</td>
                        <td style={{ padding:'8px 12px', fontSize:11, color:'#718096' }}>{r.periodStart}</td>
                        <td style={{ padding:'8px 12px', fontSize:11, color:'#718096' }}>{r.periodEnd}</td>
                        <td style={{ padding:'8px 12px', textAlign:'center', color:'#4a5568' }}>{r.days}</td>
                        <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', color:'#4a5568' }}>
                          {fmtMoney(r.outstanding)}
                        </td>
                        <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:600, color:'#c05621' }}>
                          {fmtMoney(r.interest)}
                        </td>
                        <td style={{ padding:'8px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', color:'#718096' }}>
                          {fmtMoney(r.cumulative)}
                        </td>
                      </tr>
                    );
                  }),
                  /* Quarter subtotal */
                  <tr key={'qt-'+q.key} style={{ background:'#fffbeb', borderBottom:'2px solid #fde68a' }}>
                    <td colSpan={6} style={{ padding:'7px 12px', textAlign:'right', fontSize:11, fontWeight:600, color:'#b45309' }}>
                      รวม {quarterLabel(q.year, q.quarter)}
                    </td>
                    <td style={{ padding:'7px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:700, fontSize:13, color:'#b45309' }}>
                      {fmtMoney(q.total)}
                    </td>
                    <td></td>
                  </tr>,
                ];
              })}
            </tbody>
            <tfoot>
              <tr style={{ background:'#fef2f2', borderTop:'2px solid #feb2b2' }}>
                <td colSpan={6} style={{ padding:'10px 12px', textAlign:'right', fontWeight:700, fontSize:13 }}>
                  ดอกเบี้ยรวมทั้งสิ้น ({rows.length} เดือน)
                </td>
                <td style={{ padding:'10px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:800, fontSize:15, color:'#c53030' }}>
                  {fmtMoney(totalInterest)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────── */
const InterestCalcPage = function({ data }) {
  var today = new Date().toISOString().slice(0,10);

  var [params, setParams] = React.useState({
    loanLabel:  '',
    principal:  '10000000',
    rate:       '7.5',
    startDate:  '2024-02-07',
    endDate:    today,
    method:     'exact',
    basis:      '365',
  });

  var [rows, setRows] = React.useState([]);
  var [calcDone, setCalcDone] = React.useState(false);
  var [errMsg, setErrMsg] = React.useState('');

  function handleCalc() {
    setErrMsg('');
    if (!params.principal || !params.rate || !params.startDate || !params.endDate) {
      return setErrMsg('กรุณากรอก วงเงิน / อัตราดอกเบี้ย / วันที่ให้ครบ');
    }
    if (params.startDate >= params.endDate) {
      return setErrMsg('วันที่เริ่มต้องน้อยกว่าวันสิ้นสุด');
    }
    var schedule = buildSchedule(params);
    if (schedule.length === 0) {
      return setErrMsg('ไม่สามารถคำนวณได้ กรุณาตรวจสอบวันที่');
    }
    setRows(schedule);
    setCalcDone(true);
  }

  function handleExportCSV() { downloadCSV(rows, params); }

  function handlePrint() {
    /* show print-only elements then print */
    var els = document.querySelectorAll('.print-only');
    els.forEach(function(el){ el.style.display='block'; });
    window.print();
    els.forEach(function(el){ el.style.display='none'; });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">คำนวณดอกเบี้ย</div>
          <div className="page-sub">Interest Schedule — รายเดือน / รายไตรมาส · Export CSV / PDF</div>
        </div>
      </div>

      <ParamForm
        params={params}
        setParams={setParams}
        debtLedger={data.debtLedger}
        debtMaster={data.debtMaster}
        onCalc={handleCalc}
      />

      {errMsg && (
        <div style={{ marginBottom:14, padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:13, color:'#dc2626' }}>
          ⚠ {errMsg}
        </div>
      )}

      {!calcDone && !errMsg && (
        <div style={{ textAlign:'center', padding:'48px 0', color:'#a0aec0' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🧮</div>
          <div style={{ fontSize:14, fontWeight:600 }}>กรอกพารามิเตอร์ด้านบน แล้วกด "คำนวณ"</div>
          <div style={{ fontSize:12, marginTop:6 }}>ระบบจะแสดงตารางดอกเบี้ยรายเดือน จัดกลุ่มตามไตรมาส</div>
        </div>
      )}

      <ScheduleTable
        rows={rows}
        params={params}
        onExportCSV={handleExportCSV}
        onPrint={handlePrint}
      />

      {/* Print stylesheet injected inline */}
      <style>{`
        @media print {
          .sb, .topbar, .page-head, .no-print { display: none !important; }
          .main { margin: 0 !important; padding: 0 !important; }
          .page { padding: 0 !important; }
          .print-only { display: block !important; }
          body { font-size: 11px; }
          .card { box-shadow: none !important; border: 1px solid #e2e8f0 !important; }
        }
      `}</style>
    </div>
  );
};

Object.assign(window, { InterestCalcPage, buildSchedule, ScheduleTable, downloadCSV });
