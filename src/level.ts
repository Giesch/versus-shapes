export type Level = {
  events: LevelEvent[];
};

// a union of things that can happen in a level
export type LevelEventTag = "spawnPentagon";

/**
 * A spawned obstacle described by the level data. It appears at `spawnTime`
 * (game elapsed seconds), then its circumradius shrinks from `radius` toward 0
 * at `descentRate` units/sec; once the radius hits 0 the obstacle is despawned.
 */
export type SpawnPentagon = {
  type: "spawnPentagon";
  atSeconds: number;
  gapIndex: number;
  radius: number;
  descentRate: number;
};

/** union type of all level evetns */
export type LevelEvent = SpawnPentagon;
