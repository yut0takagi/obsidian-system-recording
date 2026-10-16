import { App, DropdownComponent, PluginSettingTab, Setting } from "obsidian";
import SystemRecordingPlugin from "./main";
import type { StoredTokens } from "./auth/googleOAuth";
import type { OutputFormat } from "./audio/saveRecording";
import { calendarOptions } from "./calendar/calendarOptions";

export interface SystemRecordingSettings {
	recordingFolder: string;
	fileNameTemplate: string;
	outputFormat: OutputFormat;
	googleClientId: string;
	/** Only used when SecretStorage is unavailable (see CredentialStore). */
	googleClientSecret: string;
	/** Only used when SecretStorage is unavailable (see CredentialStore). */
	googleTokens: StoredTokens | null;
	calendarAutoRecord: boolean;
	calendarId: string;
	exclusionKeywords: string;
	openMeetAutomatically: boolean;
}

export const DEFAULT_SETTINGS: SystemRecordingSettings = {
	recordingFolder: "recordings",
	fileNameTemplate: "recording-YYYY-MM-DD-HHmmss-{{title}}",
	outputFormat: "m4a",
	googleClientId: "",
	googleClientSecret: "",
	googleTokens: null,
	calendarAutoRecord: false,
	calendarId: "primary",
	exclusionKeywords: "",
	openMeetAutomatically: false,
};

export class SystemRecordingSettingTab extends PluginSettingTab {
    plugin: SystemRecordingPlugin;

    constructor(app: App, plugin: SystemRecordingPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Recording folder")
            .setDesc("Folder in your vault to save recordings.")
            .addText((text) =>
                text
                    .setPlaceholder("Recordings")
                    .setValue(this.plugin.settings.recordingFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.recordingFolder = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("File name template")
            .setDesc(
                "Date tokens: YYYY MM DD HH mm ss (also YY MMM MMMM Do ddd dddd hh). {{title}} is the meeting title from the calendar or another plugin. Text in [brackets] is kept as is."
            )
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.fileNameTemplate)
                    .onChange(async (value) => {
                        this.plugin.settings.fileNameTemplate = value;
                        await this.plugin.saveSettings();
                    })
            );

		new Setting(containerEl)
			.setName("File format")
			.setDesc(
				"Save as compressed .m4a (about 43 megabytes per hour) or uncompressed .wav (about 635 megabytes per hour). If the .m4a conversion fails, the .wav file is kept."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("m4a", ".m4a (smaller)")
					.addOption("wav", ".wav (uncompressed)")
					.setValue(this.plugin.settings.outputFormat)
					.onChange(async (value) => {
						this.plugin.settings.outputFormat = value === "wav" ? "wav" : "m4a";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Google カレンダー連携").setHeading();

		new Setting(containerEl)
			.setName("クライアント ID")
			.setDesc("Google で発行したクライアント ID。")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.googleClientId)
					.onChange(async (value) => {
						this.plugin.settings.googleClientId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("クライアントシークレット")
			.setDesc(
				this.plugin.credentials.usesSecretStorage
					? "Google で発行したクライアントシークレット。Obsidian のシークレットストレージに保存し、data.json には書きません。"
					: "Google で発行したクライアントシークレット。この Obsidian にはシークレットストレージがないため data.json に保存します。"
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setValue(this.plugin.credentials.getClientSecret())
					.onChange(async (value) => {
						await this.plugin.credentials.setClientSecret(value.trim());
					});
			});

		new Setting(containerEl)
			.setName("Google 認証")
			.setDesc(
				this.plugin.isCalendarAuthenticated()
					? "認証済み。再認証するとトークンを更新します。"
					: "未認証。クライアント ID とシークレットを設定してから認証してください。"
			)
			.addButton((btn) =>
				btn
					.setButtonText(
						this.plugin.isCalendarAuthenticated() ? "再認証" : "認証する"
					)
					.setCta()
					.onClick(async () => {
						await this.plugin.authenticateCalendar();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("カレンダー自動録音")
			.setDesc("予定の開始時刻に録音開始の通知を出します。辞退した予定には出しません。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.calendarAutoRecord)
					.onChange(async (value) => {
						this.plugin.settings.calendarAutoRecord = value;
						await this.plugin.saveSettings();
						this.plugin.updateScheduler();
					})
			);

		this.addCalendarSetting(containerEl);

		new Setting(containerEl)
			.setName("除外キーワード")
			.setDesc("タイトルにこれらの語を含む予定は録音しません（改行またはカンマ区切り、大文字小文字無視）。")
			.addTextArea((ta) =>
				ta
					.setValue(this.plugin.settings.exclusionKeywords)
					.onChange(async (value) => {
						this.plugin.settings.exclusionKeywords = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Meet を自動で開く")
			.setDesc("予定に会議リンクがあれば開始時刻にブラウザで開きます。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openMeetAutomatically)
					.onChange(async (value) => {
						this.plugin.settings.openMeetAutomatically = value;
						await this.plugin.saveSettings();
					})
			);
    }

	/** A dropdown of your calendars once authenticated; a plain ID field otherwise. */
	private addCalendarSetting(containerEl: HTMLElement): void {
		const setting = new Setting(containerEl).setName("対象カレンダー");

		if (!this.plugin.isCalendarAuthenticated()) {
			setting
				.setDesc("監視するカレンダーの ID。既定の primary はメインカレンダー。認証すると一覧から選べます。")
				.addText((text) => {
					text
						.setValue(this.plugin.settings.calendarId)
						.onChange(async (value) => {
							this.plugin.settings.calendarId = value.trim() || "primary";
							await this.plugin.saveSettings();
						});
					// Re-poll immediately once the user finishes editing (avoids per-keystroke API calls).
					this.plugin.registerDomEvent(text.inputEl, "blur", () => {
						this.plugin.refreshCalendarNow();
					});
				});
			return;
		}

		setting.setDesc("監視するカレンダー。");
		let dropdown: DropdownComponent | null = null;
		const fill = (calendars: Parameters<typeof calendarOptions>[0]) => {
			if (!dropdown) return;
			dropdown.selectEl.empty();
			for (const option of calendarOptions(calendars, this.plugin.settings.calendarId)) {
				dropdown.addOption(option.id, option.label);
			}
			dropdown.setValue(this.plugin.settings.calendarId);
		};
		const load = async () => {
			try {
				fill(await this.plugin.listCalendars());
				setting.setDesc("監視するカレンダー。");
			} catch (e) {
				setting.setDesc(
					`カレンダー一覧を取得できませんでした: ${e instanceof Error ? e.message : String(e)}`
				);
			}
		};

		setting.addDropdown((d) => {
			dropdown = d;
			fill([]);
			d.onChange(async (value) => {
				this.plugin.settings.calendarId = value || "primary";
				await this.plugin.saveSettings();
				this.plugin.refreshCalendarNow();
			});
		});
		setting.addExtraButton((btn) =>
			btn
				.setIcon("refresh-cw")
				.setTooltip("一覧を再読み込み")
				.onClick(() => void load())
		);
		void load();
	}
}
