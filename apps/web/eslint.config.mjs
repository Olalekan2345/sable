import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config.
 *
 * `eslint-config-next` v16 publishes flat config directly, so it is imported rather than
 * bridged through `FlatCompat` — the compat layer cannot serialise it and throws.
 */
export default tseslint.config(
  {
    // Build output, and the vendored Zama Relayer SDK, which is a third-party UMD bundle.
    ignores: [".next/**", "public/relayer-sdk/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Unused bindings are an error, but a leading underscore marks a deliberate discard —
      // destructuring to omit a key, or a parameter an interface requires.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
