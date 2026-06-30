// app/page_recurring.jsx
// ── ค่าใช้จ่ายประจำ (Recurring Expenses) ────────────────────────────────────
// route: #recurring  ·  ปรับจากต้นแบบ finance-tools ให้เข้ากับ BIOAXEL
//
// แนวคิด: ทะเบียนคุมรายจ่ายประจำ (เงินเดือน · ค่าเช่า · ประกันสังคม ฯลฯ) แล้วกด
//   "Materialise" → สร้างแถว forecastEntries งวดจ่ายล่วงหน้า → ไหลเข้า Weekly
//   Forecast + Cash Flow Forecast (ประมาณการรายรับ-รายจ่าย) ที่มีอยู่เดิม.
//
// STORAGE (sync ทั้งทีม, ไม่ต้องสร้าง Supabase table ใหม่):
//   WTPOverride ราย key  "rec.<id>" = JSON string ของ def (เก็บผ่าน setRaw)
//   def = { id, name, cat(1-4), amount, freq, day, startDate, endDate, bankAc, remark, active, deleted }
//   freq ∈ monthly | quarterly | yearly | one_time  ·  day 1-31 หรือ -1 = สิ้นเดือน
//   ลบ = tombstone (deleted:true) กัน sync-delete edge case
//
// MATERIALISE → forecastEntries:
//   STATUS='PLANNED' · EXPENSE_TYPE='RECURRING' · AMOUNT<0 (รายจ่าย) · CATEGORY='1'..'4'
//   REF_DOC = "REC-<defId>-<YYYY-MM>"  (กันสร้างซ้ำ — งวดที่มี REF_DOC นี้แล้วจะข้าม)
//   CATEGORY 1-4 = หมวดเดียวกับ page_cashflow (CATEGORY_LABELS) → ระบบเดิมจัดกลุ่มได้ทันที

const { useState: rcState, useMemo: rcMemo } = React;

const RC_FREQ = [
  ['monthly',   'รายเดือน'],
  ['quarterly', 'ราย 3 เดือน'],
  ['yearly',    'รายปี'],
  ['one_time',  'ครั้งเดียว'],
];
const rcFreqLabel = (f) => (RC_FREQ.find((x) => x[0] === f) || ['', f])[1];
const RC_KEY_PREFIX = 'rec.';
// หมวด 1-4 (เหมือน page_cashflow) — CATEGORY_LABELS เป็น global จาก page_cashflow.jsx
const rcCatLabel = (c) => (typeof CATEGORY_LABELS !== 'undefined' && CATEGORY_LABELS[c]) || ('หมวด ' + c);
const RC_CATS = [1, 2, 3, 4];

// ── date helpers ──────────────────────────────────────────────────────────
function rcToISO(v) {
  const d = parseDateFlexible(v);
  if (!d || isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rcLastDay(y, m1) { return new Date(y, m1, 0).getDate(); }
function rcISO(y, m1, d) {
  const dd = Math.min(d, rcLastDay(y, m1));
  return `${y}-${String(m1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
// วันครบกำหนดของ def ในเดือน y/m1 (คืน ISO หรือ null ถ้าไม่ถึงงวดในเดือนนั้น)
function rcDueInMonth(def, y, m1) {
  const startISO = rcToISO(def.startDate);
  if (!startISO) return null;
  const start = parseDateFlexible(startISO);
  const sY = start.getFullYear(), sM = start.getMonth() + 1;
  if (y < sY || (y === sY && m1 < sM)) return null;                  // ก่อนเดือนเริ่ม
  const monthsSince = (y - sY) * 12 + (m1 - sM);
  let due;
  switch (def.freq) {
    case 'monthly':   due = true; break;
    case 'quarterly': due = monthsSince % 3 === 0; break;
    case 'yearly':    due = monthsSince % 12 === 0; break;
    case 'one_time':  due = monthsSince === 0; break;
    default:          due = true;
  }
  if (!due) return null;
  const day = Number(def.day) === -1 ? rcLastDay(y, m1) : (Number(def.day) || 1);
  const iso = rcISO(y, m1, day);
  if (iso < startISO) return null;                                  // งวดแรกไม่ย้อนก่อนวันเริ่ม
  const endISO = rcToISO(def.endDate);
  if (endISO && iso > endISO) return null;                          // เลยวันสิ้นสุด
  return iso;
}
// งวดทั้งหมดในช่วง [fromISO, toISO] (เฉพาะ def ที่ active)
function rcOccurrences(defs, fromISO, toISO) {
  const out = [];
  const from = parseDateFlexible(fromISO), to = parseDateFlexible(toISO);
  if (!from || !to) return out;
  defs.forEach((def) => {
    if (!def.active) return;
    let y = from.getFullYear(), m = from.getMonth() + 1;
    const eY = to.getFullYear(), eM = to.getMonth() + 1;
    while (y < eY || (y === eY && m <= eM)) {
      const iso = rcDueInMonth(def, y, m);
      if (iso && iso >= fromISO && iso <= toISO) {
        out.push({ def, dueISO: iso, amount: Number(def.amount) || 0, ym: `${y}-${String(m).padStart(2, '0')}` });
      }
      m++; if (m > 12) { m = 1; y++; }
    }
  });
  out.sort((a, b) => (a.dueISO < b.dueISO ? -1 : a.dueISO > b.dueISO ? 1 : 0));
  return out;
}

// ── store (WTPOverride per-row JSON) ──────────────────────────────────────
function rcLoadDefs() {
  const all = (typeof WTPOverride !== 'undefined') ? WTPOverride._load() : {};
  const out = [];
  Object.keys(all).forEach((k) => {
    if (!k.startsWith(RC_KEY_PREFIX)) return;
    let v = all[k];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return; } }
    if (!v || typeof v !== 'object' || v.deleted) return;
    out.push(v);
  });
  out.sort((a, b) => (Number(a.cat) - Number(b.cat)) || String(a.name || '').localeCompare(String(b.name || ''), 'th'));
  return out;
}
function rcSaveDef(def) { WTPOverride.setRaw(RC_KEY_PREFIX + def.id, JSON.stringify(def)); }
function rcDeleteDef(def) { WTPOverride.setRaw(RC_KEY_PREFIX + def.id, JSON.stringify({ ...def, deleted: true })); }

// ── Materialise → forecastEntries ─────────────────────────────────────────
function rcMaterialise(defs, data, setData, months, toast) {
  const today = new Date();
  const fromISO = rcToISO(today);
  const end = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
  const toISO = rcToISO(end);
  const occ = rcOccurrences(defs, fromISO, toISO);
  const existing = new Set((data.forecastEntries || [])
    .filter((fe) => String(fe.EXPENSE_TYPE || '').toUpperCase() === 'RECURRING')
    .map((fe) => String(fe.REF_DOC || '')));
  const newRows = [];
  occ.forEach((o) => {
    if (Math.abs(o.amount) <= 0) return;                              // ข้ามรายการที่ยังไม่กรอกยอด (=0)
    const ref = `REC-${o.def.id}-${o.ym}`;
    if (existing.has(ref)) return;
    newRows.push({
      id: WTPData.newId(),
      DATE: fromISO,
      PAYMENT_DATE: o.dueISO,
      AMOUNT: String(-Math.abs(o.amount)),
      DESCRIPTION: o.def.name,
      CATEGORY: String(o.def.cat),
      Bank_AC: o.def.bankAc || null,
      STATUS: 'PLANNED',
      EXPENSE_TYPE: 'RECURRING',
      REF_DOC: ref,
      NOTE: 'ค่าใช้จ่ายประจำ (auto)',
    });
  });
  if (!newRows.length) { toast && toast('ไม่มีงวดใหม่ที่ต้องสร้าง — สร้างครบช่วงนี้แล้ว'); return 0; }
  setData((d) => ({ ...d, forecastEntries: [...(d.forecastEntries || []), ...newRows] }));
  if (typeof WTPData !== 'undefined' && WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(), 200);
  toast && toast(`สร้างประมาณการ ${newRows.length} งวด → เข้าหน้า Weekly Forecast แล้ว`);
  return newRows.length;
}
// ล้างงวด RECURRING ที่ยังไม่ถึงกำหนด (PLANNED, PAYMENT_DATE >= วันนี้) — ใช้ก่อน re-materialise
function rcClearFuture(data, setData, toast) {
  const todayISO = rcToISO(new Date());
  const before = (data.forecastEntries || []).length;
  const next = (data.forecastEntries || []).filter((fe) => {
    if (String(fe.EXPENSE_TYPE || '').toUpperCase() !== 'RECURRING') return true;
    if (String(fe.STATUS || '').toUpperCase() !== 'PLANNED') return true;     // กันแตะของที่จ่ายจริงแล้ว
    const dISO = rcToISO(fe.PAYMENT_DATE || fe.DATE);
    return dISO < todayISO;                                                    // เก็บงวดในอดีต, ทิ้งงวดอนาคต
  });
  const removed = before - next.length;
  if (!removed) { toast && toast('ไม่มีงวดล่วงหน้าให้ล้าง'); return 0; }
  setData((d) => ({ ...d, forecastEntries: next }));
  if (typeof WTPData !== 'undefined' && WTPData.forceSyncNow) setTimeout(() => WTPData.forceSyncNow(), 200);
  toast && toast(`ล้างงวดล่วงหน้า ${removed} รายการ`);
  return removed;
}

// ── Seed importer — รายการแม่ค่าใช้จ่ายประจำจากฝ่ายบัญชี (BIO - ค่าใช้จ่าย.pdf) ──
//   PDF มีแค่ ชื่อ + Code บัญชี (GL) + เบอร์/แผนก — ไม่มียอด/ความถี่/วันจ่าย
//   → โหลดด้วย amount=0 · freq=monthly · Code+เบอร์+แผนก เก็บใน remark
//   หมวด 1-4 = เดาเบื้องต้น (โทร/เน็ต/สาธารณูปโภค=1 · ดอกเบี้ย=3 · ภาษี/ประกัน/ที่ปรึกษา=4) — ปรับได้รายตัว
//   day=-1 (สิ้นเดือน) เฉพาะที่ PDF ระบุ "ตั้งวันสิ้นเดือน" (ประกันสังคม · ภงด.1)
const RC_SEED = [
  // A. โทรศัพท์ / อินเตอร์เน็ต → หมวด 1 (ดำเนินงาน)
  { name: 'ค่าอินเตอร์เน็ต สมุยทาวน์',        cat: 1, remark: 'AIS · เบอร์ 8803796237 · แผนก 004 · Code C100-53-303001' },
  { name: 'ค่าโทรศัพท์การเงิน',              cat: 1, remark: 'AIS · เบอร์ 0822056487 · แผนก 001 · Code C100-53-70-50201' },
  { name: 'ค่าโทรศัพท์ออฟฟิศ สมุยทาวน์',     cat: 1, remark: 'AIS · เบอร์ 0828548996 · แผนก 004 · Code C100-53-70-50201' },
  { name: 'ค่าโทรศัพท์ หาดใหญ่',            cat: 1, remark: 'TRUEMOVE H · เบอร์ 0806380313 · แผนก 006 · Code C100-53-70-50201' },
  { name: 'ค่าโทรศัพท์ แอดมิน สุพรรณบุรี',   cat: 1, remark: 'TRIPLE T / 3BB · เบอร์ 0922814466 · แผนก 002 · Code SPBR-53-301156-08' },
  { name: 'ค่าโทรศัพท์ HR/BKK',            cat: 1, remark: 'โทรคมนาคม · เบอร์ 0638305530 · แผนก 001 · Code C100-53-304012' },
  { name: 'ค่าโทรศัพท์ SV',                cat: 1, remark: 'เบอร์ 0917937999 · แผนก 001 · Code C100-53-304011' },
  { name: 'ค่าอินเตอร์เน็ต (303260547)',    cat: 1, remark: 'เบอร์ 303260547 · แผนก 001 · Code C100-53-303001' },
  { name: 'ค่าอินเตอร์เน็ต หาดใหญ่',        cat: 1, remark: 'เบอร์ 430131490 · แผนก 006 · Code C100-53-303001' },
  { name: 'ค่าอินเตอร์เน็ต (440261703)',    cat: 1, remark: 'เบอร์ 440261703 · แผนก 006 · Code C100-53-303001' },
  { name: 'ค่าอินเตอร์เน็ต สมุยทาวน์ #2',   cat: 1, remark: 'เบอร์ 0774135365 · แผนก 004 · Code C100-53-303001' },
  // B. ค่าใช้จ่ายประจำ RO
  { name: 'กองทุนสำรองเลี้ยงชีพ',           cat: 4, remark: 'Code L1021200002' },
  { name: 'ประกันสังคม',                   cat: 4, day: -1, remark: 'Code L1021200000 · แยก สนญ./สาขา · ตั้งวันสิ้นเดือน' },
  { name: 'กยศ.',                          cat: 4, remark: 'Code L1021300001' },
  { name: 'ภงด.1',                         cat: 4, day: -1, remark: 'กรมสรรพากร · บันทึกแยกสาขา · Code L1021100100 · ตั้งวันสิ้นเดือน' },
  { name: 'ภงด.3',                         cat: 4, remark: 'กรมสรรพากร · Code L1021100300' },
  { name: 'ภงด.53',                        cat: 4, remark: 'กรมสรรพากร · Code L1021100100' },
  { name: 'ภงด.54',                        cat: 4, remark: 'กรมสรรพากร · Code L1021100502' },
  { name: 'ภพ.36',                         cat: 4, remark: 'กรมสรรพากร · Code L1021100503' },
  { name: 'ดอกเบี้ยเงินกู้',                cat: 3, remark: 'Code 7100-01' },
  { name: 'ค่านายหน้า',                    cat: 1, remark: 'Code C1052030000' },
  { name: 'ค่าบริการทำบัญชี (เทพธรรม)',     cat: 4, remark: 'Code 2161-09' },
  // C. ค่าใช้จ่ายประจำ RC
  { name: 'Fleet Card (กสิกร)',            cat: 1, remark: 'Code C1053400100' },
  { name: 'เยล คอม',                       cat: 1, remark: 'Code C100-53-70-50201' },
  { name: 'ค่าโดเมน Google',               cat: 1, freq: 'yearly', remark: 'Code C100-53-203005' },
  { name: 'ค่าเช่าโกดัง (แสงฟ้า)',          cat: 1, remark: 'Code C100-51-690323-1' },
  { name: 'ค่าบริการพื้นที่ WTP',           cat: 1, remark: 'Code C100-53-20-10100' },
  { name: 'ค่าไฟฟ้า สุพรรณ (บางเลน)',       cat: 1, remark: 'Code C1051040400 / 5390-01' },
  { name: 'ค่าที่ปรึกษา - ปัฐญกาญจน์',      cat: 4, remark: 'Code C1053600105' },
];
function rcImportSeed(defs, toast) {
  const existing = new Set(defs.map((d) => String(d.name || '').trim()));
  let added = 0;
  RC_SEED.forEach((s) => {
    if (existing.has(s.name.trim())) return;
    const id = 'rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + (added++);
    rcSaveDef({
      id, name: s.name, cat: s.cat || 1, amount: 0, freq: s.freq || 'monthly',
      day: s.day == null ? 1 : s.day, startDate: rcToISO(new Date()), endDate: '',
      bankAc: '', remark: s.remark || '', active: true, deleted: false,
    });
  });
  if (!added) { toast && toast('รายการทั้งหมดมีอยู่ในทะเบียนแล้ว'); return 0; }
  toast && toast(`นำเข้า ${added} รายการจากบัญชี — โปรดเติมยอด + ปรับวันจ่าย/ความถี่ แล้วค่อย Materialise`);
  return added;
}

// ── bank options (เลขบัญชี) — reuse hpBank* helpers จาก page_home ──────────
function rcBankOptions(data) {
  return (data.bankAccounts || [])
    .filter((a) => {
      const t = String((typeof hpBankType !== 'undefined' ? hpBankType(a) : a.accountType) || 'main').toLowerCase();
      return t !== 'closed' && t !== 'dormant';
    })
    .map((a) => ({ ac: hpBankAcNo(a), name: hpBankName(a) }))
    .filter((a) => a.ac);
}
function rcBankLabel(data, ac) {
  if (!ac) return '— ไม่ระบุ —';
  const a = (data.bankAccounts || []).find((x) => String(hpBankAcNo(x)) === String(ac));
  if (!a) return String(ac);
  return `${hpBankName(a)} · ${hpLast4(ac)}`;
}

// ════════════════════════════════════════════════════════════════════════
// PAGE
// ════════════════════════════════════════════════════════════════════════
function RecurringExpensesPage({ data, setData, toast }) {
  const canEdit = !!(window.WTPAuth && window.WTPAuth.can('canEdit'));
  const [tick, setTick] = rcState(0);          // re-read defs หลังเขียน WTPOverride
  const [edit, setEdit] = rcState(null);       // def ที่กำลังแก้ (object) หรือ {} = เพิ่มใหม่
  const [months, setMonths] = rcState(6);

  // re-render เมื่อ override sync เปลี่ยน
  React.useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener('wtp-override-change', h);
    return () => window.removeEventListener('wtp-override-change', h);
  }, []);

  const defs = rcMemo(() => rcLoadDefs(), [tick, data.manualOverrides]);
  const active = defs.filter((d) => d.active);
  const monthlyEq = active.reduce((s, d) => {
    const a = Number(d.amount) || 0;
    const per = d.freq === 'monthly' ? a : d.freq === 'quarterly' ? a / 3 : d.freq === 'yearly' ? a / 12 : 0;
    return s + per;
  }, 0);

  // งวด 90 วันข้างหน้า + เช็คว่า materialise แล้วหรือยัง (REF_DOC อยู่ใน forecastEntries)
  const upcoming = rcMemo(() => {
    const todayISO = rcToISO(new Date());
    const end = new Date(); end.setDate(end.getDate() + 90);
    const occ = rcOccurrences(defs, todayISO, rcToISO(end));
    const refSet = new Set((data.forecastEntries || [])
      .filter((fe) => String(fe.EXPENSE_TYPE || '').toUpperCase() === 'RECURRING')
      .map((fe) => String(fe.REF_DOC || '')));
    return occ.map((o) => ({ ...o, done: refSet.has(`REC-${o.def.id}-${o.ym}`) }));
  }, [defs, data.forecastEntries]);

  const doSave = (def) => {
    const id = def.id || ('rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    rcSaveDef({
      id, name: String(def.name || '').trim(), cat: Number(def.cat) || 1,
      amount: Number(def.amount) || 0, freq: def.freq || 'monthly',
      day: Number(def.day), startDate: rcToISO(def.startDate), endDate: rcToISO(def.endDate),
      bankAc: def.bankAc || '', remark: String(def.remark || '').trim(),
      active: def.active !== false, deleted: false,
    });
    setEdit(null); setTick((t) => t + 1);
    toast && toast(def.id ? 'อัปเดตแล้ว' : 'เพิ่มรายการแล้ว');
  };
  const doImport = () => {
    if (!confirm(`นำเข้ารายการค่าใช้จ่ายประจำจากฝ่ายบัญชี (${RC_SEED.length} รายการ) ?\n\n• ยอด = 0 (ต้องเติมเอง) · ความถี่ = รายเดือน · Code บัญชี+เบอร์+แผนก อยู่ในหมายเหตุ\n• หมวด 1-4 เป็นค่าเดาเบื้องต้น — ปรับได้รายตัว\n• รายการชื่อซ้ำที่มีอยู่แล้วจะถูกข้าม`)) return;
    rcImportSeed(defs, toast); setTick((t) => t + 1);
  };
  const doToggle = (def) => { rcSaveDef({ ...def, active: !def.active }); setTick((t) => t + 1); };
  const doDelete = (def) => {
    if (!confirm(`ลบ "${def.name}" ?\n(งวดที่ materialise ไปแล้วใน Forecast จะยังอยู่ — ใช้ปุ่ม "ล้างงวดล่วงหน้า" ถ้าต้องการเอาออก)`)) return;
    rcDeleteDef(def); setTick((t) => t + 1); toast && toast('ลบแล้ว');
  };

  return (
    <div className="rc-page">
      <style>{RC_CSS}</style>

      <div className="card-hd" style={{ marginBottom: 14 }}>
        <div>
          <div className="card-title">ค่าใช้จ่ายประจำ</div>
          <div className="card-sub">ทะเบียนคุมรายจ่ายประจำ · Materialise งวดจ่ายล่วงหน้า → ไหลเข้า Weekly Forecast &amp; Cash Flow Forecast</div>
        </div>
      </div>

      {/* stat tiles */}
      <div className="rc-stats">
        <div className="rc-stat out"><div className="n">{fmtMoney(monthlyEq, { digits: 0 })}</div><div className="l">เทียบเท่ารายเดือน</div></div>
        <div className="rc-stat"><div className="n">{active.length}</div><div className="l">รายการที่เปิดใช้</div></div>
        <div className="rc-stat in"><div className="n">{upcoming.filter((o) => !o.done).length}</div><div className="l">งวดรอ Materialise (90 วัน)</div></div>
        <div className="rc-stat ok"><div className="n">{upcoming.filter((o) => o.done).length}</div><div className="l">งวดสร้างแล้ว (90 วัน)</div></div>
      </div>

      {/* register */}
      <div className="card">
        <div className="rc-bar">
          <div className="card-title" style={{ fontSize: 15 }}>ทะเบียนค่าใช้จ่ายประจำ</div>
          {canEdit && (
            <div className="rc-actions">
              <span className="rc-mlbl">สร้างล่วงหน้า</span>
              <select className="rc-sel" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {[3, 6, 12].map((m) => <option key={m} value={m}>{m} เดือน</option>)}
              </select>
              <button className="btn btn-ghost btn-sm" onClick={() => rcClearFuture(data, setData, toast)}>ล้างงวดล่วงหน้า</button>
              <button className="btn btn-ghost btn-sm" onClick={() => rcMaterialise(defs, data, setData, months, toast)}>⟳ Materialise</button>
              <button className="btn btn-ghost btn-sm" onClick={doImport}>⬇ นำเข้าจากบัญชี</button>
              <button className="btn btn-primary btn-sm" onClick={() => setEdit({ active: true, freq: 'monthly', cat: 1, day: 1, startDate: rcToISO(new Date()) })}>+ เพิ่มรายการ</button>
            </div>
          )}
        </div>

        {defs.length === 0 ? (
          <div className="rc-empty">ยังไม่มีรายการ{canEdit ? ' — กด "+ เพิ่มรายการ"' : ''}</div>
        ) : (
          <div className="rc-tbl-wrap">
            <table className="rc-tbl">
              <thead>
                <tr>
                  <th>ชื่อ</th><th>หมวด</th><th>ความถี่</th><th>วันจ่าย</th><th>ตัดจากบัญชี</th>
                  <th className="r">ยอด</th><th>เริ่ม</th><th>สิ้นสุด</th><th>สถานะ</th>{canEdit && <th className="r">จัดการ</th>}
                </tr>
              </thead>
              <tbody>
                {defs.map((d) => (
                  <tr key={d.id} className={d.active ? '' : 'rc-off'}>
                    <td><b>{d.name}</b></td>
                    <td><span className={'rc-cat c' + d.cat}>{d.cat}</span> <span className="rc-catt">{rcCatLabel(d.cat)}</span></td>
                    <td>{rcFreqLabel(d.freq)}</td>
                    <td>{Number(d.day) === -1 ? 'สิ้นเดือน' : (d.day || '—')}</td>
                    <td className="rc-muted">{rcBankLabel(data, d.bankAc)}</td>
                    <td className="r b">{fmtMoney(d.amount, { digits: 0 })}</td>
                    <td>{d.startDate ? fmtDate(d.startDate) : '—'}</td>
                    <td>{d.endDate ? fmtDate(d.endDate) : 'ต่อเนื่อง'}</td>
                    <td><span className={'rc-badge ' + (d.active ? 'on' : 'offb')}>{d.active ? 'เปิดใช้' : 'ปิด'}</span></td>
                    {canEdit && (
                      <td className="r rc-rowact">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEdit(d)}>แก้</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => doToggle(d)}>{d.active ? 'ปิด' : 'เปิด'}</button>
                        <button className="btn btn-ghost btn-sm rc-del" onClick={() => doDelete(d)}>ลบ</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* upcoming occurrences */}
      {upcoming.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ fontSize: 15, marginBottom: 4 }}>งวดที่จะจ่าย (90 วันข้างหน้า)</div>
          <div className="card-sub" style={{ marginBottom: 10 }}>คำนวณสดจากทะเบียน · ✓ = สร้างเป็นประมาณการแล้ว</div>
          <div className="rc-tbl-wrap">
            <table className="rc-tbl">
              <thead><tr><th>วันที่จ่าย</th><th>รายการ</th><th>หมวด</th><th className="r">ยอด</th><th>สถานะ</th></tr></thead>
              <tbody>
                {upcoming.map((o, i) => {
                  const days = Math.round((parseDateFlexible(o.dueISO) - new Date()) / 86400000);
                  return (
                    <tr key={i}>
                      <td>{fmtDate(o.dueISO)} <span className="rc-muted">{days <= 0 ? '(วันนี้)' : '(อีก ' + days + ' วัน)'}</span></td>
                      <td><b>{o.def.name}</b></td>
                      <td><span className="rc-catt">{rcCatLabel(o.def.cat)}</span></td>
                      <td className="r b">{fmtMoney(o.amount, { digits: 0 })}</td>
                      <td>{o.done ? <span className="rc-badge on">✓ สร้างแล้ว</span> : <span className="rc-badge wait">รอ Materialise</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edit && <RcForm data={data} init={edit} onSave={doSave} onClose={() => setEdit(null)} />}
    </div>
  );
}

// ── add/edit modal ────────────────────────────────────────────────────────
function RcForm({ data, init, onSave, onClose }) {
  const [f, setF] = rcState({
    id: init.id, name: init.name || '', cat: init.cat || 1, amount: init.amount || '',
    freq: init.freq || 'monthly', day: init.day == null ? 1 : init.day,
    startDate: init.startDate || rcToISO(new Date()), endDate: init.endDate || '',
    bankAc: init.bankAc || '', remark: init.remark || '', active: init.active !== false,
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const banks = rcBankOptions(data);
  const valid = String(f.name).trim() && Number(f.amount) > 0 && f.startDate;

  return (
    <Modal open title={init.id ? 'แก้ไขค่าใช้จ่ายประจำ' : 'เพิ่มค่าใช้จ่ายประจำ'} onClose={onClose}
      footer={(
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave(f)}>{init.id ? 'อัปเดต' : 'บันทึก'}</button>
        </div>
      )}>
      <div className="rc-form">
        <label className="rc-fld"><span>ชื่อรายการ *</span>
          <input value={f.name} onChange={set('name')} placeholder="เช่น เงินเดือนพนักงาน" />
        </label>
        <div className="rc-2">
          <label className="rc-fld"><span>หมวด *</span>
            <select value={f.cat} onChange={set('cat')}>
              {RC_CATS.map((c) => <option key={c} value={c}>{c} · {rcCatLabel(c)}</option>)}
            </select>
          </label>
          <label className="rc-fld"><span>ยอดประมาณ (บาท) *</span>
            <input type="number" step="0.01" min="0" value={f.amount} onChange={set('amount')} />
          </label>
        </div>
        <div className="rc-2">
          <label className="rc-fld"><span>ความถี่ *</span>
            <select value={f.freq} onChange={set('freq')}>
              {RC_FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="rc-fld"><span>วันที่จ่าย</span>
            <select value={f.day} onChange={set('day')}>
              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              <option value={-1}>สิ้นเดือน</option>
            </select>
          </label>
        </div>
        <div className="rc-2">
          <label className="rc-fld"><span>เริ่ม *</span>
            <input type="date" value={f.startDate} onChange={set('startDate')} />
          </label>
          <label className="rc-fld"><span>สิ้นสุด (ว่าง = ต่อเนื่อง)</span>
            <input type="date" value={f.endDate} onChange={set('endDate')} />
          </label>
        </div>
        <label className="rc-fld"><span>ตัดจากบัญชี</span>
          <select value={f.bankAc} onChange={set('bankAc')}>
            <option value="">— ไม่ระบุ —</option>
            {banks.map((b) => <option key={b.ac} value={b.ac}>{b.name} · {hpLast4(b.ac)}</option>)}
          </select>
        </label>
        <label className="rc-fld"><span>หมายเหตุ</span>
          <input value={f.remark} onChange={set('remark')} />
        </label>
      </div>
    </Modal>
  );
}

const RC_CSS = `
.rc-page{max-width:1180px}
.rc-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
@media(max-width:760px){.rc-stats{grid-template-columns:repeat(2,1fr)}}
.rc-stat{background:var(--panel,#fff);border:1px solid var(--line);border-radius:var(--radius,12px);padding:13px 16px;box-shadow:var(--shadow-sm)}
.rc-stat .n{font-size:22px;font-weight:800;color:var(--ink-900);letter-spacing:-.3px}
.rc-stat .l{font-size:11.5px;color:var(--ink-500);font-weight:600;margin-top:2px}
.rc-stat.out .n{color:var(--bad)} .rc-stat.in .n{color:var(--brand-700)} .rc-stat.ok .n{color:var(--good)}
.rc-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.rc-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rc-mlbl{font-size:11.5px;color:var(--ink-500);font-weight:600}
.rc-sel,.rc-form select,.rc-form input{font-family:inherit}
.rc-sel{border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12.5px;background:#fff;color:var(--ink-800)}
.rc-empty{padding:34px;text-align:center;color:var(--ink-400);font-size:13px}
.rc-tbl-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}
.rc-tbl{width:100%;border-collapse:collapse;font-size:12.5px;white-space:nowrap}
.rc-tbl th{background:var(--brand-50);color:var(--brand-800);text-align:left;padding:9px 12px;font-size:11px;font-weight:700;letter-spacing:.3px;position:sticky;top:0}
.rc-tbl td{border-top:1px solid var(--line-soft);padding:9px 12px;color:var(--ink-800)}
.rc-tbl tr:hover td{background:var(--brand-50)}
.rc-tbl .r{text-align:right} .rc-tbl .b{font-weight:700;font-variant-numeric:tabular-nums}
.rc-off td{opacity:.5}
.rc-muted{color:var(--ink-400);font-size:11.5px}
.rc-catt{color:var(--ink-500);font-size:11.5px}
.rc-cat{display:inline-flex;width:18px;height:18px;border-radius:5px;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:#fff}
.rc-cat.c1{background:#2563eb}.rc-cat.c2{background:#7c3aed}.rc-cat.c3{background:#d97706}.rc-cat.c4{background:#0d9488}
.rc-badge{font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:999px}
.rc-badge.on{background:var(--good-bg);color:var(--good)} .rc-badge.offb{background:var(--ink-100);color:var(--ink-500)}
.rc-badge.wait{background:var(--warn-bg);color:var(--warn)}
.rc-rowact{white-space:nowrap;display:flex;gap:4px;justify-content:flex-end}
.rc-rowact .btn{padding:4px 9px}
.rc-del{color:var(--bad)}
.rc-form{display:grid;gap:11px}
.rc-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.rc-fld{display:flex;flex-direction:column;gap:5px}
.rc-fld>span{font-size:12px;font-weight:700;color:var(--ink-600)}
.rc-fld input,.rc-fld select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;background:#fff;color:var(--ink-800)}
.rc-fld input:focus,.rc-fld select:focus{outline:none;border-color:var(--brand-500);box-shadow:0 0 0 3px var(--brand-100)}
`;
