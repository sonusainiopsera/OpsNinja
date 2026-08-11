.PHONY: build lint test test-cov dev typecheck generate-openapi

build:
	pnpm -r build

lint:
	pnpm eslint . --ext .ts,.tsx

test:
	pnpm -r test

test-cov:
	pnpm -r test:cov

typecheck:
	pnpm -r typecheck

dev:
	pnpm --filter @opsninja/api dev

generate-openapi:
	pnpm --filter @opsninja/api generate-openapi

check-openapi:
	pnpm --filter @opsninja/api check-openapi
