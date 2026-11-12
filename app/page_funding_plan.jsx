/* page_funding_plan.jsx — #funding_plan "แผนการเงินล่วงหน้า" · ★ ฉบับ BIO (BIOAXEL)
 *   พอร์ตจาก WTP (waterpog-fin origin/dev 436ef0a) 2026-11-11 — ผู้ใช้ "ทำให้บริษัทไบโอด้วย" · ส่วนที่ต่างจาก WTP:
 *     · ไม่เกี่ยวกับ LIT (ลีซอิท) เลย — ไม่มีแถวเบิก/ดอก/คืน LIT · ไม่มีคอลัมน์เบิก LIT · ไม่มีกล่องตั้งค่า LIT
 *     · รับเงินจากราชการงวดเดียวเท่านั้น 120 วันหลังเซ็น (FUND_FC_PAYTYPES · FUND_RCV_DEFAULT)
 *     · เงินกู้ตอนนี้มีแต่นิตาโฮลดิ้ง → ก.3 "เงินกู้" เป็นแถวกรอกเอง (sec 'loan') · ดอกเบี้ย/เงินต้นเดิมตามตารางหนี้ในระบบ
 *     · ดอกเบี้ย (ผู้ใช้ 2026-11-11): ตปท./สกุลต่างประเทศ = จ่ายทุกเดือน · WCI = จ่ายทุกไตรมาส · หมวดอื่น = เลือกเดือนจ่ายเอง (แถวเริ่ม 0)
 *       ไม่มีรอบ INCOFIN · ไม่มีเช็ครอขึ้น (FUND_QUARTER_CATS · FUND_MONTH_CATS · fundFcDebtSplit → pick)
 *     · ผลิตภัณฑ์ BIO ผู้ใช้จะส่งข้อมูลให้ทีหลัง → FUND_PRODUCTS / FUND_FC_INSTALL / FUND_FC_FACTORY ว่าง (ค่าติดตั้ง/ค่าของโรงงานยังไม่นับ + เตือน)
 *     · % ค่าคอม / % หลักประกัน ผู้ใช้ยังไม่ได้บอกสำหรับ BIO → ไม่ตั้งค่าเริ่ม (นับ 0 + เตือน · ตั้งได้ที่ "เงื่อนไขที่ใช้คิด") — ห้ามเดา
 *     · ใบแจ้งหนี้คงค้างใช้ ivBuildRows + bdArPlanOf แบบ Bank Daily ของ BIO (bdafReceipts ของ BIO รับรูปแบบนั้น) · ไม่มี bdNormAR / bdForecastSettled / bdafUseCf ใน BIO → มีตัวของหน้าเอง (fundFcSettled / fundUseCf)
 *   ตอนพอร์ตรอบหน้าจาก WTP: ทำซ้ำเฉพาะส่วนข้างบนนี้ (ค้นคำว่า "BIO:" ในไฟล์)
 *   (ชื่อเดิม "แผนจัดหาเงินทุน" · ผู้ใช้ขอเปลี่ยน 2026-11-11 · route id / ลิงก์ #funding_plan / key ใน DB ใช้ชื่อเดิม)
 *
 *   หน้าเดียว = งบประมาณการรับ-จ่ายรายเดือน (ผู้ใช้ 2026-11-11 "อยากกรอกยอดเลยว่าจะใช้อะไรเท่าไหร่") — ฟังก์ชัน fundFc* / FundFc*
 *     ก. รับเงิน: INV รอรับ · งวดที่ยังไม่ออก INV · โครงการที่จะลงนาม (ฝ่ายขาย) · เงินกู้ LIT สุทธิค่าธรรมเนียม · รับอื่นๆ
 *     ข. ค่าใช้จ่าย: ประจำ (กรอกเอง) · เกี่ยวกับโครงการ (รวมผู้รับเหมา) · ดอกเบี้ย + เช็คจ่ายล่วงหน้า · คืนเงินกู้/อื่นๆ
 *     ทุกแถวกดดูที่มาได้ · ช่องที่ระบบคิดพิมพ์ทับได้ (fc.ovr) · กติกาแต่ละแถวดูหัวข้อ "แท็บหลัก" ข้างล่าง
 *   ★ 2026-11-11 เอาแท็บ "วิเคราะห์ยอดสัญญาที่ต้องเซ็น (แบบเดิม)" ออกตามที่ผู้ใช้สั่ง พร้อมโค้ดจำลองสถานการณ์ / ยอดสัญญาที่ต้องเซ็น / เช็กลิสต์
 *     ค่าเก่าใน fund.cfg ที่แท็บนั้นใช้ (lenders.alt, targetDate, rcv ฯลฯ) และ fund.check ยังอยู่ใน DB — ไม่ต้องลบ
 *     (lenders.lit.limit ยังเป็นค่าเริ่มของวงเงิน LIT · rcv ยังใช้คิดงวดรับของงานที่กำลังทำใน fundJobs)
 *   ★ โหมดนำเสนอ (ปุ่มบน Topbar แบบ Weekly Forecast · body.present-mode): ซ่อนปุ่ม/การ์ดตั้งค่า (no-present) ตารางเป็นอ่านอย่างเดียว
 *   ★ หน้าตาตามแบบที่ผู้ใช้ทำใน Claude Design (2026-11-11 "ทำให้เหมือนอันนี้"): หัว + 1 ภาพรวม (ข้อสรุป + เงินในบัญชี + รับ − จ่าย = เหลือ)
 *     → 2 ตารางรายเดือนแบบการ์ด (แถวเป็น CSS grid คอลัมน์เดียวกัน --fund-cols · ชื่อแถวติดซ้ายตอนเลื่อน · overflow: clip ไม่ใช่ hidden ไม่งั้น sticky ไม่ทำงาน)
 *     → 3 โครงการที่จะลงนาม (พับได้ · กลุ่มตามเดือนเซ็น · โชว์ 5 แถวแล้ว "แสดงอีก") → 4 เงื่อนไข + รายการที่อาจตกหล่น (พับได้ · "แก้เงื่อนไข" เปิด FundFcSettings)
 *     คำเตือนเป็นป้ายบนแถว (chipOf) + แถบ "ยังต้องดูอีก N เรื่อง" ที่พับไว้ · ช่องตัวเลขยังพิมพ์ทับได้ (FundCell · ลูกศร/Enter หาเซลล์ใน .fund-sheet)
 *
 *   ค่าใช้จ่ายประจำ (ข.1) = กรอกยอดเองทุกเดือน 3 แถวหลักชื่อตามงบกำไรขาดทุน Selling / Administrative / Finance costs (FUND_FIXED_PARTS)
 *     + แถวที่เพิ่มเอง (cfg.extra) · เก็บ cfg.fixed.m.<k>['YYYY-MM'] / cfg.extra[].m · ยอดเท่ากันทุกเดือนแบบเก่า (cfg.fixed.<k>,
 *     extra.amount/from/to) ยังอ่านได้ (fundFixedVal / fundExtraVal) — แก้ช่องแรกเมื่อไหร่แถวนั้นแตกเป็นรายเดือน · ช่องว่าง = 0
 *     ผู้ใช้ "ทำให้สวยใช้ง่ายเหมือนเว็บ Budget · นี่โบ้เบ้ รก": สี/ป้ายแบบหน้า Budget · FundCell ไม่มีกรอบจนชี้/คลิก · พิมพ์ 2.5ล = 2.5 ล้าน
 *     (fundParseAmt) · Enter = เดือนถัดไป ↑↓ = แถวบน/ล่าง · ปุ่ม ⇉ / ✕ โผล่ตอนชี้ที่แถว · อย่าเติมกล่อง/ข้อความกลับ
 *     ค่าเฉลี่ยจ่ายจริงจาก Cash Flow (bdaf* ชุดเดียวกับ Bank Daily) ใช้แค่เป็นตัวเลขเทียบในคำเตือนตอนยังไม่กรอก
 *   โครงการที่จะลงนาม (fund.p.<id>): มูลค่าเป็นยอดเงิน หรือผลิตภัณฑ์ × จำนวน × ราคาต่อชุด (row.valueMode 'items' · FUND_PRODUCTS
 *     = ราคาชุดเดียวกับหน้า Investor) · นำเข้าจากไฟล์ฝ่ายขาย / เลือกจากหน้าโครงการ / เพิ่มเอง
 *   ตารางหนี้ (fundDebtRows → ดอกเบี้ย ข.3 + เงินต้นที่เลือกคืน): debtMaster Active · ดอกเบี้ยจาก debtLedger (ลีซอิท = interestSchedulePrepaid)
 *     ★ เลขสัญญาซ้ำ (โอนมือแล้วตัวเก่ายังเปิดค้าง): แถวดอกเบี้ยที่ไม่มี contractId เป็นของสัญญาที่ครบหลังสุดเท่านั้น ไม่งั้นนับซ้ำ
 *     ★ ช่องวันครบของสัญญาเก่าบางแถวเก็บจำนวนเดือน ("6", "7") → ถือว่าไม่มีวันครบ (fundDue)
 *     ★ เลยกำหนดแล้วแต่ยัง Active = "รอตรวจ" · นักลงทุนที่จะครบ ค่าเริ่ม = ต่อสัญญา (ผู้ใช้ 2026-11-03 "WCI ทุกคนเป็นต่อสัญญา")
 *     ★ สินเชื่อโอนสิทธิ์ (debtGroupOf = assign) ค่าเริ่ม = หักจากเงินรับ ไม่นับเงินต้นซ้ำ · เปลี่ยนรายสัญญาได้ (fund.debt)
 *     ★ สัญญาสกุลต่างประเทศ: ไม่รวมจนกว่าจะใส่อัตราแลกเปลี่ยน (ห้ามบวกข้ามสกุล)
 *   หลักประกันสัญญา: ออก LG ใบใหม่ได้เฉพาะธนาคารที่ติ๊ก (lgIssue · ค่าเริ่ม KBANK — KTB เป็นใบเก่า ไม่ออกใบใหม่แล้ว)
 *     วงเงินที่นับ = "ว่างตอนนี้" ที่ใส่เอง (lgFree) · ไม่พอ = วางเงินสด 1 ต่อ 1
 *   งานที่กำลังทำ (fundJobs): AP ที่ตั้งแล้วยังไม่จ่าย + ต้นทุนที่เหลือ (FUND_COSTS) + งวดที่ยังไม่ได้รับ (→ แถว "งวดที่ยังไม่ออก INV")
 *
 *   เก็บใน manualOverrides (แชร์ทั้งทีม · ไม่มี migration · ไม่แตะตารางหนี้/ประมาณการ/โครงการ):
 *     fund.cfg (cfg.fc = เงื่อนไขของงบ · fixed · extra · lgPct · lgFree/lgIssue · fx · endMonth) · fund.p.<id> = โครงการที่จะลงนาม
 *     fund.debt = { contractId: pay|roll|netted } · fund.incsched = ตารางดอกเบี้ย Incofin ที่นำเข้า
 *   ค่าตั้งต่อคน (การ์ดที่กางอยู่ · กลุ่มที่พับ) = localStorage 'wtp.fund'
 *   ★ ชื่อ global ขึ้นต้น fund / Fund / FUND_ — ทุกไฟล์ .jsx แชร์ scope เดียวกัน
 */
'use strict';

const FUND_LS        = 'bio.fund';
const FUND_CFG_KEY   = 'fund.cfg';
const FUND_DEBT_KEY  = 'fund.debt';
const FUND_CHECK_KEY = 'fund.check';
const FUND_PIPE      = 'fund.p.';
/* ต้นทุนหลังเซ็นสัญญา — วัดจากโครงการที่เซ็น มิ.ย. 67 – มี.ค. 69 (PV จ่ายจริง + ใบรับเงิน)
 *   pct = % ของมูลค่าสัญญา (รวม VAT) · curve = % ของรายการนั้นที่จ่ายในแต่ละช่วงวันหลังเซ็น (FUND_CURVE_DAYS)
 *   ค่าของ = PV คลังกลาง ม.ค. 68 – ส.ค. 69 ÷ สัญญาที่เซ็น ก.ย. 67 – เม.ย. 69 (โยงรายโครงการได้แค่ 31% จึงใช้ภาพรวม) */
const FUND_CURVE_DAYS = [[0, 30], [31, 60], [61, 90], [91, 120], [121, 150], [151, 210], [211, 300]];
// ผู้ใช้แจ้ง 2026-11-05: ต้นทุน 80% ของมูลค่าสัญญาที่เซ็น ไม่รวมหลักประกัน 5% · curve = ค่าถัวของ ของ 39 / ติดตั้ง 14 / คอม 4.5 / อื่นๆ 6 ที่วัดไว้
const FUND_COSTS = [
  { k: 'cost', t: 'ต้นทุนโครงการ', pct: 80, curve: [6.2, 6.2, 8.8, 11.0, 14.4, 36.2, 17.2] },
];
/* ราคาผลิตภัณฑ์ต่อชุด — ชุดเดียวกับ INV_PRODUCTS หน้า Investor (ไฟล์ "ราคาผลิตภัณฑ์ WATER POG.xlsx") · ในฟอร์มแก้ราคาได้รายแถว */
const FUND_PRODUCTS = [];   // BIO: ผู้ใช้จะส่งรายการผลิตภัณฑ์ (ราคา/ค่าติดตั้ง/ค่าของโรงงานต่อชุด) ให้ทีหลัง
const FUND_PROD_GROUPS = FUND_PRODUCTS.reduce((a, x) => (a.indexOf(x.group) >= 0 ? a : a.concat([x.group])), []);
function fundProdOf(code) { return FUND_PRODUCTS.find(x => x.code === code) || null; }
function fundItemSum(x) { return (Number(x.qty) || 0) * (Number(x.price) || 0); }
function fundItemsSum(items) { return (items || []).reduce((s, x) => s + fundItemSum(x), 0); }
function fundItemName(x) { const pr = fundProdOf(x.code); return pr ? pr.name : (String(x.name || '').trim() || 'อื่นๆ'); }
function fundItemsText(r) {
  if (!r || r.valueMode !== 'items' || !(r.items || []).length) return '';
  return r.items.filter(x => Number(x.qty) > 0).map(x => fundItemName(x) + ' ' + fmtNum(Number(x.qty), Number(x.qty) % 1 ? 2 : 0) + ' ชุด').join(' · ');
}
/* 3 แถวหลักของข้อ 1 · ชื่อตามหน้างบกำไรขาดทุน (PL_GROUPS ใน page_pnl.jsx · ผู้ใช้ 2026-11-09 ขอใช้คำอังกฤษ) · สี/ป้ายแบบหน้า Budget
 * Finance costs ไม่รวมดอกเบี้ย (คิดในข้อ ข.3 จากตารางหนี้) */
const FUND_FIXED_PARTS = [
  { k: 'sales', t: 'Selling expenses',        th: 'ค่าใช้จ่ายในการขาย',                     c: '#2F5FD0', b: 'SEL' },
  { k: 'admin', t: 'Administrative expenses', th: 'ค่าใช้จ่ายในการบริหาร',                  c: '#7C5CE0', b: 'ADM' },
  { k: 'fin',   t: 'Finance costs',           th: 'ต้นทุนทางการเงิน · รวมดอกเบี้ยที่จะจ่าย', c: '#E85D9A', b: 'FIN' },
];
/* ช่องตัวเลข: พิมพ์ 2.5ล / 2.5m = 2,500,000 · 500k / 500พัน = 500,000 · คืน undefined = พิมพ์ไม่ถูก ไม่บันทึก */
function fundParseAmt(s) {
  let t = String(s == null ? '' : s).replace(/[,\s฿]/g, '').toLowerCase();
  if (t === '') return null;
  let mul = 1;
  if (/(ล้าน|ล|m)$/.test(t)) { mul = 1e6; t = t.replace(/(ล้าน|ล|m)$/, ''); }
  else if (/(พัน|k)$/.test(t)) { mul = 1e3; t = t.replace(/(พัน|k)$/, ''); }
  const n = Number(t);
  return t !== '' && isFinite(n) ? Math.round(n * mul * 100) / 100 : undefined;
}
/* ยอดรายเดือนที่กรอกเอง (m = { 'YYYY-MM': บาท }) · แถวที่ยังไม่เคยกรอกรายเดือน = ยอดเท่ากันทุกเดือนแบบเดิม */
/* BIO: รายละเอียดของแถวค่าใช้จ่ายประจำ (ผู้ใช้ 2026-11-11 "รายการของ ADMIN ใส่ยอดตามรูปนี้เป็นดีเทล ตอนกดดู")
 *   ยอดต่อเดือนของแต่ละรายการ · ผลรวม = ยอดของแถวทุกเดือน (ช่องสีเทา) · พิมพ์ทับรายเดือนได้ (cfg.fixed.m.<k>)
 *   แก้ในหน้าต่างรายละเอียด → เก็บ cfg.fixed.items.<k> = [{ n, a }] (มีแล้ว = ใช้แทนค่าเริ่มนี้ · [] = ไม่มีรายละเอียด) */
const FUND_FIXED_DETAIL_DEF = {
  admin: [   // รูปจากผู้ใช้ 2026-11-11 · รวม 2,739,700 บาท/เดือน
    { n: 'เงินเดือน', a: 2200000 }, { n: 'ประกันสังคม', a: 100000 }, { n: 'ค่างวดรถ', a: 16000 }, { n: 'ค่ากูเกิ้ล', a: 27000 },
    { n: 'กองทุนสำรองเลี้ยงชีพ', a: 150000 }, { n: 'ค่าเช่าโกดัง', a: 46000 }, { n: 'ค่าเช่าโรงงานสุพรรณ', a: 15000 }, { n: 'ค่าโทรศัพท์รวม', a: 7300 },
    { n: 'ค่าน้ำมัน', a: 50000 }, { n: 'ภ.ง.ด.', a: 110000 }, { n: 'ค่าไฟ', a: 6000 }, { n: 'กยศ.', a: 10000 }, { n: 'ค่าอินเทอร์เน็ตรวม', a: 2400 },
  ],
};
function fundFixedDetail(cfg, k) {
  const it = cfg.fixed && cfg.fixed.items && cfg.fixed.items[k];
  return (Array.isArray(it) ? it : (FUND_FIXED_DETAIL_DEF[k] || [])).filter(x => x && (String(x.n || '').trim() || Number(x.a)));
}
/* หน้าต่างรายละเอียดของแถวค่าใช้จ่ายประจำ — ดูได้ทุกคน (รวมโหมดนำเสนอ) · แก้ได้เฉพาะคนที่แก้ได้และไม่ได้อยู่ในโหมดนำเสนอ */
function FundFixedDetailModal({ part, items, typedN, canEdit, onSave, onClearTyped, onClose }) {
  const [draft, setDraft] = React.useState(() => items.map((x, i) => ({ id: i + 1, n: x.n || '', a: fundN(x.a) })));
  const dirty = JSON.stringify(draft.map(x => [x.n.trim(), x.a || 0])) !== JSON.stringify(items.map(x => [String(x.n || '').trim(), Number(x.a) || 0]));
  const total = draft.reduce((t, x) => t + (Number(x.a) || 0), 0);
  const set = (id, patch) => setDraft(d => d.map(x => (x.id === id ? Object.assign({}, x, patch) : x)));
  const th = { padding: '8px 10px', fontSize: 12.5, color: 'var(--ink-500)', fontWeight: 600, borderBottom: '1px solid var(--line)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', borderBottom: '1px solid var(--line-soft)', fontSize: 14 };
  return (
    <BDAFShell title={'รายละเอียด — ' + part.t} sub={part.th + ' · ยอดต่อเดือน · ผลรวมใช้เป็นยอดของแถวนี้ทุกเดือนในตาราง (พิมพ์ทับรายเดือนได้)'} onClose={onClose} width={640}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ ...th, width: 56 }}>ลำดับ</th><th style={th}>รายการ</th><th style={{ ...th, textAlign: 'right' }}>จำนวนเงิน (บาท/เดือน)</th>{canEdit && <th style={{ ...th, width: 40 }} />}</tr></thead>
        <tbody>
          {draft.map((x, i) => (
            <tr key={x.id}>
              <td style={{ ...td, color: 'var(--ink-500)' }}>{i + 1}</td>
              <td style={td}>{canEdit ? <input className="input" value={x.n} placeholder="ชื่อรายการ" onChange={e => set(x.id, { n: e.target.value })} style={{ width: '100%', padding: '4px 8px' }} /> : x.n}</td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{canEdit ? <FundNum value={x.a} onChange={v => set(x.id, { a: v })} width={140} /> : fundB(x.a)}</td>
              {canEdit && <td style={{ ...td, textAlign: 'center' }}><button type="button" className="btn btn-sm" title="ลบรายการนี้" onClick={() => setDraft(d => d.filter(y => y.id !== x.id))}>✕</button></td>}
            </tr>
          ))}
          <tr>
            <td style={td} /><td style={{ ...td, fontWeight: 700 }}>รวมรายจ่ายทั้งหมดต่อเดือน</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fundB(total)}</td>{canEdit && <td style={td} />}
          </tr>
        </tbody>
      </table>
      {canEdit && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <button type="button" className="btn btn-sm" onClick={() => setDraft(d => d.concat([{ id: Date.now(), n: '', a: null }]))}>＋ เพิ่มรายการ</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm" onClick={onClose}>ปิด</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => onSave(draft.filter(x => x.n.trim() || Number(x.a)).map(x => ({ n: x.n.trim(), a: Number(x.a) || 0 })))}>บันทึก</button>
      </div>}
      {typedN > 0 && <div style={{ marginTop: 12, padding: '8px 12px', background: '#FFF8EB', borderRadius: 8, fontSize: 12.5, color: '#8A5300', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        มี {typedN} เดือนที่พิมพ์ยอดทับไว้ในตาราง (เดือนนั้นไม่ใช้ยอดรวมนี้)
        {canEdit && <button type="button" className="btn btn-sm" onClick={onClearTyped}>ล้างที่พิมพ์ทับ ใช้ยอดรวมนี้ทุกเดือน</button>}
      </div>}
    </BDAFShell>
  );
}
function fundFixedVal(fx, k, mk) {
  const m = fx.m && fx.m[k];
  return m && typeof m === 'object' ? fundN(m[mk]) : fundN(fx[k]);
}
function fundExtraVal(x, mk) {
  if (x.m && typeof x.m === 'object') return fundN(x.m[mk]);
  const a = fundN(x.amount);
  return a == null || (x.from && mk < x.from) || (x.to && mk > x.to) ? null : a;
}
/* ⇉ เติมเดือนที่ว่าง: ช่องว่างใช้ยอดของเดือนก่อนหน้าที่กรอกไว้ (ก่อนช่องแรกที่กรอกไม่เติม) */
function fundFillPatch(months, vals) {
  const p = {};
  let last = null;
  vals.forEach((v, i) => { if (v != null) last = v; else if (last != null) p[months[i]] = last; });
  return p;
}
const FUND_RCV_DEFAULT = { d1: 120, p1: 100, gap: 0 };   // BIO: รับเงินราชการงวดเดียว 120 วัน ·        // ผู้ใช้แจ้ง: เซ็นแล้ว ~120 วันได้งวด 1 (40%) · อีก 60 วันได้งวดสุดท้าย (60%)
const FUND_DEBT_GROUPS = ['60100', '60200', '60400', '60500'];   // เงินต้น+ดอกเบี้ยใน Cash Flow — มีในตารางหนี้แล้ว
const FUND_QUARTER_CATS = ['WCI'];   // BIO: ผู้ใช้ 2026-11-11 "WCI จ่ายทุกไตรมาส" (รวมจ่ายสิ้นเดือนไตรมาส)
const FUND_MONTH_CATS = ['ตปท.'];    // BIO: "ต่างประเทศ จ่ายทุกเดือน" (+ สัญญาสกุลต่างประเทศทุกหมวด) · หมวดอื่น = เลือกเดือนจ่ายเอง

const FUND_GROUPS = [
  { k: 'signed',   t: 'เซ็นแล้ว',       c: '#15803d', bg: '#f0fdf4' },
  { k: 'soon',     t: 'กำลังจะเซ็น',    c: '#1d4ed8', bg: '#eff6ff' },
  { k: 'approval', t: 'รออนุมัติ',      c: '#b45309', bg: '#fffbeb' },
  { k: 'unsure',   t: 'ยังไม่แน่นอน',   c: '#64748b', bg: '#f1f5f9' },
];
const FUND_GROUP_OF = FUND_GROUPS.reduce((m, g) => { m[g.k] = g; return m; }, {});
const FUND_DEBT_TREAT = {
  pay:    'คืนจริง (เงินออก)',
  roll:   'ต่อสัญญา (ไม่ออกเงินต้น)',
  netted: 'หักจากเงินรับลูกค้า',
  review: 'เลยกำหนด · รอตรวจ (ยังไม่นับ)',
};
const FUND_DEFAULT_CFG = {
  endMonth: '2027-06', targetDate: '2026-12-10', lastDate: '2026-12-25',
  delayDays: 14, fx: { USD: null, EUR: null }, expMode: 'auto', lookback: 6, projMode: 'jobs', debtDefault: 'roll',
  costPct: 80, lgPct: null, rcv: FUND_RCV_DEFAULT, fixed: { day: 25 }, extra: [],
  lgIssue: {}, lgFree: {}, lgAsOf: '',     // BIO: ยังไม่รู้ธนาคาร/วงเงิน LG · ตั้งในหน้าได้
  lenders: {
    lit: { name: 'LIT',              pre: 50, post: 90,   fee: null, rate: null, limit: null, leadDays: 14, ok: { pre: true, post: true } },
    alt: { name: 'สินเชื่ออีกแห่ง', pre: 60, post: null, fee: null, rate: 6,    limit: null,     leadDays: 14, ok: { rate: true } },
  },
};

/* ── ตัวช่วย ───────────────────────────────────────────────────────── */
function fundLoadPrefs() { try { return JSON.parse(localStorage.getItem(FUND_LS) || '{}') || {}; } catch (_) { return {}; } }
function fundSavePrefs(p) { try { localStorage.setItem(FUND_LS, JSON.stringify(p)); } catch (_) {} }
function fundPresenting() { return document.body.classList.contains('present-mode'); }
function fundJson(v) {
  if (v && typeof v === 'object') return v;
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch (_) { return null; }
}
function fundN(v) { return (v == null || v === '' || !isFinite(Number(v))) ? null : Number(v); }
function fundAddDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return bdISO(d); }
function fundDays(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function fundMonthEnd(mk) { return mk + '-' + String(bdafDim(mk)).padStart(2, '0'); }
function fundM(n) { return (n < 0 ? '−' : '') + fmtNum(Math.abs(n || 0) / 1e6, 2) + ' ล้าน'; }
function fundB(n) { return (n < 0 ? '−' : '') + fmtNum(Math.round(Math.abs(n || 0)), 0); }
function fundCode(v) { return String(v || '').trim().toUpperCase(); }
function fundDue(v) { const s = String(v == null ? '' : v).trim(); return /^\d{1,3}$/.test(s) ? '' : bdToISO(s); }   // สัญญาเก่าเก็บจำนวนเดือนไว้ในช่องวันครบ
function fundIsDebtLine(l) { return FUND_DEBT_GROUPS.indexOf(String(l.code || '')) >= 0; }
/* ดอกเบี้ยของเดือนนี้จ่ายวันไหน · pm = เดือนที่จ่าย [1–12] (true = สิ้นไตรมาส · ว่าง = ทุกสิ้นเดือน) */
function fundIntDay(mk, pm) {
  if (!pm) return fundMonthEnd(mk);
  const ms = pm === true ? [3, 6, 9, 12] : pm, y = +mk.slice(0, 4), m = +mk.slice(5, 7);
  const nx = ms.filter(x => x >= m);
  return nx.length ? fundMonthEnd(y + '-' + String(Math.min.apply(null, nx)).padStart(2, '0'))
    : fundMonthEnd((y + 1) + '-' + String(Math.min.apply(null, ms)).padStart(2, '0'));
}
/* เดือนแรกของรอบที่ยังไม่ได้จ่าย = เดือนถัดจากเดือนจ่ายล่าสุดก่อนเดือน first (ดอกที่สะสมตั้งแต่เดือนนั้นยังต้องจ่ายในช่วงแผน) */
function fundCycleStart(first, pm) {
  const ms = pm === true ? [3, 6, 9, 12] : pm, m = +first.slice(5, 7);
  const before = ms.filter(x => x < m);
  return bdafAddM(first.slice(0, 4) + '-01', before.length ? Math.max.apply(null, before) : Math.max.apply(null, ms) - 12);
}
/* เดือนที่จ่ายดอกเบี้ยของสัญญา (ผู้ใช้ 2026-11-11: รายเดือนจ่ายทุกสิ้นเดือน · รายไตรมาสจ่ายสิ้นเดือนไตรมาส)
 *   WCI/Zigo = สิ้นไตรมาส · INCOFIN = ตามรอบในไฟล์คุมดอกเบี้ยรายสัญญา (opt.incC · ส่งมาจากแท็บประมาณการเท่านั้น) · ที่เหลือทุกสิ้นเดือน */
function fundPayMonthsOf(m, opt) {
  const cat = m && m.debtCategory;
  if (FUND_QUARTER_CATS.indexOf(cat) >= 0) return [3, 6, 9, 12];
  if (cat === 'Incofin' && opt && opt.incC) { const pm = opt.incC[m.contractNo]; return Array.isArray(pm) && pm.length ? pm.map(Number) : [3, 6, 9, 12]; }
  return null;
}

function fundReadOv(rows) {
  const out = { cfgRaw: null, debt: {}, check: {}, pipe: [], incs: null };
  (rows || []).forEach(r => {
    if (!r || typeof r.key !== 'string' || r.key.indexOf('fund.') !== 0) return;
    const o = fundJson(r.value);
    if (!o) return;
    if (r.key === FUND_CFG_KEY) out.cfgRaw = o;
    else if (r.key === FUND_DEBT_KEY) out.debt = o;
    else if (r.key === FUND_CHECK_KEY) out.check = o;
    else if (r.key === FUND_INC_KEY) out.incs = o;
    else if (r.key.indexOf(FUND_PIPE) === 0) out.pipe.push(Object.assign({}, o, { id: r.key.slice(FUND_PIPE.length) }));
  });
  out.pipe.sort((a, b) => String(a.signDate || '9999').localeCompare(String(b.signDate || '9999')) || String(a.name || '').localeCompare(String(b.name || ''), 'th'));
  return out;
}
function fundCfgOf(raw) {
  const r = raw || {}, d = FUND_DEFAULT_CFG, lenders = {};
  Object.keys(d.lenders).forEach(k => {
    const a = d.lenders[k], b = (r.lenders && r.lenders[k]) || {};
    lenders[k] = Object.assign({}, a, b, { ok: Object.assign({}, a.ok, b.ok) });
  });
  return Object.assign({}, d, r, { lenders, fx: Object.assign({}, d.fx, r.fx), costs: Object.assign({}, r.costs), lgIssue: Object.assign({}, d.lgIssue, r.lgIssue), lgFree: Object.assign({}, d.lgFree, r.lgFree), rcv: Object.assign({}, d.rcv, r.rcv),
    fixed: Object.assign({}, d.fixed, r.fixed), extra: Array.isArray(r.extra) ? r.extra : [] });
}

/* ── แผนรับเงิน: กรองแผนที่ปิดแล้วแบบเดียวกับ Bank Daily ─────────────────── */
/* BIO: ไม่มี bdForecastSettled ใน Bank Daily ของ BIO → สำเนากติกาเดียวกับ WTP */
function fundFcSettled(f, sets) {
  const ref = String(f.refDoc || '').trim();
  if (!ref || !sets) return false;
  if (sets.paidAp && sets.paidAp.has(ref)) return true;
  if (f.amount < 0) return false;
  if (sets.closedIv && sets.closedIv.has(ref)) return true;
  const isAr = String((f.raw && f.raw.EXPENSE_TYPE) || '').toUpperCase() === 'AR';
  return !!(isAr && sets.knownIv && sets.knownIv.size && !sets.knownIv.has(ref));
}
/* BIO: ไม่มี bdafUseCf → ดึงชีต DATA ของ Cash Flow แบบเดียวกับการ์ดแผนเงินสดใน Bank Daily ของ BIO */
function fundUseCf() {
  const [cf, setCf] = React.useState(() => { try { const r = JSON.parse(localStorage.getItem(BDAF_CFP_LS) || 'null'); return r && r.stm ? r : null; } catch (_) { return null; } });
  const [cfState, setCfState] = React.useState('loading');
  React.useEffect(() => {
    if (!window.WTPData || typeof window.WTPData.fetchSheetRows !== 'function') { setCfState('error'); return; }
    window.WTPData.fetchSheetRows('cashflowPresent').then(rows => {
      const row = (rows || []).find(r => r && r.stm);
      if (row) { setCf(row); setCfState('ok'); } else setCfState('empty');
    }, () => setCfState('error'));
  }, []);
  return { cf, cfState };
}
function fundForecasts(data, arAll) {
  const forecasts = (data.forecastEntries || []).map(bdNormForecast);
  const closed = new Set(), known = new Set(), paidAp = new Set();
  arAll.forEach(a => {
    const no = String(a.ivNo || '').trim();
    if (!no) return;
    known.add(no);
    if (a.status === 'paid' || !(a.amount > 0.01)) closed.add(no);
  });
  (data.pvVouchers || []).map(bdNormPV).forEach(p => { if (p.apNo) paidAp.add(String(p.apNo).trim()); });
  return forecasts.map(f => Object.assign({}, f, { settled: fundFcSettled(f, { paidAp, closedIv: closed, knownIv: known }) }));
}

/* ── ตารางหนี้จริงในช่วงแผน ────────────────────────────────────────────── */
function fundDebtRows(data, F, today, cfg, choice, opt) {
  const first = F[0], lastDay = fundMonthEnd(F[F.length - 1]);
  const ledger = data.debtLedger || [], prepaid = data.interestSchedulePrepaid || [];
  const out = [], fxMissing = {}, byId = {}, byNo = {}, noOwner = {};
  ledger.forEach(r => {
    const map = r.contractId ? byId : byNo, k = r.contractId || r.contractNo;
    (map[k] = map[k] || []).push(r);
  });
  const isLitOf = (m) => m.leasitSource === true || m.leasitSource === 'true';
  const dueOf = (m) => fundDue(isLitOf(m) ? (m.leasitDateDueRoll || m.leasitDateDue || m.maturityDate) : (m.maturityDate || m.endDate));
  const active = (data.debtMaster || []).filter(m => m && String(m.status || '').trim() === 'Active');
  active.forEach(m => {
    const cur = noOwner[m.contractNo];
    if (!cur || (dueOf(m) || '9999') > (dueOf(cur) || '9999')) noOwner[m.contractNo] = m;   // เลขซ้ำ: ไม่มีวันครบ = ยังเดินอยู่ ถือเป็นตัวล่าสุด
  });
  // ดอกเบี้ยรายไตรมาส/รายรอบของเดือนก่อนหน้าในรอบเดียวกัน ยังจ่ายในช่วงแผน → ต้องไล่ตั้งแต่ต้นรอบ
  const cycMonths = (pm) => bdafRange(fundCycleStart(first, pm), F[F.length - 1]);
  active.forEach(m => {
    const cur = debtCur(m);
    const fx = cur === 'THB' ? 1 : (Number(cfg.fx[cur]) || 0);
    const bal = debtDisplayBalance(m);
    const isLit = isLitOf(m);
    const due = dueOf(m);
    const inHz = !!due && due <= lastDay;
    const overdue = !!due && due < today;
    // WCI ทุกคนต่อสัญญา (ผู้ใช้ 2026-11-03) — เลยกำหนดแล้วก็นับว่าต่อ เว้นแถวที่น่าจะปิด/โอนไปแล้ว: เลยมาเกิน 1 ปี · ชื่อบอกว่าปิดหรือย้าย · แถวเก่าของเลขซ้ำ
    const staleRow = fundDays(due || today, today) > 365 || /ปิด|ย้าย/.test(String(m.contractNo || '') + ' ' + String(m.borrowerName || '')) || noOwner[m.contractNo] !== m;
    const defTreat = debtGroupOf(m) === 'assign' ? 'netted'
      : overdue ? (m.debtCategory === 'WCI' && cfg.debtDefault !== 'pay' && !staleRow ? 'roll' : 'review')
      : cfg.debtDefault === 'pay' ? 'pay' : 'roll';
    const treat = (inHz && FUND_DEBT_TREAT[choice[m.id]]) ? choice[m.id] : defTreat;
    const intM = {};
    let est = false;
    const addInt = (mk, date, amt, isEst) => {
      if (!(amt > 0.005)) return;
      intM[mk] = intM[mk] || { amt: 0, evs: [] };
      intM[mk].amt += amt;
      intM[mk].evs.push({ date: date < today ? today : date, amt });
      if (isEst) est = true;
    };
    if (isLit && typeof LIT_sameLoan === 'function') {   // BIO: ไม่มีลีซอิท
      // ดอกลีซอิทจ่ายล่วงหน้าด้วยเช็ครายงวด · paymentDate = วันที่บนเช็ค → เช็คลงวันล่วงหน้ายังไม่ออกจากบัญชี
      prepaid.filter(r => LIT_sameLoan(r.loanId, m.leasitLoanId) && !r.lenderCancelled).forEach(r => {
        const d = bdToISO(r.paymentDate) || bdToISO(r.dateStart);
        if (d && d >= today && d <= lastDay) addInt(d.slice(0, 7), d, Number(r.intAmount) || 0, false);
      });
    } else if (treat !== 'netted') {
      const pm = fundPayMonthsOf(m, opt);
      const inPlan = (mk) => { if (!pm) return F.indexOf(mk) >= 0; const d = fundIntDay(mk, pm); return d >= today && d <= lastDay; };
      const rows = (byId[m.id] || []).concat(noOwner[m.contractNo] === m ? (byNo[m.contractNo] || []) : []);
      const seen = {};
      rows.forEach(r => {
        const mk = r.year + '-' + String(r.month).padStart(2, '0');
        if (!inPlan(mk)) return;
        seen[mk] = true;
        addInt(mk, fundIntDay(mk, pm), interestRemaining(r), false);   // จ่ายสิ้นเดือน (ไม่ใช้ periodEnd — ส่วนใหญ่เป็นวันที่ 1 เดือนถัดไป ทำให้ดอกเดือนนี้ไปตกเดือนหน้า)
      });
      // ไม่มีแถวดอกเบี้ยของเดือนนั้น (สัญญาที่ยังไม่ได้เปิดตารางล่วงหน้า) → ประมาณจากยอดคงเหลือ × อัตรา
      const rate = Number(m.interestRate) || 0, start = bdToISO(debtStartOf(m));
      if (rate > 0 && bal > 0) (pm ? cycMonths(pm) : F).forEach(mk => {
        if (seen[mk] || !inPlan(mk) || (due && treat !== 'roll' && mk > due.slice(0, 7))) return;
        const from0 = (!pm && mk === first) ? today : mk + '-01';
        const from = start > from0 ? start : from0;
        const stop = (due && treat !== 'roll' && due < fundMonthEnd(mk)) ? due : bdafAddM(mk, 1) + '-01';
        const days = fundDays(from, stop);
        if (days > 0) addInt(mk, fundIntDay(mk, pm), bal * rate * days / 365, true);
      });
    }
    const pri = (inHz && treat === 'pay' && bal > 0) ? bal : 0;
    const hasInt = Object.keys(intM).length > 0;
    if (!inHz && !hasInt) return;
    if (!fx && (pri > 0 || hasInt)) fxMissing[cur] = (fxMissing[cur] || 0) + 1;
    const evs = [];
    if (fx) {
      if (pri > 0) evs.push({ date: due < today ? today : due, amt: -pri * fx, kind: 'principal', certain: true });
      Object.keys(intM).forEach(mk => intM[mk].evs.forEach(e => evs.push({ date: e.date, amt: -e.amt * fx, kind: 'interest', certain: !est })));
    }
    out.push({
      m, id: m.id, no: m.contractNo || '', name: m.borrowerName || '', cat: m.debtCategory || '', cur, fx, bal, due, overdue,
      inHz, treat, defTreat, pri: pri * (fx || 0), int: Object.keys(intM).reduce((s, k) => s + intM[k].amt, 0) * (fx || 0), est, evs,
    });
  });
  // รอตรวจขึ้นก่อน → ครบกำหนดที่ต้องคืน → หักจากเงินรับ → ยังไม่ครบ (มีแต่ดอกเบี้ย)
  const rank = (d) => (d.treat === 'review' ? 0 : !d.inHz ? 3 : d.treat === 'netted' ? 2 : 1);
  out.sort((a, b) => rank(a) - rank(b) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  return { rows: out, fxMissing };
}

/* ── เงินรับจากลูกค้า ───────────────────────────────────────────────── */
function fundArOpen(arAll) {
  const o = {};
  arAll.forEach(a => {
    const k = fundCode(a.jobNo);
    if (k && a.status !== 'paid') o[k] = (o[k] || 0) + (Number(a.raw && a.raw.balance) || 0) * 106 / 107;
  });
  return o;
}
/* งวดรับเงินนับจากวันเซ็น: [{ day, share }] (cfg.rcv · ค่าเริ่ม วันที่ 120 ได้ 40% · อีก 60 วันได้ 60%) */
function fundRcvPlan(cfg) {
  const r = Object.assign({}, FUND_RCV_DEFAULT, cfg && cfg.rcv);
  const d1 = Math.max(0, Number(r.d1) || 0), p1 = Math.min(100, Math.max(0, Number(r.p1) || 0)), gap = Math.max(0, Number(r.gap) || 0);
  return [{ day: d1, share: p1 / 100 }, { day: d1 + gap, share: 1 - p1 / 100 }].filter(x => x.share > 0);
}

/* ── ต้นทุนหลังเซ็น · งานเดิม · หลักประกัน ─────────────────────────────── */
function fundMid(i) { const w = FUND_CURVE_DAYS[i]; return Math.round((w[0] + w[1]) / 2); }
function fundCostsOf(cfg) { return FUND_COSTS.map(c => Object.assign({}, c, { pct: fundN(cfg.costPct) != null ? Number(cfg.costPct) : c.pct })); }
/* จ่ายไปแล้วต่อโครงการจาก PV: โครงการตรง + ของจากคลังกลางที่หมายเหตุระบุรหัสโครงการ (แบ่งเท่ากันถ้าระบุหลายโครงการ) */
function fundPaidByCode(pv) {
  const o = {};
  (pv || []).forEach(r => {
    const a = Number(r.Net_Amount) || 0;
    if (!a) return;
    const pd = String(r.Project_Dpt || ''), m = pd.match(/\)\s*([A-Za-z]{2,6}\d{2,4})-/);
    if (m) { const k = m[1].toUpperCase(); o[k] = (o[k] || 0) + a; return; }
    if (!/Warehouse/i.test(pd)) return;
    const cs = Array.from(new Set((String(r.Remark || '') + ' ' + String(r.cc_remark || '')).toUpperCase().match(/\b[A-Z]{2,6}\d{2,4}\b/g) || []));
    cs.forEach(c => { o[c] = (o[c] || 0) + a / cs.length; });
  });
  return o;
}
/* งานเดิม: AP ที่ตั้งแล้วยังไม่จ่าย (ไม่รวม AP แผนก — อยู่ใน Fixed Cost) + ต้นทุนที่เหลือของโครงการที่กำลังทำ
 *   + เงินที่ยังไม่ได้รับของโครงการนั้น (ยังไม่ออกใบแจ้งหนี้ · หักภาระหนี้โอนสิทธิ · มีแถวใน Pipeline = ใช้แถวนั้นแทน) */
function fundJobs(data, projs, fcs, arOpen, finance, cfg, today, lastDay, pipe) {
  const codeOf = (t) => (typeof prCodeFromText === 'function' ? prCodeFromText(t) : '');
  const paidAp = new Set((data.pvVouchers || []).map(p => String(p.AP_No || '').trim()).filter(Boolean));
  const plan = {};
  fcs.forEach(f => { if (f.amount < 0 && !f.isActual && !f.settled && f.date && String(f.expType).toUpperCase() === 'AP' && f.refDoc) plan[String(f.refDoc).trim()] = f.date; });
  const evs = [], apBy = {}, ap = { n: 0, amt: 0, late: 0 }, wip = [], late30 = fundAddDays(today, -30);
  // AP แผนกอยู่ใน Fixed Cost แล้ว · ใบลดหนี้นับทุกใบแม้ลงแผนก (ของจริง: CNS2023 ลงแผนก EN ลดหนี้ใบงานเก่า
  //   ส่วน APS ที่ตั้งใหม่อยู่ใต้โครงการ) แล้วหักกับเจ้าหนี้รายเดียวกัน ไม่เกินยอดที่ค้างรายนั้น
  const list = [], pos = {}, neg = {};
  (data.payables || []).forEach(p => {
    const a = bdNormAP(p), no = String(a.vchno || '').trim();
    if (!(Math.abs(a.amount) > 0.5) || paidAp.has(no) || (a.amount > 0 && p.dpt_code)) return;
    list.push({ p, a, no });
    if (a.amount > 0) pos[a.vendor] = (pos[a.vendor] || 0) + a.amount; else neg[a.vendor] = (neg[a.vendor] || 0) - a.amount;
  });
  list.forEach(({ p, a, no }) => {
    const amt = a.amount < 0 && neg[a.vendor] > (pos[a.vendor] || 0) ? a.amount * (pos[a.vendor] || 0) / neg[a.vendor] : a.amount;
    if (!(Math.abs(amt) > 0.5)) return;
    const c = codeOf(p.pre_des), d0 = plan[no] || a.due || today, date = d0 < today ? today : d0;
    if (c) apBy[c] = (apBy[c] || 0) + amt;
    ap.n++; ap.amt += amt;
    if (!plan[no] && a.due && a.due < late30) ap.late += amt;
    if (date <= lastDay) evs.push({ date, amt: -amt, kind: 'proj', sub: 'ap', certain: true, t: a.vendor || '—', ref: no,
      note: [(c ? 'โครงการ ' + c + ' · ' : '') + (amt < 0 ? 'ใบลดหนี้' : 'ยอดค้าง ' + fundB(amt)), plan[no] ? 'ตามแผนจ่ายใน Bank Daily ' + fmtDate(plan[no]) : a.due ? 'ครบกำหนด ' + fmtDate(a.due) + (a.due < today ? ' (เลยกำหนดแล้ว นับวันนี้)' : '') : 'ไม่มีวันครบกำหนด นับวันนี้'] });
  });
  const paid = fundPaidByCode(data.pvVouchers);
  const costs = fundCostsOf(cfg), cp = costs.reduce((s, c) => s + c.pct, 0);
  const mix = FUND_CURVE_DAYS.map((_, i) => costs.reduce((s, c) => s + c.pct * c.curve[i], 0) / (cp || 1));
  const inPipe = new Set(pipe.filter(r => !r.off).map(r => fundCode(r.code)).filter(Boolean));
  projs.filter(p => p.status === 'Work in progress').forEach(p => {
    const c = fundCode(p.contractNo), v = Number(p.contractAmt) || 0, s = bdToISO(p.start), fin = bdToISO(p.finish);
    if (!c || !(v > 0)) return;
    const spent = (paid[c] || 0) + (apBy[c] || 0);
    const left = (fin && fin < today) ? 0 : Math.max(0, v * cp / 100 - spent);      // เลยกำหนดเสร็จแล้ว = เหลือแค่ AP ที่ตั้งไว้
    const x = { code: c, name: p.site || p.name, v, spent, left, leftPlan: 0, rcv: 0, rcvPlan: 0, got: Number(p.received) || 0, ar: (arOpen && arOpen[c]) || 0, out: Number(p.outstandingAR) || 0, start: s };
    if (left > 0.5) {
      const fut = s ? mix.map((w, i) => ({ w, date: fundAddDays(s, fundMid(i)) })).filter(o => o.w > 0 && o.date >= today) : [];
      const W = fut.reduce((t, o) => t + o.w, 0);
      (W ? fut : [{ w: 1, date: fundAddDays(today, 30) }]).forEach(o => {
        const a = left * o.w / (W || 1);
        if (o.date <= lastDay) { evs.push({ date: o.date, amt: -a, kind: 'proj', sub: 'wip', t: x.name, ref: c, note: ['สัญญา ' + fundB(v) + ' × ' + fmtNum(cp, 0) + '% − จ่ายแล้ว/AP ' + fundB(spent) + ' = เหลือ ' + fundB(left), 'แบ่งจ่ายตามจังหวะจ่ายจริงของโครงการที่ผ่านมา'] }); x.leftPlan += a; }
      });
    }
    if (!inPipe.has(c)) {
      const debt = Number((finance[c] || finance[p.contractNo] || {}).debt) || 0;
      x.rcv = Math.max(0, (Number(p.outstandingAR) || 0) * 106 / 107 - ((arOpen && arOpen[c]) || 0) - debt);
      x.debt = debt;
      if (x.rcv > 0.5 && s) {
        // รับไปแล้วกี่ % ของสัญญา → เหลือเฉพาะงวดที่ยังไม่ได้รับ (เช่น ได้งวด 1 แล้ว = เหลืองวดสุดท้ายอย่างเดียว)
        const got = Math.min(1, (Number(p.received) || 0) / v);
        let acc = 0;
        // j = งวดรับเงินที่เท่าไร (1 = งวดแรก · rp.length = งวดสุดท้าย) — ใช้ผูกค่าติดตั้งผู้รับเหมาที่ต้องจ่ายหลังรับเงินงวดนั้น (fundInstOld)
        const rp = fundRcvPlan(cfg);
        x.rcvGot = got; x.rcvN = rp.length;
        const rest = rp.map((o, j) => { const lo = acc; acc += o.share; return { day: o.day, j: j + 1, w: Math.max(0, acc - Math.max(lo, got)) }; }).filter(o => o.w > 1e-6);
        const W = rest.reduce((t, o) => t + o.w, 0);
        (W ? rest : [{ day: rp.slice(-1)[0].day, j: rp.length, w: 1 }]).forEach(o => {
          const d0 = fundAddDays(s, o.day), date = d0 < today ? fundAddDays(today, 30) : d0, a = x.rcv * o.w / (W || 1);
          if (date <= lastDay) { evs.push({ date, amt: a, kind: 'wipIn', arInst: o.j, arN: rp.length, t: x.name, ref: c, note: ['ค้างรับตามหน้าโครงการ ' + fundB(p.outstandingAR) + ' หัก ณ ที่จ่าย 1% แล้ว ลบใบแจ้งหนี้ที่ออกแล้ว' + (debt ? ' และภาระหนี้โอนสิทธิ์ ' + fundB(debt) : '') + ' = ' + fundB(x.rcv), 'ยังไม่ได้ออกใบแจ้งหนี้ · วันรับประมาณจากวันเริ่มสัญญา ' + fmtDate(s) + ' + ' + o.day + ' วัน' + (d0 < today ? ' (เลยมาแล้ว เลื่อนไปอีก 30 วัน)' : '')] }); x.rcvPlan += a; }
        });
      }
    }
    wip.push(x);
  });
  return { evs, ap, wip };
}
/* BIO: ไม่มีหน้า BACK TO BACK (page_payment_recon.jsx ของ WTP) → ยกเฉพาะส่วนที่ fundInstOld ใช้มาไว้ที่นี่ (ชื่อ fundB2b* กันชนชื่อ global)
 *   ใบ APS: จ่ายแล้ว = pvVouchers (รหัสโครงการจาก Project_Dpt) · ค้างจ่าย = payables (รหัสจาก pre_des) · งวดจาก remark (ADV / งวด N)
 *   งวดรับเงินของโครงการ = PCU.deriveProjects (ใบแจ้งหนี้ผูกงวด) · ประเภทผลิตภัณฑ์จาก suffix ท้ายรหัส (PD/PDP/PDH = ผู้รับเหมา 1 งวด) */
function fundB2bNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? 0 : n;
}
function fundB2bNorm(c) {
  const s = String(c == null ? '' : c).trim();
  const m = s.match(/^(.+?)-[A-Z]{2,6}$/);
  return (m ? m[1] : s).toUpperCase();
}
function fundB2bCode(text) {
  const s = String(text == null ? '' : text);
  let m = s.match(/Project\s*:\s*\(\d+\)\s*([A-Za-z]{2,5}\d{2,4})/);
  if (m) return m[1].toUpperCase();
  m = s.match(/\(\s*(?:Project\s*:\s*)?([A-Za-z]{2,5}\d{2,4})\b/);
  if (m) return m[1].toUpperCase();
  m = s.match(/^\s*([A-Za-z]{2,5}\d{2,4})\s*-/);
  if (m) return m[1].toUpperCase();
  m = s.match(/\b([A-Za-z]{2,5}\d{2,4})\b/);
  if (m) return m[1].toUpperCase();
  return '';
}
function fundB2bInst(remark) {
  const t = String(remark == null ? '' : remark);
  const m = t.match(/งวด\s*(?:ที่\s*)?(\d+)/);
  if (m) return 'งวด ' + m[1];
  if (/คืน.*ประกัน|ขอคืนเงิน|retention/i.test(t)) return 'คืนประกัน';
  if (/ตัดมัดจำ|เคลีย/i.test(t)) return 'อื่นๆ';
  if (/advance|adv\b|มัดจำ|เงินล่วงหน้า|จ่ายล่วงหน้า|เริ่มงาน/i.test(t)) return 'ADV';
  return 'อื่นๆ';
}
function fundB2bProd(text) {
  const m = String(text == null ? '' : text).match(/[A-Za-z]{2,5}\d{2,4}-([A-Za-z]{2,6})\b/);
  return m ? m[1].toUpperCase() : '';
}
function fundB2bBuild(data) {
  const PCU = window.PCU, invoices = data.invoices || [], payables = data.payables || [], pvs = data.pvVouchers || [];
  let base = data.projects || [];
  try { const local = PCU && PCU.loadLocalProjects ? (PCU.loadLocalProjects() || []) : []; if (PCU && PCU.mergeProjectSources) base = PCU.mergeProjectSources(base, local); } catch (_) {}
  const derived = PCU && PCU.deriveProjects ? PCU.deriveProjects(base, invoices, data.receipts || []) : [];
  const prod = {}, setP = (c, p) => { if (c && p && !prod[c]) prod[c] = p; };
  invoices.forEach(iv => setP(fundB2bNorm(iv.jobNo || iv.contractRef || iv.projectCode || ''), fundB2bProd(iv.jobNo || iv.projectCode || '')));
  pvs.forEach(v => setP(fundB2bCode(v.Project_Dpt), fundB2bProd(v.Project_Dpt)));
  payables.forEach(p => setP(fundB2bCode(p.pre_des), fundB2bProd(p.pre_des)));
  const paid = {}, paidNo = new Set(), owe = {};
  pvs.forEach(v => {
    if (!(String(v.Type || '').trim().toUpperCase() === 'APS' || String(v.AP_No || '').trim().toUpperCase().startsWith('APS'))) return;
    const code = fundB2bCode(v.Project_Dpt) || fundB2bCode(v.jobname);
    if (!code) return;
    const ap = String(v.AP_No || '').trim();
    if (ap) paidNo.add(ap);
    (paid[code] = paid[code] || []).push({ amount: fundB2bNum(v.Net_Amount), inst: fundB2bInst(v.cc_remark || v.Remark) });
  });
  payables.forEach(p => {
    const no = String(p.vchno || p.docno || '').trim();
    if (!no.toUpperCase().startsWith('APS') || paidNo.has(no)) return;
    const code = fundB2bCode(p.pre_des) || fundB2bCode(p.jobname);
    if (!code) return;
    (owe[code] = owe[code] || []).push({ vchno: no, vendor: p.cust_name || p.jobname || '', amount: fundB2bNum(p.netpayment != null ? p.netpayment : (p.Amount != null ? p.Amount : p.net_new)), inst: fundB2bInst(p.remark) });
  });
  const projects = derived.filter(d => d.status === 'Work in progress' || d.status === 'Finish').map(d => {
    const ncode = fundB2bNorm(d.contractNo);
    const arRaw = (d.installments || []).filter(it => it.invoice || it.amount > 0), single = arRaw.length === 1;
    let arItems = arRaw.map(it => { const inv = it.invoice || {}; return { no: it.no, label: single ? 'ครั้งเดียว' : 'งวด ' + it.no, invoiceNo: inv.ivNo || '—', amount: it.amount || fundB2bNum(inv.balance) }; });
    const cAmt = d.contractAmt || 0, full = cAmt > 0 ? arItems.findIndex(a => a.invoiceNo !== '—' && a.amount >= cAmt * 0.99) : -1;
    if (full >= 0 && arItems.length > 1) arItems = [Object.assign({}, arItems[full], { label: 'ครั้งเดียว' })];
    const g = {}, G = (k) => (g[k] = g[k] || { key: k, paidAmt: 0, outAmt: 0, outRows: [] });
    (paid[ncode] || []).forEach(r => { G(r.inst).paidAmt += r.amount; });
    (owe[ncode] || []).forEach(r => { const x = G(r.inst); x.outAmt += r.amount; x.outRows.push(r); });
    const pt = String(prod[ncode] || '').toUpperCase();
    return { code: d.contractNo, ncode, productType: pt, expectedNguad: ({ PD: 1, PDP: 1, PDH: 1 })[pt] ? 1 : 2, arItems, apGroups: Object.values(g), contractor: '' };
  });
  return { projects };
}
/* ค่าติดตั้งผู้รับเหมาของโครงการที่เซ็นแล้ว (ผู้ใช้ 2026-11-12: "ยังไม่ได้รับเงิน = ยังไม่ได้จ่ายค่าติดตั้ง แต่รับเงินแล้ว 7–14 วันต้องจ่าย
 *   อยากเห็นยอดเพื่อเอาไปเพิ่มเป็นค่าติดตั้งงวด 1 / งวด 2 ใน ข.2") — ข้อมูลชุดเดียวกับหน้า BACK TO BACK (prBuildAll):
 *   ใบ APS แยก ADV / งวด N · จ่ายแล้ว = PV · ตั้งหนี้แล้วยังไม่จ่าย = AP (ยอดจริง)
 *   งวดที่ยังไม่มีเอกสาร = ประมาณจากยอด ADV ตามสัดส่วนผู้รับเหมา (FUND_FC_INST_SPLIT: ถัง ADV 40 · งวด 1 40 · งวด 2 20 /
 *   POG Drink ADV 35 · งวดสุดท้าย 65) · ไม่มี ADV ในระบบ (PV เริ่ม ม.ค. 68) = ไม่รู้ยอด
 *   คืน { [รหัสโครงการ]: { drink, adv, inst: [{ n, row: 'inst1'|'inst2', st: 'ap'|'est'|'unk'|'paid', amt, paid }], arIv: { เลข INV: งวดรับที่ }, arN } }
 *   ไม่นับในตาราง — ผู้ใช้เลือกเอาไปพิมพ์ในแถว ข.2 เอง */
function fundInstOld(data) {
  let all;
  try { all = fundB2bBuild(data); } catch (_) { return {}; }   // BIO: ไม่มีหน้า BACK TO BACK → อ่านใบ APS เอง (fundB2bBuild)
  const out = {};
  (all.projects || []).forEach(p => {
    const g = {};
    (p.apGroups || []).forEach(x => { g[x.key] = x; });
    const drink = p.expectedNguad === 1, split = FUND_FC_INST_SPLIT[drink ? 'drink' : 'tank'];
    const advP = split[0].p, adv = g.ADV ? g.ADV.paidAmt + g.ADV.outAmt : 0;
    const inst = [];
    for (let n = 1; n <= p.expectedNguad; n++) {
      const x = g['งวด ' + n], sp = drink ? split[1] : split[Math.min(n, split.length - 1)];
      const row = drink || n >= p.expectedNguad ? 'inst2' : 'inst1';
      const paid = x ? x.paidAmt : 0, owe = x ? x.outAmt : 0;
      if (owe > 0.5) inst.push({ n, row, st: 'ap', amt: owe, paid, vendor: (x.outRows[0] || {}).vendor || '', docs: x.outRows.map(r => r.vchno).filter(Boolean) });
      else if (paid > 0.5) inst.push({ n, row, st: 'paid', amt: 0, paid });
      else if (adv > 0.5) inst.push({ n, row, st: 'est', amt: adv * sp.p / advP, paid: 0, how: 'ADV ' + fundB(adv) + ' × ' + sp.p + '/' + advP });
      else inst.push({ n, row, st: 'unk', amt: 0, paid: 0 });
    }
    const arIv = {};
    (p.arItems || []).forEach(a => { if (a.invoiceNo && a.invoiceNo !== '—') arIv[String(a.invoiceNo).trim()] = a.label === 'ครั้งเดียว' ? 0 : a.no; });
    out[p.ncode] = { code: p.code, drink, adv, inst, arIv, arN: (p.arItems || []).length, vendor: p.contractor };
  });
  return out;
}
/* ค่าติดตั้งที่ต้องจ่ายหลังรับเงินงวด arNo (จาก arN งวด) ของโครงการ · arNo 0 = รับทั้งก้อน → ทุกงวดที่ยังไม่จ่าย
 *   ถัง: รับงวด N → จ่ายผู้รับเหมางวด N (รับงวดสุดท้าย → งวดที่ N ขึ้นไป) · POG Drink: รับงวดสุดท้าย → จ่ายงวดเดียวของผู้รับเหมา */
function fundInstDue(io, arNo, arN) {
  if (!io) return [];
  const open = io.inst.filter(i => i.st !== 'paid');
  if (!arNo) return open;
  if (io.drink) return arNo >= arN ? open : [];
  return open.filter(i => (arNo >= arN ? i.n >= arNo : i.n === arNo));
}
/* หลักประกันที่ยังไม่ได้คืน: LG แยกธนาคาร + เงินสด · ครบในช่วงแผน · เลยกำหนดแล้วยังไม่ได้คืน */
function fundLgBook(rows, today, lastDay) {
  const norm = (b) => (typeof gtNormBank === 'function' ? gtNormBank(b) : String(b || '').trim().toUpperCase()) || 'ไม่ระบุ';
  const out = { banks: {}, cash: 0, lgSoon: 0, cashSoon: 0, lgLate: 0, cashLate: 0 };
  (rows || []).forEach(r => {
    if (r.receivedDate || /คืนแล้ว|ยกเลิก/.test(String(r.status || ''))) return;
    const a = Number(r.amount) || 0;
    if (!(a > 0)) return;
    const cash = /เงินสด|cash/i.test(String(r.guaranteeType || '')), end = bdToISO(r.endDate);
    if (cash) out.cash += a; else { const b = norm(r.bank); out.banks[b] = (out.banks[b] || 0) + a; }
    if (end && end < today) { if (cash) out.cashLate += a; else out.lgLate += a; }
    else if (end && end <= lastDay) { if (cash) out.cashSoon += a; else out.lgSoon += a; }
  });
  return out;
}
/* วงเงิน LG ที่ยังว่าง: เฉพาะธนาคารที่ออกใบใหม่ (lgIssue) ตามยอด "ว่างตอนนี้" ที่ใส่ไว้ (lgFree)
 *   ไม่มีธนาคารที่ออกใบใหม่ = 0 (วางเงินสดทั้งหมด) · มีแต่ยังไม่ใส่ยอด = ยังไม่รู้ (null) */
function fundLgIssuers(cfg) { return Object.keys(cfg.lgIssue || {}).filter(b => cfg.lgIssue[b]); }
function fundLgRoom(book, cfg) {
  const banks = fundLgIssuers(cfg);
  if (!banks.length) return 0;
  const ks = banks.filter(b => fundN(cfg.lgFree[b]) != null);
  if (!ks.length) return null;
  return ks.reduce((s, b) => s + Math.max(0, Number(cfg.lgFree[b])), 0);
}
/* ดอกเบี้ยเงินกู้ใหม่: คิดบนยอดคงค้างรายวัน ลงสิ้นเดือน · flows = +เบิก / −คืน */
function fundLoanCost(flows, rate, lastDay) {
  const pts = flows.filter(f => f.date <= lastDay).sort((a, b) => a.date.localeCompare(b.date));
  if (!(rate > 0) || !pts.length) return [];
  const out = [], end = fundAddDays(lastDay, 1);
  let bal = 0, acc = 0, i = 0, at = pts[0].date;
  while (at < end) {
    while (i < pts.length && pts[i].date <= at) { bal += pts[i].amt; i++; }
    if (bal <= 0.005 && i >= pts.length) break;
    const mk = at.slice(0, 7), me = bdafAddM(mk, 1) + '-01';
    let nx = me < end ? me : end;
    if (i < pts.length && pts[i].date < nx) nx = pts[i].date;
    acc += Math.max(0, bal) * rate * fundDays(at, nx) / 365;
    if ((nx === me || nx === end) && acc > 0.005) { out.push({ date: nx === me ? fundMonthEnd(mk) : lastDay, amt: -acc, kind: 'fundCost' }); acc = 0; }
    at = nx;
  }
  if (acc > 0.005) out.push({ date: at > lastDay ? lastDay : at, amt: -acc, kind: 'fundCost' });
  return out;
}

/* ══ แท็บหลัก "ประมาณการรับ-จ่าย" (ผู้ใช้ 2026-11-11) ═══════════════════════════════
 *   ผู้ใช้: "หน้าแผนไม่ค่อยตอบโจทย์ · อยากกรอกยอดเลยว่าจะใช้อะไรเท่าไหร่" + โจทย์จากหัวหน้า "เบิกเงินกู้แล้ว บรรทัดรวมรายรับมีกี่บาท
 *   · หักค่าใช้จ่ายประจำแล้วเหลือพอจ่ายผู้รับเหมากี่บาท" → งบเดียวรายเดือน เรียงตามที่ผู้ใช้วางมา:
 *     ก. รับเงิน: 1 โครงการที่เซ็นแล้วรอรับ (INV + งวดที่ยังไม่ออก INV) · 2 โครงการที่จะลงนาม (ฝ่ายขาย) · 3 เงินกู้ LIT · 4 รับอื่นๆ
 *     ข. ค่าใช้จ่าย: 1 ประจำ (กรอกเอง) · 2 โครงการ (คอม 6% · ติดตั้ง ADV. · หลักประกัน 5%) · 3 ดอกเบี้ย (รายเดือน · ไตรมาส · INCOFIN ·
 *        เช็คล่วงหน้ารอขึ้น · เงินกู้ LIT ใหม่) · 4 คืนเงินกู้/อื่นๆ (คืน LIT + "รายการที่อาจตกหล่น" ที่เปิดไว้ + แถวกรอกเอง)
 *     → เงินปลายเดือน (= ต้นเดือน + ก − ข) · ★ ผู้ใช้ 2026-11-11 ย้ายค่าใช้จ่ายผู้รับเหมา (ค่าของโรงงาน ค่าติดตั้งงวดที่เหลือ ผู้รับเหมาอื่น)
 *       จากข้อ ค. มาอยู่ ข.2 ค่าใช้จ่ายเกี่ยวกับโครงการ — ไม่มีข้อ ค. แล้ว
 *   ทุกแถวกดชื่อดูที่มา · ช่องของแถวที่ระบบคิดพิมพ์ทับได้ (cfg.fc.ovr[แถว][เดือน]) ลบให้ว่าง = กลับไปใช้ยอดระบบ
 *   โครงการที่จะลงนามมาจากหน้าโครงการ (ปุ่มเลือกจากระบบ · Type / % งวด 1–2 ของหน้าโครงการติดมาด้วย) หรือกรอกเอง → fund.p.<id> ชุดเดิม
 *   เงินกู้ LIT (ผู้ใช้): เบิก 50% ของมูลค่าสัญญา · เงินเข้าหลังเซ็น ~14 วัน · ค่าวิเคราะห์สินเชื่อล้านละ 25,000 · ค่าอื่นโครงการละ 8,500
 *     · ดอกเบี้ย 15%/ปี ตั้งแต่วันรับเงินกู้ถึงวันที่โครงการรับเงิน · ติ๊กเลือกรายโครงการ (row.useLit) · วงเงินจัดสรรตามลำดับวันเซ็น
 *     ★ ผู้ใช้ยืนยัน 2026-11-11: ค่าวิเคราะห์คิดจากยอดกู้ · ดอกเบี้ย 15% คิดตามจำนวนวัน · ตอนรับเงินราชการ LIT หักดอกเบี้ย + เงินต้นก่อน
 *       งวดแรกหักทั้งก้อนที่ได้รับ งวด 2 หักส่วนที่เหลือจนครบ ที่เหลือเราได้รับ (intPay 'end') · วงเงินไม่หมุนกลับในช่วงแผน (ยังไม่ได้ถาม)
 *   ค่าคอม 6% จ่ายวันเซ็น · ค่าติดตั้ง = ใบเสนอราคาผู้รับเหมา (FUND_FC_INSTALL): ADV. วันเซ็น (ข.2) · งวด 1 / งวดสุดท้าย หลังรับเงินราชการงวดนั้น 7 วัน (ค.)
 *   ค่าของโรงงาน = ไฟล์ FACTORY ช่องยอดเบิก (FUND_FC_FACTORY) 3 งวด ลง ค. (ผู้ใช้เลือกเดือนจ่ายเอง) · โครงการที่จะลงนามนำเข้าจากไฟล์ฝ่ายขาย govsales ชีต POG (FundSalesImportModal)
 *   ดอกเบี้ยเงินกู้เดิมใช้ fundDebtRows · LIT ที่มีอยู่ = เช็คล่วงหน้า
 *     = หน้าเช็คจ่ายล่วงหน้าอย่างเดียว ตามวันที่บนเช็ค ทุกเช็คที่ยังไม่ขึ้นเงิน ยกเว้นเช็คค้ำ (2026-11-11 · ดู fundFcCheques)
 *   Finance costs ในข้อ ข1 = ไม่รวมดอกเบี้ย · Selling expenses = ไม่รวมค่าคอมโครงการใหม่ (คิดในข้อ ข2/ข3 แล้ว ไม่งั้นนับซ้ำ) */
/* ผู้ใช้ 2026-11-11: POG Drink รับงวดเดียวที่ 120 วัน (fundFcDrinkAuto / fc.drinkD) · ถังใช้ 2 งวดตามเดิม */
const FUND_FC_PAYTYPES = [
  { id: 'one', name: 'งวดเดียว', inst: [{ d: 120, p: 100 }] },   // BIO: ผู้ใช้ 2026-11-11 "การรับเงินจากราชการจะเป็นการรับงวดเดียวเท่านั้น 120 วัน"
];
const FUND_FC_LIT = { pct: 50, lead: 14, feePerM: 25000, feeBase: 'loan', feeFix: 8500, rate: 15, intPay: 'end' };   // ผู้ใช้ยืนยัน 2026-11-11
/* ค่าติดตั้งทั้งชุด — ไฟล์ "ผู้รับเหมาเสนอราคา (1 JAN 2026).xlsx" ชีต "สรุปงวดชำระเงิน" (เริ่มใช้ 1 ม.ค. 2569 · ผู้ใช้ส่งมา 2026-11-11)
 *   ถัง (POG L/M ±Solar · S TANK II ±Solar · POG Tank II ±Solar) = ADV. 40% (หลังได้หนังสือสั่งจ้าง) · งวด 1 40% · งวด 2 20%
 *   POG Drink (PD/PDH/PDP) = ADV. 35% · งวดสุดท้าย 65%
 *   ผู้ใช้: งวด 1 จ่ายหลังรับเงินราชการงวด 1 · งวด 2 หลังรับเงินงวด 2 · ช้ากว่าวันรับเงิน 14 วัน (cfg.fc.instPay · ผู้ใช้กำหนด 14 วัน 2026-11-11)
 *   POG TANK เล็ก (PS) / POG SOLVE (PSM, PSL) ไม่มีในไฟล์ = ยังไม่รู้ ใส่เองได้ */
const FUND_FC_INSTALL = {};   // BIO: รอข้อมูลผลิตภัณฑ์
const FUND_FC_INST_SPLIT = {
  tank:  [{ k: 'adv', p: 40, t: 'ADV.' }, { k: 'i1', p: 40, t: 'งวด 1' }, { k: 'i2', p: 20, t: 'งวด 2' }],
  drink: [{ k: 'adv', p: 35, t: 'ADV.' }, { k: 'i2', p: 65, t: 'งวดสุดท้าย' }],
};
/* ค่าของจากโรงงาน (ยอดเบิก ต่อชุด · งวด 1 มัดจำ / งวด 2 ผลิตเสร็จที่โรงงาน / งวด 3 ประกอบเสร็จที่โครงการ)
 *   ไฟล์ "20260908-FACTORY-ปรับMC+5-ปรับMCPII.xlsx" ตาราง "**เงื่อนไขการชำระเงิน (New)" ช่อง "ยอดเบิก" (รวม MC แล้ว)
 *   ★ ผู้ใช้ 2026-11-11: ตอนแรกใช้ช่อง "ยอดจริง" (ยอดเบิก − MC) → เปลี่ยนเป็นช่อง "ยอดเบิก"
 *   ต่อชุด = ถัง + ห้อง PnP (POG TANK / POG SOLVE / POG TANK II) หรือ P&C Room (S TANK II) + โครงเหล็กโซลาร์ 43,335 (รุ่น +Solar ของ S TANK II / POG TANK II
 *   — แถวนี้ไฟล์เขียน "งวด 1" แต่เงื่อนไขคือ "ประกอบแล้วเสร็จ ณ โครงการ" จึงลงงวด 3) · รวมแล้วตรงช่อง "SUM (New)" ทุกรุ่น (POG L 2,322,970 · POG M 1,791,180 ฯลฯ)
 *   POG TANK +Solar (PLS/PMS) ไม่มีแยกในไฟล์ → ใช้เท่า L/M
 *   วันจ่าย: ผู้ใช้เลือกเดือนจ่ายเอง (แถวเริ่ม 0) · วันอ้างอิงในรายการตาม timeline หน้า Investor (มัดจำก่อนเซ็น 14 วัน · ผลิตเสร็จวันที่ 68 · ประกอบเสร็จวันที่ 75) */
const FUND_FC_FACTORY = {};   // BIO: รอข้อมูลผลิตภัณฑ์
const FUND_FC_FAC_PH = [{ k: 'd1', t: 'งวด 1 มัดจำค่าสินค้า' }, { k: 'd2', t: 'งวด 2 ผลิตเสร็จที่โรงงาน' }, { k: 'd3', t: 'งวด 3 ประกอบเสร็จที่โครงการ' }];
const FUND_FC_FAC_DAYS = { d1: -14, d2: 68, d3: 75 };
/* ค่าของโรงงานของโครงการ: ผลิตภัณฑ์ × จำนวนชุด × ยอดเบิกต่อชุดแต่ละงวด */
function fundFcFactory(r, fc) {
  const out = { p: [0, 0, 0], total: 0, unk: [], det: [] };
  const items = r.valueMode === 'items' ? (r.items || []).filter(x => Number(x.qty) > 0) : [];
  if (!items.length) { out.unk.push('ไม่ได้ระบุผลิตภัณฑ์'); return out; }
  items.forEach(x => {
    const q = Number(x.qty), ph = fundProdOf(x.code) ? fc.fac[x.code] : null;
    if (!Array.isArray(ph)) { out.unk.push(fundItemName(x)); return; }
    const t = ph.reduce((a, v) => a + (Number(v) || 0), 0);
    ph.forEach((v, i) => { out.p[i] += q * (Number(v) || 0); });
    out.total += q * t;
    out.det.push(fundItemName(x) + ' ' + fmtNum(q, q % 1 ? 2 : 0) + ' ชุด × ' + fundB(t) + ' (งวด ' + ph.map(v => fundB(Number(v) || 0)).join(' / ') + ')');
  });
  return out;
}
function fundFcInstFam(code) { const pr = fundProdOf(code); return pr && pr.group === 'POG Drink' ? 'drink' : 'tank'; }
function fundFcSplitText(fam) { return FUND_FC_INST_SPLIT[fam].map(x => x.t + ' ' + x.p + '%').join(' · '); }
/* รอบจ่ายดอกเบี้ย INCOFIN ตามไฟล์ "07.WTP-ตารางคุมดอกเบี้ยรายบุคคล-Incofin.xlsx" (ผู้ใช้ 2026-11-11 "ตามรอบข้อมูลในไฟล์คำนวณดอกเบี้ย")
 *   Incofin-2 (1 ล้าน 15%) ชีต "1. (4)" = จ่ายทุกไตรมาส (ธ.ค. / มี.ค. / มิ.ย. / ก.ย.)
 *   Incofin-1 (3 ล้าน) ชีต "1. (3)" = "จ่ายดอกเบี้ยทุก 6 เดือน" วันจ่าย 9 มี.ค. 70 · 5 ก.ย. 70 · 3 มี.ค. 71 → มี.ค. / ก.ย.
 *   ★ ใช้เฉพาะตอนยังไม่ได้นำเข้าไฟล์ — นำเข้าแล้ว (fund.incsched) ใช้ยอดและวันจ่ายตามไฟล์ (FundIncImportModal)
 *   สัญญาใหม่ที่ไม่มีในรายการ = ทุกไตรมาส (หัวชีตไฟล์ "*จ่ายดอกเบี้ยทุกไตรมาส") · แก้รายสัญญาได้ที่ "เงื่อนไขที่ใช้คิด" */
const FUND_FC_INC_CYCLE = {};   // BIO: ไม่มีรอบ INCOFIN
const FUND_FC_STAMP = 0.1;   // % อากรแสตมป์สัญญาจ้างทำของ 1 บาทต่อ 1,000 บาท
/* รายการที่อาจตกหล่น (ผู้ใช้: "ช่วยคิดเพิ่มเติมว่ามีค่าอะไรอีกที่ต้องจ่ายแต่อาจตกหล่น") · auto = ระบบคิดจากข้อมูลที่มี เปิด/ปิดได้ · ที่เหลือ = เพิ่มแถวกรอกเอง */
const FUND_FC_MORE = [
  { k: 'principal', auto: true, sec: 'out', t: 'เงินต้นเงินกู้เดิมที่ครบกำหนด', why: 'สัญญาที่ครบในช่วงนี้ — ค่าเริ่มนับว่าต่อสัญญา กดแถวเลือกคืนรายสัญญา' },
  { k: 'ap', auto: true, sec: 'out', t: 'AP ที่ตั้งหนี้แล้วยังไม่จ่าย (งานเดิม)', why: 'ตั้งหนี้ไว้ในระบบแล้ว ยังไม่มี PV จ่าย (หักใบลดหนี้แล้ว)' },
  { k: 'stamp', auto: true, sec: 'out', t: 'อากรแสตมป์สัญญาใหม่ (0.1%)', why: 'สัญญาจ้างทำของ 1 บาทต่อทุก 1,000 บาท จ่ายตอนเซ็น' },
  { k: 'wip', auto: true, sec: 'con', t: 'ต้นทุนที่เหลือของโครงการที่กำลังทำ (ประมาณ)', why: 'มูลค่าสัญญา × 80% หักที่จ่ายแล้วและ AP ที่ตั้งไว้' },
  { k: 'lgBack', auto: true, sec: 'in', t: 'เงินสดค้ำประกันที่ครบกำหนดได้คืน', why: 'หลักประกันแบบเงินสดที่หมดอายุในช่วงนี้ (หน้าหลักประกัน)' },
  { k: 'vat', sec: 'out', t: 'ภาษีมูลค่าเพิ่มนำส่ง (ภ.พ.30)', why: 'เงินรับจากลูกค้ามี VAT 7/107 ต้องนำส่งเดือนถัดไป หลังหักภาษีซื้อ' },
  { k: 'cit', sec: 'out', t: 'ภาษีเงินได้นิติบุคคล', why: 'ภ.ง.ด.51 ครึ่งปี (ส.ค.) · ภ.ง.ด.50 ทั้งปี (พ.ค.)' },
  { k: 'bankfee', sec: 'out', t: 'ค่าธรรมเนียมธนาคารอื่นๆ', why: 'ค่าธรรมเนียมวงเงินรายปี / ค่าธรรมเนียมอื่นของธนาคาร (ค่าธรรมเนียม LG ของสัญญาใหม่คิดในข้อ ข.2 แล้ว)' },
  { k: 'service', sec: 'out', t: 'บริการหลังการขาย / ซ่อม / ค่าปรับงานล่าช้า', why: 'งานที่ส่งมอบแล้วยังมีค่าใช้จ่ายตามมา' },
];

function fundFcOf(cfg) {
  const f = cfg.fc || {}, fl = f.lit || {};
  const lit = Object.assign({}, FUND_FC_LIT, fl);
  lit.limit = Object.prototype.hasOwnProperty.call(fl, 'limit') ? fundN(fl.limit) : fundN(cfg.lenders && cfg.lenders.lit && cfg.lenders.lit.limit);
  const instT = Object.assign({}, FUND_FC_INSTALL, f.instT);
  return {
    payTypes: Array.isArray(f.payTypes) && f.payTypes.length ? f.payTypes : FUND_FC_PAYTYPES,
    lit, comm: fundN(f.comm) != null ? Number(f.comm) : 0,   // BIO: ยังไม่ได้บอก % ค่าคอม → 0 + เตือน
    commAt: f.commAt === 'rcv' ? 'rcv' : 'sign',
    instT, instDays: fundN(f.instDays) != null ? Math.max(0, Number(f.instDays)) : 0, instPay: fundN(f.instPay) != null ? Math.max(0, Number(f.instPay)) : 14, drinkD: fundN(f.drinkD) != null ? Math.max(0, Number(f.drinkD)) : 120,
    fac: Object.assign({}, FUND_FC_FACTORY, f.fac), facD: Object.assign({}, FUND_FC_FAC_DAYS, f.facD),
    incC: Object.assign({}, FUND_FC_INC_CYCLE, f.incC),
    invLag: fundN(f.invLag) != null ? Math.max(0, Number(f.invLag)) : 45, wip: f.wip && typeof f.wip === 'object' ? f.wip : {},
    open: { bal: f.open && f.open.bal === 'avail' ? 'avail' : 'ledger', off: f.open && Array.isArray(f.open.off) ? f.open.off.map(String) : [] },
    // ค่าธรรมเนียม LG (ผู้ใช้ 2026-11-12 "เพิ่มค่าธรรมเนียม LG 1.25% วิธีคิดเหมือนกันเลย" = แบบ WTP): 1.25% ต่อปีของยอดค้ำ · ค้ำ 2 ปี · วิธีจ่ายยังไม่ยืนยัน (ok.lgFeePay) ค่าเริ่มปีละครั้งล่วงหน้า
    //   yrsDrink ใช้กับโครงการ POG Drink ของ WTP — BIO ไม่มีผลิตภัณฑ์นั้น (fundFcIsDrink = false เสมอ) เก็บไว้ให้โค้ดตรงกัน
    lgFee: (() => { const g = f.lgFee || {}; return { rate: fundN(g.rate) != null ? Number(g.rate) : 1.25, yrs: fundN(g.yrs) != null ? Math.max(0, Number(g.yrs)) : 2,
      yrsDrink: fundN(g.yrsDrink) != null ? Math.max(0, Number(g.yrsDrink)) : 1, pay: g.pay === 'once' ? 'once' : 'yearly' }; })(),
    more: Object.assign({ principal: true }, f.more), ovr: f.ovr || {}, ok: Object.assign({ feeBase: true, intPay: true }, f.ok),
  };
}
/* โครงการ POG Drink ล้วน (ทุกผลิตภัณฑ์เป็น PD/PDH/PDP) — ผู้ใช้ 2026-11-11 "POG Drink รับงวดเดียวทั้งหมด สัญญาเป็น 120 ทั้งหมด" */
function fundFcIsDrink(r) {
  const it = r && r.valueMode === 'items' ? (r.items || []).filter(x => Number(x.qty) > 0) : [];
  return it.length > 0 && it.every(x => fundFcInstFam(x.code) === 'drink');
}
/* POG Drink ใช้งวดเดียวตามวันที่ตั้ง (fc.drinkD ค่าเริ่ม 120) เว้นแต่เลือกแบบเองในฟอร์มโครงการ (row.payTypeSet) — แถวที่นำเข้ามาเป็น 2 งวดก็ตามกติกานี้ */
function fundFcDrinkAuto(r) { return !(Array.isArray(r.inst) && r.inst.length) && !r.payTypeSet && fundFcIsDrink(r); }
/* งวดรับเงินของโครงการ [{ d วันหลังเซ็น, p % }] — ปรับเฉพาะโครงการ (row.inst) ชนะ → POG Drink งวดเดียว → แบบที่เลือก (row.payType) */
function fundFcInst(r, fc) {
  if (Array.isArray(r.inst) && r.inst.length) return r.inst;
  if (fundFcDrinkAuto(r)) return [{ d: fc.drinkD, p: 100 }];
  const t = fc.payTypes.find(x => x.id === r.payType) || fc.payTypes[0];
  return t ? t.inst : [];
}
function fundFcInstText(inst) {
  return (inst || []).map((x, i, a) => (a.length > 1 ? (i === a.length - 1 ? 'งวดสุดท้าย' : 'งวด ' + (i + 1)) + ' ' : '') + 'วันที่ ' + (Number(x.d) || 0) + ' ได้ ' + fmtNum(Number(x.p) || 0, 0) + '%').join(' · ');
}
function fundFcPayName(r, fc) {
  if (r.payDate) return 'จ่ายวันที่กำหนด';
  if (Array.isArray(r.inst) && r.inst.length) return 'ปรับเอง · ' + r.inst.length + ' งวด';
  if (fundFcDrinkAuto(r)) return 'งวดเดียว (POG Drink)';
  const t = fc.payTypes.find(x => x.id === r.payType) || fc.payTypes[0];
  return t ? t.name : '—';
}
/* วันรับเงินแต่ละงวด · วันที่ลูกค้าจ่ายแน่นอน (payDate) ชนะ · ถึงวันแล้วยังไม่ได้รับ = อีก 30 วัน (กติกาเดิม) */
function fundFcSched(r, fc, today) {
  if (r.payDate) return [{ date: r.payDate < today ? today : r.payDate, share: 1, d: null, late: r.payDate < today, n: 1, of: 1 }];
  if (!r.signDate) return [];
  const inst = fundFcInst(r, fc).filter(x => Number(x.p) > 0), tot = inst.reduce((s, x) => s + Number(x.p), 0);
  if (!tot) return [];
  return inst.map((x, i) => {
    const d = Number(x.d) || 0, d0 = fundAddDays(r.signDate, d), late = d0 < today;
    return { date: late ? fundAddDays(today, 30) : d0, share: Number(x.p) / tot, d, late, n: i + 1, of: inst.length };
  });
}
/* ดึงจากหน้าโครงการ (ผู้ใช้: "PROJECT ที่หมายถึงคือหน้าโครงการ") → Type / จังหวัด + แบบรับเงินตาม % งวด 1–2 ของหน้าโครงการ */
function fundFcFromProject(p, fc) {
  const raw = p._raw || {};
  const pc = (k) => { const n = fundN(String(raw[k] == null ? '' : raw[k]).replace(/[%,\s]/g, '')); return n == null || n <= 0 ? null : n <= 1 ? n * 100 : n; };
  const p1 = pc('% งวด 1'), p2 = pc('% งวด 2');
  const out = { type: p.type || '', province: p.province || '', useLit: false };
  const two = fc.payTypes.find(t => t.inst.length === 2), one = fc.payTypes.find(t => t.inst.length === 1);
  if (p1 != null && p2 == null && p1 >= 99.5 && one) out.payType = one.id;
  else if (p1 != null && p2 != null && two) {
    out.payType = two.id;
    if (Math.abs(Number(two.inst[0].p) - p1) > 0.5 || Math.abs(Number(two.inst[1].p) - p2) > 0.5) out.inst = [{ d: two.inst[0].d, p: p1 }, { d: two.inst[1].d, p: p2 }];
  }
  return out;
}
/* ค่าติดตั้งของโครงการ → { total, adv, i1, i2 } · ใส่ยอดทั้งโครงการเอง (row.instAmt) ชนะ → ผลิตภัณฑ์ × จำนวนชุด × ค่าติดตั้งต่อชุด
 *   แบ่งงวดตามกลุ่มผลิตภัณฑ์ (FUND_FC_INST_SPLIT) · ใส่ยอดเอง = แบ่งแบบ POG Drink เมื่อทุกรายการเป็น Drink ไม่งั้นแบบถัง */
function fundFcInstall(r, fc) {
  const out = { total: 0, adv: 0, i1: 0, i2: 0, unk: [], det: [], own: false };
  const add = (amt, fam) => { FUND_FC_INST_SPLIT[fam].forEach(x => { out[x.k] += amt * x.p / 100; }); out.total += amt; };
  const items = r.valueMode === 'items' ? (r.items || []).filter(x => Number(x.qty) > 0) : [];
  if (fundN(r.instAmt) != null) {
    const fam = items.length && items.every(x => fundFcInstFam(x.code) === 'drink') ? 'drink' : 'tank';
    add(Number(r.instAmt), fam);
    out.own = true;
    out.det.push('ใส่ค่าติดตั้งทั้งโครงการเอง ' + fundB(r.instAmt) + ' · แบ่ง ' + fundFcSplitText(fam));
    return out;
  }
  if (!items.length) { out.unk.push('ไม่ได้ระบุผลิตภัณฑ์'); return out; }
  items.forEach(x => {
    const q = Number(x.qty), per = fundProdOf(x.code) ? fundN(fc.instT[x.code]) : null, fam = fundFcInstFam(x.code);
    if (per == null) { out.unk.push(fundItemName(x)); return; }
    add(q * per, fam);
    out.det.push(fundItemName(x) + ' ' + fmtNum(q, q % 1 ? 2 : 0) + ' ชุด × ' + fundB(per) + ' = ' + fundB(q * per) + ' (' + fundFcSplitText(fam) + ')');
  });
  return out;
}
/* ดอกเบี้ยเงินกู้ใหม่ · flows = +เบิก / −คืน · คืน { inPlan: [{date, amt}], total ตลอดอายุเงินกู้ } */
function fundFcLitInt(flows, rate, mode, lastDay, far) {
  const pts = flows.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!(rate > 0) || !pts.length) return { inPlan: [], total: 0 };
  const all = fundLoanCost(pts, rate, far).map(e => ({ date: e.date, amt: -e.amt }));
  const total = all.reduce((s, e) => s + e.amt, 0);
  if (mode === 'upfront') return { inPlan: pts[0].date <= lastDay ? [{ date: pts[0].date, amt: total }] : [], total };
  if (mode === 'end') {
    const out = [];
    let acc = 0, bal = 0, prev = pts[0].date;
    pts.forEach(p => {
      acc += Math.max(0, bal) * rate * fundDays(prev, p.date) / 365;
      prev = p.date; bal += p.amt;
      if (p.amt < 0 && acc > 0.005) { out.push({ date: p.date, amt: acc }); acc = 0; }
    });
    return { inPlan: out.filter(e => e.date <= lastDay), total };
  }
  return { inPlan: all.filter(e => e.date <= lastDay), total };
}
function fundAddMonthsISO(iso, n) {
  const mk = bdafAddM(iso.slice(0, 7), n), d = Math.min(Number(iso.slice(8, 10)) || 1, bdafDim(mk));
  return mk + '-' + String(d).padStart(2, '0');
}
/* โครงการที่จะลงนาม → เงินรับ · ค่าคอม · ADV. · หลักประกัน · อากร · เงินกู้ LIT (เบิก/ค่าธรรมเนียม/ดอกเบี้ย/คืน) เรียงตามวันเซ็น
 *   นับเฉพาะแถวที่ไม่ปิดและไม่ใช่ "ยังไม่แน่นอน" · กลุ่ม "เซ็นแล้ว" = นับเฉพาะเงินรับ (หักใบแจ้งหนี้ที่ออกแล้ว + ที่รับแล้ว) และเงินกู้ */
function fundFcPlan(pipe, fc, cfg, today, lastDay, arOpen, recvBy, lgRoom0) {
  const ev = { rcv: [], comm: [], inst: [], inst1: [], inst2: [], fac1: [], fac2: [], fac3: [], lg: [], lgFee: [], stamp: [], litIn: [], litFee: [], litInt: [], litRepay: [] };
  const per = [], lgPct = (Number(cfg.lgPct) || 0) / 100, rate = (Number(fc.lit.rate) || 0) / 100, far = fundAddDays(lastDay, 1100);
  let litLeft = fc.lit.limit, lgRoom = lgRoom0;
  pipe.filter(r => !r.off && r.group !== 'unsure' && Number(r.value) > 0)
    .sort((a, b) => String(a.signDate || '9999').localeCompare(String(b.signDate || '9999')))
    .forEach(r => {
      const v = Number(r.value), code = fundCode(r.code), isNew = r.group !== 'signed';
      const sign = r.signDate ? (r.signDate < today ? today : r.signDate) : '';
      const tag = { pid: r.id, t: r.name, ref: r.code || '' };
      const sched = fundFcSched(r, fc, today), gross = v * 106 / 107;
      // เซ็นแล้ว: หักที่รับแล้วเฉพาะแถวที่ใส่มูลค่าเต็มสัญญา (แถวที่ดึงมาเป็นยอดค้างรับหลังโอนสิทธิ์ หักไปแล้ว)
      const rb = code && recvBy ? recvBy[code] : null;
      const less = (code && arOpen && arOpen[code]) || 0, got = (!isNew && rb && v >= rb.contract - 1) ? rb.got : 0;
      const P = { r, v, sign, isNew, sched, gross, less, got, rcvBase: Math.max(0, gross - less - got), comm: 0, inst: null, lgNeed: 0, lgUse: 0, lgCash: 0, lgFee: 0, lgUnknown: false, stamp: 0, lit: null };
      const base = ['มูลค่าสัญญา ' + fundB(v) + ' หัก ณ ที่จ่าย 1% (× 106/107) = ' + fundB(gross)];
      if (less > 0.5) base.push('หักใบแจ้งหนี้ที่ออกแล้วยังรอรับ ' + fundB(less) + ' (นับในข้อ 1 แล้ว)');
      if (got > 0.5) base.push('หักที่รับแล้ว ' + fundB(got));
      sched.forEach(s => {
        const amt = P.rcvBase * s.share;
        if (amt > 0.5 && s.date <= lastDay) ev.rcv.push(Object.assign({ date: s.date, amt, note: base.concat([
          (s.d == null ? 'ลูกค้าจ่ายวันที่กำหนดไว้ในโครงการ' : (s.of > 1 ? 'งวด ' + s.n + '/' + s.of + ' · ' : '') + 'วันที่ ' + s.d + ' หลังเซ็น (' + fmtDate(r.signDate) + ') ได้ ' + fmtNum(s.share * 100, 0) + '% = ' + fundB(amt)),
        ].concat(s.late ? ['เลยวันแล้วยังไม่ได้รับ — เลื่อนไปอีก 30 วัน'] : [])) }, tag));
      });
      if (isNew && sign) {
        P.comm = v * fc.comm / 100;
        if (P.comm > 0.5) {
          if (fc.commAt === 'rcv' && sched.length) sched.forEach(s => { if (s.date <= lastDay) ev.comm.push(Object.assign({ date: s.date, amt: P.comm * s.share, note: ['ค่าคอม ' + fmtNum(fc.comm, 1) + '% ของ ' + fundB(v) + ' = ' + fundB(P.comm), 'จ่ายตามเงินรับงวด ' + s.n + ' (' + fmtNum(s.share * 100, 0) + '%)'] }, tag)); });
          else if (sign <= lastDay) ev.comm.push(Object.assign({ date: sign, amt: P.comm, note: ['มูลค่าสัญญา ' + fundB(v) + ' × ' + fmtNum(fc.comm, 1) + '% = ' + fundB(P.comm), 'จ่ายวันเซ็นสัญญา'] }, tag));
        }
        P.inst = fundFcInstall(r, fc);
        const iu = P.inst.unk.length ? ['ยังไม่รู้ค่าติดตั้งของ ' + P.inst.unk.join(', ') + ' (ไม่นับ)'] : [];
        const di = fundAddDays(sign, fc.instDays);
        if (P.inst.adv > 0.5 && di <= lastDay) ev.inst.push(Object.assign({ date: di, amt: P.inst.adv, note: P.inst.det.concat(iu, ['ADV. ' + fundB(P.inst.adv) + ' · ' + (fc.instDays ? 'จ่ายหลังเซ็น ' + fc.instDays + ' วัน' : 'จ่ายวันเซ็น (หลังได้หนังสือสั่งจ้าง)')]) }, tag));
        const rs = sched.slice().sort((x, y) => x.date.localeCompare(y.date)), r1 = rs[0], rL = rs[rs.length - 1];
        const after = (s0, nm) => (s0.d == null ? 'วันลูกค้าจ่ายที่กำหนด ' : 'รับเงินราชการ' + (s0.of > 1 ? nm : '') + ' ' + fmtDate(s0.date) + ' ') + '+ ' + fc.instPay + ' วัน';
        if (r1 && P.inst.i1 > 0.5) { const d = fundAddDays(r1.date, fc.instPay); P.inst.d1 = d; if (d <= lastDay) ev.inst1.push(Object.assign({ date: d, amt: P.inst.i1, note: P.inst.det.concat(iu, ['งวด 1 ' + fundB(P.inst.i1) + ' · จ่ายหลัง' + after(r1, 'งวด 1')]) }, tag)); }
        P.fac = fundFcFactory(r, fc);
        const fu = P.fac.unk.length ? ['ยังไม่รู้ค่าของของ ' + P.fac.unk.join(', ') + ' (ไม่นับ)'] : [];
        FUND_FC_FAC_PH.forEach((ph, i) => {
          const amt = P.fac.p[i], n = Number(fc.facD[ph.k]) || 0;
          if (!(amt > 0.5)) return;
          let d = fundAddDays(sign, n);
          if (d < today) d = today;
          if (d <= lastDay) ev['fac' + (i + 1)].push(Object.assign({ date: d, amt, note: P.fac.det.concat(fu, [ph.t + ' ' + fundB(amt) + ' · ' + (n < 0 ? 'ก่อนเซ็น ' + (-n) + ' วัน' : 'วันที่ ' + n + ' หลังเซ็น') + (d === today && fundAddDays(sign, n) < today ? ' (เลยมาแล้ว นับวันนี้)' : '')]) }, tag));
        });
        if (rL && P.inst.i2 > 0.5) { const d = fundAddDays(rL.date, fc.instPay); P.inst.d2 = d; if (d <= lastDay) ev.inst2.push(Object.assign({ date: d, amt: P.inst.i2, note: P.inst.det.concat(iu, ['งวดสุดท้าย ' + fundB(P.inst.i2) + ' · จ่ายหลัง' + after(rL, 'งวดสุดท้าย')]) }, tag)); }
        P.lgNeed = v * lgPct;
        if (P.lgNeed > 0.5) {
          if (lgRoom == null) P.lgUnknown = true;
          else { P.lgUse = Math.min(Math.max(0, lgRoom), P.lgNeed); lgRoom -= P.lgUse; P.lgCash = P.lgNeed - P.lgUse; }
          if (P.lgCash > 0.5 && sign <= lastDay) ev.lg.push(Object.assign({ date: sign, amt: P.lgCash, note: ['หลักประกัน ' + fmtNum(lgPct * 100, 1) + '% ของ ' + fundB(v) + ' = ' + fundB(P.lgNeed), P.lgUse > 0.5 ? 'ใช้วงเงิน LG ที่เหลือ ' + fundB(P.lgUse) : 'วงเงิน LG หมดแล้ว', 'ต้องวางเงินสด (1 ต่อ 1) ' + fundB(P.lgCash)] }, tag));
        }
        // ค่าธรรมเนียม LG: คิดจากยอดค้ำประกันทั้งหมด (เหมือน WTP) · ยังไม่ตั้ง % หลักประกัน = 0
        if (P.lgNeed > 0.5 && fc.lgFee.rate > 0) {
          const drink = fundFcIsDrink(r), yrs = drink ? fc.lgFee.yrsDrink : fc.lgFee.yrs, perYr = P.lgNeed * fc.lgFee.rate / 100;
          P.lgFee = perYr * yrs;
          const base = ['หลักประกัน ' + fundB(P.lgNeed) + ' × ' + fmtNum(fc.lgFee.rate, 2) + '% ต่อปี = ' + fundB(perYr) + ' ต่อปี', 'ค้ำ ' + yrs + ' ปี · รวม ' + fundB(P.lgFee)];
          if (fc.lgFee.pay === 'once') { if (sign <= lastDay) ev.lgFee.push(Object.assign({ date: sign, amt: P.lgFee, note: base.concat(['จ่ายครั้งเดียวทั้งระยะ ตอนออก LG (วันเซ็น)']) }, tag)); }
          else for (let y = 0; y < yrs; y++) { const d = fundAddMonthsISO(sign, 12 * y); if (d <= lastDay) ev.lgFee.push(Object.assign({ date: d, amt: perYr, note: base.concat(['ปีที่ ' + (y + 1) + ' จ่ายล่วงหน้า' + (y ? ' ครบรอบ ' + y + ' ปี' : ' ตอนออก LG (วันเซ็น)')]) }, tag)); }
        }
        if (fc.more.stamp) { P.stamp = v * FUND_FC_STAMP / 100; if (sign <= lastDay) ev.stamp.push(Object.assign({ date: sign, amt: P.stamp, note: ['มูลค่าสัญญา ' + fundB(v) + ' × ' + FUND_FC_STAMP + '%'] }, tag)); }
      }
      if (r.useLit) {
        const L = { want: v * (Number(fc.lit.pct) || 0) / 100, gross: 0, cut: false, draw: '', feeA: 0, feeB: 0, net: 0, repays: [], ints: [], intTotal: 0, outEnd: 0, why: '' };
        P.lit = L;
        if (!sign) L.why = 'ยังไม่มีวันเซ็น';
        else {
          L.draw = fundAddDays(sign, Number(fc.lit.lead) || 0);
          if (L.draw > lastDay) L.why = 'เงินเข้าหลังช่วงที่ดู';
          else {
            L.gross = litLeft == null ? L.want : Math.min(L.want, Math.max(0, litLeft));
            if (litLeft != null) litLeft -= L.gross;
            L.cut = L.gross < L.want - 0.5;
            if (L.gross <= 0.5) L.why = 'วงเงินเต็ม';
            else {
              const fb = fc.lit.feeBase === 'contract' ? v : L.gross;
              L.feeA = fb / 1e6 * (Number(fc.lit.feePerM) || 0);
              L.feeB = Number(fc.lit.feeFix) || 0;
              L.net = L.gross - L.feeA - L.feeB;
              ev.litIn.push(Object.assign({ date: L.draw, amt: L.gross, note: ['มูลค่าสัญญา ' + fundB(v) + ' × ' + fmtNum(Number(fc.lit.pct) || 0, 0) + '% = ' + fundB(L.want)].concat(L.cut ? ['วงเงินเหลือแค่ ' + fundB(L.gross)] : [], ['เงินเข้า ' + fmtDate(L.draw) + ' (เซ็น + ' + (Number(fc.lit.lead) || 0) + ' วัน)']) }, tag));
              ev.litFee.push(Object.assign({ date: L.draw, amt: L.feeA + L.feeB, note: [
                'ค่าวิเคราะห์สินเชื่อ ' + fundB(fb) + ' ÷ 1,000,000 × ' + fundB(fc.lit.feePerM) + ' = ' + fundB(L.feeA) + (fc.lit.feeBase === 'contract' ? ' (คิดจากมูลค่าสัญญา)' : ' (คิดจากยอดกู้)'),
                'ค่าอื่นๆ ' + fundB(L.feeB) + ' ต่อโครงการ', 'หักจากเงินกู้ที่ได้รับ · รับสุทธิ ' + fundB(L.net)] }, tag));
              // คืนเงินกู้ตอนรับเงินราชการ (ผู้ใช้ 2026-11-11): หักดอกเบี้ย (15%/ปี คิดตามจำนวนวันตั้งแต่รับเงินกู้) + เงินต้น จากเงินรับก่อน
              //   งวดแรกหักทั้งก้อนที่ได้รับ · งวด 2 หักส่วนที่เหลือจนครบ · ที่เหลือเราได้รับ (โหมด end) · โหมดอื่นคงวิธีเดิม
              const rsL = sched.slice().sort((a, b) => a.date.localeCompare(b.date));
              let out = L.gross;
              if (fc.lit.intPay === 'end') {
                let acc = 0, prev = L.draw;
                const ints = [];
                rsL.forEach(s => {
                  if (out <= 0.5 && acc <= 0.5) return;
                  const date = s.date < L.draw ? L.draw : s.date, rcv = gross * s.share;
                  acc += out * rate * fundDays(prev, date) / 365;
                  prev = date;
                  const take = Math.min(rcv, acc + out), pi = Math.min(take, acc), pp = take - pi;
                  acc -= pi; out -= pp;
                  if (pi > 0.005) ints.push({ date, amt: pi, n: s.n, of: s.of, rcv, days: fundDays(L.draw, date) });
                  L.repays.push({ date, amt: pp, pi, n: s.n, of: s.of, rcv, left: rcv - take });
                });
                const tail = out > 0.5 ? out * rate * Math.max(0, fundDays(prev, far)) / 365 : 0;
                L.outEnd = out;
                L.ints = ints.filter(e => e.date <= lastDay);
                L.intTotal = ints.reduce((t, e) => t + e.amt, 0) + acc + tail;
                L.ints.forEach(e => ev.litInt.push(Object.assign({ date: e.date, amt: e.amt, note: [
                  'ดอกเบี้ย ' + fmtNum(Number(fc.lit.rate) || 0, 2) + '% ต่อปี คิดตามจำนวนวัน ตั้งแต่รับเงินกู้ ' + fmtDate(L.draw) + ' (ยอดคงค้าง × อัตรา × วัน ÷ 365)',
                  'หักจากเงินรับราชการ' + (e.of > 1 ? 'งวด ' + e.n : '') + ' ' + fundB(e.rcv) + ' วันที่ ' + fmtDate(e.date)] }, tag)));
                L.repays.filter(p => p.amt > 0.005 && p.date <= lastDay).forEach(p => ev.litRepay.push(Object.assign({ date: p.date, amt: p.amt, note: [
                  'เงินรับราชการ' + (p.of > 1 ? 'งวด ' + p.n : '') + ' ' + fundB(p.rcv) + ' → หักดอกเบี้ย ' + fundB(p.pi) + ' + คืนเงินต้น ' + fundB(p.amt) + (p.left > 0.5 ? ' · ที่เหลือเราได้รับ ' + fundB(p.left) : ' · หักหมดทั้งงวด'),
                  'เงินกู้ ' + fundB(L.gross) + ' เบิก ' + fmtDate(L.draw) + (out > 0.5 && p === L.repays[L.repays.length - 1] ? ' · ยังค้าง ' + fundB(out) : '')] }, tag)));
              } else {
                const flows = [{ date: L.draw, amt: L.gross }];
                rsL.forEach(s => {
                  if (out <= 0.5) return;
                  const pay = Math.min(out, gross * s.share), date = s.date < L.draw ? L.draw : s.date;
                  out -= pay;
                  L.repays.push({ date, amt: pay, n: s.n, of: s.of });
                  flows.push({ date, amt: -pay });
                });
                L.outEnd = out;
                L.repays.forEach(p => { if (p.date <= lastDay) ev.litRepay.push(Object.assign({ date: p.date, amt: p.amt, note: ['เงินรับ' + (p.of > 1 ? 'งวด ' + p.n : '') + ' ' + fundB(gross * (sched.find(s => s.n === p.n) || { share: 1 }).share) + ' หักคืน LIT ' + fundB(p.amt), 'เงินกู้ ' + fundB(L.gross) + ' เบิก ' + fmtDate(L.draw)] }, tag)); });
                const it = fundFcLitInt(flows, rate, fc.lit.intPay, lastDay, far);
                L.ints = it.inPlan; L.intTotal = it.total;
                it.inPlan.forEach(e => ev.litInt.push(Object.assign({ date: e.date, amt: e.amt, note: ['ยอดเงินกู้คงค้าง × ' + fmtNum(Number(fc.lit.rate) || 0, 2) + '% × จำนวนวัน ÷ 365', 'ดอกเบี้ยทั้งก้อนจนลูกค้าจ่าย ' + fundB(it.total) + (out > 0.5 ? ' (ยังไม่รู้วันคืนครบ คิดยาวไป 3 ปี)' : '')] }, tag)));
              }
            }
          }
        }
      }
      per.push(P);
    });
  return { ev, per, litLeft, lgLeft: lgRoom };
}
/* เงินสดค้ำประกันที่หมดอายุในช่วงแผน → ได้คืน (หมดอายุไปแล้วยังไม่คืน = ไม่นับ เพราะไม่รู้วัน) */
function fundFcLgBack(rows, today, lastDay) {
  return (rows || []).filter(r => !r.receivedDate && !/คืนแล้ว|ยกเลิก/.test(String(r.status || '')) && /เงินสด|cash/i.test(String(r.guaranteeType || '')))
    .map(r => ({ r, end: bdToISO(r.endDate), amt: Number(r.amount) || 0 }))
    .filter(x => x.end && x.end >= today && x.end <= lastDay && x.amt > 0.5)
    .map(x => ({ date: x.end, amt: x.amt, t: x.r.projectName || x.r.project || x.r.contractNo || 'หลักประกัน', ref: x.r.lgNo || x.r.contractNo || '', note: ['เงินสดค้ำประกัน ' + (x.r.bank || '') + ' หมดอายุ ' + fmtDate(x.end)] }));
}
/* ดอกเบี้ย/เงินต้นเงินกู้เดิม แยกตามรอบจ่าย · ลีซอิทที่มีอยู่ไปอยู่แถวเช็คล่วงหน้า */
function fundFcDebtSplit(debt) {
  const cls = { month: [], quarter: [], incofin: [], pick: [], principal: [] };
  debt.rows.forEach(d => {
    if (d.m.leasitSource === true || d.m.leasitSource === 'true') return;
    // BIO: WCI = ไตรมาส · ตปท./สกุลต่างประเทศ = ทุกเดือน · หมวดอื่น = เลือกเดือนจ่ายเอง (pick)
    const k = d.cat === 'Incofin' ? 'incofin' : FUND_QUARTER_CATS.indexOf(d.cat) >= 0 ? 'quarter' : (FUND_MONTH_CATS.indexOf(d.cat) >= 0 || (d.cur && d.cur !== 'THB')) ? 'month' : 'pick';
    d.evs.forEach(e => {
      const it = { date: e.date, amt: -e.amt, t: d.name || '—', ref: (d.no || '') + (d.cat ? ' · ' + d.cat : ''), did: d.id, no: d.no,
        note: e.kind === 'principal' ? ['เงินต้นคงเหลือ ' + (d.cur !== 'THB' ? d.cur + ' ' : '') + fundB(d.bal) + ' ครบ ' + fmtDate(d.due) + ' · เลือก "คืนจริง"']
          : [d.est ? 'ประมาณจากยอดคงเหลือ × อัตราดอกเบี้ย (ยังไม่มีตารางดอกเบี้ยเดือนนี้)' : 'จากตารางดอกเบี้ย (Debt Ledger)'].concat(d.cur !== 'THB' ? ['สกุล ' + d.cur + ' × อัตราแลกเปลี่ยน ' + fmtNum(d.fx, 2)] : []) };
      if (e.kind === 'interest') cls[k].push(it);
      else if (e.kind === 'principal') cls.principal.push(it);
    });
  });
  return cls;
}
/* ยอดรายเดือนของรายการ (เฉพาะเดือนในช่วงแผน) */
function fundFcBucket(items, F) {
  const v = {};
  F.forEach(mk => { v[mk] = 0; });
  (items || []).forEach(it => { const mk = String(it.date || '').slice(0, 7); if (mk in v) v[mk] += it.amt; });
  return v;
}
/* ส่งออก Excel ของแท็บประมาณการ: งบรายเดือน (ตามที่เห็นบนจอ รวมยอดที่แก้เอง) + โครงการรายตัว */
function fundFcExport(x) {
  const X = window.XLSX;
  if (!X) return false;
  const wb = X.utils.book_new(), R = (v) => Math.round(v || 0);
  const add = (name, aoa, widths) => { const ws = X.utils.aoa_to_sheet(aoa); ws['!cols'] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name); };
  add('ประมาณการรับ-จ่าย', [['ประมาณการรับ-จ่าย ' + x.rangeLabel, 'ข้อมูล ณ ' + x.today], ['รายการ'].concat(x.F.map(bdafMShort), ['รวม'])]
    .concat(x.lines.map(l => [l.label].concat(x.F.map(mk => (l.vals[mk] == null ? '' : R(l.vals[mk]))), [l.noTotal ? '' : R(l.tot != null ? l.tot : x.F.reduce((s, mk) => s + (l.vals[mk] || 0), 0))]))),
    [44].concat(x.F.map(() => 14), [16]));
  add('โครงการ', [['โครงการ', 'รหัส', 'กลุ่ม', 'Type', 'ผลิตภัณฑ์', 'มูลค่าสัญญา', 'วันเซ็น', 'รับเงิน', 'เงินรับ (หัก 1%)', 'ค่าคอม', 'ค่าติดตั้งรวม', 'ติดตั้ง ADV.', 'ติดตั้งงวด 1', 'ติดตั้งงวดสุดท้าย', 'ค่าของโรงงานรวม', 'โรงงานงวด 1', 'โรงงานงวด 2', 'โรงงานงวด 3', 'หลักประกัน', 'วางเงินสด', 'ค่าธรรมเนียม LG (ทั้งระยะ)', 'เบิก LIT', 'ค่าธรรมเนียม LIT', 'ดอกเบี้ย LIT ทั้งก้อน', 'หมายเหตุ']]
    .concat(x.per.map(P => [P.r.name, P.r.code || '', (FUND_GROUP_OF[P.r.group] || {}).t || '', P.r.type || '', fundItemsText(P.r), R(P.v), P.r.signDate || '', fundFcPayName(P.r, x.fc) + ' · ' + fundFcInstText(fundFcInst(P.r, x.fc)),
      R(P.rcvBase), R(P.comm), P.inst ? R(P.inst.total) : '', P.inst ? R(P.inst.adv) : '', P.inst ? R(P.inst.i1) : '', P.inst ? R(P.inst.i2) : '', P.fac ? R(P.fac.total) : '', P.fac ? R(P.fac.p[0]) : '', P.fac ? R(P.fac.p[1]) : '', P.fac ? R(P.fac.p[2]) : '', R(P.lgNeed), P.lgUnknown ? 'ยังไม่รู้วงเงิน' : R(P.lgCash), R(P.lgFee), P.lit ? R(P.lit.gross) : '', P.lit ? R(P.lit.feeA + P.lit.feeB) : '', P.lit ? R(P.lit.intTotal) : '', P.r.note || ''])),
    [34, 12, 12, 12, 30, 15, 12, 40, 15, 13, 14, 13, 13, 14, 15, 13, 13, 13, 13, 13, 15, 14, 14, 15, 24]);
  X.writeFile(wb, 'ประมาณการรับจ่าย_' + x.today + '.xlsx');
  return true;
}

/* ส่งออก Excel ตาราง "โครงการที่จะลงนาม" ตามที่เห็นบนจอ (ผู้ใช้ 2026-11-12 "อยากให้ EXPORT EXCEL ได้ด้วย")
 *   กลุ่มตามเดือนเซ็น = แถวหัวกลุ่มพร้อมยอดรวมกลุ่ม · โครงการรายแถว · แถวรวมที่นับในแผนท้ายตาราง (ตัวเลขเดียวกับบนจอ)
 *   เพิ่มที่บนจอไม่มี: แยกงวดค่าติดตั้ง / ค่าของโรงงาน / ค่าธรรมเนียม LG · BIO: ไม่มี LIT — คอลัมน์ท้าย = เงินรับจากราชการ (หัก 1%) แบบตารางบนจอ · ชื่อสไตล์ FUND_XLS (XL ของหน้าเงินกู้เป็น global อยู่แล้ว) */
const FUND_XLS_BD = { style: 'thin', color: { rgb: 'D5DDE8' } };
const FUND_XLS = {
  title: { font: { bold: true, sz: 14, color: { rgb: '14213A' } } },
  sub: { font: { sz: 11, color: { rgb: '5E6A82' } } },
  th: { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '14213A' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { top: FUND_XLS_BD, bottom: FUND_XLS_BD, left: FUND_XLS_BD, right: FUND_XLS_BD } },
  grp: { font: { bold: true, color: { rgb: '14213A' } }, fill: { fgColor: { rgb: 'EAF0FA' } }, alignment: { vertical: 'center' }, border: { top: FUND_XLS_BD, bottom: FUND_XLS_BD } },
  row: { alignment: { vertical: 'top', wrapText: true }, border: { bottom: FUND_XLS_BD } },
  tot: { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '14213A' } }, alignment: { vertical: 'center' } },
};
function fundPjExport(x) {
  const X = window.XLSX;
  if (!X) return false;
  const R = (v) => Math.round(v || 0), N = (v) => (Math.abs(v || 0) < 0.5 ? '' : R(v));
  const head = ['ลำดับ', 'หน่วยงาน / โครงการ', 'พื้นที่', 'รหัส', 'ผลิตภัณฑ์', 'มูลค่าสัญญา', 'วันเซ็น (ที่ใช้คิด)', 'วันเซ็นตามฝ่ายขาย', 'แบบรับเงิน', 'วันรับเงิน',
    'ค่าคอม', 'ค่าติดตั้งรวม', 'ติดตั้ง ADV.', 'ติดตั้งงวด 1', 'ติดตั้งงวดสุดท้าย', 'ค่าของโรงงานรวม', 'โรงงานงวด 1', 'โรงงานงวด 2', 'โรงงานงวด 3',
    'หลักประกันรวม', 'ใช้วงเงิน LG', 'วางเงินสด', 'ค่าธรรมเนียม LG (ทั้งระยะ)', 'เงินรับจากราชการ (หัก 1%)', 'หมายเหตุ'];   // BIO: ไม่มี LIT
  const NC = head.length, money = new Set([5].concat(Array.from({ length: 14 }, (_, i) => i + 10)));
  const aoa = [[x.title], [x.sub], [], head], kinds = [null, null, null, 'th'];
  const sumOf = (rows, fn) => rows.reduce((s, r) => { const P = x.perBy[r.id]; return s + (P ? Number(fn(P)) || 0 : 0); }, 0);
  const nums = (rows) => [sumOf(rows, P => P.comm), sumOf(rows, P => P.inst && P.inst.total), sumOf(rows, P => P.inst && P.inst.adv), sumOf(rows, P => P.inst && P.inst.i1), sumOf(rows, P => P.inst && P.inst.i2),
    sumOf(rows, P => P.fac && P.fac.total), sumOf(rows, P => P.fac && P.fac.p[0]), sumOf(rows, P => P.fac && P.fac.p[1]), sumOf(rows, P => P.fac && P.fac.p[2]),
    sumOf(rows, P => P.lgNeed), sumOf(rows, P => P.lgUse), sumOf(rows, P => P.lgCash), sumOf(rows, P => P.lgFee)];
  let seq = 0;
  x.groups.forEach(g => {
    const n = nums(g.rows);
    aoa.push([g.label + ' · ' + g.rows.length + ' โครงการ' + (g.note ? ' · ' + g.note : ''), '', '', '', '', R(g.val), '', '', '', ''].concat(n.map(N), [N(sumOf(g.rows, P => P.rcvBase))], ['']));
    kinds.push('grp');
    g.rows.forEach(r => {
      const P = x.perBy[r.id], mv = x.movedBy[r.id];
      const prods = Array.from(new Set((r.items || []).filter(it => Number(it.qty) > 0).map(it => fundItemName(it) + (Number(it.qty) > 1 ? ' × ' + fmtNum(Number(it.qty), 0) : '')))).join(', ') || r.type || '';
      const unk = (o) => (o && o.unk.length && !(o.total > 0.5) ? 'ยังไม่รู้' : null);
      aoa.push([++seq, r.org || r.name || '', r.org ? (r.area || r.full || '') : [r.type, r.province].filter(Boolean).join(' · '), r.code || '', prods, R(r.value),
        P && P.sign ? fmtDate(P.sign) : (r.signDate ? fmtDate(r.signDate) : ''), r.signDate ? fmtDate(r.signDate) + (mv ? ' (เลื่อนไป ' + bdafMShort(mv.to) + ')' : '') : '',
        P ? fundFcPayName(r, x.fc) : (FUND_GROUP_OF[r.group] || {}).t || 'ไม่นับ', P ? P.sched.map(s => fmtDate(s.date)).join(' · ') : '',
        P ? N(P.comm) : '', P && P.inst ? (unk(P.inst) || N(P.inst.total)) : '', P && P.inst ? N(P.inst.adv) : '', P && P.inst ? N(P.inst.i1) : '', P && P.inst ? N(P.inst.i2) : '',
        P && P.fac ? (unk(P.fac) || N(P.fac.total)) : '', P && P.fac ? N(P.fac.p[0]) : '', P && P.fac ? N(P.fac.p[1]) : '', P && P.fac ? N(P.fac.p[2]) : '',
        P ? N(P.lgNeed) : '', P && !P.lgUnknown ? N(P.lgUse) : (P && P.lgNeed > 0.5 ? 'ยังไม่รู้วงเงิน' : ''), P && !P.lgUnknown ? N(P.lgCash) : '', P ? N(P.lgFee) : '',
        P ? N(P.rcvBase) : '', r.note || '']);
      kinds.push('row');
    });
  });
  const inPlan = x.groups.reduce((a, g) => a.concat(g.rows.filter(r => x.perBy[r.id])), []);
  aoa.push(['รวมที่นับในแผน · ' + inPlan.length + ' โครงการ', '', '', '', '', R(inPlan.reduce((s, r) => s + x.perBy[r.id].v, 0)), '', '', '', ''].concat(nums(inPlan).map(N), [N(inPlan.reduce((t, r) => t + x.perBy[r.id].rcvBase, 0))], ['']));
  kinds.push('tot');
  const ws = X.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [6, 34, 30, 14, 26, 14, 13, 22, 16, 22, 12, 13, 12, 12, 13, 14, 12, 12, 12, 13, 13, 12, 13, 16, 24].map(w => ({ wch: w }));
  // หัวเรื่อง 2 บรรทัด + ชื่อกลุ่ม/แถวรวม กินช่อง ลำดับ…ผลิตภัณฑ์ (ไม่งั้นข้อความถูกตัดที่ช่องลำดับที่แคบ)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }]
    .concat(kinds.map((k, r) => (k === 'grp' || k === 'tot' ? { s: { r, c: 0 }, e: { r, c: 4 } } : null)).filter(Boolean));
  kinds.forEach((k, r) => {
    for (let c = 0; c < NC; c++) {
      const addr = X.utils.encode_cell({ r, c });
      if (r === 0 || r === 1) { if (ws[addr]) ws[addr].s = r ? FUND_XLS.sub : FUND_XLS.title; continue; }
      if (!k) continue;
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      const st = Object.assign({}, FUND_XLS[k]);
      if (ws[addr].t === 'n' && money.has(c)) { ws[addr].z = '#,##0'; st.alignment = Object.assign({}, st.alignment, { horizontal: 'right' }); }
      ws[addr].s = st;
    }
  });
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'โครงการที่จะลงนาม');
  X.writeFile(wb, 'โครงการที่จะลงนาม_' + x.today + '.xlsx');
  return true;
}

/* ── ชิ้นส่วนหน้าจอ ───────────────────────────────────────────────────── */
function FundNum({ value, onChange, disabled, placeholder, width }) {
  const [txt, setTxt] = React.useState(null);
  const shown = txt != null ? txt : (value == null || value === '' ? '' : fmtNum(Number(value), Number(value) % 1 ? 2 : 0));
  return (
    <input className="input" inputMode="decimal" disabled={disabled} placeholder={placeholder} value={shown} style={{ width: width || 120, textAlign: 'right' }}
      onFocus={() => setTxt(value == null ? '' : String(value))}
      onChange={e => setTxt(e.target.value)}
      onBlur={e => {
        const t = String(e.target.value).replace(/[,\s฿%]/g, '');
        setTxt(null);
        const n = t === '' ? null : Number(t);
        if (n === null || isFinite(n)) { if (n !== fundN(value)) onChange(n); }
      }} />
  );
}
function FundChip({ t, tone }) {
  const s = tone === 'bad' ? ['var(--bad-bg)', 'var(--bad)'] : tone === 'warn' ? ['var(--warn-bg)', '#92400e'] : tone === 'good' ? ['var(--good-bg)', '#15803d'] : ['#f1f5f9', '#475569'];
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 4, background: s[0], color: s[1], whiteSpace: 'nowrap', marginRight: 4 }}>{t}</span>;
}

/* ช่องกรอกยอดในตาราง (ผู้ใช้ 2026-11-09 อยากให้ดูเรียบ "เหมือนเว็บ Budget"): ไม่มีกรอบจนกว่าจะชี้/คลิก
 * Enter = เดือนถัดไป · ↑↓ = แถวบน/ล่าง · Esc = ยกเลิกที่พิมพ์ · พิมพ์ 2.5ล = 2,500,000 */
function FundCell({ value, onChange, disabled, r, c, sys }) {
  const [txt, setTxt] = React.useState(null);
  const skip = React.useRef(false);
  // sys = ยอดที่ระบบคิด (แถวอัตโนมัติ) · value = ยอดที่พิมพ์ทับ (null = ใช้ยอดระบบ)
  const auto = sys !== undefined, useSys = auto && value == null, sysR = auto ? Math.round(Number(sys) || 0) : 0;
  const shown = txt != null ? txt : value != null ? fmtNum(Number(value), Number(value) % 1 ? 2 : 0) : useSys && Math.abs(sysR) >= 1 ? fundB(sysR) : '';
  const go = (e, dr, dc) => {
    const tb = e.target.closest('.fund-sheet, tbody');
    const nx = tb && tb.querySelector('input[data-r="' + (r + dr) + '"][data-c="' + (c + dc) + '"]');
    e.preventDefault();
    if (nx) nx.focus(); else e.target.blur();
  };
  return (
    <input className={'fund-gcell' + (useSys ? ' sys' : auto ? ' ovr' : '')} data-r={r} data-c={c} inputMode="decimal" disabled={disabled} placeholder="–" value={shown}
      title={!auto ? 'พิมพ์ 2.5ล หรือ 2.5m = 2,500,000 · 500k = 500,000 · Enter = เดือนถัดไป'
        : useSys ? 'ระบบคิดให้ (กดชื่อแถวดูที่มา) · พิมพ์ทับได้' : 'แก้เองแล้ว · ระบบคิด ' + fundB(sysR) + ' · ลบให้ว่าง = กลับไปใช้ยอดระบบ'}
      onFocus={e => { setTxt(value != null ? String(value) : useSys && Math.abs(sysR) >= 1 ? String(sysR) : ''); const el = e.target; setTimeout(() => { try { el.select(); } catch (_) {} }, 0); }}
      onChange={e => setTxt(e.target.value)}
      onBlur={e => {
        const raw = e.target.value;
        setTxt(null);
        if (skip.current) { skip.current = false; return; }
        let n = fundParseAmt(raw);
        if (n === undefined) return;
        if (auto && n != null && Math.abs(n - sysR) < 0.5) n = null;    // พิมพ์เท่ายอดระบบ = ไม่ต้องเก็บ
        if (n !== fundN(value)) onChange(n);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') go(e, 0, 1);
        else if (e.key === 'ArrowDown') go(e, 1, 0);
        else if (e.key === 'ArrowUp') go(e, -1, 0);
        else if (e.key === 'Escape') { skip.current = true; e.target.blur(); }
      }} />
  );
}

/* ฟอร์มแถว Pipeline */
function FundRowModal({ row, cfg, fc, canEdit, onSave, onDelete, onClose }) {
  const [d, setD] = React.useState(row);
  const set = (k, v) => setD(p => Object.assign({}, p, { [k]: v }));
  const lab = { fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' };
  const field = (label, node, hint) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={lab}>{label}</span>{node}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{hint}</span>}
    </label>
  );
  const date = (k) => <input className="input" type="date" disabled={!canEdit} value={d[k] || ''} onChange={e => set(k, e.target.value)} />;
  // มูลค่าสัญญา: กรอกยอดเงินเลย หรือเลือกผลิตภัณฑ์ × จำนวนชุด × ราคาต่อชุด
  const byItems = d.valueMode === 'items';
  const items = d.items || [];
  const newItem = () => ({ code: FUND_PRODUCTS[0].code, qty: 1, price: FUND_PRODUCTS[0].price });
  const setItems = (list) => setD(o => Object.assign({}, o, { items: list, value: fundItemsSum(list) || null }));
  const setItem = (i, patch) => setItems(items.map((x, j) => (j === i ? Object.assign({}, x, patch) : x)));
  const pickProd = (i, code) => { const pr = fundProdOf(code); setItem(i, { code, price: pr ? pr.price : null, name: pr ? undefined : (items[i].name || '') }); };
  const setMode = (m) => setD(o => {
    const n = Object.assign({}, o, { valueMode: m });
    if (m === 'items') { if (!(n.items || []).length) n.items = [newItem()]; n.value = fundItemsSum(n.items) || null; }
    return n;
  });
  const save = () => onSave(byItems ? Object.assign({}, d, { value: fundItemsSum(items) }) : Object.assign({}, d, { valueMode: 'amount', items: undefined }));
  const ok = String(d.name || '').trim() && Number(byItems ? fundItemsSum(items) : d.value) > 0;
  const seg = (m, t) => <button type="button" className={'btn btn-sm' + ((m === 'items') === byItems ? ' btn-primary' : '')} disabled={!canEdit} onClick={() => setMode(m)}>{t}</button>;
  return (
    <Modal open onClose={onClose} title={row.id ? 'แก้ไขโครงการใน Pipeline' : 'เพิ่มโครงการใน Pipeline'} maxWidth={720}
      footer={<div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <div>{row.id && canEdit && <button className="btn btn-danger" onClick={() => onDelete(row)}>ลบแถวนี้</button>}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          {canEdit && <button className="btn btn-primary" disabled={!ok} onClick={save}>บันทึก</button>}
        </div>
      </div>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        {field('ชื่อโครงการ *', <input className="input" disabled={!canEdit} value={d.name || ''} onChange={e => set('name', e.target.value)} />)}
        {field('รหัสโครงการ', <input className="input" disabled={!canEdit} value={d.code || ''} onChange={e => set('code', e.target.value)} />)}
        {field(<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>มูลค่าสัญญา (บาท) *<span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>{seg('amount', 'กรอกยอดเงิน')}{seg('items', 'ใส่เป็นผลิตภัณฑ์')}</span></span>,
          byItems
            ? <div className="input" style={{ textAlign: 'right', fontWeight: 700, background: 'var(--ink-50)' }}>{fundB(fundItemsSum(items))}</div>
            : <FundNum width="100%" disabled={!canEdit} value={d.value} onChange={v => set('value', v)} />,
          byItems ? 'รวมจากผลิตภัณฑ์ข้างล่าง' : null)}
        {byItems && (
          <div style={{ gridColumn: '1 / -1', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            <table className="fund-tbl">
              <thead><tr><th>ผลิตภัณฑ์</th><th>จำนวน (ชุด)</th><th>ราคาต่อชุด</th><th>รวม</th><th /></tr></thead>
              <tbody>
                {items.map((x, i) => {
                  const pr = fundProdOf(x.code);
                  return (
                    <tr key={i}>
                      <td>
                        <select className="select input" disabled={!canEdit} value={pr ? x.code : 'other'} onChange={e => pickProd(i, e.target.value)} style={{ padding: '3px 6px', fontSize: 12.5, maxWidth: 260 }}>
                          {FUND_PROD_GROUPS.map(g => <optgroup key={g} label={g}>{FUND_PRODUCTS.filter(y => y.group === g).map(y => <option key={y.code} value={y.code}>{y.name}</option>)}</optgroup>)}
                          <option value="other">อื่นๆ (พิมพ์ชื่อเอง)</option>
                        </select>
                        {!pr && <input className="input" disabled={!canEdit} value={x.name || ''} placeholder="ชื่อผลิตภัณฑ์" onChange={e => setItem(i, { name: e.target.value })} style={{ marginLeft: 6, width: 150, padding: '3px 6px', fontSize: 12.5 }} />}
                      </td>
                      <td style={{ textAlign: 'right' }}><FundNum disabled={!canEdit} value={x.qty} onChange={v => setItem(i, { qty: v })} width={70} /></td>
                      <td style={{ textAlign: 'right' }}><FundNum disabled={!canEdit} value={x.price} onChange={v => setItem(i, { price: v })} width={120} />
                        {pr && Number(x.price) !== pr.price && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>ราคากลาง {fundB(pr.price)}</div>}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fundB(fundItemSum(x))}</td>
                      <td>{canEdit && items.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setItems(items.filter((_, j) => j !== i))}>ลบ</button>}</td>
                    </tr>
                  );
                })}
                <tr className="total"><td>รวม {fmtNum(items.reduce((a, x) => a + (Number(x.qty) || 0), 0), 0)} ชุด</td><td /><td /><td style={{ textAlign: 'right', fontWeight: 700 }}>{fundB(fundItemsSum(items))}</td><td /></tr>
              </tbody>
            </table>
            {canEdit && <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" className="btn btn-sm" onClick={() => setItems(items.concat([newItem()]))}>＋ เพิ่มผลิตภัณฑ์</button>
              <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>ราคาเริ่มจากไฟล์ราคาผลิตภัณฑ์ WATER POG แก้ได้ในแถวนี้</span>
            </div>}
          </div>
        )}
        {field('กลุ่ม', <select className="select input" disabled={!canEdit} value={d.group || 'soon'} onChange={e => set('group', e.target.value)}>
          {FUND_GROUPS.map(g => <option key={g.k} value={g.k}>{g.t}</option>)}
        </select>, d.group === 'unsure' ? 'ยังไม่แน่นอน = ไม่นับในประมาณการ' : d.group === 'signed' ? 'เซ็นแล้ว = นับแค่เงินรับและเงินกู้ (ค่าคอม/ADV./หลักประกันจ่ายไปแล้ว)' : null)}
        {field('วันคาดว่าจะเซ็น', date('signDate'))}
        {d.type ? field('Type (หน้าโครงการ)', <div className="input" style={{ background: 'var(--ink-50)' }}>{d.type}{d.province ? ' · ' + d.province : ''}</div>) : null}
        {fc && (() => {
          const custom = Array.isArray(d.inst) && d.inst.length > 0, drinkAuto = fundFcDrinkAuto(d);
          const inst = fundFcInst(d, fc);
          const setInst = (list) => set('inst', list);
          const sched = d.signDate ? fundFcSched(Object.assign({}, d, { payDate: '' }), fc, '0000-00-00') : [];
          return (
            <div style={{ gridColumn: '1 / -1', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={lab}>รับเงินจากราชการ</span>
                {fundFcIsDrink(d) && <button type="button" disabled={!canEdit} className={'btn btn-sm' + (drinkAuto ? ' btn-primary' : '')}
                  onClick={() => setD(o => Object.assign({}, o, { payTypeSet: undefined, inst: undefined }))}>POG Drink งวดเดียว</button>}
                {fc.payTypes.map(t => <button key={t.id} type="button" disabled={!canEdit} className={'btn btn-sm' + (!custom && !drinkAuto && (d.payType || fc.payTypes[0].id) === t.id ? ' btn-primary' : '')}
                  onClick={() => setD(o => Object.assign({}, o, { payType: t.id, payTypeSet: fundFcIsDrink(o) ? true : undefined, inst: undefined }))}>{t.name}</button>)}
                <button type="button" disabled={!canEdit} className={'btn btn-sm' + (custom ? ' btn-primary' : '')} onClick={() => { if (!custom) setInst(inst.map(x => ({ d: x.d, p: x.p }))); }}>ปรับเฉพาะโครงการนี้</button>
              </div>
              {custom
                ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {d.inst.map((x, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-600)', flexWrap: 'wrap' }}>
                        <b style={{ minWidth: 64 }}>{d.inst.length === 1 ? 'งวดเดียว' : i === d.inst.length - 1 ? 'งวดสุดท้าย' : 'งวด ' + (i + 1)}</b>
                        วันที่ <FundNum disabled={!canEdit} value={x.d} onChange={v => setInst(d.inst.map((y, j) => (j === i ? Object.assign({}, y, { d: v }) : y)))} width={64} /> หลังเซ็น
                        ได้ <FundNum disabled={!canEdit} value={x.p} onChange={v => setInst(d.inst.map((y, j) => (j === i ? Object.assign({}, y, { p: v }) : y)))} width={56} /> %
                        {sched[i] && <span style={{ color: 'var(--ink-500)' }}>→ {fmtDate(sched[i].date)}</span>}
                        {canEdit && d.inst.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setInst(d.inst.filter((_, j) => j !== i))}>ลบ</button>}
                      </div>
                    ))}
                    {canEdit && <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={() => setInst(d.inst.concat([{ d: (Number(d.inst[d.inst.length - 1].d) || 0) + 60, p: 0 }]))}>＋ เพิ่มงวด</button>
                      <button type="button" className="btn btn-sm" onClick={() => setD(o => Object.assign({}, o, { inst: undefined }))}>กลับไปใช้ตามแบบ</button>
                    </div>}
                    {Math.abs(d.inst.reduce((s, x) => s + (Number(x.p) || 0), 0) - 100) > 0.5 && <span style={{ fontSize: 11.5, color: '#92400e' }}>รวมได้ {fmtNum(d.inst.reduce((s, x) => s + (Number(x.p) || 0), 0), 0)}% — ระบบจะเกลี่ยให้ครบ 100%</span>}
                  </div>
                : <div style={{ fontSize: 12.5, color: 'var(--ink-600)' }}>{fundFcInstText(inst)}{sched.length ? ' → ' + sched.map(s => fmtDate(s.date)).join(' · ') : ''} <span style={{ color: 'var(--ink-400)' }}>(แก้แบบได้ที่ "เงื่อนไขที่ใช้คิด")</span></div>}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-600)', flexWrap: 'wrap' }}>
                หรือรู้วันจ่ายแน่นอน <input className="input" type="date" disabled={!canEdit} value={d.payDate || ''} onChange={e => set('payDate', e.target.value)} style={{ padding: '3px 6px' }} />
                <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>ใส่แล้วนับเป็นงวดเดียววันนั้น · ใบแจ้งหนี้ที่ออกแล้วไม่บวกซ้ำ</span>
              </label>
            </div>
          );
        })()}
        {fc && (() => {
          const adv = fundFcInstall(Object.assign({}, d, { instAmt: null, items, valueMode: byItems ? 'items' : 'amount' }), fc);
          const own = fundN(d.instAmt) != null ? fundFcInstall(Object.assign({}, d, { items, valueMode: byItems ? 'items' : 'amount' }), fc) : null, ins = own || adv;
          return (
            <React.Fragment>
              {/* BIO: ไม่มีเบิก LIT */}
              {field('ค่าติดตั้งทั้งโครงการ (บาท)', <FundNum width="100%" disabled={!canEdit} value={d.instAmt} onChange={v2 => set('instAmt', v2)} placeholder={adv.total > 0 ? 'ตามผลิตภัณฑ์ ' + fundB(adv.total) : 'ยังไม่รู้'} />,
                ins.total > 0 ? 'ADV. ' + fundB(ins.adv) + (ins.i1 > 0.5 ? ' · งวด 1 ' + fundB(ins.i1) : '') + ' · งวดสุดท้าย ' + fundB(ins.i2) + (own ? ' · ลบให้ว่าง = คิดจากผลิตภัณฑ์' : '') + (!own && adv.unk.length ? ' · ยังไม่รู้ของ ' + adv.unk.join(', ') : '')
                  : adv.unk.length ? 'ยังไม่รู้ค่าติดตั้งของ ' + adv.unk.join(', ') + ' — ใส่ยอดเองได้' : 'คิดจากผลิตภัณฑ์ × ค่าติดตั้งต่อชุด')}
            </React.Fragment>
          );
        })()}
        {field('หมายเหตุ', <input className="input" disabled={!canEdit} value={d.note || ''} onChange={e => set('note', e.target.value)} />)}
      </div>
    </Modal>
  );
}

/* ── นำเข้าไฟล์ฝ่ายขาย (govsales "contract_forecast" · ผู้ใช้ 2026-11-11 "ข้อมูลของฝ่ายขาย ใช้หน้า POG") ──
 *   หาแถวหัวตารางจากชื่อคอลัมน์ (ชื่อโครงการ + มูลค่าโครงการ) ในชีตที่เลือก (ค่าเริ่ม POG) · 1 แถว = 1 โครงการ · จับคู่กับ Pipeline เดิมด้วยรหัสโครงการ
 *   วันที่คาดว่าจะลงนามในไฟล์เป็นวันที่ Excel ที่ใส่ปี พ.ศ. (ปี 2569) บางแถวเป็นข้อความ dd/mm/2570 → แปลงเป็น ค.ศ. (fundFcXlDate)
 *   รหัสผลิตภัณฑ์ในไฟล์ PIIS / PII / STIIS = POG TANK II+Solar / POG TANK II / S TANK II+Solar ในระบบ (fundFcProdCode)
 *   นำเข้าซ้ำ: อัปเดตชื่อ มูลค่า ผลิตภัณฑ์ วันเซ็น หมายเหตุ · คงค่าที่ตั้งเองไว้ (กลุ่ม แบบรับเงิน เบิก LIT ค่าติดตั้งที่ใส่เอง)
 *   แถวที่เคยนำเข้าแต่ไม่อยู่ในไฟล์ใหม่ = "หายจากไฟล์" ค่าเริ่มไม่ลบ (อาจเซ็นแล้วหรือย้ายชีต) ติ๊กเองถ้าจะลบ */
function fundFcXlDate(v) {
  const fix = (y, m, d) => { if (y > 2400) y -= 543; if (!(y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return ''; return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); };
  if (v instanceof Date && !isNaN(v)) return fix(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number' && window.XLSX && XLSX.SSF) { const p = XLSX.SSF.parse_date_code(v); return p ? fix(p.y, p.m, p.d) : ''; }
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { let y = Number(m[3]); if (y < 100) y += y > 50 ? 2500 : 2000; return fix(y, Number(m[2]), Number(m[1])); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? fix(Number(m[1]), Number(m[2]), Number(m[3])) : '';
}
function fundFcProdCode(code, text) {
  const c = String(code || '').toUpperCase().replace(/\s+/g, '');
  const alias = { PIIS: 'PTII+S', 'PII+S': 'PTII+S', PII: 'PTIIS', STIIS: 'STII+S', 'STII+S': 'STII+S', STII: 'STII' };
  if (alias[c]) return alias[c];
  if (fundProdOf(c)) return c;
  const t = String(text || '').toUpperCase().replace(/\s+/g, ' ');
  if (/TANK II/.test(t)) return /SOLAR/.test(t) ? (/STANK|S TANK/.test(t) ? 'STII+S' : 'PTII+S') : (/STANK|S TANK/.test(t) ? 'STII' : 'PTIIS');
  if (/DRINK/.test(t)) return /PLUS/.test(t) ? 'PDP' : /HOUSE/.test(t) ? 'PDH' : 'PD';
  return '';
}
function fundFcParseSales(wb, sheet) {
  const ws = wb.Sheets[sheet];
  if (!ws) return { err: 'ไม่พบชีต ' + sheet, rows: [] };
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const norm = (x) => String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase();
  const hi = aoa.findIndex(r => r.some(c => norm(c) === 'ชื่อโครงการ') && r.some(c => norm(c) === 'มูลค่าโครงการ'));
  if (hi < 0) return { err: 'ไม่พบหัวตาราง (ชื่อโครงการ / มูลค่าโครงการ) ในชีต ' + sheet, rows: [] };
  const H = aoa[hi].map(norm);
  const col = (...names) => { for (const n of names) { const i = H.indexOf(norm(n)); if (i >= 0) return i; } return -1; };
  const C = { name: col('ชื่อโครงการ'), area: col('รายละเอียดพื้นที่'), value: col('มูลค่าโครงการ'), prodT: col('ผลิตภัณฑ์'), org: col('อปท.', 'อปท'), budget: col('SOLA/BBL'),
    code: col('รหัสโครงการ'), sub: col('บริษัท SUB', 'บริษัทSUB'), prov: col('จังหวัด'), prodC: col('ผลิตภัณฑ์ (รหัส)', 'ผลิตภัณฑ์(รหัส)'), sign: col('วันที่คาดว่าจะลงนาม'),
    why: col('เหตุผลที่ล่าช้า (ก่อนสัญญา)', 'เหตุผลที่ล่าช้า'), note: col('หมายเหตุก่อนสัญญา') };
  if (C.sign < 0) return { err: 'ไม่พบคอลัมน์ "วันที่คาดว่าจะลงนาม"', rows: [] };
  const g = (r, k) => (C[k] >= 0 ? r[C[k]] : '');
  const rows = [];
  aoa.slice(hi + 1).forEach((r, i) => {
    const name = String(g(r, 'name') || '').trim(), value = Number(String(g(r, 'value')).replace(/[,\s]/g, '')) || 0;
    if (!name || !(value > 0)) return;
    const pc = fundFcProdCode(g(r, 'prodC'), g(r, 'prodT')), pr = fundProdOf(pc);
    let qty = 1, price = value;
    if (pr) { const q = value / pr.price; if (Math.round(q) >= 1 && Math.abs(q - Math.round(q)) < 0.01) { qty = Math.round(q); price = value / qty; } }
    const org = String(g(r, 'org') || '').trim();
    rows.push({ line: hi + i + 2, code: String(g(r, 'code') || '').trim(), name: (org ? org + ' — ' : '') + name, full: name, value, signDate: fundFcXlDate(g(r, 'sign')), signRaw: g(r, 'sign'),
      items: [pr ? { code: pc, qty, price } : { code: 'other', name: String(g(r, 'prodT') || 'ไม่ระบุ'), qty: 1, price: value }], prodOk: !!pr,
      type: String(g(r, 'prodT') || '').trim(), province: String(g(r, 'prov') || '').trim(), org, budget: String(g(r, 'budget') || '').trim(), sub: String(g(r, 'sub') || '').trim(),
      area: String(g(r, 'area') || '').trim(), note: [g(r, 'why'), g(r, 'note')].map(x => String(x || '').trim()).filter(Boolean).join(' — ') });
  });
  return { rows, header: hi + 1 };
}
function FundSalesImportModal({ pipe, fc, canEdit, onApply, onClose }) {
  const [wb, setWb] = React.useState(null);
  const [file, setFile] = React.useState('');
  const [sheet, setSheet] = React.useState('');
  const [payType, setPayType] = React.useState(fc.payTypes[0].id);
  const [drop, setDrop] = React.useState({});
  const [err, setErr] = React.useState('');
  const read = (f) => {
    if (!f) return;
    setErr(''); setFile(f.name);
    const rd = new FileReader();
    rd.onload = (e) => {
      try {
        const w = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        setWb(w);
        setSheet(w.SheetNames.find(n => /^pog$/i.test(n.trim())) || w.SheetNames[0]);
      } catch (x) { setErr('อ่านไฟล์ไม่ได้: ' + (x && x.message)); }
    };
    rd.readAsArrayBuffer(f);
  };
  const parsed = React.useMemo(() => (wb && sheet ? fundFcParseSales(wb, sheet) : null), [wb, sheet]);
  const plan = React.useMemo(() => {
    if (!parsed || parsed.err) return null;
    const byCode = {};
    pipe.forEach(r => { const k = fundCode(r.code); if (k) byCode[k] = r; });
    const seen = new Set(), add = [], upd = [], same = [], dup = [];
    parsed.rows.forEach(x => {
      const k = fundCode(x.code);
      if (k && seen.has(k)) { dup.push(x); return; }
      if (k) seen.add(k);
      const old = k ? byCode[k] : null;
      if (!old) { add.push(x); return; }
      const ch = [];
      if ((old.signDate || '') !== x.signDate) ch.push('วันเซ็น ' + (old.signDate ? fmtDate(old.signDate) : '—') + ' → ' + (x.signDate ? fmtDate(x.signDate) : '—'));
      if (Math.abs((Number(old.value) || 0) - x.value) > 0.5) ch.push('มูลค่า ' + fundB(old.value) + ' → ' + fundB(x.value));
      if ((old.note || '') !== x.note) ch.push('หมายเหตุ');
      (ch.length ? upd : same).push(Object.assign({}, x, { old, ch }));
    });
    const gone = pipe.filter(r => r.src === 'govsales' && fundCode(r.code) && !seen.has(fundCode(r.code)));
    return { add, upd, same, dup, gone };
  }, [parsed, pipe]);
  const sum = (arr) => arr.reduce((s, x) => s + (Number(x.value) || 0), 0);
  const okRows = parsed && !parsed.err ? parsed.rows : [];
  const noDate = okRows.filter(x => !x.signDate).length, noProd = okRows.filter(x => !x.prodOk).length;
  const nDrop = plan ? plan.gone.filter(r => drop[r.id]).length : 0;
  const apply = () => onApply(plan, { payType, drop: plan.gone.filter(r => drop[r.id]), file });
  const th = { textAlign: 'left', padding: '5px 8px', fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 600, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: '#fff' };
  const td = { padding: '5px 8px', borderBottom: '1px solid var(--line-soft)', fontSize: 12.5 };
  return (
    <Modal open onClose={onClose} title="นำเข้าโครงการจากไฟล์ฝ่ายขาย" maxWidth={920}
      footer={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
        <button className="btn" onClick={onClose}>ยกเลิก</button>
        {canEdit && <button className="btn btn-primary" disabled={!plan || !(plan.add.length + plan.upd.length + nDrop)} onClick={apply}>
          นำเข้า{plan ? ' (ใหม่ ' + plan.add.length + ' · อัปเดต ' + plan.upd.length + (nDrop ? ' · ลบ ' + nDrop : '') + ')' : ''}</button>}
      </div>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', fontSize: 13, marginBottom: 10 }}>
        <input type="file" accept=".xlsx,.xls" onChange={e => read(e.target.files && e.target.files[0])} />
        {wb && <label>ชีต <select className="select input" value={sheet} onChange={e => setSheet(e.target.value)} style={{ padding: '3px 6px', width: 'auto' }}>{wb.SheetNames.map(n => <option key={n} value={n}>{n}</option>)}</select></label>}
        {wb && <label>โครงการใหม่รับเงินแบบ <select className="select input" value={payType} onChange={e => setPayType(e.target.value)} style={{ padding: '3px 6px', width: 'auto' }}>{fc.payTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      </div>
      {!wb && <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>ไฟล์ Excel จากฝ่ายขาย (แบบ govsales contract_forecast) · เลือกชีตได้ · อ่านจากชื่อคอลัมน์ (ชื่อโครงการ · มูลค่าโครงการ · ผลิตภัณฑ์ (รหัส) · รหัสโครงการ · วันที่คาดว่าจะลงนาม)</div>}
      {err && <div style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</div>}
      {parsed && parsed.err && <div style={{ color: 'var(--bad)', fontSize: 13 }}>{parsed.err}</div>}
      {plan && (
        <React.Fragment>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <FundChip t={'ทั้งไฟล์ ' + okRows.length + ' โครงการ · ' + fundM(sum(okRows))} />
            <FundChip t={'ใหม่ ' + plan.add.length + ' · ' + fundM(sum(plan.add))} tone="good" />
            <FundChip t={'อัปเดต ' + plan.upd.length} tone={plan.upd.length ? 'warn' : undefined} />
            <FundChip t={'เหมือนเดิม ' + plan.same.length} />
            {plan.gone.length > 0 && <FundChip t={'หายจากไฟล์ ' + plan.gone.length} tone="bad" />}
            {noDate > 0 && <FundChip t={noDate + ' โครงการไม่มีวันเซ็น'} tone="warn" />}
            {noProd > 0 && <FundChip t={noProd + ' โครงการไม่รู้จักผลิตภัณฑ์'} tone="warn" />}
            {plan.dup.length > 0 && <FundChip t={'รหัสซ้ำในไฟล์ ' + plan.dup.length + ' (ใช้แถวแรก)'} tone="warn" />}
          </div>
          <div style={{ maxHeight: 380, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}><tr><th style={th}></th><th style={th}>รหัส</th><th style={th}>โครงการ</th><th style={th}>ผลิตภัณฑ์</th><th style={{ ...th, textAlign: 'right' }}>มูลค่า</th><th style={th}>วันเซ็น</th></tr></thead>
              <tbody>
                {plan.add.concat(plan.upd).map((x, i) => (
                  <tr key={i}>
                    <td style={td}>{x.old ? <FundChip t="อัปเดต" tone="warn" /> : <FundChip t="ใหม่" tone="good" />}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 11.5 }}>{x.code || '—'}</td>
                    <td style={{ ...td, maxWidth: 340 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.full}>{x.name}</div>{x.ch && <div style={{ fontSize: 11, color: '#92400e' }}>{x.ch.join(' · ')}</div>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 11.5 }}>{x.prodOk ? fundItemName(x.items[0]) + (x.items[0].qty > 1 ? ' × ' + x.items[0].qty : '') : <span style={{ color: '#92400e' }}>{x.type || 'ไม่ระบุ'}</span>}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fundB(x.value)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{x.signDate ? fmtDate(x.signDate) : <span style={{ color: '#92400e' }}>{String(x.signRaw || '—')}</span>}</td>
                  </tr>
                ))}
                {plan.gone.map(r => (
                  <tr key={r.id} style={{ background: '#FFF7F5' }}>
                    <td style={td}><label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11.5, whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!drop[r.id]} onChange={e => setDrop(o => Object.assign({}, o, { [r.id]: e.target.checked }))} />ลบ</label></td>
                    <td style={{ ...td, fontSize: 11.5 }}>{r.code}</td>
                    <td style={{ ...td, maxWidth: 340 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div><div style={{ fontSize: 11, color: 'var(--bad)' }}>หายจากไฟล์ — อาจเซ็นแล้วหรือย้ายไปชีตอื่น ติ๊ก "ลบ" ถ้าจะเอาออก</div></td>
                    <td style={{ ...td, fontSize: 11.5 }}>{fundItemsText(r)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fundB(r.value)}</td>
                    <td style={td}>{r.signDate ? fmtDate(r.signDate) : '—'}</td>
                  </tr>
                ))}
                {!plan.add.length && !plan.upd.length && !plan.gone.length && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--ink-500)', padding: 16 }}>ข้อมูลตรงกับที่มีอยู่แล้วทั้งหมด</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 8, lineHeight: 1.6 }}>
            โครงการใหม่เข้ากลุ่ม "กำลังจะเซ็น" · ยังไม่ติ๊กเบิก LIT · นำเข้าซ้ำ = อัปเดตตามรหัสโครงการ แต่ไม่ทับกลุ่ม แบบรับเงิน การเบิก LIT และค่าติดตั้งที่ตั้งเองไว้
          </div>
        </React.Fragment>
      )}
    </Modal>
  );
}

/* ── นำเข้าไฟล์ดอกเบี้ย Incofin (ผู้ใช้ 2026-11-11 "ดอกเบี้ยให้ใช้ข้อมูลตามไฟล์เพราะคำนวณใหม่แล้ว ต้องคิดตามนี้และจ่ายวันตามนี้") ──
 *   ไฟล์ "07.WTP-Incofin_v11_เพิ่มชีท1ล้าน.xlsx": 1 ชีต = 1 สัญญา · หัวตารางมี "Payment Date" · ยอดจ่าย = คอลัมน์ "Installment (สุทธิ)"
 *   หรือคอลัมน์ไม่มีชื่อถัดจาก "Int. amount" (ชีต 3 ล้าน) · แถวที่มีวันจ่ายแต่ไม่มียอด = วันทบต้น ไม่ใช่เงินออก · "รับคืน WHT" = เงินเข้า ไม่นับ
 *   จับคู่สัญญาด้วยวงเงิน (แถว "วงเงินกู้") กับ debtMaster หมวด Incofin · ชีตเก่า (เช่น "1.-" 4,000,100) ไม่ตรงสัญญาไหน = ไม่ใช้
 *   เก็บใน manualOverrides key "fund.incsched" = { file, at, sheets: [{ sheet, no, principal, cycle, pays: [{ date, amt, pri, note, refund }] }] } */
const FUND_INC_KEY = 'fund.incsched';
function fundFcParseIncofin(wb, masters) {
  const out = [];
  wb.SheetNames.forEach(n => {
    const ws = wb.Sheets[n];
    if (!ws || !ws['!ref']) return;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const hi = aoa.findIndex(r => r.some(c => String(c).trim() === 'Payment Date'));
    if (hi < 0) return;
    const H = aoa[hi].map(c => String(c).trim());
    const pc = H.indexOf('Payment Date'), ic = H.findIndex(h => /^installment/i.test(h)), ia = H.indexOf('Int. amount'), ppc = H.indexOf('Principal paid'), nc = H.indexOf('หมายเหตุ');
    const ac = ic >= 0 ? ic : (ia >= 0 && !H[ia + 1] ? ia + 1 : -1);
    if (ac < 0) return;
    const top = aoa.slice(0, hi);
    const numAfter = (label) => { const r = top.find(x => String(x[0]).trim().indexOf(label) === 0); return r ? r.slice(1).find(v => typeof v === 'number') : null; };
    const principal = numAfter('วงเงินกู้');
    const cycle = (top.reduce((a, r) => a.concat(r), []).find(v => /จ่ายดอกเบี้ย/.test(String(v))) || '').toString().replace(/^\*/, '').trim();
    const pays = [];
    aoa.slice(hi + 1).forEach(r => {
      const d = fundFcXlDate(r[pc]), a = Number(r[ac]) || 0;
      if (!d || !(a > 0.005)) return;
      const note = nc >= 0 ? String(r[nc] || '').trim() : '', pri = ppc >= 0 ? Number(r[ppc]) || 0 : 0;
      pays.push({ date: d, amt: Math.round(a * 100) / 100, pri: pri > 0 ? Math.round(pri * 100) / 100 : 0, note, refund: /รับคืน/.test(note) });
    });
    const cand = (masters || []).filter(m => principal != null && Math.abs((Number(m.principalAmount) || Number(m.balance) || 0) - principal) < 1);
    out.push({ sheet: n, name: String((aoa[1] || [])[0] || '').trim(), principal, cycle, pays, no: cand.length === 1 ? cand[0].contractNo : '' });
  });
  return out;
}
function FundIncImportModal({ masters, canEdit, onApply, onClose }) {
  const [file, setFile] = React.useState('');
  const [sheets, setSheets] = React.useState(null);
  const [err, setErr] = React.useState('');
  const today = bdISO(new Date());
  const read = (f) => {
    if (!f) return;
    setErr(''); setFile(f.name);
    const rd = new FileReader();
    rd.onload = (e) => {
      try { setSheets(fundFcParseIncofin(XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true }), masters)); }
      catch (x) { setErr('อ่านไฟล์ไม่ได้: ' + (x && x.message)); }
    };
    rd.readAsArrayBuffer(f);
  };
  const setNo = (i, no) => setSheets(list => list.map((s, j) => (j === i ? Object.assign({}, s, { no }) : no && s.no === no ? Object.assign({}, s, { no: '' }) : s)));
  const used = (sheets || []).filter(s => s.no);
  const td = { padding: '6px 8px', borderBottom: '1px solid var(--line-soft)', fontSize: 12.5, verticalAlign: 'top' };
  return (
    <Modal open onClose={onClose} title="นำเข้าไฟล์ดอกเบี้ย Incofin" maxWidth={860}
      footer={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
        <button className="btn" onClick={onClose}>ยกเลิก</button>
        {canEdit && <button className="btn btn-primary" disabled={!used.length} onClick={() => onApply({ file, at: today, sheets: used })}>ใช้ไฟล์นี้ ({used.length} สัญญา)</button>}
      </div>}>
      <div style={{ marginBottom: 10 }}><input type="file" accept=".xlsx,.xls" onChange={e => read(e.target.files && e.target.files[0])} /></div>
      {!sheets && <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>ไฟล์คุมดอกเบี้ย Incofin (เช่น 07.WTP-Incofin_v11) · อ่านทุกชีตที่มีคอลัมน์ "Payment Date" · ยอดจ่ายและวันจ่ายตามไฟล์ แทนตารางดอกเบี้ยในระบบ</div>}
      {err && <div style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</div>}
      {sheets && !sheets.length && <div style={{ color: 'var(--bad)', fontSize: 13 }}>ไม่พบชีตที่มีคอลัมน์ "Payment Date"</div>}
      {sheets && sheets.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['ชีต', 'วงเงิน', 'รอบ', 'วันจ่าย / ยอด (งวดที่ยังไม่ถึง)', 'ใช้กับสัญญา'].map(t => <th key={t} style={{ textAlign: 'left', padding: '5px 8px', fontSize: 11.5, color: 'var(--ink-500)', borderBottom: '1px solid var(--line)' }}>{t}</th>)}</tr></thead>
          <tbody>
            {sheets.map((s, i) => {
              const next = s.pays.filter(p => !p.refund && p.date >= today);
              return (
                <tr key={s.sheet} style={{ opacity: s.no ? 1 : 0.6 }}>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{s.sheet}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.principal != null ? fundB(s.principal) : '—'}</td>
                  <td style={{ ...td, fontSize: 11.5 }}>{s.cycle || '—'}</td>
                  <td style={{ ...td, fontSize: 11.5 }}>{next.slice(0, 4).map(p => fmtDate(p.date) + ' · ' + fmtNum(p.amt, 2) + (p.pri ? ' (เงินต้น ' + fmtNum(p.pri, 2) + ')' : '')).join(' / ') || 'ไม่มีงวดที่ยังไม่ถึง'}{next.length > 4 ? ' … อีก ' + (next.length - 4) + ' งวด' : ''}</td>
                  <td style={td}>
                    <select className="select input" disabled={!canEdit} value={s.no} onChange={e => setNo(i, e.target.value)} style={{ padding: '3px 6px', fontSize: 12, width: 'auto' }}>
                      <option value="">ไม่ใช้ชีตนี้</option>
                      {(masters || []).map(m => <option key={m.id} value={m.contractNo}>{m.contractNo} · {debtCur(m)} {fundB(Number(m.principalAmount) || Number(m.balance) || 0)}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 8, lineHeight: 1.6 }}>
        จับคู่ชีตกับสัญญาให้เองด้วยวงเงิน (ชีตเก่าที่วงเงินไม่ตรงสัญญาไหน = ไม่ใช้) · ยอดเป็นสกุลของสัญญา คูณอัตราแลกเปลี่ยนที่ตั้งไว้ · แถวที่มีวันแต่ไม่มียอด = วันทบต้น ไม่ใช่เงินออก · "รับคืน WHT" ไม่นับเป็นเงินออก
      </div>
    </Modal>
  );
}

/* เลือกโครงการจากหน้าโครงการ: รอลงนาม + เซ็นแล้วที่ยังเก็บเงินไม่ครบ (มีผู้รับโอนสิทธิแล้ว = เพิ่มเป็นเงินค้างรับ ไม่ใช่สัญญาใหม่) */
function FundPickModal({ data, taken, onPick, onClose }) {
  const [q, setQ] = React.useState('');
  const list = React.useMemo(() => {
    if (!window.PCU) return [];
    return window.PCU.deriveProjects(data.projects || [], data.invoices || [], data.receipts || [], data.debtMaster || [])
      .filter(p => p.status === 'ยังไม่ลงนาม' || (p.status === 'Work in progress' && p.outstandingAR > 0))
      .sort((a, b) => (a.status === b.status ? (b.contractAmt || 0) - (a.contractAmt || 0) : a.status === 'ยังไม่ลงนาม' ? 1 : -1));
  }, []);
  const hits = list.filter(p => !q.trim() || (p.name + ' ' + p.contractNo + ' ' + p.province).toLowerCase().indexOf(q.trim().toLowerCase()) >= 0).slice(0, 120);
  return (
    <Modal open onClose={onClose} title="เลือกจากโครงการในระบบ" maxWidth={820}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginBottom: 8 }}>โครงการที่เซ็นแล้วและยังเก็บเงินไม่ครบ กับโครงการรอลงนาม · {list.length} โครงการ</div>
      <input className="input" autoFocus placeholder="ค้นหาชื่อ / เลขสัญญา / จังหวัด" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {hits.map(p => {
          const isTaken = taken.has(p.id) || (!!p.contractNo && taken.has('c:' + fundCode(p.contractNo)));
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--ink-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{p.type ? p.type + ' · ' : ''}{p.status === 'ยังไม่ลงนาม' ? 'รอลงนาม · ' + (p.projectStatus || '') :(p.assignee ? 'เซ็นแล้ว · มีผู้รับโอนสิทธิแล้ว' : 'เซ็นแล้ว · ยังไม่มีผู้รับโอนสิทธิ') + ' · ค้างรับ ' + fundB(p.outstandingAR)} · {p.province}</div>
              </div>
              <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, whiteSpace: 'nowrap' }}>{fundB(p.contractAmt || p.allocation || 0)}</div>
              <button className="btn btn-sm" disabled={isTaken} onClick={() => onPick(p)}>{isTaken ? 'เพิ่มแล้ว' : '＋ เพิ่ม'}</button>
            </div>
          );
        })}
        {!hits.length && <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-500)', fontSize: 13 }}>ไม่พบโครงการ</div>}
      </div>
    </Modal>
  );
}
/* ที่มาของตัวเลขในแถว: รายการทีละบรรทัด (กดดูวิธีคิด) กรองรายเดือนได้ · ยอดที่แก้เองบอกไว้ด้านบน */
function FundFcSrcModal({ title, how, items, F, sys, ovr, head, extra, canEdit, onClearOvr, onClose }) {   // extra = { th, cell(item) } คอลัมน์เพิ่ม (ค่าติดตั้งที่ต้องจ่ายตามเงินรับ)
  const [mk, setMk] = React.useState('');
  const [openI, setOpenI] = React.useState(-1);
  const list = (items || []).filter(it => !mk || String(it.date).slice(0, 7) === mk).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || b.amt - a.amt);
  const sum = (arr) => arr.reduce((s, it) => s + (it.amt || 0), 0);
  const ovKeys = Object.keys(ovr || {}).filter(k => F.indexOf(k) >= 0);
  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 600, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
  const td = { padding: '6px 8px', borderBottom: '1px solid var(--line-soft)' };
  return (
    <BDAFShell title={title} sub={how} onClose={onClose}>
      {head}
      {ovKeys.length > 0 && (
        <div style={{ margin: '0 0 10px', padding: '8px 12px', background: '#EEF3FD', borderRadius: 8, fontSize: 12.5, color: '#1B2A4A', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>แก้ยอดเองไว้: {ovKeys.map(k => bdafMShort(k) + ' ' + fundB(ovr[k]) + ' (ระบบคิด ' + fundB(sys[k] || 0) + ')').join(' · ')}</span>
          {canEdit && <button className="btn btn-sm" onClick={onClearOvr}>ใช้ยอดระบบทั้งแถว</button>}
        </div>
      )}
      {(items || []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <button style={bdafChip(!mk)} onClick={() => { setOpenI(-1); setMk(''); }}>ทุกเดือน · {fundM(sum(items))}</button>
          {F.map(m => { const v = sum(items.filter(it => String(it.date).slice(0, 7) === m)); return v > 0.5 ? <button key={m} style={bdafChip(mk === m)} onClick={() => { setOpenI(-1); setMk(m); }}>{bdafMShort(m)} · {bdafC(v)}</button> : null; })}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr><th style={th}>วันที่</th><th style={th}>รายการ</th><th style={th}>อ้างอิง</th><th style={{ ...th, textAlign: 'right' }}>ยอด</th>{extra && <th style={th}>{extra.th}</th>}</tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={extra ? 5 : 4} style={{ ...td, padding: 16, textAlign: 'center', color: 'var(--ink-400)' }}>ไม่มีรายการในช่วงที่ดู</td></tr>}
          {list.map((it, i) => {
            const on = openI === i;
            return (
              <React.Fragment key={i}>
                <tr onClick={() => setOpenI(on ? -1 : i)} style={{ cursor: (it.note || []).length ? 'pointer' : 'default', background: on ? 'var(--brand-50)' : undefined }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><span style={{ fontSize: 9, color: 'var(--ink-400)', display: 'inline-block', width: 12, transform: on ? 'rotate(90deg)' : 'none' }}>{(it.note || []).length ? '▶' : ''}</span>{it.date ? bdafDShort(it.date) : '—'}</td>
                  <td style={{ ...td, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.t || '—'}</td>
                  <td style={{ ...td, fontSize: 11.5, color: 'var(--ink-600)', whiteSpace: 'nowrap' }}>{it.ref || ''}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>{fundB(it.amt)}</td>
                  {extra && <td style={{ ...td, fontSize: 12 }}>{extra.cell(it)}</td>}
                </tr>
                {on && <tr><td colSpan={extra ? 5 : 4} style={{ padding: '6px 8px 10px 28px', borderBottom: '1px solid var(--line)', background: '#fbfcfd', fontSize: 12, lineHeight: 1.75, color: 'var(--ink-700)' }}>{(it.note || []).map((n, j) => <div key={j}>{n}</div>)}</td></tr>}
              </React.Fragment>
            );
          })}
          {list.length > 0 && <tr><td colSpan={3} style={{ ...td, fontWeight: 700 }}>รวม {list.length} รายการ</td><td style={{ ...td, textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fundB(sum(list))}</td>{extra && <td style={td} />}</tr>}
        </tbody>
      </table>
    </BDAFShell>
  );
}
/* เงื่อนไขที่ใช้คิด — รูปแบบรับเงิน · เงินกู้ LIT · ค่าใช้จ่ายโครงการ · ดอกเบี้ยเงินกู้เดิม */
function FundFcSettings({ fc, cfg, canEdit, setFc, setOpt, setFx, setLgFree, setLgIssue, lgBanks, lgBook, litUsed, fxCurs, incofins, incs, onIncImport }) {
  const box = { border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', minWidth: 0 };
  const h = { fontWeight: 700, fontSize: 13.5, color: 'var(--ink-800)', marginBottom: 8 };
  const line = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ink-600)', padding: '4px 0' };
  const setTypes = (list) => setFc(f => Object.assign(f, { payTypes: list }));
  const issuers = fundLgIssuers(cfg);
  const setOk = (k, v) => setFc(f => Object.assign(f, { ok: Object.assign({}, f.ok, { [k]: v }) }));
  const okChip = (k) => (
    <label style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 3, color: fc.ok[k] ? '#15803d' : '#92400e', cursor: canEdit ? 'pointer' : 'default' }}>
      <input type="checkbox" disabled={!canEdit} checked={!!fc.ok[k]} onChange={e => setOk(k, e.target.checked)} />{fc.ok[k] ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'}
    </label>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, padding: '12px 16px 16px' }}>
      <div style={box}>
        <div style={h}>รับเงินจากราชการ (แบบที่เลือกในแต่ละโครงการ)</div>
        {fc.payTypes.map((t, ti) => (
          <div key={t.id} style={{ padding: '6px 0', borderBottom: ti < fc.payTypes.length - 1 ? '1px solid var(--line-soft)' : 'none' }}>
            <div style={line}>
              <input className="input" disabled={!canEdit} value={t.name} onChange={e => setTypes(fc.payTypes.map((y, j) => (j === ti ? Object.assign({}, y, { name: e.target.value }) : y)))} style={{ width: 130, padding: '3px 6px', fontSize: 12.5, fontWeight: 700 }} />
              {canEdit && fc.payTypes.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setTypes(fc.payTypes.filter((_, j) => j !== ti))}>ลบแบบนี้</button>}
            </div>
            {t.inst.map((x, i) => {
              const setX = (patch) => setTypes(fc.payTypes.map((y, j) => (j === ti ? Object.assign({}, y, { inst: y.inst.map((z, k) => (k === i ? Object.assign({}, z, patch) : z)) }) : y)));
              return (
                <div key={i} style={line}>
                  <span style={{ minWidth: 70 }}>{t.inst.length === 1 ? 'งวดเดียว' : i === t.inst.length - 1 ? 'งวดสุดท้าย' : 'งวด ' + (i + 1)}</span>
                  วันที่ <FundNum disabled={!canEdit} value={x.d} onChange={v => setX({ d: v })} width={60} /> หลังเซ็น ได้ <FundNum disabled={!canEdit} value={x.p} onChange={v => setX({ p: v })} width={52} />%
                  {canEdit && t.inst.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setTypes(fc.payTypes.map((y, j) => (j === ti ? Object.assign({}, y, { inst: y.inst.filter((_, k) => k !== i) }) : y)))}>ลบ</button>}
                </div>
              );
            })}
            {canEdit && <button type="button" className="btn btn-sm" style={{ marginTop: 2 }} onClick={() => setTypes(fc.payTypes.map((y, j) => (j === ti ? Object.assign({}, y, { inst: y.inst.concat([{ d: (Number(y.inst[y.inst.length - 1].d) || 0) + 60, p: 0 }]) }) : y)))}>＋ งวด</button>}
          </div>
        ))}
        {canEdit && <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setTypes(fc.payTypes.concat([{ id: 't' + Date.now().toString(36), name: 'แบบใหม่', inst: [{ d: 150, p: 100 }] }]))}>＋ เพิ่มแบบการรับเงิน</button>}
        <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 6 }}>นับวันจากวันเซ็นสัญญา · ถึงวันแล้วยังไม่ได้รับ = เลื่อนไปอีก 30 วัน · หัก ณ ที่จ่าย 1% ให้แล้ว</div>
      </div>

      {/* BIO: ไม่มีกล่องเงินกู้ LIT */}
      <div style={box}>
        <div style={h}>ค่าใช้จ่ายเกี่ยวกับโครงการ</div>
        <div style={line}>ค่าคอม <FundNum disabled={!canEdit} value={fc.comm} onChange={v => setFc(f => Object.assign(f, { comm: v == null ? 0 : v }))} width={52} />% ของมูลค่าสัญญา จ่าย
          <select className="select input" disabled={!canEdit} value={fc.commAt} onChange={e => setFc(f => Object.assign(f, { commAt: e.target.value }))} style={{ padding: '2px 6px', fontSize: 12, width: 'auto' }}>
            <option value="sign">วันเซ็นสัญญา</option><option value="rcv">ตามเงินรับแต่ละงวด</option>
          </select></div>
        <div style={line}>หลักประกันสัญญา <FundNum disabled={!canEdit} value={cfg.lgPct} onChange={v => setOpt('lgPct', v == null ? 0 : v)} width={52} />% วันเซ็น · ใช้วงเงิน LG ก่อน ไม่พอวางเงินสด (1 ต่อ 1)</div>
        {lgBanks.map(b => (
          <div key={b} style={{ ...line, paddingLeft: 12 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 92 }}><input type="checkbox" disabled={!canEdit} checked={!!cfg.lgIssue[b]} onChange={e => setLgIssue(b, e.target.checked)} />{b}</label>
            {cfg.lgIssue[b] ? <>วงเงิน LG ว่าง <FundNum disabled={!canEdit} value={cfg.lgFree[b]} onChange={v => setLgFree(b, v)} placeholder="ยังไม่รู้" width={120} /> ณ {bdafDShort(cfg.lgAsOf)}</> : <span style={{ color: 'var(--ink-400)' }}>ไม่ออกใบใหม่ (ค้าง {fundM(lgBook.banks[b] || 0)})</span>}
          </div>
        ))}
        {!issuers.length && <div style={{ fontSize: 11.5, color: '#92400e' }}>ไม่มีธนาคารที่ออก LG ใบใหม่ = วางเงินสดทั้งหมด</div>}
        <div style={line}>ค่าธรรมเนียม LG <FundNum disabled={!canEdit} value={fc.lgFee.rate} onChange={v => setFc(f => Object.assign(f, { lgFee: Object.assign({}, f.lgFee, { rate: v == null ? 0 : v }) }))} width={52} />% ต่อปีของยอดค้ำ ·
          ค้ำ <FundNum disabled={!canEdit} value={fc.lgFee.yrs} onChange={v => setFc(f => Object.assign(f, { lgFee: Object.assign({}, f.lgFee, { yrs: v == null ? 2 : v }) }))} width={44} /> ปี · จ่าย
          <select className="select input" disabled={!canEdit} value={fc.lgFee.pay} onChange={e => setFc(f => Object.assign(f, { lgFee: Object.assign({}, f.lgFee, { pay: e.target.value }) }))} style={{ padding: '2px 6px', fontSize: 12, width: 'auto' }}>
            <option value="yearly">ปีละครั้ง (ล่วงหน้า)</option><option value="once">ครั้งเดียวตอนออก LG</option>
          </select>{okChip('lgFeePay')}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 4 }}>ค่าติดตั้งและค่าของโรงงานต่อชุด ตั้งในกล่อง "ผู้รับเหมา" ด้านล่าง</div>
      </div>

      <div style={Object.assign({}, box, { gridColumn: '1 / -1' })}>
        <div style={h}>ผู้รับเหมา — ค่าติดตั้ง และค่าของจากโรงงาน (ต่อชุด)</div>
        <div style={line}>ค่าติดตั้ง: ADV. จ่ายหลังเซ็น <FundNum disabled={!canEdit} value={fc.instDays} onChange={v => setFc(f => Object.assign(f, { instDays: v == null ? 0 : v }))} width={52} /> วัน
          · งวด 1 / งวดสุดท้าย จ่ายหลังรับเงินราชการงวดนั้น <FundNum disabled={!canEdit} value={fc.instPay} onChange={v => setFc(f => Object.assign(f, { instPay: v == null ? 14 : v }))} width={52} /> วัน <span style={{ color: 'var(--ink-400)' }}>(ผู้ใช้กำหนด 14 วัน)</span></div>
        <div style={line}>ค่าของโรงงาน: <b>เลือกเดือนจ่ายเอง</b> — ในตารางเริ่มที่ 0 ทุกเดือน พิมพ์ยอดลงเดือนที่จะจ่าย (ยอดต่อชุดข้างล่างใช้คิดยอดที่ต้องจ่ายทั้งหมด)</div>
        <div className="fund-wrap" style={{ marginTop: 6 }}>
          <table className="fund-tbl">
            <thead><tr><th>ผลิตภัณฑ์</th><th>ค่าติดตั้ง/ชุด</th><th className="l">แบ่งจ่ายค่าติดตั้ง</th><th>โรงงาน งวด 1</th><th>งวด 2</th><th>งวด 3</th><th>ค่าของโรงงาน/ชุด</th></tr></thead>
            <tbody>
              {FUND_PRODUCTS.map(pr => {
                const v = fundN(fc.instT[pr.code]), ph = Array.isArray(fc.fac[pr.code]) ? fc.fac[pr.code] : null;
                const setPh = (i, n) => setFc(f => { const all = Object.assign({}, f.fac), cur = (Array.isArray(all[pr.code]) ? all[pr.code] : (fc.fac[pr.code] || [0, 0, 0])).slice(); cur[i] = n == null ? 0 : n; all[pr.code] = cur; f.fac = all; return f; });
                return (
                  <tr key={pr.code}>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{pr.name}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><FundNum disabled={!canEdit} value={v} onChange={n => setFc(f => Object.assign(f, { instT: Object.assign({}, f.instT, { [pr.code]: n }) }))} placeholder="ยังไม่รู้" width={100} /></td>
                    <td style={{ fontSize: 11.5, color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>{v == null ? <span style={{ color: '#92400e' }}>ไม่นับ</span> : fundFcSplitText(fundFcInstFam(pr.code))}</td>
                    {[0, 1, 2].map(i => <td key={i} style={{ textAlign: 'right' }}><FundNum disabled={!canEdit} value={ph ? ph[i] : null} onChange={n => setPh(i, n)} placeholder="–" width={90} /></td>)}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{ph ? fundB(ph.reduce((a2, x) => a2 + (Number(x) || 0), 0)) : <span style={{ fontSize: 11, color: '#92400e' }}>ยังไม่รู้</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 6, lineHeight: 1.6 }}>
          {FUND_PRODUCTS.length ? 'ค่าติดตั้งและค่าของโรงงานต่อชุดของผลิตภัณฑ์ BIO' : 'ยังไม่มีรายการผลิตภัณฑ์ BIO — ผู้ใช้จะส่งข้อมูลให้ (ราคา · ค่าติดตั้ง · ค่าของโรงงานต่อชุด)'}
        </div>
      </div>

      <div style={box}>
        <div style={h}>ดอกเบี้ยเงินกู้เดิม</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-600)', lineHeight: 1.7 }}>
          ยอดจากตารางดอกเบี้ย (Debt Ledger) · ตปท./สกุลต่างประเทศ จ่ายทุกเดือน · WCI จ่ายทุกไตรมาส · หมวดอื่นเลือกเดือนจ่ายเองในตาราง · ไม่มีตารางเดือนไหน = ประมาณจากยอดคงเหลือ × อัตรา
        </div>
        {fxCurs.length > 0 && <div style={{ ...line, marginTop: 8 }}>อัตราแลกเปลี่ยน
          {fxCurs.map(cur => <span key={cur} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{cur} <FundNum disabled={!canEdit} value={cfg.fx[cur]} onChange={v => setFx(cur, v)} placeholder="ยังไม่รู้" width={70} /> บาท{!cfg.fx[cur] && <FundChip t="ยังไม่รวม" tone="warn" />}</span>)}
        </div>}
      </div>
    </div>
  );
}
/* เงินในบัญชีตอนนี้ของแท็บประมาณการ (ผู้ใช้ 2026-11-11 "เอาทั้งหมดเลย แต่ให้เลือกได้ว่าจะติ๊กใช้ยอดเงินจากบัญชีไหนบ้าง")
 *   ค่าเริ่ม = ยอดคงเหลือ (BALANCE) ทุกบัญชีใน Bank Daily · ติ๊กออกรายบัญชีได้ (fc.open.off) · สลับเป็นยอดใช้ได้ (AVAILABLE_BALANCE) ได้
 *   เก็บใน fund.cfg ทุกคนเห็นเลขเดียวกัน */
function fundFcAcctVal(a, bal) { return (bal === 'avail' ? (a.available != null ? a.available : a.balance) : a.balance) || 0; }
function fundFcOpening(accounts, fc) {
  const on = accounts.filter(a => fc.open.off.indexOf(String(a.accountNo)) < 0);
  const asOf = on.reduce((m, a) => { const d = bdToISO(a.asOf); return d && d > m ? d : m; }, '');
  return { amt: on.reduce((t, a) => t + fundFcAcctVal(a, fc.open.bal), 0), n: on.length, of: accounts.length, asOf };
}
function FundOpenModal({ accounts, fc, canEdit, setFc, onClose }) {
  const off = fc.open.off, bal = fc.open.bal;
  const latest = accounts.reduce((m, a) => { const d = bdToISO(a.asOf); return d && d > m ? d : m; }, '');
  const isOn = (a) => off.indexOf(String(a.accountNo)) < 0;
  const toggle = (a) => setFc(f => { const cur = ((f.open && f.open.off) || []).map(String), no = String(a.accountNo); f.open = Object.assign({}, f.open, { off: cur.indexOf(no) >= 0 ? cur.filter(x => x !== no) : cur.concat([no]) }); return f; });
  const setAll = (on) => setFc(f => { f.open = Object.assign({}, f.open, { off: on ? [] : accounts.map(a => String(a.accountNo)) }); return f; });
  const setBal = (b) => setFc(f => { f.open = Object.assign({}, f.open, { bal: b }); return f; });
  const sum = (fn) => accounts.filter(isOn).reduce((t, a) => t + (fn(a) || 0), 0);
  const th = { padding: '6px 8px', fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 600, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', textAlign: 'right' };
  const td = { padding: '7px 8px', borderBottom: '1px solid var(--line-soft)', fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  return (
    <BDAFShell title="เงินในบัญชีตอนนี้ — เลือกบัญชีที่นับ" sub={'ยอดจากไฟล์ธนาคารในหน้า Bank Daily · ติ๊กบัญชีที่จะใช้เป็นเงินต้นงวดของแผน · ตั้งแล้วทุกคนเห็นเหมือนกัน'} onClose={onClose} width={860}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, color: 'var(--ink-600)', marginRight: 4 }}>ใช้ยอด</span>
        <button type="button" disabled={!canEdit} style={bdafChip(bal === 'ledger')} onClick={() => setBal('ledger')}>ยอดคงเหลือ</button>
        <button type="button" disabled={!canEdit} style={bdafChip(bal === 'avail')} onClick={() => setBal('avail')}>ยอดใช้ได้ (หัก HOLD / เช็ครอเคลียร์)</button>
        <span style={{ flex: 1 }} />
        {canEdit && <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>ติ๊กทุกบัญชี</button>}
        {canEdit && <button type="button" className="btn btn-sm" onClick={() => setAll(false)}>เอาออกทั้งหมด</button>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ ...th, textAlign: 'center', width: 36 }}>นับ</th><th style={{ ...th, textAlign: 'left' }}>บัญชี</th><th style={th}>ยอดคงเหลือ</th><th style={th}>ยอดใช้ได้</th><th style={th}>ข้อมูลวันที่</th></tr></thead>
        <tbody>
          {accounts.map(a => {
            const on = isOn(a), d = bdToISO(a.asOf), old = d && latest && d < latest;
            return (
              <tr key={a.id || a.accountNo} onClick={() => canEdit && toggle(a)} style={{ cursor: canEdit ? 'pointer' : 'default', opacity: on ? 1 : 0.5 }}>
                <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" disabled={!canEdit} checked={on} onChange={() => toggle(a)} onClick={e => e.stopPropagation()} /></td>
                <td style={{ ...td, textAlign: 'left' }}><b>{a.bankName || '—'}</b> {a.accountNo}{(a.accountName || a.note) && <div style={{ fontSize: 11, color: 'var(--ink-500)', whiteSpace: 'normal' }}>{a.accountName || a.note}</div>}</td>
                <td style={{ ...td, fontWeight: bal === 'ledger' ? 700 : 400 }}>{fundB(a.balance)}</td>
                <td style={{ ...td, fontWeight: bal === 'avail' ? 700 : 400 }}>{a.available != null ? fundB(a.available) : '—'}{a.hold ? <div style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>HOLD {fundB(a.hold)}</div> : null}</td>
                <td style={{ ...td, color: old ? '#92400e' : undefined }}>{d ? fmtDate(d) : '—'}{old ? ' (เก่ากว่าบัญชีอื่น)' : ''}</td>
              </tr>
            );
          })}
          <tr>
            <td style={td} /><td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>นับ {accounts.filter(isOn).length} จาก {accounts.length} บัญชี</td>
            <td style={{ ...td, fontWeight: 800, color: bal === 'ledger' ? 'var(--ink-900)' : 'var(--ink-500)' }}>{fundB(sum(a => a.balance))}</td>
            <td style={{ ...td, fontWeight: 800, color: bal === 'avail' ? 'var(--ink-900)' : 'var(--ink-500)' }}>{fundB(sum(a => (a.available != null ? a.available : a.balance)))}</td>
            <td style={td} />
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 8, lineHeight: 1.6 }}>
        อัปเดตยอดได้ที่หน้า Bank Daily (นำเข้าไฟล์ธนาคาร) · ยอดคงเหลือ = ยอดตามบัญชี · ยอดใช้ได้ = ยอดที่ถอนได้จริงตามไฟล์ธนาคาร (หัก HOLD และเช็คที่ยังไม่เคลียร์)
      </div>
    </BDAFShell>
  );
}

/* ── หน้าตาตามแบบที่ผู้ใช้ทำใน Claude Design (2026-11-11 "ทำให้เหมือนอันนี้") ──
 *   ตัวเลขภาพรวมเป็นล้าน 2 ตำแหน่ง · ตารางเป็นบาท · สี ก = ตัวแปร --fin-* (WTP ฟ้า POG · BIO เขียว) · ข = ส้ม #B14A0C · ผลลัพธ์ = กรมท่า #14213A */
const FUND_TILE_IN  = ['var(--fin-c)', 'var(--fin-p2)', 'var(--fin-p3)', 'var(--fin-p4)'];   // สีจริงอยู่ที่ --fin-* (WTP ฟ้า POG · BIO เขียว)
const FUND_TILE_OUT = ['#B14A0C', '#DD7633', '#EFA56E', '#F7CFAE'];
const FUND_ICO = {
  down: ['m6 9 6 6 6-6'], up: ['m18 15-6-6-6 6'], right: ['m9 18 6-6-6-6'], check: ['M20 6 9 17l-5-5'], plus: ['M12 5v14', 'M5 12h14'],
  dl: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  ul: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  wallet: ['M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4', 'M4 6v12a2 2 0 0 0 2 2h14v-4', 'M18 12a2 2 0 0 0 0 4h4v-4z'],
};
function FundIco({ d, size }) {
  const s = size || 18;
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.map((p, i) => <path key={i} d={p} />)}</svg>;
}
function fundMil(n) { return fmtNum(Math.abs(n || 0) / 1e6, 2); }
/* ชื่อแถวที่กรอกเอง (แก้ได้ · บันทึกตอนออกจากช่อง) */
function FundNameInput({ value, disabled, onSave }) {
  const [nm, setNm] = React.useState(value || '');
  React.useEffect(() => { setNm(value || ''); }, [value]);
  return <input className="fund-gname" disabled={disabled} value={nm} placeholder="ตั้งชื่อรายการ…" onChange={e => setNm(e.target.value)}
    onBlur={() => { if (nm !== (value || '')) onSave(nm); }} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />;
}

/* ── หน้าหลัก ─────────────────────────────────────────────────────────── */
function FundingPlanPage({ data, toast }) {
  useOverrideSubAny();
  const canEdit = window.WTPAuth ? window.WTPAuth.can('canEdit') : true;
  const today = bdISO(new Date());
  const cm = today.slice(0, 7);
  const pref0 = React.useMemo(fundLoadPrefs, []);
  const [open, setOpen] = React.useState(pref0.open || { 2: true });
  const [editRow, setEditRow] = React.useState(null);
  const [picking, setPicking] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [incImporting, setIncImporting] = React.useState(false);
  const [openPick, setOpenPick] = React.useState(false);
  const [fold, setFold] = React.useState(pref0.fold || {});
  const [srcKey, setSrcKey] = React.useState(null);
  const [rcvOpen, setRcvOpen] = React.useState(false);
  const [detK, setDetK] = React.useState(null);   // BIO: แถวค่าใช้จ่ายประจำที่เปิดดูรายละเอียด
  const [pjMore, setPjMore] = React.useState({});
  React.useEffect(() => { fundSavePrefs({ open, fold }); }, [open, fold]);
  const tog = (k) => setOpen(p => Object.assign({}, p, { [k]: !p[k] }));

  const { cf, cfState } = fundUseCf();
  const ovRows = data.manualOverrides || [];
  const ovSig = ovRows.filter(r => r && typeof r.key === 'string' && (r.key.indexOf('fund.') === 0 || r.key.indexOf(BDAF_PREFIX) === 0 || r.key === BDAF_CFG_KEY)).map(r => r.key + '=' + r.value).join('|');
  const ov  = React.useMemo(() => fundReadOv(ovRows), [ovSig]);
  const cfg = React.useMemo(() => fundCfgOf(ov.cfgRaw), [ov]);
  const hz = cfg.endMonth >= cm ? cfg.endMonth : bdafAddM(cm, 2);

  /* ค่าใช้จ่าย + เงินเข้า = ชุดเดียวกับการ์ดใน Bank Daily · วิธีคิด/ฐานเดือนเก็บใน fund.cfg ให้ทุกคนเห็นเลขเดียวกัน */
  const mode = cfg.expMode === 'avg' ? 'avg' : 'auto';
  const lookback = BDAF_LOOKBACKS.indexOf(Number(cfg.lookback)) >= 0 ? Number(cfg.lookback) : 6;
  const ed   = React.useMemo(() => bdafParseEdits(ovRows), [ovSig]);
  const col  = React.useMemo(() => bdafCollectCf(cf && cf.stm && cf.stm.txns, cf && cf.codeGroups, today), [cf, today]);
  const plan = React.useMemo(() => bdafBuild(col, lookback, hz, ed.edits), [col, lookback, hz, ed]);
  const view = React.useMemo(() => bdafView(plan, mode), [plan, mode]);
  const F = plan.F, lastDay = fundMonthEnd(F[F.length - 1]);
  const accounts = React.useMemo(() => (data.bankAccounts || []).map(bdAcct), [data.bankAccounts]);
  const finance = React.useMemo(() => (WTPData.buildLookups ? (WTPData.buildLookups(data).financeByCode || {}) : {}), [data.projects, data.debtLedger, data.debtMaster]);
  // BIO: ใบแจ้งหนี้คงค้างแบบเดียวกับ Bank Daily ของ BIO (ivBuildRows → netExpected · แผนรับผูกด้วย bdArPlanOf)
  const arList  = React.useMemo(() => {
    if (typeof window.ivBuildRows !== 'function') return [];
    const idx = bdArPlanIndex((data.forecastEntries || []).map(bdNormForecast));
    return window.ivBuildRows(data).filter(iv => iv.status !== 'paid' && Number(iv.netExpected) > 0).map(iv => {
      const logs = Array.isArray(iv.followUps) ? iv.followUps.filter(x => x && (x.date || x.note)) : [];
      return { id: iv.id, ivNo: iv.ivNo || '', jobNo: iv.jobNo || '', projectName: iv.projectName || '', net: Number(iv.netExpected) || 0, status: iv.status,
        expectedReceive: iv.expectedReceive || '', lastLog: logs.length ? logs[logs.length - 1] : null, plan: bdArPlanOf(idx, iv), raw: iv };
    });
  }, [data.invoices, data.projects, data.debtLedger, data.forecastEntries]);
  // ค่าติดตั้งผู้รับเหมาของงานเดิม (ใบ APS · fundB2bBuild) — โชว์ในหน้าต่างเงินรับ "ออก INV แล้ว" / "ยังไม่ออก INV" · ไม่นับในตาราง (เหมือน WTP · ผู้ใช้ 2026-11-12)
  const instOld = React.useMemo(() => fundInstOld(data), [data.projects, data.invoices, data.receipts, data.payables, data.pvVouchers]);
  const arAll   = React.useMemo(() => arList.map(x => ({ id: x.id, ivNo: x.ivNo, jobNo: x.jobNo, project: x.projectName, amount: x.net, status: x.status, expectedReceive: x.expectedReceive, raw: x.raw })), [arList]);
  const fcs     = React.useMemo(() => fundForecasts(data, arAll), [data.forecastEntries, data.pvVouchers, arAll]);
  const rcv     = React.useMemo(() => bdafReceipts(arList, fcs, today, F), [arList, fcs, today, F]);
  const arOpen  = React.useMemo(() => fundArOpen(arAll), [arAll]);
  const projs   = React.useMemo(() => (window.PCU ? window.PCU.deriveProjects(data.projects || [], data.invoices || [], data.receipts || [], data.debtMaster || []) : []), [data.projects, data.invoices, data.receipts, data.debtMaster]);
  const jobs    = React.useMemo(() => fundJobs(data, projs, fcs, arOpen, finance, cfg, today, lastDay, ov.pipe), [data.payables, data.pvVouchers, projs, fcs, arOpen, finance, cfg, today, lastDay, ov.pipe]);
  const lgBook  = React.useMemo(() => fundLgBook(data.guarantees, today, lastDay), [data.guarantees, today, lastDay]);
  const lgRoom  = fundLgRoom(lgBook, cfg);

  // ผู้ใช้ 2026-11-09: กรอกยอดเองแต่ละเดือน (Selling / Administrative / Finance) · ช่องว่าง = 0 · ยังไม่กรอกสักช่อง = ใช้ค่าเฉลี่ยไปก่อน
  const fx = cfg.fixed || {};
  const fixedParts = FUND_FIXED_PARTS.map(p => {
    // BIO: มีรายละเอียด → ช่องที่ไม่ได้พิมพ์ทับ = ผลรวมรายละเอียด (ช่องสีเทา)
    const typed = F.map(mk => fundFixedVal(fx, p.k, mk)), det = fundFixedDetail(cfg, p.k), detSum = det.reduce((t, x) => t + (Number(x.a) || 0), 0);
    const vals = det.length ? typed.map(v => (v != null ? v : detSum)) : typed;
    return Object.assign({}, p, { vals, typed, det, detSum, empty: vals.filter(v => v == null).length });
  });
  const extraRows = cfg.extra || [];
  const avgLinesAll = view.cats.filter(c => c.cat !== 2).reduce((a, c) => a.concat(c.lines.filter(x => !fundIsDebtLine(x.l))), []);
  const fullMonths = F.length > 1 ? F.slice(1) : F;
  const avgFixed = fullMonths.reduce((s2, mk) => s2 + avgLinesAll.reduce((a, x) => a + (x.vals[mk] || 0), 0), 0) / (fullMonths.length || 1);

  const lgIssuers = fundLgIssuers(cfg);
  const lgBanks = Array.from(new Set(Object.keys(lgBook.banks).concat(lgIssuers))).sort((a, b) => (cfg.lgIssue[b] ? 1 : 0) - (cfg.lgIssue[a] ? 1 : 0) || (lgBook.banks[b] || 0) - (lgBook.banks[a] || 0));
  const noCf = !plan.N;
  const pipeTotal = ov.pipe.filter(r => !r.off).reduce((s, r) => s + (Number(r.value) || 0), 0);

  /* ── เขียนค่า ── */
  const saveCfg = (fn) => {
    if (!canEdit) return;
    WTPOverride.setRaw(FUND_CFG_KEY, JSON.stringify(fn(JSON.parse(JSON.stringify(ov.cfgRaw || {})))));
  };
  const setOpt = (k, v) => saveCfg(o => { o[k] = v; return o; });
  const setFx = (cur, v) => saveCfg(o => { o.fx = Object.assign({}, o.fx, { [cur]: v }); return o; });
  // แก้ช่องรายเดือน: แถวที่ยังเป็นยอดเท่ากันทุกเดือนแบบเดิม → แตกเป็นรายเดือนก่อนแล้วค่อยแก้ · ยอดรวมแบบก่อนแยกแถวเลิกใช้
  const applyCells = (row0, patch) => {
    const row = Object.assign({}, row0);
    Object.keys(patch).forEach(mk => { if (patch[mk] == null) delete row[mk]; else row[mk] = patch[mk]; });
    return row;
  };
  const setFixedCells = (k, patch) => saveCfg(o => {
    const f = Object.assign({}, o.fixed), m = Object.assign({}, f.m);
    let row = m[k] && typeof m[k] === 'object' ? m[k] : null;
    if (!row) { row = {}; const flat = fundN(f[k]); if (flat != null) F.forEach(mk => { row[mk] = flat; }); }
    m[k] = applyCells(row, patch);
    f.m = m;
    delete f[k];
    delete f.amount;
    o.fixed = f;
    return o;
  });
  // BIO: รายละเอียดแถวค่าใช้จ่ายประจำ · ล้างยอดที่พิมพ์ทับรายเดือนของแถวนั้น
  const setFixedItems = (k, list) => saveCfg(o => { const f = Object.assign({}, o.fixed); f.items = Object.assign({}, f.items, { [k]: list }); o.fixed = f; return o; });
  const clearFixedTyped = (k) => saveCfg(o => { const f = Object.assign({}, o.fixed), m = Object.assign({}, f.m); delete m[k]; f.m = m; delete f[k]; delete f.amount; o.fixed = f; return o; });
  const setExtraCells = (id, patch) => saveCfg(o => {
    o.extra = (o.extra || []).map(x => {
      if (x.id !== id) return x;
      let row = x.m && typeof x.m === 'object' ? x.m : null;
      if (!row) { row = {}; F.forEach(mk => { const a = fundExtraVal(x, mk); if (a != null) row[mk] = a; }); }
      const y = Object.assign({}, x, { m: applyCells(row, patch) });
      delete y.amount; delete y.from; delete y.to;
      return y;
    });
    return o;
  });
  const setExtra = (id, patch) => saveCfg(o => { o.extra = (o.extra || []).map(x => (x.id === id ? Object.assign({}, x, patch) : x)); return o; });
  const delExtra = (x) => { if (window.confirm('ลบรายการ “' + (x.name || 'ไม่มีชื่อ') + '”?')) saveCfg(o => { o.extra = (o.extra || []).filter(y => y.id !== x.id); return o; }); };
  const setLgIssue = (b, v) => saveCfg(o => { o.lgIssue = Object.assign({}, o.lgIssue, { [b]: v }); return o; });
  const setLgFree = (b, v) => saveCfg(o => { o.lgFree = Object.assign({}, o.lgFree, { [b]: v }); o.lgAsOf = today; return o; });   // null ต้องเก็บไว้ ไม่งั้นค่าเริ่มกลับมา
  const saveRow = (row) => {
    const id = row.id || ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    const rest = Object.assign({}, row);
    delete rest.id;
    WTPOverride.setRaw(FUND_PIPE + id, JSON.stringify(rest));
    setEditRow(null);
    if (toast) toast('บันทึก ' + row.name);
  };
  const delRow = (row) => {
    if (!window.confirm('ลบ “' + row.name + '” ออกจาก Pipeline?')) return;
    WTPOverride.setRaw(FUND_PIPE + row.id, '');
    setEditRow(null);
    if (toast) toast('ลบ ' + row.name);
  };
  const pickProject = (p) => {
    const wip = p.status === 'Work in progress', owed = wip && !!p.assignee;
    // โอนสิทธิไปแล้ว → สิ่งที่เข้าแผนคือเงินค้างรับหลังหักภาระหนี้ ไม่ได้เบิกเพิ่ม
    const debtAmt = owed ? Number((finance[p.contractNo] || {}).debt) || 0 : 0;
    saveRow({ name: p.site || p.name, code: p.contractNo || '', sysId: p.id,
      value: owed ? Math.max(0, p.outstandingAR - debtAmt) : (p.contractAmt || p.allocation || 0),
      group: wip ? 'signed' : p.projectStatus === 'ประกาศผู้ชนะ' ? 'soon' : 'approval',
      signDate: wip ? (p.start || '') : '', deliverDate: p.finish || '', assignable: owed ? 'yes' : '', lender: owed ? 'none' : 'auto', stage: 'pre',
      note: owed ? 'ค้างรับ ' + fundB(p.outstandingAR) + (debtAmt ? ' หักภาระหนี้ ' + fundB(debtAmt) : '') : '',
      ...fundFcFromProject(p, fc) });
    setOpen(o => Object.assign({}, o, { 3: true, fcPipe: true }));
  };
  const setDebtTreat = (d, v) => {
    if (!canEdit) return;
    const next = Object.assign({}, ov.debt);
    if (v === d.defTreat) delete next[d.id]; else next[d.id] = v;
    WTPOverride.setRaw(FUND_DEBT_KEY, Object.keys(next).length ? JSON.stringify(next) : '');
  };

  /* ── ส่วนแสดงผล ── */
  const rangeLabel = bdafMShort(F[0]) + (F.length > 1 ? ' – ' + bdafMShort(F[F.length - 1]) : '');
  const numTd = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  const taken = new Set(ov.pipe.map(r => r.sysId).filter(Boolean).concat(ov.pipe.map(r => 'c:' + fundCode(r.code)).filter(k => k !== 'c:')));
  const hzOpts = bdafRange(bdafAddM(cm, 2), bdafAddM(cm, 12));
  if (hzOpts.indexOf(hz) < 0) hzOpts.push(hz);

  /* ══ แท็บประมาณการรับ-จ่าย ══ */
  const fc = React.useMemo(() => fundFcOf(cfg), [cfg]);
  const debtFc = React.useMemo(() => fundDebtRows(data, F, today, cfg, ov.debt, { incC: fc.incC }), [data.debtMaster, data.debtLedger, data.interestSchedulePrepaid, F, today, cfg, ov.debt, fc]);
  const recvBy = React.useMemo(() => {
    const o = {};
    projs.forEach(p => { const c = fundCode(p.contractNo); if (c) o[c] = { got: (Number(p.received) || 0) * 106 / 107, contract: Number(p.contractAmt) || 0 }; });
    return o;
  }, [projs]);
  const fp = React.useMemo(() => fundFcPlan(ov.pipe, fc, cfg, today, lastDay, arOpen, recvBy, lgRoom), [ov.pipe, fc, cfg, today, lastDay, arOpen, recvBy, lgRoom]);
  const fcSplit = React.useMemo(() => fundFcDebtSplit(debtFc), [debtFc]);
  const lgBackItems = React.useMemo(() => fundFcLgBack(data.guarantees, today, lastDay), [data.guarantees, today, lastDay]);

  const setFc = (fn) => saveCfg(o => { o.fc = fn(Object.assign({}, o.fc)); return o; });
  const setOvr = (key, mk, v) => setFc(f => {
    const all = Object.assign({}, f.ovr), row = Object.assign({}, all[key]);
    if (v == null) delete row[mk]; else row[mk] = v;
    if (Object.keys(row).length) all[key] = row; else delete all[key];
    f.ovr = all;
    return f;
  });
  const clearOvr = (key) => setFc(f => { const all = Object.assign({}, f.ovr); delete all[key]; f.ovr = all; return f; });
  const addExtraSec = (sec, name, sug) => saveCfg(o => { o.extra = (o.extra || []).concat([Object.assign({ id: 'x' + Date.now().toString(36), name: name || '', dir: sec === 'in' || sec === 'loan' ? 'in' : 'out', sec, m: {} }, sug ? { sug } : {})]); return o; });
  // นำเข้าไฟล์ฝ่ายขาย: ใหม่ = เพิ่มแถว · อัปเดต = แก้เฉพาะข้อมูลจากไฟล์ คงกลุ่ม/แบบรับเงิน/เบิก LIT/ค่าติดตั้งที่ตั้งเอง · หายจากไฟล์ = ลบเฉพาะที่ติ๊ก
  const applySales = (plan, o) => {
    if (!canEdit || !plan) return;
    const stamp = Date.now().toString(36);
    const fromFile = (x) => ({ name: x.name, full: x.full, value: x.value, signDate: x.signDate, note: x.note, type: x.type, province: x.province, org: x.org, budget: x.budget, sub: x.sub, area: x.area, srcFile: o.file, srcAt: today });
    plan.add.forEach((x, i) => {
      const row = Object.assign({ code: x.code, valueMode: 'items', items: x.items, group: 'soon', payType: o.payType, useLit: false, src: 'govsales', lender: 'auto', stage: 'pre', assignable: '' }, fromFile(x));
      WTPOverride.setRaw(FUND_PIPE + 'g' + stamp + i.toString(36) + Math.random().toString(36).slice(2, 5), JSON.stringify(row));
    });
    plan.upd.forEach(x => {
      const r = x.old, rest = Object.assign({}, r, fromFile(x), { src: r.src || 'govsales' });
      if (r.src === 'govsales' || !(r.items || []).length) { rest.valueMode = 'items'; rest.items = x.items; }
      delete rest.id;
      WTPOverride.setRaw(FUND_PIPE + r.id, JSON.stringify(rest));
    });
    o.drop.forEach(r => WTPOverride.setRaw(FUND_PIPE + r.id, ''));
    setImporting(false);
    setOpen(p => Object.assign({}, p, { fcPipe: true }));
    if (toast) toast('นำเข้าโครงการฝ่ายขาย: ใหม่ ' + plan.add.length + ' · อัปเดต ' + plan.upd.length + (o.drop.length ? ' · ลบ ' + o.drop.length : ''));
  };

  // แถวของงบ — auto = ระบบคิด (ยอด sys รายเดือน + รายการไว้ดูที่มา) · man = กรอกเอง
  const FC_C = { inv: '#0E9F6E', est: '#35B37E', pipe: '#0D9488', lit: '#2F5FD0', inx: '#65A30D', proj: '#F2704A', int: '#E85D9A', oth: '#64748B', con: '#B45309' };
  const fcAuto = (key, label, items, o) => Object.assign({ key, label, auto: true, items: items || [], sys: fundFcBucket(items, F) }, o);
  const fcSecOf = (x) => x.sec || (x.dir === 'in' ? 'in' : 'fixed');
  const fcMan = (sec, color, badge) => extraRows.filter(x => fcSecOf(x) === sec).map(x => ({ key: 'x:' + x.id, man: true, x, label: x.name, color, badge, vals: F.map(mk => fundExtraVal(x, mk)) }));
  const fcVal = (row, mk) => {
    if (row.auto) { const o = fc.ovr[row.key]; return o && o[mk] != null ? Number(o[mk]) : (row.sys[mk] || 0); }
    return row.vals[F.indexOf(mk)] || 0;
  };
  const fcEv = (arr, sign) => arr.map(e => ({ date: e.date, amt: sign * e.amt, t: e.t, ref: e.ref, note: e.note }));
  const ivItems = rcv.items.filter(it => it.src !== 'other').map(it => ({ date: it.date, amt: it.amt, t: it.name, ref: it.ref }));
  const rcvOtherItems = rcv.items.filter(it => it.src === 'other').map(it => ({ date: it.date, amt: it.amt, t: it.name, ref: it.ref, note: ['ประมาณการรับที่คีย์ไว้ (หน้าประมาณการ / Bank Daily) ไม่ผูกใบแจ้งหนี้'] }));
  const rcvSkip = rcv.skip.insp.amt + rcv.skip.issue.amt + rcv.skip.nodate.amt;
  // งวดที่ยังไม่ออก INV (ผู้ใช้ 2026-11-11 "ยังไม่ออก INV แปลว่ายังไม่ได้รับเงินเร็วๆ นี้แน่นอน · ปกติรับหลังออก INV 30–45 วัน")
  //   แก้รายโครงการ fc.wip[code] = { inv: วันคาดออก INV, amt: ยอดที่นับ, off: ไม่นับ } · ใส่วันออก INV = รับวันนั้น + fc.invLag (ค่าเริ่ม 45)
  //   ไม่ใส่ = วันตามงวดสัญญาเดิม แต่เร็วสุดวันนี้ + fc.invLag
  const wipList = jobs.wip.filter(x => x.rcv > 0.5);
  const wipEarliest = fundAddDays(today, fc.invLag);
  const wipInItems = [];
  wipList.forEach(x => {
    const o = fc.wip[x.code] || {};
    if (o.off) return;
    const own = fundN(o.amt) != null, amt = own ? Number(o.amt) : x.rcv, k = amt / x.rcv;
    const head = 'ยังไม่ออก INV ' + fundB(amt) + (own ? ' (ใส่ยอดเอง · ระบบคิด ' + fundB(x.rcv) + ')' : ' = ค้างรับตามหน้าโครงการ หัก ณ ที่จ่าย 1% ลบใบแจ้งหนี้ที่ออกแล้ว' + (x.debt ? ' และภาระหนี้โอนสิทธิ์' : ''));
    if (o.inv) {
      const d0 = fundAddDays(o.inv, fc.invLag), d = d0 < today ? today : d0;
      if (d <= lastDay) wipInItems.push({ date: d, amt, t: x.name, ref: x.code, arNo: 0, note: [head, 'คาดออก INV ' + fmtDate(o.inv) + ' + รับเงินหลังออก INV ' + fc.invLag + ' วัน = ' + fmtDate(d0)] });
      return;
    }
    jobs.evs.filter(e => e.kind === 'wipIn' && e.ref === x.code).forEach(e => {
      const d = e.date < wipEarliest ? wipEarliest : e.date;
      if (d <= lastDay) wipInItems.push({ date: d, amt: e.amt * k, t: x.name, ref: x.code, arNo: e.arInst, arN: e.arN, note: [head, 'งวดตามสัญญา (เริ่ม ' + fmtDate(x.start) + ')' + (e.date < wipEarliest ? ' → ยังไม่ออก INV จึงนับเร็วสุดวันนี้ + ' + fc.invLag + ' วัน (' + fmtDate(wipEarliest) + ')' : ' ' + fmtDate(e.date)), 'ใส่วันคาดออก INV เองได้ในหน้าต่างนี้'] });
    });
  });
  // ค่าติดตั้งผู้รับเหมาที่ต้องจ่ายหลังรับเงินแต่ละก้อน (fundInstOld · จ่ายหลังรับเงิน fc.instPay วัน) — ไว้ดูแล้วพิมพ์ลง ข.2 เอง ไม่นับในตาราง
  const instOf = (code) => (code ? instOld[fundB2bNorm(code)] : null) || null;
  const instName = (io, i) => (io && io.drink ? 'งวดเดียว' : 'งวด ' + i.n);
  const instWhy = (i) => (i.st === 'ap' ? 'ตั้งหนี้แล้ว ' + (i.docs || []).join(', ') : i.st === 'est' ? 'ประมาณจาก ' + i.how : 'ไม่รู้ยอด — ไม่มี ADV ในระบบ');
  const instPayOf = (date, list) => list.map(i => Object.assign({}, i, { pay: fundAddDays(date, fc.instPay) }));
  wipInItems.forEach(it => {
    const io = instOf(it.ref);
    it.inst = instPayOf(it.date, fundInstDue(io, it.arNo, it.arN));
    it.io = io;
    if (it.inst.length) it.note = it.note.concat(it.inst.map(i => 'ค่าติดตั้ง' + instName(io, i) + ' ' + (i.st === 'unk' ? '(ไม่รู้ยอด)' : fundB(i.amt)) + ' · ' + instWhy(i) + ' · จ่ายประมาณ ' + fmtDate(i.pay) + ' (รับเงิน + ' + fc.instPay + ' วัน)'));
  });
  // ใบแจ้งหนี้ที่ออกแล้ว: เลข INV → งวดรับที่เท่าไรของโครงการ (ตารางงวดหน้า BACK TO BACK) → งวดผู้รับเหมาที่ต้องจ่ายตาม
  const ivInst = new Map();
  rcv.items.forEach(it => {
    const io = it.ar ? instOf(it.ar.jobNo) : null;
    if (!io) return;
    const no = io.arIv[String(it.ref || '').trim()], open = io.inst.filter(i => i.st !== 'paid');
    if (no == null && open.length > 1) { ivInst.set(it, { io, list: [], unknown: open.length }); return; }
    const list = instPayOf(it.date, no == null ? open : fundInstDue(io, no, io.arN));
    if (list.length) ivInst.set(it, { io, list });
  });
  // ตารางสรุปตามเดือนที่ต้องจ่าย (แยกแถว ข.2 "ค่าติดตั้งงวด 1" / "งวดสุดท้าย") + ยอดที่อยู่ในแถวนั้นตอนนี้ ไว้พิมพ์รวมเอง
  const instRowNow = (key, mk) => { const o = fc.ovr[key]; return o && o[mk] != null ? Number(o[mk]) : (fundFcBucket(fp.ev[key], F)[mk] || 0); };
  const instCell = (io, list, unknown) => (
    unknown ? <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }} title="ใบแจ้งหนี้นี้ไม่อยู่ในตารางงวดของโครงการ และเหลือหลายงวด">ไม่รู้ว่าเป็นงวดไหน ({unknown} งวด)</span>
      : !list.length ? <span style={{ color: 'var(--ink-400)' }}>—</span>
        : list.map((i, j) => (
          <div key={j} title={instWhy(i)} style={{ whiteSpace: 'nowrap', lineHeight: 1.5 }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{instName(io, i)} </span>
            {i.st === 'unk' ? <span style={{ fontSize: 11.5, color: '#8A5300' }}>ไม่รู้ยอด</span> : <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fundB(i.amt)}</b>}
            <span style={{ fontSize: 10.5, fontWeight: 600, marginLeft: 5, padding: '0 6px', borderRadius: 999, background: i.st === 'ap' ? '#E3ECFB' : '#F1F5F9', color: i.st === 'ap' ? '#1F4E9E' : '#5E6A82' }}>{i.st === 'ap' ? 'ตั้งหนี้แล้ว' : i.st === 'est' ? 'ประมาณ' : 'ไม่มี ADV'}</span>
            {i.pay && i.st !== 'unk' && <span style={{ fontSize: 11, color: 'var(--ink-500)' }}> · จ่าย ~{bdafDShort(i.pay)}</span>}
          </div>
        ))
  );
  const instSummary = (lists, src) => {
    const all = [].concat(...lists), F0 = F[F.length - 1];
    if (!all.length) return null;
    const by = {}; let later = 0, unk = 0;
    all.forEach(i => {
      if (i.st === 'unk') { unk++; return; }
      const mk = i.pay.slice(0, 7);
      if (mk > F0) { later += i.amt; return; }
      const o = by[mk] = by[mk] || { inst1: 0, inst2: 0 };
      o[i.row] += i.amt;
    });
    const mks = Object.keys(by).sort(), tot = (k) => mks.reduce((s, mk) => s + by[mk][k], 0);
    const c = { padding: '5px 8px', borderBottom: '1px solid var(--line-soft)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
    const h = Object.assign({}, c, { fontSize: 11.5, fontWeight: 600, color: 'var(--ink-500)', borderBottom: '1px solid var(--line)' });
    return (
      <div style={{ margin: '10px 0 12px', padding: '10px 12px', border: '1px solid #F3D9C4', background: '#FFFaf5', borderRadius: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#B14A0C', marginBottom: 2 }}>ค่าติดตั้งผู้รับเหมาที่ต้องจ่ายหลังรับเงินในหน้าต่างนี้ (ยังไม่นับในตาราง)</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 6 }}>จ่ายหลังรับเงิน {fc.instPay} วัน · ข้อมูลใบ APS ผู้รับเหมา — ถ้าจะนับ ให้พิมพ์เพิ่มในแถว "ค่าติดตั้งงวด 1" / "ค่าติดตั้งงวดสุดท้าย" ข้อ ข.2 เดือนเดียวกัน{src ? ' · ' + src : ''}</div>
        {mks.length > 0 && (
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr><th style={Object.assign({}, h, { textAlign: 'left' })}>เดือนที่จ่าย</th><th style={h}>งวด 1</th><th style={h}>งวดสุดท้าย</th><th style={h}>รวม</th><th style={Object.assign({}, h, { color: 'var(--ink-400)' })}>ในแถว ข.2 ตอนนี้ (งวด 1 / สุดท้าย)</th></tr></thead>
            <tbody>
              {mks.map(mk => (
                <tr key={mk}>
                  <td style={Object.assign({}, c, { textAlign: 'left' })}>{bdafMShort(mk)}</td>
                  <td style={c}>{by[mk].inst1 > 0.5 ? fundB(by[mk].inst1) : '–'}</td>
                  <td style={c}>{by[mk].inst2 > 0.5 ? fundB(by[mk].inst2) : '–'}</td>
                  <td style={Object.assign({}, c, { fontWeight: 700 })}>{fundB(by[mk].inst1 + by[mk].inst2)}</td>
                  <td style={Object.assign({}, c, { color: 'var(--ink-400)' })}>{fundB(instRowNow('inst1', mk))} / {fundB(instRowNow('inst2', mk))}</td>
                </tr>
              ))}
              <tr><td style={Object.assign({}, c, { textAlign: 'left', fontWeight: 700 })}>รวม</td><td style={Object.assign({}, c, { fontWeight: 700 })}>{fundB(tot('inst1'))}</td><td style={Object.assign({}, c, { fontWeight: 700 })}>{fundB(tot('inst2'))}</td><td style={Object.assign({}, c, { fontWeight: 800 })}>{fundB(tot('inst1') + tot('inst2'))}</td><td style={c} /></tr>
            </tbody>
          </table>
        )}
        {(later > 0.5 || unk > 0) && <div style={{ fontSize: 11.5, color: '#8A5300', marginTop: 6 }}>{[later > 0.5 ? 'จ่ายหลังช่วงที่ดู ' + fundB(later) : '', unk ? 'ไม่รู้ยอด ' + unk + ' งวด (ไม่มี ADV ในระบบ — PV เริ่ม ม.ค. 68)' : ''].filter(Boolean).join(' · ')}</div>}
      </div>
    );
  };
  const setWip = (code, patch) => setFc(f => {
    const all = Object.assign({}, f.wip), cur = Object.assign({}, all[code], patch);
    Object.keys(cur).forEach(k2 => { if (cur[k2] == null || cur[k2] === '' || cur[k2] === false) delete cur[k2]; });
    if (Object.keys(cur).length) all[code] = cur; else delete all[code];
    f.wip = all;
    return f;
  });
  const wipHead = (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-600)', marginBottom: 8, flexWrap: 'wrap' }}>
        รับเงินหลังออก INV <FundNum disabled={!canEdit} value={fc.invLag} onChange={v => setFc(f => Object.assign(f, { invLag: v == null ? 45 : v }))} width={52} /> วัน
        <span style={{ color: 'var(--ink-400)' }}>(ปกติ 30–45 วัน) · ยังไม่ใส่วันคาดออก INV = เร็วสุด {fmtDate(wipEarliest)}</span>
      </div>
      {wipList.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>ไม่มีโครงการที่กำลังทำซึ่งยังมียอดที่ยังไม่ออก INV</div> : (
        <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          <table className="fund-tbl fund-sticky-head">
            <thead><tr><th style={{ textAlign: 'center' }}>นับ</th><th className="l">โครงการ</th><th>มูลค่าสัญญา</th><th>รับแล้ว</th><th>ออก INV แล้วรอรับ</th><th>ยังไม่ออก INV</th><th className="l" title="ค่าติดตั้งผู้รับเหมาที่ยังไม่ได้จ่าย (ใบ APS) · จ่ายหลังรับเงิน">ค่าติดตั้งที่ยังต้องจ่าย</th><th>ยอดที่นับ</th><th className="l">วันคาดออก INV</th><th className="l">คาดรับ</th></tr></thead>
            <tbody>
              {wipList.map(x => {
                const o = fc.wip[x.code] || {}, dates = wipInItems.filter(i => i.ref === x.code).map(i => bdafDShort(i.date));
                const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
                return (
                  <tr key={x.code} style={{ opacity: o.off ? 0.5 : 1 }}>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" disabled={!canEdit} checked={!o.off} onChange={e => setWip(x.code, { off: !e.target.checked })} /></td>
                    <td style={{ maxWidth: 220 }}><div style={{ fontWeight: 600 }}>{x.code}</div><div style={{ fontSize: 11, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</div></td>
                    <td style={num}>{fundB(x.v)}</td>
                    <td style={num}>{fundB(x.got)}</td>
                    <td style={num}>{x.ar > 0.5 ? fundB(x.ar) : '—'}</td>
                    <td style={num}>{fundB(x.rcv)}</td>
                    <td style={{ fontSize: 12.5 }}>{(() => {
                      // งวดผู้รับเหมาที่ยังไม่จ่ายทั้งหมดของโครงการ · วันจ่ายตามเงินรับก้อนที่ผูกไว้ (ไม่มี = รับเงินงวดนั้นแล้ว/หลังช่วงที่ดู)
                      const io = instOf(x.code);
                      if (!io) return <span style={{ color: 'var(--ink-400)' }} title="ไม่มีใบ APS ของโครงการนี้ในระบบ">ไม่มีข้อมูล</span>;
                      const open = io.inst.filter(i => i.st !== 'paid');
                      if (!open.length) return <span style={{ color: '#0B7255', fontSize: 12 }}>จ่ายครบแล้ว</span>;
                      const att = [].concat(...wipInItems.filter(i => i.ref === x.code).map(i => i.inst));
                      return instCell(io, open.map(i => att.find(a => a.n === i.n) || i));
                    })()}</td>
                    <td style={num}><FundNum disabled={!canEdit} value={o.amt} onChange={v => setWip(x.code, { amt: v })} placeholder={fundB(x.rcv)} width={110} /></td>
                    <td><input className="input" type="date" disabled={!canEdit} value={o.inv || ''} onChange={e => setWip(x.code, { inv: e.target.value })} style={{ padding: '2px 4px', fontSize: 12, width: 130 }} /></td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: o.off ? 'var(--ink-400)' : undefined }}>{o.off ? 'ไม่นับ' : dates.join(' · ') || 'หลังช่วงที่ดู'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 6 }}>ยอดที่นับว่าง = ใช้ยอดระบบ · ติ๊ก "นับ" ออก = ไม่นับโครงการนี้ · ใส่วันคาดออก INV = รับเงินวันนั้น + {fc.invLag} วัน</div>
      {instSummary(wipInItems.map(i => i.inst))}
    </div>
  );
  const apItems = fcEv(jobs.evs.filter(e => e.kind === 'proj' && e.sub === 'ap'), -1);
  const wipItems = fcEv(jobs.evs.filter(e => e.kind === 'proj' && e.sub === 'wip'), -1);
  const litPer = fp.per.filter(P => P.lit);
  const litUsedFc = litPer.reduce((s, P) => s + P.lit.gross, 0);
  const pipeN = fp.per.length, pipeNoSign = fp.per.filter(P => !P.r.signDate && !P.r.payDate).length;
  const instUnk = fp.per.filter(P => P.isNew && P.sign && P.inst && P.inst.unk.length);
  const lgNeedFc = fp.per.reduce((s, P) => s + P.lgNeed, 0), lgCashFc = fp.per.reduce((s, P) => s + P.lgCash, 0);
  const incList = debtFc.rows.filter(d => d.cat === 'Incofin');
  // ดอกเบี้ย Incofin ตามไฟล์ที่นำเข้า (ผู้ใช้ 2026-11-11 "ใช้ข้อมูลตามไฟล์ … จ่ายวันตามนี้") · สัญญาที่ไม่มีในไฟล์ = ตารางในระบบตามรอบ
  const incCovered = new Set(), incItems = [], incNoFx = [];
  if (ov.incs && Array.isArray(ov.incs.sheets)) ov.incs.sheets.forEach(sh => {
    const m = (data.debtMaster || []).find(x => x && x.contractNo === sh.no && String(x.status || '').trim() === 'Active');
    if (!m) return;
    incCovered.add(sh.no);
    const cur = debtCur(m), fxr = cur === 'THB' ? 1 : Number(cfg.fx[cur]) || 0;
    if (!fxr) { incNoFx.push(cur); return; }
    (sh.pays || []).forEach(p => {
      if (p.refund || p.date < today || p.date > lastDay) return;
      incItems.push({ date: p.date, amt: p.amt * fxr, t: sh.no + ' · ' + (m.borrowerName || ''), ref: 'ชีต ' + sh.sheet, note: [
        'ตามไฟล์ ' + ov.incs.file + ' (นำเข้า ' + fmtDate(ov.incs.at) + ')',
        'จ่าย ' + fmtNum(p.amt, 2) + ' ' + cur + (p.pri ? ' (เงินต้น ' + fmtNum(p.pri, 2) + ' · ดอกเบี้ย ' + fmtNum(p.amt - p.pri, 2) + ')' : '') + ' × ' + fmtNum(fxr, 2) + ' = ' + fundB(p.amt * fxr),
      ].concat(p.note ? ['หมายเหตุในไฟล์: ' + p.note] : []) });
    });
  });
  fcSplit.incofin.forEach(it => { if (!incCovered.has(it.no)) incItems.push(it); });
  const fcFxCurs = Array.from(new Set(debtFc.rows.filter(d => d.cur !== 'THB').map(d => d.cur)));
  const fcFxMissing = Object.keys(debtFc.fxMissing);
  const lgHead = (
    <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FFF7F2', borderRadius: 8, fontSize: 12.5, color: '#1B2A4A', lineHeight: 1.7 }}>
      หลักประกัน {fmtNum(Number(cfg.lgPct) || 0, 1)}% ของสัญญาใหม่รวม <b>{fundB(lgNeedFc)}</b> · วงเงิน LG ว่าง {lgRoom == null ? <b style={{ color: '#92400e' }}>ยังไม่รู้</b> : <b>{fundB(lgRoom)}</b>}
      {lgRoom != null && <> ({fundLgIssuers(cfg).join(' / ') || 'ไม่มีธนาคารที่ออกใบใหม่'} ณ {bdafDShort(cfg.lgAsOf)})</>}
      {lgRoom != null && (lgCashFc > 0.5 ? <div style={{ color: 'var(--bad)', fontWeight: 700 }}>วงเงินไม่พอ ต้องวางเงินสดเพิ่ม {fundB(lgCashFc)} (1 ต่อ 1)</div> : lgNeedFc > 0.5 ? <div style={{ color: '#15803d' }}>วงเงิน LG พอ เหลือ {fundB(fp.lgLeft)}</div> : null)}
      <div style={{ color: 'var(--ink-500)' }}>ตั้งวงเงินว่างได้ที่ "เงื่อนไขที่ใช้คิด" · เงินสดค้ำที่วางอยู่ {fundM(lgBook.cash)} · ครบกำหนดในช่วงนี้ {fundM(lgBook.cashSoon)}</div>
    </div>
  );
  const principalHead = (() => {
    const due = debtFc.rows.filter(d => d.inHz || d.treat === 'review');
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: 'var(--ink-600)', marginBottom: 6 }}>สัญญาที่ครบในช่วงนี้ {due.length} สัญญา · เลือกว่าแต่ละสัญญาจะคืนจริงหรือต่อ (ค่าเริ่ม: นักลงทุน = ต่อ · โอนสิทธิ์ = หักจากเงินรับลูกค้า)</div>
        {due.length > 0 && <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          <table className="fund-tbl">
            <thead><tr><th>สัญญา</th><th className="l">เจ้าหนี้</th><th>ครบกำหนด</th><th>คงเหลือ</th><th className="l">นับอย่างไร</th></tr></thead>
            <tbody>{due.map(d => (
              <tr key={d.id}>
                <td>{d.no || '—'} <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{d.cat}</span></td>
                <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</td>
                <td style={{ ...numTd, color: d.overdue ? 'var(--bad)' : undefined }}>{d.due ? fmtDate(d.due) : '—'}</td>
                <td style={numTd}>{d.cur !== 'THB' ? d.cur + ' ' : ''}{fundB(d.bal)}</td>
                <td><select className="select input" disabled={!canEdit} value={d.treat} onChange={e => setDebtTreat(d, e.target.value)} style={{ padding: '3px 6px', fontSize: 12 }}>
                  {Object.keys(FUND_DEBT_TREAT).filter(k => k !== 'review' || d.overdue).map(k => <option key={k} value={k}>{FUND_DEBT_TREAT[k]}</option>)}
                </select></td>
              </tr>
            ))}</tbody>
          </table>
        </div>}
      </div>
    );
  })();
  // ค่าของโรงงาน (ผู้ใช้ 2026-11-11 "เลือกจ่ายอีกที" → ไม่นับเอง): แถวเริ่ม 0 ทุกเดือน พิมพ์ยอดลงเดือนที่เลือกจ่าย (fc.ovr.fac)
  //   รายการต่อโครงการ/งวดพร้อมวันอ้างอิงตามเงื่อนไขโรงงาน (มัดจำ · ผลิตเสร็จ · ประกอบเสร็จ) ไว้ดูในหน้าต่างที่มา
  const facAll = fp.ev.fac1.concat(fp.ev.fac2, fp.ev.fac3).map(e => Object.assign({}, e, { note: (e.note || []).concat(['วันอ้างอิงตามเงื่อนไขโรงงาน — ไม่นับในตาราง จนกว่าจะพิมพ์ยอดลงเดือนที่เลือกจ่าย']) }));
  const facTotal = fp.per.reduce((t, P) => t + (P.fac ? P.fac.total : 0), 0);
  const facRow = Object.assign(fcAuto('fac', 'ค่าของโรงงาน — เลือกเดือนจ่ายเอง', facAll, { badge: 'โรงงาน', color: FC_C.con,
    how: 'ยอดเบิกตามไฟล์ FACTORY ของโครงการที่จะลงนาม · ระบบไม่ลงเดือนให้ พิมพ์ยอดลงช่องเดือนที่เลือกจ่ายเอง · รายการข้างล่างคือยอดตามงวดและวันอ้างอิง' }),
    { sys: F.reduce((o, mk) => { o[mk] = 0; return o; }, {}) });
  const facTyped = F.reduce((t, mk) => t + fcVal(facRow, mk), 0);
  // BIO: ดอกเบี้ยหมวดอื่น (ไม่ใช่ WCI / ตปท.) — ผู้ใช้ "รอเลือกรายการจ่ายเอง" → แถวเริ่ม 0 พิมพ์ยอดลงเดือนที่เลือกจ่าย · รายการในหน้าต่างที่มา = ยอดตามตารางดอกเบี้ยรายเดือนไว้อ้างอิง
  const pickAll = fcSplit.pick.map(e => Object.assign({}, e, { note: (e.note || []).concat(['ยอดอ้างอิงตามตารางดอกเบี้ย (สิ้นเดือน) — ไม่นับในตาราง จนกว่าจะพิมพ์ยอดลงเดือนที่เลือกจ่าย']) }));
  const pickTotal = pickAll.reduce((t, e) => t + e.amt, 0);
  const pickRow = Object.assign(fcAuto('intPick', 'หมวดอื่น — เลือกเดือนจ่ายเอง', pickAll, { badge: 'เลือก', color: FC_C.int,
    how: 'ดอกเบี้ยของสัญญาหมวดอื่น (ไม่ใช่ WCI / ต่างประเทศ) · ระบบไม่ลงเดือนให้ พิมพ์ยอดลงช่องเดือนที่เลือกจ่ายเอง · รายการข้างล่างคือยอดตามตารางดอกเบี้ยรายเดือนไว้อ้างอิง' }),
    { sys: F.reduce((o, mk) => { o[mk] = 0; return o; }, {}) });
  const pickTyped = F.reduce((t, mk) => t + fcVal(pickRow, mk), 0);
  const pickCats = Array.from(new Set(fcSplit.pick.map(i => i.ref.split(' · ')[1]).filter(Boolean)));
  pickRow.sub = (pickCats.length ? pickCats.join(' · ') + ' · ' : '') + 'ตามตาราง ' + fundM(pickTotal) + ' · เลือกจ่ายแล้ว ' + fundM(pickTyped) + (pickTotal - pickTyped > 0.5 ? ' · ยังไม่ได้เลือก ' + fundM(pickTotal - pickTyped) : '');
  facRow.sub = 'ต้องจ่ายทั้งหมด ' + fundM(facTotal) + ' · เลือกจ่ายแล้ว ' + fundM(facTyped) + (facTotal - facTyped > 0.5 ? ' · ยังไม่ได้เลือก ' + fundM(facTotal - facTyped) : '');
  const FC_SECS = [
    { k: 'in', t: 'ก. คาดการณ์รับเงิน', tot: 'รวมรายรับ (ก)', groups: [
      { key: 'g1', t: '1. โครงการที่เซ็นแล้ว รอรับเงิน', rows: [
        fcAuto('iv', 'ออกใบแจ้งหนี้ (INV) แล้ว', ivItems, { badge: 'INV', color: FC_C.inv, rcvModal: true,
          sub: ivItems.length + ' รายการ' + (rcvSkip > 0.5 ? ' · ที่ยังไม่นับ = ไม่มีวันคาดรับ / รอตรวจรับ' : '') }),
        fcAuto('wipIn', 'งวดที่ยังไม่ออก INV (ประมาณ)', wipInItems, { badge: 'งวด', color: FC_C.est, head: wipHead,
          sub: wipList.length + ' โครงการ · ยังไม่ออก INV = รับเร็วสุดหลังวันนี้ ' + fc.invLag + ' วัน' + (Object.keys(fc.wip).length ? ' · แก้เอง ' + Object.keys(fc.wip).length + ' โครงการ' : '') + ' · กดเพื่อแก้รายโครงการ',
          how: 'โครงการที่กำลังทำ ยอดที่ยังไม่ออกใบแจ้งหนี้ · ปกติรับเงินหลังออก INV 30–45 วัน · แก้ยอด วันคาดออก INV หรือไม่นับ ได้รายโครงการ',
          extra: { th: 'ค่าติดตั้งที่ต้องจ่ายตาม', cell: (it) => instCell(it.io, it.inst || []) } }),
      ].concat(rcvOtherItems.length ? [fcAuto('rcvOther', 'รับอื่นที่คีย์ไว้ใน Bank Daily', rcvOtherItems, { badge: 'คีย์', color: FC_C.est, rcvModal: true })] : []) },
      { key: 'g2', t: '2. โครงการที่จะลงนาม (ฝ่ายขาย)', single: true, rows: [
        fcAuto('pipe', '2. โครงการที่จะลงนาม (ฝ่ายขาย)', fp.ev.rcv, { badge: 'ขาย', color: FC_C.pipe, sub: pipeN + ' โครงการ · ตามวันเซ็น + แบบรับเงิน · หัก ณ ที่จ่าย 1%',
          how: 'เงินรับจากราชการของโครงการในตาราง "โครงการที่จะลงนาม" (ไม่นับกลุ่มยังไม่แน่นอน) · วันรับ = วันเซ็น + จำนวนวันของแต่ละงวด' }),
      ] },
      { key: 'g3', t: '3. เงินกู้', add: 'loan', rows: fcMan('loan', FC_C.lit, 'กู้') },   // BIO: ไม่มี LIT · ตอนนี้มีแต่นิตาโฮลดิ้ง กรอกเอง
      { key: 'g4', t: '4. รับอื่นๆ', add: 'in', rows: (fc.more.lgBack ? [fcAuto('lgBack', 'เงินสดค้ำประกันครบกำหนดได้คืน', lgBackItems, { badge: 'คืน', color: FC_C.inx })] : []).concat(fcMan('in', FC_C.inx, 'รับ')) },
    ] },
    { k: 'out', t: 'ข. คาดการณ์ค่าใช้จ่าย', tot: 'รวมค่าใช้จ่าย (ข)', groups: [
      { key: 'g5', t: '1. ค่าใช้จ่ายประจำ', add: 'fixed', rows: fixedParts.map(p => ({ key: 'f:' + p.k, man: true, fixed: p, label: p.t, color: p.c, badge: p.b, vals: p.vals,
          sub: p.k === 'fin' ? 'ไม่รวมดอกเบี้ย (คิดในข้อ 3)' : p.k === 'sales' ? 'ไม่รวมค่าคอมโครงการใหม่ (คิดในข้อ 2)' : p.th })).concat(fcMan('fixed', '#7C8BA8', 'จ่าย')) },
      { key: 'g6', t: '2. ค่าใช้จ่ายเกี่ยวกับโครงการ', add: 'contractor', rows: [
        fcAuto('comm', fundN((cfg.fc || {}).comm) == null ? 'ค่าคอม (ยังไม่ตั้ง %)' : 'ค่าคอม ' + fmtNum(fc.comm, 1) + '%',   // BIO: ยังไม่ได้บอก %
        fp.ev.comm, { badge: 'คอม', color: FC_C.proj, sub: 'ของมูลค่าโครงการที่จะลงนาม · ' + (fc.commAt === 'rcv' ? 'จ่ายตามเงินรับ' : 'จ่ายวันเซ็น') }),
        fcAuto('inst', 'ค่าติดตั้ง ADV.', fp.ev.inst, { badge: 'ADV', color: FC_C.proj, sub: instUnk.length ? 'ยังไม่รู้ค่าติดตั้ง ' + instUnk.length + ' โครงการ' : 'ตามค่าติดตั้งต่อชุดของผลิตภัณฑ์ · จ่ายวันเซ็น',
          head: instUnk.length ? <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--warn-bg)', borderRadius: 8, fontSize: 12.5 }}>ยังไม่นับค่าติดตั้งของ: {instUnk.map(P => P.r.name + ' (' + P.inst.unk.join(', ') + ')').join(' · ')} — ใส่ค่าติดตั้งต่อชุดที่ "เงื่อนไขที่ใช้คิด" หรือใส่ยอดในโครงการ</div> : null }),
        fcAuto('lg', fundN(cfg.lgPct) == null ? 'หลักประกันสัญญา (ยังไม่ตั้ง %)' : 'หลักประกันสัญญา ' + fmtNum(Number(cfg.lgPct) || 0, 1) + '% (ส่วนที่ต้องวางเงินสด)',
        fp.ev.lg, { badge: 'LG', color: FC_C.proj, head: lgHead,
          sub: fundN(cfg.lgPct) == null ? 'ยังไม่นับ — ตั้ง % ที่ "เงื่อนไขที่ใช้คิด"' : lgRoom == null ? 'ยังไม่รู้วงเงิน LG' : lgCashFc > 0.5 ? 'วงเงิน LG ไม่พอ ต้องวางเงินสด ' + fundM(lgCashFc) : 'ใช้วงเงิน LG ได้ทั้งหมด (ต้องใช้ ' + fundM(lgNeedFc) + ')' }),
        fcAuto('lgFee', 'ค่าธรรมเนียม LG ' + fmtNum(fc.lgFee.rate, 2) + '% ต่อปี', fp.ev.lgFee, { badge: 'LG', color: FC_C.proj,   // เหมือน WTP (ผู้ใช้ 2026-11-12)
          sub: fundN(cfg.lgPct) == null ? 'ยังไม่นับ — ยังไม่ได้ตั้ง % หลักประกันสัญญา' : 'ค้ำ ' + fc.lgFee.yrs + ' ปี · ' + (fc.lgFee.pay === 'once' ? 'จ่ายครั้งเดียวตอนออก LG' : 'จ่ายปีละครั้ง ล่วงหน้า'),
          how: 'ยอดค้ำประกัน (หลักประกันสัญญาของโครงการที่จะลงนาม) × ' + fmtNum(fc.lgFee.rate, 2) + '% ต่อปี · ค้ำ ' + fc.lgFee.yrs + ' ปี · ' + (fc.lgFee.pay === 'once' ? 'จ่ายครั้งเดียวทั้งระยะตอนออก LG' : 'จ่ายปีละครั้งล่วงหน้า ปีแรกวันออก LG (วันเซ็น)') }),
      ].concat(fc.more.stamp ? [fcAuto('stamp', 'อากรแสตมป์สัญญา ' + FUND_FC_STAMP + '%', fp.ev.stamp, { badge: 'อากร', color: FC_C.proj })] : [],
        // ผู้ใช้ 2026-11-11: หลักประกัน + อากร อยู่ก่อนค่าติดตั้งงวด 1 (เรียง: คอม · ADV. · หลักประกัน · อากร · ติดตั้งงวด 1 · งวดสุดท้าย · ค่าของโรงงาน · ผู้รับเหมาอื่น)
        [
          fcAuto('inst1', 'ค่าติดตั้งงวด 1 — หลังรับเงินราชการงวด 1', fp.ev.inst1, { badge: 'ติดตั้ง', color: '#C2410C', sub: 'จ่ายหลังรับเงิน ' + fc.instPay + ' วัน', how: 'จ่ายหลังรับเงินราชการงวด 1 ' + fc.instPay + ' วัน' }),
          fcAuto('inst2', 'ค่าติดตั้งงวดสุดท้าย — หลังรับเงินราชการงวดสุดท้าย', fp.ev.inst2, { badge: 'ติดตั้ง', color: '#C2410C', sub: 'จ่ายหลังรับเงิน ' + fc.instPay + ' วัน', how: 'จ่ายหลังรับเงินราชการงวดสุดท้าย ' + fc.instPay + ' วัน' }),
          facRow
        ],
        fc.more.wip ? [fcAuto('wip', 'งานที่กำลังทำ: ต้นทุนที่เหลือ (ประมาณ)', wipItems, { badge: 'งาน', color: FC_C.con })] : [],
        fcMan('contractor', FC_C.con, 'ผรม')) },
      { key: 'g7', t: '3. ดอกเบี้ย', rows: [   // BIO: ตปท. ทุกเดือน · WCI ทุกไตรมาส · หมวดอื่นเลือกเดือนจ่ายเอง · ไม่มี INCOFIN / เช็ครอขึ้น / LIT
        fcAuto('intM', 'ต่างประเทศ — จ่ายทุกเดือน', fcSplit.month.concat(fcSplit.incofin), { badge: 'เดือน', color: FC_C.int, sub: (Array.from(new Set(fcSplit.month.map(i => i.ref.split(' · ')[1]).filter(Boolean))).join(' · ') || 'ตปท. / สกุลต่างประเทศ') + ' · จ่ายสิ้นเดือน',
          how: 'ดอกเบี้ยจากตาราง Debt Ledger ของสัญญาหมวด ตปท. และสัญญาสกุลต่างประเทศ · จ่ายทุกสิ้นเดือน · คูณอัตราแลกเปลี่ยนที่ตั้งไว้' }),
        fcAuto('intQ', 'WCI — จ่ายทุกไตรมาส', fcSplit.quarter, { badge: 'ไตรมาส', color: FC_C.int, sub: 'รวมดอกเบี้ย 3 เดือน จ่ายสิ้นเดือนไตรมาส (มี.ค. · มิ.ย. · ก.ย. · ธ.ค.)',
          how: 'ดอกเบี้ยจากตาราง Debt Ledger ของสัญญา WCI · รวม 3 เดือนไปจ่ายสิ้นเดือนไตรมาส' }),
        pickRow,
      ] },
      { key: 'g8', t: '4. คืนเงินกู้ และอื่นๆ', add: 'other', rows: [].concat(fc.more.principal ? [fcAuto('principal', 'เงินต้นเงินกู้เดิมที่ครบกำหนด', fcSplit.principal, { badge: 'ต้น', color: FC_C.oth, head: principalHead,
          sub: fcSplit.principal.length ? fcSplit.principal.length + ' สัญญาที่เลือกคืนจริง' : 'นับว่าต่อสัญญาทั้งหมด · กดเลือกคืนรายสัญญา' })] : [],
        fc.more.ap ? [fcAuto('ap', 'AP ที่ตั้งหนี้แล้วยังไม่จ่าย', apItems, { badge: 'AP', color: FC_C.oth, sub: jobs.ap.n + ' ใบ' + (jobs.ap.late > 0.5 ? ' · เลยกำหนดเกิน 30 วัน ' + fundM(jobs.ap.late) : '') })] : [],
        fcMan('other', FC_C.oth, 'จ่าย')) },
    ] },
  ];
  const fcAllRows = {};
  FC_SECS.forEach(s => s.groups.forEach(g => g.rows.forEach(r => { fcAllRows[r.key] = r; })));
  const fcGroupVals = (g) => F.map(mk => g.rows.reduce((s, r) => s + (r.neg ? -1 : 1) * fcVal(r, mk), 0));
  const fcSecVals = (s) => F.map((_, i) => s.groups.reduce((a, g) => a + fcGroupVals(g)[i], 0));
  const fcIn = fcSecVals(FC_SECS[0]), fcOut = fcSecVals(FC_SECS[1]);
  const fcOpen = [], fcClose = [];
  const fcOpening = fundFcOpening(accounts, fc), fcOpenAmt = fcOpening.amt;
  F.forEach((_, i) => { fcOpen[i] = i ? fcClose[i - 1] : fcOpenAmt; fcClose[i] = fcOpen[i] + fcIn[i] - fcOut[i]; });
  const fcSum = (arr) => arr.reduce((s, v) => s + v, 0);
  const fcInSum = fcSum(fcIn), fcOutSum = fcSum(fcOut);
  const fcNeg = F.map((mk, i) => ({ mk, v: fcClose[i] })).filter(x => x.v < -0.5);
  const fcGroupSum = (key) => { const g = FC_SECS.reduce((a, s) => a.concat(s.groups), []).find(x => x.key === key); return g ? fcSum(fcGroupVals(g)) : 0; };
  const fcWarn = [];
  // BIO: ค่าที่ผู้ใช้ยังไม่ได้บอก → ไม่ตั้งค่าเริ่ม (นับ 0) + เตือน · ผลิตภัณฑ์รอข้อมูล
  if (pipeN && fundN((cfg.fc || {}).comm) == null) fcWarn.push('ยังไม่ได้ตั้ง % ค่าคอมของ BIO — ตอนนี้นับ 0 (ตั้งได้ที่ "เงื่อนไขที่ใช้คิด" → แก้เงื่อนไข)');
  if (pipeN && fundN(cfg.lgPct) == null) fcWarn.push('ยังไม่ได้ตั้ง % หลักประกันสัญญาของ BIO — ตอนนี้นับ 0 (ตั้งได้ที่ "เงื่อนไขที่ใช้คิด" → แก้เงื่อนไข)');
  if (!FUND_PRODUCTS.length) fcWarn.push('ยังไม่มีรายการผลิตภัณฑ์ BIO (ราคา · ค่าติดตั้ง · ค่าของโรงงานต่อชุด) — ค่าติดตั้งและค่าของโรงงานของโครงการใหม่ยังไม่นับ');
  if (fixedParts.every(p => p.empty === F.length) && !extraRows.some(x => fcSecOf(x) === 'fixed')) fcWarn.push('ยังไม่ได้กรอกค่าใช้จ่ายประจำ (ข.1)' + (!noCf ? ' — จ่ายจริงเฉลี่ยจาก Cash Flow ราว ' + fundM(avgFixed) + '/เดือน ไว้เทียบ' : ''));
  if (!pipeN) fcWarn.push('ยังไม่มีโครงการที่จะลงนาม — เพิ่มในตาราง "โครงการที่จะลงนาม" ด้านล่าง (เลือกจากหน้าโครงการ หรือเพิ่มเอง)');
  if (pipeNoSign) fcWarn.push(pipeNoSign + ' โครงการยังไม่มีวันเซ็น — ยังไม่นับเงินรับ ค่าใช้จ่าย และเงินกู้');
  const facUnk = fp.per.filter(P => P.isNew && P.sign && P.fac && P.fac.unk.length);
  if (FUND_PRODUCTS.length && (instUnk.length || facUnk.length)) fcWarn.push('ยังไม่รู้ค่าติดตั้ง/ค่าของโรงงานของ ' + Math.max(instUnk.length, facUnk.length) + ' โครงการ (ไม่นับ) — ต้องระบุผลิตภัณฑ์ในโครงการ');
  if (pickTotal - pickTyped > 0.5) fcWarn.push('ดอกเบี้ยหมวดอื่น ' + fundM(pickTotal - pickTyped) + ' ยังไม่ได้เลือกเดือนจ่าย (ไม่นับ) — พิมพ์ยอดในแถว "หมวดอื่น — เลือกเดือนจ่ายเอง" ข้อ ข.3');   // BIO
  if (fp.ev.lgFee.length && !fc.ok.lgFeePay) fcWarn.push('รอยืนยัน: ค่าธรรมเนียม LG จ่ายปีละครั้งล่วงหน้า หรือครั้งเดียวทั้งระยะตอนออก LG (ตอนนี้นับ' + (fc.lgFee.pay === 'once' ? 'ครั้งเดียว' : 'ปีละครั้ง') + ') — ตั้งได้ที่เงื่อนไขที่ใช้คิด');
  if (facTotal - facTyped > 0.5) fcWarn.push('ค่าของโรงงาน ' + fundM(facTotal - facTyped) + ' ยังไม่ได้เลือกเดือนจ่าย (ไม่นับ) — พิมพ์ยอดในแถว "ค่าของโรงงาน" ข้อ ข.2');
  if (incList.length && !ov.incs) fcWarn.push('ยังไม่ได้นำเข้าไฟล์ดอกเบี้ย Incofin — ใช้ตารางดอกเบี้ยในระบบตามรอบไปก่อน (ปุ่มนำเข้าในแถว INCOFIN)');
  if (incNoFx.length) fcWarn.push('ดอกเบี้ย Incofin ตามไฟล์ยังไม่รวม — ใส่อัตราแลกเปลี่ยน ' + Array.from(new Set(incNoFx)).join('/'));
  if (litPer.length && fc.lit.limit == null) fcWarn.push('ยังไม่รู้วงเงิน LIT คงเหลือ — นับเบิกเต็มตามที่ติ๊ก');
  if (litPer.some(P => P.lit.cut || P.lit.why === 'วงเงินเต็ม')) fcWarn.push('วงเงิน LIT ไม่พอสำหรับทุกโครงการที่ติ๊ก');
  if (lgRoom == null && lgNeedFc > 0.5) fcWarn.push('ยังไม่รู้วงเงิน LG ที่ว่าง — ยังไม่นับเงินสดที่อาจต้องวางค้ำ ' + fundM(lgNeedFc));
  else if (lgCashFc > 0.5) fcWarn.push('วงเงิน LG ไม่พอ ต้องวางเงินสดค้ำเพิ่ม ' + fundM(lgCashFc));
  if (fcFxMissing.length) fcWarn.push('ดอกเบี้ยสัญญา ' + fcFxMissing.join('/') + ' ยังไม่รวม — ใส่อัตราแลกเปลี่ยนใน "เงื่อนไขที่ใช้คิด"');
  if (litPer.length && (!fc.ok.feeBase || !fc.ok.intPay)) fcWarn.push('รอยืนยันเงื่อนไข LIT: ' + [!fc.ok.feeBase && 'ค่าวิเคราะห์คิดจากยอดกู้หรือมูลค่าสัญญา', !fc.ok.intPay && 'ดอกเบี้ยจ่ายแบบไหน'].filter(Boolean).join(' · '));
  const fcAutoTotals = { principal: fcSplit.principal.reduce((s, e) => s + e.amt, 0), ap: apItems.reduce((s, e) => s + e.amt, 0),
    stamp: fp.per.reduce((s, P) => s + (P.isNew && P.sign && P.sign <= lastDay ? P.v * FUND_FC_STAMP / 100 : 0), 0),
    wip: wipItems.reduce((s, e) => s + e.amt, 0), lgBack: lgBackItems.reduce((s, e) => s + e.amt, 0) };
  const fcHints = { vat: 'เงินรับในแผนมี VAT ราว ' + fundM((fcGroupSum('g1') + fcGroupSum('g2')) * 7 / 106) + ' ก่อนหักภาษีซื้อ', principal: debtFc.rows.filter(d => d.inHz && d.treat === 'roll').length ? 'ครบ ' + fundM(debtFc.rows.filter(d => d.inHz && d.treat === 'roll').reduce((s, d) => s + d.bal * (d.fx || 0), 0)) + ' นับว่าต่อ' : '' };
  const doExportFc = () => {
    const lines = [{ label: 'เงินในบัญชีต้นเดือน', vals: F.reduce((o, mk, i) => Object.assign(o, { [mk]: fcOpen[i] }), {}), noTotal: true }];
    const put = (label, arr) => lines.push({ label, vals: F.reduce((o, mk, i) => Object.assign(o, { [mk]: arr[i] }), {}) });
    FC_SECS.forEach((s, si) => {
      lines.push({ label: s.t, vals: {} });
      s.groups.forEach(g => {
        if (!g.rows.length) return;
        if (!g.single) put('  ' + g.t, fcGroupVals(g));
        g.rows.forEach(r => put((g.single ? '  ' : '      ') + (r.neg ? '− ' : '') + (r.label || 'ไม่มีชื่อ'), F.map(mk => fcVal(r, mk))));
      });
      put(s.tot, si ? fcOut : fcIn);
    });
    lines.push({ label: 'รับ − จ่าย ของเดือน (ก − ข · ช่องเดือนไม่รวมเงินยกมา · ช่องรวม = ยกมา + ก − ข)', vals: F.reduce((o, mk, i) => Object.assign(o, { [mk]: fcIn[i] - fcOut[i] }), {}),
      tot: (fcOpen[0] || 0) + F.reduce((s, mk, i) => s + fcIn[i] - fcOut[i], 0) });
    lines.push({ label: 'เงินคงเหลือปลายเดือน (ต้นเดือน + ก − ข)', vals: F.reduce((o, mk, i) => Object.assign(o, { [mk]: fcClose[i] }), {}), noTotal: true });
    const ok = fundFcExport({ F, today, rangeLabel: bdafMShort(F[0]) + ' – ' + bdafMShort(F[F.length - 1]), lines, per: fp.per, fc });
    if (toast) toast(ok ? 'ส่งออก Excel แล้ว' : 'ส่งออกไม่สำเร็จ');
  };

  // เปิดหน้าใหม่: ตารางหนี้และ Cash Flow ยังมาจาก server ไม่ครบ ถ้าคำนวณจะขึ้น "เงินพอ" ผิดๆ → ยังไม่โชว์ตัวเลข
  const sync = WTPData.getSyncStatus ? WTPData.getSyncStatus() : null;
  if ((!(data.debtMaster || []).length && sync && !sync.time) || (cfState === 'loading' && !cf)) {
    return (
      <div className="page">
        <div className="page-head"><div><div className="page-title">แผนการเงินล่วงหน้า</div></div></div>
        <div className="card" style={{ padding: '20px 16px', textAlign: 'center', fontSize: 13, color: 'var(--ink-500)' }}>กำลังโหลดข้อมูลหนี้และ Cash Flow…</div>
      </div>
    );
  }

  /* ── หน้าตาตามแบบ Claude Design ของผู้ใช้ (2026-11-11 "ทำให้เหมือนอันนี้"):
   *   หัว → 1 ภาพรวม (ข้อสรุป + เงินในบัญชี + รับ − จ่าย = เหลือ) → 2 ตารางรายเดือน (การ์ดเงินต้นเดือน / ก / ข / ผลลัพธ์)
   *   → 3 โครงการที่จะลงนาม (พับได้ · จัดกลุ่มตามเดือนเซ็น) → 4 เงื่อนไขที่ใช้คิด + รายการที่อาจตกหล่น (พับได้)
   *   ช่องตัวเลขยังพิมพ์ทับได้เหมือนเดิม (FundCell) · โหมดนำเสนอซ่อนปุ่ม/ตัวแก้ (no-present) */
  const renderFc = () => {
    let ri = 0;
    const nM = F.length, lastI = nM - 1, lastMk = F[lastI];
    const sheetCols = 'minmax(320px, 2.3fr) repeat(' + nM + ', minmax(126px, 1fr)) minmax(140px, 1.1fr)';
    const sheetMin = 320 + nM * 126 + 140;
    const txt = (v) => (Math.abs(v) < 0.5 ? '–' : fundB(v));
    const numCls = (v) => (v < -0.5 ? ' neg' : Math.abs(v) < 0.5 ? ' zero' : '');
    const mil = (v) => (v < -0.5 ? '−' : '') + fundMil(v);
    const splitT = (t) => { const m = String(t).match(/^(\d+)\.\s*(.*)$/); return m ? [m[1], m[2]] : ['', String(t)]; };
    const lowI = F.reduce((m, mk, i) => (m == null || fcClose[i] < fcClose[m] ? i : m), null);
    const lastClose = fcClose[lastI];
    const facLeft = facTotal - facTyped;
    const balT = fc.open.bal === 'avail' ? 'ยอดใช้ได้' : 'ยอดคงเหลือ';
    const asOfT = fcOpening.asOf ? ' ณ ' + fmtDate(fcOpening.asOf) : '';
    // ป้ายเตือนบนแถว (แทนกล่องคำเตือนยาว) · กลุ่มที่พับอยู่โชว์ป้ายของแถวข้างในตัวแรก
    const chipOf = (row) => {
      switch (row.key) {
        case 'iv': return rcvSkip > 0.5 ? 'ยังไม่นับ ' + fundMil(rcvSkip) + ' ล้าน' : '';
        case 'lgFee': return fp.ev.lgFee.length && !fc.ok.lgFeePay ? 'รอยืนยันวิธีจ่าย' : '';
        case 'fac': return facLeft > 0.5 ? 'ยังไม่ได้เลือกจ่าย ' + fundMil(facLeft) + ' ล้าน' : '';
        case 'intPick': return pickTotal - pickTyped > 0.5 ? 'ยังไม่ได้เลือกจ่าย ' + fundMil(pickTotal - pickTyped) + ' ล้าน' : '';   // BIO
        case 'inst': return instUnk.length ? 'ยังไม่รู้ ' + instUnk.length + ' โครงการ' : '';
        case 'intInc': return incList.length && !ov.incs ? 'ยังไม่นำเข้าไฟล์' : incNoFx.length ? 'ยังไม่มีอัตราแลกเปลี่ยน' : '';
        case 'litIn': return litPer.length && fc.lit.limit == null ? 'ยังไม่รู้วงเงิน' : litPer.some(P => P.lit.cut) ? 'วงเงินไม่พอ' : '';
        case 'comm': return fundN((cfg.fc || {}).comm) == null && fp.per.length ? 'ยังไม่ตั้ง %' : '';   // BIO
        case 'lg': return fundN(cfg.lgPct) == null && fp.per.length ? 'ยังไม่ตั้ง %' : (lgRoom == null && lgNeedFc > 0.5 ? 'ยังไม่รู้วงเงิน LG' : lgCashFc > 0.5 ? 'LG ไม่พอ' : '');
        default: return '';
      }
    };
    const G_NOTE = { g3: 'ตอนนี้มีแต่นิตาโฮลดิ้ง · กรอกยอดที่จะเบิกเอง', g6: 'รวมจ่ายผู้รับเหมา' };

    /* ── แถวในตาราง ── */
    const itemEl = (row, single, num) => {
      const chip = chipOf(row);
      const vals = F.map(mk => fcVal(row, mk)), tot = fcSum(vals);
      const r = ri++;
      let name, note = row.sub || '', cellVal, sys, onCell, onFill = null, onDelete = null;
      if (row.auto) {
        const o = fc.ovr[row.key], nOvr = F.filter(mk => o && o[mk] != null).length;
        name = <button type="button" className="fund-xname" title="ดูที่มาของตัวเลข" onClick={() => (row.rcvModal ? setRcvOpen(true) : setSrcKey(row.key))}>{(row.neg ? 'หัก ' : '') + (single ? splitT(row.label)[1] : row.label)}<span className="fund-glink-go">ที่มา ›</span></button>;
        if (nOvr) note = (note ? note + ' · ' : '') + 'แก้เอง ' + nOvr + ' เดือน';
        cellVal = (mk) => (o && o[mk] != null ? Number(o[mk]) : null);
        sys = row.sys;
        onCell = (mk, v) => setOvr(row.key, mk, v);
      } else if (row.fixed) {
        const p = row.fixed, fill = fundFillPatch(F, p.vals);
        // BIO: กดชื่อแถว = ดู/แก้รายละเอียด · มีรายละเอียด → ช่องสีเทา = ผลรวม พิมพ์ทับรายเดือนได้
        name = p.det.length || canEdit
          ? <button type="button" className="fund-xname" title="ดูรายละเอียดรายการ" onClick={() => setDetK(p.k)}>{p.t}<span className="fund-glink-go">รายละเอียด ›</span></button>
          : <span className="fund-xname">{p.t}</span>;
        onCell = (mk, v) => setFixedCells(p.k, { [mk]: v });
        if (p.det.length) {
          const nT = p.typed.filter(v => v != null).length;
          note = (note ? note + ' · ' : '') + p.det.length + ' รายการ ' + fundB(p.detSum) + '/เดือน' + (nT ? ' · แก้เอง ' + nT + ' เดือน' : '');
          cellVal = (mk) => p.typed[F.indexOf(mk)];
          sys = F.reduce((o, mk) => { o[mk] = p.detSum; return o; }, {});
        } else {
          cellVal = (mk) => p.vals[F.indexOf(mk)];
          onFill = Object.keys(fill).length ? () => setFixedCells(p.k, fill) : null;
        }
      } else {
        const x = row.x, fill = fundFillPatch(F, row.vals), sug = x.sug ? FUND_FC_MORE.find(m => m.k === x.sug) : null;
        name = <FundNameInput value={x.name} disabled={!canEdit} onSave={nm => setExtra(x.id, { name: nm })} />;
        note = sug ? sug.why : 'กรอกเอง';
        cellVal = (mk) => row.vals[F.indexOf(mk)];
        onCell = (mk, v) => setExtraCells(x.id, { [mk]: v });
        onFill = Object.keys(fill).length ? () => setExtraCells(x.id, fill) : null;
        onDelete = () => delExtra(x);
      }
      return (
        <div key={row.key} className={'fund-xr ' + (single ? 'grp' : 'item') + (chip ? ' warn' : '') + (row.neg ? ' neg' : '')}>
          <div className="fund-xl">
            {single && <span className="fund-xnum">{num}</span>}
            <div className="fund-xlt">
              <div className="fund-xlh">{name}{chip && <span className="fund-xchip">{chip}</span>}</div>
              {note && <span className="fund-xnote">{note}</span>}
            </div>
            {canEdit && (onFill || onDelete) && (
              <span className="fund-xact no-present">
                {onFill && <button type="button" className="fund-gact" title="เติมเดือนที่ว่างด้วยยอดเดือนก่อนหน้า" onClick={onFill}>⇉</button>}
                {onDelete && <button type="button" className="fund-gact" title="ลบแถวนี้" onClick={onDelete}>✕</button>}
              </span>
            )}
          </div>
          {F.map((mk, i) => <div key={mk} className="fund-xc"><FundCell r={r} c={i} disabled={!canEdit} value={cellVal(mk)} sys={sys ? (sys[mk] || 0) : undefined} onChange={a => onCell(mk, a)} /></div>)}
          <div className={'fund-xt' + numCls(row.neg ? -tot : tot)}>{row.neg && Math.abs(tot) >= 0.5 ? '−' + fundB(tot) : txt(tot)}</div>
        </div>
      );
    };
    const groupEl = (g) => {
      const rows = g.rows, [num, label] = splitT(g.t);
      if (g.single && rows.length === 1) return itemEl(rows[0], true, num);
      const vals = fcGroupVals(g), folded = !!fold[g.key], tot = fcSum(vals);
      const chip = folded ? rows.map(chipOf).filter(Boolean)[0] : '';
      const note = !rows.length ? (G_NOTE[g.key] ? G_NOTE[g.key] + ' · ยังไม่มีรายการ' : 'ยังไม่มีรายการ') : G_NOTE[g.key] || '';
      return (
        <React.Fragment key={g.key}>
          <div className={'fund-xr grp' + (chip ? ' warn' : '')}>
            <div className="fund-xl">
              <span className="fund-xnum">{num}</span>
              <div className="fund-xlt">
                <div className="fund-xlh">
                  {rows.length
                    ? <button type="button" className="fund-xname" aria-expanded={!folded} title={folded ? 'กางรายการ' : 'พับรายการ'} onClick={() => setFold(f => Object.assign({}, f, { [g.key]: !f[g.key] }))}>{label}<span className="fund-xcaret"><FundIco d={folded ? FUND_ICO.right : FUND_ICO.down} size={14} /></span></button>
                    : <span className="fund-xname">{label}</span>}
                  {chip && <span className="fund-xchip">{chip}</span>}
                  {canEdit && g.add && <button type="button" className="fund-gadd-in no-present" onClick={() => { setFold(f => Object.assign({}, f, { [g.key]: false })); addExtraSec(g.add); }}>＋ เพิ่มรายการ</button>}
                </div>
                {note && <span className="fund-xnote">{note}</span>}
              </div>
            </div>
            {vals.map((v, i) => <div key={F[i]} className={'fund-xc num' + numCls(v)}>{txt(v)}</div>)}
            <div className={'fund-xt' + numCls(tot)}>{txt(tot)}</div>
          </div>
          {!folded && rows.map(r => itemEl(r, false))}
        </React.Fragment>
      );
    };
    const secEl = (s, si) => {
      const sum = si ? fcOut : fcIn;
      return (
        <section key={s.k} className={'fund-xsec fund-xbox ' + (si ? 'out' : 'in')} aria-label={s.t}>
          <div className="fund-xsech"><div className="fund-xsech-in">
            <span className="fund-xnum">{si ? 'ข' : 'ก'}</span><b>{s.t.replace(/^[กข]\.\s*/, '')}</b><span>{si ? 'เงินออก · รวมจ่ายผู้รับเหมาในข้อ 2' : 'เงินเข้า'}</span>
          </div></div>
          {s.groups.map(groupEl)}
          <div className="fund-xr sum">
            <div className="fund-xl">{s.tot}</div>
            {sum.map((v, i) => <div key={F[i]} className="fund-xc num">{txt(v)}</div>)}
            <div className="fund-xt">{txt(fcSum(sum))}</div>
          </div>
        </section>
      );
    };
    const secHead = (n, t, sub, right) => (
      <div className="fund-sh">
        <div>
          <div className="fund-sh-t"><span className="fund-sh-n" aria-hidden="true">{n}</span><h2>{t}</h2></div>
          {sub && <p>{sub}</p>}
        </div>
        {right}
      </div>
    );
    const foldHead = (n, t, stats, isOpen, onToggle) => (
      <button type="button" className="fund-fold" aria-expanded={isOpen} onClick={onToggle}>
        <span className="fund-sh-n" aria-hidden="true">{n}</span>
        <span className="fund-fold-m"><span className="fund-fold-t">{t}</span><span className="fund-fold-s">{stats}</span></span>
        <span className="fund-fold-r"><span>{isOpen ? 'ย่อ' : 'ดูรายละเอียด'}</span><span className="fund-fold-ic"><FundIco d={isOpen ? FUND_ICO.up : FUND_ICO.down} /></span></span>
      </button>
    );

    /* ── 1 ภาพรวม ── */
    const inParts = [['g1', 'เซ็นแล้ว รอรับเงิน'], ['g2', 'โครงการที่จะลงนาม'], ['g3', 'เงินกู้'], ['g4', 'รับอื่นๆ']]
      .map(([k, t], i) => ({ t, v: fcGroupSum(k), c: FUND_TILE_IN[i] })).filter((p, i) => i < 3 || Math.abs(p.v) > 0.5);
    const outParts = [['g5', 'ค่าใช้จ่ายประจำ'], ['g6', 'เกี่ยวกับโครงการ + ผู้รับเหมา'], ['g7', 'ดอกเบี้ย'], ['g8', 'คืนเงินกู้ / อื่นๆ']]
      .map(([k, t], i) => ({ t, v: fcGroupSum(k), c: FUND_TILE_OUT[i] }));
    const tileParts = (parts) => (
      <React.Fragment>
        <div className="fund-tile-bar" aria-hidden="true">{parts.filter(p => p.v > 0.5).map(p => <div key={p.t} style={{ flex: (p.v / 1e6) + ' 1 0', background: p.c }} />)}</div>
        <div className="fund-tile-rows">{parts.map(p => <div key={p.t}><i style={{ background: p.c }} /><span>{p.t}</span><b className="fund-num">{mil(p.v)}</b></div>)}</div>
      </React.Fragment>
    );
    const neg = fcNeg.length > 0, endNeg = lastClose < -0.5;
    const headline = neg && endNeg
      ? <>เงินไม่พอจ่ายตั้งแต่สิ้น {bdafMShort(fcNeg[0].mk)} — ถึงสิ้น {bdafMShort(lastMk)} ขาด <span className="neg">{fundMil(lastClose)} ล้านบาท</span></>
      : neg
        ? <>เงินไม่พอจ่ายช่วงสิ้น {bdafMShort(fcNeg[0].mk)}{fcNeg.length > 1 ? ' – ' + bdafMShort(fcNeg[fcNeg.length - 1].mk) : ''} (ต่ำสุดขาด <span className="neg">{fundMil(fcClose[lowI])} ล้าน</span>) — สิ้น {bdafMShort(lastMk)} กลับมาเหลือ <span className="pos">{fundMil(lastClose)} ล้านบาท</span></>
        : <>เงินพอจ่ายทุกเดือนถึงสิ้น {bdafMShort(lastMk)} — เหลือ <span className="pos">{fundMil(lastClose)} ล้านบาท</span></>;
    const subs = [];
    if (!neg && lowI != null && lowI !== lastI) subs.push('ต่ำสุดสิ้น ' + bdafMShort(F[lowI]) + ' เหลือ ' + fundMil(fcClose[lowI]) + ' ล้าน');
    if (pickTotal - pickTyped > 0.5) subs.push('ยังไม่รวมดอกเบี้ยหมวดอื่น ' + fundMil(pickTotal - pickTyped) + ' ล้าน ที่ยังไม่ได้เลือกเดือนจ่าย');   // BIO
    if (facLeft > 0.5) subs.push('ยังไม่รวมค่าของโรงงาน ' + fundMil(facLeft) + ' ล้าน ที่ยังไม่ได้เลือกเดือนจ่าย');
    const resC = endNeg ? '#FF9DA6' : '#8FE3C1';

    /* ── 3 โครงการที่จะลงนาม: กลุ่มตามเดือนเซ็น ── */
    const perBy = {};
    fp.per.forEach(P => { perBy[P.r.id] = P; });
    const gKey = (r) => { const P = perBy[r.id]; if (!P) return 'z'; if (!P.isNew) return 'a'; if (!P.sign) return 'y'; return 'm' + P.sign.slice(0, 7); };
    const gName = (k) => (k === 'z' ? 'ไม่นับในแผน' : k === 'a' ? 'เซ็นแล้ว รอรับเงิน' : k === 'y' ? 'ยังไม่มีวันเซ็น' : 'เซ็น ' + bdafMShort(k.slice(1)));
    const pjMap = {};
    ov.pipe.forEach(r => { const k = gKey(r); (pjMap[k] = pjMap[k] || []).push(r); });
    const sumP = (rows, fn) => rows.reduce((s, r) => { const P = perBy[r.id]; return s + (P ? Number(fn(P)) || 0 : 0); }, 0);
    const hasLit = (P) => !!(P && P.lit && P.lit.gross > 0.5);
    const pjGroups = Object.keys(pjMap).sort().map(k => {
      const rows = pjMap[k].slice().sort((a, b) => String(a.signDate || '').localeCompare(String(b.signDate || '')) || (Number(b.value) || 0) - (Number(a.value) || 0));
      return { k, label: gName(k), rows, val: rows.reduce((s, r) => s + (Number(r.value) || 0), 0),
        com: sumP(rows, P => P.comm), ins: sumP(rows, P => P.inst && P.inst.total), fac: sumP(rows, P => P.fac && P.fac.total),
        lgUse: sumP(rows, P => P.lgUse), lgCash: sumP(rows, P => P.lgCash), lgUnk: rows.some(r => perBy[r.id] && perBy[r.id].lgUnknown && perBy[r.id].lgNeed > 0.5),
        lit: sumP(rows, P => (hasLit(P) ? P.lit.net : 0)), litN: rows.filter(r => hasLit(perBy[r.id])).length, rcv: sumP(rows, P => P.rcvBase) };
    });
    const pjMax = Math.max(1, ...pjGroups.map(g => g.val));
    const peak = pjGroups.filter(g => g.k[0] === 'm').reduce((m, g) => (!m || g.rows.length > m.rows.length ? g : m), null);
    const gStr = (use, cash) => [use > 0.5 ? 'LG ' + fundB(use) : '', cash > 0.5 ? 'เงินสด ' + fundB(cash) : ''].filter(Boolean).join(' · ') || '–';
    const doExportPj = () => {
      const ok = fundPjExport({ groups: pjGroups, perBy, movedBy: {}, fc, today,   // BIO: ไม่มีแผนลงนามรายเดือน (ไม่มีการเลื่อนวันเซ็น)
        title: 'โครงการที่จะลงนาม (ฝ่ายขาย) · ข้อมูล ณ ' + fmtDate(today),
        sub: ov.pipe.length + ' โครงการ · มูลค่า ' + fundB(pipeTotal) + ' บาท · นับในแผน ' + pipeN + ' โครงการ' });
      if (toast) toast(ok ? 'ส่งออก Excel แล้ว' : 'ส่งออกไม่สำเร็จ');
    };
    const pjOpenOf = (g, i) => (fold['pj:' + g.k] != null ? !!fold['pj:' + g.k] : i === 0);
    const PJ_LIM = 5;
    const pjRow = (r) => {
      const P = perBy[r.id];
      const l1 = r.org || r.name, l2 = r.org ? (r.area || r.full || '') : [r.type, r.province].filter(Boolean).join(' · ');
      const prods = Array.from(new Set((r.items || []).filter(x => Number(x.qty) > 0).map(x => fundItemName(x) + (Number(x.qty) > 1 ? ' × ' + fmtNum(Number(x.qty), 0) : ''))));
      if (!prods.length && r.type) prods.push(r.type);
      return (
        <div key={r.id} className={'fund-pj-r row' + (P ? '' : ' off')} onClick={() => { if (!fundPresenting()) setEditRow(r); }}>
          <div className="fund-pj-name"><b>{l1}</b>{l2 && <span>{l2}</span>}{r.code && <span className="fund-num code">{r.code}</span>}</div>
          <div className="fund-pj-prods">{prods.map(t => <span key={t} className="fund-pj-prod">{t}</span>)}</div>
          <div className="r fund-num b">{fundB(r.value)}</div>
          <div className="fund-pj-when">
            {r.signDate ? <b>{bdafDShort(r.signDate)}</b> : <span className="fund-xchip">ยังไม่มีวันเซ็น</span>}
            <span>{P ? fundFcPayName(r, fc) + (P.sched.length ? ' · ' + P.sched.map(s => bdafDShort(s.date)).join(' · ') : '') : (FUND_GROUP_OF[r.group] || {}).t || 'ไม่นับ'}</span>
          </div>
          <div className="r fund-num">{P && P.comm > 0.5 ? fundB(P.comm) : '–'}</div>
          <div className="r fund-num" title={P && P.inst ? 'ADV. ' + fundB(P.inst.adv) + ' · งวด 1 ' + fundB(P.inst.i1) + ' · งวดสุดท้าย ' + fundB(P.inst.i2) : ''}>{P && P.inst ? (P.inst.unk.length && !(P.inst.total > 0.5) ? <span className="fund-xchip">ยังไม่รู้</span> : fundB(P.inst.total)) : '–'}</div>
          <div className="r fund-num" title={P && P.fac ? 'งวด ' + P.fac.p.map(fundB).join(' / ') : ''}>{P && P.fac ? (P.fac.unk.length && !(P.fac.total > 0.5) ? <span className="fund-xchip">ยังไม่รู้</span> : fundB(P.fac.total)) : '–'}</div>
          <div className="r fund-num s">{P && P.lgNeed > 0.5 ? (P.lgUnknown ? <span className="fund-xchip">ยังไม่รู้วงเงิน</span> : gStr(P.lgUse, P.lgCash)) : '–'}</div>
          <div className="r fund-num g">{P ? fundB(P.rcvBase) : '–'}</div>{/* BIO: แทนคอลัมน์เงินกู้ LIT */}
        </div>
      );
    };

    /* ── 4 เงื่อนไข + รายการที่อาจตกหล่น ── */
    const nMore = FUND_FC_MORE.filter(x => (x.auto ? !!fc.more[x.k] : extraRows.some(r => r.sug === x.k))).length;
    const issuers = fundLgIssuers(cfg);
    // BIO: ไม่มี LIT / INCOFIN / เช็ค · รับงวดเดียว · ผลิตภัณฑ์รอข้อมูล · % ที่ยังไม่บอก = "ยังไม่ได้ตั้ง"
    const unset = <span style={{ color: '#8A5300', fontWeight: 600 }}>ยังไม่ได้ตั้ง</span>;
    const kv = [
      ['เงินกู้', <>ตอนนี้มีแต่<b>นิตาโฮลดิ้ง</b> · ยอดที่จะเบิกกรอกเองในข้อ ก.3 · ดอกเบี้ยและเงินต้นของสัญญาเดิมตามตารางหนี้ในระบบ</>],
      ['ค่าคอม', fundN((cfg.fc || {}).comm) == null ? unset : <><b>{fmtNum(fc.comm, 1)}%</b> ของมูลค่าสัญญา · {fc.commAt === 'rcv' ? 'จ่ายตามเงินรับ' : 'จ่ายวันเซ็นสัญญา'}</>],
      ['หลักประกันสัญญา', fundN(cfg.lgPct) == null ? unset : <><b>{fmtNum(Number(cfg.lgPct) || 0, 1)}%</b> วันเซ็น · ใช้วงเงิน LG ก่อน ไม่พอวางเงินสด · {issuers.length ? 'ออก LG ใบใหม่ได้ที่ ' + issuers.join(' / ') : 'ยังไม่ได้เลือกธนาคารที่ออก LG ใบใหม่'}</>],
      ['ค่าธรรมเนียม LG', <><b>{fmtNum(fc.lgFee.rate, 2)}%</b> ต่อปีของยอดค้ำ · ค้ำ <b>{fc.lgFee.yrs} ปี</b> · {fc.ok.lgFeePay ? '' : 'ตอนนี้นับ'}{fc.lgFee.pay === 'once' ? 'จ่ายครั้งเดียวตอนออก LG' : 'จ่ายปีละครั้งล่วงหน้า'}{!fc.ok.lgFeePay && <> <span className="fund-xchip">รอยืนยัน</span></>}</>],
      ['รับเงินราชการ', <><b>งวดเดียว</b> {(fc.payTypes[0] && fc.payTypes[0].inst[0] && fc.payTypes[0].inst[0].d) || 120} วันหลังเซ็น · หัก ณ ที่จ่าย 1% · ถึงวันแล้วยังไม่ได้รับ = เลื่อน 30 วัน · ยังไม่ออก INV = รับหลังออก INV {fc.invLag} วัน</>],
      ['ผลิตภัณฑ์', FUND_PRODUCTS.length ? <>{FUND_PRODUCTS.length} รายการ · ค่าติดตั้ง/ค่าของโรงงานต่อชุดตั้งที่ "แก้เงื่อนไข"</> : <span style={{ color: '#8A5300' }}>รอข้อมูลผลิตภัณฑ์ BIO (ราคา · ค่าติดตั้ง · ค่าของโรงงาน) — ยังไม่นับค่าติดตั้ง/ค่าของโรงงาน</span>],
      ['ค่าของโรงงาน', <>เลือกเดือนจ่ายเอง (ต้องจ่ายทั้งหมด {fundM(facTotal)})</>],
      ['ดอกเบี้ยเงินกู้เดิม', <>ตาม Debt Ledger · <b>ตปท. จ่ายทุกเดือน</b> · <b>WCI จ่ายทุกไตรมาส</b> (สิ้นเดือนไตรมาส) · <b>หมวดอื่นเลือกเดือนจ่ายเอง</b> · ไม่มีตาราง = ประมาณจากยอดคงเหลือ × อัตรา</>],
    ].concat(fcFxCurs.length ? [['อัตราแลกเปลี่ยน', fcFxCurs.map(c => c + ' ' + (cfg.fx[c] ? fmtNum(Number(cfg.fx[c]), 2) + ' บาท' : 'ยังไม่ใส่')).join(' · ')]] : []);

    return (
      <div className="fund-stack" style={{ '--fund-cols': sheetCols }}>
        <header className="fund-hd">
          <div className="fund-hd-l">
            <div className="fund-hd-t"><h1>แผนการเงินล่วงหน้า</h1><span className="fund-pill">ข้อมูล ณ {bdafDShort(today)}</span></div>
            <p>{rangeLabel} · รับเงินเท่าไร จ่ายอะไรบ้าง เหลือเงินเท่าไร</p>
          </div>
          <div className="fund-hd-r no-present">
            <label>ดูถึง
              <select disabled={!canEdit} value={hz} onChange={e => setOpt('endMonth', e.target.value)}>
                {hzOpts.map(mk => <option key={mk} value={mk}>{bdafMShort(mk)}</option>)}
              </select>
            </label>
            <button type="button" className="fund-btn" onClick={doExportFc}><FundIco d={FUND_ICO.dl} />ส่งออก Excel</button>
          </div>
        </header>

        <section aria-label="ภาพรวม">
          {secHead(1, 'ภาพรวม ' + nM + ' เดือน')}
          <div className="fund-sum">
            <div>
              <span className="fund-sum-k">ข้อสรุป</span>
              <p className="fund-sum-h">{headline}</p>
              {subs.map((t, i) => <p key={i} className="fund-sum-s">{t}</p>)}
            </div>
            <div className="fund-eq">
              <div className="fund-tile" style={{ flex: '0.9 1 150px', background: '#F7F9FC', border: '1px solid #E2E8F0' }}>
                <span className="fund-tile-k" style={{ color: '#3D4A63' }}>เงินในบัญชีตอนนี้</span>
                <div className="fund-tile-v"><b className="fund-num" style={{ color: fcOpenAmt < -0.5 ? '#C2283A' : '#14213A' }}>{mil(fcOpenAmt)}</b><span>ล้าน</span></div>
                <span className="fund-tile-s">{balT} {fcOpening.n} จาก {fcOpening.of} บัญชี{fcOpening.asOf ? ' · ณ ' + fmtDate(fcOpening.asOf) : ''}</span>
              </div>
              <div className="fund-op" aria-hidden="true">+</div>
              <div className="fund-tile" style={{ flex: '1.3 1 220px', background: 'var(--fin-tile)', border: '1px solid var(--fin-tile-line)' }}>
                <span className="fund-tile-k" style={{ color: 'var(--fin-c)' }}><span className="fund-tag" style={{ background: 'var(--fin-c)' }}>ก</span>รวมรายรับ</span>
                <div className="fund-tile-v"><b className="fund-num" style={{ color: 'var(--fin-c)' }}>{mil(fcInSum)}</b><span style={{ color: 'var(--fin-sub)' }}>ล้าน</span></div>
                {tileParts(inParts)}
              </div>
              <div className="fund-op" aria-hidden="true">−</div>
              <div className="fund-tile" style={{ flex: '1.3 1 220px', background: '#FDF4EC', border: '1px solid #F3D9C4' }}>
                <span className="fund-tile-k" style={{ color: '#B14A0C' }}><span className="fund-tag" style={{ background: '#B14A0C' }}>ข</span>รวมค่าใช้จ่าย<span style={{ fontSize: 12.5, fontWeight: 400, color: '#8E4A1F' }}>รวมผู้รับเหมาแล้ว</span></span>
                <div className="fund-tile-v"><b className="fund-num" style={{ color: '#B14A0C' }}>{mil(fcOutSum)}</b><span style={{ color: '#8E4A1F' }}>ล้าน</span></div>
                {tileParts(outParts)}
              </div>
              <div className="fund-op" aria-hidden="true">=</div>
              <div className="fund-tile res" style={{ flex: '1.2 1 210px' }}>
                <span className="fund-tile-k" style={{ color: '#C9D3E3' }}>เงินคงเหลือสุทธิ · สิ้น {bdafMShort(lastMk)}</span>
                <div className="fund-tile-v"><b className="fund-num" style={{ color: resC }}>{mil(lastClose)}</b><span style={{ color: '#C9D3E3' }}>ล้าน</span></div>
                {(() => {
                  // เหมือน WTP (ผู้ใช้ 2026-11-12 "ทำให้ไบโอด้วย ... การ์ดคงเหลือสุทธิ"): ปลายช่วงติดลบ → รายการเริ่มที่เดือนแรกที่ติดลบ (ยอดที่ต่ำกว่าศูนย์)
                  //   แล้วเดือนต่อไป = ติดลบเพิ่ม/ลดของเดือนนั้น รวมกันได้ยอดขาดพอดี · ไม่ติดลบปลายช่วง → ยกมา + รับ − จ่ายแต่ละเดือน
                  //   สีชมพูเข้มขึ้นตามเดือน · เดือนที่รับมากกว่าจ่ายสีเขียว · แถบเรียงเดือนล่าสุดก่อน
                  const PINK = ['#FFC8CD', '#FFA3AD', '#FF7A87', '#F86A79', '#F05566', '#E3455A', '#D63447'];
                  const GREEN = ['#A8E9CF', '#93E2C3', '#7DDBB5', '#68D3A9', '#58CDA1', '#4CC79A', '#2AA97C'];
                  let items;
                  if (endNeg) {
                    const i0 = fcClose.findIndex(v => v < -0.5);
                    items = F.slice(i0).map((mk, j) => { const i = i0 + j, v = j ? fcClose[i] - fcClose[i - 1] : fcClose[i];
                      return { k: mk, t: bdafMShort(mk) + (j ? (v > 0.5 ? ' · รับมากกว่าจ่าย' : '') : ' · เริ่มติดลบ'), v, tip: j ? 'รับ − จ่ายของเดือน' : 'สิ้นเดือนติดลบ (ส่วนที่ต่ำกว่าศูนย์)' }; });
                  } else {
                    items = [{ k: 'open', t: 'ยกมา (เงินในบัญชี)', v: fcOpenAmt, open: true, tip: 'เงินในบัญชีตอนนี้' }]
                      .concat(F.map((mk, i) => ({ k: mk, t: bdafMShort(mk), v: fcIn[i] - fcOut[i], tip: 'รับ − จ่ายของเดือน' })));
                  }
                  const negs = items.filter(x => !x.open && x.v < -0.5), poss = items.filter(x => !x.open && x.v > 0.5);
                  const colorOf = (x) => {
                    if (x.open) return '#8DB8FF';
                    const arr = x.v < 0 ? negs : poss, pal = x.v < 0 ? PINK : GREEN, k = arr.indexOf(x);
                    return k < 0 ? '#AEB9CC' : pal[arr.length <= 1 ? pal.length - 2 : Math.round(k * (pal.length - 1) / (arr.length - 1))];
                  };
                  const bar = endNeg ? items.filter(x => Math.abs(x.v) > 0.5).reverse() : items.filter(x => x.v > 0.5).sort((p, q) => Math.abs(q.v) - Math.abs(p.v));
                  const worst = negs.reduce((m, x) => (!m || x.v < m.v ? x : m), null);
                  return (
                    <React.Fragment>
                      <span className="fund-tile-s" style={{ color: '#AEB9CC' }}>{endNeg ? 'ติดลบสะสมจากรับ − จ่ายของแต่ละเดือน' + (poss.length ? ' · เขียว = เดือนที่รับมากกว่าจ่าย' : '') : 'ยกมา + รับ − จ่ายของแต่ละเดือน'}</span>
                      <div className="fund-tile-bar res" aria-hidden="true">{bar.map(x => <div key={x.k} style={{ flex: (Math.abs(x.v) / 1e6) + ' 1 0', background: colorOf(x) }} />)}</div>
                      <div className="fund-res-legend">
                        {items.map(x => (
                          <div key={x.k} title={x.tip + ' · ' + fundB(x.v) + ' บาท'}>
                            <i style={{ background: colorOf(x) }} /><span>{x.t}</span>
                            <b className="fund-num" style={{ color: x.open ? '#fff' : x.v < -0.5 ? '#FF9DA6' : x.v > 0.5 ? '#7FE0B8' : '#AEB9CC' }}>{!x.open && x.v > 0.5 ? '+' : ''}{mil(x.v)}</b>
                          </div>
                        ))}
                      </div>
                      <div className="fund-tile-hr" />
                      <div className="fund-tile-net"><span>{endNeg ? 'รวมติดลบ · ขาดเงินสุทธิ' : 'เหลือเงินสุทธิ'}</span><b className="fund-num" style={{ color: resC }}>{fundMil(lastClose)} ล้าน</b></div>
                      <div className="fund-tile-chips">
                        {neg && <span className="fund-tile-chip" style={{ background: '#3A2433', color: '#FFC6CC' }}>{endNeg ? 'ติดลบตั้งแต่สิ้น ' : 'ติดลบช่วงสิ้น '}{bdafMShort(fcNeg[0].mk)}</span>}
                        {endNeg && worst && <span className="fund-tile-chip" style={{ background: '#3A2433', color: '#FFC6CC' }}>ติดลบเพิ่มมากสุด {bdafMShort(worst.k)} · {mil(worst.v)}</span>}
                        {!endNeg && lowI != null && <span className="fund-tile-chip" style={{ background: '#1F3A3A', color: '#BDEFD9' }}>ต่ำสุดสิ้น {bdafMShort(F[lowI])} · {mil(fcClose[lowI])} ล้าน</span>}
                      </div>
                    </React.Fragment>
                  );
                })()}
              </div>
            </div>
            {fcWarn.length > 0 && (
              <div className="fund-warn no-present">
                <button type="button" className="fund-warn-h" aria-expanded={!!fold.warn} onClick={() => setFold(f => Object.assign({}, f, { warn: !f.warn }))}>
                  <FundIco d={FUND_ICO.alert} size={17} /><b>ยังต้องดูอีก {fcWarn.length} เรื่อง</b>
                  {!fold.warn && <span className="t">{fcWarn[0]}</span>}
                  <span className="go">{fold.warn ? 'ซ่อน' : 'ดูทั้งหมด'}</span>
                </button>
                {fold.warn && <ul>{fcWarn.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              </div>
            )}
          </div>
        </section>

        <section aria-label="ประมาณการรับ-จ่ายรายเดือน">
          {secHead(2, 'ประมาณการรับ-จ่ายรายเดือน', 'อ่านจากบนลงล่าง: เงินต้นเดือน + ก − ข = เงินคงเหลือปลายเดือน', (
            <div className="fund-legend">
              <span style={{ background: 'var(--fin-soft)', color: 'var(--fin-c)' }}>ก รายรับ</span>
              <span style={{ background: '#FCEEE3', color: '#B14A0C' }}>ข ค่าใช้จ่าย</span>
              <span style={{ background: '#14213A', color: '#fff' }}>ผลลัพธ์</span>
              <span style={{ background: '#fff', border: '1px solid #D5DDE8', color: '#3D4A63' }}>หน่วย: บาท</span>
            </div>
          ))}
          <div className="fund-xscroll">
            <div className="fund-sheet" style={{ minWidth: sheetMin }}>
              <div className="fund-xr head">
                <div className="fund-xl">รายการ</div>
                {F.map(mk => <div key={mk} className="fund-xh"><b>{bdafMShort(mk)}</b>{mk === cm && <span>ที่เหลือของเดือน</span>}</div>)}
                <div className="fund-xh"><b>รวม {nM} เดือน</b></div>
              </div>
              <div className="fund-xr open tint">
                <div className="fund-xl"><span className="fund-xico" style={{ background: '#2463D1' }}><FundIco d={FUND_ICO.wallet} size={17} /></span><div className="fund-xlt">
                  <div className="fund-xlh"><span className="fund-xname">เงินในบัญชีต้นเดือน</span><button type="button" className="fund-xlink no-present" onClick={() => setOpenPick(true)}>เลือกบัญชี ›</button></div>
                  <span className="fund-xnote">เดือนแรก = {balT} {fcOpening.n}/{fcOpening.of} บัญชี{asOfT}</span>
                </div></div>
                {fcOpen.map((v, i) => <div key={F[i]} className={'fund-xc num' + numCls(v)}>{txt(v)}</div>)}
                <div className="fund-xt blank" />
              </div>
              {FC_SECS.map(secEl)}
              {(() => {   // ก − ข ของแต่ละเดือน ไม่รวมเงินยกมา · ช่องรวม = ยอดยกมา + ก − ข ทั้งช่วง = เงินคงเหลือสิ้นช่วง (เหมือน WTP · ผู้ใช้ 2026-11-12)
                const net = F.map((_, i) => fcIn[i] - fcOut[i]), tot = fcSum(net), carry = fcOpen[0] || 0, totC = carry + tot;
                const cls = (v) => (v < -0.5 ? ' neg' : v > 0.5 ? ' pos' : ' zero');
                const sgn = (v) => (v > 0.5 ? '+' : '') + txt(v);
                return (
                  <div className="fund-xr mnet tint">
                    <div className="fund-xl"><span className="fund-xico" style={{ background: '#3D4A63' }}>ก−ข</span><div className="fund-xlt"><span className="fund-xname">รับ − จ่าย ของเดือน (ก − ข)</span><span className="fund-xnote">ช่องเดือนไม่รวมเงินยกมา · ช่องรวม = ยกมา + ก − ข</span></div></div>
                    {net.map((v, i) => <div key={F[i]} className={'fund-xc num' + cls(v)}>{sgn(v)}</div>)}
                    <div className={'fund-xt col' + cls(totC)} title={'ยกมา ' + fundB(carry) + ' + ก − ข ทั้งช่วง ' + (tot > 0.5 ? '+' : '') + fundB(tot) + ' = ' + fundB(totC)}>
                      <span>{sgn(totC)}</span><span className="fund-xsub">รวมยกมา {mil(carry)} ล้าน</span>
                    </div>
                  </div>
                );
              })()}
              <div className="fund-xr res">
                <div className="fund-xl"><div className="fund-xlt"><span className="fund-xname">เงินคงเหลือปลายเดือน</span><span className="fund-xnote">= เงินต้นเดือน + ก − ข</span></div></div>
                {fcClose.map((v, i) => <div key={F[i]} className={'fund-xc num' + (v < -0.5 ? ' neg' : '') + (i === lastI ? ' hl' : '')}>{txt(v)}</div>)}
                <div className="fund-xt blank" />
              </div>
            </div>
          </div>
          <p className="fund-foot-note no-present">กดชื่อแถวดูที่มา · ตัวเลขสีเทา = ระบบคิด พิมพ์ทับได้ (ลบให้ว่าง = กลับไปใช้ยอดระบบ) · แถวกรอกเอง ช่องว่าง = 0 · พิมพ์ 2.5ล = 2,500,000 · กดชื่อกลุ่ม = พับ/กาง · ตัวเลขสีแดง = ติดลบ · – = ไม่มีรายการ</p>
        </section>

        <section aria-label="โครงการที่จะลงนาม">   {/* ผู้ใช้ 2026-11-11 ซ่อนข้อ 3–4 ตอนนำเสนอ → 2026-11-12 "แก้โหมดนำเสนอให้เห็นข้อ 3 ด้วย ทั้ง 2 บ." (ข้อ 4 ยังซ่อน) · ปุ่ม/ติ๊ก/หมายเหตุในข้อ 3 ยังเป็น no-present · กดแถวไม่เปิดฟอร์ม (fundPresenting) */}
          {foldHead(3, 'โครงการที่จะลงนาม (ฝ่ายขาย)', ov.pipe.length
            ? <>
                <span>{ov.pipe.length} โครงการ</span>
                <span>มูลค่า <b className="fund-num">{fundB(pipeTotal)}</b> บาท</span>
                {pipeN !== ov.pipe.length && <span>นับในแผน {pipeN}</span>}
                {litPer.length > 0 && <span>เบิก LIT {litPer.length} โครงการ</span>}
                {peak && <span>เซ็นมากสุด {bdafMShort(peak.k.slice(1))} · {peak.rows.length} โครงการ</span>}
              </>
            : <span>ยังไม่มีโครงการ — นำเข้าไฟล์ฝ่ายขาย หรือเลือกจากหน้าโครงการ</span>, !!open.pj, () => tog('pj'))}
          {open.pj && (
            <div className="fund-pj-wrap">
              {(canEdit || ov.pipe.length > 0) && (
                <div className="fund-pj-acts no-present">
                  {ov.pipe.length > 0 && <button type="button" className="fund-btn sm" onClick={doExportPj}><FundIco d={FUND_ICO.dl} size={16} />ส่งออก Excel</button>}
                  {canEdit && <button type="button" className="fund-btn sm" onClick={() => setImporting(true)}><FundIco d={FUND_ICO.ul} size={16} />นำเข้าไฟล์ฝ่ายขาย</button>}
                  {canEdit && <button type="button" className="fund-btn sm" onClick={() => setPicking(true)}>เลือกจากหน้าโครงการ</button>}
                  {canEdit && <button type="button" className="fund-btn sm pri" onClick={() => setEditRow({ group: 'soon', lender: 'auto', stage: 'pre', assignable: '', payType: fc.payTypes[0].id, useLit: false })}><FundIco d={FUND_ICO.plus} size={16} />เพิ่มเอง</button>}
                </div>
              )}
              {ov.pipe.length === 0
                ? <div className="fund-pj-empty">ยังไม่มีโครงการ · กด "นำเข้าไฟล์ฝ่ายขาย" (ไฟล์ Excel ของฝ่ายขาย) หรือ "เลือกจากหน้าโครงการ" (โครงการรอลงนาม — Type และ % งวดติดมาด้วย) หรือ "เพิ่มเอง" · ต้องมีวันคาดเซ็นถึงจะคิดเงินรับ ค่าใช้จ่าย และเงินกู้ได้</div>
                : (
                  <div className="fund-pj">
                    <div className="fund-pj-in">
                      <div className="fund-pj-r head">
                        <div className="pl">โครงการ</div><div>ผลิตภัณฑ์</div><div className="r">มูลค่าสัญญา</div><div>วันเซ็น → รับเงิน</div>
                        <div className="r">ค่าคอม</div><div className="r">ค่าติดตั้ง</div><div className="r">ค่าของโรงงาน</div><div className="r">หลักประกัน</div>
                        <div className="r">เงินรับจากราชการ (หัก 1%)</div>
                      </div>
                      {pjGroups.map((g, gi) => {
                        const isOpen = pjOpenOf(g, gi), all = !!pjMore[g.k], shown = all ? g.rows : g.rows.slice(0, PJ_LIM);
                        return (
                          <React.Fragment key={g.k}>
                            <div className="fund-pj-r grp">
                              <div><button type="button" className="fund-pj-gb" aria-expanded={isOpen} onClick={() => setFold(f => Object.assign({}, f, { ['pj:' + g.k]: !isOpen }))}>
                                <span className="fund-pj-gi"><FundIco d={isOpen ? FUND_ICO.down : FUND_ICO.right} size={16} /></span>
                                <span className="fund-pj-gt"><b>{g.label}</b><span>{g.rows.length} โครงการ</span></span>
                              </button></div>
                              <div />
                              <div className="r col"><b className="fund-num">{fundB(g.val)}</b><div className="fund-pj-bar" aria-hidden="true"><i style={{ width: Math.max(2, Math.round(g.val / pjMax * 100)) + '%' }} /></div></div>
                              <div />
                              <div className="r fund-num b">{txt(g.com)}</div>
                              <div className="r fund-num b">{txt(g.ins)}</div>
                              <div className="r fund-num b">{txt(g.fac)}</div>
                              <div className="r fund-num s">{g.lgUnk ? 'ยังไม่รู้วงเงิน' : gStr(g.lgUse, g.lgCash)}</div>
                              <div className="r fund-num b g">{txt(g.rcv)}</div>
                            </div>
                            {isOpen && shown.map(pjRow)}
                            {isOpen && g.rows.length > PJ_LIM && (
                              <div className="fund-pj-more"><button type="button" onClick={() => setPjMore(m => Object.assign({}, m, { [g.k]: !all }))}>{all ? 'ย่อเหลือ ' + PJ_LIM + ' โครงการ' : 'แสดงอีก ' + (g.rows.length - PJ_LIM) + ' โครงการ' + (g.k[0] === 'm' ? 'ของเดือนนี้' : '')}</button></div>
                            )}
                          </React.Fragment>
                        );
                      })}
                      <div className="fund-pj-r tot">
                        <div className="pl">รวมที่นับในแผน · {pipeN} โครงการ</div><div />
                        <div className="r fund-num b">{fundB(fp.per.reduce((s, P) => s + P.v, 0))}</div><div />
                        <div className="r fund-num b">{fundB(fp.per.reduce((s, P) => s + P.comm, 0))}</div>
                        <div className="r fund-num b">{fundB(fp.per.reduce((s, P) => s + (P.inst ? P.inst.total : 0), 0))}</div>
                        <div className="r fund-num b">{fundB(fp.per.reduce((s, P) => s + (P.fac ? P.fac.total : 0), 0))}</div>
                        <div className="r col">{lgCashFc > 0.5 && <b className="fund-num" style={{ color: '#FFD58A' }}>เงินสด {fundB(lgCashFc)}</b>}<span className="fund-num" style={{ fontSize: 12, color: '#AEB9CC' }}>LG {fundB(Math.max(0, lgNeedFc - lgCashFc))}</span></div>
                        <div className="r fund-num b" style={{ color: '#8FE3C1' }}>{fundB(fp.per.reduce((s, P) => s + P.rcvBase, 0))}</div>
                      </div>
                    </div>
                  </div>
                )}
              <p className="fund-foot-note no-present">กดแถวเพื่อแก้ (ผลิตภัณฑ์ · วันเซ็น · แบบรับเงิน · ค่าติดตั้ง) · เงินรับจากราชการ = มูลค่าสัญญา หัก ณ ที่จ่าย 1% (ลบใบแจ้งหนี้ที่ออกแล้ว) · กลุ่ม "ยังไม่แน่นอน" ไม่นับในแผน</p>
            </div>
          )}
        </section>

        <section className="no-present" aria-label="เงื่อนไขที่ใช้คิด และรายการที่อาจตกหล่น">
          {foldHead(4, 'เงื่อนไขที่ใช้คิด และรายการที่อาจตกหล่น', <>
            <span>รับเงินราชการงวดเดียว {(fc.payTypes[0] && fc.payTypes[0].inst[0] && fc.payTypes[0].inst[0].d) || 120} วัน · ค่าคอม {fundN((cfg.fc || {}).comm) == null ? 'ยังไม่ตั้ง' : fmtNum(fc.comm, 1) + '%'} · หลักประกัน {fundN(cfg.lgPct) == null ? 'ยังไม่ตั้ง' : fmtNum(Number(cfg.lgPct) || 0, 1) + '%'}</span>
            <span className="fund-xchip">รายการที่อาจตกหล่น นับแล้ว {nMore} จาก {FUND_FC_MORE.length}</span>
          </>, !!open.basis, () => tog('basis'))}
          {open.basis && (
            <div className="fund-basis">
              <div className="fund-bcard">
                <div className="fund-bcard-h"><span>เงื่อนไขที่ใช้คิด</span>
                  <button type="button" className="fund-mi-btn no-present" onClick={() => tog('fcSet')}>{open.fcSet ? 'ซ่อนที่ตั้งค่า' : canEdit ? 'แก้เงื่อนไข' : 'ดูที่ตั้งค่าทั้งหมด'}</button>
                </div>
                {kv.map(([k, v]) => <div key={k} className="fund-kv"><span>{k}</span><span>{v}</span></div>)}
              </div>
              <div className="fund-bcard">
                <div className="fund-bcard-h"><span>รายการที่อาจตกหล่น</span><span className="fund-xchip">นับแล้ว {nMore} จาก {FUND_FC_MORE.length}</span></div>
                {FUND_FC_MORE.map(x => {
                  const added = x.auto ? !!fc.more[x.k] : extraRows.some(r => r.sug === x.k);
                  const amt = x.auto ? fcAutoTotals[x.k] || 0 : null;
                  const where = x.sec === 'in' ? 'ก.4' : x.sec === 'con' ? 'ข.2' : 'ข.4';
                  const btn = x.auto ? (added ? 'เอาออก' : 'นับใน ' + where) : added ? '' : '＋ เพิ่มแถว';
                  return (
                    <div key={x.k} className="fund-mi">
                      <span className={'fund-mi-ic ' + (added ? 'on' : 'off')} aria-hidden="true">{added && <FundIco d={FUND_ICO.check} size={14} />}</span>
                      <div className="fund-mi-m"><b>{x.t}</b><span>{x.why}{fcHints[x.k] ? ' · ' + fcHints[x.k] : ''}</span></div>
                      <div className="fund-mi-r">
                        {amt != null
                          ? (amt > 0.5 ? <b className={'fund-num' + (x.sec === 'in' ? ' g' : added ? '' : ' w')}>{(x.sec === 'in' ? '+' : '') + fundMil(amt)} ล้าน</b> : <span className="mute">ไม่มีในช่วงนี้</span>)
                          : <span className="mute">{added ? 'กรอกยอดในตาราง' : 'ยังไม่มียอด'}</span>}
                        <span className={'st ' + (added ? 'on' : 'off')}>{added ? 'นับแล้ว · ' + where : 'ยังไม่นับ' + (x.auto ? ' · ใส่ได้ที่ ' + where : '')}</span>
                        {canEdit && btn && <button type="button" className="fund-mi-btn no-present" onClick={() => {
                          if (x.auto) setFc(f => { f.more = Object.assign({}, f.more, { [x.k]: !added }); return f; });
                          else { addExtraSec(x.sec === 'con' ? 'contractor' : x.sec === 'in' ? 'in' : 'other', x.t, x.k); if (toast) toast('เพิ่มแถว "' + x.t + '" แล้ว กรอกยอดในตารางรายเดือน'); }
                        }}>{btn}</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {open.fcSet && (
                <div className="fund-bcard no-present" style={{ gridColumn: '1 / -1', padding: '16px 8px 8px' }}>
                  <div className="fund-bcard-h" style={{ padding: '0 16px' }}><span>{canEdit ? 'แก้เงื่อนไขที่ใช้คิด' : 'ค่าที่ตั้งไว้ทั้งหมด'}</span><span className="mute" style={{ fontSize: 12.5, fontWeight: 400 }}>แก้แล้วทุกคนเห็นตัวเลขเดียวกัน</span></div>
                  <FundFcSettings fc={fc} cfg={cfg} canEdit={canEdit} setFc={setFc} setOpt={setOpt} setFx={setFx} setLgFree={setLgFree} setLgIssue={setLgIssue}
                    lgBanks={lgBanks} lgBook={lgBook} litUsed={litUsedFc} fxCurs={fcFxCurs} incofins={incList} incs={ov.incs} onIncImport={() => setIncImporting(true)} />
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="fund-foot"><span>BIOAXEL · Financial Console · แผนการเงินล่วงหน้า</span><span>ภาพรวม: ล้านบาท · ตาราง: บาท · ข้อมูล ณ {bdafDShort(today)}</span></footer>
      </div>
    );
  };

  return (
    <div className="page present-page fund-page">
      <style>{`
        .fund-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
        .fund-tbl th { text-align: right; font-size: 12px; font-weight: 600; color: var(--ink-600); background: var(--ink-50); padding: 7px 10px; white-space: nowrap; border-bottom: 1px solid var(--line); }
        .fund-tbl th:first-child, .fund-tbl th.l { text-align: left; }
        .fund-tbl td { padding: 6px 10px; border-bottom: 1px solid var(--line-soft); }
        .fund-tbl tr.total td { background: #f3f8ff; border-top: 1.5px solid var(--brand-200); }
        .fund-tbl tr.gap td { background: #fff4f2; }
        .fund-tbl tr.ok td { background: #f0fdf4; }
        .fund-tbl tr.link:hover td { background: var(--brand-50); }
        .fund-wrap { overflow-x: auto; }
        .fund-gcell { width: 100%; min-width: 86px; box-sizing: border-box; border: 1px solid transparent; border-radius: 8px; background: transparent; text-align: right; padding: 8px 9px; font: inherit; font-size: 13px; font-variant-numeric: tabular-nums; color: #1B2A4A; outline: none; transition: background .12s, border-color .12s, box-shadow .12s; }
        .fund-gcell::placeholder { color: #C9D2E1; }
        .fund-gcell:hover:not(:disabled) { background: #EEF3FD; }
        .fund-gcell:focus { background: #fff; border-color: #2F5FD0; box-shadow: 0 0 0 3px rgba(47,95,208,.14); }
        .fund-gcell:disabled { color: #1B2A4A; -webkit-text-fill-color: #1B2A4A; opacity: 1; }
        .fund-gname { width: 140px; border: 1px solid transparent; border-radius: 6px; background: transparent; font: inherit; font-weight: 700; font-size: 13.5px; color: #1B2A4A; padding: 2px 6px; margin-left: -7px; outline: none; }
        .fund-gname::placeholder { color: #A9B4C8; font-weight: 600; }
        .fund-gname:hover:not(:disabled) { background: #EEF3FD; }
        .fund-gname:focus { background: #fff; border-color: #2F5FD0; }
        .fund-gact { opacity: 0; border: none; background: none; cursor: pointer; color: #7C8BA8; font-size: 13px; padding: 3px 5px; border-radius: 6px; font-family: inherit; transition: opacity .12s; }
        .fund-xr:hover .fund-gact, .fund-gact:focus { opacity: 1; }
        .fund-gact:hover { background: #EEF2F9; color: #2F5FD0; }
        @media (hover: none) { .fund-gact { opacity: .75; } }
        .fund-tbl.fund-sticky-head thead th { position: sticky; top: 0; z-index: 2; }
        .fund-glink-go { font-size: 11px; color: #2F5FD0; margin-left: 6px; opacity: 0; transition: opacity .12s; }
        .fund-xr:hover .fund-glink-go, .fund-xname:focus .fund-glink-go { opacity: 1; }
        @media (hover: none) { .fund-glink-go { opacity: .8; } }
        .fund-gcell.sys { color: #5B6B86; }
        .fund-gcell.ovr { color: #2F5FD0; font-weight: 700; background: #F3F7FF; }
        .fund-gadd-in { border: none; background: none; color: #2F5FD0; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; margin-left: 10px; padding: 1px 6px; border-radius: 6px; opacity: .55; }
        .fund-xr:hover .fund-gadd-in, .fund-gadd-in:focus { opacity: 1; background: #EEF3FD; }
        /* ── หน้าตาตามแบบ Claude Design ของผู้ใช้ (2026-11-11) ── */
        .fund-page { --fx-ink: #14213A; --fx-ink2: #3D4A63; --fx-mute: #5E6A82; --fx-line: #E2E8F0; --fx-neg: #C2283A; color: var(--fx-ink); }
        /* สีฝั่งรายรับ (ก) — BIO = เขียว (ตามแบบ Claude Design) · ค่าอื่นเหมือนกันทั้ง 2 บริษัท */
        .fund-page { --fin-c: #0B7255; --fin-bar: #085E46; --fin-soft: #E6F4EE; --fin-grp: #F1F8F4; --fin-gtot: #E2F1E9; --fin-sep: #CFE3D9; --fin-sub: #2F6B57; --fin-tile: #F0F8F4; --fin-tile-line: #CDE8DC; --fin-p2: #3DAA82; --fin-p3: #9FD8C1; --fin-p4: #CDEBDD; --fin-on-dark: #8FE3C1; }
        .fund-page .fund-num { font-family: 'IBM Plex Sans', 'IBM Plex Sans Thai', sans-serif; font-variant-numeric: tabular-nums; }
        .fund-page .mute { color: var(--fx-mute); }
        .fund-stack { display: flex; flex-direction: column; gap: 44px; }
        .fund-hd { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 24px; }
        .fund-hd-t { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .fund-hd h1 { margin: 0; font-size: 34px; line-height: 1.2; font-weight: 700; letter-spacing: -.01em; color: var(--fx-ink); }
        .fund-pill { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 999px; background: #E3EBF8; color: #1F4E9E; font-size: 13px; font-weight: 600; }
        .fund-hd p { margin: 8px 0 0; font-size: 16px; color: var(--fx-ink2); }
        .fund-hd-r { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
        .fund-hd-r label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 500; color: var(--fx-mute); }
        .fund-hd-r select { height: 44px; min-width: 140px; padding: 0 12px; border: 1px solid #CBD5E1; border-radius: 10px; background: #fff; font-family: inherit; font-size: 15px; color: var(--fx-ink); }
        .fund-btn { height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 18px; border: 1px solid #CBD5E1; border-radius: 10px; background: #fff; font-family: inherit; font-size: 15px; font-weight: 600; color: var(--fx-ink); cursor: pointer; white-space: nowrap; }
        .fund-btn:hover { border-color: #94A3B8; background: #F8FAFC; }
        .fund-btn.sm { height: 42px; padding: 0 15px; font-size: 14px; }
        .fund-btn.pri { background: #2463D1; border-color: #2463D1; color: #fff; }
        .fund-btn.pri:hover { background: #1A4CA6; }
        .fund-sh { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
        .fund-sh-t { display: flex; align-items: center; gap: 12px; }
        .fund-sh-t h2 { margin: 0; font-size: 22px; font-weight: 700; color: var(--fx-ink); }
        .fund-sh p { margin: 6px 0 0 42px; font-size: 14px; color: var(--fx-mute); }
        .fund-sh-n { width: 30px; height: 30px; flex: 0 0 30px; display: flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--fx-ink); color: #fff; font-size: 14px; font-weight: 700; }
        .fund-legend { display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; }
        .fund-legend span { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 999px; font-weight: 600; box-sizing: border-box; }
        /* 1 ภาพรวม */
        .fund-sum { background: #fff; border: 1px solid var(--fx-line); border-radius: 18px; padding: clamp(20px, 3vw, 32px); display: flex; flex-direction: column; gap: 28px; }
        .fund-sum-k { font-size: 14px; font-weight: 600; color: var(--fx-mute); }
        .fund-sum-h { margin: 8px 0 0; font-size: clamp(21px, 2.3vw, 29px); line-height: 1.35; font-weight: 700; color: var(--fx-ink); text-wrap: balance; }
        .fund-sum-h .neg { color: var(--fx-neg); }
        .fund-sum-h .pos { color: #0B7255; }
        .fund-sum-s { margin: 6px 0 0; font-size: 15px; color: var(--fx-ink2); }
        .fund-eq { display: flex; flex-wrap: wrap; align-items: stretch; gap: 12px; }
        .fund-op { flex: 0 0 40px; height: 40px; align-self: center; display: flex; align-items: center; justify-content: center; border-radius: 999px; background: #fff; border: 1px solid #D5DDE8; font-size: 22px; font-weight: 600; color: var(--fx-ink2); }
        .fund-tile { display: flex; flex-direction: column; gap: 10px; padding: 20px; border-radius: 14px; min-width: 0; box-sizing: border-box; }
        .fund-tile.res { background: #14213A; color: #fff; }
        .fund-tile-k { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .fund-tag { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; color: #fff; font-size: 12px; font-weight: 700; }
        .fund-tile-v { display: flex; align-items: baseline; gap: 6px; }
        .fund-tile-v b { font-size: 36px; line-height: 1.1; font-weight: 700; }
        .fund-tile-v span { font-size: 16px; font-weight: 500; color: var(--fx-mute); }
        .fund-tile-s { font-size: 13px; color: var(--fx-mute); }
        .fund-tile-bar { display: flex; gap: 2px; height: 8px; border-radius: 999px; overflow: hidden; background: rgba(20, 33, 58, .05); }
        .fund-tile-rows { display: flex; flex-direction: column; gap: 4px; font-size: 13.5px; color: var(--fx-ink2); }
        .fund-tile-rows > div { display: flex; align-items: center; gap: 8px; }
        .fund-tile-rows i { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 8px; }
        .fund-tile-rows span { flex: 1 1 auto; }
        .fund-tile-rows b { font-weight: 600; color: var(--fx-ink); }
        .fund-tile-hr { height: 1px; background: #2E3B55; }
        .fund-tile-bar.res { height: 10px; background: rgba(255,255,255,.08); }
        .fund-res-legend { display: flex; flex-direction: column; gap: 5px; font-size: 14px; color: #E2E8F0; }
        .fund-res-legend > div { display: flex; align-items: center; gap: 10px; }
        .fund-res-legend i { width: 9px; height: 9px; border-radius: 2px; flex: 0 0 9px; }
        .fund-res-legend span { flex: 1 1 auto; min-width: 0; }
        .fund-res-legend b { font-weight: 700; white-space: nowrap; }
        .fund-tile-net { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 14px; font-weight: 700; }
        .fund-tile-net b { font-size: 18px; }
        .fund-tile-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .fund-tile-chips:empty { display: none; }
        .fund-tile-chip { align-self: flex-start; display: inline-flex; align-items: center; min-height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; }
        .fund-warn { border: 1px solid #F1DCB0; background: #FFF8EB; border-radius: 12px; color: #8A5300; font-size: 13.5px; }
        .fund-warn-h { width: 100%; min-height: 44px; display: flex; align-items: center; gap: 10px; padding: 8px 14px; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; text-align: left; box-sizing: border-box; }
        .fund-warn-h b { white-space: nowrap; }
        .fund-warn-h .t { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #7A5410; font-weight: 400; }
        .fund-warn-h .go { margin-left: auto; flex: 0 0 auto; font-weight: 600; color: #2463D1; }
        .fund-warn ul { margin: 0; padding: 0 16px 12px 41px; line-height: 1.75; }
        /* 2 ตารางรายเดือน (แถว = grid คอลัมน์เดียวกันทุกการ์ด) */
        .fund-xscroll { overflow-x: auto; padding-bottom: 4px; }
        .fund-sheet { display: flex; flex-direction: column; gap: 12px; }
        .fund-xr { display: grid; grid-template-columns: var(--fund-cols); align-items: stretch; }
        .fund-xr > div { min-width: 0; }
        .fund-xbox { background: #fff; border: 1px solid var(--fx-line); border-radius: 14px; overflow: clip; }
        .fund-xl { position: sticky; left: 0; z-index: 1; background: inherit; padding: 12px 20px; display: flex; align-items: center; gap: 12px; box-sizing: border-box; }
        .fund-xlt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
        .fund-xlh { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; }
        .fund-xname { border: 0; background: none; padding: 0; font: inherit; text-align: left; color: inherit; }
        button.fund-xname { cursor: pointer; }
        button.fund-xname:hover { text-decoration: underline; text-decoration-color: #B8C4D6; text-underline-offset: 3px; }
        .fund-xcaret { display: inline-flex; vertical-align: -2px; margin-left: 6px; color: #94A3B8; }
        .fund-xnote { font-size: 12.5px; line-height: 1.45; color: var(--fx-mute); }
        .fund-xchip { display: inline-flex; align-items: center; min-height: 22px; padding: 0 9px; border-radius: 999px; background: #FFF2DC; color: #8A5300; font-size: 12px; font-weight: 600; white-space: nowrap; }
        .fund-xact { margin-left: auto; display: flex; flex-shrink: 0; }
        .fund-xnum { width: 26px; height: 26px; flex: 0 0 26px; display: flex; align-items: center; justify-content: center; border-radius: 7px; background: var(--t-c, #14213A); color: #fff; font-family: 'IBM Plex Sans', 'IBM Plex Sans Thai', sans-serif; font-size: 13px; font-weight: 700; }
        .fund-xc { padding: 4px 6px; display: flex; align-items: center; justify-content: flex-end; font-family: 'IBM Plex Sans', 'IBM Plex Sans Thai', sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .fund-xc.num { padding: 12px 16px; }
        .fund-xt { padding: 12px 20px 12px 16px; display: flex; align-items: center; justify-content: flex-end; border-left: 1px solid var(--fx-line); font-family: 'IBM Plex Sans', 'IBM Plex Sans Thai', sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .fund-xc.zero, .fund-xt.zero { color: var(--fx-mute) !important; font-weight: 400 !important; }
        .fund-xr.head { align-items: end; font-size: 13px; font-weight: 600; color: var(--fx-mute); }
        .fund-xr.head .fund-xl { background: var(--bg, #F4F7FB); padding: 0 20px 6px; }
        .fund-xh { padding: 0 16px 6px; display: flex; flex-direction: column; align-items: flex-end; text-align: right; }
        .fund-xh b { font-size: 14px; color: var(--fx-ink); }
        .fund-xh span { font-size: 12px; font-weight: 500; }
        .fund-xr.open { min-height: 64px; }
        .fund-xr.open .fund-xname { font-size: 15px; font-weight: 700; }
        .fund-xr.open .fund-xc { font-size: 15px; font-weight: 600; color: var(--fx-ink); }
        .fund-xt.blank { background: #F7F9FC; }
        /* แถว ก − ข + แถวเงินต้นเดือน: พื้นฟ้าอ่อน (เหมือน WTP · ผู้ใช้ 2026-11-12) */
        .fund-xr.mnet { min-height: 64px; }
        .fund-xr.mnet .fund-xname { font-size: 15.5px; font-weight: 700; color: var(--fx-ink); }
        .fund-xr.mnet .fund-xc { font-size: 15.5px; font-weight: 700; }
        .fund-xr.mnet .fund-xt { font-size: 16px; font-weight: 800; }
        .fund-sheet .fund-xr.mnet .fund-xc.pos, .fund-sheet .fund-xr.mnet .fund-xt.pos { color: #0B7255; }
        .fund-xr.tint { background: #EAF0FA; border: 1px solid #C3D2EA; border-radius: 14px; overflow: clip; min-height: 72px; }
        .fund-xr.tint .fund-xt { background: #DDE6F5; border-left-color: #C3D2EA; }
        .fund-xr.tint .fund-xnote { color: #46526A; }
        .fund-xico { width: 32px; height: 32px; flex: 0 0 32px; display: flex; align-items: center; justify-content: center; border-radius: 9px; color: #fff; font-size: 11.5px; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
        .fund-xt.col { flex-direction: column; align-items: flex-end; justify-content: center; gap: 1px; }
        .fund-xsub { font-size: 11.5px; font-weight: 500; color: #46526A; }
        .fund-xlink { border: 0; background: none; padding: 0; font: inherit; font-size: 13px; font-weight: 600; color: #2463D1; cursor: pointer; }
        .fund-xlink:hover { color: #1A4CA6; text-decoration: underline; }
        .fund-xsec.in { --t-c: var(--fin-c); --t-soft: var(--fin-soft); --t-grp: var(--fin-grp); --t-gtot: var(--fin-gtot); --t-sep: var(--fin-sep); --t-bar: var(--fin-bar); --t-sub: var(--fin-sub); }
        .fund-xsec.out { --t-c: #B14A0C; --t-soft: #FCEEE3; --t-grp: #FDF5EE; --t-gtot: #F9E6D6; --t-sep: #EED8C6; --t-bar: #943D09; --t-sub: #8E4A1F; }
        .fund-xsech { min-height: 50px; display: flex; align-items: center; background: var(--t-soft); }
        .fund-xsech-in { position: sticky; left: 0; display: flex; align-items: center; gap: 10px; padding: 0 20px; }
        .fund-xsech-in b { font-size: 16px; color: var(--t-c); }
        .fund-xsech-in span:last-child { font-size: 13px; color: var(--t-sub); }
        .fund-xr.grp { background: var(--t-grp); border-top: 1px solid var(--t-sep); min-height: 58px; }
        .fund-xr.grp .fund-xname { font-size: 15.5px; font-weight: 700; color: var(--fx-ink); }
        .fund-xr.grp .fund-xnote { color: #46526A; }
        .fund-xr.grp .fund-xc { font-size: 15.5px; font-weight: 700; color: var(--fx-ink); }
        .fund-xr.grp .fund-xt { background: var(--t-gtot); font-size: 15.5px; font-weight: 700; color: var(--fx-ink); }
        .fund-xr.item { background: #fff; border-top: 1px solid #F0F3F7; min-height: 48px; }
        .fund-xr.item .fund-xl { padding: 8px 20px 8px 58px; }
        .fund-xr.item .fund-xname { font-size: 14px; color: var(--fx-ink2); }
        .fund-xr.item .fund-xc { font-size: 14px; color: #46526A; }
        .fund-xr.item .fund-xt { background: #F9FAFC; font-size: 14px; font-weight: 500; color: #46526A; }
        .fund-xr.item:hover { background: #F8FAFE; }
        .fund-xr.warn { background: #FFF8EB; }
        .fund-xr.neg .fund-xc, .fund-xr.neg .fund-xt { color: var(--fx-neg); }
        .fund-sheet .fund-xr .fund-xc.neg, .fund-sheet .fund-xr .fund-xt.neg { color: var(--fx-neg); }
        .fund-xr.sum { background: var(--t-c); color: #fff; min-height: 56px; font-size: 16px; font-weight: 700; }
        .fund-xr.sum .fund-xt { background: var(--t-bar); border-left-color: transparent; font-size: 17px; }
        .fund-xr.res { background: #14213A; color: #fff; border-radius: 14px; overflow: clip; min-height: 78px; font-size: 17px; font-weight: 700; }
        .fund-xr.res .fund-xname { font-size: 17px; font-weight: 700; color: #fff; }
        .fund-xr.res .fund-xnote { color: #AEB9CC; }
        .fund-sheet .fund-xr.res .fund-xc.neg { color: #FF9DA6; }
        .fund-xr.res .fund-xc.hl { background: #22304D; font-size: 19px; }
        .fund-xr.res .fund-xc.hl.neg { background: #2B1D2E; }
        .fund-xr.res .fund-xt.blank { background: transparent; border-left-color: #2E3B55; }
        .fund-sheet .fund-gcell { color: inherit; font-size: inherit; font-weight: inherit; padding: 7px 10px; }
        .fund-sheet .fund-gcell.sys { color: inherit; }
        .fund-sheet .fund-gcell:disabled { color: inherit; -webkit-text-fill-color: currentColor; }
        .fund-sheet .fund-gcell::placeholder { color: #94A3B8; }
        .fund-sheet .fund-gcell.ovr { color: #2463D1; -webkit-text-fill-color: #2463D1; font-weight: 700; background: #EEF3FC; }
        .fund-sheet .fund-gname { width: 200px; font-size: 14px; font-weight: 600; color: var(--fx-ink2); }
        .fund-sheet .fund-gadd-in { margin-left: 0; }
        .fund-foot-note { margin: 12px 0 0; font-size: 13px; color: var(--fx-mute); text-wrap: pretty; }
        /* 3 + 4 การ์ดพับได้ */
        .fund-fold { width: 100%; min-height: 80px; display: flex; align-items: center; gap: 16px; padding: 16px 20px; box-sizing: border-box; background: #fff; border: 1px solid var(--fx-line); border-radius: 16px; font-family: inherit; color: var(--fx-ink); text-align: left; cursor: pointer; }
        .fund-fold:hover { border-color: #C9D5E6; }
        .fund-fold-m { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .fund-fold-t { font-size: 20px; font-weight: 700; line-height: 1.3; }
        .fund-fold-s { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 18px; font-size: 14px; color: var(--fx-ink2); }
        .fund-fold-s b { font-weight: 600; color: var(--fx-ink); }
        .fund-fold-r { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; color: #2463D1; }
        .fund-fold-ic { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 9px; background: #EEF3FC; }
        .fund-pj-wrap { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; }
        .fund-pj-acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
        .fund-pj-empty { background: #fff; border: 1px solid var(--fx-line); border-radius: 16px; padding: 18px 20px; font-size: 14px; color: var(--fx-ink2); line-height: 1.6; }
        .fund-pj { background: #fff; border: 1px solid var(--fx-line); border-radius: 16px; overflow-x: auto; }
        .fund-pj-in { min-width: 1230px; }
        .fund-pj-r { display: grid; grid-template-columns: minmax(220px, 2fr) minmax(130px, 1fr) minmax(112px, .9fr) minmax(160px, 1.2fr) minmax(96px, .8fr) minmax(112px, .9fr) minmax(120px, .95fr) minmax(150px, 1fr) minmax(124px, .95fr); align-items: center; }
        .fund-pj-r > div { padding: 10px 12px; min-width: 0; font-size: 14px; }
        .fund-pj-r > div:last-child { padding-right: 16px; }
        .fund-pj-r .r { text-align: right; }
        .fund-pj-r .col { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
        .fund-pj-r .pl { padding-left: 58px !important; }
        .fund-pj-r .b { font-weight: 700; color: var(--fx-ink); }
        .fund-pj-r .s { font-size: 13px !important; }
        .fund-pj-r .g { color: var(--fin-c); font-weight: 600; }
        .fund-pj-r .sm { font-size: 12px; }
        .fund-pj-r.head { align-items: end; border-bottom: 1px solid var(--fx-line); }
        .fund-pj-r.head > div { padding-top: 14px; padding-bottom: 12px; font-size: 12.5px; font-weight: 600; color: var(--fx-mute); }
        .fund-pj-r.grp { background: #F2F5F9; border-top: 1px solid #D5DDE8; min-height: 58px; }
        .fund-pj-r.grp > div:first-child { padding: 6px 16px; }
        .fund-pj-r.row { border-top: 1px solid #EEF2F7; min-height: 70px; background: #fff; cursor: pointer; color: var(--fx-ink2); }
        .fund-pj-r.row:hover { background: #F8FAFE; }
        .fund-pj-r.row.off { opacity: .55; }
        .fund-pj-r.tot { background: #14213A; color: #fff; min-height: 62px; }
        .fund-pj-r.tot > div { font-size: 15px; font-weight: 700; }
        .fund-pj-r.tot .b { color: #fff; }
        .fund-pj-gb { min-height: 44px; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: none; font-family: inherit; color: var(--fx-ink); cursor: pointer; text-align: left; }
        .fund-pj-gi { width: 30px; height: 30px; flex: 0 0 30px; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: #fff; border: 1px solid #D5DDE8; color: var(--fx-ink2); }
        .fund-pj-gt { display: flex; flex-direction: column; }
        .fund-pj-gt b { font-size: 15px; }
        .fund-pj-gt span { font-size: 12.5px; color: var(--fx-mute); }
        .fund-pj-bar { width: 100%; height: 4px; border-radius: 999px; background: #DDE4EE; display: flex; justify-content: flex-end; }
        .fund-pj-bar i { height: 4px; border-radius: 999px; background: #2463D1; }
        .fund-pj-name { padding-left: 58px !important; display: flex; flex-direction: column; gap: 1px; }
        .fund-pj-name b { font-size: 14px; font-weight: 600; color: var(--fx-ink); }
        .fund-pj-name span { font-size: 12.5px; color: var(--fx-mute); }
        .fund-pj-name .code { font-size: 12px; letter-spacing: .02em; }
        .fund-pj-prods { display: flex; flex-wrap: wrap; gap: 4px; }
        .fund-pj-prod { display: inline-flex; align-items: center; min-height: 26px; padding: 0 10px; border-radius: 8px; background: #EEF2F7; color: var(--fx-ink2); font-size: 12.5px; font-weight: 600; }
        .fund-pj-when { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; }
        .fund-pj-when b { font-size: 14px; font-weight: 600; color: var(--fx-ink); }
        .fund-pj-when span { font-size: 12.5px; color: var(--fx-mute); }
        .fund-pj-lit { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
        .fund-pj-lit input { width: 16px; height: 16px; accent-color: var(--fin-c); cursor: pointer; margin: 0; }
        .fund-pj-ico { display: none; color: var(--fin-c); }
        .fund-pj-why { font-size: 12px; color: #8A5300; }
        .fund-pj-more { border-top: 1px solid #EEF2F7; padding: 4px 16px 4px 58px; }
        .fund-pj-more button { min-height: 44px; padding: 0; border: 0; background: none; font-family: inherit; font-size: 14px; font-weight: 600; color: #2463D1; cursor: pointer; }
        .fund-basis { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr)); gap: 16px; align-items: start; margin-top: 16px; }
        .fund-bcard { background: #fff; border: 1px solid var(--fx-line); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .fund-bcard-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; font-size: 17px; font-weight: 700; }
        .fund-kv { display: grid; grid-template-columns: minmax(120px, .7fr) minmax(0, 2fr); gap: 16px; padding: 12px 0; border-top: 1px solid #EEF2F7; }
        .fund-kv > span:first-child { font-size: 13.5px; font-weight: 600; color: var(--fx-mute); }
        .fund-kv > span:last-child { font-size: 14px; color: var(--fx-ink); line-height: 1.55; }
        .fund-mi { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid #EEF2F7; }
        .fund-mi-ic { width: 26px; height: 26px; box-sizing: border-box; border-radius: 999px; display: flex; align-items: center; justify-content: center; }
        .fund-mi-ic.on { background: #E6F4EE; color: #0B7255; }
        .fund-mi-ic.off { border: 2px solid #D9A443; background: #fff; }
        .fund-mi-m { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .fund-mi-m b { font-size: 14px; font-weight: 600; }
        .fund-mi-m span { font-size: 12.5px; color: var(--fx-mute); }
        .fund-mi-r { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; }
        .fund-mi-r b { font-size: 15px; font-weight: 700; }
        .fund-mi-r b.g { color: var(--fin-c); }
        .fund-mi-r b.w { color: #8A5300; }
        .fund-mi-r .mute { font-size: 13px; }
        .fund-mi-r .st { font-size: 12px; font-weight: 600; }
        .fund-mi-r .st.on { color: #0B7255; }
        .fund-mi-r .st.off { color: #8A5300; }
        .fund-mi-btn { margin-top: 4px; min-height: 32px; border: 1px solid #CBD5E1; background: #fff; border-radius: 8px; font: inherit; font-size: 12.5px; font-weight: 600; padding: 0 10px; cursor: pointer; color: var(--fx-ink); }
        .fund-mi-btn:hover { border-color: #2463D1; color: #2463D1; }
        .fund-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding-top: 20px; border-top: 1px solid #DCE3EC; font-size: 13px; color: var(--fx-mute); }
        @media (max-width: 760px) {
          .fund-xl { position: static; }
          .fund-xsech-in { position: static; }
          .fund-hd h1 { font-size: 28px; }
          .fund-op { display: none; }
          .fund-stack { gap: 32px; }
          .fund-fold-r > span:first-child { display: none; }
          .fund-kv { grid-template-columns: 1fr; gap: 4px; }
        }
        /* โหมดนำเสนอ: อ่านอย่างเดียว */
        body.present-mode .fund-page .fund-gcell { pointer-events: none; cursor: default; background: transparent; }
        body.present-mode .fund-page .fund-gcell.ovr { color: inherit; -webkit-text-fill-color: currentColor; font-weight: inherit; }
        body.present-mode .fund-page .fund-gname { pointer-events: none; }
        body.present-mode .fund-page .fund-glink-go { display: none; }
        body.present-mode .fund-page .fund-pj-ico { display: inline-flex; }
        body.present-mode .fund-page .fund-pj-r.row { cursor: default; }
      `}</style>

      {renderFc()}

      {editRow && <FundRowModal key={editRow.id || 'new'} row={editRow} cfg={cfg} fc={fc} canEdit={canEdit} onSave={saveRow} onDelete={delRow} onClose={() => setEditRow(null)} />}
      {picking && <FundPickModal data={data} taken={taken} onPick={pickProject} onClose={() => setPicking(false)} />}
      {importing && <FundSalesImportModal pipe={ov.pipe} fc={fc} canEdit={canEdit} onApply={applySales} onClose={() => setImporting(false)} />}
      {openPick && <FundOpenModal accounts={accounts} fc={fc} canEdit={canEdit} setFc={setFc} onClose={() => setOpenPick(false)} />}
      {incImporting && <FundIncImportModal canEdit={canEdit} masters={(data.debtMaster || []).filter(m => m && m.debtCategory === 'Incofin' && String(m.status || '').trim() === 'Active')}
        onApply={(o) => { if (canEdit) WTPOverride.setRaw(FUND_INC_KEY, JSON.stringify(o)); setIncImporting(false); if (toast) toast('ใช้ตารางดอกเบี้ย Incofin จากไฟล์ ' + o.file); }} onClose={() => setIncImporting(false)} />}
      {srcKey && fcAllRows[srcKey] && (() => {
        const row = fcAllRows[srcKey];
        return <FundFcSrcModal title={(row.neg ? '− ' : '') + row.label} how={row.how || row.sub} items={row.items} F={F} sys={row.sys} ovr={fc.ovr[row.key]} head={row.head} extra={row.extra}
          canEdit={canEdit} onClearOvr={() => clearOvr(row.key)} onClose={() => setSrcKey(null)} />;
      })()}
      {detK && (() => {   /* BIO: รายละเอียดแถวค่าใช้จ่ายประจำ */
        const p = fixedParts.find(x => x.k === detK);
        if (!p) return null;
        const ed = canEdit && !fundPresenting();
        return <FundFixedDetailModal key={detK} part={p} items={p.det} typedN={p.typed.filter(v => v != null).length} canEdit={ed}
          onSave={(list) => { setFixedItems(p.k, list); setDetK(null); if (toast) toast('บันทึกรายละเอียด ' + p.t); }} onClearTyped={() => clearFixedTyped(p.k)} onClose={() => setDetK(null)} />;
      })()}
      {rcvOpen && <BDAFRcvModal rcv={rcv} F={F} today={today} init={{}} onClose={() => setRcvOpen(false)}
        extra={{ th: 'ค่าติดตั้งที่ต้องจ่ายตาม', cell: (it) => { const x = ivInst.get(it); return x ? instCell(x.io, x.list, x.unknown) : <span style={{ color: 'var(--ink-400)' }}>—</span>; },
          head: instSummary(Array.from(ivInst.values()).map(x => x.list), 'เฉพาะใบแจ้งหนี้ที่นับในแผน') }} />}
    </div>
  );
}
