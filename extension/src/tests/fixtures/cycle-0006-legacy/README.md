# Version 1 migration fixture

These are unchanged local demo history bytes produced by the actual VS Code
Cycle 0006 history run `suite-2026-09-18T20-56-32.225Z-b828fe26`.
The strict version 1 schemas and source/image integrity were validated before
copying. They contain the prepared cart fixture, captured demo images and one
explicit test learner decision; no connection settings or credentials.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| study.v1.json | 125349 | 46da21735d8e86a0b6a3cfd05ad9437142360b0530f2996502737621570c7c57 |
| progress.v1.json | 452 | 4cd64d619cb165a2e6d4b68a4f5be32c21ea50cb06df4d89f9633dde3a81038b |

The study is partial, not a successful final-product example. Tests prove
strict decoding, in-memory normalization and retained decision/source/image
identity. Disk migration and concurrent writers need their separate tests.
Do not regenerate these with the version 2 writer: they are compatibility input.
