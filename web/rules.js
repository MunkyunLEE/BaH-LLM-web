import { bbox, diagOf, resolve, describe } from './select.js';
import { edgeKey, panelEdges } from './geometry.js';

const NUM = '([-+]?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)';
const AX = 'xyz';
const G0 = 9806.65;

const UNITS = [
  ['density', 'kg\\s*/\\s*m\\s*(?:3|³|\\^3)', 1e-12],
  ['density', 'g\\s*/\\s*(?:cm\\s*(?:3|³|\\^3)|cc)', 1e-9],
  ['density', '(?:tonne|ton|t)\\s*/\\s*mm\\s*(?:3|³|\\^3)', 1.0],
  ['pressure', 'kn\\s*/\\s*m\\s*(?:2|²|\\^2)', 1e-3],
  ['pressure', 'n\\s*/\\s*mm\\s*(?:2|²|\\^2)', 1.0],
  ['pressure', 'n\\s*/\\s*m\\s*(?:2|²|\\^2)', 1e-6],
  ['pressure', 'gpa|기가\\s*파스칼', 1e3],
  ['pressure', 'mpa|메가\\s*파스칼', 1.0],
  ['pressure', 'kpa|킬로\\s*파스칼', 1e-3],
  ['pressure', 'pa(?![a-z])|파스칼', 1e-6],
  ['pressure', 'psi(?![a-z])', 0.00689476],
  ['pressure', 'atm(?![a-z])|기압', 0.101325],
  ['moment', 'n\\s*[·*.\\-]?\\s*mm\\s*/\\s*mm', 1.0],
  ['force', 'kn(?![a-z])|킬로\\s*뉴턴', 1e3],
  ['force', 'mn(?![a-z])|밀리\\s*뉴턴', 1e-3],
  ['force', 'kgf(?![a-z])|kg\\s*중', 9.80665],
  ['force', 'gf(?![a-z])', 0.00980665],
  ['force', 'n(?![a-z/·*])|뉴턴', 1.0],
  ['length', 'mm(?![a-z/²³23])|밀리미터|밀리(?![가-힣])', 1.0],
  ['length', 'cm(?![a-z/²³23])|센티미터|센티(?![가-힣])', 10.0],
  ['length', '(?:um|μm|µm)(?![a-z])|마이크로미터|미크론', 1e-3],
  ['length', 'inch(?:es)?|인치', 25.4],
  ['length', 'm(?![a-z0-9/²³])|미터', 1e3],
  ['angle', '°|deg(?:rees?)?(?![a-z])|도(?![가-힣])', 1],
  ['ratio', '%|퍼센트|프로(?![가-힣])', 0.01],
];

const MATERIALS = [
  ['스테인리스|스텐|sus\\s*\\d*|stainless', '스테인리스강', 193000, 0.29, 8.0e-9, 205],
  ['강철|스틸|연강|steel|강재', '강', 210000, 0.3, 7.85e-9, 250],
  ['알루미늄|알미늄|aluminium|aluminum|al\\s*6061', '알루미늄', 70000, 0.33, 2.7e-9, 250],
  ['구리|copper', '구리', 117000, 0.34, 8.96e-9, null],
  ['황동|brass', '황동', 100000, 0.34, 8.5e-9, null],
  ['티타늄|titanium', '티타늄', 110000, 0.34, 4.5e-9, null],
  ['종이|paper|판지|카드보드', '종이', 3000, 0.3, 0.8e-9, null],
  ['마일라|mylar|(?<![a-z])pet(?![a-z])|페트', 'PET(마일라)', 5000, 0.35, 1.38e-9, null],
  ['pp|폴리프로필렌|polypropylene', 'PP', 1500, 0.42, 0.9e-9, null],
  ['pe|폴리에틸렌|hdpe', 'PE', 1000, 0.42, 0.95e-9, null],
  ['아크릴|pmma', '아크릴', 3000, 0.37, 1.18e-9, null],
  ['pla(?![a-z])', 'PLA', 3500, 0.36, 1.25e-9, null],
  ['고무|rubber', '고무', 10, 0.49, 1.1e-9, null],
];

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

const FILLER = new RegExp(
  '^(?:' +
    [
      '켜', '꺼', '켜줘', '꺼줘', '켬', '끔', 'on', 'off', '보여줘', '보여', '밀어', '당겨', '눌러', '해\\s*주세요', '해\\s*줘', '해봐', '해라', '해요', '하자', '하고', '해서', '하면', '하는', '해', '주세요', '줘요', '줘', '주고', '걸어', '걸고', '가해', '넣어', '넣고', '적용', '추가', '설정', '부여', '입력', '지정', '바꿔', '변경', '수정', '으로', '에서', '에게', '부터', '까지', '이고', '이다', '좀', '이제', '우선', '먼저', '다음', '그리고', '또', '그냥', '다시', '모두', '전부', '전체', '모든', '총', '합계', '크기', '값', '만큼', '정도', '방향', '쪽', '측', '면', '변', '끝', '단', '부분', '위치', '지점', '곳', '절점', '노드', '엣지', '점', '선', '것', '하중', '힘', '구속', '조건', '경계', '해석', '모델', '구조', '형상', '재료', '요소', '을', '를', '이', '가', '은', '는', '에', '의', '로', '도', '만', '과', '와', '및', '들', '요', '다', '각', '마다', 'apply', 'add', 'set', 'the', 'to', 'at', 'on', 'of', 'in', 'a', 'and', 'please',
    ].join('|') +
    ')$'
);

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
  t = t.replace(/((?:절점|노드|node|점)\s*\d+)\s*(?:,|와|과|및)\s*(?=\d)/g, '$1\x01');
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
  let m = c.take('(음|양|마이너스|플러스|negative|positive)\\s*(?:의)?\\s*([xyz])\\s*(?:축)?\\s*(?:의)?\\s*(?:방향|direction)?(?:으로|로)?');
  if (m) {
    const v = [0, 0, 0];
    v[AX.indexOf(m[2])] = ['음', '마이너스', 'negative'].includes(m[1]) ? -1 : 1;
    return { vec: v, literal: true };
  }
  m = c.take('([-+]?)\\s*([xyz])\\s*(?:축)?\\s*(?:의)?\\s*(음|양|마이너스|플러스|-|\\+)?\\s*(?:의)?\\s*(?:방향|direction|쪽으로|축으로)(?:으로|로)?');
  if (m) {
    const v = [0, 0, 0];
    const neg = (m[1] === '-') !== ['음', '마이너스', '-'].includes(m[3]);
    v[AX.indexOf(m[2])] = neg ? -1 : 1;
    return { vec: v, literal: true };
  }
  m = c.take('(?<![a-z])(?:in|along)\\s+([-+]?)([xyz])(?![a-z])');
  if (m) {
    const v = [0, 0, 0];
    v[AX.indexOf(m[2])] = m[1] === '-' ? -1 : 1;
    return { vec: v, literal: true };
  }
  const words = [
    ['아래\\s*로|아래\\s*방향(?:으로)?|하방(?:으로)?|하향(?:으로)?|밑으로|downwards?|down(?![a-z])|누르', [0, 0, -1]],
    ['위\\s*로|위\\s*방향(?:으로)?|상방(?:으로)?|상향(?:으로)?|upwards?|(?<![a-z])up(?![a-z])|들어\\s*올', [0, 0, 1]],
    ['왼쪽\\s*으로|좌측\\s*으로|leftwards?', [-1, 0, 0]],
    ['오른쪽\\s*으로|우측\\s*으로|rightwards?', [1, 0, 0]],
  ];
  for (const [p, v] of words) if (c.take(p)) return { vec: v, literal: false };
  return null;
}

function looseAxis(c) {
  const m = c.take('(?<![a-z\\d])([-+]?)\\s*([xyz])(?![a-z\\d])');
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
  const m = c.take('(?:(?:절점|노드|node|점|포인트|point)\\s*(?:번호|id)?\\s*#?\\s*((?:\\d+\\s*(?:,|와|과|및|and)?\\s*)+)(?:번)?(?:\\s*(?:절점|노드|점))?)|(?:#\\s*((?:\\d+\\s*(?:,|와|과|및)?\\s*#?\\s*)+))|(?:((?:\\d+\\s*(?:,|와|과|및)?\\s*)+)\\s*번\\s*(?:절점|노드|점|node|point)?)');
  if (!m) return null;
  const ids = (m[1] || m[2] || m[3]).match(/\d+/g).map((x) => +x - 1);
  if (ids.every((i) => i >= 0 && i < geo.nodes.length)) return { nodes: ids };
  notes.push(`절점 번호는 1~${geo.nodes.length} 범위여야 합니다`);
  return null;
}

export function selection(c, geo, spec, ctx) {
  const [lo, hi] = bbox(geo.nodes);
  const span = diagOf(geo.nodes);
  const planes = [];
  const others = [];
  const notes = [];
  if (c.take('(?:화면\\s*(?:에서)?\\s*)?(?:선택(?:한|된|해\\s*둔)|고른|picked|selected)\\s*(?:절점|노드|점|곳|부분|영역|선|엣지|면|nodes?|points?|edges?)?(?:들)?')) {
    if (ctx.picked) return { sel: ctx.picked, notes };
    notes.push('화면에서 선택한 절점·선이 없습니다 (클릭, Shift+클릭, Shift+드래그로 고르세요)');
  }
  let m = c.take('(?:좌표|점|절점|위치|node|point)?\\s*\\(\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*\\)\\s*(?:mm)?\\s*(?:근처|부근|주변|에\\s*가장\\s*가까운)?');
  if (m) others.push({ nearest: [+m[1], +m[2], +m[3]] });
  const nid = nodeIds(c, geo, notes);
  if (nid) others.push(nid);
  for (const q of c.takeall('([xyz])\\s*(?:좌표)?\\s*(?:가|이|는)?\\s*' + NUM + '\\s*(?:mm)?\\s*(?:~|에서|부터)\\s*' + NUM + '\\s*(?:mm)?\\s*(?:사이|구간|범위|까지)?(?:인|의)?')) {
    const a = AX.indexOf(q[1]);
    const b0 = lo.map((v) => v - span), b1 = hi.map((v) => v + span);
    [b0[a], b1[a]] = [Math.min(+q[2], +q[3]), Math.max(+q[2], +q[3])];
    others.push({ box: { min: b0, max: b1 } });
  }
  for (const q of c.takeall('([-+])\\s*([xyz])\\s*(?:쪽|측)?\\s*(?:면|끝단|끝|변|단|엣지|모서리|side|face|end|edge)')) planes.push([q[2], q[1] === '+' ? 'max' : 'min']);
  for (const q of c.takeall('(?<![a-z])([xyz])\\s*(?:좌표)?\\s*(?:축|방향)?\\s*(?:가|이|의|=|:)?\\s*(최소|최대|최솟값|최댓값|가장\\s*작은|가장\\s*큰|제일\\s*작은|제일\\s*큰|min(?:imum)?|max(?:imum)?|중간|mid(?:dle)?|중앙)(?:값)?(?:인|이\\s*되는)?')) {
    const w = q[2];
    planes.push([q[1], /^(최소|최솟|가장\s*작|제일\s*작|min)/.test(w) ? 'min' : /^(최대|최댓|가장\s*큰|제일\s*큰|max)/.test(w) ? 'max' : 'mid']);
  }
  for (const q of c.takeall('(?<![a-z])(min(?:imum)?|max(?:imum)?)\\s*([xyz])(?![a-z])')) planes.push([q[2], q[1].startsWith('min') ? 'min' : 'max']);
  for (const q of c.takeall('(?<![a-z])([xyz])\\s*(?:좌표)?\\s*(?:=|가|이)\\s*' + NUM + '\\s*(?:mm)?\\s*(?:인|위치|지점|평면|단면|에서)?')) planes.push([q[1], +q[2]]);
  const ext = hi.map((v, k) => v - lo[k]);
  const L = AX[ext.indexOf(Math.max(...ext))];
  const V = ext[2] > 1e-6 * span ? 'z' : 'y';
  m = c.take('(?<![a-z])([xyz])\\s*(?:축|방향)?\\s*(?:의)?\\s*(?:양단|양\\s*끝단|양\\s*끝|양쪽\\s*끝|양쪽|both ends)');
  if (m) others.push({ or: [plane(m[1], 'min'), plane(m[1], 'max')] });
  else if (c.take('양단|양\\s*끝단|양\\s*끝|양쪽\\s*끝|양쪽\\s*변|양쪽|both ends')) others.push({ or: [plane(L, 'min'), plane(L, 'max')] });
  if (c.take('반대\\s*쪽|반대\\s*편|맞은\\s*편|다른\\s*쪽\\s*끝|opposite')) {
    const ref = fixedPlane(spec);
    if (ref) planes.push([ref.axis, ref.at === 'min' ? 'max' : 'min']);
    else notes.push("'반대쪽'의 기준이 되는 고정 구속이 없습니다");
  }
  if (c.take('자유\\s*단|선\\s*단|자유\\s*끝|free end|(?<![a-z])tip(?![a-z])')) {
    const ref = fixedPlane(spec, L) || fixedPlane(spec);
    planes.push(ref ? [ref.axis, ref.at === 'min' ? 'max' : 'min'] : [L, 'max']);
  }
  const words = [
    ['바닥\\s*면|바닥|하단|하부|아랫\\s*면|아래\\s*쪽|밑\\s*면|맨\\s*아래|bottom|아래(?!로|\\s*방향|\\s*$)', V, 'min'],
    ['상단|상부|윗\\s*면|위\\s*쪽|위\\s*면|꼭대기|맨\\s*위|top(?![a-z])|(?<![가-힣])위(?=\\s+\\S|에|를|는|은|의|쪽)', V, 'max'],
    ['왼\\s*쪽|좌측|좌단|left(?![a-z])', 'x', 'min'],
    ['오른\\s*쪽|우측|우단|right(?![a-z])', 'x', 'max'],
    ['앞\\s*쪽|앞\\s*면|전면|front(?![a-z])', 'y', 'min'],
    ['뒤\\s*쪽|뒷\\s*면|후면|back(?![a-z])', 'y', 'max'],
  ];
  for (const [p, ax, at] of words) if (c.take(p)) planes.push([ax, at]);
  if (c.take('네\\s*변|모든\\s*변|둘레|테두리|가장자리|외곽|자유\\s*(?:엣지|변)|경계\\s*(?:엣지|변|선)|perimeter|outer edges?|free edges?')) others.push({ boundary: true });
  if (c.take('네\\s*(?:모서리|꼭짓점|코너)|꼭짓점들?|꼭지점들?|귀퉁이|코너|corners?')) others.push({ corners: true });
  m = c.take('(정\\s*중앙|중앙|가운데|중심|center|centre|middle)\\s*(단면|선|line|section)?');
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
    if (c.take('모든\\s*(?:절점|면|패널)|전체\\s*(?:절점|면|패널)?|모델\\s*전체|all nodes|all faces|everything|whole')) return { sel: { all: true }, notes };
    return { sel: null, notes };
  }
  return { sel: items.length === 1 ? items[0] : { and: items }, notes };
}

function bcDofs(c) {
  const d = new Set();
  for (const m of c.takeall('(?<![a-z])u\\s*([xyz123])(?![a-z0-9])')) d.add(AX.includes(m[1]) ? AX.indexOf(m[1]) + 1 : +m[1]);
  for (const m of c.takeall('(?<![a-z])((?:[xyz]\\s*(?:,|와|과|및|랑|and|/|·)?\\s*){1,3})(?:축\\s*)?(?:의\\s*)?(?:방향|변위|병진|이동|direction|translations?)(?:\\s*(?:변위|병진|이동))?(?:으로|로)?(?:만)?')) for (const ch of m[1].match(/[xyz]/g)) d.add(AX.indexOf(ch) + 1);
  for (const m of c.takeall('(?<![a-z])((?:[xyz]\\s*(?:,|와|과|및|랑|/|·)?\\s*){1,3})(?=\\s*(?:축)?\\s*(?:만|은|는|을|를)?\\s*(?:구속|고정|지지|막|잡|constrain|fix|restrain))')) for (const ch of m[1].match(/[xyz]/g)) d.add(AX.indexOf(ch) + 1);
  return [...d].sort();
}

function scaleWord(c) {
  let m = c.take(NUM + '\\s*배(?:로)?');
  if (m) return +m[1];
  if (c.take('두\\s*배(?:로)?|twice|double')) return 2;
  if (c.take('세\\s*배(?:로)?|triple')) return 3;
  if (c.take('열\\s*배(?:로)?')) return 10;
  if (c.take('절반(?:으로)?|반\\s*으로|half')) return 0.5;
  return null;
}

const HELP =
  "이런 문장을 바로 처리합니다. 구속: '바닥 고정', '8번 절점 고정', '2번 절점 y, z 구속', 'x 최소 변을 z 방향만 구속', 'x = 0 대칭'. " +
  "하중: '59번 절점에 아래로 1 N', '선택한 절점마다 z -0.5 N', '윗면에 압력 0.001 MPa 아래로', '선택한 면에 수직으로 압력 1 kPa', '자중'. " +
  "강제 변위: '59번 절점을 y 방향으로 -30 mm'. 재료: 'E 1000', '포아송 0.3', '두께 0.25', '종이로'. " +
  "모델: 'N4B5 로', 'L* 30 mm', '접촉 켜', '소성 힌지 켜', '반복 3회', 'MERLIN2 호환'. 주름: '선택한 엣지를 휨으로'. " +
  "해석: '호장법으로', '모드 6개', '증분 200', '해석 실행'. 스케일: '전체 크기 2배', 'm 단위를 mm 로', '변형 10배로 보여줘'. " +
  "결과: '59번 점 변위 보여줘', '59번 점 변위-힘 그래프', '59번 점 변위-에너지', '접힘 에너지 그래프', '최대 반력 얼마?'. 수정: 'ld1 2배', 'bc2 삭제', '되돌려'.";

function parsePlot(c, geo, spec, ctx) {
  const t = c.w;
  const ld = /변위\s*[-–~/]?\s*(?:힘|하중|반력)|(?:힘|하중|반력)\s*[-–~/]\s*변위|force\s*-?\s*disp|load\s*-?\s*disp/.test(t);
  const de = /변위\s*[-–~/]?\s*에너지|에너지\s*[-–~/]\s*변위|energy\s*-?\s*disp/.test(t);
  const axm = t.match(/(?<![a-z])([xyz])\s*(?:축|방향)?\s*(?:의)?\s*(?:변위|처짐|displacement)/) || t.match(/(?:변위|displacement)\s*([xyz])(?![a-z])/);
  const cc = new Clause(t);
  for (const p of ['그래프|플롯|plot|graph|그려|곡선|curve|이력|history|보여|차트|chart', '스텝|step|증분']) cc.takeall(p);
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
    if (!sel) {
      return { op: 'add_plot', title: '변위-힘 (하중점)', x: { quantity: 'step' }, series: [{ quantity: 'force' }], _needSel: true };
    }
    const a = axisFor();
    return { op: 'add_plot', title: `${who} 변위 u${a} - 힘 F${a}`, x: { quantity: 'u' + a, select: sel }, series: [{ quantity: 'force.' + a, select: sel }] };
  }
  if (de) {
    if (!sel) return { op: 'add_plot', title: '변위-에너지', x: { quantity: 'step' }, series: [{ quantity: 'energy.total' }], _needSel: true };
    const a = axisFor();
    return { op: 'add_plot', title: `${who} 변위 u${a} - 에너지`, x: { quantity: 'u' + a, select: sel }, series: ['energy.total', 'energy.bar', 'energy.fold', 'energy.bend'].map((q) => ({ quantity: q })) };
  }
  const series = [];
  if (/에너지|energy/.test(t)) {
    let hit = false;
    for (const [p, k] of [['접힘|폴딩|fold', 'energy.fold'], ['바\\s*에너지|(?<![a-z])bar(?![a-z])|늘림|신장|stretch', 'energy.bar'], ['휨|굽힘|bend', 'energy.bend'], ['소성|plastic', 'energy.plastic'], ['접촉|contact', 'energy.contact'], ['외부\\s*일|external', 'energy.external']])
      if (new RegExp(p).test(t)) {
        series.push({ quantity: k });
        hit = true;
      }
    if (!hit || /총|전체|토탈|total/.test(t)) series.unshift({ quantity: 'energy.total' });
  }
  if (/반력|reaction|절점\s*힘|(?<![가-힣])힘(?![가-힣])/.test(t) && sel) series.push({ quantity: 'force.' + axisFor(), select: sel });
  if (/하중\s*계수|λ|lambda/.test(t)) series.push({ quantity: 'lam' });
  if (/변위|처짐|displacement|deflection/.test(t)) {
    if (!sel) return { op: 'add_plot', title: '변위', x: { quantity: 'step' }, series: [{ quantity: 'lam' }], _needSel: true };
    if (axm) series.push({ quantity: 'u' + axm[1], select: sel });
    else for (const a of 'xyz') series.push({ quantity: 'u' + a, select: sel, name: `u${a} (${who}, mm)` });
  }
  if (!series.length) return null;
  const title = (sel ? who + ' ' : '') + (series.some((s) => s.quantity.startsWith('u')) ? '스텝-변위' : series.some((s) => s.quantity.startsWith('energy')) ? '스텝-에너지' : '스텝-값');
  return { op: 'add_plot', title, x: { quantity: 'step' }, series };
}

function answer(c, ctx, geo) {
  const r = ctx.result;
  const t = c.w;
  if (!/얼마|몇|최대|최소|알려|\?|what|how much/.test(t)) return null;
  if (!r) return '아직 해석 결과가 없습니다. "해석 실행" 후 물어보세요.';
  const s = r.meta.summary;
  const out = [];
  if (r.kind === 'static') {
    if (/반력|하중|힘|force|load/.test(t)) out.push(`최대 반력/하중 ${(+s['최대 반력/하중 (N)']).toPrecision(5)} N`);
    if (/변위|처짐|disp/.test(t)) out.push(`최대 변위 ${(+s['최대 변위 (mm)']).toPrecision(5)} mm`);
    if (/에너지|energy/.test(t)) {
      const e = s['바 / 접힘 / 휨 에너지 (N·mm)'];
      out.push(`최종 에너지 바 ${(+e[0]).toPrecision(4)} · 접힘 ${(+e[1]).toPrecision(4)} · 휨 ${(+e[2]).toPrecision(4)} N·mm`);
    }
    if (/λ|하중\s*계수|lambda/.test(t) && s['최종 하중 계수 λ'] !== undefined) out.push(`최종 하중 계수 λ = ${(+s['최종 하중 계수 λ']).toPrecision(5)}`);
  } else if (r.kind === 'modal') {
    const m = t.match(/(\d+)\s*(?:차|번째)/);
    const f = r.result.freq || [];
    if (m && f[+m[1] - 1] !== undefined) out.push(`${m[1]}차 고유진동수 ${(+f[+m[1] - 1]).toPrecision(5)} Hz`);
    else if (f.length) out.push(`고유진동수 ${f.slice(0, 6).map((v) => (+v).toPrecision(4)).join(', ')} Hz`);
  } else if (r.kind === 'kinematic') out.push(`기구 자유도 ${r.result.mechanisms}`);
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

function parseClause(text, geo, spec, ctx, info) {
  const c = new Clause(text);
  const ops = [];
  const msgs = [];
  if (c.take('되돌려|되돌리|취소|원래대로|undo')) {
    info.undo = true;
    return { ops, msgs: [] };
  }
  if (c.take('도움말|help|뭐\\s*할\\s*수|사용법|예시')) {
    info.answered = true;
    return { ops, msgs: [HELP] };
  }
  const ans = /얼마|몇\s*(?:n|mm|hz)|알려\s*줘|\?/.test(c.w) && !/그래프|플롯|보여/.test(c.w) ? answer(new Clause(c.w), ctx, geo) : null;
  if (ans) {
    info.answered = true;
    return { ops, msgs: [ans] };
  }
  if (c.take('해석\\s*(?:을)?\\s*(?:실행|시작|돌려|해)|(?:실행|돌려|계산)\\s*(?:해|시작)|(?<![a-z])run(?![a-z])|solve')) info.run = true;
  for (const m of c.takeall('(?<![a-z])((?:bc|ld|pl|sy)\\d+)\\s*(?:을|를)?\\s*(?:삭제|지워|없애|빼|제거|remove|delete)')) ops.push({ op: 'remove', id: m[1] });
  let m = c.take('(?<![a-z])((?:bc|ld)\\d+)\\s*(?:을|를)?\\s*' + NUM + '\\s*배');
  if (m) ops.push({ op: 'update', id: m[1], scale: +m[2] });
  m = c.take('(구속|하중|그래프|대칭|주름)\\s*(?:을|를)?\\s*(?:모두|전부|다)?\\s*(?:삭제|지워|초기화|없애)|(?:모두|전부|다)\\s*(?:지워|삭제|초기화)');
  if (m) ops.push({ op: 'clear', what: { 구속: 'bcs', 하중: 'loads', 그래프: 'plots', 대칭: 'symmetry', 주름: 'creases' }[m[1]] || 'all' });
  if (ops.length) return { ops, msgs };

  m = c.take('(?:변형|deform(?:ation)?)\\s*(?:배율|스케일|scale)?\\s*(?:을|를)?\\s*' + NUM + '\\s*배?') || (c.has('변형') && c.has('보여') ? c.take(NUM + '\\s*배') : null);
  if (m) {
    info.view = { scale: +m[1] };
    ops.push({ op: 'set_view', scale: +m[1] });
    return { ops, msgs: [`변형 배율 ${m[1]}배로 표시합니다`] };
  }
  if (c.has('대칭') && c.has('표시|보여|그려|미러|mirror') && !c.has('[xyz]\\s*(?:=|축|평면|대칭)')) {
    const on = !c.has('끄|꺼|숨|off|없애');
    info.view = { mirror: on };
    ops.push({ op: 'set_view', mirror: on });
    return { ops, msgs: [`대칭 표시 ${on ? '켬' : '끔'}`] };
  }
  m = c.take('(?<![a-z])(m|cm|inch|인치|미터|센티)\\s*(?:단위)?\\s*(?:를|을|에서)?\\s*(?:→|->)?\\s*(?:mm|밀리)\\s*(?:단위)?(?:로|으로)?');
  if (m) {
    const f = { m: 1000, 미터: 1000, cm: 10, 센티: 10, inch: 25.4, 인치: 25.4 }[m[1]];
    ops.push({ op: 'scale_geometry', factor: f });
    return { ops, msgs: [`형상 좌표를 ${f}배 (${m[1]} → mm) 했습니다. 두께·하중은 그대로입니다`] };
  }
  if (c.has('(?:전체|모델|형상|지오메트리|geometry|model|크기|스케일|사이즈|치수)') && c.has('배|scale|키워|줄여|확대|축소') && !c.has('변형')) {
    let f = scaleWord(c);
    if (f === null) {
      const mm = c.take(NUM);
      f = mm ? +mm[1] : null;
    }
    if (c.has('줄여|축소') && f > 1) f = 1 / f;
    if (f) {
      ops.push({ op: 'scale_geometry', factor: f });
      return { ops, msgs: [`형상 전체를 ${f}배 했습니다 (구속·하중 위치와 강제 변위도 같은 배율, 두께는 그대로)`] };
    }
  }

  const mat = {};
  for (const [pat, name, E, nu, rho, fy] of MATERIALS)
    if (c.take('(?<![a-z가-힣])(?:' + pat + ')(?![a-z])')) {
      Object.assign(mat, { E, nu, rho });
      if (fy) mat.yield = fy;
      msgs.push(`재료 ${name} (E ${E} MPa, ν ${nu})`);
      c.take('재료|재질|으로|로');
      break;
    }
  m = c.take('(?:탄성\\s*계수|영\\s*률|young|(?<![a-z])e)\\s*(?:을|를|는|=|:)?\\s*' + NUM + '\\s*(gpa|mpa)?');
  if (m) mat.E = +m[1] * (m[2] === 'gpa' ? 1000 : 1);
  m = c.take('(?:포아송\\s*비?|푸아송\\s*비?|poisson|ν|nu)\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) mat.nu = +m[1];
  m = c.take('(?:밀도|density|ρ|rho)\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) mat.rho = +m[1];
  m = c.take('(?:항복\\s*(?:응력|강도)?|yield)\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) mat.yield = +m[1];
  if (c.take('항복\\s*(?:응력)?\\s*(?:을|를)?\\s*(?:없애|빼|지워|삭제)|탄성\\s*바')) mat.yield = null;
  m = c.take('(?:두께|thickness|(?<![a-z])t)\\s*(?:을|를|는|=|:)?\\s*' + NUM + '\\s*(?:mm)?');
  if (m) mat.thickness = +m[1];
  if (Object.keys(mat).length) {
    ops.push({ op: 'set_material', ...mat });
    c.takeall('재료|재질|물성|으로|로|바꿔|설정');
  }

  const bh = {};
  if (c.take('n\\s*4\\s*b\\s*5')) bh.model = 'N4B5';
  if (c.take('n\\s*5\\s*b\\s*8')) bh.model = 'N5B8';
  if (bh.model === 'N4B5' && !(spec.bh.fold_k || spec.bh.bend_k)) msgs.push('N4B5 는 MERLIN2 처럼 강성을 직접 넣는 방식입니다 (기본 Kb 0.1, Kf 0.01, 바 면적 0.1)');
  m = c.take('(?:l\\s*\\*|l\\s*star|길이\\s*척도)\\s*(?:/\\s*l\\s*_?\\s*f)\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) Object.assign(bh, { Lstar_ratio: +m[1], Lstar: null });
  else {
    m = c.take('(?:l\\s*\\*|l\\s*star|길이\\s*척도)\\s*(?:을|를|는|=|:)?\\s*' + NUM + '\\s*(?:mm)?');
    if (m) bh.Lstar = +m[1];
  }
  if (c.take('(?:l\\s*\\*|l\\s*star)\\s*(?:을|를)?\\s*자동')) Object.assign(bh, { Lstar: null });
  m = c.take('(?:접힘|폴딩|fold)\\s*강성\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) Object.assign(bh, { fold_k: +m[1], calib: 'manual' });
  m = c.take('(?:휨|굽힘|bend)\\s*강성\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) Object.assign(bh, { bend_k: +m[1], calib: 'manual' });
  m = c.take('(?:바|bar)\\s*(?:단면적|면적)\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) Object.assign(bh, { bar_area: +m[1], calib: 'manual' });
  if (c.take('강성\\s*(?:을|를)?\\s*자동|merlin\\s*2?\\s*자동|auto\\s*calib')) Object.assign(bh, { calib: 'auto', fold_k: null, bend_k: null, bar_area: null });
  if (c.take('접촉\\s*(?:을|를)?\\s*(?:꺼|끄|해제|없애|빼)|contact\\s*off')) bh.contact = false;
  else if (c.take('(?:기하\\s*)?접촉|contact|관통\\s*방지|충돌')) bh.contact = true;
  m = c.take('(?:접촉\\s*)?간격\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) bh.gap = +m[1];
  if (c.take('소성\\s*힌지\\s*(?:를|을)?\\s*(?:꺼|끄|해제|빼|없애)|탄성\\s*힌지')) bh.plastic_hinge = false;
  else if (c.take('소성\\s*힌지|plastic\\s*hinge')) bh.plastic_hinge = true;
  m = c.take('(?:반복|cyclic|왕복)\\s*(?:하중)?\\s*' + NUM + '\\s*(?:회|번|cycles?)') || c.take(NUM + '\\s*(?:회|번)\\s*(?:반복|왕복)');
  if (m) bh.cycles = Math.round(+m[1]);
  if (c.take('반복\\s*(?:하중)?\\s*(?:을|를)?\\s*(?:끄|꺼|없애|해제|빼)|단조')) Object.assign(bh, { cycles: 0, cycle_back: 0 });
  m = c.take('(?:반대\\s*(?:방향)?으로|되돌림)\\s*' + NUM + '\\s*(?:mm)?');
  if (m) bh.cycle_back = Math.abs(+m[1]);
  if (c.take('merlin\\s*2?\\s*(?:호환|그대로|원본)|compat')) bh.compat = true;
  if (c.take('호환\\s*(?:모드)?\\s*(?:를|을)?\\s*(?:꺼|끄|해제)')) bh.compat = false;
  if (c.take('woodruff')) bh.tri_bars = 'woodruff';
  if (c.take('khawale|키리가미\\s*(?:식|강성)')) Object.assign(bh, { tri_bars: 'khawale', edge_bend: 'khawale' });
  if (c.take('merlin\\s*2?\\s*(?:식|면적)')) bh.tri_bars = 'merlin2';
  if (c.take('질량\\s*(?:없이|빼|제외)|k\\s*만으로')) bh.use_mass = false;
  else if (c.take('질량\\s*(?:포함|넣)')) bh.use_mass = true;
  m = c.take('(?:판정\\s*각|자동\\s*판정)\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) bh.tol = +m[1];
  if (Object.keys(bh).length) ops.push({ op: 'set_bh', ...bh });

  const allE = c.take('(?:모든|전체)\\s*(?:내부\\s*)?(?:엣지|주름|선|변)\\s*(?:을|를|은|는)?\\s*(접힘|폴드|fold|휨|굽힘|벤딩|bend|자동|auto)');
  if (allE) {
    const ty = /접힘|폴드|fold/.test(allE[1]) ? 'fold' : /휨|굽힘|벤딩|bend/.test(allE[1]) ? 'bend' : 'auto';
    ops.push({ op: 'set_crease', edges: 'all', type: ty });
    c.takeall('으로|로|바꿔|변경|설정|해줘|줘');
  }
  m = c.take('(선택(?:한|된)?\\s*(?:엣지|주름|선|변|힌지)?|이\\s*(?:엣지|주름))\\s*(?:을|를|은|는)?\\s*(접힘|폴드|fold|휨|굽힘|벤딩|bend|자름|절단|컷|cut|자동|auto)');
  if (m) {
    const ty = /접힘|폴드|fold/.test(m[2]) ? 'fold' : /휨|굽힘|벤딩|bend/.test(m[2]) ? 'bend' : /자름|절단|컷|cut/.test(m[2]) ? 'cut' : 'auto';
    const es = selectedEdges(geo, ctx);
    if (!es.length) {
      info.ask = true;
      return { ops, msgs: [...msgs, '바꿀 엣지가 선택되어 있지 않습니다. 주름 편집 모드나 Shift+클릭으로 엣지를 고르세요'] };
    }
    ops.push({ op: 'set_crease', edges: es, type: ty });
    c.takeall('으로|로|바꿔|변경|설정|해줘|줘');
  }

  const step = {};
  if (c.take('호장법|arc\\s*-?\\s*length|mgdcm|변위\\s*제어\\s*호장|경로\\s*추적')) step.type = 'arclength';
  m = c.take('(?:고유|모드|모달|진동)\\s*(?:해석|모드)?\\s*' + NUM + '\\s*(?:개|차)') || c.take(NUM + '\\s*(?:개|차)\\s*(?:모드|고유)');
  if (m) Object.assign(step, { type: 'modal', modes: Math.round(+m[1]) });
  else if (c.take('모달|고유\\s*진동|고유\\s*모드|modal|free\\s*-?\\s*free|자유\\s*진동')) step.type = 'modal';
  if (c.take('기구\\s*(?:해석)?|강체\\s*접힘|kinematic|운동학')) step.type = 'kinematic';
  if (c.take('(?:정적|static)\\s*(?:해석)?')) step.type = 'static';
  m = c.take('(?:증분|스텝|increments?|steps?)\\s*(?:수)?\\s*(?:을|를|는|=|:)?\\s*' + NUM) || c.take(NUM + '\\s*(?:증분|스텝)');
  if (m) step.increments = Math.round(+m[1]);
  m = c.take('(?:초기\\s*결함|imperfection)\\s*(?:을|를|는|=|:)?\\s*' + NUM);
  if (m) step.imperfection = +m[1];
  m = c.take('(?:목표\\s*)?(?:하중\\s*계수|λ|lambda)\\s*(?:을|를|는|=|:)?\\s*' + NUM + '\\s*(?:까지)?');
  if (m) step.lam_max = +m[1];
  if (Object.keys(step).length) ops.push({ op: 'set_step', ...step });

  if ((/그래프|플롯|plot|graph|그려|곡선|curve|보여|차트|chart/.test(c.w) && /에너지|변위|힘|하중|반력|처짐|energy|disp|force|λ|계수/.test(c.w)) || /변위\s*[-–~/]\s*(?:힘|하중|반력|에너지)|(?:힘|하중|반력|에너지)\s*[-–~/]\s*변위/.test(c.w)) {
    const p = parsePlot(c, geo, spec, ctx);
    if (p) {
      if (p._needSel) {
        info.ask = true;
        return { ops, msgs: [...msgs, '어느 점의 그래프인지 알려 주세요 (예: "59번 점 변위-힘 그래프" 또는 점을 고르고 "선택한 점 변위 보여줘")'] };
      }
      ops.push(p);
      return { ops, msgs: [...msgs, `그래프 추가: ${p.title}`] };
    }
  }

  const sym = c.take('(?<![a-z])([xyz])\\s*(?:축)?\\s*(?:=\\s*' + NUM + ')?\\s*(?:평면)?\\s*(?:에\\s*대해|기준)?\\s*(?:대칭|미러|mirror|symm)');
  if (sym || c.has('대칭|미러|mirror|symmetr')) {
    let axis = sym ? sym[1] : null;
    c.take('대칭\\s*(?:면|조건|경계)?|미러|mirror');
    const { sel } = selection(c, geo, spec, ctx);
    if (!axis && sel) {
      const ps = selPlanes(sel);
      if (ps.length) axis = ps[0].axis;
    }
    if (!axis) {
      info.ask = true;
      return { ops, msgs: [...msgs, '대칭면 축을 알려 주세요 (예: "x = 0 대칭", "x 최대 면 대칭")'] };
    }
    const op = { op: 'add_symmetry', axis };
    if (sym && sym[2] !== undefined) op.at = +sym[2];
    else if (sel) op.select = sel;
    ops.push(op);
    c.takeall('으로|로|설정|걸어|줘|해줘|추가');
    msgs.push(`${axis} 대칭면을 추가했습니다 (그 평면 위 테두리 엣지에 미러 조건)`);
    return finish(c, ops, msgs, info);
  }

  const q = quantities(c);
  const qf = q.filter((x) => x.kind === 'force');
  const qp = q.filter((x) => x.kind === 'pressure');
  const ql = q.filter((x) => x.kind === 'length');
  const gravity = c.take('자중|자체\\s*중량|중력|self\\s*-?\\s*weight|gravity');
  const fixPat = '고정|구속|지지|막아|막고|잡아|핀\\s*(?:지지|지점)?|pin(?:ned)?|fix(?:ed)?|clamp|constrain|support';
  const fixing = c.has(fixPat) && !qf.length && !qp.length;
  const dofs = fixing ? bcDofs(c) : [];
  const isFix = c.take(fixPat);
  const perNode = !!c.take('(?:각\\s*)?절점\\s*마다|각\\s*절점(?:에)?|절점\\s*당|per\\s*node|each\\s*node|마다');
  const pw = c.take('압력|pressure|분포\\s*하중|수압|공기압');
  const isPress = qp.length || pw;
  const local = !!c.take('수직(?:으로|하게)?|법선(?:\\s*방향)?(?:으로)?|팔로워|follower|local|면\\s*방향|안쪽으로|바깥쪽으로');
  let dir = direction(c);
  const { sel, notes } = selection(c, geo, spec, ctx);
  msgs.push(...notes);
  if (gravity) {
    const v = dir ? dir.vec.map((x) => x * G0) : [0, 0, -G0];
    ops.push({ op: 'add_load', type: 'gravity', vector: v });
    msgs.push('자중 추가 (밀도 × 두께 × 면적, 패널마다 고정 방향 압력으로 분배)');
    return finish(c, ops, msgs, info);
  }
  if (isPress) {
    let val = qp.length ? qp[0].value : bare(c);
    if (val === null) {
      info.ask = true;
      return { ops, msgs: [...msgs, '압력 크기를 단위와 함께 알려 주세요 (예: 0.001 MPa, 1 kPa)'] };
    }
    if (!sel) {
      info.ask = true;
      return { ops, msgs: [...msgs, '압력을 줄 면을 알려 주세요 (예: 윗면, 선택한 면, 전체 면)'] };
    }
    const op = { op: 'add_load', type: 'pressure', value: Math.abs(val), select: sel, mode: local || !dir ? 'local' : 'global' };
    if (op.mode === 'global') op.direction = dir.vec;
    if (op.mode === 'local' && val < 0) op.value = -Math.abs(val);
    ops.push(op);
    msgs.push(op.mode === 'local' ? `압력 ${Math.abs(val)} MPa · 면 법선 방향 (Local, 변형을 따라감) · ${describe(sel)}` : `압력 ${Math.abs(val)} MPa · 고정 방향 [${op.direction}] (Global, 처음 면적 기준) · ${describe(sel)}`);
    return finish(c, ops, msgs, info);
  }
  if (qf.length) {
    if (!sel) {
      info.ask = true;
      return { ops, msgs: [...msgs, '하중을 줄 위치를 알려 주세요 (예: 59번 절점, 윗면, 선택한 절점)'] };
    }
    if (!dir) dir = looseAxis(c);
    if (!dir) {
      info.ask = true;
      return { ops, msgs: [...msgs, '하중 방향을 알려 주세요 (예: 아래로, z 방향, -y 방향)'] };
    }
    const val = qf[0].value;
    const v = dir.vec.map((x) => (dir.literal && qf[0].signed ? x * val : x * Math.abs(val)));
    ops.push({ op: 'add_load', type: 'force', vector: v, select: sel, ...(perNode ? { per_node: true } : {}) });
    msgs.push(`힘 [${v.map((x) => +x.toPrecision(6)).join(', ')}] N ${perNode ? '(절점마다)' : '(선택 절점에 나눠서, 합계)'} · ${describe(sel)}`);
    return finish(c, ops, msgs, info);
  }
  if (ql.length && sel && !isFix) {
    if (!dir) dir = looseAxis(c);
    if (!dir) {
      info.ask = true;
      return { ops, msgs: [...msgs, '강제 변위 방향을 알려 주세요 (예: y 방향으로 -30 mm, 아래로 5 mm)'] };
    }
    const a = dir.vec.findIndex((x) => x !== 0);
    let val = ql[0].value;
    val = dir.literal && ql[0].signed ? val * dir.vec[a] : Math.abs(val) * dir.vec[a];
    ops.push({ op: 'add_bc', select: sel, dofs: [a + 1], value: val, name: '강제 변위' });
    msgs.push(`강제 변위 u${AX[a]} = ${val} mm · ${describe(sel)}`);
    return finish(c, ops, msgs, info);
  }
  if (isFix) {
    if (!sel) {
      info.ask = true;
      return { ops, msgs: [...msgs, '구속할 위치를 알려 주세요 (예: 바닥, 8번 절점, 선택한 절점)'] };
    }
    let d = dofs;
    if (!d.length && dir) d = [dir.vec.findIndex((x) => x !== 0) + 1];
    if (!d.length) d = [1, 2, 3];
    ops.push({ op: 'add_bc', select: sel, dofs: d, type: d.length === 3 ? 'fixed' : undefined, name: d.length === 3 ? '고정' : '구속 ' + d.map((x) => 'u' + AX[x - 1]).join(',') });
    msgs.push(`${d.length === 3 ? '고정 (병진 3방향)' : '구속 ' + d.map((x) => 'u' + AX[x - 1]).join(', ')} · ${describe(sel)}`);
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
  let s = spec;
  for (const cl of splitClauses(text)) {
    const r = parseClause(cl, geo, s, { ...ctx, picked }, info);
    all.push(...r.ops);
    msgs.push(...r.msgs);
    if (info.ask || info.undo) break;
  }
  info.complete = !info.unknown && !info.ask && (all.length > 0 || info.run || info.undo || info.answered);
  if (info.partial && info.partial.length) {
    info.unknown = true;
    info.complete = false;
    msgs.push(`이해하지 못한 부분: ${info.partial.join(' ')}`);
  }
  let reply = msgs.join(' · ');
  if (!all.length && !info.ask && !info.run && !info.undo && !info.answered) reply = reply || '이해하지 못했습니다. "도움말"을 입력하면 처리할 수 있는 문장 예시를 보여 드립니다.';
  if (info.run && !reply) reply = '해석을 실행합니다';
  return { ops: all, reply, info };
}
