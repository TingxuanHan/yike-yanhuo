const platform = require("../platform/index.js");
const config = require("../config.js");
function validServer(url) {
  return (
    typeof url === "string" &&
    (/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(url) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(url))
  );
}
async function request(path, method = "GET", data) {
  const base = platform.get("yike-server") || config.apiBaseUrl;
  if (!validServer(base))
    throw new Error(
      "云端服务尚未连接。可先使用示例和本机地点簿，在“我的”中连接设备。",
    );
  const token = platform.get("yike-token");
  const r = await platform.request({
    url: base + path,
    method,
    data,
    timeout:
      path === "/api/outings/routes"
        ? 60000
        : path === "/api/ai/parse" || path === "/api/ai/voice"
          ? 35000
          : 15000,
    header: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (r.statusCode < 200 || r.statusCode >= 300)
    throw Object.assign(
      new Error((r.data && r.data.error) || "操作未完成，请重试。"),
      { status: r.statusCode },
    );
  return r.data;
}
async function readSharedCard(token, server) {
  const base = server || config.apiBaseUrl;
  if (!validServer(base) || !/^[A-Za-z0-9_-]{32}$/.test(token || ""))
    throw new Error("分享链接不完整，请让家人重新发送地点卡。");
  // Card links can point to another deployment: never attach or change device credentials.
  const r = await platform.request({
    url: base + "/api/card",
    method: "GET",
    timeout: 15000,
    header: { "X-Yike-Card": token },
  });
  if (r.statusCode !== 200)
    throw new Error(r.data?.error || "地点卡暂时无法打开，请稍后重试。");
  return r.data;
}
async function assistRequest(id, token, server, method = "GET", data) {
  if (
    !validServer(server) ||
    !/^[a-f0-9-]{36}$/.test(id || "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(token || "")
  )
    throw new Error("协助链接不完整，请让家人重新发送。");
  const r = await platform.request({
    url: server + "/api/assistance/" + id,
    method,
    data,
    timeout: 15000,
    header: { "content-type": "application/json", "X-Yike-Assist": token },
  });
  if (r.statusCode < 200 || r.statusCode >= 300)
    throw Object.assign(new Error(r.data?.error || "协助暂时无法连接。"), {
      status: r.statusCode,
    });
  return r.data;
}
function serverAddress() {
  return platform.get("yike-server") || config.apiBaseUrl;
}
async function familyRequest(id, token, server, method = "GET", data) {
  if (
    !validServer(server) ||
    !/^[a-f0-9-]{36}$/.test(id || "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(token || "")
  )
    throw new Error("位置卡链接不完整，请让家人重新发送。");
  const r = await platform.request({
    url: server + "/api/family/" + id,
    method,
    ...(data ? { data } : {}),
    timeout: 15000,
    header: { "X-Yike-Family": token, "content-type": "application/json" },
  });
  if (r.statusCode !== 200)
    throw Object.assign(new Error(r.data?.error || "位置卡暂时无法打开。"), {
      status: r.statusCode,
    });
  return r.data;
}
module.exports = {
  request,
  validServer,
  readSharedCard,
  assistRequest,
  serverAddress,
  familyRequest,
};
