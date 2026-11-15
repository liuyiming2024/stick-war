// v2.11：Web Audio 程序合成，零外部文件、零网络请求。
// 只消费 step() 的 events 与 UI 动作，绝不进纯逻辑层，也不参与画面相位。
// 浏览器要求用户手势后才能 resume，所以 createAudio() 不预先创建 AudioContext。

const TONES = {
  shoot_arrow:   { f: 880, to: 620, dur: 0.07, type: 'triangle', g: 0.55 },
  shoot_javelin: { f: 700, to: 380, dur: 0.11, type: 'sawtooth', g: 0.6 },
  shoot_rock:    { f: 260, to: 150, dur: 0.13, type: 'triangle', g: 0.7 },
  shoot_magic:   { f: 540, to: 980, dur: 0.16, type: 'sine', g: 0.6 },
  hit:           { f: 190, to: 110, dur: 0.075, type: 'square', g: 0.45, noise: 0.35 },
  statueHit:     { f: 130, to: 70,  dur: 0.20, type: 'sawtooth', g: 0.75, noise: 0.5 },
  splash:        { f: 420, to: 220, dur: 0.14, type: 'sine', g: 0.5 },
  spearThrow:    { f: 760, to: 430, dur: 0.10, type: 'triangle', g: 0.6 },
  summon:        { f: 330, to: 880, dur: 0.26, type: 'sine', g: 0.65 },
  summonExpire:  { f: 500, to: 180, dur: 0.14, type: 'sine', g: 0.35 },
  status:        { f: 620, to: 300, dur: 0.12, type: 'triangle', g: 0.5 },
  training:      { f: 440, to: 660, dur: 0.10, type: 'sine', g: 0.45 },
  trained:       { f: 700, to: 900, dur: 0.07, type: 'sine', g: 0.4 },
  gold:          { f: 1040, to: 1320, dur: 0.09, type: 'sine', g: 0.5 },
  gem:           { f: 660, to: 1320, dur: 0.22, type: 'triangle', g: 0.6 },
  select:        { f: 900, to: 900, dur: 0.045, type: 'sine', g: 0.35 },
  cancel:        { f: 420, to: 260, dur: 0.08, type: 'triangle', g: 0.4 },
  click:         { f: 760, to: 760, dur: 0.035, type: 'sine', g: 0.28 },
  win:           { f: 523, to: 1046, dur: 0.42, type: 'triangle', g: 0.8 },
  lose:          { f: 330, to: 110, dur: 0.48, type: 'sawtooth', g: 0.7 },
};

export function createAudio(config, { isMuted = () => false } = {}) {
  const cfg = config;
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let voices = 0;
  const lastAt = new Map();

  function ensure() {
    if (ctx) return true;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = cfg.masterGain;
      master.connect(ctx.destination);
      // 一段固定白噪声，复用给打击音，避免每次分配 buffer。
      const len = Math.floor(ctx.sampleRate * 0.25);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      // 确定性伪随机（线性同余），不引入运行时随机源。
      let seed = 0x2f6e2b1;
      for (let i = 0; i < len; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = ((seed / 0xffffffff) * 2 - 1) * (1 - i / len);
      }
      return true;
    } catch { ctx = null; return false; }
  }

  /** 必须在用户手势里调用；重复调用安全。 */
  function resume() {
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }

  function voice(spec, delay = 0) {
    if (!ctx || voices >= cfg.maxVoices) return;
    voices++;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.f, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), t0 + spec.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, spec.g), t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
    osc.connect(gain); gain.connect(master);
    osc.start(t0); osc.stop(t0 + spec.dur + 0.01);
    osc.onended = () => { voices = Math.max(0, voices - 1); gain.disconnect(); };

    if (spec.noise) {
      const src = ctx.createBufferSource();
      const ng = ctx.createGain();
      src.buffer = noiseBuf;
      ng.gain.setValueAtTime(spec.noise * spec.g, t0);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
      src.connect(ng); ng.connect(master);
      src.start(t0); src.stop(t0 + spec.dur);
      src.onended = () => ng.disconnect();
    }
  }

  /** 同名事件在 cooldownMs 内只播一次，避免 20 个单位同时命中炸掉。 */
  function play(name) {
    if (!ctx || isMuted() || !TONES[name]) return;
    const now = ctx.currentTime;
    const cd = cfg.cooldownMs / 1000;
    if (now - (lastAt.get(name) ?? -Infinity) < cd) return;
    lastAt.set(name, now);
    voice(TONES[name]);
  }

  function arpeggio(name, steps = 3) {
    if (!ctx || isMuted()) return;
    for (let i = 0; i < steps; i++) {
      const spec = TONES[name];
      voice({ ...spec, f: spec.f * (1 + i * 0.25), to: spec.to * (1 + i * 0.25) }, i * 0.055);
    }
  }

  /** 把一批 step() 事件翻译成声音；只在这里做映射，逻辑层保持纯函数。 */
  function consume(events) {
    if (!ctx || isMuted()) return;
    for (const e of events) {
      switch (e.type) {
        case 'shoot': play(`shoot_${e.kind}`); break;
        case 'hit': play('hit'); break;
        case 'statueHit': play('statueHit'); break;
        case 'splash': play('splash'); break;
        case 'spearThrow': play('spearThrow'); break;
        case 'summon': play('summon'); break;
        case 'summonExpire': play('summonExpire'); break;
        case 'status': play('status'); break;
        case 'training': play('training'); break;
        case 'trained': play('trained'); break;
        case 'gold': if (e.team === 0) play('gold'); break;
        case 'end': arpeggio(e.result === 'won' ? 'win' : 'lose', 3); break;
        default: break;   // dot / death / championLost 等高频事件静音
      }
    }
  }

  return {
    resume, play, consume,
    gem: () => arpeggio('gem', 3),
    isReady: () => !!ctx,
    state: () => ctx?.state ?? 'none',
  };
}
