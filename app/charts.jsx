// BIOAXEL Financial Dashboard – chart components built on SVG.
// Globals: React, useCountUp

const { useMemo: useM, useState: useS, useEffect: useE, useRef: useR } = React;

// ─── Donut chart ─────────────────────────────────────────────────────────────
function Donut({ size = 180, thickness = 22, data = [], centerLabel, centerValue, animate = true }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2; const cy = size / 2;
  const circ = 2 * Math.PI * r;

  const [shown, setShown] = useS(animate ? 0 : 1);
  useE(() => {
    if (!animate) { setShown(1); return; }
    let raf; const t0 = performance.now();
    const tick = (t) => {
      const dt = Math.min(1, (t - t0) / 900);
      setShown(1 - Math.pow(1 - dt, 3));
      if (dt < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--ink-100)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const frac = (Math.max(0, d.value) / total) * shown;
          const len = frac * circ;
          const offset = -acc;
          acc += len;
          return (
            <circle key={i}
              cx={cx} cy={cy} r={r} fill="none"
              stroke={d.color || 'var(--brand-500)'}
              strokeWidth={thickness}
              strokeLinecap="butt"
              strokeDasharray={`${len} ${circ}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: 'stroke-dasharray 600ms ease' }}
            />
          );
        })}
        {centerLabel && (
          <>
            <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" fill="var(--ink-500)">{centerLabel}</text>
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--ink-900)" style={{ fontVariantNumeric: 'tabular-nums' }}>{centerValue}</text>
          </>
        )}
      </svg>
      <div className="donut-legend" style={{ flex: 1 }}>
        {data.map((d, i) => (
          <div className="lg-row" key={i}>
            <span className="lg-sw" style={{ background: d.color }} />
            <span style={{ color: 'var(--ink-700)' }}>{d.label}</span>
            <span className="lg-val">{d.valueLabel || fmtMoney(d.value, { compact: true, digits: 1 })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stacked bar chart for monthly forecast ──────────────────────────────────
function StackedBars({ data, height = 280, colors, formatY, maxY }) {
  // data: [{ label, segments: [{key, value, color}], net, debt }]
  const W = 760;
  const padL = 56, padR = 16, padT = 18, padB = 36;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;

  // Safe number helper — coerce NaN/undefined/null to 0 เพื่อกัน SVG attribute NaN
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  // Empty-data guard: ถ้าไม่มีแถวเลย ให้ render placeholder text ไม่ใช่ NaN attribute
  if (!Array.isArray(data) || data.length === 0) {
    return <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} style={{ display: 'block' }}>
      <text x={W/2} y={height/2} fontSize="12" fill="var(--ink-400)" textAnchor="middle">ไม่มีข้อมูล</text>
    </svg>;
  }

  const computedMax = maxY ?? Math.max(0, ...data.map(d => (d.segments || []).reduce((s,x)=>s+num(x.value),0)));
  const safeMax = computedMax > 0 ? computedMax : 1; // กัน divide-by-zero
  const niceMax = Math.max(1, Math.ceil(safeMax / 10_000_000) * 10_000_000);
  const yScale = (v) => innerH - (num(v) / niceMax) * innerH;
  const colW = innerW / data.length;
  const barW = Math.min(48, colW * 0.55);

  const [t, setT] = useS(0);
  useE(() => {
    let raf; const t0 = performance.now();
    const tick = (now) => {
      const dt = Math.min(1, (now - t0) / 900);
      setT(1 - Math.pow(1 - dt, 3));
      if (dt < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const yTicks = 5;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (niceMax / yTicks) * i);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} style={{ display: 'block' }}>
      {/* gridlines */}
      {tickVals.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={padT + yScale(v)} x2={W - padR} y2={padT + yScale(v)} stroke="var(--line-soft)" strokeDasharray="2 3" />
          <text x={padL - 8} y={padT + yScale(v) + 4} fontSize="10" fill="var(--ink-500)" textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatY ? formatY(v) : (v / 1_000_000).toFixed(0) + 'M'}
          </text>
        </g>
      ))}

      {/* bars */}
      {data.map((d, i) => {
        const x = padL + i * colW + (colW - barW) / 2;
        let acc = 0;
        return (
          <g key={i}>
            {(d.segments || []).map((s, si) => {
              const v = Math.max(0, num(s.value)) * t;
              if (v <= 0) return null;
              const h = (v / niceMax) * innerH;
              const y0 = innerH - acc - h;
              acc += h;
              return (
                <rect key={si}
                  x={x} y={padT + y0}
                  width={barW} height={h}
                  fill={s.color}
                  rx="2"
                >
                  <title>{`${s.label || s.key}: ${fmtNum(s.value, 0)}`}</title>
                </rect>
              );
            })}
            <text x={x + barW / 2} y={padT + innerH + 16} fontSize="11" fill="var(--ink-700)" textAnchor="middle">{d.label}</text>
            {d.net != null && isFinite(num(d.net)) && (
              <text x={x + barW / 2} y={padT + innerH - acc - 6} fontSize="10" fontWeight="700" fill="var(--ink-900)" textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {(num(d.net) / 1_000_000).toFixed(1)}M
              </text>
            )}
          </g>
        );
      })}

      {/* x axis */}
      <line x1={padL} y1={padT + innerH} x2={W - padR} y2={padT + innerH} stroke="var(--line)" />
    </svg>
  );
}

// ─── Line + area chart (cash flow) ───────────────────────────────────────────
function AreaChart({ data, height = 220, color = 'var(--brand-500)', fillColor }) {
  // data: [{ label, value }]
  const W = 720;
  const padL = 50, padR = 16, padT = 18, padB = 32;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const values = data.map(d => d.value);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const span = (maxV - minV) || 1;
  const x = (i) => padL + (i / Math.max(1, data.length - 1)) * innerW;
  const y = (v) => padT + (1 - (v - minV) / span) * innerH;
  const y0 = y(0);

  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const area = `${x(0)},${y0} ${pts} ${x(data.length - 1)},${y0}`;

  const [t, setT] = useS(0);
  useE(() => {
    let raf; const t0 = performance.now();
    const tick = (now) => {
      const dt = Math.min(1, (now - t0) / 900);
      setT(1 - Math.pow(1 - dt, 3));
      if (dt < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {/* zero line */}
      <line x1={padL} y1={y0} x2={W - padR} y2={y0} stroke="var(--ink-300)" strokeDasharray="3 3" />
      {/* area */}
      <polygon points={area} fill={fillColor || "url(#areaGrad)"} opacity={t} />
      {/* line */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="2000" strokeDashoffset={(1 - t) * 2000} />
      {/* points */}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.value)} r={4} fill="white" stroke={color} strokeWidth="2" opacity={t} />
          <text x={x(i)} y={y(d.value) - 10} fontSize="10" textAnchor="middle" fill="var(--ink-700)" fontWeight="600" opacity={t} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtMoney(d.value, { compact: true, digits: 1 })}
          </text>
          <text x={x(i)} y={height - 12} fontSize="11" textAnchor="middle" fill="var(--ink-500)">{d.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Progress bar / linear gauge ─────────────────────────────────────────────
function ProgressBar({ value, max = 100, label, kind = 'brand', height = 8, showLabel = true }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colors = {
    brand: 'linear-gradient(90deg, var(--brand-500), var(--brand-700))',
    good:  'linear-gradient(90deg, oklch(70% 0.16 152), oklch(58% 0.16 152))',
    bad:   'linear-gradient(90deg, oklch(70% 0.18 22), oklch(55% 0.18 22))',
    warn:  'linear-gradient(90deg, oklch(75% 0.16 75),  oklch(60% 0.16 75))',
  };
  const [w, setW] = useS(0);
  useE(() => {
    const id = setTimeout(() => setW(pct), 50);
    return () => clearTimeout(id);
  }, [pct]);
  return (
    <div style={{ width: '100%' }}>
      {showLabel && label && <div style={{ fontSize: 11.5, color: 'var(--ink-600)', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>{label}</div>}
      <div style={{ background: 'var(--ink-100)', borderRadius: 999, height, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: colors[kind], transition: 'width 800ms cubic-bezier(.2,.7,.2,1)', borderRadius: 999 }} />
      </div>
    </div>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────────────────
function Sparkline({ values, w = 120, h = 32, color = 'var(--brand-500)' }) {
  const min = Math.min(...values); const max = Math.max(...values);
  const span = (max - min) || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Inflow/Outflow horizontal flow ──────────────────────────────────────────
function CashFlowBar({ inflow, outflow, net, height = 60 }) {
  const max = Math.max(inflow, Math.abs(outflow));
  const inflowW  = (inflow / max) * 100;
  const outflowW = (Math.abs(outflow) / max) * 100;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-600)', marginBottom: 4 }}>
          <span>กระแสเงินสดเข้า</span>
          <span style={{ color: 'var(--good)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>+{fmtNum(inflow, 0)}</span>
        </div>
        <div style={{ background: 'var(--ink-100)', borderRadius: 8, height: 14, overflow: 'hidden' }}>
          <div style={{ width: `${inflowW}%`, height: '100%', background: 'linear-gradient(90deg, oklch(70% 0.16 152), oklch(55% 0.16 152))', borderRadius: 8, transition: 'width 800ms ease' }} />
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-600)', marginBottom: 4 }}>
          <span>กระแสเงินสดออก</span>
          <span style={{ color: 'var(--bad)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>-{fmtNum(Math.abs(outflow), 0)}</span>
        </div>
        <div style={{ background: 'var(--ink-100)', borderRadius: 8, height: 14, overflow: 'hidden' }}>
          <div style={{ width: `${outflowW}%`, height: '100%', background: 'linear-gradient(90deg, oklch(70% 0.18 22), oklch(55% 0.18 22))', borderRadius: 8, transition: 'width 800ms ease' }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 10, fontSize: 13, fontWeight: 700 }}>
        <span style={{ color: 'var(--ink-800)' }}>คงเหลือสุทธิ</span>
        <span style={{ color: net < 0 ? 'var(--bad)' : 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>{net < 0 ? '−' : '+'}{fmtNum(Math.abs(net), 0)}</span>
      </div>
    </div>
  );
}

Object.assign(window, { Donut, StackedBars, AreaChart, ProgressBar, Sparkline, CashFlowBar });
