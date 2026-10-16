import type { StoredTokens } from "./googleOAuth";

/** The part of Obsidian's `app.secretStorage` (1.11.4+) this plugin uses. */
export interface SecretStorageLike {
	getSecret(id: string): string | null;
	setSecret(id: string, secret: string): void;
}

export const CLIENT_SECRET_ID = "system-recording-google-client-secret";
export const TOKENS_ID = "system-recording-google-tokens";

/** The settings fields that used to hold the secrets in plain text (data.json). */
export interface CredentialFields {
	googleClientSecret: string;
	googleTokens: StoredTokens | null;
}

/** Detected at runtime so the plugin keeps working on Obsidian versions without SecretStorage. */
export function findSecretStorage(app: unknown): SecretStorageLike | null {
	if (typeof app !== "object" || app === null) return null;
	const candidate = (app as { secretStorage?: unknown }).secretStorage as
		| Partial<SecretStorageLike>
		| undefined;
	if (
		candidate &&
		typeof candidate.getSecret === "function" &&
		typeof candidate.setSecret === "function"
	) {
		return candidate as SecretStorageLike;
	}
	return null;
}

/**
 * Keeps the OAuth client secret and tokens in SecretStorage when available, so
 * they stay out of data.json (which is often synced or committed). Falls back
 * to data.json otherwise. A value only leaves data.json once SecretStorage has
 * been seen to hold it, so a failed write never loses credentials.
 */
export class CredentialStore {
	constructor(
		private readonly fields: () => CredentialFields,
		private readonly save: () => Promise<void>,
		private readonly secrets: SecretStorageLike | null
	) {}

	get usesSecretStorage(): boolean {
		return this.secrets !== null;
	}

	getClientSecret(): string {
		return this.read(CLIENT_SECRET_ID) ?? this.fields().googleClientSecret;
	}

	async setClientSecret(value: string): Promise<void> {
		const f = this.fields();
		if (this.write(CLIENT_SECRET_ID, value)) {
			f.googleClientSecret = "";
		} else {
			f.googleClientSecret = value;
		}
		await this.save();
	}

	getTokens(): StoredTokens | null {
		const raw = this.read(TOKENS_ID);
		if (raw !== null) return parseTokens(raw);
		return this.fields().googleTokens;
	}

	async setTokens(tokens: StoredTokens | null): Promise<void> {
		const f = this.fields();
		if (this.write(TOKENS_ID, tokens ? JSON.stringify(tokens) : "")) {
			f.googleTokens = null;
		} else {
			f.googleTokens = tokens;
		}
		await this.save();
	}

	/** Moves plain-text values from data.json into SecretStorage. Returns true when data.json changed. */
	async migrate(): Promise<boolean> {
		if (!this.secrets) return false;
		const f = this.fields();
		let changed = false;
		if (f.googleClientSecret && this.write(CLIENT_SECRET_ID, f.googleClientSecret)) {
			f.googleClientSecret = "";
			changed = true;
		}
		if (f.googleTokens && this.write(TOKENS_ID, JSON.stringify(f.googleTokens))) {
			f.googleTokens = null;
			changed = true;
		}
		if (changed) await this.save();
		return changed;
	}

	/** A non-empty stored value, or null. */
	private read(id: string): string | null {
		if (!this.secrets) return null;
		try {
			const value = this.secrets.getSecret(id);
			return value ? value : null;
		} catch {
			return null;
		}
	}

	/** Writes and reads back; true only if SecretStorage now holds exactly `value`. */
	private write(id: string, value: string): boolean {
		if (!this.secrets) return false;
		try {
			this.secrets.setSecret(id, value);
			return (this.secrets.getSecret(id) ?? "") === value;
		} catch {
			return false;
		}
	}
}

function parseTokens(raw: string): StoredTokens | null {
	try {
		const t = JSON.parse(raw) as Partial<StoredTokens> | null;
		if (
			t &&
			typeof t.access_token === "string" &&
			typeof t.refresh_token === "string" &&
			typeof t.expires_at === "number"
		) {
			return {
				access_token: t.access_token,
				refresh_token: t.refresh_token,
				expires_at: t.expires_at,
				scope: typeof t.scope === "string" ? t.scope : "",
			};
		}
	} catch {
		// broken value: treat as signed out
	}
	return null;
}
