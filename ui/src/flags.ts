// Switches for the pretend helper in a plain browser, read from the
// address bar, e.g. `?mock=paused,nopin`. See mock.ts for the list.

export function mockFlags(): Set<string> {
  if (typeof location === "undefined") return new Set();
  const params = new URLSearchParams(location.search);
  return new Set(params.getAll("mock").flatMap((v) => v.split(",")).filter(Boolean));
}
