import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD-gMS-7WsLUNT8avQjQ4TTw0JN8uUtZVk",
  authDomain: "earntok-c08e3.firebaseapp.com",
  projectId: "earntok-c08e3",
  storageBucket: "earntok-c08e3.firebasestorage.app",
  messagingSenderId: "871407829862",
  appId: "1:871407829862:web:bedcd24bde88d33185fea7",
  measurementId: "G-Q5METHGJ11"
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);