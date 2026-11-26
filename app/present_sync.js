/* =====================================================================
   โหมดแคสหน้าจอ (present sync) — หน้างบกระแสเงินสด · งบกำไรขาดทุน · งบแสดงฐานะการเงิน · prefix psy*
   BIOAXEL — ยกจาก present_sync.js ของ Water POG (2026-11-26 · ผู้ใช้ "ทำให้ไบโอและบิ๊กดรีมด้วย")
   ★ BIOAXEL: กระดานกลาง = ตาราง Supabase "presentSync" แถว id='main' (แบบตาราง present_sync ของ Benya)
     อ่าน/เขียนผ่าน WTPData.presentSyncGet / presentSyncPut (app/data_supabase.js) · RLS เขียนได้เฉพาะ presenter
     ★ ต้องรัน supabase/present-sync.sql ครั้งเดียว · seq = updated_at ของแถว (เวลาของ server)
   ---------------------------------------------------------------------
   ยกมาจากเว็บ Benya (fin.benyamedical.com/modules/present-sync.js · 2026-11-26) — ผู้ใช้ขอ "หน้าจอลิงก์
   การทำงานของทั้ง 2 จอ แบบของเว็บเบญญา"
   ที่มา (ฝั่ง Benya): ตอนนำเสนอต้องเลื่อนไอแพดดูบทวิเคราะห์มือหนึ่ง และเลื่อนจอใหญ่ที่ผู้บริหารเห็นอีกมือหนึ่ง
   → ไอแพด (บัญชีผู้นำเสนอ) เป็นตัวนำ · คอมที่ต่อทีวี (บัญชีปกติ) กด "📡 โหมดแคสหน้าจอ" แล้วแสดงตาม

   วิธีลิงก์ = "กระดานกลาง" ตาราง presentSync (ดูด้านบน)
   - ไอแพด: ★ ส่งเองอัตโนมัติ (ไม่ต้องเปิดอะไร · ปิดได้ในเมนู ✦ "แคสหน้าจอไปจอใหญ่" → bio-psy-remote="0")
     ส่งเมื่อ เลื่อนหน้า (ทุก ~0.2 วิ ระหว่างเลื่อน) · เปลี่ยนหน้า/แท็บ/ช่วงเวลา · สลับมุมมองตาราง (P&L รายเดือน/
     ไตรมาส) · เปิดกล่องบทวิเคราะห์
     สิ่งที่ส่ง = หน้าไหน + "กรอบที่อยู่ขอบบนจอ" (key ของ data-exn) + เลื่อนเข้าไปในกรอบนั้นกี่ส่วน (ratio)
     ★ เทียบเป็นกรอบ + สัดส่วน ไม่ใช่ตำแหน่งพิกเซล เพราะจอสองเครื่องคนละขนาด (กรอบสูงไม่เท่ากัน)
   - ทีวี: กดปุ่ม "📡 โหมดแคสหน้าจอ" มุมขวาล่าง (เฉพาะ 3 หน้างบ · บัญชีที่ไม่ใช่ผู้นำเสนอ)
     → อ่านกระดานทุก 0.5 วิ ถ้า seq เปลี่ยน = เปิดหน้า/แท็บ/ช่วงเดียวกัน แล้วเลื่อนไปตำแหน่งเดียวกัน
   ★ ทีวีไม่แสดงขอบไฮไลต์/กล่องบทวิเคราะห์ — มีแค่บนไอแพด
   ★ ทำตามเฉพาะตอน seq เปลี่ยน → ระหว่างนั้นคนที่ทีวียังเลื่อนเองได้
   ★ สถานะเก่ากว่า 3 ชม. ไม่ทำตามตอนเพิ่งเปิดโหมด (กันหน้ากระโดดไปที่ประชุมครั้งก่อน)
   ★ จอทีวีที่ไม่มีสิทธิ์ดูหน้านั้น (เช่น role ที่ไม่เห็น P&L) = อยู่หน้าเดิม ไม่เด้งไปหน้าอื่น
   เรียกจาก: exec_notes.js (exnMount / exnMountFin / exnUnmount / เปิดกล่อง / เมนู ✦)
     · page_pnl.jsx → Psy.view(route, get, set) + Psy.push() เมื่อสลับรายเดือน/ไตรมาส (หน้างบฐานะของ BIO ไม่มีแท็บ)
   ===================================================================== */
(function () {
  const PSY_POLL_MS = 500;
  const PSY_ROUTES = ['cashflow_present', 'pnl', 'balance_sheet'];
  const PSY_MAX_AGE = 3 * 3600 * 1000;
  const PSY_LS_REMOTE = 'bio-psy-remote', PSY_LS_FOLLOW = 'bio-psy-follow';

  function psySession() { try { return JSON.parse(localStorage.getItem('bio-session') || 'null'); } catch (e) { return null; } }
  function psyToken() { return psySession() ? '1' : ''; }   // ★ BIOAXEL: session ของ Supabase อยู่ใน client — ดูแค่ว่าล็อกอินอยู่
  function psyIsPresenter() { const s = psySession(); return !!s && String(s.role || '').trim().toLowerCase() === 'presenter'; }
  function psyRoute() { return String(window.location.hash || '').replace(/^#/, '').split('?')[0]; }
  function psyOnCastPage() { return PSY_ROUTES.includes(psyRoute()); }
  function psyLsGet(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }
  function psyLsSet(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { } }
  /* ไอแพดส่งเป็นค่าเริ่มต้น — ปิดเมื่อกดปิดเองเท่านั้น */
  function psyRemoteOn() { try { return psyIsPresenter() && localStorage.getItem(PSY_LS_REMOTE) !== '0'; } catch (e) { return psyIsPresenter(); } }
  function psyFollowOn() { return !!psyToken() && !psyIsPresenter() && psyLsGet(PSY_LS_FOLLOW); }
  const psySleep = ms => new Promise(r => setTimeout(r, ms));
  function psyTopOffset() {
    const tb = document.querySelector('.topbar');
    return (tb && getComputedStyle(tb).display !== 'none' && getComputedStyle(tb).position === 'sticky' ? tb.offsetHeight : 0) + 12;
  }
  function psyExn() { return window.Exn || {}; }
  function psyBind() { try { if (psyExn().exnBindTargets) psyExn().exnBindTargets(); } catch (e) { } }

  /* ★ BIOAXEL: กระดานกลาง = ตาราง presentSync ผ่านตัวเชื่อม Supabase (app/data_supabase.js) */
  async function psyApi(method, body) {
    const W = window.WTPData;
    if (!W || !W.presentSyncGet || !W.presentSyncPut) throw new Error('ไม่พบตัวเชื่อมข้อมูล (presentSync)');
    return method === 'GET' ? W.presentSyncGet() : W.presentSyncPut(body && body.state);
  }

  /* มุมมองในหน้า React ที่จอทีวีต้องตาม (P&L รายเดือน/ไตรมาส · แท็บตารางในหน้างบฐานะ)
     หน้าเรียก Psy.view(route, () => ({...}), v => {...}) ทุกครั้งที่ค่าเปลี่ยน · ออกจากหน้า = Psy.view(route, null) */
  const _psyViews = {};
  function psyView(route, get, set) {
    if (!get) { delete _psyViews[route]; return; }
    _psyViews[route] = { get, set };
  }

  /* ---------- ไอแพด (ตัวนำ) ---------- */
  let _psyPushT = null, _psyLastSig = null, _psySending = false, _psyAgain = false, _psyScrollOn = false;
  const _psyStatus = { ok: null, msg: '', at: 0 };
  function psyRemoteToggle(v) {
    psyLsSet(PSY_LS_REMOTE, v == null ? !psyRemoteOn() : !!v);
    _psyLastSig = null;
    if (psyRemoteOn()) psyPush(true);
    if (psyExn().exnRenderFab) psyExn().exnRenderFab();
  }
  /* กรอบที่อยู่ขอบบนจอตอนนี้ + เลื่อนเข้าไปในกรอบกี่ส่วน (0–1)
     ★ key เดียวติดได้หลายชิ้น → ส่ง idx = ชิ้นที่เท่าไรของ key นั้นด้วย
     ★ กรอบวางคู่กันซ้าย-ขวา (ขอบบนเท่ากัน) → เลือกกรอบที่เปิดกล่องบทวิเคราะห์อยู่ก่อน
       (★ POG: ยังไม่มีแผงบทพูดแบบ Benya — ใช้กล่องที่เปิดอยู่แทน "เรื่องที่เลือกในแผง") */
  function psyFrames() { return Array.from(document.querySelectorAll('[data-exn]')).filter(e => e.offsetParent !== null && e.getBoundingClientRect().height >= 20); }
  function psyKeysOf(el) { return (el.getAttribute('data-exn') || '').split(/\s+/).filter(Boolean); }
  function psyAnchor() {
    psyBind();
    const line = psyTopOffset();
    if (window.scrollY < 4) return { key: null, ratio: 0, top: true };
    const els = psyFrames().map(el => ({ el, r: el.getBoundingClientRect() }));
    let cand = els.filter(x => x.r.top <= line + 1 && x.r.bottom > line);          // กรอบที่คร่อมเส้นขอบบน
    if (cand.length) { const h = Math.min(...cand.map(x => x.r.height)); cand = cand.filter(x => x.r.height <= h + 2); }   // ซ้อนกัน → กรอบเล็กสุด
    else {   // เส้นขอบบนอยู่ในช่องว่างระหว่างกรอบ → กรอบถัดไปที่อยู่ใต้เส้น (ratio ติดลบ = ยังไม่ถึงกรอบ)
      const below = els.filter(x => x.r.top > line);
      if (below.length) { const t = Math.min(...below.map(x => x.r.top)); cand = below.filter(x => x.r.top <= t + 2); }
    }
    if (!cand.length) {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return { key: null, ratio: 0, page: Math.round(window.scrollY / max * 1000) / 1000 };
    }
    const pk = window._exnPopKeys, act = pk && pk.keys && pk.keys[0];
    const best = (pk && pk.el && cand.find(x => x.el === pk.el)) || (act && cand.find(x => psyKeysOf(x.el).includes(act))) || cand[0];
    const keys = psyKeysOf(best.el);
    const key = act && keys.includes(act) ? act : keys[0];
    const idx = Math.max(0, psyFrames().filter(e => psyKeysOf(e).includes(key)).indexOf(best.el));
    return { key, idx, ratio: Math.round((line - best.r.top) / best.r.height * 1000) / 1000 };
  }
  function psyCurState() {
    const route = psyRoute();
    const st = { v: 1, route };
    if (route === 'cashflow_present' && window.CfpEd && window.CfpEd.edState) {
      const d = window.CfpEd.edState(); st.tab = d.tab || 'summary'; st.period = d.monthFilter || 'all';
    }
    const vw = _psyViews[route];
    if (vw && vw.get) { try { st.view = vw.get(); } catch (e) { } }
    Object.assign(st, psyAnchor());
    return st;
  }
  /* เรียกเมื่อสิ่งที่จอใหญ่ควรเห็นเปลี่ยน (หน่วงรวม ~0.2 วิ · ระหว่างเลื่อนต่อเนื่องส่งทุก ~0.2 วิ) */
  function psyPush(now) {
    psyInstallScroll();
    if (!psyRemoteOn() || !psyOnCastPage()) return;
    if (now) { clearTimeout(_psyPushT); _psyPushT = null; psySend(); return; }
    if (_psyPushT) return;
    _psyPushT = setTimeout(() => { _psyPushT = null; psySend(); }, 200);
  }
  function psyInstallScroll() {
    if (_psyScrollOn) return; _psyScrollOn = true;
    window.addEventListener('scroll', () => { if (psyRemoteOn()) psyPush(); }, { passive: true });
    window.addEventListener('resize', () => { if (psyRemoteOn()) psyPush(); });
  }
  async function psySend() {
    if (_psySending) { _psyAgain = true; return; }
    if (!psyRemoteOn() || !psyOnCastPage()) return;
    const st = psyCurState(), sig = JSON.stringify(st);
    if (sig === _psyLastSig) return;
    _psySending = true;
    const was = _psyStatus.ok;
    try {
      await psyApi('POST', { state: st });
      _psyLastSig = sig;
      Object.assign(_psyStatus, { ok: true, msg: '', at: Date.now() });
    } catch (e) {
      Object.assign(_psyStatus, { ok: false, msg: String((e && e.message) || e), at: Date.now() });
    } finally {
      _psySending = false;
      if (was !== _psyStatus.ok && psyExn().exnRenderFab) psyExn().exnRenderFab();   // ป้ายสถานะบนปุ่ม ✦
      if (_psyAgain) { _psyAgain = false; psySend(); }
    }
  }

  /* ---------- ทีวี (ตัวตาม) ---------- */
  let _psyTimer = null, _psySeq = 0, _psyBusy = false, _psyOk = null;
  function psyFollowToggle(v) {
    const on = v == null ? !psyLsGet(PSY_LS_FOLLOW) : !!v;
    psyLsSet(PSY_LS_FOLLOW, on);
    _psySeq = 0; _psyOk = null;
    clearTimeout(_psyTimer); _psyTimer = null;
    if (on) psyLoop();
    psyRenderPill();
  }
  function psyEnsureLoop() {
    if (!window._psyVisOn) { window._psyVisOn = true; document.addEventListener('visibilitychange', () => { if (!document.hidden && psyFollowOn()) psyLoop(); }); }
    if (psyFollowOn() && !_psyTimer && !_psyBusy) psyLoop();
  }
  /* ★ POG: รอบอ่านกระดานมีได้ทีละรอบเดียว (_psyBusy) — ระหว่างเปิดหน้าตาม หน้าใหม่เรียก psyEnsureLoop ซ้ำ
     ถ้าไม่กันจะได้รอบอ่าน 2 สายขนานกัน (ของ Benya เปิดช่องนี้ไว้) */
  async function psyLoop() {
    if (_psyBusy) return;   // รอบก่อนยังทำงานอยู่ — รอบนั้นตั้งเวลารอบถัดไปเอง
    clearTimeout(_psyTimer); _psyTimer = null;
    if (!psyFollowOn()) return;
    _psyBusy = true;
    try {
      if (!document.hidden) {
        try {
          const j = await psyApi('GET');
          const st = j && j.state;
          _psyOk = true;
          if (st && j.seq && j.seq !== _psySeq) {
            const first = !_psySeq;
            _psySeq = j.seq;
            if (!first || Number(j.ageMs) < PSY_MAX_AGE) {
              try { await psyApply(st); } catch (e) { console.warn('[psy] apply', e); }
            }
          }
        } catch (e) { _psyOk = false; }
        psyPaintPill();
      }
    } finally { _psyBusy = false; }
    clearTimeout(_psyTimer); _psyTimer = null;
    if (psyFollowOn()) _psyTimer = setTimeout(psyLoop, PSY_POLL_MS);
  }
  async function psyWaitFor(fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) { } await psySleep(120); }
    return false;
  }
  async function psyApply(st) {
    if (!st || !PSY_ROUTES.includes(st.route)) return;
    if (psyRoute() !== st.route) {
      if (window.WTPAuth && window.WTPAuth.canViewPage && !window.WTPAuth.canViewPage(st.route)) return;   // จอนี้ไม่มีสิทธิ์ดูหน้านั้น
      window.location.hash = '#' + st.route;
    }
    if (st.route === 'cashflow_present') {
      await psyWaitFor(() => document.getElementById('edContent') && window.CfpEd && window.CfpEd.edState().data, 8000);
      const C = window.CfpEd;
      if (C && C.edState && C.edState().data) {
        const d = C.edState();
        if ((st.tab && d.tab !== st.tab) || (st.period && d.monthFilter !== st.period)) {
          if (st.period) d.monthFilter = st.period;
          C.edSetTab(st.tab || d.tab || 'summary');   // บันทึก + วาดหน้าใหม่ (ช่วงที่ไม่มีในข้อมูลของจอนี้ → หน้ากลับเป็น "ทั้งหมด" เอง)
          await psySleep(150);
        }
      }
    } else {
      const sel = st.route === 'pnl' ? '[data-exn~="pnl.brief"]' : '[data-exn~="bal.brief"]';
      await psyWaitFor(() => document.querySelector(sel), 8000);
      const vw = _psyViews[st.route];
      if (vw && vw.set && st.view) {
        try { if (JSON.stringify(vw.get()) !== JSON.stringify(st.view)) { vw.set(st.view); await psySleep(250); } } catch (e) { }
      }
    }
    await psyScrollToState(st);
  }
  /* เลื่อนจอไปตำแหน่งเดียวกับไอแพด = กรอบเดียวกัน + เลื่อนเข้าไปในกรอบเท่ากัน (ไม่ใส่ขอบไฮไลต์บนทีวี) */
  async function psyScrollToState(st) {
    if (st.top) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (!st.key) {
      if (st.page != null) { const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight); window.scrollTo({ top: Math.round(max * st.page), behavior: 'smooth' }); }
      return;
    }
    let el = null;
    await psyWaitFor(() => {
      psyBind();
      const all = psyFrames().filter(e => psyKeysOf(e).includes(st.key));
      el = all[st.idx || 0] || all[0] || null;
      return !!el;
    }, 6000);
    if (!el) return;
    const r = el.getBoundingClientRect(), ratio = Number(st.ratio) || 0;
    const y = window.scrollY + r.top + ratio * r.height - psyTopOffset();
    const target = Math.max(0, Math.round(y));
    if (Math.abs(target - window.scrollY) < 3) return;
    window.scrollTo({ top: target, behavior: Math.abs(target - window.scrollY) > 2500 ? 'auto' : 'smooth' });
  }

  /* ปุ่ม "📡 โหมดแคสหน้าจอ" มุมขวาล่าง — เฉพาะ 3 หน้างบ · บัญชีที่ไม่ใช่ผู้นำเสนอ
     ★ POG: วางใน <body> แล้วซ่อน/แสดงตาม route (Benya วางใน #main ที่ถูกวาดใหม่ทุกครั้งที่เปลี่ยนหน้า) */
  function psyRenderPill() {
    const old = document.getElementById('psyPill');
    if (psyIsPresenter() || !psyToken() || !psyOnCastPage()) { if (old) old.remove(); return; }
    psyInjectCss();
    let p = old;
    if (!p) { p = document.createElement('button'); p.id = 'psyPill'; p.type = 'button'; p.onclick = () => psyFollowToggle(); document.body.appendChild(p); }
    psyPaintPill();
    psyEnsureLoop();
  }
  function psyPaintPill() {
    const p = document.getElementById('psyPill'); if (!p) return;
    const on = psyFollowOn();
    p.className = on ? (_psyOk === false ? 'on bad' : 'on') : '';
    p.innerHTML = on ? `<i></i>${_psyOk === false ? 'แคสหน้าจอ · เชื่อมต่อไม่ได้' : 'กำลังแคสหน้าจอ'}` : '📡 โหมดแคสหน้าจอ';
    p.title = on ? 'จอนี้แสดงตามหน้าจอของผู้นำเสนอ (ไอแพด) · กดเพื่อหยุด' : 'เปิดให้จอนี้แสดงตามหน้าจอของผู้นำเสนอ (ใช้กับคอมที่ต่อทีวี)';
  }
  function psyInjectCss() {
    if (document.getElementById('psyCss')) return;
    const s = document.createElement('style'); s.id = 'psyCss';
    s.textContent = `
    #psyPill{position:fixed;right:14px;bottom:14px;z-index:930;border:1px solid rgba(124,58,237,.35);background:rgba(255,255,255,.85);color:#5b21b6;border-radius:999px;padding:7px 13px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:0 6px 16px rgba(30,27,75,.12);display:flex;align-items:center;gap:7px;opacity:.75;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
    #psyPill:hover{opacity:1}
    #psyPill.on{opacity:.35;color:#047857;border-color:rgba(16,185,129,.4)}
    #psyPill.on:hover{opacity:1}
    #psyPill.on i{width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.25);display:inline-block}
    #psyPill.bad{color:#b91c1c;border-color:rgba(239,68,68,.4);opacity:.9}#psyPill.bad i{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.25)}
    @media print{#psyPill{display:none!important}}`;
    document.head.appendChild(s);
  }

  /* หน้าเปลี่ยน (hashchange) → ปุ่มทีวีโผล่/หายตามหน้า · ไอแพดบอกจอใหญ่ว่าเปลี่ยนหน้า (หน้าใหม่วาดเสร็จจะ push ซ้ำเอง) */
  window.addEventListener('hashchange', () => { psyRenderPill(); psyPush(); });

  /* exec_notes.js เรียกตอนหน้า 3 งบวาดเสร็จ / ออกจากหน้า */
  function psyOnMount() { psyRenderPill(); psyPush(); }
  function psyOnUnmount() { setTimeout(psyRenderPill, 0); }

  window.Psy = {
    push: psyPush, view: psyView, onMount: psyOnMount, onUnmount: psyOnUnmount,
    remoteOn: psyRemoteOn, remoteToggle: psyRemoteToggle, status: () => Object.assign({}, _psyStatus),
    followOn: psyFollowOn, followToggle: psyFollowToggle,
    // ทดสอบ/ตรวจสอบ
    _curState: psyCurState, _apply: psyApply,
  };
})();
