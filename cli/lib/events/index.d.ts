import type { Page } from "@playwright/test";
import type { Observable } from "rxjs";

/** A single event a previewed component emitted, as recorded by isolate's stream. */
export interface IsolateEvent {
  /** Local time string when the event fired (e.g. "10:30:01 AM"). */
  time: string;
  /** The element that emitted it: `tag` or `tag#id` (e.g. "button#submit"). */
  source: string;
  /** The DOM event type (e.g. "click", "input", "keydown"). */
  type: string;
  /** What it carried: an input/checkbox value, the pressed key, or a label. */
  detail: string;
}

export interface ExpectOptions {
  /** Reject if no matching event arrives within this many ms (default 2000). */
  timeout?: number;
}

/** A live view of the events a previewed component emits, bridged into the test. */
export interface EventBridge {
  /** The raw RxJS stream of every event (buffered + replayable). */
  events$: Observable<IsolateEvent>;
  /**
   * Resolve with the first event matching `predicate` — whether it already fired
   * or fires next; rejects after `opts.timeout` ms (default 2000).
   */
  expect(
    predicate: (e: IsolateEvent) => boolean,
    opts?: ExpectOptions,
  ): Promise<IsolateEvent>;
}

/**
 * Bridge the page's event stream into the test. Call BEFORE `page.goto` so the
 * binding is installed first.
 */
export function capture(page: Page): Promise<EventBridge>;

export interface WaitOptions {
  /** Max ms to wait for hydration (default 5000). */
  timeout?: number;
}

/**
 * Wait until the isolate preview has hydrated and its stage is interactive, so a
 * click is not a silent no-op against SSR markup. Call after `page.goto`, before
 * interacting with an island.
 */
export function waitHydrated(page: Page, opts?: WaitOptions): Promise<void>;
