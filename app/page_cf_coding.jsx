/* =====================================================================
 * งบกระทบยอดกระแสเงินสด (#cf_coding) — BIOAXEL  (เดิมชื่อ "ลงรหัสงบกระแสเงินสด" · route/ตาราง/prefix ยังเป็น cf_coding/cfc เหมือนเดิม)
 * ---------------------------------------------------------------------
 *  "โต๊ะทำงาน" ที่รับ **ข้อมูลดิบ** จากไฟล์ EXPRESS แล้วช่วยจับคู่ "หมวด +
 *  ประเภทกิจกรรม" ให้ทีละบรรทัด — ผลลัพธ์ = ชีต "รวมทุกบัญชี" ที่เอาไปวางใน
 *  ไฟล์ CASH FLOW ได้ตรง ๆ (หรือส่งเข้าหน้า #cashflow_present)
 *
 *  แหล่งข้อมูล 3 ชั้น (ต่อกันด้วยเลขเอกสาร ไม่ใช่การเดา):
 *    1) งบกระทบยอด / รายการเคลื่อนไหวบัญชีธนาคาร (Express)  = บรรทัดธนาคารจริง
 *    2) pvVouchers (รายงานการจ่ายชำระหนี้ + ใบอนุมัติจ่าย)   = ผู้รับเงิน + บิลย่อย + WHT
 *    3) กฎที่ระบบเรียนรู้ (cfCoding.rules)                    = หมวดที่คนเคยยืนยัน
 *
 *  ★ โซ่ที่ทำให้ "จับคู่รายการตั้งหนี้ทีละใบ" ได้จริง:
 *      บรรทัดธนาคาร .เลขที่ = "QPPS26090301"
 *        ≡ pvVouchers.Chq_No ("เลขที่เช็ค" ในรายงานจ่ายชำระหนี้)
 *        → PV = PS2609030001 → settles[] = บิลที่เช็คใบนั้นไปจ่าย (RS/RR/RO/RC/CV)
 *    พิสูจน์กับข้อมูลจริง ส.ค. 2569 บัญชี SCB#4839: รายการจ่ายออก 96/96 = 100%
 *
 *  ⚠️ กติกาจับคู่ที่ห้ามผ่อน — ดู cfcMatchPv(): "ตรงเป๊ะทั้งสตริง" ก่อนเสมอ;
 *     จะยอมผ่อน (ศูนย์นำหน้าไม่เท่ากัน) ได้ต่อเมื่อ **ยอดเงินตรงกันด้วย**
 *     ของจริงมีเลขเช็คพิมพ์ตกหลัก (QPPS2608314 ควรเป็น 12 หลัก) ซึ่งถ้าผ่อน
 *     เฉย ๆ จะไปชนใบอื่นที่ยอดคนละเรื่อง (1,932.25 ↔ 138,325.11) แบบเงียบสนิท
 *
 *  Self-contained: พึ่ง window.React + window.XLSX + globals จาก page_bank_recon
 *  (brParseExpress / brFixSpreadsheetMLNumbers / brDecodeText) · prefix `cfc`/`Cfc`
 *  ข้อมูลส่วนกลาง sync ผ่าน Supabase ตาราง `cfCoding` (∈ SHEET_TABLES)
 *    - id 'master'          = หมวดมาตรฐาน (แก้ได้ · seed จาก CFC_MASTER_SEED)
 *    - id 'rules'           = กฎที่เรียนรู้ { sig: {cat, n, by, at} }
 *    - id 'lines:<acct>:<ym>' = บรรทัดดิบที่นำเข้าไว้ (1 ก้อน/บัญชี/เดือน)
 *  ต้องรัน supabase/cf-coding.sql ครั้งเดียวก่อน (ไม่งั้น degrade เป็น local)
 * ===================================================================== */
(function () {
  const { useState, useEffect, useMemo, useRef, Fragment } = React;

  const CFC_TABLE = 'cfCoding';
  const CFC_LS = 'bio-cfcode-v1';

  const C = {
    primary: '#2e8b4a', primaryD: '#1f6e3a', ink: '#20342a', mut: '#688275', faint: '#a4b8ac',
    line: '#e1efe7', soft: '#eef6f1', card: '#ffffff',
    pos: '#15875a', posBg: '#e6f7ef', neg: '#c0392b', negBg: '#fdecea',
    warn: '#8a6400', warnBg: '#fff7e0', info: '#1f6fb8', infoBg: '#eaf2ff',
    shadow: '0 8px 24px rgba(31,120,60,.10)',
  };

  /* ── หมวดมาตรฐาน — ถอดจากหน้าแรก "งบกระแสเงินสด" ของไฟล์ BA-Cash Flow 2026 ──
   *    เป็นแค่ seed: ผู้ใช้กด "นำเข้าไฟล์ CASH FLOW" แล้วระบบอ่านหน้าแรกมาทับให้เอง
   *    (ปีบัญชีใหม่เพิ่มบรรทัด → ไม่ต้องแก้โค้ด)                                     */
  const CFC_MASTER_SEED = [
    { a: 'op', g: 'รายรับจากการขายและบริการ', items: [
      'รายได้ขายเครื่องกำจัดขยะเศษอาหาร BIO Axel', 'รายได้ขายซุปเปอร์แบค', 'รายได้ขายข้าวอินทรีย์',
      'รายได้ขายดินพร้อมปลูก', 'รายได้ขายปุ๋ยอินทรีย์', 'รายได้ขายอื่นๆ',
      'รายได้ค่าบริการ (งาน PM/CM)', 'รายได้อื่นๆ', 'รับคืนจากการเคลียร์เงินคืน (พนักงาน)',
    ] },
    { a: 'op', g: 'ค่าใช้จ่ายเกี่ยวกับเครื่อง BA', items: [
      'ค่าเครื่อง BA', 'ค่าคิดตั้งเครื่อง BA', 'ค่าใช้จ่ายเครื่อง BA ต่างๆ', 'ค่าขนย้ายเครื่อง BA',
      'ค่าซ่อมบำรุง', 'งานเพิ่มเติม', 'งานPM CM',
    ] },
    { a: 'op', g: 'ต้นทุนสินค้าและการผลิต', items: [
      'การผลิต/ซื้อข้าวอินทรีย์', 'ปุ๋ยอินทรีย์', 'ดินพร้อมปลูก', 'ดินอินทรีย์', 'ซุปเปอร์แบค',
      'ผลิตน้ำยาอเนกประสงค์', 'ค่าวิเคราะห์ตัวอย่าง ตรวจสารเคมี', 'ค่าขนส่ง', 'โรงทดลองปลูกผัก',
    ] },
    { a: 'op', g: 'ค่าใช้จ่ายพนักงาน', items: [
      'เงินเดือนและสวัสดิการพนักงาน', 'สวัสดิการพนักงานอื่นๆ', 'ค่ายูนิฟอร์มพนักงาน', 'ค่าอบรมพนักงาน',
      'ค่าตรวจสุขภาพพนักงาน', 'ค่ากองทุนต่างๆ (ประกันสังคม,กองทุนท,กยศ)', 'ค่าโปรแกรม HR',
    ] },
    { a: 'op', g: 'ค่าที่ปรึกษาและบริการวิชาชีพ', items: [
      'ค่าที่ปรึกษาทางบัญชี', 'ค่าผู้สอบบัญชี', 'ค่าที่ปรึกษาทาง HR', 'ค่าที่ปรึกษาทางการเงิน',
      'ค่าที่ปรึกษาทางวิจัย', 'ค่าที่ปรึกษาการตลาด', 'ค่าที่ปรึกษาแนะนำนักลงทุน',
    ] },
    { a: 'op', g: 'ค่าเช่าและค่าบริการพื้นที่', items: [
      'ค่าเช่าสุพรรณ', 'ค่าเช่าโกดัง', 'ค่าเช่าโรงงานรังสิต', 'ค่าเช่าบ้านบางสาม', 'ค่าใช้บริการพื้นที่',
    ] },
    { a: 'op', g: 'ค่าสาธารณูปโภคและการสื่อสาร', items: [
      'ค่าโทรศัพท์/อินเทอร์เน็ต', 'ค่าไฟฟ้า', 'ค่าเว็บไซต์',
    ] },
    { a: 'op', g: 'ค่าการตลาดและส่งเสริมการขาย', items: [
      'ค่าคอมมิชชั่น', 'ค่าออกบูธ', 'ค่าโฆษณา (ยิงแอด)', 'กิจกรรม CSR', 'การช่วยเหลือเกษตรกร',
      'ค่าใช้จ่ายฝ่ายขาย', 'ค่ารับรอง', 'ค่าจัดงาน (ตรุษจีน/ปีใหม่)',
    ] },
    { a: 'op', g: 'ค่าเดินทางและยานพาหนะ และค่าที่พัก', items: [
      'ค่าตั๋วเครื่องบิน', 'ค่าสึกหรอรถพนักงาน', 'ค่าน้ำมัน (บัตรฟลีทการ์ด)', 'ค่าเดินทางอื่นๆ', 'ค่าที่พัก',
    ] },
    { a: 'op', g: 'ภาษีและค่าธรรมเนียม', items: [
      'ภาษี (กรมสรรพากร)', 'ค่าธรรมเนียมธนาคาร', 'ค่าธรรมเนียมอื่น',
    ] },
    { a: 'op', g: 'ค่าใช้จ่ายสำนักงานและอื่นๆ', items: [
      'ค่าใช้จ่ายดำเนินงานทั่วไป', 'ค่าวัสดุสำนักงาน', 'ค่าอุปกรณ์สำนักงาน', 'ค่าโปรแกรม ERP',
      'ค่าปรับปรุง/ซ่อมแซมสถานที่', 'ค่าประกันภัย', 'ค่าเครื่องมือ/อุปกรณ์อื่นๆ',
    ] },
    { a: 'inv', g: 'ซื้อสินทรัพย์และอุปกรณ์', items: [
      'ค่างวดรถตัก (ผ่อนชำระ)', 'ซื้อโปรแกรม ERP', 'ซื้อเครื่องสับ/ย่อยวัชพืช', 'ซื้อเครื่องอัดเม็ด',
      'ซื้อเครื่องอบลมร้อน', 'ซื้อตู้ไฟ/ตู้ควบคุมไฟฟ้า', 'ซื้ออุปกรณ์สำนักงาน', 'เงินประกันความเสียหายอาคาร',
    ] },
    { a: 'inv', g: 'เกี่ยวกับการค้ำประกัน', items: ['ค้ำประกันงาน เงินสด', 'ค้ำประกันงาน LG'] },
    { a: 'inv', g: 'เกี่ยวกับการทำงานวิจัย', items: ['โรงศพสำหรับสัตว์เลี้ยง', 'เจาะจงไม่ได้'] },
    { a: 'fin', g: 'เงินกู้รับเข้า', items: [
      'รับเงินกู้ - กรรมการ', 'รับเงินกู้ - BHG', 'รับเงินกู้ - STS', 'รับเงินกู้ - Lookwood',
      'รับเงินกู้ - ZICO', 'รับเงินกู้ - นักลงทุน WCI',
    ] },
    { a: 'fin', g: 'ชำระคืนเงินกู้', items: [
      'ชำระคืนเงินกู้ - กรรมการ', 'ชำระคืนเงินกู้ - BHG', 'ชำระคืนเงินกู้ - STS',
      'ชำระคืนเงินกู้ - Lookwood', 'ชำระคืนเงินกู้ - ZICO', 'ชำระคืนเงินกู้ - นักลงทุน WCI',
    ] },
    { a: 'fin', g: 'ดอกเบี้ยจ่าย', items: [
      'ดอกเบี้ยจ่าย - กรรมการ', 'ดอกเบี้ยจ่าย - BHG', 'ดอกเบี้ยจ่าย - STS',
      'ดอกเบี้ยจ่าย - Lockwood', 'ดอกเบี้ยจ่าย - ZICO', 'ดอกเบี้ยจ่าย - นักลงทุน WCI',
    ] },
    { a: 'fin', g: 'เงินให้กู้ยืม', items: ['เงินให้กู้ยืมแก่กรรมการ'] },
    // ไม่อยู่ในงบ (ไม่ใช่กิจกรรม) แต่ต้องมีให้เลือก เพราะบรรทัดธนาคารมีจริง
    { a: 'transfer', g: 'ไม่นับเป็นกิจกรรม', items: ['โอนเงินระหว่างบัญชี'] },
  ];

  /* ทะเบียนบัญชีธนาคาร — seed จากชีต "Dpt." ของไฟล์ BA-Cash Flow ของเตย
     type: สามารถใช้ได้ / เงินนักลงทุน / วงเงินค้ำประกัน / บัญชีร่วม
     ⚠️ บัญชีที่ไม่ใช่ "สามารถใช้ได้" อาจไม่มีรายการเดินบัญชีจริง ๆ ในเดือนนั้น
        → เตือนแบบเบา (ℹ️) ไม่ใช่แดง ไม่งั้นจะเตือนหลอกทุกเดือน */
  const CFC_BANK_SEED = [
    { bank: 'SCB',   no: '433-107769-3',  type: 'เงินนักลงทุน' },
    { bank: 'SCB',   no: '136-268483-9',  type: 'สามารถใช้ได้' },
    { bank: 'SCB',   no: '422-058598-1',  type: 'สามารถใช้ได้' },
    { bank: 'SCB',   no: '218-110840-6',  type: 'วงเงินค้ำประกัน' },
    { bank: 'SCB',   no: '433-107765-1',  type: 'บัญชีร่วม' },
    { bank: 'KBANK', no: '145-2-83196-8', type: 'สามารถใช้ได้' },
    { bank: 'BBL',   no: '451-3-501272',  type: 'สามารถใช้ได้' },
  ];
  const cfcDigits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  /* คีย์ประจำบัญชี — เลขล้วนก่อน (ไฟล์เขียน "136-268483-9" แต่ตัวอ่านได้ "1362684839")
     ⚠️ ต้อง fallback เป็นชื่อบัญชี: ถ้าอ่านเลขที่ไม่ออก cfcDigits จะคืน '' เหมือนกันทุกบัญชี
        → ยุบรวมเป็นบัญชีเดียว ยอดมั่ว และยกยอดเดือนก่อนข้ามบัญชีกัน (เจอตอนทดสอบ) */
  const cfcAcctKey = (no, label) => cfcDigits(no) || cfcNorm(label) || '(ไม่ระบุบัญชี)';

  const CFC_MONTH_TH = { 1: 'ม.ค.', 2: 'ก.พ.', 3: 'มี.ค.', 4: 'เม.ย.', 5: 'พ.ค.', 6: 'มิ.ย.', 7: 'ก.ค.', 8: 'ส.ค.', 9: 'ก.ย.', 10: 'ต.ค.', 11: 'พ.ย.', 12: 'ธ.ค.' };
  const CFC_ACT_TH = { op: 'กิจกรรมการดำเนินงาน', inv: 'กิจกรรมการลงทุน', fin: 'กิจกรรมการจัดหาเงิน', transfer: '' };
  const CFC_ACT_SHORT = { op: 'ดำเนินงาน', inv: 'ลงทุน', fin: 'จัดหาเงิน', transfer: 'โอน' };
  const CFC_ACT_COLOR = { op: C.primary, inv: '#7a5cd0', fin: '#c98a1e', transfer: C.mut };

  /* ฝั่งเงินของหมวด: 'in' = เงินเข้า · 'out' = เงินออก
     ★ ดูที่ "ชื่อหมวดขึ้นต้น" เป็นหลัก + ชื่อกลุ่มเฉพาะที่ชัดว่าเป็นฝั่งรับ
       ⚠️ ห้ามเอาคำว่า "ขาย" ลอย ๆ มาตัดสิน — กลุ่ม "ค่าการตลาดและส่งเสริมการขาย"
          เป็นฝั่งจ่ายทั้งกลุ่ม (เคยเดาผิดยกกลุ่ม 8 หมวดเพราะเรื่องนี้)
       วัดกับงบจริง: ถูก 94/94 หมวดที่มียอด (100%)
     ค่าที่ผู้ใช้ตั้งเองรายหมวด (field flow) ชนะกติกาเดาเสมอ */
  const CFC_NAME_IN = /^(รายรับ|รายได้|รับ|เงินสดรับ|ดอกเบี้ยรับ)/;
  const CFC_GRP_IN = /^(รายรับ|เงินกู้รับเข้า|เงินสดรับ)/;
  function cfcFlowOf(m) {
    if (!m) return 'out';
    if (m.flow === 'in' || m.flow === 'out') return m.flow;
    if (m.act === 'transfer') return 'both';
    return (CFC_NAME_IN.test(cfcT(m.name)) || CFC_GRP_IN.test(cfcT(m.group))) ? 'in' : 'out';
  }
  const CFC_FLOW_META = {
    in:   { label: 'รับ',  mark: '▲', color: '#15875a', bg: '#e6f7ef' },
    out:  { label: 'จ่าย', mark: '▼', color: '#c0392b', bg: '#fdecea' },
    both: { label: 'โอน',  mark: '↔', color: '#688275', bg: '#eef6f1' },
  };

  /* ── ชื่อหมวดรุ่นเก่าในไฟล์ประวัติ → หมวดมาตรฐาน ─────────────────────────
   *    ไฟล์จริงมี 127 ชื่อ แต่เป็นชื่อเดียวกันเขียนคนละแบบเยอะมาก
   *    ("ค่าสึกหรอรถพนักงาน" ↔ "เงินสดจ่ายเกี่ยวกับค่าสึกหรอรถพนักงาน") + พิมพ์ตก
   *    → cfcCanonCat() ตัดคำนำหน้าออกก่อน แล้วจับคู่ด้วย bigram; ที่เหลือใส่มือตรงนี้  */
  const CFC_ALIAS = {
    'โอนเงินระหว่างบัญชี': 'โอนเงินระหว่างบัญชี',
    'รายรับเกี่ยวกับโอนเงินระหว่างบัญชี': 'โอนเงินระหว่างบัญชี',
    'เงินสดจ่ายเกี่ยวกับงานCSR': 'กิจกรรม CSR',
    'เงินสดจ่ายเกี่ยวกับงานตรุษจีน': 'ค่าจัดงาน (ตรุษจีน/ปีใหม่)',
    'เงินสดจ่ายเกี่ยวกับงานปีใหม่68': 'ค่าจัดงาน (ตรุษจีน/ปีใหม่)',
    'เงินสดจ่ายเกี่ยวกับงานเลี้ยงวันปีใหม่68': 'ค่าจัดงาน (ตรุษจีน/ปีใหม่)',
    'เงินสดจ่ายเกี่ยวกับค่าไฟสุพรรรณ': 'ค่าไฟฟ้า',
    'เงินสดจ่ายเกี่ยวกับการปรับปรุงโรงซ่อม': 'ค่าปรับปรุง/ซ่อมแซมสถานที่',
    'เงินสดจ่ายเกี่ยวกับการซ่อมแซม': 'ค่าปรับปรุง/ซ่อมแซมสถานที่',
    'เงินสดจ่ายเกี่ยวกับโรงซ่อม': 'ค่าปรับปรุง/ซ่อมแซมสถานที่',
    'เงินสดจ่ายเกี่ยวกับค่าวัสดุเครื่องเขียนแบบพิมพ์ สำนักงาน': 'ค่าวัสดุสำนักงาน',
    'เงินสดจ่ายเกี่ยวกับค่ายิงแอด': 'ค่าโฆษณา (ยิงแอด)',
    'เงินสดจ่ายเกี่ยวกับข้่วอินทรีย์': 'การผลิต/ซื้อข้าวอินทรีย์',
    'เงินสดจ่ายเกี่ยวชุดแบบฟอร์มพนักงาน': 'ค่ายูนิฟอร์มพนักงาน',
    'เงินสดจ่ายเกี่ยวกับค่าบัตรฟีทการ์ด': 'ค่าน้ำมัน (บัตรฟลีทการ์ด)',
    'เงินสดจ่ายเพื่อให้กู้แก่กรรมการ': 'เงินให้กู้ยืมแก่กรรมการ',
    'เงินสดจ่ายเกี่ยวกับค่าใช้จ่ายในการดำเนินงานต่าง': 'ค่าใช้จ่ายดำเนินงานทั่วไป',
    'เงินสดจ่ายเกี่ยวกับข้าวอินทรีย์อื่นๆ': 'การผลิต/ซื้อข้าวอินทรีย์',
    'เงินสดจ่ายเกี่ยวกับการผลิตข้าว': 'การผลิต/ซื้อข้าวอินทรีย์',
    'เงินสดจ่ายเกี่ยวกับการออกบูธ': 'ค่าออกบูธ',
    'เงินสดจ่ายเกี่ยวกับการอบรม': 'ค่าอบรมพนักงาน',
    'เงินสดจ่ายเกี่ยวกับดอกเบี้ยเงินกู้-BHG': 'ดอกเบี้ยจ่าย - BHG',
    'เงินสดจ่ายเกี่ยวกับดอกเบี้ยเงินกู้-Lockwood': 'ดอกเบี้ยจ่าย - Lockwood',
    'เงินสดจ่ายเกี่ยวกับดอกเบี้ยเงินกู้-STS': 'ดอกเบี้ยจ่าย - STS',
    'เงินสดจ่ายเกี่ยวกับซื้อเครื่องBA': 'ค่าเครื่อง BA',
    'เงินสดจ่ายเกี่ยวกับซื้อเครื่องปั่นย่อยใบไม้': 'ซื้อเครื่องสับ/ย่อยวัชพืช',
    'เงินสดจ่ายเกี่ยวกับเครื่องสับวัชพิช กุดจิต': 'ซื้อเครื่องสับ/ย่อยวัชพืช',
    'เงินสดจ่ายเกี่ยวกับเครื่องสับวัชพิช ทับกวาง1': 'ซื้อเครื่องสับ/ย่อยวัชพืช',
    'เงินสดจ่ายเกี่ยวกับเครื่องสับวัชพิช ทับกวาง2': 'ซื้อเครื่องสับ/ย่อยวัชพืช',
    'เงินสดจ่ายกี่ยวกับค่าเช่าโรงงานสุพรรณ': 'ค่าเช่าสุพรรณ',
  };

  /* ── กฎจากรูปแบบเลขเอกสาร EXPRESS (ตายตัว ไม่ต้องเรียนรู้) ─────────────
   *    BT = ใบโอนระหว่างบัญชี · BV = ใบถอน/ค่าธรรมเนียม
   *    (ที่เหลือ QPPS/QPAV/QPAE/BQ/TT/OI ต้องดูเนื้อรายการ ไม่ตายตัวพอจะ hardcode) */
  const CFC_PREFIX_RULE = { BT: 'โอนเงินระหว่างบัญชี', BV: 'ค่าธรรมเนียมธนาคาร' };

  /* ══════════════ helpers ══════════════ */
  const cfcT = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const cfcNum = (v) => { if (typeof v === 'number') return v; const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '').replace(/[฿\s]/g, '')); return isNaN(n) ? 0 : n; };
  const cfcNorm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[()\[\].,\-\/#'"]/g, '');
  const cfcMoney = (n) => (typeof fmtNum === 'function' ? fmtNum(n, 2) : Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const cfcDocPre = (d) => { const m = String(d || '').match(/^([A-Z]{2,4})/); return m ? m[1] : ''; };

  /* วันที่: ไฟล์ Express มาเป็น Date (cellDates) หรือ ISO/DD-MM;
     ★ ชีต "รวมทุกบัญชี" ที่ทำมือมี serial ปี พ.ศ. (244354 = 5 ม.ค. 2569)
       → Excel serial ของปี 2569 = serial ปี 2026 + 198327 วันพอดี (543 ปี) */
  const CFC_BE_OFFSET = 198327;
  function cfcISO(v) {
    if (v == null || v === '') return '';
    // ★ duck-type ไม่ใช้ instanceof — Date ที่ SheetJS สร้างอาจมาจากคนละ realm
    if (v && typeof v.getFullYear === 'function' && !isNaN(v.getTime())) {
      // ⚠️ EXPRESS/SheetJS ให้เวลาเป็น 23:59:56 ของ "วันก่อนหน้า" (เศษทศนิยมของ epoch 1900)
      //    → อ่าน getDate() ตรง ๆ = ทั้งไฟล์เลื่อนไป 1 วันแบบเงียบสนิท ต้องปัดเข้าวันใกล้สุด
      const d0 = new Date(v.getFullYear(), v.getMonth(), v.getDate());
      const d = ((v.getTime() - d0.getTime()) / 86400000) >= 0.5 ? new Date(d0.getTime() + 86400000) : d0;
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    if (typeof v === 'number' && v > 100 && window.XLSX && XLSX.SSF) {
      let n = v; if (n > 100000) n -= CFC_BE_OFFSET;                 // ★ serial ปี พ.ศ.
      const d = XLSX.SSF.parse_date_code(n);
      if (d && d.y) return d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0');
      return '';
    }
    if (typeof brToISO === 'function') return brToISO(v);
    const s = String(v).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  }
  function cfcThaiDate(iso) {
    if (!iso) return '';
    const p = String(iso).split('-'); if (p.length < 3) return iso;
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  /* หมายเหตุของ Express = "<คำอธิบาย>/ <ชื่อผู้รับ>" (บางแถวมีครึ่งเดียว)
     ⚠️ ไฟล์ CASH FLOW เดิม (ม.ค.–พ.ค.) เขียนแค่ "เช็คผ่าน <ชื่อบริษัท>" ไม่มี "/"
        ถ้าเหมาว่าเป็นคำอธิบายทั้งดุ้น กฎ "คู่ค้า" จะไม่ถูกเรียนเลย (วัดจริง: auto ตก 60%→11%)
        จึงต้องดูรูปประโยค — ขึ้นต้นด้วย บริษัท/หจก/นาย/คุณ/กรม… = ชื่อผู้รับ ไม่ใช่คำอธิบาย */
  const CFC_NAME_RE = /^(บริษัท|บจก|บมจ|หจก|หสม|ห\.?จ\.?ก|ร้าน|นาย|นาง|นางสาว|น\.ส\.|คุณ|ดร\.|สำนักงาน|กรม|กอง|กองทุน|ธนาคาร|มหาวิทยาลัย|โรงพยาบาล|เทศบาล|องค์การ|องค์กร|สหกรณ์|สภา|วัด|โรงเรียน)/;
  const cfcLooksLikeName = (s) => CFC_NAME_RE.test(cfcT(s));
  function cfcSplitNote(note) {
    const s = cfcT(note).replace(/^เช็คผ่าน\s*/, '');
    const i = s.lastIndexOf('/');
    if (i >= 0) {
      const memo = cfcT(s.slice(0, i)), payee = cfcT(s.slice(i + 1));
      if (payee) return { memo, payee };
      return cfcLooksLikeName(memo) ? { memo: '', payee: memo } : { memo, payee: '' };
    }
    return cfcLooksLikeName(s) ? { memo: '', payee: s } : { memo: s, payee: '' };
  }
  /* คีย์คู่ค้า — ตัดคำนำหน้า/ท้ายที่ไม่ได้แยกตัวตน (บริษัท…จำกัด (มหาชน)/สำนักงานใหญ่/สาขา…)
     ⚠️ ห้ามตัดวงเล็บอื่นทิ้ง — "บัณฑิตา โฮลดิ้ง กรุ๊ป จำกัด(ด.บ.)" เป็นคู่ค้าคนละรายการกับตัวที่
        ไม่มีวงเล็บ (ด.บ. = ดอกเบี้ย → คนละหมวดกับเงินต้น) รวมกันเมื่อไรหมวดจะสลับกันเงียบ ๆ */
  function cfcVendorKey(name) {
    const s2 = cfcT(name)
      .replace(/^(บริษัท|บจก\.?|บมจ\.?|หจก\.?|หสม\.?|ห้างหุ้นส่วน(จำกัด|สามัญ)?|ร้าน|นาย|นาง|นางสาว|น\.ส\.|คุณ)\s*/, '')
      .replace(/\s*\((มหาชน|สำนักงานใหญ่|สาขา[^)]*)\)\s*$/, '')
      .replace(/\s*จำกัด\s*$/, '');
    return cfcNorm(s2);
  }

  /* เลขอ้างอิง: "QPPS26090301" → {pre:'PS', ymd:'260903', seq:1}
     (Q = เช็ค, P = จ่าย, แล้วตามด้วยชนิดเอกสาร 2 ตัว) */
  function cfcRefParts(s) {
    let h = String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    h = h.replace(/^Q/, '').replace(/^P(?=(PS|AV|AE|OE|PC|RE|OI|PV))/, '');
    const m = h.match(/^([A-Z]+)(\d{6})(\d+)$/);
    if (!m) return null;
    return { pre: m[1], ymd: m[2], seq: parseInt(m[3], 10), exact: h, loose: m[1] + m[2] + '#' + parseInt(m[3], 10) };
  }

  /* ── index ของ pvVouchers เพื่อจับคู่กับบรรทัดธนาคาร ───────────────────
   *    exact = เลขเช็คทั้งสตริง (ปลอดภัยเสมอ) · loose = ตัดศูนย์นำหน้า (ใช้ได้
   *    ต่อเมื่อยอดตรงด้วย — ดูหัวไฟล์ กับดักเลขเช็คพิมพ์ตกหลัก)              */
  function cfcBuildPvIndex(pvList) {
    const exact = {}, loose = {}, byDoc = {};
    (pvList || []).forEach(pv => {
      const chq = cfcT(pv.Chq_No), doc = cfcT(pv.PL_PV_No);
      if (chq) {
        const k = chq.toUpperCase().replace(/[^A-Z0-9]/g, '');
        (exact[k] = exact[k] || []).push(pv);
        const p = cfcRefParts(chq); if (p) (loose[p.loose] = loose[p.loose] || []).push(pv);
      }
      if (doc) {
        const p = cfcRefParts(doc);
        if (p) { (loose[p.loose] = loose[p.loose] || []).push(pv); byDoc[p.exact] = pv; }
      }
    });
    return { exact, loose, byDoc };
  }
  const cfcPvAmt = (pv) => Math.abs(cfcNum(pv.Net_Amount) || cfcNum(pv.Amount) || cfcNum(pv.Total));

  /* คืน {pv, how} — how: 'exact' | 'amount' (ผ่อนเลขแต่ยอดตรง) | 'suspect' (ผ่อนได้แต่ยอดไม่ตรง → ไม่ผูก) */
  function cfcMatchPv(line, idx) {
    const raw = cfcT(line.docNo).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!raw) return null;
    const amt = Math.abs(cfcNum(line.out) || cfcNum(line.in));
    const ex = idx.exact[raw];
    if (ex && ex.length) {
      if (ex.length === 1) return { pv: ex[0], how: 'exact' };
      const hit = ex.find(p => Math.abs(cfcPvAmt(p) - amt) < 0.02);
      return { pv: hit || ex[0], how: hit ? 'exact' : 'exact-dup' };
    }
    const p = cfcRefParts(line.docNo); if (!p) return null;
    const cands = (idx.loose[p.loose] || []).concat(idx.byDoc[p.exact] ? [idx.byDoc[p.exact]] : []);
    if (!cands.length) return null;
    const hit = cands.find(x => Math.abs(cfcPvAmt(x) - amt) < 0.02);
    if (hit) return { pv: hit, how: 'amount' };
    return { pv: null, how: 'suspect', near: cands[0] };   // ★ ไม่ผูก — เลขคล้ายแต่ยอดคนละเรื่อง
  }

  /* ══════════════ เครื่องเสนอหมวด ══════════════
   * ชั้นการตัดสิน (บนสุดชนะ) — ทุกชั้นบอก "ทำไม" กลับไปเสมอ:
   *   1. กฎรายเอกสาร (คนเคยยืนยันบรรทัดนี้)                → ยืนยันแล้ว
   *   2. รูปแบบเลขเอกสาร BT/BV                              → มั่นใจ
   *   3. ข้อความตรงกับที่เคยลงไว้เป๊ะ                        → มั่นใจ
   *   4. คู่ค้า/ผู้รับเงินคนเดิม (เคยลง ≥2 ครั้ง หมวดเดียว)  → มั่นใจ
   *   5. คำในรายการซ้ำของเดิมชัดเจน                          → มั่นใจ
   *   6. คล้ายของเดิมบ้าง                                     → ขอให้ยืนยัน
   *   7. ไม่เคยเจอ                                            → รายการใหม่
   * ★ เกณฑ์ชั้น 5 ตั้งไว้ "แน่นเกินไว้ก่อน": จากการวัดกับข้อมูลจริง 1,185 แถว
   *   ยอมทายน้อยลงแต่ถูก ~94% ดีกว่าทายเยอะแล้วถูก 24% (ผู้ใช้ต้องไล่แก้เอง)   */
  const cfcGrams = (s) => { const x = cfcNorm(s); const g = []; for (let i = 0; i < x.length - 2; i++) g.push(x.slice(i, i + 3)); return g; };
  const cfcTop = (o) => { if (!o) return null; const e = Object.entries(o).sort((a, b) => b[1] - a[1]); return e.length ? e[0] : null; };

  function cfcBuildEngine(rules, catAct) {
    const byDoc = {}, byText = {}, byMemo = {}, byVendor = {}, gram = {}, gramN = {};
    Object.keys(rules || {}).forEach(k => {
      const r = rules[k]; if (!r || !r.cat) return;
      const i = k.indexOf(':'); if (i < 0) return;
      const kind = k.slice(0, i), key = k.slice(i + 1), n = Number(r.n) || 1;
      if (kind === 'doc') byDoc[key] = r;
      else if (kind === 'vendor') { (byVendor[key] = byVendor[key] || {})[r.cat] = ((byVendor[key] || {})[r.cat] || 0) + n; }
      else if (kind === 'memo') { (byMemo[key] = byMemo[key] || {})[r.cat] = ((byMemo[key] || {})[r.cat] || 0) + n; }
      else if (kind === 'text') {
        (byText[key] = byText[key] || {})[r.cat] = ((byText[key] || {})[r.cat] || 0) + n;
        new Set(cfcGrams(key)).forEach(g => { (gram[g] = gram[g] || {})[r.cat] = ((gram[g] || {})[r.cat] || 0) + n; gramN[g] = (gramN[g] || 0) + n; });
      }
    });
    const withAct = (cat, why, tier) => ({ cat, act: catAct[cat] || '', why, tier });
    return function predict(line) {
      const d = cfcT(line.docNo);
      if (byDoc[d]) return withAct(byDoc[d].cat, 'ยืนยันไว้แล้วสำหรับเอกสารใบนี้', 'locked');
      const pre = cfcDocPre(d);
      if (CFC_PREFIX_RULE[pre]) return withAct(CFC_PREFIX_RULE[pre], 'เลขเอกสารขึ้นต้น ' + pre + ' = ' + (pre === 'BT' ? 'ใบโอนระหว่างบัญชี' : 'ใบถอน/ค่าธรรมเนียม'), 'auto');
      const text = line.matchText || '';
      const et = cfcTop(byText[cfcNorm(text)]);
      if (et) return withAct(et[0], 'ข้อความตรงกับที่เคยลงไว้ (' + et[1] + ' ครั้ง)', 'auto');
      // ★ คำอธิบายรายการชนะชื่อคู่ค้า — คนคนเดียวเบิกได้หลายเรื่อง
      //   (เคสจริง: "ค่าที่พักและค่าตั๋วเครื่องบิน / คุณอรวรรณ" ถูกกฎคู่ค้าลากไป "ค่าใช้จ่ายเครื่อง BA")
      const em = cfcTop(byMemo[cfcNorm(line.memo || '')]);
      if (em && em[1] >= 2) return withAct(em[0], 'คำอธิบายรายการเดิม (' + em[1] + ' ครั้ง)', 'auto');
      // คู่ค้า: ลองทั้งชื่อจากบรรทัดธนาคาร และชื่อผู้รับเงินจากใบสำคัญจ่าย
      const vkeys = [];
      [line.payee, line.pvPayee].forEach(n => { const k = cfcVendorKey(n); if (k.length > 3 && vkeys.indexOf(k) < 0) vkeys.push(k); });
      let bestV = null;
      vkeys.forEach(k => { const e = cfcTop(byVendor[k]); if (e && (!bestV || e[1] > bestV[1])) bestV = e; });
      const G = new Set(cfcGrams(text)); const sc = {}; let cover = 0;
      G.forEach(g => {
        const c = gram[g]; if (!c) return;
        const idf = 1 / Math.log(2 + gramN[g]); cover += idf;
        Object.entries(c).forEach(([k, n]) => { sc[k] = (sc[k] || 0) + idf * n / gramN[g]; });
      });
      const b = cfcTop(sc);
      if (bestV) {
        // ★ กฎคู่ค้าเชื่อได้ ยกเว้นเนื้อรายการชี้ไปอีกหมวดอย่างหนักแน่น → ถอยมาถามคน ไม่เดาทับ
        const conflict = b && b[0] !== bestV[0] && b[1] >= 1.2;
        if (bestV[1] >= 2 && !conflict) return withAct(bestV[0], 'คู่ค้ารายเดิม เคยลงหมวดนี้ ' + bestV[1] + ' ครั้ง', 'auto');
        if (conflict) return withAct(b[0], 'คู่ค้าเคยลง "' + bestV[0] + '" แต่เนื้อรายการชี้ไปอีกหมวด — ขอให้ยืนยัน', 'ask');
        return withAct(bestV[0], 'คู่ค้ารายเดิม (เคยลงครั้งเดียว) — ขอให้ยืนยัน', 'ask');
      }
      if (b) {
        const all = Object.values(sc).reduce((a, x) => a + x, 0);
        const share = b[1] / (all || 1);
        if (share >= 0.55 && cover / (G.size || 1) >= 0.5 && b[1] >= 0.8) return withAct(b[0], 'คำในรายการซ้ำกับของเดิมชัดเจน', 'auto');
        if (share >= 0.35) return withAct(b[0], 'คล้ายรายการเดิม — ขอให้ยืนยัน', 'ask');
        return withAct(b[0], 'พอเดาได้แต่ไม่มั่นใจ', 'ask');
      }
      return withAct('', 'ไม่เคยเจอรูปแบบนี้', 'new');
    };
  }

  /* ── จับชื่อหมวดเก่า → หมวดมาตรฐาน (ตอนนำเข้าไฟล์ CASH FLOW เก่ามาสอน) ── */
  function cfcCanonBuilder(master) {
    const strip = s => cfcT(s)
      .replace(/^เงินสด(จ่าย|รับ)(อื่นๆ)?(เกี่ยวกับ|เกี่ยวกัว|เกี่ยวข้อง|เกี่ยว|จาก(การขาย)?)?[-\s]*/, '')
      .replace(/^ค่าใช้จ่ายเกี่ยวกับ/, '').replace(/[\s\-–]+/g, '').replace(/ๆ/g, '');
    const bag = s => { const x = strip(s); const g = new Set(); for (let i = 0; i < x.length - 1; i++) g.add(x.slice(i, i + 2)); return g; };
    const M = master.map(m => ({ name: m.name, n: strip(m.name), b: bag(m.name) }));
    const cache = {};
    return function canon(label) {
      const L = cfcT(label); if (!L) return null;
      if (cache[L] !== undefined) return cache[L];
      if (CFC_ALIAS[L]) return (cache[L] = CFC_ALIAS[L]);
      const n = strip(L), b = bag(L); let best = null, bs = 0;
      M.forEach(m => {
        let s = m.n === n ? 1 : 0;
        if (!s) { let hit = 0; b.forEach(k => { if (m.b.has(k)) hit++; }); s = hit / (b.size + m.b.size - hit || 1); }
        if (m.n.includes(n) || n.includes(m.n)) s = Math.max(s, 0.82);
        if (s > bs) { bs = s; best = m; }
      });
      return (cache[L] = bs >= 0.55 ? best.name : null);
    };
  }

  /* ══════════════ ตัวอ่านไฟล์ ══════════════ */
  function cfcReadWorkbook(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      fr.onload = () => {
        try {
          const buf = new Uint8Array(fr.result);
          const head = String.fromCharCode.apply(null, buf.slice(0, 200));
          const isXml = /\.xml$/i.test(file.name) || /<\?xml|<Workbook/i.test(head);
          let wb;
          if (isXml) {
            // ★ EXPRESS เขียน <Data ss:Type="Number">104,992.26</Data> (มีคอมมา ผิดสเปค)
            //   ไม่ล้างก่อน SheetJS จะได้ NaN → ยอดหายทั้งคอลัมน์เงียบ ๆ
            const txt = (typeof brDecodeText === 'function') ? brDecodeText(buf) : new TextDecoder('utf-8').decode(buf);
            const fixed = (typeof brFixSpreadsheetMLNumbers === 'function') ? brFixSpreadsheetMLNumbers(txt) : txt;
            wb = XLSX.read(fixed, { type: 'string', cellDates: false });
          } else {
            wb = XLSX.read(buf, { type: 'array', cellDates: false });
          }
          resolve(wb);
        } catch (e) { reject(e); }
      };
      fr.readAsArrayBuffer(file);
    });
  }
  const cfcAoa = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: '' });

  /* งบกระทบยอด / รายการเคลื่อนไหวบัญชีธนาคาร (Express) → บรรทัดดิบ
     หัวตาราง: วันที่ | MNE | เลขที่ | ยอดถอน | ยอดฝาก | ยอดคงเหลือ | สถานะเช็ค | หมายเหตุ
     ⚠️ ห้าม cap จำนวนแถวตอนหาหัวตาราง — ไฟล์จริงมีแถวว่างนำหน้าหลายร้อยแถว */
  function cfcParseBankSheet(aoa, fileName) {
    const out = { acctNo: '', acctLabel: '', opening: null, lines: [], error: '' };
    for (let i = 0; i < aoa.length && i < 40; i++) {
      const cells = (aoa[i] || []).map(c => cfcT(c));
      const j = cells.join(' ');
      // ★ หาจาก "เซลล์" ที่มี S/A# หรือ C/A# ไม่ใช่จากทั้งแถวที่ join แล้ว
      //   (เดิมกลืน "วันที่ : 07/09/69" ท้ายแถวติดมาในชื่อบัญชี → คอลัมน์ในไฟล์ส่งออกเพี้ยน)
      if (!out.acctLabel) {
        const hit = cells.find(c => /[A-Za-z]\/A\s*#/.test(c) && /\d{5,}/.test(c.replace(/\D/g, '')));
        if (hit) out.acctLabel = cfcT(hit.split(/วันที่/)[0]).replace(/^\((.*)\)$/, '$1').replace(/\(\s*([^()]*(?:\([^()]*\))?[^()]*?)\s*\)\s*$/, '$1').trim();
      }
      if (/สมุดบัญชีเลขที่/.test(j)) {
        const row = aoa[i] || [];
        for (let k = 0; k < row.length; k++) { const d = String(row[k] || '').replace(/\D/g, ''); if (d.length >= 6) { out.acctNo = d; break; } }
      }
    }
    if (!out.acctNo) { const m = String(fileName || '').replace(/\.[^.]*$/, '').match(/(\d{4})(?!.*\d)/); out.acctNo = m ? m[1] : ''; }
    let hr = -1;
    for (let i = 0; i < aoa.length; i++) {
      const j = (aoa[i] || []).map(c => String(c || '').toLowerCase()).join('|');
      if (j.includes('mne') && (j.includes('ถอน') || j.includes('ฝาก'))) { hr = i; break; }
    }
    if (hr < 0) { out.error = 'ไม่พบหัวตาราง (MNE / ยอดถอน / ยอดฝาก) — ตรวจว่าเป็นไฟล์ "รายการเคลื่อนไหวบัญชีธนาคาร" ของ EXPRESS'; return out; }
    const H = (aoa[hr] || []).map(c => String(c || '').trim().toLowerCase());
    const col = (...keys) => { for (let i = 0; i < H.length; i++) if (keys.some(k => H[i].includes(k))) return i; return -1; };
    const cDate = col('วันที่', 'date'), cMne = col('mne'), cNo = col('เลขที่'), cWd = col('ยอดถอน', 'ถอน'),
          cDp = col('ยอดฝาก', 'ฝาก'), cBal = col('คงเหลือ', 'balance'), cSt = col('สถานะ'), cNote = col('หมายเหตุ', 'note');
    const gv = (r, i) => (i >= 0 ? r[i] : '');
    for (let i = hr + 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const joined = row.map(c => String(c || '')).join('');
      if (joined.includes('ยอดยกมา')) { out.opening = cfcNum(gv(row, cBal)); continue; }
      if (joined.includes('ผู้ตรวจสอบ') || joined.includes('จบรายงาน')) break;
      const iso = cfcISO(gv(row, cDate)); if (!iso) continue;
      const wd = Math.abs(cfcNum(gv(row, cWd))), dp = Math.abs(cfcNum(gv(row, cDp)));
      if (!wd && !dp) continue;
      const note = cfcT(gv(row, cNote));
      const sp = cfcSplitNote(note);
      out.lines.push({
        idx: out.lines.length,                                  // ลำดับตามไฟล์ — จำเป็นตอนหายอดยกมา/ปลายงวด
        acctNo: out.acctNo, acctLabel: out.acctLabel, iso, mne: cfcT(gv(row, cMne)),
        docNo: cfcT(gv(row, cNo)), out: wd, in: dp, balance: cfcNum(gv(row, cBal)),
        chqStatus: cfcT(gv(row, cSt)), note, memo: sp.memo, payee: sp.payee,
      });
    }
    return out;
  }

  /* ── รายงานการจ่ายชำระหนี้ เรียงตามวันที่จ่ายเงิน (ไฟล์ "291") ──────────
     โครง 2 ชั้น: แถวหลัก = ใบจ่าย (PS) · แถวย่อยถัดมา = บิลที่เช็คใบนั้นไปจ่าย
     คอลัมน์อ่านจาก "ป้ายหัวตาราง" เสมอ ห้าม hardcode ตำแหน่ง — EXPRESS แทรก
     คอลัมน์ "ตัดเงินมัดจำ" กลางตารางในรุ่นใหม่ ทำให้ช่องหลังจากนั้นเลื่อนทั้งแถบ
     ★ ยอดเงินสดจริงต่อบิล = เช็คจ่าย × (ยอดบิล ÷ ผลรวมบิลในใบเดียวกัน)
       — เกลี่ยตามสัดส่วนเพื่อดูด WHT/ส่วนลด/มัดจำเข้าไปในตัว แล้วผลรวมบิล
         จะเท่ากับเงินที่ออกจากบัญชีจริงเป๊ะทุกใบ (ข้อมูลจริง ส.ค.: 96/97 ใบ
         เข้าสมการ เช็คจ่าย = ยอดตามใบรับ − ภาษี − ส่วนลด − มัดจำ)                */
  function cfcParseSettleReport(aoa) {
    const out = { vouchers: [], error: '' };
    if (!Array.isArray(aoa) || !aoa.length) { out.error = 'ไฟล์ว่าง'; return out; }
    let hr = -1;
    for (let i = 0; i < aoa.length; i++) {
      if ((aoa[i] || []).some(c => cfcT(c).replace(/\s/g, '') === 'ยอดตามใบรับ')) { hr = i; break; }
    }
    if (hr < 0) { out.error = 'ไม่พบหัวตาราง "ยอดตามใบรับ"'; return out; }
    const H = (aoa[hr] || []).map(c => cfcT(c).replace(/\s/g, ''));
    const S = (aoa[hr + 1] || []).map(c => cfcT(c).replace(/\s/g, ''));
    const at = (row, label) => { const i = row.indexOf(label.replace(/\s/g, '')); return i; };
    const C = {
      date: at(H, 'วันที่จ่าย'), doc: at(H, 'เลขที่'), payee: at(H, 'ผู้จำหน่าย'), billno: at(H, 'เลขที่บิล'),
      dep: at(H, 'ตัดเงินมัดจำ'), gross: at(H, 'ยอดตามใบรับ'), cash: at(H, 'จ่ายเป็นง/ส'),
      cheque: at(H, 'เช็คจ่าย'), disc: at(H, 'ส่วนลด'), tax: at(H, 'ภาษี'),
      memo: at(H, 'หมายเหตุ'), chq: at(H, 'เลขที่เช็ค'), bank: at(H, 'ธนาคาร'), status: at(H, 'สถานะเช็ค'),
      sRecv: at(S, 'เลขที่ใบรับ'), sDate: at(S, 'วันที่'), sPaid: at(S, 'จ่ายชำระ'), sNote: at(S, 'หมายเหตุ'),
    };
    const gv = (r, i) => (i >= 0 ? r[i] : '');
    const isDoc = v => /^[A-Z]{2}\d{6,}/.test(cfcT(v));
    let cur = null;
    for (let i = hr + 2; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const doc = cfcT(gv(r, C.doc));
      if (isDoc(doc)) {
        // ★ ใบที่ถูกยกเลิกมีเครื่องหมาย '*' นำหน้าเลขที่ — ต้องตัดทิ้ง ไม่ใช่เงินที่จ่ายจริง
        const canceled = /^\*/.test(cfcT(gv(r, C.doc)).replace(/\s/g, '')) || /^\*/.test(cfcT(r[C.doc - 1] || ''));
        cur = { doc, canceled, iso: cfcISO(gv(r, C.date)), payee: cfcT(gv(r, C.payee)),
          gross: cfcNum(gv(r, C.gross)), cheque: cfcNum(gv(r, C.cheque)), cash: cfcNum(gv(r, C.cash)),
          wht: cfcNum(gv(r, C.tax)), disc: cfcNum(gv(r, C.disc)), dep: cfcNum(gv(r, C.dep)),
          memo: cfcT(gv(r, C.memo)), chqNo: cfcT(gv(r, C.chq)), bank: cfcT(gv(r, C.bank)),
          status: cfcT(gv(r, C.status)), billNo: cfcT(gv(r, C.billno)), bills: [] };
        out.vouchers.push(cur);
        continue;
      }
      const recv = cfcT(gv(r, C.sRecv));
      if (cur && isDoc(recv)) cur.bills.push({ recv, iso: cfcISO(gv(r, C.sDate)),
        paid: cfcNum(gv(r, C.sPaid)), note: cfcT(gv(r, C.sNote)), billno: cfcT(gv(r, C.billno)) });
      if (/จบรายงาน|รวมทั้งสิ้น/.test(r.map(x => cfcT(x)).join(''))) break;
    }
    out.vouchers = out.vouchers.filter(v => !v.canceled && v.doc);
    if (!out.vouchers.length) out.error = 'อ่านหัวตารางได้ แต่ไม่พบใบจ่ายเงิน';
    return out;
  }

  /* ★ แถว pvVouchers (นำเข้าไว้แล้วที่หน้า "ใบสำคัญจ่าย") → รูปใบจ่ายเดียวกับตัวอ่าน 291
       ⇒ หน้านี้ไม่ต้องเก็บข้อมูลชุดเดิมซ้ำอีกก้อน ใช้ของที่ sync ทั้งทีมอยู่แล้ว
       ครอบคลุมทั้งใบ PS (มีบิลย่อยใน settles[]) และใบอนุมัติจ่าย AV/AE (ไม่มีบิลย่อย) */
  function cfcPvToVoucher(pv) {
    const bills = Array.isArray(pv.settles) ? pv.settles.map(b => ({
      recv: cfcT(b.vchno || b.docno), iso: cfcISO(b.billdate), paid: cfcNum(b.paid),
      note: cfcT(b.note), billno: cfcT(b.billno),
    })).filter(b => b.recv || b.paid) : [];
    const gross = cfcNum(pv.Before_WHT) || cfcNum(pv.Amount) || cfcNum(pv.Total);
    return {
      doc: cfcT(pv.PL_PV_No), iso: cfcISO(pv.Pmt_Date), payee: cfcT(pv.Payee),
      gross, cheque: cfcNum(pv.Net_Amount) || gross, cash: 0,
      wht: cfcNum(pv.WHT), disc: cfcNum(pv.Deduct), dep: cfcNum(pv.Down_payment),
      memo: cfcT(pv.cc_remark || pv.Remark), chqNo: cfcT(pv.Chq_No), bank: cfcT(pv.Bank_AC),
      status: cfcT(pv.Type_of_Pmt), billNo: '', docSrc: cfcT(pv.Doc_Src), bills,
    };
  }

  /* คีย์ไว้เทียบว่า "บรรทัดธนาคารนี้ถูกลงรหัสจากใบจ่ายแล้วหรือยัง"
     ⚠️ ต้องเทียบ "เลขที่ผ่อนรูป + ยอดเงิน" คู่กันเสมอ — เลขเช็คในของจริงมีพิมพ์ตกหลัก
        (QPPS2608314) ที่ผ่อนแล้วไปชนใบอื่นยอดคนละเรื่อง ถ้าเทียบเลขอย่างเดียวจะซ่อน
        บรรทัดธนาคารผิดใบแบบเงียบสนิท */
  function cfcCoverKeys(v) {
    const out = [];
    [v.chqNo, v.doc].forEach(x => {
      const raw = cfcT(x).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (raw) out.push(raw);
      const pt = cfcRefParts(x); if (pt) out.push('~' + pt.loose);
    });
    return out;
  }

  /* แตกใบจ่าย 1 ใบ → แถวลงรหัสรายบิล (ยอดเกลี่ยตามสัดส่วนให้รวมเท่าเงินสดที่ออกจริง) */
  function cfcVoucherToRows(v, acctOf) {
    const cashOut = Math.abs(v.cheque || v.cash || v.gross);
    const acct = acctOf ? acctOf(v.bank) : { no: '', label: v.bank };
    const base = { iso: v.iso, mne: 'PS', chqStatus: v.status, payee: v.payee,
      acctNo: acct.no, acctLabel: acct.label, psNo: v.doc, chqNo: v.chqNo,
      wht: v.wht, gross: v.gross, cheque: v.cheque, src: 'ps' };
    if (!v.bills.length) {
      return [Object.assign({}, base, { idx: 0, docNo: v.doc, memo: v.memo, billno: v.billNo,
        note: (v.memo ? v.memo + '/ ' : '') + v.payee, out: cashOut, in: 0, share: 1 })];
    }
    const tot = v.bills.reduce((a, b) => a + Math.abs(b.paid), 0);
    let left = Math.round(cashOut * 100);
    return v.bills.map((b, i) => {
      const share = tot ? Math.abs(b.paid) / tot : 1 / v.bills.length;
      // ★ ปัดเศษแบบเก็บเศษไว้ที่บิลสุดท้าย — ผลรวมต้องเท่าเงินที่ออกจริงเป๊ะ ห้ามคลาดแม้สตางค์เดียว
      const cents = (i === v.bills.length - 1) ? left : Math.round(cashOut * share * 100);
      left -= cents;
      const memo = b.note || v.memo;
      return Object.assign({}, base, { idx: i, docNo: b.recv, billno: b.billno || v.billNo, memo,
        note: (memo ? memo + '/ ' : '') + v.payee, billPaid: b.paid,
        out: cents / 100, in: 0, share });
    });
  }

  /* ไฟล์ CASH FLOW ของเตย → (1) หมวดมาตรฐานจากหน้าแรก (2) ประวัติที่ลงรหัสไว้ */
  function cfcParseCashflowWorkbook(wb) {
    const res = { master: [], history: [], banks: [], sheetUsed: '', error: '' };
    // (1) หน้า "งบกระแสเงินสด" — บรรทัดย่อหน้า ≥6 ช่อง = รายการจริง
    const gsName = wb.SheetNames.find(n => /งบกระแสเงินสด/.test(n));
    if (gsName) {
      const aoa = cfcAoa(wb.Sheets[gsName]); let act = '', grp = '';
      aoa.forEach(r => {
        const raw = String(r[0] == null ? '' : r[0]); const s = cfcT(raw); if (!s) return;
        if (/^กระแสเงินสดจากกิจกรรมดำเนินงาน/.test(s)) { act = 'op'; return; }
        if (/^กระแสเงินสดจากกิจกรรมลงทุน/.test(s)) { act = 'inv'; return; }
        if (/^กระแสเงินสดจากกิจกรรมจัดหาเงิน/.test(s)) { act = 'fin'; return; }
        if (/^(รวม|กระแส|เงินสด(สุทธิ|ต้นงวด|คงเหลือ))/.test(s)) return;
        const ind = raw.length - raw.replace(/^\s+/, '').length;
        if (ind > 0 && ind < 6) { grp = s; return; }
        if (ind >= 6 && act) res.master.push({ name: s, act, group: grp });
      });
    }
    // (1.5) ชีต "Dpt." — ทะเบียนบัญชีธนาคาร (BANK | ACCOUNT NO. | ประเภท)
    const dptName = wb.SheetNames.find(n => /^dpt/i.test(n));
    if (dptName) {
      cfcAoa(wb.Sheets[dptName]).forEach(r => {
        const bank = cfcT(r[0]), no = cfcT(r[1]), type = cfcT(r[2]);
        if (/^(SCB|KBANK|BBL|KTB|KKP|TTB|GSB|UOB|CIMB|LHB|TISCO)$/i.test(bank) && cfcDigits(no).length >= 8) {
          res.banks.push({ bank: bank.toUpperCase(), no, type: type || '' });
        }
      });
    }

    // (2) ชีตที่มีคอลัมน์ "หมวด…" + "ประเภทกิจกรรม…" = ประวัติที่ลงรหัสแล้ว (ชีตไหนก็ได้)
    wb.SheetNames.forEach(sn => {
      const aoa = cfcAoa(wb.Sheets[sn]);
      let hr = -1, H = null;
      for (let i = 0; i < aoa.length && i < 30; i++) {
        const row = (aoa[i] || []).map(c => cfcT(c));
        const hasCat = row.findIndex(c => /^หมวด/.test(c)), hasAct = row.findIndex(c => /ประเภทกิจกรรม/.test(c));
        if (hasCat >= 0 && hasAct >= 0) { hr = i; H = row; break; }
      }
      if (hr < 0) return;
      const find = re => H.findIndex(c => re.test(c));
      const cCat = find(/^หมวด/), cAct = find(/ประเภทกิจกรรม/), cDoc = find(/^เลขที่/),
            cNote = find(/^หมายเหตุ/), cDate = find(/^วันที่/), cWd = find(/ถอน/), cDp = find(/ฝาก/);
      for (let i = hr + 1; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const cat = cfcT(cDat(r, cCat)); if (!cat) continue;
        if (/^หมวด|ประเภทกิจกรรม|^รวม/.test(cat)) continue;          // หัวตารางซ้ำกลางชีต / แถวสรุป
        const wd = Math.abs(cfcNum(cDat(r, cWd))), dp = Math.abs(cfcNum(cDat(r, cDp)));
        if (!wd && !dp) continue;                                     // ต้องเป็นแถวที่มีเงินจริง
        const note = cfcT(cDat(r, cNote)); const sp = cfcSplitNote(note);
        res.history.push({
          cat, actRaw: cfcT(cDat(r, cAct)), docNo: cfcT(cDat(r, cDoc)), note,
          memo: sp.memo, payee: sp.payee, iso: cfcISO(cDat(r, cDate)),
          out: wd, in: dp, sheet: sn,
        });
      }
      res.sheetUsed = res.sheetUsed ? res.sheetUsed + ', ' + sn : sn;
    });
    function cDat(r, i) { return i >= 0 ? r[i] : ''; }

    /* (3) ชีตรายเดือนแบบ "รหัสบัญชี" — โครง BANK | ACCOUNT NO. | Department |
           Document No. | DD/MM/YYYY | Vender | Description | Amount | รหัส | Account Code
       ★ ไฟล์ปีก่อน (BA-Cash Flow 2026.xlsx) ลงรหัสตัวเลข 140 รหัส แทนชื่อหมวด
         → ถ้าไม่อ่าน ผู้ใช้จะเห็น "ประวัติที่อ่านได้: 0 แถว" แล้วนึกว่าพัง
         ชื่อของรหัส (เช่น "เงินสดจ่ายค่าธรรมเนียมธนาคาร") ส่งเข้า canon เดียวกับชื่อหมวด
         → จับเข้าหมวดมาตรฐานได้เอง; ที่จับไม่ได้ = ข้าม ไม่เดา                              */
    wb.SheetNames.forEach(sn => {
      const aoa = cfcAoa(wb.Sheets[sn]);
      let hr = -1, H = null;
      for (let i = 0; i < aoa.length && i < 40; i++) {
        const row = (aoa[i] || []).map(c => cfcT(c));
        if (row.some(c => /^Document No\.?$/i.test(c)) && row.some(c => /^Account Code$/i.test(c))) { hr = i; H = row; break; }
      }
      if (hr < 0) return;
      const at = re => H.findIndex(c => re.test(c));
      const cDoc = at(/^Document No/i), cDate = at(/^DD\/MM\/YYYY$/i), cDesc = at(/^Description$/i),
            cAmt = at(/^Amount$/i), cName = at(/^Account Code$/i), cVend = at(/^Vender$/i);
      let n = 0;
      for (let i = hr + 1; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const name = cfcT(cDat(r, cName)); if (!name) continue;
        const amt = cfcNum(cDat(r, cAmt)); if (!amt) continue;
        const desc = cfcT(cDat(r, cDesc)); const sp = cfcSplitNote(desc);
        res.history.push({
          cat: name, actRaw: '', docNo: cfcT(cDat(r, cDoc)), note: desc,
          memo: sp.memo || cfcT(cDat(r, cVend)), payee: sp.payee, iso: cfcISO(cDat(r, cDate)),
          out: amt < 0 ? -amt : 0, in: amt > 0 ? amt : 0, sheet: sn,
        });
        n++;
      }
      if (n) res.sheetUsed = res.sheetUsed ? res.sheetUsed + ', ' + sn : sn;
    });
    if (!res.master.length && !res.history.length && !res.banks.length) res.error = 'ไม่พบทั้งหน้า "งบกระแสเงินสด", ชีตที่มีคอลัมน์ "หมวด…/ประเภทกิจกรรม…" และชีต "Dpt."';
    return res;
  }

  /* ── ตรวจยอดรายบัญชีรายเดือน — หัวใจของงาน "หลายธนาคาร" ───────────────
     ยอดยกมา = ยอดคงเหลือของแถวแรก(ตามลำดับไฟล์) − กระแสของแถวนั้น
     ยอดปลายงวด = ยอดคงเหลือของแถวสุดท้าย → ต้องเท่ากับ ยกมา + รับ − จ่าย
     ถ้าไม่เท่า = นำเข้ามาไม่ครบ/ไฟล์ซ้อนเดือน — ต้องเห็นก่อนเอาไปทำงบ     */
  function cfcAcctSummary(rows, declared) {
    const D = declared || {};
    const by = {};
    rows.forEach(r => {
      // ★ ต้องผ่าน cfcAcctKey — acctNo ว่างเหมือนกันทุกบัญชีที่อ่านเลขที่ไม่ออก
      //   ถ้าใช้ acctNo ดิบ บัญชีพวกนั้นจะถูกยุบรวมเป็นบัญชีเดียว ยอดต้น/ปลายมั่วทันที
      const k = cfcAcctKey(r.acctNo, r.acctLabel) + '|' + String(r.iso).slice(0, 7);
      const g = by[k] || (by[k] = { acctNo: r.acctNo, acctLabel: r.acctLabel, ym: String(r.iso).slice(0, 7),
        n: 0, inSum: 0, outSum: 0, uncoded: 0, first: null, last: null });
      g.n++; g.inSum += r.in; g.outSum += r.out;
      if (r.sug && !r.sug.cat) g.uncoded++;   // แถวที่ส่งมาแค่คิดยอด (ไม่มี sug) ไม่นับ
      const key = String(r.iso) + '#' + String(r.idx == null ? 0 : r.idx).padStart(6, '0');
      if (!g.first || key < g.first.k) g.first = { k: key, row: r };
      if (!g.last || key > g.last.k) g.last = { k: key, row: r };
    });
    return Object.keys(by).sort().map(k => {
      const g = by[k];
      const f = g.first && g.first.row, l = g.last && g.last.row;
      const openingCalc = f ? (cfcNum(f.balance) - (f.in - f.out)) : 0;
      const dk = cfcAcctKey(g.acctNo, g.acctLabel) + '|' + g.ym;
      const openingFile = (D[dk] == null ? null : cfcNum(D[dk]));   // ยอดยกมาที่ "ไฟล์ประกาศ"
      const opening = openingFile == null ? openingCalc : openingFile;
      const closingFile = l ? cfcNum(l.balance) : 0;
      const closingCalc = opening + g.inSum - g.outSum;
      return Object.assign(g, { opening, openingCalc, openingFile, openingSrc: openingFile == null ? 'calc' : 'file',
        closingFile, closingCalc, diff: closingCalc - closingFile });
    });
  }

  /* "ก.ค. 69" → "2026-07" — ใช้แกะคอลัมน์เดือนของงบที่เก็บไว้ (ตรงข้ามกับ monLabel) */
  function cfcYmOfMonthLabel(lb) {
    const s = cfcT(lb); let mo = 0;
    for (let k = 1; k <= 12; k++) { if (s.indexOf(CFC_MONTH_TH[k]) === 0) { mo = k; break; } }
    const y2 = (s.match(/(\d{2,4})\s*$/) || [])[1];
    if (!mo || !y2) return '';
    let y = Number(y2);
    y = y < 100 ? (y + 2500 - 543) : (y > 2400 ? y - 543 : y);
    return y + '-' + String(mo).padStart(2, '0');
  }
  /* ชื่อบรรทัดในงบเดิม → ชื่อหมวดที่ cfcSummaryAoa ใช้เป็นคีย์ */
  function cfcCanonRowLabel(l) {
    return cfcT(l)
      .replace(/^⚠\s*/, '')
      .replace(/\s*\(ไม่มีในผังหมวด — ต้องแก้\)$/, '')
      .replace(/^(โอนเงินระหว่างบัญชี)\s*\(.*\)$/, '$1')
      .replace(/\s*\(ยังได้ยอดไม่ครบทุกบัญชี\)$/, '');
  }

  /* ── เงินสดคงเหลือจริง (จากบรรทัดธนาคาร) ราย ym รวมทุกบัญชี ──────────────
     บัญชีที่ไม่มีรายการในเดือนนั้น = ยกปลายงวดเดือนก่อนมา (ไม่งั้นยอดรวมหายเป็นก้อน)
     ใช้เป็นบรรทัด "เงินสดคงเหลือปลายงวด จาก STM" ท้ายงบ = ตัวตรวจกับยอดที่งบคิดได้ */
  /* ⚠️ ต้องได้ยอดของ "ทุกบัญชีในทะเบียน" ถึงจะเป็นยอดเงินสดจริง — บัญชีที่ยังไม่ได้นำเข้า
     งบกระทบยอดแล้วนับเป็น 0 = ยอดต่ำกว่าความจริงแบบเงียบ ๆ คนอ่านนึกว่าเงินหาย
     จึงหาจาก 2 แหล่งเรียงกัน: (1) บรรทัดธนาคารที่นำเข้า (แม่นสุด · บัญชีที่ไม่มีรายการ
     เดือนนั้นยกปลายงวดเดือนก่อนมา) → (2) ยอดคงเหลือรายวันที่คีย์ไว้เอง (`cashflowSnapshots`
     จากหน้า "บันทึกยอดคงเหลือรายวัน") เอาแถวล่าสุดที่ไม่เกินสิ้นเดือนนั้น
     ยังขาดอีก = คืนยอดเท่าที่รู้ + ติดธง short เพื่อไปเตือนที่ชื่อบรรทัด (ไม่เว้นว่าง —
     ผู้ใช้ต้องการเห็นตัวเลขไว้เทียบ แต่ต้องรู้ด้วยว่ายังไม่ครบ) */
  function cfcStmClosingByYm(hist, months, registry, snaps, manualClosing) {
    /* เส้นเวลา "ยอดคงเหลือปลายงวด" ต่อบัญชี = คอลัมน์ "ปลายงวด" ของการ์ดตรวจยอดเป๊ะ ๆ
       ⚠️ แถวนี้ชื่อ "จาก STM" ⇒ **ปลายงวดจากไฟล์ (`closingFile`) ต้องมาก่อน** ·
          "ปลายงวดจริง (คีย์เอง)" เป็นแค่ตัวสำรองตอนไม่มีไฟล์ (pri ต่ำกว่า)
          เอาค่าที่คีย์มาทับไฟล์เมื่อไร = ยอดจะต่างจากที่การ์ดโชว์ ด้วยส่วนที่ "ไฟล์ขาด"
          (ของจริงต่าง 15,125 ที่ ส.ค. → ผู้ใช้ทักว่าผิด) */
    const tl = {};
    const push = (k, row) => { if (k && k !== '(ไม่ระบุบัญชี)') (tl[k] = tl[k] || []).push(row); };
    Object.keys(manualClosing || {}).forEach(key => {
      const i = key.lastIndexOf('|'); if (i < 0) return;
      push(key.slice(0, i), { ym: key.slice(i + 1), v: cfcNum(manualClosing[key]), pri: 0 });
    });
    (hist || []).forEach(g => push(cfcAcctKey(g.acctNo, g.acctLabel), { ym: g.ym, v: g.closingFile, pri: 1 }));
    Object.keys(tl).forEach(k => tl[k].sort((a, b) => (a.ym !== b.ym ? (a.ym < b.ym ? -1 : 1) : a.pri - b.pri)));
    // ตาข่ายสุดท้าย: ยอดคงเหลือรายวันที่คีย์ไว้ (cashflowSnapshots) — แถวล่าสุดที่ไม่เกินสิ้นเดือน
    const snapByAcct = {};
    (snaps || []).forEach(s => {
      const k = cfcAcctKey(s.bankAc || s.Bank_AC, '');
      if (!k || k === '(ไม่ระบุบัญชี)') return;
      (snapByAcct[k] = snapByAcct[k] || []).push({ d: String(s.date || '').slice(0, 10), v: cfcNum(s.balance) });
    });
    Object.keys(snapByAcct).forEach(k => snapByAcct[k].sort((a, b) => (a.d < b.d ? -1 : 1)));
    const need = (registry || []).map(b => cfcAcctKey(b.no, b.no)).filter(Boolean);
    const keys = [...new Set((need.length ? need : Object.keys(snapByAcct)).concat(Object.keys(tl)))];
    const out = { v: {}, short: {} };
    (months || []).forEach(m => {
      const end = m + '-31';
      let sum = 0, miss = 0;
      keys.forEach(k => {
        let last = null; (tl[k] || []).forEach(x => { if (x.ym <= m) last = x; });   // ยกยอดเดือนก่อนมาเอง
        if (last) { sum += last.v; return; }
        let sn = null; (snapByAcct[k] || []).forEach(x => { if (x.d && x.d <= end) sn = x; });
        if (sn) { sum += sn.v; return; }
        miss++;
      });
      out.v[m] = sum;
      if (miss) out.short[m] = miss;
    });
    return out;
  }
  /* ต้นงวดรวมทุกบัญชี ณ เดือนหนึ่ง (ลำดับเดียวกับการ์ดภาพรวม: ไฟล์เดือนนั้น > ปลายงวดเดือนก่อน) */
  function cfcOpeningTotalAt(hist, ym0) {
    const byAcct = {};
    (hist || []).forEach(g => { (byAcct[cfcAcctKey(g.acctNo, g.acctLabel)] = byAcct[cfcAcctKey(g.acctNo, g.acctLabel)] || []).push(g); });
    let s = 0;
    Object.keys(byAcct).forEach(k => {
      const cur = byAcct[k].find(g => g.ym === ym0);
      if (cur) { s += cur.opening; return; }
      let prev = null; byAcct[k].forEach(g => { if (g.ym < ym0 && (!prev || g.ym > prev.ym)) prev = g; });
      if (prev) s += prev.closingFile;
    });
    return s;
  }

  /* ปลายงวดของ "เดือนก่อนหน้าที่มีข้อมูล" ของบัญชีนั้น (ไม่จำเป็นต้องเป็น ym-1 —
     เดือนที่ไม่มีไฟล์ให้ข้ามไป) · ym ว่าง = เอาเดือนล่าสุดเท่าที่มี */
  function cfcPrevMonth(hist, acctNo, ym, acctLabel) {
    const k = cfcAcctKey(acctNo, acctLabel); let best = null;
    (hist || []).forEach(g => {
      if (cfcAcctKey(g.acctNo, g.acctLabel) !== k) return;
      if (ym && g.ym >= ym) return;
      if (!best || g.ym > best.ym) best = g;
    });
    return best;
  }

  /* ยุบหลายเดือนของบัญชีเดียวกันเป็นแถวเดียว (ตอนเลือก "ทุกเดือน")
     ⚠️ ก่อนหน้านี้ index ด้วยเลขบัญชีอย่างเดียว → เดือนหลังทับเดือนก่อน เห็นแค่เดือนเดียว */
  function cfcAggByAcct(list) {
    const by = {};
    (list || []).forEach(g => { const k = cfcAcctKey(g.acctNo, g.acctLabel); (by[k] = by[k] || []).push(g); });
    return Object.keys(by).map(k => {
      const arr = by[k].slice().sort((a, b) => (a.ym < b.ym ? -1 : 1));
      const f = arr[0], l = arr[arr.length - 1];
      const inSum = arr.reduce((a, g) => a + g.inSum, 0), outSum = arr.reduce((a, g) => a + g.outSum, 0);
      const calc = f.opening + inSum - outSum;
      return {
        acctNo: f.acctNo, acctLabel: f.acctLabel, ymFirst: f.ym, ymLast: l.ym, months: arr.length,
        ym: arr.length > 1 ? (f.ym + ' … ' + l.ym) : f.ym,
        opening: f.opening, openingCalc: f.openingCalc, openingFile: f.openingFile, openingSrc: f.openingSrc,
        closingFile: l.closingFile, closingCalc: calc, diff: calc - l.closingFile,
        inSum, outSum, n: arr.reduce((a, g) => a + g.n, 0), uncoded: arr.reduce((a, g) => a + g.uncoded, 0),
      };
    });
  }

  /* ══════════════ storage (Supabase blob + localStorage cache) ══════════════ */
  function cfcCanSync() {
    return !!(window.WTPData && WTPData.fetchSheetRows && WTPData.writeTable
      && window.WTP_CONFIG && WTP_CONFIG.BACKEND === 'supabase');
  }
  function cfcLoadLocal() { try { return JSON.parse(localStorage.getItem(CFC_LS) || 'null') || {}; } catch (e) { return {}; } }
  /* ⚠️ cache นี้เคย `catch (e) {}` เงียบ ๆ — พอข้อมูลโตเกินโควตา localStorage การเซฟจะล้มทุกครั้ง
     แบบไม่มีใครรู้ แล้ว "เปิดหน้าทีต้องรอโหลดจาก server ใหม่ทุกที" (อาการ: หน้านี้โหลดช้ามาก)
     ตอนนี้ถ้าไม่พอ จะตัด "บรรทัดดิบของเดือนเก่าสุด" ออกทีละชุดแล้วลองใหม่ — เดือนล่าสุด
     (ที่กำลังทำงานอยู่) กับผังหมวด/กฎ/ค่าที่คีย์เอง ต้องได้ cache เสมอ */
  const cfcYmOfId = (id) => (String(id).match(/(\d{4}-\d{2})\s*$/) || ['', ''])[1];
  function cfcSaveLocal(o) {
    const keys = Object.keys(o);
    const heavy = keys.filter(k => k.indexOf('lines:') === 0 || k.indexOf('ps:') === 0)
      .sort((a, b) => (cfcYmOfId(a) < cfcYmOfId(b) ? -1 : cfcYmOfId(a) > cfcYmOfId(b) ? 1 : 0));  // เก่า → ใหม่
    const rank = {}; heavy.forEach((k, i) => { rank[k] = i; });
    let drop = 0;
    for (;;) {
      const keep = {};
      keys.forEach(k => { if (rank[k] == null || rank[k] >= drop) keep[k] = o[k]; });
      try { localStorage.setItem(CFC_LS, JSON.stringify(keep)); return; } catch (e) {
        if (drop >= heavy.length) {
          try { localStorage.removeItem(CFC_LS); } catch (_) {}
          console.warn('[cfc] ข้อมูลใหญ่เกิน localStorage — เก็บ cache ไม่ได้เลย หน้านี้จะต้องโหลดจาก server ทุกครั้ง');
          return;
        }
        drop += Math.max(1, Math.ceil(heavy.length / 4));
      }
    }
  }

  /* หมวดที่ไม่ได้อยู่ในงบหน้าแรก แต่ต้องมีให้เลือกเสมอ (บรรทัดธนาคารมีจริง)
     → ผนวกกลับทุกครั้งที่อ่านหมวดมาตรฐานจากไฟล์ CASH FLOW มาทับ */
  /* แทรกหมวดลงผังให้อยู่ "ถูกบล็อก" — ลำดับใน master = ลำดับแถวของชีตงบ
     1) กลุ่มเดิม → ต่อท้ายกลุ่มนั้น
     2) กลุ่มใหม่แต่มีของฝั่งเงินเดียวกันอยู่แล้ว → ต่อท้ายบล็อกฝั่งนั้น
     3) ยังไม่มีของฝั่งนี้ในกิจกรรมเลย → ★ ฝั่ง "รับ" ต้องขึ้นก่อนฝั่ง "จ่าย" เสมอ
   ★ ตัวเดียวที่ทุกทาง (เพิ่มเอง · แก้ไข · ผสานตอนสอนระบบ) ต้องเรียก — อย่าก็อปสูตร */
  function cfcInsertCat(list, row) {
    let at = -1;
    list.forEach((m, i) => { if (m.act === row.act && m.group === row.group) at = i; });
    if (at < 0) list.forEach((m, i) => { if (m.act === row.act && cfcFlowOf(m) === cfcFlowOf(row)) at = i; });
    if (at >= 0) { list.splice(at + 1, 0, row); return list; }
    const first = list.findIndex(m => m.act === row.act);
    let last = -1; list.forEach((m, i) => { if (m.act === row.act) last = i; });
    if (first < 0) list.push(row);
    else list.splice(cfcFlowOf(row) === 'in' ? first : last + 1, 0, row);
    return list;
  }

  /* ★ ผสานหมวดที่ "เพิ่มเองในแอป" (src:'app') กลับเข้าผังที่อ่านมาจากไฟล์ CASH FLOW
     ⚠️ หมวดพวกนี้ไม่มีทางอยู่ในไฟล์ — ถ้าไม่ผสานกลับ กด "สอนระบบ" ครั้งเดียว
        หมวดที่เพิ่มไว้หายเงียบ ๆ แล้วรายการที่ลงหมวดนั้นกลายเป็นหมวดผี (ยอดหายจากงบ) */
  function cfcMergeAppCats(fileList, curList) {
    const out = (fileList || []).slice();
    const have = {}; out.forEach(m => { have[cfcNorm(m.name)] = 1; });
    (curList || []).forEach(m => {
      if (m && m.src === 'app' && !have[cfcNorm(m.name)]) cfcInsertCat(out, m);
    });
    return out;
  }

  /* นับว่าแต่ละหมวดถูกใช้ในกฎที่เรียนไว้กี่ข้อ — ใช้เตือนก่อนลบ/ก่อนทับผัง */
  function cfcRuleCatCount(rules) {
    const o = {};
    Object.keys(rules || {}).forEach(k => {
      const c = rules[k] && rules[k].cat;
      if (c) o[c] = (o[c] || 0) + 1;
    });
    return o;
  }

  function cfcWithExtraCats(list) {
    const out = (list || []).slice();
    const have = {}; out.forEach(m => { have[m.name] = 1; });
    CFC_MASTER_SEED.filter(g => g.a === 'transfer').forEach(g => g.items.forEach(n => {
      if (!have[n]) out.push({ name: n, act: g.a, group: g.g });
    }));
    return out;
  }

  /* ══════════════ UI atoms ══════════════ */
  function CfcChip({ tone, children, title }) {
    const T = { ok: [C.posBg, C.pos], warn: [C.warnBg, C.warn], bad: [C.negBg, C.neg], info: [C.infoBg, C.info], mute: [C.soft, C.mut] }[tone || 'mute'];
    return <span title={title} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: T[0], color: T[1], whiteSpace: 'nowrap' }}>{children}</span>;
  }
  /* ช่องกรอกจำนวนเงิน — แสดงคั่นหลักพันเหมือนตัวเลขอื่นในตาราง
     ⚠️ ใช้ <input type="number"> ไม่ได้ เบราว์เซอร์ไม่ยอมให้ค่ามีคอมมา (ตัวเลขในช่องจะ
        โล้น ๆ ไม่เหมือนคอลัมน์ข้าง ๆ ที่มีคอมมา — ผู้ใช้ทักว่าดูไม่เป็นสัดส่วน)
        จึงเป็น type=text + inputMode=decimal: โฟกัส = แก้เป็นเลขดิบ, ออกจากช่อง = จัดรูปให้ */
  function CfcMoneyInput({ value, placeholder, title, width, bad, onSave }) {
    const [txt, setTxt] = useState(value == null || value === '' ? '' : cfcMoney(value));
    const [hot, setHot] = useState(false);
    useEffect(() => { if (!hot) setTxt(value == null || value === '' ? '' : cfcMoney(value)); }, [value, hot]);
    return (
      <input type="text" inputMode="decimal" value={txt} placeholder={placeholder} title={title}
        onFocus={e => { setHot(true); setTxt(value == null || value === '' ? '' : String(value)); setTimeout(() => e.target.select(), 0); }}
        onChange={e => setTxt(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
        onBlur={e => {
          setHot(false);
          const raw = String(e.target.value).trim();
          if (raw === '') { setTxt(''); onSave(null); return; }
          const n = cfcNum(raw); setTxt(cfcMoney(n)); onSave(n);
        }}
        style={{ width: width || 120, fontSize: 12, padding: '3px 7px', borderRadius: 8, textAlign: 'right',
          fontVariantNumeric: 'tabular-nums', color: C.ink,
          border: '1px solid ' + (bad ? C.neg : C.line), background: bad ? C.negBg : '#fff' }} />
    );
  }

  const CFC_TIER = {
    locked: { label: '✅ ยืนยันแล้ว', tone: 'ok' },
    auto: { label: '🤖 มั่นใจ', tone: 'info' },
    ask: { label: '❓ ขอให้ยืนยัน', tone: 'warn' },
    new: { label: '🆕 รายการใหม่', tone: 'bad' },
  };

  /* ★ เรียง "รับ" ขึ้นก่อน "จ่าย" ในแต่ละกิจกรรม + ป้าย ▲รับ/▼จ่าย นำหน้าชื่อกลุ่ม
       เลือกหมวดได้เร็วขึ้นมาก เพราะฝั่งเงินคือสิ่งแรกที่คนดูอยู่แล้ว */
  /* จัดกลุ่มหมวดสำหรับ dropdown — cache ตาม identity ของ master (ตารางมีได้ 600 แถว
     ถ้าคิดใหม่ทุกแถวก็วนหมวด ~100 ตัว × 600 ครั้งทุกการ render) */
  const _cfcGroupCache = new WeakMap();
  function cfcCatGroups(master) {
    const hit = _cfcGroupCache.get(master); if (hit) return hit;
    const by = {};
    master.forEach(m => {
      const f = cfcFlowOf(m);
      const k = m.act + '|' + f + '|' + m.group;
      (by[k] = by[k] || []).push(m.name);
    });
    const rank = { op: 0, inv: 1, fin: 2, transfer: 3 };
    const out = Object.entries(by).sort((a, b) => {
      const [aa, af] = a[0].split('|'), [ba, bf] = b[0].split('|');
      // ⚠️ rank.op = 0 → (rank[aa] || 9) กลายเป็น 9 ทำให้ "ดำเนินงาน" ตกไปท้ายสุด
      const ra = rank[aa] == null ? 9 : rank[aa], rb = rank[ba] == null ? 9 : rank[ba];
      if (aa !== ba) return ra - rb;
      if (af !== bf) return af === 'in' ? -1 : 1;
      return 0;
    });
    _cfcGroupCache.set(master, out);
    return out;
  }
  function CfcCatSelect({ value, master, onChange, disabled, width }) {
    const groups = useMemo(() => cfcCatGroups(master), [master]);
    const cur = master.find(m => m.name === value);
    const fm = value ? CFC_FLOW_META[cfcFlowOf(cur || { name: value })] : null;
    /* ⚠️ ตารางแสดงได้ถึง 600 แถว × หมวด ~100 ตัว = <option> เป็นแสนโหนด — หน้าจะอืดตั้งแต่โหลด
       และอืดซ้ำทุกครั้งที่พิมพ์ค้นหา. จึงกางรายการหมวด "ตอนจะกดเลือกเท่านั้น"
       ★ ต้อง flushSync เพราะเบราว์เซอร์เปิด dropdown ทันทีหลังจบ mousedown — ถ้าปล่อยให้
         React อัปเดตทีหลัง ครั้งแรกจะเห็นแค่ตัวเลือกเดียว */
    const [ready, setReady] = useState(false);
    const wake = () => {
      if (ready) return;
      try { ReactDOM.flushSync(() => setReady(true)); } catch (e) { setReady(true); }
    };
    return (
      <select value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)}
        onMouseDown={wake} onFocus={wake} onKeyDown={wake} onTouchStart={wake}
        style={{ width: width || 232, maxWidth: '100%', fontSize: 12, padding: '4px 6px', borderRadius: 8,
          border: '1px solid ' + (value ? (fm ? fm.color + '55' : C.line) : '#f0c9c9'),
          background: value ? (fm ? fm.bg : '#fff') : '#fff8f8',
          color: fm ? fm.color : C.ink, fontWeight: value ? 600 : 400 }}>
        <option value="">— ยังไม่ลงหมวด —</option>
        {/* ต้องมี option ของค่าปัจจุบันเสมอ ไม่งั้น <select> จะเด้งกลับเป็นค่าว่าง
            — ทั้งตอนยังไม่กาง และตอนที่ค่านั้นเป็น "หมวดผี" ที่ไม่มีในผังหมวดแล้ว */}
        {value && (!ready || !cur) && <option value={value}>{value}</option>}
        {ready && groups.map(([k, items]) => {
          const [a, f, g] = k.split('|');
          const meta = CFC_FLOW_META[f] || CFC_FLOW_META.out;
          return (
            <optgroup key={k} label={meta.mark + ' ' + meta.label + ' · ' + (CFC_ACT_SHORT[a] || '') + ' · ' + g}>
              {items.map(n => <option key={n} value={n}>{n}</option>)}
            </optgroup>
          );
        })}
      </select>
    );
  }

  /* ── ฟอร์มหมวด (ใช้ร่วมกันทั้ง "เพิ่มใหม่" และ "แก้ไข") ──
     ★ กลุ่มในงบกรองด้วย กิจกรรม + ฝั่งเงิน (ผังจริงไม่มีกลุ่มไหนปนทั้งรับและจ่าย) */
  function CfcCatForm({ master, initial, submitLabel, onCancel, onSubmit }) {
    const [name, setName] = useState(initial ? initial.name : '');
    const [act, setAct] = useState(initial ? initial.act : 'op');
    const [flow, setFlow] = useState(initial ? cfcFlowOf(initial) : 'out');
    const [group, setGroup] = useState(initial ? initial.group : '');
    const [newGroup, setNewGroup] = useState('');
    const groups = useMemo(() => [...new Set(master.filter(m => m.act === act && cfcFlowOf(m) === flow).map(m => m.group))].filter(Boolean),
      [master, act, flow]);
    /* ⚠️ ต้องข้ามรอบแรก ไม่งั้นตอนเปิดฟอร์ม "แก้ไข" กลุ่มเดิมจะถูกรีเซ็ตทิ้งทันที */
    const first = useRef(true);
    useEffect(() => {
      if (first.current) { first.current = false; return; }
      setGroup(groups[0] || '__new'); setNewGroup('');
    }, [act, flow]);   // eslint-disable-line
    useEffect(() => { if (!initial && !group) setGroup(groups[0] || '__new'); }, []);   // eslint-disable-line

    const gFinal = group === '__new' ? cfcT(newGroup) : group;
    const fmSel = CFC_FLOW_META[flow] || CFC_FLOW_META.out;
    const dup = master.some(m => cfcNorm(m.name) === cfcNorm(name) && (!initial || m.name !== initial.name));
    const ok = cfcT(name) && gFinal && !dup;
    const lbl = { fontSize: 12, fontWeight: 700, color: C.mut, display: 'block', marginBottom: 4 };
    const inp = { width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 9, border: '1px solid ' + C.line };
    const send = () => ok && onSubmit({ name: cfcT(name), act, group: gFinal, flow });
    return (
      <div style={{ display: 'grid', gap: 13, padding: '4px 2px' }}>
        <div>
          <label style={lbl}>ชื่อหมวด</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} style={inp}
            placeholder="เช่น ค่าบริการคลาวด์" onKeyDown={e => { if (e.key === 'Enter') send(); }} />
          {dup && <div style={{ fontSize: 11.5, color: C.neg, marginTop: 4 }}>มีหมวดชื่อนี้อยู่แล้ว</div>}
        </div>
        <div>
          <label style={lbl}>เป็นเงินเข้าหรือเงินออก</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['in', 'out'].map(f => {
              const meta = CFC_FLOW_META[f];
              return (
                <button key={f} onClick={() => setFlow(f)} style={{
                  flex: 1, cursor: 'pointer', borderRadius: 10, padding: '8px 6px', fontSize: 13, fontWeight: 700,
                  border: '1px solid ' + (flow === f ? meta.color : C.line),
                  background: flow === f ? meta.color : '#fff', color: flow === f ? '#fff' : meta.color,
                }}>{meta.mark} {meta.label}</button>
              );
            })}
          </div>
        </div>
        <div>
          <label style={lbl}>อยู่ในกิจกรรมไหน</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['op', 'ดำเนินงาน'], ['inv', 'ลงทุน'], ['fin', 'จัดหาเงิน']].map(([k, t]) => (
              <button key={k} onClick={() => setAct(k)} style={{
                flex: 1, cursor: 'pointer', borderRadius: 10, padding: '8px 6px', fontSize: 13, fontWeight: 700,
                border: '1px solid ' + (act === k ? CFC_ACT_COLOR[k] : C.line),
                background: act === k ? CFC_ACT_COLOR[k] : '#fff', color: act === k ? '#fff' : C.ink,
              }}>{t}</button>
            ))}
          </div>
        </div>
        <div>
          <label style={lbl}>
            กลุ่มในงบ (หมวดจะไปต่อท้ายกลุ่มนี้)
            <span style={{ fontWeight: 600, color: fmSel.color, marginLeft: 6 }}>
              — เฉพาะ {fmSel.mark} {fmSel.label} · {CFC_ACT_SHORT[act] || ''}
            </span>
          </label>
          <select value={group} onChange={e => setGroup(e.target.value)}
            style={Object.assign({}, inp, { borderColor: fmSel.color + '55', background: fmSel.bg, color: fmSel.color, fontWeight: 600 })}>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
            <option value="__new">＋ สร้างกลุ่มใหม่…</option>
          </select>
          {!groups.length && <div style={{ fontSize: 11.5, color: C.warn, marginTop: 4 }}>
            ยังไม่มีกลุ่มฝั่ง “{fmSel.label}” ในกิจกรรม{CFC_ACT_SHORT[act] || ''} — ตั้งชื่อกลุ่มใหม่ได้เลย
          </div>}
          {group === '__new' && <input value={newGroup} onChange={e => setNewGroup(e.target.value)}
            placeholder="ชื่อกลุ่มใหม่ เช่น ค่าใช้จ่ายเทคโนโลยี" style={Object.assign({}, inp, { marginTop: 7 })} />}
        </div>
        <div style={{ fontSize: 11.5, color: C.mut, background: C.soft, borderRadius: 9, padding: '9px 12px', lineHeight: 1.7 }}>
          หมวดที่เพิ่ม/แก้ที่นี่ <strong>แชร์ให้ทั้งทีมทันที</strong> และมีผลกับงบที่ส่งออก/ดันขึ้นหน้า Cash Flow ทันที ·
          หมวดที่เพิ่มเองจะ<strong>ไม่หาย</strong>เมื่อกด “สอนระบบจากไฟล์ CASH FLOW” อีกครั้ง
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!ok} onClick={send}>{submitLabel}</button>
        </div>
      </div>
    );
  }

  /* ── 🗂 จัดการหมวด — เพิ่ม / แก้ชื่อ / ลบ ได้ในแอป ──
     ⚠️ ลำดับใน master = ลำดับแถวของชีตงบ ⇒ ทุกการเพิ่ม/ย้ายต้องผ่าน cfcInsertCat
     ⚠️ เปลี่ยนชื่อ/ลบ ต้องลากกฎที่เรียนไว้ตามไปด้วยเสมอ ไม่งั้นรายการที่เคยลงหมวดนี้
        กลายเป็น "หมวดผี" — ยอดไม่เข้าบรรทัดไหนในงบ และไม่ถูกนับว่ายังไม่ลงหมวด */
  function CfcCatManagerModal({ master, rules, onClose, onAdd, onEdit, onDelete }) {
    const [mode, setMode] = useState('list');     // list | add | edit
    const [target, setTarget] = useState(null);
    const [del, setDel] = useState(null);         // { row, n, moveTo }
    const [q, setQ] = useState('');
    const use = useMemo(() => cfcRuleCatCount(rules), [rules]);
    const groups = useMemo(() => {
      const by = {};
      master.forEach(m => { const k = m.act + '|' + cfcFlowOf(m) + '|' + m.group; (by[k] = by[k] || []).push(m); });
      const rank = { op: 0, inv: 1, fin: 2, transfer: 3 };
      return Object.entries(by).sort((a, b) => {
        const [aa, af] = a[0].split('|'), [ba, bf] = b[0].split('|');
        const ra = rank[aa] == null ? 9 : rank[aa], rb = rank[ba] == null ? 9 : rank[ba];
        if (aa !== ba) return ra - rb;
        if (af !== bf) return af === 'in' ? -1 : 1;
        return 0;
      });
    }, [master]);
    const nq = cfcNorm(q);
    const hit = (m) => !nq || cfcNorm(m.name).indexOf(nq) >= 0 || cfcNorm(m.group).indexOf(nq) >= 0;
    const shown = groups.map(([k, items]) => [k, items.filter(hit)]).filter(([, items]) => items.length);
    const nApp = master.filter(m => m.src === 'app').length;
    const inp = { width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 9, border: '1px solid ' + C.line };

    if (mode === 'add' || mode === 'edit') {
      return (
        <Modal open wide title={mode === 'add' ? '➕ เพิ่มหมวดใหม่' : '✏️ แก้ไขหมวด'} onClose={onClose}>
          {mode === 'edit' && use[target.name] > 0 && (
            <div style={{ fontSize: 11.5, color: C.info, background: C.infoBg, borderRadius: 9, padding: '8px 12px', marginBottom: 11, lineHeight: 1.65 }}>
              หมวดนี้ถูกใช้ในกฎที่ระบบเรียนไว้ <strong>{use[target.name]} ข้อ</strong> — เปลี่ยนชื่อแล้วกฎพวกนี้จะย้ายตามให้อัตโนมัติ
            </div>
          )}
          <CfcCatForm master={master} initial={mode === 'edit' ? target : null}
            submitLabel={mode === 'add' ? 'เพิ่มหมวด' : 'บันทึกการแก้ไข'}
            onCancel={() => { setMode('list'); setTarget(null); }}
            onSubmit={(row) => {
              if (mode === 'add') onAdd(row); else onEdit(target.name, row);
              onClose();
            }} />
        </Modal>
      );
    }

    return (
      <Modal open wide title="🗂 จัดการหมวดในงบกระแสเงินสด" onClose={onClose}
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 11.5, color: C.mut }}>
            {master.length} หมวด{nApp ? ' · เพิ่มเองในแอป ' + nApp : ''}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>ปิด</button>
            <button className="btn btn-primary" onClick={() => { setTarget(null); setMode('add'); }}>➕ เพิ่มหมวดใหม่</button>
          </span>
        </div>}>
        <div style={{ display: 'grid', gap: 10 }}>
          <input value={q} onChange={e => setQ(e.target.value)} style={inp} placeholder="ค้นหาชื่อหมวด / กลุ่ม…" />
          {del && (
            <div style={{ background: C.negBg, border: '1px solid #f3c8c2', borderRadius: 11, padding: '11px 13px', display: 'grid', gap: 9 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.neg }}>ลบหมวด “{del.row.name}” ?</div>
              {del.n > 0 ? (
                <>
                  <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.7 }}>
                    หมวดนี้ถูกใช้ในกฎที่เรียนไว้ <strong>{del.n} ข้อ</strong> — ต้องบอกก่อนว่าจะให้รายการพวกนั้นไปไหน
                    ไม่งั้นยอดจะหายจากงบแบบเงียบ ๆ
                  </div>
                  <select value={del.moveTo} onChange={e => setDel(Object.assign({}, del, { moveTo: e.target.value }))} style={inp}>
                    <option value="">— กลับเป็น “ยังไม่ลงหมวด” (ไปเลือกใหม่เอง) —</option>
                    {master.filter(m => m.name !== del.row.name).map(m => (
                      <option key={m.name} value={m.name}>{(CFC_FLOW_META[cfcFlowOf(m)] || {}).mark} {m.name}</option>
                    ))}
                  </select>
                </>
              ) : (
                <div style={{ fontSize: 12, color: C.mut }}>ยังไม่มีรายการไหนลงหมวดนี้ — ลบได้เลย</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setDel(null)}>ยกเลิก</button>
                <button className="btn" style={{ background: C.neg, borderColor: C.neg, color: '#fff' }}
                  onClick={() => { onDelete(del.row.name, del.moveTo); onClose(); }}>ลบหมวด</button>
              </div>
            </div>
          )}
          <div style={{ maxHeight: 430, overflow: 'auto', border: '1px solid ' + C.line, borderRadius: 11 }}>
            {!shown.length && <div style={{ padding: 18, fontSize: 12.5, color: C.mut, textAlign: 'center' }}>ไม่พบหมวดที่ค้น</div>}
            {shown.map(([k, items]) => {
              const [a, f, g] = k.split('|');
              const meta = CFC_FLOW_META[f] || CFC_FLOW_META.out;
              return (
                <div key={k}>
                  <div style={{ position: 'sticky', top: 0, zIndex: 1, background: meta.bg, color: meta.color,
                    fontSize: 11.5, fontWeight: 800, padding: '5px 11px', borderBottom: '1px solid ' + C.line }}>
                    {meta.mark} {meta.label} · {CFC_ACT_SHORT[a] || ''} · {g}
                  </div>
                  {items.map(m => (
                    <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px', borderBottom: '1px solid ' + C.soft }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.name}
                          {m.src === 'app' && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: C.primary }}>เพิ่มเอง</span>}
                        </div>
                        {use[m.name] > 0 && <div style={{ fontSize: 10.5, color: C.mut }}>ใช้ในกฎที่เรียนไว้ {use[m.name]} ข้อ</div>}
                      </div>
                      <button className="btn" style={{ padding: '3px 9px', fontSize: 11.5 }}
                        onClick={() => { setTarget(m); setMode('edit'); }}>✏️ แก้ไข</button>
                      <button className="btn" style={{ padding: '3px 9px', fontSize: 11.5, color: C.neg }}
                        onClick={() => setDel({ row: m, n: use[m.name] || 0, moveTo: '' })}>🗑</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: C.mut, background: C.soft, borderRadius: 9, padding: '9px 12px', lineHeight: 1.7 }}>
            ลำดับในรายการนี้ = <strong>ลำดับแถวในงบที่ส่งออก</strong> · หมวดที่ติดป้าย “เพิ่มเอง” จะไม่หายเมื่อกด “สอนระบบจากไฟล์ CASH FLOW” อีกครั้ง<br />
            ⚠️ ถ้ายังต้องเอาไปวางทับในไฟล์ CASH FLOW เดิม อย่าลืมเพิ่ม/ลบบรรทัดนี้ในไฟล์ด้วย ไม่งั้นแถวจะเลื่อนกัน
          </div>
        </div>
      </Modal>
    );
  }

  /* สร้าง AOA ของ "งบกระแสเงินสด" จากยอดราย (หมวด|เดือน)
     แยกออกมานอก component เพื่อให้ทั้งการส่งออกไฟล์และการดันขึ้นหน้า Cash Flow
     (ซึ่งต้องรวมทุกเดือน ไม่ใช่เฉพาะเดือนที่เลือก) ใช้ตัวเดียวกัน */
  /* ★ ทับคอลัมน์ของ "เดือนที่ไม่ได้ส่ง" ด้วยตัวเลขเดิมของงบ — ทุกแถว ไม่ใช่แค่รายการย่อย
     ⚠️ ทับเฉพาะรายการย่อยไม่พอ: แถว "รวม…" / "กระแสเงินสดสุทธิจาก…" / "เงินสดสุทธิ" ระบบคิดใหม่
        จากผังหมวดปัจจุบัน ซึ่งไม่จำเป็นต้องเท่ากับที่ไฟล์เดิมสรุปไว้ (ของจริงต่าง 5,700 ที่ พ.ค.
        แล้วยอดคงเหลือเลื่อนยาวทั้งแถบตั้งแต่ มิ.ย. เป็นต้นไป)
     แล้วเดิน "ต้นงวด/ปลายงวด" ใหม่จากบรรทัดสุทธิที่ทับแล้ว เพื่อให้ต่อกันทั้งแถบ
     (เดือนที่ส่งใหม่จะต่อยอดจากเดือนเก่าได้ถูก) */
  function cfcApplyOldColumns(aoa, months, keepSet, oldByLabel, oldCol) {
    const kinds = aoa.kinds || [];
    const hdr = aoa.findIndex(r => cfcT(r[0]) === 'รายการ');
    if (hdr < 0) return;
    const n = months.length;
    for (let r = hdr + 1; r < aoa.length; r++) {
      const lab = cfcCanonRowLabel(aoa[r][0]); if (!lab) continue;
      const src = oldByLabel[lab]; if (!src) continue;
      months.forEach((m, i) => { if (keepSet.has(m) && oldCol[m] != null) aoa[r][i + 1] = cfcNum(src[oldCol[m]]); });
    }
    const rowOf = (re) => { for (let r = hdr + 1; r < aoa.length; r++) if (re.test(cfcT(aoa[r][0]))) return r; return -1; };
    const rNet = rowOf(/^เงินสดสุทธิ/), rBf = rowOf(/^เงินสดต้นงวด/), rBal = rowOf(/^เงินสดคงเหลือปลายงวด\//);
    if (rNet >= 0 && rBf >= 0 && rBal >= 0) {
      let run = cfcNum(aoa[rBf][1]);
      months.forEach((m, i) => { aoa[rBf][i + 1] = run; run += cfcNum(aoa[rNet][i + 1]); aoa[rBal][i + 1] = run; });
      aoa[rBf][n + 1] = cfcNum(aoa[rBf][1]); aoa[rBal][n + 1] = '';
    }
    // ช่อง "รวม" ต้องคิดใหม่หลังทับ (แถวยอดคงเหลือไม่รวม — ผลรวมของยอดคงเหลือไม่มีความหมาย)
    for (let r = hdr + 1; r < aoa.length; r++) {
      if (kinds[r] === 'cash') continue;
      let s = 0, any = false;
      for (let i = 0; i < n; i++) { const v = aoa[r][i + 1]; if (v === '' || v == null) continue; any = true; s += cfcNum(v); }
      if (any) aoa[r][n + 1] = s;
    }
  }

  /* ⚠️ `cash` = { opening, stmClosing } → บรรทัดท้ายงบ (ต้นงวดยกมา / ปลายงวด / ปลายงวดจาก STM)
       ต้องมีให้เหมือนไฟล์ CASH FLOW เดิม ไม่งั้นงบจบห้วน ๆ ที่บรรทัด "เงินสดสุทธิ"
       ★ 3 แถวนี้อยู่ "ต่อจากบรรทัดเงินสดสุทธิทันที" เหมือนในไฟล์ — index แถวเหนือขึ้นไปไม่ขยับ */
  function cfcSummaryAoa(master, months, cell, monLabel, usedCats, cash) {
    /* ★ kinds[i] = ชนิดของแถวที่ i — ใช้ตอนจัดสีในไฟล์ Excel เท่านั้น
         สร้างตรงจุดที่ push แถว จะได้ไม่มีตัวเดาชนิดจาก "ช่องว่างหน้าข้อความ" ซ้อนอีกชุด */
    const kinds = [];
    const push = (row, kind) => { aoa.push(row); kinds[aoa.length - 1] = kind; return row; };
    const val = (name) => months.map(m => cell[name + '|' + m] || 0);
    const sumRow = (names) => months.map(m => names.reduce((a, n) => a + (cell[n + '|' + m] || 0), 0));
    const withTotal = (arr) => arr.concat([arr.reduce((a, x) => a + x, 0)]);
    const aoa = [['บริษัท ไบโอแอ็กซ์เซล จำกัด'], ['งบกระแสเงินสด (รายเดือน)'],
      ['สำหรับงวด ' + (months.length ? monLabel(months[0]) + (months.length > 1 ? ' ถึง ' + monLabel(months[months.length - 1]) : '') : '')],
      [], ['รายการ'].concat(months.map(monLabel)).concat(['รวม'])];
    kinds[0] = 'co'; kinds[1] = 'title'; kinds[2] = 'period'; kinds[3] = 'gap'; kinds[4] = 'head';
    const SEC = { op: 'กระแสเงินสดจากกิจกรรมดำเนินงาน', inv: 'กระแสเงินสดจากกิจกรรมลงทุน', fin: 'กระแสเงินสดจากกิจกรรมจัดหาเงิน' };
    const actNet = {};
    ['op', 'inv', 'fin'].forEach(a => {
      const inAct = master.filter(m => m.act === a);
      if (!inAct.length) return;
      push([SEC[a]], 'sec');
      [...new Set(inAct.map(m => m.group))].forEach(g => {
        const items = inAct.filter(m => m.group === g).map(m => m.name);
        push(['   ' + g], 'grp');
        items.forEach(n => push(['      ' + n].concat(withTotal(val(n))), 'item'));
        push(['   รวม' + g].concat(withTotal(sumRow(items))), 'gsum');
      });
      actNet[a] = sumRow(inAct.map(m => m.name));
      push(['กระแสเงินสดสุทธิจาก' + SEC[a].replace('กระแสเงินสดจาก', '')].concat(withTotal(actNet[a])), 'anet');
      push([], 'gap');
    });
    const net = months.map((m, i) => ['op', 'inv', 'fin'].reduce((a, k) => a + ((actNet[k] || [])[i] || 0), 0));
    push(['เงินสดสุทธิ เพิ่มขึ้น (ลดลง)/Cash increased (decreased)'].concat(withTotal(net)), 'net');
    if (cash) {
      const bf = [], bal = []; let run = cfcNum(cash.opening);
      months.forEach((m, i) => { bf.push(run); run += (net[i] || 0); bal.push(run); });
      /* ★ ช่อง "รวม" ของแถวยอดคงเหลือปล่อยว่าง (ผลรวมของยอดคงเหลือไม่มีความหมาย) —
         ตรงกับไฟล์ CASH FLOW เดิม: B/F รวม = ต้นงวดของเดือนแรก · อีก 2 แถวเว้นว่าง */
      push(['เงินสดต้นงวดยกมา/Cash B/F'].concat(bf).concat([bf.length ? bf[0] : 0]), 'cash');
      push(['เงินสดคงเหลือปลายงวด/Cash Balance'].concat(bal).concat(['']), 'cash');
      /* ยอดจริงในบัญชี — ไว้ตรวจว่างบที่คิดได้ตรงกับเงินจริงไหม
         ⚠️ ถ้ายังได้ยอดไม่ครบทุกบัญชี ต้องเตือนที่ "ชื่อบรรทัด" (ตัวเลขยังโชว์ไว้ให้เทียบ)
            ไม่งั้นยอดที่ต่ำกว่าความจริงจะดูเหมือนเงินหาย */
      const st = months.map(m => cfcNum((cash.stmClosing || {})[m]));
      push(['เงินสดคงเหลือปลายงวด จาก STM' + (cash.stmShort ? ' (ยังได้ยอดไม่ครบทุกบัญชี)' : '')]
        .concat(st).concat(['']), 'cash');
    }
    push([], 'gap');
    push(['— รายการที่ไม่นับเป็นกิจกรรม (ไว้ตรวจ ไม่ต้องวางในงบ) —'], 'nsec');
    push(['   โอนเงินระหว่างบัญชี (ควรเป็น 0 เมื่อรวมทุกบัญชี)'].concat(withTotal(val('โอนเงินระหว่างบัญชี'))), 'nitem');
    push(['   (ยังไม่ลงหมวด)'].concat(withTotal(val('(ยังไม่ลงหมวด)'))), 'nitem');
    const known = new Set(master.map(m => m.name).concat(['โอนเงินระหว่างบัญชี', '(ยังไม่ลงหมวด)']));
    (usedCats || []).filter(c => !known.has(c))
      .forEach(n => push(['   ⚠ ' + n + ' (ไม่มีในผังหมวด — ต้องแก้)'].concat(withTotal(val(n))), 'nbad'));
    aoa.kinds = kinds;
    return aoa;
  }

  /* ════════ ตัวจัดสี/จัดตารางไฟล์ Excel ════════
     ผู้ใช้ขอ "จัดสีจัดตารางให้เรียบร้อย" — สีเดียวกับที่ใช้บนหน้าจอ: เขียว = รับ · แดง = จ่าย */
  const XS = {
    brand: '2E8B4A', brandD: '1F6E3A', soft: 'EEF6F1', line: 'D6E7DC',
    ink: '20342A', mut: '688275', pos: '15875A', neg: 'C0392B',
    warnBg: 'FFF7E0', warnInk: '8A6400', zebra: 'F7FBF8',
  };
  const XS_FONT = 'Leelawadee UI';
  const xsB = (w) => ({ style: w || 'thin', color: { rgb: XS.line } });
  const xsBox = (w) => ({ top: xsB(w), bottom: xsB(w), left: xsB(w), right: xsB(w) });
  const XS_MONEY = '#,##0.00;[Red]-#,##0.00;"–"';
  /* ใส่ style ให้ทั้งแถว (กว้าง nCol ช่อง) — สร้างเซลล์ว่างให้ด้วย เพื่อให้พื้น/เส้นต่อกันไม่ขาด */
  function xsRow(ws, r, nCol, style, only) {
    for (let c = 0; c < nCol; c++) {
      const a = XLSX.utils.encode_cell({ r, c });
      if (!ws[a]) { if (only) continue; ws[a] = { t: 's', v: '' }; }
      ws[a].s = Object.assign({}, ws[a].s, typeof style === 'function' ? style(c) : style);
    }
  }
  function xsCell(ws, r, c, style) {
    const a = XLSX.utils.encode_cell({ r, c });
    if (ws[a]) ws[a].s = Object.assign({}, ws[a].s, style);
  }
  /* ตัวเลขในงบ: เขียว = เงินเข้า · แดง = เงินออก · 0 = ขีด (ตามที่ใช้บนหน้าจอ) */
  function xsMoney(ws, r, c, opt) {
    const a = XLSX.utils.encode_cell({ r, c }), cl = ws[a];
    if (!cl || typeof cl.v !== 'number') return;
    const o = opt || {};
    cl.s = Object.assign({}, cl.s, {
      numFmt: XS_MONEY,
      alignment: { horizontal: 'right', vertical: 'center' },
      font: Object.assign({ name: XS_FONT, sz: o.sz || 10.5, bold: !!o.bold },
        o.ink ? { color: { rgb: o.ink } } : { color: { rgb: cl.v > 0.004 ? XS.pos : (cl.v < -0.004 ? XS.neg : 'B4C6BB') } }),
    });
  }

  /* ── ชีต "งบกระแสเงินสด" — หน้าตาเหมือนหน้าแรกของไฟล์ CASH FLOW ──
     ⚠️ ใส่ได้แค่ "สี/เส้น/รูปแบบตัวเลข" ห้ามเพิ่ม-ลด-สลับแถว: index แถวต้องตรงกับไฟล์เดิม
        เตยยังต้องก็อปคอลัมน์เดือนไปวางทับได้ทั้งแถบ */
  function cfcStyleSummary(ws, aoa, nCol) {
    const kinds = aoa.kinds || [], n = aoa.length;
    const merges = [], rows = [];
    [0, 1, 2].forEach(r => merges.push({ s: { r, c: 0 }, e: { r, c: nCol - 1 } }));
    rows[0] = { hpt: 26 }; rows[1] = { hpt: 20 }; rows[2] = { hpt: 17 }; rows[3] = { hpt: 7 }; rows[4] = { hpt: 24 };
    xsRow(ws, 0, nCol, { font: { name: XS_FONT, sz: 15, bold: true, color: { rgb: XS.brandD } }, alignment: { horizontal: 'center', vertical: 'center' } });
    xsRow(ws, 1, nCol, { font: { name: XS_FONT, sz: 12.5, bold: true, color: { rgb: XS.ink } }, alignment: { horizontal: 'center', vertical: 'center' } });
    xsRow(ws, 2, nCol, { font: { name: XS_FONT, sz: 10, color: { rgb: XS.mut } }, alignment: { horizontal: 'center', vertical: 'center' } });
    xsRow(ws, 4, nCol, (c) => ({
      font: { name: XS_FONT, sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: XS.brand } },
      alignment: { horizontal: c === 0 ? 'left' : 'center', vertical: 'center' },
      border: { top: xsB(), bottom: xsB('medium'), left: xsB(), right: xsB() },
    }));
    for (let r = 5; r < n; r++) {
      const k = kinds[r];
      if (!k || k === 'gap') { rows[r] = { hpt: 6 }; continue; }
      const label = { name: XS_FONT, sz: 10.5, color: { rgb: XS.ink } };
      if (k === 'sec') {
        merges.push({ s: { r, c: 0 }, e: { r, c: nCol - 1 } }); rows[r] = { hpt: 21 };
        xsRow(ws, r, nCol, { font: { name: XS_FONT, sz: 11.5, bold: true, color: { rgb: XS.brandD } },
          fill: { patternType: 'solid', fgColor: { rgb: 'DCEEE3' } },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: { top: xsB('medium'), bottom: xsB() } });
      } else if (k === 'grp') {
        merges.push({ s: { r, c: 0 }, e: { r, c: nCol - 1 } });
        xsRow(ws, r, nCol, { font: { name: XS_FONT, sz: 10.5, bold: true, color: { rgb: XS.mut } },
          fill: { patternType: 'solid', fgColor: { rgb: XS.soft } }, alignment: { vertical: 'center' } });
      } else if (k === 'item' || k === 'nitem') {
        xsRow(ws, r, nCol, { border: xsBox() }, true);
        xsCell(ws, r, 0, { font: label, alignment: { vertical: 'center' } });
        for (let c = 1; c < nCol; c++) xsMoney(ws, r, c, k === 'nitem' ? { ink: XS.mut } : {});
      } else if (k === 'gsum') {
        xsRow(ws, r, nCol, { fill: { patternType: 'solid', fgColor: { rgb: XS.soft } }, border: { top: xsB(), bottom: xsB() } });
        xsCell(ws, r, 0, { font: { name: XS_FONT, sz: 10.5, bold: true, color: { rgb: XS.mut } }, alignment: { vertical: 'center' } });
        for (let c = 1; c < nCol; c++) xsMoney(ws, r, c, { bold: true });
      } else if (k === 'anet') {
        rows[r] = { hpt: 20 };
        xsRow(ws, r, nCol, { fill: { patternType: 'solid', fgColor: { rgb: 'CDE7D8' } }, border: { top: xsB('medium'), bottom: xsB('medium') } });
        xsCell(ws, r, 0, { font: { name: XS_FONT, sz: 11, bold: true, color: { rgb: XS.brandD } }, alignment: { vertical: 'center' } });
        for (let c = 1; c < nCol; c++) xsMoney(ws, r, c, { bold: true, sz: 11 });
      } else if (k === 'cash') {
        rows[r] = { hpt: 20 };
        xsRow(ws, r, nCol, { fill: { patternType: 'solid', fgColor: { rgb: 'DDF0E3' } }, border: { bottom: xsB() } });
        xsCell(ws, r, 0, { font: { name: XS_FONT, sz: 11, bold: true, color: { rgb: XS.brandD } }, alignment: { vertical: 'center' } });
        for (let c = 1; c < nCol; c++) xsMoney(ws, r, c, { bold: true, sz: 11, ink: XS.ink });
      } else if (k === 'net') {
        rows[r] = { hpt: 24 };
        xsRow(ws, r, nCol, { fill: { patternType: 'solid', fgColor: { rgb: XS.brand } },
          border: { top: xsB('medium'), bottom: xsB('double') } });
        xsCell(ws, r, 0, { font: { name: XS_FONT, sz: 12, bold: true, color: { rgb: 'FFFFFF' } }, alignment: { vertical: 'center' } });
        for (let c = 1; c < nCol; c++) xsMoney(ws, r, c, { bold: true, sz: 12, ink: 'FFFFFF' });
      } else if (k === 'nsec') {
        merges.push({ s: { r, c: 0 }, e: { r, c: nCol - 1 } }); rows[r] = { hpt: 19 };
        xsRow(ws, r, nCol, { font: { name: XS_FONT, sz: 10.5, bold: true, color: { rgb: XS.mut } }, alignment: { vertical: 'center' } });
      } else if (k === 'nbad') {
        xsRow(ws, r, nCol, { fill: { patternType: 'solid', fgColor: { rgb: XS.warnBg } }, border: xsBox() });
        xsCell(ws, r, 0, { font: { name: XS_FONT, sz: 10.5, bold: true, color: { rgb: XS.warnInk } } });
        for (let c = 1; c < nCol; c++) xsMoney(ws, r, c, { bold: true, ink: XS.warnInk });
      }
    }
    ws['!merges'] = merges; ws['!rows'] = rows;
    ws['!freeze'] = { xSplit: 1, ySplit: 5 };
  }

  /* ── ชีต "รายละเอียดทุกรายการ" — หัวตารางอยู่แถว 1 เสมอ
        (ตัวอ่านของหน้า Cash Flow และการก็อปไปวางพึ่งตำแหน่งนี้อยู่) ── */
  const CFC_XL_MONEY_COL = { 6: XS.neg, 7: XS.pos, 8: XS.ink };
  function cfcStyleDetail(ws, aoa) {
    const n = aoa.length, nCol = 13, rows = [{ hpt: 26 }];
    xsRow(ws, 0, nCol, {
      font: { name: XS_FONT, sz: 10.5, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: XS.brand } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: xsBox(),
    });
    for (let r = 1; r < n; r++) {
      const zebra = r % 2 === 0 ? { patternType: 'solid', fgColor: { rgb: XS.zebra } } : null;
      const noCat = !String((aoa[r] || [])[11] || '').trim();
      xsRow(ws, r, nCol, (c) => Object.assign(
        { font: { name: XS_FONT, sz: 10, color: { rgb: XS.ink } }, border: xsBox(),
          alignment: (c === 0 || c === 3 || c === 4 || c === 9)
            ? { horizontal: 'center', vertical: 'center' } : { vertical: 'center' } },
        zebra ? { fill: zebra } : null,
      ));
      Object.keys(CFC_XL_MONEY_COL).forEach(c => xsMoney(ws, r, +c, { ink: CFC_XL_MONEY_COL[c] }));
      /* แถวที่ยังไม่ลงหมวด = ไฮไลต์เหลืองที่ช่องหมวด จะได้ไล่เก็บได้เร็ว */
      if (noCat) xsCell(ws, r, 11, { fill: { patternType: 'solid', fgColor: { rgb: XS.warnBg } },
        font: { name: XS_FONT, sz: 10, bold: true, color: { rgb: XS.warnInk } } });
      else xsCell(ws, r, 11, { font: { name: XS_FONT, sz: 10, bold: true, color: { rgb: XS.brandD } } });
    }
    ws['!rows'] = rows;
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    if (n > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: n - 1, c: nCol - 1 } }) };
  }

  /* ── ชีต "ตรวจยอดรายบัญชี" — หัวตารางอยู่แถวที่ 4 (index 3) ── */
  function cfcStyleCheck(ws, aoa, badCols) {
    const n = aoa.length, nCol = (aoa[3] || []).length, rows = [];
    rows[0] = { hpt: 19 };
    [0, 1].forEach(r => xsRow(ws, r, nCol, {
      font: { name: XS_FONT, sz: r ? 10 : 11.5, bold: !r, color: { rgb: r ? XS.mut : XS.brandD } },
    }, true));
    rows[3] = { hpt: 32 };
    xsRow(ws, 3, nCol, {
      font: { name: XS_FONT, sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: XS.brand } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: xsBox(),
    });
    for (let r = 4; r < n; r++) {
      if (!(aoa[r] || []).length) { rows[r] = { hpt: 6 }; continue; }
      const last = r === n - 1;
      xsRow(ws, r, nCol, (c) => Object.assign(
        { font: { name: XS_FONT, sz: 10, bold: last, color: { rgb: XS.ink } }, border: xsBox(),
          alignment: c === 2 ? { horizontal: 'center', vertical: 'center' } : { vertical: 'center' } },
        last ? { fill: { patternType: 'solid', fgColor: { rgb: XS.soft } },
          border: { top: xsB('medium'), bottom: xsB('medium'), left: xsB(), right: xsB() } } : null,
      ));
      for (let c = 3; c < nCol - 2; c++) xsMoney(ws, r, c, { ink: XS.ink, bold: last });
      /* ช่อง "ต่าง" ที่ไม่เป็นศูนย์ = แดงเข้มพื้นแดงจาง — จุดที่ต้องไปไล่หา */
      (badCols || []).forEach(c => {
        const a = XLSX.utils.encode_cell({ r, c }), cl = ws[a];
        if (cl && typeof cl.v === 'number' && Math.abs(cl.v) > 0.02) {
          cl.s = Object.assign({}, cl.s, { fill: { patternType: 'solid', fgColor: { rgb: 'FDECEA' } },
            font: { name: XS_FONT, sz: 10, bold: true, color: { rgb: XS.neg } } });
        }
      });
    }
    ws['!rows'] = rows;
    ws['!freeze'] = { xSplit: 2, ySplit: 4 };
  }

  /* ══════════════ หน้าหลัก ══════════════ */
  function CfCodingPage({ data, setData, toast }) {
    const canEdit = typeof WTPAuth !== 'undefined' && WTPAuth.can ? WTPAuth.can('canEdit') : true;
    const [store, setStore] = useState(() => cfcLoadLocal());
    const [synced, setSynced] = useState(false);
    const [busy, setBusy] = useState('');
    const [ym, setYm] = useState('');
    const [acct, setAcct] = useState('');
    const [tab, setTab] = useState('all');
    const [q, setQ] = useState('');
    const [open, setOpen] = useState({});          // docNo → เปิดดูบิลย่อย
    const [teachRes, setTeachRes] = useState(null);
    const [addCat, setAddCat] = useState(false);
    const [pushAsk, setPushAsk] = useState(false);   // หน้าต่างยืนยัน "จะดันเดือนไหน"
    const fileBank = useRef(null), fileCf = useRef(null);

    /* ── โหลดจากส่วนกลาง ── */
    useEffect(() => {
      if (!cfcCanSync()) return;
      WTPData.fetchSheetRows(CFC_TABLE).then(rows => {
        if (!rows || !rows.length) return;
        const o = {};
        rows.forEach(r => { const id = r.id || (r.data && r.data.id); const d = r.data || r; if (id) o[id] = d; });
        if (Object.keys(o).length) { setStore(o); cfcSaveLocal(o); setSynced(true); }
      }).catch(e => console.warn('[cfc] load', e && e.message));
    }, []);

    /* ⚠️ เขียนเฉพาะ "แถวที่เปลี่ยน" — ตารางนี้เก็บบรรทัดดิบเป็นก้อนใหญ่ (1 บัญชี 1 เดือน ≈ 58KB)
       ถ้าเรียก writeTable ทุกครั้ง = ดาวน์โหลดทั้งตารางแล้วอัปโหลดทุกเดือนซ้ำ ทั้งที่ยืนยันหมวด
       ไปแค่รายการเดียว (หน้าค้างทุกคลิก). ทุกที่ที่เรียก persist สร้าง object ใหม่ให้ id ที่แก้
       ⇒ เทียบด้วย identity พอ. ยังไม่เคย sync (server ว่าง) → เขียนเต็มชุดครั้งแรกตามเดิม */
    const persist = (next) => {
      const prev = store;
      setStore(next); cfcSaveLocal(next);
      if (!cfcCanSync()) return Promise.resolve({ shared: false });
      const ok = () => { setSynced(true); return { shared: true }; };
      const fail = e => { console.warn('[cfc] save', e && e.message); return { shared: false, err: e }; };
      const rows = Object.keys(next).map(id => Object.assign({ id }, next[id]));
      if (!synced || typeof WTPData.upsertSheetRows !== 'function') {
        return WTPData.writeTable(CFC_TABLE, rows, r => r.id).then(ok).catch(fail);
      }
      const dirty = rows.filter(r => next[r.id] !== prev[r.id]);
      const gone = Object.keys(prev).filter(id => !(id in next));
      if (!dirty.length && !gone.length) return Promise.resolve({ shared: true });
      return WTPData.upsertSheetRows(CFC_TABLE, dirty, r => r.id)
        .then(() => (gone.length ? WTPData.forceDeleteRows(CFC_TABLE, gone) : null))
        .then(ok).catch(fail);
    };

    /* ── หมวดมาตรฐาน ── */
    const master = useMemo(() => {
      const m = store.master && Array.isArray(store.master.items) && store.master.items.length ? store.master.items : null;
      if (m) return cfcWithExtraCats(m);          // ★ ผนวก "โอนเงินระหว่างบัญชี" กลับเสมอ แม้ไฟล์เก่าไม่มี
      const out = []; CFC_MASTER_SEED.forEach(g => g.items.forEach(n => out.push({ name: n, act: g.a, group: g.g })));
      return out;
    }, [store.master]);
    const catAct = useMemo(() => { const o = {}; master.forEach(m => { o[m.name] = m.act; }); return o; }, [master]);
    const rules = useMemo(() => (store.rules && store.rules.map) || {}, [store.rules]);
    const engine = useMemo(() => cfcBuildEngine(rules, catAct), [rules, catAct]);

    /* ── บรรทัดดิบทั้งหมดที่นำเข้าไว้ ── */
    const buckets = useMemo(() => {
      const out = [];
      Object.keys(store).forEach(id => {
        if (id.indexOf('lines:') !== 0) return;
        const b = store[id]; if (!b || !Array.isArray(b.lines)) return;
        // ★ ต้องพา opening (ยอดยกมาที่ไฟล์ประกาศ) มาด้วย — ตกไปแล้วตัวตรวจ "ยกมา" จะ
        //   ตกไปใช้ค่าที่คำนวณเองเงียบ ๆ (เห็นได้จากป้าย "คำนวณจากรายการแรก")
        out.push({ id, acctNo: b.acctNo || '', acctLabel: b.acctLabel || '', ym: b.ym || '',
          opening: (b.opening == null ? null : b.opening), lines: b.lines, uploadedAt: b.uploadedAt });
      });
      return out.sort((a, b) => (a.ym === b.ym ? String(a.acctNo).localeCompare(String(b.acctNo)) : (a.ym < b.ym ? 1 : -1)));
    }, [store]);
    /* ใบจ่ายจากรายงานการจ่ายชำระหนี้ (291) — แหล่งหลักของ "ค่าใช้จ่ายรายบิล" */
    const psBuckets = useMemo(() => {
      const out = [];
      Object.keys(store).forEach(id => {
        if (id.indexOf('ps:') !== 0) return;
        const b = store[id]; if (!b || !Array.isArray(b.vouchers)) return;
        out.push({ id, ym: b.ym || '', vouchers: b.vouchers, uploadedAt: b.uploadedAt, file: b.file });
      });
      return out.sort((a, b) => (a.ym < b.ym ? 1 : -1));
    }, [store]);

    /* ★ ต้องรวมเดือนจาก pvVouchers ด้วย — ถ้ายังไม่ได้นำเข้างบกระทบยอด แหล่งเดียวที่มีคือ
         ใบจ่ายที่ sync มา ถ้าไม่นับ ตัวเลือกเดือนจะว่างแล้วดูเหมือนไม่มีข้อมูล */
    const allYms = useMemo(() => {
      const set = new Set(buckets.map(b => b.ym).concat(psBuckets.map(b => b.ym)));
      (data.pvVouchers || []).forEach(pv => { const k = String(cfcISO(pv.Pmt_Date)).slice(0, 7); if (k) set.add(k); });
      return [...set].filter(Boolean).sort().reverse();
    }, [buckets, psBuckets, data.pvVouchers]);
    const allAccts = useMemo(() => {
      const m = {}; buckets.forEach(b => { m[b.acctNo] = b.acctLabel || b.acctNo; }); return Object.entries(m);
    }, [buckets]);
    useEffect(() => { if (!ym && allYms.length) setYm(allYms[0]); }, [allYms, ym]);

    /* ── join กับ pvVouchers + เสนอหมวด ── */
    const pvIdx = useMemo(() => cfcBuildPvIndex(data.pvVouchers || []), [data.pvVouchers]);

    /* ทะเบียนบัญชี (ส่วนกลาง > seed) — ใช้บอกว่า "มีกี่แบงค์ / ขาดแบงค์ไหน" */
    const bankMaster = useMemo(() => {
      const m = store.banks && Array.isArray(store.banks.items) && store.banks.items.length ? store.banks.items : CFC_BANK_SEED;
      return m.map(b => Object.assign({}, b, { key: cfcAcctKey(b.no, b.no) }));
    }, [store.banks]);

    /* หาบัญชีจากข้อความธนาคารในใบจ่าย ("SCB#4839") → เทียบ 4 ตัวท้ายกับทะเบียน/ไฟล์ที่นำเข้า */
    const acctOf = useMemo(() => {
      const cands = bankMaster.map(b => ({ no: cfcDigits(b.no), label: b.bank + ' ' + b.no }))
        .concat(buckets.map(b => ({ no: cfcDigits(b.acctNo), label: b.acctLabel || b.acctNo })));
      return (txt) => {
        const d = cfcDigits(txt);
        if (d.length >= 3) {
          const tail = d.slice(-4);
          const hit = cands.find(c => c.no && c.no.slice(-4) === tail);
          if (hit) return hit;
        }
        return { no: '', label: cfcT(txt) || '(ไม่ระบุบัญชี)' };
      };
    }, [bankMaster, buckets]);

    /* ⚠️ "หนึ่งบัญชี = หนึ่งชื่อ" — บิลจากใบจ่ายได้ชื่อจากทะเบียน ("SCB 136-268483-9")
       ส่วนบรรทัดธนาคารได้ชื่อจากหัวไฟล์ EXPRESS ("S/A# SCB 136-268483-9 …") คนละสตริงกัน
       ปล่อยไว้ = หน้า Cash Flow เห็นเป็น "คนละบัญชี" ต้นงวด/ปลายงวดแตกเป็น 2 ก้อนเงียบ ๆ
       จับคู่ด้วยเลข 4 ตัวท้าย (เหมือน acctOf) เพราะบางไฟล์อ่านเลขบัญชีได้แค่ 4 ตัวจากชื่อไฟล์ */
    const acctLabelOf = useMemo(() => {
      const byTail = {};
      buckets.forEach(b => {
        const t = cfcDigits(b.acctNo).slice(-4);
        if (t && !byTail[t] && b.acctLabel) byTail[t] = b.acctLabel;
      });
      return (no, label) => {
        const t = cfcDigits(no).slice(-4);
        return (t && byTail[t]) || label || '(ไม่ระบุบัญชี)';
      };
    }, [buckets]);

    const rows = useMemo(() => {
      const out = [];
      const norm = v => cfcT(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
      /* (ก) บิลจากใบจ่าย — 1 บิล = 1 แถวลงรหัส
         ★ แหล่งหลัก = pvVouchers (นำเข้าไว้แล้วหน้า "ใบสำคัญจ่าย" · sync ทั้งทีม)
           ไฟล์ 291 ที่โยนเข้าหน้านี้เป็นแค่ตัวเสริมเฉพาะใบที่ยังไม่มีในระบบ */
      const covered = new Map();    // key → ยอดเงินของใบนั้น (ไว้เทียบยอดก่อนตัดบรรทัดธนาคารทิ้ง)
      const seenDoc = new Set();
      const addVoucher = (v, srcTag, bucketId) => {
        const dk = norm(v.doc); if (!dk || seenDoc.has(dk)) return;
        seenDoc.add(dk);
        const amt = Math.abs(v.cheque || v.cash || v.gross);
        cfcCoverKeys(v).forEach(k => covered.set(k, amt));
        cfcVoucherToRows(v, acctOf).forEach((r, i) => {
          if (acct && cfcDigits(r.acctNo) !== cfcDigits(acct)) return;
          const row = Object.assign({}, r, {
            key: 'ps|' + v.doc + '|' + i, bucketId: bucketId, balance: '', pv: null, bills: [],
            pvPayee: r.payee, matchHow: 'ps', psSrc: srcTag,
            matchText: [r.memo, r.payee].filter(Boolean).join(' '),
          });
          row.sug = engine(row);
          out.push(row);
        });
      };
      (data.pvVouchers || []).forEach(pv => {
        const v = cfcPvToVoucher(pv);
        if (!v.doc || !v.iso) return;
        if (ym && String(v.iso).slice(0, 7) !== ym) return;
        addVoucher(v, 'pv', 'pvVouchers');
      });
      psBuckets.filter(b => !ym || b.ym === ym).forEach(b =>
        (b.vouchers || []).forEach(v => addVoucher(v, 'file', b.id)));
      /* (ข) งบกระทบยอด — เอาเฉพาะบรรทัดที่ "ไม่มีใน 291" (เงินเข้า/โอน/ค่าธรรมเนียม/ใบอนุมัติจ่าย) */
      const sel = buckets.filter(b => (!ym || b.ym === ym) && (!acct || b.acctNo === acct));
      sel.forEach(b => (b.lines || []).forEach(L => {
        // ลงรหัสจากบิลในใบจ่ายไปแล้ว → ไม่ต้องเอาบรรทัดธนาคารมาซ้ำ
        // (เลขตรงเป๊ะ = ตัดได้เลย · เลขผ่อนรูป = ต้องยอดตรงด้วย ไม่งั้นเสี่ยงตัดผิดใบ)
        const lk = norm(L.docNo), lp = cfcRefParts(L.docNo), lamt = Math.abs(L.out || L.in);
        if (covered.has(lk)) return;
        if (lp && covered.has('~' + lp.loose) && Math.abs(covered.get('~' + lp.loose) - lamt) < 0.02) return;
        const m = cfcMatchPv(L, pvIdx);
        const pv = m && m.pv;
        const bills = pv && Array.isArray(pv.settles) ? pv.settles : [];
        const pvPayee = pv ? cfcT(pv.Payee) : '';
        const matchText = [L.memo, L.payee, pvPayee, bills.map(s => cfcT(s.note)).join(' ')].filter(Boolean).join(' ');
        const row = Object.assign({}, L, {
          key: b.id + '|' + L.docNo + '|' + (L.out || L.in),
          bucketId: b.id, acctLabel: b.acctLabel || L.acctLabel, pv, pvPayee, bills,
          matchHow: m ? m.how : null, matchNear: m && m.near, matchText,
          wht: pv ? cfcNum(pv.WHT) : 0,
        });
        row.sug = engine(row);
        row.src = 'bank';
        out.push(row);
      }));
      // เรียงแบบเดียวกับชีต "รวมทุกบัญชี": วันที่ → บัญชี → ลำดับเดิมในไฟล์
      return out.sort((a, b) => (a.iso !== b.iso ? (a.iso < b.iso ? -1 : 1)
        : (a.acctNo !== b.acctNo ? String(a.acctNo).localeCompare(String(b.acctNo))
        : (Number(a.idx || 0) - Number(b.idx || 0)))));
    }, [buckets, psBuckets, data.pvVouchers, ym, acct, pvIdx, engine, acctOf]);

    const stat = useMemo(() => {
      const s = { n: rows.length, locked: 0, auto: 0, ask: 0, new: 0, inSum: 0, outSum: 0, noPv: 0, suspect: 0, orphan: 0, orphanNames: [] };
      const known = new Set(master.map(m => m.name));
      rows.forEach(r => {
        // หมวดที่เคยลงไว้ แต่ตอนนี้ไม่มีในงบหน้าแรกแล้ว → ยอดจะหายจากชีตสรุป ต้องเตือน
        if (r.sug.cat && !known.has(r.sug.cat)) { s.orphan++; if (s.orphanNames.indexOf(r.sug.cat) < 0) s.orphanNames.push(r.sug.cat); }
        s[r.sug.tier]++; s.inSum += r.in; s.outSum += r.out;
        if (r.matchHow === 'suspect') s.suspect++;
        else if (!r.pv && r.out > 0) s.noPv++;
      });
      return s;
    }, [rows, master]);

    /* ยอดยกมาที่ประกาศไว้ในไฟล์ ราย (บัญชี|เดือน) */
    const declaredOpen = useMemo(() => {
      const m = {};
      buckets.forEach(b => { if (b.opening != null) m[cfcAcctKey(b.acctNo, b.acctLabel) + '|' + b.ym] = b.opening; });
      return m;
    }, [buckets]);

    /* ★ ยอดต้น/ปลาย/รับ/จ่าย ต้องมาจาก "บรรทัดธนาคาร" เท่านั้น — แถวลงรหัสตอนนี้เป็น
         บิลรายใบ (ยอดเกลี่ยแล้ว) เอามาบวกเป็นยอดบัญชีไม่ได้ */
    const bankScoped = useMemo(() => {
      const out = [];
      buckets.filter(b => (!ym || b.ym === ym) && (!acct || b.acctNo === acct))
        .forEach(b => (b.lines || []).forEach(L => out.push(Object.assign({}, L, { acctLabel: b.acctLabel || L.acctLabel }))));
      return out;
    }, [buckets, ym, acct]);
    const acctCheck = useMemo(() => cfcAcctSummary(bankScoped, declaredOpen), [bankScoped, declaredOpen]);

    /* จำนวนแถวที่ยังไม่ลงหมวด แยกรายบัญชี (มาจากแถวลงรหัส ไม่ใช่บรรทัดธนาคาร) */
    const uncodedByAcct = useMemo(() => {
      const m = {};
      rows.forEach(r => { if (r.sug && !r.sug.cat) { const k = cfcAcctKey(r.acctNo, r.acctLabel); m[k] = (m[k] || 0) + 1; } });
      return m;
    }, [rows]);

    /* สรุป "ทุกเดือนทุกบัญชีที่นำเข้าไว้" — ใช้หายอดปลายงวดของเดือนก่อนเท่านั้น
       (ไม่สนตัวกรองหน้าจอ ไม่ต้องมี sug → ไม่ต้องรอเครื่องเสนอหมวด) */
    const histCheck = useMemo(() => {
      const all = [];
      buckets.forEach(b => (b.lines || []).forEach(L => all.push(Object.assign({}, L, { acctLabel: b.acctLabel || L.acctLabel }))));
      return cfcAcctSummary(all, declaredOpen);
    }, [buckets, declaredOpen]);

    /* ค่าที่คนคีย์เอง: ต้นงวด (เมื่อไม่มีเดือนก่อนให้ยก) + ธง "ไม่มีการเคลื่อนไหว"
       เก็บรวมเป็น 1 แถว id 'manual' ใน cfCoding (คีย์ = "<acctKey>|<ym>") */
    const manual = useMemo(() => Object.assign({ opening: {}, closing: {}, still: {} }, store.manual || {}), [store.manual]);
    function saveManual(kind, key, value) {
      if (!canEdit) return;
      const cur = { opening: Object.assign({}, manual.opening), closing: Object.assign({}, manual.closing), still: Object.assign({}, manual.still) };
      if (value == null || value === '' || value === false) delete cur[kind][key]; else cur[kind][key] = value;
      const next = Object.assign({}, store, { manual: Object.assign(cur, { at: new Date().toISOString() }) });
      persist(next).then(r => toast && toast(
        kind === 'still' ? (value ? 'ทำเครื่องหมาย "ไม่มีการเคลื่อนไหว" แล้ว' : 'ยกเลิกเครื่องหมายแล้ว')
          : (kind === 'closing' ? 'บันทึกยอดปลายงวดจริงแล้ว' : 'บันทึกยอดต้นงวดแล้ว'),
        r.shared ? undefined : 'error'));
    }

    /* ⚠️ ยอดต้นงวดของบัญชี ณ เดือนหนึ่ง — ต้องมาจาก "บรรทัดธนาคาร" เท่านั้น
       (ลำดับเดียวกับการ์ดภาพรวม: ไฟล์ประกาศ/คำนวณจากแถวแรก > ปลายงวดเดือนก่อน > ค่าที่คีย์เอง)
       ห้ามให้หน้าปลายทางไปเดาจากคอลัมน์ "ยอดคงเหลือ" ของชีตที่ส่งไป — แถวส่วนใหญ่เป็น
       บิลรายใบซึ่งไม่มียอดคงเหลือ ปลายทางจะได้ต้นงวด = ยอดจ่ายของบิลใบแรก (เพี้ยนทั้งงบ) */
    function openingAt(acctNo, acctLabel, ymOf) {
      const key = cfcAcctKey(acctNo, acctLabel);
      const g = histCheck.find(x => cfcAcctKey(x.acctNo, x.acctLabel) === key && x.ym === ymOf);
      if (g) return g.opening;
      const prev = cfcPrevMonth(histCheck, acctNo, ymOf, acctLabel);
      if (prev) return prev.closingFile;
      const mo = manual.opening[key + '|' + ymOf];
      return mo == null ? null : cfcNum(mo);
    }


    /* รวมทะเบียน × ข้อมูลที่นำเข้าจริง เป็นตารางเดียว (แถวที่ยังไม่มีข้อมูล = ขาด) */
    const overview = useMemo(() => {
      const aggRows = cfcAggByAcct(acctCheck);
      const byKey = {}; aggRows.forEach(g => { byKey[cfcAcctKey(g.acctNo, g.acctLabel)] = g; });
      const used = {};
      /* ★ ยอดต้นงวดยกมาจากเดือนก่อน (ถ้ามี):
           - บัญชีที่มีข้อมูลเดือนนี้ → เทียบ "ต้นงวดที่อ่านจากไฟล์" กับ "ปลายงวดเดือนก่อน"
             ต่างกัน = มีเดือน/รายการขาดหายระหว่างกลาง ต้องเห็น ไม่ใช่กลืน
           - บัญชีที่ไม่มีข้อมูลเดือนนี้เลย → ยกยอดเดือนก่อนมาแสดงเป็นต้นงวด=ปลายงวด
             (บัญชีที่ไม่มีรายการทั้งเดือนก็ยังมีเงินอยู่ — เดิมโชว์ว่าง เหมือนยอดหาย) */
      const attach = (b, g) => {
        const mk = (g ? cfcAcctKey(g.acctNo, g.acctLabel) : b.key) + '|' + (ym || (g ? g.ymFirst : 'all'));
        const still = !!manual.still[mk];
        const manOpen = manual.opening[mk];
        const manClose = manual.closing[mk];
        const prev = cfcPrevMonth(histCheck, g ? g.acctNo : b.no, g ? g.ymFirst : (ym || ''), g ? g.acctLabel : '');
        // มีไฟล์ → ยอดยกมาของไฟล์คือตัวจริง, เดือนก่อนเป็น "ตัวตรวจ"
        // ★ ยอดจริงที่คีย์เอง − ปลายงวดที่ไฟล์บอก = ส่วนที่ไฟล์ยังขาด (บวก = ไฟล์ขาดรายการรับ / ลบ = ขาดรายการจ่าย)
        // ★ openDiff = ยอดต้นงวดที่ใช้จริง − ยอดที่คนคีย์ไว้
        //   คิดเฉพาะตอนที่ค่าที่ใช้ "ไม่ได้มาจากค่าที่คีย์เอง" (ไม่งั้นเทียบกับตัวเอง = 0 เสมอ)
        if (g) return Object.assign({}, b, { mk, still, data: g, prev, manOpen, manClose,
          openDiff: manOpen == null ? null : (g.opening - cfcNum(manOpen)),
          fileMiss: manClose == null ? null : (cfcNum(manClose) - g.closingFile),
          carryDiff: prev ? (g.opening - prev.closingFile) : null });
        // ไม่มีไฟล์ → ยกจากเดือนก่อน ถ้าไม่มีก็ใช้ค่าที่คีย์เอง
        const base = prev ? prev.closingFile : (manOpen == null ? null : cfcNum(manOpen));
        if (base != null) return Object.assign({}, b, { mk, still, prev, carried: true,
          openSrc: prev ? 'prev' : 'manual', manOpen, manClose,
          openDiff: (prev && manOpen != null) ? (base - cfcNum(manOpen)) : null,
          fileMiss: manClose == null ? null : (cfcNum(manClose) - base),
          data: { acctNo: g ? g.acctNo : b.no, acctLabel: b.no, ym: ym || (prev ? prev.ym : ''),
            ymFirst: prev ? prev.ym : (ym || ''), ymLast: prev ? prev.ym : (ym || ''),
            opening: base, closingFile: base, closingCalc: base, diff: 0, inSum: 0, outSum: 0, n: 0, uncoded: 0 } });
        return Object.assign({}, b, { mk, still, data: null, prev: null, manOpen, manClose });
      };
      const listed = bankMaster.map(b => { const g = byKey[b.key]; if (g) used[b.key] = 1; return attach(b, g); });
      // บัญชีที่นำเข้ามาแต่ไม่มีในทะเบียน (เช่นเปิดบัญชีใหม่ / ไฟล์ผิดบริษัท)
      const extra = aggRows.filter(g => !used[cfcAcctKey(g.acctNo, g.acctLabel)])
        .map(g => attach({ bank: '', no: g.acctLabel || g.acctNo, type: 'ไม่อยู่ในทะเบียน', key: cfcAcctKey(g.acctNo, g.acctLabel) }, g));
      const all = listed.concat(extra);
      const tot = { inSum: 0, outSum: 0, opening: 0, closing: 0, n: 0, uncoded: 0, bad: 0 };
      all.forEach(r => {
        if (!r.data) return;
        r.data.uncoded = uncodedByAcct[cfcAcctKey(r.data.acctNo, r.data.acctLabel)] || 0;
        tot.inSum += r.data.inSum; tot.outSum += r.data.outSum;
        tot.opening += r.data.opening; tot.closing += r.data.closingFile;
        tot.n += r.data.n; tot.uncoded += r.data.uncoded;
        if (Math.abs(r.data.diff) > 0.02) tot.bad++;
      });
      const loaded = all.filter(r => r.data && !r.carried).length;
      const carried = all.filter(r => r.carried).length;
      const missingActive = listed.filter(r => !r.data && !r.still && r.type === 'สามารถใช้ได้').length;
      const gapBreak = all.filter(r => !r.still && r.carryDiff != null && Math.abs(r.carryDiff) > 0.02).length;
      const fileShort = all.filter(r => r.fileMiss != null && Math.abs(r.fileMiss) > 0.02).length;
      const openMismatch = all.filter(r => r.openDiff != null && Math.abs(r.openDiff) > 0.02).length;
      const fileOk = all.filter(r => r.fileMiss != null && Math.abs(r.fileMiss) <= 0.02).length;
      return { all, tot, loaded, carried, gapBreak, fileShort, fileOk, openMismatch, total: bankMaster.length, missingActive };
    }, [acctCheck, histCheck, bankMaster, ym, manual, uncodedByAcct]);

    const shown = useMemo(() => {
      const needle = cfcNorm(q);
      return rows.filter(r => {
        if (tab !== 'all' && r.sug.tier !== tab) return false;
        if (tab === 'all' && q === '' ) return true;
        if (!needle) return true;
        return cfcNorm([r.docNo, r.note, r.pvPayee, r.sug.cat, r.pv && r.pv.PL_PV_No].join(' ')).includes(needle);
      });
    }, [rows, tab, q]);

    /* ── เขียนกฎ (= การยืนยันของคน) ── */
    function learn(nextRulesMap, msg) {
      const next = Object.assign({}, store, { rules: { map: nextRulesMap, at: new Date().toISOString() } });
      persist(next).then(r => toast && toast(msg + (r.shared ? ' · แชร์ทั้งทีมแล้ว' : ' · บันทึกในเครื่อง'), r.shared ? undefined : 'error'));
    }
    function confirmRow(row, cat) {
      if (!canEdit) return;
      const map = Object.assign({}, rules);
      const who = (typeof WTPAuth !== 'undefined' && WTPAuth.currentUser && WTPAuth.currentUser()) || null;
      const meta = { cat, by: who ? (who.displayName || who.username) : '', at: new Date().toISOString() };
      if (!cat) { delete map['doc:' + row.docNo]; learn(map, 'ล้างหมวดของ ' + row.docNo + ' แล้ว'); return; }
      map['doc:' + row.docNo] = Object.assign({ n: 1 }, meta);
      const tk = 'text:' + cfcNorm(row.matchText);
      if (cfcNorm(row.matchText)) map[tk] = { cat, n: ((map[tk] && map[tk].cat === cat ? Number(map[tk].n) || 1 : 0) + 1), by: meta.by, at: meta.at };
      const mk = cfcNorm(row.memo || '');
      if (mk.length > 3) map['memo:' + mk] = { cat, n: ((map['memo:' + mk] && map['memo:' + mk].cat === cat ? Number(map['memo:' + mk].n) || 1 : 0) + 1), by: meta.by, at: meta.at };
      const vk = cfcVendorKey(row.payee || row.pvPayee || '');
      if (vk.length > 3) map['vendor:' + vk] = { cat, n: ((map['vendor:' + vk] && map['vendor:' + vk].cat === cat ? Number(map['vendor:' + vk].n) || 1 : 0) + 1), by: meta.by, at: meta.at };
      learn(map, 'บันทึก "' + cat + '" + จำไว้ใช้ครั้งหน้าแล้ว');
    }
    function acceptAllAuto() {
      if (!canEdit) return;
      const cand = rows.filter(r => r.sug.tier === 'auto' && r.sug.cat);
      if (!cand.length) { toast && toast('ไม่มีรายการที่ระบบมั่นใจรออยู่'); return; }
      if (!confirm('ยืนยันหมวดที่ระบบเสนอ ' + cand.length + ' รายการ (เฉพาะที่ขึ้นว่า "มั่นใจ")?\nยืนยันแล้วระบบจะจำไว้ใช้กับเดือนถัดไป')) return;
      const map = Object.assign({}, rules);
      const who = (typeof WTPAuth !== 'undefined' && WTPAuth.currentUser && WTPAuth.currentUser()) || null;
      const by = who ? (who.displayName || who.username) : '', at = new Date().toISOString();
      cand.forEach(r => {
        map['doc:' + r.docNo] = { cat: r.sug.cat, n: 1, by, at };
        const tk = 'text:' + cfcNorm(r.matchText);
        if (cfcNorm(r.matchText)) map[tk] = { cat: r.sug.cat, n: ((map[tk] && map[tk].cat === r.sug.cat ? Number(map[tk].n) || 1 : 0) + 1), by, at };
        const mk2 = cfcNorm(r.memo || '');
        if (mk2.length > 3) map['memo:' + mk2] = { cat: r.sug.cat, n: ((map['memo:' + mk2] && map['memo:' + mk2].cat === r.sug.cat ? Number(map['memo:' + mk2].n) || 1 : 0) + 1), by, at };
      });
      learn(map, 'ยืนยัน ' + cand.length + ' รายการแล้ว');
    }

    /* เพิ่มหมวดใหม่ — แทรกต่อท้ายกลุ่มที่เลือก (ลำดับใน master = ลำดับแถวของชีตสรุป) */
    /* บันทึกผังหมวด (+ กฎที่ต้องย้ายตาม) แล้วบอกผล — ทางออกทางเดียวของทั้ง เพิ่ม/แก้/ลบ */
    function persistMaster(items, msg, extra) {
      const at = new Date().toISOString();
      const next = Object.assign({}, store, { master: { items, at } }, extra || {});
      return persist(next).then(r => {
        toast && toast(msg + (r.shared ? ' · แชร์ทั้งทีม' : ' · บันทึกในเครื่อง'), r.shared ? undefined : 'error');
        return r;
      });
    }
    /* กฎที่เรียนไว้เก็บ "ชื่อหมวด" ตรง ๆ ⇒ เปลี่ยนชื่อ/ลบหมวด ต้องกวาดกฎตามทุกครั้ง
       ไม่งั้นรายการที่เคยลงหมวดนี้กลายเป็นหมวดผี — ยอดไม่เข้าบรรทัดไหนในงบ
       และไม่ถูกนับว่า "ยังไม่ลงหมวด" ด้วย (เงียบสนิท) */
    function remapRuleCat(from, to) {
      const map = {}; let n = 0;
      Object.keys(rules).forEach(k => {
        const v = rules[k];
        if (v && v.cat === from) { n++; if (to) map[k] = Object.assign({}, v, { cat: to }); return; }
        map[k] = v;
      });
      return { map, n };
    }

    /* หมวดที่เพิ่มในแอปติดธง src:'app' → cfcMergeAppCats ใช้กันไม่ให้หายตอน "สอนระบบ" ใหม่ */
    function saveNewCat({ name, act, group, flow }) {
      const items = cfcInsertCat(master.slice(), { name, act, group, flow, src: 'app' });
      persistMaster(items, 'เพิ่มหมวด "' + name + '" แล้ว');
    }

    function saveCatEdit(oldName, row) {
      const cur = master.find(m => m.name === oldName);
      if (!cur) return;
      const next = Object.assign({}, cur, row);
      const samePlace = cur.act === row.act && cur.group === row.group && cfcFlowOf(cur) === cfcFlowOf(next);
      /* ย้ายกิจกรรม/กลุ่ม/ฝั่งเงิน = ต้องเรียงตำแหน่งใหม่ · แก้แค่ชื่อ = แทนที่กับที่ (แถวในงบไม่ขยับ) */
      const items = samePlace
        ? master.map(m => (m.name === oldName ? next : m))
        : cfcInsertCat(master.filter(m => m.name !== oldName), next);
      const extra = {}; let moved = 0;
      if (row.name !== oldName) {
        const r = remapRuleCat(oldName, row.name);
        moved = r.n;
        if (moved) extra.rules = { map: r.map, at: new Date().toISOString() };
      }
      persistMaster(items, 'แก้หมวดเป็น "' + row.name + '" แล้ว' + (moved ? ' · ย้ายกฎที่เรียนไว้ ' + moved + ' ข้อ' : ''), extra);
    }

    function saveCatDelete(name, moveTo) {
      const items = master.filter(m => m.name !== name);
      const r = remapRuleCat(name, moveTo || '');
      const extra = r.n ? { rules: { map: r.map, at: new Date().toISOString() } } : null;
      const tail = !r.n ? ''
        : (moveTo ? ' · ย้ายกฎ ' + r.n + ' ข้อไป "' + moveTo + '"'
                  : ' · ล้างกฎ ' + r.n + ' ข้อ (รายการกลับเป็นยังไม่ลงหมวด)');
      persistMaster(items, 'ลบหมวด "' + name + '" แล้ว' + tail, extra);
    }

    /* ── นำเข้าไฟล์งบกระทบยอด ── */
    async function onBankFiles(files) {
      if (!files || !files.length) return;
      setBusy('กำลังอ่านไฟล์…');
      const next = Object.assign({}, store); const notes = [];
      try {
        for (const f of Array.from(files)) {
          const wb = await cfcReadWorkbook(f);
          /* ★ ปุ่มเดียวรับได้ 2 ชนิด — ผู้ใช้ไม่ควรต้องจำว่าไฟล์ไหนเข้าปุ่มไหน
               (ก) รายงานการจ่ายชำระหนี้ = ค่าใช้จ่ายรายบิล (แหล่งหลัก)
               (ข) งบกระทบยอด/รายการเคลื่อนไหวบัญชี = ยอดคงเหลือ + รายการที่ไม่มีในใบจ่าย */
          let ps = null;
          wb.SheetNames.forEach(sn => {
            const r = cfcParseSettleReport(cfcAoa(wb.Sheets[sn]));
            if (!r.error && (!ps || r.vouchers.length > ps.vouchers.length)) ps = r;
          });
          if (ps && ps.vouchers.length) {
            /* ★ ไม่เก็บซ้ำ — ใบที่มีใน pvVouchers อยู่แล้ว (นำเข้าที่หน้าใบสำคัญจ่าย) ข้ามไป
               เก็บเฉพาะใบที่ยังไม่มี เพื่อไม่ให้ข้อมูลชุดเดียวกันกินที่ 2 ก้อน */
            const have = new Set((data.pvVouchers || []).map(x => cfcT(x.PL_PV_No).toUpperCase()));
            const fresh = ps.vouchers.filter(v => !have.has(cfcT(v.doc).toUpperCase()));
            const dup = ps.vouchers.length - fresh.length;
            if (!fresh.length) {
              notes.push('ℹ️ ' + f.name + ' — ใบจ่ายทั้ง ' + ps.vouchers.length
                + ' ใบมีในระบบแล้ว (หน้าใบสำคัญจ่าย) ไม่เก็บซ้ำ · หน้านี้ดึงไปใช้ให้เองอยู่แล้ว');
              continue;
            }
            const byYm = {};
            fresh.forEach(v => { const k = String(v.iso).slice(0, 7); if (k) (byYm[k] = byYm[k] || []).push(v); });
            Object.keys(byYm).forEach(k => {
              next['ps:' + k] = { ym: k, vouchers: byYm[k], uploadedAt: new Date().toISOString(), file: f.name };
            });
            const nb = fresh.reduce((a, v) => a + (v.bills.length || 1), 0);
            notes.push('✅ ' + f.name + ' — รายงานการจ่ายชำระหนี้: เพิ่ม ' + fresh.length + ' ใบจ่าย → '
              + nb + ' บิล · ' + Object.keys(byYm).join(', ')
              + (dup ? ' · ข้าม ' + dup + ' ใบที่มีในระบบแล้ว' : '')
              + '\\n   ⓘ แนะนำให้ลงไฟล์นี้ที่หน้า "ใบสำคัญจ่าย" ด้วย จะได้ใช้ร่วมกันทั้งทีมและไม่เก็บซ้ำ');
            continue;
          }
          let best = null;
          wb.SheetNames.forEach(sn => {
            const p = cfcParseBankSheet(cfcAoa(wb.Sheets[sn]), f.name);
            if (!p.error && (!best || p.lines.length > best.lines.length)) best = p;
          });
          if (!best || !best.lines.length) {
            notes.push('❌ ' + f.name + ' — อ่านไม่ออก: ไม่ใช่ทั้ง "รายงานการจ่ายชำระหนี้" (ต้องมีหัวคอลัมน์ '
              + '"ยอดตามใบรับ") และ "รายการเคลื่อนไหวบัญชีธนาคาร" (ต้องมี MNE / ยอดถอน / ยอดฝาก)');
            continue;
          }
          const byYm = {};
          best.lines.forEach(L => { const k = String(L.iso).slice(0, 7); (byYm[k] = byYm[k] || []).push(L); });
          const firstYm = Object.keys(byYm).sort()[0];
          Object.keys(byYm).forEach(k => {
            const id = 'lines:' + best.acctNo + ':' + k;
            next[id] = { acctNo: best.acctNo, acctLabel: best.acctLabel, ym: k, lines: byYm[k],
              opening: (k === firstYm && best.opening != null) ? best.opening : null,   // ★ ยอดยกมาที่ไฟล์ประกาศ
              uploadedAt: new Date().toISOString(), file: f.name };
          });
          notes.push('✅ ' + f.name + ' — งบกระทบยอด: ' + best.lines.length + ' รายการ · บัญชี ' + (best.acctNo || '?') + ' · ' + Object.keys(byYm).join(', '));
        }
        const r = await persist(next);
        setBusy('');
        toast && toast(notes.join('\n') + (r.shared ? '\nแชร์ทั้งทีมแล้ว' : '\nบันทึกในเครื่อง'), notes.some(n => n[0] === '❌') ? 'error' : undefined);
      } catch (e) { setBusy(''); toast && toast('อ่านไฟล์ไม่สำเร็จ: ' + (e && e.message || ''), 'error'); }
    }

    /* ── นำเข้าไฟล์ CASH FLOW เพื่อ (ก) อัปหมวดมาตรฐาน (ข) สอนระบบ ── */
    async function onCashflowFile(file) {
      if (!file) return;
      setBusy('กำลังเรียนรู้จากไฟล์…');
      try {
        const wb = await cfcReadWorkbook(file);
        const p = cfcParseCashflowWorkbook(wb);
        if (p.error) { setBusy(''); toast && toast(p.error, 'error'); return; }
        /* ★ ผังจากไฟล์ทับของเดิม — แต่หมวดที่เพิ่มเองในแอปไม่มีทางอยู่ในไฟล์ ต้องผสานกลับ */
        const nextMaster = cfcWithExtraCats(cfcMergeAppCats(p.master.length ? p.master : master, master));
        /* หมวดเดิม (จากไฟล์เก่า) ที่ไฟล์ใหม่ไม่มี "และมีรายการลงไว้แล้ว" = ยอดจะหลุดจากงบ → ถามก่อน */
        if (p.master.length) {
          const keep = {}; nextMaster.forEach(m => { keep[cfcNorm(m.name)] = 1; });
          const used = cfcRuleCatCount(rules);
          const lost = master.filter(m => !keep[cfcNorm(m.name)] && used[m.name]);
          if (lost.length) {
            setBusy('');
            const list = lost.slice(0, 8).map(m => '• ' + m.name + ' (' + used[m.name] + ' กฎ)').join('\n');
            const more = lost.length > 8 ? '\n…และอีก ' + (lost.length - 8) + ' หมวด' : '';
            if (!confirm('ไฟล์นี้ไม่มี ' + lost.length + ' หมวดที่ใช้งานอยู่:\n' + list + more
              + '\n\nสอนระบบต่อ = หมวดพวกนี้จะหายจากผังงบ และยอดของรายการที่ลงหมวดไว้จะไม่เข้าบรรทัดไหนในงบ\nไปต่อไหม?')) return;
            setBusy('กำลังเรียนรู้จากไฟล์…');
          }
        }
        const canon = cfcCanonBuilder(nextMaster);
        const map = Object.assign({}, rules);
        const at = new Date().toISOString();
        let learned = 0; const missed = {};
        p.history.forEach(h => {
          const cat = canon(h.cat);
          if (!cat) { missed[h.cat] = (missed[h.cat] || 0) + 1; return; }
          learned++;
          const text = [h.memo, h.payee].filter(Boolean).join(' ');
          const tk = 'text:' + cfcNorm(text);
          if (cfcNorm(text)) map[tk] = { cat, n: ((map[tk] && map[tk].cat === cat ? Number(map[tk].n) || 1 : 0) + 1), by: 'ไฟล์เดิม', at };
          const mk = cfcNorm(h.memo || '');
          if (mk.length > 3) map['memo:' + mk] = { cat, n: ((map['memo:' + mk] && map['memo:' + mk].cat === cat ? Number(map['memo:' + mk].n) || 1 : 0) + 1), by: 'ไฟล์เดิม', at };
          const vk = cfcVendorKey(h.payee || '');
          if (vk.length > 3) map['vendor:' + vk] = { cat, n: ((map['vendor:' + vk] && map['vendor:' + vk].cat === cat ? Number(map['vendor:' + vk].n) || 1 : 0) + 1), by: 'ไฟล์เดิม', at };
          if (h.docNo) map['doc:' + h.docNo] = { cat, n: 1, by: 'ไฟล์เดิม', at };
        });
        const next = Object.assign({}, store, {
          master: { items: nextMaster, at },
          rules: { map, at },
        });
        if (p.banks.length) next.banks = { items: p.banks, at };
        await persist(next);
        setBusy('');
        setTeachRes({ master: nextMaster.length, history: p.history.length, learned, sheets: p.sheetUsed, banks: p.banks.length, missed: Object.entries(missed).sort((a, b) => b[1] - a[1]) });
      } catch (e) { setBusy(''); toast && toast('อ่านไฟล์ไม่สำเร็จ: ' + (e && e.message || ''), 'error'); }
    }

    /* ── ส่งออกชีต "รวมทุกบัญชี" ── */
    /* ส่งออก 3 ชีตในไฟล์เดียว — ออกแบบให้ "เอาไปวางในไฟล์ CASH FLOW ได้เลย"
         1) รวมทุกบัญชี   = 13 คอลัมน์เดิม (วางทับชีตเดิมได้ตรง ๆ)
         2) สรุปตามหมวด  = หมวด × เดือน เรียงตามงบหน้าแรกทุกบรรทัด → ก็อปคอลัมน์เดือนไปวางในงบ
         3) ตรวจยอดรายบัญชี = ยกมา + รับ − จ่าย = ปลายงวด ต่อบัญชีต่อเดือน (พิสูจน์ว่านำเข้าครบ) */
    /* ★ สร้าง AOA ทั้ง 2 ชีตไว้ที่เดียว — ทั้งปุ่มส่งออกไฟล์และปุ่มส่งขึ้นหน้า Cash Flow
         ใช้ชุดนี้ร่วมกัน จะได้ไม่มีสูตรสองชุดที่เพี้ยนจากกันทีหลัง */
    function buildSheets() {
      const months = [...new Set(rows.map(r => String(r.iso).slice(0, 7)))].sort();
      // ★ กันข้อมูลเก่าที่ ym เป็นปี พ.ศ. ('2569-05') → ป้ายจะกลายเป็น "พ.ค. 612"
      const monLabel = (m) => {
        const p2 = String(m).split('-'); const y = Number(p2[0]);
        return (CFC_MONTH_TH[+p2[1]] || p2[1]) + ' ' + ((y > 2400 ? y : y + 543) - 2500);
      };
      const head = ['ลำดับ', 'บัญชีธนาคาร', 'เลขที่บัญชี', 'วันที่', 'MNE', 'เลขที่เอกสาร', 'ยอดถอน', 'ยอดฝาก',
        'ยอดคงเหลือ', 'สถานะเช็ค', 'หมายเหตุ', 'หมวดเงินรับ-เงินจ่าย', 'ประเภทกิจกรรมทางการเงิน'];
      const stmAoa = [head];
      /* acctSeen: ป้ายบัญชีที่ใช้จริงในชีต → เลขบัญชี — ใช้หายอดต้นงวดตอนดันขึ้นหน้า Cash Flow */
      const acctSeen = {};
      rows.forEach((r, i) => {
        const label = acctLabelOf(r.acctNo, r.acctLabel);
        if (!acctSeen[label]) acctSeen[label] = { no: r.acctNo || '', label };
        else if (!acctSeen[label].no && r.acctNo) acctSeen[label].no = r.acctNo;
        stmAoa.push([
          i + 1, label, r.acctNo || '', cfcThaiDate(r.iso), r.mne || '', r.docNo || '',
          r.out || '', r.in || '', r.balance || '', r.chqStatus || '', r.note || '',
          r.sug.cat || '', CFC_ACT_TH[r.sug.act] === undefined ? '' : CFC_ACT_TH[r.sug.act],
        ]);
      });
      const cell = {}; let uncodedTot = 0;
      rows.forEach(r => {
        const m = String(r.iso).slice(0, 7), v = r.in - r.out;
        const k = (r.sug.cat || '(ยังไม่ลงหมวด)') + '|' + m;
        cell[k] = (cell[k] || 0) + v;
        if (!r.sug.cat) uncodedTot++;
      });
      const stmC = cfcStmClosingByYm(histCheck, months, bankMaster, data.cashflowSnapshots, manual.closing);
      const cash = { opening: cfcOpeningTotalAt(histCheck, months[0]), stmClosing: stmC.v,
        stmShort: Object.keys(stmC.short).length > 0 };
      const sumAoa = cfcSummaryAoa(master, months, cell, monLabel, [...new Set(rows.map(r => r.sug.cat).filter(Boolean))], cash);
      return { months, monLabel, stmAoa, sumAoa, uncodedTot, cell, acctSeen };
    }

    /* ส่งขึ้นหน้า "พรีเซนต์ Cash Flow" ตรง ๆ — ไม่ต้องดาวน์โหลดแล้วอัปกลับ
       ★ ส่ง AOA ผ่านตัวอ่านของหน้านั้นเอง (cfpParseStm / cfpParseSummary) ⇒ ผลลัพธ์
         เหมือนกับอัปไฟล์มือเป๊ะ ไม่ต้องมีตัวแปลงชุดที่สอง */
    async function sendToCashflow() {
      if (!rows.length) { toast && toast('ยังไม่มีรายการให้ส่ง'); return; }
      if (typeof cfpParseStm !== 'function' || typeof cfpParseSummary !== 'function' || typeof cfpAccountLabel !== 'function') {
        toast && toast('เปิดหน้า "พรีเซนต์ Cash Flow" สักครั้งก่อน แล้วลองใหม่', 'error'); return;
      }
      setPushAsk(false);
      setBusy('กำลังส่งขึ้นหน้า Cash Flow…');
      try {
        const built = buildSheets();
        const fresh = cfpParseStm(built.stmAoa);          // รายการของ "เดือนที่เลือก" (ผ่านตัวอ่านของหน้านั้น)
        const prev = (await WTPData.fetchSheetRows(CFP_TABLE).catch(() => []))[0];
        const old = (prev && (prev.data || prev)) || {};
        /* ★ แทนที่เฉพาะเดือนที่ส่ง — เดือนอื่นที่เคยดันไว้ต้องอยู่ครบ
           (ดันเดือนเดิมซ้ำ = ทับของเดิม ไม่บวกเพิ่ม จึงแก้แล้วดันใหม่ได้เรื่อย ๆ) */
        const sendMonths = new Set(built.months);
        const byDisplay = {};   // ป้ายที่ตัวอ่านทำให้ (cfpAccountLabel) → เลขบัญชี/ป้ายดิบ
        Object.keys(built.acctSeen).forEach(raw => { byDisplay[cfpAccountLabel(raw)] = built.acctSeen[raw]; });
        /* ★ ซ่อมเดือนเก่าที่เคยดันไว้ตอนที่ป้ายบัญชียังแตกเป็น 2 ชื่อ (บิล vs บรรทัดธนาคาร)
           — ยุบเข้าป้ายมาตรฐานด้วยเลข 4 ตัวท้าย ไม่งั้นเดือนเก่ายังโชว์เป็นบัญชีผีต่อไป
             จนกว่าจะไล่ดันใหม่ทุกเดือน */
        const tail4 = s => { const d = cfcDigits(String(s).split(' · ')[0]); return d.length >= 4 ? d.slice(-4) : ''; };
        const canonByTail = {}; Object.keys(byDisplay).forEach(d => { const t = tail4(d); if (t) canonByTail[t] = d; });
        /* ⚠️ ต้องยุบ พ.ศ. → ค.ศ. "ก่อน" กรองเดือน — ข้อมูลเก่าที่อัปมือไว้เก็บ iso เป็นปี พ.ศ.
           ('2569-05-05') ⇒ เทียบกับเดือนที่กำลังส่ง ('2026-05') ไม่มีวันตรง ดันซ้ำเท่าไรก็
           ไม่ทับของเดิม กลายเป็น "เดือนเดียวกันมี 2 คอลัมน์ ยอดเบิ้ล" + ป้ายเดือนเป็น "612" */
        const rawOld = (old.stm && old.stm.txns) || [];
        const healed = (typeof cfpFixEraTxns === 'function' ? cfpFixEraTxns(rawOld) : rawOld)
          .map((t, i) => {
            const c = canonByTail[tail4(t.account)];
            const row = (c && c !== t.account) ? Object.assign({}, t, { account: c }) : t;
            return { row, wasBE: String(t.iso) !== String(rawOld[i] && rawOld[i].iso) };
          });
        /* ★ ล้างของซ้ำที่บั๊กเดิมทิ้งไว้: แถวปี พ.ศ. ที่ตรงกับแถวปี ค.ศ. ทุกอย่าง (บัญชี·วัน·
           เลขเอกสาร·ยอด) = รายการเดียวกันที่เคยถูกนับ 2 ครั้งเพราะปีคนละศักราช → ทิ้งฝั่ง พ.ศ.
           ทิ้งเฉพาะแถวที่ "ถูกแปลงศักราช" เท่านั้น ของเดิมที่เป็น ค.ศ. อยู่แล้วไม่แตะ */
        const dupKey = t => [t.account, String(t.iso).slice(0, 10), t.docNo || '',
          Math.round((t.flow || 0) * 100)].join('|');
        const ceKeys = new Set(); healed.forEach(h => { if (!h.wasBE) ceKeys.add(dupKey(h.row)); });
        let dupDropped = 0;
        const kept = healed.filter(h => {
          if (h.wasBE && ceKeys.has(dupKey(h.row))) { dupDropped++; return false; }
          return !sendMonths.has(String(h.row.iso).slice(0, 7));
        }).map(h => h.row);
        const allTxns = kept.concat(fresh.txns).sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
        /* ⚠️ ยอดต้นงวดต่อบัญชี ห้ามให้ตัวอ่านคำนวณจากคอลัมน์ "ยอดคงเหลือ" ของชีตนี้
           — หน่วยที่ส่งไปเป็น "บิลรายใบ" ซึ่งไม่มียอดคงเหลือ (ช่องว่าง = 0) ตัวอ่านจะได้
           ต้นงวด = 0 − กระแสของบิลใบแรก = ยอดจ่ายใบนั้น (เพี้ยนทั้งงบ · พิสูจน์แล้ว)
           ใช้ยอดจากบรรทัดธนาคาร ณ "เดือนแรกที่บัญชีนั้นมีรายการ" แทน = ตัวเดียวกับการ์ดภาพรวม */
        const firstYm = {};
        allTxns.forEach(t => { const m = String(t.iso).slice(0, 7);
          if (!firstYm[t.account] || m < firstYm[t.account]) firstYm[t.account] = m; });
        /* ⚠️⚠️ กติกาหลักของปุ่มนี้: "ดันเดือนไหน แตะเฉพาะคอลัมน์เดือนนั้น"
           งบที่เก็บไว้อาจมาจากไฟล์ CASH FLOW ที่อัปเอง (ปรับด้วยมือมาแล้ว — รายการเดียวกัน
           อาจถูกลงคนละหมวดกับที่ระบบจัด) ⇒ ถ้าคิดงบใหม่จากรายการทั้งหมด เดือนเก่าจะเปลี่ยน
           ยกแผง ทั้งที่ผู้ใช้สั่งดันแค่เดือนเดียว (ของจริง: ยอดสุทธิ/ยอดรวมกลุ่มเท่าเดิม แต่
           รายการย่อยสลับหมวดกันเพียบ + ต้นงวดขยับ 28,092) */
        const oldSum = old.summary || null;
        const oldMonthCol = {};                       // ym → index คอลัมน์ในงบเดิม
        ((oldSum && oldSum.monthLabels) || []).forEach((lb, i) => {
          const y = cfcYmOfMonthLabel(lb); if (y) oldMonthCol[y] = i;
        });
        /* oldRowVal = เฉพาะแถว "รายการย่อย" (ใช้เติม cell — ถ้าเอาแถวรวมมาด้วย ชื่อแถวรวมจะไป
           โผล่เป็นหมวดแปลกปลอมท้ายงบ) · oldRowAll = ทุกแถว (ใช้ทับคอลัมน์ทีหลัง) */
        const oldRowVal = {}, oldRowAll = {};
        ((oldSum && oldSum.rows) || []).forEach(r => {
          const k = cfcCanonRowLabel(r.label);
          oldRowAll[k] = r.vals || [];
          if (r.type === 'leaf') oldRowVal[k] = r.vals || [];
        });
        const oldRowBy = (re) => {                    // หาแถวท้ายงบด้วยรูปประโยค (ชื่อไฟล์เดิมมี /อังกฤษ ต่อท้าย)
          const hit = ((oldSum && oldSum.rows) || []).find(r => re.test(String(r.label)));
          return hit ? (hit.vals || []) : null;
        };
        const oldOpen = (old.stm && old.stm.openingByAcct) || {};
        /* เดือนแรกสุดยังไม่ได้นำเข้างบกระทบยอด แต่เดือนถัด ๆ ไปมี → เดินถอยหลัง:
           ต้นงวด(เดือนแรก) = ต้นงวด(เดือนที่รู้) − ผลรวมกระแสของทุกแถวก่อนเดือนนั้น */
        const openingBack = (info, ym0, acctName) => {
          const key = cfcAcctKey(info.no, info.label);
          const known = histCheck.filter(x => cfcAcctKey(x.acctNo, x.acctLabel) === key && x.ym > ym0)
            .sort((x, y) => (x.ym < y.ym ? -1 : 1))[0];
          if (!known) return null;
          const before = allTxns.reduce((s, t) => (t.account === acctName && String(t.iso).slice(0, 7) < known.ym
            ? s + (t.flow || 0) : s), 0);
          return known.opening - before;
        };
        /* ค่าเดิมของบัญชี อาจถูกเก็บไว้ใต้ป้ายเก่า (ก่อนยุบชื่อบัญชี) และอาจแตกเป็นหลายก้อน
           จากบั๊กเดิม → รวมทุกก้อนที่เลข 4 ตัวท้ายตรงกัน */
        const oldOpenOf = (a) => {
          if (oldOpen[a] != null) return cfcNum(oldOpen[a]);
          const t = tail4(a); let sum = null;
          Object.keys(oldOpen).forEach(k => { if (t && tail4(k) === t) sum = (sum || 0) + cfcNum(oldOpen[k]); });
          return sum;
        };
        const openingByAcct = {}; let opening = 0; const openMissing = [];
        Object.keys(firstYm).forEach(a => {
          const info = byDisplay[a];
          // ★ เดือนแรกของบัญชีนี้ไม่ได้อยู่ในรอบที่ส่ง → ห้ามคิดใหม่ ใช้ค่าเดิมเป๊ะ ๆ
          let v = !sendMonths.has(firstYm[a]) ? oldOpenOf(a) : null;
          if (v == null && info) v = openingAt(info.no, info.label, firstYm[a]);
          if (v == null && info) v = openingBack(info, firstYm[a], a);
          if (v == null) { const o = oldOpenOf(a); v = o == null ? cfcNum(fresh.openingByAcct[a]) : o; if (info) openMissing.push(a); }
          openingByAcct[a] = v; opening += v;
        });
        const stm = { txns: allTxns, opening, openingByAcct };
        // คอลัมน์เดือน = เดือนที่มีรายการ + เดือนที่งบเดิมมีอยู่ (เดือนเก่าห้ามหายไปเฉย ๆ)
        const allMonths = [...new Set(allTxns.map(t => String(t.iso).slice(0, 7))
          .concat(Object.keys(oldMonthCol)))].sort();
        /* ตัวอ่านตั้งชื่อแถวที่ไม่มีหมวดว่า "(ไม่ระบุหมวด)" แต่บรรทัดตรวจในงบชื่อ "(ยังไม่ลงหมวด)"
           ไม่แปลงชื่อ = บรรทัดตรวจโชว์ 0 ทั้งที่มีรายการค้างอยู่จริง */
        const catOf = c => (!c || c === '(ไม่ระบุหมวด)') ? '(ยังไม่ลงหมวด)' : c;
        const cell = {}; const keptMonths = [];
        allMonths.forEach(m => {
          if (!sendMonths.has(m) && oldMonthCol[m] != null) {
            // ★ เดือนที่ไม่ได้ส่ง + งบเดิมมีคอลัมน์นี้ → ยกตัวเลขเดิมมาทั้งคอลัมน์ ห้ามคิดใหม่
            keptMonths.push(m);
            Object.keys(oldRowVal).forEach(lab => {
              const v = cfcNum(oldRowVal[lab][oldMonthCol[m]]);
              if (v) cell[lab + '|' + m] = v;
            });
            return;
          }
          allTxns.forEach(t => {
            if (String(t.iso).slice(0, 7) !== m) return;
            const k = catOf(t.category) + '|' + m;
            cell[k] = (cell[k] || 0) + (t.flow || 0);
          });
        });
        const usedCats = [...new Set(allTxns.map(t => catOf(t.category))
          .concat(Object.keys(oldRowVal)))];
        /* บรรทัดท้ายงบ — เดือนที่ไม่ได้ส่งต้องใช้ค่าเดิมเช่นกัน:
           · ต้นงวดของเดือนแรก = ค่าเดิมถ้าเดือนแรกไม่ได้อยู่ในรอบที่ส่ง
           · "จาก STM" = ยอดจริงจากบรรทัดธนาคาร (เฉพาะเดือนที่ส่ง) · เดือนเก่าใช้ค่าเดิม */
        const oldBf = oldRowBy(/เงินสด.*ต้นงวด/), oldStm = oldRowBy(/เงินสด.*ปลายงวด.*STM/);
        const m0 = allMonths[0];
        let openTotal = opening;
        if (m0 && !sendMonths.has(m0) && oldBf && oldMonthCol[m0] != null) openTotal = cfcNum(oldBf[oldMonthCol[m0]]);
        const stmCalc = cfcStmClosingByYm(histCheck, allMonths, bankMaster, data.cashflowSnapshots, manual.closing);
        const stmClosing = {}; let stmShort = false;
        allMonths.forEach(m => {
          if (!sendMonths.has(m) && oldStm && oldMonthCol[m] != null) { stmClosing[m] = cfcNum(oldStm[oldMonthCol[m]]); return; }
          stmClosing[m] = stmCalc.v[m];
          if (stmCalc.short[m]) stmShort = true;
        });
        const cash = { opening: openTotal, stmClosing, stmShort };
        const sumAoa = cfcSummaryAoa(master, allMonths, cell, built.monLabel, usedCats, cash);
        cfcApplyOldColumns(sumAoa, allMonths, new Set(keptMonths), oldRowAll, oldMonthCol);
        const summary = cfpParseSummary(sumAoa);
        const payload = Object.assign({}, old, {
          id: (typeof CFP_ROW_ID === 'string' ? CFP_ROW_ID : 'current'),
          uploadedAt: Date.now(),
          uploadedBy: (typeof cfpCurrentUser === 'function' ? cfpCurrentUser() : '') + ' (จากหน้างบกระทบยอดกระแสเงินสด)',
          stm, summary,
        });
        await WTPData.writeTable(CFP_TABLE, [payload], r => r.id);
        try { localStorage.setItem('bio-cfpresent-v1', JSON.stringify(payload)); } catch (e) {}
        setBusy('');
        const replaced = ((old.stm && old.stm.txns) || []).length - kept.length;
        toast && toast('ส่งขึ้นหน้า Cash Flow แล้ว · เดือน ' + built.months.join(', ') + ' ' +
          (replaced ? '(แทนที่ของเดิม ' + replaced + ' รายการ)' : '(เพิ่มใหม่)') +
          ' · รวมทั้งหมด ' + allTxns.length + ' รายการ / ' + allMonths.length + ' เดือน' +
          (keptMonths.length ? ' · คงตัวเลขเดิมของอีก ' + keptMonths.length + ' เดือน (' + keptMonths.map(built.monLabel).join(', ') + ')' : '') +
          (dupDropped ? ' · ล้างรายการซ้ำจากข้อมูลเก่า (ปี พ.ศ.) ' + dupDropped + ' รายการ' : '') +
          (openMissing.length ? ' · ⚠️ ยังไม่รู้ยอดต้นงวดของ ' + openMissing.length + ' บัญชี (ยังไม่ได้นำเข้างบกระทบยอดของบัญชีนั้น)' : ''),
          openMissing.length ? 'error' : undefined);
      } catch (e) { setBusy(''); toast && toast('ส่งไม่สำเร็จ: ' + (e && e.message || ''), 'error'); }
    }

    function exportSheet() {
      if (!rows.length) { toast && toast('ยังไม่มีรายการให้ส่งออก'); return; }
      const { months, monLabel, stmAoa, sumAoa, uncodedTot } = buildSheets();
      const wb = XLSX.utils.book_new();
      const stamp = new Date().toLocaleString('th-TH-u-ca-gregory');
      const scope = (acct ? 'บัญชี ' + acct : allAccts.length + ' บัญชี');

      /* ── ชีต 1: งบกระแสเงินสด (หน้าเดียวจบ เหมือนหน้าแรกของไฟล์ CASH FLOW) ── */
      sumAoa[2] = [String(sumAoa[2][0]) + ' · ' + rows.length + ' รายการ · ' + scope];
      const nCol = months.length + 2;
      const ws1 = XLSX.utils.aoa_to_sheet(sumAoa);
      ws1['!cols'] = [{ wch: 52 }].concat(months.map(() => ({ wch: 16 }))).concat([{ wch: 17 }]);
      cfcStyleSummary(ws1, sumAoa, nCol);
      XLSX.utils.book_append_sheet(wb, ws1, 'งบกระแสเงินสด');

      /* ── ชีต 2: รายละเอียดทุกรายการ ── */
      const ws2 = XLSX.utils.aoa_to_sheet(stmAoa);
      ws2['!cols'] = [{ wch: 6 }, { wch: 38 }, { wch: 15 }, { wch: 11 }, { wch: 7 }, { wch: 15 }, { wch: 13 }, { wch: 13 },
        { wch: 14 }, { wch: 10 }, { wch: 46 }, { wch: 34 }, { wch: 22 }];
      cfcStyleDetail(ws2, stmAoa);
      XLSX.utils.book_append_sheet(wb, ws2, 'รายละเอียดทุกรายการ');

      /* ── ชีต 3: ตรวจยอดรายบัญชี ──
         ⚠️ ต้องคิดจาก "บรรทัดธนาคาร" (acctCheck = cfcAcctSummary(bankScoped)) เท่านั้น
            — `rows` เป็นบิลรายใบที่เกลี่ยยอดแล้วและไม่มีคอลัมน์ยอดคงเหลือ เอามาหา
            ยกมา/ปลายงวดไม่ได้ (กติกาเดียวกับการ์ดภาพรวมบนหน้าจอ) */
      const sum = acctCheck.map(g => Object.assign({}, g,
        { uncoded: uncodedByAcct[cfcAcctKey(g.acctNo, g.acctLabel)] || 0 }));
      const s3 = [['ตรวจยอดรายบัญชีรายเดือน — ยอดยกมา + รับ − จ่าย ต้องเท่ากับยอดคงเหลือปลายงวด'],
        ['และ "ยอดยกมา" ต้องเท่ากับ "ปลายงวดเดือนก่อน" ด้วย — ถ้าต่าง แปลว่ามีเดือน/รายการขาดหายระหว่างกลาง · ' + scope + ' · สร้าง ' + stamp], [],
        ['บัญชีธนาคาร', 'เลขที่บัญชี', 'เดือน', 'ยอดยกมา', 'ต้นงวดที่คีย์', 'ต่างจากที่คีย์', 'ปลายงวดเดือนก่อน', 'ต่างจากเดือนก่อน', 'รับ', 'จ่าย', 'ปลายงวด (คำนวณ)', 'ปลายงวด (จากไฟล์)', 'ต่าง', 'ปลายงวดจริง (คีย์)', 'ไฟล์ขาด', 'จำนวนรายการ', 'ยังไม่ลงหมวด']];
      sum.forEach(g => {
        const pv = cfcPrevMonth(histCheck, g.acctNo, g.ym, g.acctLabel);
        const gk = cfcAcctKey(g.acctNo, g.acctLabel) + '|' + g.ym;
        const mc = manual.closing[gk], mo = manual.opening[gk];
        s3.push([g.acctLabel || '', g.acctNo || '', monLabel(g.ym), g.opening,
          mo == null ? '' : cfcNum(mo), mo == null ? '' : (g.opening - cfcNum(mo)),
          pv ? pv.closingFile : '', pv ? (g.opening - pv.closingFile) : '',
          g.inSum, g.outSum, g.closingCalc, g.closingFile, g.diff,
          mc == null ? '' : cfcNum(mc), mc == null ? '' : (cfcNum(mc) - g.closingFile),
          g.n, g.uncoded]);
      });
      s3.push([]);
      s3.push(['รวมทุกบัญชี', '', '', sum.reduce((a, g) => a + g.opening, 0), '', '', '', '',
        sum.reduce((a, g) => a + g.inSum, 0), sum.reduce((a, g) => a + g.outSum, 0),
        sum.reduce((a, g) => a + g.closingCalc, 0), sum.reduce((a, g) => a + g.closingFile, 0),
        sum.reduce((a, g) => a + g.diff, 0), '', '', sum.reduce((a, g) => a + g.n, 0), uncodedTot]);
      const ws3 = XLSX.utils.aoa_to_sheet(s3);
      ws3['!cols'] = [{ wch: 40 }, { wch: 14 }, { wch: 11 }, { wch: 16 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 17 }, { wch: 15 }, { wch: 15 }, { wch: 17 }, { wch: 17 }, { wch: 11 }, { wch: 18 }, { wch: 13 }, { wch: 12 }, { wch: 12 }];
      cfcStyleCheck(ws3, s3, [5, 7, 12, 14]);   // คอลัมน์ "ต่าง…" ทั้ง 4 ช่อง
      XLSX.utils.book_append_sheet(wb, ws3, 'ตรวจยอดรายบัญชี');

      XLSX.writeFile(wb, 'BIO-งบกระแสเงินสด-' + (ym || 'ทุกเดือน') + (acct ? '-' + acct : '-ทุกบัญชี') + '.xlsx');
      const bad = sum.filter(g => Math.abs(g.diff) > 0.02).length;
      toast && toast('ส่งออก ' + rows.length + ' รายการ · ' + sum.length + ' บัญชี-เดือน · 3 ชีต'
        + (uncodedTot ? ' · ⚠️ ยังไม่ลงหมวด ' + uncodedTot + ' รายการ' : '')
        + (bad ? ' · ⚠️ ยอดไม่ลงตัว ' + bad + ' บัญชี' : ''),
        (uncodedTot || bad) ? 'error' : undefined);
    }

    /* ══════ render ══════ */
    const card = { background: C.card, border: '1px solid ' + C.line, borderRadius: 14, boxShadow: C.shadow };
    const btn = (primary) => ({
      cursor: 'pointer', borderRadius: 10, padding: '7px 14px', fontSize: 13, fontWeight: 600,
      border: '1px solid ' + (primary ? C.primary : C.line), background: primary ? C.primary : '#fff', color: primary ? '#fff' : C.primaryD,
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* header */}
        <div style={Object.assign({}, card, { padding: '14px 18px' })}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.ink }}>🧾 งบกระทบยอดกระแสเงินสด</div>
              <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>
ลงรหัส<strong>รายบิลตั้งหนี้</strong>จากรายงานการจ่ายชำระหนี้ + เก็บรายการที่ไม่มีในใบจ่ายจากงบกระทบยอด → เสนอหมวด + จำที่ยืนยันไว้ใช้เดือนถัดไป
                {synced ? ' · ข้อมูลส่วนกลาง (ทุกคนเห็น)' : ' · ข้อมูลในเครื่อง'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canEdit && <button style={btn()} onClick={() => fileCf.current && fileCf.current.click()}>📚 สอนระบบจากไฟล์ CASH FLOW</button>}
              {canEdit && <button style={btn()} onClick={() => fileBank.current && fileBank.current.click()}>📥 นำเข้าไฟล์ EXPRESS</button>}
              {canEdit && <button style={btn()} title="เพิ่ม / แก้ชื่อ / ลบ หมวดในผังงบกระแสเงินสด" onClick={() => setAddCat(true)}>🗂 จัดการหมวด</button>}
              {canEdit && <button style={btn(true)} title="ส่งขึ้นหน้าพรีเซนต์ Cash Flow ทันที ไม่ต้องดาวน์โหลดแล้วอัปกลับ"
                onClick={() => setPushAsk(true)}>📤 ส่งขึ้นหน้า Cash Flow</button>}
              <button style={btn()} onClick={exportSheet}>⬇️ ส่งออกไฟล์ Excel</button>
            </div>
          </div>
          <input ref={fileBank} type="file" accept=".xml,.xls,.xlsx" multiple style={{ display: 'none' }} title="รายงานการจ่ายชำระหนี้ และ/หรือ งบกระทบยอด"
            onChange={e => { onBankFiles(e.target.files); e.target.value = ''; }} />
          <input ref={fileCf} type="file" accept=".xls,.xlsx" style={{ display: 'none' }}
            onChange={e => { onCashflowFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 12 }}>
            <label style={{ fontSize: 12, color: C.mut }}>เดือน</label>
            <select value={ym} onChange={e => setYm(e.target.value)} style={{ fontSize: 13, padding: '5px 8px', borderRadius: 8, border: '1px solid ' + C.line }}>
              <option value="">ทุกเดือน</option>
              {allYms.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <label style={{ fontSize: 12, color: C.mut }}>บัญชี</label>
            <select value={acct} onChange={e => setAcct(e.target.value)} style={{ fontSize: 13, padding: '5px 8px', borderRadius: 8, border: '1px solid ' + C.line, maxWidth: 320 }}>
              <option value="">ทุกบัญชี</option>
              {allAccts.map(([no, label]) => <option key={no} value={no}>{label || no}</option>)}
            </select>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา เลขเอกสาร / คู่ค้า / หมวด…"
              style={{ fontSize: 13, padding: '5px 10px', borderRadius: 8, border: '1px solid ' + C.line, minWidth: 220, flex: '1 1 220px' }} />
            {busy && <span style={{ fontSize: 12, color: C.info }}>{busy}</span>}
          </div>
        </div>

        {/* KPI + ตัวกรองสถานะ */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[['all', 'ทั้งหมด', stat.n, C.mut], ['locked', CFC_TIER.locked.label, stat.locked, C.pos],
            ['auto', CFC_TIER.auto.label, stat.auto, C.info], ['ask', CFC_TIER.ask.label, stat.ask, C.warn],
            ['new', CFC_TIER.new.label, stat.new, C.neg]].map(([k, label, n, col]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              cursor: 'pointer', border: '1px solid ' + (tab === k ? col : C.line), background: tab === k ? col : '#fff',
              color: tab === k ? '#fff' : C.ink, borderRadius: 12, padding: '8px 16px', fontSize: 13, fontWeight: 700,
            }}>{label} <span style={{ opacity: .8 }}>{n}</span></button>
          ))}
          {canEdit && stat.auto > 0 && (
            <button onClick={acceptAllAuto} style={Object.assign({}, btn(true), { marginLeft: 'auto' })}>
              ✅ ยืนยันที่ระบบมั่นใจทั้งหมด ({stat.auto})
            </button>
          )}
        </div>

        {/* ── ภาพรวมธนาคาร ────────────────────────────────────────────────────
             ⚠️ รอบก่อนยัด "ตัวเลข + ช่องกรอก + คำอธิบายยาว" ซ้อนกันในเซลล์เดียว
                → แต่ละแถวสูงไม่เท่ากัน ขอบช่องกรอกไม่ตรงแนว อ่านยาก (ผู้ใช้ตีกลับ 2 รอบ)
             โครงนี้: จับคู่ "ระบบ ↔ ที่คีย์" เป็น 2 คอลัมน์ย่อยใต้หัวเดียวกัน ทั้งต้นงวด
             และปลายงวด → ทุกเซลล์เป็นตัวเลขบรรทัดเดียว ชิดขวาตรงแนวกันหมด
             ไม่ตรงกัน = ช่องที่คีย์เป็นสีแดง + ชิปสถานะบอกจำนวน (ไม่ต้องมีข้อความยาวในเซลล์) */}
        {buckets.length > 0 && (
          <div style={Object.assign({}, card, { padding: 0, overflow: 'hidden' })}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', justifyContent: 'space-between', padding: '13px 18px 9px' }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink }}>🏦 ภาพรวมธนาคาร</div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12.5, color: C.mut }}>
                <span>รับรวม <strong style={{ color: C.pos, fontVariantNumeric: 'tabular-nums', fontSize: 13.5 }}>{cfcMoney(overview.tot.inSum)}</strong></span>
                <span>จ่ายรวม <strong style={{ color: C.neg, fontVariantNumeric: 'tabular-nums', fontSize: 13.5 }}>{cfcMoney(overview.tot.outSum)}</strong></span>
                <span>สุทธิ <strong style={{ color: (overview.tot.inSum - overview.tot.outSum) >= 0 ? C.pos : C.neg, fontVariantNumeric: 'tabular-nums', fontSize: 13.5 }}>{cfcMoney(overview.tot.inSum - overview.tot.outSum)}</strong></span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', padding: '0 18px 11px' }}>
              <CfcChip tone="mute">ทะเบียน {overview.total} บัญชี</CfcChip>
              <CfcChip tone={overview.loaded ? 'ok' : 'mute'}>นำเข้าไฟล์แล้ว {overview.loaded}</CfcChip>
              {overview.carried > 0 && <CfcChip tone="mute">ยกยอดจากเดือนก่อน {overview.carried}</CfcChip>}
              {overview.missingActive > 0 && <CfcChip tone="bad">ยังไม่นำเข้า {overview.missingActive}</CfcChip>}
              {overview.gapBreak > 0 && <CfcChip tone="bad">ยกมาไม่ตรงเดือนก่อน {overview.gapBreak}</CfcChip>}
              {overview.openMismatch > 0 && <CfcChip tone="bad">ต้นงวดไม่ตรงที่คีย์ {overview.openMismatch}</CfcChip>}
              {overview.fileShort > 0 && <CfcChip tone="bad">ไม่ตรงยอดธนาคาร {overview.fileShort}</CfcChip>}
              {overview.fileShort === 0 && overview.fileOk > 0 && <CfcChip tone="ok">ตรงยอดธนาคาร {overview.fileOk}</CfcChip>}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl tbl-compact" style={{ width: '100%', minWidth: 1090, fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  {/* หัว 2 ชั้น — ชั้นบนจับกลุ่ม "ต้นงวด" / "ปลายงวด" ให้เห็นว่าคู่กัน */}
                  <tr>
                    <th rowSpan={2} style={{ minWidth: 208, verticalAlign: 'bottom' }}>บัญชี</th>
                    <th colSpan={2} style={{ textAlign: 'center', borderLeft: '1px solid ' + C.line }}>ต้นงวด</th>
                    <th rowSpan={2} style={{ minWidth: 112, textAlign: 'right', verticalAlign: 'bottom', borderLeft: '1px solid ' + C.line }}>รับ</th>
                    <th rowSpan={2} style={{ minWidth: 112, textAlign: 'right', verticalAlign: 'bottom' }}>จ่าย</th>
                    <th colSpan={2} style={{ textAlign: 'center', borderLeft: '1px solid ' + C.line }}>ปลายงวด</th>
                    <th rowSpan={2} style={{ minWidth: 158, verticalAlign: 'bottom', borderLeft: '1px solid ' + C.line }}>สถานะ</th>
                  </tr>
                  <tr>
                    <th style={{ minWidth: 122, textAlign: 'right', fontWeight: 500, fontSize: 11, color: C.mut, borderLeft: '1px solid ' + C.line }}>ในระบบ</th>
                    <th style={{ minWidth: 126, textAlign: 'right', fontWeight: 500, fontSize: 11, color: C.mut }}>คีย์เอง</th>
                    <th style={{ minWidth: 122, textAlign: 'right', fontWeight: 500, fontSize: 11, color: C.mut, borderLeft: '1px solid ' + C.line }}>ในไฟล์</th>
                    <th style={{ minWidth: 126, textAlign: 'right', fontWeight: 500, fontSize: 11, color: C.mut }}>ยอดจริงธนาคาร</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.all.map(r => {
                    const g = r.data;
                    const active = r.type === 'สามารถใช้ได้';
                    const hasFile = !!g && !r.carried;
                    const miss = r.fileMiss, missBad = miss != null && Math.abs(miss) > 0.02;
                    const openBad = r.openDiff != null && Math.abs(r.openDiff) > 0.02;
                    const num = { textAlign: 'right', whiteSpace: 'nowrap', fontSize: 13 };
                    const grp = { borderLeft: '1px solid ' + C.line };
                    /* ที่มาของต้นงวด — คำเดียวสั้น ๆ ใต้ตัวเลข (ไม่ยัดผลตรวจลงไปด้วย
                       ผลตรวจอยู่ที่สีของช่อง "คีย์เอง" + ชิปสถานะแล้ว) */
                    const srcTxt = !g ? '' : (r.carried
                      ? (r.openSrc === 'manual' ? 'คีย์เอง' : 'ยกมา ' + String(r.prev.ym).slice(5))
                      : (g.openingSrc === 'file' ? 'ยกมาในไฟล์' : 'คำนวณเอง'));
                    let chip;
                    if (!g) chip = r.still ? <CfcChip tone="mute">ไม่มีการเคลื่อนไหว</CfcChip>
                      : (active ? <CfcChip tone="bad">ยังไม่นำเข้าไฟล์</CfcChip> : <CfcChip tone="mute">ไม่มีข้อมูล</CfcChip>);
                    else if (missBad && openBad && Math.abs(r.openDiff + miss) <= 0.02)
                      chip = <CfcChip tone="bad" title={'ต้นงวดในระบบ ' + cfcMoney(g.opening) + ' · ที่คีย์ไว้ ' + cfcMoney(r.manOpen) + ' — ส่วนต่างเท่ากับที่ปลายงวดพอดี แปลว่ารายการในไฟล์ครบแล้ว แต่ยอดตั้งต้นผิด'}>ต้นงวดผิด {cfcMoney(Math.abs(r.openDiff))} · ปลายเพี้ยนตาม</CfcChip>;
                    else if (missBad && !hasFile) chip = <CfcChip tone="warn" title={'ยอดจริง ' + cfcMoney(r.manClose) + ' แต่ยังไม่ได้นำเข้าไฟล์'}>ยังไม่นำเข้าไฟล์ · ต่าง {cfcMoney(Math.abs(miss))}</CfcChip>;
                    else if (missBad) chip = <CfcChip tone="bad" title={'ยอดจริง ' + cfcMoney(r.manClose) + ' − ในไฟล์ ' + cfcMoney(g.closingFile) + (miss > 0 ? ' → ไฟล์ขาดรายการรับ' : ' → ไฟล์ขาดรายการจ่าย')}>ไฟล์ขาด {cfcMoney(Math.abs(miss))}</CfcChip>;
                    else if (openBad) chip = <CfcChip tone="bad" title={'ต้นงวดในระบบ ' + cfcMoney(g.opening) + ' · ที่คีย์ไว้ ' + cfcMoney(r.manOpen)}>ต้นงวดไม่ตรง {cfcMoney(Math.abs(r.openDiff))}</CfcChip>;
                    else if (!hasFile && r.prev && Math.abs(r.carryDiff || 0) > 0.02) chip = <CfcChip tone="bad">ยกมาไม่ตรง {cfcMoney(r.carryDiff)}</CfcChip>;
                    else if (miss != null) chip = <CfcChip tone="ok">ตรงยอดธนาคาร</CfcChip>;
                    else if (!hasFile) chip = <CfcChip tone="mute">ไม่มีรายการเดือนนี้</CfcChip>;
                    else if (Math.abs(g.diff) > 0.02) chip = <CfcChip tone="bad">ยอดไม่ลงตัว {cfcMoney(g.diff)}</CfcChip>;
                    else chip = <CfcChip tone="ok">ยอดลงตัว</CfcChip>;

                    return (
                      <tr key={r.key + r.no}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            {typeof BDBankLogo === 'function'
                              ? <BDBankLogo name={r.bank || r.no} size={26} />
                              : <div style={{ width: 26, height: 26, borderRadius: 8, background: C.soft, flex: '0 0 auto' }} />}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap' }}>
                                {r.bank ? r.bank + ' · ' : ''}<span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{r.no}</span>
                              </div>
                              <div style={{ fontSize: 10.5, color: C.faint, whiteSpace: 'nowrap' }}>{r.type || '—'}</div>
                            </div>
                          </div>
                        </td>

                        {/* ต้นงวด · ในระบบ */}
                        <td style={Object.assign({}, num, grp)}>
                          {g ? <React.Fragment>
                            <div>{cfcMoney(g.opening)}</div>
                            <div style={{ fontSize: 10, color: C.faint }} title={r.prev ? 'ปลายงวด ' + r.prev.ym + ' = ' + cfcMoney(r.prev.closingFile) : ''}>
                              {srcTxt}
                              {!r.carried && r.prev && (Math.abs(r.carryDiff) <= 0.02
                                ? <span style={{ color: C.pos }}> ✓</span>
                                : <span style={{ color: C.neg }}> ✗{cfcMoney(r.carryDiff)}</span>)}
                            </div>
                          </React.Fragment> : <span style={{ color: C.faint }}>—</span>}
                        </td>
                        {/* ต้นงวด · คีย์เอง */}
                        <td style={num}>
                          {canEdit
                            ? <CfcMoneyInput value={r.manOpen} placeholder="คีย์ต้นงวด" width={122} bad={openBad}
                                title="ยอดต้นงวดจากสมุดบัญชี — ต่างจากยอดในระบบ = มียอดผิด ต้องไล่หา"
                                onSave={v => saveManual('opening', r.mk, v)} />
                            : <span style={{ color: C.faint }}>{r.manOpen == null ? '—' : cfcMoney(r.manOpen)}</span>}
                        </td>

                        <td style={Object.assign({}, num, grp, { color: g && g.inSum ? C.pos : C.faint })}>{g && g.inSum ? cfcMoney(g.inSum) : '—'}</td>
                        <td style={Object.assign({}, num, { color: g && g.outSum ? C.neg : C.faint })}>{g && g.outSum ? cfcMoney(g.outSum) : '—'}</td>

                        {/* ปลายงวด · ในไฟล์ */}
                        <td style={Object.assign({}, num, grp, { fontWeight: 700 })}>
                          {g ? cfcMoney(g.closingFile) : <span style={{ color: C.faint, fontWeight: 400 }}>—</span>}
                        </td>
                        {/* ปลายงวด · ยอดจริงจากธนาคาร */}
                        <td style={num}>
                          {canEdit
                            ? <CfcMoneyInput value={r.manClose} placeholder="คีย์ยอดจริง" width={126} bad={missBad}
                                title="ยอดคงเหลือจริงจาก statement — ต่างจากยอดในไฟล์ = ไฟล์ดึงมารายการไม่ครบ"
                                onSave={v => saveManual('closing', r.mk, v)} />
                            : <span style={{ color: C.faint }}>{r.manClose == null ? '—' : cfcMoney(r.manClose)}</span>}
                        </td>

                        <td style={grp}>
                          {(g || !r.still) && chip}
                          {g && g.uncoded > 0 && <div style={{ marginTop: 3 }}><CfcChip tone="warn">ยังไม่ลงหมวด {g.uncoded}</CfcChip></div>}
                          {!g && canEdit && <div style={{ marginTop: 3, fontSize: 11, color: C.mut }}>
                            <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <input type="checkbox" checked={!!r.still} style={{ cursor: 'pointer', width: 13, height: 13 }}
                                onChange={e => saveManual('still', r.mk, e.target.checked ? 1 : null)} />
                              ไม่มีการเคลื่อนไหว
                            </label>
                          </div>}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 800, borderTop: '2px solid ' + C.line, background: C.soft }}>
                    <td>รวม {overview.loaded} บัญชีที่นำเข้าแล้ว</td>
                    <td style={{ textAlign: 'right', borderLeft: '1px solid ' + C.line }}>{cfcMoney(overview.tot.opening)}</td>
                    <td></td>
                    <td style={{ textAlign: 'right', color: C.pos, borderLeft: '1px solid ' + C.line }}>{cfcMoney(overview.tot.inSum)}</td>
                    <td style={{ textAlign: 'right', color: C.neg }}>{cfcMoney(overview.tot.outSum)}</td>
                    <td style={{ textAlign: 'right', borderLeft: '1px solid ' + C.line }}>{cfcMoney(overview.tot.closing)}</td>
                    <td></td>
                    <td style={{ fontWeight: 600, fontSize: 11.5, color: C.mut, borderLeft: '1px solid ' + C.line }}>
                      {overview.fileShort ? 'ไม่ตรงยอดธนาคาร ' + overview.fileShort + ' บัญชี'
                        : (overview.tot.bad ? 'ยอดไม่ลงตัว ' + overview.tot.bad + ' บัญชี' : 'ยอดลงตัวทุกบัญชี')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ padding: '9px 18px 12px', fontSize: 11, color: C.faint, lineHeight: 1.75 }}>
              คอลัมน์คู่ = <strong style={{ color: C.mut }}>ในระบบ</strong> (จากไฟล์ / ยกมาจากเดือนก่อน) เทียบกับ <strong style={{ color: C.mut }}>ที่คีย์จากสมุดบัญชี</strong> — ช่องคีย์ขึ้นสีแดงเมื่อไม่ตรง แล้วชิปสถานะบอกจำนวนที่ต่าง<br />
              ใต้ต้นงวดบอกที่มา + ผลเทียบกับเดือนก่อน (✓ / ✗) · บัญชีที่เดือนนั้นไม่มีรายการ ติ๊ก “ไม่มีการเคลื่อนไหว” แล้วจะไม่เตือน
            </div>
          </div>
        )}

        {/* แถบเตือน */}
        {(stat.suspect > 0 || stat.noPv > 0 || stat.orphan > 0) && (
          <div style={Object.assign({}, card, { padding: '10px 16px', borderColor: '#f0dcb0', background: C.warnBg, fontSize: 12.5, color: C.warn })}>
            {stat.orphan > 0 && <div>⚠️ <strong>{stat.orphan} รายการ</strong> ลงหมวดที่<strong>ไม่มีในงบหน้าแรกแล้ว</strong> ({stat.orphanNames.slice(0, 3).join(' · ')}{stat.orphanNames.length > 3 ? ' และอีก ' + (stat.orphanNames.length - 3) : ''}) — ยอดจะไม่เข้าบรรทัดไหนในชีตสรุป ให้เพิ่มหมวดนี้กลับในไฟล์ CASH FLOW แล้วกด "สอนระบบ" ใหม่ หรือเลือกหมวดใหม่ให้รายการเหล่านี้</div>}
            {stat.suspect > 0 && <div>⚠️ <strong>{stat.suspect} รายการ</strong> เลขเช็คคล้ายใบสำคัญจ่ายในระบบแต่ <strong>ยอดไม่ตรง</strong> — ไม่ผูกให้โดยตั้งใจ (ของจริงเคยมีเลขเช็คพิมพ์ตกหลักแล้วไปชนใบอื่น) กดขยายแถวเพื่อดูใบที่ใกล้เคียง</div>}
            {stat.noPv > 0 && <div>ℹ️ {stat.noPv} รายการจ่ายออก ยังไม่พบใบสำคัญจ่ายที่ตรงกัน — ลงไฟล์ "รายงานการจ่ายชำระหนี้" + "รายงานอนุมัติจ่าย" ของเดือนนั้นที่หน้า <strong>ใบสำคัญจ่าย</strong> ก่อน</div>}
          </div>
        )}

        {/* ตาราง */}
        <div style={Object.assign({}, card, { padding: 0, overflow: 'hidden' })}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl tbl-compact" style={{ width: '100%', minWidth: 1180 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 86 }}>วันที่</th>
                  <th style={{ minWidth: 54 }}>MNE</th>
                  <th style={{ minWidth: 124 }}>เลขที่เอกสาร</th>
                  <th style={{ minWidth: 300 }}>รายการ</th>
                  <th style={{ minWidth: 104, textAlign: 'right' }}>ถอน</th>
                  <th style={{ minWidth: 104, textAlign: 'right' }}>ฝาก</th>
                  <th style={{ minWidth: 244 }}>หมวด</th>
                  <th style={{ minWidth: 176 }}>ที่มา</th>
                  <th style={{ minWidth: 64 }}></th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 600).map(r => {
                  const T = CFC_TIER[r.sug.tier];
                  const isOpen = !!open[r.key];
                  return (
                    <Fragment key={r.key}>
                      <tr style={{ background: r.sug.tier === 'new' ? '#fffafa' : (r.sug.tier === 'ask' ? '#fffdf4' : undefined) }}>
                        <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{cfcThaiDate(r.iso)}</td>
                        <td><CfcChip tone="mute">{r.mne || '—'}</CfcChip></td>
                        <td style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11.5 }}>
                          {r.docNo}
                          {r.psNo && <div style={{ color: C.primary, fontSize: 10.5 }}>← {r.psNo}</div>}
                          {r.pv && <div style={{ color: C.primary, fontSize: 10.5 }}>→ {r.pv.PL_PV_No}</div>}
                        </td>
                        <td>
                          <div style={{ fontSize: 12.5, color: C.ink }}>{r.memo || r.note || '—'}</div>
                          <div style={{ fontSize: 11, color: C.mut }}>
                            {r.pvPayee || r.payee || ''}
                            {r.src === 'ps' && <span style={{ marginLeft: 6 }}><CfcChip tone="ok" title={'จากรายงานการจ่ายชำระหนี้ · ใบ ' + r.psNo + (r.chqNo ? ' · เช็ค ' + r.chqNo : '')}>บิลตั้งหนี้</CfcChip></span>}
                            {r.src === 'bank' && <span style={{ marginLeft: 6 }}><CfcChip tone="warn" title="ไม่มีในรายงานการจ่ายชำระหนี้ — มาจากงบกระทบยอด">นอกใบจ่าย</CfcChip></span>}
                            {r.billno && <span style={{ marginLeft: 6, color: C.faint }}>บิล {r.billno}</span>}
                            {r.bills.length > 0 && <span style={{ marginLeft: 6 }}><CfcChip tone="info" title={r.bills.map(b => cfcT(b.vchno) + ' ' + cfcMoney(b.paid)).join('\n')}>{r.bills.length} บิล</CfcChip></span>}
                            {r.wht > 0 && <span style={{ marginLeft: 6 }}><CfcChip tone="warn">WHT {cfcMoney(r.wht)}</CfcChip></span>}
                            {r.matchHow === 'suspect' && <span style={{ marginLeft: 6 }}><CfcChip tone="bad">เลขคล้าย ยอดไม่ตรง</CfcChip></span>}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.out ? C.neg : C.faint }}>{r.out ? cfcMoney(r.out) : '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.in ? C.pos : C.faint }}>{r.in ? cfcMoney(r.in) : '—'}</td>
                        <td>
                          <CfcCatSelect value={r.sug.cat} master={master} disabled={!canEdit}
                            onChange={v => confirmRow(r, v)} />
                          {r.sug.cat && (() => {
                            const mm = master.find(x => x.name === r.sug.cat);
                            const fm = CFC_FLOW_META[cfcFlowOf(mm || { name: r.sug.cat })];
                            return (
                              <div style={{ fontSize: 10.5, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                                <span style={{ color: fm.color, fontWeight: 700 }}>{fm.mark} {fm.label}</span>
                                <span style={{ color: CFC_ACT_COLOR[r.sug.act] || C.mut }}>{CFC_ACT_TH[r.sug.act] || '(ไม่นับเป็นกิจกรรม)'}</span>
                              </div>
                            );
                          })()}
                        </td>
                        <td>
                          <CfcChip tone={T.tone}>{T.label}</CfcChip>
                          <div style={{ fontSize: 10.5, color: C.mut, marginTop: 2 }}>{r.sug.why}</div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {canEdit && r.sug.tier !== 'locked' && r.sug.cat &&
                            <button title="ยืนยันหมวดนี้ + จำไว้" onClick={() => confirmRow(r, r.sug.cat)}
                              style={{ cursor: 'pointer', border: '1px solid ' + C.pos, background: '#fff', color: C.pos, borderRadius: 8, padding: '3px 8px', fontSize: 12, fontWeight: 700 }}>✓</button>}
                          {(r.bills.length > 0 || r.pv || r.matchNear) &&
                            <button title="ดูบิลที่ใบนี้ไปจ่าย" onClick={() => setOpen(o => Object.assign({}, o, { [r.key]: !o[r.key] }))}
                              style={{ cursor: 'pointer', border: '1px solid ' + C.line, background: '#fff', color: C.mut, borderRadius: 8, padding: '3px 8px', fontSize: 12, marginLeft: 4 }}>{isOpen ? '▲' : '▼'}</button>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr><td colSpan={9} style={{ background: C.soft, padding: '8px 14px' }}>
                          {r.pv && <div style={{ fontSize: 12, color: C.ink, marginBottom: 6 }}>
                            <strong>{r.pv.PL_PV_No}</strong> · {cfcT(r.pv.Payee)} · ยอดเช็ค {cfcMoney(cfcPvAmt(r.pv))}
                            {r.wht > 0 && ' · WHT ' + cfcMoney(r.wht)}
                            {r.pv.Doc_Src ? ' · ที่มา ' + r.pv.Doc_Src : ''}
                            {r.matchHow === 'amount' && <span style={{ marginLeft: 8 }}><CfcChip tone="warn">จับคู่ด้วยยอดเงิน (เลขเช็คเขียนไม่เท่ากัน)</CfcChip></span>}
                          </div>}
                          {r.matchHow === 'suspect' && r.matchNear && <div style={{ fontSize: 12, color: C.neg, marginBottom: 6 }}>
                            เลขเช็คใกล้เคียงที่เจอ: <strong>{cfcT(r.matchNear.Chq_No) || cfcT(r.matchNear.PL_PV_No)}</strong> ยอด {cfcMoney(cfcPvAmt(r.matchNear))} — ต่างจากบรรทัดนี้ ({cfcMoney(r.out || r.in)}) จึง<strong>ไม่ผูกให้</strong>
                          </div>}
                          {r.bills.length > 0 ? (
                            <table className="tbl tbl-compact" style={{ width: '100%', background: '#fff' }}>
                              <thead><tr><th>เลขที่ใบรับ/บิล</th><th>เลขที่บิลผู้ขาย</th><th style={{ textAlign: 'right' }}>ยอดจ่าย</th><th>รายละเอียด</th></tr></thead>
                              <tbody>{r.bills.map((b, i) => (
                                <tr key={i}>
                                  <td style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11.5 }}>{cfcT(b.vchno) || '—'}</td>
                                  <td style={{ fontSize: 11.5 }}>{cfcT(b.billno) || '—'}</td>
                                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cfcMoney(b.paid)}</td>
                                  <td style={{ fontSize: 12 }}>{cfcT(b.note) || '—'}</td>
                                </tr>
                              ))}
                              <tr style={{ fontWeight: 700 }}>
                                <td colSpan={2}>รวมบิลย่อย</td>
                                <td style={{ textAlign: 'right' }}>{cfcMoney(r.bills.reduce((a, b) => a + cfcNum(b.paid), 0))}</td>
                                <td style={{ fontSize: 11.5, color: C.mut }}>
                                  {Math.abs(r.bills.reduce((a, b) => a + cfcNum(b.paid), 0) - (r.out + r.wht)) > 0.02
                                    ? '⚠️ ไม่เท่ากับยอดเช็ค + WHT — ตรวจไฟล์นำเข้า' : '✓ ตรงกับยอดเช็ค + WHT'}
                                </td>
                              </tr>
                              </tbody>
                            </table>
                          ) : <div style={{ fontSize: 12, color: C.mut }}>ไม่มีบิลย่อย (ใบอนุมัติจ่าย / รายการธนาคารโดยตรง)</div>}
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
                {!shown.length && <tr><td colSpan={9} style={{ textAlign: 'center', color: C.mut, padding: 28, fontSize: 13 }}>
                  {buckets.length ? 'ไม่มีรายการตรงตัวกรอง' : 'ยังไม่มีข้อมูล — กด "📥 นำเข้างบกระทบยอด" แล้วเลือกไฟล์ .xml/.xlsx จาก EXPRESS (เลือกหลายไฟล์/หลายบัญชีพร้อมกันได้)'}
                </td></tr>}
              </tbody>
            </table>
          </div>
          {shown.length > 600 && <div style={{ padding: '8px 14px', fontSize: 12, color: C.mut }}>แสดง 600 แถวแรกจาก {shown.length} — ใช้ตัวกรองเดือน/บัญชี/ค้นหาเพื่อดูให้แคบลง</div>}
        </div>

        <div style={{ fontSize: 11.5, color: C.faint, padding: '0 4px 6px' }}>
          ยอดรวมที่กรองอยู่: ถอน {cfcMoney(stat.outSum)} · ฝาก {cfcMoney(stat.inSum)} ·
          กฎที่เรียนรู้ไว้ {Object.keys(rules).length} ข้อ · หมวดในผังงบ {master.length} รายการ
        </div>

        {addCat && <CfcCatManagerModal master={master} rules={rules} onClose={() => setAddCat(false)}
          onAdd={saveNewCat} onEdit={saveCatEdit} onDelete={saveCatDelete} />}

        {/* ⚠️ ยืนยัน "จะดันเดือนไหน" ก่อนเสมอ — ผู้ใช้เคยดันผิดเดือนเพราะไม่ทันดูตัวกรองด้านบน
            เลือกเดือนในนี้ = เปลี่ยนตัวกรองของหน้าไปเลย ตัวเลขสรุปในกล่องจึงเป็นของเดือนนั้นจริง ๆ */}
        {pushAsk && (
          <Modal open title="📤 ส่งขึ้นหน้า Cash Flow" onClose={() => setPushAsk(false)}>
            <div style={{ display: 'grid', gap: 12, minWidth: 340 }}>
              <div style={{ fontSize: 13, color: C.mut }}>เลือกเดือนที่จะส่ง — เดือนอื่นที่เคยส่งไว้จะคงตัวเลขเดิมไว้ ไม่ถูกคิดใหม่</div>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>เดือนที่จะส่ง</span>
                <select value={ym} onChange={e => setYm(e.target.value)}
                  style={{ fontSize: 15, fontWeight: 700, padding: '9px 10px', borderRadius: 10, border: '2px solid ' + C.primary, color: C.primaryD }}>
                  <option value="">ทุกเดือน ({allYms.length} เดือน)</option>
                  {allYms.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
              <div style={{ background: C.soft, borderRadius: 10, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.9, color: C.ink }}>
                จะส่ง <strong>{rows.length}</strong> รายการ
                {acct ? <> · เฉพาะบัญชี <strong>{acct}</strong></> : <> · ทุกบัญชี</>}
                <br />ยังไม่ลงหมวด <strong style={{ color: stat.new ? C.neg : C.pos }}>{stat.new}</strong> รายการ
                {stat.new > 0 && <span style={{ color: C.neg }}> — ยอดพวกนี้จะไม่เข้าบรรทัดไหนในงบ</span>}
              </div>
              {acct && <div style={{ fontSize: 12, color: C.warn, background: C.warnBg, borderRadius: 8, padding: '8px 10px' }}>
                ⚠️ ตัวกรอง “บัญชี” เปิดอยู่ — จะส่งเฉพาะบัญชีนี้ ถ้าต้องการทั้งเดือนให้ปิดตัวกรองบัญชีก่อน
              </div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={btn()} onClick={() => setPushAsk(false)}>ยกเลิก</button>
                <button style={btn(true)} disabled={!rows.length} onClick={sendToCashflow}>
                  📤 ส่ง {ym ? 'เดือน ' + ym : 'ทุกเดือน'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {teachRes && (
          <Modal open wide title="📚 เรียนรู้จากไฟล์ CASH FLOW แล้ว" onClose={() => setTeachRes(null)}>
            <div style={{ fontSize: 13, lineHeight: 1.75 }}>
              <div>• หมวดมาตรฐานจากหน้าแรก: <strong>{teachRes.master}</strong> รายการ</div>
              <div>• ประวัติที่อ่านได้: <strong>{teachRes.history}</strong> แถว (ชีต {teachRes.sheets || '—'})</div>
              <div>• จับเข้าหมวดมาตรฐานได้: <strong style={{ color: C.pos }}>{teachRes.learned}</strong> แถว</div>
              {teachRes.banks > 0 && <div>• ทะเบียนบัญชีธนาคาร (ชีต Dpt.): <strong>{teachRes.banks}</strong> บัญชี</div>}
              {teachRes.missed.length > 0 && <>
                <div style={{ marginTop: 10, fontWeight: 700 }}>ชื่อหมวดที่จับไม่ได้ (ข้ามไป — ไม่เดา):</div>
                <div style={{ maxHeight: 200, overflow: 'auto', background: C.soft, borderRadius: 8, padding: '6px 10px', marginTop: 4 }}>
                  {teachRes.missed.map(([k, v]) => <div key={k} style={{ fontSize: 12 }}>{v} × {k}</div>)}
                </div>
                <div style={{ fontSize: 12, color: C.mut, marginTop: 6 }}>
                  ชื่อพวกนี้ไม่มีในหน้าแรก — ถ้าอยากให้ใช้ ให้เพิ่มบรรทัดนั้นในหน้า "งบกระแสเงินสด" ของไฟล์แล้วนำเข้าใหม่
                </div>
              </>}
            </div>
          </Modal>
        )}
      </div>
    );
  }

  window.CfCodingPage = CfCodingPage;
  Object.assign(window, {
    cfcParseBankSheet, cfcParseSettleReport, cfcVoucherToRows, cfcSummaryAoa, cfcFlowOf, cfcInsertCat, cfcMergeAppCats, cfcRuleCatCount, cfcWithExtraCats, cfcStyleSummary, cfcStyleDetail, cfcStyleCheck, cfcPvToVoucher, cfcCoverKeys, cfcParseCashflowWorkbook, cfcBuildEngine, cfcBuildPvIndex,
    cfcLoadLocal, cfcAcctSummary, cfcPrevMonth, cfcAcctKey, cfcAggByAcct, cfcDigits, CFC_BANK_SEED, cfcMatchPv, cfcRefParts, cfcSplitNote, cfcVendorKey, cfcISO, cfcCanonBuilder, CFC_MASTER_SEED,
  });
})();
