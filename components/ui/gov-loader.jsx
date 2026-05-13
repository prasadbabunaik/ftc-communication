'use client';

import Image from 'next/image';

/**
 * GovLoader — official circular progress indicator.
 *
 * Props:
 *   size      — "page" (full-screen splash) | "inline" (section) | "button" (control)
 *   theme     — "navy" (default) | "paper" (light surface)
 *   overlay   — when true, renders as a fixed viewport overlay with blurred
 *               backdrop over whatever page is behind it
 *   label     — primary copy  (page/inline only)
 *   sublabel  — secondary copy (page/inline only)
 */

const SIZES = {
  page:   { ring: 160, r: 70, stroke: 2.5, seal: 100, gap: 32, plate: 48 },
  inline: { ring: 96,  r: 42, stroke: 2,   seal: 60,  gap: 16, plate: 24 },
  button: { ring: 18,  r: 7,  stroke: 2,   seal: 0,   gap: 0,  plate: 0  },
};

export function GovLoader({
  size = 'page',
  theme = 'navy',
  overlay = false,
  label = 'Verifying credentials',
  sublabel = 'This usually takes a few seconds.',
}) {
  const s = SIZES[size] ?? SIZES.page;
  const cx = s.ring / 2;

  if (size === 'button') {
    return (
      <span
        className={`gov-loader gov-loader--button gov-loader--${theme}`}
        role="status"
        aria-label={label}
      >
        <svg
          width={s.ring}
          height={s.ring}
          viewBox={`0 0 ${s.ring} ${s.ring}`}
          aria-hidden="true"
        >
          <circle
            cx={cx} cy={cx} r={s.r}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.18"
            strokeWidth={s.stroke}
          />
          <circle
            className="gov-loader__ring-active"
            cx={cx} cy={cx} r={s.r}
            fill="none"
            stroke="currentColor"
            strokeWidth={s.stroke}
            strokeLinecap="round"
            strokeDasharray={`${s.r * 1.5} ${s.r * 5}`}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        </svg>
      </span>
    );
  }

  const cls = [
    'gov-loader',
    `gov-loader--${size}`,
    `gov-loader--${theme}`,
    overlay ? 'gov-loader--overlay' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} role="status" aria-live="polite">
      <div className="gov-loader__plate" style={{ padding: s.plate, gap: s.gap }}>
        <div
          className="gov-loader__ring-wrap"
          style={{ width: s.ring, height: s.ring }}
        >
          <svg
            className="gov-loader__ring"
            width={s.ring}
            height={s.ring}
            viewBox={`0 0 ${s.ring} ${s.ring}`}
            aria-hidden="true"
          >
            <circle
              cx={cx} cy={cx} r={s.r}
              fill="none"
              stroke="var(--gov-loader-track)"
              strokeWidth={s.stroke}
            />
            <circle
              className="gov-loader__ring-active"
              cx={cx} cy={cx} r={s.r}
              fill="none"
              stroke="var(--brand-saffron)"
              strokeWidth={s.stroke}
              strokeLinecap="round"
              strokeDasharray={`${s.r * 1.5} ${s.r * 5}`}
              transform={`rotate(-90 ${cx} ${cx})`}
            />
          </svg>

          <Image
            className="gov-loader__seal"
            src="/logo-icon.png"
            alt=""
            width={s.seal}
            height={s.seal}
            draggable={false}
            priority
          />
        </div>

        <div className="gov-loader__copy">
          <div className="gov-loader__label">{label}</div>
          {sublabel ? (
            <div className="gov-loader__sublabel">{sublabel}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
