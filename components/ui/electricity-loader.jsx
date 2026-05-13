'use client';

const KF = `
@keyframes el-cw   { to { transform: rotate(360deg)  } }
@keyframes el-ccw  { to { transform: rotate(-360deg) } }
@keyframes el-beat {
  0%,100% { opacity:.5;  transform:scale(.93) }
  50%     { opacity:1;   transform:scale(1)   }
}
@keyframes el-d1 {
  0%,60%,100% { opacity:.18; transform:scale(.75) }
  20%         { opacity:1;   transform:scale(1.3)  }
}
@keyframes el-d2 {
  0%,20%,80%,100% { opacity:.18; transform:scale(.75) }
  46%             { opacity:1;   transform:scale(1.3)  }
}
@keyframes el-d3 {
  0%,46%,100% { opacity:.18; transform:scale(.75) }
  72%         { opacity:1;   transform:scale(1.3)  }
}
@keyframes el-sub { 0%,100%{opacity:.5} 50%{opacity:.95} }
`;

export function ElectricityLoader({ text = 'Connecting to grid…', size = 'md' }) {
  const px = size === 'lg' ? 128 : size === 'sm' ? 76 : 100;

  /* radii & circumferences */
  const R1 = 44;
  const R2 = 34;
  const C1 = parseFloat((2 * Math.PI * R1).toFixed(4)); // 276.46
  const C2 = parseFloat((2 * Math.PI * R2).toFixed(4)); // 213.63

  /*
   * Arc layout: dim "trail" takes 30 % of circumference, bright "head" sits
   * at the clockwise-leading edge of that trail (last 9 %).
   *
   * strokeDashoffset trick:
   *   offset = C − trail + head  →  places the head dash at positions
   *   [trail−head … trail] along the path, i.e. the leading edge.
   */
  const a1t = parseFloat((C1 * 0.30).toFixed(2));
  const a1h = parseFloat((C1 * 0.09).toFixed(2));
  const o1  = parseFloat((C1 - a1t + a1h).toFixed(2));

  const a2t = parseFloat((C2 * 0.22).toFixed(2));
  const a2h = parseFloat((C2 * 0.07).toFixed(2));
  const o2  = parseFloat((C2 - a2t + a2h).toFixed(2));

  /* shared transform-origin so CSS rotate spins around the SVG centre */
  const TO = { transformOrigin: '50px 50px' };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KF }} />

      <div className="flex flex-col items-center gap-7">
        {/* ── Icon ── */}
        <svg
          viewBox="0 0 100 100"
          width={px}
          height={px}
          style={{ overflow: 'visible' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* soft glow on arcs */}
            <filter id="el-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="1.8" result="b"/>
              <feMerge>
                <feMergeNode in="b"/>
                <feMergeNode in="b"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            {/* stronger glow for the lightning bolt */}
            <filter id="el-glow-lg" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="3.5" result="b"/>
              <feMerge>
                <feMergeNode in="b"/>
                <feMergeNode in="b"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            {/* radial core gradient */}
            <radialGradient id="el-rg" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="#bfdbfe" stopOpacity=".6"/>
              <stop offset="45%"  stopColor="#3b82f6" stopOpacity=".2"/>
              <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0"/>
            </radialGradient>
          </defs>

          {/* ── Precision tick-mark dial (24 ticks × 15°, major every 90°) ── */}
          {Array.from({ length: 24 }, (_, i) => {
            const angle = (i * 15 * Math.PI) / 180;
            const major = i % 6 === 0;
            const rIn   = R1 + 5;
            const rOut  = R1 + (major ? 9.5 : 7);
            return (
              <line
                key={i}
                x1={(50 + rIn  * Math.cos(angle)).toFixed(2)}
                y1={(50 + rIn  * Math.sin(angle)).toFixed(2)}
                x2={(50 + rOut * Math.cos(angle)).toFixed(2)}
                y2={(50 + rOut * Math.sin(angle)).toFixed(2)}
                stroke={major ? 'rgba(59,130,246,0.6)' : 'rgba(59,130,246,0.18)'}
                strokeWidth={major ? 1.4 : 0.8}
                strokeLinecap="round"
              />
            );
          })}

          {/* ── Outer track ring ── */}
          <circle cx="50" cy="50" r={R1}
            fill="none" stroke="rgba(59,130,246,0.1)" strokeWidth="2.5"/>

          {/* ── Outer arc — blue, clockwise, comet tail ── */}
          <g style={{ animation: 'el-cw 3s linear infinite', ...TO }}>
            {/* dim trailing body */}
            <circle cx="50" cy="50" r={R1} fill="none"
              stroke="rgba(59,130,246,0.22)" strokeWidth="2.5"
              strokeDasharray={`${a1t} ${parseFloat((C1 - a1t).toFixed(2))}`}
              strokeLinecap="round"/>
            {/* bright leading head */}
            <circle cx="50" cy="50" r={R1} fill="none"
              stroke="#60a5fa" strokeWidth="3.2"
              strokeDasharray={`${a1h} ${parseFloat((C1 - a1h).toFixed(2))}`}
              strokeDashoffset={o1}
              strokeLinecap="round"
              filter="url(#el-glow)"/>
          </g>

          {/* ── Middle track ring ── */}
          <circle cx="50" cy="50" r={R2}
            fill="none" stroke="rgba(6,182,212,0.08)" strokeWidth="2"/>

          {/* ── Middle arc — cyan, counter-clockwise, comet tail ── */}
          <g style={{ animation: 'el-ccw 2.2s linear infinite', ...TO }}>
            {/* dim trailing body */}
            <circle cx="50" cy="50" r={R2} fill="none"
              stroke="rgba(6,182,212,0.2)" strokeWidth="2"
              strokeDasharray={`${a2t} ${parseFloat((C2 - a2t).toFixed(2))}`}
              strokeLinecap="round"/>
            {/* bright leading head */}
            <circle cx="50" cy="50" r={R2} fill="none"
              stroke="#22d3ee" strokeWidth="2.6"
              strokeDasharray={`${a2h} ${parseFloat((C2 - a2h).toFixed(2))}`}
              strokeDashoffset={o2}
              strokeLinecap="round"
              filter="url(#el-glow)"/>
          </g>

          {/* ── Core glow disc ── */}
          <circle cx="50" cy="50" r="21" fill="url(#el-rg)"
            style={{ animation: 'el-beat 2s ease-in-out infinite', ...TO }}/>
          <circle cx="50" cy="50" r="13" fill="rgba(59,130,246,0.08)"/>

          {/* ── Lightning bolt (Lucide Zap polygon scaled ×1.2, centred at 50 50) ── */}
          <g filter="url(#el-glow-lg)"
             style={{ animation: 'el-beat 2s ease-in-out infinite', ...TO }}>
            {/* base fill */}
            <polygon
              points="51.2,38 39.2,52.4 50,52.4 48.8,62 60.8,47.6 50,47.6"
              fill="#3b82f6"
            />
            {/* bright overlay for depth */}
            <polygon
              points="51.2,38 39.2,52.4 50,52.4 48.8,62 60.8,47.6 50,47.6"
              fill="#bfdbfe"
              opacity=".45"
            />
          </g>
        </svg>

        {/* ── Label + sequential dots ── */}
        {text && (
          <div className="flex flex-col items-center gap-3">
            <p
              className={`font-semibold tracking-wide text-foreground ${
                size === 'lg' ? 'text-sm' : 'text-xs'
              }`}
              style={{ animation: 'el-sub 2.5s ease-in-out infinite' }}
            >
              {text}
            </p>

            <div className="flex items-center gap-2">
              {['el-d1', 'el-d2', 'el-d3'].map((anim) => (
                <span
                  key={anim}
                  className="size-1.5 rounded-full bg-primary inline-block"
                  style={{ animation: `${anim} 1.5s ease-in-out infinite` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
