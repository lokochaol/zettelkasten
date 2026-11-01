// Drawn in the text colour of the svg (text-accent): the ink of the theme.
const ACCENT = "currentColor";
const MUTED = "#454545";
const INK = "#8a8a8a";

function Label({ x, y, anchor = "middle", children }: { x: number; y: number; anchor?: "start" | "middle" | "end"; children: React.ReactNode }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontFamily="ui-monospace, monospace"
      fontSize="10.5"
      letterSpacing="0.02em"
      fill={INK}
    >
      {children}
    </text>
  );
}

/** Isolated dots vs. the same dots joined by lines — the single idea a
 * Zettelkasten is built on: a note alone is inert, a note linked to another
 * is where the value actually comes from. */
export function LinkedNotesDiagram({ leftLabel, rightLabel }: { leftLabel: string; rightLabel: string }) {
  const isolated = [
    [70, 40],
    [115, 75],
    [60, 90],
    [105, 30],
  ];
  const linked = [
    [270, 40],
    [315, 75],
    [260, 90],
    [305, 30],
  ];
  return (
    <svg viewBox="0 0 400 130" className="w-full text-accent" role="img" aria-hidden="true">
      <line x1="180" y1="10" x2="180" y2="100" stroke={MUTED} strokeWidth="1" strokeDasharray="2 4" />
      {isolated.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5" fill={MUTED} />
      ))}
      {linked.map(([x, y], i) =>
        linked.slice(i + 1).map(([x2, y2], j) => (
          <line key={`${i}-${j}`} x1={x} y1={y} x2={x2} y2={y2} stroke={ACCENT} strokeWidth="1.4" strokeOpacity="0.65" />
        )),
      )}
      {linked.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5.5" fill={ACCENT} />
      ))}
      <Label x={90} y={118}>{leftLabel}</Label>
      <Label x={290} y={118}>{rightLabel}</Label>
    </svg>
  );
}

/** Several loose fleeting notes funnel through a "rewrite in your own words"
 * step into one permanent note, which is what actually gets linked into the
 * network. This is the 走り書き → ツェッテルカステン (Dash Off → Zettelkasten)
 * shape, drawn generically. */
export function TwoStageFlowDiagram({ fleetingLabel, arrowLabel, permanentLabel }: { fleetingLabel: string; arrowLabel: string; permanentLabel: string }) {
  const fleeting = [18, 52, 86];
  return (
    <svg viewBox="0 0 400 150" className="w-full text-accent" role="img" aria-hidden="true">
      {fleeting.map((y, i) => (
        <rect key={i} x="30" y={y} width="70" height="22" rx="5" fill="none" stroke={MUTED} strokeWidth="1.3" />
      ))}
      {fleeting.map((y, i) => (
        <line key={i} x1="100" y1={y + 11} x2="170" y2="63" stroke={MUTED} strokeWidth="1" strokeDasharray="2 3" />
      ))}
      <path d="M170 63 L220 63" stroke={ACCENT} strokeWidth="1.6" markerEnd="url(#arrowhead)" />
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={ACCENT} />
        </marker>
      </defs>
      <rect x="230" y="42" width="90" height="42" rx="6" fill="none" stroke={ACCENT} strokeWidth="1.8" />
      <line x1="320" y1="52" x2="365" y2="35" stroke={ACCENT} strokeWidth="1.2" strokeOpacity="0.6" />
      <line x1="320" y1="63" x2="370" y2="63" stroke={ACCENT} strokeWidth="1.2" strokeOpacity="0.6" />
      <line x1="320" y1="74" x2="365" y2="92" stroke={ACCENT} strokeWidth="1.2" strokeOpacity="0.6" />
      <circle cx="365" cy="35" r="4" fill={ACCENT} fillOpacity="0.7" />
      <circle cx="370" cy="63" r="4" fill={ACCENT} fillOpacity="0.7" />
      <circle cx="365" cy="92" r="4" fill={ACCENT} fillOpacity="0.7" />
      <Label x={65} y={128}>{fleetingLabel}</Label>
      <Label x={195} y={100}>{arrowLabel}</Label>
      <Label x={275} y={128}>{permanentLabel}</Label>
    </svg>
  );
}

/** A row of fixed points with a new one squeezed precisely between two of
 * them — the fractional-address idea (Luhmann's numbering, this app's
 * midpointRank): you can always insert a new thought exactly where it
 * belongs without renumbering anything else. */
export function InsertionDiagram({ label }: { label: string }) {
  const points = [50, 150, 250, 350];
  return (
    <svg viewBox="0 0 400 110" className="w-full text-accent" role="img" aria-hidden="true">
      <line x1="40" y1="45" x2="360" y2="45" stroke={MUTED} strokeWidth="1.3" />
      {points.map((x, i) => (
        <circle key={i} cx={x} cy="45" r="6" fill={MUTED} />
      ))}
      <circle cx="100" cy="45" r="7" fill={ACCENT} className="animate-pulse-dot" />
      <path d="M100 45 L100 70" stroke={ACCENT} strokeWidth="1.2" strokeDasharray="2 3" />
      <Label x={200} y={90}>{label}</Label>
    </svg>
  );
}

/** A crossed-out folder tree next to a short, curated list of keywords that
 * each point into the note network — no rigid categories, just a few
 * hand-picked entry points into whatever has actually accumulated. */
export function NoFoldersDiagram({ folderLabel, indexLabel }: { folderLabel: string; indexLabel: string }) {
  return (
    <svg viewBox="0 0 400 130" className="w-full text-accent" role="img" aria-hidden="true">
      <g opacity="0.5">
        <path d="M65 40h20l6 8h34a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4H65a4 4 0 0 1-4-4V44a4 4 0 0 1 4-4Z" fill="none" stroke={MUTED} strokeWidth="1.4" />
        <line x1="55" y1="30" x2="135" y2="90" stroke={ACCENT} strokeWidth="2" />
        <line x1="135" y1="30" x2="55" y2="90" stroke={ACCENT} strokeWidth="2" />
      </g>
      <line x1="195" y1="10" x2="195" y2="120" stroke={MUTED} strokeWidth="1" strokeDasharray="2 4" />
      {[30, 60, 90].map((y, i) => (
        <g key={i}>
          <rect x="225" y={y} width="60" height="18" rx="4" fill="none" stroke={ACCENT} strokeWidth="1.2" />
          <line x1="285" y1={y + 9} x2="335" y2={45 + i * 8} stroke={ACCENT} strokeWidth="1" strokeOpacity="0.5" />
        </g>
      ))}
      <circle cx="345" cy="45" r="4" fill={ACCENT} fillOpacity="0.7" />
      <circle cx="345" cy="53" r="4" fill={ACCENT} fillOpacity="0.7" />
      <circle cx="345" cy="61" r="4" fill={ACCENT} fillOpacity="0.7" />
      <line x1="345" y1="45" x2="345" y2="61" stroke={ACCENT} strokeWidth="1" strokeOpacity="0.4" />
      <Label x={90} y={118}>{folderLabel}</Label>
      <Label x={295} y={118}>{indexLabel}</Label>
    </svg>
  );
}

/** How the pieces of this specific app map onto the method: Dash Off
 * captures, selected notes get rewritten and promoted into the Zettelkasten
 * with links, and literature memos feed into either stage. */
export function AppMapDiagram({
  dashOffLabel,
  zettelkastenLabel,
  literatureLabel,
  promoteLabel,
}: {
  dashOffLabel: string;
  zettelkastenLabel: string;
  literatureLabel: string;
  promoteLabel: string;
}) {
  return (
    <svg viewBox="0 0 400 170" className="w-full text-accent" role="img" aria-hidden="true">
      <rect x="57.5" y="20" width="110" height="46" rx="7" fill="none" stroke={ACCENT} strokeWidth="1.6" />
      <line x1="72.5" y1="35" x2="142.5" y2="35" stroke={MUTED} strokeWidth="1.1" />
      <line x1="72.5" y1="45" x2="132.5" y2="45" stroke={MUTED} strokeWidth="1.1" />
      <line x1="72.5" y1="55" x2="122.5" y2="55" stroke={MUTED} strokeWidth="1.1" />

      <path d="M167.5 43 L212.5 43" stroke={ACCENT} strokeWidth="1.6" markerEnd="url(#arrowhead2)" />
      <defs>
        <marker id="arrowhead2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={ACCENT} />
        </marker>
      </defs>

      <rect x="222.5" y="12" width="120" height="62" rx="7" fill="none" stroke={ACCENT} strokeWidth="1.8" />
      <circle cx="247.5" cy="43" r="4" fill={ACCENT} />
      <circle cx="282.5" cy="30" r="4" fill={ACCENT} fillOpacity="0.75" />
      <circle cx="312.5" cy="55" r="4" fill={ACCENT} fillOpacity="0.75" />
      <circle cx="292.5" cy="60" r="4" fill={ACCENT} fillOpacity="0.75" />
      <line x1="247.5" y1="43" x2="282.5" y2="30" stroke={ACCENT} strokeWidth="1" strokeOpacity="0.55" />
      <line x1="247.5" y1="43" x2="312.5" y2="55" stroke={ACCENT} strokeWidth="1" strokeOpacity="0.55" />
      <line x1="247.5" y1="43" x2="292.5" y2="60" stroke={ACCENT} strokeWidth="1" strokeOpacity="0.55" />

      <rect x="112.5" y="115" width="120" height="40" rx="7" fill="none" stroke={MUTED} strokeWidth="1.4" strokeDasharray="3 3" />
      <line x1="172.5" y1="115" x2="122.5" y2="66" stroke={MUTED} strokeWidth="1" strokeDasharray="2 3" />
      <line x1="192.5" y1="115" x2="282.5" y2="74" stroke={MUTED} strokeWidth="1" strokeDasharray="2 3" />

      <Label x={112.5} y={83}>{dashOffLabel}</Label>
      <Label x={190.5} y={95}>{promoteLabel}</Label>
      <Label x={282.5} y={90}>{zettelkastenLabel}</Label>
      <Label x={172.5} y={168}>{literatureLabel}</Label>
    </svg>
  );
}
