import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { StorageError, ValidationError } from "../errors";
import { cloneSession, parseSession } from "../session";
import type { Session } from "../session";
import type { FileStorageConfig, StorageAdapter } from "./types";

/**
 * Node.js JSON-file session persistence with atomic writes.
 *
 * Each session occupies one encoded JSON file under the configured directory.
 * It is intentionally a small local adapter, not a database replacement.
 */
export class FileStorage implements StorageAdapter {
  private readonly directory: string;

  constructor(config: FileStorageConfig) {
    if (typeof config !== "object" || config === null) {
      throw new ValidationError("FileStorage configuration must be an object.");
    }
    if (typeof config.directory !== "string" || config.directory.trim().length === 0) {
      throw new ValidationError("FileStorage directory must be a non-empty string.", {
        metadata: { field: "directory" }
      });
    }

    this.directory = resolve(config.directory);
  }

  async saveSession(session: Session): Promise<void> {
    const normalized = cloneSession(session);
    const filePath = this.filePath(normalized.sessionId);
    const temporaryPath = `${filePath}.${randomSuffix()}.tmp`;

    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, JSON.stringify(normalized), {
        encoding: "utf8",
        mode: 0o600
      });
      await rename(temporaryPath, filePath);
    } catch (cause) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new StorageError("FileStorage could not save the session.", {
        cause,
        metadata: { operation: "save", sessionId: normalized.sessionId }
      });
    }
  }

  async loadSession(sessionId: string): Promise<Session | null> {
    assertSessionId(sessionId);

    let contents: string;
    try {
      contents = await readFile(this.filePath(sessionId), "utf8");
    } catch (cause) {
      if (isMissingFileError(cause)) {
        return null;
      }
      throw new StorageError("FileStorage could not load the session.", {
        cause,
        metadata: { operation: "load", sessionId }
      });
    }

    try {
      return parseSession(JSON.parse(contents) as unknown);
    } catch (cause) {
      throw new StorageError("FileStorage found invalid session data.", {
        cause,
        metadata: { operation: "load", sessionId }
      });
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    assertSessionId(sessionId);

    try {
      await rm(this.filePath(sessionId));
      return true;
    } catch (cause) {
      if (isMissingFileError(cause)) {
        return false;
      }
      throw new StorageError("FileStorage could not delete the session.", {
        cause,
        metadata: { operation: "delete", sessionId }
      });
    }
  }

  private filePath(sessionId: string): string {
    return resolve(this.directory, `${encodeURIComponent(sessionId)}.json`);
  }
}

function assertSessionId(sessionId: string): void {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new ValidationError("Session ID must be a non-empty string.", {
      metadata: { field: "sessionId" }
    });
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function randomSuffix(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${process.pid.toString(36)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
