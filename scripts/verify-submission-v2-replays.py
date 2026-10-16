"""Independently replay the five synthetic evidence exports used in the film."""
from datetime import datetime, timezone
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FOLDER = "materials/submission-v2-evidence/"
CASES = [
    ("verification", "scripts/replay-verification.ts", False),
    ("siting", "scripts/benchmark-facility-siting.ts", True),
    ("conditions", "scripts/replay-planning-evidence.ts", False),
    ("detour", "scripts/replay-planning-evidence.ts", False),
    ("audit", "scripts/replay-contour-audit.ts", False),
]


def main():
    records = []
    for name, script, option in CASES:
        file = FOLDER + name + ".json"
        argument = "--replay=" + file if option else file
        output = subprocess.check_output(["node", "--import", "tsx", script, argument], cwd=ROOT).decode("utf-8")
        result = json.loads(output)
        assert result["externalApiCalls"] == 0
        records.append({"file": file, "result": result})
    result = {"passed": True, "checkedAt": datetime.now(timezone.utc).isoformat(), "evidence": "simulation", "note": "Five film exports; not five new independent experiments", "externalApiCalls": 0, "records": records}
    (ROOT / "docs/validation/submission-v2-replays.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": True, "exports": len(records), "externalApiCalls": 0}))


if __name__ == "__main__":
    main()
