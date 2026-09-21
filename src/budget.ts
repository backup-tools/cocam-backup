/** Tracks subrequest and time allowance for one invocation. */
/** Whether an error is the runtime refusing further subrequests. */
export function isSubrequestLimit(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes("too many subrequests") || m.includes("subrequest limit");
}

export class BudgetExhausted extends Error {
  constructor(public readonly axis: "subrequests" | "time") {
    super(`budget exhausted: ${axis}`);
    this.name = "BudgetExhausted";
  }
}

export class Budget {
  private spent = 0;
  private readonly deadline: number;

  constructor(
    private readonly maxSubrequests: number,
    maxMillis: number,
  ) {
    this.deadline = Date.now() + maxMillis;
  }

  /** Charges one subrequest. */
  spend(n = 1): void {
    if (this.spent + n > this.maxSubrequests) throw new BudgetExhausted("subrequests");
    if (Date.now() > this.deadline) throw new BudgetExhausted("time");
    this.spent += n;
  }

  /** Whether another unit of work fits. */
  hasRoom(reserve: number): boolean {
    return this.spent + reserve <= this.maxSubrequests && Date.now() < this.deadline;
  }

  /** Subrequests left. */
  get remaining(): number {
    return Math.max(0, this.maxSubrequests - this.spent);
  }

  get timeLeft(): boolean {
    return Date.now() < this.deadline;
  }

  /** Total subrequest allowance. */
  get capacity(): number {
    return this.maxSubrequests;
  }

  get used(): number {
    return this.spent;
  }
}
