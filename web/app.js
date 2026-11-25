import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { api as backendApi } from './backend.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const fmt = (v) => {
  if (v === null || v === undefined) return '-';
  if (typeof v !== 'number') return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  return a >= 1e5 || a < 1e-3 ? v.toExponential(3) : String(+v.toPrecision(5));
};

let st = null;
let highlightId = null;
let picked = null;
const R = { mesh: null, frames: new Map(), index: 0, field: 'U', scale: 1, playing: null, auto: true };

async function api(path, opts = {}) {
  return backendApi(path, opts);
}

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e7);
camera.up.set(0, 0, 1);
camera.position.set(300, -400, 250);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3442, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 1.9);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbcd4ff, 0.7);
scene.add(fill);
const surfaceMat = (extra) => new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.08, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...extra });
const G = { model: new THREE.Group(), edges: new THREE.Group(), symbols: new THREE.Group(), result: new THREE.Group(), pick: new THREE.Group(), rigid: new THREE.Group(), crease: new THREE.Group(), mirror: new THREE.Group(), arrows: new THREE.Group() };
Object.values(G).forEach((g) => scene.add(g));
G.crease.renderOrder = 2;
let diag = 100;
let center = new THREE.Vector3();

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);

function clear(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

function drawGizmo() {
  const c = $('gizmo');
  const x = c.getContext('2d');
  x.clearRect(0, 0, 96, 96);
  const q = camera.quaternion.clone().invert();
  const axes = [
    ['X', new THREE.Vector3(1, 0, 0), '#ff5c5c'],
    ['Y', new THREE.Vector3(0, 1, 0), '#57d9a3'],
    ['Z', new THREE.Vector3(0, 0, 1), '#4cc2ff'],
  ].map(([n, v, col]) => [n, v.applyQuaternion(q), col]);
  axes.sort((a, b) => a[1].z - b[1].z);
  x.font = '11px sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (const [n, v, col] of axes) {
    const px = 48 + v.x * 30;
    const py = 48 - v.y * 30;
    x.strokeStyle = col;
    x.fillStyle = col;
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(48, 48);
    x.lineTo(px, py);
    x.stroke();
    x.fillText(n, 48 + v.x * 40, 48 - v.y * 40);
  }
}

function loop() {
  controls.update();
  const cr = new THREE.Vector3().crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
  sun.position.copy(camera.position).addScaledVector(cr, -0.45 * camera.position.distanceTo(controls.target)).addScaledVector(camera.up, 0.5 * camera.position.distanceTo(controls.target));
  sun.target.position.copy(controls.target);
  sun.target.updateMatrixWorld();
  fill.position.copy(camera.position).addScaledVector(cr, 0.9 * camera.position.distanceTo(controls.target));
  fill.target.position.copy(controls.target);
  fill.target.updateMatrixWorld();
  renderer.render(scene, camera);
  drawGizmo();
  requestAnimationFrame(loop);
}

function fit() {
  if (!st || !st.view) return;
  const b = new THREE.Box3();
  for (const p of st.view.nodes) b.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
  center = b.getCenter(new THREE.Vector3());
  diag = Math.max(b.getSize(new THREE.Vector3()).length(), 1e-6);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0.9, -1.2, 0.75).multiplyScalar(diag));
  camera.near = diag / 500;
  camera.far = diag * 100;
  camera.updateProjectionMatrix();
}

function triangulate(faces) {
  const t = [];
  for (const f of faces) {
    t.push(f[0], f[1], f[2]);
    if (f.length === 4) t.push(f[0], f[2], f[3]);
  }
  return t;
}

function buildModel() {
  clear(G.model);
  clear(G.edges);
  if (!st || !st.view) return;
  const v = st.view;
  const pos = new Float32Array(v.nodes.flat());
  const tris = triangulate(v.shells).concat(v.boundary.flat());
  if (tris.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(tris);
    const flat = g.toNonIndexed();
    flat.computeVertexNormals();
    g.dispose();
    const m = surfaceMat({ color: 0x9fb3c8 });
    G.model.add(new THREE.Mesh(flat, m));
  }
  const seen = new Set();
  const ed = [];
  const add = (a, b) => {
    const k = a < b ? a * 1e7 + b : b * 1e7 + a;
    if (seen.has(k)) return;
    seen.add(k);
    ed.push(a, b);
  };
  for (const f of v.shells) for (let i = 0; i < f.length; i++) add(f[i], f[(i + 1) % f.length]);
  for (const f of v.boundary) for (let i = 0; i < 3; i++) add(f[i], f[(i + 1) % 3]);
  if (ed.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(ed);
    G.edges.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2c3948 })));
  }
  if (v.beams.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(v.beams.flat());
    G.model.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe8eef6 })));
    const pg = new THREE.BufferGeometry();
    const used = [...new Set(v.beams.flat())];
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(used.flatMap((i) => v.nodes[i])), 3));
    G.model.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xe8eef6, size: 4, sizeAttenuation: false })));
  }
  buildMirror();
  const h = Object.values(v.hinges).flat();
  if (h.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(h.flat());
    G.model.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff5fa8, depthTest: false })));
  }
}

function sample(n, max) {
  if (n <= max) return [...Array(n).keys()];
  const out = [];
  for (let i = 0; i < max; i++) out.push(Math.floor((i * n) / max));
  return out;
}

function placeRigid(t) {
  for (const o of G.rigid.children) {
    const b = o.userData.base;
    const m = o.userData.motion;
    if (b) o.position.set(b[0] + t * m[0], b[1] + t * m[1], b[2] + t * m[2]);
  }
}

function buildRigid() {
  clear(G.rigid);
  if (!st || !st.preview || !st.preview.contacts) return;
  for (const c of st.preview.contacts) {
    if (c.type !== 'rigid') continue;
    const hot = c.id === highlightId;
    const mat = new THREE.MeshBasicMaterial({ color: hot ? 0xffc857 : 0x9aa7b8, wireframe: true, transparent: true, opacity: 0.55 });
    let o;
    if (c.shape === 'mesh') {
      const rm = R.mesh && (R.mesh.rigid || []).find((q) => q.id === c.id && q.V);
      if (!rm) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rm.V.flat()), 3));
      g.setIndex(rm.F.flat());
      o = new THREE.Mesh(g, mat);
      o.userData.base = [0, 0, 0];
      o.userData.resultOnly = true;
    } else if (c.shape === 'sphere') {
      o = new THREE.Mesh(new THREE.SphereGeometry(c.radius, 28, 18), mat);
      o.userData.base = c.center;
    } else {
      o = new THREE.Mesh(new THREE.PlaneGeometry(2 * c.size, 2 * c.size, 12, 12), mat);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...c.normal).normalize());
      const cen = [0, 1, 2].map((k) => (st.view.nodes.reduce((a, p) => Math.min(a, p[k]), Infinity) + st.view.nodes.reduce((a, p) => Math.max(a, p[k]), -Infinity)) / 2);
      const n = new THREE.Vector3(...c.normal).normalize();
      const d = new THREE.Vector3(c.point[0] - cen[0], c.point[1] - cen[1], c.point[2] - cen[2]).dot(n);
      o.userData.base = [cen[0] + d * n.x, cen[1] + d * n.y, cen[2] + d * n.z];
    }
    o.userData.motion = c.motion;
    G.rigid.add(o);
    const mv = new THREE.Vector3(...c.motion);
    if (mv.length() > 0) {
      const len = Math.max(mv.length(), diag * 0.08);
      const a = new THREE.ArrowHelper(mv.clone().normalize(), new THREE.Vector3(0, 0, 0), len, 0x6ee7b7, diag * 0.03, diag * 0.015);
      a.userData.base = c.shape === 'mesh' ? [0, 1, 2].map((k) => o.geometry.attributes.position.array.filter((_, i) => i % 3 === k).reduce((s, v, _, arr) => s + v / arr.length, 0)) : o.userData.base;
      a.userData.motion = c.motion;
      a.userData.resultOnly = o.userData.resultOnly;
      G.rigid.add(a);
    }
  }
  placeRigid(0);
}

function supportDir(ids) {
  const v = st.view;
  if (!v._lo) {
    v._lo = [0, 1, 2].map((k) => v.nodes.reduce((a, p) => Math.min(a, p[k]), Infinity));
    v._hi = [0, 1, 2].map((k) => v.nodes.reduce((a, p) => Math.max(a, p[k]), -Infinity));
  }
  let best = 2;
  let bs = Infinity;
  let side = -1;
  for (const k of [2, 1, 0]) {
    const size = v._hi[k] - v._lo[k];
    if (size <= 1e-9 * (diag || 1)) {
      const sc = (2 - k) * 0.01;
      if (sc < bs) {
        bs = sc;
        best = k;
        side = -1;
      }
      continue;
    }
    let lo = Infinity;
    let hi = -Infinity;
    let m = 0;
    for (const i of ids) {
      const c = v.nodes[i][k];
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
      m += c / ids.length;
    }
    const e = Math.min(m - v._lo[k], v._hi[k] - m) / size;
    const sc = (hi - lo) / size + e + (2 - k) * 0.01;
    if (sc < bs) {
      bs = sc;
      best = k;
      side = m - v._lo[k] <= v._hi[k] - m ? -1 : 1;
    }
  }
  const u = new THREE.Vector3();
  u.setComponent(best, side);
  return u;
}

function symMesh(geo, col, pos, up) {
  const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthTest: false });
  const o = new THREE.Mesh(geo, mat);
  o.position.copy(pos);
  if (up) o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x0e1116, transparent: true, opacity: 0.9, depthTest: false }));
  o.add(e);
  G.symbols.add(o);
}

function supportSymbol(kind, p, u, s, col) {
  const up = u.clone().negate();
  const h = s * 1.1;
  if (kind === 'fixed') {
    symMesh(new THREE.BoxGeometry(s * 1.6, s * 0.45, s * 1.6), col, p.clone().addScaledVector(u, s * 0.225), up);
    return;
  }
  const small = kind === 'roller' ? 0.8 : 1;
  symMesh(new THREE.ConeGeometry(s * 0.65 * small, h * small, 4), col, p.clone().addScaledVector(u, (h * small) / 2), up);
  let base = h * small;
  if (kind === 'roller') {
    const t = Math.abs(u.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    for (const sg of [-1, 1]) symMesh(new THREE.SphereGeometry(s * 0.18, 10, 8), col, p.clone().addScaledVector(u, base + s * 0.18).addScaledVector(t, sg * s * 0.35));
    base += s * 0.36;
  }
  symMesh(new THREE.BoxGeometry(s * 1.5, s * 0.08, s * 1.5), col, p.clone().addScaledVector(u, base + s * 0.04), up);
}

function supportKind(bc) {
  if (bc.value !== 0) return null;
  const T = bc.dofs.filter((d) => d <= 3);
  const R = bc.dofs.filter((d) => d > 3);
  if (T.length === 3 && R.length === 3) return 'fixed';
  if (T.length === 3 && !R.length) return 'pin';
  if (T.length === 1 && !R.length) return 'roller';
  return null;
}

function momentSymbol(p, axis, r, col) {
  const a = axis.clone().normalize();
  const t1 = Math.abs(a.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(a).normalize() : new THREE.Vector3(1, 0, 0).cross(a).normalize();
  const t2 = a.clone().cross(t1);
  const pts = [];
  const N = 28;
  const span = 1.5 * Math.PI;
  for (let i = 0; i <= N; i++) {
    const th = (span * i) / N;
    pts.push(p.clone().addScaledVector(t1, r * Math.cos(th)).addScaledVector(t2, r * Math.sin(th)));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  G.symbols.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, depthTest: false })));
  const tip = pts[N];
  const tan = t1.clone().multiplyScalar(-Math.sin(span)).addScaledVector(t2, Math.cos(span)).normalize();
  const hl = r * 0.45;
  const head = new THREE.Mesh(new THREE.ConeGeometry(r * 0.2, hl, 10), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
  head.position.copy(tip).addScaledVector(tan, hl / 2);
  G.symbols.add(head);
  const ax = new THREE.BufferGeometry().setFromPoints([p.clone().addScaledVector(a, -r * 0.6), p.clone().addScaledVector(a, r * 0.9)]);
  G.symbols.add(new THREE.Line(ax, new THREE.LineDashedMaterial({ color: col, depthTest: false, dashSize: r * 0.12, gapSize: r * 0.08 })).computeLineDistances());
}

function buildSymbols() {
  clear(G.symbols);
  buildRigid();
  if (!st || !st.view || !st.preview) return;
  const nodes = st.view.nodes;
  const s = diag * 0.035;
  for (const c of st.preview.contacts || []) {
    if (c.type !== 'pair' || !c.a) continue;
    for (const [ids, col] of [[c.a, 0x6ee7b7], [c.b, 0xf0a35e]]) {
      const pg = new THREE.BufferGeometry();
      const arr = [];
      for (const k of sample(ids.length, 1500)) arr.push(...nodes[ids[k]]);
      pg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      G.symbols.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: c.id === highlightId ? 0xffc857 : col, size: 4, sizeAttenuation: false, depthTest: false })));
    }
  }
  for (const c of st.preview.couplings || []) {
    const hot = c.id === highlightId;
    const col = hot ? 0xffc857 : 0xc084fc;
    const r = new THREE.Vector3(...c.ref);
    const seg = [];
    for (const k of sample(c.nodes.length, 120)) seg.push(r.x, r.y, r.z, ...nodes[c.nodes[k]]);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    G.symbols.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthTest: false })));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(s * 0.35, 16, 12), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
    ball.position.copy(r);
    G.symbols.add(ball);
  }
  for (const r of st.preview.releases || []) {
    const col = r.id === highlightId ? 0xffc857 : 0xffffff;
    for (const p of r.points) {
      const ring = new THREE.Mesh(new THREE.SphereGeometry(s * 0.22, 14, 10), new THREE.MeshBasicMaterial({ color: col, wireframe: true, depthTest: false }));
      ring.position.set(...p);
      G.symbols.add(ring);
    }
  }
  const AX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  for (const bc of st.preview.bcs) {
    const hot = bc.id === highlightId;
    const seg = [];
    const rot = [];
    const kind = supportKind(bc);
    if (kind && bc.nodes.length) {
      const colk = hot ? 0xffc857 : 0x4cc2ff;
      const T = bc.dofs.filter((d) => d <= 3);
      let u = supportDir(bc.nodes);
      if (kind === 'roller') {
        const ax = AX[T[0] - 1];
        const sg = u.dot(ax) > 0 ? 1 : -1;
        u = ax.clone().multiplyScalar(sg);
      }
      const vt = viewTopo();
      if (vt._hl === undefined) {
        const E = vt._edges;
        let L = 0;
        for (const k of sample(E.length, 2000)) L += Math.hypot(...[0, 1, 2].map((c) => vt.nodes[E[k][1]][c] - vt.nodes[E[k][0]][c]));
        vt._hl = E.length ? L / Math.min(E.length, 2000) : s;
      }
      const ss = bc.nodes.length > 1 ? Math.min(s, 0.45 * vt._hl) : s;
      for (const k of sample(bc.nodes.length, 80)) supportSymbol(kind, new THREE.Vector3(...nodes[bc.nodes[k]]), u, ss, colk);
    }
    for (const k of kind ? [] : sample(bc.nodes.length, 600)) {
      const p = nodes[bc.nodes[k]];
      for (const d of bc.dofs) {
        if (d <= 3) {
          const a = AX[d - 1];
          seg.push(p[0] - a.x * s, p[1] - a.y * s, p[2] - a.z * s, p[0] + a.x * s, p[1] + a.y * s, p[2] + a.z * s);
        }
      }
      if (bc.dofs.some((d) => d > 3)) rot.push(p[0], p[1], p[2]);
    }
    const col = hot ? 0xffc857 : bc.value !== 0 ? 0x57d9a3 : 0x4cc2ff;
    if (seg.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3));
      G.symbols.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, depthTest: false })));
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sample(bc.nodes.length, 3000).flatMap((k) => nodes[bc.nodes[k]])), 3));
    const bp = new THREE.Points(pg, new THREE.PointsMaterial({ color: col, size: rot.length ? 9 : 6, sizeAttenuation: false, depthTest: false }));
    bp.userData.followPts = sample(bc.nodes.length, 3000).map((k) => bc.nodes[k]);
    G.symbols.add(bp);
    if (bc.value !== 0) {
      const d = bc.dofs.find((x) => x <= 3);
      if (d) {
        const dir = AX[d - 1].clone().multiplyScalar(Math.sign(bc.value));
        for (const k of sample(bc.nodes.length, 40)) {
          const p = new THREE.Vector3(...nodes[bc.nodes[k]]);
          const a = new THREE.ArrowHelper(dir, p.clone().sub(dir.clone().multiplyScalar(s * 3)), s * 3, col, s, s * 0.5);
          a.userData.follow = { node: bc.nodes[k], back: s * 3, dir };
          G.symbols.add(a);
        }
      }
    }
  }
  for (const sy of st.preview.symmetry || []) {
    const hot = sy.id === highlightId;
    const col = hot ? 0xffc857 : 0xc084fc;
    const seg = [];
    for (const [a, b] of sy.edges) seg.push(...nodes[a], ...nodes[b]);
    if (seg.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3));
      G.symbols.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, depthTest: false, linewidth: 2 })));
    }
    const ax = 'xyz'.indexOf(sy.axis);
    const v = st.view;
    const lo = [0, 1, 2].map((k) => Math.min(...v.nodes.map((p) => p[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...v.nodes.map((p) => p[k])));
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    const ext = [0, 1, 2].map((k) => Math.max(hi[k] - lo[k], 0.2 * diag));
    const others = [0, 1, 2].filter((k) => k !== ax);
    const ctr = [0, 1, 2].map((k) => (k === ax ? sy.at : (lo[k] + hi[k]) / 2));
    pl.position.set(...ctr);
    const n = new THREE.Vector3();
    n.setComponent(ax, 1);
    pl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const sc = new THREE.Vector3(1, 1, 1);
    const tmp = [ext[others[0]] * 1.15, ext[others[1]] * 1.15];
    if (ax === 0) pl.scale.set(tmp[1], tmp[0], 1);
    else if (ax === 1) pl.scale.set(tmp[0], tmp[1], 1);
    else pl.scale.set(tmp[0], tmp[1], 1);
    G.symbols.add(pl);
  }
  for (const ld of st.preview.loads.filter((l) => l.type === 'pressure')) {
    const hot = ld.id === highlightId;
    const col = hot ? 0xffc857 : ld.mode === 'local' ? 0xff8a5c : 0xff5c5c;
    for (const k of sample(ld.centers.length, 400)) {
      const len = Math.max(s * 1.6, Math.sqrt(ld.areas[k]) * 0.45);
      const dir = new THREE.Vector3(...ld.dirs[k]).normalize();
      const p = new THREE.Vector3(...ld.centers[k]);
      const a = new THREE.ArrowHelper(dir, p.clone().sub(dir.clone().multiplyScalar(len)), len, col, len * 0.35, len * 0.2);
      a.traverse((o) => o.material && (o.material.depthTest = false));
      G.symbols.add(a);
    }
  }
  for (const ld of st.preview.loads.filter((l) => l.type !== 'pressure')) {
    const hot = ld.id === highlightId;
    const col = hot ? 0xffc857 : ld.type === 'moment' ? 0xc792ea : 0xff5c5c;
    if (ld.type === 'gravity') {
      const dir = new THREE.Vector3(...ld.total);
      if (dir.length() > 0) G.symbols.add(new THREE.ArrowHelper(dir.normalize(), center.clone().sub(dir.clone().multiplyScalar(s * 6)), s * 6, col, s * 1.5, s * 0.8));
      continue;
    }
    let vmax = 0;
    for (const v of ld.vectors) vmax = Math.max(vmax, Math.hypot(v[0], v[1], v[2]));
    if (vmax === 0) continue;
    if (ld.type === 'moment') {
      const tot = new THREE.Vector3(...ld.total);
      const axis = tot.length() > 0 ? tot : new THREE.Vector3(...ld.vectors[0]);
      for (const k of sample(ld.nodes.length, 30)) momentSymbol(new THREE.Vector3(...nodes[ld.nodes[k]]), axis, s * (ld.nodes.length > 1 ? 0.9 : 1.4), col);
      continue;
    }
    const one = ld.nodes.length === 1;
    const tails = new Map();
    const inLd = new Set(ld.nodes);
    for (const k of sample(ld.nodes.length, 300)) {
      const v = new THREE.Vector3(...ld.vectors[k]);
      const mag = v.length();
      if (mag === 0) continue;
      const len = one ? s * 5 : s * 3;
      const p = new THREE.Vector3(...nodes[ld.nodes[k]]);
      const dir = v.normalize();
      tails.set(ld.nodes[k], p.clone().sub(dir.clone().multiplyScalar(len)));
      const a = new THREE.ArrowHelper(dir, p.clone().sub(dir.clone().multiplyScalar(len)), len, col, s * 0.9, s * 0.45);
      a.traverse((o) => {
        if (o.material) o.material.depthTest = false;
      });
      a.userData.follow = { node: ld.nodes[k], back: len, dir };
      G.symbols.add(a);
    }
    if (!one && tails.size > 1) {
      const seg = [];
      const ends = [];
      for (const [a, b] of viewTopo()._edges) {
        if (!inLd.has(a) || !inLd.has(b) || !tails.has(a) || !tails.has(b)) continue;
        seg.push(...tails.get(a).toArray(), ...tails.get(b).toArray());
        ends.push(a, b);
        if (seg.length > 12000) break;
      }
      if (seg.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3));
        const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, depthTest: false }));
        ls.userData.followSeg = ends.map((n, q) => ({ node: n, off: new THREE.Vector3(...seg.slice(3 * q, 3 * q + 3)).sub(new THREE.Vector3(...nodes[n])) }));
        G.symbols.add(ls);
      }
    }
  }
  drawHighlight();
  followSymbols();
}

function followSymbols() {
  if (!st || !st.view) return;
  const res = !!R.mesh && !!R.pos && $('showResult').checked;
  const nIn = res ? R.mesh.nInput : 0;
  const P = (i) => (res && i < nIn ? new THREE.Vector3(R.pos[3 * i], R.pos[3 * i + 1], R.pos[3 * i + 2]) : new THREE.Vector3(...st.view.nodes[i]));
  for (const c of G.symbols.children) {
    const u = c.userData;
    if (u.follow) c.position.copy(P(u.follow.node).sub(u.follow.dir.clone().multiplyScalar(u.follow.back)));
    else if (u.followSeg) {
      const at = c.geometry.attributes.position;
      u.followSeg.forEach((e, q) => at.setXYZ(q, ...P(e.node).add(e.off).toArray()));
      at.needsUpdate = true;
      c.geometry.computeBoundingSphere();
    } else if (u.followPts) {
      const at = c.geometry.attributes.position;
      u.followPts.forEach((n, q) => at.setXYZ(q, ...P(n).toArray()));
      at.needsUpdate = true;
      c.geometry.computeBoundingSphere();
    }
  }
}

const RAMP = [
  [0.17, 0.29, 1.0],
  [0.1, 0.76, 0.49],
  [1.0, 0.88, 0.29],
  [1.0, 0.23, 0.19],
];
function ramp(t, out, o) {
  const x = Math.min(Math.max(t, 0), 1) * 3;
  const i = Math.min(Math.floor(x), 2);
  const f = x - i;
  for (let k = 0; k < 3; k++) out[o + k] = RAMP[i][k] + (RAMP[i + 1][k] - RAMP[i][k]) * f;
}

async function loadResult() {
  clear(G.result);
  R.mesh = null;
  R.frames.clear();
  stopPlay();
  if (!st || !st.result) {
    $('resultbar').hidden = true;
    $('legend').hidden = true;
    applyVisibility();
    return;
  }
  R.mesh = await api('/api/result/mesh');
  const n = R.mesh.nodes.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const thick = R.mesh.thick && R.mesh.tris.length ? R.mesh.thick : null;
  R.thick = thick;
  R.mid = null;
  R.pos2 = null;
  if (R.mesh.tris.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(R.mesh.tris.flat());
    const thin = new THREE.Mesh(g, surfaceMat({ vertexColors: true }));
    thin.userData.thin = true;
    G.result.add(thin);
    if (thick) {
      R.mid = g;
      R.pos2 = new Float32Array(n * 6);
      R.col2 = new Float32Array(n * 6);
      const idx = [];
      const cnt = new Map();
      for (const t of R.mesh.tris) {
        idx.push(t[0], t[1], t[2], t[0] + n, t[2] + n, t[1] + n);
        for (let k = 0; k < 3; k++) {
          const a = t[k];
          const b = t[(k + 1) % 3];
          const key = a < b ? a * 1e7 + b : b * 1e7 + a;
          const c = cnt.get(key);
          if (c) c.n += 1;
          else cnt.set(key, { n: 1, a, b });
        }
      }
      for (const c of cnt.values()) if (c.n === 1) idx.push(c.a, c.a + n, c.b, c.b, c.a + n, c.b + n);
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.BufferAttribute(R.pos2, 3));
      g2.setAttribute('color', new THREE.BufferAttribute(R.col2, 3));
      g2.setIndex(idx);
      const solid = new THREE.Mesh(g2, surfaceMat({ vertexColors: true }));
      solid.userData.thick = true;
      G.result.add(solid);
    }
  }
  if (R.mesh.lines.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(R.mesh.lines.flat());
    const dark = R.mesh.tris.length > 0;
    G.result.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial(dark ? { color: 0x10151c } : { vertexColors: true })));
  }
  if (R.mesh.fedges && R.mesh.fedges.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(R.mesh.fedges.flat());
    const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.55 }));
    ls.userData.meshLines = true;
    ls.userData.thin = true;
    G.result.add(ls);
    if (thick) {
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.BufferAttribute(R.pos2, 3));
      const e2 = [];
      for (const e of R.mesh.fedges) e2.push(e[0], e[1], e[0] + n, e[1] + n);
      g2.setIndex(e2);
      const l2 = new THREE.LineSegments(g2, new THREE.LineBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.5 }));
      l2.userData.meshLines = true;
      l2.userData.thick = true;
      G.result.add(l2);
    }
  }
  R.pos = pos;
  R.col = col;
  buildResultMirror();
  const frames = st.result.frames;
  $('frame').max = frames.length - 1;
  const kind = st.result.kind;
  R.index = kind === 'static' ? frames.length - 1 : 0;
  $('frame').value = R.index;
  const fsel = $('field');
  fsel.innerHTML = '';
  for (const f of st.result.fields) fsel.append(new Option(FIELD_LABEL[f] || f, f));
  const pref = (kind === 'static' ? ['energyDensity'] : ['U']).find((q) => st.result.fields.includes(q));
  R.field = pref || 'U';
  fsel.value = R.field;
  R.auto = true;
  $('resultbar').hidden = false;
  $('showResult').checked = true;
  buildRigid();
  await showFrame();
  applyVisibility();
}

async function getFrame(i, field) {
  const k = `${i}|${field}`;
  if (!R.frames.has(k)) R.frames.set(k, await api(`/api/result/frame?i=${i}&field=${encodeURIComponent(field)}`));
  return R.frames.get(k);
}

async function showFrame() {
  if (!R.mesh) return;
  const f = await getFrame(R.index, R.field);
  if (R.auto) {
    let umax = 0;
    for (const u of f.U) umax = Math.max(umax, Math.hypot(u[0], u[1], u[2]));
    const nl = st.result.kind === 'static';
    R.scale = nl || umax === 0 ? 1 : +((0.15 * diag) / umax).toPrecision(2);
    if (st.result.kind === 'kinematic') R.scale = 1;
    if (R.viewScale) {
      R.scale = R.viewScale;
      R.viewScale = null;
    }
    $('scale').value = R.scale;
    R.auto = false;
  }
  const n = R.mesh.nodes.length;
  const lo = f.min;
  const span = f.max - f.min || 1;
  for (let i = 0; i < n; i++) {
    const p = R.mesh.nodes[i];
    const u = f.U[i];
    R.pos[3 * i] = p[0] + R.scale * u[0];
    R.pos[3 * i + 1] = p[1] + R.scale * u[1];
    R.pos[3 * i + 2] = p[2] + R.scale * u[2];
    ramp((f.values[i] - lo) / span, R.col, 3 * i);
  }
  if (R.mid && R.pos2) {
    R.mid.computeVertexNormals();
    const nr = R.mid.attributes.normal.array;
    for (let i = 0; i < n; i++) {
      const h = 0.5 * R.thick[i];
      for (let k = 0; k < 3; k++) {
        const c = 3 * i + k;
        R.pos2[c] = R.pos[c] + h * nr[c];
        R.pos2[3 * n + c] = R.pos[c] - h * nr[c];
        R.col2[c] = R.col[c];
        R.col2[3 * n + c] = R.col[c];
      }
    }
  }
  for (const o of G.result.children) {
    o.geometry.attributes.position.needsUpdate = true;
    if (o.geometry.attributes.color) o.geometry.attributes.color.needsUpdate = true;
    if (o.isMesh) o.geometry.computeVertexNormals();
    o.geometry.computeBoundingSphere();
  }
  updateResultMirror();
  drawPressureArrows();
  followSymbols();
  $('frameLabel').textContent = `${R.index + 1}/${st.result.frames.length} · ${f.label}`;
  $('legend').hidden = !$('showResult').checked;
  $('legendTitle').textContent = (FIELD_LABEL[R.field] || R.field) + (R.field.endsWith('Density') ? ' · 전 스텝 최대 기준' : '');
  const ticks = $('legendTicks');
  ticks.innerHTML = '';
  for (let k = 4; k >= 0; k--) ticks.append(el('span', '', fmt(lo + (span * k) / 4)));
}

function snapshot(maxW) {
  const sv = G.symbols.visible;
  G.symbols.visible = false;
  renderer.render(scene, camera);
  G.symbols.visible = sv;
  const k = Math.min(1, maxW / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  const x = c.getContext('2d');
  x.fillStyle = getComputedStyle(document.body).backgroundColor || '#0f141b';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

async function saveVideo() {
  if (!R.mesh) return;
  if (!window.MediaRecorder || !canvas.captureStream) return note('이 브라우저는 영상 저장을 지원하지 않습니다. GIF 를 쓰세요', true);
  stopPlay();
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return note('지원되는 영상 형식이 없습니다. GIF 를 쓰세요', true);
  const keep = R.index;
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => (rec.onstop = res));
  const sv = G.symbols.visible;
  G.symbols.visible = false;
  rec.start();
  for (let i = 0; i < st.result.frames.length; i++) {
    R.index = i;
    $('frame').value = i;
    await showFrame();
    await new Promise((res) => setTimeout(res, 120));
  }
  await new Promise((res) => setTimeout(res, 500));
  rec.stop();
  await done;
  G.symbols.visible = sv;
  download(URL.createObjectURL(new Blob(chunks, { type: mime })), mime.startsWith('video/mp4') ? 'bah-llm-web.mp4' : 'bah-llm-web.webm');
  R.index = keep;
  $('frame').value = keep;
  showFrame();
}

function stopPlay() {
  if (R.playing) clearInterval(R.playing);
  R.playing = null;
  $('play').textContent = '▶';
}

function applyVisibility() {
  const res = !!R.mesh && $('showResult').checked;
  G.result.visible = res;
  G.model.visible = !res;
  G.edges.visible = $('showEdges').checked && !res;
  G.symbols.visible = $('showSymbols').checked;
  G.rigid.visible = $('showSymbols').checked;
  for (const o of G.rigid.children) if (o.userData.resultOnly) o.visible = res;
  if (!res) placeRigid(0);
  $('legend').hidden = !res;
  $('resultbar').hidden = !R.mesh;
  const ml = $('showMeshLines').checked;
  const tk = false;
  G.result.children.forEach((c) => {
    c.visible = true;
    if (c.userData.thick) c.visible = tk;
    if (c.userData.thin) c.visible = !tk;
    if (c.userData.meshLines) c.visible = c.visible && ml;
  });
  $('meshLinesWrap').hidden = !R.mesh;
  G.crease.visible = !!st && !!st.spec && (!res || BH.edit);
  const hasSym = !!st && !!st.spec && (st.spec.symmetry || []).length > 0;
  $('mirrorWrap').hidden = !hasSym;
  G.mirror.visible = hasSym && $('showMirror').checked && !res;
  G.arrows.visible = res && $('showSymbols').checked;
  followSymbols();
  for (const c of G.result.children) if (c.userData.mirror) c.visible = hasSym && $('showMirror').checked && (!c.userData.meshLines || ml);
}

function describeBC(b) {
  const names = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
  return b.dofs.map((d) => names[d - 1]).join(' ');
}

function ops(list, quiet) {
  return api('/api/ops', { json: { ops: list } })
    .then((s) => refresh(s, { keepResult: true }))
    .catch((e) => {
      if (!quiet) note(e.message, true);
      refresh(st, { keepResult: true });
    });
}

function note(msg, err) {
  const m = $('solveMsg');
  m.textContent = msg || '';
  m.style.color = err ? 'var(--err)' : '';
}

function renderLists() {
  const pv = st.preview;
  const bl = $('bcList');
  bl.innerHTML = '';
  $('bcCount').textContent = st.spec.bcs.length ? `${st.spec.bcs.length}개` : '';
  if (!st.spec.bcs.length) bl.append(el('div', 'empty', '없음. 오른쪽에서 문장으로 지시하세요'));
  for (const b of st.spec.bcs) {
    const p = pv.bcs.find((x) => x.id === b.id);
    const it = el('div', 'item' + (highlightId === b.id ? ' sel' : ''));
    const top = el('div', 'top');
    const nm = el('span');
    nm.append(el('span', 'id', b.id), document.createTextNode(b.name || '구속'));
    const x = el('button', 'x', '✕');
    x.onclick = (e) => {
      e.stopPropagation();
      ops([{ op: 'remove', id: b.id }]);
    };
    top.append(nm, x);
    const bh = st.spec.solver === 'bh' ? st.spec.bh || {} : {};
    const cyc = b.value && bh.cycles > 0 ? ` · 반복 ${bh.cycles}회 (0 → ${b.value} → ${bh.cycle_back ? (b.value > 0 ? '-' : '+') + bh.cycle_back : '0'} → 0)` : '';
    it.append(top, el('div', 'desc', `${p ? p.desc : '?'} · ${describeBC(b)} · 절점 ${p ? p.nodes.length : 0}개${cyc}`));
    const ed = el('div', 'edit');
    const inp = el('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.value = b.value;
    inp.title = '지정 변위 (mm), 0이면 고정';
    inp.onclick = (e) => e.stopPropagation();
    inp.onchange = () => ops([{ op: 'update', id: b.id, value: +inp.value || 0 }]);
    ed.append(inp);
    it.append(ed);
    it.onclick = () => {
      highlightId = highlightId === b.id ? null : b.id;
      renderLists();
      buildSymbols();
    };
    bl.append(it);
  }
  const ll = $('ldList');
  ll.innerHTML = '';
  $('ldCount').textContent = st.spec.loads.length ? `${st.spec.loads.length}개` : '';
  if (!st.spec.loads.length) ll.append(el('div', 'empty', '없음'));
  const tn = { force: '힘 (N)', pressure: '압력 (MPa)', gravity: '자중 (mm/s²)' };
  for (const l of st.spec.loads) {
    const p = pv.loads.find((x) => x.id === l.id);
    const it = el('div', 'item' + (highlightId === l.id ? ' sel' : ''));
    const top = el('div', 'top');
    const nm = el('span');
    nm.append(el('span', 'id', l.id), document.createTextNode(`${l.name && l.name !== l.type ? l.name + ' · ' : ''}${tn[l.type]}`));
    const x = el('button', 'x', '✕');
    x.onclick = (e) => {
      e.stopPropagation();
      ops([{ op: 'remove', id: l.id }]);
    };
    top.append(nm, x);
    it.append(top, el('div', 'desc', `${p ? p.desc : '?'}${p && p.total ? ' · 합 [' + p.total.map(fmt).join(', ') + ']' : ''}${p && p.nodes.length ? ' · 절점 ' + p.nodes.length + '개' : ''}`));
    const ed = el('div', 'edit');
    if (l.type === 'pressure') {
      const mb = el('button', 'mini', l.mode === 'local' ? 'Local (법선)' : 'Global (고정 방향)');
      mb.title = 'Local: 변형을 따라 면 법선 방향 / Global: 중력처럼 고정 방향, 처음 면적 기준';
      mb.onclick = (e) => {
        e.stopPropagation();
        ops([{ op: 'update', id: l.id, mode: l.mode === 'local' ? 'global' : 'local', ...(l.mode === 'local' && !l.direction ? { direction: [0, 0, -1] } : {}) }]);
      };
      ed.append(mb);
      if (l.mode === 'local') {
        const fb = el('button', 'mini', '방향 뒤집기');
        fb.title = '이 하중의 모든 면 방향을 뒤집기 (면을 고른 상태면 고른 면만)';
        fb.onclick = (e) => {
          e.stopPropagation();
          const pf = (pv.loads.find((x) => x.id === l.id) || {}).faces || [];
          const cur = new Set(l.flip || []);
          for (const f of pf) cur.has(f) ? cur.delete(f) : cur.add(f);
          ops([{ op: 'update', id: l.id, flip: [...cur] }]);
        };
        ed.append(fb);
      }
    }
    if (l.vector) {
      const ins = l.vector.map((v) => {
        const i = el('input');
        i.type = 'number';
        i.step = 'any';
        i.value = v;
        i.onclick = (e) => e.stopPropagation();
        return i;
      });
      ins.forEach((i) => (i.onchange = () => ops([{ op: 'update', id: l.id, vector: ins.map((q) => +q.value || 0) }])));
      ed.append(...ins);
    } else {
      const i = el('input');
      i.type = 'number';
      i.step = 'any';
      i.value = l.value;
      i.onclick = (e) => e.stopPropagation();
      i.onchange = () => ops([{ op: 'update', id: l.id, value: +i.value || 0 }]);
      ed.append(i);
    }
    it.append(ed);
    it.onclick = () => {
      highlightId = highlightId === l.id ? null : l.id;
      renderLists();
      buildSymbols();
    };
    ll.append(it);
  }
  const sl = $('syList');
  sl.innerHTML = '';
  const sys = st.spec.symmetry || [];
  $('syCount').textContent = sys.length ? `${sys.length}개` : '';
  if (!sys.length) sl.append(el('div', 'empty', '없음 · 예: "x = 0 대칭", "x 최대 면 대칭"'));
  for (const y of sys) {
    const p = (pv.symmetry || []).find((q) => q.id === y.id);
    const it = el('div', 'item' + (highlightId === y.id ? ' sel' : ''));
    const top = el('div', 'top');
    const nm = el('span');
    nm.append(el('span', 'id', y.id), document.createTextNode(`${y.axis} 대칭면`));
    const x = el('button', 'x', '✕');
    x.onclick = (e) => {
      e.stopPropagation();
      ops([{ op: 'remove', id: y.id }]);
    };
    top.append(nm, x);
    it.append(top, el('div', 'desc', `${p ? p.desc : ''} · 평면 위 테두리 엣지 ${p ? p.edges.length : 0}개 (법선 변위 0 + 반쪽 접힘 힌지)`));
    const ed = el('div', 'edit');
    const inp = el('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.value = y.at;
    inp.title = '평면 위치 (mm)';
    inp.onclick = (e) => e.stopPropagation();
    inp.onchange = () => ops([{ op: 'update', id: y.id, at: +inp.value || 0 }]);
    ed.append(inp);
    it.append(ed);
    it.onclick = () => {
      highlightId = highlightId === y.id ? null : y.id;
      renderLists();
      buildSymbols();
    };
    sl.append(it);
  }
  const w = $('warnings');
  w.innerHTML = '';
  for (const m of st.warnings) w.append(el('div', '', '⚠ ' + m));
  for (const m of pv.errors) w.append(el('div', 'err', '✕ ' + m));
}

function renderControls() {
  $('tools').innerHTML = `<b class="on" title="C++ 코어를 WebAssembly 로 빌드해 이 브라우저 안에서 계산">WASM 계산 ●</b> <b class="on" title="MERLIN2 v1.1 (Liu & Paulino 2018) 와 수치 대조">MERLIN2 대조 ●</b>`;
  if (!st.model) {
    $('modelInfo').textContent = '불러온 모델이 없습니다';
    return;
  }
  const c = st.model.counts;
  const lo = st.model.bbox.min.map(fmt).join(', ');
  const hi = st.model.bbox.max.map(fmt).join(', ');
  const sz = st.model.bbox.max.map((v, i) => v - st.model.bbox.min[i]);
  $('modelInfo').textContent = `${st.model.source}\n절점 ${c.nodes} · 패널 ${c.shells} (삼각형 ${st.model.tri} · 사각형 ${st.model.quad}${st.model.poly ? ' · 다각형 ' + st.model.poly : ''})\n크기 ${sz.map((v) => v.toFixed(3)).join(' × ')} mm (대각선 ${Math.hypot(...sz).toFixed(3)})\n범위 [${lo}] ~ [${hi}]\n절점 번호는 화면의 #번호 (OBJ 순서, 1부터)\n우클릭: 절점·엣지·면 정보`;
  const s = st.spec;
  $('stepType').value = s.step.type;
  $('increments').value = s.step.increments;
  $('modes').value = s.step.modes;
  $('imperfection').value = s.step.imperfection || 0;
  if (document.activeElement !== $('lamMax')) $('lamMax').value = s.step.lam_max ?? '';
  $('bhModel').value = s.bh.model || 'N5B8';
  $('bhCalib').value = s.bh.calib || 'auto';
  const m = s.materials.default;
  $('matE').value = m.E;
  $('matNu').value = m.nu;
  $('matY').value = m.yield ?? '';
  $('matH').value = m.hardening || '';
  $('matRho').value = m.rho ?? '';
  $('secT').value = s.sections['*'].thickness;
  $('undo').disabled = !st.can_undo;
  renderBH();
  renderExtras();
}

function renderSummary() {
  const box = $('summary');
  box.innerHTML = '';
  if (!st || !st.result) return;
  const head = el('span');
  head.innerHTML = `<b>솔버</b>${st.result.solver} · ${st.result.kind}${st.solve_time !== null ? ` · ${st.solve_time}s` : ''}${st.stale ? ' · <em style="color:var(--warn)">조건이 바뀌었습니다. 다시 해석하세요</em>' : ''}`;
  box.append(head);
  for (const w of st.warnings || []) box.append(el('span', 'note warn', '⚠ ' + w));
  for (const [k, v] of Object.entries(st.result.summary)) {
    if (k === '참고') {
      for (const n of v) box.append(el('span', 'note', n));
      continue;
    }
    const s = el('span');
    const b = el('b', '', k);
    s.append(b, document.createTextNode(Array.isArray(v) ? v.map(fmt).join(', ') : fmt(v)));
    box.append(s);
  }
}

const COLORS = ['#4cc2ff', '#ff5fa8', '#57d9a3', '#ffc857', '#c792ea', '#ff8a5c'];
const REFC = ['#ffffff', '#b0bec5', '#ffd54f', '#80cbc4'];

function chart(p) {
  const W = 420;
  const H = 230;
  const m = { l: 58, r: 12, t: 8, b: 34 };
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const s of p.series.concat(p.refs || [])) {
    for (const v of s.x) {
      x0 = Math.min(x0, v);
      x1 = Math.max(x1, v);
    }
    for (const v of s.y) {
      y0 = Math.min(y0, v);
      y1 = Math.max(y1, v);
    }
  }
  if (!isFinite(x0)) return svg;
  if (x0 === x1) x1 = x0 + 1;
  if (y0 === y1) {
    y0 -= Math.abs(y0) * 0.1 || 1;
    y1 += Math.abs(y1) * 0.1 || 1;
  }
  const py = (y1 - y0) * 0.06;
  y0 -= py;
  y1 += py;
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const mk = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  for (let i = 0; i <= 4; i++) {
    const yv = y0 + ((y1 - y0) * i) / 4;
    const xv = x0 + ((x1 - x0) * i) / 4;
    mk('line', { x1: m.l, x2: W - m.r, y1: Y(yv), y2: Y(yv), stroke: '#2a3340', 'stroke-width': 1 });
    mk('text', { x: m.l - 6, y: Y(yv) + 3, 'text-anchor': 'end', 'font-size': 10, fill: '#8492a6' }, fmt(yv));
    mk('text', { x: X(xv), y: H - m.b + 14, 'text-anchor': 'middle', 'font-size': 10, fill: '#8492a6' }, fmt(xv));
  }
  mk('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle', 'font-size': 10, fill: '#8492a6' }, p.xlabel);
  p.series.forEach((s, k) => {
    const pts = s.x.map((v, i) => `${X(v).toFixed(1)},${Y(s.y[i]).toFixed(1)}`).join(' ');
    mk('polyline', { points: pts, fill: 'none', stroke: COLORS[k % COLORS.length], 'stroke-width': 1.8 });
    if (s.x.length <= 40) s.x.forEach((v, i) => mk('circle', { cx: X(v), cy: Y(s.y[i]), r: 2.2, fill: COLORS[k % COLORS.length] }));
  });
  (p.refs || []).forEach((s, k) => {
    const pts = s.x.map((v, i) => `${X(v).toFixed(1)},${Y(s.y[i]).toFixed(1)}`).join(' ');
    mk('polyline', { points: pts, fill: 'none', stroke: REFC[k % REFC.length], 'stroke-width': 1.8, 'stroke-dasharray': '5 3' });
  });
  return svg;
}

async function loadPlots() {
  const box = $('plots');
  box.innerHTML = '';
  if (!st || !st.spec) return;
  if (!st.spec.plots.length && !st.result) return;
  if (!st.result) {
    box.append(el('div', 'info', `그래프 ${st.spec.plots.length}개가 등록되어 있습니다. 해석을 실행하면 표시됩니다.`));
    return;
  }
  const list = await api('/api/plots');
  for (const p of list) {
    const d = el('div', 'plot');
    const t = el('div', 'ptitle');
    const x = el('button', '', '✕');
    x.onclick = () => ops([{ op: 'remove', id: p.id }]);
    t.append(el('span', '', p.auto ? `기본 · ${p.title}` : `${p.id} · ${p.title}`));
    if (!p.auto) t.append(x);
    d.append(t);
    if (p.error) d.append(el('div', 'perr', p.error));
    else {
      d.append(chart(p));
      const lg = el('div', 'legend');
      p.series.forEach((s, k) => {
        const sp = el('span');
        const i = el('i');
        i.style.background = COLORS[k % COLORS.length];
        sp.append(i, document.createTextNode(s.name));
        lg.append(sp);
      });
      d.append(lg);
      const csv = el('button', 'mini', 'CSV');
      csv.title = '이 그래프 데이터를 CSV 로 저장';
      csv.onclick = () => {
        const rows = [['x', ...p.series.map((q) => q.name)].join(',')];
        const n = Math.max(...p.series.map((q) => q.x.length));
        for (let i = 0; i < n; i++) rows.push([p.series[0].x[i], ...p.series.map((q) => q.y[i])].join(','));
        download(URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })), `${p.title}.csv`);
      };
      t.append(csv);
    }
    box.append(d);
  }
}

let lastGeoKey = '';
async function refresh(s, opt = {}) {
  const prev = st;
  st = s;
  renderControls();
  if (!st.model) return;
  const key = `${st.model.source}|${st.model.counts.nodes}|${st.view.nodes.length ? st.view.nodes[0].join(',') : ''}|${(st.spec.symmetry || []).map((q) => q.axis + q.at).join(';')}`;
  if (st.view === undefined && prev) st.view = prev.view;
  if (key !== lastGeoKey) {
    lastGeoKey = key;
    SEL.nodes.clear();
    SEL.edges.clear();
    drawSel();
    buildModel();
    if (!opt.keepCamera && (!prev || !prev.model || prev.model.source !== st.model.source)) fit();
    else {
      const b = new THREE.Box3();
      for (const p of st.view.nodes) b.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
      diag = Math.max(b.getSize(new THREE.Vector3()).length(), 1e-6);
      center = b.getCenter(new THREE.Vector3());
    }
  }
  await loadCreases();
  renderLists();
  buildSymbols();
  renderSummary();
  const hadResult = !!R.mesh;
  if (!st.result || !opt.keepResult || !hadResult) await loadResult();
  applyVisibility();
  await loadPlots();
}

function addMsg(role, text, extra) {
  const log = $('chatLog');
  const m = el('div', 'msg ' + (role === 'user' ? 'user' : 'bot'));
  if (extra && extra.engine) m.append(el('span', 'tag', extra.engine === 'llm' ? 'LLM · ' + (extra.model || '') : '규칙 기반'));
  m.append(document.createTextNode(text));
  if (extra && extra.ops && extra.ops.length) m.append(el('div', 'ops', extra.ops.map((o) => JSON.stringify(o, (k, v) => ((k === 'points' || k === 'segments') && Array.isArray(v) ? `[${v.length}개]` : v))).join('\n')));
  if (extra && extra.note) m.append(el('div', 'notetxt', extra.note));
  if (extra && extra.error) m.append(el('div', 'errtxt', '적용 실패: ' + extra.error));
  log.append(m);
  log.scrollTop = log.scrollHeight;
}

async function sendChat(text) {
  if (!text.trim()) return;
  if (!st || !st.model) {
    addMsg('bot', '먼저 지오메트리를 불러오세요.');
    return;
  }
  addMsg('user', text);
  $('chatInput').value = '';
  const wait = el('div', 'msg bot', '');
  const label = document.createElement('span');
  const stop = el('button', 'danger stop', 'LLM 중단');
  stop.type = 'button';
  stop.onclick = () => api('/api/cancel/llm', { method: 'POST' }).catch(() => {});
  wait.append(label, stop);
  const t0 = Date.now();
  const tick = () => {
    label.textContent = '처리 중… ' + Math.round((Date.now() - t0) / 1000) + '초 (로컬 LLM은 처음 1~2분 걸릴 수 있습니다)';
  };
  tick();
  const timer = setInterval(tick, 1000);
  $('chatLog').append(wait);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  try {
    const s = await api('/api/chat', { json: { text, sel: selPayload() } });
    clearInterval(timer);
    wait.remove();
    const c = s.chat;
    addMsg('bot', c.reply || (c.ops.length ? '적용했습니다.' : '적용할 내용이 없습니다.'), c);
    await refresh(s, { keepResult: !!s.result });
    if (c.view && c.view.scale) {
      R.viewScale = c.view.scale;
      if (R.mesh) {
        R.scale = c.view.scale;
        $('scale').value = R.scale;
        showFrame();
      }
    }
    if (c.view && c.view.mirror !== undefined) {
      $('showMirror').checked = c.view.mirror;
      applyVisibility();
    }
    if (c.action === 'solve') $('solve').click();
  } catch (e) {
    clearInterval(timer);
    wait.remove();
    if (e.message.includes('중단')) addMsg('bot', e.message);
    else addMsg('bot', '', { error: e.message });
  }
}

async function loadExamples() {
  const list = await api('/api/examples');
  const sel = $('example');
  for (const e of list) {
    const o = new Option(e.title, e.name);
    o.dataset.note = e.note;
    o.dataset.prompts = JSON.stringify(e.prompts);
    sel.append(o);
  }
}

function chips(prompts) {
  const c = $('chips');
  c.innerHTML = '';
  for (const p of prompts) {
    const b = el('button', '', p);
    b.type = 'button';
    b.onclick = () => sendChat(p);
    c.append(b);
  }
}

async function openExample(preset) {
  const sel = $('example');
  if (!sel.value) return;
  note('불러오는 중…');
  try {
    const s = await api(`/api/examples/${sel.value}?preset=${preset}`, { method: 'POST' });
    clearSel();
    BH.sel.clear();
    lastGeoKey = '';
    $('chatLog').innerHTML = '';
    const o = sel.selectedOptions[0];
    chips(JSON.parse(o.dataset.prompts));
    await refresh(s);
    note(o.dataset.note);
  } catch (e) {
    note(e.message, true);
  }
}

async function llmRefresh(save) {
  const body = save ? { url: $('llmUrl').value, model: $('llmModel').value, mode: $('llmMode').value, ...( $('llmKey').value ? { key: $('llmKey').value } : {}) } : null;
  const r = save ? await api('/api/llm', { json: body }) : await api('/api/llm');
  $('llmUrl').value = r.llm.url;
  $('llmModel').value = r.llm.model;
  $('llmMode').value = r.llm.mode;
  const s = $('llmStatus');
  renderLlmInfo(r);
  if (!r.llm.url || !r.llm.model) {
    s.textContent = '규칙 기반 사용 · LLM 미설정';
    s.className = '';
  } else if (r.llm.mode === 'rule') {
    s.textContent = '규칙 기반 사용';
    s.className = '';
  } else if (r.llm.mode === 'rule_first') {
    s.textContent = r.status.ok && r.status.has_model ? '규칙 우선 · LLM 대기 중' : '규칙 우선 · LLM 없음';
    s.className = r.status.ok && r.status.has_model ? 'ok' : '';
  } else if (r.status.ok) {
    s.textContent = r.status.has_model ? '연결됨' : `연결됨 · 모델 '${r.llm.model}' 없음`;
    s.className = r.status.has_model ? 'ok' : 'bad';
  } else {
    s.textContent = '연결 안 됨 → 규칙 기반으로 대체';
    s.className = 'bad';
  }
}

function renderLlmInfo(r, test) {
  const box = $('llmInfo');
  const stt = r.status || {};
  const rows = [];
  const add = (k, v, cls) => {
    const d = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = k + ' ';
    const sp = document.createElement('span');
    sp.textContent = v;
    if (cls) sp.className = cls;
    d.append(b, sp);
    rows.push(d);
  };
  add('연결 대상', `${stt.provider || r.provider || ''} · ${stt.host || ''}`);
  add('모델', r.llm.model, stt.ok ? (stt.has_model ? 'good' : 'badt') : '');
  add('API 키', r.llm.has_key ? '입력됨' : '없음');
  if (r.llm.mode === 'rule') add('현재 방식', 'LLM을 부르지 않고 규칙 기반만 사용 중');
  else if (r.llm.mode === 'rule_first') add('현재 방식', '규칙이 이해한 문장은 즉시 처리, 못 알아들은 문장만 LLM으로 보냄');
  else if (stt.ok) add('서버 응답', `정상 (${stt.ms} ms) · 모델 ${stt.models.length}개 목록${stt.has_model ? '에 선택한 모델이 있음' : '에 선택한 모델이 없음'}`, stt.has_model ? 'good' : 'badt');
  else add('서버 응답', '연결 실패: ' + (stt.error || '') + (r.llm.mode === 'rule_first' ? ' (규칙으로 처리되는 문장은 그대로 동작합니다)' : ''), 'badt');
  if (test) {
    if (test.ok) add('실제 응답', `성공 (${(test.ms / 1000).toFixed(1)}초) · 응답한 모델 ${test.model || '?'} · JSON ${test.json_ok ? '정상' : '아님'} · "${test.reply}"`, test.json_ok ? 'good' : 'badt');
    else add('실제 응답', '실패: ' + test.error, 'badt');
  }
  box.replaceChildren(...rows);
}

async function llmTest() {
  const b = $('llmTest');
  b.disabled = true;
  b.textContent = '테스트 중… (로컬 모델은 첫 응답이 느립니다)';
  try {
    await llmRefresh(true);
    const t = await api('/api/llm/test', { method: 'POST' });
    const r = await api('/api/llm');
    renderLlmInfo(r, t.test);
  } catch (e) {
    note(e.message, true);
  }
  b.disabled = false;
  b.textContent = '실제 응답 테스트';
}

function viewTopo() {
  const v = st.view;
  if (v._edges) return v;
  const seen = new Map();
  const edges = [];
  const add = (a, b) => {
    const k = a < b ? a * 1e7 + b : b * 1e7 + a;
    if (!seen.has(k)) {
      seen.set(k, edges.length);
      edges.push([Math.min(a, b), Math.max(a, b)]);
    }
  };
  for (const f of v.shells) for (let i = 0; i < f.length; i++) add(f[i], f[(i + 1) % f.length]);
  for (const f of v.boundary) for (let i = 0; i < 3; i++) add(f[i], f[(i + 1) % 3]);
  for (const b of v.beams) add(b[0], b[1]);
  const faces = v.shells.map((f, i) => ({ n: f, kind: '면', id: i, group: (v.shell_group || [])[i] })).concat(v.boundary.map((f, i) => ({ n: f, kind: '솔리드 표면 삼각형', id: i })));
  v._edges = edges;
  v._faces = faces;
  return v;
}

function infoPos(i) {
  const useRes = G.result.visible && R.mesh && R.pos && i < (R.mesh.nInput || 0);
  return useRes ? [R.pos[3 * i], R.pos[3 * i + 1], R.pos[3 * i + 2]] : st.view.nodes[i];
}

const f3 = (x) => (Math.abs(x) < 5e-4 ? 0 : x).toFixed(3);
const vtxt = (a) => `(${a.map(f3).join(', ')})`;

function screenNodes() {
  const v = viewTopo();
  const rect = canvas.getBoundingClientRect();
  const n = v.nodes.length;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const ok = new Uint8Array(n);
  const q = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = infoPos(i);
    q.set(p[0], p[1], p[2]).project(camera);
    if (q.z < -1 || q.z > 1) continue;
    ok[i] = 1;
    sx[i] = (q.x * 0.5 + 0.5) * rect.width;
    sy[i] = (-q.y * 0.5 + 0.5) * rect.height;
  }
  return { v, rect, n, sx, sy, ok };
}

function hitTest(ev) {
  if (!st || !st.view) return null;
  const v = viewTopo();
  const rect = canvas.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;
  const n = v.nodes.length;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const ok = new Uint8Array(n);
  const q = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = infoPos(i);
    q.set(p[0], p[1], p[2]).project(camera);
    if (q.z < -1 || q.z > 1) continue;
    ok[i] = 1;
    sx[i] = (q.x * 0.5 + 0.5) * rect.width;
    sy[i] = (-q.y * 0.5 + 0.5) * rect.height;
  }
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1), camera);
  let hitFace = -1;
  let hitDist = Infinity;
  const tri = new THREE.Triangle();
  const hp = new THREE.Vector3();
  v._faces.forEach((f, k) => {
    const P = f.n.map((i) => new THREE.Vector3(...infoPos(i)));
    for (let j = 1; j < P.length - 1; j++) {
      const h = ray.ray.intersectTriangle(P[0], P[j], P[j + 1], false, hp);
      if (h) {
        const d = h.distanceTo(ray.ray.origin);
        if (d < hitDist) {
          hitDist = d;
          hitFace = k;
        }
      }
    }
  });
  const depth = (i) => new THREE.Vector3(...infoPos(i)).distanceTo(ray.ray.origin);
  const tol = hitDist === Infinity ? Infinity : hitDist + 1e-3 * (diag || 1);
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const d = (sx[i] - mx) ** 2 + (sy[i] - my) ** 2;
    if (d < bd && depth(i) <= tol) {
      bd = d;
      best = i;
    }
  }
  let ls = 0;
  let nl = 0;
  if (best >= 0)
    for (const [a, b] of v._edges)
      if ((a === best || b === best) && ok[a] && ok[b]) {
        ls += Math.hypot(sx[b] - sx[a], sy[b] - sy[a]);
        nl++;
      }
  ls = nl ? ls / nl : 40;
  const rn = Math.min(8, 0.22 * ls);
  const re = Math.min(5, 0.12 * ls);
  if (Math.sqrt(bd) > rn) best = -1;
  let be = -1;
  if (best < 0) {
    let ed = re * re;
    v._edges.forEach(([a, b], k) => {
      if (!ok[a] || !ok[b]) return;
      const ux = sx[b] - sx[a];
      const uy = sy[b] - sy[a];
      const L2 = ux * ux + uy * uy || 1e-9;
      const t = Math.max(0, Math.min(1, ((mx - sx[a]) * ux + (my - sy[a]) * uy) / L2));
      const d = (sx[a] + t * ux - mx) ** 2 + (sy[a] + t * uy - my) ** 2;
      if (d < ed) {
        const pa = infoPos(a);
        const pb = infoPos(b);
        const pm = new THREE.Vector3(pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]), pa[2] + t * (pb[2] - pa[2]));
        if (pm.distanceTo(ray.ray.origin) <= tol) {
          ed = d;
          be = k;
        }
      }
    });
  }
  return { v, best, be, hitFace };
}

function pickInfo(ev) {
  const h = hitTest(ev);
  if (!h) return;
  const { v, best, be, hitFace } = h;
  drawSel();
  const hud = $('hud');
  hud.innerHTML = '';
  picked = null;
  const mark = (pts, kind) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
    if (kind === 'pt') G.pick.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc857, size: 11, sizeAttenuation: false, depthTest: false })));
    else G.pick.add(new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xffc857, depthTest: false })));
  };
  const lines = [];
  let chip = '';
  if (best >= 0) {
    const p = infoPos(best);
    const p0 = v.nodes[best];
    picked = p0;
    mark([p], 'pt');
    lines.push(`절점 #${best + 1}`, `좌표 ${vtxt(p0)}`);
    if (p !== p0) lines.push(`변형 후 ${vtxt(p)}`);
    if (R.mesh && G.result.visible && best < (R.mesh.nInput || 0)) {
      const f = R.frames.get(`${R.index}|${R.field}`);
      if (f) lines.push(`U = [${f.U[best].map(fmt).join(', ')}] mm`);
    }
    const deg = v._edges.filter(([a, b]) => a === best || b === best).length;
    lines.push(`연결 엣지 ${deg}개`);
    chip = `${best + 1}번 절점`;
  } else if (be >= 0) {
    const [a, b] = v._edges[be];
    const pa = infoPos(a);
    const pb = infoPos(b);
    const d = pb.map((c, i) => c - pa[i]);
    const L = Math.hypot(...d);
    mark([pa, pb], 'ln');
    lines.push(`엣지 #${be + 1} (절점 #${a + 1} → #${b + 1})`, `길이 ${f3(L)} mm`, `벡터 ${vtxt(d)}`, `방향 ${vtxt(d.map((c) => c / (L || 1)))}`);
  } else if (hitFace >= 0) {
    const f = v._faces[hitFace];
    const P = f.n.map((i) => infoPos(i));
    const nv = [0, 0, 0];
    for (let j = 1; j < P.length - 1; j++) {
      const u = P[j].map((c, i) => c - P[0][i]);
      const w = P[j + 1].map((c, i) => c - P[0][i]);
      nv[0] += 0.5 * (u[1] * w[2] - u[2] * w[1]);
      nv[1] += 0.5 * (u[2] * w[0] - u[0] * w[2]);
      nv[2] += 0.5 * (u[0] * w[1] - u[1] * w[0]);
    }
    const A = Math.hypot(...nv);
    const c = [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / P.length);
    mark(P, 'ln');
    lines.push(`${f.kind} #${f.id + 1}${f.group ? ` (그룹 ${f.group})` : ''}`, `절점 ${f.n.map((i) => '#' + (i + 1)).join(', ')}`, `면적 ${f3(A)} mm²`, `법선 ${vtxt(nv.map((x) => x / (A || 1)))}`, `중심 ${vtxt(c)}`);
    chip = `점 (${c.map((x) => +x.toFixed(4)).join(', ')})`;
  } else return;
  const box = el('div', 'pickinfo');
  for (const t of lines) box.append(el('div', '', t));
  hud.append(box);
  const cp = el('button', '', '복사');
  cp.onclick = () => navigator.clipboard && navigator.clipboard.writeText(lines.join('\n'));
  hud.append(cp);
  if (best >= 0) {
    const gb = el('button', '', '변위 그래프');
    gb.title = '이 절점의 ux, uy, uz 이력을 그래프로 추가';
    const nd = best;
    gb.onclick = () => ops([{ op: 'add_plot', title: `절점 #${nd + 1} 스텝-변위`, x: { quantity: 'step' }, series: ['ux', 'uy', 'uz'].map((q) => ({ quantity: q, select: { nodes: [nd] }, name: `${q} #${nd + 1}` })) }]);
    hud.append(gb);
  }
  if (chip) {
    const b = el('button', '', '지시문에 넣기');
    b.onclick = () => {
      const t = $('chatInput');
      t.value += `${t.value && !t.value.endsWith(' ') ? ' ' : ''}${chip} `;
      t.focus();
    };
    hud.append(b);
  }
}

const SEL = { nodes: new Set(), edges: new Set() };

function selPayload() {
  if (!st || !st.view) return null;
  const v = viewTopo();
  const out = { points: [...SEL.nodes].map((i) => v.nodes[i]), segments: [...SEL.edges].map((k) => v._edges[k].map((i) => v.nodes[i])), creases: [...BH.sel] };
  return out.points.length || out.segments.length || out.creases.length ? out : null;
}

function clearSel() {
  SEL.nodes.clear();
  SEL.edges.clear();
  drawSel();
}

function edgeLabel(v, k) {
  const [a, b] = v._edges[k];
  if (!v._beamOf) {
    v._beamOf = new Map();
    v.beams.forEach(([p, q], i) => v._beamOf.set(Math.min(p, q) * 1e7 + Math.max(p, q), i));
  }
  const bi = v._beamOf.get(a * 1e7 + b);
  if (bi !== undefined) {
    const g = (v.beam_group || [])[bi];
    return { text: `보 #${bi + 1}`, group: g };
  }
  return { text: `엣지 #${k + 1}`, group: null };
}

function listIds(ids, max = 40) {
  const s = ids.slice(0, max).join(', ');
  return ids.length > max ? `${s} … 외 ${ids.length - max}개` : s;
}

function drawSel() {
  clear(G.pick);
  const hud = $('hud');
  hud.innerHTML = '';
  if (!st || !st.view || (!SEL.nodes.size && !SEL.edges.size)) return;
  const v = viewTopo();
  const pts = [];
  for (const i of SEL.nodes) pts.push(...infoPos(i));
  if (pts.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    G.pick.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc857, size: 11, sizeAttenuation: false, depthTest: false })));
  }
  const seg = [];
  for (const k of SEL.edges) for (const i of v._edges[k]) seg.push(...infoPos(i));
  if (seg.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3));
    G.pick.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffc857, depthTest: false })));
    const ep = new THREE.BufferGeometry();
    ep.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3));
    G.pick.add(new THREE.Points(ep, new THREE.PointsMaterial({ color: 0xffc857, size: 6, sizeAttenuation: false, depthTest: false })));
  }
  const box = el('div', 'pickinfo');
  const nodes = [...SEL.nodes].sort((a, b) => a - b);
  const lines = [];
  if (nodes.length) lines.push(`절점 ${nodes.length}개: ${listIds(nodes.map((i) => '#' + (i + 1)))}`);
  if (SEL.edges.size) {
    const labs = [...SEL.edges].sort((a, b) => a - b).map((k) => edgeLabel(v, k));
    lines.push(`선 ${labs.length}개: ${listIds(labs.map((l) => l.text))}`);
    const gs = [...new Set(labs.map((l) => l.group).filter(Boolean))];
    if (gs.length) lines.push(`그룹 ${gs.join(', ')}`);
  }
  if (nodes.length === 1 && !SEL.edges.size) {
    const i = nodes[0];
    const p0 = v.nodes[i];
    lines.push(`좌표 ${vtxt(p0)}`);
    if (G.result.visible && R.mesh && i < (R.mesh.nInput || 0)) {
      const f = R.frames.get(`${R.index}|${R.field}`);
      if (f) lines.push(`${R.field} = ${fmt(f.values[i])} · U = [${f.U[i].map(fmt).join(', ')}]`);
    }
  }
  if (SEL.edges.size === 1 && !nodes.length) {
    const [a, b] = v._edges[[...SEL.edges][0]];
    const pa = v.nodes[a];
    const pb = v.nodes[b];
    lines.push(`절점 #${a + 1} → #${b + 1}, 길이 ${f3(Math.hypot(...pb.map((c, i) => c - pa[i])))} mm`);
  }
  for (const t of lines) box.append(el('div', '', t));
  box.append(el('div', 'selhint', 'Shift+클릭 추가 · Ctrl+클릭 빼기 · Shift+드래그 상자(→ 안쪽만, ← 걸친 것까지) · Esc 해제'));
  hud.append(box);
  const put = el('button', '', '지시문에 넣기');
  put.title = '지시문에 "선택한 절점" 을 넣습니다. 보낼 때 고른 절점·선이 함께 갑니다';
  put.onclick = () => {
    const t = $('chatInput');
    t.value += `${t.value && !t.value.endsWith(' ') ? ' ' : ''}선택한 절점에 `;
    t.focus();
  };
  const cp = el('button', '', '번호 복사');
  cp.onclick = () => navigator.clipboard && navigator.clipboard.writeText(lines.join('\n'));
  const cl = el('button', '', '선택 해제');
  cl.onclick = clearSel;
  hud.append(put, cp, cl);
}

function toggle(set, k, mode) {
  if (mode === 'del') set.delete(k);
  else if (mode === 'xor' && set.has(k)) set.delete(k);
  else set.add(k);
}

function clickSelect(ev) {
  const h = hitTest(ev);
  if (!h) return;
  const mode = ev.ctrlKey || ev.metaKey ? 'del' : ev.shiftKey ? 'xor' : 'set';
  if (mode === 'set') {
    SEL.nodes.clear();
    SEL.edges.clear();
  }
  if (h.best >= 0) toggle(SEL.nodes, h.best, mode);
  else if (h.be >= 0) toggle(SEL.edges, h.be, mode);
  else if (h.hitFace >= 0) for (const i of h.v._faces[h.hitFace].n) toggle(SEL.nodes, i, mode === 'xor' ? 'add' : mode);
  drawSel();
}

function boxSelect(x0, y0, x1, y1, del) {
  const P = screenNodes();
  const L = Math.min(x0, x1) - P.rect.left;
  const Rr = Math.max(x0, x1) - P.rect.left;
  const T = Math.min(y0, y1) - P.rect.top;
  const B = Math.max(y0, y1) - P.rect.top;
  const cross = x1 < x0;
  const inside = (i) => P.ok[i] && P.sx[i] >= L && P.sx[i] <= Rr && P.sy[i] >= T && P.sy[i] <= B;
  const hitSeg = (a, b) => {
    if (!P.ok[a] || !P.ok[b]) return false;
    if (inside(a) || inside(b)) return true;
    const ax = P.sx[a], ay = P.sy[a], bx = P.sx[b], by = P.sy[b];
    if (Math.max(ax, bx) < L || Math.min(ax, bx) > Rr || Math.max(ay, by) < T || Math.min(ay, by) > B) return false;
    const side = (x, y) => Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    const s = [side(L, T), side(Rr, T), side(Rr, B), side(L, B)];
    return s.some((q) => q > 0) && s.some((q) => q < 0);
  };
  const mode = del ? 'del' : 'add';
  const v = P.v;
  const inN = [];
  for (let i = 0; i < P.n; i++) if (inside(i)) inN.push(i);
  for (const i of inN) toggle(SEL.nodes, i, mode);
  if (cross) v._edges.forEach(([a, b], k) => {
    if (hitSeg(a, b) && !(inside(a) && inside(b))) toggle(SEL.edges, k, mode);
  });
  drawSel();
}

function highlightNodes() {
  if (!highlightId || !st || !st.preview) return null;
  const p = st.preview;
  const find = (arr) => (arr || []).find((x) => x.id === highlightId);
  let it = find(p.bcs) || find(p.loads) || find(p.couplings);
  if (it) return { ids: it.nodes || [], desc: it.desc };
  it = find(p.contacts);
  if (it) return { ids: [...(it.a || []), ...(it.b || []), ...(it.nodes || [])], desc: it.desc };
  it = find(p.releases);
  if (it) return { ids: [], pts: it.points, desc: it.desc };
  return null;
}

function drawHighlight() {
  const h = highlightNodes();
  if (!h) return;
  G.symbols.traverse((o) => {
    if (o.material && !o.userData.label && !(o.material.color && o.material.color.getHex() === 0xffc857)) {
      o.material.transparent = true;
      o.material.opacity = Math.min(o.material.opacity ?? 1, 0.18);
    }
  });
  const v = viewTopo();
  const P = h.pts || h.ids.map((i) => v.nodes[i]);
  if (!P.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.flat()), 3));
  G.symbols.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc857, size: 12, sizeAttenuation: false, depthTest: false })));
  const inSet = new Set(h.ids);
  const seg = [];
  if (inSet.size > 1) for (const [a, b] of v._edges) if (inSet.has(a) && inSet.has(b)) seg.push(...v.nodes[a], ...v.nodes[b]);
  if (seg.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3));
    G.symbols.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffc857, depthTest: false })));
  }
  const c = [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / P.length);
  const lab = makeLabel(`${highlightId} · 절점 ${P.length}개`, diag * 0.035);
  lab.position.set(c[0], c[1], c[2]);
  lab.center.set(0, -0.6);
  G.symbols.add(lab);
}

function bind() {
  $('loadPreset').onclick = () => openExample(1);
  $('resetAll').onclick = async () => {
    if (!window.confirm('모델, 조건, 해석 결과, 대화를 모두 지우고 처음 화면으로 돌아갑니다.')) return;
    await api('/api/reset', { method: 'POST' });
    location.reload();
  };
  $('loadGeo').onclick = () => openExample(0);
  $('file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    note('불러오는 중…');
    try {
      const s = await api('/api/upload', { file: { name: f.name, text: await f.text() } });
      lastGeoKey = '';
      $('chatLog').innerHTML = '';
      chips(['바닥 고정', '1번 절점 고정', '선택한 절점에 아래로 1 N', '해석 실행']);
      await refresh(s);
      note(`${f.name} 을(를) 불러왔습니다. 단위는 mm 로 가정합니다. 절점 번호는 OBJ 순서(1부터)입니다.`);
    } catch (err) {
      note(err.message, true);
    }
    e.target.value = '';
  };
  $('stepType').onchange = (e) => ops([{ op: 'set_step', type: e.target.value }]);
  $('increments').onchange = (e) => ops([{ op: 'set_step', increments: +e.target.value || 1 }]);
  $('modes').onchange = (e) => ops([{ op: 'set_step', modes: +e.target.value || 1 }]);
  $('imperfection').onchange = (e) => ops([{ op: 'set_step', imperfection: +e.target.value || 0 }]);
  $('lamMax').onchange = (e) => ops([{ op: 'set_step', lam_max: e.target.value === '' ? null : +e.target.value }]);
  $('bhModel').onchange = (e) => ops([{ op: 'set_bh', model: e.target.value, ...(e.target.value === 'N4B5' ? { calib: 'manual' } : {}) }]);
  $('bhCalib').onchange = (e) => ops([{ op: 'set_bh', calib: e.target.value }]);
  $('matE').onchange = (e) => ops([{ op: 'set_material', E: +e.target.value }]);
  $('matNu').onchange = (e) => ops([{ op: 'set_material', nu: +e.target.value }]);
  $('matRho').onchange = (e) => ops([{ op: 'set_material', rho: e.target.value === '' ? 0 : +e.target.value }]);
  $('matH').onchange = (e) => ops([{ op: 'set_material', hardening: Math.max(0, +e.target.value || 0) }]);
  $('matY').onchange = (e) => ops([{ op: 'set_material', yield: e.target.value === '' ? null : +e.target.value }]);
  $('secT').onchange = (e) => ops([{ op: 'set_section', thickness: +e.target.value }]);
  $('expSpec').onclick = async () => {
    const d = await api('/api/export/spec');
    download(URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })), (d.geometry.name || 'model').replace(/\.obj$/i, '') + '.bah.json');
  };
  $('impSpec').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const s = await api('/api/import/spec', { json: JSON.parse(await f.text()) });
      lastGeoKey = '';
      await refresh(s);
      note(`${f.name} 을(를) 열었습니다`);
    } catch (err) {
      note(err.message, true);
    }
    e.target.value = '';
  };
  $('undo').onclick = async () => {
    try {
      await refresh(await api('/api/undo', { method: 'POST' }));
    } catch (e) {
      note(e.message, true);
    }
  };
  $('solve').onclick = async () => {
    if (!st || !st.model) return note('먼저 지오메트리를 불러오세요', true);
    const b = $('solve');
    b.disabled = true;
    b.textContent = '해석 중…';
    $('cancelSolve').hidden = false;
    note('');
    const tm = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}시간 ${Math.round((s % 3600) / 60)}분` : s >= 60 ? `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초` : `${Math.round(s)}초`);
    const poll = setInterval(async () => {
      try {
        const p = await api('/api/progress');
        if (!p.running) return;
        if (p.lam == null) {
          b.textContent = `해석 중… ${tm(p.elapsed)}`;
          note(`${p.stage || '해석 준비 중'} · ${tm(p.elapsed)} 경과`);
          return;
        }
        const pct = (100 * p.lam).toFixed(1);
        b.textContent = `해석 중… ${pct}%`;
        const parts = [`진행 ${pct}%`, `증분 ${p.inc}${p.increments ? ` (기본 ${p.increments})` : ''}`];
        if (p.disp != null) parts.push(`변위 ${p.disp} mm`);
        parts.push(`${tm(p.elapsed)} 경과`);
        if (p.eta != null) parts.push(`남은 약 ${tm(p.eta)}`);
        note(parts.join(' · ') + (p.stage ? `\n${p.stage}` : ''));
      } catch (e) {}
    }, 1000);
    try {
      const s = await api('/api/solve', { method: 'POST' });
      s.view = st.view;
      await refresh(s);
      note(`완료 (${s.solve_time}s)`);
    } catch (e) {
      note(e.message, true);
    }
    clearInterval(poll);
    $('cancelSolve').hidden = true;
    b.disabled = false;
    b.textContent = '해석 실행';
  };
  $('cancelSolve').onclick = () => api('/api/cancel/solve', { method: 'POST' }).catch(() => {});
  $('fit').onclick = fit;
  for (const id of ['showSymbols', 'showEdges', 'showResult', 'showMeshLines', 'showMirror']) $(id).onchange = () => {
    applyVisibility();
    if (R.mesh) showFrame();
  };
  $('frame').oninput = (e) => {
    R.index = +e.target.value;
    showFrame();
  };
  $('field').onchange = (e) => {
    R.field = e.target.value;
    showFrame();
  };
  $('scale').onchange = (e) => {
    R.scale = +e.target.value || 0;
    showFrame();
  };
  $('autoScale').onclick = () => {
    R.auto = true;
    showFrame();
  };
  $('play').onclick = () => {
    if (R.playing) return stopPlay();
    $('play').textContent = '❚❚';
    R.playing = setInterval(() => {
      R.index = (R.index + 1) % st.result.frames.length;
      $('frame').value = R.index;
      showFrame();
    }, 220);
  };
  $('savePng').onclick = () => download(snapshot(1600), 'bah-llm-web.png');
  $('saveVideo').onclick = saveVideo;
  $('llmTest').onclick = llmTest;
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    sendChat($('chatInput').value);
  };
  $('chatInput').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendChat($('chatInput').value);
    }
  };
  bindBH();
  $('llmSave').onclick = () => llmRefresh(true).catch((e) => note(e.message, true));
  let down = null;
  let drag = null;
  const band = el('div', 'selband');
  band.hidden = true;
  $('viewer').append(band);
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target !== canvas || e.button !== 0 || !e.shiftKey || !st || !st.view || BH.edit) return;
      controls.enabled = false;
      drag = { x: e.clientX, y: e.clientY, del: e.ctrlKey || e.metaKey };
    },
    true
  );
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = $('viewer').getBoundingClientRect();
    band.hidden = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4;
    band.className = 'selband' + (e.clientX < drag.x ? ' cross' : '');
    Object.assign(band.style, { left: Math.min(drag.x, e.clientX) - r.left + 'px', top: Math.min(drag.y, e.clientY) - r.top + 'px', width: Math.abs(e.clientX - drag.x) + 'px', height: Math.abs(e.clientY - drag.y) + 'px' });
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    band.hidden = true;
    controls.enabled = true;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) {
      boxSelect(d.x, d.y, e.clientX, e.clientY, d.del);
      down = null;
    }
  });
  canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY, e.button]));
  canvas.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) {
      if (down[2] === 2) pickInfo(e);
      else if (down[2] === 0 && !BH.edit) clickSelect(e);
    }
    down = null;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    clearSel();
    if (highlightId) {
      highlightId = null;
      renderLists();
      buildSymbols();
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

const FIELD_LABEL = { U: '변위 크기 |u| (mm)', ux: '변위 ux (mm)', uy: '변위 uy (mm)', uz: '변위 uz (mm)', energyDensity: '저장 에너지 밀도 (N·mm/mm²)', foldDensity: '접힘 에너지 밀도', bendDensity: '휨 에너지 밀도', stretchDensity: '바 에너지 밀도',  Nmax: '막력 최대 주값 (N/mm)', Nmin: '막력 최소 주값 (N/mm)', Mmax: '휨모멘트 최대 주값 (N·mm/mm)', Mmin: '휨모멘트 최소 주값 (N·mm/mm)', energyDensity: '변형 에너지 밀도 (N·mm/mm²)', panelEnergy: '패널 저장 에너지 (N·mm)', bendDensity: '패널 휨 에너지 밀도', foldDensity: '접힘 에너지 밀도', stretchDensity: '바 늘림 에너지 밀도', plasticDensity: '누적 소성 일 밀도', foldRotation: '접힘 회전 (도)', barStrain: '바 변형률', hingePlastic: '힌지 소성 회전 (도)', barPlastic: '바 소성 변형률' };
const BH = { edges: [], note: '', sel: new Set(), edit: false, drag: null, k3: null };
const BH_COL = { fold: 0xff6b5e, bend: 0x5ec8ff, cut: 0xffd84a, boundary: 0x7d8a99 };
const BH_NAME = { fold: '접힘', bend: '휨', cut: '자름', boundary: '경계' };
const ekey = (e) => (e[0] < e[1] ? `${e[0]}-${e[1]}` : `${e[1]}-${e[0]}`);

async function loadCreases() {
  const on = !!st && !!st.spec && !!st.model;
  if (!on) {
    BH.edges = [];
    clear(G.crease);
    return;
  }
  try {
    const r = await api('/api/creases');
    BH.edges = r.edges || [];
    BH.note = r.note || '';
  } catch (e) {
    BH.edges = [];
    BH.note = e.message;
  }
  const known = new Set(BH.edges.map((c) => ekey(c.edge)));
  for (const k of [...BH.sel]) if (!known.has(k)) BH.sel.delete(k);
  drawCreases();
  renderBH();
}

function drawCreases() {
  clear(G.crease);
  if (!BH.edges.length || !st.view) return;
  const groups = {};
  for (const c of BH.edges) {
    const t = BH.sel.has(ekey(c.edge)) ? 'sel' : c.type;
    (groups[t] = groups[t] || []).push(...st.view.nodes[c.edge[0]], ...st.view.nodes[c.edge[1]]);
  }
  for (const [t, arr] of Object.entries(groups)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
    const m = new THREE.LineBasicMaterial({ color: t === 'sel' ? 0xffffff : BH_COL[t], depthTest: t !== 'boundary', transparent: true, opacity: t === 'boundary' ? 0.6 : 1 });
    const ls = new THREE.LineSegments(g, m);
    ls.renderOrder = t === 'sel' ? 3 : 2;
    G.crease.add(ls);
  }
  applyVisibility();
}

function renderBH() {
  const on = !!st && !!st.spec;
  $('bhPanel').hidden = !on;
  if (!on) return;
  const c = st.spec.bh || {};
  if (document.activeElement !== $('bhLstar')) $('bhLstar').value = c.Lstar ?? '';
  $('bhContact').checked = !!c.contact;
  $('bhPH').checked = !!c.plastic_hinge;
  $('bhCyc').checked = (c.cycles || 0) > 0;
  $('bhCycNBox').hidden = !((c.cycles || 0) > 0);
  if (document.activeElement !== $('bhCycN') && c.cycles > 0) $('bhCycN').value = c.cycles;
  if (document.activeElement !== $('bhTargets')) $('bhTargets').value = (c.targets || []).join(', ');
  const kin = st.spec.step && st.spec.step.type === 'kinematic';
  document.querySelectorAll('.bhKin').forEach((r) => (r.hidden = !kin));
  const cnt = {};
  for (const e of BH.edges) cnt[e.type] = (cnt[e.type] || 0) + 1;
  $('bhCount').textContent = Object.entries(cnt).map(([k, v]) => `${BH_NAME[k] || k} ${v}`).join(' · ');
  const sel = [...BH.sel];
  const lines = [];
  lines.push(sel.length ? `선택 ${sel.length}개: ${sel.slice(0, 12).join(', ')}${sel.length > 12 ? ' …' : ''}` : BH.edit ? '드래그로 엣지를 고르세요 (왼→오 완전 포함, 오→왼 걸침, Shift 추가, Ctrl 제외, Esc 해제)' : '주름 편집 모드를 켜면 상자 선택으로 여러 엣지의 종류를 바꿀 수 있습니다');
  const man = Object.keys(st.spec.creases || {}).length;
  if (man) lines.push(`직접 지정 ${man}개`);
  if ((c.drivers || []).length) lines.push(`구동: ${c.drivers.map((d, i) => `${d}${c.targets && c.targets[i] !== undefined ? ' → ' + c.targets[i] + '°' : ''}`).join(', ')}`);
  if ((c.plot3 || []).length) lines.push(`3D 해공간: ${c.plot3.join(', ')}`);
  if (BH.note) lines.push(BH.note);
  $('bhSel').textContent = lines.join('\n');
  $('bhSel').style.whiteSpace = 'pre-line';
}

function setEdit(on) {
  BH.edit = on;
  $('bhEdit').textContent = on ? '주름 편집 모드 켬 (Esc 해제)' : '주름 편집 모드 끔';
  $('bhEdit').classList.toggle('on', on);
  controls.mouseButtons.LEFT = on ? null : THREE.MOUSE.ROTATE;
  applyVisibility();
  renderBH();
}

function screenEdges() {
  const rect = canvas.getBoundingClientRect();
  const q = new THREE.Vector3();
  const pts = new Map();
  const P = (i) => {
    if (pts.has(i)) return pts.get(i);
    const p = st.view.nodes[i];
    q.set(p[0], p[1], p[2]).project(camera);
    const r = q.z < -1 || q.z > 1 ? null : [(q.x * 0.5 + 0.5) * rect.width + rect.left, (-q.y * 0.5 + 0.5) * rect.height + rect.top];
    pts.set(i, r);
    return r;
  };
  return BH.edges.filter((c) => c.type !== 'boundary').map((c) => ({ key: ekey(c.edge), a: P(c.edge[0]), b: P(c.edge[1]) })).filter((s) => s.a && s.b);
}

function segHitsRect(a, b, x0, y0, x1, y1) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const qq = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (qq[i] < 0) return false;
    } else {
      const r = qq[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function segDist(a, b, x, y) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L));
  return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
}

function applySel(keys, ev) {
  if (ev.ctrlKey || ev.metaKey) keys.forEach((k) => BH.sel.delete(k));
  else {
    if (!ev.shiftKey) BH.sel.clear();
    keys.forEach((k) => BH.sel.add(k));
  }
  drawCreases();
  renderBH();
}

function bhPointerDown(e) {
  if (!BH.edit || e.button !== 0) return;
  BH.drag = { x: e.clientX, y: e.clientY };
}

function bhPointerMove(e) {
  if (!BH.drag) return;
  const b = $('selBox');
  const x0 = Math.min(BH.drag.x, e.clientX);
  const y0 = Math.min(BH.drag.y, e.clientY);
  if (Math.hypot(e.clientX - BH.drag.x, e.clientY - BH.drag.y) < 4) return;
  b.style.display = 'block';
  b.className = e.clientX >= BH.drag.x ? 'win' : 'cross';
  b.style.left = x0 + 'px';
  b.style.top = y0 + 'px';
  b.style.width = Math.abs(e.clientX - BH.drag.x) + 'px';
  b.style.height = Math.abs(e.clientY - BH.drag.y) + 'px';
}

function bhPointerUp(e) {
  if (!BH.drag) return;
  const d = BH.drag;
  BH.drag = null;
  $('selBox').style.display = 'none';
  const segs = screenEdges();
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) {
    let best = null;
    let bd = 8;
    for (const s of segs) {
      const dd = segDist(s.a, s.b, e.clientX, e.clientY);
      if (dd < bd) {
        bd = dd;
        best = s.key;
      }
    }
    applySel(best ? [best] : [], e);
    return;
  }
  const x0 = Math.min(d.x, e.clientX);
  const x1 = Math.max(d.x, e.clientX);
  const y0 = Math.min(d.y, e.clientY);
  const y1 = Math.max(d.y, e.clientY);
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const win = e.clientX >= d.x;
  applySel(segs.filter((s) => (win ? inside(s.a) && inside(s.b) : segHitsRect(s.a, s.b, x0, y0, x1, y1))).map((s) => s.key), e);
}

function bhNum(v) {
  const s = String(v).trim();
  return s === '' ? null : +s;
}

function bindBH() {
  const box = el('div');
  box.id = 'selBox';
  document.body.append(box);
  canvas.addEventListener('pointerdown', bhPointerDown);
  window.addEventListener('pointermove', bhPointerMove);
  window.addEventListener('pointerup', bhPointerUp);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && BH.edit && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      if (BH.sel.size) applySel([], { shiftKey: false });
      else setEdit(false);
    }
  });
  $('bhEdit').onclick = () => setEdit(!BH.edit);
  document.querySelectorAll('.bhType').forEach((b) => {
    b.onclick = () => {
      const es = [...BH.sel].map((k) => k.split('-').map(Number));
      if (!es.length) return note('먼저 주름 편집 모드에서 엣지를 선택하세요', true);
      ops([{ op: 'set_crease', edges: es, type: b.dataset.t }]);
    };
  });
  const setbh = (o) => ops([{ op: 'set_bh', ...o }]);
  $('bhLstar').onchange = (e) => setbh({ Lstar: bhNum(e.target.value), fold_mode: 'auto' });
  $('bhContact').onchange = (e) => setbh({ contact: e.target.checked });
  $('bhPH').onchange = (e) => setbh({ plastic_hinge: e.target.checked });
  $('bhCyc').onchange = (e) => {
    $('bhCycNBox').hidden = !e.target.checked;
    setbh(e.target.checked ? { cycles: Math.max(1, Math.round(bhNum($('bhCycN').value) || 3)) } : { cycles: 0, cycle_back: 0 });
  };
  $('bhCycN').onchange = (e) => setbh({ cycles: Math.max(1, Math.round(bhNum(e.target.value) || 1)) });
  const selFolds = () => [...BH.sel].filter((k) => (BH.edges.find((c) => ekey(c.edge) === k) || {}).type === 'fold');
  const targets = (n) => {
    const t = $('bhTargets').value.split(/[,\s]+/).filter(Boolean).map(Number);
    if (t.some((v) => !Number.isFinite(v))) return null;
    if (t.length === 1 && n > 1) return Array(n).fill(t[0]);
    return t;
  };
  $('bhDrivers').onclick = () => {
    const d = selFolds();
    if (!d.length) return note('구동 주름은 접힘(fold) 주름이어야 합니다', true);
    const t = targets(d.length);
    if (!t || t.length !== d.length) return note(`목표 이면각을 ${d.length}개 (또는 한 개) 넣어 주세요. 평면은 180°`, true);
    setbh({ drivers: d, targets: t });
  };
  $('bhTargets').onchange = () => {
    const c = st.spec.bh || {};
    const n = (c.drivers || []).length;
    const t = targets(n);
    if (n && t && t.length === n) setbh({ targets: t });
  };
  $('bhClearDrv').onclick = () => setbh({ drivers: [], targets: [] });
}

const BH_EXTRA = [
  ['Lstar_ratio', 3, 'L*/L_F (L* 를 비웠을 때)', ''],
  ['calib', 'auto', '강성 산정', ''],
  ['fold_k', null, '접힘 강성 Kf (직접)', 'N·mm/rad/mm'],
  ['bend_k', null, '휨 강성 Kb (직접)', 'N·mm/rad/mm'],
  ['bar_area', null, '바 단면적 (직접)', 'mm²'],
  ['tri_bars', 'merlin2', '삼각형 바 면적 식', ''],
  ['edge_bend', 'woodruff', '휨 엣지 강성 식', ''],
  ['compat', false, 'MERLIN2 v1.1 그대로 (버릇 포함)', ''],
  ['hinge_mp_factor', 1, '소성 힌지 m_p 배율', ''],
  ['fold_yield', null, '접힘 힌지 항복 모멘트', 'N·mm/mm'],
  ['fold_H', 0, '접힘 힌지 경화', 'N·mm/rad/mm'],
  ['bend_yield', null, '휨 힌지 항복 모멘트', 'N·mm/mm'],
  ['bend_H', 0, '휨 힌지 경화', 'N·mm/rad/mm'],
  ['cycle_back', 0, '반복 되돌림 변위', 'mm'],
  ['gap', null, '접촉 간격', 'mm'],
  ['tol', 3, '주름 자동 판정각', '도'],
  ['use_mass', true, '모드 해석 질량', ''],
  ['fold_th1', 45, 'EnhancedLinear θ1 (접힘)', '도'],
  ['fold_th2', 315, 'EnhancedLinear θ2 (접힘)', '도'],
  ['bar_cm', 'ogden', '바 재료식', ''],
  ['bend_cm', null, '휨 힌지 재료식', ''],
  ['fold_cm', 'enhanced', '접힘 힌지 재료식', ''],
];

function renderExtras() {
  const box = $('extraList');
  if (!box) return;
  box.innerHTML = '';
  const on = !!st && !!st.spec;
  const c = (on && st.spec.bh) || {};
  const items = [];
  if (on) {
    for (const [k, d, lab, unit] of BH_EXTRA) {
      const v = c[k];
      if (v === undefined || JSON.stringify(v) === JSON.stringify(d)) continue;
      if (v === null && d === null) continue;
      let txt = typeof v === 'boolean' ? (k === 'use_mass' ? (v ? '포함' : 'K 만 (질량 없음)') : v ? '켬' : '끔') : typeof v === 'object' && v !== null ? JSON.stringify(v) : `${v}${unit ? ' ' + unit : ''}`;
      items.push([k, d, lab, txt]);
    }
  }
  $('extraPanel').hidden = !items.length;
  $('extraCount').textContent = items.length ? `${items.length}개` : '';
  for (const [k, d, lab, txt] of items) {
    const it = el('div', 'item');
    const top = el('div', 'top');
    const nm = el('span');
    nm.append(document.createTextNode(lab));
    const x = el('button', 'x', '✕');
    x.title = '기본값으로 되돌리기';
    x.onclick = () => ops([{ op: 'set_bh', [k]: d }]);
    top.append(nm, x);
    it.append(top, el('div', 'desc', txt));
    box.append(it);
  }
}

function textSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '28px sans-serif';
  g.fillStyle = color || '#dfe7f1';
  g.textBaseline = 'middle';
  g.fillText(text, 4, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.scale.set(0.7, 0.175, 1);
  sp.center.set(0, 0.5);
  return sp;
}

async function loadKin3d() {
  if (BH.k3) {
    BH.k3.stop = true;
    BH.k3.renderer.dispose();
    BH.k3 = null;
  }
  if (!st || !st.result || !st.spec || st.spec.solver !== 'bh' || st.spec.step.type !== 'kinematic') return;
  let k;
  try {
    k = await api('/api/result/kin3d');
  } catch (e) {
    return;
  }
  if (!k || !k.edges) return;
  const all = [...(k.paths || []).flat(), ...(k.main || [])];
  if (!all.length) return;
  const lo = [0, 1, 2].map((i) => Math.min(...all.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i])));
  const nrm = (p) => p.map((v, i) => (hi[i] - lo[i] > 1e-9 ? (v - lo[i]) / (hi[i] - lo[i]) : 0.5) - 0.5);
  const d = el('div', 'plot kin3d');
  const t = el('div', 'ptitle');
  t.append(el('span', '', `기구 해공간 · 자유도 ${k.dof} · 이면각 (도)`));
  d.append(t);
  const cv = document.createElement('canvas');
  d.append(cv);
  const lg = el('div', 'legend');
  lg.innerHTML = `<span><i style="background:#ff6b5e"></i>X ${k.edges[0]}</span><span><i style="background:#7fe07f"></i>Y ${k.edges[1]}</span><span><i style="background:#5ec8ff"></i>Z ${k.edges[2]}</span><span><i style="background:#ffd84a"></i>해석 경로</span><span><i style="background:#9fb3c8"></i>방향별 경로</span>`;
  d.append(lg);
  $('plots').append(d);
  const w = cv.clientWidth || 420;
  const h = 320;
  const rd = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  rd.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  rd.setSize(w, h, false);
  const sc = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, w / h, 0.01, 100);
  cam.up.set(0, 0, 1);
  cam.position.set(1.6, -2.0, 1.3);
  const oc = new OrbitControls(cam, cv);
  oc.enableDamping = true;
  const axes = [[0xff6b5e, [1, 0, 0]], [0x7fe07f, [0, 1, 0]], [0x5ec8ff, [0, 0, 1]]];
  axes.forEach(([col, a], i) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(-0.5 + a[0], -0.5 + a[1], -0.5 + a[2])]);
    sc.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: col })));
    const s0 = textSprite(lo[i].toFixed(1), '#' + col.toString(16));
    s0.position.set(-0.5 + a[0] * 0.12, -0.5 + a[1] * 0.12, -0.5 + a[2] * 0.12 - 0.05);
    const s1 = textSprite(hi[i].toFixed(1), '#' + col.toString(16));
    s1.position.set(-0.5 + a[0], -0.5 + a[1], -0.5 + a[2]);
    sc.add(s0, s1);
  });
  sc.add(new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)), 0x334152));
  for (const path of k.paths || []) {
    if (path.length < 2) continue;
    const g = new THREE.BufferGeometry().setFromPoints(path.map((p) => new THREE.Vector3(...nrm(p))));
    sc.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x9fb3c8, transparent: true, opacity: 0.7 })));
  }
  if ((k.main || []).length > 1) {
    const g = new THREE.BufferGeometry().setFromPoints(k.main.map((p) => new THREE.Vector3(...nrm(p))));
    const ml = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd84a, depthTest: false }));
    ml.renderOrder = 2;
    sc.add(ml);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.025), new THREE.MeshBasicMaterial({ color: 0xffd84a }));
    dot.position.set(...nrm(k.main[0]));
    sc.add(dot);
  }
  const ctx = { renderer: rd, stop: false };
  BH.k3 = ctx;
  const tick = () => {
    if (ctx.stop || !cv.isConnected) return;
    oc.update();
    rd.render(sc, cam);
    requestAnimationFrame(tick);
  };
  tick();
}

async function start() {
  resize();
  bind();
  loop();
  await loadExamples();
  llmRefresh(false).catch(() => {});
  const s = await api('/api/state');
  if (s.model) await refresh(s);
  else {
    st = s;
    renderControls();
  }
}

start().catch((e) => note(e.message, true));


function makeLabel(text, size) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = '28px system-ui';
  c.width = Math.ceil(ctx.measureText(text).width) + 16;
  c.height = 40;
  ctx.font = '28px system-ui';
  ctx.fillStyle = 'rgba(14,17,22,.85)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 8, 29);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(c.width / c.height, 1, 1).multiplyScalar(size || 1);
  sp.userData.label = true;
  return sp;
}


function modelNotes(m) {
  const out = [];
  if (m.crossings) out.push(`서로 교차하는 선 ${m.crossings}곳에 절점을 넣어 나눔`);
  const d = m.dxf;
  if (d) {
    out.push(`DXF 단위 ${d.units}${d.scale !== 1 ? ` (×${d.scale} → mm)` : ''} · 선 ${d.lines} · 면 ${d.faces}${d.inserts ? ` · 블록 삽입 ${d.inserts}` : ''}`);
    const sk = Object.entries(d.skipped || {});
    if (sk.length) out.push(`건너뜀: ${sk.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  return out.length ? '\n' + out.join('\n') : '';
}

function mirrorMats(axis, at) {
  const m = new THREE.Matrix4();
  const s = [1, 1, 1];
  s['xyz'.indexOf(axis)] = -1;
  m.makeScale(...s);
  const t = [0, 0, 0];
  t['xyz'.indexOf(axis)] = 2 * at;
  m.premultiply(new THREE.Matrix4().makeTranslation(...t));
  return m;
}

function symList() {
  return (st && st.spec && st.spec.symmetry) || [];
}

function buildMirror() {
  clear(G.mirror);
  const sy = symList();
  if (!sy.length || !st.view) return;
  for (const o of [...G.model.children, ...G.edges.children]) {
    for (const s of sy) {
      const c = o.clone();
      c.material = o.material.clone();
      c.material.transparent = true;
      c.material.opacity = o.isMesh ? 0.28 : 0.35;
      c.material.depthWrite = false;
      c.applyMatrix4(mirrorMats(s.axis, s.at));
      G.mirror.add(c);
    }
  }
}

function buildResultMirror() {
  for (const c of [...G.result.children]) if (c.userData.mirror) G.result.remove(c);
  const sy = symList();
  if (!sy.length) return;
  const base = G.result.children.filter((c) => !c.userData.mirror);
  for (const s of sy)
    for (const o of base) {
      const m = o.isMesh ? new THREE.Mesh(o.geometry, o.material) : new THREE.LineSegments(o.geometry, o.material);
      m.applyMatrix4(mirrorMats(s.axis, s.at));
      m.userData = { ...o.userData, mirror: true };
      if (o.isMesh) m.material = o.material.clone(), (m.material.side = THREE.DoubleSide);
      G.result.add(m);
    }
}

function updateResultMirror() {
  applyVisibility();
}

function drawPressureArrows() {
  clear(G.arrows);
  if (!R.mesh || !st.preview) return;
  const pr = st.preview.loads.filter((l) => l.type === 'pressure');
  if (!pr.length) return;
  const nIn = R.mesh.nInput;
  const P = (i) => [R.pos[3 * i], R.pos[3 * i + 1], R.pos[3 * i + 2]];
  const s = diag * 0.035;
  for (const l of pr) {
    const spec = st.spec.loads.find((q) => q.id === l.id);
    const flip = new Set((spec && spec.flip) || []);
    for (const k of sample(l.faces.length, 300)) {
      const f = st.view.shells[l.faces[k]];
      if (f.some((i) => i >= nIn)) continue;
      const pts = f.map(P);
      const c = [0, 1, 2].map((q) => pts.reduce((a, p) => a + p[q], 0) / pts.length);
      let n = [0, 0, 0];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i].map((v, q) => v - c[q]);
        const b = pts[(i + 1) % pts.length].map((v, q) => v - c[q]);
        n[0] += a[1] * b[2] - a[2] * b[1];
        n[1] += a[2] * b[0] - a[0] * b[2];
        n[2] += a[0] * b[1] - a[1] * b[0];
      }
      const A = Math.hypot(...n) / 2;
      const dir = l.mode === 'local' ? new THREE.Vector3(...n).normalize().multiplyScalar(flip.has(l.faces[k]) ? -1 : 1) : new THREE.Vector3(...l.dirs[k]).normalize();
      const len = Math.max(s * 1.6, Math.sqrt(A) * 0.45);
      const p = new THREE.Vector3(...c);
      const a = new THREE.ArrowHelper(dir, p.clone().sub(dir.clone().multiplyScalar(len)), len, l.mode === 'local' ? 0xff8a5c : 0xff5c5c, len * 0.35, len * 0.2);
      a.traverse((o) => o.material && (o.material.depthTest = false));
      G.arrows.add(a);
    }
  }
}
