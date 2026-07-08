# Repository Guidelines

## Project Structure & Module Organization

This package wraps `libimagequant` for browser use through Rust-generated WebAssembly and a TypeScript API. Core Rust bindings live in `src/lib.rs`. The public API is in `src/index.ts`, and the worker runtime is in `src/worker.ts`. Browser and package examples are in `examples/`. Automated tests are in `tests/` and import built files from `dist/`, so build before running the suite. Generated outputs such as `dist/`, `pkg/`, and `target/` should not be edited by hand.

## Build, Test, and Development Commands

Use `pnpm` for JavaScript dependencies; the repository includes `pnpm-lock.yaml`.

- `pnpm install` installs Node dependencies.
- `pnpm run build` cleans, builds WASM, bundles ESM/CJS output, and emits declarations.
- `pnpm run build:wasm` builds only the WebAssembly package with `wasm-pack`.
- `pnpm run typecheck` runs TypeScript checks without writing files.
- `pnpm test` runs Vitest browser tests in headless Chromium.
- `pnpm run dev` starts the Vite development server; `pnpm run serve` uses port `8080`.
- `./build.sh` is an alternate standalone build script with optimization and validation.

Rust contributors need the `wasm32-unknown-unknown` target and `wasm-pack`; `wasm-opt` is optional but useful for release-size checks.

## Coding Style & Naming Conventions

Use TypeScript ES modules, exported interfaces, and descriptive option/result names such as `QuantizationOptions` and `QuantizationResult`. Follow the existing two-space indentation and semicolon-heavy style in `src/index.ts` and tests. Keep browser-worker communication typed and dispose workers in tests and examples. For Rust, use edition 2021 conventions and run `cargo fmt` before submitting changes.

## Testing Guidelines

Tests use Vitest with `@vitest/browser-playwright` and Chromium. Name test files `*.test.ts` under `tests/`. Because tests load `../dist/index.mjs`, run `pnpm run build` before `pnpm test` after source changes. Add coverage for both high-level API behavior and low-level WASM changes when touching quantization, PNG encoding, memory handling, or worker initialization.

## Commit & Pull Request Guidelines

Recent history uses short, imperative commits, often Conventional Commit prefixes such as `feat:`, `fix:`, and `chore:`; release bumps may be plain version messages. Keep each commit focused. Pull requests should describe the behavior change, list validation commands run, note browser/WASM impacts, and include screenshots or example output for visible changes to `examples/` or the demo page.

## Security & Configuration Tips

Do not commit generated secrets, local paths, or large binary test assets. Keep dependency, Rust, and WASM toolchain changes explicit in the PR description because they can affect package output size and browser compatibility.
