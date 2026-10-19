import {
    addDoc, collection, doc, getDoc, runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { toggleUserFollow, isUserFollowing } from './follows.js';
import { prepareActivityReward, recordVideoWatch, writeRewardedActivity } from './activity-rewards.js';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;'
    })[character]);
}

function isImage(video) {
    if (video.mediaType) return video.mediaType === 'image';
    return /\.(avif|gif|jpe?g|png|webp|bmp|heic)(?:\?|$)/i.test(video.link || '');
}

function formatCount(value) {
    const count = Number(value);
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
        .format(Number.isFinite(count) ? Math.max(0, count) : 0);
}

export function createProfileVideoViewer({ auth, db }) {
    const dialog = document.createElement('dialog');
    dialog.className = 'profile-video-viewer fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-black p-0 text-white';
    dialog.innerHTML = `
        <style>
            .profile-video-viewer .bg-tiktok-red { background-color: #fe2c55; }
            .profile-video-viewer .text-tiktok-red { color: #fe2c55; }
            .profile-video-viewer .text-tiktok-cyan { color: #25f4ee; }
            .profile-video-viewer .viewer-disc { animation: viewer-disc-spin 5s linear infinite; }
            @keyframes viewer-disc-spin { to { transform: rotate(360deg); } }
        </style>
        <div class="viewer-feed absolute inset-0 snap-y snap-mandatory overflow-y-auto overscroll-contain"></div>
        <button type="button" class="viewer-close absolute right-4 top-4 z-40 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80" aria-label="Close video feed">
            <i data-lucide="x" class="h-6 w-6" aria-hidden="true"></i>
        </button>
        <button type="button" class="viewer-mute absolute right-4 top-16 z-30 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70" aria-label="Unmute video">
            <i data-lucide="volume-x" class="h-5 w-5" aria-hidden="true"></i>
        </button>
        <div class="viewer-toast pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white opacity-0 transition-opacity"></div>
        <section class="viewer-comments hidden absolute inset-x-0 bottom-0 z-40 mx-auto flex max-h-[75dvh] w-full max-w-md flex-col rounded-t-2xl bg-white text-zinc-900 shadow-2xl" aria-label="Video comments">
            <header class="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
                <h2 class="viewer-comments-title text-sm font-bold">Comments</h2>
                <button type="button" class="viewer-comments-close rounded-full p-1 text-zinc-500 hover:bg-zinc-100" aria-label="Close comments">
                    <i data-lucide="x" class="h-5 w-5" aria-hidden="true"></i>
                </button>
            </header>
            <div class="viewer-comments-list min-h-24 flex-1 space-y-4 overflow-y-auto px-4 py-4"></div>
            <form class="viewer-comment-form flex items-center gap-2 border-t border-zinc-200 p-3">
                <input class="viewer-comment-input min-w-0 flex-1 rounded-full bg-zinc-100 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-rose-400" maxlength="1000" placeholder="Add a comment…" aria-label="Add a comment">
                <button class="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" type="submit" disabled>Post</button>
            </form>
        </section>`;
    document.body.append(dialog);

    const feed = dialog.querySelector('.viewer-feed');
    const muteButton = dialog.querySelector('.viewer-mute');
    const muteIcon = muteButton.querySelector('i');
    const commentsPanel = dialog.querySelector('.viewer-comments');
    const commentsList = dialog.querySelector('.viewer-comments-list');
    const commentsTitle = dialog.querySelector('.viewer-comments-title');
    const commentForm = dialog.querySelector('.viewer-comment-form');
    const commentInput = dialog.querySelector('.viewer-comment-input');
    let activeSlide = null;
    let playingSlide = null;
    let toastTimeout = null;

    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const video = entry.target.querySelector('video');
            if (!video) continue;
            if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
                playingSlide = entry.target;
                if (video.dataset.historyListener !== 'true') {
                    video.dataset.historyListener = 'true';
                    video.addEventListener('playing', async () => {
                        const user = auth.currentUser;
                        if (!user) return;
                        if (video.dataset.historyPlaying === 'true') return;
                        video.dataset.historyPlaying = 'true';
                        try {
                            const earned = await recordVideoWatch(db, user, entry.target.dataset.id);
                            if (earned > 0) showToast(`You earned ${earned} coins for watching this video!`);
                        } catch (error) {
                            console.error('Could not save profile video watch activity:', error);
                            showToast(error.message || 'Could not record your video watch.');
                        }
                    });
                    video.addEventListener('pause', () => {
                        video.dataset.historyPlaying = 'false';
                    });
                }
                video.play().catch(error => console.error('Could not play profile video:', error));
            } else {
                video.pause();
            }
        }
    }, { threshold: [0, 0.7, 1] });

    function showToast(message) {
        const toast = dialog.querySelector('.viewer-toast');
        if (/\bcoins?\b/i.test(message)) {
            const coinIcon = document.createElement('i');
            coinIcon.setAttribute('data-lucide', 'coins');
            coinIcon.className = 'mr-1 inline h-4 w-4 align-[-0.15em] text-amber-400';
            coinIcon.setAttribute('aria-hidden', 'true');
            toast.replaceChildren(coinIcon, document.createTextNode(message));
            lucide.createIcons();
        } else {
            toast.textContent = message;
        }
        toast.classList.remove('opacity-0');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toast.classList.add('opacity-0'), 2200);
    }

    function requireUser() {
        const user = auth.currentUser;
        if (user) return user;
        const returnTo = `${location.pathname}${location.search}${location.hash}`;
        location.href = `./oauth.html?returnTo=${encodeURIComponent(returnTo)}`;
        return null;
    }

    function updateCommentList(video) {
        const comments = Array.isArray(video.comments) ? video.comments : [];
        commentsTitle.textContent = `${formatCount(comments.length)} comment${comments.length === 1 ? '' : 's'}`;
        commentsList.innerHTML = comments.length ? comments.map(comment => {
            const data = typeof comment === 'string' ? { text: comment } : comment;
            const name = data.username ? `@${data.username}` : data.user || 'EarnTok user';
            return `<article class="flex items-start gap-3">
                <img src="${escapeHtml(data.profileImageLink || data.avatar || DEFAULT_AVATAR)}" class="h-9 w-9 shrink-0 rounded-full object-cover" alt="">
                <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold text-zinc-500">${escapeHtml(name)}</p>
                    <p class="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-900">${escapeHtml(data.text || '')}</p>
                </div>
            </article>`;
        }).join('') : '<p class="py-8 text-center text-sm text-zinc-500">No comments yet. Be the first to comment.</p>';
        commentsList.scrollTop = 0;
    }

    async function persistEngagement(slide, action, field, delta) {
        const user = requireUser();
        if (!user) return null;
        const videoId = slide.dataset.id;
        const videoRef = doc(db, 'videos', videoId);
        const userRef = doc(db, 'users', user.uid);
        const activityRef = doc(collection(db, 'activity'));
        const rewardNoticeRef = field === 'likesCount' ? doc(collection(db, 'activities')) : null;

        return runTransaction(db, async transaction => {
            const [videoSnapshot, userSnapshot] = await Promise.all([
                transaction.get(videoRef),
                transaction.get(userRef)
            ]);
            if (!videoSnapshot.exists()) throw new Error('This video is no longer available.');

            const userData = userSnapshot.exists() ? userSnapshot.data() : {};
            const listField = field === 'likesCount' ? 'likedVideoIds' : 'savedVideoIds';
            const currentIds = Array.isArray(userData[listField]) ? userData[listField] : [];
            const alreadyEngaged = currentIds.includes(videoId);
            const shouldEngage = delta > 0;
            if (alreadyEngaged === shouldEngage) {
                return { count: Number(videoSnapshot.data()[field]) || 0, engaged: alreadyEngaged };
            }

            const nextIds = shouldEngage
                ? [...new Set([...currentIds, videoId])]
                : currentIds.filter(id => id !== videoId);
            const count = Math.max(0, (Number(videoSnapshot.data()[field]) || 0) + (shouldEngage ? 1 : -1));
            const recordedAction = alreadyEngaged ? (field === 'likesCount' ? 'unlike' : 'unsave') : action;
            const reward = field === 'likesCount'
                ? await prepareActivityReward(transaction, db, user.uid, recordedAction, userSnapshot)
                : null;
            transaction.update(videoRef, { [field]: count });
            const activity = {
                videoId,
                userId: user.uid,
                action: recordedAction,
                details: {},
                createdAt: serverTimestamp()
            };
            if (reward) {
                writeRewardedActivity(transaction, reward, activityRef, activity, { [listField]: nextIds }, rewardNoticeRef);
            } else {
                transaction.set(userRef, { [listField]: nextIds }, { merge: true });
                transaction.set(activityRef, activity);
            }
            return { count, engaged: shouldEngage };
        });
    }

    function setEngagementState(button, engaged, kind) {
        const slide = button.closest('.profile-video-slide');
        const attribute = kind === 'like' ? 'liked' : 'bookmarked';
        const dataKey = kind === 'like' ? 'likes' : 'saves';
        const count = slide.querySelector(kind === 'like' ? '.like-count' : '.saves-count');
        slide.dataset[attribute] = String(engaged);
        button.classList.toggle(kind === 'like' ? 'text-tiktok-red' : 'text-yellow-400', engaged);
        button.classList.toggle('text-white', !engaged);
        count.textContent = formatCount(slide.dataset[dataKey]);
    }

    async function toggleEngagement(button, kind) {
        if (button.disabled) return;
        const slide = button.closest('.profile-video-slide');
        const isLiked = slide.dataset.liked === 'true';
        const isSaved = slide.dataset.bookmarked === 'true';
        const engaged = kind === 'like' ? isLiked : isSaved;
        button.disabled = true;
        try {
            const result = await persistEngagement(
                slide,
                kind === 'like' ? 'like' : 'save',
                kind === 'like' ? 'likesCount' : 'savesCount',
                engaged ? -1 : 1
            );
            if (!result) return;
            slide.dataset[kind === 'like' ? 'likes' : 'saves'] = String(result.count);
            setEngagementState(button, result.engaged, kind);
            showToast(kind === 'like'
                ? result.engaged ? 'Liked video' : 'Like removed'
                : result.engaged ? 'Saved to Favorites' : 'Removed from Favorites');
        } catch (error) {
            console.error(`Could not update video ${kind}:`, error);
            showToast(error.message || `Could not update ${kind}. Please try again.`);
        } finally {
            button.disabled = false;
        }
    }

    async function toggleFollow(button) {
        const user = requireUser();
        if (!user) return;
        const slide = button.closest('.profile-video-slide');
        const creatorId = slide.dataset.creatorId;
        if (!creatorId || creatorId === user.uid) return;
        button.disabled = true;
        try {
            const following = await toggleUserFollow(user.uid, creatorId, {
                videoId: slide.dataset.id,
                source: 'profile_video_viewer'
            });
            button.innerHTML = following
                ? '<i data-lucide="check" class="h-4 w-4" aria-hidden="true"></i>'
                : '<i data-lucide="plus" class="h-4 w-4" aria-hidden="true"></i>';
            button.classList.toggle('bg-gray-700', following);
            button.classList.toggle('bg-tiktok-red', !following);
            button.setAttribute('aria-label', following ? 'Unfollow creator' : 'Follow creator');
            lucide.createIcons();
            showToast(following ? 'Following creator!' : 'Unfollowed creator.');
        } catch (error) {
            console.error('Could not update creator follow:', error);
            showToast(error.message || 'Could not update follow status.');
        } finally {
            button.disabled = false;
        }
    }

    async function showComments(slide) {
        const user = requireUser();
        if (!user) return;
        activeSlide = slide;
        try {
            await addDoc(collection(db, 'activity'), {
                videoId: slide.dataset.id,
                userId: user.uid,
                action: 'view_comments',
                details: {},
                createdAt: serverTimestamp()
            });
            updateCommentList(slide.videoData);
            commentsPanel.classList.remove('hidden');
            commentInput.focus();
        } catch (error) {
            console.error('Could not load video comments:', error);
            showToast('Comments could not be loaded. Please try again.');
        }
    }

    async function postComment(event) {
        event.preventDefault();
        const user = requireUser();
        const text = commentInput.value.trim();
        if (!user || !activeSlide || !text) return;
        const submitButton = commentForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        try {
            let author = {};
            const profileSnapshot = await getDoc(doc(db, 'profiles', user.uid));
            if (profileSnapshot.exists()) {
                author = profileSnapshot.data();
            } else {
                const accountSnapshot = await getDoc(doc(db, 'users', user.uid));
                if (accountSnapshot.exists()) author = accountSnapshot.data();
            }
            const username = String(author.username || user.displayName || 'user').replace(/^@/, '');
            const comment = {
                id: Date.now(),
                userId: user.uid,
                username,
                user: `@${username}`,
                profileImageLink: author.profilePic || user.photoURL || '',
                verify: author.verify === 'yes' ? 'yes' : 'no',
                text,
                likes: 0
            };
            const videoRef = doc(db, 'videos', activeSlide.dataset.id);
            const activityRef = doc(collection(db, 'activity'));
            const rewardNoticeRef = doc(collection(db, 'activities'));
            const updatedComments = await runTransaction(db, async transaction => {
                const snapshot = await transaction.get(videoRef);
                if (!snapshot.exists()) throw new Error('This video is no longer available.');
                const reward = await prepareActivityReward(transaction, db, user.uid, 'comment');
                const comments = Array.isArray(snapshot.data().comments) ? snapshot.data().comments : [];
                const nextComments = [comment, ...comments];
                transaction.update(videoRef, { comments: nextComments });
                writeRewardedActivity(transaction, reward, activityRef, {
                    videoId: activeSlide.dataset.id,
                    userId: user.uid,
                    action: 'comment',
                    details: { text },
                    createdAt: serverTimestamp()
                }, {}, rewardNoticeRef);
                return nextComments;
            });
            activeSlide.videoData.comments = updatedComments;
            activeSlide.querySelector('.comment-count').textContent = formatCount(updatedComments.length);
            commentInput.value = '';
            updateCommentList(activeSlide.videoData);
            showToast('Comment posted!');
        } catch (error) {
            console.error('Could not post video comment:', error);
            showToast(error.message || 'Could not post your comment. Please try again.');
        } finally {
            submitButton.disabled = !commentInput.value.trim();
        }
    }

    async function shareVideo(slide) {
        const user = requireUser();
        if (!user) return;
        const shareUrl = new URL(location.href);
        shareUrl.hash = `video-${slide.dataset.id}`;
        try {
            if (navigator.share) {
                await navigator.share({
                    title: slide.videoData.description || 'Check out this video',
                    url: shareUrl.href
                });
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl.href);
                showToast('Link copied to clipboard!');
            } else {
                throw new Error('Sharing is not available in this browser.');
            }

            const videoRef = doc(db, 'videos', slide.dataset.id);
            const activityRef = doc(collection(db, 'activity'));
            const rewardNoticeRef = doc(collection(db, 'activities'));
            const shareCount = await runTransaction(db, async transaction => {
                const snapshot = await transaction.get(videoRef);
                if (!snapshot.exists()) throw new Error('This video is no longer available.');
                const reward = await prepareActivityReward(transaction, db, user.uid, 'share');
                const count = Math.max(0, (Number(snapshot.data().sharesCount) || 0) + 1);
                transaction.update(videoRef, { sharesCount: count });
                writeRewardedActivity(transaction, reward, activityRef, {
                    videoId: slide.dataset.id,
                    userId: user.uid,
                    action: 'share',
                    details: { method: navigator.share ? 'native' : 'copy_link' },
                    createdAt: serverTimestamp()
                }, {}, rewardNoticeRef);
                return count;
            });
            slide.dataset.shares = String(shareCount);
            slide.querySelector('.share-count').textContent = formatCount(shareCount);
            if (navigator.share) showToast('Video shared!');
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Could not share video:', error);
            showToast(error.message || 'Could not share this video.');
        }
    }

    function createSlide(video, engagement) {
        const slide = document.createElement('section');
        const creatorName = video.creatorUsername || video.uploadedBy || 'Creator';
        const creatorAvatar = video.creatorAvatar || video.profilePic || DEFAULT_AVATAR;
        const creatorHref = video.creatorProfileHref || (video.userId
            ? `./view-profile.html?uid=${encodeURIComponent(video.userId)}`
            : '');
        const audioName = video.audio || video.sound || `Original sound - ${creatorName}`;
        const source = escapeHtml(video.link);
        const media = isImage(video)
            ? `<img class="viewer-media h-full w-full object-cover" src="${source}" alt="${escapeHtml(video.description || '')}">`
            : `<video class="viewer-media h-full w-full object-cover" src="${source}" ${video.thumbnail ? `poster="${escapeHtml(video.thumbnail)}"` : ''} muted playsinline loop preload="metadata"></video>`;
        const verified = video.creatorVerified
            ? '<i data-lucide="badge-check" class="ml-1 inline-block h-4 w-4 align-middle text-sky-400" aria-label="Verified creator"></i>'
            : '';

        slide.className = 'profile-video-slide relative mx-auto h-[100dvh] min-h-[100dvh] w-full max-w-md snap-start overflow-hidden bg-black text-white';
        slide.dataset.id = video.id;
        slide.dataset.videoId = video.id;
        slide.dataset.creatorId = video.userId || '';
        slide.dataset.likes = String(Math.max(0, Number(video.likesCount) || 0));
        slide.dataset.saves = String(Math.max(0, Number(video.savesCount) || 0));
        slide.dataset.shares = String(Math.max(0, Number(video.sharesCount) || 0));
        slide.dataset.liked = String(engagement.likedIds.has(video.id));
        slide.dataset.bookmarked = String(engagement.savedIds.has(video.id));
        slide.videoData = { ...video, comments: Array.isArray(video.comments) ? video.comments : [] };

        slide.innerHTML = `
            ${media}
            <div class="viewer-play-overlay pointer-events-none absolute inset-0 z-10 flex items-center justify-center opacity-0 transition-opacity">
                <span class="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                    <i data-lucide="play" class="ml-1 h-8 w-8 fill-white text-white" aria-hidden="true"></i>
                </span>
            </div>
            <div class="absolute bottom-6 right-3 z-20 flex flex-col items-center space-y-3.5">
                <div class="relative mb-1">
                    ${creatorHref
                        ? `<a href="${escapeHtml(creatorHref)}" class="block rounded-full" aria-label="View ${escapeHtml(creatorName)}'s profile"><img src="${escapeHtml(creatorAvatar)}" class="h-12 w-12 rounded-full border-2 border-white object-cover shadow-lg" alt=""></a>`
                        : `<img src="${escapeHtml(creatorAvatar)}" class="h-12 w-12 rounded-full border-2 border-white object-cover shadow-lg" alt="">`}
                    ${video.userId && video.userId !== auth.currentUser?.uid
                        ? `<button type="button" class="viewer-follow absolute -bottom-1.5 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-tiktok-red text-white shadow-md transition active:scale-90" aria-label="Follow creator"><i data-lucide="plus" class="h-4 w-4" aria-hidden="true"></i></button>`
                        : ''}
                </div>
                <div class="flex flex-col items-center">
                    <button type="button" class="viewer-like p-2 text-white transition hover:bg-white/10 active:scale-75" aria-label="Like video">
                        <i data-lucide="heart" class="h-8 w-8 transition-colors" aria-hidden="true"></i>
                    </button>
                    <span class="like-count text-xs font-semibold drop-shadow-md">${formatCount(slide.dataset.likes)}</span>
                </div>
                <div class="flex flex-col items-center">
                    <button type="button" class="viewer-comments-button p-2 text-white transition hover:bg-white/10 active:scale-75" aria-label="View comments">
                        <i data-lucide="message-circle" class="h-8 w-8 drop-shadow-md" aria-hidden="true"></i>
                    </button>
                    <span class="comment-count text-xs font-semibold drop-shadow-md">${formatCount(slide.videoData.comments.length)}</span>
                </div>
                <div class="flex flex-col items-center">
                    <button type="button" class="viewer-save p-2 text-white transition hover:bg-white/10 active:scale-75" aria-label="Save video">
                        <i data-lucide="bookmark" class="h-8 w-8 drop-shadow-md" aria-hidden="true"></i>
                    </button>
                    <span class="saves-count text-xs font-semibold drop-shadow-md">${formatCount(slide.dataset.saves)}</span>
                </div>
                <div class="flex flex-col items-center">
                    <button type="button" class="viewer-share p-2 text-white transition hover:bg-white/10 active:scale-75" aria-label="Share video">
                        <i data-lucide="share-2" class="h-8 w-8 drop-shadow-md" aria-hidden="true"></i>
                    </button>
                    <span class="share-count text-xs font-semibold drop-shadow-md">${formatCount(slide.dataset.shares)}</span>
                </div>
                <div class="viewer-disc mt-1 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-gray-700 bg-gray-900 shadow-lg">
                    <img src="${escapeHtml(creatorAvatar)}" class="h-full w-full rounded-full object-cover" alt="">
                </div>
            </div>
            <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent pb-5 pl-4 pr-20 pt-28">
                <div class="pointer-events-auto">
                    <h2 class="inline-flex items-center text-base font-bold drop-shadow-md">
                        ${creatorHref ? `<a href="${escapeHtml(creatorHref)}" class="hover:underline">${escapeHtml(creatorName)}</a>` : escapeHtml(creatorName)}
                        ${verified}
                    </h2>
                    <p class="mt-1 line-clamp-3 text-sm leading-snug text-gray-100 drop-shadow-sm">${escapeHtml(video.description || '')}</p>
                    <div class="mt-3 flex items-center gap-2 overflow-hidden text-xs font-medium text-gray-200">
                        <i data-lucide="music" class="h-3.5 w-3.5 shrink-0 animate-pulse text-tiktok-cyan" aria-hidden="true"></i>
                        <p class="truncate">${escapeHtml(audioName)}</p>
                    </div>
                </div>
            </div>`;

        const likeButton = slide.querySelector('.viewer-like');
        const saveButton = slide.querySelector('.viewer-save');
        setEngagementState(likeButton, engagement.likedIds.has(video.id), 'like');
        setEngagementState(saveButton, engagement.savedIds.has(video.id), 'save');
        likeButton.addEventListener('click', () => toggleEngagement(likeButton, 'like'));
        saveButton.addEventListener('click', () => toggleEngagement(saveButton, 'save'));
        slide.querySelector('.viewer-comments-button').addEventListener('click', () => showComments(slide));
        slide.querySelector('.viewer-share').addEventListener('click', () => shareVideo(slide));
        slide.querySelector('.viewer-follow')?.addEventListener('click', event => {
            event.stopPropagation();
            toggleFollow(event.currentTarget);
        });
        const mediaElement = slide.querySelector('.viewer-media');
        mediaElement.addEventListener('click', event => {
            if (!(event.currentTarget instanceof HTMLVideoElement)) return;
            if (event.currentTarget.paused) {
                event.currentTarget.play().catch(error => console.error('Could not play profile video:', error));
                slide.querySelector('.viewer-play-overlay').classList.add('opacity-0');
            } else {
                event.currentTarget.pause();
                slide.querySelector('.viewer-play-overlay').classList.remove('opacity-0');
            }
        });
        mediaElement.addEventListener('dblclick', event => {
            event.preventDefault();
            const like = slide.querySelector('.viewer-like');
            if (slide.dataset.liked !== 'true') toggleEngagement(like, 'like');
        });
        mediaElement.addEventListener('error', () => showToast('Could not load this post.'));
        return slide;
    }

    async function open(videos, startId) {
        observer.disconnect();
        commentsPanel.classList.add('hidden');
        playingSlide = null;
        feed.replaceChildren();

        const user = auth.currentUser;
        const engagement = { likedIds: new Set(), savedIds: new Set() };
        if (user) {
            try {
                const userSnapshot = await getDoc(doc(db, 'users', user.uid));
                if (userSnapshot.exists()) {
                    const data = userSnapshot.data();
                    engagement.likedIds = new Set(Array.isArray(data.likedVideoIds) ? data.likedVideoIds : []);
                    engagement.savedIds = new Set(Array.isArray(data.savedVideoIds) ? data.savedVideoIds : []);
                }
            } catch (error) {
                console.error('Could not load video engagement state:', error);
                showToast('Could not load your like and save status.');
            }
        }

        for (const video of videos) {
            const slide = createSlide(video, engagement);
            feed.append(slide);
            observer.observe(slide);
        }
        lucide.createIcons();
        if (!dialog.open) dialog.showModal();

        for (const slide of feed.querySelectorAll('.profile-video-slide')) {
            const followButton = slide.querySelector('.viewer-follow');
            if (!followButton || !user) continue;
            try {
                const following = await isUserFollowing(user.uid, slide.dataset.creatorId);
                if (following) {
                    followButton.innerHTML = '<i data-lucide="check" class="h-4 w-4" aria-hidden="true"></i>';
                    followButton.classList.replace('bg-tiktok-red', 'bg-gray-700');
                    followButton.setAttribute('aria-label', 'Unfollow creator');
                    lucide.createIcons();
                }
            } catch (error) {
                console.error('Could not load creator follow status:', error);
                showToast('Could not load follow status.');
            }
        }

        requestAnimationFrame(() => {
            const selected = feed.querySelector(`[data-video-id="${CSS.escape(startId)}"]`);
            selected?.scrollIntoView({ block: 'start' });
        });
    }

    function closeComments() {
        commentsPanel.classList.add('hidden');
        commentInput.value = '';
    }

    dialog.querySelector('.viewer-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.viewer-comments-close').addEventListener('click', closeComments);
    dialog.querySelector('.viewer-comments').addEventListener('click', event => {
        if (event.target === commentsPanel) closeComments();
    });
    dialog.querySelector('.viewer-comments').addEventListener('click', event => event.stopPropagation());
    commentInput.addEventListener('input', () => {
        commentForm.querySelector('button[type="submit"]').disabled = !commentInput.value.trim();
    });
    commentForm.addEventListener('submit', postComment);
    muteButton.addEventListener('click', () => {
        const video = playingSlide?.querySelector('video');
        if (!video) return;
        video.muted = !video.muted;
        muteIcon.setAttribute('data-lucide', video.muted ? 'volume-x' : 'volume-2');
        muteButton.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
        lucide.createIcons();
    });
    dialog.addEventListener('close', () => {
        observer.disconnect();
        playingSlide = null;
        commentsPanel.classList.add('hidden');
        feed.querySelectorAll('video').forEach(video => video.pause());
    });

    return { open };
}
