/**
 * Root HTML shell for the web build (web-only; runs in Node at export time).
 *
 * This is where the app stops being "a browser preview of a native app" and
 * becomes an installable, mobile-first web app:
 *  - PWA manifest + apple-touch-icon, so "Add to Home Screen" on iOS gives a
 *    standalone, chrome-less app that costs ~nothing in device storage.
 *  - viewport-fit=cover, so env(safe-area-inset-*) is non-zero and the header /
 *    input bar clear the notch and home indicator (react-native-safe-area-context
 *    reads those on web).
 *  - 100dvh sizing, so the iOS Safari URL bar collapsing doesn't leave a gap.
 *
 * Note: no `maximum-scale`/`user-scalable=no`. iOS only auto-zooms on focus when
 * the field's font-size is < 16px, and the composer input is exactly 16px, so we
 * get no zoom-on-focus while leaving pinch-zoom available.
 */
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        {/* PWA / installability */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Chat" />
        {/* black-translucent lets the app paint under the status bar; the safe
            area insets above keep content out from under it. */}
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
        <link rel="icon" href="/icons/icon-192.png" />

        {/* Follow the device theme; the app's own palette does the same. */}
        <meta name="color-scheme" content="light dark" />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#f5f5f7"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#1c1c1e"
        />

        {/* Keeps react-native-web ScrollViews from inheriting body scrolling. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: resetStyles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

/**
 * `dvh` tracks the *dynamic* viewport, so the layout doesn't jump when Safari's
 * URL bar hides on scroll. The `%` line before it is the fallback for browsers
 * without dvh support. Overscroll is pinned so the whole page can't rubber-band
 * while you're scrolling the message list.
 */
const resetStyles = `
html, body, #root {
  height: 100%;
  height: 100dvh;
}
body {
  margin: 0;
  overscroll-behavior: none;
  background-color: #ffffff;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  body { background-color: #000000; }
}
`;
