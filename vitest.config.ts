import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "extensions/**/src/**/*.test.{js,ts}"],
    environment: "node",
  },
});
