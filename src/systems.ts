import * as koota from "koota";
import { mat4, vec3, type Vec3, type Mat4 } from "wgpu-matrix";
import { d } from "typegpu";

import * as traits from "./traits";
import * as collision from "./collision";
// TODO make the current level a world trait
import { level } from "./data/versus-shapes.level.ts";

const TAU = Math.PI * 2;
const PENTA_SIDES = 5;
const PENTA_INTERIOR = TAU / PENTA_SIDES;
const START_ANGLE = Math.PI / 2; // a vertex points up
const BAR_THICKNESS = 0.05;
const BAR_DEPTH = 0.15;

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

/** spawn any unspawned obstacles from the level data for the current timestamp */
export function spawnNewObstacles(world: koota.World) {
  const { elapsedSeconds } = world.get(traits.ElapsedSeconds)!;

  // spawn any unspawned obstacles from the level data for the current timestamp
  let { nextLevelEvent } = world.get(traits.NextLevelEvent)!;
  let nextEvent = level.events[nextLevelEvent];
  while (nextEvent && nextEvent.atSeconds <= elapsedSeconds) {
    world.spawn(
      // NOTE we rely on the sides being spawned later
      traits.Obstacle({
        spawnTime: nextEvent.atSeconds,
        gapIndex: nextEvent.gapIndex % PENTA_SIDES,
        radius: nextEvent.radius,
        descentRate: nextEvent.descentRate,
      }),
    );

    nextEvent = level.events[++nextLevelEvent];
  }

  world.set(traits.NextLevelEvent, { nextLevelEvent });
}

export function recreateSidesForObstacles(world: koota.World) {
  const { elapsedSeconds } = world.get(traits.ElapsedSeconds)!;

  world.query(traits.Obstacle).updateEach(([obstacle], obstacleEnt) => {
    const age = elapsedSeconds - obstacle.spawnTime;
    const radius = obstacle.radius - age * obstacle.descentRate;
    if (radius <= 0) {
      obstacleEnt.destroy();
      return;
    }

    // completely recreate the sides
    // TODO is there a better way to do this?
    world
      .query(traits.CPUBox, traits.BelongsTo(obstacleEnt))
      .updateEach((_, sideEnt) => {
        sideEnt.destroy();
      });
    spawnPolygonSides({
      world,
      radius,
      gapIndex: obstacle.gapIndex % PENTA_SIDES,
      polygon: obstacleEnt,
    });
  });
}

function spawnPolygonSides({
  world,
  radius,
  gapIndex,
  polygon,
}: {
  world: koota.World;
  radius: number;
  gapIndex: number;
  polygon: koota.Entity;
}) {
  const sides = buildPentagon(radius, gapIndex);
  for (const { transform, radii } of sides) {
    world.spawn(
      traits.CPUBox({ transform, radii }),
      // this relies on other properties being updated immediately before draw
      traits.GPUBox({ color: d.vec3f(0.7, 0.3, 0.3) }),
      traits.BelongsTo(polygon),
    );
  }
}

interface ObstacleBox {
  transform: Mat4;
  radii: Vec3;
}

/**
 * Build the edge boxes of a regular pentagon with circumradius `r`,
 * centered on the origin in the XY plane. Each box's `transform` is the
 * world->local matrix (inverse of the model matrix), matching the convention
 * used by the GPU shader and collision SDFs.
 *
 * Passing a `gapIndex` (0..SIDES-1) omits that one edge, leaving a gap in the
 * outline while the remaining sides keep their pentagon positions.
 */
function buildPentagon(r: number, gapIndex: number): ObstacleBox[] {
  const apothem = r * Math.cos(Math.PI / PENTA_SIDES);
  const halfLen = r * Math.sin(Math.PI / PENTA_SIDES) + BAR_THICKNESS / 2;

  const boxes: ObstacleBox[] = [];
  for (let i = 0; i < PENTA_SIDES; i++) {
    if (i === gapIndex) continue;

    const phiMid = START_ANGLE + (i + 0.5) * PENTA_INTERIOR;
    const midpoint = vec3.create(
      apothem * Math.cos(phiMid),
      apothem * Math.sin(phiMid),
      0,
    );
    const edgeAngle = phiMid + Math.PI / 2;
    const model = mat4.multiply(
      mat4.translation(midpoint),
      mat4.rotationZ(edgeAngle),
    );

    boxes.push({
      transform: mat4.invert(model),
      radii: vec3.create(halfLen, BAR_THICKNESS, BAR_DEPTH),
    });
  }

  return boxes;
}

/** check the pyramid's collision against every edge box */
export function checkCollision(world: koota.World): boolean {
  let collided = false;

  world.query(traits.IsPlayer, traits.CPUPyramid).readEach(([pyramid]) => {
    world.query(traits.CPUBox).readEach(([box]) => {
      collided ||= collision.pyramidVsBox(pyramid, box);
    });
  });

  return collided;
}

/** apply input from spinner */
export function updatePlayerRotation(world: koota.World, spinDelta: number) {
  let { playerRotation } = world.get(traits.PlayerRotation)!;
  playerRotation += spinDelta * 0.01;
  world.set(traits.PlayerRotation, { playerRotation });
}
