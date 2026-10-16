const experience = require("../shared/experience.js");
const api = require("./api.js");
const platform = require("../platform/index.js");
const { utf8Bytes } = require("../shared/life.js");

module.exports = function verificationController(page) {
  let source = null,
    context = "",
    sequence = 0,
    active = false,
    ids = [],
    prepared = null,
    ready = null,
    last = null,
    job = null,
    timer = null,
    rejectWait = null;
  const patch = (data) => {
    if (page.alive) page.setData(data);
  };
  const current = (token) =>
    page.alive &&
    token === sequence &&
    source === page.data.result &&
    context === `${page.data.coverageCategory}:${page.data.minutes}`;
  const stop = (announce = false) => {
    sequence++;
    clearTimeout(timer);
    timer = null;
    rejectWait?.(new Error("本次补查已停止"));
    rejectWait = null;
    const known = job;
    job = null;
    if (known) {
      void api.request(`/api/analyses/${known}`, "DELETE").catch(() => {});
      prepared = null;
    }
    if (active) {
      active = false;
      patch({ busy: false, verificationBusy: false });
    }
    if (announce)
      patch({
        verificationPlan: prepared?.plan || null,
        verificationStatus:
          "已停止等待。已发出的调用可能计入用量，原报告保留。",
      });
  };
  const sync = () => {
    const nextContext = `${page.data.coverageCategory}:${page.data.minutes}`;
    if (source === page.data.result && context === nextContext) return;
    stop();
    source = page.data.result;
    context = nextContext;
    ids = [];
    prepared = null;
    ready = null;
    try {
      const tasks = experience.verificationTasks(
        source,
        page.data.coverageCategory,
        page.data.minutes,
      );
      const matched = last?.after === source && source.verification;
      patch({
        verificationTasks: tasks
          .filter((t) => t.kind !== "field")
          .map((t) => ({ ...t, checked: false })),
        verificationSelected: 0,
        verificationFields: tasks.filter((t) => t.kind === "field"),
        verificationPlan: null,
        verificationReady: false,
        verificationError: "",
        verificationStatus: "",
        verificationDiff: matched
          ? experience.verificationDiff(
              last.before,
              source,
              page.data.coverageCategory,
              page.data.minutes,
            )
          : null,
        verificationReceipts: matched ? source.verification.receipts : [],
        verificationCanRestore: last?.after === source,
      });
    } catch (e) {
      patch({
        verificationTasks: [],
        verificationFields: [],
        verificationPlan: null,
        verificationReady: false,
        verificationDiff: null,
        verificationReceipts: [],
        verificationError: e.message,
      });
    }
  };
  const begin = () => {
    if (page.data.busy) return null;
    sync();
    active = true;
    patch({ busy: true, verificationBusy: true, verificationError: "" });
    return sequence;
  };
  const end = (token) => {
    if (current(token)) {
      active = false;
      patch({ busy: false, verificationBusy: false });
    }
  };
  const showResult = (next) => {
    experience.verificationEvidence(
      source,
      next,
      page.data.coverageCategory,
      page.data.minutes,
    );
    ready = next;
    prepared = null;
    patch({
      verificationPlan: null,
      verificationReady: true,
      verificationDiff: experience.verificationDiff(
        source,
        next,
        page.data.coverageCategory,
        page.data.minutes,
      ),
      verificationReceipts: next.verification.receipts,
      verificationStatus: "补查完成，先看变化，再决定是否采用。",
    });
    platform.reveal?.(".verification-diff");
  };
  return {
    sync,
    stop,
    dispose: () => stop(),
    toggle() {
      if (page.data.busy && !active) return;
      sync();
      if (page.data.showVerification) stop(true);
      patch({ showVerification: !page.data.showVerification });
    },
    choose(e) {
      if (page.data.busy) return;
      sync();
      const id = e.currentTarget.dataset.id;
      if (!page.data.verificationTasks.some((t) => t.id === id)) return;
      const next = ids.includes(id)
        ? ids.filter((v) => v !== id)
        : [...ids, id];
      if (next.length > 3) {
        patch({ verificationError: "一次最多选择3项，请分次核查。" });
        return;
      }
      stop();
      ids = next;
      prepared = null;
      ready = null;
      patch({
        verificationTasks: page.data.verificationTasks.map((t) => ({
          ...t,
          checked: ids.includes(t.id),
        })),
        verificationSelected: ids.length,
        verificationPlan: null,
        verificationReady: false,
        verificationDiff: null,
        verificationReceipts: [],
        verificationError: "",
        verificationStatus: "",
      });
    },
    drill() {
      if (page.data.busy) return;
      sync();
      try {
        const next = experience.verificationDrill(
          source,
          page.data.coverageCategory,
        );
        last = { before: source, after: next };
        page.setResult(next, false, page.data.minutes);
        sync();
        patch({ showVerification: true });
      } catch (e) {
        patch({ verificationError: e.message });
      }
    },
    async preview() {
      const token = begin();
      if (token === null) return;
      try {
        const value =
          source.mode === "demo"
            ? {
                fingerprint: "local",
                plan: experience.verificationPlan(
                  source,
                  page.data.coverageCategory,
                  page.data.minutes,
                  ids,
                ),
              }
            : await api.request("/api/verification/preview", "POST", {
                result: source,
                category: page.data.coverageCategory,
                minutes: page.data.minutes,
                taskIds: ids,
              });
        if (!current(token)) return;
        prepared = {
          ...value,
          requestId: `mini-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
          ids: [...ids],
        };
        patch({
          verificationPlan: value.plan,
          verificationReady: false,
          verificationDiff: null,
          verificationStatus: "用量已核对，确认后才执行所选任务。",
        });
      } catch (e) {
        if (current(token)) patch({ verificationError: e.message });
      } finally {
        end(token);
      }
    },
    async run() {
      if (!prepared) return;
      const token = begin();
      if (token === null) return;
      if (!prepared) {
        end(token);
        return;
      }
      try {
        if (source.mode === "demo") {
          const next = await experience.demoVerification(source, prepared.plan);
          if (current(token)) showResult(next);
          return;
        }
        const started = await api.request("/api/verification", "POST", {
          result: source,
          category: page.data.coverageCategory,
          minutes: page.data.minutes,
          taskIds: prepared.ids,
          fingerprint: prepared.fingerprint,
          requestId: prepared.requestId,
          confirmed: true,
        });
        if (!current(token)) {
          void api
            .request(`/api/analyses/${started.id}`, "DELETE")
            .catch(() => {});
          return;
        }
        job = started.id;
        const until = Date.now() + 300_000;
        while (current(token)) {
          const state = await api.request(`/api/analyses/${started.id}`);
          if (!current(token)) return;
          if (state.status === "done" && state.result) {
            job = null;
            showResult(
              experience.parseResultFile(JSON.stringify(state.result)),
            );
            return;
          }
          if (state.status !== "running") {
            job = null;
            prepared = null;
            patch({ verificationPlan: null });
            throw new Error(state.error || "补查未能完成，原报告保留。");
          }
          if (Date.now() > until)
            throw new Error("补查等待超时，原报告保留，可停止后重试。");
          patch({
            verificationStatus: `${state.progress.stage} ${state.progress.done}/${state.progress.total}`,
          });
          await new Promise((resolve, reject) => {
            rejectWait = reject;
            timer = setTimeout(() => {
              timer = null;
              rejectWait = null;
              resolve();
            }, 1000);
          });
        }
      } catch (e) {
        if (current(token)) patch({ verificationError: e.message });
      } finally {
        end(token);
      }
    },
    adopt() {
      if (page.data.busy || !ready) return;
      try {
        const next = ready,
          before = source;
        if (
          utf8Bytes(
            JSON.stringify({
              result: next,
              ...experience.reportView(
                next,
                page.data.category,
                page.data.minutes,
              ),
            }),
          ) > 900_000
        )
          throw new Error("这份结果较大，请在Web采用。原报告保留。");
        if (!page.data.reviewMode)
          platform.set(
            experience.VERIFICATION_BACKUP_KEY,
            experience.verificationEvidence(
              before,
              next,
              page.data.coverageCategory,
              page.data.minutes,
            ),
          );
        last = { before, after: next };
        page.setResult(next, true, page.data.minutes);
        sync();
        patch({ showVerification: true });
      } catch (e) {
        patch({ verificationError: `未采用结果，原报告保留。${e.message}` });
      }
    },
    restore() {
      if (page.data.busy || last?.after !== page.data.result) return;
      try {
        const next = last.before;
        last = null;
        page.setResult(next, false, page.data.minutes);
        sync();
        patch({ showVerification: true });
      } catch (e) {
        patch({ verificationError: e.message });
      }
    },
    reopen() {
      if (page.data.busy) return;
      try {
        const raw = platform.get(experience.VERIFICATION_BACKUP_KEY);
        if (!raw) throw new Error("本机尚无补查备份。");
        const saved = experience.parseVerificationEvidence(JSON.stringify(raw));
        last = { before: saved.before, after: saved.after };
        page.setResult(saved.after, false, saved.diff.minutes);
        sync();
        patch({ showVerification: true });
      } catch (e) {
        patch({ verificationError: e.message });
      }
    },
    async copy() {
      if (page.data.busy) return;
      try {
        const after =
            ready ||
            (last?.after === source && source.verification ? source : null),
          before = ready ? source : last?.before;
        if (!after || !before) throw new Error("请先完成本次补查。");
        const evidence = experience.verificationEvidence(
            before,
            after,
            page.data.coverageCategory,
            page.data.minutes,
          ),
          d = evidence.diff;
        await platform.clipboard(
          [
            "一刻烟火 · 定向补核查",
            evidence.evidence === "simulation"
              ? "人工构造演练，非真实社区"
              : "百度补查与历史报告合用，未现场验证",
            `原报告${before.id} · ${before.generatedAt}`,
            `补查报告${after.id} · ${after.generatedAt}`,
            `有效测时${d.knownSamplesBefore}→${d.knownSamplesAfter}；新增设施${d.newFacilities}处`,
            `待核查${d.unknownBefore}→${d.unknownAfter} km²；步行范围${d.domainBefore}→${d.domainAfter} km²`,
            ...after.verification.receipts.map((r) => r.message),
            d.note,
          ].join("\n"),
        );
        patch({
          verificationStatus:
            "前后摘要已复制，完整报告仍保留在本机或当前演练中。",
        });
      } catch (e) {
        patch({ verificationError: e.message });
      }
    },
  };
};
