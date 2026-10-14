// Nothing is ever deleted. Before a file is changed (or restored over), its
// current content is copied into the hidden history folder, and every copy can
// be brought back.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HISTORY_DIR, type Jail } from "./jail.ts";
import { hideFolder } from "./platform.ts";

export type Version = { id: string; name: string; savedAt: number; why: string };

const INDEX = "index.json";
const MAX_VERSIONS = 2000;

export class History {
  private dir: string;

  constructor(private jail: Jail) {
    this.dir = path.join(jail.root, HISTORY_DIR);
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
      hideFolder(this.dir);
    }
  }

  /** Keep a copy of `name` as it is now. Does nothing when the file does not exist. */
  save(name: string, why: string): Version | undefined {
    const absolute = this.jail.resolve(name);
    if (!existsSync(absolute)) return undefined;
    const savedAt = Date.now();
    const id = `${savedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    copyFileSync(absolute, path.join(this.dir, id));
    const version: Version = { id, name: this.jail.relative(absolute), savedAt, why };
    const all = this.list();
    all.unshift(version);
    this.write(all.slice(0, MAX_VERSIONS));
    return version;
  }

  /** Newest first. */
  list(): Version[] {
    try {
      const parsed = JSON.parse(readFileSync(path.join(this.dir, INDEX), "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Put an old version back. The current file is saved first, so this can be undone too. */
  restore(id: string): Version {
    const version = this.list().find((v) => v.id === id);
    if (!version || !/^[a-z0-9-]+$/.test(id)) throw new Error("unknown version");
    const target = this.jail.resolve(version.name);
    this.save(version.name, "vor dem Zurückholen");
    this.jail.ensureParent(target);
    copyFileSync(path.join(this.dir, id), target);
    return version;
  }

  private write(all: Version[]): void {
    writeFileSync(path.join(this.dir, INDEX), JSON.stringify(all, null, 1));
  }
}
