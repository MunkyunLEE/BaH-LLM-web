export async function loadCore(src) {
  const bytes = src instanceof ArrayBuffer ? src : await (await fetch(src)).arrayBuffer();
  let mem = null;
  const err = [];
  const wasi = {
    fd_write(fd, iov, n, out) {
      const v = new DataView(mem.buffer);
      let w = 0;
      for (let i = 0; i < n; i++) {
        const p = v.getUint32(iov + 8 * i, true), l = v.getUint32(iov + 8 * i + 4, true);
        err.push(new TextDecoder().decode(new Uint8Array(mem.buffer, p, l)));
        w += l;
      }
      v.setUint32(out, w, true);
      return 0;
    },
    fd_close: () => 0,
    fd_seek: () => 0,
    environ_get: () => 0,
    environ_sizes_get(c, s) {
      const v = new DataView(mem.buffer);
      v.setUint32(c, 0, true);
      v.setUint32(s, 0, true);
      return 0;
    },
    proc_exit(c) { throw new Error("bh core exit " + c + " " + err.join("")); },
  };
  const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi });
  const ex = instance.exports;
  mem = ex.memory;
  if (ex._initialize) ex._initialize();
  const enc = new TextEncoder(), dec = new TextDecoder();
  const cstr = (p) => {
    const b = new Uint8Array(mem.buffer);
    let e = p;
    while (b[e]) e++;
    return dec.decode(b.subarray(p, e));
  };
  const call = (name, ...a) => JSON.parse(cstr(ex[name](...a)));
  return {
    create(spec) {
      const s = enc.encode(JSON.stringify(spec));
      const p = ex.malloc(s.length + 1);
      new Uint8Array(mem.buffer).set(s, p);
      new Uint8Array(mem.buffer)[p + s.length] = 0;
      const h = ex.bh_create(p);
      ex.free(p);
      if (h < 0) throw new Error(cstr(ex.bh_last()));
      return h;
    },
    model: (h) => call("bh_model", h),
    step: (h, n) => ex.bh_step(h, n) === 1,
    status: (h) => call("bh_status", h),
    result: (h) => call("bh_result", h),
    modal: (h) => call("bh_modal", h),
    kinematic: (h) => call("bh_kinematic", h),
    frames(h) {
      const p = ex.bh_frames_ptr(h), n = ex.bh_frames_len(h);
      return new Float64Array(mem.buffer, p, n).slice();
    },
    destroy: (h) => ex.bh_destroy(h),
  };
}
