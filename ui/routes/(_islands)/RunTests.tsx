import { useSignal } from "@preact/signals";

export default function RunTests({ tests }: { tests: string[] }) {
  const status = useSignal("idle");
  const results = useSignal<{ title: string; ok: boolean; error?: string }[]>(
    [],
  );
  const ok = useSignal<boolean | null>(null);
  const error = useSignal<string | null>(null);

  if (!tests || tests.length === 0) {
    return <span class="iso-run iso-run--none">no tests</span>;
  }

  const run = async () => {
    status.value = "running";
    results.value = [];
    ok.value = null;
    error.value = null;
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tests }),
      });
      const j = await res.json();
      results.value = j.results || [];
      ok.value = !!j.ok;
      // A run with no per-test results carries its reason in j.error — keep it,
      // a bare "✗ error" tells the user nothing about what to fix.
      if (!j.ok && results.value.length === 0) {
        error.value = j.error || ("run failed (HTTP " + res.status + ")");
      }
    } catch (e) {
      ok.value = false;
      error.value = "couldn't reach /api/run — " + ((e as Error).message || e);
    }
    status.value = "done";
  };

  return (
    <span class="iso-run">
      <button
        type="button"
        class="iso-run__btn"
        onClick={run}
        disabled={status.value === "running"}
      >
        {status.value === "running" ? "running…" : "▸ run"}
      </button>
      {status.value === "done"
        ? (
          <span class="iso-run__results">
            {results.value.length
              ? results.value.map((r, i) => (
                <span
                  key={i}
                  class={"iso-dot " + (r.ok ? "ok" : "fail")}
                  title={r.error || r.title}
                >
                  {r.ok ? "✓" : "✗"} {r.title}
                </span>
              ))
              : ok.value
              ? <span class="iso-dot ok">✓ ok</span>
              : (
                <span
                  class="iso-dot fail iso-run__error"
                  title={error.value || "error"}
                >
                  ✗ {(error.value || "error").split("\n")[0]}
                </span>
              )}
          </span>
        )
        : null}
    </span>
  );
}
