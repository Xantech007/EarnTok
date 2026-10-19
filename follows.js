import { db } from './firebase.js';
import {
    collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, runTransaction, serverTimestamp, where
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

export function followDocumentId(followerId, followingId) {
    return `${encodeURIComponent(followerId)}:${encodeURIComponent(followingId)}`;
}

export async function removeUserFollow(followerId, followingId) {
    if (!followerId || !followingId) return;
    const followRef = doc(db, 'follows', followDocumentId(followerId, followingId));
    await deleteDoc(followRef);
}

export async function toggleUserFollow(followerId, followingId, details = {}) {
    if (!followerId || !followingId) throw new Error('Both users are required to follow an account.');
    if (followerId === followingId) throw new Error('You cannot follow your own account.');

    const followRef = doc(db, 'follows', followDocumentId(followerId, followingId));
    const activityRef = doc(collection(db, 'activity'));
    return runTransaction(db, async transaction => {
        const followSnapshot = await transaction.get(followRef);
        const following = !followSnapshot.exists();

        if (following) {
            transaction.set(followRef, {
                followerId,
                followingId,
                createdAt: serverTimestamp()
            });
        } else {
            transaction.delete(followRef);
        }

        transaction.set(activityRef, {
            userId: followerId,
            action: following ? 'follow_creator' : 'unfollow_creator',
            ...(details.videoId ? { videoId: details.videoId } : {}),
            details: { ...details, followingId },
            createdAt: serverTimestamp()
        });
        return following;
    });
}

export async function getUserFollowStats(userId) {
    const [followers, following] = await Promise.all([
        getCountFromServer(query(collection(db, 'follows'), where('followingId', '==', userId))),
        getCountFromServer(query(collection(db, 'follows'), where('followerId', '==', userId)))
    ]);
    return { followers: followers.data().count, following: following.data().count };
}

export async function getFollowingUserIds(userId) {
    const snapshot = await getDocs(query(collection(db, 'follows'), where('followerId', '==', userId)));
    return snapshot.docs.map(item => item.data().followingId).filter(Boolean);
}

export async function isUserFollowing(followerId, followingId) {
    if (!followerId || !followingId || followerId === followingId) return false;
    const snapshot = await getDoc(doc(db, 'follows', followDocumentId(followerId, followingId)));
    return snapshot.exists();
}