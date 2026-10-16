import type {
	RecordingController,
	RecordingStartEvent,
	RecordingStopEvent,
	StartOptions,
} from "./recording/controller";

export type { RecordingStartEvent, RecordingStopEvent, StartOptions };

/** Bumped only on breaking changes; check it before calling. */
export const API_VERSION = 1;

/**
 * Public API for other plugins, available as
 * `app.plugins.plugins["system-recording"].api` while the plugin is enabled.
 * Keep README.md's copy of these types in sync.
 */
export interface SystemRecordingApi {
	readonly apiVersion: 1;
	/**
	 * Starts recording. Resolves true once the helper is recording, false when it
	 * could not start (already recording, unsupported platform, helper download failed…).
	 * The recording link goes into `notePath` when given, otherwise into the note
	 * that is active now (at start, not at stop).
	 */
	startRecording(options?: StartOptions): Promise<boolean>;
	/**
	 * Stops recording and resolves after the file is saved (and converted), with
	 * its vault path. Resolves null when nothing was recording or saving failed.
	 */
	stopRecording(): Promise<{ path: string } | null>;
	/** True while recording, and until a stopped recording has been saved. */
	isRecording(): boolean;
	/** Subscribes to recording start/stop. Returns a function that unsubscribes. */
	on(event: "start", listener: (event: RecordingStartEvent) => void): () => void;
	on(event: "stop", listener: (event: RecordingStopEvent) => void): () => void;
}

export function createApi(controller: RecordingController): SystemRecordingApi {
	const on = (
		event: "start" | "stop",
		listener: ((e: RecordingStartEvent) => void) | ((e: RecordingStopEvent) => void)
	): (() => void) => {
		if (event === "start") {
			return controller.on("start", listener as (e: RecordingStartEvent) => void);
		}
		if (event === "stop") {
			return controller.on("stop", listener as (e: RecordingStopEvent) => void);
		}
		throw new Error(`Unknown System Recording event: ${String(event)}`);
	};

	return Object.freeze({
		apiVersion: API_VERSION,
		startRecording: (options?: StartOptions) => controller.start(cleanOptions(options)),
		stopRecording: () => controller.stop(),
		isRecording: () => controller.isRecording(),
		on: on as SystemRecordingApi["on"],
	});
}

/** Callers are other plugins, so only plain strings are passed on. */
function cleanOptions(options: unknown): StartOptions {
	const out: StartOptions = {};
	if (typeof options !== "object" || options === null) return out;
	const { title, notePath } = options as Record<string, unknown>;
	if (typeof title === "string") out.title = title;
	if (typeof notePath === "string") out.notePath = notePath;
	return out;
}
