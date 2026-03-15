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
	@docker compose -f compose.yml down --remove-orphans

# Shell into dev container (useful for npm/cmake inside container only)
shell:
	@docker compose -f compose.yml run --rm dev bash

# C++ cmake build inside container (emscripten toolchain)
cmake-build:
	@docker compose -f compose.yml run --rm cpp

# Clean generated artifacts while keeping the project runnable
clean: down
	@docker compose -f compose.yml down -v --remove-orphans
	@rm -rf build .svelte-kit node_modules

# Full clean: remove all containers and call clean
fclean: clean
	@docker compose -f compose.yml down -v --remove-orphans --rmi local
