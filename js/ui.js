/* ui.js — non-blocking toasts, modal dialogs and an in-app confirm() */
const UI = (function () {
  const MAX_TOASTS = 3;
  let returnFocus = null;
  let onModalClose = null;

  function toast(message, opts) {
    opts = opts || {};
    const host = document.getElementById("toasts");
    const el = document.createElement("div");
    el.className = "toast" + (opts.kind ? " toast-" + opts.kind : "");
    el.setAttribute("role", opts.kind === "error" ? "alert" : "status");

    const text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = message;
    el.appendChild(text);

    let timer = null;
    const dismiss = () => {
      clearTimeout(timer);
      el.remove();
    };

    if (opts.action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = opts.action.label;
      btn.addEventListener("click", () => {
        dismiss();
        opts.action.fn();
      });
      el.appendChild(btn);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss");
    close.innerHTML = "&times;";
    close.addEventListener("click", dismiss);
    el.appendChild(close);

    host.appendChild(el);
    while (host.children.length > MAX_TOASTS) host.firstElementChild.remove();

    const life = opts.duration || (opts.action ? 7000 : opts.kind === "error" ? 6000 : 3500);
    const arm = () => (timer = setTimeout(dismiss, life));
    el.addEventListener("mouseenter", () => clearTimeout(timer));
    el.addEventListener("mouseleave", arm);
    arm();
    return dismiss;
  }

  function isModalOpen() {
    return !document.getElementById("modal-overlay").hidden;
  }

  function openModal(id, focusSelector) {
    const overlay = document.getElementById("modal-overlay");
    if (overlay.hidden) returnFocus = document.activeElement;
    overlay.hidden = false;
    document.querySelectorAll(".modal").forEach((m) => (m.hidden = m.id !== id));
    const modal = document.getElementById(id);
    const target = modal && (focusSelector ? modal.querySelector(focusSelector) : modal.querySelector("input, textarea, select, button"));
    target && target.focus();
  }

  function closeModal() {
    const overlay = document.getElementById("modal-overlay");
    if (overlay.hidden) return;
    overlay.hidden = true;
    const cb = onModalClose;
    onModalClose = null;
    if (cb) cb(false);
    if (returnFocus && returnFocus.isConnected && returnFocus !== document.body) returnFocus.focus();
    returnFocus = null;
  }

  // Promise<boolean> — resolves false on Cancel, Escape or clicking outside
  function confirm(o) {
    const $ = (id) => document.getElementById(id);
    $("confirm-title").textContent = o.title || "Are you sure?";
    $("confirm-message").textContent = o.message || "";
    const ok = $("confirm-ok");
    ok.textContent = o.okLabel || "OK";
    ok.className = "btn " + (o.danger ? "btn-danger-solid" : "btn-accent");
    return new Promise((resolve) => {
      const onOk = () => {
        onModalClose = null;
        ok.removeEventListener("click", onOk);
        closeModal();
        resolve(true);
      };
      ok.addEventListener("click", onOk);
      openModal("modal-confirm", "#confirm-ok");
      onModalClose = (v) => {
        ok.removeEventListener("click", onOk);
        resolve(v);
      };
    });
  }

  return { toast, openModal, closeModal, isModalOpen, confirm };
})();
