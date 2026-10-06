import { Bot } from "lucide-react";
import { Page } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import AiChat from "@/components/ai-chat";

export default function AI() {
  return (
    <Page width="default">
      <PageHeader
        icon={Bot}
        title="Assistant IA"
        description="Discutez avec l'IA pour trouver des idées et rédiger vos textes."
      />
      <AiChat />
    </Page>
  );
}
