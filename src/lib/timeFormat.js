export function formatMinutesAsHHMM(value) {
  const mins = Math.max(0, Math.floor(Number(value || 0)));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

