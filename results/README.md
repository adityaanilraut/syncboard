# Results

Run `make demo`, `npm ci`, and `make bench` to measure 60 clients split evenly across two servers in one room. Each client sends one edit per second for 120 seconds. The runner tracks delivery of each edit to a designated client connected to the other server, acknowledgements, and final document equality across all clients.

Run `make test` for Jest and Chromium end-to-end tests. The browser tests cover two-server edits, concurrent edits, reconnect, room isolation, drawing tools, cursor visibility, and persisted state.
