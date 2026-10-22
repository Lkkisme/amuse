# Local CPU voice for Amuse

This optional loopback service implements the existing OpenAI-style
`POST /v1/audio/transcriptions` endpoint. It runs the official sherpa-onnx
SenseVoiceSmall INT8 model on **CPU with two threads**, without loading a GPU
runtime, calling a cloud API, or changing the conversation model/context.
It supports Mandarin, English, Cantonese, Japanese and Korean. Recognition can
make mistakes; the composer lets the user review the returned text before sending.

Install once with 64-bit Python 3.12 (packages go in a dedicated venv):

```powershell
& D:/LocalAI/Python312/python.exe scripts/local-voice/install.py --home D:/LocalAI/Amuse-services/voice
```

Run under the same persistent host as Amuse:

```powershell
& D:/LocalAI/Amuse-services/voice/venv/Scripts/python.exe -X utf8 scripts/local-voice/server.py --home D:/LocalAI/Amuse-services/voice --port 7089 --threads 2
```

Set only the existing voice settings to:

```json
{"voice":"local","localVoice":{"url":"http://127.0.0.1:7089/v1","model":"sensevoice-small-int8"}}
```

Do not replace the other model choices, thinking settings or credentials.
`GET /health` identifies this service as `amuse-local-voice` and reports
`device: cpu`. `GET /v1/models` lists its speech model. Bind is fixed to
`127.0.0.1`; the authenticated Amuse server proxies the phone's recording.

The HTTP process imports only Python's standard library. For each recording,
one child process locally decodes WebM/Opus, Ogg/Opus, MP4/AAC, MP3 or WAV into
16 kHz mono PCM and loads the model. The child exits after the response, releasing
the model memory. Requests are serialized with immediate 429 responses when
busy. A recording is limited to 25 MiB, 120 seconds, and a 50-second worker
deadline. Uploaded audio lives in a temporary directory which is removed after
the request; neither recordings nor transcriptions are written to logs.

The model archive is 163 MB (238 MB ONNX after extraction). Installation verifies
its pinned SHA-256 and preserves the upstream license. Runtime packages are
pinned in `requirements.txt`; their Windows wheels include the CPU execution
provider and PyAV's audio codecs, so no FFmpeg installation or CUDA is required.

Primary references:

- [sherpa-onnx SenseVoice models and languages](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)
- [official Python API](https://k2-fsa.github.io/sherpa/onnx/sense-voice/python-api.html)
- [PyAV local audio decoding and resampling](https://pyav.org/docs/stable/api/audio.html)

Tests use public upstream speech recordings, never the user's microphone:

```powershell
& D:/LocalAI/Amuse-services/voice/venv/Scripts/python.exe -X utf8 scripts/local-voice/test_server.py --home D:/LocalAI/Amuse-services/voice --report .local/verification/local-voice-result.json
```
