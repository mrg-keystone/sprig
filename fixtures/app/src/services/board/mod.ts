import { Injectable, inject } from "@sprig/core";
import { Logger } from "../logger/mod.ts";

// ─────────────────────────────── Domain model ───────────────────────────────
export type Status = "backlog" | "todo" | "in-progress" | "review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";

export interface Tag {
  label: string;
  /** a hue name the tag-chip maps to a colour (drives [style.--chip] / [class]). */
  tone: "slate" | "blue" | "green" | "amber" | "red" | "violet";
}

export interface Issue {
  id: string; // "SPR-101"
  title: string;
  /** trusted, server-authored rich text — rendered via [innerHTML] (sanitised). */
  descriptionHtml: string;
  status: Status;
  priority: Priority;
  /** user ids (see UserService) of the people assigned. */
  assignees: string[];
  tags: Tag[];
  points: number;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  commentCount: number;
}

export interface Comment {
  id: string;
  author: string; // user id
  bodyHtml: string;
  at: string; // ISO 8601
}

export interface Column {
  id: Status;
  label: string;
  /** work-in-progress limit; the column flags when exceeded. */
  wip: number;
}

export interface Activity {
  id: string;
  kind: "comment" | "status" | "assign" | "create";
  actor: string; // user id
  issueId: string;
  at: string; // ISO 8601
  detail: string;
}

export interface Project {
  id: string;
  key: string; // "SPR"
  name: string;
  velocity: number; // points / sprint
}

export interface BoardStats {
  total: number;
  done: number;
  /** 0..1 completion ratio (drives a percent pipe). */
  completion: number;
  /** points delivered this sprint vs the project velocity target. */
  velocity: number;
  /** budget burndown in the project's currency (drives a currency pipe). */
  budget: number;
  /** per-day completed-point counts, for the trend sparkline. */
  trend: number[];
}

// ─────────────────────────────── The service ────────────────────────────────
/**
 * scope "server": the data source for the board. Resolved during SSR (page resolve.ts /
 * the in-process keep backend) and serialized to islands as @inputs — never injected across
 * the wire. A service may itself inject() others (here Logger), resolved from the same injector.
 */
@Injectable({ scope: "server", providedIn: "root" })
export class BoardService {
  #log = inject(Logger);

  #project: Project = { id: "p1", key: "SPR", name: "sprig", velocity: 34 };

  #columns: Column[] = [
    { id: "backlog", label: "Backlog", wip: 0 },
    { id: "todo", label: "To do", wip: 8 },
    { id: "in-progress", label: "In progress", wip: 3 },
    { id: "review", label: "In review", wip: 4 },
    { id: "done", label: "Done", wip: 0 },
  ];

  #issues: Issue[] = [
    {
      id: "SPR-101",
      title: "Compile template.html to a Preact render fn",
      descriptionHtml: "<p>Walk the <strong>tree-sitter</strong> AST and emit a render function. Handles <code>@if</code>/<code>@for</code> and the binding forms.</p>",
      status: "in-progress",
      priority: "urgent",
      assignees: ["ada", "alan"],
      tags: [{ label: "compiler", tone: "violet" }, { label: "core", tone: "blue" }],
      points: 8,
      createdAt: "2026-06-02T09:00:00Z",
      updatedAt: "2026-06-18T14:12:00Z",
      commentCount: 4,
    },
    {
      id: "SPR-102",
      title: "Island prop bridge: serialize resolve() output",
      descriptionHtml: "<p>Emit a JSON <code>&lt;script&gt;</code> per island so server data reaches it as <em>data, not DI</em>.</p>",
      status: "review",
      priority: "high",
      assignees: ["grace"],
      tags: [{ label: "ssr", tone: "green" }, { label: "core", tone: "blue" }],
      points: 5,
      createdAt: "2026-06-04T11:30:00Z",
      updatedAt: "2026-06-19T08:45:00Z",
      commentCount: 2,
    },
    {
      id: "SPR-103",
      title: "Navigation API soft-nav swaps only the outlet",
      descriptionHtml: "<p>Intercept same-origin links, fetch, and replace the <code>&lt;router-outlet&gt;</code> inside a view transition.</p>",
      status: "todo",
      priority: "high",
      assignees: ["grace", "ada"],
      tags: [{ label: "router", tone: "amber" }],
      points: 5,
      createdAt: "2026-06-06T15:00:00Z",
      updatedAt: "2026-06-17T10:00:00Z",
      commentCount: 1,
    },
    {
      id: "SPR-104",
      title: "Named-outlet URL scheme (= segments)",
      descriptionHtml: "<p>Parse and serialize <code>name=value</code> path segments; canonical sort.</p>",
      status: "done",
      priority: "medium",
      assignees: ["alan"],
      tags: [{ label: "router", tone: "amber" }, { label: "done", tone: "green" }],
      points: 3,
      createdAt: "2026-05-28T09:00:00Z",
      updatedAt: "2026-06-12T16:20:00Z",
      commentCount: 6,
    },
    {
      id: "SPR-105",
      title: "Scoped styles via a CSS-modules esbuild plugin",
      descriptionHtml: "<p>Hash class names at build so folder styles stop leaking.</p>",
      status: "backlog",
      priority: "low",
      assignees: [],
      tags: [{ label: "build", tone: "slate" }],
      points: 2,
      createdAt: "2026-06-10T12:00:00Z",
      updatedAt: "2026-06-10T12:00:00Z",
      commentCount: 0,
    },
    {
      id: "SPR-106",
      title: "Dev live-reload over SSE",
      descriptionHtml: "<p>Tiny SSE snippet to reload on rebuild — not HMR, just a refresh.</p>",
      status: "todo",
      priority: "medium",
      assignees: ["grace"],
      tags: [{ label: "dx", tone: "blue" }],
      points: 3,
      createdAt: "2026-06-11T13:30:00Z",
      updatedAt: "2026-06-16T09:10:00Z",
      commentCount: 0,
    },
  ];

  #comments: Record<string, Comment[]> = {
    "SPR-101": [
      { id: "c1", author: "alan", bodyHtml: "<p>Hoisted the binding compiler — review the <code>@for</code> track path.</p>", at: "2026-06-17T10:00:00Z" },
      { id: "c2", author: "ada", bodyHtml: "<p>Nice. Watch the safe-nav case in member chains.</p>", at: "2026-06-18T08:30:00Z" },
    ],
    "SPR-104": [
      { id: "c3", author: "alan", bodyHtml: "<p>Canonical sort makes back/forward stable. 👍</p>", at: "2026-06-12T16:00:00Z" },
    ],
  };

  #activity: Activity[] = [
    { id: "a1", kind: "status", actor: "ada", issueId: "SPR-101", at: "2026-06-19T14:12:00Z", detail: "moved to In progress" },
    { id: "a2", kind: "comment", actor: "ada", issueId: "SPR-101", at: "2026-06-18T08:30:00Z", detail: "commented" },
    { id: "a3", kind: "assign", actor: "grace", issueId: "SPR-102", at: "2026-06-19T08:45:00Z", detail: "self-assigned" },
    { id: "a4", kind: "create", actor: "grace", issueId: "SPR-106", at: "2026-06-11T13:30:00Z", detail: "created the issue" },
    { id: "a5", kind: "status", actor: "alan", issueId: "SPR-104", at: "2026-06-12T16:20:00Z", detail: "moved to Done" },
  ];

  project(): Project {
    return this.#project;
  }
  columns(): Column[] {
    return this.#columns;
  }
  issues(): Issue[] {
    return this.#issues;
  }
  issuesByStatus(status: Status): Issue[] {
    return this.#issues.filter((i) => i.status === status);
  }
  issueById(id: string): Issue | undefined {
    this.#log.debug("BoardService.issueById", id);
    return this.#issues.find((i) => i.id === id);
  }
  commentsFor(id: string): Comment[] {
    return this.#comments[id] ?? [];
  }
  activity(): Activity[] {
    return this.#activity;
  }

  stats(): BoardStats {
    const total = this.#issues.length;
    const done = this.#issues.filter((i) => i.status === "done").length;
    return {
      total,
      done,
      completion: total === 0 ? 0 : done / total,
      velocity: this.#project.velocity,
      budget: 48250,
      trend: [3, 5, 4, 8, 6, 9, 11],
    };
  }
}
