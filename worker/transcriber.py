"""
Podblock transcription worker.

A long-lived process that loads a Whisper model once and then transcribes
audio files on request. The Next.js server talks to it over stdin/stdout
using newline-delimited JSON:

  request:  {"id": "abc", "path": "/tmp/window.wav", "language": "en"}
  response: {"id": "abc", "segments": [{"start": 0.0, "end": 2.1, "text": "..."}], "ms": 3120}
  error:    {"id": "abc", "error": "message"}

On startup it prints {"ready": true, "model": "base"} once the model is loaded.
Anything that isn't protocol output goes to stderr.
"""

import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")


def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main():
    model_name = os.environ.get("WHISPER_MODEL", "base")
    try:
        import whisper  # openai-whisper
    except ImportError:
        emit({"fatal": "The 'openai-whisper' Python package is not installed (pip install openai-whisper)."})
        return 1

    try:
        model = whisper.load_model(model_name, device="cpu")
    except Exception as exc:  # noqa: BLE001 - report any load failure to the parent
        emit({"fatal": f"Could not load Whisper model '{model_name}': {exc}"})
        return 1

    emit({"ready": True, "model": model_name})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        request_id = request.get("id")
        started = time.time()
        try:
            language = request.get("language") or None
            result = model.transcribe(
                request["path"],
                fp16=False,
                language=language,
                # Each window is transcribed independently; conditioning on
                # previous text makes Whisper prone to repetition loops.
                condition_on_previous_text=False,
                verbose=None,
            )
            segments = []
            for seg in result.get("segments", []):
                text = seg.get("text", "").strip()
                # Drop silence that Whisper tends to "hear" words in.
                if not text or seg.get("no_speech_prob", 0) > 0.8:
                    continue
                segments.append(
                    {
                        "start": round(float(seg["start"]), 2),
                        "end": round(float(seg["end"]), 2),
                        "text": text,
                    }
                )
            emit(
                {
                    "id": request_id,
                    "segments": segments,
                    "language": result.get("language"),
                    "ms": int((time.time() - started) * 1000),
                }
            )
        except Exception as exc:  # noqa: BLE001 - keep the worker alive
            emit({"id": request_id, "error": str(exc)})

    return 0


if __name__ == "__main__":
    sys.exit(main())
