import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCj0IlKMARo0IxnqaHoN-rSd0HINuwf6Po",
    authDomain: "dashboard-washhub.firebaseapp.com",
    projectId: "dashboard-washhub",
    storageBucket: "dashboard-washhub.firebasestorage.app",
    messagingSenderId: "698841097292",
    appId: "1:698841097292:web:6f362dc4e4dbf5909d00e9"
};

// Inizializza Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Esportiamo usando i "soprannomi" (aliases) esatti richiesti dai moduli!
export { 
    auth, 
    db, 
    collection as fsCollection, 
    addDoc as fsAddDoc, 
    getDocs as fsGetDocs, 
    updateDoc as fsUpdateDoc, 
    deleteDoc as fsDeleteDoc, 
    doc as fsDoc, 
    onSnapshot as fsOnSnapshot,
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
};
