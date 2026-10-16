import { describe, it, expect, vi } from "vitest";
import { ErrorThrottle } from "./errorThrottle";

const HOUR = 60 * 60 * 1000;

describe("ErrorThrottle", () => {
	it("shows the first error right away", () => {
		const notify = vi.fn();
		const t = new ErrorThrottle({ now: () => 0, notify, intervalMs: HOUR });
		t.report("HTTP 500");
		expect(notify).toHaveBeenCalledWith("HTTP 500");
	});

	it("stays quiet while the same outage continues within the interval", () => {
		const now = { v: 0 };
		const notify = vi.fn();
		const t = new ErrorThrottle({ now: () => now.v, notify, intervalMs: HOUR });
		t.report("HTTP 500");
		now.v = 5 * 60 * 1000;
		t.report("HTTP 500");
		now.v = 30 * 60 * 1000;
		t.report("HTTP 503");
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("reminds again once the interval has passed", () => {
		const now = { v: 0 };
		const notify = vi.fn();
		const t = new ErrorThrottle({ now: () => now.v, notify, intervalMs: HOUR });
		t.report("HTTP 500");
		now.v = HOUR;
		t.report("HTTP 500");
		expect(notify).toHaveBeenCalledTimes(2);
	});

	it("shows a new failure right away after a success", () => {
		const now = { v: 0 };
		const notify = vi.fn();
		const t = new ErrorThrottle({ now: () => now.v, notify, intervalMs: HOUR });
		t.report("HTTP 500");
		now.v = 60_000;
		t.success();
		now.v = 120_000;
		t.report("HTTP 401");
		expect(notify).toHaveBeenLastCalledWith("HTTP 401");
		expect(notify).toHaveBeenCalledTimes(2);
	});
});
