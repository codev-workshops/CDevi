// Minimal stand-in for `next/navigation` in component tests (jsdom, no App Router context).
export const __nav = { pathname: '/inbox', pushed: [] as string[] };
export const usePathname = () => __nav.pathname;
export const useRouter = () => ({
  push: (href: string) => {
    __nav.pushed.push(href);
  },
  replace: (href: string) => {
    __nav.pushed.push(href);
  },
  refresh: () => {},
});
export const redirect = (href: string): never => {
  throw new Error(`redirect:${href}`);
};
