import { useEffect, useState, type RefObject } from "react";

export function useCollapsingNav<T extends HTMLElement>(
  scrollRef: RefObject<T | null>,
  activeTab: string
): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    setCollapsed(false);
    scroller.scrollTo({ top: 0, behavior: "instant" });

    let previousTop = scroller.scrollTop;
    let downDistance = 0;
    const checkScrollable = () => {
      if (scroller.scrollHeight <= scroller.clientHeight + 1) {
        setCollapsed(false);
        downDistance = 0;
      }
    };
    const onScroll = () => {
      const currentTop = scroller.scrollTop;
      if (currentTop <= 1) {
        downDistance = 0;
        setCollapsed(false);
      } else if (currentTop > previousTop) {
        downDistance += currentTop - previousTop;
        if (downDistance >= 24) setCollapsed(true);
      } else if (currentTop < previousTop) {
        downDistance = 0;
      }
      previousTop = currentTop;
    };

    const observer = new ResizeObserver(checkScrollable);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", checkScrollable);
    checkScrollable();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", checkScrollable);
    };
  }, [scrollRef, activeTab]);

  return [collapsed, setCollapsed];
}
