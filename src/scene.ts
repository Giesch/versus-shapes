import * as d from "typegpu/data";
import { type Mat4, type Vec3 } from "wgpu-matrix";

import { Sphere, BoxRect } from "./shaders/schemas";

export const makeSphere = (
  center: Vec3,
  radius: number,
  color: Vec3,
): d.Infer<typeof Sphere> => ({
  center: d.vec3f(center[0], center[1], center[2]),
  radius,
  color: d.vec3f(color[0], color[1], color[2]),
});

// Matches the Vulkan/Slang reference: `transform` is uploaded as-is and the
// shader applies it directly to a world-space point inside the SDF.
export const makeBox = (
  transform: Mat4,
  radii: Vec3,
  color: Vec3,
): d.Infer<typeof BoxRect> => ({
  transform: mat4x4fFromArray(transform),
  radii: d.vec3f(radii[0], radii[1], radii[2]),
  color: d.vec3f(color[0], color[1], color[2]),
});

export const mat4x4fFromArray = (arr: ArrayLike<number>) =>
  d.mat4x4f(
    arr[0],
    arr[1],
    arr[2],
    arr[3],
    arr[4],
    arr[5],
    arr[6],
    arr[7],
    arr[8],
    arr[9],
    arr[10],
    arr[11],
    arr[12],
    arr[13],
    arr[14],
    arr[15],
  );
