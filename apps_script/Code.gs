/****************************************************************************************
 * Water POG — Financial Dashboard · Google Apps Script Backend  (v3)
 * ----------------------------------------------------------------------------------------
 * วิธีติดตั้ง (ทำครั้งเดียว):
 * 1) สร้าง Google Sheet ใหม่ในโฟลเดอร์ที่ต้องการ
 * 2) เมนู Extensions → Apps Script → วางโค้ดนี้ทั้งหมด → Ctrl+S
 * 3) รีเฟรชหน้า Sheets → เมนู "💧 Water POG" จะปรากฏ
 * 4) "💧 Water POG" → "① สร้างชีตเปล่า (พร้อมกรอกข้อมูลจริง)"
 * 5) Deploy → New deployment → Web app
 *      Execute as: Me  |  Who has access: Anyone
 * 6) Copy URL → วางใน app/config.js ช่อง APPS_SCRIPT_URL
 ****************************************************************************************/

/* ── 0. SHEET NAMES ────────────────────────────────────────────── */
var SHEETS = {
  META:          'meta',
  PIPELINE:      'pipeline',
  WARROOM_P1:    'warroomP1',
  WARROOM_P2:    'warroomP2',
  YTD_REVENUE:   'ytdRevenue',
  WEEKLY_RECV:   'weeklyExpectedReceipt',
  MONTHLY_FCST:  'monthlyForecast',
  DAILY:         'daily',
  DAILY_INV:     'daily_invoicesToday',
  CASHFLOW:      'cashFlow',
  CF_INFLOW:     'cf_inflow',
  CF_OUTFLOW:    'cf_outflow',
  PROJECTS:      'projects',
  INVOICES:      'invoices',
  FORECAST_E:    'forecastEntries',
  BANK:          'bankAccounts',
  PV_VOUCHERS:   'pvVouchers',
  PAYABLES:      'payables',
  DEBT_LEDGER:   'debtLedger',
  RECEIPTS:      'receipts',
  BANK_ENTRIES:  'bankEntries',
  CHECKS:        'checks',
  AUDIT_LOG:     'auditLog',
  USERS:         'users',
  BANK_RECON_LINES: 'bankReconLines',   // กระทบยอด: รายการเดินบัญชีจาก statement
  BANK_RECON_STATE: 'bankReconState',   // กระทบยอด: สถานะการกระทบ (lineId → decision)
  PRESENCE:         'presence',         // ใครออนไลน์อยู่ (heartbeat) — NOT audited (1 แถว/user)
};

// ── เวอร์ชันเซิร์ฟเวอร์ — bump ทุกครั้งที่ deploy (ดูคำอธิบายใน Code.standalone.gs) ──
// client ping ค่านี้ตอนเปิดแอป → เห็นชัดว่าเซิร์ฟเวอร์เวอร์ชันไหนรันจริง (กันลืม redeploy)
var SERVER_VERSION = '20260615a-presence';

/* ── 1. MENU ────────────────────────────────────────────────────── */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💧 Water POG')
    .addItem('① สร้างชีตเปล่า (พร้อมกรอกข้อมูลจริง)',   'initEmpty')
    .addItem('② สร้างชีตพร้อมข้อมูลตัวอย่าง (Demo)',     'initWorkbook')
    .addItem('③ ล้างข้อมูลทั้งหมด (Wipe)',                'wipeAll')
    .addSeparator()
    .addItem('🔗 แสดง URL ของ Spreadsheet นี้',           'showSheetUrl')
    .addItem('🔗 แสดง Web App URL (หลัง Deploy)',         'showWebAppUrl')
    .addSeparator()
    .addItem('🧪 ทดสอบ getAll() ใน Log',                  'testGetAll')
    .addToUi();
}

function showSheetUrl() {
  var url = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  SpreadsheetApp.getUi().alert(
    '📋 URL ของ Google Sheet นี้:\n\n' + url +
    '\n\n👉 บุ๊กมาร์กไว้ได้เลย — เข้ามาแก้ข้อมูลได้โดยตรงในแต่ละ Sheet'
  );
}
function showWebAppUrl() {
  var url = ScriptApp.getService().getUrl() || '(ยังไม่ได้ Deploy — ทำขั้นตอน Deploy ก่อน)';
  SpreadsheetApp.getUi().alert('🌐 Web App URL:\n\n' + url + '\n\n👉 คัดลอกไปใส่ใน app/config.js ช่อง APPS_SCRIPT_URL');
}
function testGetAll() { Logger.log(JSON.stringify(getAll(), null, 2)); }

/* ── 2. WEB APP ENDPOINTS ───────────────────────────────────────── */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getAll';
    var result = (action === 'ping')   ? { ok: true }
               : (action === 'getAll') ? getAll()
               : (action === 'get')    ? getEntity(e.parameter.entity)
               : { error: 'unknown action: ' + action };
    return respond(result, e);
  } catch (err) {
    return respond({ error: String(err && err.message || err) }, e);
  }
}

function doPost(e) {
  var lock = null;
  try {
    var body    = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    var action  = body.action;
    var entity  = body.entity;
    var payload = body.payload || {};
    var id      = body.id;
    var meta    = body.meta || {};

    // ── เข้าคิวกันเขียนชนกัน (LockService) — ดูคำอธิบายเต็มใน Code.standalone.gs ──
    // action ที่เขียนต้องถือ lock ก่อน → write สองอันวิ่งพร้อมกันไม่ได้ = กัน lost-update
    var MUTATING = { add:1, update:1, 'delete':1, replaceAll:1, applyDiff:1,
                     setKV:1, plImportMonth:1, budgetImportMonth:1 };
    if (MUTATING[action]) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }

    var result;
    switch (action) {
      case 'getAll':     result = getAll();                        break;
      case 'add':        result = addRow(entity, payload);         break;
      case 'update':     result = updateRow(entity, id, payload);  break;
      case 'delete':     result = deleteRow(entity, id);           break;
      case 'replaceAll': result = replaceAll(entity, payload, body.baseIds, { allowShrink: body.allowShrink === true }); break;
      case 'applyDiff':  result = applyDiff(entity, body.upserts, body.deletes, body.baseIds, { allowShrink: body.allowShrink === true }); break;  // ★ row-level + server guard
      case 'setKV':      result = setKV(entity, payload);          break;
      case 'plImportMonth':     result = plImportMonth(body);      break;  // P&L add-on (ดู PnL.additions.gs)
      case 'budgetImportMonth': result = budgetImportMonth(body);  break;  // Budget Control add-on (ดู Budget.additions.gs)
      default: result = { error: 'unknown action: ' + action };
    }
    if (!result || !result.error) {
      try {
        if ((action === 'add' || action === 'update' || action === 'delete' ||
            action === 'replaceAll' || action === 'applyDiff') &&
            entity !== 'presence') {   // ★ presence = heartbeat ออนไลน์ ไม่ต้องลง audit (กัน log รก)
          appendAuditLog_({
            timestamp: new Date(),
            user: meta.user || 'unknown',
            displayName: meta.displayName || '',
            role: meta.role || '',
            entity: entity || '',
            action: action,
            rowsAffected: (action === 'applyDiff')
              ? ((body.upserts || []).length + (body.deletes || []).length)
              : (Array.isArray(payload) ? payload.length : (id ? 1 : 0)),
            summary: meta.diffSummary || '',
          });
        }
      } catch (logErr) { /* never block CRUD on audit log failure */ }
    }
    return respond(result, e);
  } catch (err) {
    return respond({ error: String(err && err.message || err) }, e);
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (_) {} }
  }
}

// Append one row to the auditLog sheet (creates sheet+header if missing)
function appendAuditLog_(entry) {
  var ss = _ss();
  var sh = ss.getSheetByName(SHEETS.AUDIT_LOG);
  var headers = ['timestamp', 'user', 'displayName', 'role', 'entity', 'action', 'rowsAffected', 'summary'];
  if (!sh) {
    sh = ss.insertSheet(SHEETS.AUDIT_LOG);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f0f4f8');
    sh.setFrozenRows(1);
  }
  sh.appendRow(headers.map(function (h) {
    if (h === 'timestamp') return entry.timestamp || new Date();
    return entry[h] != null ? entry[h] : '';
  }));
}

function respond(obj, e) {
  // stamp serverVersion บน response ที่เป็น object (ไม่แตะ array) → client เห็นเวอร์ชันจริง
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    try { obj.serverVersion = SERVER_VERSION; } catch (_) {}
  }
  var cb = e && e.parameter && e.parameter.callback;
  var out = ContentService.createTextOutput(
    cb ? cb + '(' + JSON.stringify(obj) + ')' : JSON.stringify(obj)
  );
  out.setMimeType(cb ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
  return out;
}

/* ── 3. READ — getAll / getEntity ───────────────────────────────── */
function getAll() {
  return {
    meta:                  readKV(SHEETS.META),
    pipeline:              readKV(SHEETS.PIPELINE),
    warroomP1:             readWarroomP1_(),
    warroomP2:             readWarroomP2_(),
    ytdRevenue:            readTable(SHEETS.YTD_REVENUE),
    weeklyExpectedReceipt: readTable(SHEETS.WEEKLY_RECV),
    monthlyForecast:       readTable(SHEETS.MONTHLY_FCST),
    daily:                 readDaily_(),
    cashFlow:              readCashFlow_(),
    projects:              readTable(SHEETS.PROJECTS),
    invoices:              readTable(SHEETS.INVOICES),
    forecastEntries:       readTable(SHEETS.FORECAST_E),
    bankAccounts:          readTable(SHEETS.BANK),
    pvVouchers:            readTable(SHEETS.PV_VOUCHERS),
    payables:              readTable(SHEETS.PAYABLES),
    debtLedger:            readTable(SHEETS.DEBT_LEDGER),
    receipts:              readTable(SHEETS.RECEIPTS),
    bankEntries:           readTable(SHEETS.BANK_ENTRIES),
    checks:                readTable(SHEETS.CHECKS),
  };
}

function getEntity(name) {
  switch (name) {
    case 'meta':                  return readKV(SHEETS.META);
    case 'pipeline':              return readKV(SHEETS.PIPELINE);
    case 'warroomP1':             return readWarroomP1_();
    case 'warroomP2':             return readWarroomP2_();
    case 'daily':                 return readDaily_();
    case 'cashFlow':              return readCashFlow_();
    case 'ytdRevenue':            return readTable(SHEETS.YTD_REVENUE);
    case 'weeklyExpectedReceipt': return readTable(SHEETS.WEEKLY_RECV);
    case 'monthlyForecast':       return readTable(SHEETS.MONTHLY_FCST);
    case 'projects':              return readTable(SHEETS.PROJECTS);
    case 'invoices':              return readTable(SHEETS.INVOICES);
    case 'forecastEntries':       return readTable(SHEETS.FORECAST_E);
    case 'bankAccounts':          return readTable(SHEETS.BANK);
    case 'pvVouchers':            return readTable(SHEETS.PV_VOUCHERS);
    case 'payables':              return readTable(SHEETS.PAYABLES);
    case 'debtLedger':            return readTable(SHEETS.DEBT_LEDGER);
    case 'receipts':              return readTable(SHEETS.RECEIPTS);
    case 'bankEntries':           return readTable(SHEETS.BANK_ENTRIES);
    case 'checks':                return readTable(SHEETS.CHECKS);
    case 'bankReconLines':        return readTable(SHEETS.BANK_RECON_LINES);
    case 'bankReconState':        return readTable(SHEETS.BANK_RECON_STATE);
    case 'presence':              return readTable(SHEETS.PRESENCE);
  }
  return { error: 'unknown entity: ' + name };
}

/* ── 4. TABLE I/O ───────────────────────────────────────────────── */
// ใช้ active spreadsheet ถ้ามี (สคริปต์ผูกกับชีต) มิฉะนั้น fallback openById
// → ทำงานได้ทั้ง bound และ standalone · กัน getActiveSpreadsheet() = null
// (เช่นในบาง context ของ web app) ที่ทำให้ plImportMonth ฯลฯ พังด้วย null
var SHEET_ID_FALLBACK = '1Q0enboLihOYiYCn7otK9zXBlk6Yy8oHfoAXaFnGujwA';
function _ss() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (_) {}
  if (!ss && SHEET_ID_FALLBACK) { try { ss = SpreadsheetApp.openById(SHEET_ID_FALLBACK); } catch (_) {} }
  return ss;
}
function _sh(name) {
  var sh = _ss().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต: ' + name);
  return sh;
}

var JSON_FIELDS = {
  projects:       [],   // flat columns — no JSON blobs
  invoices:       ['followUps', 'actualReceive'],
  forecastEntries:[],
  bankAccounts:   [],
  pvVouchers:     [],
  payables:       [],
  debtLedger:     [],
  receipts:       [],
  bankEntries:    [],
  checks:         [],
  bankReconLines: [],
  bankReconState: [],
  presence:       [],
};

function readTable(name) {
  var sh = _ss().getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var jsonCols = JSON_FIELDS[name] || [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    var obj = {};
    headers.forEach(function (h, j) {
      if (!h) return;
      var v = row[j];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      if (v === '') v = null;
      if (jsonCols.indexOf(h) >= 0 && typeof v === 'string' && v.length > 1) {
        try { v = JSON.parse(v); } catch (_) {}
      }
      obj[h] = v;
    });
    out.push(obj);
  }
  return out;
}

function writeTable(name, headers, rows) {
  var sh = _ss().getSheetByName(name) || _ss().insertSheet(name);
  sh.clear();
  // Header row with styling
  var headerRange = sh.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  headerRange.setFontSize(10);
  if (rows.length) {
    var jsonCols = JSON_FIELDS[name] || [];
    var data = rows.map(function (r) {
      return headers.map(function (h) {
        var v = r[h];
        if (v === undefined || v === null) return '';
        if (jsonCols.indexOf(h) >= 0 && typeof v === 'object') {
          return JSON.stringify(v);
        }
        return v;
      });
    });
    sh.getRange(2, 1, data.length, headers.length).setValues(data);
  }
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, headers.length);
  // Alternate row colors
  if (rows.length > 0) {
    for (var i = 2; i <= rows.length + 1; i++) {
      if (i % 2 === 0) {
        sh.getRange(i, 1, 1, headers.length).setBackground('#f8f9fa');
      }
    }
  }
}

function appendRow_(name, headers, obj) {
  var sh = _sh(name);
  var jsonCols = JSON_FIELDS[name] || [];
  var row = headers.map(function (h) {
    var v = obj[h];
    if (v === undefined || v === null) return '';
    if (jsonCols.indexOf(h) >= 0 && typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  sh.appendRow(row);
  return obj;
}

/* ── 5. KEY/VALUE I/O ───────────────────────────────────────────── */
function readKV(name) {
  var sh = _ss().getSheetByName(name);
  if (!sh) return {};
  var values = sh.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < values.length; i++) {
    var k = values[i][0]; var v = values[i][1];
    if (!k) continue;
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    out[k] = v;
  }
  return out;
}

function writeKV(name, obj) {
  var sh = _ss().getSheetByName(name) || _ss().insertSheet(name);
  sh.clear();
  var headerRange = sh.getRange(1, 1, 1, 2);
  headerRange.setValues([['key','value']]);
  headerRange.setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  var rows = Object.keys(obj).map(function (k) { return [k, obj[k]]; });
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 2);
}

function setKV(name, patch) {
  var cur = readKV(name);
  Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
  writeKV(name, cur);
  return cur;
}

/* ── 6. SPECIAL READERS ─────────────────────────────────────────── */
function readWarroomP1_() {
  var kv = readKV(SHEETS.WARROOM_P1);
  return {
    topKpis: {
      totalInvoices:       num(kv.topKpis_totalInvoices),
      estimatedCashInflow: num(kv.topKpis_estimatedCashInflow),
      estimatedDebt:       num(kv.topKpis_estimatedDebt),
      netProjection:       num(kv.topKpis_netProjection),
    },
    thisMonthNetProjection: num(kv.thisMonthNetProjection),
    nextMonthNetProjection: num(kv.nextMonthNetProjection),
    outstandingSummary: {
      systemTotal:       JSON.parse(kv.outstandingSummary_systemTotal       || '{}'),
      thisMonthTracked:  JSON.parse(kv.outstandingSummary_thisMonthTracked  || '{}'),
      nextMonthRollover: JSON.parse(kv.outstandingSummary_nextMonthRollover || '{}'),
    },
    outstandingThisMonthByTransfer: JSON.parse(kv.outstandingThisMonthByTransfer || '[]'),
    outstandingThisMonthTotal:      JSON.parse(kv.outstandingThisMonthTotal      || '{}'),
    outstandingByTransfer:          JSON.parse(kv.outstandingByTransfer          || '[]'),
    outstandingTotal:               JSON.parse(kv.outstandingTotal               || '{}'),
    wipByTransfer:                  JSON.parse(kv.wipByTransfer                  || '[]'),
    wipTotal:                       JSON.parse(kv.wipTotal                       || '{}'),
  };
}

function readWarroomP2_() {
  var kv = readKV(SHEETS.WARROOM_P2);
  return {
    totalProjectValue:   num(kv.totalProjectValue),
    invoiceForwardTotal: num(kv.invoiceForwardTotal),
    wipValue:            num(kv.wipValue),
    unsignedTotal:       JSON.parse(kv.unsignedTotal || '{}'),
    signedTotal:         JSON.parse(kv.signedTotal   || '{}'),
  };
}

function readDaily_() {
  var kv = readKV(SHEETS.DAILY);
  return {
    asOfDate:   kv.asOfDate   || '',
    ytdAccum:   JSON.parse(kv.ytdAccum   || '{}'),
    mtdAccum:   JSON.parse(kv.mtdAccum   || '{}'),
    todayAccum: JSON.parse(kv.todayAccum || '{}'),
    invoicesToday: readTable(SHEETS.DAILY_INV),
  };
}

function readCashFlow_() {
  var kv = readKV(SHEETS.CASHFLOW);
  return {
    month:        kv.month      || '',
    bf:           num(kv.bf),
    planTotal:    num(kv.planTotal),
    actualPaid:   num(kv.actualPaid),
    paidPct:      num(kv.paidPct),
    revInflow:    num(kv.revInflow),
    loanReceived: num(kv.loanReceived),
    loanLine:     num(kv.loanLine),
    loanRemain:   num(kv.loanRemain),
    finalNet:     num(kv.finalNet),
    nowWeek:      num(kv.nowWeek),
    closing:      JSON.parse(kv.closing || '[]'),
    inflow:       readTable(SHEETS.CF_INFLOW).map(function (r) {
      return { key:r.key, label:r.label, actual:tryParse(r.actual,[]), plan:tryParse(r.plan,[]) };
    }),
    outflow: readTable(SHEETS.CF_OUTFLOW).map(function (r) {
      return { key:r.key, label:r.label, actual:tryParse(r.actual,[]), plan:tryParse(r.plan,[]) };
    }),
  };
}

function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function tryParse(v, def) {
  if (!v) return def;
  try { return JSON.parse(v); } catch (_) { return def; }
}

/* ── 7. CRUD per entity ─────────────────────────────────────────── */
var ENTITY_HEADERS = {

  // ── projects: ตรงกับ "Main all*" sheet ใน Project Control.xlsx (full 120+ cols) ──
  // ขยายจาก 35 → ครบทุกคอลัมน์วิศวกร เพื่อให้ข้อมูลงวด/ส่งมอบ/ตรวจรับ/Summary/%
  // sync ถึงทุกเครื่อง (เดิม snapshot 120 คอลัมน์อยู่แค่ใน localStorage เครื่องที่อัป)
  projects: [
    'id',
    'No.','Tender No.','Project No.','เลขที่สัญญา WTP-SUB','Contract No.',
    'พื้นที่','Type','งานก่อสร้าง','ก่อสร้างจริง','งานขาย','Region','Province',
    'Start','Finish','Timeline','Duration','จำนวนวันที่โดนปรับจริง',
    'กำหนดส่งมอบงานงวด 1','ระยะเวลาก่อสรางจริง (วัน)','งบประมาณ','Ref.code','เงินตามใบจัดสรร',
    'ประกาศผู้ชนะ','เซ็นสัญญา','เลขที่สัญญา','ยกเลิกโครงการ',
    'สัญญา-Subcontract','PR-Subcontract','PR Consult',
    'มูลค่าสัญญาที่เซ็น','มูลค่าสัญญาที่เซ็น (รวมVAT)',
    '% งวด 1','% งวด 2','มูลค่า งวด 1','มูลค่า งวด 2',
    '% ค่าปรับต่อวัน','บาท/วัน','ระยะเวลาการรับประกัน','แบบแปลน ver.','ฝั่งเดียว','สองฝั่ง','Customer',
    'งานเสาเข็ม','ความยาวเสาเข็ม (m)','จำนวนเสาเข็ม ACFS TANK','จำนวนเสาเข็ม ACC TANK',
    'จำนวนเสาเข็ม UFS TANK','จำนวนเสาเข็ม PF TANK','มูลค่างานเพิ่มเสาเข็ม',
    '1.งานทดสอบการรับน้ำหนักบรรทุกดิน และงานเสาเข็ม (10%)','ขั้น 1 วันที่แล้วเสร็จ',
    '2.งานฐานราก (10%)','ขั้น 2 วันที่แล้วเสร็จ',
    '3.งาน PnP  (20%)','ขั้น 3 วันที่แล้วเสร็จ',
    '4.งาน ACFS, SFX และงานระบบ (50%)','ขั้น 4 วันที่แล้วเสร็จ',
    '5.งาน Commissioning Test & Jar Test (10%)','ขั้น 5 วันที่แล้วเสร็จ',
    '% (POG+STANK)',
    '1. งานฐานพื้นคอนกรีต (10%)','ขั้น 1 วันที่แล้วเสร็จ2',
    '2.1 งานติดตั้ง RO (50%)','2.2 งานติดตั้งโรงเรือน RO (20%)','2.3 งานประสานระบบไฟฟ้าและระบบประปา (10%)','ขั้น 2 วันที่แล้วเสร็จ2',
    '3 งาน Commissioning Test (10%)','ขั้น 3 วันที่แล้วเสร็จ2',
    '% (POG DRINK)',
    'นส.ส่งมอบงาน งวด 1','วันที่ส่ง นส.มอบงาน งวด 1','วันที่ส่งมอบงาน งวด 1',
    'นส.ส่งมอบงาน งวด 2','วันที่ส่ง นส.มอบงาน งวด 2','วันที่ส่งมอบงาน งวด 2',
    'นส.ส่งมอบงาน งวด 3','วันที่ส่ง นส.มอบงานงวด 3','วันที่ส่งมอบงานงวด 3',
    'ใบตรวจรับการจัดซื้อ/จัดจ้าง งวด 1','วันที่เซ็น/รับ ใบตรวจรับ งวดที่ 1',
    'ใบตรวจรับการจัดซื้อ/จัดจ้าง งวด 2','วันที่เซ็น/รับ ใบตรวจรับ งวดที่ 2',
    'Payment 1','Summary Payment 1','Payment 1 Status','Receive Date',
    'Payment 2','Summary Payment 2','Payment 2 Status','Receive Date2',
    'Payment 3','Summary Payment 3','Payment 3 Status','Receive Date3',
    'TOTAL','Receive','BOQ','Forecast Income งวด 1','Forecast Income งวด 2',
    'หยุดเวลา','แจ้งเข้าดำเนินการ','ขยายเวลา','แนบท้ายสัญญา','แนบท้ายสัญญา-Subcontract','วันที่แนบท้ายสัญญา-Subcontract',
    'ไฟล์สำรวจโครงการ','Close Project','Google Map URL','ผู้รับโอนสิทธิ์',
    'ขั้น 1','ขั้น 2','ขั้น 3','ขั้น 4','ขั้น 5','รับรู้รายได้',
    '% Progress','Remark','จำนวนเสาเข็ม ACFS','วันที่เซ็น/รับ ใบตรวจรับ งวด 2',
    'สถานะโครงการ','ภาระหนี้',
    'status','expectedPay1','expectedPay2',
  ],

  // ── invoices: schema คงเดิม (มี tracking fields พิเศษ) ────────────────
  invoices: [
    'id','ivNo','jobNo','period','invoiceDate','balance',
    'status','expectedReceive','contactName','contactPhone',
    'followUps','actualReceive',
    // v2 fields parsed from "Olddata IV" (added 2026-05-23)
    'projectCode','projectName','customerCode','customerName',
    'dueDate','assignee','contractor','category',
    'actualReceiveDate','currentStatus','arNo','docType','refCode',
    // v3 fields (added 2026-05-26) — admin override + invType + remark
    'invType','debtOverride','assigneeOverride','remark','productType','contractRef'
  ],

  // ── forecastEntries: ตรงกับ RAW_MANUAL_EXPENSE ────────────────────────
  forecastEntries: [
    'id','DATE','PAYMENT_DATE','EXPENSE_TYPE','DESCRIPTION','JOB_NO',
    'PROJECT_NAME','AMOUNT','Bank_AC','STATUS','CATEGORY','IS_ACCRUED','NOTE',
    'ACTUAL_AMOUNT','ACTUAL_DATE','REF_DOC','BOOKED_AT','CFS_ACTIVITY'
  ],

  // ── bankAccounts: ตรงกับ RAW_BANK_BALANCE ─────────────────────────────
  bankAccounts: [
    'id','DATE','BANK_NAME','Bank_AC','BALANCE','AVAILABLE_BALANCE','HOLD_AMOUNT','NOTE'
  ],

  // ── pvVouchers: ตรงกับ RAW_PV_PAYMENT ────────────────────────────────
  pvVouchers: [
    'id','Project_Dpt','Ref_Code','PL_PV_No','jobcode','Pmt_Date','Type_of_Pmt','Option',
    'Payee','Type','AP_No','vchdate','Chq_No','Chq_Date','Bnf_Acct_No','Bnf_Bank',
    'Bank_AC','Bank_Id','Remark','cc_remark','Amount','Down_payment','Deduct',
    'Vat','Ret','Before_WHT','WHT','Less_Other','Total','Minus_Other','Net_Amount'
  ],

  // ── payables: ตรงกับ RAW_AP_OUTSTANDING (เฉพาะ column ที่ใช้งาน) ──────
  payables: [
    'id','docno','vchno','vchdate','refno','due','due2','remark',
    'Amount','VAT','net_new','WHT_EMP','Less_Other','Balance_Amount2',
    'Less_Ret','Balance_Amount1','netpayment','refcode','jobcode',
    'jobname','dpt_code','dpt_name','acct_no','cust_name','vendor_group','vendor_group2'
  ],

  // ── debtLedger: ภาระหนี้ทั้งหมด (โอนสิทธิ + OD + PN + สินเชื่อ) ───
  debtLedger: [
    'id','debtNo','debtType','linkedProjectCode','bankName','accountRef',
    'principalAmount','drawdownDate','maturityDate',
    'interestRate','interestBasis','outstandingBalance',
    'collateral','status','note'
  ],

  // ── receipts: ประวัติรับเงิน ────────────────────────────────────────
  receipts: [
    'id','receiptNo','receiptDate','invoiceNo','projectCode','projectName','period',
    'grossAmount','transferDeduction','netReceived','bankAccount','note',
    // v3 field (added 2026-05-26) — override invoice's invType per receipt
    'invType'
  ],

  // ── bankEntries: รายการเคลื่อนไหวบัญชีธนาคาร (แผน/ข้อเท็จจริง) ─────
  bankEntries: [
    'id','entryDate','bankName','accountNo','entryType','description',
    'amount','referenceNo','transferRef','linkedProjectCode','status','note'
  ],

  // ── checks: เช็คจ่ายล่วงหน้า ────────────────────────────────────────
  checks: [
    'id','checkNo','checkDate','payee','amount','bankName','accountNo',
    'referenceNo','linkedProjectCode','status','note'
  ],

  // ── bankReconLines: รายการเดินบัญชีจาก statement (กระทบยอด · flat rows) ──
  bankReconLines: [
    'id','accountNo','ym','date','amount','desc','ref','balance','idx'
  ],

  // ── bankReconState: สถานะการกระทบยอด (id = lineId → decision/forecastId) ──
  bankReconState: [
    'id','decision','forecastId'
  ],
  // ── presence (added 2026-06-15) — id = username (1 แถว/user, upsert) ──────
  presence: [
    'id','username','displayName','role','lastSeen'
  ],
};

function _entitySheet(entity) {
  var map = {
    projects:       SHEETS.PROJECTS,
    invoices:       SHEETS.INVOICES,
    forecastEntries:SHEETS.FORECAST_E,
    bankAccounts:   SHEETS.BANK,
    pvVouchers:     SHEETS.PV_VOUCHERS,
    payables:       SHEETS.PAYABLES,
    debtLedger:     SHEETS.DEBT_LEDGER,
    receipts:       SHEETS.RECEIPTS,
    bankEntries:    SHEETS.BANK_ENTRIES,
    checks:         SHEETS.CHECKS,
    users:          SHEETS.USERS,
    bankReconLines: SHEETS.BANK_RECON_LINES,
    bankReconState: SHEETS.BANK_RECON_STATE,
    presence:       SHEETS.PRESENCE,
  };
  if (!map[entity]) throw new Error('CRUD ไม่รองรับ entity: ' + entity);
  return { name: map[entity], headers: ENTITY_HEADERS[entity] };
}

function newId_() { return 'id_' + Utilities.getUuid().slice(0, 8); }

function addRow(entity, payload) {
  var e = _entitySheet(entity);
  if (!payload.id) payload.id = newId_();
  appendRow_(e.name, e.headers, payload);
  return payload;
}

function updateRow(entity, id, patch) {
  var e = _entitySheet(entity);
  var sh = _sh(e.name);
  var values = sh.getDataRange().getValues();
  var idCol  = e.headers.indexOf('id');
  var jsonCols = JSON_FIELDS[entity] || [];
  for (var i = 1; i < values.length; i++) {
    if (values[i][idCol] === id) {
      e.headers.forEach(function (h, j) {
        if (patch[h] === undefined) return;
        var v = patch[h];
        if (jsonCols.indexOf(h) >= 0 && typeof v === 'object') v = JSON.stringify(v);
        values[i][j] = v;
      });
      sh.getRange(i + 1, 1, 1, e.headers.length).setValues([values[i]]);
      var obj = {};
      e.headers.forEach(function (h, j) { obj[h] = values[i][j]; });
      return obj;
    }
  }
  throw new Error('ไม่พบ id ' + id + ' ใน ' + entity);
}

function deleteRow(entity, id) {
  var e = _entitySheet(entity);
  var sh = _sh(e.name);
  var values = sh.getDataRange().getValues();
  var idCol  = e.headers.indexOf('id');
  for (var i = 1; i < values.length; i++) {
    if (values[i][idCol] === id) {
      sh.deleteRow(i + 1);
      return { ok: true, id: id };
    }
  }
  throw new Error('ไม่พบ id ' + id + ' ใน ' + entity);
}

/* applyDiff — ROW-LEVEL sync: แก้เฉพาะแถวที่เปลี่ยน ไม่เขียนทับทั้งตาราง (2026-06-08)
 * ดูคำอธิบายเต็มใน Code.standalone.gs — สรุป: client ส่งแค่ upserts (แถวที่เพิ่ม/แก้)
 * + deletes (id ที่ลบ). เซิร์ฟเวอร์อ่านชีตสดใต้ lock แล้วแตะเฉพาะแถวที่ระบุ —
 * แถวอื่นคงไว้เป๊ะตามชีต → สำเนาเก่าของ client ทับงานแถวอื่นไม่ได้ (ยาแก้ clobber).
 * คืน { entity, rows } = สถานะจริงหลังเขียน → client ใช้เป็น read-your-writes.
 */
function applyDiff(entity, upserts, deletes, baseIds, opts) {
  var e = _entitySheet(entity);
  opts = opts || {};
  upserts = Array.isArray(upserts) ? upserts : [];
  deletes = Array.isArray(deletes) ? deletes : [];
  upserts.forEach(function (r) { if (r && !r.id) r.id = newId_(); });

  var sh = _ss().getSheetByName(e.name);
  var current = sh ? readTable(e.name) : [];

  var deleteSet = {};
  deletes.forEach(function (idv) { if (idv != null) deleteSet[String(idv)] = true; });
  var upsertById = {};
  upserts.forEach(function (r) { if (r && r.id != null) upsertById[String(r.id)] = r; });

  // ★ กันแถว actual (forecastEntries STATUS=ACTUAL) ถูกลบจาก diff หลอก/clobber (ดู Code.standalone.gs)
  var protectActual = (entity === 'forecastEntries' && !opts.allowShrink);
  var out = [];
  current.forEach(function (r) {
    var idStr = (r && r.id != null) ? String(r.id) : '';
    if (idStr && deleteSet[idStr]) {
      if (protectActual && String(r.STATUS || '').toUpperCase() === 'ACTUAL') { out.push(r); return; }  // ★ คงแถว actual ไว้
      return;
    }
    if (idStr && upsertById[idStr]) {
      out.push(_overlayRow(r, upsertById[idStr]));
      delete upsertById[idStr];
      return;
    }
    out.push(r);
  });
  Object.keys(upsertById).forEach(function (k) { out.push(upsertById[k]); });

  var headers = e.headers.slice();
  if (sh && sh.getLastColumn() > 0) {
    var sheetHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (h) { return h == null ? '' : String(h).trim(); })
      .filter(function (h) { return h !== ''; });
    if (sheetHeaders.length) {
      headers = sheetHeaders.slice();
      e.headers.forEach(function (h) { if (headers.indexOf(h) < 0) headers.push(h); });
    }
  }

  // ── เกราะเซิร์ฟเวอร์: ปฏิเสธการล้าง/ลดตารางรุนแรง (ดูคำอธิบายใน Code.standalone.gs) ──
  if (!opts.allowShrink) {
    if (current.length > 0 && out.length === 0) {
      return { error: 'guard_block_empty: ปฏิเสธล้างตาราง ' + entity + ' (' + current.length + '→0). ส่ง allowShrink=true ถ้าตั้งใจจริง' };
    }
    if (current.length >= 10 && out.length < current.length * 0.5) {
      return { error: 'guard_block_shrink: ปฏิเสธลด ' + entity + ' ' + current.length + '→' + out.length + ' (เกินครึ่ง). ส่ง allowShrink=true ถ้าตั้งใจ' };
    }
  }

  writeTable(e.name, headers, out);
  return { entity: entity, rows: out };
}

function _overlayRow(sheetRow, patch) {
  var out = {};
  Object.keys(sheetRow).forEach(function (k) { out[k] = sheetRow[k]; });
  Object.keys(patch).forEach(function (k) { out[k] = patch[k]; });
  return out;
}

/* replaceAll — เขียนทับทั้งตาราง พร้อม "เกราะกันข้อมูลหาย" (base reconcile, 2026-06-06)
 * ดูคำอธิบายเต็มใน Code.standalone.gs — สรุป: client ส่ง baseIds (id ที่เคยเห็น) มาด้วย
 *   - แถวในชีตที่ client ไม่รู้จัก (ไม่อยู่ทั้งใน payload และ baseIds) → เก็บไว้ ไม่ลบ
 *   - แถวที่ client เคยเห็นแล้วตัดออกจาก payload → ลบจริง
 * กัน seed-wipe / อ่านช้ากว่าเขียนแล้วทับ / clobber ข้ามผู้ใช้ ไม่ให้ข้อมูลหายเงียบ ๆ
 */
function replaceAll(entity, rows, baseIds, opts) {
  var e = _entitySheet(entity);
  if (!Array.isArray(rows)) rows = [];
  opts = opts || {};
  rows.forEach(function (r) { if (!r.id) r.id = newId_(); });

  var sh = _ss().getSheetByName(e.name);
  var currentRows = sh ? readTable(e.name) : [];
  var payloadIds = {};
  rows.forEach(function (r) { payloadIds[String(r.id)] = true; });
  var baseKnown = Array.isArray(baseIds);
  var baseSet = {};
  if (baseKnown) baseIds.forEach(function (id) { baseSet[String(id)] = true; });

  var preserved = [];
  for (var i = 0; i < currentRows.length; i++) {
    var r = currentRows[i];
    var idStr = (r && r.id != null) ? String(r.id) : '';
    if (!idStr) continue;
    if (payloadIds[idStr]) continue;
    // ★ กันแถว actual (forecastEntries STATUS=ACTUAL) ถูก replaceAll ลบ แม้ client เคยเห็น (allowShrink ข้ามได้)
    if (entity === 'forecastEntries' && !opts.allowShrink && String(r.STATUS || '').toUpperCase() === 'ACTUAL') { preserved.push(r); continue; }
    if (baseKnown && baseSet[idStr]) continue;
    preserved.push(r);
  }
  var finalRows = rows.concat(preserved);

  if (!opts.allowShrink && currentRows.length > 0 && finalRows.length === 0) {
    return { error: 'guard_block_empty: ปฏิเสธการล้างตาราง ' + entity +
                    ' (' + currentRows.length + '→0). ส่ง allowShrink=true ถ้าตั้งใจ' };
  }
  if (!opts.allowShrink && currentRows.length >= 10 && finalRows.length < currentRows.length * 0.5) {
    return { error: 'guard_block_shrink: ปฏิเสธลด ' + entity + ' ' + currentRows.length + '→' +
                    finalRows.length + ' (เกินครึ่ง). ส่ง allowShrink=true ถ้าตั้งใจ' };
  }

  var headers = e.headers.slice();
  if (sh && sh.getLastColumn() > 0) {
    var sheetHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (h) { return h == null ? '' : String(h).trim(); })
      .filter(function (h) { return h !== ''; });
    if (sheetHeaders.length) {
      headers = sheetHeaders.slice();
      e.headers.forEach(function (h) { if (headers.indexOf(h) < 0) headers.push(h); });
    }
  }

  writeTable(e.name, headers, finalRows);
  return finalRows;
}

/* ── 8. WIPE ────────────────────────────────────────────────────── */
function wipeAll() {
  var ui  = SpreadsheetApp.getUi();
  var ans = ui.alert('⚠️ ยืนยันการล้างข้อมูลทั้งหมด?\n\n(การกระทำนี้ไม่สามารถย้อนกลับได้)', ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;
  Object.values(SHEETS).forEach(function (name) {
    var sh = _ss().getSheetByName(name);
    if (sh) _ss().deleteSheet(sh);
  });
  ui.alert('✅ ล้างเรียบร้อย — พร้อม setup ใหม่ได้เลย');
}

/* ── 9A. INIT EMPTY — สร้างชีตเปล่าพร้อม header (ไม่มีข้อมูลตัวอย่าง) ── */
function initEmpty() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var thisYear = new Date().getFullYear();

  // Meta
  writeKV(SHEETS.META, {
    companyName: 'บริษัท วอเทอร์ป๊อก จำกัด',
    shortName:   'Water POG',
    asOf:        today,
    year:        thisYear,
    currency:    'THB',
  });

  // Pipeline defaults (zeros — แก้ได้ใน Sheet)
  writeKV(SHEETS.PIPELINE, {
    waitingSign:           JSON.stringify({ count:0, gross:0, debt:0, net:0 }),
    signedWip:             JSON.stringify({ count:0, gross:0, debt:0, net:0 }),
    invoicedOutstanding:   JSON.stringify({ count:0, gross:0, debt:0, net:0 }),
    totalProjectValue:     0,
    invoiceBroughtForward: 0,
    signedNotDelivered:    0,
    notSigned:             0,
    totalDebt:             0,
    usableNet:             0,
  });

  // War Room defaults
  writeKV(SHEETS.WARROOM_P1, {
    topKpis_totalInvoices:               0,
    topKpis_estimatedCashInflow:         0,
    topKpis_estimatedDebt:               0,
    topKpis_netProjection:               0,
    thisMonthNetProjection:              0,
    nextMonthNetProjection:              0,
    outstandingSummary_systemTotal:      JSON.stringify({ count:0, gross:0, debt:0, net:0 }),
    outstandingSummary_thisMonthTracked: JSON.stringify({ count:0, gross:0, debt:0, net:0 }),
    outstandingSummary_nextMonthRollover:JSON.stringify({ count:0, gross:0, debt:0, net:0 }),
    outstandingThisMonthByTransfer:      '[]',
    outstandingThisMonthTotal:           JSON.stringify({ count:0, gross:0, debt:0, net:0 }),
    outstandingByTransfer:               '[]',
    outstandingTotal:                    JSON.stringify({ count:0, gross:0, debt:0, net:0 }),
    wipByTransfer:                       '[]',
    wipTotal:                            JSON.stringify({ count:0, gross:0, debt:0, net:0 }),
  });
  writeKV(SHEETS.WARROOM_P2, {
    totalProjectValue:   0,
    invoiceForwardTotal: 0,
    wipValue:            0,
    unsignedTotal:       JSON.stringify({ count:0, value:0 }),
    signedTotal:         JSON.stringify({ count:0, value:0 }),
  });

  // YTD / Weekly / Monthly — headers only, empty rows
  writeTable(SHEETS.YTD_REVENUE,  ['month','en','count','gross','debt','net'], []);
  writeTable(SHEETS.WEEKLY_RECV,  ['week','count','gross','debt','net'], []);
  writeTable(SHEETS.MONTHLY_FCST, ['month','en','pctOfRemaining','invIssued','signed','unsigned','debt','netUsable'], []);

  // Daily
  writeKV(SHEETS.DAILY, {
    asOfDate:   today,
    ytdAccum:   JSON.stringify({ count:0, value:0 }),
    mtdAccum:   JSON.stringify({ count:0, value:0 }),
    todayAccum: JSON.stringify({ count:0, value:0 }),
  });
  writeTable(SHEETS.DAILY_INV, ['id','no','code','name','period','amount','receivedAt'], []);

  // Cash Flow
  writeKV(SHEETS.CASHFLOW, {
    month:'', bf:0, planTotal:0, actualPaid:0, paidPct:0,
    revInflow:0, loanReceived:0, loanLine:0, loanRemain:0, finalNet:0,
    closing: JSON.stringify([0,0,0,0,0]),
    nowWeek: 1,
  });
  writeTable(SHEETS.CF_INFLOW,  ['key','label','actual','plan'], []);
  writeTable(SHEETS.CF_OUTFLOW, ['key','label','actual','plan'], []);

  // ── CRUD tables — headers only, NO sample rows ─────────────────
  writeTable(SHEETS.PROJECTS,     ENTITY_HEADERS.projects,       []);
  writeTable(SHEETS.INVOICES,     ENTITY_HEADERS.invoices,        []);
  writeTable(SHEETS.FORECAST_E,   ENTITY_HEADERS.forecastEntries, []);
  writeTable(SHEETS.BANK,         ENTITY_HEADERS.bankAccounts,    []);
  writeTable(SHEETS.PV_VOUCHERS,  ENTITY_HEADERS.pvVouchers,      []);
  writeTable(SHEETS.PAYABLES,     ENTITY_HEADERS.payables,         []);
  writeTable(SHEETS.DEBT_LEDGER,  ENTITY_HEADERS.debtLedger,       []);
  writeTable(SHEETS.RECEIPTS,     ENTITY_HEADERS.receipts,         []);
  writeTable(SHEETS.BANK_ENTRIES, ENTITY_HEADERS.bankEntries,      []);
  writeTable(SHEETS.CHECKS,       ENTITY_HEADERS.checks,           []);
  writeTable(SHEETS.BANK_RECON_LINES, ENTITY_HEADERS.bankReconLines, []);
  writeTable(SHEETS.BANK_RECON_STATE, ENTITY_HEADERS.bankReconState, []);

  // Add column notes/hints to help user fill in data
  _addColumnHints_();

  var sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  SpreadsheetApp.getUi().alert(
    '✅ สร้างชีตเรียบร้อยแล้ว!\n\n' +
    '📋 URL ของ Sheet นี้:\n' + sheetUrl + '\n\n' +
    '📝 ขั้นตอนต่อไป:\n' +
    '1. กรอกข้อมูลในแต่ละ Sheet ได้เลย\n' +
    '   • projects — โครงการทั้งหมด\n' +
    '   • invoices — ใบแจ้งหนี้\n' +
    '   • bankAccounts — บัญชีธนาคาร\n' +
    '   • pvVouchers — ใบสำคัญจ่าย\n' +
    '   • payables — เจ้าหนี้\n\n' +
    '2. Deploy เป็น Web App:\n' +
    '   Extensions → Apps Script → Deploy → New deployment\n' +
    '   Web app | Execute as: Me | Access: Anyone\n\n' +
    '3. คัดลอก URL → ส่งให้ผู้ดูแลระบบใส่ใน config.js'
  );
}

/* เพิ่ม note/hint ให้แต่ละคอลัมน์สำคัญ */
function _addColumnHints_() {
  var hints = {
    projects: {
      status:   'waiting_sign / signed_wip / invoiced / paid',
      delivery: 'awaiting / in_progress / pending / delivered / received',
      periods:  'JSON Array เช่น [{"period":1,"pctPogStank":100,"pctPogDrink":0,"value":1000000,"paymentStatus":"in_progress"}]',
    },
    invoices: {
      status:        'pending_inspection / tracking / issue / paid',
      followUps:     'JSON Array เช่น [] หรือ [{"date":"2026-01-01","note":"ส่งเอกสาร","by":"ชื่อ"}]',
      actualReceive: 'null ถ้ายังไม่ได้รับเงิน หรือ {"date":"2026-01-01","amount":100000,"bankAccount":"กรุงเทพ","feeNote":""}',
    },
    bankAccounts: {
      type: 'ออมทรัพย์ / เดินสะพัด/OD / L/C / กระแสรายวัน',
    },
    pvVouchers: {
      category:      'วัสดุ / รับเหมา / ขนส่ง / เงินเดือน / การเงิน / บริการ / สาธารณูปโภค',
      paymentMethod: 'โอน / เช็ค / หักบัญชี / เงินสด',
    },
    payables: {
      category: 'วัสดุ / รับเหมา / ขนส่ง / บริการ / สาธารณูปโภค / การเงิน',
      status:   'pending / paid / overdue',
    },
    debtLedger: {
      debtType:      'transfer_rights / od / pn / term_loan / internal / lc',
      interestBasis: 'per_annum / per_month / fee_pct',
      status:        'active / pending_approval / closed / overdue',
    },
  };

  Object.keys(hints).forEach(function (sheetName) {
    var sh = _ss().getSheetByName(sheetName);
    if (!sh) return;
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var sheetHints = hints[sheetName];
    headers.forEach(function (h, idx) {
      if (sheetHints[h]) {
        sh.getRange(1, idx + 1).setNote('📝 ค่าที่ใส่ได้:\n' + sheetHints[h]);
      }
    });
  });
}

/* ── 9B. INIT WITH DEMO DATA ────────────────────────────────────── */
function initWorkbook() {
  var seed = _seedData_();

  writeKV(SHEETS.META, seed.meta);
  writeKV(SHEETS.PIPELINE, {
    waitingSign:           JSON.stringify(seed.pipeline.waitingSign),
    signedWip:             JSON.stringify(seed.pipeline.signedWip),
    invoicedOutstanding:   JSON.stringify(seed.pipeline.invoicedOutstanding),
    totalProjectValue:     seed.pipeline.totalProjectValue,
    invoiceBroughtForward: seed.pipeline.invoiceBroughtForward,
    signedNotDelivered:    seed.pipeline.signedNotDelivered,
    notSigned:             seed.pipeline.notSigned,
    totalDebt:             seed.pipeline.totalDebt,
    usableNet:             seed.pipeline.usableNet,
  });
  writeKV(SHEETS.WARROOM_P1, {
    topKpis_totalInvoices:               seed.warroomP1.topKpis.totalInvoices,
    topKpis_estimatedCashInflow:         seed.warroomP1.topKpis.estimatedCashInflow,
    topKpis_estimatedDebt:               seed.warroomP1.topKpis.estimatedDebt,
    topKpis_netProjection:               seed.warroomP1.topKpis.netProjection,
    thisMonthNetProjection:              seed.warroomP1.thisMonthNetProjection,
    nextMonthNetProjection:              seed.warroomP1.nextMonthNetProjection,
    outstandingSummary_systemTotal:      JSON.stringify(seed.warroomP1.outstandingSummary.systemTotal),
    outstandingSummary_thisMonthTracked: JSON.stringify(seed.warroomP1.outstandingSummary.thisMonthTracked),
    outstandingSummary_nextMonthRollover:JSON.stringify(seed.warroomP1.outstandingSummary.nextMonthRollover),
    outstandingThisMonthByTransfer:      JSON.stringify(seed.warroomP1.outstandingThisMonthByTransfer),
    outstandingThisMonthTotal:           JSON.stringify(seed.warroomP1.outstandingThisMonthTotal),
    outstandingByTransfer:               JSON.stringify(seed.warroomP1.outstandingByTransfer),
    outstandingTotal:                    JSON.stringify(seed.warroomP1.outstandingTotal),
    wipByTransfer:                       JSON.stringify(seed.warroomP1.wipByTransfer),
    wipTotal:                            JSON.stringify(seed.warroomP1.wipTotal),
  });
  writeKV(SHEETS.WARROOM_P2, {
    totalProjectValue:   seed.warroomP2.totalProjectValue,
    invoiceForwardTotal: seed.warroomP2.invoiceForwardTotal,
    wipValue:            seed.warroomP2.wipValue,
    unsignedTotal:       JSON.stringify(seed.warroomP2.unsignedTotal),
    signedTotal:         JSON.stringify(seed.warroomP2.signedTotal),
  });
  writeTable(SHEETS.YTD_REVENUE,   ['month','en','count','gross','debt','net'],  seed.ytdRevenue);
  writeTable(SHEETS.WEEKLY_RECV,   ['week','count','gross','debt','net'],         seed.weeklyExpectedReceipt);
  writeTable(SHEETS.MONTHLY_FCST,  ['month','en','pctOfRemaining','invIssued','signed','unsigned','debt','netUsable'], seed.monthlyForecast);
  writeKV(SHEETS.DAILY, {
    asOfDate:   seed.daily.asOfDate,
    ytdAccum:   JSON.stringify(seed.daily.ytdAccum),
    mtdAccum:   JSON.stringify(seed.daily.mtdAccum),
    todayAccum: JSON.stringify(seed.daily.todayAccum),
  });
  writeTable(SHEETS.DAILY_INV, ['id','no','code','name','period','amount','receivedAt'], seed.daily.invoicesToday);
  writeKV(SHEETS.CASHFLOW, {
    month:        seed.cashFlow.month,
    bf:           seed.cashFlow.bf,
    planTotal:    seed.cashFlow.planTotal,
    actualPaid:   seed.cashFlow.actualPaid,
    paidPct:      seed.cashFlow.paidPct,
    revInflow:    seed.cashFlow.revInflow,
    loanReceived: seed.cashFlow.loanReceived,
    loanLine:     seed.cashFlow.loanLine,
    loanRemain:   seed.cashFlow.loanRemain,
    finalNet:     seed.cashFlow.finalNet,
    closing:      JSON.stringify(seed.cashFlow.closing),
    nowWeek:      seed.cashFlow.nowWeek,
  });
  writeTable(SHEETS.CF_INFLOW,  ['key','label','actual','plan'],
    seed.cashFlow.inflow.map(function (r) { return { key:r.key, label:r.label, actual:JSON.stringify(r.actual), plan:JSON.stringify(r.plan) }; }));
  writeTable(SHEETS.CF_OUTFLOW, ['key','label','actual','plan'],
    seed.cashFlow.outflow.map(function (r) { return { key:r.key, label:r.label, actual:JSON.stringify(r.actual), plan:JSON.stringify(r.plan) }; }));

  writeTable(SHEETS.PROJECTS,     ENTITY_HEADERS.projects,        seed.projects);
  writeTable(SHEETS.INVOICES,     ENTITY_HEADERS.invoices,         seed.invoices);
  writeTable(SHEETS.FORECAST_E,   ENTITY_HEADERS.forecastEntries,  seed.forecastEntries);
  writeTable(SHEETS.BANK,         ENTITY_HEADERS.bankAccounts,     seed.bankAccounts);
  writeTable(SHEETS.PV_VOUCHERS,  ENTITY_HEADERS.pvVouchers,       seed.pvVouchers);
  writeTable(SHEETS.PAYABLES,     ENTITY_HEADERS.payables,          seed.payables);
  writeTable(SHEETS.DEBT_LEDGER,  ENTITY_HEADERS.debtLedger,        seed.debtLedger);
  writeTable(SHEETS.RECEIPTS,     ENTITY_HEADERS.receipts,          seed.receipts);
  writeTable(SHEETS.BANK_ENTRIES, ENTITY_HEADERS.bankEntries,       seed.bankEntries);
  writeTable(SHEETS.CHECKS,       ENTITY_HEADERS.checks,            seed.checks);

  SpreadsheetApp.getUi().alert('✅ สร้างชีตพร้อมข้อมูลตัวอย่างเรียบร้อย\n\nขั้นตอนถัดไป: Deploy → New deployment → Web app\nแล้วนำ URL ไปใส่ใน app/config.js');
}

/* ── 10. SEED DATA (Demo) ───────────────────────────────────────── */
function _seedData_() {
  var n = 1000;
  var id = function () { return 'id_' + (++n).toString(36); };

  return {
    meta: { companyName:'บริษัท วอเทอร์ป๊อก จำกัด', shortName:'Water POG', asOf:'2026-05-18', year:2026, currency:'THB' },
    pipeline: {
      waitingSign:         { count:10, gross:35118000, debt:16649500, net:18468500 },
      signedWip:           { count:23, gross:42952000, debt:8818806.05, net:34133193.95 },
      invoicedOutstanding: { count:4,  gross:10154200, debt:2809200, net:7345000 },
      totalProjectValue:247453578.76, invoiceBroughtForward:10154200,
      signedNotDelivered:35118000, notSigned:47900000, totalDebt:84498100, usableNet:162955478.76,
    },
    warroomP1: {
      topKpis: { totalInvoices:10, estimatedCashInflow:35118000, estimatedDebt:16649500, netProjection:18468500 },
      thisMonthNetProjection:20968200, nextMonthNetProjection:18468500,
      outstandingSummary: {
        systemTotal:       { count:14, gross:45272200, debt:-19458700, net:25813500 },
        thisMonthTracked:  { count:4,  gross:10154200, debt:-2809200,  net:7345000 },
        nextMonthRollover: { count:10, gross:35118000, debt:-16649500, net:18468500 },
      },
      outstandingThisMonthByTransfer: [
        { type:'ไม่โอนสิทธิรับเงิน', count:1, gross:2154200,  debt:0,        net:2154200 },
        { type:'โอนสิทธิรับเงิน',    count:3, gross:8000000,  debt:-2809200, net:5190800 },
      ],
      outstandingThisMonthTotal: { count:4, gross:10154200, debt:-2809200, net:7345000 },
      outstandingByTransfer: [
        { type:'ไม่โอนสิทธิรับเงิน', count:3, gross:5000000,  debt:-2000000,  net:3000000 },
        { type:'โอนสิทธิรับเงิน',    count:7, gross:30118000, debt:-14649500, net:15468500 },
      ],
      outstandingTotal: { count:10, gross:35118000, debt:-16649500, net:18468500 },
      wipByTransfer: [
        { type:'ไม่โอนสิทธิรับเงิน', count:12, gross:21839603.76, debt:0,          net:21839603.76 },
        { type:'โอนสิทธิรับเงิน',    count:71, gross:182265900,   debt:-65039400, net:117226500 },
      ],
      wipTotal: { count:83, gross:204105503.76, debt:-65039400, net:139066103.76 },
    },
    warroomP2: {
      totalProjectValue:247453578.76, invoiceForwardTotal:45272200, wipValue:154281378.76,
      unsignedTotal:{ count:10, value:47900000 }, signedTotal:{ count:0, value:199553578.76 },
    },
    ytdRevenue: [
      { month:'มกราคม',    en:'Jan', count:13, gross:35644984.34, debt:0,           net:35644984.34 },
      { month:'กุมภาพันธ์', en:'Feb', count:16, gross:26170400,   debt:-8898400,    net:17272000 },
      { month:'มีนาคม',    en:'Mar', count:15, gross:32846184.32, debt:-13363100,   net:19483084.32 },
      { month:'เมษายน',    en:'Apr', count:23, gross:42952000,    debt:-8818806.05, net:34133193.95 },
      { month:'พฤษภาคม',  en:'May', count:4,  gross:10814000,    debt:-5963196.05, net:4850803.95 },
    ],
    weeklyExpectedReceipt: [
      { week:1, count:2,  gross:7554200,    debt:-2159200, net:5395000 },
      { week:2, count:2,  gross:2600000,    debt:-650000,  net:1950000 },
      { week:3, count:12, gross:21839603.76,debt:0,        net:21839603.76 },
      { week:4, count:0,  gross:0, debt:0, net:0 },
      { week:5, count:0,  gross:0, debt:0, net:0 },
    ],
    monthlyForecast: [
      { month:'พฤษภาคม',   en:'May', pctOfRemaining:14, invIssued:10154200, signed:0,          unsigned:0,         debt:-2809200,  netUsable:7345000 },
      { month:'มิถุนายน',   en:'Jun', pctOfRemaining:11, invIssued:35118000, signed:0,          unsigned:0,         debt:-16649500, netUsable:18468500 },
      { month:'กรกฎาคม',   en:'Jul', pctOfRemaining:13, invIssued:0,        signed:23450300,   unsigned:0,         debt:-11366800, netUsable:20524900 },
      { month:'สิงหาคม',   en:'Aug', pctOfRemaining:16, invIssued:0,        signed:41105000,   unsigned:0,         debt:-17654700, netUsable:23450300 },
      { month:'กันยายน',   en:'Sep', pctOfRemaining:24, invIssued:0,        signed:48739478.76,unsigned:0,         debt:-23057900, netUsable:25681578.76 },
      { month:'ตุลาคม',    en:'Oct', pctOfRemaining:5,  invIssued:0,        signed:13105200,   unsigned:28740000,  debt:-3240000,  netUsable:38605200 },
      { month:'พฤศจิกายน', en:'Nov', pctOfRemaining:18, invIssued:0,        signed:19440000,   unsigned:19160000,  debt:-9720000,  netUsable:28880000 },
      { month:'ธันวาคม',   en:'Dec', pctOfRemaining:0,  invIssued:0,        signed:0,          unsigned:0,         debt:0,         netUsable:0 },
    ],
    daily: {
      asOfDate:'2026-05-15',
      ytdAccum:   { count:77, value:149332093.66 },
      mtdAccum:   { count:5,  value:11045525 },
      todayAccum: { count:1,  value:231525 },
      invoicesToday: [
        { id:id(), no:1, code:'PP064-STIIS', name:'บ้านพรุกง ม.2 ต.วังใหญ่ อ.เทพา จ.สงขลา', period:1, amount:231525, receivedAt:'2026-05-15' },
      ],
    },
    cashFlow: {
      month:'May 2026', bf:2924226.17, planTotal:28300000, actualPaid:7597582.34, paidPct:26.85,
      revInflow:4805469, loanReceived:1473275, loanLine:3757661, loanRemain:4600000, finalNet:-8504440,
      inflow: [
        { key:'bf',      label:'เงินสดคงเหลือยกมา',       actual:[2924226.17,0,0,0,0], plan:[0,0,0,0,0] },
        { key:'project', label:'รับเงินโครงการ',           actual:[2924226.17,0,0,0,0], plan:[0,8500523.5,0,0,0] },
        { key:'loan',    label:'เงินกู้/สินเชื่อหมุนเวียน',actual:[0,0,0,0,0],          plan:[0,3200000,0,0,0] },
      ],
      outflow: [
        { key:'op',   label:'1. ค่าใช้จ่ายดำเนินงานรายสัปดาห์',  plan:[1500000,1500000,1500000,1800000,1500000], actual:[1808097.83,251317.48,0,0,0] },
        { key:'proj', label:'2. ค่าใช้จ่ายโครงการ/ติดตั้ง',      plan:[3000000,3000000,3000000,3000000,3000000], actual:[2478115.64,0,0,0,0] },
        { key:'fin',  label:'3. ต้นทุนทางการเงินและดอกเบี้ย',   plan:[1320000,1160000,160000,1000000,3060000],  actual:[38393.86,0,3021657.53,0,0] },
        { key:'misc', label:'4. ค่าใช้จ่ายเบ็ดเตล็ดและเงินเดือน',plan:[0,0,3300000,0,0],                         actual:[0,0,0,0,0] },
      ],
      closing:[-1331906.41,-6279476.5,-3584977.04,-6599615.67,-3300000], nowWeek:2,
    },
    projects: [
      { id:id(), code:'PP064-STIIS', name:'บ้านพรุกง ม.2 ต.วังใหญ่ อ.เทพา จ.สงขลา',            startDate:'2025-08-01', finishDate:'2026-05-15', allocBudget:4200000,  signedValue:4630500,  status:'invoiced',     delivery:'received',    assignee:'',           debt:0,        note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
      { id:id(), code:'PP073-AYT',   name:'อาคารสำนักงาน เทศบาลตำบลอ่าวยาง จ.พังงา',           startDate:'2025-10-05', finishDate:'2026-07-30', allocBudget:17000000, signedValue:18900000, status:'invoiced',     delivery:'pending',     assignee:'ธนาคารออมสิน',debt:4200000, note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
      { id:id(), code:'PP081-NKM',   name:'ระบบประปา ต.นาคำ อ.เมือง จ.หนองคาย',                startDate:'2025-09-12', finishDate:'2026-06-30', allocBudget:11000000, signedValue:12500000, status:'invoiced',     delivery:'delivered',   assignee:'กรุงเทพ',    debt:3500000, note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
      { id:id(), code:'PP084-SKN',   name:'ปรับปรุงท่อจ่ายน้ำ ม.7 ต.สำโรง จ.อุบลฯ',            startDate:'2026-01-22', finishDate:'2026-09-30', allocBudget:7500000,  signedValue:8550000,  status:'signed_wip',   delivery:'in_progress', assignee:'',           debt:1800000, note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
      { id:id(), code:'PP088-MTK',   name:'ระบบส่งน้ำ ต.มะตูม อ.พรหมพิราม จ.พิษณุโลก',          startDate:'2026-02-04', finishDate:'2026-10-15', allocBudget:21000000, signedValue:23450300, status:'signed_wip',   delivery:'in_progress', assignee:'กสิกรไทย',  debt:11366800,note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
      { id:id(), code:'PP091-CRI',   name:'ก่อสร้างประปา ม.4 ต.ป่าก่อดำ อ.แม่ลาว จ.เชียงราย', startDate:'2026-02-28', finishDate:'2026-11-30', allocBudget:17000000, signedValue:18900000, status:'signed_wip',   delivery:'in_progress', assignee:'',           debt:6500000, note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
      { id:id(), code:'PP094-PYO',   name:'ระบบประปาหมู่บ้าน ต.ดอกคำใต้ จ.พะเยา',              startDate:'2026-03-08', finishDate:'2026-12-31', allocBudget:12000000, signedValue:13105200, status:'signed_wip',   delivery:'pending',     assignee:'',           debt:3240000, note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
      { id:id(), code:'PP097-SKW',   name:'ระบบส่งน้ำดิบ ต.บางพระ อ.ศรีราชา จ.ชลบุรี',          startDate:'2026-03-25', finishDate:'2026-12-31', allocBudget:18000000, signedValue:19440000, status:'signed_wip',   delivery:'in_progress', assignee:'ไทยพาณิชย์', debt:9720000, note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
      { id:id(), code:'PP101-PTL',   name:'ปรับปรุงระบบประปา ต.เพชรเมืองทอง อ.เมือง จ.ปัตตานี',startDate:'',          finishDate:'',           allocBudget:26000000, signedValue:28740000, status:'waiting_sign', delivery:'awaiting',    assignee:'',           debt:13420000,note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
      { id:id(), code:'PP103-NSN',   name:'ระบบประปาหมู่บ้าน ต.หนองสองห้อง จ.ขอนแก่น',         startDate:'',          finishDate:'',           allocBudget:17500000, signedValue:19160000, status:'waiting_sign', delivery:'awaiting',    assignee:'',           debt:3229500, note:'', periods:'[]', stopTime:'', commenceDate:'', expectedPay1:'', expectedPay2:'' },
    ],
    invoices: [
      { id:id(), ivNo:'IV2026-077', jobNo:'PP064-STIIS', period:1, invoiceDate:'2026-05-10', balance:231525,  status:'paid',               expectedReceive:'2026-05-15', contactName:'คุณสมชาย',     contactPhone:'074-555-1100', followUps:'[]', actualReceive:'{"date":"2026-05-15","amount":231525,"bankAccount":"กรุงเทพ","feeNote":""}' },
      { id:id(), ivNo:'IV2026-076', jobNo:'PP073-AYT',   period:2, invoiceDate:'2026-05-05', balance:4200000, status:'pending_inspection',  expectedReceive:'2026-05-22', contactName:'คุณวิไล',      contactPhone:'076-555-2200', followUps:'[]', actualReceive:'null' },
      { id:id(), ivNo:'IV2026-075', jobNo:'PP081-NKM',   period:3, invoiceDate:'2026-05-03', balance:3500000, status:'tracking',            expectedReceive:'2026-05-28', contactName:'คุณธนา',      contactPhone:'042-555-2200', followUps:'[]', actualReceive:'null' },
      { id:id(), ivNo:'IV2026-074', jobNo:'PP084-SKN',   period:1, invoiceDate:'2026-04-29', balance:1850000, status:'tracking',            expectedReceive:'2026-06-04', contactName:'คุณอมรา',     contactPhone:'045-555-3300', followUps:'[]', actualReceive:'null' },
      { id:id(), ivNo:'IV2026-073', jobNo:'PP088-MTK',   period:2, invoiceDate:'2026-04-22', balance:5400000, status:'issue',               expectedReceive:'2026-06-10', contactName:'คุณสิงห์',    contactPhone:'055-555-4400', followUps:'[]', actualReceive:'null' },
      { id:id(), ivNo:'IV2026-072', jobNo:'PP091-CRI',   period:1, invoiceDate:'2026-04-15', balance:2380000, status:'tracking',            expectedReceive:'2026-06-18', contactName:'คุณพิม',      contactPhone:'053-555-5500', followUps:'[]', actualReceive:'null' },
      { id:id(), ivNo:'IV2026-071', jobNo:'PP097-SKW',   period:4, invoiceDate:'2026-04-08', balance:1900000, status:'pending_inspection',  expectedReceive:'2026-06-25', contactName:'คุณสุดารัตน์', contactPhone:'038-555-6600', followUps:'[]', actualReceive:'null' },
    ],
    forecastEntries: [
      { id:id(), date:'2026-05-22', category:'inflow_project', label:'รับเงินงวด 2 — PP073-AYT', amount:4200000,  note:'รอตรวจรับงาน' },
      { id:id(), date:'2026-05-26', category:'outflow_proj',   label:'จ่ายค่าวัสดุ Project PP088',  amount:-1800000, note:'รอบโอน' },
      { id:id(), date:'2026-05-28', category:'inflow_project', label:'รับเงินงวด 3 — PP081-NKM',   amount:3500000,  note:'ติดตามจาก อบต.' },
      { id:id(), date:'2026-05-30', category:'inflow_loan',    label:'เบิกสินเชื่อหมุนเวียน',         amount:3200000,  note:'ทำเรื่องแล้ว' },
      { id:id(), date:'2026-05-31', category:'outflow_fin',    label:'ชำระดอกเบี้ยเงินกู้ประจำเดือน', amount:-3060000, note:'' },
      { id:id(), date:'2026-06-02', category:'outflow_misc',   label:'เงินเดือนพนักงาน + โบนัส',     amount:-3300000, note:'' },
    ],
    bankAccounts: [
      { id:id(), bankName:'กรุงเทพ',    accountNo:'123-4-56789-0', accountName:'บริษัท วอเทอร์ป๊อก จำกัด (Main)',    type:'ออมทรัพย์',    balance:2454226.17, asOf:'2026-05-18', note:'บัญชีหลักเก็บเงินรับ' },
      { id:id(), bankName:'กสิกรไทย',   accountNo:'987-6-54321-0', accountName:'บริษัท วอเทอร์ป๊อก จำกัด (OD)',      type:'เดินสะพัด/OD', balance:-1200000,   asOf:'2026-05-18', note:'OD Limit 3,000,000' },
      { id:id(), bankName:'ไทยพาณิชย์', accountNo:'456-7-89012-3', accountName:'บริษัท วอเทอร์ป๊อก จำกัด (Payroll)', type:'ออมทรัพย์',    balance:470000,     asOf:'2026-05-18', note:'เงินเดือน + ค่าใช้จ่ายเบ็ดเตล็ด' },
      { id:id(), bankName:'กรุงไทย',    accountNo:'321-0-98765-4', accountName:'บริษัท วอเทอร์ป๊อก จำกัด (LC)',      type:'L/C',          balance:1200000,    asOf:'2026-05-18', note:'ค้ำประกันโครงการ' },
    ],
    pvVouchers: [
      { id:id(), voucherNo:'PV2026-101', paidDate:'2026-05-02', payee:'บริษัท ท่อพีวีซีไทย จำกัด',  amount:850000,  category:'วัสดุ',        paymentMethod:'เช็ค',     bankAccount:'กรุงเทพ 123-4-56789-0',    reference:'PO-2026-088', note:'' },
      { id:id(), voucherNo:'PV2026-102', paidDate:'2026-05-04', payee:'หจก. รับเหมา ก.วิศวกรรม',   amount:1200000, category:'รับเหมา',      paymentMethod:'โอน',      bankAccount:'กสิกรไทย 987-6-54321-0',  reference:'PP091 งวด 2', note:'งานก่อสร้าง' },
      { id:id(), voucherNo:'PV2026-103', paidDate:'2026-05-06', payee:'การไฟฟ้าส่วนภูมิภาค',        amount:48000,   category:'สาธารณูปโภค', paymentMethod:'โอน',      bankAccount:'ไทยพาณิชย์ 456-7-89012-3', reference:'PEA 05/2026', note:'' },
      { id:id(), voucherNo:'PV2026-107', paidDate:'2026-05-15', payee:'เงินเดือนพนักงาน',            amount:2850000, category:'เงินเดือน',   paymentMethod:'โอน',      bankAccount:'ไทยพาณิชย์ 456-7-89012-3', reference:'Payroll 05/2026', note:'' },
    ],
    payables: [
      { id:id(), creditorName:'บริษัท ท่อพีวีซีไทย จำกัด', invoiceNo:'INV-2026-001', amount:850000,  dueDate:'2026-05-25', category:'วัสดุ',        status:'pending', note:'ค่าท่อ PP088' },
      { id:id(), creditorName:'หจก. รับเหมา ก.วิศวกรรม',  invoiceNo:'KW2026-088',   amount:1200000, dueDate:'2026-05-30', category:'รับเหมา',      status:'pending', note:'งานก่อสร้าง PP091' },
      { id:id(), creditorName:'การไฟฟ้าส่วนภูมิภาค',      invoiceNo:'PEA2026-05',   amount:48000,   dueDate:'2026-05-31', category:'สาธารณูปโภค', status:'pending', note:'' },
    ],
    debtLedger: [
      // — โอนสิทธิรับเงิน (Transfer of Rights) ───────────────────────────
      { id:id(), debtNo:'DL-TR-001', debtType:'transfer_rights', linkedProjectCode:'PP073-AYT',
        bankName:'ธ.กสิกรไทย', accountRef:'OD สาขาสีลม',
        principalAmount:4200000, drawdownDate:'2026-03-15', maturityDate:'2026-07-01',
        interestRate:7.5, interestBasis:'per_annum',
        outstandingBalance:4200000, collateral:'โอนสิทธิรับเงินโครงการ PP073', status:'active', note:'โอนสิทธิเข้า OD วงเงิน 5M' },
      { id:id(), debtNo:'DL-TR-002', debtType:'transfer_rights', linkedProjectCode:'PP081-NKM',
        bankName:'ธ.กรุงเทพ', accountRef:'PN PS2026-014',
        principalAmount:3500000, drawdownDate:'2026-04-01', maturityDate:'2026-08-30',
        interestRate:6.75, interestBasis:'per_annum',
        outstandingBalance:3500000, collateral:'โอนสิทธิรับเงินโครงการ PP081', status:'active', note:'PN ฉบับที่ PS2026-014' },
      { id:id(), debtNo:'DL-TR-003', debtType:'transfer_rights', linkedProjectCode:'PP088-MTK',
        bankName:'ธ.ไทยพาณิชย์', accountRef:'PN PS2026-016',
        principalAmount:11366800, drawdownDate:'2026-03-01', maturityDate:'2026-09-30',
        interestRate:7.25, interestBasis:'per_annum',
        outstandingBalance:11366800, collateral:'โอนสิทธิรับเงินโครงการ PP088', status:'active', note:'PN ฉบับที่ PS2026-016' },
      { id:id(), debtNo:'DL-TR-004', debtType:'transfer_rights', linkedProjectCode:'PP091-CRI',
        bankName:'ธ.กสิกรไทย', accountRef:'สินเชื่อโครงการ',
        principalAmount:6500000, drawdownDate:'2026-04-15', maturityDate:'2026-09-30',
        interestRate:7.5, interestBasis:'per_annum',
        outstandingBalance:6500000, collateral:'โอนสิทธิรับเงินโครงการ PP091', status:'active', note:'' },
      { id:id(), debtNo:'DL-TR-005', debtType:'transfer_rights', linkedProjectCode:'PP094-PYO',
        bankName:'ธ.กรุงไทย', accountRef:'สินเชื่อโครงการ',
        principalAmount:3240000, drawdownDate:'2026-04-20', maturityDate:'2026-10-15',
        interestRate:6.5, interestBasis:'per_annum',
        outstandingBalance:3240000, collateral:'โอนสิทธิรับเงินโครงการ PP094', status:'active', note:'' },
      { id:id(), debtNo:'DL-TR-006', debtType:'transfer_rights', linkedProjectCode:'PP097-SKW',
        bankName:'ธ.กรุงเทพ', accountRef:'L/C ค้ำประกัน',
        principalAmount:9720000, drawdownDate:'2026-04-05', maturityDate:'2026-11-05',
        interestRate:7.0, interestBasis:'per_annum',
        outstandingBalance:9720000, collateral:'L/C ค้ำประกันโครงการ PP097', status:'active', note:'L/C ค้ำ' },
      { id:id(), debtNo:'DL-TR-007', debtType:'transfer_rights', linkedProjectCode:'PP101-PTL',
        bankName:'ธ.กสิกรไทย', accountRef:'รออนุมัติ',
        principalAmount:13420000, drawdownDate:null, maturityDate:null,
        interestRate:7.5, interestBasis:'per_annum',
        outstandingBalance:13420000, collateral:'โอนสิทธิรับเงินโครงการ PP101', status:'pending_approval', note:'รออนุมัติสินเชื่อ' },
      // — สินเชื่อภายใน ────────────────────────────────────────────────────
      { id:id(), debtNo:'DL-IN-001', debtType:'internal', linkedProjectCode:'PP084-SKN',
        bankName:'—', accountRef:'สินเชื่อภายใน',
        principalAmount:1800000, drawdownDate:'2026-02-01', maturityDate:'2026-08-30',
        interestRate:5.0, interestBasis:'per_annum',
        outstandingBalance:1800000, collateral:'—', status:'active', note:'กู้ภายใน บจก.' },
      { id:id(), debtNo:'DL-IN-002', debtType:'internal', linkedProjectCode:'PP103-NSN',
        bankName:'—', accountRef:'สินเชื่อภายใน',
        principalAmount:3229500, drawdownDate:'2026-02-15', maturityDate:'2026-11-22',
        interestRate:5.0, interestBasis:'per_annum',
        outstandingBalance:3229500, collateral:'—', status:'active', note:'กู้ภายใน บจก.' },
      // — OD / PN Standalone ───────────────────────────────────────────────
      { id:id(), debtNo:'DL-OD-001', debtType:'od', linkedProjectCode:null,
        bankName:'ธ.กสิกรไทย', accountRef:'987-6-54321-0 (วงเงิน 3M)',
        principalAmount:3000000, drawdownDate:'2025-07-01', maturityDate:'2026-06-30',
        interestRate:7.875, interestBasis:'per_annum',
        outstandingBalance:1200000, collateral:'สินทรัพย์บริษัท', status:'active', note:'OD วงเงิน 3M ใช้ไป 1.2M' },
      { id:id(), debtNo:'DL-PN-001', debtType:'pn', linkedProjectCode:null,
        bankName:'ธ.กรุงเทพ', accountRef:'PN-BGK-2025-011',
        principalAmount:15000000, drawdownDate:'2025-10-01', maturityDate:'2026-09-30',
        interestRate:6.5, interestBasis:'per_annum',
        outstandingBalance:15000000, collateral:'ที่ดิน + สิทธิรับเงินรวม', status:'active', note:'PN สายทุน ต่ออายุทุก 12 เดือน' },
      { id:id(), debtNo:'DL-PN-002', debtType:'pn', linkedProjectCode:null,
        bankName:'ธ.ไทยพาณิชย์', accountRef:'PN-SCB-2026-003',
        principalAmount:12000000, drawdownDate:'2026-01-15', maturityDate:'2026-07-15',
        interestRate:7.0, interestBasis:'per_annum',
        outstandingBalance:11321800, collateral:'สิทธิรับเงินโครงการ + ที่ดิน', status:'active', note:'PN หมุนเวียน 6 เดือน' },
    ],
    receipts: [
      // — มกราคม (gross 35,644,984.34 / transfer 0) ─────────────────────────
      { id:id(), receiptNo:'RC2026-001', receiptDate:'2026-01-05', invoiceNo:'IV2026-001', projectCode:'PP041-KKN', projectName:'ระบบประปา ต.โคกเคียน จ.นราธิวาส', period:2, grossAmount:9000000, transferDeduction:0, netReceived:9000000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'' },
      { id:id(), receiptNo:'RC2026-002', receiptDate:'2026-01-10', invoiceNo:'IV2026-005', projectCode:'PP043-CMI', projectName:'ก่อสร้างประปา ต.ช้างเผือก จ.เชียงใหม่', period:1, grossAmount:8644984.34, transferDeduction:0, netReceived:8644984.34, bankAccount:'กรุงเทพ 123-4-56789-0', note:'' },
      { id:id(), receiptNo:'RC2026-003', receiptDate:'2026-01-15', invoiceNo:'IV2026-010', projectCode:'PP081-NKM', projectName:'ระบบประปา ต.นาคำ จ.หนองคาย', period:1, grossAmount:3750000, transferDeduction:0, netReceived:3750000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'งวด 1 — ยังไม่โอนสิทธิ ณ ขณะรับเงิน' },
      { id:id(), receiptNo:'RC2026-004', receiptDate:'2026-01-22', invoiceNo:'IV2026-015', projectCode:'PP046-PCB', projectName:'ระบบส่งน้ำ ต.พระชนก จ.พิษณุโลก', period:2, grossAmount:7500000, transferDeduction:0, netReceived:7500000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'' },
      { id:id(), receiptNo:'RC2026-005', receiptDate:'2026-01-28', invoiceNo:'IV2026-020', projectCode:'PP048-TRT', projectName:'ปรับปรุงระบบประปา ต.ท่าโรง จ.เพชรบูรณ์', period:1, grossAmount:6750000, transferDeduction:0, netReceived:6750000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'' },
      // — กุมภาพันธ์ (gross 26,170,400 / transfer 8,898,400) ─────────────────
      { id:id(), receiptNo:'RC2026-006', receiptDate:'2026-02-05', invoiceNo:'IV2026-022', projectCode:'PP050-MKN', projectName:'ระบบประปาหมู่บ้าน ต.โมกข์ จ.นครนายก', period:2, grossAmount:6500000, transferDeduction:2000000, netReceived:4500000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.กรุงเทพ' },
      { id:id(), receiptNo:'RC2026-007', receiptDate:'2026-02-12', invoiceNo:'IV2026-025', projectCode:'PP052-SBR', projectName:'ก่อสร้างประปา ต.สิบเอ็ด จ.สมุทรสาคร', period:1, grossAmount:9120400, transferDeduction:4898400, netReceived:4222000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.กสิกรไทย' },
      { id:id(), receiptNo:'RC2026-008', receiptDate:'2026-02-19', invoiceNo:'IV2026-028', projectCode:'PP054-NKB', projectName:'ระบบส่งน้ำดิบ ต.นิคมบ้าน จ.สงขลา', period:2, grossAmount:5050000, transferDeduction:2000000, netReceived:3050000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.ไทยพาณิชย์' },
      { id:id(), receiptNo:'RC2026-009', receiptDate:'2026-02-26', invoiceNo:'IV2026-031', projectCode:'PP056-RNG', projectName:'ปรับปรุงท่อน้ำ ต.ระนอง จ.ระนอง', period:1, grossAmount:5500000, transferDeduction:0, netReceived:5500000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'' },
      // — มีนาคม (gross 32,846,184.32 / transfer 13,363,100) ─────────────────
      { id:id(), receiptNo:'RC2026-010', receiptDate:'2026-03-04', invoiceNo:'IV2026-035', projectCode:'PP058-LPG', projectName:'ระบบประปา ต.ลำปาง จ.ลำปาง', period:2, grossAmount:8346184.32, transferDeduction:3863100, netReceived:4483084.32, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.กรุงไทย' },
      { id:id(), receiptNo:'RC2026-011', receiptDate:'2026-03-12', invoiceNo:'IV2026-038', projectCode:'PP060-SKN', projectName:'ก่อสร้างประปาหมู่บ้าน ต.สักงาม จ.กำแพงเพชร', period:1, grossAmount:9500000, transferDeduction:5500000, netReceived:4000000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.กสิกรไทย' },
      { id:id(), receiptNo:'RC2026-012', receiptDate:'2026-03-22', invoiceNo:'IV2026-041', projectCode:'PP062-PTY', projectName:'ระบบส่งน้ำ ต.พัทยา จ.ชลบุรี', period:3, grossAmount:9750000, transferDeduction:4000000, netReceived:5750000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.ไทยพาณิชย์' },
      { id:id(), receiptNo:'RC2026-013', receiptDate:'2026-03-28', invoiceNo:'IV2026-044', projectCode:'PP081-NKM', projectName:'ระบบประปา ต.นาคำ จ.หนองคาย', period:2, grossAmount:5250000, transferDeduction:0, netReceived:5250000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'งวด 2 — หักที่งวด 3' },
      // — เมษายน (gross 42,952,000 / transfer 8,818,806.05) ─────────────────
      { id:id(), receiptNo:'RC2026-014', receiptDate:'2026-04-02', invoiceNo:'IV2026-048', projectCode:'PP073-AYT', projectName:'อาคารสำนักงาน เทศบาลตำบลอ่าวยาง จ.พังงา', period:1, grossAmount:9450000, transferDeduction:3818806.05, netReceived:5631193.95, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.กสิกรไทย งวด 1' },
      { id:id(), receiptNo:'RC2026-015', receiptDate:'2026-04-08', invoiceNo:'IV2026-052', projectCode:'PP066-STL', projectName:'ระบบประปา ต.สตึก จ.บุรีรัมย์', period:2, grossAmount:7200000, transferDeduction:0, netReceived:7200000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'' },
      { id:id(), receiptNo:'RC2026-016', receiptDate:'2026-04-14', invoiceNo:'IV2026-056', projectCode:'PP068-PMB', projectName:'ปรับปรุงระบบประปา ต.พิมาย จ.นครราชสีมา', period:1, grossAmount:8502000, transferDeduction:2500000, netReceived:6002000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.กสิกรไทย' },
      { id:id(), receiptNo:'RC2026-017', receiptDate:'2026-04-21', invoiceNo:'IV2026-060', projectCode:'PP070-YST', projectName:'ก่อสร้างประปา ต.ยะรัง จ.ปัตตานี', period:2, grossAmount:9800000, transferDeduction:0, netReceived:9800000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'' },
      { id:id(), receiptNo:'RC2026-018', receiptDate:'2026-04-28', invoiceNo:'IV2026-064', projectCode:'PP072-CMB', projectName:'ระบบส่งน้ำ ต.ชะอม จ.สระบุรี', period:3, grossAmount:8000000, transferDeduction:2500000, netReceived:5500000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.กรุงเทพ' },
      // — พฤษภาคม (gross 10,814,000 / transfer 5,963,196.05) ────────────────
      { id:id(), receiptNo:'RC2026-019', receiptDate:'2026-05-03', invoiceNo:'IV2026-068', projectCode:'PP074-CPN', projectName:'ระบบประปาหมู่บ้าน ต.โชคชัย จ.นครราชสีมา', period:1, grossAmount:4200000, transferDeduction:2500000, netReceived:1700000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.ไทยพาณิชย์' },
      { id:id(), receiptNo:'RC2026-020', receiptDate:'2026-05-08', invoiceNo:'IV2026-070', projectCode:'PP076-NPN', projectName:'ก่อสร้างประปา ต.นิพนธ์ จ.สมุทรสาคร', period:2, grossAmount:3850475, transferDeduction:1963196.05, netReceived:1887278.95, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.กสิกรไทย' },
      { id:id(), receiptNo:'RC2026-021', receiptDate:'2026-05-12', invoiceNo:'IV2026-073', projectCode:'PP078-CHR', projectName:'ปรับปรุงท่อน้ำ ต.ชะอวด จ.นครศรีธรรมราช', period:1, grossAmount:2532000, transferDeduction:1500000, netReceived:1032000, bankAccount:'กรุงเทพ 123-4-56789-0', note:'หักโอนสิทธิ ธ.กรุงเทพ' },
      { id:id(), receiptNo:'RC2026-022', receiptDate:'2026-05-15', invoiceNo:'IV2026-077', projectCode:'PP064-STIIS', projectName:'บ้านพรุกง ม.2 ต.วังใหญ่ จ.สงขลา', period:1, grossAmount:231525, transferDeduction:0, netReceived:231525, bankAccount:'กรุงเทพ 123-4-56789-0', note:'' },
    ],
    bankEntries: [
      // — ธ.กรุงเทพ 123-4-56789-0 ───────────────────────────────────────────
      { id:id(), entryDate:'2026-05-25', bankName:'กรุงเทพ', accountNo:'123-4-56789-0', entryType:'outflow_check',         description:'จ่ายเช็ค CHQ-2026-001 ท่อพีวีซีไทย',       amount:-350000,   referenceNo:'CHQ-2026-001', transferRef:null, linkedProjectCode:'PP088-MTK', status:'planned', note:'' },
      { id:id(), entryDate:'2026-05-25', bankName:'กรุงเทพ', accountNo:'123-4-56789-0', entryType:'outflow_check',         description:'จ่ายเช็ค CHQ-2026-002 รับเหมา ก.',          amount:-1200000,  referenceNo:'CHQ-2026-002', transferRef:null, linkedProjectCode:'PP091-CRI', status:'planned', note:'' },
      { id:id(), entryDate:'2026-05-29', bankName:'กรุงเทพ', accountNo:'123-4-56789-0', entryType:'outflow_transfer',      description:'โอนเงินเข้า ไทยพาณิชย์ (Payroll)',           amount:-3000000,  referenceNo:'TRF-2026-001', transferRef:'TRF-2026-001', linkedProjectCode:null, status:'planned', note:'โอนเพื่อเตรียมจ่ายเงินเดือน' },
      { id:id(), entryDate:'2026-05-30', bankName:'กรุงเทพ', accountNo:'123-4-56789-0', entryType:'inflow_loan',           description:'เบิกสินเชื่อหมุนเวียน ธ.กรุงเทพ PN-BGK',    amount:3200000,   referenceNo:'PN-BGK-2025-011', transferRef:null, linkedProjectCode:null, status:'planned', note:'เบิก PN' },
      { id:id(), entryDate:'2026-05-31', bankName:'กรุงเทพ', accountNo:'123-4-56789-0', entryType:'outflow_loan_interest', description:'ชำระดอกเบี้ย PN-BGK-2025-011 (เม.ย.–พ.ค.)',  amount:-81250,    referenceNo:'INT-BGK-0526', transferRef:null, linkedProjectCode:null, status:'planned', note:'' },
      { id:id(), entryDate:'2026-05-31', bankName:'กรุงเทพ', accountNo:'123-4-56789-0', entryType:'outflow_check',         description:'จ่ายเช็ค CHQ-2026-004 AP รอบสิ้นเดือน',     amount:-2500000,  referenceNo:'CHQ-2026-004', transferRef:null, linkedProjectCode:null, status:'planned', note:'' },
      { id:id(), entryDate:'2026-06-05', bankName:'กรุงเทพ', accountNo:'123-4-56789-0', entryType:'outflow_misc',          description:'จ่ายเบ็ดเตล็ด CHQ-2026-006/007',             amount:-635000,   referenceNo:'CHQ-2026-006', transferRef:null, linkedProjectCode:null, status:'planned', note:'นาคาปั๊มน้ำ 540k + ขนส่ง 95k' },
      // — ธ.ไทยพาณิชย์ 456-7-89012-3 ──────────────────────────────────────
      { id:id(), entryDate:'2026-05-29', bankName:'ไทยพาณิชย์', accountNo:'456-7-89012-3', entryType:'inflow_transfer',   description:'รับโอนจาก กรุงเทพ (Payroll)',               amount:3000000,   referenceNo:'TRF-2026-001', transferRef:'TRF-2026-001', linkedProjectCode:null, status:'planned', note:'คู่ TRF-2026-001' },
      { id:id(), entryDate:'2026-05-30', bankName:'ไทยพาณิชย์', accountNo:'456-7-89012-3', entryType:'outflow_salary',    description:'จ่ายเงินเดือนพนักงาน พ.ค. 2026',           amount:-2850000,  referenceNo:'PAYROLL-0526', transferRef:null, linkedProjectCode:null, status:'planned', note:'' },
      // — ธ.กสิกรไทย 987-6-54321-0 ─────────────────────────────────────────
      { id:id(), entryDate:'2026-05-31', bankName:'กสิกรไทย', accountNo:'987-6-54321-0', entryType:'outflow_loan_interest', description:'ชำระดอกเบี้ย OD กสิกรไทย พ.ค. 2026',     amount:-7875,     referenceNo:'INT-KSK-0526', transferRef:null, linkedProjectCode:null, status:'planned', note:'' },
      { id:id(), entryDate:'2026-06-30', bankName:'กสิกรไทย', accountNo:'987-6-54321-0', entryType:'outflow_check',        description:'จ่ายเช็ค CHQ-2026-009 PN ดอกเบี้ย',        amount:-500000,   referenceNo:'CHQ-2026-009', transferRef:null, linkedProjectCode:null, status:'planned', note:'' },
    ],
    checks: [
      { id:id(), checkNo:'CHQ-2026-001', checkDate:'2026-05-25', payee:'บริษัท ท่อพีวีซีไทย จำกัด',        amount:350000,  bankName:'กรุงเทพ',    accountNo:'123-4-56789-0', referenceNo:'AP-PP088',   linkedProjectCode:'PP088-MTK', status:'clearing', note:'ค่าท่อ PP088' },
      { id:id(), checkNo:'CHQ-2026-002', checkDate:'2026-05-25', payee:'หจก. รับเหมา ก.วิศวกรรม',          amount:1200000, bankName:'กรุงเทพ',    accountNo:'123-4-56789-0', referenceNo:'AP-PP091',   linkedProjectCode:'PP091-CRI', status:'pending',  note:'งานก่อสร้าง PP091' },
      { id:id(), checkNo:'CHQ-2026-003', checkDate:'2026-05-31', payee:'ธ.กรุงเทพ ดอกเบี้ย PN',             amount:81250,   bankName:'กรุงเทพ',    accountNo:'123-4-56789-0', referenceNo:'PN-BGK-011', linkedProjectCode:null,        status:'pending',  note:'ดอกเบี้ย PN-BGK-2025-011' },
      { id:id(), checkNo:'CHQ-2026-004', checkDate:'2026-05-31', payee:'AP รอบสิ้นเดือน (รวม)',              amount:2500000, bankName:'กรุงเทพ',    accountNo:'123-4-56789-0', referenceNo:'AP-MAY31',   linkedProjectCode:null,        status:'pending',  note:'รวมค่าใช้จ่าย AP' },
      { id:id(), checkNo:'CHQ-2026-005', checkDate:'2026-05-31', payee:'ธ.กสิกรไทย ดอกเบี้ย OD',            amount:7875,    bankName:'กสิกรไทย',  accountNo:'987-6-54321-0', referenceNo:'OD-KSK-001', linkedProjectCode:null,        status:'pending',  note:'ดอกเบี้ย OD พ.ค.' },
      { id:id(), checkNo:'CHQ-2026-006', checkDate:'2026-06-05', payee:'บริษัท นาคาปั๊มน้ำ จำกัด',          amount:540000,  bankName:'กรุงเทพ',    accountNo:'123-4-56789-0', referenceNo:'PO-2026-096', linkedProjectCode:'PP094-PYO', status:'pending',  note:'ค่าปั๊มน้ำ PP094' },
      { id:id(), checkNo:'CHQ-2026-007', checkDate:'2026-06-05', payee:'บริษัท ขนส่งยูไนเต็ด จำกัด',        amount:95000,   bankName:'กรุงเทพ',    accountNo:'123-4-56789-0', referenceNo:'TR-2026-033', linkedProjectCode:'PP088-MTK', status:'pending',  note:'ค่าขนส่งวัสดุ' },
      { id:id(), checkNo:'CHQ-2026-008', checkDate:'2026-05-06', payee:'การไฟฟ้าส่วนภูมิภาค',               amount:48000,   bankName:'ไทยพาณิชย์', accountNo:'456-7-89012-3', referenceNo:'PEA-0526',   linkedProjectCode:null,        status:'cleared',  note:'ค่าไฟ พ.ค.' },
      { id:id(), checkNo:'CHQ-2026-009', checkDate:'2026-05-10', payee:'บัญชีเอกชน (สำรองจ่าย)',            amount:35000,   bankName:'กรุงเทพ',    accountNo:'123-4-56789-0', referenceNo:'MISC-010',   linkedProjectCode:null,        status:'cleared',  note:'เงินสำรองจ่าย' },
    ],
  };
}
