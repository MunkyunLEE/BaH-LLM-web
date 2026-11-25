import { loadCore } from './bhcore.js';

let core = null;

self.onmessage = async (e) => {
  const { kind, input, chunk } = e.data;
  try {
    if (!core) core = await loadCore(new URL('./bh.wasm', import.meta.url).href);
    const t0 = performance.now();
    const h = core.create(input);
    const model = core.model(h);
    self.postMessage({ type: 'model', model });
    let result = null;
    let frames = null;
    if (kind === 'space') {
      result = {};
      frames = new Float64Array(0);
    } else if (kind === 'modal') {
      result = core.modal(h);
      frames = core.frames(h);
    } else if (kind === 'kinematic') {
      result = core.kinematic(h);
      frames = core.frames(h);
    } else {
      let last = 0;
      for (;;) {
        const done = core.step(h, chunk || 2);
        const s = core.status(h);
        const now = performance.now();
        if (now - last > 150 || done) {
          self.postMessage({ type: 'progress', status: s, elapsed: (now - t0) / 1000 });
          last = now;
        }
        if (done) break;
      }
      result = core.result(h);
      frames = core.frames(h);
    }
    const dof = core.dof(h);
    const spaces = (input.spaces || []).map((q) => core.space(h, q));
    core.destroy(h);
    result.dof = dof;
    result.spaces = spaces;
    self.postMessage({ type: 'done', model, result, frames, elapsed: (performance.now() - t0) / 1000 }, [frames.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
};
