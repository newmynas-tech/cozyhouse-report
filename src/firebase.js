import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Firebase 설정 (이미지의 정보를 바탕으로 구성됨)
const firebaseConfig = {
  apiKey: "AIzaSyBLXbc_c_eq2tOMqSZNrkbXLfKcZZ4kt4",
  authDomain: "cozyhouse-report-final.firebaseapp.com",
  projectId: "cozyhouse-report-final",
  storageBucket: "cozyhouse-report-final.firebasestorage.app",
  messagingSenderId: "696596548683",
  appId: "1:696596548683:web:a95cf3fbdc25160362d1ce"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);

// Firestore(데이터베이스) 객체 생성 및 내보내기
export const db = getFirestore(app);