TS_TARGETS := $(shell find . -name \*.ts )

lint: lint/vim lint/deno

lint/vim:
	vint --version
	vint autoload

lint/deno:
	deno --version
	deno fmt --check denops
	deno fmt --check README.md
	deno lint --unstable denops
	deno check ${TS_TARGETS}

test: test/deno

test/deno:
	deno test --allow-run ${TS_TARGETS} --coverage=cov_profile

coverage: coverage/deno

coverage/deno: test/deno
	deno coverage --include=denops/ cov_profile --lcov --output=cov_profile.lcov
	genhtml -o cov_profile/html cov_profile.lcov

format:
	deno --version
	deno fmt denops REAME.md

update: update/deno

update/deno:
	deno run -A https://deno.land/x/udd/main.ts ${TS_TARGETS}
