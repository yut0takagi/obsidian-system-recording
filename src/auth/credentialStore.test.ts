import { describe, it, expect, vi } from "vitest";
import {
	CLIENT_SECRET_ID,
	CredentialFields,
	CredentialStore,
	findSecretStorage,
	SecretStorageLike,
	TOKENS_ID,
} from "./credentialStore";

const TOKENS = {
	access_token: "fake-access",
	refresh_token: "fake-refresh",
	expires_at: 123,
	scope: "calendar.readonly",
};

function fakeSecrets(initial: Record<string, string> = {}): SecretStorageLike & { data: Record<string, string> } {
	const data = { ...initial };
	return {
		data,
		getSecret: (id) => data[id] ?? null,
		setSecret: (id, value) => {
			data[id] = value;
		},
	};
}

function setup(fields: Partial<CredentialFields>, secrets: SecretStorageLike | null) {
	const settings: CredentialFields = { googleClientSecret: "", googleTokens: null, ...fields };
	const save = vi.fn(async () => {});
	return { settings, save, store: new CredentialStore(() => settings, save, secrets) };
}

describe("findSecretStorage", () => {
	it("returns app.secretStorage when it has the expected methods", () => {
		const secrets = fakeSecrets();
		expect(findSecretStorage({ secretStorage: secrets })).toBe(secrets);
	});

	it("returns null on Obsidian versions without SecretStorage", () => {
		expect(findSecretStorage({})).toBeNull();
		expect(findSecretStorage({ secretStorage: { getSecret: 1 } })).toBeNull();
		expect(findSecretStorage(null)).toBeNull();
	});
});

describe("CredentialStore with SecretStorage", () => {
	it("moves the client secret and tokens out of data.json", async () => {
		const secrets = fakeSecrets();
		const { settings, save, store } = setup({ googleClientSecret: "fake-secret", googleTokens: TOKENS }, secrets);

		await expect(store.migrate()).resolves.toBe(true);

		expect(secrets.data[CLIENT_SECRET_ID]).toBe("fake-secret");
		expect(JSON.parse(secrets.data[TOKENS_ID] ?? "null")).toEqual(TOKENS);
		expect(settings.googleClientSecret).toBe("");
		expect(settings.googleTokens).toBeNull();
		expect(save).toHaveBeenCalledTimes(1);
		expect(store.getClientSecret()).toBe("fake-secret");
		expect(store.getTokens()).toEqual(TOKENS);
	});

	it("does nothing when data.json holds no secrets", async () => {
		const { save, store } = setup({}, fakeSecrets());
		await expect(store.migrate()).resolves.toBe(false);
		expect(save).not.toHaveBeenCalled();
	});

	it("keeps the values in data.json when SecretStorage does not keep them", async () => {
		const broken: SecretStorageLike = { getSecret: () => null, setSecret: () => {} };
		const { settings, store } = setup({ googleClientSecret: "fake-secret", googleTokens: TOKENS }, broken);
		await store.migrate();
		expect(settings.googleClientSecret).toBe("fake-secret");
		expect(settings.googleTokens).toEqual(TOKENS);
		expect(store.getClientSecret()).toBe("fake-secret");
		expect(store.getTokens()).toEqual(TOKENS);
	});

	it("keeps the values in data.json when SecretStorage throws", async () => {
		const throwing: SecretStorageLike = {
			getSecret: () => null,
			setSecret: () => {
				throw new Error("invalid id");
			},
		};
		const { settings, store } = setup({ googleClientSecret: "fake-secret" }, throwing);
		await store.migrate();
		expect(settings.googleClientSecret).toBe("fake-secret");
	});

	it("writes new tokens and secrets to SecretStorage only", async () => {
		const secrets = fakeSecrets();
		const { settings, store } = setup({}, secrets);
		await store.setTokens(TOKENS);
		await store.setClientSecret("fake-secret-2");
		expect(settings.googleTokens).toBeNull();
		expect(settings.googleClientSecret).toBe("");
		expect(store.getTokens()).toEqual(TOKENS);
		expect(store.getClientSecret()).toBe("fake-secret-2");
	});

	it("treats a stored empty value or broken JSON as absent", () => {
		const { store } = setup({}, fakeSecrets({ [TOKENS_ID]: "{not json", [CLIENT_SECRET_ID]: "" }));
		expect(store.getTokens()).toBeNull();
		expect(store.getClientSecret()).toBe("");
	});

	it("clears the tokens", async () => {
		const secrets = fakeSecrets({ [TOKENS_ID]: JSON.stringify(TOKENS) });
		const { store } = setup({}, secrets);
		await store.setTokens(null);
		expect(store.getTokens()).toBeNull();
	});
});

describe("CredentialStore without SecretStorage", () => {
	it("keeps using data.json as before", async () => {
		const { settings, save, store } = setup({}, null);
		await expect(store.migrate()).resolves.toBe(false);
		await store.setTokens(TOKENS);
		await store.setClientSecret("fake-secret");
		expect(settings.googleTokens).toEqual(TOKENS);
		expect(settings.googleClientSecret).toBe("fake-secret");
		expect(save).toHaveBeenCalledTimes(2);
		expect(store.usesSecretStorage).toBe(false);
	});
});
