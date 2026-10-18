function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;'
    })[character]);
}

function isImage(video) {
    if (video.mediaType) return video.mediaType === 'image';
    return /\.(avif|gif|jpe?g|png|webp|bmp|heic)(?:\?|$)/i.test(video.link || '');
}

export function createProfileVideoViewer() {
    const dialog = document.createElement('dialog');
    dialog.className = 'profile-video-viewer fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-black p-0 text-white';
    dialog.innerHTML = `
        <button type="button" class="viewer-close absolute right-4 top-4 z-30 rounded-full bg-black/60 p-3 text-2xl leading-none" aria-label="Close video feed">×</button>
        <div class="viewer-feed h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"></div>`;
    document.body.append(dialog);

    const feed = dialog.querySelector('.viewer-feed');
    dialog.querySelector('.viewer-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
        observer.disconnect();
        feed.querySelectorAll('video').forEach(video => video.pause());
    });

    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const video = entry.target.querySelector('video');
            if (!video) continue;
            if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
                video.play().catch(error => console.error('Could not play profile video:', error));
            } else {
                video.pause();
            }
        }
    }, { threshold: [0, 0.7, 1] });

    function open(videos, startId) {
        observer.disconnect();
        feed.replaceChildren();
        for (const video of videos) {
            const source = escapeHtml(video.link);
            const media = isImage(video)
                ? `<img class="h-full w-full object-contain" src="${source}" alt="${escapeHtml(video.description || '')}">`
                : `<video class="h-full w-full object-contain" src="${source}" muted playsinline loop controls preload="metadata"></video>`;
            const slide = document.createElement('section');
            slide.className = 'relative flex h-full min-h-full snap-start items-center justify-center overflow-hidden bg-black';
            slide.dataset.videoId = video.id;
            slide.innerHTML = `
                ${media}
                <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent px-5 pb-10 pt-28">
                    <p class="text-sm font-semibold">${escapeHtml(video.uploadedBy || 'Creator')}</p>
                    <p class="mt-2 max-w-xl text-sm">${escapeHtml(video.description || '')}</p>
                    <p class="mt-2 text-xs text-white/75">♥ ${Number.isFinite(Number(video.likesCount)) ? Math.max(0, Number(video.likesCount)).toLocaleString() : '0'}</p>
                </div>`;
            feed.append(slide);
            observer.observe(slide);
        }

        if (!dialog.open) dialog.showModal();
        requestAnimationFrame(() => {
            const selected = feed.querySelector(`[data-video-id="${CSS.escape(startId)}"]`);
            selected?.scrollIntoView({ block: 'start' });
        });
    }

    return { open };
}
