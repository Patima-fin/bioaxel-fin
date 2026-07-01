// app/page_cashflow_forecast.jsx
// ── Cash Flow Forecast · ประมาณการรายรับ-รายจ่าย ───────────────────────────
// route: #cashflow_forecast  ·  ปรับจากรายงาน "ประมาณการรายรับ-รายจ่าย" ของต้นแบบ
//   finance-tools ให้เข้ากับ BIOAXEL (4 หมวดเดิม + ข้อมูลจริงจาก entity tables).
//
// เลย์เอาต์ (ตามภาพ): header แบรนด์ → ตาราง pivot คอลัมน์ธนาคาร
//   [เงินคงเหลือใช้ได้] − [ค่าใช้จ่ายถึงกำหนดชำระ (แยก 4 หมวด)] = [เงินคงเหลือสุทธิ]
//   → รายละเอียดประเภทรายจ่าย (group หมวด → ผู้ขาย → รายการ)
//
// ข้อมูลจริง:
//   เงินคงเหลือใช้ได้ = ยอดล่าสุดต่อบัญชี (snapshot ล่าสุด หรือ BALANCE) − HOLD
//   ค่าใช้จ่ายถึงกำหนด = forecastEntries (PLANNED, AMOUNT<0) ที่ PAYMENT_DATE อยู่ในรอบ
//     — รวมงวด recurring (EXPENSE_TYPE='RECURRING') ที่ materialise มาจากหน้าค่าใช้จ่ายประจำ
//     — ตัด LOAN/CREDIT_LINE (financing) · BANK_RECON (actual) · AP (จัดที่ Bank Diary) ออก
//   จัดหมวดด้วย categorizeForecastEntry (global จาก page_cashflow) → 1-4
//   กระจายตามบัญชี Bank_AC; ไม่ระบุ → บัญชี default (ยอดคงเหลือมากสุด)

const { useState: cfwState, useMemo: cfwMemo, useRef: cfwRef } = React;

const CFW_COMPANY_TH = 'บริษัท ไบโอแอ็กซ์เซลล์ จำกัด';
const CFW_COMPANY_EN = 'Bioaxell Co., Ltd.';
const CFW_LOGO = 'bioaxel_logo.png';
const CFW_CAT_ORDER = [1, 2, 3, 4];
// label หมวดแบบกระชับสำหรับรายงาน (ของเต็มใน CATEGORY_LABELS ยาวเกินไป → ตัดบรรทัดในตาราง)
const CFW_CAT_LABELS = {
  1: 'ค่าใช้จ่ายดำเนินงาน',
  2: 'ค่าใช้จ่ายโครงการ / งานติดตั้ง',
  3: 'ต้นทุนการเงิน / ดอกเบี้ย',
  4: 'ค่าใช้จ่ายเบ็ดเตล็ด / เงินเดือน',
};
const cfwCatLabel = (c) => CFW_CAT_LABELS[c] || (typeof CATEGORY_LABELS !== 'undefined' && CATEGORY_LABELS[c]) || ('หมวด ' + c);

function cfwISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function cfwEndOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
const cfwParen = (n) => (Number(n) < 0 ? '(' + fmtMoney(Math.abs(n), { digits: 2 }) + ')' : fmtMoney(n, { digits: 2 }));

// snapshot ล่าสุดต่อบัญชี (เหมือน page_home)
function cfwSnapByAc(data) {
  const latest = {};
  (data.cashflowSnapshots || []).forEach((s) => {
    const ac = s.bankAc || s.Bank_AC; if (!ac) return;
    if (!latest[ac] || (s.date || '') > (latest[ac].date || '')) latest[ac] = s;
  });
  const out = {};
  Object.keys(latest).forEach((ac) => { out[ac] = Number(latest[ac].balance) || 0; });
  return out;
}

const CFW_PERIODS = [
  { key: 'eom',   label: 'ถึงสิ้นเดือนนี้' },
  { key: 'd7',    label: '7 วัน' },
  { key: 'd30',   label: '30 วัน' },
  { key: 'eonm',  label: 'ถึงสิ้นเดือนหน้า' },
];
function cfwPeriodRange(key) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let end;
  if (key === 'd7') { end = new Date(today); end.setDate(today.getDate() + 7); }
  else if (key === 'd30') { end = new Date(today); end.setDate(today.getDate() + 30); }
  else if (key === 'eonm') { end = cfwEndOfMonth(new Date(today.getFullYear(), today.getMonth() + 1, 1)); }
  else { end = cfwEndOfMonth(today); }
  return { fromISO: cfwISO(today), toISO: cfwISO(end) };
}

// ════════════════════════════════════════════════════════════════════════
function CashFlowForecastPage({ data, setData, toast }) {
  const canEdit = !!(window.WTPAuth && window.WTPAuth.can('canEdit')) && typeof setData === 'function';
  const [period, setPeriod] = cfwState('eom');
  const [collapsed, setCollapsed] = cfwState({});      // cat → ย่อ
  const [editItem, setEditItem] = cfwState(null);      // รายการที่กดแก้ (วันจ่าย / ไม่จ่าย)
  const [holdMode, setHoldMode] = cfwState(() => {     // 'gross' (ยอดเต็ม, default) | 'net' (หัก HOLD)
    try { return localStorage.getItem('bio-cfw-holdmode') === 'net' ? 'net' : 'gross'; } catch (_) { return 'gross'; }
  });
  const [exportOpen, setExportOpen] = cfwState(false);
  const [busy, setBusy] = cfwState(false);
  const reportRef = cfwRef(null);     // รายงานบนหน้า
  const previewRef = cfwRef(null);    // รายงานใน modal (ตัวที่ capture ตอน export)

  const setHold = (m) => { setHoldMode(m); try { localStorage.setItem('bio-cfw-holdmode', m); } catch (_) {} };

  // ── แก้แผนจ่ายในหน้านี้ (อัปเดต forecastEntries แถวเดียวกับที่ Bank Diary ใช้ → sync ตรงกัน) ──
  const applyPayDate = (item, newISO) => {
    if (!canEdit || !item || !item.id || !newISO) return;
    setData((d) => ({ ...d, forecastEntries: (d.forecastEntries || []).map((fe) => String(fe.id) === String(item.id) ? { ...fe, PAYMENT_DATE: newISO } : fe) }));
    if (typeof WTPData !== 'undefined' && WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(), 200);
    setEditItem(null); toast && toast('เลื่อนวันจ่ายเป็น ' + fmtDate(newISO) + ' แล้ว');
  };
  const unplanItem = (item) => {
    if (!canEdit || !item || !item.id) return;
    setData((d) => ({ ...d, forecastEntries: (d.forecastEntries || []).filter((fe) => String(fe.id) !== String(item.id)) }));
    if (typeof WTPData !== 'undefined' && WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(), 200);
    setEditItem(null); toast && toast(item.expType === 'AP' ? 'ยกเลิกแผนจ่าย AP แล้ว' : 'เอาออกจากรอบแล้ว');
  };

  const model = cfwMemo(() => cfwBuildModel(data, period, holdMode), [data.bankAccounts, data.forecastEntries, data.cashflowSnapshots, period, holdMode]);
  const detailCats = model.cats.filter((c) => c.items.length);

  const range = cfwPeriodRange(period);
  const periodLabel = `${fmtDate(range.fromISO)} – ${fmtDate(range.toISO)}`;
  const todayLong = fmtDateLong(cfwISO(new Date()));

  // ── ส่งออก: เปิด modal → โชว์รายงานเต็ม + ปุ่ม PNG/PDF/ปิด ด้านบน (เห็นก่อนเลือกโหลด) ──
  const openExport = () => setExportOpen(true);
  const doPrint = () => window.print();        // @media print โชว์เฉพาะรายงานใน modal (ดู CFW_CSS)
  const savePngDirect = async () => {
    if (typeof window.html2canvas !== 'function') { alert('ตัวช่วยบันทึกรูปยังโหลดไม่เสร็จ'); return; }
    const target = previewRef.current || reportRef.current; if (!target) return;
    setBusy(true);
    try {
      const raw = await window.html2canvas(target, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
      const a = document.createElement('a');
      a.download = `cashflow-forecast-${cfwISO(new Date()).replace(/-/g, '')}.png`;
      a.href = raw.toDataURL('image/png'); a.click();
    } catch (e) { alert('บันทึกรูปไม่สำเร็จ: ' + (e && e.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="cfw-page">
      <style>{CFW_CSS}</style>

      {/* toolbar (ไม่เข้ารูป) */}
      <div className="cfw-toolbar" data-no-capture="1">
        <div className="cfw-periods">
          {CFW_PERIODS.map((p) => (
            <button key={p.key} className={'cfw-chip' + (period === p.key ? ' active' : '')} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="cfw-tools">
          {model.anyHold && (
            <div className="cfw-hold-tog" title="เลือกแสดงยอดเต็มตามบัญชี หรือหักยอดที่กันไว้ (HOLD เช่น ค้ำ LG / เช็คค้าง)">
              <span className="cfw-hold-lbl">เงินคงเหลือ:</span>
              <button className={holdMode === 'gross' ? 'active' : ''} onClick={() => setHold('gross')}>ยอดเต็ม</button>
              <button className={holdMode === 'net' ? 'active' : ''} onClick={() => setHold('net')}>หัก HOLD</button>
            </div>
          )}
          <button className="btn btn-primary btn-sm" onClick={openExport}>🖨 พิมพ์ / ส่งออก</button>
        </div>
      </div>

      <CfwReport innerRef={reportRef} model={model} holdMode={holdMode} periodLabel={periodLabel} todayLong={todayLong} detailCats={detailCats} collapsed={collapsed} setCollapsed={setCollapsed} onEditItem={canEdit ? setEditItem : null} />

      {/* ส่งออก — โชว์รายงานเต็มในหน้าต่าง preview + ปุ่ม PNG / PDF / ปิด ด้านบน (เห็นก่อนเลือกโหลด) */}
      {exportOpen && (
        <div className="cfw-exp-overlay" onClick={(e) => { if (e.target.classList.contains('cfw-exp-overlay')) setExportOpen(false); }}>
          <div className="cfw-exp-win">
            <div className="cfw-exp-bar" data-no-capture="1">
              <div className="cfw-exp-title">รายงานสำหรับแชร์ / พิมพ์</div>
              <div className="cfw-exp-btns">
                <button className="btn btn-ghost btn-sm" onClick={savePngDirect} disabled={busy}>{busy ? '⏳ กำลังสร้าง…' : '⬇ PNG'}</button>
                <button className="btn btn-ghost btn-sm" onClick={doPrint}>⬇ PDF</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setExportOpen(false)}>ปิด</button>
              </div>
            </div>
            <div className="cfw-exp-scroll">
              <CfwReport innerRef={previewRef} model={model} holdMode={holdMode} periodLabel={periodLabel} todayLong={todayLong} detailCats={detailCats} collapsed={collapsed} setCollapsed={setCollapsed} />
            </div>
          </div>
        </div>
      )}

      {editItem && <CfwEditModal item={editItem} onClose={() => setEditItem(null)} onApplyDate={applyPayDate} onUnplan={unplanItem} />}
    </div>
  );
}

// ── modal แก้แผนจ่ายรายการเดียว: เลื่อนวันจ่าย / ไม่จ่ายรอบนี้ (ยกเลิกแผน) ──
function CfwEditModal({ item, onClose, onApplyDate, onUnplan }) {
  const [date, setDate] = cfwState(item.dueISO || '');
  const isAP = item.expType === 'AP';
  return (
    <Modal open title="แก้แผนจ่าย" onClose={onClose} maxWidth={440}
      footer={(
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}>
          <button className="btn btn-ghost btn-sm cfw-unplan" onClick={() => { if (confirm(isAP ? 'ยกเลิกแผนจ่าย AP นี้? (จะกลับไปเป็น "ยังไม่วางแผน")' : 'เอารายการนี้ออกจากรอบ?')) onUnplan(item); }}>✕ ไม่จ่ายรอบนี้</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>ยกเลิก</button>
            <button className="btn btn-primary btn-sm" disabled={!date || date === item.dueISO} onClick={() => onApplyDate(item, date)}>บันทึกวันจ่าย</button>
          </div>
        </div>
      )}>
      <div className="cfw-edit">
        <div className="cfw-edit-name">{item.desc || '—'}</div>
        <div className="cfw-edit-meta">
          <span className={'rc-cat c' + item.cat}>{item.cat}</span> {cfwCatLabel(item.cat)}
          {item.ref ? <span className="cfw-edit-ref"> · {item.ref}</span> : null}
          <span className={'cfw-edit-tag ' + (isAP ? 'ap' : 'rec')}>{isAP ? 'AP วางแผนจ่าย' : 'ค่าใช้จ่ายประจำ'}</span>
        </div>
        <div className="cfw-edit-amt">ยอด {fmtMoney(item.amount, { digits: 2 })} บาท</div>
        <label className="cfw-edit-fld"><span>วันจ่าย</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="cfw-edit-note">แก้ที่นี่จะอัปเดตแผนเดียวกับหน้า Bank Diary · "ไม่จ่ายรอบนี้" = เอาออกจากประมาณการ (AP กลับเป็นยังไม่วางแผน)</div>
      </div>
    </Modal>
  );
}

// ── รายงาน (ใช้ทั้งบนหน้า + ใน modal export) ───────────────────────────────
function CfwReport({ innerRef, model, holdMode, periodLabel, todayLong, detailCats, collapsed, setCollapsed, onEditItem }) {
  return (
    <div className="cfw-report" ref={innerRef}>
      {/* header */}
      <div className="cfw-head">
        <img className="cfw-logo" src={CFW_LOGO} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
        <div className="cfw-head-mid">
          <div className="cfw-brand">BIOAXEL</div>
          <div className="cfw-title">ประมาณการรายรับ-รายจ่าย</div>
          <div className="cfw-co">{CFW_COMPANY_TH} · {CFW_COMPANY_EN}</div>
        </div>
        <div className="cfw-head-right">
          <div className="cfw-rl">รอบจ่าย</div>
          <div className="cfw-rv">{periodLabel}</div>
          <div className="cfw-rd">ยอดธนาคาร ณ {todayLong}</div>
        </div>
      </div>

      {/* bank pivot */}
      <div className="cfw-body">
        <table className="cfw-pivot">
          <thead>
            <tr>
              <th className="l">ธนาคาร</th>
              {model.banks.map((b) => (
                <th key={b.ac} className="r">
                  <div className="cfw-bk">
                    {typeof HpBankLogo !== 'undefined' && <HpBankLogo name={b.name} />}
                    <div className="cfw-bk-t">
                      <div className="cfw-bk-n">{b.name}</div>
                      <div className="cfw-bk-a">{b.ac}</div>
                    </div>
                  </div>
                </th>
              ))}
              <th className="r tot">รวม</th>
            </tr>
          </thead>
          <tbody>
            <tr className="cfw-avail">
              <td className="l">เงินคงเหลือใช้ได้{holdMode === 'net' ? ' (หัก HOLD)' : ''}</td>
              {model.banks.map((b) => <td key={b.ac} className="r">{fmtMoney(b.avail, { digits: 2 })}</td>)}
              <td className="r tot b">{fmtMoney(model.openingCash, { digits: 2 })}</td>
            </tr>
            <tr className="cfw-due">
              <td className="l">ค่าใช้จ่ายถึงกำหนดชำระ</td>
              {model.banks.map((b) => <td key={b.ac} className="r">{model.bankDue[b.ac] ? fmtMoney(model.bankDue[b.ac], { digits: 2 }) : '-'}</td>)}
              <td className="r tot b">{fmtMoney(model.totalDue, { digits: 2 })}</td>
            </tr>
            {model.cats.map((c) => (
              <tr key={c.cat} className="cfw-catrow">
                <td className="l sub">{cfwCatLabel(c.cat)}</td>
                {model.banks.map((b) => {
                  const v = (model.bankCat[b.ac] || {})[c.cat] || 0;
                  return <td key={b.ac} className="r sub">{v ? fmtMoney(v, { digits: 2 }) : '-'}</td>;
                })}
                <td className="r sub neg">{fmtMoney(c.total, { digits: 2 })}</td>
              </tr>
            ))}
            <tr className="cfw-net">
              <td className="l">เงินคงเหลือสุทธิ</td>
              {model.banks.map((b) => {
                const v = b.avail - (model.bankDue[b.ac] || 0);
                return <td key={b.ac} className={'r b' + (v < 0 ? ' neg' : '')}>{cfwParen(v)}</td>;
              })}
              <td className={'r tot b' + (model.netCash < 0 ? ' neg' : '')}>{cfwParen(model.netCash)}</td>
            </tr>
          </tbody>
        </table>

        {/* detail */}
        <div className="cfw-detail-h">รายละเอียดประเภทรายจ่าย</div>
        {detailCats.length === 0 ? (
          <div className="cfw-empty">ไม่มีรายการค่าใช้จ่ายถึงกำหนดในรอบนี้</div>
        ) : (
          <table className="cfw-detail">
            <thead><tr><th className="l">ชื่อเจ้าหนี้ / คำอธิบายรายการ</th><th className="c">ครบกำหนด</th><th className="r">จำนวน (บาท)</th></tr></thead>
            <tbody>
              {detailCats.map((c) => {
                const open = collapsed[c.cat] !== true;
                return (
                  <React.Fragment key={c.cat}>
                    <tr className="cfw-d-cat" onClick={() => setCollapsed((p) => ({ ...p, [c.cat]: open }))}>
                      <td colSpan={2}>
                        <span className="cfw-tw">{open ? '▾' : '▸'}</span>
                        <span className={'rc-cat c' + c.cat} style={{ marginRight: 7 }}>{c.cat}</span>
                        {cfwCatLabel(c.cat)}
                        <span className="cfw-cnt">{c.items.length}</span>
                      </td>
                      <td className="r b">{fmtMoney(c.total, { digits: 2 })}</td>
                    </tr>
                    {open && c.vendors.map((v, vi) => (
                      <React.Fragment key={vi}>
                        <tr className="cfw-d-ven">
                          <td className="l"><b>{v.name}</b></td>
                          <td className="c muted">{v.items.length > 1 ? v.items.length + ' รายการ' : ''}</td>
                          <td className="r b">{fmtMoney(v.total, { digits: 2 })}</td>
                        </tr>
                        {v.items.map((it, ii) => (
                          <tr key={ii} className={'cfw-d-item' + (onEditItem ? ' cfw-d-item--edit' : '')} onClick={onEditItem ? () => onEditItem(it) : undefined}>
                            <td className="l"><span className="cfw-it-desc">{it.desc || '—'}</span>{it.ref ? <span className="cfw-it-ref"> · {it.ref}</span> : null}{onEditItem ? <span className="cfw-it-edit">✏ แก้</span> : null}</td>
                            <td className="c">{fmtDate(it.dueISO)}</td>
                            <td className="r">{fmtMoney(it.amount, { digits: 2 })}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                );
              })}
              <tr className="cfw-d-grand">
                <td className="l" colSpan={2}>รวมทั้งสิ้น</td>
                <td className="r">{fmtMoney(model.totalDue, { digits: 2 })}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── build model from live entities ────────────────────────────────────────
//   holdMode: 'gross' (default) = ยอดเต็มตามบัญชี · 'net' = หัก HOLD (ค้ำ LG / เช็คค้าง)
function cfwBuildModel(data, periodKey, holdMode) {
  const { fromISO, toISO } = cfwPeriodRange(periodKey);
  const snapByAc = cfwSnapByAc(data);

  // banks (main only) + available
  const banks = (data.bankAccounts || [])
    .filter((a) => {
      const t = String((typeof hpBankType !== 'undefined' ? hpBankType(a) : a.accountType) || 'main').toLowerCase();
      return t !== 'closed' && t !== 'dormant';
    })
    .map((a) => {
      const ac = hpBankAcNo(a);
      const base = (typeof hpBankBalance !== 'undefined') ? hpBankBalance(a, snapByAc) : (Number(a.BALANCE) || 0);
      const hold = Number(a.HOLD_AMOUNT || a.hold || 0);
      const avail = holdMode === 'net' ? base - hold : base;        // default = ยอดเต็ม (ไม่หัก HOLD)
      return { ac: String(ac), name: hpBankName(a), base, hold, avail };
    })
    .filter((b) => b.ac);

  const openingCash = banks.reduce((s, b) => s + b.avail, 0);
  // บัญชี default (ไม่ระบุ Bank_AC → ลงบัญชีที่มียอดมากสุด)
  const defaultAc = banks.slice().sort((a, b) => b.avail - a.avail)[0];
  const bankSet = new Set(banks.map((b) => b.ac));

  // ค่าใช้จ่ายถึงกำหนด = "แผนจ่าย" ที่ตั้งไว้แล้ว = forecastEntries เฉพาะ:
  //   • AP ที่วางแผนจ่าย (EXPENSE_TYPE='AP', REF_DOC=เลข AP — สร้างที่ Bank Diary/หน้านี้)
  //   • งวดค่าใช้จ่ายประจำ (EXPENSE_TYPE='RECURRING')
  //   → AP ที่ยังไม่วางแผน = ไม่มีแถว forecast = ไม่ขึ้น (ตามสเปก) · กรองตามรอบด้วย PAYMENT_DATE
  const INCLUDE_TYPES = new Set(['AP', 'RECURRING']);
  const SKIP_STATUS = new Set(['ACTUAL', 'BOOKED', 'CANCELED', 'CANCELLED']);
  const dues = [];
  (data.forecastEntries || []).forEach((fe) => {
    const et = String(fe.EXPENSE_TYPE || fe.expense_type || '').toUpperCase();
    if (!INCLUDE_TYPES.has(et)) return;                              // เอาเฉพาะ AP + recurring
    const amt = Number(fe.AMOUNT != null ? fe.AMOUNT : fe.amount) || 0;
    if (amt >= 0) return;                                            // เฉพาะรายจ่าย
    if (SKIP_STATUS.has(String(fe.STATUS || fe.status || '').toUpperCase())) return;
    const dueRaw = fe.PAYMENT_DATE || fe.payment_date || fe.DATE || fe.date;
    const dueISO = (typeof toISODate === 'function' ? toISODate(dueRaw) : String(dueRaw || '')).slice(0, 10);
    if (!dueISO || dueISO < fromISO || dueISO > toISO) return;
    const cat = (typeof categorizeForecastEntry === 'function') ? categorizeForecastEntry(fe) : (Number(fe.CATEGORY) || 1);
    let ac = String(fe.Bank_AC || fe.bankAc || '').trim();
    if (!ac || !bankSet.has(ac)) ac = defaultAc ? defaultAc.ac : '';
    dues.push({
      cat, ac, dueISO, amount: Math.abs(amt),
      desc: fe.DESCRIPTION || fe.description || fe.NOTE || fe.note || '',
      ref: fe.REF_DOC || fe.ref_doc || '',
      id: fe.id, expType: et,                                        // สำหรับกดแก้ในหน้านี้
    });
  });

  // pivot
  const bankDue = {}, bankCat = {}, byCat = {};
  let totalDue = 0;
  dues.forEach((d) => {
    bankDue[d.ac] = (bankDue[d.ac] || 0) + d.amount;
    (bankCat[d.ac] = bankCat[d.ac] || {})[d.cat] = (bankCat[d.ac][d.cat] || 0) + d.amount;
    (byCat[d.cat] = byCat[d.cat] || { total: 0, items: [] });
    byCat[d.cat].total += d.amount;
    byCat[d.cat].items.push(d);
    totalDue += d.amount;
  });

  // cats — โชว์ครบ 4 หมวดเสมอ (มียอด=แสดงยอด, ไม่มี=เว้น) + group ผู้ขายในแต่ละหมวด
  const cats = CFW_CAT_ORDER.map((c) => {
    const info = byCat[c] || { total: 0, items: [] };
    const venMap = {};
    info.items.forEach((it) => {
      const key = (it.desc || '—').trim() || '—';
      (venMap[key] = venMap[key] || { name: key, total: 0, items: [] });
      venMap[key].total += it.amount;
      venMap[key].items.push(it);
    });
    const vendors = Object.values(venMap)
      .map((v) => { v.items.sort((a, b) => (a.dueISO < b.dueISO ? -1 : 1)); return v; })
      .sort((a, b) => b.total - a.total);
    return { cat: c, total: info.total, items: info.items, vendors };
  });

  const totalHold = banks.reduce((s, b) => s + (b.hold || 0), 0);
  const grossCash = banks.reduce((s, b) => s + (b.base || 0), 0);
  return { banks, openingCash, grossCash, totalHold, anyHold: totalHold > 0, bankDue, bankCat, totalDue, netCash: openingCash - totalDue, cats };
}

const CFW_CSS = `
.cfw-page{max-width:1180px;--cfw-in:#0d9488;--cfw-in-soft:rgba(20,184,166,.10);--cfw-out:#b14070;--cfw-due-soft:rgba(245,158,11,.12)}
.cfw-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.cfw-periods{display:flex;gap:6px;flex-wrap:wrap}
.cfw-chip{border:1px solid var(--line);background:#fff;color:var(--ink-600);padding:6px 14px;border-radius:999px;font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:.14s}
.cfw-chip:hover{border-color:var(--brand-400);color:var(--brand-700)}
.cfw-chip.active{background:var(--brand-600);color:#fff;border-color:var(--brand-600)}
.cfw-tools{display:flex;gap:7px}
.cfw-report{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--shadow-sm)}
.cfw-head{display:flex;align-items:center;gap:16px;padding:20px 24px;background:linear-gradient(135deg,var(--brand-700),var(--brand-900));color:#fff}
.cfw-logo{height:54px;width:54px;object-fit:contain;background:#fff;border-radius:11px;padding:6px;flex-shrink:0}
.cfw-head-mid{flex:1;min-width:0}
.cfw-brand{font-size:11px;font-weight:700;opacity:.85;letter-spacing:.7px}
.cfw-title{font-size:21px;font-weight:800;letter-spacing:-.3px;margin-top:2px}
.cfw-co{font-size:12.5px;opacity:.9;margin-top:3px}
.cfw-head-right{text-align:right;flex-shrink:0}
.cfw-rl{font-size:10.5px;opacity:.8;letter-spacing:.4px}
.cfw-rv{font-size:15px;font-weight:800;margin-top:1px}
.cfw-rd{font-size:10.5px;opacity:.75;margin-top:3px}
.cfw-body{padding:18px 24px 24px;overflow-x:auto}
.cfw-pivot{width:100%;border-collapse:collapse;font-size:13px}
.cfw-pivot th{border-bottom:2px solid var(--brand-500);color:var(--brand-800);padding:12px 12px;font-weight:700;vertical-align:bottom;white-space:nowrap}
.cfw-pivot th.l{text-align:left} .cfw-pivot th.r{text-align:right}
.cfw-pivot th.tot{background:var(--brand-50)}
.cfw-pivot td{padding:8px 12px;white-space:nowrap}
.cfw-pivot td.l{text-align:left;font-weight:700;color:var(--ink-800)}
.cfw-pivot td.r{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink-800)}
.cfw-pivot td.tot{background:var(--brand-50)}
.cfw-pivot td.b{font-weight:800}
.cfw-pivot td.sub{font-weight:500;color:var(--ink-500);font-size:12.5px}
.cfw-pivot td.l.sub{padding-left:26px}
.cfw-pivot td.neg{color:var(--bad)}
.cfw-bk{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.cfw-bk .hp-bank-logo{width:30px;height:30px;border-radius:7px;overflow:hidden;flex-shrink:0}
.cfw-bk .hp-bank-logo-img{width:100%;height:100%;object-fit:cover}
.cfw-bk-t{text-align:right;line-height:1.25}
.cfw-bk-n{font-size:13px;font-weight:800;color:var(--brand-800)}
.cfw-bk-a{font-size:11px;color:var(--ink-400);font-weight:600;font-variant-numeric:tabular-nums}
.cfw-avail{background:var(--cfw-in-soft)}
.cfw-avail td.l{color:var(--cfw-in)}
.cfw-due{background:var(--cfw-due-soft)}
.cfw-catrow td.sub.neg{color:var(--cfw-out);font-weight:700}
.cfw-net td{border-top:2px solid var(--brand-500);background:var(--brand-50);font-weight:800;color:var(--brand-900);padding-top:11px;padding-bottom:11px}
.cfw-net td.tot{background:var(--brand-100)}
.cfw-detail-h{margin:20px 0 8px;font-size:13.5px;font-weight:800;color:var(--brand-800)}
.cfw-empty{padding:26px;text-align:center;color:var(--ink-400);font-size:12.5px}
.cfw-detail{width:100%;border-collapse:collapse;font-size:12px}
.cfw-detail th{background:var(--ink-50);color:var(--ink-500);padding:8px 12px;font-weight:700;font-size:11px;border-bottom:1px solid var(--line)}
.cfw-detail th.l{text-align:left} .cfw-detail th.c{text-align:center} .cfw-detail th.r{text-align:right}
.cfw-detail td{padding:7px 12px}
.cfw-detail td.l{text-align:left} .cfw-detail td.c{text-align:center;color:var(--ink-500)} .cfw-detail td.r{text-align:right;font-variant-numeric:tabular-nums}
.cfw-detail td.b{font-weight:800}
.cfw-detail .muted{color:var(--ink-400);font-size:11px}
.cfw-d-cat{background:linear-gradient(90deg,var(--brand-100),var(--brand-50));cursor:pointer;border-left:4px solid var(--brand-500)}
.cfw-d-cat td{font-weight:800;color:var(--brand-900);font-size:13px;padding:10px 12px}
.cfw-tw{display:inline-block;width:15px;color:var(--brand-600);font-size:11px}
.cfw-cnt{display:inline-block;margin-left:7px;background:var(--brand-600);color:#fff;border-radius:999px;padding:1px 8px;font-size:10.5px;font-weight:700}
.cfw-d-ven td{border-top:1px solid var(--line-soft);color:var(--ink-800);padding-top:9px}
.cfw-d-ven td.l{padding-left:18px}
.cfw-d-item td{color:var(--ink-600);border-top:1px dashed var(--line-soft)}
.cfw-d-item td.l{padding-left:34px}
.cfw-it-desc{color:var(--ink-700)} .cfw-it-ref{color:var(--ink-400);font-size:11px}
.cfw-d-grand td{border-top:2px solid var(--brand-500);background:var(--brand-50);font-weight:800;color:var(--brand-900);font-size:13px;padding:11px 12px}
.cfw-d-grand td.r{color:var(--cfw-out)}
.rc-cat{display:inline-flex;width:18px;height:18px;border-radius:5px;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:#fff;vertical-align:middle}
.rc-cat.c1{background:#2563eb}.rc-cat.c2{background:#7c3aed}.rc-cat.c3{background:#d97706}.rc-cat.c4{background:#0d9488}
.cfw-d-item--edit{cursor:pointer}
.cfw-d-item--edit:hover td{background:var(--brand-50)}
.cfw-it-edit{display:none;margin-left:8px;font-size:10.5px;color:var(--brand-600);font-weight:700}
.cfw-d-item--edit:hover .cfw-it-edit{display:inline}
.cfw-edit{display:flex;flex-direction:column;gap:9px}
.cfw-edit-name{font-size:15px;font-weight:800;color:var(--ink-900)}
.cfw-edit-meta{font-size:12px;color:var(--ink-600);display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.cfw-edit-ref{color:var(--ink-400)}
.cfw-edit-tag{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:2px}
.cfw-edit-tag.ap{background:#fff7ed;color:#c2410c}.cfw-edit-tag.rec{background:var(--brand-50);color:var(--brand-700)}
.cfw-edit-amt{font-size:13px;font-weight:700;color:var(--cfw-out,#b14070)}
.cfw-edit-fld{display:flex;flex-direction:column;gap:5px;margin-top:2px}
.cfw-edit-fld>span{font-size:12px;font-weight:700;color:var(--ink-600)}
.cfw-edit-fld input{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;background:#fff;color:var(--ink-800)}
.cfw-edit-fld input:focus{outline:none;border-color:var(--brand-500);box-shadow:0 0 0 3px var(--brand-100)}
.cfw-edit-note{font-size:11px;color:var(--ink-400);line-height:1.5;background:var(--ink-50);padding:8px 10px;border-radius:8px}
.cfw-unplan{color:var(--bad)!important;border-color:var(--bad)!important}
.cfw-hold-tog{display:inline-flex;align-items:center;gap:4px;background:var(--ink-50);border:1px solid var(--line);border-radius:9px;padding:3px}
.cfw-hold-lbl{font-size:11px;color:var(--ink-500);font-weight:600;padding:0 4px}
.cfw-hold-tog button{border:none;background:transparent;color:var(--ink-600);font-family:inherit;font-size:12px;font-weight:600;padding:4px 11px;border-radius:7px;cursor:pointer}
.cfw-hold-tog button.active{background:#fff;color:var(--brand-700);box-shadow:var(--shadow-sm)}
/* export preview overlay — โชว์รายงานเต็ม + ปุ่ม PNG/PDF/ปิด ด้านบน */
.cfw-exp-overlay{position:fixed;inset:0;z-index:1100;background:rgba(15,23,42,.5);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto}
.cfw-exp-win{background:#fff;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.34);width:100%;max-width:1060px;margin:auto;overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 48px)}
.cfw-exp-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel,#fff);position:sticky;top:0;z-index:2}
.cfw-exp-title{font-size:13.5px;font-weight:800;color:var(--ink-800)}
.cfw-exp-btns{display:flex;gap:7px}
.cfw-exp-scroll{overflow:auto;padding:16px;background:#eef2f7}
.cfw-exp-scroll .cfw-report{box-shadow:var(--shadow-sm)}
@media print{
  body:has(.cfw-page) .sb,
  body:has(.cfw-page) .sb-scrim,
  body:has(.cfw-page) .topbar{display:none!important}
  body:has(.cfw-page) .app{grid-template-columns:1fr!important;display:block!important}
  body:has(.cfw-page) .main{max-width:none!important;padding:0!important;margin:0!important;overflow:visible!important}
  .cfw-body{overflow:visible!important}
  .cfw-toolbar{display:none!important}
  .cfw-report{border:none!important;box-shadow:none!important}
  .cfw-page,.cfw-page *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  /* ตอนเปิดหน้าต่าง export → พิมพ์เฉพาะรายงานใน modal (ซ่อนรายงานบนหน้า + แถบปุ่ม) */
  body:has(.cfw-exp-overlay) .cfw-page>.cfw-report{display:none!important}
  body:has(.cfw-exp-overlay) .cfw-exp-overlay{position:static!important;inset:auto!important;background:none!important;padding:0!important;overflow:visible!important;display:block!important}
  body:has(.cfw-exp-overlay) .cfw-exp-win{max-width:none!important;max-height:none!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important}
  body:has(.cfw-exp-overlay) .cfw-exp-bar{display:none!important}
  body:has(.cfw-exp-overlay) .cfw-exp-scroll{overflow:visible!important;max-height:none!important;padding:0!important;background:none!important}
}
`;
