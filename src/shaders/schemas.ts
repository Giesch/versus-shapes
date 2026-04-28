import tgpu from "typegpu";
import * as d from "typegpu/data";

export const MAX_SPHERES = 32;
export const MAX_BOXES = 32;

export const RayMarchCamera = d.struct({
  inverseViewProj: d.mat4x4f,
  position: d.vec3f,
});

export const RayMarchingParams = d.struct({
  camera: RayMarchCamera,
  lightPosition: d.vec3f,
  sphereCount: d.u32,
  boxCount: d.u32,
  resolution: d.vec2f,
});

export const Sphere = d.struct({
  center: d.vec3f,
  radius: d.f32,
  color: d.vec3f,
});

export const BoxRect = d.struct({
  transform: d.mat4x4f,
  radii: d.vec3f,
  color: d.vec3f,
});

export const SpheresArray = d.arrayOf(Sphere, MAX_SPHERES);
export const BoxesArray = d.arrayOf(BoxRect, MAX_BOXES);

export const sdfLayout = tgpu.bindGroupLayout({
  params: { uniform: RayMarchingParams, visibility: ["fragment"] },
  spheres: {
    storage: SpheresArray,
    access: "readonly",
    visibility: ["fragment"],
  },
  boxes: {
    storage: BoxesArray,
    access: "readonly",
    visibility: ["fragment"],
  },
});
