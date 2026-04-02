import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve("app"),
  publicDir: resolve("public"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve("docs"),
    emptyOutDir: false,
  },
  test: {
    include: ["../tests/**/*.test.{js,jsx}"],
    environment: "jsdom",
    setupFiles: resolve("tests/setup.js"),
  },
});
