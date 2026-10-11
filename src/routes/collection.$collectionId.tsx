import { createFileRoute } from "@tanstack/react-router";
import { CollectionScreen } from "../library/CollectionScreen";

function CollectionPage() {
  const { collectionId } = Route.useParams();
  return <CollectionScreen collectionId={collectionId} />;
}

export const Route = createFileRoute("/collection/$collectionId")({
  component: CollectionPage,
});
