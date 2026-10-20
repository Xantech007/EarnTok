import {
    addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, where, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;'
    })[character]);
}

function formatTime(timestamp) {
    const date = timestamp?.toDate?.();
    return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
}

export function startContactChat({ auth, db, kind, onAuthStateChanged }) {
    const params = new URLSearchParams(location.search);
    const merchantId = kind === 'merchant' ? params.get('merchantId') : '';
    const title = document.getElementById('chat-title');
    const subtitle = document.getElementById('chat-subtitle');
    const avatar = document.getElementById('chat-avatar');
    const messages = document.getElementById('chat-messages');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    const status = document.getElementById('chat-status');
    const error = document.getElementById('chat-error');
    let user = null;
    let chatId = null;
    let unsubscribeChat = null;
    let unsubscribeMessages = null;

    function showError(message) {
        error.textContent = message;
        error.classList.remove('hidden');
    }

    function renderMessages(entries) {
        messages.innerHTML = entries.length ? entries.map(message => {
            const isMine = message.senderId === user.uid;
            const sender = message.senderType === 'merchant' ? `${message.merchantName || 'Merchant'}`
                : message.senderType === 'support' ? 'Customer support'
                    : message.senderName || title.textContent;
            return `<article class="flex ${isMine ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[85%]">
                    ${!isMine ? `<p class="mb-1 px-1 text-[11px] font-semibold text-zinc-500">${escapeHtml(sender)}</p>` : ''}
                    <div class="rounded-2xl ${isMine ? 'rounded-br-sm bg-rose-500 text-white' : 'rounded-bl-sm border border-zinc-200 bg-zinc-100 text-zinc-900'} px-4 py-2.5 text-sm leading-5">
                        <p class="whitespace-pre-wrap break-words">${escapeHtml(message.text)}</p>
                    </div>
                    <p class="mt-1 px-1 text-[10px] text-zinc-400 ${isMine ? 'text-right' : ''}">${escapeHtml(formatTime(message.createdAt))}</p>
                </div>
            </article>`;
        }).join('') : '<p class="py-10 text-center text-sm text-zinc-400">No messages yet. Send a message to start the conversation.</p>';
        messages.scrollTop = messages.scrollHeight;
    }

    async function markRead() {
        if (!chatId || !user) return;
        try {
            const chatRef = doc(db, 'supportChats', chatId);
            await runTransaction(db, async transaction => {
                const snapshot = await transaction.get(chatRef);
                const unreadBy = snapshot.data()?.unreadBy;
                if (snapshot.exists() && Array.isArray(unreadBy) && unreadBy.includes(user.uid)) {
                    transaction.update(chatRef, { unreadBy: unreadBy.filter(uid => uid !== user.uid) });
                }
            });
        } catch (listenerError) {
            console.error('Could not mark support chat as read:', listenerError);
        }
    }

    async function findOrCreateChat() {
        if (kind === 'merchant' && !merchantId) throw new Error('No merchant was selected.');
        const existingChats = await getDocs(query(
            collection(db, 'supportChats'),
            where('userId', '==', user.uid)
        ));
        const existingChat = existingChats.docs.find(item => {
            const data = item.data();
            return data.kind === kind && (kind !== 'merchant' || data.merchantId === merchantId);
        });
        let merchant = null;
        if (kind === 'merchant') {
            const config = await getDoc(doc(db, 'admin', 'coinPayments'));
            merchant = (config.data()?.merchants || []).find(item => item.id === merchantId);
            if ((!merchant || merchant.enabled === false) && !existingChat) {
                throw new Error('This merchant is unavailable.');
            }
        }

        let chatRef;
        if (existingChat) {
            chatRef = existingChat.ref;
        } else {
            chatRef = await addDoc(collection(db, 'supportChats'), {
                kind,
                userId: user.uid,
                userName: user.displayName || user.email || 'EarnTok user',
                userEmail: user.email || '',
                ...(kind === 'merchant' ? {
                    merchantId,
                    merchantName: merchant.name,
                    merchantProfilePic: merchant.profilePic || ''
                } : {}),
                lastMessage: '',
                lastSenderId: '',
                unreadBy: [],
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        }
        chatId = existingChat?.id || chatRef.id;
        const chatData = existingChat?.data() || {};
        const label = kind === 'support' ? 'Customer support' : (merchant?.name || chatData.merchantName || 'Merchant');
        title.textContent = label;
        subtitle.textContent = kind === 'support' ? 'We’re here to help' : 'Chat with this coin merchant';
        avatar.src = kind === 'support'
            ? './earntok-logo.png'
            : merchant?.profilePic || chatData.merchantProfilePic || DEFAULT_AVATAR;
        avatar.onerror = () => { avatar.src = DEFAULT_AVATAR; };
        document.title = `EarnTok · ${kind === 'support' ? 'Contact support' : `Contact ${label}`}`;
        input.disabled = false;
        form.querySelector('button[type="submit"]').disabled = false;

        unsubscribeChat = onSnapshot(chatRef, snapshot => {
            if (snapshot.exists()) markRead();
        }, listenerError => {
            console.error('Unable to sync support chat:', listenerError);
            showError('Unable to sync this conversation in real time.');
        });
        unsubscribeMessages = onSnapshot(collection(db, 'supportChats', chatId, 'messages'), snapshot => {
            const entries = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
            entries.sort((left, right) =>
                (left.createdAt?.toMillis?.() || 0) - (right.createdAt?.toMillis?.() || 0));
            renderMessages(entries);
            markRead();
        }, listenerError => {
            console.error('Unable to listen to support messages:', listenerError);
            showError('Could not load messages. Check your connection and Firestore permissions.');
        });
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text || !chatId || !user) return;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const chatRef = doc(db, 'supportChats', chatId);
            const batch = writeBatch(db);
            batch.set(doc(collection(db, 'supportChats', chatId, 'messages')), {
                senderId: user.uid,
                senderType: 'user',
                senderName: user.displayName || user.email || 'EarnTok user',
                text,
                createdAt: serverTimestamp()
            });
            batch.update(chatRef, {
                lastMessage: text,
                lastSenderId: user.uid,
                unreadBy: ['admin'],
                updatedAt: serverTimestamp()
            });
            await batch.commit();
            input.value = '';
            status.textContent = '';
            status.classList.add('hidden');
        } catch (sendError) {
            console.error('Unable to send support message:', sendError);
            status.textContent = sendError.message || 'Could not send your message. Try again.';
            status.classList.remove('hidden');
        } finally {
            button.disabled = false;
            input.focus();
        }
    });

    onAuthStateChanged(auth, async currentUser => {
        if (!currentUser) {
            const returnTo = `${location.pathname}${location.search}`;
            location.replace(`./oauth.html?returnTo=${encodeURIComponent(returnTo)}`);
            return;
        }
        user = currentUser;
        try {
            await findOrCreateChat();
        } catch (loadError) {
            console.error('Unable to open support chat:', loadError);
            showError(loadError.message || 'Could not open this conversation.');
        }
    }, authError => {
        console.error('Unable to verify sign-in for support chat:', authError);
        showError('Could not verify your sign-in. Reload this page and try again.');
    });

    window.addEventListener('pagehide', () => {
        unsubscribeChat?.();
        unsubscribeMessages?.();
    });
}
