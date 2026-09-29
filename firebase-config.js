/* ============================================
   SmartLane — Firebase Configuration
   
   HOW TO SET UP:
   1. Go to https://console.firebase.google.com
   2. Click "Create a project" → name it "SmartLane"
   3. Go to "Build" → "Realtime Database" → "Create Database"
   4. Select your region → Start in TEST MODE → Enable
   5. Go to Project Settings (⚙️ gear icon) → "General" tab
   6. Scroll down to "Your apps" → click Web icon (</>)
   7. Register app name "SmartLane" → copy the config below
   8. Replace the values below with YOUR config
   ============================================ */

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};
