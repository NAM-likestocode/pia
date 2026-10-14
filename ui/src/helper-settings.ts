// "Einstellungen für Helfer": the PIN-locked area for her son.

import type { Helper } from "./bridge";
import { problemText, setNotice } from "./common";
import { button, h } from "./dom";
import { avatar, icon } from "./icons";
import type { AdminSettings, Features, HelperMessageOf, Limits, Thinking } from "./protocol";
import { T } from "./strings";

const H = T.helper;

type Options = {
  helper: Helper;
  pinSet: () => boolean;
  workspace: () => string;
  onLeave: (locked: boolean) => void;
};

function pinInput(id: string, autocomplete: string): HTMLInputElement {
  return h("input", {
    id,
    class: "pin-input",
    type: "password",
    inputmode: "numeric",
    pattern: "[0-9]*",
    maxlength: 12,
    autocomplete,
    spellcheck: "false",
  });
}

function field(label: string, control: HTMLElement, id: string): HTMLElement {
  return h("div", { class: "field" }, h("label", { for: id }, label), control);
}

export class HelperSettingsView {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private pin = "";
  private signInListener: (() => void) | null = null;

  constructor(private opts: Options) {
    this.body = h("div", { class: "panel-inner helper-area" });
    this.el = h("section", { class: "view panel", hidden: true }, this.body);
  }

  /** Shows the PIN screen (or "set a PIN" when none exists yet). */
  open(): void {
    this.pin = "";
    if (this.opts.pinSet()) this.renderUnlock();
    else this.renderSetPin();
  }

  close(): void {
    this.signInListener?.();
    this.signInListener = null;
    this.pin = "";
    this.body.replaceChildren();
  }

  private leave(locked: boolean): void {
    if (locked) void this.opts.helper.send({ type: "admin_lock" }).catch(() => undefined);
    this.close();
    this.opts.onLeave(locked);
  }

  private header(title: string, intro: string): HTMLElement {
    return h(
      "header",
      { class: "panel-header" },
      h("h1", { class: "panel-title", tabindex: "-1" }, title),
      h("p", { class: "panel-intro" }, intro),
    );
  }

  private renderUnlock(): void {
    const input = pinInput("pin", "current-password");
    const slot = h("p", { class: "notice notice-inline", role: "status", hidden: true });
    const unlock = button(H.pinUnlock, () => void submit(), { kind: "primary", icon: icon.check() });
    const submit = async () => {
      if (!input.value) return input.focus();
      unlock.disabled = true;
      setNotice(slot, null);
      try {
        const answer = await this.opts.helper.request({ type: "admin_unlock", pin: input.value });
        if (answer.type === "admin" && answer.unlocked) {
          this.pin = input.value;
          await this.renderSettings();
          return;
        }
        setNotice(slot, answer.type === "admin" ? (answer.text ?? H.pinWrong) : problemText(answer));
        input.select();
      } catch {
        setNotice(slot, T.problem.noAnswer);
      } finally {
        unlock.disabled = false;
      }
    };
    const form = h(
      "form",
      { class: "pin-form", onsubmit: (ev: Event) => (ev.preventDefault(), void submit()) },
      field(H.pinLabel, input, "pin"),
      slot,
      h("div", { class: "form-actions" }, unlock, button(T.files.backToChat, () => this.leave(false), { kind: "secondary", icon: icon.back() })),
    );
    this.body.replaceChildren(h("div", { class: "pin-card" }, avatar("large"), this.header(H.title, H.intro), form));
    input.focus();
  }

  private renderSetPin(): void {
    const first = pinInput("pin-new", "new-password");
    const second = pinInput("pin-repeat", "new-password");
    const slot = h("p", { class: "notice notice-inline", role: "status", hidden: true });
    const save = button(H.pinSave, () => void submit(), { kind: "primary", icon: icon.check() });
    const submit = async () => {
      const problem = this.checkNewPin(first.value, second.value);
      if (problem) return setNotice(slot, problem);
      save.disabled = true;
      setNotice(slot, null);
      try {
        const answer = await this.opts.helper.request({ type: "admin_set_pin", pin: "", newPin: first.value });
        if (answer.type === "admin" && answer.unlocked) {
          this.pin = first.value;
          await this.renderSettings();
          return;
        }
        setNotice(slot, answer.type === "admin" ? (answer.text ?? T.problem.generic) : problemText(answer));
      } catch {
        setNotice(slot, T.problem.noAnswer);
      } finally {
        save.disabled = false;
      }
    };
    const form = h(
      "form",
      { class: "pin-form", onsubmit: (ev: Event) => (ev.preventDefault(), void submit()) },
      field(H.pinNew, first, "pin-new"),
      field(H.pinRepeat, second, "pin-repeat"),
      slot,
      h("div", { class: "form-actions" }, save, button(T.files.backToChat, () => this.leave(false), { kind: "secondary", icon: icon.back() })),
    );
    this.body.replaceChildren(h("div", { class: "pin-card" }, avatar("large"), this.header(H.pinSetTitle, H.pinSetIntro), form));
    first.focus();
  }

  private checkNewPin(a: string, b: string): string | null {
    if (!/^\d{4,12}$/.test(a)) return H.pinTooShort;
    if (a !== b) return H.pinMismatch;
    return null;
  }

  private async renderSettings(): Promise<void> {
    this.body.replaceChildren(h("p", { class: "loading-line" }, H.loading));
    let answer;
    try {
      answer = await this.opts.helper.request({ type: "admin_settings" });
    } catch {
      answer = null;
    }
    if (!answer || answer.type !== "admin_settings") {
      this.body.replaceChildren(h("p", { class: "notice" }, problemText(answer)));
      this.body.append(button(H.done, () => this.leave(true), { kind: "secondary" }));
      return;
    }
    this.renderForm(answer);
  }

  private renderForm(data: HelperMessageOf<"admin_settings">): void {
    const settings = structuredClone(data.settings);
    const notice = h("p", { class: "notice notice-inline", role: "status", hidden: true });

    // Account
    const account = h("section", { class: "settings-section" });
    let signedInNow = data.signedIn;
    const renderAccount = (signedIn: boolean) => {
      signedInNow = signedIn;
      account.replaceChildren(
        h("h2", {}, H.accountTitle),
        h("p", { class: signedIn ? "account-state ok" : "account-state" }, signedIn ? H.signedIn : H.signedOut),
        h(
          "div",
          { class: "form-actions" },
          button(H.signIn, () => void this.signIn(account, notice, renderAccount, () => signedInNow), { kind: signedIn ? "secondary" : "primary" }),
          signedIn ? button(H.signOut, () => void signOut(), { kind: "secondary" }) : null,
        ),
      );
    };
    const signOut = async () => {
      setNotice(notice, null);
      try {
        const answer = await this.opts.helper.request({ type: "admin_sign_out" });
        if (answer.type === "admin_settings") renderAccount(answer.signedIn);
        else setNotice(notice, problemText(answer));
      } catch {
        setNotice(notice, T.problem.noAnswer);
      }
    };
    renderAccount(data.signedIn);

    // Model
    const models = data.models.includes(settings.model) ? data.models : [settings.model, ...data.models];
    const model = h("select", { id: "set-model" }, models.map((m) => h("option", { value: m, selected: m === settings.model }, m)));
    const thinking = h(
      "select",
      { id: "set-thinking" },
      (["off", "low", "medium"] as Thinking[]).map((t) =>
        h("option", { value: t, selected: t === settings.thinking }, H.thinking[t] ?? t),
      ),
    );

    // Features
    const featureBoxes = (Object.keys(settings.features) as (keyof Features)[]).map((key) => {
      const box = h("input", { type: "checkbox", id: `feat-${key}`, checked: settings.features[key] });
      return { key, box, el: h("label", { class: "check", for: `feat-${key}` }, box, h("span", {}, H.features[key] ?? key)) };
    });

    // Limits
    const limitInputs = (Object.keys(settings.limits) as (keyof Limits)[]).map((key) => {
      const input = h("input", { type: "number", id: `limit-${key}`, min: 1, step: 1, value: settings.limits[key], inputmode: "numeric" });
      return { key, input, el: field(H.limits[key] ?? key, input, `limit-${key}`) };
    });

    // PIN change
    const pinA = pinInput("pin-change", "new-password");
    const pinB = pinInput("pin-change-2", "new-password");
    const pinNote = h("p", { class: "notice notice-inline", role: "status", hidden: true });
    const changePin = async () => {
      const problem = this.checkNewPin(pinA.value, pinB.value);
      if (problem) return setNotice(pinNote, problem);
      try {
        const answer = await this.opts.helper.request({ type: "admin_set_pin", pin: this.pin, newPin: pinA.value });
        if (answer.type === "admin" && answer.unlocked) {
          this.pin = pinA.value;
          pinA.value = pinB.value = "";
          setNotice(pinNote, H.pinChanged, "good");
        } else {
          setNotice(pinNote, answer.type === "admin" ? (answer.text ?? T.problem.generic) : problemText(answer));
        }
      } catch {
        setNotice(pinNote, T.problem.noAnswer);
      }
    };

    const save = button(H.save, () => void doSave(), { kind: "primary", icon: icon.check() });
    const doSave = async () => {
      const next: AdminSettings = {
        model: model.value,
        thinking: thinking.value as Thinking,
        features: { ...settings.features },
        limits: { ...settings.limits },
      };
      for (const { key, box } of featureBoxes) next.features[key] = box.checked;
      for (const { key, input } of limitInputs) {
        const n = Number(input.value);
        if (!Number.isInteger(n) || n < 1) {
          input.focus();
          return setNotice(notice, H.limitInvalid(H.limits[key] ?? key));
        }
        next.limits[key] = n;
      }
      save.disabled = true;
      setNotice(notice, null);
      try {
        const answer = await this.opts.helper.request({ type: "admin_save", settings: next });
        if (answer.type === "admin_settings") setNotice(notice, H.saved, "good");
        else setNotice(notice, problemText(answer));
      } catch {
        setNotice(notice, T.problem.noAnswer);
      } finally {
        save.disabled = false;
      }
    };

    this.body.replaceChildren(
      this.header(H.title, H.intro),
      account,
      h(
        "section",
        { class: "settings-section" },
        h("h2", {}, H.modelTitle),
        h("div", { class: "field-grid" }, field(H.modelLabel, model, "set-model"), field(H.thinkingLabel, thinking, "set-thinking")),
      ),
      h("section", { class: "settings-section" }, h("h2", {}, H.featuresTitle), h("div", { class: "checks" }, featureBoxes.map((f) => f.el))),
      h(
        "section",
        { class: "settings-section" },
        h("h2", {}, H.limitsTitle),
        h("p", { class: "panel-intro" }, H.limitsIntro),
        h("div", { class: "field-grid" }, limitInputs.map((l) => l.el)),
      ),
      h(
        "section",
        { class: "settings-section" },
        h("h2", {}, H.pinChangeTitle),
        h("div", { class: "field-grid" }, field(H.pinNew, pinA, "pin-change"), field(H.pinRepeat, pinB, "pin-change-2")),
        pinNote,
        h("div", { class: "form-actions" }, button(H.pinSave, () => void changePin(), { kind: "secondary" })),
      ),
      h("section", { class: "settings-section" }, h("h2", {}, H.folderTitle), h("p", { class: "mono" }, H.folder(this.opts.workspace()))),
      h(
        "div",
        { class: "settings-footer" },
        notice,
        h("div", { class: "form-actions" }, save, button(H.done, () => this.leave(true), { kind: "secondary", icon: icon.back() })),
      ),
    );
    this.el.scrollTop = 0;
    this.body.querySelector<HTMLElement>(".panel-title")?.focus();
  }

  private async signIn(
    account: HTMLElement,
    notice: HTMLElement,
    renderAccount: (signedIn: boolean) => void,
    signedIn: () => boolean,
  ): Promise<void> {
    setNotice(notice, null);
    this.signInListener?.();
    const waiting = h("p", { class: "loading-line" }, H.signInWaiting);
    account.querySelectorAll("button").forEach((b) => (b.disabled = true));
    account.append(waiting);
    const request = this.opts.helper.request({ type: "admin_sign_in" }, 60_000);
    const box = h("div", { class: "sign-in-box", role: "status" });
    this.signInListener = this.opts.helper.on((message) => {
      if (message.type !== "sign_in_done" || message.replyTo !== request.id) return;
      this.signInListener?.();
      this.signInListener = null;
      renderAccount(message.ok);
      account.append(h("p", { class: message.ok ? "notice notice-good" : "notice" }, message.text || (message.ok ? H.signInOk : T.problem.generic)));
      if (message.ok) void this.opts.helper.request({ type: "status" }).catch(() => undefined);
    });
    try {
      const answer = await request;
      if (answer.type === "sign_in_code") {
        box.replaceChildren(
          h("p", { class: "sign-in-instruction" }, H.signInInstruction),
          h("p", { class: "sign-in-url mono" }, answer.url),
          h("p", { class: "sign-in-code", "aria-label": answer.code.split("").join(" ") }, answer.code),
        );
        waiting.before(box);
        return;
      }
      renderAccount(signedIn());
      setNotice(notice, problemText(answer));
    } catch {
      renderAccount(signedIn());
      setNotice(notice, T.problem.noAnswer);
    }
    this.signInListener?.();
    this.signInListener = null;
  }
}
