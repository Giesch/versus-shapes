import "./style.css";

import { PLAYER_1 } from "@rcade/plugin-input-classic";

import { Renderer } from "./renderer";
import * as audio from "./audio";

const MILLIS_PER_FRAME = 16.6;

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

  constructor(deps: GameStateDeps) {
    this.startTimeMillis = deps.startTimeMillis;
    this.lastTimeMillis = deps.lastTimeMillis;
    this.frameTimeMillis = 0.0;

    this.audioCtx = deps.audioCtx;
    this.renderer = deps.renderer;
    this.assets = deps.assets;
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
    }
  }

  playAudio(buffer: AudioBuffer): void {
    let source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioCtx.destination);
    source.start();
  }

  draw(now: number): void {
    const elapsedSeconds = (now - this.startTimeMillis) / 1000;
    this.renderer.draw({ elapsedSeconds });
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
