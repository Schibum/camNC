# Guidelines for Codex Agents

This repository is a pnpm/Turborepo workspace using TypeScript and React.

## Workflow

- Use **pnpm** (Node >=18) for all package management tasks.
- After making changes, run `pnpm run format`, `pnpm run build`, `pnpm run lint` and `pnpm run test` from the repo root.
  - These commands execute turborepo tasks across all packages.
- Format TypeScript and Markdown files with Prettier using `pnpm run format`.
- Keep generated files such as `routeTree.gen.ts` read-only; avoid editing them manually.

## Dev Environment Tips

- Use `pnpm dlx turbo run where <project_name>` to locate a package quickly.
- Run `pnpm install --filter <project_name>` when adding a package so local tools see it.
- Use `pnpm create vite@latest <project_name> -- --template react-ts` to start a new React + Vite package.
- Confirm each package's `package.json` has the correct `name` field (ignore the top-level one).

## Testing Instructions

- The CI workflow lives in `.github/workflows`.
- Run `pnpm turbo run test --filter <project_name>` to execute checks for a single package.
- From within a package you can run `pnpm test`.
- Focus on one test with `pnpm vitest run -t "<test name>"`.
- Fix failing tests or type errors until the suite passes.
- After moving files or changing imports, run `pnpm lint --filter <project_name>`.
- Always add or update tests for the code you change.

## Commit Messages

- Follow the Conventional Commits style (`feat:`, `fix:`, `chore:`, `docs:` etc.).
- Write concise summaries in the imperative mood (e.g. "fix: update worker config").

## Pull Requests

- Title format: `[<project_name>] <Title>`

## Code Style

- All source code is written in modern ES modules and TypeScript.
- Use the existing ESLint configuration by running `pnpm run lint`.
- Do not commit build artifacts or `node_modules` directories.
