/* bd_avg_forecast.jsx — 💰 แผนเงินสดล่วงหน้า · การ์ดในหน้า Bank Daily (BIO)
 *
 *   ★ พอร์ตจาก WTP (waterpog-fin frontend/app/bd_avg_forecast.jsx · 2026-10-20) — แก้ฝั่งไหนให้ตามอีกฝั่ง
 *     ต่างจาก WTP เฉพาะจุดที่ข้อมูล BIO ต่าง:
 *       · ไฟล์ Cash Flow ของ BIO ไม่มีรหัสค่าใช้จ่าย → แถว = ชื่อหมวด (เรียงตามชื่อ) · นับเฉพาะ "หมวดฝั่งจ่าย"
 *         (ยอดออกทั้งไฟล์ ≥ ยอดเข้า) · รับคืนในหมวดจ่ายหักกลบ · ไม่นับโอนระหว่างบัญชี
 *       · 4 หมวด จากชื่อหมวด/ประเภทกิจกรรม (bdafCodeCat) — ตั้งตามที่ผู้ใช้จัดจริงใน WTP: เบ็ดเตล็ด = เงินเดือนเท่านั้น
 *       · เงินเข้า: ใบแจ้งหนี้จาก arList ของหน้า (ivBuildRows) · แผนรับผูกกับใบด้วย id (arList[].plan) ไม่ใช่เลขที่ใบ
 *       · ไม่มีบัญชีหลักให้เลือก → เงินตั้งต้น = ยอดใช้ได้ทุกบัญชี · cache Cash Flow = 'bio-cfpresent-v1'
 *
 *   ตอบคำถามเดียว: "ต้องหาเงินหมุนเวียนเข้ามาช่วงไหน เท่าไร ให้พอจ่าย"
 *     เงินต้นเดือน (ยอดเงินใช้ได้ตอนนี้) + เงินเข้าคาดรับจริง − ค่าใช้จ่ายประมาณการ = ปลายเดือน
 *     จุดต่ำสุดระหว่างเดือน (เรียงตามวันที่มักจ่าย/วันคาดรับ) ต่ำกว่าเงินสำรองขั้นต่ำเมื่อไร = ต้องหาเงินเพิ่มก่อนวันนั้น
 *   เงินเข้า = ของที่รอรับจริง: ใบ "กำลังติดตาม" ที่มีวันคาดรับ (เลยวันแล้ว → นับวันนี้) · แผนรับใน Bank Daily · รับอื่นๆ ที่คีย์ไว้
 *     ไม่นับแต่โชว์ให้เห็น: รอใบตรวจรับ · ติดปัญหา · ไม่มีวันคาดรับ · คาดรับหลังเดือนสุดท้ายที่ดู
 *   เงินออก = ประมาณการจากจ่ายจริงในข้อมูล Cash Flow (ตาราง cashflowPresent) · เดือนที่จบแล้วและมีในไฟล์
 *     · วันที่ในเดือน = การกระจายวันจ่ายจริงในอดีตของหมวดนั้น → เดือนนี้นับเฉพาะส่วนที่ปกติจ่ายหลังวันนี้
 *   2 วิธีคิด: 📊 ค่าเฉลี่ย / 🤖 วิเคราะห์อัตโนมัติ (คิดในเบราว์เซอร์) · ข้อความที่ผู้ใช้เห็นเป็นภาษาปกติ ไม่ใช้ศัพท์ระบบ
 *   ที่แก้เอง = แชร์ทั้งทีม (manualOverrides · ไม่แตะ forecastEntries/AP/ไฟล์ Cash Flow):
 *     bd.afc.<lineKey> = JSON { m, base, off, pin, cat, def, lock } · lineKey: c:<ชื่อหมวด> · o:<หมวด> · u:<id>
 *     lock = { by, at, until } "ตกลงแล้ว" · bd.afcfg = { buffer } เงินสำรองขั้นต่ำ
 *   ★ ชื่อ global ขึ้นต้น bdaf / BDAF — ทุกไฟล์ .jsx แชร์ scope เดียวกัน
 */
'use strict';

const BDAF_LS        = 'bio.bd.afc';
const BDAF_PREFIX    = 'bd.afc.';
const BDAF_CFG_KEY   = 'bd.afcfg';
const BDAF_CFP_LS    = 'bio-cfpresent-v1';   // cache ของหน้าพรีเซนต์ Cash Flow (แถวเดียวกัน) — โชว์ก่อนโหลดจาก server เสร็จ
const BDAF_LOOKBACKS = [3, 6, 12];
const BDAF_MIN_AVG   = 5000;      // กลุ่มที่เฉลี่ยต่ำกว่านี้ไม่แยกแถว (รวมไปที่ "อื่นๆ")
const BDAF_MAX_LINES = 25;
const BDAF_COLOR     = { 1: '#2a78d6', 2: '#eb6834', 3: '#1baf7a', 4: '#eda100' };
const BDAF_TH_M   = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const BDAF_TH_M_S = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const BDAF_AR_LABEL = { tracking: 'กำลังติดตาม', pending_inspection: 'รอใบตรวจรับ', issue: 'ติดปัญหา', paid: 'รับแล้ว' };
/* หมวดของแถว — BIO ไม่มีรหัส → ดูจากชื่อหมวด/ประเภทกิจกรรม · ย้ายเองได้ในแผนนี้
 *   ตั้งตามที่ผู้ใช้จัดจริงใน WTP (2026-10-20): เบ็ดเตล็ด = เงินเดือนเท่านั้น
 *   (ประกันสังคม · เงินสดย่อย · ทดรองจ่าย · รับรอง · บริจาค · ซื้อสินทรัพย์ ผู้ใช้ย้ายไปดำเนินงานหมด) */
function bdafCodeCat(g, name, act) {
  const t = String(name || '');
  if (/เงินเดือน|โบนัส/.test(t)) return 4;
  if (act === 'fin' || /ดอกเบี้ย|ค่าธรรมเนียมธนาคาร|เงินกู้|ลีส|เช่าซื้อ|คืนเงินต้น/.test(t)) return 3;
  if (/โครงการ|ติดตั้ง|จ้างเหมา|ผู้รับเหมา/.test(t)) return 2;
  return 1;
}

/* ── เดือน/วัน ─────────────────────────────────────────────────────── */
function bdafAddM(mk, n) {
  const d = new Date(+mk.slice(0, 4), +mk.slice(5, 7) - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function bdafDiffM(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }   // b − a
function bdafRange(a, b) {
  const out = [];
  if (!a || !b) return out;
  for (let k = a; k <= b && out.length < 120; k = bdafAddM(k, 1)) out.push(k);
  return out;
}
function bdafDim(mk) { return new Date(+mk.slice(0, 4), +mk.slice(5, 7), 0).getDate(); }
function bdafMShort(mk) { return BDAF_TH_M_S[+mk.slice(5, 7) - 1] + ' ' + String((+mk.slice(0, 4) + 543) % 100).padStart(2, '0'); }
function bdafMFull(mk)  { return BDAF_TH_M[+mk.slice(5, 7) - 1] + ' ' + (+mk.slice(0, 4) + 543); }
function bdafDShort(iso) { return iso ? (+iso.slice(8, 10)) + ' ' + bdafMShort(iso.slice(0, 7)) : ''; }

/* ── สถิติ/ตัวเลข ──────────────────────────────────────────────────── */
function bdafMean(a)   { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function bdafMedian(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
function bdafStd(a) { const m = bdafMean(a); return Math.sqrt(bdafMean(a.map(v => (v - m) * (v - m)))); }
function bdafN(n)   { return n ? fmtNum(Math.round(n), 0) : '–'; }
function bdafC(n)   { return fmtMoney(n || 0, { compact: true }); }

/* ── ค่าตั้ง ───────────────────────────────────────────────────────── */
function bdafLoadPrefs() { try { return JSON.parse(localStorage.getItem(BDAF_LS) || '{}') || {}; } catch (_) { return {}; } }
function bdafSavePrefs(p) { try { localStorage.setItem(BDAF_LS, JSON.stringify(p)); } catch (_) {} }
function bdafReadCfg(rows) {
  const r = (rows || []).find(x => x && x.key === BDAF_CFG_KEY);
  if (!r) return {};
  try { const o = typeof r.value === 'string' ? JSON.parse(r.value) : r.value; return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; }
}

/* ── จ่ายจริงจากข้อมูล Cash Flow → ยอดรายเดือนต่อกลุ่มรหัส ─────────────────── */
function bdafCollectCf(txns, codeGroups, today) {
  const cm = today.slice(0, 7);
  const groups = {};        // key → { key, code, name, act, m:{เดือน:ยอด}, dayW:{วัน:ยอด}, subs:{หมวดย่อย:ยอด}, tx:[บรรทัดจ่ายจริง] }
  const months = {};        // เดือนที่มีข้อมูลในไฟล์ (นับทุกบรรทัด) — เดือนที่ไม่มีเลยไม่ถือเป็น 0
  // BIO: ไฟล์ไม่มีรหัสค่าใช้จ่าย → หมวดฝั่งจ่าย = หมวดที่ยอดออกทั้งไฟล์ ≥ ยอดเข้า (หมวดรับที่มีถอนคืนบ้างจะไม่หลุดมาเป็นค่าใช้จ่าย)
  const catIO = {};
  (txns || []).forEach(t => {
    if (!t || t.actKey === 'transfer') return;
    const c = t.category || '(ไม่ระบุหมวด)', x = catIO[c] || (catIO[c] = { o: 0, i: 0 }), fl = Number(t.flow) || 0;
    if (fl < 0) x.o -= fl; else x.i += fl;
  });
  const payCat = {};
  Object.keys(catIO).forEach(c => { if (catIO[c].o > 0 && catIO[c].o >= catIO[c].i) payCat[c] = true; });
  (txns || []).forEach(t => {
    if (!t || !t.iso) return;
    const flow = Number(t.flow) || 0;
    if (!flow) return;
    const mk = String(t.iso).slice(0, 7);
    if (mk >= cm) return;                                   // เดือนนี้ยังไม่จบ → ไม่ใช้เป็นฐาน
    months[mk] = true;
    if (t.actKey === 'transfer') return;
    const code = String(t.code || '').trim();
    const g = (code.match(/^(\d{4,6})/) || [])[1] || '';
    if (g) { const d = +g.charAt(0); if (d === 0 || d % 2 === 1) return; }   // รหัสฝั่งรับ (หลักแรกคี่) / โอน (0)
    else if (!payCat[t.category || '(ไม่ระบุหมวด)']) return;  // ไม่มีรหัส → เฉพาะหมวดฝั่งจ่าย (รับคืนในหมวดเดียวกันหักกลบ)
    const key = g ? 'g:' + g : 'c:' + (t.category || '(ไม่ระบุหมวด)');
    const gr = groups[key] || (groups[key] = { key, code: g, name: '', act: t.actKey, m: {}, dayW: {}, subs: {}, tx: [] });
    const amt = -flow;                                      // จ่าย = บวก · รับคืนในหมวดจ่าย = ลบ (หักกลบ)
    gr.m[mk] = (gr.m[mk] || 0) + amt;
    const day = +String(t.iso).slice(8, 10);
    if (amt > 0 && day) gr.dayW[day] = (gr.dayW[day] || 0) + amt;
    const sub = t.category || code || '—';
    gr.subs[sub] = (gr.subs[sub] || 0) + amt;
    gr.tx.push({ iso: String(t.iso).slice(0, 10), mk, doc: t.docNo || '', note: t.note || t.vender || '', vender: t.vender || '', code, sub, acct: t.account || '', amt, g: gr });
  });
  const dict = Object.assign({}, window.CFP_CODE_GROUPS || {}, codeGroups || {});
  Object.keys(groups).forEach(k => {
    const gr = groups[k];
    const topSub = Object.keys(gr.subs).sort((a, b) => gr.subs[b] - gr.subs[a])[0];
    gr.name = (gr.code && dict[gr.code]) || topSub || k.slice(2);
  });
  return { cm, today, groups, dataMonths: Object.keys(months).sort() };
}

/* ── จ่ายเป็นรอบ (ทุก 2/3/4/6/12 เดือน) — ดูจากเดือนที่มีข้อมูล 24 เดือนล่าสุด ── */
function bdafPeriodic(mmap, FULL, cm) {
  if (FULL.length < 4) return null;
  const hit = FULL.filter(mk => (mmap[mk] || 0) > 0);
  if (hit.length < 2 || hit.length / FULL.length > 0.6) return null;
  const gaps = hit.slice(1).map((mk, i) => bdafDiffM(hit[i], mk));
  const p = gaps[gaps.length - 1];
  if ([2, 3, 4, 6, 12].indexOf(p) < 0) return null;
  const tol = p >= 6 ? 1 : 0;
  if (!gaps.every(g => Math.abs(g - p) <= tol)) return null;
  if (hit.length < (p === 12 ? 2 : 3)) return null;
  const amts = hit.slice(-3).map(mk => mmap[mk]);
  const mn = Math.min.apply(null, amts), mx = Math.max.apply(null, amts);
  if (!(mn > 0) || mx / mn > 3) return null;              // ยอดแต่ละรอบต่างกันมาก = ไม่ใช่ค่าใช้จ่ายรอบเดียวกัน
  const last = hit[hit.length - 1];
  if (bdafDiffM(last, cm) > p + tol + 2) return { p, ended: true, last, n: hit.length };
  let next = bdafAddM(last, p);
  const late = next < cm;
  if (late) next = cm;
  return { p, amt: bdafMedian(amts), cv: bdafStd(amts) / bdafMean(amts), last, next, late, n: hit.length };
}

/* ── เดือนเดียวกันของปีก่อน (เฉพาะกลุ่มที่จ่ายประจำทั้งปี) ─────────────────── */
function bdafSeasonWin(mk0, mmap, first, last) {
  let end = bdafAddM(mk0, 5);
  if (end > last) end = last;
  const start = bdafAddM(end, -11);
  if (start < first) return null;
  const mks = bdafRange(start, end);
  const wv = mks.map(m => mmap[m] || 0);
  if (wv.filter(v => v > 0).length < 10) return null;
  const base = bdafMedian(wv);
  if (!(base > 0)) return null;
  const rest = mks.filter(m => m !== mk0).map(m => mmap[m] || 0);
  // เดือนนั้นต้องต่างจากปกติชัดกว่าการแกว่งตามธรรมดาของกลุ่มนี้ (ไม่งั้นแค่สุ่มสูงไปเดือนเดียว)
  const need = Math.max(0.3, 2 * (bdafStd(rest) / (bdafMean(rest) || 1)));
  const r = (mmap[mk0] || 0) / base;
  return Math.abs(r - 1) >= need ? r : null;
}
function bdafSeason(mk, mmap, first, last) {
  // เดือนเดียวกันของปีล่าสุดที่จบแล้ว (ประมาณการเกิน 12 เดือน → ถอยไปอีกปี · เดือนนี้/อนาคต = ยังไม่มีข้อมูล ไม่ใช่ 0)
  let ly = bdafAddM(mk, -12);
  while (ly > last) ly = bdafAddM(ly, -12);
  if (ly < first) return null;
  const r1 = bdafSeasonWin(ly, mmap, first, last);
  if (r1 == null) return null;
  let f = 1 + (r1 - 1) * 0.5, two = false;               // เห็นปีเดียว → เผื่อแค่ครึ่งเดียว
  const ly2 = bdafAddM(ly, -12);
  if (ly2 >= first) {
    const r2 = bdafSeasonWin(ly2, mmap, first, last);
    if (r2 != null && (r1 > 1) === (r2 > 1)) { f = (r1 + r2) / 2; two = true; }
  }
  if (!two && (r1 > 3 || r1 < 1 / 3)) return null;        // ต่างจากปกติหลายเท่าแต่เห็นปีเดียว = งานครั้งเดียว ไม่ใช่ฤดูกาล
  return { f: Math.min(2.5, Math.max(0.5, f)), r1, two, ly };
}

/* ── 🤖 วิเคราะห์อัตโนมัติ — คืนยอดรายเดือน (เต็มเดือน) + เหตุผลภาษาไทย ─────────── */
function bdafAuto(o) {
  const { rich, s, mmap, H, F, FULL, cm, first, last, per } = o;
  const N = s.length;
  const out = { vals: {}, notes: [], badges: [], conf: 'mid', spikes: [], key: '' };   // key = เหตุผลหลักประโยคเดียว
  const put = (fn) => F.forEach(mk => { out.vals[mk] = Math.max(0, Math.round(fn(mk))); });
  if (!N) { put(() => 0); out.conf = 'low'; out.notes.push('ยังไม่เคยจ่ายในช่วงเดือนที่ใช้คิด'); out.key = 'ยังไม่เคยจ่ายในช่วงเดือนที่ใช้คิด'; return out; }
  const nzv = s.filter(v => v > 0);
  const freq = nzv.length / N;

  // ① จ่ายเป็นรอบ — ลงยอดเฉพาะเดือนที่ถึงรอบ ไม่เกลี่ยทุกเดือน
  if (rich && per) {
    if (per.ended) {
      put(() => 0);
      out.badges.push({ t: '✕ หยุดจ่าย?' });
      out.notes.push('เคยจ่ายทุก ' + per.p + ' เดือน (ล่าสุด ' + bdafMShort(per.last) + ') แต่เลยรอบมานานแล้ว — ถือว่าหยุดจ่าย ถ้ายังมีอยู่ให้แก้ยอดเอง');
      out.key = 'เคยจ่ายเป็นรอบ แต่ไม่ได้จ่ายมานานแล้ว (ล่าสุด ' + bdafMShort(per.last) + ') — ถือว่าหยุดจ่าย';
      out.conf = 'low';
      return out;
    }
    put(mk => (mk >= per.next && bdafDiffM(per.next, mk) % per.p === 0) ? per.amt : 0);
    out.badges.push({ t: '⟳ ทุก ' + per.p + ' ด.' });
    out.notes.push('จ่ายเป็นรอบทุก ' + per.p + ' เดือน (เห็น ' + per.n + ' ครั้ง ล่าสุด ' + bdafMShort(per.last) + ') → ครั้งถัดไป '
      + bdafMShort(per.next) + ' ราว ' + fmtNum(per.amt, 0) + ' บาท' + (per.late ? ' (เลยรอบมาแล้วยังไม่เห็นจ่าย จึงใส่ไว้เดือนนี้)' : ''));
    out.key = 'จ่ายทุก ' + per.p + ' เดือน — ครั้งถัดไป ' + bdafMShort(per.next) + ' ราว ' + fmtNum(per.amt, 0) + ' บาท';
    out.conf = per.cv <= 0.15 ? 'high' : 'mid';
    return out;
  }

  // ② หยุดจ่ายแล้ว — เคยจ่ายแทบทุกเดือน แต่ 3 เดือนล่าสุดไม่มีเลย
  if (rich && FULL.length) {
    const fs = FULL.map(mk => mmap[mk] || 0);
    let tz = 0;
    for (let i = fs.length - 1; i >= 0 && !(fs[i] > 0); i--) tz++;
    let st = 0;
    while (st < fs.length - tz && !(fs[st] > 0)) st++;
    const before = fs.slice(st, fs.length - tz);
    const bf = before.length ? before.filter(v => v > 0).length / before.length : 0;
    if (tz >= 3 && before.length >= 3 && bf >= 0.7) {
      put(() => 0);
      out.badges.push({ t: '✕ หยุดจ่าย?' });
      out.notes.push('เคยจ่ายเกือบทุกเดือน แต่ไม่มีจ่าย ' + tz + ' เดือนล่าสุด (ครั้งล่าสุด ' + bdafMShort(FULL[fs.length - tz - 1])
        + ') — ระบบถือว่าหยุดจ่ายแล้ว ถ้ายังจ่ายอยู่ให้แก้ยอดเอง');
      out.key = 'ไม่ได้จ่ายมา ' + tz + ' เดือนแล้ว — ถือว่าหยุดจ่าย';
      out.conf = 'low';
      return out;
    }
  }

  // ③ จ่ายไม่ทุกเดือน — เฉลี่ยกระจาย (กดครั้งที่ใหญ่ผิดปกติลงก่อน ไม่งั้นงานใหญ่ครั้งเดียวดันทั้งแผน)
  if (freq < 0.5) {
    const med = bdafMedian(nzv);
    const cut = [];
    const capped = s.map((v, i) => { if (nzv.length >= 3 && v > med * 3) { cut.push(i); return med * 3; } return v; });
    const lvl = bdafMean(capped);
    put(() => lvl);
    out.badges.push({ t: '◌ ไม่ได้จ่ายทุกเดือน' });
    out.notes.push('จ่ายแค่ ' + nzv.length + ' จาก ' + N + ' เดือน — เลยเฉลี่ยกระจายให้ทุกเดือน เดือนละ ' + fmtNum(lvl, 0) + ' บาท');
    if (cut.length) {
      out.spikes = cut;
      out.notes.push('⚡ ' + cut.map(i => bdafMShort(H[i]) + ' (' + bdafC(s[i]) + ')').join(', ') + ' จ่ายสูงผิดปกติ — นับให้ไม่เกิน 3 เท่าของครั้งปกติ');
    }
    out.key = 'ไม่ได้จ่ายทุกเดือน (' + nzv.length + ' จาก ' + N + ' เดือน) — เลยเฉลี่ยกระจายให้ทุกเดือน' + (cut.length ? ' (เดือนที่สูงผิดปกตินับไม่เต็ม)' : '');
    out.conf = 'low';
    return out;
  }

  // ④ จ่ายเกือบทุกเดือน — ตัดยอดพิเศษ → ค่าระดับถ่วงเดือนล่าสุด → แนวโน้มแบบชะลอ → ฤดูกาล
  //   ยอดพิเศษวัดจาก "เดือนที่มีจ่าย" เท่านั้น — ถ้านับเดือนที่เป็น 0 ด้วย ค่ากลางจะต่ำจนยอดปกติโดนตัดหมด
  const med = bdafMedian(nzv);
  const mad = bdafMedian(nzv.map(v => Math.abs(v - med)));
  const scale = mad > 0 ? 1.4826 * mad : med * 0.25;
  const cap = med + 3 * scale;
  const spikeK = freq >= 0.85 ? 1.5 : 2;
  const clean = s.map((v, i) => {
    if (nzv.length >= 3 && v > cap && v > med * spikeK) { out.spikes.push(i); return med; }
    return v;
  });
  const wts = clean.map((_, i) => Math.pow(0.5, (N - 1 - i) / 3));       // เดือนที่เก่ากว่า 3 เดือน = น้ำหนักครึ่งหนึ่ง
  const level = clean.reduce((a, v, i) => a + v * wts[i], 0) / wts.reduce((a, v) => a + v, 0);
  const mean = bdafMean(clean);
  let trend = null;
  if (N >= 6 && mean > 0 && nzv.length >= N - 1) {                       // แนวโน้มดูเฉพาะกลุ่มที่จ่ายแทบทุกเดือน
    const mx = (N - 1) / 2;
    let sxy = 0, sxx = 0;
    clean.forEach((v, i) => { sxy += (i - mx) * (v - mean); sxx += (i - mx) * (i - mx); });
    const b = sxx ? sxy / sxx : 0, a = mean - b * mx;
    const ssTot = clean.reduce((acc, v) => acc + (v - mean) * (v - mean), 0);
    const ssRes = clean.reduce((acc, v, i) => acc + Math.pow(v - (a + b * i), 2), 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    const rel = b / mean;
    // ขึ้น/ลงเกิน 25%/เดือน = ผันผวน ไม่ใช่แนวโน้ม → ไม่ต่อเส้น
    if (Math.abs(rel) >= 0.03 && Math.abs(rel) <= 0.25 && r2 >= 0.5) trend = { b, r2, rel, base: a + b * (N - 1) };
  }
  const maxC = Math.max.apply(null, clean);
  const seasOk = rich && freq >= 0.75 && !trend;                         // ยอดที่โตต่อเนื่อง เดือนท้ายๆ ดูสูงกว่าปกติเสมอ — ไม่ใช่ฤดูกาล
  const seas = [];
  put(mk => {
    let v = level;
    if (trend) {
      const h = bdafDiffM(H[N - 1], mk);
      let d = 0;
      for (let j = 1; j <= h; j++) d += Math.pow(0.8, j);               // damped trend: ยืดได้ไม่เกิน ~4 เท่าของความชันรายเดือน
      v = Math.min(Math.max(trend.base + trend.b * d, 0), maxC * 1.5);
    }
    const sf = seasOk ? bdafSeason(mk, mmap, first, last) : null;
    if (sf && Math.abs(sf.f - 1) >= 0.05) { seas.push(Object.assign({ mk }, sf)); v *= sf.f; }
    return v;
  });

  const cv = mean > 0 ? bdafStd(clean) / mean : 1;
  out.notes.push('จ่าย ' + nzv.length + ' จาก ' + N + ' เดือน · ยอดช่วงหลังๆ ราว ' + fmtNum(trend ? trend.base : level, 0) + ' บาท/เดือน' + (trend ? '' : ' (เดือนใหม่มีผลมากกว่าเดือนเก่า)'));
  if (out.spikes.length) {
    out.badges.push({ t: '⚡ มีเดือนสูงผิดปกติ' });
    out.notes.push('⚡ ' + out.spikes.map(i => bdafMShort(H[i]) + ' (' + bdafC(s[i]) + ')').join(', ') + ' จ่ายสูงผิดปกติ — ไม่เอามาเฉลี่ย ใช้ยอดเดือนปกติ (' + fmtNum(med, 0) + ') แทน');
  }
  if (trend) {
    const pct = Math.abs(trend.rel * 100).toFixed(1);
    out.badges.push({ t: (trend.b > 0 ? '↗ เพิ่มขึ้น ' : '↘ ลดลง ') + pct + '%/ด.' });
    out.notes.push((trend.b > 0 ? '↗ ช่วงหลังจ่ายเพิ่มขึ้นเรื่อยๆ' : '↘ ช่วงหลังจ่ายลดลงเรื่อยๆ') + ' ราว ' + pct + '% ต่อเดือน — เผื่อไว้ แต่ไม่ให้' + (trend.b > 0 ? 'เพิ่ม' : 'ลด') + 'ไปเรื่อยๆ');
  }
  if (seas.length) {
    out.badges.push({ t: '📅 บางเดือนจ่ายต่างจากปกติทุกปี' });
    seas.forEach(x => {
      out.notes.push('📅 ปีก่อน ' + bdafMShort(x.ly) + ' จ่าย' + (x.r1 > 1 ? 'สูง' : 'ต่ำ') + 'กว่าเดือนปกติ ' + Math.round(Math.abs(x.r1 - 1) * 100) + '% → '
        + bdafMShort(x.mk) + ' เผื่อ' + (x.f > 1 ? 'เพิ่ม ' : 'ลด ') + Math.round(Math.abs(x.f - 1) * 100) + '%'
        + (x.two ? ' (เป็นแบบนี้ 2 ปีติด)' : ' (เห็นปีเดียว เลยเผื่อแค่ครึ่งเดียว)'));
    });
  }
  const keys = [];
  if (out.spikes.length) keys.push('ไม่เอา ' + out.spikes.map(i => bdafMShort(H[i]) + ' (' + bdafC(s[i]) + ')').join(', ') + ' ที่จ่ายสูงผิดปกติมาเฉลี่ย เพราะน่าจะเป็นรายการครั้งเดียว');
  if (trend) keys.push('ช่วงหลังจ่าย' + (trend.b > 0 ? 'เพิ่มขึ้น' : 'ลดลง') + 'เรื่อยๆ ราว ' + Math.abs(trend.rel * 100).toFixed(1) + '% ต่อเดือน เลยเผื่อ' + (trend.b > 0 ? 'เพิ่ม' : 'ลด') + 'ไว้');
  if (seas.length) keys.push('ปีก่อน ' + seas.map(x => bdafMShort(x.ly)).join(', ') + ' จ่าย' + (seas[0].f > 1 ? 'สูง' : 'ต่ำ') + 'กว่าปกติ เลยเผื่อ ' + seas.map(x => bdafMShort(x.mk)).join(', ') + ' ไว้');
  out.key = keys.length ? keys.join(' · ') : (cv <= 0.2 ? 'จ่ายใกล้เคียงกันทุกเดือน — ใช้ยอดช่วงหลังๆ' : 'ยอดขึ้นลงแต่ละเดือน — ใช้ยอดเฉลี่ยที่เน้นเดือนหลังๆ');
  if (!out.badges.length) out.badges.push({ t: cv <= 0.2 ? '● ใกล้เคียงกันทุกเดือน' : '≈ ขึ้นลงแต่ละเดือน' });
  out.conf = (cv <= 0.2 && freq >= 0.85 && !out.spikes.length) ? 'high' : (cv > 0.6 ? 'low' : 'mid');
  return out;
}

/* ── ค่าที่แก้เอง (แชร์ผ่าน manualOverrides) ─────────────────────────────── */
function bdafParseEdits(rows) {
  const edits = {}, meta = {};
  (rows || []).forEach(r => {
    if (!r || typeof r.key !== 'string' || r.key.indexOf(BDAF_PREFIX) !== 0) return;
    let o = r.value;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (_) { o = null; } }
    if (!o || typeof o !== 'object') return;
    const k = r.key.slice(BDAF_PREFIX.length);
    edits[k] = o;
    meta[k] = { by: r.updatedBy || '', at: r.updatedAt || '' };
  });
  return { edits, meta };
}
function bdafHasEdit(e) {
  return !!(e && (e.off || e.pin || e.def || e.cat || e.lock || (e.base != null && e.base !== '') || (e.m && Object.keys(e.m).length)));
}
/* เขียนกลับ — ทิ้งยอดรายเดือนของเดือนที่ผ่านไปแล้ว · ว่างหมด = ลบคีย์ทิ้ง (กลับไปให้ระบบคิด) */
function bdafSaveEdit(lineKey, obj, cm) {
  if (typeof WTPOverride === 'undefined' || !WTPOverride.setRaw) return;
  const o = Object.assign({}, obj || {});
  if (o.m) {
    const m = {};
    Object.keys(o.m).forEach(k => { const v = Number(o.m[k]); if (k >= cm && o.m[k] !== '' && o.m[k] != null && isFinite(v)) m[k] = Math.round(v * 100) / 100; });
    if (Object.keys(m).length) o.m = m; else delete o.m;
  }
  if (o.base == null || o.base === '' || !isFinite(Number(o.base))) delete o.base;
  ['off', 'pin', 'def', 'cat', 'lock'].forEach(k => { if (!o[k]) delete o[k]; });
  WTPOverride.setRaw(BDAF_PREFIX + lineKey, bdafHasEdit(o) ? JSON.stringify(o) : '');
}

/* ── ล็อก "ตกลงแล้ว" ───────────────────────────────────────────────── */
function bdafWho() { try { const x = JSON.parse(localStorage.getItem('bio-session') || 'null') || {}; return x.displayName || x.name || x.username || ''; } catch (_) { return ''; } }
function bdafLocked(l, cm) { const k = l && l.edit && l.edit.lock; return !!(k && k.until && k.until >= cm); }
function bdafLockedMonth(l, mk, cm) { return bdafLocked(l, cm) && mk <= l.edit.lock.until; }

/* ── สัดส่วนที่ "ยังไม่ถึงวันจ่าย" ของเดือนนี้ + กระจายยอดลงวัน ─────────────── */
function bdafDayWeights(l) {
  if (l.kind === 'custom') { const d = (l.edit && l.edit.def && +l.edit.def.day) || 1; return { [d]: 1 }; }
  return l.dayW || {};
}
function bdafFracFrom(w, mk, fromDay) {
  const last = bdafDim(mk);
  let tot = 0, after = 0;
  Object.keys(w).forEach(k => { const v = w[k]; if (!(v > 0)) return; const d = Math.min(+k, last); tot += v; if (d >= fromDay) after += v; });
  if (!tot) return (last - fromDay + 1) / last;              // ไม่มีประวัติวันจ่าย → เฉลี่ยตามจำนวนวันที่เหลือ
  return after / tot;
}
/* ยอดของเดือน → รายการตามวัน (รวมเป็นช่วงสัปดาห์ ใช้วันเฉลี่ยถ่วงยอดของช่วงนั้น) · เดือนนี้ลงเฉพาะวันที่ยังไม่ถึง */
function bdafSpread(l, mk, amt, today) {
  const last = bdafDim(mk);
  const from = mk === today.slice(0, 7) ? +today.slice(8, 10) : 1;
  const iso = (d) => mk + '-' + String(Math.min(Math.max(d, from), last)).padStart(2, '0');
  const w = bdafDayWeights(l);
  const b = [0, 1, 2, 3, 4].map(() => ({ w: 0, wd: 0 }));
  let tot = 0;
  Object.keys(w).forEach(k => {
    const v = w[k]; if (!(v > 0)) return;
    const d = Math.min(+k, last); if (d < from) return;
    const i = Math.min(4, Math.floor((d - 1) / 7));
    b[i].w += v; b[i].wd += v * d; tot += v;
  });
  if (!tot) return [{ date: iso(from), amt }];               // ไม่รู้วันจ่าย/วันจ่ายปกติผ่านไปแล้วแต่ยังมียอด → ลงวันแรกที่เป็นไปได้
  return b.filter(x => x.w > 0).map(x => ({ date: iso(Math.round(x.wd / x.w)), amt: amt * x.w / tot }));
}
/* ── สร้างแผนค่าใช้จ่าย: เลือกแถว + คิดยอดทั้ง 2 วิธี ─────────────────────────── */
function bdafBuild(col, lookback, hz, edits) {
  const { cm, today, groups, dataMonths } = col;
  const H = dataMonths.slice(-lookback);
  const FULL = dataMonths.slice(-24);
  const first = dataMonths[0] || '';
  const last = dataMonths[dataMonths.length - 1] || '';
  const F = bdafRange(cm, hz);
  const N = H.length;
  const todayDay = +today.slice(8, 10);

  const rows = Object.keys(groups).map(key => {
    const g = groups[key];
    const s = H.map(mk => Math.max(0, g.m[mk] || 0));
    const sum = s.reduce((a, v) => a + v, 0);
    const e = edits[key];
    const cat = (e && +e.cat >= 1 && +e.cat <= 4) ? +e.cat : bdafCodeCat(g.code, g.name, g.act);
    return { key, g, s, sum, k: s.filter(v => v > 0).length, avg: N ? sum / N : 0, cat, autoCat: bdafCodeCat(g.code, g.name, g.act), per: bdafPeriodic(g.m, FULL, cm) };
  });

  const mkLine = (kind, r, e, extra) => {
    const l = Object.assign({
      key: r.key, kind, code: r.g.code || '', name: r.g.name, cat: r.cat, autoCat: r.autoCat, s: r.s, sum: r.sum, k: r.k, avg: r.avg,
      flat: Math.round(r.avg), dayW: r.g.dayW, subs: r.g.subs, tx: r.g.tx || [], members: null, edit: e || null,
      auto: bdafAuto({ rich: kind === 'grp', s: r.s, mmap: r.g.m, H, F, FULL, cm, first, last, per: kind === 'grp' ? r.per : null }),
    }, extra || {});
    l.frac = bdafFracFrom(bdafDayWeights(l), cm, todayDay);
    return l;
  };

  const lines = [];
  const cand = { 1: [], 2: [], 3: [], 4: [] }, others = { 1: [], 2: [], 3: [], 4: [] };
  rows.forEach(r => {
    const e = edits[r.key];
    if (bdafHasEdit(e)) { lines.push(mkLine('grp', r, e)); return; }      // แก้/ไม่นับ/แยก/ย้ายหมวดไว้ = เป็นแถวเสมอ
    const big = r.avg >= BDAF_MIN_AVG;
    const periodic = r.per && !r.per.ended && r.per.amt >= BDAF_MIN_AVG * 3;
    (big || periodic ? cand : others)[r.cat].push(r);
  });
  [1, 2, 3, 4].forEach(c => {
    cand[c].sort((a, b) => b.avg - a.avg || b.sum - a.sum);
    cand[c].forEach((r, i) => { if (i < BDAF_MAX_LINES) lines.push(mkLine('grp', r, null)); else others[c].push(r); });
  });
  [1, 2, 3, 4].forEach(c => {
    const mem = others[c].filter(r => r.sum !== 0).sort((a, b) => b.sum - a.sum);
    const key = 'o:' + c, e = edits[key];
    if (!mem.length && !bdafHasEdit(e)) return;
    const m = {}, dayW = {}, subs = {};
    mem.forEach(r => {
      Object.keys(r.g.m).forEach(mk => { m[mk] = (m[mk] || 0) + r.g.m[mk]; });
      Object.keys(r.g.dayW).forEach(d => { dayW[d] = (dayW[d] || 0) + r.g.dayW[d]; });
    });
    const s = H.map(mk => Math.max(0, m[mk] || 0));
    const sum = s.reduce((a, v) => a + v, 0);
    lines.push(mkLine('other', {
      key, g: { name: 'อื่นๆ (กลุ่มเล็ก ' + mem.length + ' กลุ่ม)', m, dayW, subs, code: '', tx: mem.reduce((a, r) => a.concat(r.g.tx), []) }, s, sum,
      k: s.filter(v => v > 0).length, avg: N ? sum / N : 0, cat: c, autoCat: c, per: null,
    }, e, { members: mem }));
  });
  Object.keys(edits).forEach(key => {
    if (key.indexOf('u:') !== 0) return;
    const e = edits[key], d = e && e.def;
    if (!d || !d.name) return;
    const cat = (+d.cat >= 1 && +d.cat <= 4) ? +d.cat : 1;
    const l = {
      key, kind: 'custom', code: '', name: d.name, cat, autoCat: cat, s: H.map(() => 0), sum: 0, k: 0, avg: 0, flat: 0, dayW: {}, subs: {}, tx: [], members: null,
      auto: { vals: {}, notes: ['รายการที่เพิ่มเอง · จ่ายวันที่ ' + ((+d.day) || 1) + ' ของเดือน' + (d.note ? ' · ' + d.note : '')], badges: [], conf: '', spikes: [] },
      edit: e,
    };
    l.frac = bdafFracFrom(bdafDayWeights(l), cm, todayDay);
    lines.push(l);
  });
  const histSum = rows.reduce((a, r) => a + r.sum, 0);
  return { cm, today, H, N, F, FULL, lines, histSum, histAvg: N ? histSum / N : 0, first, last, lookback };
}

/* ยอดที่ระบบเสนอ (ไม่นับที่แก้) · เดือนนี้ = เฉพาะส่วนที่ยังไม่ถึงวันจ่าย */
function bdafSys(l, mk, mode, cm) {
  let v;
  if (l.kind === 'custom') {
    const d = (l.edit && l.edit.def) || {};
    v = (mk >= (d.from || '') && (!d.to || mk <= d.to)) ? (Number(d.amt) || 0) : 0;
  } else v = mode === 'avg' ? l.flat : (l.auto.vals[mk] || 0);
  return mk === cm ? Math.round(v * l.frac) : v;
}
/* ยอดในแผน: ไม่นับ → 0 · แก้รายเดือน → ค่านั้น (เดือนนี้ = ยอดที่ยังต้องจ่าย) · ยอดทุกเดือน → ค่านั้น · ไม่งั้นค่าระบบ */
function bdafVal(l, mk, mode, cm) {
  const e = l.edit || {};
  if (e.off) return 0;
  if (e.m && e.m[mk] != null && e.m[mk] !== '') return Number(e.m[mk]) || 0;
  if (l.kind !== 'custom' && e.base != null && e.base !== '') { const b = Number(e.base) || 0; return mk === cm ? Math.round(b * l.frac) : b; }
  return bdafSys(l, mk, mode, cm);
}
function bdafView(plan, mode) {
  const { F, lines, cm } = plan;
  const cats = [1, 2, 3, 4].map(c => ({ cat: c, lines: [], vals: {}, total: 0, avg: 0 }));
  const totals = {};
  F.forEach(mk => { totals[mk] = 0; cats.forEach(c => { c.vals[mk] = 0; }); });
  let grand = 0, edited = 0, locked = 0;
  lines.forEach(l => {
    if (bdafLocked(l, cm)) locked++;
    const vals = {};
    let total = 0;
    F.forEach(mk => { const v = bdafVal(l, mk, mode, cm); vals[mk] = v; total += v; });
    const c = cats[l.cat - 1];
    c.lines.push({ l, vals, total });
    F.forEach(mk => { c.vals[mk] += vals[mk]; totals[mk] += vals[mk]; });
    c.total += total; c.avg += l.avg; grand += total;
    if (bdafHasEdit(l.edit)) edited++;
  });
  // เรียงตามเลขรหัส (ผู้ใช้ขอ 2026-10-20 — ไล่หา/เทียบรายรหัสง่ายกว่าเรียงตามยอด)
  //   มีรหัส → ไม่มีรหัส (ชื่อหมวดใน DATA) → เพิ่มเอง → "อื่นๆ" ล่างสุด · แถวที่ไม่นับคงอยู่ตามลำดับรหัสเดิม
  const tier = (l) => (l.kind === 'other' ? 3 : l.kind === 'custom' ? 2 : l.code ? 0 : 1);
  const byCode = (a, b) => {
    const x = a.l, y = b.l, t = tier(x) - tier(y);
    if (t) return t;
    if (x.code && y.code) { const d = Number(x.code) - Number(y.code); if (d) return d; }
    return String(x.name).localeCompare(String(y.name), 'th');
  };
  cats.forEach(c => c.lines.sort(byCode));
  return { cats: cats.filter(c => c.lines.length), totals, grand, edited, locked, nLines: lines.length };
}

/* ── เงินเข้าที่รอรับจริง ─────────────────────────────────────────────── */
const BDAF_RCV_SRC = {
  ar:    { t: 'ใบแจ้งหนี้กำลังติดตาม (ตามวันคาดรับ)', hint: 'สถานะ "กำลังติดตาม" ที่มีวันคาดรับ · เลยวันคาดรับแล้ว = นับวันนี้' },
  plan:  { t: 'วางแผนรับไว้ใน Bank Daily',             hint: 'ใบแจ้งหนี้ที่กดวางประมาณการรับไว้ในตาราง AR ด้านล่าง — ใช้วัน/ยอดตามแผน' },
  other: { t: 'รับอื่นๆ ที่คีย์ประมาณการไว้',           hint: 'ประมาณการยอดรับ (บวก) ที่ไม่ผูกใบแจ้งหนี้ เช่น เงินกู้เข้า — เฉพาะที่ลงวันตั้งแต่วันนี้' },
};
function bdafReceipts(arList, forecasts, today, F) {
  const lastMk = F[F.length - 1] || today.slice(0, 7);
  const items = [];
  const skip = { insp: { n: 0, amt: 0, items: [] }, issue: { n: 0, amt: 0, items: [] }, nodate: { n: 0, amt: 0, items: [] }, later: { n: 0, amt: 0, items: [] } };
  const skipIt = (k, it) => { skip[k].n++; skip[k].amt += it.amt; skip[k].items.push(Object.assign({ why: k }, it)); };
  const push = (it) => {
    if (it.date.slice(0, 7) > lastMk) { skipIt('later', it); return; }
    items.push(it);
  };
  const usedPlans = new Set();
  (arList || []).forEach(x => {
    // แถวจาก arList ของหน้า Bank Daily (BIO): { id, ivNo, jobNo, projectName, net, status, expectedReceive, lastLog, plan, raw }
    const iv = x.raw || {};
    const a = { ivNo: x.ivNo, project: x.projectName, amount: Number(x.net) || 0, status: x.status, jobNo: x.jobNo, invType: iv.invType, lastFollow: x.lastLog, raw: iv };
    const no = String(x.ivNo || '').trim();
    const p = x.plan;                                       // แผนรับที่วางไว้ใน Bank Daily (จับคู่ด้วย id ใบ)
    if (p && !p.isActual && p.amount > 0) {
      usedPlans.add(p.id);
      const d = p.date || p.payDate;
      if (!d) return;
      push({ src: 'plan', date: d < today ? today : d, late: d < today, amt: p.amount, ref: no, name: x.projectName || p.desc, expected: d, ar: a, fc: p });
      return;
    }
    if (!(a.amount >= 1)) return;                           // หนี้กลบหมด → ไม่มีเงินเข้าจริง
    // วันคาดรับ = ช่อง expectedReceive ของใบเท่านั้น (กติกา Weekly Forecast)
    const exp = bdToISO(iv.expectedReceive || x.expectedReceive || '');
    const base = { src: 'ar', amt: a.amount, ref: no, name: x.projectName, expected: exp, ar: a };
    if (a.status === 'pending_inspection') { skipIt('insp', Object.assign({ date: exp }, base)); return; }
    if (a.status === 'issue') { skipIt('issue', Object.assign({ date: exp }, base)); return; }
    if (a.status !== 'tracking') return;
    if (!exp) { skipIt('nodate', Object.assign({ date: '' }, base)); return; }
    const late = exp < today;
    push(Object.assign({ date: late ? today : exp, late }, base));
  });
  (forecasts || []).forEach(f => {
    if (!f || !(f.amount > 0) || f.isActual || usedPlans.has(f.id)) return;
    const raw = f.raw || {};
    const et = String(raw.EXPENSE_TYPE || f.expType || '').trim().toUpperCase();
    if (et === 'AR' || et === 'BANK_RECON' || String(raw.STATUS || '').trim().toUpperCase() === 'CANCELED') return;   // แผน AR ของใบที่ปิดแล้วไม่นับ
    if (!f.date || f.date < today) return;                  // แผนรับที่ลงวันเลยมาแล้ว — ไม่รู้ว่ารับหรือยัง
    push({ src: 'other', date: f.date, late: false, amt: f.amount, ref: String(f.refDoc || '').trim(), name: f.desc, fc: f });
  });
  items.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : y.amt - x.amt));
  const bySrc = {};
  items.forEach(it => {
    const s = bySrc[it.src] || (bySrc[it.src] = { vals: {}, total: 0, n: 0 });
    const mk = it.date.slice(0, 7);
    s.vals[mk] = (s.vals[mk] || 0) + it.amt; s.total += it.amt; s.n++;
  });
  return { items, bySrc, skip };
}

/* ── เดินเงินสดรายวัน → ต้นเดือน/ปลายเดือน/จุดต่ำสุด/ต้องหาเงินเพิ่ม ─────────────── */
function bdafCash(plan, view, rcv, opening, buffer, mode) {
  const { F, cm, today } = plan;
  const evBy = {};
  F.forEach(mk => { evBy[mk] = []; });
  view.cats.forEach(c => c.lines.forEach(x => F.forEach(mk => {
    const a = x.vals[mk];
    if (a > 0.5) bdafSpread(x.l, mk, a, today).forEach(e => evBy[mk].push({ date: e.date, amt: -e.amt }));
  })));
  rcv.items.forEach(r => { const mk = r.date.slice(0, 7); if (evBy[mk]) evBy[mk].push({ date: r.date, amt: r.amt }); });
  let bal = opening, cum = 0;
  return F.map(mk => {
    // วันเดียวกัน: ลงเงินออกก่อนเงินเข้า (มองแบบระวังไว้ก่อน)
    const ev = evBy[mk].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amt - b.amt));
    const open = bal, start = mk === cm ? today : mk + '-01';
    let run = bal, min = bal, minDate = start, inn = 0, out = 0;
    let short = (open + cum < buffer) ? start : null;
    ev.forEach(e => {
      run += e.amt;
      if (e.amt > 0) inn += e.amt; else out -= e.amt;
      if (run < min) { min = run; minDate = e.date; }
      if (!short && run + cum < buffer) short = e.date;
    });
    const cumNew = Math.max(cum, buffer - min);
    const need = cumNew - cum;
    cum = cumNew;
    bal = run;
    return { mk, open, inn, out, close: run, min, minDate, need, needCum: cum, short: need > 0.5 ? short : null };
  });
}

/* เส้นย้อนหลังเล็กๆ ในแถว (ฐาน 0 → เห็นขนาดจริง) · จุดแดง = เดือนที่ระบบตัดเป็นยอดพิเศษ */
function BDAFSpark({ s, spikes }) {
  if (!s || !s.length || !s.some(v => v > 0)) return <span style={{ color: 'var(--ink-300)', display: 'inline-block', width: 56 }}>–</span>;
  const w = 56, h = 16, mx = Math.max(1, ...s);
  const pt = (v, i) => [s.length === 1 ? w / 2 : 2 + i * (w - 4) / (s.length - 1), h - 2 - (v / mx) * (h - 4)];
  const sp = new Set(spikes || []);
  return (
    <svg width={w} height={h} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={s.map((v, i) => pt(v, i).join(',')).join(' ')} fill="none" stroke="var(--ink-400)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {s.map((v, i) => sp.has(i) ? <circle key={i} cx={pt(v, i)[0]} cy={pt(v, i)[1]} r="2.5" fill="var(--bad)" /> : null)}
      <circle cx={pt(s[s.length - 1], s.length - 1)[0]} cy={pt(s[s.length - 1], s.length - 1)[1]} r="2" fill="var(--ink-600)" />
    </svg>
  );
}

/* ช่องตัวเลขรายเดือน — กดแล้วพิมพ์แก้ได้ · Enter/คลิกออก = บันทึก · Esc = ยกเลิก · ลบให้ว่าง = คืนค่าระบบ */
function BDAFCell({ value, sys, edited, locked, off, canEdit, editing, onStart, onSave, onCancel, onLockedClick }) {
  const td = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', padding: '4px 8px' };
  // Enter/Esc แล้วช่องหายไป เบราว์เซอร์ยิง blur ตามมาอีกที → กันบันทึกซ้ำ (และกัน Esc กลายเป็นบันทึก)
  const done = React.useRef(false);
  React.useEffect(() => { if (editing) done.current = false; }, [editing]);
  const finish = (fn) => { if (done.current) return; done.current = true; fn(); };
  if (editing) {
    return (
      <td style={{ ...td, padding: '2px 4px' }}>
        <input autoFocus defaultValue={value ? String(Math.round(value)) : ''}
          onFocus={e => e.target.select()}
          onKeyDown={e => {
            if (e.key === 'Enter') { const v = e.target.value; finish(() => onSave(v)); }
            else if (e.key === 'Escape') finish(onCancel);
          }}
          onBlur={e => { const v = e.target.value; finish(() => onSave(v)); }}
          style={{ width: 92, textAlign: 'right', padding: '4px 6px', border: '1.5px solid var(--brand-400)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }} />
      </td>
    );
  }
  const can = canEdit && !off && !locked;
  return (
    <td onClick={can ? onStart : (locked && canEdit ? onLockedClick : undefined)}
      title={off ? 'ไม่นับในแผน' : locked ? '🔒 ตกลงแล้ว — ยอดนี้ล็อกไว้ (ระบบเสนอ ' + fmtNum(Math.round(sys || 0), 0) + ')' + (canEdit ? ' · กด “🔒 ตกลงแล้ว” ข้างชื่อแถวเพื่อปลดล็อกก่อนแก้' : '')
        : (edited ? 'แก้เอง · ระบบเสนอ ' + fmtNum(Math.round(sys || 0), 0) + (can ? ' (ลบให้ว่าง = คืนค่าระบบ)' : '') : (can ? 'กดเพื่อแก้ยอด' : ''))}
      style={{
        ...td, cursor: can ? 'text' : (locked && canEdit ? 'not-allowed' : 'default'),
        background: locked ? '#e7f6ec' : edited ? '#fff6dc' : undefined, fontWeight: locked || edited ? 700 : 400,
        color: off || !value ? 'var(--ink-400)' : 'var(--ink-800)',
        textDecoration: off && value ? 'line-through' : 'none',
      }}>
      {bdafN(value)}
    </td>
  );
}

/* เมนู ⋯ ของแถว — วาดใน portal (ตารางเลื่อนแนวนอน → dropdown ข้างในโดนตัด) */
function BDAFMenu({ menu, onClose }) {
  React.useEffect(() => {
    const h = () => onClose();
    const t = setTimeout(() => { document.addEventListener('click', h); window.addEventListener('scroll', h, true); window.addEventListener('resize', h); }, 0);
    return () => { clearTimeout(t); document.removeEventListener('click', h); window.removeEventListener('scroll', h, true); window.removeEventListener('resize', h); };
  }, [onClose]);
  const r = menu.rect;
  const left = Math.max(8, Math.min(r.right - 236, window.innerWidth - 244));
  const hgt = 36 * menu.items.length + 8;
  const topY = r.bottom + 4 + hgt > window.innerHeight ? Math.max(8, r.top - 4 - hgt) : r.bottom + 4;
  return ReactDOM.createPortal(
    <div onClick={e => e.stopPropagation()} style={{
      position: 'fixed', top: topY, left, width: 236, zIndex: 9500, background: '#fff', border: '1px solid var(--line)',
      borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: 4, fontSize: 12.5,
    }}>
      {menu.items.map((it, i) => (
        <button key={i} onClick={() => { onClose(); it.fn(); }} style={{
          display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'transparent',
          borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: it.danger ? 'var(--bad)' : 'var(--ink-800)',
        }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--ink-50)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          {it.t}
        </button>
      ))}
    </div>,
    document.body
  );
}

/* ฟอร์ม: ตั้งยอดเท่ากันทุกเดือน / เพิ่ม-แก้รายการเอง */
function BDAFModal({ modal, cm, maxHz, onClose, onSaveBase, onSaveCustom, onDeleteCustom }) {
  const l = modal.line;
  const isBase = modal.type === 'base';
  const d = (l && l.edit && l.edit.def) || {};
  const [f, setF] = React.useState(isBase
    ? { amt: l.edit && l.edit.base != null ? String(l.edit.base) : String(Math.round(l.mode === 'avg' ? l.flat : (l.autoAvg || l.flat))), lock: false }
    : { name: d.name || '', cat: String(d.cat || modal.cat || 1), amt: d.amt != null ? String(d.amt) : '',
        from: d.from && d.from >= cm ? d.from : bdafAddM(cm, 1), to: d.to || '', day: String(d.day || 1), note: d.note || '' });
  const [err, setErr] = React.useState('');
  const set = (k, v) => { setErr(''); setF(p => ({ ...p, [k]: v })); };
  const months = bdafRange(cm, maxHz);
  const inp = { width: '100%', padding: '8px 11px', boxSizing: 'border-box', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fff' };
  const lbl = { fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4, display: 'block' };
  const num = (s) => Number(String(s || '').replace(/[,\s]/g, ''));
  const save = () => {
    const a = num(f.amt);
    if (!(a >= 0) || String(f.amt).trim() === '') return setErr('กรุณาระบุยอดต่อเดือน');
    if (isBase) return onSaveBase(l, a, !!f.lock);
    if (!f.name.trim()) return setErr('กรุณาระบุชื่อรายการ');
    if (f.to && f.to < f.from) return setErr('เดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่ม');
    const day = Math.min(31, Math.max(1, parseInt(f.day, 10) || 1));
    onSaveCustom(l ? l.key : null, { name: f.name.trim(), cat: +f.cat, amt: a, from: f.from, to: f.to || '', day, note: f.note.trim() });
  };
  const btn = { padding: '8px 18px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, maxHeight: 'calc(100vh - 32px)', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.18)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg,#ecfeff,#cffafe)', borderBottom: '1px solid #a5f3fc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#155e75' }}>{isBase ? '🟰 ตั้งยอดเท่ากันทุกเดือน' : (l ? '✏️ แก้รายการที่เพิ่มเอง' : '＋ เพิ่มรายจ่ายเอง')}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#0e7490' }}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          {isBase ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-800)', marginBottom: 6 }}>{l.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 12, lineHeight: 1.6 }}>
                ระบบเสนอ: ค่าเฉลี่ย {fmtNum(l.flat, 0)} · วิเคราะห์อัตโนมัติ ≈ {fmtNum(l.autoAvg || 0, 0)} บาท/เดือน
              </div>
              <label style={lbl}>ยอดต่อเดือน (บาท)</label>
              <input autoFocus style={inp} value={f.amt} onChange={e => set('amt', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} inputMode="decimal" />
              <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 8, lineHeight: 1.6 }}>
                ใช้ยอดนี้ทุกเดือนแทนค่าที่ระบบคิด (ทั้ง 2 วิธี · เดือนนี้นับเฉพาะส่วนที่ยังไม่ถึงวันจ่าย) · ยอดที่เคยแก้รายเดือนของแถวนี้จะถูกล้าง
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, fontWeight: 600, color: 'var(--ink-800)', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!f.lock} onChange={e => set('lock', e.target.checked)} />
                🔒 ล็อกเลย — ตกลงแล้วว่าจ่ายแค่ยอดนี้
              </label>
            </>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px' }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={lbl}>ชื่อรายการ *</label>
                <input autoFocus style={inp} value={f.name} placeholder="เช่น ค่างวดเงินกู้ใหม่ / ค่าเช่าออฟฟิศใหม่" onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>หมวด *</label>
                <select style={inp} value={f.cat} onChange={e => set('cat', e.target.value)}>
                  {BD_CAT_ORDER.map(c => <option key={c} value={c}>{BD_CAT_NAME[c]}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>ยอดต่อเดือน (บาท) *</label>
                <input style={inp} value={f.amt} onChange={e => set('amt', e.target.value)} inputMode="decimal" placeholder="0" />
              </div>
              <div>
                <label style={lbl}>ตั้งแต่เดือน</label>
                <select style={inp} value={f.from} onChange={e => set('from', e.target.value)}>
                  {months.map(mk => <option key={mk} value={mk}>{bdafMFull(mk)}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>ถึงเดือน</label>
                <select style={inp} value={f.to} onChange={e => set('to', e.target.value)}>
                  <option value="">ไม่กำหนด (ทุกเดือน)</option>
                  {months.filter(mk => mk >= f.from).map(mk => <option key={mk} value={mk}>{bdafMFull(mk)}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>จ่ายวันที่ (ของเดือน)</label>
                <input style={inp} value={f.day} onChange={e => set('day', e.target.value)} inputMode="numeric" placeholder="1–31" />
              </div>
              <div>
                <label style={lbl}>หมายเหตุ</label>
                <input style={inp} value={f.note} onChange={e => set('note', e.target.value)} />
              </div>
            </div>
          )}
          {err && <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, fontSize: 12, color: '#dc2626' }}>⚠ {err}</div>}
          <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {isBase && l.edit && l.edit.base != null && (
                <button onClick={() => onSaveBase(l, null)} style={btn}>คืนค่าให้ระบบคิด</button>
              )}
              {!isBase && l && (
                <button onClick={() => onDeleteCustom(l)} style={{ ...btn, color: '#dc2626', borderColor: '#fecaca' }}>ลบรายการ</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose} style={btn}>ยกเลิก</button>
              <button onClick={save} style={{ ...btn, border: 'none', background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff' }}>บันทึก</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── หน้าต่างรายละเอียด (กดตัวเลขในตารางแล้วเปิด) ─────────────────────────── */
function BDAFShell({ title, sub, onClose, children, width }) {
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: width || 980, maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.18)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink: 0, padding: '14px 20px', background: 'linear-gradient(135deg,#ecfeff,#cffafe)', borderBottom: '1px solid #a5f3fc', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#155e75' }}>{title}</div>
            {sub && <div style={{ fontSize: 12, color: '#0e7490', marginTop: 2 }}>{sub}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#0e7490', flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ padding: '12px 20px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  );
}
const bdafChip = (on) => ({
  padding: '4px 11px', borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  border: '1.5px solid ' + (on ? '#0e7490' : '#e2e8f0'), background: on ? '#0e7490' : '#fff', color: on ? '#fff' : '#475569',
});
const BDAF_SKIP_LABEL = { insp: 'รอใบตรวจรับ', issue: 'ติดปัญหา', nodate: 'ไม่มีวันคาดรับ', later: 'คาดรับหลังเดือนสุดท้ายที่ดู' };
const BDAF_SRC_TAG = { ar: ['ใบแจ้งหนี้', '#dcfce7', '#166534'], plan: ['แผนรับ Bank Daily', '#e0f2fe', '#075985'], other: ['ประมาณการที่คีย์', '#f3e8ff', '#6b21a8'] };

/* เงินเข้า 1 รายการ — มาจากไหน + คิดยอดยังไง */
function BDAFRcvDetail({ it, today }) {
  const a = it.ar, iv = (a && a.raw) || {}, f = it.fc, fr = (f && f.raw) || {};
  const d = (x) => { const iso = bdToISO(x); return iso ? fmtDate(iso) : ''; };
  const kv = (k, v) => (v ? <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--ink-500)', minWidth: 130, flexShrink: 0 }}>{k}</span><span style={{ color: 'var(--ink-800)' }}>{v}</span></div> : null);
  const lateDays = it.late && it.expected ? Math.round((new Date(today) - new Date(bdToISO(it.expected))) / 86400000) : 0;
  const src = it.src === 'ar' ? 'ใบแจ้งหนี้คงค้าง (หน้าใบแจ้งหนี้) — สถานะ "' + (a ? (BDAF_AR_LABEL[a.status] || a.status || '') : '') + '"'
            : it.src === 'plan' ? 'แผนรับที่วางไว้ในตาราง "คาดรับเงินเข้า" ของ Bank Daily (ผูกกับใบแจ้งหนี้)'
            : 'ประมาณการรับที่คีย์ไว้ (หน้าประมาณการ / Bank Daily) — ไม่ผูกใบแจ้งหนี้';
  let calc = null;
  if (a) {
    const bal = Number(iv.balance) || 0, wht = bal / 107, debt = bal * 106 / 107 - a.amount;
    calc = (
      <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--ink-50)', borderRadius: 8, fontVariantNumeric: 'tabular-nums', lineHeight: 1.7 }}>
        <div>ยอดคงเหลือในใบ <b>{fmtNum(bal, 2)}</b></div>
        <div>− หัก ณ ที่จ่าย 1% (ยอด ÷ 107) {fmtNum(wht, 2)}</div>
        {Math.abs(debt) >= 0.5 && <div>− หักภาระหนี้ของโครงการ {fmtNum(debt, 2)}</div>}
        <div style={{ fontWeight: 700 }}>= สุทธิที่คาดรับ {fmtNum(a.amount, 2)}</div>
        {it.src === 'plan' && Math.abs(it.amt - a.amount) >= 1 && <div style={{ color: 'var(--warn)' }}>แผนนี้ใช้ยอดตามที่วางไว้ {fmtNum(it.amt, 2)} (ต่างจากสุทธิปัจจุบันของใบ)</div>}
      </div>
    );
  }
  return (
    <div style={{ fontSize: 12, lineHeight: 1.75, padding: '6px 4px 4px' }}>
      {kv('ที่มา', src)}
      {kv('นับในแผนวันที่', it.date ? fmtDate(it.date) + (it.late ? ' (เลยวันคาดรับมาแล้ว ' + lateDays + ' วัน จึงนับเป็นวันนี้)' : '') : 'ยังไม่มีวันคาดรับ')}
      {a && kv('เลขที่ใบแจ้งหนี้', (iv.ivNo || a.ivNo) + (iv.period ? ' · งวดที่ ' + iv.period : '') + (a.invType === 'O' ? ' · ลูกหนี้อื่นๆ' : ' · งานโครงการ'))}
      {a && kv('โครงการ', [a.jobNo, iv.projectName].filter(Boolean).join(' · '))}
      {a && kv('ลูกค้า', iv.customerName || iv.customer || '')}
      {a && kv('วันที่ออกใบ / ครบกำหนด', [d(iv.invoiceDate), d(iv.dueDate)].filter(Boolean).join(' / '))}
      {a && kv('วันคาดรับในใบ', d(iv.expectedReceive))}
      {a && kv('ผู้ติดตาม', iv.assigneeOverride || iv.assignee || '')}
      {a && a.lastFollow && kv('ติดตามล่าสุด', [d(a.lastFollow.date), a.lastFollow.note].filter(Boolean).join(' — '))}
      {a && kv('หมายเหตุใบ', iv.remark || '')}
      {f && kv(it.src === 'plan' ? 'แผนรับ' : 'รายการ', fr.DESCRIPTION || f.desc)}
      {f && kv('วันที่ตามแผน', d(fr.PAYMENT_DATE))}
      {f && kv('ประเภท', fr.EXPENSE_TYPE || '')}
      {f && kv('เข้าบัญชี', fr.Bank_AC || '')}
      {f && kv('หมายเหตุ', fr.NOTE || '')}
      {f && kv('วันที่บันทึกแผน', d(fr.DATE))}
      {calc}
      {!a && f && <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--ink-50)', borderRadius: 8, fontVariantNumeric: 'tabular-nums' }}>ยอดตามประมาณการ <b>{fmtNum(it.amt, 2)}</b></div>}
    </div>
  );
}
function BDAFRcvModal({ rcv, F, today, init, onClose }) {
  const [tab, setTab] = React.useState(init.tab || 'in');
  const [mk, setMk]   = React.useState(init.mk || '');
  const [src, setSrc] = React.useState(init.src || '');
  const [why, setWhy] = React.useState(init.why || '');
  const [openI, setOpenI] = React.useState(-1);
  const skipAll = Object.keys(BDAF_SKIP_LABEL).reduce((a, k) => a.concat(rcv.skip[k].items), []);
  const list = tab === 'in'
    ? rcv.items.filter(it => (!mk || it.date.slice(0, 7) === mk) && (!src || it.src === src))
    : skipAll.filter(it => !why || it.why === why);
  const sum = (arr) => arr.reduce((a, it) => a + it.amt, 0);
  const pick = (fn) => { setOpenI(-1); fn(); };
  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 600, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
  return (
    <BDAFShell title="➕ เงินเข้า — มาจากไหน" onClose={onClose}
      sub={'กดแต่ละแถวเพื่อดูที่มาและวิธีคิดยอด · ' + (tab === 'in' ? 'นับในแผน ' + list.length + ' รายการ รวม ' + fmtNum(Math.round(sum(list)), 0) + ' บาท' : 'ยังไม่นับ ' + list.length + ' รายการ รวม ' + fmtNum(Math.round(sum(list)), 0) + ' บาท')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <button style={bdafChip(tab === 'in')} onClick={() => pick(() => setTab('in'))}>นับในแผน {rcv.items.length} · {bdafC(sum(rcv.items))}</button>
        <button style={bdafChip(tab === 'skip')} onClick={() => pick(() => setTab('skip'))}>ยังไม่นับ {skipAll.length} · {bdafC(sum(skipAll))}</button>
      </div>
      {tab === 'in' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line-soft)' }}>
          <button style={bdafChip(!mk)} onClick={() => pick(() => setMk(''))}>ทุกเดือน</button>
          {F.map(m => { const v = sum(rcv.items.filter(it => it.date.slice(0, 7) === m && (!src || it.src === src))); return <button key={m} style={bdafChip(mk === m)} onClick={() => pick(() => setMk(m))}>{bdafMShort(m)} · {bdafC(v)}</button>; })}
          <span style={{ width: 12 }} />
          <button style={bdafChip(!src)} onClick={() => pick(() => setSrc(''))}>ทุกแหล่ง</button>
          {Object.keys(BDAF_SRC_TAG).map(k => { const n = rcv.items.filter(it => it.src === k).length; return n ? <button key={k} style={bdafChip(src === k)} onClick={() => pick(() => setSrc(k))}>{BDAF_SRC_TAG[k][0]} {n}</button> : null; })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line-soft)' }}>
          <button style={bdafChip(!why)} onClick={() => pick(() => setWhy(''))}>ทุกเหตุผล</button>
          {Object.keys(BDAF_SKIP_LABEL).map(k => rcv.skip[k].n ? <button key={k} style={bdafChip(why === k)} onClick={() => pick(() => setWhy(k))}>{BDAF_SKIP_LABEL[k]} {rcv.skip[k].n} · {bdafC(rcv.skip[k].amt)}</button> : null)}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr>
          <th style={th}>{tab === 'in' ? 'นับวันที่' : 'วันคาดรับ'}</th>
          <th style={th}>{tab === 'in' ? 'ที่มา' : 'ทำไมยังไม่นับ'}</th>
          <th style={th}>เลขที่</th>
          <th style={th}>โครงการ / รายการ</th>
          <th style={{ ...th, textAlign: 'right' }}>ยอดสุทธิ</th>
        </tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--ink-400)' }}>ไม่มีรายการ</td></tr>}
          {list.map((it, i) => {
            const tg = BDAF_SRC_TAG[it.src] || BDAF_SRC_TAG.other;
            const on = openI === i;
            return (
              <React.Fragment key={i}>
                <tr onClick={() => setOpenI(on ? -1 : i)} style={{ cursor: 'pointer', background: on ? 'var(--brand-50)' : undefined }}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 9, color: 'var(--ink-400)', display: 'inline-block', width: 12, transform: on ? 'rotate(90deg)' : 'none' }}>▶</span>
                    {it.date ? bdafDShort(it.date) : '—'}{it.late && <span style={{ color: 'var(--warn)', fontSize: 11 }}> เลยกำหนด</span>}
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)', whiteSpace: 'nowrap' }}>
                    {tab === 'in'
                      ? <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 4, background: tg[1], color: tg[2] }}>{tg[0]}</span>
                      : <span style={{ fontSize: 11, color: 'var(--ink-600)' }}>{BDAF_SKIP_LABEL[it.why]}</span>}
                  </td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)', fontFamily: 'ui-monospace', fontSize: 11.5, whiteSpace: 'nowrap' }}>{it.ref || '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name || '—'}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtNum(Math.round(it.amt), 0)}</td>
                </tr>
                {on && <tr><td colSpan={5} style={{ padding: '0 8px 8px 28px', borderBottom: '1px solid var(--line)', background: '#fbfcfd' }}><BDAFRcvDetail it={it} today={today} /></td></tr>}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </BDAFShell>
  );
}

/* เงินออกจริงย้อนหลัง (จากไฟล์ Cash Flow) — รวมเป็นรายเดือนก่อน กดเดือนไหนค่อยกางดูว่ามีรายการอะไร
 *   ผู้ใช้ขอ (2026-10-20): รายการยาวทั้งก้อนอ่านยาก อยากเห็นยอดรวมทีละเดือน แล้วเปิดดูข้างในเมื่ออยากรู้ */
function BDAFPaidModal({ title, txns, H, onClose }) {
  const Hset = React.useMemo(() => new Set(H), [H]);
  const all = React.useMemo(() => (txns || []).filter(t => Hset.has(t.mk)), [txns, Hset]);
  const [gk, setGk]       = React.useState('');
  const [sort, setSort]   = React.useState('amt');
  const [q, setQ]         = React.useState('');
  const [openM, setOpenM] = React.useState({});   // เดือนที่กางดูอยู่
  const [more, setMore]   = React.useState({});   // เดือนที่กด "แสดงทั้งหมด"
  const sumOf = (arr) => arr.reduce((a, t) => a + t.amt, 0);

  // จ่ายเยอะสุด (ทั้งช่วง) — กดเพื่อดูเฉพาะกลุ่มนั้นในตารางรายเดือน
  const groups = {};
  all.forEach(t => {
    const k = t.g.key, x = groups[k] || (groups[k] = { k, code: t.g.code, name: t.g.name, sum: 0, n: 0 });
    x.sum += t.amt; x.n++;
  });
  const glist = Object.values(groups).sort((a, b) => b.sum - a.sum);
  const gtot = glist.reduce((a, x) => a + x.sum, 0);
  const gmax = glist.length ? Math.max(1, glist[0].sum) : 1;

  const qq = q.trim().toLowerCase();
  const base = all.filter(t => (!gk || t.g.key === gk) && (!qq || (t.note + ' ' + t.vender + ' ' + t.doc + ' ' + t.sub + ' ' + t.code).toLowerCase().indexOf(qq) >= 0));
  const byM = {};
  base.forEach(t => { (byM[t.mk] = byM[t.mk] || []).push(t); });
  const cmp = sort === 'amt' ? (a, b) => b.amt - a.amt : (a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : b.amt - a.amt);
  const months = H.slice().reverse();                                     // เดือนล่าสุดอยู่บน
  const grand = sumOf(base);
  const avg = H.length ? grand / H.length : 0;
  const isOpen = (mk) => (qq ? !!byM[mk] : !!openM[mk]);                  // ค้นหาอยู่ = กางทุกเดือนที่เจอ
  const delta = (mk) => {
    const prev = H[H.indexOf(mk) - 1];
    if (!prev) return null;
    const p = sumOf(byM[prev] || []), c = sumOf(byM[mk] || []);
    if (!(p > 0)) return c > 0 ? <span style={{ color: 'var(--ink-500)' }}>ใหม่</span> : null;
    const r = (c - p) / p;
    if (Math.abs(r) < 0.05) return <span style={{ color: 'var(--ink-400)' }}>≈ เท่าเดิม</span>;
    return <span style={{ color: r > 0 ? 'var(--bad)' : 'var(--good)' }}>{r > 0 ? '▲ +' : '▼ −'}{Math.round(Math.abs(r) * 100)}%</span>;
  };
  const allOpen = months.every(mk => !byM[mk] || openM[mk]);
  const toggleAll = () => { const o = {}; if (!allOpen) months.forEach(mk => { o[mk] = true; }); setOpenM(o); };

  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 600, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
  const td = { padding: '5px 8px', borderBottom: '1px solid var(--line-soft)' };
  const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  return (
    <BDAFShell title={'📋 จ่ายจริงย้อนหลัง — ' + title} onClose={onClose}
      sub={'จากข้อมูล Cash Flow ' + (H.length ? bdafMShort(H[0]) + ' – ' + bdafMShort(H[H.length - 1]) : '') + ' · เฉลี่ย ' + fmtNum(Math.round(avg), 0) + ' บาท/เดือน · ไม่นับโอนระหว่างบัญชี'}>
      {glist.length > 1 && (
        <div style={{ marginBottom: 12, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-700)', marginBottom: 4 }}>
            จ่ายเยอะสุด · ทั้ง {H.length} เดือน <span style={{ fontWeight: 400, color: 'var(--ink-500)' }}>(กดเพื่อดูเฉพาะกลุ่มนั้นในตารางรายเดือนด้านล่าง)</span>
            {gk && <button onClick={() => setGk('')} style={{ marginLeft: 8, border: 'none', background: 'none', color: 'var(--brand-600)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>✕ ดูทุกกลุ่ม</button>}
          </div>
          {glist.slice(0, 10).map(x => (
            <div key={x.k} onClick={() => setGk(gk === x.k ? '' : x.k)}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px 100px 96px 40px', alignItems: 'center', gap: 10, padding: '3px 4px', fontSize: 12, cursor: 'pointer', borderRadius: 6, background: gk === x.k ? 'var(--brand-50)' : undefined }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {x.code && <span style={{ fontFamily: 'ui-monospace', fontSize: 10.5, color: 'var(--ink-500)', marginRight: 5 }}>{x.code}</span>}{x.name}
              </span>
              <span style={{ height: 8, background: 'var(--ink-100)', borderRadius: 4, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: Math.max(2, x.sum / gmax * 100) + '%', background: 'var(--brand-500)', borderRadius: 4 }} />
              </span>
              <span style={{ ...num, fontWeight: 600 }}>{fmtNum(Math.round(x.sum), 0)}</span>
              <span style={{ ...num, color: 'var(--ink-500)', fontSize: 11 }}>{fmtNum(Math.round(x.sum / Math.max(1, H.length)), 0)}/ด.</span>
              <span style={{ ...num, color: 'var(--ink-500)' }}>{gtot ? Math.round(x.sum / gtot * 100) : 0}%</span>
            </div>
          ))}
          {glist.length > 10 && <div style={{ fontSize: 11, color: 'var(--ink-400)', paddingLeft: 4 }}>… และอีก {glist.length - 10} กลุ่ม</div>}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา ผู้รับ / รายละเอียด / เลขที่" title="ค้นแล้วกางทุกเดือนที่เจอให้เอง"
          style={{ flex: '1 1 240px', padding: '6px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit' }} />
        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>ในเดือน เรียง</span>
        <button style={bdafChip(sort === 'amt')} onClick={() => setSort('amt')}>ยอดมาก → น้อย</button>
        <button style={bdafChip(sort === 'date')} onClick={() => setSort('date')}>วันที่ล่าสุด</button>
        {!qq && <button style={bdafChip(false)} onClick={toggleAll}>{allOpen ? '▴ พับทุกเดือน' : '▾ กางทุกเดือน'}</button>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr>
          <th style={th}>เดือน</th>
          <th style={{ ...th, textAlign: 'right' }}>รายการ</th>
          <th style={{ ...th, textAlign: 'right' }}>ยอดจ่ายรวม</th>
          <th style={{ ...th, textAlign: 'right' }}>เทียบเดือนก่อน</th>
          <th style={th}>รายการที่ใหญ่สุดของเดือน</th>
        </tr></thead>
        <tbody>
          {months.map(mk => {
            const list = (byM[mk] || []).slice().sort(cmp);
            const tot = sumOf(list);
            const big = list.length ? list.reduce((m, t) => (t.amt > m.amt ? t : m), list[0]) : null;
            const on = isOpen(mk);
            const lim = more[mk] ? list.length : 50;
            return (
              <React.Fragment key={mk}>
                <tr onClick={list.length && !qq ? () => setOpenM(p => ({ ...p, [mk]: !p[mk] })) : undefined}
                  style={{ cursor: list.length && !qq ? 'pointer' : 'default', background: on ? '#f3f8ff' : '#fafbfc' }}>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 9, color: 'var(--ink-400)', display: 'inline-block', width: 12, transform: on ? 'rotate(90deg)' : 'none', visibility: list.length ? 'visible' : 'hidden' }}>▶</span>
                    {bdafMFull(mk)}
                  </td>
                  <td style={{ ...td, ...num, color: 'var(--ink-600)' }}>{list.length || '–'}</td>
                  <td style={{ ...td, ...num, fontWeight: 700 }}>{list.length ? fmtNum(Math.round(tot), 0) : '–'}</td>
                  <td style={{ ...td, ...num, fontSize: 11.5 }}>{delta(mk)}</td>
                  <td style={{ ...td, fontSize: 11.5, color: 'var(--ink-600)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={big ? big.note : ''}>
                    {big ? <>{big.note || big.sub || '—'} · <b style={{ color: 'var(--ink-800)' }}>{fmtNum(Math.round(big.amt), 0)}</b></> : ''}
                  </td>
                </tr>
                {on && (
                  <tr>
                    <td colSpan={5} style={{ padding: '2px 0 10px 22px', borderBottom: '1px solid var(--line)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <tbody>
                          {list.slice(0, lim).map((t, i) => (
                            <tr key={i}>
                              <td style={{ ...td, ...num, color: 'var(--ink-400)', width: 28 }}>{i + 1}</td>
                              <td style={{ ...td, whiteSpace: 'nowrap', width: 74 }}>{bdafDShort(t.iso)}</td>
                              <td style={{ ...td, fontFamily: 'ui-monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{t.doc || '—'}</td>
                              <td style={{ ...td, maxWidth: 340 }} title={t.note}>{t.note || '—'}{t.vender && t.vender !== t.note ? <span style={{ color: 'var(--ink-500)' }}> · {t.vender}</span> : null}</td>
                              <td style={{ ...td, fontSize: 11, color: 'var(--ink-600)', maxWidth: 220 }}>{t.code ? <span style={{ fontFamily: 'ui-monospace' }}>{t.code} </span> : null}{t.sub && t.sub !== t.note ? t.sub : ''}</td>
                              <td style={{ ...td, ...num, fontWeight: 600, color: t.amt < 0 ? 'var(--good)' : undefined }}>{t.amt < 0 ? '−' : ''}{fmtNum(Math.round(Math.abs(t.amt)), 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {list.length > lim && (
                        <button onClick={() => setMore(p => ({ ...p, [mk]: true }))}
                          style={{ marginTop: 4, border: 'none', background: 'none', color: 'var(--brand-600)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>แสดงทั้งหมด (อีก {list.length - lim} รายการ)</button>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot><tr>
          <td style={{ ...td, fontWeight: 700, borderTop: '1.5px solid var(--line)' }}>รวม {H.length} เดือน</td>
          <td style={{ ...td, ...num, borderTop: '1.5px solid var(--line)' }}>{base.length}</td>
          <td style={{ ...td, ...num, fontWeight: 700, borderTop: '1.5px solid var(--line)' }}>{fmtNum(Math.round(grand), 0)}</td>
          <td colSpan={2} style={{ ...td, fontSize: 11.5, color: 'var(--ink-500)', borderTop: '1.5px solid var(--line)' }}>เฉลี่ย {fmtNum(Math.round(avg), 0)} บาท/เดือน{gk ? ' · เฉพาะกลุ่มที่เลือก' : ''}{qq ? ' · เฉพาะที่ค้นเจอ' : ''}</td>
        </tr></tfoot>
      </table>
    </BDAFShell>
  );
}

/* รายละเอียดแถว (กดชื่อแถว) — แบบเบา อ่านแล้วรู้เรื่องใน 3 บรรทัด (ผู้ใช้ขอ 2026-10-20: "เยอะเกินไป ขอแบบเบาๆ พอรู้เรื่อง")
 *   ① แผนใช้เท่าไร ต่างจากที่เคยจ่ายจริงแค่ไหน ② เพราะอะไร (ประโยคเดียว ภาษาปกติ ไม่ใช้ศัพท์ระบบ)
 *   ที่เหลือ (ย้อนหลัง · 2 วิธีคิด · เหตุผลทั้งหมด · วันที่จ่าย · หมวดย่อย) ซ่อนไว้ใต้ "วิธีคิด ▾" — ผู้ใช้: ของที่กดดูได้ไม่ต้องโชว์ */
function BDAFLineDetail({ l, vals, plan, mode, F, cm, meta, canEdit, onOpenPaid, onPin }) {
  const [more, setMore] = React.useState(false);
  const e = l.edit || {};
  const isCustom = l.kind === 'custom';
  const autoAvg = F.length ? F.reduce((a, mk) => a + (l.auto.vals[mk] || 0), 0) / F.length : 0;
  const full = F.filter(mk => mk !== cm);                                // เดือนนี้นับแค่ที่เหลือ เลยไม่เอามาเฉลี่ย
  const use = full.length ? full : F;
  const planAvg = use.reduce((a, mk) => a + (vals[mk] || 0), 0) / Math.max(1, use.length);
  const locked = bdafLocked(l, cm), edited = !locked && (e.base != null || (e.m && Object.keys(e.m).length > 0));
  const diff = l.avg > 0 ? (planAvg - l.avg) / l.avg : 0;
  const why = e.off ? 'ตั้งไว้ว่าไม่นับรายการนี้ในแผน'
    : locked ? 'ตกลงยอดแล้ว' + (e.lock.by ? ' โดย ' + e.lock.by : '') + (e.lock.at ? ' เมื่อ ' + fmtDate(String(e.lock.at).slice(0, 10)) : '') + ' — ยอดไม่ขยับตามระบบ'
    : edited ? 'ใช้ยอดที่แก้เอง (ระบบเสนอ ' + fmtNum(Math.round(mode === 'avg' ? l.flat : autoAvg), 0) + '/เดือน)'
    : isCustom ? 'รายการที่เพิ่มเอง'
    : mode === 'avg' ? 'ใช้ค่าเฉลี่ยตรงๆ เท่ากันทุกเดือน'
    : l.auto.key;
  const spikes = new Set(l.auto.spikes || []);
  // ช่วงวันที่จ่ายเยอะสุด
  const w = bdafDayWeights(l), bk = [0, 0, 0, 0, 0];
  let wt = 0;
  Object.keys(w).forEach(k => { const v = w[k]; if (v > 0) { bk[Math.min(4, Math.floor((+k - 1) / 7))] += v; wt += v; } });
  const topB = bk.indexOf(Math.max(...bk));
  const dayTxt = wt > 0 ? 'มักจ่ายวันที่ ' + ['1–7', '8–14', '15–21', '22–28', '29–31'][topB] + ' (' + Math.round(bk[topB] / wt * 100) + '%)' : '';
  const accent = e.off ? 'var(--ink-300)' : locked ? 'var(--good)' : 'var(--brand-500)';
  const link = { border: 'none', background: 'none', color: 'var(--brand-600)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', padding: 0 };
  const sep = <span style={{ color: 'var(--ink-300)' }}>·</span>;
  const subs = Object.keys(l.subs || {}).filter(k => l.subs[k] > 0).sort((a, b) => l.subs[b] - l.subs[a]);
  return (
    <div style={{ position: 'sticky', left: 0, width: 'min(1000px, calc(100vw - 80px))', padding: '8px 14px 10px 56px', fontSize: 12.5, color: 'var(--ink-700)', lineHeight: 1.6, boxSizing: 'border-box' }}>
      <div style={{ borderLeft: '3px solid ' + accent, paddingLeft: 10 }}>
        {/* ① แผนใช้เท่าไร */}
        <div>
          {e.off ? <b style={{ fontSize: 13.5 }}>ไม่นับในแผน</b>
            : <><b style={{ fontSize: 13.5, color: 'var(--ink-900)' }}>แผนใช้ {fmtNum(Math.round(planAvg), 0)} บาท/เดือน</b>
              {l.avg > 0 && <span style={{ marginLeft: 8 }}>
                {Math.abs(diff) >= 0.05
                  ? <span style={{ color: diff > 0 ? 'var(--bad)' : 'var(--good)', fontWeight: 600 }}>{diff > 0 ? '▲ สูง' : '▼ ต่ำ'}กว่าที่เคยจ่ายจริง {Math.round(Math.abs(diff) * 100)}%</span>
                  : <span style={{ color: 'var(--ink-500)' }}>ใกล้เคียงที่เคยจ่ายจริง</span>}
                <span style={{ color: 'var(--ink-500)' }}> (เฉลี่ย {fmtNum(Math.round(l.avg), 0)})</span>
              </span>}</>}
        </div>
        {/* ② เพราะอะไร */}
        <div style={{ color: 'var(--ink-600)' }}>{why}</div>
      </div>
      {/* ลิงก์ดูเพิ่ม */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 10px', marginTop: 6, paddingLeft: 13, fontSize: 12 }}>
        {!isCustom && <button style={link} onClick={onOpenPaid}>📋 ดูรายการจ่ายจริง</button>}
        {!isCustom && <button style={link} onClick={() => setMore(m => !m)}>{more ? 'วิธีคิด ▴' : 'วิธีคิด ▾'}</button>}
        {meta && meta.by && !locked && <>{sep}<span style={{ color: 'var(--ink-400)' }}>แก้ล่าสุดโดย {meta.by}</span></>}
      </div>
      {more && !isCustom && (
        <div style={{ marginTop: 6, paddingLeft: 13, fontSize: 12, color: 'var(--ink-600)' }}>
          {plan.N > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px', fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 2 }}>
              <span>ย้อนหลัง:</span>
              {plan.H.map((mk, i) => (
                <span key={mk} style={{ whiteSpace: 'nowrap', color: spikes.has(i) ? 'var(--bad)' : undefined, fontWeight: spikes.has(i) ? 700 : 400 }}
                  title={spikes.has(i) ? 'จ่ายสูงผิดปกติ — ไม่เอามาเฉลี่ย' : undefined}>
                  {bdafMShort(mk)} <span style={{ color: spikes.has(i) ? 'var(--bad)' : 'var(--ink-800)', fontVariantNumeric: 'tabular-nums' }}>{l.s[i] ? (l.s[i] >= 1e6 ? (l.s[i] / 1e6).toFixed(2) + 'M' : fmtNum(Math.round(l.s[i]), 0)) : '–'}</span>
                </span>
              ))}
            </div>
          )}
          <div>📊 ค่าเฉลี่ย <b>{fmtNum(l.flat, 0)}</b>/เดือน (รวม {fmtNum(Math.round(l.sum), 0)} ÷ {plan.N} เดือน) {sep} 🤖 วิเคราะห์อัตโนมัติ ≈ <b>{fmtNum(Math.round(autoAvg), 0)}</b>/เดือน</div>
          <ul style={{ margin: '2px 0 0', padding: '0 0 0 16px' }}>{l.auto.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          {(dayTxt || (F[0] === cm && !e.off)) && <div style={{ marginTop: 2 }}>{dayTxt}{dayTxt && F[0] === cm && !e.off ? ' · ' : ''}{F[0] === cm && !e.off ? 'เดือนนี้ยังเหลือจ่าย ' + fmtNum(Math.round(vals[cm] || 0), 0) : ''}</div>}
          {subs.length > 1 && <div style={{ marginTop: 2 }}>ข้างในกลุ่ม: {subs.slice(0, 4).map(k => k + ' ' + bdafC(l.subs[k])).join(' · ')}{subs.length > 4 ? ' · …' : ''}</div>}
        </div>
      )}
      {/* "อื่นๆ" — กลุ่มเล็กข้างใน (ต้องมีปุ่มแยก/ไม่นับ) */}
      {l.kind === 'other' && l.members && l.members.length > 0 && (
        <div style={{ marginTop: 8, paddingLeft: 13 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2 }}>ข้างใน “อื่นๆ” ({l.members.length} กลุ่ม · เรียงยอดมาก → น้อย)</div>
          <table style={{ borderCollapse: 'collapse', fontSize: 11.5 }}>
            <tbody>
              {l.members.slice(0, 20).map(r => (
                <tr key={r.key}>
                  <td style={{ padding: '2px 12px 2px 0', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.g.code ? r.g.code + ' ' : ''}{r.g.name}</td>
                  <td style={{ padding: '2px 12px', color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>จ่าย {r.k}/{plan.N} เดือน</td>
                  <td style={{ padding: '2px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>รวม {fmtNum(Math.round(r.sum), 0)}</td>
                  {canEdit && (
                    <td style={{ padding: '2px 0', whiteSpace: 'nowrap' }}>
                      <button onClick={() => onPin(r, false)} title="แยกกลุ่มนี้ออกมาเป็นแถวของตัวเอง (แก้ยอดเองได้)"
                        style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 6, padding: '1px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', marginRight: 4 }}>📌 แยกเป็นแถว</button>
                      <button onClick={() => onPin(r, true)} title="เอากลุ่มนี้ออกจากแผน (เช่น จ่ายครั้งเดียวไม่เกิดอีก)"
                        style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 6, padding: '1px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>🚫 ไม่นับ</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {l.members.length > 20 && <div style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>… และอีก {l.members.length - 20} กลุ่ม</div>}
        </div>
      )}
    </div>
  );
}

/* ═══════════════ การ์ดหลัก ═══════════════ */
function BDCashPlanPanel({ accounts, arList, forecasts, overrides, today, canEdit, canDelete, toast }) {
  const cm = today.slice(0, 7);
  const maxHz = bdafAddM(cm, 23);
  const pref0 = React.useMemo(bdafLoadPrefs, []);
  const [open, setOpen]         = React.useState(!!pref0.open);
  const [mode, setMode]         = React.useState(pref0.mode === 'auto' ? 'auto' : 'avg');
  const [lookback, setLookback] = React.useState(BDAF_LOOKBACKS.indexOf(pref0.lookback) >= 0 ? pref0.lookback : 6);
  const [hz, setHz]             = React.useState(pref0.hz && pref0.hz >= cm && pref0.hz <= maxHz ? pref0.hz : bdafAddM(cm, 5));
  const [openBase, setOpenBase] = React.useState(pref0.openBase === 'main' ? 'main' : 'all');
  const [exp, setExp]           = React.useState(pref0.exp && typeof pref0.exp === 'object' ? pref0.exp : {});   // หมวด 1-4 · 'rcv' · 'out'
  const [detail, setDetail]     = React.useState({});     // lineKey / 'rcv:<src>' → กางดูรายละเอียด
  const [editing, setEditing]   = React.useState(null);   // { key, mk }
  const [menu, setMenu]         = React.useState(null);   // { rect, items }
  const [modal, setModal]       = React.useState(null);   // { type: 'base' | 'custom', line?, cat? }
  const closeMenu = React.useCallback(() => setMenu(null), []);
  const [drill, setDrill]       = React.useState(null);   // { kind: 'rcv', init } | { kind: 'paid', title, txns }
  const closeDrill = React.useCallback(() => setDrill(null), []);
  React.useEffect(() => { bdafSavePrefs({ open, mode, lookback, hz, openBase, exp }); }, [open, mode, lookback, hz, openBase, exp]);

  /* ข้อมูล Cash Flow (ชีต DATA) — ไม่ได้มากับข้อมูลหลักของหน้า ต้องดึงแยก · โชว์ cache ของเครื่องก่อน */
  const [cf, setCf] = React.useState(() => { try { const r = JSON.parse(localStorage.getItem(BDAF_CFP_LS) || 'null'); return r && r.stm ? r : null; } catch (_) { return null; } });
  const [cfState, setCfState] = React.useState('loading');   // loading | ok | empty | error
  const loadCf = React.useCallback(() => {
    if (!window.WTPData || typeof window.WTPData.fetchSheetRows !== 'function') { setCfState('error'); return; }
    setCfState('loading');
    window.WTPData.fetchSheetRows('cashflowPresent').then(rows => {
      const row = (rows || []).find(r => r && r.stm);
      if (row) { setCf(row); setCfState('ok'); } else setCfState('empty');
    }, () => setCfState('error'));
  }, []);
  React.useEffect(() => { loadCf(); }, [loadCf]);

  const ovRows = overrides || [];
  const editSig = ovRows.filter(r => r && typeof r.key === 'string' && r.key.indexOf(BDAF_PREFIX) === 0).map(r => r.key + '=' + r.value).join('|');
  const cfg = bdafReadCfg(ovRows);
  const buffer = Number(cfg.buffer) || 0;
  const col  = React.useMemo(() => bdafCollectCf(cf && cf.stm && cf.stm.txns, cf && cf.codeGroups, today), [cf, today]);
  const ed   = React.useMemo(() => bdafParseEdits(ovRows), [editSig]);
  const plan = React.useMemo(() => bdafBuild(col, lookback, hz, ed.edits), [col, lookback, hz, ed]);
  const view = React.useMemo(() => bdafView(plan, mode), [plan, mode]);
  const rcv  = React.useMemo(() => bdafReceipts(arList, forecasts, today, plan.F), [arList, forecasts, today, plan.F]);

  /* ยอดตั้งต้น = ยอดเงินใช้ได้ (หัก HOLD) — ทุกบัญชี หรือเฉพาะบัญชีหลักที่เลือกไว้ในใบสรุป */
  const opening = React.useMemo(() => {
    const accts = accounts || [];
    const pick = (typeof bdLoadMainAccts === 'function' && bdLoadMainAccts()) || accts.filter(a => (typeof BD_MAIN_ACCT_DEFAULT_LAST4 !== 'undefined' ? BD_MAIN_ACCT_DEFAULT_LAST4 : []).indexOf(bdLast4(a.accountNo)) >= 0).map(a => a.accountNo);
    const pickSet = new Set(pick || []);
    const avail = (a) => (a.available != null ? a.available : a.balance) || 0;
    const all = accts.reduce((s, a) => s + avail(a), 0);
    const mainList = accts.filter(a => pickSet.has(a.accountNo));
    const main = mainList.reduce((s, a) => s + avail(a), 0);
    const asOf = accts.reduce((m, a) => { const d = bdToISO(a.asOf); return d && d > m ? d : m; }, '');
    return { all, main, mainN: mainList.length, allN: accts.length, asOf };
  }, [accounts]);
  const openAmt = openBase === 'main' && opening.mainN ? opening.main : opening.all;
  const cash = React.useMemo(() => bdafCash(plan, view, rcv, openAmt, buffer, mode), [plan, view, rcv, openAmt, buffer, mode]);
  const F = plan.F;
  const needTotal = cash.length ? cash[cash.length - 1].needCum : 0;
  const firstShort = cash.find(r => r.need > 0.5);
  const lowest = cash.reduce((m, r) => (!m || r.min < m.min ? r : m), null);
  const byWhen = (d) => (d === today ? 'ตั้งแต่วันนี้' : 'ก่อนวันที่ ' + bdafDShort(d));   // ต่ำกว่าเงินสำรองอยู่แล้วตอนนี้ = ต้องหาทันที

  /* ── เขียนค่าที่แก้ ── */
  const save = (key, edit, fn, msg) => {
    if (!canEdit) return;
    bdafSaveEdit(key, fn(Object.assign({}, edit || {})), cm);
    if (msg && toast) toast(msg);
  };
  const saveCell = (l, mk, raw) => {
    setEditing(null);
    if (bdafLockedMonth(l, mk, cm)) { if (toast) toast('🔒 แถวนี้ตกลงยอดแล้ว — ปลดล็อกก่อนแก้'); return; }
    const txt = String(raw == null ? '' : raw).replace(/[,\s฿]/g, '');
    const e = l.edit || {};
    const had = e.m && e.m[mk] != null;
    if (txt === '') {
      if (had) save(l.key, e, o => { const m = Object.assign({}, o.m); delete m[mk]; o.m = m; return o; }, 'คืนค่าระบบ · ' + l.name + ' · ' + bdafMShort(mk));
      return;
    }
    const n = Number(txt);
    if (!isFinite(n) || n < 0) { if (toast) toast('ตัวเลขไม่ถูกต้อง'); return; }
    if (Math.round(n) === Math.round(bdafVal(l, mk, mode, cm))) return;        // ไม่ได้เปลี่ยน (แค่คลิกผ่าน)
    save(l.key, e, o => { o.m = Object.assign({}, o.m, { [mk]: n }); return o; }, 'แก้ยอด ' + l.name + ' · ' + bdafMShort(mk) + ' = ' + fmtNum(n, 0));
  };
  const toggleOff = (l) => save(l.key, l.edit, o => { o.off = !o.off; return o; }, (l.edit && l.edit.off ? 'นับกลับเข้าแผน · ' : 'ไม่นับในแผน · ') + l.name);
  const moveCat = (l, c) => {
    if (l.kind === 'custom') save(l.key, l.edit, o => { o.def = Object.assign({}, o.def, { cat: c }); return o; }, 'ย้าย ' + l.name + ' → ' + BD_CAT_NAME[c]);
    else save(l.key, l.edit, o => { if (c === l.autoCat) delete o.cat; else o.cat = c; return o; }, 'ย้าย ' + l.name + ' → ' + BD_CAT_NAME[c]);
    setExp(p => ({ ...p, [c]: true }));
  };
  const resetLine = (l) => {
    if (!window.confirm('ล้างที่แก้ทั้งหมดของ “' + l.name + '” ให้ระบบคิดเอง?')) return;
    save(l.key, null, () => ({}), 'คืนค่าระบบ · ' + l.name);
  };
  const pinGroup = (r, off) => {
    save(r.key, ed.edits[r.key], o => { o.pin = true; if (off) o.off = true; return o; }, (off ? 'ไม่นับในแผน · ' : 'แยกเป็นแถว · ') + r.g.name);
  };
  // ตกลงยอด: เขียนยอดที่เห็นทุกเดือนในช่วงที่ดูลงไปเลย → ระบบคิดใหม่กี่รอบก็ไม่ขยับ
  const lockObj = (o, valOf) => {
    if (!o.off) { const m = Object.assign({}, o.m); F.forEach(mk => { m[mk] = Math.round(valOf(mk) || 0); }); o.m = m; }
    o.lock = { by: bdafWho(), at: new Date().toISOString(), until: F[F.length - 1] };
    return o;
  };
  const lockLine = (x) => save(x.l.key, x.l.edit, o => lockObj(o, mk => x.vals[mk]),
    (bdafLocked(x.l, cm) ? '🔒 ขยายล็อกถึง ' + bdafMShort(F[F.length - 1]) + ' · ' : '🔒 ตกลงแล้ว · ') + x.l.name);
  const unlockLine = (l) => {
    const k = (l.edit && l.edit.lock) || {};
    if (!window.confirm('ปลดล็อก “' + l.name + '”?' + (k.by ? '\n(ล็อกไว้โดย ' + k.by + (k.at ? ' เมื่อ ' + fmtDate(String(k.at).slice(0, 10)) : '') + ')' : '') + '\nยอดที่ตกลงไว้ยังอยู่ แต่จะกลับมาแก้ได้')) return;
    save(l.key, l.edit, o => { delete o.lock; return o; }, '🔓 ปลดล็อก · ' + l.name);
  };
  const lockCat = (c) => {
    const todo = c.lines.filter(x => !bdafLocked(x.l, cm));
    if (!canEdit || !todo.length) return;
    if (!window.confirm('ล็อกทุกแถวในหมวด' + BD_CAT_NAME[c.cat] + ' (' + todo.length + ' แถว) ตามยอดที่เห็นตอนนี้?\nตกลงแล้ว = ยอดไม่ขยับตามระบบ และแก้ไม่ได้จนกว่าจะปลดล็อก')) return;
    todo.forEach(x => bdafSaveEdit(x.l.key, lockObj(Object.assign({}, x.l.edit || {}), mk => x.vals[mk]), cm));
    if (toast) toast('🔒 ตกลงแล้วทั้งหมวด' + BD_CAT_NAME[c.cat] + ' (' + todo.length + ' แถว)');
  };
  const saveBase = (l, amt, lockNow) => {
    setModal(null);
    save(l.key, l.edit, o => {
      if (amt == null) { delete o.base; return o; }
      o.base = amt; delete o.m;
      return lockNow ? lockObj(o, mk => (mk === cm ? amt * l.frac : amt)) : o;
    }, amt == null ? 'คืนค่าให้ระบบคิด · ' + l.name : (lockNow ? '🔒 ตกลงแล้ว · ' : 'ตั้ง ') + l.name + ' = ' + fmtNum(amt, 0) + ' ทุกเดือน');
  };
  const saveCustom = (key, def) => {
    setModal(null);
    const k = key || ('u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    save(k, ed.edits[k], o => { o.def = def; return o; }, (key ? 'แก้รายการ · ' : 'เพิ่มรายการ · ') + def.name);
    setExp(p => ({ ...p, out: true, [def.cat]: true }));
  };
  const deleteCustom = (l) => {
    if (!window.confirm('ลบรายการ “' + l.name + '”?')) return;
    setModal(null);
    save(l.key, null, () => ({}), 'ลบรายการ · ' + l.name);
  };
  const saveBuffer = (raw) => {
    const n = Number(String(raw || '').replace(/[,\s฿]/g, '')) || 0;
    if (!canEdit || n === buffer || typeof WTPOverride === 'undefined') return;
    WTPOverride.setRaw(BDAF_CFG_KEY, n > 0 ? JSON.stringify(Object.assign({}, cfg, { buffer: n })) : '');
    if (toast) toast('เงินสำรองขั้นต่ำ = ' + fmtNum(n, 0) + ' บาท');
  };
  const clearAll = () => {
    const isLockKey = (k) => { const e = ed.edits[k.slice(BDAF_PREFIX.length)]; return !!(e && e.lock && e.lock.until >= cm); };
    const all = ovRows.filter(r => r && typeof r.key === 'string' && r.key.indexOf(BDAF_PREFIX) === 0).map(r => r.key);
    const keys = all.filter(k => !isLockKey(k));
    const kept = all.length - keys.length;
    if (!keys.length) { if (toast) toast(kept ? 'ทุกแถวที่แก้ไว้ตกลง (ล็อก) แล้ว — ปลดล็อกก่อนถ้าจะล้าง' : 'ไม่มีอะไรให้ล้าง'); return; }
    if (!window.confirm('ล้างที่แก้ทั้งหมด ' + keys.length + ' แถว (รวมรายการที่เพิ่มเอง) ให้ระบบคิดใหม่ทั้งแผน?' + (kept ? '\nไม่แตะ ' + kept + ' แถวที่ตกลง (ล็อก) แล้ว' : '') + '\nทุกคนในทีมจะเห็นแผนเปลี่ยนตาม')) return;
    const m = {};
    keys.forEach(k => { m[k] = null; });
    if (typeof WTPOverride !== 'undefined' && WTPOverride.setMany) WTPOverride.setMany(m);
    if (toast) toast('ล้างที่แก้ทั้งหมดแล้ว');
  };
  const openMenu = (x, ev) => {
    ev.stopPropagation();
    const l = x.l, e = l.edit || {};
    const items = [];
    if (bdafLocked(l, cm)) {
      items.push({ t: '🔓 ปลดล็อก (กลับไปแก้ได้)', fn: () => unlockLine(l) });
      if (F[F.length - 1] > e.lock.until) items.push({ t: '🔒 ขยายล็อกถึง ' + bdafMShort(F[F.length - 1]), fn: () => lockLine(x) });
      setMenu({ rect: ev.currentTarget.getBoundingClientRect(), items });
      return;
    }
    items.push({ t: '🔒 ล็อก — ตกลงยอดนี้แล้ว', fn: () => lockLine(x) });
    if (l.kind === 'custom') items.push({ t: '✏️ แก้รายการ…', fn: () => setModal({ type: 'custom', line: l }) });
    else {
      const autoAvg = F.length ? F.reduce((a, mk) => a + (l.auto.vals[mk] || 0), 0) / F.length : l.flat;   // ยอดเต็มเดือน
      items.push({ t: '🟰 ตั้งยอดเท่ากันทุกเดือน…', fn: () => setModal({ type: 'base', line: Object.assign({}, l, { mode, autoAvg }) }) });
    }
    items.push({ t: e.off ? '↩ นับกลับเข้าแผน' : '🚫 ไม่นับรายการนี้', fn: () => toggleOff(l) });
    if (l.kind !== 'other') BD_CAT_ORDER.filter(c => c !== l.cat).forEach(c => items.push({ t: '↪ ย้ายไปหมวด' + BD_CAT_NAME[c], fn: () => moveCat(l, c) }));
    if (l.kind === 'custom') items.push({ t: '🗑 ลบรายการ', danger: true, fn: () => deleteCustom(l) });
    else if (bdafHasEdit(e)) items.push({ t: '↺ ล้างที่แก้ — ให้ระบบคิดเอง', fn: () => resetLine(l) });
    setMenu({ rect: ev.currentTarget.getBoundingClientRect(), items });
  };

  /* ── Excel ── */
  const modeLabel = mode === 'avg' ? '📊 ค่าเฉลี่ย' : '🤖 วิเคราะห์อัตโนมัติ';
  const rangeLabel = F.length ? bdafMShort(F[0]) + (F.length > 1 ? ' – ' + bdafMShort(F[F.length - 1]) : '') : '';
  const srcOf = (l) => {
    const e = l.edit || {};
    if (bdafLocked(l, cm)) return 'ตกลงแล้ว (ล็อก' + (e.lock.by ? 'โดย ' + e.lock.by : '') + ')';
    if (l.kind === 'custom') return 'เพิ่มเอง';
    if (e.off) return 'ไม่นับ';
    if (e.base != null) return 'ตั้งยอดทุกเดือน';
    if (e.m && Object.keys(e.m).length) return 'แก้บางเดือน';
    return 'ระบบ';
  };
  const xlsCols = [{ key: 'grp', label: 'ส่วน' }, { key: 'name', label: 'รายการ' }, { key: 'src', label: 'ที่มา' },
    { key: 'avg', label: 'จ่ายจริงเฉลี่ย/เดือน (ย้อนหลัง ' + plan.N + ' เดือน)', type: 'number' }]
    .concat(F.map(mk => ({ key: 'm' + mk, label: bdafMFull(mk) + (mk === cm ? ' (ที่เหลือ)' : ''), type: 'number' })))
    .concat([{ key: 'total', label: 'รวม', type: 'number' }, { key: 'note', label: 'วิธีคิด / หมายเหตุ' }]);
  const xlsRows = [];
  const xrow = (grp, name, vals, extra) => { const r = Object.assign({ grp, name, src: '', avg: '', total: '', note: '' }, extra || {}); F.forEach((mk, i) => { r['m' + mk] = Math.round(vals[i] || 0); }); xlsRows.push(r); };
  xrow('สรุปเงินสด', 'เงินต้นเดือน', cash.map(r => r.open));
  xrow('สรุปเงินสด', '+ เงินเข้า (คาดรับจริง)', cash.map(r => r.inn), { total: Math.round(cash.reduce((a, r) => a + r.inn, 0)) });
  xrow('สรุปเงินสด', '− เงินออก (ค่าใช้จ่ายประมาณการ)', cash.map(r => r.out), { total: Math.round(cash.reduce((a, r) => a + r.out, 0)) });
  xrow('สรุปเงินสด', '= เงินปลายเดือน (ถ้าไม่หาเงินเพิ่ม)', cash.map(r => r.close));
  xrow('สรุปเงินสด', 'จุดต่ำสุดระหว่างเดือน', cash.map(r => r.min), { note: cash.map(r => bdafMShort(r.mk) + ': ' + bdafDShort(r.minDate)).join(' · ') });
  xrow('สรุปเงินสด', 'ต้องหาเงินเข้ามาเพิ่ม', cash.map(r => r.need), { total: Math.round(needTotal), note: cash.filter(r => r.short).map(r => bdafMShort(r.mk) + ' ' + (r.short === today ? 'ตั้งแต่วันนี้' : 'ก่อน ' + bdafDShort(r.short))).join(' · ') });
  Object.keys(BDAF_RCV_SRC).forEach(k => { const s = rcv.bySrc[k]; if (s) xrow('เงินเข้า', BDAF_RCV_SRC[k].t, F.map(mk => s.vals[mk] || 0), { total: Math.round(s.total), note: s.n + ' รายการ' }); });
  view.cats.forEach(c => {
    xrow('เงินออก · ' + BD_CAT_NAME[c.cat], '— รวมหมวด —', F.map(mk => c.vals[mk]), { avg: Math.round(c.avg), total: Math.round(c.total) });
    c.lines.forEach(x => xrow('เงินออก · ' + BD_CAT_NAME[c.cat], (x.l.code ? x.l.code + ' ' : '') + x.l.name, F.map(mk => x.vals[mk]), {
      src: srcOf(x.l), avg: Math.round(x.l.avg), total: Math.round(x.total),
      note: mode === 'avg' && x.l.kind !== 'custom' ? 'ค่าเฉลี่ย ' + plan.N + ' เดือน' : x.l.auto.notes.join(' · '),
    }));
  });

  const noCf = !plan.N;
  const nCols = 3 + F.length + (canEdit ? 1 : 0);
  const chip = (on) => ({
    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: '1.5px solid ' + (on ? '#0e7490' : '#e2e8f0'), background: on ? '#0e7490' : '#fff', color: on ? '#fff' : '#475569',
  });
  const numTd = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', padding: '5px 8px' };
  const tag = (t, bg, c) => <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: bg, color: c, marginLeft: 6, whiteSpace: 'nowrap' }}>{t}</span>;
  const caret = (on) => <span style={{ fontSize: 9, color: 'var(--ink-400)', display: 'inline-block', width: 12, transform: on ? 'rotate(90deg)' : 'none' }}>▶</span>;
  const money = (v) => <span style={{ color: v < 0 ? 'var(--bad)' : undefined }}>{v < 0 ? '−' : ''}{fmtNum(Math.round(Math.abs(v)), 0)}</span>;
  const tog = (k) => setExp(p => ({ ...p, [k]: !p[k] }));
  const togDet = (k) => setDetail(p => ({ ...p, [k]: !p[k] }));
  const openRcv = (init) => setDrill({ kind: 'rcv', init: init || {} });
  const openPaid = (title, lines) => setDrill({ kind: 'paid', title, txns: lines.reduce((a, l) => a.concat(l.tx || []), []) });
  const allLines = () => view.cats.reduce((a, c) => a.concat(c.lines.map(x => x.l)), []);
  const link = { border: 'none', background: 'none', color: 'var(--brand-600)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', padding: 0 };
  const sumRow = (label, vals, opt) => (
    <tr className={'bdaf-sum' + (opt && opt.cls ? ' ' + opt.cls : '')} onClick={opt && opt.onClick} style={{ cursor: opt && opt.onClick ? 'pointer' : 'default' }}>
      <td className="bdaf-stick" style={{ fontWeight: 700, color: 'var(--ink-800)' }}>{label}</td>
      <td style={{ fontSize: 11, color: 'var(--ink-500)' }}>{opt && opt.hint}</td>
      {F.map((mk, i) => (
        <td key={mk} style={{ ...numTd, fontWeight: 700, cursor: opt && opt.onCell ? 'zoom-in' : undefined }} title={opt && opt.onCell ? opt.cellTitle : undefined}
          onClick={opt && opt.onCell ? (e) => { e.stopPropagation(); opt.onCell(mk); } : undefined}>{vals[i]}</td>
      ))}
      <td style={{ ...numTd, fontWeight: 700, cursor: opt && opt.onCell ? 'zoom-in' : undefined }} title={opt && opt.onCell ? opt.cellTitle : undefined}
        onClick={opt && opt.onCell ? (e) => { e.stopPropagation(); opt.onCell(''); } : undefined}>{opt && opt.total}</td>
      {canEdit && <td />}
    </tr>
  );

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
      <style>{`
        .bdaf-tbl td.bdaf-stick, .bdaf-tbl th.bdaf-stick { position: sticky; left: 0; z-index: 2; background: #fff; }
        .bdaf-tbl thead th.bdaf-stick { background: var(--ink-50); z-index: 3; }
        .bdaf-tbl tbody tr:hover td.bdaf-stick { background: var(--brand-50); }
        .bdaf-tbl tr.bdaf-sum td, .bdaf-tbl tr.bdaf-sum:hover td { background: #fff; }
        .bdaf-tbl tr.bdaf-close td, .bdaf-tbl tr.bdaf-close:hover td { background: #f3f8ff; border-top: 1.5px solid var(--brand-200); }
        .bdaf-tbl tr.bdaf-need td, .bdaf-tbl tr.bdaf-need:hover td { background: #fff4f2; }
        .bdaf-tbl tr.bdaf-sec td, .bdaf-tbl tr.bdaf-sec:hover td { background: #eef2f7; border-top: 2px solid var(--line); }
        .bdaf-tbl tr.bdaf-cat td { background: #f8fafc; }
        .bdaf-tbl tr.bdaf-cat:hover td { background: #eef3fa; }
        .bdaf-tbl tr.bdaf-det td, .bdaf-tbl tr.bdaf-det:hover td { background: #fbfcfd; }
        .bdaf-tbl .bdaf-lockbtn { opacity: 0; transition: opacity .12s; }
        .bdaf-tbl .bdaf-lockbtn.hov { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); box-shadow: 0 0 0 4px var(--brand-50); }
        .bdaf-tbl tr:hover .bdaf-lockbtn, .bdaf-tbl .bdaf-lockbtn.show, .bdaf-tbl .bdaf-lockbtn:focus { opacity: 1; }
      `}</style>

      {/* หัวการ์ด — กดพับ/กาง · ตอนพับยังเห็นคำตอบ (ต้องหาเงินเพิ่มไหม) */}
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'linear-gradient(135deg,#ecfeff,#cffafe)', borderBottom: open ? '1px solid #a5f3fc' : 'none', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: '#0e7490', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#155e75' }}>💰 แผนเงินสดล่วงหน้า <span style={{ fontWeight: 500, fontSize: 12 }}>(เงินตอนนี้ + คาดรับจริง − ค่าใช้จ่ายประมาณการ)</span></div>
            <div style={{ fontSize: 12, color: '#0e7490', marginTop: 2 }}>
              {rangeLabel}
              {noCf ? (cfState === 'loading' ? ' · กำลังโหลดข้อมูล Cash Flow…' : ' · ยังไม่มีข้อมูลจ่ายจริงจาก Cash Flow') : needTotal > 0.5
                ? <> · <b style={{ color: 'var(--bad)' }}>ต้องหาเงินเพิ่ม {bdafC(needTotal)}</b> · เริ่มขาด{firstShort.short === today ? 'ตั้งแต่วันนี้' : ' ' + bdafDShort(firstShort.short)}</>
                : <> · <b style={{ color: 'var(--good)' }}>✓ เงินพอ</b>{lowest ? <> · ต่ำสุด {bdafC(lowest.min)} ({bdafDShort(lowest.minDate)})</> : null}</>}
              {view.locked > 0 && <> · 🔒 ตกลงแล้ว {view.locked}/{view.nLines} แถว</>}
              {view.edited - view.locked > 0 && <> · ✏️ แก้แล้ว {view.edited - view.locked} แถว</>}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#0e7490', whiteSpace: 'nowrap' }}>{open ? 'ย่อ ▴' : 'กดเพื่อดู ▾'}</span>
      </div>

      {open && (<>
        {/* แถบตั้งค่า */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>ถึงเดือน</span>
            <select value={hz} onChange={e => setHz(e.target.value)} style={{ padding: '5px 8px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 12, fontFamily: 'inherit', background: '#fff' }}>
              {bdafRange(cm, maxHz).map((mk, i) => <option key={mk} value={mk}>{bdafMFull(mk)} ({i + 1} เดือน)</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>เงินตั้งต้น</span>
            <span style={{ fontSize: 12, color: 'var(--ink-600)' }}>ยอดใช้ได้ทุกบัญชี ({opening.allN})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }} title="อยากให้เหลือเงินในบัญชีอย่างน้อยเท่าไรตลอดเวลา — ต่ำกว่านี้ = ต้องหาเงินเพิ่ม (ใช้ร่วมกันทั้งทีม)">เงินสำรองขั้นต่ำ</span>
            <input key={buffer} defaultValue={buffer ? fmtNum(buffer, 0) : ''} placeholder="0" disabled={!canEdit} inputMode="decimal"
              onBlur={e => saveBuffer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              style={{ width: 110, padding: '5px 8px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {canEdit && <button className="btn btn-ghost" onClick={() => setModal({ type: 'custom', line: null, cat: 1 })}>＋ เพิ่มรายจ่ายเอง</button>}
            <ExportButton rows={xlsRows} columns={xlsCols} filename="cash_plan" sheetName="แผนเงินสด"
              title={'แผนเงินสดล่วงหน้า · ' + rangeLabel + ' · ค่าใช้จ่าย' + modeLabel.replace(/^\S+\s/, '') + ' ย้อนหลัง ' + plan.N + ' เดือน'} />
            {canDelete && view.edited > 0 && <button className="btn btn-ghost" onClick={clearAll} title="ล้างยอดที่แก้ + รายการที่เพิ่มเองทั้งหมด">↺ ล้างที่แก้ทั้งหมด</button>}
          </div>
        </div>

        {/* คำตอบ: ต้องหาเงินเพิ่มช่วงไหน เท่าไร */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)', background: noCf ? 'var(--warn-bg)' : needTotal > 0.5 ? 'var(--bad-bg)' : 'var(--good-bg)' }}>
          {noCf ? (
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)' }}>
              {cfState === 'loading' ? 'กำลังโหลดข้อมูลจ่ายจริงจาก Cash Flow…' : 'ยังสรุปไม่ได้ — ยังไม่มีข้อมูลจ่ายจริงจาก Cash Flow (เงินออกเป็น 0 ทั้งหมด)'}
              {cfState !== 'loading' && <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-600)', marginTop: 4 }}>อัปโหลดไฟล์ Cash Flow ที่หน้า "พรีเซนต์ Cash Flow" หรือดันจากหน้างบกระทบยอดกระแสเงินสด แล้วกด ↻ โหลดใหม่</div>}
            </div>
          ) : needTotal > 0.5 ? (<>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)' }}>
              ต้องหาเงินหมุนเวียนเข้ามาเพิ่มรวม <span style={{ color: 'var(--bad)' }}>{fmtNum(Math.round(needTotal), 0)} บาท</span> ภายใน {rangeLabel}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {cash.filter(r => r.need > 0.5).map(r => (
                <div key={r.mk} style={{ background: '#fff', border: '1px solid color-mix(in oklch, var(--bad) 30%, transparent)', borderRadius: 10, padding: '6px 12px', fontSize: 12.5 }}>
                  <b>{bdafMFull(r.mk)}</b> · หาเพิ่ม <b style={{ color: 'var(--bad)' }}>{fmtNum(Math.round(r.need), 0)}</b> <b>{byWhen(r.short)}</b>
                </div>
              ))}
            </div>
          </>) : (
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)' }}>
              ✓ เงินพอจ่ายถึง {F.length ? bdafMFull(F[F.length - 1]) : ''}
              {lowest && <span style={{ fontWeight: 500, color: 'var(--ink-600)' }}> · จุดต่ำสุด {fmtNum(Math.round(lowest.min), 0)} บาท วันที่ {bdafDShort(lowest.minDate)}</span>}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 6, lineHeight: 1.6 }}>
            เงินตั้งต้น {fmtNum(Math.round(openAmt), 0)} บาท (ยอดใช้ได้ {openBase === 'main' && opening.mainN ? 'บัญชีหลัก ' + opening.mainN : 'ทุกบัญชี ' + opening.allN} บัญชี{opening.asOf ? ' ณ ' + bdafDShort(opening.asOf) : ''})
            {buffer > 0 && <> · เผื่อเงินสำรองขั้นต่ำ {fmtNum(buffer, 0)} บาท</>}
            {' · '}นับตามวันที่: เงินออกใช้วันที่ที่มักจ่ายจริง · เงินเข้าใช้วันคาดรับ
          </div>
        </div>

        {/* ที่มาของตัวเลข + ของที่ยังไม่นับ */}
        <div style={{ padding: '8px 14px', fontSize: 11.5, color: 'var(--ink-500)', lineHeight: 1.7, borderBottom: '1px solid var(--line-soft)' }}>
          <div>
            <b style={{ color: 'var(--ink-700)' }}>เงินออก</b> = จ่ายจริงจากข้อมูล Cash Flow{plan.N > 0 ? ' ' + bdafMShort(plan.H[0]) + (plan.N > 1 ? ' – ' + bdafMShort(plan.H[plan.N - 1]) : '') + ' (' + plan.N + ' เดือนล่าสุดที่มีในไฟล์)' : ''}
            {cf && cf.uploadedAt ? ' · อัปเดต ' + fmtDate(new Date(cf.uploadedAt).toISOString().slice(0, 10)) + (cf.uploadedBy ? ' โดย ' + cf.uploadedBy : '') : ''}
            {cfState === 'loading' && ' · กำลังโหลด…'}
            {cfState === 'error' && <b style={{ color: 'var(--warn)' }}> · โหลดข้อมูล Cash Flow ไม่สำเร็จ</b>}
            {' '}<button onClick={loadCf} style={{ border: 'none', background: 'none', color: 'var(--brand-600)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', padding: 0 }}>↻ โหลดใหม่</button>
            {plan.N > 0 && plan.N < lookback && <b style={{ color: 'var(--warn)' }}> · มีข้อมูลแค่ {plan.N} เดือน</b>}
            {plan.last && bdafDiffM(plan.last, cm) > 1 && <b style={{ color: 'var(--warn)' }}> · ไฟล์ Cash Flow ล่าสุดถึง {bdafMShort(plan.last)}</b>}
            {' · '}ไม่นับโอนระหว่างบัญชี · เดือนนี้นับเฉพาะส่วนที่ยังไม่ถึงวันจ่าย
          </div>
          <div>
            <b style={{ color: 'var(--ink-700)' }}>เงินเข้า</b> = ที่รอรับจริง (ใบแจ้งหนี้กำลังติดตาม + แผนรับใน Bank Daily + รับอื่นๆ ที่คีย์ไว้)
            {(rcv.skip.insp.n + rcv.skip.issue.n + rcv.skip.nodate.n + rcv.skip.later.n) > 0 && <> · <b style={{ color: 'var(--ink-700)' }}>ยังไม่นับ:</b>
              {rcv.skip.insp.n > 0 && <> <button style={link} onClick={() => openRcv({ tab: 'skip', why: 'insp' })}>รอใบตรวจรับ {rcv.skip.insp.n} ใบ {bdafC(rcv.skip.insp.amt)}</button> ·</>}
              {rcv.skip.issue.n > 0 && <> <button style={link} onClick={() => openRcv({ tab: 'skip', why: 'issue' })}>ติดปัญหา {rcv.skip.issue.n} ใบ {bdafC(rcv.skip.issue.amt)}</button> ·</>}
              {rcv.skip.nodate.n > 0 && <> <button style={link} onClick={() => openRcv({ tab: 'skip', why: 'nodate' })}>ไม่มีวันคาดรับ {rcv.skip.nodate.n} ใบ {bdafC(rcv.skip.nodate.amt)}</button> ·</>}
              {rcv.skip.later.n > 0 && <> <button style={link} onClick={() => openRcv({ tab: 'skip', why: 'later' })}>คาดรับหลัง {F.length ? bdafMShort(F[F.length - 1]) : ''} {rcv.skip.later.n} รายการ {bdafC(rcv.skip.later.amt)}</button></>}
            </>}
          </div>
        </div>

        {/* ตาราง */}
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl tbl-compact bdaf-tbl" style={{ fontSize: 12, minWidth: 740 + F.length * 104 }}>
            <thead>
              <tr>
                <th className="bdaf-stick" style={{ minWidth: 'min(480px, 45vw)', width: 'min(480px, 45vw)' }}>รายการ</th>
                <th style={{ minWidth: 190 }}>{noCf ? '' : 'ย้อนหลัง ' + plan.N + ' เดือน · เฉลี่ย/เดือน'}</th>
                {F.map(mk => (
                  <th key={mk} style={{ textAlign: 'right', width: 104, whiteSpace: 'nowrap' }}>
                    {bdafMShort(mk)}{mk === cm && <div style={{ fontSize: 9.5, fontWeight: 500, textTransform: 'none', color: 'var(--ink-400)' }}>ที่เหลือหลังวันนี้</div>}
                  </th>
                ))}
                <th style={{ textAlign: 'right', width: 110 }}>รวม</th>
                {canEdit && <th style={{ width: 34 }} />}
              </tr>
            </thead>
            <tbody>
              {sumRow('เงินต้นเดือน', cash.map(r => money(r.open)), { hint: 'เดือนแรก = ยอดเงินใช้ได้ตอนนี้' })}
              {sumRow(<>{caret(!!exp.rcv)} + เงินเข้า (คาดรับจริง)</>, cash.map(r => <span style={{ color: 'var(--good)' }}>{bdafN(r.inn)}</span>), { hint: rcv.items.length + ' รายการ · กดตัวเลขดูทีละใบ', total: bdafN(cash.reduce((a, r) => a + r.inn, 0)), onClick: () => tog('rcv'), onCell: (mk) => openRcv({ tab: 'in', mk }), cellTitle: 'กดดูรายการเงินเข้าทีละใบ ว่ามาจากไหน' })}
              {exp.rcv && Object.keys(BDAF_RCV_SRC).map(k => {
                const s = rcv.bySrc[k];
                if (!s) return null;
                return (
                  <React.Fragment key={k}>
                    <tr>
                      <td className="bdaf-stick" style={{ paddingLeft: 28, cursor: 'zoom-in' }} onClick={() => openRcv({ tab: 'in', src: k })} title={BDAF_RCV_SRC[k].hint + ' — กดดูทีละใบ'}>{BDAF_RCV_SRC[k].t}</td>
                      <td style={{ fontSize: 11, color: 'var(--ink-500)' }}>{s.n} รายการ</td>
                      {F.map(mk => <td key={mk} style={{ ...numTd, cursor: s.vals[mk] ? 'zoom-in' : undefined }} onClick={s.vals[mk] ? () => openRcv({ tab: 'in', mk, src: k }) : undefined}>{bdafN(s.vals[mk])}</td>)}
                      <td style={{ ...numTd, fontWeight: 600, cursor: 'zoom-in' }} onClick={() => openRcv({ tab: 'in', src: k })}>{bdafN(s.total)}</td>
                      {canEdit && <td />}
                    </tr>
                  </React.Fragment>
                );
              })}
              {sumRow(<>{caret(!!exp.out)} − เงินออก (ค่าใช้จ่ายประมาณการ)</>, cash.map(r => <span style={{ color: 'var(--bad)' }}>{bdafN(r.out)}</span>), { hint: <>{(mode === 'avg' ? '📊 ค่าเฉลี่ย' : '🤖 วิเคราะห์') + ' · กดดูรายหมวด · ' + (view.locked ? '🔒 ' + view.locked + '/' + view.nLines + ' · ' : '')}<button style={link} onClick={(e) => { e.stopPropagation(); openPaid('ทุกหมวด', allLines()); }}>📋 จ่ายจริงเดือนก่อนๆ</button></>, total: bdafN(cash.reduce((a, r) => a + r.out, 0)), onClick: () => tog('out') })}
              {exp.out && (
                <tr className="bdaf-det">
                  <td colSpan={nCols} style={{ padding: 0 }}>
                    <div style={{ position: 'sticky', left: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', padding: '7px 14px 7px 40px', fontSize: 12 }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink-600)' }}>วิธีคิดค่าใช้จ่าย</span>
                      <button style={chip(mode === 'avg')} onClick={() => setMode('avg')} title="ยอดรวมย้อนหลัง ÷ จำนวนเดือน — เท่ากันทุกเดือน">📊 ค่าเฉลี่ย</button>
                      <button style={chip(mode === 'auto')} onClick={() => setMode('auto')} title="ไม่เอาเดือนที่จ่ายสูงผิดปกติมาเฉลี่ย · เน้นเดือนหลังๆ · ดูว่าจ่ายเพิ่ม/ลดเรื่อยๆ ไหม · จ่ายเป็นรอบ · หยุดจ่ายแล้ว · บางเดือนจ่ายต่างจากปกติทุกปี — คิดในเครื่อง ไม่ส่งข้อมูลออกนอกระบบ">🤖 วิเคราะห์อัตโนมัติ</button>
                      <span style={{ fontWeight: 600, color: 'var(--ink-600)', marginLeft: 8 }}>คิดจากย้อนหลัง</span>
                      {BDAF_LOOKBACKS.map(n => <button key={n} style={chip(lookback === n)} onClick={() => setLookback(n)}>{n} เดือน</button>)}
                      {!noCf && <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => openPaid('ทุกหมวด', allLines())}>📋 ดูรายการจ่ายจริงเดือนก่อนๆ</button>}
                    </div>
                  </td>
                </tr>
              )}
              {exp.out && noCf && (
                <tr className="bdaf-det"><td colSpan={nCols} style={{ padding: '14px 40px', color: 'var(--ink-500)' }}>
                  {cfState === 'loading' ? 'กำลังโหลดข้อมูล Cash Flow…' : 'ยังไม่มีข้อมูลจ่ายจริงจาก Cash Flow — อัปโหลดไฟล์ Cash Flow ที่หน้า "พรีเซนต์ Cash Flow" หรือดันจากหน้างบกระทบยอดกระแสเงินสดก่อน'}
                </td></tr>
              )}
              {exp.out && view.cats.map(c => {
                const isOpen = !!exp[c.cat];
                return (
                  <React.Fragment key={c.cat}>
                    <tr className="bdaf-cat" style={{ cursor: 'pointer' }} onClick={() => tog(c.cat)}>
                      <td className="bdaf-stick" style={{ fontWeight: 700, color: 'var(--ink-800)', paddingLeft: 24 }} title={BD_CAT_HINT[c.cat]}>
                        {caret(isOpen)}
                        <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: BDAF_COLOR[c.cat], margin: '0 7px 0 2px' }} />
                        {BD_CAT_NAME[c.cat]}
                        <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--ink-500)', marginLeft: 6 }}>{c.lines.length} แถว{(() => { const n = c.lines.filter(x => bdafLocked(x.l, cm)).length; return n ? ' · 🔒 ' + n : ''; })()}</span>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--ink-500)' }}>เฉลี่ยจ่ายจริง {bdafN(c.avg)}/ด. · <button style={link} onClick={(e) => { e.stopPropagation(); openPaid('หมวด' + BD_CAT_NAME[c.cat], c.lines.map(x => x.l)); }}>📋 ดูรายการ</button></td>
                      {F.map(mk => <td key={mk} style={{ ...numTd, fontWeight: 700 }}>{bdafN(c.vals[mk])}</td>)}
                      <td style={{ ...numTd, fontWeight: 700 }}>{bdafN(c.total)}</td>
                      {canEdit && (
                        <td onClick={e => e.stopPropagation()}>
                          <button title={'เพิ่มรายจ่ายเองในหมวด' + BD_CAT_NAME[c.cat]} onClick={() => setModal({ type: 'custom', line: null, cat: c.cat })}
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-500)', fontSize: 14, padding: '0 4px' }}>＋</button>
                          {c.lines.some(x => !bdafLocked(x.l, cm)) && (
                            <button title={'ล็อกทุกแถวในหมวด' + BD_CAT_NAME[c.cat] + ' — ตกลงยอดที่เห็นตอนนี้'} onClick={() => lockCat(c)}
                              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-500)', fontSize: 12, padding: '0 4px' }}>🔒</button>
                          )}
                        </td>
                      )}
                    </tr>
                    {isOpen && c.lines.map(x => {
                      const l = x.l, e = l.edit || {}, off = !!e.off;
                      const isDet = !!detail[l.key];
                      const meta = ed.meta[l.key];
                      return (
                        <React.Fragment key={l.key}>
                          <tr style={{ opacity: off ? 0.6 : 1 }}>
                            <td className="bdaf-stick" style={{ paddingLeft: 42, maxWidth: 600 }}>
                              <span onClick={() => togDet(l.key)} title="กดดูว่าทำไมได้ตัวเลขนี้" style={{ cursor: 'pointer' }}>
                                {caret(isDet)}
                                {l.code && <span style={{ fontFamily: 'ui-monospace', fontSize: 10.5, color: 'var(--ink-500)', marginRight: 5 }}>{l.code}</span>}
                                <span style={{ color: l.kind === 'other' ? 'var(--ink-600)' : 'var(--ink-800)', fontStyle: l.kind === 'other' ? 'italic' : 'normal' }}>{l.name}</span>
                              </span>
                              {l.kind === 'custom' && tag('เพิ่มเอง', '#e0f2fe', '#075985')}
                              {off && tag('ไม่นับ', 'var(--ink-100)', 'var(--ink-600)')}
                              {bdafLocked(l, cm) && (
                                <button onClick={canEdit ? () => unlockLine(l) : undefined}
                                  title={'ตกลงแล้ว' + (e.lock.by ? ' โดย ' + e.lock.by : '') + (e.lock.at ? ' เมื่อ ' + fmtDate(String(e.lock.at).slice(0, 10)) : '') + ' · ล็อกถึง ' + bdafMShort(e.lock.until) + (canEdit ? ' · กดเพื่อปลดล็อก' : '')}
                                  style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, border: 'none', background: '#dcfce7', color: '#166534', cursor: canEdit ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>🔒 ตกลงแล้ว</button>
                              )}
                              {!off && !bdafLocked(l, cm) && l.kind !== 'custom' && (e.base != null || (e.m && Object.keys(e.m).length > 0)) && tag('แก้เอง', '#fff1c2', '#854d0e')}
                              {l.kind === 'grp' && e.cat && tag('ย้ายหมวด', 'var(--ink-100)', 'var(--ink-600)')}
                              {canEdit && !bdafLocked(l, cm) && (
                                <button className={'bdaf-lockbtn' + (!off && (e.def || e.base != null || (e.m && Object.keys(e.m).length)) ? ' show' : ' hov')} onClick={() => lockLine(x)}
                                  title="ล็อก — ตกลงแล้วว่าจ่ายตามยอดที่เห็นในแถวนี้ (ยอดจะไม่ขยับตามระบบ และแก้ไม่ได้จนกว่าจะปลดล็อก)"
                                  style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-600)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>🔓 ล็อก</button>
                              )}
                            </td>
                            <td onClick={l.kind !== 'custom' ? () => openPaid((l.code ? l.code + ' ' : '') + l.name, [l]) : undefined}
                              style={{ cursor: l.kind !== 'custom' ? 'zoom-in' : undefined }} title={l.kind !== 'custom' ? 'กดดูรายการจ่ายจริงเดือนก่อนๆ ของแถวนี้' : undefined}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                                {l.kind !== 'custom' && <BDAFSpark s={l.s} spikes={l.auto.spikes} />}
                                {l.kind !== 'custom' && <span style={{ fontSize: 11, color: 'var(--ink-600)', fontVariantNumeric: 'tabular-nums' }} title="จ่ายจริงเฉลี่ยต่อเดือนในช่วงฐาน">{bdafN(l.avg)}</span>}
                              </div>
                            </td>
                            {F.map(mk => (
                              <BDAFCell key={mk} value={x.vals[mk]} sys={bdafSys(l, mk, mode, cm)} off={off}
                                edited={!off && ((e.m && e.m[mk] != null) || (l.kind !== 'custom' && e.base != null))}
                                locked={!off && bdafLockedMonth(l, mk, cm)} onLockedClick={() => { if (toast) toast('🔒 “' + l.name + '” ตกลงยอดแล้ว — กด “🔒 ตกลงแล้ว” ข้างชื่อแถวเพื่อปลดล็อกก่อนแก้'); }}
                                canEdit={canEdit} editing={editing && editing.key === l.key && editing.mk === mk}
                                onStart={() => setEditing({ key: l.key, mk })} onCancel={() => setEditing(null)}
                                onSave={(v) => saveCell(l, mk, v)} />
                            ))}
                            <td style={{ ...numTd, fontWeight: 600 }}>{bdafN(x.total)}</td>
                            {canEdit && (
                              <td style={{ padding: '2px 4px' }}>
                                <button onClick={(ev) => openMenu(x, ev)} title="ตัวเลือกของแถวนี้"
                                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-500)', fontSize: 15, padding: '0 6px', borderRadius: 6 }}>⋯</button>
                              </td>
                            )}
                          </tr>
                          {isDet && (
                            <tr className="bdaf-det">
                              <td colSpan={nCols} style={{ padding: 0 }}>
                                <BDAFLineDetail l={l} vals={x.vals} plan={plan} mode={mode} F={F} cm={cm} meta={meta} canEdit={canEdit}
                                  onOpenPaid={() => openPaid((l.code ? l.code + ' ' : '') + l.name, [l])} onPin={pinGroup} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              {sumRow('= เงินปลายเดือน', cash.map(r => money(r.close)), { cls: 'bdaf-close', hint: 'ถ้าไม่หาเงินเพิ่ม' })}
              {sumRow('จุดต่ำสุดระหว่างเดือน', cash.map(r => <>{money(r.min)}<div style={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-500)' }}>{bdafDShort(r.minDate)}</div></>), { hint: 'เรียงรับ-จ่ายตามวันที่' })}
              {sumRow(<span style={{ color: needTotal > 0.5 ? 'var(--bad)' : undefined }}>ต้องหาเงินเข้ามาเพิ่ม</span>,
                cash.map(r => r.need > 0.5
                  ? <><span style={{ color: 'var(--bad)' }}>{fmtNum(Math.round(r.need), 0)}</span><div style={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-500)' }}>{byWhen(r.short)}</div></>
                  : <span style={{ color: 'var(--ink-400)', fontWeight: 400 }}>–</span>),
                { cls: needTotal > 0.5 ? 'bdaf-need' : '', hint: buffer > 0 ? 'ให้เหลืออย่างน้อย ' + bdafC(buffer) : 'ให้ยอดไม่ติดลบ', total: needTotal > 0.5 ? <span style={{ color: 'var(--bad)' }}>{fmtNum(Math.round(needTotal), 0)}</span> : '–' })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--ink-400)', display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
          <span>กดแถวเงินเข้า/เงินออกเพื่อกางดูที่มา · กดชื่อแถวเพื่อดูว่าทำไมได้ตัวเลขนี้</span>
          <span><span style={{ background: '#fff6dc', padding: '0 5px', borderRadius: 3, fontWeight: 700, color: 'var(--ink-700)' }}>ตัวหนาพื้นเหลือง</span> = แก้เอง (ทุกคนเห็นเหมือนกัน · ไม่กระทบหน้าอื่น)</span>
          <span><span style={{ background: '#e7f6ec', padding: '0 5px', borderRadius: 3, fontWeight: 700, color: 'var(--ink-700)' }}>พื้นเขียว 🔒</span> = ตกลงแล้ว ยอดไม่ขยับตามระบบ · กด “🔓 ล็อก” ข้างชื่อแถว (แถวที่แก้แล้วโชว์ปุ่มเลย)</span>
        </div>
      </>)}

      {menu && <BDAFMenu menu={menu} onClose={closeMenu} />}
      {drill && drill.kind === 'rcv' && <BDAFRcvModal rcv={rcv} F={F} today={today} init={drill.init} onClose={closeDrill} />}
      {drill && drill.kind === 'paid' && <BDAFPaidModal title={drill.title} txns={drill.txns} H={plan.H} onClose={closeDrill} />}
      {modal && (
        <BDAFModal modal={modal} cm={cm} maxHz={maxHz} onClose={() => setModal(null)}
          onSaveBase={saveBase} onSaveCustom={saveCustom} onDeleteCustom={deleteCustom} />
      )}
    </div>
  );
}
