import { t as tl } from './i18n.js';
export function parseOBJ(text, name) {
  const nodes = [];
  const panels = [];
  const lines = [];
  const groups = {};
  let g = 'default';
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.replace(/#.*/, '').trim();
    if (!s) continue;
    const p = s.split(/\s+/);
    if (p[0] === 'v') nodes.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'g' || p[0] === 'o') g = p.slice(1).join('_') || 'default';
    else if (p[0] === 'f') {
      const f = p.slice(1).map((t) => {
        const i = parseInt(t.split('/')[0], 10);
        return i < 0 ? nodes.length + i : i - 1;
      });
      if (f.length >= 3) {
        panels.push(f);
        (groups[g] = groups[g] || []).push(panels.length - 1);
      }
    } else if (p[0] === 'l') {
      const l = p.slice(1).map((t) => {
        const i = parseInt(t.split('/')[0], 10);
        return i < 0 ? nodes.length + i : i - 1;
      });
      for (let i = 0; i + 1 < l.length; i++) lines.push([l[i], l[i + 1]]);
    }
  }
  if (!nodes.length || !panels.length) throw new Error(tl('OBJ 에 정점(v)과 면(f)이 있어야 합니다'));
  return clean({ name, nodes, panels, lines, groups });
}

function clean(geo) {
  const used = new Set(geo.panels.flat());
  for (const l of geo.lines) for (const v of l) used.add(v);
  if (used.size === geo.nodes.length) return geo;
  const map = new Map();
  const nodes = [];
  geo.nodes.forEach((p, i) => {
    if (used.has(i)) {
      map.set(i, nodes.length);
      nodes.push(p);
    }
  });
  return { ...geo, nodes, panels: geo.panels.map((f) => f.map((v) => map.get(v))), lines: geo.lines.map((l) => l.map((v) => map.get(v))) };
}

export function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function panelEdges(geo) {
  const m = new Map();
  geo.panels.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const k = edgeKey(f[i], f[(i + 1) % f.length]);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(fi);
    }
  });
  return m;
}

export function scaleGeo(geo, s) {
  return { ...geo, nodes: geo.nodes.map((p) => p.map((v) => v * s)) };
}

export function toOBJ(nodes, faces) {
  const out = ['# BaH-LLM-web'];
  for (const p of nodes) out.push(`v ${p[0]} ${p[1]} ${p[2]}`);
  for (const f of faces) out.push('f ' + f.map((i) => i + 1).join(' '));
  return out.join('\n') + '\n';
}
