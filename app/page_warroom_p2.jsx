// War Room — Page 2: Estimated annual cash flow from existing projects.
// Matches "Present War room - 18052026 การเงินด้านรับ" PDF page 2.
// Globals: React, KpiTile, AnimatedNumber, Badge, Icon, StackedBars, fmtNum, fmtMoney, fmtDate, KpiCallout, SectionCard, BigCallout

const WR2_BUILD = '20260602a';
console.info('[WTP] War Room p2 build:', WR2_BUILD, '· WIP uses % งวด with %-stripping + fallback');

const { useMemo: wr2Memo, useState: wr2State } = React;

// ── Persistent WS/XL synthetic projects ─────────────────────────────────────
// Cloud sync ไม่รับประกันว่าจะเก็บ WS-/XL- rows ได้ครบ (Apps Script schema
// อาจ strip, race condition, etc.) → เก็บแยกใน localStorage แล้ว merge ทับ
// data.projects ทุกครั้งที่ render → ไม่ "หาย" หลัง sync เด็ดขาด
const WR2_LOCAL_PROJECTS_KEY = 'bio-wr2-supplemental-projects-v1';
function wr2LoadLocalProjects() {
  try {
    const a = JSON.parse(localStorage.getItem(WR2_LOCAL_PROJECTS_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch (_) { return []; }
}
function wr2SaveLocalProjects(arr) {
  try { localStorage.setItem(WR2_LOCAL_PROJECTS_KEY, JSON.stringify(arr || [])); } catch (_) {}
}

function WarRoomPage2({ data, setData, toast }) {
  const { monthlyForecast, warroomP2, meta } = data;
  const [editMode, setEditMode] = wr2State(false);
  const [ivTypeFilter, setIvTypeFilter] = wr2State('P'); // 'all' | 'P' | 'O' — default 'P' (โครงการ) เหมือนหน้า 1
  const [drill, setDrill] = wr2State(null);
  const [wsUploadOpen, setWsUploadOpen] = wr2State(false);
  useOverrideSubAny();

  // หมายเหตุ: WTPOverride sync ผ่าน cloud (data.manualOverrides) → ทุก browser
  // ของทีมเห็นค่าที่ user แก้มือ · keys ที่แก้ได้:
  //   wr2.heroTotal, wr2.heroInvForward, wr2.heroWip, wr2.heroUnsigned
  //   wr2.s11Value, wr2.s11Count, wr2.s12Value, wr2.s12Inv, wr2.s12Wip
  // ใช้: กดปุ่ม "โหมดแก้ไข" → คลิกที่ตัวเลข → กรอกค่าใหม่ → Enter

  // ── Helpers (prefixed wr2 เพื่อกัน collision กับ page อื่น) ─────────────
  const getStart = (p) => p['Start'] || p['start'] || p['startDate'] || p['_start'] || '';
  const isEmpty = (v) => {
    if (v == null) return true;
    const s = String(v).trim();
    return s === '' || s === '—' || s === '-' || s === '0' || s.toLowerCase() === 'null';
  };
  const wr2ToN = (v) => { const n = Number(String(v == null ? '' : v).replace(/[,%\s฿]/g, '')); return isNaN(n) ? 0 : n; };
  const wr2NormCode = (code) => {
    const s = String(code || '').trim();
    if (!s) return '';
    const m = s.match(/^(.+?)-[A-Z]{2,6}$/);
    return m ? m[1] : s;
  };
  const wr2IsCancelled = (p) => {
    if (!p) return false;
    for (const k in p) {
      if (!/ยกเลิก/.test(k)) continue;
      const v = p[k]; if (v == null || v === '') continue;
      if (wr2ToN(v) === 1) return true;
      if (/^(❌|❎|✗|✘|x|true|yes)$/i.test(String(v).trim())) return true;
    }
    return false;
  };
  // มูลค่าใบจัดสรร: เงินตามใบจัดสรร → งบประมาณ → fallback
  const wr2GetAlloc = (p) =>
    wr2ToN(p['เงินตามใบจัดสรร']) || wr2ToN(p['งบประมาณ']) || wr2ToN(p.budget) || wr2ToN(p.allocBudget) || 0;
  // มูลค่าสัญญารวม VAT (ตามชีต ถ้าไม่มี → คูณ 1.07 จากค่าก่อน VAT)
  const wr2GetContract = (p) => {
    const vat = wr2ToN(p['มูลค่าสัญญาที่เซ็น (รวมVAT)']) || wr2ToN(p['มูลค่าสัญญาที่เซ็น (รวม VAT)']);
    if (vat > 0) return vat;
    const pre = wr2ToN(p['มูลค่าสัญญาที่เซ็น']) || wr2ToN(p.signedValue);
    return pre > 0 ? Math.round(pre * 1.07 * 100) / 100 : 0;
  };
  // ประเภทใบแจ้งหนี้ (เหมือนหน้า 1): P = โครงการ, O = อื่นๆ · default P
  const wr2InvType = (iv) => ((iv.invType || iv.invtype || 'P').toString().trim().toUpperCase() === 'O' ? 'O' : 'P');
  const wr2TypeMatch = (t) => ivTypeFilter === 'all' || t === ivTypeFilter;

  // ── Subscribe to localStorage changes (WS upload triggers re-render) ──
  const [wsLocalVer, setWsLocalVer] = wr2State(0);
  React.useEffect(() => {
    const h = () => setWsLocalVer(v => v + 1);
    window.addEventListener('wr2-ws-local-change', h);
    window.addEventListener('storage', h);
    return () => {
      window.removeEventListener('wr2-ws-local-change', h);
      window.removeEventListener('storage', h);
    };
  }, []);

  // ── Live calculation — ดึงทุกยอดจาก data.projects + data.invoices + data.receipts
  //   + merge localStorage supplemental projects (WS- / XL- ที่ cloud sync อาจทำหาย)
  const liveCalc = wr2Memo(() => {
    const cloudProjects = data.projects || [];
    const invoices = data.invoices || [];
    const receipts = data.receipts || [];

    // ✦ Merge: cloud projects + localStorage WS/XL ที่ยังไม่อยู่ใน cloud
    //   ป้องกัน "หายหลัง refresh" — local layer คงทนกว่า cloud sync
    const localExtra = wr2LoadLocalProjects();
    const cloudCodes = new Set();
    cloudProjects.forEach(p => {
      const c = String(p['Contract No.'] || p.code || '').trim();
      if (c) cloudCodes.add(c);
    });
    const supplemental = localExtra.filter(p => {
      const c = String(p['Contract No.'] || p.code || '').trim();
      return c && !cloudCodes.has(c);
    });
    const projects = supplemental.length ? [...cloudProjects, ...supplemental] : cloudProjects;
    // ตัดโครงการยกเลิกออกจาก dashboard ทั้งหมด
    const active = projects.filter(p => !wr2IsCancelled(p));

    // index ใบแจ้งหนี้ตาม project code (normalize เผื่อ suffix -STIIS)
    const invByCode = {};
    invoices.forEach(iv => {
      const c = wr2NormCode(iv.jobNo || iv.contractRef || iv.projectCode || '');
      if (c) (invByCode[c] = invByCode[c] || []).push(iv);
    });
    // index receipts ตาม invoice number (เพื่อตรวจสอบเงินรับจริงผ่าน IV)
    const rcByIvNo = {};
    receipts.forEach(rc => {
      const ivNo = rc.invoiceNo || rc.ivNo;
      if (ivNo) (rcByIvNo[ivNo] = rcByIvNo[ivNo] || []).push(rc);
    });
    const projInvoicesOf = (p) => {
      const c = wr2NormCode(p['Contract No.'] || p.code || '');
      return c ? (invByCode[c] || []) : [];
    };
    const receiptsOfIv = (iv) => rcByIvNo[iv.ivNo || iv.invoiceNo] || [];
    // ประเภทของโครงการ = ดูจาก IV ของโครงการ · ไม่มี IV → ถือเป็นงานโครงการ (P)
    //   เป็น 'O' เฉพาะเมื่อมี IV และทุกใบเป็น 'O' เท่านั้น
    const projTypeOf = (p) => {
      const ivs = projInvoicesOf(p);
      if (!ivs.length) return 'P';
      return ivs.every(iv => wr2InvType(iv) === 'O') ? 'O' : 'P';
    };

    // 1) รอลงนาม — Start ว่าง + ไม่ยกเลิก → ใช้มูลค่าใบจัดสรร
    //    โครงรอลงนามมักไม่มีเลขสัญญา (code=null) → ในชีตอาจมีแถวซ้ำ → ตัดซ้ำด้วย ชื่อ+งบ
    const unsignedSeen = {};
    const unsignedList = active
      .filter(p => isEmpty(getStart(p)) && wr2TypeMatch(projTypeOf(p)))
      .map(p => ({
        id: p.id,
        code: String(p['Contract No.'] || p.code || '—').trim(),
        name: String(p['พื้นที่'] || p.name || '—').trim(),
        province: p['Province'] || '',
        value: wr2GetAlloc(p),
      }))
      .filter(p => p.value > 0)
      .filter(p => { const k = p.name + '|' + p.province; if (unsignedSeen[k]) return false; unsignedSeen[k] = true; return true; })
      .sort((a, b) => b.value - a.value);
    const unsignedValue = unsignedList.reduce((s, p) => s + p.value, 0);

    // 2) ใบแจ้งหนี้คงค้าง — IV status != paid, balance > 0
    const invForwardList = invoices
      .filter(iv => iv.status !== 'paid' && wr2ToN(iv.balance) > 0 && wr2TypeMatch(wr2InvType(iv)))
      .map(iv => ({
        id: iv.id,
        ivNo: iv.ivNo || iv.invoiceNo || '—',
        code: iv.jobNo || iv.contractRef || '',
        name: iv.projectName || iv.customer || iv.customerName || '',
        invoiceDate: iv.invoiceDate || '',
        expectedReceive: iv.expectedReceive || '',
        value: wr2ToN(iv.balance),
        status: iv.status || '',
      }))
      .sort((a, b) => b.value - a.value);
    const invForwardValue = invForwardList.reduce((s, iv) => s + iv.value, 0);

    // 3) งานระหว่างก่อสร้าง (WIP) — ดู % แต่ละงวดที่ยังไม่ส่งมอบจริง
    //    ตรรกะ: ลงนามแล้ว → ดูทีละงวด ว่าส่งแล้วหรือยัง?
    //      งวด 1 ส่งแล้ว → ไม่นับ (อยู่ใน "ใบแจ้งหนี้คงค้าง" หรือรับเงินไปแล้ว)
    //      งวด 1 ยังไม่ส่ง → บวก (% งวด 1) เข้า WIP
    //      เช็คงวด 2 แบบเดียวกัน
    //    Value = contract × Σ(% งวดที่ยังไม่ส่ง)
    //    Edge: ถ้า % งวด 1 = 0, % งวด 2 = 100, งวด 2 ยังไม่ส่ง → WIP 100% = contract เต็ม
    //    Fallback: ถ้าไม่มี % เลย และยังไม่ส่งงาน → WIP เท่ากับ contract (assume งวดเดียว)
    const wr2HasMnDelivery = (p, n) => {
      // ✦ Authority: "Summary Payment N" — engineer ใส่ยอดเมื่อส่งงานแล้ว
      //   (per user explanation 01/06/26: "ถ้าโครงไหนส่งงานเเล้ว แกจะใส่ยอด
      //    ที่ Summary Payment N · ถ้ายังไม่ส่งก็จะไม่มี")
      //   secondary: วันที่ส่งมอบงาน (ถ้ากรอก) — fall back
      if (wr2ToN(p['Summary Payment ' + n]) > 0) return true;
      const variants = [
        'วันที่ส่งมอบงาน งวด ' + n,
        'วันที่ส่ง นส.มอบงาน งวด ' + n,
        'วันที่เซ็น/รับ ใบตรวจรับ งวดที่ ' + n,
        'วันที่เซ็น/รับ ใบตรวจรับ งวด ' + n,
      ];
      return variants.some(k => !!p[k]);
    };
    const wipList = active
      .filter(p => !isEmpty(getStart(p)) && wr2TypeMatch(projTypeOf(p)))   // ลงนามแล้ว
      .map(p => {
        const contract = wr2GetContract(p);
        const ivs = projInvoicesOf(p);
        const billed = ivs.reduce((s, iv) => {
          const paid = wr2ToN(iv.netReceived || iv.grossAmount || 0);
          const bal  = wr2ToN(iv.balance || 0);
          return s + (iv.status === 'paid' ? paid : (paid + bal));
        }, 0);
        const received = ivs.reduce((s, iv) => {
          const rcs = receiptsOfIv(iv);
          return s + rcs.reduce((s2, rc) => s2 + wr2ToN(rc.grossAmount || rc.netReceived || 0), 0);
        }, 0);
        const pct1 = wr2ToN(p['% งวด 1']);
        const pct2 = wr2ToN(p['% งวด 2']);
        const delivered1 = wr2HasMnDelivery(p, 1);
        const delivered2 = wr2HasMnDelivery(p, 2);
        const hasPctData = pct1 > 0 || pct2 > 0;
        let wipPct = 0;
        if (hasPctData) {
          if (!delivered1 && pct1 > 0) wipPct += pct1;
          if (!delivered2 && pct2 > 0) wipPct += pct2;
        } else if (!delivered1 || !delivered2) {
          // ไม่มี % data + ยังมีงวดที่ยังไม่ส่ง → assume WIP เต็ม contract
          //   (data เก่าหลายโครงการไม่กรอก % แต่ก็ยังถือว่ามี work pending จริง)
          wipPct = 100;
        }
        let wip = Math.round(contract * wipPct) / 100;
        // หัก received เฉพาะ fallback path (no pct data) — กัน double-count
        // กรณี % path: % งวดที่ส่งแล้วไม่ถูกรวมใน wipPct อยู่แล้ว → ไม่ต้องหัก
        if (!hasPctData) wip = Math.max(0, wip - received);
        return {
          id: p.id,
          code: String(p['Contract No.'] || p.code || '—').trim(),
          name: String(p['พื้นที่'] || p.name || '—').trim(),
          province: p['Province'] || '',
          contract, billed, received,
          pct1, pct2, delivered1, delivered2, wipPct,
          wip,
        };
      })
      // signed + ยังมี % งวด ที่ยังไม่ส่ง > 0
      .filter(x => x.contract > 0 && x.wip > 1)
      .sort((a, b) => b.wip - a.wip);
    const wipValue = wipList.reduce((s, x) => s + x.wip, 0);

    // แยกโครงการที่ "settled แล้ว" (รับเงินครบ ไม่มี IV ค้าง) ไว้สำหรับ debug/drill
    const closedList = active
      .filter(p => !isEmpty(getStart(p)))
      .map(p => {
        const contract = wr2GetContract(p);
        const ivs = projInvoicesOf(p);
        const received = ivs.reduce((s, iv) => {
          const rcs = receiptsOfIv(iv);
          return s + rcs.reduce((s2, rc) => s2 + wr2ToN(rc.grossAmount || rc.netReceived || 0), 0);
        }, 0);
        return {
          id: p.id, code: p['Contract No.'] || p.code, name: p['พื้นที่'] || p.name,
          contract, received, ivCount: ivs.length, rcCount: ivs.reduce((s,iv) => s + receiptsOfIv(iv).length, 0),
        };
      })
      .filter(x => x.received >= x.contract * 0.99 && x.contract > 0);

    const signedTotal = invForwardValue + wipValue;
    const grandTotal = signedTotal + unsignedValue;

    if (typeof window !== 'undefined') {
      window.__wtpDebug_wr2 = {
        unsigned: { count: unsignedList.length, value: unsignedValue },
        invForward: { count: invForwardList.length, value: invForwardValue },
        wip: { count: wipList.length, value: wipValue },
        signedTotal, grandTotal,
      };
    }

    return {
      unsigned:   { value: unsignedValue,   count: unsignedList.length,   list: unsignedList },
      invForward: { value: invForwardValue, count: invForwardList.length, list: invForwardList },
      wip:        { value: wipValue,        count: wipList.length,        list: wipList },
      signedTotal, grandTotal,
    };
  }, [data.projects, data.invoices, data.receipts, wsLocalVer, ivTypeFilter]);

  // ── Drill-down builders ─────────────────────────────────────────────────
  const fmtT0 = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const openUnsignedDrill = () => setDrill({
    title: '📋 โครงการที่รอลงนามสัญญา',
    subtitle: liveCalc.unsigned.count + ' โครงการ · รวม ' + fmtT0(liveCalc.unsigned.value) + ' บาท · (Start ว่าง · ไม่ยกเลิก · ใช้มูลค่าใบจัดสรร)',
    items: liveCalc.unsigned.list,
    total: liveCalc.unsigned.value,
    columns: [
      { key: 'code', label: 'Contract No.', width: 110 },
      { key: 'name', label: 'ชื่อโครงการ / พื้นที่' },
      { key: 'province', label: 'จังหวัด', width: 100 },
      { key: 'value', label: 'มูลค่าใบจัดสรร (฿)', align: 'right', width: 150, fmt: (v) => fmtT0(v), isMoney: true },
    ],
  });
  const openInvForwardDrill = () => setDrill({
    title: '🧾 ใบแจ้งหนี้คงค้าง',
    subtitle: liveCalc.invForward.count + ' ใบ · รวม ' + fmtT0(liveCalc.invForward.value) + ' บาท · (ออก IV แล้ว · รอรับเงิน)',
    items: liveCalc.invForward.list,
    total: liveCalc.invForward.value,
    columns: [
      { key: 'ivNo', label: 'IV No.', width: 110 },
      { key: 'code', label: 'Job No.', width: 110 },
      { key: 'name', label: 'โครงการ / ลูกค้า' },
      { key: 'expectedReceive', label: 'คาดรับ', width: 100, fmt: (v) => v ? fmtDate(v) : '—' },
      { key: 'value', label: 'ยอดคงค้าง (฿)', align: 'right', width: 140, fmt: (v) => fmtT0(v), isMoney: true },
    ],
  });
  const openWipDrill = () => setDrill({
    title: '🚧 มูลค่างานระหว่างก่อสร้าง (WIP)',
    subtitle: liveCalc.wip.count + ' โครงการ · รวม ' + fmtT0(liveCalc.wip.value) + ' บาท · ดู % งวดที่ยังไม่ส่งมอบจริง (งวด 1 ส่งแล้ว → ไม่นับ)',
    items: liveCalc.wip.list,
    total: liveCalc.wip.value,
    columns: [
      { key: 'code', label: 'Contract No.', width: 110 },
      { key: 'name', label: 'ชื่อโครงการ' },
      { key: 'contract', label: 'สัญญา (฿)', align: 'right', width: 110, fmt: (v) => fmtT0(v) },
      { key: 'pct1', label: 'งวด 1', align: 'center', width: 70, fmt: (v, row) => v + '%' + (row.delivered1 ? ' ✓' : '') },
      { key: 'pct2', label: 'งวด 2', align: 'center', width: 70, fmt: (v, row) => v + '%' + (row.delivered2 ? ' ✓' : '') },
      { key: 'wipPct', label: 'WIP %', align: 'center', width: 70, fmt: (v) => v + '%' },
      { key: 'wip', label: 'WIP (฿)', align: 'right', width: 120, fmt: (v) => fmtT0(v), isMoney: true },
    ],
  });
  const openSignedDrill = () => setDrill({
    title: '✍️ โครงการที่ลงนามแล้ว',
    subtitle: 'รวม ' + fmtT0(liveCalc.signedTotal) + ' บาท · = ใบแจ้งหนี้คงค้าง + WIP',
    items: [
      { label: '🧾 ใบแจ้งหนี้คงค้าง', sub: liveCalc.invForward.count + ' ใบ · รอรับเงิน', value: liveCalc.invForward.value, _click: openInvForwardDrill },
      { label: '🚧 งานระหว่างก่อสร้าง', sub: liveCalc.wip.count + ' โครงการ · ส่วนที่เหลือยังไม่ออก IV', value: liveCalc.wip.value, _click: openWipDrill },
    ],
    total: liveCalc.signedTotal,
    columns: [
      { key: 'label', label: 'รายการ' },
      { key: 'sub', label: 'รายละเอียด' },
      { key: 'value', label: 'มูลค่า (฿)', align: 'right', width: 150, fmt: (v) => fmtT0(v), isMoney: true },
    ],
  });
  const openGrandTotalDrill = () => setDrill({
    title: '💰 มูลค่าโครงการที่คาดว่าจะได้รับทั้งหมด',
    subtitle: 'ทั้งปี ' + meta.year + ' · รวม ' + fmtT0(liveCalc.grandTotal) + ' บาท',
    items: [
      { label: '🧾 ใบแจ้งหนี้คงค้าง', sub: liveCalc.invForward.count + ' ใบ · ออก IV แล้ว · รอรับเงิน', value: liveCalc.invForward.value, _click: openInvForwardDrill },
      { label: '🚧 งานระหว่างก่อสร้าง', sub: liveCalc.wip.count + ' โครงการ · ลงนามแล้ว · ส่วน WIP', value: liveCalc.wip.value, _click: openWipDrill },
      { label: '📋 โครงการที่รอลงนาม', sub: liveCalc.unsigned.count + ' โครงการ · มีใบจัดสรร · ยังไม่ลงนาม', value: liveCalc.unsigned.value, _click: openUnsignedDrill },
    ],
    total: liveCalc.grandTotal,
    columns: [
      { key: 'label', label: 'หมวด' },
      { key: 'sub', label: 'รายละเอียด' },
      { key: 'value', label: 'มูลค่า (฿)', align: 'right', width: 150, fmt: (v) => fmtT0(v), isMoney: true },
    ],
  });

  // backwards-compat aliases (ใช้กับ block ด้านล่าง)
  const liveUnsigned = { value: liveCalc.unsigned.value, count: liveCalc.unsigned.count };
  const liveTotalProjectValue = liveCalc.grandTotal;

  // ── WS- importer — เพิ่มโครงการรอลงนามจากไฟล์ Excel ดิบ (one-click) ──────
  //   ไม่ต้องผ่าน Migration ทั้งระบบ · เก็บ WS- rows ลง data.projects ทันที
  //   → sync ขึ้น Google Sheet → dashboard อัปเดต live
  const handleWSExcel = async (file) => {
    if (!file || !window.XLSX) { toast('ไม่พบ SheetJS หรือไฟล์ — ลองรีเฟรช'); return; }
    try {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
      const mainSheets = wb.SheetNames.filter(n => /^Main\s*all/i.test(n));
      if (!mainSheets.length) { toast('❌ ไฟล์ต้องมี sheet ขึ้นต้นด้วย "Main all"'); return; }
      // helper inline (ไม่อยากผูก dependency กับ page_projects)
      const _yr = (sh) => (String(sh||'').match(/Main\s*all(\d+)/i) || [])[1] || 'XX';
      const _clean = (s) => String(s||'').trim().replace(/\s+/g, '_').slice(0, 36);
      const _wsCode = (sh, n) => 'WS-' + _yr(sh) + '-' + _clean(n);
      const _isCancel = (r) => {
        for (const k in r) {
          if (!/ยกเลิก/.test(k)) continue;
          const v = r[k]; if (v == null || v === '') continue;
          if (wr2ToN(v) === 1) return true;
        }
        return false;
      };
      const existing = data.projects || [];
      const existingByCode = {};
      existing.forEach(p => {
        const c = String(p['Contract No.'] || p.code || '').trim();
        if (c) existingByCode[c] = p;
      });
      let maxIdNum = 0;
      existing.forEach(p => { const m = String(p.id || '').match(/proj[_-]?0*(\d+)/i); if (m) maxIdNum = Math.max(maxIdNum, Number(m[1])); });

      const added = []; const skipped = { hasContract: 0, cancelled: 0, noName: 0, duplicate: 0 };
      mainSheets.forEach(sn => {
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null, raw: false });
        rows.forEach(_r => {
          // normalize keys
          const r = { _sheet: sn };
          for (const k of Object.keys(_r)) r[String(k).trim()] = _r[k];
          const contract = String(r['Contract No.'] || '').trim();
          const name = String(r['พื้นที่'] || '').trim();
          const start = String(r['Start'] || '').trim();
          if (contract) { skipped.hasContract++; return; }
          if (_isCancel(r)) { skipped.cancelled++; return; }
          if (!name) { skipped.noName++; return; }
          if (start) return; // ลงนามแล้ว ข้าม
          const code = _wsCode(sn, name);
          if (existingByCode[code]) { skipped.duplicate++; return; }
          maxIdNum++;
          const id = 'proj_' + String(maxIdNum).padStart(4, '0');
          added.push({ id, 'Contract No.': code, 'พื้นที่': name, ...r, _sheet: undefined });
        });
      });

      if (!added.length) {
        toast('ไม่พบโครงการรอลงนามใหม่ในไฟล์นี้ · มี Contract No.='+skipped.hasContract+' / ยกเลิก='+skipped.cancelled+' / ไม่มีชื่อ='+skipped.noName+' / ซ้ำ='+skipped.duplicate);
        return;
      }
      // ✦ Persist 2 ชั้น:
      //   1) localStorage — กันหายแม้ cloud sync ลบ → liveCalc merge กลับเสมอ
      //   2) setData → push cloud sheet (best effort) ให้ทีมเห็นด้วย
      const addedCodes = new Set(added.map(p => p['Contract No.']));
      const existingLocal = wr2LoadLocalProjects().filter(p => !addedCodes.has(p['Contract No.']));
      wr2SaveLocalProjects([...existingLocal, ...added]);
      window.dispatchEvent(new CustomEvent('wr2-ws-local-change'));  // trigger re-render

      setData(d => ({ ...d, projects: [...(d.projects || []), ...added] }));
      toast('✅ เพิ่มโครงการรอลงนาม ' + added.length + ' รายการ · ผูกไว้ใน local + sync เข้า Google Sheet…');
      setWsUploadOpen(false);
    } catch (err) {
      console.error(err);
      toast('❌ ผิดพลาด: ' + (err.message || err));
    }
  };

  // Compute monthly totals
  const monthTotals = wr2Memo(() => monthlyForecast.reduce((acc, m) => ({
    invIssued: acc.invIssued + (m.invIssued || 0),
    signed:    acc.signed    + (m.signed    || 0),
    unsigned:  acc.unsigned  + (m.unsigned  || 0),
    debt:      acc.debt      + (m.debt      || 0),
    netUsable: acc.netUsable + (m.netUsable || 0),
  }), { invIssued: 0, signed: 0, unsigned: 0, debt: 0, netUsable: 0 }), [monthlyForecast]);

  // Bar chart data
  const barData = monthlyForecast.map(m => ({
    label: m.en,
    segments: [
      { key: 'inv',      label: 'IV คงค้าง',    value: m.invIssued || 0, color: 'oklch(60% 0.13 245)' },
      { key: 'signed',   label: 'ลงนามแล้ว',    value: m.signed    || 0, color: 'oklch(55% 0.16 215)' },
      { key: 'unsigned', label: 'ยังไม่ลงนาม',  value: m.unsigned  || 0, color: 'oklch(75% 0.10 250)' },
    ],
    net: m.netUsable,
  }));

  return (
    <div className="page bg-pattern present-page wr-page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">Estimated Annual Cash Flow from Existing Projects</h1>
          <div className="page-sub">ประมาณการรับเงินจากโครงการทั้งหมด · ทั้งปี {meta.year} · ข้อมูล ณ {fmtDate(meta.asOf)}</div>
        </div>
        <div className="page-head-r">
          <span className="no-present" style={{ display: 'contents' }}><CloudSyncStatusButton /></span>
          <button className="btn no-present" onClick={() => setWsUploadOpen(true)} style={{ background: '#fef3c7', borderColor: '#fcd34d', color: '#78350f' }} title="เพิ่มโครงการรอลงนามจาก Excel">
            📁 เพิ่มจาก Excel
          </button>
          <span className="no-present" style={{ display: 'contents' }}><EditModeToggle value={editMode} onChange={setEditMode} /></span>
          <a className="btn btn-ghost no-print" href="#warroom1"><Icon name="arrow" size={14} style={{ transform: 'rotate(180deg)' }} /> ย้อนกลับ · หน้า 1</a>
          <button className="btn btn-ghost no-present" onClick={() => {
            // ส่งออก PDF — inject print style ซ่อน sidebar/topbar/ปุ่ม + ตั้งชื่อไฟล์จากวันที่กดบันทึก (เหมือนหน้า 1)
            const styleId = 'wr2-print-style';
            let style = document.getElementById(styleId);
            if (!style) { style = document.createElement('style'); style.id = styleId; document.head.appendChild(style); }
            style.textContent = `
              @media print {
                @page { size: A4 portrait; margin: 8mm 10mm; }
                html, body { background: #fff !important; }
                .sb, .sb-scrim, .topbar, .no-print, .no-present { display: none !important; }
                .app { grid-template-columns: 1fr !important; display: block !important; }
                .page, .main { max-width: none !important; padding: 0 !important; margin: 0 !important; overflow: visible !important; }
                .wr-page, .wr-page * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .wr-page .card { box-shadow: none !important; break-inside: avoid; }
                .wr-page table { break-inside: auto; }
                .wr-page thead { display: table-header-group; }
                .wr-page tr { break-inside: avoid; }
              }
            `;
            const _d = new Date();
            const _p2 = (n) => String(n).padStart(2, '0');
            const _brand = (window.WTP_CONFIG && window.WTP_CONFIG.BRAND_CODE) || 'BIO';
            const _prevTitle = document.title;
            document.title = `${_brand} - ประมาณการรับเงินจากโครงการ ${_p2(_d.getDate())}.${_p2(_d.getMonth() + 1)}.${_d.getFullYear()}`;
            const cleanup = () => {
              document.title = _prevTitle;
              if (style.parentNode) style.parentNode.removeChild(style);
              window.removeEventListener('afterprint', cleanup);
            };
            window.addEventListener('afterprint', cleanup);
            setTimeout(cleanup, 60000);
            setTimeout(() => window.print(), 50);
          }} title="ส่งออกหน้านี้เป็น PDF (Ctrl+P)"><Icon name="download" size={14} /> ส่งออก PDF</button>
          <button className="btn btn-ghost no-present" onClick={() => { if (confirm('โหลด JS ใหม่ทั้งหมด (clear cache) ?')) { location.href = location.pathname + '?t=' + Date.now() + '#warroom2'; } }}
            title={'Build: ' + WR2_BUILD + ' · คลิกเพื่อ force reload ทั้ง JS files'}
            style={{ fontSize: 10.5, opacity: 0.7 }}>
            🔄 v{WR2_BUILD.slice(-4)}
          </button>
        </div>
      </div>

      {/* invType filter toggle — เหมือนหน้า 1 · default โครงการ (P) */}
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

      {editMode && (
        <div className="no-present" style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 10, background: 'color-mix(in oklch, var(--brand-500) 8%, transparent)', border: '1.5px solid color-mix(in oklch, var(--brand-500) 30%, transparent)', fontSize: 12, color: 'var(--brand-700)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700 }}>📝 โหมดแก้ไข — คลิกในช่องตัวเลขเพื่อกรอกค่า (Tab/Enter เพื่อบันทึก, ✕ เพื่อล้าง)</span>
          <button type="button" onClick={() => { if (confirm('ล้างค่าที่กรอกมือทั้งหมดในหน้านี้?')) WTPOverride.clearAll(); }}
            style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 11, borderRadius: 5, border: '1px solid var(--bad)', background: 'transparent', color: 'var(--bad)', cursor: 'pointer' }}>
            ล้างทั้งหมด
          </button>
        </div>
      )}

      {/* Headline KPI — มูลค่าโครงการที่คาดว่าจะได้รับทั้งหมด */}
      <div className="hero-pill anim-in" style={{ marginBottom: 18 }}>
        {(() => {
          // Hero total auto-update: ผลรวมของ 3 breakdown ที่ user แก้ได้ (IV+WIP+Unsigned)
          //   ถ้า user ตั้ง wr2.heroTotal เอง → ใช้ค่านั้นทับ
          const heroInv = WTPOverride.resolve('wr2.heroInvForward', liveCalc.invForward.value);
          const heroWip = WTPOverride.resolve('wr2.heroWip', liveCalc.wip.value);
          const heroUns = WTPOverride.resolve('wr2.heroUnsigned', liveCalc.unsigned.value);
          const heroAutoTotal = heroInv + heroWip + heroUns;
          const heroTotalOverridden = WTPOverride.has('wr2.heroTotal');
          return (
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ cursor: editMode ? 'auto' : 'pointer' }}
            onClick={editMode ? undefined : openGrandTotalDrill}
            title={editMode ? '' : 'คลิกเพื่อดูที่มาของยอดรวม'}>
            <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              มูลค่าโครงการที่คาดว่าจะได้รับทั้งหมด
              {!editMode && <span style={{ fontSize: 11, opacity: 0.7 }}>🔍</span>}
              {editMode && <span style={{ fontSize: 11, opacity: 0.7 }}>✏️</span>}
            </div>
            <div style={{ fontSize: 44, fontWeight: 800, marginTop: 4, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {editMode ? (
                <EditableNumber ovKey="wr2.heroTotal" computed={heroAutoTotal} editMode={true} digits={2} />
              ) : (
                <>
                  <AnimatedNumber value={heroTotalOverridden ? WTPOverride.get('wr2.heroTotal') : heroAutoTotal} digits={2} />
                  {heroTotalOverridden && <span title="แก้มือ" style={{ fontSize: 14, marginLeft: 8, opacity: 0.85 }}>✏️</span>}
                </>
              )}
              {' '}<span style={{ fontSize: 18, opacity: 0.8, fontWeight: 500 }}>บาท</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>Total project value forecast · ปี {meta.year}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 24, fontSize: 12 }}>
            <div style={{ cursor: editMode ? 'auto' : 'pointer' }} onClick={editMode ? undefined : openInvForwardDrill} title={editMode ? '' : 'คลิกดูรายการ IV'}>
              <HeroStatEditable ovKey="wr2.heroInvForward" label="ใบแจ้งหนี้คงค้าง 🔍" computed={liveCalc.invForward.value} editMode={editMode} />
            </div>
            <div style={{ cursor: editMode ? 'auto' : 'pointer' }} onClick={editMode ? undefined : openWipDrill} title={editMode ? '' : 'คลิกดูโครงการระหว่างก่อสร้าง'}>
              <HeroStatEditable ovKey="wr2.heroWip" label="งานระหว่างก่อสร้าง 🔍" computed={liveCalc.wip.value} editMode={editMode} />
            </div>
            <div style={{ cursor: editMode ? 'auto' : 'pointer' }} onClick={editMode ? undefined : openUnsignedDrill} title={editMode ? '' : 'คลิกดูโครงการรอลงนาม'}>
              <HeroStatEditable ovKey="wr2.heroUnsigned" label="ใบจัดสรร · รอลงนาม 🔍"
                computed={liveCalc.unsigned.value > 0 ? liveCalc.unsigned.value : WTPOverride.resolve('wr2.heroUnsigned', 0)}
                count={liveCalc.unsigned.value > 0 ? liveCalc.unsigned.count : WTPOverride.resolve('wr2.heroUnsignedCount', 0)}
                editMode={editMode} countKey="wr2.heroUnsignedCount" forceLive />
            </div>
          </div>
        </div>
          );
        })()}
      </div>

      {/* SECTION 1 — ประมาณการรับเงินจากโครงการทั้งหมด */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', marginTop: 6, marginBottom: 10 }}>
        <div style={{ width: 4, height: 22, background: 'var(--brand-500)', borderRadius: 2 }} />
        <h2 style={{ margin: 0, fontSize: 17, color: 'var(--ink-900)', fontWeight: 700 }}>ส่วนที่ 1 · ประมาณการรับเงินจากโครงการทั้งหมด</h2>
      </div>

      <div className="grid grid-2 anim-stagger" style={{ marginBottom: 18 }}>
        {/* 1.1 — Unsigned (clickable) */}
        <div className="card" onClick={editMode ? undefined : openUnsignedDrill}
          style={{ padding: 22, position: 'relative', overflow: 'hidden', cursor: editMode ? 'auto' : 'pointer' }}
          title={editMode ? '' : 'คลิกเพื่อดูรายการโครงการที่รอลงนาม'}>
          <div style={{ position: 'absolute', right: -40, top: -40, width: 140, height: 140, borderRadius: '50%', background: 'oklch(96% 0.04 250)' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Badge kind="b-gray" dot={false}>1.1</Badge>
              {!editMode && <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>🔍 คลิกดูรายละเอียด</span>}
            </div>
            <div style={{ marginTop: 10, fontSize: 14, color: 'var(--ink-600)', fontWeight: 500 }}>โครงการที่รอลงนามสัญญา</div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>ได้รับใบจัดสรรแล้ว · Start ว่าง · ไม่ยกเลิก · ใช้มูลค่าใบจัดสรร</div>
            {(() => {
              // ใช้ค่าสดจากข้อมูลโครงการ (Σ เงินตามใบจัดสรร ของโครงรอลงนาม ไม่ยกเลิก · ตัดซ้ำแล้ว)
              // ถ้าข้อมูลยังไม่มี (live = 0 เช่นยังไม่อัปโหลดงบ) ค่อย fallback ค่าที่กรอกมือ
              const liveUnsigned = liveCalc.unsigned.value;
              const useManual = !(liveUnsigned > 0);
              const unsignedOverridden = useManual && WTPOverride.has('wr2.heroUnsigned');
              const effUnsigned = useManual ? WTPOverride.resolve('wr2.heroUnsigned', 0) : liveUnsigned;
              const effUnsignedCount = useManual ? WTPOverride.resolve('wr2.heroUnsignedCount', liveCalc.unsigned.count) : liveCalc.unsigned.count;
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 14 }}>
                    <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}
                      onClick={editMode ? (e) => e.stopPropagation() : undefined}>
                      <AnimatedNumber value={effUnsigned} digits={2} />
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--ink-500)' }}>บาท</div>
                    {unsignedOverridden && <span title="แก้มือ" style={{ fontSize: 14, opacity: 0.85 }}>✏️</span>}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {unsignedOverridden ? (
                      <Badge kind="b-amber" dot>ค่าที่กรอกมือ</Badge>
                    ) : (
                      <Badge kind="b-amber" dot>{effUnsignedCount} โครงการ</Badge>
                    )}
                    {!unsignedOverridden && liveCalc.grandTotal > 0 && (
                      <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>
                        {((effUnsigned / liveCalc.grandTotal) * 100).toFixed(1)}% ของมูลค่าทั้งหมด
                      </span>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* 1.2 — Signed (clickable rows for breakdown) */}
        <div className="card" data-comment-anchor="cc-1" style={{ padding: 22, position: 'relative', overflow: 'hidden', borderColor: 'var(--brand-200)' }}>
          <div style={{ position: 'absolute', right: -40, top: -40, width: 140, height: 140, borderRadius: '50%', background: 'var(--brand-50)' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Badge kind="b-blue" dot={false}>1.2</Badge>
              {!editMode && <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>🔍 คลิกแถวเพื่อดู</span>}
            </div>
            <div style={{ marginTop: 10, fontSize: 14, color: 'var(--ink-600)', fontWeight: 500, cursor: editMode ? 'auto' : 'pointer' }}
              onClick={editMode ? undefined : openSignedDrill}>
              ประมาณการรับเงินจากโครงการที่ลงนามแล้ว
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>= ใบแจ้งหนี้คงค้าง + งานระหว่างก่อสร้าง</div>
            {/* Computed dynamic total — IV + WIP (auto-update เมื่อแก้ override) */}
            {(() => {
              const effInv = WTPOverride.resolve('wr2.s12Inv', liveCalc.invForward.value);
              const effWip = WTPOverride.resolve('wr2.s12Wip', liveCalc.wip.value);
              const effTotal = effInv + effWip;
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 14, cursor: editMode ? 'auto' : 'pointer' }}
                    onClick={editMode ? undefined : openSignedDrill}>
                    <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--brand-700)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>
                      <AnimatedNumber value={effTotal} digits={2} />
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--ink-500)' }}>บาท</div>
                  </div>

                  {/* Breakdown — invoice vs WIP (each row editable + clickable) */}
                  <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: 'white', border: '1px solid var(--line)', display: 'grid', gap: 10 }}>
                    <div onClick={editMode ? undefined : openInvForwardDrill}
                      style={{ cursor: editMode ? 'auto' : 'pointer', borderRadius: 8, padding: 4, margin: -4 }}
                      title={editMode ? '' : 'คลิกดูใบแจ้งหนี้คงค้างทั้งหมด'}>
                      <SignedBreakdownRow
                        color="oklch(60% 0.13 245)"
                        label={'มูลค่าใบแจ้งหนี้คงค้าง ' + (editMode ? '✏️' : '🔍')}
                        sub={liveCalc.invForward.count + ' ใบ · ออก IV แล้ว · รอติดตามรับเงิน'}
                        value={effInv}
                        total={effTotal}
                        editMode={editMode}
                        ovKey="wr2.s12Inv"
                      />
                    </div>
                    <div onClick={editMode ? undefined : openWipDrill}
                      style={{ cursor: editMode ? 'auto' : 'pointer', borderRadius: 8, padding: 4, margin: -4 }}
                      title={editMode ? '' : 'คลิกดูโครงการระหว่างก่อสร้าง'}>
                      <SignedBreakdownRow
                        color="oklch(55% 0.16 215)"
                        label={'มูลค่างานระหว่างก่อสร้าง ' + (editMode ? '✏️' : '🔍')}
                        sub={WTPOverride.has('wr2.s12Wip') ? '' : (liveCalc.wip.count + ' โครงการ · contract – billed')}
                        value={effWip}
                        total={effTotal}
                        editMode={editMode}
                        ovKey="wr2.s12Wip"
                      />
                    </div>
                  </div>
                </>
              );
            })()}

            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Badge kind="b-blue" dot>{liveCalc.grandTotal > 0 ? ((liveCalc.signedTotal / liveCalc.grandTotal) * 100).toFixed(0) : 0}% ของมูลค่าทั้งหมด</Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Drill-down modal */}
      {drill && <Wr2DrillModal drill={drill} onClose={() => setDrill(null)} onPickRow={(row) => row && row._click && row._click()} />}

      {/* WS Excel uploader — quick-import waiting-sign rows */}
      {wsUploadOpen && (
        <div onClick={() => setWsUploadOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
          display: 'grid', placeItems: 'center', zIndex: 9000, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'white', borderRadius: 14, padding: 24,
            width: 'min(560px, 95vw)', boxShadow: '0 24px 60px rgba(15,23,42,0.35)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>📁 เพิ่มโครงการรอลงนามจาก Excel</h2>
              <button onClick={() => setWsUploadOpen(false)} style={{ border: 'none', background: 'none', fontSize: 24, cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            <div style={{
              background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8,
              padding: '10px 12px', marginBottom: 16, fontSize: 12, color: '#78350f', lineHeight: 1.6,
            }}>
              <strong>เครื่องมือเร็ว</strong> — ดึงเฉพาะโครงการที่ <strong>ไม่มี Contract No.</strong> + <strong>ไม่ยกเลิก</strong> + <strong>ไม่มี Start date</strong> จากไฟล์ Excel (sheet Main all*) แล้วเพิ่มเป็น <code>WS-YY-...</code> ลง Google Sheet โดยตรง · ไม่ต้องทำ Migration ใหม่
            </div>
            <label style={{
              display: 'block', border: '2px dashed #cbd5e1', borderRadius: 10,
              padding: 30, textAlign: 'center', cursor: 'pointer', background: '#f8fafc',
            }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>📂</div>
              <div style={{ fontSize: 13, color: '#475569' }}>คลิกเพื่อเลือกไฟล์ Project Control xlsx</div>
              <input type="file" accept=".xlsx" style={{ display: 'none' }}
                onChange={(e) => e.target.files[0] && handleWSExcel(e.target.files[0])} />
            </label>
          </div>
        </div>
      )}

      {/* SECTION 2 — Monthly forecast table & chart */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', marginTop: 6, marginBottom: 10 }}>
        <div style={{ width: 4, height: 22, background: 'var(--brand-500)', borderRadius: 2 }} />
        <h2 style={{ margin: 0, fontSize: 17, color: 'var(--ink-900)', fontWeight: 700 }}>ส่วนที่ 2 · รวมประมาณการเงินที่คาดว่าจะได้รับในแต่ละเดือน</h2>
      </div>

      <div className="card anim-in" style={{ marginBottom: 18, padding: 18 }}>
        <div className="card-hd">
          <div>
            <div className="card-title">ประมาณการรับเงินรายเดือน</div>
            <div className="card-sub">แยกตามที่มา · IV คงค้าง / ลงนามแล้ว / ยังไม่ลงนาม</div>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--ink-700)' }}>
            <LegendDot color="oklch(60% 0.13 245)" label="IV คงค้าง" />
            <LegendDot color="oklch(55% 0.16 215)" label="ลงนามแล้ว (รอส่งงาน)" />
            <LegendDot color="oklch(75% 0.10 250)" label="ยังไม่ลงนาม" />
          </div>
        </div>
        <StackedBars data={barData} height={300} />
      </div>

      {/* Monthly forecast detailed table */}
      <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div className="card-title">ตารางประมาณการรับเงินรายเดือน (รายละเอียด)</div>
          <div className="card-sub">รวม {fmtNum(monthTotals.netUsable, 2)} บาท · 8 เดือนข้างหน้า</div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>เดือน</th>
              <th style={{ textAlign: 'center', width: 80 }}>%</th>
              <th style={{ textAlign: 'right' }}>ใบแจ้งหนี้ยกมา</th>
              <th style={{ textAlign: 'right' }}>ลงนามแล้ว (รอส่งงาน)</th>
              <th style={{ textAlign: 'right' }}>ยังไม่ลงนาม</th>
              <th style={{ textAlign: 'right' }}>หักภาระหนี้</th>
              <th style={{ textAlign: 'right' }}>ใช้ได้สุทธิ</th>
            </tr>
          </thead>
          <tbody>
            {monthlyForecast.map((m, i) => (
              <tr key={i}>
                <td>
                  <span style={{ fontWeight: 600 }}>{m.month}</span>
                  <span className="muted" style={{ fontSize: 11.5, marginLeft: 6, fontWeight: 400 }}>({m.en})</span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <Badge kind={m.pctOfRemaining >= 20 ? 'b-blue' : m.pctOfRemaining > 0 ? 'b-gray' : 'b-gray'} dot={false}>{m.pctOfRemaining}%</Badge>
                </td>
                <td className="num">{m.invIssued ? fmtNum(m.invIssued, 2) : <span className="muted">-</span>}</td>
                <td className="num">{m.signed ? fmtNum(m.signed, 2) : <span className="muted">-</span>}</td>
                <td className="num">{m.unsigned ? fmtNum(m.unsigned, 2) : <span className="muted">-</span>}</td>
                <td className="num" style={{ color: m.debt ? 'var(--bad)' : 'var(--ink-400)' }}>{m.debt ? '(' + fmtNum(Math.abs(m.debt), 2) + ')' : '-'}</td>
                <td className="num strong">{m.netUsable ? fmtNum(m.netUsable, 2) : <span className="muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>รวมทั้งสิ้น</td>
              <td style={{ textAlign: 'center' }}>100%</td>
              <td className="num">{fmtNum(monthTotals.invIssued, 2)}</td>
              <td className="num">{fmtNum(monthTotals.signed, 2)}</td>
              <td className="num">{fmtNum(monthTotals.unsigned, 2)}</td>
              <td className="num" style={{ color: 'var(--bad)' }}>({fmtNum(Math.abs(monthTotals.debt), 2)})</td>
              <td className="num">{fmtNum(monthTotals.netUsable, 2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* (removed bottom stat strip per user request) */}
    </div>
  );
}

function HeroStat({ label, value, count }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {(value / 1_000_000).toFixed(2)} <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 500 }}>ลบ.</span>
      </div>
      {count != null && <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{count} โครงการ</div>}
    </div>
  );
}

// Hero stat — editable + sync ผ่าน cloud
function HeroStatEditable({ ovKey, label, computed, count, countKey, editMode, forceLive }) {
  const overridden = !forceLive && WTPOverride.has(ovKey);
  useOverrideSub(ovKey);
  useOverrideSub(countKey || '_');
  const value = forceLive ? computed : WTPOverride.resolve(ovKey, computed);
  const resolvedCount = (countKey && !forceLive) ? WTPOverride.resolve(countKey, count || 0) : count;
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 11, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {(editMode && !forceLive) ? (
          <EditableNumber ovKey={ovKey} computed={computed} editMode={true} digits={0} />
        ) : (
          <>
            {(value / 1_000_000).toFixed(2)} <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 500 }}>ลบ.</span>
            {overridden && <span title="แก้มือ" style={{ fontSize: 9, marginLeft: 4, opacity: 0.85 }}>✏️</span>}
          </>
        )}
      </div>
      {(count != null || countKey) && (
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
          {countKey && editMode && !forceLive ? (
            <EditableNumber ovKey={countKey} computed={count || 0} editMode={editMode} digits={0} />
          ) : resolvedCount} โครงการ
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

function SmallStat({ label, value, accent }) {
  return (
    <div className="card" style={{ padding: 16, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums', marginTop: 4, letterSpacing: '-.01em' }}>
        <AnimatedNumber value={value} digits={2} />
        <span style={{ fontSize: 12, color: 'var(--ink-500)', fontWeight: 500, marginLeft: 4 }}>บาท</span>
      </div>
    </div>
  );
}

function SignedBreakdownRow({ color, label, sub, value, total, editMode, ovKey }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-800)' }}>{label}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>{sub}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-900)' }}>
            {ovKey ? (
              <EditableNumber ovKey={ovKey} computed={value} editMode={editMode} digits={2} />
            ) : fmtNum(value, 2)}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-500)' }}>{pct.toFixed(1)}%</div>
        </div>
      </div>
      <div style={{ height: 5, background: 'var(--ink-100)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 800ms ease' }} />
      </div>
    </div>
  );
}

// ─── Drill-down modal ──────────────────────────────────────────────────────
function Wr2DrillModal({ drill, onClose, onPickRow }) {
  const { title, subtitle, items, columns, total } = drill;
  const fmtT0 = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      display: 'grid', placeItems: 'center', zIndex: 9000, padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'white', borderRadius: 14, padding: 0,
        width: 'min(1000px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(15,23,42,0.35)',
      }}>
        <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{title}</h2>
            {subtitle && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 26, cursor: 'pointer', color: '#94a3b8', lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={{
                    padding: '10px 12px', textAlign: c.align || 'left', width: c.width,
                    borderBottom: '1px solid #cbd5e1', fontSize: 11, fontWeight: 700, color: '#475569',
                    whiteSpace: 'nowrap',
                  }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={columns.length} style={{ padding: 36, textAlign: 'center', color: '#94a3b8' }}>ไม่มีรายการ</td></tr>
              )}
              {items.map((row, i) => {
                const clickable = !!row._click;
                return (
                  <tr key={i}
                    onClick={() => clickable && onPickRow(row)}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      cursor: clickable ? 'pointer' : 'default',
                      background: clickable && i % 2 === 0 ? '#fafbfc' : undefined,
                    }}
                    onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = '#eff6ff'; }}
                    onMouseLeave={(e) => { if (clickable) e.currentTarget.style.background = i % 2 === 0 ? '#fafbfc' : 'white'; }}
                  >
                    {columns.map((c) => {
                      const v = row[c.key];
                      const display = c.fmt ? c.fmt(v, row) : (v != null && v !== '' ? v : '—');
                      return (
                        <td key={c.key} style={{
                          padding: '8px 12px', textAlign: c.align || 'left',
                          color: c.isMoney ? '#0f172a' : '#0f172a',
                          fontWeight: c.isMoney ? 600 : 400,
                          fontVariantNumeric: c.align === 'right' ? 'tabular-nums' : 'normal',
                          maxWidth: c.width || 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }} title={typeof display === 'string' ? display : ''}>{display}</td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            {total != null && items.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
                  {columns.map((c, idx) => (
                    <td key={c.key} style={{
                      padding: '12px', fontWeight: 700, fontSize: 12.5, color: '#0f172a',
                      textAlign: c.align || 'left', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {idx === 0 ? 'รวม ' + items.length + ' รายการ' : (c.isMoney ? fmtT0(total) + ' บาท' : '')}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { WarRoomPage2 });
