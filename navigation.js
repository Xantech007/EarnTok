export function enableHistoryBack() {
    document.querySelectorAll('[data-history-back]').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            if (window.history.length > 1) {
                window.history.back();
            }
        });
    });
}
