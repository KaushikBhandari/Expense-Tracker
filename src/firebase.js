import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBPsNUBauFkIUPsq8dUwGyhTJ-pus3-9d0",
  authDomain: "travel-expense-pro-8c7d0.firebaseapp.com",
  projectId: "travel-expense-pro-8c7d0",
  storageBucket: "travel-expense-pro-8c7d0.firebasestorage.app",
  messagingSenderId: "19762767401",
  appId: "1:19762767401:web:3008a83b3738eee4bd5e38"
};

const app  = initializeApp(firebaseConfig);

export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);