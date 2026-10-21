# Synthesizes the promo soundtrack: a driving 128 bpm beat, bass, whooshes on cuts, booms on kills.
import json, sys, wave
import numpy as np

D = sys.argv[1]
ev = json.load(open(f'{D}/events.json'))
SR, FPS = 44100, ev['fps']
dur = ev['frames'] / FPS + 0.6
n = int(dur * SR)
L = np.zeros(n); Rr = np.zeros(n)
rng = np.random.default_rng(7)
BPM = 128; beat = 60 / BPM
end_t = ev['cuts'][-1] / FPS

def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= n: return
    sig = sig[: n - i] * gain
    L[i:i + len(sig)] += sig * (1 - max(0, pan))
    Rr[i:i + len(sig)] += sig * (1 + min(0, pan))

def env(length, attack=0.002, decay=0.2):
    t = np.arange(int(length * SR)) / SR
    return np.minimum(1, t / attack) * np.exp(-t / decay), t

def kick():
    e, t = env(0.45, 0.001, 0.12)
    f = 48 + 110 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * e

def snare():
    e, t = env(0.25, 0.001, 0.06)
    return (rng.standard_normal(len(t)) * 0.7 + np.sin(2 * np.pi * 190 * t) * 0.4) * e

def hat():
    e, t = env(0.06, 0.0005, 0.012)
    s = rng.standard_normal(len(t)); s = np.diff(s, prepend=0)
    return s * e

def bass(freq, length):
    e, t = env(length, 0.004, length * 0.6)
    saw = 2 * ((t * freq) % 1) - 1
    sq = np.sign(np.sin(2 * np.pi * freq / 2 * t))
    s = saw * 0.6 + sq * 0.3
    k = 40; s = np.convolve(s, np.ones(k) / k, mode='same')  # soften
    return s * e

def boom(size):
    e, t = env(1.1, 0.002, 0.25 + 0.1 * size)
    s = rng.standard_normal(len(t))
    for k in (60, 30):
        s = np.convolve(s, np.ones(k) / k, mode='same')
    sub = np.sin(2 * np.pi * (38 + 60 * np.exp(-t / 0.05)) * t)
    return (s * 4 + sub * 0.8) * e

def whoosh(length=0.45):
    t = np.arange(int(length * SR)) / SR
    s = rng.standard_normal(len(t))
    s = np.convolve(s, np.ones(12) / 12, mode='same')
    shape = np.sin(np.pi * t / length) ** 2
    return s * shape * 1.4

def stab(freqs, length):
    e, t = env(length, 0.003, length * 0.5)
    s = sum(2 * ((t * f) % 1) - 1 for f in freqs) / len(freqs)
    s = np.convolve(s, np.ones(20) / 20, mode='same')
    return s * e

# chord roots per bar (A minor-ish: Am F C G), as bass frequencies
roots = [55.0, 43.65, 65.41, 49.0]
K, S, Hh, B = kick(), snare(), hat(), None
nb = int(end_t / beat)
for b in range(nb):
    t = b * beat
    bar = b // 4
    intro = t < 0.95  # sparse first second, then the drop
    add(K, t, 0.9)
    if b % 4 in (1, 3) and not intro: add(S, t, 0.35)
    for h in range(2):
        if not intro or h == 1: add(Hh, t + h * beat / 2, 0.22 if h else 0.12, pan=0.3 if h else -0.3)
    r = roots[bar % 4]
    for q in range(2):
        add(bass(r, beat / 2 * 0.9), t + q * beat / 2, 0.55)
    if b % 4 == 0 and not intro:
        add(stab([r * 4, r * 4 * 1.189, r * 4 * 1.498], beat * 1.8), t, 0.13, pan=-0.2)

# end card: one big hit and a ring-out chord
add(boom(2.0), end_t, 0.55)
add(K, end_t, 1.0)
add(stab([220, 261.6, 329.6, 440], 2.4), end_t, 0.22)

for c in ev['cuts'][1:]:
    add(whoosh(), max(0, c / FPS - 0.3), 0.35)

for e in ev['booms']:
    add(boom(e['s']), e['f'] / FPS, 0.28 * min(1.6, e['s']), pan=float(rng.uniform(-0.4, 0.4)))

# fade out and normalize
fade = int(0.5 * SR)
for ch in (L, Rr):
    ch[-fade:] *= np.linspace(1, 0, fade)
mx = max(np.abs(L).max(), np.abs(Rr).max())
st = np.stack([L, Rr], 1) / mx * 0.89
st = np.tanh(st * 1.4) / np.tanh(1.4)
with wave.open(f'{D}/music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
print('wrote', dur, 's')
