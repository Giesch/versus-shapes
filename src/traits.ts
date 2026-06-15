import * as koota from "koota";
import { mat4, vec2, vec3 } from "wgpu-matrix";

// ENTITY TRAITS

export const IsPlayer = koota.trait();

/** a descending polygon in the level geometry */
export const Obstacle = koota.trait({
  spawnTime: 0,
  gapIndex: 0,
  radius: 1.75,
  descentRate: 0.3,
});

/** the component sides of an obstacle */
export const GPUBox = koota.trait({
  transform: () => mat4.create(),
  radii: () => vec3.create(),
});

export const GPUPyramid = koota.trait({
  transform: () => mat4.create(),
  radii: () => vec2.create(0.075, 0.05),
  color: () => vec3.create(0.3, 0.7, 0.3),
  height: 0,
});

// SINGLETONS

export const ElapsedSeconds = koota.trait({ elapsedSeconds: 0 });

/**
 * the index of the last beat timestamp that we've passed;
 * we're between this one and the next
 */
export const BeatIndex = koota.trait({ beatIndex: 0 });
export const BeatProximity = koota.trait({ beatProximity: 0 });

/** the player's input rotation; 0.0 == 1.0 == pointing left */
export const PlayerRotation = koota.trait({ playerRotation: 0 });

/** the index of the next unexecuted event in the level data */
export const NextLevelEvent = koota.trait({ nextLevelEvent: 0 });

export const SunPosition = koota.trait({ sunPosition: () => vec3.create() });
export const MoonPosition = koota.trait({ moonPosition: () => vec3.create() });

// RELATIONS

/** boxes belong to pentagons */
export const BelongsTo = koota.relation({ autoDestroy: "orphan" });
