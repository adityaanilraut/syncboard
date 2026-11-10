.PHONY: demo test bench
demo:
	docker compose up --build -d --wait

test:
	npm test
	npm run test:e2e

bench:
	npm run bench
