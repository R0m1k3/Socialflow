import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";

async function run() {
  try {
    const loc = await bundle({ entryPoint: path.resolve("client/src/remotion/index.ts") });
    console.log("Bundle success:", loc);
    const comp = await selectComposition({
      serveUrl: loc,
      id: "ImageVideo",
      inputProps: { images: ["https://placehold.co/1080x1920?text=Image+1"] }
    });
    console.log("Comp:", comp?.id);
    await renderMedia({
      composition: comp,
      serveUrl: loc,
      codec: "h264",
      outputLocation: path.resolve("out.mp4"),
      inputProps: { images: ["https://placehold.co/1080x1920?text=Image+1"] }
    });
    console.log("Render success!");
  } catch(e) {
    console.error("Error rendering", e);
  }
}
run();
