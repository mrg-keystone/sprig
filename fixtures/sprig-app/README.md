# fixtures/sprig-app

A small **sprig** project used to exercise the isolate workbench. Each folder-component
has an `isolate/` folder declaring its preview cases (the `fixture.json` + `cases/*` JSON +
Playwright `*.spec.ts` are framework-agnostic — copied verbatim from the old Fresh fixture).

```
src/
  components/button/        static component (id, disabled, size, label)
  components/float-button/   static component
  islands/counter/          island with a real `count` signal (+/- buttons)
  pages/login/              static page composition (heading + inputs + buttons)
```

isolate discovers these (folders with `template.html` + an `isolate/` sibling; island ⇔
`logic.ts` present; page ⇔ under `pages/`), generates a sprig preview per case, and serves
them under one `serveSprig` origin — no Vite, no Fresh.
