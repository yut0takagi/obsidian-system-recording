/** `![[name.ext]]` for a recording saved at the given (vault or absolute) path. */
export function embedLink(recordingPath: string): string {
	const name = recordingPath.split(/[\\/]/).pop() ?? recordingPath;
	return `![[${name}]]`;
}

/** Appends the embed on its own line at the end of the note. */
export function appendEmbed(content: string, embed: string): string {
	if (content.length === 0) return `${embed}\n`;
	const separator = content.endsWith("\n") ? "" : "\n";
	return `${content}${separator}${embed}\n`;
}

/**
 * The note that receives the link: the caller's note when given, otherwise the
 * note active at start. Only Markdown notes qualify, so a caller can never make
 * the plugin write into settings or other non-note files.
 */
export function pickTargetNote(
	explicitPath: string | undefined,
	activeAtStart: string | null
): string | null {
	const explicit = explicitPath?.trim();
	const candidate = explicit ? explicit : activeAtStart;
	if (!candidate || !candidate.toLowerCase().endsWith(".md")) return null;
	return candidate;
}
