import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["app/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["app/**/*.{ts,tsx}"],
      exclude: [
        "app/**/*.test.{ts,tsx}",
        "app/test-utils.tsx",
        "app/styles.ts",
        "app/layout.tsx",
        "app/page.tsx",
        "app/error.tsx",
        "app/global-error.tsx",
        "app/not-found.tsx",
        "app/Icons.tsx",
      ],
    },
  },
});
