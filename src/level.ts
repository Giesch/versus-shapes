export type Level = {
  obstacles: LevelObstacle[];
};

// a union of spawnable shapes
export type ObstacleShape = "pentagon";

/**
 * A spawned obstacle described by the level data. It appears at `spawnTime`
 * (game elapsed seconds), then its circumradius shrinks from `radius` toward 0
 * at `descentRate` units/sec; once the radius hits 0 the obstacle is despawned.
 */
export interface LevelObstacle {
  type: ObstacleShape;
  spawnTime: number;
  gapIndex: number;
  radius: number;
  descentRate: number;
}
