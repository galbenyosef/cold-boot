/**
 * Page reloads (level change, restart, title screen). Every one replaces the page, so the old page's memory is still
 * in the process while the new one boots.
 *
 * Phones go through `reboot.html` (public/), a near-empty page that waits ~3 s before loading the target: measured in
 * WebKit (level 5 → level 5), a direct reload peaked at 1.30–1.35 GB and a reload via a page that waited 3 s at
 * 1.10–1.12 GB (a fresh boot: ~1.14 GB); 1.5 s was not enough. Desktops reload directly.
 */
let viaReboot = false;

/** main.ts: route reloads through reboot.html (phones). */
export function setRebootPage(on: boolean): void { viaReboot = on; }

/** Replace the page with `url` (default: this page again). */
export function reloadPage(url?: string): void {
  if (viaReboot) { location.replace(`reboot.html?to=${encodeURIComponent(url ?? location.href)}`); return; }
  if (url) location.replace(url);
  else location.reload();
}
