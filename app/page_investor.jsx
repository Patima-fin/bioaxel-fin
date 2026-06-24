// ═══════════════════════════════════════════════════════════════════════════
// INVESTOR DASHBOARD — premium corporate investor presentation (in-app page)
// route #investor · 10 sub-sections · TH/EN · Light/Dark · Present mode · Export
// Narrative mirrors the KTB pitch deck "Project Turtle — Company Overview".
// Live KPIs derive from data.projects (PCU.deriveProjects); company financials,
// market sizing, shareholding, team & ESG are STATIC from the deck (manual update).
// ทุก identifier ขึ้นต้น INV*/inv* กัน global collision (in-browser Babel)
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  const R = window.React;
  const el = R.createElement;
  const invSt = R.useState, invMemo = R.useMemo, invEff = R.useEffect, invRef = R.useRef;

  // ── product catalog (ราคาจริงจาก "ราคาผลิตภัณฑ์ WATER POG.xlsx") ──────────────
  const INV_PRODUCTS = [
    { code: 'PL',     group: 'POG TANK',    name: 'POG TANK (ใหญ่)',          price: 5400000 },
    { code: 'PLS',    group: 'POG TANK',    name: 'POG TANK (ใหญ่+โซลาร์)',   price: 5550000 },
    { code: 'PM',     group: 'POG TANK',    name: 'POG TANK (กลาง)',          price: 3400000 },
    { code: 'PMS',    group: 'POG TANK',    name: 'POG TANK (กลาง+โซลาร์)',   price: 3549000 },
    { code: 'PS',     group: 'POG TANK',    name: 'POG TANK (เล็ก)',          price: 2370000 },
    { code: 'PSM',    group: 'POG SOLVE',   name: 'POG SOLVE (กลาง)',         price: 3000000 },
    { code: 'PSL',    group: 'POG SOLVE',   name: 'POG SOLVE (ใหญ่)',         price: 4500000 },
    { code: 'PTII+S', group: 'POG TANK II', name: 'POG TANK II Solar Plus',   price: 7320000 },
    { code: 'PTIIS',  group: 'POG TANK II', name: 'POG TANK II Standard',     price: 7170000 },
    { code: 'STII+S', group: 'STANK II',    name: 'STANK II Solar Plus',      price: 5150000 },
    { code: 'STII',   group: 'STANK II',    name: 'STANK II Standard',        price: 5000000 },
    { code: 'PDP',    group: 'POG Drink',   name: 'POG Drink PLUS',           price: 1600000 },
    { code: 'PD',     group: 'POG Drink',   name: 'POG Drink Standard',       price: 1100000 },
    { code: 'PDH',    group: 'POG Drink',   name: 'POG Drink House',          price: 1300000 },
  ];

  // ── investment highlights (deck p2) ──────────────────────────────────────────
  const INV_HIGHLIGHTS = [
    { icon: '💧', th: ['ระบบผลิตน้ำครบวงจร All-in-One', 'ระบบผลิต+กรองน้ำในชุดเดียว ใช้เทคโนโลยีกรองขั้นสูงที่สุด'],
      en: ['All-in-One Water Supply System', 'A fully-integrated supply system with the most advanced filtration technology'] },
    { icon: '🪶', th: ['โมเดล Asset-Light', 'ลงทุนต่ำ เพราะจ้างผลิตภายนอก (outsource) ไม่ต้องมีโรงงานเอง'],
      en: ['Asset-Light Operation Model', 'Low capex — manufacturing is outsourced'] },
    { icon: '🗺️', th: ['ขยายได้ทั่วประเทศ', 'S-Tank แบบ Plug & Play ทำให้ขยายงานเร็วและครอบคลุมลูกค้าทั่วไทย'],
      en: ['Scalability Across Nation', 'Plug-and-play S-Tank lets the company scale fast across Thailand'] },
    { icon: '📦', th: ['Backlog ที่ทำสัญญาแล้ว', 'งานในมือจากท้องถิ่นสะท้อนความต้องการพัฒนาระบบน้ำอย่างต่อเนื่อง'],
      en: ['Secured Backlog', 'Past acquisitions reflect ongoing local-authority demand'] },
    { icon: '🏆', th: ['ผู้นำตลาดน้ำประปาชุมชน', 'เจ้าของสิทธิบัตรนวัตกรรมไทย และผู้จัดจำหน่ายอันดับ 1 ระดับหมู่บ้าน'],
      en: ['Market Leading Position', 'Thai Innovation patent owner & #1 village-scale distributor'] },
    { icon: '✅', th: ['ได้รับการรับรองอย่างเป็นทางการ', 'ขึ้นทะเบียนบัญชีนวัตกรรมไทย อนุมัติโดยสำนักงบประมาณ'],
      en: ['Officially Approved', 'Registered in the Thailand Innovation Product Registry, approved by the Budget Bureau'] },
  ];

  // ── product mix by # projects (deck p2, 2024–Jan2025 cumulative) ─────────────
  const INV_MIX = [
    { th: 'POG L', en: 'POG L', pct: 52, color: '#21703a' },
    { th: 'POG Drink', en: 'POG Drink', pct: 38, color: '#0e9f9a' },
    { th: 'POG M', en: 'POG M', pct: 6, color: '#2e8b4a' },
    { th: 'อื่นๆ', en: 'Other', pct: 4, color: '#b8862b' },
    { th: 'POG S', en: 'POG S', pct: 0, color: '#9aa83a' },
  ];

  // ── company financials (deck p12, Unit: THB mn) — STATIC ─────────────────────
  const INV_FIN_YEARS = ['2023A', '2024A', '2025A'];
  const INV_FIN = [
    { th: 'รายได้', en: 'Revenue', v: [1366.1, 562.6, 958.3], bold: true },
    { th: 'ต้นทุนขาย (COGS)', en: 'COGS', v: [-1054.0, -419.7, -696.4] },
    { th: 'กำไรขั้นต้น', en: 'Gross Profit', v: [312.1, 142.4, 261.9], bold: true },
    { th: 'อัตรากำไรขั้นต้น', en: 'Gross Profit Margin', v: [22.8, 25.3, 27.3], pct: true },
    { th: 'ค่าใช้จ่ายในการดำเนินงาน', en: 'Operating Expense', v: [-181.0, -174.5, -191.3] },
    { th: 'ต้นทุนทางการเงิน', en: 'Finance Costs', v: [-28.9, -44.5, -52.9] },
    { th: 'EBITDA', en: 'EBITDA', v: [135.4, -24.3, 88.5], bold: true },
    { th: 'อัตรา EBITDA', en: 'EBITDA Margin', v: [9.9, -4.3, 9.2], pct: true },
    { th: 'กำไรสุทธิ', en: 'Net Profit', v: [73.8, -64.1, 17.3], bold: true },
    { th: 'อัตรากำไรสุทธิ', en: 'Net Profit Margin', v: [5.4, -11.4, 1.8], pct: true },
  ];

  // ── POG Drink momentum (deck p6) ─────────────────────────────────────────────
  const INV_DRINK = [
    { label: 'ต.ค.67', value: 60 }, { label: 'พ.ย.67', value: 28 }, { label: 'ธ.ค.67', value: 31 },
    { label: 'ม.ค.68', value: 21 }, { label: '2025F', value: 276 }, { label: '2026F', value: 117 },
  ];

  // ── market sizing (deck p8) ──────────────────────────────────────────────────
  const INV_MARKET = { villages: 81701, withTap: 69771, withoutTap: 11930, served: 1000 };

  // ── shareholding structure (deck p15, as of 1 Dec 2025) — CONFIDENTIAL ───────
  const INV_SHARE = [
    { name: 'นายศิวพงษ์ ลือนาม / Mr. Siwapong Luenram', pct: 31.0, grp: 'founder' },
    { name: 'นายกฤตวัฒน์ ลือนาม / Mr. Krittawat Luenram', pct: 23.4, grp: 'founder' },
    { name: 'นายคเณศ ตันติเจริญวิวัฒน์ / Mr. Kanet Tantichareonwiwat', pct: 6.7, grp: 'founder' },
    { name: 'ARON HILL LIMITED', pct: 17.9, grp: 'op' },
    { name: 'VL HOLDING VENTURE LIMITED', pct: 8.0, grp: 'op' },
    { name: 'นางนันทนา มณีนิล / Mrs. Nantana Maneenin', pct: 1.9, grp: 'op' },
    { name: 'นางสุนีรัตน์ สีจันทร์เหมือง / Mrs. Suneerat Sichanmuang', pct: 0.8, grp: 'op' },
    { name: 'น.ส.อรวรรณ พวงคุ้ม / Miss Orawan Puangkum', pct: 0.5, grp: 'op' },
    { name: 'น.ส.ประภาศิริ ทองอินทร์ / Miss Praphasiri Thongin', pct: 0.5, grp: 'op' },
    { name: 'HEP HOLDINGS 6 LIMITED', pct: 0.4, grp: 'op' },
    { name: 'นายภัทระ ไวศยรัตน์ / Mr. Pachara Waisayarat', pct: 0.2, grp: 'op' },
    { name: 'นายพงษ์พัฒน์ ชัยศรีพงษ์ไพศาล / Mr. Pongpat Chaisripongpaisarn', pct: 0.2, grp: 'op' },
    { name: 'น.ส.ปราณิสา ปุ้มชัยยะ / Miss Pranisa Pumchaiya', pct: 0.1, grp: 'op' },
    { name: 'นายมานิตย์ ตาเจ๊ะ / Mr. Manit Tajew', pct: 0.1, grp: 'op' },
    { name: 'น.ส.นิสา แย้มสอาด / Miss Nisa Yaemsaart', pct: 0.1, grp: 'op' },
    { name: 'น.ส.บริพรรณ สุนร่วมใจ / Miss Boriphon Sunruamjai', pct: 0.1, grp: 'op' },
    { name: 'PRIVATE EQUITY TRUST FOR SME GROWING TOGETHER 1', pct: 8.2, grp: 'pe' },
  ];
  const INV_SHARE_GRP = { founder: { th: 'กลุ่มผู้ก่อตั้ง', en: 'Founders', pct: 61.1 }, op: { th: 'ทีมวิศวกร/ปฏิบัติการ', en: 'Engineering & Operations', pct: 30.7 }, pe: { th: 'นักลงทุน (PE)', en: 'Investor (PE)', pct: 8.2 } };

  // ── founders (deck p15) ──────────────────────────────────────────────────────
  const INV_FOUNDERS = [
    { th: ['นายศิวพงษ์ ลือนาม', 'ผู้ก่อตั้ง (Founding Member)'], en: ['Siwapong Luenram', 'Founding Member'],
      bullets_th: ['ผู้สนับสนุน ที่ปรึกษา และผู้ร่วมทุนวิจัยให้ ม.สงขลานครินทร์ และ มทร.ธัญบุรี', 'ประสบการณ์: นวรัตน์พัฒนาการ · วิศวกรอุตสาหการที่สมุย', 'การศึกษา: วิศวกรรมอุตสาหการ ม.สงขลานครินทร์'],
      bullets_en: ['Sponsor, advisor & research funding partner for PSU and RMUTT', 'Experience: Nawarat Patanakarn, Engineer Industrialist in Samui', 'Education: Industrial Engineering, Prince of Songkla University'] },
    { th: ['นายภัทระ ไวศยรัตน์', 'วิศวกรวิจัยและพัฒนา (R&D)'], en: ['Pachara Waisayarat', 'R&D Engineer'],
      bullets_th: ['ร่วมพัฒนาและออกแบบระบบกรองน้ำหมู่บ้าน POG', 'ประสบการณ์: JME Home (Project Engineer) · เจริญมิตร (Site Engineer)', 'การศึกษา: วิศวกรรมอุตสาหการ ม.สงขลานครินทร์'],
      bullets_en: ['Co-developed & designed the POG village water filtration system', 'Experience: JME Home Project Engineer; Jrernmitr Site Engineer', 'Education: Industrial Engineering, Prince of Songkla University'] },
    { th: ['นายพงษ์พัฒน์ ชัยศรีพงษ์ไพศาล', 'วิศวกรโครงการ (Project Engineer)'], en: ['Pongpat Chaisripongpaisal', 'Project Engineer'],
      bullets_th: ['ร่วมพัฒนาระบบเติมอากาศแบบ Venturi ที่ใช้ใน ACFS', 'ประสบการณ์: Soecon (Project Engineer) · Meccon (Site Engineer)', 'การศึกษา: วิศวกรรมเครื่องกล ม.สงขลานครินทร์'],
      bullets_en: ['Co-developed the Venturi air-injection system used in ACFS', 'Experience: Soecon Project Engineer; Meccon Site Engineer', 'Education: Mechanical Engineering, Prince of Songkla University'] },
  ];

  // ── ESG pillars (deck p16–18) ────────────────────────────────────────────────
  const INV_ESG = [
    { icon: '🩺', th: ['สุขภาพ สุขอนามัย และความเป็นอยู่ของชุมชน', 'ถัง ACFS กำจัดโลหะปนเปื้อนในน้ำดิบ ช่วยยกระดับสุขภาพชาวบ้านและเพิ่มผลผลิตเกษตร'],
      en: ['Health, Sanitation & Well-Being', 'The ACFS tank removes contaminated metals from raw water — improving health and raising crop yields'],
      idx_th: 'ดัชนีน้ำสะอาดและสุขาภิบาลโลก: ไทยอันดับ 71', idx_en: 'World Water & Sanitation Index: Thailand ranked 71st',
      bars: [{ label: '1st', value: 100 }, { label: '19th', value: 96.6 }, { label: '22nd', value: 94.9 }, { label: 'ไทย 71st', value: 59.4 }] },
    { icon: '🚰', th: ['น้ำสะอาดเข้าถึงทุกคนทั่วไทย', 'กว่า 70% ของหมู่บ้านยังไม่มีระบบประปาที่เหมาะสม POG ใช้พื้นที่น้อยลง 6–8 เท่า'],
      en: ['Clean Water Accessibility for All', 'Over 70% of villages lack proper water supply — POG optimises land use 6–8× vs traditional systems'],
      idx_th: 'ไทยมีการเข้าถึงสุขาภิบาลน้ำต่ำสุดเมื่อเทียบประเทศเพื่อนบ้าน', idx_en: 'Thailand has the lowest water-sanitation access among neighbours',
      bullets_th: ['ระบบประปาคุณภาพเทียบการประปาส่วนภูมิภาค', 'โครงสร้างพื้นฐานเข้าถึงทุกชุมชน', 'ท้องถิ่นประหยัดงบระยะยาว'],
      bullets_en: ['Water quality comparable to the Provincial Waterworks Authority', 'Infrastructure available to every community', 'Long-term cost savings for local administrations'] },
    { icon: '🔬', th: ['นวัตกรรมโครงสร้างพื้นฐานจาก SME ไทย', 'ไทยอันดับ 45 ด้านนวัตกรรม POG ยกระดับด้วยเทคโนโลยีและสนับสนุนงานวิจัยท้องถิ่น'],
      en: ['Nationwide Infrastructure from a Local SME', 'Thailand ranks 45th in innovation — POG upgrades technology and supports local research'],
      idx_th: 'อันดับสมรรถนะนวัตกรรม', idx_en: 'Innovation Performance Ranking',
      bars: [{ label: '1st', value: 2.56 }, { label: '11th', value: 1.34 }, { label: '24th', value: 0.95 }, { label: 'ไทย 45th', value: 0.36 }] },
  ];

  // ── i18n (short labels) ──────────────────────────────────────────────────────
  const T = {
    th: {
      brand: 'Water POG · POG TANKS', tagline: 'เจ้าของสิทธิบัตรนวัตกรรมไทย · ผู้จัดจำหน่ายระบบกรองน้ำระดับหมู่บ้านอันดับ 1 ของไทย',
      secs: ['ภาพรวมการลงทุน', 'ข้อมูลบริษัท', 'ผลิตภัณฑ์และเทคโนโลยี', 'โอกาสทางตลาด', 'ผลการดำเนินงาน', 'เศรษฐศาสตร์โครงการ', 'ลูกค้าและโครงการ', 'ทีมและผู้ถือหุ้น', 'ความยั่งยืน (ESG)', 'ห้องนักลงทุน', 'วงเงินสินเชื่อ KTB'],
      present: 'โหมดนำเสนอ', exit: 'ออก', exportPdf: 'ส่งออก PDF',
      contractValue: 'มูลค่าสัญญารวม (ในระบบ)', projects: 'โครงการทั้งหมด', received: 'รับเงินแล้ว', backlog: 'งานคงค้าง (AR)',
      pipeline: 'งานรอลงนาม', revenue: 'รายได้', wip: 'งานระหว่างก่อสร้าง', products: 'รุ่นผลิตภัณฑ์',
      byRegion: 'โครงการแยกตามภูมิภาค', byType: 'มูลค่าตามกลุ่มผลิตภัณฑ์', byFy: 'มูลค่าสัญญาตามปีงบ', cashflow: 'คาดการณ์กระแสเงินสด',
      statusFunnel: 'สถานะโครงการ', topProv: 'จังหวัดที่มีโครงการมากสุด', priceList: 'ราคาผลิตภัณฑ์ (บาท)', unit: 'บาท',
      docCenter: 'ศูนย์เอกสาร', uploadPdf: 'อัปโหลด PDF', uploadVideo: 'อัปโหลดวิดีโอ', videoUrl: 'ลิงก์วิดีโอ (YouTube/Drive)',
      gallery: 'แกลเลอรีโครงการ', uploadImg: 'อัปโหลดรูป', search: 'ค้นหา…', noData: 'ยังไม่มีข้อมูล',
      mixTitle: 'สัดส่วนโครงการตามกลุ่มผลิตภัณฑ์', mixNote: 'อ้างอิงสะสม ต.ค.2024 – ม.ค.2025',
      hiTitle: 'จุดเด่นการลงทุน', approvedBy: 'รับรอง/ขึ้นทะเบียนโดย',
      finUnit: 'หน่วย: ล้านบาท', growth: 'เติบโต', drinkTitle: 'จำนวนโครงการ POG Drink',
      mktPen: 'การเจาะตลาด', mktUntapped: 'ของตลาดยังไม่ถูกเจาะ', villages: 'หมู่บ้านทั้งประเทศ', withTap: 'มีประปาสะอาด', withoutTap: 'ยังไม่มีประปาสะอาด', servedNote: 'Water POG ให้บริการแล้วกว่า 1,000+ โครงการ',
      econTitle: 'โครงสร้างต้นทุนโครงการ (POG TANK L)', pipelineTitle: 'งานในมือ (ล้านบาท)', cfTimeline: 'ไทม์ไลน์กระแสเงินสดโครงการ',
      shareTitle: 'โครงสร้างผู้ถือหุ้น', shareNote: 'ณ วันที่ 1 ธ.ค. 2025', founderTitle: 'ผู้ก่อตั้งและทีมผู้บริหาร', confidential: 'ข้อมูลลับเฉพาะ — สำหรับนักลงทุนเท่านั้น',
      esgTitle: 'การพัฒนาที่ยั่งยืน',
    },
    en: {
      brand: 'Water POG · POG TANKS', tagline: 'Thai Innovation Patent Owner · #1 Distributor of Village-Scale Water Filtration in Thailand',
      secs: ['Investment Highlights', 'Company Profile', 'Products & Technology', 'Market Opportunity', 'Financial Performance', 'Project Economics', 'Customers & Projects', 'Team & Shareholding', 'Sustainability (ESG)', 'Investor Room', 'KTB Credit & Capacity'],
      present: 'Present', exit: 'Exit', exportPdf: 'Export PDF',
      contractValue: 'Total Contract Value (system)', projects: 'Total Projects', received: 'Cash Received', backlog: 'Backlog (AR)',
      pipeline: 'Awaiting Sign', revenue: 'Revenue', wip: 'Work in Progress', products: 'Product Models',
      byRegion: 'Projects by Region', byType: 'Value by Product Group', byFy: 'Contract Value by Fiscal Year', cashflow: 'Cash Flow Forecast',
      statusFunnel: 'Project Status', topProv: 'Top Provinces', priceList: 'Price List (THB)', unit: 'THB',
      docCenter: 'Document Center', uploadPdf: 'Upload PDF', uploadVideo: 'Upload Video', videoUrl: 'Video link (YouTube/Drive)',
      gallery: 'Project Gallery', uploadImg: 'Upload Image', search: 'Search…', noData: 'No data yet',
      mixTitle: 'Number of Projects by Product Type', mixNote: 'Based on Oct 2024 – Jan 2025 cumulative',
      hiTitle: 'Investment Highlights', approvedBy: 'Officially Approved / Registered By',
      finUnit: 'Unit: THB mn', growth: 'Growth', drinkTitle: 'Number of POG Drink Projects',
      mktPen: 'Market Penetration', mktUntapped: 'of the market still untapped', villages: 'villages nationwide', withTap: 'with clean tap water', withoutTap: 'without clean tap water', servedNote: 'Water POG is serving 1,000+ projects',
      econTitle: 'Project Cost Structure (POG TANK L)', pipelineTitle: 'Project Pipeline (THB mn)', cfTimeline: 'Project Cash Flow Timeline',
      shareTitle: 'Shareholding Structure', shareNote: 'As of 1 Dec 2025', founderTitle: 'Founders & Management Team', confidential: 'Strictly Confidential — For Investors Only',
      esgTitle: 'Sustainable Development',
    },
  };

  // ── theme palettes ──────────────────────────────────────────────────────────
  const PAL = {
    light: { bg: '#eef2f8', card: '#ffffff', card2: '#f7faff', ink: '#0d1f3a', sub: '#5a6b86', line: '#e3e9f2',
      brand: '#21703a', brand2: '#2e8b4a', accent: '#0e9f9a', gold: '#b8862b', good: '#1f8a5b', bad: '#c0392b', shadow: '0 10px 30px rgba(20,45,100,.10)' },
    dark: { bg: '#0a1120', card: '#131d33', card2: '#0f1830', ink: '#eaf1fb', sub: '#93a6c4', line: '#243450', brand: '#5b93f3',
      brand2: '#7eacf7', accent: '#33c2bd', gold: '#e0ab4d', good: '#4cc38a', bad: '#ef6a5a', shadow: '0 12px 34px rgba(0,0,0,.45)' },
  };

  const invFmt = (n) => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
  const invCompact = (n) => {
    if (n == null || isNaN(n)) return '—'; const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K'; return String(Math.round(n));
  };
  // THB-mn (financials): "(64.1)" for negatives, 1 decimal
  const invMn = (n) => { if (n == null || isNaN(n)) return '—'; const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); return n < 0 ? '(' + s + ')' : s; };
  const invRgba = (hex, a) => { try { const h = String(hex).replace('#', ''); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; } catch (_) { return hex; } };

  // ── derive real metrics from system data ─────────────────────────────────────
  function invMetrics(data) {
    const PCU = window.PCU;
    let rows = [];
    try { rows = PCU ? PCU.deriveProjects(data.projects || [], data.invoices || [], data.receipts || []) : []; } catch (_) { rows = []; }
    const active = rows.filter(r => r.status !== 'ยกเลิก');
    const contractTotal = active.reduce((s, r) => s + (r.contractAmt || 0), 0);
    const received = active.reduce((s, r) => s + (r.received || 0), 0);
    const backlog = active.reduce((s, r) => s + (r.outstandingAR || 0), 0);
    const byRegion = {}, byType = {}, byFy = {}, byProv = {}, byStatus = {};
    active.forEach(r => {
      const rg = r.regionEn || r.region || 'อื่นๆ'; byRegion[rg] = (byRegion[rg] || 0) + 1;
      const tp = r.type || '—'; byType[tp] = (byType[tp] || 0) + (r.contractAmt || 0);
      const fy = r.fy ? 'FY' + r.fy : '—'; byFy[fy] = (byFy[fy] || 0) + (r.contractAmt || 0);
      if (r.province) byProv[r.province] = (byProv[r.province] || 0) + 1;
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    });
    let cashflow = [];
    try {
      const ys = PCU.forecastYears(active); const y = ys[ys.length - 1] || new Date().getFullYear();
      cashflow = PCU.cashflowByMonth(active, y).map(m => ({ label: m.month, value: m.gross }));
    } catch (_) {}
    const prodCount = {}; active.forEach(r => { const c = (r.type || '').trim(); if (c) prodCount[c] = (prodCount[c] || 0) + 1; });
    return { rows, active, contractTotal, received, backlog, byRegion, byType, byFy, byProv, byStatus, cashflow, prodCount, count: active.length };
  }

  // ── small UI atoms ────────────────────────────────────────────────────────────
  function InvKpi({ p, label, value, sub, accent }) {
    return R.createElement('div', { style: { background: p.card, border: '1px solid ' + p.line, borderRadius: 16, padding: '18px 20px', boxShadow: p.shadow, position: 'relative', overflow: 'hidden' } },
      R.createElement('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent || p.brand } }),
      R.createElement('div', { style: { fontSize: 12, color: p.sub, fontWeight: 600 } }, label),
      R.createElement('div', { style: { fontSize: 30, fontWeight: 800, color: p.ink, letterSpacing: '-.5px', marginTop: 6, fontVariantNumeric: 'tabular-nums' } }, value),
      sub ? R.createElement('div', { style: { fontSize: 11.5, color: p.sub, marginTop: 3 } }, sub) : null
    );
  }
  function InvBars({ p, items, color, money, suffix }) {
    const max = Math.max(1, ...items.map(i => Math.abs(i.value)));
    return R.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
      items.map((it, i) => R.createElement('div', { key: i },
        R.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: p.sub, marginBottom: 3 } },
          R.createElement('span', null, it.label),
          R.createElement('span', { style: { fontWeight: 700, color: p.ink, fontVariantNumeric: 'tabular-nums' } }, money ? invCompact(it.value) : (invFmt(it.value) + (suffix || '')))),
        R.createElement('div', { style: { height: 9, background: p.card2, borderRadius: 99, overflow: 'hidden' } },
          R.createElement('div', { style: { height: '100%', width: Math.max(2, Math.abs(it.value) / max * 100) + '%', background: 'linear-gradient(90deg,' + (color || p.brand) + ',' + p.brand2 + ')', borderRadius: 99 } }))
      ))
    );
  }
  function InvCard({ p, title, note, children, style }) {
    return R.createElement('div', { style: Object.assign({ background: p.card, border: '1px solid ' + p.line, borderRadius: 16, padding: 20, boxShadow: p.shadow }, style || {}) },
      title ? R.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 14, flexWrap: 'wrap' } },
        R.createElement('div', { style: { fontSize: 13.5, fontWeight: 800, color: p.ink, display: 'flex', alignItems: 'center', gap: 8 } },
          R.createElement('span', { style: { width: 4, height: 15, background: p.brand, borderRadius: 3, display: 'inline-block' } }), title),
        note ? R.createElement('div', { style: { fontSize: 11, color: p.sub } }, note) : null) : null,
      children
    );
  }
  // segmented 100% bar + legend (product mix)
  function InvSeg({ p, items, lang }) {
    const seg = items.filter(i => i.pct > 0);
    return R.createElement('div', null,
      R.createElement('div', { style: { display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden', border: '1px solid ' + p.line } },
        seg.map((s, i) => R.createElement('div', { key: i, title: (lang === 'th' ? s.th : s.en) + ' ' + s.pct + '%', style: { width: s.pct + '%', background: s.color, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 10.5, fontWeight: 700 } }, s.pct >= 8 ? s.pct + '%' : ''))),
      R.createElement('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 } },
        items.map((s, i) => R.createElement('span', { key: i, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: p.sub } },
          R.createElement('span', { style: { width: 11, height: 11, borderRadius: 3, background: s.color, display: 'inline-block' } }),
          (lang === 'th' ? s.th : s.en), R.createElement('b', { style: { color: p.ink } }, s.pct + '%'))))
    );
  }
  // generic key/value or matrix table
  function InvTable({ p, head, rows }) {
    return R.createElement('div', { style: { overflow: 'auto' } },
      R.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 } },
        head ? R.createElement('thead', null, R.createElement('tr', null,
          head.map((h, i) => R.createElement('th', { key: i, style: { textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', color: p.sub, fontWeight: 700, borderBottom: '2px solid ' + p.line, whiteSpace: 'nowrap' } }, h)))) : null,
        R.createElement('tbody', null, rows.map((r, i) => R.createElement('tr', { key: i, style: { background: r.total ? invRgba(p.brand, 0.1) : (r.bold ? p.card2 : 'transparent') } },
          r.cells.map((c, j) => R.createElement('td', { key: j, style: { textAlign: j === 0 ? 'left' : 'right', padding: r.total ? '10px' : '7px 10px', borderBottom: '1px solid ' + p.line, borderTop: r.total ? '2px solid ' + p.brand : 'none', fontWeight: (r.total || r.bold) ? 800 : (j === 0 ? 600 : 500), color: c && c.neg ? p.bad : (r.total && j > 0 ? p.brand : p.ink), fontVariantNumeric: 'tabular-nums', whiteSpace: j === 0 ? 'normal' : 'nowrap' } }, c && c.t != null ? c.t : c)))))
      )
    );
  }

  // ── persisted embeds (video URL etc.) via WTPOverride (team-shared) ───────────
  const invGet = (k, d) => { try { return (window.WTPOverride && WTPOverride.resolveRaw) ? WTPOverride.resolveRaw('inv.' + k, d) : ((window.WTPOverride && WTPOverride._load && WTPOverride._load()['inv.' + k]) || d); } catch (_) { return d; } };
  const invSet = (k, v) => { try { window.WTPOverride && WTPOverride.setRaw && WTPOverride.setRaw('inv.' + k, v); } catch (_) {} };

  const grid = (cols, gap) => ({ display: 'grid', gridTemplateColumns: 'repeat(' + cols + ',1fr)', gap: gap || 14 });
  const gridR = (cols, gap) => ({ display: 'grid', gridTemplateColumns: 'repeat(' + (window.innerWidth < 760 ? 1 : cols) + ',1fr)', gap: gap || 14 });

  // ═══════════════════ MAIN PAGE ═══════════════════
  function InvestorDashboard({ data, setData, toast }) {
    const [lang, setLang] = invSt(() => localStorage.getItem('bio-inv-lang') || 'th');
    const [theme, setTheme] = invSt(() => localStorage.getItem('bio-inv-theme') || 'light');
    const [sec, setSec] = invSt(0);
    const [present, setPresent] = invSt(false);
    const p = PAL[theme] || PAL.light;
    const tt = T[lang] || T.th;
    const m = invMemo(() => invMetrics(data), [data]);
    invEff(() => { localStorage.setItem('bio-inv-lang', lang); }, [lang]);
    invEff(() => { localStorage.setItem('bio-inv-theme', theme); }, [theme]);

    const rootStyle = { background: p.bg, color: p.ink, minHeight: '100vh', margin: present ? 0 : '-16px', padding: present ? '24px 30px' : '16px',
      fontFamily: "'IBM Plex Sans Thai','Sarabun',system-ui,sans-serif", position: present ? 'fixed' : 'relative', inset: present ? 0 : 'auto', zIndex: present ? 900 : 'auto', overflow: present ? 'auto' : 'visible' };

    const SECS = [InvExec, InvCompany, InvProducts, InvMarket, InvPerformance, InvEconomics, InvCustomers, InvTeam, InvESG, InvRoom, InvCredit];
    const Section = SECS[sec] || InvExec;

    return R.createElement('div', { style: rootStyle, id: 'investor-root' },
      R.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 } },
        R.createElement('div', { style: { width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,' + p.brand + ',' + p.brand2 + ')', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 18, flex: '0 0 auto' } }, 'W'),
        R.createElement('div', { style: { lineHeight: 1.25, flex: '1 1 240px', minWidth: 0 } },
          R.createElement('div', { style: { fontSize: 19, fontWeight: 800, letterSpacing: '-.3px' } }, 'Investor Dashboard'),
          R.createElement('div', { style: { fontSize: 11.5, color: p.sub } }, tt.tagline)),
        R.createElement('div', { className: 'no-print', style: { marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' } },
          invToggle(p, lang === 'th' ? 'TH' : 'EN', () => setLang(lang === 'th' ? 'en' : 'th')),
          invToggle(p, theme === 'light' ? '🌙' : '☀️', () => setTheme(theme === 'light' ? 'dark' : 'light')),
          invToggle(p, '🖨 ' + tt.exportPdf, () => window.print()),
          R.createElement('button', { onClick: () => setPresent(!present), style: { height: 36, padding: '0 14px', borderRadius: 9, border: 'none', background: present ? p.gold : 'linear-gradient(135deg,' + p.brand + ',' + p.brand2 + ')', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' } }, present ? '✕ ' + tt.exit : '⛶ ' + tt.present))
      ),
      R.createElement('div', { className: 'no-print', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18, borderBottom: '1px solid ' + p.line, paddingBottom: 10 } },
        tt.secs.map((s, i) => R.createElement('button', { key: i, onClick: () => setSec(i),
          style: { padding: '7px 12px', borderRadius: 9, border: '1px solid ' + (sec === i ? 'transparent' : p.line), background: sec === i ? 'linear-gradient(135deg,' + p.brand + ',' + p.brand2 + ')' : p.card, color: sec === i ? '#fff' : p.sub, fontSize: 12, fontWeight: sec === i ? 700 : 500, cursor: 'pointer' } },
          (i + 1) + '. ' + s))
      ),
      R.createElement(Section, { p: p, tt: tt, m: m, data: data, lang: lang, toast: toast })
    );
  }
  function invToggle(p, label, onClick) {
    return R.createElement('button', { onClick, style: { height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid ' + p.line, background: p.card, color: p.ink, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' } }, label);
  }

  // ── 1. Investment Highlights (deck p2) ────────────────────────────────────────
  function InvExec({ p, tt, m, lang }) {
    const fyItems = Object.keys(m.byFy).sort().map(k => ({ label: k, value: m.byFy[k] }));
    const approved = lang === 'th'
      ? ['บัญชีนวัตกรรมไทย', 'สำนักงบประมาณ', 'สวทช. (NSTDA)', 'มาตรฐาน WHO']
      : ['Thailand Innovation Registry', 'Budget Bureau', 'NSTDA', 'WHO Standards'];
    return R.createElement('div', null,
      R.createElement('div', { style: { background: 'linear-gradient(135deg,' + p.brand + ',' + p.brand2 + ')', borderRadius: 18, padding: '26px 28px', color: '#fff', marginBottom: 16, boxShadow: p.shadow } },
        R.createElement('div', { style: { fontSize: 13, opacity: .9, fontWeight: 600 } }, lang === 'th' ? 'ระบบผลิตน้ำประปาชุมชนครบวงจร All-in-One' : 'All-in-One Village-Scale Water Supply System'),
        R.createElement('div', { style: { fontSize: 30, fontWeight: 800, letterSpacing: '-.5px', marginTop: 6, lineHeight: 1.2 } }, tt.tagline),
        R.createElement('div', { style: { fontSize: 13, opacity: .92, marginTop: 10 } }, tt.contractValue + ' ' + invFmt(m.contractTotal) + ' · ' + tt.projects + ' ' + invFmt(m.count))),
      R.createElement('div', { style: Object.assign(gridR(4), { marginBottom: 16 }) },
        R.createElement(InvKpi, { p, label: tt.revenue + ' 2025A', value: '958M', sub: tt.growth + ' 70.3% YoY', accent: p.brand }),
        R.createElement(InvKpi, { p, label: tt.projects + ' (ในระบบ)', value: invFmt(m.count), accent: p.accent }),
        R.createElement(InvKpi, { p, label: tt.backlog, value: invCompact(m.backlog), accent: p.gold }),
        R.createElement(InvKpi, { p, label: tt.products, value: INV_PRODUCTS.length + (lang === 'th' ? ' รุ่น' : ''), sub: 'POG TANK · SOLVE · Drink', accent: p.brand2 })),
      R.createElement(InvCard, { p, title: tt.hiTitle, style: { marginBottom: 14 } },
        R.createElement('div', { style: gridR(3) },
          INV_HIGHLIGHTS.map((h, i) => R.createElement('div', { key: i, style: { display: 'flex', gap: 12, padding: 12, background: p.card2, borderRadius: 12, border: '1px solid ' + p.line } },
            R.createElement('div', { style: { fontSize: 24, flex: '0 0 auto' } }, h.icon),
            R.createElement('div', null,
              R.createElement('div', { style: { fontSize: 13, fontWeight: 800, color: p.ink, marginBottom: 3 } }, (lang === 'th' ? h.th : h.en)[0]),
              R.createElement('div', { style: { fontSize: 11.5, color: p.sub, lineHeight: 1.5 } }, (lang === 'th' ? h.th : h.en)[1])))))),
      R.createElement('div', { style: gridR(2) },
        R.createElement(InvCard, { p, title: tt.mixTitle, note: tt.mixNote }, R.createElement(InvSeg, { p, items: INV_MIX, lang })),
        R.createElement(InvCard, { p, title: tt.byFy }, R.createElement(InvBars, { p, items: fyItems.length ? fyItems : [{ label: '—', value: 0 }], money: true }))),
      R.createElement(InvCard, { p, title: '✅ ' + tt.approvedBy, style: { marginTop: 14 } },
        R.createElement('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
          approved.map((a, i) => R.createElement('span', { key: i, style: { padding: '8px 14px', background: p.card2, border: '1px solid ' + p.line, borderRadius: 99, fontSize: 12.5, fontWeight: 700, color: p.brand } }, a))))
    );
  }

  // ── 2. Company Profile ────────────────────────────────────────────────────────
  function InvCompany({ p, tt, lang }) {
    const facts = lang === 'th' ? [
      ['ชื่อบริษัท', 'บริษัท วอเทอร์ป๊อก จำกัด (Water POG / POG TANKS)'],
      ['ที่ตั้ง', '6/5 หมู่ 3 ต.บ่อผุด อ.เกาะสมุย จ.สุราษฎร์ธานี 84320'],
      ['ธุรกิจ', 'นวัตกรรมระบบผลิตน้ำประปาชุมชน · ขึ้นทะเบียนบัญชีนวัตกรรมไทย'],
      ['สถานะตลาด', 'ผู้จัดจำหน่ายระบบกรองน้ำระดับหมู่บ้านอันดับ 1 ของไทย'],
      ['กลุ่มผลิตภัณฑ์', 'POG TANK · POG SOLVE · POG Drink · S-Tank'],
      ['โมเดลธุรกิจ', 'Asset-Light · จ้างผลิตภายนอก · ทีมวิศวกรติดตั้ง/บริการเอง'],
    ] : [
      ['Company', 'Water POG Co., Ltd. (POG TANKS)'],
      ['Location', '6/5 Moo 3, Bo Phut, Koh Samui, Surat Thani 84320'],
      ['Business', 'Community water-supply innovation · Registered Thai Innovation'],
      ['Market position', '#1 distributor of village-scale water filtration in Thailand'],
      ['Product lines', 'POG TANK · POG SOLVE · POG Drink · S-Tank'],
      ['Business model', 'Asset-light · outsourced manufacturing · in-house install/service'],
    ];
    const props = lang === 'th'
      ? ['ระบบครบวงจร: ผลิต+กรองในชุดเดียว กรองน้ำดิบได้ทุกแหล่ง (ประปา/บาดาล/ผิวดิน/น้ำเสียเกษตร)', 'ติดตั้งเร็ว 3–5 เดือน ใช้พื้นที่เพียง ~80 ตร.ม. (ระบบเดิม >625 ตร.ม.)', 'ระบบกรอง up-flow + backwash อัตโนมัติ อายุการใช้งานไส้กรองนานถึง 2 ปี', 'ควบคุม/ติดตามทางไกลด้วย IoT · ผู้ดูแลคนเดียวคุมทั้งระบบ', 'รับประกัน 2 ปี · บำรุงรักษาทุก 6 เดือน · ทีมช่างเข้าซ่อมภายใน 48 ชม.', 'คุณภาพน้ำผ่านมาตรฐาน WHO และรับรองโดย สวทช.']
      : ['All-in-one: production + filtration in one unit; treats every raw-water source (tap/ground/surface/agricultural effluent)', 'Fast install in 3–5 months, needs only ~80 sqm (legacy systems >625 sqm)', 'Up-flow filtration + automatic backwash; filter media lasts up to 2 years', 'IoT remote monitoring & control; a single operator runs the whole system', '2-year warranty · maintenance every 6 months · on-site repair within 48 hrs', 'Water quality meets WHO standards, assured by NSTDA'];
    return R.createElement('div', { style: gridR(2) },
      R.createElement(InvCard, { p, title: lang === 'th' ? 'ข้อมูลบริษัท' : 'Company Profile' },
        facts.map((f, i) => R.createElement('div', { key: i, style: { display: 'flex', gap: 12, padding: '9px 0', borderBottom: i < facts.length - 1 ? '1px solid ' + p.line : 'none' } },
          R.createElement('div', { style: { width: 120, color: p.sub, fontSize: 12.5, flex: '0 0 auto' } }, f[0]),
          R.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, f[1])))),
      R.createElement(InvCard, { p, title: lang === 'th' ? 'จุดเด่นที่สร้างมูลค่า' : 'Value Propositions' },
        R.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 11 } },
          props.map((v, i) => R.createElement('div', { key: i, style: { display: 'flex', gap: 10, alignItems: 'flex-start' } },
            R.createElement('span', { style: { color: p.accent, fontWeight: 800 } }, '✓'),
            R.createElement('span', { style: { fontSize: 13, lineHeight: 1.5 } }, v)))))
    );
  }

  // ── 3. Products & Technology (deck p3–6) ──────────────────────────────────────
  function InvProducts({ p, tt, m, lang }) {
    const comps = lang === 'th'
      ? [['1 · ACFS — ถังเก็บอเนกประสงค์', 'กรอง 7 ชั้นแบบ bottom-up + ระบบเติมอากาศและฉีดสารเคมี 3 จุด ฆ่าเชื้อและกำจัดกลิ่น'],
         ['2 · Intelligence PnP — สถานีปั๊มอัจฉริยะ', 'Plug & Pump คุมการไหลด้วยเซนเซอร์ แจ้งเตือนไฟดับ/อากาศในท่อ/สารเคมีหมด/แรงดันเกิน/ระดับน้ำ'],
         ['3 · SFX Tower Tank — หอถังสูง', 'เก็บน้ำบนหอสูงพร้อมกรองซ้ำ 7 ชั้นแบบ top-down ให้น้ำสะอาดก่อนจ่ายเข้าครัวเรือน']]
      : [['1 · ACFS — Multi-purpose Storage Tank', 'Bottom-up 7-layer filtration + aeration & 3-point chemical injection to sterilise and deodorise'],
         ['2 · Intelligence PnP — Plug & Pump Station', 'Sensor-controlled flow; alerts on power failure, air in pipes, dry chemicals, overpressure & water level'],
         ['3 · SFX Tower Tank', 'High-tower storage with a top-down 7-layer refiltration before distribution to households']];
    const sizes = lang === 'th'
      ? [['L', '121–300 ครัวเรือน'], ['M', '51–120 ครัวเรือน'], ['S', '30–50 ครัวเรือน']]
      : [['L', '121–300 households'], ['M', '51–120 households'], ['S', '30–50 households']];
    const lines = lang === 'th'
      ? [['POG Tank', 'ระบบบำบัดน้ำสำหรับหมู่บ้านที่ไม่มีประปา ติดตั้ง 3–5 เดือน รับประกัน 2 ปี · ระบบแรกที่ขึ้นบัญชีนวัตกรรมไทย'],
         ['Smart Pure Compact (S-Tank)', 'ถัง ACFS อเนกประสงค์ ใช้ได้กับทุกระบบประปา ใช้พื้นที่น้อย ติดตั้ง 2–5 เดือน รับประกัน 1 ปี'],
         ['POG Drink', 'ระบบกรองน้ำดื่ม Reverse Osmosis กำลังผลิตสูงในดีไซน์กะทัดรัด ดูแลง่าย ต้นทุนต่ำกว่าน้ำขวดมาก']]
      : [['POG Tank', 'Treatment system for villages without mains water; 3–5 month install, 2-yr warranty · 1st in Thai Innovation Registry'],
         ['Smart Pure Compact (S-Tank)', 'Versatile ACFS tank compatible with all supply systems; small footprint, 2–5 month install, 1-yr warranty'],
         ['POG Drink', 'Reverse-osmosis drinking-water system; high capacity, compact, easy to run, far cheaper than bottled water']];
    return R.createElement('div', null,
      R.createElement(InvCard, { p, title: lang === 'th' ? 'องค์ประกอบหลักของ POG Tank' : 'POG Tank Core Components', style: { marginBottom: 14 } },
        R.createElement('div', { style: gridR(3) },
          comps.map((c, i) => R.createElement('div', { key: i, style: { padding: 13, background: p.card2, borderRadius: 12, border: '1px solid ' + p.line } },
            R.createElement('div', { style: { fontSize: 13, fontWeight: 800, color: p.brand, marginBottom: 5 } }, c[0]),
            R.createElement('div', { style: { fontSize: 12, color: p.sub, lineHeight: 1.55 } }, c[1]))))),
      R.createElement('div', { style: Object.assign(gridR(3), { marginBottom: 14 }) },
        sizes.map((s, i) => R.createElement('div', { key: i, style: { background: p.card, border: '1px solid ' + p.line, borderRadius: 14, padding: 16, textAlign: 'center', boxShadow: p.shadow } },
          R.createElement('div', { style: { width: 46, height: 46, margin: '0 auto 8px', borderRadius: 12, background: 'linear-gradient(135deg,' + p.brand + ',' + p.brand2 + ')', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 800 } }, s[0]),
          R.createElement('div', { style: { fontSize: 12.5, color: p.sub } }, s[1])))),
      R.createElement('div', { style: Object.assign(gridR(3), { marginBottom: 14 }) },
        lines.map((l, i) => R.createElement(InvCard, { p, key: i, title: l[0] }, R.createElement('div', { style: { fontSize: 12.5, color: p.sub, lineHeight: 1.6 } }, l[1])))),
      R.createElement('div', { style: gridR(2) },
        R.createElement(InvCard, { p, title: tt.drinkTitle, note: lang === 'th' ? 'ทำสัญญาแล้ว 140 โครงการตั้งแต่ ต.ค.2024' : '140 contracts signed since Oct 2024' },
          R.createElement(InvBars, { p, items: INV_DRINK, color: p.accent })),
        R.createElement(InvCard, { p, title: tt.priceList },
          R.createElement('div', { style: { maxHeight: 300, overflow: 'auto' } },
            INV_PRODUCTS.map((pr, i) => R.createElement('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid ' + p.line } },
              R.createElement('div', null, R.createElement('span', { style: { fontWeight: 700, fontSize: 12.5 } }, pr.code), R.createElement('span', { style: { color: p.sub, fontSize: 11.5, marginLeft: 8 } }, pr.name + (m.prodCount[pr.code] ? ' · ' + m.prodCount[pr.code] + (lang === 'th' ? ' โครง' : '') : ''))),
              R.createElement('span', { style: { fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: p.brand } }, invFmt(pr.price)))))))
    );
  }

  // ── 4. Market Opportunity (deck p7–10) ────────────────────────────────────────
  function InvMarket({ p, tt, lang }) {
    const mk = INV_MARKET; const penPct = Math.round(mk.served / mk.villages * 1000) / 10;
    const pains = lang === 'th'
      ? ['ระบบกรองแบบ down-flow: ตะกอนรั่วผ่านชั้นกรอง คุณภาพน้ำขึ้นกับสภาพไส้กรอง', 'ซ่อมยาก: ท่อใต้ดินต้องใช้ช่างเฉพาะทาง น้ำสะอาดขาดช่วงระหว่างซ่อม', 'ต้องบำรุงรักษาบ่อย: ไม่มี backwash ต้องเปลี่ยนไส้กรองทุก 6 เดือน', 'ใช้พื้นที่ >625 ตร.ม. และต้องมีช่างหน้างานอย่างน้อย 3 คน', 'ต้องสำรวจน้ำดิบและสร้างเฉพาะที่ ใช้เวล่ากว่า 1 ปี', 'หลายหมู่บ้านไม่มีระบบกรองเลย ใช้สารส้มกรองเอง เสี่ยงสุขภาพ']
      : ['Down-flow filtration: sediment leaks through layers; quality depends on filter condition', 'Hard to fix: underground pipes need specialists; clean water interrupted during repair', 'Frequent maintenance: no backwash, filters replaced every 6 months', 'Uses >625 sqm and needs at least 3 on-site foremen', 'Must survey raw water and customise on-site — over a year to build', 'Many villages have no filtration at all; villagers use alum — a health risk'];
    const sols = lang === 'th'
      ? ['ติดตั้งเร็ว: ใช้พื้นที่เพียง ~80 ตร.ม. ช่างหน้างานคนเดียวคุมทั้งงาน', 'ระบบกรองทนทาน: backwash อัตโนมัติ อยู่ได้ 2 ปีไม่ต้องเปลี่ยน', 'ดูแลง่าย: ท่อบนดิน + ทีมช่างเข้าซ่อมภายใน 48 ชม.', 'ระบบเดียวจบ: รองรับน้ำดิบทุกแบบและทุกขนาดหมู่บ้าน ติดตั้ง 5 เดือน', 'คุณภาพเหนือมาตรฐาน: ผ่าน WHO + รับรอง สวทช. ด้วย ACFS และกรอง 7 ชั้นสองรอบ', 'ระบบ up-flow ต้านแรงโน้มถ่วง ลดการปนเปื้อนและตะกอนรั่ว']
      : ['Fast install: only ~80 sqm; one foreman oversees the whole job', 'Durable filtration: auto-backwash lasts 2 years with no replacement', 'Easy maintenance: on-ground pipes + repair within 48 hrs', 'A system that fits all: any raw water & village size, installs in 5 months', 'Quality beyond standard: WHO-passed + NSTDA-assured, ACFS & twice 7-layer filtration', 'Up-flow filtration works against gravity, minimising contamination & leakage'];
    return R.createElement('div', null,
      R.createElement('div', { style: Object.assign(gridR(4), { marginBottom: 16 }) },
        R.createElement(InvKpi, { p, label: tt.villages, value: invFmt(mk.villages), accent: p.brand }),
        R.createElement(InvKpi, { p, label: tt.withoutTap, value: invFmt(mk.withoutTap), sub: lang === 'th' ? 'หมู่บ้านยังขาดน้ำสะอาด' : 'villages lacking clean water', accent: p.bad }),
        R.createElement(InvKpi, { p, label: 'Water POG', value: invFmt(mk.served) + '+', sub: lang === 'th' ? 'โครงการที่ให้บริการแล้ว' : 'projects served', accent: p.accent }),
        R.createElement(InvKpi, { p, label: tt.mktUntapped, value: '90%+', sub: tt.mktPen, accent: p.gold })),
      R.createElement(InvCard, { p, title: tt.mktPen, note: tt.servedNote, style: { marginBottom: 16 } },
        R.createElement(InvSeg, { p, lang, items: [
          { th: 'มีประปาสะอาด', en: 'With clean tap water', pct: Math.round(mk.withTap / mk.villages * 100), color: p.brand },
          { th: 'ยังไม่มีประปาสะอาด', en: 'Without clean tap water', pct: Math.round(mk.withoutTap / mk.villages * 100), color: p.gold },
        ] }),
        R.createElement('div', { style: { fontSize: 12, color: p.sub, marginTop: 10 } }, lang === 'th' ? 'ตลาดกว่า 90% ยังไม่ถูกเจาะ — โอกาสเติบโตมหาศาลทั่วประเทศ' : 'Over 90% of the market is still untapped — a vast nationwide growth runway')),
      R.createElement('div', { style: gridR(2) },
        R.createElement(InvCard, { p, title: lang === 'th' ? '⚠️ ปัญหาระบบประปาแบบเดิม' : '⚠️ Pain Points of Existing Systems' },
          R.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
            pains.map((v, i) => R.createElement('div', { key: i, style: { display: 'flex', gap: 9, alignItems: 'flex-start' } },
              R.createElement('span', { style: { color: p.bad, fontWeight: 800 } }, '✕'), R.createElement('span', { style: { fontSize: 12.5, lineHeight: 1.5 } }, v))))),
        R.createElement(InvCard, { p, title: lang === 'th' ? '✓ POG Tank แก้ครบทุกจุด' : '✓ POG Tank Solves Every Pain Point' },
          R.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
            sols.map((v, i) => R.createElement('div', { key: i, style: { display: 'flex', gap: 9, alignItems: 'flex-start' } },
              R.createElement('span', { style: { color: p.good, fontWeight: 800 } }, '✓'), R.createElement('span', { style: { fontSize: 12.5, lineHeight: 1.5 } }, v))))))
    );
  }

  // ── 5. Financial Performance (deck p12) ───────────────────────────────────────
  function InvPerformance({ p, tt, m, lang }) {
    const revBars = INV_FIN_YEARS.map((y, i) => ({ label: y, value: INV_FIN[0].v[i] * 1e6 }));
    const finRows = INV_FIN.map(r => ({ bold: r.bold, cells: [(lang === 'th' ? r.th : r.en)].concat(r.v.map(x => ({ t: r.pct ? (x.toFixed(1) + '%') : invMn(x), neg: x < 0 }))) }));
    return R.createElement('div', null,
      R.createElement('div', { style: Object.assign(gridR(4), { marginBottom: 16 }) },
        R.createElement(InvKpi, { p, label: tt.revenue + ' 2025A', value: '958.3M', sub: tt.growth + ' 70.3% YoY', accent: p.brand }),
        R.createElement(InvKpi, { p, label: 'EBITDA 2025A', value: '88.5M', sub: '9.2% margin', accent: p.accent }),
        R.createElement(InvKpi, { p, label: (lang === 'th' ? 'กำไรสุทธิ' : 'Net Profit') + ' 2025A', value: '17.3M', sub: '1.8% NPM', accent: p.good }),
        R.createElement(InvKpi, { p, label: (lang === 'th' ? 'อัตรากำไรขั้นต้น' : 'Gross Margin') + ' 2025A', value: '27.3%', sub: lang === 'th' ? 'สูงขึ้นต่อเนื่อง' : 'improving trend', accent: p.gold })),
      R.createElement('div', { style: Object.assign(gridR(2), { marginBottom: 14 }) },
        R.createElement(InvCard, { p, title: tt.revenue + ' (2023A–2025A)', note: tt.finUnit }, R.createElement(InvBars, { p, items: revBars, money: true })),
        R.createElement(InvCard, { p, title: lang === 'th' ? 'จุดเด่นทางการเงิน' : 'Financial Highlights' },
          R.createElement('div', { style: { fontSize: 12.5, color: p.sub, lineHeight: 1.7 } },
            lang === 'th'
              ? 'รายได้ฟื้นตัวแรงจาก 562.6 ลบ. (2024A) เป็น 958.3 ลบ. (2025A) คิดเป็นการเติบโต 70.3% · อัตรากำไรขั้นต้นปรับขึ้นต่อเนื่อง 22.8% → 25.3% → 27.3% · พลิกกลับมามี EBITDA และกำไรสุทธิเป็นบวกในปี 2025A'
              : 'Revenue rebounded strongly from THB 562.6 mn (2024A) to THB 958.3 mn (2025A) — 70.3% growth · Gross margin improved steadily 22.8% → 25.3% → 27.3% · Returned to positive EBITDA and net profit in 2025A'))),
      R.createElement(InvCard, { p, title: lang === 'th' ? 'งบกำไรขาดทุนโดยสรุป' : 'Summary P&L', note: tt.finUnit },
        R.createElement(InvTable, { p, head: [lang === 'th' ? 'รายการ' : 'Item'].concat(INV_FIN_YEARS), rows: finRows })),
      R.createElement('div', { style: { fontSize: 11, color: p.sub, marginTop: 8 } }, lang === 'th' ? 'หมายเหตุ: ตัวเลขจากเอกสารนำเสนอนักลงทุน (Project Turtle) · ปรับปรุงด้วยมือเมื่อมีงบปีใหม่' : 'Note: figures from the investor deck (Project Turtle) · updated manually each new fiscal year')
    );
  }

  // ── editable cash-flow config per product (persisted via WTPOverride) ─────────
  // ── REAL cost data per product (from "ข้อมูลราคาต้นทุน.xlsx", 1 Jan 2569) ─────
  // goods = ค่าของ (ยอดเบิก งวด 1/2/3: มัดจำ/ผลิต/ประกอบ, รวม TANK+Room+โซลาร์)
  // inst  = ค่าติดตั้ง (ผู้รับเหมา: Advance/งวด1/งวด2 · น้ำดื่ม = Advance/–/งวดสุดท้าย)
  const INV_COST_GOODS = {
    PL: [1310215, 337585, 675170], PLS: [1310215, 337585, 675170],
    PM: [906825, 294785, 589570], PMS: [906825, 294785, 589570],
    PS: [673565, 246635, 493270], PSL: [1100495, 289435, 578870], PSM: [805442, 265092, 530185],
    PTIIS: [1782754, 447929, 895858], 'PTII+S': [1782754, 447929, 895858],
    STII: [1296974, 303479, 606958], 'STII+S': [1296974, 303479, 606958],
    PD: [368080, 107000, 214000], PDH: [437898, 129738, 259475], PDP: [529650, 149800, 299600],
  };
  const INV_COST_INST = {
    PL: [602592, 602592, 301296], PLS: [669200, 669200, 334600],
    PM: [402000, 402000, 201000], PMS: [468600, 468600, 234300],
    PTIIS: [696640, 696640, 348320], 'PTII+S': [763232, 763232, 381616],
    STII: [488000, 488000, 244000], 'STII+S': [553400, 553400, 276700],
    PD: [44800, 0, 83200], PDH: [54948, 0, 102047], PDP: [59896, 0, 111234],
  };
  const INV_CF_DEF = (code, c) => {
    const g = INV_COST_GOODS[code] || [Math.round(c * 0.43 * 0.55), Math.round(c * 0.43 * 0.15), Math.round(c * 0.43 * 0.30)];
    const i = INV_COST_INST[code] || [Math.round(c * 0.24 * 0.4), Math.round(c * 0.24 * 0.4), Math.round(c * 0.24 * 0.2)];
    return { contract: c, g1: g[0], g2: g[1], g3: g[2], i1: i[0], i2: i[1], i3: i[2], commPct: 6, lgPct: 5, m1Pct: 40, m2Pct: 60 };
  };
  function InvNumIn({ p, value, onChange, onBlur, w, big }) {
    return el('input', { type: 'number', value: (value === 0 || value == null) ? '' : value, placeholder: '0',
      onChange: e => onChange(e.target.value === '' ? 0 : Number(e.target.value)), onBlur: onBlur,
      style: { width: w || 88, height: big ? 36 : 30, border: '1px solid ' + p.line, borderRadius: 9, padding: '0 9px', background: p.card2, color: p.ink, fontSize: big ? 16 : 14, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } });
  }

  // day number relative to signing (วันลงนาม = วันที่ 1); drives the timeline node + timing pills
  const invDayNode = (d) => d < 0 ? '−' + Math.abs(d) : String(d);
  const invDayPill = (d, lang) => d < 1
    ? (lang === 'th' ? ('ก่อนลงนาม ' + (1 - d) + ' วัน') : ((1 - d) + ' days before signing'))
    : (lang === 'th' ? ('วันที่ ' + d) : ('Day ' + d));

  // build the ordered cash-flow GROUPS (events on the same day share one axis point)
  // d = วันที่นับจากวันลงนาม (ลงนาม = วันที่ 1, ค่าติดลบ = ก่อนลงนาม)
  function invCfGroups(cfg) {
    const C = cfg.contract || 0;
    return [
      { d: -44, t: ['ได้รับใบจัดสรร', 'Allocation letter'], items: [
        { k: 'mark', th: ['ได้รับใบจัดสรร'], en: ['Allocation letter received'] } ] },
      { d: -14, t: ['มัดจำค่าของ', 'Goods deposit'], items: [
        { k: 'out', edit: 'thb', f: 'g1', amt: cfg.g1, tag: ['ค่าของ ง.1', 'Goods #1'], th: ['ค่าของ งวด 1 (มัดจำ)'], en: ['Goods lot 1 (deposit)'] } ] },
      { d: -6, t: ['ออก LG ค้ำประกัน', 'Issue LG'], items: [
        { k: 'out', edit: 'pct', f: 'lgPct', amt: C * cfg.lgPct / 100, pv: cfg.lgPct, tag: ['LG ค้ำประกัน', 'LG'], th: ['ออก LG ค้ำประกัน'], en: ['Issue bank guarantee (LG)'] } ] },
      { d: 1, t: ['ลงนามสัญญา', 'Contract signing'], items: [
        { k: 'mark', th: ['ลงนามสัญญา'], en: ['Contract signing'] },
        { k: 'out', edit: 'pct', f: 'commPct', amt: C * cfg.commPct / 100, pv: cfg.commPct, tag: ['คอมมิชชั่น', 'Commission'], th: ['จ่ายค่าคอมมิชชั่น'], en: ['Pay commission'] },
        { k: 'out', edit: 'thb', f: 'i1', amt: cfg.i1, tag: ['ค่าติดตั้ง ล่วงหน้า', 'Install adv.'], th: ['ค่าติดตั้ง ล่วงหน้า'], en: ['Installation advance'] } ] },
      { d: 61, t: ['เริ่มงานถัง', 'Tank work begins'], items: [
        { k: 'mark', th: ['เริ่มงานถัง'], en: ['Tank work begins'] } ] },
      { d: 68, t: ['จ่ายค่าของ ง.2', 'Pay goods #2'], items: [
        { k: 'out', edit: 'thb', f: 'g2', amt: cfg.g2, tag: ['ค่าของ ง.2', 'Goods #2'], th: ['ค่าของ งวด 2 (ผลิต)'], en: ['Goods lot 2 (production)'] } ] },
      { d: 75, t: ['ส่งมอบงานงวด 1', 'Deliver M1'], items: [
        { k: 'mark', th: ['ส่งมอบงานงวด 1', 'เคลม 40% ของมูลค่าโครงการ'], en: ['Deliver milestone 1', 'Claim 40% of project value'] },
        { k: 'out', edit: 'thb', f: 'i2', amt: cfg.i2, tag: ['ค่าติดตั้ง ง.1', 'Install #1'], th: ['ค่าติดตั้ง งวด 1'], en: ['Installation lot 1'] },
        { k: 'out', edit: 'thb', f: 'g3', amt: cfg.g3, tag: ['ค่าของ ง.สุดท้าย', 'Goods final'], th: ['ค่าของ งวดสุดท้าย (ประกอบ)'], en: ['Goods final lot (assembly)'] } ] },
      { d: 105, t: ['รับเงินงวด 1', 'Receive #1'], items: [
        { k: 'in', edit: 'pct', f: 'm1Pct', amt: C * cfg.m1Pct / 100, pv: cfg.m1Pct, tag: ['รับงวด 1', 'Receive #1'], th: ['รับเงินงวด 1 (40%)'], en: ['Cash received #1 (40%)'] } ] },
      { d: 128, t: ['ส่งมอบงวด 2', 'Deliver M2'], items: [
        { k: 'mark', th: ['ส่งมอบงานงวด 2'], en: ['Deliver milestone 2'] },
        { k: 'out', edit: 'thb', f: 'i3', amt: cfg.i3, tag: ['ค่าติดตั้ง ง.สุดท้าย', 'Install final'], th: ['ค่าติดตั้ง งวดสุดท้าย'], en: ['Installation final'] } ] },
      { d: 158, t: ['รับเงินงวดสุดท้าย', 'Final receipt'], items: [
        { k: 'in', edit: 'pct', f: 'm2Pct', amt: C * cfg.m2Pct / 100, pv: cfg.m2Pct, tag: ['รับงวดสุดท้าย', 'Receive final'], th: ['รับเงินงวดสุดท้าย (60%)'], en: ['Final cash received (60%)'] } ] },
      { d: 731, t: ['คืน LG ค้ำประกัน', 'LG returned'], items: [
        { k: 'in', edit: 'pct', f: 'lgPct', amt: C * cfg.lgPct / 100, pv: cfg.lgPct, ret: true, tag: ['LG คืน', 'LG back'], th: ['ได้รับ LG คืน'], en: ['Bank guarantee returned'] } ] },
    ];
  }

  // ── 6. Project Economics — interactive cash-flow timeline (deck p13–14) ───────
  function InvEconomics({ p, tt, lang }) {
    const [code, setCode] = invSt('PL');
    const [drill, setDrill] = invSt(null);   // เปิด modal แจกแจงรายสเต็ป (index ของ group)
    const prod = INV_PRODUCTS.find(x => x.code === code) || INV_PRODUCTS[0];
    // numbers come straight from each product's standard cost data — read-only (no manual entry)
    const cfg = INV_CF_DEF(code, prod.price);

    const C = cfg.contract || 0;
    const groups = invCfGroups(cfg);
    const pctOf = (a) => C ? (a / C * 100).toFixed(1) : '0.0';
    // per day-group cash flow + running cumulative balance (the cash "valley" story)
    let run = 0, minRun = 0, valleyIdx = 0, beforeRecv1 = 0, seenIn = false, totIn = 0, totOut = 0;
    const gs = groups.map((g, i) => {
      const inn = g.items.filter(it => it.k === 'in').reduce((s, it) => s + it.amt, 0);
      const out = g.items.filter(it => it.k === 'out').reduce((s, it) => s + it.amt, 0);
      const net = inn - out;
      if (inn > 0 && !seenIn) { beforeRecv1 = -run; seenIn = true; }
      run += net; if (run < minRun) { minRun = run; valleyIdx = i; }
      totIn += inn; totOut += out;
      const type = net > 0 ? 'in' : (net < 0 ? 'out' : 'event');
      return { g, i, inn, out, net, bal: run, type };
    });
    const peak = -minRun;
    const netAtClose = totIn - totOut;
    const maxAbs = Math.max(1, peak);
    let flipIdx = -1; if (peak > 0) for (let i = 0; i < gs.length; i++) { if (gs[i].bal > 0) { flipIdx = i; break; } }
    const goodsTot = cfg.g1 + cfg.g2 + cfg.g3, instTot = cfg.i1 + cfg.i2 + cfg.i3;
    const margin = C - (goodsTot + instTot + C * cfg.commPct / 100);
    const costSeg = [
      { th: 'ค่าของ (Inventory)', en: 'Inventory', pct: Math.round(goodsTot / (C || 1) * 100), color: p.brand },
      { th: 'ค่าติดตั้ง', en: 'Installation', pct: Math.round(instTot / (C || 1) * 100), color: p.brand2 },
      { th: 'คอมมิชชั่น', en: 'Commission', pct: Math.round(cfg.commPct), color: p.gold },
      { th: 'กำไรขั้นต้น', en: 'Margin', pct: Math.max(0, Math.round(margin / (C || 1) * 100)), color: p.accent },
    ];

    const [tlFull, setTlFull] = invSt(false);
    invEff(() => { if (!tlFull) return; const onKey = (e) => { if (e.key === 'Escape') setTlFull(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [tlFull]);
    invEff(() => { if (drill == null) return; const onKey = (e) => { if (e.key === 'Escape') setDrill(null); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [drill]);

    // layout metrics — per-event columns, node on a gradient axis, premium card below
    const lay = (big) => ({
      w: big ? 300 : 256, pillH: big ? 34 : 30, nodeH: big ? 56 : 50, node: big ? 48 : 42,
      get lineY() { return this.pillH + this.nodeH / 2; },
      title: big ? 14.5 : 13, val: big ? 25 : 21, sub: big ? 12 : 11, inW: big ? 122 : 102,
    });

    // one premium event card — phase tag · big ฿ · % bar · cumulative · depth bar (read-only)
    const buildEventCard = (gd, L, big) => {
      const { g, i, type, inn, out, bal } = gd;
      const col = type === 'out' ? p.bad : (type === 'in' ? p.good : p.brand);
      const icon = type === 'event' ? '◆' : '';
      const prim = g.items[0];
      const title = (lang === 'th' ? prim.th : prim.en)[0];
      const enLine = (lang === 'th' ? prim.en : prim.th)[0];
      const extra = (lang === 'th' ? prim.th : prim.en)[1] || '';
      const flow = type === 'out' ? out : (type === 'in' ? inn : 0);
      const flowItems = type === 'event' ? [] : g.items.filter(it => it.k === (type === 'in' ? 'in' : 'out'));
      const isValley = i === valleyIdx && peak > 0, isFlip = i === flipIdx;
      const badge = isValley ? (lang === 'th' ? 'จุดต่ำสุด' : 'Lowest point') : (isFlip ? (lang === 'th' ? 'พลิกเป็นบวก' : 'Turns positive') : '');
      const badgeCol = isValley ? p.gold : p.good;
      const phaseTag = type === 'event' ? (lang === 'th' ? 'เริ่มโครงการ' : 'Start') : (i <= valleyIdx ? (lang === 'th' ? 'ระยะลงทุน' : 'Investment') : (lang === 'th' ? 'ระยะเก็บเงิน' : 'Collection'));
      const boxCol = isValley ? p.gold : (isFlip ? p.good : col);  // สีของ "กล่องจำนวนเงิน" (กรอบเดียวที่เหลือ)
      const pctNum = type === 'event' ? 0 : Math.min(100, flow / (C || 1) * 100);
      const depthPct = Math.min(100, Math.abs(bal) / maxAbs * 100);
      // headline — read-only standard amount
      const headline = type === 'event'
        ? el('div', { style: { fontSize: L.val - 5, fontWeight: 800, color: p.sub } }, lang === 'th' ? 'เริ่มต้น' : 'Start')
        : el('div', { style: { fontSize: L.val, fontWeight: 800, color: col, fontVariantNumeric: 'tabular-nums' } }, (type === 'out' ? '−' : '+') + invCompact(flow));
      return el('div', { style: { position: 'relative', padding: big ? '14px 6px 8px' : '12px 5px 6px' } },
        badge ? el('div', { style: { position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 9.5, fontWeight: 800, padding: '3px 11px', borderRadius: 7, background: badgeCol, color: '#fff', boxShadow: '0 6px 16px -3px ' + invRgba(badgeCol, 0.6) } }, badge) : null,
        el('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
          el('div', { style: { width: big ? 27 : 24, height: big ? 27 : 24, borderRadius: 8, background: invRgba(col, 0.12), color: col, display: 'grid', placeItems: 'center', fontSize: big ? 14 : 12, fontWeight: 800, flex: '0 0 auto' } }, icon),
          el('span', { style: { fontSize: 9, letterSpacing: '0.03em', padding: '2px 8px', borderRadius: 6, background: invRgba(col, 0.12), color: col, fontWeight: 800 } }, phaseTag),
          el('span', { style: { marginLeft: 'auto', fontSize: 10, color: p.sub, fontWeight: 700, fontFamily: 'monospace' } }, '#' + (i + 1))),
        el('div', { style: { fontSize: L.title, fontWeight: 800, color: p.ink, lineHeight: 1.25, marginTop: 10, minHeight: big ? 34 : 30 } }, title),
        el('div', { style: { fontSize: L.sub, color: p.sub, marginTop: 2, fontWeight: 600 } }, enLine),
        extra ? el('div', { style: { fontSize: L.sub, color: col, marginTop: 3, fontWeight: 700, lineHeight: 1.35 } }, extra) : null,
        el('div', { style: { marginTop: 9, borderRadius: 10, padding: big ? '8px 11px' : '7px 9px', background: invRgba(boxCol, 0.08), border: '1px solid ' + invRgba(boxCol, 0.3) } },
          el('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 } },
            headline,
            el('span', { style: { fontSize: big ? 10 : 9, color: p.sub, fontWeight: 600, whiteSpace: 'nowrap', flex: '0 0 auto' } }, type === 'event' ? (lang === 'th' ? 'จุดเริ่ม' : 'Start') : (pctOf(flow) + (lang === 'th' ? '% ของสัญญา' : '% of contract')))),
          flowItems.length > 1
            ? el('div', { style: { marginTop: 7, paddingTop: 6, borderTop: '1px dashed ' + invRgba(col, 0.3), display: 'flex', flexDirection: 'column', gap: 4 } },
                flowItems.map((it, j) => el('div', { key: j, style: { display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: big ? 11.5 : 10.5 } },
                  el('span', { style: { color: p.sub, fontWeight: 600 } }, (lang === 'th' ? it.tag[0] : it.tag[1])),
                  el('span', { style: { color: col, fontWeight: 800, fontVariantNumeric: 'tabular-nums' } }, (type === 'in' ? '+' : '−') + invCompact(it.amt) + ' · ' + pctOf(it.amt) + '%'))))
            : (flowItems.length === 1 && flowItems[0].tag ? el('div', { style: { marginTop: 5, fontSize: big ? 11.5 : 10.5, color: col, fontWeight: 700 } }, (lang === 'th' ? flowItems[0].tag[0] : flowItems[0].tag[1]) + ' · ' + pctOf(flowItems[0].amt) + '% ' + (lang === 'th' ? 'ของสัญญา' : 'of contract')) : null),
          type === 'event' ? null : el('div', { style: { marginTop: 6, height: 4, borderRadius: 2, background: invRgba(p.ink, 0.07), overflow: 'hidden' } },
            el('div', { style: { height: '100%', borderRadius: 2, width: pctNum.toFixed(1) + '%', background: 'linear-gradient(90deg,' + invRgba(col, 0.6) + ',' + col + ')' } }))),
        el('div', { style: { marginTop: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
          el('span', { style: { fontSize: 9.5, color: p.sub } }, lang === 'th' ? 'คงเหลือสะสม' : 'Cumulative'),
          el('span', { style: { fontSize: 13, fontWeight: 800, color: bal < 0 ? p.bad : (bal > 0 ? p.good : p.sub), fontVariantNumeric: 'tabular-nums' } }, (bal < 0 ? '−' : (bal > 0 ? '+' : '')) + invCompact(Math.abs(bal)))),
        el('div', { style: { marginTop: 5, position: 'relative', height: 6, borderRadius: 4, background: invRgba(p.ink, 0.06), overflow: 'hidden' } },
          el('div', { style: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 4, width: depthPct.toFixed(1) + '%', background: bal < 0 ? 'linear-gradient(90deg,' + invRgba(p.bad, 0.4) + ',' + p.bad + ')' : (bal > 0 ? 'linear-gradient(90deg,' + p.good + ',' + invRgba(p.good, 0.4) + ')' : 'transparent') } })));
    };

    // one timeline column: timing pill · node circle (= วันที่นับจากลงนาม) on axis · premium card
    const column = (big) => (gd) => {
      const L = lay(big);
      const col = gd.type === 'out' ? p.bad : (gd.type === 'in' ? p.good : p.brand);
      const isPre = gd.g.d < 1;
      const dcap = isPre ? (lang === 'th' ? 'ก่อน' : 'PRE') : (lang === 'th' ? 'วันที่' : 'DAY');
      const dnum = isPre ? String(1 - gd.g.d) : String(gd.g.d);
      const dFont = dnum.length >= 3 ? (big ? 16 : 14) : (big ? 21 : 19);
      return el('div', { key: gd.i, onClick: () => setDrill(gd.i), title: lang === 'th' ? 'คลิกเพื่อแจกแจงรายละเอียด' : 'Click for breakdown', style: { flex: '0 0 ' + L.w + 'px', width: L.w, padding: '0 13px', position: 'relative', zIndex: 1, cursor: 'pointer' } },
        el('div', { style: { height: L.pillH, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' } },
          el('span', { style: { fontSize: big ? 11 : 10, color: p.sub, background: p.card2, border: '1px solid ' + p.line, padding: '3px 10px', borderRadius: 99, whiteSpace: 'nowrap', lineHeight: 1.2 } }, invDayPill(gd.g.d, lang) + ' · ' + (lang === 'th' ? gd.g.t[0] : gd.g.t[1]))),
        el('div', { style: { height: L.nodeH, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
          el('div', { style: { width: L.node, height: L.node, borderRadius: '50%', background: p.card, border: '2.5px solid ' + col, color: col, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1, boxShadow: '0 0 0 5px ' + p.card + ', 0 6px 16px -2px ' + invRgba(col, 0.5) } },
            el('div', { style: { fontSize: big ? 7.5 : 7, fontWeight: 700, letterSpacing: '0.04em', opacity: 0.72, marginBottom: 1.5 } }, dcap),
            el('div', { style: { fontSize: dFont, fontWeight: 800, fontVariantNumeric: 'tabular-nums' } }, dnum))),
        buildEventCard(gd, L, big));
    };

    const renderTimeline = (big) => { const L = lay(big);
      const invN = valleyIdx + 1, colN = gs.length - invN, totW = gs.length * L.w;
      const phaseBar = (col, span, th, en, sub, arrow, fromLeft) => el('div', { style: { flex: '0 0 ' + (span * L.w) + 'px', width: span * L.w } },
        el('div', { style: { margin: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 15px', borderRadius: 13, background: 'linear-gradient(90deg,' + invRgba(col, fromLeft ? 0.13 : 0.02) + ',' + invRgba(col, fromLeft ? 0.02 : 0.14) + ')', border: '1px solid ' + invRgba(col, 0.2) } },
          el('div', null,
            el('div', { style: { fontSize: 12.5, fontWeight: 800, color: col } }, lang === 'th' ? th : en),
            el('div', { style: { fontSize: 10.5, color: p.sub, marginTop: 1 } }, sub)),
          el('span', { style: { fontSize: 11, color: col, opacity: 0.7, fontWeight: 800 } }, arrow)));
      return el('div', { style: { overflowX: 'auto', overflowY: 'hidden', paddingTop: 4, paddingBottom: 12 } },
        el('div', { style: { display: 'inline-block', minWidth: '100%' } },
          el('div', { style: { display: 'inline-flex', width: totW, padding: '0 8px 14px' } },
            phaseBar(p.bad, invN, 'ระยะลงทุน · Investment', 'Investment phase',
              (lang === 'th' ? 'จ่ายสะสม ' : 'Outflow ') + invCompact(totOut) + ' · ' + (lang === 'th' ? 'ขุดลึกสุด ' : 'deepest ') + '−' + invCompact(peak), '↓', true),
            colN > 0 ? phaseBar(p.good, colN, 'ระยะเก็บเงิน · Collection', 'Collection phase',
              (lang === 'th' ? 'รับกลับ ' : 'Inflow ') + invCompact(totIn) + ' · ' + (lang === 'th' ? 'พลิกเป็นกำไร ' : 'profit ') + invCompact(margin), '↑', false) : null),
          el('div', { style: { position: 'relative', display: 'inline-flex', alignItems: 'flex-start', width: totW } },
            el('div', { style: { position: 'absolute', left: L.w / 2, right: L.w / 2, top: L.lineY - 3, height: 6, borderRadius: 4, background: 'linear-gradient(90deg,' + invRgba(p.bad, 0.65) + ' 0%,' + invRgba(p.gold, 0.6) + ' 52%,' + invRgba(p.good, 0.7) + ' 100%)', boxShadow: '0 3px 16px ' + invRgba(p.brand, 0.22), zIndex: 0 } }),
            gs.map(column(big))))); };

    const products = INV_PRODUCTS.map(pr => el('option', { key: pr.code, value: pr.code }, pr.code + ' · ' + pr.name + ' (' + invCompact(pr.price) + ')'));
    const productSelect = (w) => el('select', { value: code, onChange: e => setCode(e.target.value), style: { height: 34, minWidth: w || 240, border: '1px solid ' + p.line, borderRadius: 8, padding: '0 10px', background: p.card2, color: p.ink, fontSize: 12.5, fontWeight: 600 } }, products);
    const pipe = lang === 'th'
      ? [['งบประมาณรัฐที่ยืนยันแล้ว', 300], ['งานใน Backlog', 900], ['รวมทั้งหมด', 1200, true], ['เงินทุนที่ต้องใช้ทุกโครงการ', 900], ['สินเชื่อที่คาดว่าต้องใช้', '200–300']]
      : [['Confirmed government budget', 300], ['Backlog projects', 900], ['Total', 1200, true], ['Funding required for all projects', 900], ['Expected loans required', '200–300']];
    const legend = el('div', { style: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, color: p.sub } },
      [[p.bad, lang === 'th' ? 'จ่ายออก' : 'cash out'], [p.good, lang === 'th' ? 'รับเข้า' : 'cash in'], [p.brand, lang === 'th' ? 'เหตุการณ์' : 'milestone']].map((g, i) =>
        el('span', { key: i, style: { display: 'flex', alignItems: 'center', gap: 6 } }, el('span', { style: { width: 9, height: 9, borderRadius: '50%', background: g[0], display: 'inline-block' } }), g[1])));
    // premium KPI row — hero gold "lowest point" card (shimmer) + gross profit / contract / net-at-close
    const kpiRow = (mb) => el('div', { style: { display: 'grid', gridTemplateColumns: window.innerWidth < 760 ? '1fr' : '1.35fr 1fr 1fr 1fr', gap: 14, marginBottom: mb } },
      el('div', { style: { position: 'relative', overflow: 'hidden', borderRadius: 18, padding: '20px 22px', background: 'linear-gradient(155deg,' + invRgba(p.gold, 0.16) + ',' + invRgba(p.gold, 0.06) + ')', border: '1px solid ' + invRgba(p.gold, 0.35), boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 20px 40px -24px ' + invRgba(p.gold, 0.6) } },
        el('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(110deg,transparent 35%,' + invRgba('#ffffff', 0.5) + ' 50%,transparent 65%)', backgroundSize: '200% 100%', animation: 'invShimmer 6.5s linear infinite', pointerEvents: 'none' } }),
        el('div', { style: { fontSize: 12, color: p.gold, fontWeight: 700 } }, '▼ ' + (lang === 'th' ? 'จุดต่ำสุด — ต้องสำรองเงินทุน' : 'Lowest point — capital reserve needed')),
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 9 } },
          el('div', { style: { fontSize: 42, fontWeight: 800, lineHeight: 1, color: p.gold, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' } }, invCompact(peak)),
          el('div', { style: { fontSize: 11.5, color: p.sub, lineHeight: 1.25, whiteSpace: 'pre-line' } }, lang === 'th' ? 'เงินทุนสูงสุด\nที่ต้องสำรอง' : 'Peak capital\nneed')),
        el('div', { style: { marginTop: 13, height: 6, borderRadius: 4, background: invRgba(p.gold, 0.18), overflow: 'hidden' } },
          el('div', { style: { width: Math.min(100, C ? peak / C * 100 : 0).toFixed(1) + '%', height: '100%', borderRadius: 4, background: 'linear-gradient(90deg,' + invRgba(p.gold, 0.7) + ',' + p.gold + ')' } })),
        el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 7, fontSize: 11, color: p.sub } },
          el('span', null, pctOf(peak) + (lang === 'th' ? '% ของมูลค่าสัญญา' : '% of contract')),
          el('span', null, (lang === 'th' ? 'จ่ายก่อนรับงวดแรก ' : 'before 1st receipt ') + invCompact(beforeRecv1)))),
      el('div', { style: { borderRadius: 18, padding: '20px 22px', background: p.card, border: '1px solid ' + invRgba(p.good, 0.3), boxShadow: p.shadow } },
        el('div', { style: { fontSize: 12, color: p.good, fontWeight: 700 } }, lang === 'th' ? 'กำไรขั้นต้น · Gross Profit' : 'Gross Profit'),
        el('div', { style: { fontSize: 34, fontWeight: 800, lineHeight: 1, marginTop: 11, color: p.good, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' } }, invCompact(margin)),
        el('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 12, background: invRgba(p.good, 0.1), border: '1px solid ' + invRgba(p.good, 0.22), color: p.good, fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 7 } }, '▲ ' + (lang === 'th' ? 'อัตรากำไร ' : 'margin ') + pctOf(margin) + '%')),
      el('div', { style: { borderRadius: 18, padding: '20px 22px', background: p.card, border: '1px solid ' + p.line, boxShadow: p.shadow } },
        el('div', { style: { fontSize: 12, color: p.sub, fontWeight: 700 } }, lang === 'th' ? 'มูลค่าสัญญา · Contract' : 'Contract value'),
        el('div', { style: { fontSize: 34, fontWeight: 800, lineHeight: 1, marginTop: 11, color: p.ink, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' } }, invCompact(C)),
        el('div', { style: { fontSize: 11.5, color: p.sub, marginTop: 12 } },
          (lang === 'th' ? 'รวมรับ ' : 'in '), el('b', { style: { color: p.good } }, invCompact(totIn)),
          (lang === 'th' ? ' · จ่าย ' : ' · out '), el('b', { style: { color: p.bad } }, invCompact(totOut)))),
      el('div', { style: { borderRadius: 18, padding: '20px 22px', background: p.card, border: '1px solid ' + invRgba(p.brand, 0.25), boxShadow: p.shadow } },
        el('div', { style: { fontSize: 12, color: p.brand, fontWeight: 700 } }, lang === 'th' ? 'คงเหลือเมื่อจบ · Net at close' : 'Net at close'),
        el('div', { style: { fontSize: 34, fontWeight: 800, lineHeight: 1, marginTop: 11, color: p.brand, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' } }, invCompact(netAtClose)),
        el('div', { style: { fontSize: 11.5, color: p.sub, marginTop: 12 } }, lang === 'th' ? 'หลังคืน LG · ระยะเวลา ~2 ปี' : 'after LG returned · ~2 yr horizon')));
    // step-by-step cash table — numbered chips, red/green balance bars, gold total row
    const stepTable = () => {
      const cell = (txt, color, weight, size) => el('td', { style: { padding: '15px 14px', textAlign: 'right', borderBottom: '1px solid ' + invRgba(p.ink, 0.06), fontVariantNumeric: 'tabular-nums', color: color || p.ink, fontWeight: weight || 700, fontSize: size || 18, whiteSpace: 'nowrap' } }, txt);
      return el(InvCard, { p, title: lang === 'th' ? 'สรุปกระแสเงินสดรายสเต็ป' : 'Step-by-step cash flow', note: lang === 'th' ? '👆 คลิกแถวเพื่อแจกแจง · คงเหลือสะสมติดลบ = ต้องใช้เงินทุน/สินเชื่อ' : '👆 click a row for detail · negative cumulative = funding needed', style: { marginBottom: 14 } },
        el('div', null,
          el('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 18, tableLayout: 'fixed' } },
            el('thead', null, el('tr', { style: { fontSize: 14, color: p.sub, letterSpacing: '0.04em' } },
              [['ขั้นตอน', 'Step', 'left', '32%'], ['รับ', 'In', 'right', '14%'], ['จ่าย', 'Out', 'right', '14%'], ['สุทธิ', 'Net', 'right', '15%'], ['คงเหลือสะสม', 'Cumulative', 'right', '25%']].map((h, i) =>
                el('th', { key: i, style: { textAlign: h[2], padding: '0 14px 12px', fontWeight: 700, borderBottom: '1px solid ' + p.line, width: h[3], whiteSpace: 'nowrap' } }, lang === 'th' ? h[0] : h[1])))),
            el('tbody', null,
              gs.map((gd) => {
                const col = gd.type === 'out' ? p.bad : (gd.type === 'in' ? p.good : p.brand);
                const isValley = gd.i === valleyIdx && peak > 0, isFlip = gd.i === flipIdx;
                const rowBg = isValley ? invRgba(p.gold, 0.08) : (isFlip ? invRgba(p.good, 0.07) : 'transparent');
                const half = Math.min(50, Math.abs(gd.bal) / maxAbs * 50);
                const barStyle = gd.bal < 0
                  ? { position: 'absolute', top: 0, bottom: 0, right: '50%', width: half + '%', background: 'linear-gradient(90deg,' + invRgba(p.bad, 0.25) + ',' + p.bad + ')', borderRadius: 5 }
                  : (gd.bal > 0 ? { position: 'absolute', top: 0, bottom: 0, left: '50%', width: half + '%', background: 'linear-gradient(90deg,' + p.good + ',' + invRgba(p.good, 0.25) + ')', borderRadius: 5 } : { width: 0 });
                const prim = gd.g.items[0];
                const cashIts = gd.g.items.filter(it => it.k === 'in' || it.k === 'out');
                const chips = cashIts.length
                  ? el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 } },
                      cashIts.map((it, j) => { const ic = it.k === 'in' ? p.good : p.bad;
                        return el('span', { key: j, style: { fontSize: 12.5, fontWeight: 700, padding: '2px 9px', borderRadius: 7, background: invRgba(ic, 0.1), color: ic, whiteSpace: 'nowrap' } },
                          (lang === 'th' ? it.tag[0] : it.tag[1]) + ' · ' + pctOf(it.amt) + '% · ' + (it.k === 'in' ? '+' : '−') + invCompact(it.amt)); }))
                  : el('div', { style: { marginTop: 7, fontSize: 12.5, color: p.sub, fontWeight: 600 } }, lang === 'th' ? '◆ เหตุการณ์ (ไม่มีกระแสเงิน)' : '◆ Milestone (no cash)');
                return el('tr', { key: gd.i, onClick: () => setDrill(gd.i), title: lang === 'th' ? 'คลิกเพื่อแจกแจงรายละเอียด' : 'Click for breakdown', style: { background: rowBg, borderLeft: '3px solid ' + (isValley ? p.gold : (isFlip ? p.good : 'transparent')), cursor: 'pointer' } },
                  el('td', { style: { padding: '15px 14px', borderBottom: '1px solid ' + invRgba(p.ink, 0.06) } },
                    el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 13 } },
                      el('span', { style: { flex: '0 0 auto', width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 800, background: invRgba(col, 0.12), color: col } }, gd.i + 1),
                      el('span', { style: { minWidth: 0 } },
                        el('span', { style: { fontSize: 18, fontWeight: 700, color: p.ink } }, (lang === 'th' ? prim.th : prim.en)[0]),
                        el('span', { style: { display: 'block', fontSize: 14, color: p.sub, marginTop: 2 } }, invDayPill(gd.g.d, lang) + ' · ' + (lang === 'th' ? gd.g.t[0] : gd.g.t[1])),
                        chips))),
                  cell(gd.inn ? invCompact(gd.inn) : '—', gd.inn ? p.good : invRgba(p.ink, 0.3)),
                  cell(gd.out ? invCompact(gd.out) : '—', gd.out ? p.bad : invRgba(p.ink, 0.3)),
                  cell((gd.net >= 0 ? '+' : '−') + invCompact(Math.abs(gd.net)), gd.net < 0 ? p.bad : (gd.net > 0 ? p.good : p.sub), 700),
                  el('td', { style: { padding: '13px 16px', borderBottom: '1px solid ' + invRgba(p.ink, 0.06) } },
                    el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 } },
                      el('div', { style: { position: 'relative', flex: 1, height: 11, background: invRgba(p.ink, 0.06), borderRadius: 6 } },
                        el('div', { style: { position: 'absolute', top: '50%', left: '50%', width: 1, height: 16, transform: 'translate(-50%,-50%)', background: invRgba(p.ink, 0.18) } }),
                        el('div', { style: barStyle })),
                      el('span', { style: { fontWeight: 800, fontSize: 18, minWidth: 96, textAlign: 'right', color: gd.bal < 0 ? p.bad : (gd.bal > 0 ? p.good : p.sub), fontVariantNumeric: 'tabular-nums' } }, (gd.bal < 0 ? '−' : (gd.bal > 0 ? '+' : '')) + invCompact(Math.abs(gd.bal))))));
              }),
              el('tr', { style: { background: invRgba(p.gold, 0.1), borderTop: '2px solid ' + invRgba(p.gold, 0.4) } },
                el('td', { style: { padding: '16px 14px', fontWeight: 800, fontSize: 18.5, color: p.gold } }, lang === 'th' ? 'รวมทั้งหมด' : 'Total'),
                cell(invFmt(totIn), p.good, 800, 18),
                cell(invFmt(totOut), p.bad, 800, 18),
                cell((netAtClose >= 0 ? '+' : '−') + invFmt(Math.abs(netAtClose)), netAtClose < 0 ? p.bad : p.good, 800, 18),
                cell((netAtClose < 0 ? '−' : '') + invFmt(Math.abs(netAtClose)), p.gold, 800, 19)))),
        ),
        el('div', { style: { marginTop: 14, padding: '13px 16px', borderRadius: 12, background: p.card2, border: '1px solid ' + p.line, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 13, color: p.sub } },
          el('span', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, el('span', { style: { width: 9, height: 9, borderRadius: '50%', background: p.gold } }), (lang === 'th' ? 'จุดต่ำสุด (ต้องใช้เงินทุน) ' : 'Lowest point '), el('b', { style: { color: p.gold } }, invCompact(peak))),
          el('span', { style: { width: 1, height: 16, background: p.line } }),
          el('span', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, el('span', { style: { width: 9, height: 9, borderRadius: '50%', background: p.good } }), (lang === 'th' ? 'กำไรขั้นต้นเมื่อจบโครงการ ' : 'Gross margin at close '), el('b', { style: { color: p.good } }, invCompact(margin) + ' (' + pctOf(margin) + '%)'))));
    };

    // click-through breakdown — แจกแจงแต่ละสเต็ปว่าเป็น "ค่าอะไร · งวดไหน · กี่% · กี่บาท"
    const catOf = (it) => {
      const f = it.f || '';
      if (f.charAt(0) === 'g') return { th: 'ค่าของ', en: 'Goods', c: p.brand };
      if (f.charAt(0) === 'i') return { th: 'ค่าติดตั้ง', en: 'Installation', c: p.brand2 };
      if (f === 'commPct') return { th: 'คอมมิชชั่น', en: 'Commission', c: p.gold };
      if (f === 'lgPct') return { th: 'LG ค้ำประกัน', en: 'Bank guarantee', c: p.sub };
      if (f === 'm1Pct' || f === 'm2Pct') return { th: 'รับเงินงวด', en: 'Milestone receipt', c: p.good };
      return { th: '', en: '', c: p.sub };
    };
    const drillModal = () => {
      if (drill == null || !gs[drill]) return null;
      const gd = gs[drill], g = gd.g;
      const sumRow = (label, val, c) => el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14 } },
        el('span', { style: { color: p.sub, fontWeight: 600 } }, label),
        el('span', { style: { color: c || p.ink, fontWeight: 800, fontVariantNumeric: 'tabular-nums' } }, val));
      return el('div', { onClick: () => setDrill(null), style: { position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 } },
        el('div', { onClick: (e) => e.stopPropagation(), style: { width: '100%', maxWidth: 580, maxHeight: '86vh', overflow: 'auto', background: p.card, borderRadius: 18, border: '1px solid ' + p.line, boxShadow: '0 30px 80px -20px rgba(0,0,0,0.55)', padding: '22px 24px 18px' } },
          el('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } },
            el('div', null,
              el('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 800, color: p.brand, background: invRgba(p.brand, 0.1), padding: '4px 12px', borderRadius: 8 } },
                (lang === 'th' ? 'สเต็ป ' : 'Step ') + (gd.i + 1), el('span', { style: { width: 1, height: 11, background: invRgba(p.brand, 0.4) } }), invDayPill(g.d, lang)),
              el('div', { style: { fontSize: 21, fontWeight: 800, color: p.ink, marginTop: 9 } }, (lang === 'th' ? g.t[0] : g.t[1]))),
            el('button', { onClick: () => setDrill(null), style: { flex: '0 0 auto', width: 34, height: 34, borderRadius: 9, border: '1px solid ' + p.line, background: p.card2, color: p.sub, fontSize: 16, fontWeight: 800, cursor: 'pointer' } }, '✕')),
          el('div', { style: { marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 } },
            g.items.map((it, j) => {
              if (it.k === 'mark') {
                const md = (lang === 'th' ? it.th : it.en);
                return el('div', { key: j, style: { display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 14px', borderRadius: 12, background: invRgba(p.brand, 0.05), border: '1px dashed ' + invRgba(p.brand, 0.3) } },
                  el('span', { style: { fontSize: 16, color: p.brand, lineHeight: 1.3 } }, '◆'),
                  el('span', { style: { minWidth: 0 } },
                    el('span', { style: { display: 'block', fontSize: 15, fontWeight: 700, color: p.ink } }, md[0]),
                    md[1] ? el('span', { style: { display: 'block', fontSize: 12.5, color: p.brand, marginTop: 2, fontWeight: 700 } }, md[1]) : null,
                    el('span', { style: { display: 'block', fontSize: 12, color: p.sub, marginTop: 3 } }, lang === 'th' ? 'เหตุการณ์ — ไม่มีกระแสเงิน' : 'Milestone — no cash flow')));
              }
              const isIn = it.k === 'in', c = isIn ? p.good : p.bad, cat = catOf(it);
              return el('div', { key: j, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: invRgba(c, 0.06), border: '1px solid ' + invRgba(c, 0.22) } },
                el('span', { style: { flex: '0 0 auto', fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 7, background: invRgba(cat.c, 0.14), color: cat.c, whiteSpace: 'nowrap' } }, lang === 'th' ? cat.th : cat.en),
                el('span', { style: { minWidth: 0, flex: 1 } },
                  el('span', { style: { display: 'block', fontSize: 15, fontWeight: 700, color: p.ink } }, (lang === 'th' ? it.th : it.en)[0]),
                  el('span', { style: { display: 'block', fontSize: 12.5, color: p.sub, marginTop: 2 } }, (isIn ? (lang === 'th' ? 'รับเข้า' : 'cash in') : (lang === 'th' ? 'จ่ายออก' : 'cash out')) + ' · ' + pctOf(it.amt) + (lang === 'th' ? '% ของมูลค่าสัญญา' : '% of contract'))),
                el('span', { style: { flex: '0 0 auto', textAlign: 'right' } },
                  el('span', { style: { display: 'block', fontSize: 17, fontWeight: 800, color: c, fontVariantNumeric: 'tabular-nums' } }, (isIn ? '+' : '−') + invFmt(it.amt)),
                  el('span', { style: { display: 'block', fontSize: 11.5, color: p.sub, marginTop: 1 } }, pctOf(it.amt) + '%')));
            })),
          el('div', { style: { marginTop: 16, padding: '14px 16px', borderRadius: 13, background: p.card2, border: '1px solid ' + p.line, display: 'flex', flexDirection: 'column', gap: 8 } },
            sumRow(lang === 'th' ? 'รับเข้า' : 'Cash in', gd.inn ? '+' + invFmt(gd.inn) : '—', gd.inn ? p.good : p.sub),
            sumRow(lang === 'th' ? 'จ่ายออก' : 'Cash out', gd.out ? '−' + invFmt(gd.out) : '—', gd.out ? p.bad : p.sub),
            sumRow(lang === 'th' ? 'สุทธิสเต็ปนี้' : 'Net this step', (gd.net >= 0 ? '+' : '−') + invFmt(Math.abs(gd.net)), gd.net < 0 ? p.bad : (gd.net > 0 ? p.good : p.sub)),
            el('div', { style: { height: 1, background: p.line, margin: '2px 0' } }),
            sumRow(lang === 'th' ? 'คงเหลือสะสม' : 'Cumulative balance', (gd.bal < 0 ? '−' : '+') + invFmt(Math.abs(gd.bal)), gd.bal < 0 ? p.bad : p.good)),
          el('div', { style: { marginTop: 12, fontSize: 11.5, color: p.sub, lineHeight: 1.5 } },
            lang === 'th' ? ('% คิดจากมูลค่าสัญญา ' + invFmt(C) + ' · ตัวเลขต้นทุนอ้างอิงราคาต้นทุนมาตรฐานของรุ่น ' + code) : ('% of contract ' + invFmt(C) + ' · cost figures from product ' + code + ' standard cost data'))));
    };

    return el('div', null,
      el('style', null, '@keyframes invShimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}'),
      drillModal(),
      // fullscreen present overlay for the timeline
      tlFull ? el('div', { style: { position: 'fixed', inset: 0, zIndex: 1200, background: p.bg, padding: '18px 24px', overflow: 'auto', display: 'flex', flexDirection: 'column' } },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 } },
          el('div', { style: { fontSize: 22, fontWeight: 800, color: p.ink } }, '💧 ' + (lang === 'th' ? 'ลำดับเหตุการณ์โครงการ' : 'Project Event Sequence')),
          productSelect(260), legend,
          el('button', { onClick: () => setTlFull(false), style: { marginLeft: 'auto', height: 38, padding: '0 16px', borderRadius: 9, border: 'none', background: p.gold, color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' } }, '✕ ' + (lang === 'th' ? 'ออก' : 'Exit'))),
        kpiRow(16),
        el('div', { style: { background: p.card, border: '1px solid ' + invRgba(p.gold, 0.22), borderRadius: 18, padding: '18px 10px', boxShadow: p.shadow, flex: 1 } }, renderTimeline(true))) : null,
      // controls — pick a product; numbers are the product's standard cost data (read-only)
      el('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14, background: p.card, border: '1px solid ' + p.line, borderRadius: 14, padding: '12px 16px', boxShadow: p.shadow } },
        el('div', null,
          el('div', { style: { fontSize: 11, color: p.sub, fontWeight: 600, marginBottom: 4 } }, lang === 'th' ? 'เลือกผลิตภัณฑ์' : 'Select product'),
          productSelect(240)),
        el('div', null,
          el('div', { style: { fontSize: 11, color: p.sub, fontWeight: 600, marginBottom: 4 } }, lang === 'th' ? 'มูลค่าสัญญา' : 'Contract value'),
          el('div', { style: { height: 34, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: 8, background: p.card2, border: '1px solid ' + p.line, fontSize: 16, fontWeight: 800, color: p.ink, fontVariantNumeric: 'tabular-nums' } }, invFmt(C))),
        el('div', { style: { marginLeft: 'auto', fontSize: 11, color: p.sub, maxWidth: 280, lineHeight: 1.45 } }, lang === 'th' ? 'ตัวเลขอ้างอิงต้นทุนมาตรฐานของแต่ละผลิตภัณฑ์ (ข้อมูลราคาต้นทุน) — เปลี่ยนผลิตภัณฑ์เพื่อดูกระแสเงินสดของรุ่นนั้น' : 'Figures use each product’s standard cost data — switch product to see its cash flow')),
      kpiRow(14),
      // timeline (HERO) — premium event sequence with phase bars + node axis
      el('div', { style: { background: p.card, border: '1px solid ' + invRgba(p.gold, 0.22), borderRadius: 18, padding: '20px 12px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 30px 60px -34px ' + invRgba(p.gold, 0.5), marginBottom: 14 } },
        el('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', padding: '0 10px', marginBottom: 6 } },
          el('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            el('span', { style: { width: 5, height: 32, borderRadius: 3, background: 'linear-gradient(' + p.gold + ',' + p.good + ')', flex: '0 0 auto' } }),
            el('div', null,
              el('div', { style: { fontSize: 18, fontWeight: 800, color: p.ink } }, lang === 'th' ? 'ลำดับเหตุการณ์โครงการ' : 'Project Event Sequence'),
              el('div', { style: { fontSize: 11.5, color: p.sub, marginTop: 2 } }, gs.length + (lang === 'th' ? ' เหตุการณ์ · ระยะเวลา ~2 ปี · ตัวเลขในวงกลม = วันที่นับจากลงนาม (วันลงนาม = วันที่ 1) · 👆 คลิกเพื่อแจกแจง' : ' events · ~2 yr · circle = day from signing (signing = Day 1) · 👆 click for detail')))),
          el('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } }, legend,
            el('button', { onClick: () => setTlFull(true), style: { height: 32, padding: '0 13px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,' + p.brand + ',' + p.brand2 + ')', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' } }, '⛶ ' + (lang === 'th' ? 'นำเสนอเต็มจอ' : 'Present')))),
        renderTimeline(false)),
      // step-by-step cash table: รับ / จ่าย / สุทธิ / คงเหลือสะสม
      stepTable(),
      // cost structure + pipeline + loans
      el('div', { style: gridR(2) },
        el(InvCard, { p, title: lang === 'th' ? 'โครงสร้างต้นทุนโครงการ (คำนวณจากที่กรอก)' : 'Project Cost Structure (computed)', note: invCompact(C) },
          el(InvSeg, { p, lang, items: costSeg }),
          el('div', { style: { fontSize: 12, color: p.sub, marginTop: 12, lineHeight: 1.6 } }, lang === 'th' ? 'ค่าของ+ค่าติดตั้ง = ส่วนที่ต้องใช้เงินทุนหมุนเวียน · LG คืนภายใน 2 ปี' : 'Inventory + installation = the working-capital portion · LG returned within 2 years')),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          el(InvCard, { p, title: tt.pipelineTitle },
            el(InvTable, { p, rows: pipe.map(r => ({ bold: r[2], cells: [r[0], (typeof r[1] === 'number' ? invFmt(r[1]) : r[1])] })) })),
          el(InvCard, { p, title: lang === 'th' ? 'วงเงินสินเชื่อปัจจุบัน' : 'Current Loan Facilities' },
            el('div', { style: { fontSize: 12.5, color: p.sub, lineHeight: 1.7 } },
              lang === 'th'
                ? 'KTB Pre-PN วงเงิน 110 ลบ. — เบิกได้ 50% ของมูลค่าโครงการเมื่อได้หนังสือเข้าพื้นที่ · KTB รับสิทธิเก็บเงินจากลูกค้าเพื่อหักเงินต้น+ดอกเบี้ยก่อนคืนส่วนที่เหลือ · LG 5% ของมูลค่าโครงการ'
                : 'KTB Pre-PN credit line of THB 110 mn — draw 50% of project value upon the site-access letter · KTB collects payment to deduct principal + interest before returning the balance · LG 5% of project value')))
      )
    );
  }

  // ── Thailand region map (stylized choropleth + bubbles) ─────────────────────
  function InvThaiMap({ p, byRegion, lang }) {
    const REG = [
      { en: 'North', th: 'ภาคเหนือ', x: 96, y: 80 },
      { en: 'Northeast', th: 'ภาคอีสาน', x: 165, y: 122 },
      { en: 'Central', th: 'ภาคกลาง', x: 116, y: 190 },
      { en: 'West', th: 'ภาคตะวันตก', x: 73, y: 204 },
      { en: 'East', th: 'ภาคตะวันออก', x: 178, y: 230 },
      { en: 'South', th: 'ภาคใต้', x: 118, y: 352 },
    ];
    const cnt = (r) => (byRegion[r.en] || byRegion[r.th] || byRegion[r.th.replace('ภาค', '')] || byRegion[r.en === 'Northeast' ? 'ตะวันออกเฉียงเหนือ' : '_'] || 0);
    const vals = REG.map(cnt); const max = Math.max(1, ...vals); const total = vals.reduce((a, b) => a + b, 0);
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const fillFor = (v) => 'rgb(' + lerp(190, 31, v / max) + ',' + lerp(222, 86, v / max) + ',' + lerp(246, 184, v / max) + ')';
    const SIL = 'M116,22 C146,20 166,36 170,60 C180,54 200,58 204,80 C210,100 202,124 194,140 C188,152 196,166 190,180 C184,192 168,190 158,200 C170,206 184,206 188,220 C194,236 180,252 164,250 C152,248 150,238 142,242 C150,258 150,280 144,300 C138,322 134,352 128,388 C124,414 122,438 117,452 C112,438 108,414 105,388 C100,352 102,322 96,300 C90,280 84,262 86,242 C88,222 76,206 72,188 C66,168 70,144 66,122 C62,100 70,62 90,40 C99,30 108,25 116,22 Z';
    return R.createElement('svg', { viewBox: '0 0 250 470', style: { width: '100%', maxWidth: 340, height: 'auto', display: 'block', margin: '0 auto' } },
      R.createElement('path', { d: SIL, fill: p.card2, stroke: p.line, strokeWidth: 1.5 }),
      REG.map((r, i) => {
        const v = cnt(r); const rad = 11 + Math.sqrt(v / max) * 22;
        return R.createElement('g', { key: i },
          R.createElement('circle', { cx: r.x, cy: r.y, r: rad, fill: fillFor(v), opacity: 0.92, stroke: '#fff', strokeWidth: 1.2 }),
          R.createElement('text', { x: r.x, y: r.y + 1, textAnchor: 'middle', fontSize: 14, fontWeight: 800, fill: v / max > 0.5 ? '#fff' : p.ink, style: { fontVariantNumeric: 'tabular-nums' } }, v),
          R.createElement('text', { x: r.x, y: r.y + rad + 12, textAnchor: 'middle', fontSize: 9.5, fill: p.sub }, lang === 'th' ? r.th : r.en)
        );
      }),
      R.createElement('text', { x: 125, y: 466, textAnchor: 'middle', fontSize: 10, fill: p.sub }, (lang === 'th' ? 'รวม ' : 'Total ') + total + (lang === 'th' ? ' โครงการ' : ' projects'))
    );
  }

  // ── 7. Customers & Projects (live data) ───────────────────────────────────────
  function InvCustomers({ p, tt, m, toast, lang }) {
    const [gallery, setGallery] = invSt([]);
    const prov = Object.keys(m.byProv).map(k => ({ label: k, value: m.byProv[k] })).sort((a, b) => b.value - a.value).slice(0, 12);
    const onImg = (files) => {
      const arr = [];
      [].slice.call(files || []).forEach(f => { if (/^image\//.test(f.type)) arr.push(URL.createObjectURL(f)); });
      if (arr.length) setGallery(g => [...arr, ...g]);
    };
    return R.createElement('div', null,
      R.createElement('div', { style: Object.assign(gridR(2), { marginBottom: 16 }) },
        R.createElement(InvCard, { p, title: tt.byRegion }, R.createElement(InvThaiMap, { p, byRegion: m.byRegion, lang })),
        R.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          R.createElement(InvCard, { p, title: tt.topProv }, R.createElement(InvBars, { p, items: prov.length ? prov : [{ label: '—', value: 0 }], color: p.brand2 })),
          R.createElement(InvCard, { p, title: tt.statusFunnel },
            R.createElement(InvBars, { p, items: Object.keys(m.byStatus).length ? Object.keys(m.byStatus).map(k => ({ label: k, value: m.byStatus[k] })) : [{ label: '—', value: 0 }] })))),
      R.createElement(InvCard, { p, title: tt.gallery },
        R.createElement('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, background: p.brand, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginBottom: 12 } },
          '📷 ' + tt.uploadImg, R.createElement('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onChange: e => onImg(e.target.files) })),
        gallery.length ? R.createElement('div', { style: gridR(4) }, gallery.map((src, i) => R.createElement('img', { key: i, src, style: { width: '100%', height: 130, objectFit: 'cover', borderRadius: 10, border: '1px solid ' + p.line } })))
          : R.createElement('div', { style: { color: p.sub, fontSize: 12.5, padding: 20, textAlign: 'center' } }, tt.noData + ' — ' + tt.uploadImg))
    );
  }

  // ── 8. Team & Shareholding (deck p15) ─────────────────────────────────────────
  function InvTeam({ p, tt, lang }) {
    const grpRows = Object.keys(INV_SHARE_GRP).map(k => ({ bold: true, cells: [(lang === 'th' ? INV_SHARE_GRP[k].th : INV_SHARE_GRP[k].en), { t: INV_SHARE_GRP[k].pct.toFixed(1) + '%' }] }));
    const shareRows = INV_SHARE.map(s => ({ cells: [s.name, { t: s.pct.toFixed(1) + '%' }] }));
    const grpSeg = Object.keys(INV_SHARE_GRP).map((k, i) => ({ th: INV_SHARE_GRP[k].th, en: INV_SHARE_GRP[k].en, pct: INV_SHARE_GRP[k].pct, color: [p.brand, p.accent, p.gold][i] }));
    return R.createElement('div', null,
      R.createElement('div', { style: { display: 'inline-block', padding: '4px 12px', borderRadius: 99, background: p.bad, color: '#fff', fontSize: 11, fontWeight: 700, marginBottom: 12 } }, '🔒 ' + tt.confidential),
      R.createElement(InvCard, { p, title: '👤 ' + tt.founderTitle, style: { marginBottom: 14 } },
        R.createElement('div', { style: gridR(3) },
          INV_FOUNDERS.map((f, i) => R.createElement('div', { key: i, style: { padding: 14, background: p.card2, borderRadius: 12, border: '1px solid ' + p.line } },
            R.createElement('div', { style: { width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(135deg,' + p.brand + ',' + p.brand2 + ')', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 800, marginBottom: 9 } }, (lang === 'th' ? f.th : f.en)[0].replace(/^(นาย|น\.ส\.|นาง)/, '').trim().charAt(0)),
            R.createElement('div', { style: { fontSize: 13.5, fontWeight: 800, color: p.ink } }, (lang === 'th' ? f.th : f.en)[0]),
            R.createElement('div', { style: { fontSize: 12, color: p.brand, fontWeight: 600, marginBottom: 8 } }, (lang === 'th' ? f.th : f.en)[1]),
            R.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              (lang === 'th' ? f.bullets_th : f.bullets_en).map((b, j) => R.createElement('div', { key: j, style: { fontSize: 11.5, color: p.sub, lineHeight: 1.5, display: 'flex', gap: 6 } },
                R.createElement('span', { style: { color: p.accent } }, '•'), b)))))) ),
      R.createElement('div', { style: gridR(2) },
        R.createElement(InvCard, { p, title: '📊 ' + tt.shareTitle, note: tt.shareNote },
          R.createElement(InvSeg, { p, lang, items: grpSeg }),
          R.createElement('div', { style: { marginTop: 14 } }, R.createElement(InvTable, { p, rows: grpRows }))),
        R.createElement(InvCard, { p, title: lang === 'th' ? 'รายชื่อผู้ถือหุ้น' : 'Shareholder List' },
          R.createElement('div', { style: { maxHeight: 360, overflow: 'auto' } }, R.createElement(InvTable, { p, head: [lang === 'th' ? 'ผู้ถือหุ้น' : 'Shareholder', '%'], rows: shareRows }))))
    );
  }

  // ── 9. Sustainability / ESG (deck p16–18) ─────────────────────────────────────
  function InvESG({ p, tt, lang }) {
    return R.createElement('div', null,
      R.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        INV_ESG.map((e, i) => R.createElement(InvCard, { p, key: i, title: e.icon + ' ' + (lang === 'th' ? e.th : e.en)[0] },
          R.createElement('div', { style: gridR(2) },
            R.createElement('div', null,
              R.createElement('div', { style: { fontSize: 13, color: p.sub, lineHeight: 1.65, marginBottom: 10 } }, (lang === 'th' ? e.th : e.en)[1]),
              e.bullets_th ? R.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                (lang === 'th' ? e.bullets_th : e.bullets_en).map((b, j) => R.createElement('div', { key: j, style: { fontSize: 12, color: p.ink, display: 'flex', gap: 7 } },
                  R.createElement('span', { style: { color: p.accent, fontWeight: 800 } }, '✓'), b))) : null),
            R.createElement('div', null,
              R.createElement('div', { style: { fontSize: 11.5, color: p.sub, fontWeight: 700, marginBottom: 8 } }, lang === 'th' ? e.idx_th : e.idx_en),
              e.bars ? R.createElement(InvBars, { p, items: e.bars, color: p.accent, suffix: '' }) : R.createElement('div', { style: { fontSize: 12, color: p.sub, fontStyle: 'italic' } }, lang === 'th' ? 'POG ช่วยยกระดับโครงสร้างพื้นฐานน้ำของชุมชนทั่วประเทศ' : 'POG uplifts community water infrastructure nationwide'))))))
    );
  }

  // ── 10. Investor Room (document center: PDF + video) ──────────────────────────
  function InvRoom({ p, tt }) {
    const [pdf, setPdf] = invSt(null);
    const [vid, setVid] = invSt(null);
    const [vidUrl, setVidUrl] = invSt(() => invGet('videoUrl', ''));
    const onPdf = (f) => { if (f) setPdf(URL.createObjectURL(f)); };
    const onVid = (f) => { if (f) { setVid(URL.createObjectURL(f)); setVidUrl(''); } };
    const ytEmbed = (u) => {
      const mm = String(u).match(/(?:youtu\.be\/|v=)([\w-]{11})/); if (mm) return 'https://www.youtube.com/embed/' + mm[1];
      const dm = String(u).match(/drive\.google\.com\/file\/d\/([\w-]+)/); if (dm) return 'https://drive.google.com/file/d/' + dm[1] + '/preview';
      return u;
    };
    return R.createElement('div', { style: gridR(2) },
      R.createElement(InvCard, { p, title: '📄 ' + tt.docCenter },
        R.createElement('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, background: p.brand, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginBottom: 12 } },
          tt.uploadPdf, R.createElement('input', { type: 'file', accept: 'application/pdf', style: { display: 'none' }, onChange: e => onPdf(e.target.files[0]) })),
        pdf ? R.createElement('iframe', { src: pdf, style: { width: '100%', height: 460, border: '1px solid ' + p.line, borderRadius: 10 } })
          : R.createElement('div', { style: { color: p.sub, fontSize: 12.5, padding: 30, textAlign: 'center', border: '1px dashed ' + p.line, borderRadius: 10 } }, tt.noData + ' — ' + tt.uploadPdf + ' (Project Turtle, งบการเงิน, Company Profile)')),
      R.createElement(InvCard, { p, title: '🎬 ' + (tt.uploadVideo) },
        R.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' } },
          R.createElement('input', { value: vidUrl, onChange: e => setVidUrl(e.target.value), onBlur: () => invSet('videoUrl', vidUrl), placeholder: tt.videoUrl, style: { flex: 1, minWidth: 160, height: 34, border: '1px solid ' + p.line, borderRadius: 8, padding: '0 10px', background: p.card2, color: p.ink, fontSize: 12.5 } }),
          R.createElement('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8, background: p.brand, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' } },
            tt.uploadVideo, R.createElement('input', { type: 'file', accept: 'video/*', style: { display: 'none' }, onChange: e => onVid(e.target.files[0]) }))),
        vid ? R.createElement('video', { src: vid, controls: true, style: { width: '100%', borderRadius: 10, background: '#000' } })
          : vidUrl ? R.createElement('iframe', { src: ytEmbed(vidUrl), allow: 'autoplay; encrypted-media; fullscreen', style: { width: '100%', height: 300, border: 'none', borderRadius: 10 } })
            : R.createElement('div', { style: { color: p.sub, fontSize: 12.5, padding: 30, textAlign: 'center', border: '1px dashed ' + p.line, borderRadius: 10 } }, tt.noData + ' — ' + tt.videoUrl))
    );
  }

  // ── 11. KTB Credit & Growth-Capacity Dashboard (from Claude Design handoff) ───
  //   Source: ข้อมูลการเบิก PN PRE/POST กรุงไทย + สัญญา LG/PN · ณ 13 ส.ค. 2568 (ค่า = ล้านบาท)
  const CR = { pre: '#3B8DF0', post: '#22C7D4', lg: '#E6A23C', danger: '#F0584F', growth: '#34D39A' };
  const INV_CREDIT = {
    asOf: { th: 'ข้อมูล ณ 13 สิงหาคม 2568', en: 'As of 13 August 2025' },
    bank: { th: 'ธนาคารกรุงไทย จำกัด (มหาชน)', en: 'Krungthai Bank PCL' },
    byYear: [{ label: '2567 / 2024', PRE: 64.01, POST: 33.67 }, { label: '2568 / 2025', PRE: 157.66, POST: 22.35 }],
    mix: [{ key: 'PRE', value: 221.66, color: CR.pre }, { key: 'POST', value: 56.02, color: CR.post }, { key: 'LG', value: 29.93, color: CR.lg }],
    topProjects: [
      { code: 'AW138', value: 7.33 }, { code: 'AW139', value: 7.33 }, { code: 'AW140', value: 7.33 }, { code: 'PP009', value: 5.57 }, { code: 'AW119', value: 5.18 },
      { code: 'AW120', value: 5.18 }, { code: 'ENC061', value: 5.18 }, { code: 'AW115', value: 4.98 }, { code: 'AW116', value: 4.98 }, { code: 'AW117', value: 4.98 },
    ],
    byProvince: [
      { th: 'หนองบัวลำภู', en: 'Nong Bua Lamphu', value: 34.9 }, { th: 'กาญจนบุรี', en: 'Kanchanaburi', value: 24.0 }, { th: 'กาฬสินธุ์', en: 'Kalasin', value: 17.6 },
      { th: 'ปราจีนบุรี', en: 'Prachinburi', value: 17.4 }, { th: 'เชียงราย', en: 'Chiang Rai', value: 17.2 }, { th: 'อุทัยธานี', en: 'Uthai Thani', value: 16.5 },
      { th: 'บุรีรัมย์', en: 'Buriram', value: 15.5 }, { th: 'นครพนม', en: 'Nakhon Phanom', value: 15.4 }, { th: 'ตรัง', en: 'Trang', value: 13.8 }, { th: 'ลำปาง', en: 'Lampang', value: 13.3 },
    ],
    ageing: [{ bucket: '0–6 เดือน', value: 6.50 }, { bucket: '6–12 เดือน', value: 8.90 }, { bucket: '12–18 เดือน', value: 8.20 }, { bucket: '18–24 เดือน', value: 6.33 }],
    scenarios: [{ lg: 30, cap: 300, cur: true }, { lg: 50, cap: 500 }, { lg: 80, cap: 800 }, { lg: 100, cap: 1000 }],
    flow: {
      th: [['วงเงิน L/G', '30 ล.', 'ถูกลดจาก 100 ล. (−70%)'], ['L/G ที่ใช้ไปแล้ว', '29.93 ล.', '99.8% ของวงเงิน'], ['L/G คงเหลือ', '≈ 0', 'เหลือ 70,591 บาท'], ['ออก L/G ใหม่ไม่ได้', '', 'ยื่นประมูลงานใหม่ไม่ได้'], ['เบิก PRE/POST ไม่ได้', '', 'ทั้งที่ PN ว่างเต็ม 140 ล.'], ['สูญเสียโอกาส', '', 'รับงานใหม่ถูกจำกัด']],
      en: [['L/G line', '30M', 'cut from 100M (−70%)'], ['L/G drawn', '29.93M', '99.8% of line'], ['L/G available', '≈ 0', 'only 70,591 baht'], ['No new L/G', '', 'cannot bid new work'], ['No PRE/POST draw', '', 'despite 140M free on PN'], ['Lost opportunity', '', 'new intake capped']],
    },
    insight: {
      th: [['แนวโน้มการใช้วงเงิน', 'เบิกใหม่โต 97.7 → 180.0 ล้านบาท (8 เดือนปี 68)'], ['หมุนเวียนเร็ว', '559 ล้าน บน PN 140 ล้าน · อายุตั๋วเฉลี่ย 43 วัน'], ['ประวัติชำระสะอาด', 'ตั๋ว 832 รายการชำระครบ ไม่มีค้าง · ภาระหนี้ PN = 0'], ['L/G เต็มวงเงิน', '30 ล้าน ใช้ไป 29.93 (99.8%) เหลือ 70,591 บาท'], ['คอขวด', 'ออก L/G ใหม่ไม่ได้ → เบิก PRE/POST ไม่ได้ ทั้งที่ PN ว่างเต็ม 140 ล้าน'], ['กระทบการเติบโต', 'L/G ลด 70% · เงินถูกแช่นานสูงสุด 2 ปี'], ['เหตุผลขยายวงเงิน', 'หมุน ~10 เท่า/ปี → คืน L/G 100 ล้าน ปลดล็อก ~1,000 ล้าน/ปี']],
      en: [['Utilisation trend', 'New draws 97.7 → 180.0M (8 months of 2025)'], ['High velocity', '559M cycled on a 140M PN line · 43-day avg tenor'], ['Clean record', 'All 832 notes repaid · no arrears · PN debt now 0'], ['L/G full', '30M line 99.8% drawn — only 70,591 baht left'], ['Bottleneck', 'No new L/G → cannot draw PRE/POST despite 140M free PN'], ['Growth impact', 'L/G cut 70% · capital tied up to 2 years'], ['Case to expand', '~10× turnover → L/G 100M unlocks ~1,000M/yr']],
    },
    conclusionTh: 'จากข้อมูลย้อนหลัง บริษัทใช้วงเงิน PRE/POST ต่อเนื่อง หมุนเวียนรวมกว่า 559 ล้านบาท สนับสนุน 99 โครงการประปาชุมชนใน 32 จังหวัด ชำระคืนครบทุกรายการ — แต่วงเงิน L/G ถูกลดจาก 100 เหลือ 30 ล้านบาท ใช้เต็ม 99.8% และเงินถูกแช่นานถึง 2 ปี ทำให้รับงานใหม่ได้จำกัด แม้ภาระหนี้ PN เป็น 0 และวงเงิน PN ว่างเต็ม 140 ล้านบาท จึงควรขยายวงเงิน L/G เพื่อปลดล็อกการเติบโต',
    conclusionEn: 'The company has drawn PRE/POST continuously, cycling over THB 559M to finance 99 community water-supply projects across 32 provinces, with every note repaid. But the L/G line was cut from 100M to 30M, is 99.8% used, and capital stays frozen up to 2 years — capping new intake despite zero PN debt and the full THB 140M PN line free. Expanding the L/G line is the clear lever to unlock growth.',
  };

  function InvCredit({ p, lang }) {
    const L = lang === 'th', d = INV_CREDIT;
    const U = L ? ' ล้านบาท' : ' M';
    const mb = (n, dg) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dg || 0, maximumFractionDigits: dg || 0 });
    const secHead = (no, title, sub) => el('div', { style: { display: 'flex', alignItems: 'center', gap: 13, margin: '26px 0 14px' } },
      el('div', { style: { width: 38, height: 38, borderRadius: 10, background: invRgba(p.brand, 0.12), color: p.brand, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15 } }, no),
      el('div', null, el('div', { style: { fontSize: 18, fontWeight: 800, color: p.ink } }, title), el('div', { style: { fontSize: 12.5, color: p.sub } }, sub)));
    const kpi = (accent, lab, val, unit, sub) => el('div', { style: { background: 'linear-gradient(160deg,' + invRgba(accent, 0.1) + ',' + p.card + ' 55%)', border: '1px solid ' + p.line, borderRadius: 18, padding: '22px 24px', boxShadow: p.shadow, position: 'relative', overflow: 'hidden', minHeight: 134 } },
      el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: accent } }),
      el('div', { style: { fontSize: 13, color: p.sub, fontWeight: 700 } }, lab),
      el('div', { style: { fontSize: 42, fontWeight: 800, color: p.ink, marginTop: 10, letterSpacing: '-1px', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' } }, val, unit ? el('small', { style: { fontSize: 16, color: p.sub, marginLeft: 5, fontWeight: 600 } }, unit) : null),
      sub ? el('div', { style: { fontSize: 12, color: p.sub, marginTop: 7 } }, sub) : null);
    const hbars = (items, color, fmt) => { const max = Math.max(1, ...items.map(i => i.value)); return el('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
      items.map((it, i) => el('div', { key: i },
        el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 } }, el('span', { style: { color: p.sub } }, it.label), el('span', { style: { fontWeight: 700, color: p.ink, fontVariantNumeric: 'tabular-nums' } }, fmt(it.value))),
        el('div', { style: { height: 10, background: invRgba(p.ink, 0.06), borderRadius: 99, overflow: 'hidden' } }, el('div', { style: { height: '100%', width: Math.max(2, it.value / max * 100) + '%', background: 'linear-gradient(90deg,' + invRgba(color, 0.7) + ',' + color + ')', borderRadius: 99 } }))))); };
    const gauge = (pct, color) => { const r = 74, cx = 92, cy = 92, len = Math.PI * r, path = 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy;
      return el('svg', { viewBox: '0 0 184 108', style: { width: '100%', maxWidth: 250, display: 'block', margin: '0 auto' } },
        el('path', { d: path, fill: 'none', stroke: invRgba(p.ink, 0.08), strokeWidth: 17, strokeLinecap: 'round' }),
        el('path', { d: path, fill: 'none', stroke: color, strokeWidth: 17, strokeLinecap: 'round', strokeDasharray: (pct / 100 * len) + ' ' + len }),
        el('text', { x: cx, y: cy - 6, textAnchor: 'middle', fontSize: 32, fontWeight: 800, fill: color }, pct.toFixed(1) + '%'),
        el('text', { x: cx, y: cy + 13, textAnchor: 'middle', fontSize: 11.5, fill: p.sub }, L ? 'ใช้ไปแล้ว' : 'utilised')); };

    return el('div', null,
      el('div', { style: { background: 'linear-gradient(135deg,' + invRgba(CR.danger, 0.92) + ',' + invRgba(CR.lg, 0.85) + ')', borderRadius: 18, padding: '24px 26px', color: '#fff', boxShadow: p.shadow } },
        el('div', { style: { fontSize: 12, fontWeight: 700, letterSpacing: '.08em', opacity: .9 } }, L ? 'บทสรุปสำหรับผู้บริหาร · ธนาคาร · นักลงทุน' : 'EXECUTIVE · BANKING · INVESTOR BRIEFING'),
        el('div', { style: { fontSize: 25, fontWeight: 800, lineHeight: 1.3, marginTop: 8, maxWidth: 800 } }, L ? 'ศักยภาพเติบโตสูง แต่ถูกจำกัดด้วยวงเงิน L/G ที่เต็มและถูกลด' : 'Strong growth potential — constrained by a maxed-out, reduced L/G line'),
        el('div', { style: { fontSize: 13.5, opacity: .93, marginTop: 8, lineHeight: 1.55, maxWidth: 840 } }, L ? 'หมุนเวียนวงเงินสินเชื่อแล้วกว่า 559 ล้านบาท สนับสนุน 99 โครงการประปาชุมชน — แต่วงเงิน L/G ถูกลดจาก 100 เหลือ 30 ล้านบาท และใช้เต็มแล้ว 99.8%' : 'Over THB 559M of credit cycled, financing 99 community water-supply projects — yet the L/G line was cut from 100M to 30M and is now 99.8% utilised.'),
        el('div', { style: Object.assign(gridR(4), { marginTop: 18 }) },
          [['559', U, L ? 'วงเงินหมุนเวียนสะสม' : 'Total credit cycled'], ['99', '', L ? 'โครงการประปาชุมชน' : 'Water-supply projects'], ['99.8', '%', L ? 'การใช้วงเงิน L/G' : 'L/G utilisation'], ['1,000', U, L ? 'ศักยภาพ/ปี หากคืน L/G' : 'Capacity/yr if L/G restored']].map((s, i) =>
            el('div', { key: i, style: { background: 'rgba(255,255,255,.15)', borderRadius: 14, padding: '16px 18px' } },
              el('div', { style: { fontSize: 34, fontWeight: 800, letterSpacing: '-.5px', lineHeight: 1.05 } }, s[0], s[1] ? el('small', { style: { fontSize: 15, opacity: .85, marginLeft: 4 } }, s[1]) : null),
              el('div', { style: { fontSize: 12.5, opacity: .92, marginTop: 5 } }, s[2]))))),
      secHead('01', L ? 'ภาพรวมผู้บริหาร' : 'Executive Summary', L ? 'วงเงิน · การใช้ · โครงการ' : 'Facilities · usage · projects'),
      el('div', { style: gridR(3) },
        kpi(CR.pre, L ? 'วงเงิน PRE-FINANCE' : 'PRE-FINANCE line', '140', U, L ? 'วงเงินรวม PN 140 ล.' : 'shared PN 140M'),
        kpi(CR.post, L ? 'วงเงิน POST-FINANCE' : 'POST-FINANCE line', '140', U, L ? 'วงเงินรวม PN 140 ล.' : 'shared PN 140M'),
        kpi(CR.danger, L ? 'วงเงิน L/G (ค้ำประกัน)' : 'L/G line (guarantees)', '30', U, L ? 'ถูกลดจาก 100 ล. · ใช้เต็ม' : 'cut from 100M · full'),
        kpi(p.ink, L ? 'วงเงินหมุนเวียนสะสม' : 'Total credit cycled', '559.78', U, L ? 'รวม roll-over' : 'incl. roll-over'),
        kpi(CR.post, L ? 'โครงการที่สนับสนุน' : 'Projects financed', '99', '', '32 ' + (L ? 'จังหวัด' : 'provinces')),
        kpi(CR.growth, L ? 'มูลค่างานที่สนับสนุน' : 'Project value financed', '277.69', U, L ? 'เบิกใหม่ (ไม่รวม roll)' : 'new draws (excl. roll)')),
      secHead('02', L ? 'การวิเคราะห์คอขวด L/G' : 'LG Bottleneck Analysis', L ? 'ข้อจำกัดหลักที่ฉุดการเติบโต' : 'The biggest growth constraint'),
      el('div', { style: gridR(2) },
        el(InvCard, { p, title: L ? 'อัตราการใช้วงเงิน L/G' : 'L/G utilisation' },
          gauge(99.8, CR.danger),
          el('div', { style: { textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: CR.danger, marginTop: 6 } }, L ? '⚠ ใช้เต็มวงเงินแล้ว' : '⚠ Line fully utilised'),
          el('div', { style: Object.assign(grid(2), { marginTop: 12 }) },
            el('div', { style: { textAlign: 'center' } }, el('div', { style: { fontSize: 18, fontWeight: 800, color: CR.lg } }, '29.93'), el('div', { style: { fontSize: 11, color: p.sub } }, L ? 'คงค้าง (ล.)' : 'outstanding (M)')),
            el('div', { style: { textAlign: 'center' } }, el('div', { style: { fontSize: 18, fontWeight: 800, color: CR.danger } }, '70,591'), el('div', { style: { fontSize: 11, color: p.sub } }, L ? 'คงเหลือ (บาท)' : 'available (THB)')))),
        el(InvCard, { p, title: L ? 'เปรียบเทียบการใช้วงเงิน' : 'Facility utilisation compared' },
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
            [['L/G', 99.8, '29.9 / 30', CR.danger], ['PN (PRE/POST)', 0, '0 / 140', CR.post]].map((r, i) => el('div', { key: i },
              el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 7 } }, el('b', null, r[0]), el('span', { style: { color: p.sub, fontVariantNumeric: 'tabular-nums' } }, r[1] + '% · ' + r[2] + U)),
              el('div', { style: { height: 16, background: invRgba(p.ink, 0.06), borderRadius: 99, overflow: 'hidden' } }, el('div', { style: { height: '100%', width: Math.max(r[1], 1.5) + '%', background: r[3], borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, color: '#fff', fontSize: 11, fontWeight: 800 } }, r[1] >= 8 ? r[1] + '%' : '')))),
            el('div', { style: { fontSize: 12.5, color: p.sub, lineHeight: 1.55 } }, L ? 'L/G ใช้เต็ม 99.8% แต่ PN แทบไม่ใช้ — ภาระหนี้ PN = 0 ว่างเต็มวงเงิน 140 ล้านบาท ทว่าต้องมี L/G ก่อนจึงเบิก PN ได้' : 'L/G is 99.8% used while the PN line is entirely free — zero PN debt, full 140M available — yet PN cannot be drawn without an L/G first.')))),
      el('div', { style: { marginTop: 14, background: invRgba(CR.lg, 0.06), border: '1px solid ' + invRgba(CR.lg, 0.25), borderRadius: 14, padding: 16 } },
        el('div', { style: { fontSize: 14, fontWeight: 700, color: CR.lg, marginBottom: 12 } }, '⚠ ' + (L ? 'นี่คือข้อจำกัดหลักที่ฉุดการเติบโตของบริษัท' : "This is the single biggest constraint on the company's growth")),
        el('div', { style: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 } },
          d.flow[L ? 'th' : 'en'].map((f, i) => { const sev = i <= 1 ? CR.lg : CR.danger; return el('div', { key: i, style: { flex: '0 0 184px', minWidth: 184, background: p.card, border: '1px solid ' + invRgba(sev, 0.3), borderLeft: '3px solid ' + sev, borderRadius: 11, padding: '10px 12px' } },
            el('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } }, el('div', { style: { fontSize: 12.5, fontWeight: 800, color: sev } }, f[0]), f[1] ? el('div', { style: { fontSize: 12, fontWeight: 800, color: p.ink, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } }, f[1]) : null),
            el('div', { style: { fontSize: 11, color: p.sub, marginTop: 4, lineHeight: 1.4 } }, f[2])); }))),
      el('div', { style: { marginTop: 14, display: 'flex', gap: 13, background: invRgba(CR.danger, 0.07), border: '1px solid ' + invRgba(CR.danger, 0.25), borderRadius: 14, padding: 16 } },
        el('div', { style: { fontSize: 22 } }, '♻️'),
        el('div', null, el('div', { style: { fontSize: 14, fontWeight: 800, color: CR.danger, marginBottom: 4 } }, L ? 'ความขัดแย้งของโครงสร้างวงเงิน' : 'The structural paradox'),
          el('div', { style: { fontSize: 12.5, color: p.sub, lineHeight: 1.6 } }, L ? 'วงเงิน PN ว่างเต็ม 140 ล้านบาท (ภาระหนี้ = 0) แต่ใช้ไม่ได้ เพราะเบิก PRE/POST งานใหม่ต้องมี L/G ค้ำก่อน — เมื่อ L/G เต็ม วงเงิน PN ทั้งหมดจึงถูกล็อกไปด้วย' : 'The full THB 140M PN line is free (zero debt) but unusable: drawing PRE/POST for new work first needs an L/G. With L/G maxed, the entire spare PN is locked too.'))),
      secHead('03', L ? 'โอกาสในการเติบโต' : 'Growth Opportunity', L ? 'ศักยภาพรับงาน/ปี ตามวงเงิน L/G (หมุน ~10 เท่า)' : 'Annual capacity by L/G size (~10× turnover)'),
      el(InvCard, { p },
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          d.scenarios.map((s, i) => { const up = Math.round((s.cap - 300) / 300 * 100); return el('div', { key: i, style: { display: 'grid', gridTemplateColumns: '92px 1fr 86px', alignItems: 'center', gap: 12 } },
            el('div', { style: { fontSize: 14, fontWeight: 800, color: p.ink, fontVariantNumeric: 'tabular-nums' } }, s.lg, el('small', { style: { fontSize: 10, color: p.sub, fontWeight: 500 } }, U)),
            el('div', { style: { height: 30, background: invRgba(p.ink, 0.06), borderRadius: 8, overflow: 'hidden' } }, el('div', { style: { height: '100%', width: (s.cap / 1000 * 100) + '%', background: s.cur ? CR.danger : CR.growth, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10, color: '#fff', fontSize: 13, fontWeight: 800 } }, mb(s.cap) + U)),
            el('div', { style: { fontSize: 13, fontWeight: 800, textAlign: 'right', color: s.cur ? CR.danger : CR.growth } }, s.cur ? (L ? 'ปัจจุบัน' : 'current') : '+' + up + '%')); })),
        el('div', { style: { fontSize: 12.5, color: p.sub, marginTop: 14, lineHeight: 1.6, borderTop: '1px solid ' + p.line, paddingTop: 12 } }, '🚀 ' + (L ? 'คืนวงเงิน L/G เป็น 100 ล้านบาท → ปลดล็อกศักยภาพรับงาน ~1,000 ล้านบาท/ปี บนประวัติชำระหนี้ที่สะอาด' : 'Restore L/G to THB 100M → unlock ~THB 1,000M/yr capacity on a clean repayment record.'))),
      secHead('04', L ? 'วงเงินที่ถูกแช่แข็ง' : 'Frozen Capacity', L ? 'เงินทุนถูกผูกไว้กับ L/G นานสูงสุด 2 ปี' : 'Capital tied in guarantees up to 2 years'),
      el('div', { style: Object.assign(gridR(4), { marginBottom: 14 }) },
        kpi(CR.danger, L ? 'วงเงินถูกแช่ใน L/G' : 'Frozen in L/G', '29.93', U),
        kpi(CR.lg, L ? 'L/G ที่ยังไม่หมดอายุ' : 'L/G outstanding', '99.8', '%'),
        kpi(CR.lg, L ? 'อายุค้ำตามสัญญา' : 'Guarantee term', L ? 'สูงสุด 24' : 'up to 24', L ? 'เดือน' : 'mo'),
        kpi(CR.danger, L ? 'นำกลับมาใช้ไม่ได้' : 'Not reusable', '29.93', U)),
      el(InvCard, { p, title: L ? 'วงเงิน L/G แยกตามอายุคงเหลือ' : 'L/G capital by remaining life' },
        hbars(d.ageing.map(a => ({ label: a.bucket, value: a.value })), CR.lg, v => mb(v, 2) + U)),
      secHead('05', L ? 'ผลการใช้วงเงินย้อนหลัง' : 'Historical Performance', L ? 'เบิกใหม่รายปี + สัดส่วนการใช้' : 'New draws by year + usage mix'),
      el('div', { style: gridR(2) },
        el(InvCard, { p, title: L ? 'มูลค่างานที่สนับสนุน (เบิกใหม่/ปี)' : 'Project value financed (new/yr)' },
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, d.byYear.map((y, i) => el('div', { key: i },
            el('div', { style: { fontSize: 13, fontWeight: 700, color: p.ink, marginBottom: 6 } }, y.label, el('span', { style: { color: p.sub, fontWeight: 500, marginLeft: 8 } }, mb(y.PRE + y.POST, 0) + U)),
            el('div', { style: { display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', gap: 2 } },
              el('div', { style: { width: (y.PRE / (y.PRE + y.POST) * 100) + '%', background: CR.pre, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 10.5, fontWeight: 700 } }, 'PRE ' + mb(y.PRE, 0)),
              el('div', { style: { width: (y.POST / (y.PRE + y.POST) * 100) + '%', background: CR.post, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 10.5, fontWeight: 700 } }, 'POST ' + mb(y.POST, 0))))))),
        el(InvCard, { p, title: L ? 'สัดส่วนการใช้วงเงิน (PRE · POST · LG)' : 'Loan usage mix' },
          el(InvSeg, { p, lang, items: d.mix.map(m => ({ th: m.key, en: m.key, pct: Math.round(m.value / d.mix.reduce((s, x) => s + x.value, 0) * 100), color: m.color })) }),
          el('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 } }, d.mix.map((m, i) => el('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12.5 } },
            el('span', { style: { color: p.sub } }, el('span', { style: { display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: m.color, marginRight: 6 } }), m.key),
            el('b', { style: { color: p.ink, fontVariantNumeric: 'tabular-nums' } }, mb(m.value, 1) + U)))))),
      secHead('06', L ? 'ศักยภาพการสนับสนุนโครงการ' : 'Project Financing Capacity', L ? '99 โครงการ · 32 จังหวัด' : '99 projects · 32 provinces'),
      el('div', { style: Object.assign(gridR(4), { marginBottom: 14 }) },
        kpi(CR.post, L ? 'จำนวนโครงการ' : 'Projects', '99', '', ''),
        kpi(CR.pre, L ? 'วงเงินที่ใช้' : 'Credit used', '277.69', U),
        kpi(CR.post, L ? 'เฉลี่ยต่อโครงการ' : 'Avg / project', '2.80', U),
        kpi(CR.pre, L ? 'อายุการใช้เงินเฉลี่ย' : 'Avg tenor', '43', L ? 'วัน' : 'days')),
      el('div', { style: gridR(2) },
        el(InvCard, { p, title: L ? 'โครงการมูลค่าสูงสุด' : 'Highest-value projects' },
          hbars(d.topProjects.map(t => ({ label: t.code, value: t.value })), CR.pre, v => mb(v, 2) + U)),
        el(InvCard, { p, title: L ? 'การกระจายตัวเชิงพื้นที่ (10/32 จังหวัด)' : 'Geographic distribution (top 10/32)' },
          hbars(d.byProvince.map(pv => ({ label: L ? pv.th : pv.en, value: pv.value })), CR.post, v => mb(v, 1) + U))),
      secHead('07', L ? 'บทวิเคราะห์เชิงกลยุทธ์' : 'Executive Insight', L ? 'ข้อสรุปและข้อเสนอแนะ' : 'Conclusion & recommendation'),
      el('div', { style: gridR(2) },
        el(InvCard, { p, title: L ? 'ประเด็นวิเคราะห์' : 'Analysis points' },
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: 11 } }, d.insight[L ? 'th' : 'en'].map((it, i) => el('div', { key: i, style: { display: 'flex', gap: 11, alignItems: 'flex-start' } },
            el('div', { style: { flex: '0 0 auto', width: 24, height: 24, borderRadius: 7, background: invRgba(p.brand, 0.12), color: p.brand, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800 } }, i + 1),
            el('div', null, el('div', { style: { fontSize: 13, fontWeight: 800, color: p.ink } }, it[0]), el('div', { style: { fontSize: 12, color: p.sub, marginTop: 2, lineHeight: 1.5 } }, it[1])))))),
        el('div', { style: { background: 'linear-gradient(160deg,' + invRgba(CR.growth, 0.14) + ',' + p.card + ')', border: '1px solid ' + invRgba(CR.growth, 0.35), borderRadius: 16, padding: 20, boxShadow: p.shadow } },
          el('div', { style: { display: 'inline-block', fontSize: 11, fontWeight: 800, color: CR.growth, background: invRgba(CR.growth, 0.15), padding: '3px 10px', borderRadius: 99, marginBottom: 10 } }, '✨ ' + (L ? 'บทวิเคราะห์' : 'AI Insight')),
          el('div', { style: { fontSize: 16, fontWeight: 800, color: p.ink, marginBottom: 8 } }, L ? 'ข้อสรุปสำหรับผู้บริหาร' : 'Executive conclusion'),
          el('div', { style: { fontSize: 12.5, color: p.sub, lineHeight: 1.7 } }, L ? d.conclusionTh : d.conclusionEn),
          el('div', { style: { marginTop: 14, display: 'flex', gap: 12, background: invRgba(CR.growth, 0.1), borderRadius: 12, padding: '12px 14px' } },
            el('div', { style: { fontSize: 20 } }, '🚀'),
            el('div', null, el('div', { style: { fontSize: 11.5, fontWeight: 700, color: CR.growth } }, L ? 'ข้อเสนอแนะ' : 'Recommendation'), el('div', { style: { fontSize: 13, fontWeight: 600, color: p.ink, marginTop: 2, lineHeight: 1.5 } }, L ? 'ขยายวงเงิน L/G เป็น 100 ล้านบาท เพื่อปลดล็อกศักยภาพรับงาน ~1,000 ล้านบาท/ปี' : 'Restore the L/G line to THB 100M to unlock ~THB 1,000M/yr of capacity.'))))),
      el('div', { style: { fontSize: 11, color: p.sub, marginTop: 16, textAlign: 'center' } }, (L ? d.bank.th : d.bank.en) + ' · ' + (L ? d.asOf.th : d.asOf.en) + ' · ' + (L ? 'ข้อมูลจากประวัติเบิก PN PRE/POST และสัญญาสินเชื่อ' : 'Source: PN PRE/POST drawdown history & credit contracts'))
    );
  }

  window.InvestorDashboard = InvestorDashboard;
})();
