import type { Session } from "../session";

/** Persistence boundary for conversation sessions. */
export interface StorageAdapter {
  saveSession(session: Session): Promise<void>;
  loadSession(sessionId: string): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<boolean>;
}

/** Configuration for the in-process storage adapter. */
export interface InMemoryStorageConfig {
  readonly initialSessions?: readonly Session[];
}

/** Configuration for Node.js JSON-file session persistence. */
export interface FileStorageConfig {
  readonly directory: string;
}
