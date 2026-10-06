import { Images } from "lucide-react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import MediaUpload from "@/components/media-upload";

export default function Media() {
  return (
    <Page width="wide">
      <PageHeader
        icon={Images}
        title="Médiathèque"
        description="Toutes vos images et vidéos, prêtes à être publiées."
      />
      <MediaUpload />
    </Page>
  );
}
