/* =====================================================================
   โน้ตผู้นำเสนอ (✦ บทวิเคราะห์) — หน้างบกระแสเงินสด · งบกำไรขาดทุน · งบแสดงฐานะการเงิน · prefix exn*
   ---------------------------------------------------------------------
   BIOAXEL — ยกจาก exec_notes.js ของ Water POG (2026-11-25 · ต้นทางคือ modules/exec-notes.js ของเว็บ Benya)
   ผู้ใช้ขอ "ทำให้ไบโอด้วย … การใช้งานโหมดนำเสนอ" → ใช้แบบเดียวกับ POG: ทั้ง 3 งบ · บัญชีผู้นำเสนอเห็น · มี "โน้ตของฉัน"
   ★ โผล่เฉพาะบัญชีผู้นำเสนอ (role 'presenter' ใน bio-session — มาจาก JWT ของ Supabase Auth) · บัญชีอื่นไม่เห็นอะไรเลย
   ★ วิธีใช้: คอมพิวเตอร์ = ชี้กรอบค้าง · ไอแพด = แตะกรอบ → กล่องบทวิเคราะห์ (กระจกโปร่ง) ขึ้นข้างกรอบ ไม่บังกรอบ
     (กรอบ = element ที่มี data-exn="<key>") · ปุ่ม ✦ มุมขวาล่าง = เปิด/ปิด + รายชื่อกรอบทั้งหมด
   แต่ละกรอบมี 2 ส่วน:
     1) บทวิเคราะห์ — ร่างใหม่ทุกครั้งจากข้อมูลบนหน้า (ไม่บันทึก) · ข้อสั้น ๆ ไม่ทวนตัวเลขบนจอ
        ตัวเลขแบบพูด (2.7 ล้านบาท) · **เน้นเสียง** = ไฮไลต์ม่วง · !!ต้องระวัง!! = ไฮไลต์แดง
     2) โน้ตของฉัน — พิมพ์เอง (✎) บันทึกลงตาราง Supabase execNotes (id = '<period>|<frameKey>')
        ★ ต้องรัน supabase/exec-notes.sql ครั้งเดียว (สร้างตาราง + RLS: อ่าน=ทุกคนที่ล็อกอิน · เขียน=presenter/staff/manager)
          ยังไม่รัน = บทวิเคราะห์ใช้ได้ แต่บันทึกโน้ตไม่ได้ (ขึ้นข้อความ error ในกล่อง)
   เรียกจาก: #cashflow_present → edRenderDashboard() → window.exnMount(...) · #pnl / #balance_sheet → useEffect
     → window.exnMountFin(which, {...ข้อมูลที่หน้าคิดแล้ว}) · ออกจากหน้า → window.exnUnmount()
   ★ BIO ต่างจาก POG: งบกำไรขาดทุนเขียนตามกล่องของหน้า BIO (Pareto/กราฟรายเดือน/คะแนนสุขภาพ/CFO Insight ·
     ไม่มีงบประมาณ · ต้นทุนขาย ไม่ใช่ต้นทุนงานก่อสร้าง) · ส่วนงบกระแสเงินสด/งบฐานะใช้ชุดเดียวกับ POG
     — ถ้าแก้คำพูดสองส่วนนั้น ให้แก้คู่กับ frontend/app/exec_notes.js ของ waterpog-fin
   =====================================================================*/
(function () {
  /* ── ตัวเชื่อมไปหน้า #cashflow_present (โค้ด ed* อยู่ใน IIFE ของหน้า — ส่งออกผ่าน window.CfpEd) ── */
  const CE = () => window.CfpEd || {};
  function edScopeMonthKeys(data, mf) { return CE().edScopeMonthKeys ? CE().edScopeMonthKeys(data, mf) : []; }
  function edAgg(data, mf, x) { return CE().edAgg(data, mf, x); }
  function edAnomalyData(data, mf, lb) { return CE().edAnomalyData ? CE().edAnomalyData(data, mf, lb) : null; }
  function edIsTransfer(t) { return !!(t && t.isTransfer); }
  function edState() { return CE().edState ? CE().edState() : {}; }
  function edSetTab(t) { if (CE().edSetTab) CE().edSetTab(t); }
  function edScopeLabel(mf) { return CE().edScopeLabel ? CE().edScopeLabel(mf) : String(mf || ''); }
  // ยอดเงินที่ใช้ได้จริง (การ์ด "เงินสดนี้ใช้ได้จริงเท่าไร") — null = ไม่มียอดรายบัญชี → ใช้เงินสดปลายงวดทั้งก้อนแทน
  function edUsableSummary(data, mf) { try { return CE().edUsableSummary ? CE().edUsableSummary(data, mf) : null; } catch (e) { return null; } }
  // เงินที่ใช้คิด "พอจ่ายได้กี่เดือน" = เงินที่ใช้ได้จริง (ถ้าแยกประเภทบัญชีไว้และมีเงินติดเงื่อนไข) ไม่งั้นเงินสดปลายงวดทั้งก้อน
  function exnUsableCash(data, mf, closing) {
    const U = edUsableSummary(data, mf), part = !!(U && U.classified && U.restricted > 0.5);
    return { U, part, cash: part ? Math.max(0, U.usable) : closing };
  }
  function esc(v) { return (v == null ? '' : String(v)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ★ BIO: บัญชีผู้นำเสนอ = role 'presenter' ของ session ปัจจุบัน (bio-session · role มาจาก JWT) */
  function exnIsPresenter() {
    try { const s = JSON.parse(localStorage.getItem('bio-session') || 'null'); return !!s && String(s.role || '').trim().toLowerCase() === 'presenter'; }
    catch (e) { return false; }
  }
  function exnWho() { try { const s = JSON.parse(localStorage.getItem('bio-session') || 'null'); return s ? (s.presentedBy || s.displayName || s.username || '') : ''; } catch (e) { return ''; } }

  /* กรอบตามลำดับบนจอ (key คงที่ — ใช้เป็นกุญแจของโน้ตที่บันทึก ห้ามเปลี่ยนชื่อ) */
  function exnFrameDefs() {
    return [
      { tab: "summary", key: "summary.brief", title: "สรุปภาพรวม (พูดเปิด)" },
      { tab: "summary", key: "summary.overview", title: "ภาพรวมรับ–จ่าย" },
      { tab: "summary", key: "summary.ending", title: "เงินสดปลายงวด" },
      { tab: "summary", key: "summary.acts", title: "กระแสเงินสดแยกตามกิจกรรม" },
      { tab: "summary", key: "summary.monthly", title: "กระแสเงินสดรายเดือน (กราฟ)" },
      { tab: "summary", key: "summary.kpi", title: "KPI ทางการเงิน" },
      { tab: "category", key: "category.top", title: "Top 5 รายรับ / รายจ่าย" },
      { tab: "category", key: "category.anomaly", title: "ค่าใช้จ่ายที่สูงกว่าปกติ" },
      { tab: "banks", key: "banks.accounts", title: "ยอดเงินแยกบัญชี" },
      { tab: "explorer", key: "explorer.note", title: "Transaction Explorer" },
      { tab: "stmt", key: "stmt.trend", title: "งบกระแสเงินสด — รายเดือน" },
      { tab: "stmt", key: "stmt.close", title: "ปิดท้าย: เงินสดเพียงพอถึงเมื่อไหร่" },
    ];
  }
  function exnTabLabel(tab) {
    return ({ summary: "Executive Summary", category: "Category Analysis", banks: "Bank Accounts", explorer: "Transaction Explorer", stmt: "งบกระแสเงินสด" })[tab] || tab;
  }
  /* กรอบของหน้า P&L / งบฐานะ ตามกล่องที่มีจริงบนหน้า (data-exn ติดไว้ใน JSX ของหน้า) */
  function exnFinFrameDefs(which) {
    return which === "pnl" ? [   // ★ BIO: ตามกล่องบนหน้า P&L ของ BIO (ไม่มีงบประมาณ/Sankey · มีคะแนนสุขภาพ + CFO Insight)
      { key: "pnl.brief", title: "สรุปภาพรวม (พูดเปิด)" },
      { key: "pnl.kpi", title: "รายได้ → กำไร(ขาดทุน)สุทธิ" },
      { key: "pnl.breakeven", title: "จุดคุ้มทุน (Break-even)" },
      { key: "pnl.table", title: "งบกำไรขาดทุนรายเดือน" },
      { key: "pnl.revenue", title: "แหล่งรายได้" },
      { key: "pnl.expense", title: "โครงสร้างค่าใช้จ่าย" },
      { key: "pnl.trend", title: "รายได้ · ค่าใช้จ่าย · กำไรสุทธิ รายเดือน" },
      { key: "pnl.health", title: "คะแนนสุขภาพทางการเงิน" },
      { key: "pnl.insight", title: "ปิดท้าย: สรุปและข้อเสนอ (CFO Insight)" },
    ] : [
      { key: "bal.brief", title: "สรุปภาพรวม (พูดเปิด)" },
      { key: "bal.hero", title: "รวมสินทรัพย์ · รวมหนี้สิน · ส่วนของเจ้าของ" },
      { key: "bal.table", title: "งบแสดงฐานะการเงิน" },
      { key: "bal.assets", title: "โครงสร้างสินทรัพย์" },
      { key: "bal.funding", title: "แหล่งเงินทุน (หนี้สิน & ทุน)" },
      { key: "bal.ratios", title: "อัตราส่วนทางการเงิน" },
      { key: "bal.health", title: "คะแนนฐานะการเงินรวม" },
      { key: "bal.insight", title: "วิเคราะห์ฐานะการเงิน" },
    ];
  }

  /* ═════ ร่างคำพูด: หน้างบกระแสเงินสด (ยกจาก Benya exec-notes.js บรรทัด 66–487 · แก้ ★ POG) ═════ */
  /* ---------- ตัวเลข / คำ ---------- */
  function exnB(n){ return Math.round(Math.abs(Number(n)||0)).toLocaleString("en-US") + " บาท"; }   // ตัวเลขเต็มสำหรับพูด (ไม่มีเครื่องหมาย)
  function exnM2(n){
    const v = Math.round((Number(n)||0)*100)/100;
    const s = Math.abs(v).toLocaleString("en-US",{ minimumFractionDigits:2, maximumFractionDigits:2 });
    return v < 0 ? "(" + s + ")" : s;
  }
  function exnM0(n){ return Math.round(Number(n)||0).toLocaleString("en-US"); }
  function exnPct(n){ return (n==null || !isFinite(n)) ? "—" : n.toFixed(1) + "%"; }
  const EXN_MON_FULL = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const EXN_MON_ABBR = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  function exnMonTh(k){ return EXN_MON_ABBR[(+String(k).slice(5))-1] || k; }
  function exnMonFull(k){ return EXN_MON_FULL[(+String(k).slice(5))-1] || k; }
  function exnMonYrFull(k){ return exnMonFull(k) + " " + (+String(k).slice(0,4) + 543); }
  function exnPayee(t){ const s = String(t.note||""); const p = s.split("/").pop().trim(); return (p || s).slice(0,45); }
  function exnStrip(s){ return String(s||"").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
  function exnAnd(arr){ arr = arr.filter(Boolean); if(arr.length <= 1) return arr.join(""); const z = arr[arr.length-1]; return arr.slice(0,-1).join(" ") + " และ" + (/^[A-Za-z0-9]/.test(z) ? " " : "") + z; }
  function exnRec(t){ return exnStrip(t).replace(/\s*\([^)]*[A-Za-z][^)]*\)/g, "").replace(/\s+—\s+ปัจจุบัน\s*/g, " ซึ่งปัจจุบันอยู่ที่ ").replace(/\s+—\s+(?=สัดส่วน)/g, " เนื่องจาก").replace(/\s+—\s+/g, " โดย").replace(/\s*\/\s*/g, " หรือ").replace(/\s*·\s*/g, " และ").replace(/\s*~\s*/g, "ประมาณ ").replace(/\s{2,}/g, " ").trim(); }
  function exnShortName(n){ return String(n||"").replace(/\s*\([^)]*\)\s*$/, "").trim(); }   // ตัดวงเล็บภาษาอังกฤษท้ายชื่อ

  /* ---------- ช่วงเวลา (งบกระแสเงินสด) — ใช้ได้ทุกแบบ: เดือน · ไตรมาส · ปี · ทั้งหมด ---------- */
  function exnRangeName(keys){   // "มกราคมถึงตุลาคม 2569" · "มกราคม 2568 ถึงตุลาคม 2569" · "เดือนตุลาคม 2569"
    if(!keys || !keys.length) return "";
    const a = keys[0], b = keys[keys.length-1];
    if(keys.length === 1) return "เดือน" + exnMonYrFull(a);
    return a.slice(0,4) === b.slice(0,4) ? `${exnMonFull(a)}ถึง${exnMonFull(b)} ${+b.slice(0,4)+543}` : `${exnMonYrFull(a)} ถึง${exnMonYrFull(b)}`;
  }
  /* scope ที่เลือกบนหน้า + ช่วงที่ใช้เปรียบเทียบ
     เดือน → เดือนก่อน · ไตรมาส → จำนวนเดือนเท่ากันก่อนหน้า · ปี → เดือนเดียวกันของปีก่อน · ทั้งหมด → ค่าเฉลี่ยต่อเดือนของปีล่าสุดเทียบปีก่อนหน้า */
  function exnScope(data, mf){
    const all = ((data && data.months) || []).map(m => m.key).sort();
    const keys = edScopeMonthKeys(data, mf);
    if(!keys.length) return null;
    const kind = (!mf || mf === "all") ? "all" : mf.startsWith("year:") ? "year" : mf.startsWith("q:") ? "q" : "month";
    const last = keys[keys.length-1];
    let name, cur = keys, prev = [], cmp = "", avg = false, curLbl = "";
    if(kind === "month"){
      name = "เดือน" + exnMonYrFull(last);
      prev = all.filter(k => k < keys[0]).slice(-1);
      cmp = prev.length ? "เดือน" + exnMonFull(prev[0]) : "";
    } else if(kind === "q"){
      const [, y, q] = mf.split(":");
      name = `ไตรมาส ${q} ปี ${+y+543}` + (keys.length < 3 ? ` ซึ่งมีข้อมูลถึง${"เดือน" + exnMonFull(last)}` : "");
      prev = all.filter(k => k < keys[0]).slice(-keys.length);
      cmp = prev.length === 3 && keys.length === 3 ? "ไตรมาสก่อนหน้า" : (prev.length === 1 ? "เดือน" + exnMonFull(prev[0]) : "ช่วง" + exnRangeName(prev));
    } else if(kind === "year"){
      const y = +mf.slice(5);
      name = `ปี ${y+543}` + (keys.length < 12 ? ` ตั้งแต่${exnMonFull(keys[0])}ถึง${exnMonFull(last)}` : "");
      prev = keys.map(k => (y-1) + k.slice(4)).filter(k => all.includes(k));
      cmp = `ช่วงเดียวกันของปี ${y-1+543}`;
      avg = prev.length !== keys.length;
    } else {
      name = `ตลอด ${keys.length} เดือน ตั้งแต่${exnRangeName(keys)}`;
      const yrs = [...new Set(keys.map(k => k.slice(0,4)))];
      if(yrs.length >= 2){
        const ly = yrs[yrs.length-1], py = yrs[yrs.length-2];
        cur = keys.filter(k => k.startsWith(ly)); prev = keys.filter(k => k.startsWith(py));
        cmp = `ปี ${+py+543}`; curLbl = `ปี ${+ly+543}`; avg = true;
      }
    }
    if(!prev.length){ prev = []; cmp = ""; }
    return { all, keys, kind, name, cur, prev, cmp, avg, curLbl, last, n: keys.length };
  }
  function exnAggKeys(MA, keys){
    const R = { n: keys.length, in:0, out:0, op:{in:0,out:0}, inv:{in:0,out:0}, fin:{in:0,out:0}, opening:null, closing:null };
    keys.forEach((k, i) => {
      const A = MA[k]; if(!A) return;
      R.in += A.totalIn; R.out += A.totalOut;
      R.op.in += A.byAct.operating.in;  R.op.out += A.byAct.operating.out;
      R.inv.in += A.byAct.investing.in; R.inv.out += A.byAct.investing.out;
      R.fin.in += A.byAct.financing.in; R.fin.out += A.byAct.financing.out;
      if(i === 0) R.opening = A.opening;
      R.closing = A.closing;
    });
    return R;
  }
  /* "เพิ่มขึ้น 31.0%" · "เพิ่มขึ้นเป็น 2.2 เท่า" · "ลดลง 12.5%" · "" (เทียบไม่ได้) */
  function exnChg(c, p){
    if(c == null || p == null || !isFinite(c) || !isFinite(p) || p <= 1 || c < 0) return "";
    const r = c / p;
    if(r >= 2) return `เพิ่มขึ้นเป็น ${r.toFixed(1)} เท่า`;
    const pc = (r - 1) * 100;
    if(Math.abs(pc) < 0.5) return "ใกล้เคียงเดิม";
    return `${pc > 0 ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(pc).toFixed(1)}%`;
  }
  const EXN_EMP   = /เงินเดือน|ค่าจ้าง|พนักงาน|salary|wage/i;
  function exnIsPay(k){ return EXN_EMP.test(k) && !/จ้างเหมา/.test(k); }   // ★ POG: "ค่าจ้างเหมาติดตั้ง" = ผู้รับเหมา ไม่ใช่พนักงาน
  const EXN_AD    = /โฆษณา|อินฟลู|ads?\b|advert|influencer/i;
  const EXN_SALES = /^(รายรับเกี่ยวกับช่องทาง|เงินสดรับจากการขาย)/;   // ★ POG: "เงินสดรับจากการขาย…"
  const EXN_INCAT = /^(รายรับ|เงินสดรับ)/;  // ★ POG: หมวดรับของ POG ขึ้นต้น "เงินสดรับ"          // หมวดฝั่งรายรับ (ไม่นับเป็นรายจ่าย)
  function exnCatShort(c){ return String(c||"").replace(/^(รายจ่าย|รายการจ่าย|รายรับ)เกี่ยว(กับ)?\s*/, "").replace(/^เงินสด(รับ|จ่าย)\s*(เกี่ยวกับ|จาก)?\s*-?\s*/, "").trim() || String(c||""); }   // ★ POG: ตัด "เงินสดจ่าย(เกี่ยวกับ)-"
  function exnCatNet(txs, act){
    const g = {};
    for(const t of txs){ if(act && t.activityKey !== act) continue; const x = g[t.category] = g[t.category] || { in:0, out:0 }; x.in += t.in; x.out += t.out; }
    return g;
  }
  function exnPayeeName(t){
    if(t && t.payee) return String(t.payee).trim();   // ★ POG: ชื่อผู้รับ/ผู้จ่ายอยู่คอลัมน์ Vender ของชีต DATA
    const s = String(t.note || ""), i = s.lastIndexOf("/");
    const p = (i >= 0 ? s.slice(i+1) : "").trim();
    return p;
  }
  function exnPayeesOf(txs, side){   // รวมชื่อเดียวกันที่เขียนต่างกัน (คุณ/นาย/เว้นวรรค)
    const g = {};
    for(const t of txs){
      const v = side === "in" ? t.in : t.out; if(!v) continue;
      const raw = exnPayeeName(t); if(!raw) continue;
      const title = /^(คุณ|นาย|นางสาว|นาง)\s*/.test(raw);
      const name = raw.replace(/^(คุณ|นาย|นางสาว|นาง)\s*/, "").trim();
      const key = name.replace(/\s+/g, "");
      const x = g[key] = g[key] || { name: (title ? "คุณ" : "") + name, v:0 };
      x.v += v;
    }
    return Object.values(g).sort((a,b) => b.v - a.v);
  }
  function exnTxDesc(t){ const s = String(t.note || ""), i = s.lastIndexOf("/"); return (i >= 0 ? s.slice(0, i) : s).replace(/\s*(ด\.|เดือน)\s*\d{1,2}[./]\d{2,4}\s*/g, " ").replace(/\s+/g, " ").trim(); }
  function exnDayTh(t, withYear){ const s = String(t.dateISO || ""); if(!/^\d{4}-\d{2}-\d{2}/.test(s)) return ""; return `${+s.slice(8,10)} ${exnMonFull(s.slice(0,4)+"."+s.slice(5,7))}` + (withYear ? ` ${+s.slice(0,4)+543}` : ""); }

  /* ---------- บทวิเคราะห์ (ป๊อปอัพ) ----------
     ★ แนนอ่านตัวเลขบนจอเอง → บทวิเคราะห์ไม่ทวนตัวเลขบนจอ เหลือแต่ ความหมาย · สาเหตุ · เทียบช่วงก่อน · สิ่งที่ต้องทำ
       เป็นข้อสั้น ๆ (array) ข้อละประเด็น
     ★ ตัวเลขเป็นแบบพูด (exnAmt): 2.7 ล้านบาท · 5.7 แสนบาท · 4.5 หมื่นบาท
     ★ **ข้อความ** = ประเด็นที่ต้องเน้นเสียง (ไฮไลต์ม่วง) · !!ข้อความ!! = เรื่องที่ต้องระวัง (ไฮไลต์แดง) — exnFmtSay แปลงเป็น <mark>
     ★ แต่ละกรอบพูดเฉพาะเรื่องในกรอบนั้น (และกรอบที่พูดผ่านมาแล้ว) — ไม่ดึงตัวเลขของหัวข้อถัดไปมาพูดก่อน
       ลำดับบนจอ: พูดเปิด → ภาพรวมรับ–จ่าย → เงินสดปลายงวด → กิจกรรม 3 ประเภท (+ waterfall) → กราฟรายเดือน → KPI
                  → Category → ค่าใช้จ่ายสูงกว่าปกติ → บัญชี → Transaction → งบรายเดือน → ปิดท้าย */
  function exnAmt(n){
    const v = Math.abs(Number(n) || 0);
    const f = (x, u) => { const r = Math.round(x * 10) / 10; return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + " " + u + "บาท"; };
    if(v >= 9.95e5) return f(v / 1e6, "ล้าน");
    if(v >= 9.95e4) return f(v / 1e5, "แสน");
    if(v >= 9.95e3) return f(v / 1e4, "หมื่น");
    if(v >= 1000) return (Math.round(v / 100) * 100).toLocaleString("en-US") + " บาท";
    return Math.round(v).toLocaleString("en-US") + " บาท";
  }
  function exnP(n){ const v = Math.abs(Number(n) || 0); return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + "%"; }
  function exnChgS(c, p){
    if(c == null || p == null || !isFinite(c) || !isFinite(p) || p <= 1 || c < 0) return "";
    const r = c / p;
    if(r >= 2) return `เพิ่มเป็น ${Math.round(r * 10) / 10} เท่า`;
    const pc = (r - 1) * 100;
    if(Math.abs(pc) < 1) return "ใกล้เคียงเดิม";
    return `${pc > 0 ? "เพิ่มขึ้น" : "ลดลง"} ${exnP(pc)}`;
  }
  function exnFmtSay(s){
    const e = (typeof esc === "function" ? esc(s) : String(s));
    return e.replace(/\*\*(.+?)\*\*/g, '<mark class="exn-em">$1</mark>').replace(/!!(.+?)!!/g, '<mark class="exn-rk">$1</mark>');
  }
  function exnPlain(s){ return String(s || "").replace(/\*\*|!!/g, ""); }
  /* ข้อเสนอแนะของหน้า → ไฮไลต์เฉพาะใจความหลัก (ก่อน ซึ่ง/โดย/เพื่อ/เนื่องจาก) · i = ลำดับ (ข้อเสนอแรก / ที่สอง) */
  function exnRecPt(r, i){
    const t = exnRec(r), m = t.match(/^(.+?)(\s(?:ซึ่ง|โดย|เพื่อ|เนื่องจาก).*)$/);
    return (i ? "ข้อเสนอที่สองคือ " : "ข้อเสนอแรกคือ ") + (m ? `**${m[1]}**${m[2]}` : `**${t}**`);
  }
  function exnList(arr){ return exnAnd(arr); }

  /* ★ น้ำเสียง: ภาษานำเสนอ (เริ่มจาก… · เมื่อเทียบกับ… · หมายความว่า… · สรุปคือ…) แต่ละข้อสั้น ไม่ทวนตัวเลขบนจอ */
  const EXN_BUFFER_MONTHS = 3;     // เดือนสำรองที่ใช้คิด "ต้องจัดหาเงินเพิ่ม" — สมมติ (ผู้บริหารยังไม่ได้กำหนด)
  function exnDrafts(data, mf){
    const S = exnScope(data, mf); if(!S) return null;
    const MA = {}; S.all.forEach(k => { MA[k] = edAgg(data, k, true); });
    const A = edAgg(data, mf, true);
    const net = x => (x ? x.in - x.out : 0);
    const n = S.n, multiYr = S.kind === "all" || new Set(S.keys.map(k => k.slice(0,4))).size > 1;
    const txAll = (data.transactions || []).filter(t => !edIsTransfer(t));
    const txOf = ks => { const s = new Set(ks); return txAll.filter(t => s.has(String(t.month))); };
    const TX = txOf(S.keys);
    const P  = S.prev.length ? exnAggKeys(MA, S.prev) : null;
    const CU = exnAggKeys(MA, S.avg ? S.cur : S.keys);
    const pv = g => P ? { c: S.avg ? g(CU)/CU.n : g(CU), p: S.avg ? g(P)/P.n : g(P) } : null;
    const ch = g => { const x = pv(g); return x ? exnChgS(x.c, x.p) : ""; };
    const cmpS = S.kind === "year" ? "ช่วงเดียวกันปีก่อน" : S.kind === "month" ? "เดือนก่อน" : S.kind === "q" ? (S.prev.length === 3 && S.keys.length === 3 ? "ไตรมาสก่อน" : S.cmp) : S.cmp;
    const vs = !P ? "" : (S.kind === "all" ? `เมื่อเทียบค่าเฉลี่ยต่อเดือน${S.curLbl}กับ${S.cmp}` : `เมื่อเทียบกับ${cmpS}`);
    const perM = S.avg ? "ต่อเดือน" : "";
    const sh = exnCatShort;
    const mon = k => exnMonFull(k) + (multiYr ? " " + (+k.slice(0,4) + 543) : "");
    const opIn = A.byAct.operating.in, opOut = A.byAct.operating.out;
    const op = opIn - opOut, inv = net(A.byAct.investing), fin = net(A.byAct.financing), finIn = A.byAct.financing.in;
    const F = {};

    const drivers = (() => {
      if(!P) return [];
      const a = exnCatNet(txOf(S.avg ? S.cur : S.keys), "operating"), b = exnCatNet(txOf(S.prev), "operating");
      const fa = S.avg ? 1/CU.n : 1, fb = S.avg ? 1/P.n : 1;
      return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !EXN_INCAT.test(k))
        .map(k => { const ca = a[k] ? (a[k].out - a[k].in)*fa : 0, cb = b[k] ? (b[k].out - b[k].in)*fb : 0; return { k, c:ca, p:cb, d: ca - cb }; })
        .filter(x => Math.abs(x.d) >= 5000).sort((x,y) => y.d - x.d);
    })();
    const up = drivers.filter(x => x.d > 0);

    /* 1) พูดเปิด */
    F["summary.brief"] = { say: [
      `${S.kind === "all" ? "" : "สำหรับ"}${S.name} ภาพรวมเงินสดของบริษัท${A.closing >= A.opening ? "เพิ่มขึ้น" : "ลดลง"} เนื่องจาก${A.net < 0 ? "เงินจ่ายสูงกว่าเงินรับ" : "เงินรับสูงกว่าเงินจ่าย"}`,
      op < 0 && finIn > 0 ? "ประเด็นหลักที่อยากให้เห็นวันนี้คือ **การดำเนินงานยังใช้เงินมากกว่าที่หาได้** และ!!บริษัทยังใช้เงินกู้เป็นแหล่งเงินหลัก!!"
        : op < 0 ? "ประเด็นหลักที่อยากให้เห็นวันนี้คือ **การดำเนินงานยังใช้เงินมากกว่าที่หาได้** เงินสดจึงลดลง"
        : "ประเด็นหลักที่อยากให้เห็นวันนี้คือ **การดำเนินงานสร้างเงินสดได้เอง**",
    ] };

    /* 2) ภาพรวมรับ–จ่าย — พูดได้แค่ เงินรับรวม · เงินจ่ายรวม · กระแสเงินสดสุทธิ */
    {
      const s = [];
      const a = ch(x => x.in), b = ch(x => x.out), pi = pv(x => x.in), po = pv(x => x.out);
      if(a && b){
        const gi = pi.c/pi.p, go = po.c/po.p;
        s.push(`${vs} เงินรับ${a} ขณะที่เงินจ่าย${b}` + (gi < 1 && go > 1 ? " สรุปคือ !!เงินรับลดลงแต่เงินจ่ายเพิ่มขึ้น!!" : go - gi > 0.05 ? " หมายความว่า !!เงินจ่ายโตเร็วกว่าเงินรับ!!" : gi - go > 0.05 ? " หมายความว่า **เงินรับโตเร็วกว่าเงินจ่าย**" : ""));
      }
      if(A.totalIn > 0){ const r = Math.round(A.totalOut / A.totalIn * 100); s.push(`ถ้ามองในภาพรวม ทุก 100 บาทที่รับเข้ามา บริษัท${r > 100 ? `!!จ่ายออกไป ${r} บาท!! เงินสดจึงลดลง` : `**จ่ายออกไป ${r} บาท** ยังมีเงินเหลือ`}`); }
      if(finIn > 0) s.push("ทั้งนี้ เงินรับรวมตัวนี้นับรวมทุกแหล่ง **ยังไม่ได้แยกว่ามาจากการขายหรือแหล่งอื่น** ซึ่งจะแยกให้ดูในหัวข้อกิจกรรมถัดไป");
      F["summary.overview"] = { say: s };
    }

    /* 3) เงินสดปลายงวด — ★ (2026-11-25 ผู้ใช้ขอ) คิดจาก "เงินที่ใช้ได้จริง" บอกว่าใช้ได้กี่บาท · ไม่เกิน 3 ข้อ
       (เงินค้ำประกัน/นักลงทุน/บัญชีร่วม หยิบมาจ่ายไม่ได้ → "พอจ่ายได้กี่เดือน" ต้องคิดจากยอดที่ใช้ได้เท่านั้น) */
    {
      const d = A.closing - A.opening, pct = A.opening > 0 ? d / A.opening * 100 : null;
      const UC = exnUsableCash(data, mf, A.closing), U = UC.U, cashUse = UC.cash;
      const avgOut = A.totalOut / n, cover = avgOut > 0 ? cashUse / avgOut : null;
      const s = [];
      if(pct != null && Math.abs(pct) < 1000) s.push(`เมื่อเทียบกับต้นงวด เงินสดปลายงวด${d >= 0 ? "เพิ่มขึ้น" : "ลดลง"} **${exnP(pct)}**`);
      if(UC.part){
        const rs = U.types.filter(t => t.key !== "usable" && t.amount > 0).sort((a,b) => b.amount - a.amount).map(t => t.label.replace(/\s*\(.*\)$/, ""));
        s.push(`แต่ในเงินสด ${exnAmt(U.total)} นี้ **ใช้ได้จริงราว ${exnAmt(U.usable)}** หรือ ${exnP(U.total > 0 ? U.usable / U.total * 100 : 0)}` +
          (rs.length ? ` ที่เหลือเป็น${exnAnd(rs.slice(0, 2))} ซึ่งหยิบมาจ่ายไม่ได้` : ""));
      }
      if(cover != null){
        if(cashUse <= 0) s.push("!!เงินที่ใช้ได้จริงไม่เหลือแล้ว!! รายจ่ายถัดไปต้องรอเงินเข้าใหม่ หรือโอนจากบัญชีอื่น");
        else {
          const t = cover < 1 ? `${Math.max(1, Math.round(cover * 30))} วัน` : `${cover.toFixed(1)} เดือน`;
          s.push(`ถ้าใช้เงินในอัตราเฉลี่ยเท่าที่ผ่านมา ${UC.part ? "เงินที่ใช้ได้จริง" : "เงินสดที่มีอยู่"}` + (cover < 1 ? `!!พอจ่ายได้ราว ${t}!! จึงควรติดตามเงินสดเป็นรายสัปดาห์` : cover < 3 ? `พอจ่ายได้ราว ${t} ซึ่ง!!ถือว่าค่อนข้างตึงตัว!!` : `**พอจ่ายได้ราว ${t}** ถือว่ายังรองรับได้`));
        }
      }
      if(P && S.kind === "year" && P.closing != null){ const dd = A.closing - P.closing; s.push(`และเมื่อเทียบกับสิ้น${exnMonFull(S.prev[S.prev.length-1])}ปีก่อน เงินสดตอนนี้${dd >= 0 ? "**สูงกว่า**" : "!!ต่ำกว่า!!"}ราว ${exnAmt(dd)}`); }
      F["summary.ending"] = { say: s.slice(0, 3) };
    }

    /* 4) กระแสเงินสดแยกตามกิจกรรม (+ waterfall) */
    const finSrc = exnPayeesOf(TX.filter(t => t.activityKey === "financing"), "in").slice(0, 2);
    const invCats = Object.entries(exnCatNet(TX, "investing")).map(([k,v]) => [k, v.out - v.in]).filter(x => x[1] > 0).sort((a,b) => b[1] - a[1]);
    {
      const s = [];
      if(op < 0 && opOut > 0) s.push(`เริ่มจากกิจกรรมดำเนินงาน ทุก 100 บาทที่จ่ายออกไป บริษัท**ได้เงินกลับมาเพียง ${Math.round(opIn / opOut * 100)} บาท**`);
      else if(op >= 0) s.push("เริ่มจากกิจกรรมดำเนินงาน **รับสุทธิเป็นบวก** เงินรับครอบคลุมเงินจ่ายได้ทั้งหมด");
      const a = ch(x => x.op.in), b = ch(x => x.op.out), pn = pv(x => x.op.out - x.op.in);
      if(a && b){
        let t = `${vs} เงินรับจากการดำเนินงาน${a} ขณะที่เงินจ่าย${b}`;
        if(pn && pn.p > 0 && pn.c > 0 && Math.abs(pn.c - pn.p) > pn.p * 0.05) t += ` ทำให้ส่วนที่ขาด${perM}${pn.c < pn.p ? `**ลดลงจาก ${exnAmt(pn.p)} เหลือ ${exnAmt(pn.c)}**` : `!!เพิ่มจาก ${exnAmt(pn.p)} เป็น ${exnAmt(pn.c)}!!`}`;
        s.push(t);
      }
      if(up.length) s.push(`ตัวที่ทำให้เงินจ่ายเพิ่มขึ้นมากที่สุดคือ **${sh(up[0].k)}** เพิ่มขึ้นราว ${exnAmt(up[0].d)}${perM}` + (up[1] ? ` รองลงมาคือ${sh(up[1].k)} ราว ${exnAmt(up[1].d)}${perM}` : ""));
      if(A.byAct.investing.out > A.totalOut * 0.02 && invCats[0]) s.push(`ส่วนกิจกรรมลงทุน ส่วนใหญ่เป็น**${sh(invCats[0][0])}** ราว ${exnAmt(invCats[0][1])}`);
      if(finIn > 0){
        const noLoan = A.closing - fin;
        s.push(`ส่วนที่ขาดทั้งหมดนี้ บริษัท**เติมด้วยเงินกู้**${finSrc.length ? "จาก" + exnAnd(finSrc.map(x => x.name)) : ""} ` + (noLoan < 0 ? `ซึ่งถ้าไม่มีเงินกู้ !!เงินสดปลายงวดจะติดลบราว ${exnAmt(noLoan)}!!` : `ซึ่งถ้าไม่มีเงินกู้ เงินสดปลายงวดจะเหลือเพียง ${exnAmt(noLoan)}`));
      }
      F["summary.acts"] = { say: s };
    }

    /* 5) กราฟกระแสเงินสดรายเดือน */
    {
      const ms = S.kind === "year" ? S.keys : S.all.filter(k => k <= S.last);
      const opM = ms.map(k => net(MA[k].byAct.operating)), finM = ms.map(k => MA[k].byAct.financing.in);
      const pos = ms.filter((k,i) => opM[i] > 0);
      const s = [`จากกราฟรายเดือน กระแสเงินสดจากการดำเนินงาน` + (pos.length === 0 ? "!!ติดลบทุกเดือน!!" : pos.length === ms.length ? "**เป็นบวกทุกเดือน**" : `เป็นบวก**เพียง ${pos.length} จาก ${ms.length} เดือน** คือ${exnAnd(pos.slice(0,4).map(k => exnMonFull(k)))}`)];
      if(ms.length > 1){
        const wI = opM.reduce((b,v,i) => v < opM[b] ? i : b, 0), wk = ms[wI];
        const cw = exnCatNet(txOf([wk]), "operating"), ca = exnCatNet(txOf(ms), "operating");
        const dev = Object.keys(cw).filter(k => !EXN_INCAT.test(k)).map(k => ({ k, d: (cw[k].out - cw[k].in) - ((ca[k] ? ca[k].out - ca[k].in : 0) / ms.length) })).sort((x,y) => y.d - x.d)[0];
        if(opM[wI] < 0) s.push(`เดือนที่หนักที่สุดคือ**${mon(wk)}**` + (dev && dev.d > 5000 ? ` สาเหตุหลักมาจาก${sh(dev.k)} ที่สูงกว่าปกติราว ${exnAmt(dev.d)}` : ""));
      }
      if(ms.length >= 6){
        const r3 = ms.slice(-3), e = ms.slice(0, -3);
        const avgR = -r3.reduce((t,k) => t + net(MA[k].byAct.operating), 0) / 3, avgE = -e.reduce((t,k) => t + net(MA[k].byAct.operating), 0) / e.length;
        if(avgR > 0 && avgE > 0) s.push(`และถ้าดู 3 เดือนล่าสุด ใช้เงินเฉลี่ยเดือนละ ${exnAmt(avgR)} เทียบกับ ${exnAmt(avgE)} ในช่วงก่อนหน้า ` +
          (avgR > avgE * 1.05 ? "แสดงว่า!!แนวโน้มการใช้เงินเพิ่มขึ้น!!" : avgR < avgE * 0.95 ? "แสดงว่า**แนวโน้มดีขึ้น**" : "ถือว่าใกล้เคียงเดิม"));
      }
      const fm = ms.filter((k,i) => finM[i] > 0);
      if(fm.length) s.push(fm.length === ms.length ? "ส่วนเงินกู้ !!มีเข้ามาทุกเดือน!! สะท้อนว่าบริษัทต้องพึ่งเงินกู้อย่างต่อเนื่อง" : `ส่วนเงินกู้ มีเข้ามา ${fm.length} จาก ${ms.length} เดือน` + (fm.length >= ms.length * 0.6 ? " ซึ่ง!!สะท้อนว่าต้องพึ่งเงินกู้ต่อเนื่อง!!" : ""));
      F["summary.monthly"] = { say: s };
    }

    /* 6) KPI ทางการเงิน */
    {
      const sumCat = re => Object.entries(A.byCat || {}).reduce((s,[k,v]) => re.test(k) ? s + v.out : s, 0);
      const emp = Object.entries(A.byCat || {}).reduce((s,[k,v]) => exnIsPay(k) ? s + v.out : s, 0);   // ★ POG: ไม่มี KPI ค่าโฆษณา (ผู้ใช้ตัดออก)
      const K = [
        { n:"ค่าใช้จ่ายต่อยอดขาย", v: opIn ? opOut / opIn * 100 : null, th:80 },
        { n:"ค่าใช้จ่ายพนักงาน", v: opIn ? emp / opIn * 100 : null, th:30 },
      ].filter(x => x.v != null);
      const over = K.filter(x => x.v > x.th).sort((a,b) => b.v / b.th - a.v / a.th);
      const s = [];
      if(over.length) s.push(`ในส่วนตัวชี้วัด มีตัวที่เกินเกณฑ์ ${over.length} ตัว โดยตัวที่เกินมากที่สุดคือ**${over[0].n}** อยู่ที่ ${exnP(over[0].v)} จากเกณฑ์ ${over[0].th}%`);
      else s.push("ในส่วนตัวชี้วัด **ด้านค่าใช้จ่ายอยู่ในเกณฑ์ทั้งหมด**");
      const opEx = K[0] && K[0].n === "ค่าใช้จ่ายต่อยอดขาย" ? K[0].v : null;
      if(opEx != null && opEx > 100){
        let t = `ค่าใช้จ่ายต่อยอดขาย ${exnP(opEx)} หมายความว่า!!บริษัทจ่ายเพื่อดำเนินงานมากกว่ายอดขาย ${(opEx/100).toFixed(1)} เท่า!!`;
        if(P && P.op.in > 0){ const p0 = P.op.out / P.op.in * 100; if(Math.abs(opEx - p0) >= 1) t += opEx < p0 ? ` แต่ก็**ดีขึ้น**จาก ${exnP(p0)} ใน${cmpS}` : ` และ!!แย่ลง!!จาก ${exnP(p0)} ใน${cmpS}`; }
        s.push(t);
      }
      if(opEx != null && opEx > 80) s.push(`ถ้าจะให้กลับเข้าเกณฑ์ 80% บริษัทต้อง**เพิ่มยอดขายเป็นราว ${exnAmt(opOut / 0.8 / n)}ต่อเดือน** หรือ**ลดเงินจ่ายลงราว ${exnAmt((opOut - opIn * 0.8) / n)}ต่อเดือน**`);
      const cash = A.totalIn ? A.net / A.totalIn * 100 : null;
      if(finIn > 0 && cash != null && cash > 0) s.push("ข้อสังเกตคือ !!อัตรากำไรเงินสดที่เป็นบวกมาจากเงินกู้ ไม่ใช่กำไรจากการดำเนินงาน!!");
      F["summary.kpi"] = { say: s };
    }

    /* 7) Category: Top 5 แยกตามกิจกรรม */
    {
      const opNet = exnCatNet(TX, "operating");
      const outs = Object.entries(opNet).map(([k,v]) => [k, v.out - v.in]).filter(x => x[1] > 0 && !EXN_INCAT.test(x[0])).sort((a,b) => b[1] - a[1]);
      const outTot = outs.reduce((t,x) => t + x[1], 0) || 1;
      const sales = Object.entries(opNet).filter(([k]) => EXN_SALES.test(k)).map(([k,v]) => [k, v.in - v.out]).filter(x => x[1] > 0).sort((a,b) => b[1] - a[1]);
      const salesTot = sales.reduce((t,x) => t + x[1], 0);
      const s = [];
      if(outs.length >= 3) s.push(`ในฝั่งรายจ่าย 3 หมวดแรก คือ${exnList(outs.slice(0,3).map(x => sh(x[0])))} รวมกันคิดเป็น**${exnP(outs.slice(0,3).reduce((t,x) => t + x[1], 0) / outTot * 100)} ของรายจ่ายดำเนินงาน**`);
      if(P){
        const pc = exnCatNet(txOf(S.prev), "operating"), cc = S.avg ? exnCatNet(txOf(S.cur), "operating") : opNet;
        const g = outs.slice(0,3).map(([k]) => { const c = cc[k] ? (cc[k].out - cc[k].in) * (S.avg ? 1/CU.n : 1) : 0, p = pc[k] ? (pc[k].out - pc[k].in) * (S.avg ? 1/P.n : 1) : 0; return { k, w: exnChgS(c, p), r: p > 0 ? c / p : 0 }; }).filter(x => x.w && x.w !== "ใกล้เคียงเดิม");
        if(g.length){ const top = g.slice().sort((a,b) => b.r - a.r)[0]; s.push(`${vs} ` + exnList(g.map(x => x === top && x.r > 1.2 ? `!!${sh(x.k)}${x.w}!!` : `${sh(x.k)}${x.w}`))); }
      }
      if(sales.length){ const p = sales[0][1] / Math.max(1, salesTot) * 100; s.push(`ฝั่งรายรับ ยอดขายมาจาก**${sh(sales[0][0])} ถึง ${exnP(p)}**` + (p >= 90 ? " ซึ่ง!!พึ่งช่องทางเดียวเกือบทั้งหมด!!" : "")); }
      if(P){
        const pAll = exnCatNet(txOf(S.prev)), cAll = exnCatNet(TX);
        const fresh = Object.entries(cAll).map(([k,v]) => [k, v.out - v.in]).filter(([k,v]) => v >= Math.max(100000, A.totalOut * 0.03) && !(pAll[k] && pAll[k].out > 0)).sort((a,b) => b[1] - a[1]);
        if(fresh.length) s.push(`และมีรายการใหม่ที่${cmpS}ไม่มี คือ**${exnList(fresh.slice(0,2).map(([k,v]) => `${sh(k)} ราว ${exnAmt(v)}`))}**`);
      }
      F["category.top"] = { say: s };
    }

    /* 8) ค่าใช้จ่ายที่สูงกว่าปกติ (การ์ดตรวจเดือนล่าสุดของช่วงที่เลือก) */
    {
      const an = (typeof edAnomalyData === "function") ? edAnomalyData(data, mf) : null;
      const rows = (an && an.rows) || [];
      if(!an) F["category.anomaly"] = { say: ["ช่วงนี้ยังไม่มีเดือนก่อนหน้าให้เทียบ"] };
      else {
        const tk = an.target;
        const intro = S.kind === "month" ? "เดือนนี้" : `ถ้าดูเดือนล่าสุดคือ${exnMonFull(tk)}`;
        const tTx = txOf([tk]);
        const pay = cat => exnPayeesOf(tTx.filter(t => t.category === cat), "out");
        const dTot = an.curTotal - an.baseAvgTotal;
        if(!rows.length) F["category.anomaly"] = { say: [`${intro} **ไม่มีหมวดที่สูงผิดปกติ** เมื่อเทียบกับค่าเฉลี่ย 6 เดือนก่อนหน้า`] };
        else {
          const r0 = rows[0], p0 = pay(r0.cat)[0], r1 = rows[1];
          const s = [`${intro} หมวดที่สูงผิดปกติที่สุดคือ!!${sh(r0.cat)}!! ซึ่งเกินค่าเฉลี่ยราว ${exnAmt(r0.cur - r0.avg)}` + (p0 ? ` โดยจ่ายให้${p0.name}` : "")];
          s.push(r0.kind === "new" ? "เป็นรายการใหม่ที่ไม่เคยมีใน 6 เดือนก่อน **จึงควรยืนยันว่าเป็นรายการครั้งเดียว**"
            : r0.kind === "irregular" ? `รายการนี้จ่ายเพียง ${r0.seen} จาก ${r0.months} เดือน **จึงอาจเป็นแค่รอบการจ่าย** ไม่ใช่ค่าใช้จ่ายที่เพิ่มขึ้นจริง`
            : "เป็นรายการที่จ่ายทุกเดือน แต่เดือนนี้สูงขึ้น **จึงควรเช็กว่าเป็นการปรับขึ้นถาวรหรือไม่**");
          if(r1) s.push(`รองลงมาคือ${sh(r1.cat)} ซึ่งเกินค่าเฉลี่ยราว ${exnAmt(r1.cur - r1.avg)}`);
          s.push(`ภาพรวมเงินจ่าย${S.kind === "month" ? "เดือนนี้" : "เดือน" + exnMonFull(tk)}จึง${dTot >= 0 ? "!!สูงกว่า!!" : "**ต่ำกว่า**"}ค่าเฉลี่ยราว ${exnAmt(dTot)}`);
          F["category.anomaly"] = { say: s, prompts: rows.slice(0,3).map(r => `เหตุผลที่${sh(r.cat)}สูงขึ้น`) };
        }
      }
    }

    /* 9) ยอดเงินแยกบัญชี */
    {
      const mo = (data.months || []).find(m => m.key === S.last);
      const accts = ((mo && mo.accounts) || []).map(a => { const ac = (data.accounts || {})[a.accountKey] || {}; return { name: ((ac.bank || "") + " " + (ac.no || a.accountKey || "")).trim(), no: String(ac.no || ""), close: Number(a.closing) || 0 }; }).sort((a,b) => b.close - a.close);   // ★ POG: ชื่อบัญชีจาก data.accounts
      const tot = accts.reduce((t,a) => t + Math.max(0, a.close), 0);   // ★ POG: ฐานสัดส่วน = บัญชียอดบวก (บัญชี OD ติดลบทำให้เกิน 100%)
      const flows = Object.values(A.byAcct || {}).sort((a,b) => b.out - a.out);
      const tiny = accts.filter(a => tot > 0 && a.close < tot * 0.01);
      const s = [];
      if(accts.length <= 1) s.push("เงินสดทั้งหมดของบริษัท**อยู่ในบัญชีเดียว** รายการรับและจ่ายทั้งหมดผ่านบัญชีนี้");
      else {
        s.push(`เงินสดส่วนใหญ่ **${exnP(accts[0].close / Math.max(1, tot) * 100)} อยู่ในบัญชี ${accts[0].name}**`);
        if(flows.length && A.totalOut > 0){ const same = String(flows[0].no || "") === accts[0].no; s.push(same ? `และเงินจ่าย ${exnP(flows[0].out / A.totalOut * 100)} ก็ออกจากบัญชีนี้` : `ส่วนเงินจ่าย ${exnP(flows[0].out / A.totalOut * 100)} ออกจากบัญชี ${flows[0].bank} ${flows[0].no}`); }
      }
      if(tiny.length) s.push(`ข้อควรระวังคือ !!อีก ${tiny.length} บัญชีมียอดเหลือน้อย!! ถ้ามีรายการตัดจ่ายจากบัญชีเหล่านี้ ต้องโอนเงินเข้าก่อน`);
      F["banks.accounts"] = { say: s };
    }

    /* 10) Transaction Explorer */
    {
      const big = TX.filter(t => t.out > 0).sort((a,b) => b.out - a.out).slice(0, 3);
      F["explorer.note"] = big.length ? { say: [
        `ในช่วงนี้ รายการจ่ายที่ใหญ่ที่สุด 3 รายการรวมกันคิดเป็น**${exnP(big.reduce((t,x) => t + x.out, 0) / Math.max(1, A.totalOut) * 100)} ของเงินจ่ายทั้งหมด**`,
        `ได้แก่${exnList(big.map(t => `${exnTxDesc(t) || sh(t.category)} ราว ${exnAmt(t.out)}`))}`,
      ] } : { say: [] };
    }

    /* 11) งบกระแสเงินสดรายเดือน */
    {
      const s = [];
      if(n >= 3){
        const per = S.keys.map(k => exnCatNet(txOf([k]), "operating"));
        const cats = [...new Set(per.flatMap(o => Object.keys(o)))].filter(k => !EXN_INCAT.test(k));
        const rows = cats.map(k => { const v = per.map(o => o[k] ? o[k].out - o[k].in : 0); return { k, avg: v.reduce((a,b) => a + b, 0) / n, min: Math.min(...v), max: Math.max(...v) }; });
        const every = rows.filter(x => x.min > 0).sort((a,b) => b.avg - a.avg);
        const fixed = every.reduce((t,x) => t + x.avg, 0), inM = opIn / n;
        if(every.length){
          s.push(`จากงบกระแสเงินสดรายเดือน ค่าใช้จ่ายที่ต้องจ่ายทุกเดือน เช่น ${exnList(every.slice(0,3).map(x => sh(x.k)))} รวมแล้วราว **${exnAmt(fixed)}ต่อเดือน**`);
          s.push(inM < fixed ? `ขณะที่ยอดรับจากการดำเนินงานเฉลี่ยเดือนละ ${exnAmt(inM)} แปลว่า!!ยอดรับยังไม่พอจ่ายแม้แต่ค่าใช้จ่ายประจำ!!` : `ยอดรับจากการดำเนินงานครอบคลุมค่าใช้จ่ายประจำได้ **${exnP(inM / Math.max(1, fixed) * 100)}**`);
        }
        const vol = rows.sort((a,b) => (b.max - b.min) - (a.max - a.min))[0];
        if(vol && vol.max - vol.min > 20000) s.push(`และหมวดที่ต้องวางแผนเป็นพิเศษคือ**${sh(vol.k)}** เพราะผันผวนที่สุด บางเดือนสูงถึง ${exnAmt(vol.max)}`);
      } else if(P){
        const ups = drivers.filter(x => x.d > 0).slice(0, 2), downs = drivers.filter(x => x.d < 0).slice(-2).reverse();
        if(ups.length) s.push(`${vs} หมวดที่จ่ายเพิ่มขึ้นมากที่สุดคือ` + exnList(ups.map((x,i) => i === 0 ? `!!${sh(x.k)} ราว ${exnAmt(x.d)}!!` : `${sh(x.k)} ราว ${exnAmt(x.d)}`)));
        if(downs.length) s.push("ส่วนหมวดที่จ่ายลดลงคือ" + exnList(downs.map(x => `${sh(x.k)} ราว ${exnAmt(x.d)}`)));
      }
      F["stmt.trend"] = { say: s };
    }

    /* 12) ปิดท้าย: เงินสดเพียงพอถึงเมื่อไหร่ (คิด ณ สิ้นช่วงที่เลือก) */
    {
      const l6 = S.all.filter(k => k <= S.last).slice(-6);
      const burn = -l6.reduce((t,k) => t + net(MA[k].byAct.operating) + net(MA[k].byAct.investing), 0) / Math.max(1, l6.length);
      const UC = exnUsableCash(data, mf, A.closing), cash = UC.cash;   // ★ เงินที่ใช้ได้จริง (ผู้ใช้ขอ 2026-11-25)
      const runway = burn > 0 ? cash / burn : null;
      const runTxt = runway == null ? "" : (runway < 1 ? `${Math.max(1, Math.round(runway*4.3))} สัปดาห์` : `${runway.toFixed(1)} เดือน`);
      const runOut = (() => { if(runway == null) return ""; const [y,m] = S.last.split(".").map(Number); const d = new Date(y, m, 0); d.setDate(d.getDate() + Math.round(runway*30.4)); return exnMonYrFull(d.getFullYear() + "." + String(d.getMonth()+1).padStart(2,"0")); })();
      const need = burn > 0 ? Math.max(0, EXN_BUFFER_MONTHS * burn - cash) : 0;
      const s = [];
      if(burn > 0){
        s.push(`สุดท้ายเรื่องความเพียงพอของเงินสด ช่วง 6 เดือนล่าสุด การดำเนินงานรวมการลงทุนใช้เงินเฉลี่ยราว ${exnAmt(burn)}ต่อเดือน`);
        if(cash <= 0) s.push("!!เงินที่ใช้ได้จริงไม่เหลือแล้ว!! รายจ่ายช่วงถัดไปต้องพึ่งเงินเข้าใหม่หรือเงินกู้ทั้งหมด");
        else s.push(`ด้วย${UC.part ? `เงินที่ใช้ได้จริงราว ${exnAmt(cash)}` : "เงินสดที่มีอยู่"} ${runway < 3 ? `!!จะใช้ได้ราว ${runTxt}!!` : `**จะใช้ได้ราว ${runTxt}**`} หรือถึงประมาณ${runOut} ถ้าไม่มีเงินกู้เข้ามาเพิ่ม`);
        if(need > 0) s.push(`ถ้าต้องการสำรองเงินไว้ ${EXN_BUFFER_MONTHS} เดือน บริษัท!!ต้องหาเงินเพิ่มอีกราว ${exnAmt(need)}!!`);
        s.push(`จึงขอให้ผู้บริหารพิจารณา **แหล่งเงินสำหรับช่วงถัดไป**` + (up[0] ? ` และ**แนวทางควบคุม${sh(up[0].k)}** ซึ่งเป็นรายการที่เพิ่มขึ้นมากที่สุด` : ""));
      } else s.push(`สุดท้ายเรื่องความเพียงพอของเงินสด **การดำเนินงานรวมการลงทุนสร้างเงินสดได้เองราว ${exnAmt(-burn)}ต่อเดือน** จึงไม่ต้องพึ่งเงินกู้`);
      F["stmt.close"] = { say: s, prompts: ["เรื่องที่ขอให้ผู้บริหารพิจารณา"] };
    }
    return F;
  }

  /* ---------- บทวิเคราะห์: งบกำไรขาดทุน / งบแสดงฐานะการเงิน ----------
     งบฐานะ = ชุดเดียวกับ POG (หน้างบฐานะของ POG พอร์ตมาจาก BIO) · P&L = ★ BIO (ด้านล่าง) — น้ำเสียง/รูปประโยคเดียวกับ Benya
       ตัวเลขทุกตัวมาจากค่าที่หน้าคำนวณแล้วส่งมา (exnMountFin) → ตรงกับบนจอเสมอ
       P&L ของ POG: % ทุกตัวคิดจาก "รายได้จากการขาย" (ไม่รวมรายได้อื่น) แบบเดียวกับหน้า · ไม่มีคะแนนสุขภาพ (ทีมขอเอาออก) */
  function exnFinDrafts(which, d) {
    const F = {};
    if (which === "pnl") {
      /* ★ BIO: เขียนตามกล่องบนหน้า P&L ของ BIO (Pareto แหล่งรายได้/ค่าใช้จ่าย · กราฟรายเดือน · โดนัท · คะแนนสุขภาพ ·
         CFO Insight · ไม่มีงบประมาณ) — % ทุกตัวคิดจาก "รายได้รวม" (ขาย + รายได้อื่น) แบบเดียวกับหน้า (PL_compute)
         ตัวเลขทุกตัวมาจากค่าที่หน้าคิดแล้วส่งมา (comp / groups / accounts / k / health / recs) → ตรงกับบนจอเสมอ */
      if (!d || !d.comp || !d.groups || !d.lastMonth || d.isSample) return null;
      const n = d.lastMonth, G = d.groups, C = d.comp, K = d.k || {};
      const MF = (d.monthsFull && d.monthsFull.length === 12) ? d.monthsFull : EXN_MON_FULL;
      const yr = d.year || "";
      const idxAll = [...Array(n).keys()];
      const sum = (arr, idx) => (idx || idxAll).reduce((t, i) => t + (Number((arr || [])[i]) || 0), 0);
      const opexArr = idxAll.map(i => (Number(G.selling[i]) || 0) + (Number(G.admin[i]) || 0));
      const finArr = idxAll.map(i => Number(G.finance[i]) || 0);
      const revArr = C.totalRevenue || [];
      const rev = Number(K.revenue) || sum(revArr), gp = Number(K.gp) || sum(C.grossProfit), net = Number(K.net) || sum(C.netProfit);
      const other = sum(G.otherIncome), opex = sum(opexArr), fin = sum(finArr), cost = Number(K.cost) || sum(C.totalCost);
      const w = n >= 6 ? 3 : Math.max(1, Math.floor(n / 2));
      const eI = [...Array(w).keys()], lI = eI.map(i => n - w + i);
      const avg = (arr, idx) => sum(arr, idx) / idx.length;
      const mName = i => MF[i] || "";
      const lab = idx => idx.length > 1 ? `${mName(idx[0])}–${mName(idx[idx.length - 1])}` : mName(idx[0]);
      const eL = lab(eI), lL = lab(lI);
      const revE = avg(revArr, eI), revL = avg(revArr, lI), opxE = avg(opexArr, eI), opxL = avg(opexArr, lI);
      const finE = avg(finArr, eI), finL = avg(finArr, lI), netE = avg(C.netProfit, eI), netL = avg(C.netProfit, lI);
      const revUp = n >= 2 && revL > revE * 1.05;
      const gm = rev ? gp / rev * 100 : 0;
      const pct = v => rev ? v / rev * 100 : 0;
      const profitMonths = idxAll.filter(i => (Number(C.netProfit[i]) || 0) > 0).map(mName);
      const span = n > 1 ? `ตั้งแต่${mName(0)}ถึง${mName(n - 1)} ${yr}` : `เดือน${mName(0)} ${yr}`;
      const isStock = nm => /ต้นงวด|ปลายงวด|คงเหลือ|สำเร็จรูป|ระหว่างผลิต|ระหว่างทำ|สต็อก|stock|inventory/i.test(String(nm || ""));   // = PL_isStock ของหน้า
      const accts = g => ((d.accounts && d.accounts[g]) || []).filter(a => !isStock(a.name)).map(a => ({ name: String(a.name || a.code || "").trim(), arr: a.arr || [], total: sum(a.arr || []) }));
      const revName = nm => String(nm || "").replace(/^รายได้\s*(จาก)?\s*/, "").trim() || nm;   // "รายได้จากการขาย…" → "การขาย…"
      const isPay = nm => /เงินเดือน|ค่าจ้าง|สวัสดิการ|บุคลากร|พนักงาน/.test(nm) && !/จ้างเหมา/.test(nm);

      F["pnl.brief"] = { say: [
        `สำหรับงบกำไรขาดทุน${span} ภาพรวมบริษัท${net < 0 ? "ยังขาดทุน" : "มีกำไร"}`,
        net < 0 ? `ประเด็นหลักที่อยากให้เห็นคือ ${revUp ? "**รายได้โตต่อเนื่อง** แต่" : ""}!!ค่าใช้จ่ายขายและบริหารรวมดอกเบี้ยยังสูงกว่ากำไรขั้นต้น!! บริษัทจึงยังไม่ถึงจุดคุ้มทุน`
          : `ประเด็นหลักที่อยากให้เห็นคือ **บริษัทมีกำไรจากการดำเนินงาน**${revUp ? " และ**รายได้โตต่อเนื่อง**" : ""}`,
      ] };

      {
        const s = [`เริ่มจากอัตรากำไรขั้นต้น **${exnP(gm)}** หมายความว่าขายได้ 100 บาท เหลือ ${Math.round(gm)} บาทหลังหักต้นทุนขาย`];
        s.push(`แต่ค่าใช้จ่ายขายและบริหารรวมดอกเบี้ยสูงถึง **${exnP(pct(opex + fin))} ของรายได้รวม**` + (gp > 0 && opex + fin > gp ? ` หรือ !!${((opex + fin) / gp).toFixed(1)} เท่าของกำไรขั้นต้น!!` : ""));
        if (other < -1000) s.push(`และ!!รายได้อื่นติดลบราว ${exnAmt(other)}!! ซึ่งกดกำไรสุทธิลงอีก`);
        if (net < 0 && gp > 0 && opex + fin > gp) s.push("ข้อสรุปจึงเป็นว่า **ปัญหาอยู่ที่ค่าใช้จ่าย ไม่ใช่ต้นทุนขาย**");
        F["pnl.kpi"] = { say: s };
      }

      {
        const gmR = rev ? gp / rev : 0, fixed = opex + fin;
        if (!(gmR > 0)) F["pnl.breakeven"] = { say: ["ช่วงนี้!!คำนวณจุดคุ้มทุนไม่ได้!! เพราะกำไรขั้นต้นไม่เป็นบวก"] };
        else {
          const beM = fixed / gmR / n, revM = rev / n, gap = beM - revM;
          const s = [`จุดคุ้มทุนอยู่ที่รายได้ราว **${exnAmt(beM)}ต่อเดือน** ตอนนี้บริษัททำได้ ${exnP(revM / beM * 100)}` + (n >= 2 && revL > 0 ? ` และช่วง${lL}ขยับมาเป็น **${exnP(revL / beM * 100)}**` : "")];
          if (gap > 0) s.push(`ทางที่จะไปถึงจุดคุ้มทุนมีสองทาง คือ**เพิ่มยอดขายอีกราว ${exnAmt(gap)}ต่อเดือน** หรือ**ลดค่าใช้จ่ายลงราว ${exnAmt((fixed - gp) / n)}ต่อเดือน** หรือทำทั้งสองทางควบคู่กัน`);
          else s.push("ตอนนี้**รายได้สูงกว่าจุดคุ้มทุนแล้ว**");
          F["pnl.breakeven"] = { say: s, prompts: ["แนวทางเพิ่มรายได้ / ลดค่าใช้จ่าย"] };
        }
      }

      {
        const s = [];
        if (n >= 2) {
          const rw = exnChgS(revL, revE), ow = exnChgS(opxL, opxE);
          if (rw) s.push(`เมื่อดูเป็นรายเดือน รายได้ช่วง${lL} ${revUp ? `**${rw}**` : rw} จากช่วง${eL}` + (ow ? ` ขณะที่ค่าใช้จ่ายขายและบริหาร${ow}` : "") +
            (rw && ow ? (revL < revE * 0.95 && opxL > opxE * 1.02 ? " หมายความว่า !!รายได้ลดลงแต่ค่าใช้จ่ายกลับเพิ่มขึ้น!!"
              : revL / revE > opxL / opxE + 0.05 ? " หมายความว่า **รายได้โตเร็วกว่าค่าใช้จ่าย**" : " หมายความว่า !!ค่าใช้จ่ายโตตามรายได้!!") : ""));
          if (finL > finE * 1.3 && finL - finE > 10000) s.push(`แต่!!ดอกเบี้ย${exnChgS(finL, finE)}!! ตามเงินกู้ที่เพิ่มขึ้น`);
          if (netE < 0 && netL < 0) s.push(`ผลคือขาดทุนต่อเดือน${-netL > -netE * 1.05 ? `!!เพิ่มจาก ${exnAmt(netE)} เป็น ${exnAmt(netL)}!!` : -netL < -netE * 0.95 ? `**ลดลงจาก ${exnAmt(netE)} เหลือ ${exnAmt(netL)}**` : `ใกล้เคียงเดิม ที่ราว ${exnAmt(netL)}`}`);
          else if (netL > netE) s.push(`ผลคือผลประกอบการต่อเดือน**ดีขึ้น**จาก${netE < 0 ? "ขาดทุน" : "กำไร"} ${exnAmt(netE)} เป็น${netL < 0 ? "ขาดทุน" : "กำไร"} ${exnAmt(netL)}`);
          else if (netL < netE) s.push(`ผลคือผลประกอบการต่อเดือน!!แย่ลง!!จาก${netE < 0 ? "ขาดทุน" : "กำไร"} ${exnAmt(netE)} เป็น${netL < 0 ? "ขาดทุน" : "กำไร"} ${exnAmt(netL)}`);
        }
        s.push(profitMonths.length === 0 ? `และตลอดช่วงนี้ !!ขาดทุนทุกเดือน!!` : profitMonths.length === n ? `และตลอดช่วงนี้ **มีกำไรทุกเดือน**` : `และตลอดช่วงนี้มีกำไร **${profitMonths.length === 1 ? "เพียงเดือนเดียว" : profitMonths.length + " จาก " + n + " เดือน"}** คือ${exnAnd(profitMonths.slice(0, 6))}`);
        F["pnl.table"] = { say: s };
      }

      {
        const s = [];
        const revAcc = ["saleGoods", "otherIncome"].flatMap(accts).filter(a => a.total > 0).sort((a, b) => b.total - a.total);
        const revSum = revAcc.reduce((t, a) => t + a.total, 0) || 1;
        if (revAcc.length) {
          let t = `รายได้หลักมาจาก**${revName(revAcc[0].name)} ถึง ${exnP(revAcc[0].total / revSum * 100)}**`;
          if (n >= 2) { const w2 = exnChgS(avg(revAcc[0].arr, lI), avg(revAcc[0].arr, eI)); if (w2 && w2 !== "ใกล้เคียงเดิม") t += ` และ${w2} จากช่วง${eL}`; }
          s.push(t);
          if (revAcc[1]) s.push(`รองลงมาคือ${revName(revAcc[1].name)} ${exnP(revAcc[1].total / revSum * 100)}` + (revAcc[0].total / revSum >= 0.7 ? " — !!รายได้กระจุกอยู่ที่แหล่งเดียว!!" : ""));
        }
        F["pnl.revenue"] = { say: s };
      }

      {
        const s = [];
        if (n >= 3) {
          const rv = idxAll.map(i => Number(revArr[i]) || 0);
          const hi = rv.indexOf(Math.max(...rv)), lo = rv.indexOf(Math.min(...rv));
          s.push(`รายได้แต่ละเดือนไม่เท่ากัน เดือนที่สูงที่สุดคือ**${mName(hi)}** ราว ${exnAmt(rv[hi])} ส่วนเดือนที่ต่ำที่สุดคือ${mName(lo)} ราว ${exnAmt(rv[lo])}`);
        }
        const lossM = idxAll.filter(i => (Number(C.netProfit[i]) || 0) < 0).length;
        if (n >= 2) s.push(lossM === 0 ? "เส้นกำไรสุทธิ**อยู่เหนือศูนย์ทุกเดือน**" : lossM === n ? "เส้นกำไรสุทธิ!!อยู่ใต้ศูนย์ทุกเดือน!! คือรายได้แต่ละเดือนยังไม่พอค่าใช้จ่าย" : `เส้นกำไรสุทธิอยู่ใต้ศูนย์ ${lossM} จาก ${n} เดือน`);
        F["pnl.trend"] = { say: s };
      }

      {
        const cats = [
          { name: "ต้นทุนขาย", total: cost },
          { name: "ค่าใช้จ่ายในการบริหาร", total: sum(G.admin) },
          { name: "ต้นทุนทางการเงิน", total: fin },
          { name: "ค่าใช้จ่ายในการขาย", total: sum(G.selling) },
        ].filter(c => c.total > 0.005).sort((a, b) => b.total - a.total);
        const grand = cats.reduce((t, c) => t + c.total, 0) || 1;
        const s = [];
        if (cats.length) s.push(`ค่าใช้จ่ายส่วนใหญ่คือ**${cats[0].name} ${exnP(cats[0].total / grand * 100)}**` + (cats[1] ? ` รองลงมาคือ${cats[1].name} ${exnP(cats[1].total / grand * 100)}` : ""));
        const hr = ["admin", "selling"].flatMap(accts).filter(a => isPay(a.name)).reduce((t, a) => t + a.total, 0);
        if (hr > 0) s.push(`ส่วนเงินเดือนและบุคลากรราว ${exnAmt(hr / n)}ต่อเดือน เป็น**ต้นทุนคงที่** ที่ไม่ลดตามยอดขาย`);
        if (fin > 0 && rev > 0) s.push(`ดอกเบี้ยจ่ายคิดเป็น ${fin / rev > 0.03 ? "!!" : "**"}${exnP(fin / rev * 100)} ของรายได้รวม${fin / rev > 0.03 ? "!!" : "**"} หรือราว ${exnAmt(fin / n)}ต่อเดือน`);
        if (n >= 2) {
          const ac = ["selling", "admin"].flatMap(accts).map(a => ({ name: a.name, a: avg(a.arr, eI), b: avg(a.arr, lI) })).map(x => ({ ...x, d: x.b - x.a })).sort((x, y) => y.d - x.d);
          if (ac[0] && ac[0].d > 10000) s.push(`และบัญชีที่!!เพิ่มเร็วที่สุดคือ${ac[0].name}!! จากเดือนละ ${exnAmt(ac[0].a)} เป็น ${exnAmt(ac[0].b)}`);
        }
        if (rev > 0) s.push(net < 0
          ? `ถ้าดูว่ารายได้ไปไหน รายได้ทุก 100 บาท บริษัท!!จ่ายออกไป ${Math.round(100 + Math.abs(pct(net)))} บาท!! คือต้นทุนขาย ${Math.round(pct(cost))} บาท ค่าใช้จ่ายขายและบริหาร ${Math.round(pct(opex))} บาท และดอกเบี้ย ${Math.round(pct(fin))} บาท`
          : `ถ้าดูว่ารายได้ไปไหน รายได้ทุก 100 บาท เป็นต้นทุนขาย ${Math.round(pct(cost))} บาท ค่าใช้จ่ายขายและบริหาร ${Math.round(pct(opex))} บาท ดอกเบี้ย ${Math.round(pct(fin))} บาท และ**เหลือเป็นกำไร ${Math.round(pct(net))} บาท**`);
        F["pnl.expense"] = { say: s, prompts: cats.slice(0, 2).map(c => `แผนควบคุม${c.name}`) };
      }

      {
        const H = d.health;   // = PL_buildHealth ของหน้า (การ์ดคะแนนสุขภาพทางการเงิน)
        const subs = ((H && H.subs) || []).filter(x => x && x.score != null).slice().sort((a, b) => a.score - b.score);
        if (H && H.overall != null && subs.length) {
          F["pnl.health"] = { say: [
            `คะแนนสุขภาพทางการเงินรวมอยู่ที่ ${H.overall} คะแนน ซึ่งอยู่ในระดับ${H.overall >= 70 ? "**ดี**" : H.overall >= 45 ? "เฝ้าระวัง" : "!!ต้องดำเนินการ!!"}`,
            `ด้านที่ฉุดคะแนนคือ!!${exnShortName(subs[0].name)}!!` + (subs[1] && subs[1].score < 70 ? ` และ!!${exnShortName(subs[1].name)}!!` : ""),
            `ส่วนจุดแข็งคือด้าน**${exnShortName(subs[subs.length - 1].name)}**`,
          ] };
        }
      }

      F["pnl.insight"] = { say: [
        `โดยสรุป ${revUp ? "**ยอดขายดีขึ้น** และ" : ""}อัตรากำไรขั้นต้น ${exnP(gm)} แต่${net < 0 ? "!!ค่าใช้จ่ายยังสูงเกินกว่าที่รายได้รับไหว!!" : "**บริษัทมีกำไร**"}`,
        ...((d.recs || []).slice(0, 2).map((r, i) => exnRecPt(r, i))),
      ], prompts: ["เรื่องที่ขอให้ผู้บริหารพิจารณา"] };
    } else {
      const b = d && d.bs, rows = (d && d.rows) || [];
      if (!b || !rows.length || !d.m) return null;
      const m = d.m, EQ = d.eqWord || "ส่วนของผู้ถือหุ้น";
      const v = x => (x && x.cur != null && isFinite(x.cur)) ? Number(x.cur) : null;
      const nclRow = rows.find(r => /^รวมหนี้สินไม่หมุนเวียน$/.test(String(r.label || "").trim()));
      const T = { ta: v(m.totalAssets), tl: v(m.totalLiab), eq: v(m.equity), ca: v(m.curAssets), cl: v(m.curLiab), ncl: v(nclRow) };
      const asof = exnStrip(b.asOf || b.curLabel || "").replace(/^ณ\s*(วันที่\s*)?/, "");
      const cr = (T.ca != null && T.cl) ? T.ca / T.cl : null;
      const eqNeg = T.eq != null && T.eq < 0;
      // แยกบรรทัดตามหมวดของงบ (section → group → line)
      let sec = "", grp = "";
      const CA = [], NCL = [], EQL = [];
      rows.forEach(r => {
        const lb = String(r.label || "").trim();
        if (r.kind === "section") { sec = lb; grp = ""; return; }
        if (r.kind === "group") { grp = lb; return; }
        if (r.kind !== "line" || r.cur == null || Math.abs(r.cur) <= 0.5) return;
        if (/ส่วนของ(ผู้ถือหุ้น|เจ้าของ)/.test(grp)) EQL.push({ name: lb, v: r.cur });
        else if (/หนี้สิน/.test(sec) && /ไม่หมุนเวียน/.test(grp)) NCL.push({ name: lb, v: r.cur });
        else if (sec === "สินทรัพย์" && /หมุนเวียน/.test(grp) && !/ไม่หมุนเวียน/.test(grp)) CA.push({ name: lb, v: r.cur });
      });
      NCL.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
      const cashL = CA.find(l => /^เงินสด/.test(l.name)), cash = cashL ? cashL.v : 0;
      const capL = EQL.filter(l => /หุ้นสามัญ|ทุนจดทะเบียน|ทุนที่ออก|ทุนเรือนหุ้น/.test(l.name)).slice(-1)[0];
      const cap = capL ? capL.v : 0;
      const lossL = EQL.find(l => /ขาดทุนสะสม|กำไรสะสม|กำไร\s*\(ขาดทุน\)\s*สะสม|ยังไม่ได้จัดสรร/.test(l.name)), loss = lossL ? lossL.v : 0;
      const comp = ((d.charts && d.charts.assetComp) || []).map(x => ({ name: String(x.label || ""), value: Number(x.value) || 0 }));
      const compTot = comp.reduce((t, x) => t + x.value, 0) || 1;
      comp.forEach(x => { x.pct = x.value / compTot; });
      const recvTop = comp.length && /^ลูกหนี้/.test(comp[0].name);
      const liqOkTxt = cr != null && cr >= 1;

      F["bal.brief"] = { say: [
        `ต่อไปเป็นงบแสดงฐานะการเงิน ณ ${asof}`,
        eqNeg ? `ประเด็นหลักคือ !!หนี้สินมากกว่าสินทรัพย์ ทำให้${EQ}ติดลบ!! ขณะที่สภาพคล่องระยะสั้น${liqOkTxt ? "**ยังพอไหว**" : "!!ค่อนข้างตึงตัว!!"}`
          : `ประเด็นหลักคือ **สินทรัพย์มากกว่าหนี้สิน ${EQ}เป็นบวก** และสภาพคล่องระยะสั้น${liqOkTxt ? "**ยังพอไหว**" : "!!ค่อนข้างตึงตัว!!"}`,
      ] };
      F["bal.hero"] = { say: T.ta ? (eqNeg ? [
        `ถ้านำสินทรัพย์ทั้งหมดไปชำระหนี้ บริษัท!!ยังขาดอยู่ราว ${exnAmt(T.eq)}!!`,
        `หรือพูดอีกแบบคือ หนี้สินเป็น **${(T.tl / Math.max(1, T.ta)).toFixed(1)} เท่าของสินทรัพย์ที่มีอยู่**`,
      ] : [`หนี้สินคิดเป็น **${exnP(T.tl / Math.max(1, T.ta) * 100)} ของสินทรัพย์** ส่วนที่เหลือเป็นเงินทุนของ${EQ.replace(/^ส่วนของ/, "")}`]) : [] };
      {
        const s = [];
        if (cashL && T.cl > 0) s.push(`ในตารางงบ เงินสดครอบคลุมหนี้สินหมุนเวียนได้ **${exnP(cash / T.cl * 100)}**` + (cash < T.cl ? (recvTop ? " ส่วนที่เหลือต้องพึ่ง**การเก็บเงินจากลูกหนี้**" : " ส่วนที่เหลือ!!ต้องพึ่งสินทรัพย์อื่นมาจ่ายหนี้ระยะสั้น!!") : " ถือว่า**เพียงพอ**"));
        if (NCL.length) s.push(`หนี้ก้อนใหญ่ของหนี้สินไม่หมุนเวียนคือ**${NCL[0].name}** ราว ${exnAmt(NCL[0].v)} ซึ่งไม่ต้องคืนภายใน 1 ปี` + (/กู้/.test(NCL[0].name) ? " แต่!!มีภาระดอกเบี้ยต่อเนื่อง!!" : ""));
        if (cap > 0 && loss < 0) s.push(`และ!!ขาดทุนสะสมสูงกว่าทุนที่ชำระแล้วถึง ${(Math.abs(loss) / cap).toFixed(1)} เท่า!!`);
        F["bal.table"] = { say: s };
      }
      {
        const s = [];
        if (comp.length) {
          const top = comp[0].name;
          s.push(`สินทรัพย์ **${exnP(comp[0].pct * 100)} เป็น${top}**` + (/^ลูกหนี้/.test(top) ? " สภาพคล่องจึงขึ้นอยู่กับ**การเก็บเงินลูกหนี้ให้ตรงเวลา**" : /^เงินสด/.test(top) ? " ซึ่ง**เป็นเงินสดที่นำไปใช้ได้ทันที**" : /สินค้า|งานระหว่างทำ|ต้นทุนงาน/.test(top) ? " ซึ่ง!!เงินจมอยู่กับงานที่ยังไม่ได้วางบิล!!" : ""));
          const nca = (T.ta && v(rows.find(r => /^รวมสินทรัพย์ไม่หมุนเวียน$/.test(String(r.label || "").trim())))) ? v(rows.find(r => /^รวมสินทรัพย์ไม่หมุนเวียน$/.test(String(r.label || "").trim()))) / T.ta : 0;
          if (nca > 0.2) s.push(`อีกราว ${exnP(nca * 100)} เป็นสินทรัพย์ไม่หมุนเวียน ซึ่ง!!เปลี่ยนเป็นเงินสดได้ช้า!!`);
        }
        F["bal.assets"] = { say: s };
      }
      F["bal.funding"] = { say: T.tl > 0 ? [
        T.ncl != null ? `หนี้สิน **${exnP(T.ncl / T.tl * 100)} เป็นหนี้สินไม่หมุนเวียน**` + (T.ncl / T.tl >= 0.5 ? " แรงกดดันในระยะสั้นจึงยังต่ำ" : " ที่เหลือเป็น!!หนี้ระยะสั้นที่ต้องจ่ายภายใน 1 ปี!!") : "",
        eqNeg ? `แต่!!${EQ}ติดลบ!! แปลว่าสินทรัพย์ทั้งหมดของบริษัทได้เงินทุนมาจากหนี้` : "",
      ].filter(Boolean) : [] };
      {
        const R = d.ratios || [];
        const liq = R.filter(r => /สภาพคล่อง|เงินทุนหมุนเวียน/.test(r.name)), cap2 = R.filter(r => /หนี้สิน|ส่วนของ/.test(r.name));
        const liqOk = liq.length && liq.every(r => r.status !== "bad"), capBad = cap2.length && cap2.every(r => r.status === "bad");
        const s = [];
        if (cr != null) s.push(`ด้านสภาพคล่อง หนี้ระยะสั้นทุก 1 บาท มีสินทรัพย์หมุนเวียนรองรับ ${cr.toFixed(2)} บาท ซึ่ง${cr >= 1 ? "**ผ่านเกณฑ์**" : "!!ยังไม่ผ่านเกณฑ์!!"}`);
        if (capBad) s.push(`${cr != null && cr >= 1 ? "แต่" : "และ"}อัตราส่วนด้านโครงสร้างทุน!!ไม่ผ่านทุกตัว!!` + (eqNeg ? ` เพราะ${EQ}ติดลบ` : ""));
        if (liqOk && capBad) s.push("สรุปคือ **ระยะสั้นยังไม่เร่งด่วน แต่โครงสร้างทุนในระยะยาวต้องแก้ไข**");
        else if (!liqOk && capBad) s.push("สรุปคือ !!ต้องดูแลทั้งการชำระหนี้ระยะสั้นและโครงสร้างทุนไปพร้อมกัน!!");
        F["bal.ratios"] = { say: s };
        const subs = R.filter(r => r.score != null).map(r => ({ name: r.name, score: r.score })).sort((a, b) => a.score - b.score);
        if (d.overallScore != null && subs.length) {
          const H = d.overallScore;
          F["bal.health"] = { say: [
            `คะแนนฐานะการเงินรวมอยู่ที่ ${H} คะแนน ซึ่งอยู่ในระดับ${H >= 70 ? "**ดี**" : H >= 45 ? "ปานกลาง" : "!!ต้องปรับปรุง!!"}`,
            `ด้านที่ฉุดคะแนนคือ!!${exnShortName(subs[0].name)}!!` + (subs[1] ? ` และ!!${exnShortName(subs[1].name)}!!` : ""),
            `ส่วนจุดแข็งคือด้าน**${exnShortName(subs[subs.length - 1].name)}**`,
          ] };
        }
      }
      F["bal.insight"] = { say: [
        eqNeg ? `โดยสรุป สภาพคล่องระยะสั้น${liqOkTxt ? "**ยังพอไหว** แต่" : "!!ตึงตัว!! และ"}!!ทุนติดลบจากขาดทุนสะสม โดยเงินทุนส่วนใหญ่มาจากหนี้!!` : `โดยสรุป **ฐานะการเงินมั่นคง ${EQ}เป็นบวก**`,
        ...((d.recs || []).slice(0, 2).map((r, i) => exnRecPt(r, i))),
      ], prompts: ["เรื่องที่ขอให้ผู้บริหารพิจารณา"] };
    }
    return F;
  }


  /* ---------- state + โหลด/บันทึกโน้ต ----------
     ★ BIO: โน้ตอยู่ตาราง Supabase execNotes ({id,data}) — โหลดทั้งตารางครั้งเดียว (ตารางเล็ก) แล้วแบ่งตาม period
       (execNotes ∈ SHEET_TABLES ของ data_supabase.js · เขียนผ่าน upsertSheetRows = เขียนเฉพาะแถวนั้น)
       id = '<period>|<frameKey>' · data = { period, frameKey, note, updatedBy } */
  const EXN = { notes: {}, loaded: false, loading: false, err: null, typing: {}, ctx: null, scope: null, fin: {} };
  function exnState() { return EXN; }
  function exnTapGet() { try { return localStorage.getItem("bio-exn-tap") !== "0"; } catch (e) { return true; } }
  function exnTapSet(v) { try { localStorage.setItem("bio-exn-tap", v ? "1" : "0"); } catch (e) { } }

  async function exnLoad() {
    const S = exnState();
    if (S.loaded || S.loading) return;
    S.loading = true;
    try {
      if (!window.WTPData || !window.WTPData.fetchSheetRows) throw new Error("ไม่พบตัวเชื่อมข้อมูล");
      const rows = await window.WTPData.fetchSheetRows("execNotes");
      const m = {};
      (rows || []).forEach(r => { if (!r || !r.period || !r.frameKey) return; (m[r.period] = m[r.period] || {})[r.frameKey] = { note: r.note || "", updated_at: r.updatedAt || r.updated_at || null }; });
      S.notes = m; S.err = null;
    } catch (e) {
      S.err = "โหลดโน้ตไม่สำเร็จ: " + ((e && e.message) || e);
    } finally {
      S.loading = false; S.loaded = true;
    }
    exnRefreshPop();
    exnRenderFab();
  }

  const _exnTimers = {};
  /* ข้อความที่พิมพ์ค้าง (ยังบันทึกไม่เสร็จ) — กันหายตอนหน้าถูกวาดใหม่ระหว่างพิมพ์/กำลังบันทึก */
  function exnTypingKey(period, key) { return period + "|" + key; }
  function exnInput(el) {
    const key = el.getAttribute("data-key"), period = el.getAttribute("data-period");
    const S = exnState(); (S.typing = S.typing || {})[exnTypingKey(period, key)] = el.value;
    const st = document.getElementById("exnSt_" + key.replace(/\./g, "_"));
    if (st) { st.textContent = "ยังไม่บันทึก"; st.style.color = "#b45309"; }
    el.style.height = "auto"; el.style.height = Math.max(60, el.scrollHeight + 2) + "px";
    clearTimeout(_exnTimers[key]);
    _exnTimers[key] = setTimeout(() => exnSave(el), 1500);
  }
  async function exnSave(el) {
    const key = el.getAttribute("data-key"), period = el.getAttribute("data-period");
    clearTimeout(_exnTimers[key]);
    const S = exnState(); S.typing = S.typing || {};
    const text = el.value;
    const cur = (S.notes[period] || {})[key];
    if ((cur && cur.note === text) || (!cur && !text.trim())) { delete S.typing[exnTypingKey(period, key)]; return; }
    const st = document.getElementById("exnSt_" + key.replace(/\./g, "_"));
    if (st) { st.textContent = "กำลังบันทึก…"; st.style.color = "#64748b"; }
    try {
      if (!window.WTPData || !window.WTPData.upsertSheetRows) throw new Error("ไม่พบตัวเชื่อมข้อมูล");
      await window.WTPData.upsertSheetRows("execNotes", [{ id: period + "|" + key, period, frameKey: key, note: text, updatedBy: exnWho() }]);
      (S.notes[period] = S.notes[period] || {})[key] = { note: text, updated_at: new Date().toISOString() };
      if (S.typing[exnTypingKey(period, key)] === text) delete S.typing[exnTypingKey(period, key)];
      const st2 = document.getElementById("exnSt_" + key.replace(/\./g, "_"));   // ป๊อปอัพอาจถูกวาดใหม่ระหว่างรอ
      if (st2) { st2.textContent = "บันทึกแล้ว " + new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }); st2.style.color = "#047857"; }
      exnRenderFab();
    } catch (e) {
      const st2 = document.getElementById("exnSt_" + key.replace(/\./g, "_"));
      if (st2) { st2.textContent = "บันทึกไม่สำเร็จ: " + ((e && e.message) || e); st2.style.color = "#b91c1c"; }
    }
  }

  /* ---------- context ของหน้าปัจจุบัน: กรอบ + คำพูด ---------- */
  function exnContext() {
    const S = exnState(), ctx = S.ctx;
    if (!ctx) return null;
    if (ctx.kind === "exec") {
      const d = edState(), tab = d.tab || "summary";
      let drafts = null;
      try { drafts = d.data ? exnDrafts(d.data, ctx.mf) : null; } catch (e) { console.warn("exnDrafts", e); }
      return { period: ctx.period, drafts, tab,
        defs: exnFrameDefs().map(f => Object.assign({ group: exnTabLabel(f.tab) }, f)),
        scopeLbl: edScopeLabel(ctx.mf),
        noDraftMsg: `ช่วงเวลานี้ยังไม่มีข้อมูลให้ร่างคำพูด · พิมพ์โน้ตของช่วงนี้ได้` };
    }
    const which = ctx.kind === "pnl" ? "pnl" : "balance", d = S.fin[which] || {};
    let drafts = null;
    try { drafts = exnFinDrafts(which, d); } catch (e) { console.warn("exnFinDrafts", e); }
    const grp = which === "pnl" ? "งบกำไรขาดทุน" : "งบแสดงฐานะการเงิน";
    return { period: ctx.period, drafts,
      defs: exnFinFrameDefs(which).map(f => Object.assign({ group: grp }, f)),
      scopeLbl: ctx.label || grp,
      noDraftMsg: which === "pnl" && d.isSample ? "หน้านี้ยังแสดงข้อมูลตัวอย่าง — ระบบจึงยังไม่ร่างคำพูดให้" : `ยังไม่มีข้อมูลงบ — อัปไฟล์งบการเงินก่อน ระบบจึงจะร่างคำพูดให้` };
  }

  /* ---------- ติดป้ายกรอบที่ไม่ได้ติดไว้ใน template (หน้างบกระแสเงินสด) ----------
     ★ POG: หน้า P&L / งบฐานะติด data-exn ไว้ใน JSX แล้ว · หน้างบกระแสเงินสดใช้ป้ายใน template ของ Benya + ที่นี่ */
  function exnTag(el, keys) {
    if (!el) return;
    const cur = (el.getAttribute("data-exn") || "").split(/\s+/).filter(Boolean);
    keys.forEach(k => { if (!cur.includes(k)) cur.push(k); });
    el.setAttribute("data-exn", cur.join(" "));
  }
  function exnBindTargets() {
    const S = exnState(), ctx = S.ctx;
    // ★ จอทีวี (โหมดแคสหน้าจอ · present_sync.js) ไม่ใช่บัญชีผู้นำเสนอ = ไม่มี ctx แต่ต้องติดป้ายกรอบเหมือนกัน
    //   (ใช้หากรอบที่ไอแพดเลื่อนถึง) — แบบ Benya exnBindTargets ที่ดูจากหน้าที่เปิดอยู่เมื่อไม่มี ctx
    const exec = ctx ? ctx.kind === "exec" : String(window.location.hash || "").replace(/^#/, "").split("?")[0] === "cashflow_present";
    const host = document.getElementById("edContent");
    const main = ctx ? S.scope : (host && host.closest(".ed-page"));
    if (!exec || !main) return;
    const tab = edState().tab || "summary";
    exnTag(main.querySelector(".page-head"), ["summary.brief"]);
    const c = main.querySelector("#edContent");
    if (c) {
      c.removeAttribute("data-exn");
      if (tab === "banks") exnTag(c, ["banks.accounts"]);
      else if (tab === "explorer") exnTag(c, ["explorer.note"]);
      else if (tab === "stmt") exnTag(c, ["stmt.trend", "stmt.close"]);
    }
  }

  /* ---------- ติดตั้ง/ถอด (★ POG: หน้าเป็น React — ปุ่ม/ป๊อปอัพวางใน <body> แล้วถอดเองตอนออกจากหน้า) ---------- */
  function exnEnsureRoot(scope) {
    const old = document.getElementById("exnRoot");
    if (!exnIsPresenter() || !scope) { if (old) old.remove(); document.body.classList.remove("exn-tap"); return null; }
    exnInjectCss();
    exnInstallClick();
    document.body.classList.toggle("exn-tap", exnTapGet());
    if (EXN.scope && EXN.scope !== scope) EXN.scope.classList.remove("exn-scope");
    EXN.scope = scope; scope.classList.add("exn-scope");
    if (old) return old;
    const root = document.createElement("div"); root.id = "exnRoot";
    document.body.appendChild(root);
    return root;
  }
  /* โหมดแคสหน้าจอ (present_sync.js) — หน้าวาดเสร็จ: ทีวีได้ปุ่ม "📡 โหมดแคสหน้าจอ" · ไอแพดส่งตำแหน่งให้จอใหญ่ */
  function exnPsyMounted() { try { if (window.Psy && window.Psy.onMount) window.Psy.onMount(); } catch (e) { } }
  function exnPsyToggle() { if (window.Psy && window.Psy.remoteToggle) window.Psy.remoteToggle(); exnCloseMenu(); exnToggleMenu(); }
  /* หน้างบกระแสเงินสด — เรียกท้าย edRenderDashboard() · mf = ช่วงที่เลือก · year = ปีของข้อมูล (แยกโน้ต "ทั้งหมด" ต่อปี) */
  function exnMount(o) {
    o = o || {};
    if (!exnEnsureRoot(o.root)) { exnPsyMounted(); return; }
    const S = exnState(), mf = o.mf || "all";
    S.ctx = { kind: "exec", mf, period: "cf:" + (mf === "all" ? "all:" + (o.year || "") : mf) };
    exnClosePop(); exnCloseMenu();
    exnBindTargets();
    exnLoad();
    exnRenderFab();
    exnPsyMounted();   // เปลี่ยนแท็บ/ช่วงเวลา = หน้าวาดใหม่ → บอกจอใหญ่
  }
  /* หน้างบกำไรขาดทุน / งบแสดงฐานะการเงิน — เรียกจาก useEffect ของหน้า (ทุกครั้งที่ข้อมูลเปลี่ยน)
     o = { root, period, label, data:{...ค่าที่หน้าคิดแล้ว} } */
  function exnMountFin(which, o) {
    o = o || {};
    const w = which === "pnl" ? "pnl" : "balance";
    if (!exnEnsureRoot(o.root)) { exnPsyMounted(); return; }
    const S = exnState();
    S.fin[w] = o.data || {};
    const period = (w === "pnl" ? "pnl:" : "bal:") + (o.period || "none");
    const same = S.ctx && S.ctx.kind === (w === "pnl" ? "pnl" : "bal") && S.ctx.period === period;
    S.ctx = { kind: w === "pnl" ? "pnl" : "bal", period, label: o.label || "" };
    if (!same) { exnClosePop(); exnCloseMenu(); }
    else exnRefreshPop();
    exnLoad();
    exnRenderFab();
    exnPsyMounted();
  }
  function exnUnmount(scope) {
    try { if (window.Psy && window.Psy.onUnmount) window.Psy.onUnmount(); } catch (e) { }   // ปุ่มทีวีหายเมื่อออกจาก 3 หน้างบ
    if (scope && EXN.scope && EXN.scope !== scope) return;   // หน้าอื่นเพิ่งติดตั้งทับไปแล้ว
    exnClosePop(); exnCloseMenu();
    const r = document.getElementById("exnRoot"); if (r) r.remove();
    if (EXN.scope) EXN.scope.classList.remove("exn-scope");
    EXN.scope = null; EXN.ctx = null;
    document.body.classList.remove("exn-tap");
  }

  /* ═════ หน้าจอ (ยกจาก Benya exec-notes.js บรรทัด 815–1130 · แก้ ★ POG) ═════ */
  /* ---------- UI ----------
     ★ กล่องบทวิเคราะห์ = กระจกโปร่ง (backdrop-filter) · วางข้างกรอบ ไม่บังกรอบที่กำลังชี้ (exnPlace เลือกตำแหน่งที่ทับกรอบน้อยที่สุด)
     ★ คอมพิวเตอร์ (มีเมาส์): ชี้กรอบค้างไว้ = กล่องขึ้นเอง · คลิกกรอบยังทำงานเดิม (drill-down)
       ไอแพด/จอสัมผัส: แตะกรอบ = กล่องขึ้น (ดักคลิกก่อน onclick เดิมของกรอบ)
     ★ แสดงเฉพาะบทวิเคราะห์ (dr.say) + โน้ตของฉันแบบย่อ (กด ✎ เพื่อเขียน) · ไม่แสดงตัวเลขเต็ม */
  function exnInjectCss(){
    if(document.getElementById("exnCss")) return;
    const s = document.createElement("style"); s.id = "exnCss";
    s.textContent = `
    #exnFab{position:fixed;right:18px;bottom:18px;z-index:950;border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:10px 16px;background:linear-gradient(135deg,rgba(124,58,237,.92),rgba(79,70,229,.92));-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:#fff;font:inherit;font-weight:700;font-size:14px;box-shadow:0 10px 28px rgba(79,70,229,.35);display:flex;align-items:center;gap:8px;cursor:pointer}
    #exnFab.off{background:rgba(100,116,139,.88);box-shadow:0 8px 18px rgba(15,23,42,.2)}
    #exnMenu{position:fixed;right:18px;bottom:70px;z-index:951;width:min(340px,calc(100vw - 36px));max-height:min(70vh,560px);overflow-y:auto;background:rgba(255,255,255,.82);-webkit-backdrop-filter:blur(18px) saturate(170%);backdrop-filter:blur(18px) saturate(170%);border:1px solid rgba(255,255,255,.8);border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,.22);padding:10px}
    #exnMenu .exn-mt{font-size:12px;color:#64748b;margin:2px 4px 8px}
    #exnMenu .exn-sw{display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(124,58,237,.08);border-radius:11px;padding:9px 11px;margin-bottom:8px;font-size:13.5px;font-weight:600;color:#4c1d95;cursor:pointer}
    #exnMenu .exn-sw i{width:38px;height:22px;border-radius:999px;background:#cbd5e1;position:relative;flex:none;font-style:normal}
    #exnMenu .exn-sw i::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
    #exnMenu .exn-sw.on i{background:#7c3aed} #exnMenu .exn-sw.on i::after{left:19px}
    #exnMenu .exn-it{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;border:none;background:none;font:inherit;font-size:13.5px;color:#0f172a;padding:8px 10px;border-radius:9px;cursor:pointer}
    #exnMenu .exn-it:hover{background:rgba(124,58,237,.08)} #exnMenu .exn-it small{color:#94a3b8;font-size:11.5px;white-space:nowrap}
    #exnMenu .exn-it.has b{color:#5b21b6}
    #exnPop{position:fixed;z-index:960;width:min(390px,calc(100vw - 20px));max-height:min(74vh,640px);overflow-y:auto;-webkit-overflow-scrolling:touch;
      background:linear-gradient(160deg,rgba(255,255,255,.80),rgba(248,245,255,.70));-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);
      border:1px solid rgba(255,255,255,.85);border-radius:20px;box-shadow:0 24px 60px rgba(30,27,75,.22),0 2px 8px rgba(30,27,75,.08),inset 0 1px 0 rgba(255,255,255,.9);
      padding:12px 16px 12px;color:#0f172a;animation:exnIn .16s ease-out}
    @keyframes exnIn{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
    #exnPop .exn-ph{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    #exnPop .exn-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;letter-spacing:.2px;color:#fff;background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:4px 10px;border-radius:999px;box-shadow:0 4px 10px rgba(79,70,229,.25);white-space:nowrap}
    #exnPop .exn-sc{font-size:11.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #exnPop .exn-x{margin-left:auto;border:none;background:rgba(15,23,42,.06);border-radius:999px;width:28px;height:28px;font-size:17px;line-height:1;cursor:pointer;color:#475569;flex:none}
    #exnPop .exn-f{padding:2px 0 6px}
    #exnPop .exn-f + .exn-f{border-top:1px solid rgba(124,58,237,.14);padding-top:8px;margin-top:2px}
    #exnPop .exn-tt{font-size:12.5px;font-weight:700;color:#6d28d9;margin:2px 0 4px;letter-spacing:.2px}
    #exnPop .exn-pts{list-style:none;margin:0;padding:0}
    #exnPop .exn-pts li{position:relative;padding:6px 0 6px 18px;font-size:16px;line-height:1.6}
    #exnPop .exn-pts li::before{content:"";position:absolute;left:3px;top:15px;width:7px;height:7px;border-radius:50%;background:linear-gradient(135deg,#a78bfa,#6366f1)}
    #exnPop .exn-pts li + li{border-top:1px solid rgba(148,163,184,.18)}
    #exnPop mark.exn-em{background:linear-gradient(180deg,transparent 52%,rgba(167,139,250,.42) 52%);color:#3b0764;font-weight:700;padding:0 2px;border-radius:2px}
    #exnPop mark.exn-rk{background:linear-gradient(180deg,transparent 52%,rgba(248,113,113,.34) 52%);color:#991b1b;font-weight:700;padding:0 2px;border-radius:2px}
    #exnPop .exn-mine{margin-top:4px}
    #exnPop .exn-note{font-size:14.5px;line-height:1.55;color:#1e1b4b;background:rgba(250,204,21,.16);border-left:3px solid #f59e0b;border-radius:8px;padding:6px 10px;margin:4px 0;white-space:pre-wrap}
    #exnPop .exn-nb{border:none;background:none;color:#6d28d9;font:inherit;font-size:13px;font-weight:600;padding:4px 2px;cursor:pointer}
    #exnPop .exn-st{font-size:11.5px;margin-left:8px}
    #exnPop textarea{width:100%;min-height:60px;border:1px solid rgba(167,139,250,.6);border-radius:10px;padding:8px 10px;font:inherit;font-size:16px;line-height:1.5;resize:vertical;margin-top:4px;background:rgba(255,255,255,.75);box-sizing:border-box}
    #exnPop textarea:focus{outline:2px solid #a78bfa;border-color:#a78bfa}
    #exnPop .exn-msg{font-size:13px;color:#64748b;background:rgba(241,245,249,.7);border-radius:9px;padding:8px 10px;margin:6px 0}
    .exn-err{font-size:13px;color:#b91c1c;background:#fef2f2;border-radius:9px;padding:8px 10px;margin:6px 0}
    body.exn-tap .exn-scope [data-exn]{cursor:pointer}
    .exn-hl{outline:2px solid rgba(124,58,237,.7)!important;outline-offset:4px;border-radius:14px;box-shadow:0 0 0 7px rgba(124,58,237,.10)!important;transition:box-shadow .15s}
    @media print{#exnFab,#exnMenu,#exnPop{display:none!important}}`;
    document.head.appendChild(s);
  }
  function exnHoverDev(){ try{ return window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches; }catch(e){ return false; } }

  function exnRenderFab(){
    const root = document.getElementById("exnRoot");
    if(!root || !exnIsPresenter()) return;
    let fab = document.getElementById("exnFab");
    if(!fab){ fab = document.createElement("button"); fab.id = "exnFab"; fab.type = "button"; fab.onclick = exnToggleMenu; root.appendChild(fab); }
    const S = exnState(), ctx = S.ctx, on = exnTapGet();
    const notes = ctx ? (S.notes[ctx.period] || {}) : {};
    const n = Object.values(notes).filter(x => x.note && x.note.trim()).length;
    fab.className = on ? "" : "off";
    // แคสหน้าจอ (present_sync.js): ป้ายสถานะท้ายปุ่ม — แบบ Benya "📡 กำลังแคส" / "📡 แคสไม่สำเร็จ" (Benya วางในแผงบทพูด)
    const P = window.Psy, cast = !!(P && P.remoteOn && P.remoteOn()), cs = cast && P.status ? P.status() : null;
    const castBad = !!(cs && cs.ok === false);
    fab.title = "บทวิเคราะห์ผู้นำเสนอ (เห็นเฉพาะบัญชีนี้)" + (cast ? (castBad ? "\nแคสหน้าจอไม่สำเร็จ: " + (cs.msg || "") : "\nกำลังแคสหน้าจอ — จอที่เปิด \"โหมดแคสหน้าจอ\" แสดงตามหน้าจอนี้") : "");
    fab.textContent = "✦ " + (on ? (exnHoverDev() ? "ชี้กรอบเพื่อดูบทวิเคราะห์" : "แตะกรอบเพื่อดูบทวิเคราะห์") : "บทวิเคราะห์ (ปิดอยู่)") + (n ? " · โน้ต " + n : "") + (cast ? (castBad ? " · 📡 แคสไม่สำเร็จ" : " · 📡 แคสอยู่") : "");
  }
  function exnCloseMenu(){ const m = document.getElementById("exnMenu"); if(m) m.remove(); }
  function exnToggleMenu(){
    if(document.getElementById("exnMenu")){ exnCloseMenu(); return; }
    exnClosePop();
    const root = document.getElementById("exnRoot"); if(!root) return;
    const C = exnContext(); if(!C) return;
    const S = exnState(), notes = S.notes[C.period] || {}, on = exnTapGet();
    const esc2 = s => (typeof esc === "function" ? esc(s) : String(s));
    const defs = C.tab ? C.defs.filter(f => f.tab === C.tab).concat(C.defs.filter(f => f.tab !== C.tab)) : C.defs;
    const m = document.createElement("div"); m.id = "exnMenu";
    const P = window.Psy, cast = !!(P && P.remoteOn && P.remoteOn()), cs = cast && P.status ? P.status() : null;
    m.innerHTML = `<div class="exn-mt">${esc2(C.scopeLbl)} · เห็นเฉพาะบัญชีนี้</div>
      ${P ? `<div class="exn-sw ${cast ? "on" : ""}" onclick="Exn.exnPsyToggle()"><span>📡 แคสหน้าจอไปจอใหญ่ (จอที่เปิด "โหมดแคสหน้าจอ" แสดงตาม)</span><i></i></div>` : ""}
      ${cs && cs.ok === false ? `<div class="exn-err">แคสหน้าจอไม่สำเร็จ: ${esc2(cs.msg || "")}</div>` : ""}
      <div class="exn-sw ${on ? "on" : ""}" onclick="Exn.exnSetTap(${on ? "false" : "true"})"><span>${exnHoverDev() ? "ชี้" : "แตะ"}กรอบเพื่อดูบทวิเคราะห์</span><i></i></div>
      ${S.err ? `<div class="exn-err">${esc2(S.err)}</div>` : ""}
      ${defs.map(f => `<button type="button" class="exn-it ${notes[f.key] && notes[f.key].note && notes[f.key].note.trim() ? "has" : ""}" onclick="Exn.exnOpenFromMenu('${f.key}')"><b>${esc2(f.title)}</b><small>${esc2(f.group || "")}</small></button>`).join("")}`;
    root.appendChild(m);
  }
  function exnSetTap(v){ exnTapSet(!!v); document.body.classList.toggle("exn-tap", !!v); exnRenderFab(); exnCloseMenu(); exnToggleMenu(); }
  function exnOpenFromMenu(key){
    exnCloseMenu();
    const S0 = exnState(), def = exnFrameDefs().find(f => f.key === key);
    if(S0.ctx && S0.ctx.kind === "exec" && def && def.tab && (edState().tab || "summary") !== def.tab){
      edSetTab(def.tab);
      setTimeout(() => exnOpenFromMenu(key), 500);
      return;
    }
    exnBindTargets();
    const el = (EXN.scope ? EXN.scope.querySelector(`[data-exn~="${key}"]`) : null);
    if(el){
      el.scrollIntoView({ block:"center", behavior:"smooth" });
      setTimeout(() => { const r = el.getBoundingClientRect(); exnOpenPop([key], r.left + Math.min(r.width, 500) / 2, r.top + Math.min(r.height, 200) / 2, el, { pin:true }); }, 380);
    } else {
      exnOpenPop([key], window.innerWidth / 2, window.innerHeight * 0.3, null, { pin:true });
    }
  }

  function exnClosePop(){
    const p = document.getElementById("exnPop");
    if(p){
      p.querySelectorAll("textarea[data-key]").forEach(t => { if(exnState().typing[exnTypingKey(t.getAttribute("data-period"), t.getAttribute("data-key"))] != null) exnSave(t); });
      p.remove();
    }
    document.querySelectorAll(".exn-hl").forEach(el => el.classList.remove("exn-hl"));
    window._exnPopKeys = null; window._exnPin = false; window._exnEdit = {}; window._exnHoverEl = null;
  }
  function exnPopHtml(keys){
    const C = exnContext(); if(!C) return "";
    const S = exnState(), notes = S.notes[C.period] || {}, typing = S.typing || {}, edit = window._exnEdit || {};
    const esc2 = s => (typeof esc === "function" ? esc(s) : String(s));
    const defs = keys.map(k => C.defs.find(f => f.key === k)).filter(Boolean);
    const body = defs.map(f => {
      const dr = C.drafts ? C.drafts[f.key] : null;
      const pts = dr && dr.say ? (Array.isArray(dr.say) ? dr.say : [dr.say]).filter(Boolean) : [];
      const tk = exnTypingKey(C.period, f.key);
      const saved = (notes[f.key] && notes[f.key].note) || "";
      const open = typing[tk] != null || edit[tk];
      const val = typing[tk] != null ? typing[tk] : saved;
      const ph = dr && dr.prompts && dr.prompts.length ? dr.prompts.join(" · ") : "พิมพ์สิ่งที่อยากพูดเพิ่มในกรอบนี้";
      const sid = "exnSt_" + f.key.replace(/\./g,"_");
      return `<div class="exn-f">
        <div class="exn-tt">${esc2(f.title)}</div>
        ${pts.length ? `<ul class="exn-pts">${pts.map(s => `<li>${exnFmtSay(s)}</li>`).join("")}</ul>` : `<div class="exn-msg">${C.drafts ? "กรอบนี้ไม่มีบทวิเคราะห์สำหรับช่วงที่เลือก" : C.noDraftMsg}</div>`}
        <div class="exn-mine">
          ${saved.trim() && !open ? `<div class="exn-note">${esc2(saved)}</div>` : ""}
          ${open
            ? `<textarea data-key="${f.key}" data-period="${esc2(C.period)}" placeholder="${esc2(ph)}" oninput="Exn.exnInput(this)" onblur="Exn.exnSave(this)">${esc2(val)}</textarea><span id="${sid}" class="exn-st" style="color:${typing[tk] != null ? "#b45309" : "#047857"}">${typing[tk] != null ? "ยังไม่บันทึก" : (saved ? "บันทึกแล้ว" : "")}</span>`
            : `<button type="button" class="exn-nb" onclick="Exn.exnEditNote('${f.key}')">✎ ${saved.trim() ? "แก้โน้ตของฉัน" : "เพิ่มโน้ตของฉัน"}</button>`}
        </div>
      </div>`;
    }).join("");
    return `<div class="exn-ph"><span class="exn-badge">✦ บทวิเคราะห์</span><span class="exn-sc">${esc2(C.scopeLbl)}</span><button type="button" class="exn-x" onclick="Exn.exnClosePop()" title="ปิด">×</button></div>
      ${S.err ? `<div class="exn-err">${esc2(S.err)}</div>` : ""}${body}`;
  }
  function exnAutosize(p){ p.querySelectorAll("textarea[data-key]").forEach(t => { t.style.height = "auto"; t.style.height = Math.max(60, t.scrollHeight + 2) + "px"; }); }
  function exnEditNote(key){
    const C = exnContext(); if(!C) return;
    (window._exnEdit = window._exnEdit || {})[exnTypingKey(C.period, key)] = true;
    window._exnPin = true;
    const p = document.getElementById("exnPop"), k = window._exnPopKeys;
    if(!p || !k) return;
    p.innerHTML = exnPopHtml(k.keys); exnAutosize(p);
    exnPlace(p, k.el, k.x, k.y);
    const t = p.querySelector(`textarea[data-key="${key}"]`); if(t) t.focus();
  }
  /* วางกล่องข้างกรอบ: เลือกตำแหน่งที่ทับกรอบน้อยที่สุด · ไม่ทับจุดที่ชี้ · ใกล้จุดที่ชี้ที่สุด */
  function exnPlace(p, el, x, y){
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const g = 14, pad = 10;
    p.style.maxHeight = "";
    const w = p.offsetWidth;
    let h = p.offsetHeight;
    const cx = v => Math.min(Math.max(pad, v), vw - w - pad), cy = v => Math.min(Math.max(pad, v), vh - h - pad);
    const r = el ? el.getBoundingClientRect() : null;
    const put = (L, T) => { p.style.left = L + "px"; p.style.top = T + "px"; };
    if(r){
      const vr = { l: Math.max(0, r.left), t: Math.max(0, r.top), r: Math.min(vw, r.right), b: Math.min(vh, r.bottom) };
      // 1) ข้างกรอบ (ขวาก่อน แล้วซ้าย) — ไม่ทับกรอบเลย
      if(vw - pad - (vr.r + g) >= w) return put(vr.r + g, cy(y - h / 2));
      if((vr.l - g) - pad >= w) return put(vr.l - g - w, cy(y - h / 2));
      // 2) กรอบกว้างเต็มแถว → วางเหนือ/ใต้กรอบฝั่งที่ว่างมากกว่า และจำกัดความสูงให้พอดีช่อง (เลื่อนอ่านในกล่อง)
      const below = vh - pad - (vr.b + g), above = (vr.t - g) - pad, space = Math.max(below, above);
      if(space >= 170){
        if(h > space){ p.style.maxHeight = space + "px"; h = p.offsetHeight; }
        return put(cx(x - w / 2), below >= above ? vr.b + g : vr.t - g - h);
      }
    }
    const cands = [];
    if(r){
      cands.push([r.right + g, y - h / 2], [r.left - g - w, y - h / 2], [x - w / 2, r.bottom + g], [x - w / 2, r.top - g - h]);
      cands.push([r.right + g, r.top], [r.left - g - w, r.top]);
    }
    cands.push([x + 24, y + 24], [x - w - 24, y + 24], [x + 24, y - h - 24], [x - w - 24, y - h - 24]);
    cands.push([vw - w - pad, pad], [pad, pad], [vw - w - pad, vh - h - pad], [pad, vh - h - pad]);
    const vis = r ? { l: Math.max(0, r.left), t: Math.max(0, r.top), r: Math.min(vw, r.right), b: Math.min(vh, r.bottom) } : null;
    let best = null;
    for(const [l0, t0] of cands){
      const L = cx(l0), T = cy(t0);
      let ov = 0;
      if(vis){ const ox = Math.max(0, Math.min(L + w, vis.r) - Math.max(L, vis.l)), oy = Math.max(0, Math.min(T + h, vis.b) - Math.max(T, vis.t)); ov = ox * oy; }
      const onPtr = (x >= L - 20 && x <= L + w + 20 && y >= T - 20 && y <= T + h + 20) ? 1e9 : 0;
      const score = ov * 4 + onPtr + Math.hypot(L + w / 2 - x, T + h / 2 - y);
      if(!best || score < best.s) best = { s: score, L, T };
    }
    p.style.left = best.L + "px"; p.style.top = best.T + "px";
  }
  function exnOpenPop(keys, x, y, frameEl, opt){
    const C = exnContext(); if(!C) return false;
    keys = keys.filter(k => C.defs.some(f => f.key === k));
    if(!keys.length) return false;
    exnClosePop(); exnCloseMenu();
    const root = document.getElementById("exnRoot"); if(!root) return false;
    const p = document.createElement("div"); p.id = "exnPop";
    p.innerHTML = exnPopHtml(keys);
    p.style.visibility = "hidden"; p.style.left = "0px"; p.style.top = "0px";
    root.appendChild(p);
    exnAutosize(p);
    exnPlace(p, frameEl, x, y);
    p.style.visibility = "";
    if(frameEl) frameEl.classList.add("exn-hl");
    window._exnPopKeys = { keys, x, y, el: frameEl, top: frameEl ? frameEl.getBoundingClientRect().top : 0 };
    window._exnPin = !!(opt && opt.pin);
    if (window.Psy && window.Psy.push) window.Psy.push();   // แคสหน้าจอ: ส่งตำแหน่งปัจจุบัน (กรอบที่เปิดกล่องได้ก่อน)
    window._exnHoverEl = (opt && opt.hover) ? frameEl : null;
    return true;
  }
  /* วาดเนื้อหาป๊อปอัพใหม่ (เช่น หลังโหลดโน้ตเสร็จ) โดยไม่ย้ายตำแหน่ง */
  function exnRefreshPop(){
    const p = document.getElementById("exnPop"), k = window._exnPopKeys;
    if(!p || !k) return;
    if(p.contains(document.activeElement)) return;   // กำลังพิมพ์อยู่ — ไม่วาดทับ
    p.innerHTML = exnPopHtml(k.keys); exnAutosize(p);
  }

  /* เปิดกล่อง: คอมพิวเตอร์ = ชี้ค้าง · ไอแพด = แตะ (ดักที่ document ช่วง capture ก่อน onclick เดิมของกรอบ)
     ★ ไม่ดักปุ่ม/ช่องกรอก/ลิงก์ในกรอบ — ปุ่มบนหน้ายังกดได้ตามปกติ · ปิดโหมดได้ที่ปุ่ม ✦ */
  const EXN_SKIP = "button,a,input,select,textarea,label,summary,option,[contenteditable],.ed-tabs,.fin-btn,.bs-tabs";
  let _exnBindAt = 0, _exnOpenT = null, _exnCloseT = null;
  function exnFrameAt(t){
    const main = EXN.scope;   // ★ POG: กรอบอยู่ในหน้าปัจจุบัน (Benya ใช้กล่อง main ของหน้า)
    if(!main || !t || !main.contains(t)) return null;
    let el = t.closest("[data-exn]");
    if(!el && Date.now() - _exnBindAt > 800){ _exnBindAt = Date.now(); exnBindTargets(); el = t.closest("[data-exn]"); }
    return el && main.contains(el) ? el : null;
  }
  function exnInstallClick(){
    if(window._exnClickInstalled) return;
    window._exnClickInstalled = true;
    document.addEventListener("keydown", e => { if(e.key === "Escape" && document.getElementById("exnPop")) exnClosePop(); });
    /* ชี้ค้าง (เฉพาะอุปกรณ์ที่มีเมาส์) */
    document.addEventListener("mouseover", e => {
      if(!exnHoverDev() || !exnIsPresenter() || !exnTapGet() || !document.getElementById("exnRoot")) return;
      const t = e.target, pop = document.getElementById("exnPop"), menu = document.getElementById("exnMenu"), fab = document.getElementById("exnFab");
      if(pop && pop.contains(t)){ clearTimeout(_exnCloseT); clearTimeout(_exnOpenT); return; }
      if((menu && menu.contains(t)) || (fab && fab.contains(t))) return;
      const el = exnFrameAt(t);
      if(!el){
        clearTimeout(_exnOpenT);
        if(pop && !window._exnPin && !pop.contains(document.activeElement)){ clearTimeout(_exnCloseT); _exnCloseT = setTimeout(exnClosePop, 380); }
        return;
      }
      clearTimeout(_exnCloseT);
      if(pop && window._exnHoverEl === el) return;
      if(pop && (window._exnPin || pop.contains(document.activeElement))) return;
      clearTimeout(_exnOpenT);
      const x = e.clientX, y = e.clientY;
      _exnOpenT = setTimeout(() => {
        const keys = (el.getAttribute("data-exn") || "").split(/\s+/).filter(Boolean);
        if(document.body.contains(el)) exnOpenPop(keys, x, y, el, { hover:true });
      }, pop ? 140 : 280);
    }, true);
    /* เลื่อนหน้า = ปิดกล่องที่เปิดจากการชี้ */
    window.addEventListener("scroll", () => {   // ปิดเฉพาะเมื่อกรอบเลื่อนไปจริง (หน้าขยับเล็กน้อยตอนตัวเลขวิ่ง/วาดกราฟ ไม่นับ)
      const p = document.getElementById("exnPop"), k = window._exnPopKeys;
      if(!p || !k || !k.el || !window._exnHoverEl || window._exnPin || p.contains(document.activeElement)) return;
      if(Math.abs(k.el.getBoundingClientRect().top - k.top) > 80) exnClosePop();
    }, true);
    document.addEventListener("click", e => {
      if(!exnIsPresenter() || !document.getElementById("exnRoot")) return;
      const t = e.target;
      const pop = document.getElementById("exnPop"), menu = document.getElementById("exnMenu"), fab = document.getElementById("exnFab");
      if(pop && pop.contains(t)){ window._exnPin = true; return; }
      if((menu && menu.contains(t)) || (fab && fab.contains(t))) return;
      if(!exnHoverDev() && exnTapGet() && !t.closest(EXN_SKIP)){
        const el = exnFrameAt(t);
        if(el){
          const keys = (el.getAttribute("data-exn") || "").split(/\s+/).filter(Boolean);
          if(exnOpenPop(keys, e.clientX, e.clientY, el, { pin:true })){ e.preventDefault(); e.stopPropagation(); return; }
        }
      }
      if(pop) exnClosePop();
      if(menu) exnCloseMenu();
    }, true);
  }

  /* ปุ่ม/ช่องในกล่องเรียกผ่าน window.Exn.<ชื่อ> · หน้าเรียก window.exnMount / exnMountFin / exnUnmount */
  window.Exn = { exnClosePop, exnEditNote, exnInput, exnOpenFromMenu, exnSave, exnSetTap, exnPsyToggle,
    exnBindTargets, exnRenderFab };   // ↑ 2 ตัวท้ายให้ present_sync.js (ติดป้ายกรอบบนจอทีวี · ป้ายสถานะแคสบนปุ่ม ✦)
  window.exnMount = exnMount; window.exnMountFin = exnMountFin; window.exnUnmount = exnUnmount;
})();
