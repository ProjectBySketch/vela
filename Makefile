VELA_VERSION := $(shell cat VERSION 2>/dev/null || echo 0.1.0)
CC ?= cc
CFLAGS ?= -std=c11 -O2 -Wall -Wextra
PREFIX ?= /usr/local

RUNTIME = runtime/vela_runtime.h runtime/vela_runtime.c runtime/vela_main.c

all: build/velac build/runtime

build/velac: src/velac.c
	@mkdir -p build
	$(CC) $(CFLAGS) -DVELA_VERSION='"$(VELA_VERSION)"' -o $@ src/velac.c

.PHONY: build/runtime
build/runtime:
	@mkdir -p build/runtime
	@cp $(RUNTIME) build/runtime/

test: all
	@bash tests/run.sh

clean:
	rm -rf build dist

install: all
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 build/velac $(DESTDIR)$(PREFIX)/bin/velac
	install -d $(DESTDIR)$(PREFIX)/lib/vela/runtime
	install -m 644 $(RUNTIME) $(DESTDIR)$(PREFIX)/lib/vela/runtime/

.PHONY: all test clean install
