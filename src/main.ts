import "./style.css";

import { PLAYER_1 } from "@rcade/plugin-input-classic";
import * as spinners from "@rcade/plugin-input-spinners";

import {
  Renderer,
  mat4x4fFromArray,
  toWebGPUVec2,
  toWebGPUVec3,
  type DrawArgs,
} from "./renderer";
import * as collision from "./collision";
import * as audio from "./audio";
import { mat4, vec3, type Vec3, type Mat4, vec2 } from "wgpu-matrix";
import { d } from "typegpu";
import * as koota from "koota";

import versusShapesJson from "./data/versus-shapes.beats.json";
import { level } from "./data/versus-shapes.level.ts";
import * as traits from "./traits";

const MILLIS_PER_FRAME = 16.6;

const TAU = Math.PI * 2;
const SUN_START = vec3.create(4, 5, 2);
const frac = (x: number): number => x - Math.floor(x);

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

  // lights

  // TODO move into koota
  sunPos: Vec3;
  /** a dimmer fill light, kept exactly opposite the sun */
  moonPos: Vec3;

  // beat tracking
  // TODO move into koota
  /** the beat timestamps from essentia */
  beats: number[];
  beatProximity: number;

  world: koota.World;

  constructor(deps: GameStateDeps) {
    // koota world
    this.world = koota.createWorld();
    this.world.add(traits.BeatProximity({ beatProximity: 0 }));

    // spawn player
    this.world.spawn(
      traits.IsPlayer,
      traits.GPUPyramid({
        transform: mat4.create(),
        radii: vec2.create(0.075, 0.05),
        color: vec3.create(0.3, 0.7, 0.3),
        height: 0.2,
      }),
    );

    // spawn pentagon
    for (const obstacle of level.events.filter((o) => o.atSeconds === 0)) {
      const gapIndex = obstacle.gapIndex % PENTA_SIDES;

      const pentagon = this.world.spawn(
        traits.Obstacle({
          spawnTime: obstacle.atSeconds,
          gapIndex: 0,
          radius: 1.75,
          descentRate: 0.3,
        }),
      );
      this.spawnPolygonSides({
        radius: obstacle.radius,
        gapIndex,
        polygon: pentagon,
      });
    }

    // init koota singletons
    this.world.add(traits.ElapsedSeconds({ elapsedSeconds: 0 }));
    this.world.add(traits.BeatIndex({ beatIndex: 0 }));
    this.world.add(traits.BeatProximity({ beatProximity: 0 }));
    this.world.add(traits.PlayerRotation({ playerRotation: 0.25 }));
    this.world.add(traits.NextLevelEvent({ nextLevelEvent: 0 }));
    const sunPosition = vec3.clone<Float32Array>(SUN_START);
    this.world.add(traits.SunPosition({ sunPosition }));
    this.world.add(traits.MoonPosition({ moonPosition: vec3.create() }));

    // original, non-koota fields

    this.startTimeMillis = deps.startTimeMillis;
    this.lastTimeMillis = deps.startTimeMillis;
    this.frameTimeMillis = 0.0;

    this.audioCtx = deps.audioCtx;
    this.musicGain = this.audioCtx.createGain();
    this.musicGain.gain.value = 1.2;
    this.musicGain.connect(this.audioCtx.destination);

    this.renderer = deps.renderer;
    this.assets = deps.assets;

    this.sunPos = vec3.clone(SUN_START);
    this.moonPos = vec3.create();

    this.beats = versusShapesJson.beats;
    this.beatProximity = 0;

    this.paused = false;
  }

  update(input: FrameInput): void {
    if (this.paused) return;

    const deltaTimeMillis = input.now - this.lastTimeMillis;
    this.frameTimeMillis += deltaTimeMillis;
    this.lastTimeMillis = input.now;

    // read spinner input
    // NOTE we need to avoid applying this input multiple times per render frame,
    // even if we want to run multiple fixed timesteps
    this.world.set(traits.PlayerRotation, ({ playerRotation }) => ({
      playerRotation: playerRotation + input.spinDelta * 0.01,
    }));

    const elapsedSeconds = this.elapsedSeconds(input.now);

    while (this.frameTimeMillis >= MILLIS_PER_FRAME) {
      // timestep
      this.frameTimeMillis -= MILLIS_PER_FRAME;

      this.world.set(traits.ElapsedSeconds, { elapsedSeconds });

      // advance beat index
      let { beatIndex } = this.world.get(traits.BeatIndex)!;
      let nextBeat = this.beats[beatIndex + 1];
      while (nextBeat < elapsedSeconds) {
        nextBeat = this.beats[++beatIndex + 1];
      }
      this.world.set(traits.BeatIndex, { beatIndex });

      // set beat proximity
      const beatBefore = this.beats[beatIndex];
      const beatAfter = this.beats[beatIndex + 1];
      let beatProximity: number;
      if (beatAfter !== undefined) {
        let beatDuration = beatAfter - beatBefore;
        let midpoint = beatBefore + beatDuration / 2;
        let numerator =
          elapsedSeconds < midpoint
            ? elapsedSeconds - beatBefore
            : beatAfter - elapsedSeconds;
        beatProximity = numerator / (beatDuration / 2);
      } else {
        beatProximity = 0;
      }
      this.world.set(traits.BeatProximity, { beatProximity });

      // time-based animation
      const pyramidRollFrac = frac(2 * 0.1 * elapsedSeconds);
      // update player/pyramid orbit & rotation
      const prox = this.world.get(traits.BeatProximity)!;
      const pyramidStart = mat4.translation(
        vec3.create(1.15 - 0.5 + 0.1 * prox.beatProximity, 0, 0),
      );
      const pyramidUp = mat4.rotationZ(-Math.PI / 2);
      const pyramidLocalRoll = mat4.rotationX(TAU * pyramidRollFrac);
      const pyramidLocalRotation = mat4.multiply(pyramidUp, pyramidLocalRoll);
      const { playerRotation } = this.world.get(traits.PlayerRotation)!;
      const pyramidOrbitRotation = mat4.rotationZ(TAU * playerRotation);

      const player = this.world.queryFirst(traits.IsPlayer)!;
      const pyramid = player.get(traits.GPUPyramid)!;
      mat4.multiply(
        mat4.multiply(pyramidLocalRotation, pyramidStart),
        pyramidOrbitRotation,
        pyramid.transform,
      );

      // spawn any unspawned obstacles from the level data for the current timestamp
      let { nextLevelEvent } = this.world.get(traits.NextLevelEvent)!;
      let nextEvent = level.events[nextLevelEvent];
      while (nextEvent && nextEvent.atSeconds <= elapsedSeconds) {
        const gapIndex = nextEvent.gapIndex % PENTA_SIDES;
        const pentagon = this.world.spawn(
          traits.Obstacle({
            spawnTime: nextEvent.atSeconds,
            gapIndex,
            radius: 1.75,
            descentRate: 0.3,
          }),
        );
        this.spawnPolygonSides({
          radius: nextEvent.radius,
          gapIndex,
          polygon: pentagon,
        });

        nextEvent = level.events[++nextLevelEvent];
      }
      this.world.set(traits.NextLevelEvent, { nextLevelEvent });

      this.world
        .query(traits.Obstacle)
        .updateEach(([obstacle], obstacleEnt) => {
          const age = elapsedSeconds - obstacle.spawnTime;
          const radius = obstacle.radius - age * obstacle.descentRate;
          if (radius <= 0) {
            obstacleEnt.destroy();
            return;
          }

          // completely recreate the sides
          this.world
            .query(traits.GPUBox, traits.BelongsTo(obstacleEnt))
            .updateEach((_, sideEnt) => {
              sideEnt.destroy();
            });
          this.spawnPolygonSides({
            radius,
            gapIndex: obstacle.gapIndex % PENTA_SIDES,
            polygon: obstacleEnt,
          });
        });

      // check collision against every edge box
      this.world
        .query(traits.IsPlayer, traits.GPUPyramid)
        .readEach(([pyramid]) => {
          this.world.query(traits.GPUBox).readEach(([box]) => {
            const collided = collision.pyramidVsBox(
              pyramid.transform,
              pyramid.height,
              pyramid.radii[0],
              pyramid.radii[1],
              box.transform,
              box.radii,
            );

            this.paused ||= collided;
          });
        });
    }

    // update light placement
    const sunRotation = mat4.rotationY(TAU * elapsedSeconds * 0.1);
    const { sunPosition } = this.world.get(traits.SunPosition)!;
    vec3.transformMat4(SUN_START, sunRotation, sunPosition);
    const { moonPosition } = this.world.get(traits.MoonPosition)!;
    vec3.negate(this.sunPos, moonPosition);
  }

  elapsedSeconds(nowMillis: number): number {
    return (nowMillis - this.startTimeMillis) / 1000;
  }

  playAudio(buffer: AudioBuffer): void {
    let source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.musicGain);
    source.start();
  }

  draw(): void {
    const pyramids: DrawArgs["pyramids"] = [];
    this.world.query(traits.GPUPyramid).readEach(([p]) => {
      pyramids.push({
        transform: mat4x4fFromArray(p.transform),
        radii: toWebGPUVec2(p.radii),
        color: toWebGPUVec3(p.color),
        height: p.height,
      });
    });

    const boxes: DrawArgs["boxes"] = [];
    this.world.query(traits.GPUBox).readEach(([b]) => {
      boxes.push({
        transform: mat4x4fFromArray(b.transform),
        radii: toWebGPUVec3(b.radii),
        color: d.vec3f(0.7, 0.3, 0.3),
      });
    });

    const spheres = [
      {
        radius: 0.5,
        center: d.vec3f(0.0, 0.0, 0.0),
        color: d.vec3f(0.3, 0.3, 0.7),
      },
    ];

    const { sunPosition } = this.world.get(traits.SunPosition)!;
    const { moonPosition } = this.world.get(traits.MoonPosition)!;
    const { elapsedSeconds } = this.world.get(traits.ElapsedSeconds)!;

    this.renderer.draw({
      elapsedSeconds,
      sunPosition,
      moonPosition,
      spheres,
      pyramids,
      boxes,
    });
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
        traits.GPUBox({ transform, radii }),
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
