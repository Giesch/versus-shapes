import "./style.css";

import { PLAYER_1 } from "@rcade/plugin-input-classic";
import * as spinners from "@rcade/plugin-input-spinners";

import { Renderer, mat4x4fFromArray } from "./renderer";
import * as audio from "./audio";
import { mat4, vec3, type Vec3 } from "wgpu-matrix";
import { d } from "typegpu";

import versusShapesJson from "./data/versus-shapes.beats.json";

const MILLIS_PER_FRAME = 16.6;

const TAU = Math.PI * 2;
const SUN_START = vec3.create(4, 5, 2);
const frac = (x: number): number => x - Math.floor(x);

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

  sunPos: Vec3;

  // NOTE 0.0 == 1.0 == pointing left
  currentRotationTurns: number;
  pyramidRollFrac: number;

  /** the beat timestamps from essentia */
  beats: number[];
  /**
   * the index of the last beat timestamp that we've passed;
   * we're between this one and the next
   */
  beatIndex: number;
  beatProximity: number;

  constructor(deps: GameStateDeps) {
    this.startTimeMillis = deps.startTimeMillis;
    this.lastTimeMillis = deps.startTimeMillis;
    this.frameTimeMillis = 0.0;

    this.currentRotationTurns = 0.25;
    this.pyramidRollFrac = 0.0;

    this.audioCtx = deps.audioCtx;
    this.musicGain = this.audioCtx.createGain();
    this.musicGain.gain.value = 1.2;
    this.musicGain.connect(this.audioCtx.destination);

    this.renderer = deps.renderer;
    this.assets = deps.assets;

    this.sunPos = vec3.clone(SUN_START);

    this.beats = versusShapesJson.beats;
    this.beatIndex = 0;
    this.beatProximity = 0;
  }

  update(input: FrameInput): void {
    const deltaTimeMillis = input.now - this.lastTimeMillis;
    this.frameTimeMillis += deltaTimeMillis;
    this.lastTimeMillis = input.now;

    while (this.frameTimeMillis >= MILLIS_PER_FRAME) {
      // timestep
      this.frameTimeMillis -= MILLIS_PER_FRAME;

      const elapsedSeconds = this.elapsedSeconds(input.now);

      // advance beat index
      let nextBeat = this.beats[this.beatIndex + 1];
      while (nextBeat < elapsedSeconds) {
        this.beatIndex++;
        nextBeat = this.beats[this.beatIndex + 1];
      }

      // set beat proximity
      const beatBefore = this.beats[this.beatIndex];
      const beatAfter = this.beats[this.beatIndex + 1];
      if (beatAfter) {
        let beatDuration = beatAfter - beatBefore;
        let midpoint = beatBefore + beatDuration / 2;
        let numerator =
          elapsedSeconds < midpoint
            ? elapsedSeconds - beatBefore
            : beatAfter - elapsedSeconds;
        this.beatProximity = numerator / (beatDuration / 2);
      } else {
        this.beatProximity = 0;
      }

      // time-based animation
      this.pyramidRollFrac = frac(2 * 0.1 * elapsedSeconds);

      // input
      this.currentRotationTurns += input.spinDelta * 0.01;
    }
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

  draw(now: number): void {
    const sunRotation = mat4.rotationY(TAU * this.elapsedSeconds(now) * 0.1);
    vec3.transformMat4(SUN_START, sunRotation, this.sunPos);

    // update pyramid orbit & rotation
    const pyramidStart = mat4.translation(
      vec3.create(1.15 - 0.25 + 0.1 * this.beatProximity, 0, 0),
    );
    const pyramidUp = mat4.rotationZ(-Math.PI / 2);
    const pyramidLocalRoll = mat4.rotationX(TAU * this.pyramidRollFrac);
    const pyramidLocalRotation = mat4.multiply(pyramidUp, pyramidLocalRoll);
    const pyramidOrbitRotation = mat4.rotationZ(
      TAU * this.currentRotationTurns,
    );
    const pyramidTransform = mat4.multiply(
      mat4.multiply(pyramidLocalRotation, pyramidStart),
      pyramidOrbitRotation,
    );

    this.renderer.draw({
      elapsedSeconds: this.elapsedSeconds(now),
      lightPosition: this.sunPos,
      pyramids: [
        {
          transform: mat4x4fFromArray(pyramidTransform),
          height: 0.4 + 0.05 * this.beatProximity,
          radii: d.vec2f(0.15, 0.1),
          color: d.vec3f(0.2, 0.6, 0.2),
        },
      ],
      spheres: [
        {
          center: d.vec3f(0.0, 0.0, 0.0),
          radius: 0.75,
          color: d.vec3f(0.2, 0.2, 0.6),
        },
      ],
      boxes: [],
    });
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
    const now = performance.now();
    let spinDelta = spinners.PLAYER_1.SPINNER.consume_step_delta();
    game.update({ now, spinDelta, playerOne: PLAYER_1 });
    game.draw(now);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

init();
