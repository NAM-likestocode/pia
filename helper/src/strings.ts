// Every sentence from the helper that she can see. Kept in one place so a test
// can check them for technical words.

export const S = {
  chatWithPhoto: "Gespräch mit Foto",
  activity: {
    list_files: "Ich schaue in deinen Pia-Ordner …",
    read_file: (name: string) => `Ich lese „${name}“ …`,
    write_text_file: "Ich schreibe die Notiz …",
    edit_file: (name: string) => `Ich ändere „${name}“ …`,
    create_document: "Ich schreibe den Brief …",
    create_pdf: "Ich mache das PDF …",
    create_spreadsheet: "Ich mache die Tabelle …",
    create_webpage: "Ich baue die Webseite …",
    open_file: "Ich öffne die Datei …",
    list_older_versions: "Ich schaue nach älteren Versionen …",
    restore_older_version: "Ich hole die ältere Version zurück …",
    open_settings_page: (label: string) => `Ich öffne die Einstellungen für „${label}“ …`,
    computer_info: "Ich schaue kurz im Computer nach …",
    ask_for_bigger_job: "Ich warte auf deine Antwort …",
    other: "Ich bin dabei …",
  },
  problem: {
    signedOut: "Pia ist gerade nicht angemeldet. Bitte frag deinen Sohn, er kann das schnell machen.",
    offline: "Ich komme gerade nicht ins Internet. Ist das WLAN an? Versuch es gleich nochmal.",
    busy: "Ich bin noch mit der letzten Sache beschäftigt. Einen Moment bitte.",
    stoppedTooMuch: "Das war mehr, als ich auf einmal machen darf. Ich habe angehalten. Sag mir gern, was als Nächstes wichtig ist.",
    general: "Da ist etwas schiefgegangen. Versuch es bitte nochmal.",
    fileMissing: "Diese Datei finde ich nicht mehr.",
    cannotOpen: "Diese Datei kann ich nicht öffnen.",
    versionMissing: "Diese ältere Version finde ich nicht mehr.",
    chatMissing: "Dieses Gespräch finde ich nicht mehr.",
    empty: "Schreib mir einfach, wobei ich helfen soll.",
    photosOff: "Fotos sind gerade ausgeschaltet.",
  },
  helper: {
    wrongPin: "Falsche PIN.",
    pinFormat: "Die PIN muss 4 bis 8 Ziffern haben.",
    locked: "Bitte zuerst die PIN eingeben.",
    signInFailed: (detail: string) => `Anmeldung fehlgeschlagen: ${detail}`,
    signedIn: "Angemeldet. Pia ist bereit.",
    tooManyTries: "Zu viele falsche Versuche. Bitte eine Minute warten.",
  },
};
