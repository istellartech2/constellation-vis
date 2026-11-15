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

  /**
   * Seek: continue from `simMs` as of real time `realMs`. The playback speed
   * is kept, so the next tick advances from the new time at the same rate.
   */
  reset(simMs: number, realMs: number): void {
    this.simulatedMs = simMs;
    this.previousRealMs = realMs;
  }
}
