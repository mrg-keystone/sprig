; Syntax highlighting for the custom Angular-template grammar.
; Generic captures come first; more specific contextual captures come later so they win.

; ---- literals & comments ----
(comment) @comment
(string) @string
(number) @number
(boolean) @constant.builtin
(duration) @constant.numeric
(attribute_text) @string
(text) @none
(raw_text) @none

; ---- identifiers (generic) ----
(identifier) @variable

; ---- HTML structure ----
(tag_name) @tag
(erroneous_end_tag_name) @tag.error
(attribute_name) @attribute
(directive_name) @keyword.directive
(input_name) @variable.parameter

; ---- bindings ----
(property_binding name: (binding_name) @property)
(two_way_binding name: (binding_name) @property)
(event_binding name: (binding_name) @function.method)
(reference name: (identifier) @label)
(reference export: (identifier) @type)

; ---- expression roles (override the generic identifier capture) ----
(call_expression function: (identifier) @function.call)
(member_expression property: (identifier) @property)
(safe_member_expression property: (identifier) @property)
(pipe_expression name: (identifier) @function)
(pair key: (identifier) @property)
(micro_keyed key: (identifier) @property)

; special $-prefixed template variables ($event, $index, $implicit, ...)
((identifier) @variable.builtin
  (#match? @variable.builtin "^\\$"))

; ---- control-flow block keywords ----
[
  "@if" "@else" "@for" "@empty" "@switch" "@case" "@default"
  "@defer" "@placeholder" "@loading" "@error" "@let"
] @keyword.control

; contextual keywords inside block / microsyntax headers
[
  "if" "as" "of" "in" "let" "then" "else" "track"
  "on" "when" "prefetch" "minimum" "after"
] @keyword

; @defer trigger names
[
  "idle" "immediate" "viewport" "hover" "interaction" "timer"
] @constant.builtin

; ---- operators & punctuation ----
[
  "+" "-" "*" "/" "%"
  "==" "!=" "===" "!==" "<" ">" "<=" ">="
  "&&" "||" "??" "!" "?." "=>" "|" "="
] @operator

["?" ":"] @operator

[ "{{" "}}" ] @punctuation.special
[ "(" ")" "[" "]" "{" "}" "[(" ")]" ] @punctuation.bracket
[ "<" ">" "</" "/>" ] @punctuation.bracket
[ "." "," ";" "#" "*" ] @punctuation.delimiter
