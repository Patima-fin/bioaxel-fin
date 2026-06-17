/****************************************************************************************
 * Water POG — งบกำไรขาดทุน (P&L) · ADDITIVE backend module
 * ----------------------------------------------------------------------------------------
 * ไฟล์นี้ "เพิ่มเข้าไป" ใน Apps Script project เดิม (Code.standalone.gs) เท่านั้น
 * ไม่แตะ endpoint / ฟังก์ชัน / ชีตเดิมที่ใช้งานอยู่
 *
 *  ▸ ใช้ helper ของโปรเจกต์เดิมร่วมกัน: _ss(), appendAuditLog_(), newId_()
 *  ▸ ทำงานกับ 2 แท็บใหม่เท่านั้น:
 *        'DATA INPUT'  → log แบบ append-only (1 แถวต่อ 1 บัญชีต่อ 1 การนำเข้า)
 *        'ฐาน DATA'    → ตารางสรุป 1 แถวต่อ 1 ผังบัญชี (group, code, name, m1..m12)
 *
 *  ── วิธีติดตั้ง (paste & deploy) ─────────────────────────────────────────────
 *  1) เปิด Apps Script project เดิม (อันที่ deploy เป็น Web app อยู่)
 *  2) New file → ตั้งชื่อ "PnL.additions.gs" → วางโค้ดนี้ทั้งไฟล์ → Ctrl+S
 *     (case 'plImportMonth' ใน doPost ของ Code.standalone.gs เพิ่มให้แล้ว —
 *      ถ้าก็อป Code.standalone.gs เวอร์ชันล่าสุดไปวางก็มีบรรทัดนี้อยู่แล้ว)
 *  3) รันฟังก์ชัน setupPnLSheets() หนึ่งครั้ง (เลือกจาก dropdown แล้วกด Run)
 *     เพื่อสร้างแท็บ 'DATA INPUT' + 'ฐาน DATA' (ถ้ายังไม่มี — ถ้ามีแล้วจะข้าม)
 *  4) Deploy → Manage deployments → แก้ deployment เดิม → Version: New version → Deploy
 *     (URL เดิมไม่เปลี่ยน — ไม่ต้องแก้ app/config.js)
 ****************************************************************************************/

/* ── ชื่อแท็บ + schema มาตรฐานของหน้า P&L ───────────────────────────── */
var PL_SHEET_BASE  = 'ฐาน DATA';
var PL_SHEET_INPUT = 'DATA INPUT';

// 9 กลุ่มตามงบกำไรขาดทุน (ตรงกับ PL_GROUP_ORDER ใน app/page_pnl.jsx)
var PL_GROUPS = ['saleGoods','service','otherIncome','cogs','costService','commission','selling','admin','finance'];

// header ของ 'ฐาน DATA' — 1 แถวต่อ 1 ผังบัญชี
var PL_BASE_HEADERS = ['group','code','name','m1','m2','m3','m4','m5','m6','m7','m8','m9','m10','m11','m12','updatedAt'];

// header ของ 'DATA INPUT' — log แบบ append-only
var PL_INPUT_HEADERS = ['timestamp','month','code','name','group','amount','audit','user'];

/* ── ACTION: plImportMonth ──────────────────────────────────────────
 * body = {
 *   action:'plImportMonth',
 *   month: 1..12,
 *   audit: 'PRE-CLOSING' | 'AUDITED',
 *   accounts:    [{ code, name, amount, group }],   // ทุกบัญชีของเดือนนั้น
 *   newAccounts: [{ code, name, group }],            // บัญชีใหม่ที่ผู้ใช้จัดกลุ่มแล้ว
 *   meta: { user, displayName, role }
 * }
 * ผลลัพธ์: append ลง 'DATA INPUT' + upsert ยอดเดือนนั้นเข้า 'ฐาน DATA'
 * ──────────────────────────────────────────────────────────────────── */
function plImportMonth(body) {
  body = body || {};
  var month = Math.max(1, Math.min(12, Number(body.month) || 0));
  if (!month) return { error: 'month ไม่ถูกต้อง (ต้องเป็น 1–12)' };

  var audit = String(body.audit || 'PRE-CLOSING');
  var accounts = Array.isArray(body.accounts) ? body.accounts : [];
  if (!accounts.length) return { error: 'ไม่มีรายการบัญชีให้นำเข้า' };

  var meta = body.meta || {};
  var user = meta.displayName || meta.user || 'unknown';

  // map กลุ่มที่ผู้ใช้จัดให้บัญชีใหม่ (code → group) — ใช้ override การเดา
  var newGroupByCode = {};
  (body.newAccounts || []).forEach(function (a) {
    if (a && a.code) newGroupByCode[String(a.code).trim()] = a.group || '';
  });

  var ss = _ss();
  plEnsureSheet_(ss, PL_SHEET_INPUT, PL_INPUT_HEADERS);
  plEnsureSheet_(ss, PL_SHEET_BASE, PL_BASE_HEADERS);

  // normalize รายการนำเข้า
  var ts = new Date();
  var rows = accounts.map(function (a) {
    var code = String((a && a.code) || '').trim();
    var grp  = newGroupByCode[code] || (a && a.group) || plInferGroup_(code) || '';
    return {
      code: code,
      name: String((a && a.name) || '').trim(),
      group: PL_GROUPS.indexOf(grp) >= 0 ? grp : '',
      amount: Number((a && a.amount) || 0) || 0,
    };
  }).filter(function (r) { return r.code; });

  if (!rows.length) return { error: 'รายการบัญชีว่างหลังตรวจสอบรหัส' };

  // 1) append-only log → 'DATA INPUT'
  var inputSh = ss.getSheetByName(PL_SHEET_INPUT);
  var inputData = rows.map(function (r) {
    return [ts, month, r.code, r.name, r.group, r.amount, audit, user];
  });
  inputSh.getRange(inputSh.getLastRow() + 1, 1, inputData.length, PL_INPUT_HEADERS.length).setValues(inputData);

  // 2) upsert ยอดเดือน month → 'ฐาน DATA'
  var res = plUpsertBase_(ss, month, rows);

  // 3) audit log (best-effort — ไม่ block การนำเข้าหากล้มเหลว)
  try {
    appendAuditLog_({
      timestamp: ts,
      user: meta.user || 'unknown',
      displayName: meta.displayName || '',
      role: meta.role || '',
      entity: PL_SHEET_BASE,
      action: 'plImportMonth',
      rowsAffected: rows.length,
      summary: 'นำเข้า P&L เดือน ' + month + ' (' + audit + ') · เพิ่มใหม่ ' + res.created + ' · อัปเดต ' + res.updated + ' · เคลียร์บัญชีหาย ' + (res.cleared ? res.cleared.length : 0),
    });
  } catch (e) { /* ignore */ }

  return {
    ok: true,
    month: month,
    audit: audit,
    imported: rows.length,
    created: res.created,
    updated: res.updated,
    cleared: res.cleared || [],   // บัญชีที่หายจากไฟล์ใหม่ → ถูกเคลียร์ยอดเดือนนี้
  };
}

/* upsert: เขียนยอดของเดือน `month` ลงคอลัมน์ m{month} ใน 'ฐาน DATA'
 * - ถ้ามี code อยู่แล้ว → ทับเฉพาะเดือนนั้น (เดือนอื่นไม่แตะ), อัปเดต name/group ถ้ายังว่าง
 * - ถ้าเป็น code ใหม่ → append แถวใหม่ พร้อมยอดเฉพาะเดือนนั้น
 */
function plUpsertBase_(ss, month, rows) {
  var sh = ss.getSheetByName(PL_SHEET_BASE);
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var col = {};
  headers.forEach(function (h, i) { col[String(h).trim()] = i; });
  var cCode = col['code'], cName = col['name'], cGroup = col['group'], cUpd = col['updatedAt'];
  var cMonth = col['m' + month];
  if (cMonth === undefined || cCode === undefined) {
    throw new Error("'ฐาน DATA' ขาดคอลัมน์ที่จำเป็น (code / m" + month + ') — รัน setupPnLSheets() ก่อน');
  }

  // index แถวที่มีอยู่ตาม code
  var rowByCode = {};
  for (var i = 1; i < values.length; i++) {
    var code = String(values[i][cCode] || '').trim();
    if (code) rowByCode[code] = i; // เก็บ index แถวใน values (0-based ใน array)
  }

  var now = new Date();
  var created = 0, updated = 0;
  var appendRows = [];
  var fileCodes = {};

  rows.forEach(function (r) {
    fileCodes[r.code] = 1;
    var idx = rowByCode[r.code];
    if (idx !== undefined) {
      values[idx][cMonth] = r.amount;
      if (cName !== undefined && !String(values[idx][cName] || '').trim() && r.name) values[idx][cName] = r.name;
      if (cGroup !== undefined && !String(values[idx][cGroup] || '').trim() && r.group) values[idx][cGroup] = r.group;
      if (cUpd !== undefined) values[idx][cUpd] = now;
      updated++;
    } else {
      var row = new Array(headers.length).fill('');
      if (cGroup !== undefined) row[cGroup] = r.group;
      row[cCode] = r.code;
      if (cName !== undefined) row[cName] = r.name;
      row[cMonth] = r.amount;
      if (cUpd !== undefined) row[cUpd] = now;
      appendRows.push(row);
      created++;
    }
  });

  // ยึดไฟล์ใหม่: บัญชีที่เคยมียอดเดือนนี้ แต่ไม่อยู่ในไฟล์ใหม่ → เคลียร์ m{month} = 0
  // (กันยอดค้างจาก import ครั้งก่อน เช่นบัญชีพัก 7900002) + เก็บรายการไว้ฟ้องผู้ใช้
  var cleared = [];
  for (var j = 1; j < values.length; j++) {
    var c = String(values[j][cCode] || '').trim();
    if (!c || fileCodes[c]) continue;
    var prev = Number(values[j][cMonth]) || 0;
    if (Math.abs(prev) > 0.005) {
      values[j][cMonth] = 0;
      if (cUpd !== undefined) values[j][cUpd] = now;
      cleared.push({ code: c, name: cName !== undefined ? String(values[j][cName] || '') : '', amount: prev });
    }
  }

  // เขียนกลับเฉพาะส่วน data (แถว 2 เป็นต้นไป) — เขียนเมื่อมีการแก้ (update หรือ clear)
  if ((updated || cleared.length) && values.length > 1) {
    sh.getRange(2, 1, values.length - 1, headers.length).setValues(values.slice(1));
  }
  if (appendRows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, appendRows.length, headers.length).setValues(appendRows);
  }
  return { created: created, updated: updated, cleared: cleared };
}

/* เดากลุ่มจาก prefix ของรหัสบัญชี (ตรงกับ PL_inferGroup ใน frontend) */
function plInferGroup_(code) {
  var s = String(code || '').replace(/[^0-9]/g, '');
  if (!s) return '';
  var p2 = s.slice(0, 2);
  var map = {
    '41': 'saleGoods', '42': 'service', '43': 'service', '49': 'otherIncome',
    '51': 'cogs', '52': 'costService', '53': 'commission',
    '54': 'selling', '55': 'admin', '56': 'finance',
  };
  if (map[p2]) return map[p2];
  if (s.charAt(0) === '4') return 'otherIncome';
  if (s.charAt(0) === '5') return 'admin';
  return '';
}

/* สร้างแท็บถ้ายังไม่มี — ถ้ามีแล้วไม่แตะข้อมูล (เติม header เฉพาะกรณีว่างเปล่า) */
function plEnsureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var hr = sh.getRange(1, 1, 1, headers.length);
    hr.setValues([headers]);
    hr.setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff').setFontSize(10);
    sh.setFrozenRows(1);
    return { sheet: sh, created: true };
  }
  // ชีตมีอยู่แล้ว แต่ยังไม่มี header → เติมให้ (ไม่ทับข้อมูลที่มี)
  if (sh.getLastRow() === 0) {
    var hr2 = sh.getRange(1, 1, 1, headers.length);
    hr2.setValues([headers]);
    hr2.setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff').setFontSize(10);
    sh.setFrozenRows(1);
  }
  return { sheet: sh, created: false };
}

/* ── SETUP — รันครั้งเดียวหลัง deploy ────────────────────────────────
 * สร้างแท็บ 'DATA INPUT' + 'ฐาน DATA' (ถ้ายังไม่มี) — ปลอดภัยต่อการรันซ้ำ
 * ไม่เคยลบ/ทับชีตหรือข้อมูลเดิม
 * ──────────────────────────────────────────────────────────────────── */
function setupPnLSheets() {
  var ss = _ss();
  var a = plEnsureSheet_(ss, PL_SHEET_INPUT, PL_INPUT_HEADERS);
  var b = plEnsureSheet_(ss, PL_SHEET_BASE, PL_BASE_HEADERS);
  var msg = [
    PL_SHEET_INPUT + ': ' + (a.created ? 'สร้างใหม่' : 'มีอยู่แล้ว (ข้าม)'),
    PL_SHEET_BASE + ': ' + (b.created ? 'สร้างใหม่' : 'มีอยู่แล้ว (ข้าม)'),
  ];
  Logger.log(msg.join('\n'));
  return { input: a.created, base: b.created, message: msg };
}
