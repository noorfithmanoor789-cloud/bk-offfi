import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyCcrys22PRc_RMYlP9d0_sKqBJrGxceE1c",
    authDomain: "exam-systembk.firebaseapp.com",
    databaseURL: "https://exam-systembk-default-rtdb.firebaseio.com",
    projectId: "exam-systembk",
    storageBucket: "exam-systembk.firebasestorage.app",
    messagingSenderId: "814165573278",
    appId: "1:814165573278:web:5838ffc3dc76cbf81c858f",
    measurementId: "G-WX8K8873BK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { app, db };