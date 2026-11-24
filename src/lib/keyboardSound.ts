import { SOUND_SAMPLES } from '../assets/sounds/samples';

export type TypingSound = 'key' | 'space' | 'enter' | 'backspace';

let audioContext: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
const decoded = new Map<string, AudioBuffer>();
let loadPromise: Promise<void> | null = null;
let lastPlayedAt = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) {
    audioContext = new AudioContextCtor({ latencyHint: 'interactive' });
  }
  if (!noiseBuffer) {
    const length = Math.max(1, Math.floor(audioContext.sampleRate * 0.12));
    noiseBuffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
  }
  if (audioContext.state === 'suspended') {
    void audioContext.resume();
  }
  return audioContext;
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function loadSamples(context: AudioContext): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    // Only Space and Enter use the recorded Cherry MX Brown samples. Every other
    // key uses the original synthesized click.
    const urls = [...SOUND_SAMPLES.space, ...SOUND_SAMPLES.enter];
    await Promise.all(
      urls.map(async (url) => {
        if (decoded.has(url)) return;
        try {
          const buffer = await context.decodeAudioData(dataUrlToArrayBuffer(url));
          decoded.set(url, buffer);
        } catch (error) {
          console.warn('[sound] failed to decode key sample', error);
        }
      }),
    );
  })();
  return loadPromise;
}

export function primeTypingSounds(): void {
  const context = getAudioContext();
  if (!context) return;
  void loadSamples(context);
}

function playNoiseBurst(
  context: AudioContext,
  time: number,
  options: {
    frequency: number;
    q: number;
    peak: number;
    decay: number;
    type?: BiquadFilterType;
  },
): void {
  if (!noiseBuffer) return;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = options.type || 'bandpass';
  filter.frequency.setValueAtTime(options.frequency, time);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(80, options.frequency * 0.75),
    time + options.decay,
  );
  filter.Q.value = options.q;
  const gain = context.createGain();
  gain.gain.setValueAtTime(1e-4, time);
  gain.gain.exponentialRampToValueAtTime(options.peak, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(1e-4, time + options.decay);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(time, Math.random() * 0.03);
  source.stop(time + options.decay + 0.008);
}

function playClassicClick(context: AudioContext, kind: TypingSound): void {
  const now = context.currentTime + 0.001;
  const variance = 0.94 + Math.random() * 0.12;

  if (kind === 'backspace') {
    playNoiseBurst(context, now, {
      frequency: 2100,
      q: 0.9,
      peak: 0.028,
      decay: 0.022,
    });
    return;
  }

  playNoiseBurst(context, now, {
    frequency: 1850 * variance + Math.random() * 780,
    q: 0.85,
    peak: 0.032,
    decay: 0.025,
  });
}

async function playRealSample(kind: 'space' | 'enter'): Promise<void> {
  const context = getAudioContext();
  if (!context) return;
  await loadSamples(context);
  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      return;
    }
  }
  const sourceList = SOUND_SAMPLES[kind];
  if (!sourceList.length) return;
  const url = sourceList[Math.floor(Math.random() * sourceList.length)];
  const buffer = decoded.get(url);
  if (!buffer) return;

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = 0.985 + Math.random() * 0.03;

  const gain = context.createGain();
  gain.gain.value = kind === 'space' ? 0.26 : 0.28;
  gain.gain.value *= 0.94 + Math.random() * 0.12;
  source.connect(gain);
  gain.connect(context.destination);
  source.start();
}

export function playTypingSound(kind: TypingSound): void {
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (nowMs - lastPlayedAt < 8) return;
  lastPlayedAt = nowMs;
  if (kind === 'space' || kind === 'enter') {
    void playRealSample(kind);
    return;
  }
  const context = getAudioContext();
  if (context) playClassicClick(context, kind);
}

export function playSoundPreview(): void {
  primeTypingSounds();
  playTypingSound('key');
  window.setTimeout(() => playTypingSound('space'), 150);
  window.setTimeout(() => playTypingSound('enter'), 380);
}