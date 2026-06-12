# WebSockets

> Source: https://fresh.deno.dev/docs/advanced/websockets

## TL;DR
Two routes: `app.ws(path, handlers)` for the quick path; `ctx.upgrade(...)` inside a GET handler for file-based routes. Two modes — managed (handlers object) and bare (raw socket).

## `app.ws()` — quickest
```ts
const app = new App()
  .ws("/ws", {
    open(socket) { console.log("connected"); },
    message(socket, event) { socket.send(`Echo: ${event.data}`); },
    close(socket, code, reason) { /* … */ },
    error(socket, event) { /* … */ },
  });
```
Registers a GET route that auto-upgrades.

## File-route managed mode
```ts
// routes/ws.ts
export const handlers = define.handlers({
  GET(ctx) {
    return ctx.upgrade({
      open(socket) { /* … */ },
      message(socket, ev) { /* … */ },
      close(socket, code, reason) { /* … */ },
      error(socket, ev) { /* … */ },
    });
  },
});
```

## Bare mode (raw socket)
```ts
GET(ctx) {
  const { socket, response } = ctx.upgrade();
  socket.onopen = () => { /* … */ };
  socket.onmessage = (e) => { /* … */ };
  return response;
}
```

## Options
- `idleTimeout` — seconds, default 120
- `protocol` — sub-protocol negotiation

Mode is detected by whether the first arg has any of `open`/`message`/`close`/`error` keys.

## Gotchas
- Some hosts (e.g. some Cloudflare Workers tiers) restrict long-lived sockets — check deployment limits.

## See also
- `concepts/context.md` — `ctx` shape
- `deployment/cloudflare-workers.md`
