import { mat4, vec3 } from "wgpu-matrix";
import tgpu, {
  type TgpuRoot,
  type TgpuRenderPipeline,
  type TgpuBuffer,
  type TgpuBindGroup,
  type UniformFlag,
  type StorageFlag,
} from "typegpu";
import * as d from "typegpu/data";

import {
  clearRecoverableError,
  quitIfWebGPUNotAvailableOrMissingFeatures,
  showRecoverableError,
} from "./util";

import { Camera } from "./camera";
import { makeSphere, makeBox, mat4x4fFromArray } from "./scene";
import {
  RayMarchingParams,
  SpheresArray,
  BoxesArray,
  sdfLayout,
  PyramidsArray,
} from "./shaders/schemas";
import { mainVertex } from "./shaders/vertex";
import { mainFragment } from "./shaders/fragment";

const TAU = Math.PI * 2;
const MOON_START = vec3.create(1, 0, 1);
const SUN_START = vec3.create(4, 5, 2);
const frac = (x: number): number => x - Math.floor(x);

type SdfPipeline = TgpuRenderPipeline<d.Vec4f>;
type ParamsBuffer = TgpuBuffer<typeof RayMarchingParams> & UniformFlag;
type SpheresBuffer = TgpuBuffer<typeof SpheresArray> & StorageFlag;
type BoxesBuffer = TgpuBuffer<typeof BoxesArray> & StorageFlag;
type SdfBindGroup = TgpuBindGroup<{
  params: { uniform: typeof RayMarchingParams };
  spheres: { storage: typeof SpheresArray; access: "readonly" };
  boxes: { storage: typeof BoxesArray; access: "readonly" };
}>;

export interface RendererDeps {
  root: TgpuRoot;
  context: GPUCanvasContext;
  canvas: HTMLCanvasElement;
  pipeline: SdfPipeline;
  bindGroup: SdfBindGroup;
  paramsBuffer: ParamsBuffer;
  spheresBuffer: SpheresBuffer;
  boxesBuffer: BoxesBuffer;
}

export interface DrawArgs {
  elapsedSeconds: number;
}

export class Renderer {
  public camera: Camera;

  // rendering
  root: TgpuRoot;
  context: GPUCanvasContext;
  canvas: HTMLCanvasElement;
  pipeline: SdfPipeline;
  bindGroup: SdfBindGroup;
  paramsBuffer: ParamsBuffer;
  spheresBuffer: SpheresBuffer;
  boxesBuffer: BoxesBuffer;

  // CPU-side scene state
  invViewProj: Float32Array;
  pyramidCount: number;
  sphereCount: number;
  boxCount: number;

  private constructor(deps: RendererDeps) {
    this.camera = new Camera();

    this.root = deps.root;
    this.context = deps.context;
    this.canvas = deps.canvas;
    this.pipeline = deps.pipeline;
    this.bindGroup = deps.bindGroup;
    this.paramsBuffer = deps.paramsBuffer;
    this.spheresBuffer = deps.spheresBuffer;
    this.boxesBuffer = deps.boxesBuffer;

    this.invViewProj = new Float32Array(16);
    this.pyramidCount = 0;
    this.sphereCount = 1;
    this.boxCount = 1;

    // upload static spheres once; per-frame box upload happens in draw()
    this.spheresBuffer.patch({
      0: makeSphere(vec3.create(0, 0, 0), 1.0, vec3.create(0.2, 0.2, 0.6)),
    });
  }

  public static async init(): Promise<Renderer> {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const adapter = await navigator.gpu?.requestAdapter({
      featureLevel: "compatibility",
    });

    const device = (await adapter?.requestDevice()) || null;
    quitIfWebGPUNotAvailableOrMissingFeatures(adapter, device);

    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("no webgpu context available");

    const sizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    sizeCanvas();

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: presentationFormat,
    });

    const root = tgpu.initFromDevice({ device });

    const paramsBuffer = root.createBuffer(RayMarchingParams).$usage("uniform");
    const pyramidsBuffer = root.createBuffer(PyramidsArray).$usage("storage");
    const spheresBuffer = root.createBuffer(SpheresArray).$usage("storage");
    const boxesBuffer = root.createBuffer(BoxesArray).$usage("storage");

    const bindGroup = root.createBindGroup(sdfLayout, {
      params: paramsBuffer,
      pyramids: pyramidsBuffer,
      spheres: spheresBuffer,
      boxes: boxesBuffer,
    });

    let pipeline: SdfPipeline;
    try {
      pipeline = createSdfPipeline(
        root,
        presentationFormat,
        mainVertex,
        mainFragment,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showRecoverableError(msg);
      throw e;
    }

    const renderer = new Renderer({
      root,
      context,
      canvas,
      pipeline,
      bindGroup,
      paramsBuffer,
      spheresBuffer,
      boxesBuffer,
    });

    const ro = new ResizeObserver(sizeCanvas);
    ro.observe(canvas);

    if (import.meta.hot) {
      /// TODO modify this to not use closure state for these
      /// either use fields on Renderer or make a new class for hot reload state
      let currentVertex = mainVertex;
      let currentFragment = mainFragment;

      const rebuildPipeline = () => {
        try {
          renderer.pipeline = createSdfPipeline(
            root,
            presentationFormat,
            currentVertex,
            currentFragment,
          );
          clearRecoverableError();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(msg);
          showRecoverableError(msg);
        }
      };

      import.meta.hot.accept("./shaders/vertex.ts", (mod) => {
        if (mod) {
          currentVertex = mod.mainVertex;
        }
        rebuildPipeline();
      });

      import.meta.hot.accept("./shaders/fragment.ts", (mod) => {
        if (mod) {
          currentFragment = mod.mainFragment;
        }
        rebuildPipeline();
      });

      import.meta.hot.accept("./shaders/schemas.ts", () => {
        import.meta.hot!.invalidate();
      });
    }

    return renderer;
  }

  public draw({ elapsedSeconds }: DrawArgs) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const aspect = width / Math.max(1, height);

    const eye = this.camera.position();
    const view = mat4.lookAt(eye, this.camera.target, vec3.create(0, 1, 0));
    const proj = mat4.perspective(Math.PI / 4, aspect, 0.1, 1000);
    const viewProj = mat4.multiply(proj, view);
    mat4.invert(viewProj, this.invViewProj);

    const slowElapsed = elapsedSeconds * 0.1;

    const sunRotation = mat4.rotationY(TAU * frac(slowElapsed * 0.25));
    const sunPos = vec3.transformMat4(SUN_START, sunRotation);

    this.paramsBuffer.write({
      camera: {
        inverseViewProj: mat4x4fFromArray(this.invViewProj),
        position: d.vec3f(eye[0], eye[1], eye[2]),
      },
      lightPosition: d.vec3f(sunPos[0], sunPos[1], sunPos[2]),
      pyramidCount: this.pyramidCount,
      sphereCount: this.sphereCount,
      boxCount: this.boxCount,
      resolution: d.vec2f(width, height),
    });

    // Mirrors examples/ray_marching.rs: localRot * translation * orbitRot,
    // uploaded uninverted to match the Vulkan reference's visual.
    const localRot = mat4.rotationZ(TAU * frac(2 * slowElapsed));
    const translation = mat4.translation(MOON_START);
    const orbitRot = mat4.rotationY(TAU * frac(slowElapsed));
    const boxTransform = mat4.multiply(
      mat4.multiply(localRot, translation),
      orbitRot,
    );
    this.boxesBuffer.patch({
      0: makeBox(
        boxTransform,
        vec3.create(0.2, 0.2, 0.2),
        vec3.create(0.2, 0.6, 0.2),
      ),
    });

    this.pipeline
      .withColorAttachment({
        view: this.context.getCurrentTexture().createView(),
        clearValue: [0, 0, 0, 1],
        loadOp: "clear",
        storeOp: "store",
      })
      .with(this.bindGroup)
      .draw(3);
  }
}

function createSdfPipeline(
  root: TgpuRoot,
  presentationFormat: GPUTextureFormat,
  vertex: typeof mainVertex,
  fragment: typeof mainFragment,
): SdfPipeline {
  return root.createRenderPipeline({
    vertex,
    fragment,
    primitive: { topology: "triangle-list" },
    targets: { format: presentationFormat },
  });
}
