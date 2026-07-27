import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.jsx";
import Layout from "./components/Layout.jsx";
import Loading from "./components/Loading.jsx";
import Login from "./pages/Login.jsx";
import ExamsList from "./pages/ExamsList.jsx";
import AnswerKeyConfig from "./pages/AnswerKeyConfig.jsx";
import BulkUpload from "./pages/BulkUpload.jsx";
import Results from "./pages/Results.jsx";
import Admin from "./pages/Admin.jsx";
import ImageResizer from "./pages/ImageResizer.jsx";
import AnswerKeyChecker from "./pages/AnswerKeyChecker.jsx";

// Auth gate: redirects to /login when there is no signed-in user.
function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <Loading className="min-h-screen" />;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

// Admin-only gate (used inside the authed layout). Non-admins are redirected.
function RequireAdmin() {
  const { user } = useAuth();
  if (!["admin", "super_admin"].includes(user?.role)) return <Navigate to="/exams" replace />;
  return <Admin />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Public standalone tools for the main adda247.com site. Deliberately
            outside RequireAuth and Layout: no sign-in, no portal chrome, and
            the portal's own navigation never links to them. */}
        <Route path="/image-resizer" element={<ImageResizer />} />
        <Route path="/answerkey-checker" element={<AnswerKeyChecker />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Navigate to="/exams" replace />} />
          <Route path="/exams" element={<ExamsList />} />
          <Route path="/exams/new" element={<AnswerKeyConfig />} />
          <Route path="/exams/:id" element={<AnswerKeyConfig />} />
          <Route path="/upload" element={<BulkUpload />} />
          <Route path="/upload/:id" element={<BulkUpload />} />
          <Route path="/results" element={<Results />} />
          <Route path="/results/:id" element={<Results />} />
          <Route path="/admin" element={<RequireAdmin />} />
          <Route path="*" element={<Navigate to="/exams" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

