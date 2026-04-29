import "./style.css";

import { PLAYER_1 } from "@rcade/plugin-input-classic";

import { Renderer, mat4x4fFromArray, type DrawArgs } from "./renderer";
import * as audio from "./audio";
import { mat4, vec3, type Mat4, type Vec3 } from "wgpu-matrix";
import { d } from "typegpu";

const MILLIS_PER_FRAME = 16.6;

const TAU = Math.PI * 2;
const MOON_START = vec3.create(1, 0, 1);
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
  boxTransform: Mat4;

  constructor(deps: GameStateDeps) {
    this.startTimeMillis = deps.startTimeMillis;
    this.lastTimeMillis = deps.lastTimeMillis;
    this.frameTimeMillis = 0.0;

    this.audioCtx = deps.audioCtx;
    this.renderer = deps.renderer;
    this.assets = deps.assets;

    this.sunPos = vec3.clone(SUN_START);
    this.boxTransform = mat4.identity();
  }

  update(input: FrameInput): void {
    const deltaTimeMillis = input.now - this.lastTimeMillis;
    this.frameTimeMillis += deltaTimeMillis;
    this.lastTimeMillis = input.now;

    while (this.frameTimeMillis >= MILLIS_PER_FRAME) {
      this.frameTimeMillis -= MILLIS_PER_FRAME;

      this.renderer.camera.applyInput({
        pitchUp: input.playerOne.DPAD.up,
        pitchDown: input.playerOne.DPAD.down,
        yawLeft: input.playerOne.DPAD.left,
        yawRight: input.playerOne.DPAD.right,
        zoomIn: input.playerOne.A,
        zoomOut: input.playerOne.B,
      });

      const elapsedSeconds = (input.now - this.startTimeMillis) / 1000;
      const slowElapsed = elapsedSeconds * 0.1;

      // update sun orbit
      const sunRotation = mat4.rotationY(TAU * frac(slowElapsed * 0.25));
      vec3.transformMat4(SUN_START, sunRotation, this.sunPos);

      // update cube orbit
      const localRot = mat4.rotationZ(TAU * frac(2 * slowElapsed));
      const translation = mat4.translation(MOON_START);
      const orbitRot = mat4.rotationY(TAU * frac(slowElapsed));
      mat4.multiply(
        mat4.multiply(localRot, translation),
        orbitRot,
        this.boxTransform,
      );
    }
  }

  playAudio(buffer: AudioBuffer): void {
    let source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioCtx.destination);
    source.start();
  }

  draw(now: number): void {
    // TODO  share with update?
    const elapsedSeconds = (now - this.startTimeMillis) / 1000;

    const pyramids: DrawArgs["pyramids"] = [];
    const spheres: DrawArgs["spheres"] = [
      {
        center: d.vec3f(0.0, 0.0, 0.0),
        radius: 1.0,
        color: d.vec3f(0.2, 0.2, 0.6),
      },
    ];
    const boxes = [
      {
        transform: mat4x4fFromArray(this.boxTransform),
        radii: d.vec3f(0.2, 0.2, 0.2),
        color: d.vec3f(0.2, 0.6, 0.2),
      },
    ];

    this.renderer.draw({
      elapsedSeconds,
      lightPosition: this.sunPos,
      pyramids,
      spheres,
      boxes,
    });
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
