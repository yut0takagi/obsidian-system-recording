import { describe, it, expect, vi } from "vitest";
import { ActiveSession, ControllerDeps, RecordingController } from "./controller";

const SESSION: ActiveSession = {
	wavPath: "/vault/recordings/rec.wav",
	title: "Weekly sync",
	notePath: "Meetings/Weekly sync.md",
};

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

function makeDeps(over: Partial<ControllerDeps> = {}): ControllerDeps {
	return {
		launch: vi.fn(async () => ({ ...SESSION })),
		requestStop: vi.fn(),
		complete: vi.fn(async () => ({ path: "recordings/rec.m4a", notePath: SESSION.notePath })),
		...over,
	};
}

describe("RecordingController.start", () => {
	it("launches the helper with the options and reports recording", async () => {
		const deps = makeDeps();
		const c = new RecordingController(deps);
		const onStart = vi.fn();
		c.on("start", onStart);

		await expect(c.start({ title: "Weekly sync", notePath: "Meetings/Weekly sync.md" })).resolves.toBe(true);

		expect(deps.launch).toHaveBeenCalledWith({ title: "Weekly sync", notePath: "Meetings/Weekly sync.md" });
		expect(c.isRecording()).toBe(true);
		expect(onStart).toHaveBeenCalledWith({ title: "Weekly sync", notePath: "Meetings/Weekly sync.md" });
	});

	it("refuses a second start while recording", async () => {
		const deps = makeDeps();
		const c = new RecordingController(deps);
		await c.start();
		await expect(c.start()).resolves.toBe(false);
		expect(deps.launch).toHaveBeenCalledTimes(1);
	});

	it("refuses a second start while the first is still launching", async () => {
		const gate = deferred<ActiveSession | null>();
		const deps = makeDeps({ launch: vi.fn(() => gate.promise) });
		const c = new RecordingController(deps);
		const first = c.start();
		await expect(c.start()).resolves.toBe(false);
		gate.resolve({ ...SESSION });
		await expect(first).resolves.toBe(true);
		expect(deps.launch).toHaveBeenCalledTimes(1);
	});

	it("returns false and stays idle when the helper could not be launched", async () => {
		const onStart = vi.fn();
		const c = new RecordingController(makeDeps({ launch: vi.fn(async () => null) }));
		c.on("start", onStart);
		await expect(c.start()).resolves.toBe(false);
		expect(c.isRecording()).toBe(false);
		expect(onStart).not.toHaveBeenCalled();
	});

	it("returns false and stays idle when launching throws", async () => {
		const c = new RecordingController(
			makeDeps({
				launch: vi.fn(async () => {
					throw new Error("boom");
				}),
			})
		);
		await expect(c.start()).resolves.toBe(false);
		expect(c.isRecording()).toBe(false);
		await expect(c.start()).resolves.toBe(false); // can retry; this launch throws again
	});
});

describe("RecordingController.stop", () => {
	it("returns null without touching the helper when idle", async () => {
		const deps = makeDeps();
		const c = new RecordingController(deps);
		await expect(c.stop()).resolves.toBeNull();
		expect(deps.requestStop).not.toHaveBeenCalled();
	});

	it("resolves with the saved path once the helper has finished", async () => {
		const deps = makeDeps();
		const c = new RecordingController(deps);
		const onStop = vi.fn();
		c.on("stop", onStop);
		await c.start();

		const stopped = c.stop();
		expect(deps.requestStop).toHaveBeenCalledTimes(1);
		expect(c.isRecording()).toBe(true); // still saving

		await c.helperFinished({ kind: "stopped" });
		await expect(stopped).resolves.toEqual({ path: "recordings/rec.m4a" });
		expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining(SESSION), { kind: "stopped" });
		expect(onStop).toHaveBeenCalledWith({ path: "recordings/rec.m4a", notePath: SESSION.notePath });
		expect(c.isRecording()).toBe(false);
	});

	it("asks the helper to stop only once when stop is called twice", async () => {
		const deps = makeDeps();
		const c = new RecordingController(deps);
		await c.start();
		const a = c.stop();
		const b = c.stop();
		await c.helperFinished({ kind: "stopped" });
		await expect(a).resolves.toEqual({ path: "recordings/rec.m4a" });
		await expect(b).resolves.toEqual({ path: "recordings/rec.m4a" });
		expect(deps.requestStop).toHaveBeenCalledTimes(1);
	});

	it("refuses to start again while the previous recording is still being saved", async () => {
		const gate = deferred<{ path: string | null; notePath: string | null }>();
		const deps = makeDeps({ complete: vi.fn(() => gate.promise) });
		const c = new RecordingController(deps);
		await c.start();
		void c.stop();
		const finishing = c.helperFinished({ kind: "stopped" });
		await expect(c.start()).resolves.toBe(false);
		gate.resolve({ path: "recordings/rec.m4a", notePath: null });
		await finishing;
		await expect(c.start()).resolves.toBe(true);
	});

	it("resolves null and reports a failed save", async () => {
		const deps = makeDeps({ complete: vi.fn(async () => ({ path: null, notePath: null })) });
		const c = new RecordingController(deps);
		const onStop = vi.fn();
		c.on("stop", onStop);
		await c.start();
		const stopped = c.stop();
		await c.helperFinished({ kind: "stopped" });
		await expect(stopped).resolves.toBeNull();
		expect(onStop).toHaveBeenCalledWith({ path: null, notePath: null });
	});

	it("resolves null when saving throws", async () => {
		const deps = makeDeps({
			complete: vi.fn(async () => {
				throw new Error("disk full");
			}),
		});
		const c = new RecordingController(deps);
		await c.start();
		const stopped = c.stop();
		await c.helperFinished({ kind: "stopped" });
		await expect(stopped).resolves.toBeNull();
		expect(c.isRecording()).toBe(false);
	});
});

describe("RecordingController.helperFinished", () => {
	it("saves what it can when the helper exits on its own", async () => {
		const deps = makeDeps();
		const c = new RecordingController(deps);
		const onStop = vi.fn();
		c.on("stop", onStop);
		await c.start();
		await c.helperFinished({ kind: "failed", message: "exit code 1" });
		expect(deps.complete).toHaveBeenCalledWith(expect.anything(), { kind: "failed", message: "exit code 1" });
		expect(onStop).toHaveBeenCalledTimes(1);
		expect(c.isRecording()).toBe(false);
	});

	it("ignores a second report for the same recording (status line + process exit)", async () => {
		const deps = makeDeps();
		const c = new RecordingController(deps);
		await c.start();
		void c.stop();
		await Promise.all([c.helperFinished({ kind: "stopped" }), c.helperFinished({ kind: "failed", message: "x" })]);
		expect(deps.complete).toHaveBeenCalledTimes(1);
	});
});

describe("RecordingController.on", () => {
	it("returns an unsubscribe function", async () => {
		const c = new RecordingController(makeDeps());
		const onStart = vi.fn();
		const off = c.on("start", onStart);
		off();
		await c.start();
		expect(onStart).not.toHaveBeenCalled();
	});

	it("keeps going when a listener throws", async () => {
		const c = new RecordingController(makeDeps());
		const after = vi.fn();
		c.on("start", () => {
			throw new Error("listener bug");
		});
		c.on("start", after);
		await expect(c.start()).resolves.toBe(true);
		expect(after).toHaveBeenCalled();
	});
});

describe("RecordingController.onBusy", () => {
	it("is told when a start is refused because a recording is in progress", async () => {
		const onBusy = vi.fn();
		const c = new RecordingController(makeDeps({ onBusy }));
		await c.start();
		await c.start();
		expect(onBusy).toHaveBeenCalledTimes(1);
	});

	it("is not told while the first start is still launching (double click)", async () => {
		const gate = deferred<ActiveSession | null>();
		const onBusy = vi.fn();
		const c = new RecordingController(makeDeps({ launch: vi.fn(() => gate.promise), onBusy }));
		const first = c.start();
		await c.start();
		gate.resolve({ ...SESSION });
		await first;
		expect(onBusy).not.toHaveBeenCalled();
	});
});
