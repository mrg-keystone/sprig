/**
 * Custom tree-sitter grammar for Angular component templates.
 *
 * Covers everything in ../angular-html-features.md / ../fixtures/golden.html:
 *   - HTML elements (paired + self-closing), attributes, comments, text
 *   - Interpolation {{ expr }}
 *   - Bindings: [property], [attr.x], [class.x], [style.x.unit], (event), [(two-way)],
 *     animation [@trigger] / (@trigger.done)
 *   - Template reference variables (#ref, #ref="exportAs") and let- inputs
 *   - Built-in control flow: @if/@else if/@else, @for/@empty, @switch/@case/@default,
 *     @defer (+ triggers, prefetch, @placeholder/@loading/@error), @let
 *   - Legacy structural directives: *ngIf / *ngFor / *ngSwitch* (template microsyntax)
 *   - An Angular expression sublanguage: pipes, ternary, ??, ?., !, $any, member/call,
 *     unary/binary ops, string/number/boolean/array/object literals, arrow functions
 *
 * No external scanner: the fixture closes every element explicitly or self-closes, and
 * literal `<`, `{`, `}`, `@` never appear in text — so text can be tokenized purely.
 */

const PREC = {
  PIPE: 1,
  ASSIGN: 2,
  TERNARY: 3,
  NULLISH: 4,
  OR: 5,
  AND: 6,
  EQ: 7,
  REL: 8,
  ADD: 9,
  MUL: 10,
  UNARY: 11,
  POSTFIX: 12,
};

function sep1(sep, rule) {
  return seq(rule, repeat(seq(sep, rule)));
}
function commaSep1(rule) {
  return sep1(",", rule);
}
function commaSep(rule) {
  return optional(commaSep1(rule));
}

module.exports = grammar({
  name: "angular_template",

  word: ($) => $.identifier,

  // Order MUST match enum TokenType in src/scanner.c.
  externals: ($) => [
    $._start_tag_name,
    $._script_start_tag_name,
    $._style_start_tag_name,
    $._end_tag_name,
    $.erroneous_end_tag_name,
    "/>",
    $._implicit_end_tag,
    $.raw_text,
    $.comment,
  ],

  extras: ($) => [/\s+/, $.comment],

  conflicts: ($) => [
    [$._expression, $.arrow_parameters],
  ],

  rules: {
    // ---- document --------------------------------------------------------
    template: ($) => repeat($._node),

    _node: ($) =>
      choice(
        $.element,
        $.script_element,
        $.style_element,
        $.self_closing_element,
        $.erroneous_end_tag,
        $.text,
        $.interpolation,
        $.if_block,
        $.for_block,
        $.switch_block,
        $.defer_block,
        $.let_declaration,
      ),

    // ---- elements (tag names + raw-text + implicit close driven by scanner) ----
    // An element closes either with an explicit </tag> or an implicit end tag the
    // external scanner emits for void elements (<br>) and HTML auto-close rules
    // (<li>, <p>, <tr>, <td>, <dt>, <option>, ...).
    element: ($) =>
      seq(
        $.start_tag,
        repeat($._node),
        choice($.end_tag, $._implicit_end_tag),
      ),

    // raw-text elements: the scanner consumes their body verbatim up to </script>/</style>
    script_element: ($) =>
      seq(alias($.script_start_tag, $.start_tag), optional($.raw_text), $.end_tag),
    style_element: ($) =>
      seq(alias($.style_start_tag, $.start_tag), optional($.raw_text), $.end_tag),

    start_tag: ($) =>
      seq("<", field("name", alias($._start_tag_name, $.tag_name)), repeat($._attribute), ">"),
    script_start_tag: ($) =>
      seq("<", field("name", alias($._script_start_tag_name, $.tag_name)), repeat($._attribute), ">"),
    style_start_tag: ($) =>
      seq("<", field("name", alias($._style_start_tag_name, $.tag_name)), repeat($._attribute), ">"),

    self_closing_element: ($) =>
      seq("<", field("name", alias($._start_tag_name, $.tag_name)), repeat($._attribute), "/>"),

    end_tag: ($) => seq("</", field("name", alias($._end_tag_name, $.tag_name)), ">"),
    erroneous_end_tag: ($) =>
      seq("</", field("name", $.erroneous_end_tag_name), ">"),

    // ---- attributes ------------------------------------------------------
    _attribute: ($) =>
      choice(
        $.attribute,
        $.property_binding,
        $.event_binding,
        $.two_way_binding,
        $.structural_directive,
        $.reference,
        $.template_input,
      ),

    // plain HTML attribute (value may contain interpolation)
    attribute: ($) =>
      seq(
        field("name", $.attribute_name),
        optional(seq("=", field("value", $.quoted_value))),
      ),

    attribute_name: ($) => token(/[a-zA-Z_][a-zA-Z0-9_:\-]*/),

    quoted_value: ($) =>
      choice(
        seq(
          '"',
          repeat(choice($.interpolation, alias($._attr_text_dq, $.attribute_text))),
          '"',
        ),
        seq(
          "'",
          repeat(choice($.interpolation, alias($._attr_text_sq, $.attribute_text))),
          "'",
        ),
      ),
    _attr_text_dq: ($) => token.immediate(/[^"{}]+/),
    _attr_text_sq: ($) => token.immediate(/[^'{}]+/),

    // [prop]="expr"  /  [attr.x]="expr"  /  [class.x]="expr"  /  [@anim]="expr"
    property_binding: ($) =>
      seq(
        "[",
        field("name", $.binding_name),
        "]",
        "=",
        '"',
        field("value", $._expression),
        '"',
      ),

    // (event)="stmt"  /  (@anim.done)="stmt"
    event_binding: ($) =>
      seq(
        "(",
        field("name", $.binding_name),
        ")",
        "=",
        '"',
        field("handler", $._event_body),
        '"',
      ),

    // [(banana)]="expr"
    two_way_binding: ($) =>
      seq(
        "[(",
        field("name", $.binding_name),
        ")]",
        "=",
        '"',
        field("value", $._expression),
        '"',
      ),

    // dotted / animation binding target, e.g. style.font-size.rem, @fadeInOut.done.
    // Segments may begin with '-' (CSS custom props: style.--my-var), contain ':'
    // (namespaced attrs: attr.xlink:href) and end in the '%' unit (style.width.%).
    binding_name: ($) =>
      token(/@?[a-zA-Z_][a-zA-Z0-9_\-:]*(\.[a-zA-Z_\-][a-zA-Z0-9_\-:]*)*(\.%)?/),

    // *ngIf / *ngFor / *ngSwitchCase ... value is the template microsyntax
    structural_directive: ($) =>
      seq(
        "*",
        field("name", $.directive_name),
        optional(seq("=", '"', field("value", $.microsyntax), '"')),
      ),
    directive_name: ($) => token(/[a-zA-Z_][a-zA-Z0-9_]*/),

    // #ref  /  #ref="exportAs"
    reference: ($) =>
      seq(
        "#",
        field("name", $.identifier),
        optional(seq("=", '"', field("export", $.identifier), '"')),
      ),

    // let-name  /  let-name="contextKey"
    template_input: ($) =>
      seq(
        field("name", alias($._let_input, $.input_name)),
        optional(seq("=", field("source", $.quoted_value))),
      ),
    _let_input: ($) => token(prec(1, /let-[a-zA-Z_][a-zA-Z0-9_\-]*/)),

    // ---- interpolation ---------------------------------------------------
    interpolation: ($) => seq("{{", field("expression", $._expression), "}}"),

    // ---- @let ------------------------------------------------------------
    let_declaration: ($) =>
      seq(
        "@let",
        field("name", $.identifier),
        "=",
        field("value", $._expression),
        ";",
      ),

    // ---- @if / @else if / @else -----------------------------------------
    if_block: ($) =>
      seq(
        "@if",
        "(",
        field("condition", $._expression),
        optional(seq(";", "as", field("alias", $.identifier))),
        ")",
        field("consequence", $.block),
        repeat(field("alternative", $.else_if_clause)),
        optional(field("alternative", $.else_clause)),
      ),
    else_if_clause: ($) =>
      seq(
        "@else",
        "if",
        "(",
        field("condition", $._expression),
        optional(seq(";", "as", field("alias", $.identifier))),
        ")",
        $.block,
      ),
    else_clause: ($) => seq("@else", $.block),

    // ---- @for / @empty ---------------------------------------------------
    for_block: ($) =>
      seq(
        "@for",
        "(",
        field("binding", $.for_binding),
        ")",
        $.block,
        optional(field("empty", $.empty_clause)),
      ),
    for_binding: ($) =>
      seq(
        field("item", $.identifier),
        "of",
        field("collection", $._expression),
        ";",
        "track",
        field("track", $._expression),
        repeat(seq(";", $.for_alias_group)),
      ),
    for_alias_group: ($) => seq("let", commaSep1($.for_alias)),
    for_alias: ($) =>
      seq(field("name", $.identifier), "=", field("value", $.identifier)),
    empty_clause: ($) => seq("@empty", $.block),

    // ---- @switch / @case / @default -------------------------------------
    switch_block: ($) =>
      seq(
        "@switch",
        "(",
        field("value", $._expression),
        ")",
        "{",
        repeat(choice($.case_clause, $.default_clause)),
        "}",
      ),
    case_clause: ($) =>
      seq("@case", "(", field("value", $._expression), ")", $.block),
    default_clause: ($) => seq("@default", $.block),

    // ---- @defer ----------------------------------------------------------
    defer_block: ($) =>
      seq(
        "@defer",
        optional(seq("(", field("triggers", $.defer_triggers), ")")),
        $.block,
        repeat(
          choice(
            field("placeholder", $.placeholder_clause),
            field("loading", $.loading_clause),
            field("error", $.error_clause),
          ),
        ),
      ),
    defer_triggers: ($) => sep1(";", $.defer_trigger),
    defer_trigger: ($) =>
      seq(
        optional("prefetch"),
        choice(
          seq("on", $.defer_on),
          seq("when", field("condition", $._expression)),
        ),
      ),
    defer_on: ($) =>
      choice(
        "idle",
        "immediate",
        seq("hover", optional($.trigger_ref)),
        seq("interaction", optional($.trigger_ref)),
        seq("viewport", optional($.trigger_ref)),
        seq("timer", "(", field("duration", $.duration), ")"),
      ),
    trigger_ref: ($) => seq("(", field("ref", $.identifier), ")"),
    placeholder_clause: ($) =>
      seq("@placeholder", optional(seq("(", $.block_parameters, ")")), $.block),
    loading_clause: ($) =>
      seq("@loading", optional(seq("(", $.block_parameters, ")")), $.block),
    error_clause: ($) => seq("@error", $.block),
    block_parameters: ($) => sep1(";", $.block_parameter),
    block_parameter: ($) =>
      seq(choice("minimum", "after"), field("duration", $.duration)),
    duration: ($) => token(/[0-9]+(ms|s)/),

    // a `{ ... }` block body of template nodes
    block: ($) => seq("{", repeat($._node), "}"),

    // ---- template microsyntax (legacy structural directives) -------------
    microsyntax: ($) =>
      seq($._micro_segment, repeat(seq(optional(";"), $._micro_segment))),
    _micro_segment: ($) =>
      choice(
        $.micro_let,
        $.micro_of,
        $.micro_as,
        $.micro_then,
        $.micro_else,
        $.micro_keyed,
        $.micro_expression,
      ),
    micro_let: ($) =>
      seq(
        "let",
        field("name", $.identifier),
        optional(seq("=", field("value", $.identifier))),
      ),
    micro_of: ($) => seq(choice("of", "in"), field("value", $._expression)),
    micro_as: ($) => seq("as", field("name", $.identifier)),
    micro_then: ($) => seq("then", field("template", $.identifier)),
    micro_else: ($) => seq("else", field("template", $.identifier)),
    micro_keyed: ($) =>
      seq(field("key", $.identifier), ":", field("value", $._expression)),
    micro_expression: ($) => $._expression,

    // ---- event handler body (statements) --------------------------------
    _event_body: ($) => sep1(";", choice($.assignment, $._expression)),
    assignment: ($) =>
      prec.right(
        PREC.ASSIGN,
        seq(field("left", $._expression), "=", field("right", $._expression)),
      ),

    // ---- expression sublanguage -----------------------------------------
    _expression: ($) =>
      choice(
        $.identifier,
        $.string,
        $.number,
        $.boolean,
        $.array,
        $.object,
        $.parenthesized,
        $.arrow_function,
        $.member_expression,
        $.safe_member_expression,
        $.subscript_expression,
        $.call_expression,
        $.non_null_expression,
        $.unary_expression,
        $.binary_expression,
        $.ternary_expression,
        $.pipe_expression,
      ),

    parenthesized: ($) => seq("(", $._expression, ")"),

    arrow_function: ($) =>
      seq(field("parameters", $.arrow_parameters), "=>", field("body", $._expression)),
    arrow_parameters: ($) =>
      choice($.identifier, seq("(", commaSep($.identifier), ")")),

    member_expression: ($) =>
      prec.left(
        PREC.POSTFIX,
        seq(field("object", $._expression), ".", field("property", $.identifier)),
      ),
    safe_member_expression: ($) =>
      prec.left(
        PREC.POSTFIX,
        seq(field("object", $._expression), "?.", field("property", $.identifier)),
      ),
    // keyed / bracket access: items[0], obj['key']
    subscript_expression: ($) =>
      prec.left(
        PREC.POSTFIX,
        seq(field("object", $._expression), "[", field("index", $._expression), "]"),
      ),
    call_expression: ($) =>
      prec.left(
        PREC.POSTFIX,
        seq(field("function", $._expression), field("arguments", $.arguments)),
      ),
    arguments: ($) => seq("(", commaSep($._expression), ")"),
    non_null_expression: ($) =>
      prec.left(PREC.POSTFIX, seq($._expression, "!")),

    unary_expression: ($) =>
      prec.right(
        PREC.UNARY,
        seq(field("operator", choice("!", "-", "+")), field("operand", $._expression)),
      ),

    binary_expression: ($) => {
      const table = [
        ["??", PREC.NULLISH],
        ["||", PREC.OR],
        ["&&", PREC.AND],
        ["==", PREC.EQ],
        ["!=", PREC.EQ],
        ["===", PREC.EQ],
        ["!==", PREC.EQ],
        ["<", PREC.REL],
        [">", PREC.REL],
        ["<=", PREC.REL],
        [">=", PREC.REL],
        ["+", PREC.ADD],
        ["-", PREC.ADD],
        ["*", PREC.MUL],
        ["/", PREC.MUL],
        ["%", PREC.MUL],
      ];
      return choice(
        ...table.map(([op, p]) =>
          prec.left(
            p,
            seq(
              field("left", $._expression),
              field("operator", op),
              field("right", $._expression),
            ),
          ),
        ),
      );
    },

    ternary_expression: ($) =>
      prec.right(
        PREC.TERNARY,
        seq(
          field("condition", $._expression),
          "?",
          field("consequence", $._expression),
          ":",
          field("alternative", $._expression),
        ),
      ),

    pipe_expression: ($) =>
      prec.left(
        PREC.PIPE,
        seq(
          field("expression", $._expression),
          "|",
          field("name", $.identifier),
          repeat(field("argument", $.pipe_argument)),
        ),
      ),
    pipe_argument: ($) => seq(":", $._expression),

    array: ($) => seq("[", commaSep($._expression), optional(","), "]"),
    object: ($) => seq("{", commaSep($.pair), optional(","), "}"),
    pair: ($) =>
      seq(
        field("key", choice($.identifier, $.string, $.number)),
        ":",
        field("value", $._expression),
      ),

    // ---- atoms -----------------------------------------------------------
    identifier: ($) => token(/[A-Za-z_$][A-Za-z0-9_$]*/),
    // string literals are single-quoted: inside "-delimited attribute values a
    // double-quoted literal is ambiguous with the closing delimiter, so Angular's
    // idiom (and this grammar) use '...' in expressions. (Known limitation: a
    // double-quoted literal in {{ }} / @block headers is unsupported.)
    string: ($) => token(/'([^'\\]|\\.)*'/),
    // decimal, scientific (1e3, 1.5e-2) and leading-dot (.5) numbers
    number: ($) => token(/(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/),
    boolean: ($) => choice("true", "false"),

    // significant text: starts & ends non-whitespace, never spans < { } @
    text: ($) => token(/[^<>{}@\s]([^<>{}@]*[^<>{}@\s])?/),
  },
});
