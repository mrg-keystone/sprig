import { cases, problems } from "./manifest.ts";
import type { Case } from "./types.ts";
import RunTests from "./routes/(_islands)/RunTests.tsx";

function group(arr: Case[], key: keyof Case): Record<string, Case[]> {
  const m: Record<string, Case[]> = {};
  for (const x of arr) {
    const k = String(x[key]);
    (m[k] = m[k] || []).push(x);
  }
  return m;
}

const TITLE: Record<string, string> = {
  component: "components",
  page: "pages",
};

export function Gallery({ only }: { only?: "component" | "page" }) {
  const shown = only ? cases.filter((c) => c.target === only) : cases;
  const byTarget = group(shown, "target");
  const order = ["component", "page"];
  const targets = Object.keys(byTarget).sort((a, b) =>
    order.indexOf(a) - order.indexOf(b)
  );
  return (
    <main class="iso-gallery">
      <h1>isolate</h1>
      <p class="iso-sub">
        {only ? <a class="iso-sub__link" href="/">← all</a> : null}
        {only ? " · " : ""}
        {shown.length + " case(s)"}
      </p>
      {problems.length
        ? (
          <section class="iso-problems">
            <h2 class="iso-problems__title">
              ⚠ {problems.length} config problem(s) — these previews are broken
            </h2>
            <ul class="iso-problems__list">
              {problems.map((p) => (
                <li class="iso-problems__row" key={p.path + p.detail}>
                  <code class="iso-problems__path">{p.path}</code>
                  <span class="iso-problems__detail">{p.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )
        : null}
      {targets.length === 0 ? <p class="ctrl-empty">nothing here yet</p> : null}
      {targets.map((target) => {
        const byCat = group(byTarget[target], "category");
        return (
          <section class="iso-target-sec" key={target}>
            <h2 class="iso-target">
              <a href={"/" + TITLE[target]}>{TITLE[target]}</a>
            </h2>
            {Object.keys(byCat).sort().map((cat) => {
              const byFolder = group(byCat[cat], "folder");
              return (
                <details class="iso-zip" open key={cat}>
                  <summary class="iso-zip__head">{cat}</summary>
                  <div class="iso-zip__body">
                    {Object.keys(byFolder).sort().map((folder) => (
                      <details class="iso-zip iso-zip--sub" open key={folder}>
                        <summary class="iso-zip__head">{folder || "—"}</summary>
                        <ul class="iso-cases">
                          {byFolder[folder].map((c) => (
                            <li class="iso-case" key={c.route}>
                              <a class="iso-case__link" href={c.route}>
                                {c.label}
                              </a>
                              <span class={"iso-badge iso-badge--" + c.kind}>
                                {c.kind}
                              </span>
                              <RunTests tests={c.testFiles} />
                            </li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </div>
                </details>
              );
            })}
          </section>
        );
      })}
    </main>
  );
}
