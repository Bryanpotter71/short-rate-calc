import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(() => ({
  base: process.env.GITHUB_ACTIONS ? "/short-rate-calc/" : "/",
  plugins: [react()],
  test: {
    globals: true,
    environment: "node"
  }
}));
