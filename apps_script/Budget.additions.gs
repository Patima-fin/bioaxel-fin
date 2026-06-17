/****************************************************************************************
 * Water POG — Budget Control Center · ADDITIVE backend module
 * ----------------------------------------------------------------------------------------
 * ไฟล์นี้ "เพิ่มเข้าไป" ใน Apps Script project เดิม (Code.standalone.gs) เท่านั้น
 * ไม่แตะ endpoint / ฟังก์ชัน / ชีตเดิมที่ใช้งานอยู่
 *
 *  ▸ ใช้ helper ของโปรเจกต์เดิมร่วมกัน: _ss(), writeTable(), appendAuditLog_()
 *  ▸ ทำงานกับ 1 แท็บใหม่เท่านั้น:
 *        'BUDGET HO' → ตาราง 1 แถวต่อ 1 บัญชี (dept, deptName, acct, desc, b1..b12, a1..a12)
 *
 *  ── ทำไมเป็น "เขียนทับทั้งตาราง" (writeTable) ไม่ใช่ append ──
 *  ไฟล์ "Export HeadOfficeExpense" เป็น snapshot สะสมทั้งปี (YTD) อยู่แล้ว — ทุกครั้งที่
 *  อัปโหลด คือภาพล่าสุดของทั้งปี การเขียนทับทั้งตารางจึงถูกต้อง (append จะทำให้ข้อมูลซ้ำ)
 *
 *  ── วิธีติดตั้ง (paste & deploy) ─────────────────────────────────────────────
 *  1) เปิด Apps Script project เดิม (อันที่ deploy เป็น Web app อยู่)
 *  2) New file → ตั้งชื่อ "Budget.additions.gs" → วางโค้ดนี้ทั้งไฟล์ → Ctrl+S
 *     (case 'budgetImportMonth' ใน doPost ของ Code.standalone.gs เพิ่มให้แล้ว —
 *      ถ้าก็อป Code.standalone.gs เวอร์ชันล่าสุดไปวางก็มีบรรทัดนี้อยู่แล้ว)
 *  3) รันฟังก์ชัน setupBudgetSheets() หนึ่งครั้ง (เลือกจาก dropdown แล้วกด Run)
 *     เพื่อสร้างแท็บ 'BUDGET HO' (ถ้ายังไม่มี — ถ้ามีแล้วจะข้าม)
 *  4) Deploy → Manage deployments → แก้ deployment เดิม → Version: New version → Deploy
 *     (URL เดิมไม่เปลี่ยน — ไม่ต้องแก้ app/config.js)
 ****************************************************************************************/

/* ── ชื่อแท็บ + schema มาตรฐานของหน้า Budget Control Center ───────────── */
var BCC_SHEET = 'BUDGET HO';

// header ของ 'BUDGET HO' — 1 แถวต่อ 1 บัญชี (ตรงกับ parseSheetRows ใน app/page_budget.jsx)
var BCC_HEADERS = (function () {
  var h = ['dept', 'deptName', 'acct', 'desc', 'cat'];   // cat = หมวดค่าใช้จ่าย (finance จัดให้ในไฟล์ Budget ใหม่)
  for (var m = 1; m <= 12; m++) h.push('b' + m);
  for (var m2 = 1; m2 <= 12; m2++) h.push('a' + m2);
  h.push('updatedAt');
  return h;
})();

/* ── ACTION: budgetImportMonth ──────────────────────────────────────
 * body = {
 *   action:'budgetImportMonth',
 *   rows: [{ dept, deptName, acct, desc, b1..b12, a1..a12 }],  // snapshot ทั้งปีของ HO
 *   meta: { user, displayName, role }
 * }
 * ผลลัพธ์: เขียนทับ 'BUDGET HO' ทั้งตารางด้วย snapshot ล่าสุด
 * ──────────────────────────────────────────────────────────────────── */
function budgetImportMonth(body) {
  body = body || {};
  var rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return { error: 'ไม่มีข้อมูลให้นำเข้า (rows ว่าง)' };

  var meta = body.meta || {};
  var ts = new Date();

  // normalize: บังคับ field ครบ + แปลงตัวเลข + ใส่ updatedAt
  var clean = rows.map(function (r) {
    r = r || {};
    var o = {
      dept: String(r.dept || '').trim(),
      deptName: String(r.deptName || r.dept || '').trim(),
      acct: String(r.acct || '').trim(),
      desc: String(r.desc || '').trim(),
      cat: String(r.cat || '').trim(),
      updatedAt: ts,
    };
    for (var m = 1; m <= 12; m++) {
      o['b' + m] = _bccNum(r['b' + m]);
      o['a' + m] = _bccNum(r['a' + m]);
    }
    return o;
  }).filter(function (o) { return o.dept && o.acct; });

  if (!clean.length) return { error: 'ทุกแถวขาด dept/acct หลังตรวจสอบ' };

  // เขียนทับทั้งตาราง (snapshot ล่าสุด)
  writeTable(BCC_SHEET, BCC_HEADERS, clean);

  // audit log (best-effort — ไม่ block การนำเข้าหากล้มเหลว)
  try {
    var deptSet = {};
    clean.forEach(function (o) { deptSet[o.dept] = 1; });
    appendAuditLog_({
      timestamp: ts,
      user: meta.user || 'unknown',
      displayName: meta.displayName || '',
      role: meta.role || '',
      entity: BCC_SHEET,
      action: 'budgetImportMonth',
      rowsAffected: clean.length,
      summary: 'นำเข้า Budget Control Center · ' + clean.length + ' บัญชี · ' + Object.keys(deptSet).length + ' แผนก',
    });
  } catch (e) { /* ignore */ }

  return { ok: true, imported: clean.length };
}

/* แปลงค่าตัวเลขที่อาจเป็น string มี comma ("1,487,850.06") หรือ "-..." → number */
function _bccNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  var n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : Math.round(n);
}

/* ── SETUP — รันครั้งเดียวหลัง deploy ────────────────────────────────
 * สร้างแท็บ 'BUDGET HO' (ถ้ายังไม่มี) — ปลอดภัยต่อการรันซ้ำ ไม่ลบ/ทับข้อมูลเดิม
 * ──────────────────────────────────────────────────────────────────── */
function setupBudgetSheets() {
  var ss = _ss();
  var sh = ss.getSheetByName(BCC_SHEET);
  var created = false;
  if (!sh) {
    sh = ss.insertSheet(BCC_SHEET);
    created = true;
  }
  if (sh.getLastRow() === 0) {
    var hr = sh.getRange(1, 1, 1, BCC_HEADERS.length);
    hr.setValues([BCC_HEADERS]);
    hr.setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff').setFontSize(10);
    sh.setFrozenRows(1);
  }
  var msg = BCC_SHEET + ': ' + (created ? 'สร้างใหม่' : 'มีอยู่แล้ว (ข้าม)');
  Logger.log(msg);
  return { created: created, message: msg };
}
