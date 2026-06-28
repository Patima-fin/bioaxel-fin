/* =====================================================================
 * BIOAXEL — หน้า "สำรอง / กู้คืนข้อมูล" (#backup, กลุ่ม "ระบบ", manager เท่านั้น)
 * ---------------------------------------------------------------------
 * ย้ายความสามารถจาก tools/supabase-backup.html เข้ามาในเว็บ — ใช้ session
 * ที่ล็อกอินอยู่แล้ว (JWT ผ่าน RLS) จึงไม่ต้องล็อกอินซ้ำ/ใส่ key เอง.
 *   • ดาวน์โหลด  → WTPData.backupExport()  → ไฟล์ JSON (ทุกตาราง)
 *   • กู้คืน    → WTPData.restoreUpsert()  → upsert ตาม id (ไม่ลบของเดิม)
 * identifiers prefix Bk / bk กัน global-scope collision.
 * ===================================================================== */

function bkStamp() {
  var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}
function bkFmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function BackupPage(props) {
  const toast = (props && props.toast) || function () {};
  const [log, setLog] = React.useState([]);
  const [busy, setBusy] = React.useState(false);      // 'download' | 'restore' | false
  const [lastBackup, setLastBackup] = React.useState(null);  // {when, tables, rows, size}
  const fileRef = React.useRef(null);
  const logRef = React.useRef(null);

  const session = React.useMemo(function () {
    try { return JSON.parse(localStorage.getItem('wtp-session') || 'null'); } catch (_) { return null; }
  }, []);
  const canRun = !!(window.WTPData && WTPData.backupExport && session);

  function addLog(line) { setLog(function (L) { return L.concat(line); }); }
  React.useEffect(function () {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // ── ดาวน์โหลด backup ────────────────────────────────────────────────
  function doDownload() {
    if (busy) return;
    setBusy('download');
    setLog(['=== เริ่มสำรองข้อมูล ' + new Date().toLocaleString('th-TH') + ' ===']);
    WTPData.backupExport(function (table, count, idx, total, errMsg) {
      addLog((count < 0 ? '  ✗ ' : '  • ') + table + ': ' + (count < 0 ? ('ผิดพลาด ' + (errMsg || '')) : (count + ' แถว')) + '  (' + idx + '/' + total + ')');
    }).then(function (out) {
      const json = JSON.stringify(out);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bioaxel-backup-' + bkStamp() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      const tList = Object.keys(out.tables);
      const totalRows = tList.reduce(function (s, k) { return s + out.tables[k].length; }, 0);
      addLog('=== เสร็จ: ' + tList.length + ' ตาราง รวม ' + totalRows + ' แถว · ' + bkFmtBytes(json.length) + ' → ดาวน์โหลดแล้ว ===');
      setLastBackup({ when: new Date(), tables: tList.length, rows: totalRows, size: json.length });
      toast('สำรองข้อมูลสำเร็จ · ' + totalRows + ' แถว', 'ok');
      setBusy(false);
    }, function (err) {
      addLog('✗ สำรองไม่สำเร็จ: ' + (err && err.message || err));
      toast('สำรองไม่สำเร็จ: ' + (err && err.message || err), 'bad');
      setBusy(false);
    });
  }

  // ── กู้คืนจากไฟล์ ───────────────────────────────────────────────────
  function onPickFile(e) {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';       // reset → เลือกไฟล์เดิมซ้ำได้
    if (!file || busy) return;
    const rd = new FileReader();
    rd.onload = function () {
      let data;
      try { data = JSON.parse(rd.result); } catch (_) { toast('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง', 'bad'); return; }
      const tables = (data && data.tables) || null;
      if (!tables || typeof tables !== 'object') { toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบ', 'bad'); return; }
      const tList = Object.keys(tables);
      const totalRows = tList.reduce(function (s, k) { return s + ((tables[k] || []).length); }, 0);
      const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString('th-TH') : '?';
      const ok = window.confirm(
        'กู้คืนจากไฟล์ "' + file.name + '"\n' +
        'สำรองเมื่อ: ' + when + '\n' +
        tList.length + ' ตาราง · ' + totalRows + ' แถว\n\n' +
        '⚠️ จะ "เขียนทับ/เพิ่ม" แถวตาม id (ไม่ลบแถวที่มีอยู่แล้วในระบบ)\n' +
        'เหมาะกับการ "กู้ข้อมูลที่หาย" ไม่ใช่ย้อนทั้งระบบ\n\nยืนยันกู้คืน?'
      );
      if (!ok) return;
      setBusy('restore');
      setLog(['=== เริ่มกู้คืนจาก ' + file.name + ' (สำรองเมื่อ ' + when + ') ===']);
      WTPData.restoreUpsert(tables, function (table, count, idx, total, errMsg) {
        let msg;
        if (count === -2) msg = '  ข้าม ' + table + ' (ไม่ใช่ตารางที่รู้จัก)';
        else if (count === -1) msg = '  ✗ ' + table + ': ผิดพลาด ' + (errMsg || '');
        else if (count === 0) msg = '  • ' + table + ': 0 (ข้าม)';
        else msg = '  ✓ ' + table + ': กู้ ' + count + ' แถว';
        addLog(msg + '  (' + idx + '/' + total + ')');
      }).then(function (summary) {
        const nT = Object.keys(summary.restored).filter(function (k) { return summary.restored[k] > 0; }).length;
        const nR = Object.keys(summary.restored).reduce(function (s, k) { return s + Math.max(0, summary.restored[k]); }, 0);
        addLog('=== กู้คืนเสร็จ: ' + nT + ' ตาราง รวม ' + nR + ' แถว' + (summary.skipped.length ? (' · ข้าม ' + summary.skipped.length) : '') + ' ===');
        addLog('กำลังรีเฟรชข้อมูลจากเซิร์ฟเวอร์…');
        toast('กู้คืนสำเร็จ · ' + nR + ' แถว', 'ok');
        if (WTPData.refreshFromServer) { try { WTPData.refreshFromServer(); } catch (_) {} }
        setBusy(false);
      }, function (err) {
        addLog('✗ กู้คืนไม่สำเร็จ: ' + (err && err.message || err));
        toast('กู้คืนไม่สำเร็จ: ' + (err && err.message || err), 'bad');
        setBusy(false);
      });
    };
    rd.readAsText(file);
  }

  const tile = { background: 'var(--surface, #fff)', border: '1px solid var(--line, #e2e8f2)', borderRadius: 14, padding: '18px 20px', marginBottom: 16, boxShadow: 'var(--shadow-sm)' };

  return (
    <div className="backup-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">สำรอง / กู้คืนข้อมูล</h1>
          <div style={{ color: 'var(--ink-500)', fontSize: 13.5, marginTop: 4 }}>
            ดาวน์โหลดข้อมูลทุกตารางเป็นไฟล์ JSON เก็บไว้นอกเครื่อง — ตาข่ายกันข้อมูลหาย
          </div>
        </div>
        {session && (
          <div style={{ textAlign: 'right', fontSize: 12.5, color: 'var(--ink-500)' }}>
            เข้าระบบ: <b style={{ color: 'var(--ink-800)' }}>{session.displayName || session.username}</b>
            <span style={{ marginLeft: 6, opacity: .7 }}>({session.role || '?'})</span>
          </div>
        )}
      </div>

      {/* คำแนะนำ */}
      <div style={{ background: '#fff7e6', border: '1px solid #ffe1a8', borderRadius: 12, padding: '11px 16px', fontSize: 13.5, color: '#7a5b00', marginBottom: 16 }}>
        💡 แนะนำกดสำรองสม่ำเสมอ (เช่น <b>สัปดาห์ละครั้ง</b>) แล้วเก็บไฟล์ไว้ใน Google Drive / เครื่องตัวเอง —
        Supabase ไม่มี auto-backup ในแพลนปัจจุบัน ไฟล์นี้คือตาข่ายกันข้อมูลหายของเรา
      </div>

      {/* สำรอง */}
      <div style={tile}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink-900)' }}>⬇ สำรองข้อมูล (ดาวน์โหลด)</div>
            <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 2 }}>อ่านทุกตารางจากระบบ → ไฟล์ JSON หนึ่งไฟล์</div>
            {lastBackup && (
              <div style={{ fontSize: 12.5, color: 'var(--good, #0a7d3c)', marginTop: 6 }}>
                ✓ สำรองล่าสุดในหน้านี้: {lastBackup.when.toLocaleTimeString('th-TH')} · {lastBackup.tables} ตาราง · {lastBackup.rows} แถว · {bkFmtBytes(lastBackup.size)}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={doDownload} disabled={!canRun || !!busy}>
            {busy === 'download' ? 'กำลังสำรอง…' : '⬇ ดาวน์โหลด Backup'}
          </button>
        </div>
      </div>

      {/* กู้คืน */}
      <div style={Object.assign({}, tile, { borderColor: 'var(--bad-bg, #f6d7d2)' })}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink-900)' }}>↩ กู้คืนจากไฟล์</div>
            <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 2 }}>
              upsert ตาม id — <b>ไม่ลบ</b>แถวที่มีอยู่แล้ว (เหมาะกับ "กู้ข้อมูลที่หาย")
            </div>
          </div>
          <button className="btn btn-danger" onClick={function () { if (fileRef.current) fileRef.current.click(); }} disabled={!canRun || !!busy}>
            {busy === 'restore' ? 'กำลังกู้คืน…' : '↩ เลือกไฟล์ Backup…'}
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onPickFile} />
        </div>
      </div>

      {/* log */}
      {log.length > 0 && (
        <div ref={logRef} style={{ background: '#0f1722', color: '#c8e1ff', font: '12px/1.55 ui-monospace, "SFMono-Regular", monospace', borderRadius: 12, padding: 14, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {log.join('\n')}
        </div>
      )}

      {!canRun && (
        <div style={{ color: 'var(--bad)', fontSize: 13, marginTop: 8 }}>⚠ ต้องเข้าสู่ระบบก่อนจึงจะสำรอง/กู้คืนได้</div>
      )}
    </div>
  );
}
