/**
 * Wraps an App Router navigation in the native CSS View Transitions API
 * (document.startViewTransition) so /dash-off and /zettelkasten can share a
 * stable view-transition-name on their respective timeline/③ containers and
 * get a morph animation between them for free. Feature-detected: falls back
 * to a plain router.push on browsers without support.
 *
 * Two RAF delays after router.push give the new route's RSC output a chance
 * to actually paint before the transition's "after" snapshot is taken —
 * without them the snapshot can be captured mid-navigation.
 */
export function navigateWithViewTransition(router: { push: (href: string) => void }, href: string): void {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void | Promise<void>) => void;
  };

  if (typeof doc.startViewTransition !== "function") {
    router.push(href);
    return;
  }

  doc.startViewTransition(() => {
    router.push(href);
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}
