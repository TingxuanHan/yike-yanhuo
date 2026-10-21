import { useEffect, useRef, useState } from "react";
import type { LifeBook } from "../shared/life.js";
import {
  CalibrationSession,
  walkSources,
  type CalibrationState,
} from "../mini/calibration.js";
import { downloadJson } from "./api.js";
import "./calibration.css";

export function WalkCalibration({
  book,
  save,
  back,
}: {
  book: LifeBook;
  save: (b: LifeBook) => void;
  back: () => void;
}) {
  const saving = useRef(save);
  saving.current = save;
  const [view, setView] = useState<CalibrationState | null>(null);
  const [exported, setExported] = useState(false);
  const [session] = useState(
    () =>
      new CalibrationSession(book, {
        save: (b) => saving.current(b),
        notify: setView,
      }),
  );
  useEffect(() => session.sync(book), [book, session]);
  useEffect(() => setExported(false), [book.walks]);
  const s = view ?? session.state;
  const pending = s.rows.find((r) => r.id === s.pending);
  return (
    <section className="walk-calibration">
      <button className="secondary" onClick={back}>
        返回出行偏好
      </button>
      <header>
        <p className="eyebrow">让计划逐渐贴近自己的脚步</p>
        <h2>实走记录与步速校准</h2>
        <p>
          先记好距离和预计用时，走完再补实际情况。建议只在你确认后用于下次规划。
        </p>
        <p className="muted">只记录同一位出门者；家人可以帮忙填写。</p>
      </header>
      {s.error && (
        <p className="walk-error" role="alert">
          {s.error}
        </p>
      )}
      {s.status && (
        <p className="walk-status" role="status">
          {s.status}
        </p>
      )}
      <section className="walk-summary" aria-label="步速建议">
        <p>
          当前日常步速 <strong>{s.current}</strong>
        </p>
        <h3>
          {s.summary.ready
            ? `建议试用 ${s.summary.medianMps} 米/秒`
            : "先积累几次相近路况的实走"}
        </h3>
        <p>{s.summary.reason}</p>
        {s.summary.ready && <p>{s.kilometer}</p>}
        {s.summary.total > 0 && (
          <p className="muted">
            有效记录 {s.summary.count} 次 / 全部 {s.summary.total}{" "}
            次。步速范围只是已填记录的变化，不保证今后的用时。
          </p>
        )}
        {s.summary.ready && (
          <button className="primary" onClick={() => session.apply()}>
            采用建议步速
          </button>
        )}
      </section>
      {pending ? (
        <form
          className="walk-form"
          onSubmit={(e) => {
            e.preventDefault();
            session.finish();
          }}
        >
          <h3>走完补记 · {pending.label}</h3>
          <p>{pending.source}</p>
          <p>{pending.prediction}</p>
          <p className="muted">
            按秒表或自己的记录填写；此页面不自动计时。等灯、休息和办事都算停留。
          </p>
          <div className="walk-fields">
            <label>
              总用时（秒）
              <input
                required
                type="number"
                min="1"
                max="14400"
                step="1"
                value={s.elapsed}
                onChange={(e) => session.field("elapsed", e.target.value)}
              />
            </label>
            <label>
              其中停留（秒）
              <input
                required
                type="number"
                min="0"
                max="14399"
                step="1"
                value={s.stopped}
                onChange={(e) => session.field("stopped", e.target.value)}
              />
            </label>
          </div>
          <button className="primary" type="submit">
            保存这次实走
          </button>
        </form>
      ) : (
        <form
          className="walk-form"
          onSubmit={(e) => {
            e.preventDefault();
            session.prepare();
          }}
        >
          <h3>准备下一次记录</h3>
          <p>选择已知长度、适合正常步行的路段；不用沿途操作手机。</p>
          <div className="walk-fields">
            <label>
              路段简称
              <input
                required
                maxLength={60}
                value={s.form.label}
                onChange={(e) => session.field("label", e.target.value)}
              />
            </label>
            <label>
              已知距离（米）
              <input
                required
                type="number"
                min="50"
                max="5000"
                step="1"
                value={s.form.meters}
                onChange={(e) => session.field("meters", e.target.value)}
              />
            </label>
          </div>
          <label>
            距离来源
            <select
              aria-label="距离来源"
              value={s.form.source}
              onChange={(e) => session.field("source", e.target.value)}
            >
              {walkSources.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="walk-check">
            <input
              type="checkbox"
              checked={s.form.usual}
              onChange={(e) => session.field("usual", e.target.checked)}
            />
            按平时步速走平路，没有刻意快走或明显负重
          </label>
          <button className="primary" type="submit">
            准备记录，固定预计用时
          </button>
          <p className="muted">
            只有已量距离、日常走法的记录用于建议。地图估算与模拟练习单独保留。
          </p>
        </form>
      )}
      <details className="walk-evidence">
        <summary>查看预测对照与记录（{s.summary.total}）</summary>
        <h3>事先的预计，和后来实际的差别</h3>
        <p>{s.evaluation}</p>
        <p className="muted">
          两种预计比较同一批后续记录。平均误差为纯步行用时的绝对差；距离与用时仍是本人填报，未经独立现场核验。
        </p>
        <button
          className="secondary"
          disabled={!s.rows.length}
          onClick={() => {
            downloadJson(session.export(), "yike-walk-validation.json");
            setExported(true);
          }}
        >
          导出实走验证记录
        </button>
        <button
          className="secondary"
          disabled={!exported || !s.rows.length}
          onClick={() => {
            if (
              window.confirm(
                "请确认已保存刚导出的文件。清空本机全部实走记录后将重新积累，日常步速和地点保留。继续？",
              )
            )
              session.clear();
          }}
        >
          已备份，清空实走记录
        </button>
        <p className="muted">
          导出含路段简称与时间，不含坐标、电话或照片；分享前请检查简称是否含私人信息。
        </p>
        {!!s.rows.length && (
          <label>
            排除原因（需要排除记录时填写）
            <input
              maxLength={120}
              value={s.exclusion}
              onChange={(e) => session.field("exclusion", e.target.value)}
              placeholder="例如距离记错；原始记录会保留"
            />
          </label>
        )}
        <ol className="walk-records">
          {s.rows.map((r) => (
            <li key={r.id}>
              <h4>{r.label}</h4>
              <p className="muted">
                {r.source} · {r.date}
              </p>
              <p>{r.prediction}</p>
              <p>{r.observation}</p>
              <p>
                <strong>{r.reason}</strong>
              </p>
              <button
                className="secondary"
                onClick={() => session.exclude(r.id)}
              >
                {r.excluded ? "恢复这条记录" : "排除这条记录"}
              </button>
            </li>
          ))}
        </ol>
        {!s.rows.length && (
          <p>还没有记录。准备第一条后可以离开页面，走完再回来补记。</p>
        )}
      </details>
    </section>
  );
}
