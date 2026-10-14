// Everything that reaches outside the Pia folder lives here, and none of it
// takes free-form input from the model: settings pages come from a fixed list,
// info commands are fixed, and only safe file types can be opened.

import { execFile, spawn } from "node:child_process";
import { statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const isWindows = process.platform === "win32";

/** Settings pages Pia may open, keyed by the name the model uses. */
export const SETTINGS_PAGES = {
  bildschirm: { uri: "ms-settings:display", label: "Bildschirm und Helligkeit" },
  textgroesse: { uri: "ms-settings:easeofaccess-display", label: "Textgröße" },
  lupe: { uri: "ms-settings:easeofaccess-magnifier", label: "Bildschirmlupe" },
  maus: { uri: "ms-settings:mousetouchpad", label: "Maus" },
  ton: { uri: "ms-settings:sound", label: "Ton und Lautstärke" },
  wlan: { uri: "ms-settings:network-wifi", label: "WLAN" },
  internet: { uri: "ms-settings:network-status", label: "Internetverbindung" },
  bluetooth: { uri: "ms-settings:bluetooth", label: "Bluetooth und Geräte" },
  drucker: { uri: "ms-settings:printers", label: "Drucker" },
  hintergrund: { uri: "ms-settings:personalization-background", label: "Hintergrundbild" },
  farben: { uri: "ms-settings:colors", label: "Farben und dunkler Modus" },
  energie: { uri: "ms-settings:powersleep", label: "Bildschirm-Ausschalten und Energie" },
  akku: { uri: "ms-settings:batterysaver", label: "Akku" },
  datum: { uri: "ms-settings:dateandtime", label: "Datum und Uhrzeit" },
  sprache: { uri: "ms-settings:regionlanguage", label: "Sprache" },
  tastatur: { uri: "ms-settings:keyboard", label: "Tastatur" },
  updates: { uri: "ms-settings:windowsupdate", label: "Windows-Aktualisierungen" },
  apps: { uri: "ms-settings:appsfeatures", label: "Installierte Programme (nur ansehen)" },
  standardapps: { uri: "ms-settings:defaultapps", label: "Standard-Programme" },
  benachrichtigungen: { uri: "ms-settings:notifications", label: "Benachrichtigungen" },
  speicher: { uri: "ms-settings:storagesense", label: "Speicherplatz" },
  kamera: { uri: "ms-settings:privacy-webcam", label: "Kamera-Erlaubnis" },
  mikrofon: { uri: "ms-settings:privacy-microphone", label: "Mikrofon-Erlaubnis" },
  konten: { uri: "ms-settings:yourinfo", label: "Dein Benutzerkonto (nur ansehen)" },
  start: { uri: "ms-settings:", label: "Einstellungen (Startseite)" },
} as const;
export type SettingsPage = keyof typeof SETTINGS_PAGES;

/** File types that open in a normal program and cannot run code on their own. */
export const OPENABLE = new Set([
  ".docx", ".pdf", ".xlsx", ".csv", ".txt", ".md", ".html", ".htm",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
]);

export function canOpen(file: string): boolean {
  return OPENABLE.has(path.extname(file).toLowerCase());
}

/** Open a checked file or folder (absolute path from the jail) with its usual program. */
export function openPath(absolute: string): void {
  launch(absolute);
}

/** Hide a folder in Windows Explorer (used for the version history). */
export function hideFolder(absolute: string): void {
  if (isWindows) execFile("attrib.exe", ["+h", absolute], { windowsHide: true, shell: false }, () => {});
}

export function openSettings(page: SettingsPage): void {
  const entry = SETTINGS_PAGES[page];
  if (!entry) throw new Error("unknown page");
  if (!isWindows) return; // Nothing to open while developing on Linux.
  launch(entry.uri);
}

function launch(target: string): void {
  const [command, args] = isWindows ? ["explorer.exe", [target]] : ["xdg-open", [target]];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.on("error", () => {});
  child.unref();
}

export type PcInfo = {
  system: string;
  freeSpace: string;
  totalSpace: string;
  wifi?: string;
  defaultPrinter?: string;
  screen?: string;
};

/** Read-only facts about the computer, gathered with fixed commands only. */
export async function pcInfo(workspace: string): Promise<PcInfo> {
  const disk = statfsSync(workspace);
  const info: PcInfo = {
    system: isWindows ? windowsName() : `${os.type()} ${os.release()}`,
    freeSpace: gigabytes(disk.bavail * disk.bsize),
    totalSpace: gigabytes(disk.blocks * disk.bsize),
  };
  if (isWindows) {
    const [wifi, printer] = await Promise.all([
      run("netsh.exe", ["wlan", "show", "interfaces"]),
      run("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "(Get-CimInstance Win32_Printer -Filter 'Default=True').Name",
      ]),
    ]);
    info.wifi = wifiSummary(wifi);
    info.defaultPrinter = printer.trim() || "keiner eingestellt";
  }
  return info;
}

function windowsName(): string {
  // Windows 11 still reports 10.0; builds from 22000 on are Windows 11.
  const build = Number(os.release().split(".")[2] ?? 0);
  return `${build >= 22000 ? "Windows 11" : "Windows 10"} (Version ${os.release()})`;
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
}

export function wifiSummary(output: string): string {
  if (!output.trim()) return "unbekannt";
  const field = (names: string[]) => {
    for (const line of output.split(/\r?\n/)) {
      const [key, ...rest] = line.split(":");
      if (names.some((n) => key.trim().toLowerCase() === n)) return rest.join(":").trim();
    }
    return undefined;
  };
  const state = field(["state", "status"]);
  const ssid = field(["ssid"]);
  const signal = field(["signal"]);
  if (!state) return "kein WLAN-Gerät gefunden";
  if (/disconnected|getrennt/i.test(state)) return "nicht verbunden";
  return `verbunden mit "${ssid ?? "?"}"${signal ? `, Empfang ${signal}` : ""}`;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 8000, windowsHide: true, shell: false }, (error, stdout) => {
      resolve(error ? "" : String(stdout));
    });
  });
}
