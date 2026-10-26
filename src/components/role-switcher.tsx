import { showsRoleSwitcher, type ViewerShape } from "@/lib/viewer-path";

export function RoleSwitcher({ viewer, current }: { viewer: ViewerShape; current: "dashboard" | "portal" }) {
  if (!showsRoleSwitcher(viewer)) return null;
  const workLabel = workLinkLabel(viewer);
  return <nav className="role-switcher" data-feature="role-switcher" aria-label="Workspace">
    <a href="/dashboard" aria-current={current === "dashboard" ? "page" : undefined}>Owner workspace</a>
    <a href="/portal" aria-current={current === "portal" ? "page" : undefined}>{workLabel}</a>
  </nav>;
}

function workLinkLabel(viewer: ViewerShape): string {
  const link = viewer.contractorOf[0];
  if (viewer.contractorOf.length === 1 && link) return `My work at ${link.businessName}`;
  return "My work";
}
