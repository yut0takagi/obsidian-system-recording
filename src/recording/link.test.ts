import { describe, it, expect } from "vitest";
import { appendEmbed, embedLink, pickTargetNote } from "./link";

describe("embedLink", () => {
	it("embeds the recording by file name", () => {
		expect(embedLink("recordings/2026-10-16 Sync.m4a")).toBe("![[2026-10-16 Sync.m4a]]");
	});
});

describe("appendEmbed", () => {
	it("adds the link on its own line at the end of the note", () => {
		expect(appendEmbed("# Notes\nbody", "![[a.m4a]]")).toBe("# Notes\nbody\n![[a.m4a]]\n");
	});

	it("does not add a blank line when the note already ends with a newline", () => {
		expect(appendEmbed("# Notes\n", "![[a.m4a]]")).toBe("# Notes\n![[a.m4a]]\n");
	});

	it("handles an empty note", () => {
		expect(appendEmbed("", "![[a.m4a]]")).toBe("![[a.m4a]]\n");
	});
});

describe("pickTargetNote", () => {
	it("prefers the note passed by the caller", () => {
		expect(pickTargetNote("Meetings/Sync.md", "Daily/today.md")).toBe("Meetings/Sync.md");
	});

	it("falls back to the note that was active when recording started", () => {
		expect(pickTargetNote(undefined, "Daily/today.md")).toBe("Daily/today.md");
		expect(pickTargetNote("  ", "Daily/today.md")).toBe("Daily/today.md");
	});

	it("only accepts Markdown notes", () => {
		expect(pickTargetNote("config/app.json", null)).toBeNull();
		expect(pickTargetNote(undefined, "canvas.canvas")).toBeNull();
	});

	it("returns null when there is no note", () => {
		expect(pickTargetNote(undefined, null)).toBeNull();
	});
});
