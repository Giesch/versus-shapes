import { mat4, vec3, type Vec3 } from "wgpu-matrix";
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
import {
  RayMarchingParams,
  SpheresArray,
  BoxesArray,
  sdfLayout,
  PyramidsArray,
  Sphere,
  Pyramid,
  Box,
} from "./shaders/schemas";
import { mainVertex } from "./shaders/vertex";
import { mainFragment } from "./shaders/fragment";

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
  lightPosition: Vec3;
  pyramids: d.Infer<typeof Pyramid>[];
  spheres: d.Infer<typeof Sphere>[];
  boxes: d.Infer<typeof Box>[];
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

  public draw({ lightPosition, pyramids, spheres, boxes }: DrawArgs) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const aspect = width / Math.max(1, height);

    const eye = this.camera.position();
    const view = mat4.lookAt(eye, this.camera.target, vec3.create(0, 1, 0));
    const proj = mat4.perspective(Math.PI / 4, aspect, 0.1, 1000);
    const viewProj = mat4.multiply(proj, view);
    mat4.invert(viewProj, this.invViewProj);

    this.paramsBuffer.write({
      camera: {
        inverseViewProj: mat4x4fFromArray(this.invViewProj),
        position: d.vec3f(eye[0], eye[1], eye[2]),
      },
      lightPosition: d.vec3f(
        lightPosition[0],
        lightPosition[1],
        lightPosition[2],
      ),
      pyramidCount: pyramids.length,
      sphereCount: spheres.length,
      boxCount: boxes.length,
      resolution: d.vec2f(width, height),
    });

    // TODO patch pyramids
    this.spheresBuffer.patch(spheres);
    this.boxesBuffer.patch(boxes);

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

export const mat4x4fFromArray = (arr: ArrayLike<number>) =>
  d.mat4x4f(
    arr[0],
    arr[1],
    arr[2],
    arr[3],
    arr[4],
    arr[5],
    arr[6],
    arr[7],
    arr[8],
    arr[9],
    arr[10],
    arr[11],
    arr[12],
    arr[13],
    arr[14],
    arr[15],
  );
