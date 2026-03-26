import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

export default function AdminLayout({ children }) {
  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="h-screen overflow-hidden bg-background flex">
        <Sidebar
          title="Super Admin"
          items={[
            { href: "/admin/dashboard", label: "Dashboard", icon: "dashboard" },
            { href: "/admin/leads", label: "Leads", icon: "leads" },
            { href: "/admin/appointments", label: "Appointments", icon: "appointments" },
            { href: "/admin/projects", label: "Projects", icon: "projects" },
            { href: "/admin/tasks", label: "Tasks", icon: "tasks" },
            { href: "/admin/notifications", label: "Notifications", icon: "notifications" },
            { href: "/admin/quotation", label: "Quotation", icon: "quotation" },
            { href: "/admin/users", label: "User management", icon: "users" },
            { href: "/admin/attendance", label: "Attendance", icon: "reports" },
            { href: "/admin/shifts", label: "Shifts", icon: "settings" },
            { href: "/admin/reports", label: "Reports & Analytics", icon: "reports" },
            { href: "/admin/daily-reports", label: "Daily Reports", icon: "tasks" },
          ]}
        />
        <main className="flex-1 h-full overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </AuthGuard>
  );
}
