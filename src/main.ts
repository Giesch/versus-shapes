import "./style.css";

import { PLAYER_1 } from "@rcade/plugin-input-classic";

import { Renderer } from "./renderer";

const MILLIS_PER_FRAME = 16.6;
const SOUND_EFFECT_COOLDOWN_MS = 500;

/** initial dependencies to construct a GameState */
interface GameStateDeps {
  startTimeMillis: number;
  lastTimeMillis: number;
  audioCtx: AudioContext;
  renderer: Renderer;
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

  constructor(deps: GameStateDeps) {
    this.startTimeMillis = deps.startTimeMillis;
    this.lastTimeMillis = deps.lastTimeMillis;
    this.frameTimeMillis = 0.0;

    this.audioCtx = deps.audioCtx;
    this.renderer = deps.renderer;
  }

  update(input: FrameInput): void {
    const deltaTimeMillis = input.now - this.lastTimeMillis;
    this.frameTimeMillis += deltaTimeMillis;
    this.lastTimeMillis = input.now;

    while (this.frameTimeMillis >= MILLIS_PER_FRAME) {
      this.frameTimeMillis -= MILLIS_PER_FRAME;

      // TODO move into renderer method, making camera private?
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

  tryPlaySoundEffect(input: boolean, soundEffect: SoundEffect): void {
    if (input && soundEffect.cooldown <= 0.0) {
      this.playAudio(soundEffect.buffer);
      soundEffect.cooldown = SOUND_EFFECT_COOLDOWN_MS;
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

class SoundEffect {
  buffer: AudioBuffer;
  /** millis until we can play the sound effect again */
  cooldown: number;

  constructor(buffer: AudioBuffer) {
    this.buffer = buffer;
    this.cooldown = 0.0;
  }
}

async function init() {
  const audioCtx = new AudioContext();
  const renderer = await Renderer.init();

  const startTimeMillis = performance.now();
  const game = new GameState({
    startTimeMillis,
    lastTimeMillis: startTimeMillis,
    audioCtx,
    renderer,
  });

  const frame = () => {
    const now = performance.now();
    game.update({ now, playerOne: PLAYER_1 });
    game.draw(now);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

init();
