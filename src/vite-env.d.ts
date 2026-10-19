/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface Navigator {
  /** iOS Safari only: true when launched from the home screen. */
  standalone?: boolean;
}
