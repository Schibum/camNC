# Guidelines for Codex Agents

This repository is a pnpm/Turborepo workspace using TypeScript and React.

## Workflow

- Use **pnpm** (Node >=18) for all package management tasks.
- After making changes, run `pnpm run build`, `pnpm run lint` and `pnpm run test` from the repo root.
  - These commands execute turborepo tasks across all packages.
- Format TypeScript and Markdown files with Prettier using `pnpm run format`.
- Keep generated files such as `routeTree.gen.ts` read-only; avoid editing them manually.

## Commit Messages

- Follow the Conventional Commits style (`feat:`, `fix:`, `chore:`, `docs:` etc.).
- Write concise summaries in the imperative mood (e.g. "fix: update worker config").

## Code Style

- All source code is written in modern ES modules and TypeScript.
- Use the existing ESLint configuration by running `pnpm run lint`.
- Do not commit build artifacts or `node_modules` directories.
