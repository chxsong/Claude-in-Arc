#!/usr/bin/env python3
"""
Apply the Arc patch on top of an extracted copy of the official Claude extension.

The patch is purely additive: it copies `patch/` into the build and rewrites only
three official files (manifest.json, service-worker-loader.js, sidepanel.html).
No official bundle is modified, which is what lets this survive version bumps.

Usage:
    apply-patch.py <official_dir> <patch_dir> <out_dir> [--label v0.3]
"""

import argparse
import glob
import json
import os
import re
import shutil
import sys

ARC_DESCRIPTION = (
    "Claude in Arc — patched for Arc Browser with sidebar panel, "
    "Desktop integration and tab grouping"
)

# Service worker imports, in load order. The shim must come first so that every
# `chrome.sidePanel` reference in the official bundle resolves to the polyfill.
SW_PRELUDE = ["./assets/arc-sidepanel-shim.js"]
SW_EPILOGUE = [
    "./assets/arc-bridge-interceptor.js",
    "./assets/arc-zoom-handler.js",
    "./assets/arc-adapter.js",
]

# Content scripts the patch adds on top of the official ones.
ARC_CONTENT_SCRIPTS = [
    {
        "js": ["assets/claude-panel-injector.js"],
        "matches": ["<all_urls>"],
        "run_at": "document_idle",
    },
    {
        "js": ["assets/viewport-override.js"],
        "matches": ["<all_urls>"],
        "run_at": "document_start",
        "world": "MAIN",
    },
]

# The injected panel loads sidepanel.html as an iframe inside arbitrary pages,
# so the page and its assets must be web-accessible everywhere.
ARC_WEB_ACCESSIBLE = {
    "matches": ["<all_urls>"],
    "resources": ["sidepanel.html", "assets/*", "public/*"],
}

# Fallback sources for redirect targets missing from the patch, looked up in the
# official bundle (whose filenames are content-hashed and change every release).
SVG_FALLBACKS = {
    "google-docs.svg": ["google_docs-*.svg", "googledocs-*.svg", "docs-*.svg"],
    "google-drive.svg": ["google_drive-*.svg", "googledrive-*.svg", "drive-*.svg"],
}


def log(msg):
    print(f"  {msg}")


def patch_manifest(out_dir, label):
    path = os.path.join(out_dir, "manifest.json")
    with open(path, encoding="utf-8") as fh:
        m = json.load(fh)

    official_version = m["version"]

    # An unpacked build must not claim to auto-update from the Web Store.
    m.pop("update_url", None)

    m["name"] = f"Claude in Arc {label}"
    m["version_name"] = label
    m["description"] = ARC_DESCRIPTION

    # declarativeNetRequest (static ruleset) is additional to the
    # declarativeNetRequestWithHostAccess the official build already requests.
    perms = m.setdefault("permissions", [])
    if "declarativeNetRequest" not in perms:
        perms.insert(0, "declarativeNetRequest")

    m["declarative_net_request"] = {
        "rule_resources": [{"id": "ruleset_1", "enabled": True, "path": "rules.json"}]
    }

    existing = {tuple(cs.get("js", [])) for cs in m.get("content_scripts", [])}
    for cs in ARC_CONTENT_SCRIPTS:
        if tuple(cs["js"]) not in existing:
            m.setdefault("content_scripts", []).append(cs)

    war = m.setdefault("web_accessible_resources", [])
    if not any("sidepanel.html" in e.get("resources", []) for e in war):
        war.append(ARC_WEB_ACCESSIBLE)

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(m, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    log(f"manifest.json  -> {m['name']} (Anthropic bundle {official_version})")
    return official_version


def patch_service_worker_loader(out_dir):
    path = os.path.join(out_dir, "service-worker-loader.js")
    with open(path, encoding="utf-8") as fh:
        original = fh.read()

    # Keep whatever the official loader imports; only wrap it. The official
    # bundle filename is content-hashed and changes on every release.
    official_imports = re.findall(r"^\s*import\s+.*$", original, flags=re.M)
    if not official_imports:
        sys.exit(f"error: no import found in {path}; official loader shape changed")

    lines = [f"import '{p}';" for p in SW_PRELUDE]
    lines += [line.strip() for line in official_imports]
    lines += [f"import '{p}';" for p in SW_EPILOGUE]

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    log(f"service-worker-loader.js  -> shim + {len(official_imports)} official import(s) + 3 Arc modules")


def patch_sidepanel(out_dir, label):
    path = os.path.join(out_dir, "sidepanel.html")
    with open(path, encoding="utf-8") as fh:
        html = fh.read()

    html = re.sub(r"<title>.*?</title>", f"<title>Claude in Arc</title>", html, count=1)

    # theme-init must run before the panel module: it polyfills chrome.tabGroups
    # (absent in Arc) and sets data-mode before first paint.
    if "theme-init.js" not in html:
        anchor = re.search(r'[ \t]*<script type="module"', html)
        if not anchor:
            sys.exit(f"error: no module script found in {path}; official page shape changed")
        indent = re.match(r"[ \t]*", anchor.group(0)).group(0)
        html = (
            html[: anchor.start()]
            + f'{indent}<script src="/assets/theme-init.js"></script>\n'
            + html[anchor.start() :]
        )

    # cmd-e-fallback lets Cmd+E close the panel from inside the iframe, where the
    # extension command shortcut never fires.
    if "cmd-e-fallback.js" not in html:
        html = re.sub(
            r"([ \t]*)</body>",
            lambda mo: f'{mo.group(1)}  <script src="/assets/cmd-e-fallback.js"></script>\n{mo.group(1)}</body>',
            html,
            count=1,
        )

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)

    log("sidepanel.html  -> title + theme-init + cmd-e-fallback")


def patch_rules(out_dir, official_dir):
    """Write rules.json, keeping only rules whose redirect target actually exists.

    A static ruleset containing a redirect to a missing extensionPath is rejected
    wholesale by Chrome, which silently disables *every* rule in it. v0.2 shipped
    two such rules (google-drive.svg, google-docs.svg were never committed).
    """
    path = os.path.join(out_dir, "rules.json")
    with open(path, encoding="utf-8") as fh:
        rules = json.load(fh)

    kept, dropped = [], []
    for rule in rules:
        target = rule.get("action", {}).get("redirect", {}).get("extensionPath", "")
        rel = target.lstrip("/")
        if os.path.isfile(os.path.join(out_dir, rel)):
            kept.append(rule)
            continue

        # Try to satisfy it from the official bundle before giving up.
        name = os.path.basename(rel)
        recovered = False
        for pattern in SVG_FALLBACKS.get(name, []):
            matches = sorted(glob.glob(os.path.join(official_dir, "assets", pattern)))
            if matches:
                shutil.copy2(matches[0], os.path.join(out_dir, rel))
                log(f"rules.json  -> {name} recovered from {os.path.basename(matches[0])}")
                kept.append(rule)
                recovered = True
                break
        if not recovered:
            dropped.append(name)

    for i, rule in enumerate(kept, start=1):
        rule["id"] = i

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(kept, fh, indent=2)
        fh.write("\n")

    if dropped:
        log(f"rules.json  -> {len(kept)} valid rule(s), {len(dropped)} dropped (missing target): {', '.join(dropped)}")
    else:
        log(f"rules.json  -> {len(kept)} rule(s), all valid")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("official_dir")
    ap.add_argument("patch_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--label", default="v0.3")
    args = ap.parse_args()

    if not os.path.isfile(os.path.join(args.official_dir, "manifest.json")):
        sys.exit(f"error: {args.official_dir} is not an extracted extension")

    if os.path.exists(args.out_dir):
        shutil.rmtree(args.out_dir)
    shutil.copytree(args.official_dir, args.out_dir)

    # _metadata holds Web Store signatures that are meaningless once repacked.
    shutil.rmtree(os.path.join(args.out_dir, "_metadata"), ignore_errors=True)

    for src in glob.glob(os.path.join(args.patch_dir, "**", "*"), recursive=True):
        if os.path.isdir(src):
            continue
        rel = os.path.relpath(src, args.patch_dir)
        dst = os.path.join(args.out_dir, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
    log(f"patch/  -> {len(glob.glob(os.path.join(args.patch_dir, '**', '*.*'), recursive=True))} files copied")

    version = patch_manifest(args.out_dir, args.label)
    patch_service_worker_loader(args.out_dir)
    patch_sidepanel(args.out_dir, args.label)
    patch_rules(args.out_dir, args.official_dir)

    print(f"\n  Build ready: {args.out_dir}  (Claude {version} + Arc patch {args.label})")


if __name__ == "__main__":
    main()
