import { useState } from "react";
import type { Facility, FacilityEvidence } from "../shared/types.js";
import { reviewReminders } from "../shared/facility-review.js";

export function ReviewReminders({
  facilities,
  onReview,
}: {
  facilities: Facility[];
  onReview?: (id: string, entry: FacilityEvidence) => void;
}) {
  const [now, setNow] = useState(Date.now);
  const queue = reviewReminders(facilities, now);
  return (
    <section className="review-reminders" aria-label="复核提醒">
      <div className="section-line">
        <h3>资料该再确认了吗</h3>
        <button className="text-button" onClick={() => setNow(Date.now())}>
          刷新提醒
        </button>
      </div>
      <p>
        <strong>
          {queue.due}处已到复核日期 · {queue.soon}处7天内需复核
        </strong>
      </p>
      <p className="caption">
        提醒按本机时间 {queue.asOf}{" "}
        检查；历史结论仍保留。到期不代表停业，也不证明现在仍可用。
        {queue.unscheduled}处有记录但未设日期，{queue.unreviewed}处尚未核查。
      </p>
      {queue.items.length > 0 && (
        <details open={queue.due > 0}>
          <summary>查看需复核的地点（{queue.items.length}处）</summary>
          <ul>
            {queue.items.map((item) => (
              <li key={item.facilityId}>
                <div>
                  <strong>{item.name}</strong>
                  <span className={`review-deadline ${item.state}`}>
                    {item.label}
                  </span>
                  <p>
                    {item.reviewLabel} · 复核日期 {item.dueLabel}
                  </p>
                  <p className="caption">
                    {item.entry.source} / {item.entry.recordId} · 上次核查{" "}
                    {item.checkedLabel}
                  </p>
                </div>
                {onReview && (
                  <button
                    className="secondary"
                    onClick={() => onReview(item.facilityId, item.entry)}
                  >
                    复核此地点
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!queue.items.length && (
        <p className="caption">
          暂无已设置的近期复核任务。可在“记录或导入核查”中添加日期。
        </p>
      )}
    </section>
  );
}
