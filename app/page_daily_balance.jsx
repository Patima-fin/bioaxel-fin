/* page_daily_balance.jsx — บันทึกยอดธนาคารรายวัน
 *
 * บัญชี 'main' = หมุนเวียนรายวัน → ต้องบันทึกยอดทุกวัน (เตือนได้)
 * บัญชี 'dormant' = เงินนิ่ง (ฝากประจำ/ค้ำประกัน) → กรอกเมื่อเคลื่อนไหวเท่านั้น
 *
 * บันทึกลง sheet cashflowSnapshots — 1 row ต่อ (date × bankAc)
 * เปลี่ยน BALANCE ใน bankAccounts อัตโนมัติด้วย (ให้ตรงกัน)
 */
'use strict';

const { useState: dbState, useMemo: dbMemo, useEffect: dbEffect } = React;

// Helpers
function todayISO() { return new Date().toISOString().slice(0, 10); }
function isWeekend(iso) {
  const d = new Date(iso); const day = d.getDay();
  return day === 0 || day === 6;
}
function fmtDateInput(iso) {
  if (!iso) return '';
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

// Number input that displays with thousand-separator commas like an
// accounting system, but stores the raw number string. Allows typing
// digits + at most one decimal point; commas are inserted live.
function MoneyInput({ value, onChange, placeholder, disabled, autoFocus, style }) {
  // value = raw string ("3175489.10" or "")
  // display = formatted ("3,175,489.10")
  const format = (raw) => {
    if (raw === '' || raw == null) return '';
    const s = String(raw).replace(/,/g, '');
    if (s === '' || s === '-' || s === '.') return s;
    const negative = s.startsWith('-');
    const body = negative ? s.slice(1) : s;
    const [intPart, decPart] = body.split('.');
    const withCommas = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (negative ? '-' : '') + (decPart != null ? `${withCommas}.${decPart}` : withCommas);
  };
  const unformat = (display) => {
    // Keep only digits, single dot, optional leading minus
    let s = String(display).replace(/[^\d.-]/g, '');
    // Allow only one minus at start
    const negative = s.startsWith('-');
    s = s.replace(/-/g, '');
    // Allow only one dot
    const firstDot = s.indexOf('.');
    if (firstDot >= 0) {
      s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
    }
    return (negative ? '-' : '') + s;
  };
  return (
    <input
      className="input"
      type="text"
      inputMode="decimal"
      value={format(value)}
      onChange={(e) => onChange(unformat(e.target.value))}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: '100%', ...style }}
    />
  );
}

// Diff badge
function DiffBadge({ delta }) {
  if (delta == null || isNaN(delta)) return null;
  if (delta === 0) return <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>—</span>;
  const big = Math.abs(delta) >= 100000;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
      color: delta > 0 ? 'var(--good)' : 'var(--bad)',
      background: big ? (delta > 0 ? 'var(--good-bg)' : 'var(--bad-bg)') : 'transparent',
      padding: big ? '1px 6px' : 0, borderRadius: 4,
    }}>
      {delta > 0 ? '▲' : '▼'} {fmtNum(Math.abs(delta), 2)}
    </span>
  );
}

function DailyBalancePage({ data, setData, toast }) {
  // ── State ─────────────────────────────────────────────────────────
  const [entryDate, setEntryDate] = dbState(todayISO());
  const accounts = data.bankAccounts || [];
  const snapshots = data.cashflowSnapshots || [];

  // Split by accountType (default 'main' if unset — for backward compat)
  // เรียงแต่ละกลุ่มตามลำดับที่ทีมจัดเอง (override 'bankSortOrder', sync ทั้งทีม) —
  // ไม่งั้นจะอิงลำดับแถวจาก Supabase ที่ไม่นิ่ง (ดู wtpSortBankAccounts ใน components.jsx)
  const accountsByType = dbMemo(() => {
    const main = [], dormant = [];
    accounts.forEach(a => {
      const t = (a.accountType || 'main').toLowerCase();
      if (t === 'closed') return;
      if (t === 'dormant') dormant.push(a);
      else main.push(a);
    });
    return {
      main:    wtpSortBankAccounts(main,    a => a.Bank_AC, data.manualOverrides),
      dormant: wtpSortBankAccounts(dormant, a => a.Bank_AC, data.manualOverrides),
    };
  }, [accounts, data.manualOverrides]);

  // ย้ายลำดับบัญชีขึ้น/ลง (เฉพาะ manager/staff) — persist ลง override → sync ทั้งทีม
  const moveAccount = (acNo, dir, group) => {
    const groupAcs = (group === 'dormant' ? accountsByType.dormant : accountsByType.main).map(a => a.Bank_AC);
    const allAcs   = accounts.filter(a => (a.accountType || 'main').toLowerCase() !== 'closed').map(a => a.Bank_AC);
    wtpMoveBankAccount(acNo, dir, groupAcs, allAcs, data.manualOverrides);
  };

  // Yesterday balance lookup — for each account, most recent snapshot BEFORE entryDate
  const yesterdayByAc = dbMemo(() => {
    const map = {};
    accounts.forEach(a => {
      const ac = a.Bank_AC;
      const past = snapshots
        .filter(s => s.bankAc === ac && s.date && s.date < entryDate)
        .sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      map[ac] = past[0] || null;
    });
    return map;
  }, [snapshots, accounts, entryDate]);

  // Today's already-saved snapshots (so editing is supported)
  const todayByAc = dbMemo(() => {
    const map = {};
    snapshots.filter(s => s.date === entryDate).forEach(s => { map[s.bankAc] = s; });
    return map;
  }, [snapshots, entryDate]);

  // Input draft — text per account; pre-fill from today's snapshot if exists
  const [draft, setDraft] = dbState({});
  dbEffect(() => {
    const init = {};
    accounts.forEach(a => {
      const todays = todayByAc[a.Bank_AC];
      if (todays) init[a.Bank_AC] = String(todays.balance);
    });
    setDraft(init);
  }, [entryDate, accounts.length, snapshots.length]);

  const setDraftVal = (ac, v) => setDraft(d => ({ ...d, [ac]: v }));
  const useYesterday = (ac) => {
    const y = yesterdayByAc[ac];
    if (y) setDraftVal(ac, String(y.balance));
  };
  const useAllYesterday = () => {
    const next = { ...draft };
    accountsByType.main.forEach(a => {
      const y = yesterdayByAc[a.Bank_AC];
      if (y) next[a.Bank_AC] = String(y.balance);
    });
    setDraft(next);
  };

  // ── HOLD draft state — separate from balance draft ─────────────────
  //   HOLD เก็บราย "วัน" ใน snapshot (field hold) — pre-fill ตามลำดับ:
  //   วันนี้ที่บันทึกแล้ว → HOLD ล่าสุด (snapshot วันก่อน) → ค่าคงที่เดิม HOLD_AMOUNT
  const [holdDraft, setHoldDraft] = dbState({});
  dbEffect(() => {
    const init = {};
    accounts.forEach(a => {
      const ac = a.Bank_AC;
      const todays = todayByAc[ac];
      const yest   = yesterdayByAc[ac];
      let h = null;
      if (todays && todays.hold != null && todays.hold !== '') h = todays.hold;       // วันนี้บันทึกแล้ว → ใช้ของวันนี้
      else if (yest && yest.hold != null && yest.hold !== '')  h = yest.hold;         // ยก HOLD ล่าสุดมา
      else if (a.HOLD_AMOUNT != null && a.HOLD_AMOUNT !== '' && a.HOLD_AMOUNT !== 0) h = a.HOLD_AMOUNT;  // fallback ค่าคงที่เดิม
      if (h != null) init[ac] = String(h);
    });
    setHoldDraft(init);
  }, [entryDate, accounts.length, snapshots.length]);
  const setHoldVal = (ac, v) => setHoldDraft(d => ({ ...d, [ac]: v }));

  // ── Compute totals + diff per row ─────────────────────────────────
  const rowsWithDiff = (list) => list.map(a => {
    const ac = a.Bank_AC;
    const yestBal = yesterdayByAc[ac] ? Number(yesterdayByAc[ac].balance) : null;
    const newBal  = draft[ac] !== undefined && draft[ac] !== '' ? Number(draft[ac]) : null;
    const delta   = (yestBal != null && newBal != null) ? (newBal - yestBal) : null;
    const hold    = holdDraft[ac] !== undefined && holdDraft[ac] !== '' ? Number(holdDraft[ac]) : (Number(a.HOLD_AMOUNT) || 0);
    // HOLD ล่าสุด (จาก snapshot วันก่อน) — โชว์เทียบกับ HOLD วันนี้
    const ys      = yesterdayByAc[ac];
    const yestHold = (ys && ys.hold != null && ys.hold !== '') ? Number(ys.hold) : null;
    // latestHold = ค่าที่โชว์คอลัมน์ "HOLD ล่าสุด" เสมอ: snapshot วันก่อนถ้ามี, ไม่งั้น fallback HOLD_AMOUNT
    const latestHold = yestHold != null ? yestHold : (Number(a.HOLD_AMOUNT) || 0);
    const available = (newBal != null ? newBal : (yestBal || 0)) - (hold || 0);
    return { a, ac, yestBal, newBal, delta, hold, yestHold, latestHold, available, saved: !!todayByAc[ac] };
  });

  const mainRows    = rowsWithDiff(accountsByType.main);
  const dormantRows = rowsWithDiff(accountsByType.dormant);

  const mainSavedCount = mainRows.filter(r => r.saved).length;
  const mainTotalCount = mainRows.length;
  const todayTotal     = mainRows.reduce((s, r) => s + (r.newBal != null ? r.newBal : 0), 0);
  const yestTotal      = mainRows.reduce((s, r) => s + (r.yestBal != null ? r.yestBal : 0), 0);
  const todayDelta     = todayTotal - yestTotal;
  const totalHold      = mainRows.reduce((s, r) => s + (r.hold || 0), 0);
  const totalLatestHold= mainRows.reduce((s, r) => s + (r.latestHold || 0), 0);
  const totalAvailable = todayTotal - totalHold;

  // แถบวันสำหรับกดสลับวันที่เร็วๆ — 8 วัน: ย้อนหลัง 6 วัน + วันนี้ + พรุ่งนี้
  // ยึดกับ "วันนี้จริง" (ไม่เลื่อนตามวันที่เลือก) เพื่อให้แถบนิ่ง กดไปมาได้
  const dayStrip = dbMemo(() => {
    const days = [];
    const today = todayISO();
    for (let i = 6; i >= -1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const total = accountsByType.main.reduce((sum, a) => {
        const snap = snapshots.find(s => s.bankAc === a.Bank_AC && s.date === iso);
        return sum + (snap ? Number(snap.balance) || 0 : 0);
      }, 0);
      days.push({ date: iso, total, isFuture: iso > today, isRealToday: iso === today });
    }
    return days;
  }, [snapshots, accountsByType.main]);

  // ── Save handlers ─────────────────────────────────────────────────
  const saveOne = (ac) => {
    if (draft[ac] === undefined || draft[ac] === '') {
      toast('กรอกยอดก่อน');
      return;
    }
    const balance = Number(draft[ac]);
    if (isNaN(balance)) { toast('กรอกตัวเลขให้ถูกต้อง'); return; }
    const a = accounts.find(x => x.Bank_AC === ac);
    const existing = todayByAc[ac];
    const session = JSON.parse(localStorage.getItem('bio-session') || 'null');
    const holdVal = holdDraft[ac] !== undefined && holdDraft[ac] !== '' ? Number(holdDraft[ac]) : 0;
    const row = {
      id: existing ? existing.id : WTPData.newId(),
      date: entryDate,
      bankAc: ac,
      bankName: a?.BANK_NAME || '',
      balance,
      hold: holdVal,                              // เก็บ HOLD ราย "วัน" ลง snapshot
      takenAt: new Date().toISOString(),
      enteredBy: (session && session.username) || 'unknown',
      source: 'manual_daily',
      note: existing ? 'override ' + new Date().toLocaleTimeString('th-TH') : '',
    };
    setData(d => {
      const others = (d.cashflowSnapshots || []).filter(s => !(s.date === entryDate && s.bankAc === ac));
      // Also update bankAccounts.BALANCE + HOLD_AMOUNT so live balance stays in sync
      const updatedAccounts = (d.bankAccounts || []).map(acc =>
        acc.Bank_AC === ac ? { ...acc, BALANCE: balance, HOLD_AMOUNT: holdVal, DATE: entryDate } : acc
      );
      return { ...d, cashflowSnapshots: [...others, row], bankAccounts: updatedAccounts };
    });
    toast(`บันทึก ${a?.BANK_NAME || ac} แล้ว`);
  };

  // ยกเลิก/ลบยอดที่บันทึกไปแล้วของวันนี้ (เผื่อยังไม่จบวัน ยังไม่อยากยกเป็นยอดยกไป)
  const deleteOne = (ac) => {
    const existing = todayByAc[ac];
    if (!existing) return;
    const a = accounts.find(x => x.Bank_AC === ac);
    if (!confirm(`ยกเลิกการบันทึกยอด ${a?.BANK_NAME || ac} ของวันที่ ${entryDate}?\n(ยอดใน DATA BANK จะกลับไปใช้ค่าล่าสุดก่อนหน้า)`)) return;
    const y = yesterdayByAc[ac];
    setData(d => {
      const others = (d.cashflowSnapshots || []).filter(s => !(s.date === entryDate && s.bankAc === ac));
      const updatedAccounts = (d.bankAccounts || []).map(acc => {
        if (acc.Bank_AC !== ac) return acc;
        // กลับไปใช้ยอดล่าสุดก่อนหน้า ถ้ามี — ไม่งั้นคงไว้
        return y ? { ...acc, BALANCE: Number(y.balance), DATE: y.date } : acc;
      });
      return { ...d, cashflowSnapshots: others, bankAccounts: updatedAccounts };
    });
    setDraft(dft => { const n = { ...dft }; delete n[ac]; return n; });
    toast(`ยกเลิกการบันทึก ${a?.BANK_NAME || ac} แล้ว`);
  };

  const saveAll = () => {
    const toSave = mainRows.filter(r => draft[r.ac] !== undefined && draft[r.ac] !== '');
    if (toSave.length === 0) { toast('ยังไม่มีรายการที่จะบันทึก'); return; }
    if (!confirm(`บันทึก ${toSave.length} บัญชี ที่ค่าวันที่ ${entryDate}?`)) return;
    const session = JSON.parse(localStorage.getItem('bio-session') || 'null');
    const stamp = new Date().toISOString();
    const newRows = toSave.map(r => ({
      id: r.saved ? todayByAc[r.ac].id : WTPData.newId(),
      date: entryDate,
      bankAc: r.ac,
      bankName: r.a.BANK_NAME || '',
      balance: Number(draft[r.ac]),
      hold: (holdDraft[r.ac] !== undefined && holdDraft[r.ac] !== '') ? Number(holdDraft[r.ac]) : (Number(r.a.HOLD_AMOUNT) || 0),  // เก็บ HOLD ราย "วัน"
      takenAt: stamp,
      enteredBy: (session && session.username) || 'unknown',
      source: 'manual_daily',
      note: '',
    }));
    const savedAcs = new Set(newRows.map(r => r.bankAc));
    setData(d => {
      const others = (d.cashflowSnapshots || []).filter(s => !(s.date === entryDate && savedAcs.has(s.bankAc)));
      const updatedAccounts = (d.bankAccounts || []).map(acc => {
        const newRow = newRows.find(r => r.bankAc === acc.Bank_AC);
        if (!newRow) return acc;
        // Save HOLD_AMOUNT too if user changed it
        const holdVal = holdDraft[acc.Bank_AC] !== undefined && holdDraft[acc.Bank_AC] !== '' ? Number(holdDraft[acc.Bank_AC]) : (Number(acc.HOLD_AMOUNT) || 0);
        return { ...acc, BALANCE: newRow.balance, HOLD_AMOUNT: holdVal, DATE: entryDate };
      });
      return { ...d, cashflowSnapshots: [...others, ...newRows], bankAccounts: updatedAccounts };
    });
    toast(`บันทึกแล้ว ${newRows.length} บัญชี`);
  };

  // Permission gate — manager/staff can save; viewer/owner can't
  const canEdit = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;

  const weekend = isWeekend(entryDate);

  // ปุ่ม ▲▼ จัดลำดับบัญชี (เฉพาะคนแก้ได้) — โชว์ในเซลล์ # คู่กับเลขลำดับ
  const reorderArrows = (i, count, ac, group) => {
    if (!canEdit || count < 2) return null;
    const btn = (dir, disabled, label) => (
      <button type="button" disabled={disabled} onClick={() => moveAccount(ac, dir, group)}
        title={dir < 0 ? 'เลื่อนขึ้น' : 'เลื่อนลง'}
        style={{ border: 'none', background: 'transparent', padding: 0, height: 11, width: 13, lineHeight: 1,
          fontSize: 9, cursor: disabled ? 'default' : 'pointer', color: disabled ? 'var(--ink-200)' : 'var(--ink-400)' }}>
        {label}
      </button>
    );
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', marginRight: 3, verticalAlign: 'middle' }}>
        {btn(-1, i === 0, '▲')}
        {btn(+1, i === count - 1, '▼')}
      </span>
    );
  };

  return (
    <div className="page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">บันทึกยอดธนาคาร · {fmtDate(entryDate)}</h1>
          <div className="page-sub">
            {weekend && <span style={{ color: 'var(--warn)', marginRight: 10 }}>⚠️ วันหยุด — ธนาคารปิด</span>}
            {mainSavedCount === mainTotalCount && mainTotalCount > 0
              ? <span style={{ color: 'var(--good)', fontWeight: 600 }}>✓ บันทึกครบ {mainTotalCount}/{mainTotalCount} บัญชีหลักแล้ว</span>
              : <span style={{ color: 'var(--bad)' }}>⏳ บันทึกแล้ว {mainSavedCount}/{mainTotalCount} บัญชีหลัก — ค้าง {mainTotalCount - mainSavedCount}</span>}
          </div>
        </div>
        <div className="page-head-r">
          <YmdPicker value={entryDate} onChange={v => setEntryDate(v || todayISO())} size="sm" />
          {/* (เลือกวันที่บันทึก ย้อนหลังได้ — ปี→เดือน→วัน) */}
          {canEdit && (
            <button className="btn btn-ghost" onClick={useAllYesterday} title="ใส่ค่ายอดเมื่อวานให้ทุกบัญชี">
              <Icon name="refresh" size={14} /> ใช้ค่าเมื่อวาน
            </button>
          )}
          <PrintButton />
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-4 anim-stagger" style={{ marginBottom: 16 }}>
        <KpiTile animate={false} label="รวมยอดวันนี้"      value={todayTotal}     accent="var(--brand-500)" icon="bank" />
        <KpiTile animate={false} label="ยอด HOLD รวม"      value={totalHold}      accent="oklch(60% 0.18 55)" icon="arrow_up" />
        <KpiTile animate={false} label="ยอดใช้ได้จริง"     value={totalAvailable} accent="var(--good)" icon="coin" />
        <KpiTile animate={false} label="บัญชีที่บันทึก"   value={mainSavedCount} unit={` / ${mainTotalCount}`} digits={0}
          accent={mainSavedCount === mainTotalCount ? 'var(--good)' : 'var(--bad)'} icon="check" />
      </div>

      {/* แถบ 8 วัน — กดเพื่อสลับวันที่เร็วๆ (ย้อนหลัง 6 + วันนี้ + พรุ่งนี้) */}
      {dayStrip.length > 0 && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: 'var(--ink-500)', fontWeight: 600 }}>กดเลือกวัน:</div>
          {dayStrip.map((d, i) => {
            const isSelected = d.date === entryDate;
            const has = d.total > 0;
            const tag = d.isRealToday ? 'วันนี้' : (d.isFuture ? 'พรุ่งนี้' : null);
            return (
              <button key={i} type="button" onClick={() => setEntryDate(d.date)}
                title={`ดู/บันทึกยอดวันที่ ${d.date}`}
                style={{
                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  background: isSelected ? 'var(--brand-50)' : (d.isFuture ? 'transparent' : 'var(--ink-50)'),
                  border: `1px solid ${isSelected ? 'var(--brand-400)' : 'var(--line)'}`,
                  borderStyle: d.isFuture && !isSelected ? 'dashed' : 'solid',
                  minWidth: 92, textAlign: 'center', font: 'inherit',
                  boxShadow: isSelected ? '0 0 0 1px var(--brand-400) inset' : 'none',
                }}>
                <div style={{ fontSize: 10, color: isSelected ? 'var(--brand-700)' : 'var(--ink-500)', fontWeight: tag ? 700 : 400 }}>
                  {tag || new Date(d.date).toLocaleDateString('th-TH', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: has ? 'var(--ink-800)' : 'var(--ink-300)', fontVariantNumeric: 'tabular-nums' }}>
                  {has ? fmtNum(d.total, 0) : '—'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* MAIN accounts (daily-entry required) */}
      <div className="card anim-in" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '10px 16px', background: '#f0f9ff', borderBottom: '1px solid #bfdbfe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>🏦 บัญชีหลัก (หมุนเวียนรายวัน)</div>
          {canEdit && mainTotalCount > 0 && (
            <button className="btn btn-primary btn-sm" onClick={saveAll}>
              <Icon name="check" size={13} /> บันทึกทั้งหมด ({Object.keys(draft).filter(k => draft[k] !== '' && accountsByType.main.find(a => a.Bank_AC === k)).length})
            </button>
          )}
        </div>
        <table className="tbl" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 58, textAlign: 'center' }}>#</th>
              <th style={{ width: 150 }}>ธนาคาร</th>
              <th style={{ width: 130 }}>เลขที่บัญชี</th>
              <th style={{ width: 130, textAlign: 'right' }}>ยอดเมื่อวาน</th>
              <th style={{ width: 160, textAlign: 'right' }}>ยอดวันนี้</th>
              <th style={{ width: 100, textAlign: 'right' }}>Δ</th>
              <th style={{ width: 120, textAlign: 'right', background: 'oklch(96% 0.025 55)' }}>
                HOLD ล่าสุด<br/><span style={{ fontSize: 9, fontWeight: 400, color: 'var(--ink-500)' }}>กันไว้ก่อนหน้า</span>
              </th>
              <th style={{ width: 140, textAlign: 'right', background: 'oklch(95% 0.04 55)' }}>
                HOLD วันนี้<br/><span style={{ fontSize: 9, fontWeight: 400, color: 'var(--ink-500)' }}>กันไว้ commit · กรอกวันนี้</span>
              </th>
              <th style={{ width: 130, textAlign: 'right', background: 'var(--good-bg)' }}>
                ใช้ได้จริง<br/><span style={{ fontSize: 9, fontWeight: 400, color: 'var(--ink-500)' }}>ยอด−HOLD</span>
              </th>
              <th style={{ width: 50 }}></th>
              <th style={{ width: 95, textAlign: 'center' }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {mainRows.length === 0 && (
              <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center' }} className="muted">ยังไม่มีบัญชีหลัก — เพิ่มได้ที่หน้า DATA BANK</td></tr>
            )}
            {mainRows.map((r, i) => {
              const big = r.delta != null && Math.abs(r.delta) >= 100000;
              return (
                <tr key={r.ac} style={{ background: r.saved ? 'color-mix(in oklch, var(--good) 5%, transparent)' : undefined }}>
                  <td style={{ textAlign: 'center', color: 'var(--ink-400)', whiteSpace: 'nowrap' }}>
                    {reorderArrows(i, mainRows.length, r.ac, 'main')}
                    <span style={{ verticalAlign: 'middle' }}>{i + 1}</span>
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--brand-700)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <HpBankLogo name={r.a.BANK_NAME} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.a.BANK_NAME || '—'}</span>
                    </div>
                  </td>
                  <td style={{ fontFamily: 'ui-monospace', fontSize: 12 }}>{r.ac}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-500)', fontSize: 12 }}>
                    {r.yestBal != null ? fmtNum(r.yestBal, 2) : <span className="muted">—</span>}
                    {r.yestBal != null && yesterdayByAc[r.ac] && (
                      <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>{fmtDate(yesterdayByAc[r.ac].date)}</div>
                    )}
                  </td>
                  <td>
                    <MoneyInput
                      value={draft[r.ac] !== undefined ? draft[r.ac] : ''}
                      onChange={v => setDraftVal(r.ac, v)}
                      placeholder={r.yestBal != null ? fmtNum(r.yestBal, 2) : '0.00'}
                      disabled={!canEdit}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {big && <span title="เปลี่ยนแปลงเกิน 100,000 — ตรวจสอบอีกครั้ง" style={{ marginRight: 4 }}>⚠️</span>}
                    <DiffBadge delta={r.delta} />
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-500)', fontSize: 12,
                    background: 'color-mix(in oklch, oklch(70% 0.16 55) 3%, transparent)' }}>
                    {fmtNum(r.latestHold, 2)}
                    {r.yestHold != null && yesterdayByAc[r.ac]
                      ? <div style={{ fontSize: 10, color: 'var(--ink-400)' }}>{fmtDate(yesterdayByAc[r.ac].date)}</div>
                      : <div style={{ fontSize: 10, color: 'var(--ink-300)' }}>ค่าตั้งต้น</div>}
                  </td>
                  <td style={{ background: 'color-mix(in oklch, oklch(70% 0.16 55) 6%, transparent)' }}>
                    <MoneyInput
                      value={holdDraft[r.ac] !== undefined ? holdDraft[r.ac] : ''}
                      onChange={v => setHoldVal(r.ac, v)}
                      placeholder="0.00"
                      disabled={!canEdit}
                    />
                    {r.hold !== r.latestHold && (
                      <div style={{ fontSize: 10, textAlign: 'right', marginTop: 2, fontWeight: 600,
                        color: r.hold > r.latestHold ? 'var(--bad)' : 'var(--good)' }}>
                        {r.hold > r.latestHold ? '▲' : '▼'} {fmtNum(Math.abs(r.hold - r.latestHold), 0)}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                    color: r.available < 0 ? 'var(--bad)' : 'var(--good)',
                    background: 'color-mix(in oklch, var(--good) 5%, transparent)' }}>
                    {r.newBal != null || r.hold > 0 ? fmtNum(r.available, 2) : <span className="muted">—</span>}
                  </td>
                  <td>
                    {canEdit && r.yestBal != null && (
                      <button className="btn btn-ghost btn-sm" onClick={() => useYesterday(r.ac)}
                        title="ใช้ค่าเมื่อวาน" style={{ padding: '2px 6px', fontSize: 11 }}>
                        ↩️
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {r.saved
                      ? <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Badge kind="b-green" dot={false}>✓ บันทึกแล้ว</Badge>
                          {canEdit && (
                            <button className="btn btn-ghost btn-sm" onClick={() => deleteOne(r.ac)}
                              title="ยกเลิก/ลบยอดที่บันทึกวันนี้" style={{ padding: '2px 6px', fontSize: 11, color: 'var(--bad)' }}>
                              ✕
                            </button>
                          )}
                        </div>
                      : (draft[r.ac] !== undefined && draft[r.ac] !== ''
                          ? <button className="btn btn-primary btn-sm" onClick={() => saveOne(r.ac)} disabled={!canEdit}
                              style={{ padding: '3px 10px', fontSize: 11 }}>บันทึก</button>
                          : <span className="muted" style={{ fontSize: 11 }}>—</span>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {mainRows.length > 0 && (
            <tfoot>
              <tr style={{ background: 'var(--brand-50)', fontWeight: 700 }}>
                <td colSpan={3} style={{ textAlign: 'right', paddingRight: 14 }}>รวม</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(yestTotal, 2)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(todayTotal, 2)}</td>
                <td style={{ textAlign: 'right' }}><DiffBadge delta={todayDelta} /></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-500)' }}>{fmtNum(totalLatestHold, 2)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'oklch(60% 0.16 55)' }}>{fmtNum(totalHold, 2)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: totalAvailable < 0 ? 'var(--bad)' : 'var(--good)' }}>{fmtNum(totalAvailable, 2)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* DORMANT accounts */}
      {dormantRows.length > 0 && (
        <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: '#f5f3ff', borderBottom: '1px solid #ddd6fe', display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>💰 บัญชีสำรอง (เงินนิ่ง — ฝากประจำ / ค้ำประกัน)</div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>กรอกเมื่อมีเคลื่อนไหวเท่านั้น</div>
          </div>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 58, textAlign: 'center' }}>#</th>
                <th style={{ width: 150 }}>ธนาคาร</th>
                <th style={{ width: 160 }}>เลขที่บัญชี</th>
                <th style={{ width: 140, textAlign: 'right' }}>ยอดล่าสุด</th>
                <th style={{ width: 180, textAlign: 'right' }}>ยอดใหม่ (ถ้าเปลี่ยน)</th>
                <th style={{ width: 110, textAlign: 'right' }}>Δ</th>
                <th style={{ width: 100, textAlign: 'center' }}>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {dormantRows.map((r, i) => (
                <tr key={r.ac} style={{ background: r.saved ? 'color-mix(in oklch, var(--good) 5%, transparent)' : undefined }}>
                  <td style={{ textAlign: 'center', color: 'var(--ink-400)', whiteSpace: 'nowrap' }}>
                    {reorderArrows(i, dormantRows.length, r.ac, 'dormant')}
                    <span style={{ verticalAlign: 'middle' }}>{i + 1}</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <HpBankLogo name={r.a.BANK_NAME} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.a.BANK_NAME || '—'}</span>
                    </div>
                  </td>
                  <td style={{ fontFamily: 'ui-monospace', fontSize: 12 }}>{r.ac}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-600)' }}>
                    {r.yestBal != null ? fmtNum(r.yestBal, 2) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <MoneyInput
                      value={draft[r.ac] !== undefined ? draft[r.ac] : ''}
                      onChange={v => setDraftVal(r.ac, v)}
                      placeholder="ปล่อยว่างถ้าไม่เปลี่ยน"
                      disabled={!canEdit}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}><DiffBadge delta={r.delta} /></td>
                  <td style={{ textAlign: 'center' }}>
                    {r.saved
                      ? <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Badge kind="b-green" dot={false}>✓</Badge>
                          {canEdit && (
                            <button className="btn btn-ghost btn-sm" onClick={() => deleteOne(r.ac)}
                              title="ยกเลิก/ลบยอดที่บันทึกวันนี้" style={{ padding: '2px 6px', fontSize: 11, color: 'var(--bad)' }}>
                              ✕
                            </button>
                          )}
                        </div>
                      : (draft[r.ac] !== undefined && draft[r.ac] !== ''
                          ? <button className="btn btn-primary btn-sm" onClick={() => saveOne(r.ac)} disabled={!canEdit}
                              style={{ padding: '3px 10px', fontSize: 11 }}>บันทึก</button>
                          : <span className="muted" style={{ fontSize: 11 }}>—</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Help */}
      <div className="card" style={{ marginTop: 14, padding: 14, background: '#fffbeb', borderLeft: '4px solid #f6ad55', fontSize: 12, color: 'var(--ink-700)' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>💡 หมายเหตุ</div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>กรอกยอด balance ตามที่เห็นใน statement ธนาคารจริง — เพื่อให้ระบบตรงกับ statement ตลอดเวลา</li>
          <li>ปุ่ม "↩️" / "ใช้ค่าเมื่อวาน" = copy ยอดเมื่อวานมา (ถ้าบัญชีไม่เคลื่อนไหว)</li>
          <li>⚠️ จะขึ้นถ้าเปลี่ยนแปลงเกิน 100,000 บาท — ตรวจสอบอีกครั้งก่อนบันทึก</li>
          <li>บัญชีสำรอง (dormant) ไม่ต้องกรอกทุกวัน — กรอกเฉพาะเมื่อมีค่าธรรมเนียมตัด/โอนระหว่างบัญชี</li>
          <li>เมื่อบันทึก — ยอดใน "DATA BANK" จะ update ให้ตรงด้วยอัตโนมัติ</li>
          <li>ปุ่ม ▲▼ ในช่อง # = จัดลำดับบัญชี (sync ทั้งทีม, เฉพาะ manager/staff)</li>
          <li>ตั้งค่าใครจะได้รับเตือน — ไปที่ "จัดการผู้ใช้" → tick "🔔 เตือนบันทึกยอดรายวัน"</li>
        </ul>
      </div>
    </div>
  );
}

Object.assign(window, { DailyBalancePage });
