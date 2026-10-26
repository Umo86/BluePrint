import { IconCircleCheckFilled, IconClockHour4 } from '@tabler/icons-react';
import styles from './site.module.css';

type Status = 'ready' | 'todo' | 'review' | 'selected';
type Stand = { id: string; x: number; y: number; w: number; h: number; status: Status };

// Drawn to scale: 12 units to the metre, in a 60 m by 32 m hall.
const ROW_A = { y: 40, h: 36 };
const ROW_B = { y: 112, h: 72 };
const ROW_C = { y: 220, h: 72 };
const ROW_D = { y: 364, h: 36 };

function row(prefix: string, r: { y: number; h: number }, items: [x: number, w: number, status: Status][]): Stand[] {
  return items.map(([x, w, status], i) => ({ id: `${prefix}${i + 1}`, x, y: r.y, w, h: r.h, status }));
}

const STANDS: Stand[] = [
  ...row('A', ROW_A, [
    [104, 72, 'ready'],
    [176, 48, 'ready'],
    [224, 48, 'todo'],
    [272, 72, 'ready'],
    [344, 36, 'todo'],
    [380, 36, 'ready'],
    [416, 72, 'ready'],
    [488, 48, 'todo'],
    [536, 48, 'ready'],
    [584, 72, 'ready'],
  ]),
  ...row('B', ROW_B, [
    [74, 108, 'review'],
    [182, 108, 'selected'],
    [326, 72, 'ready'],
    [398, 72, 'ready'],
    [470, 72, 'todo'],
    [578, 108, 'review'],
  ]),
  ...row('C', ROW_C, [
    [92, 72, 'ready'],
    [164, 72, 'todo'],
    [236, 72, 'ready'],
    [344, 144, 'review'],
    [524, 72, 'ready'],
    [596, 72, 'ready'],
  ]),
  ...row('D', ROW_D, [
    [104, 48, 'ready'],
    [152, 48, 'todo'],
    [200, 48, 'ready'],
    [248, 48, 'ready'],
    [464, 48, 'todo'],
    [512, 48, 'ready'],
    [560, 48, 'ready'],
    [608, 48, 'todo'],
  ]),
];

const ACCENT = '#2b50e0';

function StandShape({ s }: { s: Stand }) {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const fill = s.status === 'selected' ? ACCENT : s.status === 'ready' ? '#e8edfc' : s.status === 'review' ? 'url(#hp-hatch)' : '#fff';
  return (
    <g>
      <rect
        x={s.x + 0.75}
        y={s.y + 0.75}
        width={s.w - 1.5}
        height={s.h - 1.5}
        fill={fill}
        stroke={s.status === 'selected' ? '#1e379f' : ACCENT}
        strokeWidth={s.status === 'selected' ? 2 : 1.5}
        strokeDasharray={s.status === 'todo' ? '4 3' : undefined}
      />
      {s.status === 'review' ? <rect x={cx - 14} y={cy - 8} width={28} height={16} fill="#fff" /> : null}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={s.status === 'selected' ? 600 : 500} fill={s.status === 'selected' ? '#fff' : '#1c1c1c'}>
        {s.id}
      </text>
    </g>
  );
}

/** Dashed drafting lines either side of the window, fading out towards the edge of the page. */
function ConstructionLines({ side }: { side: 'left' | 'right' }) {
  const rows = [
    ['14 6', 0.9],
    ['10 10', 0.75],
    ['18 6', 0.9],
    ['6 12', 0.6],
    ['14 6', 0.85],
    ['10 10', 0.7],
    ['18 6', 0.9],
    ['6 12', 0.55],
  ] as const;
  const id = `hp-fade-${side}`;
  return (
    <svg className={`${styles.lines} ${side === 'left' ? styles.linesLeft : styles.linesRight}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity={side === 'left' ? 0 : 1} />
          <stop offset="1" stopColor="#fff" stopOpacity={side === 'left' ? 1 : 0} />
        </linearGradient>
        <mask id={`${id}-mask`}>
          <rect width="100%" height="100%" fill={`url(#${id})`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`} stroke={ACCENT} strokeWidth={2}>
        {rows.map(([dash, opacity], i) => (
          <line key={i} x1="0" x2="100%" y1={12 + i * 22} y2={12 + i * 22} strokeDasharray={dash} strokeOpacity={opacity} />
        ))}
      </g>
    </svg>
  );
}

/**
 * The picture on the homepage: a hall drawn like a blueprint, every stand marked with how ready it is,
 * and one stand open beside it. It is an example, so it is described to screen readers in one sentence.
 */
export function HallPlan() {
  return (
    <div className={styles.heroVisual}>
      <ConstructionLines side="left" />
      <ConstructionLines side="right" />
      <figure className={styles.window} style={{ margin: 0 }}>
        <div aria-hidden="true">
          <div className={styles.windowBar}>
            <span className={styles.windowDot} />
            <span className={styles.windowDot} />
            <span className={styles.windowDot} />
            <span className={styles.windowTitle}>Hall 3 stands</span>
          </div>
          <div className={styles.windowBody}>
            <div className={styles.planArea}>
              <svg className={styles.plan} viewBox="0 0 760 440" focusable="false">
                <defs>
                  <pattern id="hp-grid-minor" x="20" y="28" width="12" height="12" patternUnits="userSpaceOnUse">
                    <path d="M12 0H0V12" fill="none" stroke={ACCENT} strokeOpacity="0.07" />
                  </pattern>
                  <pattern id="hp-grid" x="20" y="28" width="60" height="60" patternUnits="userSpaceOnUse">
                    <rect width="60" height="60" fill="url(#hp-grid-minor)" />
                    <path d="M60 0H0V60" fill="none" stroke={ACCENT} strokeOpacity="0.14" />
                  </pattern>
                  <pattern id="hp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="#fff" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke={ACCENT} strokeOpacity="0.45" strokeWidth="1.5" />
                  </pattern>
                </defs>

                <rect x="20" y="28" width="720" height="384" fill="url(#hp-grid)" />

                {/* Overall dimensions, as on a drawing. */}
                <g stroke={ACCENT} strokeWidth="1">
                  <path d="M20 14H740M16 18l8-8M736 18l8-8" />
                  <path d="M8 28V412M4 32l8-8M4 416l8-8" />
                </g>
                <rect x="358" y="6" width="44" height="16" fill="#fff" />
                <text x="380" y="14" textAnchor="middle" dominantBaseline="central" fontSize="10" fill={ACCENT}>
                  60 m
                </text>
                <rect x="0" y="198" width="16" height="44" fill="#fff" />
                <text x="8" y="220" textAnchor="middle" dominantBaseline="central" fontSize="10" fill={ACCENT} transform="rotate(-90 8 220)">
                  32 m
                </text>

                {/* Walls, with double doors at the entrance. */}
                <path className={styles.planWalls} d="M344 412H20V28H740V412H416" fill="none" stroke={ACCENT} strokeWidth="2.5" />
                <g fill="none" stroke={ACCENT} strokeWidth="1" strokeOpacity="0.7">
                  <path d="M344 412V376A36 36 0 0 1 380 412" />
                  <path d="M416 412V376A36 36 0 0 0 380 412" />
                </g>
                <text x="380" y="428" textAnchor="middle" dominantBaseline="central" fontSize="10" letterSpacing="1" fill={ACCENT}>
                  ENTRANCE
                </text>

                <g className={styles.planStands}>
                  {STANDS.map((s) => (
                    <StandShape key={s.id} s={s} />
                  ))}
                </g>
                <rect className={styles.planFocus} x="175" y="105" width="122" height="86" rx="3" fill="none" stroke={ACCENT} strokeWidth="1.5" strokeDasharray="5 4" />
              </svg>
              <ul className={styles.legend}>
                <li>
                  <span className={`${styles.swatch} ${styles.swatchReady}`} />
                  Ready for build-up
                </li>
                <li>
                  <span className={`${styles.swatch} ${styles.swatchTodo}`} />
                  Tasks to do
                </li>
                <li>
                  <span className={`${styles.swatch} ${styles.swatchReview}`} />
                  Stand pack in review
                </li>
              </ul>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelTop}>
                <p className={styles.panelTitle}>Stand B2</p>
                <span className={`${styles.chip} ${styles.chipNeutral}`}>Space only</span>
              </div>
              <p className={styles.panelMeta}>
                9 m × 6 m (54 sqm)
                <br />
                Open on three sides
              </p>
              <div className={styles.progress}>
                <span>3 of 4 tasks done</span>
                <div className={styles.progressTrack}>
                  <div className={styles.progressBar} style={{ width: '75%' }} />
                </div>
              </div>
              <ul className={styles.tasks}>
                <li className={styles.task}>
                  <IconCircleCheckFilled size={18} className={`${styles.taskIcon} ${styles.taskIconDone}`} />
                  <span>Name your stand contractor</span>
                  <span className={`${styles.chip} ${styles.chipDone}`}>Done</span>
                </li>
                <li className={styles.task}>
                  <IconCircleCheckFilled size={18} className={`${styles.taskIcon} ${styles.taskIconDone}`} />
                  <span>Read the build-up and breakdown rules</span>
                  <span className={`${styles.chip} ${styles.chipDone}`}>Done</span>
                </li>
                <li className={styles.task}>
                  <IconCircleCheckFilled size={18} className={`${styles.taskIcon} ${styles.taskIconDone}`} />
                  <span>Order your stand electrics</span>
                  <span className={`${styles.chip} ${styles.chipDone}`}>Done</span>
                </li>
                <li className={styles.task}>
                  <IconClockHour4 size={18} className={`${styles.taskIcon} ${styles.taskIconReview}`} />
                  <span>Stand pack for health and safety review</span>
                  <span className={`${styles.chip} ${styles.chipReview}`}>Under review</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <figcaption className="visually-hidden">
          An example hall plan in BluePrint. Each stand is marked as ready for build-up, with tasks still to do, or with its stand pack in review. Stand B2, a
          space-only stand, is open beside the plan: three of its four tasks are done and its stand pack is under review.
        </figcaption>
      </figure>
    </div>
  );
}
