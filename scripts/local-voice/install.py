"""Install the isolated CPU voice runtime and the upstream INT8 model.

Usage: python scripts/local-voice/install.py --home D:/LocalAI/Amuse-services/voice
The supplied Python must be 64-bit Python 3.12; nothing is installed globally.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tarfile
import urllib.request
import venv

MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2"
MODEL_SHA256 = "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e"
MODEL_DIRECTORY = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def install(home):
    if sys.version_info[:2] != (3, 12) or struct.calcsize("P") != 8:
        raise SystemExit("Use 64-bit Python 3.12 for the pinned CPU runtime wheels.")
    home = home.resolve()
    home.mkdir(parents=True, exist_ok=True)
    environment = home / "venv"
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.is_file():
        venv.EnvBuilder(with_pip=True).create(environment)
    subprocess.run([str(python), "-m", "pip", "install", "--only-binary=:all:",
                    "-r", str(Path(__file__).with_name("requirements.txt"))], check=True)
    archive = home / "sensevoice-int8-20240717.tar.bz2"
    if not archive.is_file() or digest(archive) != MODEL_SHA256:
        partial = archive.with_suffix(".download")
        try:
            with urllib.request.urlopen(MODEL_URL, timeout=60) as response, partial.open("wb") as target:
                copied = 0
                while chunk := response.read(1024 * 1024):
                    copied += len(chunk)
                    if copied > 200 * 1024 * 1024:
                        raise ValueError("The upstream archive is unexpectedly large.")
                    target.write(chunk)
            if digest(partial) != MODEL_SHA256:
                raise ValueError("The downloaded model does not match the pinned SHA-256.")
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    model_dir = home / "models" / MODEL_DIRECTORY
    # Re-extract from the verified official archive; never execute its scripts.
    with tarfile.open(archive) as source:
        source.extractall(home / "models", filter="data")
    manifest = {"service": "amuse-local-voice", "model": "sensevoice-small-int8", "device": "cpu",
                "model_source": MODEL_URL, "archive_sha256": MODEL_SHA256,
                "files": {name: digest(model_dir / name) for name in ["model.int8.onnx", "tokens.txt"]},
                "python": str(python), "model_directory": str(model_dir),
                "requirements": Path(__file__).with_name("requirements.txt").read_text().splitlines()}
    (home / "installation.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", required=True, type=Path)
    install(parser.parse_args().home)
