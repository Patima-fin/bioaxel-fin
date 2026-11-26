/* =====================================================================
   โหมดแคสหน้าจอ (present sync) — หน้างบกระแสเงินสด · งบกำไรขาดทุน · งบแสดงฐานะการเงิน · prefix psy*
   BIOAXEL — ยกจาก present_sync.js ของ Water POG (2026-11-26 · ผู้ใช้ "ทำให้ไบโอและบิ๊กดรีมด้วย" · รอบ 2 "ทำทั้ง 3 บริษัท")
   ★ BIOAXEL: กระดานกลาง = ตาราง Supabase "presentSync" (แบบตาราง present_sync ของ Benya) — แถว id='main' + แถวละเครื่อง "d:<รหัสเครื่อง>"
     อ่าน/เขียนผ่าน WTPData.presentSyncList / presentSyncPut (app/data_supabase.js) · RLS เขียนได้เฉพาะ presenter (ไม่ต้องรัน SQL เพิ่ม)
   ---------------------------------------------------------------------
   ยกมาจากเว็บ Benya (fin.benyamedical.com/modules/present-sync.js · 2026-11-26) — ผู้ใช้ขอ "หน้าจอลิงก์
   การทำงานของทั้ง 2 จอ แบบของเว็บเบญญา"
   ที่มา (ฝั่ง Benya): ตอนนำเสนอต้องเลื่อนไอแพดดูบทวิเคราะห์มือหนึ่ง และเลื่อนจอใหญ่ที่ผู้บริหารเห็นอีกมือหนึ่ง
   → ไอแพด (บัญชีผู้นำเสนอ) เป็นตัวนำ · คอมที่ต่อทีวี (บัญชีปกติ) กด "📡 โหมดแคสหน้าจอ" แล้วแสดงตาม

   วิธีลิงก์ = "กระดานกลาง" ตาราง presentSync (ดูด้านบน)
     กระดานมีหลายแถวแบบตารางของ Benya: แถว "d:<รหัสเครื่อง>" = หน้าจอของผู้นำเสนอแต่ละเครื่อง
     · แถว "main" = { owner: รหัสเครื่องที่กำลังแคส } (อ่าน/เขียนผ่าน psyRows / psyPutRow — ตัวเชื่อมกระดานจุดเดียว)
   - ไอแพด: ★ ส่งเองอัตโนมัติ (ไม่ต้องเปิดอะไร · ปิดได้ในเมนู ✦ "แคสหน้าจอไปจอใหญ่" → bio-psy-remote="0")
     ส่งเมื่อ เลื่อนหน้า (ทุก ~0.2 วิ ระหว่างเลื่อน) · เปลี่ยนหน้า/แท็บ/ช่วงเวลา · สลับมุมมองตาราง (P&L รายเดือน/
     ไตรมาส) · เปิด/ปิดกล่องบทวิเคราะห์ · เลือกเรื่องในแผงบทพูด · ชี้/แตะจอ
     สิ่งที่ส่ง = หน้าไหน + "กรอบที่อยู่ขอบบนจอ" (key ของ data-exn) + เลื่อนเข้าไปในกรอบนั้นกี่ส่วน (ratio)
     ★ เทียบเป็นกรอบ + สัดส่วน ไม่ใช่ตำแหน่งพิกเซล เพราะจอสองเครื่องคนละขนาด (กรอบสูงไม่เท่ากัน)
   - ทีวี: กดปุ่ม "📡 โหมดแคสหน้าจอ" มุมขวาล่าง (โผล่ที่ 3 หน้างบ · บัญชีที่ไม่ใช่ผู้นำเสนอ · เปิดแล้วอยู่ทุกหน้า)
     → อ่านกระดานทุก 0.35 วิ ถ้า seq เปลี่ยน = เปิดหน้า/แท็บ/ช่วงเดียวกัน แล้วเลื่อนไปตำแหน่งเดียวกัน
   ★ หลายคนนำเสนอ (Benya 2026-11-26 · 3 คนต่อบริษัท ส่งต่อกันภายใน 3 วิ — ผู้ใช้ขอ "การพรีพร้อมกันหลายคน"):
     แต่ละเครื่องผู้นำเสนอเขียนแถวของตัวเอง · คนต่อไปกด "📡 แคสจากเครื่องนี้" (psyTakeOver) → ทีวีสลับมาตาม
     เครื่องนั้นภายในครึ่งวินาที ไม่ต้องไปกดที่ทีวี · ยังไม่มีใครถือจอ/เครื่องที่ถือเงียบเกิน 30 นาที = เครื่องแรกที่ขยับรับจอเอง
     ทีวีกดปุ่มแคสแล้วเลือกได้ว่าจะ "ตามคนที่กดแคสล่าสุด" (ค่าเริ่มต้น) หรือล็อกไว้ที่เครื่องใดเครื่องหนึ่ง (bio-psy-lock)
     บัญชีผู้นำเสนอเดียวกันหลายเครื่องก็ได้ (แยกด้วยรหัสเครื่อง bio-psy-dev · ตั้งชื่อเครื่องได้ bio-psy-name)
   ★ ทีวีแสดงขอบไฮไลต์กรอบที่กำลังพูด (เรื่องที่เลือกในแผงบทพูด / กล่องบทวิเคราะห์ที่เปิด) + จุดแดงตามเมาส์/จุดที่แตะ
     (Benya เปลี่ยนจากเดิมที่ไม่ให้ทีวีมีไฮไลต์ · 2026-11-26) · ส่งแค่ focus/ptr = ทีวีวาดทันที ไม่ทำขั้นเปิดหน้าซ้ำ
     ★ POG: จุดชี้ยึดกับกรอบ data-exn ที่ครอบอยู่ (โครงในกรอบมาจากข้อมูล = เหมือนกันทั้ง 2 จอ ส่วนปุ่มนอกกรอบ
       ต่างกันตามสิทธิ์บัญชี) · จุดเดิมไม่เด้งกลับมาเมื่อไอแพดแค่เลื่อนหน้า (วาดเฉพาะตอนจุดชี้ใหม่)
   ★ ทำตามเฉพาะตอน seq เปลี่ยน → ระหว่างนั้นคนที่ทีวียังเลื่อนเองได้
   ★ สถานะเก่ากว่า 3 ชม. ไม่ทำตามตอนเพิ่งเปิดโหมด (กันหน้ากระโดดไปที่ประชุมครั้งก่อน)
   ★ จอทีวีที่ไม่มีสิทธิ์ดูหน้านั้น (เช่น role ที่ไม่เห็น P&L) = อยู่หน้าเดิม ไม่เด้งไปหน้าอื่น
   เรียกจาก: exec_notes.js (exnMount / exnMountFin / exnUnmount / เปิด-ปิดกล่อง / แผงบทพูด / เมนู ✦)
     · page_pnl.jsx → Psy.view(route, get, set) + Psy.push() เมื่อสลับรายเดือน/ไตรมาส (หน้างบฐานะของ BIO ไม่มีแท็บ)
   ===================================================================== */
(function () {
  const PSY_ROOM = 'main';
  const PSY_POLL_MS = 350;
  const PSY_OWNER_STALE = 30 * 60 * 1000;   // เครื่องที่ถือจอไม่ขยับเกิน 30 นาที = เครื่องอื่นรับจอเองได้
  const PSY_ROUTES = ['cashflow_present', 'pnl', 'balance_sheet'];
  const PSY_MAX_AGE = 3 * 3600 * 1000;
  const PSY_LS = 'bio-psy-';   // localStorage: remote · follow · lock · dev · name

  function psySession() { try { return JSON.parse(localStorage.getItem('bio-session') || 'null'); } catch (e) { return null; } }
  function psyToken() { return psySession() ? '1' : ''; }   // ★ BIOAXEL: session ของ Supabase อยู่ใน client — ดูแค่ว่าล็อกอินอยู่
  function psyIsPresenter() { const s = psySession(); return !!s && String(s.role || '').trim().toLowerCase() === 'presenter'; }
  function psyRoute() { return String(window.location.hash || '').replace(/^#/, '').split('?')[0]; }
  function psyOnCastPage() { return PSY_ROUTES.includes(psyRoute()); }
  function psyLsGet(k) { try { return localStorage.getItem(PSY_LS + k) === '1'; } catch (e) { return false; } }
  function psyLsSet(k, v) { try { localStorage.setItem(PSY_LS + k, v ? '1' : '0'); } catch (e) { } }
  /* ไอแพดส่งเป็นค่าเริ่มต้น — ปิดเมื่อกดปิดเองเท่านั้น */
  function psyRemoteOn() { try { return psyIsPresenter() && localStorage.getItem(PSY_LS + 'remote') !== '0'; } catch (e) { return psyIsPresenter(); } }
  function psyFollowOn() { return !!psyToken() && !psyIsPresenter() && psyLsGet('follow'); }
  const psySleep = ms => new Promise(r => setTimeout(r, ms));
  const psyEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function psyTopOffset() {
    const tb = document.querySelector('.topbar');
    return (tb && getComputedStyle(tb).display !== 'none' && getComputedStyle(tb).position === 'sticky' ? tb.offsetHeight : 0) + 12;
  }
  function psyExn() { return window.Exn || {}; }
  function psyBind() { try { if (psyExn().exnBindTargets) psyExn().exnBindTargets(); } catch (e) { } }
  /* เนื้อหาของหน้า (ไม่รวมเมนูซ้าย/แถบบน) — จุดเริ่มนับตำแหน่งของจุดชี้ที่ไม่ได้อยู่ในกรอบ */
  function psyMainEl() { return document.querySelector('.main > [data-screen-label]') || document.querySelector('.main'); }

  /* รหัส/ชื่อเครื่องนี้ (เก็บในเครื่อง) */
  function psyDevId() {
    try { let v = localStorage.getItem(PSY_LS + 'dev'); if (!v) { v = Math.random().toString(36).slice(2, 10); localStorage.setItem(PSY_LS + 'dev', v); } return v; }
    catch (e) { return window._psyDevMem || (window._psyDevMem = Math.random().toString(36).slice(2, 10)); }
  }
  function psyDevKind() {
    const u = navigator.userAgent || '';
    if (/iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone/.test(u)) return 'iPhone'; if (/Android/.test(u)) return 'Android'; if (/Windows/.test(u)) return 'Windows'; if (/Mac/.test(u)) return 'Mac';
    return 'เครื่อง';
  }
  function psyDevName() {
    try { const n = localStorage.getItem(PSY_LS + 'name'); if (n) return n; } catch (e) { }
    const s = psySession() || {};
    return (s.presentedBy || s.displayName || s.username || 'ผู้นำเสนอ') + ' · ' + psyDevKind();
  }
  function psyRowId(dev) { return 'd:' + (dev || psyDevId()); }

  /* ★ BIOAXEL: กระดานกลาง = ตาราง presentSync ผ่านตัวเชื่อม Supabase (app/data_supabase.js)
     rows = [{ id, state, ageMs }] · ageMs = อายุตาม updated_at ของแถว (นาฬิกา server) */
  function psyW() {
    const W = window.WTPData;
    if (!W || !W.presentSyncList || !W.presentSyncPut) throw new Error('ไม่พบตัวเชื่อมข้อมูล (presentSync)');
    return W;
  }
  async function psyRows() { const r = await psyW().presentSyncList(); return Array.isArray(r) ? r : []; }
  async function psyPutRow(id, state) { await psyW().presentSyncPut(state, id); }

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
    try { localStorage.setItem(PSY_LS + 'remote', (v == null ? !psyRemoteOn() : !!v) ? '1' : '0'); } catch (e) { }
    _psyLastSig = null;
    if (psyRemoteOn()) { psyPush(true); psyOwnLoop(); }
    psyRenderMe();
    if (psyExn().exnRenderFab) psyExn().exnRenderFab();
    if (psyExn().exnRenderScript) psyExn().exnRenderScript();
  }
  /* กรอบที่อยู่ขอบบนจอตอนนี้ + เลื่อนเข้าไปในกรอบกี่ส่วน (0–1)
     ★ key เดียวติดได้หลายชิ้น → ส่ง idx = ชิ้นที่เท่าไรของ key นั้นด้วย
     ★ กรอบวางคู่กันซ้าย-ขวา (ขอบบนเท่ากัน) → เลือกกรอบที่กำลังพูดก่อน (เรื่องในแผงบทพูด / กล่องที่เปิดอยู่) */
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
    const pk = window._exnPopKeys, act = psyFocusKey();
    const best = (pk && pk.el && cand.find(x => x.el === pk.el)) || (act && cand.find(x => psyKeysOf(x.el).includes(act))) || cand[0];
    const keys = psyKeysOf(best.el);
    const key = act && keys.includes(act) ? act : keys[0];
    const idx = Math.max(0, psyFrames().filter(e => psyKeysOf(e).includes(key)).indexOf(best.el));
    return { key, idx, ratio: Math.round((line - best.r.top) / best.r.height * 1000) / 1000 };
  }
  /* กรอบที่กำลังพูด: เรื่องที่เลือกในแผงบทพูด → ไม่งั้นกล่องบทวิเคราะห์ที่เปิดอยู่ */
  function psyFocusKey() {
    if (!psyOnCastPage()) return null;
    if ((psyExn().exnScOpen ? psyExn().exnScOpen() : document.getElementById('exnScript')) && window._exnScActive) return window._exnScActive;   // แผงบทพูดในหน้าเว็บ หรือในหน้าต่างลอย
    const k = window._exnPopKeys;
    return (document.getElementById('exnPop') && k && k.keys && k.keys.length) ? k.keys[0] : null;
  }
  /* จุดชี้: เมาส์ (เลื่อน) หรือแตะ (นิ้ว) → ชิ้นใต้จุดนั้น + ตำแหน่งในชิ้นเป็นสัดส่วน
     ★ POG: นับ path จากกรอบ data-exn ที่ครอบอยู่ (fk/fi) — ไม่มีกรอบครอบ = นับจากเนื้อหาของหน้า */
  function psyPtrFrom(e, tap) {
    const m = psyMainEl(), t = e.target;
    if (!m || !t || t.nodeType !== 1 || !m.contains(t) || t === m) return null;
    if (t.closest && t.closest('#exnRoot')) return null;   // แผงบทพูด/กล่องบทวิเคราะห์ของผู้นำเสนอ ไม่ใช่ของบนจอใหญ่
    let el = t;
    while (el.parentElement && el.parentElement !== m) { const r = el.getBoundingClientRect(); if (r.width >= 16 && r.height >= 16) break; el = el.parentElement; }
    let base = m, fk = null, fi = 0;
    const fr = el.closest ? el.closest('[data-exn]') : null;
    if (fr && m.contains(fr)) {
      fk = psyKeysOf(fr)[0] || null;
      if (fk) { base = fr; fi = Math.max(0, psyFrames().filter(x => psyKeysOf(x).includes(fk)).indexOf(fr)); }
    }
    const path = [];
    for (let n = el; n !== base; n = n.parentElement) { if (!n || !n.parentElement) return null; path.unshift(Array.prototype.indexOf.call(n.parentElement.children, n)); }
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null;
    const rd = v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    return { fk, fi, path: path.join('.'), tag: el.tagName, rx: rd((e.clientX - r.left) / r.width), ry: rd((e.clientY - r.top) / r.height), tap: !!tap, t: Date.now() };
  }
  function psyInstallPointer() {
    if (window._psyPtrOn) return; window._psyPtrOn = true;
    document.addEventListener('pointermove', e => {
      if (!psyRemoteOn() || e.pointerType !== 'mouse' || !psyOnCastPage()) return;
      window._psyPtr = psyPtrFrom(e, false); psyPush();
    }, { passive: true });
    document.addEventListener('pointerdown', e => {
      if (!psyRemoteOn() || !psyOnCastPage()) return;
      const p = psyPtrFrom(e, e.pointerType !== 'mouse'); if (!p) return;
      window._psyPtr = p; psyPush(true);
    }, { passive: true, capture: true });
    document.documentElement.addEventListener('mouseleave', () => { if (psyRemoteOn() && window._psyPtr) { window._psyPtr = null; psyPush(); } });
  }
  function psyCurState() {
    const route = psyRoute();
    const st = { v: 2, route };
    if (route === 'cashflow_present' && window.CfpEd && window.CfpEd.edState) {
      const d = window.CfpEd.edState(); st.tab = d.tab || 'summary'; st.period = d.monthFilter || 'all';
    }
    const vw = _psyViews[route];
    if (vw && vw.get) { try { st.view = vw.get(); } catch (e) { } }
    Object.assign(st, psyAnchor());
    st.focus = psyFocusKey();
    if (window._psyPtr) st.ptr = window._psyPtr;
    st.who = psyDevName();
    return st;
  }
  /* เรียกเมื่อสิ่งที่จอใหญ่ควรเห็นเปลี่ยน (หน่วงรวม ~0.2 วิ · ระหว่างเลื่อนต่อเนื่องส่งทุก ~0.2 วิ) */
  function psyPush(now) {
    psyInstallScroll();
    psyInstallPointer();
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
      st.seq = Date.now(); st.t = st.seq;
      await psyPutRow(psyRowId(), st);
      _psyLastSig = sig;
      Object.assign(_psyStatus, { ok: true, msg: '', at: Date.now() });
      psyAutoClaim();
    } catch (e) {
      Object.assign(_psyStatus, { ok: false, msg: String((e && e.message) || e), at: Date.now() });
    } finally {
      _psySending = false;
      if (was !== _psyStatus.ok) { if (psyExn().exnRenderFab) psyExn().exnRenderFab(); psyRenderMe(); }
      psyPaintStatus();
      if (_psyAgain) { _psyAgain = false; psySend(); }
    }
  }

  /* ---------- ใครถือจออยู่ (ผู้นำเสนอหลายคน) ---------- */
  let _psyMain = null, _psyMainAt = 0, _psyOwnT = null, _psyClaiming = false, _psyOwnerFresh = false;
  function psyIsOwner() { return !!(_psyMain && _psyMain.owner === psyDevId()); }
  async function psyReadMain() {
    try {
      const rows = await psyRows(), main = rows.find(r => r.id === PSY_ROOM);
      _psyMain = (main && main.state && main.state.owner) ? main.state : null; _psyMainAt = Date.now();
      const own = _psyMain && rows.find(r => r.id === psyRowId(_psyMain.owner));
      _psyOwnerFresh = !!(own && own.state && Number(own.ageMs) < PSY_OWNER_STALE);
    } catch (e) { }
  }
  /* ยังไม่มีใครถือจอ หรือเครื่องที่ถือหายไปนานแล้ว → เครื่องนี้รับจอเอง (คนเดียวนำเสนอไม่ต้องกดอะไร) */
  async function psyAutoClaim() {
    if (_psyClaiming || !psyRemoteOn()) return;
    if (Date.now() - _psyMainAt > 5000) { await psyReadMain(); psyRenderMe(); psyPaintStatus(); }
    if (psyIsOwner() || (_psyMain && _psyOwnerFresh)) return;
    await psyTakeOver(true);
  }
  async function psyTakeOver(auto) {
    if (!psyRemoteOn() || _psyClaiming) return;
    _psyClaiming = true;
    try {
      const s = psySession() || {};
      const st = { v: 3, owner: psyDevId(), name: psyDevName(), user: s.username || null, at: Date.now(), auto: !!auto };
      await psyPutRow(PSY_ROOM, st);
      _psyMain = st; _psyMainAt = Date.now(); _psyOwnerFresh = true;
      _psyLastSig = null; psyPush(true);
    } catch (e) { Object.assign(_psyStatus, { ok: false, msg: String((e && e.message) || e), at: Date.now() }); }
    finally { _psyClaiming = false; psyPaintStatus(); psyRenderMe(); }
  }
  /* ไอแพด: อ่านว่าใครถือจอทุก 1.5 วิ (มีคนกดรับจอไป → ปุ่มเปลี่ยนเป็น "แคสจากเครื่องนี้") */
  function psyOwnLoop() {
    clearTimeout(_psyOwnT); _psyOwnT = null;
    if (!psyRemoteOn()) return;
    if (!document.hidden && psyOnCastPage()) psyReadMain().then(() => { psyPaintStatus(); psyRenderMe(); });
    _psyOwnT = setTimeout(psyOwnLoop, 1500);
  }
  function psyRename() {
    const v = prompt('ตั้งชื่อเครื่องนี้ (ทีวีจะเห็นชื่อนี้ในรายการเลือกเครื่อง)', psyDevName());
    if (v == null) return;
    try { if (v.trim()) localStorage.setItem(PSY_LS + 'name', v.trim().slice(0, 40)); else localStorage.removeItem(PSY_LS + 'name'); } catch (e) { }
    _psyLastSig = null; psyPush(true); psyCloseMeMenu(); psyRenderMe();
    if (psyIsOwner()) psyTakeOver(false);   // ชื่อในแถว main (ที่ทีวีโชว์ "ตอนนี้: …") เปลี่ยนตาม
  }
  /* ปุ่มผู้นำเสนอ (มุมขวาล่าง เหนือปุ่ม ✦): ถือจออยู่ = "กำลังแคส" · ไม่ได้ถือ = "แคสจากเครื่องนี้" (กดครั้งเดียวรับจอ)
     ★ แผงบทพูดเปิดอยู่ = ปุ่มนี้ซ่อน ใช้ป้าย 📡 ในหัวแผงแทน (psyPaintStatus) */
  function psyRenderMe() {
    let b = document.getElementById('psyMe');
    if (!psyRemoteOn() || !psyOnCastPage()) { if (b) b.remove(); psyCloseMeMenu(); return; }
    psyInjectCss();
    if (!b) { b = document.createElement('button'); b.id = 'psyMe'; b.type = 'button'; b.onclick = psyMeClick; document.body.appendChild(b); }
    const own = psyIsOwner(), bad = _psyStatus.ok === false;
    b.className = own ? (bad ? 'own bad' : 'own') : (bad ? 'bad' : '');
    b.innerHTML = own ? `<i></i>${bad ? 'แคสไม่สำเร็จ' : 'กำลังแคสจากเครื่องนี้'}`
      : (bad ? '<i></i>แคสไม่สำเร็จ' : `📡 แคสจากเครื่องนี้${_psyMain && _psyMain.name ? `<small>ตอนนี้: ${psyEsc(_psyMain.name)}</small>` : ''}`);
    b.title = bad ? 'แคสหน้าจอไม่สำเร็จ: ' + (_psyStatus.msg || '') : own ? 'จอใหญ่กำลังแสดงตามเครื่องนี้ · กดเพื่อดูตัวเลือก' : 'กดเพื่อให้จอใหญ่สลับมาแสดงตามเครื่องนี้';
    b.style.bottom = document.getElementById('exnFab') ? '74px' : '18px';
  }
  function psyMeClick() {
    if (!psyIsOwner()) { psyTakeOver(false); return; }
    if (document.getElementById('psyMeMenu')) { psyCloseMeMenu(); return; }
    const m = document.createElement('div'); m.id = 'psyMeMenu';
    const b = document.getElementById('psyMe'), r = b.getBoundingClientRect();
    m.style.right = Math.max(10, window.innerWidth - r.right) + 'px'; m.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    m.innerHTML = `<div class="hd">เครื่องนี้: ${psyEsc(psyDevName())}</div>
      <button type="button" data-a="rename">✎ ตั้งชื่อเครื่องนี้</button>
      <button type="button" data-a="stop">⏸ หยุดส่งหน้าจอจากเครื่องนี้</button>`;
    m.querySelector('[data-a="rename"]').onclick = psyRename;
    m.querySelector('[data-a="stop"]').onclick = () => { psyCloseMeMenu(); psyRemoteToggle(false); };
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('click', psyMeOutside, true), 0);
  }
  function psyMeOutside(e) { const m = document.getElementById('psyMeMenu'); if (m && !m.contains(e.target) && e.target.id !== 'psyMe' && !(e.target.closest && e.target.closest('#psyMe'))) psyCloseMeMenu(); }
  function psyCloseMeMenu() { const m = document.getElementById('psyMeMenu'); if (m) m.remove(); document.removeEventListener('click', psyMeOutside, true); }
  /* ป้ายสถานะในหัวแผงบทพูด (exec_notes.js วาด <span id="exnPsyTag">) — ไม่ได้ถือจอ = กดป้ายเพื่อรับจอ */
  function psyPaintStatus() {
    const el = (psyExn().exnScDoc ? psyExn().exnScDoc() : document).getElementById('exnPsyTag'); if (!el) return;   // แผงอาจอยู่ในหน้าต่างลอย
    const s = _psyStatus, own = psyIsOwner();
    el.className = 'exn-psy ' + (s.ok === false ? 'bad' : own ? 'ok' : 'idle');
    el.textContent = s.ok === false ? '📡 แคสไม่สำเร็จ' : own ? '📡 กำลังแคส' : '📡 แคสจากเครื่องนี้';
    el.title = s.ok === false ? (s.msg || '') : own ? 'จอที่เปิด "โหมดแคสหน้าจอ" แสดงตามเครื่องนี้' : 'ตอนนี้จอใหญ่ตาม ' + ((_psyMain && _psyMain.name) || 'เครื่องอื่น') + ' · กดเพื่อให้ตามเครื่องนี้';
    el.onclick = own ? null : () => psyTakeOver(false);
    el.style.cursor = own ? 'default' : 'pointer';
  }

  /* ---------- ทีวี (ตัวตาม) ---------- */
  let _psyTimer = null, _psySeq = 0, _psyTid = null, _psyCore = '', _psyBusy = false, _psyOk = null;
  let _psyDevs = [], _psyOwner = null, _psyLastSt = null, _psyNoAccess = false;
  function psyLockGet() { try { return localStorage.getItem(PSY_LS + 'lock') || ''; } catch (e) { return ''; } }
  function psyLockSet(v) { try { if (v) localStorage.setItem(PSY_LS + 'lock', v); else localStorage.removeItem(PSY_LS + 'lock'); } catch (e) { } }
  /* สิ่งที่ต้องทำขั้นเปิดหน้า/เลื่อน (ไม่นับจุดชี้/กรอบที่พูด) — เปลี่ยนแค่จุดชี้ = วาดจุดอย่างเดียว */
  function psyCore(st) { const o = Object.assign({}, st); ['seq', 't', 'ptr', 'focus', 'who'].forEach(k => delete o[k]); return JSON.stringify(o); }
  function psyFollowToggle(v) {
    const on = v == null ? !psyLsGet('follow') : !!v;
    psyLsSet('follow', on);
    _psySeq = 0; _psyTid = null; _psyCore = ''; _psyOk = null; _psyNoAccess = false;
    if (!on) { psyPaintFocus(null); psyCloseTvMenu(); }
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
          const rows = await psyRows(), main = rows.find(r => r.id === PSY_ROOM);
          _psyDevs = rows.filter(r => /^d:/.test(String(r.id)) && r.state && r.state.route && Number(r.ageMs) < PSY_MAX_AGE);
          _psyOwner = main && main.state && main.state.owner ? main.state : null;
          const lock = psyLockGet();
          let target = null;
          if (lock) target = _psyDevs.find(r => r.id === psyRowId(lock)) || null;
          else if (_psyOwner) target = rows.find(r => r.id === psyRowId(_psyOwner.owner)) || null;
          else if (main && main.state && main.state.route) target = main;   // รูปแบบเดิม (แถวเดียว)
          const st = target && target.state, tid = target ? target.id : null, seq = st && (st.seq || target.seq);
          _psyOk = true;
          if (st && seq && (seq !== _psySeq || tid !== _psyTid)) {
            const first = !_psySeq, switched = tid !== _psyTid;
            _psySeq = seq; _psyTid = tid;
            const age = Number(target.ageMs) || 0;
            if (!first || age < PSY_MAX_AGE) {
              _psyLastSt = st;
              const core = psyCore(st);
              if (!switched && core === _psyCore) psyPaintFocus(st, age);   // ขยับแค่จุดชี้/กรอบที่พูด
              else {
                _psyCore = core;
                try { await psyApply(st); } catch (e) { console.warn('[psy] apply', e); }
                psyPaintFocus(st, age);
              }
            }
          }
          if (document.getElementById('psyTvMenu')) psyRenderTvMenu();
        } catch (e) { _psyOk = false; }
        psyRenderPill();
      }
    } finally { _psyBusy = false; }
    clearTimeout(_psyTimer); _psyTimer = null;
    if (psyFollowOn()) _psyTimer = setTimeout(psyLoop, PSY_POLL_MS);
  }
  /* ขอบไฮไลต์กรอบที่กำลังพูด + จุดชี้ (บนทีวีเท่านั้น) · age = อายุของแถวตามนาฬิกา server */
  function psyPaintFocus(st, age) {
    const ok = !!(st && st.route === psyRoute());
    const key = ok && st.focus ? st.focus : null;
    const has = e => psyKeysOf(e).includes(key);
    document.querySelectorAll('.psy-hl').forEach(e => { if (!key || !has(e)) e.classList.remove('psy-hl'); });
    if (key) { psyBind(); psyFrames().filter(has).forEach(e => e.classList.add('psy-hl')); }
    const p = ok ? st.ptr : null;
    // อายุของจุดชี้ = (เวลาที่ส่งสถานะ − เวลาที่ชี้ · นาฬิกาไอแพดทั้งคู่) + อายุของแถว
    const pAge = p ? Math.max(0, Number(st.t || 0) - Number(p.t || 0)) + (Number(age) || 0) : 0;
    psyPaintDot(p, pAge);
  }
  function psyPtrEl(p) {
    let base = psyMainEl();
    if (p.fk) { psyBind(); const all = psyFrames().filter(e => psyKeysOf(e).includes(p.fk)); base = all[p.fi || 0] || all[0] || null; }
    if (!base) return null;
    let n = base;
    if (p.path) for (const i of String(p.path).split('.')) { n = n && n.children[Number(i)]; if (!n) return null; }
    return n;
  }
  let _psyDotSeen = null;
  function psyPaintDot(p, pAge) {
    let dot = document.getElementById('psyDot');
    const hide = () => { if (dot) dot.classList.remove('on', 'tap'); };
    if (!p || (!p.path && !p.fk)) { hide(); return; }
    /* ★ POG: วาดเฉพาะจุดชี้ใหม่ — ไอแพดส่งจุดเดิมติดไปกับทุกการเลื่อน (ของ Benya จุดเดิมเด้งกลับมาทุกครั้งที่เลื่อน)
       จุดเดิมที่ยังโชว์อยู่ = ขยับตามหน้า (หน้าวาดใหม่/เลื่อนไปกรอบอื่น) โดยไม่ต่อเวลา */
    const fresh = p.t !== _psyDotSeen;
    if (fresh) _psyDotSeen = p.t;
    if (!fresh && !(dot && dot.classList.contains('on'))) return;
    if (fresh && Number(pAge) > (p.tap ? 2600 : 8000)) { hide(); return; }   // จุดที่ควรหายไปแล้ว (เช่น เพิ่งเปิดโหมด)
    const el = psyPtrEl(p);
    if (!el || el.tagName !== p.tag) { hide(); return; }
    psyInjectCss();
    if (!dot) { dot = document.createElement('div'); dot.id = 'psyDot'; document.body.appendChild(dot); }
    const r = el.getBoundingClientRect();
    dot.style.left = Math.round(r.left + window.scrollX + (Number(p.rx) || 0) * r.width) + 'px';
    dot.style.top = Math.round(r.top + window.scrollY + (Number(p.ry) || 0) * r.height) + 'px';
    if (!fresh) return;
    dot.classList.remove('tap'); void dot.offsetWidth;   // แตะซ้ำ = เล่นวงกระเพื่อมใหม่
    dot.classList.add('on'); dot.classList.toggle('tap', !!p.tap);
    clearTimeout(window._psyDotT);
    window._psyDotT = setTimeout(() => dot.classList.remove('on', 'tap'), p.tap ? 2600 : 8000);
  }
  async function psyWaitFor(fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) { } await psySleep(120); }
    return false;
  }
  async function psyApply(st) {
    if (!st || !PSY_ROUTES.includes(st.route)) return;
    _psyNoAccess = false;
    if (psyRoute() !== st.route) {
      if (window.WTPAuth && window.WTPAuth.canViewPage && !window.WTPAuth.canViewPage(st.route)) { _psyNoAccess = true; return; }   // จอนี้ไม่มีสิทธิ์ดูหน้านั้น
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
  /* เลื่อนจอไปตำแหน่งเดียวกับไอแพด = กรอบเดียวกัน + เลื่อนเข้าไปในกรอบเท่ากัน */
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

  /* ปุ่ม "📡 โหมดแคสหน้าจอ" มุมขวาล่าง — บัญชีที่ไม่ใช่ผู้นำเสนอ · ยังไม่เปิด = โผล่เฉพาะ 3 หน้างบ · เปิดแล้วอยู่ทุกหน้า
     ★ POG: วางใน <body> แล้วซ่อน/แสดงตาม route (Benya วางใน #main ที่ถูกวาดใหม่ทุกครั้งที่เปลี่ยนหน้า) */
  function psyRenderPill() {
    const old = document.getElementById('psyPill');
    if (psyIsPresenter() || !psyToken() || !(psyFollowOn() || psyOnCastPage())) { if (old) old.remove(); psyCloseTvMenu(); return; }
    psyInjectCss();
    let p = old;
    if (!p) { p = document.createElement('button'); p.id = 'psyPill'; p.type = 'button'; p.onclick = psyPillClick; document.body.appendChild(p); }
    psyPaintPill();
    psyEnsureLoop();
  }
  function psyPaintPill() {
    const p = document.getElementById('psyPill'); if (!p) return;
    const on = psyFollowOn(), na = on && _psyNoAccess;
    p.className = on ? (_psyOk === false || na ? 'on bad' : 'on') : '';
    const who = _psyLastSt && _psyLastSt.who;
    p.innerHTML = on ? `<i></i>${_psyOk === false ? 'แคสหน้าจอ · เชื่อมต่อไม่ได้' : na ? 'แคสหน้าจอ · จอนี้ไม่มีสิทธิ์เปิดหน้านั้น' : 'กำลังแคสหน้าจอ' + (who ? ' · ' + psyEsc(who) : '')}` : '📡 โหมดแคสหน้าจอ';
    p.title = on ? 'จอนี้แสดงตามหน้าจอของผู้นำเสนอ · กดเพื่อเลือกเครื่อง/หยุด' : 'เปิดให้จอนี้แสดงตามหน้าจอของผู้นำเสนอ (ใช้กับคอมที่ต่อทีวี)';
  }
  /* ทีวี: กดปุ่มตอนแคสอยู่ = เมนูเลือกว่าจะตามใคร */
  function psyPillClick() {
    if (!psyFollowOn()) { psyFollowToggle(true); return; }
    if (document.getElementById('psyTvMenu')) { psyCloseTvMenu(); return; }
    psyRenderTvMenu();
    setTimeout(() => document.addEventListener('click', psyTvOutside, true), 0);
  }
  function psyRenderTvMenu() {
    let m = document.getElementById('psyTvMenu');
    if (!m) { m = document.createElement('div'); m.id = 'psyTvMenu'; document.body.appendChild(m); }
    const lock = psyLockGet(), own = _psyOwner, devs = _psyDevs.slice().sort((a, b) => Number(a.ageMs || 0) - Number(b.ageMs || 0));
    const ago = ms => { const s = Math.max(0, Math.round(Number(ms || 0) / 1000)); return s < 60 ? s + ' วิที่แล้ว' : Math.round(s / 60) + ' นาทีที่แล้ว'; };
    m.innerHTML = `<div class="hd">จอนี้แสดงตาม</div>
      <button type="button" class="${!lock ? 'on' : ''}" data-dev=""><b>⚡ คนที่กด "แคสจากเครื่องนี้" ล่าสุด</b><small>${own ? 'ตอนนี้: ' + psyEsc(own.name || '') : 'ยังไม่มีใครกด'}</small></button>
      ${devs.map(r => { const id = String(r.id).slice(2), st = r.state; return `<button type="button" class="${lock === id ? 'on' : ''}" data-dev="${psyEsc(id)}"><b>${psyEsc(st.who || id)}${own && own.owner === id ? ' <em>กำลังแคส</em>' : ''}</b><small>ขยับล่าสุด ${ago(r.ageMs)}</small></button>`; }).join('') || '<div class="mt">ยังไม่มีเครื่องผู้นำเสนอที่ส่งหน้าจอ</div>'}
      <button type="button" class="stop" data-a="stop">⏹ หยุดแคสหน้าจอ</button>`;
    m.querySelectorAll('[data-dev]').forEach(b => { b.onclick = () => psyChoose(b.getAttribute('data-dev')); });
    m.querySelector('[data-a="stop"]').onclick = () => { psyCloseTvMenu(); psyFollowToggle(false); };
  }
  function psyChoose(id) { psyLockSet(id); _psySeq = 0; _psyTid = null; _psyCore = ''; psyCloseTvMenu(); clearTimeout(_psyTimer); _psyTimer = null; psyLoop(); }
  function psyTvOutside(e) { const m = document.getElementById('psyTvMenu'); if (m && !m.contains(e.target) && e.target.id !== 'psyPill' && !(e.target.closest && e.target.closest('#psyPill'))) psyCloseTvMenu(); }
  function psyCloseTvMenu() { const m = document.getElementById('psyTvMenu'); if (m) m.remove(); document.removeEventListener('click', psyTvOutside, true); }
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
    #psyTvMenu,#psyMeMenu{position:fixed;right:14px;bottom:58px;z-index:2147483100;width:min(330px,calc(100vw - 28px));max-height:70vh;overflow:auto;background:rgba(255,255,255,.96);border:1px solid rgba(124,58,237,.25);border-radius:14px;box-shadow:0 18px 44px rgba(30,27,75,.22);padding:8px;font-size:13px}
    #psyTvMenu .hd,#psyMeMenu .hd{font-size:11.5px;font-weight:800;color:#6d28d9;padding:4px 8px 6px;letter-spacing:.2px}
    #psyTvMenu button,#psyMeMenu button{display:block;width:100%;text-align:left;border:1px solid transparent;background:none;border-radius:10px;padding:8px 10px;font:inherit;cursor:pointer;color:#0f172a}
    #psyTvMenu button:hover,#psyMeMenu button:hover{background:rgba(124,58,237,.07)}
    #psyTvMenu button.on{background:rgba(124,58,237,.1);border-color:rgba(124,58,237,.35)}
    #psyTvMenu button b{display:block;font-size:13.5px}#psyTvMenu button small{display:block;color:#64748b;font-size:11.5px;margin-top:2px}
    #psyTvMenu button em{font-style:normal;font-size:10.5px;color:#047857;background:#d1fae5;border-radius:999px;padding:1px 7px;margin-left:4px}
    #psyTvMenu button.stop{color:#b91c1c;margin-top:4px;border-top:1px solid #f1f5f9;border-radius:0 0 10px 10px}
    #psyTvMenu .mt{color:#94a3b8;font-size:12px;padding:6px 10px}
    #psyMe{position:fixed;right:18px;bottom:18px;z-index:949;border:1px solid rgba(124,58,237,.4);background:rgba(255,255,255,.92);color:#5b21b6;border-radius:999px;padding:8px 14px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 8px 20px rgba(30,27,75,.16);display:flex;align-items:center;gap:7px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
    #psyMe small{font-weight:600;color:#64748b;font-size:11px;margin-left:4px}
    #psyMe.own{color:#047857;border-color:rgba(16,185,129,.45)}
    #psyMe.own i{width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.25);display:inline-block}
    #psyMe.bad{color:#b91c1c;border-color:rgba(239,68,68,.45)}#psyMe.bad i{width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block}
    body.exn-sc-open #psyMe{display:none}
    .psy-hl{outline:3px solid rgba(124,58,237,.9)!important;outline-offset:5px;border-radius:14px;box-shadow:0 0 0 10px rgba(124,58,237,.13),0 0 30px rgba(124,58,237,.35)!important;transition:outline-color .2s,box-shadow .2s}
    #psyDot{position:absolute;left:0;top:0;z-index:2147483000;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;pointer-events:none;opacity:0;
      background:radial-gradient(circle,rgba(239,68,68,.95) 0 32%,rgba(239,68,68,.28) 34% 100%);box-shadow:0 0 0 3px rgba(255,255,255,.75),0 0 18px rgba(239,68,68,.55);transition:left .3s linear,top .3s linear,opacity .35s}
    #psyDot.on{opacity:1}
    #psyDot.tap{animation:psyTap 1s ease-out 2}
    @keyframes psyTap{0%{box-shadow:0 0 0 3px rgba(255,255,255,.75),0 0 0 0 rgba(239,68,68,.6)}100%{box-shadow:0 0 0 3px rgba(255,255,255,.75),0 0 0 26px rgba(239,68,68,0)}}
    @media print{#psyPill,#psyMe,#psyDot,#psyTvMenu,#psyMeMenu{display:none!important}.psy-hl{outline:none!important;box-shadow:none!important}}`;
    document.head.appendChild(s);
  }

  /* หน้าเปลี่ยน (hashchange) → ปุ่มทีวีโผล่/หายตามหน้า · ไอแพดบอกจอใหญ่ว่าเปลี่ยนหน้า (หน้าใหม่วาดเสร็จจะ push ซ้ำเอง)
     ★ จุดชี้ของหน้าเดิมใช้กับหน้าใหม่ไม่ได้ → ล้าง */
  window.addEventListener('hashchange', () => { window._psyPtr = null; psyRenderPill(); psyRenderMe(); psyPush(); });

  /* exec_notes.js เรียกตอนหน้า 3 งบวาดเสร็จ / ออกจากหน้า */
  function psyOnMount() {
    psyRenderPill();
    if (psyRemoteOn()) { if (!_psyOwnT) psyOwnLoop(); psyRenderMe(); psyPaintStatus(); }
    if (psyFollowOn() && _psyLastSt) psyPaintFocus(_psyLastSt);   // หน้าวาดใหม่ → ใส่ขอบไฮไลต์คืน
    psyPush();
  }
  function psyOnUnmount() { setTimeout(() => { psyRenderPill(); psyRenderMe(); }, 0); }

  window.Psy = {
    push: psyPush, view: psyView, onMount: psyOnMount, onUnmount: psyOnUnmount,
    remoteOn: psyRemoteOn, remoteToggle: psyRemoteToggle, status: () => Object.assign({}, _psyStatus),
    isOwner: psyIsOwner, takeOver: () => psyTakeOver(false), paintStatus: psyPaintStatus,
    followOn: psyFollowOn, followToggle: psyFollowToggle,
    // ทดสอบ/ตรวจสอบ
    _curState: psyCurState, _apply: psyApply, _devId: psyDevId,
  };
})();
