// Types for the window <-> helper protocol. See docs/protocol.md.

export type Features = {
  documents: boolean;
  spreadsheets: boolean;
  webpages: boolean;
  photos: boolean;
  settingsHelp: boolean;
};

export type Status = {
  signedIn: boolean;
  busy: boolean;
  chatId: string | null;
  pinSet: boolean;
  pausedUntil: number | null;
  workspace: string;
  features: Features;
};

export type FileKind = "brief" | "tabelle" | "webseite" | "bild" | "text" | "pdf" | "andere";

export type FileRef = { name: string; kind: string };

export type ChatMessage =
  | { role: "user"; text: string; imageCount: number }
  | { role: "pia"; text: string; files: FileRef[] };

export type Limits = {
  filesPerRequest: number;
  stepsPerRequest: number;
  bigFilesPerRequest: number;
  bigStepsPerRequest: number;
  maxFileKB: number;
};

export type Thinking = "off" | "low" | "medium";

export type AdminSettings = {
  model: string;
  thinking: Thinking;
  features: Features;
  limits: Limits;
};

export type ImageData = { data: string; mimeType: string };

export type ChatItem = { id: string; title: string; updatedAt: number };
export type FileItem = { name: string; size: number; modifiedAt: number; kind: string };
export type VersionItem = { id: string; name: string; savedAt: number; why: string };

/** Messages the window sends to the helper. */
export type WindowMessage =
  | { type: "status"; id: string }
  | { type: "prompt"; text: string; images?: ImageData[] }
  | { type: "stop" }
  | { type: "new_chat"; id: string }
  | { type: "list_chats"; id: string }
  | { type: "open_chat"; id: string; chatId: string }
  | { type: "confirm_answer"; requestId: string; yes: boolean }
  | { type: "list_files"; id: string }
  | { type: "open_file"; id: string; name: string }
  | { type: "open_folder"; id: string }
  | { type: "list_versions"; id: string }
  | { type: "restore_version"; id: string; versionId: string }
  | { type: "admin_unlock"; id: string; pin: string }
  | { type: "admin_set_pin"; id: string; pin: string; newPin: string }
  | { type: "admin_lock" }
  | { type: "admin_settings"; id: string }
  | { type: "admin_save"; id: string; settings: AdminSettings }
  | { type: "admin_sign_in"; id: string }
  | { type: "admin_sign_out"; id: string };

/** Messages the helper sends to the window. */
export type HelperMessage =
  | { type: "ready"; status: Status }
  | { type: "status"; replyTo?: string; status: Status }
  | { type: "busy"; busy: boolean }
  | { type: "reply_start" }
  | { type: "reply_delta"; text: string }
  | { type: "reply_end"; text: string }
  | { type: "activity"; text: string }
  | { type: "activity_end" }
  | { type: "file_made"; name: string; kind: string }
  | { type: "confirm_request"; requestId: string; title: string; points: string[] }
  | { type: "paused"; until: number; text: string }
  | { type: "problem"; replyTo?: string; text: string }
  | { type: "chats"; replyTo: string; items: ChatItem[] }
  | { type: "chat"; replyTo: string; chatId: string; messages: ChatMessage[] }
  | { type: "files"; replyTo: string; items: FileItem[] }
  | { type: "versions"; replyTo: string; items: VersionItem[] }
  | { type: "ok"; replyTo: string }
  | { type: "admin"; replyTo: string; unlocked: boolean; text?: string }
  | { type: "admin_settings"; replyTo: string; settings: AdminSettings; signedIn: boolean; models: string[] }
  | { type: "sign_in_code"; replyTo: string; code: string; url: string }
  | { type: "sign_in_done"; replyTo: string; ok: boolean; text: string };

/** Window messages that carry an `id` and expect an answer. */
export type RequestMessage = Extract<WindowMessage, { id: string }>;

/** Distributes Omit over a union so each variant keeps its own fields. */
export type WithoutId<M> = M extends unknown ? Omit<M, "id"> : never;

export type HelperMessageOf<K extends HelperMessage["type"]> = Extract<HelperMessage, { type: K }>;
