// New versions of Pia.
//
// Checks on start and every 4 hours. An optional new version shows a
// friendly banner; a required one (manifest `minimumVersion` above the
// running version) covers the whole window until she installs it.

import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { isTauri } from "./bridge";
import { button, clear, h, setButtonLabel } from "./dom";
import { compareVersions, percent } from "./format";
import { avatar, icon } from "./icons";
import { mockFlags } from "./flags";
import { T } from "./strings";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

let installing = false;

type Progress = { kind: "started" } | { kind: "progress"; percent: number | null } | { kind: "installing" };

/** What the window needs to know about an available new version. */
export interface NewVersion {
  version: string;
  required: boolean;
  install(onProgress: (p: Progress) => void): Promise<void>;
  relaunch(): Promise<void>;
}

async function checkTauri(): Promise<NewVersion | null> {
  const update = await check();
  if (!update) return null;
  const current = await getVersion();
  const minimum = update.rawJson["minimumVersion"];
  const required = typeof minimum === "string" && compareVersions(current, minimum) < 0;
  return {
    version: update.version,
    required,
    async install(onProgress) {
      let total: number | undefined;
      let done = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength;
            onProgress({ kind: "started" });
            break;
          case "Progress":
            done += event.data.chunkLength;
            onProgress({ kind: "progress", percent: percent(done, total) });
            break;
          case "Finished":
            onProgress({ kind: "installing" });
            break;
        }
      });
    },
    relaunch: () => relaunch(),
  };
}

async function checkMock(): Promise<NewVersion | null> {
  const flags = mockFlags();
  if (flags.has("noupdate")) return null;
  const fail = flags.has("updatefail");
  return {
    version: "0.2.0",
    required: compareVersions("0.1.0", flags.has("required") ? "0.2.0" : "0.0.1") < 0,
    async install(onProgress) {
      onProgress({ kind: "started" });
      for (let p = 0; p <= 100; p += 8) {
        await new Promise((r) => setTimeout(r, 180));
        onProgress({ kind: "progress", percent: Math.min(p, 100) });
        if (fail && p > 40) throw new Error("mock failure");
      }
      onProgress({ kind: "installing" });
      await new Promise((r) => setTimeout(r, 800));
    },
    async relaunch() {
      await new Promise((r) => setTimeout(r, 1200));
      document.querySelector(".update-banner")?.remove();
      document.querySelector(".update-cover")?.remove();
    },
  };
}

function render(slot: HTMLElement, cover: HTMLElement, found: NewVersion): void {
  clear(slot);
  clear(cover);
  cover.hidden = true;
  document.body.classList.remove("has-cover");
  const status = h("p", { class: "update-status", role: "status", "aria-live": "polite" });
  const hint = h("span", {}, T.updates.availableHint);
  const go = button(T.updates.button, () => void run(), { kind: "primary", className: "btn-big" });

  const run = async () => {
    go.disabled = true;
    installing = true;
    status.textContent = T.updates.starting;
    hint.hidden = false;
    try {
      await found.install((p) => {
        if (p.kind === "installing") status.textContent = T.updates.installing;
        else if (p.kind === "progress" && p.percent !== null) status.textContent = T.updates.progress(p.percent);
        else status.textContent = T.updates.starting;
      });
      status.textContent = T.updates.restarting;
      await found.relaunch();
    } catch (error) {
      console.warn("pia: update failed", error);
      status.textContent = T.updates.failed;
      hint.hidden = true;
      installing = false;
      go.disabled = false;
      setButtonLabel(go, T.updates.button);
    }
  };

  if (found.required) {
    cover.hidden = false;
    cover.append(
      h(
        "div",
        { class: "update-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "update-title" },
        avatar("large"),
        h("h1", { id: "update-title" }, T.updates.required),
        h("p", { class: "muted" }, T.updates.requiredHint),
        go,
        status,
      ),
    );
    document.body.classList.add("has-cover");
    go.focus();
  } else {
    slot.append(
      h(
        "div",
        { class: "update-banner" },
        h("span", { class: "update-icon" }, icon.restore()),
        h("div", { class: "update-text" }, h("strong", {}, T.updates.available), hint, status),
        go,
      ),
    );
  }
}

export function startUpdates(slot: HTMLElement, cover: HTMLElement): void {
  let shown: { version: string; required: boolean } | null = null;
  const tick = async () => {
    if (installing) return;
    try {
      const found = isTauri() ? await checkTauri() : await checkMock();
      if (found && !installing && (shown?.version !== found.version || shown.required !== found.required)) {
        shown = { version: found.version, required: found.required };
        render(slot, cover, found);
      }
    } catch (error) {
      // No internet or no update server: try again later, quietly.
      console.warn("pia: update check failed", error);
    }
  };
  void tick();
  setInterval(() => void tick(), CHECK_EVERY_MS);
}
