# SPDX-FileCopyrightText: 2026 AutoCensor Project Owner and contributors
# SPDX-License-Identifier: MIT

from __future__ import annotations

import json
import re
import sys
from importlib import metadata
from pathlib import Path
from typing import Any

from evidence_config import CANDIDATE_LABEL, EVIDENCE_DIR, ROOT

OUTPUT_JSON = EVIDENCE_DIR / "dependency_license_inventory.json"
OUTPUT_MD = EVIDENCE_DIR / "dependency_license_inventory.md"

KNOWN_PYTHON_LICENSES = {
    "ultralytics": "AGPL-3.0",
    "lap": "BSD-2-Clause",
    "opencv-python": "Apache-2.0",
    "scipy": "BSD-3-Clause",
    "numpy": "BSD-3-Clause",
    "pillow": "HPND",
    "threadpoolctl": "BSD-3-Clause",
    "torch": "BSD-3-Clause",
    "torchvision": "BSD-3-Clause",
}

AGPL_BOUNDARY_DECISION = (
    "Completed release decision: this repository publishes MIT-licensed source code only. "
    "It does not vendor or redistribute AGPL runtime packages, Python wheels, model files, "
    "or a bundled executable. The optional Python ML backend can be installed by users from "
    "their own package indexes. Any downstream distribution that bundles the AGPL runtime "
    "must either comply with AGPL-3.0 for that distribution or replace the backend with a "
    "license-compatible implementation."
)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def npm_packages() -> list[dict[str, Any]]:
    package_lock = read_json(ROOT / "package-lock.json")
    packages = package_lock.get("packages") or {}
    rows: list[dict[str, Any]] = []
    for package_path, info in sorted(packages.items()):
        if not package_path.startswith("node_modules/"):
            continue
        name = package_path.removeprefix("node_modules/")
        package_json = ROOT / package_path / "package.json"
        node_meta = read_json(package_json)
        license_value = node_meta.get("license") or info.get("license") or "UNKNOWN"
        rows.append({
            "ecosystem": "npm",
            "name": node_meta.get("name") or name,
            "version": node_meta.get("version") or info.get("version") or "",
            "declared_license": license_value,
            "bundled_in_repo": False,
            "source": "package-lock.json + node_modules package metadata",
        })
    return rows


def parse_requirement_line(line: str) -> tuple[str, str] | None:
    raw = line.strip()
    if not raw or raw.startswith("#") or raw.startswith("--") or raw.startswith("-r "):
        return None
    match = re.match(r"([A-Za-z0-9_.-]+)(?:==([^;\s]+))?", raw)
    if not match:
        return None
    return match.group(1).lower(), match.group(2) or ""


def python_requirements() -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for req_file in ("requirements.txt", "requirements-server-cpu.txt", "requirements-server-gpu-cu128.txt"):
        path = ROOT / req_file
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            parsed = parse_requirement_line(line)
            if parsed:
                rows.append((parsed[0], parsed[1], req_file))
    dedup: dict[str, tuple[str, str, str]] = {}
    for name, pinned, req_file in rows:
        dedup.setdefault(name, (name, pinned, req_file))
    return sorted(dedup.values())


def python_packages() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name, pinned, req_file in python_requirements():
        installed_version = ""
        known_license = KNOWN_PYTHON_LICENSES.get(name)
        license_value = known_license or "UNKNOWN"
        try:
            meta = metadata.metadata(name)
            installed_version = metadata.version(name)
            if not known_license:
                license_value = meta.get("License") or license_value
                classifiers = meta.get_all("Classifier") or []
                license_classifiers = [item.removeprefix("License :: ").strip() for item in classifiers if item.startswith("License :: ")]
                if license_classifiers and license_value in ("UNKNOWN", "UNKNOWN\n"):
                    license_value = "; ".join(license_classifiers)
        except metadata.PackageNotFoundError:
            installed_version = "not-installed-in-current-env"
        rows.append({
            "ecosystem": "python",
            "name": name,
            "pinned_version": pinned,
            "installed_version": installed_version,
            "declared_license": license_value,
            "bundled_in_repo": False,
            "source": req_file,
        })
    return rows


def build_inventory() -> dict[str, Any]:
    npm = npm_packages()
    python = python_packages()
    all_rows = npm + python
    unknown = [row for row in all_rows if not str(row.get("declared_license") or "").strip() or row.get("declared_license") == "UNKNOWN"]
    copyleft = [
        row for row in all_rows
        if "AGPL" in str(row.get("declared_license", "")).upper()
        or "GPL" in str(row.get("declared_license", "")).upper()
    ]
    return {
        "ok": len(unknown) == 0,
        "proof_mode": "generated_dependency_license_inventory_from_package_lock_requirements_and_installed_metadata",
        "candidate": CANDIDATE_LABEL,
        "release_policy": {
            "project_license": "MIT",
            "model_files_bundled": False,
            "node_modules_bundled": False,
            "python_wheels_bundled": False,
            "dependency_licenses_remain_with_their_owners": True,
            "license_boundary_decision_complete": True,
            "agpl_runtime_dependency_note": AGPL_BOUNDARY_DECISION,
        },
        "counts": {
            "npm": len(npm),
            "python": len(python),
            "total": len(all_rows),
            "unknown_license": len(unknown),
            "copyleft_or_agpl": len(copyleft),
        },
        "copyleft_or_agpl": copyleft,
        "packages": all_rows,
    }


def write_markdown(inventory: dict[str, Any]) -> None:
    lines = [
        "# Dependency License Inventory",
        "",
        f"Candidate: {inventory['candidate']}",
        "",
        "This inventory is release evidence for the source-release boundary.",
        "",
        "## Policy",
        "",
        f"- Project license: {inventory['release_policy']['project_license']}",
        f"- Model files bundled: {inventory['release_policy']['model_files_bundled']}",
        f"- `node_modules` bundled: {inventory['release_policy']['node_modules_bundled']}",
        f"- Python wheels bundled: {inventory['release_policy']['python_wheels_bundled']}",
        f"- License boundary decision complete: {inventory['release_policy']['license_boundary_decision_complete']}",
        f"- AGPL/runtime note: {inventory['release_policy']['agpl_runtime_dependency_note']}",
        "",
        "## Packages",
        "",
        "| Ecosystem | Package | Version | License | Bundled | Source |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in inventory["packages"]:
        version = row.get("version") or row.get("pinned_version") or row.get("installed_version") or ""
        lines.append(
            f"| {row.get('ecosystem')} | {row.get('name')} | {version} | {row.get('declared_license')} | {row.get('bundled_in_repo')} | {row.get('source')} |"
        )
    lines.append("")
    lines.append(f"Unknown license count: {inventory['counts']['unknown_license']}")
    OUTPUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    inventory = build_inventory()
    OUTPUT_JSON.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_markdown(inventory)
    return 0 if inventory["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
