import * as path from "path";

export type OutputFormat = "m4a" | "wav";

/** Injected I/O so the save step is testable without real files or afconvert. */
export interface SaveDeps {
	/** Size in bytes, or null when the file does not exist. */
	fileSize: (filePath: string) => Promise<number | null>;
	convert: (input: string, output: string) => Promise<void>;
	remove: (filePath: string) => Promise<void>;
}

export type SaveResult =
	| { ok: true; path: string; format: OutputFormat; warning?: string }
	| { ok: false; reason: string; leftovers: string[] };

/**
 * Temp files the helper leaves in its temp dir when it cannot finish: the mixed
 * output it failed to move, and the per-source tracks it did not mix.
 */
export function leftoverCandidates(tmpDir: string, pid: number): string[] {
	return [
		path.join(tmpDir, `system-recorder-${pid}.wav`),
		path.join(tmpDir, `sysrec-mic-${pid}.wav`),
		path.join(tmpDir, `sysrec-system-${pid}.wav`),
	];
}

/**
 * Confirms the helper's WAV really exists, then (for M4A) converts it and drops
 * the WAV. Never deletes anything unless a non-empty replacement exists, and
 * never touches temp files, so a failure always leaves something to recover.
 */
export async function saveRecording(
	wavPath: string,
	format: OutputFormat,
	tempCandidates: string[],
	deps: SaveDeps
): Promise<SaveResult> {
	if (!((await deps.fileSize(wavPath)) ?? 0)) {
		const leftovers: string[] = [];
		for (const candidate of tempCandidates) {
			if ((await deps.fileSize(candidate)) ?? 0) leftovers.push(candidate);
		}
		return { ok: false, reason: "The recording file was not saved.", leftovers };
	}

	if (format === "wav") {
		return { ok: true, path: wavPath, format: "wav" };
	}

	const m4aPath = wavPath.replace(/\.wav$/i, "") + ".m4a";
	let failure: string;
	try {
		await deps.convert(wavPath, m4aPath);
		if ((await deps.fileSize(m4aPath)) ?? 0) {
			try {
				await deps.remove(wavPath);
				return { ok: true, path: m4aPath, format: "m4a" };
			} catch (e) {
				return {
					ok: true,
					path: m4aPath,
					format: "m4a",
					warning: `Saved as .m4a, but the .wav file could not be removed: ${message(e)}`,
				};
			}
		}
		failure = "the converter produced an empty file";
	} catch (e) {
		failure = message(e);
	}

	try {
		await deps.remove(m4aPath);
	} catch {
		// nothing to clean up, or best-effort only
	}
	return {
		ok: true,
		path: wavPath,
		format: "wav",
		warning: `Could not convert to .m4a, so the .wav file was kept: ${failure}`,
	};
}

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
