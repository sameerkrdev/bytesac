/* global firebase */
// Same version as the `firebase` dependency (compat scripts, per the Firebase web push docs).
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js");

// The page passes its public config in the registration URL. Messages carry a `notification` payload, so the browser shows
// them and opens `webpush.fcm_options.link` on click; no handlers are needed here.
firebase.initializeApp(Object.fromEntries(new URL(self.location.href).searchParams));
firebase.messaging();
