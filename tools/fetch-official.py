#!/usr/bin/env python3
"""
Fetch and verify the official Claude extension, then extract it.

The CRX3 is downloaded from Google's own update endpoint — the same URL Chrome
uses — and its developer signing key is checked against Anthropic's before a
single byte is unpacked. That check is the whole point of this script: it is what
distinguishes "the official bundle" from "a bundle someone handed us".

Usage:
    fetch-official.py --out build/official            # download latest
    fetch-official.py --out build/official --crx x.crx  # use a local CRX
"""

import argparse
import base64
import hashlib
import io
import json
import os
import shutil
import struct
import sys
import urllib.request
import zipfile

EXTENSION_ID = "fcoeoabgfenejglbffodgkkbkcdhcgfn"

# Anthropic's developer public key (SubjectPublicKeyInfo, base64), as published in
# the extension manifest and as embedded in every signed CRX Google serves.
# sha256(DER)[:16] mapped a-p yields EXTENSION_ID above.
ANTHROPIC_KEY = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjU1XnLPoasGVmZU42K3h6S+sQhkogfcoLPbIcrWH"
    "5Oo8QoInBIugkew/7cWaEFySyQrkaEBe1fjeS/rlAqd3r778dKcTvDZcXmj0VVX0Fi1i8tnkarurceGKGdVx"
    "fkL7e30nwfgwoPxj3H8OQbsbxFcBWGVtcFekmdpiyaxwz6o4yXIWColfAxh9K2yToOZkoAS5GvgGvTexiCh1"
    "gYy++eFdk6C61mcFsyDdoGQtduhGEaX0zZ9uAW1jX4JTPmHV3kEFrZu/WVBl7Obw+Jk/osoHMdmghVNy6SCB"
    "8/6mcgmxkP9buPrNUZgYP6n0x5dqEJ2Ecww/lb1Zd4nQf4XGOwIDAQAB"
)

UPDATE_URL = (
    "https://clients2.google.com/service/update2/crx"
    "?response=redirect&prodversion=131.0.0.0&acceptformat=crx2,crx3"
    f"&x=id%3D{EXTENSION_ID}%26uc"
)

# DER prefix of an RSA SubjectPublicKeyInfo, used to locate keys in the CRX3 header.
SPKI_PREFIX = bytes.fromhex("30820122300d06092a864886f70d010101")
SPKI_LEN = 294


def extension_id_for(spki_der):
    digest = hashlib.sha256(spki_der).hexdigest()[:32]
    return "".join(chr(ord("a") + int(c, 16)) for c in digest)


def download(dest):
    print("  Downloading from clients2.google.com ...")
    req = urllib.request.Request(UPDATE_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
        final_url = resp.geturl()
    with open(dest, "wb") as fh:
        fh.write(data)
    print(f"  {len(data):,} bytes - {os.path.basename(final_url)}")
    return data


def split_crx(raw):
    if raw[:4] != b"Cr24":
        sys.exit("error: not a CRX file (bad magic)")
    _, version, header_len = struct.unpack("<4sII", raw[:12])
    if version != 3:
        sys.exit(f"error: unsupported CRX version {version}")
    header = raw[12 : 12 + header_len]
    return header, raw[12 + header_len :]


def verify_signer(header):
    """Confirm Anthropic's key is among the CRX proofs and derives the right ID."""
    keys, start = [], 0
    while True:
        i = header.find(SPKI_PREFIX, start)
        if i < 0:
            break
        keys.append(header[i : i + SPKI_LEN])
        start = i + 1

    for spki in keys:
        if base64.b64encode(spki).decode() == ANTHROPIC_KEY:
            derived = extension_id_for(spki)
            if derived != EXTENSION_ID:
                sys.exit(f"error: key derives {derived}, expected {EXTENSION_ID}")
            print(f"  Signature verified: Anthropic developer key -> {derived}")
            return

    sys.exit(
        "error: Anthropic's signing key is NOT among the CRX proofs.\n"
        "       Refusing to build from an unverified bundle."
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="directory to extract into")
    ap.add_argument("--crx", help="use this local CRX instead of downloading")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)

    if args.crx:
        print(f"  Using local CRX: {args.crx}")
        raw = open(args.crx, "rb").read()
    else:
        cache = os.path.join(os.path.dirname(os.path.abspath(args.out)), "claude.crx")
        raw = download(cache)

    header, zip_bytes = split_crx(raw)
    verify_signer(header)

    if os.path.exists(args.out):
        shutil.rmtree(args.out)
    os.makedirs(args.out)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        zf.extractall(args.out)

    manifest = json.load(open(os.path.join(args.out, "manifest.json"), encoding="utf-8"))
    if manifest.get("key") != ANTHROPIC_KEY:
        sys.exit("error: extracted manifest key does not match Anthropic's")

    print(f"  Extracted: {manifest['name']} {manifest['version']} -> {args.out}")
    print(manifest["version"])


if __name__ == "__main__":
    main()
