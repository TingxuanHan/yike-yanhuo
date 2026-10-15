import summary from "../../docs/experiments/shanghai-summary.json";

// Public aggregate evidence only; raw route and POI records stay in local files.
export const shanghaiStudy = {
  title: "上海 · 抚顺路社区睦邻中心",
  date: summary.measuredAt.slice(0, 10),
  sampleCount: 24,
  rows: [5, 10, 15].map((minutes) => ({
    minutes,
    cells: ["circle", "coarse", "adaptive"].map((model) => {
      const row = summary.comparison.find(
        (v) => v.model === model && v.minutes === minutes,
      )!;
      return `${row.trueReachable + row.trueUnreachable}/${row.evaluated}`;
    }),
  })),
  note: "133采样点版本，另取24个API测时点对照；三个时长使用同一组点。15分钟改善明显，5分钟未全面改善。入口与设施仍待现场核验。",
};
