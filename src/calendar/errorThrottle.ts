export interface ErrorThrottleDeps {
	now: () => number;
	notify: (message: string) => void;
	/** Minimum time between two notices while failures continue. */
	intervalMs: number;
}

/** Default spacing for repeated calendar errors (the calendar is polled every 5 minutes). */
export const CALENDAR_ERROR_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Shows the first failure at once, then at most one notice per interval while
 * failures continue. A success resets it, so a new outage is reported at once.
 */
export class ErrorThrottle {
	private lastShownAt: number | null = null;

	constructor(private readonly deps: ErrorThrottleDeps) {}

	report(message: string): void {
		const now = this.deps.now();
		if (this.lastShownAt !== null && now - this.lastShownAt < this.deps.intervalMs) return;
		this.lastShownAt = now;
		this.deps.notify(message);
	}

	success(): void {
		this.lastShownAt = null;
	}
}
