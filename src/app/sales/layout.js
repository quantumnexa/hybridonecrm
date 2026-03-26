import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

export default function SalesLayout({ children }) {
  return (
    <AuthGuard allowedRoles={["sales"]}>
      <div className="h-screen overflow-hidden bg-background flex">
        <Sidebar
          title="Sales Portal"
          items={[
            { href: "/sales/dashboard", label: "Dashboard", icon: "dashboard" },
            { href: "/sales/tasks", label: "Tasks", icon: "tasks" },
            { href: "/sales/notifications", label: "Notifications", icon: "notifications" },
            { href: "/sales/notes", label: "My Notes", icon: "profile" },
            { href: "/sales/shifts", label: "My Shifts", icon: "appointments" },
            { href: "/sales/leads", label: "Leads", icon: "leads" },
            { href: "/sales/appointments", label: "Appointment", icon: "appointments" },
            { href: "/sales/projects", label: "Projects", icon: "projects" },
            { href: "/sales/quotation", label: "Quotation", icon: "quotation" },
            { href: "/sales/profile", label: "Profile", icon: "profile" },
          ]}
        />
        <main className="flex-1 h-full overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </AuthGuard>
  );
}
