import numpy as np

from app.pipeline import audio, sync

SR = audio.SR


def song(seconds=40, seed=0) -> np.ndarray:
    """A made-up song: a random chord every half second plus a kick on the beat."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * SR)) / SR
    y = np.zeros_like(t)
    for start in np.arange(0, seconds, 0.5):
        notes = 220 * 2 ** (rng.choice(24, 3, replace=False) / 12)
        m = (t >= start) & (t < start + 0.5)
        for f in notes:
            y[m] += 0.2 * np.sin(2 * np.pi * f * t[m])
        k = (t >= start) & (t < start + 0.05)
        y[k] += 0.8 * np.sin(2 * np.pi * 60 * t[k]) * np.exp(-(t[k] - start) * 60)
    return y.astype(np.float32)


def test_finds_snippet_position_through_noise():
    y = song()
    fp = audio.fingerprint(y)
    a, b = int(17.0 * SR), int(23.0 * SR)
    rng = np.random.default_rng(1)
    # Through a speaker and a laptop mic: quieter, a bit of echo, background noise.
    mic = 0.4 * y[a:b]
    mic[2000:] += 0.15 * mic[:-2000]
    mic += 0.05 * rng.standard_normal(len(mic)).astype(np.float32)
    r = sync.locate(fp, mic)
    assert abs(r["position"] - 23.0) < 0.3
    assert r["confidence"] > 0.3


def test_unrelated_audio_has_low_confidence():
    fp = audio.fingerprint(song(seed=0))
    other = song(seconds=6, seed=7)
    r = sync.locate(fp, other)
    assert r["confidence"] < 0.5


def test_too_short_snippet():
    fp = audio.fingerprint(song(seconds=10))
    assert sync.locate(fp, np.zeros(SR // 2, dtype=np.float32))["position"] is None
