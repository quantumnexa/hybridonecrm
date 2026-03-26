"use client";

import AuthGuard from "@/components/AuthGuard";
import MyShifts from "@/components/MyShifts";
import ClockWidget from "@/components/ClockWidget";

export default function GeneralMyShiftsPage() {
  return (
    <AuthGuard allowedRoles={["general_user"]}>
      <div className="space-y-6">
        <ClockWidget />
        <MyShifts />
      </div>
    </AuthGuard>
  );
}
