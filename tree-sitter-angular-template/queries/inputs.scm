; Capture identifiers for implied-input inference (see scripts/implied-inputs.ts).
; implied inputs = @ref  −  @notinput  −  @bound  −  globals($-prefixed / literals)

; every identifier referenced anywhere in the template's expressions
(identifier) @ref

; identifiers that are NOT data inputs -------------------------------------------------
(member_expression property: (identifier) @notinput)        ; the `.b` in a.b
(safe_member_expression property: (identifier) @notinput)   ; the `?.b` in a?.b
(pipe_expression name: (identifier) @notinput)              ; a pipe's name
(call_expression function: (identifier) @notinput)          ; a called function (→ needs logic.ts)
(pair key: (identifier) @notinput)                          ; an object-literal key

; identifiers bound locally by the template (not inputs) ------------------------------
(for_binding item: (identifier) @bound)                     ; @for (item of …)
(for_alias name: (identifier) @bound)                       ; let i = $index
(let_declaration name: (identifier) @bound)                 ; @let x = …
(reference name: (identifier) @bound)                       ; #ref
(micro_let name: (identifier) @bound)                       ; *ngFor="let item …"
(arrow_parameters (identifier) @bound)                      ; (a, b) => …
(if_block alias: (identifier) @bound)                       ; @if (x; as u)
(else_if_clause alias: (identifier) @bound)                 ; @else if (x; as u)

; interactivity → the component needs a logic.ts (it cannot be purely static) -----------
(event_binding) @interactive                                ; (click)="…"
(two_way_binding) @interactive                              ; [(x)]="…"
(call_expression) @interactive                              ; f() — a method call needs scope
