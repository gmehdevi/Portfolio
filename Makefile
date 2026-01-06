SHELL := /bin/bash
.DEFAULT_GOAL := dev

.PHONY: dev prod down shell cmake-build clean fclean

# Dev server (Vite) via docker compose
dev:
	@$(MAKE) cmake-build
	@docker compose -f compose.yml up dev

# Prod server (node build) via docker compose
prod:
	@$(MAKE) cmake-build
	@docker compose -f compose.yml up prod

# Drop containers/volumes
down:
	@docker compose -f compose.yml down

# Shell into dev container (useful for npm/cmake inside container only)
shell:
	@docker compose -f compose.yml run --rm dev bash

# C++ cmake build inside container (emscripten toolchain)
cmake-build:
	@docker compose -f compose.yml run --rm cpp

# Clean generated artifacts while keeping the project runnable
clean: down
	@docker compose -f compose.yml down -v
	@docker volume rm -f node_modules sveltekit buildcache cppbuild 2>/dev/null || true
	@docker run --rm -v $$PWD:/workspace busybox sh -c "rm -rf /workspace/build /workspace/.svelte-kit /workspace/node_modules"
	@rm -rf build .svelte-kit node_modules

# Full clean: remove all containers and call clean
fclean: clean
	@docker rm -f $$(docker ps -aq) 2>/dev/null || true
	@docker rmi $$(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^portfolio' || true) 2>/dev/null || true
