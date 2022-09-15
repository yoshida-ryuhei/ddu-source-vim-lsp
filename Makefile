lint: lint/vim lint/deno

lint/vim:
	vint --version
	vint autoload

lint/deno:
	deno --version
	deno fmt --check denops
	deno lint --unstable denops

format:
	deno --version
	deno fmt denops REAME.md
