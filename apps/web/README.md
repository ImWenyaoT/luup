# Luup frontend

The frontend is a Vite, React, and TypeScript application styled with Tailwind CSS v4 and shadcn/ui (Base UI). Tailwind was removed once before, when it styled five small components while 900 lines of hand-written CSS covered everything else. It is back on the opposite terms: layout and appearance live in utility classes on the components, and `src/index.css` is down to 144 lines that declare theme tokens and nothing else. One system, not two.

- The product UI has one path: turn a research question into a verified research
  plan.
- `src/types.ts` defines the narrow HTTP wire types consumed by this UI.
- `src/api.ts` preserves Luup's SSE and public-projection boundaries without a
  generated SDK.
- Playwright tests exercise the real HTTP/SSE and browser boundary without Docker.

## Development

Run commands from the repository root:

```bash
pnpm run dev
pnpm --filter @luup/frontend test
pnpm run test:e2e
```

Read [`CONTEXT.md`](../../CONTEXT.md) before changing frontend behavior.
