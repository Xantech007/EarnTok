import { doc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const REWARDED_ACTIONS = new Set(['like', 'comment', 'share']);

export async function prepareActivityReward(transaction, db, userId, action, existingUserSnapshot = null) {
    if (!['like', 'unlike', 'comment', 'share'].includes(action) || !userId || userId.startsWith('guest-')) {
        return { amount: 0, userRef: null, userSnapshot: null, currentEarnings: 0 };
    }

    const userRef = doc(db, 'users', userId);
    const [settingsSnapshot, userSnapshot] = await Promise.all([
        REWARDED_ACTIONS.has(action) ? transaction.get(doc(db, 'admin', 'activityRewards')) : null,
        existingUserSnapshot || transaction.get(userRef)
    ]);
    if (!userSnapshot.exists()) throw new Error('Your account could not be found to credit activity earnings.');

    const configuredAmount = settingsSnapshot?.exists()
        ? settingsSnapshot.data()[action] ?? 0
        : 0;
    const amount = Number(configuredAmount);
    if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error(`The configured ${action} reward must be a non-negative whole number of coins.`);
    }

    const currentEarnings = Number(userSnapshot.data().earningsBalance ?? 0);
    if (amount > 0 && (!Number.isSafeInteger(currentEarnings) || currentEarnings < 0
        || !Number.isSafeInteger(currentEarnings + amount))) {
        throw new Error('Your earnings balance cannot accept this activity reward.');
    }
    return { amount, userRef, userSnapshot, currentEarnings };
}

export function writeRewardedActivity(transaction, reward, activityRef, activity, userUpdates = {}, rewardNoticeRef = null) {
    const updates = { ...userUpdates };
    if (reward.amount > 0) {
        updates.earningsBalance = reward.currentEarnings + reward.amount;
    }
    if (Object.keys(updates).length) transaction.set(reward.userRef, updates, { merge: true });
    transaction.set(activityRef, {
        ...activity,
        details: {
            ...(activity.details || {}),
            coinsEarned: reward.amount,
            rewardCurrency: 'coins'
        }
    });
    if (reward.amount > 0 && rewardNoticeRef) {
        transaction.set(rewardNoticeRef, {
            userId: 'system',
            profileId: reward.userRef.id,
            action: 'activity_reward',
            details: {
                sourceAction: activity.action,
                amount: reward.amount,
                currency: 'coins',
                videoId: activity.videoId || ''
            },
            createdAt: activity.createdAt
        });
    }
}
