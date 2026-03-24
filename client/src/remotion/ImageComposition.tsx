import { AbsoluteFill, Img, Sequence, useVideoConfig } from "remotion";

export type ImageCompositionProps = {
  images: string[];
};

export const ImageComposition = ({ images }: ImageCompositionProps) => {
  const { fps } = useVideoConfig();
  const durationPerImage = 3 * fps;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {images.map((imgUrl, index) => (
        <Sequence
          key={index}
          from={index * durationPerImage}
          durationInFrames={durationPerImage}
        >
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <Img src={imgUrl} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
