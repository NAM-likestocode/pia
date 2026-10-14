// Every piece of text the window shows lives here.
//
// Rules for everything outside `T.helper`: simple, warm German, "du",
// short sentences and no technical words. tests/ui-strings.test.ts checks
// this. `T.helper` is the settings area for her son and may be a bit more
// technical.

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export const T = {
  appName: "Pia",
  loading: "Pia wird gestartet …",
  restarting: "Pia startet neu … Einen kleinen Moment bitte.",

  top: {
    newChat: "Neues Gespräch",
    files: "Meine Dateien",
    history: "Frühere Gespräche",
    waitUntilDone: "Warte kurz, bis Pia fertig ist.",
  },

  footer: {
    helperLink: "Einstellungen für Helfer",
  },

  welcome: {
    title: "Hallo! Ich bin Pia.",
    question: "Wobei kann ich dir helfen?",
    hint: "Du kannst unten einfach hineinschreiben. Oder du tippst auf einen Vorschlag:",
    suggestions: {
      letter: { label: "Einen Brief schreiben", fill: "Bitte hilf mir, einen Brief zu schreiben. Er geht an " },
      shopping: { label: "Eine Einkaufsliste machen", fill: "Bitte mach mir eine Einkaufsliste. Ich brauche " },
      photo: { label: "Ein Foto erklären lassen", fill: "Was ist auf diesem Foto zu sehen?" },
      settings: {
        label: "Hilfe bei den Einstellungen am Computer",
        fill: "Ich brauche Hilfe am Computer. Ich möchte ",
      },
    },
  },

  chat: {
    logLabel: "Unser Gespräch",
    you: "Du",
    pia: "Pia",
    thinking: "Pia denkt nach …",
    stop: "Anhalten",
    stopping: "Pia hält an …",
    photosAttached: (n: number) => (n === 1 ? "1 Foto dabei" : `${n} Fotos dabei`),
    stoppedNote: "Du hast Pia angehalten.",
  },

  composer: {
    label: "Deine Nachricht an Pia",
    placeholder: "Schreib hier, wobei Pia helfen soll …",
    send: "Senden",
    paused: "Pia macht gerade Pause",
    addPhoto: "Foto hinzufügen",
    removePhoto: "weg",
    removePhotoLabel: (n: number) => `Foto ${n} wieder wegnehmen`,
    photoAlt: (n: number) => `Dein Foto ${n}`,
    photoPreparing: "Das Foto wird vorbereitet …",
    photoProblem: "Dieses Foto konnte ich leider nicht öffnen. Versuch ein anderes.",
    tooManyPhotos: (max: number) => `Es gehen höchstens ${max} Fotos auf einmal.`,
    dropHere: "Lass das Foto hier los.",
    enterHint: "Mit der Taste Enter schickst du die Nachricht ab.",
  },

  files: {
    kinds: {
      brief: "Brief",
      tabelle: "Tabelle",
      webseite: "Webseite",
      bild: "Bild",
      text: "Text",
      pdf: "Dokument",
      andere: "Datei",
    } as Record<string, string>,
    open: "Öffnen",
    opening: "Wird geöffnet …",
    openLabel: (name: string) => `${name} öffnen`,
    title: "Meine Dateien",
    intro: "Hier sind alle Sachen, die Pia für dich gemacht hat.",
    backToChat: "Zurück zum Gespräch",
    openFolder: "Ordner öffnen",
    empty: "Hier ist noch nichts. Wenn Pia etwas für dich macht, findest du es hier.",
    loading: "Einen Moment, ich schaue nach …",
    madeOn: (when: string) => `Zuletzt geändert: ${when}`,
    versionsTitle: "Ältere Versionen",
    versionsIntro: "Pia hebt alte Stände auf. So kannst du nichts kaputt machen.",
    versionsEmpty: "Es gibt noch keine älteren Versionen.",
    savedOn: (when: string) => `Aufgehoben: ${when}`,
    restore: "Zurückholen",
    restoreLabel: (name: string) => `Alte Version von ${name} zurückholen`,
    restored: "Erledigt! Die alte Version ist wieder da.",
  },

  history: {
    title: "Frühere Gespräche",
    intro: "Tipp auf ein Gespräch, um es wieder anzusehen.",
    empty: "Es gibt noch keine früheren Gespräche.",
    loading: "Einen Moment, ich schaue nach …",
    untitled: "Gespräch ohne Namen",
    open: "Ansehen",
  },

  confirm: {
    yes: "Ja, mach das",
    no: "Nein, lieber nicht",
    choseYes: "Du hast gesagt: Ja, mach das.",
    choseNo: "Du hast gesagt: Nein, lieber nicht.",
  },

  pause: {
    defaultText: "Pia hat gerade viel gearbeitet und macht eine kleine Pause.",
    back: "Pia ist wieder da!",
    backHint: "Du kannst jetzt weiterschreiben.",
    lessThanMinute: "Noch weniger als eine Minute",
    remaining: (days: number, hours: number, minutes: number): string => {
      const parts: string[] = [];
      if (days > 0) parts.push(`${days} ${plural(days, "Tag", "Tage")}`);
      if (hours > 0) parts.push(`${hours} ${plural(hours, "Stunde", "Stunden")}`);
      if (minutes > 0 && days === 0) parts.push(`${minutes} ${plural(minutes, "Minute", "Minuten")}`);
      return `Noch ${parts.join(" und ")}`;
    },
    resumeAt: (when: string) => `${when.charAt(0).toUpperCase()}${when.slice(1)} geht es weiter.`,
  },

  dates: {
    months: [
      "Januar",
      "Februar",
      "März",
      "April",
      "Mai",
      "Juni",
      "Juli",
      "August",
      "September",
      "Oktober",
      "November",
      "Dezember",
    ],
    today: (time: string) => `heute, ${time}`,
    yesterday: "gestern",
    dayMonth: (day: number, month: string) => `${day}. ${month}`,
    dayMonthYear: (day: number, month: string, year: number) => `${day}. ${month} ${year}`,
    todayAt: (time: string) => `heute um ${time} Uhr`,
    tomorrowAt: (time: string) => `morgen um ${time} Uhr`,
    dateAt: (date: string, time: string) => `am ${date} um ${time} Uhr`,
  },

  sizes: {
    small: "klein",
    medium: "mittelgroß",
    megabytes: (mb: string) => `${mb} MB`,
  },

  signedOut: {
    title: "Pia ist noch nicht ganz eingerichtet.",
    text: "Bitte frag deinen Sohn, er kann das schnell machen.",
  },

  problem: {
    generic: "Das hat leider nicht geklappt. Versuch es gleich nochmal.",
    noAnswer: "Pia antwortet gerade nicht. Versuch es gleich nochmal.",
  },

  updates: {
    available: "Es gibt eine neue Version von Pia.",
    availableHint: "Das dauert nur einen Moment. Danach startet Pia neu.",
    required: "Pia braucht eine neue Version, damit sie weiter funktioniert.",
    requiredHint: "Tipp einfach auf den Knopf. Danach startet Pia neu.",
    button: "Jetzt aktualisieren",
    starting: "Wird geladen …",
    progress: (percent: number) => `Wird geladen … ${percent} %`,
    installing: "Wird eingerichtet …",
    restarting: "Fertig! Pia startet neu …",
    failed: "Das Aktualisieren hat nicht geklappt. Versuch es später nochmal.",
  },

  // Settings area for her son. Exempt from the plain-words test.
  helper: {
    title: "Einstellungen für Helfer",
    intro: "Dieser Bereich ist für die Person, die Pia eingerichtet hat.",
    pinLabel: "PIN",
    pinUnlock: "Entsperren",
    pinWrong: "Die PIN stimmt nicht.",
    pinSetTitle: "PIN festlegen",
    pinSetIntro: "Lege eine PIN fest, damit nur du diese Einstellungen ändern kannst.",
    pinNew: "Neue PIN",
    pinRepeat: "Neue PIN wiederholen",
    pinMismatch: "Die beiden PINs sind nicht gleich.",
    pinTooShort: "Die PIN braucht mindestens 4 Ziffern.",
    pinSave: "PIN speichern",
    pinChangeTitle: "PIN ändern",
    pinChanged: "Die PIN wurde geändert.",
    done: "Fertig",
    save: "Speichern",
    saved: "Gespeichert.",
    loading: "Lädt …",

    accountTitle: "ChatGPT-Konto",
    signedIn: "Angemeldet.",
    signedOut: "Nicht angemeldet. Pia kann so noch nicht antworten.",
    signIn: "Mit ChatGPT anmelden",
    signOut: "Abmelden",
    signInWaiting: "Warte auf die Anmeldung …",
    signInInstruction: "Öffne diese Adresse auf deinem Handy und gib den Code ein.",
    signInOk: "Anmeldung erfolgreich.",

    modelTitle: "KI-Modell",
    modelLabel: "Modell",
    thinkingLabel: "Nachdenken",
    thinking: {
      off: "Aus (am schnellsten)",
      low: "Ein bisschen (ausgewogen)",
      medium: "Gründlich (langsamer)",
    } as Record<string, string>,

    featuresTitle: "Was Pia darf",
    features: {
      documents: "Briefe und Dokumente erstellen",
      spreadsheets: "Tabellen erstellen",
      webpages: "Webseiten erstellen",
      photos: "Fotos ansehen",
      settingsHelp: "Bei Computer-Einstellungen helfen",
    } as Record<string, string>,

    limitsTitle: "Grenzen pro Anfrage",
    limitsIntro: "Bei größeren Aufgaben fragt Pia vorher nach.",
    limits: {
      filesPerRequest: "Dateien pro Anfrage (ohne Nachfrage)",
      stepsPerRequest: "Arbeitsschritte pro Anfrage (ohne Nachfrage)",
      bigFilesPerRequest: "Dateien pro großer Aufgabe (mit Nachfrage)",
      bigStepsPerRequest: "Arbeitsschritte pro großer Aufgabe (mit Nachfrage)",
      maxFileKB: "Maximale Dateigröße in KB",
    } as Record<string, string>,

    limitInvalid: (label: string) => `${label}: bitte eine ganze Zahl ab 1 eingeben.`,

    folderTitle: "Ordner",
    folder: (path: string) => `Pias Ordner: ${path}`,
  },
};

export type Strings = typeof T;
