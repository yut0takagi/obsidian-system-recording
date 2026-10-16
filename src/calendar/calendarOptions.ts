import type { GCalCalendar } from "./googleCalendar";

export interface CalendarOption {
	id: string;
	label: string;
}

const PRIMARY = "primary";

/**
 * Dropdown entries for the target calendar: the `primary` alias first, then the
 * other calendars. A saved id missing from the list is kept as its own entry so
 * opening the settings never changes the choice behind the user's back.
 */
export function calendarOptions(
	calendars: Array<Pick<GCalCalendar, "id" | "summary" | "primary">>,
	currentId: string
): CalendarOption[] {
	const options: CalendarOption[] = [{ id: PRIMARY, label: "メインカレンダー" }];
	for (const c of calendars) {
		if (!c.id || (c.primary && c.id !== currentId)) continue;
		if (options.some((o) => o.id === c.id)) continue;
		options.push({ id: c.id, label: c.summary || c.id });
	}
	if (currentId && !options.some((o) => o.id === currentId)) {
		options.push({ id: currentId, label: currentId });
	}
	return options;
}
