import { filter, firstValueFrom, ReplaySubject, take, timeout } from "rxjs";

// capture(page): bridge the page's event stream into a Node-side RxJS Observable.
// Full typed docs live in index.d.ts (kept as the single source). Call BEFORE
// page.goto. The ReplaySubject is bounded so a long-lived page can't grow it
// without limit — 500 events is far more than any spec inspects.
export async function capture(page) {
  const subject = new ReplaySubject(500);
  await page.exposeBinding(
    "__isolateEmit",
    (_source, evt) => subject.next(evt),
  );
  const events$ = subject.asObservable();
  return {
    events$,
    /** First event matching `predicate` (past or future); rejects after `opts.timeout` ms (default 2000). */
    expect(predicate, opts = {}) {
      return firstValueFrom(
        events$.pipe(filter(predicate), take(1), timeout(opts.timeout ?? 2000)),
      );
    },
  };
}

// waitHydrated(page): resolve once the preview has hydrated and its stage is
// interactive (clicking an island before hydration is a silent no-op against SSR
// markup). Full typed docs live in index.d.ts. Call after page.goto, before interacting.
export async function waitHydrated(page, opts = {}) {
  await page.waitForFunction(
    () => globalThis.__isolateReady === true,
    undefined,
    { timeout: opts.timeout ?? 5000 },
  );
}
