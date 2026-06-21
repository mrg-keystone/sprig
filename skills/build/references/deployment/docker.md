# Docker

> Source: https://fresh.deno.dev/docs/deployment/docker

## TL;DR
Use `denoland/deno:latest`. Set `DENO_DEPLOYMENT_ID` (changes per build to invalidate caches). Build with `deno task build`. Serve via `deno serve -A _fresh/server.js`.

## Recommended Dockerfile
```dockerfile
FROM denoland/deno:latest

ARG GIT_REVISION
ENV DENO_DEPLOYMENT_ID=${GIT_REVISION}

WORKDIR /app

COPY . .
RUN deno install --allow-scripts
RUN deno task build

EXPOSE 8000

CMD ["deno", "serve", "-A", "_fresh/server.js"]
```

## Run
```bash
docker build --build-arg GIT_REVISION=$(git rev-parse HEAD) -t my-app .
docker run -p 80:8000 my-app
```

## Why `DENO_DEPLOYMENT_ID`
Opaque string identifying the build. Fresh uses it for asset cache busting. Must change whenever any file changes — using the git SHA is a clean choice.

## Notes
- Single-stage build — no multi-stage in the docs.
- `deno install --allow-scripts` is needed **before** `deno task build` to install npm scripts.
- Default port 8000.

## See also
- `advanced/environment-variables.md`
- `advanced/troubleshooting.md`
