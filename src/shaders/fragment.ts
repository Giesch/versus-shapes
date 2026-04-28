import tgpu from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";

import { sdfLayout, Sphere, BoxRect } from "./schemas";

const MAX_STEPS = 64;
const MAX_DISTANCE = d.f32(1000);
const MIN_HIT_DISTANCE = 0.001;
const MISS_DISTANCE = d.f32(3.4e38);

const RayHit = d.struct({
  distance: d.f32,
  color: d.vec3f,
});

const sphereSdf = (p: d.v3f, s: d.Infer<typeof Sphere>): number => {
  "use gpu";

  return std.length(p.sub(s.center)) - s.radius;
};

const boxSdf = (p: d.v3f, b: d.Infer<typeof BoxRect>): number => {
  "use gpu";

  const local = b.transform.mul(d.vec4f(p, 1)).xyz;
  const q = std.abs(local).sub(b.radii);

  return (
    std.length(std.max(q, d.vec3f(0, 0, 0))) +
    std.min(std.max(q.x, std.max(q.y, q.z)), 0)
  );
};

const closestShape = (p: d.v3f): d.Infer<typeof RayHit> => {
  "use gpu";

  let hit = RayHit({ distance: MISS_DISTANCE, color: d.vec3f(0, 0, 0) });

  for (let i = d.u32(0); i < sdfLayout.$.params.sphereCount; i++) {
    const s = sdfLayout.$.spheres[i];
    const dist = sphereSdf(p, s);
    if (dist < hit.distance) {
      hit = RayHit({ distance: dist, color: s.color });
    }
  }

  for (let i = d.u32(0); i < sdfLayout.$.params.boxCount; i++) {
    const b = sdfLayout.$.boxes[i];
    const dist = boxSdf(p, b);
    if (dist < hit.distance) {
      hit = RayHit({ distance: dist, color: b.color });
    }
  }

  return hit;
};

const closestShapeDist = (p: d.v3f): number => {
  "use gpu";

  return closestShape(p).distance;
};

const calculateNormal = (p: d.v3f): d.v3f => {
  "use gpu";

  const h = 0.001;
  const kxyy = d.vec3f(1, -1, -1);
  const kyyx = d.vec3f(-1, -1, 1);
  const kyxy = d.vec3f(-1, 1, -1);
  const kxxx = d.vec3f(1, 1, 1);

  return std.normalize(
    kxyy
      .mul(closestShapeDist(p.add(kxyy.mul(h))))
      .add(kyyx.mul(closestShapeDist(p.add(kyyx.mul(h)))))
      .add(kyxy.mul(closestShapeDist(p.add(kyxy.mul(h)))))
      .add(kxxx.mul(closestShapeDist(p.add(kxxx.mul(h))))),
  );
};

const basicLighting = (
  pos: d.v3f,
  rayDir: d.v3f,
  objColor: d.v3f,
  lightPos: d.v3f,
): d.v3f => {
  "use gpu";

  const normal = calculateNormal(pos);
  const lightDir = std.normalize(lightPos.sub(pos));
  const viewDir = rayDir.mul(-1);
  const lightColor = d.vec3f(1, 1, 1);

  const ambientStrength = 0.005;
  const ambient = lightColor.mul(ambientStrength);

  const diffuse = lightColor.mul(std.max(0, std.dot(normal, lightDir)));

  const specularStrength = 0.25;
  const shininess = d.f32(16);
  const halfway = std.normalize(lightDir.add(viewDir));
  const specIntensity = std.pow(
    std.max(std.dot(normal, halfway), 0),
    shininess,
  );
  const specular = lightColor.mul(specularStrength * specIntensity);

  return ambient.add(diffuse).add(specular).mul(objColor);
};

const rayMarch = (ro: d.v3f, rd: d.v3f, lightPos: d.v3f): d.v3f => {
  "use gpu";

  let traveled = d.f32(0);

  for (let i = 0; i < MAX_STEPS; i++) {
    const p = ro.add(rd.mul(traveled));
    const hit = closestShape(p);

    if (hit.distance < MIN_HIT_DISTANCE) {
      return basicLighting(p, rd, hit.color, lightPos);
    }

    if (traveled >= MAX_DISTANCE) {
      break;
    }

    traveled = traveled + hit.distance;
  }

  return d.vec3f(0, 0, 0);
};

const sampleAt = (ndc: d.v2f): d.v3f => {
  "use gpu";

  const params = sdfLayout.$.params;
  const worldH = params.camera.inverseViewProj.mul(d.vec4f(ndc, 1, 1));
  const world = worldH.xyz.div(worldH.w);
  const dir = std.normalize(world.sub(params.camera.position));

  return rayMarch(params.camera.position, dir, params.lightPosition);
};

/** the square root of the number of samples per pixel */
const SSAA_N = 3;

export const mainFragment = tgpu.fragmentFn({
  in: { ndc: d.vec2f },
  out: d.vec4f,
})((input) => {
  "use gpu";

  const params = sdfLayout.$.params;
  const pixelNdc = d.vec2f(2 / params.resolution.x, 2 / params.resolution.y);

  let sum = d.vec3f(0, 0, 0);
  for (let m = 0; m < SSAA_N; m++) {
    for (let n = 0; n < SSAA_N; n++) {
      const sub = d.vec2f((m + 0.5) / SSAA_N, (n + 0.5) / SSAA_N);
      const offset = sub.sub(d.vec2f(0.5, 0.5)).mul(pixelNdc);
      sum = sum.add(sampleAt(input.ndc.add(offset)));
    }
  }

  const color = sum.div(SSAA_N * SSAA_N);

  return d.vec4f(color, 1);
});
