// BIOAXEL Financial Dashboard – App shell, sidebar nav, routing, tweaks integration.
// Globals: React, ReactDOM, all dashboards & pages, WTPData

const { useState: aState, useEffect: aEffect, useMemo: aMemo } = React;

// ─── One-time stale-projects cache reset (2026-06-15) ───────────────────────
// อาการ: บางเครื่อง cache projects ค้างจำนวนเก่า (เช่น 319) < ชีตจริง (648) →
//   anti-wedge เด้งวนไม่หยุด (ข้อมูลไม่หาย เพราะระบบยึดชีต แต่ log รก + เครื่องหน่วง).
// แก้: ล้าง "เฉพาะ projects" ใน cache รอบเดียว — คง users ไว้ให้ยังล็อกอินได้ —
//   + ทิ้ง snapshot 120-คอลัมน์เก่า → บังคับ re-sync projects จากชีต (648) แล้วค้างนิ่ง.
// flag กันรันซ้ำ. ปลอดภัย: anti-empty-push + server base-reconcile กันดัน [] ทับชีต.
(function () {
  try {
    if (localStorage.getItem('bio-proj-resync-v1') === '1') return;
    var raw = localStorage.getItem('bio-fin-data-v8');
    if (raw) {
      var c = JSON.parse(raw);
      if (c && Array.isArray(c.projects)) { c.projects = []; localStorage.setItem('bio-fin-data-v8', JSON.stringify(c)); }
    }
    localStorage.removeItem('bio-proj-control-v2'); // ทิ้ง snapshot เก่า → ใช้ data.projects (synced 648) แทน
    localStorage.setItem('bio-proj-resync-v1', '1');
  } catch (_) {}
})();

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "themeMode": "green",
  "accentHue": 150,
  "fontPair": "plex",
  "density": "regular",
  "showAnimations": true,
  "sidebarStyle": "filled"
}/*EDITMODE-END*/;

// ─── Role-based permission system ──────────────────────────────────────────
//
// Routes accessible per role + action flags. Read via window.WTPAuth.* helpers
// from any page. Role is set at login (in handleLogin) and persists in the
// session object in localStorage; it never changes mid-session so a simple
// global-object pattern is enough (no Context / re-render churn needed).
const ROLE_PERMS = {
  // ผู้บริหาร — เห็นเฉพาะ Dashboard (รายงานรับเงินรายวัน + War Room) — ไม่เห็นประมาณการ
  viewer: {
    pages: new Set(['home', 'daily', 'warroom1', 'warroom2', 'cashflow_present']),
    canEdit: false, canDelete: false, canApprove: false, canManageUsers: false,
  },
  // ฝ่ายการเงิน — ทำงานปกติ เพิ่ม/แก้ได้ แต่ลบไม่ได้ + ไม่เห็น audit + users
  staff: {
    pages: '*', excludePages: new Set(['users', 'audit_log', 'backup']),
    canEdit: true, canDelete: false, canApprove: true, canManageUsers: false,
  },
  // หัวหน้า — ทำได้ทุกอย่าง รวมจัดการ users + ดู audit log
  manager: {
    pages: '*',
    canEdit: true, canDelete: true, canApprove: true, canManageUsers: true,
  },
  // เจ้าของ — ดูได้ทุกหน้า แต่แก้/ลบไม่ได้ + ไม่เห็น audit + users + บันทึก/บัญชีธนาคาร
  owner: {
    pages: '*', excludePages: new Set(['users', 'audit_log', 'backup', 'daily_balance', 'data_bank', 'bank_diary', 'bank_recon']),
    canEdit: false, canDelete: false, canApprove: false, canManageUsers: false,
  },
};
function _getRole() {
  try {
    const s = JSON.parse(localStorage.getItem('bio-session') || 'null');
    return (s && s.role) || 'viewer';
  } catch { return 'viewer'; }
}
function _getPerms(role) { return ROLE_PERMS[role] || ROLE_PERMS.viewer; }
window.WTPAuth = {
  role() { return _getRole(); },
  can(action) { return _getPerms(_getRole())[action] === true; },
  canViewPage(route) {
    const p = _getPerms(_getRole());
    if (p.pages === '*') return !p.excludePages || !p.excludePages.has(route);
    return p.pages.has(route);
  },
  // First page this role is allowed to see — used for redirecting after login
  firstAllowedPage(allRoutes) {
    return allRoutes.find(r => this.canViewPage(r)) || 'daily';
  },
};

// ★ Loading state กลางจอ — โชว์ระหว่างดึงข้อมูลจาก server รอบแรก (แทนหน้าว่าง/ศูนย์)
function DataLoadingState() {
  return (
    <div className="wtp-loading">
      <div className="wtp-loading-spin" aria-hidden="true" />
      <div className="wtp-loading-text">กำลังโหลดข้อมูล…</div>
      <div className="wtp-loading-sub">ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์</div>
    </div>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = aState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('bio-session') || 'null');
      if (!s) return false;
      const ttl = (window.WTP_CONFIG && window.WTP_CONFIG.SESSION_TTL_MS) || 0;
      if (ttl > 0 && Date.now() - s.time > ttl) { localStorage.removeItem('bio-session'); return false; }
      // บังคับ re-login: session ที่สร้างก่อน FORCE_LOGOUT_BEFORE → เด้งออกทันทีที่โหลดโค้ดใหม่
      const flb = (window.WTP_CONFIG && window.WTP_CONFIG.FORCE_LOGOUT_BEFORE) || 0;
      if (flb > 0 && s.time && s.time < flb) { localStorage.removeItem('bio-session'); return false; }
      return true;
    } catch { return false; }
  });
  const [currentUser, setCurrentUser] = aState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('bio-session') || 'null');
      return s || null;
    } catch { return null; }
  });

  const handleLogin = (userObj) => {
    const session = { ...userObj, time: Date.now() };
    localStorage.setItem('bio-session', JSON.stringify(session));
    setCurrentUser(session);
    setIsLoggedIn(true);
    // ทุกคนที่ login เข้ามาต้องเจอหน้า Home ก่อนเสมอ (ไม่ว่า hash เดิมจะค้างหน้าไหน)
    try { window.location.hash = '#home'; } catch (_) {}
    setRoute('home');
  };
  const handleLogout = () => {
    try { if (WTPData.authSignOut) WTPData.authSignOut(); } catch (_) {}   // Phase 4: เคลียร์ Supabase session ด้วย
    localStorage.removeItem('bio-session');
    setIsLoggedIn(false);
    setCurrentUser(null);
  };

  const [route, setRoute] = aState(() => {
    const h = window.location.hash.replace(/^#/, '');
    return h || 'home';
  });
  const [data, setData] = aState(() => WTPData.load());
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const { push: pushToast, node: toastNode } = useToasts();
  const [syncInfo, setSyncInfo] = aState(() => WTPData.getSyncStatus ? WTPData.getSyncStatus() : { status: 'offline', time: null });
  // ★ Loading state: true เมื่อข้อมูลจริงจาก server มาถึงครั้งแรกแล้ว (subscribe callback แรก)
  //   ใช้โชว์ "กำลังโหลด…" แทนหน้าว่าง/ศูนย์ ตอน fetch รอบแรก (เฉพาะตอน cache ยังว่าง)
  const [firstLoadDone, setFirstLoadDone] = aState(false);

  // Persist data on change + expose globally for debugging in DevTools console
  // + expose setData for WTPOverride (cloud-shared manual overrides)
  aEffect(() => {
    WTPData.save(data);
    window.__wtpData = data;
    window.__wtpSetData = setData;
    if (WTPData.buildLookups) {
      try { window.__wtpLookups = WTPData.buildLookups(data); } catch (_) {}
    }
  }, [data]);

  // Fire wtp-override-change เฉพาะเมื่อ data.manualOverrides เปลี่ยน
  // → EditableNumber/useOverrideSub re-render เมื่อ cloud sync ดึงค่าใหม่จาก user อื่น
  aEffect(() => {
    window.dispatchEvent(new CustomEvent('wtp-override-change', { detail: { key: '*' } }));
  }, [data.manualOverrides]);

  // ── ติด class role-<role> ที่ <body> เพื่อให้ CSS ซ่อน ✏️ ของ owner ได้ทุกตำแหน่ง
  aEffect(() => {
    const role = (currentUser && currentUser.role) || 'viewer';
    // ลบ class เก่าก่อน
    document.body.className = document.body.className.replace(/\brole-[a-z]+\b/g, '').trim();
    document.body.classList.add(`role-${role}`);
  }, [currentUser]);

  // ── One-time migration: ดัน localStorage overrides ขึ้น cloud (รอบเดียวต่อ user)
  // ทุก user ที่เคยกรอกค่ามือไว้ใน localStorage จะถูก push ขึ้น Sheet อัตโนมัติ
  // เพื่อให้คนอื่น (ผู้บริหาร) มองเห็นค่าเดียวกัน
  const migratedRef = React.useRef(false);
  aEffect(() => {
    if (migratedRef.current) return;
    // รอจน manualOverrides โหลดจาก server เสร็จ (จะเป็น array แม้ว่าง)
    if (!Array.isArray(data.manualOverrides)) return;
    if (localStorage.getItem('bio-override-migrated-v1') === '1') {
      migratedRef.current = true;
      return;
    }
    try {
      const local = JSON.parse(localStorage.getItem('bio-manual-overrides') || '{}');
      const localKeys = Object.keys(local);
      if (localKeys.length === 0) {
        localStorage.setItem('bio-override-migrated-v1', '1');
        migratedRef.current = true;
        return;
      }
      const existingKeys = new Set(data.manualOverrides.map(r => r && r.key).filter(Boolean));
      const toAdd = localKeys.filter(k => !existingKeys.has(k));
      if (toAdd.length === 0) {
        localStorage.setItem('bio-override-migrated-v1', '1');
        migratedRef.current = true;
        return;
      }
      let updatedBy = '';
      try { updatedBy = (JSON.parse(localStorage.getItem('bio-session') || 'null') || {}).username || ''; } catch (_) {}
      const updatedAt = new Date().toISOString();
      const newRows = toAdd.map(key => ({
        id: `ov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_${key.slice(0, 8)}`,
        key, value: Number(local[key]), updatedBy, updatedAt,
      }));
      setData(d => ({ ...d, manualOverrides: [...(d.manualOverrides || []), ...newRows] }));
      localStorage.setItem('bio-override-migrated-v1', '1');
      migratedRef.current = true;
      pushToast && pushToast(`อัปโหลดค่า manual override ${newRows.length} รายการขึ้นระบบกลาง — ผู้ใช้คนอื่นจะเห็นแล้ว`);
    } catch (_) { /* non-fatal */ }
  }, [data.manualOverrides]);

  // Subscribe to server data updates (from data_sync.js / data_supabase.js)
  aEffect(() => {
    if (!WTPData.subscribe) { setFirstLoadDone(true); return; }
    const unsub = WTPData.subscribe(serverData => {
      setData(serverData);
      setFirstLoadDone(true);   // ★ ข้อมูลจริงจาก server มาถึงแล้ว → เลิกโชว์ loading
    });
    const onStatus = e => setSyncInfo(e.detail);
    window.addEventListener('wtpSyncStatus', onStatus);
    // กันค้าง: ถ้า server โหลดไม่สำเร็จ/ไม่ยิง callback ใน 12 วิ → เลิกโชว์ loading (โชว์หน้าตามจริง)
    const failSafe = setTimeout(() => setFirstLoadDone(true), 12000);
    return () => { unsub(); clearTimeout(failSafe); window.removeEventListener('wtpSyncStatus', onStatus); };
  }, []);

  // ── แจ้งเตือนผู้ใช้เมื่อ sync ถูกบล็อก/รีซิงค์ (เดิมขึ้นแค่ใน console ผู้ใช้ไม่เห็น
  //    เลยนึกว่า "เพิ่มแล้วไม่ติด" → ทำซ้ำหลายรอบ). data_sync.js dispatch event เหล่านี้.
  aEffect(() => {
    // throttle: กัน toast เด้งรัวตอน wedge วน (โชว์ได้ไม่เกิน 1 ครั้ง/12 วิ)
    let lastGuardToast = 0;
    const guardThrottled = () => {
      const now = Date.now();
      if (now - lastGuardToast < 12000) return false;
      lastGuardToast = now; return true;
    };
    // toast sync ทั้งหมดปิดเงียบ (ผู้ใช้ขอ 2026-06-14 — เด้งบ่อยรำคาญ)
    //   onBlocked (guard กันข้อมูลหาย) / onRecovered / onConfirmed
    //   การบันทึก·ดึงข้อมูล·guard ยังทำงานปกติทุกอย่าง — แค่ "ไม่เด้ง popup"
    //   onBlocked ยัง log ลง console ไว้ debug (guardThrottled กัน log รัว)
    const onBlocked = (e) => {
      if (!guardThrottled()) return;
      const list = ((e.detail && e.detail.blocked) || [])
        .map(b => `${b.entity} (${b.prev}→${b.now})`).join(', ');
      console.warn('[WTP Sync] guard บล็อกการเปลี่ยนแปลงผิดปกติ' + (list ? ' (' + list + ')' : '') + ' · ดึงข้อมูลจริงจากชีตแทน');
    };
    const onRecovered = () => {};
    const onConfirmed = () => {};
    window.addEventListener('wtpSyncBlocked', onBlocked);
    window.addEventListener('wtpSyncRecovered', onRecovered);
    window.addEventListener('wtpSyncConfirmed', onConfirmed);
    return () => {
      window.removeEventListener('wtpSyncBlocked', onBlocked);
      window.removeEventListener('wtpSyncRecovered', onRecovered);
      window.removeEventListener('wtpSyncConfirmed', onConfirmed);
    };
  }, []);

  // ── Auto-logout เมื่อไม่ได้ใช้งานเกินกำหนด (idle timeout) ──────────────────
  // เครื่องที่เปิดเว็บค้างไว้เฉยๆ จะถูกเด้งกลับหน้า LOGIN อัตโนมัติ เพื่อ:
  //   (1) ไม่ให้ sync ดีดข้อมูลขึ้นชีตในนามคนที่ไม่ได้ใช้งาน (audit log ขึ้นชื่อผิด)
  //       — คู่กับ guard "ไม่ล็อกอิน = ไม่ push" ใน data_sync.js
  //   (2) ความปลอดภัย (เครื่องวางทิ้งไว้)
  // วัด activity จาก mouse/keyboard/scroll/touch แล้วเช็คทุก 30 วิ. นอกจากนี้
  // ยังเช็ค session หมดอายุ (SESSION_TTL_MS) ขณะเปิดแท็บค้าง — เดิมเช็คแค่ตอนโหลดหน้า
  const lastActivityRef = React.useRef(Date.now());
  aEffect(() => {
    if (!isLoggedIn) return;
    const IDLE_MS = (window.WTP_CONFIG && window.WTP_CONFIG.IDLE_LOGOUT_MS) || 0;
    const TTL_MS  = (window.WTP_CONFIG && window.WTP_CONFIG.SESSION_TTL_MS) || 0;
    if (IDLE_MS <= 0 && TTL_MS <= 0) return;  // ปิดทั้งคู่ → ไม่ต้องทำอะไร
    lastActivityRef.current = Date.now();
    let lastBump = 0;
    const bump = () => {
      const now = Date.now();
      if (now - lastBump < 5000) return;   // throttle: อัปเดตทุก ~5 วิพอ (กันยิงรัวตอนขยับเมาส์)
      lastBump = now;
      lastActivityRef.current = now;
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(ev => window.addEventListener(ev, bump, { passive: true }));
    const doLogout = (reason) => {
      handleLogout();
      try {
        pushToast && pushToast(
          reason === 'ttl'  ? 'ออกจากระบบอัตโนมัติ (เซสชันหมดอายุ) — กรุณาเข้าสู่ระบบใหม่'
        : reason === 'kick' ? 'ระบบบังคับออกจากระบบ (ผู้ดูแลสั่งรีเซ็ต) — กรุณาเข้าสู่ระบบใหม่'
        :                     'ออกจากระบบอัตโนมัติ (ไม่ได้ใช้งานเกิน 30 นาที) — กรุณาเข้าสู่ระบบใหม่');
      } catch (_) {}
    };
    const checkIdle = () => {
      const now = Date.now();
      let sessTime = 0;
      try { sessTime = (JSON.parse(localStorage.getItem('bio-session') || 'null') || {}).time || 0; } catch (_) {}
      // บังคับออก (admin สั่งผ่าน override `system.forceLogoutBefore` หรือ config FORCE_LOGOUT_BEFORE)
      if (sessTime > 0 && sessTime < forceLogoutThreshold()) { doLogout('kick'); return; }
      if (TTL_MS > 0 && sessTime > 0 && (now - sessTime) > TTL_MS) { doLogout('ttl'); return; }
      if (IDLE_MS > 0 && (now - lastActivityRef.current) > IDLE_MS) { doLogout('idle'); return; }
    };
    const timer = setInterval(checkIdle, 30000);   // เช็คทุก 30 วิ
    const onVis = () => { if (!document.hidden) checkIdle(); };  // กลับมาที่แท็บ → เช็คทันที
    document.addEventListener('visibilitychange', onVis);
    return () => {
      events.forEach(ev => window.removeEventListener(ev, bump));
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [isLoggedIn]);

  // เส้นตายบังคับ logout = ค่ามากสุดระหว่าง config (deploy นี้) กับ override ที่ admin สั่งสด
  // session ใดที่ "สร้างก่อน" ค่านี้ → ถูกเด้งออก. ใช้ใน checkIdle + effect ด้านล่าง
  const forceLogoutThreshold = () => {
    let t = (window.WTP_CONFIG && window.WTP_CONFIG.FORCE_LOGOUT_BEFORE) || 0;
    try {
      const ov = Number(window.WTPOverride && WTPOverride.get('system.forceLogoutBefore'));
      if (ov && ov > t) t = ov;
    } catch (_) {}
    return t;
  };

  // เมื่อ poll ดึง manualOverrides ใหม่มา (admin กดปุ่ม "บังคับทุกคนออกจากระบบ") → เช็คทันที
  // (ไม่ต้องรอ interval 30 วิ) ให้เด้งออกเร็วที่สุดเท่าที่ข้อมูลมาถึง
  aEffect(() => {
    if (!isLoggedIn) return;
    let sessTime = 0;
    try { sessTime = (JSON.parse(localStorage.getItem('bio-session') || 'null') || {}).time || 0; } catch (_) {}
    if (sessTime > 0 && sessTime < forceLogoutThreshold()) {
      handleLogout();
      try { pushToast && pushToast('ระบบบังคับออกจากระบบ (ผู้ดูแลสั่งรีเซ็ต) — กรุณาเข้าสู่ระบบใหม่'); } catch (_) {}
    }
  }, [data.manualOverrides, isLoggedIn]);

  // ── Presence heartbeat: บอกระบบว่า "ฉันออนไลน์อยู่" (เห็นได้ในหน้า Users) ──────
  // เขียนผ่าน WTPData.pushPresence (POST เดี่ยว ไม่ผ่าน syncDiff, ไม่ลง audit).
  // เขียนเฉพาะเมื่อ: ล็อกอินอยู่ + แท็บกำลังถูกมอง (visible) + ยัง active (ภายใน 1 ช่วง
  // heartbeat) → คนที่เปิดค้างแล้ว idle (ใกล้โดน auto-logout) จะหยุด heartbeat เอง
  aEffect(() => {
    if (!isLoggedIn) return;
    const HB = (window.WTP_CONFIG && window.WTP_CONFIG.PRESENCE_HEARTBEAT_MS) || 0;
    if (HB <= 0 || !WTPData.pushPresence) return;
    const beat = () => {
      if (document.hidden) return;
      if ((Date.now() - lastActivityRef.current) > HB) return;   // idle → ข้าม
      let s = null; try { s = JSON.parse(localStorage.getItem('bio-session') || 'null'); } catch (_) {}
      if (!s || !s.username) return;
      WTPData.pushPresence({
        id: s.username, username: s.username,
        displayName: s.displayName || s.username, role: s.role || '',
        lastSeen: Date.now(),
      });
    };
    beat();                                  // ครั้งแรกทันทีตอนล็อกอิน/โหลด
    const t = setInterval(beat, HB);
    return () => clearInterval(t);
  }, [isLoggedIn]);

  // ── Global auto-backfill: paid IV ที่ยังไม่มี receipt → สร้างให้ ─────────
  // CRITICAL: ต้องอ่าน d.receipts ใน updater (ไม่ใช่ closure) — closure อาจ
  // stale ถ้า server data update มาระหว่าง effect run กับ setData fire →
  // ทำให้ updatedData มี receipts snapshot เก่าทับ server data ใหม่ → ชีตหาย
  aEffect(() => {
    if (!data || !data.invoices || !data.invoices.length) return;
    if (!WTPData.ensureReceiptForPaidInvoice) return;
    // Quick check: any paid IV without a matching receipt? — ใช้ closure ได้
    // เพราะแค่เช็ค "ต้อง backfill ไหม" ไม่ใช่ใช้ค่าจริง
    const closureReceipts = data.receipts || [];
    const closureIvNos = new Set(closureReceipts.map(r => r.invoiceNo).filter(Boolean));
    const paidNeedingBackfill = data.invoices.filter(iv =>
      iv.status === 'paid' && iv.actualReceive && iv.actualReceive.date &&
      iv.ivNo && !closureIvNos.has(iv.ivNo));
    if (paidNeedingBackfill.length === 0) return;
    // Real work: setData with updater so we use the LATEST d.receipts
    let updatedData;
    setData(d => {
      // SAFETY: if d.receipts is empty/undefined AND we know server has data,
      // skip backfill this round to avoid wiping the sheet. The next data
      // update will retrigger this effect with the real receipts loaded.
      if (!d.receipts || d.receipts.length === 0) {
        console.warn('[WTP] skip backfill — d.receipts empty (server may not have loaded yet)');
        return d;
      }
      let receipts = [...d.receipts];
      const existingIvNos = new Set(receipts.map(r => r.invoiceNo).filter(Boolean));
      let added = 0;
      paidNeedingBackfill.forEach(iv => {
        if (existingIvNos.has(iv.ivNo)) return;
        const before = receipts.length;
        receipts = WTPData.ensureReceiptForPaidInvoice(receipts, iv);
        if (receipts.length > before) {
          added++;
          existingIvNos.add(iv.ivNo);
        }
      });
      if (added === 0) return d;
      console.info('[WTP] auto-created ' + added + ' receipt(s) for paid IVs missing receipts');
      updatedData = { ...d, receipts };
      return updatedData;
    });
    if (updatedData && WTPData.forceSyncNow) {
      setTimeout(() => WTPData.forceSyncNow(updatedData), 0);
    }
  }, [data.invoices]);

  // ── Global auto-backfill (ทางกลับ): มี receipt แล้ว → flip ใบ IV เป็น paid ────────
  // receipt = เงินเข้าจริง = ความจริงหลัก. เดิม backfill ทางเดียว (IV paid → สร้าง receipt)
  // แต่ "มี receipt แต่ใบ IV ยัง tracking" ไม่ถูกเติม → หน้า Daily (อ่าน receipts) โชว์
  // "รับเงินวันนี้" แต่ IV report (อ่าน invoices.status=paid) ไม่โชว์ = ขัดกัน (เคส IV2604-025).
  // เติมให้ตรงกัน + แก้ใบ paid ที่ actualReceive.date ว่างด้วย. CRITICAL: อ่าน d.invoices/
  // d.receipts ใน updater (ไม่ใช่ closure) — กัน snapshot เก่าทับ server data ใหม่ → ชีตหาย.
  aEffect(() => {
    if (!data || !data.receipts || !data.receipts.length) return;
    if (!data.invoices || !data.invoices.length) return;
    if (!WTPData.markInvoicesPaidFromReceipts) return;
    // เช็คเร็วด้วย closure (แค่ตัดสินว่า "ต้องทำไหม")
    const probe = WTPData.markInvoicesPaidFromReceipts(data.invoices, data.receipts);
    if (!probe.changed) return;
    let updatedData;
    setData(d => {
      // SAFETY: invoices/receipts ว่าง = server อาจยังไม่โหลด → ข้ามรอบนี้ กันเขียน [] ทับชีต
      if (!d.invoices || !d.invoices.length || !d.receipts || !d.receipts.length) return d;
      const res = WTPData.markInvoicesPaidFromReceipts(d.invoices, d.receipts);
      if (!res.changed) return d;
      console.info('[WTP] auto-marked ' + res.changed + ' invoice(s) as paid from existing receipts (receipt→IV backfill)');
      updatedData = { ...d, invoices: res.invoices };
      return updatedData;
    });
    if (updatedData && WTPData.forceSyncNow) {
      setTimeout(() => WTPData.forceSyncNow(updatedData), 0);
    }
  }, [data.receipts, data.invoices]);

  aEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace(/^#/, '') || 'daily');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Mobile sidebar drawer state — true = open
  const [sbOpen, setSbOpen] = aState(false);
  const closeSb = () => setSbOpen(false);
  const openSb  = () => setSbOpen(true);

  // Desktop sidebar collapse state — true = ย่อเหลือเฉพาะไอคอน (persist ใน localStorage)
  const [sbCollapsed, setSbCollapsed] = aState(() => {
    try { return localStorage.getItem('bio-sb-collapsed') === '1'; } catch (_) { return false; }
  });
  const toggleCollapse = () => setSbCollapsed(c => {
    const next = !c;
    try { localStorage.setItem('bio-sb-collapsed', next ? '1' : '0'); } catch (_) {}
    return next;
  });

  // Auto-close drawer when route changes (after tapping a nav item)
  aEffect(() => { setSbOpen(false); }, [route]);

  // Lock body scroll while drawer is open on mobile
  aEffect(() => {
    document.body.style.overflow = sbOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sbOpen]);

  const go = (r) => {
    if (window.WTPAuth && !window.WTPAuth.canViewPage(r)) return;   // block forbidden routes
    window.location.hash = '#' + r;
    setRoute(r);
  };

  // Route guard — if user can't view current route, redirect to first allowed page
  aEffect(() => {
    if (!isLoggedIn || !window.WTPAuth) return;
    if (!window.WTPAuth.canViewPage(route)) {
      // Pull routes object below — at this point it's not defined yet, fallback inline
      const order = ['home','daily','warroom1','warroom2','cashflow','cashflow_present','pnl','budget','debt','debt_ledger',
                     'iv_report','receipts','bank_diary','interest_calc','sts_calc','sts_workflow',
                     'projects','invoices','checks','data_forecast','data_bank','data_pv','data_payable'];
      const allowed = window.WTPAuth.firstAllowedPage(order);
      if (allowed !== route) {
        window.location.hash = '#' + allowed;
        setRoute(allowed);
      }
    }
  }, [route, isLoggedIn]);

  // Apply tweaks to CSS vars
  aEffect(() => {
    const root = document.documentElement;
    // Theme palette
    const themes = {
      green:   { 500: '#2e8b4a', 600: '#21703a', 700: '#1a592f', 800: '#154524', 400: '#47a566', 300: '#7cc48f', 200: '#aedcb8', 100: '#d5edda', 50: '#eef7f1' }, blue:    { 500: '#2a6fdb', 600: '#1f56b8', 700: '#1a4490', 800: '#16356f', 400: '#5b94f7', 300: '#8db8ff', 200: '#b9d4ff', 100: '#dceaff', 50: '#f0f6ff' },
      teal:    { 500: '#0d9488', 600: '#0f766e', 700: '#115e59', 800: '#134e4a', 400: '#2dd4bf', 300: '#5eead4', 200: '#99f6e4', 100: '#ccfbf1', 50: '#f0fdfa' },
      indigo:  { 500: '#4f46e5', 600: '#4338ca', 700: '#3730a3', 800: '#312e81', 400: '#818cf8', 300: '#a5b4fc', 200: '#c7d2fe', 100: '#e0e7ff', 50: '#eef2ff' },
      slate:   { 500: '#475569', 600: '#334155', 700: '#1e293b', 800: '#0f172a', 400: '#94a3b8', 300: '#cbd5e1', 200: '#e2e8f0', 100: '#f1f5f9', 50: '#f8fafc' },
    };
    const t = themes[tweaks.themeMode] || themes.blue;
    Object.entries(t).forEach(([k, v]) => root.style.setProperty(`--brand-${k}`, v));
    // Density class
    document.body.classList.toggle('dense', tweaks.density === 'compact');
    // Fonts
    const fonts = {
      plex:    '"IBM Plex Sans Thai", "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
      sarabun: '"Sarabun", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
      noto:    '"Noto Sans Thai Looped", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
      kanit:   '"Kanit", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
    };
    document.body.style.fontFamily = fonts[tweaks.fontPair] || fonts.plex;
    // Animations
    document.body.style.setProperty('--anim-toggle', tweaks.showAnimations ? '1' : '0');
    root.classList.toggle('no-anim', !tweaks.showAnimations);
  }, [tweaks]);

  const resetDemo = () => {
    if (!confirm('รีเซ็ตข้อมูลกลับเป็นค่าตั้งต้น?')) return;
    setData(WTPData.reset());
    pushToast('รีเซ็ตข้อมูลเรียบร้อย');
  };

  // ── Render
  if (!isLoggedIn) return <LoginPage onLogin={handleLogin} />;

  const routes = {
    home:  { label: 'หน้าหลัก', title: 'หน้าหลัก · Financial Console', icon: 'home' },
    daily: { label: 'รายงานรับเงินประจำวัน', title: 'Daily Revenue', icon: 'daily' },
    warroom1: { label: 'War Room — รายรับ (หน้า 1)', title: 'Revenue Collection', icon: 'receivables' },
    warroom2: { label: 'War Room — รายปี (หน้า 2)', title: 'Annual Cash Flow', icon: 'forecast' },
    cashflow: { label: 'Weekly Forecast', title: 'Weekly Forecast', icon: 'chart' },
    cashflow_present: { label: 'พรีเซนต์ Cash Flow', title: 'Cash Flow Presentation', icon: 'chart' },
    debt:        { label: 'ภาระหนี้ทั้งหมด',       title: 'Debt Register',   icon: 'money' },
    debt_ledger: { label: 'Debt Ledger · ดอกเบี้ย', title: 'Debt Ledger',     icon: 'money' },
    iv_report:   { label: 'รายงานติดตาม IV',         title: 'IV Tracking Report', icon: 'invoice' },
    receipts:    { label: 'ประวัติรับเงิน',           title: 'Receipts History', icon: 'receivables' },
    bank_diary:    { label: 'Bank Daily',               title: 'Bank Daily',      icon: 'bank' },
    bank_recon:    { label: 'กระทบยอดธนาคาร',          title: 'Bank Reconciliation', icon: 'bank' },
    interest_calc: { label: 'คำนวณดอกเบี้ย',          title: 'Interest Schedule Calculator', icon: 'money' },
    sts_calc:      { label: 'STS Calculator',          title: 'STS Encompass Fee Calculator', icon: 'money' },
    sts_workflow:  { label: 'STS Workflow',             title: 'STS Workflow · review queue',  icon: 'invoice' },
    projects: { label: 'จัดการโครงการ', title: 'Projects', icon: 'projects' },
    invoices: { label: 'ใบแจ้งหนี้', title: 'Invoices', icon: 'invoice' },
    checks:    { label: 'เช็คจ่ายล่วงหน้า', title: 'Checks', icon: 'money' },
    data_forecast: { label: 'ประมาณการนอกระบบ', title: 'Forecast Entries', icon: 'forecast' },
    data_bank:     { label: 'DATA BANK', title: 'Bank Accounts', icon: 'bank' },
    data_pv:       { label: 'DATA PV', title: 'Payment Vouchers', icon: 'money' },
    data_payable:  { label: 'DATA เจ้าหนี้คงค้าง', title: 'Accounts Payable', icon: 'invoice' },
    audit_log:     { label: 'Audit Log',           title: 'Audit Log — ประวัติแก้ไข', icon: 'settings' },
    backup:        { label: 'สำรอง / กู้คืนข้อมูล', title: 'สำรอง / กู้คืนข้อมูล (Backup)', icon: 'settings' },
    users:         { label: 'จัดการผู้ใช้',         title: 'Users · จัดการผู้ใช้ระบบ', icon: 'settings' },
    daily_balance: { label: 'บันทึกยอดธนาคาร',     title: 'บันทึกยอดธนาคารรายวัน', icon: 'bank' },
    pnl:           { label: 'งบกำไรขาดทุน (P&L)',   title: 'Profit & Loss Statement', icon: 'forecast' },
    budget:        { label: 'Budget Control Center', title: 'Budget Control Center', icon: 'projects' },
    investor:      { label: 'Investor Dashboard', title: 'Investor Dashboard', icon: 'chart' },
  };

  let page;
  switch (route) {
    case 'home':           page = <HomePage data={data} />; break;
    case 'warroom1':       page = <WarRoomPage1 data={data} setData={setData} toast={pushToast} />; break;
    case 'warroom2':       page = <WarRoomPage2 data={data} setData={setData} toast={pushToast} />; break;
    case 'cashflow':       page = <CashFlowDashboard data={data} setData={setData} toast={pushToast} />; break;
    case 'cashflow_present': page = <CashFlowPresentPage data={data} setData={setData} toast={pushToast} />; break;
    case 'projects':       page = <ProjectControlPage data={data} setData={setData} toast={pushToast} />; break;
    case 'investor':       page = <InvestorDashboard data={data} setData={setData} toast={pushToast} />; break;
    case 'invoices':       page = <InvoicesPage data={data} setData={setData} toast={pushToast} />; break;
    case 'debt':           page = <DebtPage data={data} setData={setData} toast={pushToast} />; break;
    case 'debt_ledger':    page = <DebtLedgerPage data={data} setData={setData} toast={pushToast} />; break;
    case 'iv_report':      page = <IvReportStandalonePage data={data} setData={setData} toast={pushToast} />; break;
    case 'receipts':       page = <ReceiptsPage data={data} />; break;
    case 'bank_diary':     page = <BankDiaryPage data={data} setData={setData} toast={pushToast} />; break;
    case 'bank_recon':     page = <BankReconPage data={data} setData={setData} toast={pushToast} />; break;
    case 'interest_calc':  page = <InterestCalcPage data={data} />; break;
    case 'sts_calc':       page = <StsCalcPage data={data} />; break;
    case 'sts_workflow':   page = <StsWorkflowPage data={data} setData={setData} toast={pushToast} />; break;
    case 'checks':         page = <ChecksPage data={data} setData={setData} toast={pushToast} />; break;
    case 'data_forecast':  page = <ForecastEntriesPage data={data} setData={setData} toast={pushToast} />; break;
    case 'data_bank':      page = <DataBankPage data={data} setData={setData} toast={pushToast} />; break;
    case 'data_pv':        page = <DataPVPage data={data} setData={setData} toast={pushToast} />; break;
    case 'data_payable':   page = <DataPayablePage data={data} setData={setData} toast={pushToast} />; break;
    case 'audit_log':      page = <AuditLogPage data={data} toast={pushToast} />; break;
    case 'backup':         page = <BackupPage toast={pushToast} />; break;
    case 'users':          page = <UsersPage data={data} setData={setData} toast={pushToast} />; break;
    case 'daily_balance':  page = <DailyBalancePage data={data} setData={setData} toast={pushToast} />; break;
    case 'pnl':            page = <PnLPage data={data} setData={setData} toast={pushToast} />; break;
    case 'budget':         page = <BudgetControlPage toast={pushToast} />; break;
    case 'daily':          page = <DailyRevenueDashboard data={data} setData={setData} toast={pushToast} />; break;
    default:               page = <HomePage data={data} />;
  }

  // ★ โชว์ "กำลังโหลดข้อมูล…" แทนหน้าว่าง/ศูนย์ เฉพาะตอน fetch รอบแรก + cache ยังว่าง
  //   (returning user ที่มี cache → coreEmpty=false → เห็นข้อมูลทันที ไม่โดนบัง + sync เบื้องหลัง)
  const coreEmpty = !(
    (data.invoices && data.invoices.length) ||
    (data.bankAccounts && data.bankAccounts.length) ||
    (data.projects && data.projects.length) ||
    (data.payables && data.payables.length)
  );
  const showInitialLoad = !firstLoadDone && coreEmpty;

  return (
    <div className={`app ${sbCollapsed ? 'sb-collapsed' : ''}`}>
      <Sidebar route={route} go={go} routes={routes} data={data} sidebarStyle={tweaks.sidebarStyle} syncInfo={syncInfo} currentUser={currentUser} onLogout={handleLogout} isOpen={sbOpen} onClose={closeSb} collapsed={sbCollapsed} onToggleCollapse={toggleCollapse} />
      <div className={`sb-scrim ${sbOpen ? 'is-open' : ''}`} onClick={closeSb} aria-hidden="true" />
      <div className="main">
        <Topbar route={route} routes={routes} data={data} onReset={resetDemo} onMenuClick={openSb} />
        <div data-screen-label={route}>
          {/* key={route} → boundary รีเซ็ตเมื่อเปลี่ยนหน้า (หน้าอื่นไม่พังตาม) */}
          {showInitialLoad
            ? <DataLoadingState />
            : <ErrorBoundary key={route}>{page}</ErrorBoundary>}
        </div>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="ธีมสี" />
        <TweakRadio label="ชุดสี" value={tweaks.themeMode} options={[
          { value: 'blue', label: 'น้ำเงิน' },
          { value: 'teal', label: 'เขียวน้ำ' },
          { value: 'indigo', label: 'คราม' },
          { value: 'slate', label: 'ทึบ' },
        ]} onChange={(v)=>setTweak('themeMode', v)} />

        <TweakSection label="ตัวอักษร / ความหนาแน่น" />
        <TweakRadio label="ฟอนต์ไทย" value={tweaks.fontPair} options={[
          { value: 'plex', label: 'Plex Thai' },
          { value: 'sarabun', label: 'Sarabun' },
          { value: 'noto', label: 'Noto Looped' },
          { value: 'kanit', label: 'Kanit' },
        ]} onChange={(v)=>setTweak('fontPair', v)} />
        <TweakRadio label="ระยะห่าง" value={tweaks.density} options={['compact', 'regular']} onChange={(v)=>setTweak('density', v)} />

        <TweakSection label="แสดงผล" />
        <TweakToggle label="แอนิเมชั่น" value={tweaks.showAnimations} onChange={(v)=>setTweak('showAnimations', v)} />
        <TweakRadio  label="สไตล์ Sidebar" value={tweaks.sidebarStyle} options={[
          { value: 'filled', label: 'เต็มสี' },
          { value: 'minimal', label: 'มินิมอล' },
        ]} onChange={(v)=>setTweak('sidebarStyle', v)} />

        <TweakSection label="ข้อมูลตัวอย่าง" />
        <TweakButton label="รีเซ็ต Mock Data" onClick={resetDemo} />
      </TweaksPanel>

      {toastNode}
    </div>
  );
}

function Sidebar({ route, go, routes, data, sidebarStyle, syncInfo = {}, currentUser, onLogout, isOpen, onClose, collapsed = false, onToggleCollapse }) {
  const [sec, setSec] = aState({ dash: true, reports: true, manage: true, system: true });
  const tog = k => setSec(p => ({ ...p, [k]: !p[k] }));

  // Helper — format "X วินาที/นาทีที่แล้ว"
  const fmtAgo = (ts) => {
    if (!ts) return '';
    const sec = Math.round((Date.now() - ts) / 1000);
    if (sec < 10) return 'เมื่อกี้';
    if (sec < 60) return sec + ' วิ ก่อน';
    const min = Math.round(sec / 60);
    if (min < 60) return min + ' นาทีก่อน';
    const hr = Math.round(min / 60);
    return hr + ' ชม. ก่อน';
  };

  const syncLabel = (() => {
    if (!syncInfo || syncInfo.status === 'offline') return 'Offline — ใช้ข้อมูล Local';
    if (syncInfo.status === 'syncing') return 'กำลัง sync…';
    // ★ error + เคย sync สำเร็จมาก่อน → บอกว่าใช้ข้อมูลเดิมต่อ (ปลอดภัย)
    if (syncInfo.status === 'error' && syncInfo.time) {
      return `ใช้ข้อมูล ${fmtAgo(syncInfo.time)} · จะลองใหม่`;
    }
    // error + ไม่เคยสำเร็จเลย → connection มีปัญหาจริง
    if (syncInfo.status === 'error') return 'เชื่อมต่อไม่ได้ ⚠';
    if (syncInfo.time) return 'Sync ' + fmtAgo(syncInfo.time);
    return 'เชื่อมต่อ Google Sheets';
  })();
  // สี: error+มี cache → amber (เตือนเบาๆ), error+ไม่มี cache → red, ok → green
  const dotStatus = (syncInfo.status === 'error' && syncInfo.time) ? 'stale' : (syncInfo.status || 'offline');
  const syncDot = { offline:'#94a3b8', syncing:'#f59e0b', error:'#ef4444', stale:'#f59e0b', ok:'#22c55e' }[dotStatus];

  // Tooltip — รายละเอียดสำหรับ debug (รายชื่อชีตที่ fail)
  const syncTooltip = (() => {
    const parts = [];
    if (syncInfo.time) parts.push('Sync ล่าสุด: ' + new Date(syncInfo.time).toLocaleTimeString('th-TH'));
    if (syncInfo.lastError) parts.push('Error ล่าสุด: ' + syncInfo.lastError);
    if (syncInfo.failedSheets && syncInfo.failedSheets.length > 0) {
      parts.push('ชีตที่ fail: ' + syncInfo.failedSheets.slice(0, 3).join(', ')
        + (syncInfo.failedSheets.length > 3 ? ` (+${syncInfo.failedSheets.length - 3})` : ''));
    }
    if (syncInfo.currentInterval) parts.push('Refresh ทุก: ' + (syncInfo.currentInterval / 1000) + ' วิ');
    parts.push('คลิก ↻ เพื่อโหลดข้อมูลใหม่ทันที');
    return parts.join('\n');
  })();

  // Manual refresh — เรียก WTPData.refreshFromServer ทันที (ไม่ต้องรอ interval)
  const [refreshing, setRefreshing] = aState(false);
  const handleManualRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (window.WTPData && WTPData.refreshFromServer) {
        const p = WTPData.refreshFromServer();
        // unblock UI หลัง ~1.5 วินาที (ไม่ว่า sync จะเสร็จหรือไม่)
        setTimeout(() => setRefreshing(false), 1500);
        if (p && typeof p.then === 'function') p.finally(() => setRefreshing(false));
      } else {
        setRefreshing(false);
      }
    } catch (_) { setRefreshing(false); }
  };
  /* eslint-disable no-unused-vars */
  const counts = {
    daily: data.invoices.filter(iv => iv.receivedAt === data.daily.asOfDate).length || null,
    cashflow: null,
    receivables: null,
    projects: data.projects.length,
    invoices: data.invoices.length,
    data_forecast: data.forecastEntries.length,
    data_bank:     data.bankAccounts?.length || 0,
    data_pv:       data.pvVouchers?.length || 0,
    data_payable:  data.payables?.length || 0,
    debt:          data.debtMaster?.filter(r => r.status === 'Active').length || null,
    debt_ledger:   data.debtMaster?.filter(r => r.status === 'Active').length || null,
    iv_report:     data.invoices?.filter(iv => iv.status !== 'paid').length || null,
    receipts:      data.receipts?.length || null,
    bank_diary:    null,
    interest_calc: null,
    checks:        data.checks?.filter(c => c.status === 'pending' || c.status === 'clearing').length || null,
    daily_balance: (() => {
      // Number of MAIN bank accounts that don't have today's snapshot yet.
      // Only shows for users who opted into daily-balance reminders.
      if (!currentUser || !currentUser.notifyDailyBalance) return null;
      const today = new Date().toISOString().slice(0, 10);
      const mains = (data.bankAccounts || []).filter(a => {
        const t = (a.accountType || 'main').toLowerCase();
        return t !== 'closed' && t !== 'dormant';
      });
      const snapped = new Set((data.cashflowSnapshots || [])
        .filter(s => s.date === today)
        .map(s => s.bankAc));
      const missing = mains.filter(a => !snapped.has(a.Bank_AC)).length;
      return missing > 0 ? missing : null;
    })(),
  };

  const secHdrStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none',
  };
  const chevron = (open) => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 180ms ease', flexShrink: 0, color: 'var(--ink-400)' }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );

  // Filter nav items by role — viewer/owner see fewer
  const navItems = (items) => items
    .filter(([key]) => window.WTPAuth ? window.WTPAuth.canViewPage(key) : true)
    .map(([key, label, icon]) => (
      <button key={key} className={`sb-link ${route === key ? 'active' : ''}`} onClick={() => go(key)} title={collapsed ? label : undefined}>
        <Icon name={icon} className="sb-icon" />
        <span className="sb-link-label">{label}</span>
        {counts[key] != null && <span className="sb-pill">{counts[key]}</span>}
      </button>
    ));

  return (
    <aside className={`sb ${isOpen ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sb-brand" style={{ position: 'relative' }}>
        <img src="bioaxel_logo.png" alt="BIOAXEL" className="sb-logo-img" />
        <div className="sb-brand-sub" style={{ marginTop: 2 }}>Financial Console</div>

        {/* Collapse toggle — desktop only (hidden on mobile drawer via CSS) */}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
            title={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
            className="sb-collapse-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }}>
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}
        {/* Close button — only visible on mobile drawer */}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="ปิดเมนู"
            className="sb-close-btn"
            style={{
              position: 'absolute', top: -4, right: -4,
              width: 32, height: 32, borderRadius: 8,
              border: 0, background: 'transparent',
              color: 'var(--ink-500)', cursor: 'pointer',
              display: 'none', alignItems: 'center', justifyContent: 'center',
            }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Scrollable nav area ── */}
      <nav style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 6 }}>
        <div>
          <div className="sb-section" style={secHdrStyle} onClick={() => tog('dash')}>
            <span>แดชบอร์ด</span>{chevron(sec.dash)}
          </div>
          {(sec.dash || collapsed) && navItems([
            ['home',     'หน้าหลัก',               'home'],
            ['daily',    'รายงานรับเงินรายวัน',    'daily'],
            ['warroom1', 'War Room · รายรับ',       'receivables'],
            ['warroom2', 'War Room · รายปี',        'forecast'],
            ['cashflow', 'Weekly Forecast', 'chart'],
            ['cashflow_present', 'พรีเซนต์ Cash Flow', 'chart'],
            ['pnl',      'งบกำไรขาดทุน (P&L)',     'forecast'],
            ['budget',   'Budget Control Center',  'projects'],
            ['investor', 'Investor Dashboard',     'chart'],
          ])}
        </div>

        <div>
          <div className="sb-section" style={secHdrStyle} onClick={() => tog('reports')}>
            <span>รายงาน / วิเคราะห์</span>{chevron(sec.reports)}
          </div>
          {(sec.reports || collapsed) && navItems([
            ['debt',          'ภาระหนี้ทั้งหมด',       'money'],
            ['debt_ledger',   'Debt Ledger · ดอกเบี้ย','money'],
            ['iv_report',     'รายงานติดตาม IV',       'invoice'],
            ['receipts',      'ประวัติรับเงิน',         'receivables'],
            ['bank_diary',    'Bank Daily',             'bank'],
            ['bank_recon',    'กระทบยอดธนาคาร',         'bank'],
            ['interest_calc', 'คำนวณดอกเบี้ย',         'money'],
            ['sts_calc',      'STS Calculator',         'money'],
            ['sts_workflow',  'STS Workflow',           'invoice'],
          ])}
        </div>

        <div>
          <div className="sb-section" style={secHdrStyle} onClick={() => tog('manage')}>
            <span>จัดการข้อมูล</span>{chevron(sec.manage)}
          </div>
          {(sec.manage || collapsed) && navItems([
            ['projects',      'โครงการ',          'projects'],
            ['invoices',      'ลูกหนี้คงค้าง',    'invoice'],
            ['checks',        'เช็คจ่ายล่วงหน้า', 'money'],
            ['data_forecast', 'ประมาณการรายจ่าย', 'forecast'],
            ['data_bank',     'บัญชีธนาคาร',      'bank'],
            ['data_pv',       'ใบสำคัญจ่าย',      'money'],
            ['data_payable',  'เจ้าหนี้คงค้าง',   'arrow_up'],
            ['daily_balance', 'บันทึกยอดธนาคาร',  'bank'],
          ])}
        </div>

        {/* ระบบ — only visible to manager (audit_log + users) */}
        {(window.WTPAuth && window.WTPAuth.can('canManageUsers')) && (
          <div>
            <div className="sb-section" style={secHdrStyle} onClick={() => tog('system')}>
              <span>ระบบ</span>{chevron(sec.system !== false)}
            </div>
            {(sec.system !== false || collapsed) && navItems([
              ['audit_log',     'Audit Log',         'settings'],
              ['backup',        'สำรอง / กู้คืนข้อมูล', 'settings'],
              ['users',         'จัดการผู้ใช้',     'settings'],
            ])}
          </div>
        )}
      </nav>

      {/* ── Pinned user / logout ── */}
      <div className="sb-user">
        <div className="sb-avatar">{currentUser ? currentUser.displayName.slice(0,2) : 'FA'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-800)' }}>{currentUser ? currentUser.displayName : 'ฝ่ายการเงิน'}</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-400)', display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background: syncDot, flexShrink:0 }} />
            <span>{syncLabel}</span>
            <button
              type="button"
              onClick={handleManualRefresh}
              title={syncTooltip}
              disabled={refreshing || syncInfo.status === 'syncing'}
              style={{
                marginLeft: 2, padding: '1px 4px', borderRadius: 4,
                border: '1px solid var(--ink-100)', background: 'transparent',
                color: 'var(--ink-500)', cursor: refreshing ? 'wait' : 'pointer',
                fontSize: 10, lineHeight: 1, display: 'inline-flex', alignItems: 'center',
                transition: 'all .15s', opacity: refreshing ? 0.5 : 1,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--ink-50)'; e.currentTarget.style.color = 'var(--brand-600)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-500)'; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                   style={{ animation: (refreshing || syncInfo.status === 'syncing') ? 'spin 0.9s linear infinite' : 'none' }}>
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>
        </div>
        <button onClick={onLogout} title="ออกจากระบบ" style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ink-300)', padding:4, borderRadius:5, display:'flex', alignItems:'center', transition:'color 160ms' }}
          onMouseEnter={e => e.currentTarget.style.color='var(--bad)'}
          onMouseLeave={e => e.currentTarget.style.color='var(--ink-300)'}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}

// Present Mode — กดแล้วเข้าเต็มจอ + ซ่อน sidebar/แถบรก + spotlight + การ์ดมน
// จัดการ class บน <body>, fullscreen API, จำสถานะใน localStorage (ใช้ได้ข้ามหน้า)
function PresentModeToggle() {
  const [on, setOn] = aState(() => { try { return localStorage.getItem('bio-present-mode') === '1'; } catch (_) { return false; } });

  // สไตล์ + persist ตามสถานะ on
  aEffect(() => {
    document.body.classList.toggle('present-mode', on);
    try { localStorage.setItem('bio-present-mode', on ? '1' : '0'); } catch (_) {}
  }, [on]);

  // ถ้าผู้ใช้กด Esc / ออกจากเต็มจอเอง → ปิดโหมดให้สอดคล้องกัน
  aEffect(() => {
    const sync = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fsEl) setOn(false);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggle = async () => {
    const next = !on;
    setOn(next);
    try {
      const el = document.documentElement;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (next && !fsEl) {
        await (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen && el.webkitRequestFullscreen());
      } else if (!next && fsEl) {
        await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen());
      }
    } catch (_) { /* บาง browser/iframe บล็อก fullscreen — สไตล์โหมดนำเสนอยังทำงานปกติ */ }
  };

  return (
    <button type="button" className={`present-toggle${on ? ' is-on' : ''}`} onClick={toggle}
      title={on ? 'โหมดนำเสนอ: เปิด — เต็มจอ + ชี้การ์ด/แถวเพื่อไฮไลต์ (คลิกหรือ Esc เพื่อออก)' : 'เปิดโหมดนำเสนอ — เต็มจอ ซ่อนเมนู จัดหน้าให้สะอาด + ชี้แล้วเด่น เหมาะตอนพรีเซนต์'}>
      <span className="dot" />
      <span className="lbl">{on ? 'ออกจากโหมดนำเสนอ' : 'โหมดนำเสนอ'}</span>
    </button>
  );
}

function Topbar({ route, routes, data, onReset, onMenuClick }) {
  const r = routes[route] || routes.daily;
  const today = new Date().toLocaleDateString('th-TH-u-ca-gregory', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const isPresentation = ['daily', 'warroom1', 'warroom2', 'cashflow', 'cashflow_present', 'pnl', 'projects', 'budget', 'investor'].includes(route);
  return (
    <div className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        {/* Hamburger — only visible on tablet/phone via CSS */}
        <button className="menu-btn" onClick={onMenuClick} aria-label="เปิดเมนู">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <div className="crumbs">
          <span>BIOAXEL</span><span className="sep">/</span>
          <span>{isPresentation ? 'นำเสนอ' : 'จัดการข้อมูล'}</span>
          <span className="sep">/</span>
          <span className="now">{r.label}</span>
        </div>
      </div>
      <div className="tb-actions">
        {isPresentation && <PresentModeToggle />}
        <div className="tb-search">
          <Icon name="search" size={14} />
          <input placeholder="ค้นหาโครงการ / IV…" />
        </div>
        <div className="tb-date">
          <Icon name="daily" size={13} />
          <span>{today}</span>
        </div>
      </div>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [username, setUsername] = aState('');
  const [password, setPassword] = aState('');
  const [error, setError]       = aState('');
  const [loading, setLoading]   = aState(false);
  const [showPw, setShowPw]     = aState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    // ── Phase 4: login ผ่าน Supabase Auth (เมื่อเปิด flag) — รหัส hash ฝั่ง server, role จาก app_metadata
    if ((window.WTP_CONFIG && window.WTP_CONFIG.USE_SUPABASE_AUTH) && WTPData.authSignIn) {
      WTPData.authSignIn(username, password)
        .then(userObj => { setLoading(false); onLogin(userObj); })
        .catch(() => { setLoading(false); setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); });
      return;
    }
    const uIn = String(username || '').trim().toLowerCase();
    const norm = (n) => String(n || '').trim().toLowerCase();
    const isActive = (u) => {
      const a = String(u.active == null ? 'true' : u.active).toLowerCase().trim();
      return a !== 'false' && a !== 'no' && a !== '0' && a !== 'inactive' && a !== 'disabled';
    };
    const configUsers = (window.WTP_CONFIG && window.WTP_CONFIG.USERS) || [];

    // รวมรายชื่อ + ตัดสินผล (username = ไม่สนพิมพ์ใหญ่-เล็ก/ช่องว่าง · password ตรงเป๊ะ)
    const finish = (sheetUsers) => {
      const users = (Array.isArray(sheetUsers) ? sheetUsers : []).filter(isActive);
      const known = new Set(users.map(u => norm(u.username)));
      configUsers.forEach(u => { if (!known.has(norm(u.username))) users.push(u); });
      const match = users.find(u => norm(u.username) === uIn && u.password === password);
      setLoading(false);
      if (match) onLogin(match);
      else setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    };
    const cachedUsers = () => { try { const c = JSON.parse(localStorage.getItem('bio-fin-data-v8') || 'null'); return (c && Array.isArray(c.users)) ? c.users : []; } catch (_) { return []; } };

    // ★ ดึงรายชื่อจาก "ชีตสด" ก่อน → user ที่อยู่ในชีต (เช่น baikao) ล็อกอินได้แม้ cache ในเครื่องว่าง
    //   (gviz อ่านสาธารณะ ไม่ต้อง auth) · fail/ช้า/ว่าง → fallback cache + config (พฤติกรรมเดิม)
    let done = false;
    const fallback = () => { if (done) return; done = true; finish(cachedUsers()); };
    try {
      if (WTPData.fetchSheetRows) {
        const to = setTimeout(fallback, 7000);  // กัน fetch ค้าง
        WTPData.fetchSheetRows('users')
          .then(rows => { if (done) return; done = true; clearTimeout(to); finish((Array.isArray(rows) && rows.length) ? rows : cachedUsers()); })
          .catch(() => { clearTimeout(to); fallback(); });
      } else { fallback(); }
    } catch (_) { fallback(); }
  };

  const inputStyle = {
    width: '100%', padding: '11px 14px', boxSizing: 'border-box',
    border: '1.5px solid #e2e8f0', borderRadius: 10,
    fontSize: 14, color: '#1a2236', outline: 'none',
    fontFamily: 'inherit', transition: 'border-color 0.15s',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(145deg, #dce8ff 0%, #f4f7fb 55%, #eaf2ff 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"IBM Plex Sans Thai", "IBM Plex Sans", system-ui, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: '48px 40px',
        width: '100%', maxWidth: 400,
        boxShadow: '0 24px 64px rgba(42,111,219,0.13), 0 4px 16px rgba(0,0,0,0.06)',
        border: '1px solid rgba(42,111,219,0.09)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <img src="bioaxel_logo.png" alt="BIOAXEL"
            style={{ height: 88, width: 'auto', maxWidth: '70%', objectFit: 'contain', margin: '0 auto 10px', display: 'block' }} />
          <div style={{ fontSize: 13, color: '#7b8ca6', marginTop: 3 }}>Financial Console</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 7 }}>ชื่อผู้ใช้</label>
            <input
              type="text" value={username} required autoFocus
              onChange={e => setUsername(e.target.value)}
              placeholder="กรอกชื่อผู้ใช้"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = '#2e8b4a'}
              onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 7 }}>รหัสผ่าน</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'} value={password} required
                onChange={e => setPassword(e.target.value)}
                placeholder="กรอกรหัสผ่าน"
                style={{ ...inputStyle, paddingRight: 42 }}
                onFocus={e => e.target.style.borderColor = '#2e8b4a'}
                onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#94a3b8', padding: 4, display: 'flex', alignItems: 'center',
                }}>
                {showPw ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 9, padding: '10px 14px',
              fontSize: 13, color: '#dc2626', marginBottom: 18,
            }}>{error}</div>
          )}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '13px',
            background: loading ? '#9ed3ad' : 'linear-gradient(135deg, #2e8b4a, #1a592f)',
            color: '#fff', border: 'none', borderRadius: 11,
            fontSize: 15, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : '0 4px 16px rgba(42,111,219,0.35)',
            fontFamily: 'inherit', transition: 'opacity 0.15s',
          }}>
            {loading ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}

Object.assign(window, { App });

// Mount
const rootEl = document.getElementById('root');
ReactDOM.createRoot(rootEl).render(<App />);
