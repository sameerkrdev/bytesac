# python tools/beats.py <audio> [out.json] — beat grid for the animation (bpm, beats, downbeats, hits).
import sys, json, numpy as np, librosa

y, sr = librosa.load(sys.argv[1], sr=None, mono=True)
tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
beats = librosa.frames_to_time(frames, sr=sr).round(3).tolist()
onset = librosa.onset.onset_strength(y=y, sr=sr)
peaks = librosa.util.peak_pick(onset, pre_max=3, post_max=3, pre_avg=3, post_avg=5, delta=0.5, wait=10)
rms = librosa.feature.rms(y=y)[0]
out = {
    "duration": round(len(y) / sr, 3),
    "bpm": round(float(np.atleast_1d(tempo)[0]), 2),
    "beats": beats,
    "downbeats": beats[::4],
    "hits": librosa.frames_to_time(peaks, sr=sr).round(3).tolist(),
    # loudness envelope at 10 Hz, 0..1, for audio-reactive touches
    "env": (np.interp(np.arange(0, len(y) / sr, 0.1), librosa.times_like(rms, sr=sr), rms) / rms.max()).round(3).tolist(),
}
text = json.dumps(out, indent=1)
open(sys.argv[2], "w").write(text) if len(sys.argv) > 2 else print(text)
print(f"bpm {out['bpm']}  beats {len(beats)}  duration {out['duration']}s", file=sys.stderr)
