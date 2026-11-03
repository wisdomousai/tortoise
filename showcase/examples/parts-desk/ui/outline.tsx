import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Part } from '../contracts/part';

type Assembly = Part['assembly'];

/**
 * Where a part sits in its assembly's outline. The plant's part numbers name the tap changer
 * component (DIV diverter, CNT selector contacts, MDU motor drive, SHAFT, POS indicator) and the
 * relay (WTI winding temperature), so the mark follows the number, then the category.
 */
export function markOf(part: Pick<Part, 'partNumber' | 'category' | 'assembly'>): string {
  const number = part.partNumber;
  switch (part.assembly) {
    case 'hv-bushings':
    case 'lv-bushings':
      return part.category === 'gasket' ? 'flange' : 'body';
    case 'tap-changer':
      if (part.category === 'relay') return 'relay';
      if (number.includes('-CNT-')) return 'selector';
      if (number.includes('-MDU-')) return 'drive';
      if (number.includes('-SHAFT')) return 'shaft';
      if (number.includes('-POS-')) return 'indicator';
      return 'diverter';
    case 'tank-cover':
      return part.category === 'relay' ? 'relay' : 'ring';
    case 'conservator':
      return part.category === 'relay' ? 'gauge' : part.category === 'gasket' ? 'gasket' : 'vessel';
    case 'protection':
      return number.includes('-WTI-') ? 'dial' : 'buchholz';
  }
}

/**
 * One element of an outline. The marked one is filled and drawn heavier in the primary color, over
 * dimmed strokes, so it stands out where the dark theme's primary is close to white.
 */
function Piece({ name, mark, children }: { name: string; mark?: string; children: ReactNode }) {
  return (
    <g
      data-piece={name}
      className={mark === name ? 'fill-primary/30 stroke-primary [stroke-width:1.75]' : undefined}
    >
      {children}
    </g>
  );
}

type OutlineProps = { mark?: string };

function Bushing({ mark }: OutlineProps) {
  return (
    <>
      <path d="M4 31.5h40" strokeDasharray="2 2" />
      <Piece name="body" mark={mark}>
        <rect x="22" y="2" width="4" height="5" rx="1" />
        <path d="M19 7h10v21H19z" />
        {[9, 14, 19, 24].map((y) => (
          <rect key={y} x="15" y={y} width="18" height="2.5" rx="1.25" />
        ))}
        <path d="M20 31.5h8l-1.5 13h-5z" />
      </Piece>
      <Piece name="flange" mark={mark}>
        <rect x="12" y="28" width="24" height="3.5" rx="1" />
      </Piece>
    </>
  );
}

function TapChanger({ mark }: OutlineProps) {
  return (
    <>
      <path d="M17 10V4h3" />
      <Piece name="relay" mark={mark}>
        <rect x="20" y="1.5" width="8" height="5" rx="1" />
      </Piece>
      <Piece name="head" mark={mark}>
        <rect x="6" y="10" width="22" height="4" rx="1" />
      </Piece>
      <Piece name="diverter" mark={mark}>
        <rect x="8" y="14" width="18" height="14" rx="2" />
      </Piece>
      <Piece name="selector" mark={mark}>
        <rect x="10" y="28" width="14" height="16" rx="1" />
        {[
          [14, 33],
          [20, 33],
          [14, 39],
          [20, 39],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.2" />
        ))}
      </Piece>
      <Piece name="shaft" mark={mark}>
        <path d="M28 12h10v12" />
      </Piece>
      <Piece name="drive" mark={mark}>
        <rect x="32" y="24" width="12" height="18" rx="1" />
      </Piece>
      <Piece name="indicator" mark={mark}>
        <circle cx="38" cy="30" r="3" />
      </Piece>
    </>
  );
}

function TankCover({ mark }: OutlineProps) {
  return (
    <>
      <Piece name="ring" mark={mark}>
        <path
          fillRule="evenodd"
          d="M8 8h32a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4zm3 5h26a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2z"
        />
      </Piece>
      {[
        [6.5, 24],
        [41.5, 24],
        [24, 10.5],
        [24, 37.5],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" />
      ))}
      <Piece name="relay" mark={mark}>
        <rect x="28" y="19" width="8" height="10" rx="1" />
      </Piece>
    </>
  );
}

function Conservator({ mark }: OutlineProps) {
  return (
    <>
      <path d="M14 26v12M30 26v8" />
      <rect x="27" y="34" width="6" height="9" rx="1" />
      <Piece name="vessel" mark={mark}>
        <rect x="3" y="8" width="42" height="18" rx="9" />
      </Piece>
      <Piece name="gasket" mark={mark}>
        <rect x="7" y="8.5" width="3" height="17" rx="1" />
      </Piece>
      <Piece name="gauge" mark={mark}>
        <circle cx="37" cy="17" r="4" />
        <path d="M37 17l2-2" />
      </Piece>
    </>
  );
}

function Protection({ mark }: OutlineProps) {
  return (
    <>
      <path d="M2 30h12M34 30h12M2 37h12M34 37h12" />
      <rect x="10" y="27" width="3" height="13" rx="0.5" />
      <rect x="35" y="27" width="3" height="13" rx="0.5" />
      <Piece name="buchholz" mark={mark}>
        <rect x="14" y="24" width="20" height="18" rx="2" />
        <rect x="18" y="16" width="12" height="8" rx="1" />
        <circle cx="24" cy="33" r="4" />
      </Piece>
      <Piece name="dial" mark={mark}>
        <circle cx="40" cy="10" r="6" />
        <path d="M40 10l3-3" />
      </Piece>
    </>
  );
}

const outlines: Record<Assembly, (props: OutlineProps) => ReactNode> = {
  'hv-bushings': Bushing,
  'lv-bushings': Bushing,
  'tap-changer': TapChanger,
  'tank-cover': TankCover,
  conservator: Conservator,
  protection: Protection,
};

/**
 * A line drawing of one assembly, with the piece `mark` names filled: the bushing, the tap
 * changer and its drive, the tank cover gasket ring, the conservator, or the Buchholz relay on
 * its pipe. Decorative: the part number and description beside it say what the part is.
 */
export function AssemblyOutline({
  assembly,
  mark,
  className,
}: {
  assembly: Assembly;
  mark?: string;
  className?: string;
}) {
  const Outline = outlines[assembly];
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden
      fill="none"
      strokeWidth={1.25}
      strokeLinejoin="round"
      className={cn('shrink-0 stroke-muted-foreground/70', className)}
    >
      <Outline {...(mark ? { mark } : {})} />
    </svg>
  );
}
