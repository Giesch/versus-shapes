export async function load(
  audioCtx: AudioContext,
  path: string,
): Promise<AudioBuffer> {
  const response = await fetch(path);
  const buffer = await response.arrayBuffer();
  return audioCtx.decodeAudioData(buffer);
}
