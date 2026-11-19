# RFCs

A change to the language follows the process in [../README.md](../README.md) §6:

1. Open a proposal here, named `NNNN-short-title.md`, with the status line
   `draft`, `accepted` or `rejected`.
2. Name the documents it changes (`01-lexical`, `13-ui`, `18-grammar`, …) and the
   principle from §2 it serves.
3. Say what breaks: any program valid under the current edition that the change
   would reject must be listed, and the change becomes part of a new edition.
4. A change lands in `spec/` first, in the same pull request as the RFC that
   accepted it. The compiler follows; it never leads.

There are no RFCs yet. The specification was written as one document set, so
nothing in it has been amended. The first thing that will need one is the
`const` generics syntax in [`02-types.md`](../02-types.md) and
[`06-generics.md`](../06-modules.md), which is deliberately marked `spec` rather
than `planned` for exactly that reason.
