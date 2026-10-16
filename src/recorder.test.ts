import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { Recorder, SpawnLike } from "./recorder";

class FakeChild extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	pid = 4242;
}

function setup() {
	const child = new FakeChild();
	const spawn = vi.fn<SpawnLike>(() => child as unknown as ChildProcess);
	const recorder = new Recorder(spawn);
	const onStatus = vi.fn();
	const onExit = vi.fn();
	recorder.onStatus = onStatus;
	recorder.onExit = onExit;
	recorder.start("/plugin/system-recorder", "/vault/recordings/a b.wav");
	return { child, spawn, recorder, onStatus, onExit };
}

describe("Recorder", () => {
	it("passes the output path as its own argument", () => {
		const { spawn } = setup();
		expect(spawn).toHaveBeenCalledWith(
			"/plugin/system-recorder",
			["start", "--output", "/vault/recordings/a b.wav", "--stop-file", expect.stringContaining("system-recorder-stop-")],
			expect.anything()
		);
	});

	it("exposes the helper's process id (used to find its temp files)", () => {
		expect(setup().recorder.pid).toBe(4242);
	});

	it("parses status lines split across chunks", () => {
		const { child, onStatus, recorder } = setup();
		child.stdout.emit("data", '{"status":"stopped","file":"/vault/rec');
		child.stdout.emit("data", 'ordings/a b.wav"}\n');
		expect(onStatus).toHaveBeenCalledWith({ status: "stopped", file: "/vault/recordings/a b.wav" });
		expect(recorder.isRecording).toBe(false);
	});

	it("reports the exit code when the helper exits", () => {
		const { child, onExit, recorder } = setup();
		child.emit("close", 1);
		expect(onExit).toHaveBeenCalledWith(1);
		expect(recorder.isRecording).toBe(false);
		expect(recorder.pid).toBeNull();
	});

	it("reports a spawn failure as an exit", () => {
		const { child, onExit } = setup();
		child.emit("error", new Error("EACCES"));
		expect(onExit).toHaveBeenCalledWith(null, "EACCES");
	});
});
