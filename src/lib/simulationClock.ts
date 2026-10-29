/** Accumulates simulated time so changing playback speed never rewrites the past. */
export class SimulationClock {
  private simulatedMs: number;
  private previousRealMs: number;
  private previousSpeed: number;

  constructor(startMs: number, realMs: number, speed: number) {
    this.simulatedMs = startMs;
    this.previousRealMs = realMs;
    this.previousSpeed = speed;
  }

  tick(realMs: number, speed: number): Date {
    this.simulatedMs += Math.max(0, realMs - this.previousRealMs) * this.previousSpeed;
    this.previousRealMs = realMs;
    this.previousSpeed = speed;
    return new Date(this.simulatedMs);
  }
}
