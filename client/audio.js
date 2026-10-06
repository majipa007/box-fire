// Web Audio synthesis: every sound is generated, so there are no asset
// files. Browsers keep audio muted until a user gesture, so start() runs
// inside the click-to-play click.
let ctx = null;
let master = null;
let noise = null; // half a second of white noise, reused by every burst

export function start() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// A filtered noise burst with a fast decay; louder and brighter up close.
function burst({ freq, len, gain }, distance, pan) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq / (1 + distance / 25); // far shots sound muffled
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain / (1 + distance / 8), t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  src.connect(filter).connect(env).connect(panner).connect(master);
  src.start(t);
  src.stop(t + len);
}

function tone(from, to, len, gain) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + len);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + len);
}

const SHOTS = {
  rifle: { freq: 2200, len: 0.13, gain: 0.55 },
  pistol: { freq: 3200, len: 0.08, gain: 0.45 },
  shotgun: { freq: 900, len: 0.3, gain: 0.9 },
};

// distance in metres; pan from -1 (left) to 1 (right).
export const gunshot = (weapon, distance = 0, pan = 0) => burst(SHOTS[weapon] ?? SHOTS.rifle, distance, pan);
export const footstep = (distance = 0, pan = 0) => burst({ freq: 320, len: 0.07, gain: 0.35 }, distance, pan);
export const hitTick = (head) => tone(head ? 1900 : 1300, head ? 1700 : 1150, 0.05, 0.25);
export const deathThud = () => tone(150, 40, 0.4, 0.6);
