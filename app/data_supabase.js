/* =====================================================================
 * data_supabase.js — Supabase (Postgres + Realtime) backend adapter
 * โหลดหลังจาก config.js + data.js + data_sync.js
 *
 * เปิดทำงานเฉพาะเมื่อ WTP_CONFIG.BACKEND === 'supabase' (ไม่งั้น early-return เงียบ
 * แล้วปล่อยให้ data_sync.js (Google Sheets) ทำงานตามเดิม).
 *
 * ★ เป้าหมาย: "คง interface WTPData เดิมเป๊ะ" → app.jsx + ทุก page_*.jsx ไม่ต้องแก้.
 *   เมธอดที่ define: load(คงเดิม) · save · subscribe · getSyncStatus · forceSyncNow ·
 *   refreshFromServer · pushPresence · forceDeleteRows · fetchSheetRows ·
 *   fetchSheetRowRaw · serverVersion · _autoPushInfo · buildId
 *
 * ★ Postgres consistent (อ่านหลังเขียนเห็นทันที + เขียนทีละแถว + realtime push) →
 *   ทิ้งเกราะกัน "เด้งกลับ/ข้อมูลหาย" 7 ชั้นของ Sheets ได้ (grace/anti-flip/
 *   base-reconcile/3-way merge/CLEARABLE/hot-cold/mass-delete heuristic).
 *   คงไว้แค่เกราะเบา: ไม่ล็อกอิน=ไม่ push + activity-gate (กันแท็บค้างดัน diff หลอก) +
 *   light mass-delete guard (กัน cache เพี้ยนสั่งลบทั้งตาราง).
 * ===================================================================== */
(function () {
  'use strict';

  var BUILD_ID = '20260617s2';
  var cfg = window.WTP_CONFIG || {};

  // ── เปิดเฉพาะโหมด supabase ─────────────────────────────────────────
  if ((cfg.BACKEND || 'sheets') !== 'supabase') return;

  console.info('%c[WTP Supabase] build ' + BUILD_ID + ' — Postgres + Realtime backend (no Sheets sync)',
               'color:#0a7d3c;font-weight:bold');
  try { if (window.WTPData) WTPData.buildId = BUILD_ID; } catch (_) {}

  var SUPA_URL = cfg.SUPABASE_URL || '';
  var SUPA_KEY = cfg.SUPABASE_ANON_KEY || '';

  /* ── ถ้าตั้งค่าไม่ครบ / supabase-js ไม่โหลด → define stub กัน app พัง ───────── */
  function installStub(reason) {
    console.error('[WTP Supabase] ' + reason + ' — แอปจะรันจาก localStorage cache เท่านั้น (ไม่ sync). ' +
      'ตรวจ SUPABASE_URL / SUPABASE_ANON_KEY ใน config.js และ <script> supabase-js ใน index.html');
    WTPData.getSyncStatus = function () { return { status: 'error', time: null, lastError: reason }; };
    WTPData.subscribe = function (cb) {
      // replay localStorage cache 1 ครั้ง เพื่อให้ React มีข้อมูลแสดง (offline-ish)
      try { var d = WTPData.load(); setTimeout(function () { cb(d); }, 0); } catch (_) {}
      return function () {};
    };
    WTPData.forceSyncNow    = function () {};
    WTPData.refreshFromServer = function () {};
    WTPData.pushPresence    = function () {};
    WTPData.forceDeleteRows = function () { return Promise.resolve(); };
    WTPData.fetchSheetRows  = function () { return Promise.resolve([]); };
    WTPData.fetchSheetRowRaw = function () { return Promise.resolve(null); };
    WTPData._autoPushInfo   = function () { return { backend: 'supabase', ok: false, reason: reason }; };
    WTPData.serverVersion   = 'supabase-misconfig';
  }
  if (!SUPA_URL || !SUPA_KEY) { installStub('ขาด SUPABASE_URL / SUPABASE_ANON_KEY'); return; }
  if (!window.supabase || !window.supabase.createClient) { installStub('supabase-js ยังไม่โหลด'); return; }

  var sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
    // persistSession/autoRefresh เปิดไว้ — Phase 4 (USE_SUPABASE_AUTH) ใช้ session คุม RLS;
    // ถ้ายังไม่เปิด flag ก็ไม่มีใครเรียก authSignIn → ไม่มี session (ไม่กระทบ anon flow)
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  /* ── entity lists (ให้ตรงกับ CRUD_KEYS ใน data.js + CRUD_ENTITIES ใน data_sync.js) ─ */
  // CRUD_ENTITIES = entity ที่ push ผ่าน save()/diff (presence เขียนผ่าน pushPresence แยก)
  var CRUD_ENTITIES = ['projects', 'invoices', 'forecastEntries',
                       'bankAccounts', 'pvVouchers', 'payables',
                       'debtLedger', 'receipts', 'bankEntries', 'checks',
                       'debtMaster', 'bankTransfers',
                       'stsServiceFee', 'stsPendingCalc', 'stsCalcResult',
                       'debtEvents', 'users', 'cashflowSnapshots',
                       'followUpsLog', 'manualOverrides',
                       'bankReconLines', 'bankReconState',
                       'bankReconBook', 'bankReconMatch'];
  var ALL_TABLES = CRUD_ENTITIES.concat(['presence']);   // 25 ตาราง อ่านทั้งหมดตอน load
  var TABLE_SET  = {}; ALL_TABLES.forEach(function (t) { TABLE_SET[t] = true; });

  // ตาราง analytics ที่อ่าน/เขียนแบบ on-demand (ไม่ preload, ไม่อยู่ใน realtime/diff loop) —
  // หน้า P&L/Budget เรียกผ่าน fetchSheetRows (อ่าน) + WTPData.writeTable (นำเข้า)
  var SHEET_TABLES = ['pnlBase', 'budgetHo', 'cashflowPresent'];
  var SHEET_TABLE_SET = {}; SHEET_TABLES.forEach(function (t) { SHEET_TABLE_SET[t] = true; });

  // entity ที่ data.js ตัดออกจาก localStorage (กัน quota) → load() ไม่มี → ต้องใช้ React state / cachedData
  var skipCache = (WTPData.SKIP_CACHE_KEYS instanceof Set) ? WTPData.SKIP_CACHE_KEYS : new Set();

  var AUTO_PUSH_REQUIRES_ACTIVITY  = cfg.AUTO_PUSH_REQUIRES_ACTIVITY !== false;   // default true
  var AUTO_PUSH_ACTIVITY_WINDOW_MS = cfg.AUTO_PUSH_ACTIVITY_WINDOW_MS || 120000;

  /* ── state ─────────────────────────────────────────────────────────── */
  var subscribers      = [];
  var cachedData       = null;          // full data object ล่าสุด (รวม non-CRUD seed skeleton)
  var lastSnapshot     = {};            // entity → JSON ของแถวล่าสุดที่รู้จาก server (baseline diff)
  var serverDataLoaded = false;         // gate auto-push จนกว่าจะอ่าน server ครั้งแรกสำเร็จ
  var syncStatus       = 'syncing';
  var lastSyncTime     = null;
  var lastSyncError    = null;
  var syncTimer        = null;
  var inSyncDiff       = false;
  var lastUserActivity = 0;             // ts แตะล่าสุด; 0 = แท็บค้าง/เพิ่งเปิด → ไม่ auto-push

  function setSyncStatus(s, err) {
    syncStatus = s;
    if (s === 'ok') { lastSyncTime = new Date(); lastSyncError = null; }
    else if (s === 'error') { lastSyncError = err || 'error'; }
  }

  /* ── session / meta helpers (port จาก data_sync.js) ─────────────────── */
  function _hasValidSession() {
    try {
      var s = JSON.parse(localStorage.getItem('bio-session') || 'null');
      if (!s) return false;
      var ttl = cfg.SESSION_TTL_MS || 0;
      if (ttl > 0 && s.time && (Date.now() - s.time) > ttl) return false;
      return true;
    } catch (_) { return false; }
  }
  function _currentMeta() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem('bio-session') || 'null'); } catch (_) {}
    return {
      user:        (s && (s.username || s.user)) || 'unknown',
      displayName: (s && s.displayName) || '',
      role:        (s && s.role) || '',
    };
  }

  /* ── row mapping: {id, data} (record ใน Postgres) ↔ row ของแอป ─────────── */
  function recToRow(rec) {
    var row = (rec && rec.data) || {};
    if (row.id == null && rec) row.id = rec.id;     // กัน data ไม่มี id (ไม่ควรเกิด)
    return row;
  }
  function rowToRec(row) {
    if (row.id == null) row.id = WTPData.newId();   // ทุกแถวต้องมี id (= PK); สร้างถ้าขาด
    return { id: String(row.id), data: row };
  }

  /* ── select ทั้งตาราง (paginate ทีละ 1000 — PostgREST จำกัด 1000/ครั้ง) ──────
   *   ★ ถ้าไม่ page: debtLedger 3964 แถวจะได้แค่ 1000 = ข้อมูลขาด */
  var PAGE = 1000;
  function selectAll(table) {
    var all = [], from = 0;
    function next() {
      // ★ .order('id') = ลำดับแถวคงที่ทุกครั้ง. SELECT ที่ไม่มี ORDER BY ไม่การันตีลำดับ —
      //   Postgres คืนตาม heap ซึ่งขยับเมื่อแถวถูก UPDATE → ลำดับบัญชีในหน้า Daily/Bank Diary
      //   (ที่อิง index ของ array) เด้งไปมา. ยังจำเป็นต่อความถูกต้องของ pagination (range)
      //   ของ entity ใหญ่ (debtLedger ~4000) ไม่ให้แถวซ้ำ/หายข้ามหน้า.
      return sb.from(table).select('id,data').order('id', { ascending: true }).range(from, from + PAGE - 1).then(function (res) {
        if (res.error) throw res.error;
        var rows = res.data || [];
        all = all.concat(rows);
        if (rows.length < PAGE) return all;
        from += PAGE;
        return next();
      });
    }
    return next();
  }

  /* ── โหลดข้อมูลทั้งหมดจาก Supabase แล้วประกอบ data object ──────────────── */
  function loadFromServer() {
    setSyncStatus('syncing');
    // base = seed skeleton (มี non-CRUD keys: meta/pipeline/warroom/daily/cashFlow/...) + CRUD ว่าง
    var base;
    try { base = WTPData.load() || {}; } catch (_) { base = {}; }

    return Promise.all(ALL_TABLES.map(function (t) {
      return selectAll(t).then(
        function (recs) { return { t: t, rows: recs.map(recToRow), ok: true }; },
        function (err)  {
          console.warn('[WTP Supabase] โหลดตาราง', t, 'ล้มเหลว:', err && err.message);
          return { t: t, rows: null, ok: false, err: err && err.message };
        }
      );
    })).then(function (results) {
      var anyFail = false, firstErr = null;
      results.forEach(function (r) {
        if (r.ok) {
          var rows = r.rows;
          if (r.t === 'presence') rows = rows.filter(function (x) { return x && x.username; });
          base[r.t] = rows;
          lastSnapshot[r.t] = JSON.stringify(rows);
        } else {
          anyFail = true; if (!firstErr) firstErr = r.err;
          // ★ ตารางที่โหลดไม่สำเร็จ: คงค่าเดิมจาก cachedData/base ไว้ (ห้ามทับด้วย [] = data loss)
          if (cachedData && Array.isArray(cachedData[r.t])) base[r.t] = cachedData[r.t];
          else if (!Array.isArray(base[r.t])) base[r.t] = [];
          // ไม่ตั้ง lastSnapshot ตารางที่ fail → save() จะข้าม (lastSnapshot undefined = ยังไม่รู้ baseline)
          if (lastSnapshot[r.t] === undefined && Array.isArray(base[r.t])) {
            // ไม่เซ็ต baseline จาก cache (กัน push diff หลอกจากค่า cache) — รอโหลดสำเร็จรอบหน้า
          }
        }
      });

      cachedData = base;
      serverDataLoaded = true;
      setSyncStatus(anyFail ? 'error' : 'ok', firstErr);
      try { origSave(cachedData); } catch (_) {}
      subscribers.forEach(function (cb) { try { cb(cachedData); } catch (_) {} });
      ensureRealtime();
      return cachedData;
    }).catch(function (err) {
      setSyncStatus('error', err && err.message);
      console.error('[WTP Supabase] โหลดล้มเหลว:', err && err.message);
    });
  }

  /* ── Realtime: 1 channel ฟังทุกตาราง public แล้ว apply เข้า cache + แจ้ง React ── */
  var rtChannel = null;
  function ensureRealtime() {
    if (rtChannel) return;
    rtChannel = sb.channel('wtp-all')
      .on('postgres_changes', { event: '*', schema: 'public' }, function (payload) {
        try { applyRealtime(payload); } catch (e) { console.warn('[WTP Supabase] realtime apply error:', e && e.message); }
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') console.info('[WTP Supabase] realtime พร้อม (push)');
      });
  }
  function applyRealtime(payload) {
    var t = payload.table;
    if (!TABLE_SET[t] || !cachedData) return;      // เฉพาะตาราง entity ที่รู้จัก
    var list = Array.isArray(cachedData[t]) ? cachedData[t].slice() : [];
    var changed = false;
    if (payload.eventType === 'DELETE') {
      var delId = payload.old && payload.old.id;
      if (delId != null) {
        var before = list.length;
        list = list.filter(function (r) { return String(r.id) !== String(delId); });
        changed = list.length !== before;
      }
    } else {
      // INSERT / UPDATE
      var row = recToRow(payload.new);
      if (t === 'presence' && !(row && row.username)) return;
      var k = String(row.id);
      var idx = -1;
      for (var i = 0; i < list.length; i++) { if (String(list[i].id) === k) { idx = i; break; } }
      if (idx >= 0) {
        if (JSON.stringify(list[idx]) !== JSON.stringify(row)) { list[idx] = row; changed = true; }
      } else { list.push(row); changed = true; }
    }
    if (!changed) return;
    cachedData[t] = list;
    lastSnapshot[t] = JSON.stringify(list);        // อัป baseline = ความจริงจาก server (กัน push ทับงานคนอื่น)
    try { origSave(cachedData); } catch (_) {}
    subscribers.forEach(function (cb) { try { cb(cachedData); } catch (_) {} });
  }

  /* ── diff: เทียบ base (snapshot) กับ ours → {upserts:[row], deleteIds:[id]} ──────
   *   ★ ทั้งแถว (whole-row) ไม่ใช่ field-patch — เพราะ jsonb เก็บทั้งแถวเป็นค่าเดียว
   *     upsert จึงแทน data ทั้งก้อนอยู่แล้ว. (Postgres consistent + realtime ทำให้
   *     state ของแต่ละคนสดก่อน save → ความเสี่ยง lost-field ระหว่างคน ~ศูนย์) */
  function diffRows(base, ours) {
    var baseById = {};
    (base || []).forEach(function (r) { if (r && r.id != null) baseById[String(r.id)] = r; });
    var ids = {}, upserts = [];
    (ours || []).forEach(function (r) {
      if (r == null) return;
      if (r.id == null) r.id = WTPData.newId();
      var k = String(r.id); ids[k] = true;
      var b = baseById[k];
      if (!b || JSON.stringify(r) !== JSON.stringify(b)) upserts.push(r);
    });
    var deleteIds = [];
    (base || []).forEach(function (r) {
      if (r && r.id != null && !ids[String(r.id)]) deleteIds.push(String(r.id));
    });
    return { upserts: upserts, deleteIds: deleteIds };
  }

  // หาแถวของ entity จาก data param (React state) ก่อน, fallback cachedData (กัน skipCache/partial)
  function rowsFor(data, e) {
    if (data && Array.isArray(data[e])) return data[e];
    if (cachedData && Array.isArray(cachedData[e])) return cachedData[e];
    return null;
  }

  function chk(res) { if (res && res.error) throw res.error; return res; }

  /* ── push diff ขึ้น Supabase (upsert/delete ทีละแถว) ───────────────────── */
  function pushDiff(data) {
    if (inSyncDiff) return Promise.resolve();
    var jobs = [];
    CRUD_ENTITIES.forEach(function (e) {
      if (lastSnapshot[e] === undefined) return;          // ยังไม่เคยโหลด server → ข้าม (กัน push ค่า seed/cache)
      var ours = rowsFor(data, e);
      if (!ours) return;
      var oursJSON = JSON.stringify(ours);
      if (oursJSON === lastSnapshot[e]) return;           // ไม่เปลี่ยน
      var baseRows = []; try { baseRows = JSON.parse(lastSnapshot[e] || '[]'); } catch (_) {}
      var d = diffRows(baseRows, ours);

      // ── เกราะเบากัน mass-delete (cache เพี้ยน/แท็บค้าง สั่งลบทั้งตาราง) ──
      if (d.deleteIds.length && baseRows.length >= 10 &&
          d.deleteIds.length > Math.max(8, baseRows.length * 0.5)) {
        console.warn('[WTP Supabase] ⚠ ข้าม mass-delete ' + e + ': base ' + baseRows.length +
          ' → ลบ ' + d.deleteIds.length + ' (น่าสงสัย) — ลบจริงให้ใช้ forceDeleteRows');
        d.deleteIds = [];
      }
      if (!d.upserts.length && !d.deleteIds.length) return;
      jobs.push({ e: e, ours: ours, oursJSON: oursJSON, diff: d });
    });
    if (!jobs.length) return Promise.resolve();

    inSyncDiff = true;
    setSyncStatus('syncing');
    var ps = [];
    jobs.forEach(function (job) {
      if (job.diff.upserts.length) ps.push(sb.from(job.e).upsert(job.diff.upserts.map(rowToRec)).then(chk));
      if (job.diff.deleteIds.length) ps.push(sb.from(job.e).delete().in('id', job.diff.deleteIds).then(chk));
    });
    return Promise.all(ps).then(function () {
      // read-your-writes: อัป snapshot + cache จากของที่เพิ่ง push → รอบหน้าไม่เกิด diff หลอก
      jobs.forEach(function (job) {
        lastSnapshot[job.e] = job.oursJSON;
        if (cachedData) cachedData[job.e] = job.ours;
      });
      setSyncStatus('ok');
      logAudit(jobs);
    }, function (err) {
      setSyncStatus('error', err && err.message);
      console.error('[WTP Supabase] push ล้มเหลว:', err && err.message);
    }).then(function () { inSyncDiff = false; });
  }

  /* ── audit: เขียน best-effort (ไม่บล็อก, error เงียบ) ─────────────────── */
  function logAudit(jobs) {
    try {
      var meta = _currentMeta();
      var rows = jobs.map(function (j) {
        return {
          username: meta.user, display_name: meta.displayName, role: meta.role,
          action: 'applyDiff', entity: j.e,
          summary: j.e + ': ' + j.diff.upserts.length + ' upsert, ' + j.diff.deleteIds.length + ' delete',
        };
      });
      if (rows.length) sb.from('audit_log').insert(rows).then(function () {}, function () {});
    } catch (_) {}
  }

  /* ── wrap WTPData.save (auto-push debounced) ───────────────────────── */
  var origSave = WTPData.save;
  WTPData.save = function (data) {
    origSave(data);
    if (!serverDataLoaded) return;
    if (!_hasValidSession()) return;                    // ไม่ล็อกอิน = ไม่ push
    if (inSyncDiff) return;
    // activity gate — แท็บค้างไม่แตะอะไร = ไม่ push (กัน diff หลอกจาก poll/normalize)
    if (AUTO_PUSH_REQUIRES_ACTIVITY &&
        (lastUserActivity === 0 || (Date.now() - lastUserActivity) > AUTO_PUSH_ACTIVITY_WINDOW_MS)) {
      return;
    }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { pushDiff(data); }, 1500);
  };

  // ดัก "การแตะของผู้ใช้" → เปิดสิทธิ์ auto-push ชั่วคราว (เหมือน data_sync.js)
  try {
    ['keydown', 'input', 'change', 'mousedown', 'touchstart', 'paste'].forEach(function (ev) {
      window.addEventListener(ev, function () { lastUserActivity = Date.now(); }, { passive: true, capture: true });
    });
  } catch (_) {}

  /* ── forceSyncNow: push ทันที (ข้าม debounce + activity gate) ─────────── */
  WTPData.forceSyncNow = function (data) {
    if (!serverDataLoaded) return;
    if (!_hasValidSession()) return;
    if (inSyncDiff) return;
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    var d = data || cachedData || WTPData.load();
    pushDiff(d);
  };

  /* ── forceDeleteRows: ลบจริงตามเจตนา (ข้ามเกราะ mass-delete) ──────────── */
  WTPData.forceDeleteRows = function (entity, ids) {
    if (!_hasValidSession()) return Promise.resolve();
    var delIds = (Array.isArray(ids) ? ids : [ids])
      .filter(function (x) { return x != null && x !== ''; }).map(String);
    if (!delIds.length) return Promise.resolve();
    return sb.from(entity).delete().in('id', delIds).then(chk).then(function () {
      // อัป cache/snapshot ทันที (read-your-writes)
      if (cachedData && Array.isArray(cachedData[entity])) {
        var del = {}; delIds.forEach(function (x) { del[x] = true; });
        cachedData[entity] = cachedData[entity].filter(function (r) { return !del[String(r.id)]; });
        lastSnapshot[entity] = JSON.stringify(cachedData[entity]);
        try { origSave(cachedData); } catch (_) {}
        subscribers.forEach(function (cb) { try { cb(cachedData); } catch (_) {} });
      }
    }, function (err) { console.warn('[WTP Supabase] forceDeleteRows ล้มเหลว:', err && err.message); });
  };

  /* ── writeTable: เขียนทั้งตาราง (full sync) สำหรับ analytics on-demand (P&L/Budget นำเข้า) ──
   *   rows = แถวของแอป, idOf(row)→id (natural key เช่น code / dept|acct).
   *   upsert ทุกแถว + ลบ id ที่หายไปจากชุดใหม่. ต้อง login (RLS: เขียน=staff/manager).
   *   คืน Promise<{ok,count,deleted}>. */
  WTPData.writeTable = function (entity, rows, idOf) {
    if (!_hasValidSession()) return Promise.reject(new Error('ต้องเข้าสู่ระบบก่อน'));
    var recs = (rows || []).map(function (r) {
      var id = idOf ? idOf(r) : (r && r.id);
      return { id: String(id == null ? '' : id), data: r };
    }).filter(function (x) { return x.id && x.id !== 'undefined'; });
    var newIds = {}; recs.forEach(function (x) { newIds[x.id] = true; });
    return selectAll(entity).then(function (existing) {
      var delIds = (existing || []).map(function (x) { return String(x.id); })
        .filter(function (id) { return !newIds[id]; });
      var ps = [];
      if (recs.length)  ps.push(sb.from(entity).upsert(recs).then(chk));
      if (delIds.length) ps.push(sb.from(entity).delete().in('id', delIds).then(chk));
      return Promise.all(ps).then(function () { return { ok: true, count: recs.length, deleted: delIds.length }; });
    }).then(function (res) {
      try {
        var m = _currentMeta();
        sb.from('audit_log').insert([{ username: m.user, display_name: m.displayName, role: m.role,
          action: 'writeTable', entity: entity, summary: entity + ': เขียน ' + res.count + ' แถว (ลบ ' + res.deleted + ')' }])
          .then(function () {}, function () {});
      } catch (_) {}
      return res;
    });
  };

  /* ── backupExport: อ่านทุกตารางจาก Supabase → object {app,exportedAt,tables} ──
   *   ใช้โดยหน้า "สำรอง/กู้คืน" (#backup) — แทน tools/supabase-backup.html ที่ต้อง login แยก.
   *   อ่าน ALL_TABLES + SHEET_TABLES (P&L/Budget/cashflowPresent).
   *   onProgress(table, count, idx, total, errMsg?) เรียกต่อตาราง (count=-1 = error). */
  WTPData.backupExport = function (onProgress) {
    if (!_hasValidSession()) return Promise.reject(new Error('ต้องเข้าสู่ระบบก่อน'));
    var tables = ALL_TABLES.concat(SHEET_TABLES);
    var out = { app: 'bioaxel-fin', exportedAt: new Date().toISOString(), tables: {} };
    var i = 0;
    function nx() {
      if (i >= tables.length) return out;
      var t = tables[i++];
      return selectAll(t).then(function (recs) {
        out.tables[t] = (recs || []).map(function (r) { return (r && r.data) || r; });
        if (onProgress) { try { onProgress(t, out.tables[t].length, i, tables.length); } catch (_) {} }
        return nx();
      }, function (err) {
        out.tables[t] = [];
        if (onProgress) { try { onProgress(t, -1, i, tables.length, err && err.message); } catch (_) {} }
        return nx();
      });
    }
    return Promise.resolve().then(nx);
  };

  /* ── restoreUpsert: กู้คืนจากไฟล์ backup — upsert ตาม id (non-destructive) ──
   *   ★ ไม่ลบแถวที่มีใน DB แต่ไม่มีในไฟล์ → เหมาะกับ "กู้แถวที่หาย" ไม่ใช่ rollback ทั้งระบบ
   *     (ต่างจาก writeTable ที่ลบ id ที่หายไป). batch 500. คืน Promise<{restored,skipped}>. */
  WTPData.restoreUpsert = function (tables, onProgress) {
    if (!_hasValidSession()) return Promise.reject(new Error('ต้องเข้าสู่ระบบก่อน'));
    var known = {}; ALL_TABLES.concat(SHEET_TABLES).forEach(function (t) { known[t] = true; });
    var BATCH = 500;
    var keys = Object.keys(tables || {});
    var summary = { restored: {}, skipped: [] };
    function upsertAll(t, recs) {
      var j = 0;
      function step() {
        if (j >= recs.length) return Promise.resolve();
        return sb.from(t).upsert(recs.slice(j, j + BATCH)).then(chk).then(function () { j += BATCH; return step(); });
      }
      return step();
    }
    var i = 0;
    function nx() {
      if (i >= keys.length) {
        try {
          var m = _currentMeta();
          var nT = Object.keys(summary.restored).length;
          var nR = Object.keys(summary.restored).reduce(function (s, k) { return s + Math.max(0, summary.restored[k]); }, 0);
          sb.from('audit_log').insert([{ username: m.user, display_name: m.displayName, role: m.role,
            action: 'restore', entity: 'backup', summary: 'กู้คืน ' + nT + ' ตาราง รวม ' + nR + ' แถว' }])
            .then(function () {}, function () {});
        } catch (_) {}
        return summary;
      }
      var t = keys[i++];
      if (!known[t]) { summary.skipped.push(t); if (onProgress) { try { onProgress(t, -2, i, keys.length); } catch (_) {} } return nx(); }
      var rows = (tables[t] || []).filter(function (r) { return r && r.id != null; });
      if (!rows.length) { summary.restored[t] = 0; if (onProgress) { try { onProgress(t, 0, i, keys.length); } catch (_) {} } return nx(); }
      var recs = rows.map(function (r) { return { id: String(r.id), data: r }; });
      return upsertAll(t, recs).then(function () {
        summary.restored[t] = recs.length;
        if (onProgress) { try { onProgress(t, recs.length, i, keys.length); } catch (_) {} }
        return nx();
      }, function (err) {
        summary.restored[t] = -1;
        if (onProgress) { try { onProgress(t, -1, i, keys.length, err && err.message); } catch (_) {} }
        return nx();
      });
    }
    return Promise.resolve().then(nx);
  };

  /* ── pushPresence: upsert แถว presence (best-effort, แยกจาก diff loop) ──── */
  WTPData.pushPresence = function (row) {
    if (!_hasValidSession()) return;
    if (!row || !row.id) return;
    return sb.from('presence').upsert({ id: String(row.id), data: row }).then(function () {}, function () {});
  };

  /* ── subscribe (React) ─────────────────────────────────────────────── */
  WTPData.subscribe = function (cb) {
    subscribers.push(cb);
    if (cachedData) setTimeout(function () { cb(cachedData); }, 0);   // replay ให้ subscriber ที่มาช้า
    return function () { subscribers = subscribers.filter(function (s) { return s !== cb; }); };
  };

  WTPData.getSyncStatus = function () {
    return { status: syncStatus, time: lastSyncTime, lastError: lastSyncError,
             failedSheets: [], consecutiveFails: 0, currentInterval: 0 };
  };

  WTPData.refreshFromServer = loadFromServer;

  /* ── fetchSheetRows: route CRUD + analytics + auditLog → Supabase; ที่เหลือ → gviz ──
   *   CRUD (TABLE_SET) + P&L/Budget (SHEET_TABLE_SET) อ่านจากตาราง {id,data};
   *   auditLog อ่านจากตาราง audit_log (columnar). gviz fallback เหลือไว้เผื่อชีตอื่นเท่านั้น. */
  WTPData.fetchSheetRows = function (entity, predicate) {
    if (TABLE_SET[entity] || SHEET_TABLE_SET[entity]) {
      return selectAll(entity).then(function (recs) {
        var objs = recs.map(recToRow);
        if (entity === 'presence') objs = objs.filter(function (r) { return r && r.username; });
        return predicate ? objs.filter(predicate) : objs;
      });
    }
    // auditLog → อ่านจากตาราง audit_log ใน Supabase (columnar, ไม่ใช่ {id,data})
    //   map คอลัมน์ → key ที่ page_audit_log._norm เข้าใจ. ดึง 3000 รายการล่าสุดพอ
    //   (page โชว์ tail 200; RLS อ่าน=manager เท่านั้น ตรงกับ route ที่ manager-only).
    if (entity === 'auditLog') {
      return sb.from('audit_log').select('*').order('ts', { ascending: false }).limit(3000)
        .then(function (res) {
          if (res.error) throw res.error;
          var objs = (res.data || []).map(function (r) {
            return {
              timestamp: r.ts, user: r.username, displayName: r.display_name,
              role: r.role, action: r.action, entity: r.entity, summary: r.summary,
            };
          });
          return predicate ? objs.filter(predicate) : objs;
        }, function (err) {
          console.warn('[WTP Supabase] อ่าน audit_log ล้มเหลว:', err && err.message);
          return [];
        });
    }
    // non-CRUD sheet → gviz fallback
    var jsonFields = (entity === 'invoices') ? ['followUps', 'actualReceive']
                    : (entity === 'stsCalcResult') ? ['debtIds'] : null;
    return gvizFetch(entity).then(function (rows) {
      var objs = gvizRowsToObjects(rows, jsonFields);
      return predicate ? objs.filter(predicate) : objs;
    }).catch(function (err) {
      console.warn('[WTP Supabase] fetchSheetRows(' + entity + ') gviz fallback ล้มเหลว:', err && err.message);
      return [];
    });
  };

  WTPData.fetchSheetRowRaw = function (entity, matchCol, matchVal) {
    return gvizFetch(entity).then(function (rows) {
      if (!rows.length) return null;
      var headers = rows[0];
      var colIdx = headers.indexOf(matchCol);
      if (colIdx < 0) return { headers: headers, row: null, error: 'ไม่พบคอลัมน์ ' + matchCol };
      for (var i = 1; i < rows.length; i++) { if (rows[i][colIdx] === matchVal) return { headers: headers, row: rows[i] }; }
      return { headers: headers, row: null };
    }).catch(function () { return null; });
  };

  /* ── gviz fallback helpers (สำหรับชีต non-CRUD เท่านั้น) — port จาก data_sync.js ── */
  var GVIZ_BASE = cfg.SHEET_ID
    ? 'https://docs.google.com/spreadsheets/d/' + cfg.SHEET_ID + '/gviz/tq?tqx=out:csv&sheet='
    : '';
  function gvizFetch(name) {
    if (!GVIZ_BASE) return Promise.resolve([]);
    return fetch(GVIZ_BASE + encodeURIComponent(name) + '&_t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(name + ': HTTP ' + r.status); return r.text(); })
      .then(gvizParseCSV);
  }
  function gvizParseCSV(text) {
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQ = true; }
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\r') { /* skip */ }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else { field += ch; }
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function gvizRowsToObjects(rows, jsonFields) {
    if (!rows || rows.length < 2) return [];
    var headers = (rows[0] || []).map(function (h) { return h == null ? h : String(h).replace(/[​-‍﻿]/g, '').trim(); });
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
        var ex = obj[h];
        if (ex != null && ex !== '' && (v == null || v === '')) return;
        obj[h] = v;
      });
      out.push(obj);
    }
    return out;
  }

  /* ── diagnostics ───────────────────────────────────────────────────── */
  WTPData.serverVersion = 'supabase';
  WTPData._autoPushInfo = function () {
    var since = lastUserActivity ? (Date.now() - lastUserActivity) : null;
    return {
      backend: 'supabase',
      requireActivity: AUTO_PUSH_REQUIRES_ACTIVITY,
      windowMs: AUTO_PUSH_ACTIVITY_WINDOW_MS,
      msSinceActivity: since,
      wouldAutoPush: !AUTO_PUSH_REQUIRES_ACTIVITY ||
                     (lastUserActivity > 0 && since <= AUTO_PUSH_ACTIVITY_WINDOW_MS),
      serverDataLoaded: serverDataLoaded,
    };
  };
  try {
    window.dispatchEvent(new CustomEvent('wtpServerVersion', { detail: { serverVersion: 'supabase' } }));
  } catch (_) {}

  /* ── flush pending push ตอนปิดหน้า (best-effort) ──────────────────────── */
  window.addEventListener('beforeunload', function () {
    if (!_hasValidSession()) return;
    if (syncTimer && !inSyncDiff) { clearTimeout(syncTimer); try { pushDiff(cachedData || WTPData.load()); } catch (_) {} }
  });

  /* ── กลับมาที่ tab → refresh (กัน realtime หลุดช่วง tab ค้าง) ─────────────── */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    var since = lastSyncTime ? (Date.now() - lastSyncTime.getTime()) : Infinity;
    if (since > 30000) loadFromServer();
  });

  /* ── Phase 4: Supabase Auth (ใช้เมื่อ config.USE_SUPABASE_AUTH = true) ──────────
   *   login จับคู่ username → "<username>@<AUTH_EMAIL_DOMAIN>" แล้ว signInWithPassword.
   *   หลัง SIGNED_IN → reload (request จะพก JWT → ผ่าน RLS). role มาจาก app_metadata. */
  var AUTH_DOMAIN = cfg.AUTH_EMAIL_DOMAIN || 'waterpog.app';
  WTPData.authSignIn = function (username, password) {
    var email = String(username == null ? '' : username).trim().toLowerCase() + '@' + AUTH_DOMAIN;
    return sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) throw res.error;
      var u = (res.data && res.data.user) || {};
      var meta = u.app_metadata || {};
      return {
        username:    meta.username || username,
        displayName: meta.displayName || meta.display_name || username,
        role:        meta.role || 'viewer',
      };
    });
  };
  WTPData.authSignOut = function () {
    try { return sb.auth.signOut().then(function () {}, function () {}); } catch (_) { return Promise.resolve(); }
  };
  // หลัง login สำเร็จ → โหลดข้อมูลใหม่ด้วย session (JWT) เพื่อให้ผ่าน RLS เมื่อเปิดใช้
  try {
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_IN') loadFromServer();
    });
  } catch (_) {}

  /* ── first load ────────────────────────────────────────────────────── */
  loadFromServer();
})();
