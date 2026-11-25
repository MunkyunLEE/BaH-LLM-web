import fs from 'fs';
const R = await import('../../web/rules.js');
const B = await import('../../web/backend.js');
const { parseOBJ } = await import('../../web/geometry.js');
const geo = parseOBJ(fs.readFileSync(new URL('../../web/examples/miura_3x3.obj', import.meta.url), 'utf8'), 'm');
let spec = B.defaultSpec();
const S = process.argv.slice(2).length ? process.argv.slice(2) : [
  '8번 절점 고정', '2번 절점 y, z 구속', '59번 절점을 y 방향으로 -30 mm', '바닥 고정', 'x 최소 변을 z 방향만 구속',
  '49번 절점에 아래로 1 N', '상단 절점마다 z -0.5 N', '윗면에 압력 0.001 MPa 아래로', '전체 면에 수직으로 압력 1 kPa', '자중',
  'x = 0 대칭', 'x 최대 면 대칭', 'E 1000, 포아송 0.3, 두께 0.25', '종이로', 'N4B5 로', 'L* 30 mm', '접촉 켜', '소성 힌지 켜', '반복 3회',
  'MERLIN2 호환', '호장법으로', '모드 6개', '증분 200', '해석 실행', '전체 크기 2배', 'm 단위를 mm 로', '변형 10배로 보여줘',
  '49번 점 변위 보여줘', '49번 점 변위-힘 그래프', '49번 점 변위-에너지', '접힘 에너지 그래프', 'ld1 2배', 'bc2 삭제', '되돌려',
  '대칭 표시 꺼', '모든 엣지를 휨으로', '도움말', '최대 반력 얼마?', '49번 절점에 x 방향으로 2 kN', '(10, 20, 0) 근처 점 고정',
  'x 최대 변을 x 방향으로 -15 mm 밀어', '초기결함 0.01', '목표 하중 계수 2', '반복 하중 꺼', '바 단면적 0.1, 접힘 강성 0.01',
];
for (const t of S) {
  const r = R.parse(t, geo, spec, null, {});
  let applied = '';
  try {
    const a = B.applyOps(spec, r.ops, geo);
    spec = a.spec;
  } catch (e) {
    applied = ' !! ' + e.message;
  }
  const flags = Object.entries(r.info).filter(([k, v]) => v && k !== 'complete').map(([k]) => k).join(',');
  console.log(`${r.info.complete ? 'OK ' : '-- '}${t}\n     → ${JSON.stringify(r.ops).slice(0, 260)} [${flags}] ${r.reply.slice(0, 120)}${applied}`);
}
