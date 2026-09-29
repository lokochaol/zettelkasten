/**
 * Side-by-side placement for things that overlap in time.
 *
 * Two meetings at eleven are two meetings, not one on top of the other.
 * Pure, so the arithmetic can be tested without a browser: it takes spans
 * and says which column each one sits in, and how many columns its own
 * cluster of overlaps needs. Items that don't overlap anything keep the
 * full width — a day with one block shouldn't render it as a thin strip
 * because some other hour is busy.
 */

export interface Span {
  start: number;
  end: number;
}

export interface Placed {
  /** Index into the input array — the caller keeps its own objects. */
  index: number;
  column: number;
  columns: number;
}

export function layoutSpans(spans: Span[]): Placed[] {
  const order = spans
    .map((span, index) => ({ index, start: span.start, end: Math.max(span.end, span.start) }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.index - b.index);

  const placed: Placed[] = [];
  let cluster: { index: number; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    for (const member of cluster) placed.push({ ...member, columns: columnEnds.length || 1 });
    cluster = [];
    columnEnds = [];
  };

  for (const item of order) {
    // A gap means nothing after this point can overlap what came before,
    // so the cluster is finished and its width is known.
    if (item.start >= clusterEnd) {
      closeCluster();
      clusterEnd = -Infinity;
    }
    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.end);
    } else {
      columnEnds[column] = item.end;
    }
    cluster.push({ index: item.index, column });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  closeCluster();

  return placed.sort((a, b) => a.index - b.index);
}
