// firebase.js — single place for Firebase setup, auth and all database helpers.
// Every page imports from here:  import { ... } from './firebase.js';
// NOTE: ES modules only work over http(s), not by double-clicking the file.
// Run a local server, e.g.  npx serve .   or   python -m http.server

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, signOut, updateProfile, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where,
  orderBy, limit, getDocs, serverTimestamp, increment, writeBatch, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* ------------------------------------------------------------------ */
/* 1. CONFIG — paste yours from Firebase Console > Project settings    */
/* ------------------------------------------------------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyD-gMS-7WsLUNT8avQjQ4TTw0JN8uUtZVk",
  authDomain: "earntok-c08e3.firebaseapp.com",
  projectId: "earntok-c08e3",
  storageBucket: "earntok-c08e3.firebasestorage.app",
  messagingSenderId: "871407829862",
  appId: "1:871407829862:web:bedcd24bde88d33185fea7",
  measurementId: "G-Q5METHGJ11"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/* ------------------------------------------------------------------ */
/* 2. AUTH STATE + GUEST GATING                                        */
/* ------------------------------------------------------------------ */

/** Resolves once with the signed-in user, or null for guests. Await this on every page. */
export const authReady = new Promise((resolve) => {
  const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
});

const SAFE_REDIRECT = /^[a-z0-9_-]+\.html(\?[^#\s]*)?$/i; // same-folder pages only (blocks open redirects)

export function currentPage() {
  const p = location.pathname.split("/").pop() || "index.html";
  return p + location.search;
}

export function loginUrlFor(target = currentPage()) {
  return `login.html?redirect=${encodeURIComponent(target)}`;
}

/**
 * Call before any action that needs an account (comment, like, follow...).
 * Returns the user if signed in; otherwise sends the guest to login.html and returns null.
 * After logging in they come back to `target`.
 */
export function requireAuth(message = "Log in to continue", target = currentPage()) {
  if (auth.currentUser) return auth.currentUser;
  sessionStorage.setItem("authMsg", message);
  location.href = loginUrlFor(target);
  return null;
}

/** Where to go after login/signup (from ?redirect=), validated. */
export function getRedirect() {
  const r = new URLSearchParams(location.search).get("redirect");
  return r && SAFE_REDIRECT.test(r) ? r : "index.html";
}

export const defaultAvatar = (name = "?") =>
  `https://ui-avatars.com/api/?background=FE2C55&color=fff&bold=true&name=${encodeURIComponent(name)}`;
export const avatarOf = (u) => (u && (u.photoURL || u.avatar)) || defaultAvatar((u && u.username) || "?");

/* ------------------------------------------------------------------ */
/* 3. AUTH ACTIONS                                                     */
/* ------------------------------------------------------------------ */

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

async function createUserDoc(user, username) {
  const batch = writeBatch(db);
  batch.set(doc(db, "users", user.uid), {
    uid: user.uid,
    username,
    displayName: user.displayName || username,
    photoURL: user.photoURL || "",
    bio: "",
    followersCount: 0,
    followingCount: 0,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, "usernames", username), { uid: user.uid });
  await batch.commit();
}

export async function signUp({ email, password, username }) {
  username = (username || "").toLowerCase().trim();
  if (!USERNAME_RE.test(username)) {
    throw new Error("Username must be 3–24 characters: letters, numbers, _ or .");
  }
  if ((await getDoc(doc(db, "usernames", username))).exists()) {
    throw new Error("That username is taken. Try another.");
  }
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: username });
  await createUserDoc(cred.user, username);
  return cred.user;
}

export async function logIn(email, password) {
  return (await signInWithEmailAndPassword(auth, email, password)).user;
}

export async function logInWithGoogle() {
  const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
  if (!(await getDoc(doc(db, "users", user.uid))).exists()) {
    let base = (user.email || "user").split("@")[0].toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 16);
    if (base.length < 3) base += "user";
    let name = base;
    while ((await getDoc(doc(db, "usernames", name))).exists()) {
      name = base + Math.floor(Math.random() * 9999);
    }
    await createUserDoc(user, name);
  }
  return user;
}

export const logOut = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

export function friendlyError(e) {
  const map = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account with that email.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/email-already-in-use": "An account with that email already exists. Log in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/popup-closed-by-user": "Sign-in window was closed.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "permission-denied": "You don't have permission to do that.",
  };
  return map[e && e.code] || (e && e.message) || "Something went wrong.";
}

/* ------------------------------------------------------------------ */
/* 4. USERS                                                            */
/* ------------------------------------------------------------------ */

export async function getUser(uid) {
  const s = await getDoc(doc(db, "users", uid));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function getUserByUsername(username) {
  const s = await getDoc(doc(db, "usernames", username));
  return s.exists() ? getUser(s.data().uid) : null;
}

/** Profile doc of the signed-in user (falls back to auth data if the doc is missing). */
export async function getMe() {
  const u = auth.currentUser;
  if (!u) return null;
  return (await getUser(u.uid)) || { uid: u.uid, username: u.displayName || "user", photoURL: u.photoURL || "" };
}

export async function listUsersByIds(ids) {
  const docs = await Promise.all(ids.slice(0, 50).map((id) => getUser(id)));
  return docs.filter(Boolean);
}

export async function searchUsers(prefix) {
  const p = prefix.toLowerCase();
  const snap = await getDocs(query(collection(db, "users"),
    where("username", ">=", p), where("username", "<=", p + "\uf8ff"), limit(20)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function suggestedUsers(max = 20) {
  const snap = await getDocs(query(collection(db, "users"), orderBy("followersCount", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function uploadAvatar(file) {
  const uid = auth.currentUser.uid;
  const r = ref(storage, `avatars/${uid}/${Date.now()}`);
  await uploadBytesResumable(r, file);
  return getDownloadURL(r);
}

export async function updateMyProfile({ displayName, bio, photoURL }) {
  const u = auth.currentUser;
  const data = { displayName, bio };
  if (photoURL) data.photoURL = photoURL;
  await updateDoc(doc(db, "users", u.uid), data);
  await updateProfile(u, { displayName, ...(photoURL ? { photoURL } : {}) });
}

/* ------------------------------------------------------------------ */
/* 5. FOLLOW / LIKE / BOOKMARK STATE                                   */
/* ------------------------------------------------------------------ */

const idsOf = async (...path) => (await getDocs(collection(db, ...path))).docs.map((d) => d.id);

/** One-shot load of everything the current user has liked / saved / followed. */
export async function getMyState(uid) {
  const [l, s, f] = await Promise.all([
    idsOf("users", uid, "likes"), idsOf("users", uid, "bookmarks"), idsOf("users", uid, "following"),
  ]);
  return { liked: new Set(l), saved: new Set(s), following: new Set(f) };
}

export const getFollowingIds = (uid) => idsOf("users", uid, "following");
export const getFollowerIds = (uid) => idsOf("users", uid, "followers");

export async function isFollowing(targetUid) {
  const me = auth.currentUser;
  if (!me) return false;
  return (await getDoc(doc(db, "users", me.uid, "following", targetUid))).exists();
}

export async function toggleFollow(targetUid, currentlyFollowing) {
  const me = auth.currentUser.uid;
  if (me === targetUid) return;
  const b = writeBatch(db);
  const a = doc(db, "users", me, "following", targetUid);
  const c = doc(db, "users", targetUid, "followers", me);
  if (currentlyFollowing) {
    b.delete(a); b.delete(c);
  } else {
    b.set(a, { createdAt: serverTimestamp() }); b.set(c, { createdAt: serverTimestamp() });
  }
  const d = currentlyFollowing ? -1 : 1;
  b.update(doc(db, "users", me), { followingCount: increment(d) });
  b.update(doc(db, "users", targetUid), { followersCount: increment(d) });
  await b.commit();
}

export async function toggleLike(videoId, currentlyLiked) {
  const uid = auth.currentUser.uid;
  const b = writeBatch(db);
  const l = doc(db, "users", uid, "likes", videoId);
  if (currentlyLiked) b.delete(l); else b.set(l, { createdAt: serverTimestamp() });
  b.update(doc(db, "videos", videoId), { likesCount: increment(currentlyLiked ? -1 : 1) });
  await b.commit();
}

export async function toggleBookmark(videoId, currentlySaved) {
  const uid = auth.currentUser.uid;
  const b = writeBatch(db);
  const s = doc(db, "users", uid, "bookmarks", videoId);
  if (currentlySaved) b.delete(s); else b.set(s, { createdAt: serverTimestamp() });
  b.update(doc(db, "videos", videoId), { bookmarksCount: increment(currentlySaved ? -1 : 1) });
  await b.commit();
}

/* ------------------------------------------------------------------ */
/* 6. VIDEOS + COMMENTS                                                */
/* ------------------------------------------------------------------ */

const withId = (d) => ({ id: d.id, ...d.data() });
const newestFirst = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);

export async function fetchVideos(max = 20) {
  const snap = await getDocs(query(collection(db, "videos"), orderBy("createdAt", "desc"), limit(max)));
  return snap.docs.map(withId);
}

export async function fetchVideo(id) {
  const s = await getDoc(doc(db, "videos", id));
  return s.exists() ? withId(s) : null;
}

export async function fetchUserVideos(uid) {
  const snap = await getDocs(query(collection(db, "videos"), where("uid", "==", uid), limit(60)));
  return snap.docs.map(withId).sort(newestFirst);
}

export async function fetchFollowingVideos(uid) {
  const ids = (await getFollowingIds(uid)).slice(0, 30); // Firestore 'in' allows 30 values
  if (!ids.length) return [];
  const snap = await getDocs(query(collection(db, "videos"), where("uid", "in", ids), limit(40)));
  return snap.docs.map(withId).sort(newestFirst);
}

export async function fetchSavedVideos(uid) {
  const ids = (await idsOf("users", uid, "bookmarks")).slice(0, 30);
  const vids = await Promise.all(ids.map(fetchVideo));
  return vids.filter(Boolean);
}

export async function searchVideosByTag(tag) {
  const snap = await getDocs(query(collection(db, "videos"), where("tags", "array-contains", tag.toLowerCase()), limit(30)));
  return snap.docs.map(withId);
}

export async function searchVideosByAudio(name) {
  const snap = await getDocs(query(collection(db, "videos"), where("audio", "==", name), limit(30)));
  return snap.docs.map(withId);
}

export async function fetchComments(videoId) {
  const snap = await getDocs(query(collection(db, "videos", videoId, "comments"), orderBy("createdAt", "desc"), limit(50)));
  return snap.docs.map(withId);
}

export async function addComment(videoId, me, text) {
  const cref = doc(collection(db, "videos", videoId, "comments"));
  const data = { uid: me.uid, username: me.username, avatar: avatarOf(me), text: text.slice(0, 500), createdAt: serverTimestamp() };
  const b = writeBatch(db);
  b.set(cref, data);
  b.update(doc(db, "videos", videoId), { commentsCount: increment(1) });
  await b.commit();
  return { id: cref.id, ...data, createdAt: null };
}

/** Upload a video file, then create its Firestore doc. */
export async function uploadVideo({ file, description, audio, onProgress }) {
  const me = await getMe();
  const safe = file.name.replace(/[^a-z0-9._-]/gi, "_");
  const r = ref(storage, `videos/${me.uid}/${Date.now()}_${safe}`);
  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(r, file, { contentType: file.type });
    task.on("state_changed",
      (s) => onProgress && onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
      reject, resolve);
  });
  const videoURL = await getDownloadURL(r);
  const tags = [...new Set((description.match(/(?:^|\s)#(\w+)/g) || []).map((t) => t.trim().slice(1).toLowerCase()))];
  const docRef = await addDoc(collection(db, "videos"), {
    uid: me.uid, username: me.username, avatar: avatarOf(me),
    videoURL, poster: "", description, tags,
    audio: audio || `Original sound - ${me.username}`,
    likesCount: 0, commentsCount: 0, bookmarksCount: 0, sharesCount: 0,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

/* ------------------------------------------------------------------ */
/* 7. INBOX (direct messages)                                          */
/* ------------------------------------------------------------------ */

export const chatIdFor = (a, b) => [a, b].sort().join("_");

export async function ensureChat(me, other) {
  const id = chatIdFor(me.uid, other.uid);
  await setDoc(doc(db, "chats", id), {
    participants: [me.uid, other.uid],
    info: {
      [me.uid]: { username: me.username, avatar: avatarOf(me) },
      [other.uid]: { username: other.username, avatar: avatarOf(other) },
    },
  }, { merge: true });
  return id;
}

export async function listChats(uid) {
  const snap = await getDocs(query(collection(db, "chats"), where("participants", "array-contains", uid)));
  return snap.docs.map(withId).filter((c) => c.lastAt)
    .sort((a, b) => (b.lastAt?.seconds || 0) - (a.lastAt?.seconds || 0));
}

export function listenMessages(chatId, cb) {
  return onSnapshot(query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"), limit(200)),
    (s) => cb(s.docs.map(withId)));
}

export async function sendMessage(chatId, text) {
  const uid = auth.currentUser.uid;
  await addDoc(collection(db, "chats", chatId, "messages"), { from: uid, text: text.slice(0, 1000), createdAt: serverTimestamp() });
  await updateDoc(doc(db, "chats", chatId), { lastMessage: text.slice(0, 80), lastFrom: uid, lastAt: serverTimestamp() });
}

/* ------------------------------------------------------------------ */
/* 8. LIVE (rooms + chat; real video streaming needs a provider)       */
/* ------------------------------------------------------------------ */

export async function listLives() {
  const snap = await getDocs(query(collection(db, "lives"), where("active", "==", true), limit(30)));
  return snap.docs.map(withId);
}

export async function getLive(id) {
  const s = await getDoc(doc(db, "lives", id));
  return s.exists() ? withId(s) : null;
}

export async function startLive(me, title) {
  const r = await addDoc(collection(db, "lives"), {
    uid: me.uid, username: me.username, avatar: avatarOf(me),
    title: title.slice(0, 80), active: true, startedAt: serverTimestamp(),
  });
  return r.id;
}

export const endLive = (id) => updateDoc(doc(db, "lives", id), { active: false });

export function listenLiveChat(id, cb) {
  return onSnapshot(query(collection(db, "lives", id, "chat"), orderBy("createdAt", "asc"), limit(100)),
    (s) => cb(s.docs.map(withId)));
}

export async function sendLiveChat(id, me, text) {
  await addDoc(collection(db, "lives", id, "chat"), {
    uid: me.uid, username: me.username, text: text.slice(0, 300), createdAt: serverTimestamp(),
  });
}

export { serverTimestamp };
