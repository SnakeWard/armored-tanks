export class AudioBus {
  private ctx: AudioContext | null = null;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  fire() {
    this.tone(140, 0.12, "sawtooth", 0.05, -80);
  }

  hit(bounce: boolean) {
    this.tone(bounce ? 420 : 90, bounce ? 0.06 : 0.14, "square", 0.04, bounce ? 80 : -40);
  }

  boom() {
    this.tone(70, 0.28, "triangle", 0.06, -30);
  }
}
