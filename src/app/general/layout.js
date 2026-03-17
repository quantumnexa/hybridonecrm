import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

export default function GeneralLayout({ children }) {
  return (
    <AuthGuard allowedRoles={["general_user"]}>
      <div className="h-screen overflow-hidden bg-background flex">
        <Sidebar
          title="General"
          items={[
            { href: "/general", label: "Tasks", icon: "tasks" },
            { href: "/general/notes", label: "My Notes", icon: "profile" },
          ]}
        />
        <main className="flex-1 h-full overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </AuthGuard>
  );
}
