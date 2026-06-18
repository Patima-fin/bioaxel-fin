/* page_sts_calc.jsx — STS Calculator
   คำนวณดอกเบี้ย STS และค่าบริการเอนคอมพาส (สุทธิหลังหักดอกเบี้ย)
   อ้างอิงโครงสร้างจากไฟล์: 118.ENC132-PL งวด 2 (WTP2026-01-0002)
*/
'use strict';

// ── Sample STS contract (from 118.ENC132 file) ─────────────────────────────
const STS_SAMPLE = {
  projectName: 'ENC132-PL — บ้านป่าตาล ม.2 ต.เถินบุรี อ.เถิน จ.ลำปาง (งวด 2)',
  contractNo:  'WTP2026-01-0002',
  contractValueIncVAT: 5340000,
  managementFeeRate: 0.065,   // 6.5%
  stsInterestRate:   0.15,    // 15%/ปี
  wciInterestRate:   0.10,    // 10%/ปี
  whtMgmtRate:       0.03,    // 3% on management fee
  whtInterestRate:   0.01,    // 1% on interest

  // เบิกเงินกู้
  stsDrawdowns: [
    { date: '2025-03-04', amount: 540000,  note: 'STS #1 ครั้งที่ 1 (10%)' },  // ~46041=2025/12/04
  ],
  wciDrawdowns: [
    { date: '2025-03-24', amount: 2040000, note: 'WCI #2 ครั้งที่ 1 (40%)' },
    { date: '2025-03-26', amount: 120000,  note: 'WCI #2 ครั้งที่ 2' },
  ],

  // รับเงินจากราชการ
  governmentReceipts: [
    { date: '2025-09-04', amount: 2136000, period: 'งวด 1 (40%)', netAfterWHT: 2115187.38 },
    { date: '2026-02-01', amount: 3204000, period: 'งวด 2 (60%)', netAfterWHT: 3173206.07 },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────
function dayDiff(d1, d2) {
  if (!d1 || !d2) return 0;
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

// Simple interest: P × R × days / 365
function simpleInterest(principal, rate, days) {
  return (Number(principal) || 0) * (Number(rate) || 0) * (Number(days) || 0) / 365;
}

// Compute interest for each drawdown vs the LATEST receipt (when fully paid)
function calculateInterestByLeg(drawdowns, receipts, rate) {
  if (!drawdowns || !receipts || receipts.length === 0) return { rows: [], total: 0 };
  // For each receipt, allocate proportionally to drawdowns
  // Simple approach: each drawdown earns interest from drawdown_date to LAST receipt_date
  const lastReceiptDate = receipts[receipts.length - 1].date;
  const rows = drawdowns.map(d => {
    const days = dayDiff(d.date, lastReceiptDate);
    const interest = simpleInterest(d.amount, rate, days);
    return { ...d, days, interest };
  });
  const total = rows.reduce((s, r) => s + r.interest, 0);
  return { rows, total };
}

function fmtBaht(n) { return (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtBahtInt(n) { return (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// ── Editable row components ────────────────────────────────────────────────
function DrawdownRow({ row, idx, onChange, onRemove, label }) {
  return (
    <tr>
      <td style={{ fontSize: 11 }}>{label} #{idx + 1}</td>
      <td><input type="date" value={row.date || ''} onChange={e => onChange(idx, { ...row, date: e.target.value })}
              style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e0', borderRadius: 4, fontSize: 12 }} /></td>
      <td><input type="number" value={row.amount} onChange={e => onChange(idx, { ...row, amount: Number(e.target.value) })}
              style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e0', borderRadius: 4, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} /></td>
      <td><input type="text" value={row.note || ''} onChange={e => onChange(idx, { ...row, note: e.target.value })}
              style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e0', borderRadius: 4, fontSize: 11 }} /></td>
      <td>
        <button onClick={() => onRemove(idx)} style={{ background: 'none', border: 'none', color: 'var(--bad)', cursor: 'pointer', fontSize: 14 }}>×</button>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
function StsCalcPage({ data }) {
  const [params, setParams] = React.useState(() => JSON.parse(JSON.stringify(STS_SAMPLE)));

  const updateField = (key, val) => setParams(p => ({ ...p, [key]: val }));
  const updateList = (key, idx, item) => setParams(p => ({
    ...p, [key]: p[key].map((x, i) => i === idx ? item : x)
  }));
  const addRow = (key, defaults) => setParams(p => ({ ...p, [key]: [...p[key], defaults] }));
  const removeRow = (key, idx) => setParams(p => ({ ...p, [key]: p[key].filter((_, i) => i !== idx) }));

  // ── Calculations ──────────────────────────────────────────────────────
  const stsResult = calculateInterestByLeg(params.stsDrawdowns, params.governmentReceipts, params.stsInterestRate);
  const wciResult = calculateInterestByLeg(params.wciDrawdowns, params.governmentReceipts, params.wciInterestRate);

  const totalStsDrawdown = params.stsDrawdowns.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalWciDrawdown = params.wciDrawdowns.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalDrawdown    = totalStsDrawdown + totalWciDrawdown;
  const totalReceipt     = params.governmentReceipts.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const managementFeeGross = (Number(params.contractValueIncVAT) || 0) * (Number(params.managementFeeRate) || 0);
  const totalInterestSTS = stsResult.total;
  const managementFeeNet = managementFeeGross - totalInterestSTS;
  const whtMgmtFee = managementFeeGross * (Number(params.whtMgmtRate) || 0);
  const whtInterest = totalInterestSTS * (Number(params.whtInterestRate) || 0);
  const encompassPayable = managementFeeNet - whtMgmtFee + whtInterest;

  return (
    <div className="page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">STS Calculator · คำนวณดอกเบี้ย STS</h1>
          <div className="page-sub">
            สรุปการคำนวณดอกเบี้ยเงินกู้ + ค่าบริการเอนคอมพาส (สุทธิหลังหักดอกเบี้ย STS)
          </div>
        </div>
      </div>

      {/* ── Formula explainer ─────────────────────────────────────────── */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 16, background: '#fffbeb', borderLeft: '4px solid #f6ad55' }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>📐 สูตรคำนวณ</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink-700)' }}>
          1. <strong>ดอกเบี้ย STS (#1)</strong> = เงินต้นที่ได้รับ × 15%/ปี × วันที่กู้ถึงวันรับเงินจากราชการ ÷ 365<br/>
          2. <strong>ดอกเบี้ย WCI (#2)</strong> = เงินต้นที่ได้รับ × 10%/ปี × วันที่กู้ถึงวันรับเงิน ÷ 365<br/>
          3. <strong>ค่าบริการเอนคอมพาส (เต็ม)</strong> = มูลค่าสัญญา × 6.5%<br/>
          4. <strong>ค่าบริการสุทธิ</strong> = ค่าบริการ (เต็ม) − ดอกเบี้ย STS รวม<br/>
          5. <strong>หัก WHT</strong>: 3% ค่าบริการ / 1% ดอกเบี้ย
        </div>
      </div>

      {/* ── Contract parameters ───────────────────────────────────────── */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>⚙ ข้อมูลสัญญา</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>ชื่อโครงการ</label>
            <input value={params.projectName} onChange={e => updateField('projectName', e.target.value)}
                style={{ width: '100%', padding: 8, border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>เลขที่อ้างอิง</label>
            <input value={params.contractNo} onChange={e => updateField('contractNo', e.target.value)}
                style={{ width: '100%', padding: 8, border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>มูลค่าสัญญา (รวม VAT)</label>
            <input type="number" value={params.contractValueIncVAT} onChange={e => updateField('contractValueIncVAT', Number(e.target.value))}
                style={{ width: '100%', padding: 8, border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 12, textAlign: 'right' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>Mgmt fee (เอนคอมพาส) %</label>
            <input type="number" step="0.001" value={params.managementFeeRate} onChange={e => updateField('managementFeeRate', Number(e.target.value))}
                style={{ width: '100%', padding: 8, border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 12, textAlign: 'right' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>ดอกเบี้ย STS (#1) /ปี</label>
            <input type="number" step="0.01" value={params.stsInterestRate} onChange={e => updateField('stsInterestRate', Number(e.target.value))}
                style={{ width: '100%', padding: 8, border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 12, textAlign: 'right' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--ink-500)', display: 'block', marginBottom: 3 }}>ดอกเบี้ย WCI (#2) /ปี</label>
            <input type="number" step="0.01" value={params.wciInterestRate} onChange={e => updateField('wciInterestRate', Number(e.target.value))}
                style={{ width: '100%', padding: 8, border: '1px solid #cbd5e0', borderRadius: 6, fontSize: 12, textAlign: 'right' }} />
          </div>
        </div>
      </div>

      {/* ── Loan drawdowns ────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: '#f0f9ff', borderBottom: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>💰 เงินกู้ STS (#1)</div>
          <button onClick={() => addRow('stsDrawdowns', { date: '', amount: 0, note: '' })}
              style={{ background: '#2e8b4a', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>+ เพิ่ม</button>
        </div>
        <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr><th style={{ width: 70 }}>รายการ</th><th style={{ width: 130 }}>วันที่</th><th style={{ width: 140 }}>จำนวนเงิน</th><th>หมายเหตุ</th><th style={{ width: 40 }}></th></tr>
          </thead>
          <tbody>
            {params.stsDrawdowns.map((row, i) => (
              <DrawdownRow key={i} row={row} idx={i} label="STS" onChange={(i, item) => updateList('stsDrawdowns', i, item)} onRemove={(i) => removeRow('stsDrawdowns', i)} />
            ))}
            <tr style={{ background: '#fafbfc', fontWeight: 700 }}>
              <td colSpan={2}>รวม STS</td>
              <td style={{ textAlign: 'right' }}>{fmtBaht(totalStsDrawdown)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: '#f5f3ff', borderBottom: '1px solid #ddd6fe', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>💰 เงินกู้ WCI (#2)</div>
          <button onClick={() => addRow('wciDrawdowns', { date: '', amount: 0, note: '' })}
              style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>+ เพิ่ม</button>
        </div>
        <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr><th style={{ width: 70 }}>รายการ</th><th style={{ width: 130 }}>วันที่</th><th style={{ width: 140 }}>จำนวนเงิน</th><th>หมายเหตุ</th><th style={{ width: 40 }}></th></tr>
          </thead>
          <tbody>
            {params.wciDrawdowns.map((row, i) => (
              <DrawdownRow key={i} row={row} idx={i} label="WCI" onChange={(i, item) => updateList('wciDrawdowns', i, item)} onRemove={(i) => removeRow('wciDrawdowns', i)} />
            ))}
            <tr style={{ background: '#fafbfc', fontWeight: 700 }}>
              <td colSpan={2}>รวม WCI</td>
              <td style={{ textAlign: 'right' }}>{fmtBaht(totalWciDrawdown)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Government receipts ───────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>🏛 รับเงินจากราชการ</div>
          <button onClick={() => addRow('governmentReceipts', { date: '', amount: 0, period: '', netAfterWHT: 0 })}
              style={{ background: '#15803d', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>+ เพิ่ม</button>
        </div>
        <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr><th style={{ width: 80 }}>งวด</th><th style={{ width: 130 }}>วันที่รับ</th><th style={{ width: 140 }}>จำนวนเงิน (gross)</th><th style={{ width: 140 }}>สุทธิหลังหัก WHT</th><th style={{ width: 40 }}></th></tr>
          </thead>
          <tbody>
            {params.governmentReceipts.map((r, i) => (
              <tr key={i}>
                <td><input value={r.period || ''} onChange={e => updateList('governmentReceipts', i, { ...r, period: e.target.value })}
                      style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e0', borderRadius: 4, fontSize: 12 }} /></td>
                <td><input type="date" value={r.date || ''} onChange={e => updateList('governmentReceipts', i, { ...r, date: e.target.value })}
                      style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e0', borderRadius: 4, fontSize: 12 }} /></td>
                <td><input type="number" value={r.amount} onChange={e => updateList('governmentReceipts', i, { ...r, amount: Number(e.target.value) })}
                      style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e0', borderRadius: 4, fontSize: 12, textAlign: 'right' }} /></td>
                <td><input type="number" value={r.netAfterWHT} onChange={e => updateList('governmentReceipts', i, { ...r, netAfterWHT: Number(e.target.value) })}
                      style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e0', borderRadius: 4, fontSize: 12, textAlign: 'right' }} /></td>
                <td><button onClick={() => removeRow('governmentReceipts', i)} style={{ background: 'none', border: 'none', color: 'var(--bad)', cursor: 'pointer' }}>×</button></td>
              </tr>
            ))}
            <tr style={{ background: '#fafbfc', fontWeight: 700 }}>
              <td colSpan={2}>รวม</td>
              <td style={{ textAlign: 'right' }}>{fmtBaht(totalReceipt)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Interest calculation results ──────────────────────────────── */}
      <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: '#fff7ed', borderBottom: '1px solid #fed7aa' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>📈 รายละเอียดดอกเบี้ย (คำนวณถึงวันรับเงินงวดสุดท้าย)</div>
        </div>
        <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr><th style={{ width: 90 }}>ฝ่าย</th><th style={{ width: 130 }}>วันที่กู้</th><th style={{ width: 130 }}>จำนวนวัน</th><th style={{ width: 140 }}>เงินต้น</th><th style={{ width: 90 }}>อัตรา</th><th style={{ width: 150 }}>ดอกเบี้ย</th></tr>
          </thead>
          <tbody>
            {stsResult.rows.map((r, i) => (
              <tr key={'sts-' + i}>
                <td><Badge kind="b-blue" dot={false}>STS</Badge></td>
                <td>{r.date}</td>
                <td style={{ textAlign: 'right' }}>{r.days}</td>
                <td style={{ textAlign: 'right' }}>{fmtBaht(r.amount)}</td>
                <td style={{ textAlign: 'right' }}>{(params.stsInterestRate * 100).toFixed(2)}%</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtBaht(r.interest)}</td>
              </tr>
            ))}
            {wciResult.rows.map((r, i) => (
              <tr key={'wci-' + i}>
                <td><Badge kind="b-violet" dot={false}>WCI</Badge></td>
                <td>{r.date}</td>
                <td style={{ textAlign: 'right' }}>{r.days}</td>
                <td style={{ textAlign: 'right' }}>{fmtBaht(r.amount)}</td>
                <td style={{ textAlign: 'right' }}>{(params.wciInterestRate * 100).toFixed(2)}%</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtBaht(r.interest)}</td>
              </tr>
            ))}
            <tr style={{ background: '#fef3c7', fontWeight: 700 }}>
              <td colSpan={5} style={{ textAlign: 'right', paddingRight: 12 }}>รวมดอกเบี้ย STS</td>
              <td style={{ textAlign: 'right', color: '#9b1c1c' }}>{fmtBaht(totalInterestSTS)}</td>
            </tr>
            <tr style={{ background: '#fef3c7', fontWeight: 700 }}>
              <td colSpan={5} style={{ textAlign: 'right', paddingRight: 12 }}>รวมดอกเบี้ย WCI</td>
              <td style={{ textAlign: 'right', color: '#6b46c1' }}>{fmtBaht(wciResult.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Final summary ─────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 18, background: 'linear-gradient(135deg, #fff7ed, #fefce8)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: '#9a3412' }}>💰 สรุปสำหรับเอนคอมพาส</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ค่าบริการ (เต็ม) — 6.5% × สัญญา</div>
            <div style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{fmtBahtInt(managementFeeGross)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>(−) หักดอกเบี้ย STS</div>
            <div style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: 'tabular-nums', color: '#9b1c1c' }}>−{fmtBahtInt(totalInterestSTS)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>= ค่าบริการสุทธิ</div>
            <div style={{ fontWeight: 700, fontSize: 20, fontVariantNumeric: 'tabular-nums', color: '#276749' }}>{fmtBahtInt(managementFeeNet)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>(−) WHT ค่าบริการ 3%</div>
            <div style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>−{fmtBahtInt(whtMgmtFee)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>(+) WHT ดอกเบี้ย 1% (รับคืน)</div>
            <div style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>+{fmtBahtInt(whtInterest)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>= สุทธิจ่ายเอนคอมพาส</div>
            <div style={{ fontWeight: 700, fontSize: 22, fontVariantNumeric: 'tabular-nums', color: '#0369a1' }}>
              {fmtBahtInt(encompassPayable)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 8, fontSize: 11, color: 'var(--ink-500)' }}>
        ตัวอย่างนี้ดึงจากไฟล์ <strong>118.ENC132-PL งวด 2</strong> (WTP2026-01-0002) — แก้ตัวเลขใดๆ ด้านบนได้
        ทุกการคำนวณจะ update อัตโนมัติ
      </div>
    </div>
  );
}

Object.assign(window, { StsCalcPage });
