# Android overrides

`tauri android init` regenerates `src-tauri/gen/`, which is gitignored. Two
files there need hand edits for the Android app to reach a plain-http LAN
server. Copies live here:

- `AndroidManifest.xml` goes to
  `src-tauri/gen/android/app/src/main/AndroidManifest.xml`.
- `network_security_config.example.xml` goes to
  `src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml`.
  Replace `YOUR_LAN_IP` with your server's LAN IP (the host part of
  `VITE_LOCAL_BASE`).

Release builds block cleartext http by default. This config allows it only
for that one LAN address.
