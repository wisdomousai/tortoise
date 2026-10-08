import type { RunSnapshot, RunStore } from '../types';

/** A run store for tests and hosts that keep no history across restarts. */
export class MemoryRunStore implements RunStore {
  private readonly records = new Map<string, RunSnapshot>();
  async get(id: string) {
    const value = this.records.get(id);
    return value && structuredClone(value);
  }
  async list() {
    return [...this.records.values()].map((value) => structuredClone(value));
  }
  async save(snapshot: RunSnapshot) {
    this.records.set(snapshot.id, structuredClone(snapshot));
  }
}
