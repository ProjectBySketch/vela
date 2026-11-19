# Spec examples

These programs illustrate the specification. **They are not built by CI and not
accepted by `velac` 0.1** — they use structs, traits, generics, styles, views,
`Result`, `async` and `unsafe`, none of which the current compiler implements.

Each file header says which tier it needs:

| File | Profile | Tier | Shows |
| --- | --- | --- | --- |
| `tour.vela` | `core` | A | the whole core language in one readable program |
| `app/notes.vela` | `app` | B | views, state, styles, navigation, persistence |
| `web/site.vela` | `web` | C | pages, routes, styling, SSR handlers, an island |
| `os/kernel.vela` | `sys` | D | boot, UART driver, interrupts, page allocator, scheduler |
| `os/fs.vela` | `sys` | D | a `FileSystem` trait, a block driver, a syscall with `UserPtr` |
| `ai/train.vela` | `core` | A | tensors, autodiff, training, inference, serving |

They are here so that a reader can check the prose against real code, and so that
the first implementation of the compiler has targets to aim at. When `velac`
grows a feature, the corresponding example moves into `spec/conformance/` as a
test.

Run nothing here. Read it.
