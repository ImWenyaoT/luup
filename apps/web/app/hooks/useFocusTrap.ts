import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

type FocusTrapOptions = {
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onEscape: () => void;
  autoFocus?: boolean;
  trapFocus?: boolean;
  suspended?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function useFocusTrap({
  active,
  containerRef,
  onEscape,
  autoFocus = true,
  trapFocus = true,
  suspended = false,
  returnFocusRef,
}: FocusTrapOptions) {
  const onEscapeRef = useRef(onEscape);
  const suspendedRef = useRef(suspended);
  onEscapeRef.current = onEscape;
  suspendedRef.current = suspended;

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (returnFocusRef && previous !== document.body) returnFocusRef.current = previous;
    const frame = requestAnimationFrame(() => {
      if (autoFocus) containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (suspendedRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab" || !trapFocus || !containerRef.current) return;
      const focusable = [...containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      (returnFocusRef?.current ?? previous)?.focus();
    };
  }, [active, autoFocus, containerRef, returnFocusRef, trapFocus]);
}
