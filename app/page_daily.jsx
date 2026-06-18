// Daily Revenue Dashboard — สรุปรายงานรับเงินประจำวัน
// ดึงข้อมูลจาก invoices โดยตรง: status=paid + actualReceive.date
// + ประมาณการรับเงินจากใบแจ้งหนี้คงค้าง (outstanding forecast)

const { useState: dRState, useMemo: dRMemo } = React;

// ── normalize jobNo (ตัด productType suffix) ─────────────────────────────────
function drNormJobNo(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();   // ★ String() — projectCode/jobNo จากชีตอาจเป็น "ตัวเลข" → raw.trim() เคยทำจอ Daily พังทั้งหน้า (ตระกูลเดียวกับ normalizeJobNo)
  const m = s.match(/^(.+)-([A-Z]{2,6})$/);
  return m ? m[1] : s;
}

function DailyRevenueDashboard({ data, setData, toast }) {
  const { invoices, meta } = data;

  // ใช้วันที่จริงของระบบเสมอ
  const todayStr   = new Date().toISOString().slice(0, 10);
  const thisMonth  = todayStr.slice(0, 7);
  const thisYear   = todayStr.slice(0, 4);
  const todayLabel = new Date(todayStr + 'T00:00:00').toLocaleDateString('th-TH-u-ca-gregory', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  // ── week bounds (จันทร์–อาทิตย์) ─────────────────────────────────────────────
  const weekBounds = dRMemo(() => {
    const d = new Date(todayStr + 'T00:00:00');
    const dow = d.getDay(); // 0=Sun
    const mon = new Date(d); mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
  }, [todayStr]);

  const [drillModal, setDrillModal] = dRState(null); // { title, list } — paid drill
  const [fcModal,    setFcModal]    = dRState(null); // { title, list } — forecast drill
  const [ivTypeFilter, setIvTypeFilter] = dRState('P'); // 'all' | 'P' | 'O' — default 'P' (โครงการ)
  const [captureMode, setCaptureMode] = dRState('landscape'); // 'landscape' | 'portrait'
  const isPortrait = captureMode === 'portrait';

  // invType filter (P=โครงการ, O=อื่นๆ) — default 'P' if missing
  const drInvType = iv => ((iv.invType || iv.invtype || 'P').toString().trim().toUpperCase() === 'O' ? 'O' : 'P');
  const matchType = iv => ivTypeFilter === 'all' || drInvType(iv) === ivTypeFilter;

  const { projectByCode, financeByCode } = dRMemo(() => WTPData.buildLookups(data), [data.projects, data.debtLedger]);

  // ── PAID items: รวม data.receipts (ประวัติรับเงินจริง) + invoices.status=paid ──
  // Map invoiceNo → invType (for filtering receipts by invType lookup)
  const ivTypeByInvNo = dRMemo(() => {
    const m = {};
    (invoices || []).forEach(iv => { if (iv.ivNo) m[iv.ivNo] = drInvType(iv); });
    return m;
  }, [invoices]);

  // Map invoiceNo → invoice row (เพื่อ fallback jobNo + projectName ถ้า receipt ไม่มี)
  const invByIvNo = dRMemo(() => {
    const m = {};
    (invoices || []).forEach(iv => { if (iv.ivNo) m[iv.ivNo] = iv; });
    return m;
  }, [invoices]);

  // unified shape: { id, receiveDate, jobNo, ivNo, projectName, period, balance, invType }
  const paidInvoices = dRMemo(() => {
    const out = [];
    const seenIvNo = new Set();
    const seenReceiptKey = new Set();   // กันแถว receipt ซ้ำใน data.receipts เอง (ดูคอมเมนต์ด้านล่าง)

    // 1) data.receipts — primary source (ประวัติรับเงิน 684 ใบ)
    (data.receipts || []).forEach(r => {
      if (!r.receiptDate) return;
      const ownIvType = (r.invType || '').toString().trim().toUpperCase();
      const ivType    = (ownIvType === 'O' || ownIvType === 'P') ? ownIvType : (ivTypeByInvNo[r.invoiceNo] || 'P');
      if (ivTypeFilter !== 'all' && ivType !== ivTypeFilter) return;
      // ★ dedup ภายใน receipts: 2 แถวที่ receiptNo+invoiceNo เดียวกัน = "ใบรับเงินเดียวกัน" ที่ถูก
      //   สร้างซ้ำ (auto-gen 2 รอบ ตอน sync race / migrate → คนละ id แต่เนื้อหาเหมือนกัน) → นับครั้งเดียว.
      //   ใส่ invoiceNo ใน key ด้วย → receipt จริงคนละใบ (receiptNo ต่างกัน) ไม่ถูกยุบ;
      //   receipt จ่ายหลายงวดของใบเดียว (receiptNo ต่างกัน) ก็ไม่ถูกยุบ. receiptNo ว่าง → ไม่ dedup.
      const dupKey = (r.receiptNo && r.invoiceNo) ? (String(r.receiptNo).trim() + '|' + String(r.invoiceNo).trim()) : '';
      if (dupKey && seenReceiptKey.has(dupKey)) return;
      // resolve jobNo & project name: receipt fields first, fallback to invoice lookup by ivNo
      const linkedIv = r.invoiceNo ? invByIvNo[r.invoiceNo] : null;
      const cj = drNormJobNo(r.projectCode || '') || drNormJobNo(linkedIv?.jobNo || '');
      const p  = projectByCode[cj] || {};
      out.push({
        id:          r.id || r.receiptNo || `rc-${r.invoiceNo}`,
        receiveDate: r.receiptDate,
        jobNo:       cj || r.projectCode || linkedIv?.jobNo || '—',
        ivNo:        r.invoiceNo || r.receiptNo,
        projectName: r.projectName || p['พื้นที่'] || p.name || linkedIv?.projectName || '—',
        period:      (() => { const v = linkedIv?.period ?? r.period ?? 1; const n = Number(v); return Number.isFinite(n) ? n : 1; })(),
        balance:     Number(r.grossAmount) || 0,
        netReceived: Number(r.netReceived) || Number(r.grossAmount) || 0,
        invType:     ivType,
        source:      'receipt',
      });
      if (dupKey) seenReceiptKey.add(dupKey);
      if (r.invoiceNo) seenIvNo.add(r.invoiceNo);
    });

    // 2) data.invoices status=paid — secondary (เฉพาะใบที่ยังไม่ปรากฏใน receipts)
    (invoices || []).forEach(iv => {
      const rd = ivReceivedDate(iv);                            // ★ actualReceive.date || actualReceiveDate
      if (iv.status !== 'paid' || !rd) return;
      if (seenIvNo.has(iv.ivNo)) return;
      if (!matchType(iv)) return;
      const cj = drNormJobNo(iv.jobNo);
      const p  = projectByCode[cj] || {};
      out.push({
        id:          iv.id || iv.ivNo,
        receiveDate: rd,
        jobNo:       cj,
        ivNo:        iv.ivNo,
        projectName: p['พื้นที่'] || p.name || iv.projectName || '—',
        period:      (() => { const n = Number(iv.period ?? 1); return Number.isFinite(n) ? n : 1; })(),
        balance:     Number(iv.balance) || 0,
        netReceived: Number(iv.actualReceive?.amount) || Number(iv.balance) || 0,   // ★ guard: actualReceive อาจเป็น null (วันรับมาจากคอลัมน์แบน)
        invType:     drInvType(iv),
        source:      'invoice',
      });
    });

    return out;
  }, [data.receipts, invoices, ivTypeFilter, ivTypeByInvNo, projectByCode]);

  const todayList = dRMemo(() => paidInvoices.filter(iv => iv.receiveDate === todayStr),              [paidInvoices, todayStr]);
  const monthList = dRMemo(() => paidInvoices.filter(iv => iv.receiveDate.startsWith(thisMonth)),    [paidInvoices, thisMonth]);
  const ytdList   = dRMemo(() => paidInvoices.filter(iv => iv.receiveDate.startsWith(thisYear)),     [paidInvoices, thisYear]);

  // ── OUTSTANDING rows: non-paid + finance/project enrichment ─────────────────
  const IV_ALIAS  = { pending: 'tracking', '': 'pending_inspection' };
  const IV_VALID  = new Set(['pending_inspection', 'tracking', 'issue', 'paid']);
  const outstandingRows = dRMemo(() =>
    invoices.flatMap(iv => {
      if (!matchType(iv)) return [];
      const rawStatus = (iv.status || '').toString().trim();
      const aliased   = IV_ALIAS[rawStatus] != null ? IV_ALIAS[rawStatus] : rawStatus;
      const status    = IV_VALID.has(aliased) ? aliased : 'pending_inspection';
      if (status === 'paid') return [];
      const cj = drNormJobNo(iv.jobNo);
      const f  = financeByCode[cj] || financeByCode[iv.contractRef] || {};
      const p  = projectByCode[cj] || projectByCode[iv.contractRef] || {};
      const balance = Number(iv.balance) || 0;
      // ใช้ resolveDebt/resolveAssignee → respect admin override บน IV
      const debt     = (window.resolveDebt     ? window.resolveDebt(iv, f)     : Number(f.debt ?? f['ภาระหนี้'] ?? 0));
      const assignee = (window.resolveAssignee ? window.resolveAssignee(iv, f) : (f.assignee || f['ผู้รับโอนสิทธิ์'] || '—'));
      return [{
        ...iv,
        jobNo: cj,
        status,
        invType: drInvType(iv),
        balance,
        projectName: p['พื้นที่'] || p.name || iv.projectName || '—',
        assignee,
        debt,
        // คาดรับสุทธิ = balance หลังหัก WHT 1% (balance × 106/107) − ภาระหนี้
        netExpected: balance * 106 / 107 - debt,
      }];
    }),
    [invoices, financeByCode, projectByCode, ivTypeFilter]
  );

  // ── Forecast buckets ─────────────────────────────────────────────────────────
  const overdueForecast    = dRMemo(() => outstandingRows.filter(iv =>
    iv.expectedReceive && iv.expectedReceive < todayStr && iv.status === 'tracking'
  ), [outstandingRows, todayStr]);

  const todayForecast      = dRMemo(() => outstandingRows.filter(iv =>
    iv.expectedReceive === todayStr
  ), [outstandingRows, todayStr]);

  const weekForecast       = dRMemo(() => outstandingRows.filter(iv =>
    iv.expectedReceive && iv.expectedReceive >= weekBounds.start && iv.expectedReceive <= weekBounds.end
  ), [outstandingRows, weekBounds]);

  const thisMonthForecast  = dRMemo(() => outstandingRows.filter(iv =>
    iv.expectedReceive && iv.expectedReceive.startsWith(thisMonth) && iv.expectedReceive >= todayStr
  ), [outstandingRows, thisMonth, todayStr]);

  const sumBal = list => list.reduce((s, iv) => s + (iv.balance || 0), 0);
  const sumNet = list => list.reduce((s, iv) => s + (iv.netExpected || 0), 0);

  // ── A4 portrait print handler — เฉพาะ Hero + 3 pills + ตารางรับวันนี้ ──
  //  (Forecast + Outstanding ตัดทิ้งด้วย .dr-print-hide, layout horizontal stacked)
  //  Force captureMode='portrait' ก่อนพิมพ์ → pills render horizontal layout เสมอ
  //  (ไม่ขึ้นกับว่า user กำลังเปิดในโหมด landscape หรือ portrait)
  const handleDailyPrint = () => {
    const wasLandscape = !isPortrait;
    // ใส่ class ก่อน setCaptureMode → AnimatedNumber เห็น print mode ตอน re-render → ข้าม animation
    document.body.classList.add('dr-print-mode');
    document.body.classList.add('dr-print-portrait');
    if (wasLandscape) setCaptureMode('portrait'); // trigger re-render → pills เป็น horizontal

    // Wait for React to commit the state change ก่อนค่อย print
    setTimeout(() => {
      const styleId = 'dr-print-orientation-style';
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        document.head.appendChild(style);
      }
      style.textContent = `
        @media print {
          @page { size: A4 portrait; margin: 8mm 10mm; }
          html, body { background: #fff !important; }
        }
      `;
      const cleanup = () => {
        document.body.classList.remove('dr-print-mode');
        document.body.classList.remove('dr-print-portrait');
        if (style.parentNode) style.parentNode.removeChild(style);
        window.removeEventListener('afterprint', cleanup);
        if (wasLandscape) setCaptureMode('landscape'); // restore เดิม
      };
      window.addEventListener('afterprint', cleanup);
      setTimeout(cleanup, 60000);
      setTimeout(() => window.print(), 80);
    }, wasLandscape ? 220 : 0);
  };

  // ── Save as PNG — capture print layout via html2canvas, no PDF middle step ──
  const handleSaveImage = async () => {
    if (typeof window.html2canvas !== 'function') {
      alert('ตัวช่วยบันทึกรูปยังโหลดไม่เสร็จ — กรุณาลองใหม่อีกครั้ง');
      return;
    }
    const wasLandscape = !isPortrait;
    // ใส่ class ก่อน setCaptureMode → AnimatedNumber เห็น snapshot mode ตอน re-render → ข้าม animation
    document.body.classList.add('dr-print-mode');
    document.body.classList.add('dr-print-portrait');
    document.body.classList.add('dr-snapshot-mode');
    if (wasLandscape) setCaptureMode('portrait'); // ใช้ layout เดียวกับตอนพิมพ์

    await new Promise(r => setTimeout(r, wasLandscape ? 280 : 40));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const target = document.querySelector('.dr-page .report-capture-area') || document.querySelector('.dr-page');
    // บังคับ render width คงที่ → output 1080 จะหน้าตาเหมือนกันทุกจอ
    const SRC_W = 960;
    const prevWidth = target.style.width;
    const prevMaxWidth = target.style.maxWidth;
    const prevMargin = target.style.margin;
    target.style.setProperty('width', SRC_W + 'px', 'important');
    target.style.setProperty('max-width', SRC_W + 'px', 'important');
    target.style.setProperty('margin', '0 auto', 'important');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      const raw = await window.html2canvas(target, {
        backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false, width: SRC_W, windowWidth: SRC_W,
      });
      // Fix กว้าง 1080 (สูงปล่อยตามเนื้อหา) + ขอบขาวรอบทุกด้าน 32px
      const W = 1080;
      const padX = 32, padY = 32;
      const drawW = W - padX * 2;
      const s = drawW / raw.width;
      const drawH = raw.height * s;
      const out = document.createElement('canvas');
      out.width = W;
      out.height = Math.round(drawH + padY * 2);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(raw, padX, padY, drawW, drawH);

      const link = document.createElement('a');
      const stamp = todayStr.replace(/-/g, '');
      link.download = `daily-report-${stamp}.png`;
      link.href = out.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('save image failed', err);
      alert('บันทึกรูปไม่สำเร็จ: ' + (err && err.message ? err.message : err));
    } finally {
      target.style.width = prevWidth;
      target.style.maxWidth = prevMaxWidth;
      target.style.margin = prevMargin;
      document.body.classList.remove('dr-print-mode');
      document.body.classList.remove('dr-print-portrait');
      document.body.classList.remove('dr-snapshot-mode');
      if (wasLandscape) setCaptureMode('landscape');
    }
  };

  return (
    <div className="page bg-pattern dr-page">
      <div className="page-head anim-in">
        <div>
          <h1 className="page-title">สรุปรายงานรับเงินประจำวัน</h1>
          <div className="page-sub">Daily Revenue Report · ข้อมูล ณ {todayLabel}</div>
        </div>
        <div className="page-head-r">
          <button className="btn btn-ghost" onClick={handleSaveImage} title="บันทึกหน้านี้เป็นรูป PNG (เลย์เอาท์ A4 แนวตั้ง)">
            <Icon name="download" size={14} /> บันทึกเป็นรูป
          </button>
          <button className="btn btn-ghost" onClick={handleDailyPrint} title="พิมพ์ A4 แนวตั้ง (เฉพาะ Hero + Pills + ตารางวันนี้) (Ctrl+P)">
            <Icon name="print" size={14} /> พิมพ์ / PDF
          </button>
        </div>
      </div>

      {/* Top toolbar — invType filter + capture-mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }} className="anim-in no-print">
        {/* invType filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>กรองประเภท:</span>
          {[
            { k: 'all', label: 'ทั้งหมด',           bg: '#f8fafc', color: '#2d3748', bd: '#cbd5e0' },
            { k: 'P',   label: '📋 โครงการ (P)',    bg: '#ebf8ff', color: '#1e4fbd', bd: '#63b3ed' },
            { k: 'O',   label: '🛒 อื่นๆ (O)',       bg: '#faf5ff', color: '#6b46c1', bd: '#b794f4' },
          ].map(t => {
            const active = ivTypeFilter === t.k;
            return (
              <button key={t.k} onClick={() => setIvTypeFilter(t.k)}
                style={{
                  fontSize: 12, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
                  border: `1.5px solid ${active ? t.bd : 'transparent'}`,
                  background: active ? t.bg : 'transparent',
                  color: active ? t.color : 'var(--ink-500)',
                  fontWeight: active ? 700 : 500,
                }}>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Capture mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', padding: '4px 6px', background: 'var(--ink-50, #f7fafc)', borderRadius: 22, border: '1px solid var(--ink-100, #e2e8f0)' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-500)', marginLeft: 6, fontWeight: 500 }}>📷 รูปแบบแคป:</span>
          <button onClick={() => setCaptureMode('landscape')}
            title="แนวนอน — สำหรับโพสต์ในกลุ่มไลน์/อีเมล หรือคอมพิวเตอร์"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 12, fontWeight: 600,
              padding: '5px 12px', borderRadius: 18, cursor: 'pointer',
              border: `1.5px solid ${!isPortrait ? 'var(--brand-500)' : 'transparent'}`,
              background: !isPortrait ? 'var(--brand-500)' : 'transparent',
              color: !isPortrait ? 'white' : 'var(--ink-500)',
              transition: 'all .12s',
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2"/>
            </svg>
            แนวนอน
          </button>
          <button onClick={() => setCaptureMode('portrait')}
            title="แนวตั้ง — สำหรับแคปบนมือถือ หรือเช็คใน Line preview แบบสูง"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 12, fontWeight: 600,
              padding: '5px 12px', borderRadius: 18, cursor: 'pointer',
              border: `1.5px solid ${isPortrait ? 'var(--brand-500)' : 'transparent'}`,
              background: isPortrait ? 'var(--brand-500)' : 'transparent',
              color: isPortrait ? 'white' : 'var(--ink-500)',
              transition: 'all .12s',
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="2" width="12" height="20" rx="2"/>
            </svg>
            แนวตั้ง
          </button>
        </div>
      </div>

      {/* ═══ Report capture area ═══ (toggle landscape/portrait via captureMode) */}
      <div className="report-capture-area" style={{
        maxWidth: isPortrait ? 920 : 'none',
        margin: isPortrait ? '0 auto' : '0',
        transition: 'max-width .25s',
      }}>

      {/* ── Hero — brand-aligned gradient (matches sidebar/cards) ────────── */}
      <div className="anim-in dr-hero" style={{
        marginBottom: isPortrait ? 14 : 20, padding: isPortrait ? '18px 22px' : '22px 28px',
        borderRadius: 18, position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, #1a592f 0%, #21703a 50%, #2e8b4a 100%)',
        boxShadow: '0 8px 22px rgba(26, 68, 144, 0.25)',
        color: 'white',
      }}>
        {/* decorative water-wave SVG */}
        <svg style={{ position: 'absolute', right: -40, bottom: -10, width: 380, height: 200, opacity: 0.08, pointerEvents: 'none' }} viewBox="0 0 400 200" preserveAspectRatio="none">
          <path d="M0,80 Q100,30 200,80 T400,80 L400,200 L0,200 Z" fill="white" />
          <path d="M0,120 Q100,70 200,120 T400,120 L400,200 L0,200 Z" fill="white" opacity="0.5" />
          <path d="M0,160 Q100,110 200,160 T400,160 L400,200 L0,200 Z" fill="white" opacity="0.3" />
        </svg>
        {/* decorative circles */}
        <div style={{ position: 'absolute', right: -90, top: -90, width: 240, height: 240, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: -50, top: -50, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />

        <div className="dr-hero-row" style={{
          display: 'flex',
          flexDirection: isPortrait ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isPortrait ? 'flex-start' : 'center',
          position: 'relative', zIndex: 1, gap: isPortrait ? 14 : 24,
        }}>
          {/* Left — Logo + Title */}
          <div className="dr-hero-left" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div className="dr-hero-logo" style={{
              background: 'white', borderRadius: 14, padding: 7,
              boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
              width: isPortrait ? 68 : 76, height: isPortrait ? 68 : 76, display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <img src="bioaxel_logo.png" alt="BIOAXEL"
                style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain' }} />
            </div>
            <div>
              <div className="dr-hero-co" style={{ fontSize: isPortrait ? 12 : 11, opacity: 0.88, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600 }}>
                {meta.companyName}
              </div>
              <div className="dr-hero-title" style={{ fontSize: isPortrait ? 30 : 32, fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1.12, marginTop: 5 }}>
                สรุปรายงานรับเงินประจำวัน
              </div>
              <div className="dr-hero-en" style={{ fontSize: isPortrait ? 13.5 : 13, opacity: 0.78, marginTop: 4, letterSpacing: '.05em' }}>
                Daily Revenue Report
              </div>
            </div>
          </div>

          {/* Right — Date */}
          <div className="dr-hero-date" style={{
            textAlign: isPortrait ? 'left' : 'right',
            flexShrink: 0,
            width: isPortrait ? '100%' : 'auto',
            borderTop: isPortrait ? '1px solid rgba(255,255,255,0.18)' : 'none',
            paddingTop: isPortrait ? 14 : 0,
          }}>
            <div className="dr-hero-date-big" style={{ fontSize: isPortrait ? 32 : 36, fontWeight: 800, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {fmtDate(todayStr)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Summary pills: YTD / MTD / Today (paid) ─ screenshot-friendly ──── */}
      <div style={{ display: 'grid', gridTemplateColumns: isPortrait ? '1fr' : 'repeat(3, 1fr)', gap: isPortrait ? 10 : 14, marginBottom: isPortrait ? 16 : 24 }} className="anim-stagger daily-pill-grid">
        {/* YTD — brand blue (lighter than hero) */}
        <DailyPillCard
          horizontal={isPortrait}
          title={`มูลค่ารับสะสมในปี ${thisYear}`}
          subtitle="Year-to-date"
          icon={(
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
              <path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-7"/>
            </svg>
          )}
          count={ytdList.length}
          value={sumBal(ytdList)}
          gradient="linear-gradient(135deg, #47a566 0%, #2e8b4a 100%)"
          accent="#7eb5f5"
          onClick={() => setDrillModal({ title: `มูลค่ารับสะสมในปี ${thisYear}`, list: ytdList })}
        />
        {/* MTD — fresh emerald */}
        <DailyPillCard
          horizontal={isPortrait}
          title="มูลค่ารับสะสมในเดือนนี้"
          subtitle="Month-to-date"
          icon={(
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
              <path d="M3 10 12 4l9 6"/><path d="M5 10v8M19 10v8M9 10v8M15 10v8"/><path d="M3 20h18"/>
            </svg>
          )}
          count={monthList.length}
          value={sumBal(monthList)}
          gradient="linear-gradient(135deg, #20c997 0%, #16906b 100%)"
          accent="#5fdbb5"
          onClick={() => setDrillModal({ title: 'มูลค่ารับสะสมในเดือนนี้', list: monthList })}
        />
        {/* Today — warm sunshine amber (highlighted) */}
        <DailyPillCard
          horizontal={isPortrait}
          title="โครงการที่รับเงินวันนี้"
          subtitle="Today's receipts"
          icon={(
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
              <circle cx="12" cy="12" r="9"/>
              <path d="M9 9.5c0-1 1.3-2 3-2s3 .9 3 1.8c0 1.4-3 1.7-3 3 0 1 1.5 1.7 3 1.7M12 7v10"/>
            </svg>
          )}
          count={todayList.length}
          value={sumBal(todayList)}
          gradient="linear-gradient(135deg, #ffa726 0%, #e87f15 100%)"
          accent="#ffc266"
          isHero
        />
      </div>

      {/* ── Today's received list ─────────────────────────────────────────────── */}
      <div className="card anim-in" style={{ padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div className="card-title">รายการใบแจ้งหนี้ที่รับเงินวันนี้</div>
        </div>
        <DailyIvTable list={todayList} projectByCode={projectByCode} showDate={false}
          empty="ยังไม่มีใบแจ้งหนี้ที่รับเงินในวันนี้ · บันทึกการรับเงินได้จากหน้า ใบแจ้งหนี้" />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          FORECAST SECTION — คาดการณ์จากใบแจ้งหนี้คงค้าง
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }} className="anim-in dr-print-hide">
        <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink-800)', margin: 0 }}>
          ประมาณการรับเงิน (Forecast)
        </h2>
        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>
          คำนวณจากใบแจ้งหนี้คงค้างในระบบ · {outstandingRows.length} ใบ
        </span>
      </div>

      {/* Forecast KPI tiles ─────────────────────────────────────────────────── */}
      <div className="anim-stagger dr-print-hide" style={{ marginBottom: 18, display: 'grid', gridTemplateColumns: isPortrait ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>

        {/* เกินกำหนด */}
        <div onClick={() => overdueForecast.length > 0 && setFcModal({ title: '🚨 เกินกำหนดชำระ', list: overdueForecast })}
          style={{ cursor: overdueForecast.length > 0 ? 'pointer' : 'default' }}>
          <div style={{
            background: overdueForecast.length > 0 ? '#fff5f5' : '#f8fafc',
            border: `1.5px solid ${overdueForecast.length > 0 ? '#fc8181' : '#e2e8f0'}`,
            borderRadius: 12, padding: '14px 16px', transition: 'box-shadow .15s',
          }}
          onMouseEnter={e => overdueForecast.length > 0 && (e.currentTarget.style.boxShadow = '0 4px 16px rgba(252,129,129,.25)')}
          onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
            <div style={{ fontSize: 11, color: overdueForecast.length > 0 ? '#9b1c1c' : '#718096', fontWeight: 600, marginBottom: 6 }}>🚨 เกินกำหนดชำระ</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: overdueForecast.length > 0 ? '#9b1c1c' : '#a0aec0' }}>
              <AnimatedNumber value={overdueForecast.length} digits={0} />
              <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 4 }}>ใบ</span>
            </div>
            <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', marginTop: 4, color: overdueForecast.length > 0 ? '#e53e3e' : '#a0aec0', fontWeight: 600 }}>
              {fmtNum(sumBal(overdueForecast), 0)} ฿
            </div>
            {overdueForecast.length > 0 && <div style={{ fontSize: 10.5, color: '#fc8181', marginTop: 3 }}>คลิกดูรายละเอียด →</div>}
          </div>
        </div>

        {/* คาดรับวันนี้ */}
        <div onClick={() => todayForecast.length > 0 && setFcModal({ title: '✅ คาดรับเงินวันนี้', list: todayForecast })}
          style={{ cursor: todayForecast.length > 0 ? 'pointer' : 'default' }}>
          <div style={{
            background: todayForecast.length > 0 ? '#f0fdf4' : '#f8fafc',
            border: `1.5px solid ${todayForecast.length > 0 ? '#68d391' : '#e2e8f0'}`,
            borderRadius: 12, padding: '14px 16px', transition: 'box-shadow .15s',
          }}
          onMouseEnter={e => todayForecast.length > 0 && (e.currentTarget.style.boxShadow = '0 4px 16px rgba(104,211,145,.25)')}
          onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
            <div style={{ fontSize: 11, color: todayForecast.length > 0 ? '#276749' : '#718096', fontWeight: 600, marginBottom: 6 }}>✅ คาดรับเงินวันนี้</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: todayForecast.length > 0 ? '#276749' : '#a0aec0' }}>
              <AnimatedNumber value={todayForecast.length} digits={0} />
              <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 4 }}>ใบ</span>
            </div>
            <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', marginTop: 4, color: todayForecast.length > 0 ? '#276749' : '#a0aec0', fontWeight: 600 }}>
              {fmtNum(sumBal(todayForecast), 0)} ฿
            </div>
            {todayForecast.length > 0 && <div style={{ fontSize: 10.5, color: '#68d391', marginTop: 3 }}>คลิกดูรายละเอียด →</div>}
          </div>
        </div>

        {/* คาดรับสัปดาห์นี้ */}
        <div onClick={() => weekForecast.length > 0 && setFcModal({ title: '📅 คาดรับสัปดาห์นี้', list: weekForecast })}
          style={{ cursor: weekForecast.length > 0 ? 'pointer' : 'default' }}>
          <div style={{
            background: weekForecast.length > 0 ? '#ebf8ff' : '#f8fafc',
            border: `1.5px solid ${weekForecast.length > 0 ? '#63b3ed' : '#e2e8f0'}`,
            borderRadius: 12, padding: '14px 16px', transition: 'box-shadow .15s',
          }}
          onMouseEnter={e => weekForecast.length > 0 && (e.currentTarget.style.boxShadow = '0 4px 16px rgba(99,179,237,.25)')}
          onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
            <div style={{ fontSize: 11, color: weekForecast.length > 0 ? '#1e4fbd' : '#718096', fontWeight: 600, marginBottom: 6 }}>📅 คาดรับสัปดาห์นี้</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: weekForecast.length > 0 ? '#1e4fbd' : '#a0aec0' }}>
              <AnimatedNumber value={weekForecast.length} digits={0} />
              <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 4 }}>ใบ</span>
            </div>
            <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', marginTop: 4, color: weekForecast.length > 0 ? '#2b6cb0' : '#a0aec0', fontWeight: 600 }}>
              {fmtNum(sumBal(weekForecast), 0)} ฿
            </div>
            {weekForecast.length > 0 && <div style={{ fontSize: 10.5, color: '#63b3ed', marginTop: 3 }}>คลิกดูรายละเอียด →</div>}
          </div>
        </div>

        {/* คาดรับเดือนนี้ (ที่เหลือ) */}
        <div onClick={() => thisMonthForecast.length > 0 && setFcModal({ title: '🗓 คาดรับเดือนนี้ (ที่เหลือ)', list: thisMonthForecast })}
          style={{ cursor: thisMonthForecast.length > 0 ? 'pointer' : 'default' }}>
          <div style={{
            background: thisMonthForecast.length > 0 ? '#faf5ff' : '#f8fafc',
            border: `1.5px solid ${thisMonthForecast.length > 0 ? '#b794f4' : '#e2e8f0'}`,
            borderRadius: 12, padding: '14px 16px', transition: 'box-shadow .15s',
          }}
          onMouseEnter={e => thisMonthForecast.length > 0 && (e.currentTarget.style.boxShadow = '0 4px 16px rgba(183,148,244,.25)')}
          onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
            <div style={{ fontSize: 11, color: thisMonthForecast.length > 0 ? '#6b46c1' : '#718096', fontWeight: 600, marginBottom: 6 }}>🗓 คาดรับเดือนนี้ (ที่เหลือ)</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: thisMonthForecast.length > 0 ? '#6b46c1' : '#a0aec0' }}>
              <AnimatedNumber value={thisMonthForecast.length} digits={0} />
              <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 4 }}>ใบ</span>
            </div>
            <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', marginTop: 4, color: thisMonthForecast.length > 0 ? '#6b46c1' : '#a0aec0', fontWeight: 600 }}>
              {fmtNum(sumBal(thisMonthForecast), 0)} ฿
            </div>
            {thisMonthForecast.length > 0 && <div style={{ fontSize: 10.5, color: '#b794f4', marginTop: 3 }}>คลิกดูรายละเอียด →</div>}
          </div>
        </div>

      </div>

      {/* Outstanding summary table ───────────────────────────────────────────── */}
      <div className="card anim-in dr-print-hide" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(180deg,var(--brand-50),white)' }}>
          <div>
            <div className="card-title">ใบแจ้งหนี้คงค้างทั้งหมด</div>
            <div className="card-sub">
              {outstandingRows.length} ใบ · Balance {fmtNum(sumBal(outstandingRows))} ฿ · คาดรับสุทธิ <strong style={{ color: 'var(--good)' }}>{fmtNum(sumNet(outstandingRows))}</strong> ฿
            </div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <ForecastTable list={outstandingRows} todayStr={todayStr} empty="ไม่มีใบแจ้งหนี้คงค้าง" />
        </div>
      </div>

      {/* ── Brand footer (visible in screenshots) ─────────────────────── */}
      <div style={{
        marginTop: 28, padding: '14px 18px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '2px solid var(--brand-100, #dbe7f6)',
        background: 'linear-gradient(90deg, transparent, var(--brand-50, #f0f6ff), transparent)',
        borderRadius: 10, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="bioaxel_logo.png" alt="BIOAXEL" style={{ width: 28, height: 28, objectFit: 'contain' }} />
          <div style={{ fontSize: 10.5, color: 'var(--ink-500)' }}>BIOAXEL · Financial Console</div>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--ink-500)', textAlign: 'right', fontStyle: 'italic' }}>
          เอกสารใช้ภายในเท่านั้น
        </div>
      </div>

      </div>{/* ═══ End report capture area ═══ */}

      {/* Paid drill-down popup */}
      {drillModal && (
        <DrillModal title={drillModal.title} list={drillModal.list} projectByCode={projectByCode} onClose={() => setDrillModal(null)} />
      )}

      {/* Forecast drill-down popup */}
      {fcModal && (
        <DailyForecastModal title={fcModal.title} list={fcModal.list} todayStr={todayStr} onClose={() => setFcModal(null)} />
      )}
    </div>
  );
}

/* ── Daily KPI card — compact, branded, screenshot-friendly ──────────────
   horizontal=true → layout แนวนอน 1 แถว [icon][title][VALUE][count][>]
                     สำหรับ portrait preview + print
   horizontal=false → layout 2 แถว (header + value/count) — landscape compact view
*/
function DailyPillCard({ title, subtitle, icon, count, value, gradient, accent, isHero, onClick, horizontal }) {
  const clickable = !!onClick;

  // ── Horizontal single-row layout ──────────────────────────────────────────
  if (horizontal) {
    return (
      <div onClick={onClick} className="dpc-pill dpc-horizontal"
        style={{
          position: 'relative', overflow: 'hidden',
          borderRadius: 14, padding: '14px 22px',
          background: gradient,
          color: 'white',
          boxShadow: isHero
            ? '0 8px 20px rgba(232, 127, 21, .28), 0 0 0 2px rgba(255, 194, 102, .22)'
            : '0 4px 14px rgba(42, 111, 219, .18)',
          cursor: clickable ? 'pointer' : 'default',
          transition: 'transform .15s, box-shadow .15s',
          display: 'flex', alignItems: 'center', gap: 16,
        }}
        onMouseEnter={clickable ? (e) => { e.currentTarget.style.transform = 'translateY(-2px)'; } : undefined}
        onMouseLeave={clickable ? (e) => { e.currentTarget.style.transform = ''; } : undefined}
        title={clickable ? 'คลิกเพื่อดูรายละเอียด' : ''}>

        {/* Decorative glows */}
        <div className="dpc-glow" style={{ position: 'absolute', right: -50, top: -50, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
        <div className="dpc-glow" style={{ position: 'absolute', right: -10, bottom: -40, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />

        {/* Icon */}
        <div className="dpc-icon" style={{
          width: 42, height: 42, borderRadius: 10,
          background: 'rgba(0,0,0,0.22)',
          display: 'grid', placeItems: 'center', fontSize: 19,
          flexShrink: 0, position: 'relative', zIndex: 1,
        }}>{icon}</div>

        {/* Title + subtitle (fixed-width) */}
        <div className="dpc-text" style={{ flexShrink: 0, position: 'relative', zIndex: 1, minWidth: 180, lineHeight: 1.2 }}>
          <div className="dpc-title" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '.01em' }}>{title}</div>
          <div className="dpc-sub" style={{ fontSize: 10, opacity: 0.78, marginTop: 2, letterSpacing: '.08em', textTransform: 'uppercase' }}>{subtitle}</div>
        </div>

        {/* Big VALUE — grows to fill, RIGHT-aligned (ตามหลักตัวเลขบัญชี → digits ตรงกัน) */}
        <div className="dpc-value" style={{
          flex: 1, fontSize: 30, fontWeight: 800,
          fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em', lineHeight: 1,
          position: 'relative', zIndex: 1, textAlign: 'right',
        }}>
          <AnimatedNumber value={value} digits={2} />
          <span className="dpc-unit" style={{ fontSize: 15, opacity: 0.82, fontWeight: 500, marginLeft: 4 }}>฿</span>
        </div>

        {/* Count — fixed-width, right-aligned numeric (width คงที่ → ขอบขวาของ value ตรงทุกแถว) */}
        <div className="dpc-count" style={{
          display: 'flex', alignItems: 'baseline', gap: 4, opacity: 0.92,
          flexShrink: 0, position: 'relative', zIndex: 1,
          width: 72, justifyContent: 'flex-end',
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            <AnimatedNumber value={count} digits={0} />
          </span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>ใบ</span>
        </div>

        {/* Chevron — far right (always reserve space so ขอบขวาของ value ตรงทุกแถว แม้ไม่มี onClick) */}
        <svg className="dpc-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: clickable ? .6 : 0, flexShrink: 0, position: 'relative', zIndex: 1 }}>
          <polyline points="9 6 15 12 9 18"/>
        </svg>
      </div>
    );
  }

  // ── Default: 2-row stacked layout (landscape compact view) ────────────────
  return (
    <div onClick={onClick} className="dpc-pill"
      style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 14, padding: '13px 18px',
        background: gradient,
        color: 'white',
        boxShadow: isHero
          ? '0 8px 20px rgba(232, 127, 21, .28), 0 0 0 2px rgba(255, 194, 102, .22)'
          : '0 4px 14px rgba(42, 111, 219, .18)',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform .15s, box-shadow .15s',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.transform = 'translateY(-2px)'; } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.transform = ''; } : undefined}
      title={clickable ? 'คลิกเพื่อดูรายละเอียด' : ''}>

      {/* Decorative glow — subtle */}
      <div className="dpc-glow" style={{ position: 'absolute', right: -50, top: -50, width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
      <div className="dpc-glow" style={{ position: 'absolute', right: -10, bottom: -40, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />

      {/* Header: icon + title */}
      <div className="dpc-header" style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="dpc-icon" style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'rgba(0,0,0,0.22)',
          display: 'grid', placeItems: 'center', fontSize: 16,
          flexShrink: 0,
        }}>{icon}</div>
        <div className="dpc-text" style={{ flex: 1, minWidth: 0 }}>
          <div className="dpc-title" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.01em', lineHeight: 1.2 }}>{title}</div>
          <div className="dpc-sub" style={{ fontSize: 10, opacity: 0.72, marginTop: 2, letterSpacing: '.08em', textTransform: 'uppercase' }}>{subtitle}</div>
        </div>
        {clickable && (
          <svg className="dpc-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .5, flexShrink: 0 }}>
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        )}
      </div>

      {/* Big value + count in one row for compactness */}
      <div className="dpc-body" style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div className="dpc-value" style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em', lineHeight: 1.1 }}>
          <AnimatedNumber value={value} digits={2} />
          <span className="dpc-unit" style={{ fontSize: 12, opacity: 0.82, fontWeight: 500, marginLeft: 3 }}>฿</span>
        </div>
        <div className="dpc-count" style={{ display: 'flex', alignItems: 'baseline', gap: 4, opacity: 0.88 }}>
          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            <AnimatedNumber value={count} digits={0} />
          </span>
          <span style={{ fontSize: 10.5, opacity: 0.75 }}>ใบ</span>
        </div>
      </div>
    </div>
  );
}

/* ── Shared paid-invoice table (used in page + DrillModal) ─────────────── */
function DailyIvTable({ list, projectByCode, showDate, empty }) {
  const total = list.reduce((s, iv) => s + (iv.balance || 0), 0);
  const cols = showDate ? 7 : 6;
  return (
    <table className="tbl" style={{ tableLayout: 'fixed', width: '100%' }}>
      <thead>
        <tr>
          <th style={{ width: 40 }}>ที่</th>
          <th style={{ width: 90 }}>Job No</th>
          <th style={{ width: 110 }}>เลข IV</th>
          <th>ชื่อโครงการ</th>
          <th style={{ width: 80, textAlign: 'center', whiteSpace: 'nowrap' }}>งวด</th>
          <th style={{ width: 140, textAlign: 'right' }}>Balance (บาท)</th>
          {showDate && <th style={{ width: 108 }}>วันที่รับเงิน</th>}
        </tr>
      </thead>
      <tbody>
        {list.length === 0 && (
          <tr><td colSpan={cols} style={{ padding: '36px 14px', textAlign: 'center', color: 'var(--ink-500)' }}>{empty}</td></tr>
        )}
        {list.map((iv, idx) => {
          const p    = projectByCode[iv.jobNo] || {};
          const name = iv.projectName || p['พื้นที่'] || p.name || '—';
          return (
            <tr key={iv.id || idx}>
              <td>{idx + 1}</td>
              <td style={{ whiteSpace: 'nowrap' }}><span style={{ fontWeight: 600, fontSize: 13 }}>{iv.jobNo}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}><span style={{ color: 'var(--ink-500)', fontSize: 12 }}>{iv.ivNo}</span></td>
              <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</td>
              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{iv.period === 0 ? 'งวดเดียว' : iv.period}</td>
              <td className="num strong" style={{ whiteSpace: 'nowrap' }}>{fmtNum(iv.balance || 0)}</td>
              {showDate && <td style={{ color: 'var(--ink-600)', whiteSpace: 'nowrap' }}>{fmtDate(iv.receiveDate || iv.actualReceive?.date)}</td>}
            </tr>
          );
        })}
      </tbody>
      {list.length > 0 && (
        <tfoot>
          <tr style={{ background: 'var(--brand-50, #eef4ff)', borderTop: '2px solid var(--brand-200, #bfd4ff)' }}>
            {/* cols 1-5: ที่ / Job No / เลข IV / ชื่อโครงการ / งวด — รวมเป็นช่อง label */}
            <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, color: 'var(--brand-700, #1a592f)', letterSpacing: '.02em' }}>
              รวมทั้งสิ้น ({list.length} ใบ)
            </td>
            {/* col 6: BALANCE — ตัวเลขรวม (ตรงกับแถวข้อมูลข้างบน) */}
            <td className="num strong" style={{ fontWeight: 800, color: 'var(--brand-700, #1a592f)', fontSize: 14, whiteSpace: 'nowrap' }}>
              {fmtNum(total)}
            </td>
            {/* col 7: วันที่รับเงิน (มีเฉพาะ showDate) */}
            {showDate && <td></td>}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/* ── Paid drill-down modal ──────────────────────────────────────────────── */
function DrillModal({ title, list, projectByCode, onClose }) {
  const total = list.reduce((s, iv) => s + (iv.balance || 0), 0);
  return (
    <Modal open={true} title={title} onClose={onClose} wide
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontWeight: 600, color: 'var(--brand-500)' }}>
            รวม {fmtNum(total)} บาท &nbsp;·&nbsp; {list.length} ใบ
          </span>
          <button className="btn btn-ghost" onClick={onClose}>ปิด</button>
        </div>
      }>
      <div style={{ maxHeight: '55vh', overflowY: 'auto', margin: '0 -20px' }}>
        <DailyIvTable list={list} projectByCode={projectByCode} showDate={true} empty="ไม่มีข้อมูล" />
      </div>
    </Modal>
  );
}

/* ── Forecast invoice table (outstanding) ──────────────────────────────── */
function ForecastTable({ list, todayStr, empty }) {
  const sumBal = list.reduce((s, iv) => s + (iv.balance || 0), 0);
  const sumNet = list.reduce((s, iv) => s + (iv.netExpected || 0), 0);
  const today  = todayStr || new Date().toISOString().slice(0, 10);
  return (
    <table className="tbl" style={{ minWidth: 900 }}>
      <thead>
        <tr>
          <th style={{ width: 44 }}>ที่</th>
          <th style={{ width: 90 }}>Job No</th>
          <th style={{ width: 120 }}>เลข IV</th>
          <th>ชื่อโครงการ</th>
          <th style={{ width: 80, textAlign: 'center', whiteSpace: 'nowrap' }}>งวด</th>
          <th style={{ width: 140, textAlign: 'right' }}>Balance (฿)</th>
          <th style={{ width: 135, textAlign: 'right' }}>คาดรับสุทธิ (฿)</th>
          <th style={{ width: 110, textAlign: 'center' }}>วันคาดรับ</th>
          <th style={{ width: 100, textAlign: 'center' }}>สถานะ</th>
        </tr>
      </thead>
      <tbody>
        {list.length === 0 && (
          <tr><td colSpan={9} style={{ padding: '36px 14px', textAlign: 'center', color: 'var(--ink-500)' }}>{empty}</td></tr>
        )}
        {list.map((iv, idx) => {
          const sMeta    = WTPData.IV_STATUS_META[iv.status] || { label: iv.status, badge: 'b-gray' };
          const isOverdue = iv.expectedReceive && iv.expectedReceive < today && iv.status === 'tracking';
          return (
            <tr key={iv.id || idx}>
              <td>{idx + 1}</td>
              <td><span style={{ fontWeight: 600, fontSize: 12.5, fontFamily: 'ui-monospace', color: 'var(--brand-700)' }}>{iv.jobNo}</span></td>
              <td><span style={{ color: 'var(--ink-500)', fontSize: 12 }}>{iv.ivNo}</span></td>
              <td style={{ overflow: 'hidden', maxWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={iv.projectName}>{iv.projectName}</span>
              </td>
              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{iv.period === 0 ? 'งวดเดียว' : iv.period}</td>
              <td className="num strong">{fmtNum(iv.balance || 0)}</td>
              <td className="num" style={{ color: 'var(--good)', fontWeight: 700 }}>{fmtNum(iv.netExpected || 0)}</td>
              <td style={{ textAlign: 'center', color: isOverdue ? '#e53e3e' : 'var(--ink-600)', fontWeight: isOverdue ? 700 : 400 }}>
                {iv.expectedReceive ? fmtDate(iv.expectedReceive) : <span className="muted">—</span>}
              </td>
              <td style={{ textAlign: 'center' }}><Badge kind={sMeta.badge}>{sMeta.label}</Badge></td>
            </tr>
          );
        })}
      </tbody>
      {list.length > 0 && (
        <tfoot>
          <tr>
            <td colSpan={5}></td>
            <td className="num" style={{ fontWeight: 700 }}>{fmtNum(sumBal)}</td>
            <td className="num" style={{ fontWeight: 700, color: 'var(--good)' }}>{fmtNum(sumNet)}</td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/* ── Forecast drill-down modal ──────────────────────────────────────────────
 * ★ ชื่อ DailyForecastModal (ไม่ใช่ ForecastModal) — กัน global-scope collision:
 *   page_bank_diary.jsx ก็มี ForecastModal (ฟอร์มกรอก รับ props bankAccounts/onSave)
 *   และโหลดทีหลังใน index.html → ทับตัวนี้ → คลิกช่องประมาณการในหน้า Daily แล้ว
 *   เรียกตัวของ bank_diary ที่ทำ bankAccounts.map() → undefined → จอ Daily พัง (ErrorBoundary).
 *   ตั้งชื่อเฉพาะไม่ให้ชนกัน. ดู [[global-scope-name-collision]] */
function DailyForecastModal({ title, list, todayStr, onClose }) {
  const sumBal = list.reduce((s, iv) => s + (iv.balance || 0), 0);
  const sumNet = list.reduce((s, iv) => s + (iv.netExpected || 0), 0);
  return (
    <Modal open={true} title={title} onClose={onClose} wide
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontWeight: 600, color: 'var(--brand-500)' }}>
            Balance {fmtNum(sumBal)} · สุทธิ {fmtNum(sumNet)} บาท &nbsp;·&nbsp; {list.length} ใบ
          </span>
          <button className="btn btn-ghost" onClick={onClose}>ปิด</button>
        </div>
      }>
      <div style={{ maxHeight: '58vh', overflowY: 'auto', margin: '0 -20px', overflowX: 'auto' }}>
        <ForecastTable list={list} todayStr={todayStr} empty="ไม่มีข้อมูล" />
      </div>
    </Modal>
  );
}

Object.assign(window, { DailyRevenueDashboard });
