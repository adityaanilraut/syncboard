# Results

The two-server Docker Compose run sustained **60 WebSocket clients** in one room for two minutes. The servers acknowledged all **7,200 edits**. All clients finished with identical boards, with zero errors and zero disconnects. Delivery to the designated client on the opposite server was **18.1 ms p95**.

- [Final load run](load.json)
- [Earlier pull-based delivery run](load-before-pubsub.json)
- [Initial run with the original load generator](load-initial.json)

Run `make demo`, `npm ci`, and `make bench` to measure 60 clients split evenly across two servers in one room. Each client sends one edit per second for 120 seconds. The runner tracks delivery of each edit to a designated client connected to the other server, acknowledgements, and final document equality across all clients.

Run `make test` for Jest and Chromium end-to-end tests. The browser tests cover two-server edits, concurrent edits, reconnect, room isolation, drawing tools, cursor visibility, and persisted state.

## Test coverage

**100 tests passed** across 87 Jest cases and 13 Chromium scenarios. Combined application line coverage was **88.9%** across the frontend and WebSocket server. The combined report merges Jest coverage, source-mapped browser instrumentation, and Node V8 server coverage.

To reproduce, run `npm run coverage` with Redis available at `localhost:6379`, or set `REDIS_URL`. The script starts temporary servers on ports 3100 and 3101 and writes the report to `coverage/combined.json`.

- [Per-file coverage and test counts](coverage.json)
