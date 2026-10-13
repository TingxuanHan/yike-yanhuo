export function EntrancePhoto({
  photo,
  x,
  y,
  onMark,
}: {
  photo: string;
  x: number;
  y: number;
  onMark?: (x: number, y: number) => void;
}) {
  return (
    <div
      className={`entrance-mark ${onMark ? "editable" : ""}`}
      role={onMark ? "button" : undefined}
      tabIndex={onMark ? 0 : undefined}
      aria-label={onMark ? "在照片上标记入口，可用方向键调整" : undefined}
      onClick={(e) => {
        if (!onMark) return;
        const r = e.currentTarget.getBoundingClientRect();
        onMark(
          Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
          Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
        );
      }}
      onKeyDown={(e) => {
        if (
          !onMark ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        )
          return;
        e.preventDefault();
        onMark(
          Math.max(
            0,
            Math.min(
              1,
              x +
                (e.key === "ArrowRight"
                  ? 0.02
                  : e.key === "ArrowLeft"
                    ? -0.02
                    : 0),
            ),
          ),
          Math.max(
            0,
            Math.min(
              1,
              y +
                (e.key === "ArrowDown"
                  ? 0.02
                  : e.key === "ArrowUp"
                    ? -0.02
                    : 0),
            ),
          ),
        );
      }}
    >
      <img src={photo} alt="本次分享的入口照片" draggable={false} />
      <span
        className="entrance-pin"
        style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        aria-hidden="true"
      >
        入口
      </span>
    </div>
  );
}
