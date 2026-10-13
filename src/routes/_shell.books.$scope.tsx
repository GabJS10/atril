import { createFileRoute, notFound } from "@tanstack/react-router";
import { BooksScreen } from "../library/BooksScreen";
import { isBooksScope } from "../library/booksScope";

function BooksPage() {
  const { scope } = Route.useParams();
  // The key resets the filters when the sidebar moves between "Todos", "Favoritos" and "En curso".
  return isBooksScope(scope) ? <BooksScreen key={scope} scope={scope} /> : null;
}

export const Route = createFileRoute("/_shell/books/$scope")({
  beforeLoad: ({ params }) => {
    if (!isBooksScope(params.scope)) throw notFound();
  },
  component: BooksPage,
});
