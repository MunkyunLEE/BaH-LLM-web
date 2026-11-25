import fs from 'fs';
const I = await import('../../web/i18n.js');
const R = await import('../../web/rules.js');
const B = await import('../../web/backend.js');
const { parseOBJ } = await import('../../web/geometry.js');
const geo = parseOBJ(fs.readFileSync(new URL('../../web/examples/miura_3x3.obj', import.meta.url), 'utf8'), 'm');
const geoK = parseOBJ(fs.readFileSync(new URL('../../web/examples/miura_kin.obj', import.meta.url), 'utf8'), 'm');
const file = new URL('./rules_cases.json', import.meta.url);
const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
const mode = process.argv[2] || 'check';
let bad = 0;
for (const c of cases) {
  I.setLang(c.lang || 'ko');
  const g = c.geo === 'kin' ? geoK : geo;
  let spec = B.defaultSpec();
  for (const pre of c.pre || []) spec = B.applyOps(spec, R.parse(pre, g, spec, null, {}).ops, g).spec;
  const r = R.parse(c.text, g, spec, null, {});
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'title' || k === 'name' ? undefined : v)));
  const got = { ops: r.ops, ok: r.info.complete, ask: !!r.info.ask, run: !!r.info.run };
  if (mode === 'record' && !c.same) c.expect = got;
  else if (JSON.stringify(c.same ? strip(got) : got) !== JSON.stringify(c.same ? strip(c.expect) : c.expect)) {
    bad++;
    console.log(`DIFF [${c.lang || 'ko'}] ${c.text}\n  want ${JSON.stringify(c.expect).slice(0, 300)}\n  got  ${JSON.stringify(got).slice(0, 300)}\n  reply ${r.reply.slice(0, 160)}`);
  }
}
if (mode === 'record') fs.writeFileSync(file, JSON.stringify(cases, null, 1));
console.log(mode === 'record' ? `recorded ${cases.length}` : `${cases.length - bad}/${cases.length} match`);
process.exit(bad ? 1 : 0);
