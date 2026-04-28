import tgpu from "typegpu";
import * as d from "typegpu/data";

/**
 * Draw a fullscreen triangle to be filled in by ray marching.
 */
export const mainVertex = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex },
  out: { clip: d.builtin.position, ndc: d.vec2f },
})((input) => {
  "use gpu";

  const xb = d.f32((input.vid << 1) & 2);
  const yb = d.f32(input.vid & 2);

  const x = xb * 2 - 1;
  const y = yb * 2 - 1;

  return {
    clip: d.vec4f(x, y, 0, 1),
    ndc: d.vec2f(x, y),
  };
});
