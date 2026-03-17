import AuthGuard from "@/components/AuthGuard";

function Card({ label, value }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="text-xs text-black/60">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-heading">{value}</div>
    </div>
  );
}

function FilterBar() {
  const items = [
    "Today",
    "Yesterday",
    "This Week",
    "This Month",
    "Last Month",
    "This Year",
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((i) => (
        <button
          key={i}
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-sm hover:bg-heading hover:text-background"
        >
          {i}
        </button>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="date"
          className="rounded-md border border-black/10 px-2 py-1 text-sm"
        />
        <span className="text-sm">to</span>
        <input
          type="date"
          className="rounded-md border border-black/10 px-2 py-1 text-sm"
        />
        <button className="rounded-md bg-heading px-3 py-2 text-sm text-background hover:bg-hover">
          Apply
        </button>
      </div>
    </div>
  );
}

function Chart({ title }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-heading">{title}</div>
      <div className="mt-3 h-48 rounded-md bg-black/5"></div>
    </div>
  );
}

export default function Page() {
  return (
    <AuthGuard allowedRoles={["super_admin"]}>
      <div className="space-y-6">
        <h1 className="text-heading text-2xl font-bold">Dashboard</h1>

        <section className="space-y-3">
          <FilterBar />
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Card label="Total Leads" value="0" />
          <Card label="New Leads" value="0" />
          <Card label="Contacted Leads" value="0" />
          <Card label="Qualified Leads" value="0" />
          <Card label="Lost Leads" value="0" />
          <Card label="Converted Leads" value="0" />
          <Card label="Total Revenue" value="$0" />
          <Card label="Monthly Revenue" value="$0" />
          <Card label="Total Projects" value="0" />
          <Card label="Active Projects" value="0" />
          <Card label="Completed Projects" value="0" />
          <Card label="Total Appointments" value="0" />
          <Card label="Completed Appointments" value="0" />
          <Card label="Site Visits Done" value="0" />
        </section>

        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Chart title="Leads per Month" />
          <Chart title="Revenue per Month" />
          <Chart title="Conversion Rate %" />
          <Chart title="Website wise Leads" />
          <Chart title="Sales Person Performance" />
        </section>
      </div>
    </AuthGuard>
  );
}
