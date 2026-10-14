# Window ↔ helper protocol

Pia has three parts:

- **Window** (`ui/`): HTML/TypeScript shown by Tauri. Everything she sees.
- **Shell** (`src-tauri/`): small Rust program. Opens the window, starts the helper, passes messages, installs updates.
- **Helper** (`helper/`): Bun-compiled executable that runs pi, Pia's tools, the folder lock and the limits.

The window never talks to the helper directly. It calls the Tauri command `helper_send` with one message object, and receives helper messages through the Tauri event `helper-message` (payload: one JSON string). When the helper stops, the shell emits `helper-exit` and restarts it.

Messages are single JSON objects, one per line on the helper's stdin/stdout. Requests that expect an answer carry an `id` string; the answer echoes it as `replyTo`.

## Start-up

The shell starts the helper as:

```
pia-helper --data-dir <app data dir> --workspace <Documents/Pia>
```

and writes this first line to stdin before anything else (never visible to the window):

```json
{ "type": "boot", "key": "<64 hex chars>", "appVersion": "0.1.0" }
```

`key` encrypts the stored ChatGPT login. The shell keeps it in the operating-system keyring.

The helper then sends `{ "type": "ready", "status": Status }`.

## Status

```ts
type Status = {
  signedIn: boolean;          // ChatGPT login present
  busy: boolean;              // Pia is working on a request
  chatId: string | null;      // current conversation
  pinSet: boolean;            // admin PIN configured
  pausedUntil: number | null; // epoch ms; usage limit reached until then
  workspace: string;          // absolute path of her Pia folder, for display only
  features: Features;
};
type Features = { documents: boolean; spreadsheets: boolean; webpages: boolean; photos: boolean; settingsHelp: boolean };
```

## Window → helper

| type | fields | answer |
|---|---|---|
| `status` | `id` | `status` |
| `prompt` | `text`, `images?: {data: base64, mimeType}[]` | stream of events below |
| `stop` | | `busy` false |
| `new_chat` | `id` | `chat` (empty) |
| `list_chats` | `id` | `chats` |
| `open_chat` | `id`, `chatId` | `chat` |
| `confirm_answer` | `requestId`, `yes: boolean` | |
| `list_files` | `id` | `files` |
| `open_file` | `id`, `name` | `ok` or `problem` |
| `open_folder` | `id` | `ok` |
| `list_versions` | `id` | `versions` |
| `restore_version` | `id`, `versionId` | `ok` or `problem` |
| `admin_unlock` | `id`, `pin` | `admin` |
| `admin_set_pin` | `id`, `pin`, `newPin` (`pin` empty when none set yet) | `admin` |
| `admin_lock` | | |
| `admin_settings` | `id` | `admin_settings` |
| `admin_save` | `id`, `settings: AdminSettings` | `admin_settings` |
| `admin_sign_in` | `id` | `sign_in_code`, then `sign_in_done` |
| `admin_sign_out` | `id` | `admin_settings` |

Admin requests other than `admin_unlock`/`admin_set_pin` fail with `problem` unless the admin area was unlocked within the last 15 minutes.

## Helper → window

| type | fields | meaning |
|---|---|---|
| `ready` | `status` | helper started |
| `status` | `replyTo?`, `status` | current state |
| `busy` | `busy` | Pia started or finished working |
| `reply_start` | | Pia starts a new answer bubble |
| `reply_delta` | `text` | more text for the current bubble (Markdown) |
| `reply_end` | `text` | full final text of the bubble |
| `activity` | `text` | short plain-German line about what Pia does now, e.g. "Ich schreibe den Brief …" |
| `activity_end` | | clear the activity line |
| `file_made` | `name`, `kind` | a file was created or changed; show it with an "Öffnen" button |
| `confirm_request` | `requestId`, `title`, `points: string[]` | show the big-job question with "Ja, mach das" / "Nein, lieber nicht" |
| `paused` | `until` (epoch ms), `text` | usage limit reached; show friendly countdown |
| `problem` | `replyTo?`, `text` | friendly German sentence, never technical |
| `chats` | `replyTo`, `items: {id, title, updatedAt}[]` | earlier conversations, newest first |
| `chat` | `replyTo`, `chatId`, `messages: ChatMessage[]` | full conversation to show |
| `files` | `replyTo`, `items: {name, size, modifiedAt, kind}[]` | her files |
| `versions` | `replyTo`, `items: {id, name, savedAt, why}[]` | older versions, newest first |
| `ok` | `replyTo` | done |
| `admin` | `replyTo`, `unlocked: boolean`, `text?` | PIN result |
| `admin_settings` | `replyTo`, `settings: AdminSettings`, `signedIn`, `models: string[]` | admin values |
| `sign_in_code` | `replyTo`, `code`, `url` | show code; you approve it on your phone |
| `sign_in_done` | `replyTo`, `ok`, `text` | login finished |

```ts
type ChatMessage =
  | { role: "user"; text: string; imageCount: number }
  | { role: "pia"; text: string; files: { name: string; kind: string }[] };

type AdminSettings = {
  model: string;
  thinking: "off" | "low" | "medium";
  features: Features;
  limits: { filesPerRequest: number; stepsPerRequest: number; bigFilesPerRequest: number; bigStepsPerRequest: number; maxFileKB: number };
};
```

`kind` is one of `brief` (letter/document), `tabelle` (spreadsheet), `webseite`, `bild`, `text`, `pdf`, `andere`.
