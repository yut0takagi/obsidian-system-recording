import {
    FileSystemAdapter,
    MarkdownView,
    moment,
    normalizePath,
    Notice,
    Platform,
    Plugin,
    TFile,
} from "obsidian";
import { execFile } from "child_process";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
    DEFAULT_SETTINGS,
    SystemRecordingSettings,
    SystemRecordingSettingTab,
} from "./settings";
import { Recorder, RecorderStatus } from "./recorder";
import { BinaryProvisioner, HELPER_RELEASE_TAG } from "./binary";
import { nodeDeps, resolveBinaryPath } from "./binary-runtime";
import { GoogleOAuth } from "./auth/googleOAuth";
import { CredentialStore, findSecretStorage } from "./auth/credentialStore";
import { GCalCalendar, listCalendars, listEvents } from "./calendar/googleCalendar";
import { shouldRecord, parseKeywords } from "./calendar/eventFilter";
import { CalendarScheduler, ScheduledEvent } from "./calendar/scheduler";
import { CALENDAR_ERROR_INTERVAL_MS, ErrorThrottle } from "./calendar/errorThrottle";
import { actionNotice } from "./ui/actionNotice";
import { createApi, SystemRecordingApi } from "./api";
import {
    ActiveSession,
    HelperOutcome,
    RecordingController,
    StartOptions,
} from "./recording/controller";
import { appendEmbed, embedLink, pickTargetNote } from "./recording/link";
import { formatFileName, uniqueBaseName } from "./fileName";
import { createAfconvert } from "./audio/afconvert";
import { leftoverCandidates, saveRecording } from "./audio/saveRecording";

interface PluginSession extends ActiveSession {
    /** Vault path of the WAV the helper writes. */
    vaultWavPath: string;
    /** Followed through renames while recording. */
    noteFile: TFile | null;
    pid: number | null;
}

export default class SystemRecordingPlugin extends Plugin {
    settings: SystemRecordingSettings;
    /** Public API for other plugins: `app.plugins.plugins["system-recording"].api` (see README). */
    api: SystemRecordingApi;
    credentials: CredentialStore;
    private recorder = new Recorder();
    private provisioner = new BinaryProvisioner(nodeDeps());
    private controller: RecordingController<PluginSession>;
    private statusBarEl: HTMLElement | null = null;
    private durationInterval: number | null = null;
    private recordingStartTime: number | null = null;
    private ribbonIconEl: HTMLElement | null = null;
	private oauth = new GoogleOAuth({
		getCredentials: () => {
			const id = this.settings.googleClientId.trim();
			const secret = this.credentials.getClientSecret().trim();
			return id && secret ? { client_id: id, client_secret: secret } : null;
		},
		getTokens: () => this.credentials.getTokens(),
		setTokens: (tokens) => this.credentials.setTokens(tokens),
	});
	private scheduler: CalendarScheduler | null = null;
	private calendarErrors = new ErrorThrottle({
		now: () => Date.now(),
		notify: (message) => new Notice(`Calendar error: ${message}`),
		intervalMs: CALENDAR_ERROR_INTERVAL_MS,
	});

    async onload() {
        await this.loadSettings();

        this.credentials = new CredentialStore(
            () => this.settings,
            () => this.saveSettings(),
            findSecretStorage(this.app)
        );
        await this.credentials.migrate();

        this.controller = new RecordingController<PluginSession>({
            launch: (options) => this.launchRecording(options),
            requestStop: () => this.requestHelperStop(),
            complete: (session, outcome) => this.completeRecording(session, outcome),
            onBusy: () => new Notice("Already recording"),
            onError: (e) => console.error("[system-recording]", e),
        });
        this.controller.on("start", () => {
            this.recordingStartTime = Date.now();
            this.startDurationTimer();
            this.updateRibbonIcon(true);
        });
        this.controller.on("stop", () => {
            this.clearDurationTimer();
            this.updateRibbonIcon(false);
            this.hideStatusBar();
        });
        this.api = createApi(this.controller);

        // Ribbon icon
        this.ribbonIconEl = this.addRibbonIcon(
            "microphone",
            "Toggle recording",
            () => this.toggleRecording()
        );

        // Status bar
        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.addClass("system-recording-hidden");

        // Commands
        this.addCommand({
            id: "start-recording",
            name: "Start recording",
            callback: () => void this.controller.start(),
        });

        this.addCommand({
            id: "stop-recording",
            name: "Stop recording",
            callback: () => this.stopRecording(),
        });

        // Settings tab
        this.addSettingTab(new SystemRecordingSettingTab(this.app, this));

		this.addCommand({
			id: "authenticate-google-calendar",
			name: "Authenticate calendar",
			callback: () => void this.authenticateCalendar(),
		});

		this.addCommand({
			id: "toggle-calendar-auto-recording",
			name: "Toggle calendar auto-recording",
			callback: async () => {
				this.settings.calendarAutoRecord = !this.settings.calendarAutoRecord;
				await this.saveSettings();
				this.updateScheduler();
				new Notice(
					this.settings.calendarAutoRecord
						? "カレンダー自動録音を有効化しました"
						: "カレンダー自動録音を無効化しました"
				);
			},
		});

        // Recorder callbacks
        this.recorder.onStatus = (status: RecorderStatus) =>
            this.handleStatus(status);
        this.recorder.onError = (message: string) =>
            new Notice(`Recording error: ${message}`);
        this.recorder.onExit = (code, reason) =>
            void this.controller.helperFinished({
                kind: "failed",
                message: reason ?? `The recorder helper exited (code ${String(code)}) before saving.`,
            });

		this.updateScheduler();
    }

    onunload() {
        // The helper still writes the WAV into the vault; conversion and the
        // note link need the plugin, so they are skipped on unload.
        if (this.recorder.isRecording) {
            this.recorder.stop();
        }
        this.clearDurationTimer();
		this.scheduler?.stop();
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData() as Partial<SystemRecordingSettings>
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // MARK: - Recording control

    private toggleRecording() {
        if (this.controller.isRecording()) {
            this.stopRecording();
        } else {
            void this.controller.start();
        }
    }

    private stopRecording() {
        if (!this.controller.isRecording()) {
            new Notice("Not recording");
            return;
        }
        void this.controller.stop();
    }

    private requestHelperStop() {
        this.recorder.stop();
        this.clearDurationTimer();
        this.statusBarEl?.setText("Saving recording…");
        new Notice("Stopping recording...");
    }

    /** Provisions the helper, picks the file and the note, and starts the helper. */
    private async launchRecording(options: StartOptions): Promise<PluginSession | null> {
        if (!Platform.isMacOS) {
            new Notice("System recording is only supported on macOS");
            return null;
        }

        // Remember the note now, so the link goes where the recording started.
        const activeFile = this.app.workspace.getActiveFile();
        const notePath = pickTargetNote(
            options.notePath?.trim() ? normalizePath(options.notePath) : undefined,
            activeFile?.path ?? null
        );
        const noteRef = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;

        // Ensure the recorder helper binary is present and verified
        let binaryPath: string;
        try {
            binaryPath = await this.provisioner.ensure(
                resolveBinaryPath(this),
                HELPER_RELEASE_TAG,
                () => new Notice("Downloading recorder helper…")
            );
        } catch (e) {
            new Notice(e instanceof Error ? e.message : String(e));
            return null;
        }

        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) {
            new Notice("System recording needs a vault on the local file system");
            return null;
        }

        // Ensure recording folder exists
        const folder = normalizePath(this.settings.recordingFolder.trim() || "/");
        if (folder !== "/" && !(await adapter.exists(folder))) {
            await adapter.mkdir(folder);
        }

        const now = moment();
        const baseName = formatFileName(this.settings.fileNameTemplate, {
            format: (tokens) => now.format(tokens),
            title: options.title,
            fallback: "recording",
        });
        const vaultBasePath = adapter.getBasePath();
        const inFolder = (name: string) => (folder === "/" ? name : `${folder}/${name}`);
        // Never reuse a name: the helper cannot replace an existing file, and an
        // existing WAV/M4A must not be overwritten by the conversion.
        const fileName = uniqueBaseName(baseName, (candidate) =>
            ["wav", "m4a"].some((ext) =>
                fs.existsSync(path.join(vaultBasePath, inFolder(`${candidate}.${ext}`)))
            )
        );
        const vaultWavPath = inFolder(`${fileName}.wav`);
        const wavPath = path.join(vaultBasePath, vaultWavPath);

        this.recorder.start(binaryPath, wavPath);
        new Notice("Recording started");

        return {
            wavPath,
            vaultWavPath,
            title: options.title?.trim() || null,
            notePath,
            noteFile: noteRef instanceof TFile ? noteRef : null,
            pid: this.recorder.pid,
        };
    }

    /** Verifies and converts the file, then links it into the note picked at start. */
    private async completeRecording(
        session: PluginSession,
        outcome: HelperOutcome
    ): Promise<{ path: string | null; notePath: string | null }> {
        const notePath = session.noteFile?.path ?? session.notePath;
        const afconvert = createAfconvert(execFile);
        const result = await saveRecording(
            session.wavPath,
            this.settings.outputFormat,
            session.pid !== null ? leftoverCandidates(os.tmpdir(), session.pid) : [],
            {
                fileSize: async (p) => {
                    try {
                        return (await fsp.stat(p)).size;
                    } catch {
                        return null;
                    }
                },
                convert: async (input, output) => {
                    const progress = new Notice("Converting the recording to .m4a…", 0);
                    try {
                        await afconvert(input, output);
                    } finally {
                        progress.hide();
                    }
                },
                remove: (p) => fsp.unlink(p),
            }
        );

        if (!result.ok) {
            const lines = [
                outcome.kind === "failed"
                    ? `Recording error: ${outcome.message}`
                    : `Recording error: ${result.reason}`,
            ];
            if (result.leftovers.length > 0) {
                lines.push("The audio was kept in these temporary files:", ...result.leftovers);
            } else if (outcome.kind === "stopped") {
                lines.push(`Expected file: ${session.wavPath}`);
            }
            new Notice(lines.join("\n"), 0);
            console.error("[system-recording] recording was not saved", outcome, result);
            return { path: null, notePath };
        }

        if (result.warning) new Notice(result.warning, 0);

        const savedPath =
            result.format === "m4a"
                ? session.vaultWavPath.replace(/\.wav$/i, "") + ".m4a"
                : session.vaultWavPath;
        const linkedNote = await this.insertRecordingLink(session, savedPath);
        new Notice(`Recording saved: ${savedPath}`);
        return { path: savedPath, notePath: linkedNote ?? notePath };
    }

    private handleStatus(status: RecorderStatus) {
        if (status.status === "stopped") {
            void this.controller.helperFinished({ kind: "stopped" });
        } else if (status.status === "error") {
            void this.controller.helperFinished({
                kind: "failed",
                message: status.message ?? "Unknown error",
            });
        }
    }

	// MARK: - Calendar integration

	isCalendarAuthenticated(): boolean {
		return this.oauth.isAuthenticated();
	}

	async authenticateCalendar(): Promise<void> {
		try {
			await this.oauth.authenticate();
			this.updateScheduler();
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	/** Calendars for the settings dropdown. */
	listCalendars(): Promise<GCalCalendar[]> {
		return listCalendars(this.oauth);
	}

	/** Starts the scheduler when auto-record is on and authenticated; stops it otherwise. */
	updateScheduler(): void {
		const shouldRun =
			this.settings.calendarAutoRecord && this.oauth.isAuthenticated();
		if (shouldRun) {
			if (!this.scheduler) {
				this.scheduler = new CalendarScheduler({
					now: () => Date.now(),
					fetchEvents: (minMs, maxMs) => this.fetchCalendarEvents(minMs, maxMs),
					onEventStart: (event) => this.handleEventStart(event),
					onEventEnd: (event) => this.handleEventEnd(event),
					onError: (message) => this.calendarErrors.report(message),
					registerInterval: (id) => this.registerInterval(id),
				});
			}
			if (!this.scheduler.isRunning) this.scheduler.start();
		} else {
			this.scheduler?.stop();
		}
	}

	/** Re-poll the calendar immediately (e.g. after changing the target calendar). No-op if not running. */
	refreshCalendarNow(): void {
		void this.scheduler?.poll();
	}

	private async fetchCalendarEvents(
		minMs: number,
		maxMs: number
	): Promise<ScheduledEvent[]> {
		const events = await listEvents(
			this.oauth,
			this.settings.calendarId,
			new Date(minMs),
			new Date(maxMs)
		);
		this.calendarErrors.success();
		const keywords = parseKeywords(this.settings.exclusionKeywords);
		return events
			.filter((e) =>
				shouldRecord({ summary: e.summary, allDay: e.allDay, declined: e.declined }, keywords)
			)
			.map((e) => ({
				id: e.id,
				summary: e.summary,
				start: e.start.getTime(),
				end: e.end.getTime(),
				meetLink: e.meetLink,
			}));
	}

	private handleEventStart(event: ScheduledEvent): void {
		// Only open https links — meetLink comes from external calendar data,
		// so guard against javascript:/file:/custom-scheme URIs.
		if (
			event.meetLink &&
			this.settings.openMeetAutomatically &&
			event.meetLink.startsWith("https://")
		) {
			window.open(event.meetLink, "_blank");
		}
		actionNotice(`「${event.summary}」が始まりました`, "録音開始", () => {
			void this.controller.start({ title: event.summary });
		});
	}

	private handleEventEnd(event: ScheduledEvent): void {
		actionNotice(`「${event.summary}」が終了しました`, "録音停止", () => {
			this.stopRecording();
		});
	}

    // MARK: - UI helpers

    private startDurationTimer() {
        if (this.statusBarEl) {
            this.statusBarEl.removeClass("system-recording-hidden");
        }

        this.durationInterval = window.setInterval(() => {
            if (!this.recordingStartTime || !this.statusBarEl) return;
            const elapsed = Math.floor(
                (Date.now() - this.recordingStartTime) / 1000
            );
            const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
            const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
            const s = String(elapsed % 60).padStart(2, "0");
            this.statusBarEl.setText(`Recording ${h}:${m}:${s}`);
        }, 1000);

        this.registerInterval(this.durationInterval);
    }

    private clearDurationTimer() {
        if (this.durationInterval !== null) {
            window.clearInterval(this.durationInterval);
            this.durationInterval = null;
        }
    }

    private hideStatusBar() {
        if (this.statusBarEl) {
            this.statusBarEl.addClass("system-recording-hidden");
            this.statusBarEl.setText("");
        }
    }

    private updateRibbonIcon(recording: boolean) {
        if (this.ribbonIconEl) {
            if (recording) {
                this.ribbonIconEl.addClass("is-recording");
            } else {
                this.ribbonIconEl.removeClass("is-recording");
            }
        }
    }

    /**
     * Links the recording into the note picked at start: at the cursor when that
     * note is in the active editor, otherwise at the end of the note.
     * Returns the note's path, or null when there was no note to link into.
     */
    private async insertRecordingLink(session: PluginSession, recordingPath: string): Promise<string | null> {
        const ref =
            session.noteFile ??
            (session.notePath ? this.app.vault.getAbstractFileByPath(session.notePath) : null);
        if (!(ref instanceof TFile) || this.app.vault.getAbstractFileByPath(ref.path) !== ref) {
            if (session.notePath) {
                new Notice(`The note for the recording link was not found: ${session.notePath}`);
            }
            return null;
        }

        const embed = embedLink(recordingPath);
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.file === ref) {
            view.editor.replaceRange(`${embed}\n`, view.editor.getCursor());
        } else if (typeof this.app.vault.process === "function") {
            await this.app.vault.process(ref, (content) => appendEmbed(content, embed));
        } else {
            // Vault.process is 1.1.0+; minAppVersion is lower.
            const content = await this.app.vault.read(ref);
            await this.app.vault.modify(ref, appendEmbed(content, embed));
        }
        return ref.path;
    }
}
