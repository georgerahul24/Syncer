# Android overrides

`tauri android init` regenerates `src-tauri/gen/`, which is gitignored. Two
files there need hand edits for the Android app to reach a plain-http LAN
server. Copies live here:

- `AndroidManifest.xml` goes to
  `src-tauri/gen/android/app/src/main/AndroidManifest.xml`.
- `network_security_config.example.xml` goes to
  `src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml`.

Release builds block cleartext http by default. Server addresses are editable
in the app, and a home server is usually plain http, so this config allows it
for any host.
