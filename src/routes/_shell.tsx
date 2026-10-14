import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ImportNotice } from "../library/Notices";
import { Sidebar } from "../library/Sidebar";

/** The library shell: the sidebar and, beside it, the screen. The reader lives outside it, full window. */
function Shell() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <ImportNotice className="mx-14 mt-9" />
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_shell")({
  component: Shell,
});
