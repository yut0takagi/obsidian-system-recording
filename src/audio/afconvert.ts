import * as path from "path";

/** macOS ships this converter, so M4A needs no extra download or helper rebuild. */
export const AFCONVERT_PATH = "/usr/bin/afconvert";

/** 96 kbps AAC keeps speech clear at roughly 43 MB per hour (vs ~635 MB for the WAV). */
const AAC_BITRATE = "96000";

export type ExecFileLike = (
	file: string,
	args: string[],
	callback: (error: Error | null, stdout: string, stderr: string) => void
) => void;

export function afconvertArgs(input: string, output: string): string[] {
	return ["-f", "m4af", "-d", "aac", "-b", AAC_BITRATE, input, output];
}

/** Returns a converter that encodes `input` (WAV) to `output` (M4A/AAC). */
export function createAfconvert(execFile: ExecFileLike) {
	return (input: string, output: string): Promise<void> =>
		new Promise((resolve, reject) => {
			// Absolute paths start with "/", so afconvert can never read them as options.
			if (!path.isAbsolute(input) || !path.isAbsolute(output)) {
				reject(new Error("afconvert needs absolute paths"));
				return;
			}
			execFile(AFCONVERT_PATH, afconvertArgs(input, output), (error, _stdout, stderr) => {
				if (error) {
					const detail = String(stderr ?? "").trim();
					reject(new Error(detail ? `${error.message}: ${detail}` : error.message));
					return;
				}
				resolve();
			});
		});
}
