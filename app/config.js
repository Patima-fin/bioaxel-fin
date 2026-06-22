/* =====================================================================
 * BIOAXEL Financial Dashboard — Configuration
 * =====================================================================
 *  เว็บแยกต่างหากจาก Water POG — ใช้โค้ดชุดเดียวกัน แต่ "ฐานข้อมูล / โดเมน auth /
 *  ทีมผู้ใช้ / โฮสติ้ง" แยกกันคนละชุด ไม่ปนกัน
 *
 *  ★★ ต้องทำก่อนใช้งานครั้งแรก (ดู NEXT-STEPS-BIOAXEL.md ที่ root) ★★
 *   1) สร้าง Supabase project ใหม่ของ BIOAXEL → รัน supabase/schema.sql
 *      + supabase/pnl-budget.sql ใน SQL Editor (ยัง "ไม่ต้อง" รัน rls-phase4.sql)
 *   2) เอา Project URL + anon public key (Project Settings → API) มาวางด้านล่าง
 *   3) login ด้วย admin + รหัสชั่วคราว (USE_SUPABASE_AUTH:false) → ตรวจว่าใช้งานได้
 *   4) ภายหลังค่อยเปิด Supabase Auth + RLS (docs/supabase-phase4-auth-guide.md)
 *      แล้วจึงตั้ง USE_SUPABASE_AUTH:true + ลบ password ออกจาก USERS
 * ===================================================================== */

window.WTP_CONFIG = {
  // ── Backend ───────────────────────────────────────────────────────
  //  'supabase' = Postgres + Realtime (อ่านหลังเขียนเห็นทันที, push, เขียนทีละแถว)
  //  'sheets'   = Google Sheets เดิม (ไม่ใช้กับ BIOAXEL — เริ่มที่ Supabase เลย)
  BACKEND: 'supabase',

  // ── Supabase ของ BIOAXEL ──────────────────────────────────────────
  //  ⚠️ ต้องกรอก 2 ค่านี้จาก Supabase project ใหม่ (Project Settings → API)
  //     SUPABASE_URL      = Project URL (เช่น https://xxxxxxxx.supabase.co)
  //     SUPABASE_ANON_KEY = anon public key (อยู่ฝั่ง client ได้ เหมือน Water POG)
  //  ★ ต้องเป็นคนละ project กับ Water POG (kibxevldnzquwulcyegr) — ข้อมูลแยก 100%
  SUPABASE_URL: 'https://tfcxbcekxwnncdqiqzav.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_HykuAjprU_8d2KrPKV6VrA_MMpTnKnb',

  // Phase 4 — login จับคู่ username → อีเมลภายใน "<username>@<domain>" (อีเมลปลอม ไม่ส่งจริง)
  //   ★ ค่านี้ต้องตรงกันระหว่าง tools/supabase-auth-setup.html กับ login
  AUTH_EMAIL_DOMAIN: 'bioaxel.app',

  // ── รหัสแบรนด์ (ใช้เป็น prefix ชื่อไฟล์ตอนเซฟ PDF ฯลฯ) ────────────────
  //   BIOAXEL = 'BIO'  ·  Water POG = 'WTP'  (ฝั่ง POG ต้องตั้งเป็น 'WTP')
  BRAND_CODE: 'BIO',

  // ── โหมด login ────────────────────────────────────────────────────
  //  false = bootstrap: ตรวจ username/รหัสกับ USERS ด้านล่าง (ต้องปิด RLS อยู่)
  //          → ใช้ตอนตั้งระบบครั้งแรก เพื่อทดสอบว่าเว็บต่อ Supabase ใหม่ได้
  //  true  = production: login ผ่าน Supabase Auth (รหัส hash ฝั่ง server, role จาก
  //          app_metadata) — เปิดหลังสร้าง Auth users + รัน rls-phase4.sql แล้ว
  USE_SUPABASE_AUTH: false,

  // P&L / Budget / Audit Log ย้ายเข้า Supabase แล้ว (Phase 5) → ไม่ใช้ Google Sheet
  //   เว้นว่างได้ทั้งคู่ (ไม่มี entity ไหนวิ่งไป gviz/Apps Script อีก)
  SHEET_ID: '',
  APPS_SCRIPT_URL: '',

  AUTO_REFRESH_MS: 120000,  // 2 นาที
  ROW_LEVEL_SYNC: true,

  // ── ผู้ใช้ระบบ BIOAXEL ─────────────────────────────────────────────
  //  ★ แก้รายชื่อจริงที่นี่. ตอน bootstrap (USE_SUPABASE_AUTH:false) "ทุกคนที่ต้อง
  //    login ต้องมี password" ในนี้. หลังเปิด Supabase Auth ให้ "ลบ password ออก"
  //    แล้วสร้างผู้ใช้+รหัสผ่าน tools/supabase-auth-setup.html แทน (อย่าทิ้งรหัสไว้ใน repo public)
  //  Roles: viewer (ดู) · staff (แก้ได้ ลบไม่ได้) · manager (ทุกอย่าง+users) · owner (ดูอย่างเดียว)
  USERS: [
    { username: 'admin', displayName: 'ผู้ดูแลระบบ', role: 'manager', password: 'bioaxel-setup-2026' },
  ],

  SESSION_TTL_MS: 8 * 60 * 60 * 1000,   // 8 ชั่วโมง
  IDLE_LOGOUT_MS: 30 * 60 * 1000,       // 30 นาที — เด้งออกเมื่อไม่ได้ใช้งาน
  FORCE_LOGOUT_BEFORE: 1781773499469,   // 2026-06-18 — บังคับทุกคน re-login รอบล้างข้อมูล POG ออกจากฐาน (ดู CLAUDE.md)
  PRESENCE_HEARTBEAT_MS: 5 * 60 * 1000, // 5 นาที — "ใครออนไลน์"

  // auto-push เฉพาะตอนผู้ใช้แก้จริง (กันแท็บค้างดันข้อมูลหาย) — ปุ่มบันทึก (forceSyncNow) ข้าม gate นี้เสมอ
  AUTO_PUSH_REQUIRES_ACTIVITY: true,
  AUTO_PUSH_ACTIVITY_WINDOW_MS: 2 * 60 * 1000,
};
