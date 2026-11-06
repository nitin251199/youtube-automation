import { EventEmitter } from 'node:events';

export type BusMessage = { type: 'job' | 'event'; payload: unknown };
type Listener = (message: BusMessage) => void;

/** In-process fan-out to SSE clients. A multi-instance deployment would swap this for Mongo change streams. */
export class Bus {
  private emitter = new EventEmitter().setMaxListeners(0);
  publish(jobId: string, message: BusMessage) {
    this.emitter.emit(jobId, message);
    this.emitter.emit('*', { ...message, jobId });
  }
  subscribe(jobId: string | '*', listener: Listener) {
    this.emitter.on(jobId, listener);
    return () => { this.emitter.off(jobId, listener); };
  }
}
