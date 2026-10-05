const platform = require("../platform/index.js");
function validServer(url) {
  return (
    typeof url === "string" &&
    (/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(url) ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(url))
  );
}
async function request(path, method = "GET", data) {
  const base = platform.get("yike-server") || "http://127.0.0.1:8787";
  if (!validServer(base))
    throw new Error("请填写HTTPS服务器地址；本机开发可使用localhost。");
  const token = platform.get("yike-token");
  const r = await platform.request({
    url: base + path,
    method,
    data,
    timeout: 15000,
    header: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (r.statusCode < 200 || r.statusCode >= 300)
    throw new Error((r.data && r.data.error) || "操作未完成，请重试。");
  return r.data;
}
module.exports = { request, validServer };
