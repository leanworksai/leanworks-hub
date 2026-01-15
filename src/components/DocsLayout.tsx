import { Outlet } from "react-router-dom";
import { DocsSidebar } from "./DocsSidebar";

export function DocsLayout() {
  return (
    <div className="flex h-[calc(100vh-5rem)] -m-4 sm:-m-6 overflow-hidden">
      {/* Desktop sidebar - hidden on mobile */}
      <DocsSidebar />
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 bg-background relative">
        <div className="p-2 sm:p-6 min-h-full">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
