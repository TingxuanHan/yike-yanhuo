import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT 必须是有效端口");
const host = process.env.HOST ?? "127.0.0.1";
const server = createApp();
server.listen(port, host, () =>
  console.log(`一刻烟火服务已启动：http://${host}:${port}`),
);
server.on("error", (error) => {
  console.error(
    error instanceof Error && "code" in error && error.code === "EADDRINUSE"
      ? "端口已被占用，请关闭已有服务或更换 PORT。"
      : "服务启动失败，请检查监听地址和端口。",
  );
  process.exitCode = 1;
});
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.once(event, () => {
    server.close();
    server.closeAllConnections();
  });
