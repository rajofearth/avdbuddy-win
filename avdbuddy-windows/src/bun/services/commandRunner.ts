import type { CommandResult } from "../models/types.ts";

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

  let stdout = "";
  let stderr = "";
  const decoder = new TextDecoder();

  if (proc.stdout) {
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        if (shouldCancel?.()) {
          proc.kill();
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        stdout += chunk;
        onOutput?.(chunk);
      }
    } finally {
      reader.releaseLock();
    }
  }

  if (proc.stderr) {
    stderr = await new Response(proc.stderr).text();
  }

  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}
