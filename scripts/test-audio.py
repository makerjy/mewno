"""Generate reproducible developer fixtures from the credited Korean recording."""
import pathlib
import subprocess
import sys
import wave

root = pathlib.Path(__file__).resolve().parents[1]
build = root / ".build"
build.mkdir(exist_ok=True)
mp3 = root / "tests/fixtures/greetings.mp3"
wav = build / "greetings.wav"
ffmpeg = sys.argv[1] if len(sys.argv) > 1 else "ffmpeg"

def convert(args, target):
    subprocess.run([ffmpeg, "-loglevel", "error", "-y", *args, target], check=True)

convert(["-i", mp3, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"], wav)
convert(["-i", wav, "-c:a", "aac"], build / "greetings.m4a")
convert(["-f", "lavfi", "-i", "color=s=160x120:r=1", "-i", mp3,
         "-c:v", "libx264", "-c:a", "aac", "-shortest"], build / "test-video.mp4")
with wave.open(str(wav), "rb") as src, wave.open(str(build / "hour.wav"), "wb") as dst:
    dst.setparams(src.getparams())
    for _ in range(60):
        dst.writeframesraw(bytes(60 * 16000 * 2))
    dst.writeframes(src.readframes(src.getnframes()))
