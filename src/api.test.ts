import { describe, it, expect, vi } from "vitest";
import { createApi, API_VERSION } from "./api";
import type { RecordingController } from "./recording/controller";

function fakeController() {
	return {
		start: vi.fn(async () => true),
		stop: vi.fn(async () => ({ path: "recordings/a.m4a" })),
		isRecording: vi.fn(() => false),
		on: vi.fn(() => () => {}),
	};
}

function api(c = fakeController()) {
	return { c, api: createApi(c as unknown as RecordingController) };
}

describe("createApi", () => {
	it("advertises the API version for feature detection", () => {
		expect(api().api.apiVersion).toBe(API_VERSION);
		expect(API_VERSION).toBe(1);
	});

	it("passes title and notePath through to the controller", async () => {
		const { c, api: a } = api();
		await expect(a.startRecording({ title: "Sync", notePath: "Meetings/Sync.md" })).resolves.toBe(true);
		expect(c.start).toHaveBeenCalledWith({ title: "Sync", notePath: "Meetings/Sync.md" });
	});

	it("drops option values that are not strings", async () => {
		const { c, api: a } = api();
		await a.startRecording({ title: 42, notePath: { evil: true } } as unknown as { title: string });
		expect(c.start).toHaveBeenCalledWith({});
	});

	it("works without options", async () => {
		const { c, api: a } = api();
		await a.startRecording();
		expect(c.start).toHaveBeenCalledWith({});
	});

	it("delegates stopRecording and isRecording", async () => {
		const { c, api: a } = api();
		await expect(a.stopRecording()).resolves.toEqual({ path: "recordings/a.m4a" });
		expect(a.isRecording()).toBe(false);
		expect(c.isRecording).toHaveBeenCalled();
	});

	it("subscribes to start and stop and returns the unsubscribe function", () => {
		const { c, api: a } = api();
		const off = vi.fn();
		c.on.mockReturnValue(off);
		const listener = vi.fn();
		expect(a.on("stop", listener)).toBe(off);
		expect(c.on).toHaveBeenCalledWith("stop", listener);
	});

	it("rejects unknown event names", () => {
		expect(() => api().api.on("pause" as "start", vi.fn())).toThrow();
	});

	it("is frozen so other plugins cannot replace its methods", () => {
		expect(Object.isFrozen(api().api)).toBe(true);
	});
});
