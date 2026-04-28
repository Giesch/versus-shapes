// slightly modified from the official MDN webgpu examples repo
// https://github.com/webgpu/webgpu-samples

// Show an error dialog if there's any uncaught exception or promise rejection.
// This gets set up on all pages that include util.ts.
globalThis.addEventListener("unhandledrejection", (ev) => {
  fail(`unhandled promise rejection\n${ev.reason}`);
});
globalThis.addEventListener("error", (ev) => {
  fail(`uncaught exception\n${ev.error}`);
});

/** Shows an error dialog if getting an adapter wasn't successful. */
export function quitIfAdapterNotAvailable(
  adapter: GPUAdapter | null,
): asserts adapter {
  if (!("gpu" in navigator)) {
    fail("navigator.gpu is not defined - WebGPU not available in this browser");
  }

  if (!adapter) {
    fail("requestAdapter returned null - this sample can't run on this system");
  }
}

export function quitIfLimitLessThan(
  adapter: GPUAdapter,
  limit: string,
  requiredValue: number,
  limits: Record<string, GPUSize32>,
) {
  if (limit in adapter.limits) {
    const limitKey = limit as keyof GPUSupportedLimits;
    const limitValue = adapter.limits[limitKey] as number;
    if (limitValue < requiredValue) {
      fail(
        `This sample can't run on this system. ${limit} is ${limitValue}, and this sample requires at least ${requiredValue}.`,
      );
    }
    limits[limit] = requiredValue;
  }
}

/**
 * Shows an error dialog if getting an adapter wasn't successful or the adapter
 * does not support the given list of features.
 */
export function quitIfFeaturesNotAvailable(
  adapter: GPUAdapter | null,
  requiredFeatures: GPUFeatureName[],
): asserts adapter {
  quitIfAdapterNotAvailable(adapter);

  for (const feature of requiredFeatures) {
    if (!adapter.features.has(feature)) {
      fail(
        `This sample requires the '${feature}' feature, which is not supported by this system.`,
      );
    }
  }
}

function supportsDirectBufferBinding(device: GPUDevice): boolean {
  const buffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM,
  });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} }],
  });

  try {
    device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: buffer }],
    });
    return true;
  } catch {
    return false;
  } finally {
    buffer.destroy();
  }
}

function supportsDirectTextureBinding(device: GPUDevice): boolean {
  const texture = device.createTexture({
    size: [1],
    usage: GPUTextureUsage.TEXTURE_BINDING,
    format: "rgba8unorm",
  });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }],
  });

  try {
    device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: texture }],
    });
    return true;
  } catch {
    return false;
  } finally {
    texture.destroy();
  }
}

function supportsDirectTextureAttachments(device: GPUDevice): boolean {
  const texture = device.createTexture({
    size: [1],
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    format: "rgba8unorm",
    sampleCount: 4,
  });
  const resolveTarget = device.createTexture({
    size: [1],
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    format: "rgba8unorm",
  });
  const depthTexture = device.createTexture({
    size: [1],
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    format: "depth16unorm",
    sampleCount: 4,
  });
  const encoder = device.createCommandEncoder();
  try {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: texture, resolveTarget, loadOp: "load", storeOp: "store" },
      ],
      depthStencilAttachment: {
        view: depthTexture,
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    });
    pass.end();
    return true;
  } catch (e) {
    console.error(e);
    return false;
  } finally {
    encoder.finish();
    texture.destroy();
    resolveTarget.destroy();
  }
}

/**
 * Shows an error dialog if getting a adapter or device wasn't successful,
 * or if/when the device is lost or has an uncaptured error. Also checks
 * for direct buffer binding, direct texture binding,
 * and direct texture attachment binding.
 */
export function quitIfWebGPUNotAvailableOrMissingFeatures(
  adapter: GPUAdapter | null,
  device: GPUDevice | null,
): asserts device {
  if (!device) {
    quitIfAdapterNotAvailable(adapter);
    fail("Unable to get a device for an unknown reason");
  }

  device.lost.then((reason) => {
    fail(`Device lost ("${reason.reason}"):\n${reason.message}`);
  });
  device.addEventListener("uncapturederror", (ev) => {
    fail(`Uncaptured error:\n${ev.error.message}`);
  });

  if (
    !supportsDirectBufferBinding(device) ||
    !supportsDirectTextureBinding(device) ||
    !supportsDirectTextureAttachments(device)
  ) {
    fail(
      "Core features of WebGPU are unavailable. Please update your browser to a newer version.",
    );
  }
}

type DialogMode = "fatal" | "recoverable" | null;

interface ErrorOutput {
  fail(msg: string): void;
  showRecoverable(msg: string): void;
  clearRecoverable(): void;
}

/** dev mode error display not supported from workers */
class ConsoleErrorOutput implements ErrorOutput {
  fail(msg: string) {
    console.error(msg);
  }

  showRecoverable(msg: string) {
    console.error(msg);
  }

  clearRecoverable() {}
}

/** display webgpu errors and wgsl compilation errors (from hot reload) in a dialog */
class DialogErrorOutput implements ErrorOutput {
  private mode: DialogMode;
  private dialogBox: HTMLDialogElement;
  private dialogText: HTMLPreElement;

  private constructor(
    dialogBox: HTMLDialogElement,
    dialogText: HTMLPreElement,
  ) {
    this.mode = null;
    this.dialogBox = dialogBox;
    this.dialogText = dialogText;
  }

  public static setup(): DialogErrorOutput {
    const dialogBox = document.createElement("dialog");
    dialogBox.close();
    document.body.append(dialogBox);

    const dialogText = document.createElement("pre");
    dialogText.style.whiteSpace = "pre-wrap";
    dialogBox.append(dialogText);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "OK";
    closeBtn.onclick = () => dialogBox.close();
    dialogBox.append(closeBtn);

    return new DialogErrorOutput(dialogBox, dialogText);
  }

  fail(msg: string) {
    // a fatal error is never overwritten
    if (this.mode === "fatal") return;

    this.mode = "fatal";
    this.dialogText.textContent = msg;

    if (!this.dialogBox.open) {
      this.dialogBox.showModal();
    }
  }

  showRecoverable(msg: string) {
    // avoid overwriting a fatal error with a recoverable one
    if (this.mode === "fatal") return;

    this.mode = "recoverable";
    this.dialogText.textContent = msg;

    if (!this.dialogBox.open) {
      this.dialogBox.showModal();
    }
  }

  clearRecoverable() {
    if (this.mode !== "recoverable") return;

    this.mode = null;
    this.dialogBox.close();
  }
}

function createErrorOutput(): ErrorOutput {
  if (!document) return new ConsoleErrorOutput();

  return DialogErrorOutput.setup();
}

let output: ErrorOutput | undefined;
function getOutput(): ErrorOutput {
  if (!output) {
    output = createErrorOutput();
  }

  return output;
}

/** Fail by showing a console error, and dialog box if possible. */
function fail(message: string): never {
  getOutput().fail(message);
  throw new Error(message);
}

/**
 * Show a non-fatal error in the shared modal (eg, wgsl compilation failure).
 * Overwrites any prior recoverable * message. Will not overwrite a fatal error.
 */
export function showRecoverableError(message: string): void {
  getOutput().showRecoverable(message);
}

/**
 * Dismiss the modal if it's currently showing a recoverable error. Leaves a
 * fatal error alone.
 */
export function clearRecoverableError(): void {
  getOutput().clearRecoverable();
}
