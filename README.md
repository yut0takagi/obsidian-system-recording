# Obsidian System Recording

![Downloads](https://raw.githubusercontent.com/yut0takagi/obsidian-system-recording/main/.github/stats/badge.svg)

![Download history](https://raw.githubusercontent.com/yut0takagi/obsidian-system-recording/main/.github/stats/downloads.svg)

macOSのシステム音声（Zoom / Google Meet / Teams等の相手の声）とマイク音声をまとめて録音し、M4AファイルとしてVault内に保存するObsidianプラグイン。

## Requirements

- macOS 13.0+（Apple Silicon）
- Obsidian Desktop

## Features

- ScreenCaptureKitによるシステム音声キャプチャ（追加ドライバ不要）。ヘッドホンで会議に参加していても相手の声が残ります
- マイク音声との同時録音（1ファイルにミックス）
- M4A（AAC）で保存（既定）。1時間で最大約43MB。設定でWAV（1時間で約635MB）も選べます
- 録音を開始したときに開いていたノートへ録音のリンクを挿入
- Googleカレンダーの予定開始時に録音開始の通知（任意）
- 他のプラグインから録音を開始・停止できる公開API
- リボンボタン / コマンドパレットから操作。録音中はステータスバーに経過時間を表示

## Privacy

- 録音は手元のVaultにだけ保存します。音声をどこかへ送ることはありません
- 外部と通信するのは次の2つだけです
  - 初回の録音開始時に、macOSヘルパー（`system-recorder`）をこのリポジトリのGitHubリリースから取得するとき（SHA-256で検証）
  - Googleカレンダー連携を有効にしたときの、Google Calendar API（読み取り専用スコープ `calendar.readonly`）への問い合わせ
- カレンダー連携のクライアントシークレットとトークンは、Obsidian 1.11.4以降ではObsidianのシークレットストレージに保存し、`data.json` には書きません。それより前のObsidianでは `data.json` に保存されます

## Installation

### コミュニティプラグイン経由（推奨）

1. Obsidian の設定 → Community plugins → Browse → "System Recording" を検索してインストール
2. プラグインを有効化
3. 初回の録音開始時に、macOS ヘルパー（`system-recorder`）が GitHub リリースから自動ダウンロード・検証（SHA-256）され、プラグインフォルダに配置されます（Apple Silicon のみ）
4. 続いて「画面収録」と「マイク」の権限許可ダイアログが表示されます

### 手動インストール

1. Releases から最新版の `main.js`, `manifest.json`, `styles.css` をダウンロード
2. Vault の `.obsidian/plugins/system-recording/` に配置
3. Obsidian の設定 → Community plugins → System Recording を有効化
4. 初回録音時に `system-recorder` が自動ダウンロードされます（手動で配置することも可能）

## Usage

- 左サイドバーのマイクアイコンをクリックして録音開始/停止
- コマンドパレット (`Cmd+P`) → "Start recording" / "Stop recording"
- 停止すると録音を保存し、録音を開始したときに開いていたノートにリンク（`![[...]]`）を入れます。そのノートをエディタで開いていればカーソル位置に、開いていなければノートの末尾に入ります
- 保存に失敗したときは、ヘルパーの一時ファイルの場所を通知に表示し、一時ファイルは消しません
- 録音中にObsidianを終了したりプラグインを無効にしたりすると、録音はWAVのまま保存されます（M4Aへの変換とリンクの挿入は行われません）

## Settings

- **Recording folder**: 録音ファイルの保存先フォルダ（デフォルト: `recordings`）
- **File name template**: ファイル名テンプレート（デフォルト: `recording-YYYY-MM-DD-HHmmss-{{title}}`）
  - 日付トークン: `YYYY` `MM` `DD` `HH` `mm` `ss`（ほかに `YY` `MMM` `MMMM` `Do` `ddd` `dddd` `hh`）。英字のつながりがすべてトークンでできているときだけ日付に置き換えるので、`recording` や `summary` のような単語はそのまま残ります
  - `{{title}}`: カレンダーの予定名や、APIで渡された題名。題名がないときは前後の区切り文字ごと消えます（例: `recording-2026-10-16-090507`）
  - `[ ]` で囲んだ部分は置き換えません
  - ファイル名に使えない文字（`\ / : * ? " < > | # ^ [ ]`）は除きます。同じ名前のファイルがあるときは ` 1`、` 2` … を付けます
- **File format**: `.m4a`（既定）または `.wav`。M4Aは録音後にmacOS標準の `afconvert` で変換します。変換に失敗したときはWAVを残して通知します

## Google カレンダー連携

予定の開始時刻に「録音開始」ボタン付きの通知を出し、終了時刻に「録音停止」ボタン付きの通知を出します。録音そのものはボタンを押したときに始まります。

1. Google Cloud Console でプロジェクトを作り、Google Calendar API を有効にする
2. OAuth 同意画面を設定し、テストユーザーに自分を追加する
3. 「デスクトップ アプリ」の OAuth クライアントを作成し、クライアント ID とシークレットを設定画面に入力する
4. 設定画面の「認証する」（またはコマンド "Authenticate calendar"）でブラウザ認証する。認証は手元の `127.0.0.1` で受け取ります
5. 「カレンダー自動録音」をオンにする

- **対象カレンダー**: 認証後は一覧から選べます（既定はメインカレンダー）
- **除外キーワード**: タイトルにこれらの語を含む予定には通知しません。終日予定と、自分が辞退した予定にも通知しません
- **Meet を自動で開く**: 予定に会議リンクがあれば開始時刻にブラウザで開きます（既定はオフ。`https://` のリンクだけを開きます）
- 予定名はファイル名の `{{title}}` に入ります
- カレンダーの取得に失敗したときの通知は、続けて失敗している間は1時間に1回までにしています

## API for other plugins

プラグインが有効なとき、`app.plugins.plugins["system-recording"].api` から使えます。`apiVersion` で対応を確かめてから呼んでください（1.1.0 以降）。

```ts
interface SystemRecordingApi {
	readonly apiVersion: 1;
	/**
	 * 録音を開始する。ヘルパーが録音を始めたら true、始められなかったら false
	 * （録音中、macOS以外、ヘルパーの取得失敗など。理由はSystem Recordingが通知する）。
	 * title はファイル名の {{title}} に入る。リンクは notePath のノートに入り、
	 * 省略したときは「開始した時点で」アクティブなノートに入る。
	 */
	startRecording(options?: { title?: string; notePath?: string }): Promise<boolean>;
	/**
	 * 録音を停止し、ファイルの保存（と変換）が終わってから、そのVault内のパスを返す。
	 * 録音していなかったとき・保存に失敗したときは null。
	 */
	stopRecording(): Promise<{ path: string } | null>;
	/** 録音中、および停止した録音を保存し終えるまで true。 */
	isRecording(): boolean;
	/** 開始・停止の購読。戻り値の関数を呼ぶと購読を解除する。 */
	on(event: "start", listener: (e: { title: string | null; notePath: string | null }) => void): () => void;
	on(event: "stop", listener: (e: { path: string | null; notePath: string | null }) => void): () => void;
}
```

- `notePath` は Vault 内の Markdown ノート（`.md`）だけを受け付けます。それ以外を渡すとリンクは入りません
- 開始時にノートがまだなくても、停止時にそのパスにノートがあればリンクを入れます

```ts
const api = (app as any).plugins?.plugins?.["system-recording"]?.api;
if (api?.apiVersion === 1) {
	await api.startRecording({ title: "Weekly sync", notePath: "Meetings/2026-10-16 Weekly sync.md" });
	// ...
	const saved = await api.stopRecording(); // { path: "recordings/....m4a" } | null
}
```

`api` がない古い版（1.0.x）では、コマンド `system-recording:start-recording` / `system-recording:stop-recording` を実行できます（題名とノートは渡せません）。

## Development

```bash
# Install dependencies
npm install

# Build Swift helper
cd swift-helper && swift build -c release && cd ..
cp swift-helper/.build/release/SystemRecorder system-recorder

# Build plugin (dev mode with watch)
npm run dev

# Build plugin (production)
npm run build

# Tests (the afconvert test runs only on macOS, with a synthetic WAV)
npm test
```

## Releasing

The macOS helper (`system-recorder`) is **not** distributed by Obsidian's community store
(only `main.js` / `manifest.json` / `styles.css` are). Instead the plugin downloads it on
first use from the GitHub release named by `HELPER_RELEASE_TAG` in [`src/binary.ts`](src/binary.ts),
and verifies it against `EXPECTED_SHA256` in the same file. **The tag, the hash and the
uploaded binary must belong together.**

Plugin-only release (helper unchanged):

1. `npm test && npm run lint && npm run build`
2. Bump `manifest.json` / `versions.json` / `package.json`, commit, and tag `X.Y.Z`
   (no `v` prefix — Obsidian matches the tag to `manifest.json`'s version).
3. `gh release create X.Y.Z main.js manifest.json styles.css`

Release with a new helper:

1. `cd swift-helper && swift build -c release && cd ..`
2. `cp swift-helper/.build/release/SystemRecorder system-recorder`
3. `shasum -a 256 system-recorder` — copy the hex into `EXPECTED_SHA256`, and set
   `HELPER_RELEASE_TAG` to the new version `X.Y.Z`, both in `src/binary.ts`.
4. `npm run build` (bundles the updated hash into `main.js`), then `npm test && npm run lint`.
5. Bump `manifest.json` / `versions.json` / `package.json`, commit, and tag `X.Y.Z`.
6. `gh release create X.Y.Z main.js manifest.json styles.css system-recorder`
