import "./style.css";

import { PLAYER_1 } from "@rcade/plugin-input-classic";
import * as spinners from "@rcade/plugin-input-spinners";

import {
  Renderer,
  mat4x4fFromArray,
  toWebGPUVec2,
  toWebGPUVec3,
} from "./renderer";
import * as audio from "./audio";
import { mat4, vec3, type Vec3, type Mat4, vec2 } from "wgpu-matrix";
import { d } from "typegpu";
import * as koota from "koota";

import versusShapesJson from "./data/versus-shapes.beats.json";
import * as traits from "./traits";
import * as systems from "./systems";

const MILLIS_PER_FRAME = 16.6;

const TAU = Math.PI * 2;
const SUN_START = vec3.create(4, 5, 2);

// pentagon obstacle: 5 boxes forming the polygon outline (one box per edge)
const PENTA_SIDES = 5;
const PENTA_INTERIOR = TAU / PENTA_SIDES;
const START_ANGLE = Math.PI / 2; // a vertex points up
const BAR_THICKNESS = 0.05;
const BAR_DEPTH = 0.15;

interface ObstacleBox {
  transform: Mat4;
  radii: Vec3;
}

/**
 * Build the edge boxes of a regular pentagon with circumradius `r`,
 * centered on the origin in the XY plane. Each box's `transform` is the
 * world->local matrix (inverse of the model matrix), matching the convention
 * used by the GPU shader and collision SDFs.
 *
 * Passing a `gapIndex` (0..SIDES-1) omits that one edge, leaving a gap in the
 * outline while the remaining sides keep their pentagon positions.
 */
function buildPentagon(r: number, gapIndex: number): ObstacleBox[] {
  const apothem = r * Math.cos(Math.PI / PENTA_SIDES);
  const halfLen = r * Math.sin(Math.PI / PENTA_SIDES) + BAR_THICKNESS / 2;

  const boxes: ObstacleBox[] = [];
  for (let i = 0; i < PENTA_SIDES; i++) {
    if (i === gapIndex) continue;

    const phiMid = START_ANGLE + (i + 0.5) * PENTA_INTERIOR;
    const midpoint = vec3.create(
      apothem * Math.cos(phiMid),
      apothem * Math.sin(phiMid),
      0,
    );
    const edgeAngle = phiMid + Math.PI / 2;
    const model = mat4.multiply(
      mat4.translation(midpoint),
      mat4.rotationZ(edgeAngle),
    );

    boxes.push({
      transform: mat4.invert(model),
      radii: vec3.create(halfLen, BAR_THICKNESS, BAR_DEPTH),
    });
  }

  return boxes;
}

/** initial dependencies to construct a GameState */
interface GameStateDeps {
  startTimeMillis: number;
  audioCtx: AudioContext;
  renderer: Renderer;
  assets: Assets;
}

interface Assets {
  versusShapes: AudioBuffer;
}

/** global state passed in to each update */
interface FrameInput {
  /** millis since program start, aka `performance.now()` */
  now: number;
  /** Player 1's dpad and button inputs */
  playerOne: typeof PLAYER_1;
  /** this frame's step delta from the spinner input */
  spinDelta: number;
}

class GameState {
  paused: boolean;

  // Timestep management
  /** the initial value of performance.now() at app start */
  startTimeMillis: number;
  /** the value of performance.now() at the top of the previous frame */
  lastTimeMillis: number;
  /** the accumulator of 'unspent' time for the fixed timestep */
  frameTimeMillis: number;

  // IO
  audioCtx: AudioContext;
  musicGain: GainNode;
  renderer: Renderer;
  assets: Assets;

  world: koota.World;

  constructor(deps: GameStateDeps) {
    this.world = koota.createWorld();

    // init koota singletons
    this.world.add(traits.ElapsedSeconds({ elapsedSeconds: 0 }));
    this.world.add(traits.BeatIndex({ beatIndex: 0 }));
    this.world.add(traits.BeatProximity({ beatProximity: 0 }));
    const beatTimestamps = versusShapesJson.beats;
    this.world.add(traits.BeatTimestamps({ beatTimestamps }));
    this.world.add(traits.PlayerRotation({ playerRotation: 0.25 }));
    this.world.add(traits.NextLevelEvent({ nextLevelEvent: 0 }));
    const sunPosition = vec3.clone<Float32Array>(SUN_START);
    this.world.add(traits.SunPosition({ sunPosition }));
    this.world.add(traits.MoonPosition({ moonPosition: vec3.create() }));

    // spawn koota entities
    // player pyramid
    this.world.spawn(
      traits.IsPlayer,
      traits.CPUPyramid({
        transform: mat4.create(),
        radii: vec2.create(0.075, 0.05),
        height: 0.2,
      }),
      traits.GPUPyramid({ color: d.vec3f(0.3, 0.7, 0.3) }),
    );
    // central sphere
    this.world.spawn(
      traits.GPUSphere({
        radius: 0.5,
        center: d.vec3f(0.0, 0.0, 0.0),
        color: d.vec3f(0.3, 0.3, 0.7),
      }),
    );

    // non-koota fields
    // timestep
    this.startTimeMillis = deps.startTimeMillis;
    this.lastTimeMillis = deps.startTimeMillis;
    this.frameTimeMillis = 0.0;
    // audio
    this.audioCtx = deps.audioCtx;
    this.musicGain = this.audioCtx.createGain();
    this.musicGain.gain.value = 1.2;
    this.musicGain.connect(this.audioCtx.destination);

    this.renderer = deps.renderer;
    this.assets = deps.assets;

    this.paused = false;
  }

  update(input: FrameInput): void {
    // TODO replace this with death screen & make restart-able
    if (this.paused) return;

    // TODO move this timestep stuff into koota world
    const deltaTimeMillis = input.now - this.lastTimeMillis;
    this.frameTimeMillis += deltaTimeMillis;
    this.lastTimeMillis = input.now;
    const elapsedSeconds = (input.now - this.startTimeMillis) / 1000;
    this.world.set(traits.ElapsedSeconds, { elapsedSeconds });

    // read input
    systems.updatePlayerRotation(this.world, input.spinDelta);

    // fixed timestep
    while (this.frameTimeMillis >= MILLIS_PER_FRAME) {
      this.frameTimeMillis -= MILLIS_PER_FRAME;

      systems.advanceBeatIndex(this.world);
      systems.setBeatProximity(this.world);

      systems.updatePlayerPyramidPosition(this.world);

      systems.spawnNewObstacles(this.world);
      systems.recreateSidesForObstacles(this.world);

      this.paused ||= systems.checkCollision(this.world);
    }
  }

  playAudio(buffer: AudioBuffer): void {
    let source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.musicGain);
    source.start();
  }

  draw(): void {
    // update light placement
    const { elapsedSeconds } = this.world.get(traits.ElapsedSeconds)!;
    const sunRotation = mat4.rotationY(TAU * elapsedSeconds * 0.1);
    const { sunPosition } = this.world.get(traits.SunPosition)!;
    vec3.transformMat4(SUN_START, sunRotation, sunPosition);
    const { moonPosition } = this.world.get(traits.MoonPosition)!;
    vec3.negate(sunPosition, moonPosition);

    // copy object positions
    this.world
      .query(traits.CPUPyramid, traits.GPUPyramid)
      .updateEach(([cpuPyramid, gpuPyramid]) => {
        gpuPyramid.transform = mat4x4fFromArray(cpuPyramid.transform);
        gpuPyramid.radii = toWebGPUVec2(cpuPyramid.radii);
        gpuPyramid.height = cpuPyramid.height;
      });
    this.world
      .query(traits.CPUBox, traits.GPUBox)
      .updateEach(([cpuBox, gpuBox]) => {
        gpuBox.transform = mat4x4fFromArray(cpuBox.transform);
        gpuBox.radii = toWebGPUVec3(cpuBox.radii);
      });

    // draw
    this.renderer.draw({ world: this.world });
  }

  spawnPolygonSides({
    radius,
    gapIndex,
    polygon,
  }: {
    radius: number;
    gapIndex: number;
    polygon: koota.Entity;
  }) {
    const sides = buildPentagon(radius, gapIndex);
    for (const { transform, radii } of sides) {
      this.world.spawn(
        traits.CPUBox({ transform, radii }),
        traits.GPUBox({ color: d.vec3f(0.7, 0.3, 0.3) }),
        traits.BelongsTo(polygon),
      );
    }
  }
}

async function init() {
  const audioCtx = new AudioContext();
  const versusShapes = await audio.load(audioCtx, "./versus-shapes.mp3");
  const assets: Assets = { versusShapes };

  const renderer = await Renderer.init();

  const startTimeMillis = performance.now();

  const game = new GameState({ startTimeMillis, audioCtx, renderer, assets });

  game.playAudio(game.assets.versusShapes);

  const frame = () => {
    game.update({
      now: performance.now(),
      spinDelta: spinners.PLAYER_1.SPINNER.consume_step_delta(),
      playerOne: PLAYER_1,
    });

    game.draw();

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

init();
