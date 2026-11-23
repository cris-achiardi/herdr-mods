// Sidebar Plus (cris-achiardi, 2026; Apache-2.0, see NOTICE): local servers
// under their spaces in the lists view. The servers mod scans and publishes
// shared "servers.spaces": { at, spaces: { <space id>: [server] }, other: [server] },
// server = { pid, port, name, tool, dir, pane, restartable, stopping, share: null | { url } }.
// Its buttons are pressed through shared "servers.request" ({ id, action, pid,
// port, at }); the servers mod does the work. This view marks shared
// "servers.listen" so the servers mod keeps scanning while its section is hidden.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, setShared, notify } from "herdr";
import { TEXT, Icon, IconButton } from "./ui.js";

export const SERVERS_FRESH = 60000; // older than this, the servers mod has stopped publishing
export const SERVERS_LISTEN_EVERY = 30000;

// The published list, or null when it is missing or stale.
export function publishedServers(now = Date.now()) {
  const d = shared("servers.spaces");
  if (!d || typeof d.at !== "number" || now - d.at > SERVERS_FRESH) return null;
  return d;
}

export function serversOf(spaceId, now) {
  const d = publishedServers(now);
  return Array.isArray(d?.spaces?.[spaceId]) ? d.spaces[spaceId] : [];
}

export function otherServers(now) {
  const d = publishedServers(now);
  return Array.isArray(d?.other) ? d.other : [];
}

export function listenForServers() {
  setShared("servers.listen", Date.now());
}

let asked = 0;
export function askServers(action, s) {
  asked += 1;
  setShared("servers.request", { id: `${Date.now()}-${asked}`, action, pid: s.pid, port: s.port, at: Date.now() });
}

export class ServerRows {
  constructor() {
    this.hovered = null;
  }

  // One server: its name and port; on hover its buttons (restart, stop, share or
  // copy and stop sharing, open), else a link mark while it is shared. A click opens it.
  row(s, t) {
    const key = `${s.pid}-${s.port}`;
    const hovered = this.hovered === key;
    const url = s.share?.url ?? null;
    const tip = [s.tool && s.tool !== s.name ? s.tool : null, s.dir, s.pid ? `pid ${s.pid}` : null, url ? `shared at ${url}` : null]
      .filter(Boolean)
      .join(" · ");
    const button = (id, icon, label, onClick) => IconButton({ id: `${id}-${key}`, icon, label, onClick, iconSize: 13, muted: true });
    return h_flex()
      .id(`srv-${key}`)
      .px(8)
      .h(30)
      .flex_none()
      .rounded(8)
      .items_center()
      .gap(9)
      .cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_hover((on, cx) => {
        if (on) this.hovered = key;
        else if (this.hovered === key) this.hovered = null;
        cx.notify();
      })
      .tooltip(tip || s.name)
      .on_click((_e, cx) => cx.open_url(`http://localhost:${s.port}`))
      .child(
        s.stopping
          ? Icon("spinner", 16).text_color(t.dim).spin(900)
          : Icon("server", 16).text_color(t.dim),
      )
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .gap(5)
          .items_center()
          .child(div().min_w(0).truncate().text_color(s.stopping ? t.dim : t.muted).child(s.name))
          .child(div().flex_none().text_size(TEXT.caption).text_color(t.dim).child(`:${s.port}`)),
      )
      .when(hovered && !s.stopping, (el) =>
        el
          .when(Boolean(s.restartable), (e) => e.child(button("srv-restart", "restart", "Restart", () => askServers("restart", s))))
          .child(button("srv-stop", "stop", "Stop", () => askServers("stop", s)))
          .when(!s.share, (e) => e.child(button("srv-share", "share", "Share a public link", () => askServers("share", s))))
          .when(Boolean(url), (e) =>
            e.child(
              button("srv-copy", "link", "Copy the public link", (cx) => {
                cx.write_to_clipboard(url);
                notify({ title: "Public link copied", body: url, level: "success" });
              }),
            ),
          )
          .when(Boolean(s.share), (e) => e.child(button("srv-unshare", "x", "Stop sharing", () => askServers("unshare", s))))
          .child(button("srv-open", "external", "Open in browser", (cx) => cx.open_url(`http://localhost:${s.port}`))),
      )
      .when(!hovered && Boolean(s.share), (el) =>
        el.child(url ? Icon("link", 12).text_color(t.accent) : Icon("spinner", 12).text_color(t.dim).spin(900)),
      );
  }
}
