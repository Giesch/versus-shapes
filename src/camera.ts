import { vec3, type Vec3 } from "wgpu-matrix";

const YAW_SPEED = 0.04;
const PITCH_SPEED = 0.03;
const ZOOM_FACTOR_PER_STEP = 0.97;
const PITCH_MAX = Math.PI / 2 - 0.01;
const DISTANCE_MIN = 1.5;
const DISTANCE_MAX = 50.0;

export interface CameraControls {
  pitchUp: boolean;
  pitchDown: boolean;

  yawLeft: boolean;
  yawRight: boolean;

  zoomIn: boolean;
  zoomOut: boolean;
}

export class Camera {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;

  constructor() {
    this.yaw = 0.0;
    this.pitch = 0.3;
    this.distance = 6.0;
    this.target = vec3.create(0, 0, 0);
  }

  position(): Vec3 {
    const cosPitch = Math.cos(this.pitch);

    const x = this.target[0] + this.distance * Math.sin(this.yaw) * cosPitch;
    const y = this.target[1] + this.distance * Math.sin(this.pitch);
    const z = this.target[2] + this.distance * Math.cos(this.yaw) * cosPitch;

    return vec3.create(x, y, z);
  }

  update(input: CameraControls): void {
    if (input.yawLeft) this.yaw -= YAW_SPEED;
    if (input.yawRight) this.yaw += YAW_SPEED;

    if (input.pitchUp) this.pitch += PITCH_SPEED;
    if (input.pitchDown) this.pitch -= PITCH_SPEED;
    this.pitch = clamp({ min: -PITCH_MAX, max: PITCH_MAX, value: this.pitch });

    if (input.zoomIn) this.distance *= ZOOM_FACTOR_PER_STEP;
    if (input.zoomOut) this.distance /= ZOOM_FACTOR_PER_STEP;

    this.distance = clamp({
      min: DISTANCE_MIN,
      max: DISTANCE_MAX,
      value: this.distance,
    });
  }
}

interface ClampArgs {
  min: number;
  max: number;
  value: number;
}

function clamp({ min, max, value }: ClampArgs): number {
  return Math.max(min, Math.min(max, value));
}
