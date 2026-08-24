import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
  },
  resolve: {
    // The API uses ESM-style "./keys.js" specifiers that point at .ts files, which is
    // what Node wants at runtime and what the test runner has to be told about.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1" }],
  },
});
