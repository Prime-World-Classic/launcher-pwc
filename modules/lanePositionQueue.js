// Preserve the last lane click during the server's anti-spam interval.
export class LanePositionQueue {
  constructor({ send, cooldown, onChange, onError, isActive }) {
    Object.assign(this, { send, cooldown, onChange, onError, isActive });
    this.queued = null;
    this.current = null;
    this.nextAt = 0;
    this.timer = null;
    this.disposed = false;
  }

  enqueue(position) {
    if (this.disposed) return;
    this.queued = position === this.current ? null : position;
    this.onChange(this.queued ?? this.current);
    this.flush();
  }

  async flush() {
    if (this.disposed || this.current !== null || this.queued === null) return;
    if (!this.isActive()) return this.dispose();
    clearTimeout(this.timer);
    const wait = this.nextAt - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => this.flush(), wait);
      return;
    }
    this.current = this.queued;
    this.queued = null;
    this.nextAt = Date.now() + this.cooldown;
    this.onChange(this.current);
    try {
      await this.send(this.current);
    } catch (error) {
      this.nextAt = 0;
      if (!this.disposed) this.onError(error);
    } finally {
      this.current = null;
      if (!this.disposed) {
        this.onChange(this.queued);
        this.flush();
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.queued = null;
    clearTimeout(this.timer);
    this.onChange(null);
  }
}
