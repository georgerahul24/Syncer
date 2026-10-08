/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Native app only: the server's address on the home LAN, e.g. http://192.168.1.10:3001 */
  readonly VITE_LOCAL_BASE?: string;
  /** Native app only: the server's remote (e.g. Tailscale) address, e.g. https://host.tailnet.ts.net */
  readonly VITE_REMOTE_BASE?: string;
}
