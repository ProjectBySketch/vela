# Vela-native developer tools

These utilities are written in Vela. They are ordinary `core` programs, not
compiler code and not operating-system source.

## Programs

### `elf-inspect.vela`

Reads an ELF file and reports its class, byte order, identification version,
file type, and machine field.

```sh
vela run tools/elf-inspect.vela -- build/kernel.elf
```

### `target-info.vela`

Reports the active platform, architecture, and Vela profile.

```sh
vela run tools/target-info.vela
```

## Language requirements

The programs use Vela syntax and standard-library APIs documented in:

- `spec/05-functions.md` — function declarations and return values
- `spec/08-modules.md` — module imports
- `spec/16-stdlib.md` — `env`, `fs`, `Bytes`, and formatting
- `spec/18-grammar.md` — normative source grammar

These programs target the documented `core` profile, not the subset `velac`
implements, so CI does not build them. The TypeScript toolchain in
[`../studio/`](../studio) can run, check, lint, format and compile Vela
programs:

```sh
cd studio
npm run vela -- run ../tools/target-info.vela
npm run vela -- emit-kernel ../spec/examples/kernel.vela ../build/kernel.c
```

## The `vela` CLI

`studio/tools/vela.ts` is the command line front end for that toolchain:
`run`, `check`, `lint`, `fmt`, `repl`, `test`, `new`, `zip`, `build-web`,
`export-obj`, and the two C backends — `emit-c` for the portable `core` profile
and `emit-kernel` for the freestanding `sys` profile.
