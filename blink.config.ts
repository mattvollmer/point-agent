import { defineConfig, buildWithEsbuild } from "blink/build";

export default defineConfig({
  entry: "agent.ts",
  outdir: ".blink/build",
  build: buildWithEsbuild({
    platform: "node",
  }),
});
