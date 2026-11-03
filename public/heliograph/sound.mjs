// A little brass, a little glass. Build the short cues on demand so the
// first screen stays silent and no media download holds up play.
export function createSound() {
  let enabled = false;
  let context;
  let master;
  function setEnabled(next) {
    enabled = next;
    if (!next && context) {
      master.gain.setTargetAtTime(0, context.currentTime, 0.02);
    }
  }
  function unlock() {
    if (!enabled) return;
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        context = new Audio();
        master = context.createGain();
        master.gain.value = 0.38;
        master.connect(context.destination);
      }
      master.gain.setTargetAtTime(0.38, context.currentTime, 0.015);
      if (context.state === "suspended") void context.resume().catch(() => {});
    } catch { /* Browsers may decline audio in a restricted context. */ }
  }
  function tone(hz, delay, seconds, volume, type = "sine", glide = 1) {
    const start = context.currentTime + delay;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, start);
    osc.frequency.exponentialRampToValueAtTime(hz * glide, start + seconds);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    osc.connect(gain).connect(master);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(start);
    osc.stop(start + seconds + 0.02);
  }
  function play(cue) {
    if (!enabled || document.hidden) return;
    unlock();
    if (!context || !master) return;
    if (cue === "rotate" || cue === "undo") {
      tone(cue === "rotate" ? 660 : 494, 0, 0.18, 0.14, "triangle", 0.93);
      tone(1380, 0.016, 0.12, 0.045);
    } else if (cue === "hint") {
      tone(440, 0, 0.40, 0.14); tone(659, 0.10, 0.6, 0.10);
    } else if (cue === "volley") {
      tone(104, 0, 0.65, 0.26, "triangle", 0.62);
      tone(293, 0, 0.65, 0.15, "sine", 1.5); tone(880, 0.13, 0.78, 0.10);
    } else if (cue === "hit") {
      tone(147, 0, 0.42, 0.22, "triangle", 0.55);
    } else if (cue === "victory") {
      [349, 440, 523, 698].forEach((pitch, index) => tone(pitch, index * 0.09, 0.65, 0.13));
    } else if (cue === "defeat") {
      tone(196, 0, 0.85, 0.2); tone(147, 0.18, 0.9, 0.12);
    }
  }
  return { setEnabled, play };
}
