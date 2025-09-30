import { defineConfig, buildWithEsbuild } from "blink/build";

export default defineConfig({
  entry: "agent.ts",
  outdir: ".blink/build",
  build: buildWithEsbuild({
    // Mark @blink.so/api and its dependencies as external
    // so they're not bundled and can use native Node.js imports
    external: ["@blink.so/api"],
    // Ensure we use Node.js platform and conditions
    platform: "node",
    conditions: ["node", "import"],
  }),
});
