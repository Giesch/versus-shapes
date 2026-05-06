import "./style.css";

import { PLAYER_1 } from "@rcade/plugin-input-classic";

import { Renderer, mat4x4fFromArray, type DrawArgs } from "./renderer";
import * as audio from "./audio";
import { mat4, vec3, type Mat4, type Vec3 } from "wgpu-matrix";
import { d } from "typegpu";

const MILLIS_PER_FRAME = 16.6;

const TAU = Math.PI * 2;
const PYRAMID_START = vec3.create(1.25, 0, 0);
const SUN_START = vec3.create(4, 5, 2);
const frac = (x: number): number => x - Math.floor(x);

/** initial dependencies to construct a GameState */
interface GameStateDeps {
  startTimeMillis: number;
  lastTimeMillis: number;
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
  /** Player 1's inputs */
  playerOne: typeof PLAYER_1;
}

class GameState {
  /** the initial value of performance.now() at app start */
  startTimeMillis: number;
  /** the value of performance.now() at the top of the previous frame */
  lastTimeMillis: number;
  /** the accumulator of 'unspent' time for the fixed timestep */
  frameTimeMillis: number;

  // IO
  audioCtx: AudioContext;
  renderer: Renderer;
  assets: Assets;

  sunPos: Vec3;
  pyramidTransform: Mat4;

  pyramids: DrawArgs["pyramids"];

  constructor(deps: GameStateDeps) {
    this.startTimeMillis = deps.startTimeMillis;
    this.lastTimeMillis = deps.lastTimeMillis;
    this.frameTimeMillis = 0.0;

    this.audioCtx = deps.audioCtx;
    this.renderer = deps.renderer;
    this.assets = deps.assets;

    this.sunPos = vec3.clone(SUN_START);
    this.pyramidTransform = mat4.identity();
    this.pyramids = [this.drawPyramid(this.pyramidTransform)];
  }

  update(input: FrameInput): void {
    const deltaTimeMillis = input.now - this.lastTimeMillis;
    this.frameTimeMillis += deltaTimeMillis;
    this.lastTimeMillis = input.now;

    while (this.frameTimeMillis >= MILLIS_PER_FRAME) {
      this.frameTimeMillis -= MILLIS_PER_FRAME;

      const slowElapsed = this.elapsedSeconds(input.now) * 0.1;

      // update sun orbit
      const sunRotation = mat4.rotationY(TAU);
      vec3.transformMat4(SUN_START, sunRotation, this.sunPos);

      // update pyramid orbit & rotation
      const pyramidStart = mat4.translation(PYRAMID_START);
      const pyramidUp = mat4.rotationZ(-Math.PI / 2);
      const pyramidLocalRoll = mat4.rotationX(TAU * frac(2 * slowElapsed));
      const pyramidLocalRotation = mat4.multiply(pyramidUp, pyramidLocalRoll);
      const pyramidOrbitRotation = mat4.rotationZ(
        TAU * frac(slowElapsed) - 1.0,
      );
      mat4.multiply(
        mat4.multiply(pyramidLocalRotation, pyramidStart),
        pyramidOrbitRotation,
        this.pyramidTransform,
      );
      this.pyramids[0] = this.drawPyramid(this.pyramidTransform);
    }
  }

  elapsedSeconds(nowMillis: number): number {
    return (nowMillis - this.startTimeMillis) / 1000;
  }

  playAudio(buffer: AudioBuffer): void {
    let source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioCtx.destination);
    source.start();
  }

  draw(now: number): void {
    this.renderer.draw({
      elapsedSeconds: this.elapsedSeconds(now),
      lightPosition: this.sunPos,
      pyramids: this.pyramids,
      // TODO also instance var?
      spheres: [
        {
          center: d.vec3f(0.0, 0.0, 0.0),
          radius: 1.0,
          color: d.vec3f(0.2, 0.2, 0.6),
        },
      ],
      boxes: [],
    });
  }

  drawPyramid(pyramidTransform: Mat4) {
    return {
      transform: mat4x4fFromArray(pyramidTransform),
      height: 0.4,
      radii: d.vec2f(0.15, 0.1),
      color: d.vec3f(0.6, 0.2, 0.2),
    };
  }
}

async function init() {
  const audioCtx = new AudioContext();
  const versusShapes = await audio.load(audioCtx, "./versus-shapes.mp3");
  const assets: Assets = { versusShapes };

  const renderer = await Renderer.init();

  const startTimeMillis = performance.now();
  const game = new GameState({
    startTimeMillis,
    lastTimeMillis: startTimeMillis,
    audioCtx,
    renderer,
    assets,
  });

  game.playAudio(game.assets.versusShapes);

  const frame = () => {
    const now = performance.now();
    game.update({ now, playerOne: PLAYER_1 });
    game.draw(now);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

init();
