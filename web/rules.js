import { bbox, diagOf, resolve, describe } from './select.js';
import { edgeKey, panelEdges } from './geometry.js';
import { t as tl, getLang } from './i18n.js';
import { NUM, UNITS, MATERIALS, V, FILLER_WORDS } from './rules_vocab.js';

const AX = 'xyz';
const G0 = 9806.65;
const g = (p) => '(?:' + p + ')';

class Clause {
  constructor(t) {
    this.raw = t;
    this.w = t.toLowerCase();
  }
  take(pat) {
    const re = new RegExp(pat);
    const m = re.exec(this.w);
    if (m) this.w = this.w.slice(0, m.index) + ' '.repeat(m[0].length) + this.w.slice(m.index + m[0].length);
    return m;
  }
  takeall(pat) {
    const out = [];
    for (;;) {
      const m = this.take(pat);
      if (!m || !m[0].length) return out;
      out.push(m);
    }
  }
  has(pat) {
    return new RegExp(pat).test(this.w);
  }
}

const FILLER = new RegExp('^(?:' + FILLER_WORDS.join('|') + ')$');

function leftover(c) {
  const toks = c.w.replace(/[\s.,!?~:;()[\]"'`·\-+=/\\*_<>→←^#@&|{}]+/g, ' ').split(' ').filter(Boolean);
  const out = [];
  for (let t of toks) {
    let prev = null;
    while (prev !== t) {
      prev = t;
      if (FILLER.test(t)) t = '';
      t = t.replace(/(을|를|이|가|은|는|에|의|로|으로|도|만|과|와|에서|에게|해줘|줘|해|하고|들)$/, '');
    }
    if (t && (/\d/.test(t) || /[가-힣]/.test(t) || /[a-z]{2,}/.test(t)) && !FILLER.test(t)) out.push(t);
  }
  return out;
}

export function splitClauses(text) {
  let t = text.replace(/−|–/g, '-').replace(/×/g, 'x').replace(/，/g, ',');
  t = t.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
  t = t.replace(/\(([^()]*)\)/g, (m, a) => '(' + a.replace(/,/g, '\x01') + ')');
  t = t.replace(/(?<![A-Za-z])([xyzXYZ])\s*,\s*(?=[xyzXYZ](?![A-Za-z]))/g, '$1\x01');
  t = t.replace(/(\d)\s*,\s*(?=[-+]?\d)/g, '$1\x01');
  t = t.replace(/((?:절점|노드|nodes?|점|points?)\s*\d+)\s*(?:,|와|과|및|and)\s*(?=\d)/gi, '$1\x01');
  const parts = t.split(/[\n;]|,|(?<!\d)\.(?!\d)|\s그리고\s|\s또한\s|\sand then\s|\sthen\s|(?<=고정|구속|지지|막고|잡고)\s+(?=\S+\s+\S)|(?<=주고)\s+|(?<=걸고)\s+|(?<=넣고)\s+|(?<=켜고)\s+|(?<=하고)\s+(?!나머지)|\s후에\s|한\s*다음에?\s|한\s*뒤에?\s/);
  return parts.map((p) => (p || '').replace(/\x01/g, ',').trim()).filter(Boolean);
}

function quantities(c) {
  const out = [];
  for (const [kind, unit, scale] of UNITS) {
    const re = new RegExp(NUM + '\\s*(?:' + unit + ')', 'g');
    let m;
    while ((m = re.exec(c.w))) {
      if (!m[0].trim()) continue;
      out.push({ kind, value: +m[1] * scale, pos: m.index, signed: '+-'.includes(m[1][0]) });
      c.w = c.w.slice(0, m.index) + ' '.repeat(m[0].length) + c.w.slice(m.index + m[0].length);
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

function bare(c) {
  const m = c.take('(?<![a-z\\d#])' + NUM + '(?![a-z\\d])');
  return m ? +m[1] : null;
}

function direction(c) {
  const NEG = new RegExp('^' + g(V.NEGW) + '$');
  let m = c.take(g(g(V.NEGW) + '|' + g(V.POSW)).replace('(?:', '(') + '\\s*(?:의|of)?\\s*([xyz])\\s*(?:축|axis)?\\s*(?:의)?\\s*(?:' + V.DIRWORD + ')?(?:으로|로)?');
  if (m) {
    const v = [0, 0, 0];
    v[AX.indexOf(m[2])] = NEG.test(m[1]) ? -1 : 1;
    return { vec: v, literal: true };
  }
  m = c.take('([-+]?)\\s*([xyz])\\s*(?:축|axis)?\\s*(?:의)?\\s*(음|양|마이너스|플러스|-|\\+)?\\s*(?:의)?\\s*(?:방향|direction|쪽으로|축으로)(?:으로|로)?');
  if (m) {
    const v = [0, 0, 0];
    const neg = (m[1] === '-') !== ['음', '마이너스', '-'].includes(m[3]);
    v[AX.indexOf(m[2])] = neg ? -1 : 1;
    return { vec: v, literal: true };
  }
  m = c.take('(?<![a-z])(?:in|along|toward|towards)\\s+(?:the\\s+)?([-+]?)\\s*([xyz])(?![a-z])(?:\\s*-?\\s*(?:direction|axis))?');
  if (m) {
    const v = [0, 0, 0];
    v[AX.indexOf(m[2])] = m[1] === '-' ? -1 : 1;
    return { vec: v, literal: true };
  }
  const words = [
    [V.DOWN, [0, 0, -1]],
    [V.UP, [0, 0, 1]],
    [V.LEFTW, [-1, 0, 0]],
    [V.RIGHTW, [1, 0, 0]],
  ];
  for (const [p, v] of words) if (c.take(p)) return { vec: v, literal: false };
  return null;
}

function looseAxis(c) {
  const m = c.take('(?<![a-z\\d])([-+]?)\\s*u?([xyz])(?![a-z\\d])');
  if (!m) return null;
  const v = [0, 0, 0];
  v[AX.indexOf(m[2])] = m[1] === '-' ? -1 : 1;
  return { vec: v, literal: true };
}

const plane = (axis, at) => ({ plane: { axis, at } });

function selPlanes(sel) {
  const out = [];
  if (!sel) return out;
  if (sel.plane) out.push(sel.plane);
  for (const k of ['and', 'or']) for (const s of sel[k] || []) out.push(...selPlanes(s));
  return out;
}

function fixedPlane(spec, axis) {
  for (const b of spec.bcs) if (b.dofs.length >= 3 && !b.value) for (const p of selPlanes(b.select)) if ((p.at === 'min' || p.at === 'max') && (!axis || p.axis === axis)) return p;
  return null;
}

function nodeIds(c, geo, notes) {
  const m = c.take('(?:' + g(V.NODE) + '\\s*(?:번호|id|number)?\\s*#?\\s*((?:\\d+\\s*(?:,|와|과|및|and|&)?\\s*#?\\s*)+)(?:번)?(?:\\s*(?:절점|노드|점))?)|(?:#\\s*((?:\\d+\\s*(?:,|와|과|및|and)?\\s*#?\\s*)+))|(?:((?:\\d+\\s*(?:,|와|과|및)?\\s*)+)\\s*번\\s*(?:절점|노드|점|node|point)?)');
  if (!m) return null;
  const ids = (m[1] || m[2] || m[3]).match(/\d+/g).map((x) => +x - 1);
  if (ids.every((i) => i >= 0 && i < geo.nodes.length)) return { nodes: ids };
  notes.push(tl('절점 번호는 1~{n} 범위여야 합니다', { n: geo.nodes.length }));
  return null;
}

export function selection(c, geo, spec, ctx) {
  const [lo, hi] = bbox(geo.nodes);
  const span = diagOf(geo.nodes);
  const planes = [];
  const others = [];
  const notes = [];
  if (c.take('(?:화면\\s*(?:에서)?\\s*)?' + g(V.SELECTED) + '\\s*(?:절점|노드|점|곳|부분|영역|선|엣지|면|nodes?|points?|edges?|faces?|parts?)?(?:들)?')) {
    if (ctx.picked) return { sel: ctx.picked, notes };
    notes.push(tl('화면에서 선택한 절점·선이 없습니다 (클릭, Shift+클릭, Shift+드래그로 고르세요)'));
  }
  let m = c.take('(?:좌표|점|절점|위치|node|point|the\\s+node|the\\s+point)?\\s*(?:' + V.NEAR + ')?\\s*(?:to|of)?\\s*\\(\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*\\)\\s*(?:mm)?\\s*(?:' + V.NEAR + ')?');
  if (m) others.push({ nearest: [+m[1], +m[2], +m[3]] });
  const nid = nodeIds(c, geo, notes);
  if (nid) others.push(nid);
  for (const q of c.takeall('([xyz])\\s*(?:좌표)?\\s*(?:가|이|는|from|between)?\\s*' + NUM + '\\s*(?:mm)?\\s*(?:~|에서|부터|to|and)\\s*' + NUM + '\\s*(?:mm)?\\s*(?:사이|구간|범위|까지)?(?:인|의)?')) {
    const a = AX.indexOf(q[1]);
    const b0 = lo.map((v) => v - span), b1 = hi.map((v) => v + span);
    [b0[a], b1[a]] = [Math.min(+q[2], +q[3]), Math.max(+q[2], +q[3])];
    others.push({ box: { min: b0, max: b1 } });
  }
  for (const q of c.takeall('([-+])\\s*([xyz])\\s*' + g(V.SIDE) + '?\\s*' + g(V.SIDE_PART))) planes.push([q[2], q[1] === '+' ? 'max' : 'min']);
  const MIN = new RegExp('^' + g(V.MINW));
  const MAX = new RegExp('^' + g(V.MAXW));
  for (const q of c.takeall('(?<![a-z])([xyz])\\s*(?:좌표|coordinate)?\\s*(?:축|방향)?\\s*(?:가|이|의|=|:|is)?\\s*(' + V.MINW + '|' + V.MAXW + '|' + V.MIDW + ')(?:값)?(?:인|이\\s*되는)?')) {
    const w = q[2];
    planes.push([q[1], MIN.test(w) ? 'min' : MAX.test(w) ? 'max' : 'mid']);
  }
  for (const q of c.takeall('(?<![a-z])(' + V.MINW + '|' + V.MAXW + ')\\s*([xyz])(?![a-z])')) planes.push([q[2], MIN.test(q[1]) ? 'min' : 'max']);
  for (const q of c.takeall('(?<![a-z])([xyz])\\s*(?:좌표)?\\s*(?:=|가|이)\\s*' + NUM + '\\s*(?:mm)?\\s*(?:인|위치|지점|평면|단면|에서|plane)?')) planes.push([q[1], +q[2]]);
  const ext = hi.map((v, k) => v - lo[k]);
  const L = AX[ext.indexOf(Math.max(...ext))];
  const Vx = ext[2] > 1e-6 * span ? 'z' : 'y';
  m = c.take('(?<![a-z])([xyz])\\s*(?:축|방향|axis|direction)?\\s*(?:의)?\\s*' + g(V.BOTHENDS)) || c.take(g(V.BOTHENDS) + '\\s*(?:of|in|along)\\s*(?:the\\s*)?([xyz])(?![a-z])');
  if (m) others.push({ or: [plane(m[1], 'min'), plane(m[1], 'max')] });
  else if (c.take(V.BOTHENDS)) others.push({ or: [plane(L, 'min'), plane(L, 'max')] });
  if (c.take(V.OPPOSITE)) {
    const ref = fixedPlane(spec);
    if (ref) planes.push([ref.axis, ref.at === 'min' ? 'max' : 'min']);
    else notes.push(tl("'반대쪽'의 기준이 되는 고정 구속이 없습니다"));
  }
  if (c.take(V.FREEEND)) {
    const ref = fixedPlane(spec, L) || fixedPlane(spec);
    planes.push(ref ? [ref.axis, ref.at === 'min' ? 'max' : 'min'] : [L, 'max']);
  }
  const words = [
    [V.BOTTOM, Vx, 'min'],
    [V.TOP, Vx, 'max'],
    [V.LEFT, 'x', 'min'],
    [V.RIGHT, 'x', 'max'],
    [V.FRONT, 'y', 'min'],
    [V.BACK, 'y', 'max'],
  ];
  for (const [p, ax, at] of words) if (c.take(p)) planes.push([ax, at]);
  if (c.take(V.BOUNDARY)) others.push({ boundary: true });
  if (c.take(V.CORNERS)) others.push({ corners: true });
  m = c.take('(' + V.CENTER + ')\\s*(' + V.CENTER_LINE + ')?');
  if (m) {
    if (m[2]) planes.push([L, 'mid']);
    else if (planes.length) {
      const ctr = lo.map((v, k) => (v + hi[k]) / 2);
      for (const [ax, at] of planes) {
        const a = AX.indexOf(ax);
        ctr[a] = at === 'min' ? lo[a] : at === 'max' ? hi[a] : at === 'mid' ? (lo[a] + hi[a]) / 2 : +at;
      }
      others.push({ nearest: ctr });
      planes.length = 0;
    } else others.push({ nearest: lo.map((v, k) => (v + hi[k]) / 2) });
  }
  const by = {};
  for (const [ax, at] of planes) {
    by[ax] = by[ax] || [];
    if (!by[ax].includes(at)) by[ax].push(at);
  }
  const items = Object.entries(by).map(([ax, ats]) => (ats.length === 1 ? plane(ax, ats[0]) : { or: ats.map((a) => plane(ax, a)) }));
  items.push(...others);
  if (!items.length) {
    if (c.take(V.ALLSEL)) return { sel: { all: true }, notes };
    return { sel: null, notes };
  }
  return { sel: items.length === 1 ? items[0] : { and: items }, notes };
}

function bcDofs(c) {
  const d = new Set();
  for (const m of c.takeall('(?<![a-z])u\\s*([xyz123])(?![a-z0-9])')) d.add(AX.includes(m[1]) ? AX.indexOf(m[1]) + 1 : +m[1]);
  for (const m of c.takeall('(?<![a-z])((?:[xyz]\\s*(?:,|와|과|및|랑|and|/|·)?\\s*){1,3})(?:축\\s*)?(?:의\\s*)?(?:방향|변위|병진|이동|direction|translations?|displacements?)(?:\\s*(?:변위|병진|이동))?(?:으로|로)?(?:만|only)?')) for (const ch of m[1].match(/[xyz]/g)) d.add(AX.indexOf(ch) + 1);
  for (const m of c.takeall('(?<![a-z])((?:[xyz]\\s*(?:,|와|과|및|랑|/|·)?\\s*){1,3})(?=\\s*(?:축)?\\s*(?:만|은|는|을|를)?\\s*' + g(V.FIX_STEM) + ')')) for (const ch of m[1].match(/[xyz]/g)) d.add(AX.indexOf(ch) + 1);
  for (const m of c.takeall('(?<![a-z])(?:in|only)\\s+((?:[xyz]\\s*(?:,|and|/)?\\s*){1,3})(?:\\s*(?:direction|only))?(?![a-z])')) for (const ch of m[1].match(/[xyz]/g)) d.add(AX.indexOf(ch) + 1);
  return [...d].sort();
}

function scaleWord(c) {
  let m = c.take(NUM + '\\s*(?:배(?:로)?|x(?![a-z])|times)') || c.take('(?:by|x)\\s*' + NUM + '(?![a-z\\d])');
  if (m) return +m[1];
  if (c.take('두\\s*배(?:로)?|twice|double')) return 2;
  if (c.take('세\\s*배(?:로)?|triple')) return 3;
  if (c.take('열\\s*배(?:로)?|tenfold')) return 10;
  if (c.take('절반(?:으로)?|반\\s*으로|half(?:\\s*size)?')) return 0.5;
  return null;
}

const HELP_KO =
  "이런 문장을 바로 처리합니다. 구속: '바닥 고정', '8번 절점 고정', '2번 절점 y, z 구속', 'x 최소 변을 z 방향만 구속', 'x = 0 대칭'. " +
  "하중: '59번 절점에 아래로 1 N', '선택한 절점마다 z -0.5 N', '윗면에 압력 0.001 MPa 아래로', '선택한 면에 수직으로 압력 1 kPa', '자중'. " +
  "강제 변위: '59번 절점을 y 방향으로 -30 mm'. 재료: 'E 1000', '포아송 0.3', '두께 0.25', '종이로'. " +
  "모델: 'N4B5 로', 'L* 30 mm', '접촉 켜', '소성 힌지 켜', '반복 3회', 'MERLIN2 호환'. 주름: '선택한 엣지를 휨으로', '2-7 주름을 휨으로'. " +
  "해석: '호장법으로', '모드 6개', '증분 200', '해석 실행'. 스케일: '전체 크기 2배', 'm 단위를 mm 로', '변형 10배로 보여줘'. " +
  "결과: '59번 점 변위 보여줘', '59번 점 변위-힘 그래프', '59번 점 변위-에너지', '접힘 에너지 그래프', '최대 반력 얼마?'. 수정: 'ld1 2배', 'bc2 삭제', '되돌려'. " +
  "기구·모드: '자유도 해석', '2-7 주름을 120도까지 구동', '선택한 주름 3개 해공간 3차원 그래프', '2-7, 7-12, 6-7 주름 해공간', '2-7 주름 각도 그래프', '강성 행렬 모드 6개', '자유도 몇 개?'.";

const HELP_EN =
  "These sentences are handled directly. Supports: 'fix bottom', 'fix node 8', 'constrain node 2 in y, z', 'fix x min edge in z only', 'symmetry x = 0'. " +
  "Loads: '1 N downward at node 59', '-0.5 N in z per node at selected nodes', 'pressure 0.001 MPa downward on top', 'normal pressure 1 kPa on selected faces', 'gravity'. " +
  "Prescribed displacement: 'move node 59 by -30 mm in y'. Material: 'E 1000', 'poisson 0.3', 'thickness 0.25', 'paper'. " +
  "Model: 'N4B5', 'L* 30 mm', 'contact on', 'plastic hinge on', '3 cycles', 'MERLIN2 compat'. Creases: 'set selected edges to bend', 'crease 2-7 to bend'. " +
  "Analysis: 'arc-length', '6 modes', '200 increments', 'run'. Scale: 'scale model 2x', 'convert m to mm', 'deformation scale 10'. " +
  "Results: 'node 59 displacement plot', 'node 59 force-displacement plot', 'node 59 displacement-energy', 'fold energy plot', 'max reaction?'. Edit: 'ld1 x2', 'delete bc2', 'undo'. " +
  "Kinematics and modes: 'dof analysis', 'drive crease 2-7 to 120 deg', 'solution space of selected creases', 'solution space of creases 2-7, 7-12, 6-7', 'crease 2-7 angle plot', 'stiffness modes 6', 'how many dof?'.";

function help() {
  return getLang() === 'ko' ? HELP_KO : HELP_EN;
}

function edgeRefs(c, geo) {
  const pe = panelEdges(geo);
  const out = [];
  const bad = [];
  for (const m of c.takeall('(?<![\\d.])(\\d+)\\s*(?:번)?\\s*-\\s*(\\d+)(?![\\d.])\\s*(?:번)?')) {
    const k = edgeKey(+m[1] - 1, +m[2] - 1);
    if (pe.has(k) && pe.get(k).length >= 2) out.push(k);
    else bad.push(`${m[1]}-${m[2]}${pe.has(k) ? tl(' (테두리)') : ''}`);
  }
  return { keys: [...new Set(out)], bad };
}

function edgeName(k) {
  const [a, b] = k.split('-').map(Number);
  return `${a + 1}-${b + 1}`;
}

function parseKinematic(c, geo, ctx, info) {
  const ops = [];
  const space = c.has(V.SPACE);
  const prot = !space && c.has(V.PLASTROT) && c.has(V.PLOT);
  const angle = !space && !prot && c.has(V.ANGLE) && c.has(V.PLOT);
  const degRe = new RegExp(NUM + '\\s*(?:도|°|deg(?:rees?)?)', 'g');
  const driveCtx = c.has(V.DRIVE) || (c.has(V.EDGEW) && c.has('(?<![a-z])to\\s*' + NUM.replace('(', '(?:') + '\\s*(?:°|deg)'));
  const degs = driveCtx ? [...c.w.matchAll(degRe)].map((m) => +m[1]) : [];
  const dofOnly = c.has(V.DOF);
  const stiff = c.has(V.STIFFMODE);
  if (!space && !angle && !prot && !degs.length && !dofOnly && !stiff) return null;
  if (stiff) {
    const m = c.take(NUM + '\\s*(?:개|차|modes?)') || c.take('(?:modes?)\\s*' + NUM);
    c.takeall(V.STIFFMODE);
    c.takeall('강성|행렬|기반|고유값?|모드|해석|으로|의|를|을|만|stiffness|matrix|based|eigen|modes?|analysis|of|the|k');
    ops.push({ op: 'set_bh', use_mass: false });
    ops.push({ op: 'set_step', type: 'modal', ...(m ? { modes: Math.round(+m[1]) } : {}) });
    return { ops, msgs: [tl('강성 행렬 K 만으로 고유값 해석 (질량 없음)') + (m ? tl(' · 모드 {n}개', { n: m[1] }) : '')] };
  }
  if (dofOnly && !degs.length && !space) {
    c.takeall(V.DOF);
    c.takeall('자유도|해석|분석|계산|구해|확인|analysis|run|the');
    ops.push({ op: 'set_bh', drivers: [], targets: [] });
    ops.push({ op: 'set_step', type: 'kinematic' });
    return { ops, msgs: [tl('기구 자유도 해석: 강체 패널 구속 야코비안의 계수로 자유도를 세고, 기구 모드를 보여 줍니다')] };
  }
  const { keys, bad } = edgeRefs(c, geo);
  const es = keys.length ? keys : selectedEdges(geo, ctx);
  if (bad.length) {
    info.ask = true;
    return { ops, msgs: [tl('주름(두 패널 사이 엣지)이 아닙니다: {v} (절점 번호는 화면의 #번호, 1부터)', { v: bad.join(', ') })] };
  }
  if (space) {
    if (es.length < 3) {
      info.ask = true;
      return { ops, msgs: [tl("해공간 그래프에는 주름 3개가 필요합니다 (지금 {n}개). 예: '2-7, 7-12, 6-7 주름 해공간 그래프' 또는 주름 편집 모드에서 3개를 고르고 '선택한 주름 해공간 그래프'", { n: es.length })] };
    }
    ops.push({ op: 'add_plot', type: 'space3', edges: es.slice(0, 3) });
    return { ops, msgs: [tl('해공간 3차원 그래프 추가: {v}', { v: es.slice(0, 3).map(edgeName).join(', ') }) + (es.length > 3 ? tl(' (앞의 3개만 씀, 선택 {n}개)', { n: es.length }) : '')] };
  }
  if (prot && !es.length) return { ops, msgs: [tl('상위 주름의 누적 소성 회전 그래프는 소성이 생기면 해석 뒤 자동으로 붙습니다. 특정 주름은 예: \'2-7 주름 누적 소성 회전 그래프\'')] };
  if (!es.length) {
    info.ask = true;
    return { ops, msgs: [tl("어느 주름인지 알려 주세요. 예: '2-7 주름' 또는 주름 편집 모드에서 엣지를 고르고 '선택한 주름 …'")] };
  }
  if (prot) {
    ops.push({ op: 'add_plot', title: tl('누적 소성 회전 {v}', { v: es.map(edgeName).join(', ') }), x: { quantity: 'step' }, series: es.map((k) => ({ quantity: 'peeq', select: { edge: k } })) });
    return { ops, msgs: [tl('그래프 추가: 주름 {v} 누적 소성 회전', { v: es.map(edgeName).join(', ') })] };
  }
  if (angle) {
    ops.push({ op: 'add_plot', title: tl('이면각 {v}', { v: es.map(edgeName).join(', ') }), x: { quantity: 'step' }, series: es.map((k) => ({ quantity: 'angle', select: { edge: k } })) });
    return { ops, msgs: [tl('그래프 추가: 주름 {v} 이면각', { v: es.map(edgeName).join(', ') })] };
  }
  const tg = es.map((_, i) => degs[Math.min(i, degs.length - 1)]);
  ops.push({ op: 'set_bh', drivers: es, targets: tg });
  ops.push({ op: 'set_step', type: 'kinematic' });
  return { ops, msgs: [tl('기구 해석: 구동 주름 {v}', { v: es.map((k, i) => `${edgeName(k)} → ${tg[i]}°`).join(', ') })] };
}

const R = (p) => new RegExp(p);

function parsePlot(c, geo, spec, ctx) {
  const t = c.w;
  const ld = R(g(V.DISP) + '\\s*[-–~/]?\\s*(?:힘|하중|반력|force|load|reaction)|(?:힘|하중|반력|force|load|reaction)\\s*[-–~/]\\s*' + g(V.DISP)).test(t);
  const de = R(g(V.DISP) + '\\s*[-–~/]?\\s*' + g(V.ENERGY) + '|' + g(V.ENERGY) + '\\s*[-–~/]\\s*' + g(V.DISP)).test(t);
  const axm = t.match(/(?<![a-z])([xyz])\s*(?:축|방향)?\s*(?:의)?\s*(?:변위|처짐|displacement|deflection)/) || t.match(/(?:변위|displacement|deflection)\s*(?:in\s+)?u?([xyz])(?![a-z])/) || t.match(/(?<![a-z])u([xyz])(?![a-z])/);
  const cc = new Clause(t);
  for (const p of [V.PLOT, V.STEPW + '|step|증분']) cc.takeall(p);
  const { sel } = selection(cc, geo, spec, ctx);
  const ids = sel ? resolve(geo, sel) : [];
  const axisFor = () => {
    if (axm) return axm[1];
    for (const b of spec.bcs) if (b.value && ids.length && resolve(geo, b.select).some((i) => ids.includes(i))) return AX[b.dofs[0] - 1];
    for (const l of spec.loads) if (l.type === 'force' && ids.length && resolve(geo, l.select).some((i) => ids.includes(i))) {
      const a = l.vector.map(Math.abs);
      return AX[a.indexOf(Math.max(...a))];
    }
    const mv = spec.bcs.find((b) => b.value);
    return mv ? AX[mv.dofs[0] - 1] : 'z';
  };
  const who = sel ? describe(sel) : '';
  if (ld) {
    if (!sel) return { op: 'add_plot', title: tl('변위-힘 (하중점)'), x: { quantity: 'step' }, series: [{ quantity: 'force' }], _needSel: true };
    const a = axisFor();
    return { op: 'add_plot', title: tl('{w} 변위 u{a} - 힘 F{a}', { w: who, a }), x: { quantity: 'u' + a, select: sel }, series: [{ quantity: 'force.' + a, select: sel }] };
  }
  if (de) {
    if (!sel) return { op: 'add_plot', title: tl('변위-에너지'), x: { quantity: 'step' }, series: [{ quantity: 'energy.total' }], _needSel: true };
    const a = axisFor();
    return { op: 'add_plot', title: tl('{w} 변위 u{a} - 에너지', { w: who, a }), x: { quantity: 'u' + a, select: sel }, series: ['energy.total', 'energy.bar', 'energy.fold', 'energy.bend'].map((q) => ({ quantity: q })) };
  }
  const series = [];
  if (R(V.ENERGY).test(t)) {
    let hit = false;
    for (const [p, k] of [[V.E_FOLD, 'energy.fold'], [V.E_BAR, 'energy.bar'], [V.E_BEND, 'energy.bend'], [V.E_PLAS, 'energy.plastic'], [V.E_CONT, 'energy.contact'], [V.E_EXT, 'energy.external']])
      if (R(p).test(t)) {
        series.push({ quantity: k });
        hit = true;
      }
    if (!hit || R(V.E_TOTAL).test(t)) series.unshift({ quantity: 'energy.total' });
  }
  if (R(V.REACTION).test(t) && sel) series.push({ quantity: 'force.' + axisFor(), select: sel });
  if (R(V.LAMW).test(t)) series.push({ quantity: 'lam' });
  if (R(V.DISP).test(t)) {
    if (!sel) return { op: 'add_plot', title: tl('변위'), x: { quantity: 'step' }, series: [{ quantity: 'lam' }], _needSel: true };
    if (axm) series.push({ quantity: 'u' + axm[1], select: sel });
    else for (const a of 'xyz') series.push({ quantity: 'u' + a, select: sel, name: `u${a} (${who}, mm)` });
  }
  if (!series.length) return null;
  const kind = series.some((s) => s.quantity.startsWith('u')) ? tl('스텝-변위') : series.some((s) => s.quantity.startsWith('energy')) ? tl('스텝-에너지') : tl('스텝-값');
  return { op: 'add_plot', title: (sel ? who + ' ' : '') + kind, x: { quantity: 'step' }, series };
}

function answer(c, ctx) {
  const r = ctx.result;
  const t = c.w;
  if (!R(V.ANSWER_GATE).test(t)) return null;
  if (!r) return tl('아직 해석 결과가 없습니다. "해석 실행" 후 물어보세요.');
  const v = r.values || {};
  const out = [];
  if (r.kind === 'static') {
    if (R(g(V.FORCEW)).test(t) && v.fmax !== undefined) out.push(tl('최대 반력/하중 {v} N', { v: (+v.fmax).toPrecision(5) }));
    if (R(g(V.DISP)).test(t) && v.umax !== undefined) out.push(tl('최대 변위 {v} mm', { v: (+v.umax).toPrecision(5) }));
    if (R(V.ENERGY).test(t) && v.energies) {
      const e = v.energies;
      out.push(tl('최종 에너지 바 {a} · 접힘 {b} · 휨 {c} N·mm', { a: (+e[0]).toPrecision(4), b: (+e[1]).toPrecision(4), c: (+e[2]).toPrecision(4) }));
    }
    if (R(V.LAMW).test(t) && v.lam !== undefined) out.push(tl('최종 하중 계수 λ = {v}', { v: (+v.lam).toPrecision(5) }));
  } else if (r.kind === 'modal') {
    const m = t.match(new RegExp(V.FREQ_N));
    const f = r.result.freq || [];
    if (m && f[+m[1] - 1] !== undefined) out.push(tl('{n}차 고유진동수 {v} Hz', { n: m[1], v: (+f[+m[1] - 1]).toPrecision(5) }));
    else if (f.length) out.push(tl('고유진동수 {v} Hz', { v: f.slice(0, 6).map((x) => (+x).toPrecision(4)).join(', ') }));
  }
  if (R(V.DOF_Q).test(t) && r.result.dof) {
    const d = r.result.dof;
    out.push(tl('기구 자유도 {m} (강체 패널, 구속식 {c} · 자유 자유도 {f} · 계수 {r}{rig}) · 자기 응력 상태 {s}', { m: d.mechanisms, c: d.constraints, f: d.freeDofs, r: d.rank, rig: d.rigidRemoved ? tl(' · 강체 운동 6 제외') : '', s: d.selfStress }));
  }
  return out.length ? out.join(' · ') : null;
}

function selectedEdges(geo, ctx) {
  const out = new Set();
  for (const k of ctx.creaseSel || []) out.add(k);
  const p = ctx.picked;
  if (p) {
    const pe = panelEdges(geo);
    const near = (q) => {
      let best = -1, bd = Infinity;
      geo.nodes.forEach((n, i) => {
        const d = Math.hypot(n[0] - q[0], n[1] - q[1], n[2] - q[2]);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    for (const s of p.segments || []) {
      const k = edgeKey(near(s[0]), near(s[1]));
      if (pe.has(k)) out.add(k);
    }
    const ids = new Set((p.points || []).map(near));
    for (const k of pe.keys()) {
      const [a, b] = k.split('-').map(Number);
      if (ids.has(a) && ids.has(b)) out.add(k);
    }
  }
  return [...out];
}

function creaseType(s) {
  return R('^' + g(V.FOLDT)).test(s) ? 'fold' : R('^' + g(V.BENDT)).test(s) ? 'bend' : R('^' + g(V.CUTT)).test(s) ? 'cut' : 'auto';
}

const TYPEW = g([V.FOLDT, V.BENDT, V.CUTT, V.AUTOT].join('|'));
const CLEAR_KEY = [[/구속|support|bc|constraint/, 'bcs'], [/하중|load/, 'loads'], [/그래프|plot|graph/, 'plots'], [/대칭|symmetr/, 'symmetry'], [/주름|crease/, 'creases']];

function parseAxes(c) {
  const U = '\\s*(?:mm|n·mm|n|°|도|deg|kn|mpa|n\\*mm)?';
  const RG = NUM + U + '\\s*(?:~|～|〜|to|에서|부터|\\.\\.|…)\\s*' + NUM + U + '\\s*(?:까지)?';
  const ctxw = '(?:축|axis|범위|range|lim(?:its?)?|그래프|플롯|plot|graph|스케일|scale)';
  const hasCtx = c.has('\\[') || c.has(ctxw);
  const re = (a) => '(?<![a-z])' + a + '\\s*(?:축|-?\\s*axis)?\\s*(?:범위|range|lim(?:its?)?)?\\s*(?:을|를|는|=|:)?\\s*[\\[(]?\\s*' + RG + '\\s*[\\])]?';
  const auto = c.has('(?:축|axis|스케일|scale|범위|range)\\s*(?:을|를)?\\s*(?:자동|auto|reset|초기화|되돌려)|auto\\s*-?\\s*scale|autoscale');
  const mx = hasCtx ? c.take(re('x')) : null;
  const my = hasCtx ? c.take(re('y')) : null;
  if (!mx && !my && !auto) return null;
  const op = { op: 'set_axes' };
  const id = c.take('(?<![a-z])pl\\s*(\\d+)');
  if (id) op.id = 'pl' + id[1];
  else if (c.take('모든\\s*그래프|전체\\s*그래프|all\\s*(?:the\\s*)?(?:plots|graphs)')) op.id = 'all';
  else if (c.take('스텝\\s*-\\s*힘|step\\s*-\\s*force|(?:기본\\s*)?힘\\s*그래프|force\\s*plot')) op.id = 'auto_f';
  else if (c.take('스텝\\s*-\\s*에너지|step\\s*-\\s*energy|(?:기본\\s*)?에너지\\s*그래프|energy\\s*plot')) op.id = 'auto_e';
  else if (c.take('소성\\s*(?:회전)?\\s*그래프|plastic\\s*(?:rotation)?\\s*plot')) op.id = 'auto_p';
  const pair = (m) => {
    const a = +m[1], b = +m[2];
    return [Math.min(a, b), Math.max(a, b)];
  };
  if (auto && !mx && !my) {
    c.take('(?:축|axis|스케일|scale|범위|range)\\s*(?:을|를)?\\s*(?:자동|auto|reset|초기화|되돌려)|auto\\s*-?\\s*scale|autoscale');
    Object.assign(op, { x: null, y: null });
  }
  if (mx) op.x = pair(mx);
  if (my) op.y = pair(my);
  c.takeall('그래프|플롯|plot|graph|축|axis|범위|range|스케일|scale|으로|로|맞춰|설정|바꿔|해줘|줘|set|to|the|of');
  const desc = [mx ? `x [${op.x.join(' ~ ')}]` : '', my ? `y [${op.y.join(' ~ ')}]` : ''].filter(Boolean).join(' · ') || tl('자동');
  return { ops: [op], msgs: [tl('그래프 축 범위: {v}', { v: desc }) + (op.id ? ` (${op.id})` : '')] };
}

function parseClause(text, geo, spec, ctx, info) {
  const c = new Clause(text);
  const ops = [];
  const msgs = [];
  if (c.take(V.UNDO)) {
    info.undo = true;
    return { ops, msgs: [] };
  }
  if (c.take(V.HELP)) {
    info.answered = true;
    return { ops, msgs: [help()] };
  }
  const ax = parseAxes(c);
  if (ax) return ax;
  const ans = (R(V.ASK).test(c.w) || (R(V.DOF_Q).test(c.w) && /몇|얼마|알려|how many|what/.test(c.w))) && !R(g(V.PLOT)).test(c.w) ? answer(new Clause(c.w), ctx) : null;
  if (ans) {
    info.answered = true;
    return { ops, msgs: [ans] };
  }
  if (c.take(V.RUN)) info.run = true;
  for (const m of c.takeall('(?<![a-z])((?:bc|ld|pl|sy)\\d+)\\s*(?:을|를)?\\s*' + g(V.REMOVE))) ops.push({ op: 'remove', id: m[1] });
  for (const m of c.takeall(g(V.REMOVE) + '\\s+((?:bc|ld|pl|sy)\\d+)(?![a-z\\d])')) ops.push({ op: 'remove', id: m[1] });
  let m = c.take('(?<![a-z])((?:bc|ld)\\d+)\\s*(?:을|를|by)?\\s*(?:x|×)?\\s*' + NUM + '\\s*(?:배|x(?![a-z])|times)') || c.take('(?<![a-z])((?:bc|ld)\\d+)\\s*(?:x|×|by|times)\\s*' + NUM + '(?![\\d.])') || c.take('(?:scale|multiply)\\s+((?:bc|ld)\\d+)\\s*(?:by|x|×)\\s*' + NUM);
  if (m) ops.push({ op: 'update', id: m[1], scale: +m[2] });
  m = c.take('(' + V.CLEAR_WHAT + ')\\s*(?:을|를)?\\s*' + g(V.ALL) + '?\\s*' + g(V.CLEAR_VERB) + '|' + g(V.CLEAR_VERB) + '\\s*(?:' + V.ALL + ')?\\s*(?:the\\s*)?(' + V.CLEAR_WHAT + ')|' + g(V.ALL) + '\\s*' + g(V.CLEAR_VERB) + '|' + g(V.CLEAR_VERB) + '\\s*(?:' + V.ALL + ')(?![a-z])');
  if (m) {
    const w = m[1] || m[2] || '';
    const k = CLEAR_KEY.find(([re]) => re.test(w));
    ops.push({ op: 'clear', what: k ? k[1] : 'all' });
  }
  if (ops.length) return { ops, msgs };

  m = c.take(g(V.DEFORM) + '\\s*(?:' + V.SCALE_WORD + ')?\\s*(?:을|를|by|to|x)?\\s*' + NUM + '\\s*(?:배|x(?![a-z])|times)?') || (c.has(V.DEFORM) && c.has(V.SHOW) ? c.take(NUM + '\\s*(?:배|x(?![a-z])|times)') : null);
  if (m) {
    info.view = { scale: +m[1] };
    ops.push({ op: 'set_view', scale: +m[1] });
    return { ops, msgs: [tl('변형 배율 {v}배로 표시합니다', { v: m[1] })] };
  }
  if (c.has(V.SYM) && c.has(V.SHOW + '|' + V.HIDE + '|미러|mirror') && !c.has('[xyz]\\s*(?:=|축|평면|대칭|plane)') && !c.has('(?:symmetry|mirror)\\s*(?:plane)?\\s*(?:at|about|on|across)?\\s*[xyz](?![a-z])')) {
    const on = !c.has(V.HIDE);
    info.view = { mirror: on };
    ops.push({ op: 'set_view', mirror: on });
    return { ops, msgs: [on ? tl('대칭 표시 켬') : tl('대칭 표시 끔')] };
  }
  m = c.take('(?<![a-z])(m|cm|inch|인치|미터|센티|meters?|centimeters?)\\s*(?:단위|units?)?\\s*(?:를|을|에서)?\\s*(?:→|->|to|into)?\\s*(?:mm|밀리|millimeters?)\\s*(?:단위)?(?:로|으로)?');
  if (m) {
    const f = { m: 1000, 미터: 1000, meter: 1000, meters: 1000, cm: 10, 센티: 10, centimeter: 10, centimeters: 10, inch: 25.4, 인치: 25.4 }[m[1]];
    ops.push({ op: 'scale_geometry', factor: f });
    return { ops, msgs: [tl('형상 좌표를 {f}배 ({u} → mm) 했습니다. 두께·하중은 그대로입니다', { f, u: m[1] })] };
  }
  if (c.has(g(V.GEOMETRY)) && c.has(V.GROW + '|' + V.SHRINK + '|twice|double|half') && !c.has(V.DEFORM)) {
    let f = scaleWord(c);
    if (f === null) {
      const mm = c.take(NUM);
      f = mm ? +mm[1] : null;
    }
    if (c.has(V.SHRINK) && f > 1) f = 1 / f;
    if (f) {
      ops.push({ op: 'scale_geometry', factor: f });
      return { ops, msgs: [tl('형상 전체를 {f}배 했습니다 (구속·하중 위치와 강제 변위도 같은 배율, 두께는 그대로)', { f })] };
    }
  }

  {
    const st = {};
    const sm = c.take('(\\d+)\\s*번\\s*(?:절점|점|노드)\\s*(?:의)?\\s*([xyz])\\s*(?:방향)?\\s*변위\\s*(?:가|이)?\\s*' + NUM + '\\s*(?:mm)?\\s*(?:에서|되면|이면|에|까지)\\s*(?:정지|멈춤|멈춰|중단|그만)') || c.take('stop\\s*(?:when|at|once)?\\s*node\\s*(\\d+)\\s*(?:\'s)?\\s*([xyz])\\s*-?\\s*(?:displacement|disp)?\\s*(?:reaches|=|of|is|at)?\\s*' + NUM + '\\s*(?:mm)?');
    if (sm) {
      const nd = +sm[1] - 1;
      if (!(nd >= 0 && nd < geo.nodes.length)) {
        info.ask = true;
        return { ops, msgs: [tl('없는 절점입니다: {v}', { v: sm[1] })] };
      }
      st.stop = [{ node: nd, dir: 'xyz'.indexOf(sm[2]), value: Math.abs(+sm[3]) }];
      msgs.push(tl('정지 조건: 절점 #{n} {a} 변위 크기 {v} mm', { n: sm[1], a: sm[2], v: Math.abs(+sm[3]) }));
    }
    if (c.take('(?:정지\\s*조건|stop\\s*(?:criterion|condition|rule)s?)\\s*(?:을|를)?\\s*(?:없애|지워|빼|삭제|해제|off|remove|clear)')) st.stop = [];
    const lm = c.take('(?:초기|첫\\s*증분|시작)\\s*(?:하중\\s*)?(?:계수|λ|lambda)\\s*(?:을|를|=|:)?\\s*' + NUM) || c.take('(?:initial|first|starting)\\s*(?:load\\s*)?(?:factor|λ|lambda|increment)\\s*(?:of|=|to|is)?\\s*' + NUM) || c.take('(?:λ|lambda)\\s*0\\s*(?:=|:)?\\s*' + NUM);
    if (lm) st.lambda0 = +lm[1];
    if (c.take('(?:목표\\s*)?하중\\s*계수\\s*(?:제한)?\\s*(?:없이|없음|없애|해제|빼)|(?:no|without|remove)\\s+(?:target\\s+)?(?:load\\s+factor|λ|lambda)(?:\\s+limit)?')) st.lam_max = null;
    if (Object.keys(st).length) ops.push({ op: 'set_step', ...st });
  }
  const mat = {};
  for (const [pat, ko, en, E, nu, rho, fy] of MATERIALS)
    if (c.take('(?<![a-z가-힣])(?:' + pat + ')(?![a-z])')) {
      Object.assign(mat, { E, nu, rho });
      if (fy) mat.yield = fy;
      msgs.push(tl('재료 {n} (E {E} MPa, ν {nu})', { n: getLang() === 'ko' ? ko : en, E, nu }));
      c.take(V.MATERIAL + '|으로|로');
      break;
    }
  const sep = '\\s*(?:을|를|는|=|:|of|is|to)?\\s*';
  m = c.take(g(V.YOUNG) + sep + NUM + '\\s*(gpa|mpa)?');
  if (m) mat.E = +m[1] * (m[2] === 'gpa' ? 1000 : 1);
  m = c.take(g(V.POISSON) + sep + NUM);
  if (m) mat.nu = +m[1];
  m = c.take(g(V.DENSITY) + sep + NUM);
  if (m) mat.rho = +m[1];
  m = c.take(g(V.YIELD) + sep + NUM);
  if (m) mat.yield = +m[1];
  if (c.take('항복\\s*(?:응력)?\\s*(?:을|를)?\\s*(?:없애|빼|지워|삭제)|탄성\\s*바|(?:no|remove)\\s+yield|elastic\\s+bars?')) mat.yield = null;
  m = c.take(g(V.THICK) + sep + NUM + '\\s*(?:mm)?') || c.take(NUM + '\\s*(?:mm)?\\s*(?:thick(?:ness)?)(?![a-z])');
  if (m) mat.thickness = +m[1];
  if (Object.keys(mat).length) {
    ops.push({ op: 'set_material', ...mat });
    c.takeall(V.MATERIAL + '|재질|물성|으로|로|바꿔|설정');
  }

  const bh = {};
  if (c.take('n\\s*4\\s*b\\s*5')) bh.model = 'N4B5';
  if (c.take('n\\s*5\\s*b\\s*8')) bh.model = 'N5B8';
  if (bh.model === 'N4B5' && !(spec.bh.fold_k || spec.bh.bend_k)) msgs.push(tl('N4B5 는 MERLIN2 처럼 강성을 직접 넣는 방식입니다 (기본 Kb 0.1, Kf 0.01, 바 면적 0.1)'));
  const LS = '(?:l\\s*\\*|l\\s*star|길이\\s*척도|length\\s*scale)';
  m = c.take(LS + '\\s*(?:/\\s*l\\s*_?\\s*f)' + sep + NUM);
  if (m) Object.assign(bh, { Lstar_ratio: +m[1], Lstar: null });
  else {
    m = c.take(LS + sep + NUM + '\\s*(?:mm)?');
    if (m) bh.Lstar = +m[1];
  }
  if (c.take(LS + '\\s*(?:을|를|to)?\\s*(?:자동|auto)')) Object.assign(bh, { Lstar: null });
  m = c.take(g(V.FOLDT) + '\\s*(?:강성|stiffness)' + sep + NUM);
  if (m) Object.assign(bh, { fold_k: +m[1], calib: 'manual' });
  m = c.take(g(V.BENDT) + '\\s*(?:강성|stiffness)' + sep + NUM);
  if (m) Object.assign(bh, { bend_k: +m[1], calib: 'manual' });
  m = c.take('(?:바|bar)\\s*(?:단면적|면적|area)' + sep + NUM);
  if (m) Object.assign(bh, { bar_area: +m[1], calib: 'manual' });
  if (c.take('강성\\s*(?:을|를)?\\s*자동|merlin\\s*2?\\s*자동|auto\\s*calib(?:ration)?|auto(?:matic)?\\s*stiffness')) Object.assign(bh, { calib: 'auto', fold_k: null, bend_k: null, bar_area: null });
  if (c.take(g(V.CONTACT) + '\\s*(?:을|를)?\\s*' + g(V.OFF) + '|(?:no|disable|without|turn\\s+off)\\s+(?:geometric\\s+)?contact')) bh.contact = false;
  else if (c.take('(?:geometric\\s*)?' + g(V.CONTACT) + '(?:\\s*on)?')) bh.contact = true;
  m = c.take(g(V.GAP) + sep + NUM);
  if (m) bh.gap = +m[1];
  if (c.take(g(V.PHINGE) + '\\s*(?:를|을)?\\s*' + g(V.OFF) + '|탄성\\s*힌지|elastic\\s*hinges?|(?:no|disable|without)\\s+plastic\\s*hinges?')) bh.plastic_hinge = false;
  else if (c.take(V.PHINGE)) bh.plastic_hinge = true;
  m = c.take(g(V.CYCLIC) + '\\s*(?:하중|load(?:ing)?)?\\s*' + NUM + '\\s*' + g(V.CYCLE_N)) || c.take(NUM + '\\s*(?:회|번)\\s*(?:반복|왕복)') || c.take(NUM + '\\s*(?:load(?:ing)?\\s*)?cycles(?![a-z])') || c.take('(?:repeat|cycle)\\s*' + NUM + '\\s*times');
  if (m) bh.cycles = Math.round(+m[1]);
  if (c.take('반복\\s*(?:하중)?\\s*(?:을|를)?\\s*(?:끄|꺼|없애|해제|빼)|단조|(?:no|disable)\\s+cyclic(?:\\s*load(?:ing)?)?|cyclic(?:\\s*load(?:ing)?)?\\s*off|monotonic')) Object.assign(bh, { cycles: 0, cycle_back: 0 });
  m = c.take('(?:반대\\s*(?:방향)?으로|되돌림|return\\s*(?:displacement)?|back\\s*by)\\s*' + NUM + '\\s*(?:mm)?');
  if (m) bh.cycle_back = Math.abs(+m[1]);
  if (c.take(V.COMPAT)) bh.compat = true;
  if (c.take('호환\\s*(?:모드)?\\s*(?:를|을)?\\s*(?:꺼|끄|해제)|compat(?:ibility)?\\s*off')) bh.compat = false;
  if (c.take('woodruff')) bh.tri_bars = 'woodruff';
  if (c.take('khawale|키리가미\\s*(?:식|강성)|kirigami\\s*(?:formula|stiffness)')) Object.assign(bh, { tri_bars: 'khawale', edge_bend: 'khawale' });
  if (c.take('merlin\\s*2?\\s*(?:식|면적|formula|areas?)')) bh.tri_bars = 'merlin2';
  if (c.take(V.NOMASS)) bh.use_mass = false;
  else if (c.take(V.WITHMASS)) bh.use_mass = true;
  m = c.take('(?:판정\\s*각|자동\\s*판정|detection\\s*angle|crease\\s*tolerance)' + sep + NUM);
  if (m) bh.tol = +m[1];
  if (Object.keys(bh).length) ops.push({ op: 'set_bh', ...bh });

  const allE = c.take('(?:모든|전체|all)\\s*(?:the\\s*)?(?:내부\\s*|interior\\s*|internal\\s*)?' + g(V.EDGEW) + '\\s*(?:을|를|은|는)?\\s*(?:to|as|into|=)?\\s*(' + [V.FOLDT, V.BENDT, V.AUTOT].join('|') + ')');
  if (allE) {
    ops.push({ op: 'set_crease', edges: 'all', type: creaseType(allE[1]) });
    c.takeall('으로|로|바꿔|변경|설정|해줘|줘|set|make|change|convert');
  }
  m = c.take('(' + g(V.SELECTED) + '\\s*' + g(V.EDGEW) + '?|이\\s*(?:엣지|주름)|(?:this|these)\\s*' + g(V.EDGEW) + ')\\s*(?:을|를|은|는)?\\s*(?:to|as|into|=)?\\s*(' + TYPEW.slice(3, -1) + ')');
  if (m) {
    const ty = creaseType(m[2]);
    const es = selectedEdges(geo, ctx);
    if (!es.length) {
      info.ask = true;
      return { ops, msgs: [...msgs, tl('바꿀 엣지가 선택되어 있지 않습니다. 주름 편집 모드나 Shift+클릭으로 엣지를 고르세요')] };
    }
    ops.push({ op: 'set_crease', edges: es, type: ty });
    c.takeall('으로|로|바꿔|변경|설정|해줘|줘|set|make|change|convert');
  }
  if (!m) {
    const { keys } = (() => (c.has('(?<![\\d.])\\d+\\s*-\\s*\\d+(?![\\d.])') && c.has(g(V.EDGEW)) && c.has('(?:to|as|into|으로|로)?\\s*' + TYPEW + '(?![a-z])') && !c.has(V.SPACE + '|' + V.ANGLE + '|' + V.DRIVE) ? edgeRefs(c, geo) : { keys: [] }))();
    if (keys.length) {
      const tm = c.take(TYPEW + '(?![a-z])');
      if (tm) {
        ops.push({ op: 'set_crease', edges: keys, type: creaseType(tm[0].trim()) });
        c.takeall(g(V.EDGEW) + '|으로|로|바꿔|변경|설정|해줘|줘|set|make|change|convert');
      }
    }
  }

  const kin = parseKinematic(c, geo, ctx, info);
  if (kin) return { ops: [...ops, ...kin.ops], msgs: [...msgs, ...kin.msgs] };

  const step = {};
  if (c.take(V.ARCLEN)) step.type = 'arclength';
  m = c.take(g(V.MODE_N_PRE) + '\\s*(?:해석|모드|analysis)?\\s*' + NUM + '\\s*(?:개|차)?(?![\\d.])') || c.take(NUM + '\\s*' + g(V.MODE_N_POST) + '\\s*(?:모드|고유)?');
  if (m) {
    Object.assign(step, { type: 'modal', modes: Math.round(+m[1]) });
    c.take(V.MODAL);
  } else if (c.take(V.MODAL)) step.type = 'modal';
  if (c.take(V.KINEM)) step.type = 'kinematic';
  if (c.take(V.STATIC)) step.type = 'static';
  m = c.take(g(V.INCR) + '\\s*(?:수|count|number)?' + sep + NUM) || c.take(NUM + '\\s*' + g(V.INCR));
  if (m) step.increments = Math.round(+m[1]);
  m = c.take(g(V.IMPERF) + sep + NUM);
  if (m) step.imperfection = +m[1];
  m = c.take(g(V.LAMMAX) + sep + NUM + '\\s*(?:까지)?');
  if (m) step.lam_max = +m[1];
  if (Object.keys(step).length) ops.push({ op: 'set_step', ...step });

  const plotGate = R(g(V.PLOT)).test(c.w) && R([V.ENERGY, V.DISP, V.FORCEW, V.LAMW, '계수'].join('|')).test(c.w);
  const pairGate = R(g(V.DISP) + '\\s*[-–~/]\\s*(?:힘|하중|반력|에너지|force|load|reaction|energy)|(?:힘|하중|반력|에너지|force|load|reaction|energy)\\s*[-–~/]\\s*' + g(V.DISP)).test(c.w);
  if (plotGate || pairGate) {
    const p = parsePlot(c, geo, spec, ctx);
    if (p) {
      if (p._needSel) {
        info.ask = true;
        return { ops, msgs: [...msgs, tl('어느 점의 그래프인지 알려 주세요 (예: "59번 점 변위-힘 그래프" 또는 점을 고르고 "선택한 점 변위 보여줘")')] };
      }
      ops.push(p);
      return { ops, msgs: [...msgs, tl('그래프 추가: {v}', { v: p.title })] };
    }
  }

  const sym = c.take('(?<![a-z])([xyz])\\s*(?:축|axis)?\\s*(?:=\\s*' + NUM + ')?\\s*(?:평면|plane)?\\s*(?:에\\s*대해|기준)?\\s*' + g(V.SYM)) || c.take(g(V.SYM) + '\\s*(?:plane|condition|면)?\\s*(?:at|about|on|across)?\\s*([xyz])\\s*(?:=\\s*' + NUM + ')?(?![a-z])(?!\\s*(?:' + V.MINW + '|' + V.MAXW + '))');
  if (sym || c.has(V.SYM)) {
    let axis = sym ? sym[1] : null;
    c.take('대칭\\s*(?:면|조건|경계)?|미러|' + V.SYM);
    c.takeall('(?<![a-z])(?:plane|condition|at|about|on|across)(?![a-z])');
    const { sel } = selection(c, geo, spec, ctx);
    if (!axis && sel) {
      const ps = selPlanes(sel);
      if (ps.length) axis = ps[0].axis;
    }
    if (!axis) {
      info.ask = true;
      return { ops, msgs: [...msgs, tl('대칭면 축을 알려 주세요 (예: "x = 0 대칭", "x 최대 면 대칭")')] };
    }
    const op = { op: 'add_symmetry', axis };
    if (sym && sym[2] !== undefined) op.at = +sym[2];
    else if (sel) op.select = sel;
    ops.push(op);
    c.takeall('으로|로|설정|걸어|줘|해줘|추가');
    msgs.push(tl('{a} 대칭면을 추가했습니다 (그 평면 위 테두리 엣지에 미러 조건)', { a: axis }));
    return finish(c, ops, msgs, info);
  }

  const q = quantities(c);
  const qf = q.filter((x) => x.kind === 'force');
  const qp = q.filter((x) => x.kind === 'pressure');
  const ql = q.filter((x) => x.kind === 'length');
  const gravity = c.take(V.GRAVITY);
  const fixing = c.has(V.FIX) && !qf.length && !qp.length;
  const dofs = fixing ? bcDofs(c) : [];
  const isFix = c.take(V.FIX);
  const perNode = !!c.take(V.PERNODE);
  const pw = c.take(V.PRESSURE);
  const isPress = qp.length || pw;
  const local = !!c.take(V.LOCALP);
  let dir = direction(c);
  const { sel, notes } = selection(c, geo, spec, ctx);
  msgs.push(...notes);
  if (gravity) {
    const v = dir ? dir.vec.map((x) => x * G0) : [0, 0, -G0];
    ops.push({ op: 'add_load', type: 'gravity', vector: v });
    msgs.push(tl('자중 추가 (밀도 × 두께 × 면적, 패널마다 고정 방향 압력으로 분배)'));
    return finish(c, ops, msgs, info);
  }
  if (isPress) {
    let val = qp.length ? qp[0].value : bare(c);
    if (val === null) {
      info.ask = true;
      return { ops, msgs: [...msgs, tl('압력 크기를 단위와 함께 알려 주세요 (예: 0.001 MPa, 1 kPa)')] };
    }
    if (!sel) {
      info.ask = true;
      return { ops, msgs: [...msgs, tl('압력을 줄 면을 알려 주세요 (예: 윗면, 선택한 면, 전체 면)')] };
    }
    const op = { op: 'add_load', type: 'pressure', value: Math.abs(val), select: sel, mode: local || !dir ? 'local' : 'global' };
    if (op.mode === 'global') op.direction = dir.vec;
    if (op.mode === 'local' && val < 0) op.value = -Math.abs(val);
    ops.push(op);
    msgs.push(op.mode === 'local' ? tl('압력 {v} MPa · 면 법선 방향 (Local, 변형을 따라감) · {w}', { v: Math.abs(val), w: describe(sel) }) : tl('압력 {v} MPa · 고정 방향 [{d}] (Global, 처음 면적 기준) · {w}', { v: Math.abs(val), d: op.direction, w: describe(sel) }));
    return finish(c, ops, msgs, info);
  }
  if (qf.length) {
    if (!sel) {
      info.ask = true;
      return { ops, msgs: [...msgs, tl('하중을 줄 위치를 알려 주세요 (예: 59번 절점, 윗면, 선택한 절점)')] };
    }
    if (!dir) dir = looseAxis(c);
    if (!dir) {
      info.ask = true;
      return { ops, msgs: [...msgs, tl('하중 방향을 알려 주세요 (예: 아래로, z 방향, -y 방향)')] };
    }
    const val = qf[0].value;
    const v = dir.vec.map((x) => (dir.literal && qf[0].signed ? x * val : x * Math.abs(val)));
    ops.push({ op: 'add_load', type: 'force', vector: v, select: sel, ...(perNode ? { per_node: true } : {}) });
    msgs.push(tl('힘 [{v}] N {p} · {w}', { v: v.map((x) => +x.toPrecision(6)).join(', '), p: perNode ? tl('(절점마다)') : tl('(선택 절점에 나눠서, 합계)'), w: describe(sel) }));
    return finish(c, ops, msgs, info);
  }
  if (ql.length && sel && !isFix) {
    if (!dir) dir = looseAxis(c);
    if (!dir) {
      info.ask = true;
      return { ops, msgs: [...msgs, tl('강제 변위 방향을 알려 주세요 (예: y 방향으로 -30 mm, 아래로 5 mm)')] };
    }
    const a = dir.vec.findIndex((x) => x !== 0);
    let val = ql[0].value;
    val = dir.literal && ql[0].signed ? val * dir.vec[a] : Math.abs(val) * dir.vec[a];
    ops.push({ op: 'add_bc', select: sel, dofs: [a + 1], value: val, name: '강제 변위' });
    msgs.push(tl('강제 변위 u{a} = {v} mm · {w}', { a: AX[a], v: val, w: describe(sel) }));
    return finish(c, ops, msgs, info);
  }
  if (isFix) {
    if (!sel) {
      info.ask = true;
      return { ops, msgs: [...msgs, tl('구속할 위치를 알려 주세요 (예: 바닥, 8번 절점, 선택한 절점)')] };
    }
    let d = dofs;
    if (!d.length && dir) d = [dir.vec.findIndex((x) => x !== 0) + 1];
    if (!d.length) d = [1, 2, 3];
    ops.push({ op: 'add_bc', select: sel, dofs: d, type: d.length === 3 ? 'fixed' : undefined, name: d.length === 3 ? '고정' : '구속 ' + d.map((x) => 'u' + AX[x - 1]).join(',') });
    msgs.push(`${d.length === 3 ? tl('고정 (병진 3방향)') : tl('구속 {v}', { v: d.map((x) => 'u' + AX[x - 1]).join(', ') })} · ${describe(sel)}`);
    return finish(c, ops, msgs, info);
  }
  return finish(c, ops, msgs, info);
}

function finish(c, ops, msgs, info) {
  const lo = leftover(c);
  if (lo.length && !ops.length && !info.run) info.unknown = true;
  if (lo.length && ops.length) info.partial = (info.partial || []).concat(lo);
  return { ops, msgs };
}

export function parse(text, geo, spec, picked, ctx = {}) {
  const info = { complete: false, ask: false, unknown: false, run: false, undo: false, answered: false, view: null };
  const all = [];
  const msgs = [];
  for (const cl of splitClauses(text)) {
    const r = parseClause(cl, geo, spec, { ...ctx, picked }, info);
    all.push(...r.ops);
    msgs.push(...r.msgs);
    if (info.ask || info.undo) break;
  }
  info.complete = !info.unknown && !info.ask && (all.length > 0 || info.run || info.undo || info.answered);
  if (info.partial && info.partial.length) {
    info.unknown = true;
    info.complete = false;
    msgs.push(tl('이해하지 못한 부분: {v}', { v: info.partial.join(' ') }));
  }
  let reply = msgs.join(' · ');
  if (!all.length && !info.ask && !info.run && !info.undo && !info.answered) reply = reply || tl('이해하지 못했습니다. "도움말"을 입력하면 처리할 수 있는 문장 예시를 보여 드립니다.');
  if (info.run && !reply) reply = tl('해석을 실행합니다');
  return { ops: all, reply, info };
}
