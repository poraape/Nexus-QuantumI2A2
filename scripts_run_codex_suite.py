#!/usr/bin/env python3
import json, subprocess, os, sys, glob

def run(cmd):
    print(f"\n[RUN] {cmd}")
    r = subprocess.run(cmd, shell=True)
    if r.returncode != 0:
        print(f"⚠️ Command failed: {cmd} (exit {r.returncode})")
    return r.returncode

def main():
    with open("00_suite.manifest.json") as f:
        manifest = json.load(f)
    modules = [m["file"] for m in manifest["modules"]]
    for file in modules:
        print(f"\n=== Executing module: {file} ===")
        with open(file) as f:
            data = json.load(f)
        # Emulate execution based on 'actions' and 'checks'
        if "actions" in data:
            for act in data["actions"]:
                if "run" in act:
                    run(act["run"])
        if "checks" in data:
            for chk in data["checks"]:
                if "run" in chk:
                    run(chk["run"])
    print("\n✅ Suite execution completed. Reports in codex_reports/.")

if __name__ == "__main__":
    main()
