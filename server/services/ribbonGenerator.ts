import { createCanvas } from "canvas";
import cloudinary from "cloudinary";

export class RibbonGenerator {
  private static instance: RibbonGenerator;

  static getInstance(): RibbonGenerator {
    if (!RibbonGenerator.instance) {
      RibbonGenerator.instance = new RibbonGenerator();
    }
    return RibbonGenerator.instance;
  }

  // Generate a triangular corner ribbon
  async generateTriangularRibbon(
    text: string,
    color: "red" | "yellow",
    position: "north_west" | "north_east"
  ): Promise<string> {
    const width = 200;
    const height = 200;
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    
    // Clear canvas with transparency
    ctx.clearRect(0, 0, width, height);
    
    // Set ribbon color
    const ribbonColor = color === "red" ? "#FF0000" : "#FFC107";
    ctx.fillStyle = ribbonColor;
    
    // Draw triangle based on position
    ctx.beginPath();
    if (position === "north_west") {
      // Triangle in top-left corner
      ctx.moveTo(0, 0);
      ctx.lineTo(150, 0);
      ctx.lineTo(0, 150);
    } else {
      // Triangle in top-right corner
      ctx.moveTo(width, 0);
      ctx.lineTo(width - 150, 0);
      ctx.lineTo(width, 150);
    }
    ctx.closePath();
    ctx.fill();
    
    // Add text on the diagonal
    ctx.save();
    ctx.fillStyle = "white";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    
    if (position === "north_west") {
      // Rotate for northwest corner
      ctx.translate(50, 50);
      ctx.rotate(-Math.PI / 4);
    } else {
      // Rotate for northeast corner
      ctx.translate(width - 50, 50);
      ctx.rotate(Math.PI / 4);
    }
    
    ctx.fillText(text, 0, 0);
    ctx.restore();
    
    // Convert to base64
    const buffer = canvas.toBuffer("image/png");
    const base64 = `data:image/png;base64,${buffer.toString("base64")}`;
    
    // Upload to Cloudinary
    try {
      const result = await cloudinary.v2.uploader.upload(base64, {
        folder: "ribbon-overlays",
        public_id: `ribbon_${text}_${color}_${position}_${Date.now()}`,
        resource_type: "image"
      });
      
      return result.public_id;
    } catch (error) {
      console.error("Error uploading ribbon to Cloudinary:", error);
      throw error;
    }
  }
}