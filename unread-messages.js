import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

export function renderUnreadMessageCount(count) {
    document.querySelectorAll('[data-unread-message-badge]').forEach(badge => {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.toggle('hidden', count === 0);
        badge.classList.toggle('flex', count > 0);

        const inboxLink = badge.closest('a');
        if (inboxLink) {
            inboxLink.setAttribute(
                'aria-label',
                count > 0 ? `Inbox, ${count} unread conversation${count === 1 ? '' : 's'}` : 'Inbox'
            );
        }
    });
}

export function subscribeToUnreadMessages(db, userId) {
    renderUnreadMessageCount(0);
    if (!userId) return () => {};

    let directUnreadCount = 0;
    let supportUnreadCount = 0;
    const updateCount = () => renderUnreadMessageCount(directUnreadCount + supportUnreadCount);
    const handleError = error => console.error('Could not listen to unread messages:', error);
    const directUnsubscribe = onSnapshot(query(
        collection(db, 'chats'),
        where('participants', 'array-contains', userId)
    ), snapshot => {
        directUnreadCount = snapshot.docs.reduce((count, chat) => {
            const unreadBy = chat.data().unreadBy;
            return count + (Array.isArray(unreadBy) && unreadBy.includes(userId) ? 1 : 0);
        }, 0);
        updateCount();
    }, handleError);
    const supportUnsubscribe = onSnapshot(query(
        collection(db, 'supportChats'),
        where('userId', '==', userId)
    ), snapshot => {
        supportUnreadCount = snapshot.docs.reduce((count, chat) => {
            const unreadBy = chat.data().unreadBy;
            return count + (Array.isArray(unreadBy) && unreadBy.includes(userId) ? 1 : 0);
        }, 0);
        updateCount();
    }, handleError);

    return () => {
        directUnsubscribe();
        supportUnsubscribe();
    };
}
