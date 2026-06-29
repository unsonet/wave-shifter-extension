function openModal(modal, focusSelector) {
    modal = typeof modal == 'string' ? document.getElementById(modal) : modal;
    if (!modal) return;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");

    if (focusSelector) {
        const focusEl = modal.querySelector(focusSelector);
        if (focusEl) focusEl.focus();
    }
}

function closeModal(modal, returnFocusSelector) {
    modal = typeof modal == 'string' ? document.getElementById(modal) : modal;
    if (!modal) return;

    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");

    if (returnFocusSelector) {
        const returnEl = document.querySelector(returnFocusSelector);
        if (returnEl) returnEl.focus();
    }
}


document.addEventListener("click", (e) => {
    if (e.target.closest(".simple-modal .close")) {
        const modal = e.target.closest(".simple-modal");
        if (modal) closeModal(modal.id);
        return;
    }

    if (e.target.classList.contains("simple-modal__backdrop")) {
        const modal = e.target.closest(".simple-modal");
        if (modal) closeModal(modal.id);
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const activeModal = document.querySelector(".simple-modal.open");
        if (activeModal) {
            closeModal(activeModal.id);
        }
    }
});

globalThis['simpleModal'] = {
    openModal, closeModal
}