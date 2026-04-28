// this is a workaround for a missing exported declaration in the main repo
// it can be removed once it is no longer needed to silence an error
declare module "@rcade/sdk" {
  export class PluginChannel {
    static acquire(name: string, version: string): Promise<PluginChannel>;
    getPort(): MessagePort;
    getVersion(): string;
    request<T = unknown>(
      message: Record<string, unknown>,
      timeoutMs?: number,
    ): Promise<T>;
  }
}
