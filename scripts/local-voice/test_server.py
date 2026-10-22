"""Real HTTP/codec/CPU-ASR acceptance test using public upstream audio only."""
import argparse
import ctypes
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import threading
import urllib.error
import urllib.request
import wave

import av

from server import MAX_BYTES, MAX_SECONDS, MODEL_DIRECTORY, MODEL_ID, run_worker


def transcode(filename, container_format, codec):
    buffer = io.BytesIO()
    with av.open(str(filename)) as source, av.open(buffer, mode="w", format=container_format) as target:
        stream = target.add_stream(codec, rate=48_000)
        stream.layout = "mono"
        stream.bit_rate = 48_000
        resampler = av.AudioResampler(format=stream.codec_context.format.name, layout="mono", rate=48_000)
        for frame in source.decode(audio=0):
            for converted in resampler.resample(frame):
                for packet in stream.encode(converted):
                    target.mux(packet)
        for converted in resampler.resample(None):
            for packet in stream.encode(converted):
                target.mux(packet)
        for packet in stream.encode(None):
            target.mux(packet)
    return buffer.getvalue()


def multipart(data, model=MODEL_ID, filename="recording.webm", content_type="audio/webm"):
    boundary = "amuse-public-speech-fixture"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return body, {"Content-Type": f"multipart/form-data; boundary={boundary}"}


def request(url, body=None, headers=None):
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers or {}), timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response)


def windows_memory(pid):
    if sys.platform != "win32":
        return None
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                    *[(name, ctypes.c_size_t) for name in ["PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                       "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage"]]]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    api = ctypes.WinDLL("psapi")
    api.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return None
    try:
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        if not api.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            return None
        return {"working_set_mib": round(counters.WorkingSetSize / 1024 / 1024, 2),
                "peak_working_set_mib": round(counters.PeakWorkingSetSize / 1024 / 1024, 2)}
    finally:
        kernel.CloseHandle(handle)


def main(home, report_path):
    fixtures = home / "models" / MODEL_DIRECTORY / "test_wavs"
    chinese = fixtures / "zh.wav"
    english = fixtures / "en.wav"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    report = {"at": datetime.now(timezone.utc).isoformat(), "service": "amuse-local-voice", "model": MODEL_ID,
              "device": "cpu", "threads": 2, "fixture_source": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/" + MODEL_DIRECTORY + ".tar.bz2",
              "fixtures": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [chinese, english]}, "recognitions": [], "negative_checks": []}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.with_suffix(".http.log").open("wb") as log:
        server = subprocess.Popen([sys.executable, "-X", "utf8", str(Path(__file__).with_name("server.py")), "--home", str(home), "--port", str(port)],
                                  stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        base = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 10
            while True:
                try:
                    status, health = request(base + "/health")
                    break
                except OSError:
                    if time.monotonic() > deadline or server.poll() is not None:
                        raise RuntimeError("Local speech test server did not start.")
                    time.sleep(0.1)
            assert status == 200 and health["service"] == "amuse-local-voice" and health["device"] == "cpu"
            report["health"] = health
            report["http_memory_before"] = windows_memory(health["pid"])
            recordings = [
                ("mandarin-wav", chinese.read_bytes(), "recording.wav", "audio/wav"),
                ("mandarin-webm-opus", transcode(chinese, "webm", "libopus"), "recording.webm", "audio/webm;codecs=opus"),
                ("mandarin-ogg-opus", transcode(chinese, "ogg", "libopus"), "recording.ogg", "audio/ogg;codecs=opus"),
                ("mandarin-m4a-aac", transcode(chinese, "mp4", "aac"), "recording.m4a", "audio/mp4"),
                ("mandarin-mp3", transcode(chinese, "mp3", "libmp3lame"), "recording.mp3", "audio/mpeg"),
                ("english-wav", english.read_bytes(), "recording.wav", "audio/wav"),
            ]
            for name, recording, filename, content_type in recordings:
                body, headers = multipart(recording, filename=filename, content_type=content_type)
                status, said = request(base + "/v1/audio/transcriptions", body, headers)
                assert status == 200, (name, status, said)
                assert said["text"] and said["model"] == MODEL_ID
                if name.startswith("mandarin"):
                    assert "时间" in said["text"] and "下午" in said["text"], said
                else:
                    assert "".join(c for c in said["text"] if c.isascii() and c.isalpha()), said
                report["recognitions"].append({"fixture": name, "bytes": len(recording), **said})
            for name, body, headers, expected in [
                ("invalid-audio", *multipart(b"this is not audio"), 400),
                ("playlist-is-not-self-contained-audio", *multipart(b"#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nhttp://127.0.0.1:1/audio.ts\n#EXT-X-ENDLIST\n"), 400),
                ("unknown-model", *multipart(chinese.read_bytes(), model="wrong-model"), 400),
                ("empty-audio", *multipart(b""), 400),
                ("host-rebinding", *multipart(chinese.read_bytes()), 403),
                ("upload-size-limit", b"", {"Content-Type": "multipart/form-data; boundary=test", "Content-Length": str(MAX_BYTES + 1)}, 413),
                ("non-multipart", b"test", {"Content-Type": "audio/webm"}, 415),
            ]:
                if name == "host-rebinding":
                    headers["Host"] = "untrusted.example"
                status, error = request(base + "/v1/audio/transcriptions", body, headers)
                assert status == expected, (name, status, error)
                report["negative_checks"].append({"name": name, "status": status, "passed": True})
            long_audio = io.BytesIO()
            with wave.open(long_audio, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16_000)
                wav.writeframes(bytes(16_000 * (MAX_SECONDS + 1) * 2))
            body, headers = multipart(long_audio.getvalue(), filename="too-long.wav", content_type="audio/wav")
            status, _ = request(base + "/v1/audio/transcriptions", body, headers)
            assert status == 400
            report["negative_checks"].append({"name": "decoded-duration-limit", "status": status, "passed": True})
            in_flight = []
            body, headers = multipart(chinese.read_bytes(), filename="public.wav", content_type="audio/wav")
            first = threading.Thread(target=lambda: in_flight.append(request(base + "/v1/audio/transcriptions", body, headers)))
            first.start()
            deadline = time.monotonic() + 5
            while not request(base + "/health")[1]["busy"]:
                assert time.monotonic() < deadline, "The first transcription did not start."
                time.sleep(0.01)
            status, _ = request(base + "/v1/audio/transcriptions", body, headers)
            first.join(timeout=60)
            assert status == 429 and len(in_flight) == 1 and in_flight[0][0] == 200
            report["negative_checks"].append({"name": "single-cpu-worker", "status": status, "passed": True})
            try:
                run_worker([sys.executable, "-c", "import time; time.sleep(10)"], timeout=0.1)
                raise AssertionError("The worker deadline was not enforced.")
            except subprocess.TimeoutExpired:
                report["negative_checks"].append({"name": "owned-worker-timeout", "passed": True})
            report["http_memory_after"] = windows_memory(health["pid"])
            report["reference_mandarin"] = "开放时间早上9点至下午5点。"
            report["quality_note"] = "This is a functional codec/HTTP/ASR test, not an accuracy benchmark. The public Mandarin fixture has a homophone recognition error (开放 -> 开饭); do not report perfect recognition."
            report["passed"] = True
        finally:
            server.terminate()
            server.wait(timeout=10)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    main(args.home, args.report)
