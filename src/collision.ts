import { mat4, vec3, type Vec3, type Mat4 } from "wgpu-matrix";
import type { CPUBoxRecord, CPUPyramidRecord } from "./traits";

// Port of fragment.ts:triangleSdf — unsigned distance from p to triangle abc
function triangleSdf(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ba = vec3.subtract(b, a);
  const cb = vec3.subtract(c, b);
  const ac = vec3.subtract(a, c);
  const pa = vec3.subtract(p, a);
  const pb = vec3.subtract(p, b);
  const pc = vec3.subtract(p, c);
  const nor = vec3.cross(ba, ac);

  const outside =
    Math.sign(vec3.dot(vec3.cross(ba, nor), pa)) +
      Math.sign(vec3.dot(vec3.cross(cb, nor), pb)) +
      Math.sign(vec3.dot(vec3.cross(ac, nor), pc)) <
    2.0;

  let d2: number;
  if (outside) {
    const tba = Math.min(Math.max(vec3.dot(ba, pa) / vec3.dot(ba, ba), 0), 1);
    const tcb = Math.min(Math.max(vec3.dot(cb, pb) / vec3.dot(cb, cb), 0), 1);
    const tac = Math.min(Math.max(vec3.dot(ac, pc) / vec3.dot(ac, ac), 0), 1);
    const ea = vec3.subtract(vec3.scale(ba, tba), pa);
    const eb = vec3.subtract(vec3.scale(cb, tcb), pb);
    const ec = vec3.subtract(vec3.scale(ac, tac), pc);
    d2 = Math.min(vec3.dot(ea, ea), vec3.dot(eb, eb), vec3.dot(ec, ec));
  } else {
    const dn = vec3.dot(nor, pa);
    d2 = (dn * dn) / vec3.dot(nor, nor);
  }
  return Math.sqrt(d2);
}

// Port of fragment.ts:pyramidSdf — signed distance from world point p to the pyramid.
// transform is the world-to-local matrix (same convention as the GPU shader).
function pyramidSdf(p: Vec3, pyramid: CPUPyramidRecord): number {
  const transform = pyramid.transform;
  const h = pyramid.height;
  const rx = pyramid.radii[0];
  const rz = pyramid.radii[1];

  const local = vec3.transformMat4(p, transform);
  const lx = Math.abs(local[0]);
  const ly = local[1];
  const lz = Math.abs(local[2]);

  const dxPlane = (h * (lx - rx) + rx * ly) / Math.sqrt(h * h + rx * rx);
  const dzPlane = (h * (lz - rz) + rz * ly) / Math.sqrt(h * h + rz * rz);
  const maxPlane = Math.max(dxPlane, dzPlane, -ly);

  if (maxPlane <= 0) return maxPlane;

  const folded = vec3.create(lx, ly, lz);
  const apex = vec3.create(0, h, 0);
  const dxTri = triangleSdf(
    folded,
    vec3.create(rx, 0, -rz),
    vec3.create(rx, 0, rz),
    apex,
  );
  const dzTri = triangleSdf(
    folded,
    vec3.create(-rx, 0, rz),
    vec3.create(rx, 0, rz),
    apex,
  );
  const dxBase = Math.max(lx - rx, 0);
  const dzBase = Math.max(lz - rz, 0);
  const baseDist = Math.sqrt(dxBase * dxBase + dzBase * dzBase + ly * ly);
  return Math.min(dxTri, dzTri, baseDist);
}

// Port of fragment.ts:boxSdf — signed distance from world point p to the box.
// transform is the world-to-local matrix.
function boxSdf(p: Vec3, transform: Mat4, radii: Vec3): number {
  const local = vec3.transformMat4(p, transform);
  const qx = Math.abs(local[0]) - radii[0];
  const qy = Math.abs(local[1]) - radii[1];
  const qz = Math.abs(local[2]) - radii[2];
  const mx = Math.max(qx, 0);
  const my = Math.max(qy, 0);
  const mz = Math.max(qz, 0);
  return (
    Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0)
  );
}

// World-space key points of the pyramid: apex + 4 base corners
function pyramidKeyPoints(pyramid: CPUPyramidRecord): Vec3[] {
  const rx = pyramid.radii[0];
  const rz = pyramid.radii[1];
  const l2w = mat4.invert(pyramid.transform);
  return [
    vec3.transformMat4(vec3.create(0, pyramid.height, 0), l2w),
    vec3.transformMat4(vec3.create(rx, 0, rz), l2w),
    vec3.transformMat4(vec3.create(-rx, 0, rz), l2w),
    vec3.transformMat4(vec3.create(rx, 0, -rz), l2w),
    vec3.transformMat4(vec3.create(-rx, 0, -rz), l2w),
  ];
}

// World-space corners of the box: all 8 corners
function boxCorners(transform: Mat4, radii: Vec3): Vec3[] {
  const l2w = mat4.invert(transform);
  const rx = radii[0];
  const ry = radii[1];
  const rz = radii[2];
  return [
    vec3.transformMat4(vec3.create(rx, ry, rz), l2w),
    vec3.transformMat4(vec3.create(-rx, ry, rz), l2w),
    vec3.transformMat4(vec3.create(rx, -ry, rz), l2w),
    vec3.transformMat4(vec3.create(-rx, -ry, rz), l2w),
    vec3.transformMat4(vec3.create(rx, ry, -rz), l2w),
    vec3.transformMat4(vec3.create(-rx, ry, -rz), l2w),
    vec3.transformMat4(vec3.create(rx, -ry, -rz), l2w),
    vec3.transformMat4(vec3.create(-rx, -ry, -rz), l2w),
  ];
}

// True if the pyramid and box overlap.
// Checks box corners inside pyramid and pyramid key points inside box.
export function pyramidVsBox(
  pyramid: CPUPyramidRecord,
  box: CPUBoxRecord,
): boolean {
  for (const boxCorner of boxCorners(box.transform, box.radii)) {
    const distanceToCorner = pyramidSdf(boxCorner, pyramid);
    if (distanceToCorner <= 0) {
      return true;
    }
  }

  for (const keyPoint of pyramidKeyPoints(pyramid)) {
    const distanceToKeyPoint = boxSdf(keyPoint, box.transform, box.radii);
    if (distanceToKeyPoint <= 0) {
      return true;
    }
  }

  return false;
}
