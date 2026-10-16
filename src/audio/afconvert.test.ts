import { describe, it, expect, vi, afterAll } from "vitest";
import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AFCONVERT_PATH, afconvertArgs, createAfconvert, ExecFileLike } from "./afconvert";

describe("afconvertArgs", () => {
	it("asks for AAC in an MPEG-4 container", () => {
		expect(afconvertArgs("/in/a.wav", "/out/a.m4a")).toEqual([
			"-f",
			"m4af",
			"-d",
			"aac",
			"-b",
			"96000",
			"/in/a.wav",
			"/out/a.m4a",
		]);
	});
});

describe("createAfconvert", () => {
	it("runs /usr/bin/afconvert with the paths as separate arguments", async () => {
		const exec = vi.fn<ExecFileLike>((_file, _args, cb) => cb(null, "", ""));
		await createAfconvert(exec)("/in/a b.wav", "/out/a b.m4a");
		expect(exec).toHaveBeenCalledWith(
			AFCONVERT_PATH,
			afconvertArgs("/in/a b.wav", "/out/a b.m4a"),
			expect.any(Function)
		);
	});

	it("rejects with stderr when afconvert fails", async () => {
		const exec: ExecFileLike = (_file, _args, cb) =>
			cb(Object.assign(new Error("Command failed"), { code: 1 }), "", "Error: bad input");
		await expect(createAfconvert(exec)("/in/a.wav", "/out/a.m4a")).rejects.toThrow(
			"bad input"
		);
	});

	it("refuses relative paths so a path can never be read as an option", async () => {
		const exec = vi.fn<ExecFileLike>();
		await expect(createAfconvert(exec)("-h", "/out/a.m4a")).rejects.toThrow();
		expect(exec).not.toHaveBeenCalled();
	});
});

/** Writes a short 16-bit stereo sine-wave WAV (synthetic, a few KB). */
function writeSyntheticWav(file: string, seconds = 0.2, rate = 44100): void {
	const frames = Math.floor(seconds * rate);
	const data = Buffer.alloc(frames * 4);
	for (let i = 0; i < frames; i++) {
		const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000);
		data.writeInt16LE(v, i * 4);
		data.writeInt16LE(v, i * 4 + 2);
	}
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(2, 22); // channels
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 4, 28);
	header.writeUInt16LE(4, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	fs.writeFileSync(file, Buffer.concat([header, data]));
}

const hasAfconvert = process.platform === "darwin" && fs.existsSync(AFCONVERT_PATH);

describe.skipIf(!hasAfconvert)("createAfconvert with the real afconvert (macOS)", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-recording-test-"));
	afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

	it("turns a synthetic WAV into a smaller M4A", async () => {
		const wav = path.join(dir, "tone with space.wav");
		const m4a = path.join(dir, "tone with space.m4a");
		writeSyntheticWav(wav);
		await createAfconvert(execFile)(wav, m4a);
		const bytes = fs.readFileSync(m4a);
		expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
		expect(bytes.length).toBeLessThan(fs.statSync(wav).size);
	});
});
