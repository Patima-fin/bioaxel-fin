/* =====================================================================
 * ลงรหัสงบกระแสเงินสด (#cf_coding) — BIOAXEL
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

  const CFC_MONTH_TH = { 1: 'ม.ค.', 2: 'ก.พ.', 3: 'มี.ค.', 4: 'เม.ย.', 5: 'พ.ค.', 6: 'มิ.ย.', 7: 'ก.ค.', 8: 'ส.ค.', 9: 'ก.ย.', 10: 'ต.ค.', 11: 'พ.ย.', 12: 'ธ.ค.' };
  const CFC_ACT_TH = { op: 'กิจกรรมการดำเนินงาน', inv: 'กิจกรรมการลงทุน', fin: 'กิจกรรมการจัดหาเงิน', transfer: '' };
  const CFC_ACT_SHORT = { op: 'ดำเนินงาน', inv: 'ลงทุน', fin: 'จัดหาเงิน', transfer: 'โอน' };
  const CFC_ACT_COLOR = { op: C.primary, inv: '#7a5cd0', fin: '#c98a1e', transfer: C.mut };

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

  /* ไฟล์ CASH FLOW ของเตย → (1) หมวดมาตรฐานจากหน้าแรก (2) ประวัติที่ลงรหัสไว้ */
  function cfcParseCashflowWorkbook(wb) {
    const res = { master: [], history: [], sheetUsed: '', error: '' };
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
    if (!res.master.length && !res.history.length) res.error = 'ไม่พบทั้งหน้า "งบกระแสเงินสด" และชีตที่มีคอลัมน์ "หมวด…/ประเภทกิจกรรม…"';
    return res;
  }

  /* ── ตรวจยอดรายบัญชีรายเดือน — หัวใจของงาน "หลายธนาคาร" ───────────────
     ยอดยกมา = ยอดคงเหลือของแถวแรก(ตามลำดับไฟล์) − กระแสของแถวนั้น
     ยอดปลายงวด = ยอดคงเหลือของแถวสุดท้าย → ต้องเท่ากับ ยกมา + รับ − จ่าย
     ถ้าไม่เท่า = นำเข้ามาไม่ครบ/ไฟล์ซ้อนเดือน — ต้องเห็นก่อนเอาไปทำงบ     */
  function cfcAcctSummary(rows) {
    const by = {};
    rows.forEach(r => {
      const k = (r.acctNo || '') + '|' + String(r.iso).slice(0, 7);
      const g = by[k] || (by[k] = { acctNo: r.acctNo, acctLabel: r.acctLabel, ym: String(r.iso).slice(0, 7),
        n: 0, inSum: 0, outSum: 0, uncoded: 0, first: null, last: null });
      g.n++; g.inSum += r.in; g.outSum += r.out;
      if (!r.sug || !r.sug.cat) g.uncoded++;
      const key = String(r.iso) + '#' + String(r.idx == null ? 0 : r.idx).padStart(6, '0');
      if (!g.first || key < g.first.k) g.first = { k: key, row: r };
      if (!g.last || key > g.last.k) g.last = { k: key, row: r };
    });
    return Object.keys(by).sort().map(k => {
      const g = by[k];
      const f = g.first && g.first.row, l = g.last && g.last.row;
      const opening = f ? (cfcNum(f.balance) - (f.in - f.out)) : 0;
      const closingFile = l ? cfcNum(l.balance) : 0;
      const closingCalc = opening + g.inSum - g.outSum;
      return Object.assign(g, { opening, closingFile, closingCalc, diff: closingCalc - closingFile });
    });
  }

  /* ══════════════ storage (Supabase blob + localStorage cache) ══════════════ */
  function cfcCanSync() {
    return !!(window.WTPData && WTPData.fetchSheetRows && WTPData.writeTable
      && window.WTP_CONFIG && WTP_CONFIG.BACKEND === 'supabase');
  }
  function cfcLoadLocal() { try { return JSON.parse(localStorage.getItem(CFC_LS) || 'null') || {}; } catch (e) { return {}; } }
  function cfcSaveLocal(o) { try { localStorage.setItem(CFC_LS, JSON.stringify(o)); } catch (e) {} }

  /* หมวดที่ไม่ได้อยู่ในงบหน้าแรก แต่ต้องมีให้เลือกเสมอ (บรรทัดธนาคารมีจริง)
     → ผนวกกลับทุกครั้งที่อ่านหมวดมาตรฐานจากไฟล์ CASH FLOW มาทับ */
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
  const CFC_TIER = {
    locked: { label: '✅ ยืนยันแล้ว', tone: 'ok' },
    auto: { label: '🤖 มั่นใจ', tone: 'info' },
    ask: { label: '❓ ขอให้ยืนยัน', tone: 'warn' },
    new: { label: '🆕 รายการใหม่', tone: 'bad' },
  };

  function CfcCatSelect({ value, master, onChange, disabled, width }) {
    const groups = useMemo(() => {
      const by = {}; master.forEach(m => { const k = m.act + '|' + m.group; (by[k] = by[k] || []).push(m.name); });
      return Object.entries(by);
    }, [master]);
    return (
      <select value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)}
        style={{ width: width || 232, maxWidth: '100%', fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid ' + (value ? C.line : '#f0c9c9'), background: value ? '#fff' : '#fff8f8', color: C.ink }}>
        <option value="">— ยังไม่ลงหมวด —</option>
        {groups.map(([k, items]) => (
          <optgroup key={k} label={(CFC_ACT_SHORT[k.split('|')[0]] || '') + ' · ' + k.split('|')[1]}>
            {items.map(n => <option key={n} value={n}>{n}</option>)}
          </optgroup>
        ))}
      </select>
    );
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

    const persist = (next) => {
      setStore(next); cfcSaveLocal(next);
      if (!cfcCanSync()) return Promise.resolve({ shared: false });
      const rows = Object.keys(next).map(id => Object.assign({ id }, next[id]));
      return WTPData.writeTable(CFC_TABLE, rows, r => r.id)
        .then(() => { setSynced(true); return { shared: true }; })
        .catch(e => { console.warn('[cfc] save', e && e.message); return { shared: false, err: e }; });
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
        out.push({ id, acctNo: b.acctNo || '', acctLabel: b.acctLabel || '', ym: b.ym || '', lines: b.lines, uploadedAt: b.uploadedAt });
      });
      return out.sort((a, b) => (a.ym === b.ym ? String(a.acctNo).localeCompare(String(b.acctNo)) : (a.ym < b.ym ? 1 : -1)));
    }, [store]);
    const allYms = useMemo(() => [...new Set(buckets.map(b => b.ym))].sort().reverse(), [buckets]);
    const allAccts = useMemo(() => {
      const m = {}; buckets.forEach(b => { m[b.acctNo] = b.acctLabel || b.acctNo; }); return Object.entries(m);
    }, [buckets]);
    useEffect(() => { if (!ym && allYms.length) setYm(allYms[0]); }, [allYms, ym]);

    /* ── join กับ pvVouchers + เสนอหมวด ── */
    const pvIdx = useMemo(() => cfcBuildPvIndex(data.pvVouchers || []), [data.pvVouchers]);
    const rows = useMemo(() => {
      const sel = buckets.filter(b => (!ym || b.ym === ym) && (!acct || b.acctNo === acct));
      const out = [];
      sel.forEach(b => (b.lines || []).forEach(L => {
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
        out.push(row);
      }));
      // เรียงแบบเดียวกับชีต "รวมทุกบัญชี": วันที่ → บัญชี → ลำดับเดิมในไฟล์
      return out.sort((a, b) => (a.iso !== b.iso ? (a.iso < b.iso ? -1 : 1)
        : (a.acctNo !== b.acctNo ? String(a.acctNo).localeCompare(String(b.acctNo))
        : (Number(a.idx || 0) - Number(b.idx || 0)))));
    }, [buckets, ym, acct, pvIdx, engine]);

    const stat = useMemo(() => {
      const s = { n: rows.length, locked: 0, auto: 0, ask: 0, new: 0, inSum: 0, outSum: 0, noPv: 0, suspect: 0 };
      rows.forEach(r => {
        s[r.sug.tier]++; s.inSum += r.in; s.outSum += r.out;
        if (r.matchHow === 'suspect') s.suspect++;
        else if (!r.pv && r.out > 0) s.noPv++;
      });
      return s;
    }, [rows]);

    const acctCheck = useMemo(() => cfcAcctSummary(rows), [rows]);

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

    /* ── นำเข้าไฟล์งบกระทบยอด ── */
    async function onBankFiles(files) {
      if (!files || !files.length) return;
      setBusy('กำลังอ่านไฟล์…');
      const next = Object.assign({}, store); const notes = [];
      try {
        for (const f of Array.from(files)) {
          const wb = await cfcReadWorkbook(f);
          let best = null;
          wb.SheetNames.forEach(sn => {
            const p = cfcParseBankSheet(cfcAoa(wb.Sheets[sn]), f.name);
            if (!p.error && (!best || p.lines.length > best.lines.length)) best = p;
          });
          if (!best || !best.lines.length) { notes.push('❌ ' + f.name + ' — ' + ((best && best.error) || 'ไม่พบรายการ')); continue; }
          const byYm = {};
          best.lines.forEach(L => { const k = String(L.iso).slice(0, 7); (byYm[k] = byYm[k] || []).push(L); });
          Object.keys(byYm).forEach(k => {
            const id = 'lines:' + best.acctNo + ':' + k;
            next[id] = { acctNo: best.acctNo, acctLabel: best.acctLabel, ym: k, lines: byYm[k], uploadedAt: new Date().toISOString(), file: f.name };
          });
          notes.push('✅ ' + f.name + ' — ' + best.lines.length + ' รายการ · บัญชี ' + (best.acctNo || '?') + ' · ' + Object.keys(byYm).join(', '));
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
        const nextMaster = cfcWithExtraCats(p.master.length ? p.master : master);
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
        await persist(next);
        setBusy('');
        setTeachRes({ master: nextMaster.length, history: p.history.length, learned, sheets: p.sheetUsed, missed: Object.entries(missed).sort((a, b) => b[1] - a[1]) });
      } catch (e) { setBusy(''); toast && toast('อ่านไฟล์ไม่สำเร็จ: ' + (e && e.message || ''), 'error'); }
    }

    /* ── ส่งออกชีต "รวมทุกบัญชี" ── */
    /* ส่งออก 3 ชีตในไฟล์เดียว — ออกแบบให้ "เอาไปวางในไฟล์ CASH FLOW ได้เลย"
         1) รวมทุกบัญชี   = 13 คอลัมน์เดิม (วางทับชีตเดิมได้ตรง ๆ)
         2) สรุปตามหมวด  = หมวด × เดือน เรียงตามงบหน้าแรกทุกบรรทัด → ก็อปคอลัมน์เดือนไปวางในงบ
         3) ตรวจยอดรายบัญชี = ยกมา + รับ − จ่าย = ปลายงวด ต่อบัญชีต่อเดือน (พิสูจน์ว่านำเข้าครบ) */
    function exportSheet() {
      if (!rows.length) { toast && toast('ยังไม่มีรายการให้ส่งออก'); return; }
      const months = [...new Set(rows.map(r => String(r.iso).slice(0, 7)))].sort();
      const monLabel = (m) => { const p2 = m.split('-'); return (CFC_MONTH_TH[+p2[1]] || p2[1]) + ' ' + (Number(p2[0]) + 543 - 2500); };
      const wb = XLSX.utils.book_new();

      /* ── ชีต 1: รวมทุกบัญชี ── */
      const head = ['ลำดับ', 'บัญชีธนาคาร', 'เลขที่บัญชี', 'วันที่', 'MNE', 'เลขที่เอกสาร', 'ยอดถอน', 'ยอดฝาก',
        'ยอดคงเหลือ', 'สถานะเช็ค', 'หมายเหตุ', 'หมวดเงินรับ-เงินจ่าย', 'ประเภทกิจกรรมทางการเงิน'];
      const aoa = [head];
      rows.forEach((r, i) => aoa.push([
        i + 1, r.acctLabel || '', r.acctNo || '', cfcThaiDate(r.iso), r.mne || '', r.docNo || '',
        r.out || '', r.in || '', r.balance || '', r.chqStatus || '', r.note || '',
        r.sug.cat || '', CFC_ACT_TH[r.sug.act] === undefined ? '' : CFC_ACT_TH[r.sug.act],
      ]));
      const ws1 = XLSX.utils.aoa_to_sheet(aoa);
      ws1['!cols'] = [{ wch: 6 }, { wch: 38 }, { wch: 15 }, { wch: 11 }, { wch: 7 }, { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 10 }, { wch: 46 }, { wch: 34 }, { wch: 22 }];
      ws1['!freeze'] = { xSplit: 0, ySplit: 1 };
      XLSX.utils.book_append_sheet(wb, ws1, 'รวมทุกบัญชี');

      /* ── ชีต 2: สรุปตามหมวด (โครงเดียวกับงบหน้าแรก ทุกบรรทัด แม้ยอด 0) ── */
      const cell = {};   // 'หมวด|ym' → ยอด (ฝาก − ถอน)
      let uncodedTot = 0;
      rows.forEach(r => {
        const m = String(r.iso).slice(0, 7), v = r.in - r.out;
        const k = (r.sug.cat || '(ยังไม่ลงหมวด)') + '|' + m;
        cell[k] = (cell[k] || 0) + v;
        if (!r.sug.cat) uncodedTot++;
      });
      const val = (name) => months.map(m => cell[name + '|' + m] || 0);
      const sumRow = (names) => months.map((m, i) => names.reduce((a, n) => a + (cell[n + '|' + m] || 0), 0));
      const withTotal = (arr) => arr.concat([arr.reduce((a, x) => a + x, 0)]);
      const s2 = [['บริษัท ไบโอแอ็กซ์เซล จำกัด'], ['สรุปตามหมวด — สำหรับวางในงบกระแสเงินสด'],
        ['ที่มา: หน้า "ลงรหัสงบกระแสเงินสด" · ' + rows.length + ' รายการ · ' +
         (acct ? 'บัญชี ' + acct : allAccts.length + ' บัญชี') + ' · สร้าง ' + new Date().toLocaleString('th-TH-u-ca-gregory')],
        [], ['รายการ'].concat(months.map(monLabel)).concat(['รวม'])];
      const SEC = { op: 'กระแสเงินสดจากกิจกรรมดำเนินงาน', inv: 'กระแสเงินสดจากกิจกรรมลงทุน', fin: 'กระแสเงินสดจากกิจกรรมจัดหาเงิน' };
      const actNet = {};
      ['op', 'inv', 'fin'].forEach(a => {
        const inAct = master.filter(m => m.act === a);
        if (!inAct.length) return;
        s2.push([SEC[a]]);
        const groups = [...new Set(inAct.map(m => m.group))];
        groups.forEach(g => {
          const items = inAct.filter(m => m.group === g).map(m => m.name);
          s2.push(['   ' + g]);
          items.forEach(n => s2.push(['      ' + n].concat(withTotal(val(n)))));
          s2.push(['   รวม' + g].concat(withTotal(sumRow(items))));
        });
        const all = inAct.map(m => m.name);
        actNet[a] = sumRow(all);
        s2.push(['กระแสเงินสดสุทธิจาก' + SEC[a].replace('กระแสเงินสดจาก', '')].concat(withTotal(actNet[a])));
        s2.push([]);
      });
      const net = months.map((m, i) => ['op', 'inv', 'fin'].reduce((a, k) => a + ((actNet[k] || [])[i] || 0), 0));
      s2.push(['เงินสดสุทธิ เพิ่มขึ้น (ลดลง)'].concat(withTotal(net)));
      s2.push([]);
      s2.push(['— รายการที่ไม่นับเป็นกิจกรรม (ไว้ตรวจ ไม่ต้องวางในงบ) —']);
      s2.push(['   โอนเงินระหว่างบัญชี (ควรเป็น 0 เมื่อรวมทุกบัญชี)'].concat(withTotal(val('โอนเงินระหว่างบัญชี'))));
      s2.push(['   (ยังไม่ลงหมวด)'].concat(withTotal(val('(ยังไม่ลงหมวด)'))));
      const ws2 = XLSX.utils.aoa_to_sheet(s2);
      ws2['!cols'] = [{ wch: 46 }].concat(months.map(() => ({ wch: 15 }))).concat([{ wch: 16 }]);
      XLSX.utils.book_append_sheet(wb, ws2, 'สรุปตามหมวด');

      /* ── ชีต 3: ตรวจยอดรายบัญชี ── */
      const sum = cfcAcctSummary(rows);
      const s3 = [['ตรวจยอดรายบัญชีรายเดือน — ยอดยกมา + รับ − จ่าย ต้องเท่ากับยอดคงเหลือปลายงวด'], [],
        ['บัญชีธนาคาร', 'เลขที่บัญชี', 'เดือน', 'ยอดยกมา', 'รับ', 'จ่าย', 'ปลายงวด (คำนวณ)', 'ปลายงวด (จากไฟล์)', 'ต่าง', 'จำนวนรายการ', 'ยังไม่ลงหมวด']];
      sum.forEach(g => s3.push([g.acctLabel || '', g.acctNo || '', monLabel(g.ym), g.opening, g.inSum, g.outSum,
        g.closingCalc, g.closingFile, g.diff, g.n, g.uncoded]));
      s3.push([]);
      s3.push(['รวมทุกบัญชี', '', '', sum.reduce((a, g) => a + g.opening, 0), sum.reduce((a, g) => a + g.inSum, 0),
        sum.reduce((a, g) => a + g.outSum, 0), sum.reduce((a, g) => a + g.closingCalc, 0),
        sum.reduce((a, g) => a + g.closingFile, 0), sum.reduce((a, g) => a + g.diff, 0),
        rows.length, uncodedTot]);
      const ws3 = XLSX.utils.aoa_to_sheet(s3);
      ws3['!cols'] = [{ wch: 40 }, { wch: 14 }, { wch: 11 }, { wch: 16 }, { wch: 15 }, { wch: 15 }, { wch: 17 }, { wch: 17 }, { wch: 11 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws3, 'ตรวจยอดรายบัญชี');

      XLSX.writeFile(wb, 'BIO-ลงรหัส-' + (ym || 'ทุกเดือน') + (acct ? '-' + acct : '-ทุกบัญชี') + '.xlsx');
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
              <div style={{ fontSize: 17, fontWeight: 800, color: C.ink }}>🧾 ลงรหัสงบกระแสเงินสด</div>
              <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>
                ข้อมูลดิบจาก EXPRESS → ผูกกับใบสำคัญจ่าย/บิลตั้งหนี้ → เสนอหมวด + จำที่ยืนยันไว้ใช้เดือนถัดไป
                {synced ? ' · ข้อมูลส่วนกลาง (ทุกคนเห็น)' : ' · ข้อมูลในเครื่อง'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canEdit && <button style={btn()} onClick={() => fileCf.current && fileCf.current.click()}>📚 สอนระบบจากไฟล์ CASH FLOW</button>}
              {canEdit && <button style={btn()} onClick={() => fileBank.current && fileBank.current.click()}>📥 นำเข้างบกระทบยอด</button>}
              <button style={btn(true)} onClick={exportSheet}>⬇️ ส่งออกชีต "รวมทุกบัญชี"</button>
            </div>
          </div>
          <input ref={fileBank} type="file" accept=".xml,.xls,.xlsx" multiple style={{ display: 'none' }}
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

        {/* ตรวจยอดรายบัญชี — โผล่เมื่อมีมากกว่า 1 บัญชี-เดือน */}
        {acctCheck.length > 1 && (
          <div style={Object.assign({}, card, { padding: 0, overflow: 'hidden' })}>
            <div style={{ padding: '10px 16px 6px', fontSize: 13.5, fontWeight: 800, color: C.ink }}>
              🏦 ตรวจยอดรายบัญชี <span style={{ fontSize: 11.5, fontWeight: 500, color: C.mut }}>ยอดยกมา + รับ − จ่าย ต้องเท่ากับปลายงวด · ไม่ตรง = นำเข้ายังไม่ครบ</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl tbl-compact" style={{ width: '100%', minWidth: 820 }}>
                <thead><tr>
                  <th style={{ minWidth: 210 }}>บัญชี</th><th style={{ minWidth: 74 }}>เดือน</th>
                  <th style={{ textAlign: 'right', minWidth: 106 }}>ยกมา</th>
                  <th style={{ textAlign: 'right', minWidth: 106 }}>รับ</th>
                  <th style={{ textAlign: 'right', minWidth: 106 }}>จ่าย</th>
                  <th style={{ textAlign: 'right', minWidth: 116 }}>ปลายงวด</th>
                  <th style={{ minWidth: 128 }}>สถานะ</th>
                </tr></thead>
                <tbody>
                  {acctCheck.map(g => {
                    const ok = Math.abs(g.diff) <= 0.02;
                    return (
                      <tr key={g.acctNo + g.ym}>
                        <td style={{ fontSize: 12 }}>{g.acctLabel || g.acctNo}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{g.ym}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cfcMoney(g.opening)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.pos }}>{cfcMoney(g.inSum)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.neg }}>{cfcMoney(g.outSum)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{cfcMoney(g.closingFile)}</td>
                        <td>
                          {ok ? <CfcChip tone="ok">✓ ยอดลงตัว</CfcChip> : <CfcChip tone="bad" title={'ต่าง ' + cfcMoney(g.diff)}>ต่าง {cfcMoney(g.diff)}</CfcChip>}
                          {g.uncoded > 0 && <span style={{ marginLeft: 5 }}><CfcChip tone="warn">ยังไม่ลงหมวด {g.uncoded}</CfcChip></span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* แถบเตือน */}
        {(stat.suspect > 0 || stat.noPv > 0) && (
          <div style={Object.assign({}, card, { padding: '10px 16px', borderColor: '#f0dcb0', background: C.warnBg, fontSize: 12.5, color: C.warn })}>
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
                          {r.pv && <div style={{ color: C.primary, fontSize: 10.5 }}>→ {r.pv.PL_PV_No}</div>}
                        </td>
                        <td>
                          <div style={{ fontSize: 12.5, color: C.ink }}>{r.memo || r.note || '—'}</div>
                          <div style={{ fontSize: 11, color: C.mut }}>
                            {r.pvPayee || r.payee || ''}
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
                          {r.sug.cat && <div style={{ fontSize: 10.5, color: CFC_ACT_COLOR[r.sug.act] || C.mut, marginTop: 2 }}>
                            {CFC_ACT_TH[r.sug.act] || '(ไม่นับเป็นกิจกรรม)'}
                          </div>}
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
          กฎที่เรียนรู้ไว้ {Object.keys(rules).length} ข้อ · หมวดมาตรฐาน {master.length} รายการ
        </div>

        {teachRes && (
          <Modal open wide title="📚 เรียนรู้จากไฟล์ CASH FLOW แล้ว" onClose={() => setTeachRes(null)}>
            <div style={{ fontSize: 13, lineHeight: 1.75 }}>
              <div>• หมวดมาตรฐานจากหน้าแรก: <strong>{teachRes.master}</strong> รายการ</div>
              <div>• ประวัติที่อ่านได้: <strong>{teachRes.history}</strong> แถว (ชีต {teachRes.sheets || '—'})</div>
              <div>• จับเข้าหมวดมาตรฐานได้: <strong style={{ color: C.pos }}>{teachRes.learned}</strong> แถว</div>
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
    cfcParseBankSheet, cfcParseCashflowWorkbook, cfcBuildEngine, cfcBuildPvIndex,
    cfcLoadLocal, cfcAcctSummary, cfcMatchPv, cfcRefParts, cfcSplitNote, cfcVendorKey, cfcISO, cfcCanonBuilder, CFC_MASTER_SEED,
  });
})();
