import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Ledger, fail, ok } from "./ledger.ts";
import type { LedgerOptions, Result } from "./ledger.ts";

/** Parse bundle text and rebuild the ledger, failing closed on any problem. */
export const parseBundleText = (
  text: string,
  options: LedgerOptions = {},
): Result<Ledger> => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("invalid_input", "The file is not valid JSON.");
  }
  return Ledger.fromBundle(json, options);
};

/**
 * Read a ledger file. A missing file is an empty ledger; an unreadable or
 * invalid file is an error, never a silent fresh start.
 */
export const loadLedger = async (
  path: string,
  options: LedgerOptions = {},
): Promise<Result<Ledger>> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT")
      return ok(new Ledger(options));
    return fail(
      "integrity",
      `Cannot read ${path}: ${(cause as Error).message}`,
    );
  }
  const parsed = parseBundleText(text, options);
  return parsed.ok
    ? parsed
    : fail(
        parsed.error.code,
        `${path} is not a valid ledger: ${parsed.error.message}`,
        parsed.error.path,
      );
};

/**
 * Persists a ledger to one file. Saves are serialized, each writes a complete
 * snapshot taken when the save was requested, and the file is replaced by
 * rename so a reader never sees a partial write. The containing directory is
 * not fsynced, so a host crash immediately after a save can lose that save.
 */
export class LedgerStore {
  readonly path: string;
  readonly #ledger: Ledger;
  #queue: Promise<void> = Promise.resolve();
  #sequence = 0;

  constructor(path: string, ledger: Ledger) {
    this.path = resolve(path);
    this.#ledger = ledger;
  }

  save(): Promise<void> {
    const text = `${JSON.stringify(this.#ledger.toBundle(), null, 2)}\n`;
    const run = this.#queue.then(() => this.#write(text));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #write(text: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${this.#sequence++}.tmp`;
    try {
      const handle = await open(temporary, "wx");
      try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
    } catch (cause) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw cause;
    }
  }
}
