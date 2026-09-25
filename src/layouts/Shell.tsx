import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Icon, type IconName } from "@/components/Icon";
import { Avatar, Loading } from "@/components/ui";
import { ThemeButton } from "./SiteLayout";
import { useAuth } from "@/context/AuthContext";
import { useData, useDebounced } from "@/hooks/useData";
import { api } from "@/services/api";
import { relative } from "@/lib/format";

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  count?: number;
  end?: boolean;
}

export interface NavSection {
  key: string;
  title?: string;
  icon?: IconName;
  items: NavItem[];
}

interface NotificationList {
  items: Array<{ id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }>;
  unread: number;
  unreadMessages: number;
  topics: string[];
}

/** The bell: in-app notifications, refreshed the instant a new one arrives. */
function Notifications({ messagesPath }: { messagesPath: string }) {
  const [topics, setTopics] = useState<string[]>([]);
  const { data, reload } = useData<NotificationList>("/notifications", topics);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (data?.topics && data.topics.join() !== topics.join()) setTopics(data.topics);
  }, [data, topics]);
  useEffect(() => {
    const close = (event: MouseEvent) => ref.current && !ref.current.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    const count = (data?.unread ?? 0) + (data?.unreadMessages ?? 0);
    document.title = document.title.replace(/^\(\d+\) /, "");
    if (count) document.title = `(${count}) ${document.title}`;
  }, [data]);

  async function openNote(id: string, link: string | null) {
    await api.post(`/notifications/${id}/read`).catch(() => undefined);
    void reload();
    setOpen(false);
    if (link) navigate(link);
  }

  return (
    <>
      <Link to={messagesPath} className="icon-btn" aria-label={`Messages${data?.unreadMessages ? `, ${data.unreadMessages} unread` : ""}`}>
        <Icon name="message-square" />
        {data?.unreadMessages ? <span className="dot">{data.unreadMessages}</span> : null}
      </Link>
      <div style={{ position: "relative" }} ref={ref}>
        <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`}>
          <Icon name="bell" />
          {data?.unread ? <span className="dot">{data.unread > 99 ? "99+" : data.unread}</span> : null}
        </button>
        {open && (
          <div className="popover" role="dialog" aria-label="Notifications">
            <div className="popover-head">
              <strong>Notifications</strong>
              {data?.unread ? <button className="btn btn-ghost btn-sm" onClick={() => void api.post("/notifications/read").then(reload)}>Mark all read</button> : null}
            </div>
            <div className="popover-body">
              {data?.items.length ? (
                data.items.map((n) => (
                  <button key={n.id} className={`note ${n.readAt ? "" : "unread"}`} style={{ width: "100%", textAlign: "left", border: 0, font: "inherit", cursor: "pointer" }} onClick={() => void openNote(n.id, n.link)}>
                    <strong>{n.title}</strong>
                    {n.body && <small>{n.body}</small>}
                    <small>{relative(n.createdAt)}</small>
                  </button>
                ))
              ) : (
                <p className="muted small" style={{ padding: "1rem" }}>Nothing new.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Search() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 250);
  const [results, setResults] = useState<Array<{ kind: string; id: string; title: string; detail?: string; link: string }>>([]);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (debounced.trim().length < 2) return setResults([]);
    const controller = new AbortController();
    api.get<typeof results>(`/workspace/search?q=${encodeURIComponent(debounced)}`, { signal: controller.signal }).then(setResults).catch(() => undefined);
    return () => controller.abort();
  }, [debounced]);
  return (
    <div className="search">
      <Icon name="search" />
      <input className="input" placeholder="Search students, applications, invoices…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} aria-label="Search" />
      {open && q.length >= 2 && (
        <div className="search-results">
          {results.length ? results.map((r) => (
            <Link key={`${r.kind}-${r.id}`} to={r.link}>
              <span><strong>{r.title}</strong> {r.detail && <span className="muted small">· {r.detail}</span>}</span>
              <span className="badge">{r.kind}</span>
            </Link>
          )) : <p className="muted small" style={{ padding: ".6rem" }}>No matches.</p>}
        </div>
      )}
    </div>
  );
}

/** Sidebar + top bar frame used by the student portal and the staff workspace. */
export function Shell({ sections, home, messagesPath, search, className = "", footer, tabbar }: { sections: NavSection[]; home: string; messagesPath: string; search?: boolean; className?: string; footer?: ReactNode; tabbar?: NavItem[] }) {
  const { session, signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("hml_nav") ?? "{}");
    } catch {
      return {};
    }
  });
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setMenu(false), [location.pathname]);
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = { ...c, [key]: !c[key] };
      try {
        localStorage.setItem("hml_nav", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  const user = session.kind !== "none" ? session.user : null;

  return (
    <div className={`ws ${className}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      {menu && <div className="ws-scrim" onClick={() => setMenu(false)} />}
      <aside className={`ws-sidebar ${menu ? "open" : ""}`} aria-label="Sections">
        <Link to={home} className="brand"><img src="/img/logo.webp" alt="" width="38" height="38" /><span>Heimat<span>liebe</span></span></Link>
        <nav>
          {sections.map((section) => (
            <div key={section.key} className="nav-group" data-open={section.title ? String(!collapsed[section.key]) : "true"}>
              {section.title && (
                <button className="nav-group-title" onClick={() => toggle(section.key)} aria-expanded={!collapsed[section.key]}>
                  {section.title}
                  <Icon name="chevron-down" className="chev" />
                </button>
              )}
              <div className="nav-links">
                {section.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                    {item.count ? <span className="count">{item.count}</span> : null}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="ws-sidebar-foot">
          {footer}
          <Link to="/" className="nav-link"><Icon name="globe" /><span>Public website</span></Link>
          <button className="nav-link" style={{ width: "100%", border: 0, background: "none", cursor: "pointer", font: "inherit" }} onClick={() => void signOut().then(() => navigate("/sign-in"))}>
            <Icon name="log-out" /><span>Sign out</span>
          </button>
        </div>
      </aside>
      <div className="ws-body">
        <header className="ws-topbar">
          <button className="icon-btn ws-menu-btn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" /></button>
          {search ? <Search /> : <strong className="small muted">{user && "studentNo" in user ? user.studentNo : ""}</strong>}
          <div className="topbar-actions">
            <Notifications messagesPath={messagesPath} />
            <ThemeButton className="icon-btn" />
            {user && <Link to={home === "/admin" ? "/admin/me" : "/portal/profile"} className="icon-btn" aria-label="My account"><Avatar name={user.name} src={user.photoUrl} size={30} /></Link>}
          </div>
        </header>
        <main id="main" className="ws-main">
          <Suspense fallback={<Loading />}>
            <div className="page-enter" key={location.pathname}>
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>
      {tabbar && (
        <nav className="portal-tabbar" aria-label="Quick links">
          {tabbar.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
