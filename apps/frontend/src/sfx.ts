// Tiny synthesized sound effects for Veydrift. Everything is generated with
// Web Audio oscillators/noise — no audio assets, no dependencies. Sounds are
// deliberately quiet PC-speaker-style blips that match the retro CD-ROM look.

export type SfxName =
  | "cd-close"
  | "cd-flip"
  | "cd-open"
  | "click"
  | "connect"
  | "copy"
  | "error"
  | "hover-tick"
  | "mission-launch"
  | "notice-error"
  | "notice-success"
  | "queue-complete"
  | "settle-launch"
  | "settle-success"
  | "tab"
  | "tx-confirm"
  | "tx-pending";

export type SfxLoopName = "disc-spin";

const MUTED_STORAGE_KEY = "veydrift:sfx-muted";
const MASTER_VOLUME = 0.5;

type ToneSpec = {
  at?: number;
  duration: number;
  endFreq?: number;
  freq: number;
  gain: number;
  type?: OscillatorType;
};

type NoiseSpec = {
  at?: number;
  duration: number;
  endFreq?: number;
  filterType?: BiquadFilterType;
  freq: number;
  gain: number;
  q?: number;
};

const SFX: Record<SfxName, { noise?: NoiseSpec[]; tones?: ToneSpec[] }> = {
  "cd-open": {
    noise: [
      { duration: 0.24, endFreq: 1400, freq: 420, gain: 0.16, q: 1.6 },
      { at: 0.2, duration: 0.05, filterType: "highpass", freq: 1800, gain: 0.2 },
    ],
    tones: [{ at: 0.22, duration: 0.07, freq: 190, gain: 0.22, type: "sine" }],
  },
  "cd-close": {
    noise: [
      { duration: 0.18, endFreq: 380, freq: 1200, gain: 0.14, q: 1.6 },
      { at: 0.16, duration: 0.045, filterType: "highpass", freq: 1600, gain: 0.22 },
    ],
    tones: [{ at: 0.17, duration: 0.06, freq: 160, gain: 0.24, type: "sine" }],
  },
  "cd-flip": {
    noise: [{ duration: 0.42, endFreq: 500, filterType: "lowpass", freq: 2200, gain: 0.14, q: 0.9 }],
    tones: [{ at: 0.34, duration: 0.06, freq: 240, gain: 0.14, type: "sine" }],
  },
  click: { tones: [{ duration: 0.035, freq: 1250, gain: 0.12, type: "square" }] },
  connect: {
    tones: [
      { duration: 0.07, freq: 660, gain: 0.14, type: "triangle" },
      { at: 0.08, duration: 0.09, freq: 990, gain: 0.14, type: "triangle" },
    ],
  },
  copy: {
    tones: [
      { duration: 0.05, freq: 1500, gain: 0.1, type: "square" },
      { at: 0.055, duration: 0.06, freq: 2000, gain: 0.1, type: "square" },
    ],
  },
  error: {
    tones: [
      { duration: 0.12, freq: 220, gain: 0.16, type: "square" },
      { at: 0.13, duration: 0.16, freq: 175, gain: 0.16, type: "square" },
    ],
  },
  "hover-tick": { tones: [{ duration: 0.018, freq: 1900, gain: 0.045, type: "square" }] },
  "mission-launch": {
    noise: [{ duration: 0.3, endFreq: 900, filterType: "lowpass", freq: 260, gain: 0.16, q: 1.2 }],
    tones: [{ duration: 0.26, endFreq: 720, freq: 240, gain: 0.12, type: "sawtooth" }],
  },
  "notice-error": { tones: [{ duration: 0.14, freq: 200, gain: 0.14, type: "square" }] },
  "notice-success": {
    tones: [
      { duration: 0.07, freq: 784, gain: 0.12, type: "triangle" },
      { at: 0.08, duration: 0.1, freq: 1047, gain: 0.12, type: "triangle" },
    ],
  },
  "queue-complete": {
    tones: [
      { duration: 0.09, freq: 880, gain: 0.13, type: "triangle" },
      { at: 0.1, duration: 0.12, freq: 1175, gain: 0.13, type: "triangle" },
    ],
  },
  "settle-launch": {
    noise: [{ duration: 0.6, endFreq: 320, filterType: "lowpass", freq: 120, gain: 0.2, q: 0.8 }],
    tones: [{ duration: 0.5, endFreq: 800, freq: 200, gain: 0.12, type: "sawtooth" }],
  },
  "settle-success": {
    tones: [
      { duration: 0.1, freq: 523, gain: 0.15, type: "triangle" },
      { at: 0.1, duration: 0.1, freq: 659, gain: 0.15, type: "triangle" },
      { at: 0.2, duration: 0.1, freq: 784, gain: 0.15, type: "triangle" },
      { at: 0.3, duration: 0.22, freq: 1047, gain: 0.17, type: "triangle" },
    ],
  },
  tab: {
    tones: [
      { duration: 0.03, freq: 900, gain: 0.1, type: "square" },
      { at: 0.035, duration: 0.04, freq: 1350, gain: 0.09, type: "square" },
    ],
  },
  "tx-confirm": { tones: [{ duration: 0.09, endFreq: 1400, freq: 1000, gain: 0.11, type: "triangle" }] },
  "tx-pending": { tones: [{ duration: 0.05, freq: 700, gain: 0.09, type: "triangle" }] },
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = readStoredMuted();
const activeLoops = new Map<SfxLoopName, { gain: GainNode; nodes: AudioScheduledSourceNode[] }>();

function readStoredMuted(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MUTED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) {
    audioContext = new AudioContextCtor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = MASTER_VOLUME;
    masterGain.connect(audioContext.destination);
  }
  return audioContext;
}

function ensureNoiseBuffer(context: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const length = context.sampleRate;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    noiseBuffer = buffer;
  }
  return noiseBuffer;
}

function scheduleTone(context: AudioContext, destination: AudioNode, spec: ToneSpec, startAt: number) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const start = startAt + (spec.at ?? 0);
  const end = start + spec.duration;

  oscillator.type = spec.type ?? "square";
  oscillator.frequency.setValueAtTime(spec.freq, start);
  if (spec.endFreq) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, spec.endFreq), end);
  }
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, spec.gain), start + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(envelope).connect(destination);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function scheduleNoise(context: AudioContext, destination: AudioNode, spec: NoiseSpec, startAt: number) {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  const start = startAt + (spec.at ?? 0);
  const end = start + spec.duration;

  source.buffer = ensureNoiseBuffer(context);
  source.loop = true;
  filter.type = spec.filterType ?? "bandpass";
  filter.frequency.setValueAtTime(spec.freq, start);
  filter.Q.value = spec.q ?? 1;
  if (spec.endFreq) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.endFreq), end);
  }
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, spec.gain), start + 0.02);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  source.connect(filter).connect(envelope).connect(destination);
  source.start(start);
  source.stop(end + 0.05);
}

export function playSfx(name: SfxName): void {
  if (muted) return;
  const context = ensureContext();
  if (!context || !masterGain) return;
  if (context.state === "suspended") {
    void context.resume();
    return;
  }
  const definition = SFX[name];
  const startAt = context.currentTime + 0.005;
  for (const tone of definition.tones ?? []) {
    scheduleTone(context, masterGain, tone, startAt);
  }
  for (const noise of definition.noise ?? []) {
    scheduleNoise(context, masterGain, noise, startAt);
  }
}

function stopLoop(name: SfxLoopName, fadeOutMs = 120) {
  const loop = activeLoops.get(name);
  if (!loop || !audioContext) return;
  activeLoops.delete(name);
  const now = audioContext.currentTime;
  loop.gain.gain.cancelScheduledValues(now);
  loop.gain.gain.setTargetAtTime(0.0001, now, fadeOutMs / 1_000 / 3);
  for (const node of loop.nodes) {
    try {
      node.stop(now + fadeOutMs / 1_000 + 0.05);
    } catch {
      // Already stopped.
    }
  }
}

export function startSfxLoop(name: SfxLoopName): void {
  if (muted || activeLoops.has(name)) return;
  const context = ensureContext();
  if (!context || !masterGain) return;
  if (context.state === "suspended") {
    void context.resume();
    return;
  }

  const loopGain = context.createGain();
  loopGain.gain.setValueAtTime(0.0001, context.currentTime);
  loopGain.connect(masterGain);
  const nodes: AudioScheduledSourceNode[] = [];

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  source.buffer = ensureNoiseBuffer(context);
  source.loop = true;
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 2.2;
  source.connect(filter).connect(loopGain);
  source.start();
  nodes.push(source);
  loopGain.gain.setTargetAtTime(0.05, context.currentTime, 0.25);

  activeLoops.set(name, { gain: loopGain, nodes });
}

export function stopSfxLoop(name: SfxLoopName): void {
  stopLoop(name);
}

export function setSfxMuted(nextMuted: boolean): void {
  muted = nextMuted;
  try {
    window.localStorage.setItem(MUTED_STORAGE_KEY, nextMuted ? "1" : "0");
  } catch {
    // Storage unavailable; mute state only lives for this session.
  }
  if (typeof document !== "undefined") {
    document.documentElement.dataset.sfxMuted = nextMuted ? "1" : "0";
  }
  if (nextMuted) {
    for (const name of [...activeLoops.keys()]) {
      stopLoop(name);
    }
  }
}

export function isSfxMuted(): boolean {
  return muted;
}

// Browsers require a user gesture before audio can start. Attach one-time
// listeners that resume the context as soon as the first gesture arrives.
export function initSfx(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.sfxMuted = muted ? "1" : "0";
  const unlock = () => {
    const context = ensureContext();
    if (context?.state === "suspended") {
      void context.resume();
    }
  };
  document.addEventListener("pointerdown", unlock, { once: true, passive: true });
  document.addEventListener("keydown", unlock, { once: true });
}
