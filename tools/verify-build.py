#!/usr/bin/env python3
"""
Check a built extension before handing it to the browser.

Arc reports most packaging mistakes as a single opaque "could not load extension",
so every cheap invariant is worth asserting here instead: valid JSON, every file
the manifest points at exists, every <script src> resolves, and the Arc modules
actually parse.

Usage:
    verify-build.py dist/Claude-in-Arc
"""

import glob
import json
import os
import re
import subprocess
import sys

FAILURES = []
CHECKS = 0


def check(condition, message):
    global CHECKS
    CHECKS += 1
    if not condition:
        FAILURES.append(message)
    return condition


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: verify-build.py <dist_dir>")
    root = sys.argv[1]

    manifest_path = os.path.join(root, "manifest.json")
    if not os.path.isfile(manifest_path):
        sys.exit(f"error: no manifest.json in {root}")

    try:
        with open(manifest_path, encoding="utf-8") as fh:
            m = json.load(fh)
    except json.JSONDecodeError as exc:
        sys.exit(f"error: manifest.json is not valid JSON: {exc}")

    def exists(rel):
        return os.path.isfile(os.path.join(root, rel.lstrip("/")))

    # --- manifest invariants -------------------------------------------------
    check("update_url" not in m, "manifest still carries update_url (invalid for an unpacked build)")
    check(m.get("manifest_version") == 3, "manifest_version is not 3")
    check("declarativeNetRequest" in m.get("permissions", []), "declarativeNetRequest permission missing")
    check(exists(m["background"]["service_worker"]), "background service worker file missing")

    # --- every file the manifest references must exist -----------------------
    for cs in m.get("content_scripts", []):
        for js in cs.get("js", []):
            check(exists(js), f"content script missing: {js}")

    for entry in m.get("declarative_net_request", {}).get("rule_resources", []):
        check(exists(entry["path"]), f"ruleset missing: {entry['path']}")

    for entry in m.get("web_accessible_resources", []):
        for res in entry.get("resources", []):
            if "*" in res:
                check(bool(glob.glob(os.path.join(root, res))), f"web_accessible glob matches nothing: {res}")
            else:
                check(exists(res), f"web_accessible resource missing: {res}")

    # --- DNR redirect targets: a missing one disables the whole ruleset -------
    rules_path = os.path.join(root, "rules.json")
    if os.path.isfile(rules_path):
        with open(rules_path, encoding="utf-8") as fh:
            rules = json.load(fh)
        seen_ids = set()
        for rule in rules:
            rid = rule.get("id")
            check(rid not in seen_ids, f"duplicate rule id: {rid}")
            seen_ids.add(rid)
            target = rule.get("action", {}).get("redirect", {}).get("extensionPath")
            if target:
                check(exists(target), f"DNR redirect target missing (disables the whole ruleset): {target}")

    # --- HTML pages: every local script/stylesheet must resolve ---------------
    for html_path in glob.glob(os.path.join(root, "*.html")):
        with open(html_path, encoding="utf-8") as fh:
            html = fh.read()
        name = os.path.basename(html_path)
        for ref in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', html):
            check(exists(ref), f"{name} references a missing file: {ref}")

    # --- service worker loader wiring ----------------------------------------
    loader = os.path.join(root, "service-worker-loader.js")
    if os.path.isfile(loader):
        with open(loader, encoding="utf-8") as fh:
            imports = re.findall(r"import\s+'([^']+)'", fh.read())
        check(bool(imports), "service-worker-loader.js has no imports")
        check(
            imports and imports[0].endswith("arc-sidepanel-shim.js"),
            "arc-sidepanel-shim.js must be the FIRST import (it polyfills chrome.sidePanel "
            "before the official bundle captures it)",
        )
        check(
            any("service-worker" in i for i in imports),
            "the official service worker is no longer imported",
        )
        for imp in imports:
            check(exists(imp), f"service worker import missing: {imp}")

    # --- the Arc modules must at least parse ---------------------------------
    node = subprocess.run(["node", "--version"], capture_output=True, text=True)
    if node.returncode == 0:
        for js in sorted(glob.glob(os.path.join(root, "assets", "arc-*.js"))) + [
            os.path.join(root, "assets", f)
            for f in ("claude-panel-injector.js", "viewport-override.js", "cmd-e-fallback.js", "theme-init.js")
        ]:
            if not os.path.isfile(js):
                continue
            res = subprocess.run(["node", "--check", js], capture_output=True, text=True)
            check(res.returncode == 0, f"syntax error in {os.path.basename(js)}: {res.stderr.strip()[:200]}")
    else:
        print("  (node not found - syntax check skipped)")

    # --- report --------------------------------------------------------------
    print(f"\n  {CHECKS} checks, {len(FAILURES)} failure(s)")
    if FAILURES:
        for f in FAILURES:
            print(f"    ✗ {f}")
        sys.exit(1)
    print(f"  OK {m['name']} - Anthropic bundle {m['version']} - ready to load\n")


if __name__ == "__main__":
    main()
