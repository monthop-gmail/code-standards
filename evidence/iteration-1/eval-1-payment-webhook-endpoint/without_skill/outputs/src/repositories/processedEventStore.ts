/**
 * Deduplicates webhook deliveries. Gateways retry aggressively and may deliver
 * the same event id more than once, sometimes concurrently.
 */
export interface ProcessedEventStore {
  /**
   * Atomically claims the event id. Returns false when it was already claimed,
   * meaning this delivery is a duplicate and must be ignored.
   * A DB implementation is a single `INSERT ... ON CONFLICT DO NOTHING`.
   */
  claim(eventId: string): Promise<boolean>;
  /**
   * Releases a claim so a failed delivery can be retried by the gateway.
   * Never called after the order has been updated.
   */
  release(eventId: string): Promise<void>;
}

export class InMemoryProcessedEventStore implements ProcessedEventStore {
  private readonly seen = new Set<string>();

  async claim(eventId: string): Promise<boolean> {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    return true;
  }

  async release(eventId: string): Promise<void> {
    this.seen.delete(eventId);
  }
}
