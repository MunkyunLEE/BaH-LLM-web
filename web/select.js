const AX = { x: 0, y: 1, z: 2 };

export function bbox(nodes) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of nodes) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]);
    hi[k] = Math.max(hi[k], p[k]);
  }
  return [lo, hi];
}

export function diagOf(nodes) {
  const [lo, hi] = bbox(nodes);
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
}

export function boundaryNodes(geo) {
  const cnt = new Map();
  for (const f of geo.panels) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length];
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  const ids = new Set();
  for (const [k, c] of cnt) if (c === 1) for (const v of k.split('-')) ids.add(+v);
  return ids;
}

export function resolve(geo, sel) {
  const nodes = geo.nodes;
  const n = nodes.length;
  const all = () => [...Array(n).keys()];
  if (!sel || sel.all) return all();
  if (sel.and) {
    let out = null;
    for (const s of sel.and) {
      const r = new Set(resolve(geo, s));
      out = out === null ? r : new Set([...out].filter((i) => r.has(i)));
    }
    return [...(out || [])].sort((a, b) => a - b);
  }
  if (sel.or) {
    const out = new Set();
    for (const s of sel.or) for (const i of resolve(geo, s)) out.add(i);
    return [...out].sort((a, b) => a - b);
  }
  const d = diagOf(nodes);
  const parts = [];
  if (sel.nodes) parts.push(new Set(sel.nodes.map(Number).filter((i) => i >= 0 && i < n)));
  if (sel.points || sel.segments) {
    const tol = +sel.tol || d * 1e-5;
    const got = new Set();
    for (const p of sel.points || []) nodes.forEach((q, i) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= tol && got.add(i));
    for (const [a, b] of sel.segments || []) {
      const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const L2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] || 1;
      nodes.forEach((q, i) => {
        const t = ((q[0] - a[0]) * v[0] + (q[1] - a[1]) * v[1] + (q[2] - a[2]) * v[2]) / L2;
        const dd = Math.hypot(q[0] - a[0] - t * v[0], q[1] - a[1] - t * v[1], q[2] - a[2] - t * v[2]);
        if (dd <= tol && t >= -1e-9 && t <= 1 + 1e-9) got.add(i);
      });
    }
    parts.push(got);
  }
  if (sel.plane) {
    const p = sel.plane;
    const a = AX[String(p.axis || 'z').toLowerCase()];
    const c = nodes.map((q) => q[a]);
    const at = p.at ?? 'min';
    const mn = Math.min(...c), mx = Math.max(...c);
    const v = at === 'min' ? mn : at === 'max' ? mx : at === 'mid' || at === 'center' ? (mn + mx) / 2 : +at;
    const tol = +p.tol || d * 1e-4;
    let ids = c.map((x, i) => (Math.abs(x - v) <= tol ? i : -1)).filter((i) => i >= 0);
    if (!ids.length && (at === 'mid' || at === 'center')) {
      let best = Infinity;
      c.forEach((x) => (best = Math.min(best, Math.abs(x - v))));
      ids = c.map((x, i) => (Math.abs(Math.abs(x - v) - best) <= tol ? i : -1)).filter((i) => i >= 0);
    }
    parts.push(new Set(ids));
  }
  if (sel.box) {
    const lo = sel.box.min, hi = sel.box.max, tol = d * 1e-6;
    parts.push(new Set(nodes.map((q, i) => (q.every((x, k) => x >= lo[k] - tol && x <= hi[k] + tol) ? i : -1)).filter((i) => i >= 0)));
  }
  if (sel.boundary) {
    const ids = boundaryNodes(geo);
    if (!ids.size) throw new Error('테두리(자유 엣지)가 없는 모델입니다');
    parts.push(ids);
  }
  if (sel.corners) {
    const [lo, hi] = bbox(nodes);
    const ids = new Set();
    for (let i = 0; i < 8; i++) {
      const c = [0, 1, 2].map((k) => ((i >> k) & 1 ? hi[k] : lo[k]));
      let best = -1, bd = Infinity;
      nodes.forEach((q, j) => {
        const dd = Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]);
        if (dd < bd) { bd = dd; best = j; }
      });
      ids.add(best);
    }
    parts.push(ids);
  }
  if (sel.nearest) {
    const p = sel.nearest;
    let best = -1, bd = Infinity;
    nodes.forEach((q, j) => {
      const dd = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (dd < bd) { bd = dd; best = j; }
    });
    parts.push(new Set([best]));
  }
  if (!parts.length) throw new Error(`선택 조건을 해석할 수 없습니다: ${JSON.stringify(sel)}`);
  let out = parts[0];
  for (const s of parts.slice(1)) out = new Set([...out].filter((i) => s.has(i)));
  return [...out].sort((a, b) => a - b);
}

export function describe(sel) {
  if (!sel || sel.all) return '전체';
  if (sel.and) return sel.and.map(describe).join(' ∩ ');
  if (sel.or) return sel.or.map(describe).join(' ∪ ');
  const out = [];
  if (sel.plane) out.push(`${sel.plane.axis || 'z'}=${sel.plane.at ?? 'min'}`);
  if (sel.box) out.push('박스 영역');
  if (sel.boundary) out.push('테두리');
  if (sel.corners) out.push('모서리 점');
  if (sel.nearest) out.push('절점 (' + sel.nearest.map((v) => +(+v).toPrecision(6)).join(', ') + ')');
  if (sel.nodes) out.push(sel.nodes.length <= 6 ? `절점 ${sel.nodes.map((i) => '#' + (i + 1)).join(', ')}` : `절점 ${sel.nodes.length}개`);
  if (sel.points || sel.segments) {
    const k = [];
    if (sel.points && sel.points.length) k.push(`절점 ${sel.points.length}개`);
    if (sel.segments && sel.segments.length) k.push(`선 ${sel.segments.length}개`);
    out.push('선택한 ' + k.join(' + '));
  }
  return out.join(' ∩ ');
}

export function facesOf(geo, ids) {
  const s = new Set(ids);
  const out = [];
  geo.panels.forEach((f, i) => f.every((v) => s.has(v)) && out.push(i));
  return out;
}
