const experience = require("../shared/experience.js");
const platform = require("../platform/index.js");
const { utf8Bytes } = require("../shared/life.js");

module.exports = function sitingConditionsController(page) {
  let source = null,
    parent = null,
    comparison = null;
  function reset(defaults = false) {
    source = page.data.result;
    parent = page.sitingComparison;
    comparison = null;
    const patch = {
      conditionsView: null,
      conditionsError: "",
      conditionsNotice: "",
    };
    if (defaults && source)
      patch.conditionsFields = Object.fromEntries(
        Object.entries(experience.sitingConditionDefaults(source)).map(
          ([k, v]) => [k, String(v)],
        ),
      );
    page.setData(patch);
  }
  function sync() {
    page.updateSitingOptions();
    if (source !== page.data.result || parent !== page.sitingComparison)
      reset(true);
  }
  function draw() {
    if (
      page.data.tab === "nearby" &&
      !page.data.simpleMode &&
      page.data.showCoverage &&
      page.data.showSiting &&
      page.data.conditionsOpen &&
      (!page.data.reviewMode || page.data.reviewPanel === "coverage") &&
      page.data.conditionsView
    )
      platform.drawSketch?.(
        page.data.conditionsView.sketch,
        page,
        "conditions-sketch",
      );
  }
  function render(id, reveal = false) {
    if (
      !comparison ||
      source !== page.data.result ||
      parent !== page.sitingComparison
    )
      throw new Error("报告或候选位置已变化，请重新检查条件。");
    const view = experience.sitingConditionsView(source, comparison, id);
    if (utf8Bytes(JSON.stringify(view)) > 900_000)
      throw new Error("比较图过大，请在Web查看。");
    page.setData(
      { conditionsView: view, conditionsError: "", conditionsNotice: "" },
      () => {
        draw();
        if (reveal) platform.reveal?.(".siting-conditions-result");
      },
    );
  }
  return {
    reset,
    draw,
    toggle() {
      sync();
      page.setData({ conditionsOpen: !page.data.conditionsOpen }, draw);
    },
    field(e) {
      const key = e.currentTarget.dataset.key;
      if (
        !["speedMps", "departure", "crossingsPerKm", "waitSeconds"].includes(
          key,
        )
      )
        return;
      sync();
      reset();
      page.setData({
        conditionsFields: {
          ...page.data.conditionsFields,
          [key]: String(e.detail.value),
        },
      });
    },
    compare() {
      try {
        sync();
        if (!parent || !page.data.sitingView)
          throw new Error("请先比较候选补点方案。");
        const fields = page.data.conditionsFields;
        if (Object.values(fields).some((v) => !v.trim()))
          throw new Error("请填完整比较条件。");
        comparison = experience.compareSitingConditions(
          source,
          parent.category,
          parent.minutes,
          parent.candidates.map((c) => c.id),
          {
            speedMps: Number(fields.speedMps),
            departure: fields.departure,
            waitSeconds: Number(fields.waitSeconds),
            crossingsPerKm: Number(fields.crossingsPerKm),
          },
        );
        render(comparison.plans[0].id, true);
      } catch (e) {
        comparison = null;
        page.setData({ conditionsView: null, conditionsError: e.message });
      }
    },
    select(e) {
      try {
        sync();
        render(e.currentTarget.dataset.id);
      } catch (e) {
        comparison = null;
        page.setData({ conditionsView: null, conditionsError: e.message });
      }
    },
    copy() {
      return page.action(async () => {
        sync();
        if (!comparison || !page.data.conditionsView)
          throw new Error("请先检查当前候选方案的条件。");
        await platform.clipboard(
          experience.sitingConditionsSummary(
            source,
            comparison,
            page.data.conditionsView.currentId,
          ),
        );
        page.setData({
          conditionsNotice: "已复制所选方案、逐组条件、来源与限制。",
        });
      });
    },
  };
};
