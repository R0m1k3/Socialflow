
import { emojiRenderer } from "./services/emojiRenderer";
import { createCanvas } from "canvas";
import fs from "fs";
import path from "path";

async function run() {
    const width = 500;
    const height = 200;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "black";
    ctx.font = "30px Arial";

    const text = "Hello 🌍 World! 😂";
    console.log(`Rendering text: ${text}`);

    try {
        await emojiRenderer.drawText(text, ctx, 50, 100, 30);
        const buffer = canvas.toBuffer("image/png");
        fs.writeFileSync("emoji_test.png", buffer);
        console.log("Image saved to emoji_test.png");
    } catch (error) {
        console.error("Error rendering emoji:", error);
    }
}

run();
