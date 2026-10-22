"""Loopback-only CPU speech recognition for Amuse's existing localVoice setting.

The HTTP process imports only the standard library. Each recording is decoded
and transcribed in one bounded child process; exiting releases all model/KV
memory. No audio, transcript, GPU runtime, or cloud API is retained or used.
"""
from __future__ import annotations

import argparse
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

MODEL_ID = "sensevoice-small-int8"
MODEL_DIRECTORY = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
SAMPLE_RATE = 16_000
MAX_BYTES = 25 * 1024 * 1024
MAX_SECONDS = 120
LANGUAGES = {"auto", "zh", "en", "ja", "ko", "yue"}


class InvalidAudio(ValueError):
    pass


def decode_audio(filename: Path):
    """Decode browser WebM/Opus, Ogg, MP4/AAC, MP3 or WAV to mono float32 PCM."""
    import av
    import numpy as np

    chunks = []
    count = 0
    try:
        # Accept self-contained audio containers only, never playlists or remote
        # protocol inputs hidden inside an uploaded file.
        with av.open(str(filename), mode="r", options={
            "protocol_whitelist": "file,pipe",
            "format_whitelist": "wav,matroska,webm,ogg,mov,mp4,m4a,3gp,3g2,mj2,mp3,aac,flac",
        }) as source:
            if not source.streams.audio:
                raise InvalidAudio("The recording does not contain audio.")
            audio = source.streams.audio[0]
            audio.codec_context.thread_count = 1
            resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
            for frame in source.decode(audio):
                for converted in resampler.resample(frame):
                    values = converted.to_ndarray().reshape(-1)
                    count += len(values)
                    if count > SAMPLE_RATE * MAX_SECONDS:
                        raise InvalidAudio(f"Recordings must be at most {MAX_SECONDS} seconds.")
                    chunks.append(values)
            for converted in resampler.resample(None):
                values = converted.to_ndarray().reshape(-1)
                count += len(values)
                if count > SAMPLE_RATE * MAX_SECONDS:
                    raise InvalidAudio(f"Recordings must be at most {MAX_SECONDS} seconds.")
                chunks.append(values)
    except InvalidAudio:
        raise
    except Exception as error:
        raise InvalidAudio("The recording could not be decoded. Try recording again.") from error
    if not chunks or count < SAMPLE_RATE // 10:
        raise InvalidAudio("The recording is empty or too short.")
    samples = np.concatenate(chunks).astype(np.float32, copy=False)
    if not np.isfinite(samples).all():
        raise InvalidAudio("The recording contains invalid audio samples.")
    return samples


def decode_request(filename: Path, model_dir: Path, threads: int, language: str) -> dict:
    # Decode before loading the model so invalid/oversized audio stays cheap.
    samples = decode_audio(filename)
    import sherpa_onnx

    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model_dir / "model.int8.onnx"),
        tokens=str(model_dir / "tokens.txt"),
        num_threads=threads,
        language=language,
        use_itn=True,
        provider="cpu",
        debug=False,
    )
    stream = recognizer.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    recognizer.decode_stream(stream)
    return {"text": stream.result.text.strip(), "language": stream.result.lang,
            "duration": len(samples) / SAMPLE_RATE, "model": MODEL_ID}


def run_worker(command, timeout):
    """Bound the owned worker tree, including Windows venv launcher children."""
    worker = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, encoding="utf-8",
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        stdout, stderr = worker.communicate(timeout=timeout)
        return subprocess.CompletedProcess(command, worker.returncode, stdout, stderr)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            # Only the child created above; never a model/provider service PID.
            subprocess.run(["taskkill", "/PID", str(worker.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW, check=False, timeout=10)
        else:
            worker.kill()
        worker.communicate(timeout=10)
        raise


def make_handler(model_dir: Path, threads: int, worker_timeout: int = 50):
    gate = threading.BoundedSemaphore(1)
    busy = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        server_version = "AmuseLocalVoice"

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def log_message(self, _format, *_args):
            # Do not log recordings, transcripts, multipart fields or filenames.
            pass

        def reply(self, status: int, value: dict):
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def error(self, status: int, message: str):
            self.reply(status, {"error": {"message": message, "type": "local_voice_error"}})

        def host_allowed(self) -> bool:
            hostname = urlsplit("http://" + self.headers.get("Host", "")).hostname
            return hostname in {"127.0.0.1", "localhost"}

        def do_GET(self):
            if not self.host_allowed():
                return self.error(403, "This service only accepts loopback requests.")
            if self.path == "/health":
                ready = (model_dir / "model.int8.onnx").is_file() and (model_dir / "tokens.txt").is_file()
                return self.reply(200 if ready else 503, {
                    "status": "ok" if ready else "model_missing", "service": "amuse-local-voice", "model": MODEL_ID,
                    "device": "cpu", "threads": threads, "model_loaded": False, "busy": busy.is_set(), "pid": os.getpid(),
                    "lifecycle": "one child per recording; memory released after response",
                    "formats": ["webm/opus", "ogg/opus", "m4a/aac", "wav", "mp3"],
                })
            if self.path == "/v1/models":
                return self.reply(200, {"object": "list", "data": [
                    {"id": MODEL_ID, "object": "model", "owned_by": "local"}]})
            self.error(404, "Unknown endpoint.")

        def do_POST(self):
            if not self.host_allowed():
                return self.error(403, "This service only accepts loopback requests.")
            if self.path != "/v1/audio/transcriptions":
                return self.error(404, "Unknown endpoint.")
            if self.headers.get("Transfer-Encoding"):
                return self.error(400, "A Content-Length is required.")
            try:
                size = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                return self.error(400, "Invalid Content-Length.")
            if size < 0:
                return self.error(411, "A Content-Length is required.")
            if size > MAX_BYTES:
                return self.error(413, "The recording is too large (25 MiB maximum).")
            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data;") or "\r" in content_type or "\n" in content_type:
                return self.error(415, "Use multipart/form-data with model and file fields.")
            if not gate.acquire(blocking=False):
                return self.error(429, "Another recording is being transcribed. Try again shortly.")
            busy.set()
            try:
                body = self.rfile.read(size)
                if len(body) != size:
                    return self.error(400, "The recording upload was incomplete.")
                message = BytesParser(policy=email_policy).parsebytes(
                    ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body)
                if not message.is_multipart():
                    return self.error(400, "Invalid multipart recording.")
                parts = list(message.iter_parts())
                if len(parts) > 8:
                    return self.error(400, "Too many multipart fields.")
                fields = {part.get_param("name", header="content-disposition"): part.get_payload(decode=True)
                          for part in parts}
                model = fields.get("model", b"").decode("utf-8", errors="replace")
                language = fields.get("language", b"auto").decode("utf-8", errors="replace")
                if model != MODEL_ID:
                    return self.error(400, f"The installed speech model is {MODEL_ID}.")
                if language not in LANGUAGES:
                    return self.error(400, "Supported languages: auto, zh, en, ja, ko, yue.")
                recording = fields.get("file")
                if not recording:
                    return self.error(400, "A non-empty file field is required.")
                if not (model_dir / "model.int8.onnx").is_file() or not (model_dir / "tokens.txt").is_file():
                    return self.error(503, "The local speech model is not installed.")
                # Temporary audio is closed before spawning on Windows and always deleted.
                with tempfile.TemporaryDirectory(prefix="amuse-voice-") as directory:
                    filename = Path(directory) / "recording"
                    filename.write_bytes(recording)
                    started = time.monotonic()
                    result = run_worker(
                        [sys.executable, "-X", "utf8", str(Path(__file__).resolve()), "--decode", str(filename),
                         "--model-dir", str(model_dir), "--threads", str(threads), "--language", language],
                        timeout=worker_timeout,
                    )
                    if result.returncode:
                        return self.error(400 if result.returncode == 2 else 503,
                                          "The recording could not be decoded; try recording again."
                                          if result.returncode == 2 else "The local speech worker failed. Check its installation.")
                    said = json.loads(result.stdout)
                    said["processing_seconds"] = round(time.monotonic() - started, 3)
                    self.reply(200, said)
            except subprocess.TimeoutExpired:
                self.error(504, "The recording took too long to transcribe; try a shorter recording.")
            except (ValueError, OSError, TypeError):
                self.error(400, "The recording request could not be read.")
            finally:
                busy.clear()
                gate.release()

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path(os.environ.get("AMUSE_VOICE_HOME", ".local/voice")))
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--port", type=int, default=7089)
    parser.add_argument("--threads", type=int, default=2, choices=range(1, 5))
    parser.add_argument("--decode", type=Path)
    parser.add_argument("--language", default="auto", choices=sorted(LANGUAGES))
    args = parser.parse_args()
    model_dir = args.model_dir or args.home / "models" / MODEL_DIRECTORY
    if args.decode:
        try:
            print(json.dumps(decode_request(args.decode, model_dir, args.threads, args.language), ensure_ascii=False))
        except InvalidAudio:
            sys.exit(2)
        return
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(model_dir, args.threads))
    server.daemon_threads = True
    print(f"Amuse CPU speech listening on http://127.0.0.1:{args.port}; model loaded only during recordings", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
