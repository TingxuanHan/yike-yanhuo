const experience = require("../shared/experience.js");
const api = require("./api.js");
const platform = require("../platform/index.js");

module.exports = function contourAuditController(page) {
  let ownedBusy = false;
  const session = new experience.ContourAuditSession({
    request: api.request,
    notify(state) {
      if (!page.alive) return;
      const patch = { auditState: state };
      if (ownedBusy || state.busy) patch.busy = state.busy;
      ownedBusy = state.busy;
      page.setData(patch);
      if (state.view) platform.reveal?.(".audit-result");
    },
  });
  function sync() {
    session.setInput(page.data.result, page.data.minutes, page.data.auditCount);
  }
  return {
    sync,
    toggle() {
      sync();
      page.setData({ auditOpen: !page.data.auditOpen });
    },
    count(e) {
      if (page.data.busy) return;
      const count = Number(e.currentTarget.dataset.count);
      if (count !== 6 && count !== 12) return;
      page.setData({ auditCount: count });
      sync();
    },
    preview() {
      if (page.data.busy) return;
      sync();
      return session.preview();
    },
    run() {
      if (page.data.busy) return;
      sync();
      return session.run();
    },
    stop() {
      session.stop();
    },
    dispose() {
      session.dispose();
    },
    copy() {
      return page.action(async () => {
        sync();
        await platform.clipboard(
          experience.contourAuditSummary(session.result()),
        );
        page.setData({ auditNotice: "已复制固定点、逐项结果、来源与口径。" });
      });
    },
  };
};
