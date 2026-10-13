export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal:
        init?.signal ??
        (/^\/api\/(?:life\/)?assistance(?:\/|$)/.test(path)
          ? AbortSignal.timeout(15000)
          : undefined),
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof Error && error.name === "TimeoutError")
      throw new Error("协助连接超时，本机安排已保留，请刷新后重试。");
    throw new Error("暂时无法连接服务，请检查服务是否启动后重试。");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw Object.assign(
      new Error(body?.error ?? "操作未能完成，请稍后重试。"),
      { status: response.status },
    );
  if (!body) throw new Error("服务响应无效，请稍后重试。");
  return body as T;
}
export const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
