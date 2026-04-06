import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAh1k7ZvJ5mp3TurQ0KDsLKBRTjh2UIE80",
  authDomain: "tormessenger-165e5.firebaseapp.com",
  projectId: "tormessenger-165e5",
  storageBucket: "tormessenger-165e5.firebasestorage.app",
  messagingSenderId: "1018736746310",
  appId: "1:1018736746310:web:230c7f3666671882204f47",
  measurementId: "G-R4LS4KNDFK"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);