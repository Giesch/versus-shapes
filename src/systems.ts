import * as koota from "koota";
import { mat4, vec3 } from "wgpu-matrix";

import * as traits from "./traits";

/** update the index into the array of beat timestamps */
export function advanceBeatIndex(world: koota.World) {
  const { beatTimestamps } = world.get(traits.BeatTimestamps)!;
  const { elapsedSeconds } = world.get(traits.ElapsedSeconds)!;

  let { beatIndex } = world.get(traits.BeatIndex)!;
  let nextBeat = beatTimestamps[beatIndex + 1];
  while (nextBeat < elapsedSeconds) {
    nextBeat = beatTimestamps[++beatIndex + 1];
  }

  world.set(traits.BeatIndex, { beatIndex });
}

/** calculate how close we are to the nearest beat timestamp */
export function setBeatProximity(world: koota.World) {
  const { beatTimestamps } = world.get(traits.BeatTimestamps)!;
  const { elapsedSeconds } = world.get(traits.ElapsedSeconds)!;
  const { beatIndex } = world.get(traits.BeatIndex)!;

  const beatBefore = beatTimestamps[beatIndex];
  const beatAfter = beatTimestamps[beatIndex + 1];

  let beatProximity = 0;
  if (beatAfter !== undefined) {
    const beatDuration = beatAfter - beatBefore;
    const midpoint = beatBefore + beatDuration / 2;
    const numerator =
      elapsedSeconds < midpoint
        ? elapsedSeconds - beatBefore
        : beatAfter - elapsedSeconds;

    beatProximity = numerator / (beatDuration / 2);
  }

  world.set(traits.BeatProximity, { beatProximity });
}

const TAU = Math.PI * 2;

/** update player/pyramid orbit & rotation; including time-based bounce animation */
export function updatePlayerPyramidPosition(world: koota.World) {
  const { elapsedSeconds } = world.get(traits.ElapsedSeconds)!;
  const { beatProximity } = world.get(traits.BeatProximity)!;

  const pyramidRollFrac = frac(2 * 0.1 * elapsedSeconds);
  const bounce = 0.1 * beatProximity;
  const pyramidStart = mat4.translation(vec3.create(1.15 - 0.5 + bounce, 0, 0));

  const pyramidUp = mat4.rotationZ(-Math.PI / 2);
  const pyramidLocalRoll = mat4.rotationX(TAU * pyramidRollFrac);
  const pyramidLocalRotation = mat4.multiply(pyramidUp, pyramidLocalRoll);
  const { playerRotation } = world.get(traits.PlayerRotation)!;
  const pyramidOrbitRotation = mat4.rotationZ(TAU * playerRotation);

  const player = world.queryFirst(traits.IsPlayer)!;
  const pyramid = player.get(traits.CPUPyramid)!;

  mat4.multiply(
    mat4.multiply(pyramidLocalRotation, pyramidStart),
    pyramidOrbitRotation,
    pyramid.transform,
  );
}

function frac(num: number): number {
  return num - Math.floor(num);
}
