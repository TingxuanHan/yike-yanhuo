"""Export the committed source and a checksummed competition handoff bundle."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TAG = "os2026-submission-v1"
RELEASE = "https://github.com/TingxuanHan/yike-yanhuo/releases/tag/" + TAG
GIT = ["git", "-c", "safe.directory=" + ROOT.as_posix()]


def git(*args):
    return subprocess.check_output(GIT + list(args), cwd=ROOT).decode("utf-8").strip()


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    revision = git("rev-parse", "HEAD")
    source = ROOT / "materials/yike-yanhuo-source.zip"
    subprocess.run(GIT + ["archive", "--format=zip", "--prefix=yike-yanhuo/", "-o", str(source), revision], cwd=ROOT, check=True)
    with zipfile.ZipFile(source) as archive:
        assert archive.testzip() is None
        paths = [PurePosixPath(p) for p in archive.namelist()]
        forbidden = {".env", ".data", ".cache", "node_modules", ".git", "project.private.config.json"}
        assert not any(forbidden.intersection(p.parts) for p in paths)
        for name in ["package.json", "package-lock.json", ".env.example", "src/server/app.ts", "miniprogram/app.json", "LICENSE", "README.md"]:
            assert "yike-yanhuo/" + name in archive.namelist(), name
    names = ["yike-yanhuo-submission.pdf", "yike-yanhuo-submission.mp4", "yike-yanhuo-submission.srt", "yike-yanhuo-submission-cover.png", "yike-yanhuo-source.zip"]
    assets = [{"name": name, "bytes": (ROOT / "materials" / name).stat().st_size, "sha256": digest(ROOT / "materials" / name)} for name in names]
    manifest = {"createdAt": datetime.now(timezone.utc).isoformat(), "tag": TAG, "commit": revision, "release": RELEASE, "repositoryAccess": "private; owner must resolve external review and open-source publication before submission", "assets": assets}
    (ROOT / "materials/submission-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    names.append("submission-manifest.json")
    sums = "\n".join(f"{digest(ROOT / 'materials' / name)}  {name}" for name in names) + "\n"
    (ROOT / "materials/SHA256SUMS.txt").write_text(sums, encoding="utf-8")
    names.append("SHA256SUMS.txt")
    bundle = ROOT / "materials/yike-yanhuo-submission.zip"
    with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in names:
            archive.write(ROOT / "materials" / name, name)
        archive.write(ROOT / "docs/submission-guide.md", "评审运行与材料索引.md")
        archive.write(ROOT / "docs/submission-transcript.md", "视频旁白与章节.md")
        archive.write(ROOT / "docs/submission-validation.md", "材料验收记录.md")
        archive.writestr("请先阅读.txt", "一刻烟火：15分钟生活圈智能体检与规划助手\n\n作品介绍：yike-yanhuo-submission.pdf（14页）\n视频：yike-yanhuo-submission.mp4（中文配音、烧录字幕；SRT另附）\n源码：yike-yanhuo-source.zip（解压后npm ci、npm run build、npm start；Node24推荐）\n仓库：https://github.com/TingxuanHan/yike-yanhuo\n固定版本：" + TAG + "\n提交：" + revision + "\n发布页：" + RELEASE + "\n\n当前仓库按所有者原要求私有，外部评审权限和开源发布方式需在提交前落实。\n资料区分构造场景、API实测与现场待验证事项；未附私人数据或密钥。\n校验：SHA256SUMS.txt包含同包主要附件的SHA-256。\n完整说明见评审运行与材料索引.md。\n")
    with zipfile.ZipFile(bundle) as archive:
        assert archive.testzip() is None
    # The outer archive checksum is external, avoiding a self-referential digest.
    with (ROOT / "materials/SHA256SUMS.txt").open("a", encoding="utf-8") as stream:
        stream.write(f"{digest(bundle)}  {bundle.name}\n")
    print(json.dumps({"commit": revision, "sourceBytes": source.stat().st_size, "bundleBytes": bundle.stat().st_size, "bundleSha256": digest(bundle), "sourceEntries": len(paths)}))


if __name__ == "__main__":
    main()
