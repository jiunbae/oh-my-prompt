import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / vendored CLI bundle output.
    "packages/omp-cli/lib/**",
    // Generated worker bundle.
    "dist/**",
  ]),
  // The CLI (src/omp), build/maintenance scripts, and the published CLI package
  // are plain CommonJS Node code that legitimately uses `require`. Treat them as
  // CommonJS so the TS-oriented rules don't flag idiomatic Node patterns.
  // NOTE: this override does NOT touch the TypeScript app code.
  {
    files: [
      "src/omp/**/*.js",
      "scripts/**/*.js",
      "scripts/**/*.mjs",
      "packages/omp-cli/**/*.js",
    ],
    languageOptions: {
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-this-alias": "off",
    },
  },
  // Maintenance TS scripts run under ts-node/tsx and legitimately use require().
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
  // The React Compiler ESLint plugin (react-hooks/*) ships several rules that
  // flag idiomatic, working patterns (mounted-guards via setState-in-effect,
  // callback-ref assignment, cloneElement) as optimization hints. Keep the
  // correctness-critical rules (`purity` catches impure render like Math.random,
  // `exhaustive-deps` catches stale closures) as errors, and downgrade the
  // optimization-hint rules to warnings so CI gates real bugs, not style noise.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
