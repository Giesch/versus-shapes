import * as koota from "koota";

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
