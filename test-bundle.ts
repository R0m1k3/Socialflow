import { bundle } from "@remotion/bundler";
import path from "path";

async function run() {
  try {
    const loc = await bundle({ entryPoint: path.resolve("client/src/remotion/index.ts") });
    console.log("Success:", loc);
  } catch(e) {
    console.error("Error bundling", e);
  }
}
run();
