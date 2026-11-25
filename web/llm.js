import { t as tl, getLang } from './i18n.js';
const KEY = 'bah-llm-web.llm';
let controller = null;

export const SYSTEM = `You convert an origami engineer's request (Korean or English) into JSON edit operations for a bar-and-hinge (MERLIN2 style) origami model spec.
Reply with ONE JSON object only: {"ops": [...], "reply": "<short sentence describing what you did or what is unclear, in the reply language given below>"}.
Never invent node coordinates. Units are mm, N, tonne, s, MPa. Convert: kN->N x1000, m->mm x1000, kPa->MPa x0.001, GPa->MPa x1000.
Node numbers in the user's words are 1-based (as shown on screen, "59번 절점" = node index 58 in "nodes":[...] which is 0-based).
The model has only translational dofs (bars + rotational springs); there are no rotations and no moments.
SELECT grammar (choose target nodes of the input OBJ):
 {"plane": {"axis": "x"|"y"|"z", "at": "min"|"max"|"mid"|<number>}}  {"box": {"min": [x,y,z], "max": [x,y,z]}}
 {"nearest": [x,y,z]}   {"nodes": [0-based ids]}   {"all": true}   {"boundary": true}   {"corners": true}
 {"and": [SELECT, ...]}  {"or": [SELECT, ...]}
 {"points": [[x,y,z],...], "segments": [[[x,y,z],[x,y,z]],...]} = picked on screen. If CONTEXT has "selected" and the user says 선택한/고른/selected, use that object exactly.
OPS:
 {"op":"add_bc","name":str,"select":SELECT,"type":"fixed"}  or with "dofs":[1|2|3] (x,y,z) and optional "value" (prescribed displacement in mm, one dof per bc)
 {"op":"add_symmetry","axis":"x"|"y"|"z","at":number}   mirror plane; boundary edges lying on that plane get the mirror condition (normal displacement 0 + half fold hinge with a mirrored ghost panel). Loads on the plane must be halved by the user.
 {"op":"add_load","type":"force","select":SELECT,"vector":[Fx,Fy,Fz],"per_node":bool}   N; per_node=false: total force split over the selected nodes; true: every node gets the vector
 {"op":"add_load","type":"pressure","select":SELECT,"value":MPa,"mode":"global"|"local","direction":[dx,dy,dz]}   faces whose corners are all selected; global = fixed direction like gravity, based on the initial face area; local = follows the current face normal (follower load)
 {"op":"add_load","type":"gravity","vector":[0,0,-9806.65]}
 {"op":"update","id":"bc1"|"ld1"|"pl1"|"sy1", ...fields}   {"op":"update","id":"ld1","scale":2}
 {"op":"remove","id":"..."}    {"op":"clear","what":"bcs"|"loads"|"plots"|"symmetry"|"creases"|"all"}
 {"op":"set_material","E":MPa,"nu":..,"rho":tonne/mm3,"yield":MPa|null,"hardening":MPa,"thickness":mm}
 {"op":"set_bh", fields...}  "model":"N5B8"|"N4B5", "calib":"auto"|"manual", "Lstar":mm|null (absolute L*), "Lstar_ratio":L*/L_F (default 3), "contact":bool, "gap":mm, "plastic_hinge":bool (fold yield moment sigma_y t^2/4), "fold_yield":N*mm/mm, "fold_H", "bend_yield", "bend_H", "cycles":int, "cycle_back":mm, "compat":bool (reproduce MERLIN2 v1.1 quirks), "tri_bars":"merlin2"|"woodruff"|"khawale", "edge_bend":"woodruff"|"khawale", "fold_k","bend_k","bar_area" (manual mode), "use_mass":bool, "tol":deg, "drivers":["a-b"], "targets":[deg]
 {"op":"set_crease","edges":[[a,b],...],"type":"fold"|"bend"|"cut"|"auto"}   0-based node ids of input panel edges
 {"op":"set_step","type":"static"|"arclength"|"modal"|"kinematic","increments":int,"modes":int,"imperfection":mm,"lam_max":number}
   static: prescribed displacements -> damped Newton (MERLIN2 Displacement); only forces -> MGDCM arc-length (MERLIN2 Force). arclength forces MGDCM.
 {"op":"scale_geometry","factor":number}   scale all coordinates (e.g. m -> mm = 1000)
 {"op":"set_view","scale":number,"mirror":bool}   display only: deformation scale, show mirrored half
 {"op":"add_plot","title":str,"x":QUANTITY,"series":[QUANTITY,...]}
QUANTITY: {"quantity":"step"|"lam"|"energy.total"|"energy.bar"|"energy.fold"|"energy.bend"|"energy.plastic"|"energy.contact"|"energy.external"|"force"}
       or nodal: {"quantity":"u"|"ux"|"uy"|"uz"|"force.x"|"force.y"|"force.z","select":SELECT}  (u = mean over nodes, force = sum of nodal force = reaction at supports / applied load at loaded nodes)
       or crease dihedral angle in degrees: {"quantity":"angle","select":{"edge":"a-b"}}
 {"op":"add_plot","type":"space3","edges":["a-b","c-d","e-f"]}   3D solution space of three crease dihedral angles (rigid folding paths + current analysis path)
Edge keys "a-b" use 0-based node indices with a<b; the user speaks 1-based ("2-7 crease" = "1-6").
Degree-of-freedom analysis: set_step kinematic with set_bh drivers [] (shows mechanism count and mechanism modes). Kinematic path: set_bh drivers ["a-b"], targets [deg] + set_step kinematic.
Stiffness-only eigen modes: set_bh use_mass false + set_step modal.
After every static analysis the app always shows step-energy and step-force plots.
Rules: change only what the user asked (patch). If ambiguous, return "ops": [] and ask in "reply".`;

export function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { url: c.url || '', model: c.model || '', key: c.key || '', mode: c.mode || (c.url ? 'rule_first' : 'rule') };
  } catch (e) {
    return { url: '', model: '', key: '', mode: 'rule' };
  }
}

export function saveConfig(c) {
  const out = { url: (c.url || '').trim(), model: (c.model || '').trim(), key: c.key || '', mode: c.mode || 'rule_first' };
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch (e) {}
  return out;
}

export function publicConfig(c) {
  return { url: c.url, model: c.model, mode: c.mode, has_key: !!c.key };
}

export function configured(c) {
  return !!(c.url && c.url.trim() && c.model && c.model.trim());
}

export function provider(url) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return tl('미설정');
  }
  const h = u.hostname;
  if (['localhost', '127.0.0.1', '::1'].includes(h)) return u.port === '11434' ? tl('Ollama (이 컴퓨터)') : u.port === '1234' ? tl('LM Studio (이 컴퓨터)') : tl('로컬 서버 (이 컴퓨터)');
  return { 'api.openai.com': 'OpenAI API', 'generativelanguage.googleapis.com': 'Google Gemini API', 'api.anthropic.com': 'Anthropic API', 'openrouter.ai': 'OpenRouter' }[h] || tl('외부 서버 {h}', { h });
}

function headers(c) {
  const h = { 'Content-Type': 'application/json' };
  if (c.key) h.Authorization = 'Bearer ' + c.key;
  try {
    if (new URL(c.url).hostname === 'api.anthropic.com') {
      h['x-api-key'] = c.key;
      h['anthropic-version'] = '2023-06-01';
      h['anthropic-dangerous-direct-browser-access'] = 'true';
    }
  } catch (e) {}
  return h;
}

export async function status(c) {
  let host = '';
  try {
    host = new URL(c.url).host;
  } catch (e) {}
  const base = { provider: provider(c.url), host, key_set: !!c.key };
  if (!configured(c)) return { ...base, ok: false, error: tl('LLM 이 설정되지 않았습니다'), models: [] };
  try {
    const t = performance.now();
    const r = await fetch(c.url.replace(/\/$/, '') + '/models', { headers: headers(c), signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const names = (j.data || []).map((m) => String(m.id).replace(/^models\//, ''));
    return { ...base, ok: true, ms: Math.round(performance.now() - t), models: names, has_model: names.includes(c.model.replace(/^models\//, '')) };
  } catch (e) {
    return { ...base, ok: false, error: String(e.message || e) + tl(' (브라우저에서 직접 부를 때는 그 서버가 CORS 를 허용해야 합니다. Ollama 는 OLLAMA_ORIGINS="*" 로 실행)'), models: [] };
  }
}

function extract(text) {
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return JSON.parse(text);
  } catch (e) {}
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error(tl('LLM 응답에서 JSON을 찾지 못했습니다'));
}

async function post(c, messages, timeout) {
  controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout || 900000);
  try {
    const body = { model: c.model, messages, temperature: 0, stream: false, response_format: { type: 'json_object' } };
    const r = await fetch(c.url.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: headers(c), body: JSON.stringify(body), signal: controller.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
    return JSON.parse(txt);
  } finally {
    clearTimeout(t);
    controller = null;
  }
}

export function cancel() {
  if (controller) controller.abort();
}

export function context(geo, spec, meta, picked) {
  const s = { materials: spec.materials, sections: spec.sections, bh: spec.bh, bcs: spec.bcs, loads: spec.loads, symmetry: spec.symmetry, step: spec.step, plots: spec.plots, creases: spec.creases };
  const lo = [0, 1, 2].map((k) => Math.min(...geo.nodes.map((p) => p[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...geo.nodes.map((p) => p[k])));
  const model = { source: geo.name, nodes: geo.nodes.length, panels: geo.panels.length, bbox: { min: lo, max: hi } };
  let out = 'MODEL: ' + JSON.stringify(model) + '\nSPEC: ' + JSON.stringify(s);
  if (meta) out += '\nRESULT: ' + JSON.stringify({ kind: meta.kind, frames: meta.frames.length, summary: meta.summary });
  if (picked) out += '\nCONTEXT: ' + JSON.stringify({ selected: picked });
  return out;
}

export async function ask(c, text, ctx, history, error) {
  const msgs = [{ role: 'system', content: SYSTEM + `\nReply language: ${getLang() === 'ko' ? 'Korean (polite)' : 'English'}.` }, { role: 'user', content: ctx }];
  for (const h of (history || []).slice(-6)) msgs.push(h);
  msgs.push({ role: 'user', content: text });
  if (error) msgs.push({ role: 'user', content: `The previous ops failed validation: ${error}\nReturn corrected JSON.` });
  const resp = await post(c, msgs);
  const data = extract(resp.choices[0].message.content);
  if (!Array.isArray(data.ops || [])) throw new Error(tl('ops 가 배열이 아닙니다'));
  return { ops: data.ops || [], reply: String(data.reply || '') };
}

export async function test(c) {
  if (!configured(c)) return { ok: false, error: tl('LLM 이 설정되지 않았습니다') };
  const t = performance.now();
  try {
    const r = await post(c, [{ role: 'system', content: 'Reply with JSON only.' }, { role: 'user', content: 'Return {"ok": true, "reply": "connection ok"}' }], 120000);
    const txt = r.choices[0].message.content;
    let ok = false;
    try {
      extract(txt);
      ok = true;
    } catch (e) {}
    return { ok: true, ms: performance.now() - t, model: r.model, json_ok: ok, reply: txt.slice(0, 80) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
