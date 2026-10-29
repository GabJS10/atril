import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { FolderNotice, ImportNotice } from "../library/Notices";
import { Sidebar } from "../library/Sidebar";
import { UpdateNotice } from "../library/UpdateNotice";

/** The library shell: the sidebar and, beside it, the screen. The reader lives outside it, full window. */
function Shell() {
  const matchRoute = useMatchRoute();
  // Settings already shows the update result in its own card: the notice would repeat it there.
  const onSettings = matchRoute({ to: "/settings" }) !== false;
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <ImportNotice className="mx-14 mt-9" />
        <FolderNotice className="mx-14 mt-4" />
        {onSettings ? null : <UpdateNotice className="mx-14 mt-4" />}
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_shell")({
  component: Shell,
});
