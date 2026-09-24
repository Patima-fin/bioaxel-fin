/* page_guarantee.jsx — หลักค้ำประกันสัญญา (Contract Guarantee Tracking) · BIOAXEL
 * ────────────────────────────────────────────────────────────────────────
 * พอร์ตจากหน้าเดียวกันของ Water POG (อ่านอย่างเดียว) — ต่างกันที่ "ที่มาของข้อมูล":
 *   POG = นำเข้าไฟล์ Excel ของทีม · BIO = ดึงจากหน้าโครงการ (#projects) ด้วยปุ่ม
 *   "⤵ ดึงจากโครงการ" (เลือกได้ทีละ 1-2-3… โครงการ) — เฉพาะโครงการที่มี Contract No. จริงแล้ว
 *
 * ★ ข้อมูลโครงการ (ชื่อ/หน่วยงาน/จังหวัด/ประเภท/ภาค/มูลค่าสัญญา) อ่าน "สด" จากหน้าโครงการ
 *   ทุกครั้งที่แสดงผล ผ่าน contractNo — ในแถว guarantees เก็บไว้แค่สำเนาตอนดึง (ใช้เมื่อหาโครงการไม่เจอ)
 *   ส่วนข้อมูลหลักประกัน (ยอด/ธนาคาร/วันสิ้นสุด/สถานะ/การติดตาม) เป็นของหน้านี้ แก้ที่นี่
 * ★ ไม่สร้างแถวอัตโนมัติ (ตั้งใจ): เปิดหน้าพร้อมกัน 2 เครื่อง → ต่างคนต่างสร้าง id ใหม่ = แถวเบิ้ล
 *
 * ★ กติกาสถานะ (เหมือน demo — อย่าเปลี่ยนโดยไม่ถามเจ้าของงาน):
 *   - "ได้รับคืนแล้ว" / "ติดปัญหาฟ้องร้อง" = คนกดเอง (เก็บใน status)
 *   - ที่เหลือระบบคำนวณจาก endDate ทุกครั้งที่แสดงผล → เลยกำหนด = ต้องติดตาม
 *   - แถวที่ไฟล์เขียน "ยังไม่หมดประกัน" แต่ endDate เลยมาแล้ว → ป้าย "ระบบจับเอง"
 */
'use strict';

const GT_DONE   = 'ได้รับหลักค้ำประกันคืนแล้ว';
const GT_LEGAL  = 'ติดปัญหาฟ้องร้อง';
const GT_FOLLOW = 'ต้องติดตาม';
const GT_ACTIVE = 'ยังไม่หมดประกัน';
const GT_AGES   = ['ยังไม่เลยกำหนด', '1–30 วัน', '31–60 วัน', '60 วันขึ้นไป'];
const GT_WHOS   = ['การเงิน', 'เซอร์วิสส่วนกลาง'];
const GT_DEFAULT_PCT = 0.05;   // หลักประกันสัญญาตั้งต้น = 5% ของมูลค่าสัญญา (รวม VAT) — ตาม พรบ.จัดซื้อฯ
const GT_NA     = '(ยังไม่ระบุ)';
/* ── สถานะย่อย = "ตอนนี้เรื่องค้างอยู่ขั้นไหน" ──────────────────────────
   คนละแกนกับสถานะหลัก (หลัก = เวลา คิดจาก endDate · ย่อย = ขั้นตอน คนกดเอง)
   s = ลำดับขั้น ยิ่งมาก = ยิ่งใกล้ได้เงินคืน → ใช้เรียง + นับ "ใกล้ได้รับคืน"
   ★ เพิ่ม/แก้ค่าที่นี่ที่เดียว — ตาราง ตัวกรอง ฟอร์ม Export อ่านจากลิสต์นี้ทั้งหมด */
const GT_SUBS = [
  { v: 'ยังไม่เริ่มติดตาม',        s: 1, side: 'เรา',       cls: 'gt-mute' },
  { v: 'ติดต่อหน่วยงานไม่ได้',      s: 2, side: 'หน่วยงาน', cls: 'gt-bad'  },
  { v: 'รอเตรียม/ส่งเอกสารเพิ่ม',   s: 3, side: 'เรา',       cls: 'gt-warn' },
  { v: 'อยู่ระหว่างแก้ไขงาน',       s: 4, side: 'เรา',       cls: 'gt-warn' },
  { v: 'รอหน่วยงานตรวจรับงาน',      s: 5, side: 'หน่วยงาน', cls: 'gt-info' },
  { v: 'รอการดำเนินการของราชการ',   s: 6, side: 'หน่วยงาน', cls: 'gt-info' },
  { v: 'อยู่ระหว่างเข้ารับคืน',     s: 7, side: 'ใกล้จบ',   cls: 'gt-good' },
];
const GT_SUB_MAP  = GT_SUBS.reduce((m, x) => { m[x.v] = x; return m; }, {});
const GT_SUB_NEAR = 6;    // ขั้นนี้ขึ้นไป = นับว่า "ใกล้ได้รับคืน"
const GT_NEAR_DAYS = 30;  // หรือมีวัน "คาดรับคืน" ภายในกี่วัน
const GT_TREND_MONTHS = 12;   // ช่วงกราฟแนวโน้มการรับคืน (เดือน)
const GT_MON_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

const gtN0 = v => (Number(v) || 0).toLocaleString('th-TH');
const gtN2 = v => (Number(v) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gtIsISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const gtThDate = iso => (gtIsISO(iso) ? iso.split('-').reverse().join('/') : '');
const gtTodayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* รับวันที่ได้ทั้ง 2026-08-17 / 17.08.2026 / 17/08/2569 (พ.ศ.) — ที่ไม่ใช่วันที่คืน '' */
function gtNormDate(s) {
  if (!s) return '';
  s = String(s).trim();
  let y, m, d, mt;
  if (gtIsISO(s)) { [y, m, d] = s.split('-'); }
  else if ((mt = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/))) { d = mt[1]; m = mt[2]; y = mt[3]; }
  else if (s instanceof Date || !isNaN(Date.parse(s))) { const t = new Date(s); y = t.getFullYear(); m = t.getMonth() + 1; d = t.getDate(); }
  else return '';
  y = +y; if (y > 2400) y -= 543;                       // พ.ศ. → ค.ศ.
  if (y < 1990 || y > 2100) return '';
  const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return isNaN(new Date(iso + 'T00:00:00')) ? '' : iso;
}
/* วันที่ย้อนหลัง n วันในรูป ISO (ใช้กรอง "รับคืนวันนี้ / 7 วัน / 30 วัน") */
function gtDaysAgoISO(n) {
  const d = new Date(); d.setDate(d.getDate() - (n || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* วันที่ล่วงหน้า n วันในรูป ISO (ใช้เทียบว่า "คาดรับคืน" อยู่ในอีก 30 วันไหม) */
function gtDaysAheadISO(n) {
  const d = new Date(); d.setDate(d.getDate() + (n || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const gtDaysOver = (endIso) => {
  if (!gtIsISO(endIso)) return null;
  const today = new Date(gtTodayISO() + 'T00:00:00');
  return Math.round((today - new Date(endIso + 'T00:00:00')) / 86400000);
};
function gtAgeBucket(d) {
  if (d === null || d === undefined) return 'ไม่ระบุ';
  if (d <= 0) return 'ยังไม่เลยกำหนด';
  if (d <= 30) return '1–30 วัน';
  if (d <= 60) return '31–60 วัน';
  return '60 วันขึ้นไป';
}
/* เดาสถานะย่อยจากข้อความติดตามล่าสุด
   ★ เดาเพื่อ "ตั้งต้นให้" เท่านั้น — ไม่เขียนลงฐานข้อมูล และติดป้าย "ระบบเดา" ให้คนมาตรวจ
     (แพทเทิร์นเดียวกับป้าย "ระบบจับเอง" ของสถานะหลัก)
   ★ ลำดับกฎสำคัญ: เช็คตัวที่ชัดว่าใกล้จบก่อน แล้วไล่ลงมา — "รอ ผอ. ทำเอกสารคืนเงิน"
     ต้องได้ "รอราชการ" ไม่ใช่ "เข้ารับคืน" จึงวางกฎราชการไว้เหนือคำว่าคืนเงิน */
const GT_SUB_RULES = [
  [/อนุมัติแล้ว|รอโอน|โอนแล้ว|โอนเงินแล้ว|นัดรับ|รับเช็ค|ลงนามคืน|ส่งคืนแล้ว|ทำคืนให้/, 'อยู่ระหว่างเข้ารับคืน'],
  [/ผอ\.|ผู้อำนวยการ|พัสดุ|กองคลัง|เสนอ|นายก|สภา|ผู้บริหาร|ผู้มีอำนาจ|รอลงนาม|ราชการ/, 'รอการดำเนินการของราชการ'],
  [/ทำเรื่องคืน|ดำเนินการคืน|คืนเงิน|ทำคืน|คืนหลักประกัน|คืน ?LG/i,                    'อยู่ระหว่างเข้ารับคืน'],
  [/ตรวจรับ|ตรวจงาน|ตรวจสภาพ|ลงพื้นที่/,                                              'รอหน่วยงานตรวจรับงาน'],
  [/แก้ไขงาน|แก้งาน|ซ่อม|ชำรุด|ยังไม่ผ่าน|บกพร่อง/,                                    'อยู่ระหว่างแก้ไขงาน'],
  [/เอกสาร|หนังสือ|มอบอำนาจ|ยื่นเรื่อง|สำเนา|ใบเสร็จ/,                                 'รอเตรียม/ส่งเอกสารเพิ่ม'],
  [/ไม่รับสาย|ติดต่อไม่ได้|โทรไม่ติด|ไม่อยู่|โทรกลับ|ติดต่อกลับ|ไม่มีคนรับ/,            'ติดต่อหน่วยงานไม่ได้'],
];
function gtGuessSub(r, logs, last) {
  const txt = String((last && last.note) || r.noteFin || r.noteSv || '').trim();
  if (!txt) return logs.length ? '' : 'ยังไม่เริ่มติดตาม';   // ไม่เคยติดตามเลย = ยังไม่เริ่ม
  for (let i = 0; i < GT_SUB_RULES.length; i++) if (GT_SUB_RULES[i][0].test(txt)) return GT_SUB_RULES[i][1];
  return '';
}
/* คำนวณสถานะ + ข้อมูลประกอบของแต่ละแถว (ไม่เก็บลง DB — คิดสดทุกครั้ง)
   proj = แถวโครงการ (PCU.deriveProjects) ที่ contractNo ตรงกัน → ข้อมูลโครงการใช้ของสดจากหน้าโครงการ */
function gtEnrich(r0, proj) {
  const r = proj ? {
    ...r0,
    projectName: proj.site || r0.projectName, owner: proj.customer || r0.owner,
    province: proj.province || r0.province, jobType: proj.type || r0.jobType,
    zone: proj.region || r0.zone, contractAmt: Number(proj.contractAmt) || Number(r0.contractAmt) || 0,
    _projStatus: proj.status || '',
  } : r0;
  const days = gtDaysOver(r.endDate);
  let st;
  if (r.status === GT_DONE || r.receivedDate) st = GT_DONE;
  else if (r.status === GT_LEGAL) st = GT_LEGAL;
  else if (days === null) st = r.status || GT_ACTIVE;
  else st = days > 0 ? GT_FOLLOW : GT_ACTIVE;
  const logs = Array.isArray(r.followUps) ? r.followUps : [];
  const last = logs.length ? logs[logs.length - 1] : null;

  /* สถานะย่อย — ที่คนเลือกเองมาก่อนเสมอ ไม่มีค่อยให้ระบบเดา */
  const subSet   = (r.subStatus && GT_SUB_MAP[r.subStatus]) ? r.subStatus : '';
  const subGuess = subSet ? '' : gtGuessSub(r, logs, last);
  const sub      = subSet || subGuess;
  const step     = GT_SUB_MAP[sub] ? GT_SUB_MAP[sub].s : 0;
  /* ค้างขั้นนี้มากี่วัน — นับจากวันที่กดเปลี่ยนสถานะย่อย
     (ถ้าเป็นค่าที่ระบบเดา ยังไม่มีวันกด → ใช้วันติดตามล่าสุดแทน) */
  const subBase  = subSet ? r.subStatusAt : (last && last.date);
  const subDays  = gtIsISO(subBase) ? gtDaysOver(subBase) : null;

  let expect = '';
  for (let i = logs.length - 1; i >= 0; i--) if (gtIsISO(logs[i].expect)) { expect = logs[i].expect; break; }
  const nextIso = gtNormDate(r.nextFollowDate || r.nextBy);

  return {
    ...r,
    amount: Number(r.amount) || 0,
    _linked: !!proj,
    _pct: (Number(r.contractAmt) > 0 && Number(r.amount) > 0) ? Number(r.amount) / Number(r.contractAmt) * 100 : null,
    _days: days,
    _st: st,
    _auto: r.status === GT_ACTIVE && st === GT_FOLLOW,      // ไฟล์ว่ายังไม่หมดประกัน แต่เลยกำหนดแล้ว
    _who: r.owner_who || GT_NA,
    _age: gtAgeBucket(days),
    _logs: logs,
    _last: last,
    _sub: sub,
    _subAuto: !subSet && !!subGuess,
    _subStep: step,
    _subDays: subDays,
    _next: nextIso,
    _nextDue: st !== GT_DONE && !!nextIso && nextIso <= gtTodayISO(),
    /* ใกล้ได้รับคืน = ขั้นตอนไปถึงปลายทางแล้ว หรือมีวันคาดรับคืนภายใน 30 วัน */
    _near: st !== GT_DONE && st !== GT_LEGAL
           && (step >= GT_SUB_NEAR || (gtIsISO(expect) && expect <= gtDaysAheadISO(GT_NEAR_DAYS))),
  };
}
/* ── เชื่อมกับหน้าโครงการ (#projects) ────────────────────────────────────
   ดึงได้เฉพาะโครงการที่มี "Contract No. จริง" — เลขสังเคราะห์ XL-/WS- ที่ระบบตั้งให้แถวยังไม่มีเลขสัญญา
   ไม่นับ (ยังไม่ได้เซ็นสัญญา = ยังไม่มีหลักประกันสัญญา) */
const gtNormCode = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
const gtIsRealContract = s => { const c = gtNormCode(s); return !!c && c !== '-' && !/^(XL|WS)-/i.test(c); };
const gtCodeKey = s => gtNormCode(s).toUpperCase();

/* ฐานโครงการ — กติกาเดียวกับหน้า #projects (snapshot ในเครื่อง vs ของ sync เอาตัวที่ยาวกว่า)
   ไม่งั้นเครื่องที่อัปไฟล์โครงการเองจะเห็นคนละชุดกับหน้าโครงการ */
function gtBaseProjects(data) {
  let local = [];
  try { local = (window.PCU && PCU.loadLocalProjects && PCU.loadLocalProjects()) || []; } catch (_) { local = []; }
  const synced = (data && data.projects) || [];
  return synced.length > local.length ? synced : (local.length ? local : synced);
}

/* ระยะเวลารับประกันจากไฟล์วิศวกร ("2 ปี", "730 วัน", "24 เดือน", "1 ปี 6 เดือน", "2") → {y,m,d}
   ตัวเลขเปล่า: ≤ 10 = ปี · มากกว่านั้น = วัน · อ่านไม่ออก = null (ไม่เดา) */
function gtParseWarranty(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const pick = re => { const m = s.match(re); return m ? Number(m[1]) : 0; };
  const y = pick(/(\d+(?:\.\d+)?)\s*ปี/), m = pick(/(\d+)\s*เดือน/), d = pick(/(\d+)\s*วัน/);
  if (y || m || d) return { y: Math.floor(y), m: m + Math.round((y % 1) * 12), d };
  const n = Number(s.replace(/[,\s]/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  return n <= 10 ? { y: n, m: 0, d: 0 } : { y: 0, m: 0, d: n };
}
function gtAddPeriod(iso, w) {
  if (!gtIsISO(iso) || !w) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y + (w.y || 0), m - 1 + (w.m || 0), d + (w.d || 0));
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}

/* ค่าที่ระบบ "ตั้งต้นให้" ตอนดึงโครงการเข้าทะเบียน (คนแก้ทีหลังได้ + ติดป้าย "ระบบตั้ง" ให้ตรวจ)
   ยอด   : วงเงิน LG ที่ฝ่ายการเงินกรอกไว้ใน Finance Master ของโครงการ > 5% ของมูลค่าสัญญา
   สิ้นสุด: วันหมดอายุ LG (Finance Master) > วันตรวจรับงวดสุดท้าย (หรือ Finish) + ระยะเวลารับประกัน */
function gtSuggest(p) {
  const raw = p._raw || {};
  const lg = p.lg || null;
  const contract = Number(p.contractAmt) || 0;
  const lgAmt = lg && Number(lg.amount) > 0 ? Number(lg.amount) : 0;
  const amount = lgAmt || Math.round(contract * GT_DEFAULT_PCT * 100) / 100;
  const accepts = (p.installments || []).map(i => i.acceptDate).filter(gtIsISO).sort();
  const base = accepts.length ? accepts[accepts.length - 1] : (gtIsISO(p.finish) ? p.finish : '');
  const warrantyRaw = raw['ระยะเวลาการรับประกัน'];
  const warranty = gtParseWarranty(warrantyRaw);
  const lgExp = lg && gtNormDate(lg.expiry);
  const endDate = lgExp || gtAddPeriod(base, warranty);
  const signed = window.PCU && PCU.isoOf ? PCU.isoOf(raw['เซ็นสัญญา']) : '';
  return {
    amount,
    amountSrc: lgAmt ? 'วงเงิน LG ใน Finance Master' : (contract ? Math.round(GT_DEFAULT_PCT * 100) + '% ของมูลค่าสัญญา' : ''),
    endDate,
    endSrc: lgExp ? 'วันหมดอายุ LG ใน Finance Master'
      : endDate ? ((accepts.length ? 'ตรวจรับงวดสุดท้าย ' : 'Finish ') + gtThDate(base) + ' + ประกัน ' + String(warrantyRaw).trim())
      : (!base ? 'ยังไม่มีวันตรวจรับ/Finish' : 'ไม่มีระยะเวลารับประกันในไฟล์'),
    startDate: gtNormDate(lg && lg.issue) || signed || (gtIsISO(p.start) ? p.start : ''),
    bank: gtNormBank(lg && lg.bank),
    guaranteeType: 'LG',
  };
}
/* แถวใหม่จากโครงการ — เก็บสำเนาข้อมูลโครงการไว้ด้วย (ใช้แสดงเมื่อเลขสัญญาถูกแก้/โครงการถูกลบ) */
function gtRowFromProject(p) {
  const s = gtSuggest(p);
  return {
    id: WTPData.newId(),
    contractNo: gtNormCode(p.contractNo), projectId: p.id || '',
    projectName: p.site || '', owner: p.customer || '', province: p.province || '',
    jobType: p.type || '', zone: p.region || '', contractAmt: Number(p.contractAmt) || 0,
    amount: s.amount, amountAuto: true,
    endDate: s.endDate, endAuto: !!s.endDate,
    startDate: s.startDate, bank: s.bank, guaranteeType: s.guaranteeType,
    status: GT_ACTIVE, owner_who: 'การเงิน',
    followUps: [], pulledAt: gtTodayISO(),
  };
}
const GT_BANK_ALIAS = { 'K-BANK':'KBANK', 'KBANK':'KBANK', 'KASIKORN':'KBANK', 'กสิกร':'KBANK',
  'KK':'KKP', 'KKP':'KKP', 'เกียรตินาคิน':'KKP', 'SCB':'SCB', 'ไทยพาณิชย์':'SCB',
  'KTB':'KTB', 'กรุงไทย':'KTB', 'BBL':'BBL', 'กรุงเทพ':'BBL', 'BAY':'BAY', 'กรุงศรี':'BAY',
  'TTB':'TTB', 'TMB':'TTB', 'GSB':'GSB', 'ออมสิน':'GSB', 'CHLG':'CHLG' };
function gtNormBank(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/เงินสด|cash/i.test(s)) return '';
  const up = s.toUpperCase().replace(/[\s.]/g, '');
  for (const k in GT_BANK_ALIAS) { const kk = k.toUpperCase().replace(/[\s.]/g, ''); if (up === kk) return GT_BANK_ALIAS[k]; }
  for (const k in GT_BANK_ALIAS) { const kk = k.toUpperCase().replace(/[\s.]/g, ''); if (up.indexOf(kk) >= 0) return GT_BANK_ALIAS[k]; }
  return s;
}

/* ต้องติดตาม = ระบบบอกว่าเลยกำหนด + ที่คนมาร์ค "ต้องติดตาม" ไว้เอง */
const gtIsFollow = r => r._st === GT_FOLLOW || (r.status === GT_FOLLOW && r._st === GT_ACTIVE);
const gtSum = arr => arr.reduce((s, r) => s + (Number(r.amount) || 0), 0);
const gtExpect = r => {
  for (let i = (r._logs || []).length - 1; i >= 0; i--) if (gtIsISO(r._logs[i].expect)) return r._logs[i].expect;
  return '';
};


/* ── ไฮไลต์แถวตาม "ค้างมานานแค่ไหน" (นับจากวันสิ้นสุดประกัน) ──
   ยิ่งค้างนาน สียิ่งเข้ม · รับคืนแล้ว / ยังไม่ถึงกำหนด = ไม่ไฮไลต์ */
/* วันที่ได้รับคืนสำหรับกราฟแนวโน้ม
   ★ ไฟล์ต้นทางกรอกคอลัมน์ "วันท่ได้รับคืน" ไม่ครบ (ส่วนใหญ่เขียนวันไว้ในข้อความสถานะล่าสุดแทน
     เช่น "10.10.2566 รับเงินแล้ว") → ถ้าไม่มีวันจริง ใช้วันของบันทึกติดตามล่าสุดเป็นค่าประมาณ
   ใช้เฉพาะการวาดกราฟ — ไม่เขียนกลับลงข้อมูล (ไม่เดาแทนผู้ใช้) */
function gtReturnDate(r) {
  if (gtIsISO(r.receivedDate)) return { iso: r.receivedDate, exact: true };
  if (r._st !== GT_DONE) return null;
  const logs = (r._logs || []).filter(l => gtIsISO(l.date));
  if (!logs.length) return null;
  return { iso: logs[logs.length - 1].date, exact: false };
}
function gtRowTone(r) {
  if (r._st === GT_DONE) return null;
  const d = r._days;
  if (d == null || d <= 60) return null;
  if (d > 365) return { bg: '#fdeaea', bar: '#d94436', label: 'ค้างเกิน 1 ปี' };
  if (d > 180) return { bg: '#fdf0e6', bar: '#e8843a', label: 'ค้าง 6–12 เดือน' };
  return { bg: '#fdf9e7', bar: '#d9a406', label: 'ค้าง 2–6 เดือน' };
}

function gtInjectStyle() {
  if (document.getElementById('gtCssBio1')) return;
  const s = document.createElement('style'); s.id = 'gtCssBio1';
  s.textContent = `
  .gt-hero{position:relative;overflow:hidden;border-radius:14px;padding:13px 20px;margin-bottom:12px;color:#fff;
    background:linear-gradient(135deg,#154524 0%,#21703a 50%,#2e8b4a 100%);box-shadow:0 5px 16px rgba(21,69,36,.22)}
  .gt-hero-row{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
  .gt-co{font-size:10px;opacity:.85;letter-spacing:.16em;text-transform:uppercase;font-weight:600}
  .gt-t{font-size:21px;font-weight:800;line-height:1.15;margin-top:2px}
  .gt-en{font-size:11px;opacity:.75;letter-spacing:.04em}
  .gt-date{font-size:21px;font-weight:800;font-variant-numeric:tabular-nums;text-align:right;line-height:1.1}
  .gt-date small{display:block;font-size:9.5px;font-weight:600;opacity:.75;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px}
  .gt-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:11px}
  @media(max-width:1100px){.gt-kpis{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:620px){.gt-kpis{grid-template-columns:1fr}}
  .gt-c{position:relative;overflow:hidden;border-radius:11px;padding:10px 13px;color:#fff;display:flex;flex-direction:column;gap:6px;
    cursor:pointer;transition:transform .12s;box-shadow:0 3px 10px rgba(21,69,36,.14);border:0;text-align:left;font:inherit;width:100%}
  .gt-c:hover{transform:translateY(-1px)}
  .gt-c.on{outline:2.5px solid rgba(255,255,255,.92);outline-offset:-2.5px}
  .gt-c-ti{font-size:12px;font-weight:700;line-height:1.2}
  .gt-c-su{font-size:9px;opacity:.7;letter-spacing:.07em;text-transform:uppercase}
  .gt-c-b{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
  .gt-c-v{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
  .gt-c-n{font-size:11px;opacity:.9;white-space:nowrap}
  .gt-c-n b{font-size:13px;font-weight:700}
  .gt-split{display:flex;gap:6px;border-top:1px solid rgba(255,255,255,.26);padding-top:6px;margin-top:1px}
  .gt-sp{flex:1;padding:2px 5px;border-radius:6px;cursor:pointer;min-width:0}
  .gt-sp:hover{background:rgba(255,255,255,.16)}
  .gt-sp.on{background:rgba(255,255,255,.25);box-shadow:inset 0 0 0 1.2px rgba(255,255,255,.7)}
  .gt-sp-l{font-size:9.5px;opacity:.9;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .gt-sp-v{font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}
  .gt-bar-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:8px}
  .gt-lb{font-size:11.5px;color:var(--ink-500,#6b7385);font-weight:600}
  .gt-chip{appearance:none;border:1px solid var(--line,#e6ebf3);background:#fff;border-radius:999px;padding:4px 11px;
    font-size:12px;color:var(--ink-600,#475063);cursor:pointer;font-weight:500;white-space:nowrap;font-family:inherit}
  .gt-chip:hover{border-color:var(--brand-400,#47a566);color:var(--brand-700,#1a592f)}
  .gt-chip.on{background:var(--brand-500,#2e8b4a);border-color:var(--brand-500,#2e8b4a);color:#fff}
  .gt-chip.sm{padding:3px 9px;font-size:11.5px}
  .gt-wrap{background:#fff;border:1px solid var(--line,#e6ebf3);border-radius:12px;overflow:hidden}
  .gt-scroll{overflow:auto}
  .gt-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
  .gt-tbl thead th{position:sticky;top:0;z-index:3;background:var(--ink-50,#f7f8fa);color:var(--ink-600,#475063);font-weight:600;
    font-size:11px;text-align:left;padding:7px 9px;border-bottom:1px solid var(--line,#e6ebf3);white-space:nowrap}
  .gt-tbl tbody td{padding:6px 9px;border-bottom:1px solid var(--line-soft,#eef2f7);vertical-align:top}
  .gt-tbl tbody tr:hover{background:var(--brand-50,#eef7f1)!important}
  .gt-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .gt-pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:600;white-space:nowrap}
  .gt-bad{background:#fdecea;color:#c0392b} .gt-warn{background:#fff4e0;color:#a05a00}
  .gt-good{background:#e8f7f0;color:#12805c} .gt-info{background:#eaf2ff;color:#1a4490} .gt-mute{background:#eff1f5;color:#6b7385}
  .gt-auto{display:inline-block;margin-left:4px;font-size:9.5px;padding:0 5px;border-radius:999px;background:#fef3c7;color:#92400e;font-weight:700}
  .gt-fu{cursor:pointer}
  .gt-fu-top{display:flex;gap:5px;align-items:center;font-size:10px;color:#6b7385}
  .gt-fu-n{background:#eaf2ff;color:#1a4490;border-radius:999px;padding:0 5px;font-weight:700}
  .gt-fu-tx{font-size:11.5px;margin-top:1px;line-height:1.35}
  .gt-mini{appearance:none;border:1px solid var(--line,#e6ebf3);background:#fff;border-radius:6px;padding:3px 8px;font-size:11px;
    font-weight:600;cursor:pointer;color:var(--ink-600,#475063);font-family:inherit}
  .gt-mini:hover{border-color:var(--brand-400,#47a566);color:var(--brand-700,#1a592f)}
  .gt-note{background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:9px 13px;font-size:12px;color:#78350f;
    line-height:1.55;margin-bottom:10px}
  .gt-rpt th,.gt-rpt td{border-bottom:1px solid var(--line-soft,#eef2f7);padding:6px 9px;font-size:12px}
  .gt-rpt thead th{background:var(--brand-50,#eef7f1);color:var(--brand-800,#154524);text-align:center;font-weight:700;font-size:11px}
  .gt-rpt thead th.lft{text-align:left}
  .gt-rpt tr.tot td{background:#f7f8fa;font-weight:700;border-top:2px solid #e3e6ec}
  .gt-ov{position:fixed;inset:0;background:rgba(12,23,41,.55);display:grid;place-items:center;z-index:90;padding:18px}
  .gt-mo{background:#fff;border-radius:14px;box-shadow:0 22px 55px rgba(15,36,77,.28);width:min(980px,100%);max-height:92vh;
    overflow:auto;display:flex;flex-direction:column}
  .gt-mo-h{padding:13px 18px;border-bottom:1px solid var(--line,#e6ebf3);display:flex;justify-content:space-between;
    align-items:center;position:sticky;top:0;background:#fff;z-index:2}
  .gt-mo-b{padding:15px 18px}
  .gt-mo-f{padding:11px 18px;border-top:1px solid var(--line,#e6ebf3);display:flex;justify-content:space-between;gap:8px;
    align-items:center;position:sticky;bottom:0;background:#fff}
  .gt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
  .gt-f label{display:block;font-size:11px;color:#6b7385;font-weight:600;margin-bottom:3px}
  .gt-f input,.gt-f select,.gt-f textarea{width:100%;font:inherit;font-size:12.5px;padding:6px 9px;
    border:1px solid var(--line,#e6ebf3);border-radius:7px;background:#fff;color:#1a2538}
  .gt-f input:focus,.gt-f select:focus,.gt-f textarea:focus{outline:none;border-color:var(--brand-400,#47a566)}
  .gt-f input.req{border-color:#e8843a;background:#fffaf5}
  .gt-recv{border:1.5px solid #bbf0d8;background:#f2fbf7;border-radius:10px;padding:11px 13px;margin-top:12px}
  .gt-recv.on{border-color:#12805c;background:#e8f7f0}
  .gt-ck{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#12805c;cursor:pointer}
  .gt-ck input{width:16px;height:16px;cursor:pointer}
  .gt-del{border:1.5px solid #f5c6c2;background:#fdf5f4;border-radius:10px;padding:11px 13px;margin-top:12px}
  .gt-log{border:1px solid var(--line-soft,#eef2f7);border-radius:9px;padding:8px 11px;margin-bottom:6px;background:#fbfcfe}
  .gt-log-h{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#6b7385;font-weight:600}
  .gt-rpt-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin-bottom:13px}
  @media(max-width:1100px){.gt-rpt-kpis{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:620px){.gt-rpt-kpis{grid-template-columns:1fr}}
  .gt-rk{background:#fff;border:1px solid var(--line,#e6ebf3);border-top:3px solid var(--brand-500,#2e8b4a);border-radius:11px;padding:11px 14px;
    box-shadow:0 2px 8px rgba(15,36,77,.05)}
  .gt-rk-l{font-size:11.5px;color:#6b7385;font-weight:600}
  .gt-rk-v{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin-top:2px}
  .gt-rk-s{font-size:10.5px;color:#99a0b0;margin-top:2px}
  .gt-rk-bar{height:5px;border-radius:99px;background:#eff1f5;margin-top:8px;overflow:hidden}
  .gt-rk-bar i{display:block;height:100%;border-radius:99px;transition:width .7s ease}
  .gt-g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:980px){.gt-g2{grid-template-columns:1fr}}
  .gt-hbar{height:9px;border-radius:99px;background:#eff1f5;overflow:hidden}
  .gt-hbar i{display:block;height:100%;border-radius:99px;transition:width .7s ease}
  .gt-top{display:flex;align-items:center;gap:11px;padding:8px 6px;border-bottom:1px solid var(--line-soft,#eef2f7);cursor:pointer;border-radius:8px}
  .gt-top:hover{background:var(--brand-50,#eef7f1)}
  .gt-top:last-of-type{border-bottom:0}
  .gt-top-no{width:24px;height:24px;border-radius:7px;color:#fff;font-size:12px;font-weight:800;display:flex;
    align-items:center;justify-content:center;flex-shrink:0}
  .gt-top-nm{font-size:12.5px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gt-top-sub{font-size:10.5px;color:#99a0b0;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gt-trend-sum{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:12px 15px;border-top:1px solid #eef2f7;background:#fbfcfe}
  @media(max-width:900px){.gt-trend-sum{grid-template-columns:repeat(2,1fr)}}
  .gt-trend-sum>div{display:flex;flex-direction:column}
  .gt-trend-sum span{font-size:10.5px;color:#6b7385;font-weight:600}
  .gt-trend-sum b{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:1px}
  .gt-trend-sum small{font-size:10px;color:#99a0b0}
  /* ดรอปดาวน์แก้ในตารางได้เลย (สถานะย่อย / ผู้รับผิดชอบ) */
  .gt-cellsel{width:100%;max-width:100%;font:inherit;font-size:11.5px;padding:3px 6px;cursor:pointer;
    border:1px solid var(--line,#e6ebf3);border-radius:6px;background:#fff;color:#1a2538}
  .gt-cellsel:hover{border-color:var(--brand-400,#47a566)}
  .gt-cellsel:focus{outline:none;border-color:var(--brand-400,#47a566);box-shadow:0 0 0 2px rgba(46,139,74,.18)}
  .gt-cellsel.none{color:#99a0b0;background:#fbfcfe}
  .gt-cellsel.auto{border-color:#fcd34d;background:#fffbeb}
  .gt-subfoot{display:flex;gap:5px;align-items:center;flex-wrap:wrap;font-size:9.5px;color:#99a0b0;margin-top:2px}
  .gt-nearpin{background:#e8f7f0;color:#12805c;border-radius:999px;padding:0 5px;font-weight:700}
  .gt-chip.sm.near{border-color:#bbf0d8;color:#12805c}
  .gt-chip.sm.near.on{background:#12805c;border-color:#12805c;color:#fff}
  .gt-empty{padding:32px;text-align:center;color:#99a0b0;font-size:12.5px}
  /* ── BIO: เชื่อมหน้าโครงการ ── */
  .gt-sys{display:inline-block;margin-left:4px;font-size:9.5px;padding:0 5px;border-radius:999px;background:#e0f2fe;color:#075985;font-weight:700;vertical-align:1px}
  .gt-orphan{display:inline-block;margin-left:4px;font-size:9.5px;padding:0 5px;border-radius:999px;background:#fdecea;color:#c0392b;font-weight:700}
  .gt-pull-banner{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--brand-50,#eef7f1);
    border:1px solid var(--brand-200,#aedcb8);border-radius:10px;padding:9px 13px;margin-bottom:10px;font-size:12.5px;color:var(--brand-800,#154524)}
  .gt-pl-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
  .gt-pl-tbl th{position:sticky;top:0;z-index:2;background:var(--ink-50,#f7f8fa);font-size:11px;font-weight:600;color:#475063;
    text-align:left;padding:7px 8px;border-bottom:1px solid var(--line,#e6ebf3);white-space:nowrap}
  .gt-pl-tbl td{padding:6px 8px;border-bottom:1px solid var(--line-soft,#eef2f7);vertical-align:top}
  .gt-pl-tbl tr.on td{background:var(--brand-50,#eef7f1)}
  .gt-pl-tbl tr{cursor:pointer}
  .gt-pl-src{font-size:10px;color:#99a0b0;margin-top:1px;white-space:normal;line-height:1.3}
  .gt-ro{background:#f7f8fa!important;color:#475063!important}`;
  document.head.appendChild(s);
}

/* คอลัมน์ของตาราง — ใช้ทั้งหัวตาราง (เรียง/กรอง) และการแสดงค่า */
const GT_COLS = [
  { key: 'contractNo',    label: 'เลขที่สัญญา',      w: 108 },
  { key: 'zone',          label: 'ภาค',              w: 92 },
  { key: 'projectName',   label: 'ชื่องาน / สถานที่', w: 290, al: 'left', min: 230 },
  { key: 'owner',         label: 'หน่วยงาน',         w: 175, al: 'left', min: 140 },
  { key: 'contractAmt',   label: 'มูลค่าสัญญา',      w: 110, al: 'right' },
  { key: 'endDate',       label: 'สิ้นสุดประกัน',    w: 96 },
  { key: '_days',         label: 'เลยกำหนด',         w: 104 },
  { key: 'amount',        label: 'จำนวนเงิน',        w: 104, al: 'right' },
  { key: 'guaranteeType', label: 'ประเภท',           w: 74 },
  { key: 'bank',          label: 'ธนาคาร',           w: 82 },
  { key: '_who',          label: 'ผู้รับผิดชอบ',     w: 128, al: 'left', min: 118 },
  { key: '_expect',       label: 'คาดรับคืน',        w: 92 },
  { key: 'receivedDate',  label: 'วันรับคืน',        w: 96 },
  { key: '_st',           label: 'สถานะ',            w: 112 },
  { key: '_sub',          label: 'สถานะย่อย',        w: 176, al: 'left', min: 168 },
  { key: '_lastNote',     label: 'การติดตามล่าสุด',  w: 230, al: 'left' },
];
/* ค่าที่ใช้ "แสดง + กรอง" ต่อคอลัมน์ (ตัวกรองจะโชว์ค่าชุดนี้) */
function gtColDisplay(r, key) {
  switch (key) {
    case 'endDate':   return gtThDate(r.endDate) || '—';
    case '_days':     return r._st === GT_DONE ? 'รับคืนแล้ว'
                           : r._days == null ? '—'
                           : r._days > 0 ? ('เลยกำหนด ' + r._age) : 'ยังไม่เลยกำหนด';
    case 'amount':    return gtN2(r.amount);
    case 'contractAmt': return r.contractAmt ? gtN2(r.contractAmt) : '—';
    case '_expect':   return gtThDate(gtExpect(r)) || '—';
    case '_sub':      return r._st === GT_DONE ? 'รับคืนแล้ว' : (r._sub || GT_NA);
    case 'receivedDate': return gtThDate(r.receivedDate) || '—';
    case '_lastNote': return r._last ? (r._last.note || '—') : '—';
    default: {
      const v = r[key];
      return (v == null || v === '') ? '—' : String(v);
    }
  }
}
/* ค่าที่ใช้ "เรียง" (ตัวเลข/วันที่เรียงตามค่าจริง ไม่ใช่ข้อความ) */
function gtSortValue(r, key) {
  if (key === 'amount') return Number(r.amount) || 0;
  if (key === 'contractAmt') return Number(r.contractAmt) || 0;
  if (key === '_days')  return r._days == null ? -99999 : r._days;
  if (key === 'endDate') return r.endDate || '';
  if (key === '_expect') return gtExpect(r) || '';
  if (key === '_sub')   return r._st === GT_DONE ? 99 : (r._subStep || 0);   // เรียงตามลำดับขั้น ไม่ใช่ตัวอักษร
  if (key === 'receivedDate') return r.receivedDate || '';
  return String(gtColDisplay(r, key) || '').toLowerCase();
}

const GuaranteePage = ({ data: propData, setData, toast }) => {
  const data = propData || WTPData.load();
  React.useEffect(() => { gtInjectStyle(); }, []);

  const canEdit = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;
  const canDelete = window.WTPAuth ? window.WTPAuth.can('canDelete') : true;
  const [tab, setTab]   = React.useState('a');
  const [fSt, setFSt]   = React.useState('all');
  const [pullOpen, setPullOpen] = React.useState(false);
  const [fWho, setFWho] = React.useState('');
  const [fAge, setFAge] = React.useState('');
  const [q, setQ]       = React.useState('');
  const [fRecv, setFRecv] = React.useState('');   // '' | 'today' | '7d' | '30d' — ช่วงวันที่รับคืน
  const [fSub, setFSub] = React.useState('');    // '' | ค่าใน GT_SUBS | '__near' ใกล้ได้รับคืน | '__none' ยังไม่ระบุ | '__due' ถึงนัดติดตาม
  const [edit, setEdit] = React.useState(null);     // แถวที่กำลังแก้ไข · {} = เพิ่มใหม่
  const [logRow, setLogRow] = React.useState(null); // แถวที่กำลังดู/บันทึกการติดตาม
  const [busy, setBusy] = React.useState('');
  const [rptOpen, setRptOpen] = React.useState({});   // พับ/กางตารางตัวเลขในแท็บรายงาน
  const [trendMonths, setTrendMonths] = React.useState(GT_TREND_MONTHS);   // ช่วงกราฟแนวโน้ม (เดือน)
  /* พับหัวเรื่อง+การ์ด เพื่อให้ตารางใช้พื้นที่เต็มจอ (จำไว้ในเครื่อง) */
  const [slim, setSlim] = React.useState(() => { try { return localStorage.getItem('gt-slim') === '1'; } catch (_) { return false; } });
  const toggleSlim = () => setSlim(v => { const n = !v; try { localStorage.setItem('gt-slim', n ? '1' : '0'); } catch (_) {} return n; });
  /* ตัวกรอง/เรียงรายคอลัมน์ (แบบเดียวกับหน้าเช็คจ่ายล่วงหน้า) */
  const [colFilters, setColFilters] = React.useState({});
  const [openCol, setOpenCol] = React.useState(null);
  const [sort, setSort] = React.useState({ key: '_days', dir: 'desc' });
  const requestSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  /* ── โครงการจากหน้า #projects (derive ชุดเดียวกับหน้าโครงการ) ── */
  const projects = React.useMemo(() => {
    if (!window.PCU || !PCU.deriveProjects) return [];
    try { return PCU.deriveProjects(gtBaseProjects(data), data.invoices || [], data.receipts || []); }
    catch (e) { console.warn('[guarantee] deriveProjects failed', e); return []; }
  }, [data.projects, data.invoices, data.receipts, data.manualOverrides]);
  const projByCode = React.useMemo(() => {
    const m = new Map();
    projects.forEach(p => { if (gtIsRealContract(p.contractNo) && !m.has(gtCodeKey(p.contractNo))) m.set(gtCodeKey(p.contractNo), p); });
    return m;
  }, [projects]);
  const rows = React.useMemo(() => (data.guarantees || []).map(g => gtEnrich(g, projByCode.get(gtCodeKey(g.contractNo)))),
    [data.guarantees, projByCode]);
  /* โครงการที่มีเลขสัญญาแล้ว แต่ยังไม่อยู่ในทะเบียน (ไม่นับที่ยกเลิก) → ตัวเลือกในปุ่มดึง */
  const inReg = React.useMemo(() => new Set((data.guarantees || []).map(g => gtCodeKey(g.contractNo)).filter(Boolean)), [data.guarantees]);
  const pullCands = React.useMemo(() => Array.from(projByCode.values())
    .filter(p => !inReg.has(gtCodeKey(p.contractNo)) && p.status !== 'ยกเลิก'), [projByCode, inReg]);
  const noCodeN = React.useMemo(() => projects.filter(p => !gtIsRealContract(p.contractNo) && p.status !== 'ยกเลิก').length, [projects]);
  const orphanN = rows.filter(r => !r._linked).length;

  /* ── บันทึกลงฐานข้อมูล (setData + forceSyncNow เหมือนหน้าอื่น) ── */
  const persist = (mutate) => {
    if (setData) {
      let updated = null;
      setData(d => { updated = { ...d, guarantees: mutate(d.guarantees || []) }; return updated; });
      /* ★ ห้ามเช็ค updated ทันที — React จะรัน updater ให้แบบทันที (eager state) เฉพาะตอนที่คิวว่าง
         ถ้ามี update ค้างอยู่ (เช่นกดดรอปดาวน์ในตาราง 2 ช่องรัว ๆ) updater จะถูกเลื่อนไปรันตอน render
         → ตรงนี้จะได้ null แล้ว "ไม่ยิงขึ้นเซิร์ฟเวอร์เลย" ทั้งที่หน้าจอเปลี่ยนไปแล้ว = แก้แล้วหาย
         ย้ายการเช็คเข้าไปใน timeout ให้ React รัน updater เสร็จก่อน (ยืนยันด้วยการทดสอบในเบราว์เซอร์) */
      setTimeout(() => { if (updated && WTPData.forceSyncNow) WTPData.forceSyncNow(updated); }, 0);
    } else {
      const d = WTPData.load();
      d.guarantees = mutate(d.guarantees || []);
      WTPData.save(d);
    }
  };
  const upsertRow = (row) => persist(list => {
    const i = list.findIndex(x => x.id === row.id);
    if (i >= 0) { const next = list.slice(); next[i] = { ...next[i], ...row }; return next; }
    return list.concat([{ ...row, id: row.id || WTPData.newId() }]);
  });
  const removeRow = (id) => {
    persist(list => list.filter(x => x.id !== id));
    if (WTPData.forceDeleteRows) setTimeout(() => WTPData.forceDeleteRows('guarantees', [id]), 60);
  };
  /* แก้จากดรอปดาวน์ในตารางได้เลย — เขียนเฉพาะช่องที่เปลี่ยน (upsertRow merge ทับของเดิม)
     ★ เปลี่ยนสถานะย่อย = ประทับวันที่ด้วยเสมอ เพื่อให้นับ "ค้างขั้นนี้กี่วัน" ได้ */
  const setSubStatus = (r, v) => {
    if (v === (r.subStatus || '')) return;
    upsertRow({ id: r.id, subStatus: v, subStatusAt: v ? gtTodayISO() : '' });
    toast && toast(v ? 'สถานะย่อย → ' + v : 'ล้างสถานะย่อยแล้ว', 'success');
  };
  const setOwnerWho = (r, v) => {
    if (v === (r.owner_who || '')) return;
    upsertRow({ id: r.id, owner_who: v });
    toast && toast(v ? 'ผู้รับผิดชอบ → ' + v : 'ล้างผู้รับผิดชอบแล้ว', 'success');
  };

  const follow = rows.filter(gtIsFollow);
  const active = rows.filter(r => r._st === GT_ACTIVE && !gtIsFollow(r));
  const done   = rows.filter(r => r._st === GT_DONE);
  const legal  = rows.filter(r => r._st === GT_LEGAL);
  const autoN  = rows.filter(r => r._auto);

  const pool = fSt === 'follow' ? follow : fSt === 'active' ? active : fSt === 'done' ? done : fSt === 'legal' ? legal : rows;

  /* กรอง → เรียง (ทำตามลำดับเดียวกับ Excel: กรองก่อน แล้วค่อยเรียง) */
  const visible = React.useMemo(() => {
    const kw = q.trim().toLowerCase();
    let out = pool.filter(r => {
      if (fWho && r._who !== fWho) return false;
      if (fAge && r._age !== fAge) return false;
      if (fSub) {
        if (fSub === '__near')      { if (!r._near) return false; }
        else if (fSub === '__none') { if (r._sub) return false; }
        else if (fSub === '__due')  { if (!r._nextDue) return false; }
        else if (r._sub !== fSub)   return false;
      }
      if (fRecv) {
        if (!gtIsISO(r.receivedDate)) return false;
        const back = fRecv === 'today' ? 0 : fRecv === '7d' ? 6 : 29;
        if (r.receivedDate < gtDaysAgoISO(back)) return false;
      }
      if (kw) {
        const hay = [r.contractNo, r.projectName, r.owner, r.province, r.bank, r.zone].join(' ').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    const keys = Object.keys(colFilters).filter(k => colFilters[k] && colFilters[k].size > 0);
    if (keys.length) out = out.filter(r => keys.every(k => colFilters[k].has(gtColDisplay(r, k))));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return out.slice().sort((a, b) => {
      const x = gtSortValue(a, sort.key), y = gtSortValue(b, sort.key);
      if (x === y) return 0;
      return (x > y ? 1 : -1) * dir;
    });
  }, [pool, fWho, fAge, fSub, fRecv, q, colFilters, sort]);

  const clearAllFilters = () => { setColFilters({}); setQ(''); setFWho(''); setFAge(''); setFSub(''); setFRecv(''); };
  const nColFilters = Object.keys(colFilters).filter(k => colFilters[k] && colFilters[k].size > 0).length;

  /* ── KPI ── */
  const whoSplit = [
    ['การเงิน', 'การเงิน', 'rgba(255,255,255,.95)'],
    ['เซอร์วิสส่วนกลาง', 'เซอร์วิส', 'rgba(255,255,255,.6)'],
    [GT_NA, 'ยังไม่ระบุ', 'rgba(255,255,255,.32)'],
  ].map(([w, l, c]) => ({ w, l, c, a: follow.filter(r => r._who === w) })).filter(x => x.a.length);

  const kpiCard = (key, title, sub, arr, grad, extra) => (
    <button key={key} className={'gt-c' + (fSt === key ? ' on' : '')} style={{ background: grad }}
      onClick={() => { setFSt(fSt === key ? 'all' : key); setFWho(''); }} title="คลิกเพื่อกรองเฉพาะกลุ่มนี้">
      <div>
        <div className="gt-c-ti">{title}</div>
        <div className="gt-c-su">{sub}</div>
      </div>
      <div className="gt-c-b">
        <div className="gt-c-v">{gtN2(gtSum(arr))}</div>
        <div className="gt-c-n"><b>{gtN0(arr.length)}</b> โครงการ</div>
      </div>
      {extra}
    </button>
  );
  const followExtra = whoSplit.length > 1 ? (
    <div className="gt-split">
      {whoSplit.map(x => (
        <div key={x.w} className={'gt-sp' + (fWho === x.w ? ' on' : '')}
          onClick={(e) => { e.stopPropagation(); setFSt('follow'); setFWho(fWho === x.w ? '' : x.w); }}
          title={'คลิกดูเฉพาะ' + x.l + ' · ' + gtN0(x.a.length) + ' โครงการ'}>
          <div className="gt-sp-l">{x.l}</div>
          <div className="gt-sp-v">{gtN2(gtSum(x.a))}</div>
        </div>
      ))}
    </div>
  ) : null;

  /* ── ดึงโครงการเข้าทะเบียน (จากปุ่ม "⤵ ดึงจากโครงการ") ──
     ★ กันซ้ำ 2 ชั้น: (1) โมดัลโชว์เฉพาะที่ยังไม่อยู่ในทะเบียน (2) ตอนเขียนเช็คกับ list ล่าสุดอีกรอบ
       (อีกเครื่องอาจดึงโครงการเดียวกันไปแล้วระหว่างเปิดโมดัล) */
  const pullProjects = (picked) => {
    if (!canEdit) { toast && toast('สิทธิ์ไม่พอ', 'error'); return; }
    if (!picked.length) return;
    let added = 0;
    persist(list => {
      const have = new Set(list.map(x => gtCodeKey(x.contractNo)).filter(Boolean));
      const add = [];
      picked.forEach(p => {
        const k = gtCodeKey(p.contractNo);
        if (!k || have.has(k)) return;
        have.add(k); add.push(gtRowFromProject(p));
      });
      added = add.length;
      return add.length ? list.concat(add) : list;
    });
    setPullOpen(false);
    setFSt('all');
    setTimeout(() => toast && toast('ดึงเข้าทะเบียน ' + gtN0(added || picked.length) + ' โครงการแล้ว — ตรวจยอดหลักประกัน/วันสิ้นสุดที่ติดป้าย "ระบบตั้ง"', 'success'), 0);
  };


  const exportExcel = () => {
    const head = ['เลขที่สัญญา', 'ภาค', 'ชื่องาน / สถานที่', 'หน่วยงาน', 'จังหวัด', 'ประเภทงาน', 'มูลค่าสัญญา',
      'วันเริ่มประกัน', 'วันสิ้นสุดประกัน', 'เลยกำหนด (วัน)', 'จำนวนเงิน', 'ประเภทหลักประกัน', 'ธนาคาร',
      'สถานะ', 'สถานะย่อย', 'ค้างขั้นนี้ (วัน)', 'ใกล้ได้รับคืน', 'ผู้รับผิดชอบ', 'วันรับคืน', 'คาดรับคืน',
      'นัดติดตามครั้งถัดไป', 'ติดตามล่าสุด', 'ผู้ติดต่อ', 'เบอร์โทร'];
    const body = visible.map(r => [r.contractNo, r.zone, r.projectName, r.owner, r.province, r.jobType, Number(r.contractAmt) || 0,
      gtThDate(r.startDate), gtThDate(r.endDate), r._days == null ? '' : r._days, Number(r.amount) || 0,
      r.guaranteeType, r.bank, r._st,
      r._st === GT_DONE ? '' : (r._sub ? r._sub + (r._subAuto ? ' (ระบบเดา)' : '') : ''),
      r._subDays != null && r._subDays > 0 ? r._subDays : '',
      r._near ? 'ใช่' : '',
      r._who, gtThDate(r.receivedDate), gtThDate(gtExpect(r)), gtThDate(r._next),
      r._last ? ((r._last.date ? gtThDate(r._last.date) + ' ' : '') + (r._last.note || '')) : '', r.contact, r.tel]);
    const name = 'หลักค้ำประกันสัญญา_' + gtTodayISO() + '.xlsx';
    if (typeof XLSX !== 'undefined') {
      const ws = XLSX.utils.aoa_to_sheet([head].concat(body));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'หลักค้ำประกัน');
      XLSX.writeFile(wb, name);
    } else {
      const csv = [head].concat(body).map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = name.replace('.xlsx', '.csv'); a.click();
    }
    toast && toast('ส่งออก ' + gtN0(visible.length) + ' โครงการแล้ว', 'success');
  };

  /* ── ตาราง ── */
  const dayPill = (r) => {
    const d = r._days;
    const cls = r._st === GT_DONE ? 'gt-good' : d === null ? 'gt-mute' : d > 60 ? 'gt-bad' : d > 0 ? 'gt-warn' : 'gt-info';
    const tx = r._st === GT_DONE ? 'รับคืนแล้ว' : d === null ? '–' : d > 0 ? ('เกิน ' + gtN0(d) + ' วัน') : (d === 0 ? 'ครบวันนี้' : ('อีก ' + gtN0(-d) + ' วัน'));
    return <span className={'gt-pill ' + cls}>{tx}</span>;
  };
  const stPill = (r) => {
    const cls = r._st === GT_DONE ? 'gt-good' : r._st === GT_LEGAL ? 'gt-warn' : r._st === GT_FOLLOW ? 'gt-bad' : 'gt-info';
    const tx = r._st === GT_DONE ? 'รับคืนแล้ว' : r._st === GT_LEGAL ? 'ฟ้องร้อง' : r._st === GT_FOLLOW ? 'ต้องติดตาม' : 'ยังไม่หมดประกัน';
    return <span className={'gt-pill ' + cls}>{tx}</span>;
  };
  const cellOf = (r, key) => {
    switch (key) {
      case 'projectName': return <span>{r.projectName}{r._auto && <span className="gt-auto">ระบบจับเอง</span>}
        {!r._linked && <span className="gt-orphan" title="หาเลขที่สัญญานี้ในหน้าโครงการไม่เจอ (ถูกแก้เลข/ลบโครงการ?) — แสดงข้อมูลที่บันทึกไว้ตอนดึง">ไม่พบในหน้าโครงการ</span>}
        {r._projStatus === 'ยกเลิก' && <span className="gt-orphan">โครงการยกเลิก</span>}</span>;
      case 'endDate':   return gtThDate(r.endDate)
        ? <span>{gtThDate(r.endDate)}{r.endAuto && <span className="gt-sys" title="ระบบคำนวณให้ตอนดึงจากโครงการ — เปิด ✏️ ตรวจแล้วกดบันทึกเพื่อยืนยัน">ระบบตั้ง</span>}</span>
        : '–';
      case '_days':     return dayPill(r);
      case 'amount':    return <span><b>{gtN2(r.amount)}</b>{r.amountAuto && <span className="gt-sys" title="ระบบตั้งให้ตอนดึงจากโครงการ — เปิด ✏️ ตรวจแล้วกดบันทึกเพื่อยืนยัน">ระบบตั้ง</span>}
        {r._pct != null && <div style={{ fontSize: 10, color: '#99a0b0' }}>{(Math.round(r._pct * 100) / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 })}% ของสัญญา</div>}</span>;
      case 'guaranteeType': return <span className={'gt-pill ' + (r.guaranteeType === 'LG' ? 'gt-info' : 'gt-mute')}>{r.guaranteeType || '–'}</span>;
      case '_expect':   return gtExpect(r) ? <span className="gt-pill gt-info">{gtThDate(gtExpect(r))}</span> : '–';
      case 'receivedDate': return r.receivedDate
        ? <span className="gt-pill gt-good">{gtThDate(r.receivedDate)}</span> : '–';
      case '_st':       return stPill(r);
      case '_sub': {
        if (r._st === GT_DONE) return <span className="gt-pill gt-good">รับคืนแล้ว</span>;
        const meta = GT_SUB_MAP[r._sub];
        const foot = (
          <div className="gt-subfoot">
            {r._subAuto && <span className="gt-auto" title="ระบบเดาจากข้อความติดตามล่าสุด — เลือกเองเพื่อยืนยัน">ระบบเดา</span>}
            {r._subDays != null && r._subDays > 0 && <span>ค้างขั้นนี้ {gtN0(r._subDays)} วัน</span>}
            {r._near && <span className="gt-nearpin" title={'ขั้น ' + GT_SUB_NEAR + ' ขึ้นไป หรือมีวันคาดรับคืนภายใน ' + GT_NEAR_DAYS + ' วัน'}>★ ใกล้ได้คืน</span>}
          </div>
        );
        if (!canEdit) return <div>{meta ? <span className={'gt-pill ' + meta.cls}>{r._sub}</span> : '–'}{foot}</div>;
        return (
          <div>
            <select className={'gt-cellsel' + (r._sub ? '' : ' none') + (r._subAuto ? ' auto' : '')}
              value={r._sub} onChange={e => setSubStatus(r, e.target.value)}
              title={r._subAuto ? 'ระบบเดาให้ — เลือกเองเพื่อยืนยัน' : 'เลือกขั้นตอนที่เรื่องค้างอยู่'}>
              <option value="">— ยังไม่ระบุ —</option>
              {GT_SUBS.map(x => <option key={x.v} value={x.v}>{x.s}. {x.v}</option>)}
            </select>
            {foot}
          </div>
        );
      }
      case '_who': {
        if (!canEdit) return r._who || '–';
        return (
          <select className={'gt-cellsel' + (r.owner_who ? '' : ' none')}
            value={r.owner_who || ''} onChange={e => setOwnerWho(r, e.target.value)} title="เลือกผู้รับผิดชอบ">
            <option value="">— ยังไม่ระบุ —</option>
            {GT_WHOS.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        );
      }
      case '_lastNote': return r._last ? (
        <div>
          <div className="gt-fu-top">
            <span className="gt-fu-n">ครั้งที่ {r._logs.length}</span>
            {r._last.date && <span>{gtThDate(r._last.date)}</span>}
          </div>
          <div className="gt-fu-tx">{r._last.note || ''}</div>
        </div>
      ) : <span style={{ color: '#99a0b0' }}>— คลิกเพื่อบันทึก</span>;
      default: return gtColDisplay(r, key);
    }
  };

  const tableA = (
    <div className="gt-wrap">
      <div className="gt-scroll" style={{ maxHeight: slim ? 'calc(100vh - 190px)' : 'calc(100vh - 430px)' }}>
        <table className="gt-tbl">
          <thead>
            <tr>
              {GT_COLS.map(c => (
                <FilterableColHeader key={c.key} label={c.label} sortKey={c.key} colKey={c.key} width={c.w}
                  align={c.al === 'right' ? 'right' : c.al === 'left' ? 'left' : 'center'}
                  sort={sort} sortToggle={requestSort}
                  colFilters={colFilters} setColFilters={setColFilters}
                  openCol={openCol} setOpenCol={setOpenCol}
                  allRows={pool} getValue={gtColDisplay} getSortValue={gtSortValue} />
              ))}
              <th style={{ width: 78, textAlign: 'center' }}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={GT_COLS.length + 1} className="gt-empty">ไม่พบโครงการตามเงื่อนไขที่เลือก</td></tr>}
            {visible.slice(0, 500).map(r => {
              const tone = gtRowTone(r);
              return (
                <tr key={r.id} style={tone ? { background: tone.bg } : null} title={tone ? tone.label : ''}>
                  {GT_COLS.map((c, ci) => (
                    <td key={c.key}
                      className={c.al === 'right' ? 'gt-num' : (c.key === '_lastNote' ? 'gt-fu' : '')}
                      onClick={c.key === '_lastNote' ? () => setLogRow(r) : undefined}
                      style={{
                        maxWidth: c.w, minWidth: c.min, textAlign: c.al === 'right' ? 'right' : (c.al === 'left' ? 'left' : 'center'),
                        borderLeft: ci === 0 ? ('3px solid ' + (tone ? tone.bar : 'transparent')) : undefined,
                        fontWeight: c.key === 'contractNo' ? 700 : undefined,
                      }}>
                      {cellOf(r, c.key)}
                    </td>
                  ))}
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button className="gt-mini" title={'บันทึก/ดูประวัติการติดตาม (' + r._logs.length + ' ครั้ง)'}
                        onClick={() => setLogRow(r)}>📝 {r._logs.length || ''}</button>
                      {canEdit && <button className="gt-mini" title="แก้ไขข้อมูลโครงการนี้" onClick={() => setEdit(r)}>✏️</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#6b7385', padding: '8px 14px', borderTop: '1px solid #eef2f7', background: '#f7f8fa',
                    display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>ไฮไลต์ตามระยะเวลาที่ค้าง:</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: '#fdf9e7', border: '1px solid #d9a406', borderRadius: 2, marginRight: 4 }} />2–6 เดือน</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: '#fdf0e6', border: '1px solid #e8843a', borderRadius: 2, marginRight: 4 }} />6–12 เดือน</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: '#fdeaea', border: '1px solid #d94436', borderRadius: 2, marginRight: 4 }} />เกิน 1 ปี</span>
        <span style={{ marginLeft: 'auto' }}>คลิกหัวคอลัมน์เพื่อเรียง · กดรูปกรวยเพื่อกรองแบบ Excel</span>
      </div>
    </div>
  );

  /* ═══════════ แท็บรายงาน — แดชบอร์ดกราฟ ═══════════ */
  const splitCash = (arr) => {
    const cash = arr.filter(r => r.guaranteeType === 'เงินสด'), lg = arr.filter(r => r.guaranteeType === 'LG');
    return [cash.length, gtSum(cash), lg.length, gtSum(lg), arr.length, gtSum(arr)];
  };
  const cells = (n, a) => [<td key="n" className="gt-num">{n ? gtN0(n) : '–'}</td>, <td key="a" className="gt-num">{a ? gtN2(a) : '–'}</td>];
  const tot2 = splitCash(follow);
  const finR = r => r._who === 'การเงิน', svR = r => r._who === 'เซอร์วิสส่วนกลาง', naR = r => r._who !== 'การเงิน' && r._who !== 'เซอร์วิสส่วนกลาง';
  const hasNa = follow.some(naR);
  const halfKey = (iso) => { if (!gtIsISO(iso)) return 'ไม่ระบุ'; const [y, m] = iso.split('-'); return (+m <= 6 ? 'H1/' : 'H2/') + (Number(y) + 543 - 2500); };
  const halves = React.useMemo(() => {
    const m = {}; follow.forEach(r => { const k = halfKey(r.endDate); (m[k] = m[k] || []).push(r); });
    return Object.entries(m).filter(([k]) => k !== 'ไม่ระบุ').sort((a, b) => {
      const p = s => { const [h, y] = s.split('/'); return Number(y) * 10 + (h === 'H1' ? 1 : 2); };
      return p(a[0]) - p(b[0]);
    });
  }, [follow]);
  const banks = React.useMemo(() => {
    const m = {}; follow.forEach(r => { const b = (r.bank || '').trim() || 'เงินสด / ไม่ระบุ'; m[b] = (m[b] || 0) + (Number(r.amount) || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [follow]);

  const C_DONE = '#16906b', C_ACTIVE = '#2a6fdb', C_FOLLOW = '#d94436', C_LEGAL = '#e87f15';
  const C_CASH = '#7c9cf5', C_LG = '#1f56b8';
  const kBaht = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + ' ลบ.' : gtN0(Math.round(v)));

  const card = (title, sub, body, right) => (
    <div className="gt-wrap" style={{ marginBottom: 14 }}>
      <div style={{ padding: '11px 15px', borderBottom: '1px solid #eef2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: '#6b7385', marginTop: 2 }}>{sub}</div>}
        </div>
        {right}
      </div>
      {body}
    </div>
  );
  const foldBtn = (key, label) => (
    <button className="gt-chip sm" onClick={() => setRptOpen(o => ({ ...o, [key]: !o[key] }))}>
      {rptOpen[key] ? '▲ ซ่อนตาราง' : '▼ ' + (label || 'ดูตารางตัวเลข')}
    </button>
  );

  /* กราฟ 1 — สัดส่วนมูลค่าตามสถานะ */
  const donutStatus = [
    { label: 'ได้รับคืนแล้ว',    value: gtSum(done),   color: C_DONE,   valueLabel: kBaht(gtSum(done)) },
    { label: 'ยังไม่หมดประกัน', value: gtSum(active), color: C_ACTIVE, valueLabel: kBaht(gtSum(active)) },
    { label: 'ต้องติดตาม',      value: gtSum(follow), color: C_FOLLOW, valueLabel: kBaht(gtSum(follow)) },
    { label: 'ติดปัญหาฟ้องร้อง', value: gtSum(legal),  color: C_LEGAL,  valueLabel: kBaht(gtSum(legal)) },
  ].filter(d => d.value > 0);
  /* กราฟ 2 — ประเภทหลักประกันของกลุ่มที่ต้องติดตาม */
  const donutType = [
    { label: 'หนังสือค้ำประกันธนาคาร (LG)', value: tot2[3], color: C_LG,   valueLabel: kBaht(tot2[3]) },
    { label: 'เงินสดค้ำประกัน',             value: tot2[1], color: C_CASH, valueLabel: kBaht(tot2[1]) },
  ].filter(d => d.value > 0);
  /* กราฟ 3 — aging (เงินสด/LG ซ้อนกัน) */
  const agingBars = GT_AGES.map(a => {
    const g = follow.filter(r => r._age === a), s = splitCash(g);
    return { label: a === 'ยังไม่เลยกำหนด' ? 'ยังไม่เลย\nกำหนด' : a,
      segments: [{ key: 'cash', value: s[1], color: C_CASH }, { key: 'lg', value: s[3], color: C_LG }] };
  });
  /* กราฟ 4 — ผู้รับผิดชอบ */
  const whoRows = [
    { label: 'แผนกการเงิน', arr: follow.filter(finR), color: '#2a6fdb' },
    { label: 'แผนกเซอร์วิส', arr: follow.filter(svR), color: '#20c997' },
    ...(hasNa ? [{ label: 'ยังไม่ระบุผู้รับผิดชอบ', arr: follow.filter(naR), color: '#94a3b8' }] : []),
  ];
  const whoMax = Math.max(1, ...whoRows.map(x => gtSum(x.arr)));
  /* กราฟ 5 — ประมาณการครบกำหนดรับคืนรายครึ่งปี */
  const halfBars = halves.map(([k, arr]) => {
    const s = splitCash(arr);
    return { label: k, segments: [{ key: 'cash', value: s[1], color: C_CASH }, { key: 'lg', value: s[3], color: C_LG }] };
  });
  const bankMax = Math.max(1, ...banks.map(b => b[1]));

  /* Top 10 ค้างนานสุด (เฉพาะกลุ่มที่ยังไม่ได้รับคืน) */
  const top10 = React.useMemo(() =>
    follow.filter(r => r._days != null).slice().sort((a, b) => b._days - a._days).slice(0, 10), [follow]);
  const topMaxDays = Math.max(1, ...top10.map(r => r._days || 0));
  /* แนวโน้มการได้รับคืนย้อนหลัง — group ตามเดือนของ "วันที่รับคืน" */
  const trend = React.useMemo(() => {
    const now = new Date(); const out = [];
    for (let i = trendMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      out.push({ key, label: GT_MON_TH[d.getMonth()] + (i === GT_TREND_MONTHS - 1 || d.getMonth() === 0 ? ' ' + String(d.getFullYear() + 543).slice(2) : ''),
        full: GT_MON_TH[d.getMonth()] + ' ' + (d.getFullYear() + 543), value: 0, n: 0 });
    }
    const idx = {}; out.forEach((o, i) => { idx[o.key] = i; });
    let est = 0;
    done.forEach(r => {
      const rd = gtReturnDate(r);
      if (!rd) return;
      const k = rd.iso.slice(0, 7);
      if (idx[k] == null) return;
      out[idx[k]].value += Number(r.amount) || 0;
      out[idx[k]].n += 1;
      if (!rd.exact) est += 1;
    });
    out._est = est;
    return out;
  }, [done, trendMonths]);
  const trendEst = trend._est || 0;
  const trendTotal = trend.reduce((s, t) => s + t.value, 0);
  const trendCount = trend.reduce((s, t) => s + t.n, 0);
  const trendBest = trend.reduce((b, t) => (t.value > b.value ? t : b), { value: 0, label: '—' });

  const reportPane = (
    <React.Fragment>
      {/* ── แถบสรุปหัวรายงาน ── */}
      <div className="gt-rpt-kpis">
        {[
          ['มูลค่าหลักประกันทั้งหมด', gtSum(rows), rows.length, '#21703a', 'ทุกสถานะรวมกัน'],
          ['ยังอยู่กับผู้ว่าจ้าง', gtSum(active) + gtSum(follow) + gtSum(legal), active.length + follow.length + legal.length, '#e8843a', 'ยังไม่ได้รับคืน'],
          ['ต้องติดตาม', gtSum(follow), follow.length, '#d94436', 'เลยกำหนดรับคืนแล้ว'],
          ['ได้รับคืนแล้ว', gtSum(done), done.length, '#16906b', 'ปิดงานแล้ว'],
        ].map(([l, v, n, c, sub]) => (
          <div className="gt-rk" key={l} style={{ borderTopColor: c }}>
            <div className="gt-rk-l">{l}</div>
            <div className="gt-rk-v" style={{ color: c }}>{gtN2(v)}</div>
            <div className="gt-rk-s"><b>{gtN0(n)}</b> โครงการ · {sub}</div>
            <div className="gt-rk-bar"><i style={{ width: (gtSum(rows) ? (v / gtSum(rows) * 100) : 0).toFixed(1) + '%', background: c }} /></div>
          </div>
        ))}
      </div>

      {autoN.length > 0 && (
        <div className="gt-note">
          <b>📌 หมายเหตุ</b> — ระบบคำนวณ "เลยกำหนด" จาก<b>วันสิ้นสุดประกันจริงทุกแถว</b> จึงได้ <b>{gtN0(follow.length)} โครงการ / {gtN2(gtSum(follow))} บาท</b>
          {' '}· ในจำนวนนี้ <b>{gtN0(autoN.length)} โครงการ ({gtN2(gtSum(autoN))} บาท)</b> เป็นของที่ทะเบียนยังมาร์คว่า "ยังไม่หมดประกัน" ทั้งที่เลยกำหนดมาแล้ว
        </div>
      )}

      {/* ── โดนัท 2 ใบ ── */}
      <div className="gt-g2">
        {card('ภาพรวมหลักค้ำประกันสัญญา', 'สัดส่วนมูลค่าตามสถานะ · หน่วย: บาท',
          <div style={{ padding: '14px 16px' }}>
            <Donut size={168} thickness={24} data={donutStatus}
              centerLabel="มูลค่ารวม" centerValue={kBaht(gtSum(rows))} />
          </div>)}
        {card('ประเภทหลักประกันที่ต้องติดตาม', 'เฉพาะกลุ่มที่เลยกำหนดรับคืน',
          <div style={{ padding: '14px 16px' }}>
            <Donut size={168} thickness={24} data={donutType}
              centerLabel="ต้องติดตาม" centerValue={kBaht(gtSum(follow))} />
          </div>)}
      </div>

      {/* ── แท่ง aging ── */}
      {card('โครงการที่อยู่ระหว่างติดตาม — แบ่งตามวันครบกำหนด', 'นับ ณ ' + gtThDate(gtTodayISO()) + ' · แท่งเข้ม = หนังสือค้ำประกันธนาคาร · แท่งอ่อน = เงินสด',
        <div>
          <div style={{ padding: '10px 12px 0' }}>
            <StackedBars data={agingBars} height={250} formatY={kBaht} />
          </div>
          {rptOpen.aging && (
            <div style={{ overflow: 'auto', borderTop: '1px solid #eef2f7' }}>
              <table className="gt-rpt" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr><th rowSpan={2} className="lft" style={{ minWidth: 240 }}>ระยะเวลา</th>
                    <th colSpan={2}>เงินสดค้ำประกัน</th><th colSpan={2}>หนังสือค้ำประกันธนาคาร</th><th colSpan={2}>รวม</th><th rowSpan={2}>ร้อยละ</th></tr>
                  <tr>{['จำนวน', 'จำนวนเงิน', 'จำนวน', 'จำนวนเงิน', 'จำนวน', 'จำนวนเงิน'].map((h, i) => <th key={i}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {GT_AGES.map(a => {
                    const g = follow.filter(r => r._age === a), s = splitCash(g);
                    const pct = tot2[5] ? (s[5] / tot2[5] * 100) : 0;
                    const lbl = a === 'ยังไม่เลยกำหนด' ? 'หมดประกันแล้ว แต่ยังไม่เลยกำหนดวันรับคืน' : 'เลยกำหนดรับคืนหลักค้ำประกัน ' + a;
                    return <tr key={a}><td>{lbl}</td>{cells(s[0], s[1])}{cells(s[2], s[3])}{cells(s[4], s[5])}
                      <td className="gt-num">{s[4] ? pct.toFixed(2) : '–'}</td></tr>;
                  })}
                  <tr className="tot"><td>รวมทั้งสิ้น</td>{cells(tot2[0], tot2[1])}{cells(tot2[2], tot2[3])}{cells(tot2[4], tot2[5])}
                    <td className="gt-num">100.00</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>, foldBtn('aging'))}

      {/* ── ผู้รับผิดชอบ + ธนาคาร ── */}
      <div className="gt-g2">
        {card('แยกตามผู้รับผิดชอบ', 'การเงินโทรตามก่อน · ถ้ามีงานซ่อมส่งต่อให้เซอร์วิส',
          <div style={{ padding: '14px 16px' }}>
            {whoRows.map(x => (
              <div key={x.label} style={{ marginBottom: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{x.label} <span style={{ color: '#99a0b0', fontWeight: 400 }}>· {gtN0(x.arr.length)} โครงการ</span></span>
                  <b style={{ fontVariantNumeric: 'tabular-nums' }}>{gtN2(gtSum(x.arr))}</b>
                </div>
                <div className="gt-hbar"><i style={{ width: (gtSum(x.arr) / whoMax * 100).toFixed(1) + '%', background: x.color }} /></div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: '#99a0b0', marginTop: 2 }}>เทียบสัดส่วนมูลค่าที่ยังต้องติดตามของแต่ละฝ่าย</div>
          </div>)}
        {card('มูลค่าที่ต้องติดตาม แยกตามธนาคารผู้ออก LG', 'รวมชื่อธนาคารที่สะกดต่างกันให้แล้ว',
          <div style={{ padding: '14px 16px' }}>
            {banks.slice(0, 7).map(([b, v]) => (
              <div key={b} style={{ marginBottom: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600 }}>{b}</span>
                  <b style={{ fontVariantNumeric: 'tabular-nums' }}>{gtN2(v)}</b>
                </div>
                <div className="gt-hbar"><i style={{ width: (v / bankMax * 100).toFixed(1) + '%', background: b === 'เงินสด / ไม่ระบุ' ? '#94a3b8' : C_LG }} /></div>
              </div>
            ))}
          </div>)}
      </div>

      {/* ── Top 10 ค้างนานสุด ── */}
      {card('Top 10 โครงการที่ค้างนานที่สุด', 'เรียงจากวันที่เลยกำหนดรับคืนมากสุด · คลิกแถวเพื่อเปิดแก้ไข/บันทึกการติดตาม',
        top10.length ? (
          <div style={{ padding: '12px 15px' }}>
            {top10.map((r, i) => {
              const tone = gtRowTone(r) || { bar: '#94a3b8' };
              return (
                <div key={r.id} className="gt-top" onClick={() => setEdit(r)} title="คลิกเพื่อเปิดฟอร์มแก้ไขโครงการนี้">
                  <div className="gt-top-no" style={{ background: tone.bar }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="gt-top-nm">{r.projectName}</div>
                    <div className="gt-top-sub">
                      {(r.contractNo ? r.contractNo + ' · ' : '') + (r.owner || '—')}
                      {r.bank ? ' · ' + r.bank : ''} · ผู้รับผิดชอบ: {r._who}
                    </div>
                    <div className="gt-hbar" style={{ marginTop: 5 }}>
                      <i style={{ width: (Math.min(1, r._days / topMaxDays) * 100).toFixed(1) + '%', background: tone.bar }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: tone.bar, fontVariantNumeric: 'tabular-nums' }}>
                      {gtN0(r._days)} วัน
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{gtN2(r.amount)}</div>
                    <div style={{ fontSize: 10.5, color: '#99a0b0' }}>สิ้นสุด {gtThDate(r.endDate) || '—'}</div>
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 11, color: '#99a0b0', marginTop: 4 }}>
              รวม 10 อันดับแรก <b>{gtN2(gtSum(top10))}</b> บาท · คิดเป็น {gtSum(follow) ? (gtSum(top10) / gtSum(follow) * 100).toFixed(1) : '0'}% ของมูลค่าที่ต้องติดตามทั้งหมด
            </div>
          </div>
        ) : <div className="gt-empty">ไม่มีโครงการที่เลยกำหนดรับคืน</div>)}

      {/* ── แนวโน้มการได้รับคืนย้อนหลัง ── */}
      {card('แนวโน้มการได้รับหลักประกันคืน — ' + gtN0(trendMonths) + ' เดือนล่าสุด',
        'นับจากวันที่ได้รับคืน · เส้น = มูลค่าที่ได้คืนในเดือนนั้น'
          + (trendEst ? ' · ' + gtN0(trendEst) + ' รายการใช้วันจากบันทึกติดตามล่าสุด (ไฟล์ไม่ได้กรอกวันรับคืน)' : ''),
        <div>
          {trend.some(t => t.value > 0) ? (
            <React.Fragment>
              <div style={{ padding: '10px 12px 0' }}>
                <AreaChart data={trend} height={215} color="#16906b" fillColor="rgba(22,144,107,.14)" />
              </div>
              <div className="gt-trend-sum">
                <div><span>ได้คืนรวมในช่วงนี้</span><b>{gtN2(trendTotal)}</b><small>{gtN0(trendCount)} โครงการ</small></div>
                <div><span>เฉลี่ยต่อเดือน</span><b>{gtN2(trendTotal / trendMonths)}</b><small>{(trendCount / trendMonths).toFixed(1)} โครงการ/เดือน</small></div>
                <div><span>เดือนที่ได้คืนมากสุด</span><b>{gtN2(trendBest.value)}</b><small>{trendBest.label}</small></div>
                <div><span>คงเหลือยังไม่ได้คืน</span><b style={{ color: '#d94436' }}>{gtN2(gtSum(follow) + gtSum(active) + gtSum(legal))}</b>
                  <small>{gtN0(follow.length + active.length + legal.length)} โครงการ</small></div>
              </div>
            </React.Fragment>
          ) : (
            <div className="gt-empty">
              ยังไม่มีข้อมูลวันที่รับคืนย้อนหลัง — กราฟจะขึ้นเมื่อเริ่มบันทึก "ได้รับหลักค้ำประกันคืนแล้ว" พร้อมวันที่รับคืน
            </div>
          )}
          {rptOpen.trend && trend.some(t => t.value > 0) && (
            <div style={{ overflow: 'auto', borderTop: '1px solid #eef2f7' }}>
              <table className="gt-rpt" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead><tr><th className="lft" style={{ minWidth: 130 }}>เดือน</th><th>จำนวนโครงการ</th><th>มูลค่าที่ได้รับคืน</th></tr></thead>
                <tbody>
                  {trend.map(t => (
                    <tr key={t.key}><td>{t.full}</td><td className="gt-num">{t.n ? gtN0(t.n) : '–'}</td>
                      <td className="gt-num">{t.value ? gtN2(t.value) : '–'}</td></tr>
                  ))}
                  <tr className="tot"><td>รวม</td><td className="gt-num">{gtN0(trendCount)}</td><td className="gt-num">{gtN2(trendTotal)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>,
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[12, 24, 36].map(m => (
            <button key={m} className={'gt-chip sm' + (trendMonths === m ? ' on' : '')} onClick={() => setTrendMonths(m)}>{m} เดือน</button>
          ))}
          {trend.some(t => t.value > 0) ? foldBtn('trend') : null}
        </div>)}

      {/* ── ประมาณการครบกำหนดรับคืน ── */}
      {card('ประมาณการโครงการที่จะครบกำหนดรับคืน', 'แบ่งครึ่งปี (พ.ศ.) จากวันสิ้นสุดประกันจริง — ใช้วางแผนทวงคืนล่วงหน้า',
        <div>
          <div style={{ padding: '10px 12px 0' }}>
            {halfBars.length ? <StackedBars data={halfBars} height={240} formatY={kBaht} />
              : <div className="gt-empty">ยังไม่มีข้อมูลวันสิ้นสุดประกัน</div>}
          </div>
          {rptOpen.half && (
            <div style={{ overflow: 'auto', borderTop: '1px solid #eef2f7' }}>
              <table className="gt-rpt" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead><tr><th className="lft" style={{ minWidth: 140 }}>ช่วงเวลา</th>
                  <th>จำนวนโครงการ</th><th>เงินสดค้ำประกัน</th><th>หนังสือค้ำประกันธนาคาร</th><th>รวม</th></tr></thead>
                <tbody>
                  {halves.map(([k, arr]) => { const s = splitCash(arr);
                    return <tr key={k}><td>{k}</td><td className="gt-num">{gtN0(s[4])}</td>
                      <td className="gt-num">{s[1] ? gtN2(s[1]) : '–'}</td><td className="gt-num">{s[3] ? gtN2(s[3]) : '–'}</td>
                      <td className="gt-num" style={{ fontWeight: 700 }}>{gtN2(s[5])}</td></tr>; })}
                  <tr className="tot"><td>รวมทั้งสิ้น</td><td className="gt-num">{gtN0(tot2[4])}</td>
                    <td className="gt-num">{gtN2(tot2[1])}</td><td className="gt-num">{gtN2(tot2[3])}</td>
                    <td className="gt-num">{gtN2(tot2[5])}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>, foldBtn('half'))}

      {/* ── ตารางภาพรวม (ตัวเลขละเอียด) ── */}
      {card('ตารางสรุปภาพรวม', 'ตัวเลขละเอียดสำหรับคัดลอกไปทำรายงาน',
        rptOpen.overview ? (
          <div style={{ overflow: 'auto' }}>
            <table className="gt-rpt" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr><th rowSpan={2} className="lft" style={{ minWidth: 220 }}>รายการ</th>
                  <th colSpan={2}>เงินสดค้ำประกัน</th><th colSpan={2}>หนังสือค้ำประกันธนาคาร</th><th colSpan={2}>รวม</th></tr>
                <tr>{['จำนวน', 'จำนวนเงิน', 'จำนวน', 'จำนวนเงิน', 'จำนวน', 'จำนวนเงิน'].map((h, i) => <th key={i}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {[['ได้รับคืนหลักค้ำประกันแล้ว', done], ['ยังไม่ครบกำหนด', active], ['อยู่ระหว่างติดตาม', follow], ['ติดปัญหาฟ้องร้อง', legal]].map(([l, arr]) => {
                  const s = splitCash(arr);
                  return <tr key={l}><td>{l}</td>{cells(s[0], s[1])}{cells(s[2], s[3])}{cells(s[4], s[5])}</tr>;
                })}
                <tr className="tot"><td>รวมทั้งสิ้น</td>{(() => { const s = splitCash(rows); return [cells(s[0], s[1]), cells(s[2], s[3]), cells(s[4], s[5])]; })()}</tr>
              </tbody>
            </table>
          </div>
        ) : <div style={{ padding: '10px 15px', fontSize: 11.5, color: '#99a0b0' }}>กด "ดูตารางตัวเลข" เพื่อแสดงตารางละเอียด</div>,
        foldBtn('overview'))}
    </React.Fragment>
  );

  return (
    <div className="gt-page">
      {!slim && (
        <div className="gt-hero">
          <div className="gt-hero-row">
            <div>
              <div className="gt-co">บริษัท ไบโอแอ็กซ์เซลล์ จำกัด</div>
              <div className="gt-t">หลักค้ำประกันสัญญา</div>
              <div className="gt-en">Contract Guarantee Tracking</div>
            </div>
            <div className="gt-date"><small>ข้อมูล ณ วันที่</small>{gtThDate(gtTodayISO())}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <button className={'gt-chip' + (tab === 'a' ? ' on' : '')} onClick={() => setTab('a')}>📋 ติดตามสถานะ</button>
        <button className={'gt-chip' + (tab === 'b' ? ' on' : '')} onClick={() => setTab('b')}>📊 รายงาน</button>
        {slim && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--brand-700,#1a592f)' }}>หลักค้ำประกันสัญญา · {gtThDate(gtTodayISO())}</span>}
        <div style={{ flex: 1 }} />
        <button className="gt-chip" onClick={toggleSlim} title="ซ่อน/แสดงหัวเรื่องและการ์ดสรุป เพื่อให้ตารางเต็มจอ">
          {slim ? '▼ แสดงสรุป' : '▲ พับสรุป'}
        </button>
        {canEdit && <button className="gt-chip on" onClick={() => setPullOpen(true)}
          title="เลือกโครงการที่มีเลขที่สัญญาแล้วจากหน้าโครงการ เข้าทะเบียนหลักค้ำประกัน">
          ⤵ ดึงจากโครงการ{pullCands.length ? ' (' + gtN0(pullCands.length) + ')' : ''}</button>}
        <button className="gt-chip" onClick={exportExcel}>⬇ ส่งออก Excel</button>
        <button className="gt-chip" onClick={() => window.print()}>🖨 พิมพ์ / PDF</button>
      </div>
      {busy && <div className="gt-note">{busy}</div>}

      {tab === 'a' ? (
        <React.Fragment>
          {rows.length === 0 && (
            <div className="gt-note">
              ยังไม่มีข้อมูลหลักค้ำประกันในระบบ — กด <b>⤵ ดึงจากโครงการ</b> แล้วเลือกโครงการที่ต้องการ
              (ดึงได้เฉพาะโครงการที่มี <b>เลขที่สัญญา (Contract No.)</b> แล้วในหน้าโครงการ)
            </div>
          )}
          {canEdit && rows.length > 0 && pullCands.length > 0 && (
            <div className="gt-pull-banner">
              <span>📌 มีโครงการที่มีเลขที่สัญญาแล้ว <b>{gtN0(pullCands.length)} โครงการ</b> ที่ยังไม่อยู่ในทะเบียนหลักค้ำประกัน</span>
              <button className="gt-chip sm on" onClick={() => setPullOpen(true)}>เลือกดึงเข้าทะเบียน</button>
            </div>
          )}
          {orphanN > 0 && (
            <div className="gt-note" style={{ background: '#fdf5f4', borderColor: '#f5c6c2', color: '#9b2c22' }}>
              ⚠️ <b>{gtN0(orphanN)} รายการ</b> หาเลขที่สัญญาในหน้าโครงการไม่เจอ (อาจถูกแก้เลขสัญญาหรือลบโครงการ) —
              ระบบแสดงข้อมูลที่บันทึกไว้ตอนดึงแทน · แก้เลขที่สัญญาได้ที่ปุ่ม ✏️ ของรายการนั้น (ป้าย <span className="gt-orphan">ไม่พบในหน้าโครงการ</span>)
            </div>
          )}
          {!slim && autoN.length > 0 && (
            <div className="gt-note" style={{ background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412' }}>
              ⚠️ <b>ระบบตรวจเจอ {gtN0(autoN.length)} โครงการ</b> ที่ทะเบียนยังเขียนว่า "ยังไม่หมดประกัน" แต่วันสิ้นสุดประกันเลยมาแล้ว
              รวม <b>{gtN2(gtSum(autoN))} บาท</b> — ระบบย้ายมาอยู่กลุ่ม "ต้องติดตาม" ให้อัตโนมัติ (แถวที่มีป้าย <span className="gt-auto">ระบบจับเอง</span>)
            </div>
          )}
          {!slim && (
            <div className="gt-kpis">
              {kpiCard('follow', 'ต้องติดตาม', 'follow-up required', follow, 'linear-gradient(135deg,#f2705f 0%,#d94436 100%)', followExtra)}
              {kpiCard('active', 'ยังไม่หมดประกัน', 'within warranty', active, 'linear-gradient(135deg,#5b9eef 0%,#2a6fdb 100%)', null)}
              {kpiCard('done', 'ได้รับคืนแล้ว', 'returned', done, 'linear-gradient(135deg,#20c997 0%,#16906b 100%)', null)}
              {kpiCard('legal', 'ติดปัญหาฟ้องร้อง', 'legal case', legal, 'linear-gradient(135deg,#ffa726 0%,#e87f15 100%)', null)}
            </div>
          )}

          <div className="gt-bar-row">
            {slim && (
              <React.Fragment>
                <span className="gt-lb">กลุ่ม:</span>
                {[['follow', 'ต้องติดตาม', follow], ['active', 'ยังไม่หมดประกัน', active], ['done', 'ได้รับคืนแล้ว', done], ['legal', 'ฟ้องร้อง', legal], ['all', 'ทั้งหมด', rows]].map(([k, l, arr]) => (
                  <button key={k} className={'gt-chip sm' + (fSt === k ? ' on' : '')} onClick={() => { setFSt(k); setFWho(''); }}>{l} <b>{gtN0(arr.length)}</b></button>
                ))}
                <span style={{ width: 12 }} />
              </React.Fragment>
            )}
            <span className="gt-lb">ผู้รับผิดชอบ:</span>
            <button className={'gt-chip sm' + (!fWho ? ' on' : '')} onClick={() => setFWho('')}>ทั้งหมด <b>{gtN0(pool.length)}</b></button>
            {Object.entries(pool.reduce((m, r) => { m[r._who] = (m[r._who] || 0) + 1; return m; }, {}))
              .sort((a, b) => b[1] - a[1])
              .map(([w, c]) => <button key={w} className={'gt-chip sm' + (fWho === w ? ' on' : '')} onClick={() => setFWho(fWho === w ? '' : w)}>{w} <b>{gtN0(c)}</b></button>)}
            <span style={{ width: 10 }} />
            <span className="gt-lb">เลยกำหนด:</span>
            <button className={'gt-chip sm' + (!fAge ? ' on' : '')} onClick={() => setFAge('')}>ทั้งหมด</button>
            {GT_AGES.filter(a => pool.some(r => r._age === a)).map(a => (
              <button key={a} className={'gt-chip sm' + (fAge === a ? ' on' : '')} onClick={() => setFAge(fAge === a ? '' : a)}>
                {a} <b>{gtN0(pool.filter(r => r._age === a).length)}</b>
              </button>
            ))}
          </div>

          <div className="gt-bar-row">
            <span className="gt-lb">สถานะย่อย:</span>
            <button className={'gt-chip sm' + (!fSub ? ' on' : '')} onClick={() => setFSub('')}>ทั้งหมด</button>
            <button className={'gt-chip sm near' + (fSub === '__near' ? ' on' : '')} onClick={() => setFSub(fSub === '__near' ? '' : '__near')}
              title={'ขั้น ' + GT_SUB_NEAR + ' ขึ้นไป หรือมีวันคาดรับคืนภายใน ' + GT_NEAR_DAYS + ' วัน'}>
              ★ ใกล้ได้รับคืน <b>{gtN0(pool.filter(r => r._near).length)}</b>
            </button>
            {GT_SUBS.filter(x => pool.some(r => r._sub === x.v)).map(x => (
              <button key={x.v} className={'gt-chip sm' + (fSub === x.v ? ' on' : '')} onClick={() => setFSub(fSub === x.v ? '' : x.v)}
                title={'ขั้น ' + x.s + ' · ติดอยู่ที่: ' + x.side}>
                {x.s}. {x.v} <b>{gtN0(pool.filter(r => r._sub === x.v).length)}</b>
              </button>
            ))}
            {pool.some(r => !r._sub && r._st !== GT_DONE) && (
              <button className={'gt-chip sm' + (fSub === '__none' ? ' on' : '')} onClick={() => setFSub(fSub === '__none' ? '' : '__none')}>
                ยังไม่ระบุ <b>{gtN0(pool.filter(r => !r._sub).length)}</b>
              </button>
            )}
            {pool.some(r => r._nextDue) && (
              <React.Fragment>
                <span style={{ width: 10 }} />
                <button className={'gt-chip sm' + (fSub === '__due' ? ' on' : '')} onClick={() => setFSub(fSub === '__due' ? '' : '__due')}
                  title="ถึง/เลยวันนัดติดตามที่กรอกไว้แล้ว">
                  🔔 ถึงนัดติดตาม <b>{gtN0(pool.filter(r => r._nextDue).length)}</b>
                </button>
              </React.Fragment>
            )}
          </div>

          <div className="gt-bar-row">
            <span className="gt-lb">วันรับคืน:</span>
            {[['', 'ทั้งหมด'], ['today', 'รับคืนวันนี้'], ['7d', '7 วันล่าสุด'], ['30d', '30 วันล่าสุด']].map(([k, l]) => {
              const n = k ? rows.filter(r => gtIsISO(r.receivedDate)
                && r.receivedDate >= gtDaysAgoISO(k === 'today' ? 0 : k === '7d' ? 6 : 29)).length : null;
              return (
                <button key={k || 'all'} className={'gt-chip sm' + (fRecv === k ? ' on' : '')}
                  onClick={() => { setFRecv(k); if (k) setFSt('all'); }}
                  title={k === 'today' ? 'ใช้หาโครงการที่เพิ่งกดว่ารับคืนไปวันนี้ (เช่น กดพลาด)' : ''}>
                  {l}{n != null && <b> {gtN0(n)}</b>}
                </button>
              );
            })}
          </div>

          <div className="gt-bar-row">
            <input className="gt-chip" style={{ flex: 1, minWidth: 220, maxWidth: 360, padding: '6px 13px' }}
              placeholder="🔍 ค้นหา เลขที่สัญญา / ชื่องาน / หน่วยงาน / จังหวัด" value={q} onChange={e => setQ(e.target.value)} />
            {(nColFilters > 0 || q || fWho || fAge || fSub || fRecv) && (
              <button className="gt-chip" onClick={clearAllFilters} title="ล้างตัวกรองทุกคอลัมน์ + คำค้น">
                ✕ ล้างตัวกรอง{nColFilters ? ' (' + nColFilters + ' คอลัมน์)' : ''}
              </button>
            )}
            <span style={{ fontSize: 11.5, color: '#6b7385' }}>
              แสดง <b>{gtN0(Math.min(visible.length, 500))}</b> จาก <b>{gtN0(visible.length)}</b> โครงการ · รวม <b>{gtN2(gtSum(visible))}</b> บาท
              {visible.length > 500 && ' (แสดง 500 แถวแรก)'}
            </span>
          </div>
          {tableA}
        </React.Fragment>
      ) : reportPane}

      {pullOpen && <GuaranteePullModal cands={pullCands} inRegN={inReg.size} noCodeN={noCodeN}
        onClose={() => setPullOpen(false)} onPull={pullProjects} />}
      {edit && <GuaranteeForm row={edit} proj={projByCode.get(gtCodeKey(edit.contractNo))} canDelete={canDelete} onClose={() => setEdit(null)}
        onSave={(row) => { upsertRow(row); setEdit(null); toast && toast('บันทึกแล้ว', 'success'); }}
        onDelete={(id) => { removeRow(id); setEdit(null); toast && toast('ลบออกจากทะเบียนแล้ว', 'success'); }} />}
      {logRow && <GuaranteeLog row={logRow} canEdit={canEdit} onClose={() => setLogRow(null)}
        onSave={(logs) => { upsertRow({ id: logRow.id, followUps: logs }); setLogRow(null); toast && toast('บันทึกการติดตามแล้ว', 'success'); }} />}
    </div>
  );
};

/* ═══════════ ฟอร์มแก้ไข/เพิ่มโครงการ ═══════════
   ★ "ได้รับคืนแล้ว" ย้ายมาอยู่ในฟอร์มนี้เท่านั้น (เดิมเป็นปุ่ม ✓ ในตาราง — กดพลาดง่าย)
     ติ๊กแล้ว "ต้องกรอกวันที่รับคืน" ถึงจะบันทึกได้
   ★ ลบได้ในฟอร์มนี้ แต่ต้องพิมพ์คำว่า "ยืนยันลบ" ก่อน */
const GT_DEL_WORD = 'ยืนยันลบ';
const GuaranteeForm = ({ row, proj, canDelete, onClose, onSave, onDelete }) => {
  const isNew = !row.id;
  const [f, setF] = React.useState(() => ({
    id: row.id, contractNo: row.contractNo || '', zone: row.zone || '', projectName: row.projectName || '',
    owner: row.owner || '', province: row.province || '', jobType: row.jobType || '',
    contractAmt: Number(row.contractAmt) || 0, projectId: row.projectId || '',
    startDate: row.startDate || '', endDate: row.endDate || '', amount: row.amount == null ? '' : row.amount,
    guaranteeType: row.guaranteeType || 'LG', bank: row.bank || '', lgNo: row.lgNo || '', status: row.status || GT_ACTIVE,
    owner_who: row.owner_who || 'การเงิน', receivedDate: row.receivedDate || '', sentSvDate: row.sentSvDate || '',
    nextBy: row.nextBy || '', contact: row.contact || '', tel: row.tel || '',
    subStatus: row.subStatus || row._sub || '',          // ยังไม่เคยเลือก → เอาค่าที่ระบบเดาไว้มาตั้งต้น (กดบันทึก = ยืนยัน)
    nextFollowDate: row.nextFollowDate || gtNormDate(row.nextBy) || '',
    noteFin: row.noteFin || '', noteSv: row.noteSv || '',
  }));
  const [received, setReceived] = React.useState(() => row.status === GT_DONE || !!row.receivedDate);
  const [err, setErr] = React.useState('');
  const [delMode, setDelMode] = React.useState(false);
  const [delWord, setDelWord] = React.useState('');
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const sug = proj ? gtSuggest(proj) : null;
  const applySuggest = () => {
    if (!sug) return;
    setF(o => ({ ...o, amount: sug.amount, endDate: sug.endDate || o.endDate,
      startDate: o.startDate || sug.startDate, bank: o.bank || sug.bank }));
  };

  const save = () => {
    if (!gtIsRealContract(f.contractNo)) { setErr('ต้องมีเลขที่สัญญา (Contract No.) — ทะเบียนนี้รับเฉพาะโครงการที่เซ็นสัญญาแล้ว'); return; }
    if (f.endDate && !gtIsISO(f.endDate)) { setErr('วันสิ้นสุดประกันไม่ถูกต้อง'); return; }
    if (received && !gtIsISO(f.receivedDate)) { setErr('ติ๊กว่า "ได้รับหลักค้ำประกันคืนแล้ว" ต้องกรอกวันที่รับคืนด้วย'); return; }
    const status = received ? GT_DONE : (f.status === GT_DONE ? GT_ACTIVE : f.status);
    /* สถานะย่อยเปลี่ยน (รวมกรณียืนยันค่าที่ระบบเดา) = ประทับวันที่ใหม่ เพื่อเริ่มนับ "ค้างขั้นนี้" */
    const subChanged = (f.subStatus || '') !== (row.subStatus || '');
    onSave({
      ...f, status, contractNo: gtNormCode(f.contractNo),
      ...(proj ? { projectId: proj.id || f.projectId } : {}),
      amountAuto: false, endAuto: false,           // เปิดฟอร์มแล้วกดบันทึก = คนตรวจแล้ว
      subStatusAt: f.subStatus ? (subChanged || !row.subStatusAt ? gtTodayISO() : row.subStatusAt) : '',
      receivedDate: received ? f.receivedDate : '',
      amount: Number(String(f.amount).replace(/[,\s]/g, '')) || 0,
      followUps: Array.isArray(row.followUps) ? row.followUps : (row._logs || []),
    });
  };
  const F = (label, key, type, req, hint) => (
    <div className="gt-f"><label>{label}</label>
      <input type={type || 'text'} className={req ? 'req' : ''} value={f[key]} onChange={e => set(key, e.target.value)} />
      {hint && <div style={{ fontSize: 10.5, color: '#075985', marginTop: 3 }}>{hint}</div>}</div>
  );
  const RO = (label, val) => (
    <div className="gt-f"><label>{label}</label><input className="gt-ro" readOnly value={val || '—'} tabIndex={-1} /></div>
  );
  const sysHint = (flag, src) => (flag && src) ? 'ระบบตั้งให้จาก ' + src + ' — ตรวจแล้วกดบันทึก = ยืนยัน' : '';
  const days = gtDaysOver(f.endDate);

  return (
    <div className="gt-ov" onMouseDown={e => { if (e.target.classList.contains('gt-ov')) onClose(); }}>
      <div className="gt-mo">
        <div className="gt-mo-h">
          <div>
            <b style={{ fontSize: 15 }}>แก้ไขหลักค้ำประกัน</b>
            <div style={{ fontSize: 11, color: '#6b7385' }}>
              {isNew ? 'ทะเบียนหลักค้ำประกันสัญญา'
                : (row.contractNo ? row.contractNo + ' · ' : '') + (row.projectName || '').slice(0, 70)}
            </div>
          </div>
          <button className="gt-mini" onClick={onClose}>✕</button>
        </div>
        <div className="gt-mo-b">
          {err && <div className="gt-note" style={{ background: '#fdecea', borderColor: '#f5b7b1', color: '#c0392b' }}>{err}</div>}
          {/* ── ข้อมูลโครงการ (อ่านอย่างเดียว — อ้างอิงหน้าโครงการ) ── */}
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            ข้อมูลโครงการ
            {proj ? <span className="gt-pill gt-good">อ้างอิงจากหน้าโครงการ</span>
                  : <span className="gt-orphan">หาเลขที่สัญญานี้ในหน้าโครงการไม่เจอ — แสดงข้อมูลที่บันทึกไว้ตอนดึง</span>}
          </div>
          <div className="gt-grid">
            {F('เลขที่สัญญา (Contract No.) *', 'contractNo', 'text', !gtIsRealContract(f.contractNo),
              proj ? '' : 'แก้ให้ตรงกับเลขในหน้าโครงการ เพื่อเชื่อมข้อมูลกลับ')}
            {RO('หน่วยงานเจ้าของงาน', f.owner)}
            {RO('จังหวัด / ภาค', [f.province, f.zone].filter(Boolean).join(' · '))}
            {RO('ประเภทงาน', f.jobType)}
            {RO('มูลค่าสัญญา (รวม VAT)', f.contractAmt ? gtN2(f.contractAmt) : '')}
          </div>
          <div className="gt-f" style={{ marginTop: 8 }}>
            <label>ชื่องาน / สถานที่</label>
            <textarea rows={2} className="gt-ro" readOnly value={f.projectName} tabIndex={-1} />
          </div>

          {/* ── ข้อมูลหลักประกัน (แก้ที่หน้านี้) ── */}
          <div style={{ fontSize: 12, fontWeight: 700, margin: '14px 0 6px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            ข้อมูลหลักประกัน
            {sug && <button className="gt-mini" onClick={applySuggest}
              title={'ยอด: ' + (sug.amountSrc || '—') + ' · วันสิ้นสุด: ' + (sug.endSrc || '—')}>⤵ คำนวณยอด/วันสิ้นสุดใหม่จากโครงการ</button>}
          </div>
          <div className="gt-grid">
            <div className="gt-f"><label>ประเภทหลักประกัน</label>
              <select value={f.guaranteeType} onChange={e => set('guaranteeType', e.target.value)}>
                <option value="LG">LG (หนังสือค้ำประกันธนาคาร)</option><option value="เงินสด">เงินสด</option></select></div>
            {F('ธนาคารผู้ออกหนังสือค้ำประกัน', 'bank')}
            {F('เลขที่หนังสือค้ำประกัน', 'lgNo')}
            {F('จำนวนเงิน', 'amount', 'text', false, sysHint(row.amountAuto, sug && sug.amountSrc))}
            {F('วันเริ่มประกัน', 'startDate', 'date')}
            {F('วันสิ้นสุดประกัน', 'endDate', 'date', false, sysHint(row.endAuto, sug && sug.endSrc))}
            <div className="gt-f"><label>ผู้รับผิดชอบ</label>
              <select value={f.owner_who} onChange={e => set('owner_who', e.target.value)}>
                {GT_WHOS.map(w => <option key={w} value={w}>{w}</option>)}
                <option value="">(ยังไม่ระบุ)</option></select></div>
            <div className="gt-f"><label>สถานะ (เมื่อยังไม่ได้รับคืน)</label>
              <select value={f.status === GT_DONE ? GT_ACTIVE : f.status} disabled={received}
                onChange={e => set('status', e.target.value)}>
                {[GT_ACTIVE, GT_FOLLOW, GT_LEGAL].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div className="gt-f"><label>สถานะย่อย (เรื่องค้างขั้นไหน)</label>
              <select value={f.subStatus} onChange={e => set('subStatus', e.target.value)}>
                <option value="">— ยังไม่ระบุ —</option>
                {GT_SUBS.map(x => <option key={x.v} value={x.v}>{x.s}. {x.v} · ติดที่{x.side}</option>)}
              </select>
              {!row.subStatus && row._subAuto && f.subStatus === row._sub && (
                <div style={{ fontSize: 10.5, color: '#92400e', marginTop: 3 }}>ระบบเดาจากข้อความติดตามล่าสุด — กดบันทึกเพื่อยืนยัน</div>
              )}
            </div>
            {F('วันนัดติดตามครั้งถัดไป', 'nextFollowDate', 'date')}
            {F('วันที่ส่งต่อให้เซอร์วิส', 'sentSvDate', 'date')}
            {F('ผู้ติดต่อ', 'contact')}
            {F('เบอร์โทร', 'tel')}
          </div>
          <div className="gt-grid" style={{ marginTop: 10 }}>
            <div className="gt-f"><label>สถานะล่าสุด (การเงิน)</label>
              <input value={f.noteFin} onChange={e => set('noteFin', e.target.value)} /></div>
            <div className="gt-f"><label>สถานะล่าสุด (เซอร์วิส)</label>
              <input value={f.noteSv} onChange={e => set('noteSv', e.target.value)} /></div>
          </div>

          {/* ── รับคืนหลักประกัน ── */}
          <div className={'gt-recv' + (received ? ' on' : '')}>
            <label className="gt-ck">
              <input type="checkbox" checked={received} onChange={e => {
                const on = e.target.checked; setReceived(on);
                if (on && !f.receivedDate) set('receivedDate', gtTodayISO());
                if (!on) set('receivedDate', '');
              }} />
              ได้รับหลักค้ำประกันคืนแล้ว
            </label>
            {received ? (
              <div className="gt-grid" style={{ marginTop: 9 }}>
                <div className="gt-f">
                  <label>วันที่ได้รับคืน * (บังคับกรอก)</label>
                  <input type="date" className={gtIsISO(f.receivedDate) ? '' : 'req'} value={f.receivedDate}
                    onChange={e => set('receivedDate', e.target.value)} />
                </div>
                <div style={{ fontSize: 11.5, color: '#12805c', alignSelf: 'end', paddingBottom: 6 }}>
                  บันทึกแล้วโครงการนี้จะย้ายไปกลุ่ม "ได้รับคืนแล้ว" และหลุดจากรายการติดตาม
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: '#6b7385', marginTop: 6 }}>
                {days == null ? 'ยังไม่ได้กรอกวันสิ้นสุดประกัน'
                  : days > 0 ? 'ตอนนี้เลยกำหนดมาแล้ว ' + gtN0(days) + ' วัน'
                  : 'ยังไม่ถึงกำหนด (อีก ' + gtN0(-days) + ' วัน)'}
              </div>
            )}
          </div>

          {/* ── ลบโครงการ ── */}
          {!isNew && canDelete && (
            <div className="gt-del">
              {!delMode ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 11.5, color: '#6b7385' }}>
                    ลบรายการนี้ออกจากทะเบียนหลักค้ำประกัน (ไม่กระทบหน้าโครงการ · ดึงกลับเข้ามาใหม่ได้)
                  </div>
                  <button className="gt-mini" style={{ borderColor: '#f5b7b1', color: '#c0392b' }}
                    onClick={() => setDelMode(true)}>🗑 ลบออกจากทะเบียน</button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 12.5, color: '#c0392b', fontWeight: 700, marginBottom: 6 }}>
                    ⚠ ยืนยันการลบ — พิมพ์คำว่า <b>{GT_DEL_WORD}</b> ในช่องด้านล่าง
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input className="gt-chip" style={{ padding: '6px 12px', minWidth: 180 }} autoFocus
                      placeholder={GT_DEL_WORD} value={delWord} onChange={e => setDelWord(e.target.value)} />
                    <button className="gt-mini" disabled={delWord.trim() !== GT_DEL_WORD}
                      style={{ background: delWord.trim() === GT_DEL_WORD ? '#c0392b' : '#e6ebf3',
                               color: delWord.trim() === GT_DEL_WORD ? '#fff' : '#99a0b0', borderColor: 'transparent' }}
                      onClick={() => { if (delWord.trim() === GT_DEL_WORD) onDelete(row.id); }}>ลบถาวร</button>
                    <button className="gt-mini" onClick={() => { setDelMode(false); setDelWord(''); }}>ยกเลิก</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="gt-mo-f">
          <div style={{ fontSize: 11, color: '#99a0b0' }}>
            {!isNew && row._logs && row._logs.length ? 'มีประวัติการติดตาม ' + row._logs.length + ' ครั้ง (ดูได้ที่ปุ่ม 📝 ในตาราง)' : ''}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="gt-chip" onClick={onClose}>ยกเลิก</button>
            <button className="gt-chip on" onClick={save}>บันทึก</button>
          </div>
        </div>
      </div>
    </div>
  );
};
const GuaranteeLog = ({ row, canEdit, onClose, onSave }) => {
  const [logs, setLogs] = React.useState(() => (Array.isArray(row.followUps) ? row.followUps : (row._logs || [])).slice());
  const [f, setF] = React.useState({ date: gtTodayISO(), note: '', expect: '', contact: row.contact || '', tel: row.tel || '', by: row.owner_who || 'การเงิน' });
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const add = () => {
    if (!f.note.trim()) return;
    setLogs(l => l.concat([{ ...f, note: f.note.trim() }]));
    setF({ date: gtTodayISO(), note: '', expect: '', contact: f.contact, tel: f.tel, by: f.by });
  };
  return (
    <div className="gt-ov" onMouseDown={e => { if (e.target.classList.contains('gt-ov')) onClose(); }}>
      <div className="gt-mo">
        <div className="gt-mo-h">
          <div><b style={{ fontSize: 16 }}>การติดตามหลักค้ำประกัน</b>
            <div style={{ fontSize: 11.5, color: '#6b7385' }}>{row.contractNo ? row.contractNo + ' · ' : ''}{row.projectName}</div></div>
          <button className="gt-mini" onClick={onClose}>✕</button>
        </div>
        <div className="gt-mo-b">
          {logs.length === 0 && <div style={{ color: '#99a0b0', fontSize: 13, marginBottom: 10 }}>ยังไม่มีประวัติการติดตาม</div>}
          {logs.map((l, i) => (
            <div className="gt-log" key={i}>
              <div className="gt-log-h">
                <span>ครั้งที่ {i + 1}{l.date ? ' · ' + gtThDate(l.date) : ''}{l.by ? ' · ' + l.by : ''}</span>
                {canEdit && <button className="gt-mini r" onClick={() => setLogs(x => x.filter((_, j) => j !== i))}>ลบ</button>}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{l.note}</div>
              <div style={{ fontSize: 11.5, color: '#6b7385', marginTop: 3 }}>
                {l.contact && <span>👤 {l.contact}{l.tel ? ' · ' + l.tel : ''}</span>}
                {l.expect && <span style={{ marginLeft: 8 }}>📅 คาดรับคืน {gtThDate(l.expect)}</span>}
              </div>
            </div>
          ))}
          {canEdit && (
            <div style={{ borderTop: '1px dashed #e6ebf3', marginTop: 12, paddingTop: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>บันทึกการติดตามครั้งใหม่</div>
              <div className="gt-grid">
                <div className="gt-f"><label>วันที่ติดตาม</label><input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></div>
                <div className="gt-f"><label>ผู้ติดตาม</label>
                  <select value={f.by} onChange={e => set('by', e.target.value)}>{GT_WHOS.map(w => <option key={w} value={w}>{w}</option>)}</select></div>
                <div className="gt-f"><label>ผู้ติดต่อฝั่งหน่วยงาน</label><input value={f.contact} onChange={e => set('contact', e.target.value)} /></div>
                <div className="gt-f"><label>เบอร์โทร</label><input value={f.tel} onChange={e => set('tel', e.target.value)} /></div>
                <div className="gt-f"><label>คาดว่าจะได้รับคืน</label><input type="date" value={f.expect} onChange={e => set('expect', e.target.value)} /></div>
              </div>
              <div className="gt-f" style={{ marginTop: 9 }}>
                <label>รายละเอียดการติดตาม *</label>
                <textarea rows={2} value={f.note} onChange={e => set('note', e.target.value)} placeholder="เช่น โทรตามแล้ว อยู่ระหว่างทำเรื่องเบิกจ่าย" />
              </div>
              <button className="gt-chip" style={{ marginTop: 8 }} onClick={add}>＋ เพิ่มรายการติดตาม</button>
            </div>
          )}
        </div>
        <div className="gt-mo-f">
          <button className="gt-chip" onClick={onClose}>ปิด</button>
          {canEdit && <button className="gt-chip on" onClick={() => onSave(logs)}>บันทึก</button>}
        </div>
      </div>
    </div>
  );
};

/* ═══════════ ดึงโครงการเข้าทะเบียน ═══════════
   รายการ = โครงการในหน้า #projects ที่มี Contract No. จริง + ยังไม่อยู่ในทะเบียน + ไม่ยกเลิก
   ติ๊กเลือกได้ทีละ 1-2-3… โครงการ หรือเลือกทั้งหมด · ยอด/วันสิ้นสุดที่โชว์ = ค่าที่ระบบจะตั้งให้ (แก้ทีหลังได้) */
const GuaranteePullModal = ({ cands, inRegN, noCodeN, onClose, onPull }) => {
  const list = React.useMemo(() => cands.map(p => ({ p, s: gtSuggest(p) }))
    .sort((a, b) => String(b.p.fy || '').localeCompare(String(a.p.fy || ''))
      || String(a.p.contractNo).localeCompare(String(b.p.contractNo), 'th', { numeric: true })), [cands]);
  const [sel, setSel] = React.useState(() => new Set());
  const [q, setQ] = React.useState('');
  const shown = React.useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return list;
    return list.filter(({ p }) => [p.contractNo, p.site, p.customer, p.province, p.fy ? 'FY' + p.fy : ''].join(' ').toLowerCase().includes(kw));
  }, [list, q]);
  const key = p => gtCodeKey(p.contractNo);
  const toggle = p => setSel(s => { const n = new Set(s); const k = key(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allShownOn = shown.length > 0 && shown.every(({ p }) => sel.has(key(p)));
  const toggleAll = () => setSel(s => {
    const n = new Set(s);
    if (allShownOn) shown.forEach(({ p }) => n.delete(key(p))); else shown.forEach(({ p }) => n.add(key(p)));
    return n;
  });
  const picked = list.filter(({ p }) => sel.has(key(p)));
  const pickedSum = picked.reduce((t, x) => t + (Number(x.s.amount) || 0), 0);

  return (
    <div className="gt-ov" onMouseDown={e => { if (e.target.classList.contains('gt-ov')) onClose(); }}>
      <div className="gt-mo" style={{ width: 'min(1080px,100%)' }}>
        <div className="gt-mo-h">
          <div>
            <b style={{ fontSize: 15 }}>⤵ ดึงโครงการเข้าทะเบียนหลักค้ำประกัน</b>
            <div style={{ fontSize: 11, color: '#6b7385' }}>
              เฉพาะโครงการที่มีเลขที่สัญญา (Contract No.) แล้ว · อยู่ในทะเบียนแล้ว {gtN0(inRegN)} โครงการ
              {noCodeN ? ' · ยังไม่มีเลขสัญญา ' + gtN0(noCodeN) + ' โครงการ (ดึงไม่ได้)' : ''}
            </div>
          </div>
          <button className="gt-mini" onClick={onClose}>✕</button>
        </div>
        <div className="gt-mo-b" style={{ paddingTop: 10 }}>
          {list.length === 0 ? (
            <div className="gt-empty">
              ไม่มีโครงการใหม่ให้ดึง — ทุกโครงการที่มีเลขที่สัญญาอยู่ในทะเบียนแล้ว
              {noCodeN ? <div style={{ marginTop: 6 }}>(อีก {gtN0(noCodeN)} โครงการยังไม่มีเลขสัญญา — ใส่ Contract No. ในไฟล์โครงการแล้วอัปโหลดที่หน้าโครงการก่อน)</div> : null}
            </div>
          ) : (
            <React.Fragment>
              <div className="gt-bar-row">
                <input className="gt-chip" style={{ flex: 1, minWidth: 200, maxWidth: 340, padding: '6px 13px' }} autoFocus
                  placeholder="🔍 ค้นหา เลขที่สัญญา / ชื่องาน / หน่วยงาน / FY" value={q} onChange={e => setQ(e.target.value)} />
                <button className="gt-chip sm" onClick={toggleAll}>{allShownOn ? '☐ ไม่เลือกทั้งหมด' : '☑ เลือกทั้งหมด'}{q ? ' (ที่ค้นเจอ)' : ''}</button>
                <span style={{ fontSize: 11.5, color: '#6b7385' }}>พบ <b>{gtN0(shown.length)}</b> จาก {gtN0(list.length)} โครงการ</span>
              </div>
              <div className="gt-wrap">
                <div className="gt-scroll" style={{ maxHeight: 'calc(92vh - 260px)' }}>
                  <table className="gt-pl-tbl">
                    <thead><tr>
                      <th style={{ width: 30 }}></th><th>เลขที่สัญญา</th><th>ชื่องาน / หน่วยงาน</th><th>สถานะโครงการ</th>
                      <th style={{ textAlign: 'right' }}>มูลค่าสัญญา</th>
                      <th style={{ textAlign: 'right' }}>หลักประกัน (ระบบตั้ง)</th><th>สิ้นสุดประกัน (ระบบตั้ง)</th>
                    </tr></thead>
                    <tbody>
                      {shown.map(({ p, s }) => {
                        const on = sel.has(key(p));
                        return (
                          <tr key={key(p)} className={on ? 'on' : ''} onClick={() => toggle(p)}>
                            <td><input type="checkbox" checked={on} readOnly style={{ cursor: 'pointer' }} /></td>
                            <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{p.contractNo}
                              {p.fy ? <div style={{ fontSize: 10, color: '#99a0b0', fontWeight: 400 }}>FY{p.fy}</div> : null}</td>
                            <td style={{ minWidth: 240 }}>{p.site || '—'}
                              <div className="gt-pl-src">{[p.customer, p.province].filter(Boolean).join(' · ') || '—'}</div></td>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{p.projectStatus || p.status || '—'}</td>
                            <td className="gt-num">{p.contractAmt ? gtN2(p.contractAmt) : '—'}</td>
                            <td className="gt-num"><b>{s.amount ? gtN2(s.amount) : '—'}</b>
                              <div className="gt-pl-src">{s.amountSrc}</div></td>
                            <td style={{ whiteSpace: 'nowrap' }}>{s.endDate ? gtThDate(s.endDate) : <span style={{ color: '#99a0b0' }}>— กรอกทีหลัง</span>}
                              <div className="gt-pl-src" style={{ maxWidth: 190 }}>{s.endSrc}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#6b7385', marginTop: 8, lineHeight: 1.5 }}>
                ชื่องาน / หน่วยงาน / มูลค่าสัญญา จะอ้างอิงหน้าโครงการตลอด (แก้ที่หน้าโครงการแล้วที่นี่เปลี่ยนตาม) ·
                ยอดหลักประกันและวันสิ้นสุดเป็นค่าที่ระบบตั้งให้ — มีป้าย <span className="gt-sys">ระบบตั้ง</span> จนกว่าจะเปิด ✏️ ตรวจแล้วกดบันทึก
              </div>
            </React.Fragment>
          )}
        </div>
        <div className="gt-mo-f">
          <div style={{ fontSize: 12, color: '#475063' }}>
            {picked.length ? <span>เลือก <b>{gtN0(picked.length)}</b> โครงการ · หลักประกันรวม <b>{gtN2(pickedSum)}</b> บาท</span> : 'ยังไม่ได้เลือกโครงการ'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="gt-chip" onClick={onClose}>ยกเลิก</button>
            <button className="gt-chip on" disabled={!picked.length} style={!picked.length ? { opacity: .5, cursor: 'not-allowed' } : null}
              onClick={() => onPull(picked.map(x => x.p))}>⤵ ดึงเข้าทะเบียน {picked.length ? gtN0(picked.length) + ' โครงการ' : ''}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { GuaranteePage });
