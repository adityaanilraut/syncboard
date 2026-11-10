# SyncBoard

A real-time whiteboard with shareable room links, freehand drawing, rectangles, ellipses, and live cursors. Open the same room on two servers and watch edits appear on both.

## Quick start

```sh
make demo
```

Open [server A](http://localhost:3000), create a room, and copy its link. Open the same path on [server B](http://localhost:3001) to try cross-server editing. A board stays in Redis when clients leave. Edits made offline queue while the tab stays open.

```sh
npm ci
npx playwright install chromium
make test
make bench
```

[Results and methodology](results/README.md)

## How it works

```text
Browser A ─ WebSocket ─ Server A ─┐
                                  ├─ Redis Streams + pub/sub
Browser B ─ WebSocket ─ Server B ─┘
```

Both clients maintain a Yjs document. The server acknowledges an edit after Redis accepts it, and publishes a notification so peers can read the new stream entries. Each server also checks for missed notifications. On join or reconnect, the server sends its reconstructed state. Yjs makes replays idempotent. Cursor movement is ephemeral.

Room URLs grant access to anyone who has the link. The demo limits update size, per-connection message rate, and retained updates per room. Redis uses AOF in the Compose demo. The application uses a single Redis primary for persistence, so availability and durability depend on that Redis deployment.

Stop the demo with `docker compose down`. Add `-v` to also remove local room data.

## AWS deployment

Terraform describes two ECS Fargate tasks, an HTTPS Application Load Balancer, a TLS-enabled ElastiCache replication group, an ECR repository, and scoped GitHub OIDC permissions. The repository is deployment-ready. See [AWS setup](terraform/README.md).
