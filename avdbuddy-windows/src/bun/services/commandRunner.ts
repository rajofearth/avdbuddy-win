import type { CommandResult } from "../models/types.ts";

async function readStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  proc: Bun.Subprocess,
  shouldCancel?: () => boolean,
  onChunk?: (chunk: string) => void
): Promise<string> {
  if (!stream) return "";

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (shouldCancel?.()) {
        proc.kill();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      onChunk?.(chunk);
    }

    const tail = decoder.decode();
    if (tail.length > 0) {
      buffer += tail;
      onChunk?.(tail);
    }
  } finally {
    reader.releaseLock();
  }

  return buffer;
}

export async function runCommand(
  executable: string,
  args: string[],
  options: { stdin?: string; waitForExit?: boolean } = {}
): Promise<CommandResult> {
  const { stdin, waitForExit = true } = options;

  const proc = Bun.spawn([executable, ...args], {
    stdin: stdin ? new Blob([stdin]) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!waitForExit) {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

export async function runCommandStreaming(
  executable: string,
  args: string[],
  options: {
    stdin?: string;
    onOutput?: (chunk: string) => void;
    shouldCancel?: () => boolean;
  } = {}
): Promise<CommandResult> {
  const { stdin, onOutput, shouldCancel } = options;

  const proc = Bun.spawn([executable, ...args], {
    stdin: stdin ? new Blob([stdin]) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    readStream(proc.stdout, proc, shouldCancel, onOutput),
    readStream(proc.stderr, proc, shouldCancel, onOutput),
  ]);

  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}
