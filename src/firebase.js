// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// 이 부분은 나중에 실제 본인의 설정값으로 채울 예정입니다.
const firebaseConfig = {
  apiKey: "temp",
  authDomain: "temp",
  projectId: "temp",
  storageBucket: "temp",
  messagingSenderId: "temp",
  appId: "temp"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);