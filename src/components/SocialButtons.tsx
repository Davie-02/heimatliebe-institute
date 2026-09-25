import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api";
import { Icon } from "./Icon";

interface Providers { google: { clientId: string } | null; facebook: { appId: string } | null }

declare global {
  interface Window {
    google?: { accounts: { id: { initialize: (o: unknown) => void; renderButton: (el: HTMLElement, o: unknown) => void } } };
    FB?: { init: (o: unknown) => void; login: (cb: (r: { authResponse?: { accessToken: string } }) => void, o: unknown) => void };
    fbAsyncInit?: () => void;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load the sign-in service."));
    document.head.appendChild(script);
  });
}

/**
 * "Continue with Google / Facebook". The provider's script is only downloaded when that provider
 * is set up on the server, so the sign-in page stays light otherwise.
 */
export function SocialButtons({ onToken, disabled }: { onToken: (provider: "google" | "facebook", token: string) => void; disabled?: boolean }) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const googleRef = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    api.get<Providers>("/auth/providers").then(setProviders).catch(() => setProviders(null));
  }, []);

  useEffect(() => {
    const google = providers?.google;
    if (!google || !googleRef.current) return;
    loadScript("https://accounts.google.com/gsi/client")
      .then(() => {
        window.google?.accounts.id.initialize({ client_id: google.clientId, callback: (response: { credential: string }) => callback.current("google", response.credential) });
        if (googleRef.current) window.google?.accounts.id.renderButton(googleRef.current, { theme: "outline", size: "large", width: googleRef.current.clientWidth || 320, text: "continue_with" });
      })
      .catch(() => undefined);
  }, [providers]);

  async function facebook() {
    const fb = providers?.facebook;
    if (!fb) return;
    await loadScript("https://connect.facebook.net/en_US/sdk.js");
    window.FB?.init({ appId: fb.appId, version: "v19.0", cookie: false, xfbml: false });
    window.FB?.login((response) => response.authResponse && callback.current("facebook", response.authResponse.accessToken), { scope: "email" });
  }

  if (!providers?.google && !providers?.facebook) return null;
  return (
    <>
      <div className="divider">or</div>
      <div className="stack" style={{ gap: ".6rem" }}>
        {providers.google && <div ref={googleRef} style={{ minHeight: 44, display: "flex", justifyContent: "center" }} aria-disabled={disabled} />}
        {providers.facebook && (
          <button type="button" className="btn social-btn" onClick={() => void facebook()} disabled={disabled}>
            <Icon name="user" /> Continue with Facebook
          </button>
        )}
      </div>
    </>
  );
}
