import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests.
 *
 * `e2e/` is excluded explicitly. Playwright specs are not vitest specs — they call
 * `test.describe` from a different runner, and without this exclusion vitest collects them
 * and fails the whole run before reaching a single real test.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
