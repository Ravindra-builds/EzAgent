import { cloneSession } from "../session";
import type { Session } from "../session";
import { ValidationError } from "../errors";
import type { InMemoryStorageConfig, StorageAdapter } from "./types";

/** A deterministic, process-local session store suited to tests and prototypes. */
export class InMemoryStorage implements StorageAdapter {
  private readonly sessions = new Map<string, Session>();

  constructor(config: InMemoryStorageConfig = {}) {
    if (typeof config !== "object" || config === null) {
      throw new ValidationError("InMemoryStorage configuration must be an object.");
    }

    for (const session of config.initialSessions ?? []) {
      const cloned = cloneSession(session);
      this.sessions.set(cloned.sessionId, cloned);
    }
  }

  async saveSession(session: Session): Promise<void> {
    const cloned = cloneSession(session);
    this.sessions.set(cloned.sessionId, cloned);
  }

  async loadSession(sessionId: string): Promise<Session | null> {
    assertSessionId(sessionId);
    const session = this.sessions.get(sessionId);
    return session === undefined ? null : cloneSession(session);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    assertSessionId(sessionId);
    return this.sessions.delete(sessionId);
  }
}

function assertSessionId(sessionId: string): void {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new ValidationError("Session ID must be a non-empty string.", {
      metadata: { field: "sessionId" }
    });
  }
}
