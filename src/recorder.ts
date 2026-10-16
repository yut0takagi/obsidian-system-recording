import { ChildProcess, spawn, SpawnOptions } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

export interface RecorderStatus {
    status: "recording" | "stopped" | "error";
    duration?: number;
    file?: string;
    message?: string;
}

export type SpawnLike = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export class Recorder {
    private process: ChildProcess | null = null;
    private _isRecording = false;
    private stopFilePath: string | null = null;
    private _pid: number | null = null;

    onStatus: ((status: RecorderStatus) => void) | null = null;
    onError: ((message: string) => void) | null = null;
    /** The helper exited (code), or could not be started (null + reason). */
    onExit: ((code: number | null, reason?: string) => void) | null = null;

    constructor(private readonly spawnProcess: SpawnLike = spawn) {}

    get isRecording(): boolean {
        return this._isRecording;
    }

    /** Process id of the running helper; its temp files are named after it. */
    get pid(): number | null {
        return this._pid;
    }

    start(binaryPath: string, outputPath: string): void {
        if (this._isRecording) return;

        const stopFile = path.join(
            os.tmpdir(),
            `system-recorder-stop-${Date.now()}`
        );
        this.stopFilePath = stopFile;

        const proc = this.spawnProcess(binaryPath, [
            "start", "--output", outputPath,
            "--stop-file", stopFile,
        ], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.process = proc;
        this._pid = proc.pid ?? null;
        this._isRecording = true;

        let buffer = "";

        proc.stdout?.on("data", (data: string | Uint8Array) => {
            buffer += data.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const status = JSON.parse(line) as RecorderStatus;
                    if (status.status === "stopped" || status.status === "error") {
                        this._isRecording = false;
                    }
                    this.onStatus?.(status);
                } catch {
                    // Ignore non-JSON output
                }
            }
        });

        proc.stderr?.on("data", (data: string | Uint8Array) => {
            const msg = data.toString().trim();
            if (msg) {
                this.onError?.(msg);
            }
        });

        proc.on("close", (code: number | null) => {
            this._isRecording = false;
            this.process = null;
            this.stopFilePath = null;
            this._pid = null;
            this.onExit?.(code);
        });

        proc.on("error", (err: Error) => {
            this._isRecording = false;
            this.process = null;
            this.stopFilePath = null;
            this._pid = null;
            this.onExit?.(null, err.message);
        });
    }

    stop(): void {
        if (this._isRecording && this.stopFilePath) {
            // Create the stop file - the Swift CLI polls for this
            fs.writeFileSync(this.stopFilePath, "stop");
        }
    }
}
