import { describe, it, expect } from "vitest";
import { calendarOptions } from "./calendarOptions";

const LIST = [
	{ id: "me@example.com", summary: "Me", primary: true },
	{ id: "team@group.example.com", summary: "Team", primary: false },
];

describe("calendarOptions", () => {
	it("offers the primary alias first and the other calendars after it", () => {
		expect(calendarOptions(LIST, "primary")).toEqual([
			{ id: "primary", label: "メインカレンダー" },
			{ id: "team@group.example.com", label: "Team" },
		]);
	});

	it("keeps the primary calendar's own id when it is the saved choice", () => {
		expect(calendarOptions(LIST, "me@example.com").map((o) => o.id)).toEqual([
			"primary",
			"me@example.com",
			"team@group.example.com",
		]);
	});

	it("keeps a saved id that is not in the list, so it is not silently changed", () => {
		expect(calendarOptions(LIST, "old@group.example.com").at(-1)).toEqual({
			id: "old@group.example.com",
			label: "old@group.example.com",
		});
	});

	it("skips entries without an id", () => {
		expect(calendarOptions([{ id: "", summary: "Broken", primary: false }], "primary")).toEqual([
			{ id: "primary", label: "メインカレンダー" },
		]);
	});
});
