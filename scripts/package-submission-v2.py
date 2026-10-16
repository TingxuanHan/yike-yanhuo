"""Export a versioned, secret-checked source and competition handoff bundle."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import hashlib
import json
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TAG = "os2026-baidu-v2-20261016"
RELEASE = "https://github.com/TingxuanHan/yike-yanhuo/releases/tag/" + TAG
GIT = ["git", "-c", "safe.directory=" + ROOT.as_posix()]


def git(*args):
    return subprocess.check_output(GIT + list(args), cwd=ROOT).decode("utf-8").strip()


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def local_secrets():
    values = []
    config = ROOT / ".env"
    if config.exists():
        for line in config.read_text(encoding="utf-8-sig").splitlines():
            match = re.match(r"^([A-Z0-9_]*(?:AK|KEY|TOKEN|SECRET|PASSWORD|INVITE)[A-Z0-9_]*)\s*=\s*(.*?)\s*$", line)
            if match:
                value = match[2].strip("\"'")
                if len(value) >= 12:
                    values.append(value.encode())
    return values


def main():
    revision = git("rev-parse", "HEAD")
    # Only the already-present developer-tool configuration may be dirty.
    status = subprocess.check_output(GIT + ["status", "--porcelain", "--untracked-files=no"], cwd=ROOT).decode("utf-8")
    assert all(line[3:] == "miniprogram/project.config.json" for line in status.splitlines() if line), "Commit material changes before packaging"
    source = ROOT / "materials/yike-yanhuo-source-v2.zip"
    subprocess.run(GIT + ["archive", "--format=zip", "--prefix=yike-yanhuo/", "-o", str(source), revision], cwd=ROOT, check=True)
    secrets = local_secrets()
    with zipfile.ZipFile(source) as archive:
        assert archive.testzip() is None
        paths = [PurePosixPath(p) for p in archive.namelist()]
        forbidden = {".env", ".data", ".cache", "node_modules", ".git", "project.private.config.json"}
        assert not any(forbidden.intersection(p.parts) for p in paths)
        for name in ["package.json", "package-lock.json", ".env.example", "src/server/app.ts", "miniprogram/app.json", "LICENSE", "README.md", "docs/submission-v2-brief.md", "docs/submission-video-v2.json"]:
            assert "yike-yanhuo/" + name in archive.namelist(), name
        for entry in archive.infolist():
            if not entry.is_dir():
                data = archive.read(entry)
                assert not any(value in data for value in secrets), "A configured secret was found in source export"
    names = ["yike-yanhuo-baidu-v2.pdf", "yike-yanhuo-baidu-v2.mp4", "yike-yanhuo-baidu-v2.srt", "yike-yanhuo-baidu-v2-cover.png", "yike-yanhuo-source-v2.zip"]
    assets = [{"name": name, "bytes": (ROOT / "materials" / name).stat().st_size, "sha256": digest(ROOT / "materials" / name)} for name in names]
    manifest = {
        "createdAt": datetime.now(timezone.utc).isoformat(), "tag": TAG,
        "commit": revision, "functionalBaseline": "e28efa0", "release": RELEASE,
        "repositoryAccess": "private; external review access and open-source publication must be resolved before submission",
        "sourceAudit": {"entries": len(paths), "configuredSecretsChecked": len(secrets), "secretMatches": 0, "excludedPrivateData": True},
        "assets": assets,
    }
    proof_file = ROOT / ".cache/submission-v2-source-check.json"
    proof = json.loads(proof_file.read_text(encoding="utf-8")) if proof_file.exists() else None
    if proof and proof.get("sourceCommit") == revision:
        assert proof["passed"] and proof["sourceSha256"] == digest(source)
        manifest["sourceBuildCheck"] = proof
    manifest_name = "submission-v2-manifest.json"
    sums_name = "SHA256SUMS-v2.txt"
    (ROOT / "materials" / manifest_name).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    names.append(manifest_name)
    (ROOT / "materials" / sums_name).write_text("\n".join(f"{digest(ROOT / 'materials' / name)}  {name}" for name in names) + "\n", encoding="utf-8")
    names.append(sums_name)
    bundle = ROOT / "materials/yike-yanhuo-baidu-v2.zip"
    with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in names:
            archive.write(ROOT / "materials" / name, name)
        for file, label in [
            ("docs/submission-v2-guide.md", "评审运行与材料索引.md"),
            ("docs/submission-v2-transcript.md", "视频旁白与章节.md"),
            ("docs/submission-v2-validation.md", "材料验收记录.md"),
            ("docs/submission-v2-brief.md", "作品介绍可编辑稿.md"),
            ("docs/validation/submission-v2-video.json", "视频机器检查.json"),
            ("docs/validation/submission-v2-doc.json", "文档机器检查.json"),
            ("docs/validation/submission-v2-replays.json", "演示导出文件复算.json"),
        ]:
            archive.write(ROOT / file, label)
        for name in ["verification", "siting", "conditions", "detour", "audit"]:
            archive.write(ROOT / "materials/submission-v2-evidence" / (name + ".json"), "演示复算数据/" + name + ".json")
        if "sourceBuildCheck" in manifest:
            archive.write(proof_file, "源码解压构建检查.json")
        archive.writestr("请先阅读.txt", "一刻烟火：15分钟生活圈智能体检与规划助手\n\n新版作品介绍：yike-yanhuo-baidu-v2.pdf（18页，百度40/30/15/15）\n新版视频：yike-yanhuo-baidu-v2.mp4（中文配音、烧录字幕；SRT另附）\n源码：yike-yanhuo-source-v2.zip（解压后npm ci、npm run build、npm start；推荐Node24）\n固定版本：" + TAG + "\n提交：" + revision + "\n功能基线：e28efa0\n发布页：" + RELEASE + "\n\n仓库仍为私有，正式提交前需落实外部评审访问与开源公开方式。\n区分构造场景、历史API回放、重复API核对和现场待验证事项。\n未附私人数据库、缓存、node_modules或真实密钥；本地未提交开发者配置不在源码导出中。\n同包附件校验见SHA256SUMS-v2.txt，外层ZIP校验见发布附件的同名清单。\n")
    with zipfile.ZipFile(bundle) as archive:
        assert archive.testzip() is None
    with (ROOT / "materials" / sums_name).open("a", encoding="utf-8") as stream:
        stream.write(f"{digest(bundle)}  {bundle.name}\n")
    print(json.dumps({"commit": revision, "sourceEntries": len(paths), "sourceBytes": source.stat().st_size, "bundleBytes": bundle.stat().st_size, "bundleSha256": digest(bundle), "secretMatches": 0}))


if __name__ == "__main__":
    main()
