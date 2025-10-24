#!/usr/bin/env python3
import json
import os
import subprocess
from pathlib import Path


def _run_with_fallbacks(command: str) -> int:
    """
    Execute a shell command, emulating basic `||` fallback behaviour on Windows.
    This lets us keep suite definitions that were authored for Unix shells while
    running them reliably in PowerShell/CMD.
    """
    if os.name == "nt" and "||" in command:
        parts = [part.strip() for part in command.split("||")]
        last_code = 1
        for part in parts:
            if not part:
                continue
            if part.lower() in {"true", "truue"}:
                return 0
            last_code = subprocess.run(part, shell=True).returncode
            if last_code == 0:
                return 0
        return last_code
    return subprocess.run(command, shell=True).returncode


def run(command: str) -> int:
    print(f"\n[RUN] {command}")
    if command.startswith("codex."):
        print("[SKIP] Skipping unsupported codex.* command in local environment.")
        return 0
    exit_code = _run_with_fallbacks(command)
    if exit_code != 0:
        print(f"⚠️ Command failed: {command} (exit {exit_code})")
    return exit_code


def main() -> None:
    Path("codex_reports").mkdir(exist_ok=True)

    with open("00_suite.manifest.json", encoding="utf-8") as f:
        manifest = json.load(f)

    modules = [module["file"] for module in manifest["modules"]]
    for file in modules:
        print(f"\n=== Executing module: {file} ===")
        with open(file, encoding="utf-8") as f:
            data = json.load(f)

        for act in data.get("actions", []):
            if "run" in act:
                run(act["run"])

        for chk in data.get("checks", []):
            if "run" in chk:
                run(chk["run"])

    print("\nSuite execution completed. Reports in codex_reports/.")


if __name__ == "__main__":
    main()
