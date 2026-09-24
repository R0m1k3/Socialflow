import { Composition, type CalculateMetadataFunction } from "remotion";
import { DEFAULT_CAPTION_STYLE, REEL_FPS, REEL_HEIGHT, REEL_WIDTH } from "@shared/captions";
import { ImageComposition, type ImageCompositionProps } from "./ImageComposition";
import { ReelVideo, type ReelVideoProps } from "./ReelVideo";

/** La durée vient des propriétés : chaque Reel a la sienne. */
function byTotalDuration<P extends { totalDuration: number }>(): CalculateMetadataFunction<P> {
  return ({ props }) => ({ durationInFrames: Math.max(1, Math.round(props.totalDuration * REEL_FPS)) });
}

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ReelVideo"
        component={ReelVideo}
        fps={REEL_FPS}
        width={REEL_WIDTH}
        height={REEL_HEIGHT}
        durationInFrames={REEL_FPS * 10}
        calculateMetadata={byTotalDuration<ReelVideoProps>()}
        defaultProps={{
          videoUrl: "",
          videoDuration: 10,
          totalDuration: 10,
          words: [],
          captionStyle: DEFAULT_CAPTION_STYLE,
        } as ReelVideoProps}
      />
      <Composition
        id="ImageVideo"
        component={ImageComposition}
        fps={REEL_FPS}
        width={REEL_WIDTH}
        height={REEL_HEIGHT}
        durationInFrames={REEL_FPS * 25}
        calculateMetadata={byTotalDuration<ImageCompositionProps>()}
        defaultProps={{
          images: ["https://placehold.co/1080x1920?text=Image+1"],
          totalDuration: 25,
          words: [],
          captionStyle: DEFAULT_CAPTION_STYLE,
        } as ImageCompositionProps}
      />
    </>
  );
};
