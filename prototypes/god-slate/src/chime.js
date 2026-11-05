let audio = null;

/**
 * Plays a soft generated chime: rising for God mode on, falling for off.
 * Web Audio only, no audio files. Must be called from a user gesture.
 */
export function playChime(rising) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const notes = rising ? [659.25, 987.77] : [987.77, 659.25];
    const start = audio.currentTime + 0.02;
    notes.forEach((frequency, index) => {
      const at = start + index * 0.16;
      [1, 2.01].forEach((partial, p) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = frequency * partial;
        const peak = p === 0 ? 0.08 : 0.02;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(peak, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + 1.2);
      });
    });
  } catch (error) {
    console.warn("Chime unavailable:", error);
  }
}
