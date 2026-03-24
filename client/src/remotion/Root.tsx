import { Composition } from "remotion";
import { ImageComposition, ImageCompositionProps } from "./ImageComposition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ImageVideo"
        component={ImageComposition}
        durationInFrames={360}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          images: [
            "https://placehold.co/1080x1920?text=Image+1",
            "https://placehold.co/1080x1920?text=Image+2",
            "https://placehold.co/1080x1920?text=Image+3"
          ],
        } as ImageCompositionProps}
      />
    </>
  );
};
