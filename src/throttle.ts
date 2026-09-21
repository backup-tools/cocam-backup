/** Spaces outbound requests to a fixed maximum rate. */
export class Throttle {
  private nextSlot = 0;

  constructor(private readonly minGapMs: number) {}

  async wait(): Promise<void> {
    if (this.minGapMs <= 0) return;
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.minGapMs;
    const delay = at - now;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
}
