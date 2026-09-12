/**
 * Hash routes. No router dependency: there are three screens and they are
 * addressed by `#/library`, `#/lecture/<course>/<lectureId>` and
 * `#/review/<course>/<lectureId>`.
 *
 * `course` is `.` when the vault root is itself a course folder, which is the
 * one-level layout the Library also accepts.
 */

export type AppMode = "lecture" | "review" | "library";

export type Route =
  | { kind: "library" }
  | { kind: "lecture"; course: string; lectureId: string }
  | { kind: "review"; course: string; lectureId: string };

export const ROOT_COURSE = ".";

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const parts = path.split("/").filter((p) => p.length > 0).map(decodeURIComponent);
  const [head, course, lectureId] = parts;
  if ((head === "lecture" || head === "review") && course && lectureId) {
    return { kind: head, course, lectureId };
  }
  return { kind: "library" };
}

export function formatRoute(route: Route): string {
  if (route.kind === "library") return "#/library";
  return `#/${route.kind}/${encodeURIComponent(route.course)}/${encodeURIComponent(route.lectureId)}`;
}

/** The folder path of a lecture relative to the vault root. */
export function folderPath(course: string, lectureId: string): string {
  return course === ROOT_COURSE ? lectureId : `${course}/${lectureId}`;
}

export function routeMode(route: Route): AppMode {
  return route.kind;
}

export function navigate(route: Route): void {
  location.hash = formatRoute(route);
}
