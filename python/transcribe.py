#!/usr/bin/env python3
"""Transcribe a video/audio file with faster-whisper and write word-timed JSON.

Usage: transcribe.py --input FILE --output transcript.json [--model large-v3] [--language auto] [--ffmpeg PATH] [--device auto]
Progress lines are printed to stdout as:  PROGRESS <seconds_done> <total_seconds>
"""
import argparse, json, os, subprocess, sys, tempfile, time

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--language", default="auto")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--compute", default="default")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper is not installed. Run: python3 -m pip install --user faster-whisper", file=sys.stderr)
        sys.exit(2)

    tmpdir = tempfile.mkdtemp(prefix="overlay-studio-")
    wav = os.path.join(tmpdir, "audio.wav")
    print("STATUS extracting audio", flush=True)
    subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", args.input,
                    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], check=True)

    device = args.device
    compute = args.compute
    if device == "auto":
        device = "cpu"
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                device = "cuda"
        except Exception:
            pass
    if compute == "default":
        compute = "float16" if device == "cuda" else "int8"

    print(f"STATUS loading model {args.model} on {device} ({compute})", flush=True)
    t0 = time.time()
    model = WhisperModel(args.model, device=device, compute_type=compute)
    print(f"STATUS model ready in {time.time()-t0:.1f}s", flush=True)

    lang = None if args.language in ("", "auto") else args.language
    segments_iter, info = model.transcribe(
        wav, language=lang, beam_size=5, word_timestamps=True,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 400},
        condition_on_previous_text=False,
    )
    total = float(info.duration or 0)
    print(f"STATUS language={info.language} p={info.language_probability:.2f} duration={total:.1f}", flush=True)

    segments = []
    for i, seg in enumerate(segments_iter):
        words = [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 2)} for w in (seg.words or [])]
        segments.append({"id": i, "start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text.strip(), "words": words})
        print(f"PROGRESS {seg.end:.2f} {total:.2f}", flush=True)

    out = {
        "language": info.language,
        "languageProbability": round(float(info.language_probability), 3),
        "duration": total,
        "model": args.model,
        "segments": segments,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    try:
        os.remove(wav); os.rmdir(tmpdir)
    except Exception:
        pass
    print("DONE", flush=True)

if __name__ == "__main__":
    main()
