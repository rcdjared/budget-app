import { useEffect } from "react";

function hasUnsavedInput(panel: HTMLElement): boolean {
  return panel.dataset.sheetDirty === "true";
}

function sheetFor(target: HTMLElement): HTMLElement | null {
  return target.closest<HTMLElement>(".account-sheet, .add-sheet, .add-menu, .appearance-picker-sheet, .chat-screen");
}

function confirmDiscardChanges(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "discard-confirm-overlay";
    const dialog = document.createElement("section");
    dialog.className = "discard-confirm-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "discard-confirm-title");
    const title = document.createElement("h2");
    title.id = "discard-confirm-title";
    title.textContent = "Discard changes?";
    const detail = document.createElement("p");
    detail.textContent = "Your changes haven’t been saved.";
    const actions = document.createElement("div");
    actions.className = "discard-confirm-actions";
    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "discard-keep-button";
    keep.textContent = "Keep editing";
    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "discard-confirm-button";
    discard.textContent = "Discard";
    actions.append(keep, discard);
    dialog.append(title, detail, actions);
    overlay.append(dialog);
    document.body.append(overlay);

    let finished = false;
    const finish = (shouldDiscard: boolean) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      resolve(shouldDiscard);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      } else if (event.key === "Tab") {
        event.preventDefault();
        (document.activeElement === keep ? discard : keep).focus();
      }
    };
    keep.addEventListener("click", () => finish(false));
    discard.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKeyDown, true);
    keep.focus();
  });
}

export function useSheetGestures(): void {
  useEffect(() => {
    let startY = 0;
    let startX = 0;
    let startAt = 0;
    let dragY = 0;
    let didMove = false;
    let animationFrame = 0;
    let pointerId: number | null = null;
    let panel: HTMLElement | null = null;
    let backdrop: HTMLElement | null = null;
    let scrollTarget: HTMLElement | null = null;
    let scrollStartTop = 0;
    let approvedClose = false;

    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target as HTMLElement;
      const activeSheet = sheetFor(target);
      if (!activeSheet || target.closest("input, textarea, select, [contenteditable='true'], input[type='range']")) return;
      let scrollParent: HTMLElement | null = target;
      scrollTarget = null;
      while (scrollParent) {
        if (scrollParent.scrollHeight > scrollParent.clientHeight + 1) {
          scrollTarget = scrollParent;
          break;
        }
        if (scrollParent === activeSheet) break;
        scrollParent = scrollParent.parentElement;
      }
      backdrop = target.closest<HTMLElement>(".sheet-backdrop, .add-menu-overlay");
      if (!backdrop) return;
      panel = activeSheet;
      scrollStartTop = scrollTarget?.scrollTop || 0;
      pointerId = event.pointerId;
      startY = event.clientY;
      startX = event.clientX;
      startAt = performance.now();
      dragY = 0;
      didMove = false;
    };

    const move = (event: PointerEvent) => {
      if (!panel || !backdrop || event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!didMove && Math.abs(dx) > Math.abs(dy)) {
        panel = null;
        backdrop = null;
        pointerId = null;
        return;
      }
      if (scrollTarget && dy < 0) {
        scrollTarget.scrollTop = scrollStartTop - dy;
        return;
      }
      if (dy < 0) return;
      const scrollConsumed = scrollTarget ? Math.min(scrollStartTop, dy) : 0;
      if (scrollTarget && scrollStartTop > 0) scrollTarget.scrollTop = scrollStartTop - scrollConsumed;
      const pullDistance = dy - scrollConsumed;
      if (pullDistance < 4) return;
      event.preventDefault();
      didMove = true;
      dragY = pullDistance;
      const progress = Math.min(1, dragY / Math.max(1, panel.clientHeight));
      backdrop.style.backgroundColor = `rgba(0, 0, 0, ${0.4 * (1 - progress)})`;
      if (animationFrame) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        if (panel) {
          panel.style.transition = "none";
          panel.style.transform = `translate3d(0, ${dragY}px, 0)`;
        }
      });
    };

    const reset = (current: HTMLElement, currentBackdrop: HTMLElement | null) => {
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 220;
      current.style.transition = `transform ${duration}ms cubic-bezier(.22,1,.36,1)`;
      current.style.transform = "translate3d(0, 0, 0)";
      if (currentBackdrop) {
        currentBackdrop.style.transition = `background-color ${duration}ms ease`;
        currentBackdrop.style.backgroundColor = "";
      }
      window.setTimeout(() => {
        current.style.removeProperty("transform");
        current.style.removeProperty("transition");
        currentBackdrop?.style.removeProperty("transition");
        currentBackdrop?.style.removeProperty("background-color");
      }, duration + 20);
    };

    const up = (event: PointerEvent) => {
      if (!panel || event.pointerId !== pointerId) return;
      const current = panel;
      const currentBackdrop = backdrop;
      const distance = Math.max(0, event.clientY - startY - scrollStartTop);
      const velocity = distance / Math.max(1, performance.now() - startAt);
      panel = null;
      backdrop = null;
      pointerId = null;
      if (!didMove) return;
      if (animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = 0; }
      const shouldDismiss = distance > current.clientHeight * 0.25 || (distance > 35 && velocity > 0.65);
      if (!shouldDismiss) { reset(current, currentBackdrop); return; }
      const dismiss = () => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        const closeDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 200;
        current.style.transition = `transform ${closeDuration}ms cubic-bezier(.22,1,.36,1)`;
        current.style.transform = "translate3d(0, 100%, 0)";
        if (currentBackdrop) {
          currentBackdrop.style.transition = `background-color ${closeDuration}ms ease`;
          currentBackdrop.style.backgroundColor = "rgba(0, 0, 0, 0)";
        }
        window.setTimeout(() => {
          if (current.classList.contains("add-menu")) {
            currentBackdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          } else {
            const closeButton = current.querySelector<HTMLElement>(".sheet-close-btn, .sheet-header > button:first-child");
            if (closeButton) {
              approvedClose = true;
              closeButton.click();
            }
          }
        }, closeDuration);
      };
      if (hasUnsavedInput(current)) {
        void confirmDiscardChanges().then((discard) => discard ? dismiss() : reset(current, currentBackdrop));
        return;
      }
      dismiss();
    };

    const cancel = () => {
      if (!panel) return;
      const current = panel;
      panel = null;
      pointerId = null;
      if (animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = 0; }
      reset(current, backdrop);
      backdrop = null;
    };

    const guardClose = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const parentBackdrop = target.closest<HTMLElement>(".sheet-backdrop, .add-menu-overlay");
      if (!parentBackdrop) return;
      if (approvedClose) {
        approvedClose = false;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return;
      }
      const isBackdropPress = target === parentBackdrop;
      const isClosePress = Boolean(target.closest(".sheet-close-btn, .sheet-header > button:first-child"));
      if (!isBackdropPress && !isClosePress) return;
      const sheet = parentBackdrop.querySelector<HTMLElement>(".account-sheet, .add-sheet, .add-menu, .appearance-picker-sheet, .chat-screen");
      if (sheet && hasUnsavedInput(sheet)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void confirmDiscardChanges().then((discard) => {
          if (!discard) return;
          const closeButton = isBackdropPress
            ? parentBackdrop.querySelector<HTMLElement>(".sheet-close-btn, .sheet-header > button:first-child")
            : target.closest<HTMLElement>("button");
          if (closeButton) {
            approvedClose = true;
            closeButton.click();
          }
        });
        return;
      }
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (isBackdropPress && !parentBackdrop.classList.contains("add-menu-overlay")) {
        const closeButton = parentBackdrop.querySelector<HTMLElement>(".sheet-close-btn, .sheet-header > button:first-child");
        if (closeButton) {
          event.preventDefault();
          approvedClose = true;
          closeButton.click();
        }
      }
    };

    const markDirty = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      target.closest<HTMLElement>(".account-sheet, .add-sheet, .add-menu")?.setAttribute("data-sheet-dirty", "true");
    };
    const markButtonChange = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".transaction-category-tile, .repeat-toggle-row, .transfer-segment button, .icon-grid-item, .color-swatch")) return;
      target.closest<HTMLElement>(".account-sheet, .add-sheet, .add-menu")?.setAttribute("data-sheet-dirty", "true");
    };

    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("click", guardClose, true);
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("click", markButtonChange, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("click", guardClose, true);
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
      document.removeEventListener("click", markButtonChange, true);
    };
  }, []);
}
