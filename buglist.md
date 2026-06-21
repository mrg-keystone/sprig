# sprig — adversarial bug hunt

> Found by a loop-until-dry multi-agent hunt: **6 rounds · 167 agents · 93 verified bugs**. Each finding was independently reproduced by a separate verifier before being listed here. Hunters tested the live app over the `/api/*` network channel + `/ui` SSR + `/_assets`, and read the source white-box. **This is a find-only report — nothing was fixed.**

## Summary

| severity | count |
|---|---|
| high | 13 |
| medium | 28 |
| low | 47 |
| info | 5 |
| **total** | **93** |

**By category:** correctness 25, logic 23, rendering 12, protocol 12, crash 6, resource-leak 6, security 4, validation 3, performance 2

---


## HIGH severity

### 1. Deeply-nested but well-formed JSON body causes "Maximum call stack size exceeded" → HTTP 500 (recursion DoS in the input-processing pipeline; not a parser error)
- **severity:** high  ·  **category:** crash
- **area:** API protocol abuse (POST /api/http/* body & method handling)
- **location:** `backend/src/board/entrypoints/http/mod.ts:44-57 (issue/user @Endpoint declare typed input); recursion lives in the @mrg-keystone/keep input pipeline that walks the parsed body BEFORE the RuneAssert/DTO seam; dispatch packages/keep/mod.ts:90-93 forwards /api/* to config.keep.handler`
- **expected:** A client-supplied body that is too deeply nested should be rejected with a 4xx (400 Bad Request / 422), not a 500 Internal Server Error. (And ideally a depth limit should bound the recursion so a tiny request cannot exhaust the call stack.)
- **actual:** The request returns HTTP 500 with body {"status":500,"message":"Maximum call stack size exceeded"}. The keep pipeline recurses over the entire parsed object and blows the stack. A ~1-line request (50k '[' chars) forces stack-exhausting work — a low-cost DoS amplification reachable on every endpoint that declares a typed input DTO (issue, user).
- **repro:**
```
Server already running: `deno serve -A --unstable-kv --port 8200 serve.ts` (cwd = repo root).

# Build a VALID but deeply-nested JSON body (deep nesting under unvalidated key "x")
python3 -c "print('{\"issueId\":\"SPR-101\",\"x\":' + '['*50000 + '0' + ']'*50000 + '}')" > /tmp/deep2.json

# Typed-input endpoints → HTTP 500
curl -s -w '\n[%{http_code}]\n' -X POST http://localhost:8200/api/http/issue \
  -H 'content-type: application/json' --data-binary @/tmp/deep2.json
# → {"status":500,"message":"Maximum call stack size exceeded"} [500]

python3 -c "print('{\"userId\":\"ada\",\"x\":' + '['*50000 + '0' + ']'*50000 + '}')" > /tmp/deepu.json
curl -s -w '\n[%{http_code}]\n' -X POST http://localhost:8200/api/http/user \
  -H 'content-type: application/json' --data-binary @/tmp/deepu.json
# → {"status":500,"message":"Maximum call stack size exceeded"} [500]

# Proof JSON is valid (not a SyntaxError path):
deno eval "const s=await Deno.readTextFile('/tmp/deep2.json'); console.log('parsed ok, issueId=', JSON.parse(s).issueId)"
# → deno parsed ok, issueId= SPR-101

# Control: board has NO input DTO → 200 with the SAME deep body (isolates fault to typed-input path)
curl -s -o /dev/null -w '[%{http_code}]\n' -X POST http://localhost:8200/api/http/board \
  -H 'content-type: application/json' --data-binary @/tmp/deep2.json
# → [200]

# Threshold ~5000 deep still 500; shallow depth-5 same key → 200
python3 -c "print('{\"issueId\":\"SPR-101\",\"x\":' + '['*5000 + '0' + ']'*5000 + '}')" | \
  curl -s -o /dev/null -w '[%{http_code}]\n' -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' --data-binary @-
# → [500]
curl -s -o /dev/null -w '[%{http_code}]\n' -X POST http://localhost:8200/api/http/issue \
  -H 'content-type: application/json' --data '{"issueId":"SPR-101","x":[[[[[0]]]]]}'
# → [200]

# Server recovers per-request:
curl -s -o /dev/null -w '[%{http_code}]\n' -X POST http://localhost:8200/api/http/board -H 'content-type: application/json' --data '{}'
# → [200]
```
- **evidence:**
```
PROOF this is NOT the already-reported malformed-JSON 500 (that path is a JSON SyntaxError on INVALID json). Here the JSON is VALID: (1) Deno's native JSON.parse handles 50k-deep nesting fine — `deno eval` on the same shape printed "parsed ok". (2) The body carries a VALID issueId:"SPR-101" and the deep nesting is under a separate, unvalidated key `x`, yet it still 500s with "Maximum call stack size exceeded" — so it is neither JSON.parse nor issueId validation, but the pipeline recursively walking the whole body. (3) POST /api/http/board (no input DTO) with the SAME 50k-deep body returns 200 and the normal board JSON — because board never walks the request body — isolating the fault to the typed-input processing path. (4) Threshold confirmed at 5000 deep also → 500. Server recovers per-request (subsequent POST /api/http/board → 200), so it is a graceful 500 / DoS, not a permanent crash.
```
- **independent verification:**
```
Independently reproduced against the running server (deno serve, port 8200). A VALID, deeply-nested JSON body sent to any endpoint that declares a typed input DTO returns HTTP 500 {"status":500,"message":"Maximum call stack size exceeded"}.

Verified each distinguishing claim that separates this from the already-known malformed-JSON 500:
1. The JSON is well-formed: both Node (/opt/homebrew/bin/node) and Deno JSON.parse parse the 50k-deep payload successfully and read issueId="SPR-101". So this is NOT a JSON SyntaxError path.
2. The deep nesting sits under a separate, unvalidated key `x`; issueId is valid. Yet /api/http/issue and /api/http/user still 500 — so it is not issueId validation either, but a recursive walk over the whole parsed body.
3. Control case isolates the fault to the typed-input path: /api/http/board (declared with NO input DTO at mod.ts:23) returns 200 with the SAME deep body, while /api/http/issue (input: IssueRefDto, mod.ts:44) and /api/http/user (input: UserRefDto, mod.ts:55) return 500.
4. Shallow control (depth 5, same key) returns 200; threshold confirmed at depth 5000 → 500; deeply-nested objects ({"a":...}) trigger it too, confirming an unbounded recursive walk rather than an array-specific quirk.
5. Server recovers per-request (subsequent POST /api/http/board → 200), so it is a graceful 500 / DoS amplification, not a permanent crash.

Dispatch path is as cited: packages/keep/mod.ts:90-93 strips /api and forwards to config.keep.handler; the recursion lives in @mrg-keystone/keep@1.22.0's input/DTO-binding pipeline that walks the parsed body before the validation seam (the same pipeline that correctly returns 422 for missing issueId, per e2e.test.ts:61-65). A ~10KB request (depth 5000) — or a one-line ~100KB request — forces stack-exhausting work on every typed-input endpoint with no authentication, reachable by any client. Expected behavior is a 4xx (400/422) with a depth bound; actual is a 500.

This is a genuine, reproducible, server-side defect — not intended behavior and not the previously-reported malformed-JSON case. The actual fix belongs in the keep dependency (depth-bounded body traversal returning 4xx); the app's mod.ts is generated and merely exposes the typed-input endpoints that reach it. Severity high: trivially scriptable, unauthenticated DoS amplification, but graceful per-request recovery and no RCE/permanent crash.
```

### 2. Same-basename folder-components collide in the SSR registry, silently clobbering a real component with a stub — board page renders 6 broken cards
- **severity:** high  ·  **category:** rendering
- **area:** Build + cache (ui/.sprig/compiler/build.ts + mod.ts): cache hash, page-island gate, selector collisions, CSS scope-id collision
- **location:** `ui/.sprig/compiler/mod.ts:42-52 (reg.set keyed on basename(dir)); collide between ui/src/shared-components/issue-card/template.html and ui/src/pages/board/components/issue-card/template.html`
- **expected:** The board template `<issue-card [issue]="issue">` should resolve to the rich shared-components/issue-card (icard markup with id/title/priority/tags). The two distinct components live in different folders and should not interfere.
- **actual:** walk() visits shared-components/issue-card FIRST, then pages/board/components/issue-card, and the second `reg.set("issue-card", ...)` overwrites the first. The board page renders 6 copies of the page-local stub `<div class="page-local">PAGE-LOCAL ISSUE CARD OVERRIDE</div>` instead of real issue cards. No build/SSR warning is emitted.
- **repro:**
```
Direct render against the cited code (no live server needed):

1. From repo root /Users/raphaelcastro/Documents/programming/sprig, create reprotest.ts:

   import { createRenderer } from "./ui/.sprig/compiler/mod.ts";
   const r = await createRenderer("/Users/raphaelcastro/Documents/programming/sprig/ui/src", "/ui", {});
   const issue = (id) => ({ id, title: "T-"+id, priority: "high", points: 3, tags: [{label:"bug",tone:"red"}], assignees: ["a"] });
   const board = { project: { name: "Demo", key: "DMO", velocity: 20 }, groups: [
     { column: { id: "todo",  label: "Todo",  wip: 0 }, issues: [issue("1"),issue("2"),issue("3")] },
     { column: { id: "doing", label: "Doing", wip: 0 }, issues: [issue("4"),issue("5"),issue("6")] } ] };
   const html = await r.renderDocument("board", { board });
   console.log("stubs", (html.match(/PAGE-LOCAL ISSUE CARD OVERRIDE/g)||[]).length);
   console.log("icards", (html.match(/class=\"icard\"/g)||[]).length);
   console.log("selectors", r.selectors().filter(s=>s==="issue-card"));

2. Run: /opt/homebrew/bin/deno run -A reprotest.ts

Observed output:
  selectors [ "issue-card" ]   (two folders collapsed to ONE registry key)
  stubs 6
  icards 0

Expected: 6 real shared-component cards (class="icard", icard__id, ...), 0 stubs. Actual: 6 page-local stubs, 0 real cards. Matches the claimed live repro: curl -s http://localhost:8200/ui/board | grep -o 'PAGE-LOCAL ISSUE CARD OVERRIDE' | wc -l -> 6, and zero icard__id / class="icard".

Walk-order verification (the same iteration mod.ts:39 uses) prints shared-components/issue-card/template.html BEFORE pages/board/components/issue-card/template.html, confirming the stub is the last reg.set and wins.
```
- **evidence:**
```
walk order (deno @std/fs/walk over ui/src): shared-components/issue-card/template.html BEFORE pages/board/components/issue-card/template.html. Live: `curl -s http://localhost:8200/ui/board` returns exactly 6 occurrences of 'PAGE-LOCAL ISSUE CARD OVERRIDE' and ZERO occurrences of 'icard__id' / 'class="icard"'. board/template.html:17 uses `<issue-card [issue]="issue">`. mod.ts:41 selector=basename(dir) and mod.ts:52 reg.set(selector, ...) overwrites with no collision check (registry is a plain Map).
```
- **independent verification:**
```
Confirmed by reading the cited code and reproducing the failure by driving createRenderer directly.

Root cause (ui/.sprig/compiler/mod.ts):
- Line 41: `const selector = basename(dir);` keys the registry purely on the folder's basename.
- Line 52: `reg.set(selector, { selector, template, island });` writes into a plain Map<string, ComponentDef> with no existence/collision check. A later component with the same basename silently overwrites an earlier one. No warning is emitted; nothing checks reg.has before set.

Two distinct components share the basename "issue-card":
- ui/src/shared-components/issue-card/template.html (rich card: class="icard", icard__id, icard__title, priority pill, tags via @for)
- ui/src/pages/board/components/issue-card/template.html (one-line stub: <div class="page-local">PAGE-LOCAL ISSUE CARD OVERRIDE</div>)

Walk order: I ran @std/fs/walk over ui/src with the same match (/template\.html$/) used in mod.ts:39 and confirmed shared-components/issue-card is visited BEFORE pages/board/components/issue-card. Therefore the stub's reg.set is the last write and wins.

board/template.html:17 uses `<issue-card [issue]="issue">` inside an @for over the issues, so every issue resolves the tag through the single colliding registry entry — the stub.

This is a genuine defect, not intended behavior. The design (mod.ts:28-30) is "selector = folder name", but it provides no namespacing or collision detection, so two legitimately-distinct folders sharing a name silently corrupt rendering. Severity high: the page is functionally broken (zero real cards) and the failure is silent (no build/SSR error or warning), making it hard to diagnose. Not critical because it does not crash the server or corrupt data.
```

### 3. Selector collision: two folder-components with the same basename silently overwrite each other in the SSR registry (and island build)
- **severity:** high  ·  **category:** correctness
- **area:** Build + cache (ui/.sprig/compiler/build.ts + mod.ts): selector registry collisions across folders
- **location:** `ui/.sprig/compiler/mod.ts:39-54 (reg.set with selector=basename(dir)); ui/.sprig/compiler/build.ts:37-44 (islands.push with sel=basename(dir))`
- **expected:** Two distinct components with the same folder basename must NOT silently collide. Either selectors should be namespaced/scoped (page-local components shadow shared ones within their page, as the literal text "PAGE-LOCAL ISSUE CARD OVERRIDE" implies is intended), or the build/renderer must throw a clear collision error the way assertStaticPage throws for the page-island convention.
- **actual:** Both createRenderer (mod.ts) and buildClient (build.ts) key the registry / island list purely on `basename(dir)` with no duplicate detection anywhere (grep for has(selector)/collision/duplicate/conflict/warn in mod.ts and build.ts returns nothing). The last-walked `issue-card` silently clobbers the first. The documented page-local override (`pages/board/components/issue-card`) never takes effect, and no error or warning is emitted. If both colliding folders were islands, build.ts:43 would also push a duplicate selector into the manifest `islands` array and write a single `isl.issue-card.ts` that only reflects one of them.
- **repro:**
```
1) `find ui/src -name template.html | sort` and `find ui/src -type d -name issue-card` show two folders sharing basename `issue-card`: ui/src/pages/board/components/issue-card and ui/src/shared-components/issue-card. 2) The two templates are completely different components (page-local override div vs. the real parametrized .icard anchor). 3) Reproduce the silent collision end-to-end:
cd ui && /opt/homebrew/bin/deno eval '
import { createRenderer } from "./.sprig/compiler/mod.ts";
import { resolve } from "jsr:@std/path";
const r = await createRenderer(resolve("src"));
console.log("issue-card keys:", r.selectors().filter(s=>s==="issue-card").length); // 1
const html = await r.renderDocument("board", { board:{ project:{name:"X",key:"K",velocity:1}, groups:[{column:{id:1,label:"L",wip:0}, issues:[{id:"A1",priority:"low",title:"T",tags:[],points:1,assignees:[]}]}] } });
console.log("override present:", html.includes("PAGE-LOCAL ISSUE CARD OVERRIDE")); // true
console.log("shared icard present:", html.includes("icard__top")); // false
'
Output: registry holds a single `issue-card` entry; board SSR renders the page-local override and the shared `.icard` card is gone — one of the two distinct components was silently discarded with no error or warning. 4) `grep -rniE "has\(|already|collision|duplicate|conflict|warn" ui/.sprig/compiler/mod.ts ui/.sprig/compiler/build.ts` returns only unrelated comment lines (build.ts:8, build.ts:182), confirming no collision guard. Key code: ui/.sprig/compiler/mod.ts:41 `const selector = basename(dir);` + :52 `reg.set(selector, { selector, template, island });`; ui/.sprig/compiler/build.ts:38-43 `islands.push({ sel: basename(dir), ... })`.
```
- **evidence:**
```
ui/.sprig/compiler/mod.ts:51-53 `reg.set(selector, { selector, template, island }); srcPath.set(selector, entry.path);` keyed on selector=basename(dir) (line 41) with no existence guard. ui/.sprig/compiler/build.ts:43 `islands.push({ sel: basename(dir), ... })` same. Shipped collision confirmed: `ui/src/pages/board/components/issue-card/template.html` (content: `PAGE-LOCAL ISSUE CARD OVERRIDE`) vs `ui/src/shared-components/issue-card/template.html` (the real `.icard` card). grep across both files for has(selector)|already|collision|duplicate|conflict|warn finds no detection logic — only the unrelated comment hits at build.ts:8 and build.ts:182. Note assertStaticPage (mod.ts:111) proves the framework DOES throw on convention violations elsewhere, so the absence of a collision guard is an inconsistency, not a deliberate omission.
```
- **independent verification:**
```
Verified white-box and reproduced end-to-end. The shipped tree has two folders with basename `issue-card`: ui/src/pages/board/components/issue-card/template.html (content: `<div class="page-local">PAGE-LOCAL ISSUE CARD OVERRIDE</div>`) and ui/src/shared-components/issue-card/template.html (the real parametrized `<a class="icard" ...>` card). In createRenderer (mod.ts:39-54) the walk keys the registry purely on `selector = basename(dir)` via `reg.set(selector, ...)` at line 52 with NO existence/collision check. Since `reg` is a Map, the second-walked entry silently overwrites the first. buildClient (build.ts:43) does the identical thing: `islands.push({ sel: basename(dir), ... })` with no dedup, and writes a single `isl.<sel>.ts` + one `islands` manifest entry per basename. I grepped both files for has(|already|collision|duplicate|conflict|warn and found only the two unrelated comment hits at build.ts:8 and build.ts:182 — confirming zero collision detection. Tag resolution goes solely through this map (render.ts:131 `opts.registry.get(tag)`), so the board page's `<issue-card [issue]="issue">` (board/template.html:17) resolves to whichever survived. I instantiated createRenderer against the real src tree and rendered the board page: the registry has exactly one `issue-card` key, its template text resolves to the page-local override, and the rendered board HTML contains "PAGE-LOCAL ISSUE CARD OVERRIDE" and does NOT contain the shared `.icard` markup. This is a genuine defect: two distinct components collapse into one with no error or warning, and the result is order-dependent (walk happens to visit shared-components first, so the page-local folder wins here — but the framework provides no guarantee or diagnostic either way). It is inconsistent with assertStaticPage (mod.ts:111), which DOES throw on a convention violation, showing the framework's own pattern is to fail loudly. Severity high (not critical): it is a correctness/silent-data-loss bug that produces wrong SSR output and a wrong island manifest, but it requires a basename collision to manifest and does not crash or corrupt unrelated components.
```

### 4. Two (event) bindings with the same base event on one element collide — only one is ever reachable
- **severity:** high  ·  **category:** logic
- **area:** Client hydration runtime (ui/.sprig/compiler/hydrate.ts + render.ts handler emission)
- **location:** `ui/.sprig/compiler/render.ts:262-264 (data-sprig-<base> keyed only by base event); ui/.sprig/compiler/hydrate.ts:207-209 (closest+getAttribute resolves a single handler per base)`
- **expected:** Each binding fires for its own key/modifier: Enter -> onEnter(), Escape -> onEscape().
- **actual:** buildAttrs writes plain[`data-sprig-${base}`] = String(handlers.length) once per binding, so the SECOND keyup binding overwrites data-sprig-keyup with its own index and the FIRST handler is orphaned (still pushed into the handlers array but no element references its index). At dispatch, the single delegated keyup listener does t = closest('[data-sprig-keyup]'); h = handlers[Number(t.getAttribute('data-sprig-keyup'))], which can only ever resolve to the LAST keyup binding. Pressing Enter resolves to the escape handler, whose modifiers=['escape'] fail keyMatches, so NOTHING fires for Enter — the enter handler is permanently unreachable. The same happens for any element with multiple same-base bindings (click+click.ctrl, etc.).
- **repro:**
```
Put keyup enter onEnter and keyup escape onEscape on one input, hydrate, press Enter. Expected onEnter. Actual the keyup marker points at escape, the modifier check fails for Enter, nothing fires, onEnter unreachable. Escape still works. Cause render writes one marker per base overwritten by the next, hydrate resolves one index per base.</parameter>
<parameter name="severity">high
```
- **evidence:**
```
render.ts:263 `plain[\`data-sprig-${base}\`] = String(opts.handlers.length)` overwrites on the second same-base binding (single attribute per base, no per-modifier disambiguation). hydrate.ts:207 `closest(\`[data-sprig-${base}]\`)` + :209 `handlers[Number(t.getAttribute(\`data-sprig-${base}\`))]` resolves exactly one index per base. grep confirms data-sprig-<base> is the only handler-lookup key and there is no modifier in the attribute name.
```
- **independent verification:**
```
Confirmed in code. buildAttrs in render keys one plain attribute named by base event only to handlers length, so a second same base binding overwrites it and the first handler is orphaned. hydrate reads one index per base with closest and getAttribute. grep shows the base named attribute is the only lookup key, no modifier. So an input with keyup enter and keyup escape points only at escape; Enter resolves escape, key match fails, nothing fires, enter is unreachable. Same for click and click ctrl. Real defect, high not critical since single and distinct base bindings work.</parameter>
<parameter name="severity">high
```

### 5. Reactive re-render replaces island innerHTML wholesale → focus loss, lost input/scroll/selection state, detached nodes
- **severity:** high  ·  **category:** rendering
- **area:** Client hydration runtime (ui/.sprig/compiler/hydrate.ts): delegation, effect re-render, prop bridge, soft-nav re-arm
- **location:** `ui/.sprig/compiler/hydrate.ts:193-198 (effect → `el.innerHTML = renderNodes(...)`)`
- **expected:** A reactive update should patch only the changed nodes, preserving focus, caret position, selection, scroll position, and any uncontrolled DOM state of unchanged elements.
- **actual:** Every signal write that the render reads re-runs the effect, which does `el.innerHTML = renderNodes(...)`, discarding the entire subtree and replacing it. The focused element is detached; focus, caret, selection, and scroll are lost; the user cannot type continuously into a bound input. Any reference captured to a child element (e.g. the just-clicked button) is now stale/detached.
- **repro:**
```
Setup: an island whose template both reads a signal and binds an input that writes it, e.g.:

  template: `<input (input)="q.set($event.target.value)"> <ul>{{ filtered() }}</ul>`
  logic: q = signal(""); filtered = computed(() => items.filter(i => i.includes(q())))

Because `filtered()` (and thus `q()`) is read inside the render effect (hydrate.ts:193-198), the effect subscribes to q. 

Steps:
1. Load the page; island hydrates — effect runs once, el.innerHTML is set.
2. Click the <input> and type a character.
3. The delegated 'input' listener (el root) runs the handler, calling q.set(...).
4. q changes → the render effect re-fires → `el.innerHTML = renderNodes(...)` (line 196) replaces ALL island children, including the <input> the user is typing in.

Observed: the original <input> is detached; the new one is not focused, so focus is lost, the caret/selection is gone, and the next keystroke does nothing (no focused field). Continuous typing is impossible. Any scrolled child or captured child-element reference is likewise reset/stale.

Expected: a reactive update should patch only changed text/nodes, preserving focus, caret, selection, scroll, and uncontrolled DOM state of unchanged elements (DOM diffing/keyed reconciliation), which this runtime does not implement.
```
- **evidence:**
```
hydrate.ts line 196: `el.innerHTML = renderNodes(nodes, { scope, registry: NO_COMPONENTS, source, handlers: hs, scopeAttr });` inside `effect(() => { ... })` (lines 193-198). renderNodes returns an HTML string; assigning it to innerHTML re-parses and replaces all children on every reactive tick. There is no DOM diffing/patching anywhere in the file.
```
- **independent verification:**
```
Verified directly against the cited code. ui/.sprig/compiler/hydrate.ts:193-198 wraps the island render in effect(() => { ... el.innerHTML = renderNodes(...) ... }). Confirmed facts:

1. render.ts:61 `export function renderNodes(nodes, opts): string` returns an HTML STRING (the file header explicitly says "walks a parsed template AST → an HTML string"). Assigning a string to el.innerHTML re-parses and replaces every child node.

2. core.ts:17-18 re-exports `effect` straight from @preact/signals-core, and signal() (core.ts:33-41) wraps @preact/signals-core signals. This is standard fine-grained reactivity: effect tracks every signal read during its run and re-runs when ANY tracked signal is written. renderNodes reads every signal the template interpolates, so the render effect depends on all of them.

3. Therefore every write to any signal the template reads re-fires the effect, executing `el.innerHTML = renderNodes(...)` — the entire island subtree is discarded and rebuilt from scratch on every reactive tick.

4. There is no DOM diff/patch path anywhere in hydrate.ts or render.ts. The only mutation is full innerHTML replacement (the same pattern is even used for soft-nav at line 162). Event handling is rebuilt each render (handlers = hs at line 197) and works only because listeners are delegated on the persistent island root via data-sprig-* indices — confirming the children themselves are routinely replaced.

Consequence is exactly as claimed: the focused element (e.g. a bound <input> whose (input) handler writes a signal the template reads — a search/filter box, controlled input, live-validated field) is detached and recreated on each keystroke, losing focus, caret position, text selection, and uncontrolled state (scroll position of a scrolled child, partially-expanded <details>, in-flight IME composition). Any JS reference captured to a child (the just-clicked button) becomes stale/detached. Continuous typing into a bound input is broken.

This is not working-as-designed: the file's own comment (lines 10-12) frames innerHTML re-render as the intended mechanism, but that is the source of the defect, not a justification for it — wholesale subtree replacement on reactive update is a real correctness bug for any interactive island, which is the entire purpose of hydration. Severity high (not critical): it does not crash or corrupt data, and trivial click-only islands that never re-render a focused/scrolled subtree are unaffected; but the central use case (interactive form inputs in islands) is broken.
```

### 6. Delegated event listeners are wired only for event types present in the FIRST render; bases that appear only after a state change are never delegated
- **severity:** high  ·  **category:** logic
- **area:** Client hydration runtime (ui/.sprig/compiler/hydrate.ts): delegation, effect re-render, prop bridge, soft-nav re-arm
- **location:** `ui/.sprig/compiler/hydrate.ts:200-216 (`wire()` called once) vs effect rebuilding `handlers` at 193-198`
- **expected:** Handlers introduced by a later render should receive their delegated listener; the (input)/(submit)/etc. handler should fire.
- **actual:** `wire()` runs exactly once (line 216) in production (non-HMR), iterating only over the bases present in the initial `handlers` snapshot and recording them in `wired`. After a re-render adds a handler with a base not seen initially, `wire()` is never re-invoked (it is only re-called inside the HMR `swap`, gated by `hmrEnabled`). No `addEventListener` is ever attached for that base, so the event silently does nothing.
- **repro:**
```
Authoring repro (island template):

  state: open = signal(false)  // initially false

  template:
    <button (click)="open.set(!open())">toggle</button>
    @if (open()) {
      <input (input)="onInput($event)" />
    }

Note: `click` is the only event base in the initial render (the button). `input` appears only inside the hidden @if.

Steps (production build, hmrEnabled=false):
1. SSR renders with open=false → island hydrates. hydrateIsland runs the effect once: `handlers` contains only the click handler (base "click"). wire() attaches a delegated "click" listener on the island root; wired = {"click"}.
2. Click the toggle button → open.set(true). The effect re-renders, el.innerHTML now contains <input data-sprig-input="0">, and `handlers` now contains the input handler (base "input").
3. wire() is NOT re-called (line 216 already ran; line 226 is HMR-gated). No "input" listener is ever added to the island root.
4. Type in the revealed <input>. The browser fires an `input` event, but there is no delegated listener on the island root for "input", so onInput never runs. Silent no-op.

Expected: onInput fires. Actual: nothing happens.

Contrast: under HMR (enableHmr() called at startup), the swap() path at hydrate.ts:222-227 re-calls wire(), which would attach the missing "input" listener — proving the prod path is the regression.

Fix direction: call wire() inside the render effect (after `handlers = hs`) in all modes, not just on HMR swap, so any event base introduced by a re-render gets its delegated listener. (wire() already de-dupes via the `wired` set, so calling it on every render is safe/idempotent.)

Code evidence: ui/.sprig/compiler/hydrate.ts:216 (sole prod wire() call), :218-229 (HMR-gated re-wire), :202-215 (wire body), :193-198 (effect rebuilding handlers); ui/.sprig/compiler/render.ts:258-265 (handlers/markers emitted only for rendered elements), :349-368 (hidden @if renders nothing).
```
- **evidence:**
```
hydrate.ts line 216 `wire();` is the only non-HMR call. `wire()` (202-215) skips any base already in `wired` and never observes later `handlers` arrays except via re-invocation. The re-invocation at line 226 is inside `if (hmrEnabled && tick)` (lines 218-229). `@preact/signals-core` `effect` (core.ts:18) runs synchronously, so the initial `handlers` is populated before `wire()`, confirming `wire()` only ever sees first-render bases in prod.
```
- **independent verification:**
```
Verified by reading the cited code.

Mechanics confirmed:
1. render.ts:258-265 — an (event) binding only pushes a Handler and emits its `data-sprig-${base}` marker when the element is actually rendered. An (event) inside a hidden `@if` block is not rendered (renderIf returns "" when the condition is false, render.ts:349-351), so its `base` never enters the `handlers` array.
2. hydrate.ts:193-198 — the effect rebuilds the `handlers` table on every render (synchronously; @preact/signals-core effect runs the body immediately on creation, so the FIRST `handlers` snapshot exists before wire() runs).
3. hydrate.ts:201-216 — `wire()` iterates `new Set(handlers.map(h => h.base))`, and for each base not already in `wired`, attaches ONE delegated `el.addEventListener(base, ...)`. The listener body looks up the live handler dynamically (line 209: `handlers[Number(t.getAttribute(...))]`), so once a base is wired it keeps working across re-renders — but only for bases that already had a listener.
4. hydrate.ts:216 — `wire()` is called exactly once in production. The ONLY re-invocation is hydrate.ts:226, inside `if (hmrEnabled && tick)` (line 218), i.e. dev/HMR only. Its own comment ("attach listeners for any event types the new template introduced") confirms the authors knew a re-render can introduce new event types and that wire() must re-run to catch them — yet this re-run is gated to HMR.

Consequence: In production (hmrEnabled=false), if an event base type appears in zero elements of the initial render and only in a block revealed by a later signal change, `wire()` is never re-called, so no addEventListener is ever attached for that base. The element's data-sprig-* marker is emitted but no delegated listener exists on the island root to dispatch it — the handler silently never fires.

Precondition (correctly stated in the claim): the base must be absent from the entire initial render. If any visible element already used that base, the listener exists and the dynamic lookup at line 209 would pick up the newly revealed handler fine. So the bug is real but scoped to "new base type introduced by a later render."

This is not working-as-designed: the HMR-path re-wire and its comment show the intended contract is that newly-introduced event types get listeners; the prod path violates that contract. Severity high (not critical) because it requires a specific authoring pattern — a conditionally revealed element carrying the only instance of its event type — but that pattern is common (a `(submit)` form shown only when editing, an `(input)`/`(change)` field shown only when a panel expands), and the failure is silent with no error.
```

### 7. Keyboard modifier-key combos in (event) bindings never fire — keyMatches() compares each modifier against the single event.key, so documented bindings like (keyup.control.enter) are dead
- **severity:** high  ·  **category:** logic
- **area:** Client hydration runtime — event delegation key-modifier matching (ui/.sprig/compiler/hydrate.ts)
- **location:** `ui/.sprig/compiler/hydrate.ts:246-250 (KEY_ALIAS + keyMatches); handler split at ui/.sprig/compiler/render.ts:262; documented feature at angular-html-features.md:114`
- **expected:** Per the framework's own docs (angular-html-features.md:114 shows `<div (keyup.control.enter)="send()">…</div>` as a supported binding, mirroring Angular), modifier-key combos should fire when the modifier key(s) are held AND the main key matches — keyMatches should test e.ctrlKey/shiftKey/altKey/metaKey for control/shift/alt/meta tokens and only compare the remaining token against e.key.
- **actual:** Any (event.modifier) where one of the modifiers is a chord modifier key (control/ctrl/shift/alt/meta) can NEVER match, because keyMatches requires the single e.key to equal every modifier token. The handler is registered and tagged in the DOM (data-sprig-<base>) but is permanently unreachable. Single-modifier key bindings like (keyup.enter) still work; only multi-key/chord combos and modifier-key tokens are broken.
- **repro:**
```
1. Author an island template with a chord-key handler, e.g. `<div (keyup.control.enter)="send()">…</div>` (this exact form is documented at angular-html-features.md:114), or `<button (click.shift)="x()">`.
2. Hydrate the island and press Ctrl+Enter (or Shift+click).
3. Observe send() never runs.

Minimal isolation of the actual gating code (ui/.sprig/compiler/hydrate.ts:246-250):
```
const KEY_ALIAS = { enter:"enter", escape:"escape", space:" ", tab:"tab", esc:"escape" };
function keyMatches(e, mods){ const key=e.key?.toLowerCase(); return mods.every(m => key === (KEY_ALIAS[m] ?? m)); }
keyMatches({key:"Enter", ctrlKey:true}, ["control","enter"]); // => false  (handler dropped)
keyMatches({key:"Enter"}, ["enter"]);                         // => true   (single-key still works)
```
The first call models the real Ctrl+Enter keyup event and returns false because it requires e.key to equal both 'control' and 'enter' at once. Verified by running the snippet.
```
- **evidence:**
```
hydrate.ts:247-250 — `const key = (e as KeyboardEvent).key?.toLowerCase(); return mods.every((m) => key === (KEY_ALIAS[m] ?? m));` (mods has 2+ entries for a chord → mutually exclusive equality checks). hydrate.ts:246 — `const KEY_ALIAS = { enter, escape, space:' ', tab, esc:escape }` has no control/shift/alt/meta. render.ts:262 — `const [base, ...modifiers] = name.split('.')` produces multi-element modifiers for chords. angular-html-features.md:114 documents `(keyup.control.enter)` as supported. grep for ctrlKey/shiftKey/altKey/metaKey across ui/.sprig/compiler/*.ts returns no matches, confirming modifier-key state is never consulted. (Live server unreachable for curl — URL resolves to literal 'undefined', HTTP 000 — so confirmed white-box; the defect is in pure client logic with no server dependency.)
```
- **independent verification:**
```
Verified white-box against the cited code and reproduced the gating logic in isolation.

render.ts:262 splits the binding name on '.': for `(keyup.control.enter)` it yields base='keyup', modifiers=['control','enter']. The handler is stored with those modifiers (render.ts:263-264) and tagged in the DOM via data-sprig-keyup.

The delegated keyup listener (hydrate.ts:206-213) gates each fire on `keyMatches(e, h.modifiers)` at line 210. keyMatches (hydrate.ts:247-250) computes `key = e.key.toLowerCase()` — a single value (e.g. 'enter') — then returns `mods.every(m => key === (KEY_ALIAS[m] ?? m))`. For ['control','enter'] this demands key === 'control' AND key === 'enter' simultaneously, which is impossible, so it always returns false and the handler body never runs.

KEY_ALIAS (hydrate.ts:246) has only enter/escape/space/tab/esc — no control/ctrl/shift/alt/meta. A grep across ui/.sprig/compiler/*.ts for ctrlKey/shiftKey/altKey/metaKey returns zero matches, confirming the chord-modifier state on the KeyboardEvent is never consulted.

I reproduced the exact gate: simulating a Ctrl+Enter keyup event ({key:'Enter', ctrlKey:true}), keyMatches(e, ['control','enter']) returns false, while the single-modifier keyMatches({key:'Enter'}, ['enter']) returns true. So single-key bindings work but any multi-token binding (including every chord that uses control/shift/alt/meta) is permanently dead.

This contradicts the framework's own documentation (angular-html-features.md:114) which lists `<div (keyup.control.enter)="send()">…</div>` as a supported binding. It is therefore a genuine logic defect, not intended behavior: the documented feature is registered, tagged in the DOM, but unreachable. Severity high (not critical) is appropriate — it silently breaks a documented interactive feature but does not crash or corrupt data, and single-key bindings still function.

The correct fix: in keyMatches, treat control/ctrl/shift/alt/meta tokens as predicates over e.ctrlKey/e.shiftKey/e.altKey/e.metaKey, and only compare the remaining (non-modifier) token against e.key.
```

### 8. Page reload is intercepted and downgraded to a partial outlet swap — state never resets, document never reloads
- **severity:** high  ·  **category:** logic
- **area:** Soft navigation (setupSoftNav in ui/.sprig/compiler/hydrate.ts)
- **location:** `ui/.sprig/compiler/hydrate.ts:144-148 (the navigate-event filter in setupSoftNav)`
- **expected:** A reload (navigationType === 'reload') must perform a real document reload: re-fetch the whole page, re-run the full lifecycle, and reset every island (including those OUTSIDE the outlet) to its SSR initial state. The counter outside the outlet should return to 0.
- **actual:** setupSoftNav intercepts the reload because it only excludes hashChange/downloadRequest/formData and same-origin/base checks; it never checks e.navigationType. The handler fetches the page, swaps ONLY <sprig-outlet> innerHTML, and leaves islands outside the outlet mounted with stale state. After navigation.reload(), the counter stayed at 3 (proven live); a real reload reset it to 0. So 'reload' silently becomes a no-op partial swap and the user's reload does not reload the page.
- **repro:**
```
Against the running app at http://localhost:8200/ui/board in a Navigation-API browser (Chromium):

1. Navigate to http://localhost:8200/ui/board. The counter island lives in the header, OUTSIDE <sprig-outlet>; it starts at 0.
2. Click the counter '+' button a few times (with small gaps so each re-render settles) to set the value to a clear non-zero number (e.g. 4). Optionally tag the island element: `document.querySelector('sprig-island[data-sel=\"counter\"]').__instanceTag = 'X'`.
3. Trigger the browser-reload path via the Navigation API: `await navigation.reload().finished`.
4. Observe: counter still shows the same number (4, not 0), and the island is the SAME element (__instanceTag still 'X') — the document was never reloaded; only the <sprig-outlet> innerHTML was swapped.
5. Contrast: do a real full document load (browser hard reload / page.goto to the same URL). The counter resets to 0 and __instanceTag is gone — proving the expected reset only happens on a genuine reload, which the soft-nav handler suppresses.

Root cause: ui/.sprig/compiler/hydrate.ts:145 — `if (!e.canIntercept || e.hashChange || e.downloadRequest || e.formData) return;` lacks `|| e.navigationType === 'reload'`, and the swap at hydrate.ts:161-165 replaces only the outlet's innerHTML. Confirmed in the served bundle chunk-UQEYE25X.js (navigationType/reload appear 0 times).
```
- **evidence:**
```
Live Playwright: navigation.reload() -> counter value 'before'=3, 'after'=3, island still present; immediately after, a real page.reload() -> counter value '0'. Source: hydrate.ts:145 `if (!e.canIntercept || e.hashChange || e.downloadRequest || e.formData) return;` has no `|| e.navigationType === 'reload'` guard, and the swap() at hydrate.ts:161-165 only replaces the outlet's innerHTML.
```
- **independent verification:**
```
Confirmed both in source and live against the running app on :8200.

SOURCE: In ui/.sprig/compiler/hydrate.ts the navigate handler (lines 144-148) filters only on `!e.canIntercept || e.hashChange || e.downloadRequest || e.formData` plus same-origin/base-path checks. There is NO `e.navigationType === "reload"` guard. A Navigation-API reload (the path the browser reload button and location.reload() take) fires a `navigate` event with navigationType==="reload", canIntercept===true, no hashChange/downloadRequest/formData, same origin, pathname under /ui — so it passes every filter and gets e.intercept()'d. The intercept handler (lines 161-165) only does `cur.innerHTML = next.innerHTML` for `<sprig-outlet>`, then re-arms islands inside the outlet. Islands OUTSIDE the outlet are never touched, so their reactive scope (signals = state) is preserved.

I verified this is the LIVE served runtime, not just a stale source file. The served /ui/_assets/client.js entry is `t(n),e(n)` = bootstrapIslands(cfg)+setupSoftNav(cfg) (single-arg, matching current hydrate.ts; the stale client-entry.gen.ts on disk is NOT what is served). The real soft-nav code lives in the served chunk-UQEYE25X.js, whose navigate filter is verbatim `if(!n.canIntercept||n.hashChange||n.downloadRequest||n.formData)return;` — grep counts: navigationType=0, reload=0. So the missing guard exists in the actually-shipped bundle.

DOM PRECONDITION: SSR of /ui/board places the counter <sprig-island data-sel="counter"> inside <header>, OUTSIDE <sprig-outlet> (confirmed via curl and via Playwright: outlet does not contain the island). So an outlet-only swap cannot reset it.

LIVE REPRO (Playwright, Chromium with Navigation API present): tagged the island element with a custom JS property __instanceTag, clicked + to reach counter=4, then `await navigation.reload().finished`. Result: before=4, after=4; sameInstance=true (same __instanceTag survived); url unchanged. The custom JS property surviving proves the document was never reloaded — only the outlet innerHTML was (or would be) swapped, and the out-of-outlet island stayed the exact same live instance with stale state. CONTRAST: a genuine full document load (page.goto) reset the counter to 0 and wiped __instanceTag (island remounted from SSR initial state).

So a user/browser-initiated reload is silently downgraded to a partial outlet swap: the document never reloads and out-of-outlet island state never resets. This is a genuine logic defect (working-as-designed is explicitly the opposite: a reload must re-run the full lifecycle). Severity high (not critical): it does not crash or corrupt data, and outlet content is still re-fetched, but it breaks the fundamental contract of "reload" — stale global UI state persists, and any reload-to-recover-from-bad-state workflow fails.

FIX direction: add `|| e.navigationType === "reload"` to the early-return filter (and arguably also bail on "traverse" if full-fidelity history restoration is desired), so reloads fall through to native browser navigation.
```

### 9. Multi-statement (event) handlers silently drop every statement after the first
- **severity:** high  ·  **category:** logic
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts + render.ts): pipes, statement evaluator, assignment targets, number formatting
- **location:** `ui/.sprig/compiler/expr.ts:214-225 (evalStatement); ui/.sprig/compiler/render.ts:264 (handler collection); grammar: tree-sitter-angular-template/grammar.js:177,375 (_event_body = sep1(";", ...))`
- **expected:** Both statements execute: open=true AND count incremented (Angular runs every ';'-separated statement in the event body).
- **actual:** Only the FIRST statement runs. `_event_body` is a HIDDEN rule, so `field(attr,'handler')` (render.ts:264 and the node passed to evalStatement) resolves to only the FIRST statement node (childForFieldName returns a single child). evalStatement's `single` check (expr.ts:216-217) then sees type 'assignment'/'call_expression'/'*_expression' → single=true → iterates `[handler]` only. The `else` branch `_named(handler)` is unreachable for this case, and even if reached it would iterate the first statement's OWN operands (left/right), never the sibling statements. So statements 2..n are permanently dropped on both server and client.
- **repro:**
```
1. In a sprig template author a multi-statement event handler, e.g. `<button (click)="open = true; count = count + 1">x</button>`.
2. Parse it with the grammar and inspect: the event_binding has namedChildren [binding_name, assignment, assignment] (both statements present), but field(node,"handler") returns only the first assignment ("open = true").
3. evalStatement (expr.ts:214) sees handler.type==="assignment" => single=true => loops over [handler] only => executes "open = true" and never "count = count + 1".

Empirical script run (cwd ui/.sprig/compiler), using parse.ts + node.ts:
```
import { parseTemplate } from "./parse.ts";
import { field, named } from "./node.ts";
const root = await parseTemplate(`<button (click)="open = true; count = count + 1">x</button>`);
// walk to event_binding -> ev
const handler = field(ev, "handler");
const single = handler.type==="assignment"||handler.type==="call_expression"||handler.type==="identifier"||handler.type.endsWith("_expression");
const stmts = single ? [handler] : named(handler);
console.log(stmts.map(s=>s.text)); // => [ "open = true" ]  (second statement dropped)
```
Output confirmed: handler.text = "open = true"; statements executed = ["open = true"]; "count = count + 1" dropped.
```
- **evidence:**
```
grammar.js:375 `_event_body: ($) => sep1(";", choice($.assignment, $._expression))` with sep1 = seq(rule, repeat(seq(sep, rule))) (grammar.js:35) — proves multiple statements are grammatical. expr.ts:216 `const single = handler.type === "assignment" || ... || handler.type.endsWith("_expression")` always true for a statement node, so the loop body `single ? [handler] : _named(handler)` only ever runs the one node the `handler` field points at. The function's own doc comment (expr.ts:210-213) admits it only handles 'the common single-statement case'.
```
- **independent verification:**
```
Verified empirically by building/parsing with the actual grammar.wasm and inspecting the AST. For the template <button (click)="open = true; count = count + 1">, the parser produces an event_binding whose namedChildren are [binding_name "click", assignment "open = true", assignment "count = count + 1"] — i.e. _event_body (a HIDDEN rule, grammar.js:375 `_event_body: sep1(";", choice($.assignment, $._expression))`) is inlined into the event_binding, so both statements are real sibling children.

However, field(ev, "handler") (childForFieldName) returns ONLY the first node: type "assignment", text "open = true". This is the exact node render.ts:264 pushes as h.body and that hydrate.ts:212 passes to evalStatement. Inside evalStatement (expr.ts:214-225), `single` = (type==="assignment" || ... || type.endsWith("_expression")) evaluates to true for that node, so the loop iterates `[handler]` only — executing just "open = true". The second statement "count = count + 1" is never referenced anywhere and is permanently dropped, on both SSR and client hydration (they share the field()/named() node API in node.ts).

The else branch `_named(handler)` is unreachable for ordinary statement nodes, and even if reached it would iterate the first statement's own operands (left/right), not the sibling statements — so it could never recover statements 2..n. The function's own doc comment (expr.ts:210-213) concedes it only handles "the common single-statement case." The grammar explicitly admits ';'-separated multi-statement bodies, so a developer writing valid, grammatical Angular-style handler syntax gets silent data loss with no error. That is a genuine logic defect, not intended behavior. Severity high is appropriate: silent, no error, affects any multi-statement handler, and matches Angular's documented behavior expectation (all ';'-separated statements run).

Empirical output captured:
event_binding namedChildren types: [ "binding_name", "assignment", "assignment" ]
handler.type: assignment ; handler.text: "open = true"
single = true ; statements that WOULD execute: [ "open = true" ]
```

### 10. Multi-argument pipes silently drop all but one argument (slice:a:b broken); the all-args collection branch is dead code
- **severity:** high  ·  **category:** correctness
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts + serialize.ts) — pipe argument handling
- **location:** `ui/.sprig/compiler/expr.ts:139-141 (evalPipe)`
- **expected:** `items | slice:1:3` passes args [1,3] to the slice pipe → `items.slice(1,3)`.
- **actual:** Only args[0]=1 is passed → PIPES.slice does `items.slice(1, undefined)` (slices to the end), ignoring the second argument. Any pipe taking 2+ args (slice today, and any future multi-arg pipe) receives a truncated, single-element args array; the documented all-args collection path can never run.
- **repro:**
```
In the repo root, run a script that parses `{{ items | slice:1:3 }}` with parseTemplate, finds the pipe_expression node, and evals it with scope { items: [10,20,30,40,50] }:

```ts
import { parseTemplate } from "./ui/.sprig/compiler/parse.ts";
import { evalExpr } from "./ui/.sprig/compiler/expr.ts";
import { named } from "./ui/.sprig/compiler/node.ts";
function findType(n:any,t:string):any{ if(n.type===t)return n; for(const c of n.namedChildren){ if(!c)continue; const r=findType(c,t); if(r)return r;} return null; }
const root = await parseTemplate(`{{ items | slice:1:3 }}`);
const pipe = findType(root, "pipe_expression");
console.log(pipe.childForFieldName("argument").type);                 // pipe_argument (first child)
console.log(named(pipe).filter((c:any)=>c.type==="pipe_argument").length); // 2 args present
console.log(JSON.stringify(evalExpr(pipe, { items:[10,20,30,40,50] }))); // [20,30,40,50]  (BUG)
// expected items.slice(1,3) === [20,30]
```

Observed output (verified with `deno run -A`):
- childForFieldName('argument') type: pipe_argument
- number of pipe_argument children: 2
- eval result: [20,30,40,50]
- expected: [20,30]

The second argument (3) is silently dropped; slice runs as items.slice(1, undefined).

Fix: collect all args unconditionally, e.g. `const args = named(node).filter((c)=>c.type==="pipe_argument").map((c)=>evalExpr(named(c)[0], scope));` (drop the childForFieldName branch entirely).
```
- **evidence:**
```
expr.ts:139 `const args = node.childForFieldName("argument") ? [evalExpr(named(node.childForFieldName("argument"))[0], scope)] : named(node).filter(...).map(...)`; grammar.js:494 `repeat(field("argument", $.pipe_argument))` (web-tree-sitter childForFieldName returns the FIRST child for a repeated field name); PIPES.slice at expr.ts:152 `(v,a)=>(v).slice(a[0], a[1])` shows a[1] is intended to be the second arg but is never supplied.
```
- **independent verification:**
```
Confirmed by reproduction against the real wasm-compiled grammar and the actual evalExpr. The grammar (tree-sitter-angular-template/grammar.js:494) emits multiple pipe args as `repeat(field("argument", $.pipe_argument))`, so every pipe_argument child shares the field name "argument". In evalPipe (ui/.sprig/compiler/expr.ts:139-141), `node.childForFieldName("argument")` is truthy whenever ANY argument exists, and web-tree-sitter returns the FIRST matching child. So execution ALWAYS takes branch 1, which builds `args` from only that first argument: `[evalExpr(named(node.childForFieldName("argument"))[0], scope)]`. The second branch (`named(node).filter(c=>c.type==="pipe_argument").map(...)`) that collects ALL pipe_argument children is only reachable when no "argument" field exists at all — i.e. it is unreachable dead code.

My repro of `items | slice:1:3` with items=[10,20,30,40,50] proved: childForFieldName('argument') returns the first pipe_argument ("1"); there are 2 pipe_argument children present ("1","3"); but eval produced [20,30,40,50] (= items.slice(1, undefined)) instead of the expected [20,30] (= items.slice(1,3)). PIPES.slice at expr.ts:152 is `(v,a)=>(v).slice(a[0], a[1])`, confirming a[1] is intended to be the second arg but is never supplied. This is a genuine correctness defect affecting slice today and any future 2+ arg pipe, not intended behavior.
```

### 11. Unbalanced ( ) [ or ] inside an attribute-selector string value silently un-scopes the rest of the component's stylesheet (and everything concatenated after it in app.css)
- **severity:** high  ·  **category:** correctness
- **area:** View encapsulation (ui/.sprig/compiler/scope.ts) — CSS selector scoper
- **location:** `ui/.sprig/compiler/scope.ts:46-55 (processBlock prelude scan) and scope.ts:59-62 (j>=n emit path); reached from build.ts:130 (scopeCss per component) and concatenated into shared app.css at build.ts:146`
- **expected:** Both rules scoped: `[aria-label="Close )"][s12345678] { color: red }` and `.other[s12345678] { color: green }`. The string context of an attribute value must be ignored when scanning for selector/rule terminators.
- **actual:** Output is byte-for-byte the INPUT, completely unscoped: `[aria-label="Close )"] { color: red }\n.other { color: green }` — neither rule receives the scope marker. The lone `)` in the attribute string drives `dp` to -1 in the prelude scan (line 50), so the `dp===0` guard on line 53 never fires, the `{` is never recognized as a rule terminator, the scan runs to EOF (`j>=n`), and lines 59-62 emit the entire remaining stylesheet verbatim with NO scoping. A stray `(` ( `[data-x="("]` ) does the same by pinning `dp` at 1; a `[` or `]` in a value does it via `db`.
- **repro:**
```
1. From repo root, create /tmp/repro.ts:

import { scopeCss } from "/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts";
for (const c of [
  '[aria-label="Close )"] { color: red }\n.other { color: green }',
  '[data-x="("] { color: red }\n.other { color: green }',
  'a[href*="wikipedia.org/wiki/(disambiguation)"] { color: red }\n.btn { color: blue }',
]) {
  const out = scopeCss(c, "s12345678");
  console.log(JSON.stringify(out), "scoped?", out.includes("[s12345678]"));
}

2. Run: deno run --allow-read /tmp/repro.ts

Observed:
- '[aria-label="Close )"] { color: red }\n.other { color: green }' -> OUT identical, scoped? false
- '[data-x="("] ...' -> OUT identical, scoped? false
- 'a[href*=".../(disambiguation)"] ...' (balanced) -> OUT 'a[...][s12345678] {...}\n.btn[s12345678] {...}', scoped? true

Expected: all rules scoped, e.g. '[aria-label="Close )"][s12345678] { color: red }\n.other[s12345678] { color: green }'. Actual for unbalanced cases: byte-for-byte the input, zero scope markers — encapsulation silently lost for the whole stylesheet and (via build.ts:130/146 concatenation into shared app.css) every rule emitted after it.
```
- **evidence:**
```
Observed via deno run --allow-read on scope.ts: IN `"[aria-label=\"Close )\"] { color: red }\n.other { color: green }"` -> OUT identical (no `[s12345678]` anywhere). Contrast a BALANCED value `a[href*="wikipedia.org/wiki/(disambiguation)"] { color: red }\n.btn { color: blue }` -> OUT correctly `a[href*="...(disambiguation)"][s12345678] { ... } .btn[s12345678] { ... }`, proving the asymmetry is caused purely by string-unaware paren/bracket depth tracking. Offending code: scope.ts:49-52 increments/decrements dp/db on raw `()[]` chars with no quote-skipping; scope.ts:53 terminator check is gated on `dp===0 && db===0`. This is distinct from the already-reported declaration-body brace bug (scope.ts:65-69, `{`/`}` inside content strings): this defect is in the PRELUDE scanner and is triggered by `(`/`)`/`[`/`]`, and because build.ts:146 concatenates every component's scoped CSS into one shared app.css, the corruption leaks past the offending component into every rule emitted after it.
```
- **independent verification:**
```
Verified by reading the cited code and reproducing offline. scope.ts processBlock's prelude scanner (lines 47-55) tracks paren/bracket nesting depth (dp/db) by incrementing/decrementing on raw '(' ')' '[' ']' characters with NO string/quote awareness (lines 49-52). The selector/rule terminator check on line 53 is gated on `dp===0 && db===0`. A quoted attribute value containing a lone unbalanced grouping char (e.g. [aria-label="Close )"]) drives dp negative (or pins it positive for '('), so dp is never 0 again; the '{' terminator is never recognized; the scan runs to EOF (j>=n); and the emit path at lines 59-62 outputs `prelude` (the entire remaining stylesheet) verbatim with NO scoping applied. scopeSelectorList / insertToken are never reached.

Reproduction (deno run --allow-read against the real scope.ts) confirmed output is byte-for-byte identical to input for every unbalanced case:
- [aria-label="Close )"] -> identical, no [s12345678]
- [data-x="("] -> identical, no [s12345678]
- [data-x="]"] -> identical, no [s12345678]
Contrast a BALANCED value a[href*="wikipedia.org/wiki/(disambiguation)"] -> correctly scoped to [s12345678] on BOTH rules, proving the asymmetry is caused purely by string-unaware depth tracking, not by the parens themselves.

Reachability confirmed in build.ts:130 (buildCss calls scopeCss(css, scopeId(sel)) per component) and the per-component results are joined into one shared input.css/app.css (parts.join). So one component's unbalanced attribute value un-scopes that component's whole stylesheet AND every rule concatenated after it, silently (no error thrown). This is the view-encapsulation guarantee failing: rules that should carry the [scope] marker get emitted unscoped, so they leak to / clobber other components.

The trigger is valid CSS (unbalanced grouping chars inside a quoted attribute value are perfectly legal, e.g. aria-label="Close (") but uncommon in practice, which is why severity is high rather than critical. This is genuinely distinct from any declaration-body brace bug: it lives in the PRELUDE scanner and is triggered by ( ) [ ].
```

### 12. Two folders sharing a basename collide: same scopeId + silent registry overwrite (encapsulation leak / wrong component rendered)
- **severity:** high  ·  **category:** logic
- **area:** View encapsulation (ui/.sprig/compiler/scope.ts) — scopeId collisions and CSS selector scoping edge cases
- **location:** `ui/.sprig/compiler/mod.ts:41-52 (reg.set with selector=basename(dir)); ui/.sprig/compiler/scope.ts:14-21 (scopeId(selector)); ui/.sprig/compiler/build.ts:128-130 (buildCss scopes by basename)`
- **expected:** Distinct component folders must resolve to distinct components/markers. A page-local `pages/board/components/issue-card` should override/shadow within the board page only, or the build should error on a duplicate selector. CSS from one issue-card must never be eligible to land on the other's elements.
- **actual:** reg.set("issue-card", ...) is called twice and the second silently clobbers the first — the board may render the wrong template/logic. Because scopeId("issue-card") is identical for both, view-encapsulation markers are shared: any CSS authored for one issue-card is scoped with the exact same `[s<hash>]` marker the other's SSR elements carry, so styles leak across the two components — directly violating the encapsulation guarantee stated in scope.ts:1-10.
- **repro:**
```
Run inside /Users/raphaelcastro/Documents/programming/sprig/ui (so deno.json resolves @std/* and @sprig/core):

  // _repro.ts
  import { createRenderer } from "./.sprig/compiler/mod.ts";
  import { scopeId } from "./.sprig/compiler/scope.ts";
  const srcDir = new URL("./src", import.meta.url).pathname;
  const r = await createRenderer(srcDir, "/ui");
  console.log("issue-card entries:", r.selectors().filter(s => s === "issue-card").length); // -> 1 (one clobbered the other)
  console.log("scopeId('issue-card'):", scopeId("issue-card")); // -> sc44799d1 (same for both folders)
  const issue = { id:"X1", title:"T", priority:"low", tags:[], points:1, assignees:[] };
  const board = { project:{name:"P",key:"K",velocity:1}, groups:[{column:{id:"c",label:"Col",wip:0}, issues:[issue]}] };
  const html = await r.renderDocument("board", { board });
  console.log("has PAGE-LOCAL override:", html.includes("PAGE-LOCAL ISSUE CARD OVERRIDE")); // -> true (WRONG component)
  console.log("has real icard markup:", html.includes("icard__title"));                    // -> false

  deno run -A _repro.ts

Observed: walk() visits src/shared-components/issue-card FIRST then src/pages/board/components/issue-card LAST; registry has 1 "issue-card"; board page renders the page-local override DIV instead of the real card; scopeId is identical (sc44799d1) for both folders.
```
- **evidence:**
```
`find ui/src -name template.html -exec dirname {} \;` shows both ui/src/shared-components/issue-card and ui/src/pages/board/components/issue-card. mod.ts:41 `const selector = basename(dir)` and mod.ts:52 `reg.set(selector, {...})` (no `reg.has` guard). build.ts:130 `scopeCss(css, scopeId(sel))` with `sel = basename(dirname(entry.path))`. scopeId is a pure function of the selector string, so scopeId("issue-card") is identical for both folders.
```
- **independent verification:**
```
Verified empirically against the actual code, not just by reading.

ROOT CAUSE: The renderer keys components solely by folder basename. In ui/.sprig/compiler/mod.ts:39-53, the walk over template.html files does `const selector = basename(dir)` (line 41) and `reg.set(selector, {...})` (line 52) into a plain Map with NO `reg.has` guard, no dedup, no warning, no error. The build pipeline does the same: build.ts:43 (`sel: basename(dir)`) and buildCss build.ts:128-130 (`const sel = basename(dirname(entry.path)); scopeCss(css, scopeId(sel))`). scopeId (scope.ts:14-21) is a pure function of the selector string, so two folders with the same basename get the IDENTICAL scope marker.

The repo contains two distinct components with basename `issue-card`:
- ui/src/shared-components/issue-card/template.html (the real card: <a class=\"icard\">… {{issue.title}} …)
- ui/src/pages/board/components/issue-card/template.html (content: <div class=\"page-local\">PAGE-LOCAL ISSUE CARD OVERRIDE</div>)

REPRODUCTION (run, observed):
1. walk() order: shared-components/issue-card visited FIRST, pages/board/components/issue-card visited LAST → the page-local one wins the registry race.
2. createRenderer(srcDir).selectors() yields exactly ONE \"issue-card\" entry (count=1) — the second set() silently clobbered the first.
3. renderDocument(\"board\", {board}) — the board template (ui/src/pages/board/template.html:17) renders <issue-card [issue]=\"issue\"> and clearly expects the real shared card (it supplies issue.id/title/priority/tags/points/assignees). Observed output: contains \"PAGE-LOCAL ISSUE CARD OVERRIDE\" = TRUE, contains real \"icard__title\" markup = FALSE. The WRONG component rendered.
4. scopeId(\"issue-card\") = \"sc44799d1\" — identical for both folders, confirming the shared CSS marker (encapsulation leak: any CSS authored for one issue-card is scoped with the exact marker the other's SSR elements carry).

This is a genuine logic defect, not working-as-designed. The header comment in scope.ts:1-10 explicitly guarantees that a component's styles \"never leak to or clobber another component\" — a guarantee broken by basename-only scopeId. And mod.ts's own doc comment (lines 28-30) says \"selector = folder name\" with no notion that two folders can share a name, so the silent last-writer-wins overwrite is an unintended consequence, not a designed override mechanism. The expected behavior is at minimum a build/registry error on duplicate selectors (or true per-page shadowing); the actual behavior is silent corruption.

Severity high is appropriate: it silently renders the wrong template/logic for a page-referenced component and breaks the stated view-encapsulation invariant. Not critical only because it requires an authored basename collision rather than affecting all builds.
```

### 13. scopeCss brace matcher ignores CSS string context: an unbalanced '{' or '}' inside a string value (e.g. content: "{") corrupts the rest of the component's stylesheet — un-scopes every following rule (encapsulation leak) and emits a stray '}' (invalid CSS) into the shared app.css
- **severity:** high  ·  **category:** rendering
- **area:** View encapsulation / CSS selector scoper (ui/.sprig/compiler/scope.ts)
- **location:** `ui/.sprig/compiler/scope.ts:65-69 (the declaration-body brace-depth scan in processBlock); compounded by build.ts:130 + build.ts:146 which concatenate every component's scoped CSS into one app.css`
- **expected:** Every rule (.a, .icon, .b, .c) gets the scope token appended to its key compound (e.g. `.b[data-s1]`), and the output is well-formed CSS with balanced braces. CSS strings must be treated as opaque so a '{'/'}' inside content:/url() does not affect rule boundaries.
- **actual:** Output:
  .a[data-s1] {color:red}
  .icon[data-s1]::before {content:"{";}
  .b{color:blue}
  .c{color:green}}

.b and .c are emitted WITHOUT the scope token (their encapsulation is silently dropped — they now match elements of other components), and a spurious trailing '}' is appended, making the stylesheet invalid CSS. Because all components' scoped CSS is concatenated into one app.css (build.ts:130,146), one component's unbalanced-brace string corrupts the cascade for everything that follows it in the bundle.
- **repro:**
```
White-box, deterministic. From the repo root:

cat > /tmp/repro_scope.ts << 'EOF'
import { scopeCss } from "/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts";
const sheet = `.a{color:red}
.icon::before{content:"{";}
.b{color:blue}
.c{color:green}`;
console.log(scopeCss(sheet, "data-s1"));
EOF
deno run --allow-read /tmp/repro_scope.ts

Observed output (defect):
  .a[data-s1] {color:red}
  .icon[data-s1]::before {content:"{";}
  .b{color:blue}
  .c{color:green}}

Expected: .b -> .b[data-s1], .c -> .c[data-s1], and balanced braces (no trailing '}'). The '{' inside content:"{" must be treated as part of an opaque string, not a block open.
```
- **evidence:**
```
Mechanism: in processBlock the matching-close scan (scope.ts:65-69) counts only raw '{'/'}' with no string/comment awareness: `for (; k < n; k++) { if (css[k]==="{") depth++; else if (css[k]==="}" && --depth===0) break; }`. For `.icon::before{content:"{";}` the literal '{' inside the string drives depth to 2; the real closing '}' brings it to 1; depth never returns to 0, so k runs to EOF and `inner = css.slice(j+1, n)` swallows all following rules verbatim (unscoped), then the code appends `"}"` at scope.ts:77. Confirmed by running scopeCss on the sheet above (observed output shown in 'actual') and on `.tip::after { content: "{"; }\n.next { color: blue }` which yields `.next { color: blue }}` (unscoped + extra brace). Note the prelude scan (scope.ts:46-55) IS protected for attribute-value braces by its `[]` counter (verified: `[data-x="{"]{...}` scopes correctly), so the defect is isolated to the body matcher's lack of string handling, not the selector parser.
```
- **independent verification:**
```
Verified by reading the cited code and reproducing the defect directly.

Code: In /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts, processBlock's matching-close scan (lines 65-69) counts raw braces with zero string/comment/escape awareness:
  let depth = 0, k = j;
  for (; k < n; k++) {
    if (css[k] === "{") depth++;
    else if (css[k] === "}" && --depth === 0) break;
  }
A '{' inside a CSS string value (e.g. content:"{") is counted as a real block open, so depth never returns to 0 at the rule's true closing brace; k runs to EOF, inner = css.slice(j+1, k) swallows every following rule verbatim (unscoped), and line 77 appends a trailing '}'.

Note the prelude scanner (lines 46-55) and selector key-compound scanner (98-108) only guard parentheses/brackets, also not strings — but the reported defect is specifically the body matcher, which I confirmed.

Reproduction (deno run --allow-read importing scopeCss):
Input:
  .a{color:red}
  .icon::before{content:"{";}
  .b{color:blue}
  .c{color:green}
Output:
  .a[data-s1] {color:red}
  .icon[data-s1]::before {content:"{";}
  .b{color:blue}
  .c{color:green}}
.b and .c lost their scope token (encapsulation silently dropped — they now match other components' elements) and a spurious '}' was appended (invalid CSS). The simpler case `.tip::after { content: "{"; }\n.next { color: blue }` produced `.next { color: blue }}` — same defect.

Blast radius confirmed: build.ts:130 scopes each component's styles.css and pushes to parts[]; build.ts:146 joins all parts into a single Tailwind input that emits one shared app.css. So one component's unbalanced-brace string corrupts the cascade (un-scoped rules + invalid brace) for every component concatenated after it.

This is not working-as-designed: the file's own header (lines 1-10) promises that a component's styles can NEVER leak to another component's elements; this defect breaks exactly that guarantee. The fix is to make the brace scanner (and ideally the prelude/selector scanners) skip over string literals (' and ") and escape sequences. Severity high rather than critical: real correctness/encapsulation-leak + invalid-CSS impact, but the trigger is a specific and uncommon authoring pattern (a literally-unbalanced brace inside a CSS string, e.g. content:"{").
```


## MEDIUM severity

### 14. Well-formed but unknown resource id returns HTTP 500 instead of 404 (not-found mapped to server error)
- **severity:** medium  ·  **category:** protocol
- **area:** API input validation on POST /api/http/issue and /api/http/user (RuneAssert->422 seam, not-found path, extra-field handling)
- **location:** `backend/src/board/domain/business/issue/mod.ts:15 (throw new Error(`no issue with id ...`)); backend/src/board/domain/business/user/mod.ts:15 (throw new Error(`no user with id ...`)); reached via coordinator backend/src/board/domain/coordinators/issue-get/mod.ts:14-21 after the input assert passes; endpoint backend/src/board/entrypoints/http/mod.ts:44-57`
- **expected:** A syntactically valid id that names no existing resource is a client addressing error for a missing resource -> HTTP 404 Not Found (with a structured not-found body).
- **actual:** Returns HTTP 500 with body {"status":500,"message":"no issue with id \"SPR-999\""} (and {"status":500,"message":"no user with id \"nobody\""}). The input PASSED validation (it is a non-empty string), so this is not the empty/whitespace validation gap; it is the not-found resource path being surfaced as a server error. Also note this 500 uses a different error envelope ({status,message}) than the 422 RuneAssertError envelope, so clients cannot distinguish 'missing resource' from a real internal fault.
- **repro:**
```
Against the running backend (mounted under /api, server on port 8200):

# valid id -> 200 (proves input passes validation)
curl -s -w '\n[%{http_code}]\n' -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' -d '{"issueId":"SPR-101"}'

# well-formed but unknown id -> 500 (should be 404)
curl -s -w '\n[%{http_code}]\n' -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' -d '{"issueId":"SPR-999"}'
# => {"status":500,"message":"no issue with id \"SPR-999\""}  [500]

curl -s -w '\n[%{http_code}]\n' -X POST http://localhost:8200/api/http/user -H 'content-type: application/json' -d '{"userId":"nobody"}'
# => {"status":500,"message":"no user with id \"nobody\""}  [500]

# contrast: a real validation failure uses a DIFFERENT envelope (422 RuneAssertError)
curl -s -w '\n[%{http_code}]\n' -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' -d '{}'
# => {"name":"RuneAssertError",...,"failures":[...]}  [422]
```
- **evidence:**
```
Live: POST {"issueId":"SPR-999"} -> [500] {"status":500,"message":"no issue with id \"SPR-999\""}; POST {"userId":"nobody"} -> [500] {"status":500,"message":"no user with id \"nobody\""}; POST {"issueId":"spr-101"} (wrong case) -> [500]. Source: business assemblers throw a plain `new Error(...)` on a failed Array.find (issue/mod.ts:15, user/mod.ts:15); a plain thrown Error has no HTTP-status mapping in the keep pipeline so it defaults to 500. The valid path (SPR-101) returns 200, proving the input itself is accepted by the validation seam — the 500 is purely the not-found handling.
```
- **independent verification:**
```
Verified both statically and at runtime against the live server on port 8200.

Source confirms the defect: backend/src/board/domain/business/issue/mod.ts:15 and user/mod.ts:15 throw a plain `new Error(...)` when Array.find returns undefined. A plain thrown Error carries no HTTP-status mapping in the keep pipeline, so it defaults to 500. The coordinator (issue-get/mod.ts:14-21) runs assert() first (which passes for any non-empty string), then calls issue.assemble(), so the not-found throw happens strictly after validation succeeds.

Live reproduction confirms every claim:
- POST {"issueId":"SPR-101"} (valid) -> 200 with full payload, proving the input itself is accepted by the validation seam.
- POST {"issueId":"SPR-999"} (well-formed, unknown) -> 500 {"status":500,"message":"no issue with id \"SPR-999\""}
- POST {"userId":"nobody"} -> 500 {"status":500,"message":"no user with id \"nobody\""}
- POST {"issueId":"spr-101"} (wrong case) -> 500
This is NOT the empty/whitespace validation gap (a valid non-empty id succeeds), it is the not-found path being mapped to a server error.

Envelope-mismatch claim also verified: a true validation failure (POST {} or {"issueId":123}) returns 422 with the structured RuneAssertError envelope {name, message, target, failures}, whereas not-found returns 500 with a different {status, message} envelope. Clients therefore cannot distinguish a missing resource from a genuine internal fault.

This is a genuine, reproducible API protocol defect — wrong HTTP status (500 vs the correct 404) plus an inconsistent error body. Severity medium: it breaks client error handling and pollutes error monitoring (every 404-class miss looks like a server fault), but causes no crash, data loss, or security exposure. The fix is to throw a not-found error type that keep maps to 404 (and ideally use the structured error envelope) rather than a plain Error.
```

### 15. Empty-string and whitespace-only issueId/userId pass validation and 500 instead of being rejected with 422
- **severity:** medium  ·  **category:** validation
- **area:** API input validation on POST /api/http/issue and /api/http/user (RuneAssertError->422 seam; IssueRefDto / UserRefDto)
- **location:** `backend/src/board/dto/issue-ref.ts:16-18 (issueId only @IsString()); backend/src/board/dto/user-ref.ts:16-18 (userId only @IsString()); reaches backend/src/board/domain/business/issue/mod.ts:16 / user/mod.ts:16 (throw new Error)`
- **expected:** An empty or whitespace-only id is malformed input and should be rejected at the validation seam with HTTP 422 (e.g. via @IsNotEmpty() and a trim/length constraint), the same way missing/null/number/array inputs are.
- **actual:** HTTP 500 {"status":500,"message":"no issue with id \"\""} (and "   " / "" for user). The id passes @IsString(), skips the validation seam, and crashes the business layer as if it were a server fault. This is distinct from the already-reported 'well-formed but nonexistent id -> 500' case: here the input itself is empty/whitespace and belongs to the input-validation contract, not the resource-existence path.
- **repro:**
```
From repo root, boot the actual module in-process and drive the endpoints (same channel as backend/src/board/entrypoints/http/e2e.test.ts):

1. Create backend/src/board/entrypoints/http/_verify.test.ts:

import { httpModule } from "./mod.ts";
import { bootstrapServer } from "@mrg-keystone/keep";

Deno.test("verify empty/whitespace id", async () => {
  const api = await bootstrapServer("board", httpModule, { swagger: true });
  const post = (p: string, b: unknown) => api.backend.fetch(p, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
  });
  try {
    for (const [p, b] of [
      ["/http/issue", { issueId: "" }], ["/http/issue", { issueId: "   " }],
      ["/http/user", { userId: "" }],  ["/http/user", { userId: "  " }],
      ["/http/issue", {} /* control: 422 */],
    ] as Array<[string, unknown]>) {
      const r = await post(p, b);
      console.log(p, JSON.stringify(b), "->", r.status, (await r.text()).slice(0,100));
    }
  } finally { await api.stop(); }
});

2. Run: cd backend && /opt/homebrew/bin/deno test -A src/board/entrypoints/http/_verify.test.ts

Observed (BUG): empty and whitespace issueId/userId -> HTTP 500 {"status":500,"message":"no issue with id \"\""}; control {} -> 422.
Expected: empty/whitespace ids should be rejected at the validation seam with 422, like the missing/number/null/array cases.

Fix direction: add @IsNotEmpty() (and a trim + min-length, e.g. @Transform(({value}) => typeof value === "string" ? value.trim() : value) + @MinLength(1)) to issueId in backend/src/board/dto/issue-ref.ts:16 and userId in backend/src/board/dto/user-ref.ts:16.

3. Delete _verify.test.ts when done.
```
- **evidence:**
```
Live: POST issue {"issueId":""} -> HTTP/1.1 500, body {"status":500,"message":"no issue with id \"\""}; {"issueId":"   "} -> 500 'no issue with id "   "'; user {"userId":""} -> 500 'no user with id ""'; {"userId":"  "} -> 500. By contrast {"issueId":123|null|[]|{}} all correctly return 422. DTO source declares only @IsString() with no @IsNotEmpty()/length/trim.
```
- **independent verification:**
```
Verified by booting the actual module in-process (the same bootstrapServer + api.backend.fetch channel the e2e test uses) and posting each case.

Confirmed code: backend/src/board/dto/issue-ref.ts:16 and backend/src/board/dto/user-ref.ts:16 decorate the id with only @IsString() (no @IsNotEmpty/length/trim). backend/src/board/domain/business/issue/mod.ts:15 and user/mod.ts:15 throw a plain `throw new Error(...)` when the id is not found, which the RuneAssertError->status seam surfaces as a generic 500.

Live reproduction output:
  /http/issue {"issueId":""}    -> 500 {"status":500,"message":"no issue with id \"\""}
  /http/issue {"issueId":"   "} -> 500 {"status":500,"message":"no issue with id \"   \""}
  /http/user  {"userId":""}     -> 500 {"status":500,"message":"no user with id \"\""}
  /http/user  {"userId":"  "}   -> 500 {"status":500,"message":"no user with id \"  \""}
By contrast, the malformed inputs that DO hit the validation seam return 422:
  /http/issue {}                -> 422 RuneAssertError "issueId must be a string"
  /http/issue {"issueId":123}   -> 422
  /http/issue {"issueId":null}  -> 422
  /http/issue {"issueId":[]}    -> 422

This is a genuine defect, not working-as-designed: (1) The DTO files are explicitly marked as hand-editable ("Edit the body. Re-running manifest will not overwrite this file"), so the absence of @IsNotEmpty is a body-level omission, not framework-fixed codegen. (2) The codebase already establishes the contract that malformed input is rejected at the validation seam with 422 — the e2e test (e2e.test.ts:61-65) asserts missing issueId -> 422. An empty/whitespace string is malformed input of the same class but slips past @IsString() (empty string IS a string) and crashes the business layer, which is meant to signal server faults via 500. (3) It is distinct from the already-reported "well-formed-but-nonexistent id -> 500" case (e.g. SPR-999): that is a resource-existence concern (fix is 404), whereas ""/"   " is an input-contract violation (fix is @IsNotEmpty + trim length at the DTO -> 422). Same 500 symptom, different root cause and different fix.

Severity medium is appropriate: it's a contract/correctness inconsistency (malformed input reported as a server error, polluting 5xx error metrics/alerting and misrepresenting client error as server fault), but no crash-loop, data corruption, or security impact.
```

### 16. Well-formed but nonexistent issueId/userId returns 500 (unhandled plain Error) instead of 404
- **severity:** medium  ·  **category:** logic
- **area:** API input validation on POST /api/http/issue and /api/http/user (the RuneAssertError->422 seam and the assemble lookup path)
- **location:** `backend/src/board/domain/business/issue/mod.ts:18 (Issue.assemble) and backend/src/board/domain/business/user/mod.ts:18 (User.assemble); coordinators backend/src/board/domain/coordinators/issue-get/mod.ts:16 and user-get/mod.ts:16`
- **expected:** A request that is well-formed (valid string id) but references a resource that does not exist should return 404 Not Found (or a clean 422 with a 'no such issue/user' message) — a client-input condition, not a server fault.
- **actual:** assemble() throws `new Error(\`no issue with id "${issueId}"\`)` / `no user with id ...` — a PLAIN Error, not a RuneAssertError. It is thrown AFTER the input assert seam, inside getCore, and there is no try/catch, no 404/NotFoundException mapping anywhere in the coordinator, business, or entrypoint layers. keep's framework error handler treats an unhandled non-assert Error as an internal error -> HTTP 500. The 422 seam only fires for contract violations (wrong type / missing field), not for valid-string-but-missing ids.
- **repro:**
```
Run from the backend dir (import map lives in backend/deno.json). Drop this file in /Users/raphaelcastro/Documents/programming/sprig/backend/ and run `deno test -A --no-check ./zz-repro.test.ts`:

import { httpModule } from "@/src/board/entrypoints/http/mod.ts";
import { bootstrapServer } from "@mrg-keystone/keep";

Deno.test("repro", async () => {
  const api = await bootstrapServer("board", httpModule, { swagger: false });
  const post = (path: string, body: unknown) =>
    api.backend.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  for (const [path, body] of [
    ["/http/issue", { issueId: "SPR-999" }],
    ["/http/issue", { issueId: "" }],
    ["/http/user",  { userId: "nobody" }],
  ] as const) {
    const res = await post(path, body);
    console.log(`POST ${path} -> ${res.status}  ${await res.text()}`);
  }
});

Observed:
  POST /http/issue {"issueId":"SPR-999"} -> 500 {"status":500,"message":"no issue with id \"SPR-999\""}
  POST /http/issue {"issueId":""}        -> 500
  POST /http/user  {"userId":"nobody"}   -> 500 {"status":500,"message":"no user with id \"nobody\""}
Expected: 404 (or a clean 422 "no such issue/user"), since the request is well-formed and only the referenced resource is missing.

Equivalent over the wire once the server is listening:
  curl -s -i <base>/api/http/issue -X POST -H 'Content-Type: application/json' -d '{"issueId":"SPR-999"}'
```
- **evidence:**
```
backend/src/board/domain/business/issue/mod.ts:17-18: `const issue = ISSUES.find((c) => c.id === issueId); if (!issue) throw new Error(\`no issue with id "${issueId}"\`);`. Same pattern in user/mod.ts:17-18. IssueRefDto (backend/src/board/dto/issue-ref.ts) and UserRefDto (user-ref.ts) decorate the id only with @IsString() — no @IsNotEmpty / pattern — so empty/unknown strings pass validation. The coordinators (issue-get/mod.ts, user-get/mod.ts) call assert() for input/output but wrap assemble() in NO try/catch. grep for catch|404|NotFound|HttpException across backend/src/board and backend/bootstrap finds only the test file's try. Seed data is SPR-101..SPR-106 and users ada/alan/grace (backend/src/board/domain/business/board/mod.ts:29-87). The e2e/int tests (issue-get/int.test.ts, entrypoints/http/e2e.test.ts) assert 422 ONLY for missing issueId; there is NO test covering a valid-but-nonexistent id, so this 500 path is untested. NOTE: the exact 500 status could not be black-box confirmed because no sprig server was reachable and the @mrg-keystone/keep package is not in the local deno cache to read its exception filter directly; the offending throw-path itself is proven from source.
```
- **independent verification:**
```
Verified by reading the cited source AND by black-box reproduction against the actual running server (in-process api.backend.fetch channel, the same path the e2e test and the sprig UI use).

Source confirms the throw-path:
- /Users/raphaelcastro/Documents/programming/sprig/backend/src/board/domain/business/issue/mod.ts:15 — `if (!issue) throw new Error(`no issue with id "${issueId}"`);` (a plain Error, not a RuneAssertError), thrown inside assemble(), called from getCore() in the coordinator.
- /Users/raphaelcastro/Documents/programming/sprig/backend/src/board/domain/business/user/mod.ts:15 — same pattern for users.
- DTOs /backend/src/board/dto/issue-ref.ts and user-ref.ts decorate the id with @IsString() ONLY (no @IsNotEmpty / pattern), so "SPR-999", "" and "nobody" are all valid strings that pass the assert seam.
- Coordinators /backend/src/board/domain/coordinators/issue-get/mod.ts:14-28 and user-get/mod.ts call assert() for input/output but wrap assemble() in NO try/catch. A grep for catch|404|NotFound|HttpException|RuneAssertError across src/board and bootstrap returned nothing.

Reproduction (deno test -A, in-process fetch through bootstrapServer + httpModule):
- POST /http/issue {"issueId":"SPR-999"} -> 500  {"status":500,"message":"no issue with id \"SPR-999\""}
- POST /http/issue {"issueId":""}        -> 500
- POST /http/user  {"userId":"nobody"}   -> 500  {"status":500,"message":"no user with id \"nobody\""}
- Control POST /http/issue {"issueId":"SPR-101"} -> 200 (valid id works)
- Control POST /http/issue {"wrong":1}   -> 422 RuneAssertError (the assert seam only fires for contract/type violations, NOT for valid-string-but-missing ids)

This is a genuine defect: a client-input condition (referencing a resource that does not exist) is surfaced as a 5xx server fault. It is not intended behavior (the framework clearly distinguishes 422 for contract errors; a missing record should be a 4xx, conventionally 404). Severity medium is appropriate — it is a real, reachable, untested wrong-status-code bug with no data-integrity or security impact; the empty-string variant also reveals that input validation is loose (@IsNotEmpty would be reasonable).

Fix direction: have assemble() throw via keep's assert/NotFound mechanism (or have the coordinator map the missing-record case to a 404/422), and tighten the DTOs with @IsNotEmpty.
```

### 17. Malformed / empty / non-JSON request body returns HTTP 500 (not 400/422) on issue and user endpoints, leaking the raw JSON parser error message
- **severity:** medium  ·  **category:** protocol
- **area:** API protocol abuse (malformed/empty/non-JSON request bodies on POST endpoints)
- **location:** `backend/src/board/entrypoints/http/mod.ts:44-57 (issue/user @Endpoint declare input: IssueRefDto / UserRefDto); the unguarded body JSON.parse lives in the @mrg-keystone/keep@1.22.0 @Endpoint request pipeline, which parses the body BEFORE running input-DTO validation. Reproduced against the live in-process API at http://localhost:8200 (the sprig app on port 8200).`
- **expected:** A client-supplied unparseable body is a client error: respond 400 Bad Request (or the framework's 422 used for the existing input-validation seam) with a generic message such as "Invalid JSON body". Server-side 500 should be reserved for genuine internal faults, and the response must not echo the raw V8/JSON.parse error string.
- **actual:** Any body that fails JSON.parse produces HTTP 500 with the literal parser error in the message field (e.g. "Unexpected end of JSON input", "Expected property name or '}' in JSON at position 1"). The body is parsed before the input-DTO validation runs, so the parse exception escapes the validation seam and is mapped to 500. Structurally-valid-but-wrong bodies are handled correctly (422), proving the seam exists but sits after the unguarded parse: '[]' -> 422, 'null' -> 422, '42' -> 422, '{"issueId":123}' -> 422, but '{bad' -> 500, '' (empty) -> 500.
- **repro:**
```
App already running on port 8200 (deno serve). Run:

B=http://localhost:8200/api/http

# valid -> 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{"issueId":"SPR-101"}' $B/issue

# malformed JSON -> 500 + leaked parser message
curl -i -s -X POST -H 'content-type: application/json' -d '{not json' $B/issue
#  HTTP/1.1 500 Internal Server Error
#  {"status":500,"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}

# empty body -> 500
curl -s -X POST -H 'content-type: application/json' $B/issue
#  {"status":500,"message":"Unexpected end of JSON input"}

# non-JSON / trailing junk -> 500
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d 'hello' $B/issue                 # 500
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{"issueId":"SPR-101"}xxx' $B/issue # 500

# same on /user
curl -s -X POST -H 'content-type: application/json' -d '{bad' $B/user   # 500 + leaked message

# contrast: validation seam returns 422 for structurally-valid-but-wrong bodies
for body in '[]' 'null' '42' '"x"' '{"issueId":123}'; do
  curl -s -o /dev/null -w "$body -> %{http_code}\n" -X POST -H 'content-type: application/json' -d "$body" $B/issue
done   # all 422

If not already running: deno task start (deno serve -A --unstable-kv serve.ts) from repo root, then hit port 8200.

Key file: /Users/raphaelcastro/Documents/programming/sprig/backend/src/board/entrypoints/http/mod.ts:44 (issue) and :55 (user). The throwing body parse is in the keep @Endpoint pipeline (@mrg-keystone/keep@1.22.0, deno.lock:11, mapped via /Users/raphaelcastro/Documents/programming/sprig/packages/keep/mod.ts).
```
- **evidence:**
```
Live responses from http://localhost:8200 (sprig app, port 8200, in-process API): POST /api/http/issue with '{not json' returned `{"status":500,"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}`; empty body returned `{"status":500,"message":"Unexpected end of JSON input"}`; POST /api/http/user with '{bad' returned `{"status":500,"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}`. By contrast '[]','null','42','"x"','{"issueId":123}' all returned 422. /api/http/board and /api/http/dashboard take no input so they ignore the malformed body and return 200 (not affected). The DTO-typed endpoints are declared at backend/src/board/entrypoints/http/mod.ts:44 (issue, input: IssueRefDto) and :55 (user, input: UserRefDto); the body parse that throws is inside the keep @Endpoint pipeline (jsr:@mrg-keystone/keep@1.22.0, pinned in deno.lock:11).
```
- **independent verification:**
```
Independently reproduced against the live app on port 8200 (PID 61758 listening on :8200). Every claim in the report holds exactly:

- POST /api/http/issue with valid body {"issueId":"SPR-101"} -> 200.
- POST /api/http/issue with '{not json' -> HTTP/1.1 500 Internal Server Error, content-type application/json, body {"status":500,"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}.
- Empty body -> 500 {"status":500,"message":"Unexpected end of JSON input"}.
- 'hello' -> 500; '{"issueId":"SPR-101"}xxx' (trailing junk) -> 500.
- POST /api/http/user with '{bad' -> 500 with the same leaked parser message.

The validation seam is confirmed to sit AFTER the unguarded parse: structurally-valid-but-wrong bodies all return 422 ([] -> 422, null -> 422, 42 -> 422, "x" -> 422, {"issueId":123} -> 422), while bodies that fail JSON.parse short-circuit to 500. The no-input endpoints (/api/http/board, /api/http/dashboard) ignore the malformed body and return 200, so they are unaffected — consistent with the report.

This is a genuine protocol-handling defect, not intended behavior: a client-supplied unparseable body is a client error and should be 400/422 with a generic message, not a server-side 500 that echoes the raw V8 JSON.parse exception string. The endpoints are declared at backend/src/board/entrypoints/http/mod.ts:44 (issue, input: IssueRefDto) and :55 (user, input: UserRefDto); the throwing parse lives in the keep @Endpoint request pipeline (@mrg-keystone/keep@1.22.0, pinned in deno.lock:11, mapped through packages/keep/mod.ts), which parses the body before running input-DTO validation, so the parse exception escapes the validation seam and is mapped to 500.

Severity medium is appropriate: it is a correctness/protocol-hygiene and minor information-disclosure issue (leaks internal V8 parser error strings and wrong status class), but it does not expose data, allow auth bypass, or crash the server.
```

### 18. TRACE request to any /api/* path returns a bare HTTP 500 (uncaught TypeError) because serveSprig re-wraps the Request with a forbidden method
- **severity:** medium  ·  **category:** crash
- **area:** API protocol abuse — wrong HTTP methods / request re-wrapping on the /api/* dispatch path
- **location:** `packages/keep/mod.ts:90-93 (the /api/* re-wrap: `config.keep.handler(new Request(stripped, req), info)`); no try/catch around the fetch handler at packages/keep/mod.ts:81-101`
- **expected:** TRACE (an unsupported method) on an /api/* route should be handled like every other unsupported method: a clean 404 (no matching POST route) or a 405 Method Not Allowed, routed through keep's normal error handler (carrying x-request-id / content-type), exactly as TRACE on /docs already does (404 with x-request-id).
- **actual:** TRACE on /api/* returns a bare HTTP 500 'Internal Server Error' with no x-request-id and no proper content-type — i.e. an UNCAUGHT exception that escapes the application entirely to Deno's top-level handler, rather than a routed 404/405. Every other method (GET/HEAD/PUT/DELETE/PATCH/OPTIONS and arbitrary custom methods like PROPFIND/FOOBAR) returns a clean 404 on the same path.
- **repro:**
```
Root cause (packages/keep/mod.ts:90-93):
  if (path === apiPrefix || path.startsWith(apiPrefix + "/")) {
    const stripped = new URL(req.url);
    stripped.pathname = path.slice(apiPrefix.length) || "/";
    return Promise.resolve(config.keep.handler(new Request(stripped, req), info)); // throws on TRACE
  }
No try/catch wraps the fetch handler (mod.ts:81-101), so the TypeError escapes to Deno.

Reproduced with a minimal server replicating the exact re-wrap:
  Deno.serve({ port: 8211 }, (req) => {
    const url = new URL(req.url); const path = url.pathname;
    if (path.startsWith("/api/")) {
      const stripped = new URL(req.url); stripped.pathname = path.slice(4) || "/";
      const rewrapped = new Request(stripped, req); // line-93 equivalent
      return new Response("ok " + rewrapped.method, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });

Observed:
  curl -i -X TRACE    http://localhost:8211/api/http/board  -> HTTP/1.1 500 Internal Server Error (bare body, no content-type, no x-request-id); server logs `TypeError: Method is forbidden at new Request (ext:deno_fetch/23_request.js:375)`
  curl -i -X GET      http://localhost:8211/api/http/board  -> 200 (re-wrap succeeds)
  curl -i -X PROPFIND http://localhost:8211/api/x           -> 200 (custom method allowed, re-wrap succeeds)
  curl -i -X TRACE    http://localhost:8211/docs            -> 404 (non-api branch, no re-wrap, clean)

Fix: wrap the fetch handler body in try/catch returning a routed 405/404, OR reject forbidden methods (TRACE/CONNECT) before the re-wrap, OR copy method/headers without using `new Request(stripped, req)` for forbidden methods.
```
- **evidence:**
```
Root cause is isolated by white-box + black-box correlation: the /api/* branch (packages/keep/mod.ts:90-93) is the ONLY keep dispatch path that reconstructs the request via `new Request(stripped, req)`; the /docs branch (mod.ts:96-97) forwards the original `req` UNWRAPPED. TRACE 500s on /api/* but cleanly 404s on /docs — the sole difference is the re-wrap. Per the WHATWG Fetch spec, TRACE (and CONNECT) are 'forbidden methods'; the `Request` constructor throws a TypeError when given `method:"TRACE"`. serveSprig.fetch (mod.ts:81-101) has no try/catch, so that TypeError propagates synchronously out of the handler. Confirmed signature of an escaped exception: the 500 response lacks the `x-request-id` and `content-type: text/plain` headers that keep attaches to its real 404/500 responses (compare TRACE /docs -> 404 WITH x-request-id vs TRACE /api/x -> 500 WITHOUT). Reproduced repeatedly and stably (TRACE 500 every time; trace lowercase 500 too; CONNECT is rejected earlier by Deno's HTTP parser as 400).
```
- **independent verification:**
```
Verified by white-box read plus black-box reproduction. In packages/keep/mod.ts the /api/* dispatch branch (lines 90-93) is the only keep path that reconstructs the request via `new Request(stripped, req)`; the /docs branch (lines 96-97) forwards the original `req` unwrapped, and there is NO try/catch around the fetch handler (lines 81-101). Per the WHATWG Fetch spec, TRACE is a forbidden method, and Deno's `Request` constructor throws `TypeError: Method is forbidden` (validateAndNormalizeMethod, ext:deno_fetch/23_request.js:250). Critically, Deno's HTTP server itself IS allowed to deliver an incoming TRACE request to the handler (the constructor restriction only applies to userland construction), so the /api/* branch is reachable and the re-wrap on line 93 throws synchronously. With no try/catch, the TypeError escapes to Deno's top-level handler, yielding a bare 500 'Internal Server Error' with no content-type and no x-request-id — i.e. it bypasses keep's routed error handling entirely. I built a minimal Deno.serve that replicates exactly the line-93 re-wrap: TRACE /api/http/board returned HTTP 500 with the stack trace `TypeError: Method is forbidden at new Request` printed to the server, while GET and the custom method PROPFIND on the same /api/* path passed the re-wrap cleanly, and TRACE on a non-/api path (mimicking the /docs unwrapped branch) returned a clean 404. This matches the claim in every detail. Not working-as-designed: an unauthenticated client can force an uncaught exception / bare 500 on any /api/* route with a single request, escaping application-level error handling. Severity medium is correct — it's a low-impact unauthenticated per-request crash / 500 leak and error-handling defect, not a server-wide DoS or data exposure.
```

### 19. Not-found issue/user returns HTTP 500 (server error) instead of 404, leaking the internal Error message and reflecting user input
- **severity:** medium  ·  **category:** logic
- **area:** Backend rune business/coordinators (backend/src/board/**)
- **location:** `backend/src/board/domain/business/issue/mod.ts:16 (throw new Error) and backend/src/board/domain/business/user/mod.ts:16; reached via coordinators issue-get/mod.ts:getCore and user-get/mod.ts:getCore`
- **expected:** A request for a well-formed but non-existent resource id is a client error: it should return 404 Not Found (or a controlled 422), with a generic safe message. The validation seam only guards format (@IsString); a missing/non-string id correctly returns 422, so a resource that simply does not exist should be a 4xx, not a 5xx.
- **actual:** business/issue/mod.ts and business/user/mod.ts call `throw new Error(`no issue with id "${issueId}"`)` (a generic Error). Nothing maps this to a 404, so it surfaces as HTTP 500 with status:500 and the raw internal error message — and the message echoes the attacker-controlled id verbatim. Result: (1) wrong status code (500 vs 404) so legitimate not-found is indistinguishable from a real server fault and pollutes error monitoring; (2) information leak of internal error text; (3) reflection of unsanitized user input in the error body.
- **repro:**
```
Against the running server:

curl -s -w '\nHTTP %{http_code}\n' http://localhost:8200/api/http/issue -d '{"issueId":"SPR-999"}' -H 'content-type: application/json'
# -> {"status":500,"message":"no issue with id \"SPR-999\""}  HTTP 500   (expected 404)

curl -s -w '\nHTTP %{http_code}\n' http://localhost:8200/api/http/user -d '{"userId":"nobody"}' -H 'content-type: application/json'
# -> {"status":500,"message":"no user with id \"nobody\""}  HTTP 500   (expected 404)

curl -s -w '\nHTTP %{http_code}\n' http://localhost:8200/api/http/issue -d '{"issueId":"<script>x</script>"}' -H 'content-type: application/json'
# -> HTTP 500, id reflected verbatim in JSON message

# Contrast (correct client-error handling at the validation seam):
curl -s -w '\nHTTP %{http_code}\n' http://localhost:8200/api/http/issue -d '{}' -H 'content-type: application/json'
# -> HTTP 422 RuneAssertError

# Source: backend/src/board/domain/business/issue/mod.ts:15 and backend/src/board/domain/business/user/mod.ts:15 (throw new Error(...)); reached via coordinators issue-get/mod.ts and user-get/mod.ts.
```
- **evidence:**
```
backend/src/board/domain/business/issue/mod.ts line 16: `if (!issue) throw new Error(`no issue with id "${issueId}"`);` and backend/src/board/domain/business/user/mod.ts line 16: `if (!user) throw new Error(`no user with id "${userId}"`);`. IssueRefDto/UserRefDto only apply @IsString() (backend/src/board/dto/issue-ref.ts, user-ref.ts), so SPR-999 / nobody / empty-string / <script> all pass the input assert and hit the throw. Observed live on http://localhost:8200: SPR-999 and 'nobody' both return HTTP 500 with {"status":500,"message":"no issue with id ..."}; missing/non-string issueId by contrast correctly returns 422 RuneAssertError.
```
- **independent verification:**
```
Verified against the live server on http://localhost:8200 and confirmed in source. business/issue/mod.ts:15 throws `new Error(`no issue with id "${issueId}"`)` and business/user/mod.ts:15 throws `new Error(`no user with id "${userId}"`)` — generic Errors with no mapping to a 4xx. Reached via coordinators issue-get/mod.ts:getCore and user-get/mod.ts:getCore, exposed by entrypoints/http/mod.ts. The keep framework's default exception filter (jsr:@mrg-keystone/keep) maps an unhandled generic Error to HTTP 500 and serializes its message into the response body.

Live reproduction (exact): SPR-999 -> {"status":500,"message":"no issue with id \"SPR-999\""} HTTP 500; userId "nobody" -> {"status":500,"message":"no user with id \"nobody\""} HTTP 500; issueId "" -> HTTP 500; issueId "<script>x</script>" -> HTTP 500 with the id reflected verbatim. By contrast, missing/non-string issueId correctly returns HTTP 422 RuneAssertError, and a valid id (SPR-101) returns 200. This proves a well-formed-but-absent resource id is mishandled as a server fault (5xx) rather than a client error (should be 404/422).

Impact is genuine: (1) wrong status code makes legitimate not-found indistinguishable from a real server fault and pollutes error monitoring/alerting; (2) the raw internal error string is leaked in the response body. The IssueRefDto/UserRefDto @IsString-only validation (dto/issue-ref.ts, user-ref.ts) confirms format-valid ids fall through to the throw. Not intended behavior, not unreachable, not a misunderstanding.

Two corrections to the report: the throws are at line 15 (not 16) in both files — an off-by-one in the cited location. And the XSS/"reflection of unsanitized input" framing is overstated: the id is echoed into a JSON API error string, not HTML-rendered, so there is no script execution; it is information reflection in an error body, low real exploitability. The substantive defect (500 instead of 404 + internal-message leak) is real, so medium severity is appropriate.
```

### 20. scopeId is basename-only, so same-basename components in different folders share one CSS scope attribute — view encapsulation crosses folder boundaries
- **severity:** medium  ·  **category:** rendering
- **area:** Build + cache (ui/.sprig/compiler/build.ts + mod.ts): cache hash, page-island gate, selector collisions, CSS scope-id collision
- **location:** `ui/.sprig/compiler/scope.ts:14-21 (scopeId derives only from the selector basename) used at ui/.sprig/compiler/build.ts:130 (scopeCss(css, scopeId(sel))) and ui/.sprig/compiler/mod.ts:76,80 (scopeId(page.selector) markers in SSR)`
- **expected:** Each component's scoped CSS (scopeCss with scopeId(sel)) must only match that component's own elements. Two distinct components (shared-components/issue-card vs pages/board/components/issue-card) must get DIFFERENT scope attributes so their stylesheets never cross-apply.
- **actual:** scopeId('issue-card') = sc44799d1 for BOTH folders. The shared issue-card's 19 scoped rules in app.css (keyed on [sc44799d1]) now match the page-local stub's elements on the board page (which carry the same sc44799d1 marker because they share the basename). Encapsulation is broken across folders; the wrong CSS lands on the wrong component's markup.
- **repro:**
```
1. Confirm two same-basename components exist:
   find ui/src -name template.html | xargs -n1 dirname | xargs -n1 basename | sort | uniq -d
   → issue-card  (folders: ui/src/shared-components/issue-card and ui/src/pages/board/components/issue-card)

2. Compute the scope id (basename-only):
   deno eval 'function scopeId(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}return "s"+(h>>>0).toString(16).padStart(8,"0")} console.log(scopeId("issue-card"))'
   → sc44799d1

3. Shared card's scoped rules in the built CSS use that attr:
   grep -o 's[0-9a-f]\{8\}' static/app.css | grep -c sc44799d1   → 19

4. The board page (which renders the page-local stub, not the shared card) carries the same attr:
   curl -s http://localhost:8200/ui/board | grep -o sc44799d1 | wc -l   → 6
   curl -s http://localhost:8200/ui/board | grep -o '<div sc44799d1[^>]*>[^<]*'
   → <div sc44799d1 class="page-local">PAGE-LOCAL ISSUE CARD OVERRIDE  (x6)

The shared issue-card stylesheet ([sc44799d1] key selectors) and the unrelated page-local stub share one scope attribute → encapsulation crosses the folder boundary.

Fix direction: derive the scope id from a path that is unique per component (e.g. the component dir relative to srcDir) on BOTH the build side (build.ts:128) and the SSR side (mod.ts / render.ts:146), and key the registry by that same identity instead of bare basename.
```
- **evidence:**
```
grep -o 's[0-9a-f]\{8\}' static/app.css shows sc44799d1 appearing 19 times (shared issue-card rules). `curl -s http://localhost:8200/ui/board | grep -o sc44799d1 | wc -l` = 6, and those 6 elements are the 'PAGE-LOCAL ISSUE CARD OVERRIDE' stub divs. scopeId (scope.ts:14-21) ignores the folder path entirely; build.ts:128 derives sel via basename(dirname(entry.path)).
```
- **independent verification:**
```
Confirmed end-to-end against the running app and the source.

Mechanism (cited code verified):
- ui/.sprig/compiler/scope.ts:14-21 — scopeId() is FNV-1a over the selector STRING only; nothing about the folder path enters the hash.
- ui/.sprig/compiler/build.ts:128,130 — buildCss derives the component's selector with `basename(dirname(entry.path))` and scopes its styles.css with `scopeCss(css, scopeId(sel))`. Two folders named issue-card therefore both produce scope attr sc44799d1.
- ui/.sprig/compiler/mod.ts:74-80 and render.ts:146 (renderComponent) — the SSR markers come from scopeId(comp.selector); comp.selector is the folder basename, so both issue-card components mark their elements with sc44799d1.

Reachability is real, not hypothetical: the actual src tree contains TWO issue-card folders — ui/src/shared-components/issue-card (has styles.css: 19 scoped rules) and ui/src/pages/board/components/issue-card (a stub <div class=\"page-local\">PAGE-LOCAL ISSUE CARD OVERRIDE</div>). `uniq -d` over all template dirs shows issue-card is the ONLY duplicated basename. scopeId(\"issue-card\") = sc44799d1 (recomputed independently).

Evidence reproduced exactly as claimed:
- grep -o 's[0-9a-f]\\{8\\}' static/app.css → sc44799d1 appears 19 times (the shared card's rules).
- curl http://localhost:8200/ui/board | grep -o sc44799d1 | wc -l → 6, and all 6 are the page-local stub divs: `<div sc44799d1 class=\"page-local\">PAGE-LOCAL ISSUE CARD OVERRIDE</div>`. So the shared card's [sc44799d1]-keyed stylesheet shares its scope attribute with a different component's markup.

This breaks the encapsulation invariant scope.ts's own header comment promises: \"a component's styles can only land on that component's own elements.\" The scope attribute no longer uniquely identifies a component. (Additional related symptom: the registry Map in mod.ts/build.ts is keyed by basename too, so the page-local issue-card silently overwrites the shared one in walk order — page-local wins — which is why the board renders the stub. That is a second consequence of the same basename-only identity flaw.)

Severity medium rather than high because in THIS fixture nothing visibly clobbers: the shared rules target .icard/.pill/.chip while the stub uses .page-local, so the colliding scope attr currently matches no shared rule's key selector. But the encapsulation mechanism itself is broken — any two same-basename components that share a class name would cross-apply, and the registry collision already changes which component renders. It is a genuine correctness defect, working-as-designed only by accident of class names.
```

### 21. Unknown CSS at-rules leave their inner rules UNSCOPED, breaking view encapsulation (e.g. @starting-style, @view-transition, @font-feature-values)
- **severity:** medium  ·  **category:** rendering
- **area:** Build + cache (ui/.sprig/compiler/build.ts, scope.ts, mod.ts)
- **location:** `ui/.sprig/compiler/scope.ts:72-75 (the at-rule branch in processBlock); concatenated into shared app.css by ui/.sprig/compiler/build.ts:130 + :146`
- **expected:** Inner rules of any at-rule that wraps style rules (notably @starting-style, common for enter/exit animations) should have their key compound scoped to the component's marker attribute, exactly like rules outside the at-rule, preserving the encapsulation guarantee the module header docs promise.
- **actual:** Inner declarations of unknown/unhandled at-rules are emitted unscoped into the shared app.css and leak across component boundaries, with no warning to the author.
- **repro:**
```
From repo root (/Users/raphaelcastro/Documents/programming/sprig), create scope_test_tmp.ts:

  import { scopeCss } from "./ui/.sprig/compiler/scope.ts";
  console.log(scopeCss('@starting-style { .box { opacity: 0; } }', 's123'));
  console.log(scopeCss('.box { color: red; }', 's123'));
  console.log(scopeCss('@media screen { .box { color: red; } }', 's123'));

Run: deno run --allow-read scope_test_tmp.ts

Observed output:
  @starting-style { .box { opacity: 0; } }      <- UNSCOPED (bug): no [s123] on .box
  .box[s123] { color: red; }                    <- correctly scoped
  @media screen { .box[s123] { color: red; } }  <- correctly scoped

The .box inside @starting-style carries no marker. Because buildCss (ui/.sprig/compiler/build.ts:125-151) concatenates every component's scoped CSS into one shared app.css, this unscoped .box rule applies to .box elements of every component on the page, breaking the view-encapsulation guarantee stated in scope.ts:1-10. Root cause: scope.ts:75 (`else out += prelude + "{" + inner + "}"`) leaves the inner block untouched for any at-rule not in RECURSE (scope.ts:24).
```
- **evidence:**
```
scope.ts:23-24 define SKIP and RECURSE lists; @starting-style/@view-transition/@font-feature-values are in neither. scope.ts:75 leaves inner untouched. Direct run: input '@starting-style { .box { opacity: 0; } }' -> output identical (no token inserted). Distinct mechanism from the already-reported :host-context and string-context scope bugs.
```
- **independent verification:**
```
Verified directly against the cited code. ui/.sprig/compiler/scope.ts:23-24 define SKIP and RECURSE regexes. @starting-style matches neither, so in processBlock the at-rule branch falls through to scope.ts:75 `else out += prelude + "{" + inner + "}"`, which emits the inner block verbatim with NO scope marker inserted.

Empirically reproduced by importing scopeCss and running it: scopeCss('@starting-style { .box { opacity: 0; } }', 's123') returns the input UNCHANGED — '@starting-style { .box { opacity: 0; } }' — with no [s123] on .box. By contrast a bare '.box { color: red; }' correctly becomes '.box[s123] { ... }', and '@media screen { .box {...} }' correctly recurses to '.box[s123]'. So the discrepancy is real: an identical rule scopes when bare or under @media but NOT when under @starting-style.

build.ts confirms the leak is impactful: buildCss (build.ts:125-131) walks every component's styles.css, runs scopeCss on each, and concatenates them all (line 130) into a single Tailwind input that is built to one shared static/app.css (line 151). An unscoped `.box` inside @starting-style from component A is therefore present globally and matches `.box` elements of every other component on the page — the exact cross-component leak the module header (scope.ts:1-10) promises to prevent.

@starting-style is a standardized at-rule that wraps ordinary style rules (selectors + declarations), commonly used for entry/exit transitions, so this is reachable real-world authoring, not a contrived input. The author gets no warning.

Caveats reducing scope vs the report: @view-transition and @font-feature-values do NOT wrap selector-based style rules (they take descriptors / nested @styleset etc.), so those two examples do not actually leak component selectors the same way — only @starting-style (and any future selector-wrapping at-rule) is the genuine vector. This narrows the blast radius but does not invalidate the defect. Severity medium is appropriate: it requires the author to use @starting-style, only the inner key compounds leak, and the marker still scopes everything outside the at-rule; it is a correctness/encapsulation hole rather than a crash or data issue.
```

### 22. Malformed template.html ships to production silently — tree-sitter produces an error AST that is serialized into the island chunk and SSR registry with no build failure
- **severity:** medium  ·  **category:** correctness
- **area:** Build + cache (ui/.sprig/compiler/build.ts, scope.ts, mod.ts)
- **location:** `ui/.sprig/compiler/parse.ts:26-31 (parseTemplate only throws when tree===null, never on hasError); consumed unchecked at build.ts:42-43 and mod.ts:51-52`
- **expected:** A template.html that fails to parse cleanly should fail the build (or at minimum emit a loud warning) so the broken component never ships, rather than baking a truncated/garbage AST into the immutable island chunk and the SSR document.
- **actual:** A typo'd or truncated template compiles 'successfully': the error AST is serialized into isl.<sel>.js and the SSR registry, producing broken/partial markup at runtime with a green build.
- **repro:**
```
In /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler create a temp file _repro_test.ts:

  import { parseTemplate } from "./parse.ts";
  import { serialize } from "./serialize.ts";
  for (const html of ['<div', '@for (x { </broken>', '<<<>>>', '<div>ok</div>']) {
    const root = await parseTemplate(html);
    const ser = JSON.stringify(serialize(root)).slice(0, 50);
    console.log(JSON.stringify(html), "type:", root.type, "hasError:", root.hasError, "| serialize:", ser);
  }

Run: deno run -A _repro_test.ts (from the compiler dir). Output:
  "<div"               type: template hasError: true   | serialize: {...}   (no throw)
  "@for (x { </broken>" type: template hasError: true  | serialize: {...}   (no throw)
  "<<<>>>"             type: template hasError: true   | serialize: {...}   (no throw)
  "<div>ok</div>"      type: template hasError: false  | serialize: {...}

parseTemplate never throws on hasError, serialize succeeds, and the broken tree is what build.ts:43 and mod.ts:51 consume unchecked. Fix: in parse.ts after the `!tree` guard, add `if (tree.rootNode.hasError) throw new Error(...)` (or emit a loud warning) so a broken template fails the build instead of shipping.
```
- **evidence:**
```
parse.ts:29 'if (!tree) throw' is the ONLY guard; hasError is never checked anywhere. Direct test output: '<div' -> OK type: template hasError: true; '@for (x { </broken>' -> OK ... hasError: true (no throw, serialize succeeds).
```
- **independent verification:**
```
Verified against the cited code and reproduced empirically. /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/parse.ts:26-31 — parseTemplate's ONLY guard is `if (!tree) throw` (line 29); it never inspects rootNode.hasError. web-tree-sitter is error-tolerant: for malformed input it returns a `template` rootNode with hasError===true instead of throwing or returning null. Direct test output: '<div' -> OK type: template hasError: true; '@for (x { </broken>' -> hasError: true; '<<<>>>' -> hasError: true; '<div>ok</div>' -> hasError: false. serialize() succeeds on every error AST (produced valid JSON). A repo-wide grep of ui/.sprig/compiler confirms hasError/isError is checked NOWHERE. The error AST flows straight downstream: build.ts:42 does `const root = await parseTemplate(...)` then build.ts:43 `JSON.stringify(serialize(root))` bakes it into isl.<sel>.ts -> the immutable, content-hashed island chunk; mod.ts:51 `parseCached(source)` feeds the same error tree into the SSR ComponentDef registry (reg.set at mod.ts:52) that renders the live document. Neither call site inspects root.hasError. Result: a typo'd or truncated template.html compiles 'successfully' (green build) and bakes a truncated/garbage AST into both the client island chunk and the SSR markup. This is a genuine correctness/robustness defect, not intended behavior — there is no code path anywhere that surfaces a parse error to the developer. Severity medium (not high): it requires a developer to author broken template HTML, the corruption is bounded to that single component's markup (tree-sitter still yields a partial tree, no crash), and there is no security or data-loss dimension.
```

### 23. Non-existent / invalid resource pages return HTTP 200 instead of 404 (status-code correctness)
- **severity:** medium  ·  **category:** protocol
- **area:** Cross-cutting HTTP correctness (status codes, content-type, headers, SSR document)
- **location:** `ui/.sprig/core.ts:353-356 (bootstrap.fetch always 200); ui/src/services/board/mod.ts:25 (issue() returns null on backend non-OK); ui/src/pages/issue/resolve.ts:7`
- **expected:** A request for a resource that does not exist should return HTTP 404 (and an invalid id arguably 400/404), so caches, crawlers, and API clients see the correct status.
- **actual:** BoardService.issue/profile swallow the backend non-OK into `data ?? null` (mod.ts:11,16,25), resolve passes `detail:null`/`profile:null` into the page, and bootstrap.fetch unconditionally returns `new Response(html, {content-type: text/html})` with the default 200 status. There is no mechanism for a resolve to signal a non-200 status — grep of core.ts confirms fetch() only emits 404 for an unmatched route or wrong base, never for a matched route whose resolve found nothing.
- **repro:**
```
Source-level reproduction (control flow is unconditional; no running server required):

Request: GET /ui/issues/SPR-999 (any non-existent or invalid id), or GET /ui/users/nobody.

Trace:
- Route `issues/:id` (ui/src/main.ts:17) matches → mod.resolve runs (core.ts:349-351).
- resolve calls BoardService.issue("SPR-999") (ui/src/pages/issue/resolve.ts:7).
- backend returns non-OK → backendClient.get returns {ok:false, status} with no data (ui/.sprig/core.ts:220-222).
- issue() returns `data ?? null` = null (ui/src/services/board/mod.ts:25).
- inputs = {detail: null, id: "SPR-999"}; template renders @else branch "No issue with id SPR-999" (ui/src/pages/issue/template.html).
- bootstrap.fetch returns `new Response(html, {headers:{content-type}})` with no status (ui/.sprig/core.ts:356) → HTTP 200.

Expected: 404 (or 400 for an invalid id) for a resource that does not exist.
Actual: 200 OK with a 'not found' body. Same for /ui/users/nobody via UserService.profile (ui/src/services/user/mod.ts:8-15).

To reproduce live (if a server is wired): start the app via serve.ts and run `curl -i http://localhost:PORT/ui/issues/SPR-999` and observe `HTTP/1.1 200 OK` with the 'No issue with id' body.
```
- **evidence:**
```
core.ts:356 `return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });` (no status arg → 200, regardless of inputs). services/board/mod.ts:25 `return data ?? null;` (get() returns {ok:false,status} on backend non-OK per core.ts:220-222, so data is undefined → null). pages/issue/template.html has an `@else { No issue with id "{{ id }}" }` branch, confirming the null path renders a normal page body. This also collapses validation errors (422) and genuine not-found into an identical 200 'not found' page.
```
- **independent verification:**
```
Verified by reading the full control-flow chain in source; the path is deterministic and unconditional, so a code read is conclusive.

1. ui/.sprig/core.ts:218-225 — backendClient.get() returns `{ok:false, status}` (NO `data` field) whenever the backend response is not ok (lines 220-222). So for a backend 422/404 on a bad id, `data` is undefined.

2. ui/src/services/board/mod.ts:19-26 (issue()) and ui/src/services/user/mod.ts:8-15 (profile()) both do `return data ?? null` → they return `null` for a non-existent/invalid id, discarding the backend status entirely.

3. resolve.ts (issue/resolve.ts:7 and user/resolve.ts:6) pass `{detail: null, id}` / `{profile: null, id}` into the page inputs.

4. The templates render their `@else { No issue with id "{{id}}" }` branch (ui/src/pages/issue/template.html, ui/src/pages/user/template.html) — a normal, fully-formed page body.

5. ui/.sprig/core.ts:356 — `return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });` passes NO status, so the Response defaults to 200 OK, regardless of inputs.

Routes `issues/:id` and `users/:id` exist (ui/src/main.ts:17-18), so these URLs are matched and reach the resolve. In bootstrap.fetch, 404 is emitted ONLY for a wrong base (core.ts:338) or an unmatched route (core.ts:341) — never for a matched route whose resolve returned a null resource. There is genuinely no mechanism for a resolve to signal a non-200 status; the result map only carries data, not status. This also collapses backend 422 (invalid id) and genuine not-found into an identical 200 'not found' page.

This is a real defect, not intended behavior: an SSR framework returning 200 for a missing resource is an HTTP-correctness bug that misleads caches, crawlers (soft-404), and API clients.

Severity adjusted from high to medium: the impact is confined to status-line correctness (caching/crawling/client semantics). There is no security, data-integrity, crash, or content-corruption impact — the page body itself is correct. Real but moderate.

Note on the report's citations: `mod.ts:25` is cited for profile() but line 25 is actually issue() in board/mod.ts; profile() lives in user/mod.ts:9-14. The structural bug and the core evidence lines (core.ts:356, core.ts:220-222) are accurate.
```

### 24. inject() is non-functional inside island setup() (server SSR and client hydration) — setup() is never wrapped in runInInjector, contradicting the documented contract and the inject() error message
- **severity:** medium  ·  **category:** logic
- **area:** DI + in-process Backend (ui/.sprig/core.ts injector lifecycle; island setup() injector context; clientRoot)
- **location:** `ui/.sprig/core.ts:158-166 (inject/current), ui/.sprig/core.ts:350 (the ONLY runInInjector call), ui/.sprig/compiler/render.ts:172 (comp.island.scope(inputs) during SSR), ui/.sprig/compiler/mod.ts:49 (def.setup(makeServerCtx(inputs))), ui/.sprig/compiler/hydrate.ts:183 (entry.setup(clientCtx(inputs)))`
- **expected:** inject() should resolve inside island setup() — the inject() error string explicitly names setup() as a valid context (core.ts:163), and core.ts documents a 'root → route → component' injector hierarchy with scope "both"/"client" services (core.ts:51,129). setup() should run wrapped in runInInjector against a route/component child injector (client: a child of clientRoot()).
- **actual:** setup() runs with current===undefined on BOTH sides, so any inject() call in setup() throws. The capability the framework advertises (DI in components/islands, scope:"both"/"client") is unreachable; only resolve.ts can use inject(). Currently latent (no shipped island calls inject) but a genuine broken contract that 500s the page if used server-side.
- **repro:**
```
White-box: `grep -rn runInInjector ui/.sprig` returns the definition (core.ts:168) and exactly ONE call site (core.ts:350) wrapping mod.resolve() only. Island setup() runs with no injector: server at compiler/mod.ts:49 `def.setup(makeServerCtx(inputs))` (from render.ts:172), client at compiler/hydrate.ts:183 `entry.setup(clientCtx(inputs))`. makeServerCtx (compiler/island.ts:7) and clientCtx (hydrate.ts:232) do not call runInInjector, so module-level `current` (core.ts:158) is undefined during setup().

Empirical (from repo root):
  import { inject, token } from "@sprig/core";
  import { makeServerCtx } from "./ui/.sprig/compiler/island.ts";
  const FooSvc = token("Foo", { scope: "both", factory: () => ({ hi: 1 }) });
  function setup(_c){ return { x: inject(FooSvc) }; }
  try { setup(makeServerCtx({})); } catch(e){ console.log("THREW:", e.message); }
Run: /opt/homebrew/bin/deno run -A --config deno.json <file>.ts
Output: THREW: inject() must be called synchronously within setup(), resolve(), or a service constructor

End-to-end: add `inject(SomeToken)` to any island's defineComponent setup (e.g. ui/src/shared-components/counter/logic.ts) and GET the page containing that island → setup() throws; on the server it is uncaught through render.ts:172 and the bootstrap.fetch handler (core.ts:330-358, no try/catch) → HTTP 500 for the whole page; on the client it throws inside hydrateIsland after el.dataset.sprigHydrated is set (hydrate.ts:178) → the island is marked hydrated but dead.

Expected: setup() should run inside runInInjector against a route/component child injector (client: a child of clientRoot(), core.ts:153) so inject() resolves, matching the documented scope "both"/"client" and the inject() error message.
```
- **evidence:**
```
core.ts:350 is the sole runInInjector call site (verified by repo-wide grep). render.ts:172 `const scope = comp.island.scope(inputs)`; mod.ts:49 `island = { scope: (inputs) => def.setup(makeServerCtx(inputs)) ... }`; hydrate.ts:183 `const scope = entry.setup(clientCtx(inputs))`. inject() at core.ts:161-166 throws when `current` is falsy.
```
- **independent verification:**
```
Verified all cited facts and empirically reproduced the throw.

1. runInInjector has exactly one runtime call site. Repo-wide grep over ui/.sprig shows only the definition (core.ts:168) and one call (core.ts:350) which wraps mod.resolve() only. (The other matches are docs and fixture tests.)

2. Island setup() is invoked with NO injector active:
   - Server: ui/.sprig/compiler/mod.ts:49 `island = { scope: (inputs) => def.setup(makeServerCtx(inputs)) ... }`, reached from render.ts:172 `const scope = comp.island.scope(inputs)`.
   - Client: ui/.sprig/compiler/hydrate.ts:183 `const scope = entry.setup(clientCtx(inputs))`.
   I read makeServerCtx (compiler/island.ts:7-19) and clientCtx (hydrate.ts:232-244): neither calls runInInjector; both only build input/output/model accessors. So `current` (core.ts:158) stays undefined through setup().

3. inject() (core.ts:161-166) throws when `current` is falsy with the message at core.ts:163 that explicitly names setup() as a valid context — a self-contradicting contract.

4. Empirical reproduction (ran with /opt/homebrew/bin/deno from repo root, using the project import map): a setup() that calls inject(token) via the exact server path `setup(makeServerCtx({}))` printed: THREW: "inject() must be called synchronously within setup(), resolve(), or a service constructor".

5. Server blast radius confirmed: render.ts has no try/catch around line 172, and the bootstrap.fetch handler (core.ts:330-358) has no try/catch — so the throw propagates uncaught into the request, yielding an HTTP 500 for the entire page.

This is a genuine broken contract: the framework documents DI in components/islands with scope "both"/"client" (core.ts:76,89) and a root→route→component injector hierarchy (core.ts:93), and the inject() error string names setup(), yet inject() is unreachable from any island setup() on either side. It is currently latent (no shipped island calls inject — I confirmed by reproducing synthetically), which is why severity is medium rather than high: no active production failure, but any first use of the advertised capability server-side 500s the page. Not working-as-designed, not a misunderstanding, not unreachable.
```

### 25. backendClient.get() crashes (and leaks the response body) when a 200 response is not valid JSON; bootstrap.fetch has no try/catch, so resolve/render errors become unhandled rejections that surface the raw error
- **severity:** medium  ·  **category:** resource-leak
- **area:** DI + in-process Backend (ui/.sprig/core.ts, ui/src/services)
- **location:** `ui/.sprig/core.ts:215-227 (backendClient.get does `await res.json()` only guarded by res.ok, no try/catch, no body cancel on the throw path) and ui/.sprig/core.ts:331-359 (bootstrap.fetch awaits resolve()/render() with no try/catch)`
- **expected:** get() should defensively handle a non-JSON 200 (and cancel/drain the body), and bootstrap.fetch should wrap resolve()/render() so any failure yields a controlled 500 without propagating an uncaught rejection or echoing internal error text.
- **actual:** get() throws `Unexpected token '<' ... is not valid JSON` with the body never cancelled (leak), and bootstrap.fetch rejects with the raw `resolve exploded: secret stack detail` message — no graceful 500, internal error detail propagates.
- **repro:**
```
Run inside the repo (so the import map resolves @sprig/core):

  cp /tmp/repro.ts <repo>/repro_tmp.ts
  deno run -A --config <repo>/deno.json <repo>/repro_tmp.ts

repro.ts:

  import { backendClient, bootstrap } from "@sprig/core";

  // Part 1: 200 + non-JSON body -> get() throws, body not cancelled (leak)
  const be = backendClient(((_p, _i) =>
    Promise.resolve(new Response("<html>not json</html>", {
      status: 200, headers: { "content-type": "text/html" },
    }))) as typeof fetch);
  try {
    console.log("get RETURNED:", await be.get("/http/board", { method: "POST" }));
  } catch (e) { console.log("get THREW:", (e as Error).message); }

  // Part 2: resolve throws -> bootstrap.fetch rejects with raw internal message
  const app = bootstrap({
    routes: [{ path: "/ui/boom", load: "boom" }], base: "",
    modules: { boom: { resolve: () => { throw new Error("resolve exploded: secret stack detail"); } } },
    render: async (_l, i) => `<html>${JSON.stringify(i)}</html>`,
  });
  try { console.log("status:", (await app.fetch(new Request("http://x/ui/boom"))).status); }
  catch (e) { console.log("bootstrap.fetch REJECTED ->", (e as Error).message); }

Observed output:
  get THREW on 200+non-JSON body: Unexpected token '<', "<html>not "... is not valid JSON
  bootstrap.fetch REJECTED (no try/catch) -> resolve exploded: secret stack detail
```
- **evidence:**
```
Reproduced live: `get THREW on 200+non-JSON body: Unexpected token '<', "<html>not "... is not valid JSON` and `bootstrap.fetch REJECTED (no try/catch) -> resolve exploded: secret stack detail`. In production a backend 200 with an HTML/text body (e.g. an upstream error page) crashes the SSR request; the get() success path (core.ts:223-224) only cancels the body on the !ok branch, not when json() throws.
```
- **independent verification:**
```
Independently reproduced live, both halves confirmed against /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/core.ts.

Part 1 — get() (core.ts:215-227): The success path is `return { ok: true, status: res.status, data: (await res.json()) as T }` at line 224. It is guarded only by `res.ok` (line 220), with no try/catch. When a backend returns HTTP 200 with a non-JSON body (an upstream HTML error page, empty body, or a wrong content-type), `res.json()` throws `SyntaxError: Unexpected token '<' ... is not valid JSON`, crashing the SSR data fetch. The body is only ever cancelled on the `!ok` branch (line 221: `await res.body?.cancel()`); on the throwing success path the body is never cancelled or drained, so it leaks. The leak framing is accurate — the existing `!ok` cancel shows the body-draining contract is intended, so the success path omitting it is an oversight, not by-design.

Part 2 — bootstrap.fetch (core.ts:331-359): `await runInInjector(root, () => mod.resolve!(...))` (line 350) and `await config.render(...)` (line 354) are awaited with no surrounding try/catch. Any failure in resolve() or render() rejects the fetch() promise with the raw error, propagating internal detail (e.g. "resolve exploded: secret stack detail") instead of a controlled 500. Under `deno serve` this surfaces the handler rejection rather than a graceful error page.

This is a genuine, reachable defect (any misbehaving/non-JSON-200 backend triggers part 1; any resolve/render throw triggers part 2), not intended behavior. Medium severity is appropriate: it crashes individual SSR requests and leaks a response body, but requires a backend/module to misbehave and does not corrupt global state.
```

### 26. Concurrent rebuilds race the same outDir and corrupt the dev bundle (no in-flight guard on the debounced watcher)
- **severity:** medium  ·  **category:** correctness
- **area:** Dev/HMR server (ui/.sprig/compiler/dev.ts + hmr.ts)
- **location:** `ui/.sprig/compiler/dev.ts:38-79 (watcher loop + handleChange) and ui/.sprig/compiler/build.ts:84-99 (buildClient deletes all .js in outDir, then bundles)`
- **expected:** Overlapping change batches should be serialized (a single in-flight build, with the next batch queued/coalesced) so each rebuild produces a consistent outDir.
- **actual:** handleChange() is fired from the debounce timer (dev.ts:44-47) with no concurrency guard, no `await` chaining, and no in-flight flag. Two buildClient() runs interleave: one process's file deletion (build.ts:88) races the other's bundle output, producing missing/partial chunks, a stale manifest.json, or a failed bundle — and then the dev server pushes a `reload` (dev.ts:76) to a client that loads a half-written bundle.
- **repro:**
```
Files: /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/dev.ts (lines 38-79), /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/build.ts (lines 84-120).

Steps (dev server running with SPRIG_DEV, e.g. via createDevServer over ui/src):
1. Edit and save any island logic.ts (e.g. ui/src/<island>/logic.ts). After 60ms, handleChange([logic.ts]) starts buildClient() → step-3 removes all *.js in outDir (build.ts:88), then `deno bundle` runs; with Tailwind (buildCss, build.ts:103) the whole pass takes >1s.
2. Within that >1s window, save a second file (another .ts, or touch the same one again). A fresh 60ms debounce timer fires a SECOND handleChange()/buildClient() — nothing checks the first is still running.
3. Observe the interleave: the second run's build.ts:86-89 cleanup deletes the first run's freshly emitted client.js/isl.*.js/chunk-*.js; both `deno bundle --outdir outDir` (build.ts:92-96) write the same filenames concurrently; the first run's step-5 collection (build.ts:108-115: readDir → Deno.stat / shortHash→Deno.readFile) races the second run's Deno.remove and throws NotFound → "client bundle failed"/stat error caught at dev.ts:47 → {type:"error"} pushed. On a non-erroring race, a stale/partial outDir + manifest.json is produced and dev.ts:76 pushes {type:"reload"} to a client that loads the half-written bundle.

Proof of absence of any guard: `grep -nE 'building|inFlight|lock|mutex|busy|running|queue|chain' ui/.sprig/compiler/dev.ts ui/.sprig/compiler/hmr.ts` returns no concurrency guard. The single `timer` (dev.ts:37,43-44) debounces event bursts only; it does not serialize overlapping handleChange/buildClient executions.

Expected: overlapping change batches serialized to a single in-flight build with the next batch coalesced/queued, so each rebuild yields a consistent outDir + manifest before any reload is pushed.
```
- **evidence:**
```
dev.ts:44-48 schedules `handleChange(paths).catch(...)` from a setTimeout with no guard; `grep -n 'building|inFlight|lock|mutex|busy|running' dev.ts` returns nothing (no guard exists). build.ts:86-90 unconditionally deletes all *.js/*.js.map in outDir at the start of every buildClient(), and build.ts:92-96 bundles into the same outDir. CSS path has the same hazard: handleChange() can call buildCss() (dev.ts:69) concurrently with a buildClient() that also calls buildCss() (build.ts:103), both writing outDir/app.css.
```
- **independent verification:**
```
Verified against the cited code; the claim is accurate.

dev.ts:36-50 — the watcher debounces bursts with a single reusable `timer` (clearTimeout + 60ms setTimeout). When the timer fires it calls `handleChange(paths).catch(...)` (dev.ts:44-47). Critically, `timer` is reassigned on the very next fs event regardless of whether the prior `handleChange()` promise has resolved. There is no in-flight flag, no lock, no await-chaining between consecutive `handleChange` invocations. I grepped dev.ts and hmr.ts for building/inFlight/lock/mutex/busy/running/queue/chain — no guard exists (the only `running`-ish hits are unrelated `c.enqueue` SSE calls).

handleChange (dev.ts:52-79) is async and awaits buildClient/buildCss internally, but that only serializes work *within one call*, not *across calls*. Because Tailwind + `deno bundle` take >1s (build.ts comments and the two subprocess spawns at build.ts:92-96 and 148-156 confirm the latency), a save during an in-progress build schedules a fresh 60ms timer that fires a SECOND handleChange()/buildClient() while the first is still awaiting its bundle.

The two buildClient runs then interleave on the SAME outDir:
- build.ts:85-90 unconditionally `Deno.remove`s EVERY *.js/*.js.map in outDir at the start of each run. The second run's cleanup deletes the first run's just-emitted chunk-*.js/client.js/isl.*.js mid-flight.
- build.ts:92-96 both spawn `deno bundle --outdir <outDir>` writing the same stable filenames (client.js, isl.<sel>.js) and content-hashed chunk-*.js concurrently.
- build.ts:106-119 step-5 then `Deno.readDir(outDir)` + `Deno.stat`/`shortHash`→`Deno.readFile` each file; a concurrent `Deno.remove` from the other run between readDir and stat/readFile throws NotFound, hard-failing the build (caught at dev.ts:47 → pushes {type:"error"}).
- On success-but-raced, dev.ts:76 still pushes {type:"reload"} to clients that may load a half-written/stale-manifest bundle.

The CSS hazard is also real: handleChange can call buildCss() (dev.ts:69) for a styles.css change concurrently with a buildClient() (from a .ts change) that itself calls buildCss() at build.ts:103 — both write outDir/app.css.

Severity: medium (not higher) because it is strictly SPRIG_DEV-only, requires a second save within the ~1s+ build window, is transient, and self-heals on the next clean save. But it can hard-error the build and push a reload to a client loading a corrupt bundle, degrading the dev/HMR experience until the next save — a genuine correctness defect, not intended behavior. The fix (serialize builds via a single in-flight promise with a coalesced trailing run) is exactly what's missing.
```

### 27. Dev island AST fetch has no response.ok / error handling: a 404 from /_sprig/ast/<sel> makes r.json() throw, leaving a permanently dead island + unhandled promise rejection
- **severity:** medium  ·  **category:** protocol
- **area:** Dev/HMR server (ui/.sprig/compiler/dev.ts, hmr.ts, hydrate.ts dev paths)
- **location:** `ui/.sprig/compiler/hydrate.ts:64-66 (fetchAst) reached from the dev island chunk generated at ui/.sprig/compiler/build.ts:70-71`
- **expected:** On a non-OK AST response the island should fail gracefully: skip hydration for that selector, log a clear `[sprig] failed to load island` style error, and not produce an unhandled rejection — mirroring loadIsland()'s `.catch` at hydrate.ts:129-132.
- **actual:** `r.json()` parses the 404/500 plain-text body, throws SyntaxError. Because the dev chunk's `.then` chain has no rejection handler, the error becomes an unhandled promise rejection, and registerIsland() is never called, so the island stays un-hydrated (dead/interactivity gone) with no recovery — exactly the AST-fetch error-handling gap.
- **repro:**
```
Run the dev/HMR build (`sprig build --dev`) so each island chunk `isl.<sel>.js` is the dev variant: `fetchAst(...).then((t) => registerIsland(...))` (build.ts:70-71). Cause the AST endpoint to return non-OK — easiest is to make `astFor(sel)` return null (rename/delete the island folder so its selector is no longer in the renderer's `reg`, or serve a stale chunk built against a selector the renderer no longer registers). The endpoint then returns `new Response("not found", { status: 404 })` (dev.ts:106). The chunk runs `r.json()` on the plain-text body and throws SyntaxError; with no `r.ok` check and no `.catch`, the island never hydrates and an unhandled promise rejection fires.

Minimal standalone proof (matches fetchAst's exact `.then((r) => r.json())` against dev.ts's 404 body):

  const r404 = new Response("not found", { status: 404 });
  globalThis.addEventListener("unhandledrejection", (e) => { console.log("UNHANDLED:", String(e.reason)); e.preventDefault(); });
  Promise.resolve(r404).then((r) => r.json()).then((t) => console.log("registerIsland", t));
  // -> UNHANDLED: SyntaxError: Unexpected token 'o', "not found" is not valid JSON
  // -> registerIsland never logged; r404.ok === false (no guard)

Fix: in fetchAst add `if (!r.ok) throw new Error(...)`, and give the dev island chunk a `.catch` that logs `[sprig] failed to load island "<sel>"` and skips hydration — mirroring loadIsland's catch at hydrate.ts:129-132.
```
- **evidence:**
```
hydrate.ts:64-66 `return await fetch(`${base}/_sprig/ast/${sel}`).then((r) => r.json());` — no `if (!r.ok)`, no try/catch. build.ts:70-71 `fetchAst(...).then((t) => registerIsland(...))` — no `.catch`. dev.ts:103-106 returns a non-JSON 404 body `not found` when astFor() is null. Contrast loadIsland (hydrate.ts:129-132) which DOES `.catch`, showing the prod path guards import failures but the dev AST-fetch path does not.
```
- **independent verification:**
```
Verified against the cited source. All four links of the chain are exactly as claimed:

1. ui/.sprig/compiler/build.ts:70-71 — the generated dev island chunk is `fetchAst(__cfg.base ?? "/ui", "<sel>").then((t) => registerIsland(...))` with NO `.catch`.
2. ui/.sprig/compiler/hydrate.ts:64-66 — `fetchAst` is `return await fetch(`${base}/_sprig/ast/${sel}`).then((r) => r.json());` with NO `r.ok` check and NO try/catch.
3. ui/.sprig/compiler/dev.ts:102-106 — when `astFor(sel)` is null, the endpoint returns `new Response("not found", { status: 404 })`, a non-JSON plain-text body.
4. ui/.sprig/compiler/mod.ts:92-95 — `astFor` returns null whenever the selector isn't in the renderer's registry (`reg.get(selector)` undefined), which is genuinely reachable: a stale served chunk built against a renamed/deleted island, or any 5xx.

I reproduced step 2+3 directly: feeding `r.json()` the 404 `"not found"` body throws `SyntaxError: Unexpected token 'o', "not found" is not valid JSON`, and since the dev chunk's `.then` chain has no rejection handler, an `unhandledrejection` fires (confirmed via an event listener). `r.ok` is false on the 404, proving no guard short-circuits. registerIsland() never runs, so the island stays un-hydrated with no recovery.

The asymmetry the report cites is real: loadIsland (hydrate.ts:129-132) DOES `.catch` import failures and logs `[sprig] failed to load island`, while the dev AST-fetch path has neither an `r.ok` guard nor a `.catch`.

Downgraded severity from high to medium: the fault is dev/HMR-server-only (production island chunks bake the AST inline and never call fetchAst — build.ts:74-78), and only triggers on an edge condition (stale chunk / renamed-or-deleted island / endpoint 4xx-5xx). Impact is a degraded dev experience (silently dead island + noisy unhandled rejection), not a production user-facing failure. Genuine, reproducible defect — but not high.
```

### 28. Route :id param is never URL-decoded: percent-encoded segments mis-match the backend and the raw encoding is reflected in the page
- **severity:** medium  ·  **category:** correctness
- **area:** SSR dynamic params: /ui/issues/:id and /ui/users/:id route-param decoding
- **location:** `ui/.sprig/core.ts:290-302 (matchRoute/walk stores raw path segments as params, no decodeURIComponent); consumed at ui/src/pages/issue/resolve.ts:7 and ui/src/pages/user/resolve.ts:5 (ctx.params.id passed straight to the backend and reflected)`
- **expected:** The :id segment should be URL-decoded (decodeURIComponent) before use, matching the browser/RFC convention. A percent-encoded form of a valid id (SPR%2D101, %61da) must resolve to the same resource as its literal form (SPR-101, ada), and the missing-branch message must display the decoded id (e.g. 'No user with id "josé"'), not raw percent-escapes.
- **actual:** walk() does `params[rs[i].slice(1)] = u;` with `u` being the raw, still-encoded path segment (no decodeURIComponent anywhere in the UI routing layer; the only decodeURIComponent in ui/.sprig is dev.ts:103 for the AST fetch path, not param extraction). So any id containing a character that a client/link percent-encodes (a unicode username, a space, or even an encoded hyphen) silently fails to match the backend and renders the 'missing' branch, and the reflected id shows the raw encoding. A valid resource is shown as not-found.
- **repro:**
```
App running on port 8200 (repo root). Run:
1) curl -s 'http://localhost:8200/ui/issues/SPR-101' | grep -o 'SPR-101'  -> renders the real issue.
   curl -s 'http://localhost:8200/ui/issues/SPR%2D101' | grep -oE 'No issue with id "[^"]*"'  -> 'No issue with id "SPR%2D101"' (status 200) even though SPR%2D101 is just the encoded form of valid SPR-101.
2) curl -s 'http://localhost:8200/ui/users/ada'  -> renders Ada's profile.
   curl -s 'http://localhost:8200/ui/users/%61da'  -> 'No user with id "%61da"' (%61 decodes to 'a', i.e. valid 'ada').
3) curl -s 'http://localhost:8200/ui/users/jos%C3%A9'  -> reflected raw as 'No user with id "jos%C3%A9"' instead of decoded 'josé'.
   curl -s 'http://localhost:8200/ui/issues/SPR%20101'  -> 'No issue with id "SPR%20101"'.
Root cause: ui/.sprig/core.ts:336 path=url.pathname (encoding preserved) -> matchRoute -> walk() line 302 `params[rs[i].slice(1)] = u;` stores raw segment, no decodeURIComponent. Fix: decode each captured param (e.g. params[name] = decodeURIComponent(u)) in walk(), or decode the pathname before matching.
```
- **evidence:**
```
ui/.sprig/core.ts:291 `const segs = pathname.split("/").filter(...)` and :302 `params[rs[i].slice(1)] = u;` — no decoding. Live output: 'No issue with id "SPR%2D101".' for the encoding of valid SPR-101; 'No user with id "%61da".' for the encoding of valid ada; 'No issue with id "SPR%20101".' for an encoded space. grep over ui/.sprig confirms decodeURIComponent appears only at dev.ts:103.
```
- **independent verification:**
```
Verified both by code inspection and live reproduction. In ui/.sprig/core.ts, bootstrap().fetch derives `path = url.pathname` (line 336) — and Web URL.pathname preserves percent-encoding, it does NOT decode it — then passes it to matchRoute. walk() at line 302 does `params[rs[i].slice(1)] = u;` storing the raw, still-encoded path segment with no decodeURIComponent. A repo-wide grep confirms decodeURIComponent appears only once in ui/.sprig (compiler/dev.ts:103, for the AST fetch path), never in the param-extraction routing layer. The raw param flows directly into resolve() (core.ts:350) and into ui/src/pages/issue/resolve.ts:7 (board.issue(ctx.params.id)) and ui/src/pages/user/resolve.ts:6 (user.profile(ctx.params.id)), and is reflected in the page. Live app on port 8200 confirms: encoded forms of VALID ids resolve to the not-found branch and reflect raw escapes. This is a genuine correctness defect, not working-as-designed: URL path segments are percent-encoded by RFC/browser convention, and the universal expectation is to decodeURIComponent before matching/use. Severity medium: no crash or data corruption, but valid resources accessed via their encoded form (unicode usernames, ids with reserved chars or spaces) silently render as not-found, and raw escapes leak into user-facing text.
```

### 29. Soft-nav fetch rejection (network/abort/HTTP error) is unhandled: navigation fails with no full-nav fallback, leaving the page stuck
- **severity:** medium  ·  **category:** logic
- **area:** Soft navigation (setupSoftNav / outlet swap / island re-hydration in hydrate.ts)
- **location:** `ui/.sprig/compiler/hydrate.ts:151-160 (intercept async handler; fetch at :152 has no try/catch)`
- **expected:** On any fetch failure the soft-nav should fall back to a real browser navigation (e.g. `location.assign(e.destination.url)`), exactly as it already does when the response has no <sprig-outlet> (line 157-159). Failure handling should be consistent.
- **actual:** A missing-outlet response falls back to full nav (line 158), but a fetch REJECTION (network error, DNS failure, TLS error, or an abort that throws) has no catch and no fallback. The intercept handler promise rejects, the navigation is abandoned, and the user is left on the old page/content with no recovery and no full reload — an inconsistent, dead-end navigation.
- **repro:**
```
On an issue/board page served under cfg.base (e.g. /ui), in a browser that supports the Navigation API (Chromium), click a same-base in-app link (<a href="/ui/..."> ) while the server is unreachable or the network is offline (e.g. stop the dev server, or DevTools > Network > Offline, then click the link). Observed: the navigate event is intercepted (hydrate.ts:149), `await fetch(e.destination.url,{signal}).then(r=>r.text())` at line 152 rejects, the un-caught rejection propagates out of the async handler() (lines 151-170 have no try/catch), the Navigation API fires navigateerror, the address bar URL rolls back, and the document is NOT reloaded — the user stays on the old page/content with no fallback to a real browser navigation and no error surfaced. Expected: on any fetch failure, fall back to a full navigation (location.assign(e.destination.url)) exactly as the missing-outlet branch already does at line 158, e.g. wrap the handler body in try/catch and call location.assign(e.destination.url) (skipping when e.signal.aborted, since that means a superseding navigation) in the catch.
```
- **evidence:**
```
hydrate.ts:151-152 `async handler() { const html = await fetch(e.destination.url, { signal: e.signal }).then((r) => r.text());` — no surrounding try/catch anywhere in the handler (lines 149-171). The only fallback to `location.assign` is gated on `!next || !cur` (line 157), reachable ONLY if fetch resolves. Compare the resolved-but-no-outlet branch (handled) vs the rejected branch (unhandled).
```
- **independent verification:**
```
Verified by direct inspection of /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/hydrate.ts (lines 149-171). The Navigation API `intercept()` handler at line 151 does `const html = await fetch(e.destination.url, { signal: e.signal }).then((r) => r.text())` at line 152 with NO try/catch anywhere in the handler body. The only fallback to a real browser navigation, `location.assign(e.destination.url)` at line 158, is gated on `if (!next || !cur)` (line 157), which is reachable ONLY after fetch resolves and `.text()` succeeds. A grep across ui/.sprig confirms there is no global `navigateerror`/`navigatesuccess` listener and the only other location.* call (hmr.ts:32 location.reload) is unrelated dev HMR. Therefore, when fetch rejects (server unreachable, offline, DNS/TLS error, or an HTTP-transport failure), the handler's returned promise rejects, the Navigation API marks the navigation failed (navigateerror), rolls the URL back, and does NOT reload the document — the user is left on the old page with no automatic recovery. This is inconsistent with the deliberate full-nav fallback already implemented for the resolved-but-no-outlet branch, which proves the intended failure semantics are 'fall back to real navigation.' The defect is genuine and reachable. Two corrections to the report: (1) the abort path is mostly a non-issue — when e.signal aborts it is almost always because a superseding navigation replaced this one, so the rejection is benign and the new nav proceeds; the real defect is the network/transport rejection path. (2) Severity is more accurately medium than high: it requires a network failure to trigger, and because the URL rolls back the app is not permanently corrupted (a manual reload recovers), it is a resilience/UX dead-end rather than data loss or a crash. Note: this is also gated on the browser having the Navigation API (nav check at line 141); browsers without it already use normal navigation and are unaffected.
```

### 30. Soft-nav forces scrollTo(0,0) on every navigation including back/forward (traverse), destroying scroll restoration
- **severity:** medium  ·  **category:** logic
- **area:** Soft navigation (setupSoftNav in ui/.sprig/compiler/hydrate.ts)
- **location:** `ui/.sprig/compiler/hydrate.ts:149-165 (e.intercept scroll:'manual' + swap()'s unconditional globalThis.scrollTo(0,0))`
- **expected:** On a back/forward (traverse) navigation, the previous scroll position should be restored (scrollY ~= 400), matching normal browser back/forward behavior.
- **actual:** scrollY is 0 after back(). The intercept sets scroll:'manual' (disabling the browser's automatic scroll restoration) and swap() always calls globalThis.scrollTo(0,0) regardless of e.navigationType. Pushing to top is correct only for 'push'/'replace'; for 'traverse' it wipes the saved scroll position. Proven live: scrollBefore=400, scrollAfterBack=0 (docH=747, innerH=300).
- **repro:**
```
1. Use a viewport small enough that pages scroll (e.g. 500x300; in the cited live run docH=747, innerH=300).
2. Soft-navigate to a content page: navigation.navigate('/ui/issues/SPR-101').
3. Scroll down: window.scrollTo(0, 400); confirm window.scrollY === 400.
4. Forward-navigate (push): navigation.navigate('/ui/board').
5. Go back: navigation.back() (this is a 'traverse' navigation).
6. Read window.scrollY.
Expected: scrollY restored to ~400 (native back/forward behavior).
Actual: scrollY === 0. The intercept's scroll:"manual" (hydrate.ts:150) disables browser auto-restore, and swap()'s unconditional globalThis.scrollTo(0,0) (hydrate.ts:164) — with no branch on e.navigationType — overrides the saved position on traverse.
Fix direction: guard the scrollTo so it only runs for non-traverse navigations (e.navigationType !== "traverse"), and restore the saved position on traverse.
```
- **evidence:**
```
Live Playwright run returned {docH:747, innerH:300, scrollBefore:400, scrollAfterBack:0}. Source: hydrate.ts:150 `scroll: "manual"` and hydrate.ts:164 `globalThis.scrollTo(0, 0);` inside swap(), with no branch on e.navigationType. (Same root cause as the reload bug: the navigate handler ignores e.navigationType.)
```
- **independent verification:**
```
Verified directly against the cited source (ui/.sprig/compiler/hydrate.ts:139-173). The navigate interceptor (line 149) passes scroll: "manual" (line 150), which opts out of the browser's automatic scroll restoration for ALL intercepted same-origin navigations — including traverse (back/forward). The swap() function then calls globalThis.scrollTo(0, 0) unconditionally (line 164) with no branch on e.navigationType. The Navigation API populates e.navigationType with "push" | "replace" | "reload" | "traverse"; scrolling to top is correct only for push/replace. For traverse, the previously-saved scroll position should be restored, but this handler wipes it to 0. A grep of the entire ui/.sprig runtime confirms these two lines (150 and 164) are the ONLY scroll-related code — there is no compensating restoration path, so back/forward on any scrollable page deterministically lands at scrollY=0. This is a genuine logic defect that breaks native-browser back/forward scroll behavior, not intended behavior. It shares the root cause noted in the claim: the handler ignores e.navigationType. Severity medium is appropriate — a real UX regression, not data loss or a crash. (Note: I confirmed the defect from the source statically and the cited Playwright numbers {scrollBefore:400, scrollAfterBack:0} are consistent with the code; the absence of any traverse branch makes the outcome inevitable regardless of viewport.)
```

### 31. Soft-nav unconditionally scrolls to top on back/forward (traverse) navigations, destroying browser scroll restoration
- **severity:** medium  ·  **category:** correctness
- **area:** Soft navigation (setupSoftNav in ui/.sprig/compiler/hydrate.ts): outlet swap, scroll handling, view-transition path, re-hydration
- **location:** `ui/.sprig/compiler/hydrate.ts:149-165 (intercept handler: scroll:"manual" at :150, unconditional globalThis.scrollTo(0,0) at :164)`
- **expected:** For e.navigationType === 'traverse' (back/forward) the prior scroll position should be restored (native behavior). scrollTo(0,0) should only apply to push/replace navigations.
- **actual:** e.intercept sets scroll:"manual" (disabling the browser's automatic scroll restoration) and the handler then calls globalThis.scrollTo(0,0) for EVERY intercepted navigation, including traverse/back-forward — so back/forward always lands at the top instead of where the user was.
- **repro:**
```
In a Chromium-based browser (Navigation API supported, so setupSoftNav engages):
1. Open <base>/board (e.g. /ui/board), a page tall enough to scroll.
2. Scroll the board down by a noticeable amount.
3. Click a same-origin link under <base> to a detail page (e.g. /ui/issues/SPR-101). The navigate listener intercepts it; the <sprig-outlet> innerHTML is swapped and the page is forced to top (scrollTo(0,0)).
4. Press the browser Back button — this is a 'traverse' navigation. It is intercepted at hydrate.ts:144, scroll:"manual" (line 150) disables native scroll restoration, and the swap closure runs globalThis.scrollTo(0, 0) at line 164.

Expected: the board page is restored at the prior scroll offset (native back/forward behavior).
Actual: the board page is forced to scrollTo(0, 0); the prior scroll position is lost on every back/forward.

Code cited: ui/.sprig/compiler/hydrate.ts:149-165 — scroll:"manual" at :150 and the unguarded globalThis.scrollTo(0,0) at :164 inside the intercept handler, with no e.navigationType check.
```
- **evidence:**
```
hydrate.ts:150 `scroll: "manual"` opts out of native restoration; hydrate.ts:164 `globalThis.scrollTo(0, 0)` runs in the swap closure with no guard on e.navigationType. grep over ui/ shows scrollTo and no 'navigationType'/'scrollRestoration' anywhere (only hit: hydrate.ts:164). Distinct from the reported query-only/state-discard finding: this concerns scroll position on ordinary back/forward between real pages, not which navigations are intercepted.
```
- **independent verification:**
```
Verified by direct inspection of ui/.sprig/compiler/hydrate.ts (setupSoftNav, lines 144-172) plus a confirming grep.

The 'navigate' listener (line 144) fires for ALL navigation types, including 'traverse' (back/forward). The only gating before intercept is canIntercept/hashChange/downloadRequest/formData and same-origin/base-path checks (lines 145-148) — none of which exclude traverse. So back/forward navigations between intercepted pages are intercepted.

At line 149-150, e.intercept is given scroll: "manual". Per the Navigation API, "manual" opts the page OUT of the browser's automatic scroll-position handling, including the automatic restoration of the saved scroll offset that a traverse (back/forward) navigation would otherwise perform. With "manual", the developer owns scroll restoration.

The handler's swap closure (lines 161-165) then calls globalThis.scrollTo(0, 0) unconditionally, inside the view-transition swap, with NO check of e.navigationType. So every intercepted navigation — push, replace, AND traverse — is forced to the top.

Net effect: pressing Back/Forward lands the user at scroll offset 0 instead of restoring where they were, because (a) native restoration was disabled by scroll:"manual" and (b) the only scroll logic present hard-codes (0,0). 

Grep over ui/ confirms the absence of any compensating logic: the ONLY matches for scrollTo/scroll:/navigationType/scrollRestoration are hydrate.ts:150 (scroll:"manual") and hydrate.ts:164 (scrollTo(0,0)). There is no e.navigationType branch and no scrollRestoration usage anywhere.

This is working-as-coded but not working-as-intended: a soft-nav SPA that intercepts back/forward is expected to restore the prior scroll position on traverse (which is what the browser would do natively if scroll:"manual" hadn't been set). The fix is to guard scrollTo(0,0) so it runs only for non-traverse (push/replace) navigations, e.g. `if (e.navigationType !== "traverse") globalThis.scrollTo(0, 0);`, letting the Navigation API restore traverse offsets (or restoring them manually).

Severity medium is appropriate: it's a real, reliably-reproducible UX correctness regression on every back/forward, not a crash or data-loss issue. It only manifests in Navigation-API-capable (Chromium) browsers where setupSoftNav engages (line 142 bails if navigation is unsupported), which is exactly the path described.
```

### 32. Serialized AST collapses repeated fields, so multi-arg pipes hydrate with the LAST arg on the client vs the FIRST on the server — SSR/client divergence
- **severity:** medium  ·  **category:** correctness
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts + serialize.ts) — pipe argument handling
- **location:** `ui/.sprig/compiler/serialize.ts:35-36 (toSNode field map) interacting with ui/.sprig/compiler/expr.ts:139-140`
- **expected:** Server-rendered HTML and client-hydrated HTML for the same expression are identical.
- **actual:** For `slice:1:3`: SSR renders `slice(1, undefined)` (first arg), client hydration renders `slice(3, undefined)` (last arg) — different output before/after hydration (hydration mismatch / flicker), and both are wrong. More generally, serialize silently discards all-but-last of any repeated field, so the client AST is lossy relative to the server AST.
- **repro:**
```
In repo root, create a test file and run `deno test -A`:

```ts
import { parseTemplate } from "./ui/.sprig/compiler/parse.ts";
import { evalExpr } from "./ui/.sprig/compiler/expr.ts";
import { serialize, fromSerialized } from "./ui/.sprig/compiler/serialize.ts";
import type { Node } from "./ui/.sprig/compiler/node.ts";

function findPipe(n: Node): Node | null {
  if (n.type === "pipe_expression") return n;
  for (const c of n.namedChildren) { const f = findPipe(c); if (f) return f; }
  return null;
}

Deno.test("multi-arg pipe SSR vs client", async () => {
  const root = await parseTemplate(`{{ items | slice:1:3 }}`);
  const scope = { items: ["a","b","c","d","e"] };
  const serverPipe = findPipe(root)!;
  const server = evalExpr(serverPipe, scope);                 // ["b","c","d","e"]
  const clientPipe = findPipe(fromSerialized(serialize(root)))!;
  const client = evalExpr(clientPipe, scope);                 // ["d","e"]
  if (JSON.stringify(server) !== JSON.stringify(client))
    throw new Error(`DIVERGENCE server=${JSON.stringify(server)} client=${JSON.stringify(client)}`);
});
```

Observed output:
  SERVER argument field text: `:1`  → ["b","c","d","e"]
  CLIENT argument field text: `:3`  → ["d","e"]
  Error: DIVERGENCE server=["b","c","d","e"] client=["d","e"]
```
- **evidence:**
```
serialize.ts:36 `if (fname) f[fname] = idx;` (last write wins for repeated field names); serialize.ts:70-72 `childForFieldName` returns `c[f[name]]` → the last index; vs web-tree-sitter's first-match semantics used at expr.ts:139-140.
```
- **independent verification:**
```
Reproduced directly. The grammar (tree-sitter-angular-template/grammar.js:494) emits `repeat(field("argument", $.pipe_argument))`, so a multi-arg pipe like `slice:1:3` has MULTIPLE children all sharing the field name "argument".

Root cause chain confirmed:
1. serialize.ts:36 builds the field map with `if (fname) f[fname] = idx;` — last write wins, so only the LAST pipe_argument index survives in `f.argument`.
2. JsonNode.childForFieldName (serialize.ts:70-72) returns `c[f[name]]`, i.e. that last index.
3. web-tree-sitter's childForFieldName (used server-side) returns the FIRST matching child.
4. evalPipe (expr.ts:139-140) takes the truthy branch `node.childForFieldName("argument") ? [evalExpr(...)] : ...`, reading only that one field child and wrapping it as a single-element args array.

So for the SAME node, the server resolves `argument`→`:1` and the client resolves `argument`→`:3`.

Verification (parsed `{{ items | slice:1:3 }}`, scope items=[a,b,c,d,e], compared web-tree-sitter eval vs serialize→fromSerialized→eval):
- SERVER argument field text: `:1` → result `["b","c","d","e"]`  (slice(1))
- CLIENT argument field text: `:3` → result `["d","e"]`  (slice(3))

This is a genuine SSR/client hydration mismatch (server HTML != client-hydrated HTML) for any multi-arg pipe. As a secondary defect, even the server output is wrong (`slice(1)` instead of `slice(1,3)`) because the first branch of evalPipe only ever reads one "argument" field child and ignores the rest — but the reported defect (the divergence) is the load-bearing, reproducible one.

Severity medium is appropriate: real and user-visible (hydration flicker/mismatch + wrong output) but scoped to multi-argument pipes; single-arg pipes are unaffected since there is only one "argument" field. The serialize.ts field-collapsing is a general lossiness bug for any repeated field name, not just pipes.

Key locations: ui/.sprig/compiler/serialize.ts:36 and :70-72; ui/.sprig/compiler/expr.ts:139-140; grammar at tree-sitter-angular-template/grammar.js:487-497.
```

### 33. number/percent pipe with a digitsInfo whose minFraction > maxFraction (or maxFraction > 100) throws an uncaught RangeError, crashing SSR render with HTTP 500
- **severity:** medium  ·  **category:** crash
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts pipes + render.ts SSR path)
- **location:** `ui/.sprig/compiler/expr.ts:183-191 (formatNumber); reached from the `number` pipe at expr.ts:153 and the `percent` pipe at expr.ts:154; propagates uncaught through render.ts:78 (interpolation -> renderNode) and out of ui/.sprig/core.ts:353-356 (no try/catch around config.render), producing a 500`
- **expected:** An invalid/contradictory digitsInfo should be clamped, ignored, or produce a best-effort string (as `currency` does via its try/catch fallback). Render must not 500.
- **actual:** toLocaleString throws an uncaught RangeError; with no try/catch in formatNumber or in the core render path, the entire page render fails with HTTP 500.
- **repro:**
```
1. Node verification of the underlying Intl throw (mirrors expr.ts:185-190):
   /opt/homebrew/bin/node -e '
     const m="1.3-2".match(/^\d+\.(\d+)-(\d+)$/);   // ["1.3-2","3","2"]
     (42).toLocaleString("en-US",{minimumFractionDigits:Number(m[1]),maximumFractionDigits:Number(m[2])});
   '
   => Uncaught RangeError: maximumFractionDigits value is out of range.
   Same for "1.0-101" (max=101 > 100). "1.0-100" and "1.0-0" render fine.

2. End-to-end: add a template interpolation such as
   {{ value | number:'1.3-2' }}   or   {{ value | percent:'1.0-101' }}
   to any folder-component template, then request the route that renders it.
   - formatNumber (expr.ts:188) sets minFrac=3,maxFrac=2 and calls toLocaleString unguarded (expr.ts:190) -> RangeError
   - throw escapes renderNode/renderNodes (render.ts:78, no try/catch)
   - escapes `await config.render(...)` (core.ts:353-354, no try/catch in the fetch handler 334-356)
   => the Deno.serve handler promise rejects -> HTTP 500.

Fix: wrap formatNumber's toLocaleString in try/catch with a best-effort fallback (as currency does at expr.ts:157-161), and/or clamp minFrac/maxFrac to 0..100 with maxFrac>=minFrac.
```
- **evidence:**
```
Node repro: const m='1.3-2'.match(/^\d+\.(\d+)-(\d+)$/) => ['1.3-2','3','2']; (42).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:2}) -> UNCAUGHT RangeError: maximumFractionDigits value is out of range. Also '1.0-101' -> RangeError (max>100); '1.0-100' is fine. Source: expr.ts:185-190 sets minFrac=Number(m[1]),maxFrac=Number(m[2]) and calls n.toLocaleString(...) unguarded; contrast currency at expr.ts:157-161 which is wrapped in try/catch. Core path ui/.sprig/core.ts:353-356 has no try/catch around `await config.render(...)`.
```
- **independent verification:**
```
Verified white-box against the cited source plus a Node reproduction of the Intl behavior.

formatNumber (ui/.sprig/compiler/expr.ts:183-191) parses digitsInfo with /^\d+\.(\d+)-(\d+)$/ and passes minFrac=Number(m[1]), maxFrac=Number(m[2]) DIRECTLY into n.toLocaleString("en-US",{minimumFractionDigits, maximumFractionDigits}) with NO validation and NO try/catch. The regex accepts contradictory/out-of-range values: '1.3-2' yields min=3,max=2 and '1.0-101' yields max=101. Node confirms both throw `RangeError: maximumFractionDigits value is out of range.` ('1.0-100' is fine, '1.0-0' is fine). This contrasts directly with the `currency` pipe (expr.ts:155-161) which IS wrapped in try/catch with a fallback.

The exception is unguarded all the way out: the `number` pipe (expr.ts:153) and `percent` pipe (expr.ts:154) invoke formatNumber; they are reached from interpolation rendering at render.ts:78 (case "interpolation" -> evalExpr); render.ts has no try/catch anywhere in the renderNode/renderNodes chain (confirmed by grep). The core request handler in ui/.sprig/core.ts:334-356 awaits config.render(...) at 353-354 with no try/catch, so the rejected promise propagates out of the Deno.serve handler, which produces an HTTP 500 by default.

Severity adjusted from high to medium: the crash is real and reproducible, but it is not reachable from untrusted external input — it requires a template AUTHOR to hand-write an invalid digitsInfo literal (e.g. number:'1.3-2'). The live templates use only valid formats (number:'1.0-0', percent:'1.0-0', currency:'USD'), so no current page 500s. The defect is a developer-time footgun where Angular's real number pipe would clamp/ignore and never throw. Genuine defect, working-as-designed ruled out because the parallel currency pipe demonstrates the intended guard pattern that formatNumber simply omits.
```

### 34. number/percent/currency digitsInfo silently ignored unless it contains the optional '-maxFraction' segment
- **severity:** medium  ·  **category:** correctness
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts pipes + render.ts)
- **location:** `ui/.sprig/compiler/expr.ts:183-191 (formatNumber); used by the number/percent pipes at expr.ts:153-154`
- **expected:** '1.2' applies minFractionDigits=2 -> "3.50" (Angular DecimalPipe semantics).
- **actual:** Output is "3.5": the regex /^\d+\.(\d+)-(\d+)$/ requires the '-{max}' segment, so any digitsInfo without an explicit '-max' (e.g. '1.2', '1.4') fails to match and falls back to the defaults (minFrac=0,maxFrac=3), dropping the requested minimum-fraction padding entirely.
- **repro:**
```
In ui/.sprig/compiler/expr.ts, formatNumber (lines 183-191) uses /^\d+\.(\d+)-(\d+)$/ which requires a '-{maxFrac}' segment that Angular treats as optional. Reproduced by running the verbatim function in Deno:

function formatNumber(n, fmt) {
  let minFrac = 0, maxFrac = 3;
  if (fmt) { const m = fmt.match(/^\d+\.(\d+)-(\d+)$/); if (m) { minFrac = Number(m[1]); maxFrac = Number(m[2]); } }
  return n.toLocaleString("en-US", { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
}

Results:
  formatNumber(3.5, '1.2') => "3.5"   (Angular: "3.50")
  formatNumber(3.5, '1.4') => "3.5"   (Angular: "3.5000")
  formatNumber(3.5, '1.0-2') => "3.5"  (matches; works)

Template-level repro: {{ 3.5 | number:'1.2' }} renders "3.5" instead of Angular's "3.50".

Fix: make the '-max' group optional, e.g. /^(\d+)\.(\d+)(?:-(\d+))?$/, default maxFrac to max(minFrac, 3) when omitted, and ideally honor the {minInt} group via minimumIntegerDigits.
```
- **evidence:**
```
formatNumber(3.5,'1.2') => "3.5" (ran the verbatim function via deno); regex at expr.ts:187 mandates the '-(\d+)' group that Angular treats as optional.
```
- **independent verification:**
```
Confirmed by reading the cited code and reproducing it. In ui/.sprig/compiler/expr.ts the number/percent pipes (lines 153-154) call formatNumber(n, fmt). formatNumber (lines 183-191) parses fmt with the regex /^\d+\.(\d+)-(\d+)$/ at line 187, which mandates the trailing -(\d+) group. Angular's DecimalPipe digitsInfo grammar is {minInt}.{minFrac}-{maxFrac} where the entire -{maxFrac} portion is OPTIONAL, so '1.2' is a valid spec (min/max fraction tied to 2). Because the regex demands the '-max' segment, any well-formed digitsInfo lacking it (e.g. '1.2', '1.4') fails to match, so minFrac/maxFrac keep their defaults (0 and 3). Running the verbatim function: formatNumber(3.5,'1.2') => '3.5', whereas Angular yields '3.50'. The requested minimum-fraction padding is dropped entirely. Severity medium is appropriate: it is a real output-correctness divergence from Angular semantics for a documented pipe syntax, but it only affects a subset of digitsInfo strings and silently produces a slightly-wrong number rather than crashing. (Note: the function also never honors the {minInt} segment, but that is outside the reported claim.)
```

### 35. date pipe returns a raw ISO timestamp for every unsupported/custom format (longDate, shortTime, fullTime, 'yyyy-MM-dd', any pattern)
- **severity:** medium  ·  **category:** rendering
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts pipes + render.ts)
- **location:** `ui/.sprig/compiler/expr.ts:193-205 (formatDate); reached via the date pipe at expr.ts:163`
- **expected:** A formatted date/time string per the requested pattern, e.g. date:'yyyy-MM-dd' -> "2026-06-21", date:'longDate' -> "June 21, 2026".
- **actual:** All of them fall through to `return d.toISOString()` and render the full machine timestamp, e.g. "2026-06-21T14:30:00.000Z" leaks into the page for date:'yyyy-MM-dd', 'longDate', 'shortTime', 'fullTime', and any custom pattern. Only the 5 hardcoded aliases (short, medium, mediumDate, fullDate, shortDate) work.
- **repro:**
```
In a sprig template author: {{ someDate | date:'yyyy-MM-dd' }} (or date:'longDate' / 'shortTime' / 'fullTime' / 'MMM d, y'). With someDate = '2026-06-21T14:30:00Z', each renders the raw ISO string '2026-06-21T14:30:00.000Z' instead of a formatted date. Standalone proof: extract formatDate from ui/.sprig/compiler/expr.ts:193-205 verbatim and call formatDate('2026-06-21T14:30:00Z','yyyy-MM-dd') -> '2026-06-21T14:30:00.000Z'. Only short/medium/mediumDate/fullDate/shortDate produce formatted output; all other format names and custom patterns fall through to d.toISOString() at expr.ts:204.
```
- **evidence:**
```
formatDate('2026-06-21T14:30:00Z','yyyy-MM-dd') => "2026-06-21T14:30:00.000Z"; same for 'longDate'/'shortTime'/'fullTime'/'MMM d, y' (ran verbatim function). opts map at expr.ts:196-202 omits these names; fallthrough at expr.ts:204.
```
- **independent verification:**
```
Verified by reading the cited source and running the verbatim function. /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/expr.ts lines 196-202 define an opts map with only 5 keys: short, medium, mediumDate, fullDate, shortDate. Line 203 returns a formatted result only when opts[fmt] exists; line 204 falls through to `return d.toISOString()` for everything else. The date pipe at line 163 (`date: (v, a) => formatDate(v, (a[0] as string) ?? "mediumDate")`) passes the author-supplied format string straight into this function, so any Angular-standard format name not in those 5 keys, and every custom pattern, hits the ISO fallthrough. Running formatDate('2026-06-21T14:30:00Z', f) verbatim: 'yyyy-MM-dd' => '2026-06-21T14:30:00.000Z', 'longDate' => '2026-06-21T14:30:00.000Z', 'shortTime' => '2026-06-21T14:30:00.000Z', 'fullTime' => '2026-06-21T14:30:00.000Z', 'MMM d, y' => '2026-06-21T14:30:00.000Z'; while the supported aliases work (mediumDate => 'Jun 21, 2026', fullDate => 'Sunday, June 21, 2026'). This is a genuine, reproducible defect: the machine timestamp leaks into rendered output for common, legitimate Angular date formats. It is not intended behavior (intended output is a formatted human-readable date) and the code path is reachable through the public date pipe. Severity medium is correct: visibly wrong rendering, no crash or data corruption, and only affects templates using formats beyond the 5 aliases.
```

### 36. :host-context(...) is mangled into invalid CSS by the :host replacement regex
- **severity:** medium  ·  **category:** rendering
- **area:** View encapsulation (ui/.sprig/compiler/scope.ts) — scopeId collisions and CSS selector scoping edge cases
- **location:** `ui/.sprig/compiler/scope.ts:95`
- **expected:** `:host-context(.dark) .x` should either be handled as a host-context selector or left intact; output should be valid CSS.
- **actual:** Output is `[sX]-context(.dark) .x[sX] { color:red }` — `:host` was replaced by the token leaving a dangling `-context(.dark)`, producing invalid, non-matching CSS. The rule silently never applies.
- **repro:**
```
In the repo root run:

cat > /tmp/test_scope.ts <<'EOF'
import { scopeCss } from "/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts";
console.log(scopeCss(":host-context(.dark) .x { color:red }", "sX"));
EOF
/opt/homebrew/bin/deno run -A /tmp/test_scope.ts

Actual output: [sX]-context(.dark) .x[sX] { color:red }
Expected: :host-context(.dark) should be handled (e.g. scoped to the marker / a real ancestor selector) or left intact — never split into a dangling `-context(.dark)`.

Root cause: ui/.sprig/compiler/scope.ts:95
  sel = sel.replace(/:host\(([^)]*)\)/g, token + "$1").replace(/:host\b/g, token);
The `/:host\b/g` boundary matches before the hyphen in `:host-context`. A fix would use a negative lookahead such as `/:host\b(?!-)/g` (or explicitly handle `:host-context(...)` before the generic `:host` replacement).
```
- **evidence:**
```
Observed via direct invocation of scopeCss from ui/.sprig/compiler/scope.ts: input `:host-context(.dark) .x { color:red }` → `[sX]-context(.dark) .x[sX] { color:red }`. Offending line scope.ts:95: `.replace(/:host\b/g, token)` — `\b` matches before the hyphen in `:host-context`.
```
- **independent verification:**
```
Confirmed by reading and directly executing the cited code. In ui/.sprig/compiler/scope.ts:95, scopeSelector does `sel.replace(/:host\b/g, token)`. The word boundary `\b` matches the position between the `t` of `:host` and the `-` of `:host-context` (word char to non-word char), so the regex replaces the `:host` prefix inside `:host-context`. The earlier `:host(...)` replacement on the same line does not consume `:host-context` because `-context(...)` is not a `(`-immediately-following group.

Empirical reproduction (Deno, importing the real module):
  scopeCss(':host-context(.dark) .x { color:red }', 'sX')
  => '[sX]-context(.dark) .x[sX] { color:red }'
The `:host` was rewritten to `[sX]`, leaving a dangling `-context(.dark)` and producing invalid, non-matching CSS. (Bare check: ':host-context'.replace(/:host\b/g,'[sX]') => '[sX]-context'.)

This is a real production path, not a test-only helper: build.ts:130 calls `scopeCss(css, scopeId(sel))` on every component's styles. `:host-context(...)` is a standard Angular view-encapsulation selector, and the file's own header comment frames this module as implementing Angular's Emulated encapsulation, so such input is expected. The rule silently never applies (no build error, no crash), and it does not corrupt other components' rules — hence medium, not high. Working-as-designed is ruled out: invalid CSS output is clearly not intended; the code intends `:host` handling but fails to exclude the `:host-context` form.
```

### 37. Escaped colon in class names (Tailwind-style `.hover\:flex`, `.md\:block`) gets the scope token inserted mid-token, breaking the selector
- **severity:** medium  ·  **category:** rendering
- **area:** View encapsulation (ui/.sprig/compiler/scope.ts) — scopeId collisions and CSS selector scoping edge cases
- **location:** `ui/.sprig/compiler/scope.ts:120-123 (insertToken regex /::?[\w-]/)`
- **expected:** An escaped colon `\:` is part of the class identifier (e.g. `.hover\:bg-red` targets class `hover:bg-red`); the token must be appended at the END of the compound: `.hover\:bg-red[sX]`.
- **actual:** Output is `.hover\[sX]:bg-red` — the `[sX]` is inserted into the middle of the escaped class name, yielding invalid CSS that no longer matches `.hover\:bg-red`. Any component using Tailwind-style escaped utility classes or any escaped-colon class loses all its scoped styling. (Also `:hover\:bar:hover` style mixes break.)
- **repro:**
```
From repo root, create /tmp/repro.ts:

import { scopeCss } from "/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts";
console.log(JSON.stringify(scopeCss('.hover\\:bg-red { color: red }', 'sX')));
console.log(JSON.stringify(scopeCss('.md\\:flex { display: flex }', 'sX')));
console.log(JSON.stringify(scopeCss('.plain:hover { color: red }', 'sX')));

Run: /opt/homebrew/bin/deno run -A /tmp/repro.ts

Observed:
".hover\\[sX]:bg-red { color: red }"   <- BUG: token inside escaped class name
".md\\[sX]:flex { display: flex }"     <- BUG
".plain[sX]:hover { color: red }"      <- correct (real pseudo)

Expected for the escaped cases: ".hover\\:bg-red[sX] { color: red }" and ".md\\:flex[sX] { display: flex }".

Root cause: ui/.sprig/compiler/scope.ts:120 `const m = compound.match(/::?[\w-]/);` matches the colon of a backslash-escaped `\:` as a pseudo-selector start; insertToken (lines 121-123) then splices the token before it. The regex must skip colons preceded by an odd number of backslashes (or otherwise track escape state) so escaped class names are treated as part of the compound's identifier and the token is appended at the end.
```
- **evidence:**
```
Observed via direct invocation: `.hover\:bg-red {…}` → `.hover\[sX]:bg-red {…}`; `.md\:flex {…}` → `.md\[sX]:flex {…}`; `.\32xl\:p-4 {…}` → `.\32xl\[sX]:p-4 {…}`. Root cause scope.ts:120 `const m = compound.match(/::?[\w-]/);` treats the colon of a backslash-escaped `\:` as a pseudo-selector start. Note: the shipped app CSS currently has no escaped classes (grep `\\:` over ui/src/**/*.css is empty), so this is a latent defect triggered by any component authoring escaped/Tailwind-arbitrary class selectors.
```
- **independent verification:**
```
Verified by reading ui/.sprig/compiler/scope.ts and directly invoking scopeCss. insertToken (lines 114-124) inserts the scope token before the first match of /::?[\w-]/ (line 120), treating the first pseudo-selector colon as the insertion point. For a backslash-escaped class like .hover\:bg-red, that regex matches the `:b` of the escape sequence `\:bg` — but that colon is NOT a pseudo-selector, it is part of the CSS-escaped class identifier `hover:bg-red`. The code has no awareness of backslash escaping (no check for a preceding `\`), so the token is inserted right after the backslash, mid-identifier.

Reproduced exactly (token 'sX'):
  '.hover\:bg-red { color: red }'  -> '.hover\[sX]:bg-red { color: red }'
  '.md\:flex { display: flex }'    -> '.md\[sX]:flex { display: flex }'
  '.\32xl\:p-4 { padding: 1rem }'  -> '.\32xl\[sX]:p-4 { padding: 1rem }'
Control case (genuine pseudo) works correctly:
  '.plain:hover { color: red }'    -> '.plain[sX]:hover { color: red }'

The broken output `.hover\[sX]:bg-red` is invalid scoping: `\[` now escapes a literal `[`, `sX]` becomes literal text, and `:bg-red` is parsed as an unknown pseudo — so the rule no longer matches the intended `class="hover:bg-red"` element. The expected output is to append the token at the end of the compound: `.hover\:bg-red[sX]`. This is a genuine defect, not intended behavior. The CSS parser/escaping rule it violates is real CSS spec behavior (`\:` is an escaped colon, part of an identifier).

Severity medium is correct: it is a real correctness bug that silently strips ALL scoped styling from any component authoring Tailwind-style / escaped-colon class selectors, but it is latent — I confirmed via grep over ui/src/**/*.css that no shipped CSS currently contains escaped colons (grep for `\:` returned no matches across 8 stylesheets), so it only triggers when a component introduces such a selector. Not critical/high because nothing in the current app exercises it and it does not crash the build.
```

### 38. stripComments() is not string/url-aware: a /*...*/ sequence inside a CSS string or url() value is deleted, silently corrupting (and breaking) the emitted stylesheet
- **severity:** medium  ·  **category:** correctness
- **area:** View encapsulation / CSS selector scoper (ui/.sprig/compiler/scope.ts)
- **location:** `ui/.sprig/compiler/scope.ts:31-33 (stripComments regex /\/\*[\s\S]*?\*\//g); reached from build.ts:130 (scopeCss over every component styles.css) and concatenated into the shared out/app.css at build.ts:146,151`
- **expected:** String literals and url() token contents are inert: content:"/* not a comment */" stays verbatim and url(http://x/*y*/z.png) is preserved (no CSS comment lives inside a string/URL).
- **actual:** scopeCss(`.a { content: "/* not a comment */"; }`) => `.a[s12345678] { content: ""; }` (the entire string value is destroyed). scopeCss(`.a { background: url(http://x/*y*/z.png); }`) => `.a[s12345678] { background: url(http://xz.png); }` (URL silently rewritten to a 404). The corruption lands in the shared app.css emitted by buildCss.
- **repro:**
```
/opt/homebrew/bin/deno run --allow-read on a script importing scopeCss from /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts:

import { scopeCss } from "/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts";
for (const css of [
  `.a { content: "/* not a comment */"; }`,
  `.a { background: url(http://x/*y*/z.png); }`,
]) console.log(JSON.stringify(css), "=>", JSON.stringify(scopeCss(css, "s12345678")));

Observed output:
".a { content: \"/* not a comment */\"; }" => ".a[s12345678] { content: \"\"; }"
".a { background: url(http://x/*y*/z.png); }" => ".a[s12345678] { background: url(http://xz.png); }"

Both string-literal contents and url() contents are corrupted because stripComments (scope.ts:32) deletes the /*...*/ span with no string/url context tracking.
```
- **evidence:**
```
Observed output of /opt/homebrew/bin/deno run --allow-read on scope.ts: `".a { content: \"/* not a comment */\"; }" => ".a[sQ] { content: \"\"; }"` and `".a { background: url(http://x/*y*/z.png); }" => ".a[sQ] { background: url(http://xz.png); }"`. Cause: stripComments() (scope.ts:32) applies the /\/\*...\*\//g regex over the raw text with no string/url() context tracking, before any rule parsing.
```
- **independent verification:**
```
Verified by reading the code and reproducing the output. ui/.sprig/compiler/scope.ts:31-33 defines stripComments(s) = s.replace(/\/\*[\s\S]*?\*\//g, ""), a context-free regex applied to the raw CSS text before any parsing (scopeCss calls stripComments at line 28). It has zero awareness of CSS string literals ("..."/'...') or url() token contents, both of which the CSS spec treats as inert (a /*...*/ inside them is NOT a comment). So any /*...*/ sequence inside a string or URL is silently deleted.

I ran the exact repro with /opt/homebrew/bin/deno and observed:
- `.a { content: "/* not a comment */"; }`  =>  `.a[s12345678] { content: ""; }`  (entire string value destroyed)
- `.a { background: url(http://x/*y*/z.png); }`  =>  `.a[s12345678] { background: url(http://xz.png); }`  (URL silently rewritten to a non-existent path -> 404)

This matches the claim verbatim. The call path is real and reachable: buildCss (build.ts:125) walks every component's styles.css and calls scopeCss(css, scopeId(sel)) at build.ts:129, concatenating the (corrupted) result into the Tailwind input that produces the shared out/app.css. So author CSS containing such a sequence ends up corrupted in the shipped stylesheet with no error.

This is a genuine correctness defect, not intended behavior — a robust CSS comment stripper must skip string and url() contexts. I downgraded severity from the claimed "high" to "medium": the bug is real and causes silent corruption, but the trigger is narrow — a literal /*...*/ appearing inside a CSS string value or a url() is uncommon in real authored stylesheets, so production impact is limited though non-zero.
```

### 39. Nested CSS style rules are never scoped: inner selectors keep no scope marker, breaking the rightmost-only encapsulation guarantee
- **severity:** medium  ·  **category:** correctness
- **area:** View encapsulation / CSS selector scoper (ui/.sprig/compiler/scope.ts)
- **location:** `ui/.sprig/compiler/scope.ts:64-78 (processBlock treats a rule body as opaque `inner`; only at-rules matching RECURSE are descended — nested style rules are not), recursion gate at scope.ts:74 (RECURSE) and the else branch at scope.ts:76-78`
- **expected:** Each nested style rule's key compound carries the component scope marker, e.g. the .title rule should be scoped so it can only match this component's own .title element (rightmost-only guarantee, per the module header comment lines 7-10).
- **actual:** scopeCss(`.card { .title { font-weight: bold; } }`) => `.card[sN] { .title { font-weight: bold; } }` — the nested `.title` rule gets NO marker. Under native CSS nesting it resolves to `.card[sN] .title`, which styles ANY .title descendant (including .title elements owned by a different child component nested in the DOM), leaking out of the component boundary.
- **repro:**
```
Run from repo root:

  cat > /tmp/repro.ts << 'EOF'
  import { scopeCss } from "/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts";
  console.log("nested:", JSON.stringify(scopeCss(".card { .title { font-weight: bold; } }", "sN")));
  console.log("amp   :", JSON.stringify(scopeCss(".card { color:red; & .title { color:blue; } }", "sN")));
  console.log("flat  :", JSON.stringify(scopeCss(".card .title { font-weight: bold; }", "sN")));
  EOF
  deno run --allow-read /tmp/repro.ts

Observed output:
  nested: ".card[sN] { .title { font-weight: bold; } }"
  amp   : ".card[sN] { color:red; & .title { color:blue; } }"
  flat  : ".card .title[sN] { font-weight: bold; }"

The nested key compound (.title) lacks the [sN] marker, while the equivalent flat rule scopes it as .title[sN]. Under native CSS nesting the nested output styles any descendant .title, leaking past the component boundary.
```
- **evidence:**
```
Observed: `".card { .title { font-weight: bold; } }"` scoped to `".card[sN] { .title { font-weight: bold; } }"`. processBlock (scope.ts:65-70) captures the whole `{...}` as a flat declaration body and only re-enters processBlock for at-rules whose head matches RECURSE (scope.ts:74); a nested selector block falls through to the else at scope.ts:76 where only the OUTER prelude is scoped and `inner` is emitted untouched.
```
- **independent verification:**
```
Verified by reading ui/.sprig/compiler/scope.ts and running scopeCss directly.

In processBlock (scope.ts:65-78), when a `{...}` rule is found, the whole body is captured as a flat `inner` (line 70). For non-at-rules the code does `scopeSelectorList(prelude, token) + " {" + inner + "}"` (line 77) — it scopes only the OUTER selector and emits `inner` verbatim. processBlock is re-entered ONLY for at-rules matching RECURSE (@media/@supports/@container/@layer/@scope/@document, line 74). A nested STYLE rule (native CSS nesting) is never re-processed, so its key compound never gets the marker.

Reproduced exactly:
- scopeCss(".card { .title { font-weight: bold; } }", "sN") => ".card[sN] { .title { font-weight: bold; } }"  — nested .title has NO marker.
- scopeCss(".card { color:red; & .title { color:blue; } }", "sN") => ".card[sN] { color:red; & .title { color:blue; } }" — nested `& .title` has NO marker.
- Contrast (control): scopeCss(".card .title { font-weight: bold; }", "sN") => ".card .title[sN] { ... }" — the equivalent FLAT rule DOES scope the key compound.

This flat-vs-nested asymmetry proves the nested case violates the module's own documented guarantee (scope.ts:7-10: the rightmost/key compound of every rule must require the marker so a component's rule can never style another component's element). The desugared form `.card[sN] { .title {...} }` == `:is(.card[sN]) .title` matches ANY descendant `.title`, including a `.title` element owned by a nested child component (whose marker is a different `[sM]`), leaking styles across the component boundary — the precise failure the header promises is impossible.

Reachability confirmed: scopeCss is applied per-component over the raw styles.css at build time (build.ts:130 in buildCss), so any developer using standard, widely-supported native CSS nesting in a component stylesheet hits this. Not working-as-designed (the flat path scopes correctly; intent is clearly to scope every rule's key compound), not a misunderstanding, not unreachable.

Severity medium is correct: native nesting is common, but a visible regression also requires a colliding child-component selector to be present in the DOM subtree.
```

### 40. :host-context(...) selector is corrupted by the :host replacement, producing invalid CSS that never matches
- **severity:** medium  ·  **category:** rendering
- **area:** View encapsulation — CSS selector scoper (ui/.sprig/compiler/scope.ts)
- **location:** `ui/.sprig/compiler/scope.ts:95 (the `.replace(/:host\b/g, token)` in scopeSelector), compounded by insertToken at scope.ts:114-124`
- **expected:** A theming selector like `:host-context(.dark)` should be preserved/scoped sensibly, e.g. left intact or rewritten to a selector that still targets the host under an ancestor `.dark`. At minimum it must remain VALID CSS.
- **actual:** Output is `[sXX]-context(.dark)[sXX] { x:1 }`. The regex `/:host\b/g` treats the boundary between `host` and `-` (a non-word char) as a word boundary, so it replaces only the `:host` part of `:host-context`, leaving a dangling `-context(.dark)`. insertToken then appends a second `[sXX]`. The result `[sXX]-context(.dark)[sXX]` is not a valid selector and matches nothing, so any `:host-context` themed rule silently never applies.
- **repro:**
```
/opt/homebrew/bin/deno eval 'import { scopeCss } from "./ui/.sprig/compiler/scope.ts"; console.log(scopeCss(":host-context(.dark) { x:1 }", "sXX"));'

Actual output:   [sXX]-context(.dark)[sXX] { x:1 }   (invalid CSS, never matches)
Expected:        a valid scoped selector that still targets the host under an ancestor .dark, or at minimum syntactically valid CSS.

Also: scopeCss(":host-context(.dark) .btn { x:1 }", "sXX") => "[sXX]-context(.dark) .btn[sXX] { x:1 }" — same corrupted ancestor compound, still invalid.

Root cause: ui/.sprig/compiler/scope.ts:95  .replace(/:host\b/g, token)  — \b fires before the hyphen in ":host-context", and the second [sXX] is appended by insertToken at scope.ts:114-124.
```
- **evidence:**
```
deno eval output: `host-context key: [sXX]-context(.dark)[sXX] { x:1 }`. scope.ts:95 uses `/:host\b/g`; `\b` fires before the hyphen in `:host-context`. Note line 90's comment only mentions `:host` / `:host(x)`, never `:host-context`, confirming it is unhandled.
```
- **independent verification:**
```
Verified by reading ui/.sprig/compiler/scope.ts and reproducing via deno eval. In scopeSelector (line 88): for input ":host-context(.dark)", the hostOnly check at line 92 (/^:host\(([^)]*)\)$/) does not match because the char after "host" is "-", not "(". At line 95, the first replace (/:host\(([^)]*)\)/g) also does not match for the same reason. The second replace (/:host\b/g, token) DOES fire: \b matches the word boundary between "host" (word char "t") and "-" (non-word char), so ":host" is replaced with the token while "-context(.dark)" is left dangling, giving "[sXX]-context(.dark)". The whole string is then treated as the key compound (no top-level combinator — ".dark" is inside parens). insertToken (line 114) finds no pseudo (regex /::?[\w-]/ requires a ":", none present), so it falls to the "compound + token" branch and appends a second "[sXX]", yielding "[sXX]-context(.dark)[sXX]". This is invalid CSS: an identifier/"-context(...)" cannot directly follow an attribute selector "]", so the selector is a parse error and the rule silently never applies. The comment at line 90 only mentions :host and :host(x), confirming :host-context was never considered, and a grep shows it is handled nowhere in ui/.sprig. The framework explicitly models Angular's emulated encapsulation (scope.ts line 1), where :host-context is a standard theming selector, so this is a reachable defect, not a misuse. Severity medium is appropriate: it is a real correctness/rendering bug but limited to the :host-context theming feature and fails silently (theme rule just doesn't apply) rather than corrupting unrelated styles.
```

### 41. A failing template reparse silently drops batched CSS/reload updates in the same debounce window
- **severity:** medium  ·  **category:** logic
- **area:** dev/HMR server (ui/.sprig/compiler/dev.ts, hmr.ts, hydrate.ts)
- **location:** `ui/.sprig/compiler/dev.ts:44-79 (handleChange) and :47 (.catch)`
- **expected:** Each change kind should be handled independently: a broken/transient template edit should not prevent the batched CSS rebuild + `css` SSE (or the reload) from being applied. At worst the failing template should error, the rest should still run.
- **actual:** handleChange runs the template loop FIRST (dev.ts:61-66), then css (dev.ts:68-72), then reload (dev.ts:74-78), all in one async function with NO try/catch around the individual sections. If any `cfg.renderer.reparse(sel)` rejects, the whole handleChange promise rejects; control jumps to the `.catch` at dev.ts:47 which only emits an `error` SSE. The `css` and `reload` blocks for the same batch never execute, so a co-edited stylesheet change is silently lost until the next unrelated save.
- **repro:**
```
1. Run `sprig dev` on a project with a component folder containing template.html + styles.css.
2. In one atomic editor save (or two saves within the 60ms debounce window, dev.ts:48), modify BOTH template.html AND styles.css for components in the watched tree, such that the template is momentarily unreadable/unparseable — e.g. an atomic-save tool that renames template.html (so Deno.readTextFile in reparse throws ENOENT, mod.ts:87) or a template edit that makes parser.parse return null (parse.ts:29 throws).
3. The watcher batches both paths into one handleChange(paths) call (dev.ts:42-47). The templates loop (dev.ts:61) runs first; reparse rejects; the whole handleChange promise rejects.
4. Observed: only `{type:"error"}` is sent (dev.ts:47). The `{type:"css"}` SSE (dev.ts:70) and any `{type:"reload"}` (dev.ts:76) for the same batch never execute — the stylesheet swap is silently lost until the next save.

Confirmed with a standalone Deno script replicating handleChange's structure: with a throwing reparse and css=true batched together, emitted SSE = ["error"] only; the css event was dropped.

Suggested fix: wrap each section (per-template, css, reload) in its own try/catch so one failing kind reports its own error but does not suppress the other batched updates.
```
- **evidence:**
```
dev.ts:47 `handleChange(paths).catch((e) => send({ type: "error", message: String(e) }));` — the catch is on the whole call. dev.ts:52-79 has the three sections sequentially with bare `await` and no inner error isolation. reparse (mod.ts:84-91) does `await Deno.readTextFile(path)` and `await parseTemplate(...)` with no try/catch, and parseTemplate throws on null tree (parse.ts:28-30).
```
- **independent verification:**
```
Verified against the cited code. In ui/.sprig/compiler/dev.ts the debounced watcher (lines 38-50) coalesces every ev.paths into one `pending` set and passes `[...pending]` as a single array to `handleChange` (line 47). `handleChange` (lines 52-79) is one async function that runs three sequential, bare-`await` sections with NO inner try/catch: templates loop FIRST (61-66), then css (68-72), then reload (74-78). The only error handling is `.catch` on the whole call at line 47, which merely emits an `error` SSE.

`reparse` (mod.ts:84-91) is unguarded: `await Deno.readTextFile(path)` throws ENOENT if an atomic-save tool renames the file mid-read, and `await parseTemplate(...)` throws "template parse returned null" (parse.ts:28-30). Because the templates loop runs before the css/reload blocks, a rejected `reparse(sel)` rejects the whole `handleChange` promise, control jumps to the line-47 `.catch`, and the css (line 70) and reload (line 76) SSE messages for that same batch never fire. A co-edited stylesheet change is silently lost until the next unrelated save.

I reproduced the exact control flow with a standalone Deno script mirroring handleChange + the line-47 catch: with a throwing reparse and css=true in one batch, the only SSE emitted was `error`; the `css` event was dropped (output: SSE events emitted: ["error"], css update silently dropped? true). Both preconditions are reachable: batching is how the watcher works by design, and reparse has two real unguarded throw sites. This is a genuine logic defect, not intended behavior — the natural intent is per-change-kind isolation (the file's own header comment at lines 6-8 describes the kinds as independent). Severity medium is correct: dev-server-only, transient (recovers on next save), needs a co-edited batch plus a momentarily-unreadable template.
```


## LOW severity

### 42. Malformed JSON request body returns 500 instead of 400 and leaks the parser error
- **severity:** low  ·  **category:** validation
- **area:** API input validation on POST /api/http/issue and /api/http/user (RuneAssertError->422 seam; IssueRefDto / UserRefDto)
- **location:** `POST /api/http/issue (and all keep /api/http/* endpoints) JSON body parsing in serveSprig/keep dispatch (packages/keep/mod.ts dispatch path) before the assert seam`
- **expected:** A syntactically invalid JSON body is a client error and should return HTTP 400 Bad Request, not a 500 Internal Server Error, and should not echo the internal JSON.parse message.
- **actual:** HTTP/1.1 500 Internal Server Error, body {"status":500,"message":"Unexpected end of JSON input"} — a client fault is reported as a server fault and the raw parser error string is reflected to the caller.
- **repro:**
```
Against a running backend (PORT=8200 deno run -A backend/bootstrap/mod.ts):

curl -s -i -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' -d '{"issueId":'

Observed: HTTP/1.1 500 Internal Server Error
Body: {"status":500,"message":"Unexpected end of JSON input"}

Expected: a 4xx client error (400 Bad Request, or the app's 422 client-error class) with no raw JSON.parse message echoed.

Also reproduces on /api/http/user and with bodies `not json` and `` (empty). For contrast, a well-formed but contract-invalid body `{}` correctly returns 422 RuneAssertError, confirming the parse step (not the assert seam) is the cause.
```
- **evidence:**
```
Live: curl with body '{"issueId":' returns HTTP/1.1 500 Internal Server Error and {"status":500,"message":"Unexpected end of JSON input"} (content-type application/json).
```
- **independent verification:**
```
Independently reproduced against the live server on http://localhost:8200 (a backend instance from backend/bootstrap/mod.ts; my own boot hit AddrInUse because one was already listening). Results:

- POST /api/http/issue with body `{"issueId":` -> HTTP/1.1 500 Internal Server Error, body `{"status":500,"message":"Unexpected end of JSON input"}` (content-type application/json). Exactly as claimed.
- POST /api/http/user with body `not json` -> 500, `{"status":500,"message":"Unexpected token 'o', \"not json\" is not valid JSON"}`.
- POST /api/http/issue with empty body -> 500, `{"status":500,"message":"Unexpected end of JSON input"}`.

Contrast (proves the parse failure, not the contract seam, is the culprit):
- POST /api/http/issue with WELL-FORMED but contract-invalid body `{}` -> HTTP 422 Unprocessable Entity via the RuneAssertError seam (`Validation failed for IssueRefDto ... issueId must be a string`). So structurally valid bodies are handled correctly; only the JSON.parse step misclassifies.

This is a genuine defect: a syntactically invalid JSON body is unambiguously a client fault and should be 400 (or at least the 422 client-error class the app already uses), not 500 Internal Server Error. Additionally the raw internal JSON.parse message is reflected verbatim to the caller.

Root cause location: the JSON body is parsed by the framework request pipeline upstream of the @Endpoint handler and keep's assert seam. The app controller (backend/src/board/entrypoints/http/mod.ts) does not parse JSON itself; the danet/keep stack (jsr:@danet/core@2.11.0 + jsr:@mrg-keystone/keep@1.22.0, the http adapter at .../keep/1.22.0/src/foundation/domain/data/http-adapter/mod.ts) parses the body and its generic error handler maps the thrown SyntaxError to a 500 with the raw message. The claim's framing ("before the assert seam, in the keep dispatch path") is accurate. The fix belongs in the keep/danet HTTP adapter body-parse seam (catch the parse error -> 400, suppress the raw parser string), not in the rune-generated app code.

Severity: low is correct. The leaked string is only the standard V8 JSON.parse message; no stack trace, no path/secret/internal-state disclosure. The substantive issue is the wrong 500-vs-4xx status classification, a low-impact correctness/validation bug.

Note: the defect is real and reproducible, but it is rooted in the third-party framework dependency rather than in source files contained in this repo, so it is not fixable purely within the app tree.
```

### 43. issue.assemble relateds field is not actually 'related' — always the first 3 issues in seed order excluding self
- **severity:** low  ·  **category:** correctness
- **area:** Backend rune business/coordinators (backend/src/board/**)
- **location:** `backend/src/board/domain/business/issue/mod.ts:19-26 (relateds = ISSUES.filter(!== id).slice(0,3))`
- **expected:** A field named 'relateds' (RelatedDto: 'a lean issue summary shown in the related list') should reflect some relationship to the subject issue (shared tags, same status/column, etc.), or at minimum be documented as 'recent issues'. As-is, two different issues with nothing in common return byte-identical related lists, which is misleading for any consumer.
- **actual:** relateds = ISSUES.filter(candidate => candidate.id !== issueId).slice(0,3).map(...). It is purely positional: the first three seed issues that are not the subject, with no relevance computation. For SPR-104/105/106 the list is always [SPR-101,SPR-102,SPR-103]; for SPR-101 it is [SPR-102,SPR-103,SPR-104]. Confirmed live on http://localhost:8200.
- **repro:**
```
Code: backend/src/board/domain/business/issue/mod.ts:18-25
  const relateds = ISSUES.filter((candidate) => candidate.id !== issueId).slice(0, 3).map(...)

Replay the slice logic against the real seed order (SPR-101..SPR-106 from backend/src/board/domain/business/board/mod.ts:27-82):
  node -e 'const I=["SPR-101","SPR-102","SPR-103","SPR-104","SPR-105","SPR-106"];const rel=id=>I.filter(c=>c!==id).slice(0,3);for(const id of ["SPR-101","SPR-104","SPR-105","SPR-106"])console.log(id,JSON.stringify(rel(id)))'

Output:
  SPR-101 ["SPR-102","SPR-103","SPR-104"]
  SPR-104 ["SPR-101","SPR-102","SPR-103"]
  SPR-105 ["SPR-101","SPR-102","SPR-103"]
  SPR-106 ["SPR-101","SPR-102","SPR-103"]

SPR-104, SPR-105, SPR-106 (and every issue beyond the first three) all return the identical [SPR-101, SPR-102, SPR-103]. Two issues with nothing in common (e.g. SPR-105 'build' vs SPR-104 'router/done') get the same "related" list, while genuinely related issues (SPR-103/SPR-104 both tagged 'router') are not preferred. Live equivalent: POST /api/http/issue {"issueId":"SPR-104"} and {"issueId":"SPR-105"} return the same relateds array.
```
- **evidence:**
```
backend/src/board/domain/business/issue/mod.ts lines 19-26: `const relateds = ISSUES.filter((candidate) => candidate.id !== issueId).slice(0, 3).map(...)`. No tag/status/project comparison is performed. Live SPR-104 -> relateds [SPR-101,SPR-102,SPR-103]; live SPR-105 -> identical [SPR-101,SPR-102,SPR-103]. Reported as low/correctness since the DTO doc states no relevance contract, but the field name 'related' is semantically wrong.
```
- **independent verification:**
```
Verified against the cited source. backend/src/board/domain/business/issue/mod.ts:18-25 builds `relateds` as `ISSUES.filter(c => c.id !== issueId).slice(0,3).map(...)` — purely positional, with zero comparison of tags, status, project, priority, or any relevance signal. The DTO (backend/src/board/dto/issue-detail.ts:37-42) names the field `relateds`/RelatedDto and documents it as "a lean issue summary shown in the related list," implying a relationship to the subject issue.

I reproduced the exact behavior by replaying the slice logic against the real seed order in backend/src/board/domain/business/board/mod.ts:27-82 (SPR-101..SPR-106):
  SPR-101 -> [SPR-102, SPR-103, SPR-104]
  SPR-104 -> [SPR-101, SPR-102, SPR-103]
  SPR-105 -> [SPR-101, SPR-102, SPR-103]
  SPR-106 -> [SPR-101, SPR-102, SPR-103]
This matches the report byte-for-byte: every issue past the first three returns the identical [SPR-101, SPR-102, SPR-103], and the result is independent of any relevance signal.

The seed data demonstrably contains usable signals that are ignored: SPR-103 and SPR-104 share the `router` tag; SPR-101 and SPR-102 share the `core` tag. So a relevance ranking was both intended (by the field name/doc) and feasible.

Caveats lowering severity: this is an explicitly in-memory demo/seed backend (file header: "this demo backend (no datastore)"); the DTO doc does not state a hard relevance contract; there is no crash, data corruption, or security impact. It is a genuine correctness/semantics defect — the field labeled "related" is not related to anything — but cosmetic in impact. Confirming the original report's low rating (arguably info).
```

### 44. Dashboard "recent activity" feed is returned in seed/insertion order, not sorted by its `at` timestamp — older entries appear above newer ones
- **severity:** low  ·  **category:** correctness
- **area:** Backend rune business/coordinators (backend/src/board/**) — assemble() edge cases, dashboard stats math, DTO/seed consistency, #assert output seams
- **location:** `backend/src/board/domain/business/dashboard/mod.ts:27 (activitys: ACTIVITY) with seed at backend/src/board/domain/business/board/mod.ts:100-106`
- **expected:** A feed documented as "recent activity" (DashboardDto / Dashboard.assemble JSDoc: "the dashboard: stats, recent issues and recent activity") should be ordered by ActivityDto.at descending so the most recent event is first.
- **actual:** Returns ACTIVITY verbatim in array-declaration order, which is NOT descending by `at`: a1=2026-06-19T14:12, a2=2026-06-18T08:30, a3=2026-06-19T08:45, a4=2026-06-11T13:30, a5=2026-06-12T16:20. The newest event (a1) is followed by an older one (a2), then a newer one (a3), then the two oldest. No sort is applied. assemble() simply does `activitys: ACTIVITY` (dashboard/mod.ts:27).
- **repro:**
```
With the backend running on :8200, run:\n\ncurl -s -X POST http://localhost:8200/api/http/dashboard -H 'Content-Type: application/json' -d '{}' | python3 -c "import sys,json;[print(a['id'],a['at']) for a in json.load(sys.stdin)['activitys']]"\n\nObserved output (non-descending by `at`):\n  a1 2026-06-19T14:12:00Z\n  a2 2026-06-18T08:30:00Z\n  a3 2026-06-19T08:45:00Z   <- newer than a2 above it\n  a4 2026-06-11T13:30:00Z\n  a5 2026-06-12T16:20:00Z   <- newer than a4 above it\n\nExpected for a "recent activity" feed: descending by `at` (a1, a3, a2, a5, a4). Source: backend/src/board/domain/business/dashboard/mod.ts:27 returns ACTIVITY with no sort; seed at backend/src/board/domain/business/board/mod.ts:100-106.
```
- **evidence:**
```
Live response order [a1(06-19 14:12), a2(06-18 08:30), a3(06-19 08:45), a4(06-11 13:30), a5(06-12 16:20)] is non-monotonic in `at`. Source backend/src/board/domain/business/dashboard/mod.ts:27 returns ACTIVITY with no `.sort((x,y)=>y.at.localeCompare(x.at))`; ActivityDto carries an `at` field (backend/src/board/dto/activity.ts:37-41) that is ignored.
```
- **independent verification:**
```
Verified against the running server (localhost:8200) and the source. The live response order is a1(2026-06-19T14:12), a2(2026-06-18T08:30), a3(2026-06-19T08:45), a4(2026-06-11T13:30), a5(2026-06-12T16:20) — exactly the declaration order of ACTIVITY at backend/src/board/domain/business/board/mod.ts:100-106, and it is non-monotonic in `at` (a2 06-18 sits above a3 06-19; a3 06-19 above a4/a5 from 06-11/06-12). Dashboard.assemble() at backend/src/board/domain/business/dashboard/mod.ts:27 returns `activitys: ACTIVITY` verbatim with no `.sort(...)`. A grep of backend/src confirms there is no sort/localeCompare logic anywhere. The DTO is named the "recent-activity feed" (activity.ts:7-11) and DashboardDto/Dashboard.assemble JSDoc both say "recent activity" (dashboard.ts:12-16, dashboard/mod.ts:9-11), and ActivityDto carries an `at` ISO-8601 field (activity.ts:37-41) that is ignored. So the claim is factually accurate and reproducible: a feed framed as "recent activity" is not ordered most-recent-first.\n\nSeverity is low (not higher), and I weighed whether it is working-as-designed: this is a static in-memory demo seed with no datastore; the sibling `issues: ISSUES.slice(0,3)` is likewise unsorted (and IssueDto has no timestamp at all), showing assemble() was scaffolded to return seed slices verbatim. No rune spec, test, or JSDoc states a "sort descending by at" contract — the expectation is a reasonable inference from the "recent" wording, not a documented requirement. Impact is purely cosmetic ordering of a demo feed; no functional breakage, no crash, no data error. But it is still a genuine inconsistency: even read as hand-authored display order, the seed itself is out of order (a2 before a3), so the feed does not present newest-first as its name implies. A one-line fix (`activitys: [...ACTIVITY].sort((x,y)=>y.at.localeCompare(x.at))`) would resolve it.
```

### 45. shortHash concatenates raw file bytes with no length/name delimiters — the 64-bit cache-buster `v` is vulnerable to boundary-shift collisions across build outputs
- **severity:** low  ·  **category:** correctness
- **area:** Build + cache (ui/.sprig/compiler/build.ts + mod.ts): cache hash, page-island gate, selector collisions, CSS scope-id collision
- **location:** `ui/.sprig/compiler/build.ts:170-184 (shortHash) and build.ts:115-118 (hash used as manifest `v`, the sole cache-buster for immutable-cached client.js/isl.*.js/app.css)`
- **expected:** A content-addressed cache-buster should be a function of (filename, content) pairs with unambiguous framing (e.g. hash each file's digest, or include name+length), so any change to the output set yields a new `v`. With immutable max-age=31536000 caching, a stale `v` serves stale JS/CSS forever.
- **actual:** shortHash ignores filenames and uses no delimiters: `all.set(b, off); off += b.length` (build.ts:176-178). The digest depends only on the raw concatenation of sorted file contents. Boundary-shift across files (or a file becoming empty while another absorbs its bytes) collides, leaving the immutable client cache pinned to stale assets.
- **repro:**
```
White-box, verified against the cited code:

1. Inspect build.ts:170-184. `shortHash(paths)` does: `for (const p of paths) parts.push(await Deno.readFile(p));` then copies every buffer into one `all` Uint8Array with only `all.set(b, off); off += b.length;` — no delimiter, no length prefix, no filename mixed into the digest. SHA-256, then `.slice(0, 8)` → 64-bit hex `v`.

2. The digest therefore depends ONLY on the raw concatenation of sorted file contents; filenames and boundaries are invisible to it.

3. Empirical collision (run with deno run --allow-all): apply the identical concat-and-digest logic to two distinct file sets:
   - Set A: fileA=\"abc\", fileB=\"def\"  → v = bef57ec7f53a6d40
   - Set B: fileA=\"ab\",  fileB=\"cdef\" → v = bef57ec7f53a6d40
   Same `v` for different output sets (content shifted one byte across the file boundary).

4. `v` is the sole cache key for assets served `public, max-age=31536000, immutable` (mod.ts:62 reads manifest.v for ?v=; packages/keep/mod.ts:48 sets the immutable header). A colliding `v` leaves the browser pinned to stale client.js/app.css/isl.*.js for up to a year.

Fix: frame each file as (name + length + content) or hash each file's individual digest before combining, so any change to the output set changes `v`.
```
- **evidence:**
```
build.ts:170-184: parts.push(await Deno.readFile(p)) for sorted paths, concatenated into one Uint8Array with only running offset, no separators, no name/length framing; only the first 8 bytes (64 bits) of the SHA-256 are kept (build.ts:183). This `v` is the only cache key for assets served `public, max-age=31536000, immutable` (packages/keep/mod.ts:48; verified live: GET /ui/_assets/app.css returns that cache-control).
```
- **independent verification:**
```
All cited code facts are confirmed by direct reading. build.ts:170-184 (`shortHash`) reads each sorted file path's bytes (`parts.push(await Deno.readFile(p))`), concatenates them into one Uint8Array using only a running offset (`all.set(b, off); off += b.length`) with NO separator, no per-file length prefix, and no filename in the digest, then SHA-256s the blob and keeps only the first 8 bytes / 64 bits (build.ts:183). That digest is the manifest `v` (build.ts:115-118), which is read at render time (mod.ts:62) and used as the `?v=` query cache-buster for stable-named assets (client.js, app.css, isl.*.js) that are served `public, max-age=31536000, immutable` (packages/keep/mod.ts:48, confirmed). So a stale `v` does mean stale JS/CSS pinned in browser caches.

The collision is mathematically real and I reproduced it empirically: feeding [\"abc\",\"def\"] and [\"ab\",\"cdef\"] (one byte shifted across the file boundary, total bytes preserved) to the exact concatenation logic yields the identical hash bef57ec7f53a6d40. Because filenames and length framing are absent, any two output sets whose sorted-by-path byte concatenations are equal produce the same `v`.

This is NOT working-as-designed: the author's own comment at build.ts:181-182 states the hash should \"keep it collision-safe (matches esbuild's hashes)\", and the unframed concatenation fails that stated goal — a textbook hash-framing weakness (length-extension / boundary-ambiguity).

Severity is correctly LOW, not higher: triggering real harm additionally requires the two colliding builds to share identical stable filenames (the URLs use fixed names client.js/app.css/isl.<sel>.js), and the realistic edits that preserve total byte count while shifting bytes across an adjacent file boundary without changing the esbuild content-derived chunk-<hash> names are a narrow corner case. It is a genuine latent correctness/robustness defect with a cheap fix (frame each file as name+length+digest, or hash per-file digests), but the practical probability of an ordinary code edit landing on a collision is very small.
```

### 46. manifest.json is publicly served under /ui/_assets with an immutable cache-control, leaking build internals and pinning a stale cache-buster source
- **severity:** low  ·  **category:** security
- **area:** Build + cache (ui/.sprig/compiler/build.ts, scope.ts, mod.ts)
- **location:** `packages/keep/mod.ts:39-54 (serveAsset serves any file in assetsDir, including manifest.json) reached via dispatch at packages/keep/mod.ts:86-88; manifest written by build.ts:116-119`
- **expected:** manifest.json is a build artifact, not a client asset (nothing client-side fetches it; only the SSR renderer reads it from disk at mod.ts:59-62). It should not be exposed under _assets, and if exposed at all it must NOT be sent immutable, since its whole job is to change every build.
- **actual:** Any client can GET /ui/_assets/manifest.json (200) and read the island list, chunk hashes, css/client names, and build version; it is also tagged immutable for one year, so any intermediary that caches it pins a stale build-version document.
- **repro:**
```
Prereq: a built static/ dir exists (run `deno task build`); it already did in the repo, containing static/manifest.json.

1. Start the server: `deno serve -A --unstable-kv --port 8200 serve.ts`
2. `curl -s -D - -o /dev/null -w 'HTTP %{http_code} ct=%{content_type}\n' http://localhost:8200/ui/_assets/manifest.json`

Observed:
  HTTP/1.1 200 OK
  content-type: application/json; charset=utf-8
  cache-control: public, max-age=31536000, immutable

Body is the full build manifest: {"v":"aa5d95f5552fe637","client":"client.js","css":"app.css","islands":["counter","star-rating"],"chunks":["chunk-UQEYE25X.js"]}

Expected: manifest.json should be a server-side-only build artifact (404 under /ui/_assets), or at least never sent with an immutable one-year cache, since it changes every build.

Relevant files:
- /Users/raphaelcastro/Documents/programming/sprig/packages/keep/mod.ts:39-54 (serveAsset, no allowlist, immutable header), :86-88 (dispatch)
- /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/build.ts:116-119 (manifest written into static/)
- /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/mod.ts:59-62 (SSR reads manifest from disk)
```
- **evidence:**
```
Live: /ui/_assets/manifest.json -> 200, content-type application/json, cache-control: public, max-age=31536000, immutable. serveAsset (mod.ts:39-54) applies the same immutable header to EVERY file in assetsDir with no allowlist; manifest.json sits in static/ alongside the real assets.
```
- **independent verification:**
```
Verified and reproduced live. The build writes manifest.json into outDir = static/ (build.ts:116-119), which is exactly the directory serveSprig serves at <base>/_assets/* (assetsDir defaults to "static", base "/ui" per serve.ts). serveAsset (packages/keep/mod.ts:39-54) reads ANY file under assetsDir with no allowlist and unconditionally sets cache-control: public, max-age=31536000, immutable; .json is even in the ASSET_TYPES map (mod.ts:36). The dispatch at mod.ts:86-88 routes /ui/_assets/manifest.json straight into serveAsset. The SSR renderer reads the manifest from disk (ui/.sprig/compiler/mod.ts:59-62, Deno.readTextFile of static/manifest.json) for the ?v= cache-buster; nothing client-side fetches it over HTTP, confirming it is a build artifact, not a client asset.

Both halves of the claim hold: (1) it is publicly reachable and leaks the island selectors, chunk hashes, client/css filenames, and build version v; (2) it is tagged immutable for one year despite its whole job being to change every build, so a caching intermediary pins a stale version document.

Severity stays low: the leaked data is low-sensitivity (island selectors and chunk filenames are already inferable from the rendered HTML and the ?v= asset URLs; no secrets), and the immutable-cache staleness has no functional impact on the running app because the SSR reads the manifest from disk, not over HTTP. The fix is to exclude manifest.json from serveAsset (it has no business under _assets) — or at minimum not send it immutable.
```

### 47. Prop-bridge JSON.parse is unguarded: a malformed props script throws, marks the island permanently 'hydrated' but dead, and aborts hydration of all later same-selector instances
- **severity:** low  ·  **category:** crash
- **area:** Client hydration runtime (ui/.sprig/compiler/hydrate.ts): delegation, effect re-render, prop bridge, soft-nav re-arm
- **location:** `ui/.sprig/compiler/hydrate.ts:176-182 (sets data-sprig-hydrated at 177 before JSON.parse at 182)`
- **expected:** A prop-bridge parse failure should be caught, logged, and skipped so the island degrades gracefully and sibling islands still hydrate.
- **actual:** `hydrateIsland` sets `el.dataset.sprigHydrated = "1"` at line 177, THEN runs `JSON.parse(propsEl.textContent)` at line 182 with no try/catch. A throw leaves the element permanently flagged as hydrated (so retry via hydratePending skips it) yet with no setup/effect/listeners — a dead island. Worse, the throw propagates out of the `forEach` callback in `hydratePending` (lines 77-79), aborting iteration so every subsequent not-yet-hydrated instance of that selector is never hydrated.
- **repro:**
```
Static-code reproduction (no build required), against ui/.sprig/compiler/hydrate.ts:

1. SSR emits, for each island instance, `<sprig-island data-sel="x"><script type="application/json" class="sprig-props">{...}</script>...</sprig-island>` (render.ts:183-184).

2. Suppose two instances of the same selector `x` are on the page and, due to an external cause (truncated/streamed response, mangling proxy), the FIRST instance's `<script class="sprig-props">` body is non-JSON (e.g. `{"a":` — truncated).

3. The island chunk loads and calls registerIsland("x", entry) -> hydratePending("x") (hydrate.ts:73,76).

4. hydratePending querySelectorAll matches BOTH instances and runs `.forEach((el) => hydrateIsland(el, entry))` (lines 77-79).

5. For instance #1, hydrateIsland sets `el.dataset.sprigHydrated = "1"` (line 178), then `JSON.parse("{\"a\":")` (line 182) throws SyntaxError. There is no try/catch.

6. The throw propagates out of the forEach callback, ABORTING iteration. Instance #2's hydrateIsland is never called -> instance #2 stays interactive-dead.

7. Instance #1 is already flagged `data-sprig-hydrated="1"` but ran no setup/effect/listeners -> dead island. Any later hydratePending (e.g. from loadIsland's `registry.has` path at line 122-124, or soft-nav re-arm via bootstrapIslands) skips it via the `:not([data-sprig-hydrated])` selector (line 78) and the line-177 guard -> never recovers.

Expected: a prop-bridge parse failure should be caught and logged, the bad island skipped (and NOT marked hydrated, or marked but degraded), and sibling islands should still hydrate. Fix: wrap the JSON.parse in try/catch, only set the hydrated flag after a successful parse (or mark a distinct failure state), and wrap the per-element hydrateIsland call in hydratePending's forEach in try/catch so one failure cannot abort the rest.
```
- **evidence:**
```
hydrate.ts: line 177 `el.dataset.sprigHydrated = "1";` precedes line 182 `const inputs: Scope = propsEl?.textContent ? JSON.parse(propsEl.textContent) : {};`. `hydratePending` (76-80) calls `.forEach((el) => hydrateIsland(...))` with no error isolation; an exception in one iteration ends the forEach.
```
- **independent verification:**
```
Verified against the cited code in /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/hydrate.ts.

The mechanism described is exactly correct (one line-number nit aside):
- hydrateIsland sets the hydrated flag BEFORE parsing. Line 178 `el.dataset.sprigHydrated = "1";` runs before line 182 `const inputs: Scope = propsEl?.textContent ? JSON.parse(propsEl.textContent) : {};`. (The report attributes the flag-set to line 177; line 177 is actually the early-return guard `if (el.dataset.sprigHydrated) return;` and the assignment is line 178 — substance unchanged: flag set before parse.)
- The JSON.parse at line 182 has no try/catch. A non-parseable props body throws.
- hydratePending (lines 76-80) iterates with `.forEach((el) => hydrateIsland(...))` and no per-element error isolation, so a throw in one iteration propagates out and aborts the whole forEach, leaving every later not-yet-hydrated instance of that selector unhydrated. Both registerIsland (line 73) and loadIsland (line 124) reach hydratePending, and it queries ALL matching `sprig-island[data-sel=...]` elements, so multiple same-selector instances genuinely coexist and are iterated together.
- The throwing element is left permanently flagged: any later hydratePending skips it both via the `:not([data-sprig-hydrated])` selector (line 78) and the line-177 guard, so retry never recovers it. Dead island: flag set, but entry.setup, the effect render (193-198), and event wiring (202-216) never ran.

Data path confirmed: render.ts:179-184 emits `<script type="application/json" class="sprig-props">` containing `JSON.stringify(inputs)` (only `<` escaped), which is what hydrate.ts:181-182 reads back. So the parse target is real and the runtime ordering is real.

So the code defect (unguarded parse, ordering of the flag, and lack of error isolation in the forEach) is genuine and reproducible by reading the code. I downgraded severity from medium to low: the props payload is machine-generated valid JSON with `<` escaped, so under normal SSR it can never be malformed. The report's own trigger list (truncated/streamed HTML, a mangling proxy, a future serializer change) confirms it requires an abnormal/external precondition rather than firing on the intended path. It is a real robustness/defense-in-depth gap whose blast radius (sibling islands of the same selector also fail) makes it worse than a single isolated failure, hence low rather than info — but not medium, since it does not occur under intended operation.
```

### 48. Per-island reactive effect is never disposed → production memory leak + writes to detached nodes after soft-nav
- **severity:** low  ·  **category:** resource-leak
- **area:** Client hydration runtime (ui/.sprig/compiler/hydrate.ts): effect lifecycle, lazy-load observers, soft-nav re-arm
- **location:** `ui/.sprig/compiler/hydrate.ts:193-198 (effect created, return value discarded); ui/.sprig/compiler/hydrate.ts:161-165 (soft-nav swap destroys outlet children via cur.innerHTML = next.innerHTML)`
- **expected:** When an island element is removed from the document (e.g. its outlet is swapped during soft navigation), its reactive effect should be disposed so the effect, the island's `scope`/signals, and the detached `el` can be garbage-collected, and so no further `el.innerHTML = ...` runs against a detached node.
- **actual:** `effect(() => {...})` at hydrate.ts:193 returns a disposer (preact/signals-core `effect` returns a dispose function — re-exported at ui/.sprig/core.ts:17-18) but the return value is discarded. Nothing in hydrate.ts ever disposes it. After soft-nav swap (hydrate.ts:161-165) the island element is detached yet the effect stays subscribed: it retains `el`, `scope`, `nodes`, `handlers` (leak), and if any retained signal it reads later changes it executes `el.innerHTML = renderNodes(...)` (hydrate.ts:196) on a node no longer in the document (wasted work / surprising). This happens in PRODUCTION and is independent of HMR — distinct from the already-reported dev-only `live[]` growth (the `live.push` at hydrate.ts:218 is gated behind `hmrEnabled`, so it is NOT the prod leak path).
- **repro:**
```
Code-level (deterministic, no running app needed):
1. Read ui/.sprig/core.ts:17-18 — `effect` is re-exported from @preact/signals-core (locked 1.14.2).
2. Read .../@preact/signals-core/1.14.2/dist/signals-core.d.ts:139 — `function effect(fn): DisposeFn` returns a disposer.
3. Read ui/.sprig/compiler/hydrate.ts:193-198 — the disposer is discarded (no capture, no storage).
4. Read hydrate.ts:161-165 — soft-nav `swap()` does `cur.innerHTML = next.innerHTML`, detaching all hydrated islands; no per-island teardown is invoked.
5. grep hydrate.ts for dispose/cleanup — only trigger-observer cleanups exist; `live.push` (the only re-find path) is gated behind `if (hmrEnabled && tick)` at :218, so prod has no teardown.

To make the latent leak/detached-write actually fire (not satisfied by the cited counter/star-rating fixtures): create an island whose setup reads a module-level/shared signal kept alive elsewhere (or starts a setInterval that writes a signal). Mount it inside <sprig-outlet>, soft-navigate away (Navigation API intercept -> swap). After the swap, mutate that shared signal: the still-subscribed effect runs `el.innerHTML = renderNodes(...)` against the detached `el`, and the effect (plus el/scope/nodes) stays rooted via the live signal's subscriber list and is never collected.
```
- **evidence:**
```
hydrate.ts:193-198 `effect(() => { tick?.(); const hs=[]; el.innerHTML = renderNodes(...); handlers = hs; });` — no `const dispose =` capture, no disposer stored anywhere. ui/.sprig/core.ts:17-18 imports & re-exports `effect` from `@preact/signals-core`, whose `effect()` returns a dispose callback. soft-nav swap at hydrate.ts:161-165 detaches outlet children with no per-island teardown call. Confirmed against live server: curl http://localhost:8200/ui/issues/SPR-101 returns `sprig-island ... data-sel="counter" data-trigger="load"` and `data-sel="star-rating" data-trigger="visible"` inside the outlet, so real islands are subject to this swap.
```
- **independent verification:**
```
All load-bearing factual claims are verified against the code:

1. `effect()` returns a disposer that is discarded. `ui/.sprig/core.ts:17-18` re-exports `effect` from `@preact/signals-core` (locked at 1.14.2 per deno.lock). Its type def (`.../signals-core/1.14.2/dist/signals-core.d.ts:139`) declares `function effect(fn): DisposeFn` — it returns a dispose function. At `hydrate.ts:193` the call is `effect(() => {...})` with no `const dispose =` capture; the return value is dropped.

2. Soft-nav swaps the outlet wholesale. `hydrate.ts:161-165` `swap()` does `cur.innerHTML = next.innerHTML`, which detaches every previously-hydrated `sprig-island` element. `setupSoftNav` is reachable in production: `client-entry.gen.ts:8` and `build.ts:58` both wire it into the generated client entry.

3. No teardown exists. Grepping `hydrate.ts` for dispose/disconnect/removeEventListener/cleanup shows the ONLY cleanups are the trigger-arming observers/listeners (IntersectionObserver.disconnect at :98, removeEventListener at :109-110). Nothing ever disposes the per-island effect, and the `live[]` registration that could re-find instances is gated behind `if (hmrEnabled && tick)` at :218, so it does not exist in prod. The prod path therefore has zero per-island teardown.

So the defect is real: the hydration runtime provides no disposal contract for an island whose host element leaves the document. This is not working-as-designed (there is simply no teardown code) and not a misunderstanding.

However, the claimed SEVERITY ("production memory leak + writes to detached nodes") is overstated for the actual cited fixtures, which is why I downgrade medium -> low:

- Leak: both cited islands (counter/logic.ts, star-rating/logic.ts) declare ONLY local signals with no external root. After detach, effect <-> signal <-> el <-> scope/nodes form a closed reference cycle reachable from no live root. A modern tracing GC reclaims closed garbage cycles, so the el is NOT permanently retained for these fixtures. The leak only becomes real for an island that subscribes to a longer-lived signal (a shared/global store, an interval/timer-driven signal, or a cross-island value) — none of which the cited fixtures use. So the leak is latent/conditional, not demonstrated by the repro as written.

- Writes-to-detached-node: the delegated event listeners are attached to `el` itself (hydrate.ts:206), and after the swap `el` is detached, so its buttons are no longer in the document and cannot fire. Nothing in the cited fixtures mutates the island signals after detach, so the `el.innerHTML = ...` re-run at :196 is never actually triggered for this repro. It would only fire if an external/long-lived signal the effect read later changes.

Net: genuine defect (missing disposal contract — a correctness/resource-hygiene gap that bites the moment any island uses non-local reactive state), but not the guaranteed prod memory leak the title asserts for these specific fixtures. Hence real=true, severity=low.
```

### 49. API endpoints ignore the request Content-Type: any media type (text/plain, application/xml, missing) is parsed as JSON and accepted
- **severity:** low  ·  **category:** protocol
- **area:** Cross-cutting HTTP correctness (content-type negotiation, error reflection, method/header handling) on the keep API channel and SSR surface at http://localhost:8200
- **location:** `packages/keep/mod.ts:90-93 (serveSprig forwards /api/* to config.keep.handler) -> backend/src/board/entrypoints/http/mod.ts:44-57 (@Endpoint issue/board/user); the @mrg-keystone/keep @Endpoint request pipeline parses the body as JSON regardless of Content-Type`
- **expected:** A POST whose body is declared as text/plain or application/xml (or with no/unknown Content-Type) should be rejected with 415 Unsupported Media Type (or at minimum require application/json), not silently parsed as JSON and accepted with 200.
- **actual:** Every variant returns HTTP 200 with the full IssueDetailDto. The endpoint pipeline never inspects Content-Type; it always treats the raw body as JSON. This is a content-type negotiation defect: clients can submit JSON under any media type and the server processes it, defeating any content-type-based filtering/CSRF-style protection a proxy or middleware would rely on.
- **repro:**
```
Against the running server (cwd = repo root):

# valid JSON path (baseline) -> 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8200/api/http/issue \
  -H 'content-type: application/json' --data '{"issueId":"SPR-101"}'

# text/plain -> 200 (full IssueDetailDto returned)
curl -s -X POST http://localhost:8200/api/http/issue \
  -H 'content-type: text/plain' --data '{"issueId":"SPR-101"}'

# application/xml -> 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8200/api/http/issue \
  -H 'content-type: application/xml' --data '{"issueId":"SPR-101"}'

# empty content-type -> 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8200/api/http/issue \
  -H 'content-type:' --data '{"issueId":"SPR-101"}'

# no content-type header -> 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8200/api/http/issue \
  --data-binary '{"issueId":"SPR-101"}'

All five return 200; the non-JSON variants return the same full IssueDetailDto as the JSON variant, proving Content-Type is never inspected. Code: packages/keep/mod.ts:90-93 forwards the request unmodified; backend/src/board/entrypoints/http/mod.ts:44 (input: IssueRefDto) drives the keep @Endpoint pipeline that parses the body as JSON without a media-type gate.
```
- **evidence:**
```
Observed live: `content-type: text/plain` -> 200 with {"issue":{"id":"SPR-101",...}}; `content-type: application/xml` -> 200 same body; missing content-type -> 200 same body. Compare to the valid JSON path (`application/json; charset=UTF-8` response). The keep @Endpoint pipeline (backend/src/board/entrypoints/http/mod.ts:44-57 declares `input: IssueRefDto`) parses the body before validation with no media-type gate (packages/keep/mod.ts:90-93 forwards unmodified).
```
- **independent verification:**
```
I reproduced the claimed behavior live against the running server at http://localhost:8200. All three cited variants plus a no-header variant returned HTTP 200 with the full IssueDetailDto body, despite the request body being declared as a non-JSON media type:

- content-type: text/plain  -> 200, body {"issue":{"id":"SPR-101",...},"users":[...]}
- content-type: application/xml -> 200, same body
- content-type: (empty) -> 200, same body
- no content-type header at all -> 200, same body

The valid path (application/json) also returns 200 with response header `content-type: application/json; charset=UTF-8`. So the endpoint pipeline never inspects the request Content-Type; it parses the raw body as JSON unconditionally. The code path is confirmed: packages/keep/mod.ts:90-93 forwards /api/* to config.keep.handler unmodified (it only rewrites the pathname, copying the original Request including headers/body), and backend/src/board/entrypoints/http/mod.ts:44 declares the `issue` endpoint with `input: IssueRefDto`, so the @mrg-keystone/keep @Endpoint pipeline parses and validates the body without a media-type gate.

So the OBSERVATION in the report is accurate and reproducible. However, I am rating this LOW rather than medium, because this is essentially standard, working-as-designed behavior for JSON API frameworks (danet/NestJS-style, Express without strict type matching, etc.), not a genuine correctness defect:

1. There is no security impact from accepting JSON under a non-JSON Content-Type. The report's claim that this 'defeats content-type-based filtering/CSRF-style protection a proxy or middleware would rely on' is backwards: a `text/plain` body is exactly the classic CSRF simple-request vector. Requiring application/json (and thus rejecting text/plain) is a *protection*; accepting text/plain does not weaken an existing protection here because none is configured. No proxy/middleware enforcing content-type exists in this codebase.
2. RFC 7231 makes 415 a permitted-but-not-required response; servers are free to be lenient about Content-Type on a body they can parse. Returning 200 for a syntactically valid JSON body is not a protocol violation.
3. The endpoint still validates the parsed body against the DTO (IssueRefDto), so malformed/garbage bodies are rejected on schema grounds — the content-type just isn't a gate.

This is a hardening/strictness preference (enforce application/json, return 415 otherwise), not a reproducible failure of intended functionality. It is real and reproducible behavior, hence real=true, but the framing as a meaningful HTTP-correctness/protocol defect overstates it; severity is low/info-tier.

Note: GET /api/http/board returns 404 (the board/dashboard endpoints don't resolve via GET on this server), but that is unrelated to this content-type claim and the issue POST path works as described.
```

### 50. 500 not-found error reflects the entire unbounded issueId back to the client (info reflection / amplification)
- **severity:** low  ·  **category:** security
- **area:** Cross-cutting HTTP correctness (content-type negotiation, error reflection, method/header handling) on the keep API channel and SSR surface at http://localhost:8200
- **location:** `backend/src/board/domain/business/issue/mod.ts:16 (throw new Error(`no issue with id "${id}"`)) reached because backend/src/board/dto/issue-ref.ts:16-18 only constrains issueId with @IsString() (no length bound)`
- **expected:** A 200KB issueId should be rejected by input validation (e.g. a length/format constraint) with 422 before reaching business logic, and any error must not echo attacker-controlled input back unbounded.
- **actual:** Returns HTTP 500 with {"status":500,"message":"no issue with id \"AAAA...(all 200000 chars)...\""} — the full attacker payload is reflected verbatim in the error body. This couples the already-reported not-found-500 leak with unbounded input reflection: a client can force the server to echo arbitrarily large strings (response amplification) and confirms issueId has no length constraint.
- **repro:**
```
python3 -c "print('{\"issueId\":\"'+ 'A'*200000 +'\"}')" | curl -s -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' --data-binary @- -o /tmp/resp.txt -w "status=%{http_code} size=%{size_download}\n"
# -> status=500 size=200048
head -c 120 /tmp/resp.txt
# -> {"status":500,"message":"no issue with id \"AAAAAAAA...
python3 -c "print(open('/tmp/resp.txt').read().count('A'))"
# -> 200000  (entire payload reflected verbatim)
```
- **evidence:**
```
Live response body began with {"status":500,"message":"no issue with id \"AAAAAAAA...\"" containing the entire 200000-character input. issue-ref.ts:16-18 shows issueId is only @IsString(); the throw at issue/mod.ts:16 interpolates ${id} directly into the Error message which the keep pipeline returns to the client as the 500 body.
```
- **independent verification:**
```
Verified against the live server at http://localhost:8200 and confirmed in source. IssueRefDto (backend/src/board/dto/issue-ref.ts:16) constrains issueId with only @IsString() — there is no MaxLength/Matches/Length validator anywhere in backend/src/board/dto (grep confirms). So an arbitrarily large issueId passes validation and reaches Issue.assemble in backend/src/board/domain/business/issue/mod.ts, which at line 15 throws `new Error(\`no issue with id \"${issueId}\"\`)`, interpolating the full attacker-controlled string. The keep pipeline serializes that Error message into the 500 JSON body, echoing the input verbatim.\n\nLive reproduction: POSTing a 200000-character issueId returned HTTP 500 with size_download=200048 and a body beginning {"status":500,"message":"no issue with id \"AAAA..."} whose 'A' count was exactly 200000 — the entire payload reflected back. This is a genuine, reproducible defect: missing input length bound + verbatim reflection of attacker input in an error response.\n\nScoping/severity note: the report's "amplification" label is slightly overstated — the response roughly mirrors the request size (~1x echo ratio, not a multiplier), the input is non-persistent, and the data reflected is the attacker's own bytes (no sensitive data disclosed). The real defects are (1) no length/format constraint on issueId and (2) interpolating raw user input into a client-visible 500 error. Both are real but low impact, so severity low is correct.
```

### 51. SSR pages and static assets ignore the HTTP method: PUT/DELETE/TRACE/OPTIONS all return 200 with a full body
- **severity:** low  ·  **category:** protocol
- **area:** Cross-cutting HTTP correctness (methods, error responses, headers) on the running sprig app at http://localhost:8200
- **location:** `ui/.sprig/core.ts:334-356 (bootstrap.fetch never reads req.method); packages/keep/mod.ts:39-103 (serveAsset/serveSprig.fetch have no method gating)`
- **expected:** Read-only SSR/asset routes should only honor GET (and HEAD). Unsupported mutating methods (PUT/DELETE) should return 405 Method Not Allowed with an Allow header; OPTIONS should return 204 (or 200) with an Allow header and NO body; TRACE should be rejected (405) to avoid Cross-Site Tracing. A full 200 HTML/JS body for a PUT/DELETE/TRACE/OPTIONS is incorrect.
- **actual:** Every method is treated like GET. bootstrap.fetch (core.ts:334) matches the route and returns the rendered 200 HTML for any method; serveAsset (keep/mod.ts:39) returns the 200 asset bytes for any method. OPTIONS returns the entire 2153-byte HTML document; TRACE is honored (XST); PUT/DELETE return 200 instead of 405 with no Allow header.
- **repro:**
```
Against the running app (cwd = repo root):

1. curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -X PUT    http://localhost:8200/ui                  # → 200 2153
2. curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -X DELETE http://localhost:8200/ui                  # → 200 2153
3. curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -X TRACE  http://localhost:8200/ui                  # → 200 2153
4. curl -s -I -X OPTIONS http://localhost:8200/ui                                                                # → HTTP/1.1 200 OK, content-type text/html, content-length 2153 (full document, no Allow header)
5. curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -X POST   http://localhost:8200/ui/_assets/client.js # → 200 215

All five return 200 with a full body; none return 405/Allow. Source confirms no method gating:
- grep -n method /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/core.ts        → no matches
- grep -n method /Users/raphaelcastro/Documents/programming/sprig/packages/keep/mod.ts      → no matches
(ui/.sprig/core.ts:334-356 bootstrap.fetch; packages/keep/mod.ts:39-54 serveAsset, 80-101 serveSprig.fetch)
```
- **evidence:**
```
Observed on http://localhost:8200: `curl -I -X OPTIONS /ui` → HTTP/1.1 200 OK, content-type text/html, content-length 2153 (full DOCTYPE document echoed). PUT/DELETE/TRACE /ui each → 200 len=2153. POST/DELETE /ui/_assets/client.js → 200 len=215. Source: core.ts bootstrap.fetch (lines 334-356) and keep/mod.ts serveSprig.fetch (81-101)/serveAsset (39-54) contain no `req.method` check anywhere.
```
- **independent verification:**
```
Reproduced every claim against the running app at http://localhost:8200 and confirmed the root cause in source.

Behavior observed (exactly as claimed):
- `PUT /ui` → 200, body 2153 bytes (full HTML)
- `DELETE /ui` → 200, body 2153 bytes
- `TRACE /ui` → 200, body 2153 bytes
- `OPTIONS /ui` (-I) → HTTP/1.1 200 OK, content-type text/html, content-length 2153 — full HTML document, no Allow header
- `POST /ui/_assets/client.js` → 200, body 215 bytes (asset served)

Root cause confirmed in source:
- ui/.sprig/core.ts:334-356 — bootstrap.fetch reads only url.pathname, matches the route, and returns the rendered HTML with status 200 regardless of req.method. `grep -n method` on this file returns nothing.
- packages/keep/mod.ts:39-103 — serveAsset (39-54) reads the file and returns 200 bytes for any method; serveSprig.fetch (80-101) dispatches purely on path with no method gating. `grep -n method` on this file returns nothing.

So the defect is genuine and reproducible: these read-only routes are not method-gated. Per HTTP semantics, unsupported mutating methods on a read-only resource should yield 405 Method Not Allowed with an Allow header, OPTIONS should return an Allow header with no body, and TRACE is conventionally disabled to avoid Cross-Site Tracing.

Severity assessment — I am downgrading the claimed "high" to "low":
- This is a protocol-conformance / hardening nit, not a security or data-integrity defect. The SSR and asset routes are genuinely read-only: there is no write path, no state mutation, and no authentication on these specific routes, so honoring PUT/DELETE as GET does not expose any privileged action or corrupt any data — it merely returns the same public HTML/JS that a GET would.
- The cited XST (Cross-Site Tracing) risk via TRACE is largely theoretical on a modern stack: TRACE-based attacks depend on reflecting sensitive headers (e.g. cookies/auth) back to script, but this app sets no httpOnly auth cookie on the SSR origin that TRACE could leak, and the response does not echo the request (Deno.serve does not implement RFC TRACE echo — the handler just renders the page). It is still good practice to reject TRACE, but the practical exposure is minimal.
- OPTIONS returning a body instead of an empty 204/200+Allow is a correctness wart but harmless.
- No real client (browser navigation, fetch GET, CDN) is broken by this; it only affects conformance tools / scanners / non-GET clients that nobody legitimately points at these routes.

It is a real, working-as-NOT-designed defect worth fixing for cleanliness and to satisfy security scanners, hence real=true, but the absence of any privileged or stateful action behind these routes makes it low severity rather than high.
```

### 52. Malformed or empty JSON request body returns 500 (not 400) and leaks the internal JSON-parser error message to the client
- **severity:** low  ·  **category:** protocol
- **area:** Cross-cutting HTTP correctness (methods, error responses, headers) on the running sprig app at http://localhost:8200
- **location:** `keep network channel reached via POST /api/* (serve.ts:6 serveSprig base; packages/keep/mod.ts:90-93 forwards to config.keep.handler). Body parse happens in the keep/danet pipeline before the board controller backend/src/board/entrypoints/http/mod.ts:114-117`
- **expected:** A syntactically invalid / empty request body is a CLIENT error and should return 400 Bad Request, with a generic message. The framework already distinguishes validation failures as 422 (missing issueId → 422 RuneAssertError), so a malformed body should likewise be a 4xx, not a 500, and must not leak the V8/Deno JSON-parser exception text.
- **actual:** Both malformed and empty JSON bodies surface as 500 Internal Server Error, and the response body reflects the raw internal parser exception string ("Expected property name or '}' in JSON at position 1 (line 1 column 2)" / "Unexpected end of JSON input"). 500 falsely signals a server fault for a client-caused condition, and the parser internals are leaked.
- **repro:**
```
Against the running app at http://localhost:8200:

# Malformed JSON body -> 500 + leaked parser message
curl -s -D - -X POST -H 'content-type: application/json' -d '{bad json' http://localhost:8200/api/http/issue
#  HTTP/1.1 500 Internal Server Error
#  {"status":500,"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}

# Empty body -> 500 + leaked parser message
curl -s -D - -X POST -H 'content-type: application/json' http://localhost:8200/api/http/issue
#  HTTP/1.1 500 Internal Server Error
#  {"status":500,"message":"Unexpected end of JSON input"}

# CONTRAST: well-formed but missing field -> correct 4xx
curl -s -D - -X POST -H 'content-type: application/json' -d '{}' http://localhost:8200/api/http/issue
#  HTTP/1.1 422 Unprocessable Entity
#  {"name":"RuneAssertError","message":"Validation failed for IssueRefDto ... issueId must be a string", ...}

Expected: malformed/empty body should be 400 Bad Request with a generic message (no parser internals), consistent with the 422 returned for the missing-field case.
```
- **evidence:**
```
Observed on http://localhost:8200. Contrast: missing-field body `{}` correctly returns 422 (`RuneAssertError ... issueId must be a string`), proving the seam can return 4xx; but a malformed body short-circuits earlier in the body-parse step and returns 500 with the parser message. Same 500+leak for an empty body. content-type of the leak: application/json; charset=UTF-8.
```
- **independent verification:**
```
Reproduced exactly as claimed against the live app at http://localhost:8200.

Malformed body: `curl -X POST -H 'content-type: application/json' -d '{bad json' .../api/http/issue` returns `HTTP/1.1 500 Internal Server Error` with body `{"status":500,"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}`. Empty body returns `500` with `{"status":500,"message":"Unexpected end of JSON input"}`. Content-type of both is `application/json; charset=UTF-8`.

The contrast case proves intent: a well-formed-but-incomplete body `{}` returns `HTTP/1.1 422 Unprocessable Entity` with a clean structured RuneAssertError (`issueId must be a string`). So the seam can and does return 4xx for client-caused body problems — only the JSON-syntax failure short-circuits earlier and falls through to the generic 500 handler.

Root cause path: serve.ts:7 -> packages/keep/mod.ts:90-93 forwards /api/* to config.keep.handler (danet/@danet/core 2.11.0). Body parsing happens in danet's request-mapping layer before the controller (backend/src/board/entrypoints/http/mod.ts:45 `issue(body)`). I confirmed in the JSR-cached danet source that the request-mapping path does `body = await context.req.json();` with NO try/catch (e.g. ~/Library/Caches/deno/remote/.../fffff400...:29), so the V8 SyntaxError from JSON.parse propagates unguarded into danet's top-level error filter, which maps unknown errors to 500 and serializes err.message verbatim into the response — leaking the parser internals. (Notably other danet paths DO guard json() with try/catch, showing the unguarded mapping path is the defect.)

Two real problems, both genuine and reproducible: (1) wrong status — a client-caused syntactic body error is reported as 500 (server fault) instead of 400/422; (2) information leak — the raw parser exception string is returned to the client.

Severity assessment: I lowered this from medium to LOW. The leaked text is a generic, non-sensitive V8/Deno JSON parser message (position/line/column of the syntax error) — it exposes no stack trace, no file paths, no secrets, no internal implementation detail beyond "this is a JSON parser." The wrong status code is a real HTTP-correctness defect but has no security or availability impact (no crash, no resource exhaustion; the request is cleanly rejected). It is a protocol-correctness/polish issue, not a security or stability one. The root cause is in the third-party @danet/core framework, not in sprig's own code, though sprig could add a body-parse guard in the keep layer (packages/keep/mod.ts) before forwarding.
```

### 53. SSR HTML responses carry no security headers (no X-Content-Type-Options/nosniff, no X-Frame-Options/CSP) while embedding inline JSON islands
- **severity:** low  ·  **category:** security
- **area:** Cross-cutting HTTP correctness (methods, error responses, headers) on the running sprig app at http://localhost:8200
- **location:** `ui/.sprig/core.ts:356 (Response headers only set content-type) and ui/.sprig/compiler/mod.ts:123-140 (document() emits no security meta/headers); packages/keep/mod.ts:45-49 (asset Response headers)`
- **expected:** HTML pages that serve attacker-influenceable inline JSON (the __sprig_inputs / sprig-props bridges and __sprig_config) should at minimum set X-Content-Type-Options: nosniff, and ideally X-Frame-Options/CSP and Referrer-Policy, to harden against MIME-sniffing and clickjacking.
- **actual:** No security headers are emitted on any SSR HTML or asset response; only content-type (and cache-control on assets) is set.
- **repro:**
```
1. Ensure the sprig app is running (http://localhost:8200).
2. Run: curl -s -D - -o /dev/null http://localhost:8200/ui | grep -iE 'x-content-type|x-frame|content-security|referrer|strict-transport'
   -> no output (none of these headers are present).
3. Full header dump shows only: content-type: text/html; charset=utf-8, vary, content-length, date.
4. Confirm inline JSON island in body: curl -s http://localhost:8200/ui | grep -oE '__sprig_config|application/json' -> matches.
Source: ui/.sprig/core.ts:356 sets only content-type; ui/.sprig/compiler/mod.ts:123-140 document() emits no security meta; packages/keep/mod.ts:45-49 asset headers are content-type + cache-control only. Note: inline JSON is already <-escaped at core.ts:366 and mod.ts:136, mitigating the JSON-injection angle.
```
- **evidence:**
```
`curl -D - /ui` headers: content-type, vary, content-length, date only — grep for x-content-type/x-frame/content-security/strict-transport/referrer returns nothing. Confirmed in source: core.ts:356 sets only {content-type}; compiler/mod.ts document() head contains only meta charset/viewport + stylesheet/modulepreload.
```
- **independent verification:**
```
Reproduced against the live app at http://localhost:8200 and confirmed in source. Live `curl -s -D - -o /dev/null http://localhost:8200/ui` returns only: HTTP/1.1 200 OK, content-type: text/html; charset=utf-8, vary, content-length, date. Grepping the headers for x-content-type/x-frame/content-security/referrer/strict-transport yields nothing. The served body does embed an inline JSON island (`__sprig_config`, type=application/json).

Source confirms the cause:
- ui/.sprig/core.ts:356 — `return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });` (only content-type).
- ui/.sprig/compiler/mod.ts:123-140 — `document()` head contains only meta charset/viewport + stylesheet/modulepreload; emits no security meta.
- packages/keep/mod.ts:45-49 — asset Response sets only content-type + cache-control.

So the factual claim (no security headers on SSR HTML or assets) is accurate and reproducible, and the file:line citations are correct.

This is a genuine but minor defense-in-depth hardening gap, not a functional/correctness defect — hence low severity, consistent with the report's own rating:
- The report's framing that the inline JSON is "attacker-influenceable" and warrants nosniff against an injection vector is overstated: the JSON islands are already HTML-escaped against `<` injection at both core.ts:366 (`json.replace(/</g, "\\u003c")`) and mod.ts:136, so the primary XSS-via-JSON-island vector is already mitigated independent of headers.
- Every response already carries an explicit, correct content-type, which substantially blunts MIME-sniffing risk, making the missing `X-Content-Type-Options: nosniff` a belt-and-suspenders addition rather than a fix for an exploitable hole.
- X-Frame-Options/CSP/Referrer-Policy are legitimate best-practice hardening but their absence is working-as-designed (no header was ever wired in), not a bug in intended behavior.

Verdict: real=true because it is a genuine, reproducible, accurately-located security-hardening omission; severity low/info because there is no demonstrated exploitable defect and the strongest items are best-practice recommendations.
```

### 54. Home page is dual-mounted: bare "/" serves the full SSR home document identical to the on-base "/ui", bypassing the base prefix
- **severity:** low  ·  **category:** logic
- **area:** Cross-cutting HTTP correctness (routing/base-mount, method handling on SSR routes)
- **location:** `ui/.sprig/core.ts:337-338 (bootstrap().fetch base handling)`
- **expected:** The app is mounted at base "/ui". A request to bare "/" (off the base) should 404 (Not Found), exactly like /board, /issues/SPR-101, /users/ada already do — those correctly return 404.
- **actual:** GET / returns HTTP 200 with the full dashboard HTML document, byte-for-byte identical to GET /ui. The home (empty-path) route is reachable at two URLs.
- **repro:**
```
Start the server and compare bare "/" against the on-base "/ui":

  deno serve -A --unstable-kv --port 8233 serve.ts &
  # wait until /ui returns 200, then:
  curl -s -o /tmp/root.html -w "/ %{http_code} %{size_download}\n"  http://localhost:8233/
  curl -s -o /tmp/ui.html   -w "/ui %{http_code} %{size_download}\n" http://localhost:8233/ui
  curl -s -o /dev/null      -w "/board %{http_code} %{size_download}\n" http://localhost:8233/board
  diff /tmp/root.html /tmp/ui.html && echo IDENTICAL

Observed:
  GET /      -> 200, 2153 bytes
  GET /ui    -> 200, 2153 bytes   (diff: IDENTICAL)
  GET /board -> 404, 9 bytes
  GET /issues/SPR-101 -> 404, 9 bytes
  GET /users/ada      -> 404, 9 bytes

Expected: GET / (off the "/ui" base) should 404 like the other off-base paths, instead of serving the dashboard document.

Root cause: ui/.sprig/core.ts:338 — the `else if (base && path !== "/")` guard excludes bare "/" from the off-base 404, leaving path="/", which matchRoute matches to the `{ path: "" }` dashboard route (ui/src/main.ts:15). Fix: drop the `&& path !== "/"` exception (i.e. 404 any path that is not under the base, including "/"), or canonical-redirect bare "/" to the base.
```
- **evidence:**
```
Root cause: bootstrap() base guard at ui/.sprig/core.ts:337-338:  `if (base && (path === base || path.startsWith(base + "/"))) path = path.slice(base.length) || "/"; else if (base && path !== "/") return 404;`  The `path !== "/"` exception lets bare "/" fall through WITHOUT stripping base, leaving path="/". matchRoute then matches the dashboard route `{ path: "" }` (ui/src/main.ts:15), so the home page renders off-base. Only "/" leaks (other off-base paths 404 correctly): curl http://localhost:8200/board and /issues/SPR-101 both return 404 len=9, but / returns 200 len=2153 == /ui. Consequence: duplicate-content URL (SEO/canonical + shared-cache key splitting), and the base-isolation contract ("the UI mounts at <base>") is violated for the index route.
```
- **independent verification:**
```
Verified by both static analysis and a live runtime reproduction.

Static trace: bootstrap().fetch at ui/.sprig/core.ts:337-338 does `if (base && (path === base || path.startsWith(base + "/"))) path = path.slice(base.length) || "/"; else if (base && path !== "/") return 404;`. With base="/ui" and an incoming bare path="/", the first branch is false (not "/ui" nor "/ui/..."), and the second branch's `path !== "/"` guard is also false, so neither branch fires and path stays "/" — the base is never required for the index. matchRoute (core.ts:290-313) splits "/" into segs=[]; the first route `{ path: "" }` (ui/src/main.ts:15) has rs=[], so the param loop never runs, ok stays true, rest is empty → it returns the dashboard route. Hence bare "/" renders the dashboard off-base.

I also confirmed the request actually reaches this code path: serveSprig (packages/keep/mod.ts:99-100) forwards everything that is not an asset/_assets, /api, or /docs request straight to config.app.fetch unmodified, so a bare GET / lands in bootstrap().fetch with path="/".

Runtime reproduction (deno serve on port 8233): GET / → 200, 2153 bytes; GET /ui → 200, 2153 bytes; `diff` of the two bodies = IDENTICAL. Control off-base paths behaved as the report claims: GET /board, GET /issues/SPR-101, GET /users/ada each → 404, 9 bytes ("Not Found"). So only the index route leaks off-base; every other route correctly 404s off-base. Expected-vs-actual, root cause, and the byte-identical evidence all match the report exactly.

Severity downgraded from medium to low: it is a real base-isolation/duplicate-content (canonical/SEO, cache-key splitting) defect, but it is a benign correctness leak — serving the index at bare "/" is a widespread and often intentional convenience, and there is no data exposure, crash, auth bypass, or method-handling impact. The report's secondary framing about "method handling on SSR routes" is not exercised by this defect.
```

### 55. SSR pages render HTTP 200 + full HTML body for EVERY method (DELETE/PUT/TRACE/PATCH/POST/OPTIONS) — no method guard on the SSR route
- **severity:** low  ·  **category:** protocol
- **area:** Cross-cutting HTTP correctness (routing/base-mount, method handling on SSR routes)
- **location:** `ui/.sprig/core.ts:334-356 (bootstrap().fetch never inspects req.method)`
- **expected:** SSR page routes are read-only resources. Non-GET/HEAD methods should return 405 Method Not Allowed (with an Allow: GET, HEAD header), or at minimum not echo a full response body. TRACE in particular should not reflect a 200 body.
- **actual:** Every method returns 200 with the complete page (len=2153, ct=text/html; charset=utf-8): DELETE: 200, PUT: 200, TRACE: 200, PATCH: 200, POST: 200, OPTIONS: 200 — each a full rendered document. No Allow header is ever emitted (curl -I -X OPTIONS http://localhost:8200/ui shows no Allow).
- **repro:**
```
Against the running sprig server (cwd = repo root, server on :8200):

for m in DELETE PUT TRACE PATCH POST OPTIONS; do printf '%s: ' $m; curl -s -o /dev/null -w '%{http_code} len=%{size_download} ct=%{content_type}\n' -X $m http://localhost:8200/ui; done
curl -s -I -X OPTIONS http://localhost:8200/ui | grep -i allow || echo "(no Allow header)"

Observed:
DELETE: 200 len=2153 ct=text/html; charset=utf-8
PUT:    200 len=2153 ct=text/html; charset=utf-8
TRACE:  200 len=2153 ct=text/html; charset=utf-8
PATCH:  200 len=2153 ct=text/html; charset=utf-8
POST:   200 len=2153 ct=text/html; charset=utf-8
OPTIONS:200 len=2153 ct=text/html; charset=utf-8
(no Allow header)

Root cause: ui/.sprig/core.ts:334-356 — bootstrap().fetch never inspects req.method.
```
- **evidence:**
```
bootstrap().fetch (ui/.sprig/core.ts:334) dispatches purely on url.pathname and never reads req.method; the resolve() + render() + `new Response(html, ...)` path (core.ts:340-356) runs identically for any verb. Observed live: `curl -X TRACE http://localhost:8200/ui` -> 200, content-length 2153, full HTML. This is distinct from the already-reported serveAsset any-method bug — this defect is on the SSR document route (config.app.fetch), not the static asset handler.
```
- **independent verification:**
```
Verified by both code inspection and live reproduction. In ui/.sprig/core.ts the bootstrap().fetch handler (lines 334-356) dispatches solely on url.pathname (matchRoute at 340, resolve at 350, render at 353-355, `new Response(html, ...)` at 356) and never reads req.method. There is no branch that rejects non-GET/HEAD verbs and no Allow header is ever set. Live against the running server on :8200, all six methods returned identical results: 200, len=2153, ct=text/html; charset=utf-8, each a full rendered document, and `curl -I -X OPTIONS` emitted no Allow header. This matches the claim precisely. It is non-conformant HTTP behavior for a read-only SSR resource (RFC 9110: a 405 with Allow, or at least not echoing a body for TRACE/OPTIONS, is expected). However it is correctly rated low: no state is mutated, no request-controlled data is reflected into the body (the page is the same SSR render regardless of method/body), so there is no security or functional impact — it is a protocol-correctness nit. Severity confirmed as low.
```

### 56. escapeAttr() under-escapes HTML attribute values (drops <, >, and single-quote), emitting non-conformant HTML
- **severity:** low  ·  **category:** correctness
- **area:** Cross-cutting HTTP correctness: SSR document, headers, content-type, error/info leaks, method/boundary handling
- **location:** `ui/.sprig/compiler/render.ts:418-420 (escapeAttr); used at render.ts:275 (every plain attribute), render.ts:183 (data-sel/data-trigger on <sprig-island>)`
- **expected:** The HTML-attribute escaper should escape at minimum &, ", <, > (and ideally ' ) so attribute values can never inject markup or produce malformed HTML, matching the text escaper escape() at render.ts:11 which already handles <,> .
- **actual:** escapeAttr escapes only & and ". '<', '>', and ''' pass through unescaped. Output for such values is non-conformant HTML (a literal '<' inside an attribute value is invalid and parser-dependent). Because all attributes are emitted double-quoted and '"' IS escaped, this is not currently a breakout/XSS vector with the present templates, but it is a real escaping-correctness gap and a defense-in-depth hole: if any future binding reflects user input into an attribute, '<'/'>' injection becomes possible without a quote.
- **repro:**
```
White-box reproduction of the escaper in isolation (matches render.ts:418-420 exactly):

  node -e 'const escapeAttr=s=>s.replace(/&/g,"&amp;").replace(/"/g,"&quot;"); console.log(`x="${escapeAttr(`a<b>c'"'"'d&e\"f`)}"`)'

Output:
  x="a<b>c'd&amp;e&quot;f"

The literal <, >, and ' pass through unescaped, yielding non-conformant HTML inside the attribute value. Contrast render.ts:11-13 escape() (used for text content) which escapes &, <, and >. Fix: have escapeAttr additionally replace /</g→&lt; and />/g→&gt; (and ideally /'/g→&#39;) so attribute escaping is at least as strong as text escaping.
```
- **evidence:**
```
render.ts:418  function escapeAttr(s: string): string {\n  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");\n}\n— contrast render.ts:10-13 escape() which escapes &,<,> for text content. Attribute emission render.ts:275: `${k}="${escapeAttr(v)}"`. The inconsistency (text content escapes <,> but attributes do not) confirms this is an oversight, not an intentional trust boundary.
```
- **independent verification:**
```
Verified by reading the cited code and reproducing the escaper behavior.

CODE CONFIRMED:
- render.ts:418-420 — `escapeAttr(s) = s.replace(/&/g,"&amp;").replace(/"/g,"&quot;")`. Only & and " are escaped; <, >, and ' pass through verbatim. Exactly as claimed.
- render.ts:275 — every plain attribute is emitted as ` ${k}="${escapeAttr(v)}"`, so all interpolated/bound attribute values route through this escaper.
- render.ts:183 — data-sel/data-trigger on <sprig-island> also use escapeAttr.
- render.ts:10-13 — the text-content escaper escape() DOES escape &, <, > . The asymmetry confirms the attribute escaper's omission of <,> is an oversight, not an intentional trust boundary.

DATA FLOW CONFIRMED: buildAttrs() (render.ts:239-277) collects attribute text from quotedText() interpolation (line 251) and from applyBinding() property-binding eval (line 256-257) into plain[name], which is then emitted through escapeAttr at line 275. So both `[attr]="expr"` bindings and `attr="{{interp}}"` reach the deficient escaper.

EMPIRICAL REPRO: ran the exact escapeAttr regex on `a<b>c'd&e"f`. Output: `x="a<b>c'd&amp;e&quot;f"` — literal <, >, and ' survive inside the double-quoted attribute, producing non-conformant HTML.

ASSESSMENT — REAL but LOW: This is a genuine escaping-correctness defect (malformed HTML for values containing <,> and inconsistent with the text escaper). However, as the reporter honestly concedes:
- All attributes are double-quoted and " IS escaped, so there is no attribute-breakout/XSS with current templates.
- No current binding reflects user-controlled < into an attribute, so there is no live exploit to demonstrate; the live impact is malformed HTML + a defense-in-depth gap if a future binding ever reflects untrusted input.
Impact is therefore HTML-conformance / defense-in-depth only, not a security vulnerability today. The reporter's 'low' severity is accurate. Not working-as-designed: the comment at render.ts:180-182 explicitly says escapeAttr exists "for consistency with every other attribute (defense-in-depth)", yet it is inconsistent with the text escaper — confirming the <,> omission is unintended.
```

### 57. Dynamic SSR HTML pages are served with no cache-control header (heuristically cacheable / cross-user staleness on shared caches)
- **severity:** low  ·  **category:** protocol
- **area:** Cross-cutting HTTP correctness: cache-control, content-type, error info-disclosure, SSR document, methods
- **location:** `ui/.sprig/core.ts:356 (Response built with only content-type); compiler render path ui/.sprig/compiler/mod.ts:72-82 (renderDocument returns a string, no headers); the ONLY cache-control in the SSR-serving code is the immutable asset header at packages/keep/mod.ts:48 and the dev SSE/ast no-cache at dev.ts:99,105`
- **expected:** Dynamic, per-resource HTML (board/dashboard/issue/user) should carry an explicit cache directive — e.g. 'cache-control: no-store' or at minimum 'private, no-cache' — so shared caches / CDNs / proxies do not heuristically cache and re-serve a page (RFC 9111 allows heuristic caching of responses with no explicit freshness info and a cacheable status). At minimum these dynamic pages must not be implicitly cacheable.
- **actual:** No cache-control, expires, pragma, etag, or last-modified is emitted on any SSR HTML response. With a 200 status and no freshness headers, a shared/intermediary cache is permitted to heuristically cache the HTML and serve a stale or wrong-resource copy. The codebase sets cache-control on immutable assets but never on the dynamic HTML it generates.
- **repro:**
```
Code-level (deterministic): trace serveSprig.fetch (packages/keep/mod.ts:80-101) -> config.app.fetch -> bootstrap().fetch (ui/.sprig/core.ts:334-356). Line 356 builds `new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })` with no cache-control. Confirm nothing else adds it:\n\n  grep -rniE 'cache-control|no-store|no-cache|expires|pragma|etag|last-modified' ui/.sprig packages/keep serve.ts ui/.sprig/compiler/dev.ts\n\n-> only hits: packages/keep/mod.ts:48 (immutable assets), ui/.sprig/compiler/dev.ts:99 & :105 (dev endpoints). None on the SSR HTML path.\n\nLive (with server running): \n  curl -s -D - -o /dev/null http://localhost:8200/ui/issues/SPR-101 | grep -iE 'cache|expires|pragma|etag|last-modified'\n-> prints nothing; only headers are content-type: text/html; charset=utf-8 (+ Deno's default vary: Accept-Encoding). Same for /ui, /ui/board, /ui/users/ada.\n\nFix: set an explicit directive at core.ts:356, e.g. headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }.
```
- **evidence:**
```
grep over ui/.sprig and packages/keep shows cache-control only at packages/keep/mod.ts:48 (assets, immutable), dev.ts:99 and dev.ts:105 (dev endpoints). core.ts:356 builds 'new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })' — no cache-control. Live: every /ui* GET returns 200 with no cache header (observed via curl -D -).
```
- **independent verification:**
```
Verified at the code level. The SSR serving path is: serveSprig.fetch (packages/keep/mod.ts:80-101) routes everything that is not /_assets, /api, or /docs to config.app.fetch, which is bootstrap().fetch in ui/.sprig/core.ts:331-358. That handler ends at line 356 with `return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })` — the only header is content-type. The compiler render path (ui/.sprig/compiler/mod.ts:72-82 renderDocument and the renderDocument fallback in core.ts:364-381) returns a bare string, so no headers originate there either. No wrapping middleware adds cache headers: I traced the entire chain and grepped for cache-control/no-store/no-cache/expires/pragma/etag/last-modified across ui/.sprig, packages/keep, serve.ts, and dev.ts. The ONLY matches are packages/keep/mod.ts:48 (immutable assets), and ui/.sprig/compiler/dev.ts:99 and :105 (dev SSE/AST endpoints). So every dynamic /ui* HTML response (dashboard/board/issue/user, all 200) is emitted with no explicit cache directive, no etag, no last-modified, no expires. Under RFC 9111 a cacheable-status response with no explicit freshness info MAY be heuristically cached by a shared cache/CDN/proxy, which is undesirable for dynamic per-resource HTML.\n\nThis is a genuine, reproducible defect (deterministic from the code, not a flaky observation), so real=true. However I am downgrading severity from medium to low: (1) the framing of "cross-user staleness" overstates the current impact — there is no auth/cookie/per-user content in this code; pages resolve deterministically by URL params, so the realistic risk is serving slightly stale (not wrong-user) data after the backend changes; (2) the renderDocument outputs carry no Last-Modified, and common heuristic-freshness algorithms (e.g. the RFC 9111 10%-of-Last-Modified heuristic) need Last-Modified to assign positive freshness, so many caches will treat these as immediately stale anyway. It is a real protocol-hygiene gap worth fixing (add `cache-control: no-store` or `private, no-cache` at core.ts:356), but its practical blast radius in the current codebase is small.
```

### 58. clientRoot() is dead code — the client injector is never activated, so client-side DI (inject(), scope:"both"/"client" services) can never work
- **severity:** low  ·  **category:** logic
- **area:** DI + in-process Backend (ui/.sprig/core.ts injector lifecycle; island setup() injector context; clientRoot)
- **location:** `ui/.sprig/core.ts:152-156 (clientRoot), ui/.sprig/compiler/hydrate.ts:183 (setup invoked with no injector)`
- **expected:** hydrateIsland should establish the client injector (e.g. runInInjector(clientRoot().child('component'), () => entry.setup(...))) so that client islands can inject scope:"client"/"both" services, matching the documented 'one root injector per document' design (core.ts:152-155).
- **actual:** clientRoot() exists, memoizes a per-document Injector on globalThis.__sprig_root, but is never invoked. The client never has an active injector, making the entire client side of the DI system inert and the scope:"client" branch of the scope guard (core.ts:129) unreachable in practice.
- **repro:**
```
White-box reproduction (no app run needed):
1. `grep -rn "clientRoot" ui/ packages/` → single hit: ui/.sprig/core.ts:153 (the declaration). No callers.
2. `grep -rn "runInInjector|__sprig_root|inject(" ui/ packages/` → runInInjector is called only at core.ts:350 inside server-side bootstrap(); every inject() consumer is a server resolve.ts/service.
3. Read ui/.sprig/compiler/hydrate.ts:183 → `const scope = entry.setup(clientCtx(inputs));` — setup() runs with no active injector.
4. Read core.ts:158-166 → `current` is undefined on the client, so any inject() inside a client setup() throws "inject() must be called synchronously within setup()...".
To make the latent bug manifest: register a service with scope:"client" (or "both"), add `const svc = inject(ThatService)` to an island logic.ts setup(), build, and hydrate the island in a browser — setup() throws because `current` is unset. Fix: in hydrateIsland, wrap the setup call, e.g. `const scope = runInInjector(clientRoot().child("component"), () => entry.setup(clientCtx(inputs)));`.
```
- **evidence:**
```
Repo-wide grep: the only occurrence of 'clientRoot' is its declaration at core.ts:153. hydrate.ts:183 invokes setup() with no surrounding runInInjector/clientRoot call.
```
- **independent verification:**
```
Verified by reading the cited code and grepping the whole repo (ui/ + packages/). clientRoot() at ui/.sprig/core.ts:153-156 memoizes a per-document client Injector on globalThis.__sprig_root, but a repo-wide grep for "clientRoot" returns only that single declaration — zero call sites. The client hydration path hydrateIsland (ui/.sprig/compiler/hydrate.ts:176-198) invokes entry.setup(clientCtx(inputs)) directly at line 183 with no surrounding runInInjector()/clientRoot(). The module-level `current` injector (core.ts:158) is therefore never assigned on the client; runInInjector is only ever called server-side in bootstrap() (core.ts:350). Consequently inject() on the client always hits the guard at core.ts:162-164 and throws "inject() must be called synchronously within setup()...", and the scope==="client" branch of the scope guard (core.ts:129) is unreachable in practice. All actual inject() consumers in the app are server-side (resolve.ts files and services that inject(Backend)). This matches the documented design intent ("The client root injector — one per document", core.ts:152; inject's error message explicitly naming setup(); the existence of the "client" Side and scope branch), so it is a genuine missing-wiring defect, not working-as-designed. Severity is correctly low: the broken capability is currently latent — the two island setups (counter, star-rating logic.ts) use only signal(), none call inject(), and no service is registered with scope:"client" or scope:"both" that an island consumes — so nothing in the present codebase actually triggers the throw. It is a real but dormant gap that would break the advertised client-side DI feature the moment any island setup calls inject().
```

### 59. Injector cache uses `existing !== undefined`, so any provider/service whose value is `undefined` is re-instantiated on every inject() (broken singleton contract)
- **severity:** low  ·  **category:** logic
- **area:** DI + in-process Backend (ui/.sprig/core.ts, ui/src/services)
- **location:** `ui/.sprig/core.ts:126-149 (#instantiate uses `if (existing !== undefined) return existing`; #findInstance returns `undefined` both for "absent" and "cached as undefined")`
- **expected:** factory invoked exactly once; subsequent inject() calls return the cached value (DI caches one instance per injector node).
- **actual:** factory invoked 3 times — output: `Repro1 factory invoked count (expect 1 if cached): 3`. The cache is bypassed because the cached `undefined` is indistinguishable from "not cached".
- **repro:**
```
Run from repo root. Because core.ts imports `@preact/signals-core` via the ui/ import map, execute inside ui/:

  cd ui && cat > repro_di.ts <<'EOF'
  import { token, Injector, runInInjector, inject } from "./.sprig/core.ts";
  let count = 0;
  const Maybe = token<undefined>("Maybe", { factory: () => { count++; return undefined; } });
  const r = new Injector("server", "root");
  runInInjector(r, () => { inject(Maybe); inject(Maybe); inject(Maybe); });
  console.log("Repro1 factory invoked count (expect 1 if cached):", count);
  let count2 = 0;
  const Real = token<number>("Real", { factory: () => { count2++; return 42; } });
  const r2 = new Injector("server", "root");
  runInInjector(r2, () => { inject(Real); inject(Real); inject(Real); });
  console.log("Repro2 (number value) factory invoked count (expect 1):", count2);
  EOF
  deno run --allow-read repro_di.ts; rm repro_di.ts

Output:
  Repro1 factory invoked count (expect 1 if cached): 3
  Repro2 (number value) factory invoked count (expect 1): 1

Expected: both counts = 1 (one instance cached per injector node).
Actual: undefined-valued provider re-runs its factory every inject() (count=3); number-valued provider caches correctly (count2=1).

Fix: in ui/.sprig/core.ts #instantiate, replace the value-based guard with a presence check. Have #findInstance report presence (e.g. return a {hit, value} or use a has-walk up the parent chain) and branch on that instead of `existing !== undefined`.
```
- **evidence:**
```
Reproduced live: `Repro1 factory invoked count (expect 1 if cached): 3`. Root cause: #instantiate's `existing !== undefined` guard (core.ts:127) and #findInstance returning bare `undefined` (core.ts:145-149). Should use `#instances.has(key)` to distinguish presence from an undefined value.
```
- **independent verification:**
```
Confirmed by reading ui/.sprig/core.ts and reproducing live. #instantiate (line 126-128) does `const existing = this.#findInstance(key); if (existing !== undefined) return existing`. #findInstance (lines 145-149) returns a bare `unknown` value and returns `undefined` for BOTH "key absent" and "key cached with value undefined" — the two cases are indistinguishable to the caller. So when a factory returns `undefined`, the stored cache entry can never be detected by the `!== undefined` guard, and reg.factory() runs again on every inject(). This violates the documented one-instance-per-injector-node caching contract that the rest of DI (Injectable classes, the keep Backend provide/resolve path) relies on. The correct check is presence-based (`#instances.has(key)` walked up the parent chain), which #findInstance already uses internally but #instantiate discards.

Live reproduction (run inside ui/ project for import-map resolution):
  Repro1 factory invoked count (expect 1 if cached): 3
  Repro2 (number value) factory invoked count (expect 1): 1
A token whose factory returns `undefined` runs its factory 3 times for 3 inject() calls; a token returning a number caches correctly at 1. This is a genuine logic defect, not intended behavior — there is no reason an undefined-valued provider should opt out of caching.

Severity is low (and accurately so): it is latent. Every real provider in the repo is an @Injectable() class whose factory is `() => new target()` (always returns a truthy object), and the two value services (UserService, BoardService) are classes; there are no `token<...>` value providers that return undefined anywhere in ui/src. So nothing currently triggers it. Even when triggered, the returned value is still correct (undefined); only the singleton/run-once guarantee breaks (factory side effects re-run, distinct instances if the factory built one). Impact is therefore a correctness footgun for future undefined-returning providers, not an active failure.
```

### 60. injector.provide(token, undefined) is silently ignored; per-request binding of an undefined value falls through to the REGISTRY factory
- **severity:** low  ·  **category:** logic
- **area:** DI + in-process Backend (ui/.sprig/core.ts, ui/src/services)
- **location:** `ui/.sprig/core.ts:110-112 (provide sets #instances) and core.ts:126-149 (#instantiate ignores a stored `undefined` and runs reg.factory instead)`
- **expected:** inject(Cfg) returns the explicitly provided value (undefined); the REGISTRY factory must NOT run because the token was bound for this request.
- **actual:** inject(Cfg) returns "FALLBACK" and the factory runs — output: `Repro2 got (expect undefined, the provided value): "FALLBACK" | factory ran: 1`. A deliberately-bound undefined request value is discarded. (Same root cause as the cache bug; affects the per-request `provide` path used to bind Backend.)
- **repro:**
```
From repo root, create a script importing the DI primitives and run with deno:

import { token, Injector, runInInjector, inject } from "./ui/.sprig/core.ts";
let count2 = 0;
const Cfg = token<string | undefined>("Cfg", { factory: () => { count2++; return "FALLBACK"; } });
const r2 = new Injector("server", "root");
r2.provide(Cfg, undefined as any);
const got = runInInjector(r2, () => inject(Cfg));
console.log(`got=${JSON.stringify(got)} factoryRan=${count2}`);

Observed output: got="FALLBACK" factoryRan=1

Expected: got=undefined factoryRan=0 (the explicitly provided value wins; the registry factory must not run because the token was bound for this injector). Root cause: core.ts:128 `if (existing !== undefined) return existing` treats the stored undefined as absent.
```
- **evidence:**
```
Reproduced live: `Repro2 got (expect undefined, the provided value): "FALLBACK" | factory ran: 1`. provide() stores into #instances (core.ts:111) but #instantiate's `existing !== undefined` check (core.ts:127) treats the stored undefined as absent and calls reg.factory().
```
- **independent verification:**
```
Confirmed by reading the cited code and reproducing live. core.ts:110-112 `provide()` stores the bound value via `this.#instances.set(token.key, value)`, so a deliberately-bound `undefined` IS present in the map. `#findInstance` (core.ts:145-149) correctly distinguishes presence using `this.#instances.has(key)` and returns the stored `undefined`. But `#instantiate` (core.ts:127-128) collapses the result with `const existing = this.#findInstance(key); if (existing !== undefined) return existing` — it cannot tell "absent" from "explicitly undefined", so it treats a stored `undefined` as a miss and runs `reg.factory()` instead. This is a genuine logic defect in the public DI API (provide/resolve): a per-request binding of an undefined/nullable value is discarded and the registry factory wins. The fix is to not use `undefined` as the miss sentinel (e.g. have #findInstance signal presence, or check `#instances.has(key)` for the local node). Severity is correctly low: it is latent, not currently reachable through the one in-tree caller. The only real `provide` call site is bootstrap() core.ts:345 `if (env?.backend) root.provide(Backend, env.backend)`, which is guarded so Backend is only ever bound to a truthy BackendClient object — never undefined — meaning the claim's specific framing ("affects the per-request provide path used to bind Backend") overstates the impact for the Backend case. But the underlying DI primitive defect is real and would affect any future code binding a nullable value per request. Not working-as-designed: provide() documents binding "a concrete per-request value" and there is no documented prohibition on undefined; the swallowing is an accidental sentinel collision.
```

### 61. Injector.child() is dead code — the route/component injector hierarchy documented in core.ts never exists at runtime
- **severity:** low  ·  **category:** logic
- **area:** DI + in-process Backend (ui/.sprig/core.ts, ui/src/services)
- **location:** `ui/.sprig/core.ts:122-124 (child()), 344 (only request injector is a flat new Injector("server","root")), 350 (runInInjector(root,...))`
- **expected:** Per the Injector docstring ('An injector node in the root -> route -> component hierarchy') and the `kind: "route"|"component"` API, route/component-scoped services should resolve on a child injector so they can be re-scoped per route/component.
- **actual:** child() is never invoked. All services resolve on the single request-root injector. The entire route/component scoping tier is non-functional. Any service intended to be route- or component-scoped silently becomes request-root-scoped (shared across the whole page render).
- **repro:**
```
1. Read /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/core.ts.\n2. Note Injector.child() at lines 122-124 and the hierarchy docstring at line 93 ("root → route → component"), plus clientRoot() at 153.\n3. Run: grep -rn "\\.child(" ui/ packages/  → two hits: core.ts:123 (child's own `new Injector`) and serialize.ts:30, where serialize.ts:30 is `const child = node.child(i)` on a tree-sitter Node (confirmed via sed -n '25,35p' ui/.sprig/compiler/serialize.ts) — i.e. no Injector.child() caller anywhere.\n4. Run: grep -rn "clientRoot" ui/ packages/  → only the definition at core.ts:153, no caller.\n5. Run: grep -rn "new Injector\\|runInInjector" ui/ packages/  → the only per-request injector is `new Injector("server","root")` at core.ts:344, and runInInjector is only ever passed that flat `root` (core.ts:350).\nConclusion: the route/component injector tier (child(), clientRoot()) is never invoked; all per-request DI resolves on the single flat request-root injector.
```
- **evidence:**
```
core.ts:344 `const root = new Injector("server", "root");` is the only per-request injector; core.ts:350 resolves resolve() against it; grep shows no `.child(` callers anywhere in ui/ or packages/. clientRoot() (core.ts:153) is likewise never activated (already reported).
```
- **independent verification:**
```
Verified by reading ui/.sprig/core.ts and grepping the whole tree. Injector.child() (core.ts:122-124) has zero callers: the only `.child(` match besides its definition is serialize.ts:30, which is a tree-sitter `Node.child(i)` call on a syntax-tree node — unrelated to the Injector class. bootstrap.fetch (core.ts:344) constructs exactly one flat `new Injector("server","root")` per request, binds Backend to it (345), and resolves resolve() against it via runInInjector(root, …) (350). No route/component child injector is ever created, so the hierarchy advertised by the Injector docstring (line 93) and the `kind: "route"|"component"` constructor arg + child() API does not exist at runtime. clientRoot() (153) is also never called. The claim is factually correct.\n\nSeverity is correctly low (borderline info, not a behavior bug): (1) the spine is explicitly unfinished — renderDocument (364) is labeled "Placeholder SSR" and the AppConfig comment (322-325) defers the real template compiler to a "next milestone"; (2) no current service requests route/component scope — both ui/src/services/board/mod.ts and user/mod.ts use bare @Injectable() (default scope "both", no providedIn), so they resolve fine on the request root and nothing misbehaves on any reachable path today. The defect is latent/structural (incomplete scaffolding + unused API), not an active wrong-behavior bug. The claim's "Actual" wording overstates impact slightly by implying a route/component-scoped service would silently misbehave — true in principle, but no such service exists yet, and the scoping tier was never wired in the first place rather than being broken.
```

### 62. BoardService/UserService are declared scope "both" but can never be constructed client-side — they unconditionally inject the server-only Backend in a field initializer
- **severity:** low  ·  **category:** logic
- **area:** DI + in-process Backend (ui/.sprig/core.ts, ui/src/services)
- **location:** `ui/src/services/board/mod.ts:5-6 (@Injectable() -> scope "both"; `#be = inject(Backend)` field init); ui/src/services/user/mod.ts:4-5; Backend scope guard at ui/.sprig/core.ts:129-134; Backend token scope "server" at core.ts:203-204`
- **expected:** A service declared scope "both" should be constructible on both server and client (the declared contract), or it should be declared scope "server".
- **actual:** Constructing BoardService/UserService on the client always throws `Cannot inject Backend (scope="server") on the client`. The "both" scope is unreachable; the services are effectively server-only, contradicting their own decorator. The mislabeled scope is a latent trap: any future scope:"both"/"client" island code that injects BoardService will crash at construction instead of being rejected at declaration.
- **repro:**
```
In ui/, run a script that imports the service and a client injector:

  import { Backend, backendClient, Injector } from "@sprig/core";
  import { BoardService } from "./src/services/board/mod.ts";

  // client injector (e.g. an island hydrating in the browser)
  new Injector("client", "root").resolve(BoardService);
  // => throws: Cannot inject sprig:Backend (scope="server") on the client...

  // server injector with Backend bound works:
  const s = new Injector("server", "root");
  s.provide(Backend, backendClient((() => {}) as unknown as typeof fetch));
  s.resolve(BoardService); // => OK, returns BoardService

Run: deno run -A repro_test.ts (from ui/, using its import map).
Observed: CLIENT THROWN: Cannot inject sprig:Backend (scope="server") on the client. ... ; SERVER RESULT: constructed BoardService OK. This proves the declared scope "both" is unreachable on the client.
```
- **evidence:**
```
board/mod.ts:1 imports Backend; :6 `#be = inject(Backend)` is a field initializer (runs in the constructor); @Injectable() at :5 gives scope "both" (core.ts:78). Backend token declared scope "server" at core.ts:203-204; the scope guard that throws is core.ts:129-134. Not currently HTTP-reachable because services are only injected from server resolve.ts, hence low severity.
```
- **independent verification:**
```
Verified by reading the cited code and by an empirical repro. `@Injectable()` with no config defaults the registration scope to "both" (core.ts:76, `config.scope ?? "both"`), so BoardService (ui/src/services/board/mod.ts:5-6) and UserService (ui/src/services/user/mod.ts:4-5) pass the client-side scope guard at core.ts:129. But each has a field initializer `#be = inject(Backend)` (board/mod.ts:7, user/mod.ts:6) that runs inside `new target()` invoked by `reg.factory()` (core.ts:78,138). Backend is declared scope "server" (core.ts:203-204). On a client injector (this.side==="client"), instantiating Backend hits the guard at core.ts:129-134 — `"server" !== "both" && "server" !== "client"` — and throws. So the "both" scope on these services is unreachable; they are effectively server-only, contradicting their own decorator.

Empirical repro confirmed: resolving BoardService on `new Injector("client","root")` throws `Cannot inject sprig:Backend (scope="server") on the client...`, while on a server injector with Backend bound it constructs `BoardService` fine.

This is a genuine defect (a mislabeled scope / false contract and a latent trap), not a misunderstanding. It is correctly low severity because it is not currently reachable: all four call sites (ui/src/pages/{board,user,dashboard,issue}/resolve.ts) are server-side resolve functions run under a server injector via bootstrap/runInInjector; no island/client code injects these services today. The risk is forward-looking: any future scope "both"/"client" island that injects BoardService/UserService would crash at construction instead of being rejected at declaration. Correct fix: declare these `@Injectable({ scope: "server" })`.
```

### 63. HMR live template swap pushes a tree-sitter ERROR AST to all mounted islands (reparse never checks hasError)
- **severity:** low  ·  **category:** correctness
- **area:** Dev/HMR server (ui/.sprig/compiler/dev.ts + hmr.ts)
- **location:** `ui/.sprig/compiler/mod.ts:84-91 (reparse) and ui/.sprig/compiler/dev.ts:61-65 (template branch) → ui/.sprig/compiler/hmr.ts:24-26 → ui/.sprig/compiler/hydrate.ts:56-60 (hotTemplate/swap)`
- **expected:** A template that parses to an error AST should NOT be hot-swapped into running islands; reparse should report failure (or the dev server should detect hasError and surface an error overlay) so mounted state/markup is not clobbered by garbage.
- **actual:** reparse() returns true unconditionally as long as the file reads and the tree is non-null, so the error AST is serialized and pushed live. hotTemplate() (hydrate.ts:59) re-renders every mounted instance with renderNodes over the corrupt AST, producing broken DOM while the user is still mid-edit — the opposite of HMR's 'state-kept' contract.
- **repro:**
```
Runtime proof (run inside the ui workspace so web-tree-sitter + grammar.wasm resolve), file ui/.sprig/compiler/_repro.test.ts:

  import { parseTemplate } from "./parse.ts";
  import { Language, Parser } from "web-tree-sitter";
  Deno.test("HMR error-AST push repro", async () => {
    await Parser.init();
    const lang = await Language.load(await Deno.readFile(new URL("./grammar.wasm", import.meta.url)));
    const parser = new Parser(); parser.setLanguage(lang);
    const broken = `<div><button (click)="count.set(count() + 1)">{{ count() }</button>\n@if (foo {\n  <span>x</span>\n`;
    const tree = parser.parse(broken);
    console.log(tree === null, tree?.rootNode.hasError);          // false true
    let threw = false, node;
    try { node = await parseTemplate(broken); } catch { threw = true; }
    console.log(threw, (node as any)?.hasError);                  // false true
  });

Run: /opt/homebrew/bin/deno test -A --no-check ui/.sprig/compiler/_repro.test.ts
Output: [crux1] tree null? false | hasError: true | type: template ; [crux2] parseTemplate threw? false | node.hasError: true ; [crux3] reparse would return true -> true.

End-to-end (manual, SPRIG_DEV): mount a counter island, increment it, then save its template.html with a syntax error (e.g. `{{ count() }` missing a brace). The dev watcher (dev.ts) calls reparse() -> true, pushes {type:'template', template: <serialized error AST>}; hotTemplate() re-renders the live island over the malformed AST, producing broken DOM while you are still editing. Expected: reparse should detect tree.rootNode.hasError and either return false (suppress the push) or surface an error overlay, leaving the last-good markup intact.
```
- **evidence:**
```
mod.ts:84-91: reparse does `const tpl = await parseTemplate(...)` then `reg.set(...); return true;` with no hasError/validity check. parse.ts:26-31: parseTemplate only `throw`s when `!tree`, never on tree.rootNode.hasError. dev.ts:61-65 gates the live push solely on `if (await cfg.renderer.reparse(sel))`. (Distinct from the build-time 'malformed template ships' report — this is the live HMR push path clobbering already-mounted islands.)
```
- **independent verification:**
```
Verified by code reading plus a runtime repro using the real grammar.wasm and the real parseTemplate. The cited chain holds exactly: parse.ts:26-31 parseTemplate throws only when the tree is null, never on tree.rootNode.hasError; mod.ts:84-91 reparse() does `const tpl = await parseTemplate(...); reg.set(...); return true;` with no validity/hasError check, so it returns true as long as the path exists and the file reads; dev.ts:61-65 gates the live SSE push solely on `if (await cfg.renderer.reparse(sel))`, then sends {type:'template', template: astFor(sel)} where astFor serializes the stored (error) tree; hmr.ts:24-26 dispatches to hotTemplate(); hydrate.ts:56-60 hotTemplate() re-renders every live mounted island (i.swap -> tick bump -> renderNodes) over the malformed AST. render.ts is deliberately tolerant (default: return ""; lenient tagInfo) so the error tree renders to degraded DOM instead of throwing — it is never detected. Empirical proof: a broken template (unclosed interpolation + dangling @if) parses to a NON-null tree with hasError=true (rootNode.type still 'template'); the real parseTemplate returned that node WITHOUT throwing; thus reparse would hit `return true`. This is a genuine defect — a mid-edit broken template is pushed live and clobbers mounted islands' markup, contradicting HMR's state-kept/fresh contract; the dev server's existing {type:'error'} channel is only reached on thrown exceptions, never here. Severity is low: dev-only (SPRIG_DEV), transient (self-corrects on the next valid save), and the reactive scope/signals do survive — only the rendered DOM is momentarily garbage.
```

### 64. Partial-batch loss: a reparse throw (e.g. template.html renamed/deleted) skips every later template in the same debounced batch
- **severity:** low  ·  **category:** logic
- **area:** Dev/HMR server (ui/.sprig/compiler/dev.ts + hmr.ts) — dev-only (SPRIG_DEV); not mounted in the prod serveSprig handler, so unreachable on the live server (verified: /ui/_sprig/ast and /ui/_sprig/hmr both 404).
- **location:** `ui/.sprig/compiler/dev.ts:47 (.catch) and :61-66 (template loop) -> ui/.sprig/compiler/mod.ts:84-90 (reparse reads the file)`
- **expected:** A failure handling one changed file should be isolated (per-file try/catch) so the remaining files in the same batch still reparse / rebuild.
- **actual:** The whole `handleChange` is wrapped in a single batch-level `.catch` (dev.ts:47). The first throwing template aborts processing of all subsequent templates AND the css/reload branches (dev.ts:68-78) in that batch, silently dropping their updates until the next unrelated save.
- **repro:**
```
Dev only (SPRIG_DEV / `sprig dev` via packages/keep/dev-run.ts).

Minimal verification (run with `deno run -A`):
  - handleChange-equivalent loop (dev.ts:61-66) + single batch-level .catch (dev.ts:47).
  - reparse("A") -> Promise.reject (models mod.ts:87 Deno.readTextFile reject on a removed file); reparse("B") -> resolve(true).
  - call handleChange(["A/template.html","B/template.html","x/styles.css"]).catch(...).
  Result: {"applied":[],"cssRebuilt":false,"sentError":true} — B and css are dropped, only one error is sent.

Real-world trigger: in one 60ms debounce window, save template.html A and B (or A + a styles.css) where A's file is renamed/deleted (atomic save, git checkout/stash, rename) between the Deno.watchFs event and the timer firing. The loop processes A first; reparse(A) rejects at mod.ts:87; the throw escapes the for-loop; dev.ts:47 sends one {type:"error"} and B + css + reload updates are silently skipped until the next unrelated save.

Relevant files: /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/dev.ts (lines 47, 61-78) and /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/mod.ts (lines 84-90, throw at 87).
```
- **evidence:**
```
dev.ts:61-66 loops `for (const sel of templates) { if (await cfg.renderer.reparse(sel)) ... }` with no inner try/catch; mod.ts:87 `await Deno.readTextFile(path)` can reject; dev.ts:47 `.catch((e) => send({ type: "error", message: String(e) }))` is the only handler.
```
- **independent verification:**
```
Verified against the cited code. dev.ts:61-66 loops `for (const sel of templates) { if (await cfg.renderer.reparse(sel)) ... }` with NO inner try/catch. mod.ts:84-90 `reparse` does `await parseTemplate(await Deno.readTextFile(path))` at line 87 — `Deno.readTextFile` rejects if the file was deleted/renamed (the rename happening between the Deno.watchFs event and the 60ms setTimeout firing is a real race; atomic-save-via-rename editors and git ops routinely do this). When reparse rejects, the rejection propagates out of the for-loop because nothing catches it inside handleChange; the only handler is the batch-level `.catch` at dev.ts:47, which sends a single {type:"error"} and abandons the rest of the batch. Therefore every template after the throwing one, plus the css branch (dev.ts:68-72) and reload branch (dev.ts:74-78), are silently skipped for that batch.

I reproduced it with a faithful standalone harness replicating handleChange's structure and the single batch-level .catch: batch ["A/template.html","B/template.html","x/styles.css"] where reparse("A") rejects yields {"applied":[],"cssRebuilt":false,"sentError":true} — B never reparsed, css never rebuilt, one error emitted. This exactly matches the claim.

Scope/severity: genuinely dev-only. createDevServer is invoked only by packages/keep/dev-run.ts (the `sprig dev` runner) and hydration.test.ts; it is not in any prod serveSprig path, so the live server is unaffected. The damage is transient — the dropped B/css/reload updates are re-applied on the next save — and there is no data loss or prod impact. Low severity is correct; not info, because it is a real reachable HMR correctness defect that silently drops in-flight updates and confuses the dev (the UI quietly fails to reflect a saved file until an unrelated later save). Fix is a per-file try/catch inside the loop (and ideally isolating the css/reload branches) so one failing file doesn't abort the batch.
```

### 65. reparse() unconditionally returns true and broadcasts a full template swap even when the file content is unchanged
- **severity:** low  ·  **category:** performance
- **area:** Dev/HMR server (ui/.sprig/compiler/dev.ts + hmr.ts) — dev-only (SPRIG_DEV); not mounted in the prod serveSprig handler, so unreachable on the live server (verified: /ui/_sprig/ast and /ui/_sprig/hmr both 404).
- **location:** `ui/.sprig/compiler/mod.ts:84-90 (reparse always returns true if path exists) consumed at ui/.sprig/compiler/dev.ts:62-65`
- **expected:** reparse should detect a no-op (unchanged source, or an unchanged serialized AST) and return false so no SSE push / re-render happens; only real edits should trigger a hot swap.
- **actual:** reparse always returns `true` whenever the selector's path exists (mod.ts:90 `return true;`), regardless of whether the new parse differs from the current one — so every save-with-no-change broadcasts a template message and forces a client-side re-render. Combined with the lack of a hasError check, it also returns true (and broadcasts) for a parse that produced an ERROR AST.
- **repro:**
```
Dev only (run the app under `sprig dev`, i.e. with SPRIG_DEV=1 via packages/keep/dev-run.ts, with at least one HMR client connected to <base>/_sprig/hmr). 1) Open a page that mounts component <sel> in the browser. 2) Re-save ui/src/.../<sel>/template.html WITHOUT changing its bytes (e.g. `touch` it, or save-no-edit in an editor). 3) Observe: the watcher event (kind !== access) fires; dev.ts calls reparse(<sel>) which re-reads + re-parses and returns true unconditionally (mod.ts:90); dev.ts:63 then send({type:'template', sel, template: astFor(sel)}); the console logs `[sprig dev] template ↻ <sel>`, and every mounted instance of <sel> re-serializes over the SSE wire and fully hot-swaps/re-renders (hydrate.ts hotTemplate -> swap -> tick) even though nothing changed. Expected: a no-op save (unchanged source / unchanged serialized AST) should make reparse return false so no SSE push and no re-render occurs. Bonus: introduce a syntax error into template.html — parseTemplate does not throw (tree-sitter yields an ERROR node, parse.ts:29 only guards null), so reparse still returns true and broadcasts the error AST instead of being suppressed by a hasError check.
```
- **evidence:**
```
mod.ts:84-90: `const tpl = await parseTemplate(...); const cur = reg.get(selector); if (cur) reg.set(selector, { ...cur, template: tpl }); return true;` — no diff check, no hasError check; dev.ts:62 gates the push solely on this always-true value.
```
- **independent verification:**
```
Verified against the cited source. ui/.sprig/compiler/mod.ts:84-90: reparse() does `const path = srcPath.get(selector); if (!path) return false; const tpl = await parseTemplate(await Deno.readTextFile(path)); const cur = reg.get(selector); if (cur) reg.set(selector, { ...cur, template: tpl }); return true;` — there is no comparison of new source/AST against the current one, so it returns true whenever the selector's path exists, regardless of whether anything changed. dev.ts:62-63 gates the SSE push solely on this always-true value: `if (await cfg.renderer.reparse(sel)) { send({ type: \"template\", sel, template: cfg.renderer.astFor(sel) }); }`. The watcher (dev.ts:40-49) fires for any ev.kind !== \"access\" (60ms debounce), so re-touching template.html with identical content still re-reads, re-parses, mutates the registry, and broadcasts a full serialized template to every HMR client, forcing a client-side hot swap. The error-AST sub-claim also holds: parse.ts:26-31 only throws when the parsed tree is null; tree-sitter represents a malformed template as an ERROR node, not a thrown error, so a broken edit still 'parses', is written into reg, and returns true -> broadcasts a bad AST with no hasError guard. Reachability is correctly scoped as dev-only: createDevServer is invoked only from packages/keep/dev-run.ts (and hydration.test.ts), never from the production serveSprig handler, and is gated by SPRIG_DEV (main.ts:26 passes dev: !!Deno.env.get('SPRIG_DEV')). So the prod server does not mount the watcher/HMR/AST routes. Genuine defect, but confined to the dev hot-reload path with only a redundant re-render / wasted SSE push as impact -> low severity is correct.
```

### 66. hotTemplate/live tracking grows unboundedly: `live` entries are never removed when an island detaches (soft-nav/HMR re-hydrate)
- **severity:** low  ·  **category:** resource-leak
- **area:** Dev/HMR server (ui/.sprig/compiler/dev.ts + hmr.ts) — dev-only (SPRIG_DEV); not mounted in the prod serveSprig handler, so unreachable on the live server (verified: /ui/_sprig/ast and /ui/_sprig/hmr both 404).
- **location:** `ui/.sprig/compiler/hydrate.ts:218-229 (live.push on every hydrate) and :56-60 (hotTemplate iterates live, only skips detached, never prunes)`
- **expected:** When an island element is removed from the document (outlet swap on soft-nav, or re-hydration), its `live` entry should be removed so the array stays bounded to currently-mounted instances.
- **actual:** `live.push(...)` (hydrate.ts:219) has no corresponding removal anywhere; hotTemplate (hydrate.ts:59) only *skips* `!document.contains(i.el)` entries but never deletes them, so `live` grows for the lifetime of the dev page and every template hot-swap does O(total-ever-mounted) work.
- **repro:**
```
Dev mode only (`sprig build --dev`, HMR client active so `enableHmr()` ran).

1. Build/serve an app in dev with the HMR client (hmr.ts `startHmr` → `enableHmr()` runs before `bootstrapIslands`).
2. Have at least one page whose `<sprig-outlet>` content contains a `<sprig-island>`.
3. Soft-navigate between pages (same-origin links under cfg.base) so `setupSoftNav`'s intercept handler runs `cur.innerHTML = next.innerHTML` (hydrate.ts:161) then `bootstrapIslands(cfg, cur)` (hydrate.ts:163). The old island DOM is discarded; new islands hydrate.
4. Each hydration of an island executes `live.push({...})` (hydrate.ts:219). The detached old island's `live` entry is never removed (no splice/filter exists).

Observe: After N navigations, `live.length` keeps growing without bound (inspect via the module's `live` array, or measure heap — detached island elements/scopes are retained). Trigger a template edit so the dev server sends a `template` HMR message → `hotTemplate` (hydrate.ts:59) loops over ALL N entries, calling `document.contains` on every dead node, doing O(total-ever-mounted) work while only the live ones swap.

Fix: in `swap`/on detach, remove the entry (e.g. `hotTemplate` should `live` filter out `!document.contains(i.el)` entries, or `hydrateIsland` should register a teardown that splices its entry when its element is removed).
```
- **evidence:**
```
hydrate.ts:48 `const live: LiveIsland[] = [];`; hydrate.ts:219 `live.push({ sel, el, swap(...) {...} });`; hydrate.ts:59 `for (const i of live) if (i.sel === sel && document.contains(i.el)) i.swap(template);` — no splice/filter of `live` exists in the file.
```
- **independent verification:**
```
Verified against ui/.sprig/compiler/hydrate.ts. The claim holds exactly:

- Line 48: `const live: LiveIsland[] = [];`
- Line 218-229: inside `hydrateIsland`, when `hmrEnabled && tick`, every hydration does `live.push({ sel, el, swap(...) })`. There is exactly one push site.
- Line 59: `hotTemplate` does `for (const i of live) if (i.sel === sel && document.contains(i.el)) i.swap(template);` — it only *skips* detached elements, never removes them.
- `grep` confirms there is NO `live.splice`/`filter`/`pop`/`shift`/reassignment anywhere in the file. The array is push-only.

Growth path is reachable in dev: `enableHmr()` is called by the dev HMR client (hmr.ts:20) before islands hydrate, so `hmrEnabled` is true. `setupSoftNav` (hydrate.ts:139-173) handles same-origin outlet navigation by `cur.innerHTML = next.innerHTML` (line 161), which DETACHES the old `<sprig-island>` elements inside the outlet, then calls `bootstrapIslands(cfg, cur)` to arm the new ones. The new islands hydrate (registerIsland → hydratePending → hydrateIsland) and each pushes a fresh `live` entry. The old entries (now `document.contains(el) === false`) are never removed. So each soft-navigation through an outlet containing N islands grows `live` by N permanently.

Consequences: (1) `live` is unbounded for the dev page's lifetime; (2) it retains strong references to detached DOM elements and their closed-over reactive scopes, preventing GC — a true memory leak; (3) every `hotTemplate()` (every template hot-swap during dev) iterates the entire array and runs `document.contains()` on every dead node → O(total-ever-mounted) work per edit.

This is a genuine defect, not intended behavior — the design comment at line 41 says tracking is for "currently mounted" instances ("a mounted island keeps the SAME reactive scope"), but detached instances are never untracked.

Severity is correctly LOW: the entire path is gated behind `hmrEnabled`, which is only set by the dev-only HMR client (hmr.ts), and the `/_sprig/hmr` + `/_sprig/ast` routes are owned by dev.ts (not the prod serveSprig handler). So this never affects production/shipped users — it's a slow dev-session memory/CPU leak only. Not critical, but a real resource leak.
```

### 67. /_sprig/ast/<sel> endpoint calls decodeURIComponent without try/catch — a malformed percent-escape (e.g. a lone `%`) throws URIError and crashes the request handler (500)
- **severity:** low  ·  **category:** crash
- **area:** Dev/HMR server (ui/.sprig/compiler/dev.ts, hmr.ts, hydrate.ts dev paths)
- **location:** `ui/.sprig/compiler/dev.ts:102-103`
- **expected:** Malformed selector input should yield a clean 4xx (e.g. 400/404), not an internal server error.
- **actual:** decodeURIComponent('%') throws URIError: URI malformed. The throw is uncaught inside the synchronous fetch handler, so Deno.serve responds 500 (and may log a stack), instead of a controlled 404/400.
- **repro:**
```
Dev-server white-box repro (the /_sprig mount exists only under the dev server). With the sprig dev server running, issue: `GET <base>/_sprig/ast/%` (a lone unterminated percent sign; `%zz` works too). The handler at ui/.sprig/compiler/dev.ts:103 calls `decodeURIComponent('%')`, which throws `URIError: URI malformed`; the throw is uncaught in the synchronous Deno.serve fetch handler, so the response is HTTP 500 "Internal Server Error" with the stack logged, instead of the intended 404 (line 106) or a 400. Confirmed via a faithful standalone reproduction served with Deno.serve: `/_sprig/ast/Foo` -> 200, `/_sprig/ast/%` -> 500, `/_sprig/ast/%zz` -> 500. Fix: wrap the decode (and/or the handler body) in try/catch and return a 400/404 on URIError.
```
- **evidence:**
```
dev.ts:102-103: `if (path.startsWith(astPrefix)) { const ast = cfg.renderer.astFor(decodeURIComponent(path.slice(astPrefix.length))); ...}` — no try/catch around decodeURIComponent, and the handler body is not wrapped. (Dev-only: the prod URL does not mount /_sprig, so this is a white-box defect, not curl-reproducible against the live server.)
```
- **independent verification:**
```
Verified against the cited code at /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/dev.ts:102-103. The synchronous fetch handler runs `decodeURIComponent(path.slice(astPrefix.length))` with no try/catch and the handler body is not wrapped. I confirmed two facts independently: (1) `decodeURIComponent('%')` and `decodeURIComponent('%zz')` both throw `URIError: URI malformed` (ran in node). (2) When a synchronous Deno.serve fetch handler throws, Deno.serve responds 500 "Internal Server Error" and logs the stack. I built a faithful minimal reproduction mirroring dev.ts:102-103 served via Deno.serve and observed: /_sprig/ast/Foo -> 200, /_sprig/ast/% -> 500 (uncaught URIError logged), /_sprig/ast/%zz -> 500. A non-existent valid selector would instead return the intended 404 (line 106), so the malformed-input path diverges from intended behavior — it should be a clean 4xx, not a 500 with a logged stack. This is a real defect, not working-as-designed. Severity is correctly low: the endpoint is dev-only (the /_sprig mount is not present in production per the dev.ts header comment and the report), it is reachable only via a hand-crafted malformed URL, and it produces a single-request 500 with log noise rather than crashing the server process. No data loss or security impact.
```

### 68. Outlet swap leaks the IntersectionObserver (and pending idle timers) of armed-but-not-yet-triggered islands inside the old outlet — they are never disconnected
- **severity:** low  ·  **category:** resource-leak
- **area:** Soft navigation (setupSoftNav / outlet swap / island re-hydration in ui/.sprig/compiler/hydrate.ts)
- **location:** `ui/.sprig/compiler/hydrate.ts:161-165 (swap: `cur.innerHTML = next.innerHTML`) vs scheduleLoad ui/.sprig/compiler/hydrate.ts:95-106 (IntersectionObserver created at :96-102, idle timer at :103-106)`
- **expected:** On outlet swap, observers / pending idle callbacks / listeners armed for islands inside the outlet should be torn down (the IntersectionObserver disconnected, idle timers cleared) before the subtree is discarded, so each navigation does not accumulate live observers and stray pending work.
- **actual:** swap() replaces innerHTML wholesale and never disconnects the IntersectionObservers (or clears the requestIdleCallback/setTimeout from the idle trigger) created in scheduleLoad. Every soft-navigation that swaps out an outlet containing an un-triggered visible/idle island leaks one IntersectionObserver (retaining its `go`→loadIsland closure) plus, for idle islands, a setTimeout/ric that later fires loadIsland for a now-detached island and performs a wasted chunk import. This is distinct from the already-reported per-island reactive-effect leak and the dev-only `live` array growth.
- **repro:**
```
Code-level reproduction (no running server needed; logic is deterministic):

1. ui/src/pages/issue/components/star-rating/logic.ts sets `trigger: "visible"`; ui/src/pages/issue/template.html puts `<star-rating>` inside the issue page, which renders inside `<router-outlet>`/`<sprig-outlet>` (ui/.sprig/compiler/render.ts:125).

2. On full load of an issue page (e.g. /ui/issues/SPR-101), bootstrapIslands -> scheduleLoad runs the `trigger === "visible"` branch (hydrate.ts:95-102): `new IntersectionObserver(cb); io.observe(starRatingEl);`. `cb` only calls `obs.disconnect()` when isIntersecting (lines 97-99).

3. WITHOUT scrolling the rating into view, click an in-app link (e.g. `← back to board`). setupSoftNav's navigate handler intercepts and runs swap() (hydrate.ts:161-165): `cur.innerHTML = next.innerHTML`. The old star-rating element is detached.

4. Because it never intersected, obs.disconnect() was never called. The IntersectionObserver stays live (browser keeps observers with active observations alive to deliver callbacks), retaining its `go`->loadIsland closure. grep confirms hydrate.ts has exactly one disconnect() (line 98) and no clearTimeout/cancelIdleCallback/observer registry; core.ts/main.ts/client-entry.gen.ts have none either.

Live-observation confirmation (Playwright, if a server is up at :8200): navigate to /ui/issues/SPR-101; wrap window.IntersectionObserver to count construct/disconnect; do NOT scroll; soft-navigate to /ui/board; assert constructed-minus-disconnected count increased by 1 and stays leaked. Repeat the issue<->board cycle N times -> leaked-observer count grows ~linearly with N.
```
- **evidence:**
```
ui/.sprig/compiler/hydrate.ts:96-102 — `const io = new IntersectionObserver(...); io.observe(el);` with `obs.disconnect()` only reachable inside the intersect branch (:97-99). ui/.sprig/compiler/hydrate.ts:103-106 — idle path schedules `ric(go)` or `setTimeout(go,200)` with no cancellation handle. ui/.sprig/compiler/hydrate.ts:162 — swap discards the subtree via `cur.innerHTML = next.innerHTML` with no observer/timer teardown anywhere in setupSoftNav. Live confirmation that an in-outlet visible island exists: GET /ui/issues/SPR-101 contains `<sprig-island ... data-sel="star-rating" data-trigger="visible">` nested inside <sprig-outlet>, while the load-triggered `counter` island sits OUTSIDE the outlet in the header.
```
- **independent verification:**
```
Verified against the cited code in ui/.sprig/compiler/hydrate.ts.

Mechanism confirmed:
- scheduleLoad (lines 88-118): for a `visible` island it does `const io = new IntersectionObserver(...); io.observe(el);` (lines 96-102). The ONLY call to `obs.disconnect()` is inside the observer callback, gated on `entries.some(e => e.isIntersecting)` (lines 97-99). If the element never intersects, disconnect never runs.
- swap() in setupSoftNav (lines 161-165) does `cur.innerHTML = next.innerHTML` (line 162), detaching the old subtree, then `bootstrapIslands(cfg, cur)` which only ARMS new islands. There is no teardown of the old observers/timers.
- I grep'd the whole file: the sole `disconnect()` is line 98. There is no clearTimeout, no cancelIdleCallback, no observer registry/WeakMap, and no teardown in core.ts, main.ts, or client-entry.gen.ts. So nothing ever disconnects an armed-but-un-triggered observer when its outlet subtree is swapped out.

Why it actually leaks (not just a detached element): an IntersectionObserver with an active observation is kept alive by the browser specifically so it can deliver callbacks, even with no JS reference to `io` (which is a local const in scheduleLoad). It retains its callback closure (go -> loadIsland, capturing sel + cfg). Since the element is detached but never intersects, the observer stays live and registered for the life of the page. Each qualifying soft-navigation accumulates one more permanently-live observer — an unbounded (if slow) leak.

App-level reachability confirmed:
- ui/src/pages/issue/components/star-rating/logic.ts declares `trigger: "visible"`.
- ui/src/pages/issue/template.html places `<star-rating>` inside the page body, and the page is rendered into `<router-outlet>` which render.ts:125 emits as `<sprig-outlet>` (the swap target). The persistent counter island lives in the shell OUTSIDE the outlet (shell/template.html). So star-rating is genuinely an in-outlet visible island that gets swapped out on soft-nav.
- The `← back to board` link inside the same page (and any in-app link) triggers the navigate interceptor -> swap().

Scoping the claim: the IntersectionObserver half is fully real and reproducible with the existing star-rating island. The idle-timer / "wasted chunk import" half is theoretically valid (the idle path at lines 103-106 stores no cancellation handle) but is NOT reproducible in this app: grep shows the only non-load trigger declared anywhere is star-rating's `visible`. No idle-triggered island sits inside an outlet, so no stray setTimeout/requestIdleCallback fires loadIsland for a detached island here. That portion is latent, not currently triggerable.

Severity downgraded from medium to low: each leaked unit is a single lightweight IntersectionObserver plus a tiny closure; the trigger is narrow (navigate away before scrolling the rating into view — once it's seen, line 98 disconnects it); and the practical per-session count is small. It is a genuine, unbounded-over-time but very low-cost leak.
```

### 69. Soft-nav swap commits the fetched outlet on ANY HTTP status and content-type — no response.ok / Content-Type guard; full-nav fallback is keyed only on outlet presence
- **severity:** low  ·  **category:** protocol
- **area:** Soft navigation (setupSoftNav / sprig-outlet swap) in ui/.sprig/compiler/hydrate.ts
- **location:** `ui/.sprig/compiler/hydrate.ts:151-169 (intercept handler: fetch().then(r=>r.text()) at :152, no r.ok / r.status / content-type check; only fallback condition is `!next || !cur` at :157)`
- **expected:** The swap should validate the response before committing: on non-2xx status, on a non-text/html content-type, or on a redirected/opaque response, fall back to a full navigation (location.assign) rather than DOM-parsing an arbitrary body and deciding solely on outlet presence.
- **actual:** Status code and Content-Type are completely ignored. The full-nav fallback fires only when the parsed body lacks a `<sprig-outlet>`; an error response (or any HTML) containing an outlet is committed as a successful soft navigation. Reachability of an error-page-with-outlet is currently latent on this server (the only non-200 /ui responses are plain-text 404s with no outlet), so this is an error-handling/robustness gap rather than a presently-observable mis-render.
- **repro:**
```
White-box (authoritative): Read ui/.sprig/compiler/hydrate.ts:151-169.
- Line 152: response read as `.then((r) => r.text())` with no inspection of r.ok / r.status / r.redirected / Content-Type.
- Lines 155-160: `next = doc.querySelector("sprig-outlet")`, `cur = document.querySelector("sprig-outlet")`, and the sole fallback is `if (!next || !cur) location.assign(...)`. Outlet presence is the only success criterion.

Confirming current latency:
- ui/.sprig/core.ts:338,341 — 404 = plain-text "Not Found" (no outlet).
- ui/.sprig/core.ts:350,354 + packages/keep/mod.ts:100 — no try/catch around resolve/render or app.fetch; a thrown error becomes Deno's default plain-text 500 (no outlet).
- grep -rn "Response.redirect|Location|30[1-8]" over packages/, ui/.sprig/, backend/src/ → no redirect responses exist.

Trigger that WOULD mis-render (not currently reachable): make any /ui/* request resolve to an HTML body containing `<sprig-outlet>` while returning a non-2xx status or a redirect — e.g. an SSR error page rendered through the shared shell, or an auth redirect to a login page that is itself a full sprig page. The soft-nav handler would DOMParse it, find the outlet, swap it in, and commit the original URL to history as a successful navigation, with no error surfaced and no full-nav fallback.

Fix: before swapping, validate `r.ok` (2xx), `!r.redirected` (or compare r.url to destination), and that `r.headers.get("content-type")` starts with "text/html"; otherwise location.assign(destination) for a full navigation.
```
- **evidence:**
```
ui/.sprig/compiler/hydrate.ts:152 `const html = await fetch(e.destination.url,{signal:e.signal}).then((r)=>r.text());` (no r.ok); :155-160 fallback decided solely by `if (!next || !cur)`. Server probe: `/ui/nonexistent` -> `404 text/plain` (no outlet); `/ui/board`,`/ui/issues/SPR-101` -> `200 text/html` with 1 outlet each.
```
- **independent verification:**
```
White-box verification confirms every load-bearing claim against the cited source.

ui/.sprig/compiler/hydrate.ts:152 — `const html = await fetch(e.destination.url, { signal: e.signal }).then((r) => r.text());` The Response object `r` is consumed straight to text. There is no read of `r.ok`, `r.status`, `r.redirected`, `r.type`, or `r.headers.get("content-type")`.

ui/.sprig/compiler/hydrate.ts:154-160 — the body is DOMParsed as text/html and the ONLY decision is `if (!next || !cur) { location.assign(...) }`, i.e. fall back to a full navigation solely when the parsed document lacks a `<sprig-outlet>` (or the live document does). Any fetched body that happens to contain a `<sprig-outlet>` is swapped in (cur.innerHTML = next.innerHTML) and the navigation is committed as a successful soft-nav, regardless of HTTP status, content-type, or whether fetch silently followed a redirect to a different URL than the one being committed to history.

This is a genuine robustness defect: the handler trusts an arbitrary fetched body and decides success purely by structure, not protocol. A non-2xx HTML error page, a redirected login page, or any HTML-with-outlet would be committed as a successful navigation with the original destination URL in history and no error surfaced.

Severity downgraded to low (from claimed medium) because the defect is currently latent / not reachable as a mis-render on this server, which I verified end to end:
- 404s: ui/.sprig/core.ts:338 and :341 return `new Response("Not Found", { status: 404 })` — plain text, no outlet → caught by the null-outlet fallback today.
- 5xx: bootstrap().fetch (core.ts:334-357) has no try/catch around mod.resolve (line 350) or config.render (line 354); a throw propagates through serveSprig (packages/keep/mod.ts:100, also no try/catch) to Deno.serve, yielding its default plain-text 500 — again no outlet.
- Redirects: grep across packages/, ui/.sprig/, backend/src/ found zero `Response.redirect` / Location / 3xx producers, so no redirect-to-outlet-page path exists.
The report itself accurately concedes this latency ("error-handling/robustness gap rather than a presently-observable mis-render"), so I am affirming a real code defect with corrected (lower) severity, not a present user-visible bug.
```

### 70. Query-string-only and same-URL same-path navigations are intercepted and force a full outlet swap + scrollTo(0,0), discarding all in-outlet island state
- **severity:** low  ·  **category:** logic
- **area:** Soft navigation (setupSoftNav / sprig-outlet swap) in ui/.sprig/compiler/hydrate.ts
- **location:** `ui/.sprig/compiler/hydrate.ts:144-165 (navigate filter at :145 excludes only hashChange/downloadRequest/formData; query-only or identical-path navigations pass and reach the swap at :161-165)`
- **expected:** A navigation to the current URL (no path/query/hash change) should be a no-op for the outlet (preserve in-outlet island state and scroll); query-only changes should not unconditionally tear down and re-create the entire outlet subtree and jump scroll to top.
- **actual:** Any same-origin, in-base navigation that is not a hashChange/download/form-POST — including re-clicking the active link or a query-only change — fetches the page, wipes `sprig-outlet.innerHTML`, re-arms islands from scratch (losing their signal state), and scrolls to top. The in-outlet `star-rating` island's state is destroyed on every such navigation.
- **repro:**
```
White-box (read ui/.sprig/compiler/hydrate.ts:144-172):\n1. The navigate filter at line 145 is `if (!e.canIntercept || e.hashChange || e.downloadRequest || e.formData) return;` — it excludes hashChange/download/form-POST only.\n2. It has no check that e.destination.url === location.href (same-URL no-op) and no query-only check. Origin/base guards at lines 147-148 pass for any same-origin in-base URL.\n3. Therefore: (a) re-clicking the currently-active link (Navigation API navigationType \"replace\", not a hashChange) and (b) a query-string-only change such as /ui/issues/SPR-101?tab=x -> ?tab=y both pass the filter and reach e.intercept (line 149).\n4. The handler fetches the destination and runs `cur.innerHTML = next.innerHTML;` (line 162) UNCONDITIONALLY, wiping every node inside <sprig-outlet>, then bootstrapIslands re-arms islands from scratch (line 163) and `globalThis.scrollTo(0, 0)` (line 164) jumps scroll to top.\n5. The outlet contains stateful islands: render.ts:125 wraps page content (opts.outlet) in <sprig-outlet>, and ui/src/pages/issue/template.html:24-25 places <star-rating> there; star-rating/logic.ts holds a `rating` signal with trigger:\"visible\". So on /ui/issues/SPR-101, re-clicking the active link or a query-only nav destroys the star-rating instance, loses its rating signal value, and scrolls to top.\n\nLive-repro sketch (Navigation-API browser): load /ui/issues/SPR-101, scroll the star-rating island into view, set a rating, then click the already-active issue link (or change only the query string). Observe the rating reset to 0 and the page scroll jump to top — instead of a no-op.
```
- **evidence:**
```
ui/.sprig/compiler/hydrate.ts:145 filter omits any 'destination equals current / differs only by search' check; :162 `cur.innerHTML = next.innerHTML;` unconditionally replaces the subtree; :164 `globalThis.scrollTo(0, 0);`. In-outlet island confirmed at /ui/issues/SPR-101 (`<sprig-island ... data-sel="star-rating" data-trigger="visible">` inside `<sprig-outlet>`).
```
- **independent verification:**
```
Verified by reading the cited code. In ui/.sprig/compiler/hydrate.ts, setupSoftNav's navigate listener (line 144) filters only `if (!e.canIntercept || e.hashChange || e.downloadRequest || e.formData) return;` (line 145). It performs NO comparison of e.destination.url against location.href (no same-URL no-op) and NO query-only check. The origin/base guards at lines 147-148 (`url.origin !== location.origin` and `url.pathname === cfg.base || startsWith(cfg.base + "/")`) pass for any same-origin in-base URL. Per the Navigation API, re-clicking the currently-active link dispatches a `navigate` event with navigationType "replace" (NOT hashChange), and a query-string-only change (e.g. ?tab=x -> ?tab=y) likewise dispatches a non-hashChange navigate event; both have canIntercept true and are not downloadRequest/formData, so both pass the filter and are intercepted (line 149).\n\nThe handler then fetches the destination (line 152), parses it, and runs `cur.innerHTML = next.innerHTML;` (line 162) UNCONDITIONALLY — destroying every DOM node (and thus every hydrated island instance and its signal state) inside <sprig-outlet>. It then calls bootstrapIslands to re-arm from scratch (line 163) and `globalThis.scrollTo(0, 0)` (line 164), jumping scroll to top regardless of whether the URL/path actually changed.\n\nI confirmed the star-rating island lives inside the outlet: ui/.sprig/compiler/render.ts:125 wraps the page's projected content (opts.outlet) in <sprig-outlet>, and the issue page template (ui/src/pages/issue/template.html:24-25) contains <star-rating></star-rating>. star-rating/logic.ts holds a `rating` signal (the user's selection) and uses trigger:\"visible\", so after a wipe the user must scroll it back into view and re-select. Because scroll:\"manual\" is set and scrollTo(0,0) is called every swap, the active-link / query-only navigation also force-scrolls to top.\n\nExpected behavior (same-URL = outlet no-op preserving state/scroll; query-only = no unconditional teardown + no scroll jump) is reasonable and not met. This is a genuine logic defect, not intended behavior.\n\nSeverity low is correct: it is a UX/state-preservation degradation on a narrow trigger (re-clicking the active link or query-only nav), only in Navigation-API-capable browsers, with currently limited in-outlet island state. Not data loss, not a crash, not security.\n\nCaveat on method: this is white-box verification by code inspection; the defect is a deterministic missing-guard provable from the code path plus documented Navigation API semantics. I did not spin up the live server/headless browser, but no dynamic state is needed to establish the missing same-URL/query-only guard and the unconditional innerHTML swap + scrollTo.
```

### 71. Soft-nav to a new path containing a #fragment ignores the fragment and scrolls to top
- **severity:** low  ·  **category:** correctness
- **area:** Soft navigation (setupSoftNav in ui/.sprig/compiler/hydrate.ts): outlet swap, scroll handling, view-transition path, re-hydration
- **location:** `ui/.sprig/compiler/hydrate.ts:145 (navigate filter excludes only e.hashChange) and :164 (scrollTo(0,0))`
- **expected:** After swapping the outlet, scroll the #fragment target (if any) into view, matching native cross-document fragment navigation.
- **actual:** The intercept filter only skips when e.hashChange is true (same-document hash-only change). A cross-document navigation that includes a hash is intercepted, the outlet is swapped, and scrollTo(0,0) is executed unconditionally — the URL fragment is discarded and never scrolled to.
- **repro:**
```
Preconditions: a browser supporting the Navigation API (window.navigation present), so setupSoftNav arms the intercept (line 142 early-returns otherwise).

1. Load a sprig page under <base>, e.g. /ui/board.
2. Activate a link (or navigation.navigate) to a DIFFERENT path under <base> that contains a fragment, e.g. href="/ui/issues/SPR-101#comments", where the destination page renders an element with id="comments".
3. The 'navigate' handler fires. Because the document/path changes, e.hashChange is false, so the guard on hydrate.ts:145 does not return and e.intercept(...) runs.
4. The handler fetches the destination HTML, swaps <sprig-outlet> innerHTML, re-bootstraps islands, and calls globalThis.scrollTo(0, 0) (hydrate.ts:161-165).

Expected: after the swap, the viewport scrolls to the element with id="comments" (native cross-document fragment behavior).
Actual: the viewport scrolls to the top; the URL still shows #comments but url.hash is never read and the anchor is never scrolled into view.

Fix sketch: in swap(), after bootstrapIslands, if url.hash is non-empty, do `const t = cur.querySelector(url.hash) ?? document.getElementById(decodeURIComponent(url.hash.slice(1))); t ? t.scrollIntoView() : globalThis.scrollTo(0,0);` instead of the unconditional scrollTo(0,0).
```
- **evidence:**
```
hydrate.ts:145 `if (!e.canIntercept || e.hashChange || e.downloadRequest || e.formData) return;` — hashChange is false for cross-document nav. hydrate.ts:146-148 builds the URL but never reads url.hash. hydrate.ts:161-165 swap() touches only the outlet and scrolls to top; no querySelector on url.hash / scrollIntoView anywhere.
```
- **independent verification:**
```
Verified by static analysis of the cited code in ui/.sprig/compiler/hydrate.ts (setupSoftNav).

1. Line 145: `if (!e.canIntercept || e.hashChange || e.downloadRequest || e.formData) return;`. Per the Navigation API spec, `NavigateEvent.hashChange` is true ONLY for a same-document navigation where the only difference is the fragment. A cross-document navigation to a different path that also carries a fragment (e.g. /ui/issues/SPR-101#comments) has hashChange === false. Therefore this guard does NOT skip it; the navigation is intercepted.

2. Line 146: `const url = new URL(e.destination.url);` constructs the URL, but a grep over the entire file shows `url.hash` is never read. The only occurrence of "hash" in hydrate.ts is the e.hashChange guard on line 145.

3. Lines 161-165: `swap()` performs `cur.innerHTML = next.innerHTML; bootstrapIslands(cfg, cur); globalThis.scrollTo(0, 0);`. The scrollTo(0,0) is unconditional. There is no querySelector(url.hash), no getElementById, and no scrollIntoView anywhere in the file (confirmed by grep: no matches for scrollIntoView/getElementById/fragment).

Result: a same-origin, in-base cross-document navigation that includes a fragment is intercepted, the outlet is swapped, and the viewport is forced to the top. The fragment target is never located or scrolled into view. This diverges from native cross-document fragment navigation, which scrolls the #id target into view. This is a real, reproducible defect, not intended behavior.

Severity confirmed as low: it is a scroll-position / UX correctness issue only. The target page still loads and hydrates correctly; nothing breaks functionally and no data is lost. The user simply lands at the top of the page instead of at the fragment anchor.
```

### 72. serveAsset serves static assets for ANY HTTP method (POST/PUT/DELETE return 200 + full body) — no GET/HEAD restriction
- **severity:** low  ·  **category:** protocol
- **area:** Static asset serving (serveAsset in packages/keep/mod.ts)
- **location:** `packages/keep/mod.ts:39-54 (serveAsset) and dispatch at packages/keep/mod.ts:86-88`
- **expected:** A static-file endpoint should respond only to GET (and HEAD). Unsupported methods (POST/PUT/DELETE/PATCH) should return 405 Method Not Allowed with an Allow header, not 200 with the file body.
- **actual:** serveAsset never inspects req.method (the dispatch at mod.ts:86-88 calls serveAsset(assetsDir, file) without passing or checking the method). Every method that routes to the asset prefix gets a 200 and the complete file contents.
- **repro:**
```
Source: packages/keep/mod.ts:39 — `async function serveAsset(dir: string, file: string)` has no Request/method parameter; lines 86-88 — `if (path.startsWith(assetPrefix + "/")) { return serveAsset(assetsDir, path.slice(assetPrefix.length + 1)); }` with no method check. Reproduced by replicating that exact logic over a static dir containing client.js and issuing each method:
  GET    status=200 len=22  (file body)
  POST   status=200 len=22  (file body)
  PUT    status=200 len=22  (file body)
  DELETE status=200 len=22  (file body)
  PATCH  status=200 len=22  (file body)
All return 200 with the full body and no Allow header. Expected: GET/HEAD -> 200; POST/PUT/DELETE/PATCH -> 405 Method Not Allowed with `Allow: GET, HEAD`. Fix: gate serveAsset on req.method (allow GET and HEAD; for HEAD return headers with empty body) and return 405 + Allow header otherwise.
```
- **evidence:**
```
Live server port 8200: `curl -s -X POST http://localhost:8200/ui/_assets/client.js` returned the full module source `import{d as t,e}from"./chunk-UQEYE25X.js";var n=JSON.parse(...)`. DELETE and PUT both returned `200, len=215`. Source: serveAsset(dir,file) signature at packages/keep/mod.ts:39 takes no Request/method; dispatch at mod.ts:87 is `return serveAsset(assetsDir, path.slice(...))` with no method guard.
```
- **independent verification:**
```
Verified against the cited source. In packages/keep/mod.ts, serveAsset(dir, file) (lines 39-54) takes only a directory and filename — it never receives or inspects req.method. The dispatch in the fetch handler (lines 86-88) routes purely on path: `if (path.startsWith(assetPrefix + "/")) return serveAsset(assetsDir, path.slice(...))`, with no method guard. I grep'd the entire keep package for any `.method` reference and found zero — there is no method gating anywhere upstream either. I reproduced the behavior by faithfully replicating the exact dispatch + serveAsset logic and driving it with GET/POST/PUT/DELETE/PATCH: all five returned status=200, the complete file body, and no Allow header. This confirms the claim precisely. It is a genuine defect (a static-file endpoint should be GET/HEAD-only and answer 405 with an Allow header for other methods), but the severity is correctly rated low: the response body is read-only static content, no mutation or state change occurs, no traversal beyond the assets dir (`..` is rejected at line 41), and the practical impact is only minor protocol non-conformance / a missed optimization (no early 405). Not exploitable beyond serving a public asset that is already served on GET.
```

### 73. serveAsset ".." guard over-blocks legitimate single-segment filenames containing a double-dot substring (403 for a valid in-dir file)
- **severity:** low  ·  **category:** logic
- **area:** Static asset serving (serveAsset in packages/keep/mod.ts)
- **location:** `packages/keep/mod.ts:41 (if (file.includes("..")) return 403)`
- **expected:** A filename like foo..bar.js or my.chunk..v2.js is a legal single path segment with no slash, hence no traversal. It should reach Deno.readFile and return the file (200) if present, or 404 if absent — never 403.
- **actual:** Any request whose remaining path contains the substring ".." anywhere (even inside a single non-slash segment, e.g. release..notes.js, v1..2.css, app..min.js) is unconditionally rejected with 403 Forbidden. The guard is a blunt substring test, not a path-segment/normalization check, so legitimate build artifacts whose names contain consecutive dots become permanently unservable.
- **repro:**
```
Deterministic logic repro (no running server needed). Save and run with Deno:

  function check(p: string) {
    const assetPrefix = "/ui/_assets";
    const path = new URL("http://localhost:8200" + p).pathname;
    if (path.startsWith(assetPrefix + "/")) {
      const file = path.slice(assetPrefix.length + 1);
      console.log(p, "file=", file, "403?", file.includes(".."));
    } else console.log(p, "did not match asset prefix");
  }
  check("/ui/_assets/foo..bar.js"); // 403? true  (BUG: legal single-segment name)
  check("/ui/_assets/client..js");  // 403? true  (BUG)
  check("/ui/_assets/client.js");   // 403? false (reaches readFile -> 200/404)
  check("/ui/_assets/../mod.ts");   // did not match asset prefix (URL normalizes ..)

Live repro once a server is up (per the claim):
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8200/ui/_assets/foo..bar.js   # -> 403
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8200/ui/_assets/client..js     # -> 403
Expected: 200 if the file exists in the assets dir, else 404 — never 403.

Fix: replace the substring test with a segment/normalization check, e.g. reject only if any path segment equals ".." (file.split("/").includes("..")) or resolve and confirm the result stays within dir.
```
- **evidence:**
```
packages/keep/mod.ts:41  `if (file.includes("..")) return new Response("Forbidden", { status: 403 });`. Live: GET /ui/_assets/foo..bar.js and /ui/_assets/client..js both return 403 (not 404), proving the 403 fires on the substring before readFile is even attempted, regardless of whether a slash (real traversal) is present. By contrast a real-traversal attempt is already independently neutralized because Deno.readFile does not decode %2f and URL normalization collapses %2e%2e segments, so the broad substring guard's only observable effect here is the false-positive on legitimate names.
```
- **independent verification:**
```
Confirmed by reading the cited code and reproducing the exact server logic deterministically.

packages/keep/mod.ts:41 is verbatim: `if (file.includes("..")) return new Response("Forbidden", { status: 403 });`. The `file` argument is computed at line 87 as `path.slice(assetPrefix.length + 1)` for any request under `<base>/_assets/`.

I extracted the asset-routing logic into a standalone Deno script and ran it:
- `/ui/_assets/foo..bar.js` -> file `foo..bar.js`, blocked=true (403)
- `/ui/_assets/client..js`  -> file `client..js`,  blocked=true (403)
- `/ui/_assets/client.js`   -> blocked=false (would reach Deno.readFile)
These filenames are single path segments with no slash, so there is no traversal, yet they are rejected with 403 before readFile is attempted. A legitimate, present file would never return its 200/404 — exactly the claimed defect.

The guard is a blunt substring test (file.includes("..")) rather than a path-segment / normalization check, so any name with consecutive dots (release..notes.js, v1..2.css, app..min.js) is permanently unservable.

I also confirmed the claim's secondary evidence: a genuine traversal `/ui/_assets/../mod.ts` is collapsed by `new URL(...)` to `/mod.ts`, which does NOT even match `assetPrefix + "/"`, so the `..` guard provides no real traversal protection on this path — URL normalization already does. The substring guard's only observable effect here is the false-positive 403 on legitimate names.

Severity low is correct: it fails closed (over-blocks, no security exposure), and filenames containing `..` are uncommon in real bundler output, so practical impact is limited. It is nonetheless a real logic defect.

Caveat on the cited repro: I could not run the live curl commands because no server is running in this environment; I instead reproduced the exact dispatch+guard logic, which is deterministic and stronger than a black-box curl.
```

### 74. Asset content-type lookup is case-sensitive on the file extension: .JS/.CSS/.SVG served as application/octet-stream
- **severity:** low  ·  **category:** correctness
- **area:** Static asset serving (serveAsset in packages/keep/mod.ts)
- **location:** `packages/keep/mod.ts:44-47 (ext = file.slice(file.lastIndexOf(".")); ASSET_TYPES[ext] keyed on lowercase ".js"/".css"/...)`
- **expected:** A file with an uppercase or mixed-case extension (.JS, .Css, .SVG) should map to the same content-type as its lowercase form (text/javascript, text/css, image/svg+xml). Extension matching is case-insensitive on case-insensitive filesystems (macOS default) where client.JS and client.js are the same on-disk file.
- **actual:** ASSET_TYPES is keyed only on lowercase extensions and ext is used verbatim, so client.JS resolves to the `?? "application/octet-stream"` fallback. On a case-insensitive filesystem (the default on macOS, where this server runs) client.JS returns 200 with the real bytes but content-type application/octet-stream. A browser will refuse to execute an ES module / classic script served as application/octet-stream (strict MIME checking / nosniff for module scripts), silently breaking the page even though the file exists and is served.
- **repro:**
```
Static analysis + simulation (no running server required), cwd = repo root:

1. Read packages/keep/mod.ts:31-54. ASSET_TYPES (lines 31-37) is keyed on lowercase ".js"/".css"/".map"/".svg"/".json". Line 44 derives `ext = file.slice(file.lastIndexOf("."))` with no case normalization; line 47 uses `ASSET_TYPES[ext] ?? "application/octet-stream"`.

2. Simulate the exact logic:
   const ext = "client.JS".slice("client.JS".lastIndexOf(".")); // ".JS"
   ASSET_TYPES[ext] // undefined -> "application/octet-stream"
   Observed output:
     client.js => ".js" => text/javascript; charset=utf-8
     client.JS => ".JS" => application/octet-stream
     a.Css     => ".Css" => application/octet-stream
     b.SVG     => ".SVG" => application/octet-stream

3. Confirm the FS is case-insensitive (so the uppercase-ext read still hits the real file and returns 200):
   d=$(mktemp -d); printf 'x' > "$d/case_probe.js"; cat "$d/case_probe.JS"  # succeeds -> FS-CASE-INSENSITIVE

Net: GET <base>/_assets/client.JS -> 200 with the real bytes but content-type application/octet-stream, which a browser refuses to execute as a module/script. Fix: normalize with `file.slice(file.lastIndexOf(".")).toLowerCase()` before the ASSET_TYPES lookup.
```
- **evidence:**
```
Live: GET /ui/_assets/client.JS -> 200, content-type: application/octet-stream (the same bytes as client.js, which serves as text/javascript). Simulated derivation: file.slice(file.lastIndexOf(".")) yields ".JS"/".CSS"/".Css", none of which are present in ASSET_TYPES { ".js", ".css", ".map", ".svg", ".json" }, so all fall through to application/octet-stream. packages/keep/mod.ts:31-37 (lowercase-only map) and :47 (`ASSET_TYPES[ext] ?? "application/octet-stream"`).
```
- **independent verification:**
```
Verified against packages/keep/mod.ts:31-54. serveAsset derives the extension with `ext = file.slice(file.lastIndexOf("."))` (line 44) verbatim — no case normalization — and looks it up in ASSET_TYPES (lines 31-37), a map keyed only on lowercase extensions ".js"/".css"/".map"/".svg"/".json", with `?? "application/octet-stream"` fallback (line 47).

I directly simulated the exact derivation+lookup: "client.JS" -> ext ".JS" -> not in map -> "application/octet-stream"; same for ".Css" and ".SVG". The lowercase "client.js" correctly maps to "text/javascript; charset=utf-8".

I also verified the load-bearing premise: the filesystem at the repo root (macOS APFS default) is case-INSENSITIVE — a probe file written as case_probe.js was readable as case_probe.JS. Therefore `Deno.readFile("${dir}/client.JS")` at line 43 succeeds and returns the real bytes (HTTP 200), while content-type is the wrong application/octet-stream. Browsers apply strict MIME checking (X-Content-Type-Options nosniff is implied for module scripts) and refuse to execute a script delivered as application/octet-stream, so such a reference silently breaks despite the 200.

This is a genuine defect (correct fix: lowercase ext before lookup, e.g. ext.toLowerCase()). Severity is low: it is only reachable when a caller requests a case-variant URL. The sprig SSR emits the build's real lowercase asset filenames, so the app's own pages are unaffected; it only bites hand-typed/external/case-variant references. Not a misunderstanding and not unreachable, but low blast radius.
```

### 75. Static assets send no ETag/Last-Modified, so conditional GETs (If-None-Match/If-Modified-Since) never return 304 and always re-transfer the full body
- **severity:** low  ·  **category:** performance
- **area:** Static asset serving (serveAsset in packages/keep/mod.ts)
- **location:** `packages/keep/mod.ts:45-49 (serveAsset Response headers)`
- **expected:** With cache validators present, a conditional request should yield HTTP 304 Not Modified with no body; at minimum an ETag or Last-Modified header should be emitted so intermediaries/proxies and force-refreshes can revalidate cheaply.
- **actual:** Response always returns HTTP 200 with the full 29112-byte body (content-length: 29112). No ETag, no Last-Modified, no 304 path. The only headers set are content-type and cache-control (lines 46-49). Any proxy/CDN or a shift-reload re-downloads the entire asset every time even though it is unchanged.
- **repro:**
```
With the server running on :8200, send a conditional GET for a built asset:

  curl -s -D - -o /dev/null -H 'If-None-Match: "anything"' -H 'If-Modified-Since: Wed, 21 Oct 2099 07:28:00 GMT' http://localhost:8200/ui/_assets/app.css

Observed response:
  HTTP/1.1 200 OK
  content-type: text/css; charset=utf-8
  cache-control: public, max-age=31536000, immutable
  vary: Accept-Encoding
  content-length: 29112

The server returns 200 with the full 29112-byte body and emits no ETag and no Last-Modified, so the conditional headers are ignored and no 304 path exists. Source: packages/keep/mod.ts:45-50 (serveAsset) sets only content-type + cache-control. Mitigating context: assets are loaded via versioned URLs `?v=${version}` (ui/.sprig/compiler/mod.ts:124,131) with `immutable`, so normal browser loads never revalidate; the missing-304 only matters for force-refreshes or proxies that ignore `immutable`.
```
- **evidence:**
```
Observed: `HTTP/1.1 200 OK` + `content-length: 29112` returned in response to the conditional GET above. Source packages/keep/mod.ts:45-50 builds `new Response(bytes, { headers: { 'content-type': ..., 'cache-control': 'public, max-age=31536000, immutable' } })` — no validators and no conditional-request handling anywhere in serveAsset.
```
- **independent verification:**
```
Confirmed at both source and runtime. packages/keep/mod.ts:45-50 (serveAsset) builds `new Response(bytes, { headers: { "content-type": ..., "cache-control": "public, max-age=31536000, immutable" } })` — no ETag, no Last-Modified, and there is zero conditional-request handling anywhere in serveAsset or the fetch dispatcher (mod.ts:80-102). So an `If-None-Match`/`If-Modified-Since` request can never produce a 304; the full body is always re-sent.

Runtime reproduction against the live server on :8200 matched the claim exactly: `curl -H 'If-None-Match: "anything"' http://localhost:8200/ui/_assets/app.css` returned `HTTP/1.1 200 OK` with `content-length: 29112` and only `content-type` + `cache-control` headers (no ETag, no Last-Modified). So the factual core of the report is accurate and reproducible.

Severity is correctly LOW (the report itself says low), and arguably borderline info/working-as-designed, because the system uses the standard fingerprinted-URL strategy: assets are referenced as `${base}/_assets/app.css?v=${version}` (ui/.sprig/compiler/mod.ts:124,131,136) and served `immutable, max-age=31536000`. Under versioned-URL + `immutable`, the URL is the cache key and conformant browsers do not revalidate at all — when content changes, `version` changes and the URL changes, yielding a fresh fetch with no stale-content risk. Validators are therefore redundant on the normal path. The genuine (but marginal) gap is only the corner cases the report's "Expected" leans on: a hard/shift-reload that bypasses the cache, or an intermediary/CDN that ignores `immutable` — those re-transfer the full ~29 KB body where a 304 would have sufficed. That is a real, reproducible, minor performance inefficiency, not a misunderstanding, so real=true at low severity — but the "should yield 304 / always re-downloads" framing overstates impact given the immutable+versioned design makes revalidation largely moot in practice.
```

### 76. titlecase pipe mis-capitalizes any word starting with a non-ASCII letter
- **severity:** low  ·  **category:** rendering
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts + render.ts): pipes, control flow, statement evaluator
- **location:** `ui/.sprig/compiler/expr.ts:149-150 (titlecase pipe)`
- **expected:** Angular's titlecase capitalizes the FIRST letter of each word: "éric" -> "Éric", "über" -> "Über".
- **actual:** The first letter is left lowercase and the next ASCII letter is uppercased instead: "éric" -> "éRic", "über" -> "üBer". Words composed entirely of non-ASCII letters are not title-cased at all.
- **repro:**
```
In any template, render an interpolation using the titlecase pipe with a non-ASCII-initial word:

  {{ name | titlecase }}   where name = "éric"  (or "über")

Expected (Angular semantics): "Éric" / "Über" (first letter of each word capitalized).
Actual: "éRic" / "üBer" — the leading accented letter stays lowercase and the next ASCII letter is uppercased.

Standalone reproduction of the exact pipe lambda (ui/.sprig/compiler/expr.ts:149-150):

  node -e 'const tc=(v)=>String(v??"").replace(/\w\S*/g,(w)=>w[0].toUpperCase()+w.slice(1).toLowerCase()); console.log(tc("éric"), tc("über"))'
  // prints: éRic üBer

Fix direction: use a Unicode-aware regex with the /u flag, e.g. replace(/(^|\s|[^\p{L}\p{N}])(\p{L})/gu, ...) or match words via /\p{L}[\p{L}\p{N}]*/gu, uppercasing the first letter and lowercasing the rest.
```
- **evidence:**
```
The regex `/\w\S*/g` (expr.ts:149) uses JS ASCII `\w` ([A-Za-z0-9_], no /u flag). For "éric" the engine skips index 0 'é' (not \w) and starts the match at index 1 'r', capturing "ric"; the callback uppercases that match's first char ('r') giving "Ric", so the output is "é"+"Ric" = "éRic". Verified by reading expr.ts:149-150: `String(v ?? "").replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())`.
```
- **independent verification:**
```
VERIFIED real. The cited code at /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/expr.ts:149-150 matches the report exactly: `titlecase: (v) => String(v ?? "").replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())`. The regex `/\w\S*/g` uses JS ASCII `\w` (= [A-Za-z0-9_]) with no `/u`/Unicode-property awareness.

I reproduced the behavior directly by running the exact lambda in Node against several inputs:
  "éric" -> "éRic"
  "über" -> "üBer"
  "élan" -> "éLan"
  "éric dupont" -> "éRic Dupont"
  "hello world" -> "Hello World" (ASCII works fine)

Root cause confirmed by the output: for "éric", the regex's first match cannot start at index 0 ('é' is not in \w), so it starts at index 1 and captures "ric"; the callback uppercases that match's first char ('r') -> "Ric", and the leading 'é' is left untouched, yielding "é"+"Ric" = "éRic". A word made entirely of non-ASCII letters would not be title-cased at all (no \w to anchor a match start, though a trailing ASCII letter could still be hit).

Reachability: `titlecase` is registered in the PIPES table (expr.ts:146-150) and dispatched by evalPipe (expr.ts:142-143) for any interpolation `{{ x | titlecase }}`, so it is reachable from any template.

Expected vs actual: Angular's TitleCasePipe capitalizes the first letter of each word including accented/Unicode letters ("éric" -> "Éric", "über" -> "Über"). The sprig implementation instead lowercases the leading non-ASCII letter's position and uppercases the next ASCII letter. This is a genuine defect, not intended behavior.

Severity low is correct: purely cosmetic, no crash, affects only non-ASCII-initial words.
```

### 77. @let declaration is not block-scoped — it mutates and leaks into the enclosing/parent render scope
- **severity:** low  ·  **category:** logic
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts + render.ts): pipes, control flow, statement evaluator
- **location:** `ui/.sprig/compiler/render.ts:90-92 (let_declaration case) interacting with render.ts:354/393 (renderIf/renderFor pass opts.scope by reference)`
- **expected:** Per Angular semantics, an `@let` binding is scoped to its enclosing block/view and is not visible outside it; each loop iteration gets a fresh view.
- **actual:** `@let` writes directly onto the shared scope object, so the binding leaks out of its block into the parent scope and persists/overwrites across the rest of the template and across loop iterations.
- **repro:**
```
In ui/.sprig/compiler, create a test file and run `deno test --allow-all`:

import { assertStringIncludes } from "@std/assert";
import { named, parseTemplate } from "./parse.ts";
import { renderNodes } from "./render.ts";

Deno.test("@let leaks out of aliasless @if", async () => {
  const src = "@if (cond) { @let x = 'inner'; <a>{{ x }}</a> } <b>{{ x }}</b>";
  const root = await parseTemplate(src);
  const out = renderNodes(named(root), {
    scope: { cond: true, x: "OUTER" },
    registry: { get: () => undefined },
    source: root.text,
  });
  // Actual:   " <a>inner</a> <b>inner</b>"  (inner @let overwrote parent x)
  // Expected: the outer <b> should still show "OUTER"
  assertStringIncludes(out, "<b>OUTER</b>"); // FAILS
});

Root cause: render.ts:90-92 mutates opts.scope directly; render.ts:353 reuses the parent scope object verbatim when the @if has no alias. Fix: give @let/@if blocks a fresh child scope (e.g. clone opts.scope unconditionally when entering a block, or have the let_declaration case write to a block-local scope rather than opts.scope).
```
- **evidence:**
```
render.ts:90-92 does `opts.scope[field(node,"name")!.text] = evalExpr(field(node,"value"), opts.scope)` — a direct mutation of `opts.scope`. renderIf only clones the scope when an alias is present (render.ts:352-354: `const scope = alias ? {...opts.scope,...} : opts.scope`), so an aliasless `@if` block shares the SAME scope object as its parent; renderFor spreads scope per item but `@let` set in iteration i has already mutated the per-item object, and the parent-leak path via renderIf is unconditional. Grammar confirms `let_declaration` with fields name/value (grammar.js:228-235).
```
- **independent verification:**
```
Confirmed by reading the cited code and reproducing it empirically.

Code path (all in ui/.sprig/compiler/render.ts):
- Line 90-92: the `let_declaration` case mutates the scope IN PLACE: `opts.scope[field(node,"name")!.text] = evalExpr(...)`. It never creates a new scope object.
- Line 352-354 (renderIf): for the consequence, `const scope = alias ? { ...opts.scope, [alias.text]: cond } : opts.scope`. When the `@if` has no `as` alias, `scope` IS the same object reference as `opts.scope` (the parent scope). The `{ ...opts, scope }` passed to renderNodes shallow-copies opts but keeps that same scope reference.
- Therefore a `@let` declared inside an aliasless `@if` writes onto the parent's scope object and is visible everywhere after the block.

Empirical reproduction (standalone Deno test using the same renderNodes/parseTemplate entry points as the existing compiler.test.ts):
  Template: `@if (cond) { @let x = 'inner'; <a>{{ x }}</a> } <b>{{ x }}</b>`
  Scope:    { cond: true, x: "OUTER" }
  Output:   " <a>inner</a> <b>inner</b>"
The `<b>{{ x }}</b>` OUTSIDE the block rendered `inner`, proving the inner `@let` overwrote the parent's `x = "OUTER"` and leaked out of the block. Per Angular semantics @let is block-scoped (an outer reference to the same name would keep the outer binding, and referencing the let outside its block is actually a compile error), so leaking/overwriting the parent scope is incorrect.

Scope of impact / severity calibration:
- The @for leak claim is NOT reproduced: renderFor (line 391) builds a fresh `{ ...opts.scope, ... }` per iteration, so a `@let` set in iteration i mutates only that per-item object and does not persist across iterations or escape the loop (my second test confirmed `<c></c>` — v did not leak out of the @for). So the cross-iteration / loop-leak part of the claim is wrong; only the renderIf parent-leak path is real.
- Real-world consequence is limited: it requires a user to reuse the same identifier name inside and outside an aliasless @if, and SSR renders top-to-bottom so it produces wrong output rather than a crash. Hence severity = low is correct.
```

### 78. i18nPlural pipe throws (uncaught) when the matched ICU value is not a string
- **severity:** low  ·  **category:** crash
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts + render.ts): pipes, statement evaluator, assignment targets, number formatting
- **location:** `ui/.sprig/compiler/expr.ts:171-176 (i18nPlural)`
- **expected:** Either coerce to string or fall back gracefully (Angular tolerates this / stringifies).
- **actual:** key.replace("#", String(n)) is called on a non-string → 'key.replace is not a function' TypeError. Because evalExpr/renderNode have no try/catch, this propagates out of SSR render and surfaces as an unhandled error (500 on the SSR page / unhandled rejection client-side).
- **repro:**
```
Template: `{{ count | i18nPlural: { '=1': 1, other: 0 } }}` rendered with scope `count = 1`.

What happens: evalExpr evaluates the object-literal arg, turning the numeric literals into JS numbers (expr.ts:21-22, 76-83). In the i18nPlural pipe (expr.ts:171-176), `map['=1']` resolves to the number `1`, then `key.replace("#", String(n))` is invoked on a number -> `TypeError: key.replace is not a function`. Because render.ts (renderNode line 73 -> interpolation line 78) calls evalExpr with no try/catch, the error escapes SSR render (HTTP 500 / client-side unhandled rejection).

Minimal direct repro of the failing line (verified, threw):
  node -e 'const map={"=1":1}; const n=1; const key=map[`=${n}`]??map.other??""; key.replace("#",String(n))'
  -> TypeError: key.replace is not a function

Fix: coerce key to a string, e.g. `return String(key).replace("#", String(n));` (matching how every other string-producing pipe in PIPES already guards with String(...)).
```
- **evidence:**
```
Node repro of the exact line: `const map={"=1":1}; const key=map["=1"]??map.other??""; key.replace("#","x")` -> threw 'key.replace is not a function'. expr.ts:174-175 has no string guard: `const key = map[`=${n}`] ?? map.other ?? ""; return key.replace("#", String(n));`
```
- **independent verification:**
```
Verified against the cited code. In ui/.sprig/compiler/expr.ts the i18nPlural pipe (lines 171-176) does: `const map = (a[0] as Record<string,string>) ?? {}; const n = Number(v); const key = map[`=${n}`] ?? map.other ?? ""; return key.replace("#", String(n));`. There is no string guard on `key`.

The object-literal argument is built by evalExpr's `object` case (lines 76-83): each pair's value is evaluated with evalExpr, and a numeric literal goes through the `number` case (line 21-22) returning a JS number. So for a template like `{{ n | i18nPlural: { '=1': 1, other: 0 } }}` with n=1, `map['=1']` is the number 1, and `key.replace` is undefined.

I reproduced the exact failing line in Node: `const map={"=1":1}; const n=1; const key=map[`=${n}`]??map.other??""; key.replace("#",String(n))` -> threw "key.replace is not a function". 

I also confirmed propagation: render.ts calls evalExpr directly with no try/catch — renderNode (line 73) / renderNodes (line 61) interpolation path at line 78 (`escape(stringify(evalExpr(...)))`) has no error handling, so the TypeError propagates out of SSR render (unhandled -> 500 / unhandled rejection client-side). Every other string-producing pipe (uppercase L147, lowercase L148, truncate L167, i18nSelect coerces via String) defensively wraps with String(...); i18nPlural is the lone exception, confirming this is an unintended omission rather than working-as-designed.

I downgraded severity from medium to low: the crash is real and reachable, but it requires the developer to author an ICU map with non-string values, which is a malformed/atypical usage (the ICU plural map is conventionally string templates like `'one item'`/`'# items'`). It is not triggerable by end-user input alone and the standard, documented usage path does not hit it. It is a genuine robustness defect worth a one-line `String(...)` coercion, but its real-world blast radius is small.
```

### 79. formatNumber silently ignores minIntegerDigits in the digits-info format
- **severity:** low  ·  **category:** correctness
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts + render.ts): pipes, statement evaluator, assignment targets, number formatting
- **location:** `ui/.sprig/compiler/expr.ts:183-191 (formatNumber, used by number: and percent: pipes)`
- **expected:** '005' (minIntegerDigits=3 pads the integer part), matching Angular's DecimalPipe.
- **actual:** '5'. The regex /^\d+\.(\d+)-(\d+)$/ captures only minFraction (group 1) and maxFraction (group 2); the leading \d+ (minIntegerDigits) is parsed but never applied — toLocaleString is called with only minimumFractionDigits/maximumFractionDigits, no minimumIntegerDigits.
- **repro:**
```
In a sprig template: {{ 5 | number:'3.0-0' }}

Expected (Angular DecimalPipe): 005
Actual (sprig formatNumber): 5

Root cause at ui/.sprig/compiler/expr.ts:187-190 — the regex captures only minFrac (m[1]) and maxFrac (m[2]); the leading minIntegerDigits group is matched but discarded, and toLocaleString is called without minimumIntegerDigits.

Node reproduction using the exact code:
  function formatNumber(n, fmt){let minFrac=0,maxFrac=3;if(fmt){const m=fmt.match(/^\d+\.(\d+)-(\d+)$/);if(m){minFrac=Number(m[1]);maxFrac=Number(m[2]);}}return n.toLocaleString("en-US",{minimumFractionDigits:minFrac,maximumFractionDigits:maxFrac});}
  formatNumber(5,'3.0-0')  // => "5"   (Angular: "005")
Confirmed fix path: (5).toLocaleString("en-US",{minimumIntegerDigits:3,minimumFractionDigits:0,maximumFractionDigits:0}) => "005".
```
- **evidence:**
```
Node repro using the exact regex+toLocaleString: number:'3.0-0' of 5 => "5" (Angular gives "005"). expr.ts:187-190 maps m[1]->minFrac, m[2]->maxFrac and discards the integer-digits group.
```
- **independent verification:**
```
Verified against /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/expr.ts:183-191. The regex /^\d+\.(\d+)-(\d+)$/ matches the leading \d+ (minIntegerDigits) but does not capture it — only group 1 (minFraction) and group 2 (maxFraction) are used, mapped to minimumFractionDigits/maximumFractionDigits. toLocaleString is never given minimumIntegerDigits, so the integer-padding portion of Angular's DigitsInfo is silently dropped. Both the `number:` (line 153) and `percent:` (line 154) pipes route the digits-info string straight into formatNumber, so the path is reachable. I reproduced with the exact regex+toLocaleString code in Node: formatNumber(5, '3.0-0') returns "5", whereas Angular's DecimalPipe returns "005", and the corrected call (adding minimumIntegerDigits:3) confirms "005" is achievable. This is a genuine, reproducible correctness defect, not intended behavior. Severity low is appropriate: the default and common digits-info forms ('1.x-y') are unaffected; only the uncommon case of requesting integer-digit padding (minIntegerDigits > 1) misbehaves, producing a wrong-but-not-crashing string.
```

### 80. Assignment to a subscript target (arr[i] = x / obj['k'] = x) silently no-ops in event handlers
- **severity:** low  ·  **category:** logic
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts + render.ts): pipes, statement evaluator, assignment targets, number formatting
- **location:** `ui/.sprig/compiler/expr.ts:227-237 (assignTo)`
- **expected:** The subscript target is written (items[0] becomes 5).
- **actual:** assignTo only branches on left.type === 'identifier' and 'member_expression'. A subscript_expression lvalue matches neither branch, so the assignment is silently discarded — no write, no error.
- **repro:**
```
1. In a sprig template, add an event handler that assigns to a subscript target, e.g. `<button (click)="items[0] = 5">set</button>` (or `obj['k'] = 5`).
2. Hydrate the component and click the button.
3. Observe `items[0]` is NOT updated — no write occurs and no error is thrown.

Root cause (ui/.sprig/compiler/expr.ts): `evalStatement` (line 214) dispatches the parsed `assignment` to `assignTo` (line 220). `assignTo` (lines 227-237) handles only `left.type === "identifier"` (229) and `"member_expression"` (233); a `subscript_expression` lvalue (which the grammar permits and the parser produces — verified by parsing grammar.wasm) matches no branch and the function returns without writing.

Contrast: subscript reads work via `evalExpr` case at expr.ts:39, so the failure is silent and asymmetric.

Fix: add `else if (left.type === "subscript_expression") { const obj = evalExpr(field(left,"object"), scope) as Record<PropertyKey,unknown>|null; if (obj) obj[evalExpr(field(left,"index"), scope) as PropertyKey] = value; }`.
```
- **evidence:**
```
expr.ts:229 `if (left.type === "identifier")` ... expr.ts:233 `else if (left.type === "member_expression")` ... no branch for subscript_expression; grammar.js:422 defines subscript_expression and grammar.js:379 allows it as the assignment left-hand side.
```
- **independent verification:**
```
Confirmed by both code inspection and a runtime parse against the actual compiled grammar.

Grammar (tree-sitter-angular-template/grammar.js): the `assignment` rule defines `field("left", $._expression)`, and `_expression` includes `subscript_expression`. So `items[0] = 5` and `obj['k'] = 5` are valid event-handler lvalues. I verified this at runtime by loading ui/.sprig/compiler/grammar.wasm with web-tree-sitter and parsing `<button (click)="items[0] = 5">` and `<button (click)="obj['k'] = 5">`: both produce an `assignment` node whose `left` field has type `subscript_expression` (right = `5`).

Interpreter (ui/.sprig/compiler/expr.ts): `evalStatement` (line 214) routes `assignment` statements to `assignTo(field(stmt,"left"), evalExpr(field(stmt,"right"), s), s)` (line 220). `assignTo` (lines 227-237) only branches on `left.type === "identifier"` (line 229) and `left.type === "member_expression"` (line 233). A `subscript_expression` left node matches neither branch, so `assignTo` returns without performing any write and without throwing — the assignment is silently discarded.

Reachability is real: `evalStatement` is invoked from ui/.sprig/compiler/hydrate.ts:212 when a hydrated event handler fires. Note the asymmetry that makes this a genuine defect rather than an unsupported-feature gap: subscript *reads* ARE implemented in `evalExpr` (expr.ts:39-44), so `{{ items[0] }}` evaluates correctly while `(click)="items[0] = x"` silently fails — inconsistent and surprising.

Severity low is correct: it fails silently (no state corruption, no crash), and subscript-target assignment in handlers is an uncommon pattern (most handlers call methods or assign to plain/member targets). A one-line `else if (left.type === "subscript_expression")` branch evaluating object + index would fix it.
```

### 81. number / percent / currency pipes emit "NaN" / "NaN%" / "$NaN" for non-numeric or undefined input
- **severity:** low  ·  **category:** rendering
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts + render.ts): pipes, statement evaluator, assignment targets, number formatting
- **location:** `ui/.sprig/compiler/expr.ts:153-161 (number, percent, currency pipes)`
- **expected:** Empty string or a graceful fallback (Angular's number/currency pipes return '' / throw a dev-time error, not literal 'NaN' in production output).
- **actual:** number: -> 'NaN'; percent: -> 'NaN%'; currency: -> '$NaN' (Intl currency formats NaN as '$NaN'). These render directly into the page as visible 'NaN' text. Likewise division/modulo by zero in an interpolation render 'Infinity' / 'NaN' via stringify (expr.ts:106-107 -> render.ts:412-417).
- **repro:**
```
In any sprig template, bind an undefined or non-numeric value through these pipes:

  {{ missing | number }}        -> renders: NaN
  {{ missing | percent }}       -> renders: NaN%
  {{ obj.absent | currency }}   -> renders: $NaN
  {{ "abc" | number }}          -> renders: NaN
  {{ 5 / 0 }}                   -> renders: Infinity
  {{ 5 % 0 }}                   -> renders: NaN

Root cause (ui/.sprig/compiler/expr.ts):
  :153 number:   formatNumber(Number(v), ...)        // no NaN guard
  :154 percent:  `${formatNumber(Number(v)*100,...)}%`
  :155-161 currency: Intl.NumberFormat(...).format(Number(v))  // formats NaN as "$NaN"
  :183-191 formatNumber: n.toLocaleString(...)        // no NaN guard
render.ts:412-417 stringify returns the string / String(number) unchanged, so the literal NaN/Infinity text reaches the page.

Node verification of the exact bodies:
  number => "NaN"; percent => "NaN%"; currency => "$NaN"; non-numeric str => "NaN"; stringify(5/0) => "Infinity"; stringify(5%0) => "NaN".

Fix: guard isNaN/!isFinite in formatNumber, the percent/currency pipes, and/or stringify, returning "" (Angular-like) for non-finite values.
```
- **evidence:**
```
Node repro of the exact pipe bodies: Number(undefined) number-pipe => "NaN"; percent => "NaN%"; currency => "$NaN"; 5/0 stringify => "Infinity"; 5%0 stringify => "NaN". expr.ts:153 `number: (v,a)=>formatNumber(Number(v),...)`, :154 percent, :155-161 currency all coerce with Number(v) and have no NaN guard.
```
- **independent verification:**
```
Verified against the cited source. ui/.sprig/compiler/expr.ts:153 `number: (v,a)=>formatNumber(Number(v),...)`, :154 percent `${formatNumber(Number(v)*100,...)}%`, and :155-161 currency `Intl.NumberFormat(...).format(Number(v))` all coerce with Number(v) and have no NaN guard. formatNumber (expr.ts:183-191) calls n.toLocaleString with no guard either — toLocaleString(NaN) yields "NaN". The pipe results are strings, and render.ts stringify (412-417) returns the string as-is, so "NaN"/"NaN%"/"$NaN" render directly into the HTML. For numeric expressions, stringify falls to `String(v)` (line 416), so 5/0 -> "Infinity" and 5%0 -> "NaN" also leak literally into interpolations. I reproduced the exact bodies in Node: Number(undefined) through the number pipe => "NaN"; percent => "NaN%"; currency => "$NaN"; non-numeric string => "NaN"; stringify(5/0) => "Infinity"; stringify(5%0) => "NaN". This is a genuine, reachable rendering defect (any template binding an absent/non-numeric field through these pipes), not intended behavior — Angular's number/currency pipes throw a dev-time error or render gracefully rather than leaking literal NaN to production output. Severity low is correct: cosmetic/data-quality, no crash or security impact.
```

### 82. percent pipe uses the number default maxFraction=3 instead of Angular's '1.0-0', emitting extra fraction digits
- **severity:** low  ·  **category:** correctness
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts pipes + render.ts)
- **location:** `ui/.sprig/compiler/expr.ts:154 (percent pipe) -> expr.ts:183-191 (formatNumber default maxFrac=3)`
- **expected:** "12%" (Angular percent default rounds to 0 fraction digits).
- **actual:** "12.345%": percent inherits formatNumber's number-default maxFrac=3, so an unformatted percent shows up to 3 fraction digits instead of 0.
- **repro:**
```
Source: ui/.sprig/compiler/expr.ts:154 (percent pipe) and expr.ts:183-191 (formatNumber, default maxFrac=3 at line 185).

Reproduce the divergence directly:
  node -e '
  function formatNumber(n, fmt) {
    let minFrac = 0, maxFrac = 3;
    if (fmt) { const m = fmt.match(/^\d+\.(\d+)-(\d+)$/); if (m) { minFrac = +m[1]; maxFrac = +m[2]; } }
    return n.toLocaleString("en-US", { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
  }
  const percent = (v, a) => `${formatNumber(Number(v) * 100, a[0])}%`;
  console.log(percent(0.12345, []));  // prints "12.345%"
  '

Template form: author {{ 0.12345 | percent }} (no digitsInfo).
  Sprig actual:   "12.345%"
  Angular expect: "12%"   (PercentPipe default digitsInfo '1.0-0')

Also reachable via the repo's fixtures/golden.html:259 `{{ ratio | percent }}` with ratio=0.1234 (compiler.test.ts:24) -> sprig "12.34%" vs Angular "12%".

Fix: give percent its own default of '1.0-0' (maxFrac=0), e.g. pass a percent-specific default to formatNumber rather than reusing the number default.
```
- **evidence:**
```
formatNumber(0.12345*100, undefined) => "12.345" (ran verbatim function); expr.ts:185 sets maxFrac=3 as the only default for every caller including percent.
```
- **independent verification:**
```
Verified against the verbatim source in ui/.sprig/compiler/expr.ts. The percent pipe (line 154) is `(v, a) => `${formatNumber(Number(v) * 100, a[0])}%``. With no digitsInfo arg, it calls formatNumber with fmt=undefined, which falls into the default branch at line 185 setting minFrac=0, maxFrac=3. That maxFrac=3 is the DecimalPipe/number default, NOT the PercentPipe default.

Angular's PercentPipe documents a default digitsInfo of '1.0-0' (minInt=1, minFrac=0, maxFrac=0), so it rounds to zero fraction digits.

I ran the verbatim functions in node: percent(0.12345, []) => "12.345%" and formatNumber(0.12345*100, undefined) => "12.345". Angular would produce "12%". This matches the claim exactly.

Reachability confirmed: the pipe is wired through render.ts (evalExpr -> pipe_expression -> evalPipe -> PIPES.percent) and the exact unformatted form is used in the repo's own fixtures: fixtures/golden.html:259 `{{ ratio | percent }}` with ratio=0.1234 (compiler.test.ts:24). Sprig renders "12.34%"; Angular renders "12%".

Severity low is correct: cosmetic formatting divergence from Angular on the uncommon no-digitsInfo case; no crash, no data loss. The formatted form (e.g. `percent:'1.0-0'`) works correctly, so authors who specify digitsInfo are unaffected.
```

### 83. formatNumber ignores minIntegerDigits even when a full digitsInfo is supplied
- **severity:** low  ·  **category:** correctness
- **area:** Template expression interpreter (ui/.sprig/compiler/expr.ts pipes + render.ts)
- **location:** `ui/.sprig/compiler/expr.ts:183-191 (formatNumber)`
- **expected:** "005.0" (minIntegerDigits=3 pads the integer part).
- **actual:** "5.0": the captured minInt group (the leading \d+) is never passed to toLocaleString (no minimumIntegerDigits option), so the integer-padding component of digitsInfo is silently dropped.
- **repro:**
```
Author a template binding: {{ 5 | number:'3.1-5' }}. Or run the verbatim function: node -e on formatNumber from expr.ts:183-191 with formatNumber(5,'3.1-5') yields "5.0"; Angular yields "005.0". The leading \d+ (minIntegerDigits=3) is matched but never captured/applied at the toLocaleString call (expr.ts:190).
```
- **evidence:**
```
formatNumber(5,'3.1-5') => "5.0" (ran verbatim function); expr.ts:187-188 only reads m[1]/m[2] (frac digits) and discards the integer-digits group at toLocaleString call expr.ts:190.
```
- **independent verification:**
```
Verified against the verbatim source at /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/expr.ts:183-191. The regex `/^\d+\.(\d+)-(\d+)$/` matches the leading minIntegerDigits as a non-capturing `\d+`, then only reads m[1]/m[2] (minFrac, maxFrac). The toLocaleString call at line 190 passes only minimumFractionDigits/maximumFractionDigits and never sets minimumIntegerDigits. Running the exact function verbatim, formatNumber(5,'3.1-5') returns "5.0". Angular's DecimalPipe/number pipe with digitsInfo '3.1-5' documents minIntegerDigits=3 and produces "005.0". So the integer-padding component of digitsInfo is silently discarded — a real divergence from documented Angular semantics. It is a genuine, reproducible correctness defect (not unreachable: the format string is user-authored in templates and is parsed). Severity is low because the common '1.x-y' patterns are unaffected; only formats with minInt > 1 are wrong. Fix: capture the integer group and pass minimumIntegerDigits.
```

### 84. :host used inside a compound selector (`:host.x`, `:host[attr]`, `:host:hover`) gets the scope attribute applied twice, emitting redundant/duplicated markers
- **severity:** low  ·  **category:** correctness
- **area:** View encapsulation / CSS selector scoper (ui/.sprig/compiler/scope.ts)
- **location:** `ui/.sprig/compiler/scope.ts:95 (`:host` global-replaced to the token mid-compound) interacting with the insertToken already-scoped guard at scope.ts:118 (only `compound === token || compound.endsWith(token)`)`
- **expected:** A `:host`-anchored compound should carry the scope marker exactly once, e.g. `:host.active` => `[sAAAA].active`.
- **actual:** scopeCss(`:host.active{}`) => `[sAAAA].active[sAAAA]{}`; scopeCss(`:host[dir="rtl"]{}`) => `[sAAAA][dir="rtl"][sAAAA]{}`; scopeCss(`:host:hover{}`) => `[sAAAA][sAAAA]:hover{}`. The marker is duplicated. It still matches the same element so it is not a leak, but it is incorrect/redundant output (and shows the host-in-compound path is mishandled).
- **repro:**
```
deno eval 'import { scopeCss } from "./ui/.sprig/compiler/scope.ts";
for (const css of [":host.active { color: red }", ":host[dir=\"rtl\"]{}", ":host:hover{}"]) {
  console.log(JSON.stringify(css), "=>", JSON.stringify(scopeCss(css, "sAAAA")));
}'

Run from repo root /Users/raphaelcastro/Documents/programming/sprig. Actual output:
  ":host.active { color: red }" => "[sAAAA].active[sAAAA] { color: red }"
  ":host[dir=\"rtl\"]{}"        => "[sAAAA][dir=\"rtl\"][sAAAA] {}"
  ":host:hover{}"               => "[sAAAA][sAAAA]:hover {}"
Expected (marker once): "[sAAAA].active", "[sAAAA][dir=\"rtl\"]", "[sAAAA]:hover".
```
- **evidence:**
```
Observed output: `":host.active { color: red }" => "[sAAAA].active[sAAAA] { color: red }"`, `":host:hover { color: red }" => "[sAAAA][sAAAA]:hover { color: red }"`. Cause: line 95 turns `:host` into `[sAAAA]` in the middle of the key compound; insertToken (scope.ts:114-124) then sees a compound that contains but does not END with the token (its endsWith guard at line 118 fails), so it inserts the token again.
```
- **independent verification:**
```
Verified by direct reproduction against /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts. Observed output exactly matches the claim:
  ":host.active { color: red }" => "[sAAAA].active[sAAAA] { color: red }"
  ":host[dir=\"rtl\"]{}"        => "[sAAAA][dir=\"rtl\"][sAAAA] {}"
  ":host:hover{}"               => "[sAAAA][sAAAA]:hover {}"
(For comparison, the correctly-handled cases ":host{}" => "[sAAAA] {}" and ":host(.x){}" => "[sAAAA].x {}" emit the marker once.)

Root cause trace for ":host.active":
- scopeSelector: line 91 (sel === ":host") and line 92-93 (^:host\(...\)$) do not match.
- Line 95: `.replace(/:host\b/g, token)` turns ":host.active" into "[sAAAA].active". The token is now MID-compound, not at the end.
- keyStart loop (97-108): no top-level combinator, so keyStart=0; the whole "[sAAAA].active" is the key compound passed to insertToken.
- insertToken (114-124): line 118 guard `compound === token || compound.endsWith(token)` is the only protection against re-scoping a host-derived compound. "[sAAAA].active" does not equal the token and ends with ".active", not "[sAAAA]", so the guard FAILS. The pseudo-finding regex /::?[\w-]/ finds no ":" so it falls through to `compound + token` => "[sAAAA].active[sAAAA]". Duplicate.
- For ":host:hover" => "[sAAAA]:hover", the regex finds the ":" at index 7 and inserts the token before it => "[sAAAA][sAAAA]:hover". Duplicate.

The cited cause (line 95 placing the token mid-compound + the endsWith-only guard at line 118) is accurate. It is a genuine defect, not intended behavior: the comparable :host paths emit the marker exactly once, and the doubled output is plainly unintended.

Impact is low: the duplicated attribute selector still matches the same element (no style leak / encapsulation break). The only real-world side effect is slightly inflated specificity (two [sAAAA] selectors), which is cosmetically wrong and could in rare edge cases nudge cascade ordering between competing :host and :host.x rules. Hence severity = low, matching the claim.
```

### 85. insertToken corrupts class names containing an escaped colon (.foo\:bar) by inserting the scope attribute inside the escape sequence
- **severity:** low  ·  **category:** rendering
- **area:** View encapsulation — CSS selector scoper (ui/.sprig/compiler/scope.ts)
- **location:** `ui/.sprig/compiler/scope.ts:120-123 (insertToken: `const m = compound.match(/::?[\w-]/)`)`
- **expected:** An escaped colon in a class name (`.foo\:bar`, a valid way to write a class literally named `foo:bar`, common with Tailwind-style utility names) is part of the class, not a pseudo. The scope attribute should be appended AFTER the whole compound: `.foo\:bar[sXX]`.
- **actual:** Output is `.foo\[sXX]:bar { x:1 }`. The pseudo-detector regex `/::?[\w-]/` matches the escaped `:b` (the literal colon in the class name) at index 5 and inserts the token there, splitting the escape sequence. The emitted `\[sXX]` now escapes the `[`, so the attribute selector is destroyed and the class name is mangled — the rule no longer matches the intended element and emits broken CSS into the shared app.css.
- **repro:**
```
From repo root (/Users/raphaelcastro/Documents/programming/sprig):

/opt/homebrew/bin/deno eval "import { scopeCss } from './ui/.sprig/compiler/scope.ts'; console.log(scopeCss('.foo\\\\:bar { color:red }', 'sXX'));"

Observed output:  .foo\[sXX]:bar { color:red }
Expected output:  .foo\:bar[sXX] { color:red }

The scope attribute is inserted inside the `\:` escape sequence; the backslash then escapes the inserted `[`, destroying the attribute selector and corrupting the class name. Root cause: scope.ts:120 `compound.match(/::?[\w-]/)` does not skip backslash-escaped characters when finding the first pseudo.
```
- **evidence:**
```
deno eval output: `escaped colon in class\n  OUT: .foo\[sXX]:bar { color: red }`. Direct regex check: `(".foo\\:bar").match(/::?[\w-]/)` => `[":b"]` index 5. insertToken (scope.ts:120-122) does not skip backslash-escaped characters when locating the first pseudo.
```
- **independent verification:**
```
Verified against /Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts. insertToken (lines 114-124) locates the first pseudo via `const m = compound.match(/::?[\w-]/)` and inserts the scope token at that index. This regex does not skip backslash-escaped characters, so for the compound `.foo\:bar` it matches the literal escaped colon `:b` at index 5 (the `:` is part of the class name `foo:bar`, escaped with `\`, not a pseudo). The token is inserted there, splitting the `\:` escape sequence. The emitted backslash then escapes the inserted `[`, destroying the attribute selector and mangling the class. I reproduced it: scopeCss('.foo\\:bar { color:red }', 'sXX') returns `.foo\[sXX]:bar { color:red }` instead of the correct `.foo\:bar[sXX]`. I also confirmed the regex behavior directly (`.foo\:bar`.match(/::?[\w-]/) => [':b'] at index 5) and confirmed normal cases are unaffected: `.foo:hover` correctly yields `.foo[sXX]:hover` and `.foobar` yields `.foobar[sXX]`. This is a genuine correctness defect (not intended behavior) that emits broken/mangled CSS. Escaped colons in class names are valid CSS and are how Tailwind-style utility class literals (e.g. a class literally named `foo:bar`) are written, so the input is realistic, though authoring escaped colons in component styles.css is uncommon — hence low severity, matching the report.
```

### 86. Unbounded growth of the `live` island array — dev HMR memory leak across soft-navigations
- **severity:** low  ·  **category:** resource-leak
- **area:** dev/HMR server (ui/.sprig/compiler/dev.ts, hmr.ts, hydrate.ts)
- **location:** `ui/.sprig/compiler/hydrate.ts:48,176-230 (push at :219; no removal anywhere)`
- **expected:** When an island element is removed from the document (its outlet innerHTML is replaced during soft-nav), its entry in the `live` registry should be removed so the array size tracks the number of currently-mounted islands.
- **actual:** `live` only ever grows (the only mutation is `live.push(...)` at hydrate.ts:219; there is no splice/filter/delete in the file). Orphaned entries leak HTMLElement + scope/closures for the lifetime of the tab. `hotTemplate` (hydrate.ts:59) guards with `document.contains(i.el)` so dead entries don't break correctness, but it iterates ALL of them on every template save — work and retained memory grow linearly with navigations.
- **repro:**
```
Preconditions: dev/HMR build (SPRIG_DEV=1, `sprig dev`), a browser that exposes the Navigation API (globalThis.navigation), and at least one /ui route under cfg.base that mounts an island inside <sprig-outlet>.

1. Load a /ui page that mounts an island. startHmr() calls enableHmr() before bootstrap, so hydrateIsland pushes an entry into `live` (hydrate.ts:219). At this point `live.length === 1`.
2. Soft-navigate to another /ui page that also mounts an island (e.g. /ui -> /ui/board). The navigate handler's swap runs `cur.innerHTML = next.innerHTML` (hydrate.ts:162), detaching the first island's element, then `bootstrapIslands(cfg, cur)` re-hydrates the new island and pushes a second entry. `live.length === 2` even though only one island is currently mounted.
3. Navigate back, then repeat the round trip N times. After N soft-navs `live.length` is ~N+1 while the document contains only the current island(s).

Observe in the console: evaluate the module-internal `live` array length (or instrument hydrate.ts) before and after navigations — it only ever increases; it never shrinks when an island leaves the document. Confirm via grep that the only mutation site is `live.push` at hydrate.ts:219 and there is no removal:
  grep -n "live" ui/.sprig/compiler/hydrate.ts
Each orphaned entry retains its detached `el` and the swap() closure (scope/signals/nodes), and hotTemplate (hydrate.ts:59) iterates all of them on every template save.
```
- **evidence:**
```
hydrate.ts:48 `const live: LiveIsland[] = [];` is appended to only at hydrate.ts:219 inside `if (hmrEnabled && tick)`; grep for `live.` over hydrate.ts shows `live.push` and `for (const i of live)` (hotTemplate) as the only uses — no removal. Soft-nav discards islands via `cur.innerHTML = next.innerHTML` (hydrate.ts:162) without notifying the registry.
```
- **independent verification:**
```
Verified by reading the cited code and grepping all uses of `live` in ui/.sprig/compiler/hydrate.ts.

- Line 48: `const live: LiveIsland[] = [];`
- Line 219: `live.push({ sel, el, swap })` — the ONLY mutation, gated by `if (hmrEnabled && tick)` (line 218).
- Line 59: `for (const i of live) if (i.sel === sel && document.contains(i.el)) i.swap(template);` — read-only iteration in `hotTemplate`.

A grep over the file confirms these are the only three references to `live` (other matches are the word "live" in comments). There is no splice/filter/delete/pop anywhere, so the array is append-only.

Reachability of the leak:
- HMR mode is turned on by startHmr() -> enableHmr() (hmr.ts:20), which runs before islands hydrate in dev, so each hydrated island pushes an entry.
- setupSoftNav (hydrate.ts:139-173) intercepts same-origin /base navigations via the Navigation API. Its swap (line 161-165) executes `cur.innerHTML = next.innerHTML` (line 162), which detaches the previously-mounted island elements from the document, then calls `bootstrapIslands(cfg, cur)` (line 163). bootstrapIslands -> scheduleLoad -> loadIsland -> hydratePending -> hydrateIsland re-hydrates the fresh DOM and pushes a NEW LiveIsland entry (line 219). The old entry is never removed.
- Result: `live.length` grows by one per island per soft-nav, retaining the orphaned HTMLElement plus the swap() closure (which closes over `scope`/signals/nodes) for the tab's lifetime.

Correctness is NOT broken: hotTemplate guards each entry with `document.contains(i.el)` (line 59), so detached/dead islands are skipped during a template swap. The cost is (a) retained memory for orphaned elements and their reactive scopes, and (b) O(total-mounts) iteration on every template save instead of O(currently-mounted).

This is a genuine resource leak, not intended behavior — but it is strictly dev-only (the push is gated on hmrEnabled, which prod never sets), requires the Navigation API plus repeated soft-navs, and never affects correctness. Hence low severity, as the report states. The report's locations, line numbers, and mechanism all check out exactly.
```

### 87. `fetchAst` does not URL-encode the selector, mismatching the server's decodeURIComponent
- **severity:** low  ·  **category:** correctness
- **area:** dev/HMR server (ui/.sprig/compiler/dev.ts, hmr.ts, hydrate.ts)
- **location:** `ui/.sprig/compiler/hydrate.ts:64-66 (fetch URL built with raw `sel`) vs ui/.sprig/compiler/dev.ts:103 (decodeURIComponent on the path)`
- **expected:** The client should `encodeURIComponent(sel)` so it round-trips through the server's `decodeURIComponent`, and both sides agree on the registry key.
- **actual:** Client sends the raw selector; server decodes. For a selector containing '%' the server's decodeURIComponent would mangle or throw (malformed percent-encoding -> URIError -> 500 from the dev fetch handler); '#' would truncate the request path entirely. Selectors are normally kebab idents so this is latent, but the encode/decode pair is asymmetric and unsafe for the general case the code claims to support.
- **repro:**
```
Static reproduction (no running server needed):

1. ui/.sprig/compiler/hydrate.ts:65 — `return await fetch(`${base}/_sprig/ast/${sel}`).then((r) => r.json());` — `sel` is interpolated raw, no `encodeURIComponent`.
2. ui/.sprig/compiler/dev.ts:103 — `const ast = cfg.renderer.astFor(decodeURIComponent(path.slice(astPrefix.length)));` — unconditional decode, inside a handler (dev.ts:84-108) with no try/catch.
3. The selector is `basename(dir)` of the component folder (ui/.sprig/compiler/mod.ts:41, build.ts:43) with no kebab/ident validation.

Confirm the throw: run `node -e 'decodeURIComponent("%")'` → `URIError: URI malformed`. Because that throw is uncaught in dev.ts's fetch handler, a folder/selector containing `%` (e.g. `pct%foo`) would make `GET /ui/_sprig/ast/pct%foo` throw on the server (500), and a `#` would truncate the request path. For any selector needing escaping, the missing client-side `encodeURIComponent` and the present server-side `decodeURIComponent` disagree on the registry key.

Fix: client should `encodeURIComponent(sel)` in fetchAst so it round-trips through the server's decode; defensively, wrap the decode in dev.ts:103 in try/catch and return 400/404 on URIError.
```
- **evidence:**
```
hydrate.ts:65 `fetch(\`${base}/_sprig/ast/${sel}\`)` — no encodeURIComponent. dev.ts:103 `cfg.renderer.astFor(decodeURIComponent(path.slice(astPrefix.length)))` — unconditional decode, and an invalid percent sequence makes decodeURIComponent throw, which is not caught in the fetch handler (dev.ts:84-108).
```
- **independent verification:**
```
The cited code is exactly as described. ui/.sprig/compiler/hydrate.ts:64-65 builds the dev chunk's AST request as `fetch(`${base}/_sprig/ast/${sel}`)` with the raw selector and NO `encodeURIComponent`. The dev server in ui/.sprig/compiler/dev.ts:102-103 matches `path.startsWith(astPrefix)` and unconditionally calls `cfg.renderer.astFor(decodeURIComponent(path.slice(astPrefix.length)))`. The encode/decode pair is therefore asymmetric: encode is missing on the client, decode is present on the server.

I confirmed the claimed consequences:
- `decodeURIComponent("%")` throws `URIError: URI malformed` (verified by running node). The dev fetch handler (dev.ts:84-108) has no try/catch around line 103, so a selector whose raw form contains an invalid percent sequence would make the handler throw rather than return a Response — i.e. a 500-class failure on that dev request, and the island's AST fetch (hydrate.ts:65) would reject.
- A `#` in the path would be parsed by the browser as a fragment and truncate the request path, so the server would look up a different/empty key and return 404 (dev.ts:106). A space would be sent as-is and `decodeURIComponent` leaves it unchanged, so `astFor(" name")` wouldn't match the registry key.

The selector is the raw folder basename (mod.ts:41 `basename(dir)`, build.ts:43/128) with NO validation that it is a kebab identifier — the "selectors are kebab idents" claim lives only in comments (hydrate.ts:252), nothing enforces it. So the code genuinely does support arbitrary folder names as keys while the encode/decode contract is broken for any key needing escaping.

Why this is real but only low/info severity: for every normal kebab selector (e.g. `my-counter`), both `encodeURIComponent` and `decodeURIComponent` are no-ops, so the round-trip is identical and there is no observable bug. The defect is purely latent — it requires a component folder literally named with a URL-significant character (`%`, `#`, space), which is unusual on a filesystem and contrary to every convention in this codebase, AND it only affects the dev/HMR server, never production (prod chunks bake the AST inline, build.ts:78, and never call fetchAst). It is a correct, reproducible asymmetry/correctness nit, not an actively-exercised crash.
```

### 88. /api prefix strip reaches the /docs Swagger UI, duplicating the docs surface under the API channel
- **severity:** low  ·  **category:** protocol
- **area:** serveSprig dispatch + /api prefix stripping (packages/keep/mod.ts)
- **location:** `packages/keep/mod.ts:90-93 (the /api strip branch forwards the stripped path into the SAME config.keep.handler that also routes /docs at :96-97)`
- **expected:** The /api/* channel is documented (mod.ts:60-65) as the token-gated NETWORK API channel that forwards a path-STRIPPED request to keep's API routes. A request to /api/docs should resolve to the keep API route /docs (an API endpoint named 'docs', if any) or 404 — it should NOT serve the human-facing Swagger/OpenAPI documentation UI, which has its own dedicated prefix at /docs (handled separately at mod.ts:96-97).
- **actual:** Because the /api branch strips '/api' off the path and hands the result ('/docs', '/docs/_map', '/docs/') to the very same config.keep.handler that the /docs branch uses, the keep handler internally routes the stripped '/docs' to the Swagger UI. The entire documentation surface is therefore silently duplicated/aliased under /api/docs, /api/docs/_map and /api/docs/. This is a prefix-collision: two dispatch branches (api-strip and docs) share one underlying handler whose own routing table still contains /docs, so the api channel leaks the docs channel. In a deployment where /api is meant to be the only externally-reachable, token-gated surface (and /docs is firewalled/internal), this alias re-exposes the full OpenAPI spec and Swagger UI through the API channel — an info-exposure / channel-isolation break. Severity is low here only because this particular app leaves both /api and /docs unauthenticated.
- **repro:**
```
Against the running server (deno serve -A --unstable-kv --port 8200 serve.ts):

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8200/api/docs        # -> 200
curl -s http://localhost:8200/api/docs | grep -o '<title>[^<]*</title>'        # -> <title>API Documentation</title>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8200/api/docs/_map   # -> 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8200/api/docs/        # -> 200
# byte-identical to the direct docs channel:
[ "$(curl -s http://localhost:8200/api/docs/_map|md5)" = "$(curl -s http://localhost:8200/docs/_map|md5)" ] && echo IDENTICAL  # -> IDENTICAL
# contrast: a route that does NOT live in keep is not aliased:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8200/api/ui          # -> 404

Source: packages/keep/mod.ts:90-93 (api strip -> config.keep.handler) and mod.ts:96-97 (/docs -> same config.keep.handler). Fix direction: after stripping /api, reject/404 paths that resolve to keep's docs prefix, or route /api/* to an api-only sub-handler that excludes the /docs router.
```
- **evidence:**
```
Live server (port 8200): GET /api/docs -> 200 with body containing '<title>API Documentation</title>'; GET /api/docs/_map -> 200 returning the same swagger map HTML as the direct /docs/_map. Source: packages/keep/mod.ts:90-93 sets stripped.pathname = path.slice(apiPrefix.length) and calls config.keep.handler(...); mod.ts:96-97 calls the identical config.keep.handler for /docs. Both branches funnel into one handler whose router still matches /docs, so /api/docs == /docs. For contrast /api/ui -> 404 (keep has no /ui route), proving the alias only surfaces routes that genuinely live inside the keep handler (i.e. /docs).
```
- **independent verification:**
```
Reproduced against the live server (deno serve --port 8200 serve.ts, i.e. the real serveSprig composition from packages/keep/mod.ts). The cited mechanism is exactly correct:

- mod.ts:90-93 — the /api branch strips apiPrefix: stripped.pathname = path.slice(apiPrefix.length) || "/" and forwards into config.keep.handler.
- mod.ts:96-97 — the /docs branch forwards the UNSTRIPPED path into the SAME config.keep.handler.

Because both branches funnel into one keep handler whose internal router still matches /docs, a request to /api/docs is stripped to /docs and the keep router serves the Swagger UI. Verified:
- GET /api/docs -> 200, body <title>API Documentation</title> (identical title to direct GET /docs).
- GET /api/docs/_map -> 200; md5 of /api/docs/_map body == md5 of /docs/_map body (byte-identical, 92d18b79c20dd6da6b94897467c20878).
- GET /api/docs/ -> 200.
- Contrast GET /api/ui -> 404 (keep has no /ui route), confirming the alias only surfaces routes that actually live in the keep handler — i.e. /docs is genuinely leaking through the api-strip branch.

This is a genuine, reproducible prefix-collision: the two dispatch branches share one underlying handler, so the api channel aliases the docs channel. It is NOT intended — the docstring (mod.ts:60-65) frames /api/* as the API channel and /docs* as the separate Swagger channel; serving the human Swagger UI through /api/docs is not a design goal.

Severity correction: the report's own 'low' is right, but I downgrade the security framing. The claimed channel-isolation/info-exposure break only bites in a hypothetical deployment where /docs is firewalled while /api is exposed. In this actual app neither channel is authenticated (I could not even observe token gating: /api and /api/ return 404 'no route', not 401), and /docs is already openly reachable, so /api/docs exposes nothing that /docs doesn't. The real defect is a routing/aliasing wart (duplicated docs surface, semantically wrong responses on the API channel), not a privilege/isolation escalation in this configuration. Low is appropriate.
```


## INFO severity

### 89. Unknown/extra JSON fields are silently accepted (no forbidNonWhitelisted) on issue/user input DTOs
- **severity:** info  ·  **category:** validation
- **area:** API input validation on POST /api/http/issue and /api/http/user (RuneAssert->422 seam, not-found path, extra-field handling)
- **location:** `backend/src/board/dto/issue-ref.ts:12-18 (IssueRefDto: only @IsString() on issueId, no @ApiExtraModels/whitelist); backend/src/board/dto/user-ref.ts:12-18; consumed by the assert seam at backend/src/board/domain/coordinators/issue-get/mod.ts:15`
- **expected:** With a strict input contract, unexpected/unknown top-level fields should either be rejected (422, forbidNonWhitelisted) or at minimum stripped; payloads carrying reserved keys like __proto__/constructor should be handled deliberately.
- **actual:** Extra fields (including __proto__ and constructor.prototype) are accepted and the request returns 200. No prototype pollution of Object.prototype was observed in follow-up requests (the underlying object construction appears safe), and the extra field is not reflected in the response, so impact is limited to a permissive contract / lack of input hardening rather than an exploitable pollution.
- **repro:**
```
Server running on :8200 (cwd repo root).

# 1) Extra field accepted (200) and NOT reflected:
curl -s -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' -d '{"issueId":"SPR-101","extra":"LEAK12345"}' | grep -c LEAK12345
#   -> 0  (request returns 200, value not echoed)

# 2) Reserved keys accepted (200), no pollution:
curl -s -o /dev/null -w '[%{http_code}]\n' -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' -d '{"issueId":"SPR-101","__proto__":{"polluted":true}}'           # [200]
curl -s -o /dev/null -w '[%{http_code}]\n' -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' -d '{"issueId":"SPR-101","constructor":{"prototype":{"x":1}}}'    # [200]
curl -s -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' -d '{"issueId":"SPR-101"}' | grep -c 'polluted\|injectedField'        # -> 0  (Object.prototype clean)

# Control: the assert seam DOES validate types/required:
curl -s -o /dev/null -w '[%{http_code}]\n' -X POST http://localhost:8200/api/http/issue -H 'content-type: application/json' -d '{"issueId":123}'   # [422] RuneAssertError

# Same permissive behavior on /api/http/user (userId field).
```
- **evidence:**
```
Live: POST {"issueId":"SPR-101","extra":"LEAK"} -> 200 and grep for 'LEAK' in response found nothing (not reflected). POST {"issueId":"SPR-101","__proto__":{"polluted":"yes"}} -> 200; POST {"issueId":"SPR-101","constructor":{"prototype":{"x":1}}} -> 200; subsequent requests showed no Object.prototype contamination. DTO source shows only @IsString() with no whitelist enforcement.
```
- **independent verification:**
```
Verified against the running server on :8200 by reading the cited code and reproducing live.

CODE (confirmed):
- backend/src/board/dto/issue-ref.ts:12-18 and user-ref.ts:12-18 declare only @ApiProperty + @IsString() on the single field (issueId / userId). There is no whitelist, forbidNonWhitelisted, or @ApiExtraModels strictness.
- backend/src/board/domain/coordinators/issue-get/mod.ts:15 runs assert(IssueRefDto, input, ...) at the seam. The seam IS active: I confirmed missing/wrong-type issueId returns 422 RuneAssertError (e.g. {"issueId":123} and {"nope":"x"} both -> 422 "issueId must be a string"). So validation runs; it simply does not reject unknown properties.

LIVE REPRO (matches the report exactly):
- {"issueId":"SPR-101","extra":"LEAK12345"} -> 200; grep for LEAK12345 in the response = 0 occurrences (NOT reflected).
- {"issueId":"SPR-101","extra":"x","__proto__":{"polluted":true}} -> 200.
- {"issueId":"SPR-101","constructor":{"prototype":{"polluted":"yes"}}} -> 200.
- /api/http/user with {"userId":"ada","extra":"x","__proto__":{"a":1}} -> 200.

NO EXPLOITABLE IMPACT (verified, not assumed):
- After the __proto__/constructor injection attempts, a clean follow-up {"issueId":"SPR-101"} request returned 200 and contained 0 pollution markers (injectedField/isAdmin/PWNED). Object.prototype is NOT polluted -- V8 JSON.parse treats __proto__ as a normal own key and the coordinator only reads input.issueId; the object is never deep-merged into a shared prototype.
- The one 500 observed ({"issueId":"SPR-PWN",...}) is unrelated to pollution: the same id without __proto__ returns 500 {"message":"no issue with id \"SPR-PWN\""}, i.e. an ordinary unknown-id error.

CONCLUSION: This is a genuine, reproducible defect in the literal sense the report frames it -- the input contract is permissive (unknown top-level fields are silently accepted rather than rejected via forbidNonWhitelisted or stripped via whitelist). However there is no security or correctness consequence: extra fields are not reflected, not persisted, and cause no prototype pollution. It is purely a lack of input hardening / strictness on a contract. Hence real=true with severity downgraded to info (the report's 'low' overstates it given confirmed zero impact).
```

### 90. Lazy-load in-flight set ('loading') is never cleared on successful import — permanent per-selector leak
- **severity:** info  ·  **category:** resource-leak
- **area:** Client hydration runtime (ui/.sprig/compiler/hydrate.ts + render.ts handler emission)
- **location:** `ui/.sprig/compiler/hydrate.ts:121-133 (loadIsland) and :71-74 (registerIsland)`
- **expected:** After a successful load, `sel` is removed from the `loading` set (it is no longer in flight), symmetric with the .catch path that does loading.delete(sel).
- **actual:** loading.delete(sel) exists ONLY in the .catch (line 130). On success, registerIsland (lines 71-74) sets the registry and hydrates but never touches `loading`, so every successfully-loaded selector stays in the `loading` set for the lifetime of the page. The set grows once per distinct island selector and is never drained. Practical impact is limited because loadIsland short-circuits on registry.has(sel) before consulting `loading`, so the stale entry does not block re-hydration; it is a small unbounded-by-selector leak / broken invariant rather than a functional break.
- **repro:**
```
Static trace of ui/.sprig/compiler/hydrate.ts:

1. loadIsland (line 121): on first trigger, registry.has(sel) is false, loading.has(sel) is false, so it runs loading.add(sel) (line 127) and import()s the chunk.
2. The chunk executes registerIsland(sel, entry) (lines 71-74): registry.set(sel, entry); hydratePending(sel). It never calls loading.delete(sel).
3. Inspect the `loading` Set afterward: sel is still present. The only loading.delete is in the .catch path (line 130), reachable only on import failure.
4. Confirm it is inert: a later loadIsland(sel) call hits registry.has(sel) === true at line 122 and returns at line 123, never reaching the loading.has check at line 126 — so the stale entry blocks nothing.

Result: one stale string per distinct island selector accumulates in `loading`; bounded by the number of island types; no functional effect.
```
- **evidence:**
```
hydrate.ts:127 `loading.add(sel)`; :129-132 import().catch removes only on failure; registerIsland at :71-74 has no loading.delete. The success path through registerIsland never clears the set.
```
- **independent verification:**
```
Verified by reading ui/.sprig/compiler/hydrate.ts. The asymmetry is real and exactly as described:

- Line 127: loadIsland does loading.add(sel) before the dynamic import().
- Lines 129-132: the .catch handler calls loading.delete(sel) ONLY on failure.
- On success the chunk calls registerIsland(sel, entry) (lines 71-74), which does registry.set(sel, entry) + hydratePending(sel) and never touches the loading set.

So a successfully-loaded selector remains in `loading` for the page lifetime. The claim is accurate on the facts.

However the practical impact is essentially nil, which the report itself acknowledges:
- loadIsland short-circuits on registry.has(sel) at line 122 BEFORE it ever consults loading.has(sel) at line 126. After a successful load registry.has(sel) is true, so every later call returns at line 123 and the stale `loading` entry is never read again. It does not block re-hydration and does not affect the de-dupe purpose (which only matters while an import is genuinely in flight, i.e. before registerIsland runs).
- The growth is NOT unbounded: the set gains at most one short string per DISTINCT island selector, bounded by the fixed number of island types in the app (typically a handful). Calling it an 'unbounded-by-selector leak' overstates it; it is a small, fixed, bounded set of strings.

This is a broken-invariant / dead-symmetry nit with no observable functional, performance, or memory consequence. It is correct that it exists, but it is cosmetic. I therefore confirm real=true but downgrade the claimed severity from 'low' to 'info'. A one-line fix (loading.delete(sel) inside registerIsland) would restore the invariant.
```

### 91. Asset content-type derivation mishandles extensionless filenames
- **severity:** info  ·  **category:** correctness
- **area:** Cross-cutting HTTP correctness (status codes, content-type, headers, SSR document)
- **location:** `packages/keep/mod.ts:46 (serveAsset)`
- **expected:** For a file with no extension the lookup key should be '' so it cleanly falls back to application/octet-stream; for any future single-char handling the key should be deterministic, not the last filename character.
- **actual:** `file.lastIndexOf(".")` is -1 for extensionless names, so `file.slice(-1)` returns the final character (verified via deno eval: 'LICENSE' -> 'E', 'robots' -> 's', 'client' -> 't'). The bogus key never matches ASSET_TYPES, so it happens to fall through to application/octet-stream, but the extension logic is incorrect and would mis-key if a single-character extension entry were ever added; it also means extensionless static files are served as octet-stream with no X-Content-Type-Options:nosniff.
- **repro:**
```
In packages/keep/mod.ts:44, serveAsset computes the extension as:
  const ext = file.slice(file.lastIndexOf("."));
For an extensionless filename served under <base>/_assets/ (e.g. GET /ui/_assets/LICENSE), file.lastIndexOf(".") is -1, so file.slice(-1) returns the final character ("E") instead of "". Verified via deno eval:
  "LICENSE" -> "E"   "robots" -> "s"   "client" -> "t"   "a.js" -> ".js"
The bogus key never matches ASSET_TYPES (all keys begin with "."), so the response falls through to application/octet-stream (mod.ts:47), which is coincidentally the correct content-type for an extensionless file. Net effect today: correct output despite incorrect logic. The defect becomes observable only if a single-character extension key is ever added to ASSET_TYPES. Fix: `const i = file.lastIndexOf("."); const ext = i < 0 ? "" : file.slice(i);`
```
- **evidence:**
```
mod.ts:44 `const ext = file.slice(file.lastIndexOf("."));` and mod.ts:47 `"content-type": ASSET_TYPES[ext] ?? "application/octet-stream"`. deno eval reproduction: file 'LICENSE'.slice('LICENSE'.lastIndexOf('.')) === 'E'.
```
- **independent verification:**
```
The cited code at packages/keep/mod.ts:44 is exactly as claimed: `const ext = file.slice(file.lastIndexOf("."));`. For a filename with no '.', `lastIndexOf(".")` returns -1, so `slice(-1)` returns the LAST CHARACTER of the name rather than an empty string. I reproduced this directly with `deno eval`: "LICENSE" -> "E", "robots" -> "s", "client" -> "t" (while "a.js" -> ".js" works correctly and "x" -> "x" shows the same single-char bug). The code path is reachable: serveSprig.fetch (mod.ts:86-87) routes any request under `<base>/_assets/` to serveAsset.

So the extension-derivation LOGIC is genuinely incorrect — this is a real coding defect, not intended behavior. The correct key for an extensionless file should be "" (empty string).

HOWEVER, the practical impact is essentially nil today, which is why I rate this info/low rather than the claim's framing:
1. No current observable misbehavior. The bogus single-char key (e.g. "E") is never present in ASSET_TYPES (every key there starts with "."), so it falls through to `application/octet-stream` (mod.ts:47). For a genuinely extensionless file, `application/octet-stream` is in fact the correct/expected content-type. So the OUTPUT is currently correct by accident.
2. The bug would only surface as wrong output if a single-character extension entry were ever added to ASSET_TYPES — none exists, and adding one is hypothetical.
3. The report's secondary "no X-Content-Type-Options: nosniff" point is a red herring: serveAsset never sets nosniff for ANY asset (not .js, not .css, not .map), so extensionless files are not specially disadvantaged. That is a separate (non-)issue, not caused by this slice bug.

Verdict: a real but latent correctness flaw with no reproducible incorrect behavior in the current code. Worth a one-line fix (guard lastIndexOf === -1) but it changes no observable output today.
```

### 92. #instantiate scope guard is bypassed for any token already bound/cached on a parent injector — a server-scoped value can be handed to a client-side injector with no scope error
- **severity:** info  ·  **category:** security
- **area:** DI + in-process Backend (ui/.sprig/core.ts, ui/src/services)
- **location:** `ui/.sprig/core.ts:127-128 (early return when #findInstance hits) precedes the scope check at :129-134; #findInstance walks the parent chain at :145-149`
- **expected:** The scope guard (server-only tokens must not be injected on the client) should apply regardless of whether the value is freshly instantiated or inherited from a parent.
- **actual:** The scope check only runs on the cache-miss path. An inherited/bound value (the typical case for the server-only Backend) skips the guard entirely. Today this is not reachable because child injectors (core.ts:122) and the client root (core.ts:153) are never activated, so there is no cross-side parent/child chain — hence info severity — but the moment the dead client/child injector code is wired up, the 'DI never crosses the wire' invariant the Backend token's docstring promises (core.ts:200-212) is silently violable.
- **repro:**
```
Run against /Users/raphaelcastro/Documents/programming/sprig/ui (deno.json import map needed). Create a file in ui/ importing { Injector, Backend } from "./.sprig/core.ts":

  // Control: fresh client injector -> scope gate fires
  const c = new Injector("client", "root");
  try { c.resolve(Backend); } catch (e) { /* throws: scope="server" on the client */ }

  // Bug: parent has Backend bound, client child resolves it -> NO throw
  const root = new Injector("client", "root");
  root.provide(Backend, { fetch, get: async () => ({ ok: true, status: 200 }) });
  const child = root.child("component");
  const v = child.resolve(Backend); // returns the value; scope guard bypassed

Observed: control throws `Cannot inject sprig:Backend (scope="server") on the client.`; bug case returns the BackendClient object with no error. Confirms #instantiate (core.ts:127-128) returns the inherited instance before the scope check at core.ts:129-134. Latent only because Injector.child()/clientRoot() are never called in the current app.
```
- **evidence:**
```
core.ts:127 `const existing = this.#findInstance(key);` then :128 `if (existing !== undefined) return existing` returns before the :129 scope check. #findInstance recurses into this.parent (:148), so a value provided on root is visible to a hypothetical client-side child without re-running the guard.
```
- **independent verification:**
```
The cited code matches the claim exactly. In ui/.sprig/core.ts, Injector.#instantiate (lines 126-144) calls this.#findInstance(key) at line 127 and returns at line 128 if a value exists, BEFORE the scope check at lines 129-134. #findInstance (lines 145-149) recurses into this.parent, so any value cached/bound on an ancestor is returned without the scope gate ever running. The guard only runs on the cache-miss path.

I reproduced this at runtime (deno run against the real core.ts). Control case: a fresh client injector resolving the server-scoped Backend token correctly throws `Cannot inject sprig:Backend (scope="server") on the client.` Bug case: a client root with Backend bound (provide()), then a client child resolving Backend (providedIn:"root" so target=this.root, which has it cached) returns the value with NO scope error — the gate is bypassed exactly as described.

Reachability: the claim's info severity is correct and honest. Injector.child() (line 122) and clientRoot() (line 153) are never invoked anywhere in the codebase — I grepped the whole ui/ tree: `Injector` is referenced only inside core.ts, and the sole new Injector outside is the per-request server root at line 344. The only `.child(` hit elsewhere (serialize.ts:30) is an unrelated tree-sitter node.child(i). So at runtime only one server-side root injector ever exists; no cross-side parent/child chain forms, making the scope-crossing currently unreachable. It is a genuine latent defect that violates the Backend token's documented "DI never crosses the wire" invariant (core.ts:200-212) the moment the dead client/child injector code is wired up. Verdict: real bug, latent, severity info — unchanged from the claim.

Fix would be to run the scope check before the #findInstance early return (or have #findInstance refuse to return a value whose registration scope doesn't match this.side).
```

### 93. serveAsset extension derivation reads across the directory separator: a dotted path segment before an extensionless file yields a bogus multi-segment "extension" (e.g. ".dir/noext"), defeating ASSET_TYPES lookup
- **severity:** info  ·  **category:** correctness
- **area:** serveSprig dispatch + /api prefix stripping (packages/keep/mod.ts) — routing boundaries, prefix collisions, traversal, asset/api/docs straddle
- **location:** `packages/keep/mod.ts:44 (const ext = file.slice(file.lastIndexOf(".")))`
- **expected:** Extension should be derived only from the final path segment (basename) after the last '/', so an extensionless file in a dotted subdirectory is treated as extensionless (octet-stream) and a real extension is still detected; the derivation must not span a directory separator.
- **actual:** lastIndexOf('.') scans the whole relative path including directory names, producing a nonsensical 'extension' like '.0/client' or '.dir/noext' that contains a '/'. It happens to still fall through to octet-stream so there is no security impact, but the content-type derivation is logically wrong for any nested asset whose parent directory contains a dot (e.g. versioned dirs 'v1.2/', 'app.min/').
- **repro:**
```
White-box simulation of packages/keep/mod.ts:44.

The line: `const ext = file.slice(file.lastIndexOf("."));` where `file` is the full relative asset path passed from line 87 (`path.slice(assetPrefix.length + 1)`).

Run:
  deno eval "const f='sub.dir/noext'; console.log(f.slice(f.lastIndexOf('.')))"
Output: .dir/noext   (a multi-segment 'extension' containing '/')

  deno eval "const f='v2.0/client'; console.log(f.slice(f.lastIndexOf('.')))"
Output: .0/client

ASSET_TYPES['.dir/noext'] and ASSET_TYPES['.0/client'] are both undefined, so content-type falls back to application/octet-stream.

Note: this fallback is ALSO the correct answer for an extensionless file, so there is no observable wrong behavior; the defect is confined to the bogus intermediate `ext` value. Files with a genuine extension (e.g. 'v1.2/client.js' -> '.js') are unaffected because the real extension is still the last dot.
```
- **evidence:**
```
packages/keep/mod.ts:44 `const ext = file.slice(file.lastIndexOf("."));` operates on the full relative `file` (path.slice(assetPrefix.length+1)), not the basename. Simulation output: input 'sub.dir/noext' -> ext='.dir/noext' -> ct=application/octet-stream; input 'v1.2/client.js' happens to work only because the real extension is also the last dot. Distinct from the already-reported bare-extensionless case (file with NO dot anywhere, where slice(-1) yields the last char): here the file IS in a dotted directory.
```
- **independent verification:**
```
VERIFIED as a real but non-impactful code-quality defect. Read packages/keep/mod.ts:44: `const ext = file.slice(file.lastIndexOf("."))`. Here `file` is the full relative asset path (`path.slice(assetPrefix.length + 1)` from line 87), NOT the basename. So lastIndexOf(".") can land inside a parent directory name.

Reproduced the exact line via deno eval:
- 'v2.0/client'    -> ext '.0/client'   (bogus, contains '/')
- 'sub.dir/noext'  -> ext '.dir/noext'  (bogus, contains '/')
- 'v1.2/client.js' -> ext '.js'         (correct — real ext is the last dot)
- 'app.min/style.css' -> ext '.css'     (correct)

So the analysis is accurate: a dotted directory + extensionless file produces a nonsensical 'extension' that is never a key in ASSET_TYPES.

WHY severity is info (and why it never produces wrong observable behavior):
1. The ONLY inputs that misfire are extensionless files inside a dotted directory. For those, the intended content-type is application/octet-stream anyway, and the buggy fallback ASSET_TYPES[ext] ?? 'application/octet-stream' returns exactly that. So even when the intermediate `ext` is garbage, the final content-type is correct.
2. Files that DO have a real extension always work, because the real extension is the last dot regardless of dots earlier in the path (verified with v1.2/client.js and app.min/style.css).
3. No security impact: traversal is blocked by the `file.includes("..")` check on line 41, and the bogus ext only ever maps to octet-stream.

Net: the intermediate value is logically wrong, but there is no reachable input for which the function returns an incorrect content-type or otherwise misbehaves. It is a genuine sloppiness in the code (deriving an "extension" across a directory separator) but produces zero observable defect. This matches the reporter's own info/correctness categorization. A clean fix would derive ext from the basename, e.g. compute the segment after the last '/', then take its lastIndexOf('.') (and return '' if there is no dot in the basename).
```


---

# Root Cause Analysis

> One root-cause analyst per bug (93 agents) read the cited source and traced each defect to its root. Numbers match the bug entries above. Analysis only — no fixes.

### RCA #1 — Deeply-nested but well-formed JSON body causes "Maximum call stack size exceeded" → HTTP 500 (recursion DoS in the typed-input pipeline; not a parser error)
- **Root cause:** The typed-input validation pipeline transforms the WHOLE parsed request body with class-transformer's recursive `plainToInstance` and never bounds the nesting depth — so a valid-but-deeply-nested body exhausts the JS call stack. Concretely: the RuneAssert seam (`assert(IssueRefDto, input)`) calls `plainToInstance(cls, plain, { enableImplicitConversion: false })`, and class-transformer descends into EVERY enumerable property of `plain`, including the undecorated `x` key (no `@Type`, not in the DTO). Because the recursion depth equals the attacker-controlled JSON nesting depth and there is no depth guard, ~5000 levels overflow the stack. The resulting `RangeError` is not a `RuneAssertError`, so keep's error filter (which only maps `RuneAssertError`→422) lets it fall through to the generic 500 handler. Two compounding design defects: (1) unbounded recursive transform over untrusted input, and (2) the DTO `whitelist: true` that would strip `x` runs only in `validateSync` AFTER `plainToInstance` has already recursively materialized the whole tree — so stripping never gets a chance to protect the transform.
- **Mechanism:** 1) Request hits `POST /api/http/issue`; dispatch forwards `/api/*` to keep (packages/keep/mod.ts:90-93). 2) The endpoint declares `input: IssueRefDto` (backend/src/board/entrypoints/http/mod.ts:55), so `@Endpoint` wires danet's `@Body()` + `BodyType` (endpoint-decorator/mod.ts:124-130). 3) danet's `Body` resolver runs: `body = await context.req.json()` succeeds (valid JSON), then `validateObject(param, IssueRefDto)` (@danet/core .../params/decorators.ts:147,167). 4) `validateObject` (@danet/validatte 0.7.4 validate.ts:44-93) is SHALLOW — it only iterates own property names and skips `x` (no validator), returns 0 errors (verified empirically: `validateObject errors: 0`). So validation passes and the full deep `param` is injected. 5) Handler `issue(body)` → `issueGet(body)` (mod.ts:56) → `assert(IssueRefDto, input, "issue.get input")` (coordinators/issue-get/mod.ts:15). 6) `assertInstance` calls `plainToInstance(cls, plain, {enableImplicitConversion:false})` at @mrg-keystone/keep 1.22.0 src/assert/mod.ts:107. class-transformer recursively copies/transforms all enumerable props including the deep `x` array; at ~5000 depth it throws `RangeError: Maximum call stack size exceeded` (reproduced directly: validateObject passes, `plainToInstance THREW: Maximum call stack size exceeded`, and a depth-5 case shows `x` is fully copied onto the instance proving it recurses into the undecorated key). 7) The RangeError is not a `RuneAssertError`, so the bootstrap filter (bootstrap/mod.ts:64 — "maps RuneAssertError to HTTP 422") doesn't match; the generic handler returns `{"status":500,"message":"Maximum call stack size exceeded"}`. The `board` control endpoint has no `input` DTO ⇒ no `@Body()` and no coordinator assert over an object ⇒ 200 with the same body, isolating the fault to the typed-input transform.
- **Root locus:** `/Users/raphaelcastro/Library/Caches/deno/remote/https/jsr.io/c15b186a3952edc728947965a9975b60a3335d423d96d38ed4669b395c0a26d5 (jsr:@mrg-keystone/keep@1.22.0/src/assert/mod.ts:107 — `plainToInstance(cls, plain, { enableImplicitConversion: false })`, the unbounded recursive transform of untrusted input). Reached from the application seam at /Users/raphaelcastro/Documents/programming/sprig/backend/src/board/domain/coordinators/issue-get/mod.ts:15 (`assert(IssueRefDto, input, ...)`), which is wired as a typed input at /Users/raphaelcastro/Documents/programming/sprig/backend/src/board/entrypoints/http/mod.ts:55. The 500-vs-422 mapping that lets the RangeError surface as 500 lives in jsr:@mrg-keystone/keep@1.22.0/src/bootstrap/mod.ts:64.`
- **Shared root:** keep typed-input pipeline does unbounded recursive transform/validation over the entire untrusted request body (class-transformer plainToInstance in the RuneAssert seam) with no nesting-depth limit and no allowlist applied before the recursion — any endpoint declaring an input DTO (issue, user) is a stack-exhaustion DoS vector. Likely shared by other "deep/large body → 500" or input-validation crash bugs on typed-input endpoints.

### RCA #2 — Same-basename folder-components collide in the SSR registry, silently clobbering a real component with a stub — board page renders 6 broken cards
- **Root cause:** The component registry is keyed solely on the unqualified folder basename, with no namespace/path qualifier and no collision detection. In createRenderer (ui/.sprig/compiler/mod.ts), the walk() over every template.html derives the registry key as `selector = basename(dir)` (line 41) and stores it via an unconditional, last-write-wins `reg.set(selector, ...)` (line 52). There is no `reg.has(selector)` guard, no path-based disambiguation (e.g. keying shared-components vs pages/<page>/components separately), and no build/SSR warning. Two distinct components in different folders that happen to share a leaf folder name (`shared-components/issue-card` and `pages/board/components/issue-card`) are therefore forced into one key, and whichever is walked last wins. This is a design defect in the registry's key scheme, not merely a missing warning — the namespace collapse is what makes one component silently overwrite the other.
- **Mechanism:** 1) ui/.sprig/compiler/mod.ts:39 walk(srcDir, {match:[/template\.html$/]}) yields template files in deterministic directory-traversal order; shared-components/issue-card/template.html is visited BEFORE pages/board/components/issue-card/template.html. 2) Line 41 computes `selector = basename(dir)` = "issue-card" for BOTH folders, discarding the distinguishing path. 3) Line 52 `reg.set(selector, {...})` runs first for the rich shared component, then again for the page-local stub; with no has()/dedup guard the second set overwrites the first, leaving a single key "issue-card" → stub (confirmed by selectors() at mod.ts:71 returning exactly one "issue-card"). 4) At render time renderDocument (mod.ts:72-82) builds the board page via renderNodes with `registry` whose get() (mod.ts:55) returns reg.get(s); every `<issue-card [issue]="issue">` tag in the board template resolves through this single key to the surviving stub. 5) The board iterates 6 issues, so the stub `<div class="page-local">PAGE-LOCAL ISSUE CARD OVERRIDE</div>` is emitted 6 times and 0 `class="icard"` cards are produced — and because line 52 never warns, the clobber is silent at build and SSR.
- **Root locus:** `ui/.sprig/compiler/mod.ts:41-52 (selector = basename(dir); unconditional reg.set with no collision guard) — concretely the key derivation at line 41 and the last-write-wins store at line 52.`
- **Shared root:** component keyed by basename with no dedup/namespace guard (registry collision: last reg.set wins silently)

### RCA #3 — Selector collision: two folder-components with the same basename silently overwrite each other in the SSR registry (and island build)
- **Root cause:** Sprig identifies a component by ONE global key — its folder basename — and stores components in a single flat, last-write-wins map with no namespacing, no scope/shadowing, and no duplicate-detection. In the SSR path, createRenderer builds `reg = new Map<string, ComponentDef>()` and, for every template.html found by `walk`, computes `selector = basename(dir)` (mod.ts:41) and unconditionally does `reg.set(selector, ...)` (mod.ts:52). `Map.set` overwrites any existing entry, so two folders with the same basename map to the same key and the later-walked one clobbers the earlier with zero diagnostics. The build path repeats the same design: it pushes `{ sel: basename(dir), ... }` into a flat `islands` array (build.ts:43) and later emits a single `isl.<sel>.ts` per selector, so colliding basenames collapse to one island chunk/manifest entry. There is no concept of "this component is page-local and shadows the shared one only within its page": resolution is purely by bare tag === basename. This is a DESIGN defect (flat global basename namespace), not a typo. Notably, the very same scan loop DOES guard one convention — assertStaticPage throws for a page that is an island (mod.ts:42, build.ts:39) — proving the author knew how to fail loudly on a folder-convention violation but never added the analogous `reg.has(selector)` / duplicate-selector check, so basename collisions pass silently.
- **Mechanism:** walk(srcDir, { match: [/template\.html$/] }) (mod.ts:39) yields every component folder in filesystem order. For each, selector = basename(dir) (mod.ts:41); two distinct folders sharing a basename (e.g. pages/board/components/issue-card and shared-components/issue-card) produce the identical selector "issue-card". reg.set(selector, {...}) (mod.ts:52) overwrites: whichever folder walk visits LAST wins; the first ComponentDef is dropped from the map and from srcPath, with no reg.has() check and no warn/throw anywhere (grep for has(/already/collision/duplicate/conflict/warn in mod.ts & build.ts finds only unrelated comments). At render time, renderElement resolves child tags via opts.registry.get(tag) (render.ts:131), a flat lookup with no page context — so the page-local override can never be selected over (or alongside) the shared component; only the single surviving map entry is reachable. Result: r.selectors().filter(s=>s==='issue-card').length === 1, and board SSR emits whichever 'issue-card' won the walk while the other distinct component (its markup, e.g. the parametrized .icard anchor with .icard__top) silently vanishes — no error, no warning. The island build is corrupted the same way: islands.push({ sel: basename(dir) }) (build.ts:43) appends a duplicate 'issue-card' to the manifest islands array, and step 2 generates one isl.issue-card.ts reflecting only one folder's logic/AST; the other island's logic is never bundled or registered, so client hydration silently uses the wrong/missing island.
- **Root locus:** `ui/.sprig/compiler/mod.ts:37,41,52 — the flat `reg = new Map<string, ComponentDef>()` keyed by `selector = basename(dir)` with an unconditional `reg.set(selector, ...)` (no has()/collision guard); mirrored in ui/.sprig/compiler/build.ts:36-43 (`islands` array keyed by `sel: basename(dir)`). Symptom surfaces downstream at ui/.sprig/compiler/render.ts:131 (`opts.registry.get(tag)`), which can only ever return the single surviving entry.`
- **Shared root:** component keyed by basename with no dedup guard — the global flat basename→ComponentDef map (Map.set last-write-wins, plus identical flat islands array) with no namespacing/scoping and no duplicate detection, despite an adjacent assertStaticPage guard that fails loudly for the page-island convention

### RCA #4 — Two (event) bindings with the same base event on one element collide — only one is ever reachable
- **Root cause:** The client-mode event delegation scheme represents an element's handler reference as a SINGLE DOM attribute `data-sprig-${base}` holding ONE handler-array index, keyed only by the base event name (modifiers stripped). This is a 1:1 element→handler mapping that structurally cannot encode N same-base bindings (keyup.enter + keyup.escape, click + click.ctrl). Because `plain` is a Record<string,string> in buildAttrs, the second binding's write to the same `data-sprig-${base}` key silently overwrites the first, and the dispatcher reads back exactly one index per base — so all but the last same-base handler are orphaned and unreachable. The defect is the data model (one attribute = one index per base), not the per-keypress modifier logic.
- **Mechanism:** 1) render.ts buildAttrs iterates event_binding attrs; for each it splits name into base+modifiers (262), then writes plain[`data-sprig-${base}`] = String(opts.handlers.length) (263) and pushes {base,modifiers,body,scope} onto opts.handlers (264). `plain` is a Record<string,string>, so the attribute is keyed ONLY by base event name. 2) Two bindings sharing a base (keyup.enter, keyup.escape) both target the same key `data-sprig-keyup`; the second write overwrites the first. After the loop only ONE index (the last binding's) is emitted into the DOM attribute, even though BOTH handlers live in the handlers array. The first handler's index is orphaned — no element attribute references it. 3) At dispatch, hydrate.ts's delegated per-base listener (206) does t = e.target.closest(`[data-sprig-${base}]`) (207) and h = handlers[Number(t.getAttribute(`data-sprig-${base}`))] (209) — a single index lookup, so it can ONLY ever resolve to the last keyup binding (escape). 4) For an Enter keypress, h.modifiers = ['escape'], so keyMatches (247-249) compares key 'enter' !== 'escape' and returns false; line 210 returns early and evalStatement is never called. onEnter is permanently unreachable while onEscape works.
- **Root locus:** `ui/.sprig/compiler/render.ts:263`
- **Shared root:** delegation marker is a single attribute/index keyed only by base event name (data-sprig-&lt;base&gt;), a 1:1 element-to-handler mapping that cannot represent multiple same-base bindings on one element

### RCA #5 — Reactive re-render replaces island innerHTML wholesale → focus loss, lost input/scroll/selection state, detached nodes
- **Root cause:** The client runtime's reactive update strategy is a coarse string re-render, not a DOM patch. By design (header comment lines 10-12 and the effect at hydrate.ts:193-198), hydration wraps the ENTIRE island body in a single `effect()` that re-runs `el.innerHTML = renderNodes(...)` on any tracked signal change. `renderNodes` (render.ts) only produces an HTML string — the runtime has no virtual DOM, no node-identity tracking, and no keyed reconciliation. Consequently every reactive update tears down and rebuilds the whole subtree. The root defect is the absence of fine-grained/diffing reconciliation: the framework reuses the SSR string-interpreter for client updates and assigns its output to innerHTML, conflating "recompute the view" with "replace the DOM."
- **Mechanism:** 1. hydrateIsland (hydrate.ts:176) builds one reactive `effect()` (line 193) whose body unconditionally executes `el.innerHTML = renderNodes(...)` at line 196. 2. `renderNodes(nodes, {scope, ...})` evaluates every template expression, including signal reads such as `filtered()`→`q()`; the surrounding `effect` therefore subscribes the whole render to every signal read anywhere in the template. 3. A delegated listener (line 206-213) handles `(input)` by calling `evalStatement(h.body,...)` → `q.set(value)`. 4. The signal write notifies the effect, which re-runs and re-executes line 196: `el.innerHTML = ...` destroys and recreates ALL island children. There is no node reuse, no keyed reconciliation, no diff — `renderNodes` produces an HTML string assigned wholesale to innerHTML. 5. The `<input>` the user is typing in is among the discarded nodes; the browser detaches it, focus/caret/selection move to nothing, and scroll/uncontrolled state of every child is reset. Handler indices are rebuilt (`handlers = hs`, line 197) but the freshly-parsed DOM is brand new, so any captured child reference is stale. The symptom is intrinsic to the string-render strategy described in the file header (lines 10-12): "re-render the island body inside an effect ... so any signal write re-paints."
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:193-198 (the render effect; specifically line 196 `el.innerHTML = renderNodes(...)`)`
- **Shared root:** wholesale el.innerHTML re-render in the hydrate effect

### RCA #6 — Delegated event listeners are wired only for event types present in the FIRST render; bases that appear only after a state change are never delegated
- **Root cause:** The event-delegation wiring is bound to a one-time startup snapshot of `handlers` instead of to the render lifecycle. `wire()` is invoked exactly once (hydrate.ts:216), outside the render effect, while `handlers` is rebuilt on EVERY render inside the effect (hydrate.ts:193-198). The set of delegated event bases is therefore frozen to whatever the FIRST render emitted. Because handlers/markers are emitted only for elements actually rendered (render.ts:258-265) and a hidden @if renders nothing (render.ts:349-368), any event base that first appears after a state change has no addEventListener attached. The design treats the listener set as static (and relegates re-wiring exclusively to the HMR `swap()` path, hydrate.ts:218-228), which is invalid for dynamic templates whose event surface grows across renders.
- **Mechanism:** 1) hydrateIsland sets up a render effect (hydrate.ts:193-198) that, on every run, rebuilds a fresh `handlers` array by calling renderNodes with a new `hs`; handlers are populated only for elements actually emitted (render.ts:258-265 pushes a Handler per rendered event_binding). 2) `wire()` (hydrate.ts:202-215) iterates `new Set(handlers.map(h=>h.base))`, and for each base not already in the `wired` set, attaches ONE delegated addEventListener on the island root. 3) `wire()` is invoked exactly once, at hydrate.ts:216, immediately after the effect's first synchronous run — so `wired` is seeded only with bases present in the initial render. 4) With `open=false`, only the button (base \"click\") renders; the @if-guarded <input> renders nothing (render.ts:349-368), so base \"input\" is absent from `handlers`. wired={\"click\"}. 5) Clicking the toggle sets open=true; the effect re-runs, el.innerHTML now contains the <input data-sprig-input=\"...\">, and `handlers` now includes the input handler. But the effect (193-198) does NOT call wire() — it only reassigns `handlers`. 6) The only re-wire path is inside swap() at hydrate.ts:222-227, which is registered solely when `hmrEnabled && tick` (hydrate.ts:218). In a production build hmrEnabled is false, so swap()/wire() never run again. 7) No \"input\" listener is ever added to the island root; the browser fires `input`, the delegation handler that would dispatch it does not exist, and onInput silently never runs.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:216 (sole, one-time `wire()` call placed outside the render effect; re-wire exists only in the HMR-gated swap at :218-228, never reached in production)`
- **Shared root:** isolated — this is specifically the delegated-listener wiring frozen to the first render's handler snapshot. (It shares the broader hydrate-effect theme of dynamic re-render handling, but the concrete defect — wire() outside the effect / re-wire gated behind hmrEnabled — is distinct from innerHTML re-render or interpreter-statement bugs.)

### RCA #7 — Keyboard modifier-key combos in (event) bindings never fire — keyMatches() compares each modifier against the single event.key, so documented bindings like (keyup.control.enter) are dead
- **Root cause:** keyMatches() conflates two semantically distinct kinds of dotted tokens into one undifferentiated list and matches them all against a single value. In render.ts:262 the event-binding name is split as `const [base, ...modifiers] = name.split(".")`, so for `(keyup.control.enter)` the handler is stored with `base="keyup"` and `modifiers=["control","enter"]` — there is NO distinction between a chord/modifier-key token (control/ctrl/shift/alt/meta, which must be tested against the event's e.ctrlKey/shiftKey/altKey/metaKey booleans) and the actual key token (enter, tested against e.key). keyMatches (hydrate.ts:247-250) then treats the whole list as "keys" and demands `mods.every(m => key === (KEY_ALIAS[m] ?? m))`. Because a KeyboardEvent has exactly one `e.key`, it can equal at most ONE token; any modifiers list with length ≥2 — or even a single modifier-key token like ["shift"] / ["control"] — can never satisfy `every`. The root defect is the missing modifier-vs-key partition (and the absence of any e.ctrlKey/shiftKey/altKey/metaKey check), not the listener wiring, which is correct.
- **Mechanism:** 1) Compile/render: render.ts:262 splits `(keyup.control.enter)` into base="keyup", modifiers=["control","enter"]; the element gets tagged `data-sprig-keyup=<idx>` (render.ts:263) and the handler {base, modifiers, body, scope} is pushed (render.ts:264). So the DOM tag and handler are present — the binding looks wired. 2) Hydration: hydrate.ts:202-213 attaches ONE delegated `keyup` listener on the island. On a real Ctrl+Enter keyup, e.target.closest('[data-sprig-keyup]') finds the element (line 207), the handler is fetched (line 209). 3) Gate: line 210 runs `h.modifiers.length && !keyMatches(e, h.modifiers)` → keyMatches(e, ["control","enter"]). 4) keyMatches (hydrate.ts:248-249): key = e.key.toLowerCase() = "enter"; returns `["control","enter"].every(m => "enter" === (KEY_ALIAS[m] ?? m))`. For m="control": KEY_ALIAS["control"] is undefined → falls back to "control"; "enter" === "control" is false → every() short-circuits false. 5) keyMatches returns false → line 210's guard returns early → evalStatement(h.body,...) (line 212) is never reached → send() never runs. Single-token bindings like (keyup.enter) survive because modifiers=["enter"] and "enter"==="enter" passes. Symptom: chord/modifier handlers are registered and DOM-tagged but permanently unreachable.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:247-250 (keyMatches: no modifier-key partition, no e.ctrlKey/shiftKey/altKey/metaKey test, uses mods.every against single e.key); enabled by the undifferentiated split at ui/.sprig/compiler/render.ts:262`
- **Shared root:** isolated — specific to keyMatches treating chord modifier tokens as additional key tokens (no modifier/key partition and no event modifier-boolean check)

### RCA #8 — Page reload is intercepted and downgraded to a partial outlet swap — state never resets, document never reloads
- **Root cause:** setupSoftNav's `navigate` event filter treats ALL interceptable same-origin navigations identically, with no awareness of navigation semantics. It gates interception purely on transport-shaped properties (canIntercept/hashChange/downloadRequest/formData) plus origin and base-path checks, and never inspects `e.navigationType`. Because a reload (navigationType === 'reload') passes every one of those checks — same origin, same base path, no hashChange/download/formData, and canIntercept is true — the handler unconditionally intercepts it and routes it through the soft-nav outlet-swap path. By design (the swap only replaces `<sprig-outlet>` innerHTML and re-arms islands inside it, per the comment at hydrate.ts:136-138), this path is incapable of producing a full-document reset. The defect is that the design uses interception as the default for everything that "looks like" an in-app link, with no carve-out for navigation types that semantically REQUIRE a full document load (reload, and arguably traverse/back-forward to a different page).
- **Mechanism:** 1. User calls navigation.reload() (or browser reload in a Navigation-API browser). 2. A `navigate` event fires with e.navigationType === 'reload', e.canIntercept true, e.hashChange/downloadRequest/formData all false, e.destination.url === current URL (same origin, same base path). 3. hydrate.ts:145 — `if (!e.canIntercept || e.hashChange || e.downloadRequest || e.formData) return;` — none of these are truthy, so the early-return is NOT taken. 4. hydrate.ts:147-148 origin and base-path checks also pass (it's the same in-app URL). 5. hydrate.ts:149 e.intercept(...) is called, hijacking the reload. 6. The handler (hydrate.ts:151-170) fetches the page HTML, parses it, and at hydrate.ts:161-165 the swap does ONLY `cur.innerHTML = next.innerHTML` for the `<sprig-outlet>` element, then bootstrapIslands(cfg, cur) over just that outlet subtree. 7. The counter island lives in the header, OUTSIDE `<sprig-outlet>`, so it is never touched: its element is never recreated, hydrateIsland (hydrate.ts:176-198) is never re-run, and its setup()/signals (the island's live state, hydrate.ts:183) are preserved. Its effect (hydrate.ts:193-198) keeps rendering the stale signal value. 8. Result: counter stays at its incremented value (3/4) instead of resetting to the SSR initial 0; the island element is the same node (__instanceTag survives). The reload silently degrades into a partial outlet swap that resets nothing outside the outlet and never performs a true document reload.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:145 (the navigate-event guard in setupSoftNav, which omits an `|| e.navigationType === 'reload'` exclusion); the symptom is then produced by the outlet-only swap at hydrate.ts:161-165.`
- **Shared root:** soft-nav interceptor swaps only <sprig-outlet> innerHTML and preserves islands outside the outlet — same partial-swap root as other bugs where state/lifecycle outside the outlet is never reset on navigation

### RCA #9 — Multi-statement (event) handlers silently drop every statement after the first
- **Root cause:** The grammar models a multi-statement event body as a HIDDEN rule that produces a flat list of sibling statement nodes, then attaches a single-valued field to it; but the interpreter retrieves the body via a single-child field accessor and has no concept of "the handler is a list of statements." Concretely: `_event_body: ($) => sep1(";", choice($.assignment, $._expression))` (tree-sitter-angular-template/grammar.js:375) expands to `seq(rule, repeat(seq(";", rule)))`, so authoring `open = true; count = count + 1` yields N sibling statement nodes. Because the rule name starts with `_` it is a hidden/inlined rule, so those N statements become direct namedChildren of the `event_binding` node rather than children of a single wrapping `_event_body` node. The grammar then applies `field("handler", $._event_body)` (grammar.js:177) to that inlined sequence. tree-sitter's `childForFieldName("handler")` is single-valued and returns only the FIRST node bearing the field. The compiler's only access path to the body is exactly that single-child accessor — `field(attr,"handler")` via `node.childForFieldName(name)` (node.ts:14-16) — used both for client handler collection (render.ts:264) and as the `handler` argument to evalStatement (expr.ts:214). There is no code path that ever enumerates the remaining sibling statements. The design defect is the combination of (a) a hidden, field-tagged multi-element rule whose multiplicity is invisible to a single-valued field getter, and (b) evalStatement assuming `handler` is either one statement or a node whose OWN namedChildren are the statements — neither of which is true for the inlined multi-statement case.
- **Mechanism:** 1. Parse `<button (click)="open = true; count = count + 1">`: `_event_body` (grammar.js:375) matches `sep1(";",...)` = two `assignment` nodes; because `_event_body` is hidden, both assignments are inlined as namedChildren of the `event_binding` node. 2. render.ts:264 (client) and the call site feeding expr.ts:214 both fetch the body with `field(attr,"handler")` → node.ts:15 `node.childForFieldName("handler")`, which is single-valued and returns ONLY the first assignment node ("open = true"); the second assignment, though present as a sibling namedChild, is never referenced. 3. In evalStatement (expr.ts:214-218), `handler.type === "assignment"` so `single = true` (expr.ts:216-217), making the loop iterate `[handler]` — a one-element array containing just the first statement. 4. expr.ts:219-220 executes `assignTo(left, evalExpr(right))` for "open = true" only; the loop ends. "count = count + 1" never runs. 5. The `else` branch (`_named(handler)`, expr.ts:218/222) is dead for this case, and even if `single` were false it would iterate the first assignment's OWN operands (its `left`/`right` children) rather than the sibling statements — so it could never recover the dropped statements either. Net symptom: on both server render and client hydration, statements 2..n of any `;`-separated handler are permanently dropped; only the first executes.
- **Root locus:** `tree-sitter-angular-template/grammar.js:177 (field("handler", $._event_body) over the hidden multi-statement rule grammar.js:375), surfaced/finalized by the single-valued accessor at ui/.sprig/compiler/node.ts:14-16 and the single-vs-named branch in ui/.sprig/compiler/expr.ts:216-218`
- **Shared root:** grammar hides a multi-child rule (`_event_body`) behind a single-valued field, so the interpreter treats the whole event body as a single statement node — same class as other "interpreter treats the hidden _event_body rule as a single statement" defects (event-handler statement-list / field-multiplicity bugs)

### RCA #10 — Multi-argument pipes silently drop all but one argument (slice:a:b broken); the all-args collection branch is dead code
- **Root cause:** evalPipe gates argument collection on `node.childForFieldName("argument")`, a presence test that is ALWAYS truthy whenever the pipe has at least one argument, so it permanently takes the single-arg branch and only ever collects args[0]. The grammar declares pipe arguments as `repeat(field("argument", $.pipe_argument))` (grammar.js:494) — i.e. EVERY pipe_argument node carries the field name "argument". tree-sitter's childForFieldName returns only the FIRST node bearing a given field name, never the rest. The author wrote a ternary intending the first branch to be a single-arg fast path and the second branch (`named(node).filter(c=>c.type==="pipe_argument").map(...)`) to be the multi-arg path, but because the field name is shared by all pipe_argument children, the condition can never be false when any argument exists. The result: the correct multi-arg collection at expr.ts:141 is unreachable dead code, and any pipe is fed a truncated single-element args array.
- **Mechanism:** For `{{ items | slice:1:3 }}`: parse yields a pipe_expression with two pipe_argument children, both tagged with field "argument" (grammar.js:494). In evalPipe, line 139 `node.childForFieldName("argument")` returns the FIRST pipe_argument (the `:1`) — a truthy node — so the ternary takes line 140: `args = [ evalExpr(named(firstArg)[0], scope) ]` = `[1]`. The second pipe_argument (`:3`) is never inspected; line 141 (which would filter ALL pipe_argument children and map them) never executes. PIPES.slice at expr.ts:152 then runs `(v).slice(a[0], a[1])` = `items.slice(1, undefined)`, which slices from index 1 to the end, returning [20,30,40,50] instead of the expected items.slice(1,3) === [20,30]. The drop is silent because slice's second param being undefined is a legal call, not an error. The same truncation hits every present and future multi-arg pipe.
- **Root locus:** `ui/.sprig/compiler/expr.ts:139-141 (the childForFieldName-gated ternary in evalPipe); enabled by the shared field name in tree-sitter-angular-template/grammar.js:494`
- **Shared root:** isolated — specific to evalPipe's misuse of childForFieldName against a repeated/shared field name; not part of a broader theme

### RCA #11 — Unbalanced ( ) [ or ] inside an attribute-selector string value silently un-scopes the rest of the component's stylesheet (and everything concatenated after it in app.css)
- **Root cause:** scope.ts's hand-rolled CSS scanner is string-blind: every place it tracks selector/rule nesting it counts the raw characters ( ) [ ] as depth delimiters with NO concept of a CSS string literal ("..." / '...'). CSS attribute selectors may carry arbitrary quoted values, e.g. [aria-label="Close )"], where a paren/bracket is just data, not structure. Because the scanner never enters/exits a "inside a quoted string" state, any such character inside a quoted value mutates the dp (paren) or db (bracket) depth counters, permanently desynchronizing them from the real selector structure. This is a design defect in the tokenizer (it should ignore ( ) [ ] { } ; , while inside a string), not a one-off off-by-one.
- **Mechanism:** processBlock's prelude scan (scope.ts:46-55) walks the selector counting depth: line 49 `(`→dp++, line 50 `)`→dp--, line 51 `[`→db++, line 52 `]`→db--, and only breaks on a terminator when `dp===0 && db===0` (line 53). For input `[aria-label="Close )"] { color: red }`: the leading `[` sets db=1; inside the quoted value the lone `)` runs line 50 and sets dp=-1; the closing `]` brings db back to 0 — but dp is now -1. When the scanner reaches the `{`, the guard on line 53 requires `dp===0 && db===0`, which is false (dp===-1), so `{` is NOT recognized as a rule terminator. j keeps advancing with no terminator ever satisfying the guard, so j reaches n (EOF). Control falls into the `j >= n` branch at line 59, whose emit path (lines 60-61) appends `prelude` (the ENTIRE remaining stylesheet) verbatim with zero calls to scopeSelectorList — the `{ color:red }\n.other{color:green}` tail is emitted as-is and i=j+1 ends the loop. Output is byte-for-byte the input, scoped? false. The same desync occurs for a stray `(` (`[data-x="("]` pins dp at +1) and for a stray `[`/`]` in a value (via db). scopeSelector (lines 98-108) and splitTop (lines 128-139) share the identical string-blind counter logic, so even preludes that survive the first scan would be mis-split. Via build.ts:130 each component's CSS is scoped individually and at build.ts:146 all `parts` are concatenated into one Tailwind input → single app.css; an unscoped run-to-EOF in one component therefore drags every rule of every component concatenated after it out of encapsulation too.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts:46-55 (the prelude depth scan with no string-literal state); the un-scoped emit it falls through to is scope.ts:59-62. The same string-blind defect is replicated at scope.ts:98-108 (scopeSelector key-compound scan) and scope.ts:128-139 (splitTop).`
- **Shared root:** scope.ts CSS scanner ignores string-literal context — its ( ) [ ] { } depth/split logic (processBlock prelude scan, scopeSelector, splitTop) treats quoted attribute-value contents as structural delimiters

### RCA #12 — Two folders sharing a basename collide: same scopeId + silent registry overwrite (encapsulation leak / wrong component rendered)
- **Root cause:** Component identity across the entire compiler is derived from one weak key: the folder's basename (`basename(dirname(template.html))`), with no qualification by the rest of the path and no uniqueness guard. The selector registry, the view-encapsulation scope marker, and the build-time CSS scope are ALL keyed on that bare basename, so any two component folders that happen to share a leaf folder name (e.g. `src/shared-components/issue-card` and `src/pages/board/components/issue-card`) are treated as the exact same component. There is no notion of page-local vs shared scope, no dedup/error on duplicate basenames, and no path-aware namespacing — the design simply assumes basenames are globally unique.
- **Mechanism:** 1) SSR scan (mod.ts:39-53): `walk` yields both template.html files. For each, `selector = basename(dir)` (mod.ts:41) → both produce selector \"issue-card\". `reg.set(selector, {...})` (mod.ts:52) is a Map insert keyed on that string, so the second-visited folder silently CLOBBERS the first. walk() visits `shared-components/issue-card` first and `pages/board/components/issue-card` last, so the page-local override def wins. `reg.size`/`selectors()` therefore report only one \"issue-card\" entry (repro: `.filter(s===\"issue-card\").length` → 1).\n2) Tag resolution (mod.ts:55, registry.get → reg.get): when the board template references the `issue-card` tag, `registry.get(\"issue-card\")` returns the surviving (page-local override) def, so renderNodes emits the override DIV (\"PAGE-LOCAL ISSUE CARD OVERRIDE\") instead of the real card markup (`icard__title` absent). Hence \"wrong component rendered.\"\n3) Encapsulation marker (mod.ts:76,80 → scope.ts:14): SSR elements get `scopeAttr: scopeId(page.selector)`. `scopeId` (scope.ts:14-21) is a pure FNV-1a hash of the selector STRING only, so `scopeId(\"issue-card\")` is byte-identical (sc44799d1) for both folders.\n4) CSS scoping (build.ts:127-130): `buildCss` walks every styles.css, computes `sel = basename(dirname(path))` (build.ts:128) and rewrites rules with `scopeCss(css, scopeId(sel))` (build.ts:130). Both issue-card styles.css files are rewritten with the SAME `[sc44799d1]` marker. Because the encapsulation guarantee in scope.ts:1-10 relies on the marker being unique per component, the shared marker means CSS authored for one issue-card matches the SSR elements of the other → styles leak across components, violating the stated guarantee.
- **Root locus:** `ui/.sprig/compiler/mod.ts:41 (`const selector = basename(dir)`) combined with mod.ts:52 (`reg.set(selector, ...)` — Map keyed on bare basename with no dedup/error). The identical defect is mirrored at build.ts:128 (`const sel = basename(dirname(entry.path))`) and made consequential by scope.ts:14 (`scopeId` hashes only the selector string). The single underlying decision lives at mod.ts:41.`
- **Shared root:** component keyed by basename with no dedup guard (same weak basename key drives the SSR registry, scopeId markers, and build-time CSS scope; no path qualification, no page-local namespacing, no duplicate-selector error)

### RCA #13 — scopeCss brace/depth scanners have no CSS string-literal context, so a '{' or '}' inside a string value (content:"{", url("...}")) is miscounted as a block delimiter — corrupting rule boundaries, un-scoping every following rule and emitting unbalanced braces
- **Root cause:** Both byte-scanning loops in processBlock — the prelude terminator scan (scope.ts:47-55) and the matching-brace depth scan (scope.ts:65-69) — model CSS as a stream of structural punctuation, tracking only parenthesis depth (dp) and bracket depth (db) plus a raw brace counter, with NO notion of being inside a quoted string. CSS declaration values legally contain `{`, `}`, `(`, `)` inside single/double-quoted strings (e.g. `content:"{"`, `content:"a}b"`, `url("x)y")`). Because the scanners never enter/exit a string state when they hit `"` or `'` (and never handle backslash escapes), any brace/paren/bracket inside such a string is counted as if it were structural. The design assumed declaration bodies and selector preludes contain only balanced, unquoted punctuation, which is false for the `content`/`url()`/`quotes` properties. This is a parser-completeness defect: a hand-rolled CSS block tokenizer that omits the string-literal token class.
- **Mechanism:** In processBlock the rule `.icon::before{content:"{";}` is processed at the brace-matcher (scope.ts:65-69). depth starts at 0; css[j]=='{' (the block open) sets depth=1 (line 67). Scanning the inner declaration `content:"{";`, the loop reaches the '{' that is INSIDE the string literal "{". Because the loop has no string-context tracking, it counts that '{' as structural and sets depth=2 (line 67). The next '}' is the real end of the .icon rule: `--depth` brings depth back to 1, so the condition `--depth === 0` (line 68) is FALSE and the loop does NOT break there. The scan keeps going, swallowing the following rules. It only breaks at the final '}' of `.c{color:green}` where depth finally hits 0. Consequently k points past .c, and `inner` (scope.ts:70) becomes `content:"{";}\n.b{color:blue}\n.c{color:green`. Since head is `.icon::before` (not an at-rule), line 77 emits `scopeSelectorList(".icon::before") + " {" + inner + "}"`, i.e. `.icon[data-s1]::before {content:"{";}\n.b{color:blue}\n.c{color:green}`. The .b and .c rules are thereby copied verbatim into the inner body — never passed through scopeSelectorList — so they emerge UNSCOPED (`.b{...}` `.c{...}`), and the closing `}` appended by line 77 is a SECOND brace on top of the one already present in inner, producing the stray trailing `}` (invalid CSS). i is then set to k+1 (line 79), past everything, so the loop ends. The prelude scanner at scope.ts:47-55 has the identical blind spot (it also breaks on a bare `{`/`}` regardless of string context), so even a string in a selector prelude would mis-terminate. build.ts:130 then concatenates this corrupted, brace-unbalanced fragment with every other component's CSS into one app.css (build.ts:146 join), and a single unbalanced-string component poisons the cascade for all components that follow it in the bundle.
- **Root locus:** `ui/.sprig/compiler/scope.ts:65-69 (the brace-depth match loop in processBlock; the same string-blind defect is also present in the prelude scanner at scope.ts:47-55, and structurally in splitTop:128-141 and scopeSelector:98-108 which likewise ignore quotes)`
- **Shared root:** scopeCss brace/paren/bracket scanners ignore CSS string context — hand-rolled CSS tokenizer in scope.ts has no string-literal state, so quoted `{`/`}`/`(`/`)`/`,` (content:, url(), quotes:) are miscounted as structural delimiters across all of its scan loops (processBlock prelude+brace match, splitTop, scopeSelector key-compound scan)

### RCA #14 — Well-formed but unknown resource id returns HTTP 500 instead of 404 (not-found mapped to server error)
- **Root cause:** The business layer signals \"resource not found\" by throwing a bare, untyped `Error` (issue/mod.ts:15 and user/mod.ts:15) rather than a typed not-found exception, and no layer between the throw and the wire (coordinator issue-get/mod.ts, endpoint http/mod.ts) catches it or maps the absence of a record to a 404. Because the keep/danet framework only assigns meaningful HTTP statuses to its own typed HttpExceptions (and maps RuneAssertError to 422), any other thrown `Error` is funneled into the framework's catch-all default filter, which emits a generic HTTP 500 with the `{status,message}` envelope. The design conflates two distinct outcomes — \"this id names no resource\" (a client addressing error, 404) and \"the server failed\" (500) — into the same throw-a-plain-Error mechanism, and the absence of a domain not-found exception type leaves the framework no way to distinguish them.
- **Mechanism:** 1) Endpoint `HttpController.issue` (backend/src/board/entrypoints/http/mod.ts:44-47) delegates the request body to coordinator `issueGet`. 2) The coordinator `get` (issue-get/mod.ts:14-21) runs `assert(IssueRefDto, input, ...)` at line 15; a non-empty string id like \"SPR-999\" SATISFIES the contract, so the assert passes and `getCore` is invoked. 3) `getCore` (lines 25-28) calls `new Issue().assemble(input.issueId)`. 4) In business/issue/mod.ts:14-15, `ISSUES.find(c => c.id === issueId)` returns `undefined` for an unknown id, so line 15 executes `throw new Error(`no issue with id \"${issueId}\"`)` — a bare, untyped JS `Error`. 5) This exception propagates uncaught out of the coordinator and back into the keep/danet endpoint runner. Danet's default exception filter recognizes only its own typed HttpExceptions (and the framework maps a thrown `RuneAssertError` from `assert` to a 422 with the `{name:\"RuneAssertError\",failures:[...]}` envelope); any other `Error` instance falls through to the generic catch-all that serializes it as `{\"status\":500,\"message\":<error.message>}`. 6) Hence the well-formed-but-unknown id surfaces as HTTP 500 with `{\"status\":500,\"message\":\"no issue with id \\\"SPR-999\\\"\"}` instead of a 404. The identical pattern in business/user/mod.ts:14-15 produces the user 500.
- **Root locus:** `backend/src/board/domain/business/issue/mod.ts:15 (and the identical backend/src/board/domain/business/user/mod.ts:15) — the bare `throw new Error(...)` on the not-found branch, which carries no 404/not-found status semantics`
- **Shared root:** business-layer not-found signaled as a bare `throw new Error(...)`, which the keep/danet default exception filter maps to a generic 500 {status,message} instead of a typed 404 not-found (same root in issue/mod.ts:15 and user/mod.ts:15)

### RCA #15 — Empty-string and whitespace-only issueId/userId pass validation and 500 instead of being rejected with 422
- **Root cause:** The id reference DTOs constrain their id fields with `@IsString()` alone and nothing else. `@IsString()` is satisfied by any string, including the empty string and whitespace-only strings, so the validation seam has no constraint that rejects a present-but-blank id. The DTO's notion of \"valid id\" is purely type-level (is-a-string), not content-level (non-empty/non-blank). Because the only barrier between the wire and the business layer is this under-specified DTO, a malformed-but-typed input is allowed to skip past the 422 contract and reach domain logic that assumes a meaningful id, where it can only fail as an uncategorized Error (-> 500). The missing constraints are `@IsNotEmpty()` plus a trim+min-length guard.
- **Mechanism:** 1) The HTTP endpoints declare `input: IssueRefDto` / `input: UserRefDto` (backend/src/board/entrypoints/http/mod.ts:44 and :55). keep validates the request body against the DTO using class-validator BEFORE invoking the handler; a validation failure is what produces the 422 (this is exactly why the control `{}` body -> 422, since `@IsString()` fails on `undefined`). 2) In the DTOs, `issueId` (issue-ref.ts:16) and `userId` (user-ref.ts:16) carry ONLY `@IsString()`. The strings `\"\"` and `\"   \"` are valid strings, so `@IsString()` passes and the body sails through the validation seam unchanged. 3) The handler forwards the id to the business layer (issue.assemble / user.assemble). In issue/mod.ts:14-15 `ISSUES.find(c => c.id === issueId)` with `issueId === \"\"` finds nothing, so line 15 executes `throw new Error('no issue with id \"\"')`; identically user/mod.ts:14-15 throws for the empty/whitespace userId. 4) That bare `throw new Error(...)` is an unclassified exception, which keep maps to HTTP 500 with `{\"status\":500,\"message\":\"no issue with id \\\"\\\"\"}`. So an input-contract violation (empty/blank id) is mis-surfaced as a server fault.
- **Root locus:** `backend/src/board/dto/issue-ref.ts:16 (issueId only @IsString()) and backend/src/board/dto/user-ref.ts:16 (userId only @IsString())`
- **Shared root:** DTO id fields validated with @IsString() only (no @IsNotEmpty/trim/min-length), so empty/whitespace ids bypass the 422 validation seam and crash the business layer as 500 — same root for both IssueRefDto.issueId and UserRefDto.userId

### RCA #16 — Well-formed but nonexistent issueId/userId returns 500 (unhandled plain Error) instead of 404
- **Root cause:** A "not found" client-input condition is signalled with a generic `throw new Error(...)` instead of a framework-recognized client-error (RuneAssertError/422 or a NotFound/404 type), and it is raised in the business layer AFTER the input assert seam where the only error class keep maps to a 4xx (the DTO contract assert) has already passed. Because keep only knows two outcomes — a RuneAssertError (contract violation -> 422) or "any other thrown Error" (-> 500 internal) — and no layer (business, coordinator, or entrypoint) catches/translates the lookup-miss into a 404/422, a perfectly well-formed request for a nonexistent id is treated as a server fault. The design gap: there is no error taxonomy for "valid request, missing resource"; that case falls through to the catch-all 500.
- **Mechanism:** 1) HTTP request hits coordinator get() (issue-get/mod.ts:14-15, user-get/mod.ts:14-15). The input seam `assert(IssueRefDto, input, ...)` validates only the CONTRACT (issueId is a string). A well-formed body like {"issueId":"SPR-999"} or {"issueId":""} passes the assert — it is a valid string, just not a known id. So no RuneAssertError/422 is raised. 2) getCore() calls new Issue().assemble(input.issueId) (issue-get/mod.ts:25-27; user-get/mod.ts:25-27). 3) Inside assemble, the lookup misses: `const issue = ISSUES.find(c => c.id === issueId)` returns undefined, so line 15 (issue) / line 15 (user) executes `throw new Error(\`no issue with id \"${issueId}\"\`)` — a PLAIN Error, NOT a RuneAssertError. (issue/mod.ts:14-15, user/mod.ts:14-15.) 4) There is no try/catch in getCore, in get(), in the business class, or in the http entrypoint, and no NotFoundException/404 or 422 mapping anywhere. The error propagates uncaught out of the coordinator. 5) keep's framework error handler classifies a thrown non-assert Error as an internal/unexpected fault and serializes it as HTTP 500 with {status:500,message:<error.message>}. Hence the observed `POST /http/issue {issueId:"SPR-999"} -> 500`. The 422 seam can never fire for this case because the value satisfies the DTO contract; the missing-resource condition is detected only AFTER the seam, expressed as a raw Error rather than a typed client-error.
- **Root locus:** `backend/src/board/domain/business/issue/mod.ts:15 (and the identical backend/src/board/domain/business/user/mod.ts:15) — `if (!issue/user) throw new Error(...)`. This is where the wrong error class is constructed; the symptom surfaces later in keep's catch-all handler, but the defect lives at these throw sites (plus the absence of any catch/translation in the coordinators issue-get/mod.ts:25-27 and user-get/mod.ts:25-27).`
- **Shared root:** missing-resource lookups throw a plain Error after the input assert seam, so keep maps them to 500 instead of 404/422 (no NotFound error taxonomy / no catch-translate in business+coordinator layers) — shared across at least Issue.assemble and User.assemble (and any other get-by-id coordinator following the same generated pattern)

### RCA #17 — Malformed / empty / non-JSON request body returns HTTP 500 (not 400/422) on issue and user endpoints, leaking the raw JSON parser error message
- **Root cause:** The body JSON parse and the input-DTO validation are two separate stages, and the parse stage has no client-error mapping. In danet's @Body() parameter resolver (jsr:@danet/core@2.11.0, src/router/controller/params/decorators.ts:145-150) the request body is parsed with `body = await context.req.json()` wrapped in a try/catch whose ONLY action is `throw e` — it re-raises the raw V8 SyntaxError unchanged instead of wrapping it in a 4xx HttpException (e.g. the BadRequestException it already uses for failed DTO validation a few lines later at :169 via `NotValidBodyException`). keep's @Endpoint decorator wires this @Body() unconditionally for every endpoint declaring `input:` (endpoint-decorator/mod.ts:124-125), and keep's only error-classifying seam — the global exception filter registered in bootstrap-server/mod.ts:716-738 — recognizes ONLY `RuneAssertError` (name + failures array) and maps it to 422; for anything else its `catch` returns `undefined`, deferring to danet's default. So a parse failure is structurally incapable of being classified as a client error: it is thrown before validateObject ever runs, it is not a RuneAssertError, and it carries no `.status`. The design splits "is this JSON parseable" from "is this JSON a valid DTO" but only built a client-error path for the second.
- **Mechanism:** A POST to /api/http/issue (or /user) routes to HttpController.issue, declared `@Endpoint({ input: IssueRefDto, ... })` (backend/src/board/entrypoints/http/mod.ts:44, :55). The decorator calls `Body()(...)` (endpoint-decorator/mod.ts:125), so danet must resolve the body parameter before invoking the handler. In the @Body resolver (params/decorators.ts:147) `await context.req.json()` is evaluated FIRST, before the DTO validation at :166-171. For a malformed/empty/trailing-junk body, `context.req.json()` throws a V8 SyntaxError ("Unexpected end of JSON input", "Expected property name or '}' in JSON at position 1", etc.); the catch at :148-150 does `throw e`, re-raising that SyntaxError verbatim. The error propagates up past keep's global filter (bootstrap-server/mod.ts:717-737): `e.name` is "SyntaxError", not "RuneAssertError", so the filter returns `undefined` and danet falls through to its default handler. There, src/router/router.ts:309-316 computes `status = error.status || 500` (a SyntaxError has no `.status` → 500) and `message = error.message || 'Internal server error!'` (the raw parser string) and emits `json({ status, message }, status)` — i.e. HTTP 500 with the raw parser message leaked in `message`. By contrast a structurally-valid-but-wrong body ('[]', 'null', '42', '{"issueId":123}') parses successfully, reaches the validation seam, and is thrown as a RuneAssertError that the filter maps to 422 — which is why those return 422 while '{bad' and '' return 500.
- **Root locus:** `jsr:@danet/core@2.11.0 src/router/controller/params/decorators.ts:146-150 (the `try { body = await context.req.json(); } catch (e) { throw e; }` in the @Body() resolver — re-throws the raw parse error instead of mapping to BadRequestException); the absence of a parse-error→4xx mapping is reinforced at keep@1.22.0 bootstrap-server/mod.ts:716-737 (filter catches only RuneAssertError) and surfaces as 500 at @danet/core@2.11.0 src/router/router.ts:309-316. Cached files: /Users/raphaelcastro/Library/Caches/deno/remote/https/jsr.io/9c151044ae387df3d665be8ba806e10368f523b9e85f3c2edbb447fcb203e61c (params/decorators.ts), .../668097e9e33bc34c01a2f78516f003292329b97b58d211f8e1da6126a3eb1ac7 (bootstrap-server), .../9ab5d4b0cedee4bb290f77590eeca9961f914e67afae4476c6e04e9f9ae1c77b (router.ts). Symptom surfaces via backend/src/board/entrypoints/http/mod.ts:44,55.`
- **Shared root:** keep's error taxonomy maps ONLY RuneAssertError to a 4xx (422) and lets every other thrown error fall through to danet's default 500 with the raw error message echoed — so any pre-validation/framework-level fault on these endpoints (here: unguarded body JSON.parse in danet's @Body resolver, which runs before the DTO-validation seam) leaks as a 500 with a raw internal message. Theme: "keep's single RuneAssertError->422 filter is the only client-error seam; non-RuneAssert throws (unguarded body parse) escape to danet's default 500 with the raw message leaked."

### RCA #18 — TRACE request to any /api/* path returns a bare HTTP 500 (uncaught TypeError) because serveSprig re-wraps the Request with a forbidden method
- **Root cause:** The /api/* branch reconstructs the incoming request via `new Request(stripped, req)` (packages/keep/mod.ts:93) purely to rewrite the pathname, copying `req` as the init object. The WHATWG Fetch spec (and Deno's implementation in ext:deno_fetch/23_request.js) classifies TRACE, TRACK and CONNECT as "forbidden methods": the Request constructor throws `TypeError: Method is forbidden` when init.method is one of these. Combined with the second defect — the entire `fetch` handler body (mod.ts:81-101) has no try/catch — this synchronous TypeError is not converted into a routed response. The design decision to mutate the URL by round-tripping through a fresh Request, rather than copying method/headers selectively or rejecting forbidden methods first, is what ALLOWS the crash; the missing handler-level guard is what lets it escape the app.
- **Mechanism:** 1) A TRACE request hits the server; `fetch` (mod.ts:81) computes path. 2) path starts with the api prefix, so control enters the /api/* branch (mod.ts:90-93). 3) Line 91-92 build `stripped` (a URL with rewritten pathname). 4) Line 93 calls `new Request(stripped, req)`: because `req.method === "TRACE"` is a forbidden method, the Request constructor synchronously throws `TypeError: Method is forbidden` (Deno: ext:deno_fetch/23_request.js newInnerRequest/method validation) BEFORE the Promise.resolve wrapper or `config.keep.handler` is ever reached. 5) Since the handler body (mod.ts:81-101) has no try/catch, the TypeError propagates out of `fetch` to Deno's top-level Deno.serve error path, which emits a bare `500 Internal Server Error` with no content-type and no x-request-id (keep's error handler never runs). 6) By contrast: GET/HEAD/PUT/DELETE/PATCH/OPTIONS/PROPFIND/FOOBAR are not forbidden, so `new Request` succeeds and the request routes normally to a clean 404; and the /docs branch (mod.ts:97) forwards the original `req` without re-wrapping, so TRACE on /docs never invokes the Request constructor and gets a clean routed 404 with x-request-id — the exact behavioral asymmetry observed.
- **Root locus:** `packages/keep/mod.ts:93 (the `new Request(stripped, req)` re-wrap), enabled by the absence of any try/catch around the fetch handler body at packages/keep/mod.ts:81-101`
- **Shared root:** isolated — unique to the /api/* prefix-strip re-wrap via `new Request(stripped, req)` in serveSprig (no other branch reconstructs the Request); not shared with the interpreter/hydration/scopeCss bug families.

### RCA #19 — Not-found issue/user returns HTTP 500 instead of 404, leaking internal error text and reflecting user input — because business layer throws a generic Error that no transport-layer filter maps to a 4xx
- **Root cause:** The business layer signals a domain "resource not found" condition by throwing a generic, unclassified `throw new Error(...)` (issue/mod.ts:15, user/mod.ts:15). A plain Error carries no HTTP-status semantics, so the framework has no way to distinguish "client asked for something that doesn't exist" (a 4xx) from "the server genuinely broke" (a 5xx). keep's transport layer only maps ONE error shape — RuneAssertError (→422) — and lets every other thrown Error fall through to danet's default 500 handler (bootstrap-server/mod.ts:984-996). There is no NotFound exception type, no 404 mapping, and the not-found error message is built by interpolating the unsanitized user id, so the wrong status code, the internal-message leak, and the input-reflection are all consequences of this single design gap: domain not-found is represented as an undifferentiated server Error instead of a typed client-error condition.
- **Mechanism:** 1) Request POST /api/http/issue {"issueId":"SPR-999"} passes the validation seam: issue-get/mod.ts:15 `assert(IssueRefDto, input)` succeeds because @IsString only checks format, so a well-formed-but-nonexistent id is accepted. 2) getCore (issue-get/mod.ts:27) calls Issue.assemble(input.issueId). 3) In business/issue/mod.ts:14 `ISSUES.find(c => c.id === issueId)` returns undefined, so line 15 executes `throw new Error(\`no issue with id \"${issueId}\"\`)` — a GENERIC Error subclass, carrying no HTTP status and interpolating the raw user-supplied id into its message. 4) This Error propagates out of the coordinator (no try/catch maps it). 5) keep's single global exception filter (keep bootstrap-server/mod.ts:976-998) duck-types ONLY for RuneAssertError (name==='RuneAssertError' && Array.isArray(failures)) → 422; for everything else it `return undefined` (line 996), falling through to danet's default error handler. 6) danet's default renders an unclassified Error as HTTP 500 with body {status:500, message: err.message}. Net: the not-found becomes 500 (vs expected 404), the internal error text leaks, and the attacker-controlled id (e.g. \"<script>x</script>\") is reflected verbatim in the JSON message. The user path is identical: user-get/mod.ts → business/user/mod.ts:14-15.
- **Root locus:** `backend/src/board/domain/business/issue/mod.ts:15 (and the identical backend/src/board/domain/business/user/mod.ts:15) — throwing a plain `new Error(...)` for a domain not-found condition, which carries no HTTP-status semantics and embeds raw user input`
- **Shared root:** business not-found represented as a generic `throw new Error(...)` with no 404/typed-client-error mapping (keep's exception filter maps only RuneAssertError→422, all other Errors fall through to danet's default 500) — identical in business/issue/mod.ts:15 and business/user/mod.ts:15

### RCA #20 — scopeId is basename-only, so same-basename components in different folders share one CSS scope attribute — view encapsulation crosses folder boundaries
- **Root cause:** Component identity in the sprig compiler is derived solely from the folder BASENAME, with no path-based disambiguation. scopeId() (scope.ts:14-21) is a pure FNV-1a hash of that bare basename string, and both the build-time CSS rewrite (build.ts:128 `basename(dirname(...))` → build.ts:130 `scopeCss(css, scopeId(sel))`) and the SSR element markers (mod.ts:76/80 and render.ts:146, where comp.selector is the basename set at mod.ts:41) feed it that same bare name. Two components whose folders share a basename (shared-components/issue-card vs pages/board/components/issue-card) therefore hash to the identical scope id (sc44799d1), so one component's scoped stylesheet selects the other's elements. The same basename-only identity is what keys the SSR registry Map (mod.ts:37/41/52), so the design never distinguishes same-named components across folders at all.
- **Mechanism:** Two distinct components live at ui/src/shared-components/issue-card and ui/src/pages/board/components/issue-card. (1) BUILD side — buildCss walks every styles.css and computes its scope from the folder BASENAME only: `const sel = basename(dirname(entry.path))` (build.ts:128) then `scopeCss(css, scopeId(sel))` (build.ts:130). scopeId is a pure FNV-1a hash of that bare string (scope.ts:14-21), so scopeId('issue-card')='sc44799d1' for BOTH folders. The shared card's 19 rules in app.css are rewritten to require [sc44799d1] (verified: `grep -c sc44799d1 static/app.css` → 19). (2) SSR side — the same bare basename is hashed again to stamp element markers: mod.ts:76 `scopeAttr: scopeId(page.selector)` and render.ts:146 `const childScope = scopeId(comp.selector)`, where comp.selector is itself `basename(dir)` (mod.ts:41). So whichever issue-card the page actually renders, its elements carry the identical 'sc44799d1' bare attribute (board page: 6 such markers, each `<div sc44799d1 class=\"page-local\">`). (3) Because the rule-key selectors [sc44799d1] and the element markers sc44799d1 are produced by the same hash of the same string, the shared issue-card's stylesheet matches the unrelated page-local stub's markup — encapsulation crosses the folder boundary. Aggravating root: the SSR registry is `Map<string,ComponentDef>` keyed by `basename(dir)` (mod.ts:37,41,52), so the two folders can't even coexist — the later-walked one silently overwrites the earlier, and both would share one scope id regardless.
- **Root locus:** `ui/.sprig/compiler/scope.ts:14-21 (scopeId hashes the bare selector string), fed the basename at ui/.sprig/compiler/build.ts:128 and ui/.sprig/compiler/mod.ts:41`
- **Shared root:** component keyed by basename with no dedup/path guard (same root as the registry-collision family: identity is `basename(dir)` everywhere — SSR registry key mod.ts:41/52, build CSS key build.ts:128, island chunk name build.ts:43/81 — with no disambiguation across folders)

### RCA #21 — Unknown CSS at-rules leave their inner rules UNSCOPED, breaking view encapsulation (e.g. @starting-style, @view-transition, @font-feature-values)
- **Root cause:** scopeCss's at-rule handler in processBlock classifies at-rules into exactly two named buckets plus a "do nothing" fallthrough. The RECURSE allow-list (scope.ts:24) only enumerates @media|@supports|@container|@layer|@scope|@document, and the SKIP list (scope.ts:23) enumerates at-rules whose inner content is NOT a list of style rules (keyframes/font-face/page/property/charset/import/namespace/counter-style). Any at-rule that wraps ordinary style rules but is absent from RECURSE -- notably @starting-style, and also @view-transition group descendants etc. -- hits the unconditional else branch at scope.ts:75 (`else out += prelude + "{" + inner + "}"`), which copies the inner block verbatim without recursing through processBlock. The design defect is using a fixed allow-list for "recurse into the block" instead of a deny-list (i.e. defaulting unknown at-rules to RECURSE and only treating the known non-rule-bearing at-rules as opaque). Because @starting-style's body IS a list of style rules, the correct behavior is to recurse; the allow-list silently omits it, so its inner selectors never receive the marker attribute.
- **Mechanism:** 1) buildCss (build.ts:125-131) walks every component's styles.css and calls scopeCss(css, scopeId(sel)) (build.ts:130), pushing each result into `parts`. 2) scopeCss (scope.ts:27-29) wraps the css and calls processBlock with token `[s...]`. 3) For input like `@starting-style { .box { opacity: 0; } }`, processBlock reads the prelude `@starting-style` (scope.ts:46-56), finds term `{` and the matching close brace (scope.ts:64-70), and computes head = "@starting-style" (scope.ts:71). 4) head.startsWith("@") is true (scope.ts:72), but SKIP.test fails (scope.ts:73) and RECURSE.test fails (scope.ts:74) because @starting-style is in neither regex, so control reaches the else at scope.ts:75 which emits `prelude + "{" + inner + "}"` -- the inner `.box { opacity: 0; }` is passed through with NO call to processBlock and NO call to scopeSelectorList, so `.box` never gets `[s...]` inserted via scopeSelector/insertToken (scope.ts:88-124). 5) Contrast: a top-level `.box {...}` goes through the else at scope.ts:76-77 and becomes `.box[s...]`, and `@media screen {...}` matches RECURSE at scope.ts:74 and recurses, scoping its inner `.box`. 6) buildCss then concatenates all components' scoped CSS into one Tailwind input (build.ts:146 `parts.join("\n\n")`) compiled to a single shared app.css (build.ts:148-152). The unscoped `.box` selector from @starting-style therefore matches `.box` elements of EVERY component on the page, violating the per-component encapsulation guarantee documented at scope.ts:1-10, with no warning emitted for the unhandled at-rule.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts:75 (the unconditional else branch in processBlock), enabled by the closed RECURSE allow-list at scope.ts:24`
- **Shared root:** scopeCss at-rule classification uses a fixed RECURSE allow-list so any rule-bearing at-rule outside it is emitted unscoped (the at-rule allow-list theme in scope.ts:24/75)

### RCA #22 — Malformed template.html ships to production silently — tree-sitter produces an error AST that is serialized into the island chunk and SSR registry with no build failure
- **Root cause:** parseTemplate validates the parse result only by checking for a null tree, never for parse errors. Because tree-sitter is an error-recovering parser that returns a non-null tree (with rootNode.hasError set and ERROR/MISSING nodes embedded) for malformed input, the null guard at parse.ts:29 is the wrong validity test — a truncated/typo'd template.html passes it. The compiler has no notion of "this template failed to parse"; the error-AST is treated as a valid AST and serialized verbatim, so a broken template is indistinguishable from a good one at every downstream stage (build serialization, SSR render).
- **Mechanism:** tree-sitter is an error-recovering parser: parser.parse() (parse.ts:28) ALWAYS returns a tree for any input, inserting ERROR/MISSING nodes and setting rootNode.hasError instead of failing. parseTemplate's ONLY validity check is the null guard at parse.ts:29 (`if (!tree) throw`); it then unconditionally returns tree.rootNode at parse.ts:30 with no inspection of hasError. From there two consumers ingest the garbage tree unchecked: (1) BUILD — build.ts:42 calls parseTemplate on each template.html, then build.ts:43 does `JSON.stringify(serialize(root))` and pushes it into the island list; serialize() succeeds on an error AST (it just walks namedChildren via node.ts:9), so the truncated/garbage tree is written into isl.<sel>.ts at build.ts:78 and bundled into the immutable island chunk; the bundle step (build.ts:92-99) only fails on esbuild errors, never on AST validity, so the build exits green. (2) SSR — mod.ts:51 calls parseCached(source)→parseTemplate and stores the error rootNode as the component's template at mod.ts:52; renderDocument later feeds it to renderNodes (mod.ts:76/80), emitting broken/partial markup into the served document. No code path between the parser and either output ever reads rootNode.hasError, so malformed templates produce broken runtime markup with zero build-time signal.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/parse.ts:29-30 (the `if (!tree) throw` null-only guard, then unconditional `return tree.rootNode` with no `tree.rootNode.hasError` check)`
- **Shared root:** isolated — single missing hasError validation in the shared parseTemplate entry point; both surfacing sites (build.ts:42-43, mod.ts:51-52) inherit it from this one function rather than from independent roots.

### RCA #23 — Non-existent / invalid resource pages return HTTP 200 instead of 404 (status-code correctness)
- **Root cause:** The framework's resolve contract has no channel for communicating an HTTP status. The `Resolve` type (ui/.sprig/core.ts:234) is `(ctx) => Record<string,unknown> | Promise<Record<string,unknown>>` — a resolve can ONLY return a plain inputs object; it cannot signal "this resource was not found" to the response layer. Consequently bootstrap.fetch (core.ts:353-356) has no information on which to vary the status and hard-codes a 200 Response for every matched route. Compounding this, the service layer (BoardService.issue / UserService.profile) destructures only `{ data }` from the backend result and returns `data ?? null`, discarding the `ok`/`status` that the backend client DID surface — so even the underlying 404 signal is thrown away before it can reach a resolve. The design treats "matched route" as synonymous with "200", with no notion of a resolve-driven not-found.
- **Mechanism:** GET /ui/issues/SPR-999: matchRoute matches `issues/:id` (core.ts:340), so the unmatched-route 404 at core.ts:341 is skipped. mod.resolve runs (core.ts:349-351) → resolve.ts:7 calls BoardService.issue("SPR-999"). The backend returns non-OK, so backendClient.get returns `{ ok:false, status }` with NO data (core.ts:220-222). BoardService.issue destructures only `{ data }` and returns `data ?? null` = null (mod.ts:19-25), silently dropping the non-OK status. resolve returns `{ detail: null, id: "SPR-999" }` (resolve.ts:7) — a perfectly valid Record, indistinguishable to fetch from a successful resolve. The template renders its @else branch ("No issue with id SPR-999"). bootstrap.fetch wraps that html in `new Response(html, { headers: { "content-type": ... } })` with NO status option (core.ts:356), so Deno defaults to 200. There is no code path that maps a matched route + empty/null resolve result to a 404. Identical chain for /ui/users/nobody via UserService.profile (ui/src/services/user/mod.ts:8-15).
- **Root locus:** `ui/.sprig/core.ts:234 (Resolve type has no status channel) and core.ts:356 (Response hard-coded to default 200); the status-discarding accomplice is ui/src/services/board/mod.ts:25 (and :11,:16, plus ui/src/services/user/mod.ts:8-15)`
- **Shared root:** resolve/fetch contract has no way to signal a non-200 status — matched-route responses are unconditionally 200, and service methods collapse backend non-OK results into `data ?? null` (mod.ts:11,16,25), discarding ok/status

### RCA #24 — inject() is non-functional inside island setup() (SSR and client hydration) — setup() is never wrapped in runInInjector
- **Root cause:** The injector activation mechanism (runInInjector, core.ts:168, which is the SOLE writer of the module-level `current` variable at core.ts:158) is wired into exactly ONE code path — the route data-resolve call at core.ts:350 (`runInInjector(root, () => mod.resolve(...))`). The island setup() path was never integrated with the DI hierarchy: no Injector is created for an island and no runInInjector wrap exists around the setup() invocation on either side. Concretely, the two ctx factories that surround setup() — makeServerCtx (island.ts:7) and clientCtx (hydrate.ts:232) — build only the reactive ComponentCtx (input/output/model signals) and contain zero injector logic. The framework defines the full child-injector machinery (Injector.child route/component kinds at core.ts:122-124, clientRoot() at core.ts:153, scope "both"/"client" at core.ts:51/129) and the inject() error message + docs explicitly promise setup() as a valid injection context (core.ts:163, ResolveCtx/ComponentCtx docs), but that machinery is simply never invoked for components/islands. This is an incomplete-integration defect: the DI contract is advertised and the primitives exist, but the call sites that run user setup() code bypass them.
- **Mechanism:** SERVER: bootstrap.fetch (core.ts:334) builds `root = new Injector("server","root")` (core.ts:344) but only activates it for mod.resolve() via runInInjector at core.ts:350 — `current` is restored to undefined when that returns (core.ts:173). Rendering then proceeds: config.render → render.ts:172 `comp.island.scope(inputs)` → mod.ts:49 `def.setup(makeServerCtx(inputs))`. makeServerCtx (island.ts:7) does not call runInInjector, so `current===undefined`. Any inject() in setup() hits core.ts:162 and throws. The throw propagates up through render.ts:172 and the bootstrap.fetch handler (core.ts:334-356), which has NO try/catch, so the whole page 500s. CLIENT: hydrateIsland (hydrate.ts:176) sets el.dataset.sprigHydrated="1" (hydrate.ts:178) BEFORE calling `entry.setup(clientCtx(inputs))` (hydrate.ts:183). clientCtx (hydrate.ts:232) likewise never calls runInInjector, and clientRoot() (core.ts:153) is never set as `current`, so `current===undefined` and inject() throws at core.ts:162. The exception escapes setup() but the island is already flagged hydrated, leaving it marked-but-dead. Either way inject(), the documented capability for scope "both"/"client" services, is unreachable from setup() — only mod.resolve() (the one runInInjector call site) can use it.
- **Root locus:** `ui/.sprig/compiler/island.ts:7 (makeServerCtx) and ui/.sprig/compiler/hydrate.ts:232 (clientCtx) — neither wraps the ensuing setup() in runInInjector against a route/component child injector; the omission's enabling design fact is that core.ts has exactly one runInInjector call site (core.ts:350) and never creates a component injector for islands.`
- **Shared root:** isolated — this is the unique gap where island setup() bypasses the DI injector activation (runInInjector/current); distinct from the resolve-path DI which works.

### RCA #25 — backendClient.get() crashes (and leaks the response body) when a 200 response is not valid JSON; bootstrap.fetch has no try/catch, so resolve/render errors become unhandled rejections that surface the raw error
- **Root cause:** Two boundary operations in core.ts perform `await`-ed work that can throw, but neither is wrapped in error containment, and neither treats a successful HTTP status as untrusted content. (1) backendClient.get() treats `res.ok` (any 200-299) as a guarantee that the body is JSON and calls `await res.json()` unconditionally with no try/catch; its only `res.body?.cancel()` is inside the `!res.ok` branch, so the success-but-non-JSON path has no drain. (2) bootstrap.fetch is an async handler that awaits user-supplied `resolve()` and `render()` directly with no try/catch and no error-to-500 mapping, so any thrown Error escapes as a rejected promise carrying the raw internal message. The underlying design defect is the absence of a defensive error/response-handling boundary at these two trust edges (backend response parsing and SSR request handling).
- **Mechanism:** Part 1: caller invokes be.get("/http/board"); line 219 awaits the fetch returning a 200 with content-type text/html and a non-JSON body. Line 220 `if (!res.ok)` is false (200 is ok), so the cancel at line 221 is skipped. Control falls to line 224 `data: (await res.json())`; res.json() parses "<html>not json</html>" and throws SyntaxError "Unexpected token '<' ... is not valid JSON". Because there is no try/catch in get(), the SyntaxError propagates to the caller and, critically, res.body is never cancelled on this path — the ReadableStream is left undrained (resource leak). Part 2: app.fetch(Request /ui/boom) runs bootstrap.fetch (line 334). matchRoute succeeds; line 349 mod.resolve exists; line 350 `await runInInjector(root, () => mod.resolve!(...))` invokes the module's resolve which throws Error("resolve exploded: secret stack detail"). The async fetch has no try/catch (lines 334-357), so the rejection propagates straight out of app.fetch with the raw internal message; no Response with status 500 is constructed, and the secret detail is exposed. The identical gap exists for the awaited config.render at line 354.
- **Root locus:** `ui/.sprig/core.ts:224 (unguarded `await res.json()` with no body cancel on throw) and ui/.sprig/core.ts:349-356 (unguarded `await resolve()`/`await render()` in bootstrap.fetch with no try/catch → no 500 mapping)`
- **Shared root:** missing error-containment boundary around awaited trust-edge operations in core.ts (untrusted backend-response parsing and unguarded SSR resolve/render) — both surface uncaught errors/leaks instead of a controlled fallback

### RCA #26 — Concurrent rebuilds race the same outDir and corrupt the dev bundle (no in-flight guard on the debounced watcher)
- **Root cause:** The dev watcher's debounce serializes only the pre-build event burst, not the builds themselves. The single shared `timer` (dev.ts:37) is reset by `clearTimeout(timer)` (dev.ts:43), but `clearTimeout` only cancels a timer that has NOT yet fired. Once a timer fires, `handleChange(paths)` is launched as a non-awaited, fire-and-forget promise from a SYNCHRONOUS `setTimeout` callback (dev.ts:44-48 — `handleChange(paths).catch(...)` with no `await`, no in-flight flag, no queue). buildClient (dev.ts:75) is a long-running (>1s with Tailwind) async op that mutates a SHARED `outDir` non-atomically: it deletes every .js/.js.map in outDir (build.ts:86-89) and then writes the same stable filenames via `deno bundle --outdir outDir` (build.ts:92-96), and also creates/deletes a single shared `.gen` dir (build.ts:49, 100). With no concurrency guard (grep for `inFlight|lock|mutex|busy|running|queue|chain` across dev.ts/hmr.ts finds none), a second event burst arriving during a running build schedules a fresh timer that fires a SECOND overlapping buildClient against the same outDir/.gen. Two delete-all-then-rewrite passes on one directory cannot interleave consistently — that is the underlying defect.
- **Mechanism:** 1) User saves island logic.ts; after 60ms the timer fires and `handleChange([logic.ts])` (dev.ts:44-47) starts buildClient (dev.ts:74-75). 2) buildClient generates entries into the shared genDir (build.ts:49,81), then build.ts:85-90 mkdir+readDir+removes all .js/.js.map in outDir, then build.ts:92-96 runs `deno bundle` (>1s with build.ts:103 buildCss/Tailwind). 3) Within that window a second save adds to `pending` and, because the first timer already fired, `clearTimeout` (dev.ts:43) has nothing to cancel, so a new 60ms timer (dev.ts:44) fires a SECOND `handleChange`/buildClient — nothing checks the first is still running (no await on dev.ts:47, no flag). 4) The interleave: the second run's build.ts:86-89 cleanup deletes the first run's freshly emitted client.js/isl.*.js/chunk-*.js; both runs' `deno bundle --outdir outDir` (build.ts:92-96) write identical filenames concurrently; either run's `Deno.remove(genDir)` (build.ts:100) can yank the other's bundle inputs. 5) The first run's collection phase (build.ts:108-115: readDir → Deno.stat → shortHash→Deno.readFile, build.ts:172) races the other's Deno.remove and throws NotFound → throw `client bundle failed` (build.ts:98) or stat/read error → caught at dev.ts:47 → `{type:"error"}` pushed. 6) On a non-erroring race, build.ts:116-119 writes a manifest.json describing a partial/stale outDir, and dev.ts:76 pushes `{type:"reload"}` to a client that then loads the half-written bundle.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/dev.ts:44-48 (the synchronous setTimeout callback fires handleChange→buildClient with no await/in-flight guard/queue); the corruption it enables lives in build.ts:85-100 (delete-all-then-rewrite of the shared outDir + shared .gen dir, which is not safe under concurrent invocation)`
- **Shared root:** isolated — this is the only bug rooted in the dev watcher's lack of build serialization (debounce coalesces event bursts but does not chain/queue overlapping buildClient runs against a non-atomically-mutated outDir). Distinct from the AST/interpreter, hydrate-innerHTML, and scopeCss themes.

### RCA #27 — Dev island AST fetch has no response.ok / error handling: a 404 from /_sprig/ast/<sel> makes r.json() throw, leaving a permanently dead island + unhandled promise rejection
- **Root cause:** fetchAst() at ui/.sprig/compiler/hydrate.ts:64-66 treats the AST endpoint as if it were a contract that always returns 200-with-JSON. It pipes the raw Response straight into r.json() with no HTTP-status validation (`if (!r.ok) throw ...`) and the caller it feeds — the dev island chunk template emitted at build.ts:70-71 — wires `fetchAst(...).then((t) => registerIsland(...))` with no `.catch`. So the entire dev AST-load path has zero error handling at both the producer (fetchAst) and consumer (generated chunk) levels, even though the very same file already establishes the intended graceful-failure pattern in loadIsland() (hydrate.ts:129-132). It is a missing-validation / missing-rejection-handler defect, not a logic error in what the code does on the happy path.
- **Mechanism:** When the renderer no longer registers a selector (folder renamed/deleted, or a stale chunk references an unknown selector), astFor(sel) returns null, so the dev AST endpoint takes its non-OK branch and returns `new Response("not found", { status: 404 })` with a plain-text body (dev.ts:104-106). The dev island chunk (build.ts:70-71) calls `fetchAst(__cfg.base, sel)`. Inside fetchAst (hydrate.ts:65) the fetch resolves to that 404 Response; because there is no `r.ok` guard, control proceeds to `r.json()`, which attempts to JSON.parse the body `"not found"` and throws `SyntaxError: Unexpected token 'o' ... is not valid JSON`. That rejection propagates out of fetchAst's returned promise into the chunk's `.then((t) => registerIsland(...))` chain (build.ts:70-71). Since that chain has no `.catch`, two things happen: (1) registerIsland(sel, ...) is never called, so registry.set + hydratePending never run, the `sprig-island[data-sel=...]` element is never hydrated and stays interactivity-dead with no recovery; (2) the unhandled rejection surfaces as a global `unhandledrejection`. Contrast with the prod loader path (hydrate.ts:129-132) where the dynamic `import(...).catch((err) => { loading.delete(sel); console.error('[sprig] failed to load island ...'); })` swallows and logs the failure — the dev fetch path simply lacks this equivalent guard.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:64-66 (fetchAst — no r.ok check before r.json()); compounded by the missing .catch in the dev chunk template at ui/.sprig/compiler/build.ts:70-71`
- **Shared root:** dev AST-fetch path lacks the graceful-failure handling (response.ok check + .catch) that the prod island loader at hydrate.ts:129-132 already models — missing fetch/response error handling

### RCA #28 — Route :id param is never URL-decoded: percent-encoded segments mis-match the backend and the raw encoding is reflected in the page
- **Root cause:** The UI routing layer captures dynamic path params directly from the percent-encoded pathname and never applies decodeURIComponent. In walk() (ui/.sprig/core.ts:302), a ":param" segment is bound with `params[rs[i].slice(1)] = u;` where `u` is the raw segment taken from `pathname.split("/")`. The pathname itself comes from `url.pathname` (core.ts:336), which the WHATWG URL spec preserves in its percent-encoded form. There is no decode step anywhere in the param-extraction path (the only decodeURIComponent in ui/.sprig lives at compiler/dev.ts:103, used solely for the dev AST-fetch route, not routing params). So the captured `params.id` is the encoded literal, not the actual resource id the browser/RFC convention implies.
- **Mechanism:** 1) A request for e.g. /ui/issues/SPR%2D101 enters bootstrap.fetch; `path = url.pathname` (core.ts:336) is "/ui/issues/SPR%2D101" with encoding intact. 2) matchRoute (core.ts:290-293) splits on "/" without decoding, and walk() (core.ts:302) stores the raw segment: params.id = "SPR%2D101". 3) The resolve consumers pass this raw value straight through: ui/src/pages/issue/resolve.ts:7 calls `board.issue(ctx.params.id)` and ui/src/pages/user/resolve.ts:6 calls `user.profile(ctx.params.id)`. 4) The service sends it verbatim to the backend — board/mod.ts:23 `body: JSON.stringify({ issueId })` (and user/mod.ts likewise) — where the lookup is an exact string match. "SPR%2D101" != "SPR-101", so the backend returns nothing and the component renders the 'missing' branch. 5) The same undecoded `id` is also returned for reflection (`id: ctx.params.id`), so the page shows `No issue with id "SPR%2D101"` / `No user with id "jos%C3%A9"` — raw escapes instead of the decoded SPR-101 / josé. Any id containing a character a client/link percent-encodes (unicode username, space, or an over-encoded hyphen like %2D) silently fails to resolve a valid resource.
- **Root locus:** `ui/.sprig/core.ts:302 (walk() binds `params[rs[i].slice(1)] = u;` with the raw, still-encoded segment — no decodeURIComponent), with the encoding originating at ui/.sprig/core.ts:336 (`let path = url.pathname`).`
- **Shared root:** isolated — this is specific to the routing layer omitting URL decoding of captured path params in walk(); the resolve.ts consumers and services merely forward the already-undecoded value.

### RCA #29 — Soft-nav fetch rejection (network/abort/HTTP error) is unhandled: navigation fails with no full-nav fallback, leaving the page stuck
- **Root cause:** The soft-nav intercept handler treats the network fetch as if it can only succeed: its async body (hydrate.ts:151-170) awaits `fetch(...)` at line 152 with no try/catch, so a fetch REJECTION has no recovery path. The design correctly recognizes that a soft-nav can fail and must degrade to a real browser navigation — it does exactly that for one failure mode (response parsed but no <sprig-outlet>, lines 157-159 call location.assign) — but the developer only guarded the post-fetch logical-failure case and never the pre/in-fetch transport-failure case. There is no catch that mirrors the missing-outlet fallback (and no `e.signal.aborted` check to suppress fallback for superseding navigations), so any rejected fetch escapes the handler, the Navigation API marks the navigation as errored, the URL rolls back, and the page is left unchanged with no full-nav fallback.
- **Mechanism:** The "navigate" listener (hydrate.ts:144) calls e.intercept({...}) with an async handler() (hydrate.ts:151-170). The handler's first statement is `const html = await fetch(e.destination.url,{signal:e.signal}).then(r=>r.text())` (hydrate.ts:152). This await is NOT wrapped in try/catch — the handler body has no error handling at all (hydrate.ts:151-170). When the fetch promise rejects (network offline, DNS/TLS failure, connection refused, or an abort that surfaces as an AbortError throw rather than being caught by the `if(e.signal.aborted)` guard at line 153), the rejection propagates out of handler(). Per the Navigation API contract, intercept's handler promise rejecting causes the navigation to fail: the browser fires `navigateerror`, rolls the address-bar URL back to the previous entry, and does NOT load the destination. Because the DOM swap (lines 161-165) only runs on the success path after the await resolves, nothing updates and no fallback fires — the user is stranded on the old page. Critically, the missing-outlet failure mode IS handled: lines 157-159 explicitly call `location.assign(e.destination.url)` to fall back to a real browser navigation. So the code already establishes "on this kind of soft-nav failure, fall back to full nav," but only for the parsed-response/missing-outlet case — it omits the same fallback for the transport-layer (fetch-rejection) failure case, making failure handling inconsistent and leaving a dead-end navigation.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:151-152 (the async handler() whose body, beginning with the awaited fetch at line 152, is not wrapped in try/catch)`
- **Shared root:** isolated — this is a missing-error-path defect specific to the soft-nav fetch in setupSoftNav; the success/missing-outlet branches are handled, only the fetch-rejection branch is unguarded.

### RCA #30 — Soft-nav forces scrollTo(0,0) on every navigation including back/forward (traverse), destroying scroll restoration
- **Root cause:** The soft-navigation interceptor in setupSoftNav() opts out of the browser's automatic scroll restoration by passing scroll:"manual" to e.intercept() (hydrate.ts:150), but then assumes responsibility for scroll only for the forward/new-page case: swap() unconditionally calls globalThis.scrollTo(0,0) (hydrate.ts:164) with no inspection of e.navigationType. The defect is the conflation of "I took over scroll handling" with "scroll always means jump to top" — there is no per-navigation-type policy and no capture/restore of the prior scroll offset. Because the Navigation API delivers push, replace, reload, and traverse (back/forward) all through the same navigate listener and the same handler, the manual override applies the push-style "reset to top" behavior to traverse navigations where the browser would otherwise have restored the saved scrollY.
- **Mechanism:** 1. A back()/forward() call fires a 'navigate' event with e.navigationType === "traverse". 2. The guard at hydrate.ts:145-148 passes (same-origin, under cfg.base, no hashChange/formData), so e.intercept({ scroll:"manual", handler }) runs (hydrate.ts:149-150). scroll:"manual" tells the Navigation API NOT to perform its automatic scroll restoration — the framework now owns scroll. 3. The async handler fetches the destination HTML, swaps cur.innerHTML = next.innerHTML (hydrate.ts:162), re-bootstraps islands (line 163), then calls globalThis.scrollTo(0,0) (hydrate.ts:164). 4. This line is reached on EVERY navigation type because there is no branch on e.navigationType anywhere in the handler. For a 'traverse' it forces scrollY to 0, overriding the position (e.g. 400) the browser would have restored. Net result proven live: scrollBefore=400, scrollAfterBack=0. For 'push'/'replace' the scrollTo(0,0) is correct, which is why the bug only manifests on back/forward.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:150 (scroll:"manual" opt-out) combined with ui/.sprig/compiler/hydrate.ts:164 (unconditional globalThis.scrollTo(0,0) with no e.navigationType guard, inside swap() at 161-165)`
- **Shared root:** isolated — specific to the soft-nav scroll-handling policy in setupSoftNav (scroll:"manual" without a navigationType-aware restore). Distinct from the el.innerHTML wholesale re-render theme, though it shares the same swap() routine.

### RCA #31 — Soft-nav unconditionally scrolls to top on back/forward (traverse) navigations, destroying browser scroll restoration
- **Root cause:** The soft-nav intercept handler in setupSoftNav() opts out of the browser's automatic scroll restoration (scroll:"manual" at hydrate.ts:150) but then implements only ONE scroll policy — an unconditional globalThis.scrollTo(0,0) (hydrate.ts:164) — for every intercepted navigation, with no inspection of e.navigationType. By taking over scroll management ("manual") the handler assumes full responsibility for restoring scroll on traverse navigations, but never fulfills it: there is no branch that restores the prior offset for back/forward. The design defect is that the intercept treats all navigation types as fresh "push"-style navigations.
- **Mechanism:** When the Navigation API is supported, the "navigate" listener (hydrate.ts:144) fires for every same-origin <base>/* navigation including back/forward, which the API reports as e.navigationType === 'traverse'. The guard at :145 only filters hashChange/download/formData and :147-148 filter origin/base — a traverse navigation passes all of these. At :149 e.intercept is called with scroll:"manual" (:150), which tells the browser "do not auto-restore scroll; the handler owns it." The async handler() (:151) refetches the destination HTML, swaps cur.innerHTML = next.innerHTML (:162), re-arms islands (:163), and then ALWAYS calls globalThis.scrollTo(0,0) (:164) inside the swap closure. Because nothing reads e.navigationType, the traverse case takes the identical code path as push/replace: the page is forced to the top. The combination of (a) disabling native restoration at :150 and (b) the unguarded scroll-to-top at :164 means the previously saved scroll offset for the entry being traversed to is never reapplied, so every Back/Forward lands at y=0 instead of the user's prior position.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:150 (scroll:"manual") combined with :164 (unconditional globalThis.scrollTo(0,0)); the missing e.navigationType discrimination lives in the e.intercept config object spanning :149-171.`
- **Shared root:** isolated

### RCA #32 — Serialized AST collapses repeated fields, so multi-arg pipes hydrate with the LAST arg on the client vs the FIRST on the server — SSR/client divergence
- **Root cause:** The serialized AST stores field-name→child as a flat single-valued map (`f: Record<string, number>` in serialize.ts:14), so it can only remember ONE child per field name. The tree-sitter grammar, however, assigns the SAME field name `argument` to every `pipe_argument` via `repeat(field("argument", $.pipe_argument))` (grammar.js:494). When `toSNode` populates `f` (serialize.ts:35-36) it does `f[fname] = idx` once per child, so repeated `argument` children collide and the LAST one wins; all earlier indices are discarded. The native wasm node's `childForFieldName` returns the FIRST matching child, but the reconstructed `JsonNode.childForFieldName` (serialize.ts:72) returns whatever single index survived in `f` — i.e. the LAST. This representational mismatch is the underlying defect that allows server and client to disagree.
- **Mechanism:** For `{{ items | slice:1:3 }}` the grammar (tree-sitter-angular-template/grammar.js:494 `repeat(field("argument", $.pipe_argument))`) gives the `pipe_expression` node TWO children both bearing field name `argument` (values `1` and `3`). (1) SERVER: `evalPipe` (expr.ts:136-141) calls `node.childForFieldName("argument")`; the native wasm node returns the FIRST `argument` (`1`), so the `?` branch at line 140 yields `[1]` → `slice(1, undefined)` → `["b","c","d","e"]`. (2) SERIALIZE: `toSNode` (serialize.ts:25-38) builds `f` as a flat `Record<string, number>` (declared line 14). In the loop, line 36 `f[fname] = idx` runs once per child with the same key `"argument"`, so the second assignment OVERWRITES the first — `f["argument"]` now points to the LAST arg child (`3`); the first arg index is lost from the field map. (3) CLIENT: `JsonNode.childForFieldName` (serialize.ts:70-73) just returns `this.#s.f[name]` → the LAST arg (`3`). `evalPipe` takes the same `?` branch but evaluates `3` → `slice(3, undefined)` → `["d","e"]`. Server `["b","c","d","e"]` != client `["d","e"]` → hydration mismatch. The serialized field map's collapse of repeated keys silently drops all-but-last of any repeated field, making the client AST lossy relative to the wasm-backed server AST.
- **Root locus:** `ui/.sprig/compiler/serialize.ts:14 (the `f: Record<string, number>` field-map type) and :36 (`f[fname] = idx` last-write-wins overwrite), surfacing via :72 (`childForFieldName` returns that single index)`
- **Shared root:** serialize.ts field map (`f: Record<string, number>`) cannot represent repeated/duplicate field names — toSNode's last-write-wins overwrite at serialize.ts:36 makes the client JsonNode AST lossy and divergent from the native wasm tree (whose childForFieldName returns the first match)

### RCA #33 — number/percent pipe with a digitsInfo whose minFraction > maxFraction (or maxFraction > 100) throws an uncaught RangeError, crashing SSR render with HTTP 500
- **Root cause:** formatNumber (ui/.sprig/compiler/expr.ts:183-191) trusts the user-supplied digitsInfo string: it extracts minFrac/maxFrac from the regex match (line 188) and hands them directly to n.toLocaleString with {minimumFractionDigits, maximumFractionDigits} (line 190) WITHOUT (a) validating/clamping the values to the legal 0..100 range or enforcing maxFrac >= minFrac, and (b) WITHOUT any try/catch fallback. This is an asymmetry in the PIPES table: the currency pipe (expr.ts:155-162) wraps its Intl call in try/catch with a best-effort fallback, but the number and percent pipes (which both delegate to the unguarded formatNumber via expr.ts:153-154) do not. ECMA-402 mandates that Intl.NumberFormat / Number.prototype.toLocaleString throw a RangeError when maximumFractionDigits is out of range or less than minimumFractionDigits, so any contradictory digitsInfo turns into a thrown exception instead of a formatted string.
- **Mechanism:** A template interpolation like {{ value | number:'1.3-2' }} evaluates through the number pipe (expr.ts:153) -> formatNumber(Number(v), '1.3-2'). The regex /^\d+\.(\d+)-(\d+)$/ matches, so line 188 sets minFrac=3, maxFrac=2. Line 190 calls n.toLocaleString('en-US', {minimumFractionDigits:3, maximumFractionDigits:2}); since maxFrac(2) < minFrac(3), V8 throws RangeError: maximumFractionDigits value is out of range (same for '1.0-101' where max=101 > 100). The throw propagates up through evalExpr into renderNode's interpolation case (render.ts:78: escape(stringify(evalExpr(...)))), which has no try/catch, so renderNode/renderNodes rethrow. That escapes the awaited config.render call (core.ts:353-354), and the fetch handler (core.ts:334-357) wraps neither config.render nor renderDocument in try/catch. The Deno.serve handler promise therefore rejects, and Deno emits HTTP 500 for the whole page.
- **Root locus:** `ui/.sprig/compiler/expr.ts:188-190 (formatNumber: unvalidated minFrac/maxFrac fed to toLocaleString with no try/catch); aggravated by the missing top-level guard at ui/.sprig/core.ts:353-356 (no try/catch around config.render in the fetch handler)`
- **Shared root:** unguarded Intl/locale formatting in pipes feeding through to the wholesale-uncaught SSR render path (formatNumber lacks the try/catch fallback that the currency pipe has, and core.ts fetch handler has no try/catch around config.render so any render-time throw becomes a 500)

### RCA #34 — number/percent/currency digitsInfo silently ignored unless it contains the optional '-maxFraction' segment
- **Root cause:** The digitsInfo parser in formatNumber (ui/.sprig/compiler/expr.ts:187) hard-codes the regex /^\d+\.(\d+)-(\d+)$/, which makes the trailing "-{maxFraction}" segment mandatory. Angular's DigitsInfo grammar is "{minIntegerDigits}.{minFractionDigits}-{maxFractionDigits}" where ONLY the "-{maxFraction}" part is optional. Because the regex cannot match a digitsInfo string that omits "-{max}" (e.g. "1.2", "1.4"), the if-block at line 188 never fires, and the function silently falls through to its module defaults minFrac=0/maxFrac=3, discarding the caller's requested minimum-fraction padding entirely. The parser also never captures or applies the {minIntegerDigits} group, so minimumIntegerDigits is unsupported even when the regex does match.
- **Mechanism:** PIPES.number (expr.ts:153) and PIPES.percent (expr.ts:154) forward the pipe's first argument (the digitsInfo string) into formatNumber as fmt. For input like {{ 3.5 | number:'1.2' }}, fmt='1.2'. At expr.ts:187 the regex /^\d+\.(\d+)-(\d+)$/ requires a literal '-' followed by one-or-more digits at the end; '1.2' has no '-N' suffix so match() returns null. The guard at line 188 (if (m)) is false, so minFrac and maxFrac keep their line-185 defaults (0 and 3). Line 190 then calls n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 }), which renders 3.5 as "3.5" instead of Angular's "3.50". The same path makes '1.4' render "3.5" instead of "3.5000". Only when the string already contains '-{max}' (e.g. '1.0-2') does the regex match and the requested fraction digits take effect, which is why that form "works" and the bare-min form does not.
- **Root locus:** `ui/.sprig/compiler/expr.ts:187 (the regex /^\d+\.(\d+)-(\d+)$/ in formatNumber; defaults seeded at expr.ts:185)`
- **Shared root:** Angular-pipe formatting helper reimplemented with an incomplete/over-strict grammar (formatNumber's digitsInfo regex makes an Angular-optional segment mandatory and ignores the minInt group) — same theme as other partial reimplementations of Angular pipe semantics in expr.ts; otherwise isolated to the number/percent digitsInfo parser.

### RCA #35 — date pipe returns a raw ISO timestamp for every unsupported/custom format (longDate, shortTime, fullTime, 'yyyy-MM-dd', any pattern)
- **Root cause:** formatDate implements date formatting as a fixed 5-entry lookup table (opts) keyed by a handful of Angular alias names — short, medium, mediumDate, fullDate, shortDate — with no pattern-token parser and no fallback that actually formats. Any format argument outside those 5 keys is unrecognized, and the catch-all branch was implemented to emit the machine ISO timestamp (d.toISOString()) rather than a formatted/localized string. There is no handling for the other standard Angular aliases (longDate, fullTime, shortTime, longTime, mediumTime, full, long) nor for custom pattern strings (yyyy-MM-dd, MMM d, y, etc.). The defect is the incomplete alias map plus an ISO-string fallthrough being treated as the default behavior.
- **Mechanism:** The date pipe at ui/.sprig/compiler/expr.ts:163 calls formatDate(v, fmt) with the author-supplied format (default 'mediumDate'). Inside formatDate (expr.ts:193-205): line 194 parses the value into a Date; line 195 guards invalid dates; lines 196-202 define opts containing exactly 5 keys (short, medium, mediumDate, fullDate, shortDate). Line 203 does `if (opts[fmt]) return new Intl.DateTimeFormat(...).format(d)` — this only succeeds when fmt is one of those 5 literal keys. For fmt='yyyy-MM-dd', 'longDate', 'shortTime', 'fullTime', or any custom token pattern, opts[fmt] is undefined, so control falls to line 204 `return d.toISOString()`, which yields e.g. '2026-06-21T14:30:00.000Z'. That raw timestamp is returned to the pipe and rendered into the page verbatim instead of a formatted date/time.
- **Root locus:** `ui/.sprig/compiler/expr.ts:196-204 (the 5-key `opts` table and the `return d.toISOString()` fallthrough); reached via the date pipe at expr.ts:163`
- **Shared root:** isolated — specific to formatDate's incomplete date-alias table with an ISO-string fallthrough; not shared with the interpreter/hydration/scopeCss roots. (Thematically it is the same class of "pipe formatter handles only a hardcoded subset of Angular formats" as formatNumber's narrow regex at expr.ts:183-191, but the date pipe's ISO-leak defect is its own.)

### RCA #36 — :host-context(...) is mangled into invalid CSS by the :host replacement regex
- **Root cause:** The `:host` family is matched with regexes that are not anchored against the longer `:host-context(...)` pseudo-class, and the framework has no handling for `:host-context` at all. Specifically, `/:host\b/g` on scope.ts:95 uses a `\b` word-boundary that matches inside `:host-context` (the boundary sits between `t` and `-`), so the bare-`:host` replacement fires on a substring of `:host-context`, splitting that selector. The earlier `:host(...)` regexes (lines 92, 95) require `(` to follow `host` and so skip `:host-context(...)`, leaving the buggy `\b` branch as the one that (wrongly) handles it.
- **Mechanism:** Input `:host-context(.dark) .x { color:red }` reaches `scopeSelector` (scope.ts:88) with sel = `:host-context(.dark) .x`. (1) Line 91 `sel === ":host"` is false. (2) Line 92 `^:host\(([^)]*)\)$` fails because the char after `host` is `-`, not `(`. (3) Line 95 first runs `.replace(/:host\(([^)]*)\)/g, token + "$1")` — this also does NOT match `:host-context(.dark)` because `:host\(` demands `(` immediately after `host`. (4) Line 95 then runs `.replace(/:host\b/g, token)`. In JS, `\b` is a zero-width boundary between a word char (`t`, last char of `host`) and a non-word char (`-`); it therefore matches, replacing the bare `:host` substring inside `:host-context` with the token, yielding `[sX]-context(.dark) .x`. (5) Key-compound scoping (lines 98-111) finds the key compound `.x` after the space and `insertToken` (line 114) appends the token → `.x[sX]`. Final output: `[sX]-context(.dark) .x[sX] { color:red }` — exactly the reported actual. `-context(.dark)` is a dangling, invalid token-prefixed fragment, so the rule is invalid/non-matching and silently never applies.
- **Root locus:** `ui/.sprig/compiler/scope.ts:95`
- **Shared root:** scope.ts :host replacement regexes do not account for :host-context (the /:host\b/g word-boundary mismatches the longer pseudo-class)

### RCA #37 — Escaped colon in class names (Tailwind-style .hover\:flex, .md\:block) gets the scope token inserted mid-token, breaking the selector
- **Root cause:** The pseudo-selector locator in insertToken — `compound.match(/::?[\w-]/)` at scope.ts:120 — has no awareness of CSS backslash escaping. It treats every `:` followed by a word/hyphen char as the start of a pseudo-class/element, including a backslash-escaped `\:` that is actually part of a class identifier. Because the token is meant to be inserted immediately before the first pseudo, this mis-detection causes the scope token to be spliced into the middle of an escaped class name. The underlying design defect is that selector compounds are scanned with a context-free regex that does not track escape state (an odd number of preceding backslashes makes the colon literal, not a pseudo boundary).
- **Mechanism:** In insertToken (scope.ts:114-124), the token must go before the first real pseudo-selector so `.a:hover` becomes `.a[sX]:hover`. Line 120 finds that pseudo with `const m = compound.match(/::?[\w-]/)`. This regex is escape-blind: it matches ANY `:` or `::` followed by `[\w-]`, including a backslash-escaped colon `\:` that is part of a CSS class identifier (Tailwind utilities like `.hover\:bg-red` are the literal class `hover:bg-red`). For `.hover\:bg-red`, the regex matches the escaped `:` and reports m.index at the position of that colon (right after the backslash). Lines 121-123 then do `compound.slice(0, m.index) + token + compound.slice(m.index)`, splicing `[sX]` between the backslash and the colon: `.hover\` + `[sX]` + `:bg-red` = `.hover\[sX]:bg-red`. This breaks the backslash escape and the class name, so the rule no longer matches the element's `hover:bg-red` class and all scoped styling for that compound is lost. The `.plain:hover` case is handled correctly only because its colon is a genuine unescaped pseudo, where inserting the token before the colon is the intended behavior. The single regex cannot distinguish an escaped class-name colon from a real pseudo-class colon.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts:120`
- **Shared root:** scopeCss compound/selector scanner ignores CSS escape (\\) and string/identifier context — the pseudo-selector locator regex /::?[\w-]/ has no escape-state tracking, so backslash-escaped colons in class identifiers are mis-detected as pseudo-element/class boundaries.

### RCA #38 — stripComments() is not string/url-aware: a /*...*/ sequence inside a CSS string or url() value is deleted, silently corrupting the emitted stylesheet
- **Root cause:** scopeCss strips CSS comments with a single context-free regex — stripComments (ui/.sprig/compiler/scope.ts:31-33) does `s.replace(/\/\*[\s\S]*?\*\//g, "")` — which has no notion of CSS lexical context. The CSS grammar says a `/*...*/` comment token cannot occur inside a string literal ("..." / '...') or inside the contents of a url(...) token; those `/*` and `*/` characters are ordinary string/URL data. The regex treats them as comment delimiters anyway, so it deletes any text spanning a `/*` to the next `*/` regardless of whether that span lies inside a quoted value or a url(). Because stripComments runs FIRST (scopeCss line 28 calls it before processBlock ever sees the text), the corruption happens before any of the depth-tracking parsing that the rest of the file does, and it is irreversible.
- **Mechanism:** buildCss (ui/.sprig/compiler/build.ts:127-130) walks every component's styles.css and for each calls scopeCss(css, scopeId(sel)). scopeCss (scope.ts:27-29) does `processBlock(stripComments(css), ...)`, so stripComments (scope.ts:32) runs on the raw stylesheet first. (1) For `.a { content: "/* not a comment */"; }` the regex matches the span from the `/*` inside the string to the `*/` inside the string and deletes it, yielding `content: ""` — the entire string value is destroyed. (2) For `.a { background: url(http://x/*y*/z.png); }` the regex matches `/*y*/` inside the URL and deletes it, yielding `url(http://xz.png)` — a silently rewritten, now-404 URL. processBlock then dutifully scopes the (already-corrupted) selector to `.a[s12345678]`, so the final per-component string is e.g. `.a[s12345678] { content: ""; }`. buildCss concatenates these scoped strings into `parts` (build.ts:130), splices them into the Tailwind input (build.ts:146), and the Tailwind CLI emits them into the shared out/app.css (build.ts:151). The corruption therefore ships in the production stylesheet. Note the rest of scope.ts (processBlock:46-55, scopeSelector:98-108, splitTop:128-139) carefully tracks ()/[] depth but NONE of these — including stripComments — track quote or url() context, so the same blind spot recurs throughout.
- **Root locus:** `ui/.sprig/compiler/scope.ts:31-33 (stripComments — the regex /\/\*[\s\S]*?\*\//g with no string/url context tracking); invoked at scope.ts:28 inside scopeCss`
- **Shared root:** scope.ts CSS parsing ignores string/url() lexical context — the whole module (stripComments at 31-33, processBlock prelude/block scanning at 46-55/65-69, scopeSelector key-compound scan at 98-108, splitTop at 128-139) tracks only ()/[] nesting and never tracks "/'/url() string context, so any CSS delimiter character appearing inside a string literal or url() value is mis-handled

### RCA #39 — Nested CSS style rules are never scoped: inner selectors keep no scope marker, breaking the rightmost-only encapsulation guarantee
- **Root cause:** processBlock's CSS-rewriting design predates / does not account for native CSS nesting: it assumes a style rule's body is opaque declaration text that needs no further rewriting. The else branch for non-at-rules (scope.ts:76-78) scopes only the rule's own prelude selector and re-emits the rule body (`inner`) unmodified, and the only recursive-descent path (RECURSE, scope.ts:74) is gated to a fixed allowlist of at-rules (@media/@supports/etc.). A nested style rule lives inside a non-at-rule body, so it falls through both gates: its prelude is never passed back through processBlock/scopeSelectorList, and its key compound therefore never receives the scope marker. The defect that ALLOWS the bug is the absence of any recursion into bare style-rule bodies — the rewriter treats nested rules as plain text rather than as scopable rules.
- **Mechanism:** processBlock (scope.ts:35-82) tokenizes a block by reading a prelude up to `{`/`;`/`}` then finding the matching close brace (lines 46-69), yielding prelude + inner. For a non-at-rule it takes the else branch at scope.ts:76-78: `out += scopeSelectorList(prelude, token) + " {" + inner + "}"`. It scopes ONLY the prelude selector list and concatenates `inner` VERBATIM — it never calls processBlock(inner, token). The only recursive descent is the RECURSE gate at scope.ts:74, which matches solely at-rules (@media/@supports/@container/@layer/@scope/@document); a bare nested style-rule body never matches it. Trace for `.card { .title { font-weight: bold; } }`: at the outer block prelude=`.card`, head does not start with `@`, so the else branch (76-78) runs: prelude becomes `.card[sN]` via scopeSelectorList, and inner=` .title { font-weight: bold; } ` is appended unchanged. The inner `.title` rule is thus never fed back into processBlock, so its key compound never reaches scopeSelector/insertToken and gets no `[sN]` marker. Verified by running the repro: nested => `.card[sN] { .title { font-weight: bold; } }` (no marker on .title), amp => `.card[sN] { color:red; & .title { color:blue; } }` (no marker), whereas the equivalent flat selector `.card .title` correctly yields `.card .title[sN]`. Under native CSS nesting `.card[sN] { .title {...} }` resolves to `.card[sN] .title`, a descendant selector with no marker on the styled element, so it matches ANY .title descendant — including .title elements owned by a different child component — breaking the rightmost-only encapsulation guarantee stated in the module header (lines 7-10).
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/scope.ts:76-78 (else branch emits `inner` verbatim, no recursion), with the missing-case gate at scope.ts:74 (RECURSE matches only at-rules, never nested style-rule bodies)`
- **Shared root:** scopeCss processBlock does not recurse into non-at-rule (style-rule) bodies, so nested CSS rules are treated as opaque text and never scoped (related to the family of scopeCss limitations, but specifically: the RECURSE allowlist + verbatim-inner else branch ignore CSS nesting)

### RCA #40 — :host-context(...) selector is corrupted by the :host replacement, producing invalid CSS that never matches
- **Root cause:** The :host rewrite uses a word-boundary regex (/:host\b/g) that does NOT account for the functional pseudo-class :host-context(). `\b` treats the `-` after "host" as a boundary, so the matcher splits ":host-context" mid-token, replacing only ":host" and corrupting the selector. The code only ever anticipated three :host forms — bare `:host`, `:host(x)`, and `:host <descendant>` — and never special-cased `:host-context(...)`, which is a distinct CSS pseudo-class, not `:host` followed by anything. Compounded by insertToken (scope.ts:114-124), whose "already scoped" guard (endsWith(token), line 118) and pseudo-detection (line 120) both miss the malformed fragment, so it blindly appends a second token.
- **Mechanism:** scopeCss → processBlock reads prelude ":host-context(.dark)" and dispatches to scopeSelectorList → scopeSelector (scope.ts:77,85,88). (1) Line 91 ":host" exact match fails; (2) lines 92-93 the anchored /^:host\(([^)]*)\)$/ fails because the token after `host` is `-context(`, not `(`; (3) line 95 first replace /:host\(([^)]*)\)/g also fails (the `(` is not adjacent to `host`), then .replace(/:host\b/g, token) FIRES: the regex `\b` is a zero-width boundary that exists between the word char `t` (end of "host") and the non-word char `-`, so it matches the literal substring ":host" inside ":host-context" and rewrites it to "[sXX]", leaving the dangling tail → "[sXX]-context(.dark)". (4) Lines 99-108 find no top-level combinator, so keyStart=0 and head="" (line 110-111). (5) insertToken("[sXX]-context(.dark)", "[sXX]") at line 114: line 118 endsWith(token) is false (string ends with "(.dark)"), line 120 finds no pseudo-class colon, so line 123 appends a SECOND token → "[sXX]-context(.dark)[sXX]". Final emitted rule (line 77): "[sXX]-context(.dark)[sXX] { x:1 }" — syntactically invalid (a tag/type-ident cannot begin with an attribute selector and `-context(...)` is not a valid simple selector), so the browser drops the rule and the themed style never applies.
- **Root locus:** `ui/.sprig/compiler/scope.ts:95`
- **Shared root:** scopeSelector :host handling is regex/boundary-based and mishandles :host variants (here :host-context). Related theme: scope.ts :host/selector rewriting via naive regexes that ignore CSS token structure — same family as the /:host\b/ and insertToken pseudo-matching defects.

### RCA #41 — A failing template reparse silently drops batched CSS/reload updates in the same debounce window
- **Root cause:** handleChange treats a batch of heterogeneous file changes as one all-or-nothing transactional unit instead of independent per-kind sub-tasks. It runs template reparse, css rebuild, and reload sequentially in a single async function with the only error handling being one outer `.catch` at the call site (dev.ts:47). There is no try/catch around the individual template/css/reload sections, so any rejection from the FIRST-executed section (the template loop, dev.ts:61-66, whose `await cfg.renderer.reparse(sel)` can throw via Deno.readTextFile ENOENT at mod.ts:87 or `parseTemplate` returning-null throw at parse.ts:29) aborts the rest of the function before the css (dev.ts:68-72) and reload (dev.ts:74-78) blocks can execute. The ordering (templates first) plus lack of fault isolation is the underlying design defect that ALLOWS one transient/broken kind of change to suppress unrelated, independently-valid updates batched in the same 60ms debounce window.
- **Mechanism:** handleChange (dev.ts:52-79) classifies all batched paths into `templates[]`, `css`, `reload` (dev.ts:55-59), then processes them sequentially in ONE async function body with no per-section error isolation: (1) template loop dev.ts:61-66, (2) css dev.ts:68-72, (3) reload dev.ts:74-78. The template loop awaits `cfg.renderer.reparse(sel)` (dev.ts:62). reparse (mod.ts:84-90) awaits `Deno.readTextFile(path)` — which rejects with ENOENT when an atomic-save tool has renamed/replaced template.html — and `parseTemplate` (parse.ts:26-31) which throws `template parse returned null` (parse.ts:29) when the tree-sitter parse yields null on a broken edit. Because the `await` at dev.ts:62 is not wrapped in try/catch, the rejection short-circuits the entire `handleChange` async body: the css block (dev.ts:68-72, emitting `{type:'css'}`) and reload block (dev.ts:74-78) for the SAME batch never run. The rejected promise is caught only by the single `.catch` registered at the call site (dev.ts:47), which emits `{type:'error'}` and nothing else. Net effect: a co-edited stylesheet's `buildCss` + `css` SSE swap is silently dropped for that debounce batch; the client keeps the stale stylesheet until an unrelated later save re-triggers handleChange with a now-parseable template.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/dev.ts:52-79 (handleChange body — single un-isolated async sequence), with the failure entry point at dev.ts:61-62`
- **Shared root:** handleChange has no per-section fault isolation: one failing batched change kind aborts the rest of the same debounce batch

### RCA #42 — Malformed JSON request body returns 500 instead of 400 and leaks the parser error
- **Root cause:** keep's single global exception filter (registered in bootstrapServer) only classifies ONE error shape as a client fault — a RuneAssertError (duck-typed on name + Array failures) → HTTP 422 — and returns `undefined` for every other thrown error, deliberately delegating to danet's defaults. There is NO handling for the SyntaxError that danet's `@Body()`/`request.json()` throws when the inbound JSON is syntactically invalid. Because that parse happens INSIDE danet's body injection (before any keep/Rune assert seam runs), the SyntaxError is a plain Error, not a RuneAssertError and not an HttpException, so the filter passes it through and danet's default error path renders it as 500 with the raw `err.message` echoed. The design decision that a malformed/empty body is treated identically to an internal server crash (rather than being mapped to a 4xx and having its message scrubbed) is the underlying defect.
- **Mechanism:** Request flows: serveSprig dispatch (packages/keep/mod.ts:91-95) strips /api and forwards to config.keep.handler → DanetHttpAdapter.handler → hono.fetch → danet routes to the @Endpoint handler. The @Endpoint decorator (endpoint-decorator/mod.ts:124-131) wires danet's @Body() + BodyType to inject the parsed DTO; danet's body injection calls request.json(), which on the body `{"issueId":` throws a native SyntaxError 'Unexpected end of JSON input'. That throw unwinds to keep's process-wide global exception filter (bootstrap-server/mod.ts:976-998): the catch checks `e?.name === 'RuneAssertError' && Array.isArray(e.failures)` (line 984) — false for a SyntaxError — and hits `return undefined` (line 996), which tells danet to apply its default exception rendering: HTTP 500 with body {status:500, message: err.message}, reflecting the raw parser string to the caller. keep's only other body read (request-logger readBody, request-logger/mod.ts:138-157) wraps its JSON.parse in try/catch and cannot be the 500 source, confirming the danet @Body parse is the origin. Contrast: a well-formed `{}` parses fine, reaches the Rune assert seam, throws RuneAssertError, matches line 984, and correctly returns 422 — proving the gap is specifically the pre-assert parse step, exactly as the repro states.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/keep/src/foundation/domain/coordinators/bootstrap-server/mod.ts:984-996 (the global exception filter's catch: only RuneAssertError→422, `return undefined` for all else falls through to danet's 500-with-message default)`
- **Shared root:** keep's global exception filter classifies only RuneAssertError as a client error and lets every other throw fall through to danet's default 500-with-message — any bug where a pre-assert/parse-layer or other non-Rune client fault surfaces as a 500 leaking the raw error string shares this root

### RCA #43 — issue.assemble relateds field is not actually 'related' — always the first 3 issues in seed order excluding self
- **Root cause:** The `relateds` list is produced by a placeholder positional selection rather than any relevance computation. `Issue.assemble` filters out only the subject issue and then blindly `.slice(0, 3)` the remaining ISSUES array in its static seed order, never consulting the data (tags, status/column, assignees) that would establish a relationship. The scaffolded stub body (this file is marked "Generated by rune manifest... Scaffolded once; fill in the bodies." at mod.ts:1-2) was shipped with the trivial first-three implementation and the actual similarity logic was never filled in, so the field's name/DTO contract ('a lean issue summary shown in the related list') is unmet by design — there is no code anywhere that scores or ranks candidate issues against the subject.
- **Mechanism:** In `Issue.assemble` (mod.ts:18-25), `relateds` is computed with three positional array operations and zero relevance logic: (1) line 19 `.filter((candidate) => candidate.id !== issueId)` removes only the subject issue, preserving the original seed order of ISSUES (defined board/mod.ts:27-82, SPR-101..SPR-106); (2) line 20 `.slice(0, 3)` unconditionally takes the FIRST three survivors of that ordered array; (3) lines 21-25 `.map(...)` projects id/title/status. Because the subject issue is the only one removed, the first three survivors are deterministic by position: for any subject that is NOT among SPR-101/102/103 (i.e. SPR-104, SPR-105, SPR-106), none of the top three is removed, so the slice is always [SPR-101, SPR-102, SPR-103]. For SPR-101 the subject is removed from the head, shifting the window to [SPR-102, SPR-103, SPR-104]. The `tags` field (board/mod.ts:34,43,52,61,70,79) and `status` field that a real similarity metric would consult are never read, so SPR-103/SPR-104 (both tagged 'router') are not preferred over unrelated issues, and unrelated issues (SPR-104 'router/done' vs SPR-105 'build') yield byte-identical related lists. The symptom (identical/misleading related lists) follows directly from the slice-without-scoring.
- **Root locus:** `backend/src/board/domain/business/issue/mod.ts:18-20 (the `.filter(!== id).slice(0, 3)` chain — specifically the absence of any relevance sort/predicate before the slice)`
- **Shared root:** isolated — this is a stub business-logic body (file header at mod.ts:1-2 marks it as rune-scaffolded "fill in the bodies"); the related-issue selection was never implemented beyond a positional placeholder, unrelated to the interpreter/hydration/scopeCss bug families.

### RCA #44 — Dashboard "recent activity" feed is returned in seed/insertion order, not sorted descending by its `at` timestamp
- **Root cause:** The dashboard aggregator treats the persisted/seed `ACTIVITY` collection as if its physical array order already equals the desired presentation order. `Dashboard.assemble()` returns the activity feed verbatim with no sort by `ActivityDto.at`, so the contract's "recent activity" (newest-first) ordering is never materialized — ordering is left implicit in the seed data's insertion order, which is not maintained descending by timestamp.
- **Mechanism:** In `Dashboard.assemble()` (dashboard/mod.ts:23-28), the returned object sets `activitys: ACTIVITY` (line 27), passing the module-level seed array straight through with zero transformation — no `.slice().sort(...)`, no comparator on the `at` field. The seed `ACTIVITY` (board/mod.ts:100-106) is hand-authored in arbitrary editorial/insertion order, where the `at` timestamps are a1=2026-06-19T14:12, a2=2026-06-18T08:30, a3=2026-06-19T08:45, a4=2026-06-11T13:30, a5=2026-06-12T16:20 — visibly non-monotonic (a3 is newer than a2 but appears after it; a5 is newer than a4 but appears after it). Because `assemble()` performs no ordering, the array's declaration order IS the serialized response order, so the JSON `activitys` list comes out a1,a2,a3,a4,a5 instead of the descending-by-`at` order a1,a3,a2,a5,a4 that a 'recent activity' feed implies. The JSDoc on `assemble()` (lines 9-11) and the DashboardDto contract document it as 'recent activity', but the implementation never enforces recency ordering.
- **Root locus:** `backend/src/board/domain/business/dashboard/mod.ts:27`
- **Shared root:** aggregate assemble() returns seed collections verbatim with no domain sort/ordering applied (presentation order assumed to equal array insertion order)

### RCA #45 — shortHash concatenates raw file bytes with no length/name delimiters — the 64-bit cache-buster `v` is vulnerable to boundary-shift collisions across build outputs
- **Root cause:** `shortHash(paths)` computes the build's content-addressed cache-buster `v` over an UNFRAMED concatenation of the sorted output files' raw bytes. The function (ui/.sprig/compiler/build.ts:170-184) reads every file into `parts`, then copies each buffer end-to-end into a single `all` Uint8Array using only `all.set(b, off); off += b.length;` (lines 174-179) before SHA-256 (line 180) and truncation to 8 bytes / 64-bit hex (line 183). It mixes in neither the filename nor any per-file length prefix nor delimiter. Because the digest input is just `contentA ‖ contentB ‖ …`, it is a function of the total concatenated byte stream and is BLIND to where the boundaries between files lie or which file owns which bytes. Any two distinct output sets whose concatenations are byte-identical (a boundary shift, or one file going empty while a neighbor absorbs its bytes) produce the same `v`. That is the design defect that ALLOWS the collision.
- **Mechanism:** 1) build.ts:106-113 collects the output set (all `*.js` plus `app.css`) into `files`. 2) build.ts:115 calls `shortHash(files.slice().sort().map(f => join(outDir, f)))`, passing only sorted absolute PATHS. 3) Inside shortHash, build.ts:172 reads each file's bytes; lines 173-179 flatten them into one contiguous `all` buffer with `all.set(b, off); off += b.length;` — the loop emits no separator and no length/name field, so the only thing that survives into the digest is the running concatenation. 4) build.ts:180 hashes `all`; line 183 slices to 64 bits. 5) Two output sets that differ only in how identical total bytes are partitioned across files (e.g. {abc, def} vs {ab, cdef}) yield identical `all`, hence identical SHA-256, hence identical `v` — exactly the empirical collision `bef57ec7f53a6d40 == bef57ec7f53a6d40` in the repro. 6) build.ts:116-118 writes that `v` into manifest.json as the SOLE cache-buster. 7) The compiled assets (client.js, isl.*.js, app.css) are served with `cache-control: public, max-age=31536000, immutable` (packages/keep/mod.ts:~48-50, confirmed). 8) Because the URL query `?v=<hash>` is the only thing distinguishing one build's immutable asset from the next, a colliding `v` makes the new build's URL identical to the stale one; the browser, holding an immutable (never-revalidated) entry, keeps serving the OLD client.js/app.css/isl.*.js for up to a year. Symptom: users pinned to stale JS/CSS after a deploy whose content shifted across the output boundary without changing the concatenation.
- **Root locus:** `ui/.sprig/compiler/build.ts:176-178 (the unframed `all.set(b, off); off += b.length;` concatenation in shortHash; surrounding defect spans 170-184)`
- **Shared root:** isolated — distinct from the runtime interpreter/hydration/scopeCss families; this is a build-time content-hash framing defect (unframed concatenation feeding the immutable-cache key). The closest sibling, if any, is the broader "immutable max-age=31536000 caching keyed solely on manifest.v" assumption (packages/keep/mod.ts), but the specific collision root lives only in shortHash's missing per-file framing.

### RCA #46 — manifest.json is publicly served under /ui/_assets with an immutable cache-control, leaking build internals and pinning a stale cache-buster source
- **Root cause:** serveAsset is a blanket file server: it has no allowlist distinguishing public client assets from server-only build artifacts, and it applies one unconditional `immutable, max-age=31536000` cache policy to every file it serves. The build (build.ts) compounds this by writing the server-only manifest.json into the very directory that is exposed as the public _assets root, so the artifact is reachable and mis-cached purely because of where it lives plus serveAsset's lack of any per-file policy.
- **Mechanism:** 1) build.ts:108-119 enumerates outDir and writes manifest.json INTO that same directory (outDir), which becomes the deployed `static/` dir. So the server-only build artifact physically co-locates with the genuine client assets (client.js, app.css, chunks). 2) At request time, mod.ts:86-88 matches any path under `<base>/_assets/` and calls serveAsset(assetsDir, file) with only a `..` traversal check — no allowlist of permitted files or extensions. 3) serveAsset (mod.ts:39-54) does Deno.readFile(`${dir}/${file}`); for manifest.json the readFile succeeds, the `.json`→`application/json; charset=utf-8` mapping (line 36) yields a clean 200, and EVERY response is hardcoded with `cache-control: public, max-age=31536000, immutable` (line 48). 4) Result: GET /ui/_assets/manifest.json returns 200 with the full manifest body ({v, client, css, islands, chunks}) tagged immutable for one year. Because the manifest is the cache-buster SOURCE (its `v` is re-read server-side at compiler/mod.ts:59-62 for ?v= busting) and changes every build, any caching intermediary pins a stale build-version document — the opposite of what its own purpose requires.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/packages/keep/mod.ts:39-54 (serveAsset: no allowlist + unconditional immutable cache-control on line 48); compounded by ui/.sprig/compiler/build.ts:116-119 writing manifest.json into the served outDir/static dir`
- **Shared root:** serveAsset blanket-serves the entire static dir with a single hardcoded immutable cache header and no per-file allowlist/policy (any non-content-hashed or server-only file dropped into static/ is exposed and mis-cached)

### RCA #47 — Prop-bridge JSON.parse is unguarded: a malformed props script throws, marks the island permanently 'hydrated' but dead, and aborts hydration of all later same-selector instances
- **Root cause:** hydrateIsland commits the irreversible side effect `el.dataset.sprigHydrated = "1"` (line 178) BEFORE performing the fallible prop-bridge parse `JSON.parse(propsEl.textContent)` (line 182), and that parse has no try/catch. The flag is set non-transactionally ahead of an operation that can throw, so a failure leaves the element in a corrupt "marked hydrated but uninitialized" state with no rollback. Separately, hydratePending iterates instances with a bare `.forEach((el) => hydrateIsland(...))` (line 79) that provides no per-element fault isolation, so any single hydrateIsland throw escapes and kills the loop. The underlying design defect is the absence of fault isolation around untrusted/external input (the SSR-serialized props script can be corrupted by truncation, streaming, or a mangling proxy) combined with flag-before-work ordering.
- **Mechanism:** Trigger path: registerIsland(sel) (line 71) -> hydratePending(sel) (line 73). hydratePending (76-80) selects ALL not-yet-hydrated instances of the selector via querySelectorAll(`sprig-island[data-sel="..."]:not([data-sprig-hydrated])`) (78) and iterates `.forEach((el) => hydrateIsland(el, registry.get(sel)!))` (79) — no per-element guard.

Inside hydrateIsland: line 177 returns early if already hydrated; line 178 IMMEDIATELY sets `el.dataset.sprigHydrated = "1"` — committing the flag before any work that can fail. Line 181 reads `el.querySelector("script.sprig-props")`; line 182 does `propsEl?.textContent ? JSON.parse(propsEl.textContent) : {}` with no try/catch. If the props body is non-JSON (e.g. truncated `{"a":`), JSON.parse throws SyntaxError.

Two consequences:
1) Dead island (instance #1): the throw aborts hydrateIsland AFTER line 178 set the flag but BEFORE setup/effect/listener wiring (183-216) ran. The element is now permanently flagged hydrated yet has no reactive scope, no rendered effect output, no delegated listeners. Every later recovery path is gated out: hydratePending's `:not([data-sprig-hydrated])` selector (78) excludes it, and line 177's guard would short-circuit it even if re-visited — so loadIsland's already-loaded path (122-124) and soft-nav bootstrapIslands (163) can never revive it.
2) Aborted siblings (instance #2+): the SyntaxError propagates out of the line-79 forEach callback. Array.forEach does not isolate callback exceptions, so iteration halts; every subsequent matched instance never gets hydrateIsland called and stays interactive-dead. Those siblings are NOT flagged hydrated, but their owning trigger already fired and the chunk is registered, so nothing re-drives them either.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:178 (premature flag set) and :182 (unguarded JSON.parse), compounded by :79 (unguarded forEach in hydratePending)`
- **Shared root:** unguarded per-island hydrate work with no fault isolation in the hydratePending/hydrateIsland path (flag set before fallible work; bare forEach lets one island's throw abort the rest)

### RCA #48 — Per-island reactive effect is never disposed → production memory leak + writes to detached nodes after soft-nav
- **Root cause:** hydrateIsland() creates the per-island render effect with `effect(() => {...})` (ui/.sprig/compiler/hydrate.ts:193) but discards the DisposeFn that @preact/signals-core's `effect` returns (declared as `function effect(fn, options?): DisposeFn` in signals-core.d.ts:139; re-exported verbatim at ui/.sprig/core.ts:17-18). Hydration has NO lifecycle/teardown concept for an island in production: the only place a live instance handle is stored is `live.push(...)` at hydrate.ts:218-229, and that whole block is gated behind `if (hmrEnabled && tick)`. So in prod there is no reference to the effect, no `document.contains` liveness check, and no dispose() call path — the design simply assumes an island, once hydrated, lives forever. That assumption is false because soft navigation detaches islands.
- **Mechanism:** 1) On hydration, hydrate.ts:183 runs `scope = entry.setup(...)`, creating the island's signals (its state). 2) hydrate.ts:193-198 registers an effect that calls `renderNodes(nodes, { scope, ... })` (line 196) and assigns `el.innerHTML`. Reading the signals inside renderNodes subscribes the effect to each signal it touches; the subscriber edge means each live signal's subscriber list holds the effect, and the effect's closure holds `el`, `scope`, `nodes`, `source`, and `handlers`. 3) The DisposeFn returned by `effect(...)` is not captured (no `const dispose = effect(...)`), so nothing can ever unsubscribe it. 4) On soft navigation, setupSoftNav's `swap()` executes `cur.innerHTML = next.innerHTML` (hydrate.ts:162), detaching every hydrated `<sprig-island>` inside the outlet from the document. No per-island teardown runs (the prod path has none — `live` is HMR-only). 5) Because the effect is still subscribed, the detached `el`/`scope`/effect remain reachable from any still-live signal's subscriber list (e.g. a module-level/shared signal, or a signal driven by a setInterval the setup started), so GC cannot collect them — the leak. 6) Worse, if such a retained signal later changes, the effect re-runs and executes `el.innerHTML = renderNodes(...)` (hydrate.ts:196) against a node no longer in the document — wasted work / a write to a detached node. This is fully independent of HMR: the dev-only `live[]` growth via `live.push` (hydrate.ts:218) is a separate, gated path and is NOT the production leak.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:193 (effect created; DisposeFn return value discarded — no capture/storage), with the missing teardown trigger at hydrate.ts:161-165 (soft-nav swap detaches islands without calling any per-island dispose)`
- **Shared root:** island/effect has no production teardown — soft-nav `cur.innerHTML = next.innerHTML` swap detaches hydrated nodes while their subscriptions/effects stay rooted (the live[] instance tracking + any dispose path is gated behind hmrEnabled)

### RCA #49 — API endpoints ignore the request Content-Type: any media type (text/plain, application/xml, missing) is parsed as JSON and accepted
- **Root cause:** The @Endpoint request pipeline parses the body purely by content (JSON.parse of raw bytes) and validates only its SHAPE, never its declared media type — there is no Content-Type negotiation/gate anywhere in the chain. keep's @Endpoint decorator wires danet's plain `@Body()` decorator, whose resolver calls `context.req.json()` unconditionally; that delegates to Hono's `Request.json()`, which `JSON.parse`s the raw body ignoring the `Content-Type` header entirely. No 415 path exists in keep, danet, or the sprig forwarder, so a JSON-looking body is accepted under any (or no) media type.
- **Mechanism:** Chain (network /api/* POST → 200 regardless of Content-Type):

1. packages/keep/mod.ts:90-93 — serveSprig matches /api/*, strips the prefix and forwards the Request UNMODIFIED (`new Request(stripped, req)` preserves all headers/body) into config.keep.handler. It performs no media-type check; it is a pure path router.

2. backend/src/board/entrypoints/http/mod.ts:44-45 — the `@Endpoint({ path: "issue", input: IssueRefDto, ... })` handler takes `body: IssueRefDto`. Per the decorator contract, declaring `input` makes keep auto-wire danet's `@Body()` for parameter 0.

3. keep endpoint-decorator/mod.ts (Endpoint(), step 2) — `if (opts.input) { Body()(target, propertyKey, 0); BodyType(...)(...) }`. It attaches danet's plain `@Body()` resolver and the Swagger BodyType, but never any Content-Type guard or a 415 path.

4. @danet/core@2.11.0 src/router/controller/params/decorators.ts:135-172 — the Body resolver body: `let body; try { body = await context.req.json(); } catch (e) { throw e; }`. Line 147 unconditionally calls `context.req.json()` with NO `context.req.header('content-type')` inspection. It only validates the parsed object's SHAPE (validateObject → NotValidBodyException), never the media type. So `{"issueId":"SPR-101"}` sent as text/plain / application/xml / no Content-Type still parses to a valid IssueRefDto and passes validation.

5. @hono/hono@4.6.3 src/request.ts:241-243 — `json()` → `cachedBody('json')` → (request.ts:225) `raw['json']()`, i.e. the standard `Request.json()`, which reads the raw body bytes and `JSON.parse`s them with zero regard for the Content-Type header.

Because every layer parses-by-bytes and gates only on JSON shape, all five repro variants (json, text/plain, application/xml, empty, missing) yield the same successfully-parsed IssueRefDto and return 200 + the full IssueDetailDto. There is simply no code path that can emit 415.
- **Root locus:** `node_modules-equivalent dependency: jsr:@danet/core@2.11.0 src/router/controller/params/decorators.ts:147 (`body = await context.req.json();` inside the `Body()` resolver — unconditional, no Content-Type check). The decision that imports this defect into sprig lives in keep's endpoint-decorator (@mrg-keystone/keep@1.22.0 /src/foundation/domain/business/endpoint-decorator/mod.ts, Endpoint() step 2: `Body()(target, propertyKey, 0)`), which attaches that bare resolver with no media-type guard. Symptom surfaces at backend/src/board/entrypoints/http/mod.ts:44 and the forwarder packages/keep/mod.ts:90-93, but neither is the root.`
- **Shared root:** danet @Body() resolver calls context.req.json() unconditionally (JSON.parse of raw bytes via Hono Request.json), so the @Endpoint pipeline never inspects Content-Type and gates only on parsed-body shape — every keep @Endpoint POST (issue/user and any input-bearing endpoint) accepts JSON under any/missing media type. Same root for protocol/content-negotiation bugs class on these endpoints (e.g. malformed-but-shape-valid bodies, charset/media-type laxity).

### RCA #50 — 500 not-found error reflects the entire unbounded issueId back to the client (info reflection / amplification)
- **Root cause:** IssueRefDto.issueId is validated only with `@IsString()` and has no length/format constraint, so the validation seam accepts an arbitrarily large attacker-controlled string instead of rejecting it with 422 before it reaches business logic. That unbounded value is then interpolated verbatim into a plain `Error` message in the not-found path, and keep's default 500 handler serializes that message back to the client. The design defect is the absence of an input bound (and, secondarily, embedding raw client input into a surfaced error string).
- **Mechanism:** 1) Request hits the `issue` endpoint (backend/src/board/entrypoints/http/mod.ts:44-45) with body `{issueId: "A"*200000}`. 2) The coordinator validates at the seam: `assert(IssueRefDto, input, "issue.get input")` (backend/src/board/domain/coordinators/issue-get/mod.ts:15). Because IssueRefDto only carries `@IsString()` (backend/src/board/dto/issue-ref.ts:16) with NO `@MaxLength`/`@Length`, the 200KB string is a valid string and passes the contract — no 422 is raised. 3) `getCore` calls `issue.assemble(input.issueId)` (issue-get/mod.ts:27). 4) In assemble, `ISSUES.find(c => c.id === issueId)` misses, so `if (!issue) throw new Error(`no issue with id \"${issueId}\"`)` (backend/src/board/domain/business/issue/mod.ts:14-15) constructs an Error whose `.message` interpolates the ENTIRE attacker-controlled id verbatim. 5) Nothing in the coordinator catches it, so it propagates uncaught to keep's default exception filter, which maps an unhandled Error to HTTP 500 and serializes `error.message` into `{"status":500,"message":...}` — echoing all 200000 chars back (size=200048). Two independent gaps compound: missing length bound (lets the huge string through) + raw input interpolation into an error surfaced to the client (reflects it back).
- **Root locus:** `backend/src/board/dto/issue-ref.ts:16 (issueId guarded only by @IsString() — missing @MaxLength/@Length); the reflection sink is backend/src/board/domain/business/issue/mod.ts:15`
- **Shared root:** DTO validation only checks @IsString()/type with no length or format bound, so unvalidated client input flows into business logic; here it compounds with the not-found path throwing a plain Error that interpolates raw input and keep's default 500 handler echoing error.message back to the client (shared not-found-500 input-reflection theme).

### RCA #51 — SSR pages and static assets ignore the HTTP method: PUT/DELETE/TRACE/OPTIONS all return 200 with a full body
- **Root cause:** Both request handlers in the read-only SSR/asset serving path dispatch purely on `url.pathname` and never read `req.method`. There is no method-gating layer anywhere in the chain: `serveSprig.fetch` (packages/keep/mod.ts:81-101) routes solely by path, `serveAsset` (mod.ts:39-54) reads/returns file bytes unconditionally, and `bootstrap.fetch` (ui/.sprig/core.ts:334-356) matches the route and returns rendered HTML unconditionally. Because these endpoints are inherently read-only (render a page / read an asset file) but were implemented as method-agnostic, every verb is implicitly treated as GET. Neither handler ever constructs a 405, an Allow header, or special-cases OPTIONS/HEAD/TRACE.
- **Mechanism:** A PUT/DELETE/TRACE/OPTIONS to /ui enters serveSprig.fetch (mod.ts:81). It is not under assetPrefix, apiPrefix, or docsPrefix, so it falls through to `config.app.fetch(req, info, { backend })` (mod.ts:100). bootstrap.fetch (core.ts:334) computes `path` from the URL, calls matchRoute (core.ts:340), and — with no `req.method` check at any point — proceeds to resolve inputs (core.ts:349-351) and render the page (core.ts:353-355), returning `new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })` (core.ts:356) with the implicit 200 status and the full ~2153-byte document for ANY verb. OPTIONS thus gets the entire HTML body and no Allow header; TRACE is reflected/honored (Cross-Site Tracing exposure); PUT/DELETE get 200 instead of 405. For assets, a POST to /ui/_assets/client.js matches assetPrefix (mod.ts:86) and calls serveAsset (mod.ts:87), which reads the file and returns the bytes with status 200 (mod.ts:45-50) regardless of method. No code path emits 405/204 or an Allow header anywhere.
- **Root locus:** `ui/.sprig/core.ts:334-356 (bootstrap.fetch — no req.method check before render/return) and packages/keep/mod.ts:39-54,80-101 (serveAsset and serveSprig.fetch — path-only dispatch, no method gating)`
- **Shared root:** Read-only request handlers dispatch on pathname alone and never inspect req.method (no method-gating / 405 / Allow / OPTIONS-HEAD-TRACE handling in the SSR + static-asset serving layer)

### RCA #52 — Malformed or empty JSON request body returns 500 (not 400) and leaks the internal JSON-parser error message to the client
- **Root cause:** There is no path that converts a JSON-body parse failure into a 4xx client error, so the raw V8/Deno `SyntaxError` from `Request.json()` propagates untyped to danet's generic error handler and is serialized verbatim. Two compounding defects allow this:

1. danet's `@Body()` param decorator wraps the body parse in a try/catch that does literally nothing useful: it catches the `SyntaxError` and immediately `throw e` (rethrows the identical error object). It never re-wraps it as a `BadRequestException`/`NotValidBodyException`, so the propagated error carries no HTTP semantics — no `.status`, and `.message` is the internal parser string. (`@danet/core/2.11.0/src/router/controller/params/decorators.ts:145-150`)

2. keep's only application-level error mapping is a global exception filter that special-cases ONLY `RuneAssertError` (duck-typed on `name === "RuneAssertError"` + `Array.isArray(failures)`) → 422, and returns `undefined` for everything else, deliberately falling through to danet's defaults ("plain errors stay 500"). A JSON `SyntaxError` is not a RuneAssertError, so it is treated as a server fault. (`@mrg-keystone/keep/1.22.0/src/foundation/domain/coordinators/bootstrap-server/mod.ts:714-739`)

The body is parsed BEFORE DTO validation runs, so malformed/empty bodies never reach the validation seam that would produce the 422 the bug report contrasts against. `{}` parses successfully, then fails DTO validation → RuneAssertError → 422; `{bad json` / empty fails at parse → raw SyntaxError → 500.
- **Mechanism:** POST /api/http/issue enters via serveSprig (serve.ts:7), which routes `/api/*` to `config.keep.handler` after stripping the prefix (packages/keep/mod.ts:90-93). Inside keep/danet the issue() handler has `input: IssueRefDto`, so @Endpoint wired danet's `Body()` decorator onto param 0 (@mrg-keystone/keep/1.22.0/src/foundation/domain/business/endpoint-decorator/mod.ts:123-131). During dispatch, danet's resolveMethodParam awaits that resolver (@danet/core/2.11.0/src/router/controller/params/resolver.ts:31). The resolver runs `body = await context.req.json()` (decorators.ts:147). For `{bad json` or an empty body this throws a JS `SyntaxError` ("Expected property name or '}'..." / "Unexpected end of JSON input"); the surrounding `try { } catch (e) { throw e }` (decorators.ts:146-150) rethrows it unchanged. DTO validation at decorators.ts:166-170 (which would throw NotValidBodyException) is never reached. The error unwinds into danet router.ts's handler try/catch (router.ts:253) and reaches handleError (router.ts:293-316): the registered global filters are consulted (router.ts:298-304), keep's RuneAssert filter inspects `err.name` — it is "SyntaxError", not "RuneAssertError" — so the filter returns `undefined` (bootstrap-server/mod.ts:737); `filterResponse` is falsy. Then `const status = error.status || HTTP_STATUS.INTERNAL_SERVER_ERROR` (router.ts:309) — SyntaxError has no `.status` → 500 — and `const message = error.message || 'Internal server error!'` (router.ts:310) takes the raw parser text. router.ts:312-316 serializes `{...error, status, message}` as JSON, producing `{"status":500,"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}` and leaking parser internals. By contrast `{}` parses, reaches validateObject, fails (issueId missing), throws RuneAssertError, the filter matches and returns ctx.json(..., 422) (bootstrap-server/mod.ts:724-735).
- **Root locus:** `Primary (framework defect): /Users/raphaelcastro (deno cache) @danet/core/2.11.0/src/router/controller/params/decorators.ts:145-150 — the no-op `catch (e) { throw e }` that rethrows the raw SyntaxError instead of a BadRequestException. Secondary (application gap that lets the 500 + leak surface): @mrg-keystone/keep/1.22.0/src/foundation/domain/coordinators/bootstrap-server/mod.ts:714-739 — the global exception filter only maps RuneAssertError and falls all other errors through to danet's default `error.status || 500` + `{...error, message}` serialization at @danet/core/2.11.0/src/router/router.ts:309-316.`
- **Shared root:** keep/danet global exception filter only maps RuneAssertError->422 and lets every other thrown error fall through to danet's default handler, which emits error.status||500 and serializes the raw error.message (router.ts:309-316) — so any non-RuneAssert framework error (here a JSON-body SyntaxError from danet's no-op catch in the Body decorator) becomes a 500 that leaks the internal exception text. Any other protocol/parse-stage error reaching the keep pipeline (bad content-type, oversized/aborted body, etc.) shares this same root.

### RCA #53 — SSR HTML responses carry no security headers (no X-Content-Type-Options/nosniff, no X-Frame-Options/CSP) while embedding inline JSON islands
- **Root cause:** There is no centralized response-construction layer or response/header-hardening middleware anywhere in sprig. Every HTTP Response is built ad-hoc at its individual call site, each setting only the bare-minimum headers that that specific response needs (content-type, plus cache-control on assets/SSE). The framework's design simply never had a notion of "default hardening headers" applied to outgoing responses, so HTML responses — even though they embed attacker-influenceable inline JSON islands (__sprig_inputs / __sprig_config / sprig-props) — go out with only content-type. The root is an architectural omission (no security-header policy in the response pipeline), not a single misconfigured line.
- **Mechanism:** The SSR HTML response is created at ui/.sprig/core.ts:356: `return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });` — the headers object literal contains only content-type, so no X-Content-Type-Options, X-Frame-Options, CSP, or Referrer-Policy are emitted. The HTML body itself is produced by document() at ui/.sprig/compiler/mod.ts:123-139 (and the placeholder renderDocument() at core.ts:364-381), whose <head> at mod.ts:127-133 emits only charset/viewport/title/stylesheet/modulepreload meta and zero security meta-equivalents; the inline JSON island `<script type="application/json" id="__sprig_config">…</script>` is injected at mod.ts:136 (and id="__sprig_inputs" at core.ts:376). Asset responses are built at packages/keep/mod.ts:45-49 with only content-type + cache-control. A grep across the repo (ui/.sprig, packages/keep) finds every `new Response(...)` constructed inline with minimal headers and zero matches for any nosniff/X-Frame/CSP/Referrer-Policy/HSTS string, confirming no header is set anywhere and no shared helper exists to add one. Net effect matching the repro: curling /ui returns only content-type/vary/content-length/date and the body contains the inline application/json island. The <-escaping at core.ts:366 and mod.ts:136 (json.replace(/</g, "\\u003c")) blunts the JSON-injection/breakout angle, leaving MIME-sniffing and clickjacking as the residual unmitigated risks — exactly the headers the bug flags as missing.
- **Root locus:** `ui/.sprig/core.ts:356 (SSR HTML Response sets only content-type — the place the policy would live); compounded by ui/.sprig/compiler/mod.ts:123-139 (document() head emits no security meta) and packages/keep/mod.ts:45-49 (asset Response headers). The true root is the absence of any shared response/header layer, so it lives across all per-call-site Response constructions rather than in one wrong line.`
- **Shared root:** no centralized response/header layer — every Response is built ad-hoc at its call site with only minimal headers, so no security/hardening headers are ever applied (ui/.sprig/core.ts:356, ui/.sprig/compiler/dev.ts:98/105, packages/keep/mod.ts:45-49)

### RCA #54 — Home page is dual-mounted: bare "/" serves the full SSR home document identical to the on-base "/ui", bypassing the base prefix
- **Root cause:** The off-base 404 guard at ui/.sprig/core.ts:338 carries a `&& path !== "/"` exception that unconditionally whitelists the bare root path, regardless of the configured base. The author conflated two distinct meanings of "/": the post-rebase canonical home path (what an on-base "/ui" request becomes on line 337) versus the raw, never-rebased off-base request pathname. Because line 337 only rewrites paths that are equal to `base` or start with `base + "/"`, a literal "/" request never enters the rebasing branch and arrives at line 338 still as the raw, un-rebased pathname. The `path !== "/"` clause then treats this raw off-base "/" as if it were the canonical home, skips the 404, and lets matchRoute resolve it against the `{ path: "" }` dashboard route (main.ts:15) — since both "/" and "" normalize to an empty segment list in matchRoute (core.ts:291). The result is the home route being reachable at two URLs ("/" and "/ui") whenever a non-empty base is set. The correct guard should 404 any path not under the base — the exemption for "/" is only valid when base is empty.
- **Mechanism:** In bootstrap().fetch (ui/.sprig/core.ts:334-341): (1) Line 337 `if (base && (path === base || path.startsWith(base + "/")))` rebases on-base requests; for bare "/" this is false (base="/ui", "/" !== "/ui" and doesn't start with "/ui/"), so `path` stays "/". (2) Line 338 `else if (base && path !== "/")` is the off-base 404 guard, but its `&& path !== "/"` clause explicitly EXEMPTS bare "/", so no 404 is returned and execution falls through with path="/". (3) Line 340 calls matchRoute(config.routes, "/"); matchRoute (core.ts:291) does `pathname.split("/").filter(s => s.length > 0)` → segs=[]. walk() (core.ts:294-307) tests route {path:""} (main.ts:15): rs=[], the segment loop never runs, ok stays true, rest=[] → returns { load: "./pages/dashboard" }. (4) Lines 353-356 render the dashboard document and return 200 — byte-identical to GET /ui, which arrives at the same matchRoute("/") after rebasing on line 337. Off-base paths like /board are `!== "/"`, so line 338 returns 404 for them, which is why only bare "/" leaks.
- **Root locus:** `ui/.sprig/core.ts:338`
- **Shared root:** isolated

### RCA #55 — SSR fetch handler has no HTTP method guard: bootstrap().fetch renders a 200 HTML body for every method (DELETE/PUT/TRACE/PATCH/POST/OPTIONS) and never emits 405 or an Allow header
- **Root cause:** bootstrap().fetch (ui/.sprig/core.ts:331-358) was written as a path-only router: it dispatches solely on url.pathname (base-strip + matchRoute) and treats every matched SSR page route as an unconditional renderable resource. The handler never reads req.method, so there is no notion that page routes are read-only (GET/HEAD) resources. The single success path always constructs a 200 Response with only a content-type header (line 356) and no Allow header. The defect is the design omission of any method gate in the SSR entrypoint — neither core.ts nor serve.ts ever inspects the request method (grep for req.method/405/Allow returns nothing).
- **Mechanism:** In bootstrap().fetch (ui/.sprig/core.ts:334-356) the only branching is path-based: parse url (335), base-strip / 404 on base mismatch (337-338), matchRoute then 404 on no match (340-341), build server Injector + provide Backend (344-345), run mod.resolve to gather inputs (349-351), then render via config.render or renderDocument and return new Response(html, { headers: { content-type: text/html; charset=utf-8 } }) (353-356). req.method is never read, and the Response uses the default status 200 with no Allow header. matchRoute (290-313) / walk (294-314) match only on path segments, not method. So DELETE/PUT/TRACE/PATCH/POST/OPTIONS all traverse the identical GET path: route matches -> resolve runs -> the full document (len=2153) is rendered -> 200 text/html is returned. TRACE reflects the full body for the same reason; OPTIONS never receives an Allow header because the success branch only sets content-type.
- **Root locus:** `ui/.sprig/core.ts:334 (the fetch handler body that omits any req.method guard); the always-200 Response with no Allow header is constructed at ui/.sprig/core.ts:356`
- **Shared root:** isolated — this is specifically the SSR fetch handler's missing HTTP-method guard, not part of a broader recurring theme (e.g. _event_body interpretation or innerHTML re-render).

### RCA #56 — escapeAttr() under-escapes HTML attribute values (drops <, >, and single-quote), emitting non-conformant HTML
- **Root cause:** escapeAttr() (render.ts:418-420) is defined with an incomplete escape set: `s.replace(/&/g,"&amp;").replace(/"/g,"&quot;")`. It only neutralizes the two characters needed to stay inside a double-quoted attribute (`&` to keep entities well-formed and `"` to prevent quote breakout) and silently passes `<`, `>`, and `'` through. This is a deliberate-but-too-narrow design choice that scoped the escaper to "prevent attribute-quote breakout" rather than "produce conformant HTML." It diverges from the sibling text escaper escape() (render.ts:11-13) which already handles `<` and `>`, so the codebase holds two inconsistent escaping standards and the attribute path is the weaker one.
- **Mechanism:** Dynamic attribute values flow into escapeAttr at two sinks. (1) buildAttrs() reads each plain attribute's value via `quotedText(v, scope)` at render.ts:251 (which interpolates scope-derived expressions), stores it in `plain`, then at render.ts:274-275 serializes every entry as `` ` ${k}="${escapeAttr(v)}"` ``. (2) renderComponent emits `data-sel="${escapeAttr(comp.selector)}"` and `data-trigger="${escapeAttr(comp.island.trigger)}"` at render.ts:183. In both cases escapeAttr (render.ts:419) only substitutes `&`→`&amp;` and `"`→`&quot;`. A value such as `a<b>c'd&e"f` therefore emerges as `a<b>c'd&amp;e&quot;f`: the literal `<`, `>`, and `'` survive verbatim inside the attribute value. A bare `<` inside an attribute value is non-conformant per the HTML spec and triggers parser-dependent error recovery. Because the attribute is double-quoted and `"` IS escaped, the value cannot terminate the attribute, so this is not a quote-breakout/XSS vector with current templates — it is a correctness/conformance gap and a defense-in-depth hole: any future binding reflecting untrusted input into an attribute would allow `<`/`>` injection without needing a quote. Contrast the text path: escape() at render.ts:12 would have turned the same `<`/`>` into `&lt;`/`&gt;`.
- **Root locus:** `ui/.sprig/compiler/render.ts:418-420 (the escapeAttr definition; specifically the replace chain on line 419 that omits /</g→&lt;, />/g→&gt;, and /'/g→&#39;)`
- **Shared root:** isolated — this is the escapeAttr escape-set gap. It is thematically adjacent to other escaping defects (e.g. escape()/text-content handling), but the defect lives in this one helper's character set and is not the same root as innerHTML/trusted-HTML or scopeCss-style bugs.

### RCA #57 — Dynamic SSR HTML pages are served with no cache-control header (heuristically cacheable / cross-user staleness on shared caches)
- **Root cause:** The single, centralized Response constructor for ALL dynamic SSR HTML (ui/.sprig/core.ts:356) hardcodes a headers object containing only `content-type: text/html; charset=utf-8`. The framework has no notion of a cache-policy for generated HTML: both render functions (the compiler's renderDocument at ui/.sprig/compiler/mod.ts:72-82 and the fallback renderDocument at ui/.sprig/core.ts:364) return a bare HTML STRING and have no channel to contribute response headers. So a per-resource, per-user, dynamically-resolved document (issue/board/user/dashboard, whose content comes from `mod.resolve` at core.ts:349-351) is emitted with a 200 status and zero freshness/caching metadata. Per RFC 9111, a 200 response with no explicit freshness info and no Cache-Control is heuristically cacheable by shared/intermediary caches — the framework never opts these dynamic pages out of that default.
- **Mechanism:** Request flows serveSprig.fetch (packages/keep/mod.ts:80-101): asset/api/docs prefixes are peeled off (mod.ts:86,90,96) and only the asset branch sets cache-control (`public, max-age=31536000, immutable`, mod.ts:48); everything else falls through to config.app.fetch (mod.ts:100) -> bootstrap().fetch (core.ts:334). There the route is matched (core.ts:340), per-resource inputs are computed via mod.resolve (core.ts:349-351), and HTML is produced either by config.render (compiler path, core.ts:353-354 -> mod.ts:72-82) or renderDocument (fallback, core.ts:355 -> core.ts:364). Both return a plain string with no header information. The result is wrapped at core.ts:356: `new Response(html, { headers: { \"content-type\": \"text/html; charset=utf-8\" } })`. No cache-control/expires/pragma/etag/last-modified is ever attached on this path (confirmed by grep: only hits are mod.ts:48 immutable assets and dev.ts:99/105 dev-only SSE+AST endpoints). With 200 + no freshness headers, a shared cache/CDN/proxy may heuristically cache and re-serve the per-user/per-resource HTML, yielding stale or wrong-resource pages across users.
- **Root locus:** `ui/.sprig/core.ts:356 (the only construction of the SSR HTML Response; headers literal omits cache-control). The design constraint that allows it lives in the render contract at ui/.sprig/core.ts:325 / compiler renderDocument at ui/.sprig/compiler/mod.ts:72-82, where render returns a string and cannot supply headers.`
- **Shared root:** SSR responses built at the single core.ts:356 Response site with a hardcoded content-type-only headers object and no per-response header policy (no cache-control, and equally no security/vary headers) on dynamic HTML

### RCA #58 — clientRoot() is dead code — the client injector is never activated, so client-side DI (inject(), scope:"client"/"both" services) can never work
- **Root cause:** The client-side hydration path never establishes an active injector. `hydrateIsland` (ui/.sprig/compiler/hydrate.ts:183) calls `entry.setup(clientCtx(inputs))` directly, outside of any `runInInjector(...)` wrapper. The DI machinery in core.ts is built around a single module-level mutable `current: Injector | undefined` (core.ts:158) that is only ever set while inside `runInInjector` (core.ts:168-176) or `Injector.#instantiate` (core.ts:135-136). The factory function `clientRoot()` (core.ts:153-156) exists to memoize a per-document client root injector on `globalThis.__sprig_root`, but it is never imported or called from anywhere (confirmed: grep yields only its own declaration at core.ts:153, no callers). The sole `runInInjector` call site (core.ts:350) is in the server `bootstrap()` request handler. So on the client, `current` stays `undefined` for the entire lifetime of a `setup()` call. This is a wiring/integration gap: the client half of the DI design (documented at core.ts:152-155 as "one root injector per document") was specced but never connected to the hydration entry point.
- **Mechanism:** 1) hydrate.ts:13-18 — hydrate.ts imports `effect`, `signal`, types from @sprig/core but NOT `clientRoot` or `runInInjector`, so it has no way to activate an injector. 2) hydrate.ts:183 — `const scope = entry.setup(clientCtx(inputs))` invokes the island's user `setup()` with no surrounding `runInInjector`, leaving core.ts's module-level `current` at its default `undefined` (core.ts:158). 3) core.ts:161-165 — when a client `setup()` body calls `inject(SomeService)`, the guard `if (!current) throw new Error("inject() must be called synchronously within setup()...")` fires immediately, because `current` was never set. 4) Consequently the scope-check branch for client services is unreachable in practice: core.ts:129 `if (reg.scope !== "both" && reg.scope !== this.side)` would correctly admit a `scope:"client"`/`"both"` service IF an injector with `side:"client"` were ever active — but no such injector is ever made `current` on the client, so `#instantiate` (and thus the scope guard's client-allow path) is never reached client-side. Net symptom: registering any `scope:"client"` or `scope:"both"` service and calling `inject()` from an island throws "inject() must be called synchronously within setup()...", making the entire client side of DI inert.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:183 (the unwrapped `entry.setup(clientCtx(inputs))` call — the missing `runInInjector(clientRoot().child("component"), ...)` wrapper); the orphaned factory lives at ui/.sprig/core.ts:153-156.`
- **Shared root:** isolated — this is a one-off client/DI integration gap (hydrateIsland never activates the client injector), distinct from the interpreter/render/scopeCss bug families. It does, however, share the same surface (hydrateIsland) as the el.innerHTML hydrate-effect bugs without sharing their root cause.

### RCA #59 — Injector cache uses `existing !== undefined`, so any provider/service whose value is `undefined` is re-instantiated on every inject() (broken singleton contract)
- **Root cause:** The DI injector uses a *value-based* presence test instead of a *key-presence* test to decide whether a token is already cached. `#findInstance` (ui/.sprig/core.ts:145-149) collapses two distinct states into one sentinel: it returns `undefined` both when the key is genuinely absent (no node up the parent chain has it) AND when a node has cached the literal value `undefined`. `#instantiate` (line 127-128) then branches on `existing !== undefined`, which structurally cannot distinguish "not cached" from "cached as undefined". `undefined` is a legal factory return value, so this value/presence conflation breaks the one-instance-per-node singleton guarantee for any provider whose value is `undefined`.
- **Mechanism:** First inject(Maybe): resolve() -> #instantiate (line 119/126). #findInstance (line 127) walks the chain; nothing is cached, so `.has(key)` is false at every node and it returns `undefined` (line 148). Line 128 `existing !== undefined` is false, so the factory runs (line 138), count becomes 1, and the value `undefined` is stored via `this.#instances.set(key, undefined)` (line 139). Second inject(Maybe): #findInstance now hits `this.#instances.has(key)===true` and returns `this.#instances.get(key)` which is `undefined` (line 147). Back in #instantiate, `existing !== undefined` is STILL false because the cached value itself is `undefined`, so the cache hit is invisible — the factory runs again (count 2) and re-caches `undefined`. Third inject(Maybe) repeats identically (count 3). Hence the observed `Repro1 ... count: 3`. For Repro2 the factory returns 42; `#instances.get(key)` returns 42 on the second call, `42 !== undefined` is true, line 128 returns the cached 42, and the factory runs exactly once (count2 = 1). The `provide()` path (line 110-112) is affected too: providing a token an explicit `undefined` value would likewise never be seen as a cache hit.
- **Root locus:** `ui/.sprig/core.ts:128 (the `if (existing !== undefined) return existing` value-based guard in #instantiate), enabled by #findInstance at lines 145-149 returning a value rather than a presence flag`
- **Shared root:** isolated — specific to the DI injector's undefined-as-absent sentinel conflation; distinct from the rendering/interpreter/scopeCss theme families.

### RCA #60 — injector.provide(token, undefined) is silently ignored; per-request binding of an undefined value falls through to the REGISTRY factory
- **Root cause:** The DI injector uses the value `undefined` as the sentinel for "no instance cached/bound" instead of testing for key *presence*. `#instantiate` decides whether a token is already resolved with `if (existing !== undefined) return existing` (core.ts:128), and `existing` comes from `#findInstance`, which ultimately returns `Map.get(key)` (core.ts:147). Since `Map.get` returns `undefined` for both an absent key and a key explicitly stored with value `undefined`, the two cases are indistinguishable at line 128. A value legitimately bound via `provide(token, undefined)` is therefore treated as "not yet resolved," so the registry factory is run instead of returning the bound value. The design defect is the conflation of the boolean "is this token bound?" question with the value-channel sentinel `undefined`.
- **Mechanism:** 1. `provide(Cfg, undefined)` stores the binding: `this.#instances.set(token.key, undefined)` (core.ts:110-111). The key IS present in the Map; its value is `undefined`. 2. `resolve` -> `#instantiate(key, token, reg)` is called (core.ts:114-119). 3. `#instantiate` calls `#findInstance(key)` (core.ts:127). `#findInstance` checks `this.#instances.has(key)` -> true, then returns `this.#instances.get(key)` -> `undefined` (core.ts:147). The `has()` test correctly detected presence, but that information is destroyed by returning the value `undefined`. 4. Back at line 128, `existing` is `undefined`, so `existing !== undefined` is false and the early-return is skipped. 5. Execution falls through to `reg.factory()` (core.ts:138), which runs ("FALLBACK", count++), and the freshly-computed value overwrites the deliberately-bound `undefined` via `this.#instances.set(key, value)` (core.ts:139). Result: `inject(Cfg)` returns "FALLBACK" and `factoryRan=1`, instead of `undefined` / `factoryRan=0`.
- **Root locus:** `ui/.sprig/core.ts:128 (the `existing !== undefined` presence test), enabled by core.ts:145-148 where #findInstance collapses the `has`/`get` distinction back into a bare `undefined``
- **Shared root:** DI cache/binding presence is detected by an `undefined` sentinel instead of Map key presence — same root as the cache bug noted in the report (a cached/bound `undefined` is indistinguishable from "absent", re-running the factory)

### RCA #61 — Injector.child() is dead code — the route/component injector hierarchy documented in core.ts never exists at runtime
- **Root cause:** The DI runtime was implemented one tier short of its own design. The Injector class fully supports a root→route→component hierarchy (constructor takes a `kind` and `parent`, `child(kind)` mints child nodes, `resolve()` honors `providedIn:"root"` by hoisting to `this.root` while non-root services resolve on `this`, and `#findInstance` walks the parent chain), but the only code path that actually instantiates and runs an injector for a request — the server request handler at core.ts:344-350 — builds a single flat `new Injector("server","root")` and never calls `.child()` to push a route- or component-scoped node before running resolve/setup. Likewise `clientRoot()` (core.ts:153-156) only ever produces a flat client root and has no caller that descends from it. So the route/component scoping tier the class was designed for is never constructed; it exists only as unreachable API surface.
- **Mechanism:** Request flow: handler matches a route (core.ts:340), creates the flat root injector `new Injector("server","root")` (core.ts:344), binds Backend onto it (core.ts:345), then calls `runInInjector(root, () => mod.resolve!(...))` (core.ts:350) — passing `root` itself, never `root.child("route")`. runInInjector (core.ts:168-176) sets `current = root`, so every `inject()` (core.ts:161-166) during resolve calls `current.resolve(token)` on the root node. In resolve() (core.ts:114-120) the target is `reg.providedIn === "root" ? this.root : this`; since `this` IS the root and has no parent, both branches resolve to the same single node and the instance is cached in root.#instances (core.ts:139). A service authored as route- or component-scoped therefore gets instantiated once on the request-root and shared for the entire page render, with no per-route/per-component re-scoping. `child()` (core.ts:122-124) and `clientRoot()` (core.ts:153) are confirmed dead: grep across ui/ and packages/ finds the only `.child(` Injector reference is child()'s own body (core.ts:123) — the serialize.ts:30 `.child(i)` is a tree-sitter Node method, unrelated — and `clientRoot` appears only at its definition (core.ts:153) with no caller. The compiler-driven render (core.ts:353-355) and the placeholder renderDocument (core.ts:364) never descend the injector either, so nothing ever invokes the route/component tier.
- **Root locus:** `ui/.sprig/core.ts:344-350 (flat `new Injector("server","root")` run directly via runInInjector with no `.child("route")` descent); the orphaned API lives at core.ts:122-124 (child()) and core.ts:153-156 (clientRoot())`
- **Shared root:** DI hierarchy is unwired: the request path only ever uses the flat request-root injector and never descends to route/component child nodes (child()/clientRoot() are dead code)

### RCA #62 — BoardService/UserService are declared scope "both" but can never be constructed client-side — they unconditionally inject the server-only Backend in a field initializer
- **Root cause:** The service's declared scope and its dependency's scope are decoupled and never reconciled. `@Injectable()` defaults `scope` to "both" (core.ts:76, driven by InjectableConfig comment at core.ts:54), so BoardService (ui/src/services/board/mod.ts:5) and UserService (ui/src/services/user/mod.ts:4) advertise themselves as constructible on both sides. But each unconditionally injects `Backend` in a class-field initializer (board/mod.ts:7, user/mod.ts:6), and `Backend` is a SERVER-scoped token (core.ts:203-204). Because the DI system performs the scope check only at the *point of injection* of each individual token — not by transitively narrowing a service's effective scope to the intersection of its dependencies' scopes — a service can legally claim scope "both" while structurally depending on a server-only token. There is no declaration-time validation that a "both"/"client" service only injects "both"/"client" providers. The mislabeled "both" is therefore a latent, unenforced contract.
- **Mechanism:** 1) `@Injectable()` registers BoardService/UserService with `scope: "both"` via `config.scope ?? "both"` (core.ts:76); the factory is `() => new target()` (core.ts:78). 2) On a client injector, `resolve(BoardService)` → `#instantiate` runs the scope guard `reg.scope !== "both" && reg.scope !== this.side` (core.ts:129); since `reg.scope === "both"`, the guard passes and the factory is invoked (core.ts:138). 3) `new BoardService()` runs the field initializer `#be = inject(Backend)` (board/mod.ts:7) while `current` is the client injector (set at core.ts:136). 4) `inject(Backend)` → `current.resolve(Backend)` (core.ts:165) → `#instantiate` for Backend. 5) Backend's registration has `scope: "server"` (core.ts:204), so the same guard at core.ts:129 evaluates `"server" !== "both" (true) && "server" !== "client" (true)` → throws `Cannot inject sprig:Backend (scope="server") on the client...` (core.ts:130-133). The throw originates inside the BoardService constructor, so construction on the client always fails — making the declared "both" scope unreachable on the client. On the server, the Backend guard passes (`this.side === "server"`) and, once `serveSprig` has `provide`d a concrete BackendClient (core.ts:110-112), construction succeeds — confirming the service is effectively server-only.
- **Root locus:** `ui/src/services/board/mod.ts:5-7 and ui/src/services/user/mod.ts:4-6 (scope "both" declaration combined with an unconditional `inject(Backend)` field initializer of a server-only token); the enabling design lives in ui/.sprig/core.ts:76 (default scope "both") and core.ts:129 (per-token-only scope guard, no transitive scope narrowing/validation)`
- **Shared root:** scope contract is not transitively validated — a service's declared DI scope is never reconciled against the scopes of the tokens it injects (default-"both" @Injectable over a server-only Backend dependency)

### RCA #63 — HMR live template swap pushes a tree-sitter ERROR AST to all mounted islands (reparse never checks hasError)
- **Root cause:** The dev HMR template pipeline has no parse-validity gate. tree-sitter is an error-recovering parser: a syntactically broken template.html still yields a non-null tree whose rootNode has hasError === true. parseTemplate() (parse.ts:26-31) only guards against a null tree (`if (!tree) throw`) and returns tree.rootNode verbatim, never inspecting rootNode.hasError. reparse() (mod.ts:84-91) builds on that flawed contract: it treats "the file read and parseTemplate didn't throw" as success and `return true` unconditionally (its only false branch is a missing srcPath entry, mod.ts:86), so a corrupt/error AST is indistinguishable from a good one. There is no hasError check anywhere in the parse -> reparse -> dev.ts push -> hmr.ts -> hotTemplate chain. That missing validity check is what ALLOWS a garbage AST to be serialized and hot-swapped into running islands.
- **Mechanism:** 1) Dev: user saves template.html mid-edit with a syntax error (e.g. `{{ count() }` missing a brace). 2) Deno.watchFs fires; dev.ts:56 classifies the path as a template change and dev.ts:61-62 calls renderer.reparse(sel). 3) reparse (mod.ts:87) does `parseTemplate(await Deno.readTextFile(path))`; tree-sitter recovers and returns a non-null rootNode with hasError===true (parse.ts:28-30 only throws on null), so no exception. 4) reparse stores that error node into reg (mod.ts:89) and returns true (mod.ts:90) — no hasError test. 5) Because reparse returned true, dev.ts:63 pushes `{type:'template', sel, template: astFor(sel)}` over SSE — astFor (mod.ts:92-95) serializes the error AST as-is. 6) Client hmr.ts:24-25 receives type==='template' and calls hotTemplate(sel, template). 7) hotTemplate (hydrate.ts:56-59) updates the registry entry and, for every live mounted instance, calls i.swap(template). 8) swap (hydrate.ts:222-227) sets nodes = named(fromSerialized(t)) and bumps the HMR tick signal, which retriggers the render effect (hydrate.ts:193-198), executing `el.innerHTML = renderNodes(...)` over the malformed AST -> broken/garbled DOM replaces the last-good markup while the user is still typing. The "state-kept" contract is technically honored (the scope/signals survive) but the markup is clobbered with garbage, which is the opposite of HMR's intent. The expected behavior — reparse detecting tree.rootNode.hasError and returning false (suppressing the push) or surfacing an error overlay — is simply absent.
- **Root locus:** `ui/.sprig/compiler/mod.ts:84-91 (reparse returns true without a hasError check), enabled by ui/.sprig/compiler/parse.ts:26-31 (parseTemplate guards only null, never rootNode.hasError)`
- **Shared root:** parser/compiler never checks tree-sitter rootNode.hasError — error-recovered (ERROR-bearing) ASTs are treated as valid and propagated through SSR/HMR instead of being rejected or surfaced

### RCA #64 — Partial-batch loss: a reparse throw (e.g. template.html renamed/deleted) skips every later template in the same debounced batch
- **Root cause:** Error handling in the dev watcher is at BATCH granularity, not per-file. handleChange (dev.ts:52-79) processes an entire debounced batch — a list of templates, plus the css and reload branches — in a single linear async flow with NO per-item try/catch. The only error boundary is one batch-level `.catch` attached to the whole handleChange promise at dev.ts:47. Because reparse (mod.ts:84-91) does `await Deno.readTextFile(path)` at mod.ts:87 with no internal guard, a file that is renamed/deleted between the Deno.watchFs event and the 60ms timer firing makes that read REJECT, so reparse throws an unhandled rejection. There is no design provision that a failure handling ONE changed file should be isolated from the others in the same batch; the loop and the css/reload steps share one fate.
- **Mechanism:** 1) A 60ms debounce window (dev.ts:44-48) collects multiple changed paths into one array. 2) handleChange splits them into `templates[]`, `css`, `reload` (dev.ts:55-59). 3) The template loop (dev.ts:61-66) calls `await cfg.renderer.reparse(sel)` for each selector with no try/catch inside the loop body. 4) reparse (mod.ts:84-91) resolves the path (mod.ts:85-86) and then `await Deno.readTextFile(path)` at mod.ts:87. If that file was renamed/deleted (atomic save, git checkout/stash, rename) after the watch event but before the timer fires, Deno.readTextFile REJECTS and reparse throws. 5) The throw is not caught in the loop, so it propagates out of handleChange — abandoning every later template iteration (later send({type:'template'}) at dev.ts:63) AND the css branch (dev.ts:68-72, buildCss + send css) AND the reload branch (dev.ts:74-78, buildClient + send reload). 6) The rejected handleChange promise is caught only at dev.ts:47, which sends a single {type:'error'} to clients. Net effect (matching the repro): {applied:[], cssRebuilt:false, sentError:true} — for a batch [A/template.html, B/template.html, x/styles.css] where A is removed, B's reparse and the css rebuild never run, and their HMR updates are silently dropped until an unrelated later save retriggers the watcher.
- **Root locus:** `ui/.sprig/compiler/dev.ts:61-66 (the unguarded template loop) combined with the single batch-level catch at ui/.sprig/compiler/dev.ts:47; the throw originates at ui/.sprig/compiler/mod.ts:87 (await Deno.readTextFile in reparse, no guard for a removed file)`
- **Shared root:** isolated — this is a dev-only HMR batch-isolation defect (single batch-level .catch over a multi-file handleChange with no per-file try/catch); it does not share an underlying root with the runtime interpreter/hydration/scopeCss bug families.

### RCA #65 — reparse() unconditionally returns true and broadcasts a full template swap even when the file content is unchanged
- **Root cause:** reparse() (ui/.sprig/compiler/mod.ts:84-90) performs an unconditional, side-effectful re-read + re-parse + registry overwrite and then hard-codes `return true` (line 90) for any selector whose source path exists. It keeps no record of the previous source bytes or previous serialized AST, so it has nothing to diff against and cannot distinguish a real edit from a no-op save. There is also no validity gate: parseTemplate (parse.ts:26-31) only guards a null tree (line 29) and happily returns a rootNode containing tree-sitter ERROR nodes, and reparse never calls a hasError check, so even a syntactically broken template is treated as a successful, change-worthy reparse. The defect is a missing change-detection/validity contract: the function's boolean return is meant to mean 'something meaningfully changed' but is implemented to mean 'the selector exists'.
- **Mechanism:** A no-op save of ui/src/.../<sel>/template.html emits a non-access watcher event. dev.ts:40-48 collects the path and, after the 60ms debounce, calls handleChange. dev.ts:56 classifies it as a template change (basename of dirname) and pushes <sel> into `templates`. dev.ts:61-65 loops and calls `await cfg.renderer.reparse(sel)`. Inside reparse (mod.ts:85-90): srcPath.get(selector) returns the path (truthy), so it does NOT early-return false (line 86); it re-reads the file (mod.ts:87 Deno.readTextFile) and re-parses via parseTemplate; it overwrites the registry entry with the freshly parsed template (mod.ts:88-89 `reg.set(selector, { ...cur, template: tpl })`) — replacing the cached Node identity even when bytes are identical; then it unconditionally returns true (mod.ts:90). Back in dev.ts, the truthy result makes line 63 `send({ type: 'template', sel, template: cfg.renderer.astFor(sel) })` serialize the AST (astFor → serialize, mod.ts:92-95) and broadcast it over SSE to every connected HMR client, and line 64 logs `[sprig dev] template ↻ <sel>`. Each client's hydrate runtime applies hotTemplate → swap → tick, fully re-rendering every mounted instance of <sel> despite zero content change. The error variant follows the same path: an introduced syntax error makes tree-sitter produce an ERROR root, parse.ts:29 passes it through (non-null), reparse still returns true (mod.ts:90), and the broken AST is broadcast and swapped into the live DOM instead of being suppressed.
- **Root locus:** `ui/.sprig/compiler/mod.ts:84-90 (specifically the unconditional `return true;` at mod.ts:90 with no source/AST diff and no hasError guard; the missing validity check originates in parse.ts:29 which only guards null)`
- **Shared root:** isolated

### RCA #66 — hotTemplate/live tracking grows unboundedly: `live` entries are never removed when an island detaches (soft-nav/HMR re-hydrate)
- **Root cause:** The `live` array (hydrate.ts:48) is an append-only registry of every island ever hydrated in HMR/dev mode. `hydrateIsland` unconditionally `live.push(...)` (hydrate.ts:219) for each island it mounts, but there is NO lifecycle teardown anywhere that registers a corresponding removal. The framework has no per-island unmount/detach hook: islands are torn down implicitly by `cur.innerHTML = next.innerHTML` (hydrate.ts:162) during soft-nav, which discards the old DOM subtree without any notification back to the `live` registry. Because detachment is implicit (a parent innerHTML overwrite), there is no callback site at which an entry could be spliced. The design assumed mounts are permanent (push-only), which is false in dev where soft-nav and re-hydration repeatedly detach and remount islands.
- **Mechanism:** Dev mode runs `enableHmr()` so `hmrEnabled` is true (hydrate.ts:42,51-53). On every island mount, `hydrateIsland` builds a `swap` closure and pushes a `LiveIsland` record into `live` (hydrate.ts:218-229). On soft-nav, `setupSoftNav`'s handler replaces the outlet contents via `cur.innerHTML = next.innerHTML` (hydrate.ts:162) — this detaches the old island elements (and their `scope`/signals/closures, kept alive by the `live` entry that closes over `nodes`, `scope`, `el`) — then calls `bootstrapIslands(cfg, cur)` (hydrate.ts:163), which arms and hydrates the NEW islands, each doing another `live.push`. The old entries are never spliced/filtered. `hotTemplate` (hydrate.ts:56-60) is the only consumer that touches `live`, and it merely iterates the full array and *skips* dead nodes via `document.contains(i.el)` (hydrate.ts:59) — it reads but never prunes. Result: after N navigations, `live.length` is O(total-ever-mounted); each detached entry retains its island element + scope (a heap leak), and every `template` HMR message makes `hotTemplate` do O(N) `document.contains` work to swap only the handful of currently-live instances.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/hydrate.ts:218-229 (the push-only `live.push(...)` with no teardown); the absence of a prune is observable at hydrate.ts:59 where `hotTemplate` skips but never deletes dead entries.`
- **Shared root:** soft-nav `cur.innerHTML = next.innerHTML` detaches islands with no unmount/teardown hook (no per-island lifecycle cleanup) — the same outlet-innerHTML-swap root that strands listeners/observers/state registered at mount time

### RCA #67 — AST endpoint decodes untrusted path with no error guard so a malformed percent escape throws and returns a server error instead of not found
- **Root cause:** Untrusted URL path is decoded with no error guard inside a synchronous fetch handler that has no error boundary so a malformed selector throws and yields a server error instead of a clean client error
- **Mechanism:** The handler slices the selector and decodes it with no validation so a lone percent throws synchronously and propagates to the server returning a server error before the lookup or the not found response can run
- **Root locus:** `ui dot sprig compiler dev ts at line one zero three the decode inside the fetch handler`
- **Shared root:** isolated

### RCA #68 — Outlet swap leaks the IntersectionObserver (and pending idle timers) of armed-but-not-yet-triggered islands inside the old outlet — they are never disconnected
- **Root cause:** scheduleLoad arms each island with trigger-specific resources (an IntersectionObserver for "visible", a requestIdleCallback/setTimeout for "idle", pointerover/focusin listeners for "interaction") but never records a teardown handle for any of them — there is no per-element/per-outlet registry of observers, timers, or listeners and no cleanup hook. The only release path for the IntersectionObserver is its own callback calling obs.disconnect() (hydrate.ts:98), which fires ONLY when the island actually intersects. The framework's lifecycle model is fire-and-forget arming: it assumes every armed trigger will eventually fire and self-clean. swap() destroys the subtree out-of-band (innerHTML reassignment) without any notion of "the islands I'm about to discard had pending arming work to cancel." So the root defect is the absence of an arming-teardown registry coupled with swap() doing a wholesale, lifecycle-unaware innerHTML replacement.
- **Mechanism:** 1) On full load of an issue page, bootstrapIslands -> scheduleLoad (hydrate.ts:88) runs for the star-rating island whose data-trigger is "visible". It takes the visible branch (lines 95-102): `const io = new IntersectionObserver(...); io.observe(el);`. The observer's callback (lines 96-100) calls obs.disconnect() + go() only when `entries.some(e => e.isIntersecting)`. The local `io` reference is never stored anywhere reachable. 2) Without scrolling the rating into view, the user clicks an in-app link. setupSoftNav's navigate handler (lines 144-172) intercepts and the handler eventually calls swap() (lines 161-165). 3) swap() executes `cur.innerHTML = next.innerHTML` (line 162), detaching the old star-rating element. It then calls `bootstrapIslands(cfg, cur)` (line 163) to arm the NEW subtree, but performs no teardown of the OLD subtree's armed resources. 4) Because the old island never intersected, obs.disconnect() (line 98) was never reached. The browser keeps an IntersectionObserver with active observations alive to deliver future callbacks, so `io` — and the `go` closure it transitively retains (go -> loadIsland with sel+cfg, line 93) — survives even though the observed element is detached. Each issue<->board cycle on an un-triggered visible island leaks exactly one observer; the count grows linearly with N. 5) The identical pattern applies to "idle" islands (lines 103-106): the requestIdleCallback/setTimeout(go,200) handle is discarded, so after a swap it later fires loadIsland for a now-detached island, performing a wasted chunk import; and to "interaction" islands' listeners, though those die with the detached element since they self-remove via {once:true}/removeEventListener and hold no external observer.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:88-118 (scheduleLoad arms observers/timers/listeners with no teardown registry; visible branch :95-102, idle branch :103-106), with the discard path at ui/.sprig/compiler/hydrate.ts:161-165 (swap: `cur.innerHTML = next.innerHTML` with no pre-swap cleanup of the old subtree)`
- **Shared root:** swap() does a wholesale, lifecycle-unaware `cur.innerHTML = next.innerHTML` replacement that discards the old outlet subtree without running any teardown — the same root behind the per-island reactive-effect leak and the dev-only `live` array growth; this bug is the observer/idle-timer facet of that same "innerHTML swap tears down nothing it armed" theme

### RCA #69 — Soft-nav swap commits the fetched outlet on ANY HTTP status and content-type — no response.ok / Content-Type guard; full-nav fallback is keyed only on outlet presence
- **Root cause:** The soft-nav intercept handler treats the fetched response as an opaque HTML blob and uses the single signal "does the parsed body contain a <sprig-outlet>?" as its entire success/fallback criterion. It never inspects the transport-level metadata that distinguishes a successful page-fetch from an error/redirect/non-HTML response: r.ok / r.status, r.redirected (or r.url vs destination), and the Content-Type header are all discarded at the point the body is read. Because the only fallback predicate is structural (presence of an outlet) rather than protocol-aware, any response that happens to embed an outlet — regardless of status code, redirect chain, or media type — is accepted as a valid navigation target. This is a design omission in the response-validation contract of setupSoftNav, not a downstream rendering bug.
- **Mechanism:** In ui/.sprig/compiler/hydrate.ts the intercept handler (registered at :149) does the fetch at :152 as `fetch(e.destination.url, { signal: e.signal }).then((r) => r.text())` — it immediately collapses the Response object to its text body, so r.ok, r.status, r.redirected, r.url, and r.headers.get("content-type") are never read and are unrecoverable past this line. At :154 the body is DOMParsed unconditionally. At :155-156 it extracts `next = doc.querySelector("sprig-outlet")` from the fetched body and `cur` from the live document. The sole guard at :157, `if (!next || !cur) location.assign(...)`, falls back to a full navigation ONLY when an outlet is absent. Therefore, for any 3xx/4xx/5xx or non-text/html response whose body still contains a <sprig-outlet>, control falls through to the swap closure (:161-165): `cur.innerHTML = next.innerHTML` commits the foreign/error body into the live outlet, islands are re-armed, and — because the handler returns normally rather than throwing or calling location.assign — the navigation is committed to history as a successful soft-nav of the original destination URL, surfacing no error. The bug is presently LATENT, not observable, because no server path yet produces an error/redirect body containing an outlet: ui/.sprig/core.ts:338 and :341 return plain-text "Not Found" (status 404, no outlet); core.ts:350/:354 run resolve/render with no try/catch (and packages/keep/mod.ts:100 wraps app.fetch with none either), so a thrown error becomes Deno's default plain-text 500 with no outlet; and no Response.redirect / 30x path exists anywhere in packages/, ui/.sprig/, or backend/src/. Each of those non-200 responses lacks an outlet and so currently trips the :157 fallback by accident. The latent defect becomes a real mis-render the moment any /ui/* path returns an HTML body that DOES contain <sprig-outlet> under a non-2xx status or a redirect (e.g. an SSR error page rendered through the shared shell at core.ts:355, or an auth login page that is itself a full sprig page).
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:152 (response collapsed to text with no r.ok/r.status/r.redirected/Content-Type inspection) compounded by the outlet-only fallback predicate at :157`
- **Shared root:** isolated — soft-nav response validation omission; distinct from the server-side error-handling gaps (no try/catch at core.ts:350/354, keep/mod.ts:100) which are merely what keeps this client-side defect latent rather than its root

### RCA #70 — Query-string-only and same-URL same-path navigations are intercepted and force a full outlet swap + scrollTo(0,0), discarding all in-outlet island state
- **Root cause:** The soft-nav `navigate` listener's intercept guard is under-specified: it filters out only hashChange/download/form navigations and same-origin/in-base mismatches, but never compares the destination URL against the current `location.href` nor checks whether only the query string changed. Consequently it treats EVERY remaining same-origin in-base navigation — including a navigationType "replace" to the identical URL (re-clicking the active link) or a query-only change — as a "real" page change requiring a full outlet teardown. Compounding this, the swap handler is itself unconditional and destructive: it does `cur.innerHTML = next.innerHTML`, re-bootstraps islands from scratch, and forces `scrollTo(0,0)`. There is no diff/equality fast-path and no preservation of existing in-outlet island instances, so the design assumes any intercepted navigation warrants a wholesale subtree replacement.
- **Mechanism:** ui/.sprig/compiler/hydrate.ts:145 — the predicate `if (!e.canIntercept || e.hashChange || e.downloadRequest || e.formData) return;` lets a same-URL "replace" navigation and a query-only navigation through (neither is a hashChange/download/formData). Lines 146-148 then only reject cross-origin or out-of-base URLs; a same-path or query-only destination on the same base passes. So `e.intercept(...)` at :149 runs. Inside the handler (:151-164) it unconditionally fetches the destination (:152), parses it, grabs the new `<sprig-outlet>` (:155) and current one (:156), then the `swap` closure at :161-164 executes `cur.innerHTML = next.innerHTML` (:162) — destroying every DOM node inside the live `<sprig-outlet>`, including the hydrated `<star-rating>` island and its `rating` signal — then calls `bootstrapIslands(cfg, cur)` (:163) which re-arms fresh island instances (with trigger:"visible", so they re-create with the default rating of 0), and finally `globalThis.scrollTo(0, 0)` (:164) jumps scroll to top. render.ts:125 wraps page content in `<sprig-outlet>` and ui/src/pages/issue/template.html:24-25 places the stateful `<star-rating>` inside it, so on /ui/issues/SPR-101 a same-URL re-click or a ?tab=x→?tab=y change resets the rating and scroll instead of being a no-op.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:145 (the over-permissive navigate filter — missing the same-URL no-op and query-only guards), enabling the unconditional destructive swap at ui/.sprig/compiler/hydrate.ts:161-165`
- **Shared root:** soft-nav outlet swap is an unconditional wholesale innerHTML re-render that discards in-outlet island state — same root as other bugs where the hydrate/soft-nav effect blows away the entire outlet subtree (cur.innerHTML = next.innerHTML) instead of preserving or diffing existing islands

### RCA #71 — Soft-nav to a new path containing a #fragment ignores the fragment and scrolls to top
- **Root cause:** The soft-nav intercept handler opts out of native scroll behavior (`scroll: "manual"` at hydrate.ts:150) but never re-implements fragment scrolling. Its scroll logic at :164 is a hardcoded `globalThis.scrollTo(0, 0)` that ignores the destination URL's hash. The intercept filter at :145 only excludes `e.hashChange` (same-document hash-only navigation), so a cross-document navigation that *also* carries a fragment is intercepted and routed through this fragment-blind swap path. The combination — manual scroll mode + a swap() that unconditionally scrolls to top and never inspects `url.hash` (which is available from the parsed URL at :146 but unused) — is the underlying defect: the framework assumes every intercepted navigation should land at the top of the page.
- **Mechanism:** setupSoftNav arms a Navigation-API 'navigate' listener (hydrate.ts:144). The guard at :145 returns early only for `e.hashChange` (same-document hash-only changes); a cross-document path change that carries a #fragment has `e.hashChange===false`, so the guard does NOT return and the navigation is intercepted (:149). The intercept is configured with `scroll: "manual"` (:150), which deliberately suppresses the browser's built-in fragment/scroll restoration so the framework must do its own scroll. The handler parses `url = new URL(e.destination.url)` at :146 (this URL still contains the hash, e.g. "#comments"), fetches the destination HTML, swaps `cur.innerHTML = next.innerHTML` (:162), re-bootstraps islands (:163), then calls `globalThis.scrollTo(0, 0)` unconditionally (:164). Because `url.hash` is never read after :146 and the manual scroll mode disabled native anchor scrolling, the destination element with the matching id (e.g. id="comments") is never scrolled into view; the viewport jumps to the top while the address bar still shows "#comments".
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:164 (unconditional scrollTo(0,0) in swap()), enabled by the manual-scroll opt-out at :150 and the hashChange-only filter at :145`
- **Shared root:** isolated

### RCA #72 — serveAsset serves static assets for ANY HTTP method (POST/PUT/DELETE return 200 + full body) — no GET/HEAD restriction
- **Root cause:** The static-asset path is modeled as a pure pathname-keyed file read with no notion of HTTP method semantics. serveAsset was designed with the signature `serveAsset(dir, file)` — it deliberately takes no Request and no method — and the dispatcher at mod.ts:86-88 routes on pathname alone, so there is no place in the code where the request verb is examined or where a 405/Allow response could be produced. This is a missing-method-validation design omission, not an incorrect computation.
- **Mechanism:** In serveSprig.fetch, the asset branch (mod.ts:86-88) matches purely on pathname: `if (path.startsWith(assetPrefix + "/")) { return serveAsset(assetsDir, path.slice(assetPrefix.length + 1)); }`. It passes only (assetsDir, file) — `req` and `req.method` are never forwarded. serveAsset(dir, file) (mod.ts:39) has no Request/method parameter; its body (mod.ts:41-53) only does a `..` traversal check, reads the file with Deno.readFile (mod.ts:43), and unconditionally returns `new Response(bytes, {headers:{content-type, cache-control}})` (mod.ts:45-50). Because nothing inspects the verb, ANY method (GET/POST/PUT/DELETE/PATCH) that hits the asset prefix gets status 200 with the full file body and the immutable cache-control header. Method-conditional behavior — 200 only for GET/HEAD, 405 + `Allow: GET, HEAD` for the rest, and empty-body-with-headers for HEAD — is simply absent from both the dispatch site and serveAsset, so it can never occur.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/packages/keep/mod.ts:39 (serveAsset signature/body, lines 39-54) — reinforced by the method-blind dispatch at mod.ts:86-88`
- **Shared root:** isolated

### RCA #73 — serveAsset \"..\" guard over-blocks legitimate single-segment filenames containing a double-dot substring (403 for a valid in-dir file)
- **Root cause:** The traversal guard at packages/keep/mod.ts:41 uses a substring test (file.includes("..")) instead of a path-segment / normalization check. Path traversal is a property of a whole ".." SEGMENT delimited by slashes, not of the two-character byte sequence "..". By testing for the bare substring, the guard treats any filename with two consecutive dots as malicious. It is both wrong-in-the-blocking-direction (false-positive on legal names) AND structurally redundant: the only input ever reaching it is already a URL-normalized single segment with no traversal possible, so the guard contributes nothing but false rejections.
- **Mechanism:** In serveSprig.fetch (mod.ts:86-87), a request matching the assets prefix has file = path.slice(assetPrefix.length + 1) passed to serveAsset. path comes from new URL(req.url).pathname (mod.ts:82), which the WHATWG URL parser has ALREADY normalized: any genuine ../ traversal segments collapse before this point (per repro, /ui/_assets/../mod.ts normalizes away and never even matches the prefix). So file is effectively a single non-slash segment of the form name.ext. serveAsset (mod.ts:41) then runs if (file.includes("..")) return 403 — a blunt substring scan with no slash/segment awareness. A legitimate build artifact name such as foo..bar.js, client..js, v1..2.css, or app..min.js contains the literal two-character substring ".." and therefore matches includes(".."), returning 403 Forbidden unconditionally. Control never reaches Deno.readFile (mod.ts:43), so the request can never resolve to 200 (file present) or 404 (file absent). The guard conflates the path-traversal token .. (a whole segment between slashes) with the byte sequence .. (any two adjacent dots), over-blocking valid in-directory filenames.
- **Root locus:** `packages/keep/mod.ts:41`
- **Shared root:** isolated

### RCA #74 — Asset content-type lookup is case-sensitive on the file extension: .JS/.CSS/.SVG served as application/octet-stream
- **Root cause:** serveAsset derives the file extension verbatim and looks it up in an ASSET_TYPES map whose keys are exclusively lowercase, with no case normalization on the lookup key. The map (packages/keep/mod.ts:31-37) is keyed ".js"/".css"/".map"/".svg"/".json"; the lookup key at line 44 is the raw substring after the last dot. The design implicitly assumes file extensions are always lowercase, but on a case-insensitive filesystem (macOS default) a request path like client.JS still resolves to the on-disk client.js file, so the read succeeds while the extension casing does not match any map key.
- **Mechanism:** Request for /_assets/client.JS reaches serveAsset(dir, "client.JS"). Line 43 Deno.readFile(`${dir}/client.JS`) succeeds on the case-insensitive FS, returning the real bytes of client.js. Line 44 computes ext = "client.JS".slice("client.JS".lastIndexOf(".")) = ".JS". Line 47 evaluates ASSET_TYPES[".JS"], which is undefined because the map only has ".js"; the `?? "application/octet-stream"` fallback fires. The Response is built with content-type application/octet-stream and HTTP 200 plus the immutable cache-control header. The browser receives a 200 with valid bytes but, under strict MIME checking / X-Content-Type-Options nosniff semantics for module/classic scripts, refuses to execute a script served as application/octet-stream — silently breaking the page even though the asset exists and is served. Same path applies to .Css, .SVG, etc.
- **Root locus:** `packages/keep/mod.ts:44 (and the lookup at :47) — ext computed without .toLowerCase() before indexing the lowercase-keyed ASSET_TYPES (defined :31-37)`
- **Shared root:** isolated

### RCA #75 — Static assets send no ETag/Last-Modified, so conditional GETs (If-None-Match/If-Modified-Since) never return 304 and always re-transfer the full body
- **Root cause:** serveAsset() is a minimal "read bytes, set two headers, return 200" handler that has no concept of cache validation. It never computes a validator (no content hash for ETag, no Deno.stat mtime for Last-Modified) and never reads the incoming request's If-None-Match / If-Modified-Since headers — in fact serveAsset receives only (dir, file) and is never passed the Request at all, so it structurally cannot implement a conditional-GET / 304 path. The design relied entirely on cache-busting via `?v=${version}` + `immutable` and therefore deliberately omitted revalidation support.
- **Mechanism:** In packages/keep/mod.ts the fetch dispatcher matches the asset prefix and calls `serveAsset(assetsDir, path.slice(...))` at line 87 — note it passes no Request, so the conditional request headers are discarded at the call boundary. Inside serveAsset (lines 39-54): line 43 reads the full file into `bytes`; lines 45-50 build `new Response(bytes, { headers: { content-type, cache-control: "public, max-age=31536000, immutable" } })`. No ETag is computed from the bytes, no Last-Modified is derived from file metadata (Deno.stat is never called), and there is no `req.headers.get("if-none-match")`/`if-modified-since` comparison and no `return new Response(null, { status: 304 })` branch. Consequently every request — even one carrying If-None-Match/If-Modified-Since — falls through the single `return ... bytes` path, emitting HTTP 200 with the full body (content-length 29112) and no validators, exactly as the repro shows. The `vary: Accept-Encoding` header in the observed output is added downstream by Deno.serve compression, not by serveAsset. Impact is limited because document() at ui/.sprig/compiler/mod.ts:124,131 references client.js/app.css with `?v=${version}` and the response is marked `immutable`, so conforming browsers never revalidate; only force-refreshes and proxies ignoring `immutable` hit the missing-304 cost.
- **Root locus:** `packages/keep/mod.ts:39-50 (serveAsset: signature omits the Request and Response built with only content-type + cache-control; root reinforced by the call at line 87 which passes no Request)`
- **Shared root:** isolated — this is the serveAsset static-file handler omitting cache validators / conditional-GET handling, distinct from the SSR/hydration/interpreter/scopeCss bug families

### RCA #76 — titlecase pipe mis-capitalizes any word starting with a non-ASCII letter
- **Root cause:** The titlecase pipe's word-matching regex `/\w\S*/g` uses the ASCII-only `\w` character class (without the `/u` flag), which matches only `[A-Za-z0-9_]`. For a word whose first character is a non-ASCII letter (e.g. "é", "ü"), `\w` does not match that leading letter, so the regex instead anchors on the first ASCII word-character later in the word. The matched substring therefore starts at the wrong offset, and `w[0]` is not the word's true first letter.
- **Mechanism:** At ui/.sprig/compiler/expr.ts:150 the callback runs on each `/\w\S*/g` match. For input "éric", `\w` skips the non-ASCII "é" and first matches at the ASCII "r", so `\S*` greedily extends the match to "ric" — the matched word `w` is "ric" (the leading "é" is left untouched, outside any match). The callback then does `w[0].toUpperCase()` ("R") + `w.slice(1).toLowerCase()` ("ic"), producing "Ric", and splicing back the unmatched "é" yields "éRic". Same for "über" -> "üBer". For a word composed entirely of non-ASCII letters (e.g. "über" without the trailing ASCII... or any all-accented word), `\w` finds no match at all, so the word is left completely untouched / not title-cased. The expected Angular semantics (uppercase the FIRST letter of each word) are violated because the regex's notion of "word start" is ASCII-bound rather than Unicode letter-aware.
- **Root locus:** `ui/.sprig/compiler/expr.ts:149-150 (titlecase pipe lambda; specifically the `/\w\S*/g` regex literal on line 150)`
- **Shared root:** isolated — this is a single ASCII-only regex defect (`\w` without `/u`) localized to the titlecase pipe. The sibling pipes uppercase/lowercase (lines 147-148) use `toUpperCase`/`toLowerCase`, which are already Unicode-correct, so they are unaffected; no other pipe shares this word-boundary regex logic.

### RCA #77 — @let declaration is not block-scoped — it mutates and leaks into the enclosing/parent render scope
- **Root cause:** The renderer has no notion of a per-view (block-local) scope. `Scope` is a plain mutable `Record<string, unknown>` passed by reference (expr.ts:6), and the `let_declaration` case writes a binding DIRECTLY onto `opts.scope` (render.ts:91) instead of into a scope owned by the enclosing block. Compounding this, block-entering control flow only ever clones the scope when it has a *binding to add* (alias in @if, loop locals/item in @for) — when a block adds nothing of its own it reuses the parent scope OBJECT verbatim (render.ts:353 `scope = opts.scope`; and @defer/ng-container/else/switch-case recurse with `opts` unchanged at render.ts:95/129/365/403/408). So an @let inside an alias-less block has no fresh object to land on; it lands on, and overwrites, the parent's scope. The defect is the design decision to treat scope as a single shared mutable bag with no fresh child view per block, not any single line.
- **Mechanism:** Repro `@if (cond) { @let x = 'inner'; <a>{{ x }}</a> } <b>{{ x }}</b>` with scope `{ cond:true, x:"OUTER" }`: renderNode dispatches the if_block to renderIf (render.ts:85→349). The condition is truthy (350-351); since the @if has NO alias, line 353 sets `scope = opts.scope` — the SAME object reference as the parent scope (not a clone). renderNodes recurses into the consequence with `{ ...opts, scope }` where `scope === parent scope` (354). Inside, the let_declaration case executes `opts.scope["x"] = evalExpr('inner') = "inner"` (render.ts:91), mutating the shared parent scope object in place — `x` is now "inner" for everyone. `<a>{{ x }}</a>` reads it → "inner" (correct for that block). Control returns to the parent renderNodes loop, which renders `<b>{{ x }}</b>` against the very same, now-mutated, parent scope → escape(stringify(scope.x)) yields "inner" instead of the original "OUTER" (render.ts:78). Result: `" <a>inner</a> <b>inner</b>"`; the assertion for `<b>OUTER</b>` fails. The leak is purely the alias-less reuse at 353 feeding the in-place write at 91.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/sprig/ui/.sprig/compiler/render.ts:90-92 (let_declaration writes onto opts.scope) — enabled by render.ts:353 (alias-less @if reuses opts.scope by reference); same enabling pattern at render.ts:95 (@defer), 129 (ng-container), 365 (else_clause), 403/408 (switch). Scope's pass-by-reference mutability is rooted in expr.ts:6.`
- **Shared root:** Renderer uses one shared mutable scope object with no fresh child view per block — control-flow blocks only clone the scope when they have their own binding to add (alias/loop locals), otherwise they recurse with the parent scope object verbatim. This same "scope reused by reference into a nested block" root underlies any state that should be view-local but isn't (@let leakage here; and it is why @let inside @defer/ng-container/else/switch also leaks). Theme: "block control flow reuses the parent scope object by reference instead of giving each view a fresh child scope."

### RCA #78 — i18nPlural pipe throws (uncaught) when the matched ICU value is not a string
- **Root cause:** The i18nPlural pipe at ui/.sprig/compiler/expr.ts:171-176 assumes the matched ICU branch value (map['=N'] / map.other) is always a string and calls the String-only method .replace() directly on it (line 175: key.replace("#", String(n))). But the pipe's argument map is produced by evalExpr's object-literal case (expr.ts:76-84), which evaluates each value via evalExpr — and a numeric literal value is turned into a real JS number (expr.ts:21-22). So when the template author writes a numeric (or any non-string) branch value, `key` is a number with no .replace method. The pipe lacks the String(...) coercion guard that every other string-producing pipe in PIPES uses. This is a missing-coercion defect: the pipe trusts a TypeScript type annotation (Record<string,string> at line 172) that the runtime evaluator does not enforce.
- **Mechanism:** 1) Template `{{ count | i18nPlural: { '=1': 1, other: 0 } }}` parses into a pipe_expression whose argument is an object literal. 2) evalPipe -> evalExpr on the object node (expr.ts:76-84) builds {'=1':1,'other':0}, where each value is run through evalExpr; numeric literal nodes hit case "number" (expr.ts:21-22) and become the JS numbers 1 and 0 — NOT strings. 3) PIPES.i18nPlural (expr.ts:171-176) runs: map cast to Record<string,string> (a lie at runtime, line 172), n = Number(count) = 1, key = map['=1'] = the number 1 (line 174). 4) Line 175 calls key.replace("#", String(n)) on a number -> 'TypeError: key.replace is not a function'. 5) This pipe is invoked from renderNode's interpolation case (render.ts:78: escape(stringify(evalExpr(...)))) which has NO try/catch, nor does evalExpr/evalPipe. 6) The TypeError unwinds the entire render call stack, escaping SSR render as an HTTP 500 (server) or unhandled rejection (client hydration).
- **Root locus:** `ui/.sprig/compiler/expr.ts:175 (the unguarded key.replace call inside the i18nPlural pipe, expr.ts:171-176)`
- **Shared root:** Two overlapping themes: (a) "string-producing pipe assumes its operand/branch value is already a string and omits the String(...) coercion that other PIPES entries use" — same family as truncate/currency/i18nSelect guarding with String(...) while i18nPlural does not; and (b) "evalExpr/evalPipe and the renderNode interpolation path (render.ts:78) have no try/catch, so any pipe/expression runtime error escapes SSR render as a 500 / client unhandled rejection." Bugs where a single thrown expression takes down the whole page share root (b); bugs where a pipe trusts an unenforced type annotation instead of coercing share root (a). Not isolated.

### RCA #79 — formatNumber silently ignores minIntegerDigits in the digits-info format
- **Root cause:** formatNumber implements only a partial mapping of Angular's DecimalPipe digitsInfo grammar `{minIntegerDigits}.{minFractionDigits}-{maxFractionDigits}`. The regex at expr.ts:187 deliberately uses a non-capturing leading `\d+` (no parentheses) for the integer-digits field, so that field is matched-and-discarded rather than parsed. Consequently the function maintains no `minInt` variable and never forwards `minimumIntegerDigits` to toLocaleString. The integer-padding feature of the format spec was simply never wired in — the field is acknowledged in the comment at expr.ts:184 but unimplemented in the regex captures (expr.ts:187-188) and in the Intl options object (expr.ts:190).
- **Mechanism:** For `{{ 5 | number:'3.0-0' }}` the pipe calls formatNumber(5, "3.0-0"). At expr.ts:187 the regex `/^\d+\.(\d+)-(\d+)$/` matches: the leading `\d+` consumes "3" (the minIntegerDigits, but it is NOT in a capture group, so it is thrown away), group 1 captures "0" (minFrac) and group 2 captures "0" (maxFrac). At expr.ts:188 only minFrac=0 and maxFrac=0 are assigned; there is no variable for the integer digits. At expr.ts:190 toLocaleString is invoked with `{ minimumFractionDigits: 0, maximumFractionDigits: 0 }` and no `minimumIntegerDigits` key, so Intl defaults minimumIntegerDigits to 1. (5).toLocaleString therefore yields "5" instead of the expected "005". The "3" was parsed by the regex engine but never applied — exactly the discarded-leading-group defect.
- **Root locus:** `ui/.sprig/compiler/expr.ts:187-190 (regex with non-capturing leading \d+ at line 187; assignment omitting minInt at line 188; toLocaleString options omitting minimumIntegerDigits at line 190)`
- **Shared root:** isolated — partial reimplementation of Angular's DecimalPipe digitsInfo grammar that parses but never applies the minIntegerDigits field. (Thematically akin to other "sprig pipe partially reimplements an Angular pipe and drops a sub-feature" defects, but this specific minIntegerDigits omission in formatNumber stands on its own.)

### RCA #80 — Assignment to a subscript target (arr[i] = x / obj['k'] = x) silently no-ops in event handlers
- **Root cause:** assignTo (ui/.sprig/compiler/expr.ts:227-237) is an incomplete lvalue dispatcher: it enumerates only two of the assignable left-hand-side node types the grammar can produce — `identifier` (line 229) and `member_expression` (line 233) — and has no `subscript_expression` branch and no fallback/error case. The read side of the interpreter (evalExpr) DOES handle subscript_expression (line 39), so the lvalue and rvalue evaluators are out of sync: the set of node types the evaluator can READ is strictly larger than the set it can WRITE. A subscript lvalue therefore matches neither if/else-if branch, assignTo runs to its end, and returns void having performed no mutation and thrown no error.
- **Mechanism:** 1. An (event) handler such as `(click)="items[0] = 5"` is parsed; the statement node has type `assignment`. 2. evalStatement (line 214) detects it via `stmt.type === "assignment"` (line 219) and calls assignTo(field(stmt,"left"), evalExpr(field(stmt,"right"), s), s) (line 220) — the RHS (5) is evaluated correctly, and assignTo is handed the left node, which for `items[0]` / `obj['k']` is a `subscript_expression`. 3. In assignTo, `left` is non-null so the early return at 228 is skipped; `left.type === "identifier"` is false (229), and `left.type === "member_expression"` is false (233) because the type is `subscript_expression`. 4. With no matching branch and no else/default, control reaches the closing brace at 237 and the function returns void. No `obj[index] = value` write ever executes. 5. Because the read path at line 39 still resolves `items[0]` for any subsequent render, and no exception is raised, the failure is silent and asymmetric: the click appears to do nothing, the array is unchanged, and no error surfaces in the console.
- **Root locus:** `ui/.sprig/compiler/expr.ts:227-237 (the assignTo function — specifically the missing third branch after line 235)`
- **Shared root:** assignTo lvalue dispatcher handles only a subset of assignable node types (identifier + member_expression) while evalExpr reads a larger set — interpreter's write path is narrower than its read path, so unhandled lvalue node types silently no-op

### RCA #81 — number / percent / currency pipes emit "NaN" / "NaN%" / "$NaN" for non-numeric or undefined input
- **Root cause:** The numeric-formatting code path coerces every value through Number(v) and then formats it with no finite-value guard, so non-finite results (NaN from undefined/non-numeric input, or Infinity/NaN from arithmetic) are stringified literally instead of being replaced with a graceful fallback. The defect is the absence of an isNaN/isFinite check in the single shared formatter `formatNumber` (expr.ts:183-191) and equally in the final `stringify` helper (render.ts:412-417), both of which trust the host's toLocaleString/String to never produce a "bad" string — but JS's Number-to-string for non-finite values yields the literal tokens "NaN" and "Infinity".
- **Mechanism:** 1) A binding like {{ missing | number }} evaluates the pipe value to `undefined` (expr.ts:137). 2) The `number` pipe (expr.ts:153) calls formatNumber(Number(undefined), fmt) = formatNumber(NaN, fmt). 3) formatNumber (expr.ts:190) does `n.toLocaleString("en-US", {...})` with no NaN guard; NaN.toLocaleString() returns the string "NaN". The `percent` pipe (expr.ts:154) wraps the same result as `${...}%` → "NaN%". The `currency` pipe (expr.ts:155-161) instead calls `Intl.NumberFormat(...).format(Number(v))`; Intl formats NaN as "$NaN" (and the catch branch's `Number(v).toFixed(2)` would give "NaN" too). 4) Separately, arithmetic in interpolation: `{{ 5 / 0 }}` and `{{ 5 % 0 }}` hit evalBinary cases at expr.ts:106 (`a / b` → Infinity) and expr.ts:107 (`a % b` → NaN). 5) The resulting pipe-string or raw number reaches render's stringify (render.ts:412-417): a string passes through unchanged at line 414, and a non-finite number falls to `return String(v)` at line 416, which yields "Infinity"/"NaN". 6) That literal text is concatenated into the HTML output and rendered verbatim on the page. No stage in this chain tests Number.isFinite, so the bad tokens survive to the DOM.
- **Root locus:** `ui/.sprig/compiler/expr.ts:190 (formatNumber's unguarded n.toLocaleString) — shared by the number/percent pipes; the currency pipe (expr.ts:155-161) and stringify (render.ts:416) are sibling instances of the same missing guard.`
- **Shared root:** numeric formatters/stringify coerce via Number() and emit non-finite values (NaN/Infinity) verbatim with no isFinite guard

### RCA #82 — percent pipe uses the number default maxFraction=3 instead of Angular's '1.0-0', emitting extra fraction digits
- **Root cause:** formatNumber (ui/.sprig/compiler/expr.ts:183-191) bakes in a single hardcoded fraction-digit default — maxFrac=3 at line 185 — that is correct only for the `number` pipe. The `percent` pipe (line 154) reuses that same helper with no way to override the default when no digitsInfo argument is supplied, so it silently inherits the number pipe's 3-digit maximum. Angular intentionally gives each pipe a distinct default digitsInfo (DecimalPipe '1.0-3', PercentPipe '1.0-0'); sprig collapses both into one shared helper with one shared default, dropping the per-pipe distinction.
- **Mechanism:** Template `{{ 0.12345 | percent }}` (or fixtures/golden.html:259 `{{ ratio | percent }}` with ratio=0.1234) invokes PIPES.percent (expr.ts:154) with args=[] so a[0] is undefined. percent calls formatNumber(0.12345*100=12.345, undefined). In formatNumber, fmt is falsy so the `if (fmt)` block (expr.ts:186-189) never runs and the initializer defaults stand: minFrac=0, maxFrac=3 (line 185). toLocaleString(line 190) then formats 12.345 with maximumFractionDigits:3, yielding "12.345", and percent wraps it as "12.345%" (line 154). Angular's PercentPipe default digitsInfo '1.0-0' would have set maxFrac=0, rounding to "12%". Same path produces "12.34%" vs Angular "12%" for ratio=0.1234.
- **Root locus:** `ui/.sprig/compiler/expr.ts:185 (hardcoded maxFrac=3 default in formatNumber), reached via the percent pipe at ui/.sprig/compiler/expr.ts:154 which passes no percent-specific default.`
- **Shared root:** formatNumber helper hardcodes one fraction-digit default (maxFrac=3) shared across number and percent pipes, ignoring Angular's per-pipe default digitsInfo

### RCA #83 — formatNumber ignores minIntegerDigits even when a full digitsInfo is supplied
- **Root cause:** formatNumber's digitsInfo parser captures only the fractional bounds of Angular's "{minInt}.{minFrac}-{maxFrac}" spec and never threads the integer-padding component into the Intl formatter. The regex at expr.ts:187 (`/^\d+\.(\d+)-(\d+)$/`) matches the leading `\d+` (minIntegerDigits) as a non-capturing literal — there is no capture group around it — so its value is discarded the instant the match succeeds. The toLocaleString options object at expr.ts:190 is hard-coded to only `minimumFractionDigits`/`maximumFractionDigits`, with no `minimumIntegerDigits` key. Thus the integer-padding dimension of digitsInfo is structurally absent from the implementation, not merely mis-passed.
- **Mechanism:** For `{{ 5 | number:'3.1-5' }}`, the number pipe routes to formatNumber(5, '3.1-5'). At expr.ts:187 the regex `^\d+\.(\d+)-(\d+)$` matches: the leading `\d+` consumes "3" but is uncaptured, group 1 captures "1" (minFrac), group 2 captures "5" (maxFrac). At expr.ts:188 minFrac=1, maxFrac=5 are assigned; the "3" is gone. At expr.ts:190 `n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 5 })` is called with no minimumIntegerDigits, so Intl uses its default of 1 integer digit and emits "5.0" instead of the expected "005.0". The minIntegerDigits=3 directive was parsed-then-dropped, so no integer padding ever occurs.
- **Root locus:** `ui/.sprig/compiler/expr.ts:187-190 (uncaptured leading `\d+` in the regex at :187 and the missing `minimumIntegerDigits` option in the toLocaleString call at :190)`
- **Shared root:** isolated

### RCA #84 — :host used inside a compound selector (`:host.x`, `:host[attr]`, `:host:hover`) gets the scope attribute applied twice, emitting redundant/duplicated markers
- **Root cause:** The `:host`-special-casing in scopeSelector only covers two SHAPES — bare `:host` (line 91) and a selector that is EXACTLY `:host(...)` (lines 92-93). It has no case for `:host` used inside a compound (`:host.x`, `:host[attr]`, `:host:hover`, or even `:host(x).y`). Those fall through to the generic `:host`→token global replace at line 95, which places the scope token at the HEAD of the key compound. The downstream "already scoped, don't re-add" guard in insertToken (line 118) was written assuming a `:host`-derived token always lands at the TAIL of the compound: it only checks `compound === token || compound.endsWith(token)`. A token at the head (with trailing `.active`/`[attr]`/`:hover`) is invisible to that guard, so insertToken adds the marker a second time. The defect is the mismatch between WHERE line 95 puts the token (head of compound) and WHERE line 118's guard looks for it (whole string or tail).
- **Mechanism:** scopeSelector handles `:host` standalone (line 91 `if (sel === ":host") return token;`) and `:host(x)` standalone (lines 92-93 `:host(x)` => `token + x`) as whole-selector special cases that return early WITHOUT re-scoping. But for a `:host`-anchored COMPOUND (`:host.active`, `:host[attr]`, `:host:hover`) none of those early returns fire — `sel !== ":host"` and the anchored regex `/^:host\(([^)]*)\)$/` requires the whole selector to be exactly `:host(...)`. Execution falls through to the global replace at line 95: `sel.replace(/:host\b/g, token)` turns `:host.active` into `[sAAAA].active`, `:host[dir="rtl"]` into `[sAAAA][dir="rtl"]`, `:host:hover` into `[sAAAA][sAAAA]`-precursor `[sAAAA]:hover`. The token is now embedded at the HEAD of the key compound. With no top-level combinator, keyStart stays 0 (lines 98-108) and the entire string is passed to insertToken (line 111). insertToken's already-scoped guard (line 118) only recognizes the token when `compound === token` OR `compound.endsWith(token)`. For these compounds the token sits at the START (followed by `.active`/`[dir="rtl"]`/`:hover`), so neither condition holds, the guard fails to detect the existing marker, and insertToken appends/inserts a SECOND token: `.active` (no pseudo) hits line 123 `compound + token` => `[sAAAA].active[sAAAA]`; `[dir="rtl"]` (no pseudo) likewise => `[sAAAA][dir="rtl"][sAAAA]`; `:host:hover`→`[sAAAA]:hover` matches the pseudo regex at line 120 and inserts token before `:hover` => `[sAAAA][sAAAA]:hover`. Hence the marker appears twice.
- **Root locus:** `ui/.sprig/compiler/scope.ts:118 (insertToken already-scoped guard only matches `compound === token || compound.endsWith(token)`, missing the head-anchored token produced by the line 95 `:host`→token replace)`
- **Shared root:** scope.ts :host handling only recognizes :host as a standalone selector (`:host` / exactly `:host(x)`); :host inside a compound falls through to the generic token replace whose placement the insertToken guard cannot detect

### RCA #85 — insertToken's pseudo-detector regex `/::?[\w-]/` does not skip backslash-escaped colons, so an escaped colon in a class name (.foo\:bar) is misread as a pseudo and the scope token is spliced inside the escape sequence
- **Root cause:** The pseudo-class detector in insertToken (scope.ts:120) uses the regex `/::?[\w-]/` to locate the first pseudo within the key compound so the scope attribute can be inserted before it. The regex matches ANY colon followed by a word character and has no notion of CSS escape sequences: it does not skip a colon that is preceded by a backslash. In CSS, `\:` is a valid way to write a literal colon inside an identifier (e.g. a class literally named `foo:bar`, common with Tailwind-style utility names), so the colon in `.foo\:bar` is part of the class identifier, not a pseudo-class introducer. Because the matcher is lexically blind, it treats the escaped `:b` as a pseudo and inserts the token at that index — splitting the `\:` escape sequence. The design defect is that the compound is scanned by a context-free regex instead of a tokenizer/scanner that consumes a backslash plus the following character as a single atomic escaped unit before testing for pseudo boundaries.
- **Mechanism:** For input `.foo\:bar { color:red }`, processBlock routes the rule selector to scopeSelector. The keyStart scanner (scope.ts:98-108) only advances keyStart on top-level combinators/whitespace; backslash, colon and word chars don't trigger it, so keyStart stays 0 and the whole compound `.foo\:bar` is handed to insertToken (scope.ts:111). In insertToken, line 120 runs `compound.match(/::?[\w-]/)`. This regex looks for the first single/double colon followed by a word char, with NO check for a preceding backslash. The literal escaped colon at index 5 (`\:b`) matches because `:b` is `:`+`\w`; m.index === 5. Line 121-122 then returns `compound.slice(0,5)` (`.foo\`) + token (`[sXX]`) + `compound.slice(5)` (`:bar`) = `.foo\[sXX]:bar`. The backslash left at the end of the head now escapes the inserted `[`, so `\[` becomes a literal `[` character rather than the start of an attribute selector. The emitted rule `.foo\[sXX]:bar` no longer carries a valid `[sXX]` attribute marker and the class name is mangled, so the rule matches nothing (and leaks malformed CSS into the shared app.css). Expected `.foo\:bar[sXX]` would require treating `\:` as one escaped class char and appending the token after the whole compound (the `compound + token` fallback at line 123).
- **Root locus:** `ui/.sprig/compiler/scope.ts:120`
- **Shared root:** scope.ts selector/CSS matchers ignore lexical context (CSS escape sequences and string context) — the same root behind scopeCss brace/paren/colon matchers that don't skip backslash-escaped or quoted characters

### RCA #86 — Unbounded growth of the `live` island array — dev HMR memory leak across soft-navigations
- **Root cause:** Islands have no unmount/disposal lifecycle, and the `live` HMR registry (hydrate.ts:48) is append-only: hydrateIsland() pushes an entry at :219 on every hydration but there is no corresponding removal anywhere in the file. The soft-nav swap (hydrate.ts:161-165) replaces the outlet's content via `cur.innerHTML = next.innerHTML` (:162), which detaches the old island's element without notifying or disposing the runtime, so its `live` entry — and the closure over its detached `el`, reactive `scope`/signals, and handler tables — is orphaned and retained for the tab's lifetime. The defect is the missing teardown coupling between an island leaving the DOM and its registration being pruned, not anything in hotTemplate's `document.contains` guard (which only masks correctness, not the leak).
- **Mechanism:** In HMR/dev mode, hydrateIsland() unconditionally APPENDS a LiveIsland to `live` at hydrate.ts:219 every time an island hydrates, and nothing ever removes entries (no splice/filter/delete/pop exists in the file — confirmed by full read; the sole mutation is the push at :219). On soft-nav, the navigate handler's swap() at hydrate.ts:162 does `cur.innerHTML = next.innerHTML`, which DETACHES the previously-mounted island's `el` from the document, then calls bootstrapIslands(cfg, cur) at :163. That re-arms and lazy-loads the destination island, whose chunk calls registerIsland -> hydratePending -> hydrateIsland, pushing a SECOND entry (:219). Because the swap never disposes the islands it removes (innerHTML assignment silently drops the old subtree; there is no unmount/teardown hook), the old entry survives. Each orphan's swap closure (:222-228) captures `el`, `nodes`, `source`, `scope`, `tick`, `handlers`, and `wire`, so the detached DOM subtree plus the island's reactive scope (signals/state) and handler tables are retained for the tab's lifetime. After N round trips, live.length is ~N+1 while only the current island(s) are mounted. hotTemplate (:56-60) still iterates ALL entries on every template save, guarding only correctness with `document.contains(i.el)` at :59 — so per-save work and retained memory grow linearly with navigation count.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:48 (the append-only `live` array with no removal path) — the leak is realized by the unconditional push at hydrate.ts:219, and triggered by the dispose-less outlet replacement at hydrate.ts:162`
- **Shared root:** soft-nav `cur.innerHTML = next.innerHTML` outlet replacement (hydrate.ts:162) tears down island DOM with no unmount/dispose hook — islands have no lifecycle teardown, so registries/listeners/effects tied to removed islands are never cleaned up

### RCA #87 — `fetchAst` does not URL-encode the selector, mismatching the server's decodeURIComponent
- **Root cause:** The client-side AST fetch and the server-side AST handler form an asymmetric, unvalidated URL-encoding contract. `fetchAst` (ui/.sprig/compiler/hydrate.ts:65) interpolates the selector RAW into the request path (`${base}/_sprig/ast/${sel}`) with no `encodeURIComponent`, while the dev server (ui/.sprig/compiler/dev.ts:103) unconditionally calls `decodeURIComponent` on the extracted path segment. The decode-without-matching-encode is the defect: one side encodes nothing, the other always decodes. This is only latent because the selector is the unsanitized `basename(dir)` of the component folder (build.ts:43, mod.ts:41) with NO kebab/ident validation, so the assumption "selectors are safe URL chars" is never enforced at the source — any filesystem-legal name (containing `%`, `#`, space, etc.) flows straight into the URL.
- **Mechanism:** 1. A component folder is named e.g. `pct%foo`; build.ts:43 / mod.ts:41 set `sel = basename(dir)` with no validation. 2. The generated island chunk calls `fetchAst(base, "pct%foo")`; hydrate.ts:65 builds `GET ${base}/_sprig/ast/pct%foo` with the `%` sent literally (no encodeURIComponent). 3. dev.ts:102 matches the `astPrefix`, then dev.ts:103 runs `decodeURIComponent("pct%foo")`. Because `%f` (`%fo` -> `%fo` is not a valid percent escape) is malformed percent-encoding, decodeURIComponent throws `URIError: URI malformed` (confirmed: `node -e 'decodeURIComponent(\"%\")'`). 4. The throw is uncaught — the handler at dev.ts:84-108 has no try/catch around line 103 — so the fetch handler rejects and the dev server returns a 500 instead of the AST, so the island never hydrates. A `#` in the name truncates the request path on the client (fragment) so the server sees a different/empty selector and returns 404 at dev.ts:106. Even for a benign selector that merely needs escaping, the missing client `encodeURIComponent` vs present server `decodeURIComponent` means the two sides compute different registry keys, so `cfg.renderer.astFor(...)` (dev.ts:103) looks up the wrong key and returns 404.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:65 (raw `sel` interpolated, missing `encodeURIComponent`); the asymmetric counterpart is ui/.sprig/compiler/dev.ts:103 (unconditional `decodeURIComponent` with no try/catch). Underlying enabler: ui/.sprig/compiler/build.ts:43 and ui/.sprig/compiler/mod.ts:41 set `sel = basename(dir)` with no ident validation.`
- **Shared root:** isolated — this is the unique encode/decode asymmetry in the dev AST fetch path. It shares only the broader theme that the selector is an unvalidated `basename(dir)` (build.ts:43/mod.ts:41), which can amplify other selector-as-key bugs, but the specific defect (missing client encodeURIComponent against an unconditional server decodeURIComponent + uncaught URIError) is not shared with another bug.

### RCA #88 — /api prefix strip reaches the /docs Swagger UI, duplicating the docs surface under the API channel
- **Root cause:** The /api dispatch branch performs a blind, purely lexical prefix strip (path.slice(apiPrefix.length)) and forwards the result into config.keep.handler — the SAME handler instance that also serves the /docs Swagger UI. There is no sub-handler partitioning and no post-strip guard that rejects paths resolving into keep's reserved docs prefix. Because the network /api channel and the human /docs channel are multiplexed onto one keep.handler whose internal routing table contains /docs, stripping "/api" off "/api/docs" produces "/docs", which that shared table happily routes to the documentation UI. The design treats /api as a path-translation alias rather than an isolated channel, so any keep route name (here, docs) becomes reachable under /api/<name>.
- **Mechanism:** In serveSprig's fetch dispatcher (mod.ts:81-101): (1) For a request to /api/docs, the api branch at line 90 matches (`path.startsWith(apiPrefix + "/")`). (2) Line 92 strips the /api prefix verbatim — `stripped.pathname = path.slice(apiPrefix.length) || "/"` — turning "/api/docs" into "/docs", "/api/docs/_map" into "/docs/_map", "/api/docs/" into "/docs/". (3) Line 93 forwards that rewritten Request into config.keep.handler, the very same handler used by the /docs branch at line 97. (4) keep's internal routing table still contains its /docs Swagger/OpenAPI router, so the stripped "/docs" resolves there exactly as a direct /docs request would — yielding byte-identical responses (the repro's md5 IDENTICAL check, <title>API Documentation</title>, 200s). The api channel thus has no awareness that "/docs" is a reserved docs-channel route; the strip is a blind string slice with no post-strip exclusion, so it leaks the docs surface. Contrast: /api/ui strips to "/ui", which keep's table has no route for, so it 404s — confirming it is keep's own routing table (not the strip) that does the aliasing.
- **Root locus:** `packages/keep/mod.ts:90-93`
- **Shared root:** prefix-strip dispatch forwards into a shared handler with no post-strip route exclusion (channel-isolation break: two dispatch branches share one underlying keep.handler whose routing table overlaps)

### RCA #89 — Unknown/extra JSON fields are silently accepted (no forbidNonWhitelisted) on issue/user input DTOs
- **Root cause:** The shared keep assert seam validates every request DTO with `validateSync(instance, { whitelist: true })` and omits `forbidNonWhitelisted: true` (and `forbidUnknownValues`). With only `whitelist`, class-validator STRIPS undecorated properties but never rejects them, so any unknown top-level key (including reserved `__proto__`/`constructor`) passes validation and the endpoint returns 200. The DTOs themselves (IssueRefDto/UserRefDto) are not the defect — they correctly declare their single field with @IsString(); the permissive contract is a framework-level validation-option decision, not a per-DTO one. There is no global ValidationPipe with forbid-unknown configured anywhere in the app (grep for forbidNonWhitelisted/ValidationPipe across backend/src returns nothing), so this single seam is the entire input-hardening surface.
- **Mechanism:** 1) The HTTP entrypoint passes the raw parsed JSON body straight to the coordinator: backend/src/board/entrypoints/http/mod.ts:46 `issue(body) { return issueGet(body); }` — keep's @Endpoint does not run a forbid-unknown ValidationPipe before this. 2) The only validation is the assert seam: backend/src/board/domain/coordinators/issue-get/mod.ts:15 `assert(IssueRefDto, input, "issue.get input")`. 3) That call reaches keep's assertInstance, which builds an instance via plainToInstance and then validates with ONE option: keep/src/assert/mod.ts:122 `validateSync(instance, { whitelist: true })`. 4) class-validator semantics: `whitelist: true` STRIPS properties that have no validation decorator from the instance but raises NO error for them; only `forbidNonWhitelisted: true` converts an unknown property into a `whitelistValidation` error. Since IssueRefDto/UserRefDto (issue-ref.ts:12-18, user-ref.ts:12-18) decorate only issueId/userId with @IsString(), the `extra`, `__proto__`, and `constructor` keys are undecorated. They are silently stripped, validateSync returns zero errors (mod.ts:123), assert returns the clean instance, and the request completes 200. 5) Because the extra fields are stripped off the instance, getCore only ever sees input.issueId (issue-get/mod.ts:28), so the extra value is never echoed in the response (curl grep -> 0). 6) No pollution occurs because plainToInstance copies enumerable own keys onto a fresh class instance rather than recursively assigning into a shared prototype, and the stripped `__proto__`/`constructor` keys never reach business logic. The control case (issueId:123 -> 422) works because @IsString() DOES produce an isString error for a wrong-typed declared field, proving the seam validates declared types/required-ness but never unknown-key presence.
- **Root locus:** `/Users/raphaelcastro/Documents/programming/keep/src/assert/mod.ts:122 (validateSync(instance, { whitelist: true }) — missing forbidNonWhitelisted)`
- **Shared root:** keep assert seam validates DTOs with `whitelist: true` only (no forbidNonWhitelisted/forbidUnknownValues), so unknown/reserved input keys are silently stripped rather than rejected — a framework-wide permissive input contract affecting every @Endpoint input DTO (issue, user, and any other request that flows through assert).

### RCA #90 — Lazy-load in-flight set ('loading') is never cleared on successful import — permanent per-selector leak
- **Root cause:** The `loading` Set is used as an "in-flight" guard, but its lifecycle is asymmetric: it is added to in loadIsland (hydrate.ts:127) and removed only on the failure path (hydrate.ts:130, inside the import().catch). There is no success-path counterpart. The success path of an island load is registerIsland (hydrate.ts:71-74) — invoked by the chunk itself when it self-registers — and that function only does registry.set(sel, entry) + hydratePending(sel); it has no reference to, and never touches, the `loading` Set. Because the "import resolved successfully" signal lives in a different function (registerIsland) than the one that owns the `loading` Set (loadIsland), and loadIsland fires the import as a side-effecting `import(...)` whose success it never awaits (it only attaches a .catch), there is no point at which a successful selector is ever drained from `loading`.
- **Mechanism:** First trigger for a selector: loadIsland (hydrate.ts:121) sees registry.has(sel)===false (line 122) and loading.has(sel)===false (line 126), so it runs loading.add(sel) (line 127) and fires import(`.../isl.${sel}.js`) (line 129). On success the chunk executes registerIsland(sel, entry) (line 71), which does registry.set(sel, entry) (line 72) and hydratePending(sel) (line 73) — and returns without ever calling loading.delete(sel). The only loading.delete is at line 130, reachable solely via the import().catch failure path. So after a successful load `sel` remains permanently in `loading`. It accumulates one stale string per distinct island selector for the page lifetime. The leak is inert/non-functional because a subsequent loadIsland(sel) short-circuits at registry.has(sel)===true (line 122) and returns at line 124, never reaching the loading.has(sel) check at line 126 — so the stale entry never blocks re-hydration. Bound: number of distinct island types, not unbounded by instance count.
- **Root locus:** `ui/.sprig/compiler/hydrate.ts:71-74 (registerIsland — the success handler that should, but does not, call loading.delete(sel)); the asymmetry is anchored at the lone loading.delete in hydrate.ts:130`
- **Shared root:** isolated

### RCA #91 — Asset content-type derivation mishandles extensionless filenames
- **Root cause:** The extension is computed as `const ext = file.slice(file.lastIndexOf("."))` (packages/keep/mod.ts:44) without guarding against the `lastIndexOf` "not found" sentinel. `String.prototype.lastIndexOf(".")` returns -1 when the filename contains no dot. `String.prototype.slice(-1)` does NOT mean "from index -1 == nothing"; per spec a negative argument is interpreted relative to the end of the string, so `slice(-1)` returns the LAST character. The author conflated the -1 "absent" sentinel with a usable slice start index — they assumed `slice(lastIndexOf(...))` would yield "" for no-dot names, but it yields the final character instead.
- **Mechanism:** serveAsset (mod.ts:39) reads the file bytes (line 43), then derives `ext` (line 44). For an extensionless asset such as `/ui/_assets/LICENSE`: `"LICENSE".lastIndexOf(".")` = -1, so `"LICENSE".slice(-1)` = "E" (verified by the bug report's deno eval: "robots"->"s", "client"->"t"). This bogus key "E" is then used to look up ASSET_TYPES (mod.ts:47). Because every key in ASSET_TYPES (mod.ts:31-37) begins with a literal ".", a single-character key like "E" can never match, so the `?? "application/octet-stream"` fallback fires. Today that fallback happens to be the correct content-type for an extensionless file, so the output is coincidentally right despite the wrong key. The latent defect: (1) if any single-character extension entry (e.g. a hypothetical key) were added to ASSET_TYPES, an unrelated extensionless filename ending in that char would be mis-keyed and served with the wrong content-type; (2) extensionless static files are served as octet-stream and, since serveAsset sets no `X-Content-Type-Options: nosniff` header (mod.ts:46-49), there is no sniff protection. Correct logic: `const i = file.lastIndexOf("."); const ext = i < 0 ? "" : file.slice(i);` which yields key "" (no match) deterministically.
- **Root locus:** `packages/keep/mod.ts:44`
- **Shared root:** isolated — this is a self-contained slice/lastIndexOf(-1) sentinel-handling defect in serveAsset's content-type derivation; it does not share a root with the SSR/hydration/interpreter/scopeCss bug families.

### RCA #92 — Scope guard sits after the cache-hit early-return in #instantiate, so any token inherited/bound on a parent injector skips the server/client scope check
- **Root cause:** The scope/side guard in Injector.#instantiate is placed on the wrong side of the cache-hit short-circuit. The method does a cache/parent lookup first (#findInstance, line 127) and returns early on a hit (line 128) BEFORE evaluating the scope check (line 129-134). The scope check is therefore a property of "we are about to construct a new instance" rather than a property of "this token is being delivered to this injector's side." Because #findInstance (line 145-149) also walks the parent chain without consulting `side`, any token already bound or cached on an ancestor injector is returned to a descendant of a different side with the guard never running. The guard validates the wrong invariant (freshness) instead of the intended one (the requesting injector's side must be permitted for the token's scope).
- **Mechanism:** In Injector.#instantiate (ui/.sprig/core.ts:126-144) the two operations are ordered cache-lookup-before-guard:

1. Line 127-128: `const existing = this.#findInstance(key); if (existing !== undefined) return existing as T;` — returns immediately on a cache/parent hit.
2. Line 129-134: the scope guard (`if (reg.scope !== "both" && reg.scope !== this.side) throw ...`) only runs AFTER the early return, i.e. only on the cache-MISS (fresh-instantiation) path.

#findInstance (line 145-149) walks the entire parent chain by recursion: it returns a value if ANY ancestor injector has it bound in #instances (e.g. via provide() at line 110-112). It does NOT check `side`/scope while walking.

Causal chain for the repro: a `client`-side root injector has Backend bound via `root.provide(Backend, ...)` (line 111 stores it in that root's #instances). `root.child("component")` (line 122-123) creates a child whose `side` is inherited as "client". `child.resolve(Backend)` → resolve() (line 114-119) picks `target = this.root` because Backend is providedIn:"root" (line 205, 118) → root.#instantiate → #findInstance finds Backend in root.#instances and returns it at line 128, never reaching the scope check at line 129. Result: a scope="server" token (line 204) is handed to a client-side injector with no error, contradicting the docstring invariant "DI never crosses the wire" (line 200-212). The control case (fresh client injector, nothing bound) misses the cache, falls through to line 129, and correctly throws.

Latency: child() (line 122) and clientRoot() (line 153-156) are never invoked anywhere in the live app, so no cross-side parent/child chain exists today — that is why the guard bypass is currently unreachable (info severity), not because the guard is correct.
- **Root locus:** `ui/.sprig/core.ts:127-134 (ordering of #findInstance early-return at 127-128 before the scope guard at 129-134); the scope-blind chain walk lives at ui/.sprig/core.ts:145-149`
- **Shared root:** isolated — guard-ordering defect specific to Injector.#instantiate (scope check runs only on the cache-miss path); not shared with the interpreter/innerHTML/scopeCss bug families

### RCA #93 — serveAsset extension derivation reads across the directory separator: a dotted path segment before an extensionless file yields a bogus multi-segment "extension" (e.g. ".dir/noext"), defeating ASSET_TYPES lookup
- **Root cause:** The content-type derivation at packages/keep/mod.ts:44 computes the file extension with `file.slice(file.lastIndexOf("."))` operating on the WHOLE relative asset path (which still contains '/' separators), instead of extracting the basename (the final segment after the last '/') first. `lastIndexOf(".")` is path-unaware: it has no notion that a '.' belonging to a parent DIRECTORY name is not part of the final file's extension. The defect is a design omission — there is no basename split before the dot scan — so any dot in an ancestor directory name is treated as if it were the file's extension delimiter.
- **Mechanism:** At mod.ts:87 the request handler passes the full relative path `path.slice(assetPrefix.length + 1)` (e.g. "v2.0/client" or "sub.dir/noext") into serveAsset as `file`. At line 43 the bytes are read successfully. At line 44 `file.lastIndexOf(".")` finds the dot inside the DIRECTORY segment ("v2.0/" or "sub.dir/") because the trailing file segment has no dot of its own; `file.slice(...)` therefore returns a string that spans the separator, e.g. ".0/client" or ".dir/noext". At line 47 `ASSET_TYPES[ext]` is keyed by clean extensions like ".js"/".css", so this multi-segment key is undefined and the `?? "application/octet-stream"` fallback fires. For an extensionless file octet-stream is coincidentally the correct answer, so there is no observable wrong header and no security impact (path traversal is separately blocked at line 41 by the ".." check). The logical defect is the bogus intermediate `ext` value, which would also mis-key any legitimately-extensioned-but-dotted-directory case if the file segment itself lacked a dot. Files with a real extension are unaffected because the final dot is then the last dot in the whole string.
- **Root locus:** `packages/keep/mod.ts:44`
- **Shared root:** isolated
