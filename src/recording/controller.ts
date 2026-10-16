export interface StartOptions {
	/** Used for `{{title}}` in the file name template. */
	title?: string;
	/** Vault path of the note that receives the recording link. */
	notePath?: string;
}

export interface RecordingStartEvent {
	title: string | null;
	notePath: string | null;
}

export interface RecordingStopEvent {
	/** Vault path of the saved recording, or null when saving failed. */
	path: string | null;
	notePath: string | null;
}

/** What the plugin knows about the recording in progress. */
export interface ActiveSession {
	/** Absolute path the helper writes the WAV to. */
	wavPath: string;
	title: string | null;
	/** Note picked at start (explicit, or the active note) for the link. */
	notePath: string | null;
}

export type HelperOutcome = { kind: "stopped" } | { kind: "failed"; message: string };

export interface ControllerDeps<S extends ActiveSession = ActiveSession> {
	/** Prepares and launches the helper. Returns null when it could not start (the user was already told why). */
	launch: (options: StartOptions) => Promise<S | null>;
	/** Asks the running helper to finish (it then writes the WAV and exits). */
	requestStop: () => void;
	/** Verifies, converts and links the finished recording. */
	complete: (
		session: S,
		outcome: HelperOutcome
	) => Promise<{ path: string | null; notePath: string | null }>;
	/** Called when a start is refused because a recording is in progress (not while one is still starting). */
	onBusy?: () => void;
	/** Receives unexpected errors (launch/save/listener failures). */
	onError?: (error: unknown) => void;
}

type State = "idle" | "starting" | "recording" | "stopping";

interface Listeners {
	start: Set<(event: RecordingStartEvent) => void>;
	stop: Set<(event: RecordingStopEvent) => void>;
}

/**
 * Owns the recording lifecycle so every entry point (ribbon, commands, calendar,
 * other plugins) gets the same rules: one recording at a time, one stop request
 * to the helper, and a stop result only after the file is really saved.
 */
export class RecordingController<S extends ActiveSession = ActiveSession> {
	private state: State = "idle";
	private session: S | null = null;
	private stopWaiters: Array<(result: { path: string } | null) => void> = [];
	private listeners: Listeners = { start: new Set(), stop: new Set() };

	constructor(private readonly deps: ControllerDeps<S>) {}

	/** True while recording and until the stopped recording has been saved. */
	isRecording(): boolean {
		return this.state === "recording" || this.state === "stopping";
	}

	/** True while a start is in progress (e.g. the helper is being downloaded). */
	get isStarting(): boolean {
		return this.state === "starting";
	}

	async start(options: StartOptions = {}): Promise<boolean> {
		if (this.state !== "idle") {
			if (this.isRecording()) this.deps.onBusy?.();
			return false;
		}
		this.state = "starting";
		let session: S | null = null;
		try {
			session = await this.deps.launch(options);
		} catch (e) {
			this.deps.onError?.(e);
		}
		if (!session) {
			this.state = "idle";
			return false;
		}
		this.session = session;
		this.state = "recording";
		this.emit("start", { title: session.title, notePath: session.notePath });
		return true;
	}

	/** Resolves with the saved recording once it is on disk, or null if nothing was recording or saving failed. */
	stop(): Promise<{ path: string } | null> {
		if (this.state === "recording") {
			this.state = "stopping";
			this.deps.requestStop();
		}
		if (this.state !== "stopping") return Promise.resolve(null);
		return new Promise((resolve) => this.stopWaiters.push(resolve));
	}

	/** Called when the helper reports it stopped, reports an error, or exits. Later reports are ignored. */
	async helperFinished(outcome: HelperOutcome): Promise<void> {
		const session = this.session;
		if (!session) return;
		this.session = null;
		this.state = "stopping";

		let saved: { path: string | null; notePath: string | null } = {
			path: null,
			notePath: session.notePath,
		};
		try {
			saved = await this.deps.complete(session, outcome);
		} catch (e) {
			this.deps.onError?.(e);
		}

		this.state = "idle";
		const result = saved.path ? { path: saved.path } : null;
		const waiters = this.stopWaiters;
		this.stopWaiters = [];
		for (const resolve of waiters) resolve(result);
		this.emit("stop", { path: saved.path, notePath: saved.notePath });
	}

	on(event: "start", listener: (event: RecordingStartEvent) => void): () => void;
	on(event: "stop", listener: (event: RecordingStopEvent) => void): () => void;
	on(
		event: "start" | "stop",
		listener: ((event: RecordingStartEvent) => void) | ((event: RecordingStopEvent) => void)
	): () => void {
		const set = this.listeners[event] as Set<typeof listener>;
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	}

	private emit(event: "start", payload: RecordingStartEvent): void;
	private emit(event: "stop", payload: RecordingStopEvent): void;
	private emit(event: "start" | "stop", payload: RecordingStartEvent | RecordingStopEvent): void {
		for (const listener of [...this.listeners[event]] as Array<(p: typeof payload) => void>) {
			try {
				listener(payload);
			} catch (e) {
				this.deps.onError?.(e);
			}
		}
	}
}
