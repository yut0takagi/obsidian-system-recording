import { describe, it, expect, vi } from "vitest";
import { leftoverCandidates, saveRecording, SaveDeps } from "./saveRecording";

const WAV = "/vault/recordings/rec.wav";
const M4A = "/vault/recordings/rec.m4a";

function fakeDeps(files: Record<string, number>, over: Partial<SaveDeps> = {}): SaveDeps & {
	files: Record<string, number>;
} {
	return {
		files,
		fileSize: async (p) => (p in files ? (files[p] ?? 0) : null),
		convert: vi.fn(async (_input: string, output: string) => {
			files[output] = 1000;
		}),
		remove: vi.fn(async (p: string) => {
			delete files[p];
		}),
		...over,
	};
}

describe("saveRecording", () => {
	it("keeps the WAV as-is when WAV is selected", async () => {
		const deps = fakeDeps({ [WAV]: 5000 });
		const result = await saveRecording(WAV, "wav", [], deps);
		expect(result).toEqual({ ok: true, path: WAV, format: "wav" });
		expect(deps.convert).not.toHaveBeenCalled();
	});

	it("converts to M4A next to the WAV and removes the WAV", async () => {
		const deps = fakeDeps({ [WAV]: 5000 });
		const result = await saveRecording(WAV, "m4a", [], deps);
		expect(deps.convert).toHaveBeenCalledWith(WAV, M4A);
		expect(result).toEqual({ ok: true, path: M4A, format: "m4a" });
		expect(deps.files).toEqual({ [M4A]: 1000 });
	});

	it("keeps the WAV and warns when the conversion fails", async () => {
		const deps = fakeDeps(
			{ [WAV]: 5000 },
			{
				convert: vi.fn(async () => {
					throw new Error("afconvert exited with code 1");
				}),
			}
		);
		const result = await saveRecording(WAV, "m4a", [], deps);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.path).toBe(WAV);
		expect(result.format).toBe("wav");
		expect(result.warning).toContain("afconvert exited with code 1");
		expect(deps.files[WAV]).toBe(5000);
	});

	it("keeps the WAV when the converter reports success but writes an empty file", async () => {
		const deps = fakeDeps(
			{ [WAV]: 5000 },
			{
				convert: vi.fn(async (_i: string, o: string) => {
					deps.files[o] = 0;
				}),
			}
		);
		const result = await saveRecording(WAV, "m4a", [], deps);
		expect(result.ok && result.path).toBe(WAV);
		expect(deps.files).toEqual({ [WAV]: 5000 });
	});

	it("still reports the M4A when the WAV cannot be removed", async () => {
		const deps = fakeDeps(
			{ [WAV]: 5000 },
			{
				remove: vi.fn(async () => {
					throw new Error("EPERM");
				}),
			}
		);
		const result = await saveRecording(WAV, "m4a", [], deps);
		expect(result.ok && result.path).toBe(M4A);
		expect(result.ok && result.warning).toContain("EPERM");
	});

	it("fails with the leftover temp files when the final file is missing", async () => {
		const temps = ["/tmp/a.wav", "/tmp/b.wav", "/tmp/c.wav"];
		const deps = fakeDeps({ "/tmp/a.wav": 10, "/tmp/c.wav": 0 });
		const result = await saveRecording(WAV, "m4a", temps, deps);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.leftovers).toEqual(["/tmp/a.wav"]);
		expect(deps.convert).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
	});

	it("treats an empty final file as missing", async () => {
		const deps = fakeDeps({ [WAV]: 0 });
		const result = await saveRecording(WAV, "wav", [], deps);
		expect(result.ok).toBe(false);
	});
});

describe("leftoverCandidates", () => {
	it("lists the helper's temp files for the given process id", () => {
		expect(leftoverCandidates("/tmp/x", 42)).toEqual([
			"/tmp/x/system-recorder-42.wav",
			"/tmp/x/sysrec-mic-42.wav",
			"/tmp/x/sysrec-system-42.wav",
		]);
	});
});
