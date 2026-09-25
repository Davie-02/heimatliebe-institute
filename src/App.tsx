import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { SiteProvider } from "./context/SiteContext";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./components/Toasts";
import { Loading } from "./components/ui";
import { SiteLayout } from "./layouts/SiteLayout";
import Home from "./pages/site/Home";

// Every other page is downloaded only when first opened.
const Courses = lazy(() => import("./pages/site/Courses"));
const CourseDetail = lazy(() => import("./pages/site/Courses").then((m) => ({ default: m.CourseDetail })));
const About = lazy(() => import("./pages/site/About"));
const Apply = lazy(() => import("./pages/site/Apply"));
const TrackApplication = lazy(() => import("./pages/site/Apply").then((m) => ({ default: m.TrackApplication })));
const Placement = lazy(() => import("./pages/site/Placement"));
const Exams = lazy(() => import("./pages/site/Exams"));
const News = lazy(() => import("./pages/site/News"));
const NewsDetail = lazy(() => import("./pages/site/News").then((m) => ({ default: m.NewsDetail })));
const Gallery = lazy(() => import("./pages/site/Gallery"));
const Library = lazy(() => import("./pages/site/Library"));
const Calendar = lazy(() => import("./pages/site/Calendar"));
const Faq = lazy(() => import("./pages/site/Faq"));
const Contact = lazy(() => import("./pages/site/Contact"));
const Verify = lazy(() => import("./pages/site/Verify"));
const NotFound = lazy(() => import("./pages/site/NotFound"));
const SignIn = lazy(() => import("./pages/site/SignIn"));
const OwnerSignIn = lazy(() => import("./pages/site/SignIn").then((m) => ({ default: m.OwnerSignIn })));
const ForgotPassword = lazy(() => import("./pages/site/SignIn").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./pages/site/SignIn").then((m) => ({ default: m.ResetPassword })));
const PortalRoutes = lazy(() => import("./pages/portal/PortalRoutes"));
const WorkspaceRoutes = lazy(() => import("./pages/admin/WorkspaceRoutes"));

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <SiteProvider>
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/portal/*" element={<PortalRoutes />} />
                  <Route path="/admin/login" element={<SiteLayoutless><OwnerSignIn /></SiteLayoutless>} />
                  <Route path="/admin/*" element={<WorkspaceRoutes />} />
                  <Route element={<SiteLayout />}>
                    <Route index element={<Home />} />
                    <Route path="courses" element={<Courses />} />
                    <Route path="courses/:slug" element={<CourseDetail />} />
                    <Route path="about" element={<About />} />
                    <Route path="apply" element={<Apply />} />
                    <Route path="apply/track" element={<TrackApplication />} />
                    <Route path="placement-test" element={<Placement />} />
                    <Route path="exams" element={<Exams />} />
                    <Route path="news" element={<News />} />
                    <Route path="news/:slug" element={<NewsDetail />} />
                    <Route path="gallery" element={<Gallery />} />
                    <Route path="library" element={<Library />} />
                    <Route path="calendar" element={<Calendar />} />
                    <Route path="faq" element={<Faq />} />
                    <Route path="contact" element={<Contact />} />
                    <Route path="verify" element={<Verify />} />
                    <Route path="verify/:code" element={<Verify />} />
                    <Route path="sign-in" element={<SignIn />} />
                    <Route path="login" element={<Navigate to="/sign-in" replace />} />
                    <Route path="forgot-password" element={<ForgotPassword />} />
                    <Route path="reset-password" element={<ResetPassword />} />
                    <Route path="set-password" element={<ResetPassword invite />} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </Suspense>
            </SiteProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

/** The system administrator portal has no public navigation around it. */
function SiteLayoutless({ children }: { children: React.ReactNode }) {
  return <main id="main">{children}</main>;
}
