// BIOAXEL Financial Dashboard – mock data store with localStorage persistence.
// v6: expanded schema for projects (periods, dates, allocBudget, signedValue, assignee),
//     invoices (jobNo mapping, follow-up log, contact info, actual receive),
//     and renamed psNotes → pvVouchers (Payment Voucher).

(function () {
  const STORAGE_KEY = 'bio-fin-data-v8';

  // Globally-unique id = timestamp + per-session counter + random.
  //   ★ เดิมเป็น counter เริ่มที่ 1000 ที่ "รีเซ็ตทุกครั้งที่โหลดหน้า" → แถวใหม่ใบแรกได้
  //     id_rt, ใบสองได้ id_ru เหมือนกันทุก session/เครื่อง/รีโหลด. บน backend ที่ PK=id
  //     (Supabase) การ upsert id ที่ซ้ำ = "ทับ" แถวเดิม → ข้อมูลหาย (เช่น เพิ่มเช็คใบที่ 2
  //     หลังรีเฟรช แล้วใบที่ 1 หาย เพราะทั้งคู่ได้ id_rt) และทับงานของคนอื่นที่เพิ่มพร้อมกัน.
  //     timestamp (มิลลิวินาที) + counter (กันซ้ำใน ms เดียวกันต่อ session) + random
  //     (กันซ้ำข้าม session/เครื่องที่เรียกใน ms เดียวกัน) → ไม่ซ้ำทุกมิติ.
  const id = (() => {
    let n = 0;
    return () => 'id_' + Date.now().toString(36) + '-' + (++n).toString(36) + Math.random().toString(36).slice(2, 8);
  })();

  // Helper: days between two ISO dates
  const daysBetween = (a, b) => {
    if (!a || !b) return null;
    // ใช้ parseDateFlexible (จาก components.jsx) ถ้ามี — รองรับ DD/MM/YYYY Thai format
    const parse = (window.parseDateFlexible) || (v => new Date(v));
    const da = parse(a);
    const db = parse(b);
    if (!da || !db || isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / (1000 * 60 * 60 * 24));
  };

  const seed = () => ({
    meta: {
      companyName: 'บริษัท ไบโอแอ็กซ์เซลล์ จำกัด',
      shortName: 'BIOAXEL',
      asOf: '2026-05-18',
      year: 2026,
      currency: 'THB',
    },

    // ── 02. Pipeline summary (War Room) ─────────────────────────────────────
    pipeline: {
      waitingSign:    { count: 10, gross: 35118000.00,  debt: 16649500.00,  net: 18468500.00 },
      signedWip:      { count: 23, gross: 42952000.00,  debt: 8818806.05,   net: 34133193.95 },
      invoicedOutstanding: { count: 4, gross: 10154200.00, debt: 2809200.00, net: 7345000.00 },
      totalProjectValue: 247453578.76,
      invoiceBroughtForward: 10154200.00,
      signedNotDelivered:    35118000.00,
      notSigned:             47900000.00,
      totalDebt:             84498100.00,
      usableNet:             162955478.76,
    },

    // ── War Room P1 / P2 (unchanged) ────────────────────────────────────────
    warroomP1: {
      topKpis: { totalInvoices: 10, estimatedCashInflow: 35118000.00, estimatedDebt: 16649500.00, netProjection: 18468500.00 },
      thisMonthNetProjection: 20968200.00,
      nextMonthNetProjection: 18468500.00,
      outstandingSummary: {
        systemTotal:        { count: 14, gross: 45272200.00, debt: -19458700.00, net: 25813500.00 },
        thisMonthTracked:   { count: 4,  gross: 10154200.00, debt: -2809200.00,  net: 7345000.00 },
        nextMonthRollover:  { count: 10, gross: 35118000.00, debt: -16649500.00, net: 18468500.00 },
      },
      outstandingThisMonthByTransfer: [
        { type: 'ไม่โอนสิทธิรับเงิน', count: 1, gross: 2154200.00, debt: 0,           net: 2154200.00 },
        { type: 'โอนสิทธิรับเงิน',    count: 3, gross: 8000000.00, debt: -2809200.00, net: 5190800.00 },
      ],
      outstandingThisMonthTotal: { count: 4, gross: 10154200.00, debt: -2809200.00, net: 7345000.00 },
      outstandingByTransfer: [
        { type: 'ไม่โอนสิทธิรับเงิน', count: 3,  gross: 5000000.00,  debt: -2000000.00,  net: 3000000.00 },
        { type: 'โอนสิทธิรับเงิน',    count: 7,  gross: 30118000.00, debt: -14649500.00, net: 15468500.00 },
      ],
      outstandingTotal: { count: 10, gross: 35118000.00, debt: -16649500.00, net: 18468500.00 },
      wipByTransfer: [
        { type: 'ไม่โอนสิทธิรับเงิน', count: 12, gross: 21839603.76,  debt: 0,            net: 21839603.76 },
        { type: 'โอนสิทธิรับเงิน',    count: 71, gross: 182265900.00, debt: -65039400.00, net: 117226500.00 },
      ],
      wipTotal: { count: 83, gross: 204105503.76, debt: -65039400.00, net: 139066103.76 },
    },
    warroomP2: {
      totalProjectValue:      247453578.76,
      invoiceForwardTotal:    45272200.00,
      wipValue:               154281378.76,
      unsignedTotal: { count: 10, value: 47900000.00 },
      signedTotal:   { count: 0,  value: 199553578.76 },
    },

    // ── YTD / weekly / monthly ──────────────────────────────────────────────
    ytdRevenue: [
      { month: 'มกราคม',   en: 'Jan', count: 13, gross: 35644984.34, debt: 0,           net: 35644984.34 },
      { month: 'กุมภาพันธ์', en: 'Feb', count: 16, gross: 26170400.00, debt: -8898400.00, net: 17272000.00 },
      { month: 'มีนาคม',   en: 'Mar', count: 15, gross: 32846184.32, debt: -13363100.00,net: 19483084.32 },
      { month: 'เมษายน',   en: 'Apr', count: 23, gross: 42952000.00, debt: -8818806.05, net: 34133193.95 },
      { month: 'พฤษภาคม', en: 'May', count: 4,  gross: 10814000.00, debt: -5963196.05, net: 4850803.95  },
    ],
    weeklyExpectedReceipt: [
      { week: 1, count: 2, gross: 7554200.00,  debt: -2159200.00, net: 5395000.00 },
      { week: 2, count: 2, gross: 2600000.00,  debt: -650000.00,  net: 1950000.00 },
      { week: 3, count: 12, gross: 21839603.76, debt: 0,          net: 21839603.76 },
      { week: 4, count: 0, gross: 0, debt: 0, net: 0 },
      { week: 5, count: 0, gross: 0, debt: 0, net: 0 },
    ],
    monthlyForecast: [
      { month: 'พฤษภาคม', en: 'May',  pctOfRemaining: 14, invIssued: 10154200.00, signed: 0, unsigned: 0, debt: -2809200.00,   netUsable: 7345000.00 },
      { month: 'มิถุนายน', en: 'Jun', pctOfRemaining: 11, invIssued: 35118000.00, signed: 0, unsigned: 0, debt: -16649500.00,  netUsable: 18468500.00 },
      { month: 'กรกฎาคม', en: 'Jul', pctOfRemaining: 13, invIssued: 0,           signed: 23450300.00, unsigned: 0,         debt: -11366800.00, netUsable: 20524900.00 },
      { month: 'สิงหาคม', en: 'Aug', pctOfRemaining: 16, invIssued: 0,           signed: 41105000.00, unsigned: 0,         debt: -17654700.00, netUsable: 23450300.00 },
      { month: 'กันยายน', en: 'Sep', pctOfRemaining: 24, invIssued: 0,           signed: 48739478.76, unsigned: 0,         debt: -23057900.00, netUsable: 25681578.76 },
      { month: 'ตุลาคม',  en: 'Oct', pctOfRemaining: 5,  invIssued: 0,           signed: 13105200.00, unsigned: 28740000,  debt: -3240000.00,  netUsable: 38605200.00 },
      { month: 'พฤศจิกายน',en: 'Nov',pctOfRemaining: 18, invIssued: 0,           signed: 19440000.00, unsigned: 19160000, debt: -9720000.00,  netUsable: 28880000.00 },
      { month: 'ธันวาคม',  en: 'Dec', pctOfRemaining: 0,  invIssued: 0,           signed: 0,           unsigned: 0,         debt: 0,            netUsable: 0 },
    ],

    daily: {
      asOfDate: '2026-05-15',
      ytdAccum:   { count: 77, value: 149332093.66 },
      mtdAccum:   { count: 5,  value: 11045525.00 },
      todayAccum: { count: 1,  value: 231525.00 },
      invoicesToday: [
        { id: id(), no: 1, code: 'PP064-STIIS', name: 'บ้านพรุกง ม.2 ต.วังใหญ่ อ.เทพา จ.สงขลา', period: 1, amount: 231525.00, receivedAt: '2026-05-15' },
      ],
    },

    cashFlow: {
      month: 'May 2026',
      bf: 2924226.17, planTotal: 28300000.00, actualPaid: 7597582.34, paidPct: 26.85,
      revInflow: 4805469, loanReceived: 1473275, loanLine: 3757661, loanRemain: 4600000, finalNet: -8504440,
      inflow: [
        { key: 'bf',      label: 'เงินสดคงเหลือยกมา',          actual:[2924226.17, 0,0,0,0], plan:[0,0,0,0,0] },
        { key: 'project', label: 'รับเงินโครงการ',              actual:[2924226.17, 0,0,0,0], plan:[0, 8500523.50, 0, 0, 0] },
        { key: 'loan',    label: 'เงินกู้/สินเชื่อหมุนเวียน',     actual:[0,0,0,0,0],            plan:[0, 3200000, 0, 0, 0] },
      ],
      outflow: [
        { key: 'op',   label: '1. ค่าใช้จ่ายดำเนินงานรายสัปดาห์', plan:[1500000,1500000,1500000,1800000,1500000], actual:[1808097.83, 251317.48, 0, 0, 0] },
        { key: 'proj', label: '2. ค่าใช้จ่ายโครงการ/ติดตั้ง',     plan:[3000000,3000000,3000000,3000000,3000000], actual:[2478115.64, 0, 0, 0, 0] },
        { key: 'fin',  label: '3. ต้นทุนทางการเงินและดอกเบี้ย',  plan:[1320000,1160000,160000,1000000,3060000],  actual:[38393.86, 0, 3021657.53, 0, 0] },
        { key: 'misc', label: '4. ค่าใช้จ่ายเบ็ดเตล็ดและเงินเดือน',plan:[0,0,3300000,0,0],                          actual:[0,0,0,0,0] },
      ],
      closing: [-1331906.41, -6279476.50, -3584977.04, -6599615.67, -3300000.00],
      nowWeek: 2,
    },

    // ────────────────────────────────────────────────────────────────────────
    // RAW_PROJECT — โครงการทั้งหมด (ข้อมูลฝั่งโครงการ)
    // ────────────────────────────────────────────────────────────────────────
    projects: [
      {
        id: id(),
        code: 'PP064-STIIS',                                  // 1 รหัสโครงการ (= jobNo)
        name: 'บ้านพรุกง ม.2 ต.วังใหญ่ อ.เทพา จ.สงขลา',         // 2 ชื่อโครงการ
        startDate:  '2025-11-25',                              // 3 Start
        finishDate: '2026-05-15',                              // 4 Finish
        allocBudget:  4800000,                                 // 6 เงินตามใบจัดสรร
        signedValue:  4630500,                                 // 7 มูลค่าสัญญาที่เซ็น (รวม VAT)
        status: 'invoiced', delivery: 'received',
        value: 4630500, debt: 0, net: 4630500, expectedReceive: '2026-05-15', signedAt: '2025-11-20',
        startNotice: '2025-12-01',                             // แจ้งเข้าดำเนินการ
        timeStop: 0,                                           // หยุดเวลา (วัน)
        periods: [
          { period: 1, pctPogStank: 100, pctPogDrink: 0, value: 231525, deliveryDate: '2026-05-12', inspectionDoc: 'IS-PP064-01', payment: 231525, summaryPayment: 231525, paymentStatus: 'paid', receiveDate: '2026-05-15' },
        ],
      },
      {
        id: id(), code: 'PP073-AYT', name: 'อาคารสำนักงาน เทศบาลตำบลอ่าวยาง จ.พังงา',
        startDate: '2025-10-10', finishDate: '2026-08-30',
        allocBudget: 19200000, signedValue: 18900000,
        status: 'invoiced', delivery: 'pending',
        value: 18900000, debt: 4200000, net: 14700000, expectedReceive: '2026-05-22', signedAt: '2025-10-05',
        startNotice: '2025-10-20', timeStop: 0,
        periods: [
          { period: 1, pctPogStank: 60, pctPogDrink: 0, value: 9450000, deliveryDate: '2026-03-15', inspectionDoc: 'IS-PP073-01', payment: 9450000, summaryPayment: 9450000, paymentStatus: 'paid', receiveDate: '2026-04-02' },
          { period: 2, pctPogStank: 100, pctPogDrink: 0, value: 9450000, deliveryDate: '2026-05-05', inspectionDoc: '—', payment: 4200000, summaryPayment: 4200000, paymentStatus: 'pending_inspection', receiveDate: null },
        ],
      },
      {
        id: id(), code: 'PP081-NKM', name: 'ระบบประปา ต.นาคำ อ.เมือง จ.หนองคาย',
        startDate: '2025-09-15', finishDate: '2026-06-30',
        allocBudget: 12800000, signedValue: 12500000,
        status: 'invoiced', delivery: 'delivered',
        value: 12500000, debt: 3500000, net: 9000000, expectedReceive: '2026-05-28', signedAt: '2025-09-12',
        startNotice: '2025-09-25', timeStop: 0,
        periods: [
          { period: 1, pctPogStank: 30, pctPogDrink: 70, value: 3750000, deliveryDate: '2025-12-20', inspectionDoc: 'IS-PP081-01', payment: 3750000, summaryPayment: 3750000, paymentStatus: 'paid', receiveDate: '2026-01-15' },
          { period: 2, pctPogStank: 30, pctPogDrink: 70, value: 5250000, deliveryDate: '2026-03-10', inspectionDoc: 'IS-PP081-02', payment: 5250000, summaryPayment: 5250000, paymentStatus: 'paid', receiveDate: '2026-03-28' },
          { period: 3, pctPogStank: 40, pctPogDrink: 0, value: 3500000, deliveryDate: '2026-05-05', inspectionDoc: 'IS-PP081-03', payment: 3500000, summaryPayment: 3500000, paymentStatus: 'tracking', receiveDate: null },
        ],
      },
      {
        id: id(), code: 'PP084-SKN', name: 'ปรับปรุงท่อจ่ายน้ำ ม.7 ต.สำโรง จ.อุบลฯ',
        startDate: '2026-02-01', finishDate: '2026-07-30',
        allocBudget: 8800000, signedValue: 8550000,
        status: 'signed_wip', delivery: 'in_progress',
        value: 8550000, debt: 1800000, net: 6750000, expectedReceive: '2026-07-10', signedAt: '2026-01-22',
        startNotice: '2026-02-05', timeStop: 0,
        periods: [
          { period: 1, pctPogStank: 100, pctPogDrink: 0, value: 4275000, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
          { period: 2, pctPogStank: 100, pctPogDrink: 0, value: 4275000, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
        ],
      },
      {
        id: id(), code: 'PP088-MTK', name: 'ระบบส่งน้ำ ต.มะตูม อ.พรหมพิราม จ.พิษณุโลก',
        startDate: '2026-02-10', finishDate: '2026-09-30',
        allocBudget: 24000000, signedValue: 23450300,
        status: 'signed_wip', delivery: 'in_progress',
        value: 23450300, debt: 11366800, net: 12083500, expectedReceive: '2026-07-25', signedAt: '2026-02-04',
        startNotice: '2026-02-15', timeStop: 15,
        periods: [
          { period: 1, pctPogStank: 50, pctPogDrink: 50, value: 11725150, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
          { period: 2, pctPogStank: 50, pctPogDrink: 50, value: 11725150, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
        ],
      },
      {
        id: id(), code: 'PP091-CRI', name: 'ก่อสร้างประปา ม.4 ต.ป่าก่อดำ อ.แม่ลาว จ.เชียงราย',
        startDate: '2026-03-01', finishDate: '2026-10-30',
        allocBudget: 19200000, signedValue: 18900000,
        status: 'signed_wip', delivery: 'in_progress',
        value: 18900000, debt: 6500000, net: 12400000, expectedReceive: '2026-08-18', signedAt: '2026-02-28',
        startNotice: '2026-03-08', timeStop: 0,
        periods: [
          { period: 1, pctPogStank: 100, pctPogDrink: 0, value: 9450000, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
          { period: 2, pctPogStank: 100, pctPogDrink: 0, value: 9450000, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
        ],
      },
      {
        id: id(), code: 'PP094-PYO', name: 'ระบบประปาหมู่บ้าน ต.ดอกคำใต้ จ.พะเยา',
        startDate: '2026-03-15', finishDate: '2026-11-15',
        allocBudget: 13400000, signedValue: 13105200,
        status: 'signed_wip', delivery: 'pending',
        value: 13105200, debt: 3240000, net: 9865200, expectedReceive: '2026-10-12', signedAt: '2026-03-08',
        startNotice: '2026-03-20', timeStop: 0,
        periods: [
          { period: 1, pctPogStank: 100, pctPogDrink: 0, value: 6552600, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
          { period: 2, pctPogStank: 100, pctPogDrink: 0, value: 6552600, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
        ],
      },
      {
        id: id(), code: 'PP097-SKW', name: 'ระบบส่งน้ำดิบ ต.บางพระ อ.ศรีราชา จ.ชลบุรี',
        startDate: '2026-04-01', finishDate: '2026-12-15',
        allocBudget: 19800000, signedValue: 19440000,
        status: 'signed_wip', delivery: 'in_progress',
        value: 19440000, debt: 9720000, net: 9720000, expectedReceive: '2026-11-05', signedAt: '2026-03-25',
        startNotice: '2026-04-05', timeStop: 0,
        periods: [
          { period: 1, pctPogStank: 50, pctPogDrink: 50, value: 9720000, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
          { period: 2, pctPogStank: 50, pctPogDrink: 50, value: 9720000, deliveryDate: null, inspectionDoc: null, payment: 0, summaryPayment: 0, paymentStatus: 'in_progress', receiveDate: null },
        ],
      },
      {
        id: id(), code: 'PP101-PTL', name: 'ปรับปรุงระบบประปา ต.เพชรเมืองทอง อ.เมือง จ.ปัตตานี',
        startDate: null, finishDate: null,
        allocBudget: 29000000, signedValue: 28740000,
        status: 'waiting_sign', delivery: 'awaiting',
        value: 28740000, debt: 13420000, net: 15320000, expectedReceive: '2026-10-30', signedAt: null,
        startNotice: null, timeStop: 0,
        periods: [],
      },
      {
        id: id(), code: 'PP103-NSN', name: 'ระบบประปาหมู่บ้าน ต.หนองสองห้อง จ.ขอนแก่น',
        startDate: null, finishDate: null,
        allocBudget: 19500000, signedValue: 19160000,
        status: 'waiting_sign', delivery: 'awaiting',
        value: 19160000, debt: 3229500, net: 15930500, expectedReceive: '2026-11-22', signedAt: null,
        startNotice: null, timeStop: 0,
        periods: [],
      },
    ],

    // ────────────────────────────────────────────────────────────────────────
    // RAW_IV_OUTSTANDING — ใบแจ้งหนี้คงค้าง (ราคามาจากระบบ)
    //   ข้อมูลโอนสิทธิ / ภาระหนี้ ดึงจาก projects.code โดยตรง (projectFinance ถูกลบไปแล้ว)
    // ────────────────────────────────────────────────────────────────────────
    invoices: [
      { id: id(), ivNo: 'IV2026-077', jobNo: 'PP064-STIIS', period: 1, invoiceDate: '2026-05-10', balance: 231525.00,
        status: 'paid', expectedReceive: '2026-05-15',
        contactName: 'คุณสมหญิง', contactPhone: '02-555-1234',
        followUps: [
          { date: '2026-05-12', note: 'ส่งเอกสารใบตรวจรับ', by: 'พี่นก' },
          { date: '2026-05-14', note: 'แจ้งโอนเงิน', by: 'พี่นก' },
        ],
        actualReceive: { date: '2026-05-15', amount: 231525, bankAccount: 'กรุงเทพ 123-4-56789-0', feeNote: '' },
      },
      { id: id(), ivNo: 'IV2026-076', jobNo: 'PP073-AYT', period: 2, invoiceDate: '2026-05-05', balance: 4200000.00,
        status: 'pending_inspection', expectedReceive: '2026-05-22',
        contactName: 'คุณสมชาย', contactPhone: '076-555-1100',
        followUps: [
          { date: '2026-05-12', note: 'ติดต่อขอใบตรวจรับ — ยังรอช่างประเมิน', by: 'พี่นก' },
        ],
        actualReceive: null,
      },
      { id: id(), ivNo: 'IV2026-075', jobNo: 'PP081-NKM', period: 3, invoiceDate: '2026-05-03', balance: 3500000.00,
        status: 'tracking', expectedReceive: '2026-05-28',
        contactName: 'คุณวีระ', contactPhone: '042-555-2200',
        followUps: [
          { date: '2026-05-10', note: 'เอกสารตรวจรับเรียบร้อย', by: 'พี่นก' },
          { date: '2026-05-15', note: 'รอเจ้าหน้าที่คลังตั้งจ่าย', by: 'พี่นก' },
        ],
        actualReceive: null,
      },
      { id: id(), ivNo: 'IV2026-074', jobNo: 'PP084-SKN', period: 1, invoiceDate: '2026-04-29', balance: 1850000.00,
        status: 'tracking', expectedReceive: '2026-06-04',
        contactName: 'คุณอมรา', contactPhone: '045-555-3300',
        followUps: [
          { date: '2026-05-05', note: 'ส่งใบตรวจรับ', by: 'พี่นก' },
          { date: '2026-05-13', note: 'ติดตามรอบที่ 1 — รอเซ็นเสนอ', by: 'พี่นก' },
        ],
        actualReceive: null,
      },
      { id: id(), ivNo: 'IV2026-073', jobNo: 'PP088-MTK', period: 2, invoiceDate: '2026-04-22', balance: 5400000.00,
        status: 'issue', expectedReceive: '2026-06-10',
        contactName: 'คุณสิงห์', contactPhone: '055-555-4400',
        followUps: [
          { date: '2026-04-30', note: 'ส่งเอกสารตรวจรับ', by: 'พี่นก' },
          { date: '2026-05-12', note: 'เอกสารคืน — ขอใบรับรองอุปกรณ์เพิ่ม', by: 'พี่นก' },
          { date: '2026-05-16', note: 'รอ Eng. ส่งใบรับรอง', by: 'พี่นก' },
        ],
        actualReceive: null,
      },
      { id: id(), ivNo: 'IV2026-072', jobNo: 'PP091-CRI', period: 1, invoiceDate: '2026-04-15', balance: 2380000.00,
        status: 'tracking', expectedReceive: '2026-06-18',
        contactName: 'คุณพิม', contactPhone: '053-555-5500',
        followUps: [],
        actualReceive: null,
      },
      { id: id(), ivNo: 'IV2026-071', jobNo: 'PP097-SKW', period: 4, invoiceDate: '2026-04-08', balance: 1900000.00,
        status: 'pending_inspection', expectedReceive: '2026-06-25',
        contactName: 'คุณสุดารัตน์', contactPhone: '038-555-6600',
        followUps: [],
        actualReceive: null,
      },
    ],

    // ── Forecast entries ────────────────────────────────────────────────────
    forecastEntries: [
      { id: id(), date: '2026-05-22', category: 'inflow_project', label: 'รับเงินงวด 2 — PP073-AYT', amount: 4200000.00, note: 'รอตรวจรับงาน' },
      { id: id(), date: '2026-05-26', category: 'outflow_proj',   label: 'จ่ายค่าวัสดุ Project PP088',  amount: -1800000.00, note: 'รอบโอน' },
      { id: id(), date: '2026-05-28', category: 'inflow_project', label: 'รับเงินงวด 3 — PP081-NKM',   amount: 3500000.00, note: 'ติดตามจาก อบต.' },
      { id: id(), date: '2026-05-30', category: 'inflow_loan',    label: 'เบิกสินเชื่อหมุนเวียน',         amount: 3200000.00, note: 'ทำเรื่องแล้ว' },
      { id: id(), date: '2026-05-31', category: 'outflow_fin',    label: 'ชำระดอกเบี้ยเงินกู้ประจำเดือน', amount: -3060000.00, note: '' },
      { id: id(), date: '2026-06-02', category: 'outflow_misc',   label: 'เงินเดือนพนักงาน + โบนัส',     amount: -3300000.00, note: '' },
    ],

    bankAccounts: [
      { id: id(), bankName: 'กรุงเทพ',     accountNo: '123-4-56789-0', accountName: 'WaterPOG Co., Ltd. (Main)',  type: 'ออมทรัพย์',   balance: 2454226.17,  asOf: '2026-05-18', note: 'บัญชีหลักเก็บเงินรับ' },
      { id: id(), bankName: 'กสิกรไทย',    accountNo: '987-6-54321-0', accountName: 'WaterPOG Co., Ltd. (OD)',    type: 'เดินสะพัด/OD',balance: -1200000.00, asOf: '2026-05-18', note: 'OD Limit 3,000,000' },
      { id: id(), bankName: 'ไทยพาณิชย์',  accountNo: '456-7-89012-3', accountName: 'WaterPOG Co., Ltd. (Payroll)', type: 'ออมทรัพย์',   balance: 470000.00,   asOf: '2026-05-18', note: 'เงินเดือน + ค่าใช้จ่ายเบ็ดเตล็ด' },
      { id: id(), bankName: 'กรุงไทย',     accountNo: '321-0-98765-4', accountName: 'WaterPOG Co., Ltd. (LC)',    type: 'L/C',         balance: 1200000.00,  asOf: '2026-05-18', note: 'ค้ำประกันโครงการ' },
    ],

    // ────────────────────────────────────────────────────────────────────────
    // DATA PV — Payment Voucher (รายการที่จ่ายเงินจริงแล้ว)
    //   เปลี่ยนจาก psNotes เดิม
    // ────────────────────────────────────────────────────────────────────────
    pvVouchers: [
      { id: id(), voucherNo: 'PV2026-101', paidDate: '2026-05-02', payee: 'บริษัท ท่อพีวีซีไทย จำกัด', amount: 850000,  category: 'วัสดุ',    paymentMethod: 'เช็ค',  bankAccount: 'กรุงเทพ 123-4-56789-0', reference: 'PO-2026-088 / PP088', note: '' },
      { id: id(), voucherNo: 'PV2026-102', paidDate: '2026-05-04', payee: 'หจก. รับเหมา ก.วิศวกรรม', amount: 1200000, category: 'รับเหมา',  paymentMethod: 'โอน',   bankAccount: 'กสิกรไทย 987-6-54321-0', reference: 'PP091 งวด 2', note: 'งานก่อสร้าง' },
      { id: id(), voucherNo: 'PV2026-103', paidDate: '2026-05-06', payee: 'การไฟฟ้าส่วนภูมิภาค',     amount: 48000,   category: 'สาธารณูปโภค', paymentMethod: 'โอน',   bankAccount: 'ไทยพาณิชย์ 456-7-89012-3', reference: 'PEA 05/2026', note: '' },
      { id: id(), voucherNo: 'PV2026-104', paidDate: '2026-05-08', payee: 'ธ.กรุงเทพ (ดอกเบี้ย PS2026-014)', amount: 22500, category: 'การเงิน', paymentMethod: 'หักบัญชี', bankAccount: 'กรุงเทพ 123-4-56789-0', reference: 'PS2026-014', note: 'ดอกเบี้ยเดือน พ.ค.' },
      { id: id(), voucherNo: 'PV2026-105', paidDate: '2026-05-10', payee: 'สำนักงานบัญชี เอกชน จำกัด', amount: 35000, category: 'บริการ', paymentMethod: 'โอน', bankAccount: 'กรุงเทพ 123-4-56789-0', reference: '', note: 'ค่าบัญชี' },
      { id: id(), voucherNo: 'PV2026-106', paidDate: '2026-05-13', payee: 'บริษัท ขนส่งยูไนเต็ด จำกัด', amount: 95000, category: 'ขนส่ง', paymentMethod: 'เช็ค', bankAccount: 'กรุงเทพ 123-4-56789-0', reference: '', note: '' },
      { id: id(), voucherNo: 'PV2026-107', paidDate: '2026-05-15', payee: 'เงินเดือนพนักงาน', amount: 2850000, category: 'เงินเดือน', paymentMethod: 'โอน', bankAccount: 'ไทยพาณิชย์ 456-7-89012-3', reference: 'Payroll 05/2026', note: '' },
    ],

    payables: [
      { id: id(), creditorName: 'บริษัท ท่อพีวีซีไทย จำกัด',    invoiceNo: 'PV2026-1024', amount: 850000.00,  dueDate: '2026-05-25', category: 'วัสดุ',       status: 'pending',  note: 'ค่าท่อ PP088' },
      { id: id(), creditorName: 'หจก. รับเหมา ก.วิศวกรรม',     invoiceNo: 'KW2026-088',  amount: 1200000.00, dueDate: '2026-05-30', category: 'รับเหมา',     status: 'pending',  note: 'งานก่อสร้าง PP091' },
      { id: id(), creditorName: 'บริษัท ขนส่งยูไนเต็ด จำกัด',   invoiceNo: 'UC2026-512',  amount: 95000.00,   dueDate: '2026-05-22', category: 'ขนส่ง',      status: 'overdue',  note: 'ค่าขนส่งสะสม' },
      { id: id(), creditorName: 'การไฟฟ้าส่วนภูมิภาค',         invoiceNo: 'PEA2026-05', amount: 48000.00,   dueDate: '2026-05-31', category: 'สาธารณูปโภค', status: 'pending',  note: '' },
      { id: id(), creditorName: 'บริษัท นาคา ปั๊มน้ำ จำกัด',      invoiceNo: 'NK2026-302',  amount: 540000.00,  dueDate: '2026-06-10', category: 'วัสดุ',       status: 'pending',  note: 'ปั๊มน้ำ + อะไหล่' },
      { id: id(), creditorName: 'สำนักงานบัญชี เอกชน จำกัด',   invoiceNo: 'AC2026-05',  amount: 35000.00,   dueDate: '2026-05-20', category: 'บริการ',      status: 'paid',     note: 'ค่าบัญชีเดือน พ.ค.' },
    ],

    // ────────────────────────────────────────────────────────────────────────
    // DEBT LEDGER — ภาระหนี้ทั้งหมด
    //   debtType: transfer_rights | od | pn | term_loan | internal | lc
    //   interestBasis: per_annum | per_month | fee_pct
    //   status: active | pending_approval | closed | overdue
    //   ดอกเบี้ยค้างคำนวณ real-time ผ่าน WTPData.calcInterest(record, asOfDate)
    // ────────────────────────────────────────────────────────────────────────
    debtLedger: [
      // ── โอนสิทธิรับเงิน (Transfer of Rights) — linked กับโครงการ ─────
      { id: id(), debtNo: 'DL-TR-001', debtType: 'transfer_rights', linkedProjectCode: 'PP073-AYT',
        bankName: 'ธ.กสิกรไทย', accountRef: 'OD สาขาสีลม',
        principalAmount: 4200000, drawdownDate: '2026-03-15', maturityDate: '2026-07-01',
        interestRate: 7.5, interestBasis: 'per_annum',
        outstandingBalance: 4200000, collateral: 'โอนสิทธิรับเงินโครงการ PP073',
        status: 'active', note: 'โอนสิทธิเข้า OD วงเงิน 5M' },
      { id: id(), debtNo: 'DL-TR-002', debtType: 'transfer_rights', linkedProjectCode: 'PP081-NKM',
        bankName: 'ธ.กรุงเทพ', accountRef: 'PN PS2026-014',
        principalAmount: 3500000, drawdownDate: '2026-04-01', maturityDate: '2026-08-30',
        interestRate: 6.75, interestBasis: 'per_annum',
        outstandingBalance: 3500000, collateral: 'โอนสิทธิรับเงินโครงการ PP081',
        status: 'active', note: 'PN ฉบับที่ PS2026-014' },
      { id: id(), debtNo: 'DL-TR-003', debtType: 'transfer_rights', linkedProjectCode: 'PP088-MTK',
        bankName: 'ธ.ไทยพาณิชย์', accountRef: 'PN PS2026-016',
        principalAmount: 11366800, drawdownDate: '2026-03-01', maturityDate: '2026-09-30',
        interestRate: 7.25, interestBasis: 'per_annum',
        outstandingBalance: 11366800, collateral: 'โอนสิทธิรับเงินโครงการ PP088',
        status: 'active', note: 'PN ฉบับที่ PS2026-016' },
      { id: id(), debtNo: 'DL-TR-004', debtType: 'transfer_rights', linkedProjectCode: 'PP091-CRI',
        bankName: 'ธ.กสิกรไทย', accountRef: 'สินเชื่อโครงการ',
        principalAmount: 6500000, drawdownDate: '2026-04-15', maturityDate: '2026-09-30',
        interestRate: 7.5, interestBasis: 'per_annum',
        outstandingBalance: 6500000, collateral: 'โอนสิทธิรับเงินโครงการ PP091',
        status: 'active', note: '' },
      { id: id(), debtNo: 'DL-TR-005', debtType: 'transfer_rights', linkedProjectCode: 'PP094-PYO',
        bankName: 'ธ.กรุงไทย', accountRef: 'สินเชื่อโครงการ',
        principalAmount: 3240000, drawdownDate: '2026-04-20', maturityDate: '2026-10-15',
        interestRate: 6.5, interestBasis: 'per_annum',
        outstandingBalance: 3240000, collateral: 'โอนสิทธิรับเงินโครงการ PP094',
        status: 'active', note: '' },
      { id: id(), debtNo: 'DL-TR-006', debtType: 'transfer_rights', linkedProjectCode: 'PP097-SKW',
        bankName: 'ธ.กรุงเทพ', accountRef: 'L/C ค้ำประกัน',
        principalAmount: 9720000, drawdownDate: '2026-04-05', maturityDate: '2026-11-05',
        interestRate: 7.0, interestBasis: 'per_annum',
        outstandingBalance: 9720000, collateral: 'L/C ค้ำประกันโครงการ PP097',
        status: 'active', note: 'L/C ค้ำ' },
      { id: id(), debtNo: 'DL-TR-007', debtType: 'transfer_rights', linkedProjectCode: 'PP101-PTL',
        bankName: 'ธ.กสิกรไทย', accountRef: 'รออนุมัติ',
        principalAmount: 13420000, drawdownDate: null, maturityDate: null,
        interestRate: 7.5, interestBasis: 'per_annum',
        outstandingBalance: 13420000, collateral: 'โอนสิทธิรับเงินโครงการ PP101',
        status: 'pending_approval', note: 'รออนุมัติสินเชื่อ' },
      // ── สินเชื่อภายใน (Internal) — linked กับโครงการ ──────────────────
      { id: id(), debtNo: 'DL-IN-001', debtType: 'internal', linkedProjectCode: 'PP084-SKN',
        bankName: '—', accountRef: 'สินเชื่อภายใน',
        principalAmount: 1800000, drawdownDate: '2026-02-01', maturityDate: '2026-08-30',
        interestRate: 5.0, interestBasis: 'per_annum',
        outstandingBalance: 1800000, collateral: '—',
        status: 'active', note: 'กู้ภายใน บจก.' },
      { id: id(), debtNo: 'DL-IN-002', debtType: 'internal', linkedProjectCode: 'PP103-NSN',
        bankName: '—', accountRef: 'สินเชื่อภายใน',
        principalAmount: 3229500, drawdownDate: '2026-02-15', maturityDate: '2026-11-22',
        interestRate: 5.0, interestBasis: 'per_annum',
        outstandingBalance: 3229500, collateral: '—',
        status: 'active', note: 'กู้ภายใน บจก.' },
      // ── เงินกู้ OD / PN Standalone — ไม่ tied กับโครงการเดียว ─────────
      { id: id(), debtNo: 'DL-OD-001', debtType: 'od', linkedProjectCode: null,
        bankName: 'ธ.กสิกรไทย', accountRef: '987-6-54321-0 (วงเงิน 3M)',
        principalAmount: 3000000, drawdownDate: '2025-07-01', maturityDate: '2026-06-30',
        interestRate: 7.875, interestBasis: 'per_annum',
        outstandingBalance: 1200000, collateral: 'สินทรัพย์บริษัท',
        status: 'active', note: 'OD วงเงิน 3,000,000 — ใช้ไป 1,200,000' },
      { id: id(), debtNo: 'DL-PN-001', debtType: 'pn', linkedProjectCode: null,
        bankName: 'ธ.กรุงเทพ', accountRef: 'PN-BGK-2025-011',
        principalAmount: 15000000, drawdownDate: '2025-10-01', maturityDate: '2026-09-30',
        interestRate: 6.5, interestBasis: 'per_annum',
        outstandingBalance: 15000000, collateral: 'ที่ดิน + สิทธิรับเงินรวม',
        status: 'active', note: 'PN สายทุน ต่ออายุทุก 12 เดือน' },
      { id: id(), debtNo: 'DL-PN-002', debtType: 'pn', linkedProjectCode: null,
        bankName: 'ธ.ไทยพาณิชย์', accountRef: 'PN-SCB-2026-003',
        principalAmount: 12000000, drawdownDate: '2026-01-15', maturityDate: '2026-07-15',
        interestRate: 7.0, interestBasis: 'per_annum',
        outstandingBalance: 11321800, collateral: 'สิทธิรับเงินโครงการ + ที่ดิน',
        status: 'active', note: 'PN หมุนเวียน 6 เดือน' },
      // รวม outstandingBalance: 84,498,100 ตรงกับ pipeline.totalDebt
    ],

    // ────────────────────────────────────────────────────────────────────────
    // RECEIPTS — ประวัติรับเงิน (invoices ที่รับชำระแล้ว)
    //   grossAmount       = ยอดตามใบแจ้งหนี้
    //   transferDeduction = ยอดที่ธนาคารหัก (เนื่องจากโอนสิทธิ)
    //   netReceived       = เงินที่ WTP ได้รับจริง (gross − deduction)
    //   ผลรวมแต่ละเดือน match ytdRevenue gross/debt/net
    // ────────────────────────────────────────────────────────────────────────
    receipts: [
      // ── มกราคม 2569 (gross 35,644,984.34 / transfer 0 / net 35,644,984.34) ─
      { id: id(), receiptNo: 'RC2026-001', receiptDate: '2026-01-05',
        invoiceNo: 'IV2026-001', projectCode: 'PP041-KKN', projectName: 'ระบบประปา ต.โคกเคียน อ.เมือง จ.นราธิวาส', period: 2,
        grossAmount: 9000000, transferDeduction: 0, netReceived: 9000000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: '' },
      { id: id(), receiptNo: 'RC2026-002', receiptDate: '2026-01-10',
        invoiceNo: 'IV2026-005', projectCode: 'PP043-CMI', projectName: 'ก่อสร้างประปา ต.ช้างเผือก อ.เมือง จ.เชียงใหม่', period: 1,
        grossAmount: 8644984.34, transferDeduction: 0, netReceived: 8644984.34, bankAccount: 'กรุงเทพ 123-4-56789-0', note: '' },
      { id: id(), receiptNo: 'RC2026-003', receiptDate: '2026-01-15',
        invoiceNo: 'IV2026-010', projectCode: 'PP081-NKM', projectName: 'ระบบประปา ต.นาคำ อ.เมือง จ.หนองคาย', period: 1,
        grossAmount: 3750000, transferDeduction: 0, netReceived: 3750000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'งวด 1 — ยังไม่โอนสิทธิ ณ ขณะรับเงิน' },
      { id: id(), receiptNo: 'RC2026-004', receiptDate: '2026-01-22',
        invoiceNo: 'IV2026-015', projectCode: 'PP046-PCB', projectName: 'ระบบส่งน้ำ ต.พระชนก อ.บางระกำ จ.พิษณุโลก', period: 2,
        grossAmount: 7500000, transferDeduction: 0, netReceived: 7500000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: '' },
      { id: id(), receiptNo: 'RC2026-005', receiptDate: '2026-01-28',
        invoiceNo: 'IV2026-020', projectCode: 'PP048-TRT', projectName: 'ปรับปรุงระบบประปา ต.ท่าโรง อ.วิเชียรบุรี จ.เพชรบูรณ์', period: 1,
        grossAmount: 6750000, transferDeduction: 0, netReceived: 6750000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: '' },
      // ── กุมภาพันธ์ 2569 (gross 26,170,400 / transfer 8,898,400 / net 17,272,000) ─
      { id: id(), receiptNo: 'RC2026-006', receiptDate: '2026-02-05',
        invoiceNo: 'IV2026-022', projectCode: 'PP050-MKN', projectName: 'ระบบประปาหมู่บ้าน ต.โมกข์ อ.บ้านนา จ.นครนายก', period: 2,
        grossAmount: 6500000, transferDeduction: 2000000, netReceived: 4500000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.กรุงเทพ' },
      { id: id(), receiptNo: 'RC2026-007', receiptDate: '2026-02-12',
        invoiceNo: 'IV2026-025', projectCode: 'PP052-SBR', projectName: 'ก่อสร้างประปา ต.สิบเอ็ด อ.บ้านแพ้ว จ.สมุทรสาคร', period: 1,
        grossAmount: 9120400, transferDeduction: 4898400, netReceived: 4222000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.กสิกรไทย' },
      { id: id(), receiptNo: 'RC2026-008', receiptDate: '2026-02-19',
        invoiceNo: 'IV2026-028', projectCode: 'PP054-NKB', projectName: 'ระบบส่งน้ำดิบ ต.นิคมบ้าน อ.นาทวี จ.สงขลา', period: 2,
        grossAmount: 5050000, transferDeduction: 2000000, netReceived: 3050000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.ไทยพาณิชย์' },
      { id: id(), receiptNo: 'RC2026-009', receiptDate: '2026-02-26',
        invoiceNo: 'IV2026-031', projectCode: 'PP056-RNG', projectName: 'ปรับปรุงท่อน้ำ ต.ระนอง อ.เมือง จ.ระนอง', period: 1,
        grossAmount: 5500000, transferDeduction: 0, netReceived: 5500000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: '' },
      // ── มีนาคม 2569 (gross 32,846,184.32 / transfer 13,363,100 / net 19,483,084.32) ─
      { id: id(), receiptNo: 'RC2026-010', receiptDate: '2026-03-04',
        invoiceNo: 'IV2026-035', projectCode: 'PP058-LPG', projectName: 'ระบบประปา ต.ลำปาง อ.เมือง จ.ลำปาง', period: 2,
        grossAmount: 8346184.32, transferDeduction: 3863100, netReceived: 4483084.32, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.กรุงไทย' },
      { id: id(), receiptNo: 'RC2026-011', receiptDate: '2026-03-12',
        invoiceNo: 'IV2026-038', projectCode: 'PP060-SKN', projectName: 'ก่อสร้างประปาหมู่บ้าน ต.สักงาม อ.คลองลาน จ.กำแพงเพชร', period: 1,
        grossAmount: 9500000, transferDeduction: 5500000, netReceived: 4000000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.กสิกรไทย' },
      { id: id(), receiptNo: 'RC2026-012', receiptDate: '2026-03-22',
        invoiceNo: 'IV2026-041', projectCode: 'PP062-PTY', projectName: 'ระบบส่งน้ำ ต.พัทยา อ.บางละมุง จ.ชลบุรี', period: 3,
        grossAmount: 9750000, transferDeduction: 4000000, netReceived: 5750000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.ไทยพาณิชย์' },
      { id: id(), receiptNo: 'RC2026-013', receiptDate: '2026-03-28',
        invoiceNo: 'IV2026-044', projectCode: 'PP081-NKM', projectName: 'ระบบประปา ต.นาคำ อ.เมือง จ.หนองคาย', period: 2,
        grossAmount: 5250000, transferDeduction: 0, netReceived: 5250000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'งวด 2 — สิทธิโอนเข้าแล้ว แต่หักที่งวด 3' },
      // ── เมษายน 2569 (gross 42,952,000 / transfer 8,818,806.05 / net 34,133,193.95) ─
      { id: id(), receiptNo: 'RC2026-014', receiptDate: '2026-04-02',
        invoiceNo: 'IV2026-048', projectCode: 'PP073-AYT', projectName: 'อาคารสำนักงาน เทศบาลตำบลอ่าวยาง จ.พังงา', period: 1,
        grossAmount: 9450000, transferDeduction: 3818806.05, netReceived: 5631193.95, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.กสิกรไทย งวด 1' },
      { id: id(), receiptNo: 'RC2026-015', receiptDate: '2026-04-08',
        invoiceNo: 'IV2026-052', projectCode: 'PP066-STL', projectName: 'ระบบประปา ต.สตึก อ.สตึก จ.บุรีรัมย์', period: 2,
        grossAmount: 7200000, transferDeduction: 0, netReceived: 7200000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: '' },
      { id: id(), receiptNo: 'RC2026-016', receiptDate: '2026-04-14',
        invoiceNo: 'IV2026-056', projectCode: 'PP068-PMB', projectName: 'ปรับปรุงระบบประปา ต.พิมาย อ.พิมาย จ.นครราชสีมา', period: 1,
        grossAmount: 8502000, transferDeduction: 2500000, netReceived: 6002000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.กสิกรไทย' },
      { id: id(), receiptNo: 'RC2026-017', receiptDate: '2026-04-21',
        invoiceNo: 'IV2026-060', projectCode: 'PP070-YST', projectName: 'ก่อสร้างประปา ต.ยะรัง อ.ยะรัง จ.ปัตตานี', period: 2,
        grossAmount: 9800000, transferDeduction: 0, netReceived: 9800000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: '' },
      { id: id(), receiptNo: 'RC2026-018', receiptDate: '2026-04-28',
        invoiceNo: 'IV2026-064', projectCode: 'PP072-CMB', projectName: 'ระบบส่งน้ำ ต.ชะอม อ.แก่งคอย จ.สระบุรี', period: 3,
        grossAmount: 8000000, transferDeduction: 2500000, netReceived: 5500000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.กรุงเทพ' },
      // ── พฤษภาคม 2569 (gross 10,814,000 / transfer 5,963,196.05 / net 4,850,803.95) ─
      { id: id(), receiptNo: 'RC2026-019', receiptDate: '2026-05-03',
        invoiceNo: 'IV2026-068', projectCode: 'PP074-CPN', projectName: 'ระบบประปาหมู่บ้าน ต.โชคชัย อ.โชคชัย จ.นครราชสีมา', period: 1,
        grossAmount: 4200000, transferDeduction: 2500000, netReceived: 1700000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.ไทยพาณิชย์' },
      { id: id(), receiptNo: 'RC2026-020', receiptDate: '2026-05-08',
        invoiceNo: 'IV2026-070', projectCode: 'PP076-NPN', projectName: 'ก่อสร้างประปา ต.นิพนธ์ อ.บ้านแพ้ว จ.สมุทรสาคร', period: 2,
        grossAmount: 3850475, transferDeduction: 1963196.05, netReceived: 1887278.95, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.กสิกรไทย' },
      { id: id(), receiptNo: 'RC2026-021', receiptDate: '2026-05-12',
        invoiceNo: 'IV2026-073', projectCode: 'PP078-CHR', projectName: 'ปรับปรุงท่อน้ำ ต.ชะอวด อ.ชะอวด จ.นครศรีธรรมราช', period: 1,
        grossAmount: 2532000, transferDeduction: 1500000, netReceived: 1032000, bankAccount: 'กรุงเทพ 123-4-56789-0', note: 'หักโอนสิทธิ ธ.กรุงเทพ' },
      { id: id(), receiptNo: 'RC2026-022', receiptDate: '2026-05-15',
        invoiceNo: 'IV2026-077', projectCode: 'PP064-STIIS', projectName: 'บ้านพรุกง ม.2 ต.วังใหญ่ อ.เทพา จ.สงขลา', period: 1,
        grossAmount: 231525, transferDeduction: 0, netReceived: 231525, bankAccount: 'กรุงเทพ 123-4-56789-0', note: '' },
    ],

    // ────────────────────────────────────────────────────────────────────────
    // BANK ENTRIES — แผนการเงินต่อบัญชี (inflow + outflow + inter-transfer)
    //   type: inflow_project | inflow_loan | inflow_transfer |
    //         outflow_check | outflow_salary | outflow_loan_interest |
    //         outflow_transfer | outflow_misc
    //   transferRef: ID ร่วมสำหรับ paired inter-account transfer
    //   status: confirmed | estimate | planned | completed
    // ────────────────────────────────────────────────────────────────────────
    // กระทบยอดธนาคาร — sync แท็บแยก (statement lines + สถานะการกระทบ)
    bankReconLines: [],
    bankReconState: [],
    presence: [],   // ใครออนไลน์อยู่ (heartbeat) — อ่านจากแท็บ presence
    bankEntries: [
      // ── กรุงเทพ 123-4-56789-0 (Main) ────────────────────────────────────
      { id: id(), entryDate: '2026-05-25', bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', entryType: 'outflow_check',
        description: 'ค.ชจ.ชำระ ท่อพีวีซีไทย (PO-2026-088)', amount: -350000, referenceNo: 'CHQ-2026-001', transferRef: null, linkedProjectCode: 'PP088-MTK', status: 'confirmed', note: '' },
      { id: id(), entryDate: '2026-05-25', bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', entryType: 'outflow_check',
        description: 'ค.ชจ.รับเหมา ก.วิศวกรรม PP091', amount: -1200000, referenceNo: 'CHQ-2026-002', transferRef: null, linkedProjectCode: 'PP091-CRI', status: 'confirmed', note: '' },
      { id: id(), entryDate: '2026-05-29', bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', entryType: 'outflow_transfer',
        description: 'โอนให้ ไทยพาณิชย์ (เงินเดือน พ.ค.)', amount: -3000000, referenceNo: 'TRF-2026-001', transferRef: 'TRF-2026-001', linkedProjectCode: null, status: 'planned', note: 'โอนเพื่อเตรียมจ่ายเงินเดือน' },
      { id: id(), entryDate: '2026-05-30', bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', entryType: 'inflow_loan',
        description: 'เบิกสินเชื่อหมุนเวียน PN-BGK-2025-011', amount: 3200000, referenceNo: 'PN-BGK-2025-011', transferRef: null, linkedProjectCode: null, status: 'planned', note: '' },
      { id: id(), entryDate: '2026-05-31', bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', entryType: 'outflow_loan_interest',
        description: 'ดอกเบี้ย PN-BGK-2025-011 (เดือน พ.ค.)', amount: -81250, referenceNo: 'INT-BGK-0526', transferRef: null, linkedProjectCode: null, status: 'planned', note: '' },
      { id: id(), entryDate: '2026-05-31', bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', entryType: 'outflow_check',
        description: 'ค.ชจ.เจ้าหนี้รอบสิ้นเดือน พ.ค.', amount: -2500000, referenceNo: 'CHQ-2026-004', transferRef: null, linkedProjectCode: null, status: 'planned', note: '' },
      { id: id(), entryDate: '2026-06-05', bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', entryType: 'outflow_misc',
        description: 'ค.ชจ.นาคาปั๊มน้ำ + ขนส่งยูไนเต็ด', amount: -635000, referenceNo: 'CHQ-2026-006', transferRef: null, linkedProjectCode: null, status: 'planned', note: '' },
      // ── ไทยพาณิชย์ 456-7-89012-3 (Payroll) ──────────────────────────────
      { id: id(), entryDate: '2026-05-29', bankName: 'ไทยพาณิชย์', accountNo: '456-7-89012-3', entryType: 'inflow_transfer',
        description: 'รับโอนจาก กรุงเทพ (เงินเดือน พ.ค.)', amount: 3000000, referenceNo: 'TRF-2026-001', transferRef: 'TRF-2026-001', linkedProjectCode: null, status: 'planned', note: 'คู่ TRF-2026-001' },
      { id: id(), entryDate: '2026-05-30', bankName: 'ไทยพาณิชย์', accountNo: '456-7-89012-3', entryType: 'outflow_salary',
        description: 'เงินเดือนพนักงาน Payroll 05/2026', amount: -2850000, referenceNo: 'PAYROLL-0526', transferRef: null, linkedProjectCode: null, status: 'planned', note: '' },
      // ── กสิกรไทย 987-6-54321-0 (OD) ─────────────────────────────────────
      { id: id(), entryDate: '2026-05-31', bankName: 'กสิกรไทย', accountNo: '987-6-54321-0', entryType: 'outflow_loan_interest',
        description: 'ดอกเบี้ย OD เดือน พ.ค. (7.875%/pa)', amount: -7875, referenceNo: 'INT-KSK-0526', transferRef: null, linkedProjectCode: null, status: 'planned', note: '' },
      { id: id(), entryDate: '2026-06-30', bankName: 'กสิกรไทย', accountNo: '987-6-54321-0', entryType: 'outflow_check',
        description: 'ชำระ OD บางส่วน', amount: -500000, referenceNo: 'CHQ-2026-009', transferRef: null, linkedProjectCode: null, status: 'planned', note: '' },
    ],

    // ────────────────────────────────────────────────────────────────────────
    // CHECKS — เช็คจ่ายล่วงหน้า / เช็คค้างจ่าย
    //   status: pending | clearing | cleared | cancelled
    // ────────────────────────────────────────────────────────────────────────
    checks: [
      { id: id(), checkNo: 'CHQ-2026-001', checkDate: '2026-05-25', payee: 'บริษัท ท่อพีวีซีไทย จำกัด',
        amount: 350000, bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', status: 'clearing', referenceNo: 'PO-2026-088', linkedProjectCode: 'PP088-MTK', note: 'ค่าท่อ PP088' },
      { id: id(), checkNo: 'CHQ-2026-002', checkDate: '2026-05-25', payee: 'หจก. รับเหมา ก.วิศวกรรม',
        amount: 1200000, bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', status: 'pending', referenceNo: 'AP-PP091', linkedProjectCode: 'PP091-CRI', note: 'งานก่อสร้าง PP091' },
      { id: id(), checkNo: 'CHQ-2026-003', checkDate: '2026-05-31', payee: 'ธ.กรุงเทพ ดอกเบี้ย PN',
        amount: 81250, bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', status: 'pending', referenceNo: 'PN-BGK-011', linkedProjectCode: null, note: 'ดอกเบี้ย PN-BGK-2025-011' },
      { id: id(), checkNo: 'CHQ-2026-004', checkDate: '2026-05-31', payee: 'AP รอบสิ้นเดือน (รวม)',
        amount: 2500000, bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', status: 'pending', referenceNo: 'AP-MAY31', linkedProjectCode: null, note: 'รวมค่าใช้จ่าย AP' },
      { id: id(), checkNo: 'CHQ-2026-005', checkDate: '2026-05-31', payee: 'ธ.กสิกรไทย ดอกเบี้ย OD',
        amount: 7875, bankName: 'กสิกรไทย', accountNo: '987-6-54321-0', status: 'pending', referenceNo: 'OD-KSK-001', linkedProjectCode: null, note: 'ดอกเบี้ย OD พ.ค.' },
      { id: id(), checkNo: 'CHQ-2026-006', checkDate: '2026-06-05', payee: 'บริษัท นาคาปั๊มน้ำ จำกัด',
        amount: 540000, bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', status: 'pending', referenceNo: 'PO-2026-096', linkedProjectCode: 'PP094-PYO', note: 'ค่าปั๊มน้ำ PP094' },
      { id: id(), checkNo: 'CHQ-2026-007', checkDate: '2026-06-05', payee: 'บริษัท ขนส่งยูไนเต็ด จำกัด',
        amount: 95000, bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', status: 'pending', referenceNo: 'TR-2026-033', linkedProjectCode: 'PP088-MTK', note: 'ค่าขนส่งวัสดุ' },
      { id: id(), checkNo: 'CHQ-2026-008', checkDate: '2026-05-06', payee: 'การไฟฟ้าส่วนภูมิภาค',
        amount: 48000, bankName: 'ไทยพาณิชย์', accountNo: '456-7-89012-3', status: 'cleared', referenceNo: 'PEA-0526', linkedProjectCode: null, note: 'ค่าไฟ พ.ค.' },
      { id: id(), checkNo: 'CHQ-2026-009', checkDate: '2026-05-10', payee: 'บัญชีเอกชน (สำรองจ่าย)',
        amount: 35000, bankName: 'กรุงเทพ', accountNo: '123-4-56789-0', status: 'cleared', referenceNo: 'MISC-010', linkedProjectCode: null, note: 'เงินสำรองจ่าย' },
    ],
  });

  // CRUD entities ที่ sync กับ Sheet — ใน "online mode" (ตั้ง SHEET_ID แล้ว) ห้ามใช้
  // seed mock เป็นค่าตั้งต้น เพราะ mock อาจหลุดขึ้น push ทับข้อมูลจริงบนชีต (seed-wipe).
  // ปล่อยเป็น [] แล้วรอ data_sync ดึงของจริงมาแทน. (offline = ไม่มี SHEET_ID → ใช้ mock ได้)
  const CRUD_KEYS = ['projects','invoices','forecastEntries','bankAccounts','pvVouchers',
    'payables','debtLedger','receipts','bankEntries','checks','debtMaster','bankTransfers',
    'stsServiceFee','stsPendingCalc','stsCalcResult','debtEvents','users',
    'cashflowSnapshots','followUpsLog','manualOverrides',
    'bankReconLines','bankReconState','presence'];
  const isOnline = () => !!(window.WTP_CONFIG && window.WTP_CONFIG.SHEET_ID);
  // ค่าตั้งต้นเมื่อ localStorage ว่าง:
  //   offline → seed mock เต็ม (โหมดสาธิต)
  //   online  → โครงสร้าง seed แต่ CRUD ทุกตัว = [] (กัน mock ขึ้น push ทับชีต)
  function freshState() {
    const s = seed();
    if (isOnline()) CRUD_KEYS.forEach(function (k) { s[k] = []; });
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      const loaded = JSON.parse(raw);
      /* Auto-merge any new top-level keys (e.g. debtLedger, receipts, bankEntries
         added after this user's localStorage was first written) so older sessions don't break.
         ★ online: คีย์ CRUD ที่ขาด/null เติมเป็น [] (ไม่ใช่ mock) กัน seed หลุด push ทับชีต */
      const fresh = freshState();
      Object.keys(fresh).forEach(function(k){
        if (!(k in loaded) || loaded[k] == null) loaded[k] = fresh[k];
      });
      return loaded;
    } catch (_) { return freshState(); }
  }
  // ── SKIP_CACHE_KEYS: entities ที่ไม่เก็บใน localStorage blob เพื่อลดขนาดจาก ~5.7MB → ~0.5MB
  // ★ ระยะสั้น:  debtLedger — 3964 rows ~2MB คือตัวหลักที่ดัน quota เกิน
  // ★ ระยะกลาง: projects / pvVouchers / bankReconLines / receipts / payables — server-sourced ทั้งหมด
  //   applyEntityGuard (build 20260615e) รองรับ local=[] → corruptLocal → recover จาก server
  //   ดังนั้นการ start ด้วย [] แล้วรอ poll ครั้งแรก (~2–5 วิ) ปลอดภัยและยอมรับได้
  // ★ projects: 648 rows × 120 cols ≈ 4–5MB เพียงตัวเดียวดัน blob เกิน quota แม้จะตัดตัวอื่นออกแล้ว
  //   Project Control มี wtp-proj-control-v2 เป็น cache แยก; หน้าอื่นรอ server poll (~5–10 วิ) ได้
  // ★ data_sync.js ต้องเช็ค WTPData.SKIP_CACHE_KEYS ก่อน storageBroken detection —
  //   keys เหล่านี้ [] ใน local โดย "ตั้งใจ" ไม่ใช่ storage เสีย
  const SKIP_CACHE_KEYS = new Set([
    'debtLedger',     // ระยะสั้น  — ~2MB (3964 rows)
    'projects',       // ★ ใหม่  — ~4–5MB (648 rows × 120 cols) ← ตัวการหลักที่ยังทำให้ blob เกิน
    'pvVouchers',     // ระยะกลาง — ~184KB (614 rows)
    'bankReconLines', // ระยะกลาง — varies, import-only; BankReconStore localStorage เป็น backup
    'receipts',       // ระยะกลาง — ~137KB (686 rows)
    'payables',       // ระยะกลาง — ~163KB (545 rows)
  ]);
  // ── localStorage write — เคยกลืน QuotaExceededError เงียบ → wedge loop:
  //   localStorage ค้างว่าง → load() คืน freshState ว่าง → diff บอก "ลบทั้งตาราง" →
  //   anti-wedge guard บล็อก + resync แต่ applyEntityGuard เห็น local=[] vs snap=full
  //   → hasPending=true → คง local ว่างไว้ → จอว่าง วน. ตอนนี้: log + dispatch event
  //   ครั้งแรกเมื่อเจอ (กัน spam) เพื่อให้รู้ว่าเครื่องนี้ localStorage เต็ม.
  let _quotaWarned = false;
  function save(data) {
    try {
      // ตัด SKIP_CACHE_KEYS ออกก่อน serialise — ลดขนาด blob ~2MB (ไม่กระทบ runtime state)
      // keys ที่ตัดออก: [] ตอน load → freshState merge → data_sync recover จาก server
      const toStore = {};
      Object.keys(data).forEach(function(k) {
        if (!SKIP_CACHE_KEYS.has(k)) toStore[k] = data[k];
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      if (_quotaWarned) {
        _quotaWarned = false;
        console.info('[WTPData] localStorage quota ปกติแล้ว — บันทึกสำเร็จ (blob ไม่รวม SKIP_CACHE_KEYS)');
      }
    } catch (e) {
      if (!_quotaWarned) {
        _quotaWarned = true;
        console.error('[WTPData] เขียน localStorage ล้มเหลว (น่าจะเกิน quota ~5–10MB) — ข้อมูลจะถูกดึงจากชีตทุก reload, ไม่ persist:', e && e.message);
        try { window.dispatchEvent(new CustomEvent('wtpStorageQuotaExceeded', { detail: { error: e && e.message } })); } catch (_) {}
      }
    }
  }
  function reset() { localStorage.removeItem(STORAGE_KEY); return seed(); }

  // Project status meta
  const STATUS_META = {
    waiting_sign: { label: 'รอลงนามสัญญา',         badge: 'b-amber',  short: 'รอลงนาม' },
    signed_wip:   { label: 'ลงนามแล้ว / ก่อสร้าง',  badge: 'b-violet', short: 'ก่อสร้าง' },
    invoiced:     { label: 'ออกใบแจ้งหนี้แล้ว',      badge: 'b-blue',   short: 'IV แล้ว' },
    paid:         { label: 'รับเงินแล้ว',             badge: 'b-green',  short: 'รับชำระ' },
  };
  const DELIVERY_META = {
    awaiting:    { label: 'รอเริ่มงาน',         badge: 'b-gray' },
    in_progress: { label: 'อยู่ระหว่างก่อสร้าง', badge: 'b-violet' },
    pending:     { label: 'รอส่งมอบงาน',       badge: 'b-amber' },
    delivered:   { label: 'ส่งมอบงานแล้ว',     badge: 'b-blue' },
    received:    { label: 'รับชำระแล้ว',        badge: 'b-green' },
  };
  // NEW: 4 IV statuses
  const IV_STATUS_META = {
    pending_inspection: { label: 'รอใบตรวจรับ',         badge: 'b-amber',  short: 'รอตรวจรับ' },
    tracking:           { label: 'อยู่ระหว่างติดตามเงิน', badge: 'b-blue',   short: 'ติดตาม' },
    issue:              { label: 'ติดปัญหา',              badge: 'b-red',    short: 'ติดปัญหา' },
    paid:               { label: 'รับชำระแล้ว',           badge: 'b-green',  short: 'รับชำระ' },
  };
  // Period payment status
  const PAY_STATUS_META = {
    in_progress:        { label: 'อยู่ระหว่างก่อสร้าง',   badge: 'b-gray' },
    pending_inspection: { label: 'รอใบตรวจรับ',          badge: 'b-amber' },
    tracking:           { label: 'อยู่ระหว่างติดตามเงิน', badge: 'b-blue' },
    issue:              { label: 'ติดปัญหา',              badge: 'b-red' },
    paid:               { label: 'รับชำระแล้ว',           badge: 'b-green' },
  };

  // Helpers for cross-source lookups
  const buildLookups = (data) => {
    // projectByCode: key ด้วย Project No. (เช่น PP064), Contract No., Ref.code, และ .code (เก่า)
    // เก็บทั้ง original + UPPERCASE เผื่อ jobNo จาก import ไม่ตรง case ของ sheet
    const projectByCode = {};
    const addKey = (k, p) => {
      if (!k) return;
      const ks = String(k).trim();
      if (!ks) return;
      if (!projectByCode[ks]) projectByCode[ks] = p;
      const up = ks.toUpperCase();
      if (up !== ks && !projectByCode[up]) projectByCode[up] = p;
    };
    (data.projects || []).forEach(p => {
      addKey(p['Contract No.'] || p.code, p);
      addKey(p['Ref.code'],   p);
      addKey(p['Project No.'], p);
    });

    // ── Build debt summary from debtLedger keyed by project code ─────────────
    // ยอมรับ field/status หลายแบบ + extract project code จากข้อความที่อาจมีชื่อโครงการพ่วงท้าย
    const debtByCode = {};
    (data.debtLedger || []).forEach(d => {
      // ── status check: skip ปิด/จ่ายแล้ว/ยกเลิก เท่านั้น (default = นับเข้า) ──
      const status = (d.status || '').toString().trim().toLowerCase();
      if (status === 'closed' || status === 'paid' || status === 'cancelled' || status === 'inactive') return;
      // ── หา project code field (รองรับหลายชื่อจาก sheet) ──
      const rawField = (d.projectCode || d.linkedProjectCode || d.project_code ||
                        d['Project Code'] || d['Project No.'] || d['รหัสโครงการ'] || d['โครงการ'] || '').toString().trim();
      if (!rawField) return;
      // ── extract just the code (e.g. "PP062 บ้านทองหลาง" → "PP062") ──
      const codeMatch = rawField.match(/^([A-Za-z]+-?\d+(?:-[A-Z]+)?)/);
      const rawCode   = codeMatch ? codeMatch[1] : rawField.split(/\s+/)[0];
      if (!rawCode) return;
      // ── strip product-type suffix: PP073-AYT → PP073 ──
      const m = rawCode.match(/^(.+)-([A-Z]{2,6})$/);
      const cleanCode = m ? m[1] : rawCode;
      // ── push to BOTH forms + ตัว uppercase ──
      const keys = new Set([cleanCode, rawCode, cleanCode.toUpperCase(), rawCode.toUpperCase()]);
      keys.forEach(k => {
        if (!k) return;
        if (!debtByCode[k]) debtByCode[k] = { totalDebt: 0, assignees: [], contracts: [] };
        const bal = Number(d.balance) || Number(d.outstandingBalance) || Number(d.principalAmount) || 0;
        debtByCode[k].totalDebt += bal;
        const bank = (d.bankName || d.assignee || d['ธนาคาร'] || d['ผู้รับโอนสิทธิ์'] || '').toString().trim();
        if (bank && debtByCode[k].assignees.indexOf(bank) < 0) {
          debtByCode[k].assignees.push(bank);
        }
        debtByCode[k].contracts.push(d);
      });
    });

    // ── financeByCode: project record + auto-resolved debt + assignee ─────────
    // Priority: project's own debt/assignee fields → fall back to debtLedger aggregate
    // Treat placeholders ('—', '-', '') as empty so they don't block the fallback
    const isEmptyVal = v => v == null || v === '' || v === '—' || v === '-';
    const financeByCode = {};
    Object.keys(projectByCode).forEach(k => {
      const p = projectByCode[k];
      const di = debtByCode[k] || {};
      const projectDebt    = Number(p.debt ?? p['ภาระหนี้']) || 0;
      const rawAssignee    = !isEmptyVal(p.assignee) ? p.assignee
                          : (!isEmptyVal(p['ผู้รับโอนสิทธิ์']) ? p['ผู้รับโอนสิทธิ์'] : '');
      const debtAssignees  = (di.assignees && di.assignees.length) ? di.assignees.join(', ') : '';
      financeByCode[k] = Object.assign({}, p, {
        debt:     projectDebt > 0 ? projectDebt : (di.totalDebt || 0),
        assignee: rawAssignee || debtAssignees,
        debtContracts: di.contracts || [],
      });
    });
    // Also include debt-only entries (projects in debtLedger but not in projects sheet)
    Object.keys(debtByCode).forEach(k => {
      if (financeByCode[k]) return;
      const di = debtByCode[k];
      financeByCode[k] = {
        debt:     di.totalDebt,
        assignee: (di.assignees || []).join(', '),
        debtContracts: di.contracts,
      };
    });
    return { projectByCode, financeByCode };
  };
  // คำนวณดอกเบี้ยค้างชำระ ณ วันที่กำหนด (ส่ง record จาก debtLedger)
  const calcInterest = (debt, asOfDate) => {
    if (!debt || !debt.interestRate || !debt.drawdownDate) return 0;
    if (debt.status !== 'active' && debt.status !== 'overdue') return 0;
    const days = daysBetween(debt.drawdownDate, asOfDate || new Date().toISOString().slice(0, 10));
    if (!days || days <= 0) return 0;
    const rate = debt.interestRate / 100;
    const bal  = debt.outstandingBalance || 0;
    if (debt.interestBasis === 'per_month') return Math.round(bal * rate * (days / 30.44));
    if (debt.interestBasis === 'fee_pct')   return Math.round((debt.principalAmount || bal) * rate * (days / 365));
    return Math.round(bal * rate * (days / 365)); // per_annum (default)
  };

  // ── ensureReceiptForPaidInvoice ──────────────────────────────────────
  // เมื่อ IV เปลี่ยน status เป็น 'paid' พร้อม actualReceive → ต้องมี row ใน receipts
  // มิฉะนั้น Warroom Section 01 (ที่อ่านจาก data.receipts) จะไม่นับใบนี้
  // ถ้ามี receipt ของ ivNo นี้อยู่แล้ว → อัปเดต. ถ้ายังไม่มี → สร้างใหม่
  const ensureReceiptForPaidInvoice = (receipts, iv) => {
    if (!iv || iv.status !== 'paid' || !iv.actualReceive || !iv.actualReceive.date) {
      return receipts;
    }
    const list   = receipts || [];
    const ivNo   = iv.ivNo;
    if (!ivNo) return list;
    const gross  = Number(iv.balance) || 0;
    const netRec = Number(iv.actualReceive.amount) || 0;
    // ส่วนต่าง = หักโอนสิทธิ์ (debt) ถ้า net < gross
    const deduct = gross > netRec ? (gross - netRec) : 0;
    const existing = list.find(r => r.invoiceNo === ivNo);
    if (existing) {
      // อัปเดต field สำคัญ (กัน user แก้วันรับ/ยอดใน popup)
      return list.map(r => r.invoiceNo === ivNo ? Object.assign({}, r, {
        receiptDate:       iv.actualReceive.date,
        grossAmount:       gross,
        transferDeduction: deduct,
        netReceived:       netRec,
        bankAccount:       iv.actualReceive.bankAccount || r.bankAccount || '',
      }) : r);
    }
    // ── สร้าง receipt ใหม่ ──
    // gen receiptNo แบบ AR{yy}{mm}-{seq} ถ้าไม่มี — ป้องกัน duplicate ด้วย ivNo
    const d = new Date(iv.actualReceive.date + 'T00:00:00');
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const seq = String(list.length + 1).padStart(3, '0');
    const newReceipt = {
      // ★ id = DETERMINISTIC ('rcp-'+ivNo) ไม่ใช่ id() สุ่ม — กัน "receipt ซ้ำ" ตอน 2 เครื่อง/
      //   2 รอบ รัน backfill นี้พร้อมกัน โดยยังไม่เห็น receipt ของกันและกันใน list (sync race /
      //   ตอน migrate): เดิม mint id() ใหม่ทุกครั้ง → คนละ id = คนละแถว (PK=id) อยู่รอดทั้งคู่ →
      //   ยอด "รับเงิน" เบิ้ล. ตอนนี้ทั้ง 2 รอบได้ id เดียวกัน → upsert ทับเป็นแถวเดียว. (find-by-
      //   invoiceNo ด้านบนยังจับ receipt ที่มาจาก import/id เดิมได้ตามปกติ — เคสนี้ครอบเฉพาะ "สร้างใหม่")
      id:                'rcp-' + ivNo,
      receiptNo:         `AR${yy}${mm}-${seq}`,
      receiptDate:       iv.actualReceive.date,
      invoiceNo:         ivNo,
      projectCode:       iv.jobNo || iv.projectCode || '',
      projectName:       iv.projectName || '',
      period:            iv.period || 1,
      grossAmount:       gross,
      transferDeduction: deduct,
      netReceived:       netRec,
      bankAccount:       iv.actualReceive.bankAccount || '',
      note:              'auto-generated เมื่อ mark IV เป็น paid',
    };
    return [newReceipt, ...list];
  };

  // ── markInvoicesPaidFromReceipts (ทางกลับของ ensureReceiptForPaidInvoice) ──────
  // receipt = เงินเข้าจริง (จากบัญชี/ระบบบัญชี) = "ความจริงหลัก". ถ้ามี receipt ของใบ IV ใด
  // แต่ใบนั้น "ยังไม่ถูก mark paid" (หรือ paid แต่ actualReceive.date ว่าง) → เติมให้:
  //   status='paid' + actualReceive.{date,amount,bankAccount} จาก receipt ล่าสุดของใบนั้น
  // กันอาการ: หน้า Daily (อ่าน receipts) โชว์ "รับเงินวันนี้" แต่หน้า IV report (อ่าน
  //   invoices.status='paid') ไม่โชว์ → สองหน้าขัดกัน (เคส IV2604-025 รับเงิน 15 มิ.ย.
  //   แต่ใบยัง status='tracking'). ★ idempotent: ใบที่ paid+มี date แล้ว "ไม่ถูกแตะ" →
  //   ไม่เกิด churn/ดีดข้อมูล. ★ ของเดิมที่กรอกไว้ (amount) ไม่ทับ — ใช้ของ receipt เฉพาะที่ว่าง.
  // คืน { invoices, changed } ; changed=0 → คืน array เดิม (ไม่สร้าง ref ใหม่ → ไม่ทำ re-render)
  // ★ raw JS (data.js ไม่ผ่าน Babel) — เลี่ยง optional chaining, ใช้เช็คชัดเจน
  const markInvoicesPaidFromReceipts = (invoices, receipts) => {
    const list = invoices || [];
    if (!list.length || !receipts || !receipts.length) return { invoices: list, changed: 0 };
    // receipt ล่าสุด (receiptDate มากสุด — ISO เทียบ string ได้ตรง) ต่อ invoiceNo
    const rcpByIv = {};
    receipts.forEach(function (r) {
      if (!r) return;
      const k = String(r.invoiceNo == null ? '' : r.invoiceNo).trim();
      if (!k) return;
      const cur = rcpByIv[k];
      if (!cur || String(r.receiptDate || '') > String(cur.receiptDate || '')) rcpByIv[k] = r;
    });
    let changed = 0;
    const out = list.map(function (iv) {
      if (!iv) return iv;
      const k = String(iv.ivNo == null ? '' : iv.ivNo).trim();
      if (!k) return iv;
      const rcp = rcpByIv[k];
      if (!rcp) return iv;
      const ar = iv.actualReceive;
      // ★ มี "วันรับเงิน" อยู่แล้วไหม — ต้องเช็คทั้ง actualReceive.date (JSON) และ
      //   actualReceiveDate (คอลัมน์แบน) เพราะใบส่วนใหญ่เก็บวันรับใน "คอลัมน์แบน" ไม่ใช่ JSON.
      //   ถ้าเช็คแค่ JSON → จะ "flip" ใบที่ paid+มีวันรับอยู่แล้วเป็นร้อยใบ = เขียนทับชีต
      //   เป็นก้อนใหญ่ (mass churn → ต้นเหตุข้อมูลหาย). verify เจอ flip 685 ใบเพราะบั๊กนี้.
      const hasDate = (ar && ar.date) || (iv.actualReceiveDate != null && iv.actualReceiveDate !== '');
      if (iv.status === 'paid' && hasDate) return iv;   // paid + มีวันรับแล้ว → ไม่แตะ (idempotent, กัน churn)
      changed++;
      const keepAmt = ar && ar.amount != null && ar.amount !== '';   // ของเดิมที่กรอกไว้ไม่ทับ
      const amt = keepAmt ? ar.amount : (Number(rcp.netReceived) || Number(rcp.grossAmount) || 0);
      return Object.assign({}, iv, {
        status: 'paid',
        actualReceive: Object.assign({}, ar, {
          date:        rcp.receiptDate,
          amount:      amt,
          bankAccount: (ar && ar.bankAccount) || rcp.bankAccount || '',
        }),
        actualReceiveDate: rcp.receiptDate,
      });
    });
    return { invoices: changed ? out : list, changed: changed };
  };

  // ── rebuildFollowUpsLog (APPEND-ONLY) ─────────────────────────────────
  // Derive flat log from invoices[].followUps so the followUpsLog sheet
  // mirrors the JSON-in-cell follow-ups in a human-readable table.
  //
  // ★ APPEND-ONLY: log is a permanent audit trail — it must NEVER lose a
  //   follow-up that was once recorded, even if the source followUps array
  //   later shrinks (deleted by a user, or clobbered by a concurrent write).
  //   เดิมฟังก์ชันนี้สร้าง log ใหม่ทั้งก้อนจาก invoices → ถ้า followUps ตัวจริง
  //   หาย log ก็หายตามจนกู้อะไรไม่ได้. ตอนนี้เราเก็บแถวเก่าที่ไม่มีใน invoices
  //   แล้วไว้ด้วย (mark archived) เพื่อให้มีหลักฐานถาวร.
  //
  // Dedup key = invoiceId|date|note (CONTENT, not positional index) so
  // shifting array positions never duplicates an entry.
  const rebuildFollowUpsLog = (invoices, currentUser, existingLog) => {
    const keyOf = (invoiceId, date, note) =>
      String(invoiceId || '') + '|' + String(date || '') + '|' + String(note || '');
    const current = [];
    const liveKeys = new Set();
    (invoices || []).forEach(iv => {
      (iv.followUps || []).forEach((fu, idx) => {
        if (!fu || (!fu.date && !fu.note)) return;
        const k = keyOf(iv.id || iv.ivNo, fu.date, fu.note);
        liveKeys.add(k);
        current.push({
          id:           `fl_${iv.id || iv.ivNo || 'x'}_${idx}`,
          invoiceId:    iv.id || '',
          ivNo:         iv.ivNo || '',
          jobNo:        iv.jobNo || '',
          projectName:  iv.projectName || '',
          followUpDate: fu.date || '',
          note:         fu.note || '',
          createdAt:    fu.createdAt || fu.date || '',
          createdBy:    fu.createdBy || currentUser || '',
          archived:     '',
        });
      });
    });
    // Retain any prior log row whose content is no longer present in invoices
    // → permanent record of a follow-up that was removed/lost. Mark archived='y'.
    const retained = [];
    const seenRetain = new Set();
    (existingLog || []).forEach(r => {
      if (!r) return;
      const k = keyOf(r.invoiceId || r.ivNo, r.followUpDate, r.note);
      if (liveKeys.has(k)) return;        // still live → already in `current`
      if (seenRetain.has(k)) return;      // dedup retained too
      seenRetain.add(k);
      retained.push(Object.assign({}, r, { archived: 'y' }));
    });
    const out = current.concat(retained);
    // newest first by followUpDate
    out.sort((a, b) => (b.followUpDate || '').localeCompare(a.followUpDate || ''));
    return out;
  };

  // สรุปภาระหนี้แยกประเภท (คืน object { transfer_rights, od, pn, ... })
  const debtSummary = (debtLedger) => {
    const out = {};
    (debtLedger || []).forEach(d => {
      if (d.status !== 'active' && d.status !== 'overdue') return;
      out[d.debtType] = (out[d.debtType] || 0) + (d.outstandingBalance || 0);
    });
    return out;
  };

  window.WTPData = {
    load, save, reset, seed,
    SKIP_CACHE_KEYS,    // ★ exposed so data_sync.js can reference without duplicating the list
    STATUS_META, DELIVERY_META, IV_STATUS_META, PAY_STATUS_META,
    newId: id,
    daysBetween,
    buildLookups,
    calcInterest,
    debtSummary,
    rebuildFollowUpsLog,
    ensureReceiptForPaidInvoice,
    markInvoicesPaidFromReceipts,
  };
})();
