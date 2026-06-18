/* =====================================================================
 * data_sync.js  —  Google Sheets (CSV) sync layer for BIOAXEL Dashboard
 * โหลดหลังจาก config.js และ data.js
 *
 * วิธีทำงาน:
 *  1) เมื่อเปิดแอป → fetch CSV จากทุก tab ใน Google Sheets (ผ่าน gviz endpoint)
 *  2) parse CSV → build data structure → ส่งให้ React state
 *  3) Auto-refresh ทุก ๆ AUTO_REFRESH_MS
 *
 * Read-only — แก้ข้อมูลใน web app ไม่ sync กลับ Sheet (แก้ใน Sheet โดยตรงแทน)
 *
 * ต้องตั้งค่า Google Sheet ให้เป็น "Anyone with the link can view"
 * ===================================================================== */
(function () {
  'use strict';

  // ── Build marker ───────────────────────────────────────────────────
  // เปิด DevTools Console แล้วดูบรรทัดนี้ เพื่อยืนยันว่าเบราว์เซอร์โหลด "โค้ดใหม่" จริง
  // (ถ้าไม่เห็น = ยังรัน cache เก่า → hard refresh Ctrl+Shift+R + ปิดแท็บเก่าทุกอัน)
  // เช็คเร็ว: พิมพ์ WTPData.buildId ใน console
  var BUILD_ID = '20260616b';
  try {
    console.info('%c[WTP Sync] build ' + BUILD_ID + ' — row-level + anti-empty-push + server-guard + read-your-writes + no-push-when-logged-out + presence + auto-push-only-on-activity',
                 'color:#2a6fdb;font-weight:bold');
    if (window.WTPData) WTPData.buildId = BUILD_ID;
  } catch (_) {}

  var cfg = window.WTP_CONFIG || {};

  // ── ถ้าเลือก backend = Supabase → ไม่ทำงานเลย (ปล่อยให้ data_supabase.js เป็นเจ้าของ
  //   WTPData ทั้งหมด). data_supabase.js โหลดหลังไฟล์นี้ + define interface ครบเอง.
  //   ค่าตั้งต้น BACKEND='sheets' → ข้าม guard นี้ → ทำงานเหมือนเดิมเป๊ะ.
  if ((cfg.BACKEND || 'sheets') === 'supabase') {
    console.info('[WTP Sync] BACKEND=supabase → ปิด Google Sheets sync (ใช้ data_supabase.js แทน)');
    return;
  }

  var SHEET_ID = cfg.SHEET_ID || '';
  var POST_URL = cfg.APPS_SCRIPT_URL || '';

  if (!SHEET_ID) {
    console.info('[WTP Sync] Offline mode — ตั้งค่า SHEET_ID ใน app/config.js เพื่อเปิด sync');
    WTPData.getSyncStatus = function () { return { status: 'offline', time: null }; };
    WTPData.subscribe = function () { return function () {}; };
    return;
  }

  var BASE = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=';

  // Entities ที่รองรับ CRUD ผ่าน Apps Script POST
  var CRUD_ENTITIES = ['projects', 'invoices', 'forecastEntries',
                       'bankAccounts', 'pvVouchers', 'payables',
                       'debtLedger', 'receipts', 'bankEntries', 'checks',
                       'debtMaster', 'bankTransfers',
                       'stsServiceFee', 'stsPendingCalc', 'stsCalcResult',
                       'debtEvents', 'users', 'cashflowSnapshots',
                       'followUpsLog', 'manualOverrides',
                       'bankReconLines', 'bankReconState'];   // กระทบยอดธนาคาร (sync แท็บแยก)

  // jsonFields per entity — for proper rowsToObjects parsing during safety re-fetch
  var ENTITY_JSON_FIELDS = {
    invoices:      ['followUps', 'actualReceive'],
    stsCalcResult: ['debtIds'],
  };

  // Fields the APP is allowed to intentionally CLEAR — for these, an empty app
  // value must WIN over a non-empty Sheet value. Without this, the
  // "keep Sheet value when app empty" guard makes "ล้าง" (clear) bounce back on
  // the next sync: app sets paymentDate='' → merge restores the old Sheet value.
  // Only list fields the app fully owns via UI (never hand-edited in the Sheet).
  var CLEARABLE_FIELDS = {
    debtLedger: ['paymentDate', 'paidBy', 'paidAt', 'paymentNote',
                 'interestOverride', 'overrideBy', 'overrideAt', 'overrideNote'],
    debtMaster: ['closedDate', 'closedReason', 'closedBy', 'closedAt'],
  };

  /* ── state ──────────────────────────────────────────────────────── */
  var subscribers      = [];
  var syncStatus       = 'syncing';
  var lastSyncTime     = null;          // last successful sync timestamp
  var lastSyncError    = null;          // last error message (for tooltip/debug)
  var failedSheets     = [];            // list of sheet names that failed last round
  var consecutiveFails = 0;             // count consecutive fail rounds (adaptive backoff)
  var cachedServerData = null;
  var lastSnapshot     = {};            // last known server state per entity (JSON)
  var serverDataLoaded = false;         // gate auto-push until first server read
  var syncTimer        = null;          // debounce timer for syncDiff
  var inSyncDiff       = false;         // re-entry guard for syncDiff
  var AUTO_MS          = cfg.AUTO_REFRESH_MS || 0;
  var ROW_LEVEL        = cfg.ROW_LEVEL_SYNC === true;   // ใช้ applyDiff (row-level) แทน replaceAll
  var currentInterval  = AUTO_MS;       // may grow via backoff
  var autoTimer        = null;          // setInterval handle (so we can restart)
  var recentPushAt     = {};            // entity → ts(ms) ของ push ล่าสุดที่สำเร็จ (anti-bounce)
  var cycleCount       = 0;             // นับรอบ auto-refresh (ใช้ตัดสิน hot vs full)

  // ── Auto-push activity gate (กันแท็บเปิดค้างดัน "diff หลอก" ทับชีต = ข้อมูลหาย) ──
  //   auto-push (debounced ใน WTPData.save wrapper) จะยิงเฉพาะเมื่อผู้ใช้ "เพิ่งแตะ"
  //   (พิมพ์/คลิก/แก้) ภายใน window. แท็บค้างเฉยๆ poll แล้ว normalize ต่าง → ไม่ push.
  //   ★ forceSyncNow (ปุ่มบันทึกจริง) ข้าม gate นี้เสมอ → การแก้ผ่านปุ่มยังเซฟ 100%
  var AUTO_PUSH_REQUIRES_ACTIVITY  = cfg.AUTO_PUSH_REQUIRES_ACTIVITY !== false;     // default true
  var AUTO_PUSH_ACTIVITY_WINDOW_MS = cfg.AUTO_PUSH_ACTIVITY_WINDOW_MS || 120000;    // 2 นาที
  var lastUserActivity = 0;             // ts แตะล่าสุด; 0 = แท็บค้าง/เพิ่งเปิด ยังไม่แตะ → ไม่ auto-push

  // ── Anti-flip (กันยอด "เด้งไปเด้งมา") ──────────────────────────────
  // gviz CSV มีหลาย cache edge ที่ไม่ sync กัน → บางรอบ poll คืนค่าเก่า บางรอบค่าใหม่
  // → ค่าบนจอสลับเก่า↔ใหม่ทุกรอบ (อาการ "กระพริบ"). เกราะฝั่งเขียน (base-reconcile)
  // ไม่ช่วยเพราะนี่คือฝั่ง "อ่าน". กฎ: auto-poll จะ "รับ" ค่าที่เปลี่ยนก็ต่อเมื่ออ่านได้
  // ค่าเดิมซ้ำ 2 รอบติด (นิ่งแล้ว) เท่านั้น — ค่าที่ flap ไปมาจะถูกข้าม คงค่าที่แสดงอยู่.
  // trusted (เปิดแอป / กด ↻ / กลับ tab) ไม่ติดเงื่อนไข — รับทันที + ตั้ง baseline ให้ auto รอบถัดไป.
  var lastAutoRead = {};                // entity → JSON ของ sheet rows ที่ auto อ่านได้รอบก่อน
  function autoReadGate(entity, sheetJSON, isAuto) {
    if (!isAuto) { lastAutoRead[entity] = sheetJSON; return true; }   // trusted → รับทันที
    var prev = lastAutoRead[entity];
    lastAutoRead[entity] = sheetJSON;
    return prev === undefined || sheetJSON === prev;                   // รับเมื่อนิ่ง (ตรงรอบก่อน)
  }

  // ── Anti-bounce grace window ──────────────────────────────────────
  // หลัง push สำเร็จ gviz CSV อาจยังเสิร์ฟค่าเก่าได้อีกหลายสิบวินาที
  // (read-after-write lag). ในช่วงนี้ห้ามเอา CSV เก่ามาทับค่าที่เพิ่ง push
  // ไม่งั้นจอจะ "เด้งกลับ" เป็นค่าเดิม → user นึกว่าไม่บันทึก เลยแก้ซ้ำ
  // 180s — ขยายจาก 60s (2026-06-06): เซิร์ฟเวอร์มี base-reconcile กันข้อมูลหายถาวรแล้ว
  // เหลือแค่อาการ "วูบชั่วคราว" ตอน gviz CSV อ่านช้ากว่าเขียน (read-after-write lag).
  // ผู้ใช้ไม่ต้องการ real-time → กันค่าที่เพิ่ง push ไม่ให้ CSV เก่าทับนานขึ้น = วูบน้อยลง.
  // ผลข้างเคียงน้อย: เห็น edit ของคนอื่นช้าลง "เฉพาะตาราง+ช่วงที่ตัวเองเพิ่งแก้" เท่านั้น
  var GRACE_MS = 180000;                // 180 วินาที (3 นาที)

  // ── Hot vs Cold polling ───────────────────────────────────────────
  // HOT  = entity ที่ user แก้บ่อย (CRUD) — poll ทุกรอบ
  // COLD = แท็บสรุป/derived (meta/pipeline/warroom/daily/cashFlow/...) ที่
  //        เปลี่ยนนาน ๆ ครั้ง — ดึงเฉพาะตอน full load (เปิดแอป/manual/กลับ tab/
  //        ทุก COLD_EVERY รอบ) เพื่อลดจำนวน request → ลด 429 → ข้อมูลสดขึ้น
  var COLD_EVERY = 4;                   // full load ทุก 4 รอบ (เช่น 45s×4 = ~3 นาที)

  function setSyncStatus(s, ctx) {
    syncStatus = s;
    if (s === 'ok') {
      lastSyncTime     = new Date();
      lastSyncError    = null;
      failedSheets     = [];
      consecutiveFails = 0;
      // คืน interval กลับเป็นค่าปกติถ้าเคยขยายไว้
      if (currentInterval !== AUTO_MS && AUTO_MS > 0) {
        currentInterval = AUTO_MS;
        restartAutoTimer();
        console.info('[WTP Sync] ✓ sync ok — คืน interval เป็น', AUTO_MS / 1000, 'วินาที');
      }
    } else if (s === 'error') {
      lastSyncError = (ctx && ctx.error) || null;
      failedSheets  = (ctx && ctx.sheets) || [];
      consecutiveFails++;
      // Adaptive backoff — fail ติด 2+ รอบ → ขยาย interval x2 (max 4 เท่าของ base)
      if (consecutiveFails >= 2 && AUTO_MS > 0 && currentInterval < AUTO_MS * 4) {
        currentInterval = Math.min(currentInterval * 2, AUTO_MS * 4);
        restartAutoTimer();
        console.warn('[WTP Sync] ขยาย interval เป็น', currentInterval / 1000,
          'วินาที (consecutive fails:', consecutiveFails + ')');
      }
    }
    window.dispatchEvent(new CustomEvent('wtpSyncStatus', {
      detail: {
        status: s, time: lastSyncTime,
        lastError: lastSyncError, failedSheets: failedSheets.slice(),
        consecutiveFails: consecutiveFails, currentInterval: currentInterval,
      }
    }));
  }

  function restartAutoTimer() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (currentInterval > 0) {
      autoTimer = setInterval(function () {
        // Page Visibility guard — tab idle ก็ไม่ต้องดึง
        if (document.hidden) return;
        cycleCount++;
        // ทุก COLD_EVERY รอบ → full load (ดึงแท็บ cold ด้วย); รอบอื่น → hot เท่านั้น
        // ★ ส่ง isAuto=true → ติดกฎ anti-flip (รับค่าใหม่เฉพาะที่นิ่ง) กันยอดเด้ง
        if (cycleCount % COLD_EVERY === 0) loadFromServer(true);
        else refreshHotEntities();
      }, currentInterval);
    }
  }

  /* ── CSV parser (handles quoted fields, commas inside quotes, "") ── */
  function parseCSV(text) {
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i+1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\r') { /* skip */ }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else { field += ch; }
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ── helpers ─────────────────────────────────────────────────────── */
  function rowsToObjects(rows, jsonFields) {
    if (!rows || rows.length < 2) return [];
    // Trim header strings — kills leading/trailing spaces/newlines/zero-width chars
    // ที่อาจติดมาจาก Google Sheets ตอน user paste (เคยทำให้ p['Start'] = undefined
    // เพราะ header จริงเป็น " Start" หรือ "Start " มี space แอบอยู่)
    var headers = (rows[0] || []).map(function (h) {
      if (h == null) return h;
      return String(h).replace(/[​-‍﻿]/g, '').trim();
    });

    // Detect duplicate column headers — warn once so users can find/rename them.
    var seen = {};
    var dupes = [];
    headers.forEach(function (h) {
      if (!h) return;
      if (seen[h]) { if (dupes.indexOf(h) < 0) dupes.push(h); }
      seen[h] = true;
    });
    if (dupes.length) {
      console.warn('[WTP Sync] พบ header ซ้ำใน sheet:', dupes.join(', '),
        '— จะใช้ค่าที่ไม่ว่างเปล่าเป็นหลัก (ถ้ามีหลายคอลัมน์ชื่อเดียวกัน)');
    }

    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.every(function (c) { return !c; })) continue;
      var obj = {};
      headers.forEach(function (h, j) {
        if (!h) return;
        var v = r[j];
        if (v === '' || v === undefined) v = null;
        if (jsonFields && jsonFields.indexOf(h) >= 0 && typeof v === 'string' && v.length > 1) {
          try { v = JSON.parse(v); } catch (_) {}
        }
        var existing = obj[h];
        var existingHasVal = existing != null && existing !== '';
        var newIsEmpty    = v == null || v === '';
        if (existingHasVal && newIsEmpty) return;
        obj[h] = v;
      });
      out.push(obj);
    }
    return out;
  }

  function rowsToKV(rows) {
    if (!rows || rows.length < 2) return {};
    var out = {};
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r[0]) continue;
      out[r[0]] = r[1] != null && r[1] !== '' ? r[1] : null;
    }
    return out;
  }

  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function tryParse(v, def) {
    if (v == null || v === '') return def;
    try { return JSON.parse(v); } catch (_) { return def; }
  }

  /* ── fetch one sheet as CSV rows ─────────────────────────────────── */
  // หมายเหตุ: ตั้งใจให้ throw error ออกไป (ไม่ catch ภายใน) เพื่อให้ caller
  // ใช้ Promise.allSettled แล้วตัดสินใจว่าจะ retry หรือใช้ cache เดิม
  // ★ ห้าม return [] ตอน fail เด็ดขาด — เพราะ [] จะถูกเอาไปทับข้อมูลใน
  //   localStorage (data loss bug) ตอนเจอ HTTP 429 / network error
  // ★ 429 resilience: จำกัดจำนวนคำขอพร้อมกัน + retry แบบ backoff เมื่อชน rate-limit
  var SHEET_FETCH_CONC = 6;     // ดึงทีละ ≤6 ชีต กัน burst → ลด HTTP 429
  var SHEET_MAX_RETRY  = 4;     // retry 429/5xx/network ก่อนยอมแพ้ (กันทิ้งทั้งรอบเพราะชน rate-limit)
  var SHEET_RETRY_BASE = 700;   // ms (exponential + jitter: ~0.7s, 1.4s, 2.8s, 5.6s)
  var lastRawRows = {};         // ★ raw rows ล่าสุดต่อชีต — ใช้เป็น fallback เมื่อชีตนั้นชน 429 (กันทิ้งทั้งรอบ)

  function fetchSheet(name, attempt) {
    attempt = attempt || 0;
    // Add cache-busting timestamp so we always get the latest Sheet state.
    // Without this, Google's gviz endpoint may serve stale CSV for several minutes.
    var url = BASE + encodeURIComponent(name) + '&_t=' + Date.now();
    return fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) { var e = new Error(name + ': HTTP ' + r.status); e.status = r.status; throw e; }
        return r.text();
      })
      .then(parseCSV)
      .catch(function (err) {
        // 429 (rate limit) / 5xx / network → หน่วงเวลาแล้วลองใหม่ (กระจายด้วย jitter)
        var st = err && err.status;
        var retryable = st === 429 || st === 500 || st === 502 || st === 503 ||
                        (err && /Failed to fetch|NetworkError|load failed/i.test(err.message || ''));
        if (retryable && attempt < SHEET_MAX_RETRY) {
          var delay = Math.min(SHEET_RETRY_BASE * Math.pow(2, attempt), 8000) + Math.floor(Math.random() * 400);
          return new Promise(function (res) { setTimeout(res, delay); })
            .then(function () { return fetchSheet(name, attempt + 1); });
        }
        throw err;  // ★ ยังต้อง throw — ให้ atomic rule รักษาข้อมูลเดิม (ห้าม return [])
      });
  }

  /* run fn over items with limited concurrency; returns a Promise.allSettled-shaped
   * array (order preserved) — กัน burst 32 requests พร้อมกันที่ทำให้ชน 429 */
  function mapLimit(items, limit, fn) {
    return new Promise(function (resolve) {
      var results = new Array(items.length);
      var next = 0, active = 0, finished = 0;
      if (items.length === 0) { resolve(results); return; }
      function pump() {
        while (active < limit && next < items.length) {
          (function (i) {
            active++;
            Promise.resolve().then(function () { return fn(items[i], i); })
              .then(function (v) { results[i] = { status: 'fulfilled', value: v }; },
                    function (e) { results[i] = { status: 'rejected', reason: e }; })
              .then(function () {
                active--; finished++;
                if (finished === items.length) resolve(results);
                else pump();
              });
          })(next++);
        }
      }
      pump();
    });
  }

  /* ── load all sheets in parallel + assemble data structure ─────────
   * isAuto=true  → เรียกจาก auto-timer (cold cycle) → ติดกฎ anti-flip (รับเฉพาะค่าที่นิ่ง)
   * isAuto=false → เปิดแอป / กด ↻ / กลับ tab → trusted, รับค่าทันที */
  function loadFromServer(isAuto) {
    setSyncStatus('syncing');

    var sheetOrder = [
      'meta', 'pipeline', 'warroomP1', 'warroomP2', 'daily', 'cashFlow',
      'ytdRevenue', 'weeklyExpectedReceipt', 'monthlyForecast',
      'daily_invoicesToday', 'cf_inflow', 'cf_outflow',
      'projects', 'invoices', 'forecastEntries',
      'bankAccounts', 'pvVouchers', 'payables',
      // v2 additions
      'debtLedger', 'receipts', 'bankEntries', 'checks',
      'debtMaster', 'bankTransfers',
      'stsServiceFee', 'stsPendingCalc', 'stsCalcResult',
      'debtEvents',
      'users',                  // user accounts (manager-only management)
      'cashflowSnapshots',      // daily bank balance snapshots
      'followUpsLog',           // flat log of all invoice follow-ups
      'manualOverrides',        // shared manual KPI overrides (visible to all users)
      'bankReconLines',         // กระทบยอด: รายการเดินบัญชีจาก statement (flat rows)
      'bankReconState',         // กระทบยอด: สถานะการกระทบ (lineId → decision)
      'presence',               // ใครออนไลน์อยู่ (heartbeat) — อ่านอย่างเดียวที่นี่, เขียนผ่าน pushPresence
    ];

    return mapLimit(sheetOrder, SHEET_FETCH_CONC, function (n) { return fetchSheet(n); }).then(function (settled) {
      // ★ Per-sheet fallback (แทนกฎ atomic เดิมที่ทิ้งทั้งรอบ):
      //   • ชีตที่โหลดสำเร็จ → ใช้ค่าสด + จำไว้เป็น lastRawRows
      //   • ชีตที่ชน 429/พัง → ใช้ค่าที่โหลดไว้ล่าสุด (ไม่เคยทับด้วย [] → ยังกัน data loss)
      //   • ชีตที่พัง "และไม่เคยโหลดสำเร็จเลย" (ไม่มีค่าเดิม) → ทิ้งทั้งรอบ retry (กัน render ครึ่งๆ ตอนเปิดครั้งแรก)
      var failed = [], usedCache = [];
      var results = settled.map(function (s, idx) {
        var name = sheetOrder[idx];
        if (s.status === 'fulfilled') { lastRawRows[name] = s.value; return s.value; }
        failed.push({ name: name, err: s.reason && s.reason.message });
        if (lastRawRows[name] !== undefined) { usedCache.push(name); return lastRawRows[name]; }
        return undefined;  // ไม่มีค่าเดิม
      });
      if (failed.length > 0) {
        failed.forEach(function (f) { console.warn('[WTP Sync] ดึงชีต', f.name, 'ล้มเหลว:', f.err); });
      }
      var unrecoverable = failed.filter(function (f) { return lastRawRows[f.name] === undefined; });
      if (unrecoverable.length > 0) {
        console.warn('[WTP Sync] ⚠ ' + unrecoverable.length + '/' + sheetOrder.length +
          ' ชีตโหลดไม่สำเร็จและยังไม่มีค่าเดิม — รักษาข้อมูลเดิมไว้ (ไม่ทับ localStorage) จะ retry รอบหน้า');
        setSyncStatus('error', {
          error: (unrecoverable[0] && unrecoverable[0].err) || 'fetch failed',
          sheets: unrecoverable.map(function (f) { return f.name; }),
        });
        return;  // ★ early return — ยังไม่ commit เพราะมีชีตที่ไม่เคยมีข้อมูลเลย
      }
      if (usedCache.length > 0) {
        console.warn('[WTP Sync] ⚠ ' + usedCache.length + ' ชีตชน 429 — ใช้ค่าที่โหลดล่าสุดแทน, ชีตอื่น commit ปกติ:',
          usedCache.join(', '));
      }
      var i = 0;
      var metaKV     = rowsToKV(results[i++]);
      var pipelineKV = rowsToKV(results[i++]);
      var wp1KV      = rowsToKV(results[i++]);
      var wp2KV      = rowsToKV(results[i++]);
      var dailyKV    = rowsToKV(results[i++]);
      var cfKV       = rowsToKV(results[i++]);
      var ytdRevenue            = rowsToObjects(results[i++]);
      var weeklyExpectedReceipt = rowsToObjects(results[i++]);
      var monthlyForecast       = rowsToObjects(results[i++]);
      var dailyInv              = rowsToObjects(results[i++]);
      var cfIn                  = rowsToObjects(results[i++]);
      var cfOut                 = rowsToObjects(results[i++]);
      var projects        = rowsToObjects(results[i++]);
      var invoices        = rowsToObjects(results[i++], ['followUps', 'actualReceive']);
      var forecastEntries = rowsToObjects(results[i++]);
      var bankAccounts    = rowsToObjects(results[i++]);
      var pvVouchers      = rowsToObjects(results[i++]);
      var payables        = rowsToObjects(results[i++]);
      // v2 additions
      var debtLedger      = rowsToObjects(results[i++]);
      var receipts        = rowsToObjects(results[i++]);
      var bankEntries     = rowsToObjects(results[i++]);
      var checks          = rowsToObjects(results[i++]);
      var debtMaster      = rowsToObjects(results[i++]);
      var bankTransfers   = rowsToObjects(results[i++]);
      var stsServiceFee   = rowsToObjects(results[i++]);
      var stsPendingCalc  = rowsToObjects(results[i++]);
      var stsCalcResult   = rowsToObjects(results[i++], ['debtIds']);
      var debtEvents      = rowsToObjects(results[i++]);
      var users           = rowsToObjects(results[i++]);
      var cashflowSnapshots = rowsToObjects(results[i++]);
      var followUpsLog      = rowsToObjects(results[i++]);
      var manualOverrides   = rowsToObjects(results[i++]);
      var bankReconLines    = rowsToObjects(results[i++]);
      var bankReconState    = rowsToObjects(results[i++]);
      // presence: กรอง gviz-garbage (แท็บยังไม่ถูกสร้าง → คืนชีตแรกมั่ว) — ต้องมี username จริง
      var presence          = rowsToObjects(results[i++]).filter(function (r) { return r && r.username; });

      var data = {
        meta: {
          companyName: metaKV.companyName || 'BIOAXEL',
          shortName:   metaKV.shortName   || 'BIOAXEL',
          asOf:        metaKV.asOf        || new Date().toISOString().slice(0, 10),
          year:        num(metaKV.year)   || new Date().getFullYear(),
          currency:    metaKV.currency    || 'THB',
        },
        pipeline: {
          waitingSign:           tryParse(pipelineKV.waitingSign,         { count:0, gross:0, debt:0, net:0 }),
          signedWip:             tryParse(pipelineKV.signedWip,           { count:0, gross:0, debt:0, net:0 }),
          invoicedOutstanding:   tryParse(pipelineKV.invoicedOutstanding, { count:0, gross:0, debt:0, net:0 }),
          totalProjectValue:     num(pipelineKV.totalProjectValue),
          invoiceBroughtForward: num(pipelineKV.invoiceBroughtForward),
          signedNotDelivered:    num(pipelineKV.signedNotDelivered),
          notSigned:             num(pipelineKV.notSigned),
          totalDebt:             num(pipelineKV.totalDebt),
          usableNet:             num(pipelineKV.usableNet),
        },
        warroomP1: {
          topKpis: {
            totalInvoices:       num(wp1KV.topKpis_totalInvoices),
            estimatedCashInflow: num(wp1KV.topKpis_estimatedCashInflow),
            estimatedDebt:       num(wp1KV.topKpis_estimatedDebt),
            netProjection:       num(wp1KV.topKpis_netProjection),
          },
          thisMonthNetProjection: num(wp1KV.thisMonthNetProjection),
          nextMonthNetProjection: num(wp1KV.nextMonthNetProjection),
          outstandingSummary: {
            systemTotal:       tryParse(wp1KV.outstandingSummary_systemTotal,       {}),
            thisMonthTracked:  tryParse(wp1KV.outstandingSummary_thisMonthTracked,  {}),
            nextMonthRollover: tryParse(wp1KV.outstandingSummary_nextMonthRollover, {}),
          },
          outstandingThisMonthByTransfer: tryParse(wp1KV.outstandingThisMonthByTransfer, []),
          outstandingThisMonthTotal:      tryParse(wp1KV.outstandingThisMonthTotal,      {}),
          outstandingByTransfer:          tryParse(wp1KV.outstandingByTransfer,          []),
          outstandingTotal:               tryParse(wp1KV.outstandingTotal,               {}),
          wipByTransfer:                  tryParse(wp1KV.wipByTransfer,                  []),
          wipTotal:                       tryParse(wp1KV.wipTotal,                       {}),
        },
        warroomP2: {
          totalProjectValue:   num(wp2KV.totalProjectValue),
          invoiceForwardTotal: num(wp2KV.invoiceForwardTotal),
          wipValue:            num(wp2KV.wipValue),
          unsignedTotal:       tryParse(wp2KV.unsignedTotal, {}),
          signedTotal:         tryParse(wp2KV.signedTotal,   {}),
        },
        ytdRevenue:            ytdRevenue,
        weeklyExpectedReceipt: weeklyExpectedReceipt,
        monthlyForecast:       monthlyForecast,
        daily: {
          asOfDate:   dailyKV.asOfDate || '',
          ytdAccum:   tryParse(dailyKV.ytdAccum,   {}),
          mtdAccum:   tryParse(dailyKV.mtdAccum,   {}),
          todayAccum: tryParse(dailyKV.todayAccum, {}),
          invoicesToday: dailyInv,
        },
        cashFlow: {
          month:        cfKV.month || '',
          bf:           num(cfKV.bf),
          planTotal:    num(cfKV.planTotal),
          actualPaid:   num(cfKV.actualPaid),
          paidPct:      num(cfKV.paidPct),
          revInflow:    num(cfKV.revInflow),
          loanReceived: num(cfKV.loanReceived),
          loanLine:     num(cfKV.loanLine),
          loanRemain:   num(cfKV.loanRemain),
          finalNet:     num(cfKV.finalNet),
          nowWeek:      num(cfKV.nowWeek),
          closing:      tryParse(cfKV.closing, []),
          inflow:  cfIn.map(function (r) { return { key:r.key, label:r.label, actual:tryParse(r.actual, []), plan:tryParse(r.plan, []) }; }),
          outflow: cfOut.map(function (r) { return { key:r.key, label:r.label, actual:tryParse(r.actual, []), plan:tryParse(r.plan, []) }; }),
        },
        projects:        projects,
        invoices:        invoices,
        forecastEntries: forecastEntries,
        bankAccounts:    bankAccounts,
        pvVouchers:      pvVouchers,
        payables:        payables,
        // v2 additions
        debtLedger:      debtLedger,
        receipts:        receipts,
        bankEntries:     bankEntries,
        checks:          checks,
        debtMaster:      debtMaster,
        bankTransfers:   bankTransfers,
        stsServiceFee:   stsServiceFee,
        stsPendingCalc:  stsPendingCalc,
        stsCalcResult:   stsCalcResult,
        debtEvents:      debtEvents,
        users:           users,
        cashflowSnapshots: cashflowSnapshots,
        followUpsLog:      followUpsLog,
        manualOverrides:   manualOverrides,
        bankReconLines:    bankReconLines,
        bankReconState:    bankReconState,
        presence:          presence,
      };

      // Anti-bounce guard: ถ้า entity มี edit ค้าง (ยังไม่ push) หรือเพิ่ง push
      // ภายใน grace window → คงค่า local ไว้ ไม่เอา CSV (ที่อาจ stale) มาทับ
      // ส่วน entity ที่ไม่มีอะไรค้าง → รับค่าชีต + preserve app-only fields ตามเดิม
      try {
        var localData = WTPData.load();
        CRUD_ENTITIES.forEach(function (e) {
          if (!Array.isArray(data[e])) return;
          // anti-flip: ใน auto-load จะรับค่า server ก็ต่อเมื่อ "นิ่ง" (อ่านได้ซ้ำรอบก่อน)
          var stable = autoReadGate(e, JSON.stringify(data[e]), isAuto);
          var g = applyEntityGuard(e, data[e], localData);
          if (g.accepted && !stable && !g.recovered) {
            // server อยากให้รับค่าใหม่ แต่ค่ายังไม่นิ่ง (cache flap) + ไม่มี edit ค้าง
            // → คงค่าที่แสดงอยู่รอบก่อน กัน "ยอดเด้ง" (ไม่ขยับ snapshot, รอยืนยันรอบหน้า)
            // ★ ยกเว้น recovered (anti-wedge) → ต้องรับทันที ไม่ต้องรอนิ่ง กันค้าง
            if (cachedServerData && cachedServerData[e] !== undefined) data[e] = cachedServerData[e];
            return;
          }
          data[e] = g.rows;
          if (g.accepted) lastSnapshot[e] = JSON.stringify(g.rows);
          // ถ้า !accepted (มี edit ค้าง/เพิ่ง push) → ไม่ขยับ snapshot + คงค่า local (กันงานหาย)
        });
      } catch (_) {
        // fallback: localStorage parse พัง → ตั้ง snapshot ตามชีตแบบเดิม
        CRUD_ENTITIES.forEach(function (e) {
          lastSnapshot[e] = JSON.stringify(data[e] || []);
        });
      }
      cachedServerData = data;
      serverDataLoaded = true;
      origSave(data);                                    // persist to localStorage (skip syncDiff)
      subscribers.forEach(function (cb) { cb(data); });  // notify React
      setSyncStatus('ok');
    }).catch(function (err) {
      console.warn('[WTP Sync] โหลดข้อมูลล้มเหลว:', err);
      setSyncStatus('error');
    });
  }

  /* ── anti-bounce guard helper ─────────────────────────────────────
   * ตัดสินว่า entity นี้ควร "รับค่าจากชีต" หรือ "คงค่า local" ตอนโหลด
   *   - มี edit ค้าง (local != snapshot ที่ push ล่าสุด) → คงค่า local (รอ push)
   *   - เพิ่ง push สำเร็จภายใน GRACE_MS → คงค่า local (กัน CSV เก่าทับ)
   *   - อื่น ๆ → รับค่าชีต + preserve app-only fields
   * คืน { rows, accepted } ; accepted=true แปลว่าให้ caller อัป snapshot ตามชีตได้
   */
  function clearableOf(entity) {
    var clr = {};
    (CLEARABLE_FIELDS[entity] || []).forEach(function (k) { clr[k] = true; });
    return clr;
  }
  function applyEntityGuard(entity, sheetRows, localData) {
    var localRows = localData && localData[entity];
    var snap = lastSnapshot[entity];
    var hasPending = snap !== undefined &&
                     JSON.stringify(Array.isArray(localRows) ? localRows : []) !== snap;
    var inGrace = recentPushAt[entity] && (Date.now() - recentPushAt[entity] < GRACE_MS);

    // ── ANTI-WEDGE: local เล็กกว่า server มากผิดปกติ (>50%) → local "เพี้ยน" ไม่ใช่ edit จริง ──
    // อาการ wedge: ครั้งหนึ่ง state ถูกตั้งค่าแถวน้อยผิดปกติ (truncated read / stale-closure ทับ /
    // หน้าจอ crash ค้างค่าเก่า) แล้ว hasPending ทำให้ "คงค่า local" ตลอด (ไม่ยอมรับ server ที่ครบ)
    // + ฝั่ง push เจอ SAFETY GUARD บล็อก (rows ลด >50%) → วนค้าง: ผู้ใช้เพิ่มอะไรก็ไม่ติด เด้งกลับทุกครั้ง.
    // เซิร์ฟเวอร์เป็น source of truth (replaceAll มี base-reconcile กันชีตหาย >50% อยู่แล้ว) →
    // ทิ้ง local ที่เพี้ยน รับค่า server ทันที (recovered=true ให้ caller ข้าม anti-flip ด้วย) กันค้าง.
    // ★ 2026-06-15: ครอบคลุม localRows.length===0 ด้วย — เคสที่ทำ "ทุกคนข้อมูลไม่ขึ้น" หลัง Clear
    //   site data: localStorage ว่าง (อาจเขียนไม่ลง quota) → load() คืน freshState ว่าง → hasPending
    //   ตี local [] vs snap full = true → คง local ว่างไว้ → จอว่าง วน. เกราะ push (emptying)
    //   กันลบจริงผ่าน UI อยู่แล้ว → empty local + sheet มีของ = wedge ชัวร์ ไม่ใช่ "ตั้งใจลบ".
    var corruptLocal = Array.isArray(localRows) &&
                       Array.isArray(sheetRows) && sheetRows.length >= 10 &&
                       localRows.length < sheetRows.length * 0.5;
    if (corruptLocal) {
      console.warn('[WTP Sync] ⚠ anti-wedge: local ' + entity + ' (' + localRows.length +
        ' แถว) เล็กกว่า server (' + sheetRows.length + ' แถว) มากผิดปกติ — ถือว่า local เพี้ยน, ' +
        'รับค่าจากชีตแทน (กันค้าง wedge)');
      try {
        window.dispatchEvent(new CustomEvent('wtpSyncRecovered', {
          detail: { entity: entity, from: localRows.length, to: sheetRows.length }
        }));
      } catch (_) {}
      return {
        rows: preserveAppOnlyFields(sheetRows, localRows, clearableOf(entity)),
        accepted: true, recovered: true,
      };
    }

    if ((hasPending || inGrace) && Array.isArray(localRows)) {
      // protected → คงค่า local ที่กำลังจะ/เพิ่ง push ไว้ ไม่ให้ stale CSV ทับ
      return { rows: localRows, accepted: false };
    }
    var merged = Array.isArray(localRows)
      ? preserveAppOnlyFields(sheetRows, localRows, clearableOf(entity))
      : sheetRows;
    return { rows: merged, accepted: true };
  }

  /* ── HOT refresh: ดึงเฉพาะ CRUD entity (ไม่ดึงแท็บ cold) ───────────
   * ใช้ใน auto-refresh ส่วนใหญ่เพื่อลดจำนวน request → ลด 429
   * แท็บ cold (สรุป/derived) ยังอยู่จาก cachedServerData รอบก่อน */
  function refreshHotEntities() {
    if (!cachedServerData) return loadFromServer();  // ยังไม่มี base → full load
    setSyncStatus('syncing');
    return mapLimit(CRUD_ENTITIES, SHEET_FETCH_CONC, function (n) { return fetchSheet(n); }).then(function (settled) {
      // per-entity fallback: แท็บที่พัง → คงค่าเดิมจาก cache, แท็บที่โหลดได้ → อัปเดตปกติ
      // (ไม่ทิ้งทั้งรอบ — แท็บเดียวชน 429 จะได้ไม่บล็อกแท็บอื่นที่โหลดสำเร็จ)
      var failed = [];
      settled.forEach(function (s, idx) {
        if (s.status === 'rejected') failed.push(CRUD_ENTITIES[idx]);
      });
      if (failed.length) {
        console.warn('[WTP Sync] hot refresh: ' + failed.length + ' แท็บชน 429 — คงค่าเดิม, แท็บอื่นอัปเดตปกติ:',
          failed.join(', '));
      }
      var localData = null;
      try { localData = WTPData.load(); } catch (_) {}
      var data = Object.assign({}, cachedServerData);  // คง cold tab + แท็บที่พัง จาก cache
      CRUD_ENTITIES.forEach(function (e, idx) {
        if (settled[idx].status !== 'fulfilled') return;  // ★ ชีตนี้พัง → คงค่าเดิม (ไม่ทับ)
        var jsonFields = ENTITY_JSON_FIELDS[e] || null;
        var sheetRows = rowsToObjects(settled[idx].value, jsonFields);
        // anti-flip: hot poll รับค่า server ก็ต่อเมื่อ "นิ่ง" (อ่านได้ซ้ำรอบก่อน) — กันยอดเด้งจาก gviz cache ไม่ sync
        var stable = autoReadGate(e, JSON.stringify(sheetRows), true);
        var g = applyEntityGuard(e, sheetRows, localData);
        if (g.accepted && !stable && !g.recovered) return;  // ค่ายังไม่นิ่ง + ไม่มี edit ค้าง → คงค่าเดิม (recovered=anti-wedge รับทันที)
        data[e] = g.rows;
        if (g.accepted) lastSnapshot[e] = JSON.stringify(g.rows);
      });
      cachedServerData = data;
      serverDataLoaded = true;
      origSave(data);
      subscribers.forEach(function (cb) { cb(data); });
      setSyncStatus('ok');
    });
  }

  /* ── WRITE: POST to Apps Script ──────────────────────────────────── */
  function postToServer(body) {
    if (!POST_URL) return Promise.reject(new Error('APPS_SCRIPT_URL not configured'));
    return fetch(POST_URL, {
      method: 'POST',
      // text/plain avoids CORS preflight; Apps Script reads body as plain text and JSON.parse it
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  // Pull current session info — populated by app.jsx login flow.
  // Used to stamp who-did-what on every write so Apps Script can log it.
  function _currentMeta(entity, oldRows, newRows) {
    var sess = null;
    try { sess = JSON.parse(localStorage.getItem('bio-session') || 'null'); } catch (_) {}
    var oldCount = (oldRows && oldRows.length) || 0;
    var newCount = (newRows && newRows.length) || 0;
    var delta    = newCount - oldCount;
    var summary  = entity + ': ' + oldCount + ' → ' + newCount + ' rows' +
                   (delta === 0 ? ' (edits only)' : ' (' + (delta > 0 ? '+' : '') + delta + ')');
    return {
      user:        (sess && sess.username) || 'unknown',
      displayName: (sess && sess.displayName) || '',
      role:        (sess && sess.role) || '',
      diffSummary: summary,
    };
  }

  function pushEntity(entity, rows, oldRows) {
    // baseIds = id ที่ "เคยเห็นบนชีตตอนโหลดล่าสุด" (จาก snapshot ก่อนแก้) — ส่งไปให้
    // เซิร์ฟเวอร์ทำ base reconcile: แถวในชีตที่ไม่อยู่ทั้งใน payload และ baseIds จะถูก
    // เก็บไว้ ไม่ลบ → กันข้อมูลที่ client ยังไม่เห็นถูก replaceAll ลบทิ้ง (ดู Code.standalone.gs)
    var baseIds = (oldRows || []).map(function (r) { return r && r.id; })
                                 .filter(function (x) { return x != null && x !== ''; });
    return postToServer({
      action: 'replaceAll',
      entity: entity,
      payload: rows,
      baseIds: baseIds,
      meta: _currentMeta(entity, oldRows, rows),
    }).then(function (resp) {
      if (resp && resp.error) throw new Error(entity + ': ' + resp.error);
      return resp;
    });
  }

  /* ── Merge helper: prefer non-empty Sheet values for fields empty in app ──
   * Protects against the "replaceAll overwrites manual Sheet edits" bug:
   * if the user fills a cell in the Sheet (e.g. docno for APS/APV) but the
   * app's in-memory row has that field empty, replaceAll would wipe it. This
   * merge keeps the Sheet's value whenever the app's value is null/empty.
   */
  function mergeRowKeepSheetForEmpty(appRow, sheetRow, clearable) {
    if (!sheetRow) return appRow;
    var skip = clearable || {};
    var result = Object.assign({}, appRow);
    Object.keys(sheetRow).forEach(function (k) {
      if (skip[k]) return;  // clearable field → trust app value (allow intentional clear)
      var appVal = result[k];
      var sheetVal = sheetRow[k];
      var appEmpty = appVal == null || appVal === '';
      var sheetHasVal = sheetVal != null && sheetVal !== '';
      if (appEmpty && sheetHasVal) result[k] = sheetVal;
    });
    // Also include sheet-only keys (in case app doesn't have those fields at all)
    Object.keys(sheetRow).forEach(function (k) {
      if (skip[k]) return;  // ห้ามดึง clearable field กลับมา แม้ app ลบ key ทิ้งทั้งตัว (เช่น ล้าง override)
      if (!(k in result)) result[k] = sheetRow[k];
    });
    return result;
  }

  /* ── Preserve app-only fields (fields present in localStorage but NOT in sheet)
   * Use case: app adds new fields (e.g. invType on receipts) before the user
   * adds the matching column in the Sheet. Without this, loadFromServer would
   * wipe those edits every time it runs.
   * Match strategy per entity: try id → receiptNo → ivNo → invoiceNo → fallback
   * to position. */
  function rowKey(r) {
    return r.id || r.receiptNo || r.ivNo || r.invoiceNo || null;
  }
  function preserveAppOnlyFields(sheetRows, localRows, clearable) {
    if (!localRows || !localRows.length) return sheetRows;
    var skip = clearable || {};
    var localByKey = {};
    localRows.forEach(function (r) { var k = rowKey(r); if (k) localByKey[k] = r; });
    return sheetRows.map(function (sr) {
      var k = rowKey(sr);
      var lr = k && localByKey[k];
      if (!lr) return sr;
      var merged = Object.assign({}, sr);
      Object.keys(lr).forEach(function (key) {
        // clearable field → ชีต (server) เป็นความจริง: ค่าว่าง = ถูกล้างตั้งใจ ห้ามฟื้นจาก local
        // (ไม่งั้น "ล้างวันจ่าย/override" จะเด้งกลับทุกครั้งที่โหลด)
        if (skip[key]) return;
        var srVal = sr[key];
        var srHasVal = srVal != null && srVal !== '';
        var lrVal   = lr[key];
        var lrHasVal = lrVal != null && lrVal !== '';
        // Use local value when sheet has nothing meaningful in that cell —
        // covers both "column missing entirely" and "column exists but empty"
        if (!srHasVal && lrHasVal) merged[key] = lrVal;
      });
      return merged;
    });
  }

  /* ── 3-way merge (base / ours / theirs) ──────────────────────────────
   * แก้บั๊ก multi-writer clobber: เดิม mergeRowKeepSheetForEmpty ใช้ค่าแอป
   * (ของเรา) ชนะทุก field ที่ "ไม่ว่าง" → ถ้าคนอื่นเพิ่งแก้ field เดียวกันในชีต
   * ระหว่างที่เราเปิดหน้าค้างไว้ การ replaceAll จะเขียนทับงานของเขาหายเงียบ
   * (followUps หาย, status เด้งกลับ).
   *
   * 3-way merge ตัดสินจาก "ใครเป็นคนแก้จริง" เทียบกับ base (snapshot ที่เรา
   * เห็นล่าสุดก่อนแก้):
   *   - field ที่เราแก้ (ours != base)            → ใช้ของเรา
   *   - field ที่เราไม่แตะ แต่เขาแก้ (theirs != base) → ใช้ของเขา (ค่าสดจากชีต)
   *   - แถวที่คนอื่นเพิ่งเพิ่ม (อยู่ในชีต ไม่อยู่ใน base) → คงไว้ ไม่ลบทิ้ง
   *   - แถวที่เราลบ (อยู่ใน base+ชีต ไม่อยู่ในของเรา) → ลบจริง เว้นแต่คนอื่น
   *     เพิ่งแก้แถวนั้น (theirs != base) ให้คงของเขาไว้ กันลบทับงานเขา
   */
  // เทียบค่าแบบทนความต่างของ "รูปแบบ" ที่เกิดจาก round-trip ผ่าน Google Sheet
  // (กัน sync วนซ้ำไม่จบ: client ดันค่า " 2,160,000.00 " → ชีทคืน "2160000" → ดูเหมือนเปลี่ยน)
  //  • null / undefined / '' / ช่องว่างล้วน → ถือว่าค่าว่างเท่ากัน
  //  • สตริงตัวเลขล้วน (มี , space ฿) เท่ากันเชิงตัวเลข → ถือว่าเท่ากัน
  //  • อื่นๆ → เทียบ deep ตามเดิม (object/array)
  function _scalarEq(a, b) {
    var sa = a == null ? '' : String(a).trim();
    var sb = b == null ? '' : String(b).trim();
    if (sa === sb) return true;
    if (sa === '' || sb === '') return false;            // ว่าง เทียบกับมีค่า = ต่าง
    var ca = sa.replace(/[,\s฿]/g, ''), cb = sb.replace(/[,\s฿]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(ca) && /^-?\d+(\.\d+)?$/.test(cb)) return parseFloat(ca) === parseFloat(cb);
    return false;
  }
  function _eq(a, b) {
    if (a === b) return true;
    var ta = typeof a, tb = typeof b;
    if ((a == null || ta !== 'object') && (b == null || tb !== 'object')) return _scalarEq(a, b);
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (_) { return a === b; }
  }
  function mergeRowFields(base, ours, theirs, clearable) {
    var skip = clearable || {};
    var result = Object.assign({}, ours);
    var keys = {};
    [base, ours, theirs].forEach(function (o) {
      if (o) Object.keys(o).forEach(function (k) { keys[k] = true; });
    });
    Object.keys(keys).forEach(function (k) {
      if (skip[k]) return; // clearable → เชื่อค่าแอปเสมอ (อนุญาตให้ล้างตั้งใจ)
      var weChanged   = !_eq(ours[k], base ? base[k] : undefined);
      var theyChanged = !_eq(theirs[k], base ? base[k] : undefined);
      // เราไม่แก้ field นี้ แต่เขาแก้ → เอาค่าสดของเขา
      if (!weChanged && theyChanged) { result[k] = theirs[k]; return; }
      // ★ ANTI-WIPE: ห้ามให้ "ค่าว่างฝั่งเรา" ลบ "ค่าที่ชีตมีอยู่" (เว้น field ที่ clearable)
      //   กันบั๊ก: user เติมเลขบัญชีในชีต แล้วแอป push pvVouchers ที่ Bank_AC ว่างทับ → หาย
      //   หลักการเดียวกับฝั่งอ่าน (mergeRowKeepSheetForEmpty): เซลล์ว่าง = ไม่มีสิทธิ์ลบของจริง
      var oursEmpty = result[k] == null || result[k] === '';
      var theirsHas = theirs[k] != null && theirs[k] !== '';
      if (oursEmpty && theirsHas) result[k] = theirs[k];
      // กรณีอื่น (เราแก้จริง / ไม่มีใครแก้) → คงของเรา
    });
    return result;
  }
  function threeWayMergeRows(base, ours, theirs, clearable) {
    var baseById = {}, theirsById = {}, ourIds = {};
    (base   || []).forEach(function (r) { if (r && r.id != null) baseById[r.id]   = r; });
    (theirs || []).forEach(function (r) { if (r && r.id != null) theirsById[r.id] = r; });
    var out = [];
    (ours || []).forEach(function (o) {
      if (o == null) return;
      if (o.id == null) { out.push(o); return; } // ไม่มี id → จับคู่ไม่ได้ คงของเรา
      ourIds[o.id] = true;
      var b = baseById[o.id], t = theirsById[o.id];
      if (!b) { out.push(o); return; }            // แถวใหม่ที่เราสร้าง
      if (!t) {                                    // คนอื่นลบแถวนี้ไปจากชีต
        if (!_eq(o, b)) out.push(o);               // เราแก้ → คงของเราไว้ (ไม่ให้ลบกลืน)
        return;                                    // เราไม่แตะ → ยอมรับการลบของเขา
      }
      out.push(mergeRowFields(b, o, t, clearable));
    });
    // แถวที่อยู่ในชีตแต่ไม่อยู่ในของเรา
    (theirs || []).forEach(function (t) {
      if (t == null || t.id == null || ourIds[t.id]) return;
      var b = baseById[t.id];
      if (!b) { out.push(t); return; }             // คนอื่นเพิ่งเพิ่ม → คงไว้
      if (!_eq(t, b)) out.push(t);                 // เราลบ แต่เขาแก้ → คงของเขา
      // เราลบ และเขาไม่แตะ → ลบจริง (ไม่ push)
    });
    return out;
  }

  /* ── dispatcher: row-level (applyDiff) ถ้าเปิด flag + เซิร์ฟเวอร์รองรับ ──────────
   * ถ้า flag ปิด หรือเซิร์ฟเวอร์ยังเก่า (ไม่มี serverVersion = ไม่มี applyDiff) →
   * fallback ไป replaceAll เดิมอัตโนมัติ (ปลอดภัย ไม่พังถ้าลืม deploy) */
  function syncDiff(data) {
    if (ROW_LEVEL && WTPData.serverVersion && WTPData.serverVersion !== 'unknown') {
      return syncDiffRowLevel(data);
    }
    return syncDiffReplaceAll(data);
  }

  /* ── ROW-LEVEL diff: คืน { upserts:[{id,...changedFields}], deletes:[id] } ──────
   * • แถวใหม่ (ไม่มี id / id ไม่อยู่ใน base) → ส่งทั้งแถว
   * • แถวเดิมที่แก้ → ส่งเฉพาะ "ฟิลด์ที่เปลี่ยน" (field-level patch) → เซิร์ฟเวอร์ overlay
   *   ทับเฉพาะฟิลด์นั้น = ฟิลด์ที่เราไม่แตะ คงค่าเดิมบนชีต (กันทับงานคนอื่นแถวเดียวกัน
   *   คนละฟิลด์ ฟรี — เลิกต้องใช้ 3-way merge / mergeRowKeepSheetForEmpty / CLEARABLE)
   * • ฟิลด์ที่ "หาย" จาก ours (ไม่มี key) → ไม่แตะ (ไม่ถือว่าตั้งใจล้าง — กันลบของชีตพลาด)
   *   การล้างตั้งใจ = ฟิลด์มีอยู่แต่ค่าว่าง ('') → เข้าเงื่อนไข "เปลี่ยน" ปกติ */
  function diffEntityRows(baseRows, ourRows) {
    var baseById = {};
    (baseRows || []).forEach(function (r) { if (r && r.id != null) baseById[String(r.id)] = r; });
    var ourIds = {};
    var upserts = [];
    (ourRows || []).forEach(function (r) {
      if (r == null) return;
      if (r.id == null) { upserts.push(r); return; }            // แถวใหม่ไม่มี id
      ourIds[String(r.id)] = true;
      var b = baseById[String(r.id)];
      if (!b) { upserts.push(r); return; }                      // แถวใหม่ (id ไม่อยู่ใน base)
      var patch = null;
      Object.keys(r).forEach(function (k) {
        if (!_eq(r[k], b[k])) { if (!patch) patch = { id: r.id }; patch[k] = r[k]; }
      });
      if (patch) upserts.push(patch);                           // มีฟิลด์เปลี่ยน → ส่ง patch
    });
    var deletes = [];
    (baseRows || []).forEach(function (r) {
      if (r && r.id != null && !ourIds[String(r.id)]) deletes.push(r.id);  // base มี ours ไม่มี = ลบ
    });
    return { upserts: upserts, deletes: deletes };
  }

  /* ── ROW-LEVEL sync: ส่งเฉพาะ diff ผ่าน applyDiff (แก้เฉพาะแถว/ฟิลด์ที่เปลี่ยน) ──
   * เซิร์ฟเวอร์แตะเฉพาะแถวที่ส่งไป แถวอื่นอ่านสดจากชีตใต้ lock → clobber ทั้งตาราง
   * เกิดไม่ได้ (PV 475→465 ตาย). applyDiff คืน rows จริง → ใช้เป็น read-your-writes
   * (อัป snapshot+state จากของจริง ไม่ต้องรอ gviz → ไม่เด้งกลับ) */
  function syncDiffRowLevel(data) {
    if (!POST_URL) return;
    if (inSyncDiff) return;

    var latest = {};
    try { latest = WTPData.load() || {}; } catch (_) {}

    // ★ SKIP_CACHE_KEYS: entities ที่ save() ตัดออกจาก blob โดยตั้งใจ — latest[k] จึง [] เสมอ
    //   ไม่ใช่เพราะ storage เสีย → ต้องกรองออกก่อน storageBroken check + ใช้ data[entity] เสมอ
    var skipCache = (WTPData.SKIP_CACHE_KEYS instanceof Set) ? WTPData.SKIP_CACHE_KEYS : new Set();

    var jobs = [];
    var recovered = false;
    // ★ ตรวจล่วงหน้า: localStorage โดน quota เต็ม (cleared site data → React state ครบ
    //   แต่ origSave throw → ค้างว่าง). ถ้าเจอ → ใช้ React state (param `data`) เป็น
    //   ความจริงทุก entity ทันที (ข้าม `latest` ที่ว่างหลอก) → ไม่ส่ง mass-delete ออกไป
    //   ไม่ไปแตะ push-guard log → ไม่ trigger resync ลูป.
    var storageBroken = false;
    try {
      var ks = ['pvVouchers', 'payables', 'debtLedger', 'invoices', 'projects'];
      var bigSnapEmptyLatest = ks.filter(function (k) {
        if (skipCache.has(k)) return false;                          // ★ [] โดยตั้งใจ ไม่นับ
        if (lastSnapshot[k] === undefined) return false;
        var snap = []; try { snap = JSON.parse(lastSnapshot[k] || '[]'); } catch (_) {}
        var lr = latest[k];
        return snap.length >= 10 && Array.isArray(lr) && lr.length === 0 &&
               Array.isArray(data[k]) && data[k].length > 0;
      });
      if (bigSnapEmptyLatest.length >= 2) storageBroken = true;   // ≥2 entity เป็นเหมือนกัน = quota fail ชัวร์
    } catch (_) {}

    CRUD_ENTITIES.forEach(function (entity) {
      if (lastSnapshot[entity] === undefined) return;          // ยังไม่เคยโหลด server → ข้าม (กัน seed)
      // ★ SKIP_CACHE_KEYS: latest[entity] ว่างโดยตั้งใจ → ใช้ data (React state) เสมอ
      // ★ storageBroken: ข้าม latest ที่ว่างหลอก ใช้ data (React state) เป็นความจริง
      var useReactState = storageBroken || skipCache.has(entity);
      var ours = useReactState
               ? (Array.isArray(data[entity]) ? data[entity] : null)
               : (Array.isArray(latest[entity]) ? latest[entity]
                 : (Array.isArray(data[entity]) ? data[entity] : null));
      if (!ours) return;
      if (JSON.stringify(ours) === lastSnapshot[entity]) return;   // ไม่เปลี่ยน
      var base = [];
      try { base = JSON.parse(lastSnapshot[entity] || '[]'); } catch (_) {}

      var d = diffEntityRows(base, ours);

      // ── เกราะกัน MASS-DELETE (สำคัญสุดสำหรับงานเงิน) ───────────────────────────
      // deletes = base id ที่ ours ไม่มี. ถ้า ours เพี้ยน/ค้างค่าเก่า (wedge เช่นจอค้าง
      // 291 ทั้งที่ชีตมี 565) diff จะสั่งลบหลายร้อยแถวรวด = หายยับ. ลบจริงของผู้ใช้เป็น
      // ทีละน้อยเสมอ → ระงับเฉพาะ "การลบ" (ยังส่ง upsert ปกติ) แล้วดึงของจริงมา resync
      // เมื่อ: ลบเยอะผิดปกติ (> max(40, 20% ของ base)) หรือ ours เล็กกว่า base >30% + มีลบ >10.
      // เอียงไป "ไม่ลบเกินจำเป็น" เด็ดขาด — เก็บข้อมูลไว้ก่อน ผู้ใช้ลบซ้ำทีละน้อยได้.
      // ★ emptying: ours ว่างทั้งที่ base มีของ = เกือบแน่ว่า seed/localStorage ถูกล้าง
      //   (เคสลบ bankAccounts/users 7→0) → ห้าม push เด็ดขาด ดึงของจริงมาแทน
      var emptying    = base.length > 0 && ours.length === 0;
      // floor 8 (เดิม 40 ป้องตารางเล็กไม่ถึง) + threshold 50% → จับการล้างตารางเล็กได้
      var massDel     = d.deletes.length > Math.max(8, Math.floor(base.length * 0.5));
      var wedgeShaped = base.length > 0 && ours.length < base.length * 0.7 && d.deletes.length > 3;
      if (emptying || (d.deletes.length > 0 && (massDel || wedgeShaped))) {
        console.error('[WTP Sync] 🛑 row-level: ' + entity + ' ' + base.length + '→' + ours.length +
          ' ผิดปกติ — ระงับการลบรอบนี้ + ดึงของจริงจากชีตมา resync (กันข้อมูลหายจาก state เพี้ยน/seed)');
        try { window.dispatchEvent(new CustomEvent('wtpSyncBlocked',
          { detail: { blocked: [{ entity: entity, prev: base.length, now: ours.length }] } })); } catch (_) {}
        d.deletes = [];          // ★ ทิ้งการลบ — เก็บข้อมูลไว้ก่อน (upsert ยังไปปกติ ถ้ามี)
        recovered = true;
      }

      if (!d.upserts.length && !d.deletes.length) return;
      jobs.push({ entity: entity, upserts: d.upserts, deletes: d.deletes,
                  baseCount: base.length, oursCount: ours.length });
    });

    if (recovered) { setTimeout(function () { loadFromServer(); }, 1500); }  // resync หลัง push เสร็จ
    if (!jobs.length) return;

    inSyncDiff = true;
    setSyncStatus('syncing');

    Promise.all(jobs.map(function (j) {
      return postToServer({
        action: 'applyDiff',
        entity: j.entity,
        upserts: j.upserts,
        deletes: j.deletes,
        meta: _currentMeta(j.entity, { length: j.baseCount }, { length: j.oursCount }),
      }).then(function (resp) {
        if (resp && resp.error) throw new Error(j.entity + ': ' + resp.error);
        var serverRows = (resp && Array.isArray(resp.rows)) ? resp.rows : null;
        return { entity: j.entity, rows: serverRows, upserts: j.upserts.length, deletes: j.deletes.length };
      });
    })).then(function (results) {
      // read-your-writes: อัป snapshot + localStorage + React จาก rows จริงที่เซิร์ฟเวอร์คืนมา
      // ★ ฐาน = localStorage ล่าสุด (กันทับ entity ที่ไม่ได้แตะ) แล้ว overlay เฉพาะที่ push
      var fresh = {};
      try { fresh = WTPData.load() || {}; } catch (_) {}
      var merged = Object.assign({}, data, fresh);
      var confirmed = [];
      results.forEach(function (r) {
        if (r.rows) {
          merged[r.entity] = r.rows;                          // serverRows = ความจริงหลังเขียน
          lastSnapshot[r.entity] = JSON.stringify(r.rows);    // snapshot ตรงกับ localStorage → diff รอบหน้าสะอาด
        } else {
          lastSnapshot[r.entity] = JSON.stringify(Array.isArray(merged[r.entity]) ? merged[r.entity] : []);
        }
        recentPushAt[r.entity] = Date.now();
        confirmed.push({ entity: r.entity, upserts: r.upserts, deletes: r.deletes });
      });
      origSave(merged);
      subscribers.forEach(function (cb) { cb(merged); });
      setSyncStatus('ok');
      try { window.dispatchEvent(new CustomEvent('wtpSyncConfirmed', { detail: { confirmed: confirmed } })); } catch (_) {}
    }).catch(function (err) {
      console.warn('[WTP Sync] row-level push ล้มเหลว:', err);
      setSyncStatus('error');
    }).then(function () { inSyncDiff = false; }, function () { inSyncDiff = false; });
  }

  function syncDiffReplaceAll(data) {
    if (!POST_URL) return;
    if (inSyncDiff) return;

    // ★ ANTI-CLOBBER: `data` ที่ส่งเข้ามาอาจเป็น "สำเนาเก่า" (ถ่ายไว้ก่อนที่ server sync รอบใหม่
    //   จะเติมแถวเข้า localStorage เช่นมีคน/แท็บอื่นเพิ่งเพิ่มแถว). ถ้า push ตรงๆ = เอาตารางเวอร์ชัน
    //   ที่แถวหายไปทับของใหม่ (clobber → แถวที่เพิ่งเพิ่มหายจากชีต — บั๊กที่ทำ PV หาย 475→465).
    //   กันโดยเทียบกับ localStorage ล่าสุดราย entity แล้วใช้เวอร์ชันที่ "แถวมากกว่า" — เอียงไปทาง
    //   "ไม่ทำข้อมูลหาย" (ปลอดภัยสุดสำหรับงานเงิน). ถ้าผู้ใช้ตั้งใจลบแล้วบังเอิญชนกับ add ของคนอื่น
    //   พอดี การลบจะถูกเลื่อนไปรอบถัดไป (ดีกว่าทำ add ของคนอื่นหาย).
    var latest = {};
    try { latest = WTPData.load() || {}; } catch (_) {}
    function freshestRows(entity) {
      var passed = Array.isArray(data[entity]) ? data[entity] : [];
      var fresh  = Array.isArray(latest[entity]) ? latest[entity] : [];
      return (fresh.length > passed.length) ? fresh : passed;
    }

    var changes = [];
    CRUD_ENTITIES.forEach(function (entity) {
      // ★ gate รายตาราง: ห้าม push entity ที่ "ยังไม่เคยโหลดจากเซิร์ฟเวอร์สำเร็จ"
      //   (lastSnapshot ยัง undefined) — กันการดันสำเนา local/seed ทับชีตทั้งที่ยังไม่รู้
      //   ของจริง. พอโหลดสำเร็จแม้เป็น [] snapshot จะเป็น '[]' (ไม่ใช่ undefined) แล้ว
      if (lastSnapshot[entity] === undefined) return;
      var rows = freshestRows(entity);
      var curr = JSON.stringify(rows);
      if (curr !== lastSnapshot[entity]) {
        changes.push({ entity: entity, currentRows: rows });
      }
    });
    if (!changes.length) return;

    // ── SAFETY GUARD: ห้าม push ถ้า rows น้อยกว่า snapshot เกินครึ่ง ──
    // ป้องกัน race condition ที่ทำให้ app push state เก่า → ชีตหายเป็นจำนวนมาก
    // ถ้าจะลบจริงๆ user ต้องลบทีละน้อยให้ delta ค่อยๆ ลดลง
    var blocked = [];
    var allowed = [];
    changes.forEach(function (c) {
      var prevRows = [];
      try { prevRows = JSON.parse(lastSnapshot[c.entity] || '[]'); } catch (_) {}
      var prevCount = prevRows.length;
      var newCount  = c.currentRows.length;
      // ถ้า snapshot เคยมี ≥10 rows AND ใหม่น้อยกว่าครึ่ง → block
      if (prevCount >= 10 && newCount < prevCount * 0.5) {
        blocked.push({ entity: c.entity, prev: prevCount, now: newCount });
      } else {
        allowed.push(c);
      }
    });
    if (blocked.length) {
      console.error('[WTP Sync] 🛑 ห้าม push: ตรวจพบจะลด rows มากผิดปกติ — น่าจะเป็น race condition',
        blocked.map(function(b){ return b.entity + ': ' + b.prev + ' → ' + b.now; }).join(' · '));
      setSyncStatus('error');
      // ★ แจ้งผู้ใช้ให้เห็น (เดิมขึ้นแค่ console → ผู้ใช้นึกว่าบันทึกไม่ติด เลยทำซ้ำหลายรอบ)
      try {
        window.dispatchEvent(new CustomEvent('wtpSyncBlocked', { detail: { blocked: blocked.slice() } }));
      } catch (_) {}
      // ★ auto-recover: ถ้า "ทั้งรอบ" ถูกบล็อก → ดึงของจริงจากชีตมาตั้งต้นใหม่ (anti-wedge ใน
      //   applyEntityGuard จะทิ้ง local ที่เพี้ยนเล็กผิดปกติ แล้วรับ server) กันค้าง "เพิ่มอะไรก็ไม่ติด"
      if (!allowed.length) { setTimeout(function () { loadFromServer(); }, 0); return; }
    }
    changes = allowed;
    if (!changes.length) return;

    inSyncDiff = true;
    setSyncStatus('syncing');

    // Capture pre-change snapshots for audit log BEFORE step 3 overwrites them
    var preSnapshots = {};
    changes.forEach(function (c) {
      try { preSnapshots[c.entity] = JSON.parse(lastSnapshot[c.entity] || '[]'); }
      catch (_) { preSnapshots[c.entity] = []; }
    });

    // STEP 1: Re-fetch the Sheet for each changed entity (safety check).
    // Prevents stale empty values in the app from overwriting fresh manual
    // edits the user made directly in the Sheet.
    Promise.all(changes.map(function (c) {
      var jsonFields = ENTITY_JSON_FIELDS[c.entity] || null;
      return fetchSheet(c.entity).then(function (rows) {
        return {
          entity: c.entity,
          sheetRows: rowsToObjects(rows, jsonFields),
          currentRows: c.currentRows,
        };
      }, function (err) {
        // re-fetch ล้มเหลว (เช่น HTTP 429 rate-limit) — เดิม Promise.all จะ reject
        // ทำให้ push ทั้งรอบถูกยกเลิก → การแก้/ล้างของ user หายเงียบ + เด้งกลับรอบหน้า
        // แทนที่จะยกเลิก: push currentRows ตรงๆ (ข้าม safety-merge เฉพาะ entity นี้รอบนี้)
        console.warn('[WTP Sync] re-fetch ' + c.entity + ' ล้มเหลว — push ตรงๆ ไม่ merge รอบนี้:', err);
        return { entity: c.entity, sheetRows: null, currentRows: c.currentRows };
      });
    })).then(function (fetched) {
      // STEP 2: 3-way merge (base=preSnapshot / ours=app / theirs=sheet).
      // กันงานของ writer คนอื่นถูกเขียนทับ: field ที่เราไม่ได้แก้ ให้ค่าสดจากชีต
      // ชนะ, แถวที่คนอื่นเพิ่งเพิ่มก็คงไว้ไม่ลบทิ้ง (ดู threeWayMergeRows)
      var safeChanges = fetched.map(function (f) {
        // ★ re-fetch fail (เช่น 429) → ข้าม entity นี้รอบนี้ ไม่ push (กัน push ทับแบบไม่ merge
        //   ที่อาจลบงานของ writer คนอื่น เช่น เลขบัญชีที่เพิ่งเติมในชีต) — รอ retry รอบหน้า
        if (!f.sheetRows) {
          console.warn('[WTP Sync] re-fetch ' + f.entity + ' ล้มเหลว — ข้าม push รอบนี้ retry รอบหน้า (กันทับงานในชีต)');
          return null;
        }
        var clearable = {};
        (CLEARABLE_FIELDS[f.entity] || []).forEach(function (k) { clearable[k] = true; });
        var base = preSnapshots[f.entity] || [];
        var merged = threeWayMergeRows(base, f.currentRows, f.sheetRows, clearable);
        return { entity: f.entity, rows: merged };
      }).filter(Boolean);

      // STEP 3: Update localStorage + notify React with merged data.
      // ★ ยังไม่อัป lastSnapshot ตรงนี้ — รอจน push สำเร็จก่อน (STEP 5)
      //   ไม่งั้นถ้า push ล้มเหลว snapshot จะเลื่อนทั้งที่ขึ้นชีตไม่สำเร็จ →
      //   syncDiff รอบหน้าเห็นว่า "ไม่มีอะไรเปลี่ยน" → ไม่ retry → ข้อมูลเด้งกลับ
      // ★ ฐานต้องเป็น localStorage ล่าสุด (ไม่ใช่ `data` ที่อาจเก่า) — กันการเขียน state เก่าทับ
      //   entity ที่เราไม่ได้แตะ (เช่น server เพิ่งเติมแถวมาระหว่างทาง) แล้วค่อย overlay เฉพาะที่ push
      var freshBase = {};
      try { freshBase = WTPData.load() || {}; } catch (_) {}
      var mergedData = Object.assign({}, data, freshBase);
      safeChanges.forEach(function (c) {
        mergedData[c.entity] = c.rows;
      });
      origSave(mergedData);
      subscribers.forEach(function (cb) { cb(mergedData); });

      // STEP 4: Push merged data to Sheet (with audit metadata — old vs new row counts)
      return Promise.all(safeChanges.map(function (c) {
        return pushEntity(c.entity, c.rows, preSnapshots[c.entity] || []);
      })).then(function () {
        // STEP 5: push สำเร็จแล้วเท่านั้น จึงค่อยอัป snapshot ให้ตรงกับชีต
        // + stamp recentPushAt เพื่อเปิด grace window กัน CSV เก่าเด้งทับ (anti-bounce)
        safeChanges.forEach(function (c) {
          lastSnapshot[c.entity] = JSON.stringify(c.rows);
          recentPushAt[c.entity] = Date.now();
        });
      });
    }).then(function () {
      setSyncStatus('ok');
    }).catch(function (err) {
      console.warn('[WTP Sync] push ล้มเหลว:', err);
      setSyncStatus('error');
    }).then(function () {
      inSyncDiff = false;
    }, function () {
      inSyncDiff = false;
    });
  }

  /* ── มี session ที่ใช้งานได้อยู่ไหม (ล็อกอินอยู่ + ยังไม่หมดอายุ) ───────────────
   * ใช้กั้น "ไม่ล็อกอิน = ไม่ push": เครื่องที่อยู่หน้า LOGIN (ยังไม่ล็อกอิน /
   * โดน auto-logout / session หมดอายุ) จะไม่เขียนข้อมูลขึ้นชีต → ไม่มีการ "ดีด"
   * ข้อมูลในนามคนที่ไม่ได้ใช้งาน. คู่กับ auto-logout idle ใน app.jsx.
   * อ่าน localStorage สดทุกครั้ง (ไม่ cache) เพราะ session เปลี่ยนได้ตลอด. */
  function _hasValidSession() {
    try {
      var s = JSON.parse(localStorage.getItem('bio-session') || 'null');
      if (!s) return false;
      var ttl = cfg.SESSION_TTL_MS || 0;
      if (ttl > 0 && s.time && (Date.now() - s.time) > ttl) return false;
      return true;
    } catch (_) { return false; }
  }

  /* ── wrap WTPData.save to auto-push on every change ──────────────── */
  var origSave = WTPData.save;
  WTPData.save = function (data) {
    origSave(data);
    // Don't push the initial localStorage state — wait until server data has
    // arrived (otherwise we'd overwrite the Sheet with stale local data).
    if (!serverDataLoaded) return;
    // ★ ไม่ล็อกอิน = ไม่ push — กันเครื่องที่เปิดเว็บค้าง/อยู่หน้า LOGIN
    //   ดีดข้อมูลขึ้นชีตในนามคนอื่น (poll รับข้อมูล + normalize หน้าจอ → diff หลอก)
    if (!_hasValidSession()) return;
    // Skip if we're already inside syncDiff (prevents re-entrant loops when
    // syncDiff calls subscribers, which might trigger React → setData → save).
    if (inSyncDiff) return;
    // ★ AUTO-PUSH ACTIVITY GATE — ดันขึ้นชีตอัตโนมัติเฉพาะตอนผู้ใช้ "เพิ่งแตะ" (พิมพ์/คลิก/แก้)
    //   ภายใน window. แท็บที่เปิดค้างเฉยๆ (poll รับข้อมูล → normalize ต่าง → diff หลอก) จะไม่
    //   push ทับชีต = ตัดต้นเหตุข้อมูลหายจากแท็บค้าง. การกดปุ่มบันทึกจริงใช้ forceSyncNow (ข้าม gate นี้).
    if (AUTO_PUSH_REQUIRES_ACTIVITY &&
        (lastUserActivity === 0 || (Date.now() - lastUserActivity) > AUTO_PUSH_ACTIVITY_WINDOW_MS)) {
      return;
    }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncDiff(data); }, 3000);
  };

  // ── ดัก "การแตะของผู้ใช้" (พิมพ์/แก้/คลิกควบคุม) → เปิดสิทธิ์ auto-push ชั่วคราว ───────
  //   ใช้เฉพาะ event ที่สื่อถึง "กำลังทำงานกับข้อมูล" — ไม่นับ mousemove/scroll (แท็บค้างอาจมี)
  try {
    ['keydown', 'input', 'change', 'mousedown', 'touchstart', 'paste'].forEach(function (ev) {
      window.addEventListener(ev, function () { lastUserActivity = Date.now(); }, { passive: true, capture: true });
    });
  } catch (_) {}

  // Diagnostic (read-only): เช็คสถานะ gate จาก console — WTPData._autoPushInfo()
  WTPData._autoPushInfo = function () {
    var since = lastUserActivity ? (Date.now() - lastUserActivity) : null;
    return {
      requiresActivity: AUTO_PUSH_REQUIRES_ACTIVITY,
      windowMs: AUTO_PUSH_ACTIVITY_WINDOW_MS,
      msSinceActivity: since,
      wouldAutoPush: !AUTO_PUSH_REQUIRES_ACTIVITY ||
                     (lastUserActivity > 0 && since <= AUTO_PUSH_ACTIVITY_WINDOW_MS),
    };
  };

  /* ── subscribe (for React) ───────────────────────────────────────── */
  WTPData.subscribe = function (cb) {
    subscribers.push(cb);
    // Replay cached data to late subscribers (fast cached fetches can resolve
    // before React's useEffect registers — without this, React stays stuck
    // on initial localStorage data).
    if (cachedServerData) {
      setTimeout(function () { cb(cachedServerData); }, 0);
    }
    return function () {
      subscribers = subscribers.filter(function (s) { return s !== cb; });
    };
  };

  WTPData.getSyncStatus = function () {
    return {
      status: syncStatus,
      time: lastSyncTime,
      lastError: lastSyncError,
      failedSheets: failedSheets.slice(),
      consecutiveFails: consecutiveFails,
      currentInterval: currentInterval,
    };
  };

  // forceSyncNow: bypass debounce — push pending changes immediately.
  // Call from save handlers ที่ user-triggered (กดปุ่มบันทึก) เพื่อไม่ให้ข้อมูล
  // หายถ้า user refresh ก่อน debounce timer ครบ 3 วินาที
  WTPData.forceSyncNow = function (data) {
    if (!serverDataLoaded) return;
    if (!_hasValidSession()) return;   // ★ ไม่ล็อกอิน = ไม่ push
    if (inSyncDiff) return;
    // ★ ACTIVITY GATE (เหมือน WTPData.save) — กันงาน "ซ่อมข้อมูลอัตโนมัติ" (backfill receipt↔IV)
    //   ที่เรียก forceSyncNow ทุก poll → ดัน push บนแท็บที่เปิดค้าง "ไม่มีคนแตะ" = อาการดีดทุก 3 นาที.
    //   การกดปุ่มบันทึก/แก้ field จริง เกิดทันทีหลัง click/keydown → lastUserActivity สด → ผ่าน gate.
    //   ผล: แท็บเปิดค้างไม่แตะอะไร = เงียบสนิท ไม่ push ทางไหนเลย (ตรงตามที่ผู้ใช้ต้องการ).
    if (AUTO_PUSH_REQUIRES_ACTIVITY &&
        (lastUserActivity === 0 || (Date.now() - lastUserActivity) > AUTO_PUSH_ACTIVITY_WINDOW_MS)) {
      return;
    }
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    // data param optional — use latest from localStorage if not provided
    var d = data || WTPData.load();
    syncDiff(d);
  };

  // ── Presence heartbeat — เขียน "ฉันออนไลน์อยู่" ผ่าน POST เดี่ยวๆ ───────────
  //   ★ ตั้งใจ "ไม่" ผ่าน syncDiff/CRUD_ENTITIES → ไม่ยุ่งกับ diff loop การเงินเลย
  //     (presence push fail = ไม่ poison การ push entity อื่นในรอบเดียวกัน)
  //   ★ เซิร์ฟเวอร์ยังไม่ redeploy → resp.error 'CRUD ไม่รองรับ entity: presence' → เงียบ
  //     (degrade graceful: หน้า "ใครออนไลน์" แค่ว่าง ไม่พัง) · server ไม่ลง audit ให้ presence
  WTPData.pushPresence = function (row) {
    if (!POST_URL) return;
    if (!_hasValidSession()) return;       // ไม่ล็อกอิน = ไม่เขียน (เหมือน guard อื่น)
    if (!row || !row.id) return;
    return postToServer({
      action:  'applyDiff',
      entity:  'presence',
      upserts: [row],
      deletes: [],
      meta: { user: row.username || '', displayName: row.displayName || '',
              role: row.role || '', diffSummary: 'presence' },
    }).then(function (resp) { return resp; }, function () { /* network error → เงียบ */ });
  };

  // ── Forced row delete (ผู้ใช้ตั้งใจลบจริง) — ส่ง allowShrink=true ข้ามเกราะกันลบฝั่งเซิร์ฟเวอร์ ──
  //   ใช้กับการลบที่เป็น "เจตนาชัดเจน" (เช่นปุ่ม "ยกเลิกบันทึกจ่ายจริง" หน้ากระทบยอด) ที่ normally
  //   จะโดน protect-ACTUAL ของ applyDiff บล็อก (กัน clobber). คืน Promise; อัป snapshot+local
  //   จาก rows จริงที่เซิร์ฟเวอร์คืน (read-your-writes) เพื่อให้ generic syncDiff รอบหน้าไม่มี diff หลอก
  WTPData.forceDeleteRows = function (entity, ids) {
    if (!POST_URL) return Promise.resolve();
    if (!_hasValidSession()) return Promise.resolve();   // ไม่ล็อกอิน = ไม่เขียน
    var delIds = (Array.isArray(ids) ? ids : [ids])
      .filter(function (x) { return x != null && x !== ''; }).map(String);
    if (!delIds.length) return Promise.resolve();
    return postToServer({
      action: 'applyDiff', entity: entity, upserts: [], deletes: delIds, allowShrink: true,
      meta: _currentMeta(entity, null, null),
    }).then(function (resp) {
      if (resp && resp.error) throw new Error(resp.error);
      var serverRows = (resp && Array.isArray(resp.rows)) ? resp.rows : null;
      if (serverRows) {
        var fresh = {};
        try { fresh = WTPData.load() || {}; } catch (_) {}
        fresh[entity] = serverRows;
        lastSnapshot[entity] = JSON.stringify(serverRows);
        recentPushAt[entity] = Date.now();
        origSave(fresh);
        subscribers.forEach(function (cb) { cb(fresh); });
      }
      return resp;
    }, function (err) { console.warn('[WTP Sync] forceDeleteRows ล้มเหลว:', err && err.message); });
  };

  // Flush pending sync on page unload (best-effort, may not complete)
  window.addEventListener('beforeunload', function () {
    if (!_hasValidSession()) return;   // ★ ไม่ล็อกอิน = ไม่ flush
    if (syncTimer && !inSyncDiff) {
      clearTimeout(syncTimer);
      try { syncDiff(WTPData.load()); } catch (_) {}
    }
  });

  // ── Ping backend: log ว่า "เซิร์ฟเวอร์ที่รันจริง" เป็นเวอร์ชันไหน ──────────────
  // กันกรณีลืม redeploy Apps Script แล้วไม่รู้ตัว (โค้ดใหม่ไม่ทำงานแต่เงียบ → ข้อมูล
  // ยังหายเหมือนเดิมแล้วงงว่าทำไมแก้แล้วไม่หาย). อ่านอย่างเดียว ไม่เขียนอะไร.
  // เปิด DevTools Console จะเห็นบรรทัด "[WTP Sync] server <version>" — ถ้าไม่เห็น
  // version หรือขึ้นเตือน = ยังไม่ได้ deploy โค้ดเซิร์ฟเวอร์ใหม่.
  WTPData.serverVersion = null;
  function pingServerVersion() {
    if (!POST_URL) return;
    fetch(POST_URL + '?action=ping', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        var sv = (resp && resp.serverVersion) || null;
        WTPData.serverVersion = sv || 'unknown';
        if (sv) {
          console.info('%c[WTP Sync] server ' + sv, 'color:#0a7d3c;font-weight:bold');
        } else {
          console.warn('[WTP Sync] ⚠ เซิร์ฟเวอร์ยังไม่มี serverVersion — น่าจะยังไม่ได้ ' +
            'redeploy Apps Script เวอร์ชันใหม่ (LockService/applyDiff ยังไม่ทำงาน)');
        }
        try {
          window.dispatchEvent(new CustomEvent('wtpServerVersion', {
            detail: { serverVersion: WTPData.serverVersion }
          }));
        } catch (_) {}
      })
      .catch(function (err) { console.warn('[WTP Sync] ping เซิร์ฟเวอร์ไม่สำเร็จ:', err && err.message); });
  }

  // First load
  loadFromServer();
  pingServerVersion();

  // Auto-refresh (ใช้ restartAutoTimer เพื่อให้ adaptive backoff ทำงานได้)
  if (AUTO_MS > 0) {
    currentInterval = AUTO_MS;
    restartAutoTimer();
  }

  // ── Page Visibility — กลับมาที่ tab → sync ทันทีถ้าค้างเกิน 10 วินาที
  // (กัน user เปิด tab ค้างไว้ครึ่งวันแล้วเปิดมาเห็นข้อมูลเก่า)
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    var sinceLastOk = lastSyncTime ? (Date.now() - lastSyncTime.getTime()) : Infinity;
    if (sinceLastOk > 10000) {
      console.info('[WTP Sync] กลับมาที่ tab — refresh ทันที (last ok:', Math.round(sinceLastOk / 1000), 'วินาทีก่อน)');
      loadFromServer();
    }
  });

  // Expose manual refresh
  WTPData.refreshFromServer = loadFromServer;

  // Diagnostic: fetch raw rows from a specific Sheet tab, optionally filter by predicate.
  // Useful to verify what the Sheet actually contains vs what the app shows.
  WTPData.fetchSheetRows = function (entity, predicate) {
    return fetchSheet(entity).then(function (rows) {
      var jsonFields = ENTITY_JSON_FIELDS[entity] || null;
      var objs = rowsToObjects(rows, jsonFields);
      return predicate ? objs.filter(predicate) : objs;
    });
  };

  // Diagnostic: fetch RAW header+row pairs (position-preserving, includes duplicates).
  // Returns { headers: [...], row: [...] } for the first row matching predicate.
  // This bypasses rowsToObjects so duplicate headers are visible.
  WTPData.fetchSheetRowRaw = function (entity, matchCol, matchVal) {
    return fetchSheet(entity).then(function (rows) {
      if (!rows.length) return null;
      var headers = rows[0];
      var colIdx = headers.indexOf(matchCol);
      if (colIdx < 0) return { headers: headers, row: null, error: 'ไม่พบคอลัมน์ ' + matchCol };
      for (var i = 1; i < rows.length; i++) {
        if (rows[i][colIdx] === matchVal) {
          return { headers: headers, row: rows[i] };
        }
      }
      return { headers: headers, row: null };
    });
  };

})();
