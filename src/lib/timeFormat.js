export function formatMinutesAsHHMM(value) {
  const mins = Math.max(0, Math.floor(Number(value || 0)));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatTimeHM12(input) {
  if (!input || typeof input !== "string") return "";
  const parts = input.split(":");
  const hh = Number(parts[0] || 0);
  const mm = String(parts[1] || "00").padStart(2, "0");
  const h12 = ((hh + 11) % 12) + 1;
  const ampm = hh >= 12 ? "PM" : "AM";
  return `${h12}:${mm} ${ampm}`;
}

export function formatLocalTime12(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return x.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatLocalDateTime12(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const datePart = formatDateCustom(x);
  const timePart = x.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${datePart} ${timePart}`;
}

export function formatSecondsAsHHMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatDateCustom(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const day = String(x.getDate()).padStart(2, "0");
  const month = x.toLocaleString("en-US", { month: "long" });
  const year = x.getFullYear();
  return `${day} ${month} ${year}`;
}

