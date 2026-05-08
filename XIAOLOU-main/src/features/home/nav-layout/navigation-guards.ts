type NavigationGuard = () => Promise<void> | void;

const guards = new Set<NavigationGuard>();

export function registerNavigationGuard(guard: NavigationGuard) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export async function runNavigationGuards() {
  for (const guard of Array.from(guards)) {
    await guard();
  }
}
