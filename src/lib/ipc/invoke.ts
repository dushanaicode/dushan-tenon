import { type InvokeArgs, invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { ErrorCode } from "@/lib/generated/error-codes";
import type { IpcError } from "@/lib/generated/IpcError";

export { Channel } from "@tauri-apps/api/core";

function isIpcError(value: unknown): value is IpcError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "traceId" in value &&
    typeof value.traceId === "string" &&
    "params" in value &&
    typeof value.params === "object" &&
    value.params !== null &&
    !Array.isArray(value.params) &&
    Object.values(value.params).every(
      (parameter) => typeof parameter === "string",
    )
  );
}

export async function invoke<T>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    if (isIpcError(error)) {
      const { code, params, traceId } = error;
      // 只转发公开合同，避免额外的 source、cause 或消息进入界面。
      throw { code, params, traceId } satisfies IpcError;
    }
    const traceId = crypto.randomUUID();
    console.error("IPC 调用失败", { command, traceId });
    throw {
      code: "app.ipc.unexpected" satisfies ErrorCode,
      params: {},
      traceId,
    } satisfies IpcError;
  }
}
