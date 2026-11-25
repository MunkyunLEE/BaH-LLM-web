import { parseOBJ, panelEdges, edgeKey, scaleGeo } from './geometry.js';
import { resolve, describe, facesOf, bbox, diagOf } from './select.js';
import * as rules from './rules.js';
import * as llm from './llm.js';

const G0 = 9806.65;

export function defaultSpec() {
  return {
    solver: 'bh',
    materials: { default: { E: 1000.0, nu: 0.3, rho: 1e-9, yield: null, hardening: 0.0 } },
    sections: { '*': { thickness: 0.25 } },
    creases: {},
    bh: { model: 'N5B8', calib: 'auto', Lstar: null, Lstar_ratio: 3, contact: false, plastic_hinge: false, cycles: 0, cycle_back: 0 },
    bcs: [],
    loads: [],
    symmetry: [],
    step: { type: 'static', increments: 100, modes: 6, imperfection: 0, lam_max: 1 },
    plots: [],
  };
}

const S = {
  geo: null,
  spec: null,
  undo: [],
  result: null,
  stale: false,
  chat: [],
  solveTime: null,
  llm: llm.loadConfig(),
  worker: null,
  progress: { running: false },
};

const clone = (x) => JSON.parse(JSON.stringify(x));
const nextId = (arr, p) => {
  let k = 1;
  const ids = new Set(arr.map((x) => x.id));
  while (ids.has(`${p}${k}`)) k++;
  return `${p}${k}`;
};
const num = (v, f) => {
  const x = +v;
  if (!Number.isFinite(x)) throw new Error(`${f} 값이 숫자가 아닙니다: ${v}`);
  return x;
};
const vec = (v, f) => {
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`${f} 는 3개 성분이어야 합니다`);
  return v.map((x) => num(x, f));
};

const BC_TYPES = { fixed: [1, 2, 3], pinned: [1, 2, 3], encastre: [1, 2, 3] };
const SYM = { xsymm: 'x', ysymm: 'y', zsymm: 'z' };
const AXN = { x: 0, y: 1, z: 2 };

function planeCoord(geo, sel, axis) {
  const ids = resolve(geo, sel);
  if (!ids.length) throw new Error('대칭면 위치를 정할 절점이 없습니다');
  const a = AXN[axis];
  return ids.reduce((s, i) => s + geo.nodes[i][a], 0) / ids.length;
}

function scaleSel(sel, s) {
  if (!sel || typeof sel !== 'object') return sel;
  const o = clone(sel);
  if (o.and) o.and = o.and.map((q) => scaleSel(q, s));
  if (o.or) o.or = o.or.map((q) => scaleSel(q, s));
  if (o.nearest) o.nearest = o.nearest.map((v) => v * s);
  if (o.points) o.points = o.points.map((p) => p.map((v) => v * s));
  if (o.segments) o.segments = o.segments.map((g) => g.map((p) => p.map((v) => v * s)));
  if (o.box) o.box = { min: o.box.min.map((v) => v * s), max: o.box.max.map((v) => v * s) };
  if (o.plane && typeof o.plane.at === 'number') o.plane = { ...o.plane, at: o.plane.at * s };
  if (o.tol) o.tol *= s;
  return o;
}

export function applyOps(spec0, ops, geo) {
  const spec = clone(spec0);
  const log = [];
  let newGeo = null;
  for (const op of ops) {
    if (!op || typeof op !== 'object' || !op.op) throw new Error(`잘못된 수정 지시: ${JSON.stringify(op)}`);
    const k = op.op;
    const g = newGeo || geo;
    if (k === 'add_bc') {
      const t = String(op.type || '').toLowerCase();
      if (SYM[t]) {
        const sel = op.select || { plane: { axis: SYM[t], at: 'min' } };
        const at = op.at ?? planeCoord(g, sel, SYM[t]);
        spec.symmetry.push({ id: nextId(spec.symmetry, 'sy'), axis: SYM[t], at });
        log.push(`대칭 추가 ${SYM[t]} = ${at}`);
        continue;
      }
      let dofs = op.dofs;
      if (!dofs || !dofs.length) {
        const tt = t || 'fixed';
        if (!BC_TYPES[tt]) throw new Error(`알 수 없는 구속 종류: ${tt}`);
        dofs = BC_TYPES[tt];
      }
      dofs = [...new Set(dofs.map(Number))].sort();
      const rot = dofs.filter((d) => d > 3);
      dofs = dofs.filter((d) => d >= 1 && d <= 3);
      if (!dofs.length) throw new Error(rot.length ? '바-힌지 모델에는 회전 자유도가 없습니다 (병진 x, y, z 만 구속할 수 있습니다)' : '자유도는 1~3 이어야 합니다');
      const sel = op.select || { all: true };
      if (g && !resolve(g, sel).length) throw new Error(`구속 대상 절점이 0개입니다: ${describe(sel)}`);
      const value = num(op.value ?? 0, 'value');
      if (value !== 0 && dofs.length !== 1) throw new Error('강제 변위는 한 방향(x, y, z 중 하나)씩 지정하세요');
      const item = { id: nextId(spec.bcs, 'bc'), name: op.name || (value ? '강제 변위' : t === 'pinned' ? '핀' : '구속'), select: sel, dofs, value };
      spec.bcs.push(item);
      log.push(`구속 추가 ${item.id}`);
    } else if (k === 'add_load') {
      const t = String(op.type || 'force').toLowerCase();
      if (!['force', 'pressure', 'gravity'].includes(t)) throw new Error(t === 'moment' ? '바-힌지 모델에는 회전 자유도가 없어 모멘트 하중을 줄 수 없습니다' : `알 수 없는 하중 종류: ${t}`);
      const item = { id: nextId(spec.loads, 'ld'), type: t, name: op.name || t };
      if (t === 'force') {
        item.vector = vec(op.vector, 'vector');
        item.select = op.select || { all: true };
        if (op.per_node) item.per_node = true;
      } else if (t === 'pressure') {
        item.value = num(op.value, 'value');
        item.select = op.select || { all: true };
        item.mode = op.mode === 'local' ? 'local' : 'global';
        if (op.direction) item.direction = vec(op.direction, 'direction');
        if (item.mode === 'global' && !item.direction) item.direction = [0, 0, -1];
        if (op.flip) item.flip = op.flip.map(Number);
        if (g && !facesOf(g, resolve(g, item.select)).length) throw new Error('압력을 줄 면이 없습니다. 면의 모든 꼭짓점이 선택 영역에 들어가야 합니다');
      } else {
        item.vector = vec(op.vector || [0, 0, -G0], 'vector');
      }
      if (g && item.select && !resolve(g, item.select).length) throw new Error(`하중 대상 절점이 0개입니다: ${describe(item.select)}`);
      spec.loads.push(item);
      log.push(`하중 추가 ${item.id}`);
    } else if (k === 'add_symmetry') {
      const axis = String(op.axis || 'x').toLowerCase();
      if (!(axis in AXN)) throw new Error('대칭면 축은 x, y, z 중 하나여야 합니다');
      const at = op.at !== undefined && op.at !== null ? num(op.at, 'at') : planeCoord(g, op.select || { plane: { axis, at: 'min' } }, axis);
      spec.symmetry.push({ id: nextId(spec.symmetry, 'sy'), axis, at });
      log.push(`대칭 추가 ${axis} = ${at}`);
    } else if (k === 'remove') {
      const keys = ['bcs', 'loads', 'plots', 'symmetry'];
      const n = keys.reduce((s, q) => s + spec[q].length, 0);
      for (const q of keys) spec[q] = spec[q].filter((x) => x.id !== op.id);
      if (n === keys.reduce((s, q) => s + spec[q].length, 0)) throw new Error(`id '${op.id}' 를 찾을 수 없습니다`);
      log.push(`삭제 ${op.id}`);
    } else if (k === 'clear') {
      const what = op.what || 'all';
      for (const q of ['bcs', 'loads', 'plots', 'symmetry']) if (what === q || what === 'all') spec[q] = [];
      if (what === 'creases' || what === 'all') spec.creases = {};
      log.push(`초기화 ${what}`);
    } else if (k === 'update') {
      let hit = null;
      for (const q of ['bcs', 'loads', 'plots', 'symmetry']) for (const x of spec[q]) if (x.id === op.id) hit = x;
      if (!hit) throw new Error(`id '${op.id}' 를 찾을 수 없습니다`);
      for (const [f, v0] of Object.entries(op)) {
        if (f === 'op' || f === 'id') continue;
        let v = v0;
        if (['vector', 'direction'].includes(f)) v = vec(v, f);
        else if (['value', 'at'].includes(f)) v = num(v, f);
        else if (f === 'scale') {
          if (hit.vector) hit.vector = hit.vector.map((q) => q * num(v, f));
          if (hit.value !== undefined) hit.value *= num(v, f);
          continue;
        }
        hit[f] = v;
      }
      log.push(`수정 ${op.id}`);
    } else if (k === 'set_material') {
      const m = spec.materials.default;
      for (const f of ['E', 'nu', 'rho', 'yield', 'hardening']) if (f in op) m[f] = op[f] === null ? null : num(op[f], f);
      if (op.thickness !== undefined) spec.sections['*'].thickness = num(op.thickness, 'thickness');
      log.push('재료');
    } else if (k === 'set_section') {
      if (op.thickness !== undefined) spec.sections['*'].thickness = num(op.thickness, 'thickness');
      log.push('두께');
    } else if (k === 'set_crease') {
      const ty = String(op.type || 'auto');
      if (!['fold', 'bend', 'cut', 'auto'].includes(ty)) throw new Error('주름 종류는 fold, bend, cut, auto 중 하나여야 합니다');
      const known = g ? panelEdges(g) : null;
      const es = op.edges === 'all' ? [...known.entries()].filter(([, f]) => f.length === 2).map(([k]) => k) : op.edges || [];
      if (!es.length) throw new Error('바꿀 엣지가 없습니다');
      for (const e of es) {
        const key = typeof e === 'string' ? e : edgeKey(+e[0], +e[1]);
        if (known && !known.has(key)) throw new Error(`모델에 없는 엣지입니다: ${key}`);
        if (known && known.get(key).length < 2) continue;
        if (ty === 'auto') delete spec.creases[key];
        else spec.creases[key] = ty;
      }
      log.push(`주름 ${es.length}개 → ${ty}`);
    } else if (k === 'set_bh') {
      for (const [f, v] of Object.entries(op)) {
        if (f === 'op') continue;
        if (['drivers', 'plot3', 'watch'].includes(f)) spec.bh[f] = (v || []).map((e) => (typeof e === 'string' ? e : edgeKey(+e[0], +e[1])));
        else if (f === 'targets') spec.bh[f] = (v || []).map(Number);
        else if (['contact', 'plastic_hinge', 'compat', 'use_mass'].includes(f)) spec.bh[f] = !!v;
        else if (['model', 'calib', 'tri_bars', 'edge_bend', 'bar_cm', 'bend_cm', 'fold_cm'].includes(f)) spec.bh[f] = v;
        else spec.bh[f] = v === null ? null : num(v, f);
      }
      if (spec.bh.model && !['N5B8', 'N4B5'].includes(spec.bh.model)) throw new Error('model 은 N5B8 또는 N4B5 입니다');
      log.push('BH 설정');
    } else if (k === 'set_step') {
      const st = spec.step;
      if ('type' in op) {
        if (!['static', 'arclength', 'modal', 'kinematic'].includes(op.type)) throw new Error('해석 종류는 static, arclength, modal, kinematic 중 하나입니다');
        st.type = op.type;
      }
      for (const f of ['increments', 'modes']) if (f in op) st[f] = Math.max(1, Math.round(num(op[f], f)));
      for (const f of ['imperfection', 'lambda0', 'lam_max']) if (f in op) st[f] = op[f] === null ? null : num(op[f], f);
      if ('stop' in op) st.stop = op.stop;
      log.push('해석 설정');
    } else if (k === 'add_plot' && (op.type === 'space3' || op.type === '3d')) {
      const keys = (op.edges || []).map((e) => (typeof e === 'string' ? e : edgeKey(+e[0], +e[1])));
      const known = new Set(panelEdges(g).keys());
      const bad = keys.filter((q) => !known.has(q));
      if (keys.length !== 3) throw new Error('해공간 그래프에는 주름 3개가 필요합니다');
      if (bad.length) throw new Error(`없는 엣지: ${bad.map(edgeLabel).join(', ')}`);
      const item = { id: nextId(spec.plots, 'pl'), type: 'space3', title: op.title || `해공간 ${keys.map(edgeLabel).join(' · ')}`, edges: keys };
      spec.plots.push(item);
      log.push(`그래프 추가 ${item.id}`);
    } else if (k === 'add_plot') {
      const item = { id: nextId(spec.plots, 'pl'), title: op.title || '그래프', x: op.x || { quantity: 'step' }, series: op.series || [] };
      if (!item.series.length) throw new Error('그래프에 series 가 없습니다');
      spec.plots.push(item);
      log.push(`그래프 추가 ${item.id}`);
    } else if (k === 'scale_geometry') {
      const s = num(op.factor, 'factor');
      if (!(s > 0)) throw new Error('배율은 0보다 커야 합니다');
      newGeo = scaleGeo(g, s);
      for (const q of ['bcs', 'loads']) for (const it of spec[q]) if (it.select) it.select = scaleSel(it.select, s);
      for (const it of spec.bcs) if (it.value) it.value *= s;
      for (const it of spec.symmetry) it.at *= s;
      if (op.thickness) spec.sections['*'].thickness *= s;
      log.push(`형상 ${s}배`);
    } else if (k === 'set_view') {
      spec.view = { ...(spec.view || {}), ...op };
      delete spec.view.op;
      log.push('표시');
    } else throw new Error(`알 수 없는 op: ${k}`);
  }
  return { spec, log, geo: newGeo };
}

function triArea(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [(u[1] * v[2] - u[2] * v[1]) / 2, (u[2] * v[0] - u[0] * v[2]) / 2, (u[0] * v[1] - u[1] * v[0]) / 2];
}

export function faceGeom(nodes, f) {
  const c = [0, 1, 2].map((k) => f.reduce((s, i) => s + nodes[i][k], 0) / f.length);
  const n = [0, 0, 0];
  for (let i = 0; i < f.length; i++) {
    const a = triArea(c, nodes[f[i]], nodes[f[(i + 1) % f.length]]);
    for (let k = 0; k < 3; k++) n[k] += a[k];
  }
  const A = Math.hypot(...n);
  return { c, n: n.map((x) => x / (A || 1)), A };
}

function symEdges(geo, s) {
  const a = AXN[s.axis];
  const tol = diagOf(geo.nodes) * 1e-6;
  const out = [];
  for (const [k, fl] of panelEdges(geo)) {
    if (fl.length !== 1) continue;
    const [p, q] = k.split('-').map(Number);
    if (Math.abs(geo.nodes[p][a] - s.at) <= tol && Math.abs(geo.nodes[q][a] - s.at) <= tol) out.push([p, q]);
  }
  return out;
}

export function preview(spec, geo) {
  const out = { bcs: [], loads: [], symmetry: [], errors: [] };
  if (!geo) return out;
  for (const b of spec.bcs) {
    try {
      out.bcs.push({ id: b.id, nodes: resolve(geo, b.select), dofs: b.dofs, value: b.value, desc: describe(b.select) });
    } catch (e) {
      out.bcs.push({ id: b.id, nodes: [], dofs: b.dofs, value: b.value, desc: '?' });
      out.errors.push(`${b.id}: ${e.message}`);
    }
  }
  const t = spec.sections['*'].thickness;
  for (const l of spec.loads) {
    try {
      if (l.type === 'force') {
        const ids = resolve(geo, l.select);
        const v = l.per_node ? l.vector : l.vector.map((x) => x / Math.max(ids.length, 1));
        out.loads.push({ id: l.id, type: 'force', nodes: ids, vectors: ids.map(() => v), total: l.per_node ? l.vector.map((x) => x * ids.length) : l.vector, desc: describe(l.select) + (l.per_node ? ' · 절점마다' : '') });
      } else if (l.type === 'pressure') {
        const fs = facesOf(geo, resolve(geo, l.select));
        const centers = [], dirs = [], areas = [];
        const total = [0, 0, 0];
        for (const f of fs) {
          const fg = faceGeom(geo.nodes, geo.panels[f]);
          const flip = (l.flip || []).includes(f) ? -1 : 1;
          const d = l.mode === 'local' ? fg.n.map((x) => x * flip) : l.direction.map((x) => x / Math.hypot(...l.direction));
          centers.push(fg.c);
          dirs.push(d);
          areas.push(fg.A);
          for (let k = 0; k < 3; k++) total[k] += l.value * fg.A * d[k];
        }
        out.loads.push({ id: l.id, type: 'pressure', mode: l.mode, faces: fs, centers, dirs, areas, nodes: [], vectors: [], total, desc: `${describe(l.select)} · 면 ${fs.length}개 · ${l.mode === 'local' ? '면 법선 (Local)' : '고정 방향 (Global)'}` });
      } else {
        const rho = spec.materials.default.rho || 0;
        let A = 0;
        for (const f of geo.panels) A += faceGeom(geo.nodes, f).A;
        out.loads.push({ id: l.id, type: 'gravity', nodes: [], vectors: [], total: l.vector.map((g) => (rho * t * A * g)), desc: `자중 ρ=${rho}` });
      }
    } catch (e) {
      out.loads.push({ id: l.id, type: l.type, nodes: [], vectors: [], desc: '?' });
      out.errors.push(`${l.id}: ${e.message}`);
    }
  }
  for (const s of spec.symmetry) out.symmetry.push({ id: s.id, axis: s.axis, at: s.at, edges: symEdges(geo, s), desc: `${s.axis} = ${+s.at.toPrecision(6)} 평면` });
  return out;
}

export function warnings(spec, geo) {
  const out = [];
  if (!geo) return out;
  const pv = preview(spec, geo);
  const fixed = new Set();
  for (const b of spec.bcs) for (const d of b.dofs) fixed.add(d);
  for (const s of spec.symmetry) fixed.add(AXN[s.axis] + 1);
  const st = spec.step.type;
  if (st === 'kinematic') {
    if (!(spec.bh.drivers || []).length) out.push('기구 해석: 구동 주름이 없어 자유도와 기구 모드만 계산합니다 (경로를 보려면 "2-7 주름을 120도까지 구동"처럼 지정)');
    return out;
  }
  if (!spec.bcs.length && !spec.symmetry.length && st !== 'modal') out.push('구속이 없습니다 (강체 운동 가능)');
  else if (st !== 'modal' && [1, 2, 3].some((d) => !fixed.has(d))) out.push('병진 자유도 중 구속되지 않은 방향이 있습니다: ' + [1, 2, 3].filter((d) => !fixed.has(d)).map((d) => 'xyz'[d - 1]).join(', '));
  const moving = spec.bcs.some((b) => b.value);
  if (!moving && !spec.loads.length && ['static', 'arclength'].includes(st)) out.push('하중이나 강제 변위가 없습니다');
  if (spec.bh.plastic_hinge && !spec.materials.default.yield && spec.bh.fold_yield == null) out.push('소성 힌지를 켰지만 재료 항복 응력이 없어 힌지는 탄성으로 계산합니다');
  if (st === 'modal' && !(spec.materials.default.rho > 0) && spec.bh.use_mass !== false) out.push('모달 해석에는 밀도가 필요합니다');
  if (spec.bh.contact && !['static', 'arclength'].includes(st)) out.push('기하 접촉은 정적·호장법 해석에서만 적용됩니다');
  for (const s of pv.symmetry) if (!s.edges.length) out.push(`${s.id}: ${s.axis} = ${s.at} 평면 위에 놓인 테두리 엣지가 없습니다`);
  if (spec.symmetry.length) {
    for (const p of pv.bcs) for (const s of spec.symmetry) {
      const a = AXN[s.axis];
      if (p.value && p.dofs[0] !== a + 1 && p.nodes.some((i) => Math.abs(geo.nodes[i][a] - s.at) < 1e-9 * diagOf(geo.nodes))) out.push(`${p.id}: 대칭면 위 절점의 강제 변위는 대칭 모델에서 그대로 쓰입니다 (값 확인)`);
    }
    for (const l of pv.loads) for (const s of spec.symmetry) {
      const a = AXN[s.axis];
      const on = l.nodes.filter((i) => Math.abs(geo.nodes[i][a] - s.at) < 1e-9 * diagOf(geo.nodes));
      if (on.length) out.push(`${l.id}: 대칭면 위 절점 ${on.length}개에 하중이 있습니다. 대칭 모델에서는 전체 하중의 절반을 넣어야 합니다`);
    }
  }
  return [...new Set(out)];
}

export function coreInput(spec, geo) {
  const m = spec.materials.default;
  const bh = spec.bh;
  const t = spec.sections['*'].thickness;
  const st = spec.step;
  const opt = { model: bh.model || 'N5B8', calib: bh.calib || 'auto', E: m.E, nu: m.nu, t, rho: m.rho || 0 };
  if (bh.Lstar) opt.Lstar = bh.Lstar;
  else opt.Lratio = bh.Lstar_ratio || 3;
  if (m.yield) {
    opt.barCM = 'plastic';
    opt.barYield = m.yield;
    opt.barH = m.hardening || 0;
  } else if (bh.bar_cm) opt.barCM = bh.bar_cm;
  if (bh.plastic_hinge) {
    const mp = bh.fold_yield != null ? bh.fold_yield : m.yield ? (m.yield * t * t) / 4 * (bh.hinge_mp_factor || 1) : null;
    if (mp != null) {
      opt.foldCM = 'plastic';
      opt.foldYield = mp;
      opt.foldH = bh.fold_H || 0;
    }
  } else if (bh.fold_cm) opt.foldCM = bh.fold_cm;
  if (bh.bend_yield != null) {
    opt.bendCM = 'plastic';
    opt.bendYield = bh.bend_yield;
    opt.bendH = bh.bend_H || 0;
    opt.edgeBendCM = 'plastic';
  } else if (bh.bend_cm) opt.bendCM = bh.bend_cm;
  for (const [a, b] of [['tri_bars', 'triBars'], ['edge_bend', 'edgeBend'], ['FB', 'FB'], ['Fs', 'Fs'], ['compat', 'compat'], ['fold_th1', 'foldTh1'], ['fold_th2', 'foldTh2'], ['bend_th1', 'bendTh1'], ['bend_th2', 'bendTh2'], ['fold_scale', 'foldScale'], ['bend_scale', 'bendScale']]) if (bh[a] !== undefined && bh[a] !== null) opt[b] = bh[a];
  if (bh.bar_area) opt.Abar = bh.bar_area;
  if (bh.fold_k) opt.Kf = bh.fold_k;
  if (bh.bend_k) opt.Kb = bh.bend_k;
  if (st.imperfection) opt.imperfection = st.imperfection;
  const supp = new Map();
  const disp = new Map();
  for (const b of spec.bcs) {
    const ids = resolve(geo, b.select);
    for (const i of ids) {
      if (!b.value) {
        const s = supp.get(i) || [0, 0, 0];
        for (const d of b.dofs) s[d - 1] = 1;
        supp.set(i, s);
      } else {
        const v = disp.get(i) || [null, null, null];
        v[b.dofs[0] - 1] = b.value;
        disp.set(i, v);
      }
    }
  }
  for (const [i, v] of disp) {
    const s = supp.get(i);
    if (s) for (let k = 0; k < 3; k++) if (v[k] !== null) s[k] = 0;
  }
  const forces = new Map();
  const pressures = [];
  for (const l of spec.loads) {
    if (l.type === 'force') {
      const ids = resolve(geo, l.select);
      const v = l.per_node ? l.vector : l.vector.map((x) => x / Math.max(ids.length, 1));
      for (const i of ids) {
        const f = forces.get(i) || [0, 0, 0];
        for (let k = 0; k < 3; k++) f[k] += v[k];
        forces.set(i, f);
      }
    } else if (l.type === 'pressure') {
      pressures.push({ faces: facesOf(geo, resolve(geo, l.select)), p: l.value, mode: l.mode, dir: l.direction || [0, 0, -1], flip: l.flip || [] });
    } else {
      const gm = Math.hypot(...l.vector);
      if (gm > 0 && m.rho > 0) pressures.push({ faces: geo.panels.map((_, i) => i), p: m.rho * t * gm, mode: 'global', dir: l.vector.map((x) => x / gm) });
    }
  }
  const symmetry = spec.symmetry.map((s) => ({ axis: s.axis, c: s.at, bars: symEdges(geo, s) }));
  const moving = disp.size > 0;
  const type = st.type === 'modal' ? 'modal' : st.type === 'kinematic' ? 'kinematic' : st.type === 'arclength' || !moving ? 'force' : 'displacement';
  const inc = st.increments || 100;
  const analysis = { type, dispStep: inc, maxIcr: Math.max(inc, 1), lambda0: st.lambda0 || 1 / inc, lamMax: st.lam_max === null ? -1 : st.lam_max ?? 1, contact: !!bh.contact && (type === 'displacement' || type === 'force'), modes: st.modes || 6, useMass: bh.use_mass !== false, kinSteps: inc };
  if (bh.gap) analysis.gap = bh.gap;
  if (bh.cycles > 0 && type === 'displacement') {
    analysis.cycles = bh.cycles;
    analysis.cycleBack = bh.cycle_back || 0;
  }
  if (st.stop) analysis.stop = st.stop;
  if (bh.compat) analysis.exact = false;
  if (type === 'kinematic' && (bh.drivers || []).length) {
    analysis.driverEdges = bh.drivers.map((k) => k.split('-').map(Number));
    analysis.targets = (bh.targets || []).map((d) => (d * Math.PI) / 180);
  }
  return {
    nodes: geo.nodes,
    panels: geo.panels,
    creases: spec.creases,
    lines: geo.lines || [],
    tolDeg: bh.tol || 3,
    options: opt,
    supports: [...supp].map(([i, s]) => [i, ...s]),
    forces: [...forces].map(([i, f]) => [i, ...f]),
    displacements: [...disp].map(([i, v]) => [i, ...v]),
    pressures,
    symmetry,
    analysis,
  };
}

function modelSummary() {
  const g = S.geo;
  const [lo, hi] = bbox(g.nodes);
  const counts = { nodes: g.nodes.length, beams: 0, shells: g.panels.length, solids: 0 };
  const tri = g.panels.filter((f) => f.length === 3).length;
  const quad = g.panels.filter((f) => f.length === 4).length;
  return { source: g.name, kind: 'obj', counts, tri, quad, poly: g.panels.length - tri - quad, bbox: { min: lo, max: hi }, groups: {} };
}

function view() {
  return { nodes: S.geo.nodes, shells: S.geo.panels, boundary: [], beams: [], hinges: {}, shell_group: [] };
}

export function state(withView = true) {
  if (!S.geo) return { model: null, llm: llm.publicConfig(S.llm) };
  const out = {
    model: modelSummary(),
    spec: S.spec,
    preview: preview(S.spec, S.geo),
    warnings: warnings(S.spec, S.geo),
    can_undo: S.undo.length > 0,
    result: S.result ? S.result.meta : null,
    stale: S.stale,
    solve_time: S.solveTime,
    llm: llm.publicConfig(S.llm),
  };
  if (withView) out.view = view();
  return out;
}

function setModel(geo, spec) {
  S.geo = geo;
  S.spec = spec || defaultSpec();
  S.undo = [];
  S.result = null;
  S.stale = false;
  S.chat = [];
  S.solveTime = null;
}

function apply(ops) {
  const saved = S.spec;
  const savedGeo = S.geo;
  const r = applyOps(S.spec, ops, S.geo);
  S.spec = r.spec;
  if (r.geo) {
    S.geo = r.geo;
    S.result = null;
  }
  S.undo.push({ spec: saved, geo: savedGeo });
  S.undo.splice(0, Math.max(0, S.undo.length - 30));
  if (ops.some((o) => o.op !== 'add_plot' && o.op !== 'set_view' && !(o.op === 'remove' && String(o.id).startsWith('pl')))) S.stale = S.result !== null;
  return r.log;
}

let EXAMPLES = null;
async function examples() {
  if (!EXAMPLES) EXAMPLES = await (await fetch('examples/presets.json')).json();
  return EXAMPLES;
}

function fieldValues(res, i, field) {
  const { model, raw, stride, nd, nn } = res;
  const n = model.nodes.length;
  const base = i * stride;
  const U = [];
  const vals = new Float64Array(n);
  const f = raw.subarray(base, base + stride);
  for (let k = 0; k < n; k++) U.push([f[3 * k], f[3 * k + 1], f[3 * k + 2]]);
  if (field === 'U') for (let k = 0; k < n; k++) vals[k] = Math.hypot(...U[k]);
  else if (field === 'ux' || field === 'uy' || field === 'uz') for (let k = 0; k < n; k++) vals[k] = U[k]['xyz'.indexOf(field[1])];
  else if (res.kind === 'static') {
    const off = 2 * nd;
    for (let k = 0; k < n; k++) {
      const eb = f[off + k], ef = f[off + nn + k], ebd = f[off + 2 * nn + k];
      const e = field === 'stretchDensity' ? eb : field === 'foldDensity' ? ef : field === 'bendDensity' ? ebd : eb + ef + ebd;
      vals[k] = e / (res.nodeArea[k] || 1);
    }
  }
  return { U, vals };
}

function nodeAreas(model) {
  const a = new Float64Array(model.nodes.length);
  for (const t of model.tris) {
    const ar = Math.hypot(...triArea(model.nodes[t[0]], model.nodes[t[1]], model.nodes[t[2]]));
    for (const v of t) a[v] += ar / 3;
  }
  return a;
}

function staticSeries(res) {
  const r = res.result;
  const n = r.lam.length;
  const step = [...Array(n).keys()];
  return { step, r };
}

function forceSeries(res) {
  const r = res.result;
  const { raw, stride, nd } = res;
  const n = r.lam.length;
  if (res.mode === 'force') {
    const Fm = Math.hypot(...[0, 1, 2].map((k) => r.F.reduce((s, v, i) => s + (i % 3 === k ? v : 0), 0)));
    return { name: Fm > 0 ? '작용 하중 합 λ·|ΣF| (N)' : '하중 계수 λ', y: r.lam.map((l) => l * (Fm || 1)), lam: r.lam };
  }
  const imp = [];
  r.Ubar.forEach((v, i) => v !== 0 && imp.push(i));
  const y = [];
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (const i of imp) s += raw[k * stride + nd + i] * Math.sign(r.Ubar[i]);
    y.push(s);
  }
  return { name: '하중점 반력 (강제 변위 방향, N)', y };
}

function quantity(res, q, sel) {
  const r = res.result;
  const { raw, stride, nd } = res;
  const n = r.lam ? r.lam.length : res.count;
  const E = (k) => r[k];
  const tot = () => r.US.map((_, i) => r.US[i] + r.UF[i] + r.UB[i] + r.UE[i]);
  if (q === 'angle') {
    const key = sel && sel.edge;
    const j = key ? hingeIndex(res, key) : -1;
    if (j < 0) throw new Error(`angle: 힌지를 찾지 못했습니다 (${key ? edgeLabel(key) : '엣지 없음'})`);
    return { name: `${edgeLabel(key)} 이면각 (도)`, y: hingeAngleSeries(res, j) };
  }
  if (q === 'step' && res.kind !== 'static') return { name: '스텝', y: [...Array(res.count).keys()] };
  if (res.kind !== 'static') throw new Error(`${q}: 이 해석 종류에서는 쓸 수 없는 양입니다`);
  switch (q) {
    case 'step': return { name: '스텝', y: [...Array(n).keys()] };
    case 'lam': return { name: '하중 계수 λ', y: r.lam };
    case 'energy.total': return { name: '총 저장 에너지', y: tot() };
    case 'energy.bar': return { name: '바 에너지 US', y: E('US') };
    case 'energy.fold': return { name: '접힘 에너지 UF', y: E('UF') };
    case 'energy.bend': return { name: '휨 에너지 UB', y: r.UB.map((v, i) => v + r.UE[i]) };
    case 'energy.plastic': return { name: '소성 소산', y: E('Wp') };
    case 'energy.contact': return { name: '접촉 장벽 에너지', y: E('Uc') };
    case 'energy.external': return { name: '외부 일', y: E('Wext') };
    case 'force': return forceSeries(res);
  }
  const m = q.match(/^(u|force|reaction)\.?([xyz])?$/);
  if (m) {
    const ids = sel ? resolve(S.geo, sel) : [];
    if (!ids.length) throw new Error(`${q}: 대상 절점이 없습니다`);
    const comp = m[2] ? ['xyz'.indexOf(m[2])] : [0, 1, 2];
    const off = m[1] === 'u' ? 0 : nd;
    const y = [];
    for (let k = 0; k < n; k++) {
      let s = 0;
      if (m[2]) {
        for (const i of ids) s += raw[k * stride + off + 3 * i + comp[0]];
        if (m[1] === 'u') s /= ids.length;
      } else {
        for (const i of ids) {
          const v = [0, 1, 2].map((c) => raw[k * stride + off + 3 * i + c]);
          s += m[1] === 'u' ? Math.hypot(...v) / ids.length : 0;
        }
        if (m[1] !== 'u') {
          const v = [0, 1, 2].map((c) => ids.reduce((a, i) => a + raw[k * stride + off + 3 * i + c], 0));
          s = Math.hypot(...v);
        }
      }
      y.push(s);
    }
    const who = describe(sel);
    const nm = m[1] === 'u' ? `변위 ${m[2] ? 'u' + m[2] : '|u|'} (${who}, mm)` : `절점 힘 ${m[2] ? 'F' + m[2] : '|F|'} (${who}, N)`;
    return { name: nm, y };
  }
  throw new Error(`알 수 없는 양: ${q}`);
}

export function edgeLabel(k) {
  const [a, b] = String(k).split('-').map(Number);
  return `${a + 1}-${b + 1}`;
}

function dihedralJS(xj, xk, xi, xl) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const rkj = sub(xk, xj), rij = sub(xi, xj), rkl = sub(xk, xl);
  const m = crs(rij, rkj), n = crs(rkj, rkl);
  const trip = dot(n, rij);
  const sg = Math.abs(trip) > 1e-8 ? Math.sign(trip) : 1;
  let th = sg * Math.atan2(Math.hypot(...rkj) * Math.abs(trip), dot(m, n));
  if (th < 0) th += 2 * Math.PI;
  return th;
}

function hingeIndex(res, key) {
  return res.model.hinges.findIndex((h) => edgeKey(h.edge[0], h.edge[1]) === key);
}

function hingeAngleSeries(res, j) {
  if (res.kind === 'kinematic' && !res.result.mechModes) return res.result.angles.map((a) => (a[j] * 180) / Math.PI);
  if (res.kind !== 'static') return [];
  const h = res.model.hinges[j];
  const X = res.model.nodes;
  const out = [];
  for (let k = 0; k < res.count; k++) {
    const P = (i) => [0, 1, 2].map((c) => X[i][c] + res.raw[k * res.stride + 3 * i + c]);
    let xl = P(h.n[3]);
    if (h.ghost >= 0) {
      xl = P(h.n[2]);
      const c = S.spec.symmetry.find((q) => 'xyz'.indexOf(q.axis) === h.ghost);
      if (c) xl[h.ghost] = 2 * c.at - xl[h.ghost];
    }
    out.push((dihedralJS(P(h.n[0]), P(h.n[1]), P(h.n[2]), xl) * 180) / Math.PI);
  }
  return out;
}

function spaceInputs(spec) {
  return spec.plots.filter((p) => p.type === 'space3').map((p) => ({ key: p.edges.join(','), edges: p.edges.map((k) => k.split('-').map(Number)), ndir: 24, steps: 60 }));
}

async function ensureSpaces(res) {
  res.spaces = res.spaces || {};
  const miss = spaceInputs(S.spec).filter((q) => !res.spaces[q.key]);
  if (!miss.length) return;
  const input = coreInput(S.spec, S.geo);
  input.spaces = miss;
  const d = await runWorker('space', input);
  miss.forEach((q, i) => (res.spaces[q.key] = d.result.spaces[i]));
}

function space3(res, p) {
  const sp = (res.spaces || {})[p.edges.join(',')];
  const labels = p.edges.map(edgeLabel);
  if (!sp) return { id: p.id, title: p.title, type: '3d', error: '해공간을 계산하지 못했습니다', series: [] };
  const deg = (v) => (v * 180) / Math.PI;
  const paths = sp.paths.map((path) => path.map((q) => q.map(deg)));
  const idx = p.edges.map((k) => hingeIndex(res, k));
  let main = [];
  if (idx.every((j) => j >= 0)) {
    const ser = idx.map((j) => hingeAngleSeries(res, j));
    if (ser[0].length > 1) main = ser[0].map((_, k) => ser.map((q) => q[k]));
  }
  const notes = [];
  if (sp.missing.length) notes.push(`힌지가 아닌 엣지: ${sp.missing.map((e) => edgeLabel(edgeKey(e[0], e[1]))).join(', ')}`);
  return { id: p.id, title: p.title, type: '3d', edges: labels, dof: sp.dof, paths, main, mainName: res.kind === 'kinematic' ? '기구 해석 경로' : '해석 경로', notes, series: [] };
}

function customPlots(res, out) {
  for (const p of S.spec.plots) {
    if (p.type === 'space3') {
      out.push(space3(res, p));
      continue;
    }
    try {
      const xs = quantity(res, p.x.quantity, p.x.select);
      const series = p.series.map((s) => {
        const q = quantity(res, s.quantity, s.select);
        return { name: s.name || q.name, x: xs.y, y: q.y };
      });
      out.push({ id: p.id, title: p.title, xlabel: xs.name, series });
    } catch (e) {
      out.push({ id: p.id, title: p.title, error: e.message, series: [] });
    }
  }
}

async function plotList() {
  const res = S.result;
  if (!res) return [];
  if (S.spec.plots.some((p) => p.type === 'space3')) {
    try {
      await ensureSpaces(res);
    } catch (e) {}
  }
  const out = [];
  if (res.kind === 'static') {
    const { step } = staticSeries(res);
    const ser = ['energy.total', 'energy.bar', 'energy.fold', 'energy.bend'].map((q) => quantity(res, q));
    if (res.result.UE.some((v) => v !== 0)) ser[3].name = '휨 에너지 UB (패널 + 휨 엣지)';
    if (res.result.Wp.some((v) => v !== 0)) ser.push(quantity(res, 'energy.plastic'));
    if (res.result.Uc.some((v) => v !== 0)) ser.push(quantity(res, 'energy.contact'));
    out.push({ id: 'auto_e', auto: true, title: '스텝-에너지', xlabel: '스텝', series: ser.map((s) => ({ name: s.name, x: step, y: s.y })) });
    const f = forceSeries(res);
    out.push({ id: 'auto_f', auto: true, title: '스텝-힘', xlabel: '스텝', series: [{ name: f.name, x: step, y: f.y }] });
    customPlots(res, out);
  } else if (res.kind === 'modal') {
    const fr = res.result.freq;
    out.push({ id: 'auto_m', auto: true, title: res.result.useMass ? '고유진동수 (Hz)' : '강성 고유값', xlabel: '모드', series: [{ name: res.result.useMass ? '진동수 (Hz)' : '고유값', x: fr.map((_, i) => i + 1), y: res.result.useMass ? fr : res.result.eig }] });
  } else if (res.kind === 'kinematic') {
    const A = res.result.angles;
    const drv = (S.spec.bh.drivers || []);
    const idx = drv.map((k) => res.model.hinges.findIndex((h) => edgeKey(h.edge[0], h.edge[1]) === k));
    if (A && A.length > 1 && idx.length && !res.result.mechModes) out.push({ id: 'auto_k', auto: true, title: '구동 주름 이면각 (도)', xlabel: '스텝', series: idx.map((j, q) => ({ name: edgeLabel(drv[q]), x: A.map((_, i) => i), y: A.map((a) => (a[j] * 180) / Math.PI) })) });
    customPlots(res, out);
  }
  if (res.kind === 'modal') customPlots(res, out);
  return out;
}

function buildResult(kind, mode, model, result, frames, elapsed) {
  const nd = 3 * model.nodes.length;
  const nn = model.nodes.length;
  const stride = kind === 'static' ? result.stride : nd;
  const count = Math.floor(frames.length / stride);
  const res = { kind, mode, model, result, raw: frames, stride, nd, nn, count, elapsed };
  res.nodeArea = nodeAreas(model);
  const labels = [];
  for (let i = 0; i < count; i++) {
    if (kind === 'static') {
      const legs = S.spec.bh.cycles > 0 ? Math.round(Math.max(...result.s)) : 1;
      const sv = result.s[i];
      labels.push(mode === 'force' ? `스텝 ${i} · λ=${(+result.lam[i]).toPrecision(4)}` : legs > 1 ? `스텝 ${i} · 구간 ${Math.min(legs, Math.floor(sv) + (sv % 1 > 0 ? 1 : 0)) || 1}/${legs}` : `스텝 ${i} · 진행 ${(100 * sv).toFixed(1)}%`);
    }
    else if (kind === 'modal') labels.push(`모드 ${i + 1}${result.useMass ? ` · ${(+result.freq[i]).toPrecision(4)} Hz` : ` · λ=${(+result.eig[i]).toPrecision(4)}`}`);
    else if (result.mechModes) labels.push(`기구 모드 ${i + 1}`);
    else labels.push(`경로 ${i}`);
  }
  const fields = kind === 'static' ? ['energyDensity', 'foldDensity', 'bendDensity', 'stretchDensity', 'U', 'ux', 'uy', 'uz'] : ['U', 'ux', 'uy', 'uz'];
  const summary = {};
  if (kind === 'static') {
    const L = count - 1;
    let umax = 0;
    for (let f = 0; f < count; f++) for (let k = 0; k < nn; k++) umax = Math.max(umax, Math.hypot(frames[f * stride + 3 * k], frames[f * stride + 3 * k + 1], frames[f * stride + 3 * k + 2]));
    summary['풀이'] = mode === 'force' ? '호장법 (MGDCM)' : '강제 변위 (감쇠 뉴턴)';
    summary['증분'] = L;
    summary['최대 변위 (전 스텝, mm)'] = umax;
    if (mode === 'force') summary['최종 하중 계수 λ'] = result.lam[L];
    const f = forceSeries(res);
    summary[mode === 'force' ? '최종 하중 (N)' : '최종 반력 (N)'] = f.y[L];
    summary['최대 반력/하중 (N)'] = Math.max(...f.y.map(Math.abs));
    summary['바 / 접힘 / 휨 에너지 (N·mm)'] = [result.US[L], result.UF[L], result.UB[L] + result.UE[L]];
    if (result.Wp[L]) summary['소성 소산 (N·mm)'] = result.Wp[L];
    const retries = (result.notes || []).filter((q) => q === 'retry' || q === 'reduce_radius').length;
    const st = { completed: '완료', load_reached: '목표 하중 도달', max_increments: '최대 증분 도달', stop_criterion: '정지 조건', no_convergence: '수렴 실패로 중단', radius_underflow: '호장 반경이 너무 작아 중단', contact_blocked: '강제 변위 절점이 접촉에 막혀 중단' }[result.status] || result.status;
    summary['참고'] = [`상태: ${st}`, ...(retries ? [`증분 재시도 ${retries}회 (MERLIN2 방식 보폭 조절)`] : [])];
  } else if (kind === 'modal') {
    summary['모드 수'] = count;
    summary['강체 모드'] = result.rigid;
    summary['참고'] = [result.useMass ? '질량 포함 고유진동수 (집중 질량: 패널 질량을 꼭짓점과 중심점에 균등 분배)' : 'K 만의 고유값'];
    if (S.spec.symmetry.length) summary['참고'].push('대칭 조건이 있어 대칭 모드만 나옵니다');
  } else {
    summary['참고'] = ['강체 패널 가정 (패널 휨 힌지를 구속으로 둠)'];
    if (result.mechModes) summary['참고'].push(`구동 주름이 없어 기구 모드(구속 야코비안의 영공간) ${result.mechModes}개를 보여 줍니다`);
    if (result.error) summary['참고'].push({ driver_not_found: '구동 주름을 찾지 못했습니다', path_incompatible: '구동 목표까지 강체 접힘 경로가 이어지지 않아 중간에 멈췄습니다' }[result.error] || result.error);
  }
  if (result.dof) {
    const d = result.dof;
    summary['기구 자유도 (강체 패널)'] = d.mechanisms;
    summary['자기 응력 상태'] = d.selfStress;
    summary['구속식 / 자유 자유도 / 계수'] = [d.constraints, d.freeDofs, d.rank];
  }
  if (kind === 'modal' && result.dof && result.dof.rigidRemoved === 0 && !result.useMass) summary['참고'].push('K 의 0 고유값 수 = 강체 모드 + 기구 모드 (패널 휨·접힘 강성이 있으면 기구 모드는 작은 양수 고유값)');
  res.meta = { kind, solver: 'bh', frames: labels, fields, summary, mode, nInput: S.geo.nodes.length, mechModes: result.mechModes || 0 };
  return res;
}

function runWorker(kind, input) {
  return new Promise((resolveP, reject) => {
    if (S.worker) S.worker.terminate();
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    S.worker = w;
    S.progress = { running: true, t0: performance.now(), stage: '모델 준비 중' };
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') S.progress = { ...S.progress, ...d.status, elapsed: d.elapsed };
      else if (d.type === 'model') S.progress.stage = `해석 중 · 절점 ${d.model.nodes.length} · 바 ${d.model.bars.length} · 힌지 ${d.model.hinges.length}`;
      else if (d.type === 'done') {
        S.progress = { running: false };
        w.terminate();
        S.worker = null;
        resolveP(d);
      } else if (d.type === 'error') {
        S.progress = { running: false };
        w.terminate();
        S.worker = null;
        reject(new Error(d.message));
      }
    };
    w.onerror = (e) => {
      S.progress = { running: false };
      reject(new Error(e.message || '계산 작업 오류'));
    };
    w.postMessage({ kind, input, chunk: 2 });
  });
}

function need() {
  if (!S.geo) throw new Error('먼저 지오메트리를 불러오세요');
}

export async function api(path, opts = {}) {
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const body = opts.json;
  if (p === '/api/state') return state();
  if (p === '/api/examples') {
    const ex = await examples();
    return Object.entries(ex).map(([name, v]) => ({ name, title: v.title, note: v.note, prompts: v.prompts || [], file: v.file }));
  }
  if (p.startsWith('/api/examples/')) {
    const name = p.split('/').pop();
    const ex = (await examples())[name];
    if (!ex) throw new Error('예제가 없습니다');
    const text = await (await fetch('examples/' + ex.file)).text();
    setModel(parseOBJ(text, ex.file));
    const ops = +q.get('preset') ? ex.ops : ex.ops.filter((o) => o.op.startsWith('set_'));
    if (ops.length) {
      const r = applyOps(S.spec, ops, S.geo);
      S.spec = r.spec;
      if (r.geo) S.geo = r.geo;
    }
    return state();
  }
  if (p === '/api/upload') {
    const { name, text } = opts.file;
    if (!/\.obj$/i.test(name)) throw new Error('바-힌지 모델은 OBJ (삼각형·사각형 패널) 를 받습니다');
    setModel(parseOBJ(text, name));
    return state();
  }
  if (p === '/api/ops') {
    need();
    const log = apply(body.ops);
    return { ...state(), log };
  }
  if (p === '/api/undo') {
    need();
    if (!S.undo.length) throw new Error('되돌릴 내용이 없습니다');
    const u = S.undo.pop();
    if (u.geo !== S.geo) S.result = null;
    S.spec = u.spec;
    S.geo = u.geo;
    S.stale = S.result !== null;
    return state();
  }
  if (p === '/api/reset') {
    S.geo = null;
    S.spec = null;
    S.result = null;
    return state();
  }
  if (p === '/api/chat') return chat(body.text, body.sel);
  if (p === '/api/solve') {
    need();
    const input = coreInput(S.spec, S.geo);
    const kind = input.analysis.type === 'modal' ? 'modal' : input.analysis.type === 'kinematic' ? 'kinematic' : 'static';
    input.spaces = spaceInputs(S.spec);
    const d = await runWorker(kind, input);
    if (kind === 'modal') d.result.useMass = input.analysis.useMass;
    S.result = buildResult(kind, input.analysis.type, d.model, d.result, d.frames, d.elapsed);
    S.result.spaces = {};
    input.spaces.forEach((q, i) => (S.result.spaces[q.key] = d.result.spaces[i]));
    S.stale = false;
    S.solveTime = +d.elapsed.toFixed(2);
    return state();
  }
  if (p === '/api/progress') {
    const pr = S.progress;
    if (!pr.running) return { running: false };
    const el = (performance.now() - pr.t0) / 1000;
    const out = { running: true, elapsed: el, stage: pr.stage, inc: pr.icrm };
    if (pr.status !== undefined && pr.done === false) {
      const frac = pr.legs > 0 ? (pr.leg + Math.min(1, pr.dspmvd)) / pr.legs : Math.min(1, Math.abs(pr.lam));
      out.lam = Math.max(0, Math.min(1, frac));
      if (out.lam > 0.02) out.eta = (el * (1 - out.lam)) / out.lam;
    }
    return out;
  }
  if (p === '/api/cancel/solve') {
    if (S.worker) {
      S.worker.terminate();
      S.worker = null;
      S.progress = { running: false };
      throw new Error('해석을 중단했습니다');
    }
    return {};
  }
  if (p === '/api/cancel/llm') {
    llm.cancel();
    return {};
  }
  if (p === '/api/creases') {
    need();
    return creases();
  }
  if (p === '/api/result/mesh') {
    const res = S.result;
    const m = res.model;
    const fe = new Map();
    for (const f of m.panels) for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      fe.set(edgeKey(a, b), [a, b]);
    }
    const bars = m.bars && m.bars.length ? m.bars.map((b) => [b[0], b[1]]) : [...fe.values()];
    return { nodes: m.nodes, tris: m.tris, lines: [], fedges: bars, nInput: S.geo.nodes.length, orig: m.orig };
  }
  if (p === '/api/result/frame') {
    const res = S.result;
    const i = +q.get('i');
    const field = q.get('field');
    const { U, vals } = fieldValues(res, i, field);
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (res.kind === 'static' && field.endsWith('Density')) {
      res._hi = res._hi || {};
      if (res._hi[field] === undefined) {
        let h = 0;
        for (let k = 0; k < res.count; k++) for (const v of fieldValues(res, k, field).vals) h = Math.max(h, v);
        res._hi[field] = h;
      }
      lo = 0;
      hi = res._hi[field];
    }
    return { U, values: Array.from(vals), min: lo, max: hi, label: res.meta.frames[i], time: res.kind === 'static' ? res.result.s[i] : 0 };
  }
  if (p === '/api/plots') return await plotList();
  if (p === '/api/llm') {
    if (body) S.llm = llm.saveConfig({ ...S.llm, ...body });
    return { llm: llm.publicConfig(S.llm), status: await llm.status(S.llm) };
  }
  if (p === '/api/llm/test') return { test: await llm.test(S.llm) };
  if (p === '/api/export/spec') return { geometry: S.geo, spec: S.spec };
  if (p === '/api/import/spec') {
    setModel(body.geometry, body.spec);
    return state();
  }
  throw new Error(`알 수 없는 요청: ${p}`);
}

function creases() {
  const g = S.geo;
  const pe = panelEdges(g);
  const marked = new Set((g.lines || []).map(([a, b]) => edgeKey(a, b)));
  const tol = S.spec.bh.tol || 3;
  const ang = new Map();
  let amax = 0;
  for (const [k, fl] of pe) {
    if (fl.length !== 2) continue;
    const [a, b] = k.split('-').map(Number);
    const f1 = g.panels[fl[0]], f2 = g.panels[fl[1]];
    let n1 = faceGeom(g.nodes, f1).n, n2 = faceGeom(g.nodes, f2).n;
    const dir = (f) => {
      const i = f.indexOf(a);
      return f[(i + 1) % f.length] === b;
    };
    if (dir(f1) === dir(f2)) n2 = n2.map((x) => -x);
    const c = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
    const d = (Math.acos(c) * 180) / Math.PI;
    ang.set(k, d);
    amax = Math.max(amax, d);
  }
  let note;
  const auto = new Map();
  if (marked.size) {
    for (const [k, d] of ang) auto.set(k, marked.has(k) || d >= tol ? 'fold' : 'bend');
    note = 'OBJ 의 l(선)로 표시한 엣지와 꺾인 엣지는 접힘, 나머지는 휨으로 판정';
  } else if (ang.size && amax < tol) {
    for (const k of ang.keys()) auto.set(k, 'fold');
    note = '평평한 전개도라 내부 엣지를 모두 접힘으로 판정 (휨으로 바꿀 엣지는 직접 골라 주세요)';
  } else {
    for (const [k, d] of ang) auto.set(k, d >= tol ? 'fold' : 'bend');
    note = `꺾임 ${tol}도 이상은 접힘, 미만은 휨으로 판정`;
  }
  const edges = [];
  for (const [k, fl] of pe) {
    const e = k.split('-').map(Number);
    const type = fl.length === 1 ? 'boundary' : S.spec.creases[k] || auto.get(k) || 'fold';
    edges.push({ edge: e, type, auto: fl.length === 1 ? 'boundary' : auto.get(k), angle: ang.get(k) ?? null });
  }
  return { edges, note };
}

async function chat(text, sel) {
  need();
  text = (text || '').trim();
  if (!text) throw new Error('내용이 비어 있습니다');
  const cfg = S.llm;
  const picked = sel && ((sel.points && sel.points.length) || (sel.segments && sel.segments.length)) ? sel : null;
  const ctx = { result: S.result, creaseSel: sel && sel.creases };
  const rr = rules.parse(text, S.geo, S.spec, picked, ctx);
  let ruleOk = rr.info.complete;
  if (ruleOk && rr.ops.length) {
    try {
      applyOps(S.spec, rr.ops, S.geo);
    } catch (e) {
      ruleOk = false;
      rr.reply += ` (적용 검사 실패: ${e.message})`;
    }
  }
  const direct = ruleOk || (rr.info.ask && !rr.info.unknown) || rr.info.answered;
  const mode = cfg.mode;
  const useLlm = (mode === 'auto' || mode === 'llm' || (mode === 'rule_first' && !direct)) && llm.configured(cfg);
  if (mode === 'llm' && !llm.configured(cfg)) throw new Error('LLM 이 설정되지 않았습니다. LLM 칸에 엔드포인트와 모델 이름을 넣어 주세요');
  let ops = rr.ops, reply = rr.reply, engine = 'rule', note = '';
  if (useLlm) {
    try {
      const c = llm.context(S.geo, S.spec, S.result ? S.result.meta : null, picked);
      const r = await llm.ask(cfg, text, c, S.chat);
      try {
        applyOps(S.spec, r.ops, S.geo);
        ops = r.ops;
        reply = r.reply;
      } catch (e) {
        const r2 = await llm.ask(cfg, text, c, S.chat, e.message);
        ops = r2.ops;
        reply = r2.reply;
      }
      engine = 'llm';
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('LLM 요청을 중단했습니다');
      if (mode === 'llm') throw new Error(`LLM 호출 실패: ${e.message}`);
      note = `LLM에 연결하지 못해 규칙 기반 해석 결과를 사용했습니다 (${String(e.message).slice(0, 120)})`;
    }
  } else if (mode === 'rule_first') note = ruleOk ? '규칙으로 바로 처리했습니다' : '';
  let error = null, log = [], action = null;
  if (engine === 'rule' && rr.info.undo) {
    if (S.undo.length) {
      const u = S.undo.pop();
      S.spec = u.spec;
      S.geo = u.geo;
      reply = '직전 상태로 되돌렸습니다.';
    } else reply = '되돌릴 내용이 없습니다.';
    ops = [];
  } else if (ops.length) {
    try {
      log = apply(ops);
    } catch (e) {
      error = e.message;
    }
  }
  if (engine === 'rule' && rr.info.run && !error && !rr.info.ask && !rr.info.unknown) action = 'solve';
  if (rr.info.view && engine === 'rule') action = action || 'view';
  S.chat.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify({ ops, reply }) });
  S.chat.splice(0, Math.max(0, S.chat.length - 12));
  return { ...state(), chat: { reply, ops, engine, model: engine === 'llm' ? cfg.model : null, note, error, log, action, view: rr.info.view || null } };
}
