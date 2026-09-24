#!/usr/bin/env node
// Pré-bundle des compositions Remotion pendant le build Docker : le cache
// Webpack est chaud, le premier rendu d'un utilisateur démarre plus vite.
// Même configuration que server/services/reels/remotionRenderer.ts.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

bundle({
  entryPoint: path.join(root, "client/src/remotion/index.ts"),
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: { ...(config.resolve?.alias ?? {}), "@shared": path.join(root, "shared") },
    },
  }),
})
  .then((location) => console.log("✅ Remotion pre-bundle OK:", location))
  .catch((error) => {
    console.warn("⚠️ Remotion pre-bundle skipped:", error.message);
    process.exit(0);
  });
