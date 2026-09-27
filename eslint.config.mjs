import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // .ux-shots-app: the copy of the app the UI scripts run (scripts/ux-env.mjs).
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", ".ux-shots-app/**"]),
]);
