import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { Loading } from "@/components/ui";
import { useSite } from "@/context/SiteContext";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Assistant } from "@/components/Assistant";

const NAV = [
  { to: "/courses", label: "Courses" },
  { to: "/placement-test", label: "Placement test" },
  { to: "/exams", label: "Exams" },
  { to: "/about", label: "About" },
  { to: "/news", label: "News" },
  { to: "/library", label: "Library" },
  { to: "/contact", label: "Contact" },
];

export function ThemeButton({ className = "theme-toggle" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button className={className} onClick={toggle} aria-label={theme === "dark" ? "Use light colours" : "Use dark colours"} title="Switch light / dark">
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

/** Frame of every public page: header with navigation, footer, WhatsApp button and the assistant. */
export function SiteLayout() {
  const { content } = useSite();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const site = content?.site;
  const institution = content?.institution;
  const account = session.kind === "staff" ? { to: "/admin", label: "Workspace" } : session.kind === "student" ? { to: "/portal", label: "My portal" } : { to: "/sign-in", label: "Sign in" };

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand" aria-label="Heimatliebe Institute home">
            <img src="/img/logo.webp" alt="" width="38" height="38" />
            <span>
              Heimat<span>liebe</span>
            </span>
          </Link>
          <nav className={`site-nav ${open ? "open" : ""}`} aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to}>{item.label}</NavLink>
            ))}
            <NavLink to={account.to}>{account.label}</NavLink>
            <Link to="/apply" className="btn btn-gold btn-sm">Apply now</Link>
          </nav>
          <ThemeButton />
          <button className="menu-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Menu">
            <Icon name={open ? "x" : "menu"} />
          </button>
        </div>
      </header>

      <main id="main">
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <Link to="/" className="brand">
                <img src="/img/logo.webp" alt="" width="38" height="38" loading="lazy" />
                <span>{institution?.name ?? "Heimatliebe Institute"}</span>
              </Link>
              <p style={{ marginTop: "1rem" }}>{institution?.tagline}</p>
              <div className="socials">
                {site?.socialFacebook && <a href={site.socialFacebook} aria-label="Facebook" rel="noopener noreferrer" target="_blank"><Icon name="globe" /></a>}
                {site?.socialInstagram && <a href={site.socialInstagram} aria-label="Instagram" rel="noopener noreferrer" target="_blank"><Icon name="image" /></a>}
                {site?.socialYoutube && <a href={site.socialYoutube} aria-label="YouTube" rel="noopener noreferrer" target="_blank"><Icon name="video" /></a>}
                {site?.socialTiktok && <a href={site.socialTiktok} aria-label="TikTok" rel="noopener noreferrer" target="_blank"><Icon name="zap" /></a>}
              </div>
            </div>
            <div>
              <h4>Study</h4>
              <ul>
                <li><Link to="/courses">Courses</Link></li>
                <li><Link to="/placement-test">Free placement test</Link></li>
                <li><Link to="/apply">Apply online</Link></li>
                <li><Link to="/apply/track">Track my application</Link></li>
                <li><Link to="/exams">Official exams</Link></li>
              </ul>
            </div>
            <div>
              <h4>Institute</h4>
              <ul>
                <li><Link to="/about">About us</Link></li>
                <li><Link to="/news">News</Link></li>
                <li><Link to="/gallery">Gallery</Link></li>
                <li><Link to="/calendar">Calendar</Link></li>
                <li><Link to="/faq">Questions & answers</Link></li>
                <li><Link to="/verify">Verify a certificate</Link></li>
              </ul>
            </div>
            <div>
              <h4>Contact</h4>
              <ul>
                {site?.contactAddress && <li>{site.contactAddress}</li>}
                {site?.contactPhone && <li><a href={`tel:${site.contactPhone.replace(/\s/g, "")}`}>{site.contactPhone}</a></li>}
                {site?.contactEmail && <li><a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a></li>}
                {site?.officeHours && <li style={{ whiteSpace: "pre-line" }}>{site.officeHours}</li>}
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} {institution?.name ?? "Heimatliebe Institute"}. {site?.footerNote}</span>
            <span><Link to="/sign-in">Student & staff sign-in</Link></span>
          </div>
        </div>
      </footer>

      {institution?.whatsappNumber && (
        <a className="whatsapp-fab" href={`https://wa.me/${institution.whatsappNumber}`} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp">
          <Icon name="phone" />
        </a>
      )}
      <Assistant />
    </>
  );
}
