import {
  cleanDeparture,
  type DeparturePack,
  type DeparturePlace,
} from "../shared/departure.js";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function departureHtml(raw: DeparturePack): string {
  const p = cleanDeparture(raw);
  const place = (x: DeparturePlace) =>
    `<section><h3>${escape(x.name)}</h3><p>${escape(x.address)}</p><p>${escape(x.landmark)}</p>${x.photo ? `<div class="photo"><img alt="记录的入口照片" src="${x.photo}">${x.marker ? `<b style="left:${x.marker.x * 100}%;top:${x.marker.y * 100}%">＋</b>` : ""}</div>` : ""}<p>${escape(x.freshness)}</p><p>${escape(x.opening)}</p></section>`;
  const guides = p.guides
    .map(
      (g) =>
        `<section><h3>${escape(g.from.name)} → ${escape(g.to.name)}</h3><p>${escape(new Date(g.obtainedAt).toLocaleString("zh-CN"))}获取；保存的资料不随路况更新，非今日资料请重新核对。</p><ol>${g.steps.map((s) => `<li>${escape(s.instruction)}</li>`).join("")}</ol></section>`,
    )
    .join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>一刻烟火 · 离线出门卡</title><style>body{max-width:42rem;margin:auto;padding:20px;font:18px/1.65 system-ui,sans-serif;color:#243f48;background:#f4f8f7;overflow-wrap:anywhere}h1{font-size:28px}section{padding:16px 0;border-bottom:1px solid #b8ccc5}a{display:block;background:#146c5d;color:white;padding:14px;text-align:center;border-radius:12px}.photo{position:relative;max-width:360px}.photo img{display:block;width:100%}.photo b{position:absolute;transform:translate(-50%,-50%);color:#fff;background:#8b3500;border:2px solid #fff;border-radius:50%;line-height:30px;width:30px;text-align:center}small{display:block}</style></head><body><h1>一刻烟火 · 离线出门卡</h1><p>${p.demo ? "模拟社区与示例价格 · 不可据此出行" : "本机保存的出门资料"}</p><p>保存于${escape(new Date(p.preparedAt).toLocaleString("zh-CN"))}。这份文件不会更新；出行日期或安排变化后，请重新准备。</p>${p.phone ? `<a href="tel:${p.phone}">拨打家人电话 ${p.phone}</a>` : "<p>尚未保存家人电话。</p>"}<p>保存文件不代表已通知家人。此文件含私人地点、电话或照片，请妥善保存。</p><h2>出门前看一眼</h2>${p.checks.map((s) => `<p>${escape(s)}</p>`).join("")}<h2>本次安排</h2><ol>${p.schedule.map((s) => `<li>${escape(s)}</li>`).join("")}</ol><h2>返程地点</h2>${place(p.returnPlace)}<h2>沿途地点与入口</h2>${p.places.map(place).join("")}<h2>已保存的步行步骤</h2>${guides}${p.guideMissing.map((s) => `<p>未获取：${escape(s)}</p>`).join("")}<p>仅包含已经获取的文字步骤，不跟踪定位。过街、道路通行与入口开放情况请现场确认。</p></body></html>`;
}
export function downloadDeparture(p: DeparturePack) {
  const url = URL.createObjectURL(
    new Blob([departureHtml(p)], { type: "text/html;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "一刻烟火-离线出门卡.html";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
