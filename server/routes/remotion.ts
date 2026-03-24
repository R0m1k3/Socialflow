import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

export const remotionRouter = Router();

const uploadDir = path.join(process.cwd(), "uploads", "temp");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `remotion-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage });

remotionRouter.post("/render", upload.array("images", 4), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Aucune image fournie" });
    }

    const host = req.protocol + "://" + req.get("host");
    const imageUrls = files.map(file => {
      return `${host}/uploads/temp/${path.basename(file.path)}`;
    });

    console.log("Bundling Remotion project...");
    const bundleLocation = await bundle({
      entryPoint: path.resolve(process.cwd(), "client/src/remotion/index.ts"),
    });

    console.log("Selecting composition...");
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "ImageVideo",
      inputProps: {
        images: imageUrls,
      },
    });

    const outputFilename = `out-${Date.now()}.mp4`;
    const outputLocation = path.join(uploadDir, outputFilename);

    console.log("Rendering media to", outputLocation);
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation,
      inputProps: {
        images: imageUrls,
      },
      chromiumOptions: {
        disableWebSecurity: true
      }
    });

    console.log("Render completed:", outputFilename);
    res.json({ url: `${host}/uploads/temp/${outputFilename}` });

  } catch (err: any) {
    console.error("Remotion render error:", err);
    res.status(500).json({ error: "Erreur lors du rendu de la vidéo: " + err.message });
  }
});
