// Quick, eased scroll to a section of the welcome page. Faster than the browser's own
// `behavior: 'smooth'` (which can crawl on long pages) and the same speed everywhere.

/** Sections of the welcome page the header links can jump to. */
export const WELCOME_SECTIONS = [
  { id: 'about', label: 'About Us' },
  { id: 'contact', label: 'Contact Us' },
] as const;

export type WelcomeSectionId = (typeof WELCOME_SECTIONS)[number]['id'];

const DURATION_MS = 550;
let frame = 0;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Scroll the window so `id`'s section sits at the top. Returns false if there's no such section. */
export function scrollToSection(id: string): boolean {
  const target = id ? document.getElementById(id) : null;
  if (id && !target) return false;
  const top = target ? target.getBoundingClientRect().top + window.scrollY : 0;
  const start = window.scrollY;
  const distance = top - start;
  cancelAnimationFrame(frame);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(distance) < 2) {
    window.scrollTo(0, top);
  } else {
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / DURATION_MS);
      window.scrollTo(0, start + distance * easeInOutCubic(t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  // Move keyboard / screen-reader focus to the section too, without a second jump.
  if (target) {
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  return true;
}
