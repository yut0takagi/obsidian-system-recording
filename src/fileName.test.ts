import { describe, it, expect } from "vitest";
import { formatFileName, sanitizeFileName, uniqueBaseName } from "./fileName";

// Stands in for moment().format() at 2026-10-16 09:05:07 (moment cannot be imported here).
const VALUES: Record<string, string> = { YYYY: "2026", MM: "10", DD: "16", HH: "09", mm: "05", ss: "07" };
const format = (fmt: string) => fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => VALUES[t] ?? t);

describe("formatFileName", () => {
	it("formats the default template, keeping the literal word intact", () => {
		expect(formatFileName("recording-YYYY-MM-DD-HHmmss", { format })).toBe(
			"recording-2026-10-16-090507"
		);
	});

	it("replaces every occurrence of a token, not just the first", () => {
		expect(formatFileName("YYYY_YYYY", { format })).toBe("2026_2026");
	});

	it("does not replace letters inside ordinary words", () => {
		expect(formatFileName("summary-meeting-YYYY", { format })).toBe("summary-meeting-2026");
	});

	it("formats runs made only of date tokens", () => {
		expect(formatFileName("YYYYMMDD-HHmm", { format })).toBe("20261016-0905");
	});

	it("keeps [bracketed] text literal, like moment", () => {
		expect(formatFileName("[YYYY] YYYY", { format })).toBe("YYYY 2026");
	});

	it("leaves non-ASCII text untouched", () => {
		expect(formatFileName("会議-YYYY年MM月", { format })).toBe("会議-2026年10月");
	});

	it("inserts the title for {{title}}", () => {
		expect(
			formatFileName("YYYY-MM-DD {{title}}", { format, title: "Design review" })
		).toBe("2026-10-16 Design review");
	});

	it("never interprets the title as date tokens", () => {
		expect(formatFileName("{{title}}", { format, title: "MM DD summary" })).toBe(
			"MM DD summary"
		);
	});

	it("strips characters that are not allowed in file names or links", () => {
		expect(
			formatFileName("{{title}}", { format, title: 'Plan: A/B #1 [draft] "v2"?|^*<>' })
		).toBe("Plan A-B 1 draft v2");
	});

	it("drops the separator next to an empty title", () => {
		expect(formatFileName("YYYY-MM-DD_{{title}}", { format, title: "" })).toBe("2026-10-16");
		expect(formatFileName("{{title}} YYYY", { format })).toBe("2026");
		expect(formatFileName("A_{{title}}_B", { format, title: "  " })).toBe("A_B");
	});

	it("falls back when nothing usable remains", () => {
		expect(formatFileName("{{title}}", { format, title: "???", fallback: "recording" })).toBe(
			"recording"
		);
	});

	it("caps the length in UTF-8 bytes without splitting a character", () => {
		const out = formatFileName("{{title}}", { format, title: "あ".repeat(200) });
		expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(180);
		expect(out).toMatch(/^あ+$/);
	});
});

describe("sanitizeFileName", () => {
	it("removes leading dots so the file is not hidden", () => {
		expect(sanitizeFileName("..secret")).toBe("secret");
	});

	it("removes control characters and collapses whitespace", () => {
		expect(sanitizeFileName("a\u0000b\n\tc   d")).toBe("ab c d");
	});
});

describe("uniqueBaseName", () => {
	it("returns the name unchanged when it is free", () => {
		expect(uniqueBaseName("rec", () => false)).toBe("rec");
	});

	it("appends a counter until the name is free", () => {
		const taken = new Set(["rec", "rec 1"]);
		expect(uniqueBaseName("rec", (n) => taken.has(n))).toBe("rec 2");
	});
});
