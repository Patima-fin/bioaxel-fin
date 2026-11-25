/* page_users.jsx — Users management (manager-only)
   CRUD over the `users` entity, synced to Google Sheet 'users' tab.
   Roles: viewer / staff / manager / owner.
*/
'use strict';

const { useState: uState, useMemo: uMemo, useEffect: uEffect } = React;

const ROLE_LABELS = {
  viewer:  { label: 'Viewer',  color: 'b-gray',   desc: 'ดูเฉพาะ Dashboard (Daily + War Room)' },
  staff:   { label: 'Staff',   color: 'b-blue',   desc: 'แก้ไขข้อมูลได้ แต่ลบไม่ได้' },
  manager: { label: 'Manager', color: 'b-green',  desc: 'ทุกอย่าง รวมจัดการ users + audit log' },
  owner:   { label: 'Owner',   color: 'b-violet', desc: 'ดูได้ทุกหน้า แต่แก้/ลบไม่ได้' },
  presenter: { label: 'ผู้นำเสนอ', color: 'b-amber', desc: 'บัญชีพรีเซนต์ เห็นแค่ 3 งบการเงิน ดูอย่างเดียว' },
};

// ─── บัญชีผู้นำเสนอ (2026-11-25 · แบบ Water POG) ─────────────────────────────
//   บัญชีกลาง 1 บัญชี ชื่อผู้ใช้ = WTP_CONFIG.PRESENTER_USERNAME (role 'presenter' ใน Supabase Auth —
//   สร้าง/ตั้งรหัสที่ tools/supabase-auth-setup.html · รหัสของบัญชีนี้ = "รหัสพิเศษ")
//   + ช่องติ๊ก "🎤 เข้าบัญชีผู้นำเสนอได้" รายคน (users.canPresent = 'true' — สตริงแบบ notifyDailyBalance)
//   → คนที่ติ๊กพิมพ์ชื่อผู้ใช้ของตัวเอง + รหัสพิเศษ แล้วเข้าบัญชีผู้นำเสนอ (LoginPage → authSignInPresenterAlias)
const uPresenterName = () => String((window.WTP_CONFIG && window.WTP_CONFIG.PRESENTER_USERNAME) || 'presenter').trim().toLowerCase();
const uIsActive = (v) => {
  const a = String(v == null ? 'true' : v).toLowerCase().trim();
  return a !== 'false' && a !== 'no' && a !== '0' && a !== 'inactive' && a !== 'disabled';
};
const uCanPresent = (u) => !!u && u.role !== 'presenter' && String(u.canPresent || '') === 'true';

// ─── helpers: "หน้าที่เข้าถึงได้" รายคน (ฟิลด์ `pages` = CSV, ว่าง = ตาม role) ──
// กลุ่ม/ชื่อหน้า มาจาก window.WTP_PAGE_GROUPS ใน app.jsx — เพิ่มหน้าใหม่ที่นั่นที่เดียว
const uPageGroups = () => window.WTP_PAGE_GROUPS || [];
const uParsePages = (v) => (window.wtpParsePages ? window.wtpParsePages(v) : []);
const uRolePages  = (role) => (window.WTPAuth && window.WTPAuth.rolePages) ? window.WTPAuth.rolePages(role) : [];
// ตัดหน้ากลุ่ม "ระบบ" ออกถ้า role ไม่ใช่ manager — กันค่าค้างตอนลดสิทธิ์ manager→staff
// (WTPAuth บล็อกให้อยู่แล้ว แต่เก็บ CSV ให้ตรงความจริงจะได้ไม่หลอกตาคนอ่าน)
const uStripPages = (pages, role) => {
  const keys = uParsePages(pages);
  if (!keys.length || role === 'manager') return keys.join(',');
  const mo = new Set(uPageGroups().filter(g => g.managerOnly)
    .reduce((a, g) => a.concat(g.items.map(it => it[0])), []));
  return keys.filter(k => !mo.has(k)).join(',');
};

// ─── หน่วยงาน (department) — ตัวเลือกมาตรฐาน · "การเงิน" ใช้กรอง dropdown "ผู้รับผิดชอบ"
//   หน้ากระทบยอดธนาคาร (wtpUsersByDept('finance')) · เก็บเป็น label ไทยตรงๆ ──
const DEPARTMENTS = ['การเงิน', 'บัญชี', 'ธุรการ', 'จัดซื้อ', 'ผู้บริหาร', 'อื่นๆ'];

function UsersPage({ data, setData, toast }) {
  // Manager-only guard (extra safety on top of sidebar filtering)
  const canSee = window.WTPAuth ? window.WTPAuth.can('canManageUsers') : true;
  if (!canSee) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 600, color: 'var(--ink-600)' }}>ต้องเป็น Manager เท่านั้นถึงจะเข้าได้</div>
        </div>
      </div>
    );
  }

  const sheetUsers   = (data && data.users) || [];
  const configUsers  = (window.WTP_CONFIG && window.WTP_CONFIG.USERS) || [];
  // login ผ่าน Supabase Auth → ช่อง password ในตารางนี้ไม่ได้ใช้ตรวจ login อีกแล้ว
  const authViaSupabase = !!(window.WTP_CONFIG && window.WTP_CONFIG.USE_SUPABASE_AUTH);

  // Show Sheet users + config users (read-only). Sheet users have actual id.
  // _source values: 'sheet' (Sheet only) | 'config' (config only) | 'both' (มีทั้งใน Sheet และ config.js — มี bootstrap fallback)
  const combinedRows = uMemo(() => {
    const sheetByName = new Set(sheetUsers.map(u => u.username));
    const configByName = new Set(configUsers.map(u => u.username));
    const rows = sheetUsers.map(u => ({
      ...u,
      _source: configByName.has(u.username) ? 'both' : 'sheet',
    }));
    configUsers.forEach(u => {
      if (!sheetByName.has(u.username)) {
        rows.push({ ...u, _source: 'config', id: 'cfg_' + u.username });
      }
    });
    return rows;
  }, [sheetUsers, configUsers]);

  const [query, setQuery] = uState('');
  const [roleFilter, setRoleFilter] = uState('all');
  const [edit, setEdit] = uState(null);   // null | {} (new) | row (edit)
  const [showPw, setShowPw] = uState({});  // { rowId: bool }
  const [sort, setSort] = uState({ key: 'username', dir: 'asc' });

  const uSortVal = (u, key) => String(u[key] || '').toLowerCase();
  const toggleSort = (key) => setSort(s =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const filtered = uMemo(() => {
    let xs = combinedRows;
    if (roleFilter !== 'all') xs = xs.filter(u => u.role === roleFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      xs = xs.filter(u =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q));
    }
    xs = xs.slice().sort((a, b) => {
      const va = uSortVal(a, sort.key), vb = uSortVal(b, sort.key);
      if (va < vb) return sort.dir === 'asc' ? -1 : 1;
      if (va > vb) return sort.dir === 'asc' ?  1 : -1;
      return 0;
    });
    return xs;
  }, [combinedRows, query, roleFilter, sort]);

  // KPI
  const roleCounts = uMemo(() => {
    const c = { manager: 0, staff: 0, viewer: 0, owner: 0, presenter: 0 };
    combinedRows.forEach(u => { if (c[u.role] != null) c[u.role]++; });
    return c;
  }, [combinedRows]);

  // บัญชีผู้นำเสนอ (Role ผู้นำเสนอ) ที่เปิดใช้อยู่ + คนที่ติ๊ก 🎤 — ใช้เตือนตอนตั้งผิดแบบ
  //   (ฝั่ง POG 25 พ.ย. 69: สร้างบัญชีเป็น Manager + ติ๊ก 🎤 เข้าใจว่าติ๊กแล้ว = บัญชีผู้นำเสนอ
  //   → ไม่มีบัญชี Role ผู้นำเสนอเลย ทาง "ชื่อตัวเอง + รหัสพิเศษ" จึงใช้ไม่ได้ และบัญชีนั้นเข้าได้เต็มสิทธิ์)
  const presenterInfo = uMemo(() => ({
    name:    uPresenterName(),
    accts:   combinedRows.filter(u => u.role === 'presenter' && uIsActive(u.active)),
    aliases: combinedRows.filter(u => uIsActive(u.active) && uCanPresent(u)),
  }), [combinedRows]);
  const presenterMain = presenterInfo.accts.find(u => String(u.username || '').trim().toLowerCase() === presenterInfo.name);

  // ── Presence: ใครออนไลน์อยู่ (จากตาราง presence — heartbeat ทุก ~5 นาที) ──────
  const agoLabel = (ms) => {
    if (ms == null || ms < 0) return '—';
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'เมื่อสักครู่';
    if (m < 60) return m + ' นาทีที่แล้ว';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ชม.ที่แล้ว';
    return Math.floor(h / 24) + ' วันที่แล้ว';
  };
  const presenceRows = uMemo(() => {
    const arr = (data && data.presence) || [];
    const HB = (window.WTP_CONFIG && window.WTP_CONFIG.PRESENCE_HEARTBEAT_MS) || 300000;
    const onlineWindow = Math.max(HB * 2, 6 * 60 * 1000);   // ออนไลน์ = heartbeat ภายใน max(2×HB, 6 นาที)
    const now = Date.now();
    return arr.map(p => {
      const ls = Number(p.lastSeen) || Date.parse(p.lastSeen) || 0;   // ★ รองรับ lastSeen ที่ sync กลับมาเป็น ISO string ด้วย (ไม่งั้น Number→NaN→0→offline ตลอด)
      return { ...p, lastSeenMs: ls, ageMs: ls ? now - ls : null, online: ls > 0 && (now - ls) <= onlineWindow };
    }).sort((a, b) => (b.lastSeenMs || 0) - (a.lastSeenMs || 0));
  }, [data && data.presence]);
  const onlineCount = presenceRows.filter(p => p.online).length;

  // ── CRUD handlers ──────────────────────────────────────────────────────
  const save = (row0) => {
    const row = { ...row0, pages: uStripPages(row0.pages, row0.role) };
    if (row.role === 'presenter') row.canPresent = '';   // บัญชีผู้นำเสนอเองไม่ต้องมีธง 🎤
    // Validate
    if (!row.username || !row.username.trim()) { toast('กรุณากรอก username'); return; }
    // ★ USE_SUPABASE_AUTH:true → รหัสผ่านอยู่ฝั่ง Supabase Auth (ช่องนี้ไม่ได้ใช้ login แล้ว)
    //   → ห้ามบังคับ ไม่งั้น user ที่สร้างผ่าน auth-setup (ไม่มีรหัสในตาราง) จะแก้สิทธิ์ไม่ได้เลย
    if (!authViaSupabase && !row.password) { toast('กรุณากรอก password'); return; }
    if (!row.role) { toast('กรุณาเลือก role'); return; }

    // Prevent duplicate username (unless editing same row)
    const dup = sheetUsers.find(u => u.username === row.username && u.id !== row.id);
    if (dup) { toast(`username "${row.username}" มีอยู่แล้ว`); return; }

    setData(d => ({
      ...d,
      users: row.id
        ? (d.users || []).map(u => u.id === row.id ? { ...row } : u)
        : [{ ...row, id: WTPData.newId(), active: row.active || 'true' }, ...(d.users || [])],
    }));
    setEdit(null);
    toast(row.id ? 'แก้ไขข้อมูลผู้ใช้แล้ว' : 'เพิ่มผู้ใช้ใหม่แล้ว');
  };

  const remove = (id) => {
    if (!confirm('ลบผู้ใช้นี้?\nจะลบจาก Google Sheet ทันที')) return;
    setData(d => ({ ...d, users: (d.users || []).filter(u => u.id !== id) }));
    toast('ลบผู้ใช้แล้ว');
  };

  const togglePw = (id) => setShowPw(prev => ({ ...prev, [id]: !prev[id] }));

  // ── บังคับทุกคนออกจากระบบ ───────────────────────────────────────────────
  // เขียน override `system.forceLogoutBefore` = เวลานี้ → ทุกเครื่องที่รัน "โค้ดใหม่"
  // (มี logic เช็คค่านี้) จะเด้งไปหน้า LOGIN ภายใน ~2 นาที (รวมเครื่องนี้เอง).
  // ★ เครื่องที่ยังเปิดเว็บเวอร์ชันเก่าค้างไว้ ต้องรีเฟรชหน้าก่อนถึงจะรับคำสั่งนี้
  //   (โค้ดเก่าไม่มี logic ตัวนี้ — สั่งทางไกลไม่ได้จนกว่าจะ reload).
  const kickAll = () => {
    if (!confirm(
      'บังคับทุกคนออกจากระบบ?\n\n' +
      '• ทุกเครื่องที่กำลังใช้งาน (รวมเครื่องนี้) จะถูกเด้งไปหน้า LOGIN ภายใน ~2 นาที\n' +
      '• เครื่องที่เปิดเว็บเวอร์ชันเก่าค้างไว้ ต้อง "รีเฟรชหน้า" ก่อน ถึงจะถูกเด้ง\n\n' +
      'ยืนยัน?')) return;
    try {
      WTPOverride.set('system.forceLogoutBefore', Date.now());
      toast('ส่งคำสั่งแล้ว — ทุกเครื่องจะเด้งไปหน้า LOGIN ภายใน ~2 นาที');
    } catch (e) {
      toast('สั่งไม่สำเร็จ: ' + ((e && e.message) || e));
    }
  };

  // ── นำเข้าผู้ใช้จาก config.js เข้าชีต ────────────────────────────────────
  // config users เป็น bootstrap (hardcode) แก้ใน UI ไม่ได้ + ถ้า cache โดนล้าง
  // login ต้องพึ่ง config เท่านั้น. นำเข้าชีตแล้ว → เห็น/แก้ได้ในชีต + login มั่นคงขึ้น.
  // ⚠️ ต้องดึง "รายชื่อจากชีตสด" มารวมก่อนเสมอ — ถ้าใช้แค่ data.users (cache อาจไม่ครบ)
  //    การ setData ทับจะทำให้ sync "ลบ" user ที่อยู่ในชีตแต่ไม่อยู่ใน cache ทิ้ง (เคยทำ baikao/opo หาย).
  const importConfigUsers = () => {
    const cfgUsers = (window.WTP_CONFIG && window.WTP_CONFIG.USERS) || [];
    const norm = (n) => String(n || '').trim().toLowerCase();
    const doImport = (liveUsers) => {
      // base = union ของ (ชีตสด + cache ปัจจุบัน) ตาม username — กันลบ user ที่ยังไม่ sync
      const byName = {};
      (liveUsers || []).concat(data.users || []).forEach(u => { const k = norm(u.username); if (k && !byName[k]) byName[k] = u; });
      const base = Object.keys(byName).map(k => byName[k]);
      const have = new Set(Object.keys(byName));
      const toAdd = cfgUsers.filter(u => !have.has(norm(u.username)));
      // เขียน base (ที่รวมชีตสดแล้ว) กลับเสมอ — กัน cache ไม่ครบไปลบของในชีต
      if (!toAdd.length) { setData(d => ({ ...d, users: base })); toast('ผู้ใช้จาก config.js อยู่ในชีตครบแล้ว (' + base.length + ' คนในชีต)'); return; }
      if (!confirm(
        'นำเข้าผู้ใช้จาก config.js เข้าชีต ' + toAdd.length + ' คน?\n\n' +
        toAdd.map(u => '• ' + u.username + ' (' + (u.role || 'staff') + ')').join('\n') + '\n\n' +
        'รหัสผ่านจะถูกบันทึกลงชีต users (sync ทั้งทีม)')) return;
      const rows = toAdd.map(u => ({
        id: WTPData.newId(), username: u.username, password: u.password,
        displayName: u.displayName || u.username, role: u.role || 'staff',
        active: 'true', department: '', note: 'นำเข้าจาก config.js',
      }));
      setData(d => ({ ...d, users: [...rows, ...base] }));
      toast('นำเข้า ' + toAdd.length + ' คนเข้าชีตแล้ว — กำลัง sync');
    };
    if (window.WTPData && WTPData.fetchSheetRows) {
      toast('กำลังดึงรายชื่อจากชีต…');
      WTPData.fetchSheetRows('users').then(rows => doImport(Array.isArray(rows) ? rows : [])).catch(() => doImport([]));
    } else { doImport([]); }
  };

  const emptyUser = { username: '', password: '', displayName: '', role: 'staff', active: 'true', department: '', note: '', pages: '' };

  return (
    <div className="page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">จัดการผู้ใช้ระบบ · Users</h1>
          <div className="page-sub">
            ผู้ใช้ทั้งหมด {combinedRows.length} คน · Manager-only · sync กับ Google Sheet ชีต <code>users</code>
          </div>
        </div>
        <div className="page-head-r">
          <ExportButton
            rows={filtered.map(u => ({
              ...u,
              password: '••••••',   // mask passwords on export
              _pages: uParsePages(u.pages).length
                ? uParsePages(u.pages).map(k => (window.WTP_PAGE_LABEL || {})[k] || k).join(', ')
                : 'ตาม Role',
            }))}
            columns={[
              { key: 'username',    label: 'Username' },
              { key: 'displayName', label: 'ชื่อผู้ใช้' },
              { key: 'department',  label: 'หน่วยงาน' },
              { key: 'role',        label: 'Role' },
              { key: '_pages',      label: 'หน้าที่เห็น' },
              { key: 'active',      label: 'สถานะ' },
              { key: 'note',        label: 'หมายเหตุ' },
            ]}
            filename="users"
            sheetName="ผู้ใช้"
            title="รายชื่อผู้ใช้ระบบ"
          />
          <PrintButton />
          <button className="btn" onClick={kickAll}
            title="บังคับทุกคนออกจากระบบ — ทุกเครื่องเด้งไปหน้า LOGIN ภายใน ~2 นาที"
            style={{ borderColor: 'var(--bad)', color: 'var(--bad)', fontWeight: 600 }}>
            🚪 บังคับออกจากระบบทุกคน
          </button>
          <button className="btn" onClick={importConfigUsers}
            title="คัดลอกผู้ใช้จาก config.js (ที่ยังไม่มีในชีต) เข้าชีต users — พร้อมรหัสผ่าน">
            ⬇️ นำเข้า config เข้าชีต
          </button>
          <button className="btn btn-primary" onClick={() => setEdit({ ...emptyUser })}>
            <Icon name="plus" size={14} /> เพิ่มผู้ใช้
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-4 anim-stagger" style={{ marginBottom: 16 }}>
        <KpiTile animate={false} label="Manager (หัวหน้า)"   value={roleCounts.manager} accent="var(--good)"             icon="settings" unit=" คน" digits={0} />
        <KpiTile animate={false} label="Staff (พนักงาน)"      value={roleCounts.staff}   accent="var(--brand-500)"        icon="receivables" unit=" คน" digits={0} />
        <KpiTile animate={false} label="Owner (เจ้าของ)"      value={roleCounts.owner}   accent="oklch(60% 0.18 295)"     icon="bank" unit=" คน" digits={0} />
        <KpiTile animate={false} label="Viewer (ผู้บริหารดู)" value={roleCounts.viewer}  accent="var(--ink-400)"          icon="daily" unit=" คน" digits={0} />
      </div>

      {/* ติ๊ก 🎤 ให้คนแล้ว แต่ยังไม่มีแถวบัญชีผู้นำเสนอ (ชื่อ = PRESENTER_USERNAME) → ติ๊กไปก็ใช้ไม่ได้ */}
      {presenterInfo.aliases.length > 0 && !presenterMain && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, background: '#fffbeb', border: '1px solid #fcd34d',
                                       fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 260, lineHeight: 1.6 }}>
            ⚠️ <b>ยังไม่มีบัญชีผู้นำเสนอ</b> — คนที่ติ๊ก 🎤 ไว้ ({presenterInfo.aliases.map(u => u.username).join(', ')}) จึงยังเข้าบัญชีผู้นำเสนอไม่ได้ ·
            ต้องมีบัญชีชื่อผู้ใช้ <code>{presenterInfo.name}</code> ที่เป็น Role <b>"ผู้นำเสนอ"</b> ทั้งในตารางนี้และใน
            <code> tools/supabase-auth-setup.html</code> (รหัสผ่านของบัญชีนั้น = รหัสพิเศษ)
          </span>
          <button className="btn btn-sm" style={{ flex: 'none' }}
            onClick={() => setEdit({ ...emptyUser, username: presenterInfo.name, displayName: 'ผู้นำเสนอ', role: 'presenter' })}>＋ สร้างบัญชีผู้นำเสนอ</button>
        </div>
      )}

      {/* Presence: ใครออนไลน์อยู่ */}
      <div className="card anim-in" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: presenceRows.length ? 10 : 0, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontWeight: 700 }}>
            🟢 กำลังออนไลน์ <span className="muted" style={{ fontWeight: 400 }}>({onlineCount} คน)</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>heartbeat ทุก ~5 นาที · ไม่บันทึกใน audit log</div>
        </div>
        {presenceRows.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            ยังไม่มีข้อมูล — ต้อง redeploy Apps Script (เพิ่มตาราง <code>presence</code>) ก่อน แล้วผู้ใช้จะทยอยขึ้นมาเอง ·
            ผู้บริหารที่เป็น read-only (viewer/owner) ก็จะแสดงด้วย
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {presenceRows.map(p => (
              <div key={p.id} title={`เห็นล่าสุด: ${agoLabel(p.ageMs)}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999,
                         background: 'var(--ink-100)', border: '1px solid var(--ink-200)', opacity: p.online ? 1 : 0.45 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, flex: 'none',
                               background: p.online ? 'var(--good)' : 'var(--ink-300)' }} />
                <span style={{ fontWeight: 600 }}>{p.displayName || p.username}</span>
                <span className="muted" style={{ fontSize: 11 }}>
                  {ROLE_LABELS[p.role] ? ROLE_LABELS[p.role].label : (p.role || '')}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>· {agoLabel(p.ageMs)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: 10, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="tabnav" style={{ flex: 'none' }}>
          <button className={roleFilter === 'all' ? 'active' : ''} onClick={() => setRoleFilter('all')}>ทั้งหมด ({combinedRows.length})</button>
          {Object.entries(ROLE_LABELS).map(([key, meta]) => (
            <button key={key} className={roleFilter === key ? 'active' : ''} onClick={() => setRoleFilter(key)}>
              {meta.label} ({roleCounts[key] || 0})
            </button>
          ))}
        </div>
        <input className="input"
          placeholder="ค้นหา username / ชื่อ…"
          value={query} onChange={e => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200, maxWidth: 320 }} />
      </div>

      {/* Table */}
      <div className="card anim-in" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'min(560px, calc(100vh - 400px))' }}>
          <table className="tbl" style={{ minWidth: 980 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)' }}>
              <tr>
                {[
                  { k: 'username',    label: 'Username',  w: 140 },
                  { k: 'displayName', label: 'ชื่อผู้ใช้' },
                  { k: 'department',  label: 'หน่วยงาน',  w: 150 },
                  { k: 'role',        label: 'Role',      w: 130 },
                  { k: null,          label: 'หน้าที่เห็น', w: 150 },
                  { k: null,          label: 'Password',  w: 180 },
                  { k: '_source',     label: 'แหล่ง',     w: 90 },
                  { k: null,          label: '',          w: 110 },
                ].map((c, ci) => (
                  <th key={ci}
                      onClick={() => c.k && toggleSort(c.k)}
                      style={{ width: c.w, cursor: c.k ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap', verticalAlign: 'middle' }}
                      title={c.k ? 'คลิกเพื่อเรียงลำดับ' : undefined}>
                    {c.label}
                    {c.k && <span style={{ marginLeft: 4, color: sort.key === c.k ? 'var(--brand-600)' : 'var(--ink-300)', fontSize: 10 }}>{sort.key === c.k ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 36, textAlign: 'center' }} className="muted">ไม่พบผู้ใช้ที่ตรงกับเงื่อนไข</td></tr>
              )}
              {filtered.map(u => {
                const meta = ROLE_LABELS[u.role] || { label: u.role || '—', color: 'b-gray' };
                const isConfig = u._source === 'config';
                return (
                  <tr key={u.id} style={{ opacity: isConfig ? 0.7 : 1, verticalAlign: 'middle' }}>
                    <td style={{ fontFamily: 'ui-monospace', fontWeight: 600, color: 'var(--brand-700)' }}>
                      {u.username}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{u.displayName || '—'}</div>
                      {u.note && <div className="muted" style={{ fontSize: 11 }}>{u.note}</div>}
                    </td>
                    <td style={{ fontSize: 12.5, color: 'var(--ink-700)' }}>
                      {u.department ? u.department : <span className="muted">—</span>}
                    </td>
                    <td>
                      <Badge kind={meta.color} dot={false}>{meta.label}</Badge>
                      {uCanPresent(u) && (
                        <span title="พิมพ์ชื่อผู้ใช้ของตัวเอง + รหัสของบัญชีผู้นำเสนอ → เข้าบัญชีผู้นำเสนอ"
                          style={{ marginLeft: 4, fontSize: 11, whiteSpace: 'nowrap' }}>🎤</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {(() => {
                        const picked = uParsePages(u.pages);
                        if (!picked.length) {
                          return <span className="muted" title={'ตามสิทธิ์ Role — ' + (meta.desc || '')}>ตาม Role · {uRolePages(u.role).length} หน้า</span>;
                        }
                        const names = picked.map(k => (window.WTP_PAGE_LABEL || {})[k] || k);
                        return (
                          <span title={names.join('\n')} style={{ color: 'var(--brand-700)', fontWeight: 600, cursor: 'help' }}>
                            เลือกเอง · {picked.length} หน้า
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ fontFamily: 'ui-monospace', fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ flex: 1, color: 'var(--ink-600)', letterSpacing: showPw[u.id] ? 0 : 2 }}>
                          {showPw[u.id] ? (u.password || '—') : (u.password ? '••••••••' : '—')}
                        </span>
                        <button onClick={() => togglePw(u.id)} className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: 11 }}>
                          {showPw[u.id] ? 'ซ่อน' : 'แสดง'}
                        </button>
                      </div>
                    </td>
                    <td>
                      {u._source === 'config' && <Badge kind="b-amber" dot={false}>config.js</Badge>}
                      {u._source === 'sheet'  && <Badge kind="b-green" dot={false}>Sheet</Badge>}
                      {u._source === 'both' && (
                        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                          <Badge kind="b-green" dot={false}>Sheet</Badge>
                          <Badge kind="b-amber" dot={false} title="มี bootstrap fallback ใน config.js — login ได้ทันทีก่อน sync">config.js</Badge>
                        </span>
                      )}
                    </td>
                    <td>
                      {isConfig ? (
                        <span className="muted" style={{ fontSize: 11 }}>แก้ไม่ได้</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }}
                                  onClick={() => setEdit({ ...u })}>แก้ไข</button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', color: 'var(--bad)' }}
                                  onClick={() => remove(u.id)}>ลบ</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info box about config.js users */}
      <div className="card" style={{ marginTop: 14, padding: 14, background: '#fffbeb', borderLeft: '4px solid #f6ad55', fontSize: 12, color: 'var(--ink-700)' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>💡 หมายเหตุ</div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li><b>หน้าที่เห็น</b> — ค่าเริ่มต้นคือ "ตาม Role"; กด <b>แก้ไข</b> → <b>เลือกเอง</b> เพื่อติ๊กเป็นรายหน้าให้คนนั้นโดยเฉพาะ ·
              ผู้ใช้ที่เปิดเว็บค้างอยู่จะเห็นผลภายใน ~2 นาที (รอบ sync) ไม่ต้อง logout</li>
          <li><b>Role ยังคุมสิทธิ์แก้ไขเสมอ</b> — การติ๊กเปิดหน้าให้ Viewer/Owner จะได้แค่ "เห็น" ไม่ได้สิทธิ์แก้
              (ฝั่งฐานข้อมูลกันด้วย RLS ตาม role อีกชั้น) · หน้ากลุ่ม <b>ระบบ</b> เปิดให้เฉพาะ Manager</li>
          <li><b>🎤 ผู้นำเสนอ</b> = บัญชีกลางสำหรับพรีเซนต์ เห็นแค่ 3 งบการเงิน ดูอย่างเดียว · ตั้ง 2 ขั้น:
              ① สร้างบัญชีชื่อผู้ใช้ <code>{presenterInfo.name}</code> Role <b>"ผู้นำเสนอ"</b> ที่นี่ และใน <code>tools/supabase-auth-setup.html</code>
              (role = presenter · รหัสผ่านของบัญชีนี้ = รหัสพิเศษ) ② ติ๊ก "เข้าบัญชีผู้นำเสนอได้" ให้คนที่จะพรีเซนต์ (มี 🎤 ข้าง Role)
              → คนนั้นพิมพ์ชื่อผู้ใช้ของตัวเอง + รหัสพิเศษ แล้วเข้าบัญชีผู้นำเสนอได้เลย · การติ๊ก 🎤 ไม่ได้เปลี่ยนสิทธิ์ของบัญชีตัวเอง</li>
          <li>ผู้ใช้ที่อยู่ใน <code>config.js</code> (สีส้ม) แก้ใน UI ไม่ได้ — ใช้เป็น bootstrap account สำหรับ first-time login
              (ตั้งสิทธิ์รายหน้าไม่ได้ ต้องนำเข้าชีตก่อน)</li>
          <li>ผู้ใช้ใน Sheet (สีเขียว) สามารถแก้/ลบได้ที่นี่</li>
          <li>ผู้ใช้ที่มี <b>Sheet + config.js</b> (เขียว+ส้ม) = login ได้แน่นอนทุกเครื่องแม้ Sheet ยังไม่ sync</li>
          <li>การเปลี่ยน password ต้องให้ user logout แล้ว login ใหม่จึง active</li>
          <li>เพื่อความปลอดภัย: Sheet `users` ตั้ง access เป็น Restricted (ไม่ public)</li>
        </ul>
      </div>

      {/* Edit modal */}
      {edit !== null && (
        <UserEditModal
          row={edit}
          presenterInfo={presenterInfo}
          onSave={save}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

// ─── ตัวเลือก "หน้าที่เข้าถึงได้" รายคน ─────────────────────────────────────
//  2 โหมด: "ตาม Role" (pages ว่าง — ค่าเริ่มต้นเดิม) · "เลือกเอง" (ติ๊กทีละหน้า)
//  ⚠️ หน้ากลุ่ม "ระบบ" (Users/Audit/Backup) เลือกให้ role ที่ไม่ใช่ manager ไม่ได้ —
//     WTPAuth.canViewPage บล็อกไว้เป็นพื้นบังคับ ต่อให้ติ๊กมาก็ไม่เปิด
function UserPagePicker({ role, value, onChange }) {
  const isManager = role === 'manager';
  const groups  = uPageGroups().filter(g => !g.managerOnly || isManager);
  const allKeys = uMemo(() => groups.reduce((a, g) => a.concat(g.items.map(it => it[0])), []), [isManager]);
  const sel     = uMemo(() => new Set(uParsePages(value)), [value]);
  const custom  = sel.size > 0;

  // เขียนกลับเป็น CSV เรียงตามลำดับในเมนูเสมอ (อ่านง่าย + ไม่ขึ้นกับลำดับที่กดติ๊ก)
  const emit = (next) => onChange(allKeys.filter(k => next.has(k)).join(','));
  const toggle = (k) => { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); emit(n); };
  const setGroup = (g, on) => {
    const n = new Set(sel);
    g.items.forEach(([k]) => on ? n.add(k) : n.delete(k));
    emit(n);
  };

  const chip = (label, onClick, active) => (
    <button type="button" onClick={onClick}
      style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
               border: '1px solid ' + (active ? 'var(--brand-500)' : 'var(--ink-200)'),
               background: active ? 'var(--brand-50)' : 'var(--surface)',
               color: active ? 'var(--brand-700)' : 'var(--ink-600)',
               fontWeight: active ? 600 : 400 }}>{label}</button>
  );

  return (
    <div>
      {/* โหมด */}
      <div style={{ display: 'flex', gap: 8, marginBottom: custom ? 10 : 0, flexWrap: 'wrap' }}>
        {chip('ตาม Role (ค่าเริ่มต้น)', () => onChange(''), !custom)}
        {/* เปลี่ยนมา "เลือกเอง" → ตั้งต้นด้วยหน้าที่ role นี้เห็นอยู่แล้ว จะได้ตัดออกทีละหน้าได้เลย */}
        {chip('เลือกเอง', () => onChange(uRolePages(role).join(',')), custom)}
        <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
          {custom
            ? `เลือกไว้ ${sel.size} หน้า จาก ${allKeys.length} หน้า`
            : `เห็น ${uRolePages(role).length} หน้า ตามสิทธิ์ของ Role นี้`}
        </span>
      </div>

      {!custom ? (
        <div className="muted" style={{ fontSize: 11.5 }}>
          ใช้หน้าที่มากับ Role — {(ROLE_LABELS[role] || {}).desc || ''}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--ink-200)', borderRadius: 10, padding: 10,
                      maxHeight: 260, overflowY: 'auto', background: 'var(--ink-50)' }}>
          {groups.map(g => {
            const keys = g.items.map(it => it[0]);
            const on   = keys.filter(k => sel.has(k)).length;
            return (
              <div key={g.key} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-500)', letterSpacing: 0.3 }}>
                    {g.label} <span className="muted" style={{ fontWeight: 400 }}>({on}/{keys.length})</span>
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '1px 7px', fontSize: 10.5 }}
                    onClick={() => setGroup(g, on < keys.length)}>
                    {on < keys.length ? 'เลือกทั้งกลุ่ม' : 'ล้างทั้งกลุ่ม'}
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 2 }}>
                  {g.items.map(([k, label]) => (
                    <label key={k} title={k}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                               padding: '4px 6px', borderRadius: 6, fontSize: 12.5,
                               background: sel.has(k) ? 'var(--brand-50)' : 'transparent' }}>
                      <input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} style={{ cursor: 'pointer' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {!isManager && (
            <div className="muted" style={{ fontSize: 11, borderTop: '1px solid var(--ink-200)', paddingTop: 7 }}>
              หน้ากลุ่ม <b>ระบบ</b> (จัดการผู้ใช้ · Audit Log · สำรองข้อมูล) เปิดให้เฉพาะ Role = Manager เท่านั้น
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Edit/Add modal ───────────────────────────────────────────────────────
function UserEditModal({ row, presenterInfo, onSave, onClose }) {
  const [draft, setDraft] = uState(null);
  const [showPw, setShowPw] = uState(false);
  const authViaSupabase = !!(window.WTP_CONFIG && window.WTP_CONFIG.USE_SUPABASE_AUTH);

  uEffect(() => { setDraft(row ? { ...row } : null); }, [row]);
  if (!row || !draft) return null;

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  // บัญชีผู้นำเสนอ "อื่น" ที่มีอยู่ (ไม่นับแถวที่กำลังแก้) + คนที่ติ๊ก 🎤 — ใช้ในกล่องผู้นำเสนอด้านล่าง
  const pInfo = presenterInfo || { name: uPresenterName(), accts: [], aliases: [] };
  const otherMain = pInfo.accts.some(u => String(u.id) !== String(row.id) &&
    String(u.username || '').trim().toLowerCase() === pInfo.name);
  const aliasNames = pInfo.aliases.filter(u => String(u.id) !== String(row.id)).map(u => u.username);
  const roleLabel = (ROLE_LABELS[draft.role] || {}).label || draft.role;
  const draftName = String(draft.username || '').trim().toLowerCase();

  return (
    <Modal open={!!row} title={row.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}
      maxWidth={560} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={() => onSave(draft)}>
          <Icon name="check" size={14} /> บันทึก
        </button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Username *</label>
          <input className="input" autoFocus value={draft.username || ''}
            onChange={e => set('username', e.target.value.trim().toLowerCase())}
            placeholder="เช่น finance3" disabled={!!row.id}
            style={row.id ? { background: 'var(--ink-50)', color: 'var(--ink-500)' } : {}} />
          {row.id && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>username แก้ไม่ได้</div>}
        </div>
        <div className="field">
          <label>Role *</label>
          <select className="select input" value={draft.role || 'staff'}
            onChange={e => set('role', e.target.value)}>
            {Object.entries(ROLE_LABELS).map(([k, m]) => (
              <option key={k} value={k}>{m.label} — {m.desc}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>ชื่อ-นามสกุล (Display Name)</label>
          <input className="input" value={draft.displayName || ''}
            onChange={e => set('displayName', e.target.value)}
            placeholder="เช่น สมหญิง การเงิน" />
        </div>
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>Password {authViaSupabase ? '' : '*'}</label>
          <div style={{ position: 'relative' }}>
            <input className="input" type={showPw ? 'text' : 'password'}
              value={draft.password || ''}
              onChange={e => set('password', e.target.value)}
              placeholder={authViaSupabase ? 'ไม่ต้องกรอก — ไม่ได้ใช้ล็อกอิน' : 'อย่างน้อย 6 ตัวอักษร'}
              style={{ paddingRight: 70 }} />
            <button type="button" onClick={() => setShowPw(v => !v)}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                       background: 'transparent', border: 0, color: 'var(--ink-500)', cursor: 'pointer', fontSize: 11 }}>
              {showPw ? 'ซ่อน' : 'แสดง'}
            </button>
          </div>
          {authViaSupabase && (
            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
              ระบบนี้ล็อกอินผ่าน Supabase Auth — รหัสผ่านเก็บฝั่งเซิร์ฟเวอร์ ช่องนี้ไม่มีผลกับการล็อกอิน
              (ตั้ง/เปลี่ยนรหัสที่ <code>tools/supabase-auth-setup.html</code>)
            </div>
          )}
        </div>
        <div className="field">
          <label>สถานะการใช้งาน</label>
          <select className="select input" value={String(draft.active || 'true')}
            onChange={e => set('active', e.target.value)}>
            <option value="true">เปิดใช้งาน</option>
            <option value="false">ปิด (ห้าม login)</option>
          </select>
        </div>
        <div className="field">
          <label>หน่วยงาน (ฝ่ายงาน)</label>
          <select className="select input" value={draft.department || ''}
            onChange={e => set('department', e.target.value)}>
            <option value="">— ไม่ระบุ —</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            {draft.department && DEPARTMENTS.indexOf(draft.department) < 0 &&
              <option value={draft.department}>{draft.department}</option>}
          </select>
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>ฝ่าย "การเงิน" จะเลือกเป็นผู้รับผิดชอบในหน้ากระทบยอดธนาคารได้</div>
        </div>
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>หน้าที่เข้าถึงได้</label>
          <UserPagePicker role={draft.role || 'staff'} value={draft.pages || ''}
            onChange={v => set('pages', v)} />
        </div>
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label>หมายเหตุ</label>
          <input className="input" value={draft.note || ''}
            onChange={e => set('note', e.target.value)}
            placeholder="หมายเหตุเพิ่มเติม" />
        </div>
        <div className="field" style={{ gridColumn: '1/-1' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox"
              checked={String(draft.notifyDailyBalance || 'false') === 'true'}
              onChange={e => set('notifyDailyBalance', e.target.checked ? 'true' : 'false')}
              style={{ cursor: 'pointer' }} />
            🔔 เตือนบันทึกยอดธนาคารรายวัน — user นี้จะเห็น pill เตือนใน sidebar ถ้ายังไม่บันทึก
          </label>
        </div>
      </div>

      {/* ── บัญชีผู้นำเสนอ (2026-11-25 · แบบ Water POG) ───────────────────────── */}
      {draft.role === 'presenter' ? (
        <div style={{ marginTop: 16, padding: 12, background: '#fffbeb', borderRadius: 10, border: '1px solid #fcd34d', fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-700)' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>🎤 บัญชีผู้นำเสนอ</div>
          เห็นแค่ 3 งบการเงิน (งบกระแสเงินสด · งบกำไรขาดทุน · งบแสดงฐานะการเงิน) ดูอย่างเดียว · ล็อกอินแล้วเปิดที่งบกระแสเงินสดทันที<br />
          <b>รหัสผ่านของบัญชีนี้ = รหัสพิเศษ</b> — คนที่ติ๊ก "เข้าบัญชีผู้นำเสนอได้" ไว้ พิมพ์ชื่อผู้ใช้ของตัวเอง + รหัสนี้ แล้วระบบพาเข้าบัญชีนี้ให้<br />
          ต้องสร้างบัญชีนี้ใน <code>tools/supabase-auth-setup.html</code> ด้วย (role = <b>presenter</b>) — ตั้งรหัสพิเศษที่นั่น · Role ในตารางนี้มีไว้ให้หน้าเว็บรู้จักบัญชีเท่านั้น<br />
          {draftName && draftName !== pInfo.name && (
            <div style={{ marginTop: 4, color: '#b45309' }}>
              ⚠️ ทางเข้าด้วยชื่อตัวเอง + รหัสพิเศษ ใช้กับบัญชีชื่อ <code>{pInfo.name}</code> เท่านั้น (ตั้งไว้ใน config.js) —
              บัญชีชื่ออื่นที่เป็นผู้นำเสนอเข้าได้ด้วยชื่อของตัวเองเท่านั้น
            </div>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            {aliasNames.length
              ? <>ติ๊ก 🎤 ไว้แล้ว: <b>{aliasNames.join(', ')}</b></>
              : 'ยังไม่มีใครถูกติ๊ก 🎤 — ตอนนี้เข้าได้ด้วยชื่อผู้ใช้ของบัญชีนี้ + รหัสนี้เท่านั้น'}
          </span>
        </div>
      ) : (
        <div style={{ marginTop: 16, padding: 12, background: 'var(--ink-50)', borderRadius: 10, border: '1px solid var(--ink-200)', fontSize: 13 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={String(draft.canPresent || '') === 'true'}
              onChange={e => set('canPresent', e.target.checked ? 'true' : '')} style={{ marginTop: 3 }} />
            <span>
              <b>🎤 เข้าบัญชีผู้นำเสนอได้</b>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                พิมพ์ชื่อผู้ใช้ของตัวเอง + รหัสของบัญชีผู้นำเสนอ → เข้าบัญชีผู้นำเสนอ (เห็นแค่ 3 งบการเงิน) · พิมพ์รหัสของตัวเอง = เข้าบัญชีตัวเองตามปกติ
              </span>
            </span>
          </label>
          {/* ติ๊กแล้วบัญชีนี้ไม่ได้กลายเป็นบัญชีผู้นำเสนอ — ฝั่ง POG เคยตั้ง Manager + ติ๊ก แล้วคิดว่าจะเห็นแค่ 3 งบ */}
          {String(draft.canPresent || '') === 'true' && (
            <div style={{ marginTop: 8, marginLeft: 24, fontSize: 12, lineHeight: 1.6, color: 'var(--ink-700)' }}>
              บัญชีนี้ยังเป็น <b>{roleLabel}</b> ตามเดิม — ถ้าจะให้บัญชีนี้เห็นแค่ 3 งบ ให้เปลี่ยน Role เป็น <b>"ผู้นำเสนอ"</b> แทนการติ๊กช่องนี้
              {!otherMain && (
                <div style={{ marginTop: 4, color: '#b45309' }}>
                  ⚠️ ยังไม่มีบัญชีผู้นำเสนอชื่อ <code>{pInfo.name}</code> ในระบบ — ติ๊กไว้ได้ แต่ยังใช้ไม่ได้จนกว่าจะสร้างบัญชีนั้น (Role "ผู้นำเสนอ")
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

Object.assign(window, { UsersPage });
