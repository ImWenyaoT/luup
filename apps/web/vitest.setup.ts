import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

const NAVIGATION_EVENT = "luup:test-navigation";

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    useSearchParams() {
      const [search, setSearch] = React.useState(() => window.location.search);
      React.useEffect(() => {
        const update = () => setSearch(window.location.search);
        window.addEventListener(NAVIGATION_EVENT, update);
        return () => window.removeEventListener(NAVIGATION_EVENT, update);
      }, []);
      return new URLSearchParams(search);
    },
    useRouter() {
      return {
        replace(href: string) {
          window.history.replaceState(null, "", href);
          window.dispatchEvent(new Event(NAVIGATION_EVENT));
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
});
