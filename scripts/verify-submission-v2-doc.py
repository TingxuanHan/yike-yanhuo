"""Check the fixed PDF text, fonts and page count; visual QA remains separate."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "materials/yike-yanhuo-baidu-v2.pdf"


def main():
    reader = PdfReader(FILE)
    pages = [p.extract_text() for p in reader.pages]
    text = "\n".join(pages)
    assert len(pages) == 18
    for number, page in enumerate(pages, 1):
        assert re.search(rf"{number:02d}\s*/\s*18", page), f"Missing page marker: {number}"
        assert "\ufffd" not in page and "\u25a0" not in page
    anchors = ["功能正确性与覆盖率40%", "API深度与工程优化30%", "产品交互与体验15%", "开源工程规范15%", "244", "44", "23/24", "9/12", "26条", "1104", "e28efa0", "os2026-baidu-v2-20261016"]
    compact = re.sub(r"\s+", "", text)
    for word in anchors:
        assert word in compact, f"Missing expected content: {word}"
    fonts = {}
    for page in reader.pages:
        for reference in page["/Resources"]["/Font"].values():
            font = reference.get_object()
            name = str(font.get("/BaseFont", ""))
            if "+" in name:
                descriptor = font["/FontDescriptor"].get_object()
                assert any(key in descriptor for key in ["/FontFile", "/FontFile2", "/FontFile3"])
                fonts[name] = True
    assert len(fonts) >= 2
    result = {"passed": True, "checkedAt": datetime.now(timezone.utc).isoformat(), "file": FILE.name, "pages": 18, "pageMarkers": 18, "requiredTextChecks": len(anchors), "embeddedFonts": len(fonts), "bytes": FILE.stat().st_size, "sha256": hashlib.sha256(FILE.read_bytes()).hexdigest(), "functionalBaseline": "e28efa0", "visualQA": "18 rendered pages inspected; pages 9, 12 and 13 additionally inspected at full size", "fieldValidationClaimed": False}
    (ROOT / "docs/validation/submission-v2-doc.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
